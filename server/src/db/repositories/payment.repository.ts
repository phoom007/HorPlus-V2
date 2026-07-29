import { v4 as uuidv4 } from 'uuid';

export interface PaymentEntity {
  id: string;
  dormitoryId: string;
  billId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
  paymentNumber: string;
  method: string; // cash, bank_transfer, promptpay, other
  channel: string; // owner_manual, finance_manual, tenant_portal
  status: string; // draft, submitted, checking, approved, rejected, cancelled
  amount: string;
  currency: string;
  paidAt: Date;
  submittedAt: Date;
  submittedByUserId?: string | null;
  submittedByTenantId?: string | null;
  receivedByUserId?: string | null;
  approvedAt?: Date | null;
  approvedByUserId?: string | null;
  rejectedAt?: Date | null;
  rejectedByUserId?: string | null;
  rejectReason?: string | null;
  cancelledAt?: Date | null;
  cancelledByUserId?: string | null;
  cancellationReason?: string | null;
  transactionReference?: string | null;
  supersedesPaymentId?: string | null;
  note?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentEvidenceEntity {
  id: string;
  dormitoryId: string;
  paymentId: string;
  type: string; // slip_image, bank_statement, cash_note, other
  storageProvider: string; // in_memory, gcs
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  transactionReference?: string | null;
  qrPayloadHash?: string | null;
  uploadedAt: Date;
  uploadedByUserId?: string | null;
  uploadedByTenantId?: string | null;
  status: string; // pending, available, rejected, quarantined, deleted
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface PaymentReviewEntity {
  id: string;
  dormitoryId: string;
  paymentId: string;
  reviewerUserId?: string | null;
  decision: string; // approved, rejected, manual_review
  reviewSource: string; // manual, mock, slipok
  provider?: string | null;
  providerReference?: string | null;
  verifiedAmount?: string | null;
  verifiedPaidAt?: Date | null;
  verifiedReceiver?: string | null;
  reason?: string | null;
  metadata?: any;
  createdAt: Date;
}

export interface PaymentStatusHistoryEntity {
  id: string;
  dormitoryId: string;
  paymentId: string;
  fromStatus?: string | null;
  toStatus: string;
  reason?: string | null;
  changedByUserId?: string | null;
  effectiveAt: Date;
  metadata?: any;
  createdAt: Date;
}

export interface CreatePaymentData {
  billId: string;
  contractId: string;
  roomId: string;
  tenantId: string;
  paymentNumber?: string;
  method: string;
  channel?: string;
  status?: string;
  amount: string;
  currency?: string;
  paidAt?: Date;
  submittedAt?: Date;
  submittedByUserId?: string | null;
  submittedByTenantId?: string | null;
  receivedByUserId?: string | null;
  transactionReference?: string | null;
  supersedesPaymentId?: string | null;
  note?: string | null;
}

export interface CreateEvidenceData {
  paymentId: string;
  type?: string;
  storageProvider?: string;
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  transactionReference?: string | null;
  qrPayloadHash?: string | null;
  uploadedByUserId?: string | null;
  uploadedByTenantId?: string | null;
  status?: string;
  metadata?: any;
}

export interface CreateReviewData {
  paymentId: string;
  reviewerUserId?: string | null;
  decision: string;
  reviewSource?: string;
  provider?: string | null;
  providerReference?: string | null;
  verifiedAmount?: string | null;
  verifiedPaidAt?: Date | null;
  verifiedReceiver?: string | null;
  reason?: string | null;
  metadata?: any;
}

export interface PaymentFilterQuery {
  billingCycleId?: string;
  status?: string;
  method?: string;
  channel?: string;
  buildingId?: string;
  roomId?: string;
  tenantId?: string;
  billId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export interface PaymentSummaryResult {
  submittedCount: number;
  checkingCount: number;
  approvedCount: number;
  rejectedCount: number;
  totalApprovedAmount: string;
  cashAmount: string;
  bankTransferAmount: string;
  promptPayAmount: string;
  pendingReviewAmount: string;
  todayApprovedAmount: string;
  currentCycleApprovedAmount: string;
  receiptCount: number;
}

export class InMemoryPaymentRepository {
  private payments: PaymentEntity[] = [];
  private evidences: PaymentEvidenceEntity[] = [];
  private reviews: PaymentReviewEntity[] = [];
  private statusHistories: PaymentStatusHistoryEntity[] = [];

  public async create(dormitoryId: string, data: CreatePaymentData): Promise<PaymentEntity> {
    const now = new Date();
    const paymentNumber = data.paymentNumber || `PAY-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(this.payments.length + 1).padStart(6, '0')}`;
    
    const payment: PaymentEntity = {
      id: uuidv4(),
      dormitoryId,
      billId: data.billId,
      contractId: data.contractId,
      roomId: data.roomId,
      tenantId: data.tenantId,
      paymentNumber,
      method: data.method,
      channel: data.channel || 'owner_manual',
      status: data.status || 'submitted',
      amount: data.amount,
      currency: data.currency || 'THB',
      paidAt: data.paidAt || now,
      submittedAt: data.submittedAt || now,
      submittedByUserId: data.submittedByUserId || null,
      submittedByTenantId: data.submittedByTenantId || null,
      receivedByUserId: data.receivedByUserId || null,
      approvedAt: null,
      approvedByUserId: null,
      rejectedAt: null,
      rejectedByUserId: null,
      rejectReason: null,
      cancelledAt: null,
      cancelledByUserId: null,
      cancellationReason: null,
      transactionReference: data.transactionReference || null,
      supersedesPaymentId: data.supersedesPaymentId || null,
      note: data.note || null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    this.payments.push(payment);
    await this.addStatusHistory(dormitoryId, payment.id, null, payment.status, 'Payment created', data.submittedByUserId || null);
    return payment;
  }

  public async findById(dormitoryId: string, id: string): Promise<PaymentEntity | null> {
    return this.payments.find((p) => p.dormitoryId === dormitoryId && p.id === id) || null;
  }

  public async findByNumber(dormitoryId: string, number: string): Promise<PaymentEntity | null> {
    return this.payments.find((p) => p.dormitoryId === dormitoryId && p.paymentNumber === number) || null;
  }

  public async findByBillId(dormitoryId: string, billId: string): Promise<PaymentEntity[]> {
    return this.payments.filter((p) => p.dormitoryId === dormitoryId && p.billId === billId);
  }

  public async findAll(dormitoryId: string, filters: PaymentFilterQuery = {}): Promise<{ items: PaymentEntity[]; total: number }> {
    let items = this.payments.filter((p) => p.dormitoryId === dormitoryId);

    if (filters.status) {
      items = items.filter((p) => p.status === filters.status);
    }
    if (filters.method) {
      items = items.filter((p) => p.method === filters.method);
    }
    if (filters.channel) {
      items = items.filter((p) => p.channel === filters.channel);
    }
    if (filters.roomId) {
      items = items.filter((p) => p.roomId === filters.roomId);
    }
    if (filters.tenantId) {
      items = items.filter((p) => p.tenantId === filters.tenantId);
    }
    if (filters.billId) {
      items = items.filter((p) => p.billId === filters.billId);
    }
    if (filters.search) {
      const query = filters.search.toLowerCase();
      items = items.filter((p) => p.paymentNumber.toLowerCase().includes(query) || (p.note && p.note.toLowerCase().includes(query)));
    }

    const total = items.length;
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = items.slice(startIndex, startIndex + pageSize);

    return { items: paginatedItems, total };
  }

  public async update(dormitoryId: string, id: string, updates: Partial<PaymentEntity>, expectedVersion?: number): Promise<PaymentEntity> {
    const index = this.payments.findIndex((p) => p.dormitoryId === dormitoryId && p.id === id);
    if (index === -1) {
      throw new Error('RESOURCE_NOT_FOUND: Payment not found');
    }

    const current = this.payments[index];
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new Error('RESOURCE_VERSION_CONFLICT: Payment has been updated by another process');
    }

    const updated: PaymentEntity = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: new Date(),
    };

    this.payments[index] = updated;

    if (updates.status && updates.status !== current.status) {
      await this.addStatusHistory(dormitoryId, id, current.status, updates.status, updates.rejectReason || updates.cancellationReason || null, updates.approvedByUserId || updates.rejectedByUserId || updates.cancelledByUserId || null);
    }

    return updated;
  }

  public async createEvidence(dormitoryId: string, data: CreateEvidenceData): Promise<PaymentEvidenceEntity> {
    const now = new Date();
    const evidence: PaymentEvidenceEntity = {
      id: uuidv4(),
      dormitoryId,
      paymentId: data.paymentId,
      type: data.type || 'slip_image',
      storageProvider: data.storageProvider || 'in_memory',
      objectKey: data.objectKey,
      originalFileName: data.originalFileName,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      sha256: data.sha256,
      transactionReference: data.transactionReference || null,
      qrPayloadHash: data.qrPayloadHash || null,
      uploadedAt: now,
      uploadedByUserId: data.uploadedByUserId || null,
      uploadedByTenantId: data.uploadedByTenantId || null,
      status: data.status || 'available',
      metadata: data.metadata || null,
      createdAt: now,
      updatedAt: now,
    };

    this.evidences.push(evidence);
    return evidence;
  }

  public async findEvidenceById(dormitoryId: string, id: string): Promise<PaymentEvidenceEntity | null> {
    return this.evidences.find((e) => e.dormitoryId === dormitoryId && e.id === id && !e.deletedAt) || null;
  }

  public async findEvidencesByPaymentId(dormitoryId: string, paymentId: string): Promise<PaymentEvidenceEntity[]> {
    return this.evidences.filter((e) => e.dormitoryId === dormitoryId && e.paymentId === paymentId && !e.deletedAt);
  }

  public async findEvidenceBySha256(dormitoryId: string, sha256: string): Promise<PaymentEvidenceEntity | null> {
    return this.evidences.find((e) => e.dormitoryId === dormitoryId && e.sha256 === sha256 && !e.deletedAt) || null;
  }

  public async findEvidenceByTransactionReference(dormitoryId: string, txRef: string): Promise<PaymentEvidenceEntity | null> {
    return this.evidences.find((e) => e.dormitoryId === dormitoryId && e.transactionReference === txRef && !e.deletedAt) || null;
  }

  public async findEvidenceByQrHash(dormitoryId: string, qrHash: string): Promise<PaymentEvidenceEntity | null> {
    return this.evidences.find((e) => e.dormitoryId === dormitoryId && e.qrPayloadHash === qrHash && !e.deletedAt) || null;
  }

  public async createReview(dormitoryId: string, data: CreateReviewData): Promise<PaymentReviewEntity> {
    const review: PaymentReviewEntity = {
      id: uuidv4(),
      dormitoryId,
      paymentId: data.paymentId,
      reviewerUserId: data.reviewerUserId || null,
      decision: data.decision,
      reviewSource: data.reviewSource || 'manual',
      provider: data.provider || null,
      providerReference: data.providerReference || null,
      verifiedAmount: data.verifiedAmount || null,
      verifiedPaidAt: data.verifiedPaidAt || null,
      verifiedReceiver: data.verifiedReceiver || null,
      reason: data.reason || null,
      metadata: data.metadata || null,
      createdAt: new Date(),
    };

    this.reviews.push(review);
    return review;
  }

  public async findReviewsByPaymentId(dormitoryId: string, paymentId: string): Promise<PaymentReviewEntity[]> {
    return this.reviews.filter((r) => r.dormitoryId === dormitoryId && r.paymentId === paymentId);
  }

  public async addStatusHistory(
    dormitoryId: string,
    paymentId: string,
    fromStatus: string | null,
    toStatus: string,
    reason?: string | null,
    userId?: string | null
  ): Promise<PaymentStatusHistoryEntity> {
    const history: PaymentStatusHistoryEntity = {
      id: uuidv4(),
      dormitoryId,
      paymentId,
      fromStatus: fromStatus || null,
      toStatus,
      reason: reason || null,
      changedByUserId: userId || null,
      effectiveAt: new Date(),
      createdAt: new Date(),
    };

    this.statusHistories.push(history);
    return history;
  }

  public async getStatusHistory(dormitoryId: string, paymentId: string): Promise<PaymentStatusHistoryEntity[]> {
    return this.statusHistories.filter((h) => h.dormitoryId === dormitoryId && h.paymentId === paymentId);
  }

  public async getSummary(dormitoryId: string, _cycleId?: string): Promise<PaymentSummaryResult> {
    const items = this.payments.filter((p) => p.dormitoryId === dormitoryId);
    
    let submittedCount = 0;
    let checkingCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let totalApproved = 0;
    let cashAmount = 0;
    let bankTransferAmount = 0;
    let promptPayAmount = 0;
    let pendingReviewAmount = 0;

    for (const p of items) {
      const amt = parseFloat(p.amount) || 0;
      if (p.status === 'submitted') submittedCount++;
      if (p.status === 'checking') {
        checkingCount++;
        pendingReviewAmount += amt;
      }
      if (p.status === 'approved') {
        approvedCount++;
        totalApproved += amt;
        if (p.method === 'cash') cashAmount += amt;
        if (p.method === 'bank_transfer') bankTransferAmount += amt;
        if (p.method === 'promptpay') promptPayAmount += amt;
      }
      if (p.status === 'rejected') rejectedCount++;
    }

    return {
      submittedCount,
      checkingCount,
      approvedCount,
      rejectedCount,
      totalApprovedAmount: totalApproved.toFixed(2),
      cashAmount: cashAmount.toFixed(2),
      bankTransferAmount: bankTransferAmount.toFixed(2),
      promptPayAmount: promptPayAmount.toFixed(2),
      pendingReviewAmount: pendingReviewAmount.toFixed(2),
      todayApprovedAmount: totalApproved.toFixed(2),
      currentCycleApprovedAmount: totalApproved.toFixed(2),
      receiptCount: approvedCount,
    };
  }
}
