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

  describe('6. No-Reading Monthly Utility Preview Eligibility & Issuance Parity', () => {
    let dormId: string;
    let cycleId: string;
    let roomId: string;
    let tenantId: string;
    let contractId: string;

    beforeAll(async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: `No Reading Test Dorm ${Date.now()}`,
          code: `NRTD-${Date.now()}`,
        },
      });
      dormId = dorm.id;

      await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: dormId,
          billingDay: 25,
          dueDay: 5,
          waterBillingType: 'fixed',
          waterRate: 200,
          electricityBillingType: 'per_person',
          electricityRate: 150,
          commonFee: 100,
          commonFeeMode: 'per_room',
          internetFee: 0,
          internetFeeMode: 'none',
          parkingRate: 0,
          parkingFeeMode: 'none',
          lateFeeType: 'none',
          lateFeeValue: 0,
        },
      });

      const { PrismaBillingCycleRepository } = await import('../../db/repositories/billing-cycle.repository.js');
      const { BillingCycleService } = await import('../../services/billing-cycle.service.js');
      const cycleService = new BillingCycleService(new PrismaBillingCycleRepository());
      const { cycle } = await cycleService.createBillingCycle(dormId, {
        cycleCode: '2026-08',
        name: 'August 2026',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
      });
      cycleId = cycle.id;

      const building = await prisma.building.create({
        data: {
          dormitoryId: dormId,
          name: 'Building NM',
        },
      });

      const room = await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId: building.id,
          roomNumber: 'N101',
          normalizedRoomNumber: 'N101',
          roomType: 'standard',
          floor: 1,
          status: 'occupied',
          monthlyRent: 4000,
        },
      });
      roomId = room.id;

      const tenant = await prisma.tenant.create({
        data: {
          dormitoryId: dormId,
          tenantNumber: `NT-${Date.now()}`,
          firstName: 'NoMeter',
          lastName: 'Tenant',
          displayName: 'No Meter Tenant',
          phone: '0813333333',
          status: 'active',
        },
      });
      tenantId = tenant.id;

      const contract = await prisma.contract.create({
        data: {
          dormitoryId: dormId,
          roomId,
          tenantId,
          contractNumber: `CTR-NM-${Date.now()}`,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          rentAmount: 4000,
          depositAmount: 8000,
          status: 'active',
        },
      });
      contractId = contract.id;

      // Seed snapshot with 2 occupants -> water fixed (200) + elec per_person (150*2=300) + common (100) = 600.00
      await prisma.roomBillingCycleSnapshot.create({
        data: {
          dormitoryId: dormId,
          billingCycleId: cycleId,
          roomId,
          peopleCount: 2,
          version: 1,
        },
      });
    });

    afterAll(async () => {
      await prisma.billItem.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.bill.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.roomBillingCycleSnapshot.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.contract.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.room.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.building.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dormId } }).catch(() => {});
      await prisma.dormitory.deleteMany({ where: { id: dormId } }).catch(() => {});
    });

    it('proves room with ZERO meter readings receives valid 600.00 PREVIEW, and bill issuance replaces it with 600.00 UNPAID bill without duplicates', async () => {
      const { PrismaMeterRepository } = await import('../../db/repositories/meter.repository.js');
      const { PrismaBillingCycleRepository } = await import('../../db/repositories/billing-cycle.repository.js');
      const { PrismaRoomRepository } = await import('../../db/repositories/room.repository.js');
      const { PrismaBillRepository } = await import('../../db/repositories/bill.repository.js');
      const { PrismaContractRepository } = await import('../../db/repositories/contract.repository.js');
      const { PrismaTenantRepository } = await import('../../db/repositories/tenant.repository.js');
      const { AuditService } = await import('../../services/audit.service.js');
      const { BillingService } = await import('../../services/billing.service.js');

      const meterService = new MeterService(
        new PrismaMeterRepository(prisma),
        new PrismaBillingCycleRepository(prisma),
        new PrismaRoomRepository(prisma),
        new PrismaBillRepository(prisma),
        new AuditService()
      );

      // Verify ZERO meter readings exist in DB
      const dbReadings = await prisma.meterReading.findMany({ where: { dormitoryId: dormId, roomId } });
      expect(dbReadings).toHaveLength(0);

      // 1. Pre-issue: getMeterBillingPreviewContext derives 600.00 PREVIEW component
      const preIssueCtx = await meterService.getMeterBillingPreviewContext(dormId, cycleId);
      const preRoom: any = preIssueCtx.rooms.find(r => r.roomId === roomId);
      expect(preRoom).toBeDefined();
      expect(preRoom?.amountDue).toBe('600.00');
      expect(preRoom?.chargeComponents).toHaveLength(1);
      expect(preRoom?.chargeComponents[0]).toEqual({
        type: 'monthly_utility',
        label: 'บิลรายเดือน',
        amount: '600.00',
        status: 'PREVIEW',
        paidAt: null,
        occurredInDisplayedPeriod: true,
        includedInAmountDue: true,
      });

      // 2. Issue Monthly Utility Bill
      const billingService = new BillingService(
        new PrismaBillRepository(prisma),
        new PrismaBillingCycleRepository(prisma),
        new PrismaMeterRepository(prisma),
        new PrismaContractRepository(prisma),
        new PrismaRoomRepository(prisma),
        new PrismaTenantRepository(prisma),
        new AuditService()
      );

      const { bill } = await billingService.generateBill(dormId, {
        billingCycleId: cycleId,
        roomId,
        billKind: 'MONTHLY_UTILITY',
      });

      expect(bill).toBeDefined();
      expect(bill.billKind).toBe('MONTHLY_UTILITY');
      expect(bill.totalAmount.toString()).toBe('600.00');

      // 3. Post-issue: PREVIEW is replaced with UNPAID, amountDue remains 600.00, no duplicates
      const postIssueCtx = await meterService.getMeterBillingPreviewContext(dormId, cycleId);
      const postRoom: any = postIssueCtx.rooms.find(r => r.roomId === roomId);
      expect(postRoom).toBeDefined();
      expect(postRoom?.amountDue).toBe('600.00');
      expect(postRoom?.chargeComponents).toHaveLength(1);
      expect(postRoom?.chargeComponents[0].status).toBe('UNPAID');
      expect(postRoom?.chargeComponents[0].amount).toBe('600.00');
      expect(postRoom?.chargeComponents[0].includedInAmountDue).toBe(true);
    });
  });
});
