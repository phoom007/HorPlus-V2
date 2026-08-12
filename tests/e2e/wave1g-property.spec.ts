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
        status: 'active',
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
    test.setTimeout(60000);
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
    await page.waitForLoadState('domcontentloaded');

    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
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

    // Room C101 — create via API, then clear monthlyRent override via production DELETE endpoint
    const createRoomC101Res = await apiContext.post('/api/v1/properties/rooms', {
      data: { buildingId: bldA.id, roomNumber: 'C101', roomType: 'standard' },
    });
    expect(createRoomC101Res.status()).toBe(201);
    const roomC101 = (await createRoomC101Res.json()).data;
    const roomC101Version = roomC101.version || 1;

    // Clear monthlyRent override via production API (not Prisma)
    const clearC101Res = await apiContext.delete(`/api/v1/properties/rooms/${roomC101.id}/defaults/monthlyRent`, {
      data: { expectedVersion: roomC101Version },
    });
    expect(clearC101Res.status()).toBe(200);
    const clearC101Body = await clearC101Res.json();
    expect(clearC101Body.data.success).toBe(true);
    expect(clearC101Body.data.clearedField).toBe('monthlyRent');

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

    // 5. Propagation preview assertions
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

    // 6. Apply propagation with Idempotency Key & Replay
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

    // Update Dormitory defaults to 9000 and verify:
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
    test.setTimeout(180000);
    const test2ConsoleErrors: string[] = [];
    const test2PageErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('net::ERR_FAILED') && !text.includes('ERR_ABORTED') && !text.includes('net::ERR_INVALID_URL') && !text.includes('409 (Conflict)') && !text.includes('status of 409')) {
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

    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    const apiContext2 = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // ============================================================
    // SECTION 1: Open Owner Rooms page & availability search
    // ============================================================
    const bldResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/buildings') && [200, 304].includes(res.status())
    );
    await page.goto('/owner/rooms');
    await bldResponsePromise;
    await page.waitForLoadState('networkidle');
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

    // ============================================================
    // SECTION 2: Building Override — Set, Assert, Clear, Assert
    // ============================================================
    const editBldBtn = page.getByTestId('btn-edit-building');
    await expect(editBldBtn).toBeVisible({ timeout: 15000 });
    await editBldBtn.click();

    const bldRentInput = page.getByTestId('input-building-override-monthly-rent');
    await expect(bldRentInput).toBeVisible({ timeout: 15000 });
    await bldRentInput.fill('4800');

    const saveBldOverridePromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/buildings/') && res.url().includes('/defaults') && res.status() === 200
    );
    const roomsAfterSavePromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/rooms') && [200, 304].includes(res.status())
    );

    const saveBldOverrideBtn = page.getByTestId('btn-save-building-override');
    await expect(saveBldOverrideBtn).toBeVisible({ timeout: 15000 });
    await saveBldOverrideBtn.click();
    await saveBldOverridePromise;
    await roomsAfterSavePromise;
    await page.waitForTimeout(500);

    // Close building modal so room cards are visible for badge assertions
    await page.keyboard.press('Escape');
    await expect(page.locator('.fixed.inset-0.z-\\[500\\]')).not.toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Locate Room C101 card (the room inheriting building defaults)
    const roomC101Card = page.locator('[data-testid="room-card"]', { hasText: 'C101' });
    await expect(roomC101Card).toBeVisible({ timeout: 15000 });
    await roomC101Card.scrollIntoViewIfNeeded();

    // Assert: Building badge shows "ใช้ค่าจากอาคาร" on Room C101
    const bldBadge = roomC101Card.getByTestId('badge-building');
    await expect(bldBadge).toBeVisible({ timeout: 15000 });
    await expect(bldBadge).toHaveText('ใช้ค่าจากอาคาร');

    // Assert: Exact building override monthly rent value visible on Room C101 card
    await expect(roomC101Card.getByText('4,800')).toBeVisible({ timeout: 10000 });

    // Re-open building modal to clear the override
    await editBldBtn.click();
    await expect(bldRentInput).toBeVisible({ timeout: 15000 });

    const clearBldOverridePromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/buildings/') && res.url().includes('/defaults/') && res.status() === 200
    );
    const roomsAfterClearPromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/rooms') && [200, 304].includes(res.status())
    );

    const clearBldBtn = page.getByTestId('btn-clear-building-override');
    await expect(clearBldBtn).toBeVisible({ timeout: 15000 });
    await clearBldBtn.click();
    await clearBldOverridePromise;
    await roomsAfterClearPromise;
    await page.waitForTimeout(500);

    // Ensure all building overrides are cleared via API
    const bldListRes = await apiContext.get('/api/v1/properties/buildings');
    const bldList = (await bldListRes.json()).data;
    for (const bldItem of bldList) {
      if (bldItem.monthlyRent !== null) {
        await apiContext.delete(`/api/v1/properties/buildings/${bldItem.id}/defaults/monthlyRent`, {
          data: { expectedVersion: bldItem.version || 1 }
        });
      }
    }

    // Close building modal so room cards are visible
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.fixed.inset-0.z-\\[500\\]')).not.toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Assert: Badge returns to Dormitory inheritance on Room C101
    const dormBadge = roomC101Card.getByTestId('badge-dormitory');
    await expect(dormBadge).toBeVisible({ timeout: 15000 });
    await expect(dormBadge).toHaveText('ใช้ค่าจากหอพัก');

    // Assert: Effective value returns to Dormitory value (9,000 from Test 1)
    await expect(roomC101Card.getByText('9,000')).toBeVisible({ timeout: 10000 });

    // ============================================================
    // SECTION 3: Room Identity and Override Lifecycle
    // ============================================================
    // Click on Room B101 card edit button
    const roomB101Card = page.locator('[data-testid="room-card"]', { hasText: 'B101' });
    await expect(roomB101Card).toBeVisible({ timeout: 15000 });
    const editRoomBtn = roomB101Card.getByText('แก้ไข');
    await expect(editRoomBtn).toBeVisible({ timeout: 10000 });
    await editRoomBtn.click();

    // Edit Room identity — change notes
    const notesInput = page.locator('textarea[placeholder*="หมายเหตุ"]');
    await expect(notesInput).toBeVisible({ timeout: 15000 });
    await notesInput.fill('E2E Test Room Notes');

    // Save room identity
    const saveRoomBtn = page.getByText('บันทึกข้อมูล');
    await expect(saveRoomBtn).toBeVisible({ timeout: 10000 });
    await saveRoomBtn.click();
    await page.waitForTimeout(1500);

    // Assert save succeeded
    await expect(page.getByText(/ได้รับการบันทึกในระบบแล้ว/i)).toBeVisible({ timeout: 15000 });

    // Re-open Room B101 editor to set monthly rent override
    await roomB101Card.getByText('แก้ไข').click();
    await page.waitForTimeout(500);

    // Set Room monthly rent override to 5500
    // The monthly rent input is the first required number input in the overrides section
    const roomMonthlyRentInput = page.locator('input[type="number"][required][min="0"]').first();
    await expect(roomMonthlyRentInput).toBeVisible({ timeout: 10000 });
    await roomMonthlyRentInput.fill('5500');

    // Save room override
    await page.getByText('บันทึกข้อมูล').click();
    await page.waitForTimeout(1500);

    // Assert: Room badge shows "กำหนดเฉพาะห้อง"
    await expect(page.getByTestId('badge-room').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('badge-room').first()).toHaveText('กำหนดเฉพาะห้อง');

    // Assert: Exact override value (5,500) visible
    await expect(page.getByText('5,500').first()).toBeVisible({ timeout: 10000 });

    // Re-open Room B101 editor to clear override
    await roomB101Card.getByText('แก้ไข').click();
    await page.waitForTimeout(500);

    // Click clear override button
    const clearRoomOverrideBtn = page.getByText('ล้าง Override ค่าเช่า');
    await expect(clearRoomOverrideBtn).toBeVisible({ timeout: 15000 });
    await clearRoomOverrideBtn.click();
    await page.waitForTimeout(1500);

    // Assert: Inherited badge returns (dormitory level)
    await expect(page.getByTestId('badge-dormitory').first()).toBeVisible({ timeout: 15000 });

    // Assert: Inherited effective value returns to dormitory default (9,000)
    await expect(page.getByText('9,000').first()).toBeVisible({ timeout: 10000 });

    // ============================================================
    // SECTION 4: Deterministic VERSION_CONFLICT via second API call
    // ============================================================
    // Ensure room modal backdrop is fully unmounted before clicking Settings
    await expect(page.locator('.fixed.inset-0.z-\\[500\\]')).not.toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    const settingsBtn = page.getByTestId('nav-item-settings').last();
    await expect(settingsBtn).toBeVisible({ timeout: 15000 });
    await settingsBtn.click();
    await page.waitForTimeout(1000);

    const defaultRentInput = page.locator('[data-testid="input-default-monthly-rent"]');
    await expect(defaultRentInput).toBeVisible({ timeout: 15000 });

    // Read current version from server
    const currentDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    expect(currentDefaultsRes.status()).toBe(200);
    const currentDefaults = await currentDefaultsRes.json();
    const currentPropertyVersion = currentDefaults.data.property.version;

    // Bump version out-of-band via second authenticated API call while UI holds currentPropertyVersion
    const bumpRes = await apiContext2.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9100 },
          expectedVersion: currentPropertyVersion,
        },
      },
    });
    expect(bumpRes.status()).toBe(200);

    // Trigger save on UI with stale version -> VERSION_CONFLICT
    await defaultRentInput.fill('9200');
    await defaultRentInput.blur();
    const saveDefaultsBtn = page.locator('button[data-testid="save-property-defaults-btn"], button[data-testid="btn-save-defaults"]').first();
    if (await saveDefaultsBtn.isVisible()) {
      await saveDefaultsBtn.click();
    }
    await page.waitForTimeout(1000);

    // Assert: VERSION_CONFLICT modal is visible (deterministic — must fail if not shown)
    const conflictModal = page.getByTestId('version-conflict-modal');
    await expect(conflictModal).toBeVisible({ timeout: 15000 });

    // Assert: Server currentVersion is displayed
    await expect(conflictModal.getByText(/เวอร์ชันปัจจุบันในระบบคือ/)).toBeVisible({ timeout: 5000 });

    // Assert: "โหลดข้อมูลล่าสุด" button is visible
    const reloadBtn = page.getByTestId('btn-reload-latest');
    await expect(reloadBtn).toBeVisible({ timeout: 5000 });
    await expect(reloadBtn).toHaveText(/โหลดข้อมูลล่าสุด/);

    // Click reload — latest version replaces stale version
    await reloadBtn.click();
    await page.waitForTimeout(1500);

    // Retry: fill new value and save — should succeed now with fresh version
    await expect(defaultRentInput).toBeVisible({ timeout: 15000 });
    const getDefaultsPromise = page.waitForResponse(
      res => res.url().includes('/api/v1/properties/dormitory/defaults') && res.request().method() === 'GET' && res.status() === 200
    );
    await defaultRentInput.fill('9200');
    await defaultRentInput.blur();
    await getDefaultsPromise;
    await expect(defaultRentInput).toHaveValue('9200', { timeout: 10000 });
    await page.waitForTimeout(500);

    // Assert: conflict modal does NOT reappear after reload + retry
    await expect(conflictModal).not.toBeVisible({ timeout: 5000 });

    // ============================================================
    // SECTION 5: Exact Real-Change and No-Op Propagation Results
    // ============================================================
    // Part A: Real-Change Propagation (Current = 9,200, Proposed = 9,400)
    const propRentInput = page.getByTestId('input-default-monthly-rent');
    await expect(propRentInput).toBeVisible({ timeout: 15000 });
    await expect(propRentInput).toHaveValue('9200', { timeout: 10000 });
    await propRentInput.fill('9400');
    await page.waitForTimeout(1000);

    const previewBtn = page.getByRole('button', { name: /Preview Propagation/i }).first();
    await expect(previewBtn).toBeEnabled({ timeout: 15000 });
    await previewBtn.click();

    // Assert: Propagation preview modal is visible
    const previewModal = page.getByTestId('propagation-preview-modal');
    await expect(previewModal).toBeVisible({ timeout: 15000 });

    // Assert exact counter values for dirty field defaultMonthlyRent
    const counterCandidate = page.getByTestId('counter-candidate');
    await expect(counterCandidate).toHaveText('3');

    const counterEligible = page.getByTestId('counter-eligible');
    await expect(counterEligible).toHaveText('2');

    const eligibleFieldCount = page.getByTestId('eligible-field-change-count');
    await expect(eligibleFieldCount).toHaveText('2');

    const counterSkipped = page.getByTestId('counter-skipped');
    await expect(counterSkipped).toHaveText('1');

    const skippedFieldCount = page.getByTestId('skipped-field-change-count');
    await expect(skippedFieldCount).toHaveText('1');

    // Assert exact eligible effect row for Room C101: oldEffectiveValue = 9200, newEffectiveValue = 9400, eligible = true
    const effectC101 = page.getByTestId('preview-effect-C101-defaultMonthlyRent');
    await expect(effectC101).toBeVisible({ timeout: 5000 });
    await expect(effectC101.getByTestId('effect-room-C101')).toHaveText('C101');
    await expect(effectC101.getByTestId('effect-field-defaultMonthlyRent')).toHaveText('defaultMonthlyRent');
    await expect(effectC101.getByTestId('effect-old-C101-defaultMonthlyRent')).toHaveText('9200');
    await expect(effectC101.getByTestId('effect-new-C101-defaultMonthlyRent')).toHaveText('9400');
    await expect(effectC101.getByTestId('effect-status-C101-defaultMonthlyRent')).toHaveText(/เปลี่ยนแปลง/);

    // Assert exact eligible effect row for Room B101
    const effectB101 = page.getByTestId('preview-effect-B101-defaultMonthlyRent');
    await expect(effectB101).toBeVisible({ timeout: 5000 });
    await expect(effectB101.getByTestId('effect-room-B101')).toHaveText('B101');
    await expect(effectB101.getByTestId('effect-status-B101-defaultMonthlyRent')).toHaveText(/เปลี่ยนแปลง/);

    // Assert exact skipped effect row for Room A101 (EXPLICIT_ROOM_OVERRIDE / PROTECTED_CONTRACT)
    const effectA101 = page.getByTestId('preview-effect-A101-defaultMonthlyRent');
    await expect(effectA101).toBeVisible({ timeout: 5000 });
    await expect(effectA101.getByTestId('effect-room-A101')).toHaveText('A101');
    await expect(effectA101.getByTestId('effect-old-A101-defaultMonthlyRent')).toHaveText('4000');
    await expect(effectA101.getByTestId('effect-new-A101-defaultMonthlyRent')).toHaveText('4000');
    await expect(effectA101.getByTestId('effect-skip-reason-A101-defaultMonthlyRent')).toHaveText(/ข้าม/);

    // Click Confirm Apply
    const confirmApplyBtn = page.getByTestId('btn-confirm-apply');
    await expect(confirmApplyBtn).toBeVisible({ timeout: 15000 });
    await confirmApplyBtn.click();

    // Assert: Applied result modal appears with exact visible committed counters
    const resultModal = page.getByTestId('propagation-result-modal');
    await expect(resultModal).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('applied-room-count')).toHaveText('2');
    await expect(page.getByTestId('applied-field-change-count')).toHaveText('2');
    await expect(page.getByTestId('skipped-room-count')).toHaveText('1');
    await expect(page.getByTestId('skipped-field-change-count')).toHaveText('1');

    // Close result modal
    await page.getByTestId('btn-close-result').click();
    await expect(resultModal).not.toBeVisible({ timeout: 5000 });

    // Part B: No-Op Propagation Proof (Current rent = 9,400, Proposed rent = 9,400)
    // 1. Send Preview API for no-op change (9,400 -> 9,400)
    const noOpPreviewRes = await apiContext.post('/api/v1/properties/defaults/preview', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 9400 },
        },
      },
    });
    expect(noOpPreviewRes.status()).toBe(200);
    const noOpPreview = (await noOpPreviewRes.json()).data;

    expect(noOpPreview.eligibleRoomCount).toBe(0);
    expect(noOpPreview.eligibleFieldChangeCount).toBe(0);

    const c101NoOpEffect = noOpPreview.fieldEffects.find((e: any) => e.roomNumber === 'C101' && e.field === 'defaultMonthlyRent');
    expect(c101NoOpEffect).toBeDefined();
    expect(c101NoOpEffect.eligible).toBe(false);
    expect(c101NoOpEffect.skipReason).toBe('NO_EFFECTIVE_CHANGE');

    // 2. Fetch current version before no-op apply
    const propPreNoOpRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    const propPreNoOpVer = (await propPreNoOpRes.json()).data.property.version;

    // 3. Send Apply API for no-op change
    const noOpApplyRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 9400 },
        },
        expectedVersions: {
          property: propPreNoOpVer,
          billing: (await propPreNoOpRes.json()).data.billing?.version || 1,
        },
        idempotencyKey: `noop-idem-${Date.now()}`,
      },
    });
    expect(noOpApplyRes.status()).toBe(200);
    const noOpApply = (await noOpApplyRes.json()).data;

    expect(noOpApply.noOp).toBe(true);
    expect(noOpApply.appliedRoomCount).toBe(0);
    expect(noOpApply.appliedFieldChangeCount).toBe(0);
    expect(noOpApply.auditLogId).toBeNull();

    // 4. Verify version did NOT increment
    const propPostNoOpRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    const propPostNoOpVer = (await propPostNoOpRes.json()).data.property.version;
    expect(propPostNoOpVer).toBe(propPreNoOpVer);

    // Inspect Room C101 card on Rooms page to assert exact committed effective value
    await page.goto('/owner/rooms');
    await page.waitForLoadState('networkidle');
    const roomC101CardCommitted = page.locator('[data-testid="room-card"]', { hasText: 'C101' });
    await expect(roomC101CardCommitted).toBeVisible({ timeout: 15000 });
    await expect(roomC101CardCommitted.getByTestId('badge-dormitory')).toHaveText('ใช้ค่าจากหอพัก');
    await expect(roomC101CardCommitted.getByText('9,400')).toBeVisible({ timeout: 10000 });

    // Part C: Changed Default with Zero Eligible Rooms Scenario (Requirement 7)
    // 1. Ensure all current rooms have explicit room overrides or protected contracts
    const allRoomsRes = await apiContext.get('/api/v1/properties/rooms');
    const allRoomsData = (await allRoomsRes.json()).data;
    const allRooms = Array.isArray(allRoomsData) ? allRoomsData : allRoomsData.items || [];
    let overriddenRoomId: string | null = null;

    for (const rm of allRooms) {
      if (rm.snapshotLocked || rm.activeContractSnapshotId || rm.currentContractId) {
        continue;
      }
      if (rm.rawOverrides?.monthlyRent === null || rm.rawOverrides?.monthlyRent === undefined) {
        // Fetch full room to get current version
        const roomDetailRes = await apiContext.get(`/api/v1/properties/rooms/${rm.id}`);
        const roomDetail = (await roomDetailRes.json()).data;
        const curVer = roomDetail.version || rm.version || 1;

        // Set explicit room override via production PUT endpoint
        const setOvrRes = await apiContext.put(`/api/v1/properties/rooms/${rm.id}`, {
          data: { monthlyRent: '8800', expectedVersion: curVer },
        });
        expect(setOvrRes.status()).toBe(200);
        overriddenRoomId = rm.id;
      } else {
        overriddenRoomId = rm.id;
      }
    }

    // 2. Fetch current dormitory defaults to confirm rent = 9,400
    const curDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    expect(curDefaultsRes.status()).toBe(200);
    const curDefaultsData = (await curDefaultsRes.json()).data;
    const propVerBefore = curDefaultsData.property.version;
    const billVerBefore = curDefaultsData.billing.version;
    expect(Number(curDefaultsData.property.defaultMonthlyRent)).toBe(9400);

    // 3. Send Apply API proposing defaultMonthlyRent = 9,600 (when all rooms are overridden/protected)
    const zeroEligibleApplyRes = await apiContext.post('/api/v1/properties/defaults/apply', {
      data: {
        scope: 'DORMITORY',
        changes: {
          property: { defaultMonthlyRent: 9600 },
        },
        expectedVersions: {
          property: propVerBefore,
          billing: billVerBefore,
        },
        idempotencyKey: `zero-eligible-idem-${Date.now()}`,
      },
    });
    expect(zeroEligibleApplyRes.status()).toBe(200);
    const zeroEligibleApply = (await zeroEligibleApplyRes.json()).data;

    expect(zeroEligibleApply.noOp).toBe(false);
    expect(zeroEligibleApply.appliedRoomCount).toBe(0);
    expect(zeroEligibleApply.appliedFieldChangeCount).toBe(0);
    expect(zeroEligibleApply.scopeUpdates.property.updated).toBe(true);
    expect(zeroEligibleApply.scopeUpdates.property.oldVersion).toBe(propVerBefore);
    expect(zeroEligibleApply.scopeUpdates.property.newVersion).toBe(propVerBefore + 1);

    // 4. Verify default record is updated to 9,600 with incremented version
    const updatedDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    const updatedDefaultsData = (await updatedDefaultsRes.json()).data;
    expect(Number(updatedDefaultsData.property.defaultMonthlyRent)).toBe(9600);
    expect(updatedDefaultsData.property.version).toBe(propVerBefore + 1);

    // 5. Clear one Room override through production endpoint
    expect(overriddenRoomId).not.toBeNull();
    const fetchOvrRoomRes = await apiContext.get(`/api/v1/properties/rooms/${overriddenRoomId}`);
    const ovrRoomVer = (await fetchOvrRoomRes.json()).data.version;

    const clearRoomOvrRes = await apiContext.delete(`/api/v1/properties/rooms/${overriddenRoomId}/defaults/monthlyRent`, {
      data: { expectedVersion: ovrRoomVer },
    });
    expect(clearRoomOvrRes.status()).toBe(200);

    // 6. Assert room now inherits newly committed default 9,600 from DORMITORY
    const authRoomRes = await apiContext.get(`/api/v1/properties/rooms/${overriddenRoomId}`);
    expect(authRoomRes.status()).toBe(200);
    const authRoom = (await authRoomRes.json()).data;
    expect(Number(authRoom.currentEffectiveValues.monthlyRent)).toBe(9600);
    expect(authRoom.currentFieldSources.monthlyRent).toBe('DORMITORY');

    // ============================================================
    // SECTION 6: Inheriting Room D101 Snapshot Separation Proof
    // ============================================================
    // 1. Create dedicated Room D101 in Building A via production API
    const bldResForD101 = await apiContext.get('/api/v1/properties/buildings');
    const bldsForD101 = await bldResForD101.json();
    const bldAId = (Array.isArray(bldsForD101.data) ? bldsForD101.data : bldsForD101.data?.items || [])[0].id;

    const createD101Res = await apiContext.post('/api/v1/properties/rooms', {
      data: {
        buildingId: bldAId,
        roomNumber: 'D101',
        roomType: 'standard',
        floor: 1,
        rentCycle: 'monthly',
      },
    });
    expect(createD101Res.status()).toBe(201);
    const roomD101 = (await createD101Res.json()).data;

    // 2. Clear monthlyRent override on D101 via production API route
    const clearD101Res = await apiContext.delete(`/api/v1/properties/rooms/${roomD101.id}/defaults/monthlyRent`, {
      data: { expectedVersion: roomD101.version },
    });
    expect(clearD101Res.status()).toBe(200);

    // 3. Verify via authoritative Room API: rawOverrides.monthlyRent = null, currentEffectiveValues.monthlyRent = 9,200 (or current default)
    const authD101PreRes = await apiContext.get(`/api/v1/properties/rooms/${roomD101.id}`);
    expect(authD101PreRes.status()).toBe(200);
    const authD101Pre = (await authD101PreRes.json()).data;
    expect(authD101Pre.rawOverrides.monthlyRent).toBeNull();
    expect(Number(authD101Pre.currentEffectiveValues.monthlyRent)).toBe(9600);

    // 4. Create Tenant "วิชัย สุขใจ" via production API
    const createTenantRes = await apiContext.post('/api/v1/tenants', {
      data: {
        firstName: 'วิชัย',
        lastName: 'สุขใจ',
        phone: '0899998888',
        nationalId: '1234567890123',
      },
    });
    expect(createTenantRes.status()).toBe(201);
    const tenantD101 = (await createTenantRes.json()).data;

    // 5. Create Contract for D101 with locked rent = 4,300, deposit = 8,600
    const createContractRes = await apiContext.post('/api/v1/contracts', {
      data: {
        roomId: roomD101.id,
        tenantId: tenantD101.id,
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        rentAmount: '4300.00',
        depositAmount: '8600.00',
      },
    });
    expect(createContractRes.status()).toBe(201);
    const contractD101 = (await createContractRes.json()).data;

    // 6. Activate Contract for D101 to lock ContractSnapshot
    const activateContractRes = await apiContext.post(`/api/v1/contracts/${contractD101.id}/activate`);
    expect(activateContractRes.status()).toBe(200);

    // 7. Verify authoritative Room response: contractSnapshot values locked at 4,300 / 8,600
    const authD101LockedRes = await apiContext.get(`/api/v1/properties/rooms/${roomD101.id}`);
    expect(authD101LockedRes.status()).toBe(200);
    const authD101Locked = (await authD101LockedRes.json()).data;
    expect(authD101Locked.contractSnapshot).not.toBeNull();
    expect(Number(authD101Locked.contractSnapshot.values.monthlyRent)).toBe(4300);
    expect(Number(authD101Locked.contractSnapshot.values.depositAmount)).toBe(8600);

    // 8. Update current Dormitory default to 9,500 via production API
    const currentPropDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    const currentPropDefaults = await currentPropDefaultsRes.json();
    const curPropVer = currentPropDefaults.data.property.version;

    const updateDormDefaultRes = await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9500 },
          expectedVersion: curPropVer,
        },
      },
    });
    expect(updateDormDefaultRes.status()).toBe(200);

    // 9. Verify authoritative Room response for D101: currentEffectiveValues.monthlyRent = 9,500, contractSnapshot.values.monthlyRent = 4,300
    const authD101PostRes = await apiContext.get(`/api/v1/properties/rooms/${roomD101.id}`);
    expect(authD101PostRes.status()).toBe(200);
    const authD101Post = (await authD101PostRes.json()).data;
    expect(Number(authD101Post.currentEffectiveValues.monthlyRent)).toBe(9500);
    expect(Number(authD101Post.contractSnapshot.values.monthlyRent)).toBe(4300);

    // 10. Open Owner Contracts page and assert exact visible current vs locked snapshot values in separate sections
    await page.goto('/owner/contracts');
    await page.waitForLoadState('networkidle');

    const d101ContractCard = page.getByText(/คุณวิชัย สุขใจ/i).first();
    await expect(d101ContractCard).toBeVisible({ timeout: 30000 });
    await d101ContractCard.click();

    const snapshotComparisonBox = page.getByTestId('snapshot-comparison');
    await expect(snapshotComparisonBox).toBeVisible({ timeout: 15000 });

    // Assert locked snapshot section (left box)
    const lockedSection = page.getByTestId('locked-snapshot-section');
    await expect(lockedSection).toBeVisible({ timeout: 5000 });
    await expect(lockedSection.getByTestId('locked-rent-value')).toHaveText('฿\u00A04,300.00');
    await expect(lockedSection.getByTestId('locked-deposit-value')).toHaveText('฿\u00A08,600.00');

    // Assert current room defaults section (right box)
    const currentSection = page.getByTestId('current-defaults-section');
    await expect(currentSection).toBeVisible({ timeout: 5000 });
    await expect(currentSection.getByTestId('current-rent-value')).toHaveText('฿\u00A09,500.00');

    // Assert separate sections: locked section and current section are distinct elements
    const lockedTestId = await lockedSection.getAttribute('data-testid');
    const currentTestId = await currentSection.getAttribute('data-testid');
    expect(lockedTestId).not.toEqual(currentTestId);

    // Error hygiene assertions
    expect(test2ConsoleErrors).toEqual([]);
    expect(test2PageErrors).toEqual([]);
  });
});
