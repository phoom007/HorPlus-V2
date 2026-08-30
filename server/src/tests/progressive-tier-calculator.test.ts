/**
 * @license Apache-2.0
 * OWNER R3.9-C: Canonical Progressive Tier Calculator & Monthly Utility Integration Test Suite
 */

import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calculateProgressiveTieredCharge,
  validateCanonicalUsageUnits,
  CanonicalTierBreakdown,
} from '../utils/progressive-tier-calculator.util.js';
import {
  calculateCanonicalMonthlyUtility,
  CanonicalMonthlyUtilityInput,
  CanonicalRateSnapshotInput,
} from '../utils/monthly-utility-calculator.util.js';

describe('OWNER R3.9-C: Progressive Tiered Utility Calculator & Authority', () => {
  // Standard Water 3-Tier Tariff: (0, 10] @ 18.00, (10, 20] @ 20.00, (20, ∞) @ 22.00
  const standardWaterTiers = [
    { upTo: '10.00', rate: '18.00' },
    { upTo: '20.00', rate: '20.00' },
    { upTo: null, rate: '22.00' },
  ];

  // Standard Electricity 3-Tier Tariff: (0, 50] @ 7.00, (50, 150] @ 8.00, (150, ∞) @ 9.00
  const standardElecTiers = [
    { upTo: '50.00', rate: '7.00' },
    { upTo: '150.00', rate: '8.00' },
    { upTo: null, rate: '9.00' },
  ];

  describe('Group A: Pure Progressive Helper (calculateProgressiveTieredCharge)', () => {
    describe('Section 22: Exact Required Water Examples', () => {
      it('Usage 0.00 -> Total 0.00 (empty breakdown)', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '0.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('0.00');
        expect(res.totalAmount).toBe('0.00');
        expect(res.tierBreakdown).toEqual([]);
      });

      it('Usage 0.50 -> 0.50 * 18.00 = 9.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '0.50',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('0.50');
        expect(res.totalAmount).toBe('9.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '0.50',
            rate: '18.00',
            amount: '9.00',
          },
        ]);
      });

      it('Usage 1.00 -> 1.00 * 18.00 = 18.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '1.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('1.00');
        expect(res.totalAmount).toBe('18.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '1.00',
            rate: '18.00',
            amount: '18.00',
          },
        ]);
      });

      it('Usage 10.00 -> 10.00 * 18.00 = 180.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '10.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('10.00');
        expect(res.totalAmount).toBe('180.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '10.00',
            rate: '18.00',
            amount: '180.00',
          },
        ]);
      });

      it('Usage 10.50 -> 10 * 18.00 + 0.50 * 20.00 = 190.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '10.50',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('10.50');
        expect(res.totalAmount).toBe('190.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '10.00',
            rate: '18.00',
            amount: '180.00',
          },
          {
            lowerExclusive: '10.00',
            upperInclusive: '20.00',
            billedUnits: '0.50',
            rate: '20.00',
            amount: '10.00',
          },
        ]);
      });

      it('Usage 15.00 -> 10 * 18.00 + 5 * 20.00 = 280.00 (NOT flat 15 * 20 = 300)', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '15.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('15.00');
        expect(res.totalAmount).toBe('280.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '10.00',
            billedUnits: '10.00',
            rate: '18.00',
            amount: '180.00',
          },
          {
            lowerExclusive: '10.00',
            upperInclusive: '20.00',
            billedUnits: '5.00',
            rate: '20.00',
            amount: '100.00',
          },
        ]);
      });

      it('Usage 20.00 -> 10 * 18.00 + 10 * 20.00 = 380.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '20.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('20.00');
        expect(res.totalAmount).toBe('380.00');
        expect(res.tierBreakdown).toHaveLength(2);
        expect(res.tierBreakdown[1]).toEqual({
          lowerExclusive: '10.00',
          upperInclusive: '20.00',
          billedUnits: '10.00',
          rate: '20.00',
          amount: '200.00',
        });
      });

      it('Usage 21.00 -> 10 * 18.00 + 10 * 20.00 + 1 * 22.00 = 402.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '21.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('21.00');
        expect(res.totalAmount).toBe('402.00');
        expect(res.tierBreakdown).toHaveLength(3);
        expect(res.tierBreakdown[2]).toEqual({
          lowerExclusive: '20.00',
          upperInclusive: null,
          billedUnits: '1.00',
          rate: '22.00',
          amount: '22.00',
        });
      });

      it('Usage 25.00 -> 10 * 18.00 + 10 * 20.00 + 5 * 22.00 = 490.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: '25.00',
          tiers: standardWaterTiers,
        });
        expect(res.usageUnits).toBe('25.00');
        expect(res.totalAmount).toBe('490.00');
        expect(res.tierBreakdown).toHaveLength(3);
        expect(res.tierBreakdown[2]).toEqual({
          lowerExclusive: '20.00',
          upperInclusive: null,
          billedUnits: '5.00',
          rate: '22.00',
          amount: '110.00',
        });
      });
    });

    describe('Section 23: Exact Required Electricity Examples', () => {
      it('Usage 50 -> 50 * 7.00 = 350.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: 50,
          tiers: standardElecTiers,
        });
        expect(res.usageUnits).toBe('50.00');
        expect(res.totalAmount).toBe('350.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '50.00',
            billedUnits: '50.00',
            rate: '7.00',
            amount: '350.00',
          },
        ]);
      });

      it('Usage 51 -> 50 * 7.00 + 1 * 8.00 = 358.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: 51,
          tiers: standardElecTiers,
        });
        expect(res.usageUnits).toBe('51.00');
        expect(res.totalAmount).toBe('358.00');
        expect(res.tierBreakdown).toEqual([
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
            billedUnits: '1.00',
            rate: '8.00',
            amount: '8.00',
          },
        ]);
      });

      it('Usage 150 -> 50 * 7.00 + 100 * 8.00 = 1,150.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: 150,
          tiers: standardElecTiers,
        });
        expect(res.usageUnits).toBe('150.00');
        expect(res.totalAmount).toBe('1150.00');
        expect(res.tierBreakdown).toHaveLength(2);
      });

      it('Usage 151 -> 50 * 7.00 + 100 * 8.00 + 1 * 9.00 = 1,159.00', () => {
        const res = calculateProgressiveTieredCharge({
          usageUnits: 151,
          tiers: standardElecTiers,
        });
        expect(res.usageUnits).toBe('151.00');
        expect(res.totalAmount).toBe('1159.00');
        expect(res.tierBreakdown).toHaveLength(3);
        expect(res.tierBreakdown[2]).toEqual({
          lowerExclusive: '150.00',
          upperInclusive: null,
          billedUnits: '1.00',
          rate: '9.00',
          amount: '9.00',
        });
      });
    });

    describe('Section 25: Boundary Tests (Exact Transitions)', () => {
      it('Boundary transition around Tier 1 (9.99, 10.00, 10.01)', () => {
        // 9.99: entirely in Tier 1 -> 9.99 * 18 = 179.82
        const res999 = calculateProgressiveTieredCharge({ usageUnits: '9.99', tiers: standardWaterTiers });
        expect(res999.totalAmount).toBe('179.82');
        expect(res999.tierBreakdown).toHaveLength(1);

        // 10.00: exact boundary -> 10.00 * 18 = 180.00
        const res1000 = calculateProgressiveTieredCharge({ usageUnits: '10.00', tiers: standardWaterTiers });
        expect(res1000.totalAmount).toBe('180.00');
        expect(res1000.tierBreakdown).toHaveLength(1);

        // 10.01: into Tier 2 -> 10 * 18 + 0.01 * 20 = 180 + 0.20 = 180.20
        const res1001 = calculateProgressiveTieredCharge({ usageUnits: '10.01', tiers: standardWaterTiers });
        expect(res1001.totalAmount).toBe('180.20');
        expect(res1001.tierBreakdown).toHaveLength(2);
        expect(res1001.tierBreakdown[1].billedUnits).toBe('0.01');
        expect(res1001.tierBreakdown[1].amount).toBe('0.20');
      });

      it('Boundary transition around Tier 2 (19.99, 20.00, 20.01)', () => {
        // 19.99: 10 * 18 + 9.99 * 20 = 180 + 199.80 = 379.80
        const res1999 = calculateProgressiveTieredCharge({ usageUnits: '19.99', tiers: standardWaterTiers });
        expect(res1999.totalAmount).toBe('379.80');
        expect(res1999.tierBreakdown).toHaveLength(2);

        // 20.00: 10 * 18 + 10 * 20 = 380.00
        const res2000 = calculateProgressiveTieredCharge({ usageUnits: '20.00', tiers: standardWaterTiers });
        expect(res2000.totalAmount).toBe('380.00');
        expect(res2000.tierBreakdown).toHaveLength(2);

        // 20.01: 10 * 18 + 10 * 20 + 0.01 * 22 = 380 + 0.22 = 380.22
        const res2001 = calculateProgressiveTieredCharge({ usageUnits: '20.01', tiers: standardWaterTiers });
        expect(res2001.totalAmount).toBe('380.22');
        expect(res2001.tierBreakdown).toHaveLength(3);
        expect(res2001.tierBreakdown[2].billedUnits).toBe('0.01');
        expect(res2001.tierBreakdown[2].amount).toBe('0.22');
      });
    });

    describe('Section 24: Locked Rounding Policy — Product Owner 1A (Per-Tier 2DP Rounding First)', () => {
      it('Single tier raw product 0.005 rounds to 0.01 (ROUND_HALF_UP)', () => {
        // Tier: (0, ∞) @ 0.05. Usage: 0.10 -> 0.10 * 0.05 = 0.0050 -> 0.01
        const tiers = [{ upTo: null, rate: '0.05' }];
        const res = calculateProgressiveTieredCharge({
          usageUnits: '0.10',
          tiers,
        });
        expect(res.totalAmount).toBe('0.01');
        expect(res.tierBreakdown[0].amount).toBe('0.01');
      });

      it('Two separately billed tiers producing raw 0.005 + 0.005 sum to 0.01 + 0.01 = 0.02 (Product Owner 1A)', () => {
        // Tier 1: (0, 0.10] @ 0.05 -> raw: 0.10 * 0.05 = 0.005 -> rounds to 0.01
        // Tier 2: (0.10, ∞) @ 0.05 -> raw: 0.10 * 0.05 = 0.005 -> rounds to 0.01
        // Total MUST be 0.01 + 0.01 = 0.02 (NOT unrounded 0.010 -> 0.01)
        const tiers = [
          { upTo: '0.10', rate: '0.05' },
          { upTo: null, rate: '0.05' },
        ];
        const res = calculateProgressiveTieredCharge({
          usageUnits: '0.20',
          tiers,
        });
        expect(res.tierBreakdown[0].amount).toBe('0.01');
        expect(res.tierBreakdown[1].amount).toBe('0.01');
        expect(res.totalAmount).toBe('0.02');
      });
    });

    describe('Section 26 & 27: Single Unlimited Tier & Zero-Rate Tiers', () => {
      it('Single unlimited tier behaves progressively and sets canonical metadata', () => {
        const singleTier = [{ upTo: null, rate: '18.00' }];
        const res = calculateProgressiveTieredCharge({
          usageUnits: '10.00',
          tiers: singleTier,
        });
        expect(res.totalAmount).toBe('180.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: null,
            billedUnits: '10.00',
            rate: '18.00',
            amount: '180.00',
          },
        ]);
      });

      it('Zero-rate intermediate tier (0, 5] @ 0.00, (5, ∞) @ 18.00, usage 7 -> 0 + 36 = 36.00', () => {
        const tiers = [
          { upTo: '5.00', rate: '0.00' },
          { upTo: null, rate: '18.00' },
        ];
        const res = calculateProgressiveTieredCharge({
          usageUnits: '7.00',
          tiers,
        });
        expect(res.totalAmount).toBe('36.00');
        expect(res.tierBreakdown).toEqual([
          {
            lowerExclusive: '0.00',
            upperInclusive: '5.00',
            billedUnits: '5.00',
            rate: '0.00',
            amount: '0.00',
          },
          {
            lowerExclusive: '5.00',
            upperInclusive: null,
            billedUnits: '2.00',
            rate: '18.00',
            amount: '36.00',
          },
        ]);
      });
    });

    describe('Section 8, 10, 29: Fail-Closed Input Safety & Corrupt Tier Handling', () => {
      it('Rejects negative usage units', () => {
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: '-5.00',
            tiers: standardWaterTiers,
          })
        ).toThrow('INVALID_USAGE');
      });

      it('Rejects NaN, Infinity, scientific notation in usage', () => {
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: '1e2',
            tiers: standardWaterTiers,
          })
        ).toThrow('INVALID_USAGE');
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: NaN,
            tiers: standardWaterTiers,
          })
        ).toThrow('INVALID_USAGE');
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: Infinity,
            tiers: standardWaterTiers,
          })
        ).toThrow('INVALID_USAGE');
      });

      it('Rejects null or empty tier configuration', () => {
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: '10.00',
            tiers: null as any,
          })
        ).toThrow('INVALID_TIER_CONFIGURATION');
        expect(() =>
          calculateProgressiveTieredCharge({
            usageUnits: '10.00',
            tiers: [],
          })
        ).toThrow('INVALID_TIER_CONFIGURATION');
      });
    });
  });

  describe('Group B: Canonical Monthly Utility Water Tiered Integration', () => {
    const baseSnapshot: CanonicalRateSnapshotInput = {
      waterBillingType: 'tiered',
      waterTierRates: standardWaterTiers,
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFeeMode: 'per_room',
      commonFee: '200.00',
    };

    it('Section 15, 16, 36: Exactly ONE BillItem with unitPrice=0.00, amount=280.00, quantity=15.00', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: baseSnapshot,
        waterReading: { previousReading: '100', currentReading: '115' },
        electricReading: { previousReading: '500', currentReading: '500' },
      });

      expect(res.waterUsage).toBe('15.00');
      expect(res.waterAmount).toBe('280.00');
      expect(res.waterRate).toBe('0.00'); // Technical 0.00, no fake average rate (Section 16/19)
      expect(res.waterMode).toBe('tiered');

      const waterItems = res.items.filter((i) => i.type === 'water');
      expect(waterItems).toHaveLength(1);
      expect(waterItems[0]).toEqual({
        type: 'water',
        description: 'ค่าน้ำ (100 - 115)',
        quantity: '15.00',
        unit: 'unit',
        unitPrice: '0.00',
        amount: '280.00',
        metadata: {
          previousReading: '100',
          currentReading: '115',
          usageUnits: '15.00',
          mode: 'tiered',
          isRollover: false,
          rolloverType: null,
          tierBreakdown: [
            {
              lowerExclusive: '0.00',
              upperInclusive: '10.00',
              billedUnits: '10.00',
              rate: '18.00',
              amount: '180.00',
            },
            {
              lowerExclusive: '10.00',
              upperInclusive: '20.00',
              billedUnits: '5.00',
              rate: '20.00',
              amount: '100.00',
            },
          ],
        },
      });
    });

    it('Section 35: Meter rollover integrates seamlessly into tiered calculation', () => {
      // 99995 to 00010 (5 digits) -> 15 units usage with rollover
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: baseSnapshot,
        waterReading: { previousReading: '99995', currentReading: '00010' },
        electricReading: { previousReading: '0', currentReading: '0' },
      });

      expect(res.waterUsage).toBe('15.00');
      expect(res.waterAmount).toBe('280.00');

      const waterItem = res.items.find((i) => i.type === 'water');
      expect(waterItem?.metadata?.isRollover).toBe(true);
      expect(waterItem?.metadata?.rolloverType).toBe('5_DIGIT');
      expect(waterItem?.metadata?.tierBreakdown).toHaveLength(2);
    });

    it('Section 6: Missing meter reading fails closed with MISSING_WATER_METER_READING', () => {
      expect(() =>
        calculateCanonicalMonthlyUtility({
          rateSnapshot: baseSnapshot,
          waterReading: { previousReading: '100', currentReading: '' },
          electricReading: { previousReading: '0', currentReading: '0' },
        })
      ).toThrow('MISSING_WATER_METER_READING');
    });

    it('Section 6 & 28: All-zero tier rates STILL require meter readings (Policy 2A)', () => {
      const allZeroTiers = [
        { upTo: '10.00', rate: '0.00' },
        { upTo: null, rate: '0.00' },
      ];
      const zeroRateSnapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'tiered',
        waterTierRates: allZeroTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      };

      // Missing readings -> REJECT
      expect(() =>
        calculateCanonicalMonthlyUtility({
          rateSnapshot: zeroRateSnapshot,
          waterReading: { previousReading: null, currentReading: null },
          electricReading: { previousReading: '0', currentReading: '0' },
        })
      ).toThrow('MISSING_WATER_METER_READING');

      // Valid readings -> ACCEPT with 0.00 amount and preserved usage
      const validZeroRes = calculateCanonicalMonthlyUtility({
        rateSnapshot: zeroRateSnapshot,
        waterReading: { previousReading: '100', currentReading: '120' },
        electricReading: { previousReading: '0', currentReading: '0' },
      });
      expect(validZeroRes.waterUsage).toBe('20.00');
      expect(validZeroRes.waterAmount).toBe('0.00');
      expect(validZeroRes.items.find((i) => i.type === 'water')).toBeDefined();
    });
  });

  describe('Group C: Canonical Monthly Utility Electricity Tiered Integration', () => {
    const elecSnapshot: CanonicalRateSnapshotInput = {
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'tiered',
      electricityTierRates: standardElecTiers,
    };

    it('Calculates electricity progressive tiers (151 units -> 1,159.00)', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: elecSnapshot,
        waterReading: { previousReading: '0', currentReading: '0' },
        electricReading: { previousReading: '1000', currentReading: '1151' },
      });

      expect(res.electricityUsage).toBe('151.00');
      expect(res.electricityAmount).toBe('1159.00');
      expect(res.electricityRate).toBe('0.00');
      expect(res.electricityMode).toBe('tiered');

      const elecItem = res.items.find((i) => i.type === 'electricity');
      expect(elecItem?.amount).toBe('1159.00');
      expect(elecItem?.unitPrice).toBe('0.00');
      expect(elecItem?.metadata?.tierBreakdown).toHaveLength(3);
    });

    it('Missing electricity reading throws MISSING_ELECTRICITY_METER_READING', () => {
      expect(() =>
        calculateCanonicalMonthlyUtility({
          rateSnapshot: elecSnapshot,
          waterReading: { previousReading: '0', currentReading: '0' },
          electricReading: { previousReading: '100', currentReading: null },
        })
      ).toThrow('MISSING_ELECTRICITY_METER_READING');
    });
  });

  describe('Group D: Mixed Modes & Subtotal Invariant (Section 14, 31, 37)', () => {
    it('Water tiered + Electricity per_unit (Mixed Mode)', () => {
      const mixedSnapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'tiered',
        waterTierRates: standardWaterTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFeeMode: 'per_room',
        commonFee: '200.00',
      };

      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: mixedSnapshot,
        waterReading: { previousReading: '100', currentReading: '115' }, // 15 units -> 280.00
        electricReading: { previousReading: '500', currentReading: '550' }, // 50 units -> 350.00
      });

      expect(res.waterAmount).toBe('280.00');
      expect(res.waterMode).toBe('tiered');
      expect(res.electricityAmount).toBe('350.00');
      expect(res.electricityMode).toBe('per_unit');
      expect(res.commonFee).toBe('200.00');
      expect(res.subtotal).toBe('830.00'); // 280 + 350 + 200 = 830.00
      expect(res.monthlyUtilityTotal).toBe('830.00');

      // Rounding Reconciliation Invariant (Section 37)
      const waterItem = res.items.find((i) => i.type === 'water')!;
      const sumTierBreakdown = waterItem.metadata?.tierBreakdown
        .reduce((sum: number, b: CanonicalTierBreakdown) => sum + Number(b.amount), 0)
        .toFixed(2);
      expect(sumTierBreakdown).toBe(waterItem.amount);
      expect(waterItem.amount).toBe(res.waterAmount);
    });

    it('Water fixed + Electricity tiered (Mixed Mode)', () => {
      const mixedSnapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'fixed',
        waterRate: '150.00',
        electricityBillingType: 'tiered',
        electricityTierRates: standardElecTiers,
      };

      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: mixedSnapshot,
        waterReading: null,
        electricReading: { previousReading: '100', currentReading: '151' }, // 51 units -> 358.00
      });

      expect(res.waterAmount).toBe('150.00');
      expect(res.waterMode).toBe('fixed');
      expect(res.electricityAmount).toBe('358.00');
      expect(res.electricityMode).toBe('tiered');
      expect(res.subtotal).toBe('508.00'); // 150 + 358 = 508.00
    });
  });

  describe('Group E: Non-Tiered Regressions & Backward Compatibility (Section 30)', () => {
    it('per_unit calculation remains 100% identical and unchanged', () => {
      const snapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      };
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: snapshot,
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '200', currentReading: '250' },
      });
      expect(res.waterAmount).toBe('180.00');
      expect(res.electricityAmount).toBe('350.00');
      expect(res.subtotal).toBe('530.00');
    });

    it('per_person calculation remains 100% identical', () => {
      const snapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'per_person',
        waterRate: '100.00',
        electricityBillingType: 'fixed',
        electricityRate: '300.00',
      };
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: snapshot,
        peopleCount: 3,
      });
      expect(res.waterAmount).toBe('300.00');
      expect(res.electricityAmount).toBe('300.00');
      expect(res.subtotal).toBe('600.00');
    });

    it('Legacy aliases (flat, flat_rate, fixed_monthly) continue to normalize to fixed', () => {
      const snapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'flat',
        waterRate: '120.00',
        electricityBillingType: 'fixed_monthly',
        electricityRate: '400.00',
      };
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: snapshot,
      });
      expect(res.waterMode).toBe('fixed');
      expect(res.waterAmount).toBe('120.00');
      expect(res.electricityMode).toBe('fixed');
      expect(res.electricityAmount).toBe('400.00');
      expect(res.subtotal).toBe('520.00');
    });
  });
});
