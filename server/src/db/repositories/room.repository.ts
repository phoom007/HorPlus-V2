export interface RoomEntity {
  id: string;
  dormitoryId: string;
  buildingId?: string | null;
  roomNumber: string;
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
  create(dormitoryId: string, data: CreateRoomData): Promise<RoomEntity>;
  update(id: string, dormitoryId: string, data: Partial<RoomEntity>, expectedVersion?: number): Promise<RoomEntity | null>;
  archive(id: string, dormitoryId: string): Promise<RoomEntity | null>;
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

  public async create(dormitoryId: string, data: CreateRoomData): Promise<RoomEntity> {
    const now = new Date();
    const id = data.id || `rm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const room: RoomEntity = {
      id,
      dormitoryId,
      buildingId: data.buildingId || null,
      roomNumber: data.roomNumber,
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

  public async update(id: string, dormitoryId: string, data: Partial<RoomEntity>, expectedVersion?: number): Promise<RoomEntity | null> {
    const room = await this.findById(id, dormitoryId);
    if (!room) return null;

    if (expectedVersion !== undefined && room.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
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

  public async archive(id: string, dormitoryId: string): Promise<RoomEntity | null> {
    return this.update(id, dormitoryId, { status: 'archived', deletedAt: new Date() });
  }
}
