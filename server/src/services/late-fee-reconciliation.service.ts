/**
 * @license Apache-2.0
 * Canonical Late-Fee Overdue Reconciler Service (L2 Scheduled Authority)
 *
 * Responsibilities:
 * 1. Identify eligible editable UNPAID Monthly Utility bills past their effective due date.
 * 2. Process each bill in an isolated PostgreSQL transaction with row locking and idempotency.
 * 3. Generate canonical preview using the cycle's frozen BillingRateSnapshot and dueDate.
 * 4. Perform semantic financial comparison: if unchanged, execute a clean NO-OP (no writes, no version increment).
 * 5. If changed, mutate the SAME Bill in place, replace BillItems, update header amounts, increment version, and log audit event.
 * 6. Preserves paidAmount and payment history without credit invention.
 * 7. Single hourly execution registered in CleanupService; single startup catch-up execution in server boot.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../config/logger.js';
import { AuditService } from './audit.service.js';
import { BillingService, BillPreviewResult } from './billing.service.js';
import { PrismaBillRepository } from '../db/repositories/bill.repository.js';
import { PrismaBillingCycleRepository } from '../db/repositories/billing-cycle.repository.js';
import { PrismaMeterRepository } from '../db/repositories/meter.repository.js';
import { PrismaContractRepository } from '../db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../db/repositories/tenant.repository.js';
import {
  toDecimal,
  formatDecimal,
  subDecimals,
  isZeroDecimal,
} from '../utils/decimal-math.util.js';
import { normalizeLateFeeMode } from '../utils/monthly-utility-calculator.util.js';

export interface ReconciliationDetail {
  billId: string;
  dormitoryId: string;
  roomId?: string;
  status: 'changed' | 'noop' | 'failed' | 'skipped';
  oldTotal?: string;
  newTotal?: string;
  reason?: string;
}

export interface ReconciliationSummary {
  scanned: number;
  eligible: number;
  changed: number;
  noop: number;
  failed: number;
  skipped: number;
  durationMs: number;
  details: ReconciliationDetail[];
}

export class LateFeeReconciliationService {
  private isRunning = false;
  private billingService: BillingService;

  constructor(
    private prisma: PrismaClient = new PrismaClient(),
    billingService?: BillingService,
    private auditService: AuditService = new AuditService()
  ) {
    if (billingService) {
      this.billingService = billingService;
    } else {
      const billRepo = new PrismaBillRepository(this.prisma);
      const billingCycleRepo = new PrismaBillingCycleRepository(this.prisma);
      const meterRepo = new PrismaMeterRepository(this.prisma);
      const contractRepo = new PrismaContractRepository(this.prisma);
      const roomRepo = new PrismaRoomRepository(this.prisma);
      const tenantRepo = new PrismaTenantRepository(this.prisma);
      this.billingService = new BillingService(
        billRepo as any,
        billingCycleRepo,
        meterRepo as any,
        contractRepo,
        roomRepo,
        tenantRepo as any,
        this.auditService
      );
    }
  }

  /**
   * Main reconciliation run. Bounded batch, deterministic ordering, failure-isolated loop.
   */
  public async reconcileOverdueBills(
    referenceTime: Date = new Date(),
    dormitoryId?: string
  ): Promise<ReconciliationSummary> {
    const startTime = Date.now();

    if (this.isRunning) {
      logger.info('[LateFeeReconciliationService] Reconciler already running. Skipping overlapping execution.');
      return {
        scanned: 0,
        eligible: 0,
        changed: 0,
        noop: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
        details: [],
      };
    }

    this.isRunning = true;
    let scanned = 0;
    let eligible = 0;
    let changed = 0;
    let noop = 0;
    let failed = 0;
    let skipped = 0;
    const details: ReconciliationDetail[] = [];

    try {
      // 1. Bounded candidate query: editable UNPAID Monthly Utility bills past dueDate
      const whereClause: Prisma.BillWhereInput = {
        billKind: 'MONTHLY_UTILITY',
        status: 'unpaid',
        billingCycle: {
          dueDate: {
            lt: referenceTime,
          },
        },
      };

      if (dormitoryId) {
        whereClause.dormitoryId = dormitoryId;
      }

      let lastId: string | undefined = undefined;
      let batchCount = 0;
      const BATCH_SIZE = 200;
      const MAX_BATCHES_PER_RUN = 50; // Bounds single run to at most 10,000 bills

      while (batchCount < MAX_BATCHES_PER_RUN) {
        const candidateBills: Array<{
          id: string;
          dormitoryId: string;
          roomId: string;
          billingCycleId: string | null;
        }> = await this.prisma.bill.findMany({
          where: whereClause,
          select: {
            id: true,
            dormitoryId: true,
            roomId: true,
            billingCycleId: true,
          },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          ...(lastId ? { skip: 1, cursor: { id: lastId } } : {}),
        });

        if (candidateBills.length === 0) {
          break;
        }

        batchCount++;
        scanned += candidateBills.length;
        lastId = candidateBills[candidateBills.length - 1].id;

        // 2. Sequential processing loop with per-bill transaction and error isolation
        for (const candidate of candidateBills) {
          try {
            const result = await this.reconcileSingleBillInTx(
              candidate.id,
              candidate.dormitoryId,
              referenceTime
            );

            if (result.status === 'changed') {
              eligible++;
              changed++;
              details.push({
                billId: candidate.id,
                dormitoryId: candidate.dormitoryId,
                roomId: candidate.roomId,
                status: 'changed',
                oldTotal: result.oldTotal,
                newTotal: result.newTotal,
              });
            } else if (result.status === 'noop') {
              eligible++;
              noop++;
              details.push({
                billId: candidate.id,
                dormitoryId: candidate.dormitoryId,
                roomId: candidate.roomId,
                status: 'noop',
                oldTotal: result.oldTotal,
                newTotal: result.newTotal,
                reason: result.reason,
              });
            } else {
              skipped++;
              details.push({
                billId: candidate.id,
                dormitoryId: candidate.dormitoryId,
                roomId: candidate.roomId,
                status: 'skipped',
                reason: result.reason,
              });
            }
          } catch (billErr: any) {
            failed++;
            logger.error(
              { billId: candidate.id, dormitoryId: candidate.dormitoryId, err: billErr },
              '[LateFeeReconciliationService] Failed to reconcile bill in transaction'
            );
            details.push({
              billId: candidate.id,
              dormitoryId: candidate.dormitoryId,
              roomId: candidate.roomId,
              status: 'failed',
              reason: billErr?.message || 'UNKNOWN_TRANSACTION_ERROR',
            });
          }
        }

        if (candidateBills.length < BATCH_SIZE) {
          break;
        }
      }

      const durationMs = Date.now() - startTime;
      logger.info(
        {
          scanned,
          eligible,
          changed,
          noop,
          failed,
          skipped,
          durationMs,
        },
        '[LateFeeReconciliationService] Completed overdue late fee reconciliation run'
      );

      return {
        scanned,
        eligible,
        changed,
        noop,
        failed,
        skipped,
        durationMs,
        details,
      };
    } catch (batchErr) {
      logger.error({ err: batchErr }, '[LateFeeReconciliationService] Batch candidate query error');
      return {
        scanned,
        eligible,
        changed,
        noop,
        failed,
        skipped,
        durationMs: Date.now() - startTime,
        details,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Reconciles a single bill inside an atomic PostgreSQL transaction.
   * Multi-instance safe: acquires exclusive row-level lock (FOR UPDATE),
   * refetches the bill under lock, re-verifies eligibility,
   * generates canonical preview using cycle snapshot, performs semantic comparison,
   * and mutates only when financial truth changes.
   */
  private async reconcileSingleBillInTx(
    billId: string,
    dormitoryId: string,
    referenceTime: Date
  ): Promise<{
    status: 'changed' | 'noop' | 'skipped';
    oldTotal?: string;
    newTotal?: string;
    reason?: string;
  }> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Acquire exclusive PostgreSQL row-level lock BEFORE canonical preview calculation
      await tx.$executeRaw`SELECT id FROM "bills" WHERE id = ${billId}::uuid FOR UPDATE`;

      // 2. Refetch bill inside transaction for fresh locked state
      const bill = await tx.bill.findFirst({
        where: { id: billId, dormitoryId },
        include: {
          items: true,
          Payment: true,
          billingCycle: {
            include: {
              rateSnapshot: true,
            },
          },
        },
      });

      if (!bill) {
        return { status: 'skipped', reason: 'BILL_NOT_FOUND' };
      }

      // 3. Strict eligibility validation inside lock
      if (bill.status !== 'unpaid' || bill.billKind !== 'MONTHLY_UTILITY') {
        return { status: 'skipped', reason: 'STATUS_NOT_UNPAID_OR_NOT_MONTHLY_UTILITY' };
      }

      if (!bill.billingCycle || !bill.billingCycle.dueDate) {
        return { status: 'skipped', reason: 'NO_DUE_DATE_ON_CYCLE' };
      }

      const rateSnapshot = bill.billingCycle.rateSnapshot;
      if (!rateSnapshot) {
        return { status: 'skipped', reason: 'NO_RATE_SNAPSHOT' };
      }

      const lateMode = normalizeLateFeeMode(rateSnapshot.lateFeeType);
      if (lateMode === 'unsupported') {
        logger.warn(
          { billId: bill.id, lateFeeType: rateSnapshot.lateFeeType },
          '[LateFeeReconciliationService] Unsupported late fee mode encountered - skipping mutation'
        );
        return { status: 'skipped', reason: 'INVALID_LATE_FEE_MODE' };
      }

      if (lateMode === 'none' || isZeroDecimal(toDecimal(rateSnapshot.lateFeeValue))) {
        return { status: 'noop', reason: 'LATE_FEE_MODE_NONE_OR_ZERO' };
      }

      // 3. Generate canonical preview INSIDE the transaction using frozen cycle snapshot
      const preview = await this.billingService.generateBillPreview(
        dormitoryId,
        bill.billingCycleId,
        bill.roomId,
        tx,
        'MONTHLY_UTILITY',
        referenceTime
      );

      // 4. Semantic Financial Comparison (ignoring persistence-only DB IDs)
      const isIdentical = this.compareBillFinancials(bill, preview);
      if (isIdentical) {
        return {
          status: 'noop',
          oldTotal: bill.totalAmount.toString(),
          newTotal: bill.totalAmount.toString(),
          reason: 'CANONICAL_FINANCIAL_TRUTH_UNCHANGED',
        };
      }

      // 5. Check if new total is below paidAmount
      const paidAmountDec = toDecimal(bill.paidAmount ? bill.paidAmount.toString() : '0.00');
      const newTotalDec = toDecimal(preview.totalAmount);
      if (newTotalDec < paidAmountDec) {
        logger.warn(
          { billId: bill.id, newTotal: preview.totalAmount, paidAmount: bill.paidAmount },
          '[LateFeeReconciliationService] Reconciled total below paid amount - skipping bill'
        );
        return { status: 'skipped', reason: 'RECONCILED_TOTAL_BELOW_PAID_AMOUNT' };
      }

      // 6. Mutate the SAME bill in place:
      // Replace BillItems
      await tx.billItem.deleteMany({
        where: { billId: bill.id },
      });

      await tx.billItem.createMany({
        data: preview.items.map((item) => ({
          billId: bill.id,
          dormitoryId: bill.dormitoryId,
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          amount: item.amount,
          metadata: item.metadata || undefined,
        })),
      });

      // Update Bill header
      const newOutstanding = subDecimals(newTotalDec, paidAmountDec);
      await tx.bill.update({
        where: { id: bill.id },
        data: {
          subtotal: preview.subtotal,
          totalAmount: preview.totalAmount,
          outstandingAmount: formatDecimal(newOutstanding),
          version: { increment: 1 },
        },
      });

      // 7. Audit log event
      this.auditService.log({
        dormitoryId: bill.dormitoryId,
        actorUserId: 'system',
        action: 'bill.reconcile_late_fee',
        resourceType: 'bill',
        resourceId: bill.id,
        details: {
          oldTotal: bill.totalAmount.toString(),
          newTotal: preview.totalAmount,
          lateFeeAmount: preview.lateFeeAmount,
          asOfDate: referenceTime.toISOString(),
        },
      });

      return {
        status: 'changed',
        oldTotal: bill.totalAmount.toString(),
        newTotal: preview.totalAmount,
      };
    });
  }

  /**
   * Compares persisted bill items and totals against canonical preview.
   * Compares semantic types, descriptions, quantities, unit prices, amounts,
   * subtotal, and totalAmount, strictly ignoring database IDs.
   */
  private compareBillFinancials(
    persisted: {
      subtotal: Prisma.Decimal | string;
      totalAmount: Prisma.Decimal | string;
      items: Array<{
        type: string;
        description: string;
        quantity: Prisma.Decimal | string;
        unitPrice: Prisma.Decimal | string;
        amount: Prisma.Decimal | string;
      }>;
    },
    preview: BillPreviewResult
  ): boolean {
    const pSub = formatDecimal(persisted.subtotal.toString());
    const prevSub = formatDecimal(preview.subtotal);
    if (pSub !== prevSub) return false;

    const pTot = formatDecimal(persisted.totalAmount.toString());
    const prevTot = formatDecimal(preview.totalAmount);
    if (pTot !== prevTot) return false;

    if (persisted.items.length !== preview.items.length) return false;

    const itemKey = (item: {
      type: string;
      description: string;
      quantity: Prisma.Decimal | string;
      unitPrice: Prisma.Decimal | string;
      amount: Prisma.Decimal | string;
    }) =>
      `${item.type}_${item.description}_${formatDecimal(item.quantity.toString())}_${formatDecimal(item.unitPrice.toString())}_${formatDecimal(item.amount.toString())}`;

    const sortedPersisted = persisted.items.map(itemKey).sort();
    const sortedPreview = preview.items
      .map((item) =>
        itemKey({
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })
      )
      .sort();

    for (let i = 0; i < sortedPersisted.length; i++) {
      if (sortedPersisted[i] !== sortedPreview[i]) return false;
    }

    return true;
  }
}

export const lateFeeReconciliationService = new LateFeeReconciliationService();
