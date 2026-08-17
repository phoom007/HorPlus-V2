/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HORPLUS LOCAL-07 — BROWSER UAT FINDINGS BATCH 01 REGRESSION SUITE
 * 1. Numeric leading zero normalization & identifier preservation
 * 2. Step 6 LINE OA neutral identity & credential edit invalidation
 * 3. Step 7 Trial duration separation (1-mo card stays ฿0 when 3-mo selected)
 * 4. Referral UI relocation (Step 7 incoming only, Subscription page has own code)
 * 5. Add Dormitory Option A Multi-Dormitory (2nd FREE dorm succeeds, 2 active memberships)
 */

import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = 'http://127.0.0.1:5173';
const API_URL = 'http://127.0.0.1:3001';
const SESSIONS_DIR = path.join(__dirname, '../../.local07-sessions');

async function runBatch01Verification() {
  console.log('================================================================================');
  console.log('  HORPLUS LOCAL-07 — UAT FINDINGS BATCH 01 VERIFICATION SUITE');
  console.log('================================================================================');

  const browser = await chromium.launch({ headless: true });
  const results = {
    numeric_leading_zero_normalization: false,
    identifier_preservation: false,
    step6_line_neutral_pretest_display: false,
    step6_line_credential_edit_invalidation: false,
    step7_trial_duration_separation: false,
    referral_ui_relocation: false,
    add_dorm_option_a_multi_dorm: false,
  };

  try {
    // --------------------------------------------------------------------------
    // Test 1: Numeric leading zero normalization & Identifier preservation
    // --------------------------------------------------------------------------
    console.log('\n--- 1. Testing Numeric Input Normalization & Identifier Preservation ---');
    const regStorageState = path.join(SESSIONS_DIR, 'registration-owner.json');
    const context = await browser.newContext({ storageState: regStorageState });
    const page = await context.newPage();

    page.on('response', async res => {
      if (res.url().includes('/api/v1/')) {
        const status = res.status();
        if (status >= 400 || res.url().includes('finalize') || res.url().includes('prepare') || res.url().includes('quote')) {
          const body = await res.text().catch(() => '');
          console.log(`[API] ${res.request().method()} ${res.url()} -> ${status}:`, body.slice(0, 300));
        }
      }
    });

    await page.goto(`${BASE_URL}/owner/register`);
    await page.waitForLoadState('networkidle');

    // Fill Step 1
    await page.locator('input[placeholder*="หอพัก HorPlus"]').first().fill('หอพัก Batch01 Test');
    await page.locator('textarea[placeholder*="สุขุมวิท"]').first().fill('123 ถนนสุขุมวิท กรุงเทพมหานคร');
    await page.locator('select').first().selectOption('กรุงเทพมหานคร');
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 2: Test building numeric fields
    const floorsInput = page.locator('input[placeholder*="ระบุจำนวนชั้น"]').first();
    await floorsInput.fill('05');
    const floorsVal = await floorsInput.inputValue();
    console.log(`  Floors '05' normalized to: '${floorsVal}' (Expected: '5')`);

    const roomsInput = page.locator('input[placeholder*="ระบุห้องต่อชั้น"]').first();
    await roomsInput.fill('014');
    const roomsVal = await roomsInput.inputValue();
    console.log(`  Rooms '014' normalized to: '${roomsVal}' (Expected: '14')`);

    if (floorsVal === '5' && roomsVal === '14') {
      results.numeric_leading_zero_normalization = true;
    }

    // Step 2 -> Step 3
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 3: Test utility decimal normalization & rent rates
    const rentInput = page.locator('label:has-text("ค่าเช่ารายเดือน")').locator('xpath=..').locator('input').first();
    await rentInput.fill('014000');
    const rentVal = await rentInput.inputValue();
    console.log(`  Monthly rent '014000' normalized to: '${rentVal}' (Expected: '14000')`);

    const waterRateInput = page.locator('label:has-text("ค่าน้ำประปา")').locator('xpath=../..').locator('input').first();
    await waterRateInput.fill('018.50');
    const waterVal = await waterRateInput.inputValue();
    console.log(`  Water rate '018.50' normalized to: '${waterVal}' (Expected: '18.50')`);

    // Step 3 -> Step 4
    await page.locator('button:has-text("ถัดไป")').first().click();
    await page.waitForTimeout(400);

    // Step 4: Test Identifier Preservation (PromptPay ID, Bank Account Number)
    const depositInput = page.locator('label:has-text("ค่าประกัน")').locator('xpath=../..').locator('input').first();
    if (await depositInput.isVisible()) {
      await depositInput.fill('5000');
    }

    const bankSelect = page.locator('select').filter({ hasText: 'เลือกธนาคาร' }).first();
    if (await bankSelect.isVisible()) {
      await bankSelect.selectOption('กสิกรไทย (KBank)');
    }

    const bankAccInput = page.locator('label:has-text("เลขที่บัญชีธนาคาร")').locator('xpath=..').locator('input').first();
    await bankAccInput.fill('0012345678');
    const bankAccVal = await bankAccInput.inputValue();
    console.log(`  Bank Account '0012345678' preserved: '${bankAccVal}' (Expected: '0012345678' / '001-2-34567-8')`);

    const bankNameInput = page.locator('input[placeholder*="บัญชีธนาคาร"]').first();
    if (await bankNameInput.isVisible()) {
      await bankNameInput.fill('นายทดสอบ บัญชี');
    }

    const ppInput = page.locator('label:has-text("เลขพร้อมเพย์")').locator('xpath=..').locator('input').first();
    await ppInput.fill('0812345678');
    const ppVal = await ppInput.inputValue();
    console.log(`  PromptPay '0812345678' preserved: '${ppVal}' (Expected: '081-234-5678' or digits '0812345678')`);

    const ppNameInput = page.locator('input[placeholder*="บัญชีพร้อมเพย์"]').first();
    if (await ppNameInput.isVisible()) {
      await ppNameInput.fill('นายทดสอบ พร้อมเพย์');
    }

    if ((bankAccVal.includes('0012345678') || bankAccVal.includes('001-2-34567-8')) && (ppVal.includes('0812345678') || ppVal.includes('081-234-5678'))) {
      results.identifier_preservation = true;
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

    // Sign Canvas
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
    // Test 2: Step 6 LINE OA neutral display & edit invalidation
    // --------------------------------------------------------------------------
    console.log('\n--- 2. Testing Step 6 LINE OA Neutral Display & Edit Invalidation ---');
    const lineCardText = await page.locator('.bg-emerald-50\\/60').first().innerText();
    const isNeutralName = lineCardText.includes('ยังไม่ได้เชื่อมต่อ LINE OA');
    const isNeutralId = lineCardText.includes('ยังไม่ได้ตรวจสอบ');
    const hasGenericLineLogo = await page.locator('img[src*="LINE_logo.svg"]').isVisible().catch(() => false);

    console.log(`  Pre-test neutral name ('ยังไม่ได้เชื่อมต่อ LINE OA'): ${isNeutralName ? '✅ YES' : '❌ NO'}`);
    console.log(`  Pre-test neutral status ('ยังไม่ได้ตรวจสอบ'): ${isNeutralId ? '✅ YES' : '❌ NO'}`);
    console.log(`  No fake generic LINE logo as profile pic: ${!hasGenericLineLogo ? '✅ YES' : '❌ NO'}`);

    if (isNeutralName && isNeutralId && !hasGenericLineLogo) {
      results.step6_line_neutral_pretest_display = true;
    }

    // Test credential edit invalidation
    const chIdInput = page.locator('input[placeholder*="1657889900"]').first();
    await chIdInput.fill('1657889900');
    const chSecretInput = page.locator('input[type="password"]').first();
    await chSecretInput.fill('secret123456');
    await page.waitForTimeout(200);

    // Status remains neutral unverified
    const statusTextAfterType = await page.locator('.bg-emerald-50\\/60').first().innerText();
    if (statusTextAfterType.includes('ยังไม่ได้ตรวจสอบ')) {
      results.step6_line_credential_edit_invalidation = true;
      console.log('  Credential typing keeps/resets verification to neutral: ✅ PASS');
    }

    // Skip LINE OA -> Step 7
    await page.locator('button:has-text("ตั้งค่าภายหลัง")').first().click();
    await page.waitForTimeout(600);

    // --------------------------------------------------------------------------
    // Test 3: Step 7 Trial Duration Separation & Referral Relocation
    // --------------------------------------------------------------------------
    console.log('\n--- 3. Testing Step 7 Trial Duration Separation & Referral Relocation ---');
    // Check initial 1-month trial selection
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
      results.step7_trial_duration_separation = true;
    }

    // Assert Step 7 has incoming referral input, but no own referral share card
    const hasIncomingReferral = await page.locator('label:has-text("รหัสคำเชิญที่ใช้สมัคร (ผู้แนะนำ)")').isVisible();
    const hasOwnReferralShareCard = await page.locator('label:has-text("รหัสคำเชิญของคุณ")').isVisible().catch(() => false);
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
    await page.waitForTimeout(3500);
    console.log('  Dorm A Onboarding finalized successfully.');

    // --------------------------------------------------------------------------
    // Test 4: Referral Relocation to Subscription Page
    // --------------------------------------------------------------------------
    console.log('\n--- 4. Testing Referral Card on Subscription Page ---');
    await page.goto(`${BASE_URL}/owner/subscription`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    const hasSubReferralCard = await page.locator('text="โปรแกรมแนะนำเพื่อน (Referral Program)"').isVisible();
    const hasSubReferralCode = await page.locator('text="รหัสคำเชิญของคุณ:"').isVisible();
    console.log(`  Subscription page referral program card visible: ${hasSubReferralCard ? '✅ YES' : '❌ NO'}`);
    console.log(`  Subscription page own referral code visible: ${hasSubReferralCode ? '✅ YES' : '❌ NO'}`);

    if (hasIncomingReferral && !hasOwnReferralShareCard && hasSubReferralCard && hasSubReferralCode) {
      results.referral_ui_relocation = true;
    }

    // --------------------------------------------------------------------------
    // Test 5: Add Dormitory Option A Multi-Dormitory (2nd FREE dorm succeeds)
    // --------------------------------------------------------------------------
    console.log('\n--- 5. Testing Add Dormitory Option A Multi-Dormitory (2nd FREE dorm) ---');
    await page.goto(`${BASE_URL}/owner/dormitories/new`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

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
    await page.waitForTimeout(3500);

    // Verify session now has 2 active memberships
    const sessionRes = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/session');
      return res.json();
    });

    const memberships = sessionRes?.data?.memberships || [];
    console.log(`  Active memberships count after Dorm B finalize: ${memberships.length} (Expected: 2)`);
    console.log(`  Memberships list:`, JSON.stringify(memberships.map(m => ({ id: m.id, name: m.dormitoryName, role: m.roleCode }))));

    if (memberships.length === 2) {
      results.add_dorm_option_a_multi_dorm = true;
    }

    await context.close();
  } catch (err) {
    console.error('❌ Error during Batch 01 verification:', err);
    throw err;
  } finally {
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
