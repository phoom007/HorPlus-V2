import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  console.log('Logging in as tenant Room 202...');
  try {
    await page.goto('http://127.0.0.1:5173/api/v1/auth/dev-tenant-login?roomNumber=202&redirect=/tenant/dashboard', { timeout: 15000 });
  } catch (err) {
    console.log('Direct login redirect or navigating directly to dashboard...');
    await page.goto('http://127.0.0.1:5173/tenant/dashboard', { timeout: 15000 });
  }

  await page.waitForTimeout(2000);

  // Clear simulation flag so normal room 202 is active
  await page.evaluate(() => {
    localStorage.removeItem('dev_simulate_pending_registration');
  });
  await page.reload();
  await page.waitForTimeout(2000);

  // 1. Navigate to "บิลและการชำระเงิน" (Payments Tab)
  console.log('Navigating to Payments Tab (บิลและการชำระเงิน)...');
  // Look for bottom nav tab "บิล" or click payments menu
  const billNavBtn = page.locator('button:has-text("บิล")').first();
  if (await billNavBtn.isVisible()) {
    await billNavBtn.click();
  } else {
    // Or click menu "ชำระค่าเช่า" or "ใบแจ้งหนี้"
    const menuPaymentBtn = page.locator('[data-testid="menu-payment-btn"]').first();
    if (await menuPaymentBtn.isVisible()) {
      await menuPaymentBtn.click();
    }
  }
  await page.waitForTimeout(2000);

  const brainDir = 'C:/Users/phoom/.gemini/antigravity/brain/0948dd5a-0a64-4282-b04b-4e09ff06f118';

  // Capture screenshot of Payments Tab ("บิลและการชำระเงิน")
  const screenshotPath1 = path.join(brainDir, 'payments_tab_canonical_titles_and_paid_time.png');
  await page.screenshot({ path: screenshotPath1, fullPage: false });
  console.log('Saved Payments Tab screenshot to:', screenshotPath1);

  // 2. Click "รายละเอียด" on a paid bill to test auto-expand in history tab
  const paidDetailBtn = page.locator('[data-testid^="btn-bill-detail-"]').first();
  if (await paidDetailBtn.isVisible()) {
    console.log('Clicking รายละเอียด on paid bill...');
    await paidDetailBtn.click();
    await page.waitForTimeout(1500);

    // Switch to history tab if not already on it
    const historyTabBtn = page.locator('button:has-text("ประวัติบิลอื่นๆ")');
    if (await historyTabBtn.isVisible()) {
      await historyTabBtn.click();
      await page.waitForTimeout(1000);
    }

    // Also expand another bill to demonstrate multi-accordion
    const historyCards = page.locator('[data-testid^="history-bill-"]');
    const count = await historyCards.count();
    console.log(`Found ${count} history bills.`);
    if (count > 1) {
      // Click second bill to expand it as well
      const secondBillBtn = historyCards.nth(1).locator('button').first();
      await secondBillBtn.click();
      await page.waitForTimeout(1000);
    }

    const screenshotPath2 = path.join(brainDir, 'invoice_history_multi_accordion_expanded.png');
    await page.screenshot({ path: screenshotPath2, fullPage: false });
    console.log('Saved Multi-Accordion Invoice History screenshot to:', screenshotPath2);
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch((err) => {
  console.error('Error capturing screenshot:', err);
  process.exit(1);
});
