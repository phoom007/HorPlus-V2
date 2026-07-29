export interface TenantEntity {
  id: string;
  dormitoryId: string;
  linkedUserId?: string | null;
  tenantNumber: string;
  firstName: string;
  lastName?: string | null;
  displayName: string;
  phone: string;
  email?: string | null;
  nationalIdEncrypted?: string | null;
  nationalIdMasked?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  address?: string | null;
  status: string; // prospect, active, moving_out, former, inactive, archived
  photoUrl?: string | null;
  petInfo?: any;
  notes?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface TenantCoOccupantEntity {
  id: string;
  dormitoryId: string;
  tenantId: string;
  contractId?: string | null;
  name: string;
  phone?: string | null;
  relationship?: string | null;
  nationalIdEncrypted?: string | null;
  nationalIdMasked?: string | null;
  dateOfBirth?: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface TenantEmergencyContactEntity {
  id: string;
  dormitoryId: string;
  tenantId: string;
  name: string;
  phone: string;
  relationship: string;
  isPrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantVehicleEntity {
  id: string;
  dormitoryId: string;
  tenantId: string;
  type: string; // car, motorcycle, none, other
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  licensePlate: string;
  province?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateTenantData {
  id?: string;
  tenantNumber?: string;
  firstName: string;
  lastName?: string | null;
  displayName?: string;
  phone: string;
  email?: string | null;
  nationalId?: string | null;
  dateOfBirth?: Date | null;
  gender?: string | null;
  address?: string | null;
  status?: string;
  photoUrl?: string | null;
  petInfo?: any;
  notes?: string | null;
}

export interface TenantFilterQuery {
  status?: string;
  roomId?: string;
  contractStatus?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface ITenantRepository {
  findById(id: string, dormitoryId?: string): Promise<TenantEntity | null>;
  findByTenantNumber(dormitoryId: string, tenantNumber: string): Promise<TenantEntity | null>;
  findAll(dormitoryId: string, filter?: TenantFilterQuery): Promise<{ items: TenantEntity[]; total: number }>;
  countActiveByDormitory(dormitoryId: string): Promise<number>;
  create(dormitoryId: string, data: CreateTenantData): Promise<TenantEntity>;
  update(id: string, dormitoryId: string, data: Partial<TenantEntity>, expectedVersion?: number): Promise<TenantEntity | null>;
  archive(id: string, dormitoryId: string): Promise<TenantEntity | null>;

  // Co-occupants
  findCoOccupants(tenantId: string, dormitoryId: string): Promise<TenantCoOccupantEntity[]>;
  createCoOccupant(dormitoryId: string, tenantId: string, data: Partial<TenantCoOccupantEntity>): Promise<TenantCoOccupantEntity>;
  updateCoOccupant(id: string, dormitoryId: string, data: Partial<TenantCoOccupantEntity>): Promise<TenantCoOccupantEntity | null>;
  deleteCoOccupant(id: string, dormitoryId: string): Promise<boolean>;

  // Emergency Contacts
  findEmergencyContacts(tenantId: string, dormitoryId: string): Promise<TenantEmergencyContactEntity[]>;
  createEmergencyContact(dormitoryId: string, tenantId: string, data: Partial<TenantEmergencyContactEntity>): Promise<TenantEmergencyContactEntity>;
  updateEmergencyContact(id: string, dormitoryId: string, data: Partial<TenantEmergencyContactEntity>): Promise<TenantEmergencyContactEntity | null>;
  deleteEmergencyContact(id: string, dormitoryId: string): Promise<boolean>;

  // Vehicles
  findVehicles(tenantId: string, dormitoryId: string): Promise<TenantVehicleEntity[]>;
  createVehicle(dormitoryId: string, tenantId: string, data: Partial<TenantVehicleEntity>): Promise<TenantVehicleEntity>;
  updateVehicle(id: string, dormitoryId: string, data: Partial<TenantVehicleEntity>): Promise<TenantVehicleEntity | null>;
  deleteVehicle(id: string, dormitoryId: string): Promise<boolean>;
}

export class InMemoryTenantRepository implements ITenantRepository {
  private tenants: Map<string, TenantEntity> = new Map();
  private coOccupants: Map<string, TenantCoOccupantEntity> = new Map();
  private emergencyContacts: Map<string, TenantEmergencyContactEntity> = new Map();
  private vehicles: Map<string, TenantVehicleEntity> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<TenantEntity | null> {
    const t = this.tenants.get(id);
    if (!t || t.status === 'deleted' || t.deletedAt) return null;
    if (dormitoryId && t.dormitoryId !== dormitoryId) return null;
    return t;
  }

  public async findByTenantNumber(dormitoryId: string, tenantNumber: string): Promise<TenantEntity | null> {
    for (const t of this.tenants.values()) {
      if (t.dormitoryId === dormitoryId && !t.deletedAt && t.status !== 'archived' && t.tenantNumber === tenantNumber) {
        return t;
      }
    }
    return null;
  }

  public async countActiveByDormitory(dormitoryId: string): Promise<number> {
    let count = 0;
    for (const t of this.tenants.values()) {
      if (t.dormitoryId === dormitoryId && !t.deletedAt && t.status === 'active') {
        count++;
      }
    }
    return count;
  }

  public async findAll(dormitoryId: string, filter: TenantFilterQuery = {}): Promise<{ items: TenantEntity[]; total: number }> {
    let list = Array.from(this.tenants.values()).filter(
      (t) => t.dormitoryId === dormitoryId && !t.deletedAt && t.status !== 'archived'
    );

    if (filter.status) {
      list = list.filter((t) => t.status === filter.status);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter(
        (t) =>
          t.displayName.toLowerCase().includes(q) ||
          t.phone.includes(q) ||
          (t.email && t.email.toLowerCase().includes(q)) ||
          t.tenantNumber.toLowerCase().includes(q)
      );
    }

    // Sort
    const sortBy = filter.sortBy || 'createdAt';
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
    const pageSize = filter.pageSize && filter.pageSize > 0 ? filter.pageSize : 20;
    const start = (page - 1) * pageSize;
    const items = list.slice(start, start + pageSize);

    return { items, total };
  }

  public async create(dormitoryId: string, data: CreateTenantData): Promise<TenantEntity> {
    const now = new Date();
    const id = data.id || `tnt-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const tenantNumber = data.tenantNumber || `T${Date.now().toString().slice(-6)}`;
    const displayName = data.displayName || `${data.firstName} ${data.lastName || ''}`.trim();

    const tenant: TenantEntity = {
      id,
      dormitoryId,
      linkedUserId: null,
      tenantNumber,
      firstName: data.firstName,
      lastName: data.lastName || null,
      displayName,
      phone: data.phone,
      email: data.email || null,
      nationalIdEncrypted: null,
      nationalIdMasked: null,
      dateOfBirth: data.dateOfBirth || null,
      gender: data.gender || null,
      address: data.address || null,
      status: data.status || 'active',
      photoUrl: data.photoUrl || null,
      petInfo: data.petInfo || null,
      notes: data.notes || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.tenants.set(id, tenant);
    return tenant;
  }

  public async update(id: string, dormitoryId: string, data: Partial<TenantEntity>, expectedVersion?: number): Promise<TenantEntity | null> {
    const tenant = await this.findById(id, dormitoryId);
    if (!tenant) return null;

    if (expectedVersion !== undefined && tenant.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: TenantEntity = {
      ...tenant,
      ...data,
      version: tenant.version + 1,
      updatedAt: new Date(),
    };
    this.tenants.set(id, updated);
    return updated;
  }

  public async archive(id: string, dormitoryId: string): Promise<TenantEntity | null> {
    return this.update(id, dormitoryId, { status: 'archived', deletedAt: new Date() });
  }

  // Co-occupants
  public async findCoOccupants(tenantId: string, dormitoryId: string): Promise<TenantCoOccupantEntity[]> {
    return Array.from(this.coOccupants.values()).filter(
      (c) => c.tenantId === tenantId && c.dormitoryId === dormitoryId && !c.deletedAt
    );
  }

  public async createCoOccupant(dormitoryId: string, tenantId: string, data: Partial<TenantCoOccupantEntity>): Promise<TenantCoOccupantEntity> {
    const now = new Date();
    const id = data.id || `co-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const item: TenantCoOccupantEntity = {
      id,
      dormitoryId,
      tenantId,
      contractId: data.contractId || null,
      name: data.name || '',
      phone: data.phone || null,
      relationship: data.relationship || null,
      nationalIdEncrypted: data.nationalIdEncrypted || null,
      nationalIdMasked: data.nationalIdMasked || null,
      dateOfBirth: data.dateOfBirth || null,
      status: data.status || 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.coOccupants.set(id, item);
    return item;
  }

  public async updateCoOccupant(id: string, dormitoryId: string, data: Partial<TenantCoOccupantEntity>): Promise<TenantCoOccupantEntity | null> {
    const item = this.coOccupants.get(id);
    if (!item || item.dormitoryId !== dormitoryId || item.deletedAt) return null;
    const updated = { ...item, ...data, updatedAt: new Date() };
    this.coOccupants.set(id, updated);
    return updated;
  }

  public async deleteCoOccupant(id: string, dormitoryId: string): Promise<boolean> {
    const item = this.coOccupants.get(id);
    if (!item || item.dormitoryId !== dormitoryId) return false;
    item.deletedAt = new Date();
    return true;
  }

  // Emergency Contacts
  public async findEmergencyContacts(tenantId: string, dormitoryId: string): Promise<TenantEmergencyContactEntity[]> {
    return Array.from(this.emergencyContacts.values()).filter(
      (ec) => ec.tenantId === tenantId && ec.dormitoryId === dormitoryId
    );
  }

  public async createEmergencyContact(dormitoryId: string, tenantId: string, data: Partial<TenantEmergencyContactEntity>): Promise<TenantEmergencyContactEntity> {
    const now = new Date();
    const id = data.id || `ec-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const item: TenantEmergencyContactEntity = {
      id,
      dormitoryId,
      tenantId,
      name: data.name || '',
      phone: data.phone || '',
      relationship: data.relationship || '',
      isPrimary: data.isPrimary ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.emergencyContacts.set(id, item);
    return item;
  }

  public async updateEmergencyContact(id: string, dormitoryId: string, data: Partial<TenantEmergencyContactEntity>): Promise<TenantEmergencyContactEntity | null> {
    const item = this.emergencyContacts.get(id);
    if (!item || item.dormitoryId !== dormitoryId) return null;
    const updated = { ...item, ...data, updatedAt: new Date() };
    this.emergencyContacts.set(id, updated);
    return updated;
  }

  public async deleteEmergencyContact(id: string, dormitoryId: string): Promise<boolean> {
    const item = this.emergencyContacts.get(id);
    if (!item || item.dormitoryId !== dormitoryId) return false;
    this.emergencyContacts.delete(id);
    return true;
  }

  // Vehicles
  public async findVehicles(tenantId: string, dormitoryId: string): Promise<TenantVehicleEntity[]> {
    return Array.from(this.vehicles.values()).filter(
      (v) => v.tenantId === tenantId && v.dormitoryId === dormitoryId && !v.deletedAt
    );
  }

  public async createVehicle(dormitoryId: string, tenantId: string, data: Partial<TenantVehicleEntity>): Promise<TenantVehicleEntity> {
    const now = new Date();
    const id = data.id || `vh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const item: TenantVehicleEntity = {
      id,
      dormitoryId,
      tenantId,
      type: data.type || 'car',
      brand: data.brand || null,
      model: data.model || null,
      color: data.color || null,
      licensePlate: data.licensePlate || '',
      province: data.province || null,
      status: data.status || 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.vehicles.set(id, item);
    return item;
  }

  public async updateVehicle(id: string, dormitoryId: string, data: Partial<TenantVehicleEntity>): Promise<TenantVehicleEntity | null> {
    const item = this.vehicles.get(id);
    if (!item || item.dormitoryId !== dormitoryId || item.deletedAt) return null;
    const updated = { ...item, ...data, updatedAt: new Date() };
    this.vehicles.set(id, updated);
    return updated;
  }

  public async deleteVehicle(id: string, dormitoryId: string): Promise<boolean> {
    const item = this.vehicles.get(id);
    if (!item || item.dormitoryId !== dormitoryId) return false;
    item.deletedAt = new Date();
    return true;
  }
}
