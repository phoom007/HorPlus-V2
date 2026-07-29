export interface DormitoryEntity {
  id: string;
  name: string;
  code?: string | null;
  type: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  countryCode: string;
  phone?: string | null;
  email?: string | null;
  estimatedBuildingCount: number;
  estimatedRoomCount: number;
  timezone: string;
  currency: string;
  status: string;
  createdByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateDormitoryData {
  id?: string;
  name: string;
  code?: string;
  type?: string;
  addressLine1?: string;
  addressLine2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  countryCode?: string;
  phone?: string;
  email?: string;
  estimatedBuildingCount?: number;
  estimatedRoomCount?: number;
  timezone?: string;
  currency?: string;
  status?: string;
  createdByUserId?: string;
}

export interface IDormitoryRepository {
  findById(id: string): Promise<DormitoryEntity | null>;
  create(data: CreateDormitoryData): Promise<DormitoryEntity>;
  update(id: string, data: Partial<DormitoryEntity>): Promise<DormitoryEntity | null>;
}

export class InMemoryDormitoryRepository implements IDormitoryRepository {
  private dorms: Map<string, DormitoryEntity> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData(): void {
    this.dorms.set('dorm-001', {
      id: 'dorm-001',
      name: 'HorPlus Grand Residence',
      code: 'DORM001',
      type: 'apartment',
      addressLine1: '123/45 Sukhumvit Rd',
      subdistrict: 'Khlong Toei',
      district: 'Khlong Toei',
      province: 'Bangkok',
      postalCode: '10110',
      countryCode: 'TH',
      phone: '021234567',
      email: 'contact@horplus-grand.com',
      estimatedBuildingCount: 1,
      estimatedRoomCount: 20,
      timezone: 'Asia/Bangkok',
      currency: 'THB',
      status: 'active',
      createdByUserId: 'usr-owner-001',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public async findById(id: string): Promise<DormitoryEntity | null> {
    const dorm = this.dorms.get(id);
    if (!dorm || dorm.status === 'deleted' || dorm.deletedAt) return null;
    return dorm;
  }

  public async create(data: CreateDormitoryData): Promise<DormitoryEntity> {
    const now = new Date();
    const id = data.id || `dorm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const dorm: DormitoryEntity = {
      id,
      name: data.name,
      code: data.code || null,
      type: data.type || 'apartment',
      addressLine1: data.addressLine1 || null,
      addressLine2: data.addressLine2 || null,
      subdistrict: data.subdistrict || null,
      district: data.district || null,
      province: data.province || null,
      postalCode: data.postalCode || null,
      countryCode: data.countryCode || 'TH',
      phone: data.phone || null,
      email: data.email || null,
      estimatedBuildingCount: data.estimatedBuildingCount || 1,
      estimatedRoomCount: data.estimatedRoomCount || 10,
      timezone: data.timezone || 'Asia/Bangkok',
      currency: data.currency || 'THB',
      status: data.status || 'active',
      createdByUserId: data.createdByUserId || null,
      createdAt: now,
      updatedAt: now,
    };
    this.dorms.set(id, dorm);
    return dorm;
  }

  public async update(id: string, data: Partial<DormitoryEntity>): Promise<DormitoryEntity | null> {
    const dorm = await this.findById(id);
    if (!dorm) return null;
    const updated: DormitoryEntity = {
      ...dorm,
      ...data,
      updatedAt: new Date(),
    };
    this.dorms.set(id, updated);
    return updated;
  }
}
