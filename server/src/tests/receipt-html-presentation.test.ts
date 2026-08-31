/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2: Backend Receipt HTML Presentation Test Suite
 */

import { describe, it, expect } from 'vitest';
import {
  escapeHTML,
  isNonZeroAmount,
  isValidTierMetadata,
  formatTierRange,
  formatRateHtml,
  renderTierBreakdownHtml,
  renderReceiptHtml,
} from '../utils/receipt-html.util.js';

describe('OWNER R3.9-E.1B.2 — Backend Receipt HTML Presentation Authority', () => {
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
  // 1. Single Receipt HTML Presentation (Section 33)
  // =========================================================================
  it('Section 33: Single receipt HTML renders "คิดตามขั้นบันได" and nested tier rows without 0.00 rate misrepresentation', () => {
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
            unit: 'เดือน',
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

  // =========================================================================
  // 2. Combined Receipt HTML Presentation (Section 34)
  // =========================================================================
  it('Section 34: Combined receipt HTML renders immutable billGroups, gross items, tier breakdown, and allocated amount', () => {
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
    expect(html).toContain('ยอดบิล:</td>\n                <td class="num" style="font-weight: bold;">5000.00 ฿');
    expect(html).toContain('ยอดรับชำระสำหรับรอบบิลนี้:</td>\n                <td class="num" style="color: #4338ca; font-weight: 900;">2500.00 ฿');
    expect(html).toContain('รวมรับสุทธิ:</span><span>6500.00 ฿');

    // Both Tier breakdowns rendered
    expect(html).toContain('1–10 หน่วย: 10 × 3.40 = 34.00 บาท');
    expect(html).toContain('1–50 หน่วย: 50 × 7.00 = 350.00 บาท');
    expect(html).toContain('51–150 หน่วย: 80 × 8.00 = 640.00 บาท');
  });

  // =========================================================================
  // 3. Zero-Line Filtering in HTML (Section 35)
  // =========================================================================
  it('Section 35: HTML renderer filters out 0.00 items while showing non-zero items', () => {
    const receiptRecord = {
      receiptNumber: 'RC-202608-ZERO',
      snapshotData: {
        receiptNumber: 'RC-202608-ZERO',
        total: '4000.00',
        items: [
          { description: 'ค่าเช่าห้องพัก', amount: '4000.00' },
          { description: 'ค่าส่วนกลางฟรี (ซ่อน)', amount: '0.00' },
          { description: 'ส่วนลดโปรโมชั่น', amount: '-500.00' },
        ],
      },
    };

    const html = renderReceiptHtml(receiptRecord);
    expect(html).toContain('ค่าเช่าห้องพัก');
    expect(html).toContain('ส่วนลดโปรโมชั่น');
    expect(html).not.toContain('ค่าส่วนกลางฟรี (ซ่อน)');
  });

  // =========================================================================
  // 4. Malformed Metadata Fail-Closed (Section 22 & 26)
  // =========================================================================
  it('Section 22 & 26: Malformed metadata fails closed to "คิดตามขั้นบันได" without nested rows or crash', () => {
    const receiptRecord = {
      receiptNumber: 'RC-202608-MALFORMED',
      snapshotData: {
        receiptNumber: 'RC-202608-MALFORMED',
        total: '55.25',
        items: [
          {
            description: 'ค่าน้ำประปา',
            quantity: '15.00',
            unitPrice: '0.00',
            amount: '55.25',
            metadata: { mode: 'tiered', tierBreakdown: 'invalid-string' },
          },
        ],
      },
    };

    const html = renderReceiptHtml(receiptRecord);
    expect(html).toContain('ค่าน้ำประปา');
    expect(html).toContain('คิดตามขั้นบันได');
    expect(html).toContain('55.25');
    expect(html).not.toContain('•'); // No nested breakdown rows
    expect(html).not.toContain('0.00 บาท');
  });

  // =========================================================================
  // 5. HTML Escaping Safety (Section 20)
  // =========================================================================
  it('Section 20: HTML escaping helper escapes dangerous HTML characters', () => {
    expect(escapeHTML('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(escapeHTML('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHTML("John's")).toBe('John&#039;s');
  });
});
