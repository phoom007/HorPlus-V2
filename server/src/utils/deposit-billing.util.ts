import { Prisma } from '@prisma/client';
import { recordCashPaymentInTx } from './payment-transaction.util.js';
import { generateNextBillNumberInTx } from './bill-number.util.js';
import { calculateInstallmentSchedule } from './installment-calculator.util.js';

export { generateNextBillNumberInTx };

export interface CreateDepositBillInput {
  dormitoryId: string;
  roomId: string;
  tenantId?: string | null;
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  agreementType: 'MONTHLY' | 'TERM' | 'DAILY';
  startDate: Date | string;
  depositAmount: number | string | Prisma.Decimal;
  depositDeclaredStatus?: 'PAID' | 'UNPAID' | null;
  actorUserId?: string | null;
}

/**
 * Format Date to YYYY-MM-DD in Asia/Bangkok timezone
 */
export function toBangkokDateString(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function formatDecimal(val: number | string | Prisma.Decimal): string {
  const num = typeof val === 'object' && 'toNumber' in val ? (val as Prisma.Decimal).toNumber() : Number(val);
  return (isNaN(num) ? 0 : num).toFixed(2);
}

/**
 * Creates exactly ONE agreement-linked Deposit Bill in the agreement start cycle.
 * Guarantees:
 * 1. depositAmount <= 0 => returns null
 * 2. Identity strictness: requires contractId XOR provisionalRentalTermId
 * 3. Idempotency: returns existing bill if already generated
 * 4. Strict Start-Cycle Authority: period containment [periodStart <= startDate <= periodEnd]
 *    fails with DEPOSIT_BILLING_CYCLE_NOT_FOUND if exact matching period does not exist
 * 5. Single Payment Authority: settles through canonical recordCashPaymentInTx when declared PAID
 */
export async function createDepositBillForAgreementInTx(
  tx: any,
  input: CreateDepositBillInput
): Promise<any | null> {
  const depAmtDec = new Prisma.Decimal(formatDecimal(input.depositAmount || 0));
  if (depAmtDec.isZero() || depAmtDec.isNegative()) {
    return null;
  }

  // 1. Agreement Identity Strictness (contractId XOR provisionalRentalTermId)
  const hasContract = Boolean(input.contractId);
  const hasProvisional = Boolean(input.provisionalRentalTermId);
  if ((hasContract && hasProvisional) || (!hasContract && !hasProvisional)) {
    throw new Error('createDepositBillForAgreementInTx requires exactly one agreement identity (contractId XOR provisionalRentalTermId)');
  }

  // 2. Idempotency Check: search existing DEPOSIT bill on this agreement
  const existingBill = await tx.bill.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      billKind: 'DEPOSIT',
      ...(input.contractId ? { contractId: input.contractId } : { provisionalRentalTermId: input.provisionalRentalTermId }),
    },
    include: { items: true },
  });

  if (existingBill) {
    return existingBill;
  }

  // 3. Strict Start-Cycle Authority (with Go-Live Boundary fallback)
  const startD = new Date(input.startDate);

  let cycle = await tx.billingCycle.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      periodStart: { lte: startD },
      periodEnd: { gte: startD },
    },
  });

  if (!cycle) {
    const earliestCycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: input.dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    if (earliestCycle && startD < new Date(earliestCycle.periodStart)) {
      // Go-live boundary: first HorPlus-managed month is the earliest active billing cycle
      cycle = earliestCycle;
    }
  }

  if (!cycle) {
    const err = new Error('ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า');
    (err as any).code = 'DEPOSIT_BILLING_CYCLE_NOT_FOUND';
    (err as any).statusCode = 409;
    throw err;
  }

  // 4. Generate transaction-safe Bill Number via shared neutral authority
  const billNumber = await generateNextBillNumberInTx(tx, input.dormitoryId, cycle.cycleCode);

  // 5. Status and settlement dates
  const isPaid = (input.depositDeclaredStatus || '').toUpperCase() === 'PAID';
  const isPreGoLive = startD < new Date(cycle.periodStart);
  const billingDate = isPreGoLive ? new Date(cycle.periodStart) : startD;
  const dueDate = cycle.dueDate ? new Date(cycle.dueDate) : startD;
  const safeActorId = input.actorUserId && /^[0-9a-fA-F-]{36}$/.test(input.actorUserId) ? input.actorUserId : null;
  const now = new Date();

  // 6. Create issued Deposit Bill in UNPAID status
  const bill = await tx.bill.create({
    data: {
      dormitoryId: input.dormitoryId,
      billingCycleId: cycle.id,
      roomId: input.roomId,
      tenantId: input.tenantId || null,
      contractId: input.contractId || null,
      provisionalRentalTermId: input.provisionalRentalTermId || null,
      billKind: 'DEPOSIT',
      billNumber,
      status: 'unpaid',
      billingDate,
      dueDate,
      subtotal: new Prisma.Decimal(formatDecimal(depAmtDec)),
      totalAmount: new Prisma.Decimal(formatDecimal(depAmtDec)),
      paidAmount: new Prisma.Decimal('0.00'),
      outstandingAmount: new Prisma.Decimal(formatDecimal(depAmtDec)),
      paidAt: null,
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

  // 7. Settle through canonical in-transaction payment helper if declared PAID
  if (isPaid) {
    await recordCashPaymentInTx(tx, {
      dormitoryId: input.dormitoryId,
      billId: bill.id,
      amount: formatDecimal(depAmtDec),
      userId: safeActorId,
      paymentDate: now,
    });

    return await tx.bill.findUnique({
      where: { id: bill.id },
      include: { items: true },
    });
  }

  return bill;
}

export interface CreateRentBillInput {
  dormitoryId: string;
  roomId: string;
  tenantId?: string | null;
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  agreementType: 'MONTHLY' | 'TERM';
  startDate: Date | string;
  unitRentAmount: number | string | Prisma.Decimal;
  totalRentAmount?: number | string | Prisma.Decimal;
  termInstallmentCount?: number | null;
  actorUserId?: string | null;
}

/**
 * Creates the FIRST immediate HorPlus-managed Rent Bill for an agreement.
 * - For Monthly: Creates bill for the first managed month (duration 1 month)
 * - For Term: Creates bill for the first managed installment currently due
 * - If agreement starts before HorPlus go-live, attaches to the earliest billing cycle
 */
export async function createImmediateRentBillForAgreementInTx(
  tx: any,
  input: CreateRentBillInput
): Promise<any | null> {
  const rentAmtDec = new Prisma.Decimal(formatDecimal(input.unitRentAmount || 0));
  if (rentAmtDec.isZero() || rentAmtDec.isNegative()) {
    return null;
  }

  // 1. Agreement Identity Strictness (contractId XOR provisionalRentalTermId)
  const hasContract = Boolean(input.contractId);
  const hasProvisional = Boolean(input.provisionalRentalTermId);
  if ((hasContract && hasProvisional) || (!hasContract && !hasProvisional)) {
    throw new Error('createImmediateRentBillForAgreementInTx requires exactly one agreement identity (contractId XOR provisionalRentalTermId)');
  }

  // 2. Resolve target HorPlus-managed billing cycle
  const startD = new Date(input.startDate);
  let cycle = await tx.billingCycle.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      periodStart: { lte: startD },
      periodEnd: { gte: startD },
    },
  });

  if (!cycle) {
    const earliestCycle = await tx.billingCycle.findFirst({
      where: { dormitoryId: input.dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    if (earliestCycle && startD < new Date(earliestCycle.periodStart)) {
      cycle = earliestCycle;
    }
  }

  if (!cycle) {
    return null;
  }

  // 3. Idempotency Check: search existing RENT bill on this agreement in this cycle
  const existingBill = await tx.bill.findFirst({
    where: {
      dormitoryId: input.dormitoryId,
      billingCycleId: cycle.id,
      billKind: 'RENT',
      ...(input.contractId ? { contractId: input.contractId } : { provisionalRentalTermId: input.provisionalRentalTermId }),
    },
    include: { items: true },
  });

  if (existingBill) {
    return existingBill;
  }

  // 4. Determine bill amount and description
  let billAmountDec = rentAmtDec;
  let description = 'ค่าเช่าห้องพัก (รายเดือน)';

  if (input.agreementType === 'TERM') {
    const installments = Math.max(1, input.termInstallmentCount || 1);
    const totalRent = input.totalRentAmount ? new Prisma.Decimal(formatDecimal(input.totalRentAmount)) : rentAmtDec;
    const totalRentNum = totalRent.toNumber();
    const schedule = calculateInstallmentSchedule(totalRentNum, installments);
    const firstItem = schedule[0];
    billAmountDec = new Prisma.Decimal(firstItem.formattedAmount);
    description = `ค่าเช่าห้องพัก (งวดที่ 1/${installments})`;
  }

  // 5. Generate bill number
  const billNumber = await generateNextBillNumberInTx(tx, input.dormitoryId, cycle.cycleCode);

  const isPreGoLive = startD < new Date(cycle.periodStart);
  const billingDate = isPreGoLive ? new Date(cycle.periodStart) : startD;
  const dueDate = cycle.dueDate ? new Date(cycle.dueDate) : startD;
  const safeActorId = input.actorUserId && /^[0-9a-fA-F-]{36}$/.test(input.actorUserId) ? input.actorUserId : null;
  const now = new Date();

  // 6. Create issued Rent Bill in unpaid status
  const bill = await tx.bill.create({
    data: {
      dormitoryId: input.dormitoryId,
      billingCycleId: cycle.id,
      roomId: input.roomId,
      tenantId: input.tenantId || null,
      contractId: input.contractId || null,
      provisionalRentalTermId: input.provisionalRentalTermId || null,
      billKind: 'RENT',
      billNumber,
      status: 'unpaid',
      billingDate,
      dueDate,
      subtotal: billAmountDec,
      totalAmount: billAmountDec,
      paidAmount: new Prisma.Decimal('0.00'),
      outstandingAmount: billAmountDec,
      paidAt: null,
      generatedByUserId: safeActorId,
      generatedAt: now,
      items: {
        create: [
          {
            dormitoryId: input.dormitoryId,
            type: 'rent',
            description,
            amount: billAmountDec,
            unitPrice: billAmountDec,
            quantity: new Prisma.Decimal('1.00'),
          },
        ],
      },
    },
    include: { items: true },
  });

  return bill;
}
