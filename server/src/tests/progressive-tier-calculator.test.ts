/**
 * @license Apache-2.0
 * OWNER R3.9-C.1: Canonical Progressive Tier Calculator, Integer Meter Domain & Meter Workspace Authority
 */

import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  calculateProgressiveTieredCharge,
  validateCanonicalUsageUnits,
  CanonicalTierBreakdown,
} from '../utils/progressive-tier-calculator.util.js';
import {
  validateCanonicalUtilityTiers,
} from '../utils/utility-tier-validator.util.js';
import {
  calculateCanonicalMonthlyUtility,
  CanonicalMonthlyUtilityInput,
  CanonicalRateSnapshotInput,
} from '../utils/monthly-utility-calculator.util.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { billingOrchestrationService } from '../services/billing-orchestration.service.js';
import { MeterService } from '../services/meter.service.js';
import { BillingService } from '../services/billing.service.js';
import * as billingServiceModule from '../services/billing.service.js';
import { InMemoryMeterRepository } from '../db/repositories/meter.repository.js';
import { InMemoryBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { InMemoryRoomRepository } from '../db/repositories/room.repository.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import { InMemoryTenantRepository } from '../db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../db/repositories/contract.repository.js';

describe('OWNER R3.9-C.1: Progressive Tier Calculator & Integer Meter Domain Authority', () => {
  // Product Owner Example Tariff: (0, 10] @ 3.40, (10, 20] @ 4.25, (20, ∞) @ 5.00
  const productWaterTiers = [
    { upTo: '10.00', rate: '3.40' },
    { upTo: '20.00', rate: '4.25' },
    { upTo: null, rate: '5.00' },
  ];

  // Standard Electricity Tariff: (0, 50] @ 7.00, (50, 150] @ 8.00, (150, ∞) @ 9.00
  const standardElecTiers = [
    { upTo: '50.00', rate: '7.00' },
    { upTo: '150.00', rate: '8.00' },
    { upTo: null, rate: '9.00' },
  ];

  describe('Group A: Pure Progressive Helper (Integer Domain & Tariff Examples)', () => {
    describe('Section 22 & 23: Exact Product Owner Water Examples', () => {
      it('Usage 0 -> 0.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 0, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('0.00');
        expect(res.totalAmount).toBe('0.00');
        expect(res.tierBreakdown).toEqual([]);
      });

      it('Usage 1 -> 1 * 3.40 = 3.40', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 1, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('1.00');
        expect(res.totalAmount).toBe('3.40');
        expect(res.tierBreakdown).toEqual([
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '1.00', rate: '3.40', amount: '3.40' },
        ]);
      });

      it('Usage 10 -> 10 * 3.40 = 34.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 10, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('10.00');
        expect(res.totalAmount).toBe('34.00');
        expect(res.tierBreakdown).toEqual([
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
        ]);
      });

      it('Usage 11 -> 10 * 3.40 + 1 * 4.25 = 38.25', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 11, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('11.00');
        expect(res.totalAmount).toBe('38.25');
        expect(res.tierBreakdown).toEqual([
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '1.00', rate: '4.25', amount: '4.25' },
        ]);
      });

      it('Usage 15 -> 10 * 3.40 + 5 * 4.25 = 55.25 (Section 22 Locked Example)', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 15, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('15.00');
        expect(res.totalAmount).toBe('55.25');
        expect(res.tierBreakdown).toEqual([
          { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
          { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
        ]);
      });

      it('Usage 20 -> 10 * 3.40 + 10 * 4.25 = 76.50', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 20, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('20.00');
        expect(res.totalAmount).toBe('76.50');
        expect(res.tierBreakdown).toHaveLength(2);
      });

      it('Usage 21 -> 10 * 3.40 + 10 * 4.25 + 1 * 5.00 = 81.50', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 21, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('21.00');
        expect(res.totalAmount).toBe('81.50');
        expect(res.tierBreakdown).toHaveLength(3);
        expect(res.tierBreakdown[2]).toEqual({
          lowerExclusive: '20.00',
          upperInclusive: null,
          billedUnits: '1.00',
          rate: '5.00',
          amount: '5.00',
        });
      });

      it('Usage 25 -> 10 * 3.40 + 10 * 4.25 + 5 * 5.00 = 101.50', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 25, tiers: productWaterTiers });
        expect(res.usageUnits).toBe('25.00');
        expect(res.totalAmount).toBe('101.50');
        expect(res.tierBreakdown).toHaveLength(3);
        expect(res.tierBreakdown[2]).toEqual({
          lowerExclusive: '20.00',
          upperInclusive: null,
          billedUnits: '5.00',
          rate: '5.00',
          amount: '25.00',
        });
      });
    });

    describe('Section 25: Electricity Integer Examples', () => {
      it('Usage 50 -> 50 * 7.00 = 350.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 50, tiers: standardElecTiers });
        expect(res.totalAmount).toBe('350.00');
      });

      it('Usage 51 -> 50 * 7.00 + 1 * 8.00 = 358.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 51, tiers: standardElecTiers });
        expect(res.totalAmount).toBe('358.00');
      });

      it('Usage 150 -> 50 * 7.00 + 100 * 8.00 = 1150.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 150, tiers: standardElecTiers });
        expect(res.totalAmount).toBe('1150.00');
      });

      it('Usage 151 -> 50 * 7.00 + 100 * 8.00 + 1 * 9.00 = 1159.00', () => {
        const res = calculateProgressiveTieredCharge({ usageUnits: 151, tiers: standardElecTiers });
        expect(res.totalAmount).toBe('1159.00');
      });
    });

    describe('Section 24: Integer Boundary Exact Transitions (9, 10, 11 and 19, 20, 21)', () => {
      it('Tier 1 boundary transitions at 9, 10, 11', () => {
        const res9 = calculateProgressiveTieredCharge({ usageUnits: 9, tiers: productWaterTiers });
        expect(res9.totalAmount).toBe('30.60'); // 9 * 3.40
        expect(res9.tierBreakdown).toHaveLength(1);

        const res10 = calculateProgressiveTieredCharge({ usageUnits: 10, tiers: productWaterTiers });
        expect(res10.totalAmount).toBe('34.00'); // 10 * 3.40
        expect(res10.tierBreakdown).toHaveLength(1);

        const res11 = calculateProgressiveTieredCharge({ usageUnits: 11, tiers: productWaterTiers });
        expect(res11.totalAmount).toBe('38.25'); // 10 * 3.40 + 1 * 4.25
        expect(res11.tierBreakdown).toHaveLength(2);
      });

      it('Tier 2 boundary transitions at 19, 20, 21', () => {
        const res19 = calculateProgressiveTieredCharge({ usageUnits: 19, tiers: productWaterTiers });
        expect(res19.totalAmount).toBe('72.25'); // 10 * 3.40 + 9 * 4.25
        expect(res19.tierBreakdown).toHaveLength(2);

        const res20 = calculateProgressiveTieredCharge({ usageUnits: 20, tiers: productWaterTiers });
        expect(res20.totalAmount).toBe('76.50'); // 10 * 3.40 + 10 * 4.25
        expect(res20.tierBreakdown).toHaveLength(2);

        const res21 = calculateProgressiveTieredCharge({ usageUnits: 21, tiers: productWaterTiers });
        expect(res21.totalAmount).toBe('81.50'); // 10 * 3.40 + 10 * 4.25 + 1 * 5.00
        expect(res21.tierBreakdown).toHaveLength(3);
      });
    });

    describe('Section 8 & 34: Fractional Usage Rejection & Strict Usage Domain', () => {
      it('Fails closed on fractional usage strings (0.50, 9.99, 10.01, 10.50, 20.25)', () => {
        expect(() => calculateProgressiveTieredCharge({ usageUnits: '0.50', tiers: productWaterTiers })).toThrow('INVALID_USAGE');
        expect(() => calculateProgressiveTieredCharge({ usageUnits: '9.99', tiers: productWaterTiers })).toThrow('INVALID_USAGE');
        expect(() => calculateProgressiveTieredCharge({ usageUnits: '10.01', tiers: productWaterTiers })).toThrow('INVALID_USAGE');
        expect(() => calculateProgressiveTieredCharge({ usageUnits: '10.50', tiers: productWaterTiers })).toThrow('INVALID_USAGE');
        expect(() => calculateProgressiveTieredCharge({ usageUnits: '20.25', tiers: productWaterTiers })).toThrow('INVALID_USAGE');
      });

      it('Accepts integer semantic strings and Prisma.Decimal representation (15, "15", "15.00")', () => {
        expect(validateCanonicalUsageUnits(15).toString()).toBe('15');
        expect(validateCanonicalUsageUnits('15').toString()).toBe('15');
        expect(validateCanonicalUsageUnits('15.00').toString()).toBe('15');
        expect(validateCanonicalUsageUnits(new Prisma.Decimal('15.00')).toString()).toBe('15');
      });

      it('Rejects fractional Prisma.Decimal representation (15.50)', () => {
        expect(() => validateCanonicalUsageUnits(new Prisma.Decimal('15.50'))).toThrow('INVALID_USAGE');
      });
    });

    describe('Section 11 & 33: Tier Boundary Integer Validation & Max 5 Limits', () => {
      it('Accepts 1 tier up to max 5 tiers with whole unit upper bounds ("10", "10.00", 10)', () => {
        // 1 tier
        const single = validateCanonicalUtilityTiers([{ upTo: null, rate: '15.00' }]);
        expect(single).toHaveLength(1);

        // 3 tiers
        const validated = validateCanonicalUtilityTiers([
          { upTo: '10', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
        expect(validated[0].upTo).toBe('10.00');
        expect(validated[1].upTo).toBe('20.00');
        expect(validated[2].upTo).toBeNull();

        // 5 tiers (max allowed)
        const fiveTiers = validateCanonicalUtilityTiers([
          { upTo: '10', rate: '1.00' },
          { upTo: '20', rate: '2.00' },
          { upTo: '30', rate: '3.00' },
          { upTo: '40', rate: '4.00' },
          { upTo: null, rate: '5.00' },
        ]);
        expect(fiveTiers).toHaveLength(5);
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

      it('Rejects fractional upper bounds ("10.50", "20.25")', () => {
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

      it('Accepts decimal rates ("3.4" -> "3.40", "4.25", "7.75", "0.00")', () => {
        const validated = validateCanonicalUtilityTiers([
          { upTo: '10.00', rate: '3.4' },
          { upTo: '20.00', rate: '7.75' },
          { upTo: null, rate: '0.00' },
        ]);
        expect(validated[0].rate).toBe('3.40');
        expect(validated[1].rate).toBe('7.75');
        expect(validated[2].rate).toBe('0.00');
      });
    });

    describe('Section 26: Fractional Rate Decimal Proof', () => {
      it('Calculates exact fractional rate 7.75 with integer units', () => {
        const tiers = [{ upTo: null, rate: '7.75' }];
        const res = calculateProgressiveTieredCharge({ usageUnits: 10, tiers });
        expect(res.totalAmount).toBe('77.50');
      });
    });
  });

  describe('Group B: Canonical Monthly Utility Tiered Integration', () => {
    const baseSnapshot: CanonicalRateSnapshotInput = {
      waterBillingType: 'tiered',
      waterTierRates: productWaterTiers,
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFeeMode: 'per_room',
      commonFee: '200.00',
    };

    it('Section 21 & 22: Produces single Water BillItem (15 units -> 55.25 THB)', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: baseSnapshot,
        waterReading: { previousReading: '100', currentReading: '115' },
        electricReading: { previousReading: '500', currentReading: '500' },
      });

      expect(res.waterUsage).toBe('15.00');
      expect(res.waterAmount).toBe('55.25');
      expect(res.waterRate).toBe('0.00'); // Technical 0.00
      expect(res.waterMode).toBe('tiered');

      const waterItem = res.items.find((i) => i.type === 'water')!;
      expect(waterItem).toEqual({
        type: 'water',
        description: 'ค่าน้ำ (100 - 115)',
        quantity: '15.00',
        unit: 'unit',
        unitPrice: '0.00',
        amount: '55.25',
        metadata: {
          previousReading: '100',
          currentReading: '115',
          usageUnits: '15.00',
          mode: 'tiered',
          isRollover: false,
          rolloverType: null,
          tierBreakdown: [
            { lowerExclusive: '0.00', upperInclusive: '10.00', billedUnits: '10.00', rate: '3.40', amount: '34.00' },
            { lowerExclusive: '10.00', upperInclusive: '20.00', billedUnits: '5.00', rate: '4.25', amount: '21.25' },
          ],
        },
      });
    });

    it('Tiered integer rollover (99995 -> 00010 = 15 units)', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: baseSnapshot,
        waterReading: { previousReading: '99995', currentReading: '00010' },
        electricReading: { previousReading: '0', currentReading: '0' },
      });

      expect(res.waterUsage).toBe('15.00');
      expect(res.waterAmount).toBe('55.25');
      const waterItem = res.items.find((i) => i.type === 'water')!;
      expect(waterItem.metadata?.isRollover).toBe(true);
      expect(waterItem.metadata?.rolloverType).toBe('5_DIGIT');
    });

    it('All-zero tier rates still require meter readings', () => {
      const allZeroSnapshot: CanonicalRateSnapshotInput = {
        waterBillingType: 'tiered',
        waterTierRates: [
          { upTo: '10.00', rate: '0.00' },
          { upTo: null, rate: '0.00' },
        ],
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      };

      expect(() =>
        calculateCanonicalMonthlyUtility({
          rateSnapshot: allZeroSnapshot,
          waterReading: { previousReading: null, currentReading: null },
          electricReading: { previousReading: '0', currentReading: '0' },
        })
      ).toThrow('MISSING_WATER_METER_READING');
    });
  });

    describe('Group C: MeterService Workspace Integration (Section 13, 14, 15, 17, 31)', () => {
    const DORM_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const CYCLE_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    const ROOM_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

    function setupMeterService() {
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

      const service = new MeterService(meterRepo, billingCycleRepo, roomRepo, billRepo);

      return { service, meterRepo, billingCycleRepo, roomRepo, billRepo };
    }

    it('Test 31.A: Water tiered mode persists MeterReading in Meter Workspace', async () => {
      const { service, meterRepo, billingCycleRepo, roomRepo } = setupMeterService();

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });

      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-31'),
        dueDate: new Date('2026-09-05'),
        status: 'draft',
      } as any);
      await billingCycleRepo.createRateSnapshot(DORM_ID, {
        billingCycleId: CYCLE_ID,
        waterBillingType: 'tiered',
        waterTierRates: productWaterTiers,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        source: 'CYCLE_INIT',
      });

      await service.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          { roomId: ROOM_ID, waterCurr: '115', waterPrev: '100' },
        ],
      });

      const savedReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(savedReading).toBeDefined();
      expect(Number(savedReading?.previousReading)).toBe(100);
      expect(Number(savedReading?.currentReading)).toBe(115);
      expect(Number(savedReading?.usageUnits)).toBe(15);
    });

    it('Test 31.B: Electricity tiered mode persists MeterReading in Meter Workspace', async () => {
      const { service, meterRepo, billingCycleRepo, roomRepo } = setupMeterService();

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });

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
        electricityBillingType: 'tiered',
        electricityTierRates: standardElecTiers,
        source: 'CYCLE_INIT',
      });

      await service.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          { roomId: ROOM_ID, elecCurr: '151', elecPrev: '100' },
        ],
      });

      const savedReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'electricity');
      expect(savedReading).toBeDefined();
      expect(Number(savedReading?.currentReading)).toBe(151);
      expect(Number(savedReading?.usageUnits)).toBe(51);
    });

    it('Test 31.C: Tiered integer rollover 99995 -> 10 computes usage 15 in Meter Workspace', async () => {
      const { service, meterRepo, billingCycleRepo, roomRepo } = setupMeterService();

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });

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
        waterBillingType: 'tiered',
        waterTierRates: productWaterTiers,
        source: 'CYCLE_INIT',
      });

      await service.saveBulkMeterWorkspace(DORM_ID, {
        billingCycleId: CYCLE_ID,
        rows: [
          { roomId: ROOM_ID, waterCurr: '00010', waterPrev: '99995' },
        ],
      });

      const savedReading = await meterRepo.findReadingByCycleRoomAndType(DORM_ID, CYCLE_ID, ROOM_ID, 'water');
      expect(Number(savedReading?.usageUnits)).toBe(15);
    });

    it('Test 31.D: Tiered decimal meter input (100.25) is strictly rejected', async () => {
      const { service, billingCycleRepo, roomRepo } = setupMeterService();

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });

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
        waterBillingType: 'tiered',
        waterTierRates: productWaterTiers,
        source: 'CYCLE_INIT',
      });

      await expect(
        service.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            { roomId: ROOM_ID, waterCurr: '100.25', waterPrev: '100' },
          ],
        })
      ).rejects.toThrow(/ค่ามิเตอร์ต้องเป็นตัวเลขจำนวนเต็ม|INVALID_METER_READING/);
    });

    it('Test 22.A & 22.E (31.E & 31.F): Tiered & all-zero tiered issued bill protects current reading from clearing when eligible', async () => {
      const { service, billingCycleRepo, roomRepo, billRepo } = setupMeterService();

      vi.spyOn(billingServiceModule, 'resolveBillDirectRecalculationEligibilityInTx').mockResolvedValue({
        eligible: true,
        bill: { id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55', status: 'unpaid', billKind: 'MONTHLY_UTILITY' } as any,
      });

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });
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
        waterBillingType: 'tiered',
        waterTierRates: [
          { upTo: '10.00', rate: '0.00' },
          { upTo: null, rate: '0.00' },
        ],
        source: 'CYCLE_INIT',
      });

      // Issue active bill
      await billRepo.create(
        DORM_ID,
        {
          id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
          billingCycleId: CYCLE_ID,
          roomId: ROOM_ID,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
          totalAmount: '100.00',
          subtotal: '100.00',
          outstandingAmount: '100.00',
        } as any,
        []
      );

      // Attempt to clear current water reading on issued bill
      let errorThrown: any = null;
      try {
        await service.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            { roomId: ROOM_ID, waterCurr: '', waterPrev: '100' },
          ],
        });
      } catch (err: any) {
        errorThrown = err;
      }
      expect(errorThrown).not.toBeNull();
      expect(errorThrown.code).toBe('CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL');
    });

    it('Test 22.B: Active monthly bill fails closed when eligibility returns BILL_NOT_FOUND', async () => {
      const { service, billingCycleRepo, roomRepo, billRepo } = setupMeterService();

      vi.spyOn(billingServiceModule, 'resolveBillDirectRecalculationEligibilityInTx').mockResolvedValue({
        eligible: false,
        code: 'BILL_NOT_FOUND',
        message: 'ไม่พบบิลที่ต้องการคำนวณใหม่',
      });

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
      } as any);

      await billRepo.create(
        DORM_ID,
        {
          id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
          billingCycleId: CYCLE_ID,
          roomId: ROOM_ID,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
        } as any,
        []
      );

      await expect(
        service.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            { roomId: ROOM_ID, waterCurr: '120', waterPrev: '100' },
          ],
        })
      ).rejects.toThrow('ไม่พบบิลที่ต้องการคำนวณใหม่');
    });

    it('Test 22.C: Active monthly bill propagates unexpected error from eligibility check', async () => {
      const { service, billingCycleRepo, roomRepo, billRepo } = setupMeterService();

      vi.spyOn(billingServiceModule, 'resolveBillDirectRecalculationEligibilityInTx').mockRejectedValue(
        new Error('DB transaction deadlock')
      );

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
      } as any);

      await billRepo.create(
        DORM_ID,
        {
          id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
          billingCycleId: CYCLE_ID,
          roomId: ROOM_ID,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
        } as any,
        []
      );

      await expect(
        service.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            { roomId: ROOM_ID, waterCurr: '120', waterPrev: '100' },
          ],
        })
      ).rejects.toThrow('DB transaction deadlock');
    });

    it('Test 22.D: Active monthly bill fails closed with BILL_HAS_FINANCIAL_EVIDENCE', async () => {
      const { service, billingCycleRepo, roomRepo, billRepo } = setupMeterService();

      vi.spyOn(billingServiceModule, 'resolveBillDirectRecalculationEligibilityInTx').mockResolvedValue({
        eligible: false,
        code: 'BILL_HAS_FINANCIAL_EVIDENCE',
        message: 'บิลนี้มีรายการชำระเงินหรือสลิปที่เกี่ยวข้องแล้ว\nไม่สามารถแก้ยอดโดยตรงได้',
      });

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });
      await billingCycleRepo.create(DORM_ID, {
        id: CYCLE_ID,
        cycleCode: '2026-08',
      } as any);

      await billRepo.create(
        DORM_ID,
        {
          id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
          billingCycleId: CYCLE_ID,
          roomId: ROOM_ID,
          billKind: 'MONTHLY_UTILITY',
          status: 'unpaid',
        } as any,
        []
      );

      await expect(
        service.saveBulkMeterWorkspace(DORM_ID, {
          billingCycleId: CYCLE_ID,
          rows: [
            { roomId: ROOM_ID, waterCurr: '120', waterPrev: '100' },
          ],
        })
      ).rejects.toThrow('บิลนี้มีรายการชำระเงินหรือสลิปที่เกี่ยวข้องแล้ว');
    });
  });

  describe('Group D: BillingService Preview Rate Authority (Section 19, 20, 32)', () => {
    it('Billing preview with inactive scalar rates returns waterRate="0.00" and electricityRate="0.00" for Tiered', async () => {
      vi.spyOn(billingOrchestrationService, 'resolveCyclePeopleCount').mockResolvedValue(1);
      const DORM_ID = 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      const CYCLE_ID = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
      const ROOM_ID = 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

      const billRepo = new InMemoryBillRepository();
      const billingCycleRepo = new InMemoryBillingCycleRepository();
      const roomRepo = new InMemoryRoomRepository();
      const tenantRepo = new InMemoryTenantRepository();
      const contractRepo = new InMemoryContractRepository();
      const meterRepo = new InMemoryMeterRepository();

      const billingService = new BillingService(
        billRepo,
        billingCycleRepo,
        meterRepo,
        contractRepo,
        roomRepo,
        tenantRepo
      );

      await tenantRepo.create(DORM_ID, {
        id: 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
        fullName: 'Test Tenant',
        phone: '0812345678',
      } as any);

      await roomRepo.create(DORM_ID, { id: ROOM_ID, roomNumber: '101', buildingId: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44' });

      await contractRepo.create(DORM_ID, {
        roomId: ROOM_ID,
        tenantId: 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
        status: 'active',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
        rentAmount: '5000.00',
      });

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
        waterBillingType: 'tiered',
        waterRate: '99.00', // Inactive scalar rate
        waterTierRates: productWaterTiers,
        electricityBillingType: 'tiered',
        electricityRate: '88.00', // Inactive scalar rate
        electricityTierRates: standardElecTiers,
        source: 'CYCLE_INIT',
      });

      // Seed meter readings
      await meterRepo.createReading(DORM_ID, {
        billingCycleId: CYCLE_ID,
        roomId: ROOM_ID,
        meterDeviceId: 'dev-w',
        meterType: 'water',
        previousReading: '100.00',
        currentReading: '115.00',
        usageUnits: '15.00',
      });
      await meterRepo.createReading(DORM_ID, {
        billingCycleId: CYCLE_ID,
        roomId: ROOM_ID,
        meterDeviceId: 'dev-e',
        meterType: 'electricity',
        previousReading: '1000.00',
        currentReading: '1151.00',
        usageUnits: '151.00',
      });

      const preview = await billingService.generateBillPreview(
        DORM_ID,
        CYCLE_ID,
        ROOM_ID,
        null,
        'MONTHLY_UTILITY'
      );

      // Inactive scalar rates (99.00, 88.00) MUST NOT be exposed in preview
      expect(preview.waterRate).toBe('0.00');
      expect(preview.electricityRate).toBe('0.00');
      expect(preview.waterUsage).toBe('15.00');
      expect(preview.waterAmount).toBe('55.25'); // Tiered calculation
      expect(preview.electricityUsage).toBe('151.00');
      expect(preview.electricityAmount).toBe('1159.00'); // Tiered calculation
      expect(preview.totalAmount).toBe('1214.25'); // 55.25 + 1159.00
    });
  });
});
