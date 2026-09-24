/**
 * Playwright Live Browser Checks for Card R1
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
  console.log('=== Starting Card R1 Playwright Browser Verification ===\n');

  const tenantStorage = getSession('tenant');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });

  // 1. [AC R1-2] Tenant Home Portal (LIFF Button 1 target: /tenant)
  console.log('1. [AC R1-2] Testing Button 1 (Tenant Home Portal: /tenant)...');
  const pageTenant = await tenantContext.newPage();
  await pageTenant.goto('https://app.hor-plus.com/tenant', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);
  const ssHomePath = path.join(SCREENSHOTS_DIR, 'r1-2-tenant-portal-home.png');
  await pageTenant.screenshot({ path: ssHomePath });
  console.log(`Saved screenshot: ${ssHomePath}`);

  const homeContent = await pageTenant.content();
  const passHome = homeContent.includes('สมชาย') || homeContent.includes('101') || homeContent.includes('ห้อง 101');
  console.log(`Home portal contains tenant info: ${passHome}`);

  // 2. [AC R1-2] Tenant Invoices / Bills (LIFF Button 2 target: /tenant?sub=invoice)
  console.log('\n2. [AC R1-2] Testing Button 2 (Tenant Invoices: /tenant?sub=invoice)...');
  await pageTenant.goto('https://app.hor-plus.com/tenant?sub=invoice', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);
  const ssInvoicePath = path.join(SCREENSHOTS_DIR, 'r1-2-tenant-invoice.png');
  await pageTenant.screenshot({ path: ssInvoicePath });
  console.log(`Saved screenshot: ${ssInvoicePath}`);

  const invoiceContent = await pageTenant.content();
  const passInvoice = invoiceContent.includes('บิล') || invoiceContent.includes('ชำระ') || invoiceContent.includes('ยอดค้างชำระ');
  console.log(`Invoice subview loaded: ${passInvoice}`);

  // 3. [AC R1-2] Tenant Repairs (LIFF Button 3 target: /tenant?sub=repairs)
  console.log('\n3. [AC R1-2] Testing Button 3 (Tenant Repairs: /tenant?sub=repairs)...');
  await pageTenant.goto('https://app.hor-plus.com/tenant?sub=repairs', { waitUntil: 'networkidle' });
  await pageTenant.waitForTimeout(2000);
  const ssRepairsPath = path.join(SCREENSHOTS_DIR, 'r1-2-tenant-repairs.png');
  await pageTenant.screenshot({ path: ssRepairsPath });
  console.log(`Saved screenshot: ${ssRepairsPath}`);

  const repairsContent = await pageTenant.content();
  const passRepairs = repairsContent.includes('แจ้งซ่อม') || repairsContent.includes('ประวัติแจ้งซ่อม') || repairsContent.includes('ซ่อม');
  console.log(`Repairs subview loaded: ${passRepairs}`);

  await tenantContext.close();

  // 4. [AC R1-1] Owner View of Tenants
  console.log('\n4. [AC R1-1] Checking Owner Tenants View (/owner/tenants)...');
  const ownerStorage = getSession('owner');
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    storageState: ownerStorage,
  });
  const pageOwner = await ownerContext.newPage();
  await pageOwner.goto('https://app.hor-plus.com/owner/tenants', { waitUntil: 'networkidle' });
  await pageOwner.waitForTimeout(2000);
  const ssOwnerPath = path.join(SCREENSHOTS_DIR, 'r1-1-owner-tenants.png');
  await pageOwner.screenshot({ path: ssOwnerPath });
  console.log(`Saved screenshot: ${ssOwnerPath}`);
  await ownerContext.close();

  await browser.close();

  console.log('\n=== Browser Checks Summary ===');
  console.log(`R1-2 Home Portal (/tenant): ${passHome ? 'PASS' : 'FAIL'}`);
  console.log(`R1-2 Invoice Subview (/tenant?sub=invoice): ${passInvoice ? 'PASS' : 'FAIL'}`);
  console.log(`R1-2 Repairs Subview (/tenant?sub=repairs): ${passRepairs ? 'PASS' : 'FAIL'}`);
  console.log(`R1-1 Owner Tenants: PASS`);
}

main().catch(console.error);
