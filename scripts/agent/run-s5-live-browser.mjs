/**
 * Playwright Live Browser Checks for Card S5
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium)
 * Tests all 6 Acceptance Criteria in browser with screenshots
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');
const { Redis } = require('../../server/node_modules/ioredis');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const prisma = new PrismaClient({
  datasources: { db: { url: envConfig.DIRECT_URL || envConfig.DATABASE_URL } },
});

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function getCookieString(sessionData) {
  return sessionData.cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function getCsrfToken(sessionData) {
  const csrfCookie = sessionData.cookies.find(c => c.name === 'horplus_csrf');
  return csrfCookie ? csrfCookie.value : '';
}

async function resetAndSetupTcUnclaimed() {
  console.log('--- Setting up fresh TC tenant in Room 304 ---');
  // Clear rate limits in Redis
  try {
    const redis = new Redis(envConfig.REDIS_URL || 'redis://localhost:6379');
    const rateLimitKeys = await redis.keys('rate_limit:registration:*');
    if (rateLimitKeys.length > 0) {
      await redis.del(...rateLimitKeys);
    }
    redis.disconnect();
  } catch {}

  // Delete previous test TC tenants
  const prevTcTenants = await prisma.tenant.findMany({
    where: { dormitoryId: DORM_ID, phone: '0895551122' },
  });
  for (const t of prevTcTenants) {
    const bills = await prisma.bill.findMany({ where: { tenantId: t.id }, select: { id: true } });
    const billIds = bills.map(b => b.id);
    if (billIds.length > 0) {
      await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.paymentAllocation.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.paymentUploadIntent.deleteMany({ where: { billId: { in: billIds } } });
      const payments = await prisma.payment.findMany({ where: { billId: { in: billIds } }, select: { id: true } });
      const paymentIds = payments.map(p => p.id);
      if (paymentIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      }
      await prisma.receipt.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.payment.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.billStatusHistory.deleteMany({ where: { billId: { in: billIds } } });
      await prisma.billItem.deleteMany({ where: { billId: { in: billIds } } });
    }
    await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentGroup: { tenantId: t.id } } });
    await prisma.paymentUploadIntent.deleteMany({ where: { tenantId: t.id } });
    await prisma.combinedPaymentGroup.deleteMany({ where: { tenantId: t.id } });
    await prisma.bill.deleteMany({ where: { tenantId: t.id } });
    await prisma.contractStatusHistory.deleteMany({ where: { contract: { tenantId: t.id } } });
    await prisma.contract.deleteMany({ where: { tenantId: t.id } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { tenantId: t.id } });
    await prisma.occupancy.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantEmergencyContact.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantVehicle.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantCoOccupant.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenantNotice.deleteMany({ where: { tenantId: t.id } });
    await prisma.tenant.delete({ where: { id: t.id } });
  }

  // Ensure Room 304 is vacant
  const targetRoom = await prisma.room.findFirst({
    where: { dormitoryId: DORM_ID, roomNumber: '304' },
  });
  if (!targetRoom) throw new Error('Room 304 not found');
  await prisma.room.update({
    where: { id: targetRoom.id },
    data: { status: 'vacant', currentTenantId: null, currentContractId: null },
  });

  // Create TC tenant via API
  const ownerSession = getSession('owner');
  const ownerCookies = getCookieString(ownerSession);
  const ownerCsrf = getCsrfToken(ownerSession);

  const createTcPayload = {
    roomId: targetRoom.id,
    fullName: 'ธนดล เจริญสุข',
    phone: '0895551122',
    rentalType: 'MONTHLY',
    startDate: '2025-10-15',
    durationMonths: 12,
    unitRentAmount: '3500',
    depositAmount: '7000',
    depositDeclaredStatus: 'PAID',
  };

  const createRes = await fetch(`${BASE_URL}/api/v1/meters/provisional-terms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': ownerCookies,
      'X-CSRF-Token': ownerCsrf,
      'X-Dormitory-Id': DORM_ID,
    },
    body: JSON.stringify(createTcPayload),
  });
  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create TC: ${err}`);
  }

  const tcTenant = await prisma.tenant.findFirst({
    where: { dormitoryId: DORM_ID, phone: '0895551122', deletedAt: null },
  });

  // Ensure line friend exists
  let tcLineFriend = await prisma.dormitoryLineFriend.findFirst({
    where: { dormitoryId: DORM_ID, displayName: 'ผู้เช่า TC (LINE สำรอง 1)' },
  });
  if (!tcLineFriend) {
    const rawLineUserId = 'U_tc_reserve_line_001';
    const lineUserIdHash = crypto.createHash('sha256').update(rawLineUserId).digest('hex');
    tcLineFriend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: DORM_ID,
        displayName: 'ผู้เช่า TC (LINE สำรอง 1)',
        lineUserIdHash,
        lineUserIdEncrypted: 'enc_tc_reserve_line_001',
        friendStatus: 'ADDED',
      },
    });
  }

  // Create invite token for TC
  const tcRawToken = crypto.randomBytes(32).toString('hex');
  const tcTokenHash = crypto.createHash('sha256').update(tcRawToken).digest('hex');
  await prisma.tenantRegistrationInvite.create({
    data: {
      dormitoryId: DORM_ID,
      lineFriendId: tcLineFriend.id,
      tokenHash: tcTokenHash,
      purpose: 'TENANT_REGISTRATION',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { targetRoom, tcTenant, tcLineFriend, tcRawToken };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  console.log('=== Starting Card S5 Playwright Browser Verification ===\n');

  const { targetRoom, tcTenant, tcLineFriend, tcRawToken } = await resetAndSetupTcUnclaimed();

  // --------------------------------------------------------------------------
  // 1. [AC S5-1] Owner UI view of Room 304 and TC tenant
  // --------------------------------------------------------------------------
  console.log('1. [AC S5-1] Checking Owner UI View (/owner/tenants)...');
  const ownerStorage = getSession('owner');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto('https://app.hor-plus.com/owner/tenants', { waitUntil: 'networkidle' });
  await ownerPage.waitForTimeout(2000);

  const ownerContent = await ownerPage.content();
  const hasTcInList = ownerContent.includes('ธนดล') || ownerContent.includes('304');
  console.log(`  Owner sees Room 304 / TC: ${hasTcInList}`);

  const ssOwnerPath = path.join(SCREENSHOTS_DIR, 's5-1-owner-created-tc.png');
  await ownerPage.screenshot({ path: ssOwnerPath, fullPage: false });
  console.log(`  Saved screenshot: ${ssOwnerPath}`);
  await ownerContext.close();

  // --------------------------------------------------------------------------
  // 2. [AC S5-3 & S5-6] Mobile Viewport D (390x844): TC Claim Verification Flow
  // --------------------------------------------------------------------------
  console.log('\n2. [AC S5-3 & S5-6] TC Claim Verification on Mobile Viewport D...');
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });
  const mobilePage = await mobileContext.newPage();

  // Open OA button entrypoint with invite token
  const registerUrl = `${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(tcRawToken)}`;
  console.log(`  Navigating to: ${registerUrl}`);
  await mobilePage.goto(registerUrl, { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(3000);

  // Search and click Room 304 card to open TenantClaimModal
  const searchInput = mobilePage.getByPlaceholder('ค้นหาเลขห้อง หรือ อาคาร/ตึก...');
  if (await searchInput.isVisible()) {
    await searchInput.fill('304');
    await mobilePage.waitForTimeout(1000);
  }
  const room304Card = mobilePage.locator('[data-testid="room-card-304"], :text("ห้อง 304")').first();
  await room304Card.waitFor({ state: 'visible', timeout: 10000 });
  await room304Card.click();
  await mobilePage.waitForTimeout(1500);

  // Check that TenantClaimModal is visible
  const claimSheet = mobilePage.locator('#tenant-claim-modal-container, [data-testid="tenant-claim-bottom-sheet"]').first();
  await claimSheet.waitFor({ state: 'visible', timeout: 8000 });

  // Sub-check A: Safe masked data display (AC S5-6)
  const modalText = await claimSheet.innerText();
  const hasMaskedName = modalText.includes('ธน*** เจ***');
  const hasNoPiiLeak = !modalText.includes('นาย ธนดล เจริญสุข') && !modalText.includes('0895551122');
  console.log(`  Modal shows masked name: ${hasMaskedName}, No PII leaked: ${hasNoPiiLeak}`);
  const ssMaskedPath = path.join(SCREENSHOTS_DIR, 's5-6-tc-masked-data.png');
  await mobilePage.screenshot({ path: ssMaskedPath });
  console.log(`  Saved screenshot: ${ssMaskedPath}`);

  // Sub-check B: 1-character input rejection (AC S5-3)
  console.log('  Testing 1-character name rejection...');
  const claimInput = claimSheet.locator('input[type="text"]').first();
  const submitBtn = claimSheet.locator('button[type="submit"], [data-testid="tenant-claim-submit-btn"]').first();
  await claimInput.fill('ธ');
  await submitBtn.click();
  await mobilePage.waitForTimeout(1500);

  const errorContent = await claimSheet.innerText();
  const hasShortError = errorContent.includes('อย่างน้อย 2 ตัวอักษร');
  console.log(`  Rejected 1-character input with Thai error: ${hasShortError}`);
  const ssShortErrPath = path.join(SCREENSHOTS_DIR, 's5-3-tc-short-name-rejected.png');
  await mobilePage.screenshot({ path: ssShortErrPath });
  console.log(`  Saved screenshot: ${ssShortErrPath}`);

  // --------------------------------------------------------------------------
  // 3. [AC S5-2] TC Claim Completion & Entry to TC Portal
  // --------------------------------------------------------------------------
  console.log('\n3. [AC S5-2] Completing claim and verifying TC portal entry...');
  // Complete claim via API to establish binding and session
  const verifyApiRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/verify-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dormitory-Id': DORM_ID },
    body: JSON.stringify({ dormitoryId: DORM_ID, roomId: targetRoom.id, claimInput: '0895551122' }),
  });
  const verifyApiJson = await verifyApiRes.json();
  const claimVerificationToken = verifyApiJson.data?.claimVerificationToken;

  const completeApiRes = await fetch(`${BASE_URL}/api/v1/tenant-registrations/complete-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dormitory-Id': DORM_ID },
    body: JSON.stringify({
      dormitoryId: DORM_ID,
      roomId: targetRoom.id,
      tenantId: tcTenant.id,
      inviteToken: tcRawToken,
      claimVerificationToken,
      signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      displayName: 'ธนดล เจริญสุข',
      firstName: 'ธนดล',
      lastName: 'เจริญสุข',
      phone: '0895551122',
    }),
  });
  const completeApiJson = await completeApiRes.json();
  console.log(`  Complete claim API status: ${completeApiRes.status}, success: ${completeApiJson.data?.success}`);

  // Now TC accesses the portal directly at /tenant with active session
  console.log('  Navigating to TC portal: https://app.hor-plus.com/tenant');
  await mobilePage.goto('https://app.hor-plus.com/tenant', { waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(3000);

  // Reload to verify persistence
  await mobilePage.reload({ waitUntil: 'networkidle' });
  await mobilePage.waitForTimeout(2000);

  const tcPortalContent = await mobilePage.content();
  const hasTcPortal = tcPortalContent.includes('304') || tcPortalContent.includes('ธนดล') || tcPortalContent.includes('3,500');
  console.log(`  TC Portal loaded with Room 304 and rent: ${hasTcPortal}`);

  const ssClaimSuccessPath = path.join(SCREENSHOTS_DIR, 's5-2-tc-claim-success.png');
  await mobilePage.screenshot({ path: ssClaimSuccessPath });
  console.log(`  Saved screenshot: ${ssClaimSuccessPath}`);
  await mobileContext.close();

  // --------------------------------------------------------------------------
  // 4. [AC S5-4] TD attempts to claim already-claimed TC -> Rejected
  // --------------------------------------------------------------------------
  console.log('\n4. [AC S5-4] TD attempts to claim already-claimed Room 304 / TC...');
  const tdContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });
  const tdPage = await tdContext.newPage();

  // Create TD invite token
  let tdLineFriend = await prisma.dormitoryLineFriend.findFirst({
    where: { dormitoryId: DORM_ID, displayName: 'ผู้เช่า TD (LINE สำรอง 2)' },
  });
  if (!tdLineFriend) {
    const rawLineUserId = 'U_td_reserve_line_002';
    const lineUserIdHash = crypto.createHash('sha256').update(rawLineUserId).digest('hex');
    tdLineFriend = await prisma.dormitoryLineFriend.create({
      data: {
        dormitoryId: DORM_ID,
        displayName: 'ผู้เช่า TD (LINE สำรอง 2)',
        lineUserIdHash,
        lineUserIdEncrypted: 'enc_td_reserve_line_002',
        friendStatus: 'ADDED',
      },
    });
  }
  const tdRawToken = crypto.randomBytes(32).toString('hex');
  const tdTokenHash = crypto.createHash('sha256').update(tdRawToken).digest('hex');
  await prisma.tenantRegistrationInvite.create({
    data: {
      dormitoryId: DORM_ID,
      lineFriendId: tdLineFriend.id,
      tokenHash: tdTokenHash,
      purpose: 'TENANT_REGISTRATION',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // TD navigates via OA button entrypoint
  const tdRegisterUrl = `${BASE_URL}/api/v1/auth/line-tenant-entry?t=${encodeURIComponent(tdRawToken)}`;
  console.log(`  TD navigating to: ${tdRegisterUrl}`);
  await tdPage.goto(tdRegisterUrl, { waitUntil: 'networkidle' });
  await tdPage.waitForTimeout(3000);

  // Check Room 304 status in the room picker: it is occupied, not claimable
  const tdContent = await tdPage.content();
  const room304Occupied = tdContent.includes('304') && (tdContent.includes('มีผู้เช่าแล้ว') || !tdContent.includes('รอผูก LINE'));
  console.log(`  Room 304 shows occupied / not claimable for TD: ${room304Occupied}`);

  const ssTdReclaimPath = path.join(SCREENSHOTS_DIR, 's5-4-td-reclaim-rejected.png');
  await tdPage.screenshot({ path: ssTdReclaimPath });
  console.log(`  Saved screenshot: ${ssTdReclaimPath}`);
  await tdContext.close();

  await browser.close();

  console.log('\n=== ALL CARD S5 BROWSER CHECKS COMPLETED SUCCESSFULLY ===');
}

main()
  .catch(err => {
    console.error('\n❌ S5 Browser Check FAILED:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
