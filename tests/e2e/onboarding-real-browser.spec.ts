/**
 * Real Owner Onboarding Browser & End-to-End Lifecycle Spec
 * Tests fresh owner onboarding against real HorPlus backend & PostgreSQL database.
 * Verifies demo data purge, legacy localStorage isolation, CSRF/Idempotency headers,
 * PostgreSQL transaction correctness, and post-onboarding session persistence.
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
  const userEmail = `real-owner-${Date.now()}@example.com`;
  const googleSub = `goog-sub-${Date.now()}`;

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
  });

  test.afterAll(async () => {
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
  });

  /** Helper: inject session cookies into a fresh browser context */
  async function injectSession(context: any) {
    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: '127.0.0.1', path: '/' },
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

  test('2. Form initializes clean (no demo PII/bank data) and ignores legacy localStorage contamination', async ({ context, page }) => {
    await injectSession(context);

    // Pre-seed browser localStorage with old fake registered_dorm_profile to test contamination prevention
    await page.goto('http://127.0.0.1:5173/owner/register');
    await page.evaluate(() => {
      localStorage.setItem('registered_dorm_profile', JSON.stringify({
        ownerName: 'นายสมศักดิ์ วงศ์สว่าง FAKE',
        ownerPhone: '081-999-8888',
        dormName: 'หอพัก FAKE Somsak',
        dormAddress: 'FAKE Address 123',
        paymentAccount: {
          accountNumber: '999-9-99999-9'
        }
      }));
    });

    // Reload page to trigger form initialization
    await page.reload();

    // Verify form fields start clean (no demo / fake data populated!)
    const dormNameInput = page.locator('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]');
    await expect(dormNameInput).toBeVisible();
    await expect(dormNameInput).toHaveValue('');

    const dormAddressInput = page.locator('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]');
    await expect(dormAddressInput).toHaveValue('');
  });

  test('3. Complete 5-step onboarding UI, verify CSRF & Idempotency headers, and provision real PostgreSQL records', async ({ context, page }) => {
    test.setTimeout(60000);
    await injectSession(context);
    await page.goto('http://127.0.0.1:5173/owner/register');

    // ── Step 1: Dormitory Info ──
    await page.fill('input[placeholder="เช่น หอพัก HorPlus สุขุมวิท"]', 'Real Playwright Dormitory');
    await page.fill('textarea[placeholder="เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110"]', '456 Real Playwright Ave, Bangkok 10110');
    // Province: The select renders with fallback display "กรุงเทพมหานคร"
    // but formData.province is '' -- we must explicitly select a value.
    const provinceSelect = page.locator('select').filter({ hasText: 'กรุงเทพมหานคร' }).first();
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 2: Buildings & Rooms (default 1 building A, 4 rooms) ──
    await page.click('button:has-text("ถัดไป")');

    // ── Step 3: Utilities & Service Rates (defaults ok) ──
    await page.click('button:has-text("ถัดไป")');

    // ── Step 4: Deposits & Payment Account ──
    // Select bank (the first select with "-- เลือกธนาคาร --" placeholder)
    const bankSelect = page.locator('select').filter({ hasText: '-- เลือกธนาคาร --' });
    await bankSelect.selectOption({ index: 1 });
    // After bank selection, the account number input becomes enabled with placeholder "XXX-X-XXXXX-X"
    await page.fill('input[placeholder="XXX-X-XXXXX-X"]', '012-3-45678-9');
    await page.fill('input[placeholder="เช่น นาย สมศักดิ์ วงศ์สว่าง (บัญชีธนาคาร)"]', 'นาย สมชาย ใจดี');
    await page.click('button:has-text("ถัดไป")');

    // ── Step 5: Rules & Confirmation ──
    // Draw a signature on the canvas (required by Step 5 validation)
    const canvas = page.locator('canvas');
    await canvas.waitFor({ state: 'visible' });
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Canvas bounding box not found');

    // Simulate a mouse drag to draw a signature stroke
    await page.mouse.move(canvasBox.x + 30, canvasBox.y + 50);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 100, canvasBox.y + 30, { steps: 5 });
    await page.mouse.move(canvasBox.x + 200, canvasBox.y + 70, { steps: 5 });
    await page.mouse.move(canvasBox.x + 280, canvasBox.y + 40, { steps: 5 });
    await page.mouse.up();

    // Click "ลงทะเบียนหอพัก"
    await page.click('button:has-text("ลงทะเบียนหอพัก")');

    // ── Terms & Referral Modal ──
    // Wait for modal to appear
    const modal = page.locator('.fixed.inset-0.z-50');
    await modal.waitFor({ state: 'visible' });

    // Select referral source: click the button containing "Google Search"
    await modal.locator('button', { hasText: 'Google Search' }).click();

    // Check terms agreement checkbox (scoped to modal)
    await modal.locator('input[type="checkbox"]').check();

    // Track request to verify CSRF token and Idempotency key headers
    let completePayloadCaptured: any = null;
    let completeHeadersCaptured: any = null;
    let completeResponseStatus: number | null = null;
    let completeResponseBody: any = null;

    page.on('request', (req) => {
      if (req.url().includes('/api/v1/onboarding/complete') && req.method() === 'POST') {
        completeHeadersCaptured = req.headers();
        try {
          completePayloadCaptured = JSON.parse(req.postData() || '{}');
        } catch {}
      }
    });

    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/onboarding/complete')) {
        completeResponseStatus = res.status();
        try {
          completeResponseBody = await res.json();
        } catch {}
      }
    });

    // Click completion button inside modal: "ยอมรับเงื่อนไข"
    // Use Promise.all to capture the API response while clicking
    const [completeResponse] = await Promise.all([
      page.waitForResponse(
        (res) => res.url().includes('onboarding/complete'),
        { timeout: 15000 }
      ),
      modal.locator('button:has-text("ยอมรับเงื่อนไข")').click(),
    ]);

    // Verify the API succeeded
    const responseStatus = completeResponse.status();
    const responseBody = await completeResponse.json().catch(() => null);
    if (responseStatus >= 400) {
      console.log('ONBOARDING COMPLETE API ERROR STATUS:', responseStatus);
      console.log('ONBOARDING COMPLETE API ERROR BODY:', JSON.stringify(responseBody, null, 2));
    }
    expect(responseStatus).toBeLessThan(400);

    // The app shows success for 2800ms then does window.location.href = '/owner/dashboard'
    await page.waitForURL('**/owner/dashboard', { timeout: 20000 });

    // Assert API headers
    expect(completeHeadersCaptured).not.toBeNull();
    expect(completeHeadersCaptured['x-csrf-token']).toBeDefined();
    expect(completeHeadersCaptured['x-idempotency-key']).toBeDefined();

    // Assert Payload does NOT contain old fake localStorage data
    expect(completePayloadCaptured.dormitory.name).toBe('Real Playwright Dormitory');
    expect(completePayloadCaptured.dormitory.name).not.toContain('FAKE');

    // Verify PostgreSQL records
    const dormsInDb = await prisma.dormitory.findMany({
      where: { createdByUserId: freshUserId },
    });
    expect(dormsInDb.length).toBe(1);
    expect(dormsInDb[0].name).toBe('Real Playwright Dormitory');

    const createdDormId = dormsInDb[0].id;

    const membersInDb = await prisma.dormitoryMember.findMany({
      where: { dormitoryId: createdDormId, userId: freshUserId },
      include: { role: true },
    });
    expect(membersInDb.length).toBe(1);
    expect(membersInDb[0].role.code).toBe('OWNER');

    const buildingsInDb = await prisma.building.findMany({
      where: { dormitoryId: createdDormId },
    });
    expect(buildingsInDb.length).toBe(1);

    const roomsInDb = await prisma.room.findMany({
      where: { dormitoryId: createdDormId },
    });
    expect(roomsInDb.length).toBe(4);
  });

  test('4. Session post-onboarding: onboardingRequired = false and hard reload retains dashboard', async ({ context, page }) => {
    await injectSession(context);

    // Check session
    const sessionRes = await page.request.get('http://127.0.0.1:3001/api/v1/auth/session', {
      headers: {
        'Cookie': `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
      },
    });
    const sessionData = await sessionRes.json();
    expect(sessionData.data.onboardingRequired).toBe(false);
    expect(sessionData.data.memberships.length).toBe(1);

    // Hard reload on /owner/dashboard
    await page.goto('http://127.0.0.1:5173/owner/dashboard');
    await expect(page).toHaveURL('http://127.0.0.1:5173/owner/dashboard');

    // Verify zero duplicate dormitories created
    const dormsInDb = await prisma.dormitory.findMany({
      where: { createdByUserId: freshUserId },
    });
    expect(dormsInDb.length).toBe(1);
  });
});
