/**
 * @license Apache-2.0
 * OWNER R3.9-B: Tiered Utility Persistence, Snapshot, and Validation Authority Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateCanonicalUtilityTiers,
  CanonicalTierRecord,
} from '../utils/utility-tier-validator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { InMemoryBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';

describe('OWNER R3.9-B — Canonical Utility Tier Validation Authority', () => {
  describe('Valid Tier Configurations', () => {
    it('validates and formats a standard 3-tier progressive configuration (Water preset: 10@18, 20@20, ∞@22)', () => {
      const input = [
        { upTo: '10', rate: '18' },
        { upTo: '20', rate: '20' },
        { upTo: null, rate: '22' },
      ];

      const result = validateCanonicalUtilityTiers(input);
      expect(result).toEqual([
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ]);
    });

    it('validates and formats Electricity 3-tier preset (50@7, 150@8, ∞@9)', () => {
      const input = [
        { upTo: 50, rate: 7 },
        { upTo: 150, rate: 8 },
        { upTo: null, rate: 9 },
      ];

      const result = validateCanonicalUtilityTiers(input);
      expect(result).toEqual([
        { upTo: '50.00', rate: '7.00' },
        { upTo: '150.00', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ]);
    });

    it('validates a single unlimited tier (length 1)', () => {
      const input = [{ upTo: null, rate: '18.50' }];
      const result = validateCanonicalUtilityTiers(input);
      expect(result).toEqual([{ upTo: null, rate: '18.50' }]);
    });

    it('validates rate of 0.00 (free utility up to threshold)', () => {
      const input = [
        { upTo: '10', rate: '0.00' },
        { upTo: null, rate: '18.00' },
      ];
      const result = validateCanonicalUtilityTiers(input);
      expect(result).toEqual([
        { upTo: '10.00', rate: '0.00' },
        { upTo: null, rate: '18.00' },
      ]);
    });

    it('validates maximum allowed 10 tiers', () => {
      const input = [
        { upTo: '10', rate: '10' },
        { upTo: '20', rate: '11' },
        { upTo: '30', rate: '12' },
        { upTo: '40', rate: '13' },
        { upTo: '50', rate: '14' },
        { upTo: '60', rate: '15' },
        { upTo: '70', rate: '16' },
        { upTo: '80', rate: '17' },
        { upTo: '90', rate: '18' },
        { upTo: null, rate: '19' },
      ];
      const result = validateCanonicalUtilityTiers(input);
      expect(result).toHaveLength(10);
      expect(result[9]).toEqual({ upTo: null, rate: '19.00' });
    });

    it('handles nullish variations for final tier upTo (undefined, "", "null")', () => {
      expect(validateCanonicalUtilityTiers([{ rate: '15' }])).toEqual([
        { upTo: null, rate: '15.00' },
      ]);
      expect(validateCanonicalUtilityTiers([{ upTo: '', rate: '15' }])).toEqual([
        { upTo: null, rate: '15.00' },
      ]);
      expect(validateCanonicalUtilityTiers([{ upTo: 'null', rate: '15' }])).toEqual([
        { upTo: null, rate: '15.00' },
      ]);
    });
  });

  describe('Invalid Tier Configurations (Fail-Closed)', () => {
    it('rejects non-array input', () => {
      expect(() => validateCanonicalUtilityTiers(null)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers('not an array')).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers({})).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
    });

    it('rejects empty array (0 tiers)', () => {
      expect(() => validateCanonicalUtilityTiers([])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must contain at least 1 tier'
      );
    });

    it('rejects array with more than 10 tiers', () => {
      const input = Array.from({ length: 11 }, (_, i) => ({
        upTo: i === 10 ? null : String((i + 1) * 10),
        rate: '10',
      }));
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration exceeds maximum limit of 10 tiers'
      );
    });

    it('rejects non-object tier elements', () => {
      expect(() => validateCanonicalUtilityTiers(['invalid'])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 must be an object'
      );
    });

    it('rejects negative rate', () => {
      const input = [{ upTo: null, rate: '-5.00' }];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 rate cannot be negative'
      );
    });

    it('rejects NaN, Infinity, or missing rate', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: 'abc' }])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 has invalid rate'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: Infinity }])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 has invalid rate'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: null }])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 has invalid rate'
      );
    });

    it('rejects non-null upTo on final tier', () => {
      const input = [
        { upTo: '10', rate: '18' },
        { upTo: '20', rate: '20' },
      ];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Final tier must be unlimited (upTo: null)'
      );
    });

    it('rejects null upTo on non-final tier', () => {
      const input = [
        { upTo: null, rate: '18' },
        { upTo: null, rate: '20' },
      ];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Non-final tier at index 0 cannot be unlimited'
      );
    });

    it('rejects upTo <= 0 on intermediate tier', () => {
      const input = [
        { upTo: '0', rate: '18' },
        { upTo: null, rate: '20' },
      ];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 upTo boundary must be strictly greater than 0'
      );

      const inputNeg = [
        { upTo: '-10', rate: '18' },
        { upTo: null, rate: '20' },
      ];
      expect(() => validateCanonicalUtilityTiers(inputNeg)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 upTo boundary must be strictly greater than 0'
      );
    });

    it('rejects non-ascending or duplicate upTo boundaries', () => {
      // Descending
      const descending = [
        { upTo: '20', rate: '18' },
        { upTo: '10', rate: '20' },
        { upTo: null, rate: '22' },
      ];
      expect(() => validateCanonicalUtilityTiers(descending)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier boundaries must be strictly ascending'
      );

      // Duplicate
      const duplicate = [
        { upTo: '10', rate: '18' },
        { upTo: '10', rate: '20' },
        { upTo: null, rate: '22' },
      ];
      expect(() => validateCanonicalUtilityTiers(duplicate)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier boundaries must be strictly ascending'
      );
    });
  });

  describe('Billing Mode Normalizer Authority with Tiered Mode', () => {
    it('normalizes "tiered" and its casing variants to canonical "tiered"', () => {
      expect(normalizeUtilityBillingMode('tiered')).toBe('tiered');
      expect(normalizeUtilityBillingMode('TIERED')).toBe('tiered');
      expect(normalizeUtilityBillingMode(' Tiered ')).toBe('tiered');
    });

    it('preserves other canonical modes', () => {
      expect(normalizeUtilityBillingMode('per_unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('per_person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('fixed')).toBe('fixed');
      expect(normalizeUtilityBillingMode('room')).toBe('fixed');
    });
  });

  describe('DormitoryBillingSettings & Snapshot Tier Persistence & Inactive Retention', () => {
    it('persists and retrieves validated tier rates in InMemoryBillingSettingsRepository', async () => {
      const repo = new InMemoryBillingSettingsRepository();
      const dormId = 'dorm-tiered-01';

      const waterTiers = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];

      const created = await repo.create({
        dormitoryId: dormId,
        waterBillingType: 'tiered',
        waterTierRates: waterTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      });

      expect(created.waterBillingType).toBe('tiered');
      expect(created.waterTierRates).toEqual(waterTiers);

      // Verify retrieval
      const found = await repo.findByDormitoryId(dormId);
      expect(found?.waterTierRates).toEqual(waterTiers);

      // Switch mode to per_unit without erasing waterTierRates (inactive retention)
      const updated = await repo.update(dormId, {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
      });
      expect(updated?.waterBillingType).toBe('per_unit');
      expect(updated?.waterTierRates).toEqual(waterTiers); // Inactive tiers preserved
    });

    it('creates and updates BillingRateSnapshot with tiered rate JSON isolation in InMemoryBillingCycleRepository', async () => {
      const repo = new InMemoryBillingCycleRepository();
      const dormId = 'dorm-tiered-snap';

      const cycle = await repo.create(dormId, {
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
      });

      const waterTiers = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: null, rate: '22.00' },
      ];
      const elecTiers = [
        { upTo: '50.00', rate: '7.00' },
        { upTo: '150.00', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ];

      const snap = await repo.createRateSnapshot(dormId, {
        billingCycleId: cycle.id,
        waterBillingType: 'tiered',
        waterRate: '0.00',
        waterTierRates: waterTiers,
        electricityBillingType: 'tiered',
        electricityRate: '0.00',
        electricityTierRates: elecTiers,
        commonFee: '200.00',
        commonFeeMode: 'per_room',
        internetFee: '0.00',
        internetFeeMode: 'none',
        parkingFee: '0.00',
        parkingFeeMode: 'none',
        lateFeeType: 'none',
        lateFeeValue: '0.00',
        source: 'TEMPLATE_DEFAULT',
      });

      expect(snap.waterBillingType).toBe('tiered');
      expect(snap.waterTierRates).toEqual(waterTiers);
      expect(snap.electricityBillingType).toBe('tiered');
      expect(snap.electricityTierRates).toEqual(elecTiers);

      // Verify retrieval
      const found = await repo.findRateSnapshot(cycle.id, dormId);
      expect(found?.waterTierRates).toEqual(waterTiers);
      expect(found?.electricityTierRates).toEqual(elecTiers);
    });
  });
});
