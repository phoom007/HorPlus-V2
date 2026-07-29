import { InMemoryPaymentRepository, PaymentEntity, PaymentEvidenceEntity, PaymentReviewEntity } from '../db/repositories/payment.repository.js';
import { InMemoryBillRepository } from '../db/repositories/bill.repository.js';
import { PaymentEvidenceStorage, StoredEvidence } from './storage-provider.service.ts';
import { SlipVerificationProvider, PaymentDuplicateDetectionService } from './slip-verifier.service.js';
import { ReceiptGenerationService } from './receipt.service.js';
import { AuditService } from './audit.service.js';
import { ReceiptEntity, ReceiptItemEntity } from '../db/repositories/receipt.repository.js';

export interface SubmitPaymentInput {
  billId: string;
  method: 'cash' | 'bank_transfer' | 'promptpay' | 'other';
  channel?: 'owner_manual' | 'finance_manual' | 'tenant_portal';
  amount: string;
  paidAt?: Date;
  submittedByUserId?: string | null;
  submittedByTenantId?: string | null;
  receivedByUserId?: string | null;
  evidenceId?: string | null;
  transactionReference?: string | null;
  note?: string | null;
  approveImmediately?: boolean;
}

export interface ApprovePaymentInput {
  paymentId: string;
  actorUserId?: string | null;
  version?: number;
  note?: string | null;
}

export interface RejectPaymentInput {
  paymentId: string;
  actorUserId?: string | null;
  reason: string;
  version?: number;
}

export class PaymentService {
  private paymentRepo: InMemoryPaymentRepository;
  private billRepo: InMemoryBillRepository;
  private storageProvider: PaymentEvidenceStorage;
  private verificationProvider: SlipVerificationProvider;
  private duplicateDetector: PaymentDuplicateDetectionService;
  private receiptService: ReceiptGenerationService;
  private auditService: AuditService;

  constructor(
    paymentRepo: InMemoryPaymentRepository,
    billRepo: InMemoryBillRepository,
    storageProvider: PaymentEvidenceStorage,
    verificationProvider: SlipVerificationProvider,
    receiptService: ReceiptGenerationService,
    auditService: AuditService
  ) {
    this.paymentRepo = paymentRepo;
    this.billRepo = billRepo;
    this.storageProvider = storageProvider;
    this.verificationProvider = verificationProvider;
    this.receiptService = receiptService;
    this.auditService = auditService;
    this.duplicateDetector = new PaymentDuplicateDetectionService(paymentRepo);
  }

  /**
   * Submits a payment (cash or transfer).
   */
  public async submitPayment(
    dormitoryId: string,
    input: SubmitPaymentInput,
    requestId?: string
  ): Promise<{ payment: PaymentEntity; receipt?: ReceiptEntity; evidence?: PaymentEvidenceEntity }> {
    // 1. Validate Bill
    const bill = await this.billRepo.findById(dormitoryId, input.billId);
    if (!bill) {
      throw new Error('RESOURCE_NOT_FOUND: Bill not found');
    }

    if (bill.status === 'paid' || parseFloat(bill.outstandingAmount) <= 0) {
      throw new Error('BILL_ALREADY_PAID: Bill has already been paid in full');
    }

    if (bill.status === 'cancelled') {
      throw new Error('BILL_NOT_PAYABLE: Cannot make payment on a cancelled bill');
    }

    // 2. Validate Amount (Full-bill payment MVP)
    const expectedAmount = parseFloat(bill.outstandingAmount).toFixed(2);
    const submittedAmount = parseFloat(input.amount).toFixed(2);

    if (expectedAmount !== submittedAmount) {
      throw new Error(`PAYMENT_AMOUNT_MISMATCH: Submitted amount ${submittedAmount} does not match bill outstanding amount ${expectedAmount}`);
    }

    // 3. Create Payment Record
    const isCash = input.method === 'cash';
    const initialStatus = isCash && input.approveImmediately ? 'approved' : 'checking';

    const payment = await this.paymentRepo.create(dormitoryId, {
      billId: bill.id,
      contractId: bill.contractId,
      roomId: bill.roomId,
      tenantId: bill.tenantId,
      method: input.method,
      channel: input.channel || 'owner_manual',
      status: initialStatus,
      amount: expectedAmount,
      currency: bill.currency || 'THB',
      paidAt: input.paidAt || new Date(),
      submittedByUserId: input.submittedByUserId || null,
      submittedByTenantId: input.submittedByTenantId || null,
      receivedByUserId: isCash ? input.receivedByUserId || input.submittedByUserId : null,
      transactionReference: input.transactionReference || null,
      note: input.note || null,
    });

    let evidence: PaymentEvidenceEntity | undefined;

    // Link existing evidence if provided
    if (input.evidenceId) {
      const ev = await this.paymentRepo.findEvidenceById(dormitoryId, input.evidenceId);
      if (ev) {
        evidence = ev;
      }
    }

    // If Cash & approveImmediately is requested
    if (isCash && input.approveImmediately) {
      const approvedResult = await this.approvePayment(dormitoryId, {
        paymentId: payment.id,
        actorUserId: input.submittedByUserId || input.receivedByUserId,
      }, requestId);

      return {
        payment: approvedResult.payment,
        receipt: approvedResult.receipt,
        evidence,
      };
    }

    // Update Bill Status to checking
    await this.billRepo.updateStatus(dormitoryId, bill.id, 'checking', 'Payment submitted under review', input.submittedByUserId || null);

    await this.auditService.log({
      requestId,
      dormitoryId,
      userId: input.submittedByUserId || 'system',
      action: 'PAYMENT_SUBMITTED',
      entityType: 'PAYMENT',
      entityId: payment.id,
      details: JSON.stringify({ amount: payment.amount, method: payment.method }),
    });

    return { payment, evidence };
  }

  /**
   * Approves a payment atomically, marks bill paid, and generates receipt.
   */
  public async approvePayment(
    dormitoryId: string,
    input: ApprovePaymentInput,
    requestId?: string
  ): Promise<{ payment: PaymentEntity; receipt: ReceiptEntity; receiptItems: ReceiptItemEntity[] }> {
    // 1. Lock/Fetch Payment
    const payment = await this.paymentRepo.findById(dormitoryId, input.paymentId);
    if (!payment) {
      throw new Error('RESOURCE_NOT_FOUND: Payment not found');
    }

    if (payment.status === 'approved') {
      // Return existing payment & receipt if already approved (Idempotent replay)
      const existingReceiptRes = await this.receiptService.getReceiptByPaymentId(dormitoryId, payment.id);
      if (!existingReceiptRes) {
        throw new Error('INTERNAL_ERROR: Approved payment is missing receipt');
      }
      return {
        payment,
        receipt: existingReceiptRes.receipt,
        receiptItems: existingReceiptRes.items,
      };
    }

    if (payment.status === 'rejected' || payment.status === 'cancelled') {
      throw new Error(`PAYMENT_CANNOT_BE_APPROVED: Cannot approve a ${payment.status} payment`);
    }

    // 2. Fetch Bill
    const bill = await this.billRepo.findById(dormitoryId, payment.billId);
    if (!bill) {
      throw new Error('RESOURCE_NOT_FOUND: Bill not found for payment approval');
    }

    // 3. Perform Review Entry
    await this.paymentRepo.createReview(dormitoryId, {
      paymentId: payment.id,
      reviewerUserId: input.actorUserId || null,
      decision: 'approved',
      reviewSource: 'manual',
      verifiedAmount: payment.amount,
      reason: input.note || 'Manually approved by owner/finance',
    });

    // 4. Update Payment status = approved
    const updatedPayment = await this.paymentRepo.update(
      dormitoryId,
      payment.id,
      {
        status: 'approved',
        approvedAt: new Date(),
        approvedByUserId: input.actorUserId || null,
        note: input.note || payment.note,
      },
      input.version !== undefined ? input.version : payment.version
    );

    // 5. Update Bill status = paid, paidAmount = totalAmount, outstandingAmount = 0
    await this.billRepo.update(dormitoryId, bill.id, {
      status: 'paid',
      paidAmount: bill.totalAmount,
      outstandingAmount: '0.00',
    });

    await this.billRepo.addStatusHistory(
      dormitoryId,
      bill.id,
      bill.status,
      'paid',
      'Payment approved and receipt generated',
      input.actorUserId || null
    );

    // 6. Generate Receipt via ReceiptGenerationService
    const receiptResult = await this.receiptService.generateReceiptForPayment(
      dormitoryId,
      updatedPayment,
      input.actorUserId
    );

    // 7. Audit Log
    await this.auditService.log({
      requestId,
      dormitoryId,
      userId: input.actorUserId || 'system',
      action: 'PAYMENT_APPROVED',
      entityType: 'PAYMENT',
      entityId: updatedPayment.id,
      details: JSON.stringify({ receiptNumber: receiptResult.receipt.receiptNumber, amount: updatedPayment.amount }),
    });

    return {
      payment: updatedPayment,
      receipt: receiptResult.receipt,
      receiptItems: receiptResult.items,
    };
  }

  /**
   * Rejects a payment with mandatory reason.
   */
  public async rejectPayment(
    dormitoryId: string,
    input: RejectPaymentInput,
    requestId?: string
  ): Promise<{ payment: PaymentEntity }> {
    if (!input.reason || input.reason.trim() === '') {
      throw new Error('PAYMENT_REJECT_REASON_REQUIRED: Reason for payment rejection is required');
    }

    const payment = await this.paymentRepo.findById(dormitoryId, input.paymentId);
    if (!payment) {
      throw new Error('RESOURCE_NOT_FOUND: Payment not found');
    }

    if (payment.status === 'approved') {
      throw new Error('PAYMENT_CANNOT_BE_REJECTED: Approved payments cannot be rejected');
    }

    const bill = await this.billRepo.findById(dormitoryId, payment.billId);
    if (!bill) {
      throw new Error('RESOURCE_NOT_FOUND: Bill not found for payment rejection');
    }

    // Create review entry
    await this.paymentRepo.createReview(dormitoryId, {
      paymentId: payment.id,
      reviewerUserId: input.actorUserId || null,
      decision: 'rejected',
      reviewSource: 'manual',
      reason: input.reason,
    });

    // Update payment
    const updatedPayment = await this.paymentRepo.update(
      dormitoryId,
      payment.id,
      {
        status: 'rejected',
        rejectedAt: new Date(),
        rejectedByUserId: input.actorUserId || null,
        rejectReason: input.reason,
      },
      input.version !== undefined ? input.version : payment.version
    );

    // Set Bill status back to overdue or pending
    const now = new Date();
    const newBillStatus = bill.dueDate < now ? 'overdue' : 'pending';

    await this.billRepo.updateStatus(
      dormitoryId,
      bill.id,
      newBillStatus,
      `Payment rejected: ${input.reason}`,
      input.actorUserId || null
    );

    await this.auditService.log({
      requestId,
      dormitoryId,
      userId: input.actorUserId || 'system',
      action: 'PAYMENT_REJECTED',
      entityType: 'PAYMENT',
      entityId: updatedPayment.id,
      details: JSON.stringify({ reason: input.reason }),
    });

    return { payment: updatedPayment };
  }

  /**
   * Upload Intent for payment evidence.
   */
  public async createUploadIntent(
    dormitoryId: string,
    input: { billId: string; fileName: string; mimeType: string; fileSize: number },
    actorUserId?: string | null,
    actorTenantId?: string | null
  ) {
    const bill = await this.billRepo.findById(dormitoryId, input.billId);
    if (!bill) {
      throw new Error('RESOURCE_NOT_FOUND: Bill not found');
    }

    return this.storageProvider.createUploadIntent({
      dormitoryId,
      billId: input.billId,
      actorUserId,
      actorTenantId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
    });
  }

  /**
   * Confirm upload evidence and save evidence record.
   */
  public async confirmEvidence(
    dormitoryId: string,
    input: {
      paymentId: string;
      uploadIntentId: string;
      sha256: string;
      transactionReference?: string;
      qrPayloadHash?: string;
    },
    actorUserId?: string | null
  ): Promise<PaymentEvidenceEntity> {
    // Duplicate check
    const dupCheck = await this.duplicateDetector.checkDuplicate(dormitoryId, {
      sha256: input.sha256,
      transactionReference: input.transactionReference,
      qrPayloadHash: input.qrPayloadHash,
    });

    if (dupCheck.isDuplicate) {
      throw new Error(`${dupCheck.code}: ${dupCheck.message}`);
    }

    const stored: StoredEvidence = await this.storageProvider.confirmUpload({
      dormitoryId,
      intentId: input.uploadIntentId,
      sha256: input.sha256,
      transactionReference: input.transactionReference,
      qrPayloadHash: input.qrPayloadHash,
    });

    return this.paymentRepo.createEvidence(dormitoryId, {
      paymentId: input.paymentId,
      type: 'slip_image',
      storageProvider: 'in_memory',
      objectKey: stored.objectKey,
      originalFileName: stored.originalFileName,
      mimeType: stored.mimeType,
      fileSize: stored.fileSize,
      sha256: stored.sha256,
      transactionReference: stored.transactionReference,
      qrPayloadHash: stored.qrPayloadHash,
      uploadedByUserId: actorUserId || null,
      status: 'available',
    });
  }

  public async getEvidenceReadAccess(dormitoryId: string, evidenceId: string) {
    const ev = await this.paymentRepo.findEvidenceById(dormitoryId, evidenceId);
    if (!ev) {
      throw new Error('RESOURCE_NOT_FOUND: Evidence not found');
    }
    return this.storageProvider.getReadAccess({ dormitoryId, objectKey: ev.objectKey });
  }

  public async getPaymentDetails(dormitoryId: string, paymentId: string) {
    const payment = await this.paymentRepo.findById(dormitoryId, paymentId);
    if (!payment) return null;

    const bill = await this.billRepo.findById(dormitoryId, payment.billId);
    const evidences = await this.paymentRepo.findEvidencesByPaymentId(dormitoryId, payment.id);
    const reviews = await this.paymentRepo.findReviewsByPaymentId(dormitoryId, payment.id);
    const statusHistories = await this.paymentRepo.getStatusHistory(dormitoryId, payment.id);
    const receiptRes = await this.receiptService.getReceiptByPaymentId(dormitoryId, payment.id);

    return {
      payment,
      bill,
      evidences,
      reviews,
      statusHistories,
      receipt: receiptRes?.receipt || null,
      receiptItems: receiptRes?.items || [],
    };
  }

  public async listPayments(dormitoryId: string, filters: any = {}) {
    return this.paymentRepo.findAll(dormitoryId, filters);
  }

  public async getSummary(dormitoryId: string, cycleId?: string) {
    return this.paymentRepo.getSummary(dormitoryId, cycleId);
  }
}
