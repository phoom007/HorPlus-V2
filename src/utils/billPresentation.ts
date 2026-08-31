/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2: Shared Bill & Tier Presentation Utilities
 */

import {
  CanonicalTierBreakdownItem,
  CanonicalTieredBillItemMetadata,
  formatBillingRate,
  formatBillingUnit,
} from '../types';

/**
 * Type guard validating that a bill item metadata object represents a valid, displayable Tiered utility.
 * Fails closed if metadata is missing, malformed, or has empty breakdown.
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
    if (item.lowerExclusive === undefined || item.lowerExclusive === null) return false;
    if (item.billedUnits === undefined || item.billedUnits === null) return false;
    if (item.rate === undefined || item.rate === null) return false;
    if (item.amount === undefined || item.amount === null) return false;
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
  const start = isNaN(lowerNum) ? 1 : Math.floor(lowerNum) + 1;

  if (upperInclusive === null || upperInclusive === undefined || upperInclusive === '') {
    return `${start} ${unitLabel}ขึ้นไป`;
  }

  const upperNum = Number(upperInclusive);
  if (isNaN(upperNum)) {
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
  if (isNaN(val)) return `- ${unitLabel}`;
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
