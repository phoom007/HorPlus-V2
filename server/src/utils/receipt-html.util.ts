/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.1: Backend Immutable Receipt HTML Presentation Helper
 */

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
 * Fails closed if metadata is missing, malformed, non-integer boundaries, fractional usage, or has empty breakdown.
 */
export function isValidTierMetadata(metadata: any): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  if (metadata.mode !== 'tiered') return false;
  if (!Array.isArray(metadata.tierBreakdown) || metadata.tierBreakdown.length === 0) return false;

  for (const item of metadata.tierBreakdown) {
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
 * Formats a canonical progressive tier interval for display.
 */
export function formatTierRange(
  lowerExclusive: any,
  upperInclusive: any,
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

/**
 * Pure generator for full immutable HTML receipt string.
 */
export function renderReceiptHtml(receiptRecord: any): string {
  const data = (receiptRecord.snapshotData as any) || {};
  const isCombined = data.isCombinedReceipt === true || (Array.isArray(data.billGroups) && data.billGroups.length > 0);
  const issuedDateStr = receiptRecord.issuedAt
    ? new Date(receiptRecord.issuedAt).toLocaleDateString('th-TH')
    : '-';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Receipt ${escapeHTML(receiptRecord.receiptNumber)}</title>
  <style>
    @media print {
      @page { size: A4; margin: 20mm; }
      body { margin: 0; font-family: sans-serif; }
      .no-print { display: none; }
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
    <button onclick="window.print()" style="padding: 8px 16px; background: #4f46e5; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">พิมพ์ใบเสร็จ (Print Receipt)</button>
  </div>
  ${receiptRecord.isVoided ? `<div class="void-banner">ยกเลิกแล้ว (VOIDED): ${escapeHTML(receiptRecord.voidReason || 'ไม่มีระบุเหตุผล')}</div>` : ''}
  <div class="header">
    <h1>ใบเสร็จรับเงิน (RECEIPT)</h1>
    <p>เลขที่ใบเสร็จ: ${escapeHTML(receiptRecord.receiptNumber)}</p>
  </div>
  <div class="meta-grid">
    <div class="meta-card">
      <p><strong>ผู้รับเงิน / หอพัก:</strong> ${escapeHTML(data.dormitoryName)}</p>
      <p><strong>เลขประจำตัวผู้เสียภาษี:</strong> ${escapeHTML(data.dormitoryTaxId)}</p>
      <p><strong>ที่อยู่:</strong> ${escapeHTML(data.dormitoryAddress)}</p>
      <p><strong>โทรศัพท์:</strong> ${escapeHTML(data.dormitoryPhone)}</p>
    </div>
    <div class="meta-card">
      <p><strong>ผู้เช่า:</strong> ${escapeHTML(data.tenantName)}</p>
      <p><strong>ห้องพัก:</strong> ${escapeHTML(data.roomNumber)}</p>
      ${!isCombined && data.billNumber ? `<p><strong>อ้างอิงบิล:</strong> ${escapeHTML(data.billNumber)}</p>` : ''}
      <p><strong>ช่องทางชำระเงิน:</strong> ${escapeHTML(data.paymentMethod)}</p>
      <p><strong>วันที่ออกใบเสร็จ:</strong> ${issuedDateStr}</p>
    </div>
  </div>

  ${isCombined && Array.isArray(data.billGroups) && data.billGroups.length > 0 ? `
    <!-- Combined Multi-Bill Groups Section -->
    ${data.billGroups.map((group: any) => {
      const nonZeroItems = (group.items || []).filter((i: any) => isNonZeroAmount(i.amount));
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
              ${nonZeroItems.map((i: any, idx: number) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td>
                    <div>${escapeHTML(i.description)}</div>
                    ${renderTierBreakdownHtml(i.metadata, i.unit)}
                  </td>
                  <td class="num">${escapeHTML(formatQuantityHtml(i.quantity, i.unit))}</td>
                  <td class="num">${formatRateHtml(i.unitPrice, i.unit, i.metadata)}</td>
                  <td class="num">${escapeHTML(Number(i.amount).toFixed(2))}</td>
                </tr>
              `).join('')}
              <tr style="background: #f8fafc; font-size: 12px;">
                <td colspan="4" class="num" style="font-weight: bold;">ยอดบิล:</td>
                <td class="num" style="font-weight: bold;">${escapeHTML(Number(group.billTotal).toFixed(2))} ฿</td>
              </tr>
              <tr style="background: #f1f5f9; font-size: 12px; font-weight: bold;">
                <td colspan="4" class="num" style="color: #4338ca;">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                <td class="num" style="color: #4338ca; font-weight: 900;">${escapeHTML(Number(group.allocatedAmount).toFixed(2))} ฿</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    }).join('')}
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
                <div>${escapeHTML(i.description)}</div>
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
    ${!isCombined && data.billTotal && Number(data.billTotal) !== Number(data.total) ? `
      <div class="total-row"><span>ยอดบิล:</span><span>${escapeHTML(Number(data.billTotal).toFixed(2))} ฿</span></div>
      <div class="total-row"><span>ยอดรับชำระในใบเสร็จนี้:</span><span>${escapeHTML(Number(data.total).toFixed(2))} ฿</span></div>
    ` : ''}
    <div class="total-row grand-total"><span>รวมรับสุทธิ:</span><span>${escapeHTML(Number(data.total).toFixed(2))} ฿</span></div>
  </div>
</body>
</html>
  `.trim();
}
