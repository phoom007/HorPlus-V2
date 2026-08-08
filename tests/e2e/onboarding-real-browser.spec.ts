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
          await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
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

  test('2. Form initializes clean (no demo PII/bank data) and ignores legacy localStorage contamination (RI-006 & BR-005)', async ({ context, page }) => {
    test.setTimeout(60000);
    await injectSession(context);

    // Initial page load
    await page.goto('http://127.0.0.1:5173/owner/register', { timeout: 45000 });

    // RI-006 Initial Clean Assertions across all form surfaces
    const dormNameInput = page.locator('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]');
    await expect(dormNameInput).toBeVisible({ timeout: 45000 });
    await expect(dormNameInput).toHaveValue('');

    const dormAddressInput = page.locator('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]');
    await expect(dormAddressInput).toHaveValue('');

    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await expect(provinceSelect).toHaveValue('');

    // Pre-seed browser localStorage with fake PII, bank, and promptpay data
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
          accountName: 'นายสมศักดิ์ FAKE',
          promptPayId: '081-999-8888',
          promptPayName: 'นายสมศักดิ์ FAKE PromptPay'
        }
      }));
      localStorage.setItem('HorPlus_pending_contract_submissions', JSON.stringify([
        { id: 'sub-fake-1', status: 'pending' }
      ]));
    });

    // Prove form fields remain clean and uncontaminated by fake localStorage
    await expect(dormNameInput).toHaveValue('');
    await expect(dormAddressInput).toHaveValue('');

    // Fill Step 1 to advance to Step 4 bank fields clean check
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await dormNameInput.fill('Clean Check Dorm');
    await dormAddressInput.fill('123 Clean St');
    await page.click('button:has-text("ถัดไป")'); // Step 1 -> 2

    // Fill Step 2 room topology
    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('button:has-text("ถัดไป")'); // Step 2 -> 3

    // Fill Step 3 utility and rent rates
    await page.fill('input[type="number"] >> nth=0', '18');
    await page.fill('input[type="number"] >> nth=1', '8');
    const rentInputStep3 = page.locator('label', { hasText: 'ค่าเช่ารายเดือน' }).first().locator('..').locator('input');
    await rentInputStep3.fill('4500');
    await page.click('button:has-text("ถัดไป")'); // Step 3 -> 4

    // Verify Step 4 bank selection & account details start completely blank
    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await expect(bankSelect).toHaveValue('');

    const accNoInput = page.locator('input[placeholder="กรุณาเลือกธนาคารก่อน"]');
    await expect(accNoInput).toBeDisabled();
    await expect(accNoInput).toHaveValue('');

    const accNameInput = page.locator('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]');
    await expect(accNameInput).toHaveValue('');

    const promptPayInput = page.locator('input[placeholder="เช่น 081-999-8888"]');
    await expect(promptPayInput).toHaveValue('');
  });

  test('3. Complete 4-step onboarding UI, verify CSRF/Idempotency headers, PostgreSQL records, AND same-browser lifecycle (RI-002, RI-003, RI-004, RI-005)', async ({ context, page }) => {
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

    await page.click('button:has-text("บันทึก & ยืนยันข้อมูลสร้างหอพัก")');

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
    await page.fill('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]', 'Rapid Submit Dormitory');
    await page.fill('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]', '789 Rapid St, Bangkok');
    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('button:has-text("ถัดไป")');

    await page.fill('input[type="number"] >> nth=1', '4');
    await page.click('button:has-text("ถัดไป")');

    await page.fill('input[type="number"] >> nth=0', '18');
    await page.fill('input[type="number"] >> nth=1', '8');
    const rentInput = page.locator('label', { hasText: 'ค่าเช่ารายเดือน' }).first().locator('..').locator('input');
    await rentInput.fill('4500');
    await page.click('button:has-text("ถัดไป")');

    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await bankSelect.selectOption({ index: 1 });
    await page.fill('input[placeholder="XXX-X-XXXXX-X"]', '012-3-45678-9');
    await page.fill('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]', 'นาย สมชาย ใจดี');
    await page.click('button:has-text("บันทึก & ยืนยันข้อมูลสร้างหอพัก")');

    const modal = page.locator('.fixed.inset-0.z-50');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('button', { hasText: 'Google Search' }).click();
    await modal.locator('input[type="checkbox"]').check();

    const submitBtn = modal.locator('button:has-text("ยอมรับเงื่อนไข & ยืนยันสร้างหอพัก")');
    await submitBtn.click();

    // Verify UI button is immediately disabled and changes text to "กำลังบันทึกข้อมูล..." (RI-007 protection)
    const disabledBtn = modal.locator('button:has-text("กำลังบันทึกข้อมูล...")');
    await expect(disabledBtn).toBeVisible({ timeout: 5000 });
    await expect(disabledBtn).toBeDisabled();

    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });

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
    const rapidSubList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: rapidDorms[0].id }, select: { id: true } });
    for (const sub of rapidSubList) {
      await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
    }
    await prisma.room.deleteMany({ where: { dormitoryId: rapidDorms[0].id } });
    await prisma.building.deleteMany({ where: { dormitoryId: rapidDorms[0].id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: rapidDorms[0].id } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: rapidDorms[0].id } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: rapidDorms[0].id } });
    await prisma.dormitory.delete({ where: { id: rapidDorms[0].id } });
    await prisma.session.deleteMany({ where: { userId: rapidUser.id } });
    await prisma.user.delete({ where: { id: rapidUser.id } });
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
    await page.fill('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]', 'Fidelity Distinctive Dorm');
    await page.fill('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]', '171 Fidelity Rd');
    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('button:has-text("ถัดไป")'); // Step 1 -> 2

    // Step 2: 3 rooms per floor
    await page.fill('input[type="number"] >> nth=1', '3');
    await page.click('button:has-text("ถัดไป")'); // Step 2 -> 3

    // Step 3: water = 0, electric = 0, rent = 4321
    await page.fill('input[type="number"] >> nth=0', '0');
    await page.fill('input[type="number"] >> nth=1', '0');
    const rentInput = page.locator('label', { hasText: 'ค่าเช่ารายเดือน' }).first().locator('..').locator('input');
    await rentInput.fill('4321');
    await page.click('button:has-text("ถัดไป")'); // Step 3 -> 4

    // Step 4: due day = 17, deposit = 0, bank info
    const dueDayInput = page.locator('input[placeholder="17"]').first();
    if (await dueDayInput.isVisible().catch(() => false)) {
      await dueDayInput.fill('17');
    }
    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await bankSelect.selectOption({ index: 1 });
    await page.fill('input[placeholder="XXX-X-XXXXX-X"]', '888-8-88888-8');
    await page.fill('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]', 'นาย Fidelity Tester');

    let capturedFidelityPost: any = null;
    page.on('request', (req) => {
      if (req.url().includes('onboarding/complete') && req.method() === 'POST') {
        try {
          capturedFidelityPost = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    await page.click('button:has-text("บันทึก & ยืนยันข้อมูลสร้างหอพัก")');

    const modal = page.locator('.fixed.inset-0.z-50');
    await modal.waitFor({ state: 'visible' });
    await modal.locator('button', { hasText: 'Google Search' }).click();
    await modal.locator('input[type="checkbox"]').check();

    const [postRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('onboarding/complete'), { timeout: 15000 }),
      modal.locator('button:has-text("ยอมรับเงื่อนไข & ยืนยันสร้างหอพัก")').click(),
    ]);

    expect(postRes.status()).toBe(200);

    // ── ASSERT EXACT EQUALITY: UI == POST JSON == DATABASE ──

    // 1. POST JSON Payload assertions
    expect(capturedFidelityPost.dormitory.name).toBe('Fidelity Distinctive Dorm');
    expect(capturedFidelityPost.rooms.length).toBe(3);
    expect(capturedFidelityPost.rooms[0].monthlyRent).toBe(4321);
    expect(capturedFidelityPost.rooms[0].depositAmount).toBe(0);
    expect(capturedFidelityPost.billing.waterRate).toBe('0');
    expect(capturedFidelityPost.billing.electricityRate).toBe('0');
    expect(capturedFidelityPost.billing.lateFeeType).toBe('none');

    // 2. PostgreSQL Database assertions
    const fDorm = await prisma.dormitory.findFirst({ where: { createdByUserId: fidelityUser.id } });
    expect(fDorm).not.toBeNull();
    expect(fDorm!.name).toBe('Fidelity Distinctive Dorm');

    const fBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: fDorm!.id } });
    expect(fBilling).not.toBeNull();
    expect(fBilling!.waterRate.toString()).toBe('0');
    expect(fBilling!.electricityRate.toString()).toBe('0');
    expect(fBilling!.lateFeeType).toBe('none');
    expect(fBilling!.lateFeeValue.toString()).toBe('0');

    const fRooms = await prisma.room.findMany({ where: { dormitoryId: fDorm!.id } });
    expect(fRooms.length).toBe(3);
    expect(fRooms[0].monthlyRent.toString()).toBe('4321');
    expect(fRooms[0].depositAmount.toString()).toBe('0');

    // Cleanup fidelity user
    const fSubList = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: fDorm!.id }, select: { id: true } });
    for (const sub of fSubList) {
      await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
    }
    await prisma.room.deleteMany({ where: { dormitoryId: fDorm!.id } });
    await prisma.building.deleteMany({ where: { dormitoryId: fDorm!.id } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: fDorm!.id } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: fDorm!.id } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: fDorm!.id } });
    await prisma.dormitory.delete({ where: { id: fDorm!.id } });
    await prisma.session.deleteMany({ where: { userId: fidelityUser.id } });
    await prisma.user.delete({ where: { id: fidelityUser.id } });
  });
});
