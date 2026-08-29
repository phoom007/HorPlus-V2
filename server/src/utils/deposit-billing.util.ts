import { Prisma } from '@prisma/client';
import { toBangkokDateString } from './calendar-date.util.js';
import { toDecimal, isZeroDecimal, formatDecimal } from './decimal-math.util.js';

export interface CreateDepositBillInput {
  dormitoryId: string;
  roomId: string;
  tenantId: string;
  startDate: Date | string;
  depositAmount: Prisma.Decimal | number | string;
  depositDeclaredStatus?: 'PAID' | 'UNPAID' | string | null;
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  actorUserId?: string | null;
}

/**
 * Creates exactly ONE deposit bill for an agreement (Contract or ProvisionalRentalTerm)
 * in the same transaction as agreement commitment.
 *
 * Rules:
 * 1. If depositAmount <= 0, no bill is created.
 * 2. Idempotent: checks if a deposit bill already exists for the agreement before creating.
 * 3. Deposit billingCycleId is resolved from agreement startDate (canonical period range or YYYY-MM code).
 * 4. UNPAID declaration creates an issued unpaid bill (status = 'unpaid', paidAmount = 0, outstanding = depositAmount).
 * 5. PAID declaration creates a settled bill (status = 'paid', paidAmount = depositAmount, outstanding = 0)
 *    and records canonical CASH payment evidence.
 */
export async function createDepositBillForAgreementInTx(
  tx: Prisma.TransactionClient,
  input: CreateDepositBillInput
) {
  const depAmtDec = toDecimal(String(input.depositAmount || '0.00'));
  if (isZeroDecimal(depAmtDec) || depAmtDec.lessThan(0)) {
    return null;
  }

  // 1. Idempotency check: Do not create a second deposit bill for the same agreement
  const existingBill = await tx.bill.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      billKind: 'DEPOSIT',
      status: { notIn: ['cancelled', 'void'] },
      ...(input.contractId ? { contractId: input.contractId } : {}),
      ...(input.provisionalRentalTermId ? { provisionalRentalTermId: input.provisionalRentalTermId } : {}),
    },
  });

  if (existingBill) {
    return existingBill;
  }

  // 2. Resolve agreement start billing cycle (Deposit Origin Cycle)
  const startD = typeof input.startDate === 'string' ? new Date(input.startDate) : input.startDate;

  // Match cycle by period range
  let cycle = await tx.billingCycle.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      periodStart: { lte: startD },
      periodEnd: { gte: startD },
    },
    orderBy: { periodStart: 'desc' },
  });

  // Match cycle by cycleCode YYYY-MM in Bangkok timezone
  if (!cycle) {
    const cycleCode = toBangkokDateString(startD).slice(0, 7);
    cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: input.dormitoryId, cycleCode },
    });
  }

  // Fallback to earliest / active cycle if no exact cycle matched
  if (!cycle) {
    cycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: input.dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
  }

  if (!cycle) {
    return null;
  }

  // 3. Generate Bill Number
  const cycleCode = cycle.cycleCode || toBangkokDateString(startD).slice(0, 7);
  const count = await tx.bill.count({
    where: { dormitoryId: input.dormitoryId, billingCycleId: cycle.id },
  });
  const billSeq = (count + 1).toString().padStart(4, '0');
  const billNumber = `INV-${cycleCode}-${billSeq}`;

  // 4. Status and settlement
  const isPaid = (input.depositDeclaredStatus || '').toUpperCase() === 'PAID';
  const billingDate = cycle.billingDate ? new Date(cycle.billingDate) : startD;
  const dueDate = cycle.dueDate ? new Date(cycle.dueDate) : startD;
  const safeActorId = input.actorUserId && /^[0-9a-fA-F-]{36}$/.test(input.actorUserId) ? input.actorUserId : null;
  const now = new Date();

  // 5. Create Deposit Bill + BillItem
  const bill = await tx.bill.create({
    data: {
      dormitoryId: input.dormitoryId,
      billingCycleId: cycle.id,
      roomId: input.roomId,
      tenantId: input.tenantId,
      contractId: input.contractId || null,
      provisionalRentalTermId: input.provisionalRentalTermId || null,
      billKind: 'DEPOSIT',
      billNumber,
      status: isPaid ? 'paid' : 'unpaid',
      billingDate,
      dueDate,
      subtotal: new Prisma.Decimal(formatDecimal(depAmtDec)),
      totalAmount: new Prisma.Decimal(formatDecimal(depAmtDec)),
      paidAmount: isPaid ? new Prisma.Decimal(formatDecimal(depAmtDec)) : new Prisma.Decimal('0.00'),
      outstandingAmount: isPaid ? new Prisma.Decimal('0.00') : new Prisma.Decimal(formatDecimal(depAmtDec)),
      paidAt: isPaid ? now : null,
      generatedByUserId: safeActorId,
      generatedAt: now,
      items: {
        create: [
          {
            dormitoryId: input.dormitoryId,
            type: 'deposit',
            description: 'เงินประกัน/มัดจำ',
            amount: new Prisma.Decimal(formatDecimal(depAmtDec)),
            unitPrice: new Prisma.Decimal(formatDecimal(depAmtDec)),
            quantity: new Prisma.Decimal('1.00'),
          },
        ],
      },
    },
    include: { items: true },
  });

  // 6. Record canonical payment evidence if declared PAID
  if (isPaid) {
    await tx.payment.create({
      data: {
        dormitoryId: input.dormitoryId,
        billId: bill.id,
        tenantId: input.tenantId,
        amount: new Prisma.Decimal(formatDecimal(depAmtDec)),
        method: 'CASH',
        status: 'APPROVED',
        paymentDate: now,
        reviewedAt: now,
        reviewedByUserId: safeActorId,
      },
    });
  }

  return bill;
}
