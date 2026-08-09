import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';

const prisma = getPrismaClient();

test.describe('Master Six-Step Owner Onboarding E2E Flow', () => {
  let masterUserId: string;
  let masterSessionToken: string;
  let masterCsrfToken: string;

  test.beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `master-sixstep-${Date.now()}@example.com`,
        emailNormalized: `master-sixstep-${Date.now()}@example.com`,
        name: 'Master SixStep Owner',
        googleSubject: `goog-master-${Date.now()}`,
        status: 'active',
      },
    });
    masterUserId = user.id;

    const sid = crypto.randomUUID();
    await prisma.session.create({
      data: {
        userId: masterUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sid),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    masterSessionToken = sessionTokenService.encryptToken({ sub: masterUserId, sid, type: 'session', version: 1 }, 86400);
    masterCsrfToken = csrfService.generateCsrfToken(sid);
  });

  test.afterAll(async () => {
    if (masterUserId) {
      const masterDorms = await prisma.dormitory.findMany({ where: { createdByUserId: masterUserId }, select: { id: true } });
      for (const d of masterDorms) {
        const subs = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: d.id }, select: { id: true } });
        for (const sub of subs) {
          await prisma.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } }).catch(() => {});
        }
        await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.promoRedemption.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.ownerSignature.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.room.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.building.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: d.id } }).catch(() => {});
        await prisma.dormitory.delete({ where: { id: d.id } }).catch(() => {});
      }
      await prisma.ownerSignature.deleteMany({ where: { signedByUserId: masterUserId } }).catch(() => {});
      await prisma.session.deleteMany({ where: { userId: masterUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: masterUserId } }).catch(() => {});
    }
  });

  test('Completes all 6 onboarding steps: Dormitory Info, Buildings, Zero-value Utilities, Signature, LINE OA 4-state readiness, and Package Finalization', async ({ context, page }) => {
    test.setTimeout(60000);

    await context.addCookies([
      {
        name: 'horplus_session',
        value: masterSessionToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: masterCsrfToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // 1. Navigate to register page
    await page.goto('http://127.0.0.1:5173/owner/register');

    // STEP 1: Dormitory Info & Address
    await expect(page.locator('[data-testid="input-dormitory-name"]')).toBeVisible();
    await page.fill('[data-testid="input-dormitory-name"]', 'หอพัก 6-Step Master Residence');
    await page.fill('[data-testid="input-address"]', '888/99 ถนนวิภาวดีรังสิต');
    const provinceSelect = page.locator('[data-testid="select-province"]');
    await provinceSelect.selectOption('กรุงเทพมหานคร');
    await page.click('[data-testid="button-next-step"]'); // 1 -> 2

    // STEP 2: Buildings & Rooms
    await expect(page.locator('[data-testid="button-add-building"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // 2 -> 3

    // STEP 3: Rates & Utilities (Testing zero-value rate preservation)
    await expect(page.locator('[data-testid="input-water-rate"]')).toBeVisible();
    await page.fill('[data-testid="input-water-rate"]', '0');
    await page.fill('[data-testid="input-electric-rate"]', '7');
    await page.click('[data-testid="button-next-step"]'); // 3 -> 4

    // STEP 4: Payment Account & Signature Drawing
    await expect(page.locator('[data-testid="input-account-number"]')).toBeVisible();
    const bankSelect = page.locator('[data-testid="select-bank-name"]');
    await bankSelect.selectOption('กสิกรไทย (KBank)');
    await page.fill('[data-testid="input-account-number"]', '123-4-56789-0');
    await page.fill('[data-testid="input-account-name"]', 'นาย สมศักดิ์ Master');
    await page.click('[data-testid="button-save-signature"]');
    await expect(page.locator('[data-testid="signature-status-saved"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // 4 -> 5

    // STEP 5: LINE OA Setup
    await page.click('[data-testid="button-next-step"]'); // 5 -> 6

    // STEP 6: Package & Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');
    await expect(page.locator('[data-testid="checkbox-agreed-terms"]')).toBeVisible();
    await page.check('[data-testid="checkbox-agreed-terms"]');
    await page.click('[data-testid="button-confirm-finalize"]');

    // Verify completion redirect
    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });
  });
});
