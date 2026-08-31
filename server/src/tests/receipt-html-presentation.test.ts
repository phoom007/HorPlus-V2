/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.1: Backend Receipt HTML Presentation Test Suite
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHTML,
  isNonZeroAmount,
  isCanonicalWholeUnitDisplay,
  isCanonicalMoneyDisplay,
  isCanonicalPositiveMoneyDisplay,
  isValidTierMetadata,
  formatTierRange,
  formatQuantityHtml,
  formatRateHtml,
  renderTierBreakdownHtml,
  renderReceiptHtml,
} from '../utils/receipt-html.util.js';

describe('OWNER R3.9-E.1B.2.1 — Backend Receipt HTML Presentation Authority', () => {
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
    it('isCanonicalWholeUnitDisplay validates whole unit numbers/strings and rejects fractions/symbols', () => {
      expect(isCanonicalWholeUnitDisplay('0')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('0.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('10')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('10.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('150.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay(130)).toBe(true);

      expect(isCanonicalWholeUnitDisplay('abc')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('10.50')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('5.50')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('-1')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('1e2')).toBe(false);
      expect(isCanonicalWholeUnitDisplay(Infinity)).toBe(false);
      expect(isCanonicalWholeUnitDisplay(NaN)).toBe(false);
    });

    it('isCanonicalPositiveMoneyDisplay validates positive money and rejects negatives/garbage', () => {
      expect(isCanonicalPositiveMoneyDisplay('3.40')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('0.00')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('15.00')).toBe(true);

      expect(isCanonicalPositiveMoneyDisplay('-1.00')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('abc')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('bad')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Strict Metadata Guard & Fail-Closed Behavior (Section 9, 10, 22 A & B)
  // =========================================================================
  describe('2. Strict Metadata Guard & Fail-Closed HTML Presentation', () => {
    it('isValidTierMetadata validates correct schema and rejects corrupt/fractional items', () => {
      expect(isValidTierMetadata(tieredWaterMetadata)).toBe(true);
      expect(isValidTierMetadata(tieredElecMetadata)).toBe(true);

      // Corrupt numeric strings
      expect(isValidTierMetadata({
        mode: 'tiered',
        tierBreakdown: [{ lowerExclusive: 'abc', upperInclusive: 'xyz', billedUnits: 'oops', rate: 'bad', amount: 'wrong' }],
      })).toBe(false);

      // Fractional range
      expect(isValidTierMetadata({
        mode: 'tiered',
        tierBreakdown: [{ lowerExclusive: '0.00', upperInclusive: '10.50', billedUnits: '10.00', rate: '3.40', amount: '34.00' }],
      })).toBe(false);

      // Inverted range
      expect(isValidTierMetadata({
        mode: 'tiered',
        tierBreakdown: [{ lowerExclusive: '10.00', upperInclusive: '5.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' }],
      })).toBe(false);
    });

    it('Section 10 & 22A: Malformed metadata renders "คิดตามขั้นบันได", authoritative amount, and NO NaN or nested rows', () => {
      const receiptRecord = {
        receiptNumber: 'RC-202608-MALFORMED',
        snapshotData: {
          receiptNumber: 'RC-202608-MALFORMED',
          total: '55.25',
          items: [
            {
              description: 'ค่าน้ำประปา',
              quantity: '15.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: '55.25',
              metadata: {
                mode: 'tiered',
                tierBreakdown: [
                  { lowerExclusive: 'abc', upperInclusive: 'xyz', billedUnits: 'oops', rate: 'bad', amount: 'wrong' },
                ],
              },
            },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ค่าน้ำประปา');
      expect(html).toContain('คิดตามขั้นบันได');
      expect(html).toContain('55.25');
      expect(html).not.toContain('•'); // No nested breakdown rows
      expect(html).not.toContain('NaN');
      expect(html).not.toContain('Infinity');
      expect(html).not.toContain('1 หน่วยขึ้นไป');
    });

    it('Section 22B: Fractional range metadata fails closed without nested rows or fabrication', () => {
      const receiptRecord = {
        receiptNumber: 'RC-202608-FRACTIONAL',
        snapshotData: {
          receiptNumber: 'RC-202608-FRACTIONAL',
          total: '34.00',
          items: [
            {
              description: 'ค่าน้ำประปา',
              quantity: '10.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: '34.00',
              metadata: {
                mode: 'tiered',
                tierBreakdown: [
                  { lowerExclusive: '0.00', upperInclusive: '10.50', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
                ],
              },
            },
          ],
        },
      };

      const html = renderReceiptHtml(receiptRecord);
      expect(html).toContain('ค่าน้ำประปา');
      expect(html).toContain('คิดตามขั้นบันได');
      expect(html).toContain('34.00');
      expect(html).not.toContain('•');
      expect(html).not.toContain('1–10');
    });
  });

  // =========================================================================
  // 3. Single Receipt HTML Presentation & Quantity Formatting (Section 14 & 22E)
  // =========================================================================
  describe('3. Single Receipt Presentation & Thai Quantity Formatting', () => {
    it('Section 14 & 22E: Formats quantities with Thai units (15.00 unit -> "15 หน่วย", 130.00 unit -> "130 หน่วย")', () => {
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
      expect(html).toContain('ค่าน้ำประปา (ขั้นบันได)');
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
  // 4. Legacy Single Receipt Fallbacks (Section 11, 12, 22 C & D)
  // =========================================================================
  describe('4. Legacy Single Receipt Fallbacks', () => {
    it('Section 11 & 22C: missing items fallback renders "ยอดชำระตามใบเสร็จเดิม" and total', () => {
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

    it('Section 12 & 22D: empty items array fallback renders "ยอดชำระตามใบเสร็จเดิม" and total', () => {
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
  // 5. Combined Receipt HTML Presentation (Section 22F)
  // =========================================================================
  describe('5. Combined Receipt HTML Presentation', () => {
    it('Section 22F: Combined receipt HTML renders immutable billGroups, gross items, tier breakdown, and allocated amount', () => {
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
  // 6. Zero-Line Filtering Policy (Section 22G & 35)
  // =========================================================================
  describe('6. Zero-Line Filtering Policy', () => {
    it('Section 22G: HTML renderer filters out 0.00 items while showing non-zero items (positive, negative, and 0.01)', () => {
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
