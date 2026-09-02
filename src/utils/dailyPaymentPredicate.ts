/**
 * @license Apache-2.0
 * Authoritative Payment & Financial Settlement Predicates (Round 2.4H.1 Canonical Authority)
 *
 * Strict invariants:
 * - Excludes CANCELLED, VOID, VOIDED, WITHDRAWN, SUPERSEDED.
 * - Missing / blank / malformed authority fails closed (must NOT become zero).
 * - Genuine explicit finite outstanding === 0 is settled.
 * - Same canonical invalidation authority shared across Paid, Unpaid, and Daily projections.
 */

export const CANONICAL_INVALIDATED_STATUSES: ReadonlySet<string> = new Set([
  'CANCELLED',
  'VOID',
  'VOIDED',
  'WITHDRAWN',
  'SUPERSEDED',
]);

export function isFinancialObligationInvalidated(status?: string | null): boolean {
  if (!status) return false;
  return CANONICAL_INVALIDATED_STATUSES.has(status.trim().toUpperCase());
}

export function parseExplicitFiniteNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function resolveAuthoritativeOutstandingAmount(record?: {
  outstandingAmount?: number | string | null;
  totalAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
} | null): number | null {
  if (!record) return null;

  // A. If the record HAS its own outstandingAmount property (not null/undefined):
  // - explicit finite number/string -> use it
  // - blank / malformed / non-finite -> return null (DO NOT fall back to totalAmount)
  if (record.outstandingAmount !== undefined && record.outstandingAmount !== null) {
    return parseExplicitFiniteNumber(record.outstandingAmount);
  }

  // B. Only when outstandingAmount is genuinely absent/null because the legacy
  // record does not provide outstanding authority may verified legacy fallback be considered.
  if (record.totalAmount !== undefined && record.totalAmount !== null) {
    return parseExplicitFiniteNumber(record.totalAmount);
  }

  if (record.totalAgreedAmount !== undefined && record.totalAgreedAmount !== null) {
    return parseExplicitFiniteNumber(record.totalAgreedAmount);
  }

  return null;
}

export function isFinancialObligationSettled(record?: {
  status?: string | null;
  outstandingAmount?: number | string | null;
  totalAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
} | null): boolean {
  if (!record) return false;
  if (isFinancialObligationInvalidated(record.status)) return false;

  const outstanding = resolveAuthoritativeOutstandingAmount(record);
  if (outstanding === null) return false;

  return outstanding === 0;
}

export function isDailyInvoiceFullyPaid(inv?: {
  status?: string | null;
  outstandingAmount?: number | string | null;
  totalAgreedAmount?: number | string | null;
} | null): boolean {
  return isFinancialObligationSettled(inv);
}
