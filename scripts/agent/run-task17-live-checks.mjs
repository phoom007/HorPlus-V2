import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOCAL_DIR = path.join(ROOT_DIR, '.agents/local');
const SESSIONS_DIR = path.join(LOCAL_DIR, 'sessions');
const SCREENSHOTS_DIR = path.join(LOCAL_DIR, 'screenshots');
const ARTIFACT_DIR = 'C:/Users/phoom/.gemini/antigravity/brain/d5b97b52-42e2-4c1b-90a8-3ef1c2891d1a';

if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const BROWSER_URL = 'https://app.hor-plus.com';

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Session file not found: ${file}`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sessionCookie = data.cookies.find(c => c.name === 'horplus_session')?.value;
  const csrfCookie = data.cookies.find(c => c.name === 'horplus_csrf')?.value;
  return { file, sessionCookie, csrfCookie, cookies: data.cookies };
}

function saveScreenshot(sourcePath, filename) {
  if (fs.existsSync(ARTIFACT_DIR)) {
    const destPath = path.join(ARTIFACT_DIR, filename);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`📸 Screenshot saved: ${filename}`);
  }
}

async function apiRequest(endpoint, options = {}, session = null, baseUrl = BROWSER_URL) {
  const url = `${baseUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (session?.sessionCookie) {
    const cookies = [`horplus_session=${session.sessionCookie}`];
    if (session.csrfCookie) cookies.push(`horplus_csrf=${session.csrfCookie}`);
    headers['Cookie'] = cookies.join('; ');
  }

  if (session?.csrfCookie && options.method && options.method !== 'GET') {
    if (!headers['x-csrf-token'] && !headers['X-CSRF-Token']) {
      headers['x-csrf-token'] = session.csrfCookie;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

async function main() {
  console.log('======================================================================');
  console.log('STARTING LIVE VERIFICATION OF TASK 17 ON https://app.hor-plus.com');
  console.log('======================================================================\n');

  const ownerSession = getSession('owner');
  const staffSession = getSession('staff');
  const tenantSession = getSession('tenant');

  const results = {};
  const browser = await chromium.launch({ headless: true });

  try {
    // ----------------------------------------------------------------------
    // AC-1: Desktop Viewport (1280x800) Owner/Manager Portal
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-1: Desktop Viewport (1280x800) Portal Regression ---');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState: ownerSession.file,
    });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(`${BROWSER_URL}/owner/home`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await desktopPage.waitForTimeout(3000);

    // Hard reload to verify persistence
    await desktopPage.reload({ waitUntil: 'domcontentloaded' });
    await desktopPage.waitForTimeout(2000);

    // Verify desktop elements
    const desktopTitle = await desktopPage.title();
    console.log(`Desktop page title: ${desktopTitle}`);

    // Check no horizontal scrollbar on body
    const hasHorizontalOverflow = await desktopPage.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Desktop horizontal overflow: ${hasHorizontalOverflow} (Expect false)`);

    const ac1Screenshot = path.join(SCREENSHOTS_DIR, 'ac1-desktop-owner-portal-live.png');
    await desktopPage.screenshot({ path: ac1Screenshot, fullPage: false });
    saveScreenshot(ac1Screenshot, 'ac1-desktop-owner-portal-live.png');

    const ac1Pass = !hasHorizontalOverflow && desktopTitle.includes('HorPlus');
    results['AC-1'] = ac1Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-1 RESULT: ${results['AC-1']}\n`);
    await desktopContext.close();

    // ----------------------------------------------------------------------
    // AC-2: iPad / Tablet Viewport (768x1024) Operations Regression
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-2: iPad / Tablet Viewport (768x1024) Operations ---');
    const tabletContext = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      storageState: ownerSession.file,
    });
    const tabletPage = await tabletContext.newPage();
    await tabletPage.goto(`${BROWSER_URL}/owner/home?tab=maintenance`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await tabletPage.waitForTimeout(3000);

    const tabletOverflow = await tabletPage.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Tablet horizontal overflow: ${tabletOverflow} (Expect false)`);

    // Verify staff cannot access billing mutation (restricted to Owner/Manager)
    const staffBillCheck = await apiRequest('/api/v1/bills/generate', {
      method: 'POST',
      body: JSON.stringify({
        billingCycleId: '00000000-0000-0000-0000-000000000000',
        roomId: '00000000-0000-0000-0000-000000000000',
      }),
    }, staffSession);
    console.log(`Staff calling POST /api/v1/bills/generate: status=${staffBillCheck.status} (Expect 403)`);

    const ac2Screenshot = path.join(SCREENSHOTS_DIR, 'ac2-tablet-operations-live.png');
    await tabletPage.screenshot({ path: ac2Screenshot, fullPage: false });
    saveScreenshot(ac2Screenshot, 'ac2-tablet-operations-live.png');

    const ac2Pass = !tabletOverflow && staffBillCheck.status === 403;
    results['AC-2'] = ac2Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-2 RESULT: ${results['AC-2']}\n`);
    await tabletContext.close();

    // ----------------------------------------------------------------------
    // AC-3: Mobile Viewport (375x812) Tenant Portal Regression
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-3: Mobile Viewport (375x812) Tenant Portal ---');
    const mobileContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      storageState: tenantSession.file,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`${BROWSER_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await mobilePage.waitForTimeout(2000);

    const mobileOverflow = await mobilePage.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`Mobile horizontal overflow: ${mobileOverflow} (Expect false)`);

    // Check bottom navigation exists
    const bottomNavExists = await mobilePage.evaluate(() => {
      return Boolean(document.querySelector('nav') || document.querySelector('[role="navigation"]'));
    });
    console.log(`Mobile navigation rendered: ${bottomNavExists}`);

    const ac3Screenshot = path.join(SCREENSHOTS_DIR, 'ac3-mobile-tenant-portal-live.png');
    await mobilePage.screenshot({ path: ac3Screenshot, fullPage: false });
    saveScreenshot(ac3Screenshot, 'ac3-mobile-tenant-portal-live.png');

    const ac3Pass = !mobileOverflow;
    results['AC-3'] = ac3Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-3 RESULT: ${results['AC-3']}\n`);
    await mobileContext.close();

    // ----------------------------------------------------------------------
    // AC-4: Cross-Portal Journey & Parity (Owner ↔ Tenant ↔ Staff)
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-4: Cross-Portal Journey & Parity ---');
    // Owner reads bill summary
    const ownerBills = await apiRequest('/api/v1/bills?pageSize=5', { method: 'GET' }, ownerSession);
    console.log(`Owner bills query status: ${ownerBills.status}, count: ${ownerBills.json?.data?.items?.length || 0}`);

    // Tenant reads bills
    const tenantBills = await apiRequest('/api/v1/tenant-portal/bills', { method: 'GET' }, tenantSession);
    console.log(`Tenant bills query status: ${tenantBills.status}, items: ${tenantBills.json?.data?.length || 0}`);

    // Capture screenshot of tenant bills modal / tab
    const parityContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      storageState: tenantSession.file,
    });
    const parityPage = await parityContext.newPage();
    await parityPage.goto(`${BROWSER_URL}/tenant/bills`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await parityPage.waitForTimeout(2000);

    const ac4Screenshot = path.join(SCREENSHOTS_DIR, 'ac4-cross-portal-parity-live.png');
    await parityPage.screenshot({ path: ac4Screenshot, fullPage: false });
    saveScreenshot(ac4Screenshot, 'ac4-cross-portal-parity-live.png');

    const ac4Pass = ownerBills.status === 200 && tenantBills.status === 200;
    results['AC-4'] = ac4Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-4 RESULT: ${results['AC-4']}\n`);
    await parityContext.close();

    // ----------------------------------------------------------------------
    // AC-5: Responsive Edge States & Error Presentation
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-5: Responsive Edge States & Error Presentation ---');
    // Health readiness
    const readiness = await apiRequest('/api/v1/health/readiness', { method: 'GET' }, null);
    console.log(`Health readiness status: ${readiness.status}, body:`, readiness.json);

    // Invalid UUID error presentation
    const invalidUuid = await apiRequest('/api/v1/contracts/invalid-uuid/pdf', { method: 'GET' }, ownerSession);
    console.log(`Invalid UUID response: status=${invalidUuid.status}, code=${invalidUuid.json?.error?.code}, message=${invalidUuid.json?.error?.message}`);

    const hasLeakedStackTrace = invalidUuid.text.includes('PrismaClient') ||
                                invalidUuid.text.includes('node_modules') ||
                                invalidUuid.text.includes('postgresql://');
    console.log(`Leaked stack trace / Prisma internals: ${hasLeakedStackTrace} (Expect false)`);

    const edgeContext = await browser.newContext({
      viewport: { width: 375, height: 812 },
      storageState: tenantSession.file,
    });
    const edgePage = await edgeContext.newPage();
    await edgePage.goto(`${BROWSER_URL}/tenant`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await edgePage.waitForTimeout(2000);

    const hasZeroBalanceEdgeCard = await edgePage.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="tenant-zero-balance-card"]') ||
                     document.body.innerText.includes('ไม่มีบิลค้างชำระ'));
    });
    console.log(`Zero balance edge card rendered: ${hasZeroBalanceEdgeCard} (Expect true)`);

    const ac5Screenshot = path.join(SCREENSHOTS_DIR, 'ac5-responsive-edge-states-live.png');
    await edgePage.screenshot({ path: ac5Screenshot, fullPage: false });
    saveScreenshot(ac5Screenshot, 'ac5-responsive-edge-states-live.png');

    const ac5Pass = readiness.status === 200 &&
                    readiness.json?.status === 'UP' &&
                    invalidUuid.status === 404 &&
                    !hasLeakedStackTrace &&
                    hasZeroBalanceEdgeCard;
    results['AC-5'] = ac5Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-5 RESULT: ${results['AC-5']}\n`);
    await edgeContext.close();

    console.log('======================================================================');
    console.log('LIVE VERIFICATION SUMMARY:');
    console.log(JSON.stringify(results, null, 2));
    console.log('======================================================================\n');

  } catch (err) {
    console.error('Error during live checks:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
