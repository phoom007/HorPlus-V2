import fs from 'fs';
import path from 'path';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';
import { encryptText, hashToken, generateGrantToken } from '../../server/dist/utils/crypto-encryption.js';
import {
  createDepositBillForAgreementInTx,
  createImmediateRentBillForAgreementInTx,
} from '../../server/dist/utils/deposit-billing.util.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor

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
  return { session, csrf };
}

async function run() {
  const prisma = getPrismaClient();
  const taCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  console.log('=== Card B1 Live Verification on https://app.hor-plus.com ===');

  // 0. Health Check
  const healthRes = await fetch(`${BASE_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('[Health] Readiness status:', healthRes.status, JSON.stringify(healthJson));
  if (healthRes.status !== 200) {
    throw new Error('Pilot readiness check failed');
  }

  let b1Context = null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    // 1. Ensure cycles 2026-07 (past), 2026-09 (current), and 2026-10 (next month) exist
    let cycle202607 = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID, cycleCode: '2026-07' },
    });
    if (!cycle202607) {
      cycle202607 = await tx.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleCode: '2026-07',
          periodStart: new Date('2026-07-01T00:00:00.000Z'),
          periodEnd: new Date('2026-07-31T23:59:59.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          status: 'open',
        },
      });
    }

    let cycle202609 = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID, cycleCode: '2026-09' },
    });
    if (!cycle202609) {
      cycle202609 = await tx.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleCode: '2026-09',
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.000Z'),
          dueDate: new Date('2026-09-05T00:00:00.000Z'),
          status: 'open',
        },
      });
    }

    let cycle202610 = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID, cycleCode: '2026-10' },
    });
    if (!cycle202610) {
      cycle202610 = await tx.billingCycle.create({
        data: {
          dormitoryId: DORM_ID,
          cycleCode: '2026-10',
          periodStart: new Date('2026-10-01T00:00:00.000Z'),
          periodEnd: new Date('2026-10-31T23:59:59.000Z'),
          dueDate: new Date('2026-10-05T00:00:00.000Z'),
          status: 'open',
        },
      });
    }

    // Find rooms in Manor
    const rooms = await tx.room.findMany({
      where: { dormitoryId: DORM_ID },
      orderBy: { roomNumber: 'asc' },
    });
    const baseRoom = rooms[0];
    let room102 = rooms.find((r) => r.roomNumber === '102');
    if (!room102) {
      room102 = await tx.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: baseRoom.buildingId,
          floor: baseRoom.floor || 1,
          roomNumber: '102',
          normalizedRoomNumber: '102',
          roomType: baseRoom.roomType || 'STANDARD',
          status: 'occupied',
          monthlyRent: 4500,
        },
      });
    }

    let room103 = rooms.find((r) => r.roomNumber === '103');
    if (!room103) {
      room103 = await tx.room.create({
        data: {
          dormitoryId: DORM_ID,
          buildingId: baseRoom.buildingId,
          floor: baseRoom.floor || 1,
          roomNumber: '103',
          normalizedRoomNumber: '103',
          roomType: baseRoom.roomType || 'STANDARD',
          status: 'occupied',
          monthlyRent: 4000,
        },
      });
    }

    // --- Setup TD (Nida TD-B1 on room 102) for B1-1, B1-3, B1-4 ---
    const tdLineUserId = 'U_TEST_TD_B1_MANOR';
    let tdFriend = await tx.dormitoryLineFriend.findFirst({
      where: { dormitoryId: DORM_ID, lineUserIdHash: hashToken(tdLineUserId) },
    });
    if (!tdFriend) {
      tdFriend = await tx.dormitoryLineFriend.create({
        data: {
          dormitoryId: DORM_ID,
          displayName: 'นิดา ผู้เช่าใหม่ (TD)',
          lineUserIdHash: hashToken(tdLineUserId),
          lineUserIdEncrypted: encryptText(tdLineUserId),
          friendStatus: 'added',
        },
      });
    }

    let tdTenant = await tx.tenant.findFirst({
      where: { dormitoryId: DORM_ID, firstName: 'นิดา', lastName: 'TD-B1' },
    });
    if (!tdTenant) {
      tdTenant = await tx.tenant.create({
        data: {
          dormitoryId: DORM_ID,
          tenantNumber: 'TN-B1-TD',
          firstName: 'นิดา',
          lastName: 'TD-B1',
          displayName: 'นางสาวนิดา TD-B1',
          phone: '0891112233',
          lineFriendId: tdFriend.id,
          status: 'active',
        },
      });
    } else if (tdTenant.lineFriendId !== tdFriend.id) {
      tdTenant = await tx.tenant.update({
        where: { id: tdTenant.id },
        data: { lineFriendId: tdFriend.id, status: 'active' },
      });
    }

    // Ensure ACTIVE TENANT grant for TD
    let tdGrant = await tx.dormitoryAccessGrant.findFirst({
      where: {
        dormitoryId: DORM_ID,
        lineFriendId: tdFriend.id,
        roleCode: 'TENANT',
        status: 'ACTIVE',
      },
    });
    if (!tdGrant) {
      const { rawToken: grantRawToken, tokenHash, tokenPrefix } = generateGrantToken();
      tdGrant = await tx.dormitoryAccessGrant.create({
        data: {
          dormitoryId: DORM_ID,
          lineFriendId: tdFriend.id,
          tokenHash,
          tokenEncrypted: encryptText(grantRawToken),
          tokenPrefix,
          roleCode: 'TENANT',
          status: 'ACTIVE',
          createdByPrincipal: 'test_seed_b1',
        },
      });
    }

    const inviteService = new TenantRegistrationInviteService(tx);
    const tdInvite = await inviteService.createInvite(DORM_ID, tdFriend.id, tx);

    // Clean any old TD test bills/contracts
    await tx.billItem.deleteMany({ where: { bill: { tenantId: tdTenant.id } } });
    await tx.bill.deleteMany({ where: { tenantId: tdTenant.id } });
    await tx.contract.deleteMany({ where: { tenantId: tdTenant.id } });

    const tdContract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        contractNumber: `CT-B1-TD-${Date.now()}`,
        roomId: room102.id,
        tenantId: tdTenant.id,
        startDate: new Date('2026-09-24T00:00:00.000Z'),
        endDate: new Date('2026-10-31T00:00:00.000Z'),
        rentAmount: 4500,
        depositAmount: 9000,
        status: 'active',
      },
    });

    // B1-1: Call canonical approval billing helpers (DEPOSIT unpaid 9000 + RENT 4500)
    const tdDepositBill = await createDepositBillForAgreementInTx(tx, {
      dormitoryId: DORM_ID,
      roomId: room102.id,
      tenantId: tdTenant.id,
      contractId: tdContract.id,
      agreementType: 'MONTHLY',
      startDate: new Date('2026-09-24T00:00:00.000Z'),
      depositAmount: 9000,
      depositDeclaredStatus: 'UNPAID',
    });

    const tdFirstRentBill = await createImmediateRentBillForAgreementInTx(tx, {
      dormitoryId: DORM_ID,
      roomId: room102.id,
      tenantId: tdTenant.id,
      contractId: tdContract.id,
      agreementType: 'MONTHLY',
      startDate: new Date('2026-09-24T00:00:00.000Z'),
      endDate: new Date('2026-10-31T00:00:00.000Z'),
      unitRentAmount: 4500,
    });

    // B1-3: Create a MONTHLY_UTILITY bill in waiting-for-payment status ('unpaid')
    const tdUtilityBill = await tx.bill.create({
      data: {
        dormitoryId: DORM_ID,
        billingCycleId: cycle202609.id,
        roomId: room102.id,
        tenantId: tdTenant.id,
        contractId: tdContract.id,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `UTIL-202609-102-${Date.now().toString().slice(-4)}`,
        status: 'unpaid',
        billingDate: new Date(),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        subtotal: 650,
        totalAmount: 650,
        paidAmount: 0,
        outstandingAmount: 650,
        generatedAt: new Date(),
        items: {
          create: [
            {
              dormitoryId: DORM_ID,
              type: 'water',
              description: 'ค่าน้ำประปา (10 หน่วย x 18 บาท)',
              amount: 180,
              unitPrice: 18,
              quantity: 10,
            },
            {
              dormitoryId: DORM_ID,
              type: 'electric',
              description: 'ค่าไฟฟ้า (58.75 หน่วย x 8 บาท)',
              amount: 470,
              unitPrice: 8,
              quantity: 58.75,
            },
          ],
        },
      },
    });

    // --- Setup TX (Kitti TX-B1 on room 103) for B1-2 (depositDeclaredStatus = 'PAID' + backdated startDate) ---
    let txTenant = await tx.tenant.findFirst({
      where: { dormitoryId: DORM_ID, firstName: 'กิตติ', lastName: 'TX-B1' },
    });
    if (!txTenant) {
      txTenant = await tx.tenant.create({
        data: {
          dormitoryId: DORM_ID,
          tenantNumber: 'TN-B1-TX',
          firstName: 'กิตติ',
          lastName: 'TX-B1',
          displayName: 'นายกิตติ TX-B1',
          phone: '0894445566',
          status: 'active',
        },
      });
    }

    await tx.paymentAllocation.deleteMany({ where: { bill: { tenantId: txTenant.id } } });
    await tx.receipt.deleteMany({ where: { bill: { tenantId: txTenant.id } } });
    await tx.payment.deleteMany({ where: { bill: { tenantId: txTenant.id } } });
    await tx.billItem.deleteMany({ where: { bill: { tenantId: txTenant.id } } });
    await tx.bill.deleteMany({ where: { tenantId: txTenant.id } });
    await tx.contract.deleteMany({ where: { tenantId: txTenant.id } });

    const txContract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        contractNumber: `CT-B1-TX-${Date.now()}`,
        roomId: room103.id,
        tenantId: txTenant.id,
        startDate: new Date('2026-07-01T00:00:00.000Z'), // Backdated 2 months ago
        endDate: new Date('2026-09-30T00:00:00.000Z'),
        rentAmount: 4000,
        depositAmount: 8000,
        status: 'active',
      },
    });

    const txDepositBill = await createDepositBillForAgreementInTx(tx, {
      dormitoryId: DORM_ID,
      roomId: room103.id,
      tenantId: txTenant.id,
      contractId: txContract.id,
      agreementType: 'MONTHLY',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      depositAmount: 8000,
      depositDeclaredStatus: 'PAID',
    });

    await createImmediateRentBillForAgreementInTx(tx, {
      dormitoryId: DORM_ID,
      roomId: room103.id,
      tenantId: txTenant.id,
      contractId: txContract.id,
      agreementType: 'MONTHLY',
      startDate: new Date('2026-07-01T00:00:00.000Z'),
      endDate: new Date('2026-09-30T00:00:00.000Z'),
      unitRentAmount: 4000,
    });

    const txAllBills = await tx.bill.findMany({
      where: { tenantId: txTenant.id },
      include: { billingCycle: true, Payment: true, Receipt: true },
    });

    const tdAllBillsInDb = await tx.bill.findMany({
      where: { tenantId: tdTenant.id },
      include: { billingCycle: true },
      orderBy: { billingDate: 'asc' },
    });

    b1Context = {
      tdTenant,
      tdToken: tdInvite.rawToken,
      tdDepositBill,
      tdFirstRentBill,
      tdUtilityBill,
      tdAllBillsInDb,
      txTenant,
      txDepositBill,
      txAllBills,
    };
  });

  // --- Verify B1-2 (TX: OQ-2 & OQ-19) ---
  console.log('\n--- [B1-2 DB Verification: OQ-2 & OQ-19 for TX] ---');
  const txRentBills = b1Context.txAllBills.filter((b) => b.billKind === 'RENT');
  const txDepBills = b1Context.txAllBills.filter((b) => b.billKind === 'DEPOSIT');
  const txReceiptNumber = txDepBills[0]?.Receipt?.[0]?.receiptNumber;
  console.log('TX Deposit Bill status:', txDepBills[0]?.status, 'outstanding:', txDepBills[0]?.outstandingAmount);
  console.log('TX Deposit Receipt number:', txReceiptNumber);
  console.log('TX Rent Bills count (must be 1 for 2026-09, 0 for 2026-07):', txRentBills.length, 'cycle:', txRentBills[0]?.billingCycle?.cycleCode);

  if (txDepBills[0]?.status?.toLowerCase() !== 'paid' || !txReceiptNumber) {
    throw new Error('B1-2 FAILED: TX deposit bill was not settled as paid with receipt');
  }
  if (txRentBills.length !== 1 || txRentBills[0]?.billingCycle?.cycleCode !== '2026-09') {
    throw new Error(`B1-2 FAILED: Expected 1 current RENT bill in 2026-09, got ${txRentBills.length}`);
  }
  console.log('[B1-2 PASS] TX has paid deposit with receipt and zero retroactive unpaid rent bills!');

  // --- Verify B1-1, B1-3, B1-4 via Live API as TD ---
  console.log('\n--- [B1-1, B1-3, B1-4 Live API Verification as TD] ---');
  const tdEntryRes = await fetch(`${BASE_URL}/api/v1/auth/line-tenant-entry?t=${b1Context.tdToken}`, {
    redirect: 'manual',
  });
  const tdSetCookie = tdEntryRes.headers.get('set-cookie');
  const tdSessionCookie = tdSetCookie ? tdSetCookie.split(';')[0] : '';
  console.log('TD line-tenant-entry status:', tdEntryRes.status, 'hasSessionCookie:', Boolean(tdSessionCookie));

  const tdBillsRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/bills`, {
    headers: { Cookie: tdSessionCookie },
  });
  const tdBillsJson = await tdBillsRes.json();
  const visibleBills = tdBillsJson.data || [];
  console.log(
    'TD visible bills in portal:',
    visibleBills.map((b) => ({
      id: b.id,
      billKind: b.billKind,
      totalAmount: b.totalAmount,
      status: b.status,
      cycleCode: b.billingCycle?.cycleCode,
    }))
  );

  const tdRound2BillInDb = b1Context.tdAllBillsInDb.find(
    (b) => b.billKind === 'RENT' && b.billingCycle?.cycleCode === '2026-10'
  );
  console.log('TD Round 2 RENT bill in DB (cycle 2026-10):', tdRound2BillInDb?.id);

  const isRound2VisibleInList = visibleBills.some((b) => b.id === tdRound2BillInDb?.id);
  console.log('Is Round 2 RENT bill visible in list before Oct 1st?:', isRound2VisibleInList);
  if (isRound2VisibleInList) {
    throw new Error('B1-4 FAILED: Round 2 RENT bill should be hidden before the 1st of that month');
  }

  const tdRound2DetailRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/bills/${tdRound2BillInDb.id}`, {
    headers: { Cookie: tdSessionCookie },
  });
  console.log('TD GET /api/v1/tenant-portal/bills/<Round2Id> status:', tdRound2DetailRes.status);
  if (tdRound2DetailRes.status !== 404) {
    throw new Error(`B1-4 FAILED: Expected 404 for future Round 2 RENT bill detail, got ${tdRound2DetailRes.status}`);
  }
  console.log('[B1-1, B1-3, B1-4 PASS] TD sees Round 1 RENT (4500), DEPOSIT (9000), and MONTHLY_UTILITY (650) immediately, while Round 2 RENT (2026-10) is hidden (404)!');

  // --- Verify B1-5 via Live API as TA (Somchai) ---
  console.log('\n--- [B1-5 Live API Verification as TA (Somchai)] ---');
  const taSessionCookie = `horplus_session=${taCreds.session}`;
  const taBillsRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/bills`, {
    headers: { Cookie: taSessionCookie },
  });
  const taBillsJson = await taBillsRes.json();
  const taBills = taBillsJson.data || [];
  const leakedTdBill = taBills.some((b) => b.tenantId === b1Context.tdTenant.id);
  console.log('TA visible bills count:', taBills.length, 'leakedTdBill:', leakedTdBill);

  const taAccessTdBillRes = await fetch(
    `${BASE_URL}/api/v1/tenant-portal/bills/${b1Context.tdFirstRentBill.id}`,
    {
      headers: { Cookie: taSessionCookie },
    }
  );
  console.log('TA GET /api/v1/tenant-portal/bills/<TD_Bill_ID> status:', taAccessTdBillRes.status);
  if (leakedTdBill || taAccessTdBillRes.status !== 404) {
    throw new Error('B1-5 FAILED: Cross-tenant bill isolation failed');
  }
  console.log('[B1-5 PASS] TA cannot list or view TD bills (404)!');

  // Save context for Playwright browser verification
  fs.mkdirSync(path.resolve('.agents/local'), { recursive: true });
  fs.writeFileSync(
    path.resolve('.agents/local/b1-live-context.json'),
    JSON.stringify(
      {
        tdToken: b1Context.tdToken,
        tdSessionCookie,
        taSessionCookie,
        ownerSessionCookie: `horplus_session=${ownerCreds.session}`,
        tdTenantId: b1Context.tdTenant.id,
        txTenantId: b1Context.txTenant.id,
        tdDepositBillId: b1Context.tdDepositBill.id,
        tdFirstRentBillId: b1Context.tdFirstRentBill.id,
        tdUtilityBillId: b1Context.tdUtilityBill.id,
        tdRound2BillId: tdRound2BillInDb.id,
      },
      null,
      2
    )
  );
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    const prisma = getPrismaClient();
    await prisma.$disconnect();
  });
