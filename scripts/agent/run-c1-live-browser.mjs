import fs from 'fs';
import { chromium } from 'playwright';

const BASE_URL = 'https://app.hor-plus.com';
const DORM_ID = '20000001-0000-4000-8000-000000000002';

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
  fs.mkdirSync('.agents/local/screenshots', { recursive: true });
  const taCreds = getCredentials('Tenant');
  const ownerCreds = getCredentials('Owner');

  const browser = await chromium.launch({ headless: true });

  // 1. Tenant TA mobile viewport (D: 390x844) -> /tenant?sub=contract
  const taContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await taContext.addCookies([
    {
      name: 'horplus_session',
      value: taCreds.session,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
    },
    {
      name: 'horplus_csrf',
      value: taCreds.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      secure: true,
    },
  ]);

  const taPage = await taContext.newPage();
  const forbiddenRequests = [];
  taPage.on('response', (resp) => {
    if (
      resp.status() === 403 &&
      resp.url().includes('/api/') &&
      !resp.url().includes('/api/v1/contract-renewals/')
    ) {
      forbiddenRequests.push({ url: resp.url(), status: resp.status() });
    }
  });

  await taPage.goto(`${BASE_URL}/tenant?sub=contract`, { waitUntil: 'networkidle' });
  await taPage.waitForTimeout(2500);
  await taPage.reload({ waitUntil: 'networkidle' });
  await taPage.waitForTimeout(2500);

  await taPage.screenshot({
    path: '.agents/local/screenshots/c1-1-ta-contract-view.png',
    fullPage: true,
  });

  // Scroll to Digital Signature Block & PDF attachment section ("เอกสารของฉัน")
  const attachHeading = taPage.locator('text=เอกสารของฉัน').first();
  if ((await attachHeading.count()) > 0) {
    await attachHeading.scrollIntoViewIfNeeded();
  }
  await taPage.waitForTimeout(1000);
  await taPage.screenshot({
    path: '.agents/local/screenshots/c1-2-ta-contract-attachments.png',
    fullPage: false,
  });

  console.log('[Browser C1-1] TA /tenant?sub=contract 403 responses:', forbiddenRequests);
  if (forbiddenRequests.length > 0) {
    throw new Error(`Unexpected 403 responses on TA contract page: ${JSON.stringify(forbiddenRequests)}`);
  }

  await taContext.close();

  // 2. Owner Desktop viewport (OW: 1280x900) -> /owner/contracts
  const ownerContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await ownerContext.addCookies([
    {
      name: 'horplus_session',
      value: ownerCreds.session,
      domain: 'app.hor-plus.com',
      path: '/',
      httpOnly: true,
      secure: true,
    },
    {
      name: 'horplus_csrf',
      value: ownerCreds.csrf,
      domain: 'app.hor-plus.com',
      path: '/',
      secure: true,
    },
    {
      name: 'horplus_dorm_id',
      value: DORM_ID,
      domain: 'app.hor-plus.com',
      path: '/',
    },
  ]);

  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto(`${BASE_URL}/owner/contracts`, { waitUntil: 'networkidle' });
  await ownerPage.waitForTimeout(2000);
  const somchaiItem = ownerPage.locator('text=CTR-2026-101').first();
  if ((await somchaiItem.count()) > 0) {
    await somchaiItem.click();
    await ownerPage.waitForTimeout(1500);
  }
  await ownerPage.screenshot({
    path: '.agents/local/screenshots/c1-1-owner-contracts.png',
    fullPage: true,
  });
  await ownerContext.close();

  await browser.close();
  console.log('=== Card C1 Browser Screenshots Captured Successfully ===');
}

run().catch((err) => {
  console.error('Card C1 Browser Script Error:', err);
  process.exit(1);
});
