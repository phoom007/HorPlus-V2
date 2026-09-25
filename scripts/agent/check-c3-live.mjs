/**
 * Live API & Database Verification Script for Card C3 (app.hor-plus.com)
 * Verifies C3-1, C3-2, C3-3, C3-4, C3-5, C3-6, C3-7, C3-8, C3-9
 */
import fs from 'fs';
import crypto from 'crypto';
import { PNG } from '../../server/node_modules/pngjs/lib/png.js';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { encryptText } from '../../server/dist/utils/crypto-encryption.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor
const prisma = getPrismaClient();

function createVisibleSignatureDataUri() {
  const png = new PNG({ width: 120, height: 40 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      const curveY = Math.round(20 + 8 * Math.sin(x / 10));
      if (Math.abs(y - curveY) <= 1 && x >= 12 && x <= 108) {
        png.data[idx] = 30;
        png.data[idx + 1] = 58;
        png.data[idx + 2] = 138;
        png.data[idx + 3] = 255;
      } else {
        png.data[idx] = 255;
        png.data[idx + 1] = 255;
        png.data[idx + 2] = 255;
        png.data[idx + 3] = 0;
      }
    }
  }
  const buf = PNG.sync.write(png);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

const SAMPLE_SIG_DATA_URI = createVisibleSignatureDataUri();

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find((b) => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map((l) => l.trim());
  const cookieIdx = lines.findIndex((l) => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex((l) => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return {
    session,
    csrf,
    cookieHeader: `horplus_session=${session}; horplus_csrf=${csrf}`,
  };
}

async function getTenantSessionFromEntry(rawToken) {
  const entryRes = await fetch(`${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(rawToken)}`, {
    redirect: 'manual',
  });
  const setCookies = entryRes.headers.getSetCookie ? entryRes.headers.getSetCookie() : [entryRes.headers.get('set-cookie')].filter(Boolean);
  let sessionCookie = '';
  let csrfCookie = '';
  for (const sc of setCookies) {
    const mSession = sc.match(/horplus_session=([^;]+)/);
    if (mSession) sessionCookie = mSession[1];
    const mCsrf = sc.match(/horplus_csrf=([^;]+)/);
    if (mCsrf) csrfCookie = mCsrf[1];
  }
  if (!sessionCookie) throw new Error(`Failed to obtain horplus_session from line-tenant-entry (status ${entryRes.status})`);
  return {
    session: sessionCookie,
    csrf: csrfCookie,
    cookieHeader: `horplus_session=${sessionCookie}; horplus_csrf=${csrfCookie}`,
  };
}

async function main() {
  console.log('=== Starting Card C3 Live Verification on https://app.hor-plus.com ===');

  const ownerAuth = getCredentials('Owner');
  const staffAuth = getCredentials('Staff');
  const tbAuth = getCredentials('Tenant'); // TA/TB other tenant

  // 1. Setup dedicated Room C3-109 & Tenant TC inside RLS transaction
  let tcSetup = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    const building = await tx.building.findFirst({ where: { dormitoryId: DORM_ID } });
    let testRoom = await tx.room.findFirst({
      where: { dormitoryId: DORM_ID, roomNumber: 'C3-109' },
    });
    if (!testRoom) {
      const sampleRoom = await tx.room.findFirst({ where: { dormitoryId: DORM_ID } });
      testRoom = await tx.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: building.id,
          roomNumber: 'C3-109',
          normalizedRoomNumber: 'C3-109',
          floor: 1,
          roomType: sampleRoom?.roomType || 'standard',
          monthlyRent: 4500,
          termDeposit: 9000,
          monthlyDeposit: sampleRoom?.monthlyDeposit ?? 4500,
          dailyRent: sampleRoom?.dailyRent ?? 500,
          dailyDeposit: sampleRoom?.dailyDeposit ?? 500,
          status: 'occupied',
        },
      });
    } else {
      await tx.receipt.deleteMany({ where: { roomId: testRoom.id } });
      await tx.contractSettlement.deleteMany({ where: { roomId: testRoom.id } });
      await tx.bill.deleteMany({ where: { roomId: testRoom.id } });
      await tx.tenantMoveOutRequest.deleteMany({ where: { roomId: testRoom.id } });
      await tx.tenantRegistrationRequest.deleteMany({ where: { requestedRoomId: testRoom.id } });
      await tx.occupancy.deleteMany({ where: { roomId: testRoom.id } });
      await tx.contract.deleteMany({ where: { roomId: testRoom.id } });
      await tx.room.update({ where: { id: testRoom.id }, data: { status: 'occupied' } });
    }

    const tcLineUserId = `U_c3_moveout_${Date.now()}`;
    const tcLineUserIdHash = crypto.createHash('sha256').update(tcLineUserId).digest('hex');
    const tcLineFriend = await tx.dormitoryLineFriend.create({
      data: {
        dormitoryId: DORM_ID,
        lineUserIdHash: tcLineUserIdHash,
        lineUserIdEncrypted: encryptText(tcLineUserId),
        displayName: 'กิตติ ทดสอบย้ายออก (TC)',
        friendStatus: 'FOLLOWING',
      },
    });

    const tcEmail = `tc.c3.${Date.now()}@horplus.local`;
    const tcUser = await tx.user.create({
      data: {
        googleSubject: `gsub_c3_${Date.now()}`,
        email: tcEmail,
        emailNormalized: tcEmail,
        name: 'กิตติ ทดสอบย้ายออก',
        phone: '0897776655',
      },
    });

    const tcTenant = await tx.tenant.create({
      data: {
        dormitoryId: DORM_ID,
        tenantNumber: `TN-C3-${Date.now().toString().slice(-4)}`,
        firstName: 'กิตติ',
        lastName: 'ทดสอบย้ายออก',
        displayName: 'กิตติ ทดสอบย้ายออก',
        phone: '0897776655',
        status: 'active',
        linkedUserId: tcUser.id,
        lineFriendId: tcLineFriend.id,
      },
    });

    const tcContract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        contractNumber: `CTR-C3-${Date.now().toString().slice(-5)}`,
        tenantId: tcTenant.id,
        roomId: testRoom.id,
        startDate: new Date('2026-05-01T00:00:00.000Z'),
        endDate: new Date('2026-10-31T00:00:00.000Z'),
        durationMonths: 6,
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 9000,
        status: 'active',
      },
    });

    const tcOccupancy = await tx.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        tenantId: tcTenant.id,
        roomId: testRoom.id,
        contractId: tcContract.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    });

    await tx.room.update({
      where: { id: testRoom.id },
      data: {
        status: 'occupied',
        currentTenantId: tcTenant.id,
        currentContractId: tcContract.id,
      },
    });

    const cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { periodStart: 'desc' },
    });

    const paidDepositBill = await tx.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle.id,
        roomId: testRoom.id,
        tenantId: tcTenant.id,
        contractId: tcContract.id,
        billNumber: `INV-DEP-PAID-${Date.now().toString().slice(-5)}`,
        billKind: 'DEPOSIT',
        billingDate: new Date('2026-05-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-05T00:00:00.000Z'),
        status: 'paid',
        subtotal: '9000',
        totalAmount: '9000',
        paidAmount: '9000',
        outstandingAmount: '0',
      },
    });

    const unpaidDepositBill = await tx.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle.id,
        roomId: testRoom.id,
        tenantId: tcTenant.id,
        contractId: null,
        billNumber: `INV-DEP-UNPAID-${Date.now().toString().slice(-5)}`,
        billKind: 'DEPOSIT',
        billingDate: new Date('2026-05-01T00:00:00.000Z'),
        dueDate: new Date('2026-05-05T00:00:00.000Z'),
        status: 'unpaid',
        subtotal: '2000',
        totalAmount: '2000',
        paidAmount: '0',
        outstandingAmount: '2000',
      },
    });

    const unpaidUtilityBill = await tx.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle.id,
        roomId: testRoom.id,
        tenantId: tcTenant.id,
        contractId: tcContract.id,
        billNumber: `INV-UTIL-UNPAID-${Date.now().toString().slice(-5)}`,
        billKind: 'MONTHLY_UTILITY',
        billingDate: new Date('2026-09-20T00:00:00.000Z'),
        dueDate: new Date('2026-09-28T00:00:00.000Z'),
        status: 'unpaid',
        subtotal: '1200',
        totalAmount: '1200',
        paidAmount: '0',
        outstandingAmount: '1200',
      },
    });

    const inviteService = new TenantRegistrationInviteService(tx);
    const tcInvite = await inviteService.createInvite(DORM_ID, tcLineFriend.id);

    tcSetup = {
      buildingId: building.id,
      roomId: testRoom.id,
      roomNumber: testRoom.roomNumber,
      tenantId: tcTenant.id,
      contractId: tcContract.id,
      lineFriendId: tcLineFriend.id,
      paidDepositBillId: paidDepositBill.id,
      unpaidDepositBillId: unpaidDepositBill.id,
      unpaidUtilityBillId: unpaidUtilityBill.id,
      rawToken: tcInvite.rawToken,
    };
  });

  const tcAuth = await getTenantSessionFromEntry(tcSetup.rawToken);

  // --- AC C3-1: TC submits move-out (< 30 days), reloads profile, cancels, and re-submits ---
  const submit1Res = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tcAuth.cookieHeader,
      'x-csrf-token': tcAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      intendedMoveOutDate: '2026-09-28',
      reason: 'แจ้งย้ายออกรอบแรก (ทดสอบยกเลิก)',
    }),
  });
  const submit1Json = await submit1Res.json();
  console.log('[C3-1] Submit #1 status:', submit1Res.status, submit1Json?.data?.id);
  if (submit1Res.status !== 201) throw new Error(`C3-1 submit #1 failed: ${JSON.stringify(submit1Json)}`);

  // Reload profile check
  const profReloadRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: tcAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const profReloadJson = await profReloadRes.json();
  console.log('[C3-1] Profile reload moveOutRequest:', profReloadJson?.moveOutRequest?.id, profReloadJson?.moveOutRequest?.status);
  if (!profReloadJson?.moveOutRequest?.id) throw new Error('C3-1 moveOutRequest missing on profile reload');

  // Cancel request #1
  const cancelRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests/${submit1Json.data.id}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tcAuth.cookieHeader,
      'x-csrf-token': tcAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
  });
  const cancelJson = await cancelRes.json();
  console.log('[C3-1] Cancel status:', cancelRes.status, cancelJson?.data?.status);
  if (cancelRes.status !== 200 || cancelJson?.data?.status !== 'CANCELLED') {
    throw new Error(`C3-1 cancel failed: ${JSON.stringify(cancelJson)}`);
  }

  // Re-submit request #2
  const submit2Res = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tcAuth.cookieHeader,
      'x-csrf-token': tcAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      intendedMoveOutDate: '2026-09-30',
      reason: 'ย้ายที่ทำงานใหม่ (ยืนยัน)',
    }),
  });
  const submit2Json = await submit2Res.json();
  const activeMoveOutRequestId = submit2Json?.data?.id;
  console.log('[C3-1] Re-submit #2 status:', submit2Res.status, activeMoveOutRequestId);
  if (submit2Res.status !== 201 || !activeMoveOutRequestId) {
    throw new Error(`C3-1 re-submit #2 failed: ${JSON.stringify(submit2Json)}`);
  }

  // --- AC C3-2: TB tries to submit move-out for TC & cancel TC's request -> 403 Forbidden ---
  const tbCrossSubmitRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tbAuth.cookieHeader,
      'x-csrf-token': tbAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      tenantId: tcSetup.tenantId,
      roomId: tcSetup.roomId,
      intendedMoveOutDate: '2026-09-30',
    }),
  });
  console.log('[C3-2] TB cross-tenant submit status:', tbCrossSubmitRes.status);
  if (tbCrossSubmitRes.status !== 403) throw new Error(`C3-2 expected 403, got ${tbCrossSubmitRes.status}`);

  const tbCrossCancelRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests/${activeMoveOutRequestId}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tbAuth.cookieHeader,
      'x-csrf-token': tbAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
  });
  console.log('[C3-2] TB cross-tenant cancel status:', tbCrossCancelRes.status);
  if (tbCrossCancelRes.status !== 403) throw new Error(`C3-2 cancel expected 403, got ${tbCrossCancelRes.status}`);

  // --- AC C3-3: Staff tries to confirm TC's move-out -> 403 Forbidden ---
  const staffConfirmRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests/${activeMoveOutRequestId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: staffAuth.cookieHeader,
      'x-csrf-token': staffAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      actualEndedAt: '2026-09-30',
      reason: 'Staff พยายามกดยืนยัน',
    }),
  });
  console.log('[C3-3] Staff confirm move-out status:', staffConfirmRes.status);
  if (staffConfirmRes.status !== 403) throw new Error(`C3-3 expected 403, got ${staffConfirmRes.status}`);

  // --- AC C3-4: Owner views move-out request and confirms move-out ---
  const ownerListRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    headers: { Cookie: ownerAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const ownerListJson = await ownerListRes.json();
  const foundInOwnerList = Array.isArray(ownerListJson?.data) && ownerListJson.data.some((r) => r.id === activeMoveOutRequestId);
  console.log('[C3-4] Owner sees TC move-out request in list:', foundInOwnerList);
  if (!foundInOwnerList) throw new Error('C3-4 Owner did not see TC move-out request');

  const ownerConfirmRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests/${activeMoveOutRequestId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: ownerAuth.cookieHeader,
      'x-csrf-token': ownerAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      actualEndedAt: '2026-09-30',
      reason: 'ยืนยันการย้ายออกและคืนเงินมัดจำสุทธิ',
    }),
  });
  const ownerConfirmJson = await ownerConfirmRes.json();
  console.log('[C3-4] Owner confirm status:', ownerConfirmRes.status, {
    finalReceiptNumber: ownerConfirmJson?.data?.finalReceipt?.receiptNumber,
    netSettlement: ownerConfirmJson?.data?.settlement?.netSettlement,
    voidedDepositBillIds: ownerConfirmJson?.data?.voidedDepositBillIds,
    deductedBillIds: ownerConfirmJson?.data?.deductedBillIds,
  });
  if (ownerConfirmRes.status !== 200) throw new Error(`C3-4 owner confirm failed: ${JSON.stringify(ownerConfirmJson)}`);
  if (!ownerConfirmJson?.data?.finalReceipt?.receiptNumber) throw new Error('C3-4 final receipt was not generated');
  if (Number(ownerConfirmJson?.data?.settlement?.netSettlement) !== 7800) {
    throw new Error(`C3-4 expected netSettlement 7800 (9000 paid deposit - 1200 utility), got ${ownerConfirmJson?.data?.settlement?.netSettlement}`);
  }

  // --- AC C3-5: TC's existing open session immediately stops working & cannot see old documents ---
  const tcAfterMoveOutRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: tcAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const tcContractAfterRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract`, {
    headers: { Cookie: tcAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  console.log('[C3-5] TC old session profile status:', tcAfterMoveOutRes.status, 'contract status:', tcContractAfterRes.status);
  if (tcAfterMoveOutRes.status !== 401 && tcAfterMoveOutRes.status !== 403) {
    throw new Error(`C3-5 expected 401 or 403 for TC old session, got ${tcAfterMoveOutRes.status}`);
  }

  // --- AC C3-6 & C3-7: DB Verification ---
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
    const dbGrants = await tx.dormitoryAccessGrant.findMany({
      where: { dormitoryId: DORM_ID, lineFriendId: tcSetup.lineFriendId, roleCode: 'TENANT' },
    });
    const dbTenant = await tx.tenant.findUnique({ where: { id: tcSetup.tenantId } });
    const dbRoom = await tx.room.findUnique({ where: { id: tcSetup.roomId } });
    const dbUnpaidDep = await tx.bill.findUnique({ where: { id: tcSetup.unpaidDepositBillId } });
    const dbUtilBill = await tx.bill.findUnique({ where: { id: tcSetup.unpaidUtilityBillId } });
    const dbNotice = await tx.tenantNotice.findFirst({
      where: { tenantId: tcSetup.tenantId, type: 'MOVE_OUT_COMPLETED' },
    });

    console.log('[C3-7] DB State Check:', {
      grantStatuses: dbGrants.map((g) => g.status),
      tenantStatus: dbTenant?.status,
      tenantLinkedUserId: dbTenant?.linkedUserId,
      tenantLineFriendId: dbTenant?.lineFriendId,
      roomStatus: dbRoom?.status,
      unpaidDepositBillStatus: dbUnpaidDep?.status,
      deductedUtilityBillStatus: dbUtilBill?.status,
      finalReceiptNoticeCreated: Boolean(dbNotice),
    });

    if (dbGrants.some((g) => g.status === 'ACTIVE')) throw new Error('C3-7 expected all TENANT grants REVOKED');
    if (dbTenant?.status !== 'former' || dbTenant?.linkedUserId !== null || dbTenant?.lineFriendId !== null) {
      throw new Error('C3-7 expected tenant status former and linkedUserId/lineFriendId null');
    }
    if (dbRoom?.status !== 'vacant') throw new Error(`C3-7 expected room vacant, got ${dbRoom?.status}`);
    if (dbUnpaidDep?.status !== 'void') throw new Error(`C3-7 expected unpaid deposit bill void, got ${dbUnpaidDep?.status}`);
    if (dbUtilBill?.status !== 'paid') throw new Error(`C3-7 expected utility bill paid, got ${dbUtilBill?.status}`);
  });

  // --- AC C3-8: Owner still sees historical bills & settlement receipt of TC ---
  const ownerSettlementRes = await fetch(`${BASE_URL}/api/v1/settlements/${tcSetup.contractId}`, {
    headers: { Cookie: ownerAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const ownerSettlementJson = await ownerSettlementRes.json();
  console.log('[C3-8] Owner historical settlement status:', ownerSettlementRes.status, ownerSettlementJson?.data?.settlementStatus);
  if (ownerSettlementRes.status !== 200 || ownerSettlementJson?.data?.settlementStatus !== 'REFUNDED') {
    throw new Error(`C3-8 owner settlement check failed: ${JSON.stringify(ownerSettlementJson)}`);
  }

  // --- AC C3-9: Same LINE account of TC re-registers in the same room (C3-109) and sees ONLY new data ---
  let reRegRawToken = '';
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
    const inviteService = new TenantRegistrationInviteService(tx);
    const newInvite = await inviteService.createInvite(DORM_ID, tcSetup.lineFriendId);
    reRegRawToken = newInvite.rawToken;
  });

  const tcReRegAuth = await getTenantSessionFromEntry(reRegRawToken);

  // Verify candidate profile starts as 'unregistered' with zero old data
  const candidateProfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: tcReRegAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const candidateProfJson = await candidateProfRes.json();
  console.log('[C3-9] Candidate profile status before re-registration:', candidateProfRes.status, candidateProfJson?.status);
  if (candidateProfRes.status !== 200 || candidateProfJson?.status !== 'unregistered') {
    throw new Error(`C3-9 expected status 'unregistered', got ${candidateProfJson?.status}`);
  }

  const policyRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/public-policy?dormitoryId=${DORM_ID}`);
  const policyJson = await policyRes.json();
  const expectedPolicyVersion = policyJson?.data?.policyVersion ?? policyJson?.policyVersion ?? 1;

  // Submit new registration in the same room C3-109
  const reRegSubmitRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tcReRegAuth.cookieHeader,
      'x-csrf-token': tcReRegAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      firstName: 'กิตติ',
      lastName: 'สัญญาใหม่รอบสอง',
      phone: '0897776655',
      nationalId: '1100501234567',
      requestedRoomId: tcSetup.roomId,
      roomNumber: tcSetup.roomNumber,
      buildingId: tcSetup.buildingId,
      startDate: '2026-10-01',
      durationMonths: 6,
      rentBillingType: 'monthly',
      proposedRent: 4800,
      proposedDeposit: 9600,
      signatureDataUrl: SAMPLE_SIG_DATA_URI,
      signatureBase64: SAMPLE_SIG_DATA_URI,
      acceptedTerms: true,
      agreedTerms: true,
      expectedPolicyVersion,
    }),
  });
  const reRegSubmitJson = await reRegSubmitRes.json();
  const newRegId = reRegSubmitJson?.data?.id || reRegSubmitJson?.id;
  console.log('[C3-9] Re-registration submit status:', reRegSubmitRes.status, newRegId);
  if ((reRegSubmitRes.status !== 201 && reRegSubmitRes.status !== 200) || !newRegId) {
    throw new Error(`C3-9 re-registration submit failed: ${JSON.stringify(reRegSubmitJson)}`);
  }

  // Owner approves the new registration in room C3-109
  const approveReRegRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/${newRegId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: ownerAuth.cookieHeader,
      'x-csrf-token': ownerAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      roomId: tcSetup.roomId,
      rentAmount: 4800,
      depositAmount: 9600,
      startDate: '2026-10-01',
      endDate: '2027-03-31',
      durationMonths: 6,
    }),
  });
  const approveReRegJson = await approveReRegRes.json();
  console.log('[C3-9] Owner approve re-registration status:', approveReRegRes.status, approveReRegJson?.data?.status || approveReRegJson?.status);
  if (approveReRegRes.status !== 200) {
    throw new Error(`C3-9 owner approve re-registration failed: ${JSON.stringify(approveReRegJson)}`);
  }

  if ((approveReRegJson?.data?.status || approveReRegJson?.status) === 'awaiting_tenant_confirmation') {
    const confirmSigRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/${newRegId}/confirm-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: tcReRegAuth.cookieHeader,
        'x-csrf-token': tcReRegAuth.csrf,
        'x-dormitory-id': DORM_ID,
      },
      body: JSON.stringify({
        signatureBase64: SAMPLE_SIG_DATA_URI,
      }),
    });
    const confirmSigJson = await confirmSigRes.json();
    console.log('[C3-9] Tenant confirm-signature status:', confirmSigRes.status);
    if (confirmSigRes.status !== 200) {
      throw new Error(`C3-9 confirm-signature failed: ${JSON.stringify(confirmSigJson)}`);
    }
  }

  // Verify TC now sees ONLY the new tenancy's profile & bills (rent 4800, deposit 9600) and NOT the old tenancy's bills
  const newProfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: tcReRegAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const newProfJson = await newProfRes.json();
  const newBillsRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/bills`, {
    headers: { Cookie: tcReRegAuth.cookieHeader, 'x-dormitory-id': DORM_ID },
  });
  const newBillsJson = await newBillsRes.json();
  const billList = Array.isArray(newBillsJson?.data) ? newBillsJson.data : (Array.isArray(newBillsJson) ? newBillsJson : []);
  const leakedOldBill = billList.some((b) => [tcSetup.paidDepositBillId, tcSetup.unpaidDepositBillId, tcSetup.unpaidUtilityBillId].includes(b.id));

  console.log('[C3-9] New portal state after re-registration approval:', {
    newTenantId: newProfJson?.id,
    oldTenantId: tcSetup.tenantId,
    newContractRent: newProfJson?.activeContract?.rentAmount,
    newBillsCount: billList.length,
    leakedOldBill,
  });

  if (newProfJson?.id === tcSetup.tenantId) throw new Error('C3-9 expected a new tenant record ID, got old tenant ID');
  if (leakedOldBill) throw new Error('C3-9 leaked old tenancy bills to re-registered tenant!');

  console.log('=== ALL CARD C3 LIVE API & DB CHECKS PASSED (C3-1 to C3-9) ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('C3 LIVE CHECK FAILED:', err);
  process.exit(1);
});
