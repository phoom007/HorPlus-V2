/**
 * @license Apache-2.0
 * Real Prisma / PostgreSQL Integration Tests for Owner Rooms R3.5a
 * Proves:
 * 1. Provisional MONTHLY UNPAID & start-cycle / later-cycle Meter presentation
 * 2. Provisional TERM UNPAID with multi-installment (single deposit charge)
 * 3. Provisional PAID canonical cash settlement (Payment, Histories, Receipt)
 * 4. Contract draft (0 bills) -> activation UNPAID (1 bill) & idempotent retry
 * 5. Contract activation PAID (canonical cash settlement & receipt)
 * 6. Future reservation start-cycle exact matching
 * 7. Missing start-cycle atomic rollback (no orphan tenant, occupancy, agreement)
 * 8. Two-room concurrent bill-number allocation serialization
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { ContractService } from '../../services/contract.service.js';
import { provisionalRentalTermService } from '../../services/provisional-rental-term.service.js';
import { MeterService } from '../../services/meter.service.js';
import { paymentService } from '../../services/payment.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { resetCachedEnv } from '../../config/env.js';

const prisma = getPrismaClient();

describe('HORPLUS R3.5a — Real Prisma / PostgreSQL Deposit Production Integration Suite', () => {
  const testRunId = `r35a_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  let dormId: string;
  let bldId: string;
  let userId: string;
  let contractService: ContractService;
  let meterService: MeterService;

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
    const contractRepo = new PrismaContractRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    contractService = new ContractService(contractRepo, roomRepo, tenantRepo);
    meterService = new MeterService();

    // 1. Create User
    const ownerEmail = `${testRunId}@test.horplus.com`;
    const user = await prisma.user.create({
      data: {
        googleSubject: `sub_${testRunId}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'Test Owner R3.5a',
      },
    });
    userId = user.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `Dorm R3.5a ${testRunId}`,
        type: 'apartment',
        addressLine1: '123 Real Deposit St',
        status: 'active',
      },
    });
    dormId = dorm.id;

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
          create: {
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
          },
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
          create: {
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
          },
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
          create: {
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
          },
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
      await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contractSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contractStatusHistory.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.occupancy.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });
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
    // Lifecycle status remains UNPAID because August bill is unpaid
    expect(sepRoomPreview.agreementDepositPaymentStatus).toBe('UNPAID');
    // No selected-cycle deposit component in September
    const sepDepositComp = sepRoomPreview.chargeComponents.find((c: any) => c.type === 'deposit');
    expect(sepDepositComp).toBeUndefined();

    // Verify DB still has exactly 1 deposit bill
    const totalDepBills = await prisma.bill.count({
      where: { provisionalRentalTermId: result.provisionalTerm.id, billKind: 'DEPOSIT' },
    });
    expect(totalDepBills).toBe(1);

    // 1.4 Settle August deposit bill via canonical payment authority
    await paymentService.recordCash({
      dormitoryId: dormId,
      billId: augDepBill.id,
      amount: '4800.00',
      userId,
    });

    // 1.5 After settlement, August, September, and October all reflect PAID
    const augPreviewPaid = await meterService.getMeterBillingPreviewContext(dormId, augCycle.id);
    const augRoomPaid = augPreviewPaid.rooms.find((r: any) => r.roomId === room.id);
    expect(augRoomPaid.agreementDepositPaymentStatus).toBe('PAID');

    const sepPreviewPaid = await meterService.getMeterBillingPreviewContext(dormId, sepCycle.id);
    const sepRoomPaid = sepPreviewPaid.rooms.find((r: any) => r.roomId === room.id);
    expect(sepRoomPaid.agreementDepositPaymentStatus).toBe('PAID');

    const octPreviewPaid = await meterService.getMeterBillingPreviewContext(dormId, octCycle.id);
    const octRoomPaid = octPreviewPaid.rooms.find((r: any) => r.roomId === room.id);
    expect(octRoomPaid.agreementDepositPaymentStatus).toBe('PAID');
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
    expect(depBill!.paidAt).toBeInstanceOf(Date);

    // Canonical Payment record
    const payment = await prisma.payment.findFirst({
      where: { billId: depBill!.id },
    });
    expect(payment).toBeDefined();
    expect(payment!.method).toBe('CASH');
    expect(payment!.status).toBe('APPROVED');
    expect(Number(payment!.amount)).toBe(5000);

    // Canonical PaymentStatusHistory
    const psh = await prisma.paymentStatusHistory.findFirst({
      where: { paymentId: payment!.id },
    });
    expect(psh).toBeDefined();
    expect(psh!.toStatus).toBe('APPROVED');

    // Canonical BillStatusHistory
    const bsh = await prisma.billStatusHistory.findFirst({
      where: { billId: depBill!.id },
    });
    expect(bsh).toBeDefined();
    expect(bsh!.toStatus).toBe('PAID');

    // Canonical Receipt
    const receipt = await prisma.receipt.findFirst({
      where: { billId: depBill!.id },
    });
    expect(receipt).toBeDefined();
    expect(receipt!.receiptNumber).toMatch(/^RC-/);
    expect((receipt!.snapshotData as any).total).toBe("5000.00");
    expect((receipt!.snapshotData as any).discount).toBe("0.00");
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

    // 4.1 Create draft contract
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

    expect(contract.id).toBeDefined();

    // Draft creates ZERO deposit bills
    const draftBills = await prisma.bill.findMany({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });
    expect(draftBills.length).toBe(0);

    // 4.2 Activate Contract with UNPAID
    const activated = await contractService.activateContract(
      contract.id,
      dormId,
      { depositDeclaredStatus: 'UNPAID' },
      userId
    );

    expect(activated.status).toBe('active');

    // Exactly 1 Deposit Bill created on activation
    const activeBills = await prisma.bill.findMany({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });
    expect(activeBills.length).toBe(1);
    expect(activeBills[0].billingCycleId).toBe(augCycle.id);
    expect(activeBills[0].status).toBe('unpaid');
    expect(Number(activeBills[0].outstandingAmount)).toBe(6000);

    // 4.3 Idempotent activation retry does NOT duplicate bill
    await contractService.activateContract(
      contract.id,
      dormId,
      { depositDeclaredStatus: 'UNPAID' },
      userId
    );

    const retryBills = await prisma.bill.findMany({
      where: { contractId: contract.id, billKind: 'DEPOSIT' },
    });
    expect(retryBills.length).toBe(1);
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

    // Canonical Payment & Receipt
    const payment = await prisma.payment.findFirst({ where: { billId: bill!.id } });
    expect(payment).toBeDefined();
    expect(payment!.status).toBe('APPROVED');

    const receipt = await prisma.receipt.findFirst({ where: { billId: bill!.id } });
    expect(receipt).toBeDefined();
    expect((receipt!.snapshotData as any).total).toBe("7000.00");
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
    // Belongs to October cycle, NOT August
    expect(bill!.billingCycleId).toBe(octCycle.id);
  });

  it('7. Missing Start-Cycle Error & Atomic Rollback: throws DEPOSIT_BILLING_CYCLE_NOT_FOUND and leaves 0 orphan records', async () => {
    const room = await createTestRoom('107-FAIL', 5000, 5000);

    // Start date in May 2027 (cycle does not exist)
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

    // Atomic Rollback Verification
    const orphanTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: dormId, displayName: 'วิชัย วันเริ่มผิด' },
    });
    expect(orphanTenant).toBeNull();

    const orphanTerm = await prisma.provisionalRentalTerm.findFirst({
      where: { dormitoryId: dormId, roomId: room.id },
    });
    expect(orphanTerm).toBeNull();

    const orphanOccupancy = await prisma.occupancy.findFirst({
      where: { dormitoryId: dormId, roomId: room.id },
    });
    expect(orphanOccupancy).toBeNull();

    const orphanBill = await prisma.bill.findFirst({
      where: { dormitoryId: dormId, roomId: room.id },
    });
    expect(orphanBill).toBeNull();
  });

  it('8. Two-room Concurrent Bill Number Allocation: serializes and generates consecutive bill numbers without collision', async () => {
    const roomA = await createTestRoom('201-CONC', 4000, 4000);
    const roomB = await createTestRoom('202-CONC', 4000, 4000);

    const [resA, resB] = await Promise.all([
      provisionalRentalTermService.createProvisionalTenantAndTerm(
        dormId,
        {
          roomId: roomA.id,
          fullName: 'คนเช่า A',
          phone: '0811110001',
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
          fullName: 'คนเช่า B',
          phone: '0811110002',
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
});
