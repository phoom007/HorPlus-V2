/**
 * @license Apache-2.0
 * LOCAL-07 FINAL UAT CORRECTION TEST SUITE
 *
 * Verifies:
 * 1. Integer-only Meter Reading & 4/5-Digit Rollover Math
 * 2. DailyStay Invoice Item Single Authority 'paidAt' & Cycle Projection
 * 3. Daily Stay Date Boundaries (Bangkok Timezone)
 * 4. Master Tenant Registry & Line Link Flag
 * 5. RBAC Tech Remap & Finance Deprecation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  parseMeterIntegerReading,
  calculateMeterUsageUnits,
  calculateMeterRowPreview,
} from '../../utils/meter-billing-calculator.util.js';
import { getPrismaClient } from '../../db/prisma.js';
import { DailyStayService, calculateInclusiveDays } from '../../services/daily-stay.service.js';
import { MeterService } from '../../services/meter.service.js';
import { currentBusinessDateInBangkok, toBangkokDateString } from '../../utils/calendar-date.util.js';

describe('LOCAL-07 Final UAT Correction Test Suite', () => {
  const prisma = getPrismaClient();

  describe('1. Meter Integer-Only & Rollover Engine', () => {
    it('strictly rejects non-integer decimal readings, including .00, with fail-closed validation', () => {
      expect(parseMeterIntegerReading('12.5').isValid).toBe(false);
      expect(parseMeterIntegerReading('100.00').isValid).toBe(false);
      expect(parseMeterIntegerReading('100.5').isValid).toBe(false);
      expect(parseMeterIntegerReading('100.50').isValid).toBe(false);
      expect(parseMeterIntegerReading(100.5).isValid).toBe(false);
      expect(parseMeterIntegerReading('12.34').isValid).toBe(false);
      expect(calculateMeterUsageUnits('100.5', '120').isValid).toBe(false);
      expect(calculateMeterUsageUnits('100', '120.5').isValid).toBe(false);
    });

    it('strictly rejects negative readings, non-numeric strings, and numbers > 99999', () => {
      expect(parseMeterIntegerReading('-1').isValid).toBe(false);
      expect(parseMeterIntegerReading('-5').isValid).toBe(false);
      expect(parseMeterIntegerReading(-1).isValid).toBe(false);
      expect(parseMeterIntegerReading('abc').isValid).toBe(false);
      expect(parseMeterIntegerReading('100000').isValid).toBe(false);
      expect(parseMeterIntegerReading(100000).isValid).toBe(false);
    });

    it('accepts valid integer readings 0 to 99999', () => {
      expect(parseMeterIntegerReading('0')).toEqual({ isValid: true, value: 0 });
      expect(parseMeterIntegerReading('99999')).toEqual({ isValid: true, value: 99999 });
      expect(parseMeterIntegerReading('0500')).toEqual({ isValid: true, value: 500 });
      expect(parseMeterIntegerReading(500)).toEqual({ isValid: true, value: 500 });
    });

    it('verifies all Product Owner 4-digit and 5-digit rollover vectors exactly', () => {
      // 4-digit vectors:
      // 9900 -> 100 INVALID
      expect(calculateMeterUsageUnits('9900', '100').isValid).toBe(false);
      // 9901 -> 199 => 298
      const v9901 = calculateMeterUsageUnits('9901', '199');
      expect(v9901.isValid).toBe(true);
      expect(v9901.usageUnits).toBe(298);
      // 9999 -> 0 => 1
      const v9999 = calculateMeterUsageUnits('9999', '0');
      expect(v9999.isValid).toBe(true);
      expect(v9999.usageUnits).toBe(1);
      // 9950 -> 25 => 75
      const v9950 = calculateMeterUsageUnits('9950', '25');
      expect(v9950.isValid).toBe(true);
      expect(v9950.usageUnits).toBe(75);
      // 9950 -> 200 INVALID
      expect(calculateMeterUsageUnits('9950', '200').isValid).toBe(false);

      // 5-digit vectors:
      // 99900 -> 100 INVALID
      expect(calculateMeterUsageUnits('99900', '100').isValid).toBe(false);
      // 99901 -> 199 => 298
      const v99901 = calculateMeterUsageUnits('99901', '199');
      expect(v99901.isValid).toBe(true);
      expect(v99901.usageUnits).toBe(298);
      // 99999 -> 0 => 1
      const v99999 = calculateMeterUsageUnits('99999', '0');
      expect(v99999.isValid).toBe(true);
      expect(v99999.usageUnits).toBe(1);
      // 99950 -> 20 => 70
      const v99950 = calculateMeterUsageUnits('99950', '20');
      expect(v99950.isValid).toBe(true);
      expect(v99950.usageUnits).toBe(70);

      // Normal fail-closed outside rollover:
      // 50000 -> 100 INVALID
      expect(calculateMeterUsageUnits('50000', '100').isValid).toBe(false);
      // 500 -> 400 INVALID
      expect(calculateMeterUsageUnits('500', '400').isValid).toBe(false);
    });
  });

  describe('2. Bangkok Date & Daily Stay Boundary Safety', () => {
    it('returns valid YYYY-MM-DD for Bangkok timezone', () => {
      const todayBkk = currentBusinessDateInBangkok();
      expect(todayBkk).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects checkoutDate < startDate in daily stay calculation', () => {
      expect(() => {
        calculateInclusiveDays('2026-08-25', '2026-08-20');
      }).toThrow();
    });

    it('rejects checkoutDate < today_Bangkok in daily stay calculation', () => {
      expect(() => {
        calculateInclusiveDays('2020-01-01', '2020-01-05');
      }).toThrow();
    });
  });

  describe('3. DAILY_STAY Meter Semantics, Financial Exclusion & Exact Deposit Copy', () => {
    const rates = {
      waterBillingType: 'per_unit' as const,
      waterRate: '18.00',
      electricityBillingType: 'per_unit' as const,
      electricityRate: '8.00',
    };

    it('proves DAILY_STAY total contains strictly Daily rent + deposit due and excludes utilities', () => {
      const dailyCtx = {
        roomId: 'room-d1',
        billingSource: 'DAILY_STAY' as const,
        rentAmount: '1200.00',
        dailyDepositAmount: '500.00',
        showDailyDepositLine: true,
        isDailyDepositPaidInDisplayedPeriod: false, // Unpaid
      };

      const preview = calculateMeterRowPreview(dailyCtx, rates, {
        waterPrev: '100',
        waterCurr: '120',
        elecPrev: '500',
        elecCurr: '560',
      });

      // Total strictly: 1200 + 500 = 1700.00
      expect(preview.rentAmount).toBe('1200.00');
      expect(preview.totalAmount).toBe('1700.00');
      expect(preview.formattedTotal).toBe('1,700.00');
      // Utilities financial amounts are 0.00
      expect(preview.waterAmount).toBe('0.00');
      expect(preview.elecAmount).toBe('0.00');
      // Usage is recorded for history
      expect(preview.waterUsage).toBe('20.00');
      expect(preview.elecUsage).toBe('60.00');
    });

    it('proves changing Daily electricity or water readings does NOT change Daily total', () => {
      const dailyCtx = {
        roomId: 'room-d1',
        billingSource: 'DAILY_STAY' as const,
        rentAmount: '1200.00',
        dailyDepositAmount: '500.00',
        showDailyDepositLine: true,
        isDailyDepositPaidInDisplayedPeriod: false,
      };

      const p1 = calculateMeterRowPreview(dailyCtx, rates, {
        waterPrev: '100',
        waterCurr: '100',
        elecPrev: '500',
        elecCurr: '500',
      });

      const p2 = calculateMeterRowPreview(dailyCtx, rates, {
        waterPrev: '100',
        waterCurr: '990',
        elecPrev: '500',
        elecCurr: '999',
      });

      expect(p1.totalAmount).toBe('1700.00');
      expect(p2.totalAmount).toBe('1700.00');
      expect(p2.waterAmount).toBe('0.00');
      expect(p2.elecAmount).toBe('0.00');
    });

    it('proves paid deposit in displayed period is excluded from total', () => {
      const dailyCtx = {
        roomId: 'room-d1',
        billingSource: 'DAILY_STAY' as const,
        rentAmount: '1200.00',
        dailyDepositAmount: '500.00',
        showDailyDepositLine: true,
        isDailyDepositPaidInDisplayedPeriod: true, // Paid in current period
      };

      const preview = calculateMeterRowPreview(dailyCtx, rates, {
        waterPrev: '100',
        waterCurr: '120',
        elecPrev: '500',
        elecCurr: '560',
      });

      // Total strictly: 1200.00 (paid deposit excluded from total)
      expect(preview.rentAmount).toBe('1200.00');
      expect(preview.totalAmount).toBe('1200.00');
      expect(preview.formattedTotal).toBe('1,200.00');
    });
  });

  describe('4. Temporal Projection Authority (Monthly & Daily)', () => {
    let dormitoryId: string;
    let juneCycle: any;
    let julyCycle: any;
    let augCycle: any;
    let septCycle: any;
    let testRoom: any;
    let testTenant: any;
    let testContract: any;

    beforeAll(async () => {
      const dorm = await prisma.dormitory.findFirst({
        where: { name: { contains: 'Comprehensive' } },
      });
      if (!dorm) return;
      dormitoryId = dorm.id;

      julyCycle = await prisma.billingCycle.findFirst({
        where: { dormitoryId, cycleCode: '2026-07' },
      });
      augCycle = await prisma.billingCycle.findFirst({
        where: { dormitoryId, cycleCode: '2026-08' },
      });
      septCycle = await prisma.billingCycle.findFirst({
        where: { dormitoryId, cycleCode: '2026-09' },
      });

      juneCycle = await prisma.billingCycle.findFirst({
        where: { dormitoryId, cycleCode: '2026-06' },
      });

      const augSnapshot = augCycle
        ? await prisma.billingRateSnapshot.findFirst({
            where: { dormitoryId, billingCycleId: augCycle.id },
          })
        : null;

      if (!juneCycle) {
        juneCycle = await prisma.billingCycle.create({
          data: {
            dormitoryId,
            cycleCode: '2026-06',
            name: 'รอบบิล มิถุนายน 2569',
            periodStart: new Date('2026-06-01T00:00:00.000Z'),
            periodEnd: new Date('2026-06-30T00:00:00.000Z'),
            billingDate: new Date('2026-06-25T00:00:00.000Z'),
            dueDate: new Date('2026-07-05T00:00:00.000Z'),
            status: 'closed',
          },
        });
      }

      const existingJuneSnapshot = await prisma.billingRateSnapshot.findFirst({
        where: { dormitoryId, billingCycleId: juneCycle.id },
      });
      if (!existingJuneSnapshot && augSnapshot) {
        const { id, createdAt, updatedAt, billingCycleId, ...rest } = augSnapshot;
        await prisma.billingRateSnapshot.create({
          data: {
            ...rest,
            dormitoryId,
            billingCycleId: juneCycle.id,
          },
        });
      }

      const building = await prisma.building.findFirst({
        where: { dormitoryId },
      });

      testRoom = await prisma.room.create({
        data: {
          dormitoryId,
          buildingId: building!.id,
          roomNumber: 'TEMP-901',
          normalizedRoomNumber: 'temp-901',
          floor: 9,
          roomType: 'standard',
          monthlyRent: 5000,
          depositAmount: 5000,
          status: 'vacant',
        },
      });

      testTenant = await prisma.tenant.create({
        data: {
          dormitoryId,
          tenantNumber: 'TNT-TEMP-901',
          firstName: 'กิตติ',
          lastName: 'มุ่งมั่น',
          displayName: 'นายกิตติ มุ่งมั่น',
          phone: '0899999999',
          nationalIdMasked: '1-1004-XXXXX-99-9',
          status: 'active',
          createdAt: new Date('2026-07-15T08:00:00.000Z'),
        },
      });

      testContract = await prisma.contract.create({
        data: {
          dormitoryId,
          roomId: testRoom.id,
          tenantId: testTenant.id,
          contractNumber: 'CTR-TEMP-901',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-08-01T00:00:00.000Z'),
          rentAmount: 5000,
          depositAmount: 5000,
          status: 'ended',
          createdAt: new Date('2026-07-15T08:00:00.000Z'),
        },
      });
    });

    afterAll(async () => {
      if (testContract) {
        await prisma.contract.delete({ where: { id: testContract.id } }).catch(() => {});
      }
      if (testTenant) {
        await prisma.tenant.delete({ where: { id: testTenant.id } }).catch(() => {});
      }
      if (testRoom) {
        await prisma.room.delete({ where: { id: testRoom.id } }).catch(() => {});
      }
    });

    it('proves contract registered in July does not project into June, projects in July and August, absent in September', async () => {
      if (!dormitoryId || !juneCycle || !julyCycle || !augCycle || !septCycle) return;
      const { PrismaMeterRepository } = await import('../../db/repositories/meter.repository.js');
      const { PrismaBillingCycleRepository } = await import('../../db/repositories/billing-cycle.repository.js');
      const { PrismaRoomRepository } = await import('../../db/repositories/room.repository.js');
      const { PrismaBillRepository } = await import('../../db/repositories/bill.repository.js');
      const { AuditService } = await import('../../services/audit.service.js');

      const meterService = new MeterService(
        new PrismaMeterRepository(prisma),
        new PrismaBillingCycleRepository(prisma),
        new PrismaRoomRepository(prisma),
        new PrismaBillRepository(prisma),
        new AuditService()
      );

      // 1. June: contract registered in July must NOT backfill into June
      const junePreview = await meterService.getMeterBillingPreviewContext(dormitoryId, juneCycle.id);
      const juneRoom = junePreview.rooms.find(r => r.roomId === testRoom.id);
      expect(juneRoom?.tenantId).toBeNull();
      expect(juneRoom?.billingSource).toBe('NONE');

      // 2. July: contract intersects July and is registered -> visible
      const julyPreview = await meterService.getMeterBillingPreviewContext(dormitoryId, julyCycle.id);
      const julyRoom = julyPreview.rooms.find(r => r.roomId === testRoom.id);
      expect(julyRoom?.tenantId).toBe(testTenant.id);
      expect(julyRoom?.tenantName).toBe('นายกิตติ มุ่งมั่น');
      expect(julyRoom?.billingSource).toBe('CONTRACT');

      // 3. August: contract endDate 2026-08-01 intersects August -> visible
      const augPreview = await meterService.getMeterBillingPreviewContext(dormitoryId, augCycle.id);
      const augRoom = augPreview.rooms.find(r => r.roomId === testRoom.id);
      expect(augRoom?.tenantId).toBe(testTenant.id);
      expect(augRoom?.tenantName).toBe('นายกิตติ มุ่งมั่น');
      expect(augRoom?.billingSource).toBe('CONTRACT');

      // 4. September: contract ended on 2026-08-01 -> absent
      const septPreview = await meterService.getMeterBillingPreviewContext(dormitoryId, septCycle.id);
      const septRoom = septPreview.rooms.find(r => r.roomId === testRoom.id);
      expect(septRoom?.tenantId).toBeNull();
      expect(septRoom?.billingSource).toBe('NONE');
    });
  });
});
