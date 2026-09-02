/**
 * @license Apache-2.0
 * Authoritative Payment & Daily Stay Invoice Settled Predicate (Round 2.4H Authority)
 *
 * Strict invariants:
 * - Excludes CANCELLED, VOID, VOIDED, or invalidated records.
 * - Genuine outstandingAmount === 0 (or total === 0 with outstanding === 0) is settled.
 * - Belong strictly to "ชำระแล้ว", never "ยังไม่ชำระ".
 */
export function isDailyInvoiceFullyPaid(inv: {
  status?: string | null;
  outstandingAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
}): boolean {
  if (!inv) return false;
  const status = (inv.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'VOID' || status === 'VOIDED') return false;

  const outstanding = Number(inv.outstandingAmount ?? inv.totalAgreedAmount ?? 0);
  return outstanding === 0;
}

export function isFinancialObligationSettled(record: {
  status?: string | null;
  outstandingAmount?: number | string | null;
  totalAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
}): boolean {
  if (!record) return false;
  const status = (record.status || '').toUpperCase();
  if (status === 'CANCELLED' || status === 'VOID' || status === 'VOIDED') {
    return false;
  }

  const outstanding = Number(
    record.outstandingAmount !== undefined && record.outstandingAmount !== null
      ? record.outstandingAmount
      : (record.totalAmount ?? record.totalAgreedAmount ?? 0)
  );

  return outstanding === 0;
}
