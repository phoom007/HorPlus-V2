/**
 * Integration Test for R3.8:
 * - Direct DB & API assertions on local PostgreSQL LOCAL-07
 * - Authoritative Cash partial settlement & receipts
 * - Payments API including bill.items
 * - July first billing cycle & deposit statuses
 * 
 * @license Apache-2.0
 */

import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '../../server/node_modules/@prisma/client/index.js';
import { recordCashPaymentInTx } from '../../server/src/utils/payment-transaction.util.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://horplus:horplus_test_password@127.0.0.1:5455/horplus_wave1d_fasttrack_test?schema=public',
    },
  },
});

describe('R3.8 Integration & PostgreSQL Authority', () => {
  const COMP_DORM_ID = '20000001-0000-4000-8000-000000000002';
  const OWNER_USER_ID = '20000002-0000-4000-8000-000000000002';
  let createdTestBillId: string | null = null;

  afterAll(async () => {
    if (createdTestBillId) {
      const payments = await prisma.payment.findMany({ where: { billId: createdTestBillId }, select: { id: true } });
      const paymentIds = payments.map(p => p.id);
      if (paymentIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } });
      }
      await prisma.receipt.deleteMany({ where: { billId: createdTestBillId } });
      await prisma.payment.deleteMany({ where: { billId: createdTestBillId } });
      await prisma.billItem.deleteMany({ where: { billId: createdTestBillId } });
      await prisma.billStatusHistory.deleteMany({ where: { billId: createdTestBillId } });
      await prisma.bill.delete({ where: { id: createdTestBillId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('1. July 2026 is the FIRST billing cycle; June cycle does NOT exist', async () => {
    const cycles = await prisma.billingCycle.findMany({
      where: { dormitoryId: COMP_DORM_ID },
      orderBy: { periodStart: 'asc' },
    });

    expect(cycles.length).toBeGreaterThanOrEqual(3);
    expect(cycles[0].cycleCode).toBe('2026-07');
    expect(cycles.some(c => c.cycleCode === '2026-06')).toBe(false);
  });

  it('2. Room 101 Deposit Bill originates in July and is PAID with Receipt', async () => {
    const r101 = await prisma.room.findFirst({
      where: { dormitoryId: COMP_DORM_ID, roomNumber: '101' },
    });
    expect(r101).toBeDefined();

    const depositBills = await prisma.bill.findMany({
      where: { dormitoryId: COMP_DORM_ID, roomId: r101!.id, billKind: 'DEPOSIT' },
      include: { items: true, Payment: true, Receipt: true, billingCycle: true },
    });

    expect(depositBills.length).toBe(1);
    const depBill = depositBills[0];
    expect(depBill.billNumber).toBe('INV-202607-101-D');
    expect(depBill.billingCycle.cycleCode).toBe('2026-07');
    expect(depBill.status).toBe('paid');
    expect(Number(depBill.totalAmount)).toBe(4500);
    expect(Number(depBill.paidAmount)).toBe(4500);
    expect(Number(depBill.outstandingAmount)).toBe(0);
    expect(depBill.Payment.length).toBe(1);
    expect(depBill.Payment[0].status).toBe('APPROVED');
    expect(depBill.Receipt.length).toBe(1);
    expect(depBill.Receipt[0].receiptNumber).toBe('RCP-202607-101-D');
  });

  it('3. Room 102 Deposit Bill is UNPAID in July 2026', async () => {
    const r102 = await prisma.room.findFirst({
      where: { dormitoryId: COMP_DORM_ID, roomNumber: '102' },
    });
    expect(r102).toBeDefined();

    const depositBills = await prisma.bill.findMany({
      where: { dormitoryId: COMP_DORM_ID, roomId: r102!.id, billKind: 'DEPOSIT' },
      include: { items: true, billingCycle: true },
    });

    expect(depositBills.length).toBe(1);
    const depBill = depositBills[0];
    expect(depBill.billNumber).toBe('INV-202607-102-D');
    expect(depBill.billingCycle.cycleCode).toBe('2026-07');
    expect(depBill.status).toBe('unpaid');
    expect(Number(depBill.totalAmount)).toBe(4500);
    expect(Number(depBill.outstandingAmount)).toBe(4500);
  });

  it('4. Partial bill Cash settlement in transaction succeeds on outstanding amount and creates accurate receipt', async () => {
    const r104 = await prisma.room.findFirst({
      where: { dormitoryId: COMP_DORM_ID, roomNumber: '104' },
    });
    expect(r104).toBeDefined();

    const cycleAug = await prisma.billingCycle.findFirst({
      where: { dormitoryId: COMP_DORM_ID, cycleCode: '2026-08' },
    });
    expect(cycleAug).toBeDefined();

    // Create dynamic partial test bill
    const testBill = await prisma.bill.create({
      data: {
        dormitoryId: COMP_DORM_ID,
        billingCycleId: cycleAug!.id,
        roomId: r104!.id,
        billNumber: `INV-TEST-${Date.now()}`,
        billKind: 'LEGACY_COMBINED',
        status: 'partial',
        totalAmount: 10600.0,
        paidAmount: 3000.0,
        outstandingAmount: 7600.0,
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        subtotal: 10600.0,
      },
    });
    createdTestBillId = testBill.id;

    await prisma.billItem.createMany({
      data: [
        { dormitoryId: COMP_DORM_ID, billId: testBill.id, type: 'rent', description: 'ค่าเช่าห้องพัก', quantity: 1, unitPrice: 4800, amount: 4800 },
        { dormitoryId: COMP_DORM_ID, billId: testBill.id, type: 'deposit', description: 'เงินประกัน', quantity: 1, unitPrice: 4800, amount: 4800 },
        { dormitoryId: COMP_DORM_ID, billId: testBill.id, type: 'utility', description: 'ค่าน้ำ-ไฟ', quantity: 1, unitPrice: 1000, amount: 1000 },
      ],
    });

    // Perform atomic transaction cash payment
    const payment = await prisma.$transaction(async (tx) => {
      return await recordCashPaymentInTx(tx, {
        dormitoryId: COMP_DORM_ID,
        billId: testBill.id,
        amount: '7600.00',
        userId: OWNER_USER_ID,
        paymentDate: new Date('2026-08-29T15:00:00Z'),
      });
    });

    expect(payment).toBeDefined();
    expect(Number(payment.amount)).toBe(7600);
    expect(payment.status).toBe('APPROVED');

    // Re-query bill from DB
    const settledBill = await prisma.bill.findUnique({
      where: { id: testBill.id },
      include: { Payment: true, Receipt: true },
    });

    expect(settledBill!.status).toBe('PAID');
    expect(Number(settledBill!.paidAmount)).toBe(10600);
    expect(Number(settledBill!.outstandingAmount)).toBe(0);

    // Verify created receipt in DB
    const receipt = settledBill!.Receipt.find(r => r.paymentId === payment.id);
    expect(receipt).toBeDefined();
    expect(receipt!.receiptNumber).toMatch(/^RC-\d{6}-104-\d{4}$/);
    const snap = receipt!.snapshotData as any;
    expect(snap.total).toBe('7600.00');
    expect(snap.items[0].amount).toBe('7600.00');
    expect(snap.items[0].description).toContain(`ชำระยอดคงเหลือบิล ${testBill.billNumber}`);
  });
});
