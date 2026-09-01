/**
 * @license Apache-2.0
 * Authoritative Tenant RENT Bill Visibility Resolver (Asia/Bangkok)
 */
import { toBangkokDateString } from './deposit-billing.util.js';

export { toBangkokDateString };

/**
 * Returns true if bill is visible to tenant as of the given timestamp in Asia/Bangkok timezone.
 * Canonical rule:
 * - Non-RENT bills (MONTHLY_UTILITY, DEPOSIT, LEGACY_COMBINED) are visible under existing rules.
 * - RENT bills are visible only when current Bangkok business date is >= BillingCycle periodStart calendar date (00:00:00 Bangkok).
 */
export function isBillVisibleToTenant(
  bill: { billKind?: string | null; billingCycle?: { periodStart?: Date | string } | null; periodStart?: Date | string | null },
  asOfDate: Date = new Date()
): boolean {
  const kind = (bill.billKind || '').toUpperCase();
  if (kind !== 'RENT') {
    return true;
  }
  const rawPeriodStart = bill.billingCycle?.periodStart || bill.periodStart;
  if (!rawPeriodStart) {
    return true;
  }
  const currentBkkStr = toBangkokDateString(asOfDate);
  const periodStartStr = toBangkokDateString(new Date(rawPeriodStart));
  return currentBkkStr >= periodStartStr;
}

/**
 * Returns authoritative UTC cutoff date for Prisma query to filter out future RENT bills.
 * Any cycle with periodStart > cutoff represents a future cycle not yet visible in Bangkok today.
 */
export function getTenantRentCutoffDate(asOfDate: Date = new Date()): Date {
  const bkkDateStr = toBangkokDateString(asOfDate);
  return new Date(`${bkkDateStr}T23:59:59.999Z`);
}
