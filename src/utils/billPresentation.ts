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

/**
 * Formats a money/numeric value without useless .00 when exact integer,
 * and preserving 2-decimal precision on fractions.
 * Examples:
 *   18.00 -> "18"
 *   324.00 -> "324"
 *   4500.00 -> "4,500"
 *   18.50 -> "18.50"
 *   324.25 -> "324.25"
 */
export function formatMoneyPlain(val?: number | string | null): string {
  if (val === undefined || val === null || val === '') return '0';
  const num = Number(val);
  if (isNaN(num)) return String(val);
  const isInteger = Number.isInteger(num) || num === Math.floor(num);
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Returns canonical sorting weight for a line item (1 to 8):
 * 1. ค่าเช่า (rent)
 * 2. ค่าน้ำ (water)
 * 3. ค่าไฟฟ้า (electric / electricity)
 * 4. ค่าส่วนกลาง (common / common_fee)
 * 5. ค่าอินเทอร์เน็ต (internet)
 * 6. ค่าจอดรถ (parking)
 * 7. ค่าใช้จ่ายอื่น ๆ (other / other_fee)
 * 8. ค่าปรับชำระล่าช้า (fine / late_fee / late_fine)
 */
export function getCanonicalLineItemOrder(item: {
  type?: string | null;
  category?: string | null;
  description?: string | null;
}): number {
  const t = (item.type || item.category || '').toLowerCase();
  const d = (item.description || '').toLowerCase();

  if (t === 'rent' || d.includes('ค่าเช่า')) return 1;
  if (t === 'water' || d.includes('ค่าน้ำ')) return 2;
  if (t === 'electric' || t === 'electricity' || d.includes('ค่าไฟ') || d.includes('ค่าไฟฟ้า')) return 3;
  if (t === 'common' || t === 'common_fee' || d.includes('ค่าส่วนกลาง')) return 4;
  if (t === 'internet' || d.includes('อินเทอร์เน็ต') || d.includes('อินเตอร์เน็ต')) return 5;
  if (t === 'parking' || d.includes('ค่าจอดรถ')) return 6;
  if (t === 'fine' || t === 'late_fee' || t === 'late_fine' || d.includes('ค่าปรับ') || d.includes('ล่าช้า')) return 8;
  if (t === 'other' || t === 'other_fee' || t === 'other_fees' || d.includes('ค่าใช้จ่ายอื่น')) return 7;

  return 99;
}

/**
 * Sorts bill items according to canonical presentation order and filters out zero-amount items.
 */
export function sortCanonicalBillItems<T extends {
  type?: string | null;
  category?: string | null;
  description?: string | null;
  amount?: number | string | null;
}>(items?: T[] | null): T[] {
  if (!items || !Array.isArray(items)) return [];
  const nonZero = items.filter(it => {
    if (it.amount === undefined || it.amount === null || it.amount === '') return false;
    const num = Number(it.amount);
    return !isNaN(num) && num !== 0;
  });

  return [...nonZero].sort((a, b) => {
    return getCanonicalLineItemOrder(a) - getCanonicalLineItemOrder(b);
  });
}

/**
 * Formats a canonical line item label with formula for payment and billing presentation.
 * Enforces:
 * - "น้ำประปา" -> "น้ำ"
 * - Tiered: "ค่าน้ำ (12 หน่วย • ขั้นบันได)" or "ค่าไฟฟ้า (170 หน่วย • ขั้นบันได)"
 * - Rent: "ค่าเช่า (รายเดือน)", "ค่าเช่า (รายเทอม)", "ค่าเช่า (รายวัน)"
 * - Scalar: "ค่าน้ำ (@ 18 × 12 หน่วย)", "ค่าไฟฟ้า (@ 7 × 120 หน่วย)", "ค่าส่วนกลาง (@ 100 × 2 คน)", "ค่าจอดรถ (@ 200 × 1 คัน)"
 * - Never combines ambiguous multiple bases.
 */
export function formatCanonicalLineItemDescription(item: {
  type?: string | null;
  category?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unitPrice?: number | string | null;
  metadata?: unknown;
}, options?: {
  rentCycle?: 'monthly' | 'term' | 'daily' | string | null;
}): string {
  let desc = (item.description || '').replace(/\(ค้างชำระ\)/g, '').trim();
  const t = (item.type || item.category || '').toLowerCase();
  const meta = item.metadata as Record<string, any> | undefined;

  // 1. Tiered water / electricity
  if (meta?.mode === 'tiered' || desc.includes('ขั้นบันได')) {
    const units = meta?.usageUnits ? formatMoneyPlain(meta.usageUnits) : (item.quantity !== undefined && item.quantity !== null ? formatMoneyPlain(item.quantity) : '');
    const prefix = (t === 'water' || desc.includes('น้ำ')) ? 'ค่าน้ำ' : 'ค่าไฟฟ้า';
    if (units) {
      return `${prefix} (${units} หน่วย • ขั้นบันได)`;
    }
    return `${prefix} (ขั้นบันได)`;
  }

  // 2. Deposit / Security deposit (Canonical wording: Monthly, Term, Daily)
  if (
    t === 'deposit' ||
    t === 'security_deposit' ||
    desc.includes('ประกัน') ||
    desc.includes('มัดจำ')
  ) {
    const rc = options?.rentCycle || (
      desc.includes('รายเทอม') || desc.includes('เทอม') ? 'term' :
      desc.includes('รายวัน') || desc.includes('วัน') ? 'daily' : 'monthly'
    );
    if (rc === 'daily') return 'ค่าประกัน / มัดจำ (รายวัน)';
    if (rc === 'term') return 'ค่าประกัน / มัดจำ (รายเทอม)';
    return 'ค่าประกัน / มัดจำ (รายเดือน)';
  }

  // 3. Rent (Canonical wording with day/night semantics)
  if (t === 'rent' || desc.includes('ค่าเช่า')) {
    const rc = options?.rentCycle || (
      desc.includes('รายเทอม') || desc.includes('เทอม') ? 'term' :
      desc.includes('รายวัน') || desc.includes('วัน') ? 'daily' : 'monthly'
    );
    if (rc === 'term') return 'ค่าเช่า (รายเทอม)';
    if (rc === 'daily') {
      const matchNights = desc.match(/(\d+)\s*(คืน|วัน)/);
      if (matchNights) {
        return `ค่าเช่า (รายวัน) ${matchNights[1]} ${matchNights[2] === 'วัน' ? 'คืน' : matchNights[2]}`;
      }
      if (item.quantity !== undefined && item.quantity !== null && Number(item.quantity) > 0) {
        return `ค่าเช่า (รายวัน) ${item.quantity} คืน`;
      }
      return 'ค่าเช่า (รายวัน)';
    }
    return 'ค่าเช่า (รายเดือน)';
  }

  // 4. Normalized Title Base
  let title = desc;
  if (t === 'water' || desc.startsWith('ค่าน้ำ')) {
    title = 'ค่าน้ำ';
  } else if (t === 'electric' || t === 'electricity' || desc.startsWith('ค่าไฟ') || desc.startsWith('ค่าไฟฟ้า')) {
    title = 'ค่าไฟฟ้า';
  } else if (t === 'common' || t === 'common_fee' || desc.startsWith('ค่าส่วนกลาง')) {
    title = 'ค่าส่วนกลาง';
  } else if (t === 'internet' || desc.startsWith('ค่าอินเทอร์เน็ต') || desc.startsWith('ค่าอินเตอร์เน็ต')) {
    title = 'ค่าอินเทอร์เน็ต';
  } else if (t === 'parking' || desc.startsWith('ค่าจอดรถ')) {
    title = 'ค่าจอดรถ';
  } else if (t === 'fine' || t === 'late_fee' || t === 'late_fine' || desc.startsWith('ค่าปรับ')) {
    title = 'ค่าปรับชำระล่าช้า';
  }

  // Normalize user-facing "น้ำประปา" -> "น้ำ"
  title = title.replace(/น้ำประปา/g, 'น้ำ');

  // 5. Scalar rate formula if rate & quantity exist
  const rateNum = item.unitPrice !== undefined && item.unitPrice !== null ? Number(item.unitPrice) : null;
  const qtyNum = item.quantity !== undefined && item.quantity !== null ? Number(item.quantity) : null;

  if (rateNum !== null && !isNaN(rateNum) && qtyNum !== null && !isNaN(qtyNum) && rateNum > 0 && qtyNum > 0) {
    const rawUnit = (item.unit || '').trim().toLowerCase();
    let thaiUnit = '';
    if (rawUnit === 'unit') thaiUnit = 'หน่วย';
    else if (rawUnit === 'person') thaiUnit = 'คน';
    else if (rawUnit === 'room') thaiUnit = 'ห้อง';
    else if (rawUnit === 'vehicle' || rawUnit === 'car' || rawUnit === 'motorcycle') thaiUnit = 'คัน';
    else if (rawUnit === 'day') thaiUnit = 'วัน';
    else if (rawUnit === 'month') thaiUnit = 'เดือน';
    else if (rawUnit === 'term') thaiUnit = 'เทอม';
    else if (t === 'water' || t === 'electric' || t === 'electricity') thaiUnit = 'หน่วย';
    else if (t === 'parking') thaiUnit = 'คัน';
    else if (t === 'internet') thaiUnit = 'ห้อง';
    else if (t === 'fine' || t === 'late_fee') thaiUnit = 'วัน';

    const rateStr = formatMoneyPlain(rateNum);
    const qtyStr = formatMoneyPlain(qtyNum);
    const unitPart = thaiUnit ? ` ${thaiUnit}` : '';

    return `${title} (@ ${rateStr} × ${qtyStr}${unitPart})`;
  }

  return title;
}
