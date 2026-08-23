/**
 * @license Apache-2.0
 * Comprehensive Integration Test: Central Utility Billing Mode Normalization & Missing Meter Baseline Authority
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import { getPrismaClient } from '../../db/prisma.js';
import { normalizeUtilityBillingMode, safeNormalizeUtilityBillingMode } from '../../utils/billing-mode-normalizer.util.js';
import { MeterService } from '../../services/meter.service.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { BillingService } from '../../services/billing.service.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';

describe('Local-07 Central Billing Mode Normalization & Missing Meter Baseline Authority', () => {
  const prisma = getPrismaClient();

  describe('Unit: Central Normalizer Authority', () => {
    it('normalizes per_unit variants to canonical per_unit', () => {
      expect(normalizeUtilityBillingMode('per_unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('PER_UNIT')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('UNIT')).toBe('per_unit');
      expect(normalizeUtilityBillingMode('per-unit')).toBe('per_unit');
      expect(normalizeUtilityBillingMode(' per_unit ')).toBe('per_unit');
    });

    it('normalizes per_person variants to canonical per_person', () => {
      expect(normalizeUtilityBillingMode('per_person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('person')).toBe('per_person');
      expect(normalizeUtilityBillingMode('PER_PERSON')).toBe('per_person');
      expect(normalizeUtilityBillingMode('PERSON')).toBe('per_person');
      expect(normalizeUtilityBillingMode('per-person')).toBe('per_person');
    });

    it('normalizes fixed variants to canonical fixed', () => {
      expect(normalizeUtilityBillingMode('fixed')).toBe('fixed');
      expect(normalizeUtilityBillingMode('room')).toBe('fixed');
      expect(normalizeUtilityBillingMode('per_room')).toBe('fixed');
      expect(normalizeUtilityBillingMode('FIXED')).toBe('fixed');
      expect(normalizeUtilityBillingMode('ROOM')).toBe('fixed');
      expect(normalizeUtilityBillingMode('per-room')).toBe('fixed');
    });

    it('fails closed on unknown or invalid modes', () => {
      expect(() => normalizeUtilityBillingMode('tier')).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode('custom')).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode('')).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode(null)).toThrow('INVALID_BILLING_MODE');
      expect(() => normalizeUtilityBillingMode(undefined)).toThrow('INVALID_BILLING_MODE');
    });

    it('safeNormalizeUtilityBillingMode falls back on null/undefined and fails closed on unknown', () => {
      expect(safeNormalizeUtilityBillingMode('unit', 'fixed')).toBe('per_unit');
      expect(() => safeNormalizeUtilityBillingMode('unknown', 'fixed')).toThrow('INVALID_BILLING_MODE');
      expect(safeNormalizeUtilityBillingMode(null, 'per_unit')).toBe('per_unit');
      expect(safeNormalizeUtilityBillingMode('', 'per_unit')).toBe('per_unit');
      expect(safeNormalizeUtilityBillingMode(undefined, 'fixed')).toBe('fixed');
    });
  });

  describe('Integration: Missing Baseline Precedence & Fail-Closed Validation', () => {
    const meterRepo = new PrismaMeterRepository(prisma);
    const cycleRepo = new PrismaBillingCycleRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const billRepo = new PrismaBillRepository(prisma);
    const tenantRepo = new PrismaTenantRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);

    const meterService = new MeterService(meterRepo, cycleRepo, roomRepo, billRepo);
    const billingService = new BillingService(billRepo, cycleRepo, meterRepo, contractRepo, roomRepo, tenantRepo);

    const testUserId = crypto.randomUUID();
    const testDormId = crypto.randomUUID();
    let cycle1Id: string;
    let cycle2Id: string;
    let roomId: string;
    let tenantId: string;
    let contractId: string;

    beforeAll(async () => {
      // 1. Create test user & dormitory
      const email = `norm-test-${Date.now()}@example.com`;
      await prisma.user.create({
        data: {
          id: testUserId,
          email,
          emailNormalized: email.toLowerCase().trim(),
          googleSubject: `google-sub-${Date.now()}`,
          name: 'Norm Tester',
        },
      });

      await prisma.dormitory.create({
        data: {
          id: testDormId,
          name: 'Baseline Authority Dorm',
          createdByUserId: testUserId,
          billingSettings: {
            create: {
              billingDay: 25,
              dueDay: 5,
              waterBillingType: 'unit', // legacy mode
              waterRate: '18.00',
              electricityBillingType: 'unit', // legacy mode
              electricityRate: '8.00',
              commonFee: '200.00',
              commonFeeMode: 'per_room',
              internetFee: '0.00',
              internetFeeMode: 'free',
              parkingRate: '0.00',
              parkingFeeMode: 'free',
              lateFeeType: 'none',
              lateFeeValue: '0.00',
              rentBillingType: 'monthly',
            },
          },
        },
      });

      const building = await prisma.building.create({
        data: {
          dormitoryId: testDormId,
          name: 'Building B',
        },
      });

      // Create a test room
      const room = await prisma.room.create({
        data: {
          dormitory: { connect: { id: testDormId } },
          building: { connect: { id: building.id } },
          roomNumber: 'B999',
          normalizedRoomNumber: 'b999',
          roomType: 'standard',
          monthlyRent: '4500.00',
          status: 'occupied',
          initialWaterReading: 0,
          initialElectricityReading: 0,
        },
      });
      roomId = room.id;

      // Create Tenant & Active Contract
      const tenant = await prisma.tenant.create({
        data: {
          dormitoryId: testDormId,
          tenantNumber: 'T-001',
          displayName: 'Somchai Tester',
          firstName: 'Somchai',
          lastName: 'Tester',
          phone: '0812345678',
        },
      });
      tenantId = tenant.id;

      const contract = await prisma.contract.create({
        data: {
          dormitoryId: testDormId,
          contractNumber: 'CTR-001',
          roomId,
          tenantId,
          status: 'active',
          startDate: new Date('2026-08-01T00:00:00Z'),
          endDate: new Date('2027-07-31T23:59:59Z'),
          rentAmount: '4500.00',
          depositAmount: '9000.00',
          rentBillingType: 'monthly',
        },
      });
      contractId = contract.id;

      // Create Cycle 1 (2026-08)
      const c1 = await prisma.billingCycle.create({
        data: {
          dormitoryId: testDormId,
          cycleCode: '2026-08',
          name: 'รอบบิล 2026-08',
          periodStart: new Date('2026-08-01T00:00:00Z'),
          periodEnd: new Date('2026-08-31T23:59:59Z'),
          billingDate: new Date('2026-08-25T00:00:00Z'),
          dueDate: new Date('2026-09-05T00:00:00Z'),
          status: 'active',
          rateSnapshot: {
            create: {
              dormitoryId: testDormId,
              waterBillingType: 'unit', // legacy write
              waterRate: '18.00',
              electricityBillingType: 'PER_UNIT', // legacy write
              electricityRate: '9.00',
              commonFee: '200.00',
              commonFeeMode: 'room',
              internetFee: '0.00',
              internetFeeMode: 'free',
              parkingFee: '0.00',
              parkingFeeMode: 'free',
              lateFeeType: 'none',
              lateFeeValue: '0.00',
              currency: 'THB',
              source: 'TEMPLATE_DEFAULT',
            },
          },
        },
      });
      cycle1Id = c1.id;

      // Create Cycle 2 (2026-09)
      const c2 = await prisma.billingCycle.create({
        data: {
          dormitoryId: testDormId,
          cycleCode: '2026-09',
          name: 'รอบบิล 2026-09',
          periodStart: new Date('2026-09-01T00:00:00Z'),
          periodEnd: new Date('2026-09-30T23:59:59Z'),
          billingDate: new Date('2026-09-25T00:00:00Z'),
          dueDate: new Date('2026-10-05T00:00:00Z'),
          status: 'draft',
          rateSnapshot: {
            create: {
              dormitoryId: testDormId,
              waterBillingType: 'per_unit',
              waterRate: '18.00',
              electricityBillingType: 'per_unit',
              electricityRate: '9.00',
              commonFee: '200.00',
              commonFeeMode: 'fixed',
              internetFee: '0.00',
              internetFeeMode: 'free',
              parkingFee: '0.00',
              parkingFeeMode: 'free',
              lateFeeType: 'none',
              lateFeeValue: '0.00',
              currency: 'THB',
              source: 'INHERITED',
              inheritedFromBillingCycleId: c1.id,
            },
          },
        },
      });
      cycle2Id = c2.id;
    });

    afterAll(async () => {
      // Clean up test data
      await prisma.meterReading.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.meterDevice.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.billItem.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.bill.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.contract.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: testDormId } });
      await prisma.dormitory.deleteMany({ where: { id: testDormId } });
      await prisma.user.deleteMany({ where: { id: testUserId } });
    });

    it('returns null when resolving authoritative previous reading on a room with null room baseline', async () => {
      // Spy on roomRepo to simulate a room with null initial readings
      const findSpy = vi.spyOn(roomRepo, 'findById').mockResolvedValueOnce({
        id: roomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'B999',
        normalizedRoomNumber: 'b999',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: null as any,
        initialElectricityReading: null as any,
      });

      const prevWater = await meterService.resolveAuthoritativePreviousReading(testDormId, cycle1Id, roomId, 'water');
      expect(prevWater).toBeNull();
      findSpy.mockRestore();
    });

    it('getMeterBillingPreviewContext returns canonical rateSnapshot modes for legacy DB rows', async () => {
      const ctx = await meterService.getMeterBillingPreviewContext(testDormId, cycle1Id);

      expect(ctx.rateSnapshot).toBeDefined();
      expect(ctx.rateSnapshot?.waterBillingType).toBe('per_unit');
      expect(ctx.rateSnapshot?.electricityBillingType).toBe('per_unit');
    });

    it('fails closed when submitting current reading while baseline is missing and no previous reading entered', async () => {
      // Mock roomRepo to return null baseline for this test
      const findSpy = vi.spyOn(roomRepo, 'findById').mockResolvedValue({
        id: roomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'B999',
        normalizedRoomNumber: 'b999',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: null as any,
        initialElectricityReading: null as any,
      });

      await expect(
        meterService.submitBulkReadings(
          testDormId,
          {
            billingCycleId: cycle1Id,
            readings: [
              {
                roomId,
                meterType: 'water',
                currentReading: '1300',
              } as any,
            ],
          },
          testUserId
        )
      ).rejects.toThrow('กรุณาระบุค่ามิเตอร์น้ำเดิมสำหรับห้องนี้');

      findSpy.mockRestore();
    });

    it('accepts explicit Owner-entered baseline (e.g. waterPrev=1250, waterCurr=1300) and calculates exact 50 units', async () => {
      const findSpy = vi.spyOn(roomRepo, 'findById').mockResolvedValue({
        id: roomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'B999',
        normalizedRoomNumber: 'b999',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: null as any,
        initialElectricityReading: null as any,
      });

      await meterService.submitBulkReadings(
        testDormId,
        {
          billingCycleId: cycle1Id,
          readings: [
            {
              roomId,
              meterType: 'water',
              previousReading: '1250',
              currentReading: '1300',
            },
            {
              roomId,
              meterType: 'electricity',
              previousReading: '0', // explicit 0 is valid!
              currentReading: '40',
            },
          ],
        },
        testUserId
      );

      findSpy.mockRestore();

      const waterReading = await meterRepo.findReadingByCycleRoomAndType(testDormId, cycle1Id, roomId, 'water');
      const elecReading = await meterRepo.findReadingByCycleRoomAndType(testDormId, cycle1Id, roomId, 'electricity');

      expect(waterReading).toBeDefined();
      expect(Number(waterReading?.previousReading)).toBe(1250);
      expect(Number(waterReading?.currentReading)).toBe(1300);
      expect(waterReading?.usageUnits).toBe('50.00');

      expect(elecReading).toBeDefined();
      expect(Number(elecReading?.previousReading)).toBe(0);
      expect(Number(elecReading?.currentReading)).toBe(40);
      expect(elecReading?.usageUnits).toBe('40.00');
    });

    it('next cycle N+1 automatically pulls the saved currentReading (1300 water, 40 elec) as authoritative baseline', async () => {
      const prevWaterCycle2 = await meterService.resolveAuthoritativePreviousReading(testDormId, cycle2Id, roomId, 'water');
      const prevElecCycle2 = await meterService.resolveAuthoritativePreviousReading(testDormId, cycle2Id, roomId, 'electricity');

      expect(prevWaterCycle2).toBe('1300');
      expect(prevElecCycle2).toBe('40');
    });

    it('second save in selected cycle preserves manual override previous reading (1250) and does NOT revert to N-1 (1200)', async () => {
      // Current state: cycle 1 has water reading (1250 -> 1300).
      // Now perform a second save in cycle 1 with waterCurr = 1310.
      await meterService.submitBulkReadings(
        testDormId,
        {
          billingCycleId: cycle1Id,
          readings: [
            {
              roomId,
              meterType: 'water',
              currentReading: '1310',
            } as any,
          ],
        },
        testUserId
      );

      const waterReading = await meterRepo.findReadingByCycleRoomAndType(testDormId, cycle1Id, roomId, 'water');
      expect(waterReading).toBeDefined();
      expect(Number(waterReading?.previousReading)).toBe(1250); // Preserved!
      expect(Number(waterReading?.currentReading)).toBe(1310);
      expect(waterReading?.usageUnits).toBe('60.00'); // 1310 - 1250 = 60
    });

    it('malformed higher-authority source fails closed and does NOT silently round decimals or fall back', async () => {
      const cleanRoomId = crypto.randomUUID();

      // Use a new clean cycle with no readings
      const testCycle = await prisma.billingCycle.create({
        data: {
          id: crypto.randomUUID(),
          dormitoryId: testDormId,
          cycleCode: `2026-MAL-${Date.now()}`,
          name: 'Mal Cycle',
          periodStart: new Date('2026-11-01T00:00:00.000Z'),
          periodEnd: new Date('2026-11-30T23:59:59.000Z'),
          billingDate: new Date('2026-11-25T00:00:00.000Z'),
          dueDate: new Date('2026-12-05T00:00:00.000Z'),
          status: 'open',
        },
      });

      // Level 4 (Room initial): Malformed non-numeric string ('abc')
      const findSpy1 = vi.spyOn(roomRepo, 'findById').mockResolvedValueOnce({
        id: cleanRoomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'BMAL',
        normalizedRoomNumber: 'bmal',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: 'abc' as any,
        initialElectricityReading: null as any,
      });

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findSpy1.mockRestore();

      // Level 4 (Room initial): Non-integer decimal string ('12.7') MUST NOT round to 13, must fail closed
      const findSpy2 = vi.spyOn(roomRepo, 'findById').mockResolvedValueOnce({
        id: cleanRoomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'BMAL',
        normalizedRoomNumber: 'bmal',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: '12.7' as any,
        initialElectricityReading: null as any,
      });

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findSpy2.mockRestore();

      // Level 4 (Room initial): Out of range (100000)
      const findSpy3 = vi.spyOn(roomRepo, 'findById').mockResolvedValueOnce({
        id: cleanRoomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'BMAL',
        normalizedRoomNumber: 'bmal',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: '100000' as any,
        initialElectricityReading: null as any,
      });

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findSpy3.mockRestore();

      // Level 4 (Room initial): Negative (-1)
      const findSpy4 = vi.spyOn(roomRepo, 'findById').mockResolvedValueOnce({
        id: cleanRoomId,
        dormitoryId: testDormId,
        buildingId: 'bld-id',
        roomNumber: 'BMAL',
        normalizedRoomNumber: 'bmal',
        floor: 1,
        roomType: 'standard',
        status: 'occupied',
        rentCycle: 'monthly',
        maximumOccupants: 2,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        initialWaterReading: '-1' as any,
        initialElectricityReading: null as any,
      });

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findSpy4.mockRestore();

      // Level 1: Selected-cycle previousReading malformed ('12.7')
      const findReadSpy1 = vi.spyOn(meterRepo, 'findReadingByCycleRoomAndType').mockResolvedValueOnce({
        id: 'r1',
        dormitoryId: testDormId,
        billingCycleId: testCycle.id,
        roomId: cleanRoomId,
        meterType: 'water',
        previousReading: '12.7' as any,
        currentReading: '50.00' as any,
        usageUnits: '37.30' as any,
        readAt: new Date(),
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findReadSpy1.mockRestore();

      // Level 3: MeterDevice initialReading malformed ('abc')
      const findDevSpy = vi.spyOn(meterRepo, 'findDeviceByRoomAndType').mockResolvedValueOnce({
        id: 'dev-1',
        dormitoryId: testDormId,
        roomId: cleanRoomId,
        meterType: 'water',
        meterNumber: 'M-001',
        initialReading: 'abc' as any,
        status: 'active',
        installedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      await expect(
        meterService.resolveAuthoritativePreviousReading(testDormId, testCycle.id, cleanRoomId, 'water')
      ).rejects.toThrow('INVALID_METER_READING');
      findDevSpy.mockRestore();

      await prisma.billingCycle.delete({ where: { id: testCycle.id } });
    });
  });
});
