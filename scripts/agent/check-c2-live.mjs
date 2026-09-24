import fs from 'fs';
import { PNG } from '../../server/node_modules/pngjs/lib/png.js';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor

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
  return { session, csrf };
}

async function run() {
  const prisma = getPrismaClient();
  const taCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  console.log('=== Card C2 Live API & DB Verification on https://app.hor-plus.com ===');

  const healthRes = await fetch(`${BASE_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('[Health] Readiness:', healthRes.status, JSON.stringify(healthJson));
  if (healthRes.status !== 200) throw new Error('Pilot readiness check failed');

  // Resolve TA tenantId
  const taProfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const taProf = await taProfRes.json();
  const taTenantId = taProf.id;

  let tcSetup = null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    // Find TC (another active tenant in Manor with lineFriend)
    const tcTenant = await tx.tenant.findFirst({
      where: {
        dormitoryId: DORM_ID,
        id: { not: taTenantId },
        status: 'active',
        lineFriendId: { not: null },
        deletedAt: null,
      },
      include: { lineFriend: true },
    });
    if (!tcTenant || !tcTenant.lineFriend) {
      throw new Error('Could not find active tenant TC with lineFriend');
    }

    // Find or assign a room for TC
    let tcRoom = await tx.room.findFirst({
      where: { dormitoryId: DORM_ID, currentTenantId: tcTenant.id, deletedAt: null },
    });
    if (!tcRoom) {
      tcRoom = await tx.room.findFirst({
        where: { dormitoryId: DORM_ID, roomNumber: '102', deletedAt: null },
      });
    }
    if (!tcRoom) {
      throw new Error('Could not find room for TC');
    }

    // Clean any pending/existing test renewal requests for TC and close old contracts on tcRoom so TC has 1 clean active initial contract
    await tx.tenantRenewalRequest.deleteMany({
      where: { dormitoryId: DORM_ID, tenantId: tcTenant.id },
    });
    await tx.occupancy.updateMany({
      where: { dormitoryId: DORM_ID, roomId: tcRoom.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await tx.contract.updateMany({
      where: { dormitoryId: DORM_ID, tenantId: tcTenant.id, status: { in: ['active', 'approved_scheduled'] } },
      data: { status: 'expired' },
    });

    const initialContract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        tenantId: tcTenant.id,
        roomId: tcRoom.id,
        contractNumber: `CT-INIT-${tcRoom.roomNumber}-${Date.now().toString().slice(-6)}`,
        status: 'active',
        startDate: new Date('2026-07-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T00:00:00.000Z'),
        durationMonths: 6,
        rentBillingType: 'monthly',
        rentAmount: '4200',
        depositAmount: '8400',
        advancePaymentAmount: '0',
        terms: '1. ชำระค่าเช่าภายในวันที่ 5 ของทุกเดือน',
        tenantSignature: SAMPLE_SIG_DATA_URI,
        ownerSignature: SAMPLE_SIG_DATA_URI,
        signedByTenantAt: new Date('2026-07-01T09:00:00.000Z'),
        signedByOwnerAt: new Date('2026-07-01T09:30:00.000Z'),
      },
    });

    await tx.room.update({
      where: { id: tcRoom.id },
      data: {
        status: 'occupied',
        currentTenantId: tcTenant.id,
        currentContractId: initialContract.id,
      },
    });

    await tx.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: tcRoom.id,
        tenantId: tcTenant.id,
        contractId: initialContract.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    });

    // Ensure TC has exactly 1 DEPOSIT bill on the initial contract
    await tx.bill.deleteMany({
      where: { dormitoryId: DORM_ID, tenantId: tcTenant.id, billKind: 'DEPOSIT' },
    });
    const cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { periodStart: 'desc' },
    });
    if (cycle) {
      await tx.bill.create({
        data: {
          dormitoryId: DORM_ID,
          billingCycleId: cycle.id,
          roomId: tcRoom.id,
          tenantId: tcTenant.id,
          contractId: initialContract.id,
          billNumber: `DEP-TC-${Date.now().toString().slice(-6)}`,
          billKind: 'DEPOSIT',
          status: 'PAID',
          billingDate: new Date('2026-07-01T00:00:00.000Z'),
          dueDate: new Date('2026-07-05T00:00:00.000Z'),
          subtotal: '8400',
          totalAmount: '8400',
          paidAmount: '8400',
          outstandingAmount: '0',
        },
      });
    }

    const { TenantRegistrationInviteService } = await import(
      '../../server/dist/services/tenant-registration-invite.service.js'
    );
    const inviteService = new TenantRegistrationInviteService(tx);
    const tcInvite = await inviteService.createInvite(DORM_ID, tcTenant.lineFriend.id);

    tcSetup = {
      tenantId: tcTenant.id,
      roomId: tcRoom.id,
      roomNumber: tcRoom.roomNumber,
      initialContractId: initialContract.id,
      rawToken: tcInvite.rawToken,
    };
  });

  // Mint TC session cookie + CSRF token via line-tenant-entry
  const entryRes = await fetch(
    `${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(tcSetup.rawToken)}`,
    { redirect: 'manual' }
  );
  let tcSession = '';
  let tcCsrf = '';
  const setCookies = entryRes.headers.getSetCookie
    ? entryRes.headers.getSetCookie()
    : [entryRes.headers.get('set-cookie') || ''];
  for (const sc of setCookies) {
    const mSess = sc.match(/horplus_session=([^;]+)/);
    if (mSess) tcSession = mSess[1];
    const mCsrf = sc.match(/horplus_csrf=([^;]+)/);
    if (mCsrf) tcCsrf = mCsrf[1];
  }
  if (!tcSession || !tcCsrf) {
    throw new Error('Failed to mint TC session or CSRF cookie');
  }

  const tcHeaders = {
    'Content-Type': 'application/json',
    Cookie: `horplus_session=${tcSession}; horplus_csrf=${tcCsrf}`,
    'x-csrf-token': tcCsrf,
  };
  const taHeaders = {
    'Content-Type': 'application/json',
    Cookie: `horplus_session=${taCreds.session}; horplus_csrf=${taCreds.csrf}`,
    'x-csrf-token': taCreds.csrf,
  };
  const ownerHeaders = {
    'Content-Type': 'application/json',
    Cookie: `horplus_session=${ownerCreds.session}; horplus_csrf=${ownerCreds.csrf}`,
    'x-csrf-token': ownerCreds.csrf,
    'x-dormitory-id': DORM_ID,
  };

  // --- C2-1: TC checks eligibility (200) and submits renewal -> requestedStartDate = endDate + 1 day (2027-01-01) ---
  const eligRes1 = await fetch(
    `${BASE_URL}/api/v1/contract-renewals/eligibility?contractId=${tcSetup.initialContractId}&tenantId=${tcSetup.tenantId}`,
    { headers: tcHeaders }
  );
  const eligJson1 = await eligRes1.json();
  console.log('[C2-1] GET /eligibility status:', eligRes1.status, 'body:', JSON.stringify(eligJson1));
  if (eligRes1.status !== 200 || !eligJson1.data?.eligible) {
    throw new Error(`C2-1 failed: expected 200 eligible, got ${eligRes1.status}`);
  }

  const submitRes1 = await fetch(`${BASE_URL}/api/v1/contract-renewals/request`, {
    method: 'POST',
    headers: tcHeaders,
    body: JSON.stringify({
      contractId: tcSetup.initialContractId,
      tenantId: tcSetup.tenantId,
      requestedStartDate: '2026-12-31',
      requestedDurationMonths: 6,
    }),
  });
  const submitJson1 = await submitRes1.json();
  const req1Id = submitJson1.data?.id;
  const req1StartStr = new Date(submitJson1.data?.requestedStartDate).toISOString().slice(0, 10);
  console.log('[C2-1] POST /request status:', submitRes1.status, 'requestedStartDate:', req1StartStr);
  if (submitRes1.status !== 201 || req1StartStr !== '2027-01-01') {
    throw new Error(`C2-1 failed: expected 201 and requestedStartDate=2027-01-01, got ${submitRes1.status} ${req1StartStr}`);
  }

  // --- C2-4: TC cancels own pending renewal request ---
  const cancelRes1 = await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${req1Id}/cancel`, {
    method: 'POST',
    headers: tcHeaders,
    body: JSON.stringify({ tenantId: tcSetup.tenantId }),
  });
  const cancelJson1 = await cancelRes1.json();
  console.log('[C2-4] POST /requests/:id/cancel status:', cancelRes1.status, 'status:', cancelJson1.data?.status);
  if (cancelRes1.status !== 200 || cancelJson1.data?.status !== 'CANCELLED') {
    throw new Error(`C2-4 failed: expected 200 CANCELLED, got ${cancelRes1.status}`);
  }

  // Submit req2 for C2-5, C2-6, C2-3
  const submitRes2 = await fetch(`${BASE_URL}/api/v1/contract-renewals/request`, {
    method: 'POST',
    headers: tcHeaders,
    body: JSON.stringify({
      contractId: tcSetup.initialContractId,
      tenantId: tcSetup.tenantId,
      requestedStartDate: '2027-01-01',
      requestedDurationMonths: 6,
    }),
  });
  const req2Id = (await submitRes2.json()).data?.id;

  // --- C2-5: TA attempts to submit or cancel renewal using TC's tenantId/contractId -> 403 Forbidden ---
  const taCrossSubmit = await fetch(`${BASE_URL}/api/v1/contract-renewals/request`, {
    method: 'POST',
    headers: taHeaders,
    body: JSON.stringify({
      contractId: tcSetup.initialContractId,
      tenantId: tcSetup.tenantId,
      requestedStartDate: '2027-01-01',
      requestedDurationMonths: 6,
    }),
  });
  const taCrossCancel = await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${req2Id}/cancel`, {
    method: 'POST',
    headers: taHeaders,
    body: JSON.stringify({ tenantId: tcSetup.tenantId }),
  });
  console.log('[C2-5] TA cross-submit status:', taCrossSubmit.status, 'TA cross-cancel status:', taCrossCancel.status);
  if (taCrossSubmit.status !== 403 || taCrossCancel.status !== 403) {
    throw new Error(`C2-5 failed: expected 403/403, got ${taCrossSubmit.status}/${taCrossCancel.status}`);
  }

  // --- C2-6: TA calls GET /api/v1/contract-renewals/requests -> 403 Forbidden ---
  const taListRequests = await fetch(`${BASE_URL}/api/v1/contract-renewals/requests`, {
    headers: taHeaders,
  });
  console.log('[C2-6] TA GET /requests status:', taListRequests.status);
  if (taListRequests.status !== 403) {
    throw new Error(`C2-6 failed: expected 403, got ${taListRequests.status}`);
  }

  // --- C2-3: Owner rejects req2 with reason -> TC sees rejectionReason and submits new request immediately ---
  const rejectReason = 'ขอปรับปรุงห้องพักหลังหมดสัญญาเดิม';
  const ownerRejectRes = await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${req2Id}/reject`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ reason: rejectReason }),
  });
  console.log('[C2-3] Owner POST /reject status:', ownerRejectRes.status);
  if (ownerRejectRes.status !== 200) {
    throw new Error(`C2-3 failed: owner reject returned ${ownerRejectRes.status}`);
  }

  const eligAfterRejectRes = await fetch(
    `${BASE_URL}/api/v1/contract-renewals/eligibility?contractId=${tcSetup.initialContractId}&tenantId=${tcSetup.tenantId}`,
    { headers: tcHeaders }
  );
  const eligAfterReject = (await eligAfterRejectRes.json()).data;
  console.log(
    '[C2-3] TC eligibility after reject:',
    eligAfterReject?.eligible,
    'latestRejectedReason:',
    eligAfterReject?.latestRejectedRequest?.rejectionReason
  );
  if (
    !eligAfterReject?.eligible ||
    eligAfterReject?.latestRejectedRequest?.rejectionReason !== rejectReason
  ) {
    throw new Error('C2-3 failed: expected eligible=true and latestRejectedRequest.rejectionReason');
  }

  // TC immediately submits a new request (req3)
  const submitRes3 = await fetch(`${BASE_URL}/api/v1/contract-renewals/request`, {
    method: 'POST',
    headers: tcHeaders,
    body: JSON.stringify({
      contractId: tcSetup.initialContractId,
      tenantId: tcSetup.tenantId,
      requestedStartDate: '2027-01-01',
      requestedDurationMonths: 6,
    }),
  });
  const req3Id = (await submitRes3.json()).data?.id;
  console.log('[C2-3] TC immediate re-submit status:', submitRes3.status, 'req3Id:', req3Id);
  if (submitRes3.status !== 201 || !req3Id) {
    throw new Error('C2-3 failed: immediate re-submission failed');
  }

  // --- C2-2: Owner approves req3 -> new contract inherits signatures, old contract expired, 1 ACTIVE occupancy, 1 DEPOSIT bill ---
  const ownerApproveRes = await fetch(`${BASE_URL}/api/v1/contract-renewals/requests/${req3Id}/approve`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({}),
  });
  const ownerApproveJson = await ownerApproveRes.json();
  const newContractId = ownerApproveJson.data?.contract?.id;
  console.log('[C2-2] Owner POST /approve status:', ownerApproveRes.status, 'newContractId:', newContractId);
  if (ownerApproveRes.status !== 200 || !newContractId) {
    throw new Error(`C2-2 failed: owner approve returned ${ownerApproveRes.status}`);
  }

  // Verify DB state for C2-2
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
    const prevCon = await tx.contract.findUnique({ where: { id: tcSetup.initialContractId } });
    const newCon = await tx.contract.findUnique({ where: { id: newContractId } });
    const activeOccs = await tx.occupancy.findMany({
      where: { dormitoryId: DORM_ID, tenantId: tcSetup.tenantId, status: 'ACTIVE' },
    });
    const depositBills = await tx.bill.findMany({
      where: {
        dormitoryId: DORM_ID,
        tenantId: tcSetup.tenantId,
        billKind: 'DEPOSIT',
        status: { notIn: ['CANCELLED', 'cancelled', 'VOIDED', 'voided'] },
      },
    });

    console.log('[C2-2 DB Check]', {
      prevContractStatus: prevCon?.status,
      newContractStatus: newCon?.status,
      hasTenantSig: Boolean(newCon?.tenantSignature),
      hasOwnerSig: Boolean(newCon?.ownerSignature),
      activeOccupancyCount: activeOccs.length,
      depositBillCount: depositBills.length,
    });

    if (prevCon?.status !== 'expired') throw new Error(`Expected prevCon status expired, got ${prevCon?.status}`);
    if (newCon?.status !== 'active') throw new Error(`Expected newCon status active, got ${newCon?.status}`);
    if (!newCon?.tenantSignature || !newCon?.ownerSignature) throw new Error('Expected inherited digital signatures on newCon');
    if (activeOccs.length !== 1) throw new Error(`Expected 1 ACTIVE occupancy, got ${activeOccs.length}`);
    if (depositBills.length !== 1) throw new Error(`Expected 1 DEPOSIT bill, got ${depositBills.length}`);
  });

  // Save tcSession + tcCsrf + tcSetup for Playwright browser run
  fs.writeFileSync(
    '.agents/local/c2-browser-state.json',
    JSON.stringify({ tcSession, tcCsrf, tcSetup, newContractId }, null, 2)
  );

  console.log('=== ALL C2-1 TO C2-6 LIVE API & DB CHECKS PASSED! ===');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
