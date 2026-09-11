/**
 * @license Apache-2.0
 * Authoritative Utility-Consuming Bill Kind Resolver (Round 2.2.3 Authority)
 *
 * Invariant Rules:
 * 1. Utility-consuming Bill kinds: MONTHLY_UTILITY, LEGACY_COMBINED (and legacy null kind)
 *    - Lock utility rate settings when issued beyond unissued state.
 *    - Are targets of automatic recalculation when utility rate settings are updated.
 *    - Stop forward propagation to future cycles when paid.
 * 2. Non-utility Bill kinds: RENT, DEPOSIT
 *    - Do NOT lock utility rate settings merely by existing or being issued.
 *    - Are NOT recalculated when water/electricity/common fee settings are updated.
 *    - Do NOT terminate forward propagation of utility rate settings to future cycles.
 */

export const UTILITY_RATE_CONSUMING_BILL_KINDS = [
  'MONTHLY_UTILITY',
  'LEGACY_COMBINED',
  'monthly_utility',
  'legacy_combined',
] as const;

export function isUtilityRateConsumingBillKind(billKind?: string | null): boolean {
  if (!billKind) return true; // default / legacy combined bills consume utility rates
  const normalized = billKind.trim().toUpperCase();
  return normalized === 'MONTHLY_UTILITY' || normalized === 'LEGACY_COMBINED';
}
