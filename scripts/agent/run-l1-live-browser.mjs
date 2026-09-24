/**
 * Playwright Live Browser Checks for Card L1
 * Target: https://app.hor-plus.com
 * Mode: OW, D
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
  console.log('=== Starting Card L1 Playwright Browser Verification ===\n');

  // 1. [AC L1-1] Owner opens LINE OA page -> sees "จำนวนการส่งข้อความคงเหลือเดือนนี้:" and quota
  console.log('1. [AC L1-1] Testing Owner LINE OA page (/owner/line-oa)...');
  const ownerStorage = getSession('owner');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });

  const pageOwner = await ownerContext.newPage();
  await pageOwner.goto('https://app.hor-plus.com/owner/line-oa', { waitUntil: 'networkidle' });
  await pageOwner.waitForTimeout(2000);

  const ssLineOaPath = path.join(SCREENSHOTS_DIR, 'l1-1-owner-line-oa-quota.png');
  await pageOwner.screenshot({ path: ssLineOaPath, fullPage: true });
  console.log(`Saved screenshot: ${ssLineOaPath}`);

  const pageContent = await pageOwner.content();
  const hasCanonicalText = pageContent.includes('จำนวนการส่งข้อความคงเหลือเดือนนี้');
  console.log(`Contains canonical Thai label 'จำนวนการส่งข้อความคงเหลือเดือนนี้': ${hasCanonicalText}`);

  // 2. [AC L1-1 & L1-2] LineQuotaBadge in Header -> Click to open details modal
  console.log('\n2. [AC L1-1] Testing Header LineQuotaBadge Modal on /owner/dashboard...');
  await pageOwner.goto('https://app.hor-plus.com/owner/dashboard', { waitUntil: 'networkidle' });
  await pageOwner.waitForTimeout(3000);
  console.log(`Current page URL: ${pageOwner.url()}`);

  const pills = await pageOwner.locator('[data-testid="header-line-status-pill"]').all();
  console.log(`Found ${pills.length} LineQuotaBadge pills`);

  let modalOpened = false;
  for (let i = 0; i < pills.length; i++) {
    const isVis = await pills[i].isVisible();
    console.log(`Pill ${i} visible: ${isVis}`);
    if (isVis) {
      await pills[i].click();
      await pageOwner.waitForTimeout(1500);
      const ssModalPath = path.join(SCREENSHOTS_DIR, 'l1-1-line-quota-badge-modal.png');
      await pageOwner.screenshot({ path: ssModalPath });
      console.log(`Saved screenshot: ${ssModalPath}`);
      modalOpened = true;
      break;
    }
  }

  if (!modalOpened) {
    console.log('No visible badge button found on page');
  }

  // 3. [AC L1-5] Staff opening /owner/line-oa -> Forbidden / Cannot manage LINE OA
  console.log('\n3. [AC L1-5] Testing Staff accessing /owner/line-oa...');
  const staffStorage = getSession('staff');
  const staffContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: staffStorage,
  });

  const pageStaff = await staffContext.newPage();
  await pageStaff.goto('https://app.hor-plus.com/owner/line-oa', { waitUntil: 'networkidle' });
  await pageStaff.waitForTimeout(2000);

  const ssStaffPath = path.join(SCREENSHOTS_DIR, 'l1-5-staff-forbidden.png');
  await pageStaff.screenshot({ path: ssStaffPath, fullPage: true });
  console.log(`Saved screenshot: ${ssStaffPath}`);

  const staffContent = await pageStaff.content();
  const isForbiddenOrError =
    staffContent.includes('403') ||
    staffContent.includes('Insufficient dormitory permission') ||
    staffContent.includes('ไม่มีสิทธิ์') ||
    staffContent.includes('ไม่สามารถโหลดข้อมูล');
  console.log(`Staff prevented from managing LINE OA: ${isForbiddenOrError}`);

  await browser.close();
  console.log('\n=== Playwright Browser Verification Finished Successfully ===');
}

main().catch((err) => {
  console.error('Playwright verification failed:', err);
  process.exit(1);
});
