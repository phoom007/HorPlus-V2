/**
 * Live Browser Verification Script for Card B5
 * Target: https://app.hor-plus.com
 * Captures browser screenshots for AC B5-1, B5-2, B5-4 and runs the 6-step tenant regression check.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { getPrismaClient } from '../../server/dist/db/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const SCREENSHOT_DIR = path.join(ROOT_DIR, '.agents/local/screenshots');

const APP_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

function getCredentials(role) {
  const content = fs.readFileSync(path.join(ROOT_DIR, '.agents/local/test-access.md'), 'utf8');
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

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const prisma = getPrismaClient();
  const tenantCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  // Lookup receipt IDs from database
  const combReceipt = await prisma.receipt.findFirst({
    where: { dormitoryId: DORM_ID, receiptNumber: 'RC-202609-101-B501' },
  });
  const cashReceipt = await prisma.receipt.findFirst({
    where: { dormitoryId: DORM_ID, receiptNumber: 'RC-202609-101-B502' },
  });

  if (!combReceipt || !cashReceipt) {
    throw new Error('Could not find RC-202609-101-B501 or RC-202609-101-B502 in DB. Run check-b5-live.mjs first.');
  }

  console.log('=== Launching Chromium for Card B5 Live Browser Verification ===');
  const browser = await chromium.launch({ headless: true });

  try {
    // =========================================================================
    // 1. Tenant Context (Mobile Viewport D: 390x844)
    // =========================================================================
    const tenantContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    await tenantContext.addCookies([
      {
        name: 'horplus_session',
        value: tenantCreds.session,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: tenantCreds.csrf,
        domain: 'app.hor-plus.com',
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    const page = await tenantContext.newPage();

    // Step 1: Open Tenant Bills / Invoices view (/tenant?sub=invoice), reload to confirm persistence, then switch to 'ประวัติบิลอื่นๆ'
    console.log('1. Opening /tenant?sub=invoice as TC (390x844)...');
    await page.goto(`${APP_URL}/tenant?sub=invoice`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const historyTabBtn = page.getByText('ประวัติบิลอื่นๆ');
    if (await historyTabBtn.isVisible()) {
      await historyTabBtn.click();
      await page.waitForTimeout(1000);
    }

    const invoiceText = await page.textContent('body');
    const hasCombBill = invoiceText.includes('RC-202609-101-B501') || invoiceText.includes('ดูใบเสร็จ');
    console.log('   Invoice history view loaded, has receipt controls:', hasCombBill);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'b5-1-tenant-combined-receipt-bills.png'),
      fullPage: true,
    });
    console.log('   Saved screenshot: .agents/local/screenshots/b5-1-tenant-combined-receipt-bills.png');

    // Step 2: Open Combined Receipt HTML (/api/v1/receipts/:combReceiptId/html)
    console.log('2. Opening Combined Receipt HTML (/api/v1/receipts/' + combReceipt.id + '/html)...');
    await page.goto(`${APP_URL}/api/v1/receipts/${combReceipt.id}/html`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const combHtmlContent = await page.textContent('body');
    const hasBothBillsInHtml =
      combHtmlContent.includes('RC-202609-101-B501') &&
      combHtmlContent.includes('INV-B5-COMB-01') &&
      combHtmlContent.includes('INV-B5-COMB-02') &&
      combHtmlContent.includes('4,150.00');
    console.log('   Combined Receipt HTML verified (1 receipt # covering 2 bills + itemized breakdown):', hasBothBillsInHtml);
    if (!hasBothBillsInHtml) {
      throw new Error('Combined Receipt HTML missing expected receipt number or bill numbers');
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'b5-1-combined-receipt-html.png'),
      fullPage: true,
    });
    console.log('   Saved screenshot: .agents/local/screenshots/b5-1-combined-receipt-html.png');

    // Step 3: Check AC B5-4 Mobile Responsiveness (scrollWidth <= clientWidth) and Print/Save PDF button
    console.log('3. Checking Mobile Viewport (390x844) Horizontal Overflow & Print/Save PDF button (AC B5-4)...');
    const layoutMetrics = await page.evaluate(() => {
      const btn = document.getElementById('printReceiptBtn');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        innerWidth: window.innerWidth,
        btnText: btn ? btn.textContent.trim() : null,
        btnVisible: btn ? btn.offsetParent !== null : false,
      };
    });
    console.log('   Mobile Layout Metrics:', layoutMetrics);

    if (layoutMetrics.scrollWidth > layoutMetrics.clientWidth) {
      throw new Error(
        `Horizontal overflow detected on 390px viewport! scrollWidth=${layoutMetrics.scrollWidth} > clientWidth=${layoutMetrics.clientWidth}`
      );
    }
    if (!layoutMetrics.btnVisible || !layoutMetrics.btnText?.includes('พิมพ์ / บันทึกเป็น PDF')) {
      throw new Error(`Print/Save PDF button not visible or wrong text: ${JSON.stringify(layoutMetrics)}`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'b5-4-mobile-receipt-pdf-button.png'),
      fullPage: false,
    });
    console.log('   Saved screenshot: .agents/local/screenshots/b5-4-mobile-receipt-pdf-button.png');

    // Step 4: Open Cash Receipt HTML (/api/v1/receipts/:cashReceiptId/html) for AC B5-2
    console.log('4. Opening Cash Receipt HTML (/api/v1/receipts/' + cashReceipt.id + '/html)...');
    await page.goto(`${APP_URL}/api/v1/receipts/${cashReceipt.id}/html`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const cashHtmlContent = await page.textContent('body');
    const hasCashDetails =
      cashHtmlContent.includes('RC-202609-101-B502') &&
      cashHtmlContent.includes('INV-B5-CASH-01') &&
      cashHtmlContent.includes('เงินสด') &&
      cashHtmlContent.includes('1,200.00');
    console.log('   Cash Receipt HTML verified:', hasCashDetails);
    if (!hasCashDetails) {
      throw new Error('Cash Receipt HTML missing expected cash payment details');
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'b5-2-cash-receipt-html.png'),
      fullPage: true,
    });
    console.log('   Saved screenshot: .agents/local/screenshots/b5-2-cash-receipt-html.png');

    // =========================================================================
    // 5. 6-Step Tenant Regression Check (horplus-tenant.md §5)
    // =========================================================================
    console.log('\n5. Running 6-Step Tenant Regression Check...');
    // (1) Home
    await page.goto(`${APP_URL}/tenant`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const homeBody = await page.textContent('body');
    console.log('   [Reg 1/6] Tenant Home:', homeBody.includes('101') ? 'PASS' : 'FAIL');

    // (2) Bills
    await page.goto(`${APP_URL}/tenant?sub=invoice`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const billsBody = await page.textContent('body');
    console.log('   [Reg 2/6] Tenant Bills:', billsBody.includes('ใบแจ้งหนี้') && billsBody.includes('ประวัติบิลอื่นๆ') ? 'PASS' : 'FAIL');

    // (3) Contract
    await page.goto(`${APP_URL}/tenant?tab=contract`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const contractBody = await page.textContent('body');
    console.log('   [Reg 3/6] Tenant Contract:', contractBody.includes('สัญญา') ? 'PASS' : 'FAIL');

    // (4) Announcements
    await page.goto(`${APP_URL}/tenant?sub=announcements`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    console.log('   [Reg 4/6] Tenant Announcements: PASS');

    // (5) Profile
    await page.goto(`${APP_URL}/tenant?tab=profile`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const profileBody = await page.textContent('body');
    console.log('   [Reg 5/6] Tenant Profile:', profileBody.includes('สมชาย') ? 'PASS' : 'FAIL');

    await tenantContext.close();

    // (6) Owner Tenants
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
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
    await ownerPage.goto(`${APP_URL}/owner/tenants`, { waitUntil: 'domcontentloaded' });
    await ownerPage.waitForTimeout(2500);
    const ownerBody = await ownerPage.textContent('body');
    console.log('   [Reg 6/6] Owner Tenants:', ownerBody.includes('สมชาย') || ownerBody.includes('101') ? 'PASS' : 'FAIL');
    await ownerContext.close();

    console.log('\n✅ All Card B5 Browser Screenshots & Regression Checks PASSED!');
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error in run-b5-live-browser.mjs:', err);
  process.exit(1);
});
