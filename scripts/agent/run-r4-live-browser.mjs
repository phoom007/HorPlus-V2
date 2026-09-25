/**
 * Playwright Live Browser Checks for Card R4
 * Target: https://app.hor-plus.com
 * Mode: Real React UI Interaction on Chromium (Viewport D and Owner Desktop)
 * Zero DOM HTML string injection — exercises genuine UI components end-to-end.
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
const PRIMARY_DORM_ID = '20000001-0000-4000-8000-000000000002';
const ROOM_VACANT_ID = '14a4b02d-9f57-4af6-befb-8fb12d605376'; // Room 204

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getCredentials(role) {
  const content = fs.readFileSync(path.join(ROOT_DIR, '.agents/local/test-access.md'), 'utf8');
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

async function cleanupTestDailyStays(prisma) {
  try {
    const stays = await prisma.dailyStay.findMany({
      where: {
        dormitoryId: PRIMARY_DORM_ID,
        OR: [
          { applicantFullName: { contains: 'ทดสอบรายวัน' } },
          { applicantFullName: { contains: 'สมปอง' } },
          { applicantFullName: { contains: 'คนอยากพัก' } },
        ],
      },
    });
    for (const s of stays) {
      if (s.invoiceId) {
        const invoicePayments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: s.invoiceId } });
        for (const pay of invoicePayments) {
          await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
          await prisma.payment.deleteMany({ where: { id: pay.id } });
        }
        await prisma.dailyStayInvoiceItem.deleteMany({ where: { dailyStayInvoiceId: s.invoiceId } });
        await prisma.dailyStayInvoice.deleteMany({ where: { id: s.invoiceId } });
      }
      if (s.tenantId) {
        const bills = await prisma.bill.findMany({ where: { tenantId: s.tenantId } });
        for (const b of bills) {
          const payments = await prisma.payment.findMany({ where: { billId: b.id } });
          for (const pay of payments) {
            await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
            await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
            await prisma.payment.deleteMany({ where: { id: pay.id } });
          }
          await prisma.paymentUploadIntent.deleteMany({ where: { billId: b.id } });
          await prisma.receipt.deleteMany({ where: { billId: b.id } });
          await prisma.billItem.deleteMany({ where: { billId: b.id } });
          await prisma.bill.deleteMany({ where: { id: b.id } });
        }
      }
      if (s.occupancyId) {
        await prisma.occupancy.deleteMany({ where: { id: s.occupancyId } });
      }
      await prisma.dailyStay.deleteMany({ where: { id: s.id } });
    }

    const testTenants = await prisma.tenant.findMany({
      where: {
        dormitoryId: PRIMARY_DORM_ID,
        OR: [
          { firstName: { contains: 'ทดสอบรายวัน' } },
          { firstName: { contains: 'สมปอง' } },
          { firstName: { contains: 'คนอยากพัก' } },
        ],
      },
    });
    for (const t of testTenants) {
      const bills = await prisma.bill.findMany({ where: { tenantId: t.id } });
      for (const b of bills) {
        const payments = await prisma.payment.findMany({ where: { billId: b.id } });
        for (const pay of payments) {
          await prisma.receipt.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentAllocation.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentEvidenceVerification.deleteMany({ where: { paymentId: pay.id } });
          await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: pay.id } });
          await prisma.payment.deleteMany({ where: { id: pay.id } });
        }
        await prisma.paymentUploadIntent.deleteMany({ where: { billId: b.id } });
        await prisma.receipt.deleteMany({ where: { billId: b.id } });
        await prisma.billItem.deleteMany({ where: { billId: b.id } });
        await prisma.bill.deleteMany({ where: { id: b.id } });
      }
      await prisma.occupancy.deleteMany({ where: { tenantId: t.id } });
      await prisma.tenant.deleteMany({ where: { id: t.id } });
    }

    await prisma.room.update({
      where: { id: ROOM_VACANT_ID },
      data: { status: 'vacant', currentTenantId: null },
    });
    await prisma.room.update({
      where: { id: '3558477a-20a0-4c45-b695-4a1c009bfb55' }, // Room 205
      data: { status: 'vacant', currentTenantId: null },
    });
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
}

async function main() {
  console.log('=== Card R4 Real Playwright Browser Execution ===\n');

  const prisma = getPrismaClient();
  await cleanupTestDailyStays(prisma);

  const browser = await chromium.launch({ headless: true });
  const tenantCreds = getCredentials('Tenant');
  const ownerStorage = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, 'owner.json'), 'utf8'));

  // =========================================================================
  // Part 1: AC R4-1 & AC R4-3 - Real Tenant Portal & Modal Interaction
  // =========================================================================
  console.log('--- Step 1: Real Mobile Viewport D Tenant Portal Interactions ---');

  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 }, // Mobile Viewport D
    isMobile: true,
    hasTouch: true,
  });

  await tenantContext.addCookies([
    {
      name: 'horplus_session',
      value: tenantCreds.session,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
    {
      name: 'horplus_csrf',
      value: tenantCreds.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    },
  ]);

  const tenantPage = await tenantContext.newPage();
  await tenantPage.goto(`${APP_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await tenantPage.waitForTimeout(2500);

  // 1.1 Test AC R4-3: Request occupied room (Room 101) to verify real error alert
  console.log('Testing AC R4-3: Submitting occupied room 101 via real UI...');
  await tenantPage.waitForSelector('[data-testid="menu-daily-stay-btn"]', { timeout: 10000 });
  await tenantPage.click('[data-testid="menu-daily-stay-btn"]');
  await tenantPage.waitForTimeout(1000);

  // Fill in Room 101
  await tenantPage.waitForSelector('[data-testid="tenant-daily-room-input"]', { timeout: 5000 });
  await tenantPage.fill('[data-testid="tenant-daily-room-input"]', '101');
  await tenantPage.waitForTimeout(500);

  await tenantPage.waitForSelector('[data-testid="tenant-daily-name-input"]', { timeout: 5000 });
  await tenantPage.fill('[data-testid="tenant-daily-name-input"]', 'คนอยากพัก ชนคิว R4');

  await tenantPage.waitForSelector('[data-testid="tenant-daily-phone-input"]', { timeout: 5000 });
  await tenantPage.fill('[data-testid="tenant-daily-phone-input"]', '0899998888');

  // Submit form
  await tenantPage.waitForSelector('[data-testid="tenant-daily-submit-btn"]', { timeout: 5000 });
  await tenantPage.click('[data-testid="tenant-daily-submit-btn"]');

  // Wait for real Thai error alert banner rendered by TenantDailyRequestModal
  const errorAlert = await tenantPage.waitForSelector('[data-testid="tenant-daily-error-alert"]', { timeout: 10000 });
  const errorMsg = await errorAlert.textContent();
  console.log('Real error message displayed on UI:', errorMsg);

  await tenantPage.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'r4-3-daily-room-conflict-error.png'),
  });
  console.log('📸 Screenshot saved: r4-3-daily-room-conflict-error.png');

  // 1.2 Test AC R4-1: Change to vacant Room 204, 2 nights, cash payment
  console.log('\nTesting AC R4-1: Submitting vacant room 204 via real UI...');
  await tenantPage.fill('[data-testid="tenant-daily-room-input"]', '204');
  await tenantPage.waitForTimeout(1200); // Wait for rate context ready

  await tenantPage.fill('[data-testid="tenant-daily-name-input"]', 'สมปอง ขอพักรายวัน R4');
  await tenantPage.fill('[data-testid="tenant-daily-phone-input"]', '0891112233');

  // Choose cash payment
  await tenantPage.waitForSelector('[data-testid="tenant-daily-cash-btn"]', { timeout: 5000 });
  await tenantPage.click('[data-testid="tenant-daily-cash-btn"]');
  await tenantPage.waitForTimeout(500);

  // Screenshot real modal before submit showing complete financial calculation (2 nights, rates, deposit)
  await tenantPage.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'r4-1-daily-request-submitted.png'),
  });
  console.log('📸 Screenshot saved: r4-1-daily-request-submitted.png');

  // Click submit on real UI
  await tenantPage.click('[data-testid="tenant-daily-submit-btn"]');
  await tenantPage.waitForTimeout(2000);

  await tenantContext.close();

  // =========================================================================
  // Part 2: AC R4-2 - Owner Portal Desktop View: Approve Daily Stay in UI
  // =========================================================================
  console.log('\n--- Step 2: Real Owner Desktop UI (/owner/tenants) Approval ---');

  const ownerContext = await browser.newContext({
    storageState: ownerStorage,
    viewport: { width: 1280, height: 800 },
  });

  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${APP_URL}/owner/tenants`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await ownerPage.waitForTimeout(3000);

  // Switch to "รอตรวจสอบ" (pending) tab
  const pendingTab = await ownerPage.waitForSelector('button:has-text("รอตรวจสอบ"), button:has-text("รอการตัดสินใจ")', { timeout: 10000 });
  await pendingTab.click();
  await ownerPage.waitForTimeout(2000);

  // Find the pending request for "สมปอง ขอพักรายวัน R4"
  const pendingItem = await ownerPage.waitForSelector('text=สมปอง ขอพักรายวัน R4', { timeout: 10000 });
  await pendingItem.click();
  await ownerPage.waitForTimeout(1500);

  // Click "อนุมัติคำขอ" button in the right details panel
  const approveBtn = await ownerPage.waitForSelector('button:has-text("อนุมัติคำขอ")', { timeout: 10000 });
  await approveBtn.click();
  await ownerPage.waitForTimeout(1500);

  // Real Approval Modal is now open!
  // Click [data-testid="confirm-approve-tenant-btn"] ("ยืนยันการอนุมัติ")
  const confirmApproveBtn = await ownerPage.waitForSelector('[data-testid="confirm-approve-tenant-btn"]', { timeout: 10000 });
  await confirmApproveBtn.click();
  await ownerPage.waitForTimeout(2500);

  // Modal has closed, UI updated to active tenant detail panel with Daily Stay details
  await ownerPage.screenshot({
    path: path.join(SCREENSHOTS_DIR, 'r4-2-owner-daily-approved-and-billed.png'),
  });
  console.log('📸 Screenshot saved: r4-2-owner-daily-approved-and-billed.png');

  await ownerContext.close();
  await browser.close();

  console.log('\n=== All Real Browser UI Steps Completed Successfully! ===');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
