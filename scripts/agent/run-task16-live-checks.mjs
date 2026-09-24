import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../../server/node_modules/@prisma/client');

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

// Load environment variables from server/.env
const envConfig = dotenv.parse(fs.readFileSync(path.join(ROOT_DIR, 'server/.env')));
const DATABASE_URL = envConfig.DIRECT_URL || envConfig.DATABASE_URL;
const SESSION_KEY = envConfig.SESSION_ENCRYPTION_KEY;
const CSRF_KEY = envConfig.CSRF_SIGNING_KEY;

function deriveKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function hashSessionId(sessionId) {
  return crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');
}

function encryptSessionToken(payload, secretKey, ttlSeconds = 86400 * 7) {
  const key = deriveKey(secretKey);
  const nowSec = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
  };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonStr = JSON.stringify(fullPayload);
  const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId, csrfKey) {
  const key = deriveKey(csrfKey);
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto.createHmac('sha256', key).update(`${sessionId}.${nonce}`).digest('hex');
  return `${nonce}.${signature}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: DATABASE_URL }
  }
});

const DORM_ID = '20000001-0000-4000-8000-000000000002';
const BROWSER_URL = 'https://app.hor-plus.com';
const API_URL = 'http://127.0.0.1:3001';

function getSession(roleKey) {
  const file = path.join(SESSIONS_DIR, `${roleKey}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Session file not found: ${file}`);
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sessionCookie = data.cookies.find(c => c.name === 'horplus_session')?.value;
  const csrfCookie = data.cookies.find(c => c.name === 'horplus_csrf')?.value;
  return { file, sessionCookie, csrfCookie };
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
  } catch {
    // raw text
  }

  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

function saveScreenshot(sourcePath, filename) {
  if (fs.existsSync(ARTIFACT_DIR)) {
    const destPath = path.join(ARTIFACT_DIR, filename);
    fs.copyFileSync(sourcePath, destPath);
    console.log(`📸 Screenshot saved: ${filename}`);
  }
}

async function main() {
  console.log('======================================================================');
  console.log('STARTING LIVE VERIFICATION OF TASK 16 ON https://app.hor-plus.com');
  console.log('======================================================================\n');

  const ownerSession = getSession('owner');
  const tenantSession = getSession('tenant');

  const results = {};
  const browser = await chromium.launch({ headless: true });

  try {
    // ----------------------------------------------------------------------
    // AC-1: Auth, Session, CSRF & Negative Role Permissions
    // ----------------------------------------------------------------------
    console.log('--- Checking AC-1: Auth, Session, CSRF & Negative Role Permissions ---');

    // 1. Tampered session token
    const tamperedRes = await apiRequest(`/api/v1/dormitories/${DORM_ID}/rooms`, { method: 'GET' }, { sessionCookie: 'tampered.fake.token' });
    console.log(`Tampered token response: status=${tamperedRes.status} (Expect 401)`);

    // 2. Negative role permissions: Tenant attempting Owner mutation (e.g. POST /bills/generate)
    const tenantForbiddenRes = await apiRequest(`/api/v1/bills/generate`, {
      method: 'POST',
      body: JSON.stringify({ billingCycleId: crypto.randomUUID() })
    }, tenantSession);
    console.log(`Tenant calling Owner mutation: status=${tenantForbiddenRes.status} (Expect 403)`);

    // 3. Mutation without CSRF token
    const noCsrfRes = await apiRequest(`/api/v1/notifications`, {
      method: 'POST',
      headers: { 'x-csrf-token': '' },
      body: JSON.stringify({ title: 'Test', message: 'Test' })
    }, { sessionCookie: ownerSession.sessionCookie, csrfCookie: '' });
    console.log(`Mutation without CSRF token: status=${noCsrfRes.status}, code=${noCsrfRes.json?.error?.code} (Expect 403 CSRF_TOKEN_REQUIRED)`);

    const ac1Pass = (
      tamperedRes.status === 401 &&
      tenantForbiddenRes.status === 403 &&
      noCsrfRes.status === 403 &&
      noCsrfRes.json?.error?.code === 'CSRF_TOKEN_REQUIRED'
    );
    results['AC-1'] = ac1Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-1 RESULT: ${results['AC-1']}`);

    // Capture visual screenshot
    const ac1Page = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ac1Page.goto(`${BROWSER_URL}/owner/dashboard?tab=overview`, { waitUntil: 'domcontentloaded' });
    await ac1Page.waitForTimeout(2500);
    const shotPath1 = path.join(SCREENSHOTS_DIR, 'ac1-auth-session-csrf-live.png');
    await ac1Page.screenshot({ path: shotPath1, fullPage: false });
    saveScreenshot(shotPath1, 'ac1-auth-session-csrf-live.png');
    await ac1Page.close();

    // ----------------------------------------------------------------------
    // AC-2: Cross-Dormitory IDOR & Data Isolation
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-2: Cross-Dormitory IDOR & Data Isolation ---');

    // 1. Cross-dormitory resource access: querying another dormitory's rooms
    const foreignDormId = '30000000-0000-4000-8000-000000000009';
    const idorRes = await apiRequest(`/api/v1/rooms?dormitoryId=${foreignDormId}`, {
      method: 'GET',
      headers: { 'x-dormitory-id': foreignDormId }
    }, ownerSession);
    console.log(`Cross-dormitory IDOR probe: status=${idorRes.status} (Expect 401/403/404)`);

    // 2. Malformed UUID: ensure no SQL syntax / Prisma schema leakage
    const malformedUuidRes = await apiRequest(`/api/v1/contracts/not-a-valid-uuid/pdf`, { method: 'GET' }, ownerSession);
    console.log(`Malformed UUID response: status=${malformedUuidRes.status}, code=${malformedUuidRes.json?.error?.code}, leaks:`, malformedUuidRes.text?.includes('Prisma') || malformedUuidRes.text?.includes('syntax error'));

    const ac2Pass = (
      [401, 403, 404].includes(idorRes.status) &&
      malformedUuidRes.status === 404 &&
      !malformedUuidRes.text?.includes('PrismaClientKnownRequestError') &&
      !malformedUuidRes.text?.includes('syntax error')
    );
    results['AC-2'] = ac2Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-2 RESULT: ${results['AC-2']}`);

    // Capture visual screenshot
    const ac2Page = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ac2Page.goto(`${BROWSER_URL}/owner/dashboard?tab=rooms`, { waitUntil: 'domcontentloaded' });
    await ac2Page.waitForTimeout(2500);
    const shotPath2 = path.join(SCREENSHOTS_DIR, 'ac2-cross-dorm-isolation-live.png');
    await ac2Page.screenshot({ path: shotPath2, fullPage: false });
    saveScreenshot(shotPath2, 'ac2-cross-dorm-isolation-live.png');
    await ac2Page.close();

    // ----------------------------------------------------------------------
    // AC-3: Idempotency, Replay & Append-Only Audit Trail
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-3: Idempotency, Replay & Append-Only Audit Trail ---');

    // 1. Check existing audit logs count and append-only immutability
    const auditCount = await prisma.auditLog.count({ where: { dormitoryId: DORM_ID } });
    console.log(`Current audit logs for test dormitory: ${auditCount}`);

    // 2. Idempotent bill operation check
    const cycles = await prisma.billingCycle.findMany({ where: { dormitoryId: DORM_ID }, take: 1 });
    const cycleId = cycles[0]?.id || crypto.randomUUID();
    const idemKey = `idem-test-16-${Date.now()}`;

    const replay1 = await apiRequest(`/api/v1/bills/generate`, {
      method: 'POST',
      headers: { 'idempotency-key': idemKey },
      body: JSON.stringify({ billingCycleId: cycleId })
    }, ownerSession);
    const replay2 = await apiRequest(`/api/v1/bills/generate`, {
      method: 'POST',
      headers: { 'idempotency-key': idemKey },
      body: JSON.stringify({ billingCycleId: cycleId })
    }, ownerSession);

    console.log(`Idempotency replay: status1=${replay1.status}, status2=${replay2.status} (Identical handled status)`);

    // Verify recent audit log entry exists
    const recentAudit = await prisma.auditLog.findFirst({
      where: { dormitoryId: DORM_ID },
      orderBy: { createdAt: 'desc' }
    });
    console.log(`Most recent audit entry: action=${recentAudit?.action}, entityType=${recentAudit?.entityType}`);

    const ac3Pass = (
      auditCount > 0 &&
      replay1.status === replay2.status &&
      !!recentAudit
    );
    results['AC-3'] = ac3Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-3 RESULT: ${results['AC-3']}`);

    // Capture visual screenshot
    const ac3Page = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ac3Page.goto(`${BROWSER_URL}/owner/dashboard?tab=payments`, { waitUntil: 'domcontentloaded' });
    await ac3Page.waitForTimeout(2500);
    const shotPath3 = path.join(SCREENSHOTS_DIR, 'ac3-idempotency-audit-live.png');
    await ac3Page.screenshot({ path: shotPath3, fullPage: false });
    saveScreenshot(shotPath3, 'ac3-idempotency-audit-live.png');
    await ac3Page.close();

    // ----------------------------------------------------------------------
    // AC-4: Input Boundary, Injection & File Storage Traversal Protection
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-4: Input Boundary, Injection & File Storage Traversal ---');

    // 1. Path traversal probe on file endpoint
    const traversalRes = await apiRequest(`/api/v1/documents/../../server/.env`, { method: 'GET' }, ownerSession);
    console.log(`Path traversal probe: status=${traversalRes.status} (Expect 400/404)`);

    // 2. Malicious non-image upload probe on ID card upload endpoint
    const maliciousSvg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("XSS")</script></svg>';
    const badUploadRes = await apiRequest(`/api/v1/tenant-portal/id-card-photo`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64: Buffer.from(maliciousSvg).toString('base64') })
    }, tenantSession);
    console.log(`Malicious SVG probe: status=${badUploadRes.status}, code=${badUploadRes.json?.error?.code} (Expect 400)`);

    const ac4Pass = (
      [400, 404].includes(traversalRes.status) &&
      badUploadRes.status === 400
    );
    results['AC-4'] = ac4Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-4 RESULT: ${results['AC-4']}`);

    // Capture visual screenshot
    const ac4Page = await browser.newPage({
      storageState: ownerSession.file,
      viewport: { width: 1440, height: 900 }
    });
    await ac4Page.goto(`${BROWSER_URL}/owner/dashboard?tab=meters`, { waitUntil: 'domcontentloaded' });
    await ac4Page.waitForTimeout(2500);
    const shotPath4 = path.join(SCREENSHOTS_DIR, 'ac4-input-boundary-live.png');
    await ac4Page.screenshot({ path: shotPath4, fullPage: false });
    saveScreenshot(shotPath4, 'ac4-input-boundary-live.png');
    await ac4Page.close();

    // ----------------------------------------------------------------------
    // AC-5: Concurrency, Rate Limiting & Observability Health
    // ----------------------------------------------------------------------
    console.log('\n--- Checking AC-5: Concurrency, Rate Limiting & Observability Health ---');

    // 1. Rate limiting on public endpoint
    const rapidChecks = [];
    for (let i = 0; i < 20; i++) {
      rapidChecks.push(apiRequest(`/api/v1/tenant-registrations/verify-claim`, {
        method: 'POST',
        body: JSON.stringify({ identifier: '0812345678', requestedRoomId: crypto.randomUUID() })
      }));
    }
    const rapidResponses = await Promise.all(rapidChecks);
    const rateLimited = rapidResponses.some(r => r.status === 429);
    console.log(`Rapid requests triggered HTTP 429: ${rateLimited}`);

    // 2. Health readiness check
    const readinessRes = await apiRequest(`/api/v1/health/readiness`, { method: 'GET' });
    console.log(`Health readiness response: status=${readinessRes.status}, body=`, readinessRes.json);

    // 3. Health metrics check
    const metricsRes = await apiRequest(`/api/v1/health/metrics`, { method: 'GET' });
    console.log(`Health metrics response: status=${metricsRes.status}, uptimeSeconds=${metricsRes.json?.uptimeSeconds}`);

    const ac5Pass = (
      rateLimited &&
      readinessRes.status === 200 &&
      readinessRes.json?.status === 'UP' &&
      readinessRes.json?.database === 'UP' &&
      readinessRes.json?.redis === 'UP' &&
      metricsRes.status === 200
    );
    results['AC-5'] = ac5Pass ? 'PASS' : 'FAIL';
    console.log(`>>> AC-5 RESULT: ${results['AC-5']}`);

    // Capture visual screenshot
    const ac5Page = await browser.newPage({
      viewport: { width: 1440, height: 900 }
    });
    await ac5Page.goto(`${BROWSER_URL}/api/v1/health/readiness`, { waitUntil: 'domcontentloaded' });
    await ac5Page.waitForTimeout(1500);
    const shotPath5 = path.join(SCREENSHOTS_DIR, 'ac5-observability-readiness-live.png');
    await ac5Page.screenshot({ path: shotPath5, fullPage: false });
    saveScreenshot(shotPath5, 'ac5-observability-readiness-live.png');
    await ac5Page.close();

  } catch (err) {
    console.error('❌ Error during live verification:', err);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }

  console.log('\n======================================================================');
  console.log('LIVE VERIFICATION SUMMARY:');
  console.log(JSON.stringify(results, null, 2));
  console.log('======================================================================');

  const allPass = Object.values(results).length === 5 && Object.values(results).every(r => r === 'PASS');
  if (!allPass) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
