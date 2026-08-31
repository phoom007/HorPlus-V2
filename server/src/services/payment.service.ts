/**
 * @license Apache-2.0
 * OWNER R3.8c — Financial Payment Service
 * 
 * Core Financial Authority:
 * 1. Single-Bill Cash Only: Owner records cash on Bill X -> settle ONLY Bill X.
 * 2. Real Grouped Slip Monetary Event: 1 slip = 1 CombinedPaymentGroup = 1 Receipt.
 * 3. Separation of Review & Financial States: Pending slip submissions do NOT mutate Bill.status to UNDER_REVIEW.
 * 4. Group Review Authority: Approve, reject, and reverse combined slip payments as 1 group.
 * 5. Legacy Unallocated Baseline Protection: Preserve historical unallocated amounts without guessing line items.
 * 6. Untrusted Client Payment Timestamps: Stored as claimedTransferAt; never used to freeze late fees without trusted verifier.
 */

import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { idempotencyService } from './idempotency.service.js';
import { computeCanonicalAllocationPlan } from '../utils/allocation.util.js';
import {
  recordCashPaymentInTx,
  generateReceiptInTx,
  generateGroupReceiptInTx,
  buildBillGroupSnapshot,
  GroupReceiptBillSnapshot,
} from '../utils/payment-transaction.util.js';
import { paymentVerificationService } from './payment-verification.service.js';

export class PaymentService {
  private client: ReturnType<typeof getPrismaClient>;

  constructor(client?: ReturnType<typeof getPrismaClient>) {
    this.client = client || getPrismaClient();
  }

  /**
   * Tenant creates upload intent for single-bill slip payment
   */
  async createUploadIntent(input: {
    dormitoryId: string;
    tenantId: string;
    actorUserId: string;
    billId: string;
    mimeType: string;
    fileSize: number;
  }) {
    const bill = await this.client.bill.findUnique({
      where: { id: input.billId },
      include: { items: true },
    });

    if (!bill || bill.dormitoryId !== input.dormitoryId) {
      throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'NOT_FOUND');
    }

    if (bill.tenantId !== input.tenantId) {
      throw new AppError('บิลนี้ไม่ได้เป็นของผู้เช่ารายนี้', 403, 'FORBIDDEN_BILL_OWNERSHIP');
    }

    if (bill.status === 'PAID' || bill.status === 'paid') {
      throw new AppError('บิลนี้ได้รับการชำระเงินแล้ว', 400, 'ALREADY_PAID');
    }

    const activePayment = await this.client.payment.findFirst({
      where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
    });
    if (activePayment) {
      throw new AppError('มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว', 409, 'ACTIVE_REVIEW_EXISTS');
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const intent = await this.client.paymentUploadIntent.create({
      data: {
        authenticatedUserId: input.actorUserId,
        tenantId: input.tenantId,
        dormitoryId: input.dormitoryId,
        billId: input.billId,
        expectedMimeType: input.mimeType,
        expectedSize: input.fileSize,
        expiresAt,
        status: 'CREATED',
      },
    });

    return {
      intentId: intent.id,
      uploadUrl: `/api/v1/payments/slip/upload/${intent.id}`,
      expiresAt,
    };
  }

  /**
   * Tenant submits single slip payment referencing intent
   * Decision C: Does NOT mutate Bill.status to UNDER_REVIEW.
   */
  async submitSlip(input: {
    dormitoryId: string;
    tenantId: string;
    intentId: string;
    paymentDate: Date;
    amount: string | number;
    actorUserId: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.actorUserId,
      operation: 'submitSlip',
      idempotencyKey: input.idempotencyKey,
      payload: { intentId: input.intentId },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const intent = await tx.paymentUploadIntent.findUnique({
            where: { id: input.intentId },
            include: { bill: true },
          });

          if (!intent) throw new AppError('ไม่พบข้อมูลการอัพโหลดสลิป', 404, 'INTENT_NOT_FOUND');
          if (intent.status !== 'UPLOADED') throw new AppError('สถานะการอัพโหลดไม่ถูกต้อง', 400, 'INTENT_INVALID_STATE');
          if (intent.authenticatedUserId !== input.actorUserId || intent.tenantId !== input.tenantId) {
            throw new AppError('ไม่มีสิทธิ์ดำเนินการกับรายการนี้', 403, 'FORBIDDEN_INTENT_MISMATCH');
          }
          if (!intent.billId || !intent.bill) throw new AppError('รายการอัพโหลดนี้ไม่มีข้อมูลบิล', 400, 'INTENT_NO_BILL');
          if (intent.expiresAt < new Date()) throw new AppError('รายการอัพโหลดหมดอายุแล้ว', 400, 'INTENT_EXPIRED');

          // 1. Lock target bill
          await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${intent.billId}::uuid FOR UPDATE`;
          const bill = await tx.bill.findUnique({
            where: { id: intent.billId },
            include: { items: true },
          });
          if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'BILL_NOT_FOUND');

          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          const totalAmount = bill.totalAmount !== undefined && bill.totalAmount !== null
            ? new Decimal(bill.totalAmount.toString())
            : bill.items.reduce((sum: Decimal, item: any) => sum.plus(new Decimal(item.amount.toString())), new Decimal(0));

          const existingPaidAmount = bill.paidAmount !== undefined && bill.paidAmount !== null
            ? new Decimal(bill.paidAmount.toString())
            : new Decimal('0.00');

          const currentOutstanding = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
            ? new Decimal(bill.outstandingAmount.toString())
            : Decimal.max(totalAmount.minus(existingPaidAmount), new Decimal(0));

          if (bill.status === 'PAID' || bill.status === 'paid' || currentOutstanding.lessThanOrEqualTo(0)) {
            throw new AppError('บิลนี้ได้รับการชำระเงินแล้ว', 400, 'ALREADY_PAID');
          }

          const activePayment = await tx.payment.findFirst({
            where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
          });
          if (activePayment) {
            throw new AppError('มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว', 409, 'ACTIVE_REVIEW_EXISTS');
          }

          if (intent.sha256) {
            const existingVerification = await tx.paymentEvidenceVerification.findFirst({
              where: { payloadHash: intent.sha256 },
            });
            if (existingVerification) {
              throw new AppError('มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว', 409, 'DUPLICATE_PAYMENT_EVIDENCE');
            }
          }

          const submitAmount = new Decimal(input.amount);
          if (submitAmount.lessThanOrEqualTo(0)) {
            throw new AppError('ยอดเงินที่ชำระต้องมากกว่า 0', 400, 'UNSUPPORTED_AMOUNT');
          }
          if (submitAmount.greaterThan(currentOutstanding)) {
            throw new AppError(
              'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก',
              400,
              'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING'
            );
          }

          // 2. Create Payment record (PENDING/UNDER_REVIEW)
          const payment = await tx.payment.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              tenantId: input.tenantId,
              method: 'BANK_TRANSFER',
              amount: new Prisma.Decimal(submitAmount.toFixed(2)),
              status: 'UNDER_REVIEW',
              paymentDate: input.paymentDate,
              evidenceUrl: intent.objectKey,
              fileHash: intent.sha256,
              idempotencyKey: input.idempotencyKey || null,
              metadata: { intentId: input.intentId },
            },
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: null,
              toStatus: 'UNDER_REVIEW',
              changedByUserId: input.actorUserId,
            },
          });

          // 3. Record untrusted verification metadata (Decision C)
          await paymentVerificationService.recordVerificationInTx(tx, {
            dormitoryId: input.dormitoryId,
            paymentId: payment.id,
            result: {
              provider: 'NONE',
              status: 'UNVERIFIED',
              claimedTransferAt: input.paymentDate,
              verifiedTransferAt: null,
              verifiedAmount: null,
              providerReference: null,
              payloadHash: intent.sha256,
            },
          });

          // CRITICAL DECISION C: DO NOT MUTATE Bill.status TO UNDER_REVIEW
          // Bill remains its true financial state (UNPAID or PARTIALLY_PAID).

          // 4. Consume intent
          await tx.paymentUploadIntent.update({
            where: { id: intent.id },
            data: { status: 'CONSUMED', consumedAt: new Date() },
          });

          return payment;
        });
      },
    });
  }

  /**
   * Owner records cash payment directly (STRICTLY SINGLE-BILL)
   */
  async recordCash(input: {
    dormitoryId: string;
    billId: string;
    amount: string | number;
    userId: string;
    idempotencyKey?: string | null;
    paymentDate?: Date;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'recordCash',
      idempotencyKey: input.idempotencyKey,
      payload: { billId: input.billId, amount: input.amount },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          return await recordCashPaymentInTx(tx, {
            dormitoryId: input.dormitoryId,
            billId: input.billId,
            amount: input.amount,
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
            paymentDate: input.paymentDate,
          });
        });
      },
    });
  }

  /**
   * Tenant creates upload intent for paying multiple bills combined with 1 slip
   */
  async createCombinedUploadIntent(input: {
    dormitoryId: string;
    tenantId: string;
    actorUserId: string;
    billIds: string[];
    mimeType: string;
    fileSize: number;
  }) {
    const bills = await this.client.bill.findMany({
      where: { id: { in: input.billIds }, dormitoryId: input.dormitoryId },
      include: { items: true },
    });

    if (bills.length !== input.billIds.length) {
      throw new AppError('พบรายการบิลไม่ครบถ้วน', 404, 'NOT_FOUND');
    }

    const firstRoomId = bills[0]?.roomId;
    for (const bill of bills) {
      if (bill.tenantId !== input.tenantId) throw new AppError('บิลนี้ไม่ได้เป็นของผู้เช่ารายนี้', 403, 'FORBIDDEN_BILL_OWNERSHIP');
      if (bill.roomId !== firstRoomId) throw new AppError('ไม่อนุญาตให้รวมบิลข้ามห้องพัก', 400, 'FORBIDDEN_CROSS_ROOM');
      if (bill.status === 'PAID' || bill.status === 'paid') throw new AppError('บิลนี้ได้รับการชำระเงินแล้ว', 400, 'ALREADY_PAID');
    }

    Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
    let totalGroupAmount = new Decimal(0);
    for (const bill of bills) {
      const billOutstanding = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
        ? new Decimal(bill.outstandingAmount.toString())
        : new Decimal(bill.totalAmount.toString());
      totalGroupAmount = totalGroupAmount.plus(billOutstanding);
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    return await this.client.$transaction(async (tx) => {
      const group = await tx.combinedPaymentGroup.create({
        data: {
          dormitoryId: input.dormitoryId,
          tenantId: input.tenantId,
          totalAmount: new Prisma.Decimal(totalGroupAmount.toFixed(2)),
          method: 'BANK_TRANSFER',
          status: 'PENDING',
          paymentDate: new Date(),
        },
      });

      // Create durable relational target records
      let order = 1;
      for (const bill of bills) {
        await tx.combinedPaymentGroupBillTarget.create({
          data: {
            dormitoryId: input.dormitoryId,
            paymentGroupId: group.id,
            billId: bill.id,
            targetOrder: order++,
          },
        });
      }

      const intent = await tx.paymentUploadIntent.create({
        data: {
          authenticatedUserId: input.actorUserId,
          tenantId: input.tenantId,
          dormitoryId: input.dormitoryId,
          paymentGroupId: group.id,
          expectedMimeType: input.mimeType,
          expectedSize: input.fileSize,
          expiresAt,
          status: 'CREATED',
        },
      });

      return {
        groupId: group.id,
        intentId: intent.id,
        totalAmount: totalGroupAmount.toFixed(2),
        uploadUrl: `/api/v1/payments/slip/upload/${intent.id}`,
        expiresAt,
      };
    });
  }

  /**
   * Tenant submits combined slip payment referencing intent
   * Enforces:
   * 1. SUM(child Payment.amount) == Group.totalAmount == actual submitted slip amount.
   * 2. DO NOT mutate Bill.status to UNDER_REVIEW (Bills remain UNPAID or PARTIALLY_PAID).
   * 3. Record untrusted verification metadata.
   */
  async submitCombinedSlipPayment(input: {
    dormitoryId: string;
    tenantId: string;
    intentId: string;
    paymentDate: Date;
    amount: string | number;
    actorUserId: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.actorUserId,
      operation: 'submitCombinedSlipPayment',
      idempotencyKey: input.idempotencyKey,
      payload: { intentId: input.intentId },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const intent = await tx.paymentUploadIntent.findUnique({
            where: { id: input.intentId },
            include: { paymentGroup: true },
          });

          if (!intent) throw new AppError('ไม่พบข้อมูลการอัพโหลดสลิป', 404, 'INTENT_NOT_FOUND');
          if (intent.status !== 'UPLOADED') throw new AppError('สถานะการอัพโหลดไม่ถูกต้อง', 400, 'INTENT_INVALID_STATE');
          if (intent.authenticatedUserId !== input.actorUserId || intent.tenantId !== input.tenantId) {
            throw new AppError('ไม่มีสิทธิ์ดำเนินการกับรายการนี้', 403, 'FORBIDDEN_INTENT_MISMATCH');
          }
          if (!intent.paymentGroupId || !intent.paymentGroup) {
            throw new AppError('รายการอัพโหลดนี้ไม่ใช่รายการรวมบิล', 400, 'INTENT_NOT_COMBINED');
          }
          if (intent.expiresAt < new Date()) throw new AppError('รายการอัพโหลดหมดอายุแล้ว', 400, 'INTENT_EXPIRED');

          const group = intent.paymentGroup;
          const submitAmount = new Decimal(input.amount);

          if (submitAmount.lessThanOrEqualTo(0)) {
            throw new AppError('จำนวนเงินที่ชำระต้องมากกว่า 0', 400, 'UNSUPPORTED_AMOUNT');
          }

          // 1. Load target bills via GroupBillTargets
          const targets = await tx.combinedPaymentGroupBillTarget.findMany({
            where: { paymentGroupId: group.id },
            orderBy: { targetOrder: 'asc' },
          });

          const targetBillIds = targets.map((t: any) => t.billId);
          if (targetBillIds.length === 0) {
            throw new AppError('ไม่พบรายการบิลเป้าหมายสำหรับการรวมจ่าย', 400, 'NO_ELIGIBLE_BILLS');
          }

          // Deterministic lock on all affected bills
          const sortedBillIds = [...targetBillIds].sort();
          for (const bid of sortedBillIds) {
            await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
          }

          const bills = await tx.bill.findMany({
            where: { id: { in: sortedBillIds } },
            include: {
              items: true,
              billingCycle: true,
              room: true,
              tenant: true,
              allocations: true,
              Payment: {
                where: { status: { in: ['PENDING', 'UNDER_REVIEW'] } },
              },
            },
          });

          if (bills.length !== sortedBillIds.length) {
            throw new AppError('พบรายการบิลไม่ครบถ้วน', 404, 'BILL_NOT_FOUND');
          }

          // Active payment guard: fail closed if any bill has an active pending payment
          for (const b of bills) {
            const hasOtherPending = (b.Payment || []).some(
              (p: any) => p.paymentGroupId !== group.id
            );
            if (hasOtherPending) {
              throw new AppError('มีรายการชำระเงินที่รอตรวจสอบสำหรับบิลในกลุ่มนี้แล้ว', 409, 'PAYMENT_IN_PROGRESS');
            }
          }

          const firstRoomId = bills[0].roomId;
          const firstTenantId = bills[0].tenantId;

          // Scope check
          for (const b of bills) {
            if (b.roomId !== firstRoomId) {
              throw new AppError('ไม่อนุญาตให้จัดสรรการชำระเงินข้ามห้องพัก', 400, 'FORBIDDEN_CROSS_ROOM');
            }
          }

          // Compute canonical allocation plan
          const allocationPlan = computeCanonicalAllocationPlan({
            submitAmount,
            targetRoomId: firstRoomId,
            targetTenantId: firstTenantId,
            eligibleBills: bills.map((b) => {
              const allAllocSum = (b.allocations || []).reduce(
                (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
                new Decimal(0)
              );
              const paidAmt = new Decimal(b.paidAmount?.toString() || '0');
              const legacyUnallocatedPaidAmount = Decimal.max(paidAmt.minus(allAllocSum), new Decimal(0));

              return {
                id: b.id,
                dormitoryId: b.dormitoryId,
                roomId: b.roomId,
                tenantId: b.tenantId,
                billNumber: b.billNumber,
                billKind: b.billKind,
                status: b.status,
                billingDate: b.billingDate,
                dueDate: b.dueDate,
                totalAmount: b.totalAmount,
                paidAmount: b.paidAmount,
                outstandingAmount: b.outstandingAmount,
                legacyUnallocatedPaidAmount,
                billingCycleId: b.billingCycleId,
                billingCycle: b.billingCycle,
                items: (b.items || []).map((it) => {
                  const itemAllocated = (b.allocations || [])
                    .filter((a: any) => a.billItemId === it.id)
                    .reduce((sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())), new Decimal(0));
                  return {
                    id: it.id,
                    type: it.type,
                    code: it.code,
                    description: it.description,
                    amount: it.amount,
                    displayOrder: it.displayOrder,
                    allocatedAmount: itemAllocated,
                  };
                }),
              };
            }),
          });

          if (intent.sha256) {
            const existingVerification = await tx.paymentEvidenceVerification.findFirst({
              where: { payloadHash: intent.sha256 },
            });
            if (existingVerification) {
              throw new AppError('มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว', 409, 'DUPLICATE_PAYMENT_EVIDENCE');
            }
          }

          // 2. Update CombinedPaymentGroup
          await tx.combinedPaymentGroup.update({
            where: { id: group.id },
            data: {
              totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
              status: 'UNDER_REVIEW',
              paymentDate: input.paymentDate,
            },
          });

          // 3. Create child Payments ONLY for bills receiving non-zero allocation
          // SUM(child Payment.amount) == Group.totalAmount
          const now = new Date();
          for (const aff of allocationPlan.affectedBills) {
            if (aff.allocatedAmount.greaterThan(0)) {
              const payment = await tx.payment.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  billId: aff.id,
                  tenantId: input.tenantId,
                  paymentGroupId: group.id,
                  method: 'BANK_TRANSFER',
                  amount: new Prisma.Decimal(aff.allocatedAmount.toFixed(2)),
                  status: 'UNDER_REVIEW',
                  paymentDate: input.paymentDate,
                  evidenceUrl: intent.objectKey,
                  fileHash: intent.sha256 ? `${intent.sha256}-${aff.id}` : null,
                  metadata: { intentId: input.intentId, groupId: group.id },
                },
              });

              await tx.paymentStatusHistory.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  paymentId: payment.id,
                  fromStatus: null,
                  toStatus: 'UNDER_REVIEW',
                  changedByUserId: input.actorUserId,
                  effectiveAt: now,
                },
              });
            }
          }

          // 4. Record untrusted verification metadata for group (Decision C)
          await paymentVerificationService.recordVerificationInTx(tx, {
            dormitoryId: input.dormitoryId,
            paymentGroupId: group.id,
            result: {
              provider: 'NONE',
              status: 'UNVERIFIED',
              claimedTransferAt: input.paymentDate,
              verifiedTransferAt: null,
              verifiedAmount: null,
              providerReference: null,
              payloadHash: intent.sha256,
            },
          });

          // CRITICAL DECISION C: DO NOT MUTATE Bill.status TO UNDER_REVIEW
          // Bills remain their true financial state (UNPAID or PARTIALLY_PAID).

          // 5. Consume intent
          await tx.paymentUploadIntent.update({
            where: { id: intent.id },
            data: {
              status: 'CONSUMED',
              consumedAt: now,
            },
          });

          return { success: true, groupId: group.id };
        });
      },
    });
  }

  /**
   * Owner approves combined payment group atomically (Review Authority: Group)
   */
  async approvePaymentGroup(input: {
    dormitoryId: string;
    groupId: string;
    userId: string;
    notes?: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'approvePaymentGroup',
      idempotencyKey: input.idempotencyKey,
      payload: { groupId: input.groupId },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          // 1. Lock Group row
          if (typeof tx.$executeRaw === 'function') {
            await tx.$executeRaw`SELECT "id" FROM "combined_payment_groups" WHERE "id" = ${input.groupId}::uuid FOR UPDATE`;
          }

          const group = await tx.combinedPaymentGroup.findUnique({
            where: { id: input.groupId },
            include: {
              payments: true,
              billTargets: true,
              tenant: true,
            },
          });

          if (!group || group.dormitoryId !== input.dormitoryId) {
            throw new AppError('ไม่พบกลุ่มรายการชำระเงิน', 404, 'COMBINED_GROUP_NOT_FOUND');
          }

          if (group.status === 'APPROVED') {
            return { success: true, group };
          }
          if (group.status !== 'PENDING' && group.status !== 'UNDER_REVIEW') {
            throw new AppError('สถานะกลุ่มรายการไม่ถูกต้องสำหรับการอนุมัติ', 400, 'INVALID_GROUP_STATE');
          }

          // 2. Deterministically lock all target Bills
          const targetBillIds = [...new Set([
            ...group.billTargets.map((t: any) => t.billId),
            ...group.payments.map((p: any) => p.billId),
          ])].sort();

          for (const bid of targetBillIds) {
            await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
          }

          // 3. Re-read fresh state after locks
          const bills = await tx.bill.findMany({
            where: { id: { in: targetBillIds } },
            include: {
              items: {
                orderBy: { displayOrder: 'asc' },
              },
              billingCycle: true,
              room: true,
              tenant: true,
              allocations: true,
            },
          });

          const firstRoomId = bills[0]?.roomId;
          const firstTenantId = bills[0]?.tenantId || group.tenantId;

          // 4. Recompute canonical allocation plan with fresh state
          const groupTotal = new Decimal(group.totalAmount.toString());
          let allocationPlan;
          try {
            allocationPlan = computeCanonicalAllocationPlan({
            submitAmount: groupTotal,
            targetRoomId: firstRoomId,
            targetTenantId: firstTenantId,
            eligibleBills: bills.map((b) => {
              const allAllocSum = (b.allocations || []).reduce(
                (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
                new Decimal(0)
              );
              const paidAmt = new Decimal(b.paidAmount?.toString() || '0');
              const legacyUnallocatedPaidAmount = Decimal.max(paidAmt.minus(allAllocSum), new Decimal(0));

              return {
                id: b.id,
                dormitoryId: b.dormitoryId,
                roomId: b.roomId,
                tenantId: b.tenantId,
                billNumber: b.billNumber,
                billKind: b.billKind,
                status: b.status,
                billingDate: b.billingDate,
                dueDate: b.dueDate,
                totalAmount: b.totalAmount,
                paidAmount: b.paidAmount,
                outstandingAmount: b.outstandingAmount,
                legacyUnallocatedPaidAmount,
                billingCycleId: b.billingCycleId,
                billingCycle: b.billingCycle,
                items: (b.items || []).map((it) => {
                  const itemAllocated = (b.allocations || [])
                    .filter((a: any) => a.billItemId === it.id)
                    .reduce((sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())), new Decimal(0));
                  return {
                    id: it.id,
                    type: it.type,
                    code: it.code,
                    description: it.description,
                    amount: it.amount,
                    displayOrder: it.displayOrder,
                    allocatedAmount: itemAllocated,
                  };
                }),
              };
            }),
          });
          } catch (err: any) {
            throw new AppError(
              'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
              400,
              'GROUP_ALLOCATION_RECONCILIATION_FAILED'
            );
          }

          // 5. Strict Reconciliation Check (P0-C)
          const pendingChildPayments = group.payments.filter(
            (p: any) => p.status === 'PENDING' || p.status === 'UNDER_REVIEW'
          );

          const sumPendingChildAmounts = pendingChildPayments.reduce(
            (sum: Decimal, p: any) => sum.plus(new Decimal(p.amount.toString())),
            new Decimal(0)
          );

          // Check 1: SUM(pending child Payment.amount) == group.totalAmount
          if (!sumPendingChildAmounts.equals(groupTotal)) {
            throw new AppError(
              'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
              400,
              'GROUP_ALLOCATION_RECONCILIATION_FAILED'
            );
          }

          // Check 2: fresh totalAllocated == group.totalAmount
          if (!allocationPlan.totalAllocated.equals(groupTotal)) {
            throw new AppError(
              'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
              400,
              'GROUP_ALLOCATION_RECONCILIATION_FAILED'
            );
          }

          // Check 3: set of pending child billIds == set of fresh affected billIds
          const pendingBillIds = [...new Set(pendingChildPayments.map((p: any) => p.billId))].sort();
          const affectedBillIds = [...new Set(allocationPlan.affectedBills.map((b) => b.id))].sort();
          if (
            pendingBillIds.length !== affectedBillIds.length ||
            !pendingBillIds.every((id, idx) => id === affectedBillIds[idx])
          ) {
            throw new AppError(
              'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
              400,
              'GROUP_ALLOCATION_RECONCILIATION_FAILED'
            );
          }

          // Check 4: For every affected Bill: pending child Payment.amount == fresh per-Bill allocatedAmount
          for (const aff of allocationPlan.affectedBills) {
            const childPayment = pendingChildPayments.find((p: any) => p.billId === aff.id);
            if (!childPayment) {
              throw new AppError(
                'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
                400,
                'GROUP_ALLOCATION_RECONCILIATION_FAILED'
              );
            }
            const childAmount = new Decimal(childPayment.amount.toString());
            if (!childAmount.equals(aff.allocatedAmount)) {
              throw new AppError(
                'ยอดคงเหลือของบิลมีการเปลี่ยนแปลงหลังส่งสลิป กรุณาตรวจสอบรายการใหม่ก่อนอนุมัติ',
                400,
                'GROUP_ALLOCATION_RECONCILIATION_FAILED'
              );
            }
          }

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          // 6. Update CombinedPaymentGroup
          const updatedGroup = await tx.combinedPaymentGroup.update({
            where: { id: group.id },
            data: {
              status: 'APPROVED',
              recordedByUserId: safeUserId,
              notes: input.notes || group.notes,
            },
          });

          // 7. Update child Payments and create PaymentAllocations
          for (const aff of allocationPlan.affectedBills) {
            const billAllocations = allocationPlan.allocations.filter((a) => a.billId === aff.id);
            let payment = group.payments.find((p: any) => p.billId === aff.id);

            if (payment) {
              await tx.payment.update({
                where: { id: payment.id },
                data: {
                  status: 'APPROVED',
                  reviewedByUserId: safeUserId,
                  reviewedAt: now,
                },
              });
              await tx.paymentStatusHistory.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  paymentId: payment.id,
                  fromStatus: payment.status,
                  toStatus: 'APPROVED',
                  changedByUserId: safeUserId,
                  effectiveAt: now,
                },
              });
            } else {
              payment = await tx.payment.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  billId: aff.id,
                  tenantId: firstTenantId,
                  paymentGroupId: group.id,
                  method: group.method || 'BANK_TRANSFER',
                  amount: new Prisma.Decimal(aff.allocatedAmount.toFixed(2)),
                  status: 'APPROVED',
                  paymentDate: group.paymentDate || now,
                  reviewedByUserId: safeUserId,
                  reviewedAt: now,
                },
              });
              await tx.paymentStatusHistory.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  paymentId: payment.id,
                  fromStatus: null,
                  toStatus: 'APPROVED',
                  changedByUserId: safeUserId,
                  effectiveAt: now,
                },
              });
            }

            for (const alloc of billAllocations) {
              await tx.paymentAllocation.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  paymentGroupId: group.id,
                  paymentId: payment.id,
                  billId: aff.id,
                  billItemId: alloc.billItemId || null,
                  allocatedAmount: new Prisma.Decimal(alloc.allocatedAmount.toFixed(2)),
                  allocationOrder: alloc.allocationOrder,
                },
              });
            }

            const targetBill = bills.find((b) => b.id === aff.id)!;
            const preStatus = targetBill.status;

            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: aff.id,
                fromStatus: preStatus,
                toStatus: aff.newStatus,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });

            await tx.bill.update({
              where: { id: aff.id },
              data: {
                status: aff.newStatus,
                previousStatus: preStatus,
                paidAt: aff.newStatus === 'PAID' ? now : (targetBill.paidAt ?? null),
                paidAmount: new Prisma.Decimal(aff.newPaidAmount.toFixed(2)),
                outstandingAmount: new Prisma.Decimal(aff.newOutstandingAmount.toFixed(2)),
              },
            });
          }

          // 8. Generate exactly ONE Group Receipt with rich per-bill gross items snapshot
          const roomNumber = bills[0]?.room?.roomNumber || 'GEN';
          const tenantDisplayName = group.tenant?.displayName || group.tenant?.firstName
            ? `${group.tenant.firstName || ''} ${group.tenant.lastName || ''}`.trim()
            : 'ผู้เช่า';

          const billGroups: GroupReceiptBillSnapshot[] = allocationPlan.affectedBills.map((aff) => {
            const targetBill = bills.find((b) => b.id === aff.id)!;
            return buildBillGroupSnapshot(targetBill, aff.allocatedAmount);
          });

          const receipt = await generateGroupReceiptInTx({
            tx,
            dormitoryId: input.dormitoryId,
            paymentGroupId: group.id,
            totalAmount: groupTotal,
            receiptItems: allocationPlan.receiptItems,
            billGroups,
            userId: safeUserId,
            roomNumber,
            tenantName: tenantDisplayName,
            paymentMethod: group.method || 'BANK_TRANSFER',
            paymentDate: group.paymentDate,
          });

          return {
            group: updatedGroup,
            receipt,
            affectedBills: allocationPlan.affectedBills,
          };
        });
      },
    });
  }

  /**
   * Owner rejects combined payment group atomically
   */
  async rejectPaymentGroup(input: {
    dormitoryId: string;
    groupId: string;
    userId: string;
    reason: string;
    notes?: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'rejectPaymentGroup',
      idempotencyKey: input.idempotencyKey,
      payload: { groupId: input.groupId, reason: input.reason },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          if (typeof tx.$executeRaw === 'function') {
            await tx.$executeRaw`SELECT "id" FROM "combined_payment_groups" WHERE "id" = ${input.groupId}::uuid FOR UPDATE`;
          }
          const group = await tx.combinedPaymentGroup.findUnique({
            where: { id: input.groupId },
            include: {
              payments: true,
              billTargets: true,
            },
          });

          if (!group || group.dormitoryId !== input.dormitoryId) {
            throw new AppError('ไม่พบกลุ่มรายการชำระเงิน', 404, 'COMBINED_GROUP_NOT_FOUND');
          }
          if (group.status === 'REJECTED') {
            return { success: true, group };
          }
          if (group.status !== 'PENDING' && group.status !== 'UNDER_REVIEW') {
            throw new AppError('สถานะกลุ่มรายการไม่ถูกต้องสำหรับการปฏิเสธ', 400, 'INVALID_GROUP_STATE');
          }

          const targetBillIds = [...new Set([
            ...group.billTargets.map((t: any) => t.billId),
            ...group.payments.map((p: any) => p.billId),
          ])].sort();

          for (const bid of targetBillIds) {
            await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
          }

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          await tx.combinedPaymentGroup.update({
            where: { id: group.id },
            data: {
              status: 'REJECTED',
              notes: input.notes || `Rejected: ${input.reason}`,
            },
          });

          for (const p of group.payments) {
            await tx.payment.update({
              where: { id: p.id },
              data: {
                status: 'REJECTED',
                reviewedByUserId: safeUserId,
                reviewedAt: now,
                rejectedReason: input.reason,
              },
            });
            await tx.paymentStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                paymentId: p.id,
                fromStatus: p.status,
                toStatus: 'REJECTED',
                reason: input.reason,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });
          }

          // DECISION C: Bill balances/status were never mutated during review,
          // so rejection leaves Bill financial state untouched.

          return { success: true, groupId: group.id };
        });
      },
    });
  }

  /**
   * Owner reverses an entire combined payment group atomically
   */
  async reversePaymentGroup(input: {
    dormitoryId: string;
    groupId: string;
    userId: string;
    reason: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'reversePaymentGroup',
      idempotencyKey: input.idempotencyKey,
      payload: { groupId: input.groupId, reason: input.reason },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          if (typeof tx.$executeRaw === 'function') {
            await tx.$executeRaw`SELECT "id" FROM "combined_payment_groups" WHERE "id" = ${input.groupId}::uuid FOR UPDATE`;
          }
          const group = await tx.combinedPaymentGroup.findUnique({
            where: { id: input.groupId },
            include: {
              payments: true,
              billTargets: true,
              receipts: true,
            },
          });

          if (!group || group.dormitoryId !== input.dormitoryId) {
            throw new AppError('ไม่พบกลุ่มรายการชำระเงิน', 404, 'COMBINED_GROUP_NOT_FOUND');
          }
          if (group.status !== 'APPROVED') {
            throw new AppError('สามารถยกเลิกได้เฉพาะกลุ่มรายการที่อนุมัติแล้วเท่านั้น', 400, 'INVALID_GROUP_STATE');
          }

          const targetBillIds = [...new Set([
            ...group.billTargets.map((t: any) => t.billId),
            ...group.payments.map((p: any) => p.billId),
          ])].sort();

          for (const bid of targetBillIds) {
            await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
          }

          const bills = await tx.bill.findMany({
            where: { id: { in: targetBillIds } },
            include: { allocations: true },
          });

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          // 1. Mark Group REVERSED
          await tx.combinedPaymentGroup.update({
            where: { id: group.id },
            data: {
              status: 'REVERSED',
              notes: `Reversed: ${input.reason}`,
            },
          });

          // 2. Mark child payments REVERSED
          for (const p of group.payments) {
            await tx.payment.update({
              where: { id: p.id },
              data: {
                status: 'REVERSED',
                reversedByUserId: safeUserId,
                reversedAt: now,
                reversalReason: input.reason,
              },
            });
            await tx.paymentStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                paymentId: p.id,
                fromStatus: p.status,
                toStatus: 'REVERSED',
                reason: input.reason,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });
          }

          // 3. Void Group Receipts
          const receipts = await tx.receipt.findMany({
            where: { paymentGroupId: group.id },
          });
          for (const r of receipts) {
            await tx.receipt.update({
              where: { id: r.id },
              data: {
                isVoided: true,
                voidedAt: now,
                voidedByUserId: safeUserId,
                voidReason: input.reason,
              },
            });
          }

          // 4. Delete group allocations and recalculate each affected bill with legacy baseline preservation
          for (const bill of bills) {
            const allAllocationsBefore = bill.allocations || [];
            const totalAllocBefore = allAllocationsBefore.reduce(
              (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
              new Decimal(0)
            );
            const currentPaid = new Decimal(bill.paidAmount?.toString() || '0');
            const legacyBaseline = Decimal.max(currentPaid.minus(totalAllocBefore), new Decimal(0));

            // Delete allocations for this group
            await tx.paymentAllocation.deleteMany({
              where: { billId: bill.id, paymentGroupId: group.id },
            });

            // Remaining allocations
            const remainingAllocations = await tx.paymentAllocation.findMany({
              where: { billId: bill.id },
            });
            const remainingAllocatedSum = remainingAllocations.reduce(
              (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
              new Decimal(0)
            );

            const newPaid = legacyBaseline.plus(remainingAllocatedSum);
            const billTotal = new Decimal(bill.totalAmount.toString());
            const newOutstanding = Decimal.max(billTotal.minus(newPaid), new Decimal(0));
            const newStatus = newPaid.equals(0)
              ? (bill.previousStatus || 'UNPAID')
              : (newOutstanding.equals(0) ? 'PAID' : 'PARTIALLY_PAID');

            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: bill.status,
                toStatus: newStatus,
                reason: `Group Reversal: ${input.reason}`,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: newStatus,
                paidAmount: new Prisma.Decimal(newPaid.toFixed(2)),
                outstandingAmount: new Prisma.Decimal(newOutstanding.toFixed(2)),
                paidAt: newStatus === 'PAID' ? bill.paidAt : null,
              },
            });
          }

          return { success: true, groupId: group.id };
        });
      },
    });
  }

  /**
   * Owner approves single pending payment
   */
  async approvePayment(input: {
    dormitoryId: string;
    paymentId: string;
    userId: string;
    notes?: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'approvePayment',
      idempotencyKey: input.idempotencyKey,
      payload: { paymentId: input.paymentId },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          const payment = await tx.payment.findUnique({
            where: { id: input.paymentId },
          });

          if (!payment || payment.dormitoryId !== input.dormitoryId) {
            throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');
          }

          // If grouped payment, require group approval
          if (payment.paymentGroupId) {
            throw new AppError('รายการนี้เป็นส่วนหนึ่งของการรวมจ่าย กรุณาอนุมัติทั้งกลุ่มรายการ', 400, 'GROUP_APPROVAL_REQUIRED');
          }

          if (payment.status === 'APPROVED') return payment;
          if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') {
            throw new AppError('สถานะรายการไม่ถูกต้อง', 400, 'INVALID_STATE');
          }

          await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${payment.billId}::uuid FOR UPDATE`;
          const bill = await tx.bill.findUnique({
            where: { id: payment.billId },
            include: {
              items: true,
              billingCycle: true,
              room: true,
              tenant: true,
              allocations: true,
            },
          });
          if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'BILL_NOT_FOUND');

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          const submitAmount = new Decimal(payment.amount.toString());
          const allAllocSum = (bill.allocations || []).reduce(
            (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
            new Decimal(0)
          );
          const paidAmt = new Decimal(bill.paidAmount?.toString() || '0');
          const legacyUnallocatedPaidAmount = Decimal.max(paidAmt.minus(allAllocSum), new Decimal(0));

          const allocationPlan = computeCanonicalAllocationPlan({
            submitAmount,
            targetRoomId: bill.roomId,
            targetTenantId: bill.tenantId,
            eligibleBills: [
              {
                id: bill.id,
                dormitoryId: bill.dormitoryId,
                roomId: bill.roomId,
                tenantId: bill.tenantId,
                billNumber: bill.billNumber,
                billKind: bill.billKind,
                status: bill.status,
                billingDate: bill.billingDate,
                dueDate: bill.dueDate,
                totalAmount: bill.totalAmount,
                paidAmount: bill.paidAmount,
                outstandingAmount: bill.outstandingAmount,
                legacyUnallocatedPaidAmount,
                billingCycleId: bill.billingCycleId,
                billingCycle: bill.billingCycle,
                items: (bill.items || []).map((it) => {
                  const itemAllocated = (bill.allocations || [])
                    .filter((a: any) => a.billItemId === it.id)
                    .reduce((sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())), new Decimal(0));
                  return {
                    id: it.id,
                    type: it.type,
                    code: it.code,
                    description: it.description,
                    amount: it.amount,
                    displayOrder: it.displayOrder,
                    allocatedAmount: itemAllocated,
                  };
                }),
              },
            ],
          });

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'APPROVED',
              reviewedByUserId: safeUserId,
              reviewedAt: now,
            },
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: payment.status,
              toStatus: 'APPROVED',
              changedByUserId: safeUserId,
              effectiveAt: now,
            },
          });

          for (const alloc of allocationPlan.allocations) {
            await tx.paymentAllocation.create({
              data: {
                dormitoryId: input.dormitoryId,
                paymentGroupId: null,
                paymentId: payment.id,
                billId: bill.id,
                billItemId: alloc.billItemId || null,
                allocatedAmount: new Prisma.Decimal(alloc.allocatedAmount.toFixed(2)),
                allocationOrder: alloc.allocationOrder,
              },
            });
          }

          const aff = allocationPlan.affectedBills[0];
          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: bill.status,
              toStatus: aff.newStatus,
              changedByUserId: safeUserId,
              effectiveAt: now,
            },
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: aff.newStatus,
              previousStatus: bill.status,
              paidAt: aff.newStatus === 'PAID' ? now : (bill.paidAt ?? null),
              paidAmount: new Prisma.Decimal(aff.newPaidAmount.toFixed(2)),
              outstandingAmount: new Prisma.Decimal(aff.newOutstandingAmount.toFixed(2)),
            },
          });

          await generateReceiptInTx(
            tx,
            payment.id,
            input.dormitoryId,
            bill.id,
            safeUserId,
            null,
            submitAmount
          );

          return updatedPayment;
        });
      },
    });
  }

  /**
   * Owner rejects single pending payment
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
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');

          if (payment.paymentGroupId) {
            throw new AppError('รายการนี้เป็นส่วนหนึ่งของการรวมจ่าย กรุณาปฏิเสธทั้งกลุ่มรายการ', 400, 'GROUP_REJECTION_REQUIRED');
          }

          if (payment.status === 'REJECTED') return payment;
          if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new AppError('สถานะรายการไม่ถูกต้อง', 400, 'INVALID_STATE');

          await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${payment.billId}::uuid FOR UPDATE`;
          const bill = await tx.bill.findUnique({ where: { id: payment.billId } });
          if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'BILL_NOT_FOUND');

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REJECTED',
              reviewedByUserId: safeUserId,
              reviewedAt: now,
              rejectedReason: input.reason,
            },
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: payment.status,
              toStatus: 'REJECTED',
              reason: input.reason,
              changedByUserId: safeUserId,
              effectiveAt: now,
            },
          });

          // DECISION C: Bill balances/status were never mutated during review,
          // so single rejection leaves Bill financial state untouched.

          return updatedPayment;
        });
      },
    });
  }

  /**
   * Owner reverses an approved single payment
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
            include: { receipt: true },
          });

          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');

          // If grouped payment, reject individual reversal
          if (payment.paymentGroupId) {
            throw new AppError('ไม่อนุญาตให้ยกเลิกรายการย่อยของการรวมจ่าย กรุณายกเลิกทั้งกลุ่มรายการ', 400, 'GROUP_REVERSAL_REQUIRED');
          }

          if (payment.status !== 'APPROVED') throw new AppError('สามารถยกเลิกได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น', 400, 'INVALID_STATE');

          await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${payment.billId}::uuid FOR UPDATE`;
          const bill = await tx.bill.findUnique({
            where: { id: payment.billId },
            include: { allocations: true },
          });
          if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'BILL_NOT_FOUND');

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          const updatedPayment = await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: 'REVERSED',
              reversedByUserId: safeUserId,
              reversedAt: now,
              reversalReason: input.reason,
            },
          });

          await tx.paymentStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentId: payment.id,
              fromStatus: 'APPROVED',
              toStatus: 'REVERSED',
              reason: input.reason,
              changedByUserId: safeUserId,
              effectiveAt: now,
            },
          });

          if (payment.receipt) {
            await tx.receipt.update({
              where: { id: payment.receipt.id },
              data: {
                isVoided: true,
                voidedAt: now,
                voidedByUserId: safeUserId,
                voidReason: input.reason,
              },
            });
          }

          // Legacy Baseline Preservation:
          const allAllocationsBefore = bill.allocations || [];
          const totalAllocationsBefore = allAllocationsBefore.reduce(
            (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
            new Decimal(0)
          );
          const currentPaid = new Decimal(bill.paidAmount?.toString() || '0');
          const legacyBaseline = Decimal.max(currentPaid.minus(totalAllocationsBefore), new Decimal(0));

          // Delete allocations associated with reversed payment
          await tx.paymentAllocation.deleteMany({
            where: { paymentId: payment.id },
          });

          // Recompute bill balances
          const remainingAllocations = await tx.paymentAllocation.findMany({
            where: { billId: bill.id },
          });

          const remainingAllocatedSum = remainingAllocations.reduce(
            (sum: Decimal, a: any) => sum.plus(new Decimal(a.allocatedAmount.toString())),
            new Decimal(0)
          );

          const newPaid = legacyBaseline.plus(remainingAllocatedSum);
          const billTotal = new Decimal(bill.totalAmount.toString());
          const newOutstanding = Decimal.max(billTotal.minus(newPaid), new Decimal(0));
          const newStatus = newPaid.equals(0)
            ? (bill.previousStatus || 'UNPAID')
            : (newOutstanding.equals(0) ? 'PAID' : 'PARTIALLY_PAID');

          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: bill.status,
              toStatus: newStatus,
              reason: `Reversal: ${input.reason}`,
              changedByUserId: safeUserId,
              effectiveAt: now,
            },
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: newStatus,
              paidAmount: new Prisma.Decimal(newPaid.toFixed(2)),
              outstandingAmount: new Prisma.Decimal(newOutstanding.toFixed(2)),
              paidAt: newStatus === 'PAID' ? bill.paidAt : null,
            },
          });

          return updatedPayment;
        });
      },
    });
  }
}

export const paymentService = new PaymentService();
