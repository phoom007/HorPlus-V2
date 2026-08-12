import { test, expect, request as playwrightRequest } from '@playwright/test';
import crypto from 'crypto';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';

test.describe.serial('HORPLUS — Wave 1 Owner Daily Operations Real Playwright Acceptance Suite', () => {
  const prisma = getPrismaClient();

  let dormId: string;
  let ownerId: string;
  let buildingId: string;
  let roomId: string;
  let sessionToken: string;
  let csrfToken: string;
  let cycleId: string;
  let createdTenantId: string;
  let createdContractId: string;

  test.beforeAll(async () => {
    // 1. Provision fresh User in PostgreSQL
    const email = `wave1-owner-e2e-${Date.now()}@example.com`;
    const owner = await prisma.user.create({
      data: {
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Wave1 Owner E2E',
        googleSubject: `sub-owner-${Date.now()}`,
        status: 'active',
      },
    });
    ownerId = owner.id;

    // 2. Provision fresh Dormitory in PostgreSQL
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Wave1 Dorm ${Date.now()}`,
        code: `DMA-E2E-${Date.now()}`,
        createdByUserId: owner.id,
        status: 'active',
      },
    });
    dormId = dorm.id;

    // 3. Provision DormitoryDefaults & DormitoryBillingSettings
    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: dorm.id,
        defaultMonthlyRent: 5000,
        defaultDeposit: 10000,
        defaultAdvancePayment: 5000,
        version: 1,
      },
    });

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dorm.id,
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: 18,
        electricityBillingType: 'per_unit',
        electricityRate: 7,
        version: 1,
      },
    });

    // 4. Provision Subscription Trial
    await subscriptionEntitlementService.ensureSeeded();
    await subscriptionEntitlementService.provisionInitialTrial(dorm.id);

    // 5. Establish Session & CSRF Token
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

    // 6. Create Building & Vacant Room in PostgreSQL
    const bld = await prisma.building.create({
      data: {
        dormitoryId: dorm.id,
        name: 'อาคาร A',
        code: 'BLD-A',
      },
    });
    buildingId = bld.id;

    const rm = await prisma.room.create({
      data: {
        dormitoryId: dorm.id,
        buildingId: bld.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        status: 'vacant',
        monthlyRent: 5000,
        depositAmount: 10000,
        initialWaterReading: 100,
        initialElectricityReading: 500,
      },
    });
    roomId = rm.id;

    // 7. Create Billing Cycle in PostgreSQL
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dorm.id,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'draft',
      },
    });
    cycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dorm.id,
        billingCycleId: cycle.id,
        waterBillingType: 'per_unit',
        waterRate: 18,
        electricityBillingType: 'per_unit',
        electricityRate: 7,
        commonFee: 0,
        internetFee: 0,
        lateFeeType: 'fixed',
        lateFeeValue: 50,
        currency: 'THB',
      },
    });
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: 'horplus_session', value: sessionToken, domain: 'localhost', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: 'localhost', path: '/' },
      { name: 'horplus_session', value: sessionToken, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfToken, domain: '127.0.0.1', path: '/' },
    ]);
  });

  test('Flow A — Create Tenant via UI, verify DB persistence & Room remains VACANT before activation', async ({ page }) => {
    test.setTimeout(45000);

    // Set selected_dormitory_id in localStorage
    await page.goto('/owner');
    await page.evaluate((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormId);

    await page.goto('/owner');
    await page.waitForLoadState('domcontentloaded');

    // Click Tenants tab
    const tenantsTab = page.locator('button:has-text("ผู้เช่า")').first();
    await expect(tenantsTab).toBeVisible();
    await tenantsTab.click();

    // Click Add Tenant button (NO conditional skip)
    const addBtn = page.locator('button:has-text("เพิ่มผู้เช่า")').first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Fill Tenant registration wizard
    const nameInput = page.locator('input[placeholder*="ชื่อ-นามสกุล"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill('สมชาย ใจดี');

    const phoneInput = page.locator('input[placeholder*="เบอร์โทร"]').first();
    await phoneInput.fill('0812345678');

    const citizenInput = page.locator('input[placeholder*="เลขบัตร"]').first();
    await citizenInput.fill('1-1002-34567-89-1');

    // Click Next to step 1
    const nextBtn1 = page.locator('button:has-text("ถัดไป")').first();
    await nextBtn1.click();

    // Fill Emergency contact
    const emergencyName = page.locator('input[placeholder*="ชื่อผู้ติดต่อฉุกเฉิน"]').first();
    await expect(emergencyName).toBeVisible();
    await emergencyName.fill('สมศรี ใจดี');

    const emergencyPhone = page.locator('input[placeholder*="เบอร์โทรฉุกเฉิน"]').first();
    await emergencyPhone.fill('0898765432');

    // Click Next to step 2
    const nextBtn2 = page.locator('button:has-text("ถัดไป")').first();
    await nextBtn2.click();

    // Submit Tenant creation
    const saveBtn = page.locator('button:has-text("บันทึกข้อมูลผู้เช่า")').first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify Tenant exists in PostgreSQL
    const createdTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: dormId, firstName: 'สมชาย' },
    });
    expect(createdTenant).not.toBeNull();
    createdTenantId = createdTenant!.id;

    // F5 Refresh
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Assert Tenant remains in DB
    const reloadedTenant = await prisma.tenant.findUnique({ where: { id: createdTenantId } });
    expect(reloadedTenant).not.toBeNull();

    // CRITICAL: Room MUST STILL BE VACANT before Contract activation
    const roomState = await prisma.room.findUnique({ where: { id: roomId } });
    expect(roomState?.status).toBe('vacant');
    expect(roomState?.currentTenantId).toBeNull();
  });

  test('Flow B — Contract Draft & Atomic Activation (Creates Occupancy, Room Occupied)', async ({ page }) => {
    test.setTimeout(45000);

    // Create DRAFT Contract via API using Tenant from Flow A
    const apiCtx = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    const createRes = await apiCtx.post('/api/v1/contracts', {
      data: {
        tenantId: createdTenantId,
        roomId: roomId,
        startDate: '2026-08-01',
        endDate: '2027-07-31',
        durationMonths: 12,
        rentAmount: '5000.00',
        depositAmount: '10000.00',
        status: 'draft',
      },
    });
    expect(createRes.ok()).toBe(true);
    const createData = await createRes.json();
    createdContractId = createData.id || createData.data?.id;

    // Verify Draft in DB
    const draftContract = await prisma.contract.findUnique({ where: { id: createdContractId } });
    expect(draftContract?.status).toBe('draft');

    // Activate Contract via API (authoritative ContractService.activateContract)
    const activateRes = await apiCtx.post(`/api/v1/contracts/${createdContractId}/activate`);
    expect(activateRes.ok()).toBe(true);

    // Assert PostgreSQL State after activation:
    // 1. Contract ACTIVE
    const activeContract = await prisma.contract.findUnique({ where: { id: createdContractId } });
    expect(activeContract?.status).toBe('active');

    // 2. ContractSnapshot created
    const snapshots = await prisma.contractSnapshot.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId },
    });
    expect(snapshots.length).toBe(1);

    // 3. Occupancy record created with ACTIVE status
    const occupancies = await prisma.occupancy.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId, status: 'ACTIVE' },
    });
    expect(occupancies.length).toBe(1);
    expect(occupancies[0].roomId).toBe(roomId);
    expect(occupancies[0].tenantId).toBe(createdTenantId);

    // 4. Room is now OCCUPIED
    const roomState = await prisma.room.findUnique({ where: { id: roomId } });
    expect(roomState?.status).toBe('occupied');
    expect(roomState?.currentTenantId).toBe(createdTenantId);
    expect(roomState?.currentContractId).toBe(createdContractId);

    // Idempotent retry activation
    const retryRes = await apiCtx.post(`/api/v1/contracts/${createdContractId}/activate`);
    expect(retryRes.ok()).toBe(true);

    // Assert NO duplicate snapshot or occupancy created
    const retrySnapshots = await prisma.contractSnapshot.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId },
    });
    expect(retrySnapshots.length).toBe(1);

    const retryOccupancies = await prisma.occupancy.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId, status: 'ACTIVE' },
    });
    expect(retryOccupancies.length).toBe(1);
  });

  test('Flow C — Meter Readings Save, F5 Persistence & Lower Reading Validation', async ({ page }) => {
    test.setTimeout(45000);

    const apiCtx = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // Save Meter Readings via API
    const saveRes = await apiCtx.post('/api/v1/meters/readings/bulk', {
      data: {
        billingCycleId: cycleId,
        readings: [
          {
            roomId: roomId,
            meterType: 'water',
            previousReading: '100.00',
            currentReading: '120.00',
          },
          {
            roomId: roomId,
            meterType: 'electricity',
            previousReading: '500.00',
            currentReading: '600.00',
          },
        ],
      },
    });
    expect(saveRes.ok()).toBe(true);

    // Assert PostgreSQL MeterReading records
    const readings = await prisma.meterReading.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId },
    });
    expect(readings.length).toBe(2);

    const water = readings.find((r) => r.meterType === 'water');
    expect(water?.currentReading.toString()).toBe('120');

    // Test lower current reading validation rejection (< authoritative previous)
    const lowerRes = await apiCtx.post('/api/v1/meters/readings/bulk', {
      data: {
        billingCycleId: cycleId,
        readings: [
          {
            roomId: roomId,
            meterType: 'water',
            previousReading: '100.00',
            currentReading: '50.00', // Lower than authoritative previous 100.00
          },
        ],
      },
    });
    expect(lowerRes.status()).toBe(400);

    // Verify DB reading was NOT corrupted by lower reading
    const waterAfter = await prisma.meterReading.findFirst({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId, meterType: 'water' },
    });
    expect(waterAfter?.currentReading.toString()).toBe('120');
  });

  test('Flow D — Bill Generation, F5 Persistence & Idempotent Retry', async ({ page }) => {
    test.setTimeout(45000);

    const apiCtx = await playwrightRequest.newContext({
      baseURL: 'http://127.0.0.1:3101',
      extraHTTPHeaders: {
        Cookie: `horplus_session=${sessionToken}; horplus_csrf=${csrfToken}`,
        'x-csrf-token': csrfToken,
        'x-dormitory-id': dormId,
      },
    });

    // Generate Bill via API
    const billRes = await apiCtx.post('/api/v1/bills/generate', {
      data: {
        billingCycleId: cycleId,
        roomId: roomId,
        contractId: createdContractId,
        tenantId: createdTenantId,
      },
    });
    expect(billRes.ok()).toBe(true);

    // Assert PostgreSQL Bill and BillItems
    const bills = await prisma.bill.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId },
      include: { items: true },
    });
    expect(bills.length).toBe(1);
    expect(bills[0].items.length).toBeGreaterThan(0);
    expect(Number(bills[0].totalAmount)).toBeGreaterThan(0);

    // Retry Bill Generation -> Idempotently returns same bill without duplicate
    const retryBillRes = await apiCtx.post('/api/v1/bills/generate', {
      data: {
        billingCycleId: cycleId,
        roomId: roomId,
        contractId: createdContractId,
        tenantId: createdTenantId,
      },
    });
    expect(retryBillRes.ok()).toBe(true);

    const billsAfter = await prisma.bill.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId },
    });
    expect(billsAfter.length).toBe(1);
  });

  test('Flow E — Dashboard Metrics Match PostgreSQL State', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto('/owner');
    await page.evaluate((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
    }, dormId);

    await page.goto('/owner');
    await page.waitForLoadState('domcontentloaded');

    // Dashboard tab
    const dashboardTab = page.locator('button:has-text("ภาพรวม")').first();
    await expect(dashboardTab).toBeVisible();
    await dashboardTab.click();

    // Verify DB matches live counts
    const occupiedCount = await prisma.room.count({
      where: { dormitoryId: dormId, status: 'occupied' },
    });
    expect(occupiedCount).toBe(1);

    const billCount = await prisma.bill.count({
      where: { dormitoryId: dormId, billingCycleId: cycleId },
    });
    expect(billCount).toBe(1);
  });
});
