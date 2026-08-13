export const BLOCKING_CONTRACT_STATUSES = [
  'active',
  'expiring_soon',
  'pending_signature',
  'waiting_extension',
  'checking_out',
];

import { v4 as uuidv4 } from 'uuid';
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../prisma.js';

export interface ContractEntity {
  id: string;
  dormitoryId: string;
  contractNumber: string;
  roomId: string;
  tenantId: string;
  status: string; // draft, pending_signature, active, expiring_soon, waiting_extension, checking_out, expired, terminated
  startDate: Date;
  endDate: Date;
  durationMonths: number;
  rentBillingType: string;
  rentAmount: string; // Decimal string
  depositAmount: string;
  advancePaymentAmount: string;
  terms?: string | null;
  tenantSignature?: string | null;
  ownerSignature?: string | null;
  signedByOwnerAt?: Date | null;
  signedByTenantAt?: Date | null;
  activatedAt?: Date | null;
  terminatedAt?: Date | null;
  terminationEffectiveDate?: Date | null;
  terminationReason?: string | null;
  settlementSummary?: any;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  previousContractId?: string | null;
}

export interface ContractStatusHistoryEntity {
  id: string;
  dormitoryId: string;
  contractId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  effectiveAt: Date;
  changedByUserId?: string | null;
  metadata?: any;
  createdAt: Date;
}

export interface CreateContractData {
  id?: string;
  contractNumber?: string;
  roomId: string;
  tenantId: string;
  status?: string;
  startDate: Date;
  endDate: Date;
  durationMonths?: number;
  rentBillingType?: string;
  rentAmount: string;
  depositAmount?: string;
  advancePaymentAmount?: string;
  terms?: string | null;
  createdByUserId?: string | null;
  previousContractId?: string | null;
}

export interface ContractFilterQuery {
  status?: string;
  roomId?: string;
  tenantId?: string;
  buildingId?: string;
  startDateFrom?: Date;
  startDateTo?: Date;
  endDateFrom?: Date;
  endDateTo?: Date;
  expiringWithinDays?: number;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface IContractRepository {
  findById(id: string, dormitoryId?: string): Promise<ContractEntity | null>;
  findByContractNumber(dormitoryId: string, contractNumber: string): Promise<ContractEntity | null>;
  findAll(dormitoryId: string, filter?: ContractFilterQuery): Promise<{ items: ContractEntity[]; total: number }>;
  findActiveContractsForRoom(dormitoryId: string, roomId: string): Promise<ContractEntity[]>;
  findOverlappingContractsForRoom(dormitoryId: string, roomId: string, startDate: Date, endDate: Date, excludeContractId?: string): Promise<ContractEntity[]>;
  countActiveByDormitory(dormitoryId: string): Promise<number>;
  countExpiringByDormitory(dormitoryId: string, days?: number): Promise<number>;
  create(dormitoryId: string, data: CreateContractData): Promise<ContractEntity>;
  update(id: string, dormitoryId: string, data: Partial<ContractEntity>, expectedVersion?: number): Promise<ContractEntity | null>;
  deleteDraft(id: string, dormitoryId: string): Promise<boolean>;

  // Status History
  addStatusHistory(dormitoryId: string, contractId: string, fromStatus: string | null, toStatus: string, reason?: string, changedByUserId?: string, metadata?: any): Promise<ContractStatusHistoryEntity>;
  findStatusHistories(contractId: string, dormitoryId: string): Promise<ContractStatusHistoryEntity[]>;
}

export class InMemoryContractRepository implements IContractRepository {
  private contracts: Map<string, ContractEntity> = new Map();
  private histories: Map<string, ContractStatusHistoryEntity> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<ContractEntity | null> {
    const c = this.contracts.get(id);
    if (!c || c.deletedAt) return null;
    if (dormitoryId && c.dormitoryId !== dormitoryId) return null;
    return c;
  }

  public async findByContractNumber(dormitoryId: string, contractNumber: string): Promise<ContractEntity | null> {
    for (const c of this.contracts.values()) {
      if (c.dormitoryId === dormitoryId && !c.deletedAt && c.contractNumber === contractNumber) {
        return c;
      }
    }
    return null;
  }

  public async countActiveByDormitory(dormitoryId: string): Promise<number> {
    let count = 0;
    for (const c of this.contracts.values()) {
      if (c.dormitoryId === dormitoryId && !c.deletedAt && c.status === 'active') {
        count++;
      }
    }
    return count;
  }

  public async countExpiringByDormitory(dormitoryId: string, days: number = 30): Promise<number> {
    const now = new Date();
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    let count = 0;
    for (const c of this.contracts.values()) {
      if (
        c.dormitoryId === dormitoryId &&
        !c.deletedAt &&
        (c.status === 'active' || c.status === 'expiring_soon') &&
        c.endDate <= threshold &&
        c.endDate >= now
      ) {
        count++;
      }
    }
    return count;
  }

  public async findActiveContractsForRoom(dormitoryId: string, roomId: string): Promise<ContractEntity[]> {
    return Array.from(this.contracts.values()).filter(
      (c) =>
        c.dormitoryId === dormitoryId &&
        c.roomId === roomId &&
        !c.deletedAt &&
        BLOCKING_CONTRACT_STATUSES.includes(c.status)
    );
  }

  public async findOverlappingContractsForRoom(
    dormitoryId: string,
    roomId: string,
    startDate: Date,
    endDate: Date,
    excludeContractId?: string
  ): Promise<ContractEntity[]> {
    const newStart = startDate.getTime();
    const newEnd = endDate.getTime();

    return Array.from(this.contracts.values()).filter((c) => {
      if (c.dormitoryId !== dormitoryId || c.roomId !== roomId || c.deletedAt) return false;
      if (excludeContractId && c.id === excludeContractId) return false;
      if (!BLOCKING_CONTRACT_STATUSES.includes(c.status)) return false;

      const existingStart = new Date(c.startDate).getTime();
      const existingEnd = new Date(c.endDate).getTime();

      // Half-open interval [start, end) overlap formula:
      // Overlap iff newStart < existingEnd AND existingStart < newEnd
      return newStart < existingEnd && existingStart < newEnd;
    });
  }

  public async findAll(dormitoryId: string, filter: ContractFilterQuery = {}): Promise<{ items: ContractEntity[]; total: number }> {
    let list = Array.from(this.contracts.values()).filter(
      (c) => c.dormitoryId === dormitoryId && !c.deletedAt
    );

    if (filter.status) {
      list = list.filter((c) => c.status === filter.status);
    }

    if (filter.roomId) {
      list = list.filter((c) => c.roomId === filter.roomId);
    }

    if (filter.tenantId) {
      list = list.filter((c) => c.tenantId === filter.tenantId);
    }

    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((c) => c.contractNumber.toLowerCase().includes(q));
    }

    if (filter.expiringWithinDays) {
      const now = new Date();
      const threshold = new Date(now.getTime() + filter.expiringWithinDays * 24 * 60 * 60 * 1000);
      list = list.filter(
        (c) =>
          (c.status === 'active' || c.status === 'expiring_soon') &&
          c.endDate <= threshold &&
          c.endDate >= now
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

  public async create(dormitoryId: string, data: CreateContractData): Promise<ContractEntity> {
    const now = new Date();
    const id = data.id || uuidv4();
    const contractNumber = data.contractNumber || `CTR${Date.now().toString().slice(-6)}`;

    const contract: ContractEntity = {
      id,
      dormitoryId,
      contractNumber,
      roomId: data.roomId,
      tenantId: data.tenantId,
      status: data.status || 'draft',
      startDate: data.startDate,
      endDate: data.endDate,
      durationMonths: data.durationMonths || 1,
      rentBillingType: data.rentBillingType || 'monthly',
      rentAmount: data.rentAmount,
      depositAmount: data.depositAmount || '0.00',
      advancePaymentAmount: data.advancePaymentAmount || '0.00',
      terms: data.terms || null,
      tenantSignature: null,
      ownerSignature: null,
      signedByOwnerAt: null,
      signedByTenantAt: null,
      activatedAt: null,
      terminatedAt: null,
      terminationEffectiveDate: null,
      terminationReason: null,
      settlementSummary: null,
      createdByUserId: data.createdByUserId || null,
      updatedByUserId: data.createdByUserId || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.contracts.set(id, contract);

    // Initial Status History
    await this.addStatusHistory(dormitoryId, id, null, contract.status, 'Contract created', data.createdByUserId || undefined);

    return contract;
  }

  public async update(id: string, dormitoryId: string, data: Partial<ContractEntity>, expectedVersion?: number): Promise<ContractEntity | null> {
    const contract = await this.findById(id, dormitoryId);
    if (!contract) return null;

    if (expectedVersion !== undefined && contract.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: ContractEntity = {
      ...contract,
      ...data,
      version: contract.version + 1,
      updatedAt: new Date(),
    };
    this.contracts.set(id, updated);
    return updated;
  }

  public async deleteDraft(id: string, dormitoryId: string): Promise<boolean> {
    const contract = await this.findById(id, dormitoryId);
    if (!contract) return false;
    if (contract.status !== 'draft') {
      const err = new Error('CONTRACT_CANNOT_BE_DELETED');
      (err as any).code = 'CONTRACT_CANNOT_BE_DELETED';
      throw err;
    }
    contract.deletedAt = new Date();
    return true;
  }

  // Status History
  public async addStatusHistory(
    dormitoryId: string,
    contractId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string,
    changedByUserId?: string,
    metadata?: any
  ): Promise<ContractStatusHistoryEntity> {
    const now = new Date();
    const id = `csh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const history: ContractStatusHistoryEntity = {
      id,
      dormitoryId,
      contractId,
      fromStatus: fromStatus || null,
      toStatus,
      reason: reason || null,
      effectiveAt: now,
      changedByUserId: changedByUserId || null,
      metadata: metadata || null,
      createdAt: now,
    };
    this.histories.set(id, history);
    return history;
  }

  public async findStatusHistories(contractId: string, dormitoryId: string): Promise<ContractStatusHistoryEntity[]> {
    return Array.from(this.histories.values()).filter(
      (h) => h.contractId === contractId && h.dormitoryId === dormitoryId
    );
  }
}

export class PrismaContractRepository implements IContractRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapContractToEntity(c: any): ContractEntity {
    return {
      id: c.id,
      dormitoryId: c.dormitoryId,
      contractNumber: c.contractNumber,
      roomId: c.roomId,
      tenantId: c.tenantId,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      durationMonths: c.durationMonths,
      rentBillingType: c.rentBillingType,
      rentAmount: c.rentAmount ? c.rentAmount.toString() : '0.00',
      depositAmount: c.depositAmount ? c.depositAmount.toString() : '0.00',
      advancePaymentAmount: c.advancePaymentAmount ? c.advancePaymentAmount.toString() : '0.00',
      terms: c.terms,
      tenantSignature: c.tenantSignature,
      ownerSignature: c.ownerSignature,
      activatedAt: c.activatedAt,
      terminatedAt: c.terminatedAt,
      terminationReason: c.terminationReason,
      version: c.version,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      deletedAt: c.deletedAt,
      previousContractId: c.previousContractId,
    };
  }

  public async findById(id: string, dormitoryId?: string): Promise<ContractEntity | null> {
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid(id)) return null;
    const where: any = { id };
    if (dormitoryId) where.dormitoryId = dormitoryId;
    const c = await this.prisma.contract.findFirst({ where });
    return c ? this.mapContractToEntity(c) : null;
  }

  public async findByContractNumber(dormitoryId: string, contractNumber: string): Promise<ContractEntity | null> {
    const c = await this.prisma.contract.findFirst({ where: { dormitoryId, contractNumber } });
    return c ? this.mapContractToEntity(c) : null;
  }

  public async findAll(dormitoryId: string, filter: ContractFilterQuery = {}): Promise<{ items: ContractEntity[]; total: number }> {
    const where: any = { dormitoryId, deletedAt: null };
    if (filter.status) where.status = filter.status;
    if (filter.roomId) where.roomId = filter.roomId;
    if (filter.tenantId) where.tenantId = filter.tenantId;

    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.prisma.contract.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
      this.prisma.contract.count({ where }),
    ]);

    return { items: items.map((c: any) => this.mapContractToEntity(c)), total };
  }

  public async findActiveContractsForRoom(dormitoryId: string, roomId: string): Promise<ContractEntity[]> {
    const items = await this.prisma.contract.findMany({
      where: { dormitoryId, roomId, status: 'active', deletedAt: null },
    });
    return items.map((c: any) => this.mapContractToEntity(c));
  }

  public async findOverlappingContractsForRoom(dormitoryId: string, roomId: string, startDate: Date, endDate: Date, excludeContractId?: string): Promise<ContractEntity[]> {
    const nStart = new Date(startDate);
    const nEnd = new Date(endDate);
    const where: any = {
      dormitoryId,
      roomId,
      deletedAt: null,
      status: { in: BLOCKING_CONTRACT_STATUSES },
      startDate: { lt: nEnd },
      endDate: { gt: nStart },
    };
    if (excludeContractId) where.id = { not: excludeContractId };
    const items = await this.prisma.contract.findMany({ where });
    return items.map((c: any) => this.mapContractToEntity(c));
  }

  public async countActiveByDormitory(dormitoryId: string): Promise<number> {
    return this.prisma.contract.count({ where: { dormitoryId, status: 'active', deletedAt: null } });
  }

  public async countExpiringByDormitory(dormitoryId: string, days: number = 30): Promise<number> {
    const now = new Date();
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.prisma.contract.count({
      where: { dormitoryId, status: 'active', deletedAt: null, endDate: { gte: now, lte: threshold } },
    });
  }

  public async create(dormitoryId: string, data: CreateContractData): Promise<ContractEntity> {
    const contractNumber = data.contractNumber || `CTR${Date.now().toString().slice(-6)}`;
    const c = await this.prisma.contract.create({
      data: {
        id: data.id,
        dormitoryId,
        contractNumber,
        roomId: data.roomId,
        tenantId: data.tenantId,
        status: data.status || 'draft',
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        durationMonths: data.durationMonths || 1,
        rentBillingType: data.rentBillingType || 'monthly',
        rentAmount: data.rentAmount,
        depositAmount: data.depositAmount || '0.00',
        advancePaymentAmount: data.advancePaymentAmount || '0.00',
        terms: data.terms || null,
      },
    });
    return this.mapContractToEntity(c);
  }

  public async update(id: string, dormitoryId: string, data: Partial<ContractEntity>, expectedVersion?: number): Promise<ContractEntity | null> {
    const existing = await this.findById(id, dormitoryId);
    if (!existing) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const c = await this.prisma.contract.update({
      where: { id },
      data: {
        status: data.status,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        rentAmount: data.rentAmount,
        version: { increment: 1 },
      },
    });
    return this.mapContractToEntity(c);
  }

  public async deleteDraft(id: string, dormitoryId: string): Promise<boolean> {
    const existing = await this.findById(id, dormitoryId);
    if (!existing || existing.status !== 'draft') return false;
    await this.prisma.contract.delete({ where: { id } });
    return true;
  }

  public async addStatusHistory(): Promise<any> { return {} as any; }
  public async findStatusHistories(): Promise<any[]> { return []; }
}
