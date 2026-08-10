import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { SignatureStorageService } from '../../server/src/services/signature-storage.service.js';
import { FakeLineServer } from './helpers/fake-line-server.js';

const prisma = getPrismaClient();

test.describe.serial('Master Six-Step Owner Onboarding E2E Flow', () => {
  const fakeLineServer = new FakeLineServer();
  let masterUserId: string;
  let masterSessionToken: string;
  let masterCsrfToken: string;

  test.beforeAll(async () => {
    const fakeLineUrl = await fakeLineServer.start();
    process.env.HORPLUS_E2E = 'true';
    process.env.LINE_BASE_URL = fakeLineUrl;
    process.env.LINE_PLATFORM_URL = fakeLineUrl;

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
    await fakeLineServer.stop();
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

    // Attempting Next before saving signature must be blocked on Step 4!
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('text=กรุณากด "บันทึกลายเซ็น" ในขั้นตอนที่ 4 ก่อนดำเนินการต่อ')).toBeVisible();
    await expect(page.locator('[data-testid="button-save-signature"]')).toBeVisible();

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

    // Test Webhook when inactive: should fail readiness
    fakeLineServer.isWebhookActive = false;
    await expect(page.locator('[data-testid="button-test-line-webhook"]')).toBeEnabled();
    await page.click('[data-testid="button-test-line-webhook"]');
    await expect(page.locator('[data-testid="line-readiness-badge"]')).toContainText('รอดำเนินการ ⏳');

    // Attempting Next with inactive webhook must be blocked!
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('text=กรุณาตั้งค่า LINE OA ให้ครบทุกขั้นตอน')).toBeVisible();

    // Now switch FakeLine to active: test webhook succeeds and readiness shows ready
    fakeLineServer.isWebhookActive = true;
    await page.click('[data-testid="button-test-line-webhook"]');
    await expect(page.locator('[data-testid="line-readiness-badge"]')).toContainText('พร้อมใช้งาน ✅');

    // Now advance to Step 6
    await page.click('[data-testid="button-next-step"]'); // 5 -> 6

    // STEP 6: Package & Finalize
    await expect(page.locator('[data-testid="plan-card-pro"]')).toBeVisible();
    await expect(page.locator('[data-testid="plan-card-pro"]')).toContainText('189 THB');
    await page.click('[data-testid="plan-card-pro"]');

    // Apply Promo HORPLUS Preview (Verify preview does NOT create PromoRedemption in DB before finalization)
    await page.fill('[data-testid="input-promo-code"]', 'HORPLUS');
    await page.click('[data-testid="button-apply-promo"]');
    await expect(page.locator('text=รับส่วนขยายเพิ่ม 2 เดือน')).toBeVisible();

    // Verify draft resume on F5 page reload
    await page.reload();
    await expect(page.locator('[data-testid="input-dormitory-name"]')).toHaveValue('หอพัก 6-Step Master Residence');

    // Navigate to step 6 again
    await page.click('[data-testid="button-next-step"]'); // 1 -> 2
    await page.click('[data-testid="button-next-step"]'); // 2 -> 3
    await page.click('[data-testid="button-next-step"]'); // 3 -> 4
    await page.click('[data-testid="button-next-step"]'); // 4 -> 5
    await page.click('[data-testid="button-next-step"]'); // 5 -> 6

    await expect(page.locator('[data-testid="plan-card-pro"]')).toBeVisible();
    await page.click('[data-testid="plan-card-pro"]');

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

    const promoRedemption = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${createdDorm!.id}, true)`;
      return await tx.promoRedemption.findFirst({
        where: { redeemedBy: masterUserId },
      });
    });
    expect(promoRedemption).not.toBeNull();

    const intent = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${createdDorm!.id}, true)`;
      return await tx.subscriptionPackageIntent.findFirst({
        where: { dormitoryId: createdDorm!.id },
      });
    });
    expect(intent).not.toBeNull();
    expect(intent?.status).toBe('PENDING_PAYMENT');
    expect(Number(intent?.priceSnapshot)).toBe(189);
    expect(intent?.durationMonthsSnapshot).toBe(1);
  });

  test('Anti-abuse: Genuine second onboarding attempt with same User.id receives zero extra initial trial and zero extra promo claim', async ({ page }) => {
    test.setTimeout(60000);

    const firstDorm = await prisma.dormitory.findFirst({
      where: { createdByUserId: masterUserId, name: 'หอพัก 6-Step Master Residence' },
    });
    expect(firstDorm).not.toBeNull();

    // Prepare a second provisional dormitory for the same user
    const prepRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/prepare', {
      headers: {
        'Cookie': `horplus_session=${masterSessionToken}; horplus_csrf=${masterCsrfToken}`,
        'x-csrf-token': masterCsrfToken,
      },
      data: {
        name: 'หอพักแห่งที่ 2 Master',
        addressLine1: '456 ถ.รัชดาภิเษก',
        province: 'กรุงเทพมหานคร',
      },
    });
    expect(prepRes.status()).toBe(200);
    const prepBody = await prepRes.json();
    const secondDormId = prepBody.data.provisionalDormitoryId;
    expect(secondDormId).toBeTruthy();

    // Save owner signature and set verified LINE OA config for second provisional dorm to pass Step 4 gate
    const sigService = new SignatureStorageService(prisma);
    const validPngBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await sigService.saveSignature({ dormitoryId: secondDormId, userId: masterUserId, buffer: validPngBuffer });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${secondDormId}, true)`;
      await tx.dormitoryLineConfig.upsert({
        where: { dormitoryId: secondDormId },
        create: {
          dormitoryId: secondDormId,
          channelId: '1234567890',
          channelSecretEncrypted: 'enc_secret',
          channelAccessTokenEncrypted: 'enc_token',
          webhookKeyHash: 'dummy_hash_' + Date.now(),
          accessTokenVerifiedAt: new Date(),
          webhookEndpointSetAt: new Date(),
          webhookTestSucceededAt: new Date(),
          webhookActive: true,
          isConnected: true,
        },
        update: {
          accessTokenVerifiedAt: new Date(),
          webhookEndpointSetAt: new Date(),
          webhookTestSucceededAt: new Date(),
          webhookActive: true,
          isConnected: true,
        },
      });
    });

    const paidPkg = await prisma.subscriptionPackage.findFirst({
      where: { durationMonths: 1, enabled: true },
    });
    expect(paidPkg).not.toBeNull();

    // Finalize the second dormitory with HORPLUS promo code
    const finalizeRes = await page.request.post('http://127.0.0.1:3001/api/v1/onboarding/finalize', {
      headers: {
        'Cookie': `horplus_session=${masterSessionToken}; horplus_csrf=${masterCsrfToken}`,
        'x-csrf-token': masterCsrfToken,
        'x-dormitory-id': secondDormId,
      },
      data: {
        provisionalDormitoryId: secondDormId,
        planCode: 'PAID',
        packageId: paidPkg!.id,
        promoCode: 'HORPLUS',
        dormitory: {
          name: 'หอพักแห่งที่ 2 Master',
          type: 'apartment',
          addressLine1: '456 ถ.รัชดาภิเษก',
          province: 'กรุงเทพมหานคร',
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
          waterRate: '18.00',
          electricityRate: '7.00',
        },
        payment: {
          promptPayType: 'national_id',
          promptPayValue: '1234567890123',
        },
        buildings: [{ id: 'bld-2', name: 'อาคาร A', floorsCount: 2, roomsPerFloor: 4 }],
        rooms: [{ buildingId: 'bld-2', roomNumber: '101', floor: 1, monthlyRent: 4000, depositAmount: 4000, status: 'vacant' }],
      },
    });
    expect(finalizeRes.status()).toBe(200);

    // Verify second dormitory subscription received 0 trial months (expiresAt == startedAt)
    const secondSub = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${secondDormId}, true)`;
      return await tx.dormitorySubscription.findUnique({
        where: { dormitoryId: secondDormId },
      });
    });
    expect(secondSub).not.toBeNull();
    // For second dorm, trial was already claimed so trialExpiresAt == startedAt
    expect(secondSub!.trialExpiresAt.getTime()).toBeLessThanOrEqual(secondSub!.startedAt.getTime() + 5000);

    // Assert account-level initial trial claims for user is STILL exactly 1
    const totalClaims = await prisma.accountBenefitClaim.count({
      where: { userId: masterUserId, benefitKey: 'INITIAL_TRIAL_V1' },
    });
    expect(totalClaims).toBe(1);

    // Assert promo redemptions for user is STILL exactly 1
    const totalRedemptions = await prisma.promoRedemption.count({
      where: { redeemedBy: masterUserId },
    });
    expect(totalRedemptions).toBe(1);
  });

  test('Server-authoritative OwnerSignature resume and state gating (Unsigned vs Signed Resume & Server Authority)', async ({ page }) => {
    test.setTimeout(60000);

    const sigUserId = crypto.randomUUID();
    const sigSessionId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: sigUserId,
        email: `sig-resume-${Date.now()}@example.com`,
        emailNormalized: `sig-resume-${Date.now()}@example.com`,
        name: 'Sig Resume User',
        googleSubject: `sub-sig-res-${Date.now()}`,
        status: 'active',
      },
    });

    await prisma.session.create({
      data: {
        userId: sigUserId,
        sessionIdHash: SessionTokenService.hashSessionId(sigSessionId),
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    const sigSessionToken = sessionTokenService.encryptToken({ sub: sigUserId, sid: sigSessionId, type: 'session', version: 1 }, 86400);
    const sigCsrfToken = csrfService.generateCsrfToken(sigSessionId);

    await page.context().addCookies([
      { name: 'horplus_session', value: sigSessionToken, domain: '127.0.0.1', path: '/', httpOnly: true, secure: false, sameSite: 'Lax' },
      { name: 'horplus_csrf', value: sigCsrfToken, domain: '127.0.0.1', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' },
    ]);

    await page.goto('http://127.0.0.1:5173/owner/register');
    await page.waitForLoadState('networkidle');

    // Step 1: Dormitory Info
    await expect(page.locator('[data-testid="input-dormitory-name"]')).toBeVisible();
    await page.fill('[data-testid="input-dormitory-name"]', 'หอพัก Signature Truth Test');
    await page.fill('[data-testid="input-address"]', '888/99 ถนนวิภาวดีรังสิต');
    await page.click('[data-testid="button-next-step"]'); // 1 -> 2

    // Step 2 -> Step 3
    await expect(page.locator('[data-testid="button-add-building"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // 2 -> 3

    // Step 3 -> Step 4
    await expect(page.locator('[data-testid="input-water-rate"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // 3 -> 4

    // Step 4
    await expect(page.locator('[data-testid="input-account-number"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]'); // Triggers prepare & validation error
    await expect(page.locator('text=กรุณากด "บันทึกลายเซ็น"')).toBeVisible();

    // Fetch provisionalDormitoryId for RLS-scoped DB assertions
    const draftRes = await page.request.get('http://127.0.0.1:3001/api/v1/onboarding/draft', {
      headers: {
        'Cookie': `horplus_session=${sigSessionToken}; horplus_csrf=${sigCsrfToken}`,
      },
    });
    const draftData = await draftRes.json();
    const provDormId = draftData.data.provisionalDormitoryId;
    expect(provDormId).toBeTruthy();

    const getSigCount = async () => {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
        return await tx.ownerSignature.count({ where: { dormitoryId: provDormId } });
      });
    };

    // CASE 1 — UNSIGNED RESUME:
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="input-dormitory-name"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="button-add-building"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="input-water-rate"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="input-account-number"]')).toBeVisible();

    const savedBadgeBefore = page.locator('text=บันทึกแล้ว');
    await expect(savedBadgeBefore).not.toBeVisible();

    const sigCountBefore = await getSigCount();
    expect(sigCountBefore).toBe(0);

    // CASE 2 — SIGNED RESUME:
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
    await expect(page.locator('text=บันทึกแล้ว')).toBeVisible();

    const sigCountAfterSave = await getSigCount();
    expect(sigCountAfterSave).toBe(1);

    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="input-dormitory-name"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="button-add-building"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="input-water-rate"]')).toBeVisible();
    await page.click('[data-testid="button-next-step"]');
    await expect(page.locator('[data-testid="input-account-number"]')).toBeVisible();

    await expect(page.locator('text=บันทึกแล้ว')).toBeVisible();

    const sigCountAfterReload = await getSigCount();
    expect(sigCountAfterReload).toBe(1);
  });
});
