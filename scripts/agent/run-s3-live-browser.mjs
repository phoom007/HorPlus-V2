/**
 * Playwright Live Browser Checks for Card S3
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
  console.log('=== Starting Card S3 Playwright Browser Verification ===\n');

  const tenantStorage = getSession('tenant');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });

  // 1. [AC S3-1, S3-6] Tenant Home Portal (/tenant)
  console.log('1. [AC S3-1, S3-6] Testing Tenant Home Portal (/tenant)...');
  const pageTenant = await tenantContext.newPage();
  await pageTenant.goto('https://app.hor-plus.com/tenant', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);
  const ssHomePath = path.join(SCREENSHOTS_DIR, 's3-1-tenant-portal-home.png');
  await pageTenant.screenshot({ path: ssHomePath });
  console.log(`Saved screenshot: ${ssHomePath}`);

  const homeContent = await pageTenant.content();
  const passHome = (homeContent.includes('สมชาย') || homeContent.includes('101') || homeContent.includes('ห้อง 101')) &&
                   !homeContent.includes('candidate_tenant_fallback');
  console.log(`Home portal contains Somchai info and no mock fallback: ${passHome}`);

  // 2. [AC S3-1, S3-6] Tenant Bills & Invoices (/tenant?sub=invoice)
  console.log('\n2. [AC S3-1, S3-6] Testing Tenant Bills View (/tenant?sub=invoice)...');
  await pageTenant.goto('https://app.hor-plus.com/tenant?sub=invoice', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);
  const ssBillsPath = path.join(SCREENSHOTS_DIR, 's3-1-tenant-portal-bills.png');
  await pageTenant.screenshot({ path: ssBillsPath });
  console.log(`Saved screenshot: ${ssBillsPath}`);

  const billsContent = await pageTenant.content();
  const passBills = billsContent.includes('บิล') || billsContent.includes('ประวัติการชำระ') || billsContent.includes('ชำระแล้ว');
  console.log(`Bills view loaded properly: ${passBills}`);

  // 3. [AC S3-1] Reload check (state retention)
  console.log('\n3. [AC S3-1] Reloading bills view to verify persistence...');
  await pageTenant.reload({ waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(1500);
  const reloadContent = await pageTenant.content();
  const passReload = reloadContent.includes('บิล') || reloadContent.includes('ประวัติการชำระ') || reloadContent.includes('ชำระแล้ว');
  console.log(`Reload check passed: ${passReload}`);

  await tenantContext.close();
  await browser.close();

  console.log('\n=== Browser Checks Summary ===');
  console.log(`S3-1 & S3-6 Home Portal (/tenant): ${passHome ? 'PASS' : 'FAIL'}`);
  console.log(`S3-1 & S3-6 Bills View (/tenant?sub=invoice): ${passBills ? 'PASS' : 'FAIL'}`);
  console.log(`S3-1 Reload Persistence: ${passReload ? 'PASS' : 'FAIL'}`);

  if (!passHome || !passBills || !passReload) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during S3 browser check:', err);
  process.exit(1);
});
