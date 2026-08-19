import {
  IMeterRepository,
  MeterDeviceEntity,
  MeterReadingEntity,
  MeterReplacementEntity,
  MeterReadingFilterQuery,
} from '../db/repositories/meter.repository.js';
import { IBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { IBillRepository } from '../db/repositories/bill.repository.js';
import { AuditService } from './audit.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { toDecimal, formatDecimal, compareDecimals } from '../utils/decimal-math.util.js';

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
  previousReading: string;
  currentReading: string;
  readAt?: string;
  notes?: string;
}

export interface BulkMeterReadingDto {
  billingCycleId: string;
  readings: BulkMeterReadingItemDto[];
}

export class MeterService {
  constructor(
    private meterRepo: IMeterRepository,
    private billingCycleRepo: IBillingCycleRepository,
    private roomRepo: IRoomRepository,
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
  ): Promise<string> {
    // 1. Find prior billing cycle reading for this room and meter type
    const cycle = await this.billingCycleRepo.findById(billingCycleId, dormitoryId);
    if (cycle) {
      const cycles = await this.billingCycleRepo.findAll(dormitoryId, { sortDirection: 'desc', pageSize: 100 });
      const priorCycles = cycles.items.filter((c) => c.periodStart < cycle.periodStart);
      for (const priorCycle of priorCycles) {
        const priorReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          priorCycle.id,
          roomId,
          meterType,
          tx
        );
        if (priorReading) {
          return priorReading.currentReading;
        }
      }
    }

    // 2. Find active MeterDevice initial / current reading
    const device = await this.meterRepo.findDeviceByRoomAndType(dormitoryId, roomId, meterType, tx);
    if (device && device.initialReading !== undefined && device.initialReading !== null) {
      return String(device.initialReading);
    }

    // 3. Find Room initial meter value
    const room = await this.roomRepo.findById(roomId, dormitoryId);
    if (room) {
      const roomObj = room as any;
      if (meterType === 'water') {
        const val = room.initialWaterReading ?? roomObj.initialWaterMeter;
        if (val !== undefined && val !== null) return String(val);
      }
      if (meterType === 'electricity') {
        const val = room.initialElectricityReading ?? roomObj.initialElectricMeter;
        if (val !== undefined && val !== null) return String(val);
      }
    }

    return '0.00';
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
        const authPrev = await this.resolveAuthoritativePreviousReading(
          dormitoryId,
          data.billingCycleId,
          item.roomId,
          item.meterType,
          tx
        );

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

    const prevVal = Number(reading.previousReading);
    const currVal = Number(currentReading);

    if (isNaN(prevVal) || isNaN(currVal) || prevVal < 0 || currVal < 0) {
      const err = new Error('INVALID_METER_READING_VALUE');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_METER_READING';
      (err as any).message = `ค่ามิเตอร์ต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0`;
      throw err;
    }

    const usageUnits = (currVal - prevVal).toFixed(2);
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
  ): Promise<void> {
    const prisma = getPrismaClient();
    const client = tx || prisma;

    let snapshot = rateSnapshot;
    if (!snapshot) {
      snapshot = await this.billingCycleRepo.findRateSnapshot(billingCycleId, dormitoryId);
    }
    const waterMode = snapshot?.waterBillingType || 'per_unit';
    const elecMode = snapshot?.electricityBillingType || 'per_unit';

    let firstCycle = isFirstCycle;
    if (firstCycle === undefined) {
      const earliest = await client.billingCycle.findFirst({
        where: { dormitoryId },
        orderBy: { periodStart: 'asc' },
      });
      firstCycle = earliest ? earliest.id === billingCycleId : false;
    }

    // 1. Water reading if entered and per_unit
    if (row.waterCurr !== undefined && row.waterCurr !== null && String(row.waterCurr).trim() !== '') {
      if (waterMode === 'per_unit') {
        let authPrev = '0.00';
        if (firstCycle && row.waterPrev !== undefined && row.waterPrev !== null && String(row.waterPrev).trim() !== '') {
          authPrev = formatDecimal(toDecimal(String(row.waterPrev)));
        } else {
          authPrev = await this.resolveAuthoritativePreviousReading(
            dormitoryId,
            billingCycleId,
            row.roomId,
            'water',
            tx
          );
        }

        const prevVal = Number(authPrev);
        const currVal = Number(row.waterCurr);

        if (isNaN(prevVal) || isNaN(currVal) || prevVal < 0 || currVal < 0) {
          const err = new Error(`ค่ามิเตอร์น้ำต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          throw err;
        }

        if (currVal < prevVal) {
          const err = new Error(`ค่ามิเตอร์น้ำปัจจุบัน (${currVal}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${prevVal})`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          throw err;
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

        const usageUnits = (currVal - prevVal).toFixed(2);
        const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          billingCycleId,
          row.roomId,
          'water',
          tx
        );

        if (existingReading) {
          await this.meterRepo.updateReading(
            existingReading.id,
            dormitoryId,
            {
              previousReading: authPrev,
              currentReading: formatDecimal(toDecimal(String(row.waterCurr))),
              usageUnits,
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
              currentReading: formatDecimal(toDecimal(String(row.waterCurr))),
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
    if (row.elecCurr !== undefined && row.elecCurr !== null && String(row.elecCurr).trim() !== '') {
      if (elecMode === 'per_unit') {
        let authPrev = '0.00';
        if (firstCycle && row.elecPrev !== undefined && row.elecPrev !== null && String(row.elecPrev).trim() !== '') {
          authPrev = formatDecimal(toDecimal(String(row.elecPrev)));
        } else {
          authPrev = await this.resolveAuthoritativePreviousReading(
            dormitoryId,
            billingCycleId,
            row.roomId,
            'electricity',
            tx
          );
        }

        const prevVal = Number(authPrev);
        const currVal = Number(row.elecCurr);

        if (isNaN(prevVal) || isNaN(currVal) || prevVal < 0 || currVal < 0) {
          const err = new Error(`ค่ามิเตอร์ไฟฟ้าต้องเป็นตัวเลขที่มากกว่าหรือเท่ากับ 0`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          throw err;
        }

        if (currVal < prevVal) {
          const err = new Error(`ค่ามิเตอร์ไฟฟ้าปัจจุบัน (${currVal}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${prevVal})`);
          (err as any).statusCode = 400;
          (err as any).code = 'INVALID_METER_READING';
          throw err;
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

        const usageUnits = (currVal - prevVal).toFixed(2);
        const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
          dormitoryId,
          billingCycleId,
          row.roomId,
          'electricity',
          tx
        );

        if (existingReading) {
          await this.meterRepo.updateReading(
            existingReading.id,
            dormitoryId,
            {
              previousReading: authPrev,
              currentReading: formatDecimal(toDecimal(String(row.elecCurr))),
              usageUnits,
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
              currentReading: formatDecimal(toDecimal(String(row.elecCurr))),
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
        const updateData: any = {
          updatedByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
          version: existingSnap.version + 1,
        };
        if (row.peopleCount !== undefined) updateData.peopleCount = Math.max(0, row.peopleCount);
        if (row.manualOutstandingAmount !== undefined) {
          updateData.manualOutstandingAmount = toDecimal(String(row.manualOutstandingAmount));
        }
        if (row.otherFees !== undefined) {
          updateData.otherFees = cleanOtherFees;
        }
        await client.roomBillingCycleSnapshot.update({
          where: { id: existingSnap.id },
          data: updateData,
        });
      } else {
        await client.roomBillingCycleSnapshot.create({
          data: {
            dormitoryId,
            billingCycleId,
            roomId: row.roomId,
            peopleCount: row.peopleCount !== undefined ? Math.max(0, row.peopleCount) : 0,
            manualOutstandingAmount: row.manualOutstandingAmount !== undefined ? toDecimal(String(row.manualOutstandingAmount)) : toDecimal('0.00'),
            otherFees: cleanOtherFees,
            source: 'MANUAL',
            updatedByUserId: userId && /^[0-9a-fA-F-]{36}$/.test(userId) ? userId : null,
          },
        });
      }
    }
  }

  public async saveBulkMeterWorkspace(
    dormitoryId: string,
    data: { billingCycleId: string; rows: SaveMeterWorkspaceRowDto[] },
    userId?: string
  ): Promise<{ savedCount: number }> {
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
      const sortedRoomIds = [...new Set(data.rows.map((r) => r.roomId))].sort();
      for (const roomId of sortedRoomIds) {
        await this.meterRepo.executeRawLock(roomId, tx);
      }

      for (const row of data.rows) {
        if (this.billRepo) {
          const activeBill = await this.billRepo.findByCycleAndRoom(dormitoryId, data.billingCycleId, row.roomId, tx);
          if (activeBill && activeBill.status !== 'cancelled' && activeBill.status !== 'void') {
            const err = new Error('METER_MODIFICATION_BLOCKED_BY_BILL');
            (err as any).statusCode = 400;
            (err as any).code = 'METER_MODIFICATION_BLOCKED_BY_BILL';
            (err as any).message = 'ไม่สามารถแก้ไขข้อมูลมิเตอร์ได้เนื่องจากมีการออกบิลแล้ว';
            throw err;
          }
        }

        await this.saveSingleRoomWorkspaceInTx(
          dormitoryId,
          data.billingCycleId,
          row,
          userId,
          tx,
          rateSnapshot,
          isFirstCycle
        );
      }

      return { savedCount: data.rows.length };
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
      // 1. Save dirty workspace row if present
      if (data.dirtyRow) {
        await this.meterRepo.withTransaction(async (tx) => {
          await this.saveSingleRoomWorkspaceInTx(dormitoryId, data.billingCycleId, data.dirtyRow!, userId, tx);
        });
      }

      // 2. Check if bill already exists
      if (this.billRepo) {
        const existing = await this.billRepo.findByCycleAndRoom(dormitoryId, data.billingCycleId, data.roomId);
        if (existing) {
          const items = await this.billRepo.getBillItems(existing.id, dormitoryId);
          return { action: 'issue', bill: existing, items, created: false, status: existing.status };
        }
      }

      // 3. Generate bill atomically (generateBill executes within its own transactional lock)
      const result = await billingService.generateBill(
        dormitoryId,
        {
          billingCycleId: data.billingCycleId,
          roomId: data.roomId,
        },
        userId
      );

      return {
        action: 'issue',
        bill: result.bill,
        items: result.items,
        created: result.created,
        status: result.bill.status,
      };
    } else {
      // Cancel bill
      const activeBill = await this.billRepo?.findByCycleAndRoom(dormitoryId, data.billingCycleId, data.roomId);
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
}

export interface SaveMeterWorkspaceRowDto {
  roomId: string;
  waterPrev?: string | number;
  waterCurr?: string | number;
  elecPrev?: string | number;
  elecCurr?: string | number;
  isReplaced?: boolean;
  peopleCount?: number;
  manualOutstandingAmount?: string | number;
  otherFees?: Array<{ description: string; amount: string | number }>;
  expectedVersion?: number;
}

