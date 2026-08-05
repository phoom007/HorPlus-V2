import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';
import crypto from 'crypto';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

const prisma = new PrismaClient();

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

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

test.describe('Wave 1F - Subscription & Entitlement Playwright E2E Suite', () => {
  let dormId: string;
  let ownerUser: any;
  let sessionToken: string;
  let csrfToken: string;
  let buildingId: string;

  test.beforeAll(async () => {
    process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';

    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const roleId = crypto.randomUUID();

    await subscriptionEntitlementService.ensureSeeded();

    let paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) {
      paidPlan = await prisma.subscriptionPlan.create({
        data: { code: 'PAID', name: 'Paid', type: 'PAID', roomLimit: 150 },
      });
    }

    let paidPkg = await prisma.subscriptionPackage.findFirst({ where: { planId: paidPlan.id, durationMonths: 1 } });
    if (!paidPkg) {
      paidPkg = await prisma.subscriptionPackage.create({
        data: { planId: paidPlan.id, durationMonths: 1, price: 189.00, currency: 'THB', enabled: true },
      });
    }

    ownerUser = await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `sub-e2e-owner-${timestamp}`,
        email: `e2e-owner-${timestamp}@horplus.com`,
        emailNormalized: `e2e-owner-${timestamp}@horplus.com`,
        name: 'E2E Owner Tester',
      },
    });

    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: `Dormitory E2E Sub ${timestamp}`,
        code: `DORM-${timestamp}`,
        addressLine1: '123 Rama IX Rd',
        postalCode: '10110',
        phone: '0812345678',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });

    const role = await prisma.role.create({
      data: {
        id: roleId,
        dormitoryId: dormId,
        name: 'Owner',
        code: 'OWNER',
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: role.id,
        status: 'active',
      },
    });

    // Provision initial trial using authoritative entitlement service
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
      },
    });
    buildingId = building.id;

    const sessionIdHash = crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');

    await prisma.session.create({
      data: {
        id: crypto.randomUUID(),
        userId: ownerUserId,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    sessionToken = encryptSessionToken(ownerUserId, sessionId);
    csrfToken = generateCsrfToken(sessionId);
  });

  test('Owner subscription & entitlement full lifecycle', async ({ page }) => {
    test.setTimeout(60000);

    // 1. Assert zero newly created legacy PlatformSubscription records for this dorm
    const legacyCount = await prisma.platformSubscription.count({ where: { dormitoryId: dormId } });
    expect(legacyCount).toBe(0);

    // 2. Assert exactly one authoritative DormitorySubscription and status history
    const subCount = await prisma.dormitorySubscription.count({ where: { dormitoryId: dormId } });
    expect(subCount).toBe(1);

    const historyCount = await prisma.subscriptionStatusHistory.count({ where: { dormitoryId: dormId } });
    expect(historyCount).toBe(1);

    // 3. Authenticate browser context
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'csrf-token', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      sessionStorage.setItem('active_dormitory_selected_for_session', id);
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    // 4. Open Owner Portal directly on subscription tab
    await page.goto('/owner/subscription');

    // 5. Verify 30-day Trial details
    await expect(page.locator('text=Current Plan')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Free / Trial').first()).toBeVisible();
    await expect(page.getByText('TRIAL', { exact: true })).toBeVisible();

    // 6. Redeem HORPLUS promo code on UI
    const promoInput = page.locator('input[placeholder="Enter promo code"]');
    await expect(promoInput).toBeVisible();
    await promoInput.fill('HORPLUS');
    const redeemBtn = page.locator('button:has-text("Redeem Code")');
    await redeemBtn.click();

    // 7. Verify Trial extension by 60 days
    await expect(page.locator('text=redeemed!')).toBeVisible();
    await expect(page.locator('button:has-text("Already Redeemed")')).toBeVisible();
    await expect(page.locator('text=Awaiting platform activation').first()).toBeVisible();

    // 8. Test Free Plan room limit (seed 10 rooms, 11th should return 409 ROOM_LIMIT_REACHED)
    for (let i = 1; i <= 10; i++) {
      const num = `E2E-R${i}`;
      await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: buildingId,
          roomNumber: num,
          normalizedRoomNumber: num,
          floor: 1,
        },
      });
    }

    const room11Res = await page.request.post('/api/v1/properties/rooms', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        buildingId: buildingId,
        roomNumber: 'E2E-R11',
      },
    });

    expect(room11Res.status()).toBe(409);
    const room11Body = await room11Res.json();
    expect(room11Body.error.code).toBe('ROOM_LIMIT_REACHED');

    // 9. Operational activation to Paid plan using internal service (NOT HTTP route)
    await subscriptionEntitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUser.id,
      idempotencyKey: `e2e-op-activate-${Date.now()}`,
    });

    // 10. Verify Paid entitlements via API
    const paidEntRes = await page.request.get('/api/v1/subscription/entitlements', {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(paidEntRes.status()).toBe(200);
    const paidEntBody = await paidEntRes.json();
    expect(paidEntBody.data.plan.code).toBe('PAID');
    expect(paidEntBody.data.roomLimit).toBe(150);

    // 11. Room creation now succeeds on Paid Plan
    const room11PaidRes = await page.request.post('/api/v1/properties/rooms', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        buildingId: buildingId,
        roomNumber: 'E2E-R11',
      },
    });
    expect(room11PaidRes.status()).toBe(201);

    // 12. Verify removed operational route returns 404 ROUTE_NOT_FOUND
    const removedRouteRes = await page.request.post('/api/v1/subscription/operational/activate', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: { durationMonths: 1 },
    });
    expect(removedRouteRes.status()).toBe(404);

    // 13. Expire subscription in PostgreSQL and verify Read-Only Mode
    const pastDate = new Date(Date.now() - 10000);
    const currentSub = await prisma.dormitorySubscription.findUnique({ where: { dormitoryId: dormId } });
    await prisma.dormitorySubscription.update({
      where: { id: currentSub!.id },
      data: { expiresAt: pastDate },
    });

    await page.reload();
    await expect(page.locator('text=READ_ONLY Mode Active')).toBeVisible();

    // Business mutations return HTTP 403 SUBSCRIPTION_READ_ONLY
    const mutationRes = await page.request.post('/api/v1/properties/rooms', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        buildingId: buildingId,
        roomNumber: 'E2E-R12',
      },
    });

    expect(mutationRes.status()).toBe(403);
    const mutationBody = await mutationRes.json();
    expect(mutationBody.error.code).toBe('SUBSCRIPTION_READ_ONLY');

    // GET / Read Operations remain 100% functional
    const getRoomsRes = await page.request.get('/api/v1/properties/rooms', {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(getRoomsRes.status()).toBe(200);
    const getRoomsBody = await getRoomsRes.json();
    expect(getRoomsBody.data).toBeDefined();

    // 14. Cross-Dormitory subscription access is denied
    const otherDormId = crypto.randomUUID();
    const crossRes = await page.request.get('/api/v1/subscription/current', {
      headers: { 'x-dormitory-id': otherDormId },
    });
    expect(crossRes.status()).toBe(403);
  });
});
