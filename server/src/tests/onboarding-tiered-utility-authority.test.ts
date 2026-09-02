/**
 * @license Apache-2.0
 * OWNER R3.9-C.3.2: First-Cycle Meter Workspace Authority Closure & Blank First Readings
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import * as prismaModule from '../db/prisma.js';
import {
  OnboardingBuildingInputSchema,
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
import { calculateProgressiveTieredCharge } from '../utils/progressive-tier-calculator.util.js';

describe('OWNER R3.9-C.3.2: First-Cycle Meter Workspace Authority Closure & Blank First Readings', () => {
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
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 1 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 1 })).toThrow();

      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 100 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 100 })).toThrow();

      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialWaterReading: 100.25 })).toThrow();
      expect(() => OnboardingRoomInputSchema.parse({ ...baseRoom, initialElectricityReading: 100.25 })).toThrow();

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

    it('Finalizing onboarding with Tiered Water and Electricity persists canonical tier JSON', async () => {
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

      expect(capturedSettings.create.waterBillingType).toBe('tiered');
      expect(capturedSettings.create.waterTierRates).toEqual(validWaterTiers);
      expect(capturedSettings.create.electricityBillingType).toBe('tiered');
      expect(capturedSettings.create.electricityTierRates).toEqual(validElecTiers);

      expect(capturedSettings.update.waterBillingType).toBe('tiered');
      expect(capturedSettings.update.waterTierRates).toEqual(validWaterTiers);
      expect(capturedSettings.update.electricityBillingType).toBe('tiered');
      expect(capturedSettings.update.electricityTierRates).toEqual(validElecTiers);
    });

    it('Finalizing onboarding with Tiered mode but null/empty tiers fails closed with INVALID_TIER_CONFIGURATION', async () => {
      const { service } = createMockPrismaHarness();

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

    it('Non-tiered onboarding with no tiers stores Prisma.DbNull', async () => {
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

    it('Non-tiered onboarding with explicit inactive tiers preserves them in settings', async () => {
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
          waterTierRates: validWaterTiers,
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
        },
      });

      expect(capturedSettings.create.waterBillingType).toBe('per_unit');
      expect(capturedSettings.create.waterRate).toBe('18.00');
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

      const frozenWaterTiers = validateUtilityTierModeConfiguration({
        mode: onboardingSettings.waterBillingType as any,
        tiers: onboardingSettings.waterTierRates,
        utilityName: 'Water',
      });
      expect(frozenWaterTiers).toEqual(validWaterTiers);

      const frozenElecTiers = validateUtilityTierModeConfiguration({
        mode: onboardingSettings.electricityBillingType as any,
        tiers: onboardingSettings.electricityTierRates,
        utilityName: 'Electricity',
      });
      expect(frozenElecTiers).toEqual(validElecTiers);
    });
  });

  describe('6. First-Cycle Meter Workspace Authority & Blank Readings (Sections 27–33)', () => {
    const DORM_ID = 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const CYCLE_ID = 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    const CYCLE_2_ID = 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a99';
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

      const snapshots = new Map<string, any>();
      const mockPrismaClient: any = {
        roomBillingCycleSnapshot: {
          findUnique: vi.fn(async ({ where }: any) => {
            const key = `${where.dormitory_billing_cycle_room_unique.dormitoryId}_${where.dormitory_billing_cycle_room_unique.billingCycleId}_${where.dormitory_billing_cycle_room_unique.roomId}`;
            return snapshots.get(key) || null;
          }),
          findMany: vi.fn(async ({ where }: any) => {
            const list: any[] = [];
            for (const [, v] of snapshots.entries()) {
              if (v.dormitoryId === where.dormitoryId && v.billingCycleId === where.billingCycleId) {
                list.push(v);
              }
            }
            return list;
          }),
          create: vi.fn(async ({ data }: any) => {
            const key = `${data.dormitoryId}_${data.billingCycleId}_${data.roomId}`;
            const snap = { id: `snap-${Date.now()}`, ...data, version: 1 };
            snapshots.set(key, snap);
            return snap;
          }),
          updateMany: vi.fn(async ({ where, data }: any) => {
            for (const [k, v] of snapshots.entries()) {
              if (v.id === where.id && v.version === where.version) {
                const updated = { ...v, ...data, version: v.version + 1 };
                snapshots.set(k, updated);
                return { count: 1 };
              }
            }
            return { count: 0 };
          }),
        },
        billingCycle: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn().mockResolvedValue([]),
        },
        meterReading: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        contract: {
          findMany: vi.fn().mockResolvedValue([]),
          findFirst: vi.fn().mockResolvedValue(null),
        },
        provisionalRentalTerm: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        dailyStay: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        tenant: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        tenantVehicle: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        tenantCoOccupant: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        bill: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        roomOperationalStatusChange: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };

      vi.spyOn(prismaModule, 'getPrismaClient').mockReturnValue(mockPrismaClient);

      const meterRepo = new InMemoryMeterRepository();
      const billingCycleRepo = new InMemoryBillingCycleRepository();
      const roomRepo = new InMemoryRoomRepository();
      const billRepo = new InMemoryBillRepository();

      const meterService = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo);

      return { meterService, meterRepo, billingCycleRepo, roomRepo, billRepo, snapshots, mockPrismaClient };
    }

    it('Test 27: Initial Read Model — Technical room zero reports previous as null (blank UX semantic)', async () => {
      const { meterService, roomRepo, billingCycleRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        initialWaterReading: 0,
        initialElectricityReading: 0,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-31T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'draft',
      });

      // Assert resolveAuthoritativePreviousReading returns null (not "0")
      const waterBaseline = await meterService.resolveAuthoritativePreviousReading(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      const elecBaseline = await meterService.resolveAuthoritativePreviousReading(DORM_ID, CYCLE_ID, ROOM_ID, 'electricity');
      expect(waterBaseline).toBeNull();
      expect(elecBaseline).toBeNull();
    });

    it('Test 28: First Save — Owner manually enters first previous and current readings (100 -> 125 & 2350 -> 2480)', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        initialWaterReading: 0,
        initialElectricityReading: 0,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
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

      // Owner enters first-cycle manual readings: water 100->125, elec 2350->2480, people 1
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          {
            roomId: ROOM_ID,
            waterPrev: '100',
            waterCurr: '125',
            elecPrev: '2350',
            elecCurr: '2480',
            peopleCount: 1,
          },
        ],
      });

      const waterReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(waterReading).toBeDefined();
      expect(waterReading?.previousReading).toBe('100');
      expect(waterReading?.currentReading).toBe('125');
      expect(waterReading?.usageUnits).toBe('25');

      const elecReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'electricity');
      expect(elecReading).toBeDefined();
      expect(elecReading?.previousReading).toBe('2350');
      expect(elecReading?.currentReading).toBe('2480');
      expect(elecReading?.usageUnits).toBe('130');

      // Auto-created devices must have initialReading = entered previous
      const waterDevice = await meterRepo.findDeviceByRoomAndType(DORM_ID, ROOM_ID, 'water');
      expect(waterDevice?.initialReading).toBe('100');

      const elecDevice = await meterRepo.findDeviceByRoomAndType(DORM_ID, ROOM_ID, 'electricity');
      expect(elecDevice?.initialReading).toBe('2350');
    });

    it('Test 29: Missing First Previous — Saving current reading without previous throws MISSING_PREVIOUS_METER_READING', async () => {
      const { meterService, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        initialWaterReading: 0,
        initialElectricityReading: 0,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      } as any);

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        source: 'CYCLE_INIT',
      });

      // Saving waterCurr without waterPrev on a room with no history must fail
      await expect(
        meterService.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            {
              roomId: ROOM_ID,
              waterCurr: '125',
            },
          ],
        })
      ).rejects.toThrow('กรุณาระบุค่ามิเตอร์น้ำเดิมสำหรับห้องนี้');
    });

    it('Test 30: Explicit Owner Zero — Owner explicitly entering previous = 0 is valid operational baseline', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
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
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        source: 'CYCLE_INIT',
      });

      // Owner explicitly enters waterPrev = 0, waterCurr = 15
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

    it('Test 31: Next Cycle — Cycle 2 resolves previous = 125 from Cycle 1, and rejects conflicting client previous = 100', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        initialWaterReading: 0,
      } as any);

      // Cycle 1: Aug 2026
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      } as any);

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        source: 'CYCLE_INIT',
      });

      // Cycle 1 reading saved: 100 -> 125
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, waterPrev: '100', waterCurr: '125' }],
      });

      // Cycle 2: Sep 2026
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_2_ID,
        cycleCode: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
      } as any);

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_2_ID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        source: 'CYCLE_INIT',
      });

      // Cycle 2 baseline resolved from Cycle 1 current reading
      const cycle2Baseline = await meterService.resolveAuthoritativePreviousReading(DORM_ID, CYCLE_2_ID, ROOM_ID, 'water');
      expect(cycle2Baseline).toBe('125');

      // Cycle 2 save with new current = 150 (previous omitted -> automatically uses 125)
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_2_ID,
        rows: [{ roomId: ROOM_ID, waterCurr: '150' }],
      });

      const cycle2Reading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_2_ID, ROOM_ID, 'water');
      expect(cycle2Reading?.previousReading).toBe('125');
      expect(cycle2Reading?.currentReading).toBe('150');
      expect(cycle2Reading?.usageUnits).toBe('25');

      // If client attempts to send conflicting waterPrev = 100 for Cycle 2, rejects with PREVIOUS_READING_CONFLICT
      await expect(
        meterService.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_2_ID,
          rows: [{ roomId: ROOM_ID, waterPrev: '100', waterCurr: '160' }],
        })
      ).rejects.toThrow('PREVIOUS_READING_CONFLICT');
    });

    it('Test 32: People Count Default and Preservation — Default 1 on first cycle, preserves explicit 0 or 3', async () => {
      const { meterService, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
      } as any);

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        source: 'CYCLE_INIT',
      });

      // 1. Default peopleCount when undefined in first workspace save -> 1
      const metaDefault = await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, waterPrev: '100', waterCurr: '120' }],
      });
      expect(metaDefault.savedRows[0].peopleCount).toBe(1);

      // 2. Explicit peopleCount = 0 -> preserved as 0
      const metaZero = await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, peopleCount: 0 }],
      });
      expect(metaZero.savedRows[0].peopleCount).toBe(0);

      // 3. Explicit peopleCount = 3 -> preserved as 3
      const metaThree = await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, peopleCount: 3 }],
      });
      expect(metaThree.savedRows[0].peopleCount).toBe(3);
    });

    it('Test 33: Tiered Progressive Calculation Proof — First cycle 100->115 computes usage 15 and 55.25 THB', async () => {
      const { meterService, meterRepo, billingCycleRepo, roomRepo } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '102',
        buildingId: BLD_ID,
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

      // Save reading in workspace: waterPrev = '100', waterCurr = '115'
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, waterPrev: '100', waterCurr: '115' }],
      });

      // MeterService proves usage 15
      const waterReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(waterReading?.previousReading).toBe('100');
      expect(waterReading?.currentReading).toBe('115');
      expect(waterReading?.usageUnits).toBe('15');

      // Canonical progressive calculator proves amount 55.25 THB
      const calcResult = calculateProgressiveTieredCharge({
        usageUnits: 15,
        tiers: validWaterTiers,
      });
      expect(calcResult.totalAmount).toBe('55.25');
      expect(calcResult.tierBreakdown).toEqual([
        { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
        { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
      ]);
    });

    it('Test 34: R3.9-C.3.3.1 Financial Preview First Cycle People Authority — Household 3 defaults to 100 THB (effective 1), updates to 300 THB on save=3, and 0 THB on save=0', async () => {
      const { meterService, billingCycleRepo, roomRepo, mockPrismaClient } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        monthlyRent: 3000,
      } as any);

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-31T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'draft',
      });

      // Water per_person @ 100.00 THB/person
      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'per_person',
        waterRate: '100.00',
        electricityBillingType: 'fixed',
        electricityRate: '0.00',
        source: 'CYCLE_INIT',
      });

      // Establish real household count = 3: 1 Tenant + 2 Co-occupants
      const TENANT_ID = 't-tenant-101';
      mockPrismaClient.contract.findMany.mockResolvedValue([
        {
          id: 'contract-101',
          dormitoryId: DORM_ID,
          roomId: ROOM_ID,
          tenantId: TENANT_ID,
          status: 'active',
          startDate: new Date('2026-08-01T00:00:00.000Z'),
          endDate: new Date('2026-08-31T23:59:59.999Z'),
          rentAmount: '3000.00',
          tenant: { id: TENANT_ID, status: 'active', displayName: 'Somchai Jaidee' },
        },
      ]);
      mockPrismaClient.tenantCoOccupant.findMany.mockResolvedValue([
        { id: 'co-1', tenantId: TENANT_ID, status: 'active' },
        { id: 'co-2', tenantId: TENANT_ID, status: 'active' },
      ]);

      // 1. Initial preview before save:
      // - actual household metadata = 3
      // - no saved snapshot (snapshotPeopleCount = null)
      // - first-cycle policy forces effective calculation people = 1
      // - water amount = 1 * 100.00 = 100.00 THB (NOT 300.00 THB!)
      const preview1 = await meterService.getMeterBillingPreviewContext(DORM_ID, CYCLE_ID);
      const roomPreview1 = preview1.rooms.find((r) => r.roomId === ROOM_ID);
      expect(roomPreview1).toBeDefined();
      expect(roomPreview1?.currentHouseholdPeopleCount).toBe(3);
      expect(roomPreview1?.snapshotPeopleCount).toBeNull();

      const monthlyComp1 = roomPreview1?.chargeComponents.find((c) => c.type === 'monthly_utility');
      expect(monthlyComp1).toBeDefined();
      const waterLine1 = monthlyComp1?.lineItems.find((l: any) => l.type === 'water');
      expect(waterLine1).toBeDefined();
      expect(waterLine1?.quantity).toBe('1.00');
      expect(waterLine1?.unitPrice).toBe('100.00');
      expect(waterLine1?.amount).toBe('100.00'); // Authoritative proof: 100.00 THB, not 300.00 THB

      // 2. Owner explicitly edits and saves peopleCount = 3
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, peopleCount: 3 }],
      });

      // 3. Preview after save:
      // - snapshotPeopleCount = 3
      // - water amount = 3 * 100.00 = 300.00 THB
      const preview2 = await meterService.getMeterBillingPreviewContext(DORM_ID, CYCLE_ID);
      const roomPreview2 = preview2.rooms.find((r) => r.roomId === ROOM_ID);
      expect(roomPreview2?.snapshotPeopleCount).toBe(3);

      const monthlyComp2 = roomPreview2?.chargeComponents.find((c) => c.type === 'monthly_utility');
      const waterLine2 = monthlyComp2?.lineItems.find((l: any) => l.type === 'water');
      expect(waterLine2?.quantity).toBe('3.00');
      expect(waterLine2?.amount).toBe('300.00'); // Authoritative proof: 300.00 THB

      // 4. Saved zero regression: Owner explicitly saves peopleCount = 0
      await meterService.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [{ roomId: ROOM_ID, peopleCount: 0 }],
      });

      const preview3 = await meterService.getMeterBillingPreviewContext(DORM_ID, CYCLE_ID);
      const roomPreview3 = preview3.rooms.find((r) => r.roomId === ROOM_ID);
      expect(roomPreview3?.snapshotPeopleCount).toBe(0);

      const monthlyComp3 = roomPreview3?.chargeComponents.find((c) => c.type === 'monthly_utility');
      expect(monthlyComp3?.amount).toBe('0.00'); // Authoritative proof: 0.00 THB total
    });

    it('Test 35: R3.9-C.3.3.1 Later-Cycle Financial Preview Uses Actual Household Count (3) When No Snapshot Exists', async () => {
      const { meterService, billingCycleRepo, roomRepo, mockPrismaClient } = setupMeterWorkspaceHarness();

      await roomRepo.create(DORM_ID, {
        id: ROOM_ID,
        roomNumber: '101',
        buildingId: BLD_ID,
        monthlyRent: 3000,
      } as any);

      // Create First Cycle (2026-08)
      await billingCycleRepo.create(DORM_ID, {
        id: 'cycle-first',
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        billingDate: new Date('2026-08-31T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'draft',
      });

      // Create Later Cycle (2026-09)
      const CYCLE_2_ID = 'cycle-second';
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_2_ID,
        cycleCode: '2026-09',
        periodStart: new Date('2026-09-01T00:00:00.000Z'),
        periodEnd: new Date('2026-09-30T23:59:59.999Z'),
        billingDate: new Date('2026-09-30T00:00:00.000Z'),
        dueDate: new Date('2026-10-05T00:00:00.000Z'),
        status: 'draft',
      });

      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_2_ID,
        waterBillingType: 'per_person',
        waterRate: '100.00',
        electricityBillingType: 'fixed',
        electricityRate: '0.00',
        source: 'CYCLE_INIT',
      });

      const TENANT_ID = 't-tenant-101';
      mockPrismaClient.contract.findMany.mockResolvedValue([
        {
          id: 'contract-101',
          dormitoryId: DORM_ID,
          roomId: ROOM_ID,
          tenantId: TENANT_ID,
          status: 'active',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2026-09-30T23:59:59.999Z'),
          rentAmount: '3000.00',
          tenant: { id: TENANT_ID, status: 'active', displayName: 'Somchai Jaidee' },
        },
      ]);
      mockPrismaClient.tenantCoOccupant.findMany.mockResolvedValue([
        { id: 'co-1', tenantId: TENANT_ID, status: 'active' },
        { id: 'co-2', tenantId: TENANT_ID, status: 'active' },
      ]);

      // Later cycle without snapshot: uses actual household count = 3 (1 tenant + 2 co-occupants)
      const previewLater = await meterService.getMeterBillingPreviewContext(DORM_ID, CYCLE_2_ID);
      const roomPreviewLater = previewLater.rooms.find((r) => r.roomId === ROOM_ID);
      expect(roomPreviewLater).toBeDefined();
      expect(roomPreviewLater?.currentHouseholdPeopleCount).toBe(3);
      expect(roomPreviewLater?.snapshotPeopleCount).toBeNull();

      const monthlyComp = roomPreviewLater?.chargeComponents.find((c) => c.type === 'monthly_utility');
      const waterLine = monthlyComp?.lineItems.find((l: any) => l.type === 'water');
      expect(waterLine?.quantity).toBe('3.00'); // Uses later-cycle household authority 3
      expect(waterLine?.amount).toBe('300.00'); // 3 * 100.00 = 300.00 THB (NOT 100.00 THB!)
    });

    it('Test 36: R3.9-C.3.3.2 Deterministic Earliest-Cycle Lookup Across >20 Billing Cycles & Exact Query Contract Proof', async () => {
      const { meterService, billingCycleRepo } = setupMeterWorkspaceHarness();

      // Create 25 billing cycles: 2024-01 through 2026-01
      const cycleIds: string[] = [];
      for (let i = 1; i <= 25; i++) {
        const year = 2024 + Math.floor((i - 1) / 12);
        const month = ((i - 1) % 12) + 1;
        const cycleCode = `${year}-${String(month).padStart(2, '0')}`;
        const id = `cycle-${cycleCode}`;
        cycleIds.push(id);

        const periodStart = new Date(Date.UTC(year, month - 1, 1));
        const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

        await billingCycleRepo.create(DORM_ID, {
          id,
          cycleCode,
          periodStart,
          periodEnd,
          billingDate: periodEnd,
          dueDate: new Date(Date.UTC(year, month, 5)),
          status: 'draft',
        });
      }

      const findAllSpy = vi.spyOn(billingCycleRepo, 'findAll');

      // 1. True earliest cycle is 2024-01 (index 0)
      const isFirstOfTrueFirst = await (meterService as any).resolveIsFirstBillingCycle(DORM_ID, cycleIds[0]);
      expect(isFirstOfTrueFirst).toBe(true);

      // Verify exact repository call contract: page=1, pageSize=1, sortBy='periodStart', sortDirection='asc'
      expect(findAllSpy).toHaveBeenCalledWith(DORM_ID, {
        page: 1,
        pageSize: 1,
        sortBy: 'periodStart',
        sortDirection: 'asc',
      });

      // 2. 21st cycle is 2025-09 (index 20) -> must be false
      findAllSpy.mockClear();
      const isFirstOfCycle21 = await (meterService as any).resolveIsFirstBillingCycle(DORM_ID, cycleIds[20]);
      expect(isFirstOfCycle21).toBe(false);
      expect(findAllSpy).toHaveBeenCalledWith(DORM_ID, {
        page: 1,
        pageSize: 1,
        sortBy: 'periodStart',
        sortDirection: 'asc',
      });

      // 3. 25th / latest cycle is 2026-01 (index 24) -> must be false
      findAllSpy.mockClear();
      const isFirstOfCycle25 = await (meterService as any).resolveIsFirstBillingCycle(DORM_ID, cycleIds[24]);
      expect(isFirstOfCycle25).toBe(false);
      expect(findAllSpy).toHaveBeenCalledWith(DORM_ID, {
        page: 1,
        pageSize: 1,
        sortBy: 'periodStart',
        sortDirection: 'asc',
      });

      // 4. Negative contract proof:
      // If implementation regresses to findAll(dormitoryId) without explicit query options,
      // verify that spy assertion strictly catches and rejects it
      const lastCallArgs = findAllSpy.mock.calls[0];
      expect(lastCallArgs[1]).toBeDefined();
      expect(lastCallArgs[1]?.page).toBe(1);
      expect(lastCallArgs[1]?.pageSize).toBe(1);
      expect(lastCallArgs[1]?.sortBy).toBe('periodStart');
      expect(lastCallArgs[1]?.sortDirection).toBe('asc');
    });
  });

  describe('10. Three Building-Level Deposit Modes & Room Propagation', () => {
    it('OnboardingBuildingInputSchema and OnboardingRoomInputSchema validate termDeposit, monthlyDeposit, dailyDeposit', () => {
      const bld = {
        id: 'b-1',
        name: 'อาคาร B',
        termDeposit: 5000,
        monthlyDeposit: 3000,
        dailyDeposit: 500,
      };
      const room = {
        buildingId: 'b-1',
        roomNumber: 'B101',
        termDeposit: 5000,
        monthlyDeposit: 3000,
        dailyDeposit: 500,
        monthlyRent: 3500,
      };

      const parsedBld = OnboardingBuildingInputSchema.parse(bld);
      expect(parsedBld.termDeposit).toBe(5000);
      expect(parsedBld.monthlyDeposit).toBe(3000);
      expect(parsedBld.dailyDeposit).toBe(500);

      const parsedRoom = OnboardingRoomInputSchema.parse(room);
      expect(parsedRoom.termDeposit).toBe(5000);
      expect(parsedRoom.monthlyDeposit).toBe(3000);
      expect(parsedRoom.dailyDeposit).toBe(500);
    });

    it('DormitoryProvisioningService propagates distinct three-mode deposits to rooms per building without leakage', async () => {
      vi.spyOn(referralService, 'settleReferralOnboarding').mockResolvedValue(undefined as any);
      const upsertedRooms: any[] = [];

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
            name: 'Dorm Multi-Deposit',
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
          upsert: vi.fn().mockResolvedValue({ id: 'bset-001' }),
        },
        building: {
          create: vi.fn((args) => Promise.resolve({ id: args.data.id || 'bld-id', ...args.data })),
          upsert: vi.fn((args) => Promise.resolve({ id: args.create?.id || 'bld-id', ...args.create })),
        },
        room: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn((args) => {
            upsertedRooms.push(args.create);
            return Promise.resolve({ id: `rm-${upsertedRooms.length}`, ...args.create });
          }),
        },
      };

      const mockPrisma: any = {
        $transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const service = new DormitoryProvisioningService(mockPrisma as any);

      await service.completeOwnerOnboarding({
        userId: 'user-001',
        idempotencyKey: 'idemp-dep-test',
        provisionalDormitoryId: 'dorm-prov-001',
        packageIntentId: 'intent-001',
        dormitory: { name: 'Dorm Multi-Deposit', estimatedRoomCount: 4 },
        billing: { dueDay: 5 },
        buildings: [
          {
            id: 'bld-A',
            name: 'อาคาร A',
            floorsCount: 1,
            termDeposit: 5000,
            monthlyDeposit: 3000,
            dailyDeposit: 500,
          },
          {
            id: 'bld-B',
            name: 'อาคาร B',
            floorsCount: 1,
            termDeposit: 8000,
            monthlyDeposit: 4000,
            dailyDeposit: 800,
          },
        ],
        rooms: [
          { buildingId: 'bld-A', roomNumber: 'A101', floor: 1, monthlyRent: 3500 },
          { buildingId: 'bld-A', roomNumber: 'A102', floor: 1, monthlyRent: 3500 },
          { buildingId: 'bld-B', roomNumber: 'B101', floor: 1, monthlyRent: 4500 },
          { buildingId: 'bld-B', roomNumber: 'B102', floor: 1, monthlyRent: 4500 },
        ],
      });

      expect(upsertedRooms).toHaveLength(4);

      const a101 = upsertedRooms.find((r) => r.roomNumber === 'A101');
      const a102 = upsertedRooms.find((r) => r.roomNumber === 'A102');
      const b101 = upsertedRooms.find((r) => r.roomNumber === 'B101');
      const b102 = upsertedRooms.find((r) => r.roomNumber === 'B102');

      expect(a101.termDeposit).toBe('5000');
      expect(a101.monthlyDeposit).toBe('3000');
      expect(a101.dailyDeposit).toBe('500');

      expect(a102.termDeposit).toBe('5000');
      expect(a102.monthlyDeposit).toBe('3000');
      expect(a102.dailyDeposit).toBe('500');

      expect(b101.termDeposit).toBe('8000');
      expect(b101.monthlyDeposit).toBe('4000');
      expect(b101.dailyDeposit).toBe('800');

      expect(b102.termDeposit).toBe('8000');
      expect(b102.monthlyDeposit).toBe('4000');
      expect(b102.dailyDeposit).toBe('800');
    });
  });

  describe('11. Dorm-Wide Room Number Uniqueness & Cross-Building Collision Defense (Round 1.1)', () => {
    it('CompleteOnboardingInputSchema rejects duplicate normalized room numbers across buildings (101 vs 101 or A101 vs a101)', () => {
      const validBase = {
        dormitory: { name: 'Dorm Test' },
        billing: { dueDay: 5 },
        packageIntentId: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        planCode: 'FREE',
      };

      // Duplicate 101 vs 101 in different buildings
      const dupNumeric = {
        ...validBase,
        buildings: [
          { id: 'bld-A', name: 'อาคาร A', floorsCount: 1, depositAmount: 0 },
          { id: 'bld-B', name: 'อาคาร B', floorsCount: 1, depositAmount: 0 },
        ],
        rooms: [
          { buildingId: 'bld-A', roomNumber: '101' },
          { buildingId: 'bld-B', roomNumber: '101' },
        ],
      };

      expect(() => CompleteOnboardingInputSchema.parse(dupNumeric)).toThrow(/ซ้ำกับอาคารอื่น/);

      // Case-normalized duplicate A101 vs a101
      const dupCase = {
        ...validBase,
        buildings: [
          { id: 'bld-A', name: 'อาคาร A', floorsCount: 1, depositAmount: 0 },
          { id: 'bld-B', name: 'อาคาร B', floorsCount: 1, depositAmount: 0 },
        ],
        rooms: [
          { buildingId: 'bld-A', roomNumber: 'A101' },
          { buildingId: 'bld-B', roomNumber: 'a101' },
        ],
      };

      expect(() => CompleteOnboardingInputSchema.parse(dupCase)).toThrow(/ซ้ำกับอาคารอื่น/);

      // Distinct rooms A101 vs สมบูรณ์101 -> Valid
      const distinct = {
        ...validBase,
        buildings: [
          { id: 'bld-A', name: 'อาคาร A', floorsCount: 1, depositAmount: 0 },
          { id: 'bld-B', name: 'อาคาร สมบูรณ์', floorsCount: 1, depositAmount: 0 },
        ],
        rooms: [
          { buildingId: 'bld-A', roomNumber: 'A101' },
          { buildingId: 'bld-B', roomNumber: 'สมบูรณ์101' },
        ],
      };

      const parsed = CompleteOnboardingInputSchema.parse(distinct);
      expect(parsed.rooms).toHaveLength(2);
      expect(parsed.rooms?.[1].roomNumber).toBe('สมบูรณ์101');
    });

    it('completeOwnerOnboarding fails closed with ROOM_NUMBER_ALREADY_EXISTS when existing room belongs to another building', async () => {
      vi.spyOn(referralService, 'settleReferralOnboarding').mockResolvedValue(undefined as any);

      // Existing Room 101 belongs to bld-existing-A
      const mockTx: any = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue({ provisionalDormitoryId: 'dorm-prov-001', finalizedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({ id: 'dorm-prov-001', createdByUserId: 'user-001', status: 'setup_pending' }),
          update: vi.fn().mockResolvedValue({ id: 'dorm-prov-001', name: 'Dorm Conflict', status: 'active' }),
        },
        ownerSignature: { findFirst: vi.fn().mockResolvedValue({ id: 'sig-001', isCurrent: true }) },
        dormitoryLineConfig: { findUnique: vi.fn().mockResolvedValue(null) },
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
        subscriptionPlan: { findUnique: vi.fn().mockResolvedValue({ id: 'plan-paid', code: 'PAID' }) },
        dormitorySubscription: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
          upsert: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
        },
        role: { findFirst: vi.fn().mockResolvedValue({ id: 'role-owner', code: 'OWNER' }) },
        dormitoryMember: { upsert: vi.fn().mockResolvedValue({ id: 'mem-001' }) },
        dormitoryPropertyDefaults: { upsert: vi.fn().mockResolvedValue({}) },
        dormitoryBillingSettings: { upsert: vi.fn().mockResolvedValue({ id: 'bset-001' }) },
        building: {
          create: vi.fn((args) => Promise.resolve({ id: 'bld-new-B', ...args.data })),
          upsert: vi.fn((args) => Promise.resolve({ id: 'bld-new-B', ...args.create })),
        },
        room: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'room-101-existing',
            buildingId: 'bld-existing-A', // Belongs to a different building!
            roomNumber: '101',
            normalizedRoomNumber: '101',
          }),
          upsert: vi.fn(),
        },
      };

      const mockPrisma: any = {
        $transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const service = new DormitoryProvisioningService(mockPrisma as any);

      await expect(
        service.completeOwnerOnboarding({
          userId: 'user-001',
          idempotencyKey: 'idemp-conflict-test',
          provisionalDormitoryId: 'dorm-prov-001',
          packageIntentId: 'intent-001',
          dormitory: { name: 'Dorm Conflict', estimatedRoomCount: 1 },
          billing: { dueDay: 5 },
          buildings: [{ id: 'bld-B', name: 'อาคาร B', floorsCount: 1, depositAmount: 0 }],
          rooms: [{ buildingId: 'bld-B', roomNumber: '101', floor: 1, monthlyRent: 3500 }],
        })
      ).rejects.toThrow(/ซ้ำกับอาคารอื่น/);

      // Verify room upsert was NEVER called -> Room was NOT moved to bld-new-B
      expect(mockTx.room.upsert).not.toHaveBeenCalled();
    });

    it('allows same-building idempotent retry without collision error', async () => {
      vi.spyOn(referralService, 'settleReferralOnboarding').mockResolvedValue(undefined as any);
      const upsertedRooms: any[] = [];

      const mockTx: any = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue({ provisionalDormitoryId: 'dorm-prov-001', finalizedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({ id: 'dorm-prov-001', createdByUserId: 'user-001', status: 'setup_pending' }),
          update: vi.fn().mockResolvedValue({ id: 'dorm-prov-001', name: 'Dorm Retry', status: 'active' }),
        },
        ownerSignature: { findFirst: vi.fn().mockResolvedValue({ id: 'sig-001', isCurrent: true }) },
        dormitoryLineConfig: { findUnique: vi.fn().mockResolvedValue(null) },
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
        subscriptionPlan: { findUnique: vi.fn().mockResolvedValue({ id: 'plan-paid', code: 'PAID' }) },
        dormitorySubscription: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
          upsert: vi.fn().mockResolvedValue({ id: 'sub-001', status: 'ACTIVE' }),
        },
        role: { findFirst: vi.fn().mockResolvedValue({ id: 'role-owner', code: 'OWNER' }) },
        dormitoryMember: { upsert: vi.fn().mockResolvedValue({ id: 'mem-001' }) },
        dormitoryPropertyDefaults: { upsert: vi.fn().mockResolvedValue({}) },
        dormitoryBillingSettings: { upsert: vi.fn().mockResolvedValue({ id: 'bset-001' }) },
        building: {
          create: vi.fn((args) => Promise.resolve({ id: 'bld-same-A', ...args.data })),
          upsert: vi.fn((args) => Promise.resolve({ id: 'bld-same-A', ...args.create })),
        },
        room: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'room-101-existing',
            buildingId: 'bld-same-A', // Same building!
            roomNumber: '101',
            normalizedRoomNumber: '101',
          }),
          upsert: vi.fn((args) => {
            upsertedRooms.push(args.create);
            return Promise.resolve({ id: 'room-101-existing', ...args.create });
          }),
        },
      };

      const mockPrisma: any = {
        $transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const service = new DormitoryProvisioningService(mockPrisma as any);

      await service.completeOwnerOnboarding({
        userId: 'user-001',
        idempotencyKey: 'idemp-same-bld-test',
        provisionalDormitoryId: 'dorm-prov-001',
        packageIntentId: 'intent-001',
        dormitory: { name: 'Dorm Retry', estimatedRoomCount: 1 },
        billing: { dueDay: 5 },
        buildings: [{ id: 'bld-A', name: 'อาคาร A', floorsCount: 1, depositAmount: 0 }],
        rooms: [{ buildingId: 'bld-A', roomNumber: '101', floor: 1, monthlyRent: 3500 }],
      });

      expect(upsertedRooms).toHaveLength(1);
      expect(upsertedRooms[0].roomNumber).toBe('101');
    });
  });
});
