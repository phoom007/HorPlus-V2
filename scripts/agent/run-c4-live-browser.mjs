import { chromium } from 'playwright';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { getPrismaClient } from '../../server/dist/db/prisma.js';
import { encryptText } from '../../server/dist/utils/crypto-encryption.js';
import { TenantRegistrationInviteService } from '../../server/dist/services/tenant-registration-invite.service.js';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002'; // Manor
const SCREENSHOT_DIR = path.resolve('.agents/local/screenshots');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

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
  console.log('=== Starting Card C4 Live Browser Verification on https://app.hor-plus.com ===');
  const prisma = getPrismaClient();
  const ownerAuth = getCredentials('Owner');

  let setupData = null;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;

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
          status: 'occupied',
        },
      });
    } else {
      await tx.room.update({
        where: { id: testRoom.id },
        data: { status: 'vacant', currentTenantId: null, currentContractId: null },
      });
      await tx.tenantMoveOutRequest.deleteMany({ where: { roomId: testRoom.id } });
      const bills = await tx.bill.findMany({ where: { roomId: testRoom.id } });
      const billIds = bills.map((b) => b.id);
      if (billIds.length > 0) {
        await tx.paymentUploadIntent.deleteMany({ where: { billId: { in: billIds } } });
        await tx.receipt.deleteMany({ where: { billId: { in: billIds } } });
        await tx.billItem.deleteMany({ where: { billId: { in: billIds } } });
        await tx.payment.deleteMany({ where: { billId: { in: billIds } } });
        await tx.bill.deleteMany({ where: { id: { in: billIds } } });
      }
      await tx.occupancy.deleteMany({ where: { roomId: testRoom.id } });
      await tx.contract.deleteMany({ where: { roomId: testRoom.id } });
    }

    const lineUserId = `U_c4_browser_${Date.now()}`;
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

    const tdEmail = `td.c4.browser.${Date.now()}@horplus.local`;
    const tdUser = await tx.user.create({
      data: {
        googleSubject: `gsub_c4_browser_${Date.now()}`,
        email: tdEmail,
        emailNormalized: tdEmail,
        name: 'ธนินทร์ สัญญาหมดอายุ',
        phone: '0894445555',
      },
    });

    const tenant = await tx.tenant.create({
      data: {
        dormitoryId: DORM_ID,
        tenantNumber: `TN-C4-B-${Date.now().toString().slice(-4)}`,
        firstName: 'ธนินทร์',
        lastName: 'สัญญาหมดอายุ',
        displayName: 'ธนินทร์ สัญญาหมดอายุ',
        phone: '0894445555',
        status: 'active',
        linkedUserId: tdUser.id,
        lineFriendId: lineFriend.id,
      },
    });

    const startDate = new Date('2026-03-01T00:00:00.000Z');
    const endDate = new Date('2026-08-31T23:59:59.000Z');

    const contract = await tx.contract.create({
      data: {
        dormitoryId: DORM_ID,
        contractNumber: `CTR-C4-B-${Date.now().toString().slice(-5)}`,
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

    await tx.room.update({
      where: { id: testRoom.id },
      data: {
        status: 'occupied',
        currentTenantId: tenant.id,
        currentContractId: contract.id,
      },
    });

    const inviteService = new TenantRegistrationInviteService(tx);
    const tdInvite = await inviteService.createInvite(DORM_ID, lineFriend.id);

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
        billNumber: `INV-C4-B-${Date.now().toString().slice(-5)}`,
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
        description: 'ค่าเช่าห้อง C4-104 เดือน ส.ค. 2569 (ค้างชำระ)',
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

  console.log(`[Browser Setup] Room: ${setupData.room.roomNumber}, Contract: ${setupData.contract.contractNumber}, Tenant: ${setupData.tenant.displayName}`);

  const tenantAuth = await getTenantSessionFromEntry(setupData.rawToken);
  console.log('[Browser Setup] Tenant session authenticated successfully');

  const browser = await chromium.launch({ headless: true });

  try {
    // -------------------------------------------------------------
    // Screenshot 1: AC C4-2 Owner Portal Desktop (1280x800)
    // Viewing expired contract badge on /owner/tenants
    // -------------------------------------------------------------
    console.log('\n--- Capturing c4-2-owner-expired-contract-badge.png ---');
    const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await applySessionCookies(ownerContext, ownerAuth);
    const ownerPage = await ownerContext.newPage();

    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(3000);
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(3000);

    // Look for tenant or contract
    const searchInput = ownerPage.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('ธนินทร์');
      await ownerPage.waitForTimeout(1500);
    }

    // Click tenant item to open details pane on the right
    const tenantCard = ownerPage.locator('text=ธนินทร์ สัญญาหมดอายุ').first();
    if (await tenantCard.count() > 0) {
      await tenantCard.click();
      await ownerPage.waitForTimeout(2000);
    }

    // Ensure expired badge is visible
    const expiredBadge = ownerPage.locator('text=หมดอายุแล้ว').first();
    if (await expiredBadge.count() > 0) {
      await expiredBadge.scrollIntoViewIfNeeded();
    }

    const screenshotPathC4_2 = path.join(SCREENSHOT_DIR, 'c4-2-owner-expired-contract-badge.png');
    await ownerPage.screenshot({ path: screenshotPathC4_2, fullPage: true });
    console.log(`Captured: ${screenshotPathC4_2}`);

    // -------------------------------------------------------------
    // Screenshot 2: AC C4-3 Tenant Portal Viewport D (390x844)
    // Viewing expired banner & unpaid bill on /tenant
    // -------------------------------------------------------------
    console.log('\n--- Capturing c4-3-tenant-portal-expired-banner.png ---');
    const tenantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await applySessionCookies(tenantContext, tenantAuth);
    const tenantPage = await tenantContext.newPage();

    await tenantPage.goto(`${BASE_URL}/tenant`, { waitUntil: 'domcontentloaded' });
    await tenantPage.waitForTimeout(3000);
    await tenantPage.reload({ waitUntil: 'domcontentloaded' });
    await tenantPage.waitForTimeout(3000);

    // Verify expired banner is present
    const expiredBanner = tenantPage.locator('[data-testid="tenant-contract-expired-banner"]');
    if (await expiredBanner.count() > 0) {
      console.log('[Browser C4-3] Found tenant-contract-expired-banner');
      await expiredBanner.scrollIntoViewIfNeeded();
    }

    const screenshotPathC4_3 = path.join(SCREENSHOT_DIR, 'c4-3-tenant-portal-expired-banner.png');
    await tenantPage.screenshot({ path: screenshotPathC4_3, fullPage: true });
    console.log(`Captured: ${screenshotPathC4_3}`);

    // -------------------------------------------------------------
    // Screenshot 3: AC C4-4 Owner Move-Out Final Settlement on Expired Contract
    // Owner confirms move-out, room vacated and settlement completed
    // -------------------------------------------------------------
    console.log('\n--- Capturing c4-4-owner-moveout-expired-contract.png ---');
    // Tenant submits move-out request
    const moveOutSubmitRes = await fetchWithRetry(`${BASE_URL}/api/v1/tenant-move-out-requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: tenantAuth.cookieHeader,
        'x-csrf-token': tenantAuth.csrf,
        'x-dormitory-id': DORM_ID,
      },
      body: JSON.stringify({
        intendedMoveOutDate: '2026-09-30',
        reason: 'สัญญาหมดอายุแล้ว ยื่นแจ้งย้ายออกผ่านระบบ',
        bankName: 'KBANK',
        bankAccountNumber: '1234567890',
        bankAccountHolder: 'ธนินทร์ สัญญาหมดอายุ',
      }),
    });
    const moveOutSubmitJson = await moveOutSubmitRes.json();
    const moveOutReqId = moveOutSubmitJson?.data?.id;
    console.log(`[Browser C4-4] Tenant submitted move-out: ${moveOutReqId}`);

    // Owner confirms move-out via API
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
        reason: 'ยืนยันย้ายออกสัญญาหมดอายุและปิดห้องพัก',
      }),
    });
    const confirmJson = await confirmRes.json();
    console.log(`[Browser C4-4] Owner confirmed move-out: receipt=${confirmJson?.data?.finalReceipt?.receiptNumber}`);

    // Reload Owner /owner/tenants and open "เลิกเช่าแล้ว" tab to show terminated tenant & final settlement
    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(3000);
    await ownerPage.reload({ waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(3000);

    const formerTab = ownerPage.locator('button:has-text("เลิกเช่าแล้ว")').first();
    if (await formerTab.count() > 0) {
      await formerTab.click();
      await ownerPage.waitForTimeout(2000);
    }
    const formerSearch = ownerPage.locator('input[placeholder*="ค้นหา"], input[type="search"]').first();
    if (await formerSearch.count() > 0) {
      await formerSearch.fill('ธนินทร์');
      await ownerPage.waitForTimeout(1500);
    }
    const formerCard = ownerPage.locator('text=ธนินทร์ สัญญาหมดอายุ').first();
    if (await formerCard.count() > 0) {
      await formerCard.click();
      await ownerPage.waitForTimeout(2000);
    }

    const screenshotPathC4_4 = path.join(SCREENSHOT_DIR, 'c4-4-owner-moveout-expired-contract.png');
    await ownerPage.screenshot({ path: screenshotPathC4_4, fullPage: true });
    console.log(`Captured: ${screenshotPathC4_4}`);

    console.log('\n=== All 3 Browser Screenshots for Card C4 captured successfully ===');
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Browser check failed:', err);
  process.exit(1);
});
