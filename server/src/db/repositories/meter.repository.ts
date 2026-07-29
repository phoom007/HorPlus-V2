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
  previousReading: string; // Decimal string
  currentReading: string; // Decimal string
  usageUnits: string; // Decimal string
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
  previousReading: string;
  currentReading: string;
  usageUnits: string;
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
  findDeviceById(id: string, dormitoryId?: string): Promise<MeterDeviceEntity | null>;
  findDeviceByRoomAndType(dormitoryId: string, roomId: string, type: string): Promise<MeterDeviceEntity | null>;
  listDevicesByRoom(dormitoryId: string, roomId: string): Promise<MeterDeviceEntity[]>;
  createDevice(dormitoryId: string, data: CreateMeterDeviceData): Promise<MeterDeviceEntity>;
  updateDevice(id: string, dormitoryId: string, data: Partial<MeterDeviceEntity>, expectedVersion?: number): Promise<MeterDeviceEntity | null>;

  // Meter Readings
  findReadingById(id: string, dormitoryId?: string): Promise<MeterReadingEntity | null>;
  findReadingByCycleRoomAndType(dormitoryId: string, billingCycleId: string, roomId: string, meterType: string): Promise<MeterReadingEntity | null>;
  findLatestPreviousReading(dormitoryId: string, roomId: string, meterType: string, beforeCycleId?: string): Promise<MeterReadingEntity | null>;
  listReadings(dormitoryId: string, filter?: MeterReadingFilterQuery): Promise<{ items: MeterReadingEntity[]; total: number }>;
  createReading(dormitoryId: string, data: CreateMeterReadingData): Promise<MeterReadingEntity>;
  updateReading(id: string, dormitoryId: string, data: Partial<MeterReadingEntity>, expectedVersion?: number): Promise<MeterReadingEntity | null>;

  // Meter Replacements
  createReplacement(dormitoryId: string, data: CreateMeterReplacementData): Promise<MeterReplacementEntity>;
  listReplacementsByRoom(dormitoryId: string, roomId: string): Promise<MeterReplacementEntity[]>;
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
    meterType: string
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
}
