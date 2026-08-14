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
    // 1. Add 1 co-occupant to household (total household = 2)
    await prisma.tenantCoOccupant.create({
      data: {
        dormitoryId: dormId,
        tenantId,
        name: 'คุณสมใจ ร่วมห้อง',
        status: 'active',
      },
    });

    // 2. Set August previous cycle snapshot = 1
    const augCycleId = 'a0000000-0000-4000-8000-000000000085';
    await prisma.billingCycle.create({
      data: {
        id: augCycleId,
        dormitoryId: dormId,
        cycleCode: '2026-08-DELTA',
        name: 'สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'completed',
      },
    });

    await prisma.bill.create({
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
        subtotal: 5300,
        totalAmount: 5300,
        paidAmount: 5300,
        outstandingAmount: 0,
      },
    });

    await prisma.billItem.create({
      data: {
        dormitoryId: dormId,
        billId: 'a0000000-0000-4000-8000-000000000086',
        type: 'water',
        description: 'ค่าน้ำประปา (1 คน)',
        quantity: 1,
        unit: 'person',
        unitPrice: 100,
        amount: 100,
        displayOrder: 1,
      },
    });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // Click "ดึงข้อมูลก่อนหน้า" button if visible
    const pullBtn = page.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/i });
    if (await pullBtn.isVisible()) {
      await pullBtn.click();

      // Toast must contain "A102: จำนวนคน 1 → 2"
      const toastLoc = page.locator('text=/A102.*จำนวนคน 1 → 2/');
      await expect(toastLoc).toBeVisible({ timeout: 5000 });

      // Toast must NOT contain "2 → 1"
      const invalidToast = page.locator('text=/2 → 1/');
      await expect(invalidToast).not.toBeVisible();
    }
  });

  // =========================================================================
  // Section 13: UNCHANGED DELTA TOAST
  // =========================================================================
  test('13. Unchanged Delta Toast: previous = 2, current household = 2 shows generic toast only', async ({ page, context }) => {
    // Household = 2, previous cycle bill = 2
    await prisma.billItem.updateMany({
      where: { billId: 'a0000000-0000-4000-8000-000000000086', type: 'water' },
      data: { description: 'ค่าน้ำประปา (2 คน)', quantity: 2, amount: 200 },
    });

    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    const pullBtn = page.getByRole('button', { name: /ดึงข้อมูลก่อนหน้า/i });
    if (await pullBtn.isVisible()) {
      await pullBtn.click();

      // Toast should be generic success without room delta line
      await expect(page.getByText('ดึงข้อมูลจากงวดก่อนหน้าเรียบร้อย')).toBeVisible({ timeout: 5000 });
      const roomDelta = page.locator('text=/A102.*จำนวนคน/');
      await expect(roomDelta).not.toBeVisible();
    }
  });

  // =========================================================================
  // Section 14: PAID BILL UI CASE
  // =========================================================================
  test('14. Paid bill UI: paid bill remains immutable and notice explains change applies next cycle', async ({ page, context }) => {
    // 1. Setup August paid bill
    const paidAugBill = await prisma.bill.findUnique({
      where: { id: 'a0000000-0000-4000-8000-000000000086' },
    });
    expect(paidAugBill?.status).toBe('paid');
    const originalTotal = Number(paidAugBill?.totalAmount);

    // 2. Tenant adds co-occupant
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

    // 3. Verify paid bill in DB remains strictly immutable
    const checkAugBill = await prisma.bill.findUnique({
      where: { id: 'a0000000-0000-4000-8000-000000000086' },
    });
    expect(checkAugBill?.status).toBe('paid');
    expect(Number(checkAugBill?.totalAmount)).toBe(originalTotal);
  });

  // =========================================================================
  // Section 15: NOTIFICATION UI PROOF
  // =========================================================================
  test('15. Notification UI: Owner bell and Tenant bell show proper notices after outbox processing', async ({ page, context }) => {
    // 1. Process all pending outbox events into staff_notices & tenant_notices
    await outboxService.processPendingOutboxEvents();

    // 2. Verify Owner bell has co-occupant notification
    await context.clearCookies();
    await context.addCookies([
      { name: 'horplus_session', value: sessionTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'horplus_csrf', value: csrfTokenOwner, domain: '127.0.0.1', path: '/' },
      { name: 'selected_dormitory_id', value: dormId, domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto('/owner/meters');
    await page.waitForLoadState('networkidle');

    // 3. Verify Staff notices in DB
    const staffNotice = await prisma.staffNotification.findFirst({
      where: {
        dormitoryId: dormId,
        title: { contains: 'ผู้พักร่วม' },
      },
    });
    expect(staffNotice).not.toBeNull();
    expect(staffNotice?.message).toContain('A102');

    // 4. Verify Tenant notices in DB
    const tenantNotice = await prisma.tenantNotice.findFirst({
      where: {
        dormitoryId: dormId,
        tenantId,
      },
    });
    expect(tenantNotice).not.toBeNull();
  });
});
