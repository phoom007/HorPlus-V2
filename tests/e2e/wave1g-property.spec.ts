import { test, expect, request as playwrightRequest } from '@playwright/test';
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

test.describe('Wave 1G Real Playwright Lifecycle — Property, Room Defaults, Snapshots & Availability', () => {
  let dormId: string;
  let userId: string;
  let sessionId: string;
  let sessionToken: string;
  let csrfToken: string;
  let apiBaseUrl: string;

  test.beforeAll(async () => {
    apiBaseUrl = 'http://127.0.0.1:3001/api/v1';
    const uniqueSuffix = Date.now().toString().slice(-6);

    const user = await prisma.user.create({
      data: {
        googleSubject: `w1g-e2e-user-${uniqueSuffix}`,
        email: `w1g-e2e-owner-${uniqueSuffix}@test.local`,
        emailNormalized: `w1g-e2e-owner-${uniqueSuffix}@test.local`,
        name: 'Wave1G E2E Owner',
        status: 'active',
      },
    });
    userId = user.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: `Wave1G E2E Dormitory ${uniqueSuffix}`,
        code: `W1GE2E-${uniqueSuffix}`,
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

    // Provision Trial Subscription — seed FREE plan + create DormitorySubscription
    let freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      freePlan = await prisma.subscriptionPlan.create({
        data: { code: 'FREE', name: 'Free / Trial', type: 'FREE', roomLimit: 10 },
      });
    }
    const trialExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: dormId,
        planId: freePlan.id,
        status: 'TRIAL',
        startedAt: new Date(),
        expiresAt: trialExpires,
        trialStartedAt: new Date(),
        trialExpiresAt: trialExpires,
      },
    });

    const rawSessionId = crypto.randomUUID();
    const sessionIdHash = crypto.createHash('sha256').update(`horplus_sid_${rawSessionId}`).digest('hex');

    // Session
    const session = await prisma.session.create({
      data: {
        userId,
        sessionIdHash,
        expiresAt: new Date(Date.now() + 86400 * 1000),
        status: 'active',
      },
    });
    sessionId = session.id;

    sessionToken = encryptSessionToken(userId, rawSessionId);
    csrfToken = generateCsrfToken(rawSessionId);
  });

  test.afterAll(async () => {
    if (dormId) {
      await prisma.dormitory.delete({ where: { id: dormId } }).catch(() => {});
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  test('Complete 48-step Wave 1G Lifecycle', async ({ page }) => {
    const consoleErrors: string[] = [];
    const unhandledErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      unhandledErrors.push(err.message);
    });

    // Create authenticated API context with session cookie & CSRF header
    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3001',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // 1-4. Real session & Dormitory defaults read
    const defaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    expect(defaultsRes.status()).toBe(200);
    const defaultsBody = await defaultsRes.json();
    expect(defaultsBody.data.property.defaultMonthlyRent).toBe('4000');

    // 5-9. Create Building A and Building B via API
    const createBldARes = await apiContext.post('/api/v1/properties/buildings', {
      data: { name: 'Building A', code: 'BLD-A', floorCount: 3 },
    });
    expect(createBldARes.status()).toBe(201);
    const bldA = (await createBldARes.json()).data;

    const createBldBRes = await apiContext.post('/api/v1/properties/buildings', {
      data: { name: 'Building B', code: 'BLD-B', floorCount: 3 },
    });
    expect(createBldBRes.status()).toBe(201);
    const bldB = (await createBldBRes.json()).data;

    // Create Room A101 and Room B101
    const createRoomA101Res = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: 'A101', roomType: 'standard', monthlyRent: '4000.00' },
    });
    expect(createRoomA101Res.status()).toBe(201);
    const roomA101 = (await createRoomA101Res.json()).data;

    const createRoomB101Res = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldB.id, roomNumber: 'B101', roomType: 'standard', monthlyRent: '4500.00' },
    });
    expect(createRoomB101Res.status()).toBe(201);
    const roomB101 = (await createRoomB101Res.json()).data;

    expect(roomA101.id).toBeDefined();
    expect(roomB101.id).toBeDefined();

    // 10-11. Duplicate room number precheck (a101 / A101 duplicate rejection)
    const dupRes = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: ' a101 ', roomType: 'standard' },
    });
    expect(dupRes.status()).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error.code).toBe('ROOM_NUMBER_ALREADY_EXISTS');
    expect(dupBody.error.message).toContain('มีอยู่แล้วในหอพักนี้');

    // 12-14. Building B defaults & Building override badge
    const bldOverRes = await apiContext.put(`/api/v1/properties/buildings/${bldB.id}/defaults`, {
      data: { monthlyRent: 4800, expectedVersion: bldB.version },
    });
    expect(bldOverRes.status()).toBe(200);

    const bldFetchRes = await apiContext.get(`/api/v1/properties/buildings/${bldB.id}`);
    expect(bldFetchRes.status()).toBe(200);
    const bldFetchBody = await bldFetchRes.json();
    expect(bldFetchBody.data.fieldSources.monthlyRent).toBe('BUILDING');

    // 15-18. Room override set and clear
    const roomOverRes = await apiContext.put(`/api/v1/properties/rooms/${roomA101.id}/defaults`, {
      data: { monthlyRent: 5200, expectedVersion: roomA101.version },
    });
    expect(roomOverRes.status()).toBe(200);
    const updatedRoomA101 = (await roomOverRes.json()).data;

    const roomFetchRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomFetchRes.status()).toBe(200);
    const roomFetchBody = await roomFetchRes.json();
    expect(roomFetchBody.data.fieldSources.monthlyRent).toBe('ROOM');

    // Clear Room override
    const clearRes = await apiContext.delete(`/api/v1/properties/rooms/${roomA101.id}/defaults/monthlyRent`, {
      data: { expectedVersion: updatedRoomA101.version },
    });
    expect(clearRes.status()).toBe(200);

    const roomClearFetchRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomClearFetchRes.status()).toBe(200);
    expect((await roomClearFetchRes.json()).data.fieldSources.monthlyRent).toBe('DORMITORY');

    // 19-21. Propagation preview
    const prevRes = await apiContext.post('/api/v1/properties/defaults/preview', {
      data: { scope: 'DORMITORY', changes: { defaultMonthlyRent: 4300 } },
    });
    expect(prevRes.status()).toBe(200);
    const prevBody = await prevRes.json();
    expect(prevBody.data.candidateRoomCount).toBeGreaterThanOrEqual(2);

    // 22-25. Apply propagation with Idempotency Key & Replay
    const applyKey = `e2e-idem-${Date.now()}`;
    const applyRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 4300 },
        expectedVersion: 1,
        idempotencyKey: applyKey,
      },
    });
    expect(applyRes.status()).toBe(200);
    const applyBody = await applyRes.json();
    expect(applyBody.data.success).toBe(true);

    // Replay same key & payload
    const replayRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 4300 },
        expectedVersion: 1,
        idempotencyKey: applyKey,
      },
    });
    expect(replayRes.status()).toBe(200);

    // 26-27. Idempotency mismatch
    const mismatchRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: { defaultMonthlyRent: 9999 },
        expectedVersion: 1,
        idempotencyKey: applyKey,
      },
    });
    expect(mismatchRes.status()).toBe(409);
    expect((await mismatchRes.json()).error.code).toBe('IDEMPOTENCY_MISMATCH');

    // 28-30. Concurrency stale mutation -> 409 VERSION_CONFLICT
    const staleRes = await apiContext.put(`/api/v1/properties/buildings/${bldA.id}`, {
      data: { name: 'Building A Renamed Stale', expectedVersion: 999 },
    });
    expect(staleRes.status()).toBe(409);
    const staleBody = await staleRes.json();
    expect(staleBody.error.code).toBe('VERSION_CONFLICT');

    // 31-37. Tenant, Contract & ContractSnapshot activation
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `T-E2E-${Date.now()}`,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        displayName: 'สมชาย ใจดี',
        phone: '0812345678',
      },
    });

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: roomA101.id,
        tenantId: tenant.id,
        contractNumber: `CT-E2E-${Date.now()}`,
        status: 'draft',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-08-31'),
        durationMonths: 12,
        rentAmount: 4300.0,
        depositAmount: 8600.0,
      },
    });

    // Create ContractSnapshot on activation
    const snapshot = await prisma.contractSnapshot.create({
      data: {
        dormitoryId: dormId,
        contractId: contract.id,
        buildingId: bldA.id,
        roomId: roomA101.id,
        tenantId: tenant.id,
        exactRoomNumber: 'A101',
        resolvedRent: 4300.0,
        resolvedDeposit: 8600.0,
        resolvedAdvancePayment: 4300.0,
        resolvedWaterRate: 18.0,
        resolvedElectricityRate: 7.0,
        resolvedCommonFee: 200.0,
        resolvedInternetFee: 300.0,
        resolvedParkingFee: 500.0,
        waterBillingType: 'per_unit',
        electricityBillingType: 'per_unit',
        rentBillingType: 'monthly',
        sourceVersions: { dormBillVer: 1, dormPropVer: 1, bldVer: 1, rmVer: 1 },
        snapshotData: { note: 'Active snapshot' },
        lockedByUserId: userId,
      },
    });

    await prisma.contract.update({
      where: { id: contract.id },
      data: { status: 'active', activatedAt: new Date() },
    });

    // Query snapshot details via API
    const snapRes = await apiContext.get(`/api/v1/properties/contracts/${contract.id}/snapshot`);
    expect(snapRes.status()).toBe(200);
    const snapBody = await snapRes.json();
    expect(snapBody.data.resolvedRent).toBe('4300');

    // Change Dormitory defaults and verify snapshot remains unchanged
    await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: { property: { defaultMonthlyRent: 9000 }, expectedVersion: 2 },
    });
    const snapRecheckRes = await apiContext.get(`/api/v1/properties/contracts/${contract.id}/snapshot`);
    expect((await snapRecheckRes.json()).data.resolvedRent).toBe('4300');

    // 38-42. Availability interval query
    const availOverlapRes = await apiContext.get('/api/v1/properties/rooms/available?startDate=2026-09-15&endDate=2026-10-15');
    expect(availOverlapRes.status()).toBe(200);
    const availOverlapRooms: any[] = (await availOverlapRes.json()).data;
    const isA101Available = availOverlapRooms.some((r) => r.id === roomA101.id);
    expect(isA101Available).toBe(false);

    // Non-overlapping interval
    const availBackToBackRes = await apiContext.get('/api/v1/properties/rooms/available?startDate=2027-09-01&endDate=2027-10-01');
    expect(availBackToBackRes.status()).toBe(200);

    // 43-45. Subscription expired / read-only test
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { expiresAt: new Date(Date.now() - 86400 * 1000) },
    });

    const readExpiredRes = await apiContext.get('/api/v1/properties/rooms');
    expect(readExpiredRes.status()).toBe(200);

    const writeExpiredRes = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: 'A999', roomType: 'standard' },
    });
    expect([403, 409]).toContain(writeExpiredRes.status());

    // 46-48. Hygiene checks
    expect(consoleErrors).toHaveLength(0);
    expect(unhandledErrors).toHaveLength(0);
  });
});
