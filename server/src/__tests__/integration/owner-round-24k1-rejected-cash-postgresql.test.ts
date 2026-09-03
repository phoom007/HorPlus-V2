/**
 * @license Apache-2.0
 * Round 2.4K.1: Rejected Slip -> Cash Real PostgreSQL Proof & Idempotency
 *
 * Requirements:
 * 1. Bill outstanding > 0 + REJECTED transfer Payment
 * 2. POST /payments/cash (recordCash) -> CASH APPROVED Payment created
 * 3. Rejected Payment remains immutable
 * 4. PaymentAllocation created linking Cash Payment to Bill
 * 5. Bill paid/outstanding updated (status: 'paid', outstanding: '0.00')
 * 6. Final Receipt generated when settled (paymentMethod: 'CASH')
 * 7. Retry with SAME idempotency key -> same logical result, no duplicate payment/allocation
 * 8. Already-settled Bill -> rejected with ALREADY_PAID error
 * 9. Real PostgreSQL database proof on Comprehensive Dormitory / Room 202 fixtures
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Decimal from 'decimal.js';
import { getPrismaClient } from '../../db/prisma.js';
import { PaymentService } from '../../services/payment.service.js';
import { AppError } from '../../utils/error.util.js';

describe('Round 2.4K.1: Rejected Slip -> Cash PostgreSQL Proof & Idempotency', () => {
  const prisma = getPrismaClient();
  const paymentService = new PaymentService();

  let compDorm: any;
  let ownerUserId: string;
  let testRoom: any;
  let testBillingCycle: any;
  let testTenant: any;
  let testBill: any;
  let rejectedPayment: any;
  let alreadyPaidBill: any;

  beforeAll(async () => {
    // 1. Locate Comprehensive Dormitory
    compDorm = await prisma.dormitory.findFirst({
      where: { name: { contains: 'Comprehensive' } },
    });
    if (!compDorm) {
      throw new Error('Comprehensive Dormitory fixture not found. Ensure database is seeded.');
    }

    ownerUserId = compDorm.createdByUserId;

    const building = await prisma.building.findFirst({
      where: { dormitoryId: compDorm.id },
    });

    const testRoomNum = `T24K1-${Date.now().toString().slice(-5)}`;
    testRoom = await prisma.room.create({
      data: {
        dormitoryId: compDorm.id,
        buildingId: building?.id,
        roomNumber: testRoomNum,
        normalizedRoomNumber: testRoomNum.toLowerCase(),
        floor: 99,
        monthlyRent: 2500,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'occupied',
      },
    });

    testBillingCycle = await prisma.billingCycle.findFirst({
      where: { dormitoryId: compDorm.id },
      orderBy: { periodStart: 'desc' },
    });

    testTenant = await prisma.tenant.findFirst({
      where: { dormitoryId: compDorm.id },
    });

    alreadyPaidBill = await prisma.bill.findFirst({
      where: {
        dormitoryId: compDorm.id,
        room: { roomNumber: '202' },
        status: 'paid',
      },
    });

    // 3. Create an isolated test bill with outstanding > 0 and a REJECTED slip payment
    testBill = await prisma.bill.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: testRoom.id,
        billingCycleId: testBillingCycle?.id,
        tenantId: testTenant?.id,
        billNumber: `TEST-24K1-REJ-${Date.now()}`,
        status: 'unpaid',
        totalAmount: new Decimal('2500.00'),
        paidAmount: new Decimal('0.00'),
        outstandingAmount: new Decimal('2500.00'),
        dueDate: new Date(),
        billingDate: new Date(),
      },
    });

    rejectedPayment = await prisma.payment.create({
      data: {
        dormitoryId: compDorm.id,
        billId: testBill.id,
        tenantId: testTenant?.id,
        amount: new Decimal('2500.00'),
        method: 'BANK_TRANSFER',
        status: 'REJECTED',
        rejectedReason: 'Slip verification failed: incorrect amount',
      },
    });
  });

  afterAll(async () => {
    if (testBill) {
      // Clean up payment histories, receipts, allocations, payments, and bill
      const payments = await prisma.payment.findMany({ where: { billId: testBill.id } });
      const paymentIds = payments.map((p) => p.id);
      if (paymentIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.receipt.deleteMany({ where: { billId: testBill.id } }).catch(() => {});
      await prisma.paymentAllocation.deleteMany({ where: { billId: testBill.id } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { billId: testBill.id } }).catch(() => {});
      await prisma.bill.delete({ where: { id: testBill.id } }).catch(() => {});
    }
    if (testRoom) {
      await prisma.room.delete({ where: { id: testRoom.id } }).catch(() => {});
    }
  });

  it('1. Confirms initial state: bill outstanding > 0 and payment is REJECTED', async () => {
    const freshBill = await prisma.bill.findUnique({ where: { id: testBill.id } });
    expect(freshBill).toBeDefined();
    expect(freshBill?.status).toBe('unpaid');
    expect(freshBill?.outstandingAmount.toString()).toBe('2500');

    const freshPayment = await prisma.payment.findUnique({ where: { id: rejectedPayment.id } });
    expect(freshPayment).toBeDefined();
    expect(freshPayment?.status).toBe('REJECTED');
    expect(freshPayment?.method).toBe('BANK_TRANSFER');
  });

  it('2. Records CASH payment: creates CASH APPROVED Payment, keeps rejected slip immutable, creates allocation, settles bill, generates Final Receipt', async () => {
    const idempotencyKey = `idemp-24k1-cash-${Date.now()}`;

    // Execute Cash payment
    const result = await paymentService.recordCash({
      dormitoryId: compDorm.id,
      billId: testBill.id,
      amount: '2500.00',
      userId: ownerUserId,
      idempotencyKey,
    });

    expect(result).toBeDefined();

    // Verification A: New CASH payment is created with APPROVED status
    const cashPayment = await prisma.payment.findFirst({
      where: {
        billId: testBill.id,
        method: 'CASH',
      },
    });
    expect(cashPayment).toBeDefined();
    expect(cashPayment?.status).toBe('APPROVED');
    expect(cashPayment?.amount.toString()).toBe('2500');

    // Verification B: Rejected slip Payment remains completely immutable
    const preservedRejectedPayment = await prisma.payment.findUnique({
      where: { id: rejectedPayment.id },
    });
    expect(preservedRejectedPayment).toBeDefined();
    expect(preservedRejectedPayment?.status).toBe('REJECTED');
    expect(preservedRejectedPayment?.method).toBe('BANK_TRANSFER');
    expect(preservedRejectedPayment?.amount.toString()).toBe('2500');

    // Verification C: Payment allocation links Cash Payment to Bill
    const allocation = await prisma.paymentAllocation.findFirst({
      where: {
        paymentId: cashPayment?.id,
        billId: testBill.id,
      },
    });
    expect(allocation).toBeDefined();
    expect(allocation?.allocatedAmount.toString()).toBe('2500');

    // Verification D: Bill status updated to paid and outstanding becomes 0
    const updatedBill = await prisma.bill.findUnique({ where: { id: testBill.id } });
    expect(updatedBill?.status.toLowerCase()).toBe('paid');
    expect(updatedBill?.paidAmount.toString()).toBe('2500');
    expect(updatedBill?.outstandingAmount.toString()).toBe('0');

    // Verification E: Final Receipt generated with canonical paymentMethod CASH
    const receipt = await prisma.receipt.findFirst({
      where: { billId: testBill.id },
    });
    expect(receipt).toBeDefined();
    const snapshot = receipt?.snapshotData as any;
    expect(snapshot).toBeDefined();
    expect(snapshot.paymentMethod).toBe('CASH');
    expect(snapshot.total).toBe('2500.00');
  });

  it('3. Idempotency test: Re-executing with the SAME idempotency key returns identical result and creates NO duplicate payments or allocations', async () => {
    const fixedIdempotencyKey = `idemp-24k1-fixed-${Date.now()}`;

    // Create a temporary isolated room and bill for idempotency replay verification
    const tempRoomNum = `TMP-${Date.now().toString().slice(-5)}`;
    const tempRoom = await prisma.room.create({
      data: {
        dormitoryId: compDorm.id,
        buildingId: testRoom.buildingId,
        roomNumber: tempRoomNum,
        normalizedRoomNumber: tempRoomNum.toLowerCase(),
        floor: 99,
        monthlyRent: 100,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'occupied',
      },
    });

    const tempBill = await prisma.bill.create({
      data: {
        dormitoryId: compDorm.id,
        roomId: tempRoom.id,
        billingCycleId: testBillingCycle?.id,
        tenantId: testTenant?.id,
        billNumber: `TEMP-IDEMP-${Date.now()}`,
        status: 'unpaid',
        totalAmount: new Decimal('100.00'),
        paidAmount: new Decimal('0.00'),
        outstandingAmount: new Decimal('100.00'),
        dueDate: new Date(),
        billingDate: new Date(),
      },
    });

    try {
      // First execution
      const call1 = await paymentService.recordCash({
        dormitoryId: compDorm.id,
        billId: tempBill.id,
        amount: '100.00',
        userId: ownerUserId,
        idempotencyKey: fixedIdempotencyKey,
      });

      // Second execution with identical idempotencyKey
      const call2 = await paymentService.recordCash({
        dormitoryId: compDorm.id,
        billId: tempBill.id,
        amount: '100.00',
        userId: ownerUserId,
        idempotencyKey: fixedIdempotencyKey,
      });

      expect(call1).toBeDefined();
      expect(call2).toBeDefined();
      expect((call1 as any).id).toBe((call2 as any).id);

      // Verify strictly only 1 payment and 1 allocation exist
      const payments = await prisma.payment.findMany({ where: { billId: tempBill.id } });
      expect(payments.length).toBe(1);

      const allocations = await prisma.paymentAllocation.findMany({ where: { billId: tempBill.id } });
      expect(allocations.length).toBe(1);
    } finally {
      const payments = await prisma.payment.findMany({ where: { billId: tempBill.id } });
      const paymentIds = payments.map((p) => p.id);
      if (paymentIds.length > 0) {
        await prisma.paymentStatusHistory.deleteMany({ where: { paymentId: { in: paymentIds } } }).catch(() => {});
      }
      await prisma.receipt.deleteMany({ where: { billId: tempBill.id } }).catch(() => {});
      await prisma.paymentAllocation.deleteMany({ where: { billId: tempBill.id } }).catch(() => {});
      await prisma.payment.deleteMany({ where: { billId: tempBill.id } }).catch(() => {});
      await prisma.bill.delete({ where: { id: tempBill.id } }).catch(() => {});
      await prisma.room.delete({ where: { id: tempRoom.id } }).catch(() => {});
    }
  });

  it('4. Already-settled bill: Attempting cash payment on already-settled bill throws ALREADY_PAID (400)', async () => {
    // Attempt cash payment on the testBill that was settled in test 2
    await expect(
      paymentService.recordCash({
        dormitoryId: compDorm.id,
        billId: testBill.id,
        amount: '500.00',
        userId: ownerUserId,
      })
    ).rejects.toThrowError(/ALREADY_PAID|ได้รับการชำระเงินครบแล้ว/);

    // Also verify against seeded already-paid Room 202 bill
    if (alreadyPaidBill) {
      await expect(
        paymentService.recordCash({
          dormitoryId: compDorm.id,
          billId: alreadyPaidBill.id,
          amount: '100.00',
          userId: ownerUserId,
        })
      ).rejects.toThrowError(/ALREADY_PAID|ได้รับการชำระเงินครบแล้ว/);
    }
  });
});
