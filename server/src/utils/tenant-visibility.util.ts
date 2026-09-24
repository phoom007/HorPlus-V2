/**
 * @license Apache-2.0
 * Authoritative Tenant RENT Bill Visibility Resolver (Asia/Bangkok)
 */
import { toBangkokDateString } from './deposit-billing.util.js';

export { toBangkokDateString };

/**
 * Returns true if bill is visible to tenant as of the given timestamp in Asia/Bangkok timezone.
 * Canonical rule (PO-10):
 * - Non-RENT bills (MONTHLY_UTILITY, DEPOSIT, LEGACY_COMBINED) are visible under existing rules.
 * - RENT bills:
 *   1. Round 1 (initial rent bill created upon registration/approval, with isInitialRentBill === true or billingDate <= currentBkkDate) is visible immediately.
 *   2. Round 2+ (subsequent monthly rent bills) are visible only when current Bangkok business date is >= BillingCycle periodStart calendar date (00:00:00 Bangkok on the 1st of the month).
 */
export function isBillVisibleToTenant(
  bill: {
    billKind?: string | null;
    billType?: string | null;
    status?: string | null;
    billingDate?: Date | string | null;
    billingCycle?: { periodStart?: Date | string } | null;
    periodStart?: Date | string | null;
    items?: Array<{ metadata?: any }> | null;
    billItems?: Array<{ metadata?: any }> | null;
  },
  asOfDate: Date = new Date()
): boolean {
  const statusUpper = (bill.status || '').toUpperCase();
  if (statusUpper === 'DRAFT' || statusUpper === 'VOID' || statusUpper === 'CANCELLED') {
    return false;
  }
  const kind = (bill.billKind || bill.billType || '').toUpperCase();
  if (kind !== 'RENT') {
    return true;
  }
  const currentBkkStr = toBangkokDateString(asOfDate);
  const allItems = bill.items || bill.billItems || [];
  if (Array.isArray(allItems) && allItems.some((it: any) => it?.metadata?.isInitialRentBill === true)) {
    return true;
  }
  if (bill.billingDate) {
    const billingDateStr = toBangkokDateString(new Date(bill.billingDate));
    if (currentBkkStr >= billingDateStr) {
      return true;
    }
  }
  const rawPeriodStart = bill.billingCycle?.periodStart || bill.periodStart;
  if (!rawPeriodStart) {
    return true;
  }
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
