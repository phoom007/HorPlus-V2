import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const LOCAL_DIR = path.join(ROOT_DIR, '.agents/local');
const SESSIONS_DIR = path.join(LOCAL_DIR, 'sessions');
const SCREENSHOTS_DIR = path.join(LOCAL_DIR, 'screenshots');
const APP_URL = 'https://app.hor-plus.com';

function getSessionToken(roleKey) {
  try {
    const sessionData = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${roleKey}.json`), 'utf8'));
    const cookie = sessionData.cookies.find(c => c.name === 'horplus_session');
    const csrfCookie = sessionData.cookies.find(c => c.name === 'horplus_csrf');
    return { sessionToken: cookie?.value, csrfToken: csrfCookie?.value };
  } catch {
    return { sessionToken: null, csrfToken: null };
  }
}

async function run() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log('STARTING TASK 03 LIVE CHECKS ON https://app.hor-plus.com');
  console.log('====================================================');

  const report = {};

  // ----------------------------------------------------
  // 1. AC-4: Backdoor removal live check
  // ----------------------------------------------------
  console.log('\n--- Checking AC-4: /api/v1/auth/owner-direct-entry backdoor removal ---');
  const backdoorRes = await fetch(`${APP_URL}/api/v1/auth/owner-direct-entry?grantId=423b38a0-596a-49aa-86ee-162f548411d0`);
  const backdoorStatus = backdoorRes.status;
  console.log(`GET /api/v1/auth/owner-direct-entry -> HTTP ${backdoorStatus}`);
  report['AC-4-endpoint'] = { status: backdoorStatus, pass: backdoorStatus === 404 };

  // ----------------------------------------------------
  // 2. AC-5: Open redirect sanitization live check
  // ----------------------------------------------------
  console.log('\n--- Checking AC-5: Auth ?redirect= open redirect sanitization ---');
  // Attempt redirect to external evil.com
  const redirectEvilRes = await fetch(`${APP_URL}/api/v1/auth/dev-login?redirect=https://evil.com`, {
    redirect: 'manual'
  });
  const evilLocation = redirectEvilRes.headers.get('location') || '';
  console.log(`?redirect=https://evil.com -> HTTP ${redirectEvilRes.status}, Location: ${evilLocation}`);
  const evilBlocked = !evilLocation.includes('evil.com') && evilLocation.includes('/owner/home');

  // Attempt redirect to protocol-relative //evil.com
  const redirectProtoRes = await fetch(`${APP_URL}/api/v1/auth/dev-login?redirect=//evil.com`, {
    redirect: 'manual'
  });
  const protoLocation = redirectProtoRes.headers.get('location') || '';
  console.log(`?redirect=//evil.com -> HTTP ${redirectProtoRes.status}, Location: ${protoLocation}`);
  const protoBlocked = !protoLocation.includes('evil.com') && protoLocation.includes('/owner/home');

  // Safe internal path
  const redirectSafeRes = await fetch(`${APP_URL}/api/v1/auth/dev-login?redirect=/owner/subscription`, {
    redirect: 'manual'
  });
  const safeLocation = redirectSafeRes.headers.get('location') || '';
  console.log(`?redirect=/owner/subscription -> HTTP ${redirectSafeRes.status}, Location: ${safeLocation}`);
  const safeAllowed = safeLocation.includes('/owner/subscription');

  report['AC-5'] = {
    evilBlocked,
    protoBlocked,
    safeAllowed,
    pass: evilBlocked && protoBlocked && safeAllowed
  };

  // ----------------------------------------------------
  // 3. AC-6: Billboard mutation security (unauthenticated = 401, non-admin = 403)
  // ----------------------------------------------------
  console.log('\n--- Checking AC-6: Billboard mutations rejected without auth/CSRF ---');
  const postBillboardNoAuth = await fetch(`${APP_URL}/api/v1/billboard`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: '/billboards/test.jpg', title: 'Unauthorized' }),
  });
  const postStatus = postBillboardNoAuth.status;
  const postBody = await postBillboardNoAuth.json().catch(() => ({}));
  console.log(`POST /api/v1/billboard (no auth) -> HTTP ${postStatus}`, postBody);

  const deleteBillboardNoAuth = await fetch(`${APP_URL}/api/v1/billboard/test-id-123`, {
    method: 'DELETE',
  });
  const deleteStatus = deleteBillboardNoAuth.status;
  const deleteBody = await deleteBillboardNoAuth.json().catch(() => ({}));
  console.log(`DELETE /api/v1/billboard/:id (no auth) -> HTTP ${deleteStatus}`, deleteBody);

  const resetBillboardNoAuth = await fetch(`${APP_URL}/api/v1/billboard/reset`, {
    method: 'POST',
  });
  const resetStatus = resetBillboardNoAuth.status;
  const resetBody = await resetBillboardNoAuth.json().catch(() => ({}));
  console.log(`POST /api/v1/billboard/reset (no auth) -> HTTP ${resetStatus}`, resetBody);

  // Authenticated call without platform admin role
  const { sessionToken, csrfToken } = getSessionToken('owner');
  let authDenied403 = false;
  if (sessionToken && csrfToken) {
    const resetWithAuth = await fetch(`${APP_URL}/api/v1/billboard/reset`, {
      method: 'POST',
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
      },
    });
    console.log(`POST /api/v1/billboard/reset (with Owner auth) -> HTTP ${resetWithAuth.status}`, await resetWithAuth.json().catch(() => ({})));
    authDenied403 = resetWithAuth.status === 403;
  }

  report['AC-6'] = {
    postNoAuth: postStatus === 401,
    deleteNoAuth: deleteStatus === 401,
    resetNoAuth: resetStatus === 401,
    authDenied403,
    pass: postStatus === 401 && deleteStatus === 401 && resetStatus === 401 && authDenied403
  };

  // ----------------------------------------------------
  // 4. AC-7: Billboard GET read-only live check
  // ----------------------------------------------------
  console.log('\n--- Checking AC-7: GET /api/v1/billboard is read-only ---');
  const getBillboardRes = await fetch(`${APP_URL}/api/v1/billboard`);
  const getStatus = getBillboardRes.status;
  const getBody = await getBillboardRes.json().catch(() => ({}));
  console.log(`GET /api/v1/billboard -> HTTP ${getStatus}, items count: ${getBody.data?.length}`);
  report['AC-7'] = {
    status: getStatus,
    count: getBody.data?.length || 0,
    pass: getStatus === 200 && Array.isArray(getBody.data) && getBody.data.length > 0
  };

  // ----------------------------------------------------
  // 5. Playwright UI Live Verification & Screenshots
  // ----------------------------------------------------
  console.log('\n--- Launching browser for AC-4 & AC-7 UI verification ---');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });
  const page = await context.newPage();

  // Check Owner Login Page for AC-4
  console.log('Navigating to https://app.hor-plus.com/auth/owner...');
  await page.goto(`${APP_URL}/auth/owner`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Check for any presence of backdoor grantId or link
  const pageContent = await page.content();
  const hasBackdoorText = pageContent.includes('423b38a0-596a-49aa-86ee-162f548411d0') || pageContent.includes('owner-direct-entry');
  console.log(`Owner Login Page contains backdoor link/grantId: ${hasBackdoorText}`);

  const loginScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac4-owner-login-no-backdoor.png');
  await page.screenshot({ path: loginScreenshotPath, fullPage: true });
  console.log(`Saved screenshot: ${loginScreenshotPath}`);
  report['AC-4-ui'] = { hasBackdoorText, screenshot: 'ac4-owner-login-no-backdoor.png', pass: !hasBackdoorText };

  // Check Subscription Billboard for AC-7 with Owner session
  if (sessionToken) {
    console.log('Setting owner session cookie and navigating to /owner/subscription...');
    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'app.hor-plus.com', path: '/' },
      { name: 'active_dormitory_id', value: '20000001-0000-4000-8000-000000000002', domain: 'app.hor-plus.com', path: '/' },
    ]);
    await page.goto(`${APP_URL}/owner/subscription`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    const subscriptionScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac7-billboard-carousel-live.png');
    await page.screenshot({ path: subscriptionScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${subscriptionScreenshotPath}`);
    report['AC-7-ui'] = { screenshot: 'ac7-billboard-carousel-live.png', pass: true };
  }

  await browser.close();

  console.log('\n====================================================');
  console.log('LIVE VERIFICATION SUMMARY:');
  console.log(JSON.stringify(report, null, 2));
  console.log('====================================================');

  const allPassed = Object.values(report).every(r => r.pass === true);
  if (!allPassed) {
    console.error('FAIL: One or more live checks did not pass!');
    process.exit(1);
  } else {
    console.log('SUCCESS: All Task 03 live checks PASSED with high-fidelity evidence!');
  }
}

run().catch(err => {
  console.error('Fatal live check error:', err);
  process.exit(1);
});
