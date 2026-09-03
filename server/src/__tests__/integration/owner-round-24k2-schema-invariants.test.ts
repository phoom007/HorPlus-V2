import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';

describe('Round 2.4K.2: Schema Invariants — Daily Stay Payment & Allocation Authority', () => {
  let prisma: PrismaClient;
  let testDormitory: any;
  let testBill: any;
  let testDailyInvoice: any;
  let testDailyItem: any;
  let createdPaymentIds: string[] = [];
  let createdAllocationIds: string[] = [];
  let createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    testDailyInvoice = await prisma.dailyStayInvoice.findFirst({
      where: { deletedAt: null },
      include: { items: true },
    });
    expect(testDailyInvoice).toBeDefined();
    expect(testDailyInvoice.items.length).toBeGreaterThan(0);
    testDailyItem = testDailyInvoice.items[0];

    testDormitory = await prisma.dormitory.findUnique({
      where: { id: testDailyInvoice.dormitoryId },
    });
    expect(testDormitory).toBeDefined();

    testBill = await prisma.bill.findFirst({
      where: { dormitoryId: testDormitory.id },
    });
    if (!testBill) {
      testBill = await prisma.bill.findFirst();
    }
    expect(testBill).toBeDefined();
  });

  afterAll(async () => {
    if (createdAllocationIds.length > 0) {
      await prisma.paymentAllocation.deleteMany({
        where: { id: { in: createdAllocationIds } },
      });
    }
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({
        where: { id: { in: createdPaymentIds } },
      });
    }
    if (createdInvoiceIds.length > 0) {
      await prisma.dailyStayInvoiceItem.deleteMany({
        where: { invoiceId: { in: createdInvoiceIds } },
      });
      await prisma.dailyStayInvoice.deleteMany({
        where: { id: { in: createdInvoiceIds } },
      });
    }
    await prisma.$disconnect();
  });

  it('1. Old monthly payment rows remain valid and have bill_id populated', async () => {
    const existingMonthlyPayments = await prisma.payment.findMany({
      where: { billId: { not: null } },
      take: 5,
    });
    expect(existingMonthlyPayments.length).toBeGreaterThan(0);
    for (const p of existingMonthlyPayments) {
      expect(p.billId).toBeTruthy();
      expect(p.dailyStayInvoiceId).toBeNull();
    }
  });

  it('2. Payment with neither target (both bill_id and daily_stay_invoice_id null) is rejected by DB XOR constraint', async () => {
    await expect(
      prisma.payment.create({
        data: {
          dormitoryId: testDormitory.id,
          amount: new Decimal('500.00'),
          method: 'CASH',
          status: 'APPROVED',
          billId: null,
          dailyStayInvoiceId: null,
        },
      })
    ).rejects.toThrow(/payments_target_xor_check/);
  });

  it('3. Payment with both targets (both bill_id and daily_stay_invoice_id non-null) is rejected by DB XOR constraint', async () => {
    await expect(
      prisma.payment.create({
        data: {
          dormitoryId: testDormitory.id,
          amount: new Decimal('500.00'),
          method: 'CASH',
          status: 'APPROVED',
          billId: testBill.id,
          dailyStayInvoiceId: testDailyInvoice.id,
        },
      })
    ).rejects.toThrow(/payments_target_xor_check/);
  });

  it('4. Monthly-only target succeeds', async () => {
    const payment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('100.00'),
        method: 'CASH',
        status: 'APPROVED',
        billId: testBill.id,
        dailyStayInvoiceId: null,
      },
    });
    createdPaymentIds.push(payment.id);
    expect(payment.id).toBeDefined();
    expect(payment.billId).toBe(testBill.id);
    expect(payment.dailyStayInvoiceId).toBeNull();
  });

  it('5. Daily-only target succeeds', async () => {
    const payment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('200.00'),
        method: 'BANK_TRANSFER',
        status: 'APPROVED',
        billId: null,
        dailyStayInvoiceId: testDailyInvoice.id,
      },
    });
    createdPaymentIds.push(payment.id);
    expect(payment.id).toBeDefined();
    expect(payment.billId).toBeNull();
    expect(payment.dailyStayInvoiceId).toBe(testDailyInvoice.id);
    expect(payment.method).toBe('BANK_TRANSFER');
  });

  it('6. PaymentAllocation XOR constraint enforces exactly one target and supports Daily item allocation', async () => {
    const dailyPayment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('300.00'),
        method: 'CASH',
        status: 'APPROVED',
        billId: null,
        dailyStayInvoiceId: testDailyInvoice.id,
      },
    });
    createdPaymentIds.push(dailyPayment.id);

    // Allocation with neither target rejected
    await expect(
      prisma.paymentAllocation.create({
        data: {
          dormitoryId: testDormitory.id,
          paymentId: dailyPayment.id,
          allocatedAmount: new Decimal('300.00'),
          allocationOrder: 1,
          billId: null,
          dailyStayInvoiceId: null,
        },
      })
    ).rejects.toThrow(/(payment_allocations_target_xor_check|payment_allocations_cross_family_check)/);

    // Allocation with both targets rejected
    await expect(
      prisma.paymentAllocation.create({
        data: {
          dormitoryId: testDormitory.id,
          paymentId: dailyPayment.id,
          allocatedAmount: new Decimal('300.00'),
          allocationOrder: 1,
          billId: testBill.id,
          dailyStayInvoiceId: testDailyInvoice.id,
        },
      })
    ).rejects.toThrow(/(payment_allocations_target_xor_check|payment_allocations_cross_family_check)/);

    // Daily allocation succeeds
    const alloc = await prisma.paymentAllocation.create({
      data: {
        dormitoryId: testDormitory.id,
        paymentId: dailyPayment.id,
        dailyStayInvoiceId: testDailyInvoice.id,
        dailyStayInvoiceItemId: testDailyItem.id,
        allocatedAmount: new Decimal('300.00'),
        allocationOrder: 1,
        billId: null,
      },
    });
    createdAllocationIds.push(alloc.id);
    expect(alloc.id).toBeDefined();
    expect(alloc.dailyStayInvoiceId).toBe(testDailyInvoice.id);
    expect(alloc.dailyStayInvoiceItemId).toBe(testDailyItem.id);
  });

  it('7. Cross-dormitory daily stay settlement is rejected by canonical service', async () => {
    const otherDormitory = await prisma.dormitory.findFirst({
      where: { id: { not: testDormitory.id } },
    });
    if (otherDormitory) {
      const { dailyStayService } = await import('../../services/daily-stay.service.js');
      await expect(
        dailyStayService.settleDailyStayInvoiceItem(
          otherDormitory.id,
          testDailyInvoice.id,
          'ALL',
          null,
          {
            method: 'CASH',
            idempotencyKey: `idem-cross-dorm-${Date.now()}`,
          }
        )
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'INVOICE_NOT_FOUND',
      });
    }
  });

  it('8. Allocation linking invoice A with an item belonging to invoice B is rejected', async () => {
    let invoiceBItem = await prisma.dailyStayInvoiceItem.findFirst({
      where: { invoiceId: { not: testDailyInvoice.id } },
    });
    if (!invoiceBItem) {
      const room = await prisma.room.findFirst({ where: { dormitoryId: testDormitory.id } });
      const dummyStay = await prisma.dailyStay.create({
        data: {
          dormitoryId: testDormitory.id,
          roomId: room!.id,
          applicantFullName: 'Dummy Daily Tenant B',
          checkInDate: new Date(),
          checkOutDate: new Date(),
          totalRentAmount: new Decimal('500.00'),
          depositAmount: new Decimal('0.00'),
          totalAgreedAmount: new Decimal('500.00'),
          status: 'APPROVED',
        },
      });
      const otherInvoice = await prisma.dailyStayInvoice.create({
        data: {
          dormitoryId: testDormitory.id,
          dailyStayId: dummyStay.id,
          invoiceNumber: `DINV-DUMMY-${Date.now().toString().slice(-6)}`,
          totalRentAmount: new Decimal('500.00'),
          depositAmount: new Decimal('0.00'),
          totalAgreedAmount: new Decimal('500.00'),
          outstandingAmount: new Decimal('500.00'),
          status: 'ISSUED',
          items: {
            create: [
              {
                itemType: 'DAILY_RENT',
                description: 'Item of Invoice B',
                amount: new Decimal('500.00'),
                status: 'OUTSTANDING',
              },
            ],
          },
        },
        include: { items: true },
      });
      createdInvoiceIds.push(otherInvoice.id);
      invoiceBItem = otherInvoice.items[0];
    }
    expect(invoiceBItem).toBeDefined();

    const payment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('200.00'),
        method: 'CASH',
        status: 'APPROVED',
        billId: null,
        dailyStayInvoiceId: testDailyInvoice.id,
      },
    });
    createdPaymentIds.push(payment.id);

    // Now verify generateFinalSettlementReceiptForDailyInvoiceInTx rejects when allocation item belongs to another invoice
    const badAlloc = await prisma.paymentAllocation.create({
      data: {
        dormitoryId: testDormitory.id,
        paymentId: payment.id,
        dailyStayInvoiceId: testDailyInvoice.id,
        dailyStayInvoiceItemId: invoiceBItem.id, // Mismatched: item belongs to otherInvoice!
        allocatedAmount: new Decimal('200.00'),
        allocationOrder: 1,
        billId: null,
        billItemId: null,
      },
    });
    createdAllocationIds.push(badAlloc.id);

    const { generateFinalSettlementReceiptForDailyInvoiceInTx } = await import('../../utils/payment-transaction.util.js');
    const result = await prisma.$transaction(async (tx) => {
      return await generateFinalSettlementReceiptForDailyInvoiceInTx(tx, {
        dormitoryId: testDormitory.id,
        dailyStayInvoiceId: testDailyInvoice.id,
      });
    });
    expect(result).toBeNull();
  });

  it('9. Daily allocation with billItemId is rejected by DB cross-family check constraint', async () => {
    const dailyPayment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('100.00'),
        method: 'CASH',
        status: 'APPROVED',
        billId: null,
        dailyStayInvoiceId: testDailyInvoice.id,
      },
    });
    createdPaymentIds.push(dailyPayment.id);

    let billItem = await prisma.billItem.findFirst({
      where: { billId: testBill.id },
    });
    if (!billItem) {
      billItem = await prisma.billItem.findFirst();
    }
    expect(billItem).toBeDefined();

    await expect(
      prisma.paymentAllocation.create({
        data: {
          dormitoryId: testDormitory.id,
          paymentId: dailyPayment.id,
          dailyStayInvoiceId: testDailyInvoice.id,
          dailyStayInvoiceItemId: testDailyItem.id,
          billItemId: billItem!.id, // Illegal cross-family item reference!
          allocatedAmount: new Decimal('100.00'),
          billId: null,
        },
      })
    ).rejects.toThrow();
  });

  it('10. Monthly allocation with dailyStayInvoiceItemId is rejected by DB cross-family check constraint', async () => {
    const monthlyPayment = await prisma.payment.create({
      data: {
        dormitoryId: testDormitory.id,
        amount: new Decimal('100.00'),
        method: 'CASH',
        status: 'APPROVED',
        billId: testBill.id,
        dailyStayInvoiceId: null,
      },
    });
    createdPaymentIds.push(monthlyPayment.id);

    await expect(
      prisma.paymentAllocation.create({
        data: {
          dormitoryId: testDormitory.id,
          paymentId: monthlyPayment.id,
          billId: testBill.id,
          dailyStayInvoiceItemId: testDailyItem.id, // Illegal cross-family item reference!
          allocatedAmount: new Decimal('100.00'),
          dailyStayInvoiceId: null,
        },
      })
    ).rejects.toThrow();
  });
});
