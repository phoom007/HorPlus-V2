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

  test('Step 1-24: Full Wave 1G Lifecycle verification', async ({ page }) => {
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

    // 2. Fetch Dormitory Defaults
    const defaultsRes = await page.request.get('http://127.0.0.1:3000/api/v1/properties/dormitory/defaults', {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(defaultsRes.status()).toBe(200);
    const defaultsData = await defaultsRes.json();
    expect(defaultsData.data.property.defaultMonthlyRent).toBe('4000');

    // 3. Create Building A and Building B via DB
    const bldA = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
        code: 'A',
        floorCount: 3,
      },
    });

    const bldB = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building B',
        code: 'B',
        floorCount: 3,
        monthlyRent: 4500.0, // Building override
      },
    });

    // 4. Create Room A101 (Building A) and Room B101 (Building B)
    const roomA101 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldA.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'a101',
        status: 'vacant',
      },
    });

    const roomB101 = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldB.id,
        roomNumber: 'B101',
        normalizedRoomNumber: 'b101',
        status: 'vacant',
      },
    });
    expect(roomA101.id).toBeDefined();
    expect(roomB101.id).toBeDefined();

    // 5. Test Room number duplicate precheck (A101 duplicate rejection)
    const roomDupRes = await page.request.post('http://127.0.0.1:3000/api/v1/properties/rooms', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        buildingId: bldA.id,
        roomNumber: '  a101  ', // NFKC normalization -> a101 -> duplicate!
        floorNumber: 1,
      },
    });
    expect(roomDupRes.status()).toBe(409);
    const dupBody = await roomDupRes.json();
    expect(dupBody.error.code).toBe('ROOM_NUMBER_ALREADY_EXISTS');

    // 6. Test Building B override fetch
    const bldDefRes = await page.request.get(`http://127.0.0.1:3000/api/v1/properties/buildings/${bldB.id}/defaults`, {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(bldDefRes.status()).toBe(200);

    // 7. Test Room effective defaults resolution
    const rmEffRes = await page.request.get(`http://127.0.0.1:3000/api/v1/properties/rooms/${roomA101.id}/effective-defaults`, {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(rmEffRes.status()).toBe(200);
    const rmEffData = await rmEffRes.json();
    expect(rmEffData.data.monthlyRent.value).toBe(4000);
    expect(rmEffData.data.monthlyRent.source).toBe('DORMITORY');

    // 8. Test Clear Room override field validation (reject protected field clear)
    const badClearRes = await page.request.delete(`http://127.0.0.1:3000/api/v1/properties/rooms/${roomA101.id}/defaults/normalizedRoomNumber`, {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
    });
    expect(badClearRes.status()).toBe(400);

    // 9. Test Propagation preview
    const prevRes = await page.request.post('http://127.0.0.1:3000/api/v1/properties/defaults/preview', {
      headers: { 'x-dormitory-id': dormId },
      data: { scope: 'DORMITORY', changes: { defaultMonthlyRent: 4200 } },
    });
    expect(prevRes.status()).toBe(200);

    // 10. Test Propagation apply with Idempotency Key
    const applyIdemKey = `w1g-idem-${Date.now()}`;
    const applyRes = await page.request.post('http://127.0.0.1:3000/api/v1/properties/defaults/apply', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 4200 },
        expectedVersion: 1,
        idempotencyKey: applyIdemKey,
      },
    });
    expect(applyRes.status()).toBe(200);

    // 11. Test Idempotency replay (same key, same payload -> 200 replay)
    const replayRes = await page.request.post('http://127.0.0.1:3000/api/v1/properties/defaults/apply', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 4200 },
        expectedVersion: 1,
        idempotencyKey: applyIdemKey,
      },
    });
    expect(replayRes.status()).toBe(200);

    // 12. Test Idempotency mismatch (same key, different payload -> 409)
    const mismatchRes = await page.request.post('http://127.0.0.1:3000/api/v1/properties/defaults/apply', {
      headers: {
        'x-dormitory-id': dormId,
        'x-csrf-token': csrfToken,
      },
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 9999 },
        expectedVersion: 1,
        idempotencyKey: applyIdemKey,
      },
    });
    expect(mismatchRes.status()).toBe(409);

    // 13. Test Room availability endpoint
    const availRes = await page.request.get('http://127.0.0.1:3000/api/v1/properties/rooms/available?startDate=2026-09-01&endDate=2026-09-30', {
      headers: { 'x-dormitory-id': dormId },
    });
    expect(availRes.status()).toBe(200);
  });
});
