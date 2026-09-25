/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.3: Backend Immutable Receipt HTML Presentation Helper
 */

import { AppError } from '../types/index.js';
import { isCategoryTaxable, parseToSatangs, formatSatangs } from './monthly-utility-calculator.util.js';

/**
 * Formats a money amount with comma thousand separators and exact 2 decimal places.
 * Examples:
 *   10000 -> "10,000.00"
 *   1340.5 -> "1,340.50"
 *   "32.70" -> "32.70"
 *   0 -> "0.00"
 */
export function formatMoneyWithCommas(amount: any): string {
  if (amount === undefined || amount === null || amount === '') return '0.00';
  const num = typeof amount === 'number' ? amount : Number(String(amount).replace(/,/g, ''));
  if (isNaN(num)) return String(amount);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Pure Satang Math Thai Baht Text Formatter.
 * Handles integer and satang components according to Royal Institute of Thailand conventions.
 * Examples:
 *   3270n -> "สามสิบสองบาทเจ็ดสิบสตางค์"
 *   2200n -> "ยี่สิบสองบาทถ้วน"
 *   100000000n -> "หนึ่งล้านบาทถ้วน"
 */
export function formatThaiBahtText(satangs: bigint): string {
  if (satangs === 0n) return 'ศูนย์บาทถ้วน';
  const isNeg = satangs < 0n;
  const absSatangs = isNeg ? -satangs : satangs;
  const baht = absSatangs / 100n;
  const sat = absSatangs % 100n;

  const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  function convertGroup(num: number): string {
    let result = '';
    const digits = String(num).split('').map(Number);
    const len = digits.length;
    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const pos = len - i - 1;
      if (d === 0) continue;
      if (pos === 0 && d === 1 && len > 1) {
        result += 'เอ็ด';
      } else if (pos === 1 && d === 1) {
        result += 'สิบ';
      } else if (pos === 1 && d === 2) {
        result += 'ยี่สิบ';
      } else {
        result += DIGITS[d] + POSITIONS[pos];
      }
    }
    return result;
  }

  function convertInteger(b: bigint): string {
    if (b === 0n) return '';
    let result = '';
    let remaining = b;
    let groupIndex = 0;
    while (remaining > 0n) {
      const groupVal = Number(remaining % 1000000n);
      remaining = remaining / 1000000n;
      if (groupVal > 0) {
        const groupText = convertGroup(groupVal);
        result = groupText + (groupIndex > 0 ? 'ล้าน' : '') + result;
      } else if (groupIndex > 0 && remaining > 0n) {
        result = 'ล้าน' + result;
      }
      groupIndex++;
    }
    return result;
  }

  let text = '';
  if (baht > 0n) {
    text += convertInteger(baht) + 'บาท';
  }
  if (sat > 0n) {
    text += convertGroup(Number(sat)) + 'สตางค์';
  } else {
    text += 'ถ้วน';
  }
  return (isNeg ? 'ลบ' : '') + text;
}

/**
 * Strict HTML Escaping Helper.
 */
export function escapeHTML(str: any): string {
  if (str === null || str === undefined) return '-';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
 * Checks whether an amount is non-zero (suppresses 0.00 items in presentation).
 */
export function isNonZeroAmount(amount: any): boolean {
  if (amount === undefined || amount === null || amount === '') return false;
  const num = Number(amount);
  if (isNaN(num)) return false;
  return num !== 0;
}

/**
 * Strict type guard for valid Tiered utility metadata.
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
export function isValidTierMetadata(metadata: any): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.mode !== 'tiered') return false;
  if (!Array.isArray(metadata.tierBreakdown) || metadata.tierBreakdown.length === 0) return false;

  // 1. usageUnits must explicitly exist on metadata and be whole integer > 0
  if (!Object.prototype.hasOwnProperty.call(metadata, 'usageUnits')) return false;
  const totalUsage = parseCanonicalWholeUnitForDisplay(metadata.usageUnits);
  if (totalUsage === null || totalUsage <= 0n) return false;

  const totalRows = metadata.tierBreakdown.length;
  let sumBilledUnits = 0n;

  for (let idx = 0; idx < totalRows; idx++) {
    const item = metadata.tierBreakdown[idx];
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
      const prevUpper = metadata.tierBreakdown[idx - 1].upperInclusive;
      if (prevUpper === null) return false;
      const prevUpperVal = parseCanonicalWholeUnitForDisplay(prevUpper);
      if (prevUpperVal === null || lowerVal !== prevUpperVal) return false;
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
 * Formats a canonical progressive tier interval for display.
 * ONLY upperInclusive === null explicitly produces unbounded range ("<start> หน่วยขึ้นไป").
 * Missing/empty/invalid upperInclusive fails closed to "- หน่วย".
 */
export function formatTierRange(
  lowerExclusive: any,
  upperInclusive: any,
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
 * Resolves Thai display unit string from English or Thai input.
 */
export function resolveThaiUnit(unit?: string | null): string {
  if (!unit) return '';
  const u = String(unit).trim().toLowerCase();
  if (u === 'unit') return 'หน่วย';
  if (u === 'room') return 'ห้อง';
  if (u === 'month') return 'เดือน';
  if (u === 'person') return 'คน';
  if (u === 'day') return 'วัน';
  if (u === 'charge' || u === 'bill') return 'ครั้ง';
  return String(unit);
}

/**
 * Formats quantity for HTML receipt table.
 * Examples:
 *   15.00 with 'unit' -> "15 หน่วย"
 *   130 with 'unit' -> "130 หน่วย"
 *   1 with 'month' -> "1 เดือน"
 *   1 with null -> "1"
 */
export function formatQuantityHtml(quantity: any, unit?: any): string {
  if (quantity === undefined || quantity === null || quantity === '') {
    return '1';
  }
  const thaiUnit = resolveThaiUnit(unit);
  const num = Number(quantity);
  if (isNaN(num)) {
    return String(quantity);
  }
  const formattedNum = Number.isInteger(num) || num === Math.floor(num)
    ? Math.floor(num).toLocaleString('en-US')
    : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return thaiUnit ? `${formattedNum} ${thaiUnit}` : formattedNum;
}

/**
 * Formats rate label for HTML receipt table.
 * For tiered items: returns "คิดตามขั้นบันได" (NEVER "0.00 บาท/หน่วย").
 * For legacy zero-rate items without tiered metadata: returns "-" (neutral dash).
 * For standard scalar items: returns "X.XX บาท/หน่วย" or "X.XX บาท".
 */
export function formatRateHtml(unitPrice: any, unit: any, metadata: any): string {
  if (metadata?.mode === 'tiered') {
    return 'คิดตามขั้นบันได';
  }
  if (!metadata && (unitPrice === 0 || unitPrice === '0' || unitPrice === '0.00' || unitPrice === null || unitPrice === undefined || unitPrice === '')) {
    return '-';
  }
  const priceNum = Number(unitPrice);
  if (isNaN(priceNum)) return '-';
  const thaiUnit = resolveThaiUnit(unit);
  const unitStr = thaiUnit ? ` บาท/${escapeHTML(thaiUnit)}` : ' บาท';
  return `${formatMoneyWithCommas(priceNum)}${unitStr}`;
}

/**
 * Renders nested HTML tier breakdown rows.
 */
export function renderTierBreakdownHtml(metadata: any, unit?: any): string {
  if (!isValidTierMetadata(metadata)) return '';

  const unitLabel = resolveThaiUnit(unit) || 'หน่วย';
  const rows = metadata.tierBreakdown.map((t: any) => {
    const rangeText = formatTierRange(t.lowerExclusive, t.upperInclusive, unitLabel);
    const billedUnits = Math.round(Number(t.billedUnits)).toLocaleString('en-US');
    const rateStr = formatMoneyWithCommas(t.rate);
    const amountStr = formatMoneyWithCommas(t.amount);
    return `<div>• ${escapeHTML(rangeText)}: ${billedUnits} × ${escapeHTML(rateStr)} = ${escapeHTML(amountStr)} บาท</div>`;
  }).join('');

  return `
    <div style="font-size: 11px; color: #64748b; margin-top: 4px; padding-left: 8px; border-left: 2px solid #cbd5e1;">
      ${rows}
    </div>
  `;
}

function formatMetadataPlaceholder(val?: string | null): string {
  if (val === undefined || val === null) return '....................';
  const str = String(val).trim();
  if (str === '' || str === 'null' || str === 'undefined') return '....................';
  return escapeHTML(str);
}

function formatPaymentMethodThai(rawMethod?: string | null, paymentEvents?: any[]): string {
  let methods: string[] = [];
  if (Array.isArray(paymentEvents) && paymentEvents.length > 0) {
    methods = paymentEvents
      .map((e: any) => e?.method)
      .filter((m: any) => typeof m === 'string' && m.trim().length > 0 && m !== 'SETTLED');
  }

  if (methods.length === 0 && rawMethod && rawMethod !== 'SETTLED') {
    methods = rawMethod.split(',').map((s) => s.trim()).filter((m) => m && m !== 'SETTLED');
  }

  const uniqueMethods = Array.from(new Set(methods));
  if (uniqueMethods.length === 0) {
    return '....................';
  }

  const METHOD_THAI_MAP: Record<string, string> = {
    CASH: 'เงินสด',
    BANK_TRANSFER: 'โอนเงิน',
    PROMPTPAY: 'พร้อมเพย์',
    CREDIT_CARD: 'บัตรเครดิต',
    QR_CODE: 'สแกน QR',
    TRANSFER: 'โอนเงิน',
  };

  return uniqueMethods
    .map((m) => METHOD_THAI_MAP[m.toUpperCase()] || m)
    .join(' / ');
}

const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/**
 * Converts cycleCode (e.g. "2026-08") to Thai month and Buddhist Era year (e.g. "สิงหาคม 2569").
 * Malformed or non-matching cycle codes safely return the raw input without inventing a date.
 */
export function formatThaiBillingCycle(cycleCode?: string | null): string {
  if (!cycleCode || typeof cycleCode !== 'string') return '';
  const match = cycleCode.trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return cycleCode;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  if (month < 1 || month > 12) return cycleCode;
  const thaiMonth = THAI_MONTH_NAMES[month - 1];
  const buddhistYear = year + 543;
  return `${thaiMonth} ${buddhistYear}`;
}

/**
 * Pure generator for full immutable HTML receipt string.
 */
export function renderReceiptHtml(receiptRecord: any, options?: { hasCurrentLogo?: boolean }): string {
  const data = (receiptRecord.snapshotData as any) || {};
  const isCombined = data.isCombinedReceipt === true || (Array.isArray(data.billGroups) && data.billGroups.length > 0);
  const issuedDateStr = receiptRecord.issuedAt
    ? new Date(receiptRecord.issuedAt).toLocaleDateString('th-TH')
    : '-';

  const hasCurrentLogo = options?.hasCurrentLogo !== undefined
    ? options.hasCurrentLogo
    : Boolean(receiptRecord.dormitoryId && (receiptRecord.dormitory?.logoObjectKey || receiptRecord.hasLogo));

  // Validate grand total fail-closed
  if (data.total === undefined || data.total === null || String(data.total).trim() === '') {
    throw new AppError('Receipt grand total missing', 500, 'CANONICAL_FINANCIAL_VALUE_MISSING');
  }
  const grandTotalNum = Number(data.total);
  if (isNaN(grandTotalNum) || !isFinite(grandTotalNum)) {
    throw new AppError(`Receipt grand total malformed: ${data.total}`, 500, 'CANONICAL_FINANCIAL_VALUE_MALFORMED');
  }

  const isVatActive = Boolean(data.isVatActive || (data.vatAmount && Number(data.vatAmount) > 0));
  const subtotalNum = Number(data.subtotal || data.baseSubtotal || (grandTotalNum - Number(data.vatAmount || 0)));
  const vatAmountNum = Number(data.vatAmount || 0);
  const effectiveGrandTotalNum = (isVatActive && grandTotalNum === subtotalNum && vatAmountNum > 0)
    ? (subtotalNum + vatAmountNum)
    : grandTotalNum;

  const vatSettings = data.vatSettings || (isVatActive ? { enabled: true, rate: 7, appliedCategories: ['rent'] } : null);

  const resolveReceiptItemTaxAndDisplay = (i: any) => {
    const isTaxable = Boolean(i.metadata?.isTaxable) ||
      (isVatActive && i.metadata?.isTaxable !== false && isCategoryTaxable(i.type || i.category || i.description || '', vatSettings));

    const baseDesc = String(i.description || '').replace(/น้ำประปา/g, 'น้ำ');
    const description = isTaxable
      ? (baseDesc.includes('(+VAT)') ? baseDesc : `${baseDesc} (+VAT)`)
      : baseDesc;

    let displayAmountNum = Number(i.amount);
    if (isTaxable) {
      if (i.metadata?.netAmount !== undefined && i.metadata?.netAmount !== null) {
        displayAmountNum = Number(i.metadata.netAmount);
      } else if (i.metadata?.vatAmount !== undefined && i.metadata?.vatAmount !== null) {
        displayAmountNum = Number(i.amount) + Number(i.metadata.vatAmount);
      } else {
        const baseSatangs = parseToSatangs(i.amount);
        const vatSatangs = (baseSatangs * 700n + 5000n) / 10000n;
        displayAmountNum = Number(baseSatangs + vatSatangs) / 100;
      }
    }

    let unitPriceToFormat = i.unitPrice;
    if (isTaxable && i.metadata?.mode !== 'tiered') {
      const qty = Number(i.quantity);
      if (qty > 0) {
        unitPriceToFormat = displayAmountNum / qty;
      } else {
        unitPriceToFormat = displayAmountNum;
      }
    }

    return {
      isTaxable,
      description,
      displayAmountStr: displayAmountNum.toFixed(2),
      unitPriceToFormat,
    };
  };

  const renderItemsSectionHtml = () => {
    if (isCombined && Array.isArray(data.billGroups) && data.billGroups.length > 0) {
      const isFinalSettlement = Boolean(receiptRecord.isFinalSettlement || data.isFinalSettlement || receiptRecord.receiptKind === 'FINAL_SETTLEMENT');

      const validatedGroups = data.billGroups.map((group: any) => {
        const canonicalSettledRaw = isFinalSettlement
          ? group.paidAmount
          : (group.paidAmount !== undefined && group.paidAmount !== null ? group.paidAmount : group.allocatedAmount);

        if (canonicalSettledRaw === undefined || canonicalSettledRaw === null || String(canonicalSettledRaw).trim() === '') {
          throw new AppError(`Receipt financial value missing for bill ${group.billNumber || group.billId}`, 500, 'CANONICAL_FINANCIAL_VALUE_MISSING');
        }

        const settledNum = Number(canonicalSettledRaw);
        if (isNaN(settledNum) || !isFinite(settledNum)) {
          throw new AppError(`Receipt financial value malformed for bill ${group.billNumber || group.billId}: ${canonicalSettledRaw}`, 500, 'CANONICAL_FINANCIAL_VALUE_MALFORMED');
        }

        const rawBillTotal = group.billTotal ?? group.totalAmount ?? group.subtotal ?? group.allocatedAmount;
        if (rawBillTotal === undefined || rawBillTotal === null || String(rawBillTotal).trim() === '') {
          throw new AppError(`Receipt billTotal missing for bill ${group.billNumber || group.billId}`, 500, 'CANONICAL_FINANCIAL_VALUE_MISSING');
        }

        const billTotalNum = Number(rawBillTotal);
        if (isNaN(billTotalNum) || !isFinite(billTotalNum)) {
          throw new AppError(`Receipt billTotal malformed for bill ${group.billNumber || group.billId}: ${rawBillTotal}`, 500, 'CANONICAL_FINANCIAL_VALUE_MALFORMED');
        }

        const nonZeroItems = (group.items || []).filter((i: any) => isNonZeroAmount(i.amount));
        return {
          ...group,
          settledNum,
          billTotalNum,
          nonZeroItems,
        };
      });

      if (isFinalSettlement) {
        interface CycleContainer {
          cycleKey: string;
          cycleLabel: string;
          billNumbers: string[];
          items: any[];
          totalBill: number;
          totalSettled: number;
        }

        const containers: CycleContainer[] = [];
        for (const g of validatedGroups) {
          const rawCycle = g.cycleCode ? String(g.cycleCode).trim() : null;
          const cycleKey = rawCycle || `__NO_CYCLE_${g.billId || Math.random()}__`;
          let target = containers.find(c => c.cycleKey === cycleKey);
          if (!target) {
            let cycleLabel: string;
            if (rawCycle) {
              const thaiCycle = formatThaiBillingCycle(rawCycle);
              cycleLabel = `รอบบิล ${thaiCycle}`;
            } else {
              cycleLabel = g.billKind === 'DEPOSIT' ? 'เงินประกันสัญญาเช่า' : 'บิลค่าใช้จ่าย';
            }
            target = {
              cycleKey,
              cycleLabel,
              billNumbers: [],
              items: [],
              totalBill: 0,
              totalSettled: 0,
            };
            containers.push(target);
          }
          if (g.billNumber || g.billId) {
            target.billNumbers.push(g.billNumber || g.billId);
          }
          target.items.push(...g.nonZeroItems);
          target.totalBill += g.billTotalNum;
          target.totalSettled += g.settledNum;
        }

        return containers.map((container) => `
          <div class="group-box">
            <div class="group-header">
              <span>${escapeHTML(container.cycleLabel)}</span>
              <span style="font-size: 12px; color: #64748b;">เลขที่บิล: ${escapeHTML(container.billNumbers.filter(Boolean).join(', '))}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40px;">ลำดับ</th>
                  <th>รายการ</th>
                  <th class="num" style="width: 80px;">จำนวน</th>
                  <th class="num" style="width: 140px;">ราคา/หน่วย</th>
                  <th class="num" style="width: 120px;">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                ${container.items.map((i: any, idx: number) => {
                  const itemInfo = resolveReceiptItemTaxAndDisplay(i);
                  return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <div>${escapeHTML(itemInfo.description)}</div>
                      ${renderTierBreakdownHtml(i.metadata, i.unit)}
                    </td>
                    <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
                    <td class="num">${formatRateHtml(itemInfo.unitPriceToFormat, i.unit, i.metadata)}</td>
                    <td class="num">${escapeHTML(itemInfo.displayAmountStr)}</td>
                  </tr>
                `;
                }).join('')}
                <tr style="background: #f8fafc; font-size: 12px;">
                  <td colspan="4" class="num" style="font-weight: bold;">ยอดบิล:</td>
                  <td class="num" style="font-weight: bold;">${escapeHTML(formatMoneyWithCommas(container.totalBill))} ฿</td>
                </tr>
                <tr style="background: #f1f5f9; font-size: 12px; font-weight: bold;">
                  <td colspan="4" class="num" style="color: #4338ca;">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                  <td class="num" style="color: #4338ca; font-weight: 900;">${escapeHTML(formatMoneyWithCommas(container.totalSettled))} ฿</td>
                </tr>
              </tbody>
            </table>
          </div>
        `).join('');
      }

      return validatedGroups.map((group: any) => {
        const groupCycleLabel = group.cycleCode ? `รอบบิล ${escapeHTML(group.cycleCode)}` : (group.billKind === 'DEPOSIT' ? 'เงินประกันสัญญาเช่า' : 'บิลค่าใช้จ่าย');
        return `
          <div class="group-box">
            <div class="group-header">
              <span>${groupCycleLabel}</span>
              <span style="font-size: 12px; color: #64748b;">เลขที่บิล: ${escapeHTML(group.billNumber || group.billId)}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40px;">ลำดับ</th>
                  <th>รายการ</th>
                  <th class="num" style="width: 80px;">จำนวน</th>
                  <th class="num" style="width: 140px;">ราคา/หน่วย</th>
                  <th class="num" style="width: 120px;">จำนวนเงิน (บาท)</th>
                </tr>
              </thead>
              <tbody>
                ${group.nonZeroItems.map((i: any, idx: number) => {
                  const itemInfo = resolveReceiptItemTaxAndDisplay(i);
                  return `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <div>${escapeHTML(itemInfo.description)}</div>
                      ${renderTierBreakdownHtml(i.metadata, i.unit)}
                    </td>
                    <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
                    <td class="num">${formatRateHtml(itemInfo.unitPriceToFormat, i.unit, i.metadata)}</td>
                    <td class="num">${escapeHTML(itemInfo.displayAmountStr)}</td>
                  </tr>
                `;
                }).join('')}
              <tr style="background: #f8fafc; font-size: 12px;">
                <td colspan="4" class="num" style="font-weight: bold;">ยอดบิล:</td>
                <td class="num" style="font-weight: bold;">${escapeHTML(formatMoneyWithCommas(group.billTotalNum))} ฿</td>
              </tr>
              <tr style="background: #f1f5f9; font-size: 12px; font-weight: bold;">
                <td colspan="4" class="num" style="color: #4338ca;">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                <td class="num" style="color: #4338ca; font-weight: 900;">${escapeHTML(formatMoneyWithCommas(group.settledNum))} ฿</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      }).join('');
    }

    // Single bill items
    const rawItems = (Array.isArray(data.items) && data.items.length > 0)
      ? data.items.filter((i: any) => isNonZeroAmount(i.amount))
      : [];
    const singleItems = rawItems.length > 0
      ? rawItems
      : [{ description: 'ยอดชำระตามใบเสร็จเดิม', amount: data.total || '0.00', quantity: 1, unit: null, unitPrice: null }];

    return `
      <table>
        <thead>
          <tr>
            <th style="width: 40px;">ลำดับ</th>
            <th>รายการ</th>
            <th class="num" style="width: 80px;">จำนวน</th>
            <th class="num" style="width: 140px;">ราคา/หน่วย</th>
            <th class="num" style="width: 120px;">จำนวนเงิน (บาท)</th>
          </tr>
        </thead>
        <tbody>
          ${singleItems.map((i: any, idx: number) => {
            const itemInfo = resolveReceiptItemTaxAndDisplay(i);
            return `
            <tr>
              <td>${idx + 1}</td>
              <td>
                <div>${escapeHTML(itemInfo.description)}</div>
                ${renderTierBreakdownHtml(i.metadata, i.unit)}
              </td>
              <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
              <td class="num">${formatRateHtml(itemInfo.unitPriceToFormat, i.unit, i.metadata)}</td>
              <td class="num">${escapeHTML(itemInfo.displayAmountStr)}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
      </table>
    `;
  };

  const itemsHtml = renderItemsSectionHtml();

  const renderSheetContent = (sheetType: 'RECEIPT' | 'TAX_INVOICE') => {
    const isTaxInvoice = sheetType === 'TAX_INVOICE' || isVatActive;
    const title = isTaxInvoice ? 'ใบกำกับภาษี (TAX INVOICE)' : 'ใบเสร็จรับเงิน (RECEIPT)';
    const subtitle = isTaxInvoice
      ? `เลขที่: ${escapeHTML(receiptRecord.receiptNumber)}`
      : `เลขที่ใบเสร็จ: ${escapeHTML(receiptRecord.receiptNumber)}`;

    // Satang Math Calculation for Summary
    const allSnapshotItems = (Array.isArray(data.items) && data.items.length > 0)
      ? data.items
      : (Array.isArray(data.billGroups) && data.billGroups.length > 0
          ? data.billGroups.flatMap((g: any) => g.items || [])
          : []);

    let computedNonTaxableSatangs = 0n;
    let computedTaxableBaseSatangs = 0n;
    let computedVatSatangs = 0n;

    if (isVatActive && allSnapshotItems.length > 0) {
      for (const item of allSnapshotItems) {
        if (!isNonZeroAmount(item.amount)) continue;
        const isTaxable = Boolean(item.metadata?.isTaxable) ||
          (item.metadata?.isTaxable !== false && isCategoryTaxable(item.type || item.category || item.description || '', vatSettings));
        
        const itemBaseSatangs = parseToSatangs(item.amount);
        if (isTaxable) {
          computedTaxableBaseSatangs += itemBaseSatangs;
          if (item.metadata?.vatAmount !== undefined && item.metadata?.vatAmount !== null) {
            computedVatSatangs += parseToSatangs(item.metadata.vatAmount);
          } else {
            computedVatSatangs += (itemBaseSatangs * 700n + 5000n) / 10000n;
          }
        } else {
          computedNonTaxableSatangs += itemBaseSatangs;
        }
      }
    }

    const totalSatangs = parseToSatangs(effectiveGrandTotalNum);

    const nonTaxableSatangs = data.nonTaxableAmount !== undefined && data.nonTaxableAmount !== null
      ? parseToSatangs(data.nonTaxableAmount)
      : (data.subtotal !== undefined && data.vatAmount !== undefined
          ? (totalSatangs > parseToSatangs(data.subtotal) + parseToSatangs(data.vatAmount)
              ? totalSatangs - (parseToSatangs(data.subtotal) + parseToSatangs(data.vatAmount))
              : 0n)
          : computedNonTaxableSatangs);

    const taxableBaseSatangs = data.subtotal !== undefined && data.subtotal !== null
      ? parseToSatangs(data.subtotal)
      : (computedTaxableBaseSatangs > 0n ? computedTaxableBaseSatangs : (isVatActive ? parseToSatangs(subtotalNum) : 0n));

    const vatSatangs = data.vatAmount !== undefined && data.vatAmount !== null
      ? parseToSatangs(data.vatAmount)
      : (computedVatSatangs > 0n ? computedVatSatangs : (isVatActive ? parseToSatangs(vatAmountNum) : 0n));

    const thaiBahtText = formatThaiBahtText(totalSatangs);

    return `
      <div class="sheet">
        <div class="header" style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 24px;">
          ${hasCurrentLogo && receiptRecord.dormitoryId ? `<img class="dormLogo" src="/api/v1/dormitories/${escapeHTML(receiptRecord.dormitoryId)}/logo" alt="" style="max-height: 56px; max-width: 140px; object-fit: contain;" />` : ''}
          <div>
            <h1 style="margin: 0; color: #4338ca; font-size: 22px;">${title}</h1>
            <p style="margin: 4px 0 0; color: #64748b; font-size: 13px; font-weight: bold;">${subtitle}</p>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-card">
            <p><strong>${isTaxInvoice ? 'ผู้ออกเอกสาร / ผู้รับเงิน:' : 'ผู้รับเงิน:'}</strong> ${formatMetadataPlaceholder(data.receiverName)}</p>
            <p><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${formatMetadataPlaceholder(data.dormitoryTaxId)}</p>
            <p><strong>ที่อยู่:</strong> ${formatMetadataPlaceholder(data.dormitoryAddress)}</p>
            <p><strong>โทรศัพท์:</strong> ${formatMetadataPlaceholder(data.dormitoryPhone)}</p>
          </div>
          <div class="meta-card">
            <p><strong>${isTaxInvoice ? 'ผู้ซื้อ / ผู้เช่า:' : 'ผู้เช่า:'}</strong> ${formatMetadataPlaceholder(data.tenantName)}</p>
            <p><strong>ห้องพัก:</strong> ${formatMetadataPlaceholder(data.roomNumber)}</p>
            ${!isCombined && data.billNumber && !data.hideBillReference ? `<p><strong>อ้างอิงบิล:</strong> ${escapeHTML(data.billNumber)}</p>` : ''}
            <p><strong>ช่องทางชำระเงิน:</strong> ${formatPaymentMethodThai(data.paymentMethod, data.paymentEvents)}</p>
            <p><strong>${isTaxInvoice ? 'วันที่ออกเอกสาร:' : 'วันที่ออกใบเสร็จ:'}</strong> ${issuedDateStr}</p>
          </div>
        </div>

        ${itemsHtml}

        <div class="totals-area">
          ${!isCombined && data.billTotal && Number(data.billTotal) !== effectiveGrandTotalNum ? `
            <div class="total-row"><span>ยอดบิล:</span><span>${escapeHTML(formatMoneyWithCommas(data.billTotal))} ฿</span></div>
            <div class="total-row"><span>ยอดรับชำระในใบเสร็จนี้:</span><span>${escapeHTML(formatMoneyWithCommas(effectiveGrandTotalNum))} ฿</span></div>
          ` : ''}
          ${isVatActive ? (
            nonTaxableSatangs > 0n ? `
              <div class="total-row"><span>ยอดที่ไม่คิดภาษี (Non-taxable Amount):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(nonTaxableSatangs)))} ฿</span></div>
              <div class="total-row"><span>รวมเงินก่อนภาษี (Taxable Subtotal):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(taxableBaseSatangs)))} ฿</span></div>
              <div class="total-row"><span>ภาษีมูลค่าเพิ่ม 7% (VAT 7%):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(vatSatangs)))} ฿</span></div>
              <div class="total-row grand-total"><span>จำนวนเงินรวมทั้งสิ้น (Total Net Amount):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(totalSatangs)))} ฿</span></div>
              <div class="baht-text" style="width: 100%; text-align: right; font-weight: bold; color: #4338ca; margin-top: 6px; font-size: 13px;">(${escapeHTML(thaiBahtText)})</div>
            ` : `
              <div class="total-row"><span>รวมเงินก่อนภาษี (Subtotal):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(taxableBaseSatangs)))} ฿</span></div>
              <div class="total-row"><span>ภาษีมูลค่าเพิ่ม 7% (VAT 7%):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(vatSatangs)))} ฿</span></div>
              <div class="total-row grand-total"><span>จำนวนเงินรวมทั้งสิ้น (Total Net Amount):</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(totalSatangs)))} ฿</span></div>
              <div class="baht-text" style="width: 100%; text-align: right; font-weight: bold; color: #4338ca; margin-top: 6px; font-size: 13px;">(${escapeHTML(thaiBahtText)})</div>
            `
          ) : `
            <div class="total-row grand-total"><span>รวมรับสุทธิ:</span><span>${escapeHTML(formatMoneyWithCommas(formatSatangs(totalSatangs)))} ฿</span></div>
            <div class="baht-text" style="width: 100%; text-align: right; font-weight: bold; color: #4338ca; margin-top: 6px; font-size: 13px;">(${escapeHTML(thaiBahtText)})</div>
          `}
        </div>

        <!-- Two-Column Signature Area -->
        <div class="signature-section" style="margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; page-break-inside: avoid; break-inside: avoid;">
          <div class="signature-box" style="text-align: center; font-size: 13px; line-height: 1.8;">
            <p style="font-weight: bold; margin-bottom: 36px; color: #334155;">${isTaxInvoice ? 'ผู้รับใบกำกับภาษี' : 'ผู้ชำระเงิน / ผู้เช่า'}</p>
            <p style="margin: 0; color: #475569;">ลงชื่อ ______________________________</p>
            <p style="margin: 4px 0 0; color: #475569;">(__________________________________)</p>
            <p style="margin: 12px 0 0; color: #475569;">วันที่ ______ / ______ / ______</p>
          </div>
          <div class="signature-box" style="text-align: center; font-size: 13px; line-height: 1.8;">
            <p style="font-weight: bold; margin-bottom: 36px; color: #334155;">${isTaxInvoice ? 'ผู้มีอำนาจลงนาม / ผู้รับเงิน' : 'ผู้รับเงิน / เจ้าของหอพัก'}</p>
            <p style="margin: 0; color: #475569;">ลงชื่อ ______________________________</p>
            <p style="margin: 4px 0 0; color: #475569;">(__________________________________)</p>
            <p style="margin: 12px 0 0; color: #475569;">วันที่ ______ / ______ / ______</p>
          </div>
        </div>
      </div>
    `;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${isVatActive ? 'Tax Invoice' : 'Receipt'} ${escapeHTML(receiptRecord.receiptNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    @media print {
      @page { size: A4; margin: 10mm 12mm; }
      body { margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; max-width: 100% !important; background: #fff !important; }
      .no-print { display: none !important; }
      .sheet { page-break-after: always; break-after: page; border: none !important; padding: 0 !important; margin: 0 0 0 0 !important; box-shadow: none !important; }
      .sheet:last-child { page-break-after: avoid; break-after: avoid; }
    }
    body { font-family: 'Sarabun', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 820px; margin: 24px auto; padding: 0 12px; background: #f8fafc; overflow-x: hidden; }
    .sheet { background: #fff; padding: 28px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); max-width: 100%; overflow-x: hidden; }
    .sheet:last-child { margin-bottom: 0; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { margin: 0; color: #4338ca; font-size: 22px; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 13px; font-weight: bold; }
    .void-banner { color: #dc2626; background: #fee2e2; border: 1px solid #f87171; text-align: center; font-weight: bold; padding: 12px; margin-bottom: 20px; border-radius: 8px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; font-size: 13px; }
    .meta-card { background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #e2e8f0; overflow-wrap: anywhere; word-break: break-word; }
    .meta-card p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; table-layout: auto; word-break: break-word; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f1f5f9; color: #334155; }
    .num { text-align: right; }
    .group-box { margin-bottom: 16px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; background: #fff; }
    .group-header { font-weight: bold; font-size: 13px; margin-bottom: 6px; color: #1e293b; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px; }
    .totals-area { margin-top: 16px; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; width: 100%; }
    .total-row { display: flex; justify-content: space-between; align-items: baseline; min-width: 440px; width: 440px; max-width: 100%; padding: 4px 0; gap: 16px; }
    .total-row span:first-child { white-space: nowrap; }
    .total-row span:last-child { white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
    .grand-total { font-weight: 900; font-size: 16px; color: #4338ca; border-top: 2px solid #cbd5e1; padding-top: 8px; margin-top: 4px; }
    @media (max-width: 640px) {
      html, body { margin: 0; padding: 8px; width: 100%; max-width: 100vw; overflow-x: hidden; }
      .sheet { padding: 16px 12px; border-radius: 10px; margin-bottom: 16px; }
      .header { flex-direction: column !important; gap: 8px !important; margin-bottom: 16px !important; }
      .header h1 { font-size: 18px !important; }
      .meta-grid { grid-template-columns: 1fr; gap: 10px; margin-bottom: 14px; font-size: 12px; }
      .meta-card { padding: 10px; }
      table { font-size: 11px; }
      th, td { padding: 6px 5px; width: auto !important; }
      .total-row { min-width: 0 !important; width: 100% !important; gap: 8px; font-size: 13px; }
      .total-row span:first-child { white-space: normal; }
      .grand-total { font-size: 15px; }
      .signature-section { grid-template-columns: 1fr !important; gap: 20px !important; margin-top: 24px !important; }
      .signature-box { font-size: 12px !important; overflow-wrap: anywhere; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="display: flex; justify-content: flex-end; margin-bottom: 14px; padding: 0 4px;">
    <button id="printReceiptBtn" type="button" style="padding: 10px 18px; background: #4f46e5; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 14px; box-shadow: 0 2px 6px rgba(79,70,229,0.25);">พิมพ์ / บันทึกเป็น PDF</button>
  </div>
  ${receiptRecord.isVoided ? `<div class="void-banner">ยกเลิกแล้ว (VOIDED): ${escapeHTML(receiptRecord.voidReason || 'ไม่มีระบุเหตุผล')}</div>` : ''}
  ${isVatActive ? renderSheetContent('TAX_INVOICE') : renderSheetContent('RECEIPT')}

  <script>
    (function() {
      var btn = document.getElementById('printReceiptBtn');
      if (btn) {
        btn.addEventListener('click', function() {
          window.focus();
          window.print();
        });
      }
      var logos = document.querySelectorAll('.dormLogo');
      logos.forEach(function(logo) {
        logo.addEventListener('error', function() {
          this.style.display = 'none';
        });
      });
    })();
  </script>
</body>
</html>
  `.trim();
}
