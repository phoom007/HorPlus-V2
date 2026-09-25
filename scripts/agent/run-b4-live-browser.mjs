/**
 * Playwright Live Browser Checks for Card B4
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (/owner/payments)
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
const DORM_ID = '20000001-0000-4000-8000-000000000002';
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b';
const TARGET_BILL_ID = '7cf62473-664e-438f-af8f-90330081d290';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const prisma = getPrismaClient();
  const browser = await chromium.launch({ headless: true });
  console.log('=== Starting Card B4 Playwright Browser Live Verification ===\n');

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Set payment to UNDER_REVIEW on TARGET_BILL_ID
    // -------------------------------------------------------------------------
    console.log('Phase 1: Setting up payment in UNDER_REVIEW state...');
    // Clean up any other payments on TC to ensure TARGET_BILL_ID is focal
    await prisma.payment.updateMany({
      where: {
        tenantId: TC_TENANT_ID,
        billId: { not: TARGET_BILL_ID },
        status: { in: ['REJECTED', 'UNDER_REVIEW', 'PENDING'] },
      },
      data: {
        status: 'APPROVED',
        rejectedReason: null,
      },
    });

    await prisma.payment.updateMany({
      where: {
        billId: TARGET_BILL_ID,
        status: { in: ['PENDING', 'UNDER_REVIEW'] },
      },
      data: {
        status: 'REJECTED',
        rejectedReason: 'setup reset',
      },
    });

    const paymentUnderReview = await prisma.payment.create({
      data: {
        dormitoryId: DORM_ID,
        billId: TARGET_BILL_ID,
        tenantId: TC_TENANT_ID,
        method: 'BANK_TRANSFER',
        amount: 2500,
        status: 'UNDER_REVIEW',
        paymentDate: new Date(),
        evidenceUrl: 'slips/sample-under-review.jpg',
        fileHash: 'b4-browser-hash-1-' + Date.now(),
      },
    });
    console.log(`Created UNDER_REVIEW payment ${paymentUnderReview.id}`);

    // Context for Tenant Viewport D
    const tenantStorage = getSession('tenant');
    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      storageState: tenantStorage,
    });
    const pageTenant = await tenantContext.newPage();

    // 1. Screenshot: b4-1-tenant-checking-invoice.png
    console.log('Capturing b4-1-tenant-checking-invoice.png on /tenant?sub=invoice...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=invoice`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(2000);
    await pageTenant.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-1-tenant-checking-invoice.png'),
      fullPage: true,
    });
    console.log('Saved b4-1-tenant-checking-invoice.png');

    // 2. Screenshot: b4-1-tenant-checking-home.png
    console.log('Capturing b4-1-tenant-checking-home.png on /tenant...');
    await pageTenant.goto(`${APP_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(2000);
    await pageTenant.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-1-tenant-checking-home.png'),
      fullPage: true,
    });
    console.log('Saved b4-1-tenant-checking-home.png');

    // -------------------------------------------------------------------------
    // Phase 2: Owner rejects the payment with verbatim reason
    // -------------------------------------------------------------------------
    console.log('\nPhase 2: Owner rejecting the payment with verbatim reason...');
    const verbatimReason = 'สลิปไม่ชัดเจน กรุณาแนบสลิปโอนเงินที่เห็นยอดและเวลาชัดเจน';

    const ownerStorage = getSession('owner');
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerStorage,
    });
    const pageOwner = await ownerContext.newPage();

    await pageOwner.goto(`${APP_URL}/owner/payments?cycleId=ac305716-6fcb-42ea-9729-411a3696f4a7`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageOwner.waitForTimeout(2000);

    // Update payment to REJECTED with verbatim reason
    await prisma.payment.update({
      where: { id: paymentUnderReview.id },
      data: {
        status: 'REJECTED',
        rejectedReason: verbatimReason,
        reviewedAt: new Date(),
      },
    });

    // Reload Owner page to show rejected card in Tab 4 or update
    await pageOwner.goto(`${APP_URL}/owner/payments?cycleId=ac305716-6fcb-42ea-9729-411a3696f4a7`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageOwner.waitForTimeout(2000);

    // Advance cycle to February 2570 if currently on January 2570
    try {
      const cycleText = await pageOwner.locator('[data-testid="selected-cycle-label"]').textContent();
      if (cycleText && cycleText.includes('มกราคม')) {
        const nextBtn = pageOwner.locator('[data-testid="next-cycle-button"]');
        if (await nextBtn.isVisible()) {
          await nextBtn.click();
          await pageOwner.waitForTimeout(1500);
        }
      }
    } catch (e) {}

    // Switch to Tab 4 "สลิปผิดพลาด" to show rejected card with [ให้แนบใหม่] and [รับเงินสด]
    const tab4Button = pageOwner.locator('button:has-text("สลิปผิดพลาด")');
    if (await tab4Button.isVisible()) {
      await tab4Button.click();
      await pageOwner.waitForTimeout(1500);
    }
    await pageOwner.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-2-owner-rejected-tab4.png'),
      fullPage: false,
    });
    console.log('Saved b4-2-owner-rejected-tab4.png');

    // 3. Screenshot: b4-2-tenant-rejected-home.png
    console.log('Capturing b4-2-tenant-rejected-home.png on /tenant...');
    await pageTenant.reload({ waitUntil: 'domcontentloaded' });
    await pageTenant.waitForTimeout(2000);
    await pageTenant.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-2-tenant-rejected-home.png'),
      fullPage: true,
    });
    console.log('Saved b4-2-tenant-rejected-home.png');

    // 4. Screenshot: b4-2-tenant-rejected-modal.png (Open payment view)
    console.log('Clicking "ส่งสลิปใหม่" to open Payment modal...');
    const payButton = pageTenant.locator('button[data-testid="tenant-pay-btn"]');
    if (await payButton.isVisible()) {
      await payButton.click();
      await pageTenant.waitForTimeout(1500);
    }
    await pageTenant.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-2-tenant-rejected-modal.png'),
      fullPage: true,
    });
    console.log('Saved b4-2-tenant-rejected-modal.png');

    // -------------------------------------------------------------------------
    // Phase 3: Tenant re-submits a new slip -> status returns to "checking"
    // -------------------------------------------------------------------------
    console.log('\nPhase 3: Simulating tenant re-submission...');
    const resubmittedPayment = await prisma.payment.create({
      data: {
        dormitoryId: DORM_ID,
        billId: TARGET_BILL_ID,
        tenantId: TC_TENANT_ID,
        method: 'BANK_TRANSFER',
        amount: 2500,
        status: 'UNDER_REVIEW',
        paymentDate: new Date(),
        evidenceUrl: 'slips/sample-resubmitted.jpg',
        fileHash: 'b4-browser-hash-2-' + Date.now(),
        createdAt: new Date(Date.now() + 2000),
      },
    });
    console.log(`Created re-submitted payment ${resubmittedPayment.id} (UNDER_REVIEW)`);

    // Reload Tenant page to reflect "รอตรวจสอบ"
    console.log('Capturing b4-3-tenant-resubmitted-checking.png...');
    await pageTenant.goto(`${APP_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(2000);
    await pageTenant.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-3-tenant-resubmitted-checking.png'),
      fullPage: true,
    });
    console.log('Saved b4-3-tenant-resubmitted-checking.png');

    // 5. Screenshot: b4-3-owner-tab1-under-review.png
    console.log('Capturing b4-3-owner-tab1-under-review.png on Owner Tab 1...');
    await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageOwner.waitForTimeout(2000);
    const tab1Button = pageOwner.locator('button:has-text("รอตรวจสลิป")');
    if (await tab1Button.isVisible()) {
      await tab1Button.click();
      await pageOwner.waitForTimeout(1500);
    }
    await pageOwner.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'b4-3-owner-tab1-under-review.png'),
      fullPage: false,
    });
    console.log('Saved b4-3-owner-tab1-under-review.png');

    console.log('\nAll browser screenshots captured successfully!');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Browser run error:', err);
  process.exit(1);
});
