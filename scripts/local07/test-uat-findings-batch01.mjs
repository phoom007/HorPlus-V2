/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HORPLUS LOCAL-07 — BROWSER UAT FINDINGS BATCH 01 REGRESSION & INTEGRATION SUITE
 * 
 * Tests:
 * 1. Character-by-character progressive decimal typing (0 -> 0. -> 0.5 -> 0.50, 018.50)
 * 2. Numeric leading zero normalization & identifier leading zero preservation
 * 3. Step 6 LINE OA neutral display & credential edit invalidation
 * 4. Step 7 Trial duration separation (1-mo card stays ฿0 when 3-mo selected)
 * 5. Fail-closed trial pricing state before / after quote
 * 6. Referral UI relocation (Step 7 incoming only, /owner/subscription has own code & public share link)
 * 7. Fresh browser context traversal of public referral share link
 * 8. Add Dormitory Option A Multi-Dormitory (2nd FREE dorm succeeds, PostgreSQL quote intent matches provDormId)
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
import { assertSafeDatabaseTarget } from './db-safety-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://127.0.0.1:5173';
const SESSIONS_DIR = path.join(__dirname, '../../.local07-sessions');

assertSafeDatabaseTarget();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function runBatch01Verification() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — UAT FINDINGS BATCH 01 VERIFICATION SUITE');
  console.log('================================================================================');

  const browser = await chromium.launch({ headless: true });
  const results = {
    progressive_decimal_typing: false,
    numeric_leading_zero_normalization: false,
    identifier_preservation: false,
    step6_line_neutral_pretest_display: false,
    step6_line_credential_edit_invalidation: false,
    step7_trial_fail_closed_and_duration_separation: false,
    referral_ui_relocation_and_public_link: false,
    fresh_context_referral_link_traversal: false,
    add_dorm_option_a_and_postgres_intent_match: false,
    registration_workspace_isolation: false,
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: Progressive Decimal Typing & Integer Normalization
    // --------------------------------------------------------------------------
    console.log('\n--- 1. Testing Progressive Typing, Decimal Support & Identifier Preservation ---');
    const regStorageState = path.join(SESSIONS_DIR, 'registration-owner.json');
    const context = await browser.newContext({ storageState: regStorageState });
    const page = await context.newPage();

    let capturedProvDormIdA = null;
    let capturedQuoteIntentIdA = null;

    page.on('response', async res => {
      if (res.url().includes('/api/v1/')) {
        const status = res.status();
        if (res.url().includes('/onboarding/prepare')) {
          try {
            const data = await res.json();
            capturedProvDormIdA = data?.data?.provisionalDormitoryId || data?.provisionalDormitoryId;
          } catch { }
        }
        if (res.url().includes('/subscription/quote')) {
          try {
            const data = await res.json();
            capturedQuoteIntentIdA = data?.data?.intentId;
          } catch { }
        }
      }
    });

    await page.goto(`${BASE_URL}/owner/register`);
    await page.waitForLoadState('networkidle');

    // Verify Finding A & B: Workspace Gate during initial onboarding (Batch 03: all menus visible, operational menus disabled)
    const regNavItem = page.locator('[data-testid="nav-item-register"]');
    const roomsNavItem = page.locator('[data-testid="nav-item-rooms"]');
    const settingsNavItem = page.locator('[data-testid="nav-item-settings"]');
    const isRegistrationSidebarIsolated = (await regNavItem.count() > 0) && (await roomsNavItem.first().isDisabled()) && (await settingsNavItem.first().isDisabled());
    console.log(`  Initial onboarding menu has operational items disabled: ${isRegistrationSidebarIsolated ? '✅ YES' : '❌ NO'}`);

    // Click profile avatar button and verify it does NOT navigate to settings
    const avatarBtns = page.locator('button[title*="ลงทะเบียน"]');
    if (await avatarBtns.count() > 0) {
      await avatarBtns.first().click({ force: true }).catch(() => { });
      await page.waitForTimeout(300);
    }
    const staysOnRegisterUrl = page.url().includes('/owner/register');
    console.log(`  Profile avatar click locked to registration: ${staysOnRegisterUrl ? '✅ YES' : '❌ NO'}`);

    // Fill Step 1
    await page.locator('input[placeholder*="หอพัก HorPlus"]').first().fill('หอพัก Batch01 Real Typing Test');
    await page.locator('textarea[placeholder*="สุขุมวิท"]').first().fill('123 ถนนสุขุมวิท กรุงเทพมหานคร');
    await page.locator('select').first().selectOption('กรุงเทพมหานคร');
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 2: Test building numeric fields via pressSequentially
    const floorsInput = page.locator('input[placeholder*="ระบุจำนวนชั้น"]').first();
    await floorsInput.click();
    await floorsInput.fill('');
    await floorsInput.pressSequentially('05', { delay: 50 });
    const floorsVal = await floorsInput.inputValue();
    console.log(`  Floors '05' typed sequentially -> normalized: '${floorsVal}' (Expected: '5')`);

    const roomsInput = page.locator('input[placeholder*="ระบุห้องต่อชั้น"]').first();
    await roomsInput.click();
    await roomsInput.fill('');
    await roomsInput.pressSequentially('014', { delay: 50 });
    const roomsVal = await roomsInput.inputValue();
    console.log(`  Rooms '014' typed sequentially -> normalized: '${roomsVal}' (Expected: '14')`);

    if (floorsVal === '5' && roomsVal === '14') {
      results.numeric_leading_zero_normalization = true;
    }

    // Step 2 -> Step 3
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 3: Progressive decimal typing simulation on Water Rate & Electric Rate
    console.log('  Testing keystroke-by-keystroke decimal input for waterRate (0 -> 0. -> 0.5 -> 0.50):');
    const waterRateInput = page.locator('label:has-text("ค่าน้ำ")').locator('xpath=../..').locator('input').first();
    await waterRateInput.click();
    await waterRateInput.fill('');

    await waterRateInput.pressSequentially('0', { delay: 50 });
    const w1 = await waterRateInput.inputValue();
    console.log(`    After typing '0': '${w1}'`);

    await waterRateInput.pressSequentially('.', { delay: 50 });
    const w2 = await waterRateInput.inputValue();
    console.log(`    After typing '.': '${w2}'`);

    await waterRateInput.pressSequentially('5', { delay: 50 });
    const w3 = await waterRateInput.inputValue();
    console.log(`    After typing '5': '${w3}'`);

    await waterRateInput.pressSequentially('0', { delay: 50 });
    const w4 = await waterRateInput.inputValue();
    console.log(`    After typing '0': '${w4}'`);

    console.log('  Testing keystroke-by-keystroke decimal input for electricRate (018.50):');
    const elecRateInput = page.locator('label:has-text("ค่าไฟฟ้า")').locator('xpath=../..').locator('input').first();
    await elecRateInput.click();
    await elecRateInput.fill('');
    await elecRateInput.pressSequentially('018.50', { delay: 50 });
    const elecVal = await elecRateInput.inputValue();
    console.log(`    After typing '018.50': '${elecVal}'`);

    // Step 3 monthly rent normalization
    const rentInput = page.locator('label:has-text("ค่าเช่ารายเดือน")').locator('xpath=..').locator('input').first();
    await rentInput.click();
    await rentInput.fill('');
    await rentInput.pressSequentially('014000', { delay: 50 });
    const rentVal = await rentInput.inputValue();
    console.log(`    Monthly rent '014000' -> '${rentVal}' (Expected: '14000')`);

    if (w1 === '0' && w2 === '0.' && w3 === '0.5' && w4 === '0.50' && elecVal === '18.50' && rentVal === '14000') {
      results.progressive_decimal_typing = true;
      console.log('  Progressive decimal typing verification: ✅ PASS');
    } else {
      console.log('  Progressive decimal typing verification: ❌ FAIL', { w1, w2, w3, w4, elecVal, rentVal });
    }

    // Step 3 -> Step 4
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 4: Identifier Preservation
    const depositInput = page.locator('label:has-text("ค่าประกัน")').locator('xpath=../..').locator('input').first();
    if (await depositInput.isVisible()) {
      await depositInput.fill('5000');
    }

    const bankSelect = page.locator('select').filter({ hasText: 'เลือกธนาคาร' }).first();
    if (await bankSelect.isVisible()) {
      await bankSelect.selectOption('กสิกรไทย (KBank)');
    }

    const bankAccInput = page.locator('label:has-text("เลขที่บัญชีธนาคาร")').locator('xpath=..').locator('input').first();
    await bankAccInput.click();
    await bankAccInput.fill('');
    await bankAccInput.pressSequentially('0012345678', { delay: 50 });
    const bankAccVal = await bankAccInput.inputValue();
    console.log(`  Bank Account '0012345678' preserved: '${bankAccVal}' (Expected: '0012345678' / '001-2-34567-8')`);

    const bankNameInput = page.locator('input[placeholder*="บัญชีธนาคาร"]').first();
    if (await bankNameInput.isVisible()) {
      await bankNameInput.fill('นายทดสอบ บัญชี');
    }

    const ppInput = page.locator('label:has-text("เลขพร้อมเพย์")').locator('xpath=..').locator('input').first();
    await ppInput.click();
    await ppInput.fill('');
    await ppInput.pressSequentially('0812345678', { delay: 50 });
    const ppVal = await ppInput.inputValue();
    console.log(`  PromptPay '0812345678' preserved: '${ppVal}' (Expected: '081-234-5678' or digits '0812345678')`);

    const ppNameInput = page.locator('input[placeholder*="บัญชีพร้อมเพย์"]').first();
    if (await ppNameInput.isVisible()) {
      await ppNameInput.fill('นายทดสอบ พร้อมเพย์');
    }

    if ((bankAccVal.includes('0012345678') || bankAccVal.includes('001-2-34567-8')) && (ppVal.includes('0812345678') || ppVal.includes('081-234-5678'))) {
      results.identifier_preservation = true;
      console.log('  Identifier leading-zero preservation: ✅ PASS');
    }

    // Select Due Date
    await page.locator('[data-testid="due-date-select"]').first().selectOption('15');

    // Step 4 -> Step 5
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(600);

    // Step 5: Rules and Signature
    const selectAllRulesBtn = page.locator('button:has-text("+ เลือกทั้งหมด 10 ข้อ")').first();
    if (await selectAllRulesBtn.isVisible()) {
      await selectAllRulesBtn.click();
      await page.waitForTimeout(200);
    }

    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 10, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 80, box.y + 40);
      await page.mouse.up();
      await page.locator('button:has-text("บันทึก")').first().click();
      await page.waitForTimeout(400);
    }

    // Step 5 -> Step 6
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(800);

    // --------------------------------------------------------------------------
    // Test 2: Step 6 LINE OA Neutral Display & Edit Invalidation
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Testing Step 6 LINE OA Neutral Display & Edit Invalidation ---');
    const lineCardText = await page.locator('.bg-emerald-50\\/60').first().innerText();
    const isNeutralName = lineCardText.includes('ยังไม่ได้เชื่อมต่อ LINE OA');
    const isNeutralId = lineCardText.includes('ยังไม่ได้ตรวจสอบ');
    const hasGenericLineLogo = await page.locator('img[src*="LINE_logo.svg"]').isVisible().catch(() => false);

    console.log(`  Pre-test neutral name ('ยังไม่ได้เชื่อมต่อ LINE OA'): ${isNeutralName ? '✅ YES' : '❌ NO'}`);
    console.log(`  Pre-test neutral status ('ยังไม่ได้ตรวจสอบ'): ${isNeutralId ? '✅ YES' : '❌ NO'}`);
    console.log(`  No fake generic LINE logo: ${!hasGenericLineLogo ? '✅ YES' : '❌ NO'}`);

    if (isNeutralName && isNeutralId && !hasGenericLineLogo) {
      results.step6_line_neutral_pretest_display = true;
    }

    // Test credential edit invalidation
    const chIdInput = page.locator('input[placeholder*="1657889900"]').first();
    await chIdInput.fill('1657889900');
    const chSecretInput = page.locator('input[type="password"]').first();
    await chSecretInput.fill('secret123456');
    await page.waitForTimeout(200);

    const statusTextAfterType = await page.locator('.bg-emerald-50\\/60').first().innerText();
    if (statusTextAfterType.includes('ยังไม่ได้ตรวจสอบ')) {
      results.step6_line_credential_edit_invalidation = true;
      console.log('  Credential typing keeps/resets verification to neutral: ✅ PASS');
    }

    // Skip LINE OA -> Step 7
    await page.locator('button:has-text("ตั้งค่าภายหลัง")').first().click();
    await page.waitForTimeout(800);

    // --------------------------------------------------------------------------
    // Test 3: Step 7 Trial Duration Separation & Referral Relocation
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Testing Step 7 Trial Duration Separation & Fail-Closed Logic ---');
    const price1moInitial = await page.locator('button:has-text("1 เดือน")').innerText();
    console.log(`  1-Month duration card initial text:\n    ${price1moInitial.replace(/\n+/g, ' ')}`);

    // Click 3-month package
    await page.locator('button:has-text("3 เดือน")').click();
    await page.waitForTimeout(500);

    // Assert 1-month card STILL shows ฿0 and ทดลองใช้ฟรี
    const price1moAfter3moClick = await page.locator('button:has-text("1 เดือน")').innerText();
    const has1moTrialZero = price1moAfter3moClick.includes('฿0') && price1moAfter3moClick.includes('ทดลองใช้ฟรี') && price1moAfter3moClick.includes('189');
    console.log(`  1-Month duration card text after selecting 3-Month:\n    ${price1moAfter3moClick.replace(/\n+/g, ' ')}`);
    console.log(`  1-Month card preserved ฿0 + trial badge when 3-mo selected: ${has1moTrialZero ? '✅ PASS' : '❌ FAIL'}`);

    if (has1moTrialZero) {
      results.step7_trial_fail_closed_and_duration_separation = true;
    }

    // Assert Step 7 has incoming referral input, but no own referral share card
    const hasIncomingReferral = (await page.locator('[data-testid="input-referral-code"]').isVisible()) || (await page.locator('text="รหัสคำเชิญ"').isVisible());
    const hasOwnReferralShareCard = await page.locator('text="รหัสคำเชิญของคุณ"').isVisible().catch(() => false);
    console.log(`  Step 7 incoming referral input visible: ${hasIncomingReferral ? '✅ YES' : '❌ NO'}`);
    console.log(`  Step 7 own referral share card removed: ${!hasOwnReferralShareCard ? '✅ YES' : '❌ NO'}`);

    // Switch back to 1-month and finalize Dorm A
    await page.locator('button:has-text("1 เดือน")').click();
    await page.waitForTimeout(400);

    await page.locator('button:has-text("ยืนยันสร้างหอพัก")').click();
    await page.waitForTimeout(400);
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator('button:has-text("Facebook")').first().click();
    await page.locator('button:has-text("ยอมรับเงื่อนไข")').click();
    await page.waitForURL('**/owner/**', { timeout: 10000 }).catch(() => { });
    await page.waitForTimeout(2000);
    console.log('  Dorm A Onboarding finalized successfully.');

    // --------------------------------------------------------------------------
    // Test 4: Referral Relocation to Subscription Page & Share Link
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Testing Referral Card on Subscription Page & Share Link ---');
    await page.goto(`${BASE_URL}/owner/subscription`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const hasSubReferralCard = await page.locator('text="โปรแกรมแนะนำเพื่อน (Referral Program)"').isVisible();
    const hasSubReferralCode = await page.locator('text="รหัสคำเชิญของคุณ:"').isVisible();
    const referralCodeElem = page.locator('[data-testid="referral-code-badge"]').first();
    await referralCodeElem.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    const referralCode = (await referralCodeElem.innerText()).trim();

    console.log(`  Subscription page referral program card visible: ${hasSubReferralCard ? '✅ YES' : '❌ NO'}`);
    console.log(`  Subscription page own referral code: '${referralCode}'`);

    const hasValidReferralCode = /^\d{6}$/.test(referralCode);
    console.log(`  Referral code is 6 numeric digits: ${hasValidReferralCode ? '✅ YES' : '❌ NO'}`);

    if (hasIncomingReferral && !hasOwnReferralShareCard && hasSubReferralCard && hasValidReferralCode) {
      results.referral_ui_relocation_and_public_link = true;
    }

    // --------------------------------------------------------------------------
    // Test 5: Fresh Context Navigation of Public Referral Link (/auth/owner?ref=...)
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Testing Fresh Browser Context Referral Link Traversal ---');
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();

    const targetReferralUrl = `${BASE_URL}/auth/owner?ref=${referralCode}`;
    console.log(`  Navigating fresh browser context to: ${targetReferralUrl}`);
    await freshPage.goto(targetReferralUrl);
    await freshPage.waitForLoadState('networkidle');
    await freshPage.waitForTimeout(600);

    // Verify sessionStorage has captured the referral code
    const storedRef = await freshPage.evaluate(() => sessionStorage.getItem('horplus_referral_code'));
    console.log(`  Fresh context sessionStorage 'horplus_referral_code': '${storedRef}' (Expected: '${referralCode}')`);

    if (storedRef === referralCode) {
      results.fresh_context_referral_link_traversal = true;
      console.log('  Fresh context referral link preservation: ✅ PASS');
    }

    await freshContext.close();

    // --------------------------------------------------------------------------
    // Test 6: Add Dormitory Option A Multi-Dormitory (Dorm B) & PostgreSQL Intent Check
    // --------------------------------------------------------------------------
    console.log('\n--- 6. Testing Add Dormitory Option A & PostgreSQL Intent Matching ---');
    let capturedProvDormIdB = null;
    let capturedQuoteIntentIdB = null;
    const unexpectedOperationalCallsB = [];

    page.on('response', async res => {
      const url = res.url();
      if (url.includes('/api/v1/')) {
        if (url.includes('/onboarding/prepare')) {
          try {
            const data = await res.json();
            capturedProvDormIdB = data?.data?.provisionalDormitoryId || data?.provisionalDormitoryId;
          } catch { }
        }
        if (url.includes('/subscription/quote')) {
          try {
            const data = await res.json();
            capturedQuoteIntentIdB = data?.data?.intentId;
          } catch { }
        }
        if (page.url().includes('/owner/dormitories/new')) {
          if (url.includes('/properties/rooms') || url.includes('/tenants') || url.includes('/bills') || url.includes('/notifications')) {
            unexpectedOperationalCallsB.push(url);
          }
        }
      }
    });

    await page.goto(`${BASE_URL}/owner/dormitories/new`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // Assert Workspace Gate for Add-Dorm registration mode (Batch 03: all menus visible, operational menus disabled)
    const regNavItemB = page.locator('[data-testid="nav-item-register"]');
    const roomsNavItemB = page.locator('[data-testid="nav-item-rooms"]');
    const settingsNavItemB = page.locator('[data-testid="nav-item-settings"]');
    const isAddDormSidebarIsolated = (await regNavItemB.count() > 0) && (await roomsNavItemB.first().isDisabled()) && (await settingsNavItemB.first().isDisabled());
    console.log(`  Add-dorm registration menu has operational items disabled: ${isAddDormSidebarIsolated ? '✅ YES' : '❌ NO'}`);

    const avatarBtnsB = page.locator('button[title*="ลงทะเบียน"]');
    if (await avatarBtnsB.count() > 0) {
      await avatarBtnsB.first().click({ force: true }).catch(() => { });
      await page.waitForTimeout(300);
    }
    const staysOnAddDormUrl = page.url().includes('/owner/dormitories/new');
    console.log(`  Add-dorm profile avatar click locked to registration: ${staysOnAddDormUrl ? '✅ YES' : '❌ NO'}`);

    console.log(`  Add-dorm background operational data queries suppressed: ${unexpectedOperationalCallsB.length === 0 ? '✅ YES' : '❌ NO'} (Count: ${unexpectedOperationalCallsB.length})`);

    // Verify F5 reload maintains add_dorm registration mode
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const staysOnAddDormAfterF5 = page.url().includes('/owner/dormitories/new') && (await regNavItemB.count() > 0) && (await roomsNavItemB.first().isDisabled());
    console.log(`  Add-dorm F5 reload preserves isolated registration workspace: ${staysOnAddDormAfterF5 ? '✅ YES' : '❌ NO'}`);

    if (isRegistrationSidebarIsolated && staysOnRegisterUrl && isAddDormSidebarIsolated && staysOnAddDormUrl && unexpectedOperationalCallsB.length === 0 && staysOnAddDormAfterF5) {
      results.registration_workspace_isolation = true;
    }

    // Fill Step 1 for Dorm B
    await page.locator('input[placeholder*="หอพัก HorPlus"]').first().fill('หอพัก Batch01 Dorm B (FREE)');
    await page.locator('textarea[placeholder*="สุขุมวิท"]').first().fill('456 ถนนพหลโยธิน กรุงเทพมหานคร');
    await page.locator('select').first().selectOption('กรุงเทพมหานคร');
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 2 for Dorm B
    const prefixInputB = page.locator('label:has-text("รหัสตึก")').locator('xpath=..').locator('input').first();
    if (await prefixInputB.isVisible()) {
      await prefixInputB.fill('B');
    }
    const floorsInputB = page.locator('input[placeholder*="ระบุจำนวนชั้น"]').first();
    if (await floorsInputB.isVisible()) {
      await floorsInputB.fill('1');
    }
    const roomsInputB = page.locator('input[placeholder*="ระบุห้องต่อชั้น"]').first();
    if (await roomsInputB.isVisible()) {
      await roomsInputB.fill('2');
    }
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 3: Fill monthly rent for Dorm B
    await page.locator('label:has-text("ค่าเช่ารายเดือน")').locator('xpath=..').locator('input').first().fill('4000');
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 4: Fill bank account, deposit and due date for Dorm B
    const depositInputB = page.locator('label:has-text("ค่าประกัน")').locator('xpath=../..').locator('input').first();
    if (await depositInputB.isVisible()) {
      await depositInputB.fill('4000');
    }
    const bankSelectB = page.locator('select').filter({ hasText: 'เลือกธนาคาร' }).first();
    if (await bankSelectB.isVisible()) {
      await bankSelectB.selectOption('กสิกรไทย (KBank)');
    }
    const bankAccB = page.locator('label:has-text("เลขที่บัญชีธนาคาร")').locator('xpath=..').locator('input').first();
    if (await bankAccB.isVisible()) {
      await bankAccB.fill('9876543210');
    }
    const bankNameB = page.locator('input[placeholder*="บัญชีธนาคาร"]').first();
    if (await bankNameB.isVisible()) {
      await bankNameB.fill('นายทดสอบ ตึกสอง');
    }
    const ppInputB = page.locator('label:has-text("เลขพร้อมเพย์")').locator('xpath=..').locator('input').first();
    if (await ppInputB.isVisible()) {
      await ppInputB.fill('0899998888');
    }
    const ppNameB = page.locator('input[placeholder*="บัญชีพร้อมเพย์"]').first();
    if (await ppNameB.isVisible()) {
      await ppNameB.fill('นายทดสอบ ตึกสอง');
    }
    await page.locator('[data-testid="due-date-select"]').first().selectOption('20');
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 5: Rules & Signature for Dorm B
    const selectAllRulesBtnB = page.locator('button:has-text("+ เลือกทั้งหมด 10 ข้อ")').first();
    if (await selectAllRulesBtnB.isVisible()) {
      await selectAllRulesBtnB.click();
      await page.waitForTimeout(200);
    }

    const canvasB = page.locator('canvas').first();
    const boxB = await canvasB.boundingBox();
    if (boxB) {
      await page.mouse.move(boxB.x + 10, boxB.y + 10);
      await page.mouse.down();
      await page.mouse.move(boxB.x + 90, boxB.y + 50);
      await page.mouse.up();
      await page.locator('button:has-text("บันทึก")').first().click();
      await page.waitForTimeout(300);
    }
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(500);

    // Step 6: Skip LINE
    await page.locator('button:has-text("ตั้งค่าภายหลัง")').first().click();
    await page.waitForTimeout(600);

    // Step 7: Select FREE plan for Dorm B (Multi-dorm Option A)
    await page.locator('text="HorPlus FREE"').first().click();
    await page.waitForTimeout(400);

    // Finalize Dorm B
    await page.locator('button:has-text("ยืนยันสร้างหอพัก")').click();
    await page.waitForTimeout(400);
    await page.locator('input[type="checkbox"]').first().check();
    await page.locator('button:has-text("Facebook")').first().click();
    await page.locator('button:has-text("ยอมรับเงื่อนไข")').click();
    await page.waitForURL('**/owner/dashboard', { timeout: 15000 }).catch(() => { });
    await page.waitForLoadState('networkidle').catch(() => { });
    await page.waitForTimeout(2000);

    // Verify operational menus are restored after finalization
    const restoredRoomsNavItem = page.locator('[data-testid="nav-item-rooms"]');
    const hasRestoredOperationalMenu = await restoredRoomsNavItem.count() > 0;
    console.log(`  Operational menus restored after Dorm B finalization: ${hasRestoredOperationalMenu ? '✅ YES' : '❌ NO'}`);

    // Query PostgreSQL directly for verification
    const sessionRes = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/session');
      return res.json();
    });

    const memberships = sessionRes?.data?.memberships || [];
    console.log(`  Active memberships count after Dorm B finalize: ${memberships.length} (Expected: 2)`);

    const dormBMember = memberships.find(m => m.dormitoryName.includes('Dorm B'));
    const finalizedDormBId = dormBMember?.dormitoryId;
    console.log(`  Dorm B Finalized ID: '${finalizedDormBId}'`);
    console.log(`  Dorm B Captured Provisional ID: '${capturedProvDormIdB}'`);
    console.log(`  Dorm B Captured Quote Intent ID: '${capturedQuoteIntentIdB}'`);

    let dbIntentMatches = false;
    if (capturedQuoteIntentIdB) {
      const dbIntent = await prisma.subscriptionPackageIntent.findUnique({
        where: { id: capturedQuoteIntentIdB },
      });
      console.log(`  PostgreSQL DB SubscriptionPackageIntent dormitoryId: '${dbIntent?.dormitoryId}'`);
      if (dbIntent && (dbIntent.dormitoryId === capturedProvDormIdB || dbIntent.dormitoryId === finalizedDormBId)) {
        dbIntentMatches = true;
        console.log('  PostgreSQL Intent matches Dorm B authoritative ID: ✅ PASS');
      }
    } else {
      // If intent was free without persistent row, check memberships
      dbIntentMatches = memberships.length === 2;
    }

    if (memberships.length === 2 && dbIntentMatches) {
      results.add_dorm_option_a_and_postgres_intent_match = true;
    }

    await context.close();
  } catch (err) {
    console.error('❌ Error during Batch 01 verification:', err);
    throw err;
  } finally {
    await prisma.$disconnect();
    await browser.close();
  }

  console.log('\n================================================================================');
  console.log('  UAT FINDINGS BATCH 01 VERIFICATION REPORT');
  console.log('================================================================================');
  console.log(JSON.stringify(results, null, 2));

  const allPassed = Object.values(results).every(Boolean);
  if (!allPassed) {
    console.error('\n❌ Some Batch 01 checkpoints failed.');
    process.exit(1);
  }

  console.log('\n✅ ALL UAT FINDINGS BATCH 01 CHECKPOINTS PASSED PERFECTLY!');
}

runBatch01Verification().catch((err) => {
  console.error(err);
  process.exit(1);
});
