export interface BillEntity {
  id: string;
  dormitoryId: string;
  billingCycleId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
  billNumber: string;
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
  contractId: string;
  roomId: string;
  tenantId: string;
  billNumber?: string;
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
  findByNumber(dormitoryId: string, billNumber: string): Promise<BillEntity | null>;
  findByCycleAndContract(dormitoryId: string, billingCycleId: string, contractId: string): Promise<BillEntity | null>;
  findAll(dormitoryId: string, filter?: BillFilterQuery): Promise<{ items: BillEntity[]; total: number }>;
  create(dormitoryId: string, data: CreateBillData, items: CreateBillItemData[]): Promise<{ bill: BillEntity; items: BillItemEntity[] }>;
  update(id: string, dormitoryId: string, data: Partial<BillEntity>, expectedVersion?: number): Promise<BillEntity | null>;
  getBillItems(billId: string, dormitoryId?: string): Promise<BillItemEntity[]>;
  addStatusHistory(dormitoryId: string, billId: string, fromStatus: string | null, toStatus: string, reason?: string, changedByUserId?: string, metadata?: any): Promise<BillStatusHistoryEntity>;
  findStatusHistories(billId: string, dormitoryId?: string): Promise<BillStatusHistoryEntity[]>;
  getSummary(dormitoryId: string, billingCycleId?: string): Promise<{ totalBills: number; totalAmount: string; paidAmount: string; outstandingAmount: string; statusCounts: Record<string, number> }>;
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
    contractId: string
  ): Promise<BillEntity | null> {
    for (const b of this.bills.values()) {
      if (b.dormitoryId === dormitoryId && b.billingCycleId === billingCycleId && b.contractId === contractId && b.status !== 'cancelled') {
        return b;
      }
    }
    return null;
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
      generatedAt: now,
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

    await this.addStatusHistory(dormitoryId, id, null, bill.status, 'Bill generated', data.generatedByUserId);

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

  public async getBillItems(billId: string, dormitoryId?: string): Promise<BillItemEntity[]> {
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
}
