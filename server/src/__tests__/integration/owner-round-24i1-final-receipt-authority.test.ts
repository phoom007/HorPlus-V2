import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { ReceiptService } from '../../services/receipt.service.js';
import { DailyStayService } from '../../services/daily-stay.service.js';
import { PaymentService } from '../../services/payment.service.js';
import {
  generateFinalSettlementReceiptForBillInTx,
  generateFinalSettlementReceiptForDailyInvoiceInTx,
} from '../../utils/payment-transaction.util.js';

describe('Owner Round 2.4I.3 / A1: True Room-Cycle Final Settlement Receipt Authority & Concurrency Proofs', () => {
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
  let room106Id: string;
  let tenantId: string;

  beforeAll(async () => {
    // 1. Create Owner User
    const ownerEmail = `owner-24i3-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-24i3-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 2.4I.3 True Scope Authority',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักทดสอบ 2.4I.3 ${Date.now()}`,
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
          monthlyRent: 4500.0,
          termRent: 22500.0,
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
    const room106 = await createRoom('106');
    room104Id = room104.id;
    room105Id = room105.id;
    room106Id = room106.id;

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
    await prisma.provisionalRentalTerm.deleteMany({ where: { dormitoryId } });
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

  it('1. True Multi-Bill Scope Authority: Rent Bill (4,500 PAID) + Utility Bill (700 UNPAID) creates NO Final Receipt; settling Utility creates ONE Final Receipt (5,200)', async () => {
    const term104 = await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId,
        roomId: room104Id,
        tenantId,
        rentalType: 'MONTHLY',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T23:59:59.000Z'),
        durationMonths: 1,
        unitRentAmount: 4500.0,
        status: 'ACTIVE',
      },
    });

    // Bill 1: Rent Bill 4,500 (billKind: 'RENT')
    const rentBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room104Id,
        tenantId,
        provisionalRentalTermId: term104.id,
        billKind: 'RENT',
        billNumber: `BILL-104-RENT-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 0.0,
        outstandingAmount: 4500.0,
        items: {
          create: [
            { dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500.0, displayOrder: 1 },
          ],
        },
      },
    });

    // Bill 2: Utility Bill 700 (billKind: 'MONTHLY_UTILITY')
    const utilityBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room104Id,
        tenantId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-104-UTIL-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 700.0,
        totalAmount: 700.0,
        paidAmount: 0.0,
        outstandingAmount: 700.0,
        items: {
          create: [
            { dormitoryId, type: 'water', description: 'ค่าน้ำ', amount: 300.0, displayOrder: 2 },
            { dormitoryId, type: 'electricity', description: 'ค่าไฟฟ้า', amount: 400.0, displayOrder: 3 },
          ],
        },
      },
    });

    // Step A: Settle ONLY the Rent Bill (4,500)
    await paymentService.recordCash({
      dormitoryId,
      billId: rentBill.id,
      amount: 4500.0,
      userId: ownerUserId,
      idempotencyKey: `idem-rent-${Date.now()}`,
    });

    const rentBillAfter = await prisma.bill.findUnique({ where: { id: rentBill.id } });
    expect(rentBillAfter!.status).toBe('PAID');

    // Proof A: Because Utility Bill (700) is still UNPAID in this room-cycle, NO Final Receipt is created
    const finalReceiptsStepA = await prisma.receipt.findMany({
      where: {
        dormitoryId,
        settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}`,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
    });
    expect(finalReceiptsStepA).toHaveLength(0);

    // Step B: Settle the Utility Bill (700)
    await paymentService.recordCash({
      dormitoryId,
      billId: utilityBill.id,
      amount: 700.0,
      userId: ownerUserId,
      idempotencyKey: `idem-util-${Date.now()}`,
    });

    const utilityBillAfter = await prisma.bill.findUnique({ where: { id: utilityBill.id } });
    expect(utilityBillAfter!.status).toBe('PAID');

    // Proof B: Entire room-cycle is now settled -> Exactly ONE Final Settlement Receipt totaling 5,200.00
    const finalReceiptsStepB = await prisma.receipt.findMany({
      where: {
        dormitoryId,
        settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}`,
        receiptKind: 'FINAL_SETTLEMENT',
        isVoided: false,
      },
    });
    expect(finalReceiptsStepB).toHaveLength(1);
    const finalRcpt = finalReceiptsStepB[0];
    expect((finalRcpt.snapshotData as any).total).toBe('5200.00');
    expect((finalRcpt.snapshotData as any).billGroups).toHaveLength(2);
    expect((finalRcpt.snapshotData as any).paymentEvents).toHaveLength(2);

    // Proof C: getFinalReceiptForBill with Rent Bill ID resolves this same Final Receipt
    const receiptFromRentBill = await receiptService.getFinalReceiptForBill(dormitoryId, rentBill.id);
    expect(receiptFromRentBill).not.toBeNull();
    expect(receiptFromRentBill!.id).toBe(finalRcpt.id);

    // Proof D: getFinalReceiptForBill with Utility Bill ID resolves the exact same Final Receipt
    const receiptFromUtilBill = await receiptService.getFinalReceiptForBill(dormitoryId, utilityBill.id);
    expect(receiptFromUtilBill).not.toBeNull();
    expect(receiptFromUtilBill!.id).toBe(finalRcpt.id);
  });

  it('2. Partial Payments & Real Payment Event History Proof: 2,000 + 2,800 on Bill records both payment events in snapshot', async () => {
    // Room 105 in Cycle 1: Bill 4,800
    const bill105 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room105Id,
        tenantId,
        billNumber: `BILL-105-PART-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4800.0,
        totalAmount: 4800.0,
        paidAmount: 0.0,
        outstandingAmount: 4800.0,
        items: {
          create: [
            { dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก 105', amount: 4800.0, displayOrder: 1 },
          ],
        },
      },
    });

    // Payment 1: 2,000
    await paymentService.recordCash({
      dormitoryId,
      billId: bill105.id,
      amount: 2000.0,
      userId: ownerUserId,
      idempotencyKey: `idem-p105-1-${Date.now()}`,
    });

    // Partial status -> 0 final receipts
    const noRcpt = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room105Id}:${cycle1Id}`, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(noRcpt).toHaveLength(0);

    // Payment 2: 2,800
    await paymentService.recordCash({
      dormitoryId,
      billId: bill105.id,
      amount: 2800.0,
      userId: ownerUserId,
      idempotencyKey: `idem-p105-2-${Date.now()}`,
    });

    // Fully settled -> exactly 1 Final Receipt with 2 payment events
    const rcpts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room105Id}:${cycle1Id}`, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(rcpts).toHaveLength(1);
    const snap = rcpts[0].snapshotData as any;
    expect(snap.total).toBe('4800.00');
    expect(snap.paymentEvents).toHaveLength(2);
    expect(snap.paymentEvents.map((e: any) => e.amount).sort()).toEqual(['2000.00', '2800.00']);
  });

  it('3. Fresh First-Creation Concurrency Proof: Concurrent initial finalization calls resolve cleanly to exactly ONE Final Receipt without crash', async () => {
    // Room 106 in Cycle 1: Paid Bill 4,500 with NO Final Receipt created yet
    const freshBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room106Id,
        tenantId,
        billNumber: `BILL-106-FRESH-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
        items: {
          create: [
            { dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก 106', amount: 4500.0, displayOrder: 1 },
          ],
        },
      },
    });

    // Ensure 0 receipts exist initially
    const initialCount = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room106Id}:${cycle1Id}` },
    });
    expect(initialCount).toBe(0);

    // Concurrently invoke finalization for the first time
    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
    ]);

    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results[1]?.id).toBe(results[2]?.id);

    // Database contains exactly 1 FINAL_SETTLEMENT
    const countAfter = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room106Id}:${cycle1Id}` },
    });
    expect(countAfter).toBe(1);
  });

  it('4. Daily Fresh First-Creation Concurrency Proof: Concurrent initial daily invoice finalization resolves to ONE Final Receipt', async () => {
    const addResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room106Id,
        fullName: 'คุณทดสอบ รายวัน แข่งขัน',
        phone: '083-999-1122',
        startDate: '2026-09-05',
        endDate: '2026-09-07',
        dailyRateAmount: 800.0,
        depositAmount: 300.0,
        depositDeclaredStatus: 'PAID',
      },
      ownerUserId
    );

    const invId = addResult.invoice.id;

    // Settle the remaining daily rent so invoice status is fully PAID (outstanding = 0)
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invId,
      'DAILY_RENT',
      ownerUserId
    );

    // Concurrently invoke finalization
    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invId, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invId, userId: ownerUserId })),
    ]);

    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.id).toBe(results[1]?.id);

    const count = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `DAILY_INVOICE:${invId}` },
    });
    expect(count).toBe(1);
  });

  it('5. Scope Separation Proof: Same room different cycle produces separate Final Receipts', async () => {
    // Room 104 in Cycle 2: Bill 4,500
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

  it('6. Daily Stay Partial vs Full Settlement & Real Item Payment Events', async () => {
    const addResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room104Id,
        fullName: 'คุณทดสอบ รายวัน สองพันเต็ม',
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

    // Step A: Settle ONLY the deposit (400)
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'DEPOSIT',
      ownerUserId
    );

    // Partial -> NO Final Receipt
    const noRcptPartial = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(noRcptPartial).toHaveLength(0);

    // Step B: Settle remaining Daily Rent (1,600)
    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'DAILY_RENT',
      ownerUserId
    );

    // Fully settled -> Exactly ONE Final Receipt
    const finalReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT' },
    });
    expect(finalReceipts).toHaveLength(1);
    expect((finalReceipts[0].snapshotData as any).total).toBe('2000.00');
    expect((finalReceipts[0].snapshotData as any).paymentEvents).toHaveLength(2);
  });

  it('7. Zero Obligation Proof: Explicitly proves NO fake Payment, CombinedPaymentGroup, PaymentAllocation, or Receipt is created', async () => {
    const zeroResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room105Id,
        fullName: 'คุณทดสอบ ศูนย์บาท',
        phone: '089-000-0000',
        startDate: '2026-09-20',
        endDate: '2026-09-21',
        dailyRateAmount: 0.0,
        depositAmount: 0.0,
        depositDeclaredStatus: 'UNPAID',
      },
      ownerUserId
    );

    const inv = zeroResult.invoice;
    expect(Number(inv.totalAgreedAmount)).toBe(0);

    // Assert NO fake records exist
    const receipts = await prisma.receipt.findMany({ where: { dormitoryId, dailyStayInvoiceId: inv.id } });
    expect(receipts).toHaveLength(0);

    const payments = await prisma.payment.findMany({ where: { dormitoryId, tenantId: zeroResult.tenant?.id } });
    expect(payments).toHaveLength(0);

    const groups = await prisma.combinedPaymentGroup.findMany({ where: { dormitoryId, notes: { contains: inv.id } } });
    expect(groups).toHaveLength(0);

    const allocations = await prisma.paymentAllocation.findMany({ where: { dormitoryId, billId: inv.id } });
    expect(allocations).toHaveLength(0);
  });

  it('8. Fail Closed Proof: Invalidated, unsettled, or missing context requests refuse to create Final Receipt', async () => {
    // Unsettled bill in room 106 cycle 2
    const unsettledBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle2Id,
        roomId: room106Id,
        tenantId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-UNSETTLED-${Date.now().toString().slice(-4)}`,
        status: 'issued',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-09-30'),
        subtotal: 1000.0,
        totalAmount: 1000.0,
        paidAmount: 0.0,
        outstandingAmount: 1000.0,
      },
    });

    const billRcpt = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: unsettledBill.id, userId: ownerUserId })
    );
    expect(billRcpt).toBeNull();

    // Missing room context
    const fakeRcpt = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: 'non-existent-id', userId: ownerUserId })
    );
    expect(fakeRcpt).toBeNull();
  });
});
