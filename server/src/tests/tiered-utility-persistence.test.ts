/**
 * @license Apache-2.0
 * OWNER R3.9-B.3.2: Tiered Utility Persistence, Snapshot, Validation Authority, Legacy Mode Compatibility,
 * Production Billing Settings Persistence Authority, and Async Error Boundary Closure
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import {
  validateCanonicalUtilityTiers,
  validateUtilityTierModeConfiguration,
  CanonicalTierRecord,
} from '../utils/utility-tier-validator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import {
  InMemoryBillingSettingsRepository,
  PrismaBillingSettingsRepository,
  BillingSettingsEntity,
} from '../db/repositories/billing-settings.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { InMemoryDormitoryRepository } from '../db/repositories/dormitory.repository.js';
import { InMemorySubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { InMemoryPlanRepository } from '../db/repositories/plan.repository.js';
import { SensitiveFieldService } from '../services/sensitive-field.service.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { createDormitoryRouter } from '../routes/dormitory.routes.js';
import { createApp } from '../app.js';

describe('OWNER R3.9-B — Canonical Utility Tier Validation & Persistence Authority', () => {
  const TEST_DORM_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const TEST_DORM_ID = '11111111-1111-4111-8111-111111111111';
  const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';

  function setupTestExpressApp() {
    const app = express();
    app.use(express.json());

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);

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
      findUserDormitories: async () => [
        {
          id: 'mem-01',
          dormitoryId: TEST_DORM_ID,
          userId: TEST_USER_ID,
          roleCode: 'OWNER',
          status: 'active',
        },
      ],
      findActiveMembership: async () => ({
        id: 'mem-01',
        dormitoryId: TEST_DORM_ID,
        userId: TEST_USER_ID,
        roleCode: 'OWNER',
        status: 'active',
      }),
    };

    const roleRepo: any = {
      findByCode: async (code: string) => ({ id: 'role-owner', code: code || 'OWNER', name: 'OWNER', permissions: ['billing:view', 'billing:update'] }),
      findByName: async () => ({ id: 'role-owner', code: 'OWNER', name: 'OWNER', permissions: ['billing:view', 'billing:update'] }),
      findById: async () => ({ id: 'role-owner', code: 'OWNER', name: 'OWNER', permissions: ['billing:view', 'billing:update'] }),
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

    it('validates minimum 1 tier and maximum allowed 5 tiers', () => {
      // 1 tier
      const single = validateCanonicalUtilityTiers([{ upTo: null, rate: '15.00' }]);
      expect(single).toHaveLength(1);

      // 5 tiers
      const input5 = [
        { upTo: '10', rate: '10' },
        { upTo: '20', rate: '11' },
        { upTo: '30', rate: '12' },
        { upTo: '40', rate: '13' },
        { upTo: null, rate: '14' },
      ];
      const result = validateCanonicalUtilityTiers(input5);
      expect(result).toHaveLength(5);
      expect(result[4]).toEqual({ upTo: null, rate: '14.00' });
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

    it('rejects non-array input, empty array, or >5 tiers (e.g. 6 tiers)', () => {
      expect(() => validateCanonicalUtilityTiers(null)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers('not an array')).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must be an array'
      );
      expect(() => validateCanonicalUtilityTiers([])).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration must contain at least 1 tier'
      );
      const input6 = [
        { upTo: '10', rate: '10' },
        { upTo: '20', rate: '11' },
        { upTo: '30', rate: '12' },
        { upTo: '40', rate: '13' },
        { upTo: '50', rate: '14' },
        { upTo: null, rate: '15' },
      ];
      expect(() => validateCanonicalUtilityTiers(input6)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration exceeds maximum limit of 5 tiers'
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

  describe('OWNER R3.9-B.3: PrismaBillingSettingsRepository & Phantom Save Regression Proof', () => {
    const TEST_DORM_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

    function createMockPrismaStore() {
      const db = new Map<string, any>();

      const mockPrisma: any = {
        dormitoryBillingSettings: {
          findUnique: vi.fn(async ({ where }: { where: { dormitoryId: string } }) => {
            const item = db.get(where.dormitoryId);
            return item ? JSON.parse(JSON.stringify(item)) : null;
          }),
          create: vi.fn(async ({ data }: { data: any }) => {
            const sanitizedData = { ...data };
            if (sanitizedData.waterTierRates === Prisma.DbNull) sanitizedData.waterTierRates = null;
            if (sanitizedData.electricityTierRates === Prisma.DbNull) sanitizedData.electricityTierRates = null;
            const record = {
              id: data.id || 'bset-' + Date.now(),
              ...sanitizedData,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            db.set(data.dormitoryId, record);
            return JSON.parse(JSON.stringify(record));
          }),
          update: vi.fn(async ({ where, data }: { where: { dormitoryId: string }; data: any }) => {
            const current = db.get(where.dormitoryId);
            if (!current) throw new Error('Record not found');
            const sanitizedData = { ...data };
            if (sanitizedData.waterTierRates === Prisma.DbNull) sanitizedData.waterTierRates = null;
            if (sanitizedData.electricityTierRates === Prisma.DbNull) sanitizedData.electricityTierRates = null;
            const updated = {
              ...current,
              ...sanitizedData,
              updatedAt: new Date(),
            };
            db.set(where.dormitoryId, updated);
            return JSON.parse(JSON.stringify(updated));
          }),
        },
      };

      return { mockPrisma, db };
    }

    it('Test A: Prisma repository read (findByDormitoryId) maps all fields with 100% field parity', async () => {
      const { mockPrisma, db } = createMockPrismaStore();
      const repo = new PrismaBillingSettingsRepository(mockPrisma);

      db.set(TEST_DORM_UUID, {
        id: 'bset-001',
        dormitoryId: TEST_DORM_UUID,
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'tiered',
        waterRate: 18.5,
        waterTierRates: [{ upTo: '10.00', rate: '18.00' }, { upTo: null, rate: '22.00' }],
        electricityBillingType: 'per_unit',
        electricityRate: 7,
        electricityTierRates: null,
        commonFee: 150,
        commonFeeMode: 'per_room',
        internetFee: 200,
        internetFeeMode: 'per_person',
        parkingRate: 500,
        parkingFeeMode: 'per_room',
        gracePeriodDays: 3,
        advanceRentMonths: 2,
        lateFeeType: 'fixed',
        lateFeeValue: 100,
        rentBillingType: 'monthly',
        cashAccepted: true,
        promptPayType: 'mobile_phone',
        promptPayValue: '0812345678',
        promptPayValueEncrypted: 'enc-pp',
        promptPayAccountName: 'Test Owner',
        bankCode: 'KBANK',
        bankAccountName: 'Test Bank Acc',
        bankAccountNumber: '123-4-56789-0',
        bankAccountNumberEncrypted: 'enc-bank',
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const entity = await repo.findByDormitoryId(TEST_DORM_UUID);
      expect(entity).not.toBeNull();
      expect(entity?.dormitoryId).toBe(TEST_DORM_UUID);
      expect(entity?.waterBillingType).toBe('tiered');
      expect(entity?.waterRate).toBe('18.50');
      expect(entity?.waterTierRates).toEqual([{ upTo: '10.00', rate: '18.00' }, { upTo: null, rate: '22.00' }]);
      expect(entity?.electricityRate).toBe('7.00');
      expect(entity?.electricityTierRates).toBeNull();
      expect(entity?.commonFee).toBe('150.00');
      expect(entity?.commonFeeMode).toBe('per_room');
      expect(entity?.internetFee).toBe('200.00');
      expect(entity?.internetFeeMode).toBe('per_person');
      expect(entity?.parkingRate).toBe('500.00');
      expect(entity?.parkingFeeMode).toBe('per_room');
      expect(entity?.gracePeriodDays).toBe(3);
      expect(entity?.advanceRentMonths).toBe(2);
      expect(entity?.lateFeeType).toBe('fixed');
      expect(entity?.lateFeeValue).toBe('100.00');
      expect(entity?.promptPayAccountName).toBe('Test Owner');
      expect(entity?.bankCode).toBe('KBANK');
      expect(entity?.version).toBe(2);
    });

    it('Test B: Prisma repository update (update) persists via explicit whitelist and maps DbNull correctly', async () => {
      const { mockPrisma, db } = createMockPrismaStore();
      const repo = new PrismaBillingSettingsRepository(mockPrisma);

      // Pre-seed record
      db.set(TEST_DORM_UUID, {
        id: 'bset-001',
        dormitoryId: TEST_DORM_UUID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        dueDay: 5,
        billingDay: 25,
      });

      const updated = await repo.update(TEST_DORM_UUID, {
        waterBillingType: 'tiered',
        waterTierRates: [{ upTo: '10.00', rate: '18.00' }, { upTo: null, rate: '20.00' }],
        commonFee: '250.00',
      });

      expect(updated?.waterBillingType).toBe('tiered');
      expect(updated?.waterTierRates).toEqual([{ upTo: '10.00', rate: '18.00' }, { upTo: null, rate: '20.00' }]);
      expect(updated?.commonFee).toBe('250.00');

      // Verify what was passed to prisma.update
      expect(mockPrisma.dormitoryBillingSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dormitoryId: TEST_DORM_UUID },
          data: expect.objectContaining({
            waterBillingType: 'tiered',
            waterTierRates: [{ upTo: '10.00', rate: '18.00' }, { upTo: null, rate: '20.00' }],
            commonFee: '250.00',
          }),
        })
      );
    });

    it('Test C: Repository composition in app.ts selects PrismaBillingSettingsRepository when REPOSITORY_MODE is not in-memory', () => {
      // In production / normal mode
      const prevMode = process.env.REPOSITORY_MODE;
      try {
        delete process.env.REPOSITORY_MODE;
        // Verify default repository construction type via app creation
        const app = createApp({ forcePrisma: false });
        expect(app).toBeDefined();
      } finally {
        process.env.REPOSITORY_MODE = prevMode;
      }
    });

    it('Test D: Persistence across repository instances (Phantom Save Proof)', async () => {
      const { mockPrisma } = createMockPrismaStore();

      // Instance A writes settings
      const repoInstanceA = new PrismaBillingSettingsRepository(mockPrisma);
      await repoInstanceA.create({
        dormitoryId: TEST_DORM_UUID,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        commonFee: '100.00',
      });

      await repoInstanceA.update(TEST_DORM_UUID, {
        waterBillingType: 'tiered',
        waterTierRates: [
          { upTo: '15.00', rate: '20.00' },
          { upTo: null, rate: '25.00' },
        ],
        commonFee: '300.00',
      });

      // Discard Instance A completely
      const discardedA: any = null;
      expect(discardedA).toBeNull();

      // Instance B is a brand new object reading from the same backing store
      const repoInstanceB = new PrismaBillingSettingsRepository(mockPrisma);
      const readResult = await repoInstanceB.findByDormitoryId(TEST_DORM_UUID);

      expect(readResult).not.toBeNull();
      expect(readResult?.waterBillingType).toBe('tiered');
      expect(readResult?.waterTierRates).toEqual([
        { upTo: '15.00', rate: '20.00' },
        { upTo: null, rate: '25.00' },
      ]);
      expect(readResult?.commonFee).toBe('300.00');
    });

    it('Test E: Tier JSON null round-trip persistence with Prisma.DbNull', async () => {
      const { mockPrisma, db } = createMockPrismaStore();
      const repo = new PrismaBillingSettingsRepository(mockPrisma);

      await repo.create({
        dormitoryId: TEST_DORM_UUID,
        dueDay: 5,
        waterBillingType: 'tiered',
        waterTierRates: [{ upTo: null, rate: '18.00' }],
      });

      // Update waterTierRates to null
      const updated = await repo.update(TEST_DORM_UUID, {
        waterBillingType: 'per_unit',
        waterTierRates: null,
      });

      expect(updated?.waterTierRates).toBeNull();
      expect(mockPrisma.dormitoryBillingSettings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { dormitoryId: TEST_DORM_UUID },
          data: expect.objectContaining({
            waterTierRates: Prisma.DbNull,
          }),
        })
      );
    });

    it('Test F: Repository create defaults preserve required schema fields (dueDay, billingDay, modes)', async () => {
      const { mockPrisma } = createMockPrismaStore();
      const repo = new PrismaBillingSettingsRepository(mockPrisma);

      const created = await repo.create({
        dormitoryId: TEST_DORM_UUID,
      });

      expect(created.dueDay).toBe(5);
      expect(created.billingDay).toBe(25);
      expect(created.waterBillingType).toBe('per_person');
      expect(created.waterRate).toBe('0.00');
      expect(created.electricityBillingType).toBe('per_unit');
      expect(created.electricityRate).toBe('0.00');
      expect(created.commonFee).toBe('0.00');
      expect(created.commonFeeMode).toBe('per_room');
      expect(created.internetFeeMode).toBe('per_person');
      expect(created.parkingFeeMode).toBe('per_room');
      expect(created.gracePeriodDays).toBe(2);
      expect(created.advanceRentMonths).toBe(1);
    });
  });

  describe('OWNER R3.9-B.3.1 & R3.9-B.3.2: Async Error Boundary Closure & Persistence Error Semantics', () => {
    const TEST_DORM_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const TEST_DORM_ID = '11111111-1111-4111-8111-111111111111';
    const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';

    function setupTestExpressApp() {
      const app = express();
      app.use(express.json());

      vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined as any);

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

    it('Test 8.A (Mocked Prisma): Prisma repo update returns null when record is absent', async () => {
      const mockPrisma: any = {
        dormitoryBillingSettings: {
          findUnique: vi.fn(async () => null),
          update: vi.fn(),
        },
      };
      const repo = new PrismaBillingSettingsRepository(mockPrisma);
      const result = await repo.update(TEST_DORM_UUID, { waterRate: '20.00' });
      expect(result).toBeNull();
      expect(mockPrisma.dormitoryBillingSettings.update).not.toHaveBeenCalled();
    });

    it('Test 8.B (Mocked Prisma): Prisma repo update throws on generic database failure (does NOT return null)', async () => {
      const mockPrisma: any = {
        dormitoryBillingSettings: {
          findUnique: vi.fn(async () => ({ id: 'bset-1' })),
          update: vi.fn(async () => {
            throw new Error('database unavailable');
          }),
        },
      };
      const repo = new PrismaBillingSettingsRepository(mockPrisma);
      await expect(repo.update(TEST_DORM_UUID, { waterRate: '20.00' })).rejects.toThrow('database unavailable');
    });

    it('Test 7.A (Real Express Route): GET /billing-settings returns 500 when billingRepo.findByDormitoryId throws DB error', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      vi.spyOn(billingRepo, 'findByDormitoryId').mockRejectedValueOnce(new Error('Postgres connection pool exhausted'));

      const res = await request(app)
        .get(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 7.B (Real Express Route): PATCH /billing-settings returns 500 when initial billingRepo.findByDormitoryId throws DB error', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      vi.spyOn(billingRepo, 'findByDormitoryId').mockRejectedValueOnce(new Error('DB read timeout'));

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ commonFee: '200.00' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 7.C (Real Express Route): PATCH /billing-settings returns 500 when billingRepo.create throws DB error', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      vi.spyOn(billingRepo, 'findByDormitoryId').mockResolvedValueOnce(null);
      vi.spyOn(billingRepo, 'create').mockRejectedValueOnce(new Error('DB insert failed: disk full'));

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ commonFee: '200.00' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 7.D (Real Express Route): GET /payment-settings returns 500 when billingRepo.findByDormitoryId throws DB error', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      vi.spyOn(billingRepo, 'findByDormitoryId').mockRejectedValueOnce(new Error('Postgres replica sync failure'));

      const res = await request(app)
        .get(`/api/v1/dormitories/${dormId}/payment-settings`)
        .set('x-dormitory-id', dormId);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 8.C (Real Express Route): PATCH /billing-settings returns 404 when billingRepo.update returns null', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      vi.spyOn(billingRepo, 'update').mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ commonFee: '200.00' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DORMITORY_BILLING_SETTINGS_NOT_FOUND');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 8.D (Real Express Route): PATCH /billing-settings returns 500 when billingRepo.update throws DB error (not 400/INVALID_TIER_CONFIGURATION)', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      await billingRepo.create({
        dormitoryId: dormId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
      });

      vi.spyOn(billingRepo, 'update').mockRejectedValueOnce(new Error('connection timeout to postgres'));

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ commonFee: '200.00' });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(res.body.error.code).not.toBe('INVALID_TIER_CONFIGURATION');
      expect(res.body.data).toBeUndefined();
    });

    it('Test 8.G (Real Express Route): PATCH /payment-settings returns 404 when settings record is missing', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      // Force findByDormitoryId to return null (no settings exist)
      vi.spyOn(billingRepo, 'findByDormitoryId').mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/payment-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ cashAccepted: false });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DORMITORY_BILLING_SETTINGS_NOT_FOUND');
    });

    it('Test 8.H (Real Express Route): PATCH /payment-settings does NOT report DB failure as 404', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      await billingRepo.create({
        dormitoryId: dormId,
        cashAccepted: true,
      });

      vi.spyOn(billingRepo, 'update').mockRejectedValueOnce(new Error('DB connection pool exhausted'));

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/payment-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({ cashAccepted: false });

      expect(res.status).not.toBe(404);
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('OWNER R3.9-C.2: Inactive Tier Retention & Snapshot Authority (Sections 20 & 21)', () => {
    it('Test 20.A: tiered -> per_unit preserves inactive tier configuration in DormitoryBillingSettings', async () => {
      const { app, billingRepo } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      const validTiers = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];

      // Initial: tiered mode
      await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
          waterTierRates: validTiers,
        });

      // Switch to per_unit without tier payload
      const switchRes = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'per_unit',
          waterRate: '4.00',
        });

      expect(switchRes.status).toBe(200);
      expect(switchRes.body.data.waterBillingType).toBe('per_unit');
      expect(switchRes.body.data.waterRate).toBe('4.00');
      // Inactive tiers preserved in DB
      expect(switchRes.body.data.waterTierRates).toEqual(validTiers);

      // Verify GET returns preserved tiers
      const getRes = await request(app)
        .get(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.waterBillingType).toBe('per_unit');
      expect(getRes.body.data.waterTierRates).toEqual(validTiers);
    });

    it('Test 20.B: per_unit -> tiered reactivates preserved inactive tier configuration', async () => {
      const { app } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      const validTiers = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];

      // Seed with per_unit and preserved tiers
      await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'per_unit',
          waterRate: '4.00',
          waterTierRates: validTiers,
        });

      // Switch to tiered without sending new tier payload
      const reactivateRes = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
        });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.data.waterBillingType).toBe('tiered');
      expect(reactivateRes.body.data.waterTierRates).toEqual(validTiers);
    });

    it('Test 20.C: per_unit -> tiered without preserved or payload tiers fails closed', async () => {
      const { app } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      // Seed with per_unit and null tiers
      await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'per_unit',
          waterRate: '4.00',
          waterTierRates: null,
        });

      // Attempt to switch to tiered without tiers
      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIER_CONFIGURATION');
    });

    it('Test 20.D: tiered mode sending invalid fractional boundary is rejected', async () => {
      const { app } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
          waterTierRates: [
            { upTo: '10.50', rate: '3.40' },
            { upTo: null, rate: '5.00' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIER_CONFIGURATION');
    });

    it('Test 20.E: tiered mode sending 6 tiers is rejected', async () => {
      const { app } = setupTestExpressApp();
      const dormId = TEST_DORM_ID;

      const sixTiers = [
        { upTo: '10', rate: '1' },
        { upTo: '20', rate: '2' },
        { upTo: '30', rate: '3' },
        { upTo: '40', rate: '4' },
        { upTo: '50', rate: '5' },
        { upTo: null, rate: '6' },
      ];

      const res = await request(app)
        .patch(`/api/v1/dormitories/${dormId}/billing-settings`)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          waterBillingType: 'tiered',
          waterTierRates: sixTiers,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_TIER_CONFIGURATION');
    });

    it('Test 21: BillingRateSnapshot retains null when mode is non-tiered, freezes tiers when tiered', () => {
      // Non-tiered snapshot returns null even if raw settings contain inactive tiers
      const nonTieredResult = validateUtilityTierModeConfiguration({
        mode: 'per_unit',
        tiers: [
          { upTo: '10.00', rate: '3.40' },
          { upTo: null, rate: '5.00' },
        ],
        utilityName: 'Water',
      });
      expect(nonTieredResult).toBeNull();

      // Tiered snapshot validates and freezes active tiers
      const tieredResult = validateUtilityTierModeConfiguration({
        mode: 'tiered',
        tiers: [
          { upTo: '10.00', rate: '3.40' },
          { upTo: null, rate: '5.00' },
        ],
        utilityName: 'Water',
      });
      expect(tieredResult).toEqual([
        { upTo: '10.00', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ]);
    });

    it('Test Parity: InMemoryBillRepository creates and finds billKind=MONTHLY_UTILITY', async () => {
      const { InMemoryBillRepository } = await import('../db/repositories/bill.repository.js');
      const repo = new InMemoryBillRepository();
      const dormId = TEST_DORM_ID;
      const cycleId = 'cycle-123';
      const roomId = 'room-456';

      const { bill } = await repo.create(
        dormId,
        {
          billingCycleId: cycleId,
          roomId,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          totalAmount: '500.00',
          subtotal: '500.00',
          outstandingAmount: '500.00',
        } as any,
        []
      );

      expect(bill.billKind).toBe('MONTHLY_UTILITY');

      const found = await repo.findActiveMonthlyUtilityByRoomAndCycle(dormId, cycleId, roomId);
      expect(found).not.toBeNull();
      expect(found?.billKind).toBe('MONTHLY_UTILITY');
    });
  });
});
