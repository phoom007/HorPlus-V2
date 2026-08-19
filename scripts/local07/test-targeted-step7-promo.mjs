/**
 * Targeted Step 7 Promo UI Browser Test
 * 
 * Verifies:
 * 1. Entering HORPLUS displays server-authoritative "+2 เดือน HorPlus PRO" and "2 เดือน"
 * 2. Entering DAY-15 promo displays server-authoritative "+15 วัน HorPlus PRO"
 * 3. Does not leak "+2 เดือน", "1 เดือน", or "HORPLUS" when DAY promo is active
 * 
 * @license Apache-2.0
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client/index.js');
const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.local07-sessions');
const regStorageState = path.join(SESSIONS_DIR, 'registration-owner.json');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

async function runTargetedStep7PromoBrowserTest() {
  console.log('🚀 Running Targeted Step 7 Promo Browser Test...\n');
  let browser;

  const results = { total: 0, passed: 0, failed: 0 };
  const record = (name, passed, details = '') => {
    results.total++;
    if (passed) {
      results.passed++;
      console.log(`  ✅ PASS: ${name} ${details ? `(${details})` : ''}`);
    } else {
      results.failed++;
      console.log(`  ❌ FAIL: ${name} ${details ? `(${details})` : ''}`);
    }
  };

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      storageState: regStorageState,
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    // Navigate to registration page
    await page.goto(`${BASE_URL}/owner/register`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);

    // Step 1: Fill Dormitory Info
    const dormNameInput = page.locator('input[placeholder*="หอพัก HorPlus"]').first();
    if (await dormNameInput.isVisible()) {
      await dormNameInput.fill(`Targeted Promo Dorm ${Date.now()}`);
      await page.locator('textarea[placeholder*="สุขุมวิท"]').first().fill('123/45 ถนนพหลโยธิน แขวงลาดยาว');
      await page.locator('button:has-text("ถัดไป")').first().click();
      await page.waitForTimeout(400);
    }

    // Step 2: Room setup
    const floorsInput = page.locator('input[placeholder="ระบุจำนวนชั้น"]').first();
    if (await floorsInput.isVisible()) {
      await floorsInput.fill('1');
      await page.locator('input[placeholder="ระบุห้องต่อชั้น"]').first().fill('4');
      await page.waitForTimeout(200);
      await page.locator('button:has-text("ถัดไป")').first().click();
      await page.waitForTimeout(400);
    }

    // Step 3: Rates
    const monthlyRentInput = page.locator('label:has-text("ค่าเช่ารายเดือน")').first().locator('xpath=..').locator('input').first();
    if (await monthlyRentInput.isVisible()) {
      await monthlyRentInput.fill('4500');
    }
    const step3Next = page.locator('button:has-text("ถัดไป")').first();
    if (await step3Next.isVisible()) {
      await step3Next.click();
      await page.waitForTimeout(400);
    }

    // Step 4: Deposits & Bank
    const dueDaySelect = page.locator('[data-testid="due-date-select"]');
    if (await dueDaySelect.isVisible()) {
      await dueDaySelect.selectOption('15');
      const secDepositInput = page.locator('input[inputmode="decimal"]').first();
      if (await secDepositInput.isVisible()) {
        await secDepositInput.fill('0');
      }
      const bankSelect = page.locator('select:has-text("-- เลือกธนาคาร --")').first();
      if (await bankSelect.isVisible()) {
        await bankSelect.selectOption('กสิกรไทย (KBank)');
      }
      const accNumInput = page.locator('input[placeholder*="XXX-X-XXXXX-X"]').first();
      if (await accNumInput.isVisible()) {
        await accNumInput.fill('1234567890');
      }
      const accNameInput = page.locator('input[placeholder*="สมศักดิ์"]').first();
      if (await accNameInput.isVisible()) {
        await accNameInput.fill('นายทดสอบ บัญชีหอพัก');
      }
      await page.locator('button:has-text("ถัดไป")').first().click();
      await page.waitForTimeout(400);
    }

    // Step 5: Rules & Signature
    const selectAllRules = page.locator('button:has-text("เลือกทั้งหมด 10 ข้อ")');
    if (await selectAllRules.isVisible()) {
      await selectAllRules.click();
      const canvas = page.locator('canvas').first();
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 60);
        await page.mouse.up();
      }
      await page.locator('button:has-text("บันทึก")').first().click();
      await page.waitForTimeout(200);
      await page.locator('button:has-text("ถัดไป")').first().click();
      await page.waitForTimeout(400);
    }

    // Step 6: LINE OA
    const step6Next = page.locator('button:has-text("ถัดไป")').first();
    if (await step6Next.isVisible()) {
      await step6Next.click();
      await page.waitForTimeout(600);
    }

    // Now on Step 7
    const step7Header = page.locator('text=ขั้นตอนที่ 7: เลือกแพ็กเกจ');
    record('Step 7 reached successfully in browser', await step7Header.isVisible());

    // 1. Test HORPLUS Promo on PRO plan
    const promoInput = page.locator('[data-testid="input-promo-code"]');
    const applyPromoBtn = page.locator('[data-testid="button-apply-promo"]');

    await promoInput.fill('HORPLUS');
    await applyPromoBtn.click();
    await page.waitForTimeout(600);

    const promoMsgText = await page.locator('[data-testid="promo-inline-message"]').textContent();
    const quoteBreakdownText = await page.locator('.bg-white.p-3\\.5.rounded-2xl').textContent().catch(() => '');

    record(
      'HORPLUS promo UI displays "+2 เดือน HorPlus PRO" and "2 เดือน"',
      promoMsgText?.includes('2 เดือน') && quoteBreakdownText?.includes('สิทธิ์โปรโมชัน HORPLUS:') && quoteBreakdownText?.includes('+2 เดือน HorPlus PRO')
    );

    // 2. Test Sandbox DAY-15 Promo Fixture
    const uiDayPromoCode = `TEST_DAY_15_${Date.now()}`;
    await prisma.promoCode.create({
      data: {
        code: uiDayPromoCode,
        normalizedCode: uiDayPromoCode,
        benefitType: 'TRIAL_EXTENSION',
        benefitUnit: 'DAY',
        benefitValue: 15,
        extensionDays: 15,
        enabled: true,
        globalMaxRedemptions: 100,
      },
    });

    await promoInput.fill(uiDayPromoCode);
    await applyPromoBtn.click();
    await page.waitForTimeout(600);

    const dayPromoMsgText = await page.locator('[data-testid="promo-inline-message"]').textContent();
    const dayQuoteBreakdownText = await page.locator('.bg-white.p-3\\.5.rounded-2xl').textContent().catch(() => '');

    const hasDayLabel = dayPromoMsgText?.includes('15 วัน') &&
      dayQuoteBreakdownText?.includes(`สิทธิ์โปรโมชัน ${uiDayPromoCode}:`) &&
      dayQuoteBreakdownText?.includes('+15 วัน HorPlus PRO');

    const hasNoMonthLeak = !dayQuoteBreakdownText?.includes('+2 เดือน') &&
      !dayQuoteBreakdownText?.includes('+1 เดือน') &&
      !dayQuoteBreakdownText?.includes('สิทธิ์โปรโมชัน HORPLUS:');

    record(
      'DAY-15 promo UI displays "+15 วัน HorPlus PRO" and does not leak hard-coded month labels',
      hasDayLabel && hasNoMonthLeak,
      `Label: ${hasDayLabel}, NoMonthLeak: ${hasNoMonthLeak}`
    );

    await context.close();
  } catch (err) {
    console.error('Fatal error in targeted browser test:', err);
    record('Targeted browser test execution', false, err.message);
  } finally {
    if (browser) await browser.close();
    await prisma.$disconnect();
  }

  console.log('\n======================================================');
  console.log(`Targeted Test Summary: ${results.passed}/${results.total} Passed (${results.failed} Failed)`);
  console.log('======================================================\n');

  if (results.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTargetedStep7PromoBrowserTest().catch(err => {
  console.error('Unexpected failure:', err);
  process.exit(1);
});
