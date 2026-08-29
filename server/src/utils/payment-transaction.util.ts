import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';

export interface RecordCashPaymentInTxInput {
  dormitoryId: string;
  billId: string;
  amount: string | number | Prisma.Decimal | Decimal;
  userId?: string | null;
  idempotencyKey?: string | null;
  paymentDate?: Date;
}

/**
 * Canonical in-transaction cash settlement authority.
 * Creates Payment, PaymentStatusHistory, BillStatusHistory, updates Bill to PAID,
 * and generates sequential Receipt under the same database transaction.
 */
export async function recordCashPaymentInTx(
  tx: any,
  input: RecordCashPaymentInTxInput
) {
  const bill = await tx.bill.findUnique({
    where: { id: input.billId },
    include: { items: true },
  });
  if (!bill) throw new Error('NOT_FOUND');
  if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
  if (bill.status === 'PAID') throw new Error('ALREADY_PAID');

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const totalAmount = bill.totalAmount !== undefined && bill.totalAmount !== null
    ? new Decimal(bill.totalAmount.toString())
    : bill.items.reduce((sum: Decimal, item: any) => sum.plus(new Decimal(item.amount.toString())), new Decimal(0));
  const submitAmount = new Decimal(input.amount.toString());
  if (!totalAmount.equals(submitAmount)) throw new Error('UNSUPPORTED_AMOUNT');

  const now = input.paymentDate || new Date();
  const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
    ? input.userId
    : null;

  const payment = await tx.payment.create({
    data: {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      tenantId: bill.tenantId,
      method: 'CASH',
      amount: new Prisma.Decimal(submitAmount.toFixed(2)),
      status: 'APPROVED',
      paymentDate: now,
      reviewedByUserId: safeUserId,
      reviewedAt: now,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  await tx.paymentStatusHistory.create({
    data: {
      dormitoryId: input.dormitoryId,
      paymentId: payment.id,
      fromStatus: null,
      toStatus: 'APPROVED',
      changedByUserId: safeUserId,
    },
  });

  const prePaymentStatus = bill.status;
  await tx.billStatusHistory.create({
    data: {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      fromStatus: prePaymentStatus,
      toStatus: 'PAID',
      changedByUserId: safeUserId,
    },
  });

  await tx.bill.update({
    where: { id: bill.id },
    data: {
      status: 'PAID',
      previousStatus: prePaymentStatus,
      paidAt: now,
      paidAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
      outstandingAmount: new Prisma.Decimal('0.00'),
    },
  });

  await generateReceiptInTx(tx, payment.id, input.dormitoryId, bill.id, safeUserId);

  return payment;
}

/**
 * Generates sequential receipt in locked format RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
 */
export async function generateReceiptInTx(
  tx: any,
  paymentId: string,
  dormitoryId: string,
  billId: string,
  userId?: string | null
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

  const bill = await tx.bill.findUnique({
    where: { id: billId },
    include: { items: true, dormitory: true, tenant: true, room: true },
  });

  const rawRoomNumber = bill?.room?.normalizedRoomNumber || bill?.room?.roomNumber || 'GEN';
  const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
  const sequenceStr = String(seq.lastValue).padStart(4, '0');

  // Locked format: RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
  const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

  const payment = await tx.payment.findUnique({ where: { id: paymentId } });

  Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
  const subtotal = bill.items.reduce((sum: Decimal, item: any) => sum.plus(new Decimal(item.amount.toString())), new Decimal(0));
  const total = bill.totalAmount ? new Decimal(bill.totalAmount.toString()) : subtotal;
  const discount = subtotal.minus(total).greaterThan(0) ? subtotal.minus(total).toFixed(2) : '0.00';

  const snapshotData = {
    dormitoryName: bill?.dormitory?.name || 'หอพัก',
    dormitoryTaxId: bill?.dormitory?.taxId || '-',
    dormitoryAddress: bill?.dormitory?.address || '-',
    dormitoryPhone: bill?.dormitory?.phone || '-',
    tenantName: bill?.tenant?.name || bill?.tenant?.displayName || 'ผู้เช่า',
    roomNumber: bill?.room?.roomNumber || 'N/A',
    billNumber: bill?.billNumber || bill?.id,
    items: bill?.items?.map((i: any) => ({
      description: i.description,
      amount: i.amount.toString(),
      quantity: (i.quantity || 1).toString(),
    })) || [],
    subtotal: subtotal.toFixed(2),
    discount: discount,
    total: total.toFixed(2),
    paymentMethod: payment?.method || 'CASH',
    paymentDate: payment?.paymentDate ? payment.paymentDate.toISOString() : today.toISOString(),
    approvalDate: payment?.reviewedAt ? payment.reviewedAt.toISOString() : today.toISOString(),
    receiptNumber: receiptNumber,
    issueDate: today.toISOString(),
    isVoided: false,
    voidReason: null,
  };

  const safeUserId = userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? userId
    : null;

  return await tx.receipt.create({
    data: {
      dormitoryId,
      receiptNumber,
      billId,
      paymentId,
      issuedByUserId: safeUserId,
            snapshotData: snapshotData as any,
    },
  });
}
