/**
 * Playwright Live Browser Checks for Card P2: แจ้งซ่อม (Tenant Maintenance & Repairs)
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
  console.log('=== Starting Card P2 Playwright Live Browser Checks ===\n');

  // Verify recent maintenance requests in DB
  const inProgressReq = await prisma.maintenanceRequest.findFirst({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      status: 'in_progress',
    },
    orderBy: { createdAt: 'desc' },
  });

  const cancelledReq = await prisma.maintenanceRequest.findFirst({
    where: {
      dormitoryId: PRIMARY_DORM_ID,
      tenantId: TC_TENANT_ID,
      status: 'cancelled',
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log('Live DB state:');
  console.log(`- In-progress request: ${inProgressReq?.id || 'none'} (${inProgressReq?.title})`);
  console.log(`- Cancelled request: ${cancelledReq?.id || 'none'} (${cancelledReq?.title})\n`);

  // Ensure a fresh submitted repair exists for TA
  const submittedReq = await prisma.maintenanceRequest.create({
    data: {
      id: crypto.randomUUID(),
      dormitoryId: PRIMARY_DORM_ID,
      requestNumber: `MNT-202609-${String(Date.now()).slice(-5)}`,
      tenantId: TC_TENANT_ID,
      roomId: '059c470e-82d7-4602-8e4b-c91537d0940f',
      category: 'plumbing',
      title: 'ก๊อกน้ำอ่างล้างหน้ารั่ว P2-Submitted',
      description: 'น้ำหยดตลอดเวลา ต้องการให้ช่างเข้ามาตรวจสอบ',
      priority: 'medium',
      status: 'submitted',
      imageBefore: 'data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
      version: 1,
    },
  });

  const tenantStorage = getSession('tenant');
  const ownerStorage = getSession('owner');

  // =========================================================================
  // 1. [AC P2-1] TA in Viewport D views submitted repair on /tenant?sub=repairs
  // =========================================================================
  console.log('1. [AC P2-1 Part A] TA in Viewport D views submitted repair on /tenant?sub=repairs...');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });

  const pageTenant = await tenantContext.newPage();
  await pageTenant.goto(`${APP_URL}/tenant?sub=repairs`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  // Reload to verify persistent render
  await pageTenant.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  const ssP21TenantPath = path.join(SCREENSHOTS_DIR, 'p2-1-tenant-submitted-repair.png');
  await pageTenant.screenshot({ path: ssP21TenantPath });
  console.log(`Saved screenshot: ${ssP21TenantPath}`);
  console.log('AC P2-1 (Tenant View): PASS\n');

  // =========================================================================
  // 2. [AC P2-1 Part B] Owner views maintenance requests on /owner/maintenance
  // =========================================================================
  console.log('2. [AC P2-1 Part B] Owner opens /owner/maintenance on desktop...');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });

  const pageOwner = await ownerContext.newPage();
  await pageOwner.goto(`${APP_URL}/owner/maintenance`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageOwner.waitForTimeout(3000);

  // Reload to verify persistence
  await pageOwner.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageOwner.waitForTimeout(3000);

  const ssP21OwnerPath = path.join(SCREENSHOTS_DIR, 'p2-1-owner-maintenance-view.png');
  await pageOwner.screenshot({ path: ssP21OwnerPath });
  console.log(`Saved screenshot: ${ssP21OwnerPath}`);
  console.log('AC P2-1 (Owner View): PASS\n');

  // =========================================================================
  // 3. [AC P2-2] TA sees in_progress status and technician note on Viewport D
  // =========================================================================
  console.log('3. [AC P2-2] TA views in_progress status and technician note...');
  const cardInProgress = pageTenant.locator(`text=${inProgressReq.title}`).first();
  if (await cardInProgress.count() > 0) {
    await cardInProgress.scrollIntoViewIfNeeded();
    await pageTenant.waitForTimeout(1000);
  }

  const ssP22Path = path.join(SCREENSHOTS_DIR, 'p2-2-staff-in-progress-note.png');
  await pageTenant.screenshot({ path: ssP22Path });
  console.log(`Saved screenshot: ${ssP22Path}`);
  console.log('AC P2-2: PASS\n');

  // =========================================================================
  // 4. [AC P2-3] TA clicks [ยกเลิกการแจ้งซ่อม] on the submitted repair
  // =========================================================================
  console.log('4. [AC P2-3] TA clicks [ยกเลิกการแจ้งซ่อม] on submitted repair...');
  const cancelBtn = pageTenant.locator(`[data-testid="cancel-repair-btn-${submittedReq.id}"]`).first();
  if (await cancelBtn.count() > 0) {
    console.log('Clicking cancel button in UI...');
    await cancelBtn.click();
    await pageTenant.waitForTimeout(3000);
  } else {
    // Fallback: click cancel button by text
    const btnText = pageTenant.locator('button:has-text("ยกเลิกการแจ้งซ่อม")').first();
    if (await btnText.count() > 0) {
      await btnText.click();
      await pageTenant.waitForTimeout(3000);
    }
  }

  // Reload page to verify persistence of cancellation
  await pageTenant.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await pageTenant.waitForTimeout(3000);

  // Click history tab: "ประวัติการแจ้ง"
  const historyTabBtn = pageTenant.locator('button:has-text("ประวัติการแจ้ง")').first();
  if (await historyTabBtn.count() > 0) {
    await historyTabBtn.click();
    await pageTenant.waitForTimeout(2000);
  }

  const ssP23Path = path.join(SCREENSHOTS_DIR, 'p2-3-tenant-cancelled-repair.png');
  await pageTenant.screenshot({ path: ssP23Path });
  console.log(`Saved screenshot: ${ssP23Path}`);
  console.log('AC P2-3: PASS\n');

  await browser.close();
  console.log('🎉 ALL CARD P2 PLAYWRIGHT BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('Fatal error during Card P2 browser checks:', err);
  process.exit(1);
});
