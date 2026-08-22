import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
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
import { toDecimal } from '../../utils/decimal-math.util.js';

describe('LOCAL-07 Issued Unpaid Bill Update on Save Integration Proof', () => {
  const prisma: PrismaClient = getPrismaClient();
  let meterService: MeterService;
  let billingService: BillingService;

  let testDormId: string;
  let testUserId: string;
  let buildingId: string;
  let roomId: string;
  let tenantId: string;
  let contractId: string;
  let billingCycleId: string;

  beforeEach(async () => {
    testDormId = randomUUID();
    testUserId = randomUUID();
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

    // 1. Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `${testUserId}@example.com`,
        emailNormalized: `${testUserId}@example.com`,
        name: 'Test Owner',
        googleSubject: `sub-${testUserId}`,
      },
    });

    // 2. Create test dormitory with billing settings
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
            dueDay: 5,
          },
        },
      },
    });

    const entService = new SubscriptionEntitlementService();
    await entService.provisionInitialTrial(testDormId);

    // 3. Create building & room
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
        initialElectricityReading: toDecimal('200.00'),
        status: 'occupied',
      },
    });
    roomId = room.id;

    // 4. Create tenant & active contract
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormId,
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

    // 5. Create billing cycle
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
  });

  afterEach(async () => {
    // Cleanup test data
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormId } } });
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
    await prisma.dormitory.deleteMany({ where: { id: testDormId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });
  });

  it('Proof A: saving meter workspace updates existing UNPAID bill amount and billItems atomically without duplicate bills', async () => {
    // 1. Initial meter save: water 10 units (10 * 18 = 180), elec 50 units (50 * 7 = 350)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterCurr: '110', elecCurr: '250' }],
      },
      testUserId,
      billingService
    );

    // 2. Issue Monthly Bill: 4000 rent + 180 water + 350 elec + 200 common = 4,730.00
    const genRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId },
      testUserId
    );
    expect(genRes.created).toBe(true);
    expect(Number(genRes.bill.totalAmount)).toBe(4730);
    expect(genRes.bill.status).toBe('unpaid');
    const originalBillId = genRes.bill.id;

    // 3. Owner updates meter reading (elecCurr -> 270: 70 * 7 = 490) AND adds otherFee 100
    const saveRes = await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [
          {
            roomId,
            waterCurr: '110',
            elecCurr: '270', // 20 units more of electricity (+140)
            otherFees: [{ description: 'ค่าทำความสะอาด', amount: '100.00' }],
          },
        ],
      },
      testUserId,
      billingService
    );
    expect(saveRes.savedCount).toBe(1);

    // 4. Verify existing unpaid bill updated to 4,970.00 (4730 + 140 + 100)
    const updatedBill = await prisma.bill.findUnique({
      where: { id: originalBillId },
      include: { items: true },
    });
    expect(updatedBill).toBeTruthy();
    expect(Number(updatedBill!.totalAmount)).toBe(4970);
    expect(Number(updatedBill!.outstandingAmount)).toBe(4970);

    // Verify only ONE bill exists for this room in this cycle (no duplicates)
    const allBills = await prisma.bill.findMany({
      where: { dormitoryId: testDormId, billingCycleId, roomId },
    });
    expect(allBills.length).toBe(1);

    // Verify updated bill items contain other fee
    const cleaningItem = updatedBill!.items.find((i) => i.description === 'ค่าทำความสะอาด');
    expect(cleaningItem).toBeTruthy();
    expect(Number(cleaningItem!.amount)).toBe(100);
  });

  it('Proof B: saving meter workspace on a PAID bill is strictly rejected with 400 ROOM_LOCKED_PAID', async () => {
    // 1. Initial save & issue bill
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterCurr: '110', elecCurr: '250' }],
      },
      testUserId,
      billingService
    );
    const genRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId },
      testUserId
    );

    // 2. Mark bill as PAID
    await prisma.bill.update({
      where: { id: genRes.bill.id },
      data: { status: 'paid', paidAmount: genRes.bill.totalAmount, outstandingAmount: 0 },
    });

    // 3. Attempt to save meter workspace on paid room -> MUST REJECT
    await expect(
      meterService.saveBulkMeterWorkspace(
        testDormId,
        {
          billingCycleId,
          rows: [{ roomId, waterCurr: '120', elecCurr: '280' }],
        },
        testUserId,
        billingService
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'ROOM_LOCKED_PAID',
    });
  });
});
