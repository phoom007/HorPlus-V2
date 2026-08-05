import { test, expect } from '@playwright/test';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../server/.env') });

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://horplus:password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public',
    },
  },
});

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

test.describe('Wave 1F - Real Subscription & Entitlement Integration (Playwright E2E)', () => {
  let dormId: string;
  let ownerUser: any;
  let sessionToken: string;
  let csrfToken: string;
  let buildingId: string;

  test.beforeAll(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const roleId = crypto.randomUUID();

    let freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      freePlan = await prisma.subscriptionPlan.create({
        data: { code: 'FREE', name: 'Free / Trial', type: 'FREE', roomLimit: 10 },
      });
    }

    let paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) {
      paidPlan = await prisma.subscriptionPlan.create({
        data: { code: 'PAID', name: 'Paid', type: 'PAID', roomLimit: 150 },
      });
    }

    let horplusPromo = await prisma.promoCode.findUnique({ where: { code: 'HORPLUS' } });
    if (!horplusPromo) {
      horplusPromo = await prisma.promoCode.create({
        data: { code: 'HORPLUS', normalizedCode: 'HORPLUS', extensionDays: 60 },
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

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan.id,
        status: 'TRIAL',
        startedAt: now,
        expiresAt: expiresAt,
        trialStartedAt: now,
        trialExpiresAt: expiresAt,
      },
    });

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
    // 1. Authenticate browser context
    await page.context().addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'csrf-token', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      sessionStorage.setItem('active_dormitory_selected_for_session', id);
      localStorage.setItem('selected_dormitory_id', id);
    }, dormId);

    // 2. Open Owner Portal directly on subscription tab
    await page.goto('/owner/subscription');

    // 3. Verify 30-day Trial details
    await expect(page.locator('text=Current Plan')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Free / Trial').first()).toBeVisible();
    await expect(page.getByText('TRIAL', { exact: true })).toBeVisible();

    // 4. Redeem HORPLUS promo code on UI
    const promoInput = page.locator('input[placeholder="Enter promo code"]');
    await expect(promoInput).toBeVisible();
    await promoInput.fill('HORPLUS');
    const redeemBtn = page.locator('button:has-text("Redeem Code")');
    await redeemBtn.click();

    // 5. Verify Trial extension by 60 days
    await expect(page.locator('text=redeemed!')).toBeVisible();

    // 6. Verify button shows Already Redeemed
    await expect(page.locator('button:has-text("Already Redeemed")')).toBeVisible();

    // 7. Test Room limit on Plan A (create 10 rooms via API, 11th should fail)
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

    // Attempt 11th room creation via backend API
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

    // 8. Operational activation to Plan B (Paid)
    const activateBtn = page.locator('button:has-text("Activate 1 Month")');
    await expect(activateBtn).toBeVisible();
    await activateBtn.click();

    await expect(page.locator('text=Activated 1-month Paid Package!')).toBeVisible();
    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();

    // 9. Room creation now succeeds up to 150 on Plan B
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

    // 10. Test Expired Dormitory Read-Only Mode
    const pastDate = new Date(Date.now() - 10000);
    const currentSub = await prisma.dormitorySubscription.findUnique({ where: { dormitoryId: dormId } });
    await prisma.dormitorySubscription.update({
      where: { id: currentSub!.id },
      data: { expiresAt: pastDate },
    });

    // Reload page to refresh UI state
    await page.reload();

    // Verify Read-Only banner is displayed
    await expect(page.locator('text=READ_ONLY Mode Active')).toBeVisible();

    // Verify business mutation API returns SUBSCRIPTION_READ_ONLY (403)
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

    // Verify GET/read-only access remains 100% functional
    const getRoomsRes = await page.request.get('/api/v1/properties/rooms', {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(getRoomsRes.status()).toBe(200);
    const getRoomsBody = await getRoomsRes.json();
    expect(getRoomsBody.data).toBeDefined();
  });
});
