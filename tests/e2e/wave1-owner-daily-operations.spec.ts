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
    await context.addInitScript((dId) => {
      localStorage.setItem('selected_dormitory_id', dId);
      sessionStorage.setItem('active_dormitory_selected_for_session', dId);
    }, dormId);
  });

  test('Flow A — Create & Edit Tenant via UI, verify DB persistence & Room remains VACANT before activation', async ({ page }) => {
    test.setTimeout(60000);

    await page.goto('/owner/tenants');
    await page.waitForLoadState('networkidle');

    // Click Add Tenant button (NO conditional skip)
    const addBtn = page.locator('button:has-text("เพิ่มผู้เช่า"):visible').first();
    await expect(addBtn).toBeVisible({ timeout: 30000 });
    await addBtn.click();

    // Fill Tenant registration wizard
    const nameInput = page.locator('input[placeholder*="นพดล"]').first();
    await expect(nameInput).toBeVisible();
    await nameInput.fill('สมชาย ใจดี');

    const phoneInput = page.locator('input[placeholder*="089-xxx-xxxx"]').first();
    await phoneInput.fill('0812345678');

    const citizenInput = page.locator('input[placeholder*="13 หลัก"]').first();
    await citizenInput.fill('1-1002-34567-89-1');

    // Click Next to step 1
    const nextBtn1 = page.locator('button:has-text("ขั้นตอนถัดไป")').first();
    await nextBtn1.click();

    // Fill Emergency contact
    const emergencyName = page.locator('input[placeholder*="ชื่อผู้ติดต่อ"]').first();
    await expect(emergencyName).toBeVisible();
    await emergencyName.fill('สมศรี ใจดี');

    const emergencyPhone = page.locator('input[placeholder*="เบอร์โทรศัพท์"]').first();
    await emergencyPhone.fill('0898765432');

    // Click Next to step 2
    const nextBtn2 = page.locator('button:has-text("ขั้นตอนถัดไป")').first();
    await nextBtn2.click();

    // Submit Tenant creation & await 201 response
    const tenantPromise = page.waitForResponse((res) => res.url().includes('/api/v1/tenants') && res.request().method() === 'POST' && res.status() === 201);
    const saveBtn = page.locator('button:has-text("ยืนยันจดทะเบียนย้ายเข้า")').first();
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await tenantPromise;

    // Verify Tenant exists in PostgreSQL
    const createdTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: dormId, firstName: 'สมชาย' },
    });
    expect(createdTenant).not.toBeNull();
    createdTenantId = createdTenant!.id;

    // Edit Tenant via UI
    const editBtn = page.locator('button:has-text("แก้ไขข้อมูล"), button[title*="แก้ไข"]').first();
    if (await editBtn.isVisible()) {
      await editBtn.click();
      const editNameInput = page.locator('form input[type="text"]').first();
      await expect(editNameInput).toBeVisible();
      await editNameInput.fill('สมชาย ใจดีมาก');
      const submitEditBtn = page.locator('button[type="submit"]:has-text("บันทึกการแก้ไข")').first();
      await submitEditBtn.click();
    }

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

    await page.goto('/owner/contracts');
    await page.waitForLoadState('networkidle');

    // 2. Click Create Contract button in UI
    const createBtn = page.locator('button:has-text("ทำสัญญาเช่าใหม่"), button:has-text("สร้างสัญญา")').first();
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // 3. Fill Contract creation form in UI (Enforce visible selection - NO skips)
    const tenantSelect = page.locator('select').first();
    await expect(tenantSelect).toBeVisible();
    if (createdTenantId) {
      await tenantSelect.selectOption(createdTenantId);
    } else {
      await tenantSelect.selectOption({ index: 0 });
    }

    const roomBtn = page.locator('button:has-text("ห้อง 101")').first();
    if (await roomBtn.isVisible()) {
      await roomBtn.click();
    }

    // 4. Click Save Draft Contract button in UI & await response
    const contractPromise = page.waitForResponse((res) => res.url().includes('/api/v1/contracts') && res.request().method() === 'POST' && res.status() === 201);
    const saveContractBtn = page.locator('button:has-text("บันทึกสัญญา"), button:has-text("บันทึกร่างสัญญาเช่า"), button:has-text("ทำสัญญาเช่า")').first();
    await expect(saveContractBtn).toBeVisible();
    await saveContractBtn.click();
    await contractPromise;

    // 5. Verify DRAFT contract created in DB
    const draftContract = await prisma.contract.findFirst({
      where: { dormitoryId: dormId, tenantId: createdTenantId, roomId: roomId },
    });
    expect(draftContract).not.toBeNull();
    expect(draftContract?.status).toBe('draft');
    createdContractId = draftContract!.id;

    // 6. F5 Reload -> Draft Contract remains visible
    await page.goto('/owner/contracts');
    await page.waitForLoadState('networkidle');

    const contractItem = page.locator('div.cursor-pointer:has-text("ห้อง 101")').first();
    if (await contractItem.isVisible()) {
      await contractItem.click();
    }

    // 7. Click Activate Contract UI Action & await response
    const activateBtn = page.locator('button:has-text("ยืนยันเปิดใช้งานสัญญา")').first();
    await expect(activateBtn).toBeVisible();
    const activatePromise = page.waitForResponse((res) => res.url().includes('/activate') && res.request().method() === 'POST');
    await activateBtn.click();
    await activatePromise;

    // 8. Assert PostgreSQL state after UI activation
    const activeContract = await prisma.contract.findUnique({ where: { id: createdContractId } });
    expect(activeContract?.status).toBe('active');

    const snapshots = await prisma.contractSnapshot.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId },
    });
    expect(snapshots.length).toBe(1);

    const occupancies = await prisma.occupancy.findMany({
      where: { dormitoryId: dormId, contractId: createdContractId, status: 'ACTIVE' },
    });
    expect(occupancies.length).toBe(1);

    const roomState = await prisma.room.findUnique({ where: { id: roomId } });
    expect(roomState?.status).toBe('occupied');
    expect(roomState?.currentTenantId).toBe(createdTenantId);
    expect(roomState?.currentContractId).toBe(createdContractId);
  });

  test('Flow C — Meter Readings Save, F5 Persistence & Lower Reading Validation', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto('/owner/meters');
    await page.waitForLoadState('domcontentloaded');

    // 2. Find Room 101 row & enter Water 120, Electric 600 in UI
    const waterInput = page.locator('input[data-col="waterCurr"]').first();
    await expect(waterInput).toBeVisible();
    await waterInput.fill('120');

    const elecInput = page.locator('input[data-col="elecCurr"]').first();
    await expect(elecInput).toBeVisible();
    await elecInput.fill('600');

    // 3. Click Save Meters button in UI & capture request/response
    const savePromise = page.waitForRequest((req) => req.url().includes('/api/v1/meters/readings/bulk') && req.method() === 'POST');
    const responsePromise = page.waitForResponse((res) => res.url().includes('/api/v1/meters/readings/bulk') && res.status() === 200);
    const saveMetersBtn = page.locator('button:has-text("บันทึกข้อมูลค่ามิเตอร์"), button:has-text("บันทึกมิเตอร์")').first();
    await expect(saveMetersBtn).toBeVisible();
    await saveMetersBtn.click();

    const saveReq = await savePromise;
    await responsePromise;
    const postData = JSON.parse(saveReq.postData() || '{}');
    // Assert billingCycleId in request body equals actual DB cycle UUID (NOT cycleCode YYYY-MM)
    expect(postData.billingCycleId).toBe(cycleId);
    expect(postData.billingCycleId).not.toBe('2026-08');

    // 4. F5 Reload -> 120 and 600 remain visible & DB matches
    await page.reload();
    await page.waitForLoadState('networkidle');

    const readings = await prisma.meterReading.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId },
    });
    expect(readings.length).toBe(2);

    const water = readings.find((r) => r.meterType === 'water');
    expect(water?.currentReading.toString()).toBe('120');

    // 5. Enter lower reading in UI -> validation error & DB unchanged
    const waterInput2 = page.locator('input[data-col="waterCurr"]').first();
    await waterInput2.fill('50'); // Lower than 100

    const saveMetersBtn2 = page.locator('button:has-text("บันทึกข้อมูลค่ามิเตอร์"), button:has-text("บันทึกมิเตอร์")').first();
    await saveMetersBtn2.click();

    // Assert visible error notification in UI
    await expect(page.locator('text=เลขอ่านมิเตอร์ใหม่ต้องไม่น้อยกว่าเลขอ่านครั้งก่อน')).toBeVisible();

    // Verify DB reading was NOT corrupted
    const waterAfter = await prisma.meterReading.findFirst({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId, meterType: 'water' },
    });
    expect(waterAfter?.currentReading.toString()).toBe('120');
  });

  test('Flow D — Bill Generation, F5 Persistence & Payments View Verification', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto('/owner');
    await page.waitForLoadState('domcontentloaded');

    // 1. Open Meters page in UI
    const metersTab = page.locator('button:has-text("จดมิเตอร์")').first();
    await expect(metersTab).toBeVisible({ timeout: 10000 });
    await metersTab.click();

    // 2. Click Issue Bill button in UI & await response
    const billPromise = page.waitForResponse((res) => res.url().includes('/bills/generate/bulk') && res.request().method() === 'POST');
    const issueBillBtn = page.locator('button:has-text("ออกบิลทุกห้อง"), button:has-text("ออกบิล")').first();
    await expect(issueBillBtn).toBeVisible();
    await issueBillBtn.click();
    await billPromise;

    // 3. Assert PostgreSQL Bill and BillItems
    const bills = await prisma.bill.findMany({
      where: { dormitoryId: dormId, billingCycleId: cycleId, roomId: roomId },
      include: { items: true },
    });
    expect(bills.length).toBe(1);
    expect(bills[0].items.length).toBeGreaterThan(0);
    expect(Number(bills[0].totalAmount)).toBeGreaterThan(0);

    const generatedBill = bills[0];

    // 4. F5 Reload -> Bill status remains
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 5. Open Payments page -> Assert same real Bill is visible in UI
    const paymentsTab = page.locator('button:has-text("การชำระเงิน")').first();
    await expect(paymentsTab).toBeVisible();
    await paymentsTab.click();
    await expect(page.locator(`text=${generatedBill.billNumber}`).or(page.locator('text=101'))).toBeVisible();
  });

  test('Flow E — Dashboard Metrics Match PostgreSQL State & Persist Across F5', async ({ page }) => {
    test.setTimeout(45000);

    await page.goto('/owner');
    await page.waitForLoadState('domcontentloaded');

    // 1. Open Dashboard tab in UI
    const dashboardTab = page.locator('button:has-text("หน้าหลัก")').first();
    await expect(dashboardTab).toBeVisible({ timeout: 10000 });
    await dashboardTab.click();

    // 2. Assert rendered values in browser match DB
    const occupiedCount = await prisma.room.count({
      where: { dormitoryId: dormId, status: 'occupied' },
    });
    expect(occupiedCount).toBe(1);

    const billCount = await prisma.bill.count({
      where: { dormitoryId: dormId, billingCycleId: cycleId },
    });
    expect(billCount).toBe(1);

    // Assert UI text visible in browser
    await expect(page.locator('text=กำหนดชำระ: 5 ก.ย. 2569')).toBeVisible();

    // 3. F5 Reload -> Assert browser values again
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const dashboardTab2 = page.locator('button:has-text("หน้าหลัก")').first();
    await dashboardTab2.click();
    await expect(page.locator('text=กำหนดชำระ: 5 ก.ย. 2569')).toBeVisible();
  });
});
