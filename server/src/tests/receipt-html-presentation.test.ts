/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.3: Backend Receipt HTML Presentation Test Suite
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHTML,
  isNonZeroAmount,
  isCanonicalWholeUnitDisplay,
  isCanonicalMoneyDisplay,
  isCanonicalPositiveMoneyDisplay,
  parseCanonicalWholeUnitForDisplay,
  isValidTierMetadata,
  formatTierRange,
  formatQuantityHtml,
  formatRateHtml,
  renderTierBreakdownHtml,
  renderReceiptHtml,
} from '../utils/receipt-html.util.js';

describe('OWNER R3.9-E.1B.2.3 — Backend Receipt HTML Presentation Authority', () => {
  const tieredWaterMetadata = {
    mode: 'tiered',
    usageUnits: '15.00',
    tierBreakdown: [
      {
        lowerExclusive: '0.00',
        upperInclusive: '10.00',
        billedUnits: '10.00',
        rate: '3.40',
        amount: '34.00',
      },
      {
        lowerExclusive: '10.00',
        upperInclusive: '20.00',
        billedUnits: '5.00',
        rate: '4.25',
        amount: '21.25',
      },
    ],
  };

  const tieredElecMetadata = {
    mode: 'tiered',
    usageUnits: '130.00',
    tierBreakdown: [
      {
        lowerExclusive: '0.00',
        upperInclusive: '50.00',
        billedUnits: '50.00',
        rate: '7.00',
        amount: '350.00',
      },
      {
        lowerExclusive: '50.00',
        upperInclusive: '150.00',
        billedUnits: '80.00',
        rate: '8.00',
        amount: '640.00',
      },
    ],
  };

  // =========================================================================
  // 1. Strict Decimal & Integer Validators
  // =========================================================================
  describe('1. Strict Decimal & Integer Validators', () => {
    it('parseCanonicalWholeUnitForDisplay parses whole unit numbers/strings and rejects fractions/symbols/empty', () => {
      expect(parseCanonicalWholeUnitForDisplay('0')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('0.0')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('0.00')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('10')).toBe(10n);
      expect(parseCanonicalWholeUnitForDisplay('10.0')).toBe(10n);
      expect(parseCanonicalWholeUnitForDisplay('10.00')).toBe(10n);
      expect(parseCanonicalWholeUnitForDisplay('150.00')).toBe(150n);
      expect(parseCanonicalWholeUnitForDisplay(130)).toBe(130n);

      expect(parseCanonicalWholeUnitForDisplay('')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('   ')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('abc')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('10.50')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('5.50')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('-1')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('1e2')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay(Infinity)).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay(NaN)).toBeNull();
    });

    it('isCanonicalPositiveMoneyDisplay validates positive money and rejects negatives/garbage/empty', () => {
      expect(isCanonicalPositiveMoneyDisplay('3.40')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('0.00')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('15.00')).toBe(true);

      expect(isCanonicalPositiveMoneyDisplay('')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('-1.00')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('abc')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('bad')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Strict Metadata Guard & Fail-Closed Behavior
  // =========================================================================
  describe('2. Strict Metadata Guard & Fail-Closed HTML Presentation', () => {
    it('isValidTierMetadata validates correct schema and rejects structurally impossible items', () => {
      expect(isValidTierMetadata(tieredWaterMetadata)).toBe(true);
      expect(isValidTierMetadata(tieredElecMetadata)).toBe(true);

      // Section 13: First lower > 0
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '5.00',
        tierBreakdown: [{ lowerExclusive: '20.00', upperInclusive: null, billedUnits: '5.00', rate: '5.00', amount: '25.00' }],
      })).toBe(false);

      // Section 14: Missing usageUnits
      expect(isValidTierMetadata({
        mode: 'tiered',
        tierBreakdown: [{ lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '17.00' }],
      })).toBe(false);

      // Section 15: Usage sum mismatch (10 + 4 = 14 != 15)
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '15.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '4.00', rate: '4.25', amount: '17.00' },
        ],
      })).toBe(false);

      // Section 16: Underfilled finite tier before advancing
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '15.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '17.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '10.00', rate: '4.25', amount: '42.50' },
        ],
      })).toBe(false);

      // Section 21: Zero billedUnits in row
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '10.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '0.00', rate: '3.40', amount: '0.00' },
        ],
      })).toBe(false);

      // Section 22: Negative tier row amount
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '5.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '-17.00' },
        ],
      })).toBe(false);

      // Section 20: Unbounded 25 units valid
      expect(isValidTierMetadata({
        mode: 'tiered',
        usageUnits: '25.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '10.00', rate: '4.00', amount: '40.00' },
          { lowerExclusive: '20.00', upperInclusive: null, billedUnits: '5.00', rate: '5.00', amount: '25.00' },
        ],
      })).toBe(true);
    });

    it('Section 13: First lower > 0 renders "คิดตามขั้นบันได", authoritative amount, and NO nested rows', () => {
      const receiptRecord = {
        receiptNumber: 'RC-202608-FIRST-LOWER-BAD',
        snapshotData: {
          receiptNumber: 'RC-202608-FIRST-LOWER-BAD',
          total: '25.00',
          items: [
            {
              description: 'ค่าน้ำประปา',
              quantity: '5.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: '25.00',
              metadata: {
                mode: 'tiered',
                usageUnits: '5.00',
                tierBreakdown: [
                  { lowerExclusive: '20.00', upperInclusive: null, billedUnits: '5.00', rate: '5.00', amount: '25.00' },
                ],
              },
            },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ค่าน้ำ');
      expect(html).toContain('คิดตามขั้นบันได');
      expect(html).toContain('25.00');
      expect(html).not.toContain('•'); // No nested breakdown rows
      expect(html).not.toContain('21 หน่วยขึ้นไป');
    });

    it('formatTierRange only produces "<start> หน่วยขึ้นไป" on explicit null', () => {
      expect(formatTierRange('0.00', '10.00')).toBe('1–10 หน่วย');
      expect(formatTierRange('20.00', null)).toBe('21 หน่วยขึ้นไป');
      expect(formatTierRange('20.00', undefined)).toBe('- หน่วย');
      expect(formatTierRange('20.00', '')).toBe('- หน่วย');
      expect(formatTierRange('20.00', 'abc')).toBe('- หน่วย');
    });
  });

  // =========================================================================
  // 3. Single Receipt HTML Presentation & Quantity Formatting
  // =========================================================================
  describe('3. Single Receipt Presentation & Thai Quantity Formatting', () => {
    it('Formats quantities with Thai units (15.00 unit -> "15 หน่วย", 130.00 unit -> "130 หน่วย")', () => {
      expect(formatQuantityHtml('15.00', 'unit')).toBe('15 หน่วย');
      expect(formatQuantityHtml(130, 'unit')).toBe('130 หน่วย');
      expect(formatQuantityHtml('1.00', 'month')).toBe('1 เดือน');
      expect(formatQuantityHtml('1.00', 'room')).toBe('1 ห้อง');
      expect(formatQuantityHtml(1, null)).toBe('1');
      expect(formatQuantityHtml(undefined, null)).toBe('1');

      const receiptRecord = {
        receiptNumber: 'RC-202608-101-0001',
        isVoided: false,
        issuedAt: new Date('2026-08-25T10:00:00Z'),
        snapshotData: {
          receiptNumber: 'RC-202608-101-0001',
          dormitoryName: 'หอพัก HorPlus แกรนด์',
          dormitoryTaxId: '0105551234567',
          dormitoryAddress: '123 ถนนสุขุมวิท กรุงเทพฯ',
          dormitoryPhone: '081-234-5678',
          tenantName: 'นายสมชาย ใจดี',
          roomNumber: '101',
          billNumber: 'INV-202608-101',
          paymentMethod: 'BANK_TRANSFER',
          total: '1055.25',
          billTotal: '1055.25',
          isCombinedReceipt: false,
          items: [
            {
              type: 'rent',
              description: 'ค่าเช่าห้องพัก',
              quantity: '1.00',
              unit: 'month',
              unitPrice: '1000.00',
              amount: '1000.00',
              metadata: null,
            },
            {
              type: 'water',
              description: 'ค่าน้ำประปา (ขั้นบันได)',
              quantity: '15.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: '55.25',
              metadata: tieredWaterMetadata,
            },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);

      expect(html).toContain('RC-202608-101-0001');
      expect(html).toContain('1 เดือน');
      expect(html).toContain('15 หน่วย');
      expect(html).toContain('ค่าน้ำ (ขั้นบันได)');
      expect(html).toContain('คิดตามขั้นบันได');
      expect(html).toContain('1–10 หน่วย: 10 × 3.40 = 34.00 บาท');
      expect(html).toContain('11–20 หน่วย: 5 × 4.25 = 21.25 บาท');
      expect(html).toContain('55.25');
      expect(html).toContain('1055.25');

      // Assert 0.00 is NOT displayed as rate
      expect(html).not.toContain('0.00 บาท/unit');
      expect(html).not.toContain('0.00 บาท/หน่วย');
    });
  });

  // =========================================================================
  // 4. Legacy Single Receipt Fallbacks
  // =========================================================================
  describe('4. Legacy Single Receipt Fallbacks', () => {
    it('missing items fallback renders "ยอดชำระตามใบเสร็จเดิม" and total', () => {
      const receiptRecord = {
        receiptNumber: 'RC-LEGACY-MISSING',
        snapshotData: {
          receiptNumber: 'RC-LEGACY-MISSING',
          dormitoryName: 'หอพัก HorPlus',
          tenantName: 'ผู้เช่าเดิม',
          total: '3500.00',
          // items undefined!
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ยอดชำระตามใบเสร็จเดิม');
      expect(html).toContain('3500.00');
    });

    it('empty items array fallback renders "ยอดชำระตามใบเสร็จเดิม" and total', () => {
      const receiptRecord = {
        receiptNumber: 'RC-LEGACY-EMPTY',
        snapshotData: {
          receiptNumber: 'RC-LEGACY-EMPTY',
          dormitoryName: 'หอพัก HorPlus',
          tenantName: 'ผู้เช่าเดิม',
          total: '4200.00',
          items: [], // empty array!
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ยอดชำระตามใบเสร็จเดิม');
      expect(html).toContain('4200.00');
    });
  });

  // =========================================================================
  // 5. Combined Receipt HTML Presentation
  // =========================================================================
  describe('5. Combined Receipt HTML Presentation', () => {
    it('Combined receipt HTML renders immutable billGroups, gross items, tier breakdown, and allocated amount', () => {
      const receiptRecord = {
        receiptNumber: 'RC-202608-201-0002',
        isVoided: false,
        issuedAt: new Date('2026-08-25T11:00:00Z'),
        snapshotData: {
          receiptNumber: 'RC-202608-201-0002',
          dormitoryName: 'หอพัก HorPlus แกรนด์',
          tenantName: 'นางสาวสุภา มีสุข',
          roomNumber: '201',
          paymentMethod: 'BANK_TRANSFER',
          total: '6500.00',
          isCombinedReceipt: true,
          billGroups: [
            {
              billId: 'bill-A',
              billNumber: 'INV-202608-A',
              cycleCode: '2026-08',
              billTotal: '4000.00',
              allocatedAmount: '4000.00',
              items: [
                {
                  type: 'rent',
                  description: 'ค่าเช่าห้องพัก',
                  quantity: '1.00',
                  unit: 'month',
                  unitPrice: '4000.00',
                  amount: '4000.00',
                  metadata: null,
                },
              ],
            },
            {
              billId: 'bill-B',
              billNumber: 'INV-202608-B',
              cycleCode: '2026-08',
              billTotal: '5000.00',
              allocatedAmount: '2500.00',
              items: [
                {
                  type: 'rent',
                  description: 'ค่าเช่าห้องพัก',
                  quantity: '1.00',
                  unit: 'month',
                  unitPrice: '3954.75',
                  amount: '3954.75',
                  metadata: null,
                },
                {
                  type: 'water',
                  description: 'ค่าน้ำประปา (ขั้นบันได)',
                  quantity: '15.00',
                  unit: 'unit',
                  unitPrice: '0.00',
                  amount: '55.25',
                  metadata: tieredWaterMetadata,
                },
                {
                  type: 'electricity',
                  description: 'ค่าไฟฟ้า (ขั้นบันได)',
                  quantity: '130.00',
                  unit: 'unit',
                  unitPrice: '0.00',
                  amount: '990.00',
                  metadata: tieredElecMetadata,
                },
              ],
            },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);

      expect(html).toContain('INV-202608-A');
      expect(html).toContain('INV-202608-B');
      expect(html).toContain('15 หน่วย');
      expect(html).toContain('130 หน่วย');
      expect(html).toContain('ยอดบิล:</td>\n                <td class="num" style="font-weight: bold;">5000.00 ฿');
      expect(html).toContain('ยอดรับชำระสำหรับรอบบิลนี้:</td>\n                <td class="num" style="color: #4338ca; font-weight: 900;">2500.00 ฿');
      expect(html).toContain('รวมรับสุทธิ:</span><span>6500.00 ฿');

      // Both Tier breakdowns rendered
      expect(html).toContain('1–10 หน่วย: 10 × 3.40 = 34.00 บาท');
      expect(html).toContain('1–50 หน่วย: 50 × 7.00 = 350.00 บาท');
      expect(html).toContain('51–150 หน่วย: 80 × 8.00 = 640.00 บาท');
    });
  });

  // =========================================================================
  // 6. Zero-Line Filtering Policy
  // =========================================================================
  describe('6. Zero-Line Filtering Policy', () => {
    it('HTML renderer filters out 0.00 items while showing non-zero items (positive, negative, and 0.01)', () => {
      const receiptRecord = {
        receiptNumber: 'RC-202608-ZERO',
        snapshotData: {
          receiptNumber: 'RC-202608-ZERO',
          total: '3500.01',
          items: [
            { description: 'ค่าเช่าห้องพัก', amount: '4000.00' },
            { description: 'ค่าส่วนกลางฟรี (ซ่อน)', amount: '0.00' },
            { description: 'ส่วนลดโปรโมชั่น', amount: '-500.00' },
            { description: 'เศษสตางค์', amount: '0.01' },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ค่าเช่าห้องพัก');
      expect(html).toContain('ส่วนลดโปรโมชั่น');
      expect(html).toContain('เศษสตางค์');
      expect(html).not.toContain('ค่าส่วนกลางฟรี (ซ่อน)');
    });
  });

  // =========================================================================
  // 7. HTML Escaping Safety
  // =========================================================================
  describe('7. HTML Escaping Safety', () => {
    it('escapes dangerous HTML characters', () => {
      expect(escapeHTML('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
      expect(escapeHTML('Tom & Jerry')).toBe('Tom &amp; Jerry');
      expect(escapeHTML("John's")).toBe('John&#039;s');
    });
  });
});
