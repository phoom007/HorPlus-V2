import {
  IMeterRepository,
  MeterDeviceEntity,
  MeterReadingEntity,
  MeterReplacementEntity,
  MeterReadingFilterQuery,
} from '../db/repositories/meter.repository.js';
import { IBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { IRoomRepository } from '../db/repositories/room.repository.js';
import { AuditService } from './audit.service.js';

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
        payload: { roomId: data.roomId, type: data.type, meterNumber: data.meterNumber },
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
        payload: { oldDeviceId: oldDevice.id, newDeviceId: newDevice.id, reason: data.reason },
      });
    }

    return { oldDevice: updatedOld, newDevice, replacement };
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

    for (const item of data.readings) {
      const prevVal = Number(item.previousReading);
      const currVal = Number(item.currentReading);

      if (currVal < prevVal) {
        const err = new Error(`CURRENT_READING_LESS_THAN_PREVIOUS`);
        (err as any).statusCode = 400;
        (err as any).code = 'INVALID_METER_READING';
        (err as any).message = `ค่ามิเตอร์ปัจจุบัน (${currVal}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${prevVal})`;
        throw err;
      }

      let device = item.meterDeviceId
        ? await this.meterRepo.findDeviceById(item.meterDeviceId, dormitoryId)
        : await this.meterRepo.findDeviceByRoomAndType(dormitoryId, item.roomId, item.meterType);

      if (!device) {
        // Auto-create active device if missing
        device = await this.meterRepo.createDevice(dormitoryId, {
          roomId: item.roomId,
          type: item.meterType,
          meterNumber: `${item.meterType.toUpperCase()}-${item.roomId.slice(-4)}`,
          initialReading: item.previousReading,
        });
      }

      const usageUnits = (currVal - prevVal).toFixed(2);

      const existingReading = await this.meterRepo.findReadingByCycleRoomAndType(
        dormitoryId,
        data.billingCycleId,
        item.roomId,
        item.meterType
      );

      let reading: MeterReadingEntity;
      if (existingReading) {
        const updated = await this.meterRepo.updateReading(
          existingReading.id,
          dormitoryId,
          {
            previousReading: item.previousReading,
            currentReading: item.currentReading,
            usageUnits,
            readAt: item.readAt ? new Date(item.readAt) : new Date(),
            readByUserId: userId,
            notes: item.notes,
          },
          existingReading.version
        );
        reading = updated!;
      } else {
        reading = await this.meterRepo.createReading(dormitoryId, {
          billingCycleId: data.billingCycleId,
          roomId: item.roomId,
          meterDeviceId: device.id,
          meterType: item.meterType,
          previousReading: item.previousReading,
          currentReading: item.currentReading,
          usageUnits,
          readAt: item.readAt ? new Date(item.readAt) : new Date(),
          readByUserId: userId,
          status: 'draft',
          notes: item.notes,
        });
      }

      // Update current reading on device
      await this.meterRepo.updateDevice(device.id, dormitoryId, { currentReading: item.currentReading });

      createdReadings.push(reading);
    }

    if (this.auditService) {
      await this.auditService.log({
        dormitoryId,
        actorUserId: userId || 'system',
        action: 'meter_reading.bulk_submit',
        resourceType: 'billing_cycle',
        resourceId: data.billingCycleId,
        payload: { count: createdReadings.length },
      });
    }

    return createdReadings;
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

    const prevVal = Number(reading.previousReading);
    const currVal = Number(currentReading);
    if (currVal < prevVal) {
      const err = new Error('INVALID_METER_READING');
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_METER_READING';
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
        payload: { currentReading, usageUnits },
      });
    }

    return updated;
  }
}
