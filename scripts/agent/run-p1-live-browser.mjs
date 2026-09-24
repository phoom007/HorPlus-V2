import fs from 'fs';
import { chromium } from 'playwright';

const BASE_URL = 'https://app.hor-plus.com';
const SCREENSHOT_DIR = '.agents/local/screenshots';

function getCredentials(role) {
  const content = fs.readFileSync('.agents/local/test-access.md', 'utf8');
  const blocks = content.split('### ');
  const block = blocks.find((b) => b.startsWith(`${role}:`));
  if (!block) throw new Error(`Could not find credentials for role: ${role}`);
  const lines = block.split(/\r?\n/).map((l) => l.trim());
  const cookieIdx = lines.findIndex((l) => l.includes('Cookie (horplus_session)'));
  const csrfIdx = lines.findIndex((l) => l.includes('CSRF Token (horplus_csrf)'));
  const session = lines[cookieIdx + 2];
  const csrf = lines[csrfIdx + 2];
  return { session, csrf };
}

async function run() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const taCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  console.log('=== Card P1 Live Browser Automation on https://app.hor-plus.com ===');

  const browser = await chromium.launch({ headless: true });

  try {
    // ----------------------------------------------------
    // Part 1: Tenant Profile & Co-Occupants in Viewport D (Mobile 390x844)
    // ----------------------------------------------------
    console.log('\n[Browser] Step 1: Tenant Profile Viewport D (Mobile)');
    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    await tenantContext.addCookies([
      {
        name: 'horplus_session',
        value: taCreds.session,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: taCreds.csrf,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    const tenantPage = await tenantContext.newPage();
    console.log('[Browser] Navigating to /tenant?sub=profile');
    await tenantPage.goto(`${BASE_URL}/tenant?sub=profile`, { waitUntil: 'networkidle' });
    await tenantPage.waitForTimeout(2000);

    // Verify profile loaded
    await tenantPage.waitForSelector('text=ผู้ติดต่อฉุกเฉิน');
    console.log('[Browser] Profile loaded. Capturing P1-1 read-only emergency contact screenshot...');
    await tenantPage.screenshot({
      path: `${SCREENSHOT_DIR}/p1-1-tenant-profile-readonly-emergency.png`,
      fullPage: true,
    });

    // Check vehicles / pets edit button
    const editVehiclesBtn = tenantPage.locator('button:has-text("แก้ไขข้อมูล")').first();
    if (await editVehiclesBtn.count() > 0) {
      console.log('[Browser] Opening vehicle/pet edit bottom sheet...');
      await editVehiclesBtn.click();
      await tenantPage.waitForTimeout(1000);
      await tenantPage.screenshot({
        path: `${SCREENSHOT_DIR}/p1-2-tenant-profile-edit-vehicle.png`,
      });
      // Close sheet by pressing Escape
      await tenantPage.keyboard.press('Escape');
      await tenantPage.waitForTimeout(1000);
    }

    // Open co-occupants modal
    console.log('[Browser] Opening co-occupants bottom sheet...');
    const coOccupantsBtn = tenantPage.locator('button:has-text("แก้ไขข้อมูล")').nth(1);
    if (await coOccupantsBtn.count() > 0) {
      await coOccupantsBtn.click();
    } else {
      await tenantPage.locator('button:has-text("แก้ไขข้อมูล")').last().click();
    }
    await tenantPage.waitForTimeout(1000);

    // Test P1-5: invalid phone
    console.log('[Browser] Testing P1-5 invalid phone in UI...');
    const nameInput = tenantPage.locator('input[placeholder="เช่น นายอานนท์ มั่นคง"]');
    const phoneInput = tenantPage.locator('input[placeholder="เช่น 0891234567"]');
    const addCoBtn = tenantPage.locator('button:has-text("+ เพิ่มผู้พักอาศัยร่วม")');

    await nameInput.fill('นายทดสอบ เบอร์ผิด');
    await phoneInput.fill('12345');
    await addCoBtn.click();
    await tenantPage.waitForTimeout(1000);

    // Verify Thai validation error message appears
    await tenantPage.waitForSelector('text=เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก (ขึ้นต้นด้วย 0)');
    console.log('[Browser] Validation error rendered! Capturing P1-5 screenshot...');
    await tenantPage.screenshot({
      path: `${SCREENSHOT_DIR}/p1-5-tenant-co-occupant-invalid-phone.png`,
    });

    // Test P1-3: valid phone and add co-occupant
    console.log('[Browser] Testing P1-3 adding co-occupant in UI with CSRF...');
    await nameInput.fill('นายสมหมาย ร่วมพัก');
    await phoneInput.fill('0891234567');
    await addCoBtn.click();
    await tenantPage.waitForTimeout(2000);

    // Wait for the co-occupant to appear in the list
    await tenantPage.waitForSelector('text=นายสมหมาย ร่วมพัก');
    console.log('[Browser] Co-occupant added successfully! Capturing P1-3 added screenshot...');
    await tenantPage.screenshot({
      path: `${SCREENSHOT_DIR}/p1-3-tenant-co-occupant-added.png`,
    });

    // Close bottom sheet
    await tenantPage.keyboard.press('Escape');
    await tenantPage.waitForTimeout(1500);

    // Reload page to verify persistence in UI
    console.log('[Browser] Reloading profile tab to verify persistence...');
    await tenantPage.reload({ waitUntil: 'networkidle' });
    await tenantPage.waitForTimeout(2000);
    await tenantPage.waitForSelector('text=นายสมหมาย ร่วมพัก');
    await tenantPage.screenshot({
      path: `${SCREENSHOT_DIR}/p1-3-tenant-co-occupant-persisted.png`,
      fullPage: true,
    });

    await tenantContext.close();

    // ----------------------------------------------------
    // Part 2: Owner Portal Tenants View (Desktop 1280x800)
    // ----------------------------------------------------
    console.log('\n[Browser] Step 2: Owner Tenants List (Desktop)');
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    await ownerContext.addCookies([
      {
        name: 'horplus_session',
        value: ownerCreds.session,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: ownerCreds.csrf,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    const ownerPage = await ownerContext.newPage();
    console.log('[Browser] Navigating to /owner/tenants');
    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(2000);

    console.log('[Browser] Owner tenants loaded. Capturing P1-1 owner tenants list screenshot...');
    await ownerPage.screenshot({
      path: `${SCREENSHOT_DIR}/p1-1-owner-tenants-list.png`,
      fullPage: true,
    });

    await ownerContext.close();

    console.log('\n=== ALL BROWSER SCREENSHOTS CAPTURED SUCCESSFULLY ===');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error('Browser check failed:', err);
  process.exit(1);
});
