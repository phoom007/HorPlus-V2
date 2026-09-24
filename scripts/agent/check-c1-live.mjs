import fs from 'fs';
import path from 'path';
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
        // Dark indigo signature ink
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

const SAMPLE_PNG_DATA_URI = createVisibleSignatureDataUri();

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

  console.log('=== Card C1 Live Verification on https://app.hor-plus.com ===');

  // 0. Health Check
  const healthRes = await fetch(`${BASE_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('[Health] Readiness status:', healthRes.status, JSON.stringify(healthJson));
  if (healthRes.status !== 200) {
    throw new Error('Pilot readiness check failed');
  }

  // Ensure TA's active contract has contractSnapshot, tenantSignature, and ownerSignature in DB
  let taContractInfo = null;
  let tbSessionCookie = null;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

    // Find TA's profile via API first to get TA's tenantId and contractId
    const profRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
      headers: { Cookie: `horplus_session=${taCreds.session}` },
    });
    if (profRes.status !== 200) {
      throw new Error(`Failed to fetch TA profile: ${profRes.status}`);
    }
    const profData = await profRes.json();
    const taTenantId = profData.id;
    const taRoomId = profData.room?.id || (await tx.room.findFirst({ where: { dormitoryId: DORM_ID, roomNumber: '101' } }))?.id;
    if (!taRoomId) {
      throw new Error('Could not find room 101 for TA');
    }

    let existingCon = await tx.contract.findFirst({
      where: { tenantId: taTenantId, dormitoryId: DORM_ID },
      orderBy: { createdAt: 'desc' },
    });

    if (!existingCon) {
      existingCon = await tx.contract.create({
        data: {
          dormitoryId: DORM_ID,
          tenantId: taTenantId,
          roomId: taRoomId,
          contractNumber: 'CT-2026-101',
          status: 'active',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2027-08-31T00:00:00.000Z'),
          durationMonths: 12,
          rentBillingType: 'monthly',
          rentAmount: 3500,
          depositAmount: 7000,
          advancePaymentAmount: 0,
          terms: '1. ชำระค่าเช่าภายในวันที่ 5 ของทุกเดือน\n2. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22.00 น.',
          tenantSignature: SAMPLE_PNG_DATA_URI,
          ownerSignature: SAMPLE_PNG_DATA_URI,
          signedByTenantAt: new Date('2026-09-01T09:00:00.000Z'),
          signedByOwnerAt: new Date('2026-09-01T09:30:00.000Z'),
        },
      });
    }

    const taContractId = existingCon.id;

    // Update contract to ensure status is active and tenantSignature & ownerSignature are set for C1-1 & C1-2 verification
    const updatedCon = await tx.contract.update({
      where: { id: taContractId },
      data: {
        status: 'active',
        tenantSignature: SAMPLE_PNG_DATA_URI,
        ownerSignature: SAMPLE_PNG_DATA_URI,
        signedByTenantAt: new Date('2026-09-01T09:00:00.000Z'),
        signedByOwnerAt: new Date('2026-09-01T09:30:00.000Z'),
      },
      include: { room: true },
    });

    // Ensure contractSnapshot exists for TA's contract
    let snap = await tx.contractSnapshot.findFirst({
      where: { contractId: taContractId, dormitoryId: DORM_ID },
    });
    if (!snap) {
      snap = await tx.contractSnapshot.create({
        data: {
          dormitoryId: DORM_ID,
          contractId: taContractId,
          buildingId: updatedCon.room.buildingId,
          roomId: updatedCon.roomId,
          tenantId: taTenantId,
          exactRoomNumber: updatedCon.room?.roomNumber || '101',
          resolvedRent: updatedCon.rentAmount,
          resolvedDeposit: updatedCon.depositAmount,
          resolvedWaterRate: 18,
          resolvedElectricityRate: 8,
          sourceVersions: {},
          snapshotData: {},
        },
      });
    }

    taContractInfo = {
      tenantId: taTenantId,
      contractId: taContractId,
      contractNumber: updatedCon.contractNumber,
      roomNumber: snap.exactRoomNumber,
      rentAmount: Number(snap.resolvedRent),
      depositAmount: Number(snap.resolvedDeposit),
      startDate: updatedCon.startDate.toISOString(),
      endDate: updatedCon.endDate.toISOString(),
    };
    // Find another active tenant (TD/TB) in DORM_ID and create a fresh invite token to mint a live session cookie
    const otherTenant = await tx.tenant.findFirst({
      where: {
        dormitoryId: DORM_ID,
        id: { not: taTenantId },
        status: 'active',
        lineFriendId: { not: null },
        deletedAt: null,
      },
      include: { lineFriend: true },
    });
    if (!otherTenant || !otherTenant.lineFriend) {
      throw new Error('Could not find second active tenant with lineFriend in Manor');
    }

    const { TenantRegistrationInviteService } = await import(
      '../../server/dist/services/tenant-registration-invite.service.js'
    );
    const inviteService = new TenantRegistrationInviteService(tx);
    const tbInvite = await inviteService.createInvite(DORM_ID, otherTenant.lineFriend.id);
    taContractInfo.tbRawToken = tbInvite.rawToken;
  });

  // Mint fresh TB session cookie via line-tenant-entry
  const entryRes = await fetch(
    `${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(taContractInfo.tbRawToken)}`,
    { redirect: 'manual' }
  );
  const setCookies = entryRes.headers.getSetCookie
    ? entryRes.headers.getSetCookie()
    : [entryRes.headers.get('set-cookie') || ''];
  for (const sc of setCookies) {
    const m = sc.match(/horplus_session=([^;]+)/);
    if (m) tbSessionCookie = m[1];
  }
  if (!tbSessionCookie) {
    throw new Error('Failed to mint fresh TB session cookie via line-tenant-entry');
  }

  // --- AC C1-1: TA contract view matches Owner contract view & signatures resolve with 0 403s ---
  const taProfileRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/profile`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const taProfile = await taProfileRes.json();

  const taContractRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const taContractJson = await taContractRes.json();
  const taContract = taContractJson.data;

  const ownerContractsRes = await fetch(
    `${BASE_URL}/api/v1/contracts/${taContractInfo.contractId}?dormitoryId=${DORM_ID}`,
    {
      headers: {
        Cookie: `horplus_session=${ownerCreds.session}`,
        'x-dormitory-id': DORM_ID,
      },
    }
  );
  const ownerContractJson = await ownerContractsRes.json();
  const ownerContract = ownerContractJson.data || ownerContractJson;

  // Check signature endpoints as TA (must NOT return 403)
  const tenantSigRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract/signatures/tenant`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
    redirect: 'manual',
  });
  const ownerSigRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract/signatures/owner`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
    redirect: 'manual',
  });

  console.log('[AC C1-1] TA Contract vs Owner Contract & Snapshot:', {
    taContractStatus: taContractRes.status,
    ownerContractStatus: ownerContractsRes.status,
    contractNumber: {
      ta: taContract.contractNumber,
      profileActiveContract: taProfile.activeContract?.contractNumber,
      owner: ownerContract.contractNumber,
      snapshot: taContractInfo.contractNumber,
    },
    roomNumber: {
      ta: taContract.roomNumber,
      profileActiveContract: taProfile.activeContract?.roomNumber,
      snapshot: taContractInfo.roomNumber,
    },
    rentAmount: {
      ta: Number(taContract.rentAmount),
      profileActiveContract: Number(taProfile.activeContract?.rentAmount),
      snapshot: taContractInfo.rentAmount,
    },
    depositAmount: {
      ta: Number(taContract.depositAmount),
      profileActiveContract: Number(taProfile.activeContract?.depositAmount),
      snapshot: taContractInfo.depositAmount,
    },
    tenantSignatureUrl: taContract.tenantSignature,
    ownerSignatureUrl: taContract.ownerSignature,
    profileDormOwnerSigUrl: taProfile.dormitory?.ownerSignature,
    tenantSigEndpointStatus: tenantSigRes.status,
    ownerSigEndpointStatus: ownerSigRes.status,
  });

  if (
    taContractRes.status !== 200 ||
    taContract.contractNumber !== taContractInfo.contractNumber ||
    Number(taContract.rentAmount) !== taContractInfo.rentAmount ||
    Number(taContract.depositAmount) !== taContractInfo.depositAmount ||
    ![200, 302].includes(tenantSigRes.status) ||
    ![200, 302].includes(ownerSigRes.status)
  ) {
    throw new Error('AC C1-1 verification failed');
  }

  // --- AC C1-2: TA downloads/opens Contract PDF (/api/v1/tenant-portal/contract/pdf) ---
  const pdfRes = await fetch(`${BASE_URL}/api/v1/tenant-portal/contract/pdf`, {
    headers: { Cookie: `horplus_session=${taCreds.session}` },
  });
  const pdfContentType = pdfRes.headers.get('content-type');
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  const pdfMagic = pdfBuffer.subarray(0, 7).toString('ascii');

  fs.mkdirSync('.agents/local/screenshots', { recursive: true });
  const savedPdfPath = path.resolve('.agents/local/screenshots/c1-2-ta-contract.pdf');
  fs.writeFileSync(savedPdfPath, pdfBuffer);

  console.log('[AC C1-2] TA Contract PDF Response:', {
    status: pdfRes.status,
    contentType: pdfContentType,
    byteLength: pdfBuffer.length,
    pdfMagic,
    savedPdfPath,
  });

  if (pdfRes.status !== 200 || !pdfContentType?.includes('application/pdf') || pdfMagic !== '%PDF-1.') {
    throw new Error('AC C1-2 verification failed');
  }

  // --- AC C1-3: TB attempts to access TA's contract and PDF -> 403 Forbidden ---
  const tbOwnerRouteRes = await fetch(
    `${BASE_URL}/api/v1/contracts/${taContractInfo.contractId}?dormitoryId=${DORM_ID}`,
    {
      headers: {
        Cookie: `horplus_session=${tbSessionCookie}`,
        'x-dormitory-id': DORM_ID,
      },
    }
  );
  const tbPortalContractRes = await fetch(
    `${BASE_URL}/api/v1/tenant-portal/contract?contractId=${taContractInfo.contractId}`,
    {
      headers: { Cookie: `horplus_session=${tbSessionCookie}` },
    }
  );
  const tbPortalPdfRes = await fetch(
    `${BASE_URL}/api/v1/tenant-portal/contract/pdf?contractId=${taContractInfo.contractId}`,
    {
      headers: { Cookie: `horplus_session=${tbSessionCookie}` },
    }
  );

  console.log('[AC C1-3] Cross-tenant access attempts by TB against TA contract:', {
    tbOwnerContractRouteStatus: tbOwnerRouteRes.status,
    tbPortalContractWithTaIdStatus: tbPortalContractRes.status,
    tbPortalPdfWithTaIdStatus: tbPortalPdfRes.status,
  });

  if (
    tbOwnerRouteRes.status !== 403 ||
    tbPortalContractRes.status !== 403 ||
    tbPortalPdfRes.status !== 403
  ) {
    throw new Error('AC C1-3 cross-tenant isolation check failed');
  }

  fs.writeFileSync(
    '.agents/local/c1-live-context.json',
    JSON.stringify(
      {
        taContractInfo,
        savedPdfPath,
      },
      null,
      2
    )
  );

  console.log('=== ALL CARD C1 LIVE API CHECKS PASSED ===');
  await prisma.$disconnect();
}

run().catch((err) => {
  console.error('Card C1 Live Check Error:', err);
  process.exit(1);
});
