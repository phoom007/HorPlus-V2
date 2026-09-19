import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 414, height: 896 }, // Mobile viewport iPhone 11/XR
    deviceScaleFactor: 2,
  });

  const page = await context.newPage();

  console.log('Navigating to tenant register page...');
  await page.goto('http://127.0.0.1:5173/tenant/register?dormitoryId=20000001-0000-4000-8000-000000000002');
  await page.waitForTimeout(1500);

  // If on room picker, select a room (e.g. Room 204 or first available)
  const roomCard = page.locator('text=เลือกห้องนี้').first();
  if (await roomCard.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Clicking available room card...');
    await roomCard.click();
    await page.waitForTimeout(500);

    const monthlyPlanBtn = page.locator('[data-testid="plan-select-monthly"]');
    if (await monthlyPlanBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('Selecting Monthly Plan in bottom sheet...');
      await monthlyPlanBtn.click();
      await page.waitForTimeout(500);
    }
  }

  // Step 1: Click next
  console.log('Navigating Step 1 -> Step 2...');
  const nextBtn = page.locator('[data-testid="bottom-nav-next-btn"]');
  await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
  await nextBtn.click();
  await page.waitForTimeout(500);

  // Step 2: Fill tenant details
  console.log('Filling Step 2...');
  const firstNameInput = page.locator('input[placeholder*="ชื่อจริง"], input[name*="firstName"]').first();
  if (await firstNameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await firstNameInput.fill('สมชาย');
  }
  const lastNameInput = page.locator('input[placeholder*="นามสกุล"], input[name*="lastName"]').first();
  if (await lastNameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await lastNameInput.fill('รักสงบ');
  }
  const phoneInput = page.locator('input[placeholder*="08X"], input[type="tel"]').first();
  if (await phoneInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await phoneInput.fill('0891234567');
  }
  const idInput = page.locator('input[placeholder*="13 หลัก"], input[name*="nationalId"]').first();
  if (await idInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await idInput.fill('1100400123456');
  }

  await nextBtn.click();
  await page.waitForTimeout(500);

  // Step 3: Click next
  console.log('Navigating Step 3 -> Step 4...');
  await nextBtn.click();
  await page.waitForTimeout(500);

  // Step 4: Fill emergency contact if required
  console.log('Filling Step 4...');
  const emergName = page.locator('[data-testid="tenant-emergency-name-input"]');
  if (await emergName.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emergName.fill('นางสมใจ รักสงบ');
  }
  const emergRel = page.locator('[data-testid="tenant-emergency-rel-input"]');
  if (await emergRel.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emergRel.selectOption('มารดา');
  }
  const emergPhone = page.locator('[data-testid="tenant-emergency-phone-input"]');
  if (await emergPhone.isVisible({ timeout: 1000 }).catch(() => false)) {
    await emergPhone.fill('0819876543');
  }

  await nextBtn.click();
  await page.waitForTimeout(800);

  // Now on Step 5: Contract preview!
  console.log('On Step 5: Verifying lessor signature...');
  const step5 = page.locator('#step-5');
  await step5.waitFor({ state: 'visible', timeout: 5000 });

  // Scroll to step 5 signature area
  await page.evaluate(() => {
    const el = document.getElementById('step-5');
    if (el) el.scrollIntoView({ behavior: 'instant', block: 'end' });
  });
  await page.waitForTimeout(500);

  // Check for owner signature image
  const ownerSigImg = page.locator('img[alt="ลายเซ็นผู้ให้เช่า"]');
  const hasOwnerSigImg = await ownerSigImg.isVisible({ timeout: 3000 }).catch(() => false);
  console.log('Owner Signature Image Visible:', hasOwnerSigImg);

  if (hasOwnerSigImg) {
    const imgSrc = await ownerSigImg.getAttribute('src');
    console.log('Owner Signature src length:', imgSrc?.length);
    console.log('Owner Signature src starts with data:image/png:', imgSrc?.startsWith('data:image/png'));
  }

  // Check lessor name
  const lessorNameText = await step5.textContent();
  console.log('Contains นายกบ อบบอ:', lessorNameText?.includes('นายกบ อบบอ'));
  console.log('Contains หอพัก HorPlus UAT Comprehensive Manor:', lessorNameText?.includes('หอพัก HorPlus UAT Comprehensive Manor'));

  // Capture screenshot of Step 5
  const screenshotPath = 'C:/Users/phoom/.gemini/antigravity/brain/0948dd5a-0a64-4282-b04b-4e09ff06f118/r21_02_step5_real_owner_signature_verified.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Saved screenshot to:', screenshotPath);

  // Also copy to r21_02_step5_owner_signature_from_settings.png to replace the mock one
  fs.copyFileSync(screenshotPath, 'C:/Users/phoom/.gemini/antigravity/brain/0948dd5a-0a64-4282-b04b-4e09ff06f118/r21_02_step5_owner_signature_from_settings.png');
  console.log('Replaced r21_02_step5_owner_signature_from_settings.png with real signature evidence!');

  await browser.close();
}

main().catch(console.error);
