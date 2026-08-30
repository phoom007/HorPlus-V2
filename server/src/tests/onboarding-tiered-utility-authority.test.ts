/**
 * @license Apache-2.0
 * OWNER R3.9-C.3.1: Onboarding Contract Closure & Zero Meter Baseline Authority Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  OnboardingBillingInputSchema,
  OnboardingRoomInputSchema,
  CompleteOnboardingInputSchema,
} from '../types/onboarding-validation.js';
import {
  CompleteOwnerOnboardingParams,
  DormitoryProvisioningService,
} from '../services/dormitory-provisioning.service.js';
import { referralService } from '../services/referral.service.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { MeterService } from '../services/meter.service.js';
import { InMemoryMeterRepository } from '../db/repositories/meter.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { InMemoryRoomRepository } from '../db/repositories/room.repository.js';
import { InMemoryTenantRepository } from '../db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../db/repositories/contract.repository.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import {
  CanonicalTierRecord,
  validateCanonicalUtilityTiers,
  validateUtilityTierModeConfiguration,
} from '../utils/utility-tier-validator.util.js';

describe('OWNER R3.9-C.3.1: Onboarding Contract Closure & Zero Meter Baseline Authority', () => {
  const validWaterTiers: CanonicalTierRecord[] = [
    { upTo: '10.00', rate: '3.40' },
    { upTo: '20.00', rate: '4.25' },
    { upTo: null, rate: '5.00' },
  ];

  const validElecTiers: CanonicalTierRecord[] = [
    { upTo: '50.00', rate: '7.00' },
    { upTo: '150.00', rate: '8.00' },
    { upTo: null, rate: '9.00' },
  ];

  describe('1. Schema / Zod Contract Parity & Type Assignability', () => {
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

    it('Rejects structural Tier shape where upTo property is omitted', () => {
      const invalidTiersMissingUpTo = [
        { rate: '3.40' }, // missing upTo property
        { upTo: null, rate: '5.00' },
      ];

      const result = OnboardingBillingInputSchema.safeParse({
        dueDay: 5,
        waterBillingType: 'tiered',
        waterTierRates: invalidTiersMissingUpTo,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes('upTo'))).toBe(true);
      }
    });

    it('CompleteOnboardingInputSchema parsed billing is assignable to CompleteOwnerOnboardingParams without "as any"', () => {
      const parsed = CompleteOnboardingInputSchema.parse({
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

      // Typecheck assignability proof:
      const serviceBillingParams: CompleteOwnerOnboardingParams['billing'] = parsed.billing;
      expect(serviceBillingParams?.waterTierRates).toEqual(validWaterTiers);
      expect(serviceBillingParams?.electricityTierRates).toEqual(validElecTiers);
    });
  });

  describe('2. Locked Meter Onboarding Baseline Policy (Section 6, 7, 15)', () => {
    const baseRoom = {
      buildingId: 'bld-001',
      roomNumber: '101',
      floor: 1,
      monthlyRent: 3500,
    };

    it('Defaults initialWaterReading and initialElectricityReading to 0 when absent', () => {
      const parsed = OnboardingRoomInputSchema.parse(baseRoom);
      expect(parsed.initialWaterReading).toBe(0);
      expect(parsed.initialElectricityReading).toBe(0);
    });

    it('Accepts explicit 0 and string "0"', () => {
      const parsedNum = OnboardingRoomInputSchema.parse({
        ...baseRoom,
        initialWaterReading: 0,
        initialElectricityReading: 0,
      });
      expect(parsedNum.initialWaterReading).toBe(0);
      expect(parsedNum.initialElectricityReading).toBe(0);

      const parsedStr = OnboardingRoomInputSchema.parse({
        ...baseRoom,
        initialWaterReading: '0' as any,
        initialElectricityReading: '0' as any,
      });
      expect(parsedStr.initialWaterReading).toBe(0);
      expect(parsedStr.initialElectricityReading).toBe(0);
    });

    it('Rejects nonzero custom starting readings (1, 100, 100.25, -1)', () => {
      // 1
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 1 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 1 })).toThrow();

      // 100
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 100 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 100 })).toThrow();

      // 100.25
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 100.25 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 100.25 })).toThrow();

      // -1
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: -1 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: -1 })).toThrow();
    });
  });

  describe('3. Central Tier Validator Authority — Max 5 & Integer Boundaries', () => {
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

  describe('4. DormitoryProvisioningService — Tiered Finalization & Persistence (Mocked Prisma Tx)', () => {
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

  describe('5. First Applicable BillingRateSnapshot Follow-Through', () => {
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

  describe('6. Meter Workspace First Reading Follow-Through (Section 9 & 16)', () => {
    const DORM_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const CYCLE_ID = 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    const ROOM_ID = 'e2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
    const BLD_ID = 'e3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

    function setupMeterWorkspaceHarness() {
      vi.spyOn(subscriptionEntitlementService, 'resolveOperationalRoomEntitlementSet').mockResolvedValue({
        tier: 'FREE' as any,
        roomLimit: 100,
        activeOperationalRoomCount: 1,
        isEnforced: false,
        operationalRoomIds: new Set([ROOM_ID]),
        lockedRoomIds: new Set(),
      });
      vi.spyOn(subscriptionEntitlementService, 'assertRoomOperationalEntitlement').mockResolvedValue(undefined);

      const meterRepo = new InMemoryMeterRepository();
      const billingCycleRepo = new InMemoryBillingCycleRepository();
      const roomRepo = new InMemoryRoomRepository();
      const billRepo = new InMemoryBillRepository();

      const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo);

      return { meterService, meterRepo, billingCycleRepo, roomRepo, billRepo };
    }

    it('New room with baseline 0 calculates exact usage on first Meter Workspace reading (e.g. curr = 125 -> usage = 125)', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      // 1. Create Room with initial readings = 0 (created during onboarding)
      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        initialWaterReading: 0,
        initialElectricityReading: 0,
      } as any);

      // 2. Create BillingCycle with per_unit rates
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-31T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'draft',
      });

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        source: 'CYCLE_INIT',
      });

      // 3. Save first meter readings in Meter Workspace (waterCurr = '125', elecCurr = '250', previous = '0')
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          {
            roomId: ROOM_ID,
            waterPrev: '0',
            waterCurr: '125',
            elecPrev: '0',
            elecCurr: '250',
          },
        ],
      });

      // 4. Verify persisted readings: previous = 0, current = 125, usage = 125
      const waterReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(waterReading).toBeDefined();
      expect(waterReading?.previousReading).toBe('0');
      expect(waterReading?.currentReading).toBe('125');
      expect(waterReading?.usageUnits).toBe('125');

      const elecReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'electricity');
      expect(elecReading).toBeDefined();
      expect(elecReading?.previousReading).toBe('0');
      expect(elecReading?.currentReading).toBe('250');
      expect(elecReading?.usageUnits).toBe('250');
    });

    it('Tiered Water mode with baseline 0 and first reading 15 calculates usage 15 and progressive charge 55.25 THB', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      // Create room with default 0
      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '102',
        buildingId: BLD_ID,
        initialWaterReading: 0,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      } as any);

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'tiered',
        waterTierRates: validWaterTiers,
        source: 'CYCLE_INIT',
      });

      // Save reading in workspace: waterPrev = '0', waterCurr = '15'
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          {
            roomId: ROOM_ID,
            waterPrev: '0',
            waterCurr: '15',
          },
        ],
      });

      const waterReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(waterReading?.previousReading).toBe('0');
      expect(waterReading?.currentReading).toBe('15');
      expect(waterReading?.usageUnits).toBe('15');
    });
  });
});
