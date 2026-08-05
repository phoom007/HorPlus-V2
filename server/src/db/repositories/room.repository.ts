export interface RoomEntity {
  id: string;
  dormitoryId: string;
  buildingId: string;
  roomNumber: string;
  normalizedRoomNumber: string;
  floor: number;
  roomType: string;
  status: string; // vacant, reserved, occupied, maintenance, inactive, archived
  rentCycle: string; // monthly, term, daily
  monthlyRent: string; // Decimal string e.g. "5000.00"
  termRent?: string | null;
  dailyRent?: string | null;
  depositAmount: string;
  parkingFee: string;
  maximumOccupants: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading: string;
  initialElectricityReading: string;
  amenities?: string[] | null;
  images?: string[] | null;
  notes?: string | null;
  currentTenantId?: string | null;
  currentContractId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateRoomData {
  id?: string;
  buildingId?: string | null;
  roomNumber: string;
  normalizedRoomNumber: string;
  floor: number;
  roomType?: string;
  status?: string;
  rentCycle?: string;
  monthlyRent: string;
  termRent?: string | null;
  dailyRent?: string | null;
  depositAmount?: string;
  parkingFee?: string;
  maximumOccupants?: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading?: string;
  initialElectricityReading?: string;
  amenities?: string[] | null;
  images?: string[] | null;
  notes?: string | null;
}

export interface RoomFilterQuery {
  buildingId?: string;
  floor?: number;
  status?: string;
  roomType?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface IRoomRepository {
  findById(id: string, dormitoryId?: string): Promise<RoomEntity | null>;
  findByRoomNumber(dormitoryId: string, roomNumber: string): Promise<RoomEntity | null>;
  findAll(dormitoryId: string, filter?: RoomFilterQuery): Promise<{ items: RoomEntity[]; total: number }>;
  countActiveByDormitory(dormitoryId: string): Promise<number>;
  countActiveByBuilding(dormitoryId: string, buildingId: string): Promise<number>;
  create(dormitoryId: string, data: CreateRoomData, tx?: any): Promise<RoomEntity>;
  update(id: string, dormitoryId: string, data: Partial<RoomEntity>, expectedVersion?: number, tx?: any): Promise<RoomEntity | null>;
  archive(id: string, dormitoryId: string, tx?: any): Promise<RoomEntity | null>;
}

export class InMemoryRoomRepository implements IRoomRepository {
  private rooms: Map<string, RoomEntity> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<RoomEntity | null> {
    const room = this.rooms.get(id);
    if (!room || room.status === 'deleted' || room.deletedAt) return null;
    if (dormitoryId && room.dormitoryId !== dormitoryId) return null;
    return room;
  }

  public async findByRoomNumber(dormitoryId: string, roomNumber: string): Promise<RoomEntity | null> {
    for (const r of this.rooms.values()) {
      if (r.dormitoryId === dormitoryId && !r.deletedAt && r.status !== 'archived' && r.roomNumber === roomNumber) {
        return r;
      }
    }
    return null;
  }

  public async countActiveByDormitory(dormitoryId: string): Promise<number> {
    let count = 0;
    for (const r of this.rooms.values()) {
      if (r.dormitoryId === dormitoryId && !r.deletedAt && r.status !== 'archived') {
        count++;
      }
    }
    return count;
  }

  public async countActiveByBuilding(dormitoryId: string, buildingId: string): Promise<number> {
    let count = 0;
    for (const r of this.rooms.values()) {
      if (r.dormitoryId === dormitoryId && r.buildingId === buildingId && !r.deletedAt && r.status !== 'archived') {
        count++;
      }
    }
    return count;
  }

  public async findAll(dormitoryId: string, filter: RoomFilterQuery = {}): Promise<{ items: RoomEntity[]; total: number }> {
    let list = Array.from(this.rooms.values()).filter(
      (r) => r.dormitoryId === dormitoryId && !r.deletedAt && r.status !== 'archived'
    );

    if (filter.buildingId) {
      list = list.filter((r) => r.buildingId === filter.buildingId);
    }

    if (filter.floor) {
      list = list.filter((r) => r.floor === Number(filter.floor));
    }

    if (filter.status) {
      list = list.filter((r) => r.status === filter.status);
    }

    if (filter.roomType) {
      list = list.filter((r) => r.roomType === filter.roomType);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((r) => r.roomNumber.toLowerCase().includes(q));
    }

    // Sort
    const sortBy = filter.sortBy || 'roomNumber';
    const direction = filter.sortDirection === 'desc' ? -1 : 1;
    list.sort((a: any, b: any) => {
      const valA = a[sortBy] ?? '';
      const valB = b[sortBy] ?? '';
      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
      return 0;
    });

    const total = list.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 50;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    return { items, total };
  }

  public async create(dormitoryId: string, data: CreateRoomData, tx?: any): Promise<RoomEntity> {
    if (!data.buildingId) throw new Error('Building ID is required for Room creation');
    for (const r of this.rooms.values()) {
      if (r.dormitoryId === dormitoryId && r.normalizedRoomNumber === data.normalizedRoomNumber && !r.deletedAt) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
    }

    const now = new Date();
    const id = data.id || `rm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const room: RoomEntity = {
      id,
      dormitoryId,
      buildingId: data.buildingId,
      roomNumber: data.roomNumber,
      normalizedRoomNumber: data.normalizedRoomNumber,
      floor: data.floor,
      roomType: data.roomType || 'standard',
      status: data.status || 'vacant',
      rentCycle: data.rentCycle || 'monthly',
      monthlyRent: data.monthlyRent || '0.00',
      termRent: data.termRent || null,
      dailyRent: data.dailyRent || null,
      depositAmount: data.depositAmount || '0.00',
      parkingFee: data.parkingFee || '0.00',
      maximumOccupants: data.maximumOccupants || 2,
      waterMeterNumber: data.waterMeterNumber || null,
      electricityMeterNumber: data.electricityMeterNumber || null,
      initialWaterReading: data.initialWaterReading || '0.00',
      initialElectricityReading: data.initialElectricityReading || '0.00',
      amenities: data.amenities || [],
      images: data.images || [],
      notes: data.notes || null,
      currentTenantId: null,
      currentContractId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rooms.set(id, room);
    return room;
  }

  public async update(id: string, dormitoryId: string, data: Partial<RoomEntity>, expectedVersion?: number, tx?: any): Promise<RoomEntity | null> {
    const room = await this.findById(id, dormitoryId);
    if (!room) return null;

    if (expectedVersion !== undefined && room.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    if (data.normalizedRoomNumber || data.buildingId !== undefined) {
      const newBuildingId = data.buildingId !== undefined ? data.buildingId : room.buildingId;
      const newNormalizedRoomNumber = data.normalizedRoomNumber || room.normalizedRoomNumber;
      
      for (const r of this.rooms.values()) {
        if (r.id !== id && r.dormitoryId === dormitoryId && r.normalizedRoomNumber === newNormalizedRoomNumber && !r.deletedAt) {
          const err: any = new Error('Unique constraint failed');
          err.code = 'P2002';
          throw err;
        }
      }
    }

    const updated: RoomEntity = {
      ...room,
      ...data,
      version: room.version + 1,
      updatedAt: new Date(),
    };
    this.rooms.set(id, updated);
    return updated;
  }

  public async archive(id: string, dormitoryId: string, tx?: any): Promise<RoomEntity | null> {
    return this.update(id, dormitoryId, { status: 'archived', deletedAt: new Date() }, undefined, tx);
  }
}

export class PrismaRoomRepository implements IRoomRepository {
  constructor(private prisma: any) {}

  private getClient(tx?: any) {
    return tx || this.prisma;
  }

  public async findById(id: string, dormitoryId?: string): Promise<RoomEntity | null> {
    const where: any = { id, deletedAt: null };
    if (dormitoryId) {
      where.dormitoryId = dormitoryId;
    }
    const room = await this.prisma.room.findFirst({ where });
    if (!room) return null;
    return this.mapToEntity(room);
  }

  public async findByRoomNumber(dormitoryId: string, roomNumber: string): Promise<RoomEntity | null> {
    const room = await this.prisma.room.findFirst({
      where: {
        dormitoryId,
        roomNumber: { equals: roomNumber, mode: 'insensitive' },
        deletedAt: null,
        status: { not: 'archived' }
      },
    });
    if (!room) return null;
    return this.mapToEntity(room);
  }

  public async countActiveByDormitory(dormitoryId: string): Promise<number> {
    return this.prisma.room.count({
      where: {
        dormitoryId,
        deletedAt: null,
        status: { not: 'archived' }
      },
    });
  }

  public async countActiveByBuilding(dormitoryId: string, buildingId: string): Promise<number> {
    return this.prisma.room.count({
      where: {
        dormitoryId,
        buildingId,
        deletedAt: null,
        status: { not: 'archived' }
      },
    });
  }

  public async findAll(dormitoryId: string, filter: RoomFilterQuery = {}): Promise<{ items: RoomEntity[]; total: number }> {
    const where: any = {
      dormitoryId,
      deletedAt: null,
      status: filter.status || { not: 'archived' },
    };

    if (filter.buildingId) {
      where.buildingId = filter.buildingId;
    }
    if (filter.floor) {
      where.floor = Number(filter.floor);
    }
    if (filter.roomType) {
      where.roomType = filter.roomType;
    }
    if (filter.search) {
      where.roomNumber = { contains: filter.search, mode: 'insensitive' };
    }

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 50;
    const skip = (page - 1) * pageSize;

    const orderBy: any = {};
    const sortBy = filter.sortBy || 'roomNumber';
    orderBy[sortBy] = filter.sortDirection || 'asc';

    const [items, total] = await Promise.all([
      this.prisma.room.findMany({ where, skip, take: pageSize, orderBy }),
      this.prisma.room.count({ where }),
    ]);
    console.log('Room findAll where:', JSON.stringify(where), 'skip:', skip, 'take:', pageSize, 'Result:', items.length, 'Total:', total);

    return { items: items.map((r: any) => this.mapToEntity(r)), total };
  }

  public async create(dormitoryId: string, data: CreateRoomData, tx?: any): Promise<RoomEntity> {
    const client = this.getClient(tx);

    try {
      const room = await client.room.create({
        data: {
          id: data.id,
          dormitoryId,
          buildingId: data.buildingId!,
          roomNumber: data.roomNumber,
          normalizedRoomNumber: data.normalizedRoomNumber || data.roomNumber.toLowerCase().replace(/[^a-z0-9]/g, '') || data.roomNumber.toLowerCase(),
          floor: data.floor,
          roomType: data.roomType || 'standard',
          status: data.status || 'vacant',
          rentCycle: data.rentCycle || 'monthly',
          monthlyRent: data.monthlyRent || '0.00',
          termRent: data.termRent || null,
          dailyRent: data.dailyRent || null,
          depositAmount: data.depositAmount || '0.00',
          parkingFee: data.parkingFee || '0.00',
          maximumOccupants: data.maximumOccupants || 2,
          waterMeterNumber: data.waterMeterNumber || null,
          electricityMeterNumber: data.electricityMeterNumber || null,
          initialWaterReading: data.initialWaterReading || '0.00',
          initialElectricityReading: data.initialElectricityReading || '0.00',
          amenities: data.amenities || [],
          images: data.images || [],
          notes: data.notes || null,
        },
      });
      return this.mapToEntity(room);
    } catch (err: any) {
      if (err.code === 'P2002') {
        const customErr: any = new Error('Unique constraint failed');
        customErr.code = 'P2002';
        throw customErr;
      }
      throw err;
    }
  }

  public async update(id: string, dormitoryId: string, data: Partial<RoomEntity>, expectedVersion?: number, tx?: any): Promise<RoomEntity | null> {
    const client = this.getClient(tx);
    const existing = await client.room.findFirst({ where: { id, dormitoryId, deletedAt: null } });
    if (!existing) return null;

    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    try {
      const room = await client.room.update({
        where: { id },
        data: {
          ...data,
          version: existing.version + 1,
        },
      });
      return this.mapToEntity(room);
    } catch (err: any) {
      if (err.code === 'P2002') {
        const customErr: any = new Error('Unique constraint failed');
        customErr.code = 'P2002';
        throw customErr;
      }
      throw err;
    }
  }

  public async archive(id: string, dormitoryId: string, tx?: any): Promise<RoomEntity | null> {
    return this.update(id, dormitoryId, { status: 'archived', deletedAt: new Date() }, undefined, tx);
  }

  private mapToEntity(prismaRoom: any): RoomEntity {
    const fmt = (val: any) => (val !== undefined && val !== null ? Number(val.toString()).toFixed(2) : '0.00');
    return {
      ...prismaRoom,
      monthlyRent: fmt(prismaRoom.monthlyRent),
      termRent: prismaRoom.termRent ? fmt(prismaRoom.termRent) : null,
      dailyRent: prismaRoom.dailyRent ? fmt(prismaRoom.dailyRent) : null,
      depositAmount: fmt(prismaRoom.depositAmount),
      parkingFee: fmt(prismaRoom.parkingFee),
      initialWaterReading: fmt(prismaRoom.initialWaterReading),
      initialElectricityReading: fmt(prismaRoom.initialElectricityReading),
    };
  }
}

