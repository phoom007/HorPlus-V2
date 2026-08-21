import { PrismaClient, Prisma } from '@prisma/client';

export interface BillEntity {
  id: string;
  dormitoryId: string;
  billingCycleId: string;
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  roomId: string;
  tenantId?: string | null;
  billNumber: string;
  billKind?: string; // MONTHLY_UTILITY | RENT | DEPOSIT | LEGACY_COMBINED
  paymentGroupId?: string | null;
  status: string; // draft, unpaid, partially_paid, paid, overdue, cancelled
  billingDate: Date;
  dueDate: Date;
  subtotal: string;
  discountAmount: string;
  fineAmount: string;
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  currency: string;
  rateSnapshotId?: string | null;
  generatedByUserId?: string | null;
  generatedAt: Date;
  cancelledAt?: Date | null;
  cancelledByUserId?: string | null;
  cancellationReason?: string | null;
  version: number;
  items?: BillItemEntity[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BillItemEntity {
  id: string;
  dormitoryId: string;
  billId: string;
  type: string; // rent, water, electricity, common_fee, internet, fine, discount, other
  code?: string | null;
  description: string;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  amount: string;
  sourceType?: string | null;
  sourceId?: string | null;
  displayOrder: number;
  metadata?: any;
  createdAt: Date;
}

export interface BillStatusHistoryEntity {
  id: string;
  dormitoryId: string;
  billId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  changedByUserId?: string | null;
  effectiveAt: Date;
  metadata?: any;
  createdAt: Date;
}

export interface CreateBillData {
  id?: string;
  billingCycleId: string;
  contractId?: string | null;
  provisionalRentalTermId?: string | null;
  roomId: string;
  tenantId?: string | null;
  billNumber?: string;
  billKind?: string;
  paymentGroupId?: string | null;
  status?: string;
  billingDate: Date;
  dueDate: Date;
  subtotal: string;
  discountAmount?: string;
  fineAmount?: string;
  totalAmount: string;
  paidAmount?: string;
  outstandingAmount: string;
  currency?: string;
  rateSnapshotId?: string | null;
  generatedByUserId?: string | null;
  generatedAt?: Date;
}

export interface CreateBillItemData {
  id?: string;
  type: string;
  code?: string | null;
  description: string;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  amount: string;
  sourceType?: string | null;
  sourceId?: string | null;
  displayOrder?: number;
  metadata?: any;
}

export interface BillFilterQuery {
  billingCycleId?: string;
  roomId?: string;
  tenantId?: string;
  contractId?: string;
  billKind?: string;
  status?: string;
  buildingId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface IBillRepository {
  findById(id: string, dormitoryId?: string): Promise<BillEntity | null>;
  findByNumber(dormitoryId: string, billNumber: string, tx?: any): Promise<BillEntity | null>;
  findByCycleAndContract(dormitoryId: string, billingCycleId: string, contractId: string, billKind?: string, tx?: any): Promise<BillEntity | null>;
  findByCycleAndRoom(dormitoryId: string, billingCycleId: string, roomId: string, billKind?: string, tx?: any): Promise<BillEntity | null>;
  findAll(dormitoryId: string, filter?: BillFilterQuery, tx?: any): Promise<{ items: BillEntity[]; total: number }>;
  create(dormitoryId: string, data: CreateBillData, items: CreateBillItemData[], tx?: any): Promise<{ bill: BillEntity; items: BillItemEntity[] }>;
  update(id: string, dormitoryId: string, data: Partial<BillEntity>, expectedVersion?: number, tx?: any): Promise<BillEntity | null>;
  getBillItems(billId: string, dormitoryId?: string, tx?: any): Promise<BillItemEntity[]>;
  addStatusHistory(dormitoryId: string, billId: string, fromStatus: string | null, toStatus: string, reason?: string, changedByUserId?: string, metadata?: any): Promise<BillStatusHistoryEntity>;
  findStatusHistories(billId: string, dormitoryId?: string): Promise<BillStatusHistoryEntity[]>;
  getSummary(dormitoryId: string, billingCycleId?: string): Promise<{ totalBills: number; totalAmount: string; paidAmount: string; outstandingAmount: string; statusCounts: Record<string, number> }>;
  withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  executeRawLock(roomId: string, tx: any): Promise<void>;
}

export class InMemoryBillRepository implements IBillRepository {
  private bills: Map<string, BillEntity> = new Map();
  private items: Map<string, BillItemEntity[]> = new Map();
  private histories: Map<string, BillStatusHistoryEntity[]> = new Map();

  public async findById(id: string, dormitoryId?: string): Promise<BillEntity | null> {
    const bill = this.bills.get(id);
    if (!bill) return null;
    if (dormitoryId && bill.dormitoryId !== dormitoryId) return null;
    return bill;
  }

  public async findByNumber(dormitoryId: string, billNumber: string): Promise<BillEntity | null> {
    for (const b of this.bills.values()) {
      if (b.dormitoryId === dormitoryId && b.billNumber === billNumber) {
        return b;
      }
    }
    return null;
  }

  public async findByCycleAndContract(
    dormitoryId: string,
    billingCycleId: string,
    contractId: string,
    billKindOrTx?: string | any,
    tx?: any
  ): Promise<BillEntity | null> {
    const billKind = typeof billKindOrTx === 'string' ? billKindOrTx : undefined;
    const list = Array.from(this.bills.values());
    return list.find((b) => b.dormitoryId === dormitoryId && b.billingCycleId === billingCycleId && b.contractId === contractId && (!billKind || (b.billKind || 'MONTHLY_UTILITY') === billKind) && b.status !== 'cancelled' && b.status !== 'void') || null;
  }

  public async findByCycleAndRoom(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    billKindOrTx?: string | any,
    tx?: any
  ): Promise<BillEntity | null> {
    const billKind = typeof billKindOrTx === 'string' ? billKindOrTx : undefined;
    const list = Array.from(this.bills.values());
    return list.find((b) => b.dormitoryId === dormitoryId && b.billingCycleId === billingCycleId && b.roomId === roomId && (!billKind || (b.billKind || 'MONTHLY_UTILITY') === billKind) && b.status !== 'cancelled' && b.status !== 'void') || null;
  }

  public async findAll(dormitoryId: string, filter: BillFilterQuery = {}): Promise<{ items: BillEntity[]; total: number }> {
    let list = Array.from(this.bills.values()).filter((b) => b.dormitoryId === dormitoryId);

    if (filter.billingCycleId) {
      list = list.filter((b) => b.billingCycleId === filter.billingCycleId);
    }
    if (filter.roomId) {
      list = list.filter((b) => b.roomId === filter.roomId);
    }
    if (filter.tenantId) {
      list = list.filter((b) => b.tenantId === filter.tenantId);
    }
    if (filter.contractId) {
      list = list.filter((b) => b.contractId === filter.contractId);
    }
    if (filter.status) {
      list = list.filter((b) => b.status === filter.status);
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      list = list.filter((b) => b.billNumber.toLowerCase().includes(q));
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

  public async create(
    dormitoryId: string,
    data: CreateBillData,
    itemDatas: CreateBillItemData[]
  ): Promise<{ bill: BillEntity; items: BillItemEntity[] }> {
    const now = new Date();
    const id = data.id || `bill-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const billNumber = data.billNumber || `INV${Date.now().toString().slice(-8)}`;

    const bill: BillEntity = {
      id,
      dormitoryId,
      billingCycleId: data.billingCycleId,
      contractId: data.contractId,
      provisionalRentalTermId: data.provisionalRentalTermId || null,
      roomId: data.roomId,
      tenantId: data.tenantId,
      billNumber,
      status: data.status || 'draft',
      billingDate: data.billingDate,
      dueDate: data.dueDate,
      subtotal: data.subtotal,
      discountAmount: data.discountAmount || '0.00',
      fineAmount: data.fineAmount || '0.00',
      totalAmount: data.totalAmount,
      paidAmount: data.paidAmount || '0.00',
      outstandingAmount: data.outstandingAmount,
      currency: data.currency || 'THB',
      rateSnapshotId: data.rateSnapshotId || null,
      generatedByUserId: data.generatedByUserId || null,
      generatedAt: data.generatedAt || now,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const createdItems: BillItemEntity[] = itemDatas.map((item, index) => ({
      id: item.id || `item-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 5)}`,
      dormitoryId,
      billId: id,
      type: item.type,
      code: item.code || null,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit || null,
      unitPrice: item.unitPrice,
      amount: item.amount,
      sourceType: item.sourceType || null,
      sourceId: item.sourceId || null,
      displayOrder: item.displayOrder ?? index,
      metadata: item.metadata || null,
      createdAt: now,
    }));

    this.bills.set(id, bill);
    this.items.set(id, createdItems);

    await this.addStatusHistory(dormitoryId, id, null, bill.status, 'Bill generated', data.generatedByUserId || undefined);

    return { bill, items: createdItems };
  }

  public async update(
    id: string,
    dormitoryId: string,
    data: Partial<BillEntity>,
    expectedVersion?: number
  ): Promise<BillEntity | null> {
    const bill = await this.findById(id, dormitoryId);
    if (!bill) return null;

    if (expectedVersion !== undefined && bill.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updated: BillEntity = {
      ...bill,
      ...data,
      version: bill.version + 1,
      updatedAt: new Date(),
    };
    this.bills.set(id, updated);
    return updated;
  }

  public async updateStatus(
    id: string,
    dormitoryId: string,
    status: string,
    expectedVersion?: number
  ): Promise<BillEntity | null> {
    return this.update(id, dormitoryId, { status }, expectedVersion);
  }

  public async getBillItems(billId: string, dormitoryId?: string, tx?: any): Promise<BillItemEntity[]> {
    const list = this.items.get(billId) || [];
    if (dormitoryId) {
      return list.filter((i) => i.dormitoryId === dormitoryId);
    }
    return list;
  }

  public async addStatusHistory(
    dormitoryId: string,
    billId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string,
    changedByUserId?: string,
    metadata?: any
  ): Promise<BillStatusHistoryEntity> {
    const now = new Date();
    const id = `bsh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const history: BillStatusHistoryEntity = {
      id,
      dormitoryId,
      billId,
      fromStatus: fromStatus || null,
      toStatus,
      reason: reason || null,
      changedByUserId: changedByUserId || null,
      effectiveAt: now,
      metadata: metadata || null,
      createdAt: now,
    };
    const current = this.histories.get(billId) || [];
    current.push(history);
    this.histories.set(billId, current);
    return history;
  }

  public async findStatusHistories(billId: string, dormitoryId?: string): Promise<BillStatusHistoryEntity[]> {
    const list = this.histories.get(billId) || [];
    if (dormitoryId) {
      return list.filter((h) => h.dormitoryId === dormitoryId);
    }
    return list;
  }

  public async getSummary(
    dormitoryId: string,
    billingCycleId?: string
  ): Promise<{
    totalBills: number;
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    statusCounts: Record<string, number>;
  }> {
    let list = Array.from(this.bills.values()).filter((b) => b.dormitoryId === dormitoryId);
    if (billingCycleId) {
      list = list.filter((b) => b.billingCycleId === billingCycleId);
    }

    let totalAmount = 0;
    let paidAmount = 0;
    let outstandingAmount = 0;
    const statusCounts: Record<string, number> = {};

    for (const b of list) {
      statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
      if (b.status !== 'cancelled') {
        totalAmount += Number(b.totalAmount);
        paidAmount += Number(b.paidAmount);
        outstandingAmount += Number(b.outstandingAmount);
      }
    }

    return {
      totalBills: list.length,
      totalAmount: totalAmount.toFixed(2),
      paidAmount: paidAmount.toFixed(2),
      outstandingAmount: outstandingAmount.toFixed(2),
      statusCounts,
    };
  }

  public async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn(null);
  }

  public async executeRawLock(roomId: string, tx: any): Promise<void> {
    return;
  }
}

export class PrismaBillRepository implements IBillRepository {
  constructor(private prisma: PrismaClient) {}

  private getClient(tx?: any): PrismaClient {
    return tx || this.prisma;
  }

  private formatDecimal(val: any): string {
    if (val === undefined || val === null) return '0.00';
    if (val instanceof Prisma.Decimal) return val.toFixed(2);
    if (typeof val === 'string') {
      try {
        return new Prisma.Decimal(val).toFixed(2);
      } catch {
        return val;
      }
    }
    if (typeof val === 'number') {
      return new Prisma.Decimal(val.toString()).toFixed(2);
    }
    if (typeof val?.toFixed === 'function') {
      return val.toFixed(2);
    }
    return new Prisma.Decimal(String(val)).toFixed(2);
  }

  private mapBillToEntity(model: any): BillEntity {
    return {
      id: model.id,
      dormitoryId: model.dormitoryId,
      billingCycleId: model.billingCycleId,
      contractId: model.contractId,
      provisionalRentalTermId: model.provisionalRentalTermId || null,
      roomId: model.roomId,
      tenantId: model.tenantId,
      billNumber: model.billNumber,
      billKind: model.billKind || 'MONTHLY_UTILITY',
      paymentGroupId: model.paymentGroupId || null,
      status: model.status,
      billingDate: model.billingDate,
      dueDate: model.dueDate,
      subtotal: this.formatDecimal(model.subtotal),
      discountAmount: this.formatDecimal(model.discountAmount),
      fineAmount: this.formatDecimal(model.fineAmount),
      totalAmount: this.formatDecimal(model.totalAmount),
      paidAmount: this.formatDecimal(model.paidAmount),
      outstandingAmount: this.formatDecimal(model.outstandingAmount),
      currency: model.currency || 'THB',
      rateSnapshotId: model.rateSnapshotId || null,
      generatedByUserId: model.generatedByUserId || null,
      generatedAt: model.generatedAt,
      cancelledAt: model.cancelledAt || null,
      cancelledByUserId: model.cancelledByUserId || null,
      cancellationReason: model.cancellationReason || null,
      version: model.version,
      items: Array.isArray(model.items) ? model.items.map((i: any) => this.mapItemToEntity(i)) : undefined,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  private mapItemToEntity(model: any): BillItemEntity {
    return {
      id: model.id,
      dormitoryId: model.dormitoryId,
      billId: model.billId,
      type: model.type,
      code: model.code || null,
      description: model.description,
      quantity: this.formatDecimal(model.quantity),
      unit: model.unit || null,
      unitPrice: this.formatDecimal(model.unitPrice),
      amount: this.formatDecimal(model.amount),
      sourceType: model.sourceType || null,
      sourceId: model.sourceId || null,
      displayOrder: model.displayOrder,
      metadata: model.metadata || null,
      createdAt: model.createdAt,
    };
  }

  public async create(
    dormitoryId: string,
    data: CreateBillData,
    items: CreateBillItemData[],
    tx?: any
  ): Promise<{ bill: BillEntity; items: BillItemEntity[] }> {
    const client = this.getClient(tx);
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const createdBill = await client.bill.create({
      data: {
        id: data.id,
        dormitoryId,
        billingCycleId: data.billingCycleId,
        contractId: isUuid(data.contractId) ? data.contractId : null,
        provisionalRentalTermId: isUuid(data.provisionalRentalTermId) ? data.provisionalRentalTermId : null,
        roomId: data.roomId,
        tenantId: isUuid(data.tenantId) ? data.tenantId : null,
        billNumber: data.billNumber || `BILL-${Date.now()}`,
        billKind: data.billKind || 'MONTHLY_UTILITY',
        paymentGroupId: isUuid(data.paymentGroupId) ? data.paymentGroupId : null,
        status: data.status || 'unpaid',
        billingDate: new Date(data.billingDate),
        dueDate: new Date(data.dueDate),
        subtotal: data.subtotal,
        discountAmount: data.discountAmount || '0.00',
        fineAmount: data.fineAmount || '0.00',
        totalAmount: data.totalAmount,
        paidAmount: data.paidAmount || '0.00',
        outstandingAmount: data.outstandingAmount || data.totalAmount,
        currency: data.currency || 'THB',
        rateSnapshotId: isUuid(data.rateSnapshotId) ? data.rateSnapshotId : null,
        generatedByUserId: isUuid(data.generatedByUserId) ? data.generatedByUserId : null,
        generatedAt: data.generatedAt || undefined,
      },
    });

    const createdItems: BillItemEntity[] = [];
    for (const i of items) {
      const item = await client.billItem.create({
        data: {
          id: i.id,
          dormitoryId,
          billId: createdBill.id,
          type: i.type,
          code: i.code || null,
          description: i.description,
          quantity: i.quantity || '1.00',
          unit: i.unit || null,
          unitPrice: i.unitPrice,
          amount: i.amount,
          sourceType: i.sourceType || null,
          sourceId: i.sourceId || null,
          displayOrder: i.displayOrder || 0,
          metadata: i.metadata || null,
        },
      });
      createdItems.push(this.mapItemToEntity(item));
    }

    return { bill: this.mapBillToEntity(createdBill), items: createdItems };
  }

  public async findById(id: string, dormitoryId: string): Promise<BillEntity | null> {
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid(id)) return null;
    const bill = await this.prisma.bill.findFirst({
      where: { id, dormitoryId },
    });
    return bill ? this.mapBillToEntity(bill) : null;
  }

  public async findByNumber(dormitoryId: string, billNumber: string): Promise<BillEntity | null> {
    const bill = await this.prisma.bill.findFirst({
      where: { dormitoryId, billNumber },
    });
    return bill ? this.mapBillToEntity(bill) : null;
  }

  public async findByCycleAndContract(
    dormitoryId: string,
    billingCycleId: string,
    contractId: string,
    billKindOrTx?: string | any,
    tx?: any
  ): Promise<BillEntity | null> {
    let billKind: string | undefined = undefined;
    let actualTx: any = tx;
    if (typeof billKindOrTx === 'string') {
      billKind = billKindOrTx;
    } else if (billKindOrTx && typeof billKindOrTx === 'object') {
      actualTx = billKindOrTx;
    }

    const client = this.getClient(actualTx);
    const where: any = { 
      dormitoryId, 
      billingCycleId, 
      contractId,
      status: { notIn: ['cancelled', 'void'] }
    };
    if (billKind) where.billKind = billKind;
    const bill = await client.bill.findFirst({ where });
    return bill ? this.mapBillToEntity(bill) : null;
  }

  public async findByCycleAndRoom(
    dormitoryId: string,
    billingCycleId: string,
    roomId: string,
    billKindOrTx?: string | any,
    tx?: any
  ): Promise<BillEntity | null> {
    let billKind: string | undefined = undefined;
    let actualTx: any = tx;
    if (typeof billKindOrTx === 'string') {
      billKind = billKindOrTx;
    } else if (billKindOrTx && typeof billKindOrTx === 'object') {
      actualTx = billKindOrTx;
    }

    const client = this.getClient(actualTx);
    const where: any = { 
      dormitoryId, 
      billingCycleId, 
      roomId,
      status: { notIn: ['cancelled', 'void'] }
    };
    if (billKind) where.billKind = billKind;
    const bill = await client.bill.findFirst({ where });
    return bill ? this.mapBillToEntity(bill) : null;
  }

  public async findAll(
    dormitoryId: string,
    filter: BillFilterQuery = {},
    tx?: any
  ): Promise<{ items: BillEntity[]; total: number }> {
    const client = this.getClient(tx);
    const where: any = { dormitoryId };
    if (filter.billingCycleId) where.billingCycleId = filter.billingCycleId;
    if (filter.contractId) where.contractId = filter.contractId;
    if (filter.roomId) where.roomId = filter.roomId;
    if (filter.tenantId) where.tenantId = filter.tenantId;
    if (filter.status) where.status = filter.status;

    const page = filter.page || 1;
    const pageSize = filter.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const [bills, total] = await Promise.all([
      client.bill.findMany({
        where,
        include: { items: true },
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      client.bill.count({ where }),
    ]);

    return { items: bills.map((b: any) => this.mapBillToEntity(b)), total };
  }

  public async update(
    id: string,
    dormitoryId: string,
    data: Partial<BillEntity>,
    expectedVersion?: number,
    tx?: any
  ): Promise<BillEntity | null> {
    const client = this.getClient(tx);
    const existing = await this.findById(id, dormitoryId);
    if (!existing) return null;
    if (expectedVersion !== undefined && existing.version !== expectedVersion) {
      const err = new Error('RESOURCE_VERSION_CONFLICT');
      (err as any).code = 'RESOURCE_VERSION_CONFLICT';
      throw err;
    }

    const updateData: any = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.fineAmount !== undefined) updateData.fineAmount = data.fineAmount;
    if (data.discountAmount !== undefined) updateData.discountAmount = data.discountAmount;
    if (data.totalAmount !== undefined) updateData.totalAmount = data.totalAmount;
    if (data.paidAmount !== undefined) updateData.paidAmount = data.paidAmount;
    if (data.outstandingAmount !== undefined) updateData.outstandingAmount = data.outstandingAmount;
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (data.cancelledAt !== undefined) updateData.cancelledAt = data.cancelledAt;
    if (data.cancelledByUserId !== undefined) updateData.cancelledByUserId = isUuid(data.cancelledByUserId) ? data.cancelledByUserId : null;
    if (data.cancellationReason !== undefined) updateData.cancellationReason = data.cancellationReason;

    const updated = await client.bill.update({
      where: { id },
      data: { ...updateData, version: { increment: 1 } },
    });

    return this.mapBillToEntity(updated);
  }

  public async getBillItems(billId: string, dormitoryId: string, tx?: any): Promise<BillItemEntity[]> {
    const client = tx || this.prisma;
    const items = await client.billItem.findMany({
      where: { billId, dormitoryId },
      orderBy: { displayOrder: 'asc' },
    });
    return items.map((i: any) => this.mapItemToEntity(i));
  }

  public async addStatusHistory(
    dormitoryId: string,
    billId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string,
    changedByUserId?: string,
    metadata?: any
  ): Promise<BillStatusHistoryEntity> {
    const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const history = await this.prisma.billStatusHistory.create({
      data: {
        dormitoryId,
        billId,
        fromStatus: fromStatus || null,
        toStatus,
        reason: reason || null,
        changedByUserId: isUuid(changedByUserId) ? changedByUserId : null,
        metadata: metadata || null,
      },
    });

    return {
      id: history.id,
      dormitoryId: history.dormitoryId,
      billId: history.billId,
      fromStatus: history.fromStatus || null,
      toStatus: history.toStatus,
      reason: history.reason || null,
      changedByUserId: history.changedByUserId || null,
      effectiveAt: history.effectiveAt,
      metadata: history.metadata,
      createdAt: history.createdAt,
    };
  }

  public async findStatusHistories(billId: string, dormitoryId?: string): Promise<BillStatusHistoryEntity[]> {
    const where: any = { billId };
    if (dormitoryId) where.dormitoryId = dormitoryId;
    const histories = await this.prisma.billStatusHistory.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });
    return histories.map((h) => ({
      id: h.id,
      dormitoryId: h.dormitoryId,
      billId: h.billId,
      fromStatus: h.fromStatus || null,
      toStatus: h.toStatus,
      reason: h.reason || null,
      changedByUserId: h.changedByUserId || null,
      effectiveAt: h.effectiveAt,
      metadata: h.metadata,
      createdAt: h.createdAt,
    }));
  }

  public async getSummary(
    dormitoryId: string,
    billingCycleId?: string
  ): Promise<{
    totalBills: number;
    totalAmount: string;
    paidAmount: string;
    outstandingAmount: string;
    statusCounts: Record<string, number>;
  }> {
    const where: any = { dormitoryId };
    if (billingCycleId) where.billingCycleId = billingCycleId;

    const bills = await this.prisma.bill.findMany({ where });

    let totalAmount = new Prisma.Decimal('0.00');
    let paidAmount = new Prisma.Decimal('0.00');
    let outstandingAmount = new Prisma.Decimal('0.00');
    const statusCounts: Record<string, number> = {};

    for (const b of bills) {
      statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
      if (b.status !== 'cancelled') {
        totalAmount = totalAmount.add(b.totalAmount);
        paidAmount = paidAmount.add(b.paidAmount);
        outstandingAmount = outstandingAmount.add(b.outstandingAmount);
      }
    }

    return {
      totalBills: bills.length,
      totalAmount: totalAmount.toFixed(2),
      paidAmount: paidAmount.toFixed(2),
      outstandingAmount: outstandingAmount.toFixed(2),
      statusCounts,
    };
  }

  public async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { timeout: 30000 });
  }

  public async executeRawLock(roomId: string, tx: any): Promise<void> {
    if (tx && tx.$queryRawUnsafe) {
       await tx.$queryRawUnsafe(`SELECT 1 FROM "rooms" WHERE id = $1::uuid FOR UPDATE`, roomId);
    }
  }
}
