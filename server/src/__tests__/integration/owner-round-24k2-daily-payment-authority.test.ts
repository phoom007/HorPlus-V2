import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Decimal from 'decimal.js';
import { DailyStayService } from '../../services/daily-stay.service.js';
import { generateFinalSettlementReceiptForDailyInvoiceInTx } from '../../utils/payment-transaction.util.js';
import { renderReceiptHtml } from '../../utils/receipt-html.util.js';

describe('Round 2.4K.2: Daily Stay Payment Authority & Final Receipt Proof', () => {
  let prisma: PrismaClient;
  let dailyStayService: DailyStayService;
  let testDormitory: any;
  let testRoom: any;
  let testTenant: any;
  let createdInvoiceIds: string[] = [];
  let createdStayIds: string[] = [];
  let createdRoomIds: string[] = [];
  let createdTenantIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    dailyStayService = new DailyStayService();

    testDormitory = await prisma.dormitory.findFirst({
      where: { name: 'Comprehensive Dormitory' },
    });
    if (!testDormitory) {
      testDormitory = await prisma.dormitory.findFirst();
    }
    expect(testDormitory).toBeDefined();

    const building = await prisma.building.findFirst({
      where: { dormitoryId: testDormitory.id },
    });

    const rNum = `D24K2-${Date.now().toString().slice(-5)}`;
    testRoom = await prisma.room.create({
      data: {
        dormitoryId: testDormitory.id,
        buildingId: building?.id,
        roomNumber: rNum,
        normalizedRoomNumber: rNum.toLowerCase(),
        floor: 99,
        monthlyRent: 2000,
        dailyRent: 500,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'vacant',
      },
    });
    createdRoomIds.push(testRoom.id);

    testTenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitory.id,
        tenantNumber: `TNT-${Date.now().toString().slice(-6)}`,
        firstName: 'ทดสอบ',
        lastName: 'เดลี่',
        displayName: 'ทดสอบ เดลี่',
        status: 'active',
      },
    });
    createdTenantIds.push(testTenant.id);
  });

  afterAll(async () => {
    for (const invId of createdInvoiceIds) {
      await prisma.receipt.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.paymentAllocation.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.payment.deleteMany({ where: { dailyStayInvoiceId: invId } });
      await prisma.dailyStayInvoiceItem.deleteMany({ where: { invoiceId: invId } });
      await prisma.dailyStayInvoice.deleteMany({ where: { id: invId } });
    }
    for (const stayId of createdStayIds) {
      await prisma.dailyStay.deleteMany({ where: { id: stayId } });
    }
    for (const rId of createdRoomIds) {
      await prisma.room.deleteMany({ where: { id: rId } });
    }
    for (const tId of createdTenantIds) {
      await prisma.tenant.deleteMany({ where: { id: tId } });
    }
    await prisma.$disconnect();
  });

  it('A. Daily cash settlement -> canonical event CASH -> Final Receipt เงินสด', async () => {
    // 1. Create a daily stay with daily rent 800 and deposit 0
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-02'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('800.00'),
        totalRentAmount: new Decimal('800.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-A-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('800.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('800.00'),
        outstandingAmount: new Decimal('800.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('800.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // 2. Settle via CASH
    const idempKey = `idemp-daily-cash-${Date.now()}`;
    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: idempKey }
    );

    expect(res.status).toBe('PAID');
    expect(Number(res.outstandingAmount)).toBe(0);

    // 3. Verify Payment row
    const payment = await prisma.payment.findFirst({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(payment).toBeDefined();
    expect(payment?.method).toBe('CASH');
    expect(payment?.status).toBe('APPROVED');
    expect(Number(payment?.amount)).toBe(800);

    // 4. Verify Final Receipt
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeDefined();
    const snapshot: any = receipt?.snapshotData;
    expect(snapshot.paymentMethod).toBe('CASH');
    expect(snapshot.paymentEvents.length).toBe(1);
    expect(snapshot.paymentEvents[0].method).toBe('CASH');

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('ช่องทางชำระเงิน:');
    expect(html).toContain('เงินสด');
    expect(html).not.toContain('โอนเงิน');
  });

  it('B. Daily bank-transfer confirmation -> canonical event BANK_TRANSFER -> Final Receipt โอนเงิน', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-05'),
        endDate: new Date('2026-08-06'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('1000.00'),
        totalRentAmount: new Decimal('1000.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-B-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('1000.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('1000.00'),
        outstandingAmount: new Decimal('1000.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('1000.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // Settle via BANK_TRANSFER
    const idempKey = `idemp-daily-transfer-${Date.now()}`;
    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'BANK_TRANSFER', idempotencyKey: idempKey }
    );

    expect(res.status).toBe('PAID');

    // Verify Payment row
    const payment = await prisma.payment.findFirst({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(payment?.method).toBe('BANK_TRANSFER');

    // Verify Final Receipt
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    const snapshot: any = receipt?.snapshotData;
    expect(snapshot.paymentMethod).toBe('BANK_TRANSFER');

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('ช่องทางชำระเงิน:');
    expect(html).toContain('โอนเงิน');
  });

  it('C. Daily mixed: CASH + BANK_TRANSFER -> two real events preserved -> Final Receipt presentation เงินสด / โอนเงิน', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-10'),
        endDate: new Date('2026-08-12'),
        inclusiveDayCount: 2,
        dailyRateAmount: new Decimal('600.00'),
        totalRentAmount: new Decimal('1200.00'),
        depositAmount: new Decimal('500.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-C-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('1200.00'),
        depositAmount: new Decimal('500.00'),
        totalAgreedAmount: new Decimal('1700.00'),
        outstandingAmount: new Decimal('1700.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DEPOSIT',
              description: 'เงินประกันห้องพักรายวัน',
              amount: new Decimal('500.00'),
              status: 'OUTSTANDING',
            },
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('1200.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // 1. Settle Deposit via BANK_TRANSFER
    await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DEPOSIT',
      undefined,
      { method: 'BANK_TRANSFER', idempotencyKey: `idemp-c1-${Date.now()}` }
    );

    // 2. Settle Rent via CASH
    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: `idemp-c2-${Date.now()}` }
    );

    expect(res.status).toBe('PAID');

    // Check two distinct real payment events exist in DB
    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.length).toBe(2);
    expect(payments[0].method).toBe('BANK_TRANSFER');
    expect(Number(payments[0].amount)).toBe(500);
    expect(payments[1].method).toBe('CASH');
    expect(Number(payments[1].amount)).toBe(1200);

    // Verify Final Receipt has both events and presentation contains both
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeDefined();
    const snapshot: any = receipt?.snapshotData;
    expect(snapshot.paymentMethod).toBe('CASH, BANK_TRANSFER');
    expect(snapshot.paymentEvents.length).toBe(2);

    const html = renderReceiptHtml(receipt);
    expect(html).toMatch(/เงินสด \/ โอนเงิน|โอนเงิน \/ เงินสด/);
  });

  it('D. Tenant DECLARED_PAID without owner-confirmed method -> no fabricated CASH -> Final Receipt not generated', async () => {
    // Create dedicated vacant room for D
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-D-${Date.now().toString().slice(-5)}`;
    const roomD = await prisma.room.create({
      data: {
        dormitoryId: testDormitory.id,
        buildingId: building?.id,
        roomNumber: rNum,
        normalizedRoomNumber: rNum.toLowerCase(),
        floor: 99,
        monthlyRent: 2000,
        dailyRent: 500,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'vacant',
      },
    });
    createdRoomIds.push(roomD.id);

    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: roomD.id,
        tenantId: testTenant.id,
        requestSource: 'TENANT',
        startDate: new Date('2026-09-20'),
        endDate: new Date('2026-09-21'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('0.00'),
        totalRentAmount: new Decimal('0.00'),
        depositAmount: new Decimal('500.00'),
        depositDeclaredStatus: 'PAID', // Tenant says paid!
        status: 'PENDING_APPROVAL',
      },
    });
    createdStayIds.push(stay.id);

    // Approve the stay
    const approvedStay = await dailyStayService.approveDailyStay(
      testDormitory.id,
      stay.id,
      '00000000-0000-0000-0000-000000000001'
    );
    expect(['ACTIVE', 'RESERVED']).toContain(approvedStay.status);

    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { dailyStayId: stay.id },
      include: { items: true },
    });
    expect(invoice).toBeDefined();
    createdInvoiceIds.push(invoice!.id);

    // Verify item is DECLARED_PAID, but NO Payment record was fabricated!
    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice!.id },
    });
    expect(payments.length).toBe(0);

    // Verify NO Final Receipt was fabricated!
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice!.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeNull();
  });

  it('E. Owner Quick Add positive deposit declared PAID without method -> fails closed with validation error', async () => {
    // Create dedicated room for E
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-E-${Date.now().toString().slice(-5)}`;
    const roomE = await prisma.room.create({
      data: {
        dormitoryId: testDormitory.id,
        buildingId: building?.id,
        roomNumber: rNum,
        normalizedRoomNumber: rNum.toLowerCase(),
        floor: 99,
        monthlyRent: 2000,
        dailyRent: 500,
        termDeposit: new Decimal('0.00'),
        monthlyDeposit: new Decimal('0.00'),
        dailyDeposit: new Decimal('0.00'),
        status: 'vacant',
      },
    });
    createdRoomIds.push(roomE.id);

    await expect(
      dailyStayService.ownerQuickAddDailyStay(
        testDormitory.id,
        {
          roomId: roomE.id,
          fullName: 'ทดสอบ ไม่ระบุวิธีชำระ',
          startDate: '2026-10-10',
          endDate: '2026-10-11',
          dailyRateAmount: 500,
          depositAmount: 1000,
          depositDeclaredStatus: 'PAID',
          depositPaymentMethod: undefined, // MISSING METHOD!
        },
        '00000000-0000-0000-0000-000000000001'
      )
    ).rejects.toThrow(/กรุณาระบุช่องทางการชำระเงินประกัน/);
  });

  it('F. Positive obligation with paidAt but no method -> fail closed; no fabricated historical Final Receipt', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-15'),
        endDate: new Date('2026-08-16'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('700.00'),
        totalRentAmount: new Decimal('700.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    // Historical record with SETTLED items and paidAt, but zero Payment records!
    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-HIST-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('700.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('700.00'),
        outstandingAmount: new Decimal('0.00'),
        status: 'SETTLED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน (ประวัติเก่า)',
              amount: new Decimal('700.00'),
              status: 'SETTLED',
              paidAt: new Date('2026-07-01'),
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // Attempting to generate Final Receipt on historical record without Payment method fails closed
    await expect(
      prisma.$transaction(async (tx) => {
        await generateFinalSettlementReceiptForDailyInvoiceInTx(tx, {
          dormitoryId: testDormitory.id,
          dailyStayInvoiceId: invoice.id,
        });
      })
    ).rejects.toThrow(/Approved Payment event lacks a valid canonical payment method/);
  });

  it('G. All-zero obligation -> no Payment -> no Final Receipt', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-02'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('0.00'),
        totalRentAmount: new Decimal('0.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-ZERO-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('0.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('0.00'),
        outstandingAmount: new Decimal('0.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'พักฟรี',
              amount: new Decimal('0.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT'
    );

    expect(res.status).toBe('PAID');

    // No Payment created
    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(payments.length).toBe(0);

    // No Final Receipt created
    const receipts = await prisma.receipt.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(receipts.length).toBe(0);
  });

  it('H. Idempotent retry -> same logical Payment result -> no duplicate Payment or allocation', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-02'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('500.00'),
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-IDEMP-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('500.00'),
        outstandingAmount: new Decimal('500.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('500.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    const fixedIdempKey = `idemp-fixed-daily-${Date.now()}`;

    // Call 1
    const res1 = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: fixedIdempKey }
    );
    expect(res1.status).toBe('PAID');

    const paymentsAfterCall1 = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    const allocationsAfterCall1 = await prisma.paymentAllocation.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(paymentsAfterCall1.length).toBe(1);
    expect(allocationsAfterCall1.length).toBe(1);

    // Call 2: Replay with SAME idempotency key
    const res2 = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: fixedIdempKey }
    );
    expect(res2.status).toBe('PAID');

    const paymentsAfterCall2 = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    const allocationsAfterCall2 = await prisma.paymentAllocation.findMany({
      where: { dailyStayInvoiceId: invoice.id },
    });
    expect(paymentsAfterCall2.length).toBe(1);
    expect(allocationsAfterCall2.length).toBe(1);
    expect(paymentsAfterCall2[0].id).toBe(paymentsAfterCall1[0].id);
  });
});
