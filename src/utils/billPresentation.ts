/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.3: Shared Bill & Tier Presentation Utilities
 */

import {
  CanonicalTierBreakdownItem,
  CanonicalTieredBillItemMetadata,
  formatBillingRate,
  formatBillingUnit,
} from '../types';

/**
 * Internal helper to parse a canonical whole-unit decimal string or integer number into BigInt.
 * Returns null if invalid whole unit.
 * Examples valid: "0", "0.0", "0.00", "10", "10.0", "10.00", "150.00", 0, 10, 150
 * Examples invalid: "abc", "10.50", "5.50", "-1", "1e2", Infinity, NaN, null, undefined, ""
 */
export function parseCanonicalWholeUnitForDisplay(val: unknown): bigint | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (Number.isFinite(val) && val >= 0 && Number.isInteger(val)) {
      return BigInt(val);
    }
    return null;
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!str || !/^\d+(\.0{1,2})?$/.test(str)) return null;
    const integerPart = str.split('.')[0];
    try {
      const b = BigInt(integerPart);
      return b >= 0n ? b : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Checks whether a value is a valid canonical whole unit integer decimal string or integer number.
 */
export function isCanonicalWholeUnitDisplay(val: unknown): boolean {
  return parseCanonicalWholeUnitForDisplay(val) !== null;
}

/**
 * Checks whether a value is a valid canonical money decimal string (max 2DP) or finite number.
 * Examples valid: "34.00", "55.25", "-10.00", "0.00", 34, 55.25
 * Examples invalid: "abc", "wrong", "1e2", Infinity, NaN, null, undefined, ""
 */
export function isCanonicalMoneyDisplay(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val);
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!str || !/^-?\d+(\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return Number.isFinite(num);
  }
  return false;
}

/**
 * Checks whether a value is a valid non-negative canonical money decimal string (max 2DP) or finite non-negative number.
 * Examples valid: "3.40", "0.00", "15.00", 3.4, 0
 * Examples invalid: "-1.00", "abc", "bad", "1e2", Infinity, NaN, null, undefined, ""
 */
export function isCanonicalPositiveMoneyDisplay(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0;
  }
  if (typeof val === 'string') {
    const str = val.trim();
    if (!str || !/^\d+(\.\d{1,2})?$/.test(str)) return false;
    const num = Number(str);
    return Number.isFinite(num) && num >= 0;
  }
  return false;
}

/**
 * Strict type guard validating that a bill item metadata object represents a valid, displayable Tiered utility.
 * Fails closed if:
 *   - metadata is missing, not object, or mode !== 'tiered'
 *   - usageUnits is missing, non-integer, or <= 0
 *   - tierBreakdown is empty or not array
 *   - first row lowerExclusive is not 0
 *   - upperInclusive is missing, undefined, or empty string (MUST be explicit null for unbounded)
 *   - upperInclusive === null is not the last row
 *   - non-contiguous sequence (gaps or overlaps between rows)
 *   - billedUnits is non-positive (0 or negative) or non-integer
 *   - prior finite tier was not fully consumed before advancing to next tier
 *   - final finite tier billedUnits exceeds capacity
 *   - SUM(tierBreakdown[].billedUnits) !== metadata.usageUnits
 *   - rate / tier row amount are not valid non-negative money values
 */
export function isValidTieredBillItemMetadata(
  metadata: unknown
): metadata is CanonicalTieredBillItemMetadata {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, any>;
  if (m.mode !== 'tiered') return false;
  if (!Array.isArray(m.tierBreakdown) || m.tierBreakdown.length === 0) return false;

  // 1. usageUnits must explicitly exist on metadata and be whole integer > 0
  if (!Object.prototype.hasOwnProperty.call(m, 'usageUnits')) return false;
  const totalUsage = parseCanonicalWholeUnitForDisplay(m.usageUnits);
  if (totalUsage === null || totalUsage <= 0n) return false;

  const totalRows = m.tierBreakdown.length;
  let sumBilledUnits = 0n;

  for (let idx = 0; idx < totalRows; idx++) {
    const item = m.tierBreakdown[idx];
    if (!item || typeof item !== 'object') return false;

    // 2. upperInclusive MUST explicitly exist on the item
    if (!Object.prototype.hasOwnProperty.call(item, 'upperInclusive')) return false;

    const upper = item.upperInclusive;

    // 3. lowerExclusive: valid non-negative whole-unit integer
    const lowerVal = parseCanonicalWholeUnitForDisplay(item.lowerExclusive);
    if (lowerVal === null) return false;

    // First row lowerExclusive MUST be zero
    if (idx === 0 && lowerVal !== 0n) return false;

    // 4. billedUnits: must be positive whole integer (billedUnits > 0)
    const billedUnits = parseCanonicalWholeUnitForDisplay(item.billedUnits);
    if (billedUnits === null || billedUnits <= 0n) return false;
    sumBilledUnits += billedUnits;

    // 5. rate: valid non-negative money decimal (max 2DP)
    if (!isCanonicalPositiveMoneyDisplay(item.rate)) return false;

    // 6. amount: valid non-negative money decimal (max 2DP) - no negative tier row amount
    if (!isCanonicalPositiveMoneyDisplay(item.amount)) return false;

    // 7. Sequential range integrity: each next row lowerExclusive must equal previous row upperInclusive
    if (idx > 0) {
      const prevUpper = m.tierBreakdown[idx - 1].upperInclusive;
      if (prevUpper === null) return false; // previous was unbounded, no subsequent rows allowed
      const prevUpperVal = parseCanonicalWholeUnitForDisplay(prevUpper);
      if (prevUpperVal === null || lowerVal !== prevUpperVal) return false; // gap or overlap detected
    }

    // 8. Range capacity and unbounded rules
    if (upper === null) {
      // Unbounded row MUST be the last row
      if (idx !== totalRows - 1) return false;
    } else {
      const upperVal = parseCanonicalWholeUnitForDisplay(upper);
      if (upperVal === null) return false;
      if (upperVal <= lowerVal) return false;

      const capacity = upperVal - lowerVal;

      if (idx < totalRows - 1) {
        // Prior tier before entering next tier MUST be fully consumed
        if (billedUnits !== capacity) return false;
      } else {
        // Last finite row: partially or fully consumed, but cannot exceed capacity
        if (billedUnits > capacity) return false;
      }
    }
  }

  // 9. Total usage reconciliation: SUM(tierBreakdown[].billedUnits) == metadata.usageUnits
  if (sumBilledUnits !== totalUsage) return false;

  return true;
}

/**
 * Formats a canonical progressive tier interval (lowerExclusive, upperInclusive) into human-readable Thai range.
 * ONLY upperInclusive === null explicitly produces unbounded range ("<start> หน่วยขึ้นไป").
 * Missing/empty/invalid upperInclusive fails closed to "- หน่วย".
 * Examples:
 *   (0.00, 10.00) -> "1–10 หน่วย"
 *   (10.00, 20.00) -> "11–20 หน่วย"
 *   (20.00, null) -> "21 หน่วยขึ้นไป"
 *   (20.00, undefined) -> "- หน่วย"
 *   (20.00, "") -> "- หน่วย"
 */
export function formatTierRange(
  lowerExclusive: string | number,
  upperInclusive: string | number | null | undefined,
  unitLabel = 'หน่วย'
): string {
  const lowerNum = Number(lowerExclusive);
  if (isNaN(lowerNum) || lowerNum < 0 || !isCanonicalWholeUnitDisplay(lowerExclusive)) {
    return `- ${unitLabel}`;
  }
  const start = Math.floor(lowerNum) + 1;

  // ONLY explicit null represents unbounded infinity
  if (upperInclusive === null) {
    return `${start} ${unitLabel}ขึ้นไป`;
  }

  if (!isCanonicalWholeUnitDisplay(upperInclusive)) {
    return `- ${unitLabel}`;
  }

  const upperNum = Number(upperInclusive);
  if (upperNum <= lowerNum) {
    return `- ${unitLabel}`;
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
