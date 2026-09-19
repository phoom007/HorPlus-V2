import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

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

  // Set simulation in localStorage
  console.log('Enabling dev_simulate_pending_registration...');
  await page.evaluate(() => {
    localStorage.setItem('dev_simulate_pending_registration', 'true');
  });

  // Reload page to reflect simulation
  await page.reload();
  await page.waitForTimeout(2000);

  // Wait for the pending button to appear
  const pendingBtn = page.locator('[data-testid="tenant-pending-register-btn"]');
  await pendingBtn.waitFor({ state: 'visible', timeout: 10000 });

  console.log('Pending button is visible! Text:', await pendingBtn.textContent());

  // Capture screenshot of HomeTab with pending status
  const brainDir = 'C:/Users/phoom/.gemini/antigravity/brain/0948dd5a-0a64-4282-b04b-4e09ff06f118';
  const screenshotPath1 = path.join(brainDir, 'hometab_pending_request_simulation.png');
  await page.screenshot({ path: screenshotPath1, fullPage: false });
  console.log('Saved HomeTab screenshot to:', screenshotPath1);

  // Now open DevSwitcher to capture the DevSwitcher UI with active simulation
  const devSwitcherBtn = page.locator('[data-testid="dev-tenant-switcher-btn"]');
  if (await devSwitcherBtn.isVisible()) {
    await devSwitcherBtn.click();
    await page.waitForTimeout(1000);
    const screenshotPath2 = path.join(brainDir, 'devswitcher_simulating_pending.png');
    await page.screenshot({ path: screenshotPath2, fullPage: false });
    console.log('Saved DevSwitcher screenshot to:', screenshotPath2);
  }

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch((err) => {
  console.error('Error capturing screenshot:', err);
  process.exit(1);
});
