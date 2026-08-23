import {
  IMeterRepository,
  MeterDeviceEntity,
  MeterReadingEntity,
  MeterReplacementEntity,
  MeterReadingFilterQuery,
  PrismaMeterRepository,
} from '../db/repositories/meter.repository.js';
import { IBillingCycleRepository, PrismaBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { IRoomRepository, PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { IBillRepository, PrismaBillRepository } from '../db/repositories/bill.repository.js';
import { AuditService } from './audit.service.js';
import { billingOrchestrationService } from './billing-orchestration.service.js';
import { ENTITLEMENT_ROOM_LIMITS } from './entitlement.service.js';
import { subscriptionEntitlementService } from './subscription-entitlement.service.js';
import { AppError } from '../types/index.js';
import { getPrismaClient } from '../db/prisma.js';
import { toDecimal, formatDecimal, compareDecimals, divDecimals, mulDecimals, subDecimals, addDecimals } from '../utils/decimal-math.util.js';
import { calculateInstallmentSchedule } from '../utils/installment-calculator.util.js';
import { currentBusinessDateInBangkok, toBangkokDateString, normalizeBangkokDate, getBangkokStartOfDayUtc } from '../utils/calendar-date.util.js';
import { calculateMeterUsageUnits, parseMeterIntegerReading } from '../utils/meter-billing-calculator.util.js';
import { normalizeUtilityBillingMode } from '../utils/billing-mode-normalizer.util.js';
import { resolveDailyTimestampsAndPricing } from './daily-stay.service.js';
import {
  getContractPhysicalInterval,
  getProvisionalTermPhysicalInterval,
  getDailyStayPhysicalInterval,
  doHalfOpenIntervalsOverlap,
  hasBookableGapInCycle,
} from '../utils/occupancy-interval.util.js';

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export interface CreateMeterDeviceDto {
  roomId: string;
  type: 'water' | 'electricity';
  meterNumber: string;
  initialReading?: string;
  installedAt?: string;
}

export interface ReplaceMeterDto {
  roomId: string;
  meterType: 'water' | 'electricity';
  oldMeterFinalReading: string;
  newMeterNumber: string;
  newMeterInitialReading?: string;
  replacementDate?: string;
  reason?: string;
}

export interface BulkMeterReadingItemDto {
  roomId: string;
  meterType: 'water' | 'electricity';
  meterDeviceId?: string;
  previousReading?: string;
  currentReading: string;
  previousReadingOverride?: boolean;
  readAt?: string;
  notes?: string;
}

export interface BulkMeterReadingDto {
  billingCycleId: string;
  readings: BulkMeterReadingItemDto[];
}

export interface SavedRoomSnapshotMeta {
  roomId: string;
  version: number;
  peopleCount: number;
  manualOutstandingAmount: string;
  otherFees: Array<{ description: string; amount: string }>;
}

function parseAuthoritativeMeterReading(
  raw: unknown,
  sourceLabel: string
): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const str = String(raw).trim();
  if (str === '') {
    return null;
  }

  // Strict integer format with optional .00 (PostgreSQL Decimal formatting e.g. '1250.00' or '0.00')
  // Rejects non-zero fractional decimals like '12.7', '12.70', '100.5'
  if (!/^\d+(\.0+)?$/.test(str)) {
    const err = new Error(`INVALID_METER_READING: Persisted ${sourceLabel} '${str}' is not a valid meter integer`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_METER_READING';
    throw err;
  }

  const intPart = str.split('.')[0];
  const num = Number(intPart);
  if (isNaN(num) || num < 0 || num > 99999) {
    const err = new Error(`INVALID_METER_READING: Persisted ${sourceLabel} '${str}' is out of valid range (0..99999)`);
    (err as any).statusCode = 400;
    (err as any).code = 'INVALID_METER_READING';
    throw err;
  }

  return String(num);
}

export class MeterService {
  constructor(
    private meterRepo: IMeterRepository = new PrismaMeterRepository(getPrismaClient()),
    private billingCycleRepo: IBillingCycleRepository = new PrismaBillingCycleRepository(getPrismaClient()),
    private roomRepo: IRoomRepository = new PrismaRoomRepository(getPrismaClient()),
    private billRepo?: IBillRepository,
    private auditService?: AuditService
  ) {}

  // --- Meter Devices ---
  public async createMeterDevice(
    dormitoryId: string,
    data: CreateMeterDeviceDto,
    userId?: string
  ): Promise<MeterDeviceEntity> {
    const room = await this.roomRepo.findById(data.roomId, dormitoryId);
    if (!room) {
      const err = new Error('ROOM_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'ROOM_NOT_FOUND';
      throw err;
    }

    const existing = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, data.roomId, data.type);
    if (existing) {
      const err = new Error('ACTIVE_METER_ALREADY_EXISTS');
      (err as any).statusCode = 409;
      (err as any).code = 'ACTIVE_METER_ALREADY_EXISTS';
      throw err;
    }

    const device = await this.meterRepo.createDevice(dormitoryId, {
      roomId: data.roomId,
      type: data.type,
      meterNumber: data.meterNumber,
      initialReading: data.initialReading || '0.00',
      installedAt: data.installedAt ? new Date(data.installedAt) : undefined,
    });

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'meter_device.create',
        resourceType: 'meter_device',
        resourceId: device.id,
        details: { roomId: data.roomId, type: data.type, meterNumber: data.meterNumber },
      });
    }

    return device;
  }

  public async getMeterDevicesByRoom(dormitoryId: string, roomId: string): Promise<MeterDeviceEntity[]> {
    return this.meterRepo.listDevicesByRoom(dormitoryId, roomId);
  }

  public async replaceMeterDevice(
    dormitoryId: string,
    data: ReplaceMeterDto,
    userId?: string
  ): Promise<{ oldDevice: MeterDeviceEntity; newDevice: MeterDeviceEntity; replacement: MeterReplacementEntity }> {
    const oldDevice = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, data.roomId, data.meterType);
    if (!oldDevice) {
      const err = new Error('ACTIVE_METER_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'ACTIVE_METER_NOT_FOUND';
      throw err;
    }

    const replacementDate = data.replacementDate ? new Date(data.replacementDate) : new Date();

    // 1. Mark old device as replaced
    const updatedOld = await this.meterRepo.updateDevice(
      oldDevice.id,
      dormitoryId,
      {
        status: 'replaced',
        removedAt: replacementDate,
        currentReading: data.oldMeterFinalReading,
      },
      oldDevice.version
    );

    if (!updatedOld) {
      const err = new Error('METER_UPDATE_FAILED');
      (err as any).statusCode = 500;
      (err as any).code = 'METER_UPDATE_FAILED';
      throw err;
    }

    // 2. Create new active device
    const newDevice = await this.meterRepo.createDevice(dormitoryId, {
      roomId: data.roomId,
      type: data.meterType,
      meterNumber: data.newMeterNumber,
      initialReading: data.newMeterInitialReading || '0.00',
      installedAt: replacementDate,
      status: 'active',
    });

    // 3. Record replacement log
    const replacement = await this.meterRepo.createReplacement(dormitoryId, {
      roomId: data.roomId,
      meterType: data.meterType,
      oldMeterDeviceId: oldDevice.id,
      newMeterDeviceId: newDevice.id,
      oldMeterFinalReading: data.oldMeterFinalReading,
      newMeterInitialReading: data.newMeterInitialReading || '0.00',
      replacementDate,
      reason: data.reason,
      createdByUserId: userId,
    });

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'meter_device.replace',
        resourceType: 'meter_device',
        resourceId: newDevice.id,
        details: { oldDeviceId: oldDevice.id, newDeviceId: newDevice.id, reason: data.reason },
      });
    }

    return { oldDevice: updatedOld, newDevice, replacement };
  }

  public async resolveAuthoritativePreviousReading(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    meterType: 'water' | 'electricity',
    tx?: any
  ): Promise<string | null> {
    const client = tx || getPrismaClient();

    // 1. Selected-cycle persisted MeterReading.previousReading (Highest Authority)
    const selectedReading = await this.meterRepo.findReadingByCycleRoomAndType(
      dormitoryId,
      billingCycleId,
      roomId,
      meterType,
      client
    );
    if (selectedReading && selectedReading.previousReading !== null && selectedReading.previousReading !== undefined && String(selectedReading.previousReading).trim() !== '') {
      return parseAuthoritativeMeterReading(selectedReading.previousReading, 'selected-cycle previous reading');
    }

    // 2. Most recent prior-cycle MeterReading.currentReading
    const cycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (cycle) {
      const cycles = await this.billingCycleRepo.findAll(dormitoryId, { sortDirection: 'desc', pageSize: 100 });
      const currentStart = new Date(cycle.periodStart).getTime();
      const priorCycles = cycles.items
        .filter((c) => new Date(c.periodStart).getTime() < currentStart)
        .sort((a, b) => new Date(b.periodStart).getTime() - new Date(a.periodStart).getTime());

      for (const priorCycle of priorCycles) {
        const priorReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          priorCycle.id,
          roomId,
          meterType,
          client
        );
        if (priorReading && priorReading.currentReading !== null && priorReading.currentReading !== undefined && String(priorReading.currentReading).trim() !== '') {
          return parseAuthoritativeMeterReading(priorReading.currentReading, 'prior-cycle current reading');
        }
      }
    }

    // 3. Active MeterDevice initial reading
    const device = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, roomId, meterType, client);
    if (device && device.initialReading !== undefined && device.initialReading !== null && String(device.initialReading).trim() !== '') {
      return parseAuthoritativeMeterReading(device.initialReading, 'meter device initial reading');
    }

    // 4. Room initial meter value
    const room = await this.roomRepo.findById(roomId, dormitoryId);
    if (room) {
      const roomObj = room as any;
      if (meterType === 'water') {
        const val = room.initialWaterReading ?? roomObj.initialWaterMeter;
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return parseAuthoritativeMeterReading(val, 'room initial reading');
        }
      }
      if (meterType === 'electricity') {
        const val = room.initialElectricityReading ?? roomObj.initialElectricMeter;
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return parseAuthoritativeMeterReading(val, 'room initial reading');
        }
      }
    }

    // 5. No authoritative baseline exists (NONE)
    return null;
  }

  // --- Meter Readings ---
  public async submitBulkReadings(
    dormitoryId: string,
    data: BulkMeterReadingDto,
    userId?: string
  ): Promise<MeterReadingEntity[]> {
    const cycle = await this.billingCycleRepo.findById(data.billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    if (cycle.status === 'locked' || cycle.status === 'completed') {
      const err = new Error('BILLING_CYCLE_LOCKED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILLING_CYCLE_LOCKED';
      throw err;
    }

    const createdReadings: MeterReadingEntity[] = [];

    return this.meterRepo.withTransaction(async (tx) => {
      // Sort rooms to avoid deadlocks
      const sortedRooms = [...new Set(data.readings.map((r) => r.roomId))].sort();
      for (const roomId of sortedRooms) {
        await this.meterRepo.executeRawLock(roomId, tx);
      }

      for (const item of data.readings) {
        if (this.billRepo) {
          const activeBill = await this.billRepo.findByCycleAndRoom(dormitoryId, data.billingCycleId, item.roomId);
          if (activeBill && activeBill.status !== 'cancelled' && activeBill.status !== 'void') {
            const err = new Error('METER_MODIFICATION_BLOCKED_BY_BILL');
            (err as any).statusCode = 400;
            (err as any).code = 'METER_MODIFICATION_BLOCKED_BY_BILL';
            (err as any).message = 'ไม่สามารถแก้ไขค่ามิเตอร์ได้เนื่องจากมีการออกบิลแล้ว';
            throw err;
          }
        }

        // Derive authoritative previous reading from server DB
        const authDbPrev = await this.resolveAuthoritativePreviousReading(
          dormitoryId,
          data.billingCycleId,
          item.roomId,
          item.meterType,
          tx
        );

        const suppliedPrev = (item.previousReading !== undefined && item.previousReading !== null && String(item.previousReading).trim() !== '')
          ? parseAuthoritativeMeterReading(item.previousReading, 'user-entered previous reading')
          : null;

        let authPrev: string;

        if (item.previousReadingOverride === true) {
          // Explicit Owner-authorized manual override
          if (suppliedPrev === null) {
            const typeThai = item.meterType === 'water' ? 'น้ำ' : 'ไฟฟ้า';
            const err = new Error(`กรุณาระบุค่ามิเตอร์${typeThai}เดิมสำหรับการ override`);
            (err as any).statusCode = 400;
            (err as any).code = 'MISSING_PREVIOUS_METER_READING';
            throw err;
          }
          authPrev = suppliedPrev;
        } else {
          // Normal path: enforce server authority and reject conflicting payload without silent discard
          if (authDbPrev !== null) {
            if (suppliedPrev !== null && Number(suppliedPrev) !== Number(authDbPrev)) {
              const typeThai = item.meterType === 'water' ? 'น้ำ' : 'ไฟฟ้า';
              const err = new Error(`PREVIOUS_READING_CONFLICT: ค่ามิเตอร์${typeThai}เดิมที่ส่งมา (${suppliedPrev}) ไม่ตรงกับฐานข้อมูล (${authDbPrev}) และไม่ได้ระบุ previousReadingOverride`);
              (err as any).statusCode = 400;
              (err as any).code = 'PREVIOUS_READING_CONFLICT';
              throw err;
            }
            authPrev = authDbPrev;
          } else {
            // Missing server baseline -> accept supplied previous reading
            if (suppliedPrev === null) {
              const typeThai = item.meterType === 'water' ? 'น้ำ' : 'ไฟฟ้า';
              const err = new Error(`กรุณาระบุค่ามิเตอร์${typeThai}เดิมสำหรับห้องนี้`);
              (err as any).statusCode = 400;
              (err as any).code = 'MISSING_PREVIOUS_METER_READING';
              throw err;
            }
            authPrev = suppliedPrev;
          }
        }
        const prevVal = Number(authPrev);
        const currVal = Number(item.currentReading);

        if (isNaN(prevVal) || isNaN(currVal) || prevVal < 0 || currVal < 0) {
          const err = new Error(`INVALID_METER_READING_VALUE`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          (err as any).message = `ค่ามิเตอร์ต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0`;
          throw err;
        }

        if (currVal < prevVal) {
          const err = new Error(`CURRENT_READING_LESS_THAN_PREVIOUS`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          (err as any).message = `ค่ามิเตอร์ปัจจุบัน (${currVal}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${prevVal})`;
          throw err;
        }

        let device = item.meterDeviceId
          ? await this.meterRepo.findDeviceById(item.meterDeviceId, dormitoryId, tx)
          : await this.meterRepo.findDeviceByRoomAndType(dormitoryId, item.roomId, item.meterType, tx);

        if (!device) {
          // Auto-create active device if missing
          device = await this.meterRepo.createDevice(
            dormitoryId,
            {
              roomId: item.roomId,
              type: item.meterType,
              meterNumber: `${item.meterType.toUpperCase()}-${item.roomId.slice(-4)}`,
              initialReading: authPrev,
            },
            tx
          );
        }

        const usageUnits = (currVal - prevVal).toFixed(2);

        const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          data.billingCycleId,
          item.roomId,
          item.meterType,
          tx
        );

        let reading: MeterReadingEntity;
        if (existingReading) {
          const updated = await this.meterRepo.updateReading(
            existingReading.id,
            dormitoryId,
            {
              previousReading: authPrev,
              currentReading: item.currentReading,
              usageUnits,
              readAt: item.readAt ? new Date(item.readAt) : new Date(),
              readByUserId: userId,
              notes: item.notes,
            },
            existingReading.version,
            tx
          );
          reading = updated!;
        } else {
          reading = await this.meterRepo.createReading(
            dormitoryId,
            {
              billingCycleId: data.billingCycleId,
              roomId: item.roomId,
              meterDeviceId: device.id,
              meterType: item.meterType,
              previousReading: authPrev,
              currentReading: item.currentReading,
              usageUnits,
              readAt: item.readAt ? new Date(item.readAt) : new Date(),
              readByUserId: userId,
              status: 'draft',
              notes: item.notes,
            },
            tx
          );
        }
        createdReadings.push(reading);
      }
      return createdReadings;
    }).then(async (readings) => {
      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: userId || 'system',
          action: 'meter_reading.bulk_submit',
          resourceType: 'billing_cycle',
          resourceId: data.billingCycleId,
          details: { count: readings.length },
        });
      }
      return readings;
    });
  }

  public async getMeterReadings(
    dormitoryId: string,
    filter: MeterReadingFilterQuery = {}
  ): Promise<{ items: MeterReadingEntity[]; total: number }> {
    return this.meterRepo.listReadings(dormitoryId, filter);
  }

  public async updateMeterReading(
    id: string,
    dormitoryId: string,
    currentReading: string,
    notes?: string,
    expectedVersion?: number,
    userId?: string
  ): Promise<MeterReadingEntity> {
    const reading = await this.meterRepo.findReadingById(id, dormitoryId);
    if (!reading) {
      const err = new Error('METER_READING_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'METER_READING_NOT_FOUND';
      throw err;
    }

    if (this.billRepo) {
      const activeBill = await this.billRepo.findByCycleAndRoom(dormitoryId, reading.billingCycleId, reading.roomId);
      if (activeBill && activeBill.status !== 'cancelled' && activeBill.status !== 'void') {
        const err = new Error('METER_MODIFICATION_BLOCKED_BY_BILL');
        (err as any).statusCode = 400;
        (err as any).code = 'METER_MODIFICATION_BLOCKED_BY_BILL';
        (err as any).message = 'ไม่สามารถแก้ไขค่ามิเตอร์ได้เนื่องจากมีการออกบิลแล้ว';
        throw err;
      }
    }

    const prevReadingStr = String(reading.previousReading || '').replace(/\.00$/, '');
    const usageRes = calculateMeterUsageUnits(prevReadingStr, currentReading);
    if (!usageRes.isValid) {
      const err = new Error(usageRes.errorMessage || 'INVALID_METER_READING_VALUE');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_METER_READING';
      (err as any).message = usageRes.errorMessage || `ค่ามิเตอร์ไม่ถูกต้อง`;
      throw err;
    }

    const usageUnits = usageRes.usageUnits.toFixed(2);
    const updated = await this.meterRepo.updateReading(
      id,
      dormitoryId,
      {
        currentReading,
        usageUnits,
        notes: notes !== undefined ? notes : reading.notes,
      },
      expectedVersion
    );

    if (!updated) {
      if (expectedVersion !== undefined && reading.version !== expectedVersion) {
        const err = new Error('STALE_VERSION');
        (err as any).statusCode = 409;
        (err as any).code = 'STALE_VERSION';
        (err as any).message = 'ข้อมูลถูกแก้ไขโดยผู้อื่นแล้ว กรุณารีเฟรชข้อมูล';
        throw err;
      }
      const err = new Error('METER_READING_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'METER_READING_NOT_FOUND';
      throw err;
    }

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'meter_reading.update',
        resourceType: 'meter_reading',
        resourceId: id,
        details: { currentReading, usageUnits },
      });
    }

    return updated;
  }

  public async saveSingleRoomWorkspaceInTx(
    dormitoryId: string,
    billingCycleId: string,
    row: SaveMeterWorkspaceRowDto,
    userId: string | undefined,
    tx: any,
    rateSnapshot?: any,
    isFirstCycle?: boolean
  ): Promise<SavedRoomSnapshotMeta> {
    // 0. Assert room operational entitlement before saving workspace state
    await subscriptionEntitlementService.assertRoomOperationalEntitlement(
      dormitoryId,
      row.roomId,
      new Date(),
      tx
    );

    const prisma = getPrismaClient();
    const client = tx || prisma;

    let snapshot = rateSnapshot;
    if (!snapshot) {
      snapshot = await this.billingCycleRepo.findRateSnapshot(billingCycleId, dormitoryId);
    }
    const waterMode = normalizeUtilityBillingMode(snapshot?.waterBillingType || 'per_unit');
    const elecMode = normalizeUtilityBillingMode(snapshot?.electricityBillingType || 'per_unit');

    let firstCycle = isFirstCycle;
    if (firstCycle === undefined) {
      const earliest = await client.billingCycle.findFirst({
        where: { dormitoryId },
        orderBy: { periodStart: 'asc' },
      });
      firstCycle = earliest ? earliest.id === billingCycleId : false;
    }

    // 1. Water reading if entered and per_unit
    if (
      (row.waterCurr !== undefined && row.waterCurr !== null && String(row.waterCurr).trim() !== '') ||
      (row.waterPrev !== undefined && row.waterPrev !== null && String(row.waterPrev).trim() !== '')
    ) {
      if (waterMode === 'per_unit') {
        let authPrev: string | null = null;
        if (row.waterPrev !== undefined && row.waterPrev !== null && String(row.waterPrev).trim() !== '') {
          const parsed = parseMeterIntegerReading(row.waterPrev);
          if (!parsed.isValid) {
            const err = new Error(parsed.errorMessage || `ค่ามิเตอร์น้ำเดิมไม่ถูกต้อง: ${row.waterPrev}`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            throw err;
          }
          authPrev = String(parsed.value);
        } else {
          const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
            dormitoryId,
            billingCycleId,
            row.roomId,
            'water',
            tx
          );
          if (existingReading && existingReading.previousReading !== undefined && existingReading.previousReading !== null) {
            authPrev = String(existingReading.previousReading).replace(/\.00$/, '');
          } else {
            authPrev = await this.resolveAuthoritativePreviousReading(
              dormitoryId,
              billingCycleId,
              row.roomId,
              'water',
              tx
            );
          }
        }

        if (authPrev === null) {
          const err = new Error(`กรุณาระบุค่ามิเตอร์น้ำเดิมสำหรับห้องนี้`);
          (err as any).statusCode = 400;
          (err as any).code = 'MISSING_PREVIOUS_METER_READING';
          throw err;
        }

        const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          billingCycleId,
          row.roomId,
          'water',
          tx
        );

        let currWaterInt: string | null = null;
        if (row.waterCurr !== undefined && row.waterCurr !== null && String(row.waterCurr).trim() !== '') {
          const parsedCurr = parseMeterIntegerReading(row.waterCurr);
          if (!parsedCurr.isValid) {
            const err = new Error(parsedCurr.errorMessage || `ค่ามิเตอร์น้ำปัจจุบันไม่ถูกต้อง: ${row.waterCurr}`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            throw err;
          }
          currWaterInt = String(parsedCurr.value);
        } else if (existingReading?.currentReading) {
          currWaterInt = String(existingReading.currentReading).replace(/\.00$/, '');
        }

        let usageUnits = '0.00';
        if (currWaterInt !== null && currWaterInt !== undefined && currWaterInt !== '') {
          const usageRes = calculateMeterUsageUnits(authPrev, currWaterInt);
          if (!usageRes.isValid) {
            const err = new Error(usageRes.errorMessage || `ค่ามิเตอร์น้ำปัจจุบัน (${currWaterInt}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${authPrev})`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            (err as any).message = usageRes.errorMessage || `ค่ามิเตอร์น้ำปัจจุบัน (${currWaterInt}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${authPrev})`;
            throw err;
          }
          usageUnits = String(usageRes.usageUnits);
        }

        let device = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, row.roomId, 'water', tx);
        if (!device) {
          device = await this.meterRepo.createDevice(
            dormitoryId,
            {
              roomId: row.roomId,
              type: 'water',
              meterNumber: `WATER-${row.roomId.slice(-4)}`,
              initialReading: authPrev,
            },
            tx
          );
        } else if (firstCycle && row.waterPrev !== undefined) {
          await this.meterRepo.updateDevice(
            device.id,
            dormitoryId,
            { initialReading: authPrev },
            device.version,
            tx
          );
        }

        if (existingReading) {
          await this.meterRepo.updateReading(
            existingReading.id,
            dormitoryId,
            {
              previousReading: authPrev,
              ...(currWaterInt !== null ? { currentReading: currWaterInt, usageUnits } : {}),
              readAt: new Date(),
              readByUserId: userId,
            },
            existingReading.version,
            tx
          );
        } else {
          await this.meterRepo.createReading(
            dormitoryId,
            {
              billingCycleId,
              roomId: row.roomId,
              meterDeviceId: device.id,
              meterType: 'water',
              previousReading: authPrev,
              currentReading: currWaterInt || authPrev,
              usageUnits,
              readAt: new Date(),
              readByUserId: userId,
              status: 'draft',
            },
            tx
          );
        }
      }
    }

    // 2. Electricity reading if entered and per_unit
    if (
      (row.elecCurr !== undefined && row.elecCurr !== null && String(row.elecCurr).trim() !== '') ||
      (row.elecPrev !== undefined && row.elecPrev !== null && String(row.elecPrev).trim() !== '')
    ) {
      if (elecMode === 'per_unit') {
        let authPrev: string | null = null;
        if (row.elecPrev !== undefined && row.elecPrev !== null && String(row.elecPrev).trim() !== '') {
          const parsed = parseMeterIntegerReading(row.elecPrev);
          if (!parsed.isValid) {
            const err = new Error(parsed.errorMessage || `ค่ามิเตอร์ไฟฟ้าเดิมไม่ถูกต้อง: ${row.elecPrev}`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            throw err;
          }
          authPrev = String(parsed.value);
        } else {
          const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
            dormitoryId,
            billingCycleId,
            row.roomId,
            'electricity',
            tx
          );
          if (existingReading && existingReading.previousReading !== undefined && existingReading.previousReading !== null) {
            authPrev = String(existingReading.previousReading).replace(/\.00$/, '');
          } else {
            authPrev = await this.resolveAuthoritativePreviousReading(
              dormitoryId,
              billingCycleId,
              row.roomId,
              'electricity',
              tx
            );
          }
        }

        if (authPrev === null) {
          const err = new Error(`กรุณาระบุค่ามิเตอร์ไฟฟ้าเดิมสำหรับห้องนี้`);
          (err as any).statusCode = 400;
          (err as any).code = 'MISSING_PREVIOUS_METER_READING';
          throw err;
        }

        const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          billingCycleId,
          row.roomId,
          'electricity',
          tx
        );

        let currElecInt: string | null = null;
        if (row.elecCurr !== undefined && row.elecCurr !== null && String(row.elecCurr).trim() !== '') {
          const parsedCurr = parseMeterIntegerReading(row.elecCurr);
          if (!parsedCurr.isValid) {
            const err = new Error(parsedCurr.errorMessage || `ค่ามิเตอร์ไฟฟ้าปัจจุบันไม่ถูกต้อง: ${row.elecCurr}`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            throw err;
          }
          currElecInt = String(parsedCurr.value);
        } else if (existingReading?.currentReading) {
          currElecInt = String(existingReading.currentReading).replace(/\.00$/, '');
        }

        let usageUnits = '0.00';
        if (currElecInt !== null && currElecInt !== undefined && currElecInt !== '') {
          const usageRes = calculateMeterUsageUnits(authPrev, currElecInt);
          if (!usageRes.isValid) {
            const err = new Error(usageRes.errorMessage || `ค่ามิเตอร์ไฟปัจจุบัน (${currElecInt}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${authPrev})`);
            (err as any).statusCode = 400;
            (err as any).code = 'INVALID_METER_READING';
            (err as any).message = usageRes.errorMessage || `ค่ามิเตอร์ไฟปัจจุบัน (${currElecInt}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${authPrev})`;
            throw err;
          }
          usageUnits = String(usageRes.usageUnits);
        }

        let device = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, row.roomId, 'electricity', tx);
        if (!device) {
          device = await this.meterRepo.createDevice(
            dormitoryId,
            {
              roomId: row.roomId,
              type: 'electricity',
              meterNumber: `ELEC-${row.roomId.slice(-4)}`,
              initialReading: authPrev,
            },
            tx
          );
        } else if (firstCycle && row.elecPrev !== undefined) {
          await this.meterRepo.updateDevice(
            device.id,
            dormitoryId,
            { initialReading: authPrev },
            device.version,
            tx
          );
        }

        if (existingReading) {
          await this.meterRepo.updateReading(
            existingReading.id,
            dormitoryId,
            {
              previousReading: authPrev,
              ...(currElecInt !== null ? { currentReading: currElecInt, usageUnits } : {}),
              readAt: new Date(),
              readByUserId: userId,
            },
            existingReading.version,
            tx
          );
        } else {
          await this.meterRepo.createReading(
            dormitoryId,
            {
              billingCycleId,
              roomId: row.roomId,
              meterDeviceId: device.id,
              meterType: 'electricity',
              previousReading: authPrev,
              currentReading: currElecInt || authPrev,
              usageUnits,
              readAt: new Date(),
              readByUserId: userId,
              status: 'draft',
            },
            tx
          );
        }
      }
    }


    // 3. RoomBillingCycleSnapshot (peopleCount, manualOutstandingAmount, otherFees)
    if (
      row.peopleCount !== undefined ||
      row.manualOutstandingAmount !== undefined ||
      row.otherFees !== undefined
    ) {
      let cleanOtherFees: any[] = [];
      if (Array.isArray(row.otherFees)) {
        for (const item of row.otherFees) {
          if (item && item.description && typeof item.description === 'string' && item.description.trim()) {
            const desc = item.description.trim().slice(0, 100);
            const amt = toDecimal(String(item.amount));
            if (compareDecimals(amt, '0.00') >= 0) {
              cleanOtherFees.push({ description: desc, amount: formatDecimal(amt) });
            }
          }
        }
      }

      let savedVersion = 1;
      let finalPeopleCount = row.peopleCount !== undefined ? Math.max(0, row.peopleCount) : 0;
      let finalManualOutstanding = row.manualOutstandingAmount !== undefined ? formatDecimal(toDecimal(String(row.manualOutstandingAmount))) : '0.00';
      let finalOtherFees = cleanOtherFees;

      const existingSnap = await client.roomBillingCycleSnapshot.findUnique({
        where: {
          dormitory_billing_cycle_room_unique: {
            dormitoryId,
            billingCycleId,
            roomId: row.roomId,
          },
        },
      });

      if (existingSnap) {
        if (row.expectedVersion !== undefined && row.expectedVersion !== null && existingSnap.version !== row.expectedVersion) {
          const err: any = new Error('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชก่อนทำรายการ');
          err.statusCode = 409;
          err.code = 'STALE_VERSION';
          throw err;
        }

        const updateData: any = {
          updatedByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
          version: { increment: 1 },
        };
        if (row.peopleCount !== undefined) {
          updateData.peopleCount = Math.max(0, row.peopleCount);
          finalPeopleCount = updateData.peopleCount;
        } else {
          finalPeopleCount = existingSnap.peopleCount;
        }
        if (row.manualOutstandingAmount !== undefined) {
          updateData.manualOutstandingAmount = toDecimal(String(row.manualOutstandingAmount));
          finalManualOutstanding = formatDecimal(updateData.manualOutstandingAmount);
        } else if (existingSnap.manualOutstandingAmount) {
          finalManualOutstanding = formatDecimal(toDecimal(existingSnap.manualOutstandingAmount.toString()));
        }
        if (row.otherFees !== undefined) {
          updateData.otherFees = cleanOtherFees;
          finalOtherFees = cleanOtherFees;
        } else if (Array.isArray(existingSnap.otherFees)) {
          finalOtherFees = (existingSnap.otherFees as any[]).map((f: any) => ({
            description: String(f?.description || ''),
            amount: formatDecimal(toDecimal(f?.amount)),
          }));
        }

        const expectedVer = row.expectedVersion !== undefined && row.expectedVersion !== null ? row.expectedVersion : existingSnap.version;
        const updateResult = await client.roomBillingCycleSnapshot.updateMany({
          where: {
            id: existingSnap.id,
            version: expectedVer,
          },
          data: updateData,
        });

        if (updateResult.count === 0) {
          const err: any = new Error('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชก่อนทำรายการ');
          err.statusCode = 409;
          err.code = 'STALE_VERSION';
          throw err;
        }

        savedVersion = existingSnap.version + 1;
      } else {
        if (row.expectedVersion !== undefined && row.expectedVersion !== null && row.expectedVersion > 0) {
          const err: any = new Error('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชก่อนทำรายการ');
          err.statusCode = 409;
          err.code = 'STALE_VERSION';
          throw err;
        }

        try {
          const createdSnap = await client.roomBillingCycleSnapshot.create({
            data: {
              dormitoryId,
              billingCycleId,
              roomId: row.roomId,
              peopleCount: row.peopleCount !== undefined ? Math.max(0, row.peopleCount) : 0,
              manualOutstandingAmount: row.manualOutstandingAmount !== undefined ? toDecimal(String(row.manualOutstandingAmount)) : toDecimal('0.00'),
              otherFees: cleanOtherFees,
              source: 'MANUAL',
              updatedByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
              version: 1,
            },
          });
          savedVersion = createdSnap.version;
        } catch (createErr: any) {
          if (createErr?.code === 'P2002' || createErr?.message?.includes('Unique constraint failed') || createErr?.message?.includes('unique constraint')) {
            const err: any = new Error('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชก่อนทำรายการ');
            err.statusCode = 409;
            err.code = 'STALE_VERSION';
            throw err;
          }
          throw createErr;
        }
      }

      return {
        roomId: row.roomId,
        version: savedVersion,
        peopleCount: finalPeopleCount,
        manualOutstandingAmount: finalManualOutstanding,
        otherFees: finalOtherFees,
      };
    }

    const existingSnap = await client.roomBillingCycleSnapshot.findUnique({
      where: {
        dormitory_billing_cycle_room_unique: {
          dormitoryId,
          billingCycleId,
          roomId: row.roomId,
        },
      },
    });

    return {
      roomId: row.roomId,
      version: existingSnap?.version ?? 1,
      peopleCount: existingSnap?.peopleCount ?? (row.peopleCount !== undefined ? Math.max(0, row.peopleCount) : 0),
      manualOutstandingAmount: existingSnap ? formatDecimal(toDecimal(String(existingSnap.manualOutstandingAmount))) : '0.00',
      otherFees: existingSnap && Array.isArray(existingSnap.otherFees) ? (existingSnap.otherFees as any[]) : [],
    };
  }

  public async syncIssuedUnpaidBillInTx(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    activeBill: any,
    billingService: any,
    userId?: string,
    tx?: any
  ): Promise<void> {
    if (activeBill.billKind !== 'MONTHLY_UTILITY') {
      const err = new Error('INVALID_BILL_KIND_FOR_METER_SYNC: Only MONTHLY_UTILITY bills can be synchronized from Meter Workspace');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_BILL_KIND_FOR_METER_SYNC';
      throw err;
    }

    if (activeBill.status === 'paid' || activeBill.status === 'PAID') {
      return;
    }

    const preview = await billingService.generateBillPreview(dormitoryId, billingCycleId, roomId, tx, 'MONTHLY_UTILITY');
    const prisma = tx || getPrismaClient();

    // 1. Delete old items and insert updated items
    await prisma.billItem.deleteMany({
      where: {
        billId: activeBill.id,
        dormitoryId,
      },
    });

    const newItems = preview.items.map((i: any, idx: number) => ({
      dormitoryId,
      billId: activeBill.id,
      type: i.type,
      code: i.code || null,
      description: i.description,
      quantity: i.quantity || '1.00',
      unit: i.unit || null,
      unitPrice: i.unitPrice,
      amount: i.amount,
      sourceType: i.sourceType || null,
      sourceId: i.sourceId || null,
      displayOrder: idx,
      metadata: i.metadata || null,
    }));

    for (const item of newItems) {
      await prisma.billItem.create({
        data: item,
      });
    }

    // 2. Compute new totals
    let subtotalDec = toDecimal('0.00');
    for (const item of newItems) {
      subtotalDec = addDecimals(subtotalDec, item.amount);
    }
    const discountDec = toDecimal(activeBill.discountAmount || '0.00');
    const rawTotal = subDecimals(subtotalDec, discountDec);
    const totalDec = compareDecimals(rawTotal, '0.00') < 0 ? toDecimal('0.00') : rawTotal;
    const paidDec = toDecimal(activeBill.paidAmount || '0.00');
    const outstandingDec = subDecimals(totalDec, paidDec);
    const finalOutstanding = compareDecimals(outstandingDec, '0.00') < 0 ? toDecimal('0.00') : outstandingDec;

    // 3. Update Bill header
    await prisma.bill.update({
      where: { id: activeBill.id },
      data: {
        subtotal: formatDecimal(subtotalDec),
        totalAmount: formatDecimal(totalDec),
        outstandingAmount: formatDecimal(finalOutstanding),
        version: { increment: 1 },
      },
    });

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'bill.sync_on_meter_save',
        resourceType: 'bill',
        resourceId: activeBill.id,
        details: { roomId, newTotal: formatDecimal(totalDec) },
      });
    }
  }

  public async saveBulkMeterWorkspace(
    dormitoryId: string,
    data: { billingCycleId: string; rows: SaveMeterWorkspaceRowDto[] },
    userId?: string,
    billingService?: any
  ): Promise<{ savedCount: number; savedRows: SavedRoomSnapshotMeta[] }> {
    const cycle = await this.billingCycleRepo.findById(data.billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    if (cycle.status === 'locked' || cycle.status === 'completed') {
      const err = new Error('BILLING_CYCLE_LOCKED');
      (err as any).statusCode = 400;
      (err as any).code = 'BILLING_CYCLE_LOCKED';
      throw err;
    }

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(data.billingCycleId, dormitoryId);
    const prisma = getPrismaClient();
    const earliest = await prisma.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });
    const isFirstCycle = earliest ? earliest.id === data.billingCycleId : false;

    return this.meterRepo.withTransaction(async (tx) => {
      const entitlementSet = await subscriptionEntitlementService.resolveOperationalRoomEntitlementSet(
        dormitoryId,
        new Date(),
        tx
      );

      for (const row of data.rows) {
        if (entitlementSet.lockedRoomIds.has(row.roomId)) {
          throw new AppError(
            `ห้องพักนี้เกินสิทธิ์การใช้งานของแพ็กเกจฟรี (จำกัด ${entitlementSet.roomLimit} ห้องที่เปิดใช้งานพร้อมกัน) กรุณาอัปเกรดแพ็กเกจเพื่อเปิดใช้งานห้องนี้`,
            403,
            'ROOM_ENTITLEMENT_LOCKED'
          );
        }
      }

      const sortedRoomIds = [...new Set(data.rows.map((r) => r.roomId))].sort();
      for (const roomId of sortedRoomIds) {
        await this.meterRepo.executeRawLock(roomId, tx);
      }

      const savedRows: SavedRoomSnapshotMeta[] = [];

      for (const row of data.rows) {
        let activeBill: any = null;
        if (this.billRepo) {
          activeBill = await this.billRepo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, data.billingCycleId, row.roomId, tx);
          if (activeBill && activeBill.status !== 'cancelled' && activeBill.status !== 'void') {
            if (activeBill.status === 'paid' || activeBill.status === 'PAID') {
              const err = new Error('ROOM_LOCKED_PAID');
              (err as any).statusCode = 400;
              (err as any).code = 'ROOM_LOCKED_PAID';
              (err as any).message = 'บิลนี้ชำระเงินแล้ว ไม่สามารถแก้ไขข้อมูลมิเตอร์ได้';
              throw err;
            }
          }
        }

        const savedMeta = await this.saveSingleRoomWorkspaceInTx(
          dormitoryId,
          data.billingCycleId,
          row,
          userId,
          tx,
          rateSnapshot,
          isFirstCycle
        );
        if (savedMeta) {
          savedRows.push(savedMeta);
        }

        if (
          activeBill &&
          activeBill.status !== 'cancelled' &&
          activeBill.status !== 'void' &&
          activeBill.status !== 'paid' &&
          activeBill.status !== 'PAID' &&
          billingService
        ) {
          await this.syncIssuedUnpaidBillInTx(
            dormitoryId,
            data.billingCycleId,
            row.roomId,
            activeBill,
            billingService,
            userId,
            tx
          );
        }
      }

      return { savedCount: data.rows.length, savedRows };
    }).then(async (res) => {
      if (this.auditService) {
        await this.auditService.log({
          dormitoryId,
          actorUserId: userId || 'system',
          action: 'meter_workspace.bulk_save',
          resourceType: 'billing_cycle',
          resourceId: data.billingCycleId,
          details: { savedCount: res.savedCount },
        });
      }
      return res;
    });
  }

  public async toggleRoomBillSwitch(
    dormitoryId: string,
    data: {
      billingCycleId: string;
      roomId: string;
      action: 'issue' | 'cancel';
      dirtyRow?: SaveMeterWorkspaceRowDto;
      cancellationReason?: string;
    },
    userId?: string,
    billingService?: any
  ) {
    if (data.action === 'issue') {
      return this.meterRepo.withTransaction(async (tx) => {
        await this.meterRepo.executeRawLock(data.roomId, tx);

        // 0. Assert room operational entitlement before any mutation/issue
        await subscriptionEntitlementService.assertRoomOperationalEntitlement(
          dormitoryId,
          data.roomId,
          new Date(),
          tx
        );

        // 1. Save dirty workspace row if present within this transaction
        if (data.dirtyRow) {
          await this.saveSingleRoomWorkspaceInTx(dormitoryId, data.billingCycleId, data.dirtyRow, userId, tx);
        }

        // 2. Check if bill already exists
        if (this.billRepo) {
          const existing = await this.billRepo.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, data.billingCycleId, data.roomId, tx);
          if (existing) {
            const items = await this.billRepo.getBillItems(existing.id, dormitoryId, tx);
            return { action: 'issue', bill: existing, items, created: false, status: existing.status };
          }
        }

        // 3. Generate bill atomically inside the same transaction
        const result = await billingService.generateBill(
          dormitoryId,
          {
            billingCycleId: data.billingCycleId,
            roomId: data.roomId,
            billKind: 'MONTHLY_UTILITY',
          },
          userId,
          undefined,
          tx
        );

        return {
          action: 'issue',
          bill: result.bill,
          items: result.items,
          created: result.created,
          status: result.bill.status,
        };
      });
    } else {
      // Cancel bill
      const activeBill = await this.billRepo?.findActiveMonthlyUtilityByRoomAndCycle(dormitoryId, data.billingCycleId, data.roomId);
      if (!activeBill) {
        return { action: 'cancel', cancelled: true, status: 'cancelled' };
      }

      if (activeBill.status === 'paid') {
        const err = new Error('BILL_CANNOT_BE_CANCELLED: Paid bill cannot be cancelled from meter workspace');
        (err as any).statusCode = 400;
        (err as any).code = 'BILL_CANNOT_BE_CANCELLED';
        throw err;
      }

      const cancelledBill = await billingService.cancelBill(
        activeBill.id,
        dormitoryId,
        data.cancellationReason || 'OWNER_METER_SWITCH_OFF',
        userId
      );

      return {
        action: 'cancel',
        cancelled: true,
        bill: cancelledBill,
        status: 'cancelled',
      };
    }
  }

  /**
   * Bounded aggregate read for current household counts across all rooms in the cycle.
   */
  public async getHouseholdCountsByCycle(
    dormitoryId: string,
    billingCycleId: string
  ): Promise<Array<{ roomId: string; currentHouseholdPeopleCount: number }>> {
    const currentCycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (!currentCycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const prisma = getPrismaClient();
    const roomsResult = await this.roomRepo.findAll(dormitoryId, {
      pageSize: ENTITLEMENT_ROOM_LIMITS.PAID,
    });
    const rooms = roomsResult.items || [];

    const activeContracts = await prisma.contract.findMany({
      where: {
        dormitoryId,
        status: { in: ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'] },
        deletedAt: null,
        startDate: { lte: currentCycle.periodEnd },
        endDate: { gte: currentCycle.periodStart },
      },
      include: { tenant: true },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const activeProvisionalTerms = await prisma.provisionalRentalTerm.findMany({
      where: {
        dormitoryId,
        status: 'ACTIVE',
        deletedAt: null,
        startDate: { lte: currentCycle.periodEnd },
        endDate: { gte: currentCycle.periodStart },
      },
      include: { tenant: true },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const allTenantIds = Array.from(
      new Set([
        ...activeContracts.map((c) => c.tenantId),
        ...activeProvisionalTerms.map((p) => p.tenantId),
      ])
    );

    const coOccupants = allTenantIds.length > 0
      ? await prisma.tenantCoOccupant.findMany({
          where: {
            dormitoryId,
            tenantId: { in: allTenantIds },
            deletedAt: null,
            status: 'active',
          },
        })
      : [];

    const coOccupantCountMap = new Map<string, number>();
    for (const co of coOccupants) {
      coOccupantCountMap.set(co.tenantId, (coOccupantCountMap.get(co.tenantId) || 0) + 1);
    }

    const roomContractMap = new Map<string, typeof activeContracts[0]>();
    for (const c of activeContracts) {
      if (!roomContractMap.has(c.roomId)) roomContractMap.set(c.roomId, c);
    }

    const roomProvisionalMap = new Map<string, typeof activeProvisionalTerms[0]>();
    for (const p of activeProvisionalTerms) {
      if (!roomProvisionalMap.has(p.roomId)) roomProvisionalMap.set(p.roomId, p);
    }

    return rooms.map((room) => {
      let householdCount = 0;
      const contract = roomContractMap.get(room.id);
      if (contract) {
        if (contract.tenant && contract.tenant.status === 'reserved') {
          householdCount = 0;
        } else {
          householdCount = 1 + (coOccupantCountMap.get(contract.tenantId) || 0);
        }
      } else {
        const prov = roomProvisionalMap.get(room.id);
        if (prov) {
          if (prov.tenant && prov.tenant.status === 'reserved') {
            householdCount = 0;
          } else {
            householdCount = 1 + (coOccupantCountMap.get(prov.tenantId) || 0);
          }
        } else {
          householdCount = 0;
        }
      }
      return {
        roomId: room.id,
        currentHouseholdPeopleCount: householdCount,
      };
    });
  }

  /**
   * Bounded aggregate read for Meter Billing Preview Context.
   * Produces all fixed, server-resolved authorities required by the frontend live calculator
   * in ONE bounded read without per-room HTTP fanout.
   */
  public async getMeterBillingPreviewContext(
    dormitoryId: string,
    billingCycleId: string
  ): Promise<{
    billingCycleId: string;
    cycleCode: string;
    rateSnapshot: any;
    rooms: Array<{
      roomId: string;
      roomNumber: string;
      tenantId: string | null;
      tenantName: string | null;
      billingSource: 'CONTRACT' | 'PROVISIONAL_MONTHLY' | 'PROVISIONAL_TERM' | 'DAILY_STAY' | 'NONE';
      rentAmount: string;
      rentDescription: string;
      isLineLinked: boolean;
      dailyDepositAmount: string;
      dailyDepositStatus: 'PAID' | 'UNPAID' | null;
      dailyDepositPaidAt: string | null;
      showDailyDepositLine: boolean;
      isDailyDepositPaidInDisplayedPeriod: boolean;
      parkingQuantity: string;
      snapshotVersion: number;
      snapshotOtherFees: Array<{ description: string; amount: string }>;
      snapshotManualOutstanding: string;
      snapshotPeopleCount: number | null;
      currentHouseholdPeopleCount: number;
      historicalDailyCount: number;
      isDailyUnpaid: boolean;
      hasBookableGap: boolean;
    }>;
  }> {
    const cycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (!cycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const rateSnapshot = await this.billingCycleRepo.findRateSnapshot(billingCycleId, dormitoryId);
    if (!rateSnapshot) {
      const err = new Error('MISSING_RATE_SNAPSHOT');
      (err as any).statusCode = 422;
      (err as any).code = 'MISSING_RATE_SNAPSHOT';
      throw err;
    }

    const prisma = getPrismaClient();
    const roomsResult = await this.roomRepo.findAll(dormitoryId, {
      pageSize: ENTITLEMENT_ROOM_LIMITS.PAID,
    });
    const rooms = roomsResult.items || [];

    const [cYear, cMonth] = cycle.cycleCode.split('-').map(Number);
    const cycleStartStr = `${cYear}-${String(cMonth).padStart(2, '0')}-01`;
    const cycleEndStr = normalizeBangkokDate(cycle.periodEnd);
    const nextMonthStr = cMonth === 12 ? `${cYear + 1}-01-01` : `${cYear}-${String(cMonth + 1).padStart(2, '0')}-01`;
    const cycleStart = getBangkokStartOfDayUtc(cycleStartStr);
    const cycleEndExclusive = getBangkokStartOfDayUtc(nextMonthStr);
    const now = new Date();

    // 1. Load active & historical contracts
    const allContracts = await prisma.contract.findMany({
      where: {
        dormitoryId,
        status: { in: ['active', 'approved', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out', 'ended', 'terminated'] },
        deletedAt: null,
      },
      include: {
        tenant: true,
        snapshot: true,
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const visibleContracts = allContracts.filter((c) => {
      const occStartStr = normalizeBangkokDate(c.startDate);
      const occEndStr = normalizeBangkokDate(c.endDate);
      const recordVisibleFromStr = normalizeBangkokDate(c.createdAt || c.startDate);
      const effectiveStartStr = occStartStr > recordVisibleFromStr ? occStartStr : recordVisibleFromStr;

      return effectiveStartStr <= cycleEndStr && occEndStr >= cycleStartStr;
    });

    // 2. Load active & historical provisional rental terms for this cycle
    const allProvisionalTerms = await prisma.provisionalRentalTerm.findMany({
      where: {
        dormitoryId,
        status: { in: ['ACTIVE', 'ENDED', 'CONVERTED'] },
        deletedAt: null,
      },
      include: {
        tenant: true,
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const visibleProvisionalTerms = allProvisionalTerms.filter((p) => {
      const occStartStr = normalizeBangkokDate(p.startDate);
      const occEndStr = normalizeBangkokDate(p.endDate);
      const recordVisibleFromStr = normalizeBangkokDate(p.createdAt || p.startDate);
      const effectiveStartStr = occStartStr > recordVisibleFromStr ? occStartStr : recordVisibleFromStr;

      return effectiveStartStr <= cycleEndStr && occEndStr >= cycleStartStr;
    });

    // 3. Load daily stays and evaluate real-time occupancy for this cycle
    const allDailyStays = await prisma.dailyStay.findMany({
      where: {
        dormitoryId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'RESERVED', 'CHECKED_OUT', 'COMPLETED'] },
      },
      include: {
        tenant: true,
        invoice: {
          include: {
            items: true,
          },
        },
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }],
    });

    const activeDailyStays: typeof allDailyStays = [];
    const futureDailyStays: typeof allDailyStays = [];

    for (const d of allDailyStays) {
      const checkInAt = d.checkInAt ? new Date(d.checkInAt) : new Date(`${toBangkokDateString(d.startDate)}T00:00:00+07:00`);
      let effectiveCheckOutAt: Date;
      if (d.actualCheckedOutAt) {
        effectiveCheckOutAt = new Date(d.actualCheckedOutAt);
      } else if (d.checkOutAt) {
        effectiveCheckOutAt = new Date(d.checkOutAt);
      } else {
        effectiveCheckOutAt = resolveDailyTimestampsAndPricing(toBangkokDateString(d.startDate), toBangkokDateString(d.endDate)).checkOutAt;
      }

      const belongsToCycle = checkInAt.getTime() < cycleEndExclusive.getTime() && effectiveCheckOutAt.getTime() > cycleStart.getTime();
      if (!belongsToCycle) continue;

      if (now.getTime() < checkInAt.getTime() && (d.status === 'ACTIVE' || d.status === 'RESERVED')) {
        futureDailyStays.push(d);
      } else if (checkInAt.getTime() <= now.getTime() && now.getTime() < effectiveCheckOutAt.getTime() && (d.status === 'ACTIVE' || d.status === 'RESERVED')) {
        activeDailyStays.push(d);
      }
    }

    // 4. Future contracts & provisional terms for vacant rooms
    const futureContracts = allContracts.filter((c) => {
      const startStr = toBangkokDateString(c.startDate);
      return startStr > cycleEndStr && ['active', 'expiring_soon', 'pending_signature', 'waiting_extension'].includes(c.status);
    });

    const futureProvisionalTerms = allProvisionalTerms.filter((p) => {
      const startStr = toBangkokDateString(p.startDate);
      return startStr > cycleEndStr && p.status === 'ACTIVE';
    });

    // Load snapshots for this cycle
    const snapshots = await prisma.roomBillingCycleSnapshot.findMany({
      where: {
        dormitoryId,
        billingCycleId,
      },
    });
    const snapshotMap = new Map(snapshots.map((s) => [s.roomId, s]));

    // Household counts
    const householdCounts = await this.getHouseholdCountsByCycle(dormitoryId, billingCycleId);
    const householdMap = new Map(householdCounts.map((h) => [h.roomId, h.currentHouseholdPeopleCount]));

    // Vehicles for per-vehicle parking mode
    const allTenantIds = Array.from(
      new Set([
        ...visibleContracts.map((c) => c.tenantId),
        ...visibleProvisionalTerms.map((p) => p.tenantId),
        ...(activeDailyStays.map((d) => d.tenantId).filter(Boolean) as string[]),
        ...futureContracts.map((c) => c.tenantId),
        ...futureProvisionalTerms.map((p) => p.tenantId),
        ...(futureDailyStays.map((d) => d.tenantId).filter(Boolean) as string[]),
      ])
    );
    const vehicles = allTenantIds.length > 0
      ? await prisma.tenantVehicle.findMany({
          where: {
            dormitoryId,
            tenantId: { in: allTenantIds },
            deletedAt: null,
          },
        })
      : [];
    const vehicleCountMap = new Map<string, number>();
    for (const v of vehicles) {
      vehicleCountMap.set(v.tenantId, (vehicleCountMap.get(v.tenantId) || 0) + 1);
    }

    const roomContractMap = new Map<string, typeof visibleContracts[0]>();
    for (const c of visibleContracts) {
      if (!roomContractMap.has(c.roomId)) roomContractMap.set(c.roomId, c);
    }

    const roomProvisionalMap = new Map<string, typeof visibleProvisionalTerms[0]>();
    for (const p of visibleProvisionalTerms) {
      if (!roomProvisionalMap.has(p.roomId)) roomProvisionalMap.set(p.roomId, p);
    }

    const roomDailyStayMap = new Map<string, typeof activeDailyStays[0]>();
    for (const d of activeDailyStays) {
      if (!roomDailyStayMap.has(d.roomId)) roomDailyStayMap.set(d.roomId, d);
    }

    const roomFutureContractMap = new Map<string, typeof futureContracts[0]>();
    for (const c of futureContracts) {
      if (!roomFutureContractMap.has(c.roomId)) roomFutureContractMap.set(c.roomId, c);
    }

    const roomFutureProvisionalMap = new Map<string, typeof futureProvisionalTerms[0]>();
    for (const p of futureProvisionalTerms) {
      if (!roomFutureProvisionalMap.has(p.roomId)) roomFutureProvisionalMap.set(p.roomId, p);
    }

    const roomFutureDailyMap = new Map<string, typeof futureDailyStays[0]>();
    for (const d of futureDailyStays) {
      if (!roomFutureDailyMap.has(d.roomId)) roomFutureDailyMap.set(d.roomId, d);
    }

    // Load active bills for this cycle
    const billsInCycle = await prisma.bill.findMany({
      where: {
        dormitoryId,
        billingCycleId,
        status: { notIn: ['cancelled', 'void'] },
      },
      include: {
        items: true,
      },
    });
    const billsByRoomMap = new Map<string, typeof billsInCycle>();
    for (const b of billsInCycle) {
      const list = billsByRoomMap.get(b.roomId) || [];
      list.push(b);
      billsByRoomMap.set(b.roomId, list);
    }

    const roomContexts = rooms.map((room) => {
      let billingSource: 'CONTRACT' | 'PROVISIONAL_MONTHLY' | 'PROVISIONAL_TERM' | 'DAILY_STAY' | 'NONE' = 'NONE';
      let rentAmount = '0.00';
      let rentDescription = 'ค่าเช่าห้องพัก';
      let tenantId: string | null = null;
      let tenantName: string | null = null;
      let parkingQuantity = '1.00';
      let isLineLinked = false;
      let isFutureReservation = false;
      let dailyDepositAmount = '0.00';
      let dailyDepositStatus: 'PAID' | 'UNPAID' | null = null;
      let dailyDepositPaidAt: string | null = null;
      let showDailyDepositLine = false;
      let isDailyDepositPaidInDisplayedPeriod = false;

      const contract = roomContractMap.get(room.id);
      const prov = roomProvisionalMap.get(room.id);
      const dailyStay = roomDailyStayMap.get(room.id);

      if (contract) {
        billingSource = 'CONTRACT';
        tenantId = contract.tenantId;
        tenantName = contract.tenant ? (contract.tenant.displayName || `${contract.tenant.firstName || ''} ${contract.tenant.lastName || ''}`.trim()) : null;
        isLineLinked = Boolean(contract.tenant?.linkedUserId);

        const contractSnapshot = contract.snapshot as any;
        const installmentConfig = contractSnapshot?.installmentConfig;
        if (installmentConfig && Array.isArray(installmentConfig.installmentSchedule) && installmentConfig.installmentSchedule.length > 0) {
          const contractStart = new Date(contract.startDate);
          const cycleStart = new Date(cycle.periodStart);
          const cycleOffset = (cycleStart.getFullYear() - contractStart.getFullYear()) * 12 + (cycleStart.getMonth() - contractStart.getMonth());
          const scheduleItem = installmentConfig.installmentSchedule.find((s: any) => s.cycleOffset === cycleOffset);
          if (scheduleItem) {
            rentAmount = formatDecimal(toDecimal(scheduleItem.amount));
            rentDescription = scheduleItem.description || `ค่าเช่าห้องพัก (งวดที่ ${scheduleItem.installmentNo}/${installmentConfig.selectedInstallments})`;
          } else {
            rentAmount = '0.00';
          }
        } else {
          rentAmount = formatDecimal(toDecimal(contract.rentAmount));
        }
      } else if (prov) {
        tenantId = prov.tenantId;
        tenantName = prov.tenant ? (prov.tenant.displayName || `${prov.tenant.firstName || ''} ${prov.tenant.lastName || ''}`.trim()) : null;
        isLineLinked = Boolean(prov.tenant?.linkedUserId);
        if (prov.rentalType === 'MONTHLY') {
          billingSource = 'PROVISIONAL_MONTHLY';
          rentAmount = formatDecimal(toDecimal(prov.unitRentAmount.toString()));
        } else {
          billingSource = 'PROVISIONAL_TERM';
          const totalRent = Number(prov.totalRentAmount);
          const installments = prov.termInstallmentCount || 1;
          const termStart = new Date(prov.startDate);
          const cycleStart = new Date(cycle.periodStart);
          const cycleOffset = (cycleStart.getFullYear() - termStart.getFullYear()) * 12 + (cycleStart.getMonth() - termStart.getMonth());

          if (cycleOffset >= 0 && cycleOffset < installments) {
            const schedule = calculateInstallmentSchedule(totalRent, installments);
            const currentInstallment = schedule[cycleOffset];
            rentAmount = currentInstallment.formattedAmount;
            rentDescription = `ค่าเช่าห้องพัก (งวดที่ ${cycleOffset + 1}/${installments})`;
          } else {
            rentAmount = '0.00';
          }
        }
      } else if (dailyStay) {
        billingSource = 'DAILY_STAY';
        tenantId = dailyStay.tenantId;
        tenantName = dailyStay.applicantFullName || (dailyStay.tenant ? (dailyStay.tenant.displayName || `${dailyStay.tenant.firstName || ''} ${dailyStay.tenant.lastName || ''}`.trim()) : 'ผู้พักรายวัน');
        rentAmount = formatDecimal(toDecimal(dailyStay.totalRentAmount.toString()));
        rentDescription = `ค่าเช่าห้องพักรายวัน (${dailyStay.inclusiveDayCount} วัน)`;
        isLineLinked = Boolean(dailyStay.tenant?.linkedUserId);

            const depositItem = dailyStay.invoice?.items.find((i) => i.itemType === 'DEPOSIT');
            dailyDepositAmount = depositItem ? formatDecimal(depositItem.amount) : formatDecimal(dailyStay.depositAmount);
            const isPaid = depositItem?.status === 'DECLARED_PAID' || depositItem?.status === 'SETTLED' || dailyStay.depositDeclaredStatus === 'PAID';
            const paidAt = depositItem?.paidAt || null;
            dailyDepositStatus = isPaid ? 'PAID' : 'UNPAID';
            dailyDepositPaidAt = paidAt ? paidAt.toISOString() : null;

            if (Number(dailyDepositAmount) > 0) {
              if (!isPaid) {
                showDailyDepositLine = true;
                isDailyDepositPaidInDisplayedPeriod = false;
              } else if (isPaid && !paidAt) {
                // Legacy paid deposit guard: hide line, do not charge
                showDailyDepositLine = false;
                isDailyDepositPaidInDisplayedPeriod = false;
              } else if (isPaid && paidAt) {
                const paidCycle = toBangkokDateString(paidAt).slice(0, 7);
                if (cycle.cycleCode === paidCycle) {
                  showDailyDepositLine = true;
                  isDailyDepositPaidInDisplayedPeriod = true;
                } else if (cycle.cycleCode < paidCycle) {
                  showDailyDepositLine = true;
                  isDailyDepositPaidInDisplayedPeriod = false;
                } else {
                  showDailyDepositLine = false;
                  isDailyDepositPaidInDisplayedPeriod = false;
                }
              }
            }
          } else {
            // Check future reservation
            const futureC = roomFutureContractMap.get(room.id);
            const futureP = roomFutureProvisionalMap.get(room.id);
            const futureD = roomFutureDailyMap.get(room.id);
            if (futureC) {
              isFutureReservation = true;
              tenantId = futureC.tenantId;
              tenantName = futureC.tenant ? (futureC.tenant.displayName || `${futureC.tenant.firstName || ''} ${futureC.tenant.lastName || ''}`.trim()) : null;
              isLineLinked = Boolean(futureC.tenant?.linkedUserId);
            } else if (futureP) {
              isFutureReservation = true;
              tenantId = futureP.tenantId;
              tenantName = futureP.tenant ? (futureP.tenant.displayName || `${futureP.tenant.firstName || ''} ${futureP.tenant.lastName || ''}`.trim()) : null;
              isLineLinked = Boolean(futureP.tenant?.linkedUserId);
            } else if (futureD) {
              isFutureReservation = true;
              tenantId = futureD.tenantId || null;
              tenantName = futureD.applicantFullName || (futureD.tenant ? (futureD.tenant.displayName || `${futureD.tenant.firstName || ''} ${futureD.tenant.lastName || ''}`.trim()) : 'ผู้พักรายวัน');
              isLineLinked = Boolean(futureD.tenant?.linkedUserId);
            }
            billingSource = 'NONE';
            rentAmount = '0.00';
          }

      // Parking quantity calculation
      const parkingMode = (rateSnapshot as any).parkingFeeMode || 'per_room';
      if (parkingMode === 'per_vehicle' || parkingMode === 'vehicle') {
        const vCount = tenantId ? (vehicleCountMap.get(tenantId) || 0) : 0;
        parkingQuantity = vCount.toFixed(2);
      } else if (parkingMode === 'per_person' || parkingMode === 'person') {
        parkingQuantity = 'per_person';
      } else if (parkingMode === 'free' || parkingMode === 'none') {
        parkingQuantity = '0.00';
      } else {
        parkingQuantity = '1.00';
      }

      const snap = snapshotMap.get(room.id);
      const snapshotVersion = snap ? snap.version : 0;
      const snapshotOtherFees: Array<{ description: string; amount: string }> =
        snap && Array.isArray(snap.otherFees)
          ? (snap.otherFees as any[]).map((f: any) => ({
              description: String(f?.description || ''),
              amount: formatDecimal(toDecimal(f?.amount)),
            }))
          : [];
      const snapshotManualOutstanding = snap && snap.manualOutstandingAmount ? formatDecimal(toDecimal(snap.manualOutstandingAmount.toString())) : '0.00';
      const snapshotPeopleCount = snap ? snap.peopleCount : null;
      const currentHouseholdPeopleCount = householdMap.get(room.id) ?? 0;

      // Charge Components & Amount Due Breakdown
      const roomBills = billsByRoomMap.get(room.id) || [];
      const chargeComponents: Array<{
        type: string;
        label: string;
        amount: string;
        status: 'PAID' | 'UNPAID' | 'DRAFT';
        paidAt?: string | null;
        occurredInDisplayedPeriod: boolean;
        includedInAmountDue: boolean;
      }> = [];

      let amountDueDec = toDecimal('0.00');

      for (const bill of roomBills) {
        const isPaid = bill.status === 'paid' || bill.status === 'PAID';
        const billTotal = toDecimal(bill.totalAmount.toString());
        const billKind = bill.billKind || 'MONTHLY_UTILITY';

        let label = 'บิลรายเดือน';
        if (billKind === 'RENT') {
          label = billingSource === 'PROVISIONAL_TERM' ? 'ค่าเช่า (เทอม)' : 'ค่าเช่า (เดือน)';
        } else if (billKind === 'DEPOSIT') {
          label = 'ค่าประกัน';
        } else if (billKind === 'MONTHLY_UTILITY') {
          label = 'บิลรายเดือน';
        }

        const isUnpaid = !isPaid;
        if (isUnpaid) {
          amountDueDec = addDecimals(amountDueDec, billTotal);
        }

        chargeComponents.push({
          type: billKind.toLowerCase(),
          label,
          amount: formatDecimal(billTotal),
          status: isPaid ? 'PAID' : 'UNPAID',
          paidAt: bill.paidAt ? bill.paidAt.toISOString() : null,
          occurredInDisplayedPeriod: true,
          includedInAmountDue: isUnpaid,
        });
      }

      const periodDetailCount = chargeComponents.filter((c) => c.occurredInDisplayedPeriod).length;

      // Calculate distinct daily stays in cycle using canonical half-open boundaries
      const roomDailyStaysInCycle = allDailyStays.filter((d) => {
        if (d.roomId !== room.id) return false;
        const dIv = getDailyStayPhysicalInterval(d);
        return doHalfOpenIntervalsOverlap({ start: cycleStart, end: cycleEndExclusive }, dIv);
      });

      const distinctDailyStayIds = new Set(roomDailyStaysInCycle.map((d) => d.id));
      const historicalDailyCount = distinctDailyStayIds.size;

      const now = new Date();
      let isDailyRentPaid = false;
      let isDailyOverdue = false;
      let isDailyActive = false;
      let isDailyUnpaid = false;
      let isDailyFinancialTail = false;
      let unpaidDailyStay: typeof allDailyStays[0] | null = null;

      if (billingSource === 'DAILY_STAY') {
        const activeDailyStay = roomDailyStaysInCycle.find(d => {
          const iv = getDailyStayPhysicalInterval(d);
          return now.getTime() >= iv.start.getTime() && now.getTime() < iv.end.getTime();
        }) || roomDailyStaysInCycle[0];

        if (activeDailyStay) {
          const rentItem = activeDailyStay.invoice?.items.find((i) => i.itemType === 'RENT' || i.itemType === 'DAILY_RENT');
          const isPaid = rentItem
            ? (rentItem.status === 'SETTLED' || rentItem.status === 'DECLARED_PAID')
            : (activeDailyStay.status === 'COMPLETED' || activeDailyStay.invoice?.status === 'PAID');

          const iv = getDailyStayPhysicalInterval(activeDailyStay);
          const isOverdue = now.getTime() > iv.end.getTime();
          isDailyRentPaid = isPaid;
          isDailyOverdue = isOverdue && !isPaid;
          isDailyActive = now.getTime() <= iv.end.getTime();
          isDailyUnpaid = !isPaid;
        }
      }

      for (const d of roomDailyStaysInCycle) {
        const rentItem = d.invoice?.items.find((i) => i.itemType === 'RENT' || i.itemType === 'DAILY_RENT');
        const isRentPaid = rentItem
          ? (rentItem.status === 'SETTLED' || rentItem.status === 'DECLARED_PAID')
          : (d.status === 'COMPLETED' || d.invoice?.status === 'PAID');
        if (!isRentPaid) {
          const iv = getDailyStayPhysicalInterval(d);
          if (now.getTime() > iv.end.getTime()) {
            isDailyOverdue = true;
          }
          isDailyUnpaid = true;
          if (!unpaidDailyStay) unpaidDailyStay = d;
        }
      }

      // If checked out with unpaid daily rent tail in this cycle, retain Daily tenant identity in this cycle
      if (billingSource === 'NONE' && unpaidDailyStay) {
        tenantId = unpaidDailyStay.tenantId || null;
        tenantName = unpaidDailyStay.applicantFullName || (unpaidDailyStay.tenant ? (unpaidDailyStay.tenant.displayName || `${unpaidDailyStay.tenant.firstName || ''} ${unpaidDailyStay.tenant.lastName || ''}`.trim()) : 'ผู้พักรายวัน');
        isLineLinked = Boolean(unpaidDailyStay.tenant?.linkedUserId);
        isDailyFinancialTail = true;
      }

      // Calculate if room has any bookable interval in this cycle using canonical physical intervals
      const blockingIntervals: Array<{ start: Date; end: Date }> = [];

      // A. Contracts on this room
      for (const c of allContracts.filter((c) => c.roomId === room.id && ['active', 'ACTIVE', 'approved', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out', 'ended', 'ENDED', 'terminated', 'TERMINATED'].includes(c.status))) {
        blockingIntervals.push(getContractPhysicalInterval(c));
      }

      // B. Provisional Rental Terms on this room
      for (const p of allProvisionalTerms.filter((p) => p.roomId === room.id && ['ACTIVE', 'active', 'RESERVED', 'reserved', 'CONVERTED', 'ENDED'].includes(p.status))) {
        blockingIntervals.push(getProvisionalTermPhysicalInterval(p));
      }

      // C. Daily Stays on this room (checked-out stays only block their physical duration; debt does not extend physical occupancy)
      for (const d of allDailyStays.filter((d) => d.roomId === room.id && ['ACTIVE', 'active', 'RESERVED', 'reserved', 'CHECKED_OUT', 'checked_out', 'COMPLETED', 'completed'].includes(d.status))) {
        blockingIntervals.push(getDailyStayPhysicalInterval(d));
      }

      // D. Future reservations
      const futureC = roomFutureContractMap.get(room.id);
      if (futureC && ['active', 'ACTIVE', 'approved', 'expiring_soon', 'pending_signature', 'waiting_extension'].includes(futureC.status)) {
        blockingIntervals.push(getContractPhysicalInterval(futureC));
      }

      const futureP = roomFutureProvisionalMap.get(room.id);
      if (futureP && ['ACTIVE', 'active', 'RESERVED', 'reserved', 'CONVERTED', 'ENDED'].includes(futureP.status)) {
        blockingIntervals.push(getProvisionalTermPhysicalInterval(futureP));
      }

      const futureD = roomFutureDailyMap.get(room.id);
      if (futureD && ['ACTIVE', 'active', 'RESERVED', 'reserved', 'CHECKED_OUT', 'checked_out', 'COMPLETED', 'completed'].includes(futureD.status)) {
        blockingIntervals.push(getDailyStayPhysicalInterval(futureD));
      }

      const hasBookableGap = hasBookableGapInCycle(cycleStart, cycleEndExclusive, blockingIntervals);

      return {
        roomId: room.id,
        roomNumber: room.roomNumber,
        tenantId,
        tenantName,
        billingSource,
        rentAmount,
        rentDescription,
        isLineLinked,
        isFutureReservation,
        dailyDepositAmount,
        dailyDepositStatus,
        dailyDepositPaidAt,
        showDailyDepositLine,
        isDailyDepositPaidInDisplayedPeriod,
        parkingQuantity,
        snapshotVersion,
        snapshotOtherFees,
        snapshotManualOutstanding,
        snapshotPeopleCount,
        currentHouseholdPeopleCount,
        amountDue: formatDecimal(amountDueDec),
        periodDetailCount,
        chargeComponents,
        hasBookableGap,
        historicalDailyCount,
        isDailyUnpaid,
        isDailyRentPaid,
        isDailyOverdue,
        isDailyActive,
        isDailyFinancialTail,
      };
    });

    const canonicalRateSnapshot = rateSnapshot
      ? {
          ...rateSnapshot,
          waterBillingType: normalizeUtilityBillingMode(rateSnapshot.waterBillingType),
          electricityBillingType: normalizeUtilityBillingMode(rateSnapshot.electricityBillingType),
        }
      : null;

    return {
      billingCycleId: cycle.id,
      cycleCode: cycle.cycleCode,
      rateSnapshot: canonicalRateSnapshot,
      rooms: roomContexts,
    };
  }

  /**
   * Bounded aggregate READ for Pull Previous data.
   * Returns authoritative previous meter readings (from MeterReading.currentReading, regardless of bill existence)
   * and authoritative current household people count in one single server response without any database mutation.
   */
  public async pullPreviousWorkspaceData(
    dormitoryId: string,
    billingCycleId: string
  ): Promise<{
    hasPreviousCycle: boolean;
    previousCycleId?: string;
    previousCycleCode?: string;
    rooms: Array<{
      roomId: string;
      previousWaterCurrentReading: string | null;
      previousElectricityCurrentReading: string | null;
      previousCyclePeopleCount: number | null;
      currentHouseholdPeopleCount: number;
    }>;
  }> {
    const currentCycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (!currentCycle) {
      const err = new Error('BILLING_CYCLE_NOT_FOUND');
      (err as any).statusCode = 404;
      (err as any).code = 'BILLING_CYCLE_NOT_FOUND';
      throw err;
    }

    const prisma = getPrismaClient();

    // 1. Find the immediately preceding billing cycle for this dormitory
    const previousCycle = await prisma.billingCycle.findFirst({
      where: {
        dormitoryId,
        periodStart: { lt: currentCycle.periodStart },
      },
      orderBy: { periodStart: 'desc' },
    });

    // 2. Fetch all rooms for this dormitory (bounded by canonical ceiling)
    const roomsResult = await this.roomRepo.findAll(dormitoryId, {
      pageSize: ENTITLEMENT_ROOM_LIMITS.PAID,
    });
    const rooms = roomsResult.items || [];

    // 3. Load authoritative previous cycle meter readings (if previous cycle exists)
    const readingMap: Record<string, { waterCurr?: string; elecCurr?: string }> = {};
    if (previousCycle) {
      const prevReadings = await prisma.meterReading.findMany({
        where: {
          dormitoryId,
          billingCycleId: previousCycle.id,
        },
      });

      for (const r of prevReadings) {
        if (!readingMap[r.roomId]) readingMap[r.roomId] = {};
        if (r.meterType === 'water' && r.currentReading !== null && r.currentReading !== undefined) {
          readingMap[r.roomId].waterCurr = formatDecimal(toDecimal(r.currentReading.toString()));
        } else if (r.meterType === 'electricity' && r.currentReading !== null && r.currentReading !== undefined) {
          readingMap[r.roomId].elecCurr = formatDecimal(toDecimal(r.currentReading.toString()));
        }
      }
    }

    // 4. Load previous cycle snapshots (if previous cycle exists) - STRICTLY READ ONLY
    const prevSnapshotMap = new Map<string, number>();
    if (previousCycle) {
      const prevSnapshots = await prisma.roomBillingCycleSnapshot.findMany({
        where: {
          dormitoryId,
          billingCycleId: previousCycle.id,
        },
      });
      for (const snap of prevSnapshots) {
        prevSnapshotMap.set(snap.roomId, snap.peopleCount);
      }
    }

    // 5. Bounded Aggregate Read for Current Household Truth
    const householdCounts = await this.getHouseholdCountsByCycle(dormitoryId, billingCycleId);
    const householdMap = new Map(householdCounts.map((h) => [h.roomId, h.currentHouseholdPeopleCount]));

    // 6. Map in-memory without any per-room DB query or mutation
    const roomResults = rooms.map((room) => {
      const prevWater = readingMap[room.id]?.waterCurr || null;
      const prevElec = readingMap[room.id]?.elecCurr || null;
      const prevPeople = prevSnapshotMap.has(room.id) ? prevSnapshotMap.get(room.id)! : null;
      const householdCount = householdMap.get(room.id) ?? 0;

      return {
        roomId: room.id,
        previousWaterCurrentReading: prevWater,
        previousElectricityCurrentReading: prevElec,
        previousCyclePeopleCount: prevPeople,
        currentHouseholdPeopleCount: householdCount,
      };
    });

    return {
      hasPreviousCycle: !!previousCycle,
      previousCycleId: previousCycle?.id,
      previousCycleCode: previousCycle?.cycleCode,
      rooms: roomResults,
    };
  }
}

export interface SaveMeterWorkspaceRowDto {
  roomId: string;
  waterPrev?: string | number | null;
  waterCurr?: string | number | null;
  elecPrev?: string | number | null;
  elecCurr?: string | number | null;
  isReplaced?: boolean;
  peopleCount?: number;
  manualOutstandingAmount?: string | number;
  otherFees?: Array<{ description: string; amount: string | number }>;
  expectedVersion?: number;
}

export const meterService = new MeterService();
