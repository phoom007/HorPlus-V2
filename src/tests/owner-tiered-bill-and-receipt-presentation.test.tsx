/**
 * @license Apache-2.0
 * OWNER R3.9-E.1B.2: Frontend Tiered Bill & Receipt Presentation Test Suite
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
} from '../utils/billPresentation';
import { TierBreakdownView } from '../components/bills/TierBreakdownView';
import { filterNonZeroBillItems, isNonZeroAmount, formatBillingQuantity } from '../types';
import { formatBaht } from '../components/GlobalComponents';

describe('OWNER R3.9-E.1B.2 — Tiered Bill & Receipt Presentation', () => {
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
  // 1. Shared Helpers & Formatters Validation
  // =========================================================================
  describe('1. Shared Helpers & Formatters', () => {
    it('isValidTieredBillItemMetadata validates correct schema and rejects malformed objects', () => {
      expect(isValidTieredBillItemMetadata(tieredWaterMetadata)).toBe(true);
      expect(isValidTieredBillItemMetadata(tieredElectricityMetadata)).toBe(true);

      // Malformed cases
      expect(isValidTieredBillItemMetadata(null)).toBe(false);
      expect(isValidTieredBillItemMetadata(undefined)).toBe(false);
      expect(isValidTieredBillItemMetadata({})).toBe(false);
      expect(isValidTieredBillItemMetadata({ mode: 'fixed' })).toBe(false);
      expect(isValidTieredBillItemMetadata({ mode: 'tiered', tierBreakdown: [] })).toBe(false);
      expect(isValidTieredBillItemMetadata({ mode: 'tiered', tierBreakdown: 'not-array' })).toBe(false);
      expect(isValidTieredBillItemMetadata({ mode: 'tiered', tierBreakdown: [{ rate: '3.40' }] })).toBe(false);
    });

    it('formatTierRange correctly formats progressive intervals into human Thai ranges (Section 7)', () => {
      expect(formatTierRange('0.00', '10.00')).toBe('1–10 หน่วย');
      expect(formatTierRange('10.00', '20.00')).toBe('11–20 หน่วย');
      expect(formatTierRange('20.00', null)).toBe('21 หน่วยขึ้นไป');
      expect(formatTierRange('0.00', '50.00')).toBe('1–50 หน่วย');
      expect(formatTierRange('50.00', '150.00')).toBe('51–150 หน่วย');
      expect(formatTierRange('150.00', '')).toBe('151 หน่วยขึ้นไป');
    });

    it('formatTierUsage formats integer units without floating-point fraction (Section 9)', () => {
      expect(formatTierUsage('15.00')).toBe('15 หน่วย');
      expect(formatTierUsage(130)).toBe('130 หน่วย');
      expect(formatTierUsage('10.00')).toBe('10 หน่วย');
      expect(formatTierUsage('5.00')).toBe('5 หน่วย');
    });

    it('formatTierRateLabel shows "คิดตามขั้นบันได" and never "0.00 บาท/หน่วย" for tiered items (Section 6)', () => {
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
  // 2. TierBreakdownView Component
  // =========================================================================
  describe('2. TierBreakdownView Component', () => {
    it('renders Water tier breakdown with exact rates and amounts without recalculation (Section 28)', () => {
      render(<TierBreakdownView metadata={tieredWaterMetadata} unit="unit" />);

      expect(screen.getByTestId('tier-breakdown-view')).toBeInTheDocument();
      expect(screen.getByText('รายละเอียดการคิดแบบขั้นบันได:')).toBeInTheDocument();

      expect(screen.getByText('• 1–10 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();

      expect(screen.getByText('• 11–20 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('5 × 4.25 = 21.25 บาท')).toBeInTheDocument();
    });

    it('renders Electricity tier breakdown correctly (Section 29)', () => {
      render(<TierBreakdownView metadata={tieredElectricityMetadata} unit="unit" />);

      expect(screen.getByText('• 1–50 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('50 × 7.00 = 350.00 บาท')).toBeInTheDocument();

      expect(screen.getByText('• 51–150 หน่วย')).toBeInTheDocument();
      expect(screen.getByText('80 × 8.00 = 640.00 บาท')).toBeInTheDocument();
    });

    it('fails closed and renders nothing for malformed or missing metadata (Section 26 & 27)', () => {
      const { container: c1 } = render(<TierBreakdownView metadata={null} />);
      expect(c1.firstChild).toBeNull();

      const { container: c2 } = render(<TierBreakdownView metadata={{ mode: 'tiered', tierBreakdown: 'bad' }} />);
      expect(c2.firstChild).toBeNull();
    });
  });

  // =========================================================================
  // 3. Bill Detail Presentation Simulation (Section 28, 29, 11)
  // =========================================================================
  describe('3. Bill Detail Table Presentation', () => {
    it('Section 28: Bill Detail renders Water Tier row with "คิดตามขั้นบันได", nested breakdown, and NO "0.00 บาท/หน่วย"', () => {
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

    it('Section 29: Bill Detail renders Electricity Tier row correctly', () => {
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
  // 4. Single Receipt Partial Payment Presentation (Section 30 & 14)
  // =========================================================================
  describe('4. Single Receipt Partial Payment Presentation', () => {
    it('Section 30 & 14: Partial receipt shows gross items, Tier breakdown, and reconciliation without proration', () => {
      const snapshot = {
        billTotal: 1055.25,
        allocatedAmount: 500.00,
        totalAmount: 500.00,
        items: [
          {
            description: 'ค่าเช่าห้องพัก',
            quantity: '1.00',
            unit: 'month',
            unitPrice: '1000.00',
            amount: 1000.00,
            metadata: null,
          },
          {
            description: 'ค่าน้ำประปา (ขั้นบันได)',
            quantity: '15.00',
            unit: 'unit',
            unitPrice: '0.00',
            amount: 55.25,
            metadata: tieredWaterMetadata,
          },
        ],
      };

      const { container } = render(
        <div>
          <table>
            <tbody>
              {snapshot.items.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <div>{it.description}</div>
                    <TierBreakdownView metadata={it.metadata} unit={it.unit} isPrint />
                  </td>
                  <td>{formatBillingQuantity(it.quantity, it.unit)}</td>
                  <td>{formatTierRateLabel(it.unitPrice, it.unit, it.metadata)}</td>
                  <td>{formatBaht(it.amount)}</td>
                </tr>
              ))}
              <tr>
                <td>ยอดบิล:</td>
                <td>{formatBaht(snapshot.billTotal)}</td>
              </tr>
              <tr>
                <td>ยอดรับชำระในใบเสร็จนี้:</td>
                <td>{formatBaht(snapshot.allocatedAmount)}</td>
              </tr>
              <tr>
                <td>รวมรับสุทธิ:</td>
                <td>{formatBaht(snapshot.totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );

      // Gross Tier Water breakdown is full 55.25 calculation, not prorated to 500/1055.25
      expect(container.textContent).toContain(formatBaht(55.25));
      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('5 × 4.25 = 21.25 บาท')).toBeInTheDocument();

      // Reconciliation
      expect(screen.getByText('ยอดบิล:')).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(1055.25));
      expect(screen.getByText('ยอดรับชำระในใบเสร็จนี้:')).toBeInTheDocument();
      expect(screen.getByText('รวมรับสุทธิ:')).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(500.00));
    });
  });

  // =========================================================================
  // 5. Combined Receipt BillGroups Presentation (Section 31 & 16)
  // =========================================================================
  describe('5. Combined Receipt BillGroups Presentation', () => {
    it('Section 31 & 16: Combined receipt renders billGroups from snapshot with gross items and allocatedAmount', () => {
      const snapshotBillGroups = [
        {
          billId: 'bill-A',
          billNumber: 'INV-202608-A',
          cycleLabel: 'รอบบิล ส.ค. 2569',
          billTotal: 4000.00,
          allocatedAmount: 4000.00,
          items: [
            {
              description: 'ค่าเช่าห้องพัก',
              quantity: '1.00',
              unit: 'month',
              unitPrice: '4000.00',
              amount: 4000.00,
              metadata: null,
            },
          ],
        },
        {
          billId: 'bill-B',
          billNumber: 'INV-202608-B',
          cycleLabel: 'รอบบิล ส.ค. 2569',
          billTotal: 5000.00,
          allocatedAmount: 2500.00,
          items: [
            {
              description: 'ค่าเช่าห้องพัก',
              quantity: '1.00',
              unit: 'month',
              unitPrice: '3954.75',
              amount: 3954.75,
              metadata: null,
            },
            {
              description: 'ค่าน้ำประปา (ขั้นบันได)',
              quantity: '15.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: 55.25,
              metadata: tieredWaterMetadata,
            },
            {
              description: 'ค่าไฟฟ้า (ขั้นบันได)',
              quantity: '130.00',
              unit: 'unit',
              unitPrice: '0.00',
              amount: 990.00,
              metadata: tieredElectricityMetadata,
            },
          ],
        },
      ];

      const { container } = render(
        <div>
          {snapshotBillGroups.map((group, gIdx) => (
            <div key={gIdx} data-testid={`group-${group.billId}`}>
              <h4>{group.cycleLabel} (เลขที่บิล: {group.billNumber})</h4>
              <table>
                <tbody>
                  {group.items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <div>{it.description}</div>
                        <TierBreakdownView metadata={it.metadata} unit={it.unit} isPrint />
                      </td>
                      <td>{formatBillingQuantity(it.quantity, it.unit)}</td>
                      <td>{formatTierRateLabel(it.unitPrice, it.unit, it.metadata)}</td>
                      <td>{formatBaht(it.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>ยอดบิล:</td>
                    <td>{formatBaht(group.billTotal)}</td>
                  </tr>
                  <tr>
                    <td>ยอดรับชำระสำหรับรอบบิลนี้:</td>
                    <td>{formatBaht(group.allocatedAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}
          <div>
            <span>รวมรับสุทธิ:</span>
            <span>{formatBaht(6500.00)}</span>
          </div>
        </div>
      );

      // Bill A assertions
      expect(screen.getByText('เลขที่บิล: INV-202608-A', { exact: false })).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(4000.00));

      // Bill B assertions
      expect(screen.getByText('เลขที่บิล: INV-202608-B', { exact: false })).toBeInTheDocument();
      expect(container.textContent).toContain(formatBaht(5000.00));
      expect(container.textContent).toContain(formatBaht(2500.00));

      // Both Tiered breakdowns in Bill B
      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('50 × 7.00 = 350.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('80 × 8.00 = 640.00 บาท')).toBeInTheDocument();

      // Grand total
      expect(container.textContent).toContain(formatBaht(6500.00));
    });
  });

  // =========================================================================
  // 6. Zero-Line Suppression Policy (Section 10 & 35)
  // =========================================================================
  describe('6. Zero-Line Suppression Policy', () => {
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

  // =========================================================================
  // 7. Snapshot-First Regression (Section 36)
  // =========================================================================
  describe('7. Snapshot-First Historical Invariant', () => {
    it('historical snapshot tier rates win over conflicting current settings/live bill rates', () => {
      const snapshotMetadata = {
        mode: 'tiered',
        usageUnits: '15.00',
        tierBreakdown: [
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
        ],
      };

      // Conflicting current settings fixture rate: 99.00
      const currentSettingsRate = '99.00';

      const { container } = render(<TierBreakdownView metadata={snapshotMetadata} unit="unit" />);

      expect(screen.getByText('10 × 3.40 = 34.00 บาท')).toBeInTheDocument();
      expect(screen.getByText('5 × 4.25 = 21.25 บาท')).toBeInTheDocument();
      expect(container.textContent).not.toContain(currentSettingsRate);
    });
  });
});
