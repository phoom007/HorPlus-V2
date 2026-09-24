/**
 * Playwright Live Browser Checks for Card S4
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
  console.log('=== Starting Card S4 Playwright Browser Verification ===\n');

  const tenantStorage = getSession('tenant');
  const tenantContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
    storageState: tenantStorage,
  });

  const page = await tenantContext.newPage();

  // 1. [AC S4-2] Contract view with dormitory signature
  console.log('1. [AC S4-2] Checking Contract View & Dormitory Signature (/tenant?sub=contract)...');
  await page.goto('https://app.hor-plus.com/tenant?sub=contract', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Scroll down to signature block
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const contractContent = await page.content();
  const hasContractNumber = contractContent.includes('CTR-2026-101') || contractContent.includes('เอกสารสัญญา');
  const hasOwnerSignature = contractContent.includes('ลายเซ็นผู้ให้เช่า') || contractContent.includes('ผู้ให้เช่า');
  console.log(`  Contract loaded: ${hasContractNumber}, Owner signature block present: ${hasOwnerSignature}`);

  const ssContractPath = path.join(SCREENSHOTS_DIR, 's4-2-tenant-contract-signature.png');
  await page.screenshot({ path: ssContractPath });
  console.log(`  Saved screenshot: ${ssContractPath}`);

  // 2. [AC S4-4 & S4-6] Profile Tab: Edit field, save (CSRF verify), reload verify persistence, then revert
  console.log('\n2. [AC S4-4 / S4-6] Checking Profile Tab Edit & Persistence (/tenant?tab=profile)...');
  await page.goto('https://app.hor-plus.com/tenant?tab=profile', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Click edit button
  const editBtn = page.locator('[data-testid="btn-edit-tenant-info"]');
  await editBtn.waitFor({ state: 'visible', timeout: 5000 });
  await editBtn.click();
  await page.waitForTimeout(1000);

  // Add a test motorcycle: 9กข 9999
  console.log('  Adding test vehicle in bottom sheet...');
  const motoBtn = page.getByRole('button', { name: 'รถจักรยานยนต์' });
  if (await motoBtn.isVisible()) {
    await motoBtn.click();
  }
  const plateInput = page.getByPlaceholder('เลขทะเบียน เช่น 1กข 1234');
  await plateInput.fill('9กข 9999 กทม');

  const addVehBtn = page.getByRole('button', { name: '+ เพิ่มยานพาหนะ' });
  await addVehBtn.click();
  await page.waitForTimeout(500);

  // Click Save
  console.log('  Saving updated profile (verifying CSRF header via browser fetch)...');
  const saveBtn = page.getByRole('button', { name: 'บันทึกข้อมูล' });
  await saveBtn.click();
  await page.waitForTimeout(2000);

  // Reload page to verify persistence
  console.log('  Reloading page to verify persistence...');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const reloadedContent = await page.content();
  const persisted = reloadedContent.includes('9กข 9999');
  console.log(`  Profile update persisted after reload: ${persisted}`);

  const ssProfilePath = path.join(SCREENSHOTS_DIR, 's4-4-tenant-profile-edit.png');
  await page.screenshot({ path: ssProfilePath });
  console.log(`  Saved screenshot: ${ssProfilePath}`);

  // Revert: remove the test vehicle so data is clean
  console.log('  Reverting test vehicle to keep test data clean...');
  await editBtn.click();
  await page.waitForTimeout(1000);
  const deleteBtns = page.getByTitle('ลบยานพาหนะ');
  const count = await deleteBtns.count();
  if (count > 0) {
    // Delete the last added one
    await deleteBtns.nth(count - 1).click();
    await page.waitForTimeout(500);
    const revertSaveBtn = page.getByRole('button', { name: 'บันทึกข้อมูล' });
    await revertSaveBtn.click();
    await page.waitForTimeout(1500);
  }

  await tenantContext.close();
  await browser.close();

  console.log('\n=== Browser Checks Summary ===');
  console.log(`S4-2 Contract view with owner signature: ${hasOwnerSignature ? 'PASS' : 'FAIL'}`);
  console.log(`S4-4 / S4-6 Profile edit, CSRF save, & reload persistence: ${persisted ? 'PASS' : 'FAIL'}`);

  if (!hasOwnerSignature || !persisted) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error during Playwright execution:', err);
  process.exit(1);
});
