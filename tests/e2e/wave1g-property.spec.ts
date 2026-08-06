import { test, expect, request as playwrightRequest } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

test.describe.serial('Wave 1G Real Playwright Lifecycle — Property, Room Defaults, Snapshots & Availability', () => {
  const prisma = getPrismaClient();

  let dormId: string;
  let ownerId: string;
  let sessionToken: string;
  let csrfToken: string;

  test.beforeAll(async () => {
    // 1. Provision fresh test user in real PostgreSQL
    const email = `wave1g-e2e-${Date.now()}@example.com`;
    const owner = await prisma.user.create({
      data: {
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Wave 1G E2E Owner',
        googleSubject: `sub-e2e-${Date.now()}`,
        status: 'active',
      },
    });
    ownerId = owner.id;

    // 2. Provision fresh Dormitory in real PostgreSQL
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Wave1G Dorm ${Date.now()}`,
        code: `DM-E2E-${Date.now()}`,
        createdByUserId: owner.id,
      },
    });
    dormId = dorm.id;

    // 3. Provision real PostgreSQL DormitoryPropertyDefaults & DormitoryBillingSettings
    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: dorm.id,
        defaultMonthlyRent: 4000,
        defaultDeposit: 8000,
        defaultAdvancePayment: 4000,
        version: 1,
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dorm.id,
        billingDay: 1,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: 18,
        electricityBillingType: 'per_unit',
        electricityRate: 7,
        version: 1,
      },
    });

    // 4. Provision active Subscription in real PostgreSQL via subscriptionEntitlementService
    await subscriptionEntitlementService.ensureSeeded();
    await subscriptionEntitlementService.provisionInitialTrial(dorm.id);

    // 5. Establish real Session with CSRF token in PostgreSQL
    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);

    await prisma.session.create({
      data: {
        userId: owner.id,
        sessionIdHash,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });

    const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
    const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

    const sessionTokenService = new SessionTokenService(sessionSecret);
    const csrfService = new CsrfService(csrfSecret);

    sessionToken = sessionTokenService.encryptToken(
      { sub: owner.id, sid: sessionId, type: 'session', version: 1 },
      86400
    );
    csrfToken = csrfService.generateCsrfToken(sessionId);

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dorm.id,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        userId: owner.id,
        dormitoryId: dorm.id,
        roleId: ownerRole.id,
        status: 'active',
      },
    });
  });

  test('Complete API & Database Lifecycle — Strict Defaults, Propagation Counters, Snapshot & Entitlement', async ({ page, context }) => {
    const consoleErrors: string[] = [];
    const unhandledErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('net::ERR_FAILED') && !text.includes('ERR_ABORTED') && !text.includes('net::ERR_INVALID_URL')) {
          consoleErrors.push(text);
        }
      }
    });

    page.on('pageerror', err => unhandledErrors.push(err.message));

    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'horplus_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3001',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // 1. Read Dormitory defaults
    const defaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    expect(defaultsRes.status()).toBe(200);
    const defaultsBody = await defaultsRes.json();
    expect(defaultsBody.data.property.defaultMonthlyRent).toBe('4000');

    // 2. Create Building A and Building B via API
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

    // Create Room A101 and Room B101 with explicit overrides
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

    // Room C101 inheriting dormitory defaults (monthlyRent: null)
    const createRoomC101Res = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: 'C101', roomType: 'standard' },
    });
    expect(createRoomC101Res.status()).toBe(201);
    const roomC101 = (await createRoomC101Res.json()).data;

    // Un-override room C101 monthlyRent so it is eligible for defaults propagation
    await prisma.room.update({
      where: { id: roomC101.id },
      data: { monthlyRent: null },
    });

    expect(roomA101.id).toBeDefined();
    expect(roomB101.id).toBeDefined();

    // 3. Duplicate room number rejection (a101 / A101 duplicate rejection)
    const dupRes = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: ' a101 ', roomType: 'standard' },
    });
    expect(dupRes.status()).toBe(409);

    // 4. Set & verify building override
    const bldOverRes = await apiContext.put(`/api/v1/properties/buildings/${bldB.id}/defaults`, {
      data: { monthlyRent: 4800, expectedVersion: bldB.version },
    });
    expect(bldOverRes.status()).toBe(200);

    // 5. Propagation preview assertions (Requirement 1 & 6)
    const prevRes = await apiContext.post('/api/v1/properties/defaults/preview', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4300 },
        },
      },
    });
    expect(prevRes.status()).toBe(200);
    const prevBody = await prevRes.json();
    expect(prevBody.data.candidateRoomCount).toBe(3);
    expect(prevBody.data.eligibleRoomCount).toBe(1);
    expect(prevBody.data.eligibleFieldChangeCount).toBe(1);
    expect(prevBody.data.skippedRoomCount).toBe(2);
    expect(prevBody.data.skippedFieldChangeCount).toBe(2);
    expect(prevBody.data.fieldEffects.length).toBeGreaterThanOrEqual(1);

    // 6. Apply propagation with Idempotency Key & Replay (Requirement 1, 2, 3)
    const applyKey = `e2e-idem-${Date.now()}`;
    const applyRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4300 },
        },
        expectedVersions: { property: 1 },
        idempotencyKey: applyKey,
      },
    });
    expect(applyRes.status()).toBe(200);
    const applyBody = await applyRes.json();
    expect(applyBody.data.success).toBe(true);
    expect(applyBody.data.appliedRoomCount).toBe(1);
    expect(applyBody.data.appliedFieldChangeCount).toBe(1);
    expect(applyBody.data.skippedRoomCount).toBe(2);
    expect(applyBody.data.skippedFieldChangeCount).toBe(2);

    // Replay same key & payload
    const replayRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 4300 },
        },
        expectedVersions: { property: 1 },
        idempotencyKey: applyKey,
      },
    });
    expect(replayRes.status()).toBe(200);
    expect(await replayRes.json()).toEqual(applyBody);

    // 7. Idempotency mismatch
    const mismatchRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 9999 },
        },
        expectedVersions: { property: 1 },
        idempotencyKey: applyKey,
      },
    });
    expect(mismatchRes.status()).toBe(409);

    // 8. Create Tenant and Contract
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

    const activateRes = await apiContext.post(`/api/v1/contracts/${contract.id}/activate`, {
      data: {
        ownerSignature: 'data:image/png;base64,ownerSigMock',
        tenantSignature: 'data:image/png;base64,tenantSigMock',
      },
    });
    expect(activateRes.status()).toBe(200);

    // 9. Read ContractSnapshot & prove locked snapshot values
    const snapRes = await apiContext.get(`/api/v1/properties/contracts/${contract.id}/snapshot`);
    expect(snapRes.status()).toBe(200);
    const snapBody = await snapRes.json();
    expect(snapBody.data.resolvedRent).toBe('4300');

    // Update Dormitory defaults and verify:
    //   Room A101 (has override 4000) -> effective stays 4000
    //   Room C101 (null monthlyRent, inherits defaults) -> effective becomes 9000
    await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9000 },
          expectedVersion: 2,
        },
      },
    });

    // Room A101 keeps its override (4000), unaffected by defaults change
    const roomA101AfterRes = await apiContext.get(`/api/v1/properties/rooms/${roomA101.id}`);
    expect(roomA101AfterRes.status()).toBe(200);
    const roomA101After = await roomA101AfterRes.json();
    expect(roomA101After.data.currentEffectiveValues.monthlyRent).toBe(4000);

    // Room C101 inherits dormitory defaults -> effective rent updates to 9000
    const roomC101AfterRes = await apiContext.get(`/api/v1/properties/rooms/${roomC101.id}`);
    expect(roomC101AfterRes.status()).toBe(200);
    const roomC101After = await roomC101AfterRes.json();
    expect(roomC101After.data.currentEffectiveValues.monthlyRent).toBe(9000);

    // Hygiene assertions
    expect(consoleErrors).toHaveLength(0);
    expect(unhandledErrors).toHaveLength(0);
  });

  test('Visible Owner UI Interactions Lifecycle — Property, Defaults, Availability & Contracts', async ({ page, context }) => {
    const test2ConsoleErrors: string[] = [];
    const test2PageErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('net::ERR_FAILED') && !text.includes('ERR_ABORTED') && !text.includes('net::ERR_INVALID_URL')) {
          test2ConsoleErrors.push(text);
        }
      }
    });
    page.on('pageerror', err => test2PageErrors.push(err.message));

    // Restore active subscription for Test 2 UI interactions
    await prisma.dormitorySubscription.update({
      where: { dormitoryId: dormId },
      data: { expiresAt: new Date(Date.now() + 30 * 86400 * 1000) },
    });

    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'horplus_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: '127.0.0.1', path: '/' },
    ]);

    await page.addInitScript((id) => {
      window.localStorage.setItem('selected_dormitory_id', id);
      window.sessionStorage.setItem('active_dormitory_selected_for_session', id);
    }, dormId);

    // 1. Open Owner Rooms page & wait for buildings to populate React state
    // Buildings were created by Test 1 (serial execution guarantees this)
    const bldResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/buildings') && [200, 304].includes(res.status())
    );
    await page.goto('/owner/rooms');
    await bldResponsePromise;
    await page.waitForLoadState('networkidle');
    // Extra wait for React state propagation from setBuildings() -> OwnerRooms props
    await page.waitForTimeout(1000);

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

    // 2. Open Building Editor & Set/Clear Building Override (Requirement 6)
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

    // 3. Navigate to Settings page & Save Dormitory Defaults (Requirement 6)
    await page.goto('/owner/settings');
    await page.waitForLoadState('networkidle');

    const waterInput = page.getByTestId('input-water-unit-rate');
    await expect(waterInput).toBeVisible({ timeout: 15000 });
    await waterInput.fill('22');
    await waterInput.blur();

    const conflictModal = page.getByTestId('version-conflict-modal');
    if (await conflictModal.isVisible()) {
      await page.getByTestId('btn-reload-latest').click();
      await page.waitForTimeout(500);
      await waterInput.fill('22');
      await waterInput.blur();
    }

    // 4. Trigger Propagation Preview Modal & Confirm Apply (Requirement 6)
    const previewBtn = page.getByRole('button', { name: /แสดงตัวอย่างการส่งต่อค่า/i }).first();
    await expect(previewBtn).toBeVisible({ timeout: 15000 });
    await previewBtn.click();

    await expect(page.getByTestId('propagation-preview-modal')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('counter-candidate')).toHaveText(/\d+/, { timeout: 15000 });

    const confirmApplyBtn = page.getByTestId('btn-confirm-apply');
    await expect(confirmApplyBtn).toBeVisible({ timeout: 15000 });

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    await confirmApplyBtn.click();
    await page.waitForTimeout(2000);

    if (await conflictModal.isVisible()) {
      await page.getByTestId('btn-reload-latest').click();
      await page.waitForTimeout(500);
    }

    // 5. Navigate to Contracts page via sidebar & Assert Locked Snapshot Comparison
    const contractsNavBtn = page.getByRole('button', { name: /สัญญาเช่า/i }).first();
    await expect(contractsNavBtn).toBeVisible({ timeout: 15000 });
    await contractsNavBtn.click();
    await page.waitForLoadState('networkidle');

    const contractCard = page.getByText(/คุณสมชาย ใจดี/i).first();
    await expect(contractCard).toBeVisible({ timeout: 30000 });
    await contractCard.click();

    await expect(page.getByTestId('snapshot-comparison')).toBeVisible({ timeout: 15000 });

    // Error hygiene assertions
    expect(test2ConsoleErrors).toEqual([]);
    expect(test2PageErrors).toEqual([]);
  });
});
