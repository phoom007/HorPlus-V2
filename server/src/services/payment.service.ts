/**
 * @license Apache-2.0
 * OWNER R3.8b — Canonical Payment Service (Multi-Bill, Partial, Allocations, Group Receipt)
 */

import { recordCashPaymentInTx, generateReceiptInTx } from '../utils/payment-transaction.util.js';
import { PrismaClient, Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { idempotencyService } from './idempotency.service.js';
import { AppError } from '../types/index.js';
import { computeCanonicalAllocationPlan } from '../utils/allocation.util.js';
import { getPrismaClient } from '../db/prisma.js';

export class PaymentService {
  private client: PrismaClient;

  constructor(client?: PrismaClient) {
    this.client = client || getPrismaClient();
  }

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
        paymentDate: input.paymentDate.toISOString(),
      },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          // 1. Verify upload intent
          const intent = await tx.paymentUploadIntent.findUnique({ where: { id: input.intentId } });
          if (!intent) throw new AppError('ไม่พบข้อมูลการอัพโหลดสลิป', 404, 'INTENT_NOT_FOUND');
          if (intent.status !== 'UPLOADED') throw new AppError('สถานะการอัพโหลดไม่ถูกต้อง', 400, 'INTENT_INVALID_STATE');
          if (
            intent.authenticatedUserId !== input.actorUserId ||
            intent.tenantId !== input.tenantId ||
            (intent.billId && intent.billId !== input.billId)
          ) {
            throw new AppError('ไม่มีสิทธิ์ดำเนินการกับรายการนี้', 403, 'FORBIDDEN_INTENT_MISMATCH');
          }
          if (intent.expiresAt < new Date()) throw new AppError('รายการอัพโหลดหมดอายุแล้ว', 400, 'INTENT_EXPIRED');

          // 2. Lock and verify bill
          await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${input.billId}::uuid FOR UPDATE`;
          const bill = await tx.bill.findUnique({
            where: { id: input.billId },
            include: { items: true, allocations: true },
          });

          if (!bill) throw new AppError('ไม่พบข้อมูลบิลที่ระบุ', 404, 'NOT_FOUND');
          if (bill.dormitoryId !== input.dormitoryId) throw new AppError('ไม่มีสิทธิ์ดำเนินการกับบิลนี้', 403, 'FORBIDDEN');
          if (bill.tenantId !== input.tenantId) throw new AppError('บิลนี้ไม่ได้เป็นของผู้เช่ารายนี้', 403, 'FORBIDDEN_BILL_OWNERSHIP');
          
          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          const currentOutstanding = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
            ? new Decimal(bill.outstandingAmount.toString())
            : new Decimal(bill.totalAmount.toString());

          if (bill.status === 'PAID' || bill.status === 'paid' || currentOutstanding.lessThanOrEqualTo(0)) {
            throw new AppError('บิลนี้ได้รับการชำระเงินครบแล้ว', 400, 'ALREADY_PAID');
          }

          const activePayment = await tx.payment.findFirst({
            where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } },
          });
          if (activePayment) {
            throw new AppError('มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว', 409, 'ACTIVE_REVIEW_EXISTS');
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

          // 3. Create Payment record (PENDING)
          const payment = await tx.payment.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              tenantId: input.tenantId,
              method: 'BANK_TRANSFER',
              amount: new Prisma.Decimal(submitAmount.toFixed(2)),
              status: 'PENDING',
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
              toStatus: 'PENDING',
              changedByUserId: input.actorUserId,
            },
          });

          // Move bill status to UNDER_REVIEW
          const preReviewStatus = bill.status;
          await tx.billStatusHistory.create({
            data: {
              dormitoryId: input.dormitoryId,
              billId: bill.id,
              fromStatus: preReviewStatus,
              toStatus: 'UNDER_REVIEW',
              changedByUserId: input.actorUserId,
            },
          });

          await tx.bill.update({
            where: { id: bill.id },
            data: {
              status: 'UNDER_REVIEW',
              previousStatus: preReviewStatus,
            },
          });

          // Consume intent
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
          return await recordCashPaymentInTx(tx, input);
        });
      },
    });
  }

  /**
   * Owner records cash payment for multiple bills atomically under a CombinedPaymentGroup
   */
  async recordCombinedCash(input: {
    dormitoryId: string;
    billIds: string[];
    amount?: string;
    userId: string;
    notes?: string;
    idempotencyKey?: string | null;
  }) {
    return await idempotencyService.runWithIdempotency({
      actorUserId: input.userId,
      operation: 'recordCombinedCash',
      idempotencyKey: input.idempotencyKey,
      payload: { billIds: input.billIds, amount: input.amount },
      fn: async () => {
        return await this.client.$transaction(async (tx) => {
          if (!input.billIds || input.billIds.length === 0) {
            throw new AppError('ต้องระบุรายการบิลอย่างน้อย 1 รายการ', 400, 'VALIDATION_ERROR');
          }

          // Deterministic row locking
          const sortedBillIds = [...new Set(input.billIds)].sort();
          for (const bid of sortedBillIds) {
            await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
          }

          const bills = await tx.bill.findMany({
            where: { id: { in: sortedBillIds }, dormitoryId: input.dormitoryId },
            include: {
              items: true,
              billingCycle: true,
              room: true,
              tenant: true,
              allocations: true,
            },
          });

          if (bills.length !== sortedBillIds.length) {
            throw new AppError('พบรายการบิลไม่ครบถ้วน', 404, 'BILL_NOT_FOUND');
          }

          const firstRoomId = bills[0].roomId;
          const firstTenantId = bills[0].tenantId;

          // Scope check: ALL bills must belong to same roomId
          for (const bill of bills) {
            if (bill.roomId !== firstRoomId) {
              throw new AppError('ไม่อนุญาตให้จัดสรรการชำระเงินข้ามห้องพัก', 400, 'FORBIDDEN_CROSS_ROOM');
            }
          }

          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          let totalOutstanding = new Decimal(0);
          for (const b of bills) {
            totalOutstanding = totalOutstanding.plus(new Decimal(b.outstandingAmount.toString()));
          }

          const submitAmount = input.amount ? new Decimal(input.amount) : totalOutstanding;

          const allocationPlan = computeCanonicalAllocationPlan({
            submitAmount,
            targetRoomId: firstRoomId,
            targetTenantId: firstTenantId,
            eligibleBills: bills.map((b) => ({
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
            })),
          });

          const now = new Date();
          const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
            ? input.userId
            : null;

          // 1. Create CombinedPaymentGroup
          const group = await tx.combinedPaymentGroup.create({
            data: {
              dormitoryId: input.dormitoryId,
              tenantId: firstTenantId,
              totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
              method: 'CASH',
              status: 'APPROVED',
              paymentDate: now,
              recordedByUserId: safeUserId,
              notes: input.notes || null,
              idempotencyKey: input.idempotencyKey,
            },
          });

          // 2. Create Payment records and Allocations
          const createdPayments: any[] = [];
          for (const aff of allocationPlan.affectedBills) {
            const billAllocations = allocationPlan.allocations.filter((a) => a.billId === aff.id);
            const billPayment = await tx.payment.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: aff.id,
                tenantId: firstTenantId,
                paymentGroupId: group.id,
                method: 'CASH',
                amount: new Prisma.Decimal(aff.allocatedAmount.toFixed(2)),
                status: 'APPROVED',
                paymentDate: now,
                reviewedByUserId: safeUserId,
                reviewedAt: now,
                idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}-${aff.id}` : undefined,
              },
            });

            await tx.paymentStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                paymentId: billPayment.id,
                fromStatus: null,
                toStatus: 'APPROVED',
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });

            for (const alloc of billAllocations) {
              await tx.paymentAllocation.create({
                data: {
                  dormitoryId: input.dormitoryId,
                  paymentGroupId: group.id,
                  paymentId: billPayment.id,
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
                paidAt: aff.newStatus === 'PAID' ? now : targetBill.paidAt,
                paidAmount: new Prisma.Decimal(aff.newPaidAmount.toFixed(2)),
                outstandingAmount: new Prisma.Decimal(aff.newOutstandingAmount.toFixed(2)),
                paymentGroupId: group.id,
              },
            });

            createdPayments.push(billPayment);
          }

          // 3. Generate 1 canonical Receipt for the entire group
          const receipt = await generateReceiptInTx(
            tx,
            createdPayments[0]?.id || null,
            input.dormitoryId,
            bills[0]?.id || null,
            safeUserId,
            group.id,
            submitAmount
          );

          return {
            group,
            payments: createdPayments,
            receipt,
            affectedBills: allocationPlan.affectedBills,
          };
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
          totalAmount: totalGroupAmount,
          method: 'BANK_TRANSFER',
          status: 'PENDING',
          paymentDate: new Date(),
        },
      });

      for (const bill of bills) {
        await tx.bill.update({
          where: { id: bill.id },
          data: { paymentGroupId: group.id },
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
          
          const bills = await tx.bill.findMany({
            where: { paymentGroupId: group.id },
            include: { items: true },
          });

          let totalOutstanding = new Decimal(0);
          for (const bill of bills) {
            const billOut = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
              ? new Decimal(bill.outstandingAmount.toString())
              : new Decimal(bill.totalAmount.toString());
            totalOutstanding = totalOutstanding.plus(billOut);
          }

          if (submitAmount.greaterThan(totalOutstanding)) {
            throw new AppError(
              'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก',
              400,
              'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING'
            );
          }

          const now = new Date();

          for (const bill of bills) {
            const billOut = bill.outstandingAmount !== undefined && bill.outstandingAmount !== null
              ? new Decimal(bill.outstandingAmount.toString())
              : new Decimal(bill.totalAmount.toString());

            const payment = await tx.payment.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                tenantId: input.tenantId,
                paymentGroupId: group.id,
                method: 'BANK_TRANSFER',
                amount: billOut,
                status: 'PENDING',
                paymentDate: input.paymentDate,
                evidenceUrl: intent.objectKey,
                fileHash: intent.sha256 ? `${intent.sha256}-${bill.id}` : null,
                metadata: { intentId: input.intentId, groupId: group.id },
              },
            });

            await tx.paymentStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                paymentId: payment.id,
                fromStatus: null,
                toStatus: 'PENDING',
                changedByUserId: input.actorUserId,
              },
            });

            const preReviewStatus = bill.status;
            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: preReviewStatus,
                toStatus: 'UNDER_REVIEW',
                changedByUserId: input.actorUserId,
              },
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: 'UNDER_REVIEW',
                previousStatus: preReviewStatus,
              },
            });
          }

          await tx.combinedPaymentGroup.update({
            where: { id: group.id },
            data: {
              totalAmount: new Prisma.Decimal(submitAmount.toFixed(2)),
              status: 'UNDER_REVIEW',
              paymentDate: input.paymentDate,
            },
          });

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
   * Owner approves combined payment group atomically
   */
  async approvePaymentGroup(input: {
    dormitoryId: string;
    groupId: string;
    userId: string;
    notes?: string;
  }) {
    return await this.client.$transaction(async (tx) => {
      const group = await tx.combinedPaymentGroup.findUnique({
        where: { id: input.groupId },
        include: {
          payments: true,
          bills: {
            include: {
              items: true,
              billingCycle: true,
              room: true,
              tenant: true,
              allocations: true,
            },
          },
        },
      });

      if (!group || group.dormitoryId !== input.dormitoryId) {
        throw new AppError('ไม่พบกลุ่มรายการชำระเงิน', 404, 'COMBINED_GROUP_NOT_FOUND');
      }

      if (group.status === 'APPROVED') {
        return { success: true, group };
      }

      const bills = group.bills;
      const sortedBillIds = bills.map((b) => b.id).sort();
      for (const bid of sortedBillIds) {
        await tx.$executeRaw`SELECT "id" FROM "bills" WHERE "id" = ${bid}::uuid FOR UPDATE`;
      }

      const firstRoomId = bills[0]?.roomId;
      const firstTenantId = bills[0]?.tenantId;

      const allocationPlan = computeCanonicalAllocationPlan({
        submitAmount: new Decimal(group.totalAmount.toString()),
        targetRoomId: firstRoomId,
        targetTenantId: firstTenantId,
        eligibleBills: bills.map((b) => ({
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
        })),
      });

      const now = new Date();
      const safeUserId = input.userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.userId)
        ? input.userId
        : null;

      await tx.combinedPaymentGroup.update({
        where: { id: group.id },
        data: {
          status: 'APPROVED',
          recordedByUserId: safeUserId,
          notes: input.notes || group.notes,
        },
      });

      for (const p of group.payments) {
        await tx.payment.update({
          where: { id: p.id },
          data: {
            status: 'APPROVED',
            reviewedByUserId: safeUserId,
            reviewedAt: now,
          },
        });

        await tx.paymentStatusHistory.create({
          data: {
            dormitoryId: input.dormitoryId,
            paymentId: p.id,
            fromStatus: p.status,
            toStatus: 'APPROVED',
            changedByUserId: safeUserId,
            effectiveAt: now,
          },
        });
      }

      for (const aff of allocationPlan.affectedBills) {
        const billAllocations = allocationPlan.allocations.filter((a) => a.billId === aff.id);
        const billPayment = group.payments.find((p) => p.billId === aff.id);

        for (const alloc of billAllocations) {
          await tx.paymentAllocation.create({
            data: {
              dormitoryId: input.dormitoryId,
              paymentGroupId: group.id,
              paymentId: billPayment?.id || null,
              billId: aff.id,
              billItemId: alloc.billItemId || null,
              allocatedAmount: new Prisma.Decimal(alloc.allocatedAmount.toFixed(2)),
              allocationOrder: alloc.allocationOrder,
            },
          });
        }

        const targetBill = bills.find((b) => b.id === aff.id)!;
        await tx.billStatusHistory.create({
          data: {
            dormitoryId: input.dormitoryId,
            billId: aff.id,
            fromStatus: targetBill.status,
            toStatus: aff.newStatus,
            changedByUserId: safeUserId,
            effectiveAt: now,
          },
        });

        await tx.bill.update({
          where: { id: aff.id },
          data: {
            status: aff.newStatus,
            previousStatus: targetBill.status,
            paidAt: aff.newStatus === 'PAID' ? group.paymentDate : targetBill.paidAt,
            paidAmount: new Prisma.Decimal(aff.newPaidAmount.toFixed(2)),
            outstandingAmount: new Prisma.Decimal(aff.newOutstandingAmount.toFixed(2)),
            paymentGroupId: group.id,
          },
        });
      }

      // Generate 1 canonical Receipt for the entire group
      const receipt = await generateReceiptInTx(
        tx,
        group.payments[0]?.id || null,
        input.dormitoryId,
        bills[0]?.id || null,
        safeUserId,
        group.id,
        new Decimal(group.totalAmount.toString())
      );

      return { success: true, groupId: group.id, receipt };
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
          const payment = await tx.payment.findUnique({
            where: { id: input.paymentId },
            include: { paymentGroup: true },
          });
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');
          if (payment.status === 'APPROVED') return payment;
          if (payment.status !== 'PENDING' && payment.status !== 'UNDER_REVIEW') throw new AppError('สถานะรายการไม่ถูกต้อง', 400, 'INVALID_STATE');

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
                paymentGroupId: payment.paymentGroupId || null,
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
              paidAt: aff.newStatus === 'PAID' ? payment.paymentDate : bill.paidAt,
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
            payment.paymentGroupId,
            submitAmount
          );

          return updatedPayment;
        });
      },
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
          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');
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

          // Check if there is another valid approved payment for this bill
          const otherApproved = await tx.payment.findFirst({
            where: {
              billId: bill.id,
              status: 'APPROVED',
              id: { not: payment.id },
            },
          });

          if (!otherApproved) {
            // Restore previous unpaid status
            const targetStatus = bill.previousStatus || 'ISSUED';
            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: bill.status,
                toStatus: targetStatus,
                reason: `Payment rejected: ${input.reason}`,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: targetStatus,
                paidAt: null,
                paidAmount: new Decimal(0),
                outstandingAmount: bill.totalAmount,
              },
            });
          } else {
            // Restore partially paid state
            const targetStatus = 'PARTIALLY_PAID';
            await tx.billStatusHistory.create({
              data: {
                dormitoryId: input.dormitoryId,
                billId: bill.id,
                fromStatus: bill.status,
                toStatus: targetStatus,
                reason: `Payment rejected: ${input.reason}`,
                changedByUserId: safeUserId,
                effectiveAt: now,
              },
            });

            await tx.bill.update({
              where: { id: bill.id },
              data: {
                status: targetStatus,
              },
            });
          }

          return updatedPayment;
        });
      },
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
            include: { receipt: true },
          });

          if (!payment || payment.dormitoryId !== input.dormitoryId) throw new AppError('ไม่พบรายการชำระเงิน', 404, 'NOT_FOUND');
          if (payment.status !== 'APPROVED') throw new AppError('สามารถยกเลิกได้เฉพาะรายการที่อนุมัติแล้วเท่านั้น', 400, 'INVALID_STATE');

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

          // Delete allocations associated with reversed payment
          await tx.paymentAllocation.deleteMany({
            where: { paymentId: payment.id },
          });

          // Recompute bill balances
          const remainingAllocations = await tx.paymentAllocation.findMany({
            where: { billId: bill.id },
          });

          Decimal.set({ rounding: Decimal.ROUND_HALF_UP });
          let newPaid = new Decimal(0);
          for (const a of remainingAllocations) {
            newPaid = newPaid.plus(new Decimal(a.allocatedAmount.toString()));
          }

          const billTotal = new Decimal(bill.totalAmount.toString());
          const newOutstanding = Decimal.max(billTotal.minus(newPaid), new Decimal(0));
          const newStatus = newPaid.equals(0)
            ? (bill.previousStatus || 'ISSUED')
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

  /**
   * Helper for receipt generation in transaction
   */
  async generateReceiptTx(tx: any, paymentId: string, dormitoryId: string, billId: string, userId?: string | null) {
    return await generateReceiptInTx(tx, paymentId, dormitoryId, billId, userId);
  }
}

export const paymentService = new PaymentService();
