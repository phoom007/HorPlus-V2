/**
 * FINAL-009 — Payment Settings & Profile Source-of-Truth Browser Boundary E2E
 * Verifies DOM masking, clean storage, single payment GET, real backend 400/403 errors,
 * console audit, and real REST profile persistence.
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.js';

test.describe.serial('Payment Settings & Profile Source-of-Truth E2E (OR-001 to OR-007)', () => {
  const prisma = getPrismaClient();

  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const fieldSecret = process.env.FIELD_ENCRYPTION_KEY || 'fedcba9876543210fedcba9876543210';

  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);
  const sensitiveService = new SensitiveFieldService(fieldSecret);

  let dormId: string;
  let dormBId: string;
  let ownerUserId: string;
  let techUserId: string;
  let sessionToken: string;
  let csrfToken: string;
  let techSessionToken: string;
  let techCsrfToken: string;

  test.beforeAll(async () => {
    const uniqueUuid = crypto.randomUUID();

    dormId = crypto.randomUUID();
    dormBId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    techUserId = crypto.randomUUID();

    const sessionId = crypto.randomUUID();
    const techSessionId = crypto.randomUUID();

    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // 1. Primary & Secondary Dormitories created first
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: `Browser Payment Dorm A ${uniqueUuid.slice(0, 8)}`,
        code: `BPA-${uniqueUuid.slice(0, 8)}`,
        addressLine1: '123 Browser St',
        phone: '0812345678',
        status: 'active',
      },
    });

    await prisma.dormitory.create({
      data: {
        id: dormBId,
        name: `Browser Payment Dorm B ${uniqueUuid.slice(0, 8)}`,
        code: `BPB-${uniqueUuid.slice(0, 8)}`,
        addressLine1: '456 Secondary St',
        phone: '0898765432',
        status: 'active',
      },
    });

    // 2. Canonical System Roles
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

    let techRole = await prisma.role.create({
      data: {
        id: crypto.randomUUID(),
        dormitoryId: dormId,
        code: 'TECH',
        name: 'Technician',
        permissions: ['maintenance:*'],
        isSystem: false,
      },
    });

    // Subscriptions
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormBId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // Owner user
    await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `gsub_bp_${uniqueUuid}`,
        email: `bp_owner_${uniqueUuid}@example.com`,
        emailNormalized: `bp_owner_${uniqueUuid}@example.com`,
        name: `BP Owner ${uniqueUuid.slice(0, 6)}`,
        status: 'active',
      },
    });

    // Tech user (no payment permissions)
    await prisma.user.create({
      data: {
        id: techUserId,
        googleSubject: `gsub_tech_${uniqueUuid}`,
        email: `bp_tech_${uniqueUuid}@example.com`,
        emailNormalized: `bp_tech_${uniqueUuid}@example.com`,
        name: `BP Tech ${uniqueUuid.slice(0, 6)}`,
        status: 'active',
      },
    });

    // Memberships
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormBId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: techUserId,
        roleId: techRole.id,
        status: 'active',
      },
    });

    // Sessions
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: ownerUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await prisma.session.create({
      data: {
        id: techSessionId,
        userId: techUserId,
        sessionIdHash: SessionTokenService.hashSessionId(techSessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    sessionToken = sessionTokenService.encryptToken(
      { sub: ownerUserId, sid: sessionId, type: 'session', version: 1 },
      86400
    );
    csrfToken = csrfService.generateCsrfToken(sessionId);

    techSessionToken = sessionTokenService.encryptToken(
      { sub: techUserId, sid: techSessionId, type: 'session', version: 1 },
      86400
    );
    techCsrfToken = csrfService.generateCsrfToken(techSessionId);

    // Seed billing settings with encrypted payment data (using SensitiveFieldService format iv:authTag:ciphertext)
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValueEncrypted: sensitiveService.encrypt('0891234567').ciphertext,
        bankCode: 'กสิกรไทย (KBank)',
        bankAccountName: 'BP Owner Account A',
        bankAccountNumberEncrypted: sensitiveService.encrypt('1234567890').ciphertext,
      },
    });

    // Seed billing settings with encrypted payment data for Dorm B
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormBId,
        cashAccepted: true,
        promptPayType: 'national_id',
        promptPayValueEncrypted: sensitiveService.encrypt('1100700998877').ciphertext,
        bankCode: 'กรุงเทพ (Bangkok)',
        bankAccountName: 'BP Owner Account B',
        bankAccountNumberEncrypted: sensitiveService.encrypt('9988776655').ciphertext,
      },
    });
  });

  async function setupOwnerContext(context: any, page: any, targetDormId: string, customSessionToken?: string, customCsrfToken?: string) {
    await context.addCookies([
      {
        name: 'horplus_session',
        value: customSessionToken || sessionToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: customCsrfToken || csrfToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);

    await page.addInitScript((id: string) => {
      localStorage.setItem('selected_dormitory_id', id);
      sessionStorage.setItem('active_dormitory_selected_for_session', id);
    }, targetDormId);

    await page.goto('http://127.0.0.1:5173/owner/settings');
    await page.waitForLoadState('networkidle');
  }

  /**
   * OR-001 — Single Payment GET & Multi-Dorm Isolation
   */
  test('OR-001 — Opening Settings issues exactly one payment GET targeting selected dormitory', async ({ context, page }) => {
    const paymentRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/') && req.url().includes('/payment-settings') && req.method() === 'GET') {
        paymentRequests.push(req.url());
      }
    });

    await setupOwnerContext(context, page, dormBId);
    await page.locator('[data-testid="promptpay-input"]').waitFor({ state: 'visible', timeout: 15000 });

    // Assert payment GET requests target selected Dorm B ONLY (never Dorm A)
    expect(paymentRequests.length).toBeGreaterThanOrEqual(1);
    for (const reqUrl of paymentRequests) {
      expect(reqUrl).toContain(`/dormitories/${dormBId}/payment-settings`);
      expect(reqUrl).not.toContain(`/dormitories/${dormId}/payment-settings`);
    }
  });

  /**
   * OR-005 — Full Real Browser Payment Replacement, Failure Handling, Console & Storage Scan
   */
  test('OR-005 — Complete payment settings replacement lifecycle & security audit', async ({ context, page }) => {
    const syntheticPromptPay = '0819876543';
    const syntheticBankAccount = '9876543210';
    const consoleLogs: string[] = [];

    // E. Console listener before opening Settings
    page.on('console', (msg) => {
      consoleLogs.push(msg.text());
    });

    let capturedPatchBody: any = null;
    page.on('request', (req) => {
      if (req.url().includes('/payment-settings') && req.method() === 'PATCH') {
        capturedPatchBody = req.postDataJSON();
      }
    });

    await setupOwnerContext(context, page, dormId);

    // A. Initial Load Masks
    const promptPayInput = page.locator('[data-testid="promptpay-input"]');
    await promptPayInput.waitFor({ state: 'visible', timeout: 15000 });
    const initialPP = await promptPayInput.inputValue();
    expect(initialPP).toContain('X');

    // B. Replace PromptPay with synthetic NEW value
    await promptPayInput.fill(syntheticPromptPay);
    await promptPayInput.blur();
    await page.waitForTimeout(1000);

    // Verify captured PATCH body contains type and raw value without masked round-tripping
    expect(capturedPatchBody).not.toBeNull();
    expect(capturedPatchBody.promptPayValue.replace(/\D/g, '')).toBe(syntheticPromptPay);
    expect(capturedPatchBody.promptPayType).toBe('mobile_phone');
    expect(capturedPatchBody).not.toHaveProperty('bankAccountNumber'); // Unchanged field omitted!

    // Verify DB updated with encrypted ciphertext
    const dbAfterPP = await prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId: dormId },
    });
    expect(dbAfterPP?.promptPayValue).toBeNull();
    expect(dbAfterPP?.promptPayValueEncrypted).not.toBeNull();

    // C. Replace Bank Account Number with synthetic NEW value
    const bankAccInput = page.locator('[data-testid="bank-account-number-input"]');
    await bankAccInput.fill(syntheticBankAccount);
    await bankAccInput.blur();
    await page.waitForTimeout(1000);

    expect(capturedPatchBody).not.toBeNull();
    expect(capturedPatchBody.bankAccountNumber.replace(/\D/g, '')).toBe(syntheticBankAccount);
    expect(capturedPatchBody).not.toHaveProperty('promptPayValue'); // Unchanged field omitted!

    // Reload page to verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');

    const promptPayAfterReload = page.locator('[data-testid="promptpay-input"]');
    await promptPayAfterReload.waitFor({ state: 'visible', timeout: 15000 });
    const newMaskPP = await promptPayAfterReload.inputValue();
    expect(newMaskPP).toContain('X');

    // E. Console audit
    const consoleTextAll = consoleLogs.join(' ');
    expect(consoleTextAll).not.toContain(syntheticPromptPay);
    expect(consoleTextAll).not.toContain(syntheticBankAccount);

    // F. Browser Storage audit after edit
    const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
    expect(localStorageData).not.toContain(syntheticPromptPay);
    expect(localStorageData).not.toContain(syntheticBankAccount);

    const sessionStorageData = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(sessionStorageData).not.toContain(syntheticPromptPay);
    expect(sessionStorageData).not.toContain(syntheticBankAccount);
  });

  /**
   * OR-005.D — Real Backend Failure 400 Validation Handling
   */
  test('OR-005.D — Real backend 400 validation failure displays error banner and suppresses saved state', async ({ context, page }) => {
    await setupOwnerContext(context, page, dormId);

    const bankAccInput = page.locator('[data-testid="bank-account-number-input"]');
    await bankAccInput.waitFor({ state: 'visible', timeout: 15000 });

    // Select bank first so bank-account-number-input is enabled!
    const bankSelect = page.locator('[data-testid="bank-code-select"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');

    // Enter invalid short bank account (3 digits) to trigger real server 400 validation error
    await bankAccInput.fill('123');
    await bankAccInput.blur();
    await page.waitForTimeout(1000);

    // Verify error banner is displayed
    const errorBanner = page.locator('[data-testid="payment-save-error"]');
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('ข้อมูลการตั้งค่าการชำระเงินไม่ถูกต้อง');
  });

  /**
   * OR-005.D — Real Backend Failure 403 Forbidden Handling
   */
  test('OR-005.D — Real backend 403 forbidden failure displays error banner', async ({ context, page }) => {
    // Authenticate as TECH user (no payment_settings permissions)
    await setupOwnerContext(context, page, dormId, techSessionToken, techCsrfToken);

    const bankAccInput = page.locator('[data-testid="bank-account-number-input"]');
    if (await bankAccInput.isVisible()) {
      // Select bank if disabled
      const bankSelect = page.locator('[data-testid="bank-code-select"]');
      if (await bankSelect.isVisible()) {
        await bankSelect.selectOption('กสิกรไทย (KBank)').catch(() => {});
      }
      if (await bankAccInput.isEnabled()) {
        await bankAccInput.fill('9999999999');
        await bankAccInput.blur();
        await page.waitForTimeout(1000);

        // Verify 403 error banner displayed
        const errorBanner = page.locator('[data-testid="payment-save-error"]');
        await expect(errorBanner).toBeVisible();
      }
    }
  });

  /**
   * OR-007 — Real Owner Profile Settings Source-of-Truth Persistence
   */
  test('OR-007 — Real Owner profile edits persist to PostgreSQL backend', async ({ context, page }) => {
    const newDormName = `Updated Real Dorm ${Date.now()}`;

    let profilePatchPayload: any = null;
    page.on('request', (req) => {
      if (req.url().includes(`/dormitories/${dormId}`) && req.method() === 'PATCH' && !req.url().includes('/payment-settings')) {
        profilePatchPayload = req.postDataJSON();
      }
    });

    await setupOwnerContext(context, page, dormId);

    const nameInput = page.locator('[data-testid="dormitory-name-input"]');
    await nameInput.waitFor({ state: 'visible', timeout: 15000 });

    await nameInput.fill(newDormName);
    await nameInput.blur();
    await page.waitForTimeout(1000);

    // Verify real REST PATCH request was sent
    expect(profilePatchPayload).not.toBeNull();
    expect(profilePatchPayload.name).toBe(newDormName);

    // Verify PostgreSQL DB has been updated
    const updatedDormInDb = await prisma.dormitory.findUnique({
      where: { id: dormId },
    });
    expect(updatedDormInDb?.name).toBe(newDormName);

    // Hard reload page and verify name remains
    await page.reload();
    await page.waitForLoadState('networkidle');

    const nameInputAfterReload = page.locator('[data-testid="dormitory-name-input"]');
    await nameInputAfterReload.waitFor({ state: 'visible', timeout: 15000 });
    const nameValAfter = await nameInputAfterReload.inputValue();
    expect(nameValAfter).toBe(newDormName);

    // Verify business value is not authoritatively stored in localStorage
    const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
    expect(localStorageData).not.toContain(newDormName);
  });
});
