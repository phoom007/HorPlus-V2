import { randomUUID } from 'crypto';

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
  waterTierRates?: any;
  electricityBillingType: string;
  electricityRate: string;
  electricityTierRates?: any;
  commonFee: string;
  commonFeeMode: string;
  internetFee: string;
  internetFeeMode: string;
  parkingFee: string;
  parkingFeeMode: string;
  lateFeeType: string;
  lateFeeValue: string;
  gracePeriodDays: number;
  currency: string;
  source: string; // TEMPLATE_DEFAULT, INHERITED, MANUAL_OVERRIDE
  inheritedFromBillingCycleId?: string | null;
  updatedByUserId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
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
  waterTierRates?: any;
  electricityBillingType?: string;
  electricityRate?: string;
  electricityTierRates?: any;
  commonFee?: string;
  commonFeeMode?: string;
  internetFee?: string;
  internetFeeMode?: string;
  parkingFee?: string;
  parkingFeeMode?: string;
  lateFeeType?: string;
  lateFeeValue?: string;
  gracePeriodDays?: number;
  currency?: string;
  source?: string;
  inheritedFromBillingCycleId?: string | null;
  updatedByUserId?: string | null;
  version?: number;
}

export interface UpdateRateSnapshotData {
  waterBillingType?: string;
  waterRate?: string;
  waterTierRates?: any;
  electricityBillingType?: string;
  electricityRate?: string;
  electricityTierRates?: any;
  commonFee?: string;
  commonFeeMode?: string;
  internetFee?: string;
  internetFeeMode?: string;
  parkingFee?: string;
  parkingFeeMode?: string;
  lateFeeType?: string;
  lateFeeValue?: string;
  gracePeriodDays?: number;
  currency?: string;
  source?: string;
  inheritedFromBillingCycleId?: string | null;
  updatedByUserId?: string | null;
}

export interface BillingCycleFilterQuery {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface SelectableBillingCycleRef {
  id: string;
  cycleCode: string;
  name: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
}

export interface IBillingCycleRepository {
  findById(id: string, dormitoryId?: string): Promise<BillingCycleEntity | null>;
  findByCode(dormitoryId: string, cycleCode: string): Promise<BillingCycleEntity | null>;
  findExistingCycleCodes(dormitoryId: string, cycleCodes: string[]): Promise<string[]>;
  findOverlapping(dormitoryId: string, periodStart: Date, periodEnd: Date, excludeId?: string): Promise<BillingCycleEntity[]>;
  findCycleRefsInRange(dormitoryId: string, minCycleCode: string, maxCycleCode: string): Promise<SelectableBillingCycleRef[]>;
  findAll(dormitoryId: string, filter?: BillingCycleFilterQuery): Promise<{ items: BillingCycleEntity[]; total: number }>;
  create(dormitoryId: string, data: CreateBillingCycleData): Promise<BillingCycleEntity>;
  update(id: string, dormitoryId: string, data: Partial<BillingCycleEntity>, expectedVersion?: number): Promise<BillingCycleEntity | null>;
  createRateSnapshot(dormitoryId: string, data: CreateRateSnapshotData): Promise<BillingRateSnapshotEntity>;
  updateRateSnapshot(id: string, dormitoryId: string, data: UpdateRateSnapshotData, expectedVersion?: number): Promise<BillingRateSnapshotEntity | null>;
  findRateSnapshot(billingCycleId: string, dormitoryId?: string): Promise<BillingRateSnapshotEntity | null>;
}

export class InMemoryBillingCycleRepository implements IBillingCycleRepository {
  private cycles: Map<string, BillingCycleEntity> = new Map();
  private snapshots: Map<string, BillingRateSnapshotEntity> = new Map();

  public async findCycleRefsInRange(
    dormitoryId: string,
    minCycleCode: string,
    maxCycleCode: string
  ): Promise<SelectableBillingCycleRef[]> {
    const list: SelectableBillingCycleRef[] = [];
    for (const c of this.cycles.values()) {
      if (
        c.dormitoryId === dormitoryId &&
        c.cycleCode >= minCycleCode &&
        c.cycleCode <= maxCycleCode
      ) {
        list.push({
          id: c.id,
          cycleCode: c.cycleCode,
          name: c.name,
          status: c.status || 'draft',
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
        });
      }
    }
    list.sort((a, b) => a.cycleCode.localeCompare(b.cycleCode));
    return list;
  }

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

  public async findExistingCycleCodes(dormitoryId: string, cycleCodes: string[]): Promise<string[]> {
    if (!cycleCodes || cycleCodes.length === 0) return [];
    const codeSet = new Set(cycleCodes);
    const found: string[] = [];
    for (const c of this.cycles.values()) {
      if (c.dormitoryId === dormitoryId && codeSet.has(c.cycleCode)) {
        found.push(c.cycleCode);
      }
    }
    return found;
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
    const id = data.id || randomUUID();
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
    const id = data.id || randomUUID();
    const snapshot: BillingRateSnapshotEntity = {
      id,
      dormitoryId,
      billingCycleId: data.billingCycleId,
      waterBillingType: data.waterBillingType || 'per_unit',
      waterRate: data.waterRate || '0.00',
      waterTierRates: data.waterTierRates || null,
      electricityBillingType: data.electricityBillingType || 'per_unit',
      electricityRate: data.electricityRate || '0.00',
      electricityTierRates: data.electricityTierRates || null,
      commonFee: data.commonFee || '0.00',
      commonFeeMode: data.commonFeeMode || 'none',
      internetFee: data.internetFee || '0.00',
      internetFeeMode: data.internetFeeMode || 'none',
      parkingFee: data.parkingFee || '0.00',
      parkingFeeMode: data.parkingFeeMode || 'none',
      lateFeeType: data.lateFeeType || 'none',
      lateFeeValue: data.lateFeeValue || '0.00',
      gracePeriodDays: data.gracePeriodDays ?? 0,
      currency: data.currency || 'THB',
      source: data.source || 'TEMPLATE_DEFAULT',
      inheritedFromBillingCycleId: data.inheritedFromBillingCycleId || null,
      updatedByUserId: data.updatedByUserId || null,
      version: data.version || 1,
      createdAt: now,
      updatedAt: now,
    };
    this.snapshots.set(data.billingCycleId, snapshot);
    return snapshot;
  }

  public async updateRateSnapshot(
    id: string,
    dormitoryId: string,
    data: UpdateRateSnapshotData,
    expectedVersion?: number
  ): Promise<BillingRateSnapshotEntity | null> {
    let targetKey: string | null = null;
    let existing: BillingRateSnapshotEntity | null = null;
    for (const [key, snap] of this.snapshots.entries()) {
      if (snap.id === id && snap.dormitoryId === dormitoryId) {
        targetKey = key;
        existing = snap;
        break;
      }
    }
    if (!existing || !targetKey) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('BILLING_RATE_SNAPSHOT_VERSION_CONFLICT');
      (err as any).statusCode = 409;
      (err as any).code = 'BILLING_RATE_SNAPSHOT_VERSION_CONFLICT';
      throw err;
    }

    const updated: BillingRateSnapshotEntity = {
      ...existing,
      ...data,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.snapshots.set(targetKey, updated);
    return updated;
  }

  public async findRateSnapshot(billingCycleId: string, dormitoryId?: string): Promise<BillingRateSnapshotEntity | null> {
    const s = this.snapshots.get(billingCycleId);
    if (!s) return null;
    if (dormitoryId && s.dormitoryId !== dormitoryId) return null;
    return s;
  }
}

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../prisma.js';

export class PrismaBillingCycleRepository implements IBillingCycleRepository {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  private mapCycleToEntity(c: any): BillingCycleEntity {
    return {
      id: c.id,
      dormitoryId: c.dormitoryId,
      cycleCode: c.cycleCode,
      name: c.name,
      periodStart: c.periodStart,
      periodEnd: c.periodEnd,
      billingDate: c.billingDate,
      dueDate: c.dueDate,
      status: c.status,
      createdByUserId: c.createdByUserId,
      version: c.version,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private mapSnapshotToEntity(s: any): BillingRateSnapshotEntity {
    const fmt = (val: any, dflt: string) => (val !== undefined && val !== null ? Number(val.toString()).toFixed(2) : dflt);
    return {
      id: s.id,
      dormitoryId: s.dormitoryId,
      billingCycleId: s.billingCycleId,
      waterBillingType: s.waterBillingType,
      waterRate: fmt(s.waterRate, '0.00'),
      waterTierRates: s.waterTierRates || null,
      electricityBillingType: s.electricityBillingType,
      electricityRate: fmt(s.electricityRate, '0.00'),
      electricityTierRates: s.electricityTierRates || null,
      commonFee: fmt(s.commonFee, '0.00'),
      commonFeeMode: s.commonFeeMode || 'none',
      internetFee: fmt(s.internetFee, '0.00'),
      internetFeeMode: s.internetFeeMode || 'none',
      parkingFee: fmt(s.parkingFee, '0.00'),
      parkingFeeMode: s.parkingFeeMode || 'none',
      lateFeeType: s.lateFeeType || 'none',
      lateFeeValue: fmt(s.lateFeeValue, '0.00'),
      gracePeriodDays: s.gracePeriodDays ?? 0,
      currency: s.currency,
      source: s.source,
      inheritedFromBillingCycleId: s.inheritedFromBillingCycleId,
      updatedByUserId: s.updatedByUserId,
      version: s.version,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  public async findById(id: string, dormitoryId?: string): Promise<BillingCycleEntity | null> {
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid(id)) return null;
    const where: any = { id };
    if (dormitoryId) where.dormitoryId = dormitoryId;
    const c = await this.prisma.billingCycle.findFirst({ where });
    return c ? this.mapCycleToEntity(c) : null;
  }

  public async findByCode(dormitoryId: string, cycleCode: string): Promise<BillingCycleEntity | null> {
    const c = await this.prisma.billingCycle.findUnique({
      where: {
        dormitory_cycle_code_unique: { dormitoryId, cycleCode },
      },
    });
    return c ? this.mapCycleToEntity(c) : null;
  }

  public async findExistingCycleCodes(dormitoryId: string, cycleCodes: string[]): Promise<string[]> {
    if (!cycleCodes || cycleCodes.length === 0) return [];
    const items = await this.prisma.billingCycle.findMany({
      where: {
        dormitoryId,
        cycleCode: { in: cycleCodes },
      },
      select: { cycleCode: true },
    });
    return items.map((c: any) => c.cycleCode);
  }

  public async findOverlapping(
    dormitoryId: string,
    periodStart: Date,
    periodEnd: Date,
    excludeId?: string
  ): Promise<BillingCycleEntity[]> {
    const where: any = {
      dormitoryId,
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    };
    if (excludeId) where.id = { not: excludeId };
    const items = await this.prisma.billingCycle.findMany({ where });
    return items.map((c: any) => this.mapCycleToEntity(c));
  }

  public async findCycleRefsInRange(
    dormitoryId: string,
    minCycleCode: string,
    maxCycleCode: string
  ): Promise<SelectableBillingCycleRef[]> {
    const records = await this.prisma.billingCycle.findMany({
      where: {
        dormitoryId,
        cycleCode: {
          gte: minCycleCode,
          lte: maxCycleCode,
        },
      },
      select: {
        id: true,
        cycleCode: true,
        name: true,
        status: true,
        periodStart: true,
        periodEnd: true,
      },
      orderBy: {
        cycleCode: 'asc',
      },
    });

    return records.map((r: any) => ({
      id: r.id,
      cycleCode: r.cycleCode,
      name: r.name,
      status: r.status,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
    }));
  }

  public async findAll(
    dormitoryId: string,
    filter: BillingCycleFilterQuery = {}
  ): Promise<{ items: BillingCycleEntity[]; total: number }> {
    const { status, search, page = 1, pageSize = 20, sortBy = 'periodStart', sortDirection = 'desc' } = filter;
    const where: any = { dormitoryId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { cycleCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.billingCycle.count({ where }),
      this.prisma.billingCycle.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { [sortBy]: sortDirection },
      }),
    ]);

    return {
      items: items.map((c: any) => this.mapCycleToEntity(c)),
      total,
    };
  }

  public async create(dormitoryId: string, data: CreateBillingCycleData): Promise<BillingCycleEntity> {
    const c = await this.prisma.billingCycle.create({
      data: {
        id: data.id,
        dormitoryId,
        cycleCode: data.cycleCode,
        name: data.name,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        billingDate: data.billingDate,
        dueDate: data.dueDate,
        status: data.status || 'draft',
        createdByUserId: data.createdByUserId,
      },
    });
    return this.mapCycleToEntity(c);
  }

  public async update(
    id: string,
    dormitoryId: string,
    data: Partial<BillingCycleEntity>,
    expectedVersion?: number
  ): Promise<BillingCycleEntity | null> {
    const existing = await this.findById(id, dormitoryId);
    if (!existing) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const c = await this.prisma.billingCycle.update({
      where: { id },
      data: {
        name: data.name,
        status: data.status,
        periodStart: data.periodStart ? new Date(data.periodStart) : undefined,
        periodEnd: data.periodEnd ? new Date(data.periodEnd) : undefined,
        billingDate: data.billingDate ? new Date(data.billingDate) : undefined,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
        version: { increment: 1 },
      },
    });
    return this.mapCycleToEntity(c);
  }

  public async createRateSnapshot(dormitoryId: string, data: CreateRateSnapshotData): Promise<BillingRateSnapshotEntity> {
    const s = await this.prisma.billingRateSnapshot.create({
      data: {
        dormitoryId,
        billingCycleId: data.billingCycleId,
        waterBillingType: data.waterBillingType!,
        waterRate: data.waterRate!,
        waterTierRates: data.waterTierRates || null,
        electricityBillingType: data.electricityBillingType!,
        electricityRate: data.electricityRate!,
        electricityTierRates: data.electricityTierRates || null,
        commonFee: data.commonFee!,
        commonFeeMode: data.commonFeeMode!,
        internetFee: data.internetFee!,
        internetFeeMode: data.internetFeeMode!,
        parkingFee: data.parkingFee!,
        parkingFeeMode: data.parkingFeeMode!,
        lateFeeType: data.lateFeeType!,
        lateFeeValue: data.lateFeeValue!,
        gracePeriodDays: data.gracePeriodDays ?? 0,
        currency: data.currency || 'THB',
        source: data.source!,
        inheritedFromBillingCycleId: data.inheritedFromBillingCycleId || null,
        updatedByUserId: data.updatedByUserId || null,
        version: data.version || 1,
      },
    });
    return this.mapSnapshotToEntity(s);
  }

  public async updateRateSnapshot(
    id: string,
    dormitoryId: string,
    data: UpdateRateSnapshotData,
    expectedVersion?: number
  ): Promise<BillingRateSnapshotEntity | null> {
    const updateData: any = {
      version: { increment: 1 },
      updatedAt: new Date(),
    };
    if (data.waterBillingType !== undefined) updateData.waterBillingType = data.waterBillingType;
    if (data.waterRate !== undefined) updateData.waterRate = data.waterRate;
    if (data.waterTierRates !== undefined) updateData.waterTierRates = data.waterTierRates;
    if (data.electricityBillingType !== undefined) updateData.electricityBillingType = data.electricityBillingType;
    if (data.electricityRate !== undefined) updateData.electricityRate = data.electricityRate;
    if (data.electricityTierRates !== undefined) updateData.electricityTierRates = data.electricityTierRates;
    if (data.commonFee !== undefined) updateData.commonFee = data.commonFee;
    if (data.commonFeeMode !== undefined) updateData.commonFeeMode = data.commonFeeMode;
    if (data.internetFee !== undefined) updateData.internetFee = data.internetFee;
    if (data.internetFeeMode !== undefined) updateData.internetFeeMode = data.internetFeeMode;
    if (data.parkingFee !== undefined) updateData.parkingFee = data.parkingFee;
    if (data.parkingFeeMode !== undefined) updateData.parkingFeeMode = data.parkingFeeMode;
    if (data.lateFeeType !== undefined) updateData.lateFeeType = data.lateFeeType;
    if (data.lateFeeValue !== undefined) updateData.lateFeeValue = data.lateFeeValue;
    if (data.gracePeriodDays !== undefined) updateData.gracePeriodDays = data.gracePeriodDays;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.source !== undefined) updateData.source = data.source;
    if (data.inheritedFromBillingCycleId !== undefined) updateData.inheritedFromBillingCycleId = data.inheritedFromBillingCycleId;
    if (data.updatedByUserId !== undefined) updateData.updatedByUserId = data.updatedByUserId;

    const whereClause: any = { id, dormitoryId };
    if (expectedVersion !== undefined) {
      whereClause.version = expectedVersion;
    }

    const res = await this.prisma.billingRateSnapshot.updateMany({
      where: whereClause,
      data: updateData,
    });

    if (res.count === 0) {
      const existing = await this.prisma.billingRateSnapshot.findFirst({
        where: { id, dormitoryId },
      });
      if (!existing) return null;
      const err = new Error('BILLING_RATE_SNAPSHOT_VERSION_CONFLICT');
      (err as any).statusCode = 409;
      (err as any).code = 'BILLING_RATE_SNAPSHOT_VERSION_CONFLICT';
      throw err;
    }

    const s = await this.prisma.billingRateSnapshot.findUniqueOrThrow({
      where: { id },
    });
    return this.mapSnapshotToEntity(s);
  }

  public async findRateSnapshot(billingCycleId: string, dormitoryId?: string): Promise<BillingRateSnapshotEntity | null> {
    const where: any = { billingCycleId };
    if (dormitoryId) where.dormitoryId = dormitoryId;
    const s = await this.prisma.billingRateSnapshot.findFirst({ where });
    return s ? this.mapSnapshotToEntity(s) : null;
  }
}
