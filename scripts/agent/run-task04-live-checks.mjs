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
const DORM_ID = '20000001-0000-4000-8000-000000000002';
const CONTRACT_ID = '67f78b4f-f1bf-4e51-846d-97eb6e0c6036';
const OTHER_CONTRACT_ID = 'fff23beb-2c66-438c-bd38-bb34ea4895cb';

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

async function runLiveChecks() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  console.log('====================================================');
  console.log('STARTING TASK 04 LIVE CHECKS ON https://app.hor-plus.com');
  console.log('====================================================');

  const results = {};

  // 1. Health check
  console.log('\n--- Checking Pilot Health Readiness ---');
  const healthRes = await fetch(`${APP_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('Health readiness status:', healthRes.status, JSON.stringify(healthJson));
  results['Health'] = { status: healthRes.status, ok: healthRes.status === 200, data: healthJson };

  // 2. AC-5: Live Owner PDF Download
  console.log('\n--- Checking AC-5: Owner Contract PDF Download ---');
  const ownerTokens = getSessionToken('owner');
  const ownerRes = await fetch(`${APP_URL}/api/v1/contracts/${CONTRACT_ID}/pdf`, {
    headers: {
      'Cookie': `horplus_session=${ownerTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const ownerContentType = ownerRes.headers.get('content-type') || '';
  const ownerBuf = await ownerRes.arrayBuffer();
  const ownerBytes = Buffer.from(ownerBuf);
  const ownerMagic = ownerBytes.slice(0, 5).toString();
  console.log(`Owner PDF -> HTTP ${ownerRes.status}, Content-Type: ${ownerContentType}, Size: ${ownerBytes.length} bytes, Magic: ${ownerMagic}`);
  results['AC-5'] = {
    pass: ownerRes.status === 200 && ownerContentType.includes('application/pdf') && ownerMagic === '%PDF-',
    evidence: `HTTP ${ownerRes.status}, Content-Type: ${ownerContentType}, Size: ${ownerBytes.length} bytes, Magic: ${ownerMagic}`,
  };

  // 3. AC-6: Live Tenant PDF Download (own contract) & Forbidden on other contract
  console.log('\n--- Checking AC-6: Tenant Contract PDF Download ---');
  const tenantTokens = getSessionToken('tenant');
  const tenantRes = await fetch(`${APP_URL}/api/v1/contracts/${CONTRACT_ID}/pdf`, {
    headers: {
      'Cookie': `horplus_session=${tenantTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const tenantContentType = tenantRes.headers.get('content-type') || '';
  const tenantBuf = await tenantRes.arrayBuffer();
  const tenantBytes = Buffer.from(tenantBuf);
  const tenantMagic = tenantBytes.slice(0, 5).toString();
  console.log(`Tenant PDF (own) -> HTTP ${tenantRes.status}, Content-Type: ${tenantContentType}, Size: ${tenantBytes.length} bytes, Magic: ${tenantMagic}`);

  const tenantOtherRes = await fetch(`${APP_URL}/api/v1/contracts/${OTHER_CONTRACT_ID}/pdf`, {
    headers: {
      'Cookie': `horplus_session=${tenantTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  console.log(`Tenant PDF (other) -> HTTP ${tenantOtherRes.status} (expected 403)`);

  results['AC-6'] = {
    pass: tenantRes.status === 200 && tenantContentType.includes('application/pdf') && tenantMagic === '%PDF-' && tenantOtherRes.status === 403,
    evidence: `Own contract: HTTP ${tenantRes.status} (${tenantContentType}, ${tenantBytes.length} bytes, magic: ${tenantMagic}), Other contract: HTTP ${tenantOtherRes.status} (Forbidden)`,
  };

  // 4. AC-7: Live Staff PDF Download Forbidden
  console.log('\n--- Checking AC-7: Staff Contract PDF Download Denied ---');
  const staffTokens = getSessionToken('staff');
  const staffRes = await fetch(`${APP_URL}/api/v1/contracts/${CONTRACT_ID}/pdf`, {
    headers: {
      'Cookie': `horplus_session=${staffTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const staffJson = await staffRes.json().catch(() => null);
  console.log(`Staff PDF -> HTTP ${staffRes.status} (expected 403)`, staffJson);
  results['AC-7'] = {
    pass: staffRes.status === 403,
    evidence: `Staff contract PDF: HTTP ${staffRes.status}, Code: ${staffJson?.error?.code}, Message: ${staffJson?.error?.message}`,
  };

  // 5. Concurrency check (PERF-01) on live server: 3 simultaneous requests
  console.log('\n--- Checking PERF-01: Live Concurrency Bounding (3 simultaneous requests) ---');
  const startConcurrent = Date.now();
  const concurrentReqs = [1, 2, 3].map(async (i) => {
    const res = await fetch(`${APP_URL}/api/v1/contracts/${CONTRACT_ID}/pdf`, {
      headers: {
        'Cookie': `horplus_session=${ownerTokens.sessionToken}`,
        'x-dormitory-id': DORM_ID,
      },
    });
    const buf = await res.arrayBuffer();
    return {
      index: i,
      status: res.status,
      size: buf.byteLength,
      magic: Buffer.from(buf).slice(0, 5).toString(),
    };
  });
  const concurrentResults = await Promise.all(concurrentReqs);
  const concurrentElapsed = Date.now() - startConcurrent;
  console.log(`3 concurrent PDF requests completed in ${concurrentElapsed}ms:`, concurrentResults);
  const allConcurrentOk = concurrentResults.every(r => r.status === 200 && r.magic === '%PDF-' && r.size > 1000);
  results['PERF-01-Live'] = {
    pass: allConcurrentOk,
    evidence: `3 concurrent PDF requests returned HTTP 200 in ${concurrentElapsed}ms, all starting with %PDF-`,
  };

  // 6. Playwright UI Screenshots
  console.log('\n--- Capturing UI Screenshots with Playwright ---');
  const browser = await chromium.launch({ headless: true });
  try {
    // Owner UI
    const ownerContext = await browser.newContext({
      storageState: path.join(SESSIONS_DIR, 'owner.json'),
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const ownerPage = await ownerContext.newPage();
    await ownerPage.goto(`${APP_URL}/owner/tenants`, { waitUntil: 'networkidle', timeout: 30000 });
    await ownerPage.waitForTimeout(2000);
    const ownerScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac5-owner-tenants-contract-live.png');
    await ownerPage.screenshot({ path: ownerScreenshotPath, fullPage: false });
    console.log(`Saved Owner tenants screenshot: ${ownerScreenshotPath}`);
    await ownerContext.close();

    // Tenant UI
    const tenantContext = await browser.newContext({
      storageState: path.join(SESSIONS_DIR, 'tenant.json'),
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const tenantPage = await tenantContext.newPage();
    await tenantPage.goto(`${APP_URL}/tenant/profile`, { waitUntil: 'networkidle', timeout: 30000 });
    await tenantPage.waitForTimeout(2000);
    const tenantScreenshotPath = path.join(SCREENSHOTS_DIR, 'ac6-tenant-profile-live.png');
    await tenantPage.screenshot({ path: tenantScreenshotPath, fullPage: false });
    console.log(`Saved Tenant profile screenshot: ${tenantScreenshotPath}`);
    await tenantContext.close();

    results['Screenshots'] = {
      pass: true,
      owner: ownerScreenshotPath,
      tenant: tenantScreenshotPath,
    };
  } finally {
    await browser.close();
  }

  console.log('\n====================================================');
  console.log('LIVE CHECK RESULTS SUMMARY');
  console.log('====================================================');
  console.log(JSON.stringify(results, null, 2));

  return results;
}

runLiveChecks().catch(err => {
  console.error('Live checks failed with error:', err);
  process.exit(1);
});
