/**
 * Playwright Live Browser Checks for Card L2
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium) and Owner Desktop (1280x800)
 */

import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');
const SESSIONS_DIR = path.join(ROOT_DIR, '.agents/local/sessions');

const APP_URL = 'https://app.hor-plus.com';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  console.log('=== Starting Card L2 Playwright Browser Live Verification ===\n');

  try {
    const tenantStorage = getSession('tenant');
    const ownerStorage = getSession('owner');

    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      storageState: tenantStorage,
    });
    const pageTenant = await tenantContext.newPage();

    // 1. [AC L2-1] Screenshot: l2-1-tenant-invoice-payments-tab.png
    console.log('Capturing l2-1-tenant-invoice-payments-tab.png on /tenant?sub=payments_tab...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=payments_tab`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(3000);
    const ssL2_1 = path.join(SCREENSHOTS_DIR, 'l2-1-tenant-invoice-payments-tab.png');
    await pageTenant.screenshot({
      path: ssL2_1,
      fullPage: true,
    });
    console.log(`Saved ${ssL2_1}`);

    // 2. [AC L2-2] Screenshot: l2-2-tenant-receipts-tab.png
    console.log('\nCapturing l2-2-tenant-receipts-tab.png on /tenant?sub=receipts_tab...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=receipts_tab`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(3000);
    // Scroll down to the paid bills / receipts section
    const receiptBtn = pageTenant.locator('button[data-testid^="btn-view-receipt-"], button:has-text("ดูใบเสร็จ")').first();
    if ((await receiptBtn.count()) > 0) {
      await receiptBtn.scrollIntoViewIfNeeded();
      await pageTenant.waitForTimeout(1000);
    } else {
      await pageTenant.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await pageTenant.waitForTimeout(1000);
    }
    const ssL2_2 = path.join(SCREENSHOTS_DIR, 'l2-2-tenant-receipts-tab.png');
    await pageTenant.screenshot({
      path: ssL2_2,
      fullPage: false,
    });
    console.log(`Saved ${ssL2_2}`);

    // 3. [AC L2-3] Screenshot: l2-3-tenant-rejection-reason.png
    console.log('\nCapturing l2-3-tenant-rejection-reason.png on /tenant?sub=payments_tab (clicking resubmit)...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=payments_tab`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageTenant.waitForTimeout(3000);
    const resubmitBtn = pageTenant.locator('button:has-text("ส่งสลิปใหม่")').first();
    if ((await resubmitBtn.count()) > 0) {
      await resubmitBtn.click();
      await pageTenant.waitForTimeout(2000);
      const rejectionAlert = pageTenant.locator('text=สลิปก่อนหน้านี้ถูกปฏิเสธ').first();
      if ((await rejectionAlert.count()) > 0) {
        await rejectionAlert.scrollIntoViewIfNeeded();
        await pageTenant.waitForTimeout(500);
      }
    }
    const ssL2_3 = path.join(SCREENSHOTS_DIR, 'l2-3-tenant-rejection-reason.png');
    await pageTenant.screenshot({
      path: ssL2_3,
      fullPage: false,
    });
    console.log(`Saved ${ssL2_3}`);

    // 4. [AC L2-4 & L2-6] Screenshot: l2-4-owner-billing-unbound.png
    console.log('\nCapturing l2-4-owner-billing-unbound.png on /owner/payments...');
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerStorage,
    });
    const pageOwner = await ownerContext.newPage();
    await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await pageOwner.waitForTimeout(3000);
    const ssL2_4 = path.join(SCREENSHOTS_DIR, 'l2-4-owner-billing-unbound.png');
    await pageOwner.screenshot({
      path: ssL2_4,
      fullPage: true,
    });
    console.log(`Saved ${ssL2_4}`);

    console.log('\n=== All Playwright Browser Screenshots Captured Successfully! ===');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error during Card L2 Playwright browser check:', err);
  process.exit(1);
});
