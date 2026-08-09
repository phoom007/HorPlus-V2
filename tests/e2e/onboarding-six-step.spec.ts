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
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${d.id}, true)`;
          const subs = await tx.dormitorySubscription.findMany({ where: { dormitoryId: d.id }, select: { id: true } });
          for (const sub of subs) {
            await tx.subscriptionStatusHistory.deleteMany({ where: { subscriptionId: sub.id } });
          }
          await tx.accountBenefitClaim.deleteMany({ where: { dormitoryId: d.id } });
          await tx.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: d.id } });
          await tx.ownerSignature.deleteMany({ where: { dormitoryId: d.id } });
          await tx.promoRedemption.deleteMany({ where: { dormitoryId: d.id } });
          await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: d.id } });
          await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: d.id } });
          await tx.room.deleteMany({ where: { dormitoryId: d.id } });
          await tx.building.deleteMany({ where: { dormitoryId: d.id } });
          await tx.dormitoryMember.deleteMany({ where: { dormitoryId: d.id } });
          await tx.dormitoryLineConfig.deleteMany({ where: { dormitoryId: d.id } });
          await tx.dormitory.delete({ where: { id: d.id } });
        }).catch(() => {});
      }
      await prisma.session.deleteMany({ where: { userId: masterUserId } }).catch(() => {});
      await prisma.user.delete({ where: { id: masterUserId } }).catch(() => {});
    }
  });

  test('Completes all 6 onboarding steps: Dormitory Info, Buildings, Zero-value Utilities, Signature strokes, LINE OA 4-state readiness, and Package Finalization with DB assertions', async ({ context, page }) => {
    test.setTimeout(90000);

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

    // Draw real strokes on canvas to satisfy non-blank pixel threshold
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
    await expect(page.locator('[data-testid="signature-status-saved"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // 4 -> 5

    // STEP 5: LINE OA Setup
    await expect(page.locator('[data-testid="input-line-channel-id"]')).toBeVisible();

    // Assert NO Basic ID or Channel Access Token input fields
    await expect(page.locator('input[placeholder*="Channel Access Token"]')).toHaveCount(0);
    await expect(page.locator('input[placeholder*="Basic ID"]')).toHaveCount(0);

    // Attempting Next before setup must be blocked!
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('text=กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอน')).toBeVisible();

    // Fill LINE Channel ID and Channel Secret
    await page.fill('[data-testid="input-line-channel-id"]', '1650000001');
    await page.fill('[data-testid="input-line-channel-secret"]', 'secret_key_12345');
    await page.click('[data-testid="button-save-line-credentials"]');

    // Set Webhook
    await expect(page.locator('[data-testid="button-set-line-webhook"]')).toBeEnabled();
    await page.click('[data-testid="button-set-line-webhook"]');

    // Test Webhook
    await expect(page.locator('[data-testid="button-test-line-webhook"]')).toBeEnabled();
    await page.click('[data-testid="button-test-line-webhook"]');

    // Assert LINE readiness badge
    await expect(page.locator('[data-testid="line-readiness-badge"]')).toContainText('พร้อมใช้งาน ✅');

    // Now advance to Step 6
    await page.click('[data-testid="button-next-step"]'); // 5 -> 6

    // STEP 6: Package & Finalize
    await expect(page.locator('[data-testid="plan-card-pro"]')).toBeVisible();
    await page.click('[data-testid="plan-card-pro"]');

    // Apply Promo HORPLUS
    await page.fill('[data-testid="input-promo-code"]', 'HORPLUS');
    await page.click('[data-testid="button-apply-promo"]');
    await expect(page.locator('text=รับส่วนขยายเพิ่ม 2 เดือน')).toBeVisible();

    // Finalize
    await page.click('[data-testid="button-finalize-onboarding"]');
    await expect(page.locator('[data-testid="checkbox-agreed-terms"]')).toBeVisible();
    await page.check('[data-testid="checkbox-agreed-terms"]');
    await page.click('[data-testid="button-confirm-finalize"]');

    // Verify completion redirect
    await page.waitForURL('**/owner/dashboard', { timeout: 25000 });

    // DB Assertions
    const createdDorm = await prisma.dormitory.findFirst({
      where: { createdByUserId: masterUserId, name: 'หอพัก 6-Step Master Residence' },
    });
    expect(createdDorm).not.toBeNull();
    expect(createdDorm?.status).toBe('active');

    const sub = await prisma.dormitorySubscription.findUnique({
      where: { dormitoryId: createdDorm!.id },
    });
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe('TRIAL');

    const trialClaim = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${createdDorm!.id}, true)`;
      return await tx.accountBenefitClaim.findFirst({
        where: { userId: masterUserId, benefitKey: 'INITIAL_TRIAL_V1' },
      });
    });
    expect(trialClaim).not.toBeNull();
    expect(trialClaim?.grantedMonths).toBe(1);

    const intent = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${createdDorm!.id}, true)`;
      return await tx.subscriptionPackageIntent.findFirst({
        where: { dormitoryId: createdDorm!.id },
      });
    });
    expect(intent).not.toBeNull();
    expect(intent?.status).toBe('PENDING_PAYMENT');
  });
});
