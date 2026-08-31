// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2.3: Frontend Tiered Bill & Receipt Presentation Test Suite
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
  parseCanonicalWholeUnitForDisplay,
} from '../utils/billPresentation';
import { TierBreakdownView } from '../components/bills/TierBreakdownView';
import { filterNonZeroBillItems, isNonZeroAmount, formatBillingQuantity } from '../types';
import { formatBaht } from '../components/GlobalComponents';
import { buildViewingReceipt } from '../pages/owner/payments';

describe('OWNER R3.9-E.1B.2.3 — Canonical Structural Integrity & Presentation Suite', () => {
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
  // 1. Strict Decimal & Integer Validator Helpers
  // =========================================================================
  describe('1. Strict Decimal & Integer Validators', () => {
    it('parseCanonicalWholeUnitForDisplay parses whole units into BigInt and rejects fractions/symbols/empty', () => {
      expect(parseCanonicalWholeUnitForDisplay('0')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('0.0')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('0.00')).toBe(0n);
      expect(parseCanonicalWholeUnitForDisplay('10')).toBe(10n);
      expect(parseCanonicalWholeUnitForDisplay('10.00')).toBe(10n);
      expect(parseCanonicalWholeUnitForDisplay(130)).toBe(130n);

      expect(parseCanonicalWholeUnitForDisplay('')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('10.50')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('-1')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay('abc')).toBeNull();
      expect(parseCanonicalWholeUnitForDisplay(null)).toBeNull();
    });

    it('isCanonicalPositiveMoneyDisplay validates positive money and rejects negatives/garbage/empty', () => {
      expect(isCanonicalPositiveMoneyDisplay('3.40')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('0.00')).toBe(true);
      expect(isCanonicalPositiveMoneyDisplay('15.00')).toBe(true);

      expect(isCanonicalPositiveMoneyDisplay('')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('-1.00')).toBe(false);
      expect(isCanonicalPositiveMoneyDisplay('abc')).toBe(false);
    });
  });

  // =========================================================================
  // 2. Canonical Breakdown Structural Integrity & Usage Reconciliation
  // =========================================================================
  describe('2. Canonical Breakdown Structural Integrity', () => {
    it('Section 13: first lower bound > 0 is REJECTED without rendering fabricated range', () => {
      const nonZeroFirstLowerMetadata = {
        mode: 'tiered',
        usageUnits: '5.00',
        tierBreakdown: [
          {
            lowerExclusive: '20.00', // FIRST LOWER > 0 (INVALID!)
            upperInclusive: null,
            billedUnits: '5.00',
            rate: '5.00',
            amount: '25.00',
          },
        ],
      };

      expect(isValidTieredBillItemMetadata(nonZeroFirstLowerMetadata)).toBe(false);

      const { container } = render(<TierBreakdownView metadata={nonZeroFirstLowerMetadata} unit="unit" />);
      expect(container.firstChild).toBeNull();
      expect(container.textContent).not.toContain('21 หน่วยขึ้นไป');
    });

    it('Section 14: missing usageUnits property is REJECTED', () => {
      const missingUsageUnitsMetadata = {
        mode: 'tiered',
        // usageUnits is MISSING!
        tierBreakdown: [
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '5.00',
            rate: '3.40',
            amount: '17.00',
          },
        ],
      };

      expect(isValidTieredBillItemMetadata(missingUsageUnitsMetadata)).toBe(false);
    });

    it('Section 15: usage sum mismatch (SUM(billedUnits) != usageUnits) is REJECTED', () => {
      const sumMismatchMetadata = {
        mode: 'tiered',
        usageUnits: '15.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '4.00', rate: '4.25', amount: '17.00' }, // 10 + 4 = 14 != 15
        ],
      };

      expect(isValidTieredBillItemMetadata(sumMismatchMetadata)).toBe(false);

      const { container } = render(<TierBreakdownView metadata={sumMismatchMetadata} unit="unit" />);
      expect(container.firstChild).toBeNull();
    });

    it('Section 16: underfilled finite tier before advancing to next tier is REJECTED', () => {
      const underfilledMetadata = {
        mode: 'tiered',
        usageUnits: '15.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '17.00' }, // capacity is 10, billed only 5!
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '10.00', rate: '4.25', amount: '42.50' }, // advanced into next tier!
        ],
      };

      expect(isValidTieredBillItemMetadata(underfilledMetadata)).toBe(false);
    });

    it('Section 17: final finite tier may be partially consumed (VALID)', () => {
      const partialFiniteMetadata = {
        mode: 'tiered',
        usageUnits: '5.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '17.00' },
        ],
      };

      expect(isValidTieredBillItemMetadata(partialFiniteMetadata)).toBe(true);

      render(<TierBreakdownView metadata={partialFiniteMetadata} unit="unit" />);
      expect(screen.getByText('• 1–10 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('5 × 3.40 = 17.00 บาท')).toBeInTheDocument();
    });

    it('Section 18 & 19: canonical water (15 units) and electricity (130 units) vectors are VALID', () => {
      expect(isValidTieredBillItemMetadata(tieredWaterMetadata)).toBe(true);
      expect(isValidTieredBillItemMetadata(tieredElectricityMetadata)).toBe(true);
    });

    it('Section 20: unbounded 25 units with fully consumed prior finite tiers is VALID', () => {
      const unbounded25Metadata = {
        mode: 'tiered',
        usageUnits: '25.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '10.00', rate: '4.00', amount: '40.00' },
          { lowerExclusive: '20.00', upperInclusive: null, billedUnits: '5.00', rate: '5.00', amount: '25.00' },
        ],
      };

      expect(isValidTieredBillItemMetadata(unbounded25Metadata)).toBe(true);

      render(<TierBreakdownView metadata={unbounded25Metadata} unit="unit" />);
      expect(screen.getByText('• 1–10 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('• 11–20 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('• 21 หน่วยขึ้นไป')).toBeInTheDocument();
      expect(screen.getByText('5 × 5.00 = 25.00 บาท')).toBeInTheDocument();
    });

    it('Section 21: zero billedUnits in breakdown row is REJECTED', () => {
      const zeroBilledMetadata = {
        mode: 'tiered',
        usageUnits: '10.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '0.00', rate: '3.40', amount: '0.00' },
        ],
      };

      expect(isValidTieredBillItemMetadata(zeroBilledMetadata)).toBe(false);
    });

    it('Section 22: negative tier row amount is REJECTED inside tier breakdown', () => {
      const negativeAmountMetadata = {
        mode: 'tiered',
        usageUnits: '5.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '5.00', rate: '3.40', amount: '-17.00' },
        ],
      };

      expect(isValidTieredBillItemMetadata(negativeAmountMetadata)).toBe(false);
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
