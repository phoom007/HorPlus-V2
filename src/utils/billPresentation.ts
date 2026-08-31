/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.1: Shared Bill & Tier Presentation Utilities
 */

import {
  CanonicalTierBreakdownItem,
  CanonicalTieredBillItemMetadata,
  formatBillingRate,
  formatBillingUnit,
} from '../types';

/**
 * Checks whether a value is a valid canonical whole unit integer decimal string or integer number.
 * Examples valid: "0", "0.00", "10", "10.00", "150.00", 0, 10, 150
 * Examples invalid: "abc", "10.50", "5.50", "-1", "1e2", Infinity, NaN, null, undefined
 */
export function isCanonicalWholeUnitDisplay(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 && Number.isInteger(val);
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!/^\d+(\.0+)?$/.test(str)) return false;
    const num = Number(str);
    return Number.isFinite(num) && num >= 0 && Number.isInteger(num);
  }
  return false;
}

/**
 * Checks whether a value is a valid canonical money decimal string (max 2DP) or finite number.
 * Examples valid: "34.00", "55.25", "-10.00", "0.00", 34, 55.25
 * Examples invalid: "abc", "wrong", "1e2", Infinity, NaN, null, undefined
 */
export function isCanonicalMoneyDisplay(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val);
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!/^-?\d+(\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return Number.isFinite(num);
  }
  return false;
}

/**
 * Checks whether a value is a valid non-negative canonical money decimal string (max 2DP) or finite non-negative number.
 * Examples valid: "3.40", "0.00", "15.00", 3.4, 0
 * Examples invalid: "-1.00", "abc", "bad", "1e2", Infinity, NaN, null, undefined
 */
export function isCanonicalPositiveMoneyDisplay(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0;
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return Number.isFinite(num) && num >= 0;
  }
  return false;
}

/**
 * Strict type guard validating that a bill item metadata object represents a valid, displayable Tiered utility.
 * Fails closed if metadata is missing, malformed, non-integer boundaries, fractional usage, or has empty breakdown.
 */
export function isValidTieredBillItemMetadata(
  metadata: unknown
): metadata is CanonicalTieredBillItemMetadata {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, any>;
  if (m.mode !== 'tiered') return false;
  if (!Array.isArray(m.tierBreakdown) || m.tierBreakdown.length === 0) return false;

  for (const item of m.tierBreakdown) {
    if (!item || typeof item !== 'object') return false;

    // 1. lowerExclusive: valid non-negative whole-unit integer
    if (!isCanonicalWholeUnitDisplay(item.lowerExclusive)) return false;
    const lowerVal = Number(item.lowerExclusive);

    // 2. upperInclusive: null OR valid non-negative whole-unit integer > lowerExclusive
    if (item.upperInclusive !== null && item.upperInclusive !== undefined && item.upperInclusive !== '') {
      if (!isCanonicalWholeUnitDisplay(item.upperInclusive)) return false;
      const upperVal = Number(item.upperInclusive);
      if (upperVal <= lowerVal) return false;
    }

    // 3. billedUnits: valid non-negative whole integer usage
    if (!isCanonicalWholeUnitDisplay(item.billedUnits)) return false;

    // 4. rate: valid non-negative money decimal (max 2DP)
    if (!isCanonicalPositiveMoneyDisplay(item.rate)) return false;

    // 5. amount: valid money decimal (max 2DP)
    if (!isCanonicalMoneyDisplay(item.amount)) return false;
  }

  return true;
}

/**
 * Formats a canonical progressive tier interval (lowerExclusive, upperInclusive) into human-readable Thai range.
 * Examples:
 *   (0.00, 10.00) -> "1–10 หน่วย"
 *   (10.00, 20.00) -> "11–20 หน่วย"
 *   (20.00, null) -> "21 หน่วยขึ้นไป"
 */
export function formatTierRange(
  lowerExclusive: string | number,
  upperInclusive: string | number | null | undefined,
  unitLabel = 'หน่วย'
): string {
  const lowerNum = Number(lowerExclusive);
  if (isNaN(lowerNum) || lowerNum < 0) return `- ${unitLabel}`;
  const start = Math.floor(lowerNum) + 1;

  if (upperInclusive === null || upperInclusive === undefined || upperInclusive === '') {
    return `${start} ${unitLabel}ขึ้นไป`;
  }

  const upperNum = Number(upperInclusive);
  if (isNaN(upperNum) || upperNum < start) {
    return `${start} ${unitLabel}ขึ้นไป`;
  }

  const end = Math.floor(upperNum);
  if (start === end) {
    return `${start} ${unitLabel}`;
  }
  return `${start}–${end} ${unitLabel}`;
}

/**
 * Formats billed usage units for display as an integer domain.
 * Examples:
 *   "15.00" -> "15 หน่วย"
 *   130 -> "130 หน่วย"
 */
export function formatTierUsage(
  billedUnits: string | number,
  unitLabel = 'หน่วย'
): string {
  const val = Number(billedUnits);
  if (isNaN(val) || !isCanonicalWholeUnitDisplay(billedUnits)) return `- ${unitLabel}`;
  return `${Math.round(val)} ${unitLabel}`;
}

/**
 * Formats rate label for bill and receipt presentation.
 * For tiered items: returns "คิดตามขั้นบันได" (NEVER "0.00 บาท/หน่วย").
 * For legacy zero-rate items without tiered metadata: returns "-" (neutral dash).
 * For standard scalar items: returns formatted rate "X.XX บาท/หน่วย".
 */
export function formatTierRateLabel(
  unitPrice?: number | string | null,
  unit?: string | null,
  metadata?: unknown
): string {
  const meta = metadata as Record<string, any> | undefined;
  if (meta?.mode === 'tiered') {
    return 'คิดตามขั้นบันได';
  }

  // Fail-closed for 0.00 placeholder without Tier metadata
  if (!meta && (unitPrice === 0 || unitPrice === '0' || unitPrice === '0.00')) {
    return '-';
  }

  return formatBillingRate(unitPrice, unit);
}
