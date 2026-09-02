/**
 * @license Apache-2.0
 * HORPLUS ROUND 2.4A FINANCIAL AUTHORITY & CANONICAL RECOVERY TESTS
 *
 * Tests:
 * A. Historical PAID rent unknown date (Payment.paymentDate === null, Receipt snapshot has paymentDate === null)
 * B. Historical PAID deposit unknown date (createDepositBillForAgreementInTx pre-go-live)
 * C. Historical Report Exclusion (0 revenue/billed inflation in go-live cycle, preserves unpaid in AR)
 * D. Combined Cash Payment for same tenant + same room (produces 1 combined receipt)
 * E. Combined Cash Payment cross-room rejection (FORBIDDEN_CROSS_ROOM)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { getPrismaClient } from '../../db/prisma.js';
import {
  recordCashPaymentInTx,
  recordCombinedCashPaymentInTx,
  generateReceiptInTx,
} from '../../utils/payment-transaction.util.js';
import { createDepositBillForAgreementInTx } from '../../utils/deposit-billing.util.js';
import { calculateOwnerReports, isHistoricalPaidBill } from '../../utils/report-calculations.js';

describe('HORPLUS Round 2.4A Financial Authority & Historical Isolation', () => {
  const prisma = getPrismaClient();

  let dormitoryId: string;
  let buildingId: string;
  let room1Id: string;
  let room2Id: string;
  let tenantId: string;
  let billingCycleId: string;
  let cycleCode: string;

  beforeAll(async () => {
    // 1. Create Test Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพักทดสอบ Round 2.4A Financial Authority',
        addressLine1: '123 ถนนพญาไท ราชเทวี กรุงเทพฯ',
        phone: '0812345678',
      },
    });
    dormitoryId = dorm.id;

    // 2. Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId,
        name: 'อาคาร A',
        code: 'A',
        floorCount: 3,
      },
    });
    buildingId = building.id;

    // 3. Create Rooms
    const r1 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        floor: 1,
        roomType: 'standard',
        monthlyRent: '4500.00',
        termDeposit: '4500.00',
        monthlyDeposit: '4500.00',
        dailyDeposit: '500.00',
        waterMeterNumber: 'W-101',
        electricityMeterNumber: 'E-101',
      },
    });
    room1Id = r1.id;

    const r2 = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: '102',
        normalizedRoomNumber: '102',
        floor: 1,
        roomType: 'standard',
        monthlyRent: '4500.00',
        termDeposit: '4500.00',
        monthlyDeposit: '4500.00',
        dailyDeposit: '500.00',
        waterMeterNumber: 'W-102',
        electricityMeterNumber: 'E-102',
      },
    });
    room2Id = r2.id;

    // 4. Create Tenant
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: 'TN-R24A-01',
        displayName: 'สมชาย รักสงบ',
        firstName: 'สมชาย',
        lastName: 'รักสงบ',
        phone: '0819998888',
      },
    });
    tenantId = tenant.id;

    // 5. Create September 2026 Billing Cycle (Go-Live)
    cycleCode = '2026-09';
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode,
        name: 'รอบบิลกันยายน 2569',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-01'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });
    billingCycleId = cycle.id;
  });

  afterAll(async () => {
    if (dormitoryId) {
      await prisma.receipt.deleteMany({ where: { dormitoryId } });
      await prisma.receiptSequence.deleteMany({ where: { dormitoryId } });
      await prisma.paymentStatusHistory.deleteMany({ where: { payment: { dormitoryId } } });
      await prisma.paymentAllocation.deleteMany({ where: { paymentGroup: { dormitoryId } } });
      await prisma.payment.deleteMany({ where: { dormitoryId } });
      await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { paymentGroup: { dormitoryId } } });
      await prisma.combinedPaymentGroup.deleteMany({ where: { dormitoryId } });
      await prisma.billItem.deleteMany({ where: { dormitoryId } });
      await prisma.bill.deleteMany({ where: { dormitoryId } });
      await prisma.contract.deleteMany({ where: { dormitoryId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId } });
      await prisma.dormitory.delete({ where: { id: dormitoryId } });
    }
  });

  it('A. records Historical PAID rent with unknown date without fabricated today date', async () => {
    await prisma.$transaction(async (tx) => {
      // Create historical rent bill attached to September cycle
      const bill = await tx.bill.create({
        data: {
          dormitoryId,
          billingCycleId,
          roomId: room1Id,
          tenantId,
          billKind: 'RENT',
          billNumber: 'INV-202609-101-HIST',
          status: 'unpaid',
          billingDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-05'),
          totalAmount: new Prisma.Decimal('4500.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          outstandingAmount: new Prisma.Decimal('4500.00'),
          items: {
            create: [
              {
                dormitoryId,
                type: 'rent',
                description: 'ค่าเช่าห้องพัก (พ.ค. 69 - ก่อนใช้ HorPlus)',
                amount: new Prisma.Decimal('4500.00'),
                metadata: {
                  isHistoricalImport: true,
                  originalPeriodLabel: 'พ.ค. 69',
                  originalPaymentDateKnown: false,
                },
              },
            ],
          },
        },
      });

      // Record cash payment with paymentDate: null
      const payResult = await recordCashPaymentInTx(tx, {
        dormitoryId,
        billId: bill.id,
        amount: '4500.00',
        paymentDate: null,
        metadata: {
          isHistoricalImport: true,
          originalPaymentDateKnown: false,
          originalPeriodLabel: 'พ.ค. 69',
        },
      });

      expect(payResult.status).toBe('APPROVED');
      expect(payResult.paymentDate).toBeNull();
      expect(payResult.group.paymentDate).toBeInstanceOf(Date); // System event timestamp

      // Check Receipt snapshot
      const rcpt = await tx.receipt.findFirst({
        where: { billId: bill.id },
      });
      expect(rcpt).toBeDefined();
      const snap: any = rcpt?.snapshotData;
      expect(snap.isHistoricalImport).toBe(true);
      expect(snap.originalPaymentDateKnown).toBe(false);
      expect(snap.paymentDate).toBeNull(); // NOT fabricated today
    });
  });

  it('B. creates Historical PAID deposit with null paymentDate without DB constraint failure', async () => {
    await prisma.$transaction(async (tx) => {
      const contract = await tx.contract.create({
        data: {
          dormitoryId,
          roomId: room1Id,
          tenantId,
          contractNumber: 'CTR-R24A-01',
          startDate: new Date('2026-06-01'),
          endDate: new Date('2027-05-31'),
          rentAmount: new Prisma.Decimal('4500.00'),
          depositAmount: new Prisma.Decimal('4500.00'),
          status: 'active',
        },
      });

      const depositBill = await createDepositBillForAgreementInTx(tx, {
        dormitoryId,
        roomId: room1Id,
        tenantId,
        contractId: contract.id,
        startDate: new Date('2026-06-01'), // Pre-GoLive June
        depositAmount: 4500,
        depositDeclaredStatus: 'PAID',
      });

      expect(depositBill).toBeDefined();
      expect(depositBill.status).toBe('PAID');

      // Check payment record
      const payment = await tx.payment.findFirst({
        where: { billId: depositBill.id },
      });
      expect(payment).toBeDefined();
      expect(payment?.status).toBe('APPROVED');
      expect(payment?.paymentDate).toBeNull(); // Nullable paymentDate authority

      // Check receipt record
      const rcpt = await tx.receipt.findFirst({
        where: { billId: depositBill.id },
      });
      expect(rcpt).toBeDefined();
      const snap: any = rcpt?.snapshotData;
      expect(snap.isHistoricalImport).toBe(true);
      expect(snap.originalPaymentDateKnown).toBe(false);
      expect(snap.paymentDate).toBeNull();
    });
  });

  it('C. excludes Historical PAID bills from Go-Live revenue while preserving Historical UNPAID in AR', () => {
    const mockBills = [
      // 1. May historical RENT 4500 PAID
      {
        id: 'bill-may-paid',
        billingCycleId,
        cycleCode: '2026-09',
        roomId: room1Id,
        tenantId,
        status: 'PAID',
        totalAmount: 4500,
        paidAmount: 4500,
        outstandingAmount: 0,
        items: [
          {
            type: 'rent',
            description: 'ค่าเช่า พ.ค. 69',
            amount: 4500,
            metadata: { isHistoricalImport: true, originalPeriodLabel: 'พ.ค. 69' },
          },
        ],
        Payment: [
          {
            status: 'APPROVED',
            amount: 4500,
            paymentDate: null,
            metadata: { isHistoricalImport: true, originalPaymentDateKnown: false },
          },
        ],
      },
      // 2. June historical DEPOSIT 4500 PAID
      {
        id: 'bill-june-deposit-paid',
        billingCycleId,
        cycleCode: '2026-09',
        roomId: room1Id,
        tenantId,
        status: 'PAID',
        totalAmount: 4500,
        paidAmount: 4500,
        outstandingAmount: 0,
        billKind: 'DEPOSIT',
        items: [
          {
            type: 'deposit',
            description: 'เงินประกัน',
            amount: 4500,
            metadata: { isHistoricalImport: true, originalPeriodLabel: 'เงินประกัน' },
          },
        ],
        Payment: [
          {
            status: 'APPROVED',
            amount: 4500,
            paymentDate: null,
            metadata: { isHistoricalImport: true, originalPaymentDateKnown: false },
          },
        ],
      },
      // 3. July historical RENT 4500 UNPAID (Imported outstanding)
      {
        id: 'bill-july-unpaid',
        billingCycleId,
        cycleCode: '2026-09',
        roomId: room1Id,
        tenantId,
        status: 'UNPAID',
        totalAmount: 4500,
        paidAmount: 0,
        outstandingAmount: 4500,
        items: [
          {
            type: 'rent',
            description: 'ค่าเช่า ก.ค. 69',
            amount: 4500,
            metadata: { isHistoricalImport: true, originalPeriodLabel: 'ก.ค. 69' },
          },
        ],
      },
      // 4. Real September current cycle bill: RENT 4500 PAID
      {
        id: 'bill-sept-real-paid',
        billingCycleId,
        cycleCode: '2026-09',
        roomId: room2Id,
        status: 'PAID',
        totalAmount: 4500,
        paidAmount: 4500,
        outstandingAmount: 0,
        items: [
          {
            type: 'rent',
            description: 'ค่าเช่า ก.ย. 69',
            amount: 4500,
          },
        ],
      },
    ];

    expect(isHistoricalPaidBill(mockBills[0])).toBe(true);
    expect(isHistoricalPaidBill(mockBills[1])).toBe(true);
    expect(isHistoricalPaidBill(mockBills[2])).toBe(false); // Unpaid is NOT historical paid
    expect(isHistoricalPaidBill(mockBills[3])).toBe(false); // Live is NOT historical

    const result = calculateOwnerReports({
      bills: mockBills as any,
      rooms: [{ id: room1Id, status: 'occupied' }, { id: room2Id, status: 'occupied' }] as any,
      contracts: [] as any,
      selectedCycleCode: '2026-09',
      selectedYear: '2026',
    });

    // Expected September Go-Live revenue:
    // Only real September bill (4500) + July unpaid (4500) in billed total = 9000
    // Real September paid = 4500 revenue
    // July unpaid = 4500 unpaid AR
    // May paid (4500) & June deposit (4500) completely excluded from September revenue
    expect(result.totalBilledThisMonth).toBe(9000);
    expect(result.totalRevenueThisMonth).toBe(4500);
    expect(result.totalUnpaidThisMonth).toBe(4500);
  });

  it('D. executes Combined Cash Payment for same tenant in same room producing 1 combined receipt', async () => {
    await prisma.$transaction(async (tx) => {
      const b1 = await tx.bill.create({
        data: {
          dormitoryId,
          billingCycleId,
          roomId: room1Id,
          tenantId,
          billKind: 'RENT',
          billNumber: 'INV-COMB-01',
          status: 'unpaid',
          billingDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-05'),
          totalAmount: new Prisma.Decimal('3000.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          outstandingAmount: new Prisma.Decimal('3000.00'),
        },
      });

      const b2 = await tx.bill.create({
        data: {
          dormitoryId,
          billingCycleId,
          roomId: room1Id,
          tenantId,
          billKind: 'MONTHLY_UTILITY',
          billNumber: 'INV-COMB-02',
          status: 'unpaid',
          billingDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-05'),
          totalAmount: new Prisma.Decimal('1500.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          outstandingAmount: new Prisma.Decimal('1500.00'),
        },
      });

      const res = await recordCombinedCashPaymentInTx(tx, {
        dormitoryId,
        billIds: [b1.id, b2.id],
        amount: '4500.00',
      });

      expect(res.group).toBeDefined();
      expect(res.receipt).toBeDefined();
      expect(res.receipt.receiptNumber).toMatch(/^RC-/);
      expect(res.payments.length).toBe(2);

      const snap: any = res.receipt.snapshotData;
      expect(snap.isCombinedReceipt).toBe(true);
      expect(snap.billGroups.length).toBe(2);
      expect(snap.total).toBe('4500.00');
    });
  });

  it('E. rejects Combined Cash Payment cross-room with FORBIDDEN_CROSS_ROOM', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        const b1 = await tx.bill.create({
          data: {
            dormitoryId,
            billingCycleId,
            roomId: room1Id,
            tenantId,
            billKind: 'RENT',
            billNumber: 'INV-CROSS-01',
            status: 'unpaid',
            billingDate: new Date('2026-09-01'),
            dueDate: new Date('2026-09-05'),
            totalAmount: new Prisma.Decimal('2000.00'),
            paidAmount: new Prisma.Decimal('0.00'),
            outstandingAmount: new Prisma.Decimal('2000.00'),
          },
        });

        const b2 = await tx.bill.create({
          data: {
            dormitoryId,
            billingCycleId,
            roomId: room2Id, // Different room!
            tenantId,
            billKind: 'RENT',
            billNumber: 'INV-CROSS-02',
            status: 'unpaid',
            billingDate: new Date('2026-09-01'),
            dueDate: new Date('2026-09-05'),
            totalAmount: new Prisma.Decimal('2000.00'),
            paidAmount: new Prisma.Decimal('0.00'),
            outstandingAmount: new Prisma.Decimal('2000.00'),
          },
        });

        await recordCombinedCashPaymentInTx(tx, {
          dormitoryId,
          billIds: [b1.id, b2.id],
          amount: '4000.00',
        });
      })
    ).rejects.toThrow('ไม่อนุญาตให้รวมบิลข้ามห้องพัก');
  });

  it('F. Historical UNPAID rent obligation settled LIVE post-GoLive is included in September revenue with concrete date', async () => {
    // 1. Create October 2026 Billing Cycle to verify isolation
    const octCycle = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: '2026-10',
        name: 'รอบบิลตุลาคม 2569',
        periodStart: new Date('2026-10-01'),
        periodEnd: new Date('2026-10-31'),
        billingDate: new Date('2026-10-01'),
        dueDate: new Date('2026-10-05'),
        status: 'published',
      },
    });

    let liveBillId = '';
    await prisma.$transaction(async (tx) => {
      // Create historical July RENT obligation imported into September as UNPAID
      const bill = await tx.bill.create({
        data: {
          dormitoryId,
          billingCycleId,
          roomId: room1Id,
          tenantId,
          billKind: 'RENT',
          billNumber: 'INV-202609-101-JULY-DEBT',
          status: 'unpaid',
          billingDate: new Date('2026-09-01'),
          dueDate: new Date('2026-09-05'),
          totalAmount: new Prisma.Decimal('4500.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          outstandingAmount: new Prisma.Decimal('4500.00'),
          items: {
            create: [
              {
                dormitoryId,
                type: 'rent',
                description: 'ค่าเช่า ก.ค. 69 (หนี้ค้างก่อนใช้ HorPlus)',
                amount: new Prisma.Decimal('4500.00'),
                metadata: {
                  isHistoricalImport: true,
                  originalPeriod: '2026-07',
                  originalPeriodLabel: 'ก.ค. 69',
                },
              },
            ],
          },
        },
      });
      liveBillId = bill.id;
    });

    // Verify initial state: unpaid obligation in September
    const initialBill = await prisma.bill.findUnique({
      where: { id: liveBillId },
      include: { items: true, Payment: true, billingCycle: true },
    });
    expect(isHistoricalPaidBill(initialBill)).toBe(false);

    const initialSeptReport = calculateOwnerReports({
      bills: [initialBill] as any,
      rooms: [{ id: room1Id, status: 'occupied' }] as any,
      selectedCycleCode: '2026-09',
      selectedYear: '2026',
    });
    expect(initialSeptReport.totalBilledThisMonth).toBe(4500);
    expect(initialSeptReport.totalRevenueThisMonth).toBe(0);
    expect(initialSeptReport.totalUnpaidThisMonth).toBe(4500);

    // 2. Tenant pays LIVE on October 10 via normal cash payment
    const livePaymentDate = new Date('2026-10-10T14:30:00.000Z');
    await prisma.$transaction(async (tx) => {
      await recordCashPaymentInTx(tx, {
        dormitoryId,
        billId: liveBillId,
        amount: '4500.00',
        paymentDate: livePaymentDate,
        metadata: {
          isHistoricalImport: false, // LIVE HorPlus payment
        },
      });
    });

    // 3. Query settled bill with Payment
    const settledBill = await prisma.bill.findUnique({
      where: { id: liveBillId },
      include: { items: true, Payment: true, billingCycle: true },
    });

    expect(settledBill?.status).toBe('PAID');
    expect(settledBill?.outstandingAmount.toString()).toBe('0');
    expect(settledBill?.paidAmount.toString()).toBe('4500');

    // Authority check: Historical debt + Live payment must NOT be classified as historical pre-HorPlus paid!
    expect(isHistoricalPaidBill(settledBill)).toBe(false);

    // 4. Receipt check: contains concrete live payment date
    const rcpt = await prisma.receipt.findFirst({
      where: { billId: liveBillId },
    });
    expect(rcpt).toBeDefined();
    const snap: any = rcpt?.snapshotData;
    expect(snap.isHistoricalImport).toBe(false);
    expect(snap.originalPaymentDateKnown).toBe(true);
    expect(snap.paymentDate).toBe('2026-10-10T14:30:00.000Z');

    // 5. September Report check (Q7=A BillingCycle policy):
    // September revenue includes the settled 4500, unpaid drops to 0
    const settledSeptReport = calculateOwnerReports({
      bills: [settledBill] as any,
      rooms: [{ id: room1Id, status: 'occupied' }] as any,
      selectedCycleCode: '2026-09',
      selectedYear: '2026',
    });
    expect(settledSeptReport.totalBilledThisMonth).toBe(4500);
    expect(settledSeptReport.totalRevenueThisMonth).toBe(4500);
    expect(settledSeptReport.totalUnpaidThisMonth).toBe(0);

    // 6. October Report check:
    // October report does NOT adopt or reclassify this September bill
    const octReport = calculateOwnerReports({
      bills: [settledBill] as any,
      rooms: [{ id: room1Id, status: 'occupied' }] as any,
      selectedCycleCode: '2026-10',
      selectedYear: '2026',
    });
    expect(octReport.totalBilledThisMonth).toBe(0);
    expect(octReport.totalRevenueThisMonth).toBe(0);
    expect(octReport.totalUnpaidThisMonth).toBe(0);
  });

  it('G. Deposit Parity: Old Deposit declared PAID before HorPlus is excluded, whereas UNPAID then live-paid is included', () => {
    // A. Old Deposit declared PAID before HorPlus
    const preGoLivePaidDepositBill = {
      id: 'dep-pre-paid',
      billingCycleId,
      cycleCode: '2026-09',
      roomId: room1Id,
      tenantId,
      status: 'PAID',
      billKind: 'DEPOSIT',
      totalAmount: 4500,
      paidAmount: 4500,
      outstandingAmount: 0,
      items: [
        {
          type: 'deposit',
          description: 'เงินประกัน (ชำระแล้วก่อนใช้ HorPlus)',
          amount: 4500,
          metadata: { isHistoricalImport: true, originalPeriodLabel: 'เงินประกัน' },
        },
      ],
      Payment: [
        {
          status: 'APPROVED',
          amount: 4500,
          paymentDate: null,
          metadata: { isHistoricalImport: true, originalPaymentDateKnown: false },
        },
      ],
    };

    // B. Old Deposit imported UNPAID and paid LIVE later
    const historicalUnpaidThenLivePaidDepositBill = {
      id: 'dep-live-paid',
      billingCycleId,
      cycleCode: '2026-09',
      roomId: room2Id,
      tenantId,
      status: 'PAID',
      billKind: 'DEPOSIT',
      totalAmount: 4500,
      paidAmount: 4500,
      outstandingAmount: 0,
      items: [
        {
          type: 'deposit',
          description: 'เงินประกัน (นำเข้าค้างชำระ)',
          amount: 4500,
          metadata: { isHistoricalImport: true, originalPeriodLabel: 'เงินประกัน' },
        },
      ],
      Payment: [
        {
          status: 'APPROVED',
          amount: 4500,
          paymentDate: '2026-10-10T10:00:00.000Z',
          metadata: { isHistoricalImport: false },
        },
      ],
    };

    expect(isHistoricalPaidBill(preGoLivePaidDepositBill)).toBe(true);
    expect(isHistoricalPaidBill(historicalUnpaidThenLivePaidDepositBill)).toBe(false);

    const report = calculateOwnerReports({
      bills: [preGoLivePaidDepositBill, historicalUnpaidThenLivePaidDepositBill] as any,
      rooms: [{ id: room1Id, status: 'occupied' }, { id: room2Id, status: 'occupied' }] as any,
      selectedCycleCode: '2026-09',
      selectedYear: '2026',
    });

    // Only historicalUnpaidThenLivePaidDepositBill counts toward billed & revenue
    expect(report.totalBilledThisMonth).toBe(4500);
    expect(report.totalRevenueThisMonth).toBe(4500);
    expect(report.totalUnpaidThisMonth).toBe(0);
  });
});
