import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { ReceiptService } from '../../services/receipt.service.js';
import { DailyStayService } from '../../services/daily-stay.service.js';
import { PaymentService } from '../../services/payment.service.js';
import { generateFinalSettlementReceiptForBillInTx } from '../../utils/payment-transaction.util.js';

describe('Owner Round 2.4I.2 / A1: Authoritative Final Settlement Receipt Authority & Real Production Proofs', () => {
  const prisma = getPrismaClient();
  const receiptService = new ReceiptService();
  const dailyStayService = new DailyStayService(prisma);
  const paymentService = new PaymentService(prisma);

  let dormitoryId: string;
  let ownerUserId: string;
  let buildingId: string;
  let cycle1Id: string;
  let cycle2Id: string;
  let room104Id: string;
  let room105Id: string;
  let tenantId: string;

  beforeAll(async () => {
    // 1. Create Owner User
    const ownerEmail = `owner-24i2-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-24i2-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 2.4I.2 Final Receipt Auth',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักทดสอบ 2.4I.2 ${Date.now()}`,
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    // 3. Create Building & Rooms
    const bld = await prisma.building.create({
      data: {
        dormitoryId,
        name: 'อาคาร A',
        code: 'A',
      },
    });
    buildingId = bld.id;

    const createRoom = async (num: string) => {
      return await prisma.room.create({
        data: {
          dormitoryId,
          buildingId: bld.id,
          roomNumber: num,
          normalizedRoomNumber: num,
          floor: 1,
          roomType: 'standard',
          status: 'occupied',
          monthlyRent: 4000.0,
          termRent: 20000.0,
          termMonths: 5,
          dailyRent: 800.0,
          depositAmount: 500.0,
          monthlyDeposit: 500.0,
          termDeposit: 500.0,
          dailyDeposit: 300.0,
        },
      });
    };

    const room104 = await createRoom('104');
    const room105 = await createRoom('105');
    room104Id = room104.id;
    room105Id = room105.id;

    // 4. Create Tenant
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T-${Date.now().toString().slice(-6)}`,
        firstName: 'คุณสมศักดิ์',
        lastName: 'ชำระจริง',
        displayName: 'คุณสมศักดิ์ ชำระจริง',
        phone: '089-111-2233',
        status: 'active',
      },
    });
    tenantId = tenant.id;

    // 5. Create Billing Cycles
    const c1 = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: `2026-08-${Date.now().toString().slice(-4)}`,
        name: 'รอบบิล ส.ค. 2569',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        status: 'active',
      },
    });
    cycle1Id = c1.id;

    const c2 = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: `2026-09-${Date.now().toString().slice(-4)}`,
        name: 'รอบบิล ก.ย. 2569',
        periodStart: new Date('2026-09-01'),
        periodEnd: new Date('2026-09-30'),
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-09-30'),
        status: 'active',
      },
    });
    cycle2Id = c2.id;
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { dormitoryId } });
    await prisma.receiptSequence.deleteMany({ where: { dormitoryId } });
    await prisma.paymentAllocation.deleteMany({ where: { dormitoryId } });
    await prisma.paymentStatusHistory.deleteMany({ where: { dormitoryId } });
    await prisma.payment.deleteMany({ where: { dormitoryId } });
    await prisma.combinedPaymentGroupBillTarget.deleteMany({ where: { dormitoryId } });
    await prisma.combinedPaymentGroup.deleteMany({ where: { dormitoryId } });
    await prisma.billStatusHistory.deleteMany({ where: { dormitoryId } });
    await prisma.billItem.deleteMany({ where: { dormitoryId } });
    await prisma.bill.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStayInvoiceItem.deleteMany({ where: { invoice: { dormitoryId } } });
    await prisma.dailyStayInvoice.deleteMany({ where: { dormitoryId } });
    await prisma.dailyStay.deleteMany({ where: { dormitoryId } });
    await prisma.occupancy.deleteMany({ where: { dormitoryId } });
    await prisma.tenant.deleteMany({ where: { dormitoryId } });
    await prisma.room.deleteMany({ where: { dormitoryId } });
    await prisma.building.deleteMany({ where: { dormitoryId } });
    await prisma.billingCycle.deleteMany({ where: { dormitoryId } });
    await prisma.dormitory.deleteMany({ where: { id: dormitoryId } });
    await prisma.user.deleteMany({ where: { id: ownerUserId } });
  });

  it('1. Monthly Proof: 2,000 + 2,800 = final 4,800; partial has NO final receipt; full has exactly ONE final receipt', async () => {
    // Create Bill 4,800 (Rent: 4000, Water: 300, Elec: 500)
    const bill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room104Id,
        tenantId,
        billNumber: `BILL-104-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4800.0,
        totalAmount: 4800.0,
        paidAmount: 0.0,
        outstandingAmount: 4800.0,
        items: {
          create: [
            { dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4000.0, displayOrder: 1 },
            { dormitoryId, type: 'water', description: 'ค่าน้ำ', amount: 300.0, displayOrder: 2 },
            { dormitoryId, type: 'electricity', description: 'ค่าไฟฟ้า', amount: 500.0, displayOrder: 3 },
          ],
        },
      },
    });

    // Payment 1: 2,000 cash payment recorded via PaymentService
    await paymentService.recordCash({
      dormitoryId,
      billId: bill.id,
      amount: 2000.0,
      userId: ownerUserId,
      idempotencyKey: `idem-p1-${Date.now()}`,
    });

    // Check bill state after payment 1
    const billAfterP1 = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(Number(billAfterP1!.paidAmount)).toBe(2000.0);
    expect(Number(billAfterP1!.outstandingAmount)).toBe(2800.0);
    expect(billAfterP1!.status).toBe('PARTIALLY_PAID');

    // Proof: Partial payment must produce NO Final Settlement Receipt
    const finalReceiptsAfterP1 = await prisma.receipt.findMany({
      where: {
        dormitoryId,
        billId: bill.id,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
    });
    expect(finalReceiptsAfterP1).toHaveLength(0);

    // Payment 2: 2,800 cash payment recorded via PaymentService
    await paymentService.recordCash({
      dormitoryId,
      billId: bill.id,
      amount: 2800.0,
      userId: ownerUserId,
      idempotencyKey: `idem-p2-${Date.now()}`,
    });

    // Check bill state after payment 2
    const billAfterP2 = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(Number(billAfterP2!.paidAmount)).toBe(4800.0);
    expect(Number(billAfterP2!.outstandingAmount)).toBe(0.0);
    expect(billAfterP2!.status).toBe('PAID');

    // Proof: Exactly ONE Final Settlement Receipt exists totaling 4,800.00
    const finalReceiptsAfterP2 = await prisma.receipt.findMany({
      where: {
        dormitoryId,
        billId: bill.id,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
    });
    expect(finalReceiptsAfterP2).toHaveLength(1);
    const finalReceipt = finalReceiptsAfterP2[0];
    expect(finalReceipt.receiptKind).toBe('FINAL_SETTLEMENT');
    expect(finalReceipt.settlementScopeKey).toBe(`ROOM_CYCLE:${room104Id}:${cycle1Id}`);
    expect((finalReceipt.snapshotData as any).total).toBe('4800.00');

    // Proof: Both underlying payment events remain preserved in the ledger
    const payments = await prisma.payment.findMany({ where: { billId: bill.id } });
    expect(payments).toHaveLength(2);
    expect(payments.map(p => Number(p.amount)).sort()).toEqual([2000, 2800]);
  });

  it('2. Retry Idempotency: Re-evaluating settled bill returns the same Final Receipt without duplicating', async () => {
    const bill = await prisma.bill.findFirst({ where: { roomId: room104Id, billingCycleId: cycle1Id } });
    expect(bill).not.toBeNull();

    // Call generateFinalSettlementReceiptForBillInTx directly as retry
    const receipt = await prisma.$transaction(async (tx) => {
      return await generateFinalSettlementReceiptForBillInTx(tx, {
        dormitoryId,
        billId: bill!.id,
        userId: ownerUserId,
      });
    });

    expect(receipt).toBeDefined();

    const count = await prisma.receipt.count({
      where: {
        dormitoryId,
        billId: bill!.id,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
    });
    expect(count).toBe(1);
  });

  it('3. Concurrency Uniqueness: Concurrent settlement calls resolve to the exact same Final Receipt', async () => {
    const bill = await prisma.bill.findFirst({ where: { roomId: room104Id, billingCycleId: cycle1Id } });

    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill!.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill!.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill!.id, userId: ownerUserId })),
    ]);

    expect(results[0].id).toBe(results[1].id);
    expect(results[1].id).toBe(results[2].id);

    const count = await prisma.receipt.count({
      where: {
        dormitoryId,
        settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}`,
      },
    });
    expect(count).toBe(1);
  });

  it('4. Scope Separation: Different room same cycle produces separate Final Receipts', async () => {
    // Bill for Room 105 in Cycle 1
    const bill105 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room105Id,
        tenantId,
        billNumber: `BILL-105-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4000.0,
        totalAmount: 4000.0,
        paidAmount: 0.0,
        outstandingAmount: 4000.0,
      },
    });

    await paymentService.recordCash({
      dormitoryId,
      billId: bill105.id,
      amount: 4000.0,
      userId: ownerUserId,
      idempotencyKey: `idem-105-${Date.now()}`,
    });

    const receipt104 = await prisma.receipt.findFirst({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}` },
    });
    const receipt105 = await prisma.receipt.findFirst({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room105Id}:${cycle1Id}` },
    });

    expect(receipt104).not.toBeNull();
    expect(receipt105).not.toBeNull();
    expect(receipt104!.id).not.toBe(receipt105!.id);
  });

  it('5. Scope Separation: Same room different cycle produces separate Final Receipts', async () => {
    // Bill for Room 104 in Cycle 2
    const bill104Cycle2 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle2Id,
        roomId: room104Id,
        tenantId,
        billNumber: `BILL-104-C2-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-09-30'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 0.0,
        outstandingAmount: 4500.0,
      },
    });

    await paymentService.recordCash({
      dormitoryId,
      billId: bill104Cycle2.id,
      amount: 4500.0,
      userId: ownerUserId,
      idempotencyKey: `idem-104-c2-${Date.now()}`,
    });

    const receiptC1 = await prisma.receipt.findFirst({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}` },
    });
    const receiptC2 = await prisma.receipt.findFirst({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle2Id}` },
    });

    expect(receiptC1).not.toBeNull();
    expect(receiptC2).not.toBeNull();
    expect(receiptC1!.id).not.toBe(receiptC2!.id);
  });

  it('6. Daily Proof: Partial item settlement has NO Final Receipt; full settlement produces ONE Final Receipt; retry is idempotent', async () => {
    // Create Daily Stay: Rent 1,600 (2 days @ 800) + Deposit 400 = total 2,000, UNPAID deposit initially
    const addResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room104Id,
        fullName: 'คุณทดสอบ รายวัน สองพัน',
        phone: '082-333-4455',
        startDate: '2026-09-10',
        endDate: '2026-09-12',
        dailyRateAmount: 800.0,
        depositAmount: 400.0,
        depositDeclaredStatus: 'UNPAID',
      },
      ownerUserId
    );

    const invoiceId = addResult.invoice.id;

    // Proof: UNPAID invoice has NO Final Settlement Receipt
    const noRcptInitial = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(noRcptInitial).toHaveLength(0);

    // Step A: Settle ONLY the deposit (400) via DailyStayService
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'DEPOSIT',
      ownerUserId
    );

    const invoiceAfterDeposit = await prisma.dailyStayInvoice.findUnique({ where: { id: invoiceId } });
    expect(Number(invoiceAfterDeposit!.outstandingAmount)).toBe(1600.0);
    expect(invoiceAfterDeposit!.status).toBe('PARTIALLY_PAID');

    // Proof: Partial settlement produces NO Final Settlement Receipt
    const noRcptPartial = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(noRcptPartial).toHaveLength(0);

    // Step B: Settle the remaining Daily Rent (1,600) via DailyStayService
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'DAILY_RENT',
      ownerUserId
    );

    const invoiceAfterFull = await prisma.dailyStayInvoice.findUnique({ where: { id: invoiceId } });
    expect(Number(invoiceAfterFull!.outstandingAmount)).toBe(0.0);
    expect(invoiceAfterFull!.status).toBe('PAID');

    // Proof: Exactly ONE Final Settlement Receipt exists totaling 2,000.00
    const finalReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(finalReceipts).toHaveLength(1);
    expect(finalReceipts[0].settlementScopeKey).toBe(`DAILY_INVOICE:${invoiceId}`);
    expect((finalReceipts[0].snapshotData as any).total).toBe('2000.00');

    // Step C: Retry settlement on already-settled invoice
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'ALL',
      ownerUserId
    ).catch(() => {}); // ALL will see 0 outstanding items or no-op

    const countAfterRetry = await prisma.receipt.count({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(countAfterRetry).toBe(1);
  });

  it('7. Zero Obligation: Daily stay with 0 rent and 0 deposit creates NO Payment and NO Receipt', async () => {
    const zeroResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room105Id,
        fullName: 'คุณทดสอบ ฟรี',
        phone: '089-000-0000',
        startDate: '2026-09-20',
        endDate: '2026-09-21',
        dailyRateAmount: 0.0,
        depositAmount: 0.0,
        depositDeclaredStatus: 'UNPAID',
      },
      ownerUserId
    );

    expect(zeroResult.invoice).toBeDefined();
    expect(Number(zeroResult.invoice.totalAgreedAmount)).toBe(0);

    const receipts = await prisma.receipt.findMany({
      where: {
        dormitoryId,
        dailyStayInvoiceId: zeroResult.invoice.id,
      },
    });
    expect(receipts).toHaveLength(0);
  });

  it('8. Service & Route Lookup: getFinalReceiptForBill and getFinalReceiptForDailyInvoice resolve authoritative receipt', async () => {
    const bill = await prisma.bill.findFirst({ where: { roomId: room104Id, billingCycleId: cycle1Id } });
    const billReceipt = await receiptService.getFinalReceiptForBill(dormitoryId, bill!.id);
    expect(billReceipt).not.toBeNull();
    expect(billReceipt?.receiptKind).toBe('FINAL_SETTLEMENT');

    const dailyInvoice = await prisma.dailyStayInvoice.findFirst({
      where: { dormitoryId, status: 'PAID', totalAgreedAmount: { gt: 0 } },
    });
    const dailyReceipt = await receiptService.getFinalReceiptForDailyInvoice(dormitoryId, dailyInvoice!.id);
    expect(dailyReceipt).not.toBeNull();
    expect(dailyReceipt?.receiptKind).toBe('FINAL_SETTLEMENT');
  });
});
