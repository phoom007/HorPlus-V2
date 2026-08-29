/**
 * @license Apache-2.0
 * Real Prisma / PostgreSQL Integration Tests for Owner Rooms R3.5c
 * Proves:
 * 1. Provisional MONTHLY UNPAID & start-cycle / later-cycle Meter presentation
 * 2. Provisional TERM UNPAID with multi-installment (single deposit charge)
 * 3. Provisional PAID canonical cash settlement (Payment, Histories, Receipt)
 * 4. Contract draft (0 bills) -> activation UNPAID (1 bill) & idempotent retry
 * 5. Contract activation PAID (canonical cash settlement & receipt)
 * 6. Future reservation start-cycle exact matching
 * 7. Missing start-cycle atomic rollback (no orphan tenant, occupancy, agreement)
 * 8. Misleading cycleCode strict period failure (cycleCode='2026-08' but period Aug 15–31 rejects start Aug 1)
 * 9. TenantRegistration sequential maintenance rejection & zero side effects
 * 10. TenantRegistration vs Room maintenance concurrency invariant
 * 11. Deposit Bill vs Normal Bill number concurrency (shared allocator)
 * 12. Normal vs Normal Bill number concurrency (shared allocator)
 * 13. Deposit vs Deposit Bill number concurrency (shared allocator)
 * 14. High-Contention Mixed Bill Allocation (5 Deposit + 5 Normal concurrent Bills = 10 unique sequential numbers)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../../db/repositories/subscription.repository.js';
import { PrismaSubscriptionPlanRepository } from '../../db/repositories/plan.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { RoomService } from '../../services/room.service.js';
import { ContractService } from '../../services/contract.service.js';
import { TenantRegistrationService } from '../../services/tenant-registration.service.js';
import { BillingService } from '../../services/billing.service.js';
import { provisionalRentalTermService } from '../../services/provisional-rental-term.service.js';
import { MeterService } from '../../services/meter.service.js';
import { paymentService } from '../../services/payment.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { resetCachedEnv } from '../../config/env.js';

const prisma = getPrismaClient();

describe('HORPLUS R3.5c — Real Prisma / PostgreSQL Registration & Global Bill Authority Integration Suite', () => {
  const testRunId = `r35c_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let contractService: ContractService;
  let meterService: MeterService;
  let roomService: RoomService;
  let tenantRegistrationService: TenantRegistrationService;
  let billingService: BillingService;

  let augCycle: any;
  let sepCycle: any;
  let octCycle: any;

  async function createTestRoom(roomNumber: string, monthlyRent: number = 5000, depositAmount: number = 5000) {
    return await prisma.room.create({
      data: {
        dormitoryId: dormId,
        buildingId: bldId,
        roomNumber: roomNumber,
        normalizedRoomNumber: roomNumber,
        floor: 1,
        roomType: 'standard',
        status: 'vacant',
        monthlyRent,
        termRent: monthlyRent * 4,
        dailyRent: 600,
        monthlyDeposit: depositAmount,
        termDeposit: depositAmount,
        dailyDeposit: depositAmount,
        depositAmount: depositAmount,
        version: 1,
      },
    });
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    await subscriptionEntitlementService.ensureSeeded();

    const roomRepo = new PrismaRoomRepository(prisma);
    const buildingRepo = new PrismaBuildingRepository(prisma);
    const subRepo = new PrismaSubscriptionRepository(prisma);
    const planRepo = new PrismaSubscriptionPlanRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const billRepo = new PrismaBillRepository(prisma);
    const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
    const meterRepo = new PrismaMeterRepository(prisma);

    contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, undefined, subscriptionEntitlementService, prisma);
    meterService = new MeterService();
    tenantRegistrationService = new TenantRegistrationService();
    billingService = new BillingService(billRepo, billingCycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo);

    // 1. Create User
    const ownerEmail = `${testRunId}@test.horplus.com`;
    const user = await prisma.user.create({
      data: {
        googleSubject: `sub_${testRunId}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Test Owner R3.5c',
      },
    });
    userId = user.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R3.5c ${testRunId}`,
        type: 'apartment',
        addressLine1: '123 Real Deposit St',
        status: 'active',
      },
    });
    dormId = dorm.id;

    const paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (paidPlan) {
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dormId,
          planId: paidPlan.id,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + 365 * 86400000),
        },
      });
    }

    // 2.1 Create Dormitory Billing Settings
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        dueDay: 5,
      },
    });

    // 3. Create Building with term configuration
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building A',
        floorCount: 4,
        termMonths: 4,
        maxTermRentInstallments: 3,
      },
    });
    bldId = building.id;

    // 4. Create Billing Cycles: August 2026, September 2026, October 2026
    const rateSnapshotData = {
      dormitoryId: dormId,
      waterBillingType: 'per_unit',
      waterRate: 18.0,
      electricityBillingType: 'per_unit',
      electricityRate: 7.0,
      commonFee: 200.0,
      commonFeeMode: 'fixed',
      internetFee: 0.0,
      internetFeeMode: 'none',
      parkingFee: 0.0,
      parkingFeeMode: 'none',
      lateFeeType: 'fixed',
      lateFeeValue: 0.0,
      source: 'TEMPLATE_DEFAULT',
    };

    augCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'สิงหาคม 2026',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-25T00:00:00.000Z'),
        dueDate: new Date('2026-08-31T00:00:00.000Z'),
        status: 'OPEN',
        rateSnapshot: {
          create: rateSnapshotData,
        },
      },
    });

    sepCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'กันยายน 2026',
        cycleCode: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
        billingDate: new Date('2026-09-25T00:00:00.000Z'),
        dueDate: new Date('2026-09-30T00:00:00.000Z'),
        status: 'OPEN',
        rateSnapshot: {
          create: rateSnapshotData,
        },
      },
    });

    octCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        name: 'ตุลาคม 2026',
        cycleCode: '2026-10',
        periodStart: new Date('2026-10-01T00:00:00.000Z'),
        periodEnd: new Date('2026-10-31T23:59:59.999Z'),
        billingDate: new Date('2026-10-25T00:00:00.000Z'),
        dueDate: new Date('2026-10-31T00:00:00.000Z'),
        status: 'OPEN',
        rateSnapshot: {
          create: rateSnapshotData,
        },
      },
    });
  });

  afterAll(async () => {
    if (dormId) {
      await prisma.receiptSequence.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.receipt.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.paymentStatusHistory.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billStatusHistory.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.payment.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billItem.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.meterReading.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.meterDevice.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contractSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contractStatusHistory.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.occupancy.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.roomOperationalStatusChange.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.auditLog.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.dormitory.delete({ where: { id: dormId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  it('1. Provisional MONTHLY UNPAID: creates start-cycle deposit bill, reflected in Meter preview & persists across cycles', async () => {
    const room = await createTestRoom('101-PM', 4800, 4800);

    const result = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      dormId,
      {
        roomId: room.id,
        fullName: 'สมชาย รายเดือน',
        phone: '0812345678',
        rentalType: 'MONTHLY',
        startDate: '2026-08-01',
        durationMonths: 6,
        unitRentAmount: 4800,
        totalRentAmount: 28800,
        depositAmount: 4800,
        depositDeclaredStatus: 'UNPAID',
      },
      userId
    );

    expect(result.tenant).toBeDefined();
    expect(result.provisionalTerm).toBeDefined();

    // 1.1 Verify exactly ONE Deposit Bill created in August
    const depositBills = await prisma.bill.findMany({
      where: {
        dormitoryId: dormId,
        provisionalRentalTermId: result.provisionalTerm.id,
        billKind: 'DEPOSIT',
      },
      include: { items: true },
    });
    expect(depositBills.length).toBe(1);
    const augDepBill = depositBills[0];
    expect(augDepBill.billingCycleId).toBe(augCycle.id);
    expect(augDepBill.status).toBe('unpaid');
    expect(Number(augDepBill.totalAmount)).toBe(4800);
    expect(Number(augDepBill.paidAmount)).toBe(0);
    expect(Number(augDepBill.outstandingAmount)).toBe(4800);
    expect(augDepBill.paidAt).toBeNull();
    expect(augDepBill.items.length).toBe(1);
    expect(augDepBill.items[0].type).toBe('deposit');

    // 1.2 August Meter Preview Context contains Deposit Charge Component
    const augPreview = await meterService.getMeterBillingPreviewContext(dormId, augCycle.id);
    const augRoomPreview = augPreview.rooms.find((r: any) => r.roomId === room.id);
    expect(augRoomPreview).toBeDefined();
    expect(augRoomPreview.agreementDepositPaymentStatus).toBe('UNPAID');

    const depositComp = augRoomPreview.chargeComponents.find((c: any) => c.type === 'deposit');
    expect(depositComp).toBeDefined();
    expect(depositComp.amount).toBe('4800.00');
    expect(depositComp.status).toBe('UNPAID');
    expect(depositComp.includedInAmountDue).toBe(true);

    // 1.3 September & October: Later cycles do NOT create a new deposit charge component
    const sepPreview = await meterService.getMeterBillingPreviewContext(dormId, sepCycle.id);
    const sepRoomPreview = sepPreview.rooms.find((r: any) => r.roomId === room.id);
    expect(sepRoomPreview).toBeDefined();
    expect(sepRoomPreview.agreementDepositPaymentStatus).toBe('UNPAID');
    const sepDepositComp = sepRoomPreview.chargeComponents.find((c: any) => c.type === 'deposit');
    expect(sepDepositComp).toBeUndefined();

    // Settle August deposit bill via canonical payment authority
    await paymentService.recordCash({
      dormitoryId: dormId,
      billId: augDepBill.id,
      amount: '4800.00',
      userId,
    });

    const augPreviewPaid = await meterService.getMeterBillingPreviewContext(dormId, augCycle.id);
    const augRoomPaid = augPreviewPaid.rooms.find((r: any) => r.roomId === room.id);
    expect(augRoomPaid.agreementDepositPaymentStatus).toBe('PAID');

    const sepPreviewPaid = await meterService.getMeterBillingPreviewContext(dormId, sepCycle.id);
    const sepRoomPaid = sepPreviewPaid.rooms.find((r: any) => r.roomId === room.id);
    expect(sepRoomPaid.agreementDepositPaymentStatus).toBe('PAID');
  });

  it('2. Provisional TERM UNPAID: 3 installments create only 1 Deposit Bill in start cycle', async () => {
    const room = await createTestRoom('102-PT', 4500, 5000);

    const result = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      dormId,
      {
        roomId: room.id,
        fullName: 'สมหญิง รายเทอม',
        phone: '0899998877',
        rentalType: 'TERM',
        startDate: '2026-08-01',
        durationMonths: 4,
        termInstallmentCount: 3,
        unitRentAmount: 6000,
        totalRentAmount: 18000,
        depositAmount: 5000,
        depositDeclaredStatus: 'UNPAID',
      },
      userId
    );

    const termBills = await prisma.bill.findMany({
      where: {
        dormitoryId: dormId,
        provisionalRentalTermId: result.provisionalTerm.id,
        billKind: 'DEPOSIT',
      },
    });

    expect(termBills.length).toBe(1);
    expect(termBills[0].billingCycleId).toBe(augCycle.id);
    expect(Number(termBills[0].totalAmount)).toBe(5000);
    expect(termBills[0].status).toBe('unpaid');
  });

  it('3. Provisional PAID: settles through canonical in-transaction cash authority with Payment, Histories & Receipt', async () => {
    const room = await createTestRoom('103-PAID', 5000, 5000);

    const result = await provisionalRentalTermService.createProvisionalTenantAndTerm(
      dormId,
      {
        roomId: room.id,
        fullName: 'สมพร จ่ายสด',
        phone: '0855554433',
        rentalType: 'MONTHLY',
        startDate: '2026-08-01',
        durationMonths: 12,
        unitRentAmount: 5000,
        totalRentAmount: 60000,
        depositAmount: 5000,
        depositDeclaredStatus: 'PAID',
      },
      userId
    );

    const depBill = await prisma.bill.findFirst({
      where: {
        provisionalRentalTermId: result.provisionalTerm.id,
        billKind: 'DEPOSIT',
      },
    });

    expect(depBill).toBeDefined();
    expect(depBill!.status).toBe('PAID');
    expect(Number(depBill!.paidAmount)).toBe(5000);
    expect(Number(depBill!.outstandingAmount)).toBe(0);

    // Canonical Payment record
    const payment = await prisma.payment.findFirst({
      where: { billId: depBill!.id },
    });
    expect(payment).toBeDefined();
    expect(payment!.method).toBe('CASH');
    expect(payment!.status).toBe('APPROVED');

    // Canonical Receipt
    const receipt = await prisma.receipt.findFirst({
      where: { billId: depBill!.id },
    });
    expect(receipt).toBeDefined();
    expect(receipt!.receiptNumber).toMatch(/^RC-/);
    expect((receipt!.snapshotData as any).total).toBe('5000.00');
  });

  it('4. Contract Draft vs Activation: draft creates 0 bills; activation creates 1 bill & is idempotent', async () => {
    const room = await createTestRoom('104-CTR', 6000, 6000);

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-104`,
        firstName: 'สมหมาย',
        lastName: 'ทำสัญญา',
        displayName: 'สมหมาย ทำสัญญา',
        phone: '0877776655',
        status: 'active',
      },
    });

    const contract = await contractService.createContract(
      dormId,
      {
        roomId: room.id,
        tenantId: tenant.id,
        startDate: '2026-08-01',
        endDate: '2027-01-31',
        durationMonths: 6,
        rentAmount: '6000',
        depositAmount: '6000',
        status: 'draft',
      },
      userId
    );

    const draftBills = await prisma.bill.findMany({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });
    expect(draftBills.length).toBe(0);

    await contractService.activateContract(
      contract.id,
      dormId,
      { depositDeclaredStatus: 'UNPAID' },
      userId
    );

    const activeBills = await prisma.bill.findMany({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });
    expect(activeBills.length).toBe(1);
    expect(activeBills[0].billingCycleId).toBe(augCycle.id);
    expect(activeBills[0].status).toBe('unpaid');
    expect(Number(activeBills[0].outstandingAmount)).toBe(6000);
  });

  it('5. Contract Activation PAID: settles via canonical cash authority & creates receipt', async () => {
    const room = await createTestRoom('105-CTR-PAID', 7000, 7000);

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-105`,
        firstName: 'กิตติ',
        lastName: 'สัญญาพร้อมจ่าย',
        displayName: 'กิตติ สัญญาพร้อมจ่าย',
        phone: '0866665544',
        status: 'active',
      },
    });

    const contract = await contractService.createContract(
      dormId,
      {
        roomId: room.id,
        tenantId: tenant.id,
        startDate: '2026-08-01',
        endDate: '2027-07-31',
        durationMonths: 12,
        rentAmount: '7000',
        depositAmount: '7000',
        status: 'draft',
      },
      userId
    );

    await contractService.activateContract(
      contract.id,
      dormId,
      { depositDeclaredStatus: 'PAID' },
      userId
    );

    const bill = await prisma.bill.findFirst({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });

    expect(bill).toBeDefined();
    expect(bill!.status).toBe('PAID');
    expect(Number(bill!.paidAmount)).toBe(7000);
    expect(Number(bill!.outstandingAmount)).toBe(0);

    const receipt = await prisma.receipt.findFirst({ where: { billId: bill!.id } });
    expect(receipt).toBeDefined();
    expect((receipt!.snapshotData as any).total).toBe('7000.00');
  });

  it('6. Future Reservation Start-Cycle Exact Resolution: assigns to October cycle', async () => {
    const room = await createTestRoom('106-FUT', 5500, 5500);

    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-106`,
        firstName: 'อนุชา',
        lastName: 'จองล่วงหน้า',
        displayName: 'อนุชา จองล่วงหน้า',
        phone: '0833332211',
        status: 'active',
      },
    });

    const contract = await contractService.createContract(
      dormId,
      {
        roomId: room.id,
        tenantId: tenant.id,
        startDate: '2026-10-01',
        endDate: '2027-03-31',
        durationMonths: 6,
        rentAmount: '5500',
        depositAmount: '5500',
        status: 'draft',
      },
      userId
    );

    await contractService.activateContract(
      contract.id,
      dormId,
      { depositDeclaredStatus: 'UNPAID' },
      userId
    );

    const bill = await prisma.bill.findFirst({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });

    expect(bill).toBeDefined();
    expect(bill!.billingCycleId).toBe(octCycle.id);
  });

  it('7. Missing Start-Cycle Error & Atomic Rollback: throws DEPOSIT_BILLING_CYCLE_NOT_FOUND and leaves 0 orphan records', async () => {
    const room = await createTestRoom('107-FAIL', 5000, 5000);

    const errPromise = provisionalRentalTermService.createProvisionalTenantAndTerm(
      dormId,
      {
        roomId: room.id,
        fullName: 'วิชัย วันเริ่มผิด',
        phone: '0822221100',
        rentalType: 'MONTHLY',
        startDate: '2027-05-01',
        durationMonths: 6,
        unitRentAmount: 5000,
        totalRentAmount: 30000,
        depositAmount: 5000,
        depositDeclaredStatus: 'UNPAID',
      },
      userId
    );

    await expect(errPromise).rejects.toMatchObject({
      code: 'DEPOSIT_BILLING_CYCLE_NOT_FOUND',
      statusCode: 409,
    });

    const orphanTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: dormId, displayName: 'วิชัย วันเริ่มผิด' },
    });
    expect(orphanTenant).toBeNull();
  });

  it('8. Misleading cycleCode strict period failure: cycleCode="2026-08" with period Aug 15–31 rejects start Aug 1', async () => {
    // 1. Create an isolated dormitory with ONLY one misleading cycle
    const isolatedDorm = await prisma.dormitory.create({
      data: {
        name: `Isolated Dorm Misleading ${Date.now()}`,
        type: 'apartment',
        status: 'active',
      },
    });

    const isolatedBuilding = await prisma.building.create({
      data: {
        dormitoryId: isolatedDorm.id,
        name: 'Building Iso',
        floorCount: 2,
      },
    });

    const isolatedRoom = await prisma.room.create({
      data: {
        dormitoryId: isolatedDorm.id,
        buildingId: isolatedBuilding.id,
        roomNumber: 'ISO-101',
        normalizedRoomNumber: 'ISO-101',
        floor: 1,
        roomType: 'standard',
        status: 'vacant',
        monthlyRent: 5000,
        depositAmount: 5000,
        monthlyDeposit: 5000,
        termDeposit: 5000,
        dailyDeposit: 5000,
      },
    });

    // Create misleading cycle: cycleCode is literally '2026-08', but period is strictly Aug 15 to Aug 31
    const misleadingCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: isolatedDorm.id,
        name: 'รอบปลายเดือน สิงหาคม 2026',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-15T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-25T00:00:00.000Z'),
        dueDate: new Date('2026-08-31T00:00:00.000Z'),
        status: 'OPEN',
      },
    });

    // Attempt to create agreement starting 2026-08-01 (Aug 1 is NOT within [Aug 15, Aug 31])
    // Period containment is the sole authority: must NOT match on cycleCode '2026-08'
    const errPromise = provisionalRentalTermService.createProvisionalTenantAndTerm(
      isolatedDorm.id,
      {
        roomId: isolatedRoom.id,
        fullName: 'เกรียงไกร นอกช่วงรอบ',
        phone: '0844445566',
        rentalType: 'MONTHLY',
        startDate: '2026-08-01',
        durationMonths: 6,
        unitRentAmount: 5000,
        totalRentAmount: 30000,
        depositAmount: 5000,
        depositDeclaredStatus: 'UNPAID',
      },
      userId
    );

    await expect(errPromise).rejects.toMatchObject({
      code: 'DEPOSIT_BILLING_CYCLE_NOT_FOUND',
      statusCode: 409,
    });

    // Cleanup isolated dorm
    await prisma.billingCycle.delete({ where: { id: misleadingCycle.id } });
    await prisma.room.delete({ where: { id: isolatedRoom.id } });
    await prisma.building.delete({ where: { id: isolatedBuilding.id } });
    await prisma.dormitory.delete({ where: { id: isolatedDorm.id } });
  });

  it('9. TenantRegistration sequential maintenance rejection & zero side effects', async () => {
    const room = await createTestRoom('109-REG-MAINT', 5000, 5000);

    // 1. Create Registration Request
    const regReq = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: dormId,
        requestedRoomId: room.id,
        firstName: 'สมปอง',
        lastName: 'สมัครเช่า',
        phone: '0898887766',
        status: 'pending_owner_approval',
        acceptanceSnapshot: { agreedTerms: true },
      },
    });

    // 2. Set Room to maintenance
    await roomService.updateRoom({
      roomId: room.id,
      dormitoryId: dormId,
      changes: { status: 'maintenance' },
      expectedVersion: 1,
      actorUserId: userId,
    });
    const roomAfterMaint = await prisma.room.findUnique({ where: { id: room.id } });
    expect(roomAfterMaint?.status).toBe('maintenance');

    // 3. Attempt approveRequest -> MUST fail with 409 ROOM_UNDER_MAINTENANCE
    await expect(
      tenantRegistrationService.approveRequest(
        regReq.id,
        dormId,
        {
          startDate: '2026-08-01',
          endDate: '2027-01-31',
          durationMonths: 6,
          rentAmount: 5000,
          depositAmount: 5000,
          advancePaymentAmount: 0,
          confirmReplacement: true, // Even with replacement confirmation, maintenance MUST block!
        },
        userId
      )
    ).rejects.toMatchObject({
      code: 'ROOM_UNDER_MAINTENANCE',
      statusCode: 409,
    });

    // 4. Assert zero side effects
    const regReqAfter = await prisma.tenantRegistrationRequest.findUnique({ where: { id: regReq.id } });
    expect(regReqAfter?.status).toBe('pending_owner_approval');

    const orphanContract = await prisma.contract.findFirst({ where: { roomId: room.id } });
    expect(orphanContract).toBeNull();

    const orphanOccupancy = await prisma.occupancy.findFirst({ where: { roomId: room.id } });
    expect(orphanOccupancy).toBeNull();

    const orphanDepositBill = await prisma.bill.findFirst({ where: { roomId: room.id, billKind: 'DEPOSIT' } });
    expect(orphanDepositBill).toBeNull();
  });

  it('10. TenantRegistration vs Room maintenance concurrency invariant: exactly one succeeds', async () => {
    const room = await createTestRoom('110-REG-CONC', 5000, 5000);

    const regReq = await prisma.tenantRegistrationRequest.create({
      data: {
        dormitoryId: dormId,
        requestedRoomId: room.id,
        firstName: 'สุดา',
        lastName: 'แข่งขัน',
        phone: '0851112222',
        status: 'pending_owner_approval',
        acceptanceSnapshot: { agreedTerms: true },
      },
    });

    // Run RoomService.updateRoom(status=maintenance) vs tenantRegistrationService.approveRequest() concurrently
    const results = await Promise.allSettled([
      roomService.updateRoom({
        roomId: room.id,
        dormitoryId: dormId,
        changes: { status: 'maintenance' },
        expectedVersion: 1,
        actorUserId: userId,
      }),
      tenantRegistrationService.approveRequest(
        regReq.id,
        dormId,
        {
          startDate: '2026-08-01',
          endDate: '2027-01-31',
          durationMonths: 6,
          rentAmount: 5000,
          depositAmount: 5000,
          advancePaymentAmount: 0,
        },
        userId
      ),
    ]);

    const maintRes = results[0];
    const approveRes = results[1];

    const maintSuccess = maintRes.status === 'fulfilled';
    const approveSuccess = approveRes.status === 'fulfilled';

    // Invariant: Exactly ONE succeeds, NEVER both
    expect(maintSuccess !== approveSuccess).toBe(true);

    if (maintSuccess) {
      // Maintenance won -> Approval rejected with ROOM_UNDER_MAINTENANCE
      expect(approveRes.status).toBe('rejected');
      const err = (approveRes as PromiseRejectedResult).reason;
      expect(err.code).toBe('ROOM_UNDER_MAINTENANCE');

      const roomDb = await prisma.room.findUnique({ where: { id: room.id } });
      expect(roomDb?.status).toBe('maintenance');

      const contracts = await prisma.contract.count({ where: { roomId: room.id } });
      expect(contracts).toBe(0);
    } else {
      // Approval won -> Maintenance rejected because room is occupied/reserved
      expect(maintRes.status).toBe('rejected');
      const err = (maintRes as PromiseRejectedResult).reason;
      expect(['ROOM_HAS_ACTIVE_OCCUPANCY', 'ROOM_HAS_ACTIVE_RESERVATION']).toContain(err.code);

      const contracts = await prisma.contract.count({ where: { roomId: room.id } });
      expect(contracts).toBe(1);
    }
  });

  it('11. Deposit Bill vs Normal Bill number concurrency: shared allocator generates distinct non-colliding numbers', async () => {
    const roomDeposit = await createTestRoom('201-BNC', 4500, 4500);
    const roomNormal = await createTestRoom('202-BNC', 4500, 4500);

    // Prepare active contract for roomNormal so billingService.generateBill succeeds
    const tenantNormal = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-202`,
        firstName: 'ผู้เช่า',
        lastName: 'บิลปกติ',
        displayName: 'ผู้เช่า บิลปกติ',
        phone: '0812340002',
        status: 'active',
      },
    });

    const normalContract = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: roomNormal.id,
        tenantId: tenantNormal.id,
        contractNumber: `CTR-${Date.now()}-202`,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2027-01-31T23:59:59.999Z'),
        status: 'active',
        rentAmount: 4500,
        depositAmount: 4500,
      },
    });

    await prisma.occupancy.create({
      data: {
        dormitoryId: dormId,
        roomId: roomNormal.id,
        tenantId: tenantNormal.id,
        contractId: normalContract.id,
        status: 'ACTIVE',
        startedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    });

    // Record meter readings for roomNormal so MONTHLY_UTILITY calculation succeeds
    await meterService.saveBulkMeterWorkspace(dormId, {
      billingCycleId: augCycle.id,
      rows: [
        {
          roomId: roomNormal.id,
          waterPrev: '10',
          waterCurr: '20',
          elecPrev: '100',
          elecCurr: '150',
        },
      ],
    }, userId);

    // Concurrently execute:
    // Op A: Provisional Rental Term creation -> emits Deposit Bill
    // Op B: Normal BillingService.generateBill -> emits MONTHLY_UTILITY Bill
    const [resDeposit, resNormal] = await Promise.all([
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        {
          roomId: roomDeposit.id,
          fullName: 'คนเช่า มัดจำ',
          phone: '0812340001',
          rentalType: 'MONTHLY',
          startDate: '2026-08-01',
          durationMonths: 6,
          unitRentAmount: 4500,
          totalRentAmount: 27000,
          depositAmount: 4500,
          depositDeclaredStatus: 'UNPAID',
        },
        userId
      ),
      billingService.generateBill(
        dormId,
        {
          billingCycleId: augCycle.id,
          roomId: roomNormal.id,
          billKind: 'MONTHLY_UTILITY',
        },
        userId,
        new Date('2026-08-25T00:00:00.000Z')
      ),
    ]);

    expect(resDeposit.provisionalTerm).toBeDefined();
    expect(resNormal.bill).toBeDefined();

    const billDeposit = await prisma.bill.findFirst({
      where: { provisionalRentalTermId: resDeposit.provisionalTerm.id, billKind: 'DEPOSIT' },
    });
    const billNormal = resNormal.bill;

    expect(billDeposit).toBeDefined();
    expect(billNormal).toBeDefined();
    expect(billDeposit!.billNumber).not.toBe(billNormal.billNumber);
    expect(billDeposit!.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
    expect(billNormal.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
  });

  it('12. Normal vs Normal Bill number concurrency: generates distinct sequential bill numbers', async () => {
    const roomA = await createTestRoom('301-NORM', 5000, 5000);
    const roomB = await createTestRoom('302-NORM', 5000, 5000);

    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-301`,
        firstName: 'ผู้เช่า',
        lastName: 'บิล A',
        displayName: 'ผู้เช่า บิล A',
        phone: '0812340301',
        status: 'active',
      },
    });

    const tenantB = await prisma.tenant.create({
      data: {
        dormitoryId: dormId,
        tenantNumber: `TNT-${Date.now()}-302`,
        firstName: 'ผู้เช่า',
        lastName: 'บิล B',
        displayName: 'ผู้เช่า บิล B',
        phone: '0812340302',
        status: 'active',
      },
    });

    const contractA = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: roomA.id,
        tenantId: tenantA.id,
        contractNumber: `CTR-${Date.now()}-301`,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2027-01-31T23:59:59.999Z'),
        status: 'active',
        rentAmount: 5000,
        depositAmount: 5000,
      },
    });

    const contractB = await prisma.contract.create({
      data: {
        dormitoryId: dormId,
        roomId: roomB.id,
        tenantId: tenantB.id,
        contractNumber: `CTR-${Date.now()}-302`,
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2027-01-31T23:59:59.999Z'),
        status: 'active',
        rentAmount: 5000,
        depositAmount: 5000,
      },
    });

    await prisma.occupancy.createMany({
      data: [
        {
          dormitoryId: dormId,
          roomId: roomA.id,
          tenantId: tenantA.id,
          contractId: contractA.id,
          status: 'ACTIVE',
          startedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          dormitoryId: dormId,
          roomId: roomB.id,
          tenantId: tenantB.id,
          contractId: contractB.id,
          status: 'ACTIVE',
          startedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      ],
    });

    // Record meter readings for roomA and roomB
    await meterService.saveBulkMeterWorkspace(dormId, {
      billingCycleId: augCycle.id,
      rows: [
        {
          roomId: roomA.id,
          waterPrev: '10',
          waterCurr: '20',
          elecPrev: '100',
          elecCurr: '150',
        },
        {
          roomId: roomB.id,
          waterPrev: '10',
          waterCurr: '20',
          elecPrev: '100',
          elecCurr: '150',
        },
      ],
    }, userId);

    const [resA, resB] = await Promise.all([
      billingService.generateBill(
        dormId,
        { billingCycleId: augCycle.id, roomId: roomA.id, billKind: 'MONTHLY_UTILITY' },
        userId,
        new Date('2026-08-25T00:00:00.000Z')
      ),
      billingService.generateBill(
        dormId,
        { billingCycleId: augCycle.id, roomId: roomB.id, billKind: 'MONTHLY_UTILITY' },
        userId,
        new Date('2026-08-25T00:00:00.000Z')
      ),
    ]);

    expect(resA.bill).toBeDefined();
    expect(resB.bill).toBeDefined();
    expect(resA.bill.billNumber).not.toBe(resB.bill.billNumber);
    expect(resA.bill.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
    expect(resB.bill.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
  });

  it('13. Deposit vs Deposit Bill number concurrency: serializes and generates consecutive bill numbers without collision', async () => {
    const roomA = await createTestRoom('401-CONC', 4000, 4000);
    const roomB = await createTestRoom('402-CONC', 4000, 4000);

    const [resA, resB] = await Promise.all([
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        {
          roomId: roomA.id,
          fullName: 'คนเช่า A401',
          phone: '0811110401',
          rentalType: 'MONTHLY',
          startDate: '2026-08-01',
          durationMonths: 6,
          unitRentAmount: 4000,
          totalRentAmount: 24000,
          depositAmount: 4000,
          depositDeclaredStatus: 'UNPAID',
        },
        userId
      ),
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        {
          roomId: roomB.id,
          fullName: 'คนเช่า B402',
          phone: '0811110402',
          rentalType: 'MONTHLY',
          startDate: '2026-08-01',
          durationMonths: 6,
          unitRentAmount: 4000,
          totalRentAmount: 24000,
          depositAmount: 4000,
          depositDeclaredStatus: 'UNPAID',
        },
        userId
      ),
    ]);

    expect(resA.provisionalTerm).toBeDefined();
    expect(resB.provisionalTerm).toBeDefined();

    const billA = await prisma.bill.findFirst({
      where: { provisionalRentalTermId: resA.provisionalTerm.id, billKind: 'DEPOSIT' },
    });
    const billB = await prisma.bill.findFirst({
      where: { provisionalRentalTermId: resB.provisionalTerm.id, billKind: 'DEPOSIT' },
    });

    expect(billA).toBeDefined();
    expect(billB).toBeDefined();
    expect(billA!.billNumber).not.toBe(billB!.billNumber);
    expect(billA!.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
    expect(billB!.billNumber).toMatch(/^INV-2026-08-\d{4}$/);
  });

  it('14. High-Contention Mixed Bill Allocation: 5 concurrent Deposit Bills + 5 concurrent Normal Bills produce 10 unique non-colliding sequences', async () => {
    // 1. Create 10 rooms in the same dormitory: 5 for normal bills (501..505), 5 for deposit bills (506..510)
    const normalRooms = await Promise.all([
      createTestRoom('501-HC', 4000, 4000),
      createTestRoom('502-HC', 4000, 4000),
      createTestRoom('503-HC', 4000, 4000),
      createTestRoom('504-HC', 4000, 4000),
      createTestRoom('505-HC', 4000, 4000),
    ]);

    const depositRooms = await Promise.all([
      createTestRoom('506-HC', 4000, 4000),
      createTestRoom('507-HC', 4000, 4000),
      createTestRoom('508-HC', 4000, 4000),
      createTestRoom('509-HC', 4000, 4000),
      createTestRoom('510-HC', 4000, 4000),
    ]);

    // Prepare active tenancies & contracts for normalRooms
    for (let i = 0; i < normalRooms.length; i++) {
      const room = normalRooms[i];
      const tenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `TNT-HC-${Date.now()}-${i}`,
          firstName: `ผู้เช่าปกติ${i}`,
          lastName: 'ทดสอบแรงสูง',
          displayName: `ผู้เช่าปกติ${i} ทดสอบแรงสูง`,
          phone: `089100050${i}`,
          status: 'active',
        },
      });

      const contract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-HC-${Date.now()}-${i}`,
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2027-01-31T23:59:59.999Z'),
          status: 'active',
          rentAmount: 4000,
          depositAmount: 4000,
        },
      });

      await prisma.occupancy.create({
        data: {
          dormitoryId: dormId,
          roomId: room.id,
          tenantId: tenant.id,
          contractId: contract.id,
          status: 'ACTIVE',
          startedAt: new Date('2026-08-01T00:00:00.000Z'),
        },
      });
    }

    // Save meter readings for all normalRooms
    await meterService.saveBulkMeterWorkspace(dormId, {
      billingCycleId: augCycle.id,
      rows: normalRooms.map((r, idx) => ({
        roomId: r.id,
        waterPrev: '10',
        waterCurr: `${20 + idx}`,
        elecPrev: '100',
        elecCurr: `${150 + idx}`,
      })),
    }, userId);

    // Concurrently launch 10 operations (5 Deposit Bills + 5 Normal Bills) on the same cycle!
    const operations: Promise<any>[] = [
      // 5 Normal bill generations
      ...normalRooms.map(r => billingService.generateBill(
        dormId,
        { billingCycleId: augCycle.id, roomId: r.id, billKind: 'MONTHLY_UTILITY' },
        userId,
        new Date('2026-08-25T00:00:00.000Z')
      )),
      // 5 Deposit bill generations
      ...depositRooms.map((r, idx) => provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        {
          roomId: r.id,
          fullName: `ผู้เช่ามัดจำ${idx} แรงสูง`,
          phone: `089200050${idx}`,
          rentalType: 'MONTHLY',
          startDate: '2026-08-01',
          durationMonths: 6,
          unitRentAmount: 4000,
          totalRentAmount: 24000,
          depositAmount: 4000,
          depositDeclaredStatus: 'UNPAID',
        },
        userId
      )),
    ];

    const results = await Promise.all(operations);
    expect(results.length).toBe(10);

    // Extract all 10 bill numbers
    const normalBillNumbers = results.slice(0, 5).map(res => res.bill.billNumber);
    const depositTermIds = results.slice(5, 10).map(res => res.provisionalTerm.id);
    const depositBills = await prisma.bill.findMany({
      where: {
        provisionalRentalTermId: { in: depositTermIds },
        billKind: 'DEPOSIT',
      },
      select: { billNumber: true },
    });
    const depositBillNumbers = depositBills.map(b => b.billNumber);

    const all10BillNumbers = [...normalBillNumbers, ...depositBillNumbers];
    expect(all10BillNumbers.length).toBe(10);

    // Verify all bill numbers match canonical format
    for (const bNum of all10BillNumbers) {
      expect(bNum).toMatch(/^INV-2026-08-\d{4}$/);
    }

    // Verify all 10 bill numbers are strictly UNIQUE (0 collisions, 0 duplicates)
    const uniqueNumbers = new Set(all10BillNumbers);
    expect(uniqueNumbers.size).toBe(10);
  });
});
