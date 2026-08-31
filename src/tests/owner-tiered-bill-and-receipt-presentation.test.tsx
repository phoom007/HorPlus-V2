/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.2: Frontend Tiered Bill & Receipt Presentation Test Suite
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  isValidTieredBillItemMetadata,
  formatTierRange,
  formatTierUsage,
  formatTierRateLabel,
  isCanonicalWholeUnitDisplay,
  isCanonicalMoneyDisplay,
  isCanonicalPositiveMoneyDisplay,
} from '../utils/billPresentation';
import { TierBreakdownView } from '../components/bills/TierBreakdownView';
import { filterNonZeroBillItems, isNonZeroAmount, formatBillingQuantity } from '../types';
import { formatBaht } from '../components/GlobalComponents';
import { buildViewingReceipt } from '../pages/owner/payments';

describe('OWNER R3.9-E.1B.2.2 — Strict Tiered Bill & Receipt Presentation Suite', () => {
  afterEach(() => {
    cleanup();
  });

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

  const tieredElectricityMetadata = {
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
  // 1. Strict Decimal & Integer Validator Helpers (Section 2, 6, 8, 15)
  // =========================================================================
  describe('1. Strict Decimal & Integer Validators', () => {
    it('isCanonicalWholeUnitDisplay validates whole unit numbers/strings and rejects fractions/symbols/empty', () => {
      expect(isCanonicalWholeUnitDisplay('0')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('0.0')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('0.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('10')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('10.0')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('10.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay('150.00')).toBe(true);
      expect(isCanonicalWholeUnitDisplay(130)).toBe(true);
      expect(isCanonicalWholeUnitDisplay(0)).toBe(true);

      // Invalids
      expect(isCanonicalWholeUnitDisplay('')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('   ')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('abc')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('10.50')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('5.50')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('-1')).toBe(false);
      expect(isCanonicalWholeUnitDisplay('1e2')).toBe(false);
      expect(isCanonicalWholeUnitDisplay(Infinity)).toBe(false);
      expect(isCanonicalWholeUnitDisplay(NaN)).toBe(false);
      expect(isCanonicalWholeUnitDisplay(null)).toBe(false);
      expect(isCanonicalWholeUnitDisplay(undefined)).toBe(false);
    });

    it('isCanonicalPositiveMoneyDisplay validates positive money and rejects negatives/garbage/empty', () => {
      expect(isCanonicalPositiveMoneyDisplay('3.40')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('0.00')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('15.00')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('1000.5')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay(3.4)).toBe(true);

      // Invalids
      expect(isCanonicalPositiveMoneyDisplay('')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('-1.00')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('abc')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('bad')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('1e2')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay(null)).toBe(false);
    });
  });

  // =========================================================================
  // 2. Strict Unbounded Contract & Sequence Safety (Section 2, 3, 4, 7, 8, 9, 10, 11, 12, 13)
  // =========================================================================
  describe('2. Strict Unbounded Contract & Sequence Safety', () => {
    it('Section 9: missing upperInclusive property is REJECTED without rendering fabricated "21 หน่วยขึ้นไป"', () => {
      const missingUpperMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          {
            lowerExclusive: '20.00',
            billedUnits: '5.00',
            rate: '5.00',
            amount: '25.00',
            // upperInclusive is MISSING!
          },
        ],
      };

      expect(isValidTieredBillItemMetadata(missingUpperMetadata)).toBe(false);

      const { container } = render(<TierBreakdownView metadata={missingUpperMetadata} unit="unit" />);
      expect(container.firstChild).toBeNull();
      expect(container.textContent).not.toContain('21 หน่วยขึ้นไป');
      expect(container.textContent).not.toContain('NaN');

      // Parent rate label returns fallback
      expect(formatTierRateLabel('0.00', 'unit', missingUpperMetadata)).toBe('คิดตามขั้นบันได');
    });

    it('Section 10: empty string upperInclusive ("") is REJECTED and does NOT mean infinity', () => {
      const emptyUpperMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          {
            lowerExclusive: '20.00',
            upperInclusive: '',
            billedUnits: '5.00',
            rate: '5.00',
            amount: '25.00',
          },
        ],
      };

      expect(isValidTieredBillItemMetadata(emptyUpperMetadata)).toBe(false);

      const { container } = render(<TierBreakdownView metadata={emptyUpperMetadata} unit="unit" />);
      expect(container.firstChild).toBeNull();
      expect(container.textContent).not.toContain('21 หน่วยขึ้นไป');
    });

    it('Section 11: explicit upperInclusive === null is VALID for unbounded final tier ("21 หน่วยขึ้นไป")', () => {
      const explicitNullMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          {
            lowerExclusive: '0.00',
            upperInclusive: '20.00',
            billedUnits: '20.00',
            rate: '3.50',
            amount: '70.00',
          },
          {
            lowerExclusive: '20.00',
            upperInclusive: null, // EXPLICIT NULL
            billedUnits: '5.00',
            rate: '5.00',
            amount: '25.00',
          },
        ],
      };

      expect(isValidTieredBillItemMetadata(explicitNullMetadata)).toBe(true);

      render(<TierBreakdownView metadata={explicitNullMetadata} unit="unit" />);
      expect(screen.getByText('• 1–20 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('• 21 หน่วยขึ้นไป')).toBeInTheDocument();
      expect(screen.getByText('5 × 5.00 = 25.00 บาท')).toBeInTheDocument();
    });

    it('Section 12: unbounded row followed by another row is REJECTED', () => {
      const unboundedNotLastMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          {
            lowerExclusive: '0.00',
            upperInclusive: null, // UNBOUNDED ROW NOT LAST!
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

      expect(isValidTieredBillItemMetadata(unboundedNotLastMetadata)).toBe(false);

      const { container } = render(<TierBreakdownView metadata={unboundedNotLastMetadata} unit="unit" />);
      expect(container.firstChild).toBeNull();
    });

    it('Section 13: rejects gap in sequence (0->10 then 15->20)', () => {
      const gapMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '15.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
        ],
      };

      expect(isValidTieredBillItemMetadata(gapMetadata)).toBe(false);
    });

    it('Section 13: rejects overlap in sequence (0->10 then 5->20)', () => {
      const overlapMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '5.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
        ],
      };

      expect(isValidTieredBillItemMetadata(overlapMetadata)).toBe(false);
    });

    it('Section 13: contiguous sequence is VALID (0->10, 10->20, 20->null)', () => {
      const contiguousMetadata = {
        mode: 'tiered',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '10.00', rate: '4.00', amount: '40.00' },
          { lowerExclusive: '20.00', upperInclusive: null, billedUnits: '5.00', rate: '5.00', amount: '25.00' },
        ],
      };

      expect(isValidTieredBillItemMetadata(contiguousMetadata)).toBe(true);
    });

    it('Section 6: formatTierRange only produces "<start> หน่วยขึ้นไป" when upperInclusive === null', () => {
      expect(formatTierRange('0.00', '10.00')).toBe('1–10 หน่วย');
      expect(formatTierRange('10.00', '20.00')).toBe('11–20 หน่วย');
      expect(formatTierRange('20.00', null)).toBe('21 หน่วยขึ้นไป');

      // Fail-closed for undefined / empty / invalid
      expect(formatTierRange('20.00', undefined)).toBe('- หน่วย');
      expect(formatTierRange('20.00', '')).toBe('- หน่วย');
      expect(formatTierRange('20.00', '   ')).toBe('- หน่วย');
      expect(formatTierRange('20.00', 'abc')).toBe('- หน่วย');
      expect(formatTierRange('20.00', '10.00')).toBe('- หน่วย'); // inverted
    });

    it('formatTierUsage formats integer units without floating-point fraction', () => {
      expect(formatTierUsage('15.00')).toBe('15 หน่วย');
      expect(formatTierUsage(130)).toBe('130 หน่วย');
      expect(formatTierUsage('10.00')).toBe('10 หน่วย');
      expect(formatTierUsage('5.00')).toBe('5 หน่วย');
      expect(formatTierUsage('bad')).toBe('- หน่วย');
    });

    it('formatTierRateLabel shows "คิดตามขั้นบันได" and never "0.00 บาท/หน่วย" for tiered items', () => {
      expect(formatTierRateLabel('0.00', 'unit', tieredWaterMetadata)).toBe('คิดตามขั้นบันได');
      expect(formatTierRateLabel(0, 'unit', { mode: 'tiered', tierBreakdown: 'malformed' })).toBe('คิดตามขั้นบันได');

      // Scalar item formats normally
      expect(formatTierRateLabel('18.00', 'unit', null)).toBe('18.00 บาท/หน่วย');
      expect(formatTierRateLabel('200.00', 'room', null)).toBe('200.00 บาท/ห้อง');

      // Fail-closed for legacy 0-rate item without metadata -> "-"
      expect(formatTierRateLabel('0.00', 'unit', null)).toBe('-');
      expect(formatTierRateLabel(0, 'unit', null)).toBe('-');
    });
  });

  // =========================================================================
  // 3. Real Production buildViewingReceipt Integration Proof
  // =========================================================================
  describe('3. Production buildViewingReceipt Integration Proof', () => {
    it('Single snapshot-first integration — snapshot tier rates win over conflicting live bill rates', () => {
      const paymentFixture = {
        id: 'pay-1',
        dormitoryId: 'dorm-100',
        billId: 'bill-101',
        amount: '1055.25',
        bill: {
          id: 'bill-101',
          billNumber: 'INV-202608-101',
          totalAmount: '1055.25',
          items: [
            {
              id: 'item-water-live',
              description: 'ค่าน้ำประปา (live)',
              quantity: '15.00',
              unit: 'unit',
              unitPrice: '99.00', // CONFLICTING LIVE RATE
              amount: '1485.00',
              metadata: {
                mode: 'tiered',
                usageUnits: '15.00',
                tierBreakdown: [
                  { lowerExclusive: '0.00', upperInclusive: '15.00', billedUnits: '15.00', rate: '99.00', amount: '1485.00' },
                ],
              },
            },
          ],
        },
        receipt: {
          id: 'rcpt-1',
          receiptNumber: 'RC-202608-101-0001',
          totalAmount: '1055.25',
          snapshotData: {
            receiptNumber: 'RC-202608-101-0001',
            billNumber: 'INV-202608-101',
            total: '1055.25',
            billTotal: '1055.25',
            isCombinedReceipt: false,
            items: [
              {
                description: 'ค่าเช่าห้องพัก',
                quantity: '1.00',
                unit: 'month',
                unitPrice: '1000.00',
                amount: '1000.00',
                metadata: null,
              },
              {
                description: 'ค่าน้ำประปา',
                quantity: '15.00',
                unit: 'unit',
                unitPrice: '0.00',
                amount: '55.25',
                metadata: tieredWaterMetadata, // AUTHORITATIVE SNAPSHOT RATES (3.40 / 4.25)
              },
            ],
          },
        },
      } as any;

      const viewingReceipt = buildViewingReceipt(paymentFixture, [paymentFixture.bill]);

      expect(viewingReceipt).not.toBeNull();
      expect(viewingReceipt.receiptNumber).toBe('RC-202608-101-0001');
      expect(viewingReceipt.isMultiBill).toBe(false);
      expect(viewingReceipt.items).toHaveLength(2);

      const waterItem = viewingReceipt.items.find((i: any) => i.description === 'ค่าน้ำประปา');
      expect(waterItem).toBeDefined();
      expect(waterItem.amount).toBe(55.25);
      expect(waterItem.metadata).toEqual(tieredWaterMetadata);

      // Render actual item and verify snapshot rates win
      const { container } = render(
        <div>
          <div>{waterItem.description}</div>
          <TierBreakdownView metadata={waterItem.metadata} unit={waterItem.unit} />
        </div>
      );

      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('5 × 4.25 = 21.25 บาท')).toBeInTheDocument();
      expect(container.textContent).not.toContain('99.00');
    });

    it('Combined snapshot-first integration — snapshot billGroups win over live bills', () => {
      const paymentGroupFixture = {
        id: 'pay-grp-1',
        dormitoryId: 'dorm-100',
        billId: 'bill-A',
        amount: '6500.00',
        paymentGroupId: 'pg-1',
        paymentGroup: {
          id: 'pg-1',
          status: 'CONFIRMED',
          totalAmount: '6500.00',
          receipts: [
            {
              id: 'rcpt-grp-1',
              receiptNumber: 'RC-202608-GRP-0001',
              totalAmount: '6500.00',
              snapshotData: {
                receiptNumber: 'RC-202608-GRP-0001',
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
                      { description: 'ค่าเช่าห้องพัก', quantity: '1.00', unitPrice: '4000.00', amount: '4000.00' },
                    ],
                  },
                  {
                    billId: 'bill-B',
                    billNumber: 'INV-202608-B',
                    cycleCode: '2026-08',
                    billTotal: '5000.00',
                    allocatedAmount: '2500.00',
                    items: [
                      { description: 'ค่าเช่าห้องพัก', quantity: '1.00', unitPrice: '3954.75', amount: '3954.75' },
                      { description: 'ค่าน้ำประปา', quantity: '15.00', unit: 'unit', unitPrice: '0.00', amount: '55.25', metadata: tieredWaterMetadata },
                      { description: 'ค่าไฟฟ้า', quantity: '130.00', unit: 'unit', unitPrice: '0.00', amount: '990.00', metadata: tieredElectricityMetadata },
                    ],
                  },
                ],
              },
            },
          ],
        },
      } as any;

      // Conflicting live bills
      const liveBills = [
        { id: 'bill-A', billNumber: 'INV-202608-A', totalAmount: '9999.00', items: [] },
        { id: 'bill-B', billNumber: 'INV-202608-B', totalAmount: '9999.00', items: [] },
      ] as any;

      const viewingReceipt = buildViewingReceipt(paymentGroupFixture, liveBills);

      expect(viewingReceipt).not.toBeNull();
      expect(viewingReceipt.isMultiBill).toBe(true);
      expect(viewingReceipt.billGroups).toHaveLength(2);

      const groupB = viewingReceipt.billGroups.find((g: any) => g.billId === 'bill-B');
      expect(groupB).toBeDefined();
      expect(groupB.billTotal).toBe(5000.00);
      expect(groupB.allocatedAmount).toBe(2500.00);
      expect(groupB.items).toHaveLength(3);

      const waterItem = groupB.items.find((i: any) => i.description === 'ค่าน้ำประปา');
      expect(waterItem.amount).toBe(55.25);
      expect(waterItem.metadata).toEqual(tieredWaterMetadata);

      const elecItem = groupB.items.find((i: any) => i.description === 'ค่าไฟฟ้า');
      expect(elecItem.amount).toBe(990.00);
      expect(elecItem.metadata).toEqual(tieredElectricityMetadata);
    });

    it('Legacy single receipt with missing/empty items falls back safely', () => {
      const legacyPayment = {
        id: 'pay-legacy',
        dormitoryId: 'dorm-100',
        billId: 'bill-old',
        amount: '3500.00',
        receipt: {
          id: 'rcpt-legacy',
          receiptNumber: 'RC-OLD-001',
          totalAmount: '3500.00',
          snapshotData: {
            receiptNumber: 'RC-OLD-001',
            total: '3500.00',
            // items is missing!
          },
        },
      } as any;

      const viewingReceipt = buildViewingReceipt(legacyPayment, []);
      expect(viewingReceipt.items).toEqual([
        { description: 'ยอดชำระตามใบเสร็จเดิม', amount: 3500.00 },
      ]);
    });
  });

  // =========================================================================
  // 4. Bill Detail Presentation Integration
  // =========================================================================
  describe('4. Bill Detail Table Presentation', () => {
    it('Bill Detail renders Water Tier row with "คิดตามขั้นบันได", nested breakdown, and NO "0.00 บาท/หน่วย"', () => {
      const billItem = {
        id: 'item-water-1',
        type: 'water',
        description: 'ค่าน้ำประปา',
        quantity: '15.00',
        unit: 'unit',
        unitPrice: '0.00',
        amount: '55.25',
        metadata: tieredWaterMetadata,
      };

      const { container } = render(
        <table>
          <tbody>
            <tr>
              <td>
                <div>{billItem.description}</div>
                <TierBreakdownView metadata={billItem.metadata} unit={billItem.unit} />
              </td>
              <td>{formatBillingQuantity(billItem.quantity, billItem.unit)}</td>
              <td>{formatTierRateLabel(billItem.unitPrice, billItem.unit, billItem.metadata)}</td>
              <td>{formatBaht(Number(billItem.amount))}</td>
            </tr>
          </tbody>
        </table>
      );

      expect(screen.getByText('ค่าน้ำประปา')).toBeInTheDocument();
      expect(screen.getByText('15 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('คิดตามขั้นบันได')).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(55.25));

      // Nested breakdown rows
      expect(screen.getByText('• 1–10 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('• 11–20 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('5 × 4.25 = 21.25 บาท')).toBeInTheDocument();

      // Never display 0.00 tariff
      expect(container.textContent).not.toContain('0.00 บาท/หน่วย');
      expect(container.textContent).not.toContain('15 × 0.00');
    });

    it('Bill Detail renders Electricity Tier row correctly', () => {
      const billItem = {
        id: 'item-elec-1',
        type: 'electricity',
        description: 'ค่าไฟฟ้า',
        quantity: '130.00',
        unit: 'unit',
        unitPrice: '0.00',
        amount: '990.00',
        metadata: tieredElectricityMetadata,
      };

      const { container } = render(
        <table>
          <tbody>
            <tr>
              <td>
                <div>{billItem.description}</div>
                <TierBreakdownView metadata={billItem.metadata} unit={billItem.unit} />
              </td>
              <td>{formatBillingQuantity(billItem.quantity, billItem.unit)}</td>
              <td>{formatTierRateLabel(billItem.unitPrice, billItem.unit, billItem.metadata)}</td>
              <td>{formatBaht(Number(billItem.amount))}</td>
            </tr>
          </tbody>
        </table>
      );

      expect(screen.getByText('ค่าไฟฟ้า')).toBeInTheDocument();
      expect(screen.getByText('130 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('คิดตามขั้นบันได')).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(990.00));

      expect(screen.getByText('• 1–50 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('50 × 7.00 = 350.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('• 51–150 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('80 × 8.00 = 640.00 บาท')).toBeInTheDocument();

      expect(container.textContent).not.toContain('0.00 บาท/หน่วย');
    });
  });

  // =========================================================================
  // 5. Zero-Line Suppression Policy
  // =========================================================================
  describe('5. Zero-Line Suppression Policy', () => {
    it('isNonZeroAmount and filterNonZeroBillItems hide 0.00 lines while preserving negative and positive amounts', () => {
      const items = [
        { description: 'ค่าเช่าห้องพัก', amount: '4000.00' },
        { description: 'ค่าส่วนกลางฟรี', amount: '0.00' },
        { description: 'ค่าส่วนกลางฟรี 0', amount: 0 },
        { description: 'ส่วนลดโปรโมชั่น', amount: '-500.00' },
        { description: 'เศษสตางค์', amount: '0.01' },
      ];

      expect(isNonZeroAmount('0.00')).toBe(false);
      expect(isNonZeroAmount(0)).toBe(false);
      expect(isNonZeroAmount('4000.00')).toBe(true);
      expect(isNonZeroAmount('-500.00')).toBe(true);
      expect(isNonZeroAmount('0.01')).toBe(true);

      const filtered = filterNonZeroBillItems(items);
      expect(filtered).toHaveLength(3);
      expect(filtered.map(i => i.description)).toEqual([
        'ค่าเช่าห้องพัก',
        'ส่วนลดโปรโมชั่น',
        'เศษสตางค์',
      ]);
    });
  });
});
