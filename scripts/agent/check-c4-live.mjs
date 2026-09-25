/**
 * Live API & Database Verification Script for Card C4 (app.hor-plus.com)
 * Verifies C4-1, C4-2, C4-3, C4-4
 */
import fs from 'fs';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { encryptText } from '../../server/dist/utils/crypto-encryption.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';
import { isAgreementEligibleForBillingCycle } from '../../server/dist/utils/calendar-date.util.js';
import { ContractService } from '../../server/dist/services/contract.service.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor
const prisma = getPrismaClient();

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

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function getTenantSessionFromEntry(rawToken) {
  const entryRes = await fetchWithRetry(`${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(rawToken)}`, {
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

async function cleanPreviousTestData(tx, roomNumber) {
  const room = await tx.room.findFirst({
    where: { dormitoryId: DORM_ID, roomNumber },
  });
  if (!room) return;

  const occupancies = await tx.occupancy.findMany({ where: { roomId: room.id } });
  const tenantIds = occupancies.map((o) => o.tenantId);

  await tx.room.update({
    where: { id: room.id },
    data: { status: 'vacant', currentTenantId: null, currentContractId: null },
  });

  // Clean move-out records & contract settlements
  await tx.contractSettlement.deleteMany({ where: { roomId: room.id } });
  const moveOutRequests = await tx.tenantMoveOutRequest.findMany({ where: { roomId: room.id } });
  const moveOutIds = moveOutRequests.map((m) => m.id);
  if (moveOutIds.length > 0) {
    await tx.moveOutSettlement.deleteMany({ where: { moveOutRequestId: { in: moveOutIds } } });
    await tx.tenantMoveOutRequest.deleteMany({ where: { id: { in: moveOutIds } } });
  }

  // Clean bills
  const bills = await tx.bill.findMany({ where: { roomId: room.id } });
  const billIds = bills.map((b) => b.id);
  if (billIds.length > 0) {
    await tx.paymentUploadIntent.deleteMany({ where: { billId: { in: billIds } } });
    await tx.receipt.deleteMany({ where: { billId: { in: billIds } } });
    await tx.billItem.deleteMany({ where: { billId: { in: billIds } } });
    await tx.payment.deleteMany({ where: { billId: { in: billIds } } });
    await tx.bill.deleteMany({ where: { id: { in: billIds } } });
  }

  // Clean contracts & occupancies
  await tx.occupancy.deleteMany({ where: { roomId: room.id } });
  await tx.contract.deleteMany({ where: { roomId: room.id } });

  // Clean tenants
  if (tenantIds.length > 0) {
    await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  }
}

async function main() {
  console.log('=== Starting Card C4 Live Verification on https://app.hor-plus.com ===');

  const ownerAuth = getCredentials('Owner');

  // Setup dedicated Room C4-104 & Tenant TD
  let setupData = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    await cleanPreviousTestData(tx, 'C4-104');

    const building = await tx.building.findFirst({ where: { dormitoryId: DORM_ID } });
    let testRoom = await tx.room.findFirst({
      where: { dormitoryId: DORM_ID, roomNumber: 'C4-104' },
    });
    if (!testRoom) {
      const sampleRoom = await tx.room.findFirst({ where: { dormitoryId: DORM_ID } });
      testRoom = await tx.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: building.id,
          roomNumber: 'C4-104',
          normalizedRoomNumber: 'C4-104',
          floor: 1,
          roomType: sampleRoom?.roomType || 'standard',
          monthlyRent: 4500,
          termDeposit: 9000,
          monthlyDeposit: sampleRoom?.monthlyDeposit ?? 4500,
          dailyRent: sampleRoom?.dailyRent ?? 500,
          dailyDeposit: sampleRoom?.dailyDeposit ?? 500,
          status: 'vacant',
        },
      });
    }

    // Create Tenant TD with dormitoryLineFriend and linked user
    const lineUserId = `U_c4_expired_${Date.now()}`;
    const lineUserIdHash = crypto.createHash('sha256').update(lineUserId).digest('hex');
    const lineFriend = await tx.dormitoryLineFriend.create({
      data: {
        dormitoryId: DORM_ID,
        lineUserIdHash,
        lineUserIdEncrypted: encryptText(lineUserId),
        displayName: 'ธนินทร์ สัญญาหมดอายุ',
        friendStatus: 'FOLLOWING',
      },
    });

    const tdEmail = `td.c4.${Date.now()}@horplus.local`;
    const tdUser = await tx.user.create({
      data: {
        googleSubject: `gsub_c4_${Date.now()}`,
        email: tdEmail,
        emailNormalized: tdEmail,
        name: 'ธนินทร์ สัญญาหมดอายุ',
        phone: '0894445555',
      },
    });

    const tenant = await tx.tenant.create({
      data: {
        dormitoryId: DORM_ID,
        tenantNumber: `TN-C4-${Date.now().toString().slice(-4)}`,
        firstName: 'ธนินทร์',
        lastName: 'สัญญาหมดอายุ',
        displayName: 'ธนินทร์ สัญญาหมดอายุ',
        phone: '0894445555',
        status: 'active',
        linkedUserId: tdUser.id,
        lineFriendId: lineFriend.id,
      },
    });

    // Create an expired Contract (ended 2026-08-31)
    const startDate = new Date('2026-03-01T00:00:00.000Z');
    const endDate = new Date('2026-08-31T23:59:59.000Z');

    const contract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        contractNumber: `CTR-C4-${Date.now().toString().slice(-5)}`,
        roomId: testRoom.id,
        tenantId: tenant.id,
        startDate,
        endDate,
        durationMonths: 6,
        rentBillingType: 'monthly',
        rentAmount: 4500,
        depositAmount: 9000,
        status: 'expired',
      },
    });

    // Create active occupancy (PO-12: contract expiration does NOT auto-vacate or end occupancy)
    const occupancy = await tx.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: tenant.id,
        contractId: contract.id,
        startedAt: startDate,
        status: 'ACTIVE',
      },
    });

    // Update room status to occupied
    await tx.room.update({
      where: { id: testRoom.id },
      data: {
        status: 'occupied',
        currentTenantId: tenant.id,
        currentContractId: contract.id,
      },
    });

    // Create invite
    const inviteService = new TenantRegistrationInviteService(tx);
    const tdInvite = await inviteService.createInvite(DORM_ID, lineFriend.id);

    // Find BillingCycle and create Unpaid Bill for this room
    const cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { periodStart: 'desc' },
    });

    const bill = await tx.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle.id,
        roomId: testRoom.id,
        tenantId: tenant.id,
        contractId: contract.id,
        billNumber: `INV-C4-${Date.now().toString().slice(-5)}`,
        billKind: 'RENT',
        billingDate: new Date('2026-08-01T00:00:00.000Z'),
        dueDate: new Date('2026-08-05T00:00:00.000Z'),
        subtotal: '4500',
        totalAmount: '4500',
        outstandingAmount: '4500',
        paidAmount: '0',
        status: 'unpaid',
      },
    });

    await tx.billItem.create({
      data: {
        dormitoryId: DORM_ID,
        billId: bill.id,
        type: 'RENT',
        description: 'ค่าเช่าห้อง C4-104 เดือน ส.ค. 2569',
        amount: '4500',
        quantity: 1,
        unitPrice: '4500',
      },
    });

    setupData = {
      room: testRoom,
      tenant,
      contract,
      occupancy,
      rawToken: tdInvite.rawToken,
      bill,
      cycle,
      lineFriendId: lineFriend.id,
    };
  });

  console.log(`[Setup] Room: ${setupData.room.roomNumber} (${setupData.room.id})`);
  console.log(`[Setup] Tenant: ${setupData.tenant.name || setupData.tenant.displayName} (${setupData.tenant.id})`);
  console.log(`[Setup] Contract: ${setupData.contract.id}, status: ${setupData.contract.status}, endDate: ${setupData.contract.endDate.toISOString()}`);
  console.log(`[Setup] Bill: ${setupData.bill.id}, amount: ${setupData.bill.totalAmount}`);

  const tenantAuth = await getTenantSessionFromEntry(setupData.rawToken);
  console.log('[Setup] Tenant session authenticated successfully via line-tenant-entry');

  let passedACs = 0;

  // ==========================================
  // AC C4-1: Expired contract billing exclusion & no auto-vacate (PO-12)
  // ==========================================
  console.log('\n--- Checking AC C4-1: Billing exclusion & Tenancy intact ---');
  // 1. Check agreement eligibility for cycle starting on/after endDate
  const isSeptEligible = isAgreementEligibleForBillingCycle({
    agreementStartDate: setupData.contract.startDate,
    agreementEndDate: setupData.contract.endDate,
    cyclePeriodStart: '2026-09-01',
    cyclePeriodEnd: '2026-09-30',
  });
  const isOctEligible = isAgreementEligibleForBillingCycle({
    agreementStartDate: setupData.contract.startDate,
    agreementEndDate: setupData.contract.endDate,
    cyclePeriodStart: '2026-10-01',
    cyclePeriodEnd: '2026-10-31',
  });
  console.log(`[C4-1] isSeptEligible: ${isSeptEligible} (expected: false)`);
  console.log(`[C4-1] isOctEligible: ${isOctEligible} (expected: false)`);

  if (isSeptEligible || isOctEligible) {
    throw new Error('AC C4-1 FAIL: Expired contract must NOT be eligible for cycles on/after endDate');
  }

  // 2. Run reconcileExpiredContracts and verify occupancy and room stay occupied
  const contractService = new ContractService({}, {}, {});
  await contractService.reconcileExpiredContracts();

  const refreshedOccupancy = await prisma.occupancy.findUnique({
    where: { id: setupData.occupancy.id },
  });
  const refreshedRoom = await prisma.room.findUnique({
    where: { id: setupData.room.id },
  });
  const refreshedContract = await prisma.contract.findUnique({
    where: { id: setupData.contract.id },
  });

  console.log(`[C4-1] Occupancy status: ${refreshedOccupancy.status} (expected: ACTIVE)`);
  console.log(`[C4-1] Room status: ${refreshedRoom.status} (expected: occupied)`);
  console.log(`[C4-1] Contract status: ${refreshedContract.status} (expected: expired)`);

  if (refreshedOccupancy.status !== 'ACTIVE' || refreshedRoom.status !== 'occupied') {
    throw new Error('AC C4-1 FAIL: Contract expiration must NOT auto-vacate room or end occupancy (PO-12 violation)');
  }
  console.log('✓ AC C4-1 PASS: Billing cycle excludes expired contract, occupancy remains ACTIVE, room remains occupied.');
  passedACs++;

  // ==========================================
  // AC C4-2: Owner portal shows Expired badge
  // ==========================================
  console.log('\n--- Checking AC C4-2: Owner Expired Status Badge ---');
  // Check via Owner API: GET /api/v1/contracts
  const ownerContractsRes = await fetch(`${BASE_URL}/api/v1/contracts?roomId=${setupData.room.id}`, {
    headers: {
      cookie: ownerAuth.cookieHeader,
    },
  });
  if (!ownerContractsRes.ok) {
    throw new Error(`AC C4-2 FAIL: Owner contracts endpoint returned ${ownerContractsRes.status}`);
  }
  const ownerContractsData = await ownerContractsRes.json();
  const contractsList = ownerContractsData.data || ownerContractsData.items || [];
  const foundContract = contractsList.find((c) => c.id === setupData.contract.id);
  console.log(`[C4-2] Found contract in Owner contracts list: ${foundContract?.contractNumber}, status: ${foundContract?.status}, endDate: ${foundContract?.endDate}`);

  if (!foundContract) {
    throw new Error('AC C4-2 FAIL: Expired contract not found in owner contracts list');
  }

  if (foundContract.status !== 'expired' && new Date(foundContract.endDate) >= new Date()) {
    throw new Error('AC C4-2 FAIL: Contract status must reflect expired in owner view');
  }
  console.log('✓ AC C4-2 PASS: Owner API returns expired contract for room C4-104.');
  passedACs++;

  // ==========================================
  // AC C4-3: Tenant portal accessible with expired banner, unpaid bills visible
  // ==========================================
  console.log('\n--- Checking AC C4-3: Tenant Portal Access & Expired Banner ---');
  // 1. Tenant rooms endpoint
  const tenantRoomsRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/rooms`, {
    headers: {
      cookie: tenantAuth.cookieHeader,
    },
  });
  if (!tenantRoomsRes.ok) {
    throw new Error(`AC C4-3 FAIL: Tenant rooms endpoint returned ${tenantRoomsRes.status}`);
  }
  const tenantRoomsData = await tenantRoomsRes.json();
  console.log(`[C4-3] Tenant rooms: ${JSON.stringify(tenantRoomsData.rooms?.map((r) => ({ number: r.roomNumber, status: r.status, contractId: r.contractId })))}`);
  const roomC4 = tenantRoomsData.rooms?.find((r) => r.roomNumber === 'C4-104');
  if (!roomC4) {
    throw new Error('AC C4-3 FAIL: Room C4-104 not returned in tenant portal rooms list');
  }
  if (roomC4.status !== 'expired') {
    throw new Error(`AC C4-3 FAIL: Contract status in tenant room should be 'expired', got '${roomC4.status}'`);
  }

  // 2. Tenant bills endpoint
  const tenantBillsRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/bills`, {
    headers: {
      cookie: tenantAuth.cookieHeader,
    },
  });
  if (!tenantBillsRes.ok) {
    throw new Error(`AC C4-3 FAIL: Tenant bills endpoint returned ${tenantBillsRes.status}`);
  }
  const tenantBillsData = await tenantBillsRes.json();
  const billsList = tenantBillsData.bills || tenantBillsData.data || [];
  console.log(`[C4-3] Tenant visible bills count: ${billsList.length}`);
  const unpaidBill = billsList.find((b) => b.id === setupData.bill.id);
  if (!unpaidBill) {
    throw new Error('AC C4-3 FAIL: Unpaid bill for expired contract must remain visible in tenant portal');
  }
  console.log(`[C4-3] Unpaid bill ID: ${unpaidBill.id}, status: ${unpaidBill.status}, amount: ${unpaidBill.totalAmount}`);

  // 3. Tenant contract detail
  const tenantContractRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract`, {
    headers: {
      cookie: tenantAuth.cookieHeader,
    },
  });
  if (!tenantContractRes.ok) {
    throw new Error(`AC C4-3 FAIL: Tenant contract endpoint returned ${tenantContractRes.status}`);
  }
  const tenantContractData = await tenantContractRes.json();
  const contractObj = tenantContractData.data;
  if (!contractObj || contractObj.id !== setupData.contract.id) {
    throw new Error('AC C4-3 FAIL: Expired contract must be returned in tenant contract endpoint');
  }
  console.log(`[C4-3] Contract status: ${contractObj.status}, endDate: ${contractObj.endDate}, isExpired: ${new Date(contractObj.endDate) < new Date()}`);

  console.log('✓ AC C4-3 PASS: Tenant portal fully accessible, shows expired contract and unpaid bill.');
  passedACs++;

  // ==========================================
  // AC C4-4: Owner Move-Out Final Settlement on Expired Contract
  // ==========================================
  console.log('\n--- Checking AC C4-4: Owner Move-Out Settlement on Expired Contract ---');
  // 1. Tenant with expired contract submits move-out request
  const submitRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tenantAuth.cookieHeader,
      'x-csrf-token': tenantAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      intendedMoveOutDate: '2026-09-30',
      reason: 'สัญญาหมดอายุแล้ว ยื่นแจ้งย้ายออก',
      bankName: 'KBANK',
      bankAccountNumber: '1234567890',
      bankAccountHolder: 'ธนินทร์ สัญญาหมดอายุ',
    }),
  });
  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`AC C4-4 FAIL: Tenant submit move-out returned ${submitRes.status}: ${errText}`);
  }
  const submitJson = await submitRes.json();
  const moveOutRequestId = submitJson?.data?.id;
  console.log(`[C4-4] Move-out request created: ${moveOutRequestId}`);

  // 2. Owner confirms move-out & final settlement
  const ownerConfirmRes = await fetch(`${BASE_URL}/api/v1/tenant-move-out-requests/${moveOutRequestId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: ownerAuth.cookieHeader,
      'x-csrf-token': ownerAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      actualEndedAt: '2026-09-30',
      reason: 'ยืนยันย้ายออกสัญญาหมดอายุ',
    }),
  });
  if (!ownerConfirmRes.ok) {
    const confirmErr = await ownerConfirmRes.text();
    throw new Error(`AC C4-4 FAIL: Owner confirm move-out returned ${ownerConfirmRes.status}: ${confirmErr}`);
  }
  const confirmJson = await ownerConfirmRes.json();
  console.log(`[C4-4] Owner confirmed move-out: receipt=${confirmJson?.data?.finalReceipt?.receiptNumber}, netSettlement=${confirmJson?.data?.settlement?.netSettlement}`);

  // 3. Verify in DB: contract checked_out, room vacant, occupancy ENDED, tenant former
  const finalRoom = await prisma.room.findUnique({ where: { id: setupData.room.id } });
  const finalContract = await prisma.contract.findUnique({ where: { id: setupData.contract.id } });
  const finalOccupancy = await prisma.occupancy.findUnique({ where: { id: setupData.occupancy.id } });
  const finalTenant = await prisma.tenant.findUnique({ where: { id: setupData.tenant.id } });

  console.log(`[C4-4] Final Room status: ${finalRoom.status} (expected: vacant)`);
  console.log(`[C4-4] Final Contract status: ${finalContract.status} (expected: checked_out)`);
  console.log(`[C4-4] Final Occupancy status: ${finalOccupancy.status} (expected: ENDED)`);
  console.log(`[C4-4] Final Tenant status: ${finalTenant.status} (expected: former)`);

  if (finalRoom.status !== 'vacant') {
    throw new Error(`AC C4-4 FAIL: Room status should be 'vacant', got '${finalRoom.status}'`);
  }
  if (finalContract.status !== 'checked_out') {
    throw new Error(`AC C4-4 FAIL: Contract status should be 'checked_out', got '${finalContract.status}'`);
  }
  if (finalOccupancy.status !== 'ENDED') {
    throw new Error(`AC C4-4 FAIL: Occupancy status should be 'ENDED', got '${finalOccupancy.status}'`);
  }
  if (finalTenant.status !== 'former' || finalTenant.linkedUserId !== null) {
    throw new Error(`AC C4-4 FAIL: Tenant status should be 'former' and linkedUserId null, got '${finalTenant.status}'`);
  }
  console.log('✓ AC C4-4 PASS: Move-out finalized on expired contract, room vacated, access revoked.');
  passedACs++;

  console.log(`\n=== All ${passedACs}/4 Acceptance Criteria for Card C4 PASSED LIVE ===`);
}

main()
  .catch((e) => {
    console.error('FAILED:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
