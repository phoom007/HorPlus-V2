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
  test.describe.configure({ mode: 'serial' });

  let dormId: string;
  let userId: string;
  let sessionId: string;
  let sessionToken: string;
  let csrfToken: string;
  let rawSessionId: string;

  test.beforeAll(async () => {
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

    rawSessionId = crypto.randomUUID();
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

  test('Complete 54-step Wave 1G Lifecycle via Production Routes & Visible UI', async ({ page, context }) => {
    const consoleErrors: string[] = [];
    const unhandledErrors: string[] = [];
    const externalProviderAttempts: string[] = [];

    const isExternalProvider = (url: string) => {
      return (
        url.includes('accounts.google.com') ||
        url.includes('googleapis.com') ||
        url.includes('line.me') ||
        url.includes('slipok') ||
        url.includes('cloudflare')
      );
    };

    // Requirement 10: Intercept & track external provider requests
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (isExternalProvider(url)) {
        externalProviderAttempts.push(url);
        await route.abort();
        return;
      }
      await route.continue();
    });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('net::ERR_FAILED') && !text.includes('ERR_ABORTED')) {
          consoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', (err) => {
      unhandledErrors.push(err.message);
    });

    // 1. Set authentication cookies for browser context
    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'horplus_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: '127.0.0.1', path: '/' },
    ]);

    // 2. Visible page navigation — page.goto()
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toBeDefined();

    // Create authenticated API context with session cookie & CSRF header
    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3001',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // 3-4. Real session & Dormitory defaults read
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

    // 10-12. Duplicate room number rejection (a101 / A101 duplicate rejection)
    const dupRes = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: ' a101 ', roomType: 'standard' },
    });
    expect(dupRes.status()).toBe(409);
    const dupBody = await dupRes.json();
    expect(dupBody.error.code).toBe('ROOM_NUMBER_ALREADY_EXISTS');
    expect(dupBody.error.message).toContain('มีอยู่แล้วในหอพักนี้');

    // 13-15. Building B defaults & Building override badge
    const bldOverRes = await apiContext.put(`/api/v1/properties/buildings/${bldB.id}/defaults`, {
      data: { monthlyRent: 4800, expectedVersion: bldB.version },
    });
    expect(bldOverRes.status()).toBe(200);

    const bldFetchRes = await apiContext.get(`/api/v1/properties/buildings/${bldB.id}`);
    expect(bldFetchRes.status()).toBe(200);
    const bldFetchBody = await bldFetchRes.json();
    expect(bldFetchBody.data.fieldSources.monthlyRent).toBe('BUILDING');

    // 16-18. Room override set and clear with expectedVersion
    const roomOverRes = await apiContext.put(`/api/v1/properties/rooms/${roomA101.id}/defaults`, {
      data: { monthlyRent: 5200, expectedVersion: roomA101.version },
    });
    expect(roomOverRes.status()).toBe(200);
    const updatedRoomA101 = (await roomOverRes.json()).data;

    const roomFetchRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomFetchRes.status()).toBe(200);
    const roomFetchBody = await roomFetchRes.json();
    expect(roomFetchBody.data.currentFieldSources.monthlyRent).toBe('ROOM');

    // Clear Room override
    const clearRes = await apiContext.delete(`/api/v1/properties/rooms/${roomA101.id}/defaults/monthlyRent`, {
      data: { expectedVersion: updatedRoomA101.version },
    });
    expect(clearRes.status()).toBe(200);

    const roomClearFetchRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomClearFetchRes.status()).toBe(200);
    expect((await roomClearFetchRes.json()).data.currentFieldSources.monthlyRent).toBe('DORMITORY');

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

    // 26-28. Idempotency mismatch
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

    // 29-32. Concurrency stale mutation -> 409 VERSION_CONFLICT
    const staleRes = await apiContext.put(`/api/v1/properties/buildings/${bldA.id}`, {
      data: { name: 'Building A Renamed Stale', expectedVersion: 999 },
    });
    expect(staleRes.status()).toBe(409);
    const staleBody = await staleRes.json();
    expect(staleBody.error.code).toBe('VERSION_CONFLICT');

    // 33-35. Create Tenant and Contract via production API routes (Requirement 1)
    const createTenantRes = await apiContext.post('/api/v1/tenants', {
      data: {
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        displayName: 'สมชาย ใจดี',
        phone: '0812345678',
      },
    });
    expect(createTenantRes.status()).toBe(201);
    const tenant = (await createTenantRes.json()).data;

    // Production Contract creation route: POST /api/v1/contracts
    const createContractRes = await apiContext.post('/api/v1/contracts', {
      data: {
        roomId: roomA101.id,
        tenantId: tenant.id,
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '4300.00',
        depositAmount: '8600.00',
        advancePaymentAmount: '4300.00',
      },
    });
    expect(createContractRes.status()).toBe(201);
    const contract = (await createContractRes.json()).data;

    // Production Contract activation route: POST /api/v1/contracts/:id/activate (Requirement 1)
    const activateRes = await apiContext.post(`/api/v1/contracts/${contract.id}/activate`, {
      data: {
        ownerSignature: 'data:image/png;base64,ownerSigMock',
        tenantSignature: 'data:image/png;base64,tenantSigMock',
      },
    });
    expect(activateRes.status()).toBe(200);

    // 36. Verify exactly 1 ContractSnapshot in PostgreSQL (Requirement 6 & 1)
    const dbSnapshotCount = await prisma.contractSnapshot.count({
      where: { contractId: contract.id },
    });
    expect(dbSnapshotCount).toBe(1);

    // 37-41. Read ContractSnapshot via GET /api/v1/properties/contracts/:id/snapshot
    const snapRes = await apiContext.get(`/api/v1/properties/contracts/${contract.id}/snapshot`);
    expect(snapRes.status()).toBe(200);
    const snapBody = await snapRes.json();
    expect(snapBody.data.resolvedRent).toBe('4300');

    // Update Dormitory defaults and verify current vs snapshot values remain separate (Requirement 4)
    await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9000 },
          expectedVersion: 2,
        },
      },
    });

    const roomAfterDefaultChangeRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomAfterDefaultChangeRes.status()).toBe(200);
    const roomAfterBody = await roomAfterDefaultChangeRes.json();
    expect(roomAfterBody.data.currentEffectiveValues.monthlyRent).toBe(9000);
    expect(roomAfterBody.data.currentFieldSources.monthlyRent).toBe('DORMITORY');
    expect(roomAfterBody.data.snapshotLocked).toBe(true);
    expect(roomAfterBody.data.contractSnapshot.values.monthlyRent).toBe(4300);

    // 42-46. Query overlapping availability
    const availOverlapRes = await apiContext.get('/api/v1/properties/rooms/available?startDate=2026-09-15&endDate=2026-10-15');
    expect(availOverlapRes.status()).toBe(200);
    const availOverlapRooms: any[] = (await availOverlapRes.json()).data;
    const isA101Available = availOverlapRooms.some((r) => r.id === roomA101.id);
    expect(isA101Available).toBe(false);

    // Non-overlapping back-to-back interval
    const availBackToBackRes = await apiContext.get('/api/v1/properties/rooms/available?startDate=2027-09-01&endDate=2027-10-01');
    expect(availBackToBackRes.status()).toBe(200);
    const availBackRooms: any[] = (await availBackToBackRes.json()).data;
    const isA101BackAvailable = availBackRooms.some((r) => r.id === roomA101.id);
    expect(isA101BackAvailable).toBe(true);

    // 47-50. Expire Subscription and verify read-only entitlement
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { expiresAt: new Date(Date.now() - 86400 * 1000) },
    });

    const readExpiredRes = await apiContext.get('/api/v1/properties/rooms');
    expect(readExpiredRes.status()).toBe(200);

    const writeExpiredRes = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: 'A999', roomType: 'standard' },
    });
    expect(writeExpiredRes.status()).toBe(403);
    const writeExpiredBody = await writeExpiredRes.json();
    expect(writeExpiredBody.error.code).toBe('SUBSCRIPTION_READ_ONLY');

    // 51-54. Hygiene assertions
    expect(consoleErrors).toHaveLength(0);
    expect(unhandledErrors).toHaveLength(0);
    expect(externalProviderAttempts.length).toBeGreaterThanOrEqual(2);
    expect(externalProviderAttempts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('fonts.googleapis.com'),
        'https://accounts.google.com/gsi/client',
      ])
    );
  });

  test('Visible Owner UI Interactions Lifecycle — Property, Defaults, Availability & Contracts', async ({ page, context }) => {
    page.on('console', msg => console.log('TEST 2 BROWSER CONSOLE:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('TEST 2 PAGE UNHANDLED ERROR:', err));

    // Restore active subscription for Test 2 UI interactions
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { expiresAt: new Date(Date.now() + 30 * 86400 * 1000) },
    });

    // 1. Set authentication cookies for localhost domain
    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
    ]);

    await page.addInitScript((id) => {
      window.localStorage.setItem('selected_dormitory_id', id);
      window.sessionStorage.setItem('active_dormitory_selected_for_session', id);
    }, dormId);

    // 2. Open Owner Rooms page
    await page.goto('/owner/rooms');
    await page.waitForLoadState('networkidle');

    // 3. Search availability via mandatory inputs
    const startDateInput = page.getByTestId('input-avail-start-date');
    await expect(startDateInput).toBeVisible({ timeout: 30000 });
    await startDateInput.fill('2026-09-01');

    const endDateInput = page.getByTestId('input-avail-end-date');
    await expect(endDateInput).toBeVisible({ timeout: 15000 });
    await endDateInput.fill('2026-09-30');

    const searchAvailBtn = page.getByTestId('btn-search-availability');
    await expect(searchAvailBtn).toBeVisible({ timeout: 15000 });
    await searchAvailBtn.click();

    await expect(page.getByText(/พบห้องว่าง/i)).toBeVisible({ timeout: 15000 });

    // 4. Open Building Editor & Set/Clear Building Override
    const editBldBtn = page.getByTestId('btn-edit-building');
    await expect(editBldBtn).toBeVisible({ timeout: 15000 });
    await editBldBtn.click();

    const bldRentInput = page.getByTestId('input-building-override-monthly-rent');
    await expect(bldRentInput).toBeVisible({ timeout: 15000 });
    await bldRentInput.fill('4800');

    const saveBldOverrideBtn = page.getByTestId('btn-save-building-override');
    await expect(saveBldOverrideBtn).toBeVisible({ timeout: 15000 });
    await saveBldOverrideBtn.click();

    const clearBldBtn = page.getByTestId('btn-clear-building-override');
    await expect(clearBldBtn).toBeVisible({ timeout: 15000 });
    await clearBldBtn.click();
    await page.keyboard.press('Escape');

    // 5. Navigate to Settings page & Save Dormitory Default
    await page.goto('/owner/settings');
    await page.waitForLoadState('networkidle');

    const waterInput = page.getByTestId('input-water-unit-rate');
    await expect(waterInput).toBeVisible({ timeout: 15000 });
    await waterInput.fill('22');
    await waterInput.blur();

    // 6. Trigger Propagation Preview Modal & Confirm Apply
    const previewBtn = page.getByRole('button', { name: /แสดงตัวอย่างการส่งต่อค่า/i }).first();
    await expect(previewBtn).toBeVisible({ timeout: 15000 });
    await previewBtn.click();

    await expect(page.getByTestId('propagation-preview-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('counter-candidate')).toHaveText(/\d+/, { timeout: 15000 });

    const confirmApplyBtn = page.getByTestId('btn-confirm-apply');
    await expect(confirmApplyBtn).toBeVisible({ timeout: 15000 });
    // Dismiss any native alert dialogs that appear after apply
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await confirmApplyBtn.click();

    // Wait for the propagation to complete and alert to be dismissed
    await page.waitForTimeout(2000);

    // 7. Navigate to Contracts page via sidebar & Assert Locked Snapshot Comparison
    const contractsNavBtn = page.getByRole('button', { name: /สัญญาเช่า/i }).first();
    await expect(contractsNavBtn).toBeVisible({ timeout: 15000 });
    await contractsNavBtn.click();
    await page.waitForLoadState('networkidle');

    const contractCard = page.getByText(/คุณสมชาย ใจดี/i).first();
    await expect(contractCard).toBeVisible({ timeout: 30000 });
    await contractCard.click();

    await expect(page.getByTestId('snapshot-comparison')).toBeVisible({ timeout: 15000 });
  });
});
