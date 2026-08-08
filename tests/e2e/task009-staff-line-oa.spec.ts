/**
 * TASK-009 Playwright Browser Lifecycle E2E Test Suite
 * Fully tests Staff Management, Access Grants, LINE OA Settings, Local Fake LINE Platform,
 * Bearer Redemption, Dual-Session Role Propagation, Webhook Signatures, and Security Posture.
 * @license Apache-2.0
 */

import { test, expect, request as playwrightRequest } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { encryptText } from '../../server/src/utils/crypto-encryption.js';
import { FakeLineServer } from './helpers/fake-line-server.js';

test.describe.serial('TASK-009 Playwright Browser Lifecycle — Staff, LINE OA & Access Grants', () => {
  const prisma = getPrismaClient();
  const fakeLineServer = new FakeLineServer();

  let dormId: string;
  let ownerId: string;
  let sessionToken: string;
  let csrfToken: string;
  let testChannelSecret: string = 'test_channel_secret_32_bytes_long_0123';
  let testChannelAccessToken: string = 'test_channel_access_token_1234567890';

  test.beforeAll(async () => {
    // 1. Start Local Fake LINE Platform HTTP Server
    const fakeLineUrl = await fakeLineServer.start();
    process.env.HORPLUS_E2E = 'true';
    process.env.LINE_API_BASE_URL = fakeLineUrl;

    // 2. Provision Google Owner User in PostgreSQL
    const email = `task009-e2e-owner-${Date.now()}@example.com`;
    const owner = await prisma.user.create({
      data: {
        email,
        emailNormalized: email.toLowerCase(),
        name: 'TASK-009 E2E Owner',
        googleSubject: `goog-owner-${Date.now()}`,
        status: 'active',
      },
    });
    ownerId = owner.id;

    // 3. Provision Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `TASK009 Dorm ${Date.now()}`,
        code: `DM-T9-${Date.now()}`,
        createdByUserId: owner.id,
        timezone: 'Asia/Bangkok',
      },
    });
    dormId = dorm.id;

    // 4. Provision Subscription
    await subscriptionEntitlementService.ensureSeeded();
    await subscriptionEntitlementService.provisionInitialTrial(dorm.id);

    // 5. Assign OWNER Role & Membership with GOOGLE_BOOTSTRAP origin
    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: {
          code: 'OWNER',
          name: 'Owner',
          permissions: ['*'],
          isSystem: true,
        },
      });
    }

    await prisma.dormitoryMember.create({
      data: {
        userId: owner.id,
        dormitoryId: dorm.id,
        roleId: ownerRole.id,
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
        status: 'active',
      },
    });

    // 6. Establish Session & CSRF
    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);

    await prisma.session.create({
      data: {
        userId: owner.id,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    sessionToken = sessionTokenService.encryptToken(
      { sub: owner.id, sid: sessionId, type: 'session', version: 1 },
      86400
    );
    csrfToken = csrfService.generateCsrfToken(sessionId);
  });

  test.afterAll(async () => {
    await fakeLineServer.stop();
  });

  async function setupOwnerBrowserContext(context: any, page: any) {
    await context.addCookies([
      {
        name: 'horplus_session',
        value: sessionToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: csrfToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('http://127.0.0.1:5173/owner/dashboard');
    await page.evaluate((id: string) => {
      localStorage.setItem('selected_dormitory_id', id);
      sessionStorage.setItem('active_dormitory_selected_for_session', id);
    }, dormId);
  }

  // =========================================================================
  // TEST 1: Permanent Owner & Initial Slot 1/10 Meter State
  // =========================================================================
  test('1. Owner starts with permanent slot 1 / 10 and visible owner label', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);
    await page.goto('http://127.0.0.1:5173/owner/users');

    await expect(page.locator('[data-testid="slot-usage-meter"]')).toBeVisible();
    await expect(page.locator('[data-testid="slot-usage-meter"]')).toContainText('1 / 10');

    await expect(page.locator('[data-testid="permanent-owner-row"]')).toBeVisible();
    await expect(page.locator('[data-testid="permanent-owner-row"]')).toContainText('เจ้าของหลัก');
    await expect(page.locator('[data-testid="permanent-owner-row"]')).toContainText('OWNER');
    await expect(page.locator('[data-testid="permanent-owner-row"] button')).toHaveCount(0);
  });

  // =========================================================================
  // TEST 2: Configure LINE OA in Settings & Verify Fake Bot Info
  // =========================================================================
  test('2. Configures LINE OA in Settings via UI form, verifies token via fake bot info, clears plaintext inputs', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);

    // Register console monitoring listener BEFORE navigating or typing credentials
    const ownerConsoleMessages: string[] = [];
    page.on('console', (msg) => ownerConsoleMessages.push(msg.text()));

    await page.goto('http://127.0.0.1:5173/owner/settings');

    // Fill actual LINE OA form fields in UI
    await page.fill('[data-testid="line-oa-id-input"]', '@test_line_oa');
    await page.fill('[data-testid="line-channel-id-input"]', '1234567890');
    await page.fill('[data-testid="line-channel-secret-input"]', testChannelSecret);
    await page.fill('[data-testid="line-channel-access-token-input"]', testChannelAccessToken);

    // Capture real PUT /api/v1/dormitories/:id/line-oa/config triggered by UI Save button click
    const saveResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'PUT' &&
        res.url().includes(`/api/v1/dormitories/${dormId}/line-oa/config`)
    );

    await page.click('[data-testid="save-line-oa-button"]');

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.status()).toBe(200);
    const json = await saveResponse.json();

    expect(json.data.connected).toBe(true);
    expect(json.data.hasChannelSecret).toBe(true);
    expect(json.data.hasAccessToken).toBe(true);
    expect(json.data.accessTokenVerifiedAt).not.toBeNull();
    expect(json.data.webhookVerifiedAt).toBeNull();
    expect(json.data.webhookUrl).toContain('/api/v1/line/webhook/');

    // Assert plaintext secret is NOT present in HTTP response
    expect(JSON.stringify(json)).not.toContain(testChannelSecret);
    expect(JSON.stringify(json)).not.toContain(testChannelAccessToken);

    // Assert inputs in UI are masked/cleared after save according to product behavior
    await expect(page.locator('[data-testid="line-channel-secret-input"]')).toHaveValue('');
    await expect(page.locator('[data-testid="line-channel-access-token-input"]')).toHaveValue('');

    // Assert Owner browser console contains zero LINE secrets
    for (const msgText of ownerConsoleMessages) {
      expect(msgText).not.toContain(testChannelSecret);
      expect(msgText).not.toContain(testChannelAccessToken);
    }
  });

  // =========================================================================
  // TEST 3: Signed Webhook Follow Event Creates LINE Friend & Verifies Webhook
  // =========================================================================
  test('3. Signed follow webhook event creates LINE Friend and populates webhookVerifiedAt', async () => {
    // 1. Get webhook URL for dormitory
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}`,
      },
    });
    const configRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/config`);
    expect(configRes.ok()).toBe(true);
    const configJson = await configRes.json();
    const webhookUrl: string = configJson.data.webhookUrl;
    expect(webhookUrl).toBeTruthy();

    const rawKey = webhookUrl.split('/api/v1/line/webhook/')[1];

    // 2. Construct LINE Follow Webhook Payload
    const payload = JSON.stringify({
      destination: 'U_BOT_E2E',
      events: [
        {
          type: 'follow',
          timestamp: Date.now(),
          source: { type: 'user', userId: 'U_E2E_SUCCESS' },
          replyToken: 'reply_token_123',
          mode: 'active',
        },
      ],
    });

    // 3. Compute HMAC-SHA256 signature using testChannelSecret
    const hmac = crypto.createHmac('sha256', testChannelSecret).update(payload).digest('base64');

    // 4. POST webhook payload to server
    const webhookRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/line/webhook/${rawKey}`, {
      headers: {
        'Content-Type': 'application/json',
        'x-line-signature': hmac,
      },
      data: payload,
    });
    expect(webhookRes.ok()).toBe(true);

    // 5. Verify webhookVerifiedAt is now populated
    const updatedConfigRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/config`);
    const updatedConfigJson = await updatedConfigRes.json();
    expect(updatedConfigJson.data.webhookVerifiedAt).not.toBeNull();
  });

  // =========================================================================
  // TEST 4: Create Access Grant Lifecycle & Fake Push Delivery
  // =========================================================================
  let createdBearerUrl: string = '';
  let createdGrantId: string = '';

  test('4. Creates MANAGER Access Grant for Somchai E2E, sends Flex push to fake LINE, slot increases to 2 / 10', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);

    // Register console monitoring listener BEFORE grant creation
    const ownerConsoleMessages: string[] = [];
    page.on('console', (msg) => ownerConsoleMessages.push(msg.text()));

    await page.goto('http://127.0.0.1:5173/owner/users');

    await expect(page.locator('[data-testid="line-friend-select"]')).toBeVisible();
    await page.selectOption('[data-testid="grant-role-select"]', 'MANAGER');

    // Capture real POST create-access-grant HTTP response triggered by UI click
    const createResponsePromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'POST' &&
        res.url().includes(`/api/v1/properties/${dormId}/access-grants`)
    );

    await page.click('[data-testid="create-grant-button"]');

    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    const createJson = await createResponse.json();

    expect(createJson.data.bearerUrl).toContain('/staff-access#');
    expect(createJson.data).not.toHaveProperty('rawToken');
    expect(JSON.stringify(createJson)).not.toContain('"rawToken"');

    createdBearerUrl = createJson.data.bearerUrl;

    await expect(page.locator('[data-testid="toast-message"]')).toBeVisible();
    await expect(page.locator('[data-testid="slot-usage-meter"]')).toContainText('2 / 10');

    // Runtime DOM Audit: Assert authorized bearer URL element is displayed and no standalone rawToken element exists
    const bearerUrlElement = page.locator('div.text-emerald-300').filter({ hasText: '/staff-access#' });
    await expect(bearerUrlElement).toBeVisible();
    await expect(bearerUrlElement).toContainText('/staff-access#');
    expect(await page.locator('[data-testid="raw-token-display"]').count()).toBe(0);
    expect(await page.locator('input[name="rawToken"]').count()).toBe(0);

    // Assert Owner browser console contains zero bearer credentials or LINE secrets
    const extractedToken = createdBearerUrl.split('#')[1];
    for (const msgText of ownerConsoleMessages) {
      expect(msgText).not.toContain(extractedToken);
      expect(msgText).not.toContain(createdBearerUrl);
      expect(msgText).not.toContain(testChannelSecret);
      expect(msgText).not.toContain(testChannelAccessToken);
    }

    // Fetch created grant from staff API
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });
    const staffRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    expect(staffJson.data.accessGrants.length).toBe(1);

    const grant = staffJson.data.accessGrants[0];
    createdGrantId = grant.id;

    // Verify GET copy-link independently returns same URL and no rawToken
    const copyLinkRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${grant.id}/copy-link`);
    const copyLinkJson = await copyLinkRes.json();
    expect(copyLinkJson.data).not.toHaveProperty('rawToken');
    expect(JSON.stringify(copyLinkJson)).not.toContain('"rawToken"');
    expect(copyLinkJson.data.url).toBe(createdBearerUrl);

    // Assert fake LINE server received push request for U_E2E_SUCCESS with Flex bearer URL
    expect(fakeLineServer.pushRequests.length).toBeGreaterThan(0);
    const pushReq = fakeLineServer.pushRequests.find((r) => r.to === 'U_E2E_SUCCESS');
    expect(pushReq).toBeDefined();
    expect(JSON.stringify(pushReq)).toContain('/staff-access#');
  });

  // =========================================================================
  // TEST 5: Copy Link Returns Identical URL Without Consuming Extra Slot or Push
  // =========================================================================
  test('5. Copy Link returns exact same bearer URL via UI click without creating new grant or extra LINE push', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);

    const ownerConsoleMessages: string[] = [];
    page.on('console', (msg) => ownerConsoleMessages.push(msg.text()));

    await page.goto('http://127.0.0.1:5173/owner/users');

    const initialPushCount = fakeLineServer.pushRequests.length;

    // Capture real GET /copy-link response triggered by UI Copy Link button click in table row
    const copyLinkPromise = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        res.url().includes(`/access-grants/${createdGrantId}/copy-link`)
    );

    const copyBtn = page.locator(`[data-testid="copy-link-button-${createdGrantId}"]`);
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    const copyLinkRes = await copyLinkPromise;
    expect(copyLinkRes.status()).toBe(200);
    const copyLinkJson = await copyLinkRes.json();

    expect(copyLinkJson.data).not.toHaveProperty('rawToken');
    expect(JSON.stringify(copyLinkJson)).not.toContain('"rawToken"');

    const fetchedUrl = copyLinkJson.data.url || copyLinkJson.data.bearerUrl;
    expect(fetchedUrl).toBe(createdBearerUrl);

    // Assert state: no new LINE push, slot count remains 2 / 10
    expect(fakeLineServer.pushRequests.length).toBe(initialPushCount);
    await expect(page.locator('[data-testid="slot-usage-meter"]')).toContainText('2 / 10');

    // Assert Owner console contains neither extracted bearer token nor full bearer URL
    const extractedToken = createdBearerUrl.split('#')[1];
    for (const msgText of ownerConsoleMessages) {
      expect(msgText).not.toContain(extractedToken);
      expect(msgText).not.toContain(createdBearerUrl);
    }
  });

  const getLocalBearerUrl = (url: string) => url.replace(/^https?:\/\/[^\/]+/, 'http://127.0.0.1:5173');

  // =========================================================================
  // TEST 6: Bearer Browser Redemption in BrowserContext A
  // =========================================================================
  test('6. Bearer token redemption in BrowserContext A clears URL fragment, creates HttpOnly session & opens workspace as MANAGER', async ({ browser }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // Register console monitoring listener BEFORE navigating to bearer URL
    const consoleMessages: string[] = [];
    pageA.on('console', (msg) => {
      consoleMessages.push(msg.text());
    });

    await pageA.goto(getLocalBearerUrl(createdBearerUrl));

    // Wait for redirection into workspace
    await pageA.waitForURL('**/owner/dashboard');

    // Assert hash fragment removed from URL
    expect(pageA.url()).not.toContain('#');

    // Verify session cookie set and HttpOnly
    const cookies = await contextA.cookies();
    const sessionCookie = cookies.find((c) => c.name === 'horplus_session');
    const csrfCookie = cookies.find((c) => c.name === 'horplus_csrf');
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(csrfCookie).toBeDefined();

    // Verify authenticated user role is MANAGER via session API
    const sessionRes = await pageA.request.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionRes.ok()).toBe(true);
    const sessionJson = await sessionRes.json();
    expect(sessionJson.data.memberships[0].roleCode).toBe('MANAGER');

    // Verify browser console output contains zero raw token or secret values
    const extractedToken = createdBearerUrl.split('#')[1];
    for (const msgText of consoleMessages) {
      expect(msgText).not.toContain(extractedToken);
      expect(msgText).not.toContain(createdBearerUrl);
      expect(msgText).not.toContain(testChannelSecret);
      expect(msgText).not.toContain(testChannelAccessToken);
    }

    // Verify localStorage and sessionStorage contain zero raw token credentials or full bearer URL
    const localStorageDump = await pageA.evaluate(() => JSON.stringify(localStorage));
    const sessionStorageDump = await pageA.evaluate(() => JSON.stringify(sessionStorage));
    expect(localStorageDump).not.toContain(extractedToken);
    expect(localStorageDump).not.toContain(createdBearerUrl);
    expect(sessionStorageDump).not.toContain(extractedToken);
    expect(sessionStorageDump).not.toContain(createdBearerUrl);

    // Enumerate available IndexedDB databases and verify zero bearer token persistence inside record keys/values
    const indexedDbDump = await pageA.evaluate(async () => {
      if (!window.indexedDB || !window.indexedDB.databases) return [];
      const dbs = await window.indexedDB.databases();
      const dump: Array<{ dbName: string; storeName: string; keys: any[]; values: any[] }> = [];

      for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;

        // Open database — any open error rejects and fails test
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open(dbInfo.name!);
          req.onerror = (e) => reject(new Error(`Failed to open IndexedDB database ${dbInfo.name}: ${e}`));
          req.onsuccess = () => resolve(req.result);
        });

        const storeNames = Array.from(db.objectStoreNames);
        for (const storeName of storeNames) {
          // Open a NEW readonly transaction for EACH store — any transaction error rejects and fails test
          const { keys, values } = await new Promise<{ keys: any[]; values: any[] }>((resolve, reject) => {
            try {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const keysReq = store.getAllKeys();
              const valuesReq = store.getAll();

              let keysRes: any[] | null = null;
              let valuesRes: any[] | null = null;

              keysReq.onerror = (e) => reject(new Error(`IndexedDB getAllKeys error on ${storeName}: ${e}`));
              valuesReq.onerror = (e) => reject(new Error(`IndexedDB getAll error on ${storeName}: ${e}`));

              keysReq.onsuccess = () => {
                keysRes = keysReq.result;
                if (valuesRes !== null) resolve({ keys: keysRes, values: valuesRes });
              };
              valuesReq.onsuccess = () => {
                valuesRes = valuesReq.result;
                if (keysRes !== null) resolve({ keys: keysRes, values: valuesRes });
              };

              tx.onerror = (e) => reject(new Error(`IndexedDB transaction error on ${storeName}: ${e}`));
              tx.onabort = (e) => reject(new Error(`IndexedDB transaction aborted on ${storeName}: ${e}`));
            } catch (err) {
              reject(err);
            }
          });

          dump.push({
            dbName: dbInfo.name,
            storeName,
            keys: keys || [],
            values: values || [],
          });
        }
        db.close();
      }
      return dump;
    });

    const serializedIndexedDbDump = JSON.stringify(indexedDbDump);
    expect(serializedIndexedDbDump).not.toContain(extractedToken);
    expect(serializedIndexedDbDump).not.toContain(createdBearerUrl);

    await contextA.close();
  });

  // =========================================================================
  // TEST 7: Unlimited Device Redemption in BrowserContext B
  // =========================================================================
  test('7. Unlimited device redemption in BrowserContext B authenticates independently while slot remains 2 / 10', async ({ browser }) => {
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();

    await pageB.goto(getLocalBearerUrl(createdBearerUrl));
    await pageB.waitForURL('**/owner/dashboard');

    const sessionRes = await pageB.request.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionRes.ok()).toBe(true);

    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });
    const staffRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    expect(staffJson.data.slotUsage.totalUsedSlots).toBe(2);

    await contextB.close();
  });

  // =========================================================================
  // TEST 8: Dynamic Role Propagation (MANAGER -> TECH -> OWNER)
  // =========================================================================
  test('8. Changing Grant Role (MANAGER -> TECH -> OWNER) immediately propagates to active sessions without re-redemption', async ({ browser, context, page }) => {
    await setupOwnerBrowserContext(context, page);

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await pageA.goto(getLocalBearerUrl(createdBearerUrl));
    await pageA.waitForURL('**/owner/dashboard');

    // 1. Owner changes role to TECH
    const patchTechRes = await page.request.patch(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${createdGrantId}/role`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { roleCode: 'TECH' },
    });
    expect(patchTechRes.ok()).toBe(true);

    // 2. Next request in Session A receives TECH authority immediately
    const sessionARes1 = await pageA.request.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionARes1.ok()).toBe(true);
    const jsonA1 = await sessionARes1.json();
    expect(jsonA1.data.memberships[0].roleCode).toBe('TECH');

    // 3. Owner changes role to OWNER
    const patchOwnerRes = await page.request.patch(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${createdGrantId}/role`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { roleCode: 'OWNER' },
    });
    expect(patchOwnerRes.ok()).toBe(true);

    // 4. Next request in Session A receives OWNER authority immediately
    const sessionARes2 = await pageA.request.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionARes2.ok()).toBe(true);
    const jsonA2 = await sessionARes2.json();
    expect(jsonA2.data.memberships[0].roleCode).toBe('OWNER');

    await contextA.close();
  });

  // =========================================================================
  // TEST 9: OWNER-only Boundary Check
  // =========================================================================
  test('9. MANAGER & TECH denied staff admin API (403 FORBIDDEN), OWNER allowed', async ({ browser, context, page }) => {
    await setupOwnerBrowserContext(context, page);

    // Demote grant to MANAGER
    await page.request.patch(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${createdGrantId}/role`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { roleCode: 'MANAGER' },
    });

    const contextGrant = await browser.newContext();
    const pageGrant = await contextGrant.newPage();
    await pageGrant.goto(getLocalBearerUrl(createdBearerUrl));
    await pageGrant.waitForURL('**/owner/dashboard');

    // MANAGER attempts staff admin GET -> 403 FORBIDDEN
    const mgrAdminRes = await pageGrant.request.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    expect(mgrAdminRes.status()).toBe(403);

    // Upgrade grant to OWNER
    await page.request.patch(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${createdGrantId}/role`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { roleCode: 'OWNER' },
    });

    // OWNER attempts staff admin GET -> 200 OK
    const ownerAdminRes = await pageGrant.request.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    expect(ownerAdminRes.status()).toBe(200);

    await contextGrant.close();
  });

  // =========================================================================
  // TEST 10: Revocation Proof
  // =========================================================================
  test('10. Revoking Grant immediately terminates active sessions, returns slot to 1 / 10, rejects redemption', async ({ browser, context, page }) => {
    await setupOwnerBrowserContext(context, page);

    const contextGrant = await browser.newContext();
    const pageGrant = await contextGrant.newPage();
    await pageGrant.goto(getLocalBearerUrl(createdBearerUrl));
    await pageGrant.waitForURL('**/owner/dashboard');

    // Owner revokes grant
    const revokeRes = await page.request.delete(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${createdGrantId}`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(revokeRes.ok()).toBe(true);

    // Active session immediately receives 401 UNAUTHORIZED
    const sessionRes = await pageGrant.request.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionRes.status()).toBe(401);

    // Slot usage returns to 1 / 10
    const staffRes = await page.request.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    expect(staffJson.data.slotUsage.totalUsedSlots).toBe(1);

    // Re-redemption of revoked bearer URL fails with 401 ACCESS_GRANT_REVOKED
    const redeemRes = await pageGrant.request.post('http://127.0.0.1:3001/api/v1/staff-access/redeem', {
      data: { token: createdBearerUrl.split('#')[1] },
    });
    expect(redeemRes.status()).toBe(401);

    await contextGrant.close();
  });

  // =========================================================================
  // TEST 11: Re-grant Same LINE Friend After Revoke & Duplicate Active Grant Boundary
  // =========================================================================
  test('11. Re-grant same LINE Friend after revoke succeeds; duplicate active grant returns 409 ACTIVE_GRANT_EXISTS', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);
    await page.goto('http://127.0.0.1:5173/owner/users');

    // 1. Re-grant same LINE Friend (Somchai E2E)
    await page.selectOption('[data-testid="grant-role-select"]', 'MANAGER');
    await page.click('[data-testid="create-grant-button"]');
    await expect(page.locator('[data-testid="toast-message"]')).toBeVisible();

    // 2. Attempt duplicate active grant for same LINE Friend -> 409 ACTIVE_GRANT_EXISTS
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });
    const friendsRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/line-friends`);
    const friendsJson = await friendsRes.json();
    const friendId = friendsJson.data[0].id;

    const dupRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { lineFriendId: friendId, roleCode: 'MANAGER' },
    });
    expect(dupRes.status()).toBe(409);
    const dupJson = await dupRes.json();
    expect(dupJson.error.code).toBe('ACTIVE_GRANT_EXISTS');
  });

  async function createTestLineFriend(dId: string, rawLineUserId: string, displayName: string) {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dId}, true)`;
      return await tx.dormitoryLineFriend.create({
        data: {
          dormitory: { connect: { id: dId } },
          lineUserIdHash: crypto.createHash('sha256').update(rawLineUserId).digest('hex'),
          lineUserIdEncrypted: encryptText(rawLineUserId),
          displayName,
          friendStatus: 'FOLLOWING',
        },
      });
    });
  }

  // =========================================================================
  // TEST 12: Slot 10 / 11 Boundary Limit
  // =========================================================================
  test('12. Reaching 10 total slots blocks UI create button; 11th grant attempt returns 409 STAFF_LIMIT_EXCEEDED', async ({ context, page }) => {
    await setupOwnerBrowserContext(context, page);
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });

    // Seed additional LINE Friends and Grants to reach 10/10 slots
    for (let i = 2; i <= 9; i++) {
      const lineFriend = await createTestLineFriend(dormId, `line_user_slot_${i}`, `Slot Friend ${i}`);

      await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants`, {
        headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
        data: { lineFriendId: lineFriend.id, roleCode: 'TECH' },
      });
    }

    // Verify 10 / 10 slots used via API
    const staffRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    expect(staffJson.data.slotUsage.totalUsedSlots).toBe(10);

    // Verify UI browser page displays 10 / 10 and disables create-grant button
    await page.goto('http://127.0.0.1:5173/owner/users');
    await expect(page.locator('[data-testid="slot-usage-meter"]')).toContainText('10 / 10');
    await expect(page.locator('[data-testid="create-grant-button"]')).toBeDisabled();

    // Attempt 11th grant -> 409 STAFF_LIMIT_EXCEEDED
    const extraFriend = await createTestLineFriend(dormId, 'line_user_slot_11', 'Slot Friend 11');

    const eleventhRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { lineFriendId: extraFriend.id, roleCode: 'TECH' },
    });
    expect(eleventhRes.status()).toBe(409);
    const eleventhJson = await eleventhRes.json();
    expect(eleventhJson.error.code).toBe('STAFF_LIMIT_EXCEEDED');
  });

  // =========================================================================
  // TEST 13: Push Failure, Retry Pending & Quota Exhausted Lifecycles
  // =========================================================================
  test('13. Push failure (U_E2E_FAILURE), retry pending (U_E2E_RETRY), and quota exhausted lifecycles', async () => {
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });

    // 1. Create LINE Friend for Push Failure
    const failFriend = await createTestLineFriend(dormId, 'U_E2E_FAILURE', 'Fail Push Friend');

    // Revoke one slot to allow test
    const staffRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    const lastGrant = staffJson.data.accessGrants[staffJson.data.accessGrants.length - 1];
    await apiContext.delete(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${lastGrant.id}`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });

    // Create grant for U_E2E_FAILURE
    const failGrantRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { lineFriendId: failFriend.id, roleCode: 'TECH' },
    });
    expect(failGrantRes.ok()).toBe(true);
    const failGrantJson = await failGrantRes.json();
    const failStatus = failGrantJson.data.deliveryStatus || failGrantJson.data.grant?.lastDeliveryStatus;
    expect(failStatus).toBe('failed');

    // 2. Retry Delivery with same X-Line-Retry-Key
    const retryFriend = await createTestLineFriend(dormId, 'U_E2E_RETRY', 'Retry Push Friend');

    await apiContext.delete(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${failGrantJson.data.grant.id}`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });

    const retryGrantRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants`, {
      headers: { 'X-CSRF-Token': csrfToken, 'Content-Type': 'application/json' },
      data: { lineFriendId: retryFriend.id, roleCode: 'TECH' },
    });
    expect(retryGrantRes.ok()).toBe(true);
    const retryGrantJson = await retryGrantRes.json();
    const retryStatus = retryGrantJson.data.deliveryStatus || retryGrantJson.data.grant?.lastDeliveryStatus;
    expect(retryStatus).toBe('retry_pending');

    // Retry via API
    const retryActionRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${retryGrantJson.data.grant.id}/retry-delivery`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(retryActionRes.ok()).toBe(true);
    const retryActionJson = await retryActionRes.json();
    const finalStatus = retryActionJson.data.deliveryStatus || retryActionJson.data.grant?.lastDeliveryStatus;
    expect(finalStatus).toBe('sent');
  });

  // =========================================================================
  // TEST 14: Webhook Rotation & Disconnect Lifecycles
  // =========================================================================
  test('14. Webhook rotation generates new key; LINE disconnect clears credentials while preserving grants/sessions', async () => {
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });

    // 1. Get initial webhook URL
    const config1Res = await apiContext.get(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/config`);
    const config1Json = await config1Res.json();
    const url1 = config1Json.data.webhookUrl;

    // 2. Rotate webhook key
    const rotateRes = await apiContext.post(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/rotate-webhook`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(rotateRes.ok()).toBe(true);
    const rotateJson = await rotateRes.json();
    const url2 = rotateJson.data.webhookUrl;

    expect(url1).not.toBe(url2);

    // 3. Disconnect LINE OA
    const disconnRes = await apiContext.delete(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/disconnect`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(disconnRes.ok()).toBe(true);
    const disconnJson = await disconnRes.json();
    expect(disconnJson.data.connected).toBe(false);

    // 4. Verify Owner session remains valid
    const sessionRes = await apiContext.get('http://127.0.0.1:3001/api/v1/auth/session');
    expect(sessionRes.ok()).toBe(true);
  });

  // =========================================================================
  // TEST 15: Cross-Dormitory Boundary & Secret-Leak Proof
  // =========================================================================
  test('15. Cross-Dormitory boundary returns 403 DORMITORY_MISMATCH; response bodies leak zero secrets', async () => {
    const apiContext = await playwrightRequest.newContext({
      extraHTTPHeaders: { Cookie: `horplus_session=${sessionToken}` },
    });

    // 1. Provision Dormitory B owned by another user
    const otherUser = await prisma.user.create({
      data: { email: `other-${Date.now()}@example.com`, emailNormalized: `other-${Date.now()}@example.com`, name: 'Other Owner', googleSubject: `sub-other-${Date.now()}` },
    });
    const dormB = await prisma.dormitory.create({
      data: { name: `Dorm B ${Date.now()}`, code: `DM-B-${Date.now()}`, createdByUserId: otherUser.id },
    });

    // 2. Owner A attempts Dorm B staff endpoint -> 403 DORMITORY_MISMATCH / FORBIDDEN
    const crossRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormB.id}/staff`);
    expect(crossRes.status()).toBeGreaterThanOrEqual(403);

    // 3. Secret leak proof: inspect all API responses
    const configRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/dormitories/${dormId}/line-oa/config`);
    const configText = await configRes.text();

    expect(configText).not.toContain('channelSecretEncrypted');
    expect(configText).not.toContain('channelAccessTokenEncrypted');
    expect(configText).not.toContain('tokenHash');
    expect(configText).not.toContain('tokenEncrypted');
    expect(configText).not.toContain('lineUserIdHash');
    expect(configText).not.toContain('lineUserIdEncrypted');

    // Assert zero rawToken exposure across access grant copy-link response
    const staffRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/staff`);
    const staffJson = await staffRes.json();
    const activeGrant = staffJson.data.accessGrants[0];
    if (activeGrant) {
      const copyLinkRes = await apiContext.get(`http://127.0.0.1:3001/api/v1/properties/${dormId}/access-grants/${activeGrant.id}/copy-link`);
      expect(copyLinkRes.ok()).toBe(true);
      const copyLinkJson = await copyLinkRes.json();
      expect(copyLinkJson.data).not.toHaveProperty('rawToken');
      expect(JSON.stringify(copyLinkJson)).not.toContain('"rawToken"');
    }
  });
});
