import { chromium } from 'playwright';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { PNG } from '../../server/node_modules/pngjs/lib/png.js';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { encryptText } from '../../server/dist/utils/crypto-encryption.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';
const SCREENSHOT_DIR = path.resolve('.agents/local/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

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

async function applySessionCookies(context, sessionInfo) {
  await context.addCookies([
    {
      name: 'horplus_session',
      value: sessionInfo.session,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'horplus_csrf',
      value: sessionInfo.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
}

async function main() {
  console.log('=== Starting Card C3 Live Browser Verification on https://app.hor-plus.com ===');
  const prisma = getPrismaClient();
  const ownerAuth = getCredentials('Owner');

  // 1. Setup dedicated Room C3-109 & Tenant TC with active occupancy
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
          roomType: sampleRoom?.roomType || 'Standard',
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

    const tcLineUserId = `U_c3_browser_${Date.now()}`;
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

    const tcEmail = `tc.c3.browser.${Date.now()}@horplus.local`;
    const tcUser = await tx.user.create({
      data: {
        googleSubject: `gsub_c3_browser_${Date.now()}`,
        email: tcEmail,
        emailNormalized: tcEmail,
        name: 'กิตติ ทดสอบย้ายออก',
        phone: '0897776655',
      },
    });

    const tcTenant = await tx.tenant.create({
      data: {
        dormitoryId: DORM_ID,
        tenantNumber: `TN-C3B-${Date.now().toString().slice(-4)}`,
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
        contractNumber: `CTR-C3B-${Date.now().toString().slice(-5)}`,
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

    await tx.occupancy.create({
      data: {
        dormitoryId: DORM_ID,
        roomId: testRoom.id,
        tenantId: tcTenant.id,
        contractId: tcContract.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    });

    const inviteService = new TenantRegistrationInviteService(tx);
    const invite = await inviteService.createInvite(DORM_ID, tcLineFriend.id);

    const cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { periodStart: 'desc' },
    });

    await tx.bill.create({
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

    await tx.bill.create({
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

    await tx.bill.create({
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

    tcSetup = {
      roomId: testRoom.id,
      roomNumber: testRoom.roomNumber,
      buildingId: building.id,
      tenantId: tcTenant.id,
      userId: tcUser.id,
      lineFriendId: tcLineFriend.id,
      contractId: tcContract.id,
      rawToken: invite.rawToken,
    };
  });

  const tcAuth = await getTenantSessionFromEntry(tcSetup.rawToken);

  // Submit TC move-out request via API so it persists in DB, then reload Tenant Portal in Viewport D
  const submitRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: tcAuth.cookieHeader,
      'x-csrf-token': tcAuth.csrf,
      'x-dormitory-id': DORM_ID,
    },
    body: JSON.stringify({
      intendedMoveOutDate: '2026-09-30',
      refundBankName: 'กสิกรไทย (KBANK)',
      refundAccountNumber: '1234567890',
      refundAccountName: 'นาย กิตติ ทดสอบย้ายออก',
      reason: 'ย้ายสถานที่ทำงาน',
    }),
  });
  const submitJson = await submitRes.json();
  const moveOutReqId = submitJson?.data?.id;
  console.log('[Browser C3-1] Move-out submitted:', submitRes.status, moveOutReqId);

  const browser = await chromium.launch({ headless: true });

  try {
    // --- Screenshot 1: C3-1 Tenant Portal in Viewport D (390x844) showing scheduled move-out & cancel button ---
    const tcContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await applySessionCookies(tcContext, tcAuth);
    const tcPage = await tcContext.newPage();
    await tcPage.goto(`${BASE_URL}/tenant`, { waitUntil: 'domcontentloaded' });
    await tcPage.waitForTimeout(2500);
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForTimeout(2500);
    const profileTabBtn = tcPage.locator('button:has-text("โปรไฟล์")').first();
    if (await profileTabBtn.count() > 0) {
      await profileTabBtn.click();
      await tcPage.waitForTimeout(2000);
    }
    await tcPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'c3-1-tenant-moveout-requested.png'), fullPage: true });
    console.log('Captured c3-1-tenant-moveout-requested.png');

    // --- Owner confirms move-out via API (AC C3-4) ---
    const confirmRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-move-out-requests/${moveOutReqId}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: ownerAuth.cookieHeader,
        'x-csrf-token': ownerAuth.csrf,
        'x-dormitory-id': DORM_ID,
      },
      body: JSON.stringify({
        actualEndedAt: '2026-09-30',
        reason: 'ย้ายออกตามกำหนดและหักบิลค้างจากเงินมัดจำเรียบร้อย',
      }),
    });
    const confirmJson = await confirmRes.json();
    console.log('[Browser C3-4] Owner confirm move-out:', confirmRes.status, confirmJson?.data?.finalReceiptNumber);

    // --- Screenshot 2: C3-4 Owner Tenants Page (1440x900) after confirming move-out ---
    const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await applySessionCookies(ownerContext, ownerAuth);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(3000);
    const formerTabBtn = ownerPage.locator('button:has-text("เลิกเช่าแล้ว")').first();
    if (await formerTabBtn.count() > 0) {
      await formerTabBtn.click();
      await ownerPage.waitForTimeout(1500);
    }
    const tcRow = ownerPage.locator('text=กิตติ ทดสอบย้ายออก').first();
    if (await tcRow.count() > 0) {
      await tcRow.click();
      await ownerPage.waitForTimeout(1500);
    }
    await ownerPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'c3-4-owner-moveout-confirmed.png'), fullPage: false });
    console.log('Captured c3-4-owner-moveout-confirmed.png');

    // --- Screenshot 3: C3-5 TC reloads open Tenant Portal tab after move-out -> session revoked ---
    await tcPage.reload({ waitUntil: 'domcontentloaded' });
    await tcPage.waitForTimeout(3000);
    await tcPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'c3-5-tenant-session-revoked.png'), fullPage: true });
    console.log('Captured c3-5-tenant-session-revoked.png');

    // --- Screenshot 4: C3-8 Owner views historical contract & settlement on /owner/tenants ---
    const contractTabBtn = ownerPage.locator('button:has-text("สัญญาเช่า")').first();
    if (await contractTabBtn.count() > 0) {
      await contractTabBtn.click();
      await ownerPage.waitForTimeout(1500);
    }
    await ownerPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'c3-8-owner-history-preserved.png'), fullPage: false });
    console.log('Captured c3-8-owner-history-preserved.png');

    // --- Screenshot 5: C3-9 Same LINE identity re-registers in Room C3-109, Owner approves, Tenant opens clean portal ---
    let reRegRawToken = '';
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      const inviteService = new TenantRegistrationInviteService(tx);
      const newInvite = await inviteService.createInvite(DORM_ID, tcSetup.lineFriendId);
      reRegRawToken = newInvite.rawToken;
    });

    const tcReRegAuth = await getTenantSessionFromEntry(reRegRawToken);

    const policyRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-registrations/public-policy?dormitoryId=${DORM_ID}`);
    const policyJson = await policyRes.json();
    const expectedPolicyVersion = policyJson?.data?.policyVersion ?? policyJson?.policyVersion ?? 1;

    const reRegSubmitRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-registrations`, {
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

    const approveReRegRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-registrations/${newRegId}/approve`, {
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

    if ((approveReRegJson?.data?.status || approveReRegJson?.status) === 'awaiting_tenant_confirmation') {
      await fetchWithRetry(`${BASE_URL}/api/v1/tenant-registrations/${newRegId}/confirm-signature`, {
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
    }

    const reRegContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await applySessionCookies(reRegContext, tcReRegAuth);
    const reRegPage = await reRegContext.newPage();
    await reRegPage.goto(`${BASE_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await reRegPage.waitForTimeout(4000);
    await reRegPage.screenshot({ path: path.join(SCREENSHOT_DIR, 'c3-9-re-registered-clean-portal.png'), fullPage: true });
    console.log('Captured c3-9-re-registered-clean-portal.png');

    await tcContext.close();
    await ownerContext.close();
    await reRegContext.close();
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  console.log('=== ALL CARD C3 BROWSER SCREENSHOTS CAPTURED ===');
}

main().catch((err) => {
  console.error('C3 BROWSER CHECK FAILED:', err);
  process.exit(1);
});
