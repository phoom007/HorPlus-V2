import { PrismaClient, Payment, Bill, Receipt } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { localStorageProvider } from './local-storage.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

export class PaymentService {
  /**
   * Submit payment slip evidence
   */
  async submitSlip(input: {
    dormitoryId: string;
    billId: string;
    tenantId: string;
    amount: string; // The UI might send what they want, but we will validate against Bill
    paymentDate: Date;
    intentId: string; // the intent from creating upload
    fileHash: string; // SHA-256
    idempotencyKey?: string;
  }) {
    if (input.idempotencyKey) {
      const existing = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey }
      });
      if (existing) return existing;
    }

    // Duplicate evidence check
    const duplicate = await prisma.payment.findUnique({
      where: { fileHash: input.fileHash }
    });
    if (duplicate) {
      throw new Error('DUPLICATE_PAYMENT_EVIDENCE');
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Fetch Bill
      const bill = await tx.bill.findUnique({
        where: {
          dormitory_bill_number_unique: {
            dormitoryId: input.dormitoryId,
            billNumber: input.billId // wait, input is billId (uuid) or billNumber? Assuming billId
          }
        },
        include: { items: true }
      });
      // Try falling back to id if billNumber doesn't match
      const actualBill = bill || await tx.bill.findUnique({
        where: { id: input.billId },
        include: { items: true }
      });

      if (!actualBill) throw new Error('NOT_FOUND');
      if (actualBill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
      if (actualBill.status === 'PAID') throw new Error('ALREADY_PAID');

      // Check active payments
      const activePayment = await tx.payment.findFirst({
        where: {
          billId: actualBill.id,
          status: { in: ['PENDING', 'UNDER_REVIEW'] }
        }
      });
      if (activePayment) {
        throw new Error('ACTIVE_REVIEW_EXISTS');
      }

      // Calculate total
      const totalAmount = actualBill.items.reduce((sum, item) => sum.plus(new Decimal(item.amount)), new Decimal(0));
      const submitAmount = new Decimal(input.amount);
      if (!totalAmount.equals(submitAmount)) {
        // "Reject unsupported amounts with a clear HTTP 400 validation error"
        // But the prompt says one payment = one bill. Must match perfectly.
        // Wait, what if they paid a different amount by mistake? We still store it but it might be rejected.
        // Let's enforce it perfectly for now to "Reject unsupported amounts".
        throw new Error('UNSUPPORTED_AMOUNT');
      }

      // 2. Create Payment
      const payment = await tx.payment.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: actualBill.id,
          tenantId: input.tenantId,
          method: 'BANK_TRANSFER',
          amount: submitAmount,
          status: 'PENDING', // no slipok enabled
          paymentDate: input.paymentDate,
          evidenceUrl: `/api/v1/files/private?key=payments/${input.dormitoryId}/${actualBill.id}/${input.intentId}.jpg`, // Just a simulated URL path
          fileHash: input.fileHash,
          idempotencyKey: input.idempotencyKey,
        }
      });

      // 3. Update Bill status
      await tx.bill.update({
        where: { id: actualBill.id },
        data: { status: 'CHECKING' } // or whatever state machine requires. The prompt said `Bill -> CHECKING`
      });

      // Status history
      await tx.paymentStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          paymentId: payment.id,
          fromStatus: null,
          toStatus: 'PENDING',
        }
      });
      await tx.billStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: actualBill.id,
          fromStatus: actualBill.status,
          toStatus: 'CHECKING',
          reason: 'Tenant submitted payment slip'
        }
      });

      return payment;
    });
  }

  /**
   * Approve a pending payment
   */
  async approvePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    idempotencyKey?: string;
  }) {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId },
        include: { bill: true }
      });
      if (!payment) throw new Error('NOT_FOUND');
      if (payment.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
      if (payment.status === 'APPROVED') return payment; // Idempotent fallback
      if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
        throw new Error('INVALID_STATE_TRANSITION');
      }

      // Generate Receipt Number safely
      const now = new Date();
      const yearMonth = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      
      const seq = await tx.receiptSequence.upsert({
        where: {
          dormitory_receipt_seq_unique: {
            dormitoryId: input.dormitoryId,
            yearMonth
          }
        },
        create: {
          dormitoryId: input.dormitoryId,
          yearMonth,
          lastValue: 1
        },
        update: {
          lastValue: { increment: 1 }
        }
      });
      
      const sequenceString = seq.lastValue.toString().padStart(4, '0');
      
      // Need room number for receipt. Let's get it from bill.
      const bill = await tx.bill.findUnique({
        where: { id: payment.billId },
        include: { room: true }
      });
      if (!bill) throw new Error('NOT_FOUND');
      const roomNumber = bill.room.roomNumber.replace(/[^a-zA-Z0-9]/g, ''); // Normalize
      
      const receiptNumber = `RC-${yearMonth}-${roomNumber}-${sequenceString}`;

      // Update Payment
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'APPROVED',
          reviewedByUserId: input.userId,
          reviewedAt: new Date()
        }
      });

      // Update Bill
      await tx.bill.update({
        where: { id: payment.billId },
        data: { status: 'PAID' }
      });

      // Create Receipt
      await tx.receipt.create({
        data: {
          dormitoryId: input.dormitoryId,
          paymentId: payment.id,
          billId: payment.billId,
          receiptNumber,
          snapshotData: { amount: payment.amount, paymentMethod: payment.method, date: payment.paymentDate }, // basic snapshot
          issuedByUserId: input.userId
        }
      });

      // Status Histories
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
          billId: payment.billId,
          fromStatus: bill.status,
          toStatus: 'PAID',
          changedByUserId: input.userId
        }
      });

      return updatedPayment;
    });
  }

  /**
   * Reject payment
   */
  async rejectPayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
  }) {
    if (!input.reason) throw new Error('REASON_REQUIRED');

    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId }
      });
      if (!payment) throw new Error('NOT_FOUND');
      if (payment.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
      if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
        throw new Error('INVALID_STATE_TRANSITION');
      }

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REJECTED',
          rejectedReason: input.reason,
          reviewedByUserId: input.userId,
          reviewedAt: new Date()
        }
      });

      // Restore Bill state
      await tx.bill.update({
        where: { id: payment.billId },
        data: { status: 'ISSUED' } // Restore to previous valid unpaid state
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
      await tx.billStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: payment.billId,
          fromStatus: 'CHECKING',
          toStatus: 'ISSUED',
          reason: 'Payment rejected',
          changedByUserId: input.userId
        }
      });

      return updatedPayment;
    });
  }

  /**
   * Reverse approved payment
   */
  async reversePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    reason: string;
  }) {
    if (!input.reason) throw new Error('REASON_REQUIRED');

    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: input.paymentId },
        include: { receipt: true }
      });
      if (!payment) throw new Error('NOT_FOUND');
      if (payment.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
      if (payment.status !== 'APPROVED') {
        throw new Error('INVALID_STATE_TRANSITION');
      }

      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'REVERSED',
          reversedByUserId: input.userId,
          reversedAt: new Date(),
          reversalReason: input.reason
        }
      });

      if (payment.receipt) {
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

      await tx.bill.update({
        where: { id: payment.billId },
        data: { status: 'ISSUED' }
      });

      await tx.paymentStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          paymentId: payment.id,
          fromStatus: 'APPROVED',
          toStatus: 'REVERSED',
          reason: input.reason,
          changedByUserId: input.userId
        }
      });
      await tx.billStatusHistory.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: payment.billId,
          fromStatus: 'PAID',
          toStatus: 'ISSUED',
          reason: 'Payment reversed',
          changedByUserId: input.userId
        }
      });

      return updatedPayment;
    });
  }

  /**
   * Record manual cash payment
   */
  async recordCash(input: {
    dormitoryId: string;
    billId: string;
    userId: string;
    amount: string;
  }) {
    return await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id: input.billId },
        include: { items: true, room: true }
      });
      if (!bill) throw new Error('NOT_FOUND');
      if (bill.dormitoryId !== input.dormitoryId) throw new Error('FORBIDDEN');
      if (bill.status === 'PAID') throw new Error('ALREADY_PAID');

      const totalAmount = bill.items.reduce((sum, item) => sum.plus(new Decimal(item.amount)), new Decimal(0));
      const submitAmount = new Decimal(input.amount);
      if (!totalAmount.equals(submitAmount)) {
        throw new Error('UNSUPPORTED_AMOUNT');
      }

      // Generate Receipt Number
      const now = new Date();
      const yearMonth = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}`;
      
      const seq = await tx.receiptSequence.upsert({
        where: {
          dormitory_receipt_seq_unique: { dormitoryId: input.dormitoryId, yearMonth }
        },
        create: { dormitoryId: input.dormitoryId, yearMonth, lastValue: 1 },
        update: { lastValue: { increment: 1 } }
      });
      
      const roomNumber = bill.room.roomNumber.replace(/[^a-zA-Z0-9]/g, '');
      const sequenceString = seq.lastValue.toString().padStart(4, '0');
      const receiptNumber = `RC-${yearMonth}-${roomNumber}-${sequenceString}`;

      const payment = await tx.payment.create({
        data: {
          dormitoryId: input.dormitoryId,
          billId: bill.id,
          method: 'CASH',
          amount: submitAmount,
          status: 'APPROVED',
          paymentDate: new Date(),
          reviewedByUserId: input.userId,
          reviewedAt: new Date()
        }
      });

      await tx.receipt.create({
        data: {
          dormitoryId: input.dormitoryId,
          paymentId: payment.id,
          billId: bill.id,
          receiptNumber,
          snapshotData: { amount: payment.amount, paymentMethod: payment.method, date: payment.paymentDate },
          issuedByUserId: input.userId
        }
      });

      await tx.bill.update({
        where: { id: bill.id },
        data: { status: 'PAID' }
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
          dormitoryId: input.dormitoryId,
          billId: bill.id,
          fromStatus: bill.status,
          toStatus: 'PAID',
          reason: 'Manual cash payment recorded',
          changedByUserId: input.userId
        }
      });

      return payment;
    });
  }
}

export const paymentService = new PaymentService();
