/**
 * FINAL-009 — Payment Settings Browser Boundary E2E
 * Verifies DOM masking, clean storage, reload persistence, and error display.
 * @license Apache-2.0
 */

import { test, expect } from '@playwright/test';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public'
    }
  }
});

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
const FIELD_ENCRYPTION_KEY = process.env.FIELD_ENCRYPTION_KEY || '00000000000000000000000000000000';

const getSecretKey = (secret: string) => crypto.createHash('sha256').update(secret).digest();

function encryptSessionToken(userId: string, sessionId: string, ttlSeconds = 86400): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    sid: sessionId,
    type: 'session',
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
    version: 1,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(SESSION_ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', getSecretKey(CSRF_SIGNING_KEY))
    .update(`${sessionId}.${nonce}`)
    .digest('hex');
  return `${nonce}.${signature}`;
}

function encryptField(plaintext: string): string {
  const key = getSecretKey(FIELD_ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

test.describe('FINAL-009 — Payment Settings Browser Boundary', () => {
  let dormId: string;
  let ownerUserId: string;
  let sessionToken: string;
  let csrfToken: string;

  test.beforeAll(async () => {
    const uniqueSuffix = Date.now().toString().slice(-6);

    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    const roleId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    await subscriptionEntitlementService.ensureSeeded();
    const freePlan = await prisma.subscriptionPlan.findFirst({ where: { code: 'FREE' } });

    // Create dormitory
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: `Browser Payment Test ${uniqueSuffix}`,
        code: `BP-${uniqueSuffix}`,
        addressLine1: '123 Browser St',
        status: 'active',
      },
    });

    // Subscription
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan!.id,
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 365 * 86400000),
      },
    });

    // Owner user
    await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `gsub_bp_${uniqueSuffix}`,
        email: `bp_owner_${uniqueSuffix}@example.com`,
        emailNormalized: `bp_owner_${uniqueSuffix}@example.com`,
        name: `BP Owner ${uniqueSuffix}`,
      },
    });

    // Owner role
    await prisma.role.create({
      data: {
        id: roleId,
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: { '*': ['*'] },
        isSystem: true,
      },
    });

    // Membership
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: roleId,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    // Session
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: ownerUserId,
        sessionIdHash: crypto.createHash('sha256').update(sessionId).digest('hex'),
        status: 'active',
        ipMetadata: '127.0.0.1',
        userAgentHash: crypto.createHash('sha256').update('Playwright').digest('hex'),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    sessionToken = encryptSessionToken(ownerUserId, sessionId);
    csrfToken = generateCsrfToken(sessionId);

    // Billing settings with encrypted payment data
    const ppEncrypted = encryptField('0891234567');
    const bankEncrypted = encryptField('1234567890');

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        billingDay: 25,
        dueDay: 5,
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValue: null, // PS-006: zero plaintext
        promptPayValueEncrypted: ppEncrypted,
        bankCode: 'กสิกรไทย (KBank)',
        bankAccountName: 'BP Owner Account',
        bankAccountNumber: 'XXX-XXX-7890', // masked in DB
        bankAccountNumberEncrypted: bankEncrypted,
      },
    });
  });

  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * FINAL-009.1 — DOM Masking Verification
   * Navigates to settings page, verifies that payment fields display masked values
   * and no raw digits appear in any input.
   */
  test('DOM shows only masked payment values — no raw digits visible', async ({ page }) => {
    // Set cookies
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    // Set dorm context
    await page.addInitScript((id) => {
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to settings (the tab/section containing payment fields)
    const settingsNavBtn = page.locator('[data-testid="nav-settings"], a[href*="settings"], button:has-text("ตั้งค่า")').first();
    if (await settingsNavBtn.isVisible()) {
      await settingsNavBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Wait for promptpay input to be visible and populated
    const promptPayInput = page.locator('[data-testid="promptpay-input"]');
    await promptPayInput.waitFor({ state: 'visible', timeout: 15000 });

    // Verify masked value contains 'X'
    const ppValue = await promptPayInput.inputValue();
    expect(ppValue).toContain('X');
    expect(ppValue).not.toBe('0891234567'); // Must NOT show raw digits

    // Bank account number input
    const bankAccInput = page.locator('[data-testid="bank-account-number-input"]');
    const bankAccValue = await bankAccInput.inputValue();
    expect(bankAccValue).toContain('X');
    expect(bankAccValue).not.toBe('1234567890');

    // Bank account name (not sensitive — should show full value)
    const bankNameInput = page.locator('[data-testid="bank-account-name-input"]');
    const bankNameValue = await bankNameInput.inputValue();
    expect(bankNameValue).toBe('BP Owner Account');

    // Bank code select
    const bankSelect = page.locator('[data-testid="bank-code-select"]');
    const bankSelectValue = await bankSelect.inputValue();
    expect(bankSelectValue).toBe('กสิกรไทย (KBank)');
  });

  /**
   * FINAL-009.2 — Clean Storage Verification
   * After page load, verify no raw payment data exists in localStorage,
   * sessionStorage, or IndexedDB.
   */
  test('No raw payment data in localStorage, sessionStorage, or IndexedDB', async ({ page }) => {
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to settings
    const settingsNavBtn = page.locator('[data-testid="nav-settings"], a[href*="settings"], button:has-text("ตั้งค่า")').first();
    if (await settingsNavBtn.isVisible()) {
      await settingsNavBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Wait for payment fields to render
    await page.locator('[data-testid="promptpay-input"]').waitFor({ state: 'visible', timeout: 15000 });

    // Check localStorage
    const localStorageData = await page.evaluate(() => JSON.stringify(localStorage));
    expect(localStorageData).not.toContain('0891234567');
    expect(localStorageData).not.toContain('1234567890');
    expect(localStorageData).not.toContain('promptPayNumber');
    expect(localStorageData).not.toContain('promptPayName');
    expect(localStorageData).not.toContain('bankAccountNumber');

    // Check sessionStorage
    const sessionStorageData = await page.evaluate(() => JSON.stringify(sessionStorage));
    expect(sessionStorageData).not.toContain('0891234567');
    expect(sessionStorageData).not.toContain('1234567890');
    expect(sessionStorageData).not.toContain('promptPayNumber');
    expect(sessionStorageData).not.toContain('promptPayName');

    // Check IndexedDB databases for payment data
    const idbData = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      const results: string[] = [];
      for (const db of databases) {
        if (db.name) {
          try {
            const conn = indexedDB.open(db.name);
            await new Promise((resolve, reject) => {
              conn.onsuccess = resolve;
              conn.onerror = reject;
            });
            const dbConn = conn.result;
            const storeNames = Array.from(dbConn.objectStoreNames);
            for (const storeName of storeNames) {
              const tx = dbConn.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const allData = await new Promise<any[]>((resolve, reject) => {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = reject;
              });
              results.push(JSON.stringify(allData));
            }
            dbConn.close();
          } catch { /* skip inaccessible dbs */ }
        }
      }
      return results.join('|');
    });

    expect(idbData).not.toContain('0891234567');
    expect(idbData).not.toContain('1234567890');
  });

  /**
   * FINAL-009.3 — Reload Persistence Test
   * After navigating to settings, reload the page and verify payment fields
   * still show masked values (not stale/blank).
   */
  test('Payment fields persist masked values after page reload', async ({ page }) => {
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to settings
    const settingsNavBtn = page.locator('[data-testid="nav-settings"], a[href*="settings"], button:has-text("ตั้งค่า")').first();
    if (await settingsNavBtn.isVisible()) {
      await settingsNavBtn.click();
      await page.waitForLoadState('networkidle');
    }

    // Wait for payment field
    const promptPayInput = page.locator('[data-testid="promptpay-input"]');
    await promptPayInput.waitFor({ state: 'visible', timeout: 15000 });
    const firstValue = await promptPayInput.inputValue();
    expect(firstValue).toContain('X');

    // Reload
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Navigate again if needed
    const settingsNavBtnAfter = page.locator('[data-testid="nav-settings"], a[href*="settings"], button:has-text("ตั้งค่า")').first();
    if (await settingsNavBtnAfter.isVisible()) {
      await settingsNavBtnAfter.click();
      await page.waitForLoadState('networkidle');
    }

    // Re-check masked value persists
    const promptPayAfterReload = page.locator('[data-testid="promptpay-input"]');
    await promptPayAfterReload.waitFor({ state: 'visible', timeout: 15000 });
    const afterValue = await promptPayAfterReload.inputValue();
    expect(afterValue).toContain('X');
    expect(afterValue).toBe(firstValue);
  });

  /**
   * FINAL-009.4 — No payment-save-error on normal load
   * Verifies the error banner is NOT visible when payment data loads normally.
   */
  test('No payment-save-error visible on normal load', async ({ page }) => {
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const settingsNavBtn = page.locator('[data-testid="nav-settings"], a[href*="settings"], button:has-text("ตั้งค่า")').first();
    if (await settingsNavBtn.isVisible()) {
      await settingsNavBtn.click();
      await page.waitForLoadState('networkidle');
    }

    await page.locator('[data-testid="promptpay-input"]').waitFor({ state: 'visible', timeout: 15000 });

    // Error banner should NOT be visible
    const errorBanner = page.locator('[data-testid="payment-save-error"]');
    await expect(errorBanner).not.toBeVisible();
  });
});
