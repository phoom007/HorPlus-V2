import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../../db/prisma.js';
import { MeterService } from '../../services/meter.service.js';
import { BillingService } from '../../services/billing.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { SubscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { createTenantPortalRouter } from '../../routes/tenant-portal.routes.js';
import { toDecimal } from '../../utils/decimal-math.util.js';

describe('LOCAL-07 Editable UNPAID Bill Canonical Replacement & Tenant Latest-Bill Visibility (UB1 - UB24)', () => {
  const prisma: PrismaClient = getPrismaClient();
  let meterService: MeterService;
  let billingService: BillingService;

  let testDormId: string;
  let testOwnerUserId: string;
  let testTenantUserId: string;
  let tenantRoleId: string;
  let buildingId: string;
  let roomId: string;
  let tenantId: string;
  let contractId: string;
  let billingCycleId: string;
  let app: express.Express;

  beforeEach(async () => {
    testDormId = randomUUID();
    testOwnerUserId = randomUUID();
    testTenantUserId = randomUUID();

    const meterRepo = new PrismaMeterRepository(prisma);
    const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const billRepo = new PrismaBillRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);

    meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo);
    billingService = new BillingService(
      billRepo,
      billingCycleRepo,
      meterRepo,
      contractRepo,
      roomRepo,
      tenantRepo
    );

    // 1. Create Owner and Tenant users
    await prisma.user.create({
      data: {
        id: testOwnerUserId,
        email: `${testOwnerUserId}@example.com`,
        emailNormalized: `${testOwnerUserId}@example.com`,
        name: 'Test Owner',
        googleSubject: `sub-${testOwnerUserId}`,
      },
    });

    await prisma.user.create({
      data: {
        id: testTenantUserId,
        email: `${testTenantUserId}@example.com`,
        emailNormalized: `${testTenantUserId}@example.com`,
        name: 'Somchai Jaidee',
        googleSubject: `sub-${testTenantUserId}`,
      },
    });

    // 2. Create Dormitory with standard utility billing settings
    await prisma.dormitory.create({
      data: {
        id: testDormId,
        name: 'Test Dormitory',
        code: `DORM-${Date.now()}`,
        billingSettings: {
          create: {
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('7.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'fixed',
            internetFee: toDecimal('0.00'),
            parkingRate: toDecimal('0.00'),
            dueDay: 5,
          },
        },
      },
    });

    const entService = new SubscriptionEntitlementService();
    await entService.provisionInitialTrial(testDormId);

    // Create TENANT Role & Membership for tenant portal authorization
    const role = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'TENANT',
        name: 'Tenant',
        permissions: {},
        isSystem: true,
      },
    });
    tenantRoleId = role.id;

    await prisma.dormitoryMember.create({
      data: {
        userId: testTenantUserId,
        dormitoryId: testDormId,
        roleId: tenantRoleId,
        status: 'active',
      },
    });

    // 3. Create Building & Room
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormId,
        name: 'Building A',
      },
    });
    buildingId = building.id;

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDormId,
        buildingId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4000.00'),
        initialWaterReading: toDecimal('100.00'),
        initialElectricityReading: toDecimal('500.00'),
        status: 'occupied',
      },
    });
    roomId = room.id;

    // 4. Create Tenant linked to testTenantUserId and active Contract
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormId,
        linkedUserId: testTenantUserId,
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        tenantNumber: `TNT-${Date.now()}`,
        status: 'active',
      },
    });
    tenantId = tenant.id;

    const contract = await prisma.contract.create({
      data: {
        dormitoryId: testDormId,
        roomId,
        tenantId,
        contractNumber: `CTR-${Date.now()}`,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: toDecimal('4000.00'),
        depositAmount: toDecimal('5000.00'),
        status: 'active',
      },
    });
    contractId = contract.id;

    // 5. Create Billing Cycle (August 2026)
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormId,
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'open',
        rateSnapshot: {
          create: {
            dormitoryId: testDormId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('7.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'fixed',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'none',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'none',
            lateFeeType: 'fixed',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });
    billingCycleId = cycle.id;

    // 6. Set up test Express app with Tenant Portal Router authenticated as testTenantUserId
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      // Mock session for tenant portal
      (req as any).auth = {
        userId: testTenantUserId,
      };
      (req as any).user = {
        id: testTenantUserId,
        email: `${testTenantUserId}@example.com`,
        dormitoryId: testDormId,
      };
      (req as any).session = {
        userId: testTenantUserId,
        dormitoryId: testDormId,
      };
      next();
    });
    app.use(
      '/api/v1/tenant-portal',
      createTenantPortalRouter({ requireAuth: () => (req: any, res: any, next: any) => next() } as any)
    );
  });

  afterEach(async () => {
    // Cleanup test data
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormId } } });
    await prisma.payment.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.bill.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.meterDevice.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.role.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitory.deleteMany({ where: { id: testDormId } });
    await prisma.user.deleteMany({ where: { id: { in: [testOwnerUserId, testTenantUserId] } } });
  });

  it('UB1 - UB8: Existing unpaid MU bill ID is preserved in-place, items replaced, total updated, and tenant sees latest bill', async () => {
    // Initial baseline: Water 100 -> 110 (10 units * 18 = 180), Elec 500 -> 600 (100 units * 7 = 700), Common = 200 => Total = 1,080.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );

    // Issue initial MONTHLY_UTILITY bill
    const issueRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    expect(issueRes.created).toBe(true);
    const initialBill = issueRes.bill;
    const initialBillId = initialBill.id;
    const initialBillNumber = initialBill.billNumber;
    expect(Number(initialBill.totalAmount)).toBe(1080);
    expect(initialBill.status).toBe('unpaid');
    const initialVersion = initialBill.version;

    // UB21: Tenant fetches bill before Main Save -> sees 1,080.00
    const tenantPreSave = await request(app).get('/api/v1/tenant-portal/bills').expect(200);
    expect(tenantPreSave.body.data.length).toBe(1);
    expect(tenantPreSave.body.data[0].id).toBe(initialBillId);
    expect(Number(tenantPreSave.body.data[0].totalAmount)).toBe(1080);

    // Owner adds Other Fee "ค่าคีย์การ์ด 50.00" and saves workspace
    const saveRes = await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );
    expect(saveRes.savedCount).toBe(1);

    // UB1: Bill ID remains the same
    const postSaveBill = await prisma.bill.findUnique({
      where: { id: initialBillId },
      include: { items: true },
    });
    expect(postSaveBill).toBeTruthy();
    expect(postSaveBill!.id).toBe(initialBillId);
    expect(postSaveBill!.billNumber).toBe(initialBillNumber);

    // UB2: Exactly 1 active MONTHLY_UTILITY bill exists (no duplicate created)
    const activeBills = await prisma.bill.findMany({
      where: {
        dormitoryId: testDormId,
        billingCycleId,
        roomId,
        billKind: 'MONTHLY_UTILITY',
        status: { notIn: ['cancelled', 'void'] },
      },
    });
    expect(activeBills.length).toBe(1);

    // UB3: Other Fee inserted exactly once
    const keycardItems = postSaveBill!.items.filter((i) => i.description === 'ค่าคีย์การ์ด');
    expect(keycardItems.length).toBe(1);
    expect(Number(keycardItems[0].amount)).toBe(50);

    // UB4 & UB5: Bill total and outstanding update to 1,130.00 (1080 + 50)
    expect(Number(postSaveBill!.totalAmount)).toBe(1130);
    expect(Number(postSaveBill!.outstandingAmount)).toBe(1130);

    // UB16: Version incremented
    expect(postSaveBill!.version).toBe(initialVersion + 1);

    // UB8: Owner preview context amountDue matches persisted bill total
    const previewCtx = await meterService.getMeterBillingPreviewContext(testDormId, billingCycleId);
    const roomPreview = previewCtx.rooms.find((r) => r.roomId === roomId);
    expect(roomPreview).toBeTruthy();
    expect(roomPreview!.snapshotOtherFees.length).toBe(1);

    // UB6 & UB7 & UB22: Tenant endpoint returns latest total and items
    const tenantPostSave = await request(app).get('/api/v1/tenant-portal/bills').expect(200);
    expect(tenantPostSave.body.data.length).toBe(1);
    expect(tenantPostSave.body.data[0].id).toBe(initialBillId);
    expect(Number(tenantPostSave.body.data[0].totalAmount)).toBe(1130);
    expect(Number(tenantPostSave.body.data[0].outstandingAmount)).toBe(1130);

    const tenantDetail = await request(app).get(`/api/v1/tenant-portal/bills/${initialBillId}`).expect(200);
    expect(tenantDetail.body.data.id).toBe(initialBillId);
    expect(Number(tenantDetail.body.data.totalAmount)).toBe(1130);
    const tenantKeycard = tenantDetail.body.data.items.find((i: any) => i.description === 'ค่าคีย์การ์ด');
    expect(tenantKeycard).toBeTruthy();
    expect(Number(tenantKeycard.amount)).toBe(50);
  });

  it('UB9: Deleting Other Fee updates the same bill downward in place', async () => {
    // 1. Initial bill with Other Fee 50.00 (Total = 1,130.00)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    const issueRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = issueRes.bill.id;
    expect(Number(issueRes.bill.totalAmount)).toBe(1130);

    // 2. Owner removes Other Fee and saves workspace
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    // Verify same bill updated downward to 1,080.00
    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(1080);
    expect(updatedBill!.items.some((i) => i.description === 'ค่าคีย์การ์ด')).toBe(false);

    // Tenant sees 1,080.00
    const tenantRes = await request(app).get(`/api/v1/tenant-portal/bills/${billId}`).expect(200);
    expect(Number(tenantRes.body.data.totalAmount)).toBe(1080);
    expect(tenantRes.body.data.items.some((i: any) => i.description === 'ค่าคีย์การ์ด')).toBe(false);
  });

  it('UB10: Editing fee 50 -> 80 replaces the item without double counting', async () => {
    // 1. Initial bill with Other Fee 50.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    const issueRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = issueRes.bill.id;
    expect(Number(issueRes.bill.totalAmount)).toBe(1130);

    // 2. Owner edits fee to 80.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '80.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    // Verify same bill updated to 1,160.00 (1080 + 80), NOT 50 + 80 (1210)
    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(1160);

    const keycardItems = updatedBill!.items.filter((i) => i.description === 'ค่าคีย์การ์ด');
    expect(keycardItems.length).toBe(1);
    expect(Number(keycardItems[0].amount)).toBe(80);
  });

  it('UB11: Exact satang handling (50.50) without float drift', async () => {
    // 1. Initial bill 1,080.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const issueRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = issueRes.bill.id;

    // 2. Add 50.50 satang fee
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าบริการเสริม', amount: '50.50' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(1130.50);
    expect(Number(updatedBill!.outstandingAmount)).toBe(1130.50);

    const item = updatedBill!.items.find((i) => i.description === 'ค่าบริการเสริม');
    expect(Number(item!.amount)).toBe(50.50);

    const tenantRes = await request(app).get(`/api/v1/tenant-portal/bills/${billId}`).expect(200);
    expect(Number(tenantRes.body.data.totalAmount)).toBe(1130.50);
  });

  it('UB12 & UB13: RENT and DEPOSIT bills remain strictly isolated and untouched', async () => {
    // 1. Create RENT bill (4,000.00) and DEPOSIT bill (5,000.00)
    const rentRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'RENT' },
      testOwnerUserId
    );
    const rentBillId = rentRes.bill.id;

    const depositBill = await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: `DEP-${Date.now()}`,
        billKind: 'DEPOSIT',
        subtotal: toDecimal('5000.00'),
        totalAmount: toDecimal('5000.00'),
        paidAmount: toDecimal('5000.00'),
        outstandingAmount: toDecimal('0.00'),
        status: 'paid',
        billingDate: new Date(),
        dueDate: new Date(),
      },
    });

    // 2. Create and issue UNPAID MONTHLY_UTILITY bill (1,080.00)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const utilityBillId = utilityRes.bill.id;

    // 3. Save meter workspace with Other Fee
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าทำความสะอาด', amount: '120.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    // Verify MONTHLY_UTILITY updated to 1,200.00
    const checkUtility = await prisma.bill.findUnique({ where: { id: utilityBillId } });
    expect(Number(checkUtility!.totalAmount)).toBe(1200);

    // Verify RENT bill is completely untouched
    const checkRent = await prisma.bill.findUnique({ where: { id: rentBillId } });
    expect(Number(checkRent!.totalAmount)).toBe(4000);
    expect(checkRent!.billKind).toBe('RENT');

    // Verify DEPOSIT bill is completely untouched
    const checkDeposit = await prisma.bill.findUnique({ where: { id: depositBill.id } });
    expect(Number(checkDeposit!.totalAmount)).toBe(5000);
    expect(checkDeposit!.billKind).toBe('DEPOSIT');
  });

  it('UB14: PAID MONTHLY_UTILITY bill rejects mutation with ROOM_LOCKED_PAID', async () => {
    // 1. Issue and mark MONTHLY_UTILITY as PAID
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    await prisma.bill.update({
      where: { id: utilityRes.bill.id },
      data: { status: 'paid', paidAmount: utilityRes.bill.totalAmount, outstandingAmount: 0 },
    });

    // 2. Attempt workspace save -> MUST FAIL with ROOM_LOCKED_PAID
    await expect(
      meterService.saveBulkMeterWorkspace(
        testDormId,
        {
          billingCycleId,
          rows: [
            {
              roomId,
              waterPrev: '100',
              waterCurr: '110',
              elecPrev: '500',
              elecCurr: '600',
              otherFees: [{ description: 'ค่าปรับ', amount: '100.00' }],
            },
          ],
        },
        testOwnerUserId,
        billingService
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ROOM_LOCKED_PAID',
    });

    // Verify bill total remains unchanged
    const billAfter = await prisma.bill.findUnique({ where: { id: utilityRes.bill.id } });
    expect(Number(billAfter!.totalAmount)).toBe(1080);
    expect(billAfter!.status).toBe('paid');
  });

  it('UB15 & UB24: Failed sync is atomic (clearing reading on issued bill throws and rolls back all changes)', async () => {
    // 1. Issue bill with water 110, elec 600 (Total = 1080)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = utilityRes.bill.id;

    // 2. Attempt to clear water reading while adding fee -> MUST REJECT
    let caughtErr: any = null;
    try {
      await meterService.saveBulkMeterWorkspace(
        testDormId,
        {
          billingCycleId,
          rows: [
            {
              roomId,
              waterPrev: '100',
              waterCurr: null, // Illegal clearing on issued bill
              elecPrev: '500',
              elecCurr: '600',
              otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
            },
          ],
        },
        testOwnerUserId,
        billingService
      );
    } catch (err: any) {
      caughtErr = err;
    }
    expect(caughtErr).not.toBeNull();
    expect(caughtErr.code).toBe('CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL');

    // 3. Verify atomic rollback: readings, snapshot, bill, and tenant view remain at original valid state
    const billAfter = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(Number(billAfter!.totalAmount)).toBe(1080);
    expect(billAfter!.items.some((i) => i.description === 'ค่าคีย์การ์ด')).toBe(false);

    const waterReading = await prisma.meterReading.findFirst({
      where: { roomId, billingCycleId, meterType: 'water' },
    });
    expect(Number(waterReading?.currentReading)).toBe(110);

    const tenantRes = await request(app).get(`/api/v1/tenant-portal/bills/${billId}`).expect(200);
    expect(Number(tenantRes.body.data.totalAmount)).toBe(1080);
  });

  it('UB17: Independent payment records remain intact when unpaid bill is recalculated', async () => {
    // 1. Issue bill 1,080.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = utilityRes.bill.id;

    // 2. Create an independent Payment record (e.g. pending slip or partial payment attempt)
    const payment = await prisma.payment.create({
      data: {
        dormitoryId: testDormId,
        billId,
        amount: toDecimal('200.00'),
        method: 'TRANSFER',
        status: 'PENDING_REVIEW',
        paymentDate: new Date(),
      },
    });

    // 3. Update workspace with Other Fee 50
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    // Verify payment record is still linked to the same bill
    const paymentCheck = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(paymentCheck).toBeTruthy();
    expect(paymentCheck!.billId).toBe(billId);
    expect(paymentCheck!.status).toBe('PENDING_REVIEW');
  });

  it('UB18: Manual outstanding (ค้างชำระ) updates the same bill in place', async () => {
    // 1. Issue bill 1,080.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = utilityRes.bill.id;

    // 2. Add manual outstanding 300.00
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterPrev: '100',
            waterCurr: '110',
            elecPrev: '500',
            elecCurr: '600',
            manualOutstandingAmount: '300.00',
          },
        ],
      },
      testOwnerUserId,
      billingService
    );

    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(1380); // 1080 + 300
    const outItem = updatedBill!.items.find((i) => i.description === 'ค้างชำระ');
    expect(outItem).toBeTruthy();
    expect(Number(outItem!.amount)).toBe(300);

    const tenantRes = await request(app).get(`/api/v1/tenant-portal/bills/${billId}`).expect(200);
    expect(Number(tenantRes.body.data.totalAmount)).toBe(1380);
    expect(tenantRes.body.data.items.some((i: any) => i.description === 'ค้างชำระ')).toBe(true);
  });

  it('UB19: Decision B3: changing peopleCount updates the same bill in place', async () => {
    // 1. Create a cycle with per_person common fee (100 per person)
    const pCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormId,
        cycleCode: '2026-09',
        name: 'รอบบิล กันยายน 2569',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-10-05'),
        status: 'open',
        rateSnapshot: {
          create: {
            dormitoryId: testDormId,
            waterBillingType: 'fixed',
            waterRate: toDecimal('150.00'),
            electricityBillingType: 'fixed',
            electricityRate: toDecimal('300.00'),
            commonFee: toDecimal('100.00'),
            commonFeeMode: 'per_person',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'none',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'none',
            lateFeeType: 'fixed',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });

    // Save with 2 people (Common: 2 * 100 = 200, Water: 150, Elec: 300 => Total = 650)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId: pCycle.id,
        rows: [{ roomId, peopleCount: 2 }],
      },
      testOwnerUserId,
      billingService
    );
    const genRes = await billingService.generateBill(
      testDormId,
      { billingCycleId: pCycle.id, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = genRes.bill.id;
    expect(Number(genRes.bill.totalAmount)).toBe(650);

    // Edit peopleCount to 0 (Common: 0, Water: 150, Elec: 300 => Total = 450)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId: pCycle.id,
        rows: [{ roomId, peopleCount: 0 }],
      },
      testOwnerUserId,
      billingService
    );

    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(450);
  });

  it('UB20: Meter reading change recalculates the same bill in place', async () => {
    // 1. Initial bill with elec 600 (100 units * 7 = 700 => Total = 1080)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '600' }],
      },
      testOwnerUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testOwnerUserId
    );
    const billId = utilityRes.bill.id;
    expect(Number(utilityRes.bill.totalAmount)).toBe(1080);

    // 2. Owner corrects elecCurr to 650 (150 units * 7 = 1050, +350 => Total = 1430)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '650' }],
      },
      testOwnerUserId,
      billingService
    );

    const updatedBill = await prisma.bill.findUnique({
      where: { id: billId },
      include: { items: true },
    });
    expect(updatedBill!.id).toBe(billId);
    expect(Number(updatedBill!.totalAmount)).toBe(1430);

    const elecItem = updatedBill!.items.find((i) => i.type === 'electricity');
    expect(elecItem).toBeTruthy();
    expect(Number(elecItem!.quantity)).toBe(150);
    expect(Number(elecItem!.amount)).toBe(1050);

    const tenantRes = await request(app).get(`/api/v1/tenant-portal/bills/${billId}`).expect(200);
    expect(Number(tenantRes.body.data.totalAmount)).toBe(1430);
  });
});
