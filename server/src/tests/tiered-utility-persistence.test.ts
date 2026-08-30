/**
 * @license Apache-2.0
 * OWNER R3.9-B.1: Tiered Utility Persistence, Snapshot, and Validation Authority Tests
 */

import { describe, it, expect } from 'vitest';
import {
  validateCanonicalUtilityTiers,
  validateUtilityTierModeConfiguration,
  CanonicalTierRecord,
} from '../utils/utility-tier-validator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { InMemoryBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';

describe('OWNER R3.9-B.1 — Canonical Utility Tier Validation Authority', () => {
  describe('Valid Tier Configurations & Exact Normalization', () => {
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

  describe('Strict Decimal Syntax & Fail-Closed Validation (Cases I, J, K, L)', () => {
    it('rejects scientific notation in rates ("1e2", "1E2", "5e-1") (Case I)', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '1e2' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '1E2' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '5e-1' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
    });

    it('rejects scientific notation in upper bounds ("1e1", "1E1") (Case J)', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: '1e1', rate: '18.00' }, { upTo: null, rate: '20.00' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
    });

    it('rejects numbers with >2 decimal places ("18.000", "10.123") (Case K)', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '18.000' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: '10.123', rate: '18.00' }, { upTo: null, rate: '20.00' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: 10.123, rate: 18.00 }, { upTo: null, rate: 20.00 }])).toThrow(
        'cannot have more than 2 decimal places'
      );
    });

    it('rejects negative rates and negative bounds (Case L)', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '-5.00' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
      expect(() => validateCanonicalUtilityTiers([{ upTo: '-10.00', rate: '18.00' }, { upTo: null, rate: '20.00' }])).toThrow(
        'must be a valid non-negative decimal string with up to 2 decimal places'
      );
    });

    it('rejects non-array input, empty array, or >10 tiers', () => {
      expect(() => validateCanonicalUtilityTiers(null)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers('not an array')).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers([])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must contain at least 1 tier'
      );
      const input11 = Array.from({ length: 11 }, (_, i) => ({
        upTo: i === 10 ? null : String((i + 1) * 10),
        rate: '10',
      }));
      expect(() => validateCanonicalUtilityTiers(input11)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration exceeds maximum limit of 10 tiers'
      );
    });

    it('rejects non-object tier elements', () => {
      expect(() => validateCanonicalUtilityTiers(['invalid'])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 must be an object'
      );
    });

    it('rejects non-null upTo on final tier', () => {
      const input = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
      ];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Final tier must be unlimited (upTo: null)'
      );
    });

    it('rejects null upTo on non-final tier', () => {
      const input = [
        { upTo: null, rate: '18.00' },
        { upTo: null, rate: '20.00' },
      ];
      expect(() => validateCanonicalUtilityTiers(input)).toThrow(
        'INVALID_TIER_CONFIGURATION: Non-final tier at index 0 cannot be unlimited'
      );
    });

    it('rejects upTo boundary <= 0 on intermediate tier', () => {
      expect(() => validateCanonicalUtilityTiers([{ upTo: '0.00', rate: '18.00' }, { upTo: null, rate: '20.00' }])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier at index 0 upTo boundary must be strictly greater than 0'
      );
    });

    it('rejects non-ascending or duplicate upTo boundaries', () => {
      // Descending
      const descending = [
        { upTo: '20.00', rate: '18.00' },
        { upTo: '10.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];
      expect(() => validateCanonicalUtilityTiers(descending)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier boundaries must be strictly ascending'
      );

      // Duplicate
      const duplicate = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '10.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];
      expect(() => validateCanonicalUtilityTiers(duplicate)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier boundaries must be strictly ascending'
      );
    });
  });

  describe('Billing Mode Normalizer Authority', () => {
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

  describe('Shared validateUtilityTierModeConfiguration Authority', () => {
    it('when mode === tiered: validates and returns canonical tiers if present', () => {
      const tiers = [{ upTo: '10', rate: '18' }, { upTo: null, rate: '22' }];
      const res = validateUtilityTierModeConfiguration({
        mode: 'tiered',
        tiers,
        utilityName: 'Water',
      });
      expect(res).toEqual([
        { upTo: '10.00', rate: '18.00' },
        { upTo: null, rate: '22.00' },
      ]);
    });

    it('when mode === tiered: fails closed if tiers is null, undefined, or empty (Cases A, C, E, G)', () => {
      expect(() => validateUtilityTierModeConfiguration({ mode: 'tiered', tiers: null, utilityName: 'Water' })).toThrow(
        "INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided"
      );
      expect(() => validateUtilityTierModeConfiguration({ mode: 'tiered', tiers: undefined, utilityName: 'Electricity' })).toThrow(
        "INVALID_TIER_CONFIGURATION: Electricity billing mode is 'tiered' but no tier configuration was provided"
      );
      expect(() => validateUtilityTierModeConfiguration({ mode: 'tiered', tiers: [], utilityName: 'Water' })).toThrow(
        "INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided"
      );
    });

    it('when mode !== tiered: returns null for active billing calculation (Case H)', () => {
      expect(validateUtilityTierModeConfiguration({ mode: 'per_unit', tiers: null })).toBeNull();
      expect(validateUtilityTierModeConfiguration({ mode: 'fixed', tiers: [{ upTo: null, rate: '10' }] })).toBeNull();
    });
  });

  describe('Effective State Persistence & Inactive Retention (Cases A, B, C, D, H)', () => {
    it('Case A: per_unit/null -> switch to tiered without tiers -> REJECT', () => {
      const currentMode = 'per_unit';
      const currentTiers = null;
      const patch = { waterBillingType: 'tiered' };

      const effectiveMode = normalizeUtilityBillingMode(patch.waterBillingType || currentMode);
      const candidateTiers = (patch as any).waterTierRates !== undefined ? (patch as any).waterTierRates : currentTiers;

      expect(() => validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: candidateTiers,
        utilityName: 'Water',
      })).toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Case B: tiered/valid -> patch unrelated field -> ACCEPT and preserve tiers', async () => {
      const repo = new InMemoryBillingSettingsRepository();
      const dormId = 'dorm-b';
      const validTiers = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: null, rate: '22.00' },
      ];

      await repo.create({
        dormitoryId: dormId,
        waterBillingType: 'tiered',
        waterTierRates: validTiers,
      });

      // Patch unrelated field
      const current = await repo.findByDormitoryId(dormId);
      const patch = { commonFee: '150.00' };

      const effectiveMode = normalizeUtilityBillingMode((patch as any).waterBillingType || current!.waterBillingType);
      const candidateTiers = (patch as any).waterTierRates !== undefined ? (patch as any).waterTierRates : current!.waterTierRates;

      const effectiveTiers = validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: candidateTiers,
      });
      expect(effectiveTiers).toEqual(validTiers);

      const updated = await repo.update(dormId, {
        commonFee: patch.commonFee,
        waterTierRates: effectiveTiers,
      });
      expect(updated?.waterTierRates).toEqual(validTiers);
      expect(updated?.commonFee).toBe('150.00');
    });

    it('Case C: tiered/valid -> patch waterTierRates=null -> REJECT', () => {
      const currentMode = 'tiered';
      const currentTiers = [{ upTo: null, rate: '18.00' }];
      const patch = { waterTierRates: null };

      const effectiveMode = normalizeUtilityBillingMode((patch as any).waterBillingType || currentMode);
      const candidateTiers = patch.waterTierRates !== undefined ? patch.waterTierRates : currentTiers;

      expect(() => validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: candidateTiers,
        utilityName: 'Water',
      })).toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Case D: non-tiered + inactive valid tiers -> switch to tiered -> ACCEPT and activate saved tiers', async () => {
      const repo = new InMemoryBillingSettingsRepository();
      const dormId = 'dorm-d';
      const savedInactiveTiers = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: null, rate: '22.00' },
      ];

      // Settings has per_unit but retains inactive waterTierRates
      await repo.create({
        dormitoryId: dormId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        waterTierRates: savedInactiveTiers,
      });

      const current = await repo.findByDormitoryId(dormId);
      const patch = { waterBillingType: 'tiered' };

      const effectiveMode = normalizeUtilityBillingMode(patch.waterBillingType || current!.waterBillingType);
      const candidateTiers = (patch as any).waterTierRates !== undefined ? (patch as any).waterTierRates : current!.waterTierRates;

      const effectiveTiers = validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: candidateTiers,
      });
      expect(effectiveTiers).toEqual(savedInactiveTiers);

      const updated = await repo.update(dormId, {
        waterBillingType: effectiveMode,
        waterTierRates: effectiveTiers,
      });
      expect(updated?.waterBillingType).toBe('tiered');
      expect(updated?.waterTierRates).toEqual(savedInactiveTiers);
    });

    it('Case H: snapshot tiered -> per_unit -> ACCEPT and snapshot tiers set to null', async () => {
      const repo = new InMemoryBillingCycleRepository();
      const dormId = 'dorm-h';

      const cycle = await repo.create(dormId, {
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
      });

      const snap = await repo.createRateSnapshot(dormId, {
        billingCycleId: cycle.id,
        waterBillingType: 'tiered',
        waterRate: '0.00',
        waterTierRates: [{ upTo: null, rate: '18.00' }],
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        source: 'TEMPLATE_DEFAULT',
      });
      expect(snap.waterTierRates).toEqual([{ upTo: null, rate: '18.00' }]);

      // Update snapshot mode to per_unit
      const patch = { waterBillingType: 'per_unit', waterRate: '18.00' };
      const effectiveMode = normalizeUtilityBillingMode(patch.waterBillingType);
      const effectiveTiers = validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: snap.waterTierRates,
      });
      expect(effectiveTiers).toBeNull();

      const updatedSnap = await repo.updateRateSnapshot(snap.id, dormId, {
        waterBillingType: effectiveMode,
        waterRate: patch.waterRate,
        waterTierRates: effectiveTiers,
      });
      expect(updatedSnap?.waterBillingType).toBe('per_unit');
      expect(updatedSnap?.waterTierRates).toBeNull();
    });
  });

  describe('Snapshot Creation & Inheritance Fail-Closed Checks (Cases E, F, G)', () => {
    it('Case E: snapshot creation with tiered mode but null settings tiers -> REJECT', () => {
      const settings = {
        waterBillingType: 'tiered',
        waterTierRates: null,
      };

      const waterBillingType = normalizeUtilityBillingMode(settings.waterBillingType);
      expect(() => validateUtilityTierModeConfiguration({
        mode: waterBillingType,
        tiers: settings.waterTierRates,
        utilityName: 'Water',
      })).toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Case F: snapshot inheritance from corrupt preceding snapshot (tiered + null tiers) -> REJECT', () => {
      const corruptPrecedingSnapshot = {
        waterBillingType: 'tiered',
        waterTierRates: null,
      };

      const waterBillingType = normalizeUtilityBillingMode(corruptPrecedingSnapshot.waterBillingType);
      expect(() => validateUtilityTierModeConfiguration({
        mode: waterBillingType,
        tiers: corruptPrecedingSnapshot.waterTierRates,
        utilityName: "Water (inherited from cycle '2026-07')",
      })).toThrow("INVALID_TIER_CONFIGURATION: Water (inherited from cycle '2026-07') billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Case G: snapshot manual update flat -> tiered without providing tier rates -> REJECT', () => {
      const currentSnapshot = {
        waterBillingType: 'per_unit',
        waterTierRates: null,
      };
      const patch = { waterBillingType: 'tiered' };

      const effectiveMode = normalizeUtilityBillingMode(patch.waterBillingType);
      const candidateTiers = (patch as any).waterTierRates !== undefined ? (patch as any).waterTierRates : currentSnapshot.waterTierRates;

      expect(() => validateUtilityTierModeConfiguration({
        mode: effectiveMode,
        tiers: candidateTiers,
        utilityName: 'Water',
      })).toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
    });
  });
});
