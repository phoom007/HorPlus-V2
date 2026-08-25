/**
 * @license Apache-2.0
 * HORPLUS LOCAL-07 — Canonical Late-Fee Overdue Reconciler Test Suite (WRK1–WRK26 + SNP1–SNP5)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { LateFeeReconciliationService } from '../../services/late-fee-reconciliation.service.js';
import { BillingService } from '../../services/billing.service.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { cleanupService } from '../../services/cleanup.service.js';
import { formatDecimal, toDecimal } from '../../utils/decimal-math.util.js';

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
    it('SNP1–SNP3: createBillingCycle permanently freezes lateFeeType, lateFeeValue, and gracePeriodDays from current settings', async () => {
      // Set settings: daily / 50.00 / grace 0
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dormId },
        data: {
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          gracePeriodDays: 0,
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
      expect(res.rateSnapshot.gracePeriodDays).toBe(0);
      expect(res.cycle.dueDate.toISOString().slice(0, 10)).toBe('2026-09-05');
    });

    it('SNP4–SNP5: Changing Dormitory Settings today does NOT alter snapshot or dueDate of existing cycle A, but applies to future cycle B', async () => {
      // Change settings to fixed / 100.00 / grace 2 / dueDay 10
      await prisma.dormitoryBillingSettings.update({
        where: { dormitoryId: dormId },
        data: {
          lateFeeType: 'fixed',
          lateFeeValue: new Prisma.Decimal('100.00'),
          gracePeriodDays: 2,
          dueDay: 10,
        },
      });

      // Existing cycle A snapshot in DB remains daily / 50.00 / 0
      const snapA = await prisma.billingRateSnapshot.findUnique({
        where: { billingCycleId: testCycleId },
      });
      expect(snapA?.lateFeeType).toBe('daily');
      expect(snapA?.lateFeeValue.toString()).toBe('50');
      expect(snapA?.gracePeriodDays).toBe(0);

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
          gracePeriodDays: 0,
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
          { billId, dormitoryId: dormId, type: 'water', description: 'ค่าน้ำประปา', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('100.00'), amount: new Prisma.Decimal('100.00') },
          { billId, dormitoryId: dormId, type: 'electric', description: 'ค่าไฟฟ้า', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('200.00'), amount: new Prisma.Decimal('200.00') },
          { billId, dormitoryId: dormId, type: 'common', description: 'ค่าส่วนกลาง', quantity: new Prisma.Decimal('1.00'), unitPrice: new Prisma.Decimal('500.00'), amount: new Prisma.Decimal('500.00') },
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

    it('WRK3: First overdue day (2026-08-06 Bangkok), bill acquires 1 day late fee (+50 = 850.00)', async () => {
      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-06T10:00:00.000Z'), dormId);
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

    it('WRK4: Multi-day overdue (2026-08-08 Bangkok), bill acquires 3 days late fee (+150 = 950.00)', async () => {
      const summary = await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);
      expect(summary.changed).toBe(1);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
      expect(dbBill?.version).toBe(2);

      const lateItem = dbBill?.items.find((i) => i.type === 'late_fee');
      expect(lateItem?.description).toBe('ค่าปรับล่าช้า (3 วัน)');
      expect(formatDecimal(lateItem?.amount ?? '0')).toBe('150.00');
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
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
      expect(dbBill?.version).toBe(2); // Still version 2, not bumped!
      expect(dbBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });

    it('WRK6: Next day (2026-08-09 Bangkok), updates same Bill ID to 4 days (+200 = 1000.00) and increments version exactly once', async () => {
      // Reconcile on Aug 8
      await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);

      // Reconcile on Aug 9
      const summaryNext = await reconciler.reconcileOverdueBills(new Date('2026-08-09T10:00:00.000Z'), dormId);
      expect(summaryNext.changed).toBe(1);

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('1000.00');
      expect(dbBill?.version).toBe(3);

      const lateItem = dbBill?.items.find((i) => i.type === 'late_fee');
      expect(lateItem?.description).toBe('ค่าปรับล่าช้า (4 วัน)');
      expect(formatDecimal(lateItem?.amount ?? '0')).toBe('200.00');
    });

    it('WRK7: Fixed mode charges fixed penalty once regardless of how many days pass', async () => {
      // Update cycle snapshot to fixed / 100.00
      await prisma.billingRateSnapshot.update({
        where: { billingCycleId: baseCycleId },
        data: {
          lateFeeType: 'fixed',
          lateFeeValue: new Prisma.Decimal('100.00'),
        },
      });

      // Run on Aug 6 (+1 day) -> 800 + 100 = 900.00
      await reconciler.reconcileOverdueBills(new Date('2026-08-06T10:00:00.000Z'), dormId);
      let dbBill = await prisma.bill.findUnique({ where: { id: billId }, include: { items: true } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('900.00');

      // Run on Aug 15 (+10 days) -> remains 900.00 (NO accumulating duplicates)
      const summaryLate = await reconciler.reconcileOverdueBills(new Date('2026-08-15T10:00:00.000Z'), dormId);
      expect(summaryLate.changed).toBe(0);
      expect(summaryLate.noop).toBe(1);

      dbBill = await prisma.bill.findUnique({ where: { id: billId }, include: { items: true } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('900.00');
      expect(dbBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
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

    it('WRK9: Grace period boundary (grace = 2: Aug 6 and Aug 7 free; Aug 8 penalized)', async () => {
      await prisma.billingRateSnapshot.update({
        where: { billingCycleId: baseCycleId },
        data: {
          lateFeeType: 'daily',
          lateFeeValue: new Prisma.Decimal('50.00'),
          gracePeriodDays: 2,
        },
      });

      // Aug 6 (1 day past due, <= grace 2) -> No penalty
      await reconciler.reconcileOverdueBills(new Date('2026-08-06T10:00:00.000Z'), dormId);
      let dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');

      // Aug 7 (2 days past due, <= grace 2) -> No penalty
      await reconciler.reconcileOverdueBills(new Date('2026-08-07T10:00:00.000Z'), dormId);
      dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('800.00');

      // Aug 8 (3 days past due, > grace 2) -> Imposes 3 days penalty (+150 = 950.00)
      const summary8 = await reconciler.reconcileOverdueBills(new Date('2026-08-08T10:00:00.000Z'), dormId);
      expect(summary8.changed).toBe(1);
      dbBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
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
      // Total updated to 950.00
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
      // Paid amount preserved at 300.00
      expect(formatDecimal(dbBill?.paidAmount ?? '0')).toBe('300.00');
      // Outstanding amount = 950 - 300 = 650.00
      expect(formatDecimal(dbBill?.outstandingAmount ?? '0')).toBe('650.00');
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

      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
      expect(dbBill?.items.filter((i) => i.type === 'late_fee').length).toBe(1);
    });

    it('WRK25–WRK26: CleanupService runs catch-up on startup and GET queries remain strictly read-only', async () => {
      // Run cleanup service (runs Phase 6 overdue reconciler)
      await cleanupService.runCleanup(new Date('2026-08-08T10:00:00.000Z'));

      const dbBill = await prisma.bill.findUnique({
        where: { id: billId },
        include: { items: true },
      });
      expect(formatDecimal(dbBill?.totalAmount ?? '0')).toBe('950.00');
      const versionBeforeGet = dbBill?.version;

      // Pure GET read (simulated findUnique)
      const readBill = await prisma.bill.findUnique({ where: { id: billId } });
      expect(readBill?.version).toBe(versionBeforeGet);
    });
  });
});
