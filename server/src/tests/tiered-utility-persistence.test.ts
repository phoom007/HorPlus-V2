/**
 * @license Apache-2.0
 * OWNER R3.9-B.2: Tiered Utility Persistence, Snapshot, Validation Authority, and Legacy Mode Compatibility Tests
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  validateCanonicalUtilityTiers,
  validateUtilityTierModeConfiguration,
  CanonicalTierRecord,
} from '../utils/utility-tier-validator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { InMemoryBillingSettingsRepository } from '../db/repositories/billing-settings.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { InMemoryDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { InMemorySubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { InMemoryPlanRepository } from '../db/repositories/plan.repository.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { createDormitoryRouter } from '../routes/dormitory.routes.js';

describe('OWNER R3.9-B.2 — Canonical Utility Tier Validation Authority', () => {
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

  describe('Billing Mode Normalizer Authority & Legacy Aliases (Section 8 Cases 1-3, 8)', () => {
    it('Case 1: normalizes legacy alias "flat" to canonical "fixed"', () => {
      expect(normalizeUtilityBillingMode('flat')).toBe('fixed');
      expect(normalizeUtilityBillingMode('FLAT')).toBe('fixed');
      expect(normalizeUtilityBillingMode(' Flat ')).toBe('fixed');
    });

    it('Case 2: normalizes legacy alias "flat_rate" to canonical "fixed"', () => {
      expect(normalizeUtilityBillingMode('flat_rate')).toBe('fixed');
      expect(normalizeUtilityBillingMode('flat-rate')).toBe('fixed');
      expect(normalizeUtilityBillingMode('flat rate')).toBe('fixed');
    });

    it('Case 3: normalizes legacy alias "fixed_monthly" to canonical "fixed"', () => {
      expect(normalizeUtilityBillingMode('fixed_monthly')).toBe('fixed');
      expect(normalizeUtilityBillingMode('fixed-monthly')).toBe('fixed');
      expect(normalizeUtilityBillingMode('fixed monthly')).toBe('fixed');
    });

    it('normalizes standard "fixed", "room", and "per_room" to canonical "fixed"', () => {
      expect(normalizeUtilityBillingMode('fixed')).toBe('fixed');
      expect(normalizeUtilityBillingMode('room')).toBe('fixed');
      expect(normalizeUtilityBillingMode('per_room')).toBe('fixed');
      expect(normalizeUtilityBillingMode('per-room')).toBe('fixed');
    });

    it('normalizes "per_unit", "unit", "per_person", "person", "tiered"', () => {
      expect(normalizeUtilityBillingMode('per_unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('per_person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('tiered')).toBe('tiered');
      expect(normalizeUtilityBillingMode('TIERED')).toBe('tiered');
    });

    it('Case 8: rejects unknown billing modes (fail-closed)', () => {
      expect(() => normalizeUtilityBillingMode('unknown_mode')).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode('custom')).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode(null)).toThrow('INVALID_BILLING_MODE');
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

  describe('Effective State Persistence & Inactive Retention', () => {
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

  describe('Real Path Route Integration: PATCH /api/v1/dormitories/:dormitoryId/billing-settings (Section 8 Cases 4, 5, 6, 7)', () => {
    const TEST_DORM_ID = '11111111-1111-4111-8111-111111111111';
    const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';

    function setupTestExpressApp() {
      const app = express();
      app.use(express.json());

      // Bypass subscription entitlement in test
      vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);

      // Simulate authenticated owner session context
      app.use((req: any, _res, next) => {
        req.cookies = req.cookies || {};
        req.cookies['horplus_session'] = 'valid-test-session';
        req.cookies['horplus_csrf'] = 'valid-csrf-token';
        req.headers['authorization'] = 'Bearer valid-test-session';
        next();
      });

      const authService: any = {
        validateSession: async () => ({
          user: { id: TEST_USER_ID, role: 'OWNER' },
          session: { id: 'sess-01', userId: TEST_USER_ID, tokenVersion: 1 },
          memberships: [
            { id: 'mem-01', dormitoryId: TEST_DORM_ID, userId: TEST_USER_ID, roleCode: 'OWNER', status: 'active' },
          ],
          rawSessionId: 'sess-01',
        }),
        verifyCsrf: () => true,
      };

      const dormitoryRepo = new InMemoryDormitoryRepository();
      const billingRepo = new InMemoryBillingSettingsRepository();
      const subRepo = new InMemorySubscriptionRepository();
      const planRepo = new InMemoryPlanRepository();
      const sensitiveFieldService = new SensitiveFieldService('12345678901234567890123456789012');

      const membershipRepo: any = {
        findByUserAndDormitory: async () => ({
          id: 'mem-01',
          dormitoryId: TEST_DORM_ID,
          userId: TEST_USER_ID,
          roleCode: 'OWNER',
          status: 'active',
        }),
        findByDormitoryAndUser: async () => ({
          id: 'mem-01',
          dormitoryId: TEST_DORM_ID,
          userId: TEST_USER_ID,
          roleCode: 'OWNER',
          status: 'active',
        }),
        findActiveByDormitoryAndUser: async () => ({
          id: 'mem-01',
          dormitoryId: TEST_DORM_ID,
          userId: TEST_USER_ID,
          roleCode: 'OWNER',
          status: 'active',
        }),
      };

      const roleRepo: any = {
        findByCode: async () => ({
          id: 'role-owner',
          code: 'OWNER',
          name: 'Owner',
          permissions: { '*': ['*'] },
        }),
      };

      const router = createDormitoryRouter(
        authService,
        dormitoryRepo,
        billingRepo,
        subRepo,
        planRepo,
        sensitiveFieldService,
        membershipRepo,
        roleRepo
      );

      app.use('/api/v1/dormitories', router);

      return { app, billingRepo, dormitoryRepo };
    }

    it('Case 4: existing "flat" + unrelated Settings patch -> accepted with canonical "fixed" via real Express route', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      // Seed database with legacy alias "flat"
      await billingRepo.create({
        dormitoryId: dormId,
        waterBillingType: 'flat',
        waterRate: '100.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      });

      // Send real HTTP PATCH request with unrelated field
      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ commonFee: '200.00' });

      expect(res.status).toBe(200);
      expect(res.body.data.waterBillingType).toBe('fixed'); // Correctly normalized to canonical 'fixed'
      expect(res.body.data.commonFee).toBe('200.00');
      expect(res.body.data.waterTierRates).toBeNull();
    });

    it('Case 5: existing "fixed_monthly" + unrelated Settings patch -> accepted with canonical "fixed" via real Express route', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      // Seed database with legacy alias "fixed_monthly"
      await billingRepo.create({
        dormitoryId: dormId,
        waterBillingType: 'fixed_monthly',
        waterRate: '150.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      });

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ lateFeeValue: '100.00' });

      expect(res.status).toBe(200);
      expect(res.body.data.waterBillingType).toBe('fixed');
      expect(res.body.data.lateFeeValue).toBe('100.00');
    });

    it('Case 6: candidate tiered + missing tiers -> rejected with 400 INVALID_TIER_CONFIGURATION via real Express route', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      await billingRepo.create({
        dormitoryId: dormId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
      });

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ waterBillingType: 'tiered' }); // Missing tiers

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIER_CONFIGURATION');
      expect(res.body.error.message).toContain("Water billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Case 7: candidate tiered + valid tiers -> accepted with 200 and persisted tiers via real Express route', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      await billingRepo.create({
        dormitoryId: dormId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
      });

      const validTiers = [
        { upTo: '10.00', rate: '18.00' },
        { upTo: '20.00', rate: '20.00' },
        { upTo: null, rate: '22.00' },
      ];

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
          waterTierRates: validTiers,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.waterBillingType).toBe('tiered');
      expect(res.body.data.waterTierRates).toEqual(validTiers);
    });
  });
});
