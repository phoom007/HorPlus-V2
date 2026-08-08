/**
 * Real Owner Onboarding Browser & End-to-End Lifecycle Spec
 * Tests fresh owner onboarding against real HorPlus backend & PostgreSQL database.
 * Verifies demo data purge, legacy localStorage isolation, CSRF/Idempotency headers,
 * same-browser lifecycle, multi-dorm guard fallback, and PostgreSQL transaction correctness.
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';

test.describe.serial('Real Owner Onboarding Browser E2E Lifecycle', () => {
  const prisma = getPrismaClient();

  let freshUserId: string;
  let sessionToken: string;
  let csrfToken: string;
  let createdDormitoryId: string;
  let capturedIdempotencyKey: string;
  const userEmail = `real-owner-${Date.now()}@example.com`;
  const googleSub = `goog-sub-${Date.now()}`;

  // Multi-dorm owner test state
  let multiOwnerUserId: string;
  let multiSessionToken: string;
  let multiCsrfToken: string;
  let multiDormId1: string;
  let multiDormId2: string;

  test.beforeAll(async () => {
    // 1. Create fresh User in PostgreSQL with 0 memberships
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        emailNormalized: userEmail.toLowerCase(),
        name: 'Real E2E Owner User',
        googleSubject: googleSub,
        status: 'active',
      },
    });
    freshUserId = user.id;

    // 2. Generate real session token and create session in PostgreSQL
    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);

    await prisma.session.create({
      data: {
        userId: freshUserId,
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
      { sub: freshUserId, sid: sessionId, type: 'session', version: 1 },
      86400
    );
    csrfToken = csrfService.generateCsrfToken(sessionId);

    // 3. Setup multi-dorm owner for ROR3-008 test
    const multiUser = await prisma.user.create({
      data: {
        email: `multi-owner-${Date.now()}@example.com`,
        emailNormalized: `multi-owner-${Date.now()}@example.com`,
        name: 'Multi Dorm Owner User',
        googleSubject: `goog-multi-${Date.now()}`,
        status: 'active',
      },
    });
    multiOwnerUserId = multiUser.id;

    const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) throw new Error('OWNER role not found');

    const dorm1 = await prisma.dormitory.create({
      data: {
        name: 'Multi Owner Dorm Alpha',
        createdByUserId: multiOwnerUserId,
        status: 'active',
      },
    });
    multiDormId1 = dorm1.id;

    const dorm2 = await prisma.dormitory.create({
      data: {
        name: 'Multi Owner Dorm Beta',
        createdByUserId: multiOwnerUserId,
        status: 'active',
      },
    });
    multiDormId2 = dorm2.id;

    await prisma.dormitoryMember.createMany({
      data: [
        { dormitoryId: multiDormId1, userId: multiOwnerUserId, roleId: ownerRole.id, status: 'active' },
        { dormitoryId: multiDormId2, userId: multiOwnerUserId, roleId: ownerRole.id, status: 'active' },
      ],
    });

    const multiSessionId = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: multiOwnerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(multiSessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    multiSessionToken = sessionTokenService.encryptToken(
      { sub: multiOwnerUserId, sid: multiSessionId, type: 'session', version: 1 },
      86400
    );
    multiCsrfToken = csrfService.generateCsrfToken(multiSessionId);
  });

  test.afterAll(async () => {
    // Cleanup single test user & dorms
    if (freshUserId) {
      const user = await prisma.user.findUnique({
        where: { id: freshUserId },
        include: { memberships: true },
      });
      if (user) {
        for (const m of user.memberships) {
          const dormId = m.dormitoryId;
          const subs = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: dormId }, select: { id: true } });
          for (const sub of subs) {
            await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
          }
          await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.room.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.building.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitory.delete({ where: { id: dormId } }).catch(() => {});
        }
        await prisma.session.deleteMany({ where: { userId: freshUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: freshUserId } }).catch(() => {});
      }
    }

    // Cleanup multi-dorm owner user & dorms
    if (multiOwnerUserId) {
      await prisma.dormitoryMember.deleteMany({ where: { userId: multiOwnerUserId } }).catch(() => {});
      await prisma.dormitory.deleteMany({ where: { id: { in: [multiDormId1, multiDormId2] } } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: multiOwnerUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: multiOwnerUserId } }).catch(() => {});
    }
  });

  let completePayloadCaptured: any = null;

  /** Helper: inject session cookies into a fresh browser context */
  async function injectSession(context: any, token = sessionToken, csrf = csrfToken) {
    await context.addCookies([
      { name: 'horplus_session', value: token, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrf, domain: '127.0.0.1', path: '/' },
    ]);
  }

  test('1. Fresh Owner initially has zero memberships and onboardingRequired = true', async ({ context, page }) => {
    await injectSession(context);

    const sessionRes = await page.request.get('http://127.0.0.1:3001/api/v1/auth/session', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
      },
    });

    expect(sessionRes.ok()).toBe(true);
    const sessionData = await sessionRes.json();
    expect(sessionData.data.onboardingRequired).toBe(true);
    expect(sessionData.data.memberships.length).toBe(0);
  });

  test('2. Form initializes clean (no demo PII/bank data) and ignores legacy localStorage contamination (ROR3-002, ROR3-005 & BR-005)', async ({ context, page }) => {
    test.setTimeout(60000);
    await injectSession(context);

    // Initial page load triggers Vite cold-start module compilation
    await page.goto('http://127.0.0.1:5173/owner/register', { timeout: 45000 });

    // BR-005 Pre-Input Assertions: verify form fields start clean BEFORE user types anything
    const dormNameInput = page.locator('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]');
    await expect(dormNameInput).toBeVisible({ timeout: 45000 });
    await expect(dormNameInput).toHaveValue('');

    const dormAddressInput = page.locator('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]');
    await expect(dormAddressInput).toHaveValue('');

    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await expect(provinceSelect).toHaveValue('');

    // Pre-seed browser localStorage with old fake registered_dorm_profile AND unscoped pending contracts
    await page.evaluate(() => {
      localStorage.setItem('registered_dorm_profile', JSON.stringify({
        ownerName: 'นายสมศักดิ์ วงศ์สว่าง FAKE',
        ownerPhone: '081-999-8888',
        ownerEmail: 'somsak.fake@gmail.com',
        dormName: 'หอพัก FAKE Somsak',
        dormAddress: 'FAKE Address 123',
        paymentAccount: {
          accountNumber: '999-9-99999-9',
          bankName: 'กสิกรไทย (KBank)',
          accountName: 'นายสมศักดิ์ FAKE'
        }
      }));
      localStorage.setItem('HorPlus_pending_contract_submissions', JSON.stringify([
        { id: 'sub-fake-1', status: 'pending' }
      ]));
    });

    // ROR3-002 & ROR3-005: Prove form fields remain clean and uncontaminated by fake localStorage
    await expect(dormNameInput).toHaveValue('');
    await expect(dormAddressInput).toHaveValue('');

    // Fill Step 1 to advance to Step 4 bank fields clean check
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await dormNameInput.fill('Clean Check Dorm');
    await dormAddressInput.fill('123 Clean St');
    await page.click('button:has-text("ถัดไป")'); // Step 1 -> 2

    // Fill Step 2 room topology
    const roomsPerFloorInput = page.locator('input[type="number"]').filter({ hasText: '' }).first();
    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('button:has-text("ถัดไป")'); // Step 2 -> 3

    // Fill Step 3 utility and rent rates
    await page.fill('input[type="number"] >> nth=0', '18');
    await page.fill('input[type="number"] >> nth=1', '8');
    const rentInputStep2 = page.locator('label', { hasText: 'ค่าเช่ารายเดือน' }).first().locator('..').locator('input');
    await rentInputStep2.fill('4500');
    await page.click('button:has-text("ถัดไป")'); // Step 3 -> 4

    // Verify Step 4 bank selection & account details start completely blank
    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await expect(bankSelect).toHaveValue('');

    const accNoInput = page.locator('input[placeholder="กรุณาเลือกธนาคารก่อน"]');
    await expect(accNoInput).toBeDisabled();
    await expect(accNoInput).toHaveValue('');

    const accNameInput = page.locator('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]');
    await expect(accNameInput).toHaveValue('');
  });

  test('3. Complete 5-step onboarding UI, verify CSRF/Idempotency headers, PostgreSQL records, AND same-browser lifecycle (ROR3-005, ROR3-006 & BR-005)', async ({ context, page }) => {
    test.setTimeout(60000);
    await injectSession(context);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // ── Step 1: Dormitory Info ──
    await page.fill('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]', 'Real Playwright Dormitory');
    await page.fill('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]', '456 Real Playwright Ave, Bangkok 10110');
    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 2: Buildings & Rooms (fill 4 rooms) ──
    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 3: Utilities & Service Rates (fill rates) ──
    await page.fill('input[type="number"] >> nth=0', '18');
    await page.fill('input[type="number"] >> nth=1', '8');
    const rentInputStep3 = page.locator('label', { hasText: 'ค่าเช่ารายเดือน' }).first().locator('..').locator('input');
    await rentInputStep3.fill('4500');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 4: Deposits & Payment Account ──
    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await bankSelect.selectOption({ index: 1 });
    await page.fill('input[placeholder="XXX-X-XXXXX-X"]', '012-3-45678-9');
    await page.fill('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]', 'นาย สมชาย ใจดี');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 5: Rules & Confirmation ──
    const canvas = page.locator('canvas');
    await canvas.waitFor({ state: 'visible' });
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas bounding box not found');

    await page.mouse.move(canvasBox.x + 30, canvasBox.y + 50);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 100, canvasBox.y + 30, { steps: 5 });
    await page.mouse.move(canvasBox.x + 200, canvasBox.y + 70, { steps: 5 });
    await page.mouse.move(canvasBox.x + 280, canvasBox.y + 40, { steps: 5 });
    await page.mouse.up();

    await page.click('button:has-text("ลงทะเบียนหอพัก")');

    // ── Terms & Referral Modal ──
    const modal = page.locator('.fixed.inset-0.z-50');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('button', { hasText: 'Google Search' }).click();
    await modal.locator('input[type="checkbox"]').check();

    let completeHeadersCaptured: any = null;

    page.on('request', (req) => {
      if (req.url().includes('onboarding/complete') && req.method() === 'POST') {
        completeHeadersCaptured = req.headers();
        try {
          completePayloadCaptured = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    const [completeResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('onboarding/complete'),
        { timeout: 15000 }
      ),
      modal.locator('button:has-text("ยอมรับเงื่อนไข")').click(),
    ]);

    expect(completeResponse.status()).toBe(200);

    // Wait for redirect to /owner/dashboard
    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });

    // Assert API headers
    expect(completeHeadersCaptured).not.toBeNull();
    expect(completeHeadersCaptured['x-csrf-token']).toBeDefined();
    expect(completeHeadersCaptured['x-idempotency-key']).toBeDefined();

    capturedIdempotencyKey = completeHeadersCaptured['x-idempotency-key'];

    // ROR3-005 & BR-005 HTTP Boundary Assertions: Prove stale fake values NEVER crossed HTTP boundary
    expect(completePayloadCaptured.dormitory.name).toBe('Real Playwright Dormitory');
    expect(completePayloadCaptured.dormitory.name).not.toContain('FAKE');
    expect(completePayloadCaptured.payment.bankAccountName).toBe('นาย สมชาย ใจดี');
    expect(completePayloadCaptured.payment.bankAccountName).not.toContain('FAKE');
    expect(completePayloadCaptured.payment.bankAccountNumber).toBe('012-3-45678-9');
    expect(completePayloadCaptured.payment.bankAccountNumber).not.toContain('999-9-99999-9');

    // Verify PostgreSQL records
    const dormsInDb = await prisma.dormitory.findMany({
      where: { createdByUserId: freshUserId },
    });
    expect(dormsInDb.length).toBe(1);
    expect(dormsInDb[0].name).toBe('Real Playwright Dormitory');

    createdDormitoryId = dormsInDb[0].id;

    const membersInDb = await prisma.dormitoryMember.findMany({
      where: { dormitoryId: createdDormitoryId, userId: freshUserId },
      include: { role: true },
    });
    expect(membersInDb.length).toBe(1);
    expect(membersInDb[0].role.code).toBe('OWNER');

    // ── ROR3-006: TRUE SAME-BROWSER POST-ONBOARDING LIFECYCLE ──
    // 1. Verify owner dashboard loaded cleanly
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');

    // 2. Verify session API returns onboardingRequired = false and memberships = 1
    const postSessionRes = await page.request.get('http://127.0.0.1:3001/api/v1/auth/session', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
      },
    });
    const postSessionData = await postSessionRes.json();
    expect(postSessionData.data.onboardingRequired).toBe(false);
    expect(postSessionData.data.memberships.length).toBe(1);

    // 3. Perform hard page reload in SAME browser page
    await page.reload();
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');

    // 4. Verify DB count remains exactly 1 dormitory
    const postReloadDorms = await prisma.dormitory.findMany({
      where: { createdByUserId: freshUserId },
    });
    expect(postReloadDorms.length).toBe(1);
  });

  test('4. Idempotency, CSRF & Double-Submit Negative Matrix (BR-006 & ROR3-007)', async ({ page }) => {
    // A. Replay with EXACT SAME idempotency key & payload -> returns 200 OK with stored response body, does NOT duplicate records
    const replaySamePayloadRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/complete', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
        'X-Idempotency-Key': capturedIdempotencyKey,
        'Content-Type': 'application/json',
      },
      data: completePayloadCaptured,
    });

    expect(replaySamePayloadRes.status()).toBe(200);

    // Assert exact DB record counts after same-key replay
    const dormsAfterReplay = await prisma.dormitory.findMany({ where: { createdByUserId: freshUserId } });
    expect(dormsAfterReplay.length).toBe(1);

    const membersAfterReplay = await prisma.dormitoryMember.findMany({ where: { userId: freshUserId } });
    expect(membersAfterReplay.length).toBe(1);

    const subsAfterReplay = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: createdDormitoryId } });
    expect(subsAfterReplay.length).toBe(1);

    // B. Replay with SAME idempotency key but DIFFERENT payload -> returns 409 IDEMPOTENCY_KEY_REUSED
    const diffPayloadRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/complete', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
        'X-Idempotency-Key': capturedIdempotencyKey,
        'Content-Type': 'application/json',
      },
      data: { ...completePayloadCaptured, planCode: 'PAID' },
    });

    expect(diffPayloadRes.status()).toBe(409);
    const diffPayloadJson = await diffPayloadRes.json();
    expect(diffPayloadJson.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // C. Attempting completion with a NEW idempotency key for an owner who already completed onboarding
    const newKey = `onb_new_key_${Date.now()}`;
    const newKeyRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/complete', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
        'X-Idempotency-Key': newKey,
        'Content-Type': 'application/json',
      },
      data: completePayloadCaptured,
    });

    // Assert exact status semantic for owner who already has active membership
    expect(newKeyRes.status()).toBe(409);
    const newKeyJson = await newKeyRes.json();
    expect(newKeyJson.error.code).toBe('FREE_DORMITORY_LIMIT_REACHED');

    // DB Check: Counts remain strictly 1
    const dormsAfterNewKey = await prisma.dormitory.findMany({ where: { createdByUserId: freshUserId } });
    expect(dormsAfterNewKey.length).toBe(1);

    // D. Malformed required payload -> 400 VALIDATION_ERROR
    const badPayloadRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/complete', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': csrfToken,
        'X-Idempotency-Key': `bad_payload_${Date.now()}`,
        'Content-Type': 'application/json',
      },
      data: { dormitory: {} }, // Missing required fields
    });

    expect(badPayloadRes.status()).toBe(400);

    // E. Missing / Invalid CSRF token -> 403 CSRF_INVALID
    const badCsrfRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/complete', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'X-CSRF-Token': 'invalid-csrf-token-123',
        'X-Idempotency-Key': `bad_csrf_${Date.now()}`,
        'Content-Type': 'application/json',
      },
      data: completePayloadCaptured,
    });

    expect(badCsrfRes.status()).toBe(403);
  });

  test('5. Multi-Dorm Owner Auth Guard & Explicit Selection (BR-003 & ROR3-008)', async ({ context, page }) => {
    // Authenticate multi-dorm owner WITHOUT setting selected_dormitory_id in localStorage or sessionStorage
    await injectSession(context, multiSessionToken, multiCsrfToken);

    await page.goto('http://127.0.0.1:5173/owner/dashboard');

    // BR-003: OwnerAuthGuard MUST NOT use memberships[0] automatically for multi-dorm owner!
    // Must redirect to /auth/owner for explicit dormitory selection
    await expect(page).toHaveURL('http://127.0.0.1:5173/auth/owner');

    // Now explicitly select Dorm B (multiDormId2)
    await page.evaluate((dormId) => {
      localStorage.setItem('selected_dormitory_id', dormId);
    }, multiDormId2);

    await page.goto('http://127.0.0.1:5173/owner/dashboard');

    // User is now allowed on /owner/dashboard with Dorm B explicitly selected
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');

    // Verify session API returns 2 memberships
    const sessionRes = await page.request.get('http://127.0.0.1:3001/api/v1/auth/session', {
      headers: {
        'Cookie': `horplus_session=${multiSessionToken}; horplus_csrf=${multiCsrfToken}`,
      },
    });
    const sessionData = await sessionRes.json();
    expect(sessionData.data.memberships.length).toBe(2);
  });
});
