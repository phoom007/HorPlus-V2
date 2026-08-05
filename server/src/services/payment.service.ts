import { PrismaClient, Payment, Bill, Receipt } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { idempotencyService } from './idempotency.service.js';

const prisma = new PrismaClient();

export class PaymentService {
  constructor(private client: PrismaClient = prisma) {}

  /**
   * Tenant submits payment with an uploaded slip intent
   */
  async submitSlip(input: {
    dormitoryId: string;
    billId: string;
    tenantId: string;
    amount: string;
    paymentDate: Date;
    intentId: string;
    idempotencyKey?: string | null;
    actorUserId: string;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.actorUserId,
      operation: 'submitSlip',
      idempotencyKey: input.idempotencyKey,
      payload: {
        billId: input.billId,
        amount: input.amount,
        intentId: input.intentId,
        paymentDate: input.paymentDate.toISOString()
      },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          // 1. Verify upload intent
          const intent = await tx.paymentUploadIntent.findUnique({ where: { id: input.intentId } });
          if (!intent) throw new Error('INTENT_NOT_FOUND');
          if (intent.status !== 'UPLOADED') throw new Error('INTENT_INVALID_STATE');
          if (
            intent.authenticatedUserId !== input.actorUserId ||
            intent.tenantId !== input.tenantId ||
            intent.billId !== input.billId
          ) {
            throw new Error('FORBIDDEN_INTENT_MISMATCH');
          }
          if (intent.expiresAt < new Date()) throw new Error('INTENT_EXPIRED');

          // 2. Verify bill
          const bill = await tx.bill.findUnique({
            where: { id: input.billId },
            include: { items: true }
          });

          if (!bill) throw new Error('NOT_FOUND');
          if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
          if (bill.tenantId !== input.tenantId) throw new Error('FORBIDDEN_BILL_OWNERSHIP');
          if (bill.status === 'PAID') throw new Error('ALREADY_PAID');

          const activePayment = await tx.payment.findFirst({
            where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] } }
          });
          if (activePayment) {
            throw new Error('ACTIVE_REVIEW_EXISTS');
          }

          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          const totalAmount = bill.items.reduce((sum, item) => sum.plus(new Decimal(item.amount)), new Decimal(0));
          const submitAmount = new Decimal(input.amount);

          if (!totalAmount.equals(submitAmount)) {
            throw new Error('UNSUPPORTED_AMOUNT');
          }

          // 3. Create Payment record
          const payment = await tx.payment.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              tenantId: input.tenantId,
              method: 'BANK_TRANSFER',
              amount: submitAmount,
              status: 'PENDING',
              paymentDate: input.paymentDate,
              evidenceUrl: intent.objectKey,
              fileHash: intent.sha256,
              idempotencyKey: input.idempotencyKey,
              metadata: { intentId: input.intentId }
            }
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: null,
              toStatus: 'PENDING',
              changedByUserId: input.actorUserId
            }
          });

          // Save previous status on bill before moving to review
          const preReviewStatus = bill.status;
          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: preReviewStatus,
              toStatus: 'UNDER_REVIEW',
              changedByUserId: input.actorUserId
            }
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: 'UNDER_REVIEW',
              previousStatus: preReviewStatus
            }
          });

          // Consume intent
          await tx.paymentUploadIntent.update({
            where: { id: intent.id },
            data: { status: 'CONSUMED', consumedAt: new Date() }
          });

          return payment;
        });
      }
    });
  }

  /**
   * Owner records cash payment directly
   */
  async recordCash(input: {
    dormitoryId: string;
    billId: string;
    amount: string;
    userId: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'recordCash',
      idempotencyKey: input.idempotencyKey,
      payload: { billId: input.billId, amount: input.amount },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const bill = await tx.bill.findUnique({
            where: { id: input.billId },
            include: { items: true }
          });
          if (!bill) throw new Error('NOT_FOUND');
          if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
          if (bill.status === 'PAID') throw new Error('ALREADY_PAID');

          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          const totalAmount = bill.items.length > 0
            ? bill.items.reduce((sum, item) => sum.plus(new Decimal(item.amount)), new Decimal(0))
            : new Decimal(bill.totalAmount);
          const submitAmount = new Decimal(input.amount);
          if (!totalAmount.equals(submitAmount)) throw new Error('UNSUPPORTED_AMOUNT');

          const now = new Date();

          const payment = await tx.payment.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              tenantId: bill.tenantId,
              method: 'CASH',
              amount: submitAmount,
              status: 'APPROVED',
              paymentDate: now,
              reviewedByUserId: input.userId,
              reviewedAt: now,
              idempotencyKey: input.idempotencyKey
            }
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: null,
              toStatus: 'APPROVED',
              changedByUserId: input.userId
            }
          });

          const prePaymentStatus = bill.status;
          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: prePaymentStatus,
              toStatus: 'PAID',
              changedByUserId: input.userId
            }
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: 'PAID',
              previousStatus: prePaymentStatus,
              paidAt: now,
              paidAmount: submitAmount,
              outstandingAmount: new Decimal(0)
            }
          });

          await this.generateReceiptTx(tx, payment.id, input.dormitoryId, bill.id, input.userId);

          return payment;
        });
      }
    });
  }

  /**
   * Owner approves pending payment
   */
  async approvePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'approvePayment',
      idempotencyKey: input.idempotencyKey,
      payload: { paymentId: input.paymentId },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
          if (payment.status === 'APPROVED') return payment;
          if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new Error('INVALID_STATE');

          const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
          if (!bill) throw new Error('BILL_NOT_FOUND');

          const now = new Date();

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'APPROVED',
              reviewedByUserId: input.userId,
              reviewedAt: now
            }
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: payment.status,
              toStatus: 'APPROVED',
              changedByUserId: input.userId
            }
          });

          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: bill.status,
              toStatus: 'PAID',
              changedByUserId: input.userId
            }
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: 'PAID',
              paidAt: now,
              paidAmount: payment.amount,
              outstandingAmount: new Decimal(0)
            }
          });

          await this.generateReceiptTx(tx, payment.id, input.dormitoryId, bill.id, input.userId);

          return updatedPayment;
        });
      }
    });
  }

  /**
   * Owner rejects pending payment with mandatory reason
   */
  async rejectPayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'rejectPayment',
      idempotencyKey: input.idempotencyKey,
      payload: { paymentId: input.paymentId, reason: input.reason },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
          if (payment.status === 'REJECTED') return payment;
          if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new Error('INVALID_STATE');

          const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
          if (!bill) throw new Error('BILL_NOT_FOUND');

          const now = new Date();

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REJECTED',
              reviewedByUserId: input.userId,
              reviewedAt: now,
              rejectedReason: input.reason
            }
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: payment.status,
              toStatus: 'REJECTED',
              reason: input.reason,
              changedByUserId: input.userId
            }
          });

          // Check if there is another valid approved payment for this bill
          const otherApproved = await tx.payment.findFirst({
            where: {
              billId: bill.id,
              status: 'APPROVED',
              id: { not: payment.id }
            }
          });

          if (!otherApproved) {
            // Restore exact previous unpaid state
            const targetStatus = bill.previousStatus || 'ISSUED';
            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: bill.status,
                toStatus: targetStatus,
                reason: `Payment rejected: ${input.reason}`,
                changedByUserId: input.userId
              }
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: targetStatus,
                paidAt: null,
                paidAmount: new Decimal(0),
                outstandingAmount: bill.totalAmount
              }
            });
          }

          return updatedPayment;
        });
      }
    });
  }

  /**
   * Owner reverses an approved payment
   */
  async reversePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'reversePayment',
      idempotencyKey: input.idempotencyKey,
      payload: { paymentId: input.paymentId, reason: input.reason },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({
            where: { id: input.paymentId },
            include: { receipt: true }
          });
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
          if (payment.status === 'REVERSED') return payment;
          if (payment.status !== 'APPROVED') throw new Error('INVALID_STATE');

          const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
          if (!bill) throw new Error('BILL_NOT_FOUND');

          const now = new Date();

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REVERSED',
              reversedByUserId: input.userId,
              reversedAt: now,
              reversalReason: input.reason
            }
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: payment.status,
              toStatus: 'REVERSED',
              reason: input.reason,
              changedByUserId: input.userId
            }
          });

          // Void receipt if exists
          if (payment.receipt && !payment.receipt.isVoided) {
            await tx.receipt.update({
              where: { id: payment.receipt.id },
              data: {
                isVoided: true,
                voidedAt: now,
                voidedByUserId: input.userId,
                voidReason: input.reason
              }
            });
          }

          // Check if any other approved payment exists for this bill
          const otherApproved = await tx.payment.findFirst({
            where: {
              billId: bill.id,
              status: 'APPROVED',
              id: { not: payment.id }
            }
          });

          if (!otherApproved) {
            const targetStatus = bill.previousStatus || 'ISSUED';
            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: bill.status,
                toStatus: targetStatus,
                reason: `Payment reversed: ${input.reason}`,
                changedByUserId: input.userId
              }
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: targetStatus,
                paidAt: null,
                paidAmount: new Decimal(0),
                outstandingAmount: bill.totalAmount
              }
            });
          }

          return updatedPayment;
        });
      }
    });
  }

  /**
   * Generates sequential receipt in locked format RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
   */
  public async generateReceiptTx(tx: any, paymentId: string, dormitoryId: string, billId: string, userId: string) {
    const today = new Date();
    const yearMonth = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const seq = await tx.receiptSequence.upsert({
      where: {
        dormitory_receipt_seq_unique: {
          dormitoryId,
          yearMonth
        }
      },
      create: {
        dormitoryId,
        yearMonth,
        lastValue: 1
      },
      update: {
        lastValue: { increment: 1 }
      }
    });

    const bill = await tx.bill.findUnique({
      where: { id: billId },
      include: { items: true, dormitory: true, tenant: true, room: true }
    });

    const rawRoomNumber = bill?.room?.normalizedRoomNumber || bill?.room?.roomNumber || 'GEN';
    const normalizedRoom = rawRoomNumber.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'GEN';
    const sequenceStr = String(seq.lastValue).padStart(4, '0');

    // Locked format: RC-{YYYYMM}-{NORMALIZED_ROOM_NO}-{SEQUENCE}
    const receiptNumber = `RC-${yearMonth}-${normalizedRoom}-${sequenceStr}`;

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });

    const subtotal = bill.items.reduce((sum: Decimal, item: any) => sum.plus(new Decimal(item.amount)), new Decimal(0));
    const total = bill.totalAmount ? new Decimal(bill.totalAmount) : subtotal;
    const discount = subtotal.minus(total).greaterThan(0) ? subtotal.minus(total).toString() : '0.00';

    const snapshotData = {
      dormitoryName: bill.dormitory.name,
      dormitoryTaxId: bill.dormitory.taxId || '-',
      dormitoryAddress: bill.dormitory.address || '-',
      dormitoryPhone: bill.dormitory.phone || '-',
      tenantName: bill.tenant?.name || bill.tenant?.displayName || 'ผู้เช่า',
      roomNumber: bill.room?.roomNumber || 'N/A',
      billNumber: bill.billNumber || bill.id,
      items: bill.items.map((i: any) => ({
        description: i.description,
        amount: i.amount.toString(),
        quantity: (i.quantity || 1).toString()
      })),
      subtotal: subtotal.toString(),
      discount: discount,
      total: total.toString(),
      paymentMethod: payment?.method || 'BANK_TRANSFER',
      paymentDate: payment?.paymentDate ? payment.paymentDate.toISOString() : today.toISOString(),
      approvalDate: payment?.reviewedAt ? payment.reviewedAt.toISOString() : today.toISOString(),
      receiptNumber: receiptNumber,
      issueDate: today.toISOString(),
      isVoided: false,
      voidReason: null
    };

    return await tx.receipt.create({
      data: {
        dormitoryId,
        paymentId,
        billId,
        receiptNumber,
        snapshotData,
        issuedByUserId: userId
      }
    });
  }
}

export const paymentService = new PaymentService();
