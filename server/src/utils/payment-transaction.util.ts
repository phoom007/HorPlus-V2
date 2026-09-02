/**
 * @license Apache-2.0
 * OWNER R3.8c — In-Transaction Cash Settlement, Group Receipts & Canonical Receipt Authority
 */

import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { AppError } from '../types/index.js';
import { computeCanonicalAllocationPlan } from './allocation.util.js';

export interface RecordCashPaymentInTxInput {
  dormitoryId: string;
  billId: string;
  amount: string | number | Prisma.Decimal | Decimal;
  userId?: string | null;
  idempotencyKey?: string | null;
  paymentDate?: Date | null;
  metadata?: any;
}

/**
 * Canonical in-transaction cash settlement authority (STRICTLY SINGLE-BILL).
 * Settle ONLY the selected Bill. NEVER auto-allocate to older/newer/deposit bills.
 */
export async function recordCashPaymentInTx(
  tx: any,
  input: RecordCashPaymentInTxInput
) {
  // 1. Acquire transaction-scoped row lock on Bill
  if (typeof tx.$executeRaw === 'function') {
    await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${input.billId}::uuid FOR UPDATE`;
  }

  // 2. Re-read locked Bill with active payments, line items, and existing allocations
  const bill = await tx.bill.findUnique({
    where: { id: input.billId },
    include: {
      items: true,
      dormitory: true,
      tenant: true,
      room: true,
      billingCycle: true,
      Payment: {
        where: { status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] } },
      },
      allocations: true,
    },
  });

  if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'BILL_NOT_FOUND');
  if (bill.dormitoryId !== input.dormitoryId) throw new AppError('ไม่มีสิทธิ์ดำเนินการกับบิลนี้', 403, 'FORBIDDEN');

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const totalAmount = bill.totalAmount !== undefined && bill.totalAmount !== null
    ? new Decimal(bill.totalAmount.toString())
    : bill.items.reduce((sum: Decimal, item: any) => sum.plus(new Decimal(item.amount.toString())), new Decimal(0));

  const existingPaidAmount = bill.paidAmount !== undefined && bill.paidAmount !== null
    ? new Decimal(bill.paidAmount.toString())
    : new Decimal('0.00');

  const currentOutstanding = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
    ? new Decimal(bill.outstandingAmount.toString())
    : Decimal.max(totalAmount.minus(existingPaidAmount), new Decimal(0));

  if (bill.status === 'PAID' || bill.status === 'paid' || currentOutstanding.lessThanOrEqualTo(0)) {
    throw new AppError('บิลนี้ได้รับการชำระเงินครบแล้ว', 400, 'ALREADY_PAID');
  }

  // Active Payment Guard: block if there is an active PENDING or UNDER_REVIEW submission
  const hasActivePendingPayment = bill.Payment?.some(
    (p: any) => p.status === 'PENDING' || p.status === 'UNDER_REVIEW'
  );
  if (hasActivePendingPayment) {
    throw new AppError('มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลนี้แล้ว', 409, 'PAYMENT_IN_PROGRESS');
  }

  const submitAmount = new Decimal(input.amount.toString());
  if (submitAmount.lessThanOrEqualTo(0) || submitAmount.greaterThan(currentOutstanding)) {
    throw new AppError('ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล', 400, 'UNSUPPORTED_AMOUNT');
  }

  // 3. Cash Authority: Server timestamp ONLY
  const now = new Date();
  const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
    ? input.userId
    : null;

  // 4. Create CombinedPaymentGroup for real monetary transaction
  const effectivePaymentDate = input.paymentDate !== undefined ? input.paymentDate : now;
  const group = await tx.combinedPaymentGroup.create({
    data: {
      dormitoryId: input.dormitoryId,
      tenantId: bill.tenantId,
      totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
      method: 'CASH',
      status: 'APPROVED',
      paymentDate: (effectivePaymentDate instanceof Date) ? effectivePaymentDate : now,
      recordedByUserId: safeUserId,
      idempotencyKey: input.idempotencyKey || null,
      notes: input.metadata?.notes || 'รับชำระด้วยเงินสด ณ เคาน์เตอร์',
    },
  });

  // Create bill target
  await tx.combinedPaymentGroupBillTarget.create({
    data: {
      dormitoryId: input.dormitoryId,
      paymentGroupId: group.id,
      billId: bill.id,
      targetOrder: 1,
    },
  });

  // 5. Create Payment record linked to group
  const payment = await tx.payment.create({
    data: {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      tenantId: bill.tenantId,
      paymentGroupId: group.id,
      method: 'CASH',
      amount: new Prisma.Decimal(submitAmount.toFixed(2)),
      status: 'APPROVED',
      paymentDate: effectivePaymentDate,
      reviewedByUserId: safeUserId,
      reviewedAt: now,
      metadata: input.metadata ? input.metadata : undefined,
      idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}-pay` : undefined,
    },
  });

  await tx.paymentStatusHistory.create({
    data: {
      dormitoryId: input.dormitoryId,
      paymentId: payment.id,
      fromStatus: null,
      toStatus: 'APPROVED',
      changedByUserId: safeUserId,
      effectiveAt: now,
    },
  });

  // 6. Check legacy unallocated paid baseline (Room 104 case)
  const existingAllocationsSum = (bill.allocations || []).reduce(
    (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
    new Decimal(0)
  );
  const legacyUnallocatedPaidAmount = Decimal.max(existingPaidAmount.minus(existingAllocationsSum), new Decimal(0));

  // Compute canonical allocation plan for this single bill
  const allocationPlan = computeCanonicalAllocationPlan({
    submitAmount,
    targetRoomId: bill.roomId,
    targetTenantId: bill.tenantId,
    eligibleBills: [
      {
        id: bill.id,
        dormitoryId: bill.dormitoryId,
        roomId: bill.roomId,
        tenantId: bill.tenantId,
        billNumber: bill.billNumber,
        billKind: bill.billKind,
        status: bill.status,
        billingDate: bill.billingDate,
        dueDate: bill.dueDate,
        totalAmount,
        paidAmount: existingPaidAmount,
        outstandingAmount: currentOutstanding,
        legacyUnallocatedPaidAmount,
        billingCycleId: bill.billingCycleId,
        billingCycle: bill.billingCycle,
        items: (bill.items || []).map((it: any) => {
          const itemAllocated = (bill.allocations || [])
            .filter((a: any) => a.billItemId === it.id)
            .reduce((sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())), new Decimal(0));
          return {
            id: it.id,
            type: it.type,
            code: it.code,
            description: it.description,
            amount: it.amount,
            displayOrder: it.displayOrder,
            allocatedAmount: itemAllocated,
          };
        }),
      },
    ],
  });

  // Persist allocations
  for (const alloc of allocationPlan.allocations) {
    await tx.paymentAllocation.create({
      data: {
        dormitoryId: input.dormitoryId,
        paymentGroupId: group.id,
        paymentId: payment.id,
        billId: bill.id,
        billItemId: alloc.billItemId || null,
        allocatedAmount: new Prisma.Decimal(alloc.allocatedAmount.toFixed(2)),
        allocationOrder: alloc.allocationOrder,
      },
    });
  }

  // 7. Update Bill balances and canonical status
  const newPaidAmount = existingPaidAmount.plus(submitAmount);
  const newOutstandingAmount = Decimal.max(totalAmount.minus(newPaidAmount), new Decimal(0));
  const newStatus = newOutstandingAmount.equals(0) ? 'PAID' : 'PARTIALLY_PAID';
  const prePaymentStatus = bill.status;

  await tx.billStatusHistory.create({
    data: {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      fromStatus: prePaymentStatus,
      toStatus: newStatus,
      changedByUserId: safeUserId,
      effectiveAt: now,
    },
  });

  await tx.bill.update({
    where: { id: bill.id },
    data: {
      status: newStatus,
      previousStatus: prePaymentStatus,
      paidAt: newStatus === 'PAID' ? now : (bill.paidAt ?? null),
      paidAmount: new Prisma.Decimal(newPaidAmount.toFixed(2)),
      outstandingAmount: new Prisma.Decimal(newOutstandingAmount.toFixed(2)),
    },
  });

  // 8. Generate sequential receipt tied to group, payment, and bill
  const receipt = await generateReceiptInTx(
    tx,
    payment.id,
    input.dormitoryId,
    bill.id,
    safeUserId,
    group.id,
    submitAmount
  );

  if (newStatus === 'PAID') {
    await generateFinalSettlementReceiptForBillInTx(tx, {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      userId: safeUserId,
    });
  }

  return {
    ...payment,
    group,
    receipt,
    allocatedAmount: submitAmount.toFixed(2),
    bill: {
      id: bill.id,
      billNumber: bill.billNumber,
      paidAmount: newPaidAmount.toFixed(2),
      outstandingAmount: newOutstandingAmount.toFixed(2),
      status: newStatus,
    },
  };
}

export interface RecordCombinedCashInTxInput {
  dormitoryId: string;
  billIds: string[];
  amount?: string | number | Prisma.Decimal | Decimal;
  userId?: string | null;
  idempotencyKey?: string | null;
  paymentDate?: Date | null;
  metadata?: any;
}

/**
 * Canonical grouped cash settlement for multiple bills belonging to the SAME tenant and SAME room.
 * Generates 1 CombinedPaymentGroup, child Payment allocations, and 1 consolidated Receipt.
 */
export async function recordCombinedCashPaymentInTx(
  tx: any,
  input: RecordCombinedCashInTxInput
) {
  const sortedBillIds = [...input.billIds].sort();
  if (sortedBillIds.length === 0) {
    throw new AppError('ต้องระบุรายการบิลอย่างน้อย 1 รายการ', 400, 'NO_BILLS_SPECIFIED');
  }

  // 1. Row locks in deterministic order
  if (typeof tx.$executeRaw === 'function') {
    for (const bid of sortedBillIds) {
      await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
    }
  }

  // 2. Fetch all bills with relations
  const bills = await tx.bill.findMany({
    where: { id: { in: sortedBillIds }, dormitoryId: input.dormitoryId },
    include: {
      items: { orderBy: { displayOrder: 'asc' } },
      billingCycle: true,
      room: true,
      tenant: true,
      allocations: true,
      Payment: { where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } } },
    },
  });

  if (bills.length !== sortedBillIds.length) {
    throw new AppError('พบรายการบิลไม่ครบถ้วน', 404, 'NOT_FOUND');
  }

  // 3. Validate strict single room + single tenant invariant (Cross-room grouping is forbidden)
  const firstRoomId = bills[0].roomId;
  const firstTenantId = bills[0].tenantId;
  for (const b of bills) {
    if (b.roomId !== firstRoomId) throw new AppError('ไม่อนุญาตให้รวมบิลข้ามห้องพัก', 400, 'FORBIDDEN_CROSS_ROOM');
    if (b.tenantId !== firstTenantId) throw new AppError('บิลทั้งหมดต้องเป็นของผู้เช่ารายเดียวกัน', 400, 'FORBIDDEN_DIFFERENT_TENANT');
    if (b.status === 'PAID' || b.status === 'paid') throw new AppError(`บิล ${b.billNumber || b.id} ได้รับการชำระเงินครบแล้ว`, 400, 'ALREADY_PAID');
    if (b.Payment && b.Payment.length > 0) throw new AppError('มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลในกลุ่มนี้แล้ว', 409, 'PAYMENT_IN_PROGRESS');
  }

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  let totalOutstanding = new Decimal(0);
  for (const b of bills) {
    const bTot = b.totalAmount !== null && b.totalAmount !== undefined ? new Decimal(b.totalAmount.toString()) : new Decimal(0);
    const bPaid = b.paidAmount !== null && b.paidAmount !== undefined ? new Decimal(b.paidAmount.toString()) : new Decimal(0);
    const bOut = b.outstandingAmount !== null && b.outstandingAmount !== undefined ? new Decimal(b.outstandingAmount.toString()) : Decimal.max(bTot.minus(bPaid), new Decimal(0));
    totalOutstanding = totalOutstanding.plus(bOut);
  }

  const submitAmount = input.amount !== undefined ? new Decimal(input.amount.toString()) : totalOutstanding;
  if (submitAmount.lessThanOrEqualTo(0) || submitAmount.greaterThan(totalOutstanding)) {
    throw new AppError('ยอดเงินที่ชำระไม่ถูกต้อง', 400, 'UNSUPPORTED_AMOUNT');
  }

  const now = new Date();
  const effectivePaymentDate = input.paymentDate !== undefined ? input.paymentDate : now;
  const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
    ? input.userId
    : null;

  // 4. Create CombinedPaymentGroup
  const group = await tx.combinedPaymentGroup.create({
    data: {
      dormitoryId: input.dormitoryId,
      tenantId: firstTenantId,
      totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
      method: 'CASH',
      status: 'APPROVED',
      paymentDate: (effectivePaymentDate instanceof Date) ? effectivePaymentDate : now,
      recordedByUserId: safeUserId,
      idempotencyKey: input.idempotencyKey || null,
      notes: input.metadata?.notes || 'รับชำระเงินสดแบบรวมบิล ณ เคาน์เตอร์',
    },
  });

  let order = 1;
  for (const b of bills) {
    await tx.combinedPaymentGroupBillTarget.create({
      data: {
        dormitoryId: input.dormitoryId,
        paymentGroupId: group.id,
        billId: b.id,
        targetOrder: order++,
      },
    });
  }

  const eligibleBills = bills.map((b: any) => {
    const totalAmount = new Decimal(b.totalAmount.toString());
    const paidAmount = b.paidAmount ? new Decimal(b.paidAmount.toString()) : new Decimal(0);
    const outstandingAmount = b.outstandingAmount ? new Decimal(b.outstandingAmount.toString()) : totalAmount.minus(paidAmount);
    const existingAllocSum = (b.allocations || []).reduce((sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())), new Decimal(0));
    const legacyUnallocatedPaidAmount = Decimal.max(paidAmount.minus(existingAllocSum), new Decimal(0));
    return {
      id: b.id,
      dormitoryId: b.dormitoryId,
      roomId: b.roomId,
      tenantId: b.tenantId,
      billNumber: b.billNumber,
      billKind: b.billKind,
      status: b.status,
      billingDate: b.billingDate,
      dueDate: b.dueDate,
      totalAmount,
      paidAmount,
      outstandingAmount,
      legacyUnallocatedPaidAmount,
      billingCycleId: b.billingCycleId,
      billingCycle: b.billingCycle,
      items: (b.items || []).map((it: any) => {
        return {
          id: it.id,
          type: it.type,
          code: it.code,
          description: it.description,
          amount: it.amount,
          displayOrder: it.displayOrder,
        };
      }),
    };
  });

  const plan = computeCanonicalAllocationPlan({
    submitAmount,
    targetRoomId: firstRoomId,
    targetTenantId: firstTenantId,
    eligibleBills,
  });

  const childPayments: any[] = [];
  const groupReceiptSnapshots: GroupReceiptBillSnapshot[] = [];

  for (const billPlan of plan.affectedBills) {
    if (billPlan.allocatedAmount.greaterThan(0)) {
      const targetBill = bills.find((b: any) => b.id === billPlan.id);
      if (!targetBill) continue;
      const allocatedDec = billPlan.allocatedAmount;

      const payment = await tx.payment.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: billPlan.id,
          tenantId: firstTenantId,
          paymentGroupId: group.id,
          method: 'CASH',
          amount: new Prisma.Decimal(allocatedDec.toFixed(2)),
          status: 'APPROVED',
          paymentDate: effectivePaymentDate,
          reviewedByUserId: safeUserId,
          reviewedAt: now,
          metadata: input.metadata ? input.metadata : undefined,
        },
      });

      await tx.paymentStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          paymentId: payment.id,
          fromStatus: null,
          toStatus: 'APPROVED',
          changedByUserId: safeUserId,
          effectiveAt: now,
        },
      });

      const billItemAllocs = plan.allocations.filter(a => a.billId === billPlan.id);
      for (const itemPlan of billItemAllocs) {
        if (itemPlan.allocatedAmount.greaterThan(0)) {
          await tx.paymentAllocation.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              billId: billPlan.id,
              billItemId: itemPlan.billItemId,
              allocatedAmount: new Prisma.Decimal(itemPlan.allocatedAmount.toFixed(2)),
            },
          });
        }
      }

      const prevPaid = targetBill.paidAmount ? new Decimal(targetBill.paidAmount.toString()) : new Decimal(0);
      const newPaid = prevPaid.plus(allocatedDec);
      const billTotal = new Decimal(targetBill.totalAmount.toString());
      const newOut = Decimal.max(billTotal.minus(newPaid), new Decimal(0));
      const newStat = newOut.equals(0) ? 'PAID' : 'PARTIALLY_PAID';

      await tx.billStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: targetBill.id,
          fromStatus: targetBill.status,
          toStatus: newStat,
          changedByUserId: safeUserId,
          effectiveAt: now,
        },
      });

      await tx.bill.update({
        where: { id: targetBill.id },
        data: {
          status: newStat,
          previousStatus: targetBill.status,
          paidAt: newStat === 'PAID' ? now : (targetBill.paidAt ?? null),
          paidAmount: new Prisma.Decimal(newPaid.toFixed(2)),
          outstandingAmount: new Prisma.Decimal(newOut.toFixed(2)),
        },
      });

      childPayments.push(payment);
      groupReceiptSnapshots.push(buildBillGroupSnapshot(targetBill, allocatedDec));
    }
  }

  // 5. Generate exactly 1 combined Receipt
  const firstBill = bills[0];
  const receipt = await generateGroupReceiptInTx({
    tx,
    dormitoryId: input.dormitoryId,
    paymentGroupId: group.id,
    totalAmount: submitAmount,
    billGroups: groupReceiptSnapshots,
    userId: safeUserId,
    roomNumber: firstBill.room?.roomNumber || 'GEN',
    tenantName: firstBill.tenant?.displayName || 'ผู้เช่า',
    paymentMethod: 'CASH',
    paymentDate: effectivePaymentDate || undefined,
  });

  for (const aff of plan.affectedBills) {
    if (aff.newStatus === 'PAID') {
      await generateFinalSettlementReceiptForBillInTx(tx, {
        dormitoryId: input.dormitoryId,
        billId: aff.id,
        userId: safeUserId,
      });
    }
  }

  return {
    group,
    payments: childPayments,
    receipt,
    totalAmount: submitAmount.toFixed(2),
  };
}

export interface GroupReceiptBillSnapshot {
  billId: string;
  billNumber: string | null;
  billKind: string | null;
  cycleCode: string | null;
  billTotal: string;
  allocatedAmount: string;
  items: Array<{
    type: string;
    description: string;
    quantity: string;
    unit: string | null;
    unitPrice: string | null;
    amount: string;
    metadata: any;
  }>;
}

/**
 * Maps and deterministically orders persisted BillItems (displayOrder ASC) for immutable receipt snapshotting.
 */
export function mapBillItemsToSnapshot(items: any[] | undefined | null) {
  if (!items || items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const orderA = typeof a.displayOrder === 'number' ? a.displayOrder : 0;
    const orderB = typeof b.displayOrder === 'number' ? b.displayOrder : 0;
    return orderA - orderB;
  });

  return sorted.map((i: any) => ({
    type: i.type || 'other',
    description: i.description,
    quantity: new Decimal((i.quantity ?? 1).toString()).toFixed(2),
    unit: i.unit || null,
    unitPrice: i.unitPrice ? new Decimal(i.unitPrice.toString()).toFixed(2) : '0.00',
    amount: new Decimal(i.amount.toString()).toFixed(2),
    metadata: i.metadata ? JSON.parse(JSON.stringify(i.metadata)) : null,
  }));
}

/**
 * Builds an authoritative GroupReceiptBillSnapshot from a target bill and allocated amount.
 */
export function buildBillGroupSnapshot(
  targetBill: any,
  allocatedAmount: Decimal | string | number
): GroupReceiptBillSnapshot {
  const billTotalStr = targetBill.totalAmount !== undefined && targetBill.totalAmount !== null
    ? new Decimal(targetBill.totalAmount.toString()).toFixed(2)
    : new Decimal(allocatedAmount.toString()).toFixed(2);
  const allocatedStr = new Decimal(allocatedAmount.toString()).toFixed(2);

  let items: any[] = [];
  if (targetBill.items && targetBill.items.length > 0) {
    items = mapBillItemsToSnapshot(targetBill.items);
  } else {
    items = [
      {
        type: 'payment',
        description: `ชำระบิล ${targetBill.billNumber || targetBill.id}`.trim(),
        quantity: '1.00',
        unit: null,
        unitPrice: allocatedStr,
        amount: allocatedStr,
        metadata: null,
      },
    ];
  }

  return {
    billId: targetBill.id,
    billNumber: targetBill.billNumber || null,
    billKind: targetBill.billKind || null,
    cycleCode: targetBill.billingCycle?.cycleCode || null,
    billTotal: billTotalStr,
    allocatedAmount: allocatedStr,
    items,
  };
}

/**
 * Generates sequential receipt in locked format RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
 * Preserves FULL historical gross BillItems and Tier metadata regardless of full or partial payment.
 */
export async function generateReceiptInTx(
  tx: any,
  paymentId: string | null,
  dormitoryId: string,
  billId: string | null,
  userId?: string | null,
  paymentGroupId?: string | null,
  customTotalAmount?: Decimal
) {
  const today = new Date();
  const yearMonth = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  const seq = await tx.receiptSequence.upsert({
    where: {
      dormitory_receipt_seq_unique: {
        dormitoryId,
        yearMonth,
      },
    },
    create: {
      dormitoryId,
      yearMonth,
      lastValue: 1,
    },
    update: {
      lastValue: { increment: 1 },
    },
  });

  let bill: any = null;
  if (billId) {
    bill = await tx.bill.findUnique({
      where: { id: billId },
      include: {
        items: {
          orderBy: { displayOrder: 'asc' },
        },
        dormitory: true,
        tenant: true,
        room: true,
        billingCycle: true,
      },
    });
  }

  const rawRoomNumber = bill?.room?.normalizedRoomNumber || bill?.room?.roomNumber || 'GEN';
  const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
  const sequenceStr = String(seq.lastValue).padStart(4, '0');

  // Locked format: RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
  const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

  let payment: any = null;
  if (paymentId) {
    payment = await tx.payment.findUnique({ where: { id: paymentId } });
  }

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const paymentAmount = customTotalAmount || (payment ? new Decimal(payment.amount.toString()) : new Decimal('0.00'));
  const billTotal = bill?.totalAmount ? new Decimal(bill.totalAmount.toString()) : paymentAmount;

  // Snapshot full historical gross BillItems whenever persisted BillItems exist
  let receiptItems: any[] = [];
  if (bill?.items && bill.items.length > 0) {
    receiptItems = mapBillItemsToSnapshot(bill.items);
  } else {
    // Safe generic fallback for legacy bills without persisted BillItems
    const billRef = bill?.billNumber || bill?.id || '';
    const isDeposit = bill?.billKind === 'DEPOSIT' || bill?.billKind === 'deposit';
    const label = isDeposit ? 'ชำระเงินประกัน' : 'ชำระยอดคงเหลือบิล';
    receiptItems = [
      {
        type: 'payment',
        description: `${label} ${billRef}`.trim(),
        quantity: '1.00',
        unit: null,
        unitPrice: paymentAmount.toFixed(2),
        amount: paymentAmount.toFixed(2),
        metadata: null,
      },
    ];
  }

  let receiverDisplayName = 'ฝ่ายการเงิน หอพัก HorPlus';
  if (userId) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (user?.name) {
      receiverDisplayName = user.name;
    }
  }

  const isHistoricalPayment = Boolean(
    payment?.metadata?.isHistoricalImport ||
    (payment?.metadata && typeof payment.metadata === 'object' && (payment.metadata as any).isHistoricalImport) ||
    (payment as any)?.isHistoricalImport
  );
  const originalPaymentDateKnown = isHistoricalPayment
    ? Boolean(payment?.metadata?.originalPaymentDateKnown ?? (payment?.paymentDate ? true : false))
    : true;
  const originalPaymentDate = (isHistoricalPayment && !originalPaymentDateKnown)
    ? null
    : (payment?.paymentDate ? payment.paymentDate.toISOString() : (isHistoricalPayment ? null : today.toISOString()));
  const importedAt = isHistoricalPayment
    ? (payment?.metadata?.importedAt || (payment?.metadata as any)?.importedAt || today.toISOString())
    : undefined;

  const snapshotData = {
    receiptNumber,
    billNumber: bill?.billNumber || null,
    total: paymentAmount.toFixed(2),
    receivedAmount: paymentAmount.toFixed(2),
    billTotal: billTotal.toFixed(2),
    allocatedAmount: paymentAmount.toFixed(2),
    items: receiptItems,
    roomNumber: bill?.room?.roomNumber || 'GEN',
    tenantName: bill?.tenant?.displayName || bill?.tenant?.firstName ? `${bill.tenant.firstName || ''} ${bill.tenant.lastName || ''}`.trim() : 'ผู้เช่า',
    dormitoryName: bill?.dormitory?.name || 'หอพัก HorPlus',
    dormitoryTaxId: bill?.dormitory?.taxId || null,
    dormitoryAddress: bill?.dormitory?.address || null,
    dormitoryPhone: bill?.dormitory?.phone || null,
    paymentMethod: payment?.method || 'CASH',
    paymentDate: originalPaymentDate,
    isHistoricalImport: isHistoricalPayment,
    originalPaymentDateKnown,
    importedAt,
    receiverName: receiverDisplayName,
    isCombinedReceipt: false,
  };

  const receipt = await tx.receipt.create({
    data: {
      dormitoryId,
      paymentId: paymentId || undefined,
      paymentGroupId: paymentGroupId || undefined,
      billId: billId || undefined,
      receiptNumber,
      snapshotData,
      issuedByUserId: userId || null,
      issuedAt: today,
    },
  });

  return receipt;
}

/**
 * Dedicated Group Receipt Generation: Exactly 1 Receipt per Combined Monetary Event.
 * Preserves per-bill gross BillItems, allocated amounts, and Tier metadata in snapshotData.billGroups.
 * Enforces SUM(billGroups[].allocatedAmount) == totalAmount invariant before creation.
 */
export async function generateGroupReceiptInTx(params: {
  tx: any;
  dormitoryId: string;
  paymentGroupId: string;
  totalAmount: Decimal;
  receiptItems?: Array<{ description: string; amount: string }>;
  billGroups?: GroupReceiptBillSnapshot[];
  userId?: string | null;
  roomNumber?: string;
  tenantName?: string;
  paymentMethod?: string;
  paymentDate?: Date;
  isHistoricalImport?: boolean;
}) {
  const { tx, dormitoryId, paymentGroupId, totalAmount, userId } = params;
  const today = new Date();
  const yearMonth = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  const seq = await tx.receiptSequence.upsert({
    where: {
      dormitory_receipt_seq_unique: {
        dormitoryId,
        yearMonth,
      },
    },
    create: {
      dormitoryId,
      yearMonth,
      lastValue: 1,
    },
    update: {
      lastValue: { increment: 1 },
    },
  });

  const rawRoomNumber = params.roomNumber || 'GEN';
  const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
  const sequenceStr = String(seq.lastValue).padStart(4, '0');
  const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

  let receiverDisplayName = 'ฝ่ายการเงิน หอพัก HorPlus';
  if (userId) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (user?.name) {
      receiverDisplayName = user.name;
    }
  }

  const dorm = await tx.dormitory.findUnique({ where: { id: dormitoryId }, select: { name: true, addressLine1: true, phone: true } });

  // Resolve authoritative billGroups: use passed parameter or atomically construct inside tx
  let billGroups = params.billGroups;
  if (!billGroups || billGroups.length === 0) {
    const targets = await tx.combinedPaymentGroupBillTarget.findMany({
      where: { paymentGroupId },
      include: {
        bill: {
          include: {
            items: { orderBy: { displayOrder: 'asc' } },
            billingCycle: true,
          },
        },
      },
      orderBy: { targetOrder: 'asc' },
    });

    const allocations = await tx.paymentAllocation.findMany({
      where: { paymentGroupId },
    });

    billGroups = targets.map((t: any) => {
      const b = t.bill;
      const billAllocations = allocations.filter((a: any) => a.billId === b.id);
      const totalAllocForBill = billAllocations.reduce(
        (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
        new Decimal(0)
      );

      return buildBillGroupSnapshot(b, totalAllocForBill);
    });
  }

  const finalBillGroups = billGroups || [];

  // Group Receipt Boundary Invariant: SUM(allocatedAmount) MUST equal totalAmount
  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const sumAllocated = finalBillGroups.reduce(
    (sum: Decimal, bg) => sum.plus(new Decimal(bg.allocatedAmount.toString())),
    new Decimal(0)
  );

  if (!sumAllocated.equals(totalAmount)) {
    throw new AppError(
      `ยอดรวมจัดสรรของบิล (${sumAllocated.toFixed(2)}) ไม่ตรงกับยอดเงินที่รับชำระ (${totalAmount.toFixed(2)})`,
      400,
      'GROUP_RECEIPT_ALLOCATION_MISMATCH'
    );
  }

  const isHistoricalPayment = Boolean(params.isHistoricalImport);
  const originalPaymentDateKnown = isHistoricalPayment ? Boolean(params.paymentDate) : true;
  const originalPaymentDate = (isHistoricalPayment && !originalPaymentDateKnown)
    ? null
    : (params.paymentDate ? params.paymentDate.toISOString() : (isHistoricalPayment ? null : today.toISOString()));
  const importedAt = isHistoricalPayment ? today.toISOString() : undefined;

  const legacyReceiptItems = finalBillGroups.flatMap((bg: any) => bg.items || []);

  const snapshotData = {
    receiptNumber,
    billNumber: null,
    total: totalAmount.toFixed(2),
    receivedAmount: totalAmount.toFixed(2),
    items: legacyReceiptItems,
    billGroups: finalBillGroups,
    roomNumber: params.roomNumber || 'GEN',
    tenantName: params.tenantName || 'ผู้เช่า',
    dormitoryName: dorm?.name || 'หอพัก HorPlus',
    dormitoryTaxId: null,
    dormitoryAddress: dorm?.addressLine1 || null,
    dormitoryPhone: dorm?.phone || null,
    paymentMethod: params.paymentMethod || 'BANK_TRANSFER',
    paymentDate: originalPaymentDate,
    isHistoricalImport: isHistoricalPayment,
    originalPaymentDateKnown,
    importedAt,
    receiverName: receiverDisplayName,
    isCombinedReceipt: true,
  };

  const receipt = await tx.receipt.create({
    data: {
      dormitoryId,
      paymentGroupId,
      paymentId: null,
      billId: null,
      receiptNumber,
      snapshotData,
      issuedByUserId: userId || null,
      issuedAt: today,
    },
  });

  return receipt;
}

/**
 * Generates or retrieves the canonical FINAL_SETTLEMENT receipt for a fully settled bill (Monthly / Term).
 * Invariant: Exactly ONE Final Receipt per (dormitoryId, settlementScopeKey = "ROOM_CYCLE:{roomId}:{billingCycleId}").
 * Fully idempotent, concurrency-safe, and preserves all underlying transaction history.
 */
export async function generateFinalSettlementReceiptForBillInTx(
  tx: any,
  params: {
    dormitoryId: string;
    billId: string;
    userId?: string | null;
  }
) {
  const { dormitoryId, billId, userId } = params;

  if (!billId || !/^[0-9a-fA-F-]{36}$/.test(billId)) {
    return null;
  }

  // 1. Load seed Bill and validate basic dormitory / room / cycle identity
  const seedBill = await tx.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      dormitoryId: true,
      roomId: true,
      billingCycleId: true,
      status: true,
      cancelledAt: true,
    },
  });

  const isCanonicalInvalidatedOrNonIssued = (status?: string | null) => {
    if (!status) return true;
    const s = status.trim().toUpperCase();
    return ['DRAFT', 'CANCELLED', 'VOID', 'VOIDED', 'WITHDRAWN', 'SUPERSEDED'].includes(s);
  };

  if (!seedBill || seedBill.cancelledAt || isCanonicalInvalidatedOrNonIssued(seedBill.status) || seedBill.dormitoryId !== dormitoryId || !seedBill.roomId || !seedBill.billingCycleId) {
    return null;
  }

  const settlementScopeKey = `ROOM_CYCLE:${seedBill.roomId}:${seedBill.billingCycleId}`;

  // 2. Deterministic PostgreSQL Transaction Advisory Lock on settlement scope key
  if (typeof tx.$executeRaw === 'function') {
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'FINAL_RECEIPT:' + dormitoryId + ':' + settlementScopeKey}));`;
    } catch {
      // Ignore if DB does not support pg_advisory_xact_lock (e.g. test mocks)
    }
  }

  // 3. Check if an active non-voided Final Settlement receipt already exists under lock
  const existing = tx.receipt?.findFirst
    ? await tx.receipt.findFirst({
        where: {
          dormitoryId,
          settlementScopeKey,
          receiptKind: 'FINAL_SETTLEMENT',
          isVoided: false,
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  if (existing) {
    return existing;
  }

  // 4. Re-read ALL financial obligations / Bills belonging to the same room + billing cycle scope
  const allBills = await tx.bill.findMany({
    where: {
      dormitoryId,
      roomId: seedBill.roomId,
      billingCycleId: seedBill.billingCycleId,
      cancelledAt: null,
      status: {
        notIn: [
          'draft', 'DRAFT',
          'cancelled', 'CANCELLED',
          'void', 'VOID',
          'voided', 'VOIDED',
          'withdrawn', 'WITHDRAWN',
          'superseded', 'SUPERSEDED',
        ],
      },
    },
    include: {
      items: { orderBy: { displayOrder: 'asc' } },
      Payment: {
        where: { status: 'APPROVED' },
        include: {
          verification: true,
          receipt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      dormitory: true,
      tenant: true,
      room: true,
      billingCycle: true,
      contract: true,
      provisionalRentalTerm: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Filter out any bill whose status matches canonical invalidation semantics normalized
  const scopeBills = allBills.filter(
    (b: any) => !b.cancelledAt && !isCanonicalInvalidatedOrNonIssued(b.status)
  );

  if (!scopeBills || scopeBills.length === 0) {
    return null;
  }

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });

  // 5. Strict outstanding === 0 & status verification (Requirement 4)
  for (const b of scopeBills) {
    const statusNorm = (b.status || '').trim().toUpperCase();
    if (statusNorm !== 'PAID') {
      return null;
    }

    const outDec = new Decimal((b.outstandingAmount ?? 0).toString());
    const totalDec = new Decimal((b.totalAmount ?? 0).toString());
    const paidDec = new Decimal((b.paidAmount ?? 0).toString());

    if (
      outDec.isNaN() ||
      totalDec.isNaN() ||
      paidDec.isNaN() ||
      !outDec.isZero() || // Authoritative outstanding MUST equal exactly zero (positive or negative < 0 fails closed)
      totalDec.lessThanOrEqualTo(0) || // Bill must have positive agreed obligation
      !paidDec.equals(totalDec) // Paid amount must strictly equal total amount
    ) {
      // Scope is not fully settled or has invalid outstanding! Fail closed.
      return null;
    }
  }

  // 6. Tenant Context & Rental Context Compatibility - B1 (Requirements 6 & 7)
  const tenantIds = Array.from(new Set(scopeBills.map((b: any) => b.tenantId).filter(Boolean)));
  if (tenantIds.length !== 1 || scopeBills.some((b: any) => !b.tenantId)) {
    // Multiple distinct tenants or missing tenant context -> FAIL CLOSED
    return null;
  }
  const canonicalTenantId = tenantIds[0] as string;

  const contractIds = Array.from(new Set(scopeBills.map((b: any) => b.contractId).filter(Boolean)));
  if (contractIds.length > 1) {
    // Multiple distinct contracts in the same scope -> FAIL CLOSED
    return null;
  }
  const canonicalContractId = contractIds.length === 1 ? (contractIds[0] as string) : null;

  const termIds = Array.from(new Set(scopeBills.map((b: any) => b.provisionalRentalTermId).filter(Boolean)));
  if (termIds.length > 1) {
    // Multiple distinct provisional terms in the same scope -> FAIL CLOSED
    return null;
  }
  const canonicalTermId = termIds.length === 1 ? (termIds[0] as string) : null;

  // Cross-incompatibility: Both a contract and a provisional term present in the same room-cycle scope -> FAIL CLOSED
  if (canonicalContractId && canonicalTermId) {
    return null;
  }

  const scopeTotal = scopeBills.reduce((sum: Decimal, b: any) => sum.plus(new Decimal((b.totalAmount ?? 0).toString())), new Decimal(0));
  const scopePaid = scopeBills.reduce((sum: Decimal, b: any) => sum.plus(new Decimal((b.paidAmount ?? 0).toString())), new Decimal(0));

  if (scopeTotal.isZero() || !scopePaid.equals(scopeTotal)) {
    return null;
  }

  const today = new Date();
  const yearMonth = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  const seq = await tx.receiptSequence.upsert({
    where: {
      dormitory_receipt_seq_unique: {
        dormitoryId,
        yearMonth,
      },
    },
    create: {
      dormitoryId,
      yearMonth,
      lastValue: 1,
    },
    update: {
      lastValue: { increment: 1 },
    },
  });

  const firstBill = scopeBills[0];
  const rawRoomNumber = firstBill.room?.normalizedRoomNumber || firstBill.room?.roomNumber || 'GEN';
  const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
  const sequenceStr = String(seq.lastValue).padStart(4, '0');
  const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

  let receiverDisplayName = 'ฝ่ายการเงิน หอพัก HorPlus';
  if (userId) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (user?.name) {
      receiverDisplayName = user.name;
    }
  }

  // 7. Aggregate whole-scope line items, bill groups, and real payment event history
  const billGroups = scopeBills.map((b: any) => ({
    billId: b.id,
    billNumber: b.billNumber || null,
    billKind: b.billKind || 'MONTHLY',
    cycleCode: b.billingCycle?.cycleCode || null,
    billTotal: new Decimal(b.totalAmount.toString()).toFixed(2),
    paidAmount: new Decimal(b.paidAmount.toString()).toFixed(2),
    status: b.status,
    items: (b.items || []).map((it: any) => ({
      type: it.type || 'other',
      description: it.description,
      quantity: it.quantity ? new Decimal(it.quantity.toString()).toFixed(2) : '1.00',
      unit: it.unit || null,
      unitPrice: it.unitPrice ? new Decimal(it.unitPrice.toString()).toFixed(2) : '0.00',
      amount: new Decimal(it.amount.toString()).toFixed(2),
      metadata: it.metadata ? JSON.parse(JSON.stringify(it.metadata)) : null,
    })),
  }));

  const flatItems = scopeBills.flatMap((b: any) => (b.items && b.items.length > 0 ? mapBillItemsToSnapshot(b.items) : []));

  const paymentEvents = scopeBills.flatMap((b: any) =>
    ((b as any).Payment || []).map((p: any) => ({
      paymentId: p.id,
      billId: b.id,
      paymentGroupId: p.paymentGroupId || null,
      amount: new Decimal(p.amount.toString()).toFixed(2),
      method: p.method || 'CASH',
      effectivePaymentDate: p.paymentDate ? p.paymentDate.toISOString() : (p.reviewedAt ? p.reviewedAt.toISOString() : p.createdAt.toISOString()),
      paymentDate: p.paymentDate ? p.paymentDate.toISOString() : (p.reviewedAt ? p.reviewedAt.toISOString() : p.createdAt.toISOString()),
      evidenceReference: p.verification?.objectKey || p.evidenceUrl || null,
      receiptNumber: p.receipt?.receiptNumber || null,
      status: p.status,
    }))
  );

  // 8. Snapshot Tenant Authority - populated only after tenant/rental compatibility passes (Requirement 8)
  const tenantBill = scopeBills.find((b: any) => b.tenant && b.tenant.id === canonicalTenantId) || firstBill;
  const canonicalTenant = tenantBill.tenant;
  const resolvedTenantName = canonicalTenant?.displayName ||
    (canonicalTenant?.firstName ? `${canonicalTenant.firstName || ''} ${canonicalTenant.lastName || ''}`.trim() : 'ผู้เช่า');

  const snapshotData = {
    receiptNumber,
    billNumber: scopeBills.map((b: any) => b.billNumber).filter(Boolean).join(', ') || firstBill.billNumber || null,
    billIds: scopeBills.map((b: any) => b.id),
    tenantId: canonicalTenantId,
    contractId: canonicalContractId,
    provisionalRentalTermId: canonicalTermId,
    cycleCode: firstBill.billingCycle?.cycleCode || null,
    cycleLabel: firstBill.billingCycle?.name || firstBill.billingCycle?.cycleCode || null,
    total: scopeTotal.toFixed(2),
    receivedAmount: scopePaid.toFixed(2),
    billTotal: scopeTotal.toFixed(2),
    items: flatItems,
    billGroups,
    paymentEvents,
    roomNumber: firstBill.room?.roomNumber || 'GEN',
    tenantName: resolvedTenantName,
    dormitoryName: firstBill.dormitory?.name || 'หอพัก HorPlus',
    dormitoryTaxId: firstBill.dormitory?.taxId || null,
    dormitoryAddress: firstBill.dormitory?.addressLine1 || firstBill.dormitory?.address || null,
    dormitoryPhone: firstBill.dormitory?.phone || null,
    paymentMethod: 'SETTLED',
    paymentDate: today.toISOString(),
    receiverName: receiverDisplayName,
    isFinalSettlement: true,
    isMultiBill: scopeBills.length > 1,
  };

  try {
    const receipt = await tx.receipt.create({
      data: {
        dormitoryId,
        billId: seedBill.id,
        roomId: seedBill.roomId,
        billingCycleId: seedBill.billingCycleId,
        receiptKind: 'FINAL_SETTLEMENT',
        settlementScopeKey,
        receiptNumber,
        snapshotData,
        issuedByUserId: userId || null,
        issuedAt: today,
      },
    });

    return receipt;
  } catch (err: any) {
    if (err.code === 'P2002' || err.message?.includes('Unique constraint failed') || err.message?.includes('receipts_active_final_settlement_unique')) {
      const raceWinner = await tx.receipt.findFirst({
        where: {
          dormitoryId,
          settlementScopeKey,
          receiptKind: 'FINAL_SETTLEMENT',
          isVoided: false,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (raceWinner) return raceWinner;
    }
    throw err;
  }
}

/**
 * Generates or retrieves the canonical FINAL_SETTLEMENT receipt for a fully settled Daily Stay Invoice.
 * Invariant: Exactly ONE active Final Receipt per (dormitoryId, settlementScopeKey = "DAILY_INVOICE:{dailyStayInvoiceId}").
 * Historical voided receipts are preserved (0..N voided, max 1 active).
 * Zero obligation produces no receipt.
 */
export async function generateFinalSettlementReceiptForDailyInvoiceInTx(
  tx: any,
  params: {
    dormitoryId: string;
    dailyStayInvoiceId: string;
    userId?: string | null;
  }
) {
  const { dormitoryId, dailyStayInvoiceId, userId } = params;

  if (!dailyStayInvoiceId || !/^[0-9a-fA-F-]{36}$/.test(dailyStayInvoiceId)) {
    return null;
  }

  const invoice = await tx.dailyStayInvoice.findUnique({
    where: { id: dailyStayInvoiceId },
    include: {
      items: true,
      dormitory: true,
      dailyStay: {
        include: {
          room: true,
          tenant: true,
        },
      },
    },
  });

  if (!invoice || invoice.deletedAt || invoice.dormitoryId !== dormitoryId) {
    return null;
  }

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const totalAgreed = new Decimal(invoice.totalAgreedAmount.toString());
  const outDec = new Decimal((invoice.outstandingAmount ?? 0).toString());
  const invoiceStatus = (invoice.status || '').trim().toUpperCase();

  // Fail closed: Zero obligation, or un-settled invoice, or negative outstanding produces no receipt (Requirement 4)
  if (
    totalAgreed.lessThanOrEqualTo(0) ||
    totalAgreed.isNaN() ||
    outDec.isNaN() ||
    !outDec.isZero() || // Authoritative outstanding MUST equal exactly zero
    invoiceStatus !== 'PAID'
  ) {
    return null;
  }

  const settlementScopeKey = `DAILY_INVOICE:${invoice.id}`;

  // Deterministic locking for Daily Stay Invoice scope
  if (typeof tx.$executeRaw === 'function') {
    try {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'FINAL_RECEIPT:' + dormitoryId + ':' + settlementScopeKey}));`;
    } catch {
      // Ignore if DB does not support advisory lock
    }
  }

  const existing = tx.receipt?.findFirst
    ? await tx.receipt.findFirst({
        where: {
          dormitoryId,
          settlementScopeKey,
          receiptKind: 'FINAL_SETTLEMENT',
          isVoided: false,
        },
        orderBy: { createdAt: 'desc' },
      })
    : null;

  if (existing) {
    return existing;
  }

  const today = new Date();
  const yearMonth = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  const seq = await tx.receiptSequence.upsert({
    where: {
      dormitory_receipt_seq_unique: {
        dormitoryId,
        yearMonth,
      },
    },
    create: {
      dormitoryId,
      yearMonth,
      lastValue: 1,
    },
    update: {
      lastValue: { increment: 1 },
    },
  });

  const rawRoomNumber = invoice.dailyStay?.room?.normalizedRoomNumber || invoice.dailyStay?.room?.roomNumber || 'GEN';
  const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
  const sequenceStr = String(seq.lastValue).padStart(4, '0');
  const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

  let receiverDisplayName = 'ฝ่ายการเงิน หอพัก HorPlus';
  if (userId) {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (user?.name) {
      receiverDisplayName = user.name;
    }
  }

  const receiptItems = invoice.items.map((it: any) => ({
    type: it.itemType === 'DAILY_RENT' ? 'rent' : (it.itemType === 'DEPOSIT' ? 'deposit' : 'other'),
    description: it.description || (it.itemType === 'DAILY_RENT' ? 'ค่าเช่าห้องพักรายวัน' : 'เงินประกันห้องพัก'),
    quantity: '1.00',
    unit: it.itemType === 'DAILY_RENT' ? 'day' : null,
    unitPrice: new Decimal(it.amount.toString()).toFixed(2),
    amount: new Decimal(it.amount.toString()).toFixed(2),
    metadata: null,
  }));

  const paymentEvents = (invoice.items || [])
    .filter((it: any) => it.paidAt)
    .map((it: any) => ({
      paymentId: `daily-item-${it.id}`,
      itemType: it.itemType,
      amount: new Decimal(it.amount.toString()).toFixed(2),
      method: 'CASH',
      effectivePaymentDate: it.paidAt.toISOString(),
      paymentDate: it.paidAt.toISOString(),
      evidenceReference: null,
      receiptNumber: null,
      status: 'APPROVED',
    }));

  const snapshotData = {
    receiptNumber,
    invoiceNumber: invoice.invoiceNumber,
    billNumber: invoice.invoiceNumber,
    dailyStayInvoiceId: invoice.id,
    tenantId: invoice.dailyStay?.tenantId || null,
    total: totalAgreed.toFixed(2),
    receivedAmount: totalAgreed.toFixed(2),
    billTotal: totalAgreed.toFixed(2),
    items: receiptItems,
    paymentEvents,
    roomNumber: invoice.dailyStay?.room?.roomNumber || 'GEN',
    tenantName: invoice.dailyStay?.applicantFullName || invoice.dailyStay?.tenant?.displayName || 'ผู้พักรายวัน',
    dormitoryName: invoice.dormitory?.name || 'หอพัก HorPlus',
    dormitoryTaxId: invoice.dormitory?.taxId || null,
    dormitoryAddress: invoice.dormitory?.addressLine1 || invoice.dormitory?.address || null,
    dormitoryPhone: invoice.dormitory?.phone || null,
    paymentMethod: 'CASH',
    paymentDate: invoice.updatedAt ? invoice.updatedAt.toISOString() : (invoice.issuedAt ? invoice.issuedAt.toISOString() : today.toISOString()),
    receiverName: receiverDisplayName,
    isFinalSettlement: true,
  };

  try {
    const receipt = await tx.receipt.create({
      data: {
        dormitoryId,
        dailyStayInvoiceId: invoice.id,
        roomId: invoice.dailyStay?.roomId || null,
        receiptKind: 'FINAL_SETTLEMENT',
        settlementScopeKey,
        receiptNumber,
        snapshotData,
        issuedByUserId: userId || null,
        issuedAt: today,
      },
    });

    return receipt;
  } catch (err: any) {
    if (err.code === 'P2002' || err.message?.includes('Unique constraint failed') || err.message?.includes('receipts_active_final_settlement_unique')) {
      const raceWinner = await tx.receipt.findFirst({
        where: {
          dormitoryId,
          settlementScopeKey,
          receiptKind: 'FINAL_SETTLEMENT',
          isVoided: false,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (raceWinner) return raceWinner;
    }
    throw err;
  }
}
