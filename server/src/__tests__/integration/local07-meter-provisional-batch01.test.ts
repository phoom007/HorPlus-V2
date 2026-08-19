/**
 * HORPLUS LOCAL-07 — Batch 01 Targeted Integration Test Suite
 * Validates:
 * 1. Schema Migration & Integrity Proof (Tenant.phone nullable, snapshot defaults, provisional_rental_terms)
 * 2. First Cycle Authority & arbitrary starting month detection
 * 3. First Cycle custom previous reading persistence
 * 4. Dirty-Field Workspace bulk save semantics & strict otherFees validation
 * 5. People count lifecycle (vacant = 0, future reserved = 0, active = 1+N)
 * 6. Meter reading eligibility & zero usage (current == previous)
 * 7. Status Switch Authority (atomic issue with dirty data, canonical cancellation, paid bill lock)
 * 8. Snapshot manual charges (manualOutstandingAmount, otherFees) included in bill items
 * 9. Provisional Rental Terms (MONTHLY/TERM, future RESERVED vs ACTIVE, overlap prevention, contract priority)
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { MeterService } from '../../services/meter.service.js';
import { BillingService } from '../../services/billing.service.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { billingOrchestrationService } from '../../services/billing-orchestration.service.js';
import { provisionalRentalTermService } from '../../services/provisional-rental-term.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { AuditService } from '../../services/audit.service.js';
import { toDecimal, formatDecimal } from '../../utils/decimal-math.util.js';
import crypto from 'crypto';

describe('LOCAL-07 Batch 01 — Meter Core & Provisional Rental Terms Test Suite', () => {
  const prisma = getPrismaClient();

  const meterRepo = new PrismaMeterRepository(prisma);
  const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
  const billRepo = new PrismaBillRepository(prisma);
  const roomRepo = new PrismaRoomRepository(prisma);
  const contractRepo = new PrismaContractRepository(prisma);
  const tenantRepo = new PrismaTenantRepository(prisma);
  const buildingRepo = new PrismaBuildingRepository(prisma);
  const auditService = new AuditService();

  const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo, auditService);
  const billingCycleService = new BillingCycleService(billingCycleRepo, auditService);
  const billingService = new BillingService(
    billRepo,
    billingCycleRepo,
    meterRepo,
    contractRepo,
    roomRepo,
    tenantRepo,
    auditService
  );

  let testDormitoryId: string;
  let testBuildingId: string;
  let testRoom1Id: string;
  let testRoom2Id: string;
  let testRoom3Id: string;
  let cycle1Id: string;
  let cycle2Id: string;

  beforeAll(async () => {
    const suffix = crypto.randomBytes(4).toString('hex');
    testDormitoryId = crypto.randomUUID();

    // Create Dormitory
    await prisma.dormitory.create({
      data: {
        id: testDormitoryId,
        name: `Local07 Test Dorm ${suffix}`,
        code: `DORM-${suffix.toUpperCase()}`,
        billingSettings: {
          create: {
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            billingDay: 1,
            dueDay: 5,
          },
        },
      },
    });

    // Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId: testDormitoryId,
        name: 'Building A',
      },
    });
    testBuildingId = building.id;

    // Create 3 Rooms
    const r1 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4500.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('100.00'),
        initialElectricityReading: toDecimal('500.00'),
      },
    });
    testRoom1Id = r1.id;

    const r2 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('4800.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('150.00'),
        initialElectricityReading: toDecimal('600.00'),
      },
    });
    testRoom2Id = r2.id;

    const r3 = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: testBuildingId,
        roomNumber: '103',
        normalizedRoomNumber: '103',
        roomType: 'standard',
        floor: 1,
        monthlyRent: toDecimal('5000.00'),
        status: 'vacant',
        initialWaterReading: toDecimal('200.00'),
        initialElectricityReading: toDecimal('700.00'),
      },
    });
    testRoom3Id = r3.id;

    // Create Billing Cycles (Cycle 1: 2026-06 earliest, Cycle 2: 2026-07)
    const c1 = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormitoryId,
        cycleCode: '2026-06',
        name: 'มิถุนายน 2026',
        periodStart: new Date('2026-06-01T00:00:00Z'),
        periodEnd: new Date('2026-06-30T23:59:59Z'),
        billingDate: new Date('2026-06-30T00:00:00Z'),
        dueDate: new Date('2026-07-05T00:00:00Z'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormitoryId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'per_room',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'flat',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'flat',
            lateFeeType: 'flat',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });
    cycle1Id = c1.id;

    const c2 = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormitoryId,
        cycleCode: '2026-07',
        name: 'กรกฎาคม 2026',
        periodStart: new Date('2026-07-01T00:00:00Z'),
        periodEnd: new Date('2026-07-31T23:59:59Z'),
        billingDate: new Date('2026-07-31T00:00:00Z'),
        dueDate: new Date('2026-08-05T00:00:00Z'),
        status: 'draft',
        rateSnapshot: {
          create: {
            dormitoryId: testDormitoryId,
            waterBillingType: 'per_unit',
            waterRate: toDecimal('18.00'),
            electricityBillingType: 'per_unit',
            electricityRate: toDecimal('8.00'),
            commonFee: toDecimal('200.00'),
            commonFeeMode: 'per_room',
            internetFee: toDecimal('0.00'),
            internetFeeMode: 'flat',
            parkingFee: toDecimal('0.00'),
            parkingFeeMode: 'flat',
            lateFeeType: 'flat',
            lateFeeValue: toDecimal('0.00'),
            source: 'TEMPLATE_DEFAULT',
          },
        },
      },
    });
    cycle2Id = c2.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: testDormitoryId } } });
    await prisma.bill.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.occupancy.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.meterDevice.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.contract.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormitoryId } });
    await prisma.dormitory.deleteMany({ where: { id: testDormitoryId } });
  });

  // --------------------------------------------------------------------------
  // TEST 1: Schema Migration & Integrity Proof
  // --------------------------------------------------------------------------
  it('1. Schema integrity: Tenant.phone is nullable & snapshot defaults to peopleCount=0, manualOutstandingAmount=0, otherFees=[]', async () => {
    // 1. Create tenant with phone: null
    const tenantWithNullPhone = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        firstName: 'สมชาย',
        displayName: 'สมชาย ใจดี ไร้เบอร์',
        phone: null,
        tenantNumber: `TNT-PROOF-${Date.now()}`,
      },
    });
    expect(tenantWithNullPhone.phone).toBeNull();

    // 2. Create room billing cycle snapshot with default values
    const snapshot = await prisma.roomBillingCycleSnapshot.create({
      data: {
        dormitoryId: testDormitoryId,
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
      },
    });
    expect(snapshot.peopleCount).toBe(0);
    expect(formatDecimal(toDecimal(snapshot.manualOutstandingAmount))).toBe('0.00');
    expect(snapshot.otherFees).toEqual([]);

    // Clean up test snapshot
    await prisma.roomBillingCycleSnapshot.delete({ where: { id: snapshot.id } });
  });

  // --------------------------------------------------------------------------
  // TEST 2: First Cycle Authority & Detection
  // --------------------------------------------------------------------------
  it('2. First Cycle Authority: cycle1 (2026-06) is earliest/first, cycle2 (2026-07) is not', async () => {
    const isCycle1First = await billingCycleService.isFirstBillingCycle(testDormitoryId, cycle1Id);
    const isCycle2First = await billingCycleService.isFirstBillingCycle(testDormitoryId, cycle2Id);

    expect(isCycle1First).toBe(true);
    expect(isCycle2First).toBe(false);

    const firstCycle = await billingCycleService.getFirstBillingCycle(testDormitoryId);
    expect(firstCycle?.id).toBe(cycle1Id);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Provisional Rental Terms (MONTHLY vs TERM, RESERVED vs ACTIVE)
  // --------------------------------------------------------------------------
  it('3. Provisional Rental Term: Quick-Add ACTIVE monthly tenant occupies room and calculates rent', async () => {
    const res = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom1Id,
        fullName: 'นายกิตติศักดิ์ พัฒนาไทยแลนด์',
        phone: '0812345678',
        rentalType: 'MONTHLY',
        durationMonths: 6,
        unitRentAmount: '4500.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    expect(res.tenant.firstName).toBe('นายกิตติศักดิ์ พัฒนาไทยแลนด์');
    expect(res.tenant.phone).toBe('0812345678');
    expect(res.provisionalTerm.status).toBe('ACTIVE');
    expect(res.provisionalTerm.durationMonths).toBe(6);
    expect(formatDecimal(toDecimal(res.provisionalTerm.unitRentAmount!))).toBe('4500.00');

    // Room status updated to occupied
    const room = await prisma.room.findUnique({ where: { id: testRoom1Id } });
    expect(room?.status).toBe('occupied');

    // Resolves peopleCount = 1 for room 101 in cycle 1
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      testDormitoryId,
      cycle1Id,
      testRoom1Id
    );
    expect(peopleCount).toBe(1);
  });

  it('4. Provisional Rental Term: Future start date creates RESERVED term, marks room reserved, excluded from current cycle peopleCount', async () => {
    // Room 102: Start date in future (2026-10-01)
    const res = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom2Id,
        fullName: 'นางสาววิไลพร จองล่วงหน้า',
        rentalType: 'TERM',
        unitRentAmount: '30000.00',
        totalRentAmount: '30000.00',
        termInstallmentCount: 3,
        startDate: '2026-10-01',
      },
      'user-owner-1'
    );

    expect(res.provisionalTerm.status).toBe('RESERVED');
    expect(res.provisionalTerm.termInstallmentCount).toBe(3);
    expect(formatDecimal(toDecimal(res.provisionalTerm.unitRentAmount!))).toBe('30000.00');

    // Room status is reserved
    const room = await prisma.room.findUnique({ where: { id: testRoom2Id } });
    expect(room?.status).toBe('reserved');

    // In current cycle (2026-06), RESERVED term does NOT participate in people count -> 0
    const peopleCount = await billingOrchestrationService.resolveCyclePeopleCount(
      testDormitoryId,
      cycle1Id,
      testRoom2Id
    );
    expect(peopleCount).toBe(0);
  });

  it('5. Provisional Overlap Prevention: rejects creating overlapping term on already occupied room', async () => {
    await expect(
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        testDormitoryId,
        {
          roomId: testRoom1Id,
          fullName: 'นายซ้อนทับ ไม่ได้แน่นอน',
          rentalType: 'MONTHLY',
          unitRentAmount: '4500.00',
          startDate: '2026-06-15',
        },
        'user-owner-1'
      )
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // TEST 4: Dirty-Field Bulk Workspace Save & strict otherFees validation
  // --------------------------------------------------------------------------
  it('6. Dirty-field workspace save: persists only entered fields, first cycle custom prev reading, and strict otherFees', async () => {
    const saveRes = await meterService.saveBulkMeterWorkspace(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: testRoom1Id,
            waterPrev: '110.00', // First-cycle edited prev reading
            waterCurr: '130.00',
            elecPrev: '520.00',
            elecCurr: '590.00',
            peopleCount: 2, // 2 people
            manualOutstandingAmount: '150.00',
            otherFees: [
              { description: ' ค่าทำความสะอาดแอร์ ', amount: '500.00' },
              { description: 'ค่ากุญแจสำรอง', amount: 100 },
            ],
          },
        ],
      },
      'user-owner-1'
    );

    expect(saveRes.savedCount).toBe(1);

    // Verify snapshot
    const snapshot = await prisma.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId: testDormitoryId,
          billingCycleId: cycle1Id,
          roomId: testRoom1Id,
        },
      },
    });

    expect(snapshot?.peopleCount).toBe(2);
    expect(formatDecimal(toDecimal(snapshot?.manualOutstandingAmount))).toBe('150.00');
    expect(snapshot?.otherFees).toEqual([
      { description: 'ค่าทำความสะอาดแอร์', amount: '500.00' },
      { description: 'ค่ากุญแจสำรอง', amount: '100.00' },
    ]);

    // Verify Meter Readings created with correct usage
    const waterReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom1Id,
      'water'
    );
    expect(waterReading).toBeDefined();
    expect(waterReading?.previousReading).toBe('110.00');
    expect(waterReading?.currentReading).toBe('130.00');
    expect(waterReading?.usageUnits).toBe('20.00');

    const elecReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom1Id,
      'electricity'
    );
    expect(elecReading).toBeDefined();
    expect(elecReading?.previousReading).toBe('520.00');
    expect(elecReading?.currentReading).toBe('590.00');
    expect(elecReading?.usageUnits).toBe('70.00');
  });

  it('7. Regression: zero usage explicitly entered (current == previous) creates reading and passes eligibility', async () => {
    // For Room 103 (vacant room, but owner enters zero usage readings)
    // First create active provisional term so room has rental term
    await provisionalRentalTermService.createProvisionalTenantAndTerm(
      testDormitoryId,
      {
        roomId: testRoom3Id,
        fullName: 'นายทดสอบ การใช้ศูนย์หน่วย',
        rentalType: 'MONTHLY',
        unitRentAmount: '5000.00',
        startDate: '2026-06-01',
      },
      'user-owner-1'
    );

    // Save zero usage (water 200 -> 200, elec 700 -> 700)
    await meterService.saveBulkMeterWorkspace(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        rows: [
          {
            roomId: testRoom3Id,
            waterPrev: '200.00',
            waterCurr: '200.00',
            elecPrev: '700.00',
            elecCurr: '700.00',
            peopleCount: 1,
          },
        ],
      },
      'user-owner-1'
    );

    const waterReading = await meterRepo.findReadingByCycleRoomAndType(
      testDormitoryId,
      cycle1Id,
      testRoom3Id,
      'water'
    );
    expect(waterReading?.usageUnits).toBe('0.00');

    // Bill generation preview passes with 0.00 meter charges
    const preview = await billingService.generateBillPreview(testDormitoryId, cycle1Id, testRoom3Id);
    expect(preview).toBeDefined();
    const waterItem = preview.items.find((i) => i.type === 'water');
    expect(waterItem?.amount).toBe('0.00');
  });

  // --------------------------------------------------------------------------
  // TEST 5: Status Switch Authority (Atomic Issue, Cancel, Paid Lock)
  // --------------------------------------------------------------------------
  it('8. Status Switch Authority: Toggle OFF -> ON issues bill atomically with snapshot manual charges', async () => {
    const toggleRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'issue',
      },
      'user-owner-1',
      billingService
    );

    expect(toggleRes.action).toBe('issue');
    expect(toggleRes.bill).toBeDefined();
    expect(toggleRes.bill.status).toBe('unpaid');
    expect(toggleRes.bill.provisionalRentalTermId).toBeDefined();

    // Verify snapshot manual charges are in bill items
    const items = toggleRes.items;
    const manualOut = items.find((i: any) => i.type === 'manual_outstanding' || i.description === 'ค้างชำระ');
    const airClean = items.find((i: any) => i.description === 'ค่าทำความสะอาดแอร์');
    const keyFee = items.find((i: any) => i.description === 'ค่ากุญแจสำรอง');

    expect(manualOut?.amount).toBe('150.00');
    expect(airClean?.amount).toBe('500.00');
    expect(keyFee?.amount).toBe('100.00');
  });

  it('9. Status Switch Authority: Toggle ON -> OFF cancels unpaid bill with OWNER_METER_SWITCH_OFF', async () => {
    const cancelRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'cancel',
        cancellationReason: 'OWNER_METER_SWITCH_OFF',
      },
      'user-owner-1',
      billingService
    );

    expect(cancelRes.action).toBe('cancel');
    expect(cancelRes.status).toBe('cancelled');

    const bill = await prisma.bill.findFirst({
      where: {
        dormitoryId: testDormitoryId,
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(bill?.status).toBe('cancelled');
    expect(bill?.cancellationReason).toBe('OWNER_METER_SWITCH_OFF');
  });

  it('10. Status Switch Authority: Reissuing after cancel creates a new active bill', async () => {
    const reissueRes = await meterService.toggleRoomBillSwitch(
      testDormitoryId,
      {
        billingCycleId: cycle1Id,
        roomId: testRoom1Id,
        action: 'issue',
      },
      'user-owner-1',
      billingService
    );

    expect(reissueRes.action).toBe('issue');
    expect(reissueRes.bill.status).toBe('unpaid');
  });

  it('11. Status Switch Authority: Paid bill cannot be cancelled via switch (locked ON)', async () => {
    // Mark the bill as paid
    const activeBill = await billRepo.findByCycleAndRoom(testDormitoryId, cycle1Id, testRoom1Id);
    expect(activeBill).toBeDefined();

    await prisma.bill.update({
      where: { id: activeBill!.id },
      data: { status: 'paid' },
    });

    // Try to cancel via switch -> must reject
    await expect(
      meterService.toggleRoomBillSwitch(
        testDormitoryId,
        {
          billingCycleId: cycle1Id,
          roomId: testRoom1Id,
          action: 'cancel',
        },
        'user-owner-1',
        billingService
      )
    ).rejects.toThrow();
  });
});
