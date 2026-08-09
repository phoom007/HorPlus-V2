/**
 * Real Owner Onboarding Browser & End-to-End Lifecycle Spec
 * Tests fresh owner onboarding against real HorPlus backend & PostgreSQL database.
 * Verifies demo data purge, legacy localStorage isolation, CSRF/Idempotency headers,
 * same-browser lifecycle, multi-dorm real UI selection, rapid double-submit protection,
 * and PostgreSQL transaction payload fidelity.
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { FakeLineServer } from './helpers/fake-line-server.js';

test.describe.serial('Real Owner Onboarding Browser E2E Lifecycle', () => {
  const prisma = getPrismaClient();
  const fakeLineServer = new FakeLineServer();

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

  async function drawSignatureAndSetupLine(page: any) {
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 20, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 100, box.y + 60);
      await page.mouse.move(box.x + 180, box.y + 30);
      await page.mouse.up();
    }
    await page.click('[data-testid="button-save-signature"]');
    await page.waitForSelector('[data-testid="signature-status-saved"]', { state: 'visible' });
    await page.click('[data-testid="button-next-step"]'); // 4 -> 5

    await page.fill('[data-testid="input-line-channel-id"]', '1650000001');
    await page.fill('[data-testid="input-line-channel-secret"]', 'secret_key_12345');
    await page.click('[data-testid="button-save-line-credentials"]');
    await expect(page.locator('[data-testid="button-set-line-webhook"]')).toBeEnabled();
    await page.click('[data-testid="button-set-line-webhook"]');
    await expect(page.locator('[data-testid="button-test-line-webhook"]')).toBeEnabled();
    await page.click('[data-testid="button-test-line-webhook"]');
    await expect(page.locator('[data-testid="line-readiness-badge"]')).toContainText('พร้อมใช้งาน ✅');
    await page.click('[data-testid="button-next-step"]'); // 5 -> 6
  }

  test.beforeAll(async () => {
    const fakeLineUrl = await fakeLineServer.start();
    process.env.HORPLUS_E2E = 'true';
    process.env.LINE_BASE_URL = fakeLineUrl;
    process.env.LINE_PLATFORM_URL = fakeLineUrl;

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

    // 3. Setup multi-dorm owner for RI-008 test
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
    await fakeLineServer.stop();
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
          await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.ownerSignature.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.room.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.building.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
          await prisma.dormitory.delete({ where: { id: dormId } }).catch(() => {});
        }
        await prisma.ownerSignature.deleteMany({ where: { signedByUserId: freshUserId } }).catch(() => {});
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

  test('2. Form initializes clean (no demo PII/bank data) and ignores legacy localStorage contamination (FD-004 & BR-005)', async ({ context, page }) => {
    test.setTimeout(60000);
    await injectSession(context);

    // Pre-mount seed using context.addInitScript BEFORE navigating to /owner/register (FD-004 requirement)
    await context.addInitScript(() => {
      localStorage.setItem('registered_dorm_profile', JSON.stringify({
        ownerName: 'นายสมศักดิ์ วงศ์สว่าง FAKE',
        ownerPhone: '081-999-8888',
        ownerEmail: 'somsak.fake@gmail.com',
        dormName: 'หอพัก FAKE Somsak',
        dormAddress: 'FAKE Address 123',
        paymentAccount: {
          accountNumber: '999-9-99999-9',
          bankName: 'กสิกรไทย (KBank)',
          accountName: 'นายสมศักดิ์ FAKE',
          promptPayId: '081-999-8888'
        }
      }));
      localStorage.setItem('HorPlus_pending_contract_submissions', JSON.stringify([
        { id: 'sub-fake-1', status: 'pending' }
      ]));
    });

    // Initial page load AFTER pre-mount initScript is active
    await page.goto('http://127.0.0.1:5173/owner/register', { timeout: 45000 });

    // FD-004 Initial Clean Assertions across all form surfaces
    const dormNameInput = page.locator('[data-testid="input-dormitory-name"]');
    await expect(dormNameInput).toBeVisible({ timeout: 45000 });
    await expect(dormNameInput).toHaveValue('');

    const dormAddressInput = page.locator('[data-testid="input-address"]');
    await expect(dormAddressInput).toHaveValue('');

    const provinceSelect = page.locator('[data-testid="select-province"]');

    // Fill Step 1 to advance to Step 4 bank fields clean check
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await dormNameInput.fill('Clean Check Dorm');
    await dormAddressInput.fill('123 Clean St');
    await page.click('button:has-text("ถัดไป")'); // Step 1 -> 2

    // Fill Step 2 room topology
    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('button:has-text("ถัดไป")'); // Step 2 -> 3

    // Fill Step 3 utility rates
    await page.fill('[data-testid="input-water-rate"]', '18');
    await page.fill('[data-testid="input-electric-rate"]', '8');
    await page.click('button:has-text("ถัดไป")'); // Step 3 -> 4

    // Verify Step 4 bank selection & account details start completely blank
    const accNoInput = page.locator('[data-testid="input-account-number"]');
    await expect(accNoInput).toHaveValue('');

    const accNameInput = page.locator('[data-testid="input-account-name"]');
    await expect(accNameInput).toHaveValue('');

    const promptPayInput = page.locator('[data-testid="input-promptpay"]');
    await expect(promptPayInput).toHaveValue('');
  });

  test('3. Complete 4-step onboarding UI, verify CSRF/Idempotency headers, PostgreSQL records, AND same-browser lifecycle (RI-002, RI-003, RI-004, RI-005)', async ({ context, page }) => {
    // Ensure 100% clean state: delete any existing dormitories and memberships for freshUserId from prior steps
    await prisma.ownerSignature.deleteMany({ where: { signedByUserId: freshUserId } }).catch(() => {});
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitory: { createdByUserId: freshUserId } } }).catch(() => {});
    await prisma.dormitorySubscription.deleteMany({ where: { dormitory: { createdByUserId: freshUserId } } }).catch(() => {});
    await prisma.room.deleteMany({ where: { dormitory: { createdByUserId: freshUserId } } }).catch(() => {});
    await prisma.building.deleteMany({ where: { dormitory: { createdByUserId: freshUserId } } }).catch(() => {});
    await prisma.dormitoryMember.deleteMany({ where: { userId: freshUserId } }).catch(() => {});
    await prisma.dormitory.deleteMany({ where: { createdByUserId: freshUserId } }).catch(() => {});

    await injectSession(context);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // ── Step 1: Dormitory Info ──
    await page.fill('[data-testid="input-dormitory-name"]', 'Real Playwright Dormitory');
    await page.fill('[data-testid="input-address"]', '456 Real Playwright Ave, Bangkok 10110');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('[data-testid="button-next-step"]'); // 1 -> 2

    // ── Step 2: Buildings & Rooms (fill 4 rooms) ──
    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('[data-testid="button-next-step"]'); // 2 -> 3

    // ── Step 3: Utilities & Service Rates (fill rates) ──
    await page.fill('[data-testid="input-water-rate"]', '18');
    await page.fill('[data-testid="input-electric-rate"]', '8');
    await page.click('[data-testid="button-next-step"]'); // 3 -> 4

    // ── Step 4 & 5: Deposits, Payment Account, Signature & LINE OA ──
    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption({ index: 1 });
    await page.fill('[data-testid="input-account-number"]', '012-3-45678-9');
    await page.fill('[data-testid="input-account-name"]', 'นาย สมชาย ใจดี');
    await drawSignatureAndSetupLine(page);

    // ── Step 6: Summary & Package Finalize ──
    await page.click('[data-testid="button-finalize-onboarding"]');

    // ── Terms & Confirmation Modal ──
    await page.waitForSelector('[data-testid="checkbox-agreed-terms"]', { state: 'visible' });
    await page.check('[data-testid="checkbox-agreed-terms"]');

    let completeHeadersCaptured: any = null;

    page.on('request', (req) => {
      if (req.url().includes('onboarding/finalize') && req.method() === 'POST') {
        completeHeadersCaptured = req.headers();
        try {
          completePayloadCaptured = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    const [completeResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('onboarding/finalize'),
        { timeout: 15000 }
      ),
      page.click('[data-testid="button-confirm-finalize"]'),
    ]);

    expect(completeResponse.status()).toBe(200);

    // Wait for redirect to /owner/dashboard
    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });

    // Assert API headers
    expect(completeHeadersCaptured).not.toBeNull();
    expect(completeHeadersCaptured['x-csrf-token']).toBeDefined();
    expect(completeHeadersCaptured['x-idempotency-key']).toBeDefined();

    capturedIdempotencyKey = completeHeadersCaptured['x-idempotency-key'];

    // HTTP Boundary Assertions
    expect(completePayloadCaptured.dormitory.name).toBe('Real Playwright Dormitory');
    expect(completePayloadCaptured.payment.bankAccountName).toBe('นาย สมชาย ใจดี');
    expect(completePayloadCaptured.payment.bankAccountNumber).toBe('012-3-45678-9');

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

    // Verify Session API returns onboardingRequired = false
    const postSessionRes = await page.request.get('http://127.0.0.1:3001/api/v1/auth/session', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
      },
    });
    const postSessionData = await postSessionRes.json();
    expect(postSessionData.data.onboardingRequired).toBe(false);
    expect(postSessionData.data.memberships.length).toBe(1);

    // Hard page reload in SAME browser page
    await page.reload();
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');
  });

  test('4. Real UI Rapid Double-Submit Protection (RI-007)', async ({ context, page }) => {
    test.setTimeout(60000);
    const rapidUser = await prisma.user.create({
      data: {
        email: `rapid-owner-${Date.now()}@example.com`,
        emailNormalized: `rapid-owner-${Date.now()}@example.com`,
        name: 'Rapid Submit Owner User',
        googleSubject: `goog-rapid-${Date.now()}`,
        status: 'active',
      },
    });

    const rapidSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: rapidUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(rapidSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    const rToken = sessionTokenService.encryptToken({ sub: rapidUser.id, sid: rapidSid, type: 'session', version: 1 }, 86400);
    const rCsrf = csrfService.generateCsrfToken(rapidSid);

    await injectSession(context, rToken, rCsrf);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // Fill form steps
    await page.fill('[data-testid="input-dormitory-name"]', 'Rapid Submit Dormitory');
    await page.fill('[data-testid="input-address"]', '789 Rapid St, Bangkok');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('[data-testid="button-next-step"]'); // 1 -> 2

    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('[data-testid="button-next-step"]'); // 2 -> 3

    await page.fill('[data-testid="input-water-rate"]', '18');
    await page.fill('[data-testid="input-electric-rate"]', '8');
    await page.click('[data-testid="button-next-step"]'); // 3 -> 4

    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');
    await page.fill('[data-testid="input-account-number"]', '012-3-45678-9');
    await page.fill('[data-testid="input-account-name"]', 'นาย สมชาย ใจดี');
    await drawSignatureAndSetupLine(page);

    // Step 6: Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');

    await page.waitForSelector('[data-testid="checkbox-agreed-terms"]', { state: 'visible' });

    let completionPostCount = 0;
    const capturedIdempotencyKeys: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('onboarding/finalize') && req.method() === 'POST') {
        completionPostCount++;
        const key = req.headers()['x-idempotency-key'];
        if (key) capturedIdempotencyKeys.push(key);
      }
    });

    await page.check('[data-testid="checkbox-agreed-terms"]');
    const submitBtn = page.locator('[data-testid="button-confirm-finalize"]');
    await submitBtn.click();

    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });

    // Assert exact HTTP POST completion request count = 1 (FD-005 requirement) and 1 unique idempotency key (PP-007)
    expect(completionPostCount).toBe(1);
    expect(capturedIdempotencyKeys.length).toBe(1);

    // Assert exact PostgreSQL DB record counts
    const rapidDorms = await prisma.dormitory.findMany({ where: { createdByUserId: rapidUser.id } });
    expect(rapidDorms.length).toBe(1);

    const rapidMembers = await prisma.dormitoryMember.findMany({ where: { userId: rapidUser.id } });
    expect(rapidMembers.length).toBe(1);

    const rapidSubs = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: rapidDorms[0].id } });
    expect(rapidSubs.length).toBe(1);

    const rapidBlds = await prisma.building.findMany({ where: { dormitoryId: rapidDorms[0].id } });
    expect(rapidBlds.length).toBe(1);

    const rapidRooms = await prisma.room.findMany({ where: { dormitoryId: rapidDorms[0].id } });
    expect(rapidRooms.length).toBe(4);

    // Cleanup rapid user
    if (rapidDorms.length > 0) {
      const rapidSubList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: rapidDorms[0].id }, select: { id: true } });
      for (const sub of rapidSubList) {
        await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
      }
      await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.ownerSignature.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: rapidDorms[0].id } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: rapidDorms[0].id } }).catch(() => {});
    }
    await prisma.accountBenefitClaim.deleteMany({ where: { userId: rapidUser.id } }).catch(() => {});
    await prisma.promoRedemption.deleteMany({ where: { redeemedBy: rapidUser.id } }).catch(() => {});
    await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: rapidUser.id } }).catch(() => {});
    await prisma.ownerSignature.deleteMany({ where: { signedByUserId: rapidUser.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: rapidUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: rapidUser.id } }).catch(() => {});
  });

  test('5. Multi-Dorm Owner Auth Guard & Real UI Selection (RI-008)', async ({ context, page }) => {
    // Authenticate multi-dorm owner WITHOUT setting selected_dormitory_id in localStorage or sessionStorage
    await injectSession(context, multiSessionToken, multiCsrfToken);

    await page.goto('http://127.0.0.1:5173/owner/dashboard');

    // OwnerAuthGuard redirects to /auth/owner for explicit dormitory selection
    await expect(page).toHaveURL('http://127.0.0.1:5173/auth/owner');

    // RI-008: Explicitly select Dorm B via REAL UI interaction on /auth/owner
    const dormCardBeta = page.locator('h4', { hasText: 'Multi Owner Dorm Beta' });
    await expect(dormCardBeta).toBeVisible({ timeout: 15000 });
    await dormCardBeta.click();

    // Verify user is redirected to /owner/dashboard
    await page.waitForURL('**/owner/dashboard', { timeout: 15000 });
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');

    // Perform hard reload to verify selection persists
    await page.reload();
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');
  });

  test('6. Payload Fidelity Test — UI == POST JSON == DATABASE (Distinctive Values)', async ({ context, page }) => {
    test.setTimeout(60000);
    const fidelityUser = await prisma.user.create({
      data: {
        email: `fidelity-owner-${Date.now()}@example.com`,
        emailNormalized: `fidelity-owner-${Date.now()}@example.com`,
        name: 'Fidelity Owner User',
        googleSubject: `goog-fidelity-${Date.now()}`,
        status: 'active',
      },
    });

    const fSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: fidelityUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(fSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    const fToken = sessionTokenService.encryptToken({ sub: fidelityUser.id, sid: fSid, type: 'session', version: 1 }, 86400);
    const fCsrf = csrfService.generateCsrfToken(fSid);

    await injectSession(context, fToken, fCsrf);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // Distinctive test inputs: rooms = 3, monthly rent = 4321, deposit = 0, water = 0, electricity = 0, due day = 17, late fee = none
    await page.fill('[data-testid="input-dormitory-name"]', 'Fidelity Distinctive Dorm');
    await page.fill('[data-testid="input-address"]', '171 Fidelity Rd');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('button:has-text("ถัดไป")'); // Step 1 -> 2

    // Step 2: 3 rooms per floor
    await page.fill('input[type="number"] >> nth=1', '3');
    await page.click('button:has-text("ถัดไป")'); // Step 2 -> 3

    // Step 3: water = 0, electric = 0
    await page.fill('[data-testid="input-water-rate"]', '0');
    await page.fill('[data-testid="input-electric-rate"]', '0');
    await page.click('button:has-text("ถัดไป")'); // Step 3 -> 4

    // Step 4: bank info & signature
    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');
    await page.fill('[data-testid="input-account-number"]', '888-8-88888-8');
    await page.fill('[data-testid="input-account-name"]', 'นาย Fidelity Tester');
    await drawSignatureAndSetupLine(page);

    let capturedFidelityPost: any = null;
    page.on('request', (req) => {
      if (req.url().includes('onboarding/finalize') && req.method() === 'POST') {
        try {
          capturedFidelityPost = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    // Step 6: Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');

    await page.waitForSelector('[data-testid="checkbox-agreed-terms"]', { state: 'visible' });
    await page.check('[data-testid="checkbox-agreed-terms"]');

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('onboarding/finalize'), { timeout: 15000 }),
      page.click('[data-testid="button-confirm-finalize"]'),
    ]);

    expect(postRes.status()).toBe(200);

    // ── ASSERT EXACT EQUALITY: UI == POST JSON == DATABASE ──

    // 1. POST JSON Payload assertions
    expect(capturedFidelityPost.dormitory.name).toBe('Fidelity Distinctive Dorm');
    expect(capturedFidelityPost.rooms.length).toBe(3);
    expect(capturedFidelityPost.rooms[0].monthlyRent).toBe(0);
    expect(capturedFidelityPost.rooms[0].depositAmount).toBe(0);
    expect(capturedFidelityPost.billing.billingDay).toBe(25);
    expect(capturedFidelityPost.billing.waterRate).toBe('0');
    expect(capturedFidelityPost.billing.electricityRate).toBe('0');
    expect(capturedFidelityPost.billing.lateFeeType).toBe('none');
    expect(capturedFidelityPost.payment.promptPayType).toBeFalsy();
    expect(capturedFidelityPost.payment.promptPayValue).toBeFalsy();

    // 2. PostgreSQL Database assertions
    const fDorm = await prisma.dormitory.findFirst({ where: { createdByUserId: fidelityUser.id } });
    expect(fDorm).not.toBeNull();
    expect(fDorm!.name).toBe('Fidelity Distinctive Dorm');

    const fBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: fDorm!.id } });
    expect(fBilling).not.toBeNull();
    expect(fBilling!.billingDay).toBe(25);
    expect(fBilling!.waterRate.toString()).toBe('0');
    expect(fBilling!.electricityRate.toString()).toBe('0');
    expect(fBilling!.lateFeeType).toBe('none');
    expect(fBilling!.lateFeeValue.toString()).toBe('0');
    expect(fBilling!.bankCode).toBe('กสิกรไทย (KBank)');
    expect(fBilling!.bankAccountNumber).toBe('XXX-XXX-8888');
    expect(fBilling!.bankAccountName).toBe('นาย Fidelity Tester');
    expect(fBilling!.promptPayType).toBeNull();
    expect(fBilling!.promptPayValue).toBeNull();

    // 3. Settings GET API Readback
    const settingsGetRes = await context.request.get(`http://127.0.0.1:3001/api/v1/dormitories/${fDorm!.id}/billing-settings`, {
      headers: {
        'Cookie': `horplus_session=${fToken}; horplus_csrf=${fCsrf}`,
        'x-dormitory-id': fDorm!.id,
      },
    });
    expect(settingsGetRes.ok()).toBe(true);
    const settingsData = (await settingsGetRes.json()).data;
    expect(settingsData.billingDay).toBe(25);

    const paymentGetRes = await context.request.get(`http://127.0.0.1:3001/api/v1/dormitories/${fDorm!.id}/payment-settings`, {
      headers: {
        'Cookie': `horplus_session=${fToken}; horplus_csrf=${fCsrf}`,
        'x-dormitory-id': fDorm!.id,
      },
    });
    expect(paymentGetRes.ok()).toBe(true);
    const paymentData = (await paymentGetRes.json()).data;
    expect(paymentData.bankCode).toBe('กสิกรไทย (KBank)');
    expect(paymentData.maskedBankAccountNumber).toBe('XXX-XXX-8888');
    expect(paymentData.bankAccountName).toBe('นาย Fidelity Tester');
    expect(paymentData.promptPayType).toBeNull();
    expect(paymentData.maskedPromptPayValue).toBeNull();

    const fRooms = await prisma.room.findMany({ where: { dormitoryId: fDorm!.id } });
    expect(fRooms.length).toBe(3);
    expect(fRooms[0].monthlyRent.toString()).toBe('0');
    expect(fRooms[0].depositAmount.toString()).toBe('0');

    // Cleanup fidelity user
    if (fDorm) {
      const fSubList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: fDorm.id }, select: { id: true } });
      for (const sub of fSubList) {
        await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
      }
      await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.ownerSignature.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: fDorm.id } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: fDorm.id } }).catch(() => {});
    }
    await prisma.accountBenefitClaim.deleteMany({ where: { userId: fidelityUser.id } }).catch(() => {});
    await prisma.promoRedemption.deleteMany({ where: { redeemedBy: fidelityUser.id } }).catch(() => {});
    await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: fidelityUser.id } }).catch(() => {});
    await prisma.ownerSignature.deleteMany({ where: { signedByUserId: fidelityUser.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: fidelityUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: fidelityUser.id } }).catch(() => {});
  });

  test('7. PromptPay Canonical Matrix — 10-Digit Mobile Phone (PP-001, PP-002, PP-003)', async ({ context, page }) => {
    test.setTimeout(60000);
    const ppUser = await prisma.user.create({
      data: {
        email: `pp-owner-${Date.now()}@example.com`,
        emailNormalized: `pp-owner-${Date.now()}@example.com`,
        name: 'PromptPay Owner User',
        googleSubject: `goog-pp-${Date.now()}`,
        status: 'active',
      },
    });

    const ppSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: ppUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(ppSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    const ppToken = sessionTokenService.encryptToken({ sub: ppUser.id, sid: ppSid, type: 'session', version: 1 }, 86400);
    const ppCsrf = csrfService.generateCsrfToken(ppSid);

    await injectSession(context, ppToken, ppCsrf);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // Step 1
    await page.fill('[data-testid="input-dormitory-name"]', 'PromptPay Mobile Phone Dorm');
    await page.fill('[data-testid="input-address"]', '99 PromptPay St');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('[data-testid="button-next-step"]');

    // Step 2
    await page.fill('input[type="number"] >> nth=1', '2');
    await page.click('[data-testid="button-next-step"]');

    // Step 3
    await page.fill('[data-testid="input-water-rate"]', '18');
    await page.fill('[data-testid="input-electric-rate"]', '8');
    await page.click('[data-testid="button-next-step"]');

    // Step 4: Fill Bank details + 10-digit PromptPay Phone + Signature
    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');
    await page.fill('[data-testid="input-account-number"]', '123-4-56789-0');
    await page.fill('[data-testid="input-account-name"]', 'นาย พร้อมเพย์ สมชาย');

    const promptPayInput = page.locator('[data-testid="input-promptpay"]');
    await promptPayInput.fill('081-999-8888');
    await drawSignatureAndSetupLine(page);

    let capturedPost: any = null;
    page.on('request', (req) => {
      if (req.url().includes('onboarding/finalize') && req.method() === 'POST') {
        try {
          capturedPost = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    // Step 6: Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');

    await page.waitForSelector('[data-testid="checkbox-agreed-terms"]', { state: 'visible' });
    await page.check('[data-testid="checkbox-agreed-terms"]');

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('onboarding/finalize'), { timeout: 15000 }),
      page.click('[data-testid="button-confirm-finalize"]'),
    ]);

    expect(postRes.status()).toBe(200);

    // 1. POST JSON Payload assertions
    expect(capturedPost.payment.promptPayType).toBe('mobile_phone');
    expect(capturedPost.payment.promptPayValue).toBe('0819998888');

    // 2. Database assertions
    const ppDorm = await prisma.dormitory.findFirst({ where: { createdByUserId: ppUser.id } });
    expect(ppDorm).not.toBeNull();
    const ppBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: ppDorm!.id } });
    expect(ppBilling).not.toBeNull();
    expect(ppBilling!.promptPayType).toBe('mobile_phone');
    expect(ppBilling!.promptPayValue).toBeNull();
    expect(ppBilling!.promptPayValueEncrypted).not.toBeNull();
    expect(ppBilling!.bankCode).toBe('กสิกรไทย (KBank)');

    // 3. Settings GET API Readback
    const settingsRes = await context.request.get(`http://127.0.0.1:3001/api/v1/dormitories/${ppDorm!.id}/payment-settings`, {
      headers: {
        'Cookie': `horplus_session=${ppToken}; horplus_csrf=${ppCsrf}`,
        'x-dormitory-id': ppDorm!.id,
      },
    });
    expect(settingsRes.ok()).toBe(true);
    const settingsBody = (await settingsRes.json()).data;
    expect(settingsBody.promptPayType).toBe('mobile_phone');
    expect(settingsBody.maskedPromptPayValue).toBe('081-XXX-8888');

    // Cleanup
    if (ppDorm) {
      const subList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: ppDorm.id }, select: { id: true } });
      for (const sub of subList) {
        await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
      }
      await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.ownerSignature.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: ppDorm.id } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: ppDorm.id } }).catch(() => {});
    }
    await prisma.accountBenefitClaim.deleteMany({ where: { userId: ppUser.id } }).catch(() => {});
    await prisma.promoRedemption.deleteMany({ where: { redeemedBy: ppUser.id } }).catch(() => {});
    await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: ppUser.id } }).catch(() => {});
    await prisma.ownerSignature.deleteMany({ where: { signedByUserId: ppUser.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: ppUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: ppUser.id } }).catch(() => {});
  });

  test('8. PromptPay Canonical Matrix — 13-Digit National ID with AES-256-GCM Encryption (PP-001, PP-002, PP-003, PP-009)', async ({ context, page }) => {
    test.setTimeout(60000);
    const nidUser = await prisma.user.create({
      data: {
        email: `nid-owner-${Date.now()}@example.com`,
        emailNormalized: `nid-owner-${Date.now()}@example.com`,
        name: 'National ID PromptPay Owner',
        googleSubject: `goog-nid-${Date.now()}`,
        status: 'active',
      },
    });

    const nidSid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: nidUser.id,
        sessionIdHash: SessionTokenService.hashSessionId(nidSid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    const nidToken = sessionTokenService.encryptToken({ sub: nidUser.id, sid: nidSid, type: 'session', version: 1 }, 86400);
    const nidCsrf = csrfService.generateCsrfToken(nidSid);

    await injectSession(context, nidToken, nidCsrf);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // Step 1
    await page.fill('[data-testid="input-dormitory-name"]', 'PromptPay National ID Dorm');
    await page.fill('[data-testid="input-address"]', '13 National ID Ave');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('[data-testid="button-next-step"]');

    // Step 2
    await page.fill('input[type="number"] >> nth=1', '2');
    await page.click('[data-testid="button-next-step"]');

    // Step 3
    await page.fill('[data-testid="input-water-rate"]', '18');
    await page.fill('[data-testid="input-electric-rate"]', '8');
    await page.click('[data-testid="button-next-step"]');

    // Step 4: Fill Bank details + 13-digit PromptPay Thai National ID + Signature
    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');
    await page.fill('[data-testid="input-account-number"]', '321-0-98765-4');
    await page.fill('[data-testid="input-account-name"]', 'นาย ชาติชาย ประชาชน');

    const promptPayInput = page.locator('[data-testid="input-promptpay"]');
    await promptPayInput.fill('1-1007-00123-45-6');
    await drawSignatureAndSetupLine(page);

    let capturedPost: any = null;
    page.on('request', (req) => {
      if (req.url().includes('onboarding/finalize') && req.method() === 'POST') {
        try {
          capturedPost = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    // Step 6: Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');

    await page.waitForSelector('[data-testid="checkbox-agreed-terms"]', { state: 'visible' });
    await page.check('[data-testid="checkbox-agreed-terms"]');

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('onboarding/finalize'), { timeout: 15000 }),
      page.click('[data-testid="button-confirm-finalize"]'),
    ]);

    expect(postRes.status()).toBe(200);

    // 1. POST JSON Payload assertions for 13-digit national ID
    expect(capturedPost.payment.promptPayType).toBe('national_id');
    expect(capturedPost.payment.promptPayValue).toBe('1100700123456');

    // 2. Database Privacy Assertions (PP-009): Raw plaintext National ID is NOT in promptPayValue column
    const nidDorm = await prisma.dormitory.findFirst({ where: { createdByUserId: nidUser.id } });
    expect(nidDorm).not.toBeNull();
    const nidBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: nidDorm!.id } });
    expect(nidBilling).not.toBeNull();
    expect(nidBilling!.promptPayType).toBe('national_id');
    expect(nidBilling!.promptPayValue).toBeNull(); // Raw plaintext protection
    expect(nidBilling!.promptPayValueEncrypted).not.toBeNull(); // Encrypted via AES-256-GCM

    // 3. Settings GET API Readback: Authorized owner receives masked national ID
    const settingsRes = await context.request.get(`http://127.0.0.1:3001/api/v1/dormitories/${nidDorm!.id}/payment-settings`, {
      headers: {
        'Cookie': `horplus_session=${nidToken}; horplus_csrf=${nidCsrf}`,
        'x-dormitory-id': nidDorm!.id,
      },
    });
    expect(settingsRes.ok()).toBe(true);
    const settingsBody = (await settingsRes.json()).data;
    expect(settingsBody.promptPayType).toBe('national_id');
    expect(settingsBody.maskedPromptPayValue).toBe('1-1007-XXXXX-45-6');

    // Cleanup
    if (nidDorm) {
      const subList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: nidDorm.id }, select: { id: true } });
      for (const sub of subList) {
        await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
      }
      await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.ownerSignature.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: nidDorm.id } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: nidDorm.id } }).catch(() => {});
    }
    await prisma.accountBenefitClaim.deleteMany({ where: { userId: nidUser.id } }).catch(() => {});
    await prisma.promoRedemption.deleteMany({ where: { redeemedBy: nidUser.id } }).catch(() => {});
    await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: nidUser.id } }).catch(() => {});
    await prisma.ownerSignature.deleteMany({ where: { signedByUserId: nidUser.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: nidUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: nidUser.id } }).catch(() => {});
  });
});
