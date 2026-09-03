/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.3: Backend Immutable Receipt HTML Presentation Helper
 */

import { AppError } from '../types/index.js';

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
    ? String(Math.floor(num))
    : num.toFixed(2);
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
  return `${priceNum.toFixed(2)}${unitStr}`;
}

/**
 * Renders nested HTML tier breakdown rows.
 */
export function renderTierBreakdownHtml(metadata: any, unit?: any): string {
  if (!isValidTierMetadata(metadata)) return '';

  const unitLabel = resolveThaiUnit(unit) || 'หน่วย';
  const rows = metadata.tierBreakdown.map((t: any) => {
    const rangeText = formatTierRange(t.lowerExclusive, t.upperInclusive, unitLabel);
    const billedUnits = Math.round(Number(t.billedUnits));
    const rateStr = Number(t.rate).toFixed(2);
    const amountStr = Number(t.amount).toFixed(2);
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

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${escapeHTML(receiptRecord.receiptNumber)}</title>
  <style>
    @media print {
      @page { size: A4; margin: 10mm 12mm; }
      body { margin: 0 !important; padding: 0 !important; border: none !important; box-shadow: none !important; max-width: 100% !important; }
      .no-print { display: none !important; }
    }
    body { font-family: 'Sarabun', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 800px; margin: 40px auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { margin: 0; color: #4338ca; font-size: 24px; }
    .header p { margin: 4px 0 0; color: #64748b; font-size: 14px; font-weight: bold; }
    .void-banner { color: #dc2626; background: #fee2e2; border: 1px solid #f87171; text-align: center; font-weight: bold; padding: 12px; margin-bottom: 20px; border-radius: 8px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 13px; }
    .meta-card { background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0; }
    .meta-card p { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 10px 12px; text-align: left; }
    th { background: #f1f5f9; color: #334155; }
    .num { text-align: right; }
    .group-box { margin-bottom: 20px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px; background: #fff; }
    .group-header { font-weight: bold; font-size: 14px; margin-bottom: 8px; color: #1e293b; display: flex; justify-content: space-between; }
    .totals-area { margin-top: 16px; display: flex; flex-direction: column; align-items: flex-end; font-size: 14px; }
    .total-row { display: flex; justify-content: space-between; width: 320px; padding: 4px 0; }
    .grand-total { font-weight: 900; font-size: 16px; color: #4338ca; border-top: 2px solid #cbd5e1; padding-top: 8px; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="no-print" style="text-align: right; margin-bottom: 20px;">
    <button id="printReceiptBtn" type="button" style="padding: 8px 16px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">พิมพ์ใบเสร็จ</button>
  </div>
  ${receiptRecord.isVoided ? `<div class="void-banner">ยกเลิกแล้ว (VOIDED): ${escapeHTML(receiptRecord.voidReason || 'ไม่มีระบุเหตุผล')}</div>` : ''}
  <div class="header" style="display: flex; align-items: center; justify-content: center; gap: 16px; margin-bottom: 24px;">
    ${hasCurrentLogo && receiptRecord.dormitoryId ? `<img id="dormLogo" src="/api/v1/dormitories/${escapeHTML(receiptRecord.dormitoryId)}/logo" alt="" style="max-height: 56px; max-width: 140px; object-fit: contain;" />` : ''}
    <div>
      <h1 style="margin: 0; color: #4338ca; font-size: 24px;">ใบเสร็จรับเงิน (RECEIPT)</h1>
      <p style="margin: 4px 0 0; color: #64748b; font-size: 14px; font-weight: bold;">เลขที่ใบเสร็จ: ${escapeHTML(receiptRecord.receiptNumber)}</p>
    </div>
  </div>
  <div class="meta-grid">
    <div class="meta-card">
      <p><strong>ผู้รับเงิน:</strong> ${formatMetadataPlaceholder(data.receiverName)}</p>
      <p><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${formatMetadataPlaceholder(data.dormitoryTaxId)}</p>
      <p><strong>ที่อยู่:</strong> ${formatMetadataPlaceholder(data.dormitoryAddress)}</p>
      <p><strong>โทรศัพท์:</strong> ${formatMetadataPlaceholder(data.dormitoryPhone)}</p>
    </div>
    <div class="meta-card">
      <p><strong>ผู้เช่า:</strong> ${formatMetadataPlaceholder(data.tenantName)}</p>
      <p><strong>ห้องพัก:</strong> ${formatMetadataPlaceholder(data.roomNumber)}</p>
      ${!isCombined && data.billNumber ? `<p><strong>อ้างอิงบิล:</strong> ${escapeHTML(data.billNumber)}</p>` : ''}
      <p><strong>ช่องทางชำระเงิน:</strong> ${formatPaymentMethodThai(data.paymentMethod, data.paymentEvents)}</p>
      <p><strong>วันที่ออกใบเสร็จ:</strong> ${issuedDateStr}</p>
    </div>
  </div>

  ${isCombined && Array.isArray(data.billGroups) && data.billGroups.length > 0 ? `
    <!-- Combined Multi-Bill Groups Section -->
    ${(() => {
      const isFinalSettlement = Boolean(receiptRecord.isFinalSettlement || data.isFinalSettlement || receiptRecord.receiptKind === 'FINAL_SETTLEMENT');

      // Validate all billGroup financial values strictly first
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

        if (group.billTotal === undefined || group.billTotal === null || String(group.billTotal).trim() === '') {
          throw new AppError(`Receipt billTotal missing for bill ${group.billNumber || group.billId}`, 500, 'CANONICAL_FINANCIAL_VALUE_MISSING');
        }

        const billTotalNum = Number(group.billTotal);
        if (isNaN(billTotalNum) || !isFinite(billTotalNum)) {
          throw new AppError(`Receipt billTotal malformed for bill ${group.billNumber || group.billId}: ${group.billTotal}`, 500, 'CANONICAL_FINANCIAL_VALUE_MALFORMED');
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
        // Visual cycle consolidation for FINAL_SETTLEMENT (Sections 7, 8, 9, 10 & Amendment 3)
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
                ${container.items.map((i: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <div>${escapeHTML(String(i.description || '').replace(/น้ำประปา/g, 'น้ำ'))}</div>
                      ${renderTierBreakdownHtml(i.metadata, i.unit)}
                    </td>
                    <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
                    <td class="num">${formatRateHtml(i.unitPrice, i.unit, i.metadata)}</td>
                    <td class="num">${escapeHTML(Number(i.amount).toFixed(2))}</td>
                  </tr>
                `).join('')}
                <tr style="background: #f8fafc; font-size: 12px;">
                  <td colspan="4" class="num" style="font-weight: bold;">ยอดบิล:</td>
                  <td class="num" style="font-weight: bold;">${escapeHTML(container.totalBill.toFixed(2))} ฿</td>
                </tr>
                <tr style="background: #f1f5f9; font-size: 12px; font-weight: bold;">
                  <td colspan="4" class="num" style="color: #4338ca;">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                  <td class="num" style="color: #4338ca; font-weight: 900;">${escapeHTML(container.totalSettled.toFixed(2))} ฿</td>
                </tr>
              </tbody>
            </table>
          </div>
        `).join('');
      }

      // Legacy / Event multi-bill rendering preserved exactly
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
                ${group.nonZeroItems.map((i: any, idx: number) => `
                  <tr>
                    <td>${idx + 1}</td>
                    <td>
                      <div>${escapeHTML(String(i.description || '').replace(/น้ำประปา/g, 'น้ำ'))}</div>
                      ${renderTierBreakdownHtml(i.metadata, i.unit)}
                    </td>
                    <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
                    <td class="num">${formatRateHtml(i.unitPrice, i.unit, i.metadata)}</td>
                    <td class="num">${escapeHTML(Number(i.amount).toFixed(2))}</td>
                  </tr>
                `).join('')}
              <tr style="background: #f8fafc; font-size: 12px;">
                <td colspan="4" class="num" style="font-weight: bold;">ยอดบิล:</td>
                <td class="num" style="font-weight: bold;">${escapeHTML(group.billTotalNum.toFixed(2))} ฿</td>
              </tr>
              <tr style="background: #f1f5f9; font-size: 12px; font-weight: bold;">
                <td colspan="4" class="num" style="color: #4338ca;">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                <td class="num" style="color: #4338ca; font-weight: 900;">${escapeHTML(group.settledNum.toFixed(2))} ฿</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      }).join('');
    })()}
  ` : `
    <!-- Single Bill Items Section -->
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
        ${(() => {
          const rawItems = (Array.isArray(data.items) && data.items.length > 0)
            ? data.items.filter((i: any) => isNonZeroAmount(i.amount))
            : [];
          const singleItems = rawItems.length > 0
            ? rawItems
            : [{ description: 'ยอดชำระตามใบเสร็จเดิม', amount: data.total || '0.00', quantity: 1, unit: null, unitPrice: null }];

          return singleItems.map((i: any, idx: number) => `
            <tr>
              <td>${idx + 1}</td>
              <td>
                <div>${escapeHTML(String(i.description || '').replace(/น้ำประปา/g, 'น้ำ'))}</div>
                ${renderTierBreakdownHtml(i.metadata, i.unit)}
              </td>
              <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
              <td class="num">${formatRateHtml(i.unitPrice, i.unit, i.metadata)}</td>
              <td class="num">${escapeHTML(Number(i.amount).toFixed(2))}</td>
            </tr>
          `).join('');
        })()}
      </tbody>
    </table>
  `}

  <div class="totals-area">
    ${!isCombined && data.billTotal && Number(data.billTotal) !== grandTotalNum ? `
      <div class="total-row"><span>ยอดบิล:</span><span>${escapeHTML(Number(data.billTotal).toFixed(2))} ฿</span></div>
      <div class="total-row"><span>ยอดรับชำระในใบเสร็จนี้:</span><span>${escapeHTML(grandTotalNum.toFixed(2))} ฿</span></div>
    ` : ''}
    <div class="total-row grand-total"><span>รวมรับสุทธิ:</span><span>${escapeHTML(grandTotalNum.toFixed(2))} ฿</span></div>
  </div>

  <!-- Print-ready Two-Column Signature Area -->
  <div class="signature-section" style="margin-top: 48px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; page-break-inside: avoid; break-inside: avoid;">
    <div class="signature-box" style="text-align: center; font-size: 13px; line-height: 1.8;">
      <p style="font-weight: bold; margin-bottom: 36px; color: #334155;">ผู้ชำระเงิน / ผู้เช่า</p>
      <p style="margin: 0; color: #475569;">ลงชื่อ ______________________________</p>
      <p style="margin: 4px 0 0; color: #475569;">(__________________________________)</p>
      <p style="margin: 12px 0 0; color: #475569;">วันที่ ______ / ______ / ______</p>
    </div>
    <div class="signature-box" style="text-align: center; font-size: 13px; line-height: 1.8;">
      <p style="font-weight: bold; margin-bottom: 36px; color: #334155;">ผู้รับเงิน / เจ้าของหอพัก</p>
      <p style="margin: 0; color: #475569;">ลงชื่อ ______________________________</p>
      <p style="margin: 4px 0 0; color: #475569;">(__________________________________)</p>
      <p style="margin: 12px 0 0; color: #475569;">วันที่ ______ / ______ / ______</p>
    </div>
  </div>

  <script>
    (function() {
      var btn = document.getElementById('printReceiptBtn');
      if (btn) {
        btn.addEventListener('click', function() {
          window.focus();
          window.print();
        });
      }
      var logo = document.getElementById('dormLogo');
      if (logo) {
        logo.addEventListener('error', function() {
          this.style.display = 'none';
        });
      }
    })();
  </script>
</body>
</html>
  `.trim();
}
