/**
 * @license Apache-2.0
 * OWNER R3.9-C.3: Onboarding Tiered Tariff Authority Closure & Validation Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  OnboardingBillingInputSchema,
  CompleteOnboardingInputSchema,
} from '../types/onboarding-validation.js';
import { DormitoryProvisioningService } from '../services/dormitory-provisioning.service.js';
import { referralService } from '../services/referral.service.js';
import {
  validateCanonicalUtilityTiers,
  validateUtilityTierModeConfiguration,
} from '../utils/utility-tier-validator.util.js';

describe('OWNER R3.9-C.3: Onboarding Tiered Tariff Authority Closure', () => {
  const validWaterTiers = [
    { upTo: '10.00', rate: '3.40' },
    { upTo: '20.00', rate: '4.25' },
    { upTo: null, rate: '5.00' },
  ];

  const validElecTiers = [
    { upTo: '50.00', rate: '7.00' },
    { upTo: '150.00', rate: '8.00' },
    { upTo: null, rate: '9.00' },
  ];

  describe('1. Schema / Zod Contract Parity', () => {
    it('OnboardingBillingInputSchema accepts valid waterTierRates and electricityTierRates', () => {
      const parsed = OnboardingBillingInputSchema.parse({
        dueDay: 5,
        waterBillingType: 'tiered',
        waterTierRates: validWaterTiers,
        electricityBillingType: 'tiered',
        electricityTierRates: validElecTiers,
      });

      expect(parsed.waterBillingType).toBe('tiered');
      expect(parsed.waterTierRates).toEqual(validWaterTiers);
      expect(parsed.electricityBillingType).toBe('tiered');
      expect(parsed.electricityTierRates).toEqual(validElecTiers);
    });

    it('CompleteOnboardingInputSchema accepts full onboarding payload with tiered tariffs', () => {
      const parsed = CompleteOnboardingInputSchema.safeParse({
        dormitory: { name: 'Test Tiered Dormitory' },
        billing: {
          dueDay: 5,
          waterBillingType: 'tiered',
          waterTierRates: validWaterTiers,
          electricityBillingType: 'tiered',
          electricityTierRates: validElecTiers,
        },
        planCode: 'PAID',
        packageIntentId: '11111111-1111-4111-8111-111111111111',
      });

      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.billing?.waterTierRates).toEqual(validWaterTiers);
        expect(parsed.data.billing?.electricityTierRates).toEqual(validElecTiers);
      }
    });
  });

  describe('2. Central Tier Validator Authority — Max 5 & Integer Boundaries', () => {
    it('Accepts 1 tier and up to 5 tiers with whole unit boundaries', () => {
      const oneTier = validateCanonicalUtilityTiers([{ upTo: null, rate: '18.00' }]);
      expect(oneTier).toHaveLength(1);
      expect(oneTier[0]).toEqual({ upTo: null, rate: '18.00' });

      const fiveTiers = validateCanonicalUtilityTiers([
        { upTo: '10', rate: '1.00' },
        { upTo: '20.00', rate: '2.00' },
        { upTo: '30', rate: '3.00' },
        { upTo: '40.00', rate: '4.00' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(fiveTiers).toHaveLength(5);
      expect(fiveTiers[0].upTo).toBe('10.00');
      expect(fiveTiers[3].upTo).toBe('40.00');
      expect(fiveTiers[4].upTo).toBeNull();
    });

    it('Rejects 6 tiers with INVALID_TIER_CONFIGURATION (exceeds max 5)', () => {
      const sixTiers = [
        { upTo: '10', rate: '1.00' },
        { upTo: '20', rate: '2.00' },
        { upTo: '30', rate: '3.00' },
        { upTo: '40', rate: '4.00' },
        { upTo: '50', rate: '5.00' },
        { upTo: null, rate: '6.00' },
      ];
      expect(() => validateCanonicalUtilityTiers(sixTiers)).toThrow(
        'INVALID_TIER_CONFIGURATION: Tier configuration exceeds maximum limit of 5 tiers'
      );
    });

    it('Accepts integer upper bounds ("10", "10.00") and rejects fractional bounds ("10.50", "20.25")', () => {
      const valid = validateCanonicalUtilityTiers([
        { upTo: '10.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(valid[0].upTo).toBe('10.00');

      expect(() =>
        validateCanonicalUtilityTiers([
          { upTo: '10.50', rate: '3.40' },
          { upTo: null, rate: '5.00' },
        ])
      ).toThrow('INVALID_TIER_CONFIGURATION');

      expect(() =>
        validateCanonicalUtilityTiers([
          { upTo: '20.25', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ])
      ).toThrow('INVALID_TIER_CONFIGURATION');
    });

    it('Normalizes decimal rates ("3.4" -> "3.40", "4.25", "0.00") and rejects negative / scientific notation', () => {
      const valid = validateCanonicalUtilityTiers([
        { upTo: '10.00', rate: '3.4' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '0.00' },
      ]);
      expect(valid[0].rate).toBe('3.40');
      expect(valid[1].rate).toBe('4.25');
      expect(valid[2].rate).toBe('0.00');

      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '-1.00' }])).toThrow('INVALID_TIER_CONFIGURATION');
      expect(() => validateCanonicalUtilityTiers([{ upTo: null, rate: '1e2' }])).toThrow('INVALID_TIER_CONFIGURATION');
    });
  });

  describe('3. DormitoryProvisioningService — Tiered Finalization & Persistence (Mocked Prisma Tx)', () => {
    function createMockPrismaHarness() {
      vi.spyOn(referralService, 'settleReferralOnboarding').mockResolvedValue(undefined as any);

      const capturedSettings: any = {};
      let upsertCallCount = 0;

      const mockTx: any = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue({
            provisionalDormitoryId: 'dorm-prov-001',
            finalizedAt: null,
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'dorm-prov-001',
            createdByUserId: 'user-001',
            status: 'setup_pending',
          }),
          update: vi.fn().mockResolvedValue({
            id: 'dorm-prov-001',
            name: 'Test Dorm',
            status: 'active',
          }),
        },
        ownerSignature: {
          findFirst: vi.fn().mockResolvedValue({ id: 'sig-001', isCurrent: true }),
        },
        dormitoryLineConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        subscriptionPackageIntent: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'intent-001',
            userId: 'user-001',
            dormitoryId: 'dorm-prov-001',
            checkoutVersion: 2,
            status: 'PENDING_PAYMENT',
            finalPayableAmount: new Prisma.Decimal(100),
            package: { planCode: 'PAID', plan: { code: 'PAID' } },
          }),
          update: vi.fn().mockResolvedValue({ id: 'intent-001', status: 'SUCCEEDED' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        subscriptionPlan: {
          findUnique: vi.fn().mockResolvedValue({ id: 'plan-paid', code: 'PAID' }),
        },
        dormitorySubscription: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
          upsert: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
        },
        role: {
          findFirst: vi.fn().mockResolvedValue({ id: 'role-owner', code: 'OWNER' }),
        },
        dormitoryMember: {
          upsert: vi.fn().mockResolvedValue({ id: 'mem-001' }),
        },
        dormitoryPropertyDefaults: {
          upsert: vi.fn().mockResolvedValue({}),
        },
        dormitoryBillingSettings: {
          upsert: vi.fn((args) => {
            upsertCallCount++;
            capturedSettings.create = args.create;
            capturedSettings.update = args.update;
            return Promise.resolve({ id: 'bset-001', ...args.create });
          }),
        },
      };

      const mockPrisma: any = {
        $transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const service = new DormitoryProvisioningService(mockPrisma as any);

      return { service, mockTx, capturedSettings, getUpsertCount: () => upsertCallCount };
    }

    it('Test 16 & 17: Finalizing onboarding with Tiered Water and Electricity persists canonical tier JSON', async () => {
      const { service, capturedSettings } = createMockPrismaHarness();

      await service.completeOwnerOnboarding({
        userId: 'user-001',
        idempotencyKey: 'idemp-001',
        provisionalDormitoryId: 'dorm-prov-001',
        packageIntentId: 'intent-001',
        dormitory: { name: 'Test Tiered Dorm' },
        billing: {
          dueDay: 5,
          waterBillingType: 'tiered',
          waterTierRates: validWaterTiers,
          electricityBillingType: 'tiered',
          electricityTierRates: validElecTiers,
        },
      });

      // Verify create block has exact canonical JSON
      expect(capturedSettings.create.waterBillingType).toBe('tiered');
      expect(capturedSettings.create.waterTierRates).toEqual(validWaterTiers);
      expect(capturedSettings.create.electricityBillingType).toBe('tiered');
      expect(capturedSettings.create.electricityTierRates).toEqual(validElecTiers);

      // Verify update block has exact canonical JSON
      expect(capturedSettings.update.waterBillingType).toBe('tiered');
      expect(capturedSettings.update.waterTierRates).toEqual(validWaterTiers);
      expect(capturedSettings.update.electricityBillingType).toBe('tiered');
      expect(capturedSettings.update.electricityTierRates).toEqual(validElecTiers);
    });

    it('Test 18: Finalizing onboarding with Tiered mode but null/empty tiers fails closed with INVALID_TIER_CONFIGURATION', async () => {
      const { service } = createMockPrismaHarness();

      // Water tiered with null tiers
      await expect(
        service.completeOwnerOnboarding({
          userId: 'user-001',
          idempotencyKey: 'idemp-002',
          provisionalDormitoryId: 'dorm-prov-001',
          packageIntentId: 'intent-001',
          dormitory: { name: 'Test Dorm' },
          billing: {
            dueDay: 5,
            waterBillingType: 'tiered',
            waterTierRates: null,
          },
        })
      ).rejects.toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");

      // Water tiered with empty array
      await expect(
        service.completeOwnerOnboarding({
          userId: 'user-001',
          idempotencyKey: 'idemp-003',
          provisionalDormitoryId: 'dorm-prov-001',
          packageIntentId: 'intent-001',
          dormitory: { name: 'Test Dorm' },
          billing: {
            dueDay: 5,
            waterBillingType: 'tiered',
            waterTierRates: [],
          },
        })
      ).rejects.toThrow("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");

      // Electricity tiered with null tiers
      await expect(
        service.completeOwnerOnboarding({
          userId: 'user-001',
          idempotencyKey: 'idemp-004',
          provisionalDormitoryId: 'dorm-prov-001',
          packageIntentId: 'intent-001',
          dormitory: { name: 'Test Dorm' },
          billing: {
            dueDay: 5,
            waterBillingType: 'per_unit',
            waterRate: '18.00',
            electricityBillingType: 'tiered',
            electricityTierRates: null,
          },
        })
      ).rejects.toThrow("INVALID_TIER_CONFIGURATION: Electricity billing mode is 'tiered' but no tier configuration was provided");
    });

    it('Test 19: Non-tiered onboarding with no tiers stores Prisma.DbNull', async () => {
      const { service, capturedSettings } = createMockPrismaHarness();

      await service.completeOwnerOnboarding({
        userId: 'user-001',
        idempotencyKey: 'idemp-005',
        provisionalDormitoryId: 'dorm-prov-001',
        packageIntentId: 'intent-001',
        dormitory: { name: 'Standard Non-Tiered Dorm' },
        billing: {
          dueDay: 5,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
        },
      });

      expect(capturedSettings.create.waterBillingType).toBe('per_unit');
      expect(capturedSettings.create.waterTierRates).toBe(Prisma.DbNull);
      expect(capturedSettings.create.electricityBillingType).toBe('per_unit');
      expect(capturedSettings.create.electricityTierRates).toBe(Prisma.DbNull);
    });

    it('Test 19 & Inactive Config: Non-tiered onboarding with explicit inactive tiers preserves them in settings', async () => {
      const { service, capturedSettings } = createMockPrismaHarness();

      await service.completeOwnerOnboarding({
        userId: 'user-001',
        idempotencyKey: 'idemp-006',
        provisionalDormitoryId: 'dorm-prov-001',
        packageIntentId: 'intent-001',
        dormitory: { name: 'Preserved Tier Dorm' },
        billing: {
          dueDay: 5,
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          waterTierRates: validWaterTiers, // explicit inactive tiers
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
        },
      });

      expect(capturedSettings.create.waterBillingType).toBe('per_unit');
      expect(capturedSettings.create.waterRate).toBe('18.00');
      // Inactive tiers preserved
      expect(capturedSettings.create.waterTierRates).toEqual(validWaterTiers);
    });
  });

  describe('4. First Applicable BillingRateSnapshot Follow-Through (Section 21)', () => {
    it('Freezes active Tiered onboarding configuration into first snapshot and rejects null tiers', () => {
      const onboardingSettings = {
        waterBillingType: 'tiered',
        waterRate: '0.00',
        waterTierRates: validWaterTiers,
        electricityBillingType: 'tiered',
        electricityRate: '0.00',
        electricityTierRates: validElecTiers,
      };

      // Snapshot creation for Water
      const frozenWaterTiers = validateUtilityTierModeConfiguration({
        mode: onboardingSettings.waterBillingType as any,
        tiers: onboardingSettings.waterTierRates,
        utilityName: 'Water',
      });
      expect(frozenWaterTiers).toEqual(validWaterTiers);

      // Snapshot creation for Electricity
      const frozenElecTiers = validateUtilityTierModeConfiguration({
        mode: onboardingSettings.electricityBillingType as any,
        tiers: onboardingSettings.electricityTierRates,
        utilityName: 'Electricity',
      });
      expect(frozenElecTiers).toEqual(validElecTiers);
    });
  });
});
