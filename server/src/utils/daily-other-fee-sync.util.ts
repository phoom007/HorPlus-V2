/**
 * @license Apache-2.0
 * Authoritative Daily Stay Other Fee Synchronization & Immutability Engine
 */
import { Prisma } from '@prisma/client';
import { formatDecimal, toDecimal } from './decimal-math.util.js';

export interface CleanOtherFeeInput {
  description: string;
  amount: number | string | Prisma.Decimal;
}

export interface SyncDailyOtherFeesResult {
  totalAgreed: Prisma.Decimal;
  totalPaid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  status: string;
  items: any[];
}

/**
 * Synchronizes other fee items for a Daily Stay Invoice with strict historical immutability.
 * Guarantees:
 * 1. Settled other fee items (SETTLED / DECLARED_PAID) are strictly immutable.
 *    Any mutation (change amount) or removal throws 409 DAILY_OTHER_FEE_ALREADY_SETTLED.
 * 2. Unpaid other fee items (OUTSTANDING) are replaced cleanly without duplication.
 * 3. Adding a new distinct fee to a partially or fully paid invoice creates an OUTSTANDING item.
 * 4. Invoice totalAgreedAmount, outstandingAmount, and status are recalculated atomically:
 *    - outstanding == 0 and totalAgreed > 0 => PAID
 *    - outstanding > 0 and totalPaid > 0 => PARTIALLY_PAID
 *    - outstanding > 0 and totalPaid == 0 => ISSUED
 *    - CANCELLED remains CANCELLED
 */
export async function syncDailyStayOtherFeesInTx(
  client: any,
  invoiceId: string,
  currentStatus: string,
  cleanOtherFees: CleanOtherFeeInput[]
): Promise<SyncDailyOtherFeesResult> {
  if (currentStatus === 'CANCELLED') {
    const existing = await client.dailyStayInvoiceItem.findMany({ where: { invoiceId } });
    return {
      totalAgreed: new Prisma.Decimal('0.00'),
      totalPaid: new Prisma.Decimal('0.00'),
      outstanding: new Prisma.Decimal('0.00'),
      status: 'CANCELLED',
      items: existing,
    };
  }

  // 1. Identify already settled / declared-paid items (historical and immutable)
  const existingItems = await client.dailyStayInvoiceItem.findMany({
    where: { invoiceId },
  });
  const settledOtherFees = existingItems.filter(
    (it: any) => it.itemType === 'OTHER_FEE' && (it.status === 'SETTLED' || it.status === 'DECLARED_PAID')
  );

  // 1.5. Validate that all settled other fees are immutable and untouched in cleanOtherFees
  if (settledOtherFees.length > 0) {
    const availableCleanFees = cleanOtherFees.map((f) => ({
      description: f.description,
      amountDec: new Prisma.Decimal(formatDecimal(f.amount)),
      matched: false,
    }));

    for (const settled of settledOtherFees) {
      const settledAmtDec = new Prisma.Decimal(formatDecimal(settled.amount));
      const exactMatch = availableCleanFees.find(
        (cf) => !cf.matched && cf.description === settled.description && cf.amountDec.equals(settledAmtDec)
      );

      if (exactMatch) {
        exactMatch.matched = true;
      } else {
        const changedFee = availableCleanFees.find((cf) => cf.description === settled.description);
        if (changedFee) {
          const err = new Error(
            `ไม่สามารถแก้ไขรายการค่าใช้จ่าย "${settled.description}" ที่ชำระเงินแล้วได้ (จำนวนเงินเดิม ${formatDecimal(settled.amount)} บาท)`
          );
          (err as any).statusCode = 409;
          (err as any).code = 'DAILY_OTHER_FEE_ALREADY_SETTLED';
          throw err;
        }
        const err = new Error(`ไม่สามารถลบรายการค่าใช้จ่าย "${settled.description}" ที่ชำระเงินแล้วได้`);
        (err as any).statusCode = 409;
        (err as any).code = 'DAILY_OTHER_FEE_ALREADY_SETTLED';
        throw err;
      }
    }
  }

  // 2. Delete only OUTSTANDING OTHER_FEE items
  await client.dailyStayInvoiceItem.deleteMany({
    where: {
      invoiceId,
      itemType: 'OTHER_FEE',
      status: 'OUTSTANDING',
    },
  });

  // 3. Determine new OUTSTANDING items needed beyond settled ones
  const matchedSettledIds = new Set<string>();
  const itemsToCreate: any[] = [];

  for (const fee of cleanOtherFees) {
    const feeAmtDec = new Prisma.Decimal(formatDecimal(fee.amount));
    const matchingSettled = settledOtherFees.find(
      (s: any) =>
        !matchedSettledIds.has(s.id) &&
        s.description === fee.description &&
        new Prisma.Decimal(formatDecimal(s.amount)).equals(feeAmtDec)
    );

    if (matchingSettled) {
      matchedSettledIds.add(matchingSettled.id);
    } else {
      itemsToCreate.push({
        invoiceId,
        itemType: 'OTHER_FEE',
        description: fee.description,
        amount: toDecimal(fee.amount),
        status: 'OUTSTANDING',
        paidAt: null,
      });
    }
  }

  if (itemsToCreate.length > 0) {
    await client.dailyStayInvoiceItem.createMany({
      data: itemsToCreate,
    });
  }

  // 4. Recalculate invoice totals using exact Prisma.Decimal authority
  const allUpdatedItems = await client.dailyStayInvoiceItem.findMany({
    where: { invoiceId },
  });

  let totalAgreedDec = new Prisma.Decimal('0.00');
  let totalPaidDec = new Prisma.Decimal('0.00');

  for (const it of allUpdatedItems) {
    const itAmt = new Prisma.Decimal(formatDecimal(it.amount));
    totalAgreedDec = totalAgreedDec.plus(itAmt);
    if (it.status === 'SETTLED' || it.status === 'DECLARED_PAID') {
      totalPaidDec = totalPaidDec.plus(itAmt);
    }
  }

  const outstandingDec = totalAgreedDec.minus(totalPaidDec);
  const finalOutstandingDec = outstandingDec.isNegative()
    ? new Prisma.Decimal('0.00')
    : outstandingDec;

  let newStatus = currentStatus;
  if (finalOutstandingDec.isZero() && totalAgreedDec.greaterThan(0)) {
    newStatus = 'PAID';
  } else if (finalOutstandingDec.greaterThan(0) && totalPaidDec.greaterThan(0)) {
    newStatus = 'PARTIALLY_PAID';
  } else if (finalOutstandingDec.greaterThan(0) && totalPaidDec.isZero()) {
    newStatus = 'ISSUED';
  }

  await client.dailyStayInvoice.update({
    where: { id: invoiceId },
    data: {
      totalAgreedAmount: totalAgreedDec,
      outstandingAmount: finalOutstandingDec,
      status: newStatus,
    },
  });

  return {
    totalAgreed: totalAgreedDec,
    totalPaid: totalPaidDec,
    outstanding: finalOutstandingDec,
    status: newStatus,
    items: allUpdatedItems,
  };
}
