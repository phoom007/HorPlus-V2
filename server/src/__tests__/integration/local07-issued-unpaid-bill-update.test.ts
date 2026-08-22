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

  it('Proof A: independent financial authorities — saving meter workspace updates MONTHLY_UTILITY (730 -> 970) without touching RENT (4,000)', async () => {
    // 1. Create independent RENT bill (4,000.00)
    const rentBillRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'RENT' },
      testUserId
    );
    expect(rentBillRes.created).toBe(true);
    expect(Number(rentBillRes.bill.totalAmount)).toBe(4000);
    expect(rentBillRes.bill.billKind).toBe('RENT');
    const rentBillId = rentBillRes.bill.id;

    // Create coexisting DEPOSIT bill (5,000.00)
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
        items: {
          create: [{
            dormitoryId: testDormId,
            type: 'deposit',
            description: 'เงินประกันความเสียหาย',
            quantity: toDecimal('1.00'),
            unitPrice: toDecimal('5000.00'),
            amount: toDecimal('5000.00'),
          }],
        },
      },
    });

    // Create coexisting historical LEGACY_COMBINED bill (3,000.00)
    const legacyBill = await prisma.bill.create({
      data: {
        dormitoryId: testDormId,
        billingCycleId,
        roomId,
        tenantId,
        contractId,
        billNumber: `LEG-${Date.now()}`,
        billKind: 'LEGACY_COMBINED',
        subtotal: toDecimal('3000.00'),
        totalAmount: toDecimal('3000.00'),
        paidAmount: toDecimal('3000.00'),
        outstandingAmount: toDecimal('0.00'),
        status: 'paid',
        billingDate: new Date(),
        dueDate: new Date(),
        items: {
          create: [{
            dormitoryId: testDormId,
            type: 'other',
            description: 'ยอดบิลเดิม',
            quantity: toDecimal('1.00'),
            unitPrice: toDecimal('3000.00'),
            amount: toDecimal('3000.00'),
          }],
        },
      },
    });

    // 2. Initial meter save: water 10 units (10 * 18 = 180), elec 50 units (50 * 7 = 350)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterCurr: '110', elecCurr: '250' }],
      },
      testUserId,
      billingService
    );

    // 3. Issue Monthly Utility Bill: 180 water + 350 elec + 200 common = 730.00 (NO RENT)
    const utilityBillRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testUserId
    );
    expect(utilityBillRes.created).toBe(true);
    expect(Number(utilityBillRes.bill.totalAmount)).toBe(730);
    expect(utilityBillRes.bill.billKind).toBe('MONTHLY_UTILITY');
    expect(utilityBillRes.bill.status).toBe('unpaid');
    const utilityBillId = utilityBillRes.bill.id;

    // 4. Owner updates meter reading (elecCurr -> 270: 70 * 7 = 490, +140) AND adds otherFee 100
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

    // 5. Verify MONTHLY_UTILITY bill updated from 730 to 970 (730 + 140 + 100) with SAME ID
    const updatedUtilityBill = await prisma.bill.findUnique({
      where: { id: utilityBillId },
      include: { items: true },
    });
    expect(updatedUtilityBill).toBeTruthy();
    expect(updatedUtilityBill!.id).toBe(utilityBillId);
    expect(Number(updatedUtilityBill!.totalAmount)).toBe(970);
    expect(Number(updatedUtilityBill!.outstandingAmount)).toBe(970);
    expect(updatedUtilityBill!.billKind).toBe('MONTHLY_UTILITY');

    const cleaningItem = updatedUtilityBill!.items.find((i) => i.description === 'ค่าทำความสะอาด');
    expect(cleaningItem).toBeTruthy();
    expect(Number(cleaningItem!.amount)).toBe(100);

    // 6. Verify RENT bill remains completely untouched (4,000.00) with SAME ID
    const updatedRentBill = await prisma.bill.findUnique({
      where: { id: rentBillId },
      include: { items: true },
    });
    expect(updatedRentBill).toBeTruthy();
    expect(updatedRentBill!.id).toBe(rentBillId);
    expect(Number(updatedRentBill!.totalAmount)).toBe(4000);
    expect(Number(updatedRentBill!.outstandingAmount)).toBe(4000);
    expect(updatedRentBill!.billKind).toBe('RENT');
    expect(updatedRentBill!.items.length).toBe(1);
    expect(updatedRentBill!.items[0].type).toBe('rent');

    // Verify DEPOSIT and LEGACY_COMBINED bills remain completely untouched
    const checkDeposit = await prisma.bill.findUnique({ where: { id: depositBill.id } });
    expect(Number(checkDeposit!.totalAmount)).toBe(5000);
    expect(checkDeposit!.billKind).toBe('DEPOSIT');

    const checkLegacy = await prisma.bill.findUnique({ where: { id: legacyBill.id } });
    expect(Number(checkLegacy!.totalAmount)).toBe(3000);
    expect(checkLegacy!.billKind).toBe('LEGACY_COMBINED');

    // 7. Verify exactly 1 active RENT bill and exactly 1 active MONTHLY_UTILITY bill exist
    const activeRentBills = await prisma.bill.findMany({
      where: { dormitoryId: testDormId, billingCycleId, roomId, billKind: 'RENT', status: { notIn: ['cancelled', 'void'] } },
    });
    expect(activeRentBills.length).toBe(1);

    const activeMonthlyUtilityBills = await prisma.bill.findMany({
      where: { dormitoryId: testDormId, billingCycleId, roomId, billKind: 'MONTHLY_UTILITY', status: { notIn: ['cancelled', 'void'] } },
    });
    expect(activeMonthlyUtilityBills.length).toBe(1);
  });

  it('Proof B: defense-in-depth guard in syncIssuedUnpaidBillInTx rejects non-MONTHLY_UTILITY bills and undefined billKind', async () => {
    // 1. RENT -> reject
    await expect(
      meterService.syncIssuedUnpaidBillInTx(
        testDormId,
        billingCycleId,
        roomId,
        { id: randomUUID(), billKind: 'RENT', status: 'unpaid', totalAmount: '4000.00' },
        billingService,
        testUserId
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BILL_KIND_FOR_METER_SYNC',
    });

    // 2. DEPOSIT -> reject
    await expect(
      meterService.syncIssuedUnpaidBillInTx(
        testDormId,
        billingCycleId,
        roomId,
        { id: randomUUID(), billKind: 'DEPOSIT', status: 'unpaid', totalAmount: '5000.00' },
        billingService,
        testUserId
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BILL_KIND_FOR_METER_SYNC',
    });

    // 3. LEGACY_COMBINED -> reject
    await expect(
      meterService.syncIssuedUnpaidBillInTx(
        testDormId,
        billingCycleId,
        roomId,
        { id: randomUUID(), billKind: 'LEGACY_COMBINED', status: 'unpaid', totalAmount: '4700.00' },
        billingService,
        testUserId
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BILL_KIND_FOR_METER_SYNC',
    });

    // 4. Undefined / missing billKind -> reject (fail closed)
    await expect(
      meterService.syncIssuedUnpaidBillInTx(
        testDormId,
        billingCycleId,
        roomId,
        { id: randomUUID(), status: 'unpaid', totalAmount: '730.00' },
        billingService,
        testUserId
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_BILL_KIND_FOR_METER_SYNC',
    });
  });

  it('Proof C: saving meter workspace on a PAID MONTHLY_UTILITY bill is strictly rejected with 400 ROOM_LOCKED_PAID', async () => {
    // 1. Initial save & issue MONTHLY_UTILITY bill
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
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testUserId
    );

    // 2. Mark MONTHLY_UTILITY bill as PAID
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

  it('Proof D: if RENT bill is PAID but MONTHLY_UTILITY is UNPAID, meter workspace updates MONTHLY_UTILITY without lock collision', async () => {
    // 1. Create PAID RENT bill
    const rentRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'RENT' },
      testUserId
    );
    await prisma.bill.update({
      where: { id: rentRes.bill.id },
      data: { status: 'paid', paidAmount: rentRes.bill.totalAmount, outstandingAmount: 0 },
    });

    // 2. Create UNPAID MONTHLY_UTILITY bill (730)
    await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterCurr: '110', elecCurr: '250' }],
      },
      testUserId,
      billingService
    );
    const utilityRes = await billingService.generateBill(
      testDormId,
      { billingCycleId, roomId, billKind: 'MONTHLY_UTILITY' },
      testUserId
    );
    expect(utilityRes.bill.status).toBe('unpaid');

    // 3. Save meter workspace (elecCurr -> 270) -> MUST SUCCEED because active monthly utility bill is unpaid
    const saveRes = await meterService.saveBulkMeterWorkspace(
      testDormId,
      {
        billingCycleId,
        rows: [{ roomId, waterCurr: '110', elecCurr: '270' }],
      },
      testUserId,
      billingService
    );
    expect(saveRes.savedCount).toBe(1);

    // 4. Verify MONTHLY_UTILITY updated to 870 (730 + 140) and RENT is still PAID 4000
    const updatedUtility = await prisma.bill.findUnique({ where: { id: utilityRes.bill.id } });
    expect(Number(updatedUtility!.totalAmount)).toBe(870);

    const rentCheck = await prisma.bill.findUnique({ where: { id: rentRes.bill.id } });
    expect(rentCheck!.status).toBe('paid');
    expect(Number(rentCheck!.totalAmount)).toBe(4000);
  });
});
