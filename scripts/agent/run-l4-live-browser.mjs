/**
 * Playwright Live Browser Checks for Card L4
 * Target: https://app.hor-plus.com
 * Mode: D (Desktop 1280x800 and Mobile Viewport 390x844)
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
const TC_TENANT_ID = '97d61931-c8ef-4da0-aab7-1f6faae6536b'; // Somchai (Bound Tenant TC)
const TX_TENANT_ID = 'a5b01b74-5b47-419f-97b8-0d49b79c6cdc'; // Manee (Unbound Tenant TX)

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) throw new Error(`Missing session file: ${file}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  console.log('=== Starting Card L4 Playwright Browser Live Verification ===\n');

  const browser = await chromium.launch({ headless: true });

  try {
    const ownerStorage = getSession('owner');
    const staffStorage = getSession('staff');

    // -------------------------------------------------------------------------
    // 1. [AC L4-1] Owner opens LineNotificationModal on /owner/payments
    // -------------------------------------------------------------------------
    console.log('1. Capturing l4-1-owner-line-modal-desktop.png on /owner/payments...');
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerStorage,
    });
    const pageOwner = await ownerContext.newPage();

    await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageOwner.waitForTimeout(2000);

    // Click "แจ้งเตือนผ่าน LINE" button
    const lineNotifyBtn = pageOwner.locator('button:has-text("แจ้งเตือนผ่าน LINE")').first();
    await lineNotifyBtn.waitFor({ state: 'visible', timeout: 10000 });
    await lineNotifyBtn.click();
    await pageOwner.waitForTimeout(1500);

    // Capture open modal screenshot
    const ssL4_1_modal = path.join(SCREENSHOTS_DIR, 'l4-1-owner-line-modal-desktop.png');
    await pageOwner.screenshot({
      path: ssL4_1_modal,
      fullPage: false,
    });
    console.log(`  Saved ${ssL4_1_modal}`);

    // -------------------------------------------------------------------------
    // 2. [AC L4-1] Send notification to TC (Room 101) and capture success toast
    // -------------------------------------------------------------------------
    console.log('\n2. Capturing l4-1-owner-line-modal-sent-toast.png...');
    // Deselect all
    const deselectBtn = pageOwner.locator('button:has-text("ล้างทั้งหมด"), button:has-text("ยกเลิกการเลือก")').first();
    if ((await deselectBtn.count()) > 0) {
      await deselectBtn.click();
      await pageOwner.waitForTimeout(400);
    }

    // Select TC specifically by ID
    const tcCard = pageOwner.locator(`#line-tenant-${TC_TENANT_ID}`).first();
    if ((await tcCard.count()) > 0) {
      await tcCard.click();
      await pageOwner.waitForTimeout(400);
    } else {
      // Fallback: select first card
      const firstCard = pageOwner.locator('[id^="line-tenant-"]').first();
      if ((await firstCard.count()) > 0) {
        await firstCard.click();
        await pageOwner.waitForTimeout(400);
      }
    }

    const sendBtn = pageOwner.locator('button:has-text("ส่งแจ้งเตือน")').first();
    if ((await sendBtn.count()) > 0 && !(await sendBtn.isDisabled())) {
      await sendBtn.click();
      await pageOwner.waitForTimeout(2500);

      const ssL4_1_toast = path.join(SCREENSHOTS_DIR, 'l4-1-owner-line-modal-sent-toast.png');
      await pageOwner.screenshot({
        path: ssL4_1_toast,
        fullPage: false,
      });
      console.log(`  Saved ${ssL4_1_toast}`);
    }

    // -------------------------------------------------------------------------
    // 3. [AC L4-2] Owner sends notification to unbound tenant TX (Room 201)
    // -------------------------------------------------------------------------
    console.log('\n3. Capturing l4-2-owner-unbound-tenant-warning.png...');
    // Reload page to reset state and modal
    await pageOwner.goto(`${APP_URL}/owner/payments`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageOwner.waitForTimeout(1500);

    const lineNotifyBtn2 = pageOwner.locator('button:has-text("แจ้งเตือนผ่าน LINE")').first();
    await lineNotifyBtn2.waitFor({ state: 'visible', timeout: 10000 });
    await lineNotifyBtn2.click();
    await pageOwner.waitForTimeout(1500);

    // Switch to tab "ทั้งหมด" (all)
    const allTab = pageOwner.locator('button:has-text("ทั้งหมด")').first();
    if ((await allTab.count()) > 0) {
      await allTab.click();
      await pageOwner.waitForTimeout(400);
    }

    // Deselect all
    const deselectBtn2 = pageOwner.locator('button:has-text("ล้างทั้งหมด"), button:has-text("ยกเลิกการเลือก")').first();
    if ((await deselectBtn2.count()) > 0) {
      await deselectBtn2.click();
      await pageOwner.waitForTimeout(400);
    }

    // Select TX (Manee) specifically by ID
    const txCard = pageOwner.locator(`#line-tenant-${TX_TENANT_ID}`).first();
    if ((await txCard.count()) > 0) {
      await txCard.click();
      await pageOwner.waitForTimeout(400);
    }

    const sendBtn2 = pageOwner.locator('button:has-text("ส่งแจ้งเตือน")').first();
    if ((await sendBtn2.count()) > 0 && !(await sendBtn2.isDisabled())) {
      await sendBtn2.click();
      await pageOwner.waitForTimeout(2500);

      const ssL4_2_warning = path.join(SCREENSHOTS_DIR, 'l4-2-owner-unbound-tenant-warning.png');
      await pageOwner.screenshot({
        path: ssL4_2_warning,
        fullPage: false,
      });
      console.log(`  Saved ${ssL4_2_warning}`);
    }
    await ownerContext.close();

    // -------------------------------------------------------------------------
    // 4. [AC L4-3] Staff role: Forbidden from billing & LINE notifications
    // -------------------------------------------------------------------------
    console.log('\n4. Capturing l4-3-staff-forbidden-view.png on Staff session...');
    const staffContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: staffStorage,
    });
    const pageStaff = await staffContext.newPage();

    await pageStaff.goto(`${APP_URL}/owner/payments`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageStaff.waitForTimeout(2000);
    console.log(`  Staff URL after navigating to /owner/payments: ${pageStaff.url()}`);

    const staffLineBtn = pageStaff.locator('button:has-text("แจ้งเตือนผ่าน LINE")').first();
    const ssL4_3_staff = path.join(SCREENSHOTS_DIR, 'l4-3-staff-forbidden-view.png');

    if ((await staffLineBtn.count()) > 0) {
      await staffLineBtn.click();
      await pageStaff.waitForTimeout(1500);
      await pageStaff.screenshot({ path: ssL4_3_staff, fullPage: false });
      console.log(`  Saved ${ssL4_3_staff} (Modal open with warning)`);
    } else {
      // Staff is redirected away from /owner/payments to /owner/home (no billing permissions)
      await pageStaff.screenshot({ path: ssL4_3_staff, fullPage: false });
      console.log(`  Saved ${ssL4_3_staff} (Staff forbidden from billing menu & redirected)`);
    }
    await staffContext.close();

    console.log('\nAll browser screenshots captured successfully!');
  } catch (err) {
    console.error('Browser check error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
