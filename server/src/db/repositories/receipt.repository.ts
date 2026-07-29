import { v4 as uuidv4 } from 'uuid';

export interface ReceiptEntity {
  id: string;
  dormitoryId: string;
  paymentId: string;
  billId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
  receiptNumber: string;
  status: string; // issued, voided
  issuedAt: Date;
  paidAt: Date;
  paymentMethod: string;
  subtotal: string;
  discountAmount: string;
  fineAmount: string;
  totalAmount: string;
  currency: string;
  receivedByUserId?: string | null;
  dormitoryNameSnapshot: string;
  dormitoryAddressSnapshot?: string | null;
  dormitoryPhoneSnapshot?: string | null;
  tenantNameSnapshot: string;
  roomNumberSnapshot: string;
  billNumberSnapshot: string;
  note?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  voidedAt?: Date | null;
  voidedByUserId?: string | null;
  voidReason?: string | null;
}

export interface ReceiptItemEntity {
  id: string;
  dormitoryId: string;
  receiptId: string;
  billItemId?: string | null;
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  displayOrder: number;
  createdAt: Date;
}

export interface CreateReceiptData {
  paymentId: string;
  billId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
  receiptNumber?: string;
  status?: string;
  issuedAt?: Date;
  paidAt: Date;
  paymentMethod: string;
  subtotal: string;
  discountAmount?: string;
  fineAmount?: string;
  totalAmount: string;
  currency?: string;
  receivedByUserId?: string | null;
  dormitoryNameSnapshot: string;
  dormitoryAddressSnapshot?: string | null;
  dormitoryPhoneSnapshot?: string | null;
  tenantNameSnapshot: string;
  roomNumberSnapshot: string;
  billNumberSnapshot: string;
  note?: string | null;
}

export interface CreateReceiptItemData {
  billItemId?: string | null;
  type: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  displayOrder?: number;
}

export interface ReceiptFilterQuery {
  billingCycleId?: string;
  paymentMethod?: string;
  buildingId?: string;
  roomId?: string;
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export class InMemoryReceiptRepository {
  private receipts: ReceiptEntity[] = [];
  private items: ReceiptItemEntity[] = [];

  public async create(
    dormitoryId: string,
    receiptData: CreateReceiptData,
    itemsData: CreateReceiptItemData[]
  ): Promise<ReceiptEntity> {
    const existing = await this.findByPaymentId(dormitoryId, receiptData.paymentId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const receiptNumber =
      receiptData.receiptNumber ||
      `RCP-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(this.receipts.length + 1).padStart(6, '0')}`;

    const receipt: ReceiptEntity = {
      id: uuidv4(),
      dormitoryId,
      paymentId: receiptData.paymentId,
      billId: receiptData.billId,
      contractId: receiptData.contractId,
      roomId: receiptData.roomId,
      tenantId: receiptData.tenantId,
      receiptNumber,
      status: receiptData.status || 'issued',
      issuedAt: receiptData.issuedAt || now,
      paidAt: receiptData.paidAt,
      paymentMethod: receiptData.paymentMethod,
      subtotal: receiptData.subtotal,
      discountAmount: receiptData.discountAmount || '0.00',
      fineAmount: receiptData.fineAmount || '0.00',
      totalAmount: receiptData.totalAmount,
      currency: receiptData.currency || 'THB',
      receivedByUserId: receiptData.receivedByUserId || null,
      dormitoryNameSnapshot: receiptData.dormitoryNameSnapshot,
      dormitoryAddressSnapshot: receiptData.dormitoryAddressSnapshot || null,
      dormitoryPhoneSnapshot: receiptData.dormitoryPhoneSnapshot || null,
      tenantNameSnapshot: receiptData.tenantNameSnapshot,
      roomNumberSnapshot: receiptData.roomNumberSnapshot,
      billNumberSnapshot: receiptData.billNumberSnapshot,
      note: receiptData.note || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.receipts.push(receipt);

    for (let idx = 0; idx < itemsData.length; idx++) {
      const item = itemsData[idx];
      const receiptItem: ReceiptItemEntity = {
        id: uuidv4(),
        dormitoryId,
        receiptId: receipt.id,
        billItemId: item.billItemId || null,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        displayOrder: item.displayOrder !== undefined ? item.displayOrder : idx,
        createdAt: now,
      };
      this.items.push(receiptItem);
    }

    return receipt;
  }

  public async findById(dormitoryId: string, id: string): Promise<ReceiptEntity | null> {
    return this.receipts.find((r) => r.dormitoryId === dormitoryId && r.id === id) || null;
  }

  public async findByPaymentId(dormitoryId: string, paymentId: string): Promise<ReceiptEntity | null> {
    return this.receipts.find((r) => r.dormitoryId === dormitoryId && r.paymentId === paymentId) || null;
  }

  public async findByBillId(dormitoryId: string, billId: string): Promise<ReceiptEntity | null> {
    return this.receipts.find((r) => r.dormitoryId === dormitoryId && r.billId === billId) || null;
  }

  public async findByTenantId(dormitoryId: string, tenantId: string): Promise<ReceiptEntity[]> {
    return this.receipts.filter((r) => r.dormitoryId === dormitoryId && r.tenantId === tenantId);
  }

  public async findAll(dormitoryId: string, filters: ReceiptFilterQuery = {}): Promise<{ items: ReceiptEntity[]; total: number }> {
    let result = this.receipts.filter((r) => r.dormitoryId === dormitoryId);

    if (filters.paymentMethod) {
      result = result.filter((r) => r.paymentMethod === filters.paymentMethod);
    }
    if (filters.roomId) {
      result = result.filter((r) => r.roomId === filters.roomId);
    }
    if (filters.tenantId) {
      result = result.filter((r) => r.tenantId === filters.tenantId);
    }
    if (filters.search) {
      const query = filters.search.toLowerCase();
      result = result.filter(
        (r) =>
          r.receiptNumber.toLowerCase().includes(query) ||
          r.tenantNameSnapshot.toLowerCase().includes(query) ||
          r.roomNumberSnapshot.toLowerCase().includes(query) ||
          r.billNumberSnapshot.toLowerCase().includes(query)
      );
    }

    const total = result.length;
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const startIndex = (page - 1) * pageSize;
    const paginated = result.slice(startIndex, startIndex + pageSize);

    return { items: paginated, total };
  }

  public async getItemsByReceiptId(dormitoryId: string, receiptId: string): Promise<ReceiptItemEntity[]> {
    return this.items.filter((i) => i.dormitoryId === dormitoryId && i.receiptId === receiptId);
  }
}
