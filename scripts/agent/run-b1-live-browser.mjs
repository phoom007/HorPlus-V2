import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://app.hor-plus.com';

async function run() {
  const ctxData = JSON.parse(fs.readFileSync(path.resolve('.agents/local/b1-live-context.json'), 'utf8'));
  const screenshotDir = path.resolve('.agents/local/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });

  try {
    // 1. Viewport D (390x844) as TD (นางสาวนิดา TD-B1, room 102) -> B1-1, B1-3, B1-4
    console.log('1. Opening https://app.hor-plus.com as TD in Viewport D (390x844)...');
    const tdContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const tdPage = await tdContext.newPage();

    // Authenticate TD via line-tenant-entry on live site
    await tdPage.goto(`${BASE_URL}/api/v1/auth/line-tenant-entry?t=${ctxData.tdToken}`, {
      waitUntil: 'networkidle',
    });
    await tdPage.waitForTimeout(1500);
    await tdPage.reload({ waitUntil: 'networkidle' });
    await tdPage.waitForTimeout(1500);

    const tdHomePath = path.join(screenshotDir, 'b1-1-td-portal-home.png');
    await tdPage.screenshot({ path: tdHomePath, fullPage: true });
    console.log('Saved screenshot:', tdHomePath);

    // Navigate to invoice view (?sub=invoice) and reload to verify persistence
    await tdPage.goto(`${BASE_URL}/tenant?sub=invoice`, { waitUntil: 'networkidle' });
    await tdPage.waitForTimeout(1500);
    await tdPage.reload({ waitUntil: 'networkidle' });
    await tdPage.waitForTimeout(1500);

    const tdInvoicePath = path.join(screenshotDir, 'b1-1-td-portal-three-bills.png');
    await tdPage.screenshot({ path: tdInvoicePath, fullPage: true });
    console.log('Saved screenshot:', tdInvoicePath);

    await tdContext.close();

    // 2. Viewport D (390x844) as TA (สมชาย ใจดี, room 101) -> B1-5 Cross-Tenant Isolation
    console.log('2. Opening https://app.hor-plus.com/tenant?sub=invoice as TA in Viewport D (390x844)...');
    const taContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const [taCookieName, taCookieVal] = ctxData.taSessionCookie.split('=');
    await taContext.addCookies([
      {
        name: taCookieName,
        value: taCookieVal,
        domain: 'app.hor-plus.com',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ]);
    const taPage = await taContext.newPage();
    await taPage.goto(`${BASE_URL}/tenant?sub=invoice`, { waitUntil: 'networkidle' });
    await taPage.waitForTimeout(1500);
    await taPage.reload({ waitUntil: 'networkidle' });
    await taPage.waitForTimeout(1500);

    const taInvoicePath = path.join(screenshotDir, 'b1-5-ta-portal-isolated.png');
    await taPage.screenshot({ path: taInvoicePath, fullPage: true });
    console.log('Saved screenshot:', taInvoicePath);
    await taContext.close();

    // 3. Viewport OW (1440x900) as Owner -> B1-1, B1-2, B1-3 Owner Payments & Tenants View
    console.log('3. Opening https://app.hor-plus.com/owner/payments as Owner in Viewport OW (1440x900)...');
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const [owCookieName, owCookieVal] = ctxData.ownerSessionCookie.split('=');
    await ownerContext.addCookies([
      {
        name: owCookieName,
        value: owCookieVal,
        domain: 'app.hor-plus.com',
        path: '/',
        secure: true,
        httpOnly: true,
      },
    ]);
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${BASE_URL}/owner/payments`, { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(1500);
    await ownerPage.reload({ waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(1500);

    const ownerBillsPath = path.join(screenshotDir, 'b1-2-owner-bills-list.png');
    await ownerPage.screenshot({ path: ownerBillsPath, fullPage: true });
    console.log('Saved screenshot:', ownerBillsPath);

    await ownerPage.goto(`${BASE_URL}/owner/tenants`, { waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(1500);
    await ownerPage.reload({ waitUntil: 'networkidle' });
    await ownerPage.waitForTimeout(1500);

    const ownerTenantsPath = path.join(screenshotDir, 'b1-2-owner-tenants.png');
    await ownerPage.screenshot({ path: ownerTenantsPath, fullPage: true });
    console.log('Saved screenshot:', ownerTenantsPath);
    await ownerContext.close();

    console.log('=== All Card B1 Live Browser Screenshots Captured Successfully ===');
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
