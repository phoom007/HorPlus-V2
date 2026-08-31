/**
 * @license Apache-2.0
 * Rate Snapshot Schema Contract Test (Round 1.2.1)
 */

import { describe, it, expect } from 'vitest';
import { UpdateCycleRateSnapshotSchema } from '../../routes/billing-cycle.routes.js';

describe('UpdateCycleRateSnapshotSchema Canonical Mode Contract', () => {
  it('accepts waterBillingType = "fixed" with valid rate', () => {
    const validWaterFixed = {
      expectedVersion: 1,
      waterBillingType: 'fixed',
      waterRate: '150.00',
    };
    const result = UpdateCycleRateSnapshotSchema.safeParse(validWaterFixed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.waterBillingType).toBe('fixed');
      expect(result.data.waterRate).toBe('150.00');
    }
  });

  it('accepts electricityBillingType = "fixed" with valid rate', () => {
    const validElectricityFixed = {
      expectedVersion: 1,
      electricityBillingType: 'fixed',
      electricityRate: '300.00',
    };
    const result = UpdateCycleRateSnapshotSchema.safeParse(validElectricityFixed);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.electricityBillingType).toBe('fixed');
      expect(result.data.electricityRate).toBe('300.00');
    }
  });

  it('accepts all canonical utility modes: per_unit, per_person, fixed, tiered', () => {
    const canonicalModes = ['per_unit', 'per_person', 'fixed', 'tiered'] as const;
    for (const mode of canonicalModes) {
      const parsedWater = UpdateCycleRateSnapshotSchema.safeParse({
        expectedVersion: 1,
        waterBillingType: mode,
        waterRate: '20.00',
      });
      expect(parsedWater.success).toBe(true);

      const parsedElectric = UpdateCycleRateSnapshotSchema.safeParse({
        expectedVersion: 1,
        electricityBillingType: mode,
        electricityRate: '8.00',
      });
      expect(parsedElectric.success).toBe(true);
    }
  });

  it('rejects flat_rate and legacy aliases (proving fixed is required by canonical API)', () => {
    const nonCanonicalWater = {
      expectedVersion: 1,
      waterBillingType: 'flat_rate',
      waterRate: '150.00',
    };
    const resultWater = UpdateCycleRateSnapshotSchema.safeParse(nonCanonicalWater);
    expect(resultWater.success).toBe(false);

    const nonCanonicalElectric = {
      expectedVersion: 1,
      electricityBillingType: 'flat_rate',
      electricityRate: '300.00',
    };
    const resultElectric = UpdateCycleRateSnapshotSchema.safeParse(nonCanonicalElectric);
    expect(resultElectric.success).toBe(false);

    const nonCanonicalRoom = {
      expectedVersion: 1,
      waterBillingType: 'room',
      waterRate: '150.00',
    };
    const resultRoom = UpdateCycleRateSnapshotSchema.safeParse(nonCanonicalRoom);
    expect(resultRoom.success).toBe(false);
  });
});
