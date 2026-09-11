import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import { ReceiptService } from '../../services/receipt.service.js';
import { DailyStayService } from '../../services/daily-stay.service.js';
import { PaymentService } from '../../services/payment.service.js';
import {
  generateFinalSettlementReceiptForBillInTx,
  generateFinalSettlementReceiptForDailyInvoiceInTx,
} from '../../utils/payment-transaction.util.js';

describe('Owner Round 2.4I.4 / A1: True Room-Cycle Final Settlement Receipt Authority, Void/Reissue & Tenant Safety B1', () => {
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
  let room107Id: string;
  let room108Id: string;
  let room109Id: string;
  let room110Id: string;
  let room111Id: string;
  let room112Id: string;
  let room113Id: string;
  let room114Id: string;
  let room115Id: string;
  let tenantAId: string;
  let tenantBId: string;
  let contract1Id: string;
  let contract2Id: string;

  beforeAll(async () => {
    // 1. Create Owner User
    const ownerEmail = `owner-24i4-${Date.now()}@example.com`;
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-24i4-${Date.now()}`,
        email: ownerEmail,
        emailNormalized: ownerEmail.toLowerCase(),
        name: 'เจ้าของหอพัก 2.4I.4 Scope Safety',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Dormitory
    const dorm = await prisma.dormitory.create({
      data: {
        name: `หอพักทดสอบ 2.4I.4 ${Date.now()}`,
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

    const r104 = await createRoom('104');
    const r105 = await createRoom('105');
    const r106 = await createRoom('106');
    const r107 = await createRoom('107');
    const r108 = await createRoom('108');
    const r109 = await createRoom('109');
    const r110 = await createRoom('110');
    const r111 = await createRoom('111');
    const r112 = await createRoom('112');
    const r113 = await createRoom('113');
    const r114 = await createRoom('114');
    const r115 = await createRoom('115');
    room104Id = r104.id;
    room105Id = r105.id;
    room106Id = r106.id;
    room107Id = r107.id;
    room108Id = r108.id;
    room109Id = r109.id;
    room110Id = r110.id;
    room111Id = r111.id;
    room112Id = r112.id;
    room113Id = r113.id;
    room114Id = r114.id;
    room115Id = r115.id;

    // 4. Create Tenants
    const tenantA = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T-A-${Date.now().toString().slice(-4)}`,
        firstName: 'คุณสมศักดิ์',
        lastName: 'ชำระจริง',
        displayName: 'คุณสมศักดิ์ ชำระจริง',
        phone: '089-111-2233',
        status: 'active',
      },
    });
    tenantAId = tenantA.id;

    const tenantB = await prisma.tenant.create({
      data: {
        dormitoryId,
        tenantNumber: `T-B-${Date.now().toString().slice(-4)}`,
        firstName: 'คุณวิชัย',
        lastName: 'คนละคน',
        displayName: 'คุณวิชัย คนละคน',
        phone: '089-444-5566',
        status: 'active',
      },
    });
    tenantBId = tenantB.id;

    // 5. Create Contracts
    const c1 = await prisma.contract.create({
      data: {
        dormitoryId,
        roomId: room109Id,
        tenantId: tenantAId,
        contractNumber: `CTR-1-${Date.now().toString().slice(-4)}`,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: 4500.0,
        depositAmount: 5000.0,
      },
    });
    contract1Id = c1.id;

    const c2 = await prisma.contract.create({
      data: {
        dormitoryId,
        roomId: room109Id,
        tenantId: tenantAId,
        contractNumber: `CTR-2-${Date.now().toString().slice(-4)}`,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: 4500.0,
        depositAmount: 5000.0,
      },
    });
    contract2Id = c2.id;

    // 6. Create Billing Cycles
    const bc1 = await prisma.billingCycle.create({
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
    cycle1Id = bc1.id;

    const bc2 = await prisma.billingCycle.create({
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
    cycle2Id = bc2.id;
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
    await prisma.contract.deleteMany({ where: { dormitoryId } });
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

  // =========================================================================
  // EXISTING A1 REGRESSION PROOFS
  // =========================================================================

  it('1. True Multi-Bill Scope Authority: Rent Bill (4,500 PAID) + Utility Bill (700 UNPAID) creates NO Final Receipt; settling Utility creates ONE Final Receipt (5,200)', async () => {
    const term104 = await prisma.provisionalRentalTerm.create({
      data: {
        dormitoryId,
        roomId: room104Id,
        tenantId: tenantAId,
        rentalType: 'MONTHLY',
        startDate: new Date('2026-08-01T00:00:00.000Z'),
        endDate: new Date('2026-08-31T23:59:59.000Z'),
        durationMonths: 1,
        unitRentAmount: 4500.0,
        status: 'ACTIVE',
      },
    });

    const rentBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room104Id,
        tenantId: tenantAId,
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

    const utilityBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room104Id,
        tenantId: tenantAId,
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

    // Proof A: Because Utility Bill (700) is still UNPAID, NO Final Receipt is created
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

    // Proof C: getFinalReceiptForBill resolves the same Final Receipt for either bill
    const receiptFromRentBill = await receiptService.getFinalReceiptForBill(dormitoryId, rentBill.id);
    const receiptFromUtilBill = await receiptService.getFinalReceiptForBill(dormitoryId, utilityBill.id);
    expect(receiptFromRentBill?.id).toBe(finalRcpt.id);
    expect(receiptFromUtilBill?.id).toBe(finalRcpt.id);
  });

  it('2. Partial Payments & Real Payment Event History Proof: 2,000 + 2,800 on Bill records both payment events in snapshot', async () => {
    const bill105 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room105Id,
        tenantId: tenantAId,
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
    const freshBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room106Id,
        tenantId: tenantAId,
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

    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: freshBill.id, userId: ownerUserId })),
    ]);

    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results[1]?.id).toBe(results[2]?.id);

    const countAfter = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room106Id}:${cycle1Id}`, isVoided: false },
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

    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invId,
      'DAILY_RENT',
      ownerUserId
    );

    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invId, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invId, userId: ownerUserId })),
    ]);

    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.id).toBe(results[1]?.id);

    const count = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `DAILY_INVOICE:${invId}`, isVoided: false },
    });
    expect(count).toBe(1);
  });

  it('5. Scope Separation Proof: Same room different cycle produces separate Final Receipts', async () => {
    const bill104Cycle2 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle2Id,
        roomId: room104Id,
        tenantId: tenantAId,
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
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle1Id}`, isVoided: false },
    });
    const receiptC2 = await prisma.receipt.findFirst({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room104Id}:${cycle2Id}`, isVoided: false },
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

    const finalReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, dailyStayInvoiceId: invoiceId, receiptKind: 'FINAL_SETTLEMENT', isVoided: false },
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

    const receipts = await prisma.receipt.findMany({ where: { dormitoryId, dailyStayInvoiceId: inv.id } });
    expect(receipts).toHaveLength(0);

    const payments = await prisma.payment.findMany({ where: { dormitoryId, tenantId: zeroResult.tenant?.id } });
    expect(payments).toHaveLength(0);

    const groups = await prisma.combinedPaymentGroup.findMany({ where: { dormitoryId, notes: { contains: inv.id } } });
    expect(groups).toHaveLength(0);

    const allocations = await prisma.paymentAllocation.findMany({ where: { dormitoryId, billId: inv.id } });
    expect(allocations).toHaveLength(0);
  });

  // =========================================================================
  // NEW ROUND 2.4I.4 REQUIRED INTEGRATION PROOFS
  // =========================================================================

  it('8. Proof A: Negative Outstanding MUST Fail Closed (Bill and Daily)', async () => {
    // Bill with negative outstanding (-100)
    const negBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle2Id,
        roomId: room105Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-NEG-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-09-25'),
        dueDate: new Date('2026-09-30'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4600.0,
        outstandingAmount: -100.0, // Negative outstanding!
      },
    });

    const billResult = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: negBill.id, userId: ownerUserId })
    );
    expect(billResult).toBeNull();

    // Daily with negative outstanding (-50)
    const dailyStay = await prisma.dailyStay.create({
      data: {
        dormitoryId,
        roomId: room105Id,
        applicantFullName: 'คุณทดสอบ ค้างลบ',
        applicantPhone: '081-111-2222',
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-09-17'),
        inclusiveDayCount: 2,
        dailyRateAmount: 800.0,
        depositAmount: 300.0,
        status: 'CHECKED_IN',
      },
    });

    const negDailyInvoice = await prisma.dailyStayInvoice.create({
      data: {
        dormitoryId,
        dailyStayId: dailyStay.id,
        invoiceNumber: `DINV-NEG-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        totalAgreedAmount: 1900.0,
        outstandingAmount: -50.0, // Negative outstanding!
      },
    });

    const dailyResult = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: negDailyInvoice.id, userId: ownerUserId })
    );
    expect(dailyResult).toBeNull();
  });

  it('9. Proof B: Canonical Invalidation Semantics: VOIDED, withdrawn, SUPERSEDED, Cancelled bills do NOT block or contribute', async () => {
    // Room 107 in Cycle 1
    // 1. Legitimate PAID active bill
    const activePaidBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room107Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-107-ACT-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
        items: {
          create: [{ dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500.0, displayOrder: 1 }],
        },
      },
    });

    // 2. VOIDED bill
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room107Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-107-VOID-${Date.now().toString().slice(-4)}`,
        status: 'VOIDED',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 500.0,
        totalAmount: 500.0,
        paidAmount: 0.0,
        outstandingAmount: 500.0,
      },
    });

    // 3. withdrawn bill (lowercase)
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room107Id,
        tenantId: tenantAId,
        billKind: 'OTHER',
        billNumber: `BILL-107-WITH-${Date.now().toString().slice(-4)}`,
        status: 'withdrawn',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 300.0,
        totalAmount: 300.0,
        paidAmount: 0.0,
        outstandingAmount: 300.0,
      },
    });

    // 4. SUPERSEDED bill
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room107Id,
        tenantId: tenantAId,
        billKind: 'OTHER',
        billNumber: `BILL-107-SUP-${Date.now().toString().slice(-4)}`,
        status: 'SUPERSEDED',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 400.0,
        totalAmount: 400.0,
        paidAmount: 0.0,
        outstandingAmount: 400.0,
      },
    });

    // 5. Cancelled bill
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room107Id,
        tenantId: tenantAId,
        billKind: 'OTHER',
        billNumber: `BILL-107-CAN-${Date.now().toString().slice(-4)}`,
        status: 'Cancelled',
        cancelledAt: new Date(),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 200.0,
        totalAmount: 200.0,
        paidAmount: 0.0,
        outstandingAmount: 200.0,
      },
    });

    // Generate Final Settlement Receipt: should ignore all invalidated bills and succeed with 4,500.00
    const receipt = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: activePaidBill.id, userId: ownerUserId })
    );

    expect(receipt).not.toBeNull();
    const snap = receipt!.snapshotData as any;
    expect(snap.total).toBe('4500.00');
    expect(snap.billGroups).toHaveLength(1);
    expect(snap.billGroups[0].billId).toBe(activePaidBill.id);
  });

  it('10. Proof C: Tenant Context Safety (B1): Multiple distinct tenants in same room-cycle MUST FAIL CLOSED', async () => {
    // Room 108 in Cycle 1
    // Bill 1: Tenant A
    const billTenantA = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room108Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-108-TA-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
      },
    });

    // Bill 2: Tenant B (Different Tenant!)
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room108Id,
        tenantId: tenantBId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-108-TB-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 700.0,
        totalAmount: 700.0,
        paidAmount: 700.0,
        outstandingAmount: 0.0,
      },
    });

    // Generator must fail closed and return null
    const result = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: billTenantA.id, userId: ownerUserId })
    );
    expect(result).toBeNull();

    // Confirm 0 receipts created in DB
    const rcptCount = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room108Id}:${cycle1Id}` },
    });
    expect(rcptCount).toBe(0);
  });

  it('11. Proof D: Rental Context Safety (B1): Incompatible contracts / provisional terms MUST FAIL CLOSED', async () => {
    // Room 109 in Cycle 1
    // Bill 1: Contract 1
    const billContract1 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room109Id,
        tenantId: tenantAId,
        contractId: contract1Id,
        billKind: 'RENT',
        billNumber: `BILL-109-C1-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
      },
    });

    // Bill 2: Contract 2 (Incompatible Contract!)
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room109Id,
        tenantId: tenantAId,
        contractId: contract2Id,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-109-C2-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 700.0,
        totalAmount: 700.0,
        paidAmount: 700.0,
        outstandingAmount: 0.0,
      },
    });

    const result = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: billContract1.id, userId: ownerUserId })
    );
    expect(result).toBeNull();
  });

  it('12. Proof E: Void -> Reissue Lifecycle: Voided receipt preserved for audit, exactly 1 active receipt reissued', async () => {
    // Room 110 in Cycle 1
    const bill110 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room110Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-110-VRE-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
      },
    });

    // 1. Initial creation of Receipt A
    const receiptA = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill110.id, userId: ownerUserId })
    );
    expect(receiptA).not.toBeNull();
    expect(receiptA!.isVoided).toBe(false);

    // 2. Void Receipt A
    await prisma.receipt.update({
      where: { id: receiptA!.id },
      data: {
        isVoided: true,
        voidedAt: new Date(),
        voidedByUserId: ownerUserId,
        voidReason: 'ออกผิดพลาด ต้องการแก้ไข',
      },
    });

    // Check: 0 active receipts, 1 total receipt
    const activeCountBefore = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room110Id}:${cycle1Id}`, isVoided: false },
    });
    expect(activeCountBefore).toBe(0);

    // 3. Re-issue: Call generator again for the settled scope
    const receiptB = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill110.id, userId: ownerUserId })
    );
    expect(receiptB).not.toBeNull();
    expect(receiptB!.id).not.toBe(receiptA!.id);
    expect(receiptB!.isVoided).toBe(false);

    // 4. Assertions: Receipt A preserved, Receipt B active, exactly 1 active, 2 total
    const allReceiptsInScope = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room110Id}:${cycle1Id}` },
      orderBy: { createdAt: 'asc' },
    });
    expect(allReceiptsInScope).toHaveLength(2);
    expect(allReceiptsInScope[0].id).toBe(receiptA!.id);
    expect(allReceiptsInScope[0].isVoided).toBe(true);
    expect(allReceiptsInScope[1].id).toBe(receiptB!.id);
    expect(allReceiptsInScope[1].isVoided).toBe(false);
  });

  it('13. Proof F: Void -> Concurrent Reissue: Concurrent generators after void resolve to ONE new active receipt', async () => {
    // Room 111 in Cycle 1
    const bill111 = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room111Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-111-CONCV-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
      },
    });

    // 1. Initial Receipt A
    const receiptA = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill111.id, userId: ownerUserId })
    );
    expect(receiptA).not.toBeNull();

    // 2. Void Receipt A
    await prisma.receipt.update({
      where: { id: receiptA!.id },
      data: {
        isVoided: true,
        voidedAt: new Date(),
        voidedByUserId: ownerUserId,
        voidReason: 'ยกเลิกเพื่อออกใหม่',
      },
    });

    // 3. Concurrently invoke finalization 3 times in parallel
    const results = await Promise.all([
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill111.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill111.id, userId: ownerUserId })),
      prisma.$transaction(tx => generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: bill111.id, userId: ownerUserId })),
    ]);

    expect(results[0]?.id).toBeDefined();
    expect(results[0]?.id).toBe(results[1]?.id);
    expect(results[1]?.id).toBe(results[2]?.id);
    expect(results[0]?.id).not.toBe(receiptA!.id);

    // 4. Assert: Exactly 1 active receipt, 2 total receipts
    const activeReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room111Id}:${cycle1Id}`, isVoided: false },
    });
    expect(activeReceipts).toHaveLength(1);

    const totalReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room111Id}:${cycle1Id}` },
    });
    expect(totalReceipts).toHaveLength(2);
  });

  it('14. Proof G: Daily Void -> Reissue Lifecycle: Old voided preserved, new active reissued', async () => {
    const addResult = await dailyStayService.ownerQuickAddDailyStay(
      dormitoryId,
      {
        roomId: room107Id,
        fullName: 'คุณทดสอบ รายวัน ยกเลิกออกใหม่',
        phone: '084-555-6677',
        startDate: '2026-09-18',
        endDate: '2026-09-20',
        dailyRateAmount: 800.0,
        depositAmount: 400.0,
        depositDeclaredStatus: 'PAID',
      },
      ownerUserId
    );

    const invoiceId = addResult.invoice.id;

    await dailyStayService.settleDailyStayInvoiceItem(
      dormitoryId,
      invoiceId,
      'DAILY_RENT',
      ownerUserId
    );

    // Initial receipt
    const dailyRcptA = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invoiceId, userId: ownerUserId })
    );
    expect(dailyRcptA).not.toBeNull();
    expect(dailyRcptA!.isVoided).toBe(false);

    // Void Receipt A
    await prisma.receipt.update({
      where: { id: dailyRcptA!.id },
      data: {
        isVoided: true,
        voidedAt: new Date(),
        voidReason: 'ยกเลิกใบเสร็จรายวัน',
      },
    });

    // Reissue Daily Receipt B
    const dailyRcptB = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForDailyInvoiceInTx(tx, { dormitoryId, dailyStayInvoiceId: invoiceId, userId: ownerUserId })
    );
    expect(dailyRcptB).not.toBeNull();
    expect(dailyRcptB!.id).not.toBe(dailyRcptA!.id);
    expect(dailyRcptB!.isVoided).toBe(false);

    // Database has 1 active and 1 voided
    const activeDaily = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `DAILY_INVOICE:${invoiceId}`, isVoided: false },
    });
    expect(activeDaily).toHaveLength(1);

    const totalDaily = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `DAILY_INVOICE:${invoiceId}` },
    });
    expect(totalDaily).toHaveLength(2);
  });

  it('15. Proof H: Active Lookup via ReceiptService: With A voided and B active returns B; with all voided returns null', async () => {
    // For Room 110 (where Receipt A was voided and Receipt B is active):
    const bill110 = await prisma.bill.findFirst({ where: { roomId: room110Id, billingCycleId: cycle1Id } });
    expect(bill110).not.toBeNull();

    // Lookup resolves Receipt B (the active one)
    const resolvedActive = await receiptService.getFinalReceiptForBill(dormitoryId, bill110!.id);
    expect(resolvedActive).not.toBeNull();
    expect(resolvedActive!.isVoided).toBe(false);

    // If Receipt B is also voided
    await prisma.receipt.update({
      where: { id: resolvedActive!.id },
      data: { isVoided: true, voidReason: 'ยกเลิกใบเสร็จฉบับที่สอง' },
    });

    // Now all receipts are voided -> lookup returns null
    const resolvedNone = await receiptService.getFinalReceiptForBill(dormitoryId, bill110!.id);
    expect(resolvedNone).toBeNull();

    // But direct audit lookup by ID still works!
    const directAuditA = await receiptService.getReceipt(dormitoryId, resolvedActive!.id);
    expect(directAuditA.id).toBe(resolvedActive!.id);
    expect(directAuditA.isVoided).toBe(true);
  });

  // =========================================================================
  // ROUND 2.4I.5 ZERO-OBLIGATION ROOM-CYCLE AUTHORITY TESTS
  // =========================================================================

  it('16. Proof 2.4I.5-A & B: Positive Rent (4,500) + Zero Utility Bill (0) produces exactly ONE Final Receipt (4,500) & Zero Bill produces 0 Payment/Receipt/Allocation', async () => {
    // Room 112 in Cycle 1
    const rentBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room112Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-112-RENT-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
        items: {
          create: [{ dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก 112', amount: 4500.0, displayOrder: 1 }],
        },
      },
    });

    // Record payment for Rent Bill
    await prisma.payment.create({
      data: {
        dormitoryId,
        billId: rentBill.id,
        tenantId: tenantAId,
        amount: 4500.0,
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: new Date(),
        reviewedAt: new Date(),
        reviewedByUserId: ownerUserId,
      },
    });

    // Zero-obligation Utility Bill (total 0, paid 0, outstanding 0)
    const zeroUtilBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room112Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-112-UTIL0-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
        items: {
          create: [{ dormitoryId, type: 'water', description: 'ค่าน้ำ (0 หน่วย)', amount: 0.0, displayOrder: 2 }],
        },
      },
    });

    // Finalize room-cycle: zero bill does not block positive rent bill
    const receipt = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: rentBill.id, userId: ownerUserId })
    );

    expect(receipt).not.toBeNull();
    const snap = receipt!.snapshotData as any;
    expect(snap.total).toBe('4500.00');

    // Snapshot line items contain only non-zero items (Rent 4,500), NO zero utility item
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].description).toBe('ค่าเช่าห้องพัก 112');
    expect(snap.items[0].amount).toBe('4500.00');

    // Exactly ONE active Final Receipt in database
    const receiptsInScope = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room112Id}:${cycle1Id}`, isVoided: false },
    });
    expect(receiptsInScope).toHaveLength(1);
    expect(receiptsInScope[0].id).toBe(receipt!.id);

    // Proof B: Assert zero Utility produced:
    // 0 Payment, 0 EVENT Receipt, 0 PaymentAllocation
    const paymentsForZeroBill = await prisma.payment.findMany({ where: { billId: zeroUtilBill.id } });
    expect(paymentsForZeroBill).toHaveLength(0);

    const allocationsForZeroBill = await prisma.paymentAllocation.findMany({ where: { billId: zeroUtilBill.id } });
    expect(allocationsForZeroBill).toHaveLength(0);

    const eventReceiptsForZeroBill = await prisma.receipt.findMany({
      where: { billId: zeroUtilBill.id, receiptKind: 'EVENT' },
    });
    expect(eventReceiptsForZeroBill).toHaveLength(0);

    // Also verify getFinalReceiptForBill resolves the same Final Receipt when passed the zeroUtilBill ID
    const receiptFromZeroBill = await receiptService.getFinalReceiptForBill(dormitoryId, zeroUtilBill.id);
    expect(receiptFromZeroBill).not.toBeNull();
    expect(receiptFromZeroBill!.id).toBe(receipt!.id);
  });

  it('17. Proof 2.4I.5-C: Positive Bill (4,500) + TWO Zero Bills produces Final Receipt totaling 4,500', async () => {
    // Room 113 in Cycle 1
    const rentBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room113Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-113-RENT-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 4500.0,
        totalAmount: 4500.0,
        paidAmount: 4500.0,
        outstandingAmount: 0.0,
        items: {
          create: [{ dormitoryId, type: 'rent', description: 'ค่าเช่าห้องพัก 113', amount: 4500.0, displayOrder: 1 }],
        },
      },
    });

    await prisma.payment.create({
      data: {
        dormitoryId,
        billId: rentBill.id,
        tenantId: tenantAId,
        amount: 4500.0,
        method: 'CASH',
        status: 'APPROVED',
      },
    });

    // Zero Bill 1
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room113Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-113-Z1-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
      },
    });

    // Zero Bill 2
    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room113Id,
        tenantId: tenantAId,
        billKind: 'OTHER',
        billNumber: `BILL-113-Z2-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
      },
    });

    const receipt = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: rentBill.id, userId: ownerUserId })
    );

    expect(receipt).not.toBeNull();
    const snap = receipt!.snapshotData as any;
    expect(snap.total).toBe('4500.00');
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0].amount).toBe('4500.00');
  });

  it('18. Proof 2.4I.5-D: All-Zero room-cycle produces ZERO Final Receipt (no ฿0 receipt created)', async () => {
    // Room 114 in Cycle 1: Two bills, both ฿0
    const zeroBillA = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room114Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-114-ZA-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
      },
    });

    await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room114Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-114-ZB-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
      },
    });

    // Generator must return null: scope is settled, but NO ฿0 receipt should be created
    const result = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: zeroBillA.id, userId: ownerUserId })
    );
    expect(result).toBeNull();

    // Confirm 0 receipts created in DB
    const count = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${room114Id}:${cycle1Id}` },
    });
    expect(count).toBe(0);
  });

  it('19. Proof 2.4I.5-E & F: Negative-total Bill or Zero-Bill with negative outstanding MUST FAIL CLOSED', async () => {
    // Room 115 in Cycle 1
    // Case E: Bill with negative total (-100)
    const negTotalBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room115Id,
        tenantId: tenantAId,
        billKind: 'RENT',
        billNumber: `BILL-115-NEGT-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: -100.0,
        totalAmount: -100.0,
        paidAmount: 0.0,
        outstandingAmount: 0.0,
      },
    });

    const resE = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: negTotalBill.id, userId: ownerUserId })
    );
    expect(resE).toBeNull();

    // Case F: Zero Bill with negative outstanding (-50)
    const zeroBillNegOut = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: room115Id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-115-ZNEGO-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 0.0,
        totalAmount: 0.0,
        paidAmount: 0.0,
        outstandingAmount: -50.0, // Negative outstanding!
      },
    });

    const resF = await prisma.$transaction(tx =>
      generateFinalSettlementReceiptForBillInTx(tx, { dormitoryId, billId: zeroBillNegOut.id, userId: ownerUserId })
    );
    expect(resF).toBeNull();
  });

  // =========================================================================
  // ROUND 2.4J RECEIPT RECOVERY POLICY 1A TESTS
  // =========================================================================

  it('20. Round 2.4J Proof 1A: Lazy on-demand generation for settled Bill scope without active receipt, and idempotent on subsequent calls', async () => {
    // Create a new room with a fully settled bill that does NOT have any receipt created yet
    const rNumLazy = `LAZY-${Date.now().toString().slice(-4)}`;
    const lazyRoom = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: rNumLazy,
        normalizedRoomNumber: rNumLazy.toLowerCase(),
        floor: 2,
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

    const lazyBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: lazyRoom.id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_RENT',
        billNumber: `BILL-LAZY-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 5000.0,
        totalAmount: 5000.0,
        paidAmount: 5000.0,
        outstandingAmount: 0.0,
      },
    });

    const lazyItem = await prisma.billItem.create({
      data: {
        dormitoryId,
        billId: lazyBill.id,
        type: 'RENT',
        description: 'ค่าเช่าห้อง',
        amount: 5000.0,
      },
    });

    await prisma.payment.create({
      data: {
        dormitoryId,
        billId: lazyBill.id,
        tenantId: tenantAId,
        amount: 5000.0,
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-26'),
        reviewedAt: new Date(),
        reviewedByUserId: ownerUserId,
      },
    });

    // Verify scope has NO receipt currently
    const beforeScopeKey = `ROOM_CYCLE:${lazyRoom.id}:${cycle1Id}`;
    const beforeReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: beforeScopeKey },
    });
    expect(beforeReceipts).toHaveLength(0);

    // Call ReceiptService.getFinalReceiptForBill -> Lazy generation triggers!
    const recoveredReceipt = await receiptService.getFinalReceiptForBill(dormitoryId, lazyBill.id, ownerUserId);
    expect(recoveredReceipt).not.toBeNull();
    expect(recoveredReceipt!.receiptKind).toBe('FINAL_SETTLEMENT');
    expect((recoveredReceipt!.snapshotData as any).total).toBe('5000.00');
    expect(recoveredReceipt!.settlementScopeKey).toBe(beforeScopeKey);

    // Verify DB now has exactly 1 receipt in scope
    const afterReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: beforeScopeKey },
    });
    expect(afterReceipts).toHaveLength(1);
    expect(afterReceipts[0].id).toBe(recoveredReceipt!.id);

    // Calling it again returns the same active receipt without creating a new one
    const secondCall = await receiptService.getFinalReceiptForBill(dormitoryId, lazyBill.id, ownerUserId);
    expect(secondCall!.id).toBe(recoveredReceipt!.id);
    const countAfterSecond = await prisma.receipt.count({
      where: { dormitoryId, settlementScopeKey: beforeScopeKey },
    });
    expect(countAfterSecond).toBe(1);
  });

  it('21. Round 2.4J Proof 1A Guard: Lazy generation preserves VOID invariant and fails closed for UNPAID scopes', async () => {
    // 1. VOID Invariant Guard: If all receipts in a scope are voided, lazy lookup returns null without recreating
    const rNumVoid = `VOID-${Date.now().toString().slice(-4)}`;
    const voidRoom = await prisma.room.create({
      data: {
        dormitoryId,
        buildingId,
        roomNumber: rNumVoid,
        normalizedRoomNumber: rNumVoid.toLowerCase(),
        floor: 3,
        status: 'occupied',
        monthlyRent: 3500.0,
        termRent: 17500.0,
        termMonths: 5,
        dailyRent: 700.0,
        depositAmount: 500.0,
        monthlyDeposit: 500.0,
        termDeposit: 500.0,
        dailyDeposit: 300.0,
      },
    });

    const voidBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: voidRoom.id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_RENT',
        billNumber: `BILL-VOID-${Date.now().toString().slice(-4)}`,
        status: 'PAID',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 3500.0,
        totalAmount: 3500.0,
        paidAmount: 3500.0,
        outstandingAmount: 0.0,
      },
    });

    const voidItem = await prisma.billItem.create({
      data: {
        dormitoryId,
        billId: voidBill.id,
        type: 'RENT',
        description: 'ค่าเช่าห้อง',
        amount: 3500.0,
      },
    });

    await prisma.payment.create({
      data: {
        dormitoryId,
        billId: voidBill.id,
        tenantId: tenantAId,
        amount: 3500.0,
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: new Date('2026-08-26'),
        reviewedAt: new Date(),
        reviewedByUserId: ownerUserId,
      },
    });

    // Generate initial receipt
    const initialReceipt = await receiptService.getFinalReceiptForBill(dormitoryId, voidBill.id, ownerUserId);
    expect(initialReceipt).not.toBeNull();

    // Owner voids the receipt
    await prisma.receipt.update({
      where: { id: initialReceipt!.id },
      data: { isVoided: true, voidReason: 'เจ้าของหอยกเลิกเพื่อออกใหม่ภายหลัง' },
    });

    // Lookup MUST return null and MUST NOT automatically fabricate a new receipt!
    const voidLookup = await receiptService.getFinalReceiptForBill(dormitoryId, voidBill.id, ownerUserId);
    expect(voidLookup).toBeNull();

    const scopeReceipts = await prisma.receipt.findMany({
      where: { dormitoryId, settlementScopeKey: `ROOM_CYCLE:${voidRoom.id}:${cycle1Id}` },
    });
    expect(scopeReceipts).toHaveLength(1);
    expect(scopeReceipts[0].isVoided).toBe(true);

    // 2. Unsettled Guard: Unpaid bill fails closed (returns null)
    const unpaidBill = await prisma.bill.create({
      data: {
        dormitoryId,
        billingCycleId: cycle1Id,
        roomId: voidRoom.id,
        tenantId: tenantAId,
        billKind: 'MONTHLY_UTILITY',
        billNumber: `BILL-UNPAID-${Date.now().toString().slice(-4)}`,
        status: 'PENDING',
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-08-31'),
        subtotal: 800.0,
        totalAmount: 800.0,
        paidAmount: 0.0,
        outstandingAmount: 800.0,
      },
    });

    const unpaidLookup = await receiptService.getFinalReceiptForBill(dormitoryId, unpaidBill.id, ownerUserId);
    expect(unpaidLookup).toBeNull();
  });
});

