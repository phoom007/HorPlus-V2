/**
 * @license Apache-2.0
 * Authoritative Daily Stay Invoice Paid Predicate (Round 2.2.2 Authority)
 *
 * Strict invariants:
 * - status === 'PAID'
 * - outstandingAmount === 0
 * - totalAgreedAmount > 0
 *
 * Excludes CANCELLED, ISSUED with 0, PARTIALLY_PAID with 0, or zero-total invoices.
 */
export function isDailyInvoiceFullyPaid(inv: {
  status?: string | null;
  outstandingAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
}): boolean {
  if (!inv) return false;
  const status = (inv.status || '').toUpperCase();
  if (status !== 'PAID') return false;

  const outstanding = Number(inv.outstandingAmount ?? 0);
  const totalAgreed = Number(inv.totalAgreedAmount ?? 0);

  return outstanding === 0 && totalAgreed > 0;
}
