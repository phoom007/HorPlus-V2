/**
 * Playwright Live Browser Checks for Card S2
 * Target: https://app.hor-plus.com
 * Mode: D (Mobile viewport 390x844 on Chromium)
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
  console.log('=== Starting Card S2 Playwright Browser Verification ===\n');

  // --- AC S2-2 & S2-3: No session clean browser context (LINE Login / entry screen) ---
  console.log('1. [AC S2-2 / S2-3] Opening /tenant with NO session (clean context)...');
  const cleanContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  });
  const pageNoSession = await cleanContext.newPage();
  await pageNoSession.goto('https://app.hor-plus.com/tenant', { waitUntil: 'networkidle' });
  await pageNoSession.waitForTimeout(2000);

  const pageContent = await pageNoSession.content();
  const hasNoSessionMessage = pageContent.includes('ยินดีต้อนรับสู่ระบบผู้เช่า HorPlus') || pageContent.includes('เข้าสู่ระบบผู้เช่าผ่าน LINE');
  const hasLoginButton = pageContent.includes('tenant-liff-login-btn') || pageContent.includes('เข้าสู่ระบบด้วยบัญชี LINE');
  const hasLeakedData = pageContent.includes('สมชาย ใจดี') || pageContent.includes('candidate_tenant_fallback');

  const ssNoSessionPath = path.join(SCREENSHOTS_DIR, 's2-2-tenant-login-screen.png');
  await pageNoSession.screenshot({ path: ssNoSessionPath });
  console.log(`Saved screenshot: ${ssNoSessionPath}`);
  console.log(`Has expected Thai welcome message: ${hasNoSessionMessage}`);
  console.log(`Has LINE Login button: ${hasLoginButton}`);
  console.log(`Has leaked tenant data: ${hasLeakedData}`);

  const passS22 = hasNoSessionMessage && hasLoginButton && !hasLeakedData;
  console.log(`[AC S2-2 / S2-3] Result: ${passS22 ? 'PASS' : 'FAIL'}\n`);
  await cleanContext.close();

  // --- AC S2-4 & S2-6: Tenant Portal Re-entry and Persistence (Somchai, Room 101) ---
  console.log('2. [AC S2-4 / S2-6] Opening /tenant with Tenant session (Somchai, Room 101)...');
  const tenantStorage = getSession('tenant');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });
  const pageTenant = await tenantContext.newPage();
  await pageTenant.goto('https://app.hor-plus.com/tenant', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(3000);

  // Reload page to verify persistent session
  await pageTenant.reload({ waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);

  const tenantPageContent = await pageTenant.content();
  const hasTenantName = tenantPageContent.includes('สมชาย') || tenantPageContent.includes('101');
  const ssTenantPath = path.join(SCREENSHOTS_DIR, 's2-4-tenant-portal-reentry.png');
  await pageTenant.screenshot({ path: ssTenantPath });
  console.log(`Saved screenshot: ${ssTenantPath}`);
  console.log(`Displays Tenant Name/Room: ${hasTenantName}`);

  const passS24 = hasTenantName;
  console.log(`[AC S2-4 / S2-6] Result: ${passS24 ? 'PASS' : 'FAIL'}\n`);
  await tenantContext.close();

  await browser.close();

  const allBrowserPass = passS22 && passS24;
  console.log(`=== Card S2 Playwright Browser Verification: ${allBrowserPass ? 'ALL PASS' : 'SOME FAILED'} ===`);
  process.exit(allBrowserPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error in run-s2-live-browser:', err);
  process.exit(1);
});
