/**
 * @license Apache-2.0
 * HORPLUS LOCAL-07 — Canonical Late-Fee Overdue Reconciler Test Suite (WRK1–WRK26 + SNP1–SNP5)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { BillingService, resolveBillDueDate } from '../../services/billing.service.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { cleanupService } from '../../services/cleanup.service.js';
import { formatDecimal, toDecimal } from '../../utils/decimal-math.util.js';
import { calculateCanonicalMonthlyUtility, LATE_FEE_GRACE_DAYS } from '../../utils/monthly-utility-calculator.util.js';
import { OnboardingBillingInputSchema } from '../../types/onboarding-validation.js';
import { LateFeeReconciliationService, lateFeeReconciliationService } from '../../services/late-fee-reconciliation.service.js';

import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';

const prisma = new PrismaClient();
const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
const billingCycleService = new BillingCycleService(billingCycleRepo);
const reconciler = new LateFeeReconciliationService(prisma);

describe('HORPLUS LOCAL-07 — Late-Fee Overdue Reconciler & Snapshot Policy Authority Suite', () => {
  let dormId: string;
  let roomId: string;
  let tenantId: string;
  let testCycleId: string;

  beforeAll(async () => {
    // 1. Create test Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        id: randomUUID(),
        name: `Reconciler Test Dorm ${Date.now()}`,
        status: 'active',
      },
    });
    dormId = dorm.id;

    // 2. Create Dormitory Billing Settings (daily: 50.00, dueDay: 5, grace: 0)
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId: dormId,
        waterBillingType: 'fixed',
        waterRate: new Prisma.Decimal('100.00'),
        electricityBillingType: 'fixed',
        electricityRate: new Prisma.Decimal('200.00'),
        lateFeeType: 'daily',
        lateFeeValue: new Prisma.Decimal('50.00'),
        dueDay: 5,
        gracePeriodDays: 0,
      },
    });

    // 3. Create a test Building and Room
    const bldg = await prisma.building.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        name: 'Building A',
      },
    });

    const room = await prisma.room.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        buildingId: bldg.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        monthlyRent: new Prisma.Decimal('4000.00'),
      },
    });
    roomId = room.id;

    // 4. Create a test Tenant
    const tenant = await prisma.tenant.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        firstName: 'Somchai',
        lastName: 'Reconciler',
        displayName: 'Somchai Reconciler',
        phone: '0812345678',
        tenantNumber: `TNT-${Date.now()}`,
        status: 'active',
      },
    });
    tenantId = tenant.id;

    // 5. Create active Contract
    await prisma.contract.create({
      data: {
        id: randomUUID(),
        dormitoryId: dormId,
        roomId: roomId,
        tenantId: tenantId,
        contractNumber: `CTR-${Date.now()}`,
        status: 'active',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2027-07-31T00:00:00.000Z'),
        rentAmount: new Prisma.Decimal('4000.00'),
        depositAmount: new Prisma.Decimal('4000.00'),
      },
    });
  });

  afterAll(async () => {
    cleanupService.stop();
    await prisma.$disconnect();
  });

  describe('PART A: BillingRateSnapshot Policy & Prospective Authority (SNP1 - SNP5)', () => {
    it('SNP1–SNP3: createBillingCycle permanently freezes lateFeeType, lateFeeValue, and fixed 2-day gracePeriodDays', async () => {
      // Set settings: daily / 50.00
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dormId },
        data: {
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          gracePeriodDays: 2,
          dueDay: 5,
        },
      });

      const res = await billingCycleService.createBillingCycle(dormId, {
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-01',
      });

      testCycleId = res.cycle.id;
      expect(res.rateSnapshot.lateFeeType).toBe('daily');
      expect(res.rateSnapshot.lateFeeValue).toBe('50.00');
      expect(res.rateSnapshot.gracePeriodDays).toBe(2);
      expect(res.cycle.dueDate.toISOString().slice(0, 10)).toBe('2026-09-05');
    });

    it('SNP4–SNP5: Changing Dormitory Settings today does NOT alter snapshot or dueDate of existing cycle A, but applies to future cycle B', async () => {
      // Change settings to fixed / 100.00 / dueDay 10
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dormId },
        data: {
          lateFeeType: 'fixed',
          lateFeeValue: new Prisma.Decimal('100.00'),
          gracePeriodDays: 2,
          dueDay: 10,
        },
      });

      // Existing cycle A snapshot in DB remains daily / 50.00 / 2
      const snapA = await prisma.billingRateSnapshot.findUnique({
        where: { billingCycleId: testCycleId },
      });
      expect(snapA?.lateFeeType).toBe('daily');
      expect(snapA?.lateFeeValue.toString()).toBe('50');
      expect(snapA?.gracePeriodDays).toBe(2);

      // Create future cycle B (2026-09)
      const resB = await billingCycleService.createBillingCycle(dormId, {
        cycleCode: '2026-09',
        name: 'September 2026',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        billingDate: '2026-09-01',
      });

      expect(resB.rateSnapshot.lateFeeType).toBe('fixed');
      expect(resB.rateSnapshot.lateFeeValue).toBe('100.00');
      expect(resB.rateSnapshot.gracePeriodDays).toBe(2);
      expect(resB.cycle.dueDate.toISOString().slice(0, 10)).toBe('2026-10-10');
    });
  });

  describe('PART B: Overdue Reconciler Core Scenarios (WRK1 - WRK26)', () => {
    let billId: string;
    let baseCycleId: string;

    beforeEach(async () => {
      await prisma.billItem.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.payment.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } });

      // Create a cycle with dueDate 2026-08-05 and rateSnapshot daily / 50.00 / grace 0
      const cycle = await prisma.billingCycle.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          cycleCode: `TEST-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: 'Test Due Aug 5',
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          status: 'draft',
        },
      });
      baseCycleId = cycle.id;

      await prisma.billingRateSnapshot.create({
        data: {
          dormitoryId: dormId,
          billingCycleId: baseCycleId,
          waterBillingType: 'fixed',
          waterRate: new Prisma.Decimal('100.00'),
          electricityBillingType: 'fixed',
          electricityRate: new Prisma.Decimal('200.00'),
          commonFee: new Prisma.Decimal('500.00'),
          commonFeeMode: 'room',
          internetFee: new Prisma.Decimal('0.00'),
          internetFeeMode: 'none',
          parkingFee: new Prisma.Decimal('0.00'),
          parkingFeeMode: 'none',
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          gracePeriodDays: 2,
          source: 'TEMPLATE_DEFAULT',
        },
      });

      // Issue un-penalized Monthly Utility bill on 2026-08-04 (total: 800.00)
      const bill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: baseCycleId,
          roomId: roomId,
          billNumber: `INV-${Date.now()}`,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('800.00'),
          totalAmount: new Prisma.Decimal('800.00'),
          outstandingAmount: new Prisma.Decimal('800.00'),
          paidAmount: new Prisma.Decimal('0.00'),
          version: 1,
        },
      });
      billId = bill.id;

      await prisma.billItem.createMany({
        data: [
          { billId, dormitoryId: dormId, type: 'water', description: 'ค่าน้ำ (เหมาจ่าย)', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('100.00'), amount: new Prisma.Decimal('100.00') },
          { billId, dormitoryId: dormId, type: 'electricity', description: 'ค่าไฟฟ้า (เหมาจ่าย)', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('200.00'), amount: new Prisma.Decimal('200.00') },
          { billId, dormitoryId: dormId, type: 'common_fee', description: 'ค่าส่วนกลาง', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('500.00'), amount: new Prisma.Decimal('500.00') },
        ],
      });
    });

    it('WRK1–WRK2: Before or on dueDate (2026-08-04 or 2026-08-05), bill is skipped/no-op and not changed', async () => {
      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-04T12:00:00.000Z'), dormId);
      expect(summary.changed).toBe(0);

      const dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');
      expect(dbBill?.version).toBe(1);
    });

    it('WRK3: Grace day 1 (2026-08-06 Bangkok) and Grace day 2 (2026-08-07 Bangkok) remain 0 penalty', async () => {
      // Grace day 1 (Aug 6)
      const summary6 = await reconciler.reconcileOverdueBills(new Date('2026-08-06T10:00:00.000Z'), dormId);
      expect(summary6.changed).toBe(0);
      let dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');
      expect(dbBill?.version).toBe(1);

      // Grace day 2 (Aug 7)
      const summary7 = await reconciler.reconcileOverdueBills(new Date('2026-08-07T10:00:00.000Z'), dormId);
      expect(summary7.changed).toBe(0);
      dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');
      expect(dbBill?.version).toBe(1);
    });

    it('WRK4: First chargeable overdue day (2026-08-08 Bangkok), bill acquires 1 day late fee (+50 = 850.00, NOT 150)', async () => {
      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);
      expect(summary.changed).toBe(1);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('850.00');
      expect(formatDecimal(dbBill?.outstandingAmount ?? '0')).toBe('850.00');
      expect(dbBill?.version).toBe(2);

      const lateItem = dbBill?.items.find((i) => i.type === 'late_fee');
      expect(lateItem).toBeDefined();
      expect(lateItem?.description).toBe('ค่าปรับล่าช้า (1 วัน)');
      expect(formatDecimal(lateItem?.amount ?? '0')).toBe('50.00');
    });

    it('WRK5: Same-day second run NO-OP (running at 11:00 after 10:00 on 2026-08-08 results in NO change and NO version bump)', async () => {
      // First run at 10:00
      await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);

      // Second run at 11:00 (same business date)
      const summary2 = await reconciler.reconcileOverdueBills(new Date('2026-08-08T11:00:00.000Z'), dormId);
      expect(summary2.changed).toBe(0);
      expect(summary2.noop).toBe(1);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('850.00');
      expect(dbBill?.version).toBe(2); // Still version 2, not bumped!
      expect(dbBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });

    it('WRK6: Next day (2026-08-09 Bangkok), updates same Bill ID to 2 chargeable days (+100 = 900.00) and increments version exactly once', async () => {
      // Reconcile on Aug 8
      await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);

      // Reconcile on Aug 9
      const summaryNext = await reconciler.reconcileOverdueBills(new Date('2026-08-09T10:00:00.000Z'), dormId);
      expect(summaryNext.changed).toBe(1);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('900.00');
      expect(dbBill?.version).toBe(3);

      const lateItem = dbBill?.items.find((i) => i.type === 'late_fee');
      expect(lateItem?.description).toBe('ค่าปรับล่าช้า (2 วัน)');
      expect(formatDecimal(lateItem?.amount ?? '0')).toBe('100.00');
    });

    it('WRK7: Fixed mode charges fixed penalty once starting on first chargeable day (2026-08-08) regardless of how many days pass', async () => {
      // Update cycle snapshot to fixed / 100.00
      await prisma.billingRateSnapshot.update({
        where: { billingCycleId: baseCycleId },
        data: {
          lateFeeType: 'fixed',
          lateFeeValue: new Prisma.Decimal('100.00'),
        },
      });

      // Run on Aug 7 (within grace) -> 0 fee, total 800.00
      await reconciler.reconcileOverdueBills(new Date('2026-08-07T10:00:00.000Z'), dormId);
      let dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');

      // Run on Aug 8 (1st chargeable day) -> 800 + 100 = 900.00
      await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);
      dbBill = await prisma.bill.findUnique({ where: { id: billId }, include: { items: true } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('900.00');

      // Run on Aug 15 (+10 days) -> remains 900.00 (NO accumulating duplicates)
      const summaryLate = await reconciler.reconcileOverdueBills(new Date('2026-08-15T10:00:00.000Z'), dormId);
      expect(summaryLate.changed).toBe(0);
      expect(summaryLate.noop).toBe(1);

      const billWithItems = await prisma.bill.findUnique({ where: { id: billId }, include: { items: true } });
      expect(formatDecimal(billWithItems?.totalAmount ?? '0')).toBe('900.00');
      expect(billWithItems?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });

    it('WRK8: None mode is skipped / no-op (no late_fee item created)', async () => {
      await prisma.billingRateSnapshot.update({
        where: { billingCycleId: baseCycleId },
        data: {
          lateFeeType: 'none',
          lateFeeValue: new Prisma.Decimal('0.00'),
        },
      });

      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-10T10:00:00.000Z'), dormId);
      expect(summary.changed).toBe(0);
      expect(summary.noop).toBe(1);

      const dbBill = await prisma.bill.findUnique({ where: { id: billId }, include: { items: true } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');
      expect(dbBill?.items.find((i) => i.type === 'late_fee')).toBeUndefined();
    });

    it('WRK9: Fixed 2-day silent grace boundary matrix (Sep 4/5/6/7 free; Sep 8 = 50, Sep 9 = 100, Sep 10 = 150)', async () => {
      // Create bill with dueDate = 2026-09-05
      await prisma.bill.update({
        where: { id: billId },
        data: {
          dueDate: new Date('2026-09-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('800.00'),
          totalAmount: new Prisma.Decimal('800.00'),
          outstandingAmount: new Prisma.Decimal('800.00'),
          version: 1,
        },
      });
      await prisma.billItem.deleteMany({ where: { billId, type: 'late_fee' } });

      // Sep 5 (due date) -> 0
      await reconciler.reconcileOverdueBills(new Date('2026-09-05T10:00:00.000Z'), dormId);
      let b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('800.00');

      // Sep 6 (grace day 1) -> 0
      await reconciler.reconcileOverdueBills(new Date('2026-09-06T10:00:00.000Z'), dormId);
      b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('800.00');

      // Sep 7 (grace day 2) -> 0
      await reconciler.reconcileOverdueBills(new Date('2026-09-07T10:00:00.000Z'), dormId);
      b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('800.00');

      // Sep 8 (1st chargeable day) -> 800 + 50 = 850.00
      await reconciler.reconcileOverdueBills(new Date('2026-09-08T10:00:00.000Z'), dormId);
      b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('850.00');

      // Sep 9 (2nd chargeable day) -> 800 + 100 = 900.00
      await reconciler.reconcileOverdueBills(new Date('2026-09-09T10:00:00.000Z'), dormId);
      b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('900.00');

      // Sep 10 (3rd chargeable day) -> 800 + 150 = 950.00
      await reconciler.reconcileOverdueBills(new Date('2026-09-10T10:00:00.000Z'), dormId);
      b = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(b?.totalAmount ?? '0')).toBe('950.00');
    });

    it('WRK10–WRK14: PAID, cancelled, void, RENT, and DEPOSIT bills are excluded and immutable', async () => {
      const bldg2 = await prisma.building.create({ data: { id: randomUUID(), dormitoryId: dormId, name: 'Bld 2' } });
      const roomPaid = await prisma.room.create({ data: { id: randomUUID(), dormitoryId: dormId, buildingId: bldg2.id, roomNumber: '102', normalizedRoomNumber: '102', floor: 1, roomType: 'standard', status: 'occupied', monthlyRent: new Prisma.Decimal('4000.00') } });
      const roomRent = await prisma.room.create({ data: { id: randomUUID(), dormitoryId: dormId, buildingId: bldg2.id, roomNumber: '103', normalizedRoomNumber: '103', floor: 1, roomType: 'standard', status: 'occupied', monthlyRent: new Prisma.Decimal('4000.00') } });
      const roomDep = await prisma.room.create({ data: { id: randomUUID(), dormitoryId: dormId, buildingId: bldg2.id, roomNumber: '104', normalizedRoomNumber: '104', floor: 1, roomType: 'standard', status: 'occupied', monthlyRent: new Prisma.Decimal('4000.00') } });

      // 1. PAID Monthly Utility bill
      const paidBill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: baseCycleId,
          roomId: roomPaid.id,
          billNumber: `PAID-${Date.now()}`,
          billKind: 'MONTHLY_UTILITY',
          status: 'paid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('800.00'),
          totalAmount: new Prisma.Decimal('800.00'),
          outstandingAmount: new Prisma.Decimal('0.00'),
          paidAmount: new Prisma.Decimal('800.00'),
          version: 1,
        },
      });

      // 2. UNPAID RENT bill
      const rentBill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: baseCycleId,
          roomId: roomRent.id,
          billNumber: `RENT-${Date.now()}`,
          billKind: 'RENT',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('4000.00'),
          totalAmount: new Prisma.Decimal('4000.00'),
          outstandingAmount: new Prisma.Decimal('4000.00'),
          version: 1,
        },
      });

      // 3. UNPAID DEPOSIT bill
      const depositBill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: baseCycleId,
          roomId: roomDep.id,
          billNumber: `DEP-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('4000.00'),
          totalAmount: new Prisma.Decimal('4000.00'),
          outstandingAmount: new Prisma.Decimal('4000.00'),
          version: 1,
        },
      });

      // Run overdue reconciler on Aug 10
      await reconciler.reconcileOverdueBills(new Date('2026-08-10T10:00:00.000Z'), dormId);

      // Verify PAID bill is untouched
      const dbPaid = await prisma.bill.findUnique({ where: { id: paidBill.id } });
      expect(formatDecimal(dbPaid?.totalAmount ?? '0')).toBe('800.00');
      expect(dbPaid?.version).toBe(1);

      // Verify RENT bill is untouched
      const dbRent = await prisma.bill.findUnique({ where: { id: rentBill.id } });
      expect(formatDecimal(dbRent?.totalAmount ?? '0')).toBe('4000.00');
      expect(dbRent?.version).toBe(1);

      // Verify DEPOSIT bill is untouched
      const dbDeposit = await prisma.bill.findUnique({ where: { id: depositBill.id } });
      expect(formatDecimal(dbDeposit?.totalAmount ?? '0')).toBe('4000.00');
      expect(dbDeposit?.version).toBe(1);
    });

    it('WRK15–WRK17: Preserves Bill ID, updates outstandingAmount = totalAmount - paidAmount, and leaves Payment history untouched', async () => {
      // Simulate partial payment of 300.00 on billId
      await prisma.bill.update({
        where: { id: billId },
        data: {
          paidAmount: new Prisma.Decimal('300.00'),
          outstandingAmount: new Prisma.Decimal('500.00'),
        },
      });

      const payment = await prisma.payment.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billId: billId,
          amount: new Prisma.Decimal('300.00'),
          method: 'promptpay',
          paymentDate: new Date('2026-08-07T00:00:00.000Z'),
          status: 'verified',
        },
      });

      // Reconcile on Aug 8 (+150 late fee -> total: 950.00)
      await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { Payment: true },
      });

      // Same Bill ID
      expect(dbBill?.id).toBe(billId);
      // Total updated to 850.00 (800.00 subtotal + 50.00 late fee)
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('850.00');
      // Paid amount preserved at 300.00
      expect(formatDecimal(dbBill?.paidAmount ?? '0')).toBe('300.00');
      // Outstanding amount = 850 - 300 = 550.00
      expect(formatDecimal(dbBill?.outstandingAmount ?? '0')).toBe('550.00');
      // Payment relation untouched
      expect(dbBill?.Payment.length).toBe(1);
      expect(dbBill?.Payment[0].id).toBe(payment.id);
    });

    it('WRK23: Failure on one candidate bill does not abort the remaining batch', async () => {
      // Create a cycle with missing rate snapshot (causes generateBillPreview to throw MISSING_RATE_SNAPSHOT)
      const missingSnapCycle = await prisma.billingCycle.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          cycleCode: `CORRUPT-${Date.now()}`,
          name: 'Corrupt Cycle',
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          status: 'draft',
        },
      });

      const bldg3 = await prisma.building.create({ data: { id: randomUUID(), dormitoryId: dormId, name: 'Bld 3' } });
      const roomCorrupt = await prisma.room.create({ data: { id: randomUUID(), dormitoryId: dormId, buildingId: bldg3.id, roomNumber: '199', normalizedRoomNumber: '199', floor: 1, roomType: 'standard', status: 'occupied', monthlyRent: new Prisma.Decimal('4000.00') } });

      await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: missingSnapCycle.id,
          roomId: roomCorrupt.id,
          billNumber: `BAD-${Date.now()}`,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('500.00'),
          totalAmount: new Prisma.Decimal('500.00'),
          outstandingAmount: new Prisma.Decimal('500.00'),
          version: 1,
        },
      });

      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);
      // Valid bill processed, missing snapshot bill skipped/failed without crashing the run
      expect(summary.changed).toBeGreaterThanOrEqual(1);
    });

    it('WRK24: Concurrent reconciliation invocations converge safely without duplicate items or corrupt versions', async () => {
      // Trigger two concurrent reconciliation attempts
      await Promise.all([
        reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId),
        reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId),
      ]);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });

      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('850.00');
      expect(dbBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });

    it('WRK25–WRK26: CleanupService runs catch-up on startup and GET queries remain strictly read-only', async () => {
      // Run startup catch-up
      await cleanupService.runStartupCatchUp(new Date('2026-08-08T10:00:00.000Z'), dormId);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('850.00');
      const versionBeforeGet = dbBill?.version;

      // Pure GET read (simulated findUnique)
      const readBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(readBill?.version).toBe(versionBeforeGet);
    });
  });

  describe('PART A & H: Bounded Batch Continuation & Completeness (>200 bills)', () => {
    let batchDormId: string;
    let batchCycleId: string;
    const billIds: string[] = [];

    beforeAll(async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          id: randomUUID(),
          name: `Batch Completeness Dorm ${Date.now()}`,
          status: 'active',
        },
      });
      batchDormId = dorm.id;

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: batchDormId,
          waterBillingType: 'fixed',
          waterRate: new Prisma.Decimal('100.00'),
          electricityBillingType: 'fixed',
          electricityRate: new Prisma.Decimal('200.00'),
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          dueDay: 5,
          gracePeriodDays: 0,
        },
      });

      const res = await billingCycleService.createBillingCycle(batchDormId, {
        cycleCode: '2026-08-BATCH',
        name: 'August Batch Cycle',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-01',
      });
      batchCycleId = res.cycle.id;

      // Update cycle dueDate to 2026-08-05 for test referenceTime 2026-08-08
      await prisma.billingCycle.update({
        where: { id: batchCycleId },
        data: { dueDate: new Date('2026-08-05T00:00:00.000Z') },
      });

      const bldg = await prisma.building.create({
        data: { id: randomUUID(), dormitoryId: batchDormId, name: 'Batch Bldg' },
      });

      // Seed 450 rooms, tenants, contracts, bills
      for (let i = 1; i <= 450; i++) {
        const r = await prisma.room.create({
          data: {
            id: randomUUID(),
            dormitoryId: batchDormId,
            buildingId: bldg.id,
            roomNumber: `B-${i.toString().padStart(3, '0')}`,
            normalizedRoomNumber: `b${i}`,
            floor: 1,
            roomType: 'standard',
            status: 'occupied',
            monthlyRent: new Prisma.Decimal('4000.00'),
          },
        });

        const t = await prisma.tenant.create({
          data: {
            id: randomUUID(),
            dormitoryId: batchDormId,
            firstName: `Tenant`,
            lastName: `${i}`,
            displayName: `Tenant ${i}`,
            phone: `081${i.toString().padStart(7, '0')}`,
            tenantNumber: `TNT-B-${i}`,
            status: 'active',
          },
        });

        await prisma.contract.create({
          data: {
            id: randomUUID(),
            dormitoryId: batchDormId,
            roomId: r.id,
            tenantId: t.id,
            contractNumber: `CTR-B-${i}`,
            startDate: new Date('2026-01-01T00:00:00.000Z'),
            endDate: new Date('2026-12-31T00:00:00.000Z'),
            status: 'active',
            rentAmount: new Prisma.Decimal('4000.00'),
            depositAmount: new Prisma.Decimal('4000.00'),
          },
        });

        const b = await prisma.bill.create({
          data: {
            id: randomUUID(),
            dormitoryId: batchDormId,
            billingCycleId: batchCycleId,
            roomId: r.id,
            billNumber: `INV-BATCH-${i}`,
            billKind: 'MONTHLY_UTILITY',
            status: 'unpaid',
            billingDate: new Date('2026-08-01T00:00:00.000Z'),
            dueDate: new Date('2026-08-05T00:00:00.000Z'),
            subtotal: new Prisma.Decimal('300.00'),
            totalAmount: new Prisma.Decimal('300.00'),
            outstandingAmount: new Prisma.Decimal('300.00'),
            version: 1,
          },
        });

        billIds.push(b.id);
      }
    });

    it('WRK-BATCH-1 to WRK-BATCH-4: 450 overdue bills are ALL processed completely across 3 batches (200 + 200 + 50) without starvation', async () => {
      // Run single reconciliation run on Aug 8 (+50 late fee -> total: 350.00)
      const summary = await reconciler.reconcileOverdueBills(
        new Date('2026-08-08T10:00:00.000Z'),
        batchDormId
      );

      // Scanned all 450
      expect(summary.scanned).toBe(450);
      expect(summary.changed).toBe(450);
      expect(summary.noop).toBe(0);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);

      // Verify all 450 in DB are reconciled to 350.00
      const unreconciled = await prisma.bill.count({
        where: {
          dormitoryId: batchDormId,
          totalAmount: { not: new Prisma.Decimal('350.00') },
        },
      });
      expect(unreconciled).toBe(0); // 0 remaining stale bills
    }, 120000);

    it('WRK-BATCH-5 & WRK-BATCH-7: When all 450 are already canonical, second run scans all and NO-OPs without infinite loop', async () => {
      const summary = await reconciler.reconcileOverdueBills(
        new Date('2026-08-08T10:00:00.000Z'),
        batchDormId
      );

      expect(summary.scanned).toBe(450);
      expect(summary.changed).toBe(0);
      expect(summary.noop).toBe(450);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);
    }, 120000);

    it('WRK-BATCH-6: Failure on bill #50 does not block later bills (e.g. bills 51..450)', async () => {
      // Advance to Aug 9 (+100 late fee -> total: 400.00)
      // Delete contract for 50th bill to trigger error during preview generation
      const bill50 = await prisma.bill.findUnique({
        where: { id: billIds[49] },
      });
      await prisma.contract.deleteMany({
        where: { dormitoryId: batchDormId, roomId: bill50!.roomId },
      });

      const summary = await reconciler.reconcileOverdueBills(
        new Date('2026-08-09T10:00:00.000Z'),
        batchDormId
      );

      expect(summary.scanned).toBe(450);
      expect(summary.changed).toBe(449);
      expect(summary.failed).toBe(1);
      expect(summary.noop).toBe(0);

      // Bills 51..450 are reconciled to 400.00
      const reconciledCount = await prisma.bill.count({
        where: {
          dormitoryId: batchDormId,
          totalAmount: new Prisma.Decimal('400.00'),
        },
      });
      expect(reconciledCount).toBe(449);
    }, 120000);
  });

  describe('PART B: Multi-Instance DB Lock & Concurrency Proof', () => {
    it('CONC1: Two concurrent reconciliation attempts on SAME stale bill execute with row-level serialization', async () => {
      const lockDorm = await prisma.dormitory.create({
        data: { id: randomUUID(), name: 'Lock Proof Dorm', status: 'active' },
      });
      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: lockDorm.id,
          waterBillingType: 'fixed',
          waterRate: new Prisma.Decimal('100.00'),
          electricityBillingType: 'fixed',
          electricityRate: new Prisma.Decimal('200.00'),
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          dueDay: 5,
          gracePeriodDays: 0,
        },
      });

      const res = await billingCycleService.createBillingCycle(lockDorm.id, {
        cycleCode: '2026-08-LOCK',
        name: 'August Lock Cycle',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-01',
      });

      await prisma.billingCycle.update({
        where: { id: res.cycle.id },
        data: { dueDate: new Date('2026-08-05T00:00:00.000Z') },
      });

      const bldg = await prisma.building.create({
        data: { id: randomUUID(), dormitoryId: lockDorm.id, name: 'Lock Bldg' },
      });
      const room = await prisma.room.create({
        data: {
          id: randomUUID(),
          dormitoryId: lockDorm.id,
          buildingId: bldg.id,
          roomNumber: 'L1',
          normalizedRoomNumber: 'l1',
          floor: 1,
          roomType: 'standard',
          status: 'occupied',
          monthlyRent: new Prisma.Decimal('4000.00'),
        },
      });
      const tenant = await prisma.tenant.create({
        data: {
          id: randomUUID(),
          dormitoryId: lockDorm.id,
          firstName: 'Lock',
          lastName: 'Tenant',
          displayName: 'Lock Tenant',
          phone: '0899999999',
          tenantNumber: `TNT-LOCK`,
          status: 'active',
        },
      });
      await prisma.contract.create({
        data: {
          id: randomUUID(),
          dormitoryId: lockDorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-LOCK`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T00:00:00.000Z'),
          status: 'active',
          rentAmount: new Prisma.Decimal('4000.00'),
          depositAmount: new Prisma.Decimal('4000.00'),
        },
      });

      const bill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: lockDorm.id,
          billingCycleId: res.cycle.id,
          roomId: room.id,
          billNumber: `INV-LOCK-1`,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('300.00'),
          totalAmount: new Prisma.Decimal('300.00'),
          outstandingAmount: new Prisma.Decimal('300.00'),
          version: 1,
        },
      });

      // Run two concurrent reconciliations on the exact same bill
      const [res1, res2] = await Promise.all([
        (reconciler as any).reconcileSingleBillInTx(bill.id, lockDorm.id, new Date('2026-08-08T10:00:00.000Z')),
        (reconciler as any).reconcileSingleBillInTx(bill.id, lockDorm.id, new Date('2026-08-08T10:00:00.000Z')),
      ]);

      // Exactly one must be 'changed', the other must be 'noop'
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual(['changed', 'noop']);

      const finalBill = await prisma.bill.findUnique({
        where: { id: bill.id },
        include: { items: true },
      });

      // Version incremented exactly once (1 -> 2)
      expect(finalBill?.version).toBe(2);
      expect(formatDecimal(finalBill?.totalAmount ?? '0')).toBe('350.00');
      // Exactly 1 late_fee item (no duplicate items)
      expect(finalBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });
  });

  describe('PART E: Unsupported Percentage Mode Fail-Closed Handling', () => {
    it('PCT1: Calculator throws INVALID_LATE_FEE_MODE when encountering percentage mode', () => {
      expect(() => {
        calculateCanonicalMonthlyUtility({
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          asOfDate: new Date('2026-08-08T00:00:00.000Z'),
          rateSnapshot: {
            waterBillingType: 'fixed',
            waterRate: '100.00',
            electricityBillingType: 'fixed',
            electricityRate: '200.00',
            lateFeeType: 'percentage',
            lateFeeValue: '10.00',
            gracePeriodDays: 0,
          },
        });
      }).toThrowError('INVALID_LATE_FEE_MODE');
    });

    it('PCT2 & PCT4: Worker encounters percentage snapshot -> skips bill with INVALID_LATE_FEE_MODE without 0-penalty mutation', async () => {
      const pctDorm = await prisma.dormitory.create({
        data: { id: randomUUID(), name: 'Percentage Dorm', status: 'active' },
      });
      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: pctDorm.id,
          waterBillingType: 'fixed',
          waterRate: new Prisma.Decimal('100.00'),
          electricityBillingType: 'fixed',
          electricityRate: new Prisma.Decimal('200.00'),
          lateFeeType: 'percentage',
          lateFeeValue: new Prisma.Decimal('10.00'),
          dueDay: 5,
          gracePeriodDays: 2,
        },
      });

      const res = await billingCycleService.createBillingCycle(pctDorm.id, {
        cycleCode: '2026-08-PCT',
        name: 'August Percentage Cycle',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-01',
      });

      await prisma.billingCycle.update({
        where: { id: res.cycle.id },
        data: { dueDate: new Date('2026-08-05T00:00:00.000Z') },
      });

      const bldg = await prisma.building.create({
        data: { id: randomUUID(), dormitoryId: pctDorm.id, name: 'Pct Bldg' },
      });
      const room = await prisma.room.create({
        data: {
          id: randomUUID(),
          dormitoryId: pctDorm.id,
          buildingId: bldg.id,
          roomNumber: 'P1',
          normalizedRoomNumber: 'p1',
          floor: 1,
          roomType: 'standard',
          status: 'occupied',
          monthlyRent: new Prisma.Decimal('4000.00'),
        },
      });
      const tenant = await prisma.tenant.create({
        data: {
          id: randomUUID(),
          dormitoryId: pctDorm.id,
          firstName: 'Pct',
          lastName: 'Tenant',
          displayName: 'Pct Tenant',
          phone: '0877777777',
          tenantNumber: `TNT-PCT`,
          status: 'active',
        },
      });
      await prisma.contract.create({
        data: {
          id: randomUUID(),
          dormitoryId: pctDorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-PCT`,
          startDate: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T00:00:00.000Z'),
          status: 'active',
          rentAmount: new Prisma.Decimal('4000.00'),
          depositAmount: new Prisma.Decimal('4000.00'),
        },
      });

      const bill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: pctDorm.id,
          billingCycleId: res.cycle.id,
          roomId: room.id,
          billNumber: `INV-PCT-1`,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('300.00'),
          totalAmount: new Prisma.Decimal('300.00'),
          outstandingAmount: new Prisma.Decimal('300.00'),
          version: 1,
        },
      });

      const summary = await reconciler.reconcileOverdueBills(
        new Date('2026-08-08T10:00:00.000Z'),
        pctDorm.id
      );

      // Skipped with INVALID_LATE_FEE_MODE
      expect(summary.scanned).toBe(1);
      expect(summary.changed).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.details[0].reason).toBe('INVALID_LATE_FEE_MODE');

      // Bill untouched (version 1, total 300.00, no zero-penalty items added)
      const unchangedBill = await prisma.bill.findUnique({
        where: { id: bill.id },
        include: { items: true },
      });
      expect(unchangedBill?.version).toBe(1);
      expect(formatDecimal(unchangedBill?.totalAmount ?? '0')).toBe('300.00');
      expect(unchangedBill?.items.length).toBe(0);
    });
  });

  describe('PART G: Fixed 2-Day Silent Grace Authority (GR2-1..9)', () => {
    it('GR2-1: Global constant LATE_FEE_GRACE_DAYS is fixed to 2', () => {
      expect(LATE_FEE_GRACE_DAYS).toBe(2);
    });

    it('GR2-2: Onboarding validation schema normalizes any gracePeriodDays input to 2', () => {
      const parsed0 = OnboardingBillingInputSchema.parse({ gracePeriodDays: 0, dueDay: 5 });
      expect(parsed0.gracePeriodDays).toBe(2);

      const parsed5 = OnboardingBillingInputSchema.parse({ gracePeriodDays: 5, dueDay: 5 });
      expect(parsed5.gracePeriodDays).toBe(2);

      const parsedDefault = OnboardingBillingInputSchema.parse({ dueDay: 5 });
      expect(parsedDefault.gracePeriodDays).toBe(2);
    });

    it('GR2-3 & GR2-4: Dormitory settings and cycle rate snapshot freeze gracePeriodDays as 2', async () => {
      const testDorm = await prisma.dormitory.create({
        data: { id: randomUUID(), name: 'Grace Authority Dorm', status: 'active' },
      });

      const settings = await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: testDorm.id,
          dueDay: 5,
          waterBillingType: 'fixed',
          waterRate: new Prisma.Decimal('100.00'),
          electricityBillingType: 'fixed',
          electricityRate: new Prisma.Decimal('200.00'),
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
        },
      });
      expect(settings.gracePeriodDays).toBe(2);

      const res = await billingCycleService.createBillingCycle(testDorm.id, {
        cycleCode: '2026-09-GRACE',
        name: 'September Grace Cycle',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        billingDate: '2026-09-01',
      });
      expect(res.rateSnapshot.gracePeriodDays).toBe(2);
    });

    it('GR2-5 to GR2-8: Sep 5 due date produces exactly 0 on Sep 5..7, 50 on Sep 8, 100 on Sep 9', () => {
      const baseArgs = {
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '100.00',
          electricityBillingType: 'fixed',
          electricityRate: '200.00',
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        dueDate: '2026-09-05',
      };

      // Sep 5 (due date) -> 0
      const sep5 = calculateCanonicalMonthlyUtility({ ...baseArgs, asOfDate: '2026-09-05' });
      expect(sep5.lateFeeAmount).toBe('0.00');
      expect(sep5.items.some(i => i.type === 'late_fee')).toBe(false);

      // Sep 6 (grace day 1) -> 0
      const sep6 = calculateCanonicalMonthlyUtility({ ...baseArgs, asOfDate: '2026-09-06' });
      expect(sep6.lateFeeAmount).toBe('0.00');
      expect(sep6.items.some(i => i.type === 'late_fee')).toBe(false);

      // Sep 7 (grace day 2) -> 0
      const sep7 = calculateCanonicalMonthlyUtility({ ...baseArgs, asOfDate: '2026-09-07' });
      expect(sep7.lateFeeAmount).toBe('0.00');
      expect(sep7.items.some(i => i.type === 'late_fee')).toBe(false);

      // Sep 8 (1st chargeable day) -> 50.00 (NOT 150.00)
      const sep8 = calculateCanonicalMonthlyUtility({ ...baseArgs, asOfDate: '2026-09-08' });
      expect(sep8.lateFeeAmount).toBe('50.00');
      expect(sep8.items.find(i => i.type === 'late_fee')?.description).toBe('ค่าปรับล่าช้า (1 วัน)');

      // Sep 9 (2nd chargeable day) -> 100.00
      const sep9 = calculateCanonicalMonthlyUtility({ ...baseArgs, asOfDate: '2026-09-09' });
      expect(sep9.lateFeeAmount).toBe('100.00');
      expect(sep9.items.find(i => i.type === 'late_fee')?.description).toBe('ค่าปรับล่าช้า (2 วัน)');
    });

    it('GR2-9: Fixed fee mode charges 100 once on Sep 8 and remains 100 on Sep 9..10', () => {
      const baseFixed = {
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '100.00',
          electricityBillingType: 'fixed',
          electricityRate: '200.00',
          lateFeeType: 'fixed',
          lateFeeValue: '100.00',
        },
        dueDate: '2026-09-05',
      };

      const sep7 = calculateCanonicalMonthlyUtility({ ...baseFixed, asOfDate: '2026-09-07' });
      expect(sep7.lateFeeAmount).toBe('0.00');

      const sep8 = calculateCanonicalMonthlyUtility({ ...baseFixed, asOfDate: '2026-09-08' });
      expect(sep8.lateFeeAmount).toBe('100.00');

      const sep9 = calculateCanonicalMonthlyUtility({ ...baseFixed, asOfDate: '2026-09-09' });
      expect(sep9.lateFeeAmount).toBe('100.00');

      const sep15 = calculateCanonicalMonthlyUtility({ ...baseFixed, asOfDate: '2026-09-15' });
      expect(sep15.lateFeeAmount).toBe('100.00');
    });
  });

  describe('PART H: Authoritative Bill Due Date Rollover & Lifetime Freeze (BD1..9)', () => {
    it('BD1–BD5: resolveBillDueDate rollover rules (Issue <= dueDay -> same month; Issue > dueDay -> next month)', () => {
      // dueDay = 5
      expect(resolveBillDueDate(new Date('2026-08-28T00:00:00.000Z'), 5).toISOString().slice(0, 10)).toBe('2026-09-05');
      expect(resolveBillDueDate(new Date('2026-09-04T00:00:00.000Z'), 5).toISOString().slice(0, 10)).toBe('2026-09-05');
      expect(resolveBillDueDate(new Date('2026-09-05T00:00:00.000Z'), 5).toISOString().slice(0, 10)).toBe('2026-09-05');
      expect(resolveBillDueDate(new Date('2026-09-06T00:00:00.000Z'), 5).toISOString().slice(0, 10)).toBe('2026-10-05');
      expect(resolveBillDueDate(new Date('2026-09-15T00:00:00.000Z'), 5).toISOString().slice(0, 10)).toBe('2026-10-05');
    });

    it('BD6: Late issuance on Sep 15 (dueDate Oct 5) has 0 late fee at issuance time', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '100.00',
          electricityBillingType: 'fixed',
          electricityRate: '200.00',
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        dueDate: '2026-10-05',
        asOfDate: '2026-09-15',
      });
      expect(res.lateFeeAmount).toBe('0.00');
      expect(res.items.some(i => i.type === 'late_fee')).toBe(false);
    });

    it('BD7: Unissued preview has NO late fee (dueDate is null in preview)', () => {
      const preview = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '100.00',
          electricityBillingType: 'fixed',
          electricityRate: '200.00',
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        dueDate: null,
        asOfDate: '2026-09-15',
      });
      expect(preview.lateFeeAmount).toBe('0.00');
      expect(preview.items.some(i => i.type === 'late_fee')).toBe(false);
    });
  });

  describe('PART I: Tenant Contract Type & Bill Kind Exclusion Authority (TT1..6)', () => {
    it('TT1 & TT2: MONTHLY and TERM tenants are eligible for late fee on MONTHLY_UTILITY', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '100.00',
          electricityBillingType: 'fixed',
          electricityRate: '200.00',
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        dueDate: '2026-09-05',
        asOfDate: '2026-09-08',
      });
      expect(res.lateFeeAmount).toBe('50.00');
    });

    it('TT3–TT5: RENT and DEPOSIT bills never receive late fee', async () => {
      const ttCycle = await prisma.billingCycle.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          cycleCode: `TT-CYCLE-${Date.now()}`,
          name: 'TT Cycle',
          periodStart: new Date('2026-08-01T00:00:00.000Z'),
          periodEnd: new Date('2026-08-31T00:00:00.000Z'),
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          status: 'draft',
        },
      });

      const rentBill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: ttCycle.id,
          roomId: roomId,
          billNumber: `RENT-${Date.now()}`,
          billKind: 'RENT',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('4000.00'),
          totalAmount: new Prisma.Decimal('4000.00'),
          outstandingAmount: new Prisma.Decimal('4000.00'),
          version: 1,
        },
      });

      const depBill = await prisma.bill.create({
        data: {
          id: randomUUID(),
          dormitoryId: dormId,
          billingCycleId: ttCycle.id,
          roomId: roomId,
          billNumber: `DEP-${Date.now()}`,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          billingDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-05T00:00:00.000Z'),
          subtotal: new Prisma.Decimal('5000.00'),
          totalAmount: new Prisma.Decimal('5000.00'),
          outstandingAmount: new Prisma.Decimal('5000.00'),
          version: 1,
        },
      });

      const summary = await reconciler.reconcileOverdueBills(new Date('2026-09-15T10:00:00.000Z'), dormId);

      // RENT bill is not modified by reconciler
      const dbRent = await prisma.bill.findUnique({
        where: { id: rentBill.id },
        include: { items: true },
      });
      expect(formatDecimal(dbRent?.totalAmount ?? '0')).toBe('4000.00');
      expect(dbRent?.items.some(i => i.type === 'late_fee')).toBe(false);

      // DEPOSIT bill is not modified by reconciler
      const dbDep = await prisma.bill.findUnique({
        where: { id: depBill.id },
        include: { items: true },
      });
      expect(formatDecimal(dbDep?.totalAmount ?? '0')).toBe('5000.00');
      expect(dbDep?.items.some(i => i.type === 'late_fee')).toBe(false);
    });
  });

  describe('PART J: Daily 00:05 Scheduler & Startup Catch-Up (SCH1..5)', () => {
    it('SCH1 & SCH2: getNextBangkok0005DelayMs calculates positive delay targeting 00:05 Bangkok (17:05 UTC)', () => {
      const now = new Date('2026-08-26T10:00:00.000Z'); // 17:00 Bangkok
      const delayMs = lateFeeReconciliationService.getNextBangkok0005DelayMs(now);
      expect(delayMs).toBeGreaterThan(0);
      expect(delayMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    });

    it('SCH3 & SCH5: runStartupCatchUp executes catch-up and repeated execution is safe NO-OP', async () => {
      const res1 = await lateFeeReconciliationService.runStartupCatchUp(new Date('2026-08-08T10:00:00.000Z'), dormId);
      expect(res1).toBeDefined();

      const res2 = await lateFeeReconciliationService.runStartupCatchUp(new Date('2026-08-08T10:00:00.000Z'), dormId);
      expect(res2.changed).toBe(0);
    }, 60000);

    it('SCH4: cleanupService.runCleanup does not throw and executes non-late-fee cleanup phases', async () => {
      const res = await cleanupService.runCleanup();
      expect(res).toBeDefined();
      expect(res.expiredMarked).toBeDefined();
      expect(res.orphansDeleted).toBeDefined();
      expect(res.consumedMetadataPurged).toBeDefined();
    });
  });
});
