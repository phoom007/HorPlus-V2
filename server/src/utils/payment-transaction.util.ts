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
  paymentDate?: Date;
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
  const group = await tx.combinedPaymentGroup.create({
    data: {
      dormitoryId: input.dormitoryId,
      tenantId: bill.tenantId,
      totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
      method: 'CASH',
      status: 'APPROVED',
      paymentDate: now,
      recordedByUserId: safeUserId,
      idempotencyKey: input.idempotencyKey || null,
      notes: 'รับชำระด้วยเงินสด ณ เคาน์เตอร์',
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
      paymentDate: now,
      reviewedByUserId: safeUserId,
      reviewedAt: now,
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
    paymentDate: (payment?.paymentDate || today).toISOString(),
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

  const dorm = await tx.dormitory.findUnique({ where: { id: dormitoryId }, select: { name: true, taxId: true, address: true, phone: true } });

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

  // Construct legacy compatibility summary items if not explicitly provided
  const legacyReceiptItems = params.receiptItems || finalBillGroups.map((bg) => ({
    description: `ชำระบิล ${bg.billNumber || bg.billId}`,
    amount: bg.allocatedAmount,
  }));

  const snapshotData = {
    receiptNumber,
    billNumber: null,
    total: totalAmount.toFixed(2),
    receivedAmount: totalAmount.toFixed(2),
    items: legacyReceiptItems,
    billGroups,
    roomNumber: params.roomNumber || 'GEN',
    tenantName: params.tenantName || 'ผู้เช่า',
    dormitoryName: dorm?.name || 'หอพัก HorPlus',
    dormitoryTaxId: dorm?.taxId || null,
    dormitoryAddress: dorm?.address || null,
    dormitoryPhone: dorm?.phone || null,
    paymentMethod: params.paymentMethod || 'BANK_TRANSFER',
    paymentDate: (params.paymentDate || today).toISOString(),
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
