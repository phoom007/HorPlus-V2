import { PrismaClient } from '@prisma/client';

export interface MeterDeviceEntity {
  id: string;
  dormitoryId: string;
  roomId: string;
  type: string; // water, electricity
  meterNumber: string;
  status: string; // active, inactive, replaced
  installedAt: Date;
  removedAt?: Date | null;
  initialReading: string; // Decimal string
  currentReading: string; // Decimal string
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface MeterReadingEntity {
  id: string;
  dormitoryId: string;
  billingCycleId: string;
  roomId: string;
  meterDeviceId: string;
  meterType: string; // water, electricity
  previousReading?: string | null;
  currentReading?: string | null;
  usageUnits?: string | null;
  isReplacement: boolean;
  replacementId?: string | null;
  readAt: Date;
  readByUserId?: string | null;
  status: string; // draft, confirmed
  notes?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeterReplacementEntity {
  id: string;
  dormitoryId: string;
  roomId: string;
  meterType: string;
  oldMeterDeviceId: string;
  newMeterDeviceId: string;
  oldMeterFinalReading: string;
  newMeterInitialReading: string;
  replacementDate: Date;
  reason?: string | null;
  createdByUserId?: string | null;
  createdAt: Date;
}

export interface CreateMeterDeviceData {
  id?: string;
  roomId: string;
  type: string;
  meterNumber: string;
  status?: string;
  installedAt?: Date;
  initialReading?: string;
  currentReading?: string;
}

export interface CreateMeterReadingData {
  id?: string;
  billingCycleId: string;
  roomId: string;
  meterDeviceId: string;
  meterType: string;
  previousReading?: string | null;
  currentReading?: string | null;
  usageUnits?: string | null;
  isReplacement?: boolean;
  replacementId?: string | null;
  readAt?: Date;
  readByUserId?: string | null;
  status?: string;
  notes?: string | null;
}

export interface CreateMeterReplacementData {
  id?: string;
  roomId: string;
  meterType: string;
  oldMeterDeviceId: string;
  newMeterDeviceId: string;
  oldMeterFinalReading: string;
  newMeterInitialReading: string;
  replacementDate?: Date;
  reason?: string | null;
  createdByUserId?: string | null;
}

export interface MeterReadingFilterQuery {
  billingCycleId?: string;
  roomId?: string;
  meterType?: string;
  status?: string;
  buildingId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface IMeterRepository {
  // Meter Devices
  findDeviceById(id: string, dormitoryId?: string, tx?: any): Promise<MeterDeviceEntity | null>;
  findDeviceByRoomAndType(dormitoryId: string, roomId: string, type: string, tx?: any): Promise<MeterDeviceEntity | null>;
  listDevicesByRoom(dormitoryId: string, roomId: string): Promise<MeterDeviceEntity[]>;
  createDevice(dormitoryId: string, data: CreateMeterDeviceData, tx?: any): Promise<MeterDeviceEntity>;
  updateDevice(id: string, dormitoryId: string, data: Partial<MeterDeviceEntity>, expectedVersion?: number, tx?: any): Promise<MeterDeviceEntity | null>;

  // Meter Readings
  findReadingById(id: string, dormitoryId?: string, tx?: any): Promise<MeterReadingEntity | null>;
  findReadingByCycleRoomAndType(dormitoryId: string, billingCycleId: string, roomId: string, meterType: string, tx?: any): Promise<MeterReadingEntity | null>;
  findLatestPreviousReading(dormitoryId: string, roomId: string, meterType: string, beforeCycleId?: string): Promise<MeterReadingEntity | null>;
  listReadings(dormitoryId: string, filter?: MeterReadingFilterQuery): Promise<{ items: MeterReadingEntity[]; total: number }>;
  createReading(dormitoryId: string, data: CreateMeterReadingData, tx?: any): Promise<MeterReadingEntity>;
  updateReading(id: string, dormitoryId: string, data: Partial<MeterReadingEntity>, expectedVersion?: number, tx?: any): Promise<MeterReadingEntity | null>;

  // Meter Replacements
  createReplacement(dormitoryId: string, data: CreateMeterReplacementData): Promise<MeterReplacementEntity>;
  listReplacementsByRoom(dormitoryId: string, roomId: string): Promise<MeterReplacementEntity[]>;

  withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  executeRawLock(roomId: string, tx: any): Promise<void>;
}

export class InMemoryMeterRepository implements IMeterRepository {
  private devices: Map<string, MeterDeviceEntity> = new Map();
  private readings: Map<string, MeterReadingEntity> = new Map();
  private replacements: Map<string, MeterReplacementEntity> = new Map();

  // Meter Devices
  public async findDeviceById(id: string, dormitoryId?: string): Promise<MeterDeviceEntity | null> {
    const dev = this.devices.get(id);
    if (!dev || dev.deletedAt) return null;
    if (dormitoryId && dev.dormitoryId !== dormitoryId) return null;
    return dev;
  }

  public async findDeviceByRoomAndType(dormitoryId: string, roomId: string, type: string): Promise<MeterDeviceEntity | null> {
    for (const d of this.devices.values()) {
      if (d.dormitoryId === dormitoryId && d.roomId === roomId && d.type === type && d.status === 'active' && !d.deletedAt) {
        return d;
      }
    }
    return null;
  }

  public async listDevicesByRoom(dormitoryId: string, roomId: string): Promise<MeterDeviceEntity[]> {
    return Array.from(this.devices.values()).filter(
      (d) => d.dormitoryId === dormitoryId && d.roomId === roomId && !d.deletedAt
    );
  }

  public async createDevice(dormitoryId: string, data: CreateMeterDeviceData): Promise<MeterDeviceEntity> {
    const now = new Date();
    const id = data.id || `meter-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const device: MeterDeviceEntity = {
      id,
      dormitoryId,
      roomId: data.roomId,
      type: data.type,
      meterNumber: data.meterNumber,
      status: data.status || 'active',
      installedAt: data.installedAt || now,
      removedAt: null,
      initialReading: data.initialReading || '0.00',
      currentReading: data.currentReading || data.initialReading || '0.00',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.devices.set(id, device);
    return device;
  }

  public async updateDevice(
    id: string,
    dormitoryId: string,
    data: Partial<MeterDeviceEntity>,
    expectedVersion?: number
  ): Promise<MeterDeviceEntity | null> {
    const device = await this.findDeviceById(id, dormitoryId);
    if (!device) return null;

    if (expectedVersion !== undefined && device.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: MeterDeviceEntity = {
      ...device,
      ...data,
      version: device.version + 1,
      updatedAt: new Date(),
    };
    this.devices.set(id, updated);
    return updated;
  }

  // Meter Readings
  public async findReadingById(id: string, dormitoryId?: string): Promise<MeterReadingEntity | null> {
    const r = this.readings.get(id);
    if (!r) return null;
    if (dormitoryId && r.dormitoryId !== dormitoryId) return null;
    return r;
  }

  public async findReadingByCycleRoomAndType(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    meterType: string,
    tx?: any
  ): Promise<MeterReadingEntity | null> {
    for (const r of this.readings.values()) {
      if (
        r.dormitoryId === dormitoryId &&
        r.billingCycleId === billingCycleId &&
        r.roomId === roomId &&
        r.meterType === meterType
      ) {
        return r;
      }
    }
    return null;
  }

  public async findLatestPreviousReading(
    dormitoryId: string,
    roomId: string,
    meterType: string,
    beforeCycleId?: string
  ): Promise<MeterReadingEntity | null> {
    const matches = Array.from(this.readings.values()).filter(
      (r) =>
        r.dormitoryId === dormitoryId &&
        r.roomId === roomId &&
        r.meterType === meterType &&
        r.billingCycleId !== beforeCycleId
    );

    if (matches.length === 0) return null;

    matches.sort((a, b) => new Date(b.readAt).getTime() - new Date(a.readAt).getTime());
    return matches[0];
  }

  public async listReadings(
    dormitoryId: string,
    filter: MeterReadingFilterQuery = {}
  ): Promise<{ items: MeterReadingEntity[]; total: number }> {
    let list = Array.from(this.readings.values()).filter((r) => r.dormitoryId === dormitoryId);

    if (filter.billingCycleId) {
      list = list.filter((r) => r.billingCycleId === filter.billingCycleId);
    }
    if (filter.roomId) {
      list = list.filter((r) => r.roomId === filter.roomId);
    }
    if (filter.meterType) {
      list = list.filter((r) => r.meterType === filter.meterType);
    }
    if (filter.status) {
      list = list.filter((r) => r.status === filter.status);
    }

    const total = list.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 50;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    return { items, total };
  }

  public async createReading(dormitoryId: string, data: CreateMeterReadingData): Promise<MeterReadingEntity> {
    const now = new Date();
    const id = data.id || `rdg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const reading: MeterReadingEntity = {
      id,
      dormitoryId,
      billingCycleId: data.billingCycleId,
      roomId: data.roomId,
      meterDeviceId: data.meterDeviceId,
      meterType: data.meterType,
      previousReading: data.previousReading,
      currentReading: data.currentReading,
      usageUnits: data.usageUnits,
      isReplacement: data.isReplacement || false,
      replacementId: data.replacementId || null,
      readAt: data.readAt || now,
      readByUserId: data.readByUserId || null,
      status: data.status || 'draft',
      notes: data.notes || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.readings.set(id, reading);
    return reading;
  }

  public async updateReading(
    id: string,
    dormitoryId: string,
    data: Partial<MeterReadingEntity>,
    expectedVersion?: number
  ): Promise<MeterReadingEntity | null> {
    const reading = await this.findReadingById(id, dormitoryId);
    if (!reading) return null;

    if (expectedVersion !== undefined && reading.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: MeterReadingEntity = {
      ...reading,
      ...data,
      version: reading.version + 1,
      updatedAt: new Date(),
    };
    this.readings.set(id, updated);
    return updated;
  }

  // Meter Replacements
  public async createReplacement(dormitoryId: string, data: CreateMeterReplacementData): Promise<MeterReplacementEntity> {
    const now = new Date();
    const id = data.id || `mrp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const replacement: MeterReplacementEntity = {
      id,
      dormitoryId,
      roomId: data.roomId,
      meterType: data.meterType,
      oldMeterDeviceId: data.oldMeterDeviceId,
      newMeterDeviceId: data.newMeterDeviceId,
      oldMeterFinalReading: data.oldMeterFinalReading,
      newMeterInitialReading: data.newMeterInitialReading,
      replacementDate: data.replacementDate || now,
      reason: data.reason || null,
      createdByUserId: data.createdByUserId || null,
      createdAt: now,
    };
    this.replacements.set(id, replacement);
    return replacement;
  }

  public async listReplacementsByRoom(dormitoryId: string, roomId: string): Promise<MeterReplacementEntity[]> {
    return Array.from(this.replacements.values()).filter(
      (r) => r.dormitoryId === dormitoryId && r.roomId === roomId
    );
  }

  public async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn(null);
  }

  public async executeRawLock(roomId: string, tx: any): Promise<void> {
    return;
  }
}

export class PrismaMeterRepository implements IMeterRepository {
  constructor(private prisma: PrismaClient) {}

  private getClient(tx?: any): PrismaClient {
    return tx || this.prisma;
  }

  private mapDeviceToEntity(model: any): MeterDeviceEntity {
    return {
      id: model.id,
      dormitoryId: model.dormitoryId,
      roomId: model.roomId,
      type: model.type,
      meterNumber: model.meterNumber,
      status: model.status,
      installedAt: model.installedAt,
      removedAt: model.removedAt || null,
      initialReading: model.initialReading ? model.initialReading.toString() : '0.00',
      currentReading: model.currentReading ? model.currentReading.toString() : '0.00',
      version: model.version,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      deletedAt: model.deletedAt || null,
    };
  }

  private mapReadingToEntity(model: any): MeterReadingEntity {
    const fmt = (val: any) => (val !== undefined && val !== null ? Number(val.toString()).toFixed(2) : null);
    return {
      id: model.id,
      dormitoryId: model.dormitoryId,
      billingCycleId: model.billingCycleId,
      roomId: model.roomId,
      meterDeviceId: model.meterDeviceId,
      meterType: model.meterType,
      previousReading: fmt(model.previousReading),
      currentReading: fmt(model.currentReading),
      usageUnits: fmt(model.usageUnits),
      isReplacement: model.isReplacement || false,
      replacementId: model.replacementId || null,
      readAt: model.readAt,
      readByUserId: model.readByUserId || null,
      status: model.status,
      notes: model.notes || null,
      version: model.version,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  public async createDevice(dormitoryId: string, data: CreateMeterDeviceData, tx?: any): Promise<MeterDeviceEntity> {
    const client = this.getClient(tx);
    const device = await client.meterDevice.create({
      data: {
        id: data.id,
        dormitoryId,
        roomId: data.roomId,
        type: data.type,
        meterNumber: data.meterNumber,
        status: data.status || 'active',
        installedAt: data.installedAt || new Date(),
        initialReading: data.initialReading || '0.00',
        currentReading: data.currentReading || data.initialReading || '0.00',
      },
    });
    return this.mapDeviceToEntity(device);
  }

  public async findDeviceById(id: string, dormitoryId: string, tx?: any): Promise<MeterDeviceEntity | null> {
    const client = this.getClient(tx);
    const device = await client.meterDevice.findFirst({
      where: { id, dormitoryId, deletedAt: null },
    });
    return device ? this.mapDeviceToEntity(device) : null;
  }

  public async findDeviceByRoomAndType(dormitoryId: string, roomId: string, type: string, tx?: any): Promise<MeterDeviceEntity | null> {
    const client = this.getClient(tx);
    const device = await client.meterDevice.findFirst({
      where: { dormitoryId, roomId, type, status: 'active', deletedAt: null },
    });
    return device ? this.mapDeviceToEntity(device) : null;
  }

  public async listDevicesByRoom(dormitoryId: string, roomId: string): Promise<MeterDeviceEntity[]> {
    const devices = await this.prisma.meterDevice.findMany({
      where: { dormitoryId, roomId, deletedAt: null },
    });
    return devices.map((d) => this.mapDeviceToEntity(d));
  }

  public async updateDevice(
    id: string,
    dormitoryId: string,
    data: Partial<MeterDeviceEntity>,
    expectedVersion?: number,
    tx?: any
  ): Promise<MeterDeviceEntity | null> {
    const client = this.getClient(tx);
    const existing = await this.findDeviceById(id, dormitoryId, tx);
    if (!existing) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const device = await client.meterDevice.update({
      where: { id },
      data: {
        status: data.status,
        currentReading: data.currentReading,
        removedAt: data.removedAt ? new Date(data.removedAt) : undefined,
        version: { increment: 1 },
      },
    });
    return this.mapDeviceToEntity(device);
  }

  public async createReading(dormitoryId: string, data: CreateMeterReadingData, tx?: any): Promise<MeterReadingEntity> {
    const client = this.getClient(tx);
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const reading = await client.meterReading.create({
      data: {
        id: data.id,
        dormitoryId,
        billingCycleId: data.billingCycleId,
        roomId: data.roomId,
        meterDeviceId: data.meterDeviceId,
        meterType: data.meterType,
        previousReading: data.previousReading,
        currentReading: data.currentReading,
        usageUnits: data.usageUnits,
        isReplacement: data.isReplacement || false,
        replacementId: data.replacementId || null,
        readAt: data.readAt || new Date(),
        readByUserId: isUuid(data.readByUserId) ? data.readByUserId : null,
        status: data.status || 'draft',
        notes: data.notes || null,
      },
    });

    // Update current reading on meter device if provided
    if (data.currentReading !== undefined && data.currentReading !== null) {
      await client.meterDevice.update({
        where: { id: data.meterDeviceId },
        data: { currentReading: data.currentReading },
      });
    }

    return this.mapReadingToEntity(reading);
  }

  public async findReadingById(id: string, dormitoryId: string, tx?: any): Promise<MeterReadingEntity | null> {
    const client = this.getClient(tx);
    const reading = await client.meterReading.findFirst({
      where: { id, dormitoryId },
    });
    return reading ? this.mapReadingToEntity(reading) : null;
  }

  public async findReadingByCycleRoomAndType(dormitoryId: string, billingCycleId: string, roomId: string, meterType: string, tx?: any): Promise<MeterReadingEntity | null> {
    const client = this.getClient(tx);
    const reading = await client.meterReading.findFirst({
      where: { dormitoryId, billingCycleId, roomId, meterType },
    });
    return reading ? this.mapReadingToEntity(reading) : null;
  }

  public async listReadingsByCycle(dormitoryId: string, billingCycleId: string): Promise<MeterReadingEntity[]> {
    const readings = await this.prisma.meterReading.findMany({
      where: { dormitoryId, billingCycleId },
    });
    return readings.map((r) => this.mapReadingToEntity(r));
  }

  public async executeRawLock(roomId: string, tx: any): Promise<void> {
    if (tx && tx.$queryRawUnsafe) {
       await tx.$queryRawUnsafe(`SELECT 1 FROM "rooms" WHERE id = $1::uuid FOR UPDATE`, roomId);
    }
  }

  public async updateReading(id: string, dormitoryId: string, data: Partial<MeterReadingEntity>, expectedVersion?: number, tx?: any): Promise<MeterReadingEntity | null> {
    const client = this.getClient(tx);
    const existing = await this.findReadingById(id, dormitoryId, tx);
    if (!existing) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updateData: any = {};
    if (data.currentReading !== undefined) updateData.currentReading = data.currentReading;
    if (data.previousReading !== undefined) updateData.previousReading = data.previousReading;
    if (data.usageUnits !== undefined) updateData.usageUnits = data.usageUnits;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.notes !== undefined) updateData.notes = data.notes;

    const updated = await client.meterReading.update({
      where: { id },
      data: { ...updateData, version: { increment: 1 } },
    });

    if (data.currentReading !== undefined && data.currentReading !== null) {
      await client.meterDevice.update({
        where: { id: existing.meterDeviceId },
        data: { currentReading: data.currentReading },
      });
    }

    return this.mapReadingToEntity(updated);
  }

  public async createReplacement(dormitoryId: string, data: CreateMeterReplacementData): Promise<MeterReplacementEntity> {
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const replacement = await this.prisma.meterReplacement.create({
      data: {
        id: data.id,
        dormitoryId,
        roomId: data.roomId,
        meterType: data.meterType,
        oldMeterDeviceId: data.oldMeterDeviceId,
        newMeterDeviceId: data.newMeterDeviceId,
        oldMeterFinalReading: data.oldMeterFinalReading,
        newMeterInitialReading: data.newMeterInitialReading,
        replacementDate: data.replacementDate || new Date(),
        reason: data.reason || null,
        createdByUserId: isUuid(data.createdByUserId) ? data.createdByUserId : null,
      },
    });

    return {
      id: replacement.id,
      dormitoryId: replacement.dormitoryId,
      roomId: replacement.roomId,
      meterType: replacement.meterType,
      oldMeterDeviceId: replacement.oldMeterDeviceId,
      newMeterDeviceId: replacement.newMeterDeviceId,
      oldMeterFinalReading: replacement.oldMeterFinalReading.toString(),
      newMeterInitialReading: replacement.newMeterInitialReading.toString(),
      replacementDate: replacement.replacementDate,
      reason: replacement.reason || null,
      createdByUserId: replacement.createdByUserId || null,
      createdAt: replacement.createdAt,
    };
  }

  public async listReplacementsByRoom(dormitoryId: string, roomId: string): Promise<MeterReplacementEntity[]> {
    const replacements = await this.prisma.meterReplacement.findMany({
      where: { dormitoryId, roomId },
    });
    return replacements.map((r) => ({
      id: r.id,
      dormitoryId: r.dormitoryId,
      roomId: r.roomId,
      meterType: r.meterType,
      oldMeterDeviceId: r.oldMeterDeviceId,
      newMeterDeviceId: r.newMeterDeviceId,
      oldMeterFinalReading: r.oldMeterFinalReading.toString(),
      newMeterInitialReading: r.newMeterInitialReading.toString(),
      replacementDate: r.replacementDate,
      reason: r.reason || null,
      createdByUserId: r.createdByUserId || null,
      createdAt: r.createdAt,
    }));
  }

  public async findLatestPreviousReading(dormitoryId: string, roomId: string, meterType: string, beforeCycleId?: string): Promise<MeterReadingEntity | null> {
    const reading = await this.prisma.meterReading.findFirst({
      where: { dormitoryId, roomId, meterType },
      orderBy: { createdAt: 'desc' }
    });
    return reading ? this.mapReadingToEntity(reading) : null;
  }

  public async listReadings(dormitoryId: string, filter?: any): Promise<{ items: MeterReadingEntity[]; total: number }> {
    const whereClause: any = { dormitoryId };
    if (filter?.roomId) whereClause.roomId = filter.roomId;
    if (filter?.billingCycleId) whereClause.billingCycleId = filter.billingCycleId;
    if (filter?.meterType) whereClause.meterType = filter.meterType;
    if (filter?.status) whereClause.status = filter.status;

    const page = filter?.page && Number(filter.page) > 0 ? Number(filter.page) : 1;
    const pageSize = filter?.pageSize && Number(filter.pageSize) > 0 ? Number(filter.pageSize) : 50;

    const [readings, total] = await Promise.all([
      this.prisma.meterReading.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.meterReading.count({ where: whereClause }),
    ]);

    return { items: readings.map((r) => this.mapReadingToEntity(r)), total };
  }

  public async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30000 });
  }
}
