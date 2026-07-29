export interface BillingCycleEntity {
  id: string;
  dormitoryId: string;
  cycleCode: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  billingDate: Date;
  dueDate: Date;
  status: string; // draft, generated, completed, locked
  generatedAt?: Date | null;
  completedAt?: Date | null;
  lockedAt?: Date | null;
  createdByUserId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingRateSnapshotEntity {
  id: string;
  dormitoryId: string;
  billingCycleId: string;
  waterBillingType: string;
  waterRate: string;
  electricityBillingType: string;
  electricityRate: string;
  commonFee: string;
  internetFee: string;
  lateFeeType: string;
  lateFeeValue: string;
  currency: string;
  createdAt: Date;
}

export interface CreateBillingCycleData {
  id?: string;
  cycleCode: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  billingDate: Date;
  dueDate: Date;
  status?: string;
  createdByUserId?: string | null;
}

export interface CreateRateSnapshotData {
  id?: string;
  billingCycleId: string;
  waterBillingType?: string;
  waterRate?: string;
  electricityBillingType?: string;
  electricityRate?: string;
  commonFee?: string;
  internetFee?: string;
  lateFeeType?: string;
  lateFeeValue?: string;
  currency?: string;
}

export interface BillingCycleFilterQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface IBillingCycleRepository {
  findById(id: string, dormitoryId?: string): Promise<BillingCycleEntity | null>;
  findByCode(dormitoryId: string, cycleCode: string): Promise<BillingCycleEntity | null>;
  findOverlapping(dormitoryId: string, periodStart: Date, periodEnd: Date, excludeId?: string): Promise<BillingCycleEntity[]>;
  findAll(dormitoryId: string, filter?: BillingCycleFilterQuery): Promise<{ items: BillingCycleEntity[]; total: number }>;
  create(dormitoryId: string, data: CreateBillingCycleData): Promise<BillingCycleEntity>;
  update(id: string, dormitoryId: string, data: Partial<BillingCycleEntity>, expectedVersion?: number): Promise<BillingCycleEntity | null>;
  createRateSnapshot(dormitoryId: string, data: CreateRateSnapshotData): Promise<BillingRateSnapshotEntity>;
  findRateSnapshot(billingCycleId: string, dormitoryId?: string): Promise<BillingRateSnapshotEntity | null>;
}

export class InMemoryBillingCycleRepository implements IBillingCycleRepository {
  private cycles: Map<string, BillingCycleEntity> = new Map();
  private snapshots: Map<string, BillingRateSnapshotEntity> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<BillingCycleEntity | null> {
    const cycle = this.cycles.get(id);
    if (!cycle) return null;
    if (dormitoryId && cycle.dormitoryId !== dormitoryId) return null;
    return cycle;
  }

  public async findByCode(dormitoryId: string, cycleCode: string): Promise<BillingCycleEntity | null> {
    for (const c of this.cycles.values()) {
      if (c.dormitoryId === dormitoryId && c.cycleCode === cycleCode) {
        return c;
      }
    }
    return null;
  }

  public async findOverlapping(
    dormitoryId: string,
    periodStart: Date,
    periodEnd: Date,
    excludeId?: string
  ): Promise<BillingCycleEntity[]> {
    const startMs = periodStart.getTime();
    const endMs = periodEnd.getTime();

    return Array.from(this.cycles.values()).filter((c) => {
      if (c.dormitoryId !== dormitoryId) return false;
      if (excludeId && c.id === excludeId) return false;

      const cStartMs = new Date(c.periodStart).getTime();
      const cEndMs = new Date(c.periodEnd).getTime();

      return startMs <= cEndMs && cStartMs <= endMs;
    });
  }

  public async findAll(
    dormitoryId: string,
    filter: BillingCycleFilterQuery = {}
  ): Promise<{ items: BillingCycleEntity[]; total: number }> {
    let list = Array.from(this.cycles.values()).filter((c) => c.dormitoryId === dormitoryId);

    if (filter.status) {
      list = list.filter((c) => c.status === filter.status);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((c) => c.cycleCode.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }

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

  public async create(dormitoryId: string, data: CreateBillingCycleData): Promise<BillingCycleEntity> {
    const now = new Date();
    const id = data.id || `cycle-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const cycle: BillingCycleEntity = {
      id,
      dormitoryId,
      cycleCode: data.cycleCode,
      name: data.name,
      periodStart: data.periodStart,
      periodEnd: data.periodEnd,
      billingDate: data.billingDate,
      dueDate: data.dueDate,
      status: data.status || 'draft',
      createdByUserId: data.createdByUserId || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.cycles.set(id, cycle);
    return cycle;
  }

  public async update(
    id: string,
    dormitoryId: string,
    data: Partial<BillingCycleEntity>,
    expectedVersion?: number
  ): Promise<BillingCycleEntity | null> {
    const cycle = await this.findById(id, dormitoryId);
    if (!cycle) return null;

    if (expectedVersion !== undefined && cycle.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: BillingCycleEntity = {
      ...cycle,
      ...data,
      version: cycle.version + 1,
      updatedAt: new Date(),
    };
    this.cycles.set(id, updated);
    return updated;
  }

  public async createRateSnapshot(dormitoryId: string, data: CreateRateSnapshotData): Promise<BillingRateSnapshotEntity> {
    const now = new Date();
    const id = data.id || `snapshot-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const snapshot: BillingRateSnapshotEntity = {
      id,
      dormitoryId,
      billingCycleId: data.billingCycleId,
      waterBillingType: data.waterBillingType || 'per_unit',
      waterRate: data.waterRate || '18.00',
      electricityBillingType: data.electricityBillingType || 'per_unit',
      electricityRate: data.electricityRate || '7.00',
      commonFee: data.commonFee || '0.00',
      internetFee: data.internetFee || '0.00',
      lateFeeType: data.lateFeeType || 'fixed',
      lateFeeValue: data.lateFeeValue || '50.00',
      currency: data.currency || 'THB',
      createdAt: now,
    };
    this.snapshots.set(data.billingCycleId, snapshot);
    return snapshot;
  }

  public async findRateSnapshot(billingCycleId: string, dormitoryId?: string): Promise<BillingRateSnapshotEntity | null> {
    const s = this.snapshots.get(billingCycleId);
    if (!s) return null;
    if (dormitoryId && s.dormitoryId !== dormitoryId) return null;
    return s;
  }
}
