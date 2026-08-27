import { test, expect } from '@playwright/test';
import { getPrismaClient } from '../../server/src/db/prisma.js';
import { SessionTokenService } from '../../server/src/services/session-token.service.js';
import { CsrfService } from '../../server/src/services/csrf.service.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { outboxService } from '../../server/src/services/outbox.service.js';
import crypto from 'crypto';

const prisma = getPrismaClient();
const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const csrfSecret = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';
const sessionTokenService = new SessionTokenService(sessionSecret);
const csrfService = new CsrfService(csrfSecret);

async function createIsolatedFixture(tag: string) {
  await subscriptionEntitlementService.ensureSeeded();

  // Create unique dormitory
  const dorm = await prisma.dormitory.create({
    data: {
      name: `HorPlus L06 ${tag}`,
      code: `L06-${tag}-${Date.now().toString().slice(-4)}`,
      type: 'apartment',
      status: 'active',
    },
  });
  const dormId = dorm.id;
  await subscriptionEntitlementService.provisionInitialTrial(dormId);

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

  const ownerUser = await prisma.user.create({
    data: {
      email: `owner_${tag}_${Date.now()}@test.com`,
      emailNormalized: `owner_${tag}_${Date.now()}@test.com`,
      name: 'เจ้าของ หอพัก',
      googleSubject: `sub-owner-${tag}-${Date.now()}`,
      status: 'active',
    },
  });
  const ownerUserId = ownerUser.id;

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
  const sessionTokenOwner = sessionTokenService.encryptToken({ sub: ownerUserId, sid: sidOwner, type: 'session', version: 1 }, 86400);
  const csrfTokenOwner = csrfService.generateCsrfToken(sidOwner);

  const tenantUser = await prisma.user.create({
    data: {
      email: `tenant_${tag}_${Date.now()}@test.com`,
      emailNormalized: `tenant_${tag}_${Date.now()}@test.com`,
      name: 'สมศักดิ์ ผู้เช่าหลัก',
      googleSubject: `sub-tenant-${tag}-${Date.now()}`,
      status: 'active',
    },
  });
  const tenantUserId = tenantUser.id;

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
      tenantNumber: `TNT-${tag.toUpperCase()}-${Date.now().toString().slice(-4)}`,
      firstName: 'สมศักดิ์',
      lastName: 'ผู้เช่าหลัก',
      displayName: 'สมศักดิ์ ผู้เช่าหลัก',
      phone: '0812345678',
      status: 'active',
    },
  });
  const tenantId = tenant.id;

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
  const sessionTokenTenant = sessionTokenService.encryptToken({ sub: tenantUserId, sid: sidTenant, type: 'session', version: 1 }, 86400);
  const csrfTokenTenant = csrfService.generateCsrfToken(sidTenant);

  const building = await prisma.building.create({
    data: {
      dormitoryId: dormId,
      name: 'อาคาร 1',
      floorCount: 3,
    },
  });

  const room = await prisma.room.create({
    data: {
      dormitoryId: dormId,
      buildingId: building.id,
      roomNumber: 'A102',
      normalizedRoomNumber: 'a102',
      roomType: 'standard',
      floor: 1,
      status: 'occupied',
      monthlyRent: 5000,
      currentTenantId: tenantId,
    },
  });
  const roomId = room.id;

  const contract = await prisma.contract.create({
    data: {
      dormitoryId: dormId,
      contractNumber: `CTR-${tag.toUpperCase()}-001`,
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

  await prisma.billingRateSnapshot.create({
    data: {
      dormitoryId: dormId,
      billingCycleId: cycle.id,
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

  return {
    dormId,
    buildingId: building.id,
    roomId,
    tenantId,
    tenantUserId,
    ownerUserId,
    cycleId: cycle.id,
    contractId: contract.id,
    sessionTokenOwner,
    csrfTokenOwner,
    sessionTokenTenant,
    csrfTokenTenant,
  };
}

test.describe('LOCAL-06: Co-Occupant & People Count UI Orchestration E2E', () => {
  // =========================================================================
  // Section 10: FOCUSED TENANT UI PLAYWRIGHT
  // =========================================================================
  test('10. Tenant real UI add & delete co-occupant with DB persistence and F5 proof', async ({ page, context }) => {
    const f = await createIsolatedFixture('t10');

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
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
        dormitoryId: f.dormId,
        tenantId: f.tenantId,
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
    const f = await createIsolatedFixture('t11');

    // Initial unpaid September bill
    const unpaidBill = await prisma.bill.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: f.cycleId,
        roomId: f.roomId,
        tenantId: f.tenantId,
        contractId: f.contractId,
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
          dormitoryId: f.dormId,
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
          dormitoryId: f.dormId,
          billId: unpaidBill.id,
          type: 'water',
          description: 'ค่าน้ำ (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: f.dormId,
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
      { name: 'horplus_session', value: f.sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // Locate room A102 row
    const roomRow = page.locator('#room-row-' + f.roomId);
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
          dormitoryId: f.dormId,
          billingCycleId: f.cycleId,
          roomId: f.roomId,
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
    const reloadedRow = page.locator('#room-row-' + f.roomId);
    await expect(reloadedRow).toBeVisible();
    const reloadedInput = reloadedRow.locator('input[data-col="peopleCount"]');
    await expect(reloadedInput).toHaveValue('2');
  });

  // =========================================================================
  // Section 12: DELTA TOAST PLAYWRIGHT
  // =========================================================================
  test('12. Delta Toast Playwright: previous = 1, current household = 2 shows "A102: จำนวนคน 1 → 2"', async ({ page, context }) => {
    const f = await createIsolatedFixture('t12');

    // 1. Add exactly 1 co-occupant to household (total household = 2)
    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: f.dormId,
        tenantId: f.tenantId,
        name: 'คุณสมใจ ร่วมห้อง',
        status: 'active',
      },
    });

    // 2. Set August previous cycle (2026-08) with bill & water item for 1 person
    const augCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: f.dormId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'completed',
      },
    });

    const augBill = await prisma.bill.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: augCycle.id,
        roomId: f.roomId,
        tenantId: f.tenantId,
        contractId: f.contractId,
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
        dormitoryId: f.dormId,
        billId: augBill.id,
        type: 'water',
        description: 'ค่าน้ำ (1 คน)',
        quantity: 1,
        unit: 'person',
        unitPrice: 100,
        amount: 100,
        metadata: { mode: 'person', peopleCount: 1 },
        displayOrder: 1,
      },
    });

    // Upsert meter devices so meter readings satisfy foreign key
    const waterDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: f.dormId,
        roomId: f.roomId,
        type: 'water',
        meterNumber: 'MTR-W-A102',
        status: 'active',
      },
    });

    const elecDevice = await prisma.meterDevice.create({
      data: {
        dormitoryId: f.dormId,
        roomId: f.roomId,
        type: 'electricity',
        meterNumber: 'MTR-E-A102',
        status: 'active',
      },
    });

    // Previous meter readings
    await prisma.meterReading.createMany({
      data: [
        {
          dormitoryId: f.dormId,
          billingCycleId: augCycle.id,
          roomId: f.roomId,
          meterDeviceId: waterDevice.id,
          meterType: 'water',
          previousReading: 100,
          currentReading: 120,
          usageUnits: 20,
          status: 'confirmed',
        },
        {
          dormitoryId: f.dormId,
          billingCycleId: augCycle.id,
          roomId: f.roomId,
          meterDeviceId: elecDevice.id,
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
      { name: 'horplus_session', value: f.sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // Click "ดึงข้อมูลก่อนหน้า" button
    const pullBtn = page.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/i });
    await expect(pullBtn).toBeVisible({ timeout: 5000 });
    await pullBtn.click();

    // Verify toast notification containing delta "A102: จำนวนคน 1 → 2"
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
    const f = await createIsolatedFixture('t13');

    // 1. Household = 2
    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: f.dormId,
        tenantId: f.tenantId,
        name: 'คุณสมใจ ร่วมห้อง',
        status: 'active',
      },
    });

    // 2. August previous cycle bill = 2 people
    const augCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: f.dormId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'completed',
      },
    });

    const augBill = await prisma.bill.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: augCycle.id,
        roomId: f.roomId,
        tenantId: f.tenantId,
        contractId: f.contractId,
        billNumber: 'INV-202608-UNCHANGED',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 5200,
        totalAmount: 5200,
        paidAmount: 5200,
        outstandingAmount: 0,
      },
    });

    await prisma.billItem.createMany({
      data: [
        {
          dormitoryId: f.dormId,
          billId: augBill.id,
          type: 'water',
          description: 'ค่าน้ำ (2 คน)',
          quantity: 2,
          unit: 'person',
          unitPrice: 100,
          amount: 200,
          metadata: { mode: 'person', peopleCount: 2 },
          displayOrder: 1,
        },
        {
          dormitoryId: f.dormId,
          billId: augBill.id,
          type: 'electricity',
          description: 'ค่าไฟฟ้า (50 หน่วย)',
          quantity: 50,
          unit: 'unit',
          unitPrice: 8,
          amount: 400,
          displayOrder: 2,
        },
      ],
    });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
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
  // Section 14: PAID BILL UI CASE WITH REAL NOTIFICATION VERIFICATION
  // =========================================================================
  test('14. Paid bill UI: paid bill remains immutable and notice explains change applies next cycle', async ({ page, context }) => {
    const f = await createIsolatedFixture('t14');

    // 1. Setup September paid bill in current active cycle (5100 total: 5000 rent + 100 water for 1 person)
    await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: f.cycleId,
        roomId: f.roomId,
        peopleCount: 1,
        source: 'HOUSEHOLD_SYNC',
      },
    });

    const paidBill = await prisma.bill.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: f.cycleId,
        roomId: f.roomId,
        tenantId: f.tenantId,
        contractId: f.contractId,
        billNumber: 'INV-202609-PAID-IMMUTABLE',
        status: 'paid',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        subtotal: 5100,
        totalAmount: 5100,
        paidAmount: 5100,
        outstandingAmount: 0,
      },
    });

    await prisma.billItem.create({
      data: {
        dormitoryId: f.dormId,
        billId: paidBill.id,
        type: 'water',
        description: 'ค่าน้ำ (1 คน)',
        quantity: 1,
        unit: 'person',
        unitPrice: 100,
        amount: 100,
        metadata: { mode: 'person', peopleCount: 1 },
        displayOrder: 1,
      },
    });

    // 2. Tenant adds co-occupant in Tenant Portal
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-testid="nav-tab-profile"]').click();
    await page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i }).click();

    await page.locator('input[placeholder="เช่น นายอานนท์ มั่นคง"]').fill('คุณสมนึก สมาชิกใหม่');
    await page.getByRole('button', { name: /เพิ่มลงในรายการด้านบน/i }).click();
    await expect(page.getByText('คุณสมนึก สมาชิกใหม่').first()).toBeVisible({ timeout: 5000 });

    // 3. Verify paid bill in DB remains strictly immutable
    const checkBillAfter = await prisma.bill.findUnique({
      where: { id: paidBill.id },
      include: { items: true },
    });
    expect(checkBillAfter?.status).toBe('paid');
    expect(Number(checkBillAfter?.totalAmount)).toBe(5100);
    expect(Number(checkBillAfter?.paidAmount)).toBe(5100);

    const waterItemAfter = checkBillAfter?.items.find((i) => i.type === 'water');
    expect(Number(waterItemAfter?.quantity)).toBe(1);
    expect(Number(waterItemAfter?.amount)).toBe(100);

    // Verify current cycle snapshot remains 1
    const cycleSnapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: f.dormId,
          billingCycleId: f.cycleId,
          roomId: f.roomId,
        },
      },
    });
    expect(cycleSnapshot?.peopleCount).toBe(1);

    // 4. Process outbox & verify Owner Bell in Real UI explains next-cycle behavior
    await outboxService.processPendingOutboxEvents();

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');

    // Click real Owner notification bell
    const ownerBell = page.locator('[data-testid="button-staff-notification-bell"]:visible').first();
    await expect(ownerBell).toBeVisible();
    await ownerBell.click();
    await page.waitForTimeout(500);

    // Assert Owner notice card is visible and explains change applies next cycle
    const ownerNoticeCard = page.locator('[data-testid^="staff-notice-item-"]').filter({ hasText: 'A102' }).first();
    await expect(ownerNoticeCard).toBeVisible({ timeout: 5000 });
    await expect(ownerNoticeCard.getByText(/งวดถัดไป/)).toBeVisible();
  });

  // =========================================================================
  // Section 15: REAL NOTIFICATION UI PROOFS VIA DOMAIN MUTATIONS
  // =========================================================================
  test('15. Notification UI: Owner bell and Tenant bell show proper notices in real UI via real domain mutations after outbox processing', async ({ page, context }) => {
    const f = await createIsolatedFixture('t15');

    // 1. Create an unpaid September bill for 1 person (5300: 5000 rent + 100 water 1 person + 200 common fee 1 person)
    const unpaidBill = await prisma.bill.create({
      data: {
        dormitoryId: f.dormId,
        billingCycleId: f.cycleId,
        roomId: f.roomId,
        tenantId: f.tenantId,
        contractId: f.contractId,
        billNumber: 'INV-202609-NOTIF',
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
          dormitoryId: f.dormId,
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
          dormitoryId: f.dormId,
          billId: unpaidBill.id,
          type: 'water',
          description: 'ค่าน้ำ (1 คน)',
          quantity: 1,
          unit: 'person',
          unitPrice: 100,
          amount: 100,
          metadata: { mode: 'person', peopleCount: 1 },
          displayOrder: 1,
        },
        {
          dormitoryId: f.dormId,
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

    // 2. Flow A: Tenant adds co-occupant via UI -> generates real outbox event for Staff
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');
    await page.locator('button[data-testid="nav-tab-profile"]').click();
    await page.getByRole('button', { name: /แก้ไข \/ เพิ่ม/i }).click();

    await page.locator('input[placeholder="เช่น นายอานนท์ มั่นคง"]').fill('คุณวิไล ร่วมอาศัย');
    await page.getByRole('button', { name: /เพิ่มลงในรายการด้านบน/i }).click();
    await expect(page.getByText('คุณวิไล ร่วมอาศัย').first()).toBeVisible({ timeout: 5000 });

    // Process outbox to materialize StaffNotification from real Tenant action
    await outboxService.processPendingOutboxEvents();

    // 3. Flow A Verification: Owner Browser opens real Notification Bell
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/dashboard');
    await page.waitForLoadState('networkidle');

    // Click real Owner notification bell
    const ownerBell = page.locator('[data-testid="button-staff-notification-bell"]:visible').first();
    await expect(ownerBell).toBeVisible();
    await ownerBell.click();
    await page.waitForTimeout(500);

    // Assert specific notification card containing BOTH 'A102' AND 'ผู้พักร่วม'
    const ownerNoticeCard = page.locator('[data-testid^="staff-notice-item-"]').filter({ hasText: 'A102' }).filter({ hasText: 'ผู้พักร่วม' }).first();
    await expect(ownerNoticeCard).toBeVisible({ timeout: 5000 });
    await expect(ownerNoticeCard.getByRole('heading', { name: /ห้อง A102/ })).toBeVisible();
    await expect(ownerNoticeCard.getByText(/ผู้พักร่วม/).first()).toBeVisible();

    // 4. Flow B: Real Owner Meter UI domain mutation -> generates real outbox event for Tenant
    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    const roomRow = page.locator('#room-row-' + f.roomId);
    await expect(roomRow).toBeVisible();
    const peopleInputLoc = roomRow.locator('input[data-col="peopleCount"]');
    await expect(peopleInputLoc).toBeVisible();
    await peopleInputLoc.fill('3');

    const saveBtn = page.getByRole('button', { name: /บันทึกข้อมูลค่ามิเตอร์/i });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(page.getByText('บันทึกข้อมูลค่ามิเตอร์เรียบร้อยแล้ว')).toBeVisible({ timeout: 5000 });

    // Process outbox to materialize TenantNotice from real Owner action
    await outboxService.processPendingOutboxEvents();

    // 5. Flow B Verification: Tenant Browser opens real Notification Bell
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: f.sessionTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: f.csrfTokenTenant, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: f.dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/tenant');
    await page.waitForLoadState('networkidle');

    // Open notification modal via bell icon (mandatory, no conditional)
    const tenantBell = page.locator('button[aria-label="การแจ้งเตือน"]').first();
    await expect(tenantBell).toBeVisible({ timeout: 5000 });
    await tenantBell.click();
    await page.waitForTimeout(500);

    // Assert tenant notice item is visible in modal with real domain text
    const tenantNoticeCard = page.locator('[data-testid^="tenant-notice-item-"]').filter({ hasText: 'A102' }).first();
    await expect(tenantNoticeCard).toBeVisible({ timeout: 5000 });
    await expect(tenantNoticeCard.getByRole('heading', { name: /A102/ })).toBeVisible();
    await expect(tenantNoticeCard.getByText(/ยอดรอชำระ|จำนวนคน/)).toBeVisible();

    // 6. Secondary DB assertions for StaffNotification & TenantNotice
    const staffNotice = await prisma.staffNotification.findFirst({
      where: {
        dormitoryId: f.dormId,
        title: { contains: 'ผู้พักร่วม' },
      },
    });
    expect(staffNotice).not.toBeNull();
    expect(staffNotice?.message).toContain('A102');

    const tenantNotice = await prisma.tenantNotice.findFirst({
      where: {
        dormitoryId: f.dormId,
        tenantId: f.tenantId,
      },
    });
    expect(tenantNotice).not.toBeNull();
    expect(tenantNotice?.message).toContain('A102');
  });
});
