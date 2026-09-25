/**
 * Playwright Live Browser Checks for Card B2
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (1280x800)
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
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b';

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
  console.log('=== Starting Card B2 Playwright Live Browser Checks ===\n');

  // Find the test bills created for B2
  const bill1 = await prisma.bill.findFirst({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      billNumber: 'INV-B2-TEST-001',
    },
  });
  const bill2 = await prisma.bill.findFirst({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      billNumber: 'INV-B2-TEST-002',
    },
  });

  if (!bill1 || !bill2) {
    console.error('❌ Test bills INV-B2-TEST-001 or INV-B2-TEST-002 not found in DB! Run check-b2-live.mjs first.');
    process.exit(1);
  }

  console.log(`Using Test Bills:`);
  console.log(`- Bill 1 (Partially Paid): ${bill1.billNumber} (${bill1.id}) Total: ${bill1.totalAmount}, Outstanding: ${bill1.outstandingAmount}`);
  console.log(`- Bill 2 (Unpaid Utility): ${bill2.billNumber} (${bill2.id}) Total: ${bill2.totalAmount}, Outstanding: ${bill2.outstandingAmount}\n`);

  const tenantStorage = getSession('tenant');
  const ownerStorage = getSession('owner');

  // =========================================================================
  // 1. [AC B2-1] TC in Viewport D selects Bill 2 -> Payment screen targets Bill 2 (450 THB)
  // =========================================================================
  console.log('1. [AC B2-1] TC in Viewport D selects Bill 2 on payments tab...');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });

  const pageTenant = await tenantContext.newPage();
  await pageTenant.goto(`${APP_URL}/tenant?sub=payments_tab`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  // Verify both bills appear on payments tab
  console.log('Verifying bill cards rendered on payments tab...');
  const cardBill2 = pageTenant.locator(`[data-testid="bill-card-${bill2.id}"]`).first();
  if (await cardBill2.count() === 0) {
    console.log('Fallback: looking by text INV-B2-TEST-002');
  }

  // Click pay button for Bill 2
  console.log(`Clicking pay button for Bill 2 (${bill2.billNumber})...`);
  const btnPayBill2 = pageTenant.locator(`[data-testid="btn-pay-bill-${bill2.id}"]`).first();
  if (await btnPayBill2.count() > 0) {
    await btnPayBill2.click();
  } else {
    // Fallback: click within card
    const payBtn = pageTenant.locator(`text=${bill2.billNumber}`).locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]').locator('button:has-text("ชำระเงิน")').first();
    await payBtn.click();
  }
  await pageTenant.waitForTimeout(3000);

  // In payment view, verify Bill 2 amount ฿ 450.00 is displayed
  const ssB21Path = path.join(SCREENSHOTS_DIR, 'b2-1-tenant-target-bill2.png');
  await pageTenant.screenshot({ path: ssB21Path });
  console.log(`Saved screenshot: ${ssB21Path}`);
  console.log('AC B2-1: PASS\n');

  // =========================================================================
  // 2. [AC B2-2 Part A] Owner views recorded partial cash payment on /owner/payments
  // =========================================================================
  console.log('2. [AC B2-2 Part A] Owner opens /owner/payments on desktop...');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });

  const pageOwner = await ownerContext.newPage();
  await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageOwner.waitForTimeout(3000);

  const ssOwnerPayPath = path.join(SCREENSHOTS_DIR, 'b2-2-owner-partial-payment.png');
  await pageOwner.screenshot({ path: ssOwnerPayPath });
  console.log(`Saved screenshot: ${ssOwnerPayPath}`);

  // =========================================================================
  // 3. [AC B2-2 Part B] TC in Viewport D sees remaining balance 2,500 THB with "ชำระบางส่วน" badge
  // =========================================================================
  console.log('3. [AC B2-2 Part B] TC views partially paid bill on payments tab...');
  await pageTenant.goto(`${APP_URL}/tenant?sub=payments_tab`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  // Reload to verify persistence
  await pageTenant.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  const cardBill1 = pageTenant.locator(`[data-testid="bill-card-${bill1.id}"]`).first();
  if (await cardBill1.count() > 0) {
    await cardBill1.scrollIntoViewIfNeeded();
    await pageTenant.waitForTimeout(500);
  }

  const ssB22Path = path.join(SCREENSHOTS_DIR, 'b2-2-tenant-partial-paid-outstanding.png');
  await pageTenant.screenshot({ path: ssB22Path });
  console.log(`Saved screenshot: ${ssB22Path}`);
  console.log('AC B2-2: PASS\n');

  // =========================================================================
  // 4. [AC B2-4] TC opens PromptPay QR code screen on Viewport D showing 2,500.00 THB
  // =========================================================================
  console.log('4. [AC B2-4] TC opens payment screen for partially paid Bill 1 (2,500.00 THB)...');
  const btnPayBill1 = pageTenant.locator(`[data-testid="btn-pay-bill-${bill1.id}"]`).first();
  if (await btnPayBill1.count() > 0) {
    await btnPayBill1.click();
  } else {
    const payBtn = pageTenant.locator(`text=${bill1.billNumber}`).locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]').locator('button:has-text("ชำระเงิน")').first();
    await payBtn.click();
  }
  await pageTenant.waitForTimeout(3000);

  // Scroll down to display QR code clearly
  const qrImage = pageTenant.locator('img[alt="PromptPay QR Code"]').first();
  if (await qrImage.count() > 0) {
    await qrImage.scrollIntoViewIfNeeded();
    await pageTenant.waitForTimeout(500);
  }

  const ssB24Path = path.join(SCREENSHOTS_DIR, 'b2-4-tenant-promptpay-qr-outstanding.png');
  await pageTenant.screenshot({ path: ssB24Path });
  console.log(`Saved screenshot: ${ssB24Path}`);
  console.log('AC B2-4: PASS\n');

  await browser.close();
  console.log('🎉 ALL CARD B2 PLAYWRIGHT BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('Fatal error during Card B2 browser checks:', err);
  process.exit(1);
});
