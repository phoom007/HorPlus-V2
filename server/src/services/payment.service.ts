import { PrismaClient, Payment, Bill, Receipt } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

// A simple Idempotency Engine
async function withIdempotency<T>(
  userId: string,
  operation: string,
  idempotencyKey: string | undefined,
  input: any,
  fn: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) return fn();
  
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      user_operation_idempotency_unique: {
        userId,
        operation,
        idempotencyKey
      }
    }
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new Error('IDEMPOTENCY_MISMATCH');
    }
    // Idempotency replay (generic catch-all). If the previous request completed, we must return the entity.
    // In our implementation, returning `undefined` and forcing the caller to handle idempotency themselves is safer
    // But since the prompt requires an idempotency engine, we'll let the outer layer handle it, or we error out
    // and let the client fetch the current state.
    if (existing.status === 'completed') {
      // Actually we will let the specific functions handle idempotency lookup first,
      // because we can't easily fetch the correct Payment from here without generic logic.
    }
  }

  // Create processing record
  await prisma.idempotencyKey.upsert({
    where: {
      user_operation_idempotency_unique: { userId, operation, idempotencyKey }
    },
    create: {
      userId,
      operation,
      idempotencyKey,
      requestHash,
      status: 'processing'
    },
    update: {}
  });

  try {
    const result = await fn();
    await prisma.idempotencyKey.update({
      where: { user_operation_idempotency_unique: { userId, operation, idempotencyKey } },
      data: { status: 'completed' }
    });
    return result;
  } catch (err) {
    await prisma.idempotencyKey.update({
      where: { user_operation_idempotency_unique: { userId, operation, idempotencyKey } },
      data: { status: 'failed' }
    });
    throw err;
  }
}

export class PaymentService {
  async submitSlip(input: {
    dormitoryId: string;
    billId: string;
    tenantId: string;
    amount: string;
    paymentDate: Date;
    intentId: string;
    idempotencyKey?: string;
    actorUserId: string;
  }) {
    // Check if the payment already exists by intent to replay idempotently
    const existingPayment = await prisma.payment.findFirst({
      where: { metadata: { path: ['intentId'], equals: input.intentId } }
    });
    if (existingPayment) return existingPayment;

    return withIdempotency(input.actorUserId, 'submitSlip', input.idempotencyKey, { billId: input.billId, amount: input.amount, intentId: input.intentId }, async () => {
      return await prisma.$transaction(async (tx) => {
        // Look up by authoritative ID ONLY
        const bill = await tx.bill.findUnique({
          where: { id: input.billId },
          include: { items: true }
        });

        if (!bill) throw new Error('NOT_FOUND');
        if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
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

        const payment = await tx.payment.create({
          data: {
            dormitoryId: input.dormitoryId,
            billId: bill.id,
            tenantId: input.tenantId,
            method: 'BANK_TRANSFER',
            amount: submitAmount,
            status: 'PENDING',
            paymentDate: input.paymentDate,
            evidenceUrl: `/api/v1/files/private?key=payments/${input.intentId}.jpg`, 
            idempotencyKey: input.idempotencyKey,
            metadata: { intentId: input.intentId }
          }
        });

        // Store previous status in history
        await tx.paymentStatusHistory.create({
          data: {
            dormitoryId: input.dormitoryId,
            paymentId: payment.id,
            fromStatus: null,
            toStatus: 'PENDING',
            changedByUserId: input.actorUserId
          }
        });

        await tx.billStatusHistory.create({
          data: {
            billId: bill.id,
            fromStatus: bill.status,
            toStatus: 'CHECKING',
            changedByUserId: input.actorUserId
          }
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { status: 'CHECKING', metadata: { previousStatus: bill.status } }
        });

        return payment;
      });
    });
  }

  async recordCash(input: {
    dormitoryId: string;
    billId: string;
    amount: string;
    userId: string;
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
        const existing = await prisma.payment.findFirst({ where: { idempotencyKey: input.idempotencyKey }});
        if (existing) return existing;
    }
    
    return withIdempotency(input.userId, 'recordCash', input.idempotencyKey, { billId: input.billId, amount: input.amount }, async () => {
      return await prisma.$transaction(async (tx) => {
        const bill = await tx.bill.findUnique({
          where: { id: input.billId },
          include: { items: true }
        });
        if (!bill) throw new Error('NOT_FOUND');
        if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
        if (bill.status === 'PAID') throw new Error('ALREADY_PAID');

        Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
        const totalAmount = bill.items.reduce((sum, item) => sum.plus(new Decimal(item.amount)), new Decimal(0));
        const submitAmount = new Decimal(input.amount);
        if (!totalAmount.equals(submitAmount)) throw new Error('UNSUPPORTED_AMOUNT');

        const payment = await tx.payment.create({
          data: {
            dormitoryId: input.dormitoryId,
            billId: bill.id,
            tenantId: bill.tenantId,
            method: 'CASH',
            amount: submitAmount,
            status: 'APPROVED',
            paymentDate: new Date(),
            reviewedByUserId: input.userId,
            reviewedAt: new Date(),
            idempotencyKey: input.idempotencyKey,
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

        await tx.billStatusHistory.create({
          data: {
            billId: bill.id,
            fromStatus: bill.status,
            toStatus: 'PAID',
            changedByUserId: input.userId
          }
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { status: 'PAID', paidAt: new Date(), metadata: { previousStatus: bill.status } }
        });

        await this.generateReceiptTx(tx, payment.id, input.dormitoryId, bill.id, input.userId);

        return payment;
      });
    });
  }

  async approvePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    idempotencyKey?: string;
  }) {
    return withIdempotency(input.userId, 'approvePayment', input.idempotencyKey, { paymentId: input.paymentId }, async () => {
      return await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
        if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
        if (payment.status === 'APPROVED') return payment; // Idempotent fallback
        if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new Error('INVALID_STATE');

        const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
        if (!bill) throw new Error('BILL_NOT_FOUND');

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'APPROVED',
            reviewedByUserId: input.userId,
            reviewedAt: new Date()
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
            billId: bill.id,
            fromStatus: bill.status,
            toStatus: 'PAID',
            changedByUserId: input.userId
          }
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { status: 'PAID', paidAt: new Date(), metadata: { ...bill.metadata as any, previousStatus: bill.status } }
        });

        await this.generateReceiptTx(tx, payment.id, input.dormitoryId, bill.id, input.userId);

        return updatedPayment;
      });
    });
  }

  async rejectPayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
    idempotencyKey?: string;
  }) {
    return withIdempotency(input.userId, 'rejectPayment', input.idempotencyKey, { paymentId: input.paymentId, reason: input.reason }, async () => {
      return await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
        if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
        if (payment.status === 'REJECTED') return payment;
        if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new Error('INVALID_STATE');

        const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
        if (!bill) throw new Error('BILL_NOT_FOUND');

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REJECTED',
            reviewedByUserId: input.userId,
            reviewedAt: new Date(),
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

        const previousStatus = (bill.metadata as any)?.previousStatus || 'ISSUED';

        await tx.billStatusHistory.create({
          data: {
            billId: bill.id,
            fromStatus: bill.status,
            toStatus: previousStatus,
            changedByUserId: input.userId
          }
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { status: previousStatus }
        });

        return updatedPayment;
      });
    });
  }

  async reversePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
    idempotencyKey?: string;
  }) {
    return withIdempotency(input.userId, 'reversePayment', input.idempotencyKey, { paymentId: input.paymentId, reason: input.reason }, async () => {
      return await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { receipt: true } });
        if (!payment || payment.dormitoryId !== input.dormitoryId) throw new Error('NOT_FOUND');
        if (payment.status === 'REVERSED') return payment;
        if (payment.status !== 'APPROVED') throw new Error('INVALID_STATE');

        const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
        if (!bill) throw new Error('BILL_NOT_FOUND');

        const updatedPayment = await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: 'REVERSED',
            reversedByUserId: input.userId,
            reversedAt: new Date(),
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

        if (payment.receipt && !payment.receipt.isVoided) {
          await tx.receipt.update({
            where: { id: payment.receipt.id },
            data: {
              isVoided: true,
              voidedAt: new Date(),
              voidedByUserId: input.userId,
              voidReason: input.reason
            }
          });
        }

        const previousStatus = (bill.metadata as any)?.previousStatus || 'ISSUED';
        await tx.billStatusHistory.create({
          data: {
            billId: bill.id,
            fromStatus: bill.status,
            toStatus: previousStatus,
            changedByUserId: input.userId
          }
        });

        await tx.bill.update({
          where: { id: bill.id },
          data: { status: previousStatus, paidAt: null }
        });

        return updatedPayment;
      });
    });
  }

  private async generateReceiptTx(tx: any, paymentId: string, dormitoryId: string, billId: string, userId: string) {
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

    const receiptNumber = `REC-${yearMonth}-${String(seq.lastValue).padStart(4, '0')}`;

    const bill = await tx.bill.findUnique({ where: { id: billId }, include: { items: true, dormitory: true, tenant: true, room: true } });

    const snapshotData = {
      dormitoryName: bill.dormitory.name,
      dormitoryTaxId: bill.dormitory.taxId,
      dormitoryAddress: bill.dormitory.address,
      dormitoryPhone: bill.dormitory.phone,
      tenantName: bill.tenant?.displayName,
      roomNumber: bill.room.roomNumber,
      billNumber: bill.billNumber,
      items: bill.items.map((i: any) => ({
        description: i.description,
        amount: i.amount.toString(),
        quantity: i.quantity.toString()
      })),
      total: bill.totalAmount.toString()
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
