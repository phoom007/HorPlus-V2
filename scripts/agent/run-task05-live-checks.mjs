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
  console.log('STARTING TASK 05 LIVE CHECKS ON https://app.hor-plus.com');
  console.log('====================================================');

  const results = {};

  // 1. Health check
  console.log('\n--- Checking Pilot Health Readiness ---');
  const healthRes = await fetch(`${APP_URL}/api/v1/health/readiness`);
  const healthJson = await healthRes.json();
  console.log('Health readiness status:', healthRes.status, JSON.stringify(healthJson));
  results['Health'] = { status: healthRes.status, ok: healthRes.status === 200, data: healthJson };

  // 2. AC-1: Unauthenticated request -> HTTP 401
  console.log('\n--- Checking AC-1: Unauthenticated Request Fail-Closed ---');
  const unauthRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`);
  const unauthJson = await unauthRes.json().catch(() => null);
  console.log(`Unauthenticated GET /profile -> HTTP ${unauthRes.status}`, unauthJson);
  results['AC-1'] = {
    pass: unauthRes.status === 401 && (unauthJson?.error?.code === 'SESSION_REQUIRED' || unauthJson?.error?.code === 'UNAUTHORIZED'),
    evidence: `HTTP ${unauthRes.status} (Code: ${unauthJson?.error?.code}, Message: ${unauthJson?.error?.message})`,
  };

  // 3. AC-2: Unauthenticated request with spoofed x-dormitory-id -> HTTP 401
  console.log('\n--- Checking AC-2: Unauthenticated Request with Spoofed x-dormitory-id ---');
  const spoofedDormRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: {
      'x-dormitory-id': DORM_ID,
    },
  });
  const spoofedDormJson = await spoofedDormRes.json().catch(() => null);
  console.log(`Spoofed DormId GET /profile -> HTTP ${spoofedDormRes.status}`, spoofedDormJson);
  results['AC-2'] = {
    pass: spoofedDormRes.status === 401,
    evidence: `HTTP ${spoofedDormRes.status} (Code: ${spoofedDormJson?.error?.code}, Message: ${spoofedDormJson?.error?.message})`,
  };

  // 4. AC-3: Unauthenticated request with spoofed x-registration-id -> HTTP 401
  console.log('\n--- Checking AC-3: Unauthenticated Request with Spoofed x-registration-id ---');
  const spoofedRegRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: {
      'x-registration-id': '11111111-2222-3333-4444-555555555555',
    },
  });
  const spoofedRegJson = await spoofedRegRes.json().catch(() => null);
  console.log(`Spoofed RegistrationId GET /profile -> HTTP ${spoofedRegRes.status}`, spoofedRegJson);
  results['AC-3'] = {
    pass: spoofedRegRes.status === 401,
    evidence: `HTTP ${spoofedRegRes.status} (Code: ${spoofedRegJson?.error?.code})`,
  };

  // 5. AC-4: Non-tenant / Revoked user -> HTTP 403 Forbidden
  console.log('\n--- Checking AC-4: Revoked / Non-Tenant Membership Check ---');
  const staffTokens = getSessionToken('staff');
  const nonTenantRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: {
      'Cookie': `horplus_session=${staffTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const nonTenantJson = await nonTenantRes.json().catch(() => null);
  console.log(`Non-tenant member GET /profile -> HTTP ${nonTenantRes.status}`, nonTenantJson);
  results['AC-4'] = {
    pass: nonTenantRes.status === 403,
    evidence: `HTTP ${nonTenantRes.status} (Code: ${nonTenantJson?.error?.code}, Message: ${nonTenantJson?.error?.message})`,
  };

  // 6. AC-5: Authenticated active Tenant -> HTTP 200
  console.log('\n--- Checking AC-5: Authenticated Tenant Session Access ---');
  const tenantTokens = getSessionToken('tenant');
  const tenantRes = await fetch(`${APP_URL}/api/v1/tenant-portal/profile`, {
    headers: {
      'Cookie': `horplus_session=${tenantTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const tenantJson = await tenantRes.json().catch(() => null);
  console.log(`Tenant GET /profile -> HTTP ${tenantRes.status}`, {
    id: tenantJson?.id,
    name: tenantJson?.name,
    status: tenantJson?.status,
    hasRoom: tenantJson?.hasRoom,
    room: tenantJson?.room?.roomNumber,
  });

  const tenantRoomsRes = await fetch(`${APP_URL}/api/v1/tenant-portal/rooms`, {
    headers: {
      'Cookie': `horplus_session=${tenantTokens.sessionToken}`,
      'x-dormitory-id': DORM_ID,
    },
  });
  const tenantRoomsJson = await tenantRoomsRes.json().catch(() => null);
  console.log(`Tenant GET /rooms -> HTTP ${tenantRoomsRes.status}`, {
    success: tenantRoomsJson?.success,
    count: tenantRoomsJson?.rooms?.length,
  });

  results['AC-5'] = {
    pass: tenantRes.status === 200 && tenantRoomsRes.status === 200 && tenantJson?.status === 'active',
    evidence: `Profile: HTTP ${tenantRes.status} (Tenant ID: ${tenantJson?.id}, Name: ${tenantJson?.name}, Status: ${tenantJson?.status}), Rooms: HTTP ${tenantRoomsRes.status} (${tenantRoomsJson?.rooms?.length} rooms)`,
  };

  // 7. AC-6: Source code audit
  console.log('\n--- Checking AC-6: Source Code Audit ---');
  const routeFilePath = path.join(ROOT_DIR, 'server/src/routes/tenant-portal.routes.ts');
  const routeSource = fs.readFileSync(routeFilePath, 'utf8');
  const hasHardcodedUuid = routeSource.includes('d99948ec-49d4-4629-9fea-567241e5049d');
  const hasFallbackSynthesis = routeSource.includes('Fallback candidate session for LINE');
  const hasIsTestEnv = routeSource.includes('const isTestEnv = process.env.NODE_ENV');
  console.log('Audit results:', { hasHardcodedUuid, hasFallbackSynthesis, hasIsTestEnv });
  results['AC-6'] = {
    pass: !hasHardcodedUuid && !hasFallbackSynthesis && !hasIsTestEnv,
    evidence: `Hardcoded UUID: ${hasHardcodedUuid} (false), Fallback synthesis: ${hasFallbackSynthesis} (false), isTestEnv: ${hasIsTestEnv} (false)`,
  };

  // 8. AC-7: Playwright UI Screenshot
  console.log('\n--- Capturing UI Screenshot with Playwright ---');
  const browser = await chromium.launch({ headless: true });
  try {
    const tenantContext = await browser.newContext({
      storageState: path.join(SESSIONS_DIR, 'tenant.json'),
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const tenantPage = await tenantContext.newPage();
    await tenantPage.goto(`${APP_URL}/tenant`, { waitUntil: 'networkidle', timeout: 30000 });
    await tenantPage.waitForTimeout(2000);
    const screenshotPath = path.join(SCREENSHOTS_DIR, 'ac7-tenant-workspace-live.png');
    await tenantPage.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Saved Tenant Workspace screenshot: ${screenshotPath}`);
    await tenantContext.close();

    results['AC-7'] = {
      pass: true,
      screenshot: screenshotPath,
      evidence: `Screenshot captured at ${screenshotPath}`,
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
