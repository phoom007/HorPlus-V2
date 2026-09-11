/**
 * @license Apache-2.0
 * Neutral Canonical Bill Number Authority
 * 
 * Provides single, transaction-safe sequential invoice number allocation
 * serialized per dormitory & billing cycle namespace.
 */

/**
 * Transaction-safe bill number allocator serialized per dormitory & cycle.
 * Advisory Lock Namespace: 'bill_number:' + dormitoryId + ':' + cycleCode
 * Format: INV-{cycleCode}-{seq} (e.g. INV-2026-08-0001)
 */
export async function generateNextBillNumberInTx(
  tx: any,
  dormitoryId: string,
  cycleCode: string
): Promise<string> {
  const prefix = `INV-${cycleCode}-`;

  // Transaction-safe dormitory & cycle namespace advisory lock
  if (typeof tx?.$executeRaw === 'function') {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bill_number:' + dormitoryId + ':' + cycleCode}))`;
  }

  const lastBill = await tx.bill.findFirst({
    where: {
      dormitoryId,
      billNumber: { startsWith: prefix },
    },
    orderBy: { billNumber: 'desc' },
    select: { billNumber: true },
  });

  let nextSeq = 1;
  if (lastBill?.billNumber) {
    const match = lastBill.billNumber.slice(prefix.length).match(/^(\d+)/);
    if (match) {
      nextSeq = parseInt(match[1], 10) + 1;
    }
  } else {
    const count = await tx.bill.count({
      where: { dormitoryId, billNumber: { startsWith: prefix } },
    });
    nextSeq = count + 1;
  }

  return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}
