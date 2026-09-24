/**
 * Playwright Live Browser Checks for Card S6
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (/owner/tenants)
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const APP_URL = 'https://app.hor-plus.com';
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002'; // Comprehensive Manor

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const prisma = getPrismaClient();

  console.log('=== Starting Card S6 Playwright Browser Live Verification ===\n');

  // =========================================================================
  // 1. [AC S6-1 & AC S6-4 Part 1] Mobile Registration on Live Site (Viewport D 390x844)
  // =========================================================================
  console.log('1. [AC S6-1] Navigating to live registration page in Viewport D (390x844)...');
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });

  const pagePublic = await publicContext.newPage();
  const registerUrl = `${APP_URL}/tenant/register?dormitoryId=${PRIMARY_DORM_ID}&room=204`;
  console.log(`Loading URL: ${registerUrl}`);
  await pagePublic.goto(registerUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pagePublic.waitForSelector('[data-testid="bottom-nav-next-btn"]', { timeout: 30000 });
  await pagePublic.waitForTimeout(1000);

  // Step 1: Room & Move-in date -> Click Next
  console.log('Navigating Step 1 -> Step 2...');
  await pagePublic.click('[data-testid="bottom-nav-next-btn"]');
  await pagePublic.waitForTimeout(500);

  // Step 2: Personal Info
  console.log('Filling Step 2 (Personal info)...');
  const tdRandom = Math.floor(100000 + Math.random() * 900000);
  const tdPhone = `085${tdRandom}3`;
  await pagePublic.fill('[data-testid="tenant-fullname-input"]', 'ทัศนีย์ ทดสอบหกสี่');
  await pagePublic.fill('[data-testid="tenant-citizen-id-input"]', '1100100123456');
  await pagePublic.fill('[data-testid="tenant-phone-input"]', tdPhone);

  // Select birthdate via picker popover
  console.log('Selecting birthdate via date picker popover...');
  await pagePublic.click('[data-testid="tenant-birthdate-input"]');
  await pagePublic.waitForSelector('[data-testid="owner-date-input-popover"]', { timeout: 5000 });
  const dayBtn = pagePublic.locator('[data-testid="owner-date-input-popover"] button').filter({ hasText: /^15$/ });
  if ((await dayBtn.count()) > 0) {
    await dayBtn.first().click();
  } else {
    await pagePublic.locator('[data-testid="owner-date-input-popover"] button').nth(4).click();
  }
  await pagePublic.waitForTimeout(500);

  await pagePublic.fill('[data-testid="tenant-address-input"]', '123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110');
  await pagePublic.click('[data-testid="bottom-nav-next-btn"]');
  await pagePublic.waitForTimeout(500);

  // Step 3: Emergency Contact
  console.log('Filling Step 3 (Emergency contact)...');
  await pagePublic.fill('[data-testid="tenant-emergency-name-input"]', 'สมศรี ผู้ติดต่อ');
  await pagePublic.fill('[data-testid="tenant-emergency-phone-input"]', '0823456789');
  await pagePublic.click('[data-testid="bottom-nav-next-btn"]');
  await pagePublic.waitForTimeout(500);

  // Step 4: Vehicle & Pet
  console.log('Navigating Step 4 -> Step 5...');
  await pagePublic.click('[data-testid="bottom-nav-next-btn"]');
  await pagePublic.waitForTimeout(1000);

  // Step 5: Real-time Contract Document & Signature
  console.log('Step 5 reached! Verifying contract document and rules display...');
  await pagePublic.waitForSelector('#step-5', { state: 'visible' });

  // Scroll to contract terms section (ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย) and signature placement
  const rulesSection = pagePublic.locator('text=ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย');
  await rulesSection.scrollIntoViewIfNeeded();
  await pagePublic.waitForTimeout(1000);

  // [AC S6-1] Screenshot: Dormitory terms rendered, ownerSignature is null / not leaked
  const ssTermsPath = path.join(SCREENSHOTS_DIR, 's6-1-public-policy-terms.png');
  await pagePublic.screenshot({ path: ssTermsPath });
  console.log(`Saved screenshot (AC S6-1): ${ssTermsPath}`);

  // Now perform signature drawing on canvas
  console.log('Drawing tenant signature on canvas...');
  await pagePublic.locator('[data-testid="tenant-signature-canvas"]').scrollIntoViewIfNeeded();
  await pagePublic.waitForTimeout(500);

  // Draw on canvas via browser evaluation
  await pagePublic.evaluate(() => {
    const canvas = document.querySelector('[data-testid="tenant-signature-canvas"]');
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#312e81';
      ctx.beginPath();
      ctx.moveTo(30, 30);
      ctx.lineTo(150, 80);
      ctx.lineTo(250, 50);
      ctx.stroke();

      const pDown = new MouseEvent('mousedown', { clientX: rect.left + 30, clientY: rect.top + 30, bubbles: true });
      const pMove = new MouseEvent('mousemove', { clientX: rect.left + 150, clientY: rect.top + 80, bubbles: true });
      const pUp = new MouseEvent('mouseup', { clientX: rect.left + 250, clientY: rect.top + 50, bubbles: true });
      canvas.dispatchEvent(pDown);
      canvas.dispatchEvent(pMove);
      canvas.dispatchEvent(pUp);
    }
  });
  await pagePublic.waitForTimeout(500);

  // Agree to terms checkbox
  console.log('Checking agreed terms checkbox...');
  await pagePublic.locator('[data-testid="tenant-agree-terms-checkbox"]').scrollIntoViewIfNeeded();
  await pagePublic.check('[data-testid="tenant-agree-terms-checkbox"]');
  await pagePublic.waitForTimeout(500);

  // Track created registration ID from API
  let createdReqId = null;
  pagePublic.on('response', async (res) => {
    if (res.url().includes('tenant-registrations') && res.request().method() === 'POST') {
      try {
        const json = await res.json();
        if (json?.data?.id) createdReqId = json.data.id;
      } catch {}
    }
  });

  // Submit Registration Request
  console.log('Submitting tenant registration request on live site...');
  await pagePublic.locator('[data-testid="tenant-registration-submit-btn"]').scrollIntoViewIfNeeded();
  await pagePublic.click('[data-testid="tenant-registration-submit-btn"]');

  // Wait for submission completion screen (AC S6-4)
  console.log('Waiting for completion screen...');
  await pagePublic.waitForSelector('text=ส่งคำขอลงทะเบียนเรียบร้อยแล้ว', { timeout: 20000 });
  await pagePublic.waitForTimeout(1500);

  // [AC S6-4 Part 1] Screenshot: TD Registered Pending Screen
  const ssTdPendingPath = path.join(SCREENSHOTS_DIR, 's6-4-td-registered-pending.png');
  await pagePublic.screenshot({ path: ssTdPendingPath });
  console.log(`Saved screenshot (AC S6-4 TD Pending): ${ssTdPendingPath}`);
  console.log(`Captured TD registration ID: ${createdReqId}`);

  // Close public context cleanly before opening owner context
  await publicContext.close();

  // =========================================================================
  // 2. [AC S6-4 Part 2] Owner Rejection with Reason "ทดสอบระบบ" on /owner/tenants
  // =========================================================================
  console.log('\n2. [AC S6-4 Part 2] Navigating to Owner Portal on live site (/owner/tenants)...');

  const ownerStorage = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, 'owner.json'), 'utf8'));
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });

  const pageOwner = await ownerContext.newPage();
  pageOwner.on('request', (req) => {
    if (req.url().includes('reject') || req.url().includes('tenant-registrations')) {
      console.log('OWNER REQUEST:', req.method(), req.url(), req.postData());
    }
  });
  pageOwner.on('response', async (res) => {
    if (res.url().includes('reject') || res.url().includes('tenant-registrations')) {
      console.log('OWNER RESPONSE:', res.status(), res.url());
      try {
        console.log('OWNER RESPONSE BODY:', (await res.text()).slice(0, 300));
      } catch {}
    }
  });

  await pageOwner.goto(`${APP_URL}/owner/tenants`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await pageOwner.waitForTimeout(2000);

  // Click on "รอตรวจสอบ" tab to see pending applicants
  console.log('Clicking "รอตรวจสอบ" filter tab...');
  const pendingTabBtn = pageOwner.locator('button:has-text("รอตรวจสอบ")');
  await pendingTabBtn.waitFor({ state: 'visible', timeout: 15000 });
  await pendingTabBtn.click();
  await pageOwner.waitForTimeout(1500);

  // Find TD applicant item in the list
  console.log('Finding applicant "ทัศนีย์ ทดสอบหกสี่"...');
  const applicantItem = pageOwner.locator('text=ทัศนีย์ ทดสอบหกสี่').first();
  await applicantItem.waitFor({ state: 'visible', timeout: 15000 });
  await applicantItem.click();
  await pageOwner.waitForTimeout(1500);

  // Click "ปฏิเสธคำขอ" in detail panel
  console.log('Clicking "ปฏิเสธคำขอ" button in applicant detail panel...');
  const rejectBtn = pageOwner.locator('button[title="ปฏิเสธคำขอเช่า"]');
  await rejectBtn.waitFor({ state: 'visible', timeout: 10000 });
  await rejectBtn.click();
  await pageOwner.waitForTimeout(1000);

  // TenantRejectSheet is open
  console.log('TenantRejectSheet opened. Selecting "อื่นๆ" and entering reason "ทดสอบระบบ"...');
  await pageOwner.waitForSelector('[data-testid="reject-reason-select"]', { timeout: 10000 });
  await pageOwner.selectOption('[data-testid="reject-reason-select"]', 'อื่นๆ');
  await pageOwner.waitForTimeout(500);

  await pageOwner.waitForSelector('[data-testid="reject-custom-reason-input"]', { timeout: 10000 });
  await pageOwner.fill('[data-testid="reject-custom-reason-input"]', 'ทดสอบระบบ');
  await pageOwner.waitForTimeout(1000);

  // [AC S6-4 Part 2] Screenshot: Owner rejection modal with reason "ทดสอบระบบ"
  const ssOwnerRejectPath = path.join(SCREENSHOTS_DIR, 's6-4-owner-rejected-reason.png');
  await pageOwner.screenshot({ path: ssOwnerRejectPath });
  console.log(`Saved screenshot (AC S6-4 Owner Reject Reason): ${ssOwnerRejectPath}`);

  // Confirm rejection
  console.log('Confirming rejection...');
  await pageOwner.click('[data-testid="reject-sheet-confirm-btn"]');
  await pageOwner.waitForTimeout(3000);

  // Verify DB state
  if (createdReqId) {
    const updatedReq = await prisma.tenantRegistrationRequest.findUnique({
      where: { id: createdReqId },
    });
    console.log(`DB Verification: ID=${createdReqId}, Status=${updatedReq?.status}, RejectedReason="${updatedReq?.rejectedReason}"`);
  }

  await ownerContext.close();
  await browser.close();
  console.log('\n=== All Genuine Playwright Live Browser Screenshots Successfully Captured ===');
}

main().catch((err) => {
  console.error('Fatal error during browser verification:', err);
  process.exit(1);
});
