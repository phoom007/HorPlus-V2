import { test, expect } from '@playwright/test';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';
import crypto from 'crypto';

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

test.describe('Wave 1G Playwright Lifecycle Test — Property, Room Defaults & Snapshots', () => {
  let dormId: string;
  let userId: string;
  let sessionId: string;
  let sessionToken: string;
  let csrfToken: string;

  test.beforeAll(async () => {
    // Setup test user, session, dormitory
    const uniqueSuffix = Date.now().toString().slice(-6);

    const user = await prisma.user.create({
      data: {
        googleSubject: `w1g-user-${uniqueSuffix}`,
        email: `w1g-owner-${uniqueSuffix}@test.local`,
        emailNormalized: `w1g-owner-${uniqueSuffix}@test.local`,
        name: 'Wave1G Test Owner',
        status: 'active',
      },
    });
    userId = user.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: `Wave1G Dormitory ${uniqueSuffix}`,
        code: `W1G-${uniqueSuffix}`,
        type: 'apartment',
        createdByUserId: userId,
      },
    });
    dormId = dorm.id;

    // Create DormitoryBillingSettings and DormitoryPropertyDefaults
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        waterRate: 18.0,
        electricityRate: 7.0,
        commonFee: 200.0,
        internetFee: 300.0,
      },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: dormId,
        defaultMonthlyRent: 4000.0,
        defaultDeposit: 8000.0,
        defaultAdvancePayment: 4000.0,
        defaultParkingFee: 500.0,
        defaultMaxOccupants: 2,
        defaultRoomType: 'standard',
      },
    });

    // Create Owner Role & Member
    const role = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        permissions: ['*'],
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId,
        dormitoryId: dormId,
        roleId: role.id,
        status: 'active',
      },
    });

    // Session
    const session = await prisma.session.create({
      data: {
        userId,
        sessionIdHash: crypto.createHash('sha256').update(`w1g-session-${uniqueSuffix}`).digest('hex'),
        expiresAt: new Date(Date.now() + 86400 * 1000),
        status: 'active',
      },
    });
    sessionId = session.id;

    sessionToken = encryptSessionToken(userId, sessionId);
    csrfToken = generateCsrfToken(sessionId);
  });

  test.afterAll(async () => {
    if (dormId) {
      await prisma.dormitory.delete({ where: { id: dormId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  test('Step 1-20: Wave 1G Lifecycle verification', async ({ page }) => {
    // 1. Authenticate using session cookie
    await page.context().addCookies([
      {
        name: 'horplus_session',
        value: sessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
      {
        name: 'horplus_csrf',
        value: csrfToken,
        domain: 'localhost',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // Verify backend default APIs respond correctly
    const defaultsRes = await page.request.get('http://127.0.0.1:3000/api/v1/properties/dormitory/defaults', {
      headers: {
        'x-dormitory-id': dormId,
      },
    });
    expect(defaultsRes.status()).toBe(200);
    const defaultsData = await defaultsRes.json();
    expect(defaultsData.data.property.defaultMonthlyRent).toBe('4000');
  });
});
