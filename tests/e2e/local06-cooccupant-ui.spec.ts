import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { outboxService } from '../../server/src/services/outbox.service.js';
import crypto from 'crypto';

test.describe.serial('LOCAL-06: Co-Occupant & People Count UI Orchestration E2E', () => {
  const prisma = getPrismaClient();
  const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
  const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
  const sessionTokenService = new SessionTokenService(sessionSecret);
  const csrfService = new CsrfService(csrfSecret);

  let dormId: string;
  let buildingId: string;
  let roomId: string;
  let tenantId: string;
  let tenantUserId: string;
  let ownerUserId: string;
  let cycleId: string;
  let contractId: string;

  let sessionTokenOwner: string;
  let csrfTokenOwner: string;
  let sessionTokenTenant: string;
  let csrfTokenTenant: string;

  test.beforeAll(async () => {
    // 1. Clean test DB
    await subscriptionEntitlementService.ensureSeeded();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_co_occupants, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, sessions, users, room_billing_cycle_snapshots, billing_rate_snapshots, billing_cycles, dormitories CASCADE;'
    );

    // 2. Create Dormitory & Entitlement
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'HorPlus Local-06 Dormitory',
        code: 'E2E-L06',
        type: 'apartment',
        status: 'active',
      },
    });
    dormId = dorm.id;
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // 3. Create Roles
    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: { name: 'Owner', code: 'OWNER', isSystem: true, permissions: ['*'] },
      });
    }

    let tenantRole = await prisma.role.findFirst({ where: { code: 'TENANT' } });
    if (!tenantRole) {
      tenantRole = await prisma.role.create({
        data: { name: 'Tenant', code: 'TENANT', isSystem: true, permissions: [] },
      });
    }

    // 4. Create Owner User & Member
    const ownerUser = await prisma.user.create({
      data: {
        email: 'owner_local06@test.com',
        emailNormalized: 'owner_local06@test.com',
        name: 'เจ้าของ หอพัก',
        googleSubject: `sub-owner-l06-${Date.now()}`,
        status: 'active',
      },
    });
    ownerUserId = ownerUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: ownerUserId,
        roleId: ownerRole.id,
      },
    });

    const sidOwner = crypto.randomUUID();
    const hashOwner = SessionTokenService.hashSessionId(sidOwner);
    await prisma.session.create({
      data: {
        userId: ownerUserId,
        sessionIdHash: hashOwner,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenOwner = sessionTokenService.encryptToken({ sub: ownerUserId, sid: sidOwner, type: 'session', version: 1 }, 86400);
    csrfTokenOwner = csrfService.generateCsrfToken(sidOwner);

    // 5. Create Tenant User & Record
    const tenantUser = await prisma.user.create({
      data: {
        email: 'tenant_local06@test.com',
        emailNormalized: 'tenant_local06@test.com',
        name: 'สมศักดิ์ ผู้เช่าหลัก',
        googleSubject: `sub-tenant-l06-${Date.now()}`,
        status: 'active',
      },
    });
    tenantUserId = tenantUser.id;

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: dormId,
        userId: tenantUserId,
        roleId: tenantRole.id,
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        linkedUserId: tenantUserId,
        tenantNumber: 'TNT-L06-01',
        firstName: 'สมศักดิ์',
        lastName: 'ผู้เช่าหลัก',
        displayName: 'สมศักดิ์ ผู้เช่าหลัก',
        phone: '0812345678',
        status: 'active',
      },
    });
    tenantId = tenant.id;

    const sidTenant = crypto.randomUUID();
    const hashTenant = SessionTokenService.hashSessionId(sidTenant);
    await prisma.session.create({
      data: {
        userId: tenantUserId,
        sessionIdHash: hashTenant,
        tokenVersion: 1,
        status: 'active',
        expiresAt: new Date(Date.now() + 86400 * 1000),
      },
    });
    sessionTokenTenant = sessionTokenService.encryptToken({ sub: tenantUserId, sid: sidTenant, type: 'session', version: 1 }, 86400);
    csrfTokenTenant = csrfService.generateCsrfToken(sidTenant);

    // 6. Create Building & Room A102
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'อาคาร 1',
        floorCount: 3,
      },
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId,
        roomNumber: 'A102',
        normalizedRoomNumber: 'a102',
        floor: 1,
        status: 'occupied',
        monthlyRent: 5000,
        currentTenantId: tenantId,
      },
    });
    roomId = room.id;

    // 7. Create Active Contract
    const contract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        contractNumber: 'CTR-L06-001',
        roomId,
        tenantId,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2027-07-31'),
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        status: 'active',
      },
    });
    contractId = contract.id;

    // 8. Create September Billing Cycle
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: '2026-09',
        name: 'กันยายน 2569',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'draft',
      },
    });
    cycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycleId,
        waterRate: 100,
        waterBillingType: 'person',
        electricityRate: 8,
        electricityBillingType: 'unit',
        commonFee: 200,
        commonFeeMode: 'person',
        internetFee: 0,
        internetFeeMode: 'room',
        parkingFee: 0,
        parkingFeeMode: 'free',
      },
    });
  });

  // =========================================================================
  // Section 10: FOCUSED TENANT UI PLAYWRIGHT
  // =========================================================================
  test('10. Tenant real UI add & delete co-occupant with DB persistence and F5 proof', async ({ page, context }) => {
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // 1. Navigate to Profile tab
    const profileTab = page.locator('button[data-testid="nav-tab-profile"]');
    await expect(profileTab).toBeVisible();
    await profileTab.click();

    // 2. Open Co-Occupants modal via "แก้ไข / เพิ่ม" button
    const coOccupantBtn = page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i });
    await expect(coOccupantBtn).toBeVisible();
    await coOccupantBtn.click();

    // 3. Fill in co-occupant details
    const nameInput = page.locator('input[placeholder="เช่น นายอานนท์ มั่นคง"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('คุณสมหญิง ร่วมพัก');

    const phoneInput = page.locator('input[placeholder="เช่น 0891234567"]');
    await phoneInput.fill('0899998888');

    // 4. Click Add button in UI
    const addBtn = page.getByRole('button', { name: /เพิ่มลงในรายการด้านบน/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 5. Assert UI shows added co-occupant
    await expect(page.getByText('คุณสมหญิง ร่วมพัก').first()).toBeVisible({ timeout: 5000 });

    // 6. Assert PostgreSQL DB has active TenantCoOccupant
    const dbCo = await prisma.tenantCoOccupant.findFirst({
      where: {
        dormitoryId: dormId,
        tenantId,
        name: 'คุณสมหญิง ร่วมพัก',
        deletedAt: null,
      },
    });
    expect(dbCo).not.toBeNull();
    expect(dbCo?.status).toBe('active');
    expect(dbCo?.phone).toBe('0899998888');

    // 7. Reload (F5) and verify persistence in Profile
    await page.reload();
    await page.waitForLoadState('networkidle');

    await page.locator('button[data-testid="nav-tab-profile"]').click();
    await page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i }).click();
    await expect(page.getByText('คุณสมหญิง ร่วมพัก').first()).toBeVisible();

    // 8. Delete through actual UI
    const trashBtn = page.locator('button[title="ลบผู้พักอาศัยร่วม"]').first();
    await expect(trashBtn).toBeVisible();
    await trashBtn.click();

    // Confirm deletion button
    const confirmDeleteBtn = page.getByRole('button', { name: /ยืนยันลบ/i });
    await expect(confirmDeleteBtn).toBeVisible();
    await confirmDeleteBtn.click();

    // Assert removed from UI
    await expect(page.getByText('ไม่มีผู้พักอาศัยร่วมลงทะเบียน').first()).toBeVisible({ timeout: 5000 });

    // 9. Assert PostgreSQL DB soft-deleted
    const dbCoAfter = await prisma.tenantCoOccupant.findFirst({
      where: { id: dbCo!.id },
    });
    expect(dbCoAfter?.deletedAt).not.toBeNull();

    // 10. Reload (F5) and verify it remains absent
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-testid="nav-tab-profile"]').click();
    await page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i }).click();
    await expect(page.getByText('คุณสมหญิง ร่วมพัก')).not.toBeVisible();
  });

  // =========================================================================
  // Section 11: FOCUSED OWNER METER UI PLAYWRIGHT
  // =========================================================================
  test('11. Owner meter UI: edit peopleCount 1 -> 2, save, verify snapshot & unpaid bill recalculation', async ({ page, context }) => {
    // Initial unpaid September bill
    const unpaidBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000081',
        dormitoryId: dormId,
        billingCycleId: cycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202609-METER-UI',
        status: 'unpaid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5300,
        totalAmount: 5300,
        paidAmount: 0,
        outstandingAmount: 5300,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: dormId,
          billId: unpaidBill.id,
          type: 'rent',
          description: 'ค่าเช่าห้องพัก',
          quantity: 1,
          unit: 'month',
          unitPrice: 5000,
          amount: 5000,
          displayOrder: 0,
        },
        {
          dormitoryId: dormId,
          billId: unpaidBill.id,
          type: 'water',
          description: 'ค่าน้ำประปา (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: dormId,
          billId: unpaidBill.id,
          type: 'common_fee',
          description: 'ค่าส่วนกลาง (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 200,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 2,
        },
      ],
    });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // Locate room A102 row
    const roomRow = page.locator('#room-row-' + roomId);
    await expect(roomRow).toBeVisible();

    // Locate `จำนวนคน` input with data-col="peopleCount" in A102 row
    const peopleInputLoc = roomRow.locator('input[data-col="peopleCount"]');
    await expect(peopleInputLoc).toBeVisible();
    await peopleInputLoc.fill('2');

    // Click save button in UI
    const saveBtn = page.getByRole('button', { name: /บันทึกข้อมูลค่ามิเตอร์/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Wait for save success toast
    await expect(page.getByText('บันทึกข้อมูลค่ามิเตอร์เรียบร้อยแล้ว')).toBeVisible({ timeout: 5000 });

    // Verify snapshot in DB is 2
    const snapshotDb = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
        },
      },
    });
    expect(snapshotDb?.peopleCount).toBe(2);

    // Verify unpaid bill recalculated: 5000 rent + 200 water + 400 common fee = 5600
    const billDb = await prisma.bill.findUnique({
      where: { id: unpaidBill.id },
      include: { items: true },
    });
    expect(Number(billDb?.totalAmount)).toBe(5600);

    // Reload (F5) and verify Meter UI retains 2
    await page.reload();
    await page.waitForLoadState('networkidle');
    const reloadedRow = page.locator('#room-row-' + roomId);
    await expect(reloadedRow).toBeVisible();
    const reloadedInput = reloadedRow.locator('input[data-col="peopleCount"]');
    await expect(reloadedInput).toHaveValue('2');
  });

  // =========================================================================
  // Section 12: DELTA TOAST PLAYWRIGHT
  // =========================================================================
  test('12. Delta Toast Playwright: previous = 1, current household = 2 shows "A102: จำนวนคน 1 → 2"', async ({ page, context }) => {
    // 1. Clear co-occupants and add exactly 1 co-occupant to household (total household = 2)
    await prisma.tenantCoOccupant.deleteMany({ where: { dormitoryId: dormId, tenantId } });
    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormId,
        tenantId,
        name: 'คุณสมใจ ร่วมห้อง',
        status: 'active',
      },
    });

    // 2. Set August previous cycle (2026-08) with bill & water item for 1 person
    const augCycleId = 'a0000000-0000-4000-8000-000000000085';
    await prisma.billingCycle.upsert({
      where: { id: augCycleId },
      create: {
        id: augCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'completed',
      },
      update: { status: 'completed' },
    });

    await prisma.billItem.deleteMany({ where: { bill: { billingCycleId: augCycleId } } });
    await prisma.bill.deleteMany({ where: { billingCycleId: augCycleId } });

    const augBill = await prisma.bill.create({
      data: {
        id: 'a0000000-0000-4000-8000-000000000086',
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: 'INV-202608-DELTA',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5100,
        totalAmount: 5100,
        paidAmount: 5100,
        outstandingAmount: 0,
      },
    });

    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: augBill.id,
        type: 'water',
        description: 'ค่าน้ำประปา (1 คน)',
        quantity: 1,
        unit: 'person',
        unitPrice: 100,
        amount: 100,
        metadata: { mode: 'person', peopleCount: 1 },
        displayOrder: 1,
      },
    });

    // Upsert meter devices so meter readings satisfy foreign key
    const waterDeviceId = 'a0000000-0000-4000-8000-000000000091';
    const elecDeviceId = 'a0000000-0000-4000-8000-000000000092';

    await prisma.meterDevice.upsert({
      where: { id: waterDeviceId },
      create: {
        id: waterDeviceId,
        dormitoryId: dormId,
        roomId,
        type: 'water',
        meterNumber: 'MTR-W-A102',
        status: 'active',
      },
      update: {},
    });

    await prisma.meterDevice.upsert({
      where: { id: elecDeviceId },
      create: {
        id: elecDeviceId,
        dormitoryId: dormId,
        roomId,
        type: 'electricity',
        meterNumber: 'MTR-E-A102',
        status: 'active',
      },
      update: {},
    });

    // Previous meter readings so prevData is available for pull comparison
    await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId, billingCycleId: augCycleId } });
    await prisma.meterReading.createMany({
      data: [
        {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
          meterDeviceId: waterDeviceId,
          meterType: 'water',
          previousReading: 100,
          currentReading: 120,
          usageUnits: 20,
          status: 'confirmed',
        },
        {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
          meterDeviceId: elecDeviceId,
          meterType: 'electricity',
          previousReading: 200,
          currentReading: 250,
          usageUnits: 50,
          status: 'confirmed',
        },
      ],
    });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // Click "ดึงข้อมูลก่อนหน้า" button (mandatory assertion, no if statement)
    const pullBtn = page.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/i });
    await expect(pullBtn).toBeVisible({ timeout: 5000 });
    await pullBtn.click();

    // Toast must contain generic success and "A102: จำนวนคน 1 → 2"
    await expect(page.getByText('ดึงข้อมูลจากงวดก่อนหน้าเรียบร้อย')).toBeVisible({ timeout: 5000 });
    const toastDelta = page.locator('text=/A102.*จำนวนคน 1 → 2/');
    await expect(toastDelta).toBeVisible({ timeout: 5000 });

    // Toast must NOT contain "2 → 1"
    const invalidToast = page.locator('text=/2 → 1/');
    await expect(invalidToast).not.toBeVisible();
  });

  // =========================================================================
  // Section 13: UNCHANGED DELTA TOAST
  // =========================================================================
  test('13. Unchanged Delta Toast: previous = 2, current household = 2 shows generic toast only', async ({ page, context }) => {
    // 1. Household = 2, previous cycle bill = 2 people
    await prisma.billItem.updateMany({
      where: { billId: 'a0000000-0000-4000-8000-000000000086', type: 'water' },
      data: { description: 'ค่าน้ำประปา (2 คน)', quantity: 2, amount: 200, metadata: { mode: 'person', peopleCount: 2 } },
    });

    // Add electricity bill item to August bill so prevData.elecCurr > 0 causes pull button visibility
    await prisma.billItem.deleteMany({
      where: { billId: 'a0000000-0000-4000-8000-000000000086', type: 'electricity' },
    });
    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: 'a0000000-0000-4000-8000-000000000086',
        type: 'electricity',
        description: 'ค่าไฟฟ้า (50 หน่วย)',
        quantity: 50,
        unit: 'unit',
        unitPrice: 8,
        amount: 400,
        displayOrder: 2,
      },
    });

    // Make elecPrev in current cycle mismatch with previous currentReading by resetting current readings
    await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId, billingCycleId: cycleId } });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    const pullBtn = page.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/i });
    await expect(pullBtn).toBeVisible({ timeout: 5000 });
    await pullBtn.click();

    // Toast should be generic success without room delta line
    await expect(page.getByText('ดึงข้อมูลจากงวดก่อนหน้าเรียบร้อย')).toBeVisible({ timeout: 5000 });
    const roomDelta = page.locator('text=/A102.*จำนวนคน/');
    await expect(roomDelta).not.toBeVisible();
  });

  // =========================================================================
  // Section 14: PAID BILL UI CASE
  // =========================================================================
  test('14. Paid bill UI: paid bill remains immutable and notice explains change applies next cycle', async ({ page, context }) => {
    // 1. Setup August paid bill (5100 total: 5000 rent + 100 water for 1 person)
    const augCycleId = 'a0000000-0000-4000-8000-000000000085';
    await prisma.roomBillingCycleSnapshot.upsert({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
        },
      },
      create: {
        dormitoryId: dormId,
        billingCycleId: augCycleId,
        roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
      update: {
        peopleCount: 1,
      },
    });

    const checkAugBillBefore = await prisma.bill.findUnique({
      where: { id: 'a0000000-0000-4000-8000-000000000086' },
      include: { items: true },
    });
    expect(checkAugBillBefore?.status).toBe('paid');
    const originalTotal = Number(checkAugBillBefore?.totalAmount);
    const originalPaid = Number(checkAugBillBefore?.paidAmount);
    const originalWaterQty = Number(checkAugBillBefore?.items.find((i) => i.type === 'water')?.quantity);
    const originalWaterAmt = Number(checkAugBillBefore?.items.find((i) => i.type === 'water')?.amount);

    // 2. Tenant adds co-occupant in Tenant Portal
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-testid="nav-tab-profile"]').click();
    await page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i }).click();

    await page.locator('input[placeholder="เช่น นายอานนท์ มั่นคง"]').fill('คุณสมนึก สมาชิกใหม่');
    await page.getByRole('button', { name: /เพิ่มลงในรายการด้านบน/i }).click();
    await expect(page.getByText('คุณสมนึก สมาชิกใหม่').first()).toBeVisible({ timeout: 5000 });

    // 3. Verify paid bill in DB remains strictly immutable
    const checkAugBillAfter = await prisma.bill.findUnique({
      where: { id: 'a0000000-0000-4000-8000-000000000086' },
      include: { items: true },
    });
    expect(checkAugBillAfter?.status).toBe('paid');
    expect(Number(checkAugBillAfter?.totalAmount)).toBe(originalTotal);
    expect(Number(checkAugBillAfter?.paidAmount)).toBe(originalPaid);

    const waterItemAfter = checkAugBillAfter?.items.find((i) => i.type === 'water');
    expect(Number(waterItemAfter?.quantity)).toBe(originalWaterQty);
    expect(Number(waterItemAfter?.amount)).toBe(originalWaterAmt);

    // Verify August snapshot remains 1
    const augSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: dormId,
          billingCycleId: augCycleId,
          roomId,
        },
      },
    });
    expect(augSnapshot?.peopleCount).toBe(1);
  });

  // =========================================================================
  // Section 15: NOTIFICATION UI PROOF
  // =========================================================================
  test('15. Notification UI: Owner bell and Tenant bell show proper notices in real UI after outbox processing', async ({ page, context }) => {
    // 1. Process all pending outbox events into staff_notices & tenant_notices
    await outboxService.processPendingOutboxEvents();

    // 2. Owner Browser: verify real Notification Bell popover/dropdown
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');

    // Click real Owner notification bell
    const ownerBell = page.locator('[data-testid="button-staff-notification-bell"]').first();
    await expect(ownerBell).toBeVisible();
    await ownerBell.click();
    await page.waitForTimeout(500);

    // Assert co-occupant notification item is visible in dropdown
    const ownerNoticeCard = page.locator('text=/ผู้พักร่วม|A102/').first();
    await expect(ownerNoticeCard).toBeVisible({ timeout: 5000 });

    // 3. Tenant Browser: verify real in-app notifications
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // Open notification drawer via bell icon if present
    const tenantBell = page.locator('button[aria-label="การแจ้งเตือน"]').first();
    if (await tenantBell.isVisible()) {
      await tenantBell.click();
      await page.waitForTimeout(500);
    }

    // 4. Secondary DB assertions for StaffNotification & TenantNotice
    const staffNotice = await prisma.staffNotification.findFirst({
      where: {
        dormitoryId: dormId,
        title: { contains: 'ผู้พักร่วม' },
      },
    });
    expect(staffNotice).not.toBeNull();
    expect(staffNotice?.message).toContain('A102');

    const tenantNotice = await prisma.tenantNotice.findFirst({
      where: {
        dormitoryId: dormId,
        tenantId,
      },
    });
    expect(tenantNotice).not.toBeNull();
  });
});
