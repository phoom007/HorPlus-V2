import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { MeterService } from '../../services/meter.service.js';
import { BillingService } from '../../services/billing.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { createMeterRouter } from '../../routes/meter.routes.js';
import { toDecimal } from '../../utils/decimal-math.util.js';
import { SubscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

const prisma = new PrismaClient();

describe('LOCAL-07 — Historical UNPAID Recalculation & Financial Details Authority Suite', () => {
  const testDormId = '90000001-0000-4000-8000-000000000001';
  const testOwnerUserId = '90000001-0000-4000-8000-000000000002';
  const testTenantUserId = '90000001-0000-4000-8000-000000000003';
  const testTenantId = '90000001-0000-4000-8000-000000000004';
  const testRoomId = '90000001-0000-4000-8000-000000000005';
  const testJulyCycleId = '90000001-0000-4000-8000-000000000006';
  const testAugustCycleId = '90000001-0000-4000-8000-000000000007';

  let meterRepo: PrismaMeterRepository;
  let billingCycleRepo: PrismaBillingCycleRepository;
  let billRepo: PrismaBillRepository;
  let contractRepo: PrismaContractRepository;
  let roomRepo: PrismaRoomRepository;
  let tenantRepo: PrismaTenantRepository;
  let billingService: BillingService;
  let meterService: MeterService;
  let app: express.Express;

  beforeEach(async () => {
    // 1. Setup mock repos & service
    meterRepo = new PrismaMeterRepository(prisma);
    billingCycleRepo = new PrismaBillingCycleRepository(prisma);
    billRepo = new PrismaBillRepository(prisma);
    contractRepo = new PrismaContractRepository(prisma);
    roomRepo = new PrismaRoomRepository(prisma);
    tenantRepo = new PrismaTenantRepository(prisma);
    billingService = new BillingService(billRepo, billingCycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo);
    meterService = new MeterService(meterRepo, billingCycleRepo, undefined, billRepo);

    // 2. Clear old test data
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormId } } });
    await prisma.payment.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.bill.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.platformSubscription.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.role.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.tenant.deleteMany({ where: { id: testTenantId } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitory.deleteMany({ where: { id: testDormId } });
    await prisma.user.deleteMany({ where: { id: { in: [testOwnerUserId, testTenantUserId] } } });

    // 3. Create test users & dormitory
    await prisma.user.createMany({
      data: [
        { id: testOwnerUserId, email: 'owner-test-hist@horplus.com', emailNormalized: 'owner-test-hist@horplus.com', name: 'Test Owner', googleSubject: 'sub-owner-test-hist' },
        { id: testTenantUserId, email: 'tenant-test-hist@horplus.com', emailNormalized: 'tenant-test-hist@horplus.com', name: 'Test Tenant', googleSubject: 'sub-tenant-test-hist' },
      ],
    });

    await prisma.dormitory.create({
      data: {
        id: testDormId,
        name: 'Historical Test Dorm',
        code: 'HIST-DORM',
        province: 'Bangkok',
      },
    });

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: {},
        isSystem: true,
      },
    });

    const tenantRole = await prisma.role.create({
      data: {
        dormitoryId: testDormId,
        code: 'TENANT',
        name: 'Tenant',
        permissions: {},
        isSystem: true,
      },
    });

    await prisma.dormitoryMember.createMany({
      data: [
        { dormitoryId: testDormId, userId: testOwnerUserId, roleId: ownerRole.id, status: 'active' },
        { dormitoryId: testDormId, userId: testTenantUserId, roleId: tenantRole.id, status: 'active' },
      ],
    });

    const entService = new SubscriptionEntitlementService();
    await entService.provisionInitialTrial(testDormId);

    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: testDormId,
        waterBillingType: 'per_unit',
        waterRate: new Prisma.Decimal('18.00'),
        electricityBillingType: 'per_unit',
        electricityRate: new Prisma.Decimal('7.00'),
        commonFee: new Prisma.Decimal('200.00'),
        internetFee: new Prisma.Decimal('150.00'),
        parkingRate: new Prisma.Decimal('300.00'),
        billingDay: 25,
        dueDay: 5,
        lateFeeType: 'fixed',
        lateFeeValue: toDecimal('0.00'),
      },
    });

    // 3. Create Building & Room
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormId,
        name: 'Building A',
      },
    });

    await prisma.room.create({
      data: {
        id: testRoomId,
        dormitoryId: testDormId,
        buildingId: building.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4500.00'),
        initialWaterReading: toDecimal('100.00'),
        initialElectricityReading: toDecimal('500.00'),
        status: 'occupied',
      },
    });

    // 4. Create Tenant & Contract
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        dormitoryId: testDormId,
        linkedUserId: testTenantUserId,
        firstName: 'Somchai',
        lastName: 'Historical',
        displayName: 'Somchai Historical',
        phone: '0812345678',
        tenantNumber: `TNT-${Date.now()}`,
        status: 'active',
      },
    });

    await prisma.contract.create({
      data: {
        id: '90000001-0000-4000-8000-000000000008',
        dormitoryId: testDormId,
        roomId: testRoomId,
        tenantId: testTenantId,
        contractNumber: `CTR-${Date.now()}`,
        startDate: new Date('2026-06-01'),
        endDate: new Date('2027-05-31'),
        rentAmount: toDecimal('4500.00'),
        depositAmount: toDecimal('4500.00'),
        status: 'active',
      },
    });

    // 5. Create Historical (July) and Operational (August) cycles
    await prisma.billingCycle.create({
      data: {
        id: testJulyCycleId,
        dormitoryId: testDormId,
        cycleCode: '2026-07',
        name: 'รอบบิล กรกฎาคม 2569',
        periodStart: new Date('2026-07-01'),
        periodEnd: new Date('2026-07-31'),
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('7.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'fixed',
            internetFee: toDecimal('150.00'),
            internetFeeMode: 'fixed',
            parkingFee: toDecimal('300.00'),
            parkingFeeMode: 'fixed',
            lateFeeType: 'fixed',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });

    await prisma.billingCycle.create({
      data: {
        id: testAugustCycleId,
        dormitoryId: testDormId,
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('7.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'fixed',
            internetFee: toDecimal('150.00'),
            internetFeeMode: 'fixed',
            parkingFee: toDecimal('300.00'),
            parkingFeeMode: 'fixed',
            lateFeeType: 'fixed',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });

    // 6. Setup Express App
    const mockAuthService: any = {
      verifyCsrf: () => true,
      validateSession: async () => ({
        userId: testOwnerUserId,
        sessionId: 'session-test-123',
        tokenVersion: 1,
        user: { id: testOwnerUserId, email: 'owner-test-hist@horplus.com' },
        session: { id: 'session-test-123', userId: testOwnerUserId },
        memberships: [{ id: 'mem-1', dormitoryId: testDormId, roleCode: 'OWNER', status: 'active', permissions: ['*'] }],
        dormitoryId: testDormId,
        role: 'OWNER',
      }),
    };

    app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      const dormId = (req.headers['x-dormitory-id'] as string) || testDormId;
      req.auth = {
        userId: testOwnerUserId,
        sessionId: 'session-test-123',
        tokenVersion: 1,
        user: { id: testOwnerUserId, email: 'owner-test-hist@horplus.com' },
        session: { id: 'session-test-123', userId: testOwnerUserId },
        memberships: [{ id: 'mem-1', dormitoryId: dormId, roleCode: 'OWNER', status: 'active', permissions: ['*'] }],
        dormitoryId: dormId,
        role: 'OWNER',
        permissions: ['*'],
      };
      req.dormitoryContext = {
        dormitoryId: dormId,
        roleCode: 'OWNER',
        permissions: ['*'],
      };
      req.cookies = {
        horplus_session: 'session-cookie-123',
        horplus_csrf: 'csrf-test-token',
      };
      req.headers['x-dormitory-id'] = dormId;
      req.headers['x-csrf-token'] = 'csrf-test-token';
      next();
    });
    app.use(
      '/api/v1/meters',
      createMeterRouter(mockAuthService, meterService, billingService)
    );
  });

  afterEach(async () => {
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormId } } });
    await prisma.payment.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.bill.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.platformSubscription.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.role.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.tenant.deleteMany({ where: { id: testTenantId } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDormId } });
    await prisma.dormitory.deleteMany({ where: { id: testDormId } });
    await prisma.user.deleteMany({ where: { id: { in: [testOwnerUserId, testTenantUserId] } } });
  });

  // ============================================================================
  // HU1–HU10: Historical UNPAID Recalculation & Mutability Contract
  // ============================================================================

  it('HU1–HU9: recalculates existing historical (July) UNPAID MONTHLY_UTILITY bill in place upon Main Save', async () => {
    // Seed an existing UNPAID MONTHLY_UTILITY bill in July
    const initialJulyBill = await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId: testJulyCycleId,
        roomId: testRoomId,
        tenantId: testTenantId,
        billNumber: 'INV-202607-101-U',
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '1080.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '1080.00',
        paidAmount: '0.00',
        outstandingAmount: '1080.00',
        currency: 'THB',
        version: 1,
        items: {
          create: [
            { dormitoryId: testDormId, type: 'water', description: 'ค่าน้ำ (100 - 110)', quantity: '10.00', unitPrice: '18.00', amount: '180.00', displayOrder: 0 },
            { dormitoryId: testDormId, type: 'electricity', description: 'ค่าไฟฟ้า (500 - 600)', quantity: '100.00', unitPrice: '7.00', amount: '700.00', displayOrder: 1 },
            { dormitoryId: testDormId, type: 'common_fee', description: 'ค่าส่วนกลาง', quantity: '1.00', unitPrice: '200.00', amount: '200.00', displayOrder: 2 },
          ],
        },
      },
      include: { items: true },
    });

    const initialBillId = initialJulyBill.id;

    // Owner edits July workspace: waterCurr 110 -> 120 (usage 20 * 18 = 360), elecCurr 600 -> 650 (usage 150 * 7 = 1050), adds Other Fee 50
    const savePayload = {
      billingCycleId: testJulyCycleId,
      rows: [
        {
          roomId: testRoomId,
          waterCurr: '120',
          waterPrev: '100',
          elecCurr: '650',
          elecPrev: '500',
          peopleCount: 1,
          otherFees: [{ description: 'ค่าคีย์การ์ด', amount: '50.00' }],
        },
      ],
    };

    const res = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('x-dormitory-id', testDormId)
      .send(savePayload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // HU3: Same Bill ID preserved
    const updatedBill = await prisma.bill.findUnique({
      where: { id: initialBillId },
      include: { items: true },
    });
    expect(updatedBill).toBeDefined();
    expect(updatedBill!.id).toBe(initialBillId);

    // HU2 & HU9: Exactly 1 active MONTHLY_UTILITY bill in July
    const julyBills = await prisma.bill.findMany({
      where: { dormitoryId: testDormId, billingCycleId: testJulyCycleId, roomId: testRoomId, billKind: 'MONTHLY_UTILITY', status: { notIn: ['cancelled', 'void'] } },
    });
    expect(julyBills.length).toBe(1);

    // HU4 & HU5: Canonical items and total recalculated
    // Water (360) + Elec (1050) + Common (200) + Internet (150) + Parking (300) + Keycard (50) = 2110.00
    expect(updatedBill!.totalAmount.toString()).toBe('2110');
    expect(updatedBill!.outstandingAmount.toString()).toBe('2110');
    expect(updatedBill!.version).toBe(2);

    const otherFeeItem = updatedBill!.items.find((i) => i.type === 'other_fee');
    expect(otherFeeItem).toBeDefined();
    expect(otherFeeItem!.description).toBe('ค่าคีย์การ์ด');
    expect(otherFeeItem!.amount.toString()).toBe('50');

    // HU6–HU7: Owner preview context matches latest canonical total
    const previewCtx: any = await meterService.getMeterBillingPreviewContext(testDormId, testJulyCycleId);
    const roomCtx: any = previewCtx.rooms.find((r: any) => r.roomId === testRoomId);
    expect(roomCtx).toBeDefined();
    expect(roomCtx!.amountDue).toBe('2110.00');
    expect(roomCtx!.billStatus).toBe('unpaid');
    expect(roomCtx!.isPaid).toBe(false);
  });

  it('HU10: historical PAID bill strictly rejects mutation with ROOM_LOCKED_PAID', async () => {
    // Seed a PAID bill in July
    await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId: testJulyCycleId,
        roomId: testRoomId,
        tenantId: testTenantId,
        billNumber: 'INV-202607-101-P',
        billKind: 'MONTHLY_UTILITY',
        status: 'paid',
        billingDate: new Date('2026-07-25'),
        dueDate: new Date('2026-08-05'),
        subtotal: '1080.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '1080.00',
        paidAmount: '1080.00',
        outstandingAmount: '0.00',
        currency: 'THB',
        version: 1,
        paidAt: new Date('2026-08-01'),
      },
    });

    const res = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('x-dormitory-id', testDormId)
      .send({
        billingCycleId: testJulyCycleId,
        rows: [{ roomId: testRoomId, waterCurr: '130', elecCurr: '700' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ROOM_LOCKED_PAID');
  });

  // ============================================================================
  // P1–P5: Status Semantics & Primary Payable Matrix Audit Proof
  // ============================================================================

  it('P1: MU PAID + No other unpaid bills -> amountDue = 0, billStatus = paid, isPaid = true', async () => {
    await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId: testAugustCycleId,
        roomId: testRoomId,
        billNumber: 'INV-202608-101-U',
        billKind: 'MONTHLY_UTILITY',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '1000.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '1000.00',
        paidAmount: '1000.00',
        outstandingAmount: '0.00',
        currency: 'THB',
        version: 1,
        paidAt: new Date(),
      },
    });

    const preview: any = await meterService.getMeterBillingPreviewContext(testDormId, testAugustCycleId);
    const room: any = preview.rooms.find((r: any) => r.roomId === testRoomId);
    expect(room?.amountDue).toBe('0.00');
    expect(room?.billStatus).toBe('paid');
    expect(room?.isPaid).toBe(true);
  });

  it('P2: MU PAID + RENT UNPAID (4,500) -> amountDue = 4500.00, billStatus = paid, isPaid = true (Evidence for Product Decision S1 vs S2)', async () => {
    // 1. Separate RENT bill (unpaid)
    await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId: testAugustCycleId,
        roomId: testRoomId,
        billNumber: 'INV-202608-101-R',
        billKind: 'RENT',
        status: 'unpaid',
        billingDate: new Date('2026-08-01'),
        dueDate: new Date('2026-08-05'),
        subtotal: '4500.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
        currency: 'THB',
        version: 1,
        items: {
          create: [{ dormitoryId: testDormId, type: 'rent', description: 'ค่าเช่าห้องพัก', quantity: '1.00', unitPrice: '4500.00', amount: '4500.00', displayOrder: 0 }],
        },
      },
    });

    // 2. Separate MONTHLY_UTILITY bill (paid)
    await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId: testAugustCycleId,
        roomId: testRoomId,
        billNumber: 'INV-202608-101-U',
        billKind: 'MONTHLY_UTILITY',
        status: 'paid',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: '950.00',
        discountAmount: '0.00',
        fineAmount: '0.00',
        totalAmount: '950.00',
        paidAmount: '950.00',
        outstandingAmount: '0.00',
        currency: 'THB',
        version: 1,
        paidAt: new Date(),
        items: {
          create: [
            { dormitoryId: testDormId, type: 'water', description: 'ค่าน้ำประปา', quantity: '10.00', unitPrice: '18.00', amount: '180.00', displayOrder: 0 },
            { dormitoryId: testDormId, type: 'electricity', description: 'ค่าไฟฟ้า', quantity: '110.00', unitPrice: '7.00', amount: '770.00', displayOrder: 1 },
          ],
        },
      },
    });

    const preview: any = await meterService.getMeterBillingPreviewContext(testDormId, testAugustCycleId);
    const room: any = preview.rooms.find((r: any) => r.roomId === testRoomId);

    // Primary amountDue reflects the unpaid RENT bill
    expect(room?.amountDue).toBe('4500.00');

    // Charge components are cleanly separated
    expect(room?.chargeComponents.length).toBe(2);
    const rentComp = room?.chargeComponents.find((c: any) => c.type === 'rent');
    const muComp = room?.chargeComponents.find((c: any) => c.type === 'monthly_utility');

    expect(rentComp?.amount).toBe('4500.00');
    expect(rentComp?.status).toBe('UNPAID');

    expect(muComp?.amount).toBe('950.00');
    expect(muComp?.status).toBe('PAID');

    // Literal source authority: billStatus derives from MONTHLY_UTILITY bill (Option S2)
    expect(room?.billStatus).toBe('paid');
    expect(room?.isPaid).toBe(true);
  });
});
