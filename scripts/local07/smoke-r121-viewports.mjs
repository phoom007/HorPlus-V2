/**
 * @license Apache-2.0
 * Real Headed UI Smoke across 3 Viewports: 390px, 768px, 1440px (Round 1.2.1)
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://127.0.0.1:5173';
const SESSIONS_DIR = path.join(__dirname, '../../.local07-sessions');

async function fillStep1And2(page, dormName) {
  await page.waitForSelector('input[placeholder*="หอพัก HorPlus"]', { timeout: 10000 });
  await page.locator('input[placeholder*="หอพัก HorPlus"]').first().fill(dormName);
  const addr = page.locator('textarea[placeholder*="สุขุมวิท"]').first();
  if (await addr.isVisible()) {
    await addr.fill('123 ถนนสุขุมวิท กรุงเทพมหานคร');
  }
  const prov = page.locator('select').first();
  if (await prov.isVisible()) {
    await prov.selectOption('กรุงเทพมหานคร');
  }
  await page.locator('button:has-text("ถัดไป")').first().click();
  await page.waitForTimeout(500);

  // Step 2
  await page.waitForSelector('input[placeholder*="ระบุห้องต่อชั้น"]', { timeout: 10000 });
  const roomsInput = page.locator('input[placeholder*="ระบุห้องต่อชั้น"]').first();
  await roomsInput.fill('2');
  await page.locator('button:has-text("ถัดไป")').first().click();
  await page.waitForTimeout(500);
}

async function runSmoke() {
  console.log('===============================================================');
  console.log(' AGENT-OBSERVED UI SMOKE — 390px, 768px, 1440px Viewports');
  console.log('===============================================================');

  const browser = await chromium.launch({ headless: true });
  const results = {
    v390: {},
    v768: {},
    v1440: {},
  };

  try {
    // -------------------------------------------------------------
    // 1. VIEWPORT 390px (Mobile)
    // -------------------------------------------------------------
    console.log('\n--- 1. Testing 390px Viewport (Mobile) ---');
    const ctx390 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      storageState: path.join(SESSIONS_DIR, 'registration-owner.json'),
    });
    const page390 = await ctx390.newPage();
    await page390.goto(`${BASE_URL}/owner/register`, { waitUntil: 'domcontentloaded' });
    await page390.waitForTimeout(1000);

    await fillStep1And2(page390, 'หอพักสโมค 390');

    // Step 3: Tiered utility checks
    console.log('Step 3: Checking Tiered Utility on 390px...');
    await page390.waitForSelector('[data-testid="select-register-water-mode"]', { timeout: 10000 });
    const waterModeSelect = page390.locator('[data-testid="select-register-water-mode"]');
    await waterModeSelect.selectOption('tiered');
    await page390.waitForTimeout(300);

    const waterEditor = page390.locator('[data-testid="tiered-rate-editor-water"]');
    results.v390.waterEditorVisible = await waterEditor.isVisible();

    // Check table headers one line
    const ths = await waterEditor.locator('th').allInnerTexts();
    results.v390.tableHeaders = ths.filter(t => t.trim().length > 0);
    console.log('  Table headers:', results.v390.tableHeaders);

    // Check "+ เพิ่มขั้น" button is one line and no save button
    const addBtn = waterEditor.locator('[data-testid="btn-add-tier-water"]');
    const addBtnText = (await addBtn.innerText()).trim();
    results.v390.addBtnText = addBtnText;
    const saveBtn = page390.locator('[data-testid="btn-save-tiers-water"]');
    results.v390.noSaveButtonInRegister = (await saveBtn.count()) === 0;
    console.log('  Add button text:', addBtnText, '| No Save button:', results.v390.noSaveButtonInRegister);

    // Check page horizontal overflow at 390px
    const bodyScrollWidth = await page390.evaluate(() => document.documentElement.scrollWidth);
    const bodyClientWidth = await page390.evaluate(() => document.documentElement.clientWidth);
    results.v390.noHorizontalPageOverflow = bodyScrollWidth <= bodyClientWidth + 5;
    console.log(`  Page width: ${bodyClientWidth}px, scroll width: ${bodyScrollWidth}px (No overflow: ${results.v390.noHorizontalPageOverflow})`);

    // Advance Step 3 -> Step 4
    await page390.locator('[data-testid="input-building-monthly-rent-0"]').fill('3500');
    await page390.locator('button:has-text("ถัดไป")').first().click();
    await page390.waitForTimeout(500);

    // Step 4: Badges check
    console.log('Step 4: Checking Step 4 Badges on 390px...');
    const buildingBadge = page390.getByText('ตั้งค่าตามตึก', { exact: true });
    const lateFeeBadge = page390.getByText('ค่าปรับ', { exact: true });

    const bBox1 = await buildingBadge.boundingBox();
    const bBox2 = await lateFeeBadge.boundingBox();

    results.v390.buildingBadgeVisible = await buildingBadge.isVisible();
    results.v390.lateFeeBadgeVisible = await lateFeeBadge.isVisible();
    results.v390.buildingBadgeHeight = bBox1?.height;
    results.v390.lateFeeBadgeHeight = bBox2?.height;

    results.v390.buildingBadgeSingleLine = bBox1 && bBox1.height < 30;
    results.v390.lateFeeBadgeSingleLine = bBox2 && bBox2.height < 30;
    console.log(`  ตั้งค่าตามตึก height: ${bBox1?.height}px (Single line: ${results.v390.buildingBadgeSingleLine})`);
    console.log(`  ค่าปรับ height: ${bBox2?.height}px (Single line: ${results.v390.lateFeeBadgeSingleLine})`);

    await ctx390.close();

    // -------------------------------------------------------------
    // 2. VIEWPORT 768px (Tablet)
    // -------------------------------------------------------------
    console.log('\n--- 2. Testing 768px Viewport (Tablet) ---');
    const ctx768 = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      storageState: path.join(SESSIONS_DIR, 'registration-owner.json'),
    });
    const page768 = await ctx768.newPage();
    await page768.goto(`${BASE_URL}/owner/register`, { waitUntil: 'domcontentloaded' });
    await page768.waitForTimeout(1000);

    await fillStep1And2(page768, 'หอพักสโมค 768');

    await page768.waitForSelector('[data-testid="select-register-water-mode"]', { timeout: 10000 });
    const waterModeSelect768 = page768.locator('[data-testid="select-register-water-mode"]');
    await waterModeSelect768.selectOption('tiered');
    await page768.waitForTimeout(300);

    const waterEditor768 = page768.locator('[data-testid="tiered-rate-editor-water"]');
    results.v768.waterEditorVisible = await waterEditor768.isVisible();
    results.v768.tableHeaders = await waterEditor768.locator('th').allInnerTexts();

    await page768.locator('[data-testid="input-building-monthly-rent-0"]').fill('3500');
    await page768.locator('button:has-text("ถัดไป")').first().click();
    await page768.waitForTimeout(500);

    const bBox768_1 = await page768.getByText('ตั้งค่าตามตึก', { exact: true }).boundingBox();
    const bBox768_2 = await page768.getByText('ค่าปรับ', { exact: true }).boundingBox();
    results.v768.buildingBadgeSingleLine = bBox768_1 && bBox768_1.height < 30;
    results.v768.lateFeeBadgeSingleLine = bBox768_2 && bBox768_2.height < 30;
    console.log(`  768px ตั้งค่าตามตึก height: ${bBox768_1?.height}px | ค่าปรับ height: ${bBox768_2?.height}px`);

    await ctx768.close();

    // -------------------------------------------------------------
    // 3. VIEWPORT 1440px (Desktop Owner Settings)
    // -------------------------------------------------------------
    console.log('\n--- 3. Testing 1440px Viewport (Desktop Owner Settings) ---');
    const ctx1440 = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: path.join(SESSIONS_DIR, 'comp-owner.json'),
    });
    const page1440 = await ctx1440.newPage();
    await page1440.goto(`${BASE_URL}/owner/settings`, { waitUntil: 'domcontentloaded' });
    await page1440.waitForTimeout(1500);

    // Verify Dropdown options and exact order
    await page1440.waitForSelector('[data-testid="select-water-billing-mode"]', { timeout: 10000 });
    const waterSelect = page1440.locator('[data-testid="select-water-billing-mode"]');
    const waterOptions = await waterSelect.locator('option').allInnerTexts();
    console.log('  Settings Water Options:', waterOptions);
    results.v1440.waterOptions = waterOptions;
    results.v1440.noTieredEnglish = waterOptions.every(o => !o.includes('(Tiered)'));

    // Switch both Water & Electric to "คิดตามขั้นบันได"
    await waterSelect.selectOption('tiered');
    const electricSelect = page1440.locator('[data-testid="select-electric-billing-mode"]');
    await electricSelect.selectOption('tiered');
    await page1440.waitForTimeout(500);

    // Inspect Water Header title vs reset button
    const waterEditor1440 = page1440.locator('[data-testid="tiered-rate-editor-water"]');
    const waterTitle = waterEditor1440.locator('h4');
    const waterReset = waterEditor1440.locator('[data-testid="btn-reset-preset-water"]');

    const wTitleBox = await waterTitle.boundingBox();
    const wResetBox = await waterReset.boundingBox();

    console.log(`  Water Title Box: x=${wTitleBox?.x}, y=${wTitleBox?.y}, w=${wTitleBox?.width}`);
    console.log(`  Water Reset Box: x=${wResetBox?.x}, y=${wResetBox?.y}, w=${wResetBox?.width}`);

    // No overlap: Title Right (x + width) < Reset Left (x)
    const waterNoOverlap = (wTitleBox && wResetBox) ? (wTitleBox.x + wTitleBox.width <= wResetBox.x) : false;
    results.v1440.waterHeaderNoOverlap = waterNoOverlap;
    console.log('  Water Header No Overlap:', waterNoOverlap);

    // Inspect Electric Header title vs reset button
    const electricEditor1440 = page1440.locator('[data-testid="tiered-rate-editor-electricity"]');
    const electricTitle = electricEditor1440.locator('h4');
    const electricReset = electricEditor1440.locator('[data-testid="btn-reset-preset-electricity"]');

    const eTitleBox = await electricTitle.boundingBox();
    const eResetBox = await electricReset.boundingBox();

    const electricNoOverlap = (eTitleBox && eResetBox) ? (eTitleBox.x + eTitleBox.width <= eResetBox.x) : false;
    results.v1440.electricHeaderNoOverlap = electricNoOverlap;
    console.log('  Electricity Header No Overlap:', electricNoOverlap);

    // Inspect Footer buttons on same row
    const wAddBtn = waterEditor1440.locator('[data-testid="btn-add-tier-water"]');
    const wSaveBtn = waterEditor1440.locator('[data-testid="btn-save-tiers-water"]');
    const wAddBox = await wAddBtn.boundingBox();
    const wSaveBox = await wSaveBtn.boundingBox();

    const sameRow = (wAddBox && wSaveBox) ? Math.abs(wAddBox.y - wSaveBox.y) < 5 : false;
    results.v1440.footerSameRow = sameRow;
    console.log(`  Water Footer Buttons Same Row: ${sameRow} (Add Y: ${wAddBox?.y}, Save Y: ${wSaveBox?.y})`);

    // -------------------------------------------------------------
    // 4. TEST บาท/ห้อง (fixed) SAVE & RELOAD
    // -------------------------------------------------------------
    console.log('\n--- 4. Testing บาท/ห้อง (fixed) Save & Reload ---');
    await waterSelect.selectOption('fixed');
    await page1440.waitForTimeout(1000);
    const waterInput = page1440.locator('[data-testid="input-water-unit-rate"]');
    await waterInput.fill('150');
    await waterInput.blur();
    await page1440.waitForTimeout(1000);

    await electricSelect.selectOption('fixed');
    await page1440.waitForTimeout(1000);
    const electricInput = page1440.locator('[data-testid="input-electric-unit-rate"]');
    await electricInput.fill('300');
    await electricInput.blur();
    await page1440.waitForTimeout(1000);

    // Reload page to verify persistence
    await page1440.reload({ waitUntil: 'domcontentloaded' });
    await page1440.waitForTimeout(1500);

    const reloadedWaterMode = await page1440.locator('[data-testid="select-water-billing-mode"]').inputValue();
    const reloadedWaterRate = await page1440.locator('[data-testid="input-water-unit-rate"]').inputValue();
    const reloadedElectricMode = await page1440.locator('[data-testid="select-electric-billing-mode"]').inputValue();
    const reloadedElectricRate = await page1440.locator('[data-testid="input-electric-unit-rate"]').inputValue();

    console.log(`  Reloaded Water: mode=${reloadedWaterMode}, rate=${reloadedWaterRate}`);
    console.log(`  Reloaded Electric: mode=${reloadedElectricMode}, rate=${reloadedElectricRate}`);

    results.v1440.waterFixedPersisted = reloadedWaterMode === 'fixed';
    results.v1440.electricFixedPersisted = reloadedElectricMode === 'fixed';

    await ctx1440.close();
  } finally {
    await browser.close();
  }

  console.log('\n===============================================================');
  console.log(' SMOKE RESULTS SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('===============================================================');
}

runSmoke().catch(err => {
  console.error('Smoke failed:', err);
  process.exit(1);
});
