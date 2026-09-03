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

  it('C. Settle daily stay with missing method on positive obligation -> 400 CANONICAL_PAYMENT_METHOD_MISSING, no payment, no allocation, no receipt', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-10'),
        endDate: new Date('2026-08-11'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('600.00'),
        totalRentAmount: new Decimal('600.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-C-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('600.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('600.00'),
        outstandingAmount: new Decimal('600.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('600.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // Call without method
    await expect(
      dailyStayService.settleDailyStayInvoiceItem(
        testDormitory.id,
        invoice.id,
        'DAILY_RENT',
        undefined,
        { method: undefined as any, idempotencyKey: `idem-c-${Date.now()}` }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'CANONICAL_PAYMENT_METHOD_MISSING',
    });

    // Verify no payment, no allocation, no receipt
    const payments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const allocs = await prisma.paymentAllocation.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const receipts = await prisma.receipt.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    expect(payments.length).toBe(0);
    expect(allocs.length).toBe(0);
    expect(receipts.length).toBe(0);
  });

  it('D. Settle daily stay with positive obligation and missing x-idempotency-key -> 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-10'),
        endDate: new Date('2026-08-11'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('600.00'),
        totalRentAmount: new Decimal('600.00'),
        depositAmount: new Decimal('0.00'),
        status: 'ACTIVE',
      },
    });
    createdStayIds.push(stay.id);

    const invoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId: testDormitory.id,
        dailyStayId: stay.id,
        invoiceNumber: `DINV-D-${Date.now().toString().slice(-6)}`,
        totalRentAmount: new Decimal('600.00'),
        depositAmount: new Decimal('0.00'),
        totalAgreedAmount: new Decimal('600.00'),
        outstandingAmount: new Decimal('600.00'),
        status: 'ISSUED',
        items: {
          create: [
            {
              itemType: 'DAILY_RENT',
              description: 'ค่าเช่าห้องพักรายวัน',
              amount: new Decimal('600.00'),
              status: 'OUTSTANDING',
            },
          ],
        },
      },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice.id);

    // Call without idempotencyKey
    await expect(
      dailyStayService.settleDailyStayInvoiceItem(
        testDormitory.id,
        invoice.id,
        'DAILY_RENT',
        undefined,
        { method: 'CASH', idempotencyKey: undefined as any }
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });

    const payments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    expect(payments.length).toBe(0);
  });

  it('E. Replay settle daily stay with same idempotency key -> returns idempotent result without duplicate payment or double receipt', async () => {
    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: testRoom.id,
        tenantId: testTenant.id,
        startDate: new Date('2026-08-10'),
        endDate: new Date('2026-08-11'),
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
        invoiceNumber: `DINV-E-${Date.now().toString().slice(-6)}`,
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

    const fixedIdempKey = `idemp-replay-e-${Date.now()}`;

    // Call 1
    const res1 = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: fixedIdempKey }
    );
    expect(res1.status).toBe('PAID');

    const paymentsCall1 = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const allocsCall1 = await prisma.paymentAllocation.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const receiptsCall1 = await prisma.receipt.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    expect(paymentsCall1.length).toBe(1);
    expect(allocsCall1.length).toBe(1);
    expect(receiptsCall1.length).toBe(1);

    // Call 2: Replay with same idempotencyKey
    const res2 = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: fixedIdempKey }
    );
    expect(res2.status).toBe('PAID');

    const paymentsCall2 = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const allocsCall2 = await prisma.paymentAllocation.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const receiptsCall2 = await prisma.receipt.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    expect(paymentsCall2.length).toBe(1);
    expect(allocsCall2.length).toBe(1);
    expect(receiptsCall2.length).toBe(1);
    expect(paymentsCall2[0].id).toBe(paymentsCall1[0].id);
  });

  it('F. Tenant registers daily with deposit PAID -> DailyStayInvoice created with deposit item DECLARED_PAID, invoice status ISSUED, outstandingAmount == totalAgreed, paidAt == null, NO Payment, NO Final Receipt', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-F-${Date.now().toString().slice(-5)}`;
    const roomF = await prisma.room.create({
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
    createdRoomIds.push(roomF.id);

    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: roomF.id,
        tenantId: testTenant.id,
        requestSource: 'TENANT',
        startDate: new Date('2026-09-20'),
        endDate: new Date('2026-09-21'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('500.00'),
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('500.00'),
        depositDeclaredStatus: 'PAID', // Tenant unconfirmed declaration
        status: 'PENDING_APPROVAL',
      },
    });
    createdStayIds.push(stay.id);

    await dailyStayService.approveDailyStay(
      testDormitory.id,
      stay.id,
      '00000000-0000-0000-0000-000000000001'
    );

    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { dailyStayId: stay.id },
      include: { items: true },
    });
    expect(invoice).toBeDefined();
    createdInvoiceIds.push(invoice!.id);

    // Amendment 2 & 5:
    expect(invoice!.status).toBe('ISSUED');
    expect(Number(invoice!.outstandingAmount)).toBe(1000); // 500 rent + 500 deposit = 1000 totalAgreed!
    expect(Number(invoice!.totalAgreedAmount)).toBe(1000);

    const depositItem = invoice!.items.find((it) => it.itemType === 'DEPOSIT');
    expect(depositItem).toBeDefined();
    expect(depositItem?.status).toBe('DECLARED_PAID');
    expect(depositItem?.paidAt).toBeNull();

    // NO Payment row
    const payments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice!.id } });
    expect(payments.length).toBe(0);

    // NO Final Receipt
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice!.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeNull();
  });

  it('G. Invoice with deposit DECLARED_PAID and rent settled CASH -> remaining outstanding == deposit amount, cannot produce Final Receipt', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-G-${Date.now().toString().slice(-5)}`;
    const roomG = await prisma.room.create({
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
    createdRoomIds.push(roomG.id);

    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: roomG.id,
        tenantId: testTenant.id,
        requestSource: 'TENANT',
        startDate: new Date('2026-09-22'),
        endDate: new Date('2026-09-23'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('500.00'),
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('500.00'),
        depositDeclaredStatus: 'PAID',
        status: 'PENDING_APPROVAL',
      },
    });
    createdStayIds.push(stay.id);

    await dailyStayService.approveDailyStay(
      testDormitory.id,
      stay.id,
      '00000000-0000-0000-0000-000000000001'
    );

    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { dailyStayId: stay.id },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice!.id);

    // Settle Rent item via CASH
    const res = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice!.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: `idem-g-rent-${Date.now()}` }
    );

    // Outstanding must remain 500 (deposit amount)
    expect(Number(res.outstandingAmount)).toBe(500);
    expect(res.status).toBe('PARTIALLY_PAID'); // Deposit remains unconfirmed, cannot be PAID!

    // Cannot produce Final Receipt because deposit is not settled
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice!.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeNull();
  });

  it('H. Confirm deposit via BANK_TRANSFER after (G) -> both items SETTLED, remaining outstanding == 0, Final Receipt produced with both payments/methods', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-H-${Date.now().toString().slice(-5)}`;
    const roomH = await prisma.room.create({
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
    createdRoomIds.push(roomH.id);

    const stay = await prisma.dailyStay.create({
      data: {
        dormitoryId: testDormitory.id,
        roomId: roomH.id,
        tenantId: testTenant.id,
        requestSource: 'TENANT',
        startDate: new Date('2026-09-24'),
        endDate: new Date('2026-09-25'),
        inclusiveDayCount: 1,
        dailyRateAmount: new Decimal('500.00'),
        totalRentAmount: new Decimal('500.00'),
        depositAmount: new Decimal('500.00'),
        depositDeclaredStatus: 'PAID',
        status: 'PENDING_APPROVAL',
      },
    });
    createdStayIds.push(stay.id);

    await dailyStayService.approveDailyStay(
      testDormitory.id,
      stay.id,
      '00000000-0000-0000-0000-000000000001'
    );

    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { dailyStayId: stay.id },
      include: { items: true },
    });
    createdInvoiceIds.push(invoice!.id);

    // 1. Settle Rent via CASH
    await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice!.id,
      'DAILY_RENT',
      undefined,
      { method: 'CASH', idempotencyKey: `idem-h-rent-${Date.now()}` }
    );

    // 2. Settle Deposit via BANK_TRANSFER
    const resFinal = await dailyStayService.settleDailyStayInvoiceItem(
      testDormitory.id,
      invoice!.id,
      'DEPOSIT',
      undefined,
      { method: 'BANK_TRANSFER', idempotencyKey: `idem-h-dep-${Date.now()}` }
    );

    expect(Number(resFinal.outstandingAmount)).toBe(0);
    expect(resFinal.status).toBe('PAID');

    // Verify 2 payments exist with respective methods
    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: invoice!.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(payments.length).toBe(2);
    expect(payments[0].method).toBe('CASH');
    expect(payments[1].method).toBe('BANK_TRANSFER');

    // Verify Final Receipt was generated with both events
    const receipt = await prisma.receipt.findFirst({
      where: { dailyStayInvoiceId: invoice!.id, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(receipt).toBeDefined();
    const snapshot: any = receipt?.snapshotData;
    expect(snapshot.paymentMethod).toBe('CASH, BANK_TRANSFER');
    expect(snapshot.paymentEvents.length).toBe(2);

    const html = renderReceiptHtml(receipt);
    expect(html).toContain('เงินสด / โอนเงิน');
  });

  it('I. Quick Add Daily with deposit > 0 and depositDeclaredStatus == PAID + depositPaymentMethod == CASH -> creates DailyStay, Invoice, deposit item SETTLED, Payment(CASH, APPROVED), PaymentAllocation(deposit item), idempotencyKey respected', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-I-${Date.now().toString().slice(-5)}`;
    const roomI = await prisma.room.create({
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
    createdRoomIds.push(roomI.id);

    const opKey = `quick-add-i-${Date.now()}`;

    const res = await dailyStayService.ownerQuickAddDailyStay(
      testDormitory.id,
      {
        roomId: roomI.id,
        fullName: 'ทดสอบ Quick Add เงินสด',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        dailyRateAmount: 500,
        depositAmount: 300,
        depositDeclaredStatus: 'PAID',
        depositPaymentMethod: 'CASH',
      },
      '00000000-0000-0000-0000-000000000001',
      opKey
    );

    createdStayIds.push(res.id);
    createdInvoiceIds.push(res.invoice.id);

    expect(res.id).toBeDefined();
    expect(res.invoice).toBeDefined();

    // Check deposit item status is SETTLED
    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { id: res.invoice.id },
      include: { items: true },
    });
    const depItem = invoice?.items.find((it) => it.itemType === 'DEPOSIT');
    expect(depItem?.status).toBe('SETTLED');

    // Check Payment
    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: res.invoice.id },
    });
    expect(payments.length).toBe(1);
    expect(payments[0].method).toBe('CASH');
    expect(payments[0].status).toBe('APPROVED');
    expect(payments[0].idempotencyKey).toBe(`${opKey}:dep`);

    // Check PaymentAllocation
    const allocs = await prisma.paymentAllocation.findMany({
      where: { paymentId: payments[0].id },
    });
    expect(allocs.length).toBe(1);
    expect(allocs[0].dailyStayInvoiceItemId).toBe(depItem?.id);
    expect(allocs[0].billItemId).toBeNull();
    expect(allocs[0].billId).toBeNull();

    // Replay Quick Add with same idempotencyKey returns cached result
    const resReplay = await dailyStayService.ownerQuickAddDailyStay(
      testDormitory.id,
      {
        roomId: roomI.id,
        fullName: 'ทดสอบ Quick Add เงินสด',
        startDate: '2026-10-01',
        endDate: '2026-10-02',
        dailyRateAmount: 500,
        depositAmount: 300,
        depositDeclaredStatus: 'PAID',
        depositPaymentMethod: 'CASH',
      },
      '00000000-0000-0000-0000-000000000001',
      opKey
    );
    expect(resReplay.id).toBe(res.id);
    const paymentsAfterReplay = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: res.invoice.id },
    });
    expect(paymentsAfterReplay.length).toBe(1);
  });

  it('J. Quick Add Daily with deposit > 0 and depositDeclaredStatus == PAID + depositPaymentMethod == BANK_TRANSFER -> creates DailyStay, Invoice, deposit item SETTLED, Payment(BANK_TRANSFER, APPROVED), PaymentAllocation(deposit item)', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-J-${Date.now().toString().slice(-5)}`;
    const roomJ = await prisma.room.create({
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
    createdRoomIds.push(roomJ.id);

    const res = await dailyStayService.ownerQuickAddDailyStay(
      testDormitory.id,
      {
        roomId: roomJ.id,
        fullName: 'ทดสอบ Quick Add โอนเงิน',
        startDate: '2026-10-05',
        endDate: '2026-10-06',
        dailyRateAmount: 500,
        depositAmount: 400,
        depositDeclaredStatus: 'PAID',
        depositPaymentMethod: 'BANK_TRANSFER',
      },
      '00000000-0000-0000-0000-000000000001',
      `quick-add-j-${Date.now()}`
    );

    createdStayIds.push(res.id);
    createdInvoiceIds.push(res.invoice.id);

    const invoice = await prisma.dailyStayInvoice.findUnique({
      where: { id: res.invoice.id },
      include: { items: true },
    });
    const depItem = invoice?.items.find((it) => it.itemType === 'DEPOSIT');
    expect(depItem?.status).toBe('SETTLED');

    const payments = await prisma.payment.findMany({
      where: { dailyStayInvoiceId: res.invoice.id },
    });
    expect(payments.length).toBe(1);
    expect(payments[0].method).toBe('BANK_TRANSFER');
    expect(payments[0].status).toBe('APPROVED');

    const allocs = await prisma.paymentAllocation.findMany({
      where: { paymentId: payments[0].id },
    });
    expect(allocs.length).toBe(1);
    expect(allocs[0].dailyStayInvoiceItemId).toBe(depItem?.id);
  });

  it('K. Quick Add Daily with deposit > 0 and depositDeclaredStatus == PAID with missing/empty payment method -> rejected, no stay created', async () => {
    const building = await prisma.building.findFirst({ where: { dormitoryId: testDormitory.id } });
    const rNum = `D24K2-K-${Date.now().toString().slice(-5)}`;
    const roomK = await prisma.room.create({
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
    createdRoomIds.push(roomK.id);

    await expect(
      dailyStayService.ownerQuickAddDailyStay(
        testDormitory.id,
        {
          roomId: roomK.id,
          fullName: 'ทดสอบ ไม่มีวิธีชำระ',
          startDate: '2026-10-15',
          endDate: '2026-10-16',
          dailyRateAmount: 500,
          depositAmount: 500,
          depositDeclaredStatus: 'PAID',
          depositPaymentMethod: undefined,
        },
        '00000000-0000-0000-0000-000000000001'
      )
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'CANONICAL_PAYMENT_METHOD_MISSING',
    });

    const stays = await prisma.dailyStay.findMany({ where: { roomId: roomK.id } });
    expect(stays.length).toBe(0);
  });

  it('L. Zero obligations remain settlable without payment/receipt', async () => {
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
        invoiceNumber: `DINV-ZERO-L-${Date.now().toString().slice(-6)}`,
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

    // Zero obligations: no Payment created, no Final Receipt created
    const payments = await prisma.payment.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    const receipts = await prisma.receipt.findMany({ where: { dailyStayInvoiceId: invoice.id } });
    expect(payments.length).toBe(0);
    expect(receipts.length).toBe(0);
  });
});
