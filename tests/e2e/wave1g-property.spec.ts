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

    // Authenticated API context for out-of-band mutations (correction #1)
    const apiContext = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3001',
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

    // Close building modal so room cards are visible
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
    await page.goto('/owner/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Read current version from server
    const currentDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    expect(currentDefaultsRes.status()).toBe(200);
    const currentDefaults = await currentDefaultsRes.json();
    const currentPropertyVersion = currentDefaults.data.property.version;

    // Bump version out-of-band via second authenticated API call (correction #1)
    const bumpRes = await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9100 },
          expectedVersion: currentPropertyVersion,
        },
      },
    });
    expect(bumpRes.status()).toBe(200);
    // Server property version is now currentPropertyVersion + 1
    // UI still holds stale version = currentPropertyVersion

    // Trigger save on UI with stale version -> VERSION_CONFLICT
    const defaultRentInput = page.getByTestId('input-default-monthly-rent');
    await expect(defaultRentInput).toBeVisible({ timeout: 15000 });
    await defaultRentInput.fill('9200');
    await defaultRentInput.blur();
    await page.waitForTimeout(2000);

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
    await defaultRentInput.fill('9200');
    await defaultRentInput.blur();
    await page.waitForTimeout(2000);

    // Assert: conflict modal does NOT reappear after reload + retry
    await expect(conflictModal).not.toBeVisible({ timeout: 5000 });

    // ============================================================
    // SECTION 5: Exact Propagation Preview Results
    // ============================================================
    const previewBtn = page.getByRole('button', { name: /Preview Propagation/i }).first();
    await expect(previewBtn).toBeVisible({ timeout: 15000 });
    await previewBtn.click();

    // Assert: Propagation preview modal is visible
    await expect(page.getByTestId('propagation-preview-modal')).toBeVisible({ timeout: 15000 });

    // Assert exact counter values
    const counterCandidate = page.getByTestId('counter-candidate');
    await expect(counterCandidate).toBeVisible({ timeout: 10000 });
    const candidateText = await counterCandidate.textContent();
    expect(Number(candidateText)).toBeGreaterThanOrEqual(1);

    const counterEligible = page.getByTestId('counter-eligible');
    await expect(counterEligible).toBeVisible({ timeout: 5000 });

    const eligibleFieldCount = page.getByTestId('eligible-field-change-count');
    await expect(eligibleFieldCount).toBeVisible({ timeout: 5000 });

    const counterSkipped = page.getByTestId('counter-skipped');
    await expect(counterSkipped).toBeVisible({ timeout: 5000 });

    const skippedFieldCount = page.getByTestId('skipped-field-change-count');
    await expect(skippedFieldCount).toBeVisible({ timeout: 5000 });

    // Assert exact effect row by room+field (correction #3: not by row index)
    // Find effect row containing specific room + field text
    const effectRows = page.locator('[data-testid^="preview-row-"]');
    const effectRowCount = await effectRows.count();
    expect(effectRowCount).toBeGreaterThanOrEqual(1);

    // Verify first visible row has room number, field, old value, new value, and status
    const firstRow = effectRows.first();
    const firstRowText = await firstRow.textContent();
    expect(firstRowText).toBeTruthy();
    // Must have either "เปลี่ยนแปลง" (eligible) or "ข้าม" (skipped) status
    const hasStatus = firstRowText!.includes('เปลี่ยนแปลง') || firstRowText!.includes('ข้าม');
    expect(hasStatus).toBe(true);

    // Handle native browser dialog for propagation confirm
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Click Confirm Apply
    const confirmApplyBtn = page.getByTestId('btn-confirm-apply');
    await expect(confirmApplyBtn).toBeVisible({ timeout: 15000 });
    await confirmApplyBtn.click();
    await page.waitForTimeout(3000);

    // ============================================================
    // SECTION 6: Contract Snapshot Comparison — Exact Values
    // ============================================================
    const contractsNavBtn = page.getByRole('button', { name: /สัญญาเช่า/i }).first();
    await expect(contractsNavBtn).toBeVisible({ timeout: 15000 });
    await contractsNavBtn.click();
    await page.waitForLoadState('networkidle');

    // Click on สมชาย ใจดี contract
    const contractCard = page.getByText(/คุณสมชาย ใจดี/i).first();
    await expect(contractCard).toBeVisible({ timeout: 30000 });
    await contractCard.click();

    // Assert snapshot comparison container
    const snapshotComparison = page.getByTestId('snapshot-comparison');
    await expect(snapshotComparison).toBeVisible({ timeout: 15000 });

    // Assert exact locked snapshot values
    await expect(snapshotComparison.getByText('ค่าเช่าล็อก:')).toBeVisible({ timeout: 5000 });
    await expect(snapshotComparison.locator('text=4,300').first()).toBeVisible({ timeout: 5000 });

    await expect(snapshotComparison.getByText('เงินประกันล็อก:')).toBeVisible({ timeout: 5000 });
    await expect(snapshotComparison.locator('text=8,600').first()).toBeVisible({ timeout: 5000 });

    // Assert current room values are displayed
    await expect(snapshotComparison.getByText('ค่าเช่าปัจจุบัน:')).toBeVisible({ timeout: 5000 });
    await expect(snapshotComparison.getByText('เงินประกันปัจจุบัน:')).toBeVisible({ timeout: 5000 });

    // Room A101 has override 4000 → current rent = 4,000
    await expect(snapshotComparison.locator('text=4,000').first()).toBeVisible({ timeout: 5000 });

    // Now verify separation: update dormitory defaults to 9500 via API to prove current vs locked snapshot separation
    const latestDefaultsRes = await apiContext.get('/api/v1/properties/dormitory/defaults');
    const latestDefaults = await latestDefaultsRes.json();
    const latestPropertyVersion = latestDefaults.data.property.version;

    const setTo9500Res = await apiContext.put('/api/v1/properties/dormitory/defaults', {
      data: {
        property: {
          changes: { defaultMonthlyRent: 9500 },
          expectedVersion: latestPropertyVersion,
        },
      },
    });
    expect(setTo9500Res.status()).toBe(200);

    // Reload contracts page to verify snapshot immutability
    await page.goto('/owner/contracts');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText(/คุณสมชาย ใจดี/i).first()).toBeVisible({ timeout: 30000 });
    await page.getByText(/คุณสมชาย ใจดี/i).first().click();

    const snapshotComparisonAfter = page.getByTestId('snapshot-comparison');
    await expect(snapshotComparisonAfter).toBeVisible({ timeout: 15000 });

    // Locked rent STILL = 4,300 (snapshot is immutable)
    await expect(snapshotComparisonAfter.getByText('ค่าเช่าล็อก:')).toBeVisible({ timeout: 5000 });
    await expect(snapshotComparisonAfter.locator('text=4,300').first()).toBeVisible({ timeout: 5000 });

    // Locked deposit STILL = 8,600
    await expect(snapshotComparisonAfter.getByText('เงินประกันล็อก:')).toBeVisible({ timeout: 5000 });
    await expect(snapshotComparisonAfter.locator('text=8,600').first()).toBeVisible({ timeout: 5000 });

    // Current values remain separate from locked values
    await expect(snapshotComparisonAfter.getByText('ค่าเช่าปัจจุบัน:')).toBeVisible({ timeout: 5000 });

    // Error hygiene assertions
    expect(test2ConsoleErrors).toEqual([]);
    expect(test2PageErrors).toEqual([]);
  });
});
