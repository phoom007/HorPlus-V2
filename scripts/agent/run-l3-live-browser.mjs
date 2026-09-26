/**
 * Playwright Live Browser Checks for Card L3
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 and Owner Desktop 1280x800)
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
  const prisma = getPrismaClient();

  // Helper to run queries inside RLS context
  async function withDormitoryContext(callback) {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${DORM_ID}, true)`;
      return await callback(tx);
    });
  }

  console.log('=== Starting Card L3 Playwright Browser Live Verification ===\n');

  try {
    const tenantStorage = getSession('tenant');
    const ownerStorage = getSession('owner');

    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      storageState: tenantStorage,
    });
    const pageTenant = await tenantContext.newPage();

    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerStorage,
    });
    const pageOwner = await ownerContext.newPage();

    // -------------------------------------------------------------------------
    // 1. [AC L3-1] Screenshot: l3-1-maintenance-completed-tenant-view.png
    // -------------------------------------------------------------------------
    console.log('1. Capturing l3-1-maintenance-completed-tenant-view.png on /tenant?sub=repairs...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=repairs`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageTenant.waitForTimeout(2000);

    // Click "ประวัติการแจ้ง" tab to show resolved/completed maintenance requests
    const historyTab = pageTenant.locator('button:has-text("ประวัติการแจ้ง"), [role="tab"]:has-text("ประวัติ")').first();
    if ((await historyTab.count()) > 0) {
      await historyTab.click();
      await pageTenant.waitForTimeout(1500);
    }

    const ssL3_1 = path.join(SCREENSHOTS_DIR, 'l3-1-maintenance-completed-tenant-view.png');
    await pageTenant.screenshot({
      path: ssL3_1,
      fullPage: false,
    });
    console.log(`  Saved ${ssL3_1}`);

    // -------------------------------------------------------------------------
    // 2. [AC L3-2] Screenshot: l3-2-owner-announcement-modal.png
    // -------------------------------------------------------------------------
    console.log('\n2. Capturing l3-2-owner-announcement-modal.png on /owner/announcements...');
    await pageOwner.goto(`${APP_URL}/owner/announcements`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageOwner.waitForTimeout(2000);

    // Click "ประกาศ" button to open the form
    const createBtn = pageOwner.locator('button:has-text("ประกาศ")').filter({ hasText: 'ประกาศ' }).first();
    if ((await createBtn.count()) > 0) {
      await createBtn.click();
      await pageOwner.waitForTimeout(1500);

      // Fill in title
      const titleInput = pageOwner.locator('input[placeholder*="แจ้งงดบริการลิฟต์"], input[required]').first();
      if ((await titleInput.count()) > 0) {
        await titleInput.fill('แจ้งฉีดพ่นยากำจัดยุงลายประจำเดือน');
      }

      // Fill in content
      const contentInput = pageOwner.locator('textarea[placeholder*="ระบุกำหนดวัน"]').first();
      if ((await contentInput.count()) > 0) {
        await contentInput.fill('จะมีการฉีดพ่นควันกำจัดยุงลายในวันเสาร์ที่ 27 ก.ย. เวลา 10:00 น. กรุณาปิดประตูหน้าต่างให้มิดชิด');
      }

      // Scroll to checkbox
      const checkbox = pageOwner.locator('[data-testid="announcement-send-line-push-checkbox"]').first();
      if ((await checkbox.count()) > 0) {
        await checkbox.scrollIntoViewIfNeeded();
        await pageOwner.waitForTimeout(500);
      }
    }

    const ssL3_2 = path.join(SCREENSHOTS_DIR, 'l3-2-owner-announcement-modal.png');
    await pageOwner.screenshot({
      path: ssL3_2,
      fullPage: false,
    });
    console.log(`  Saved ${ssL3_2}`);

    // -------------------------------------------------------------------------
    // 3. [AC L3-3] Screenshot: l3-3-tenant-announcement-tab.png
    // -------------------------------------------------------------------------
    console.log('\n3. Capturing l3-3-tenant-announcement-tab.png on /tenant?sub=announcements_tab...');
    await pageTenant.goto(`${APP_URL}/tenant?sub=announcements_tab`, { waitUntil: 'networkidle', timeout: 30000 });
    await pageTenant.waitForTimeout(2000);

    const ssL3_3 = path.join(SCREENSHOTS_DIR, 'l3-3-tenant-announcement-tab.png');
    await pageTenant.screenshot({
      path: ssL3_3,
      fullPage: false,
    });
    console.log(`  Saved ${ssL3_3}`);

    // -------------------------------------------------------------------------
    // 4. [AC L3-4] Screenshot: l3-4-owner-quota-exhausted-toast.png
    // -------------------------------------------------------------------------
    console.log('\n4. Capturing l3-4-owner-quota-exhausted-toast.png on /owner/announcements...');
    // Set quota to exhausted in DB inside RLS context
    const currentPeriodKey = new Date().toISOString().slice(0, 7);
    await withDormitoryContext(async (tx) => {
      await tx.linePushUsage.upsert({
        where: {
          dormitory_push_period_unique: {
            dormitoryId: DORM_ID,
            periodKey: currentPeriodKey,
          },
        },
        create: {
          dormitoryId: DORM_ID,
          periodKey: currentPeriodKey,
          successCount: 300,
          reservedCount: 0,
        },
        update: {
          successCount: 300,
          reservedCount: 0,
        },
      });
    });

    // In the open announcement form on pageOwner, submit
    const submitBtn = pageOwner.locator('button[form="announcement-form"]').first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click();
      console.log('  Submitted announcement with exhausted quota...');
      // Wait for toast to appear
      await pageOwner.waitForSelector('div[role="status"]', { timeout: 8000 }).catch(() => {});
      await pageOwner.waitForTimeout(800);
    }

    const ssL3_4 = path.join(SCREENSHOTS_DIR, 'l3-4-owner-quota-exhausted-toast.png');
    await pageOwner.screenshot({
      path: ssL3_4,
      fullPage: false,
    });
    console.log(`  Saved ${ssL3_4}`);

    // Restore quota back to 0
    await withDormitoryContext(async (tx) => {
      await tx.linePushUsage.update({
        where: {
          dormitory_push_period_unique: {
            dormitoryId: DORM_ID,
            periodKey: currentPeriodKey,
          },
        },
        data: {
          successCount: 0,
          reservedCount: 0,
        },
      });
    });

    console.log('\n🎉 ALL CARD L3 SCREENSHOTS CAPTURED SUCCESSFULLY!');
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
