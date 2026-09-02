/**
 * @license Apache-2.0
 * Canonical Late-Fee Overdue Reconciler Service (L2 Scheduled Authority)
 *
 * Responsibilities:
 * 1. Identify eligible editable UNPAID & PARTIALLY_PAID Monthly Utility bills past their effective due date.
 * 2. Process each bill in an isolated PostgreSQL transaction with row locking and idempotency.
 * 3. Resolve trusted payment effective timestamp (Decision C):
 *    - CASH: server-recorded paymentDate is authoritative and freezes late fees.
 *    - Future verified bank transfer: verifiedTransferAt freezes late fees.
 *    - Manual UNVERIFIED slip: untrusted -> does NOT freeze late fee accrual.
 * 4. Perform surgical BillItem updates:
 *    - Preserve existing non-late BillItems (RENT, WATER, ELECTRIC, etc.) and their IDs.
 *    - Preserve PaymentAllocation.billItemId relational integrity.
 *    - Update / insert / remove ONLY canonical late_fee BillItem(s).
 * 5. Update Bill subtotal, totalAmount, outstandingAmount consistently.
 * 6. Audit log event for changed bills.
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
  isZeroDecimal,
} from '../utils/decimal-math.util.js';
import { normalizeLateFeeMode } from '../utils/monthly-utility-calculator.util.js';
import { resolveTrustedPaymentEffectiveAt } from './payment-verification.service.js';
import { Decimal } from 'decimal.js';

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

/**
 * Resolves the canonical as-of date for late-fee calculation (Decision C Authority).
 */
export function resolveBillLateFeeEffectiveAsOfInTx(
  bill: {
    status: string;
    outstandingAmount?: Prisma.Decimal | string | number | null;
    Payment?: Array<{
      id: string;
      status: string;
      method: string;
      paymentDate?: Date | null;
      verification?: {
        status?: string | null;
        provider?: string | null;
        verifiedTransferAt?: Date | null;
      } | null;
      paymentGroup?: {
        verification?: {
          status?: string | null;
          provider?: string | null;
          verifiedTransferAt?: Date | null;
        } | null;
      } | null;
    }> | null;
  },
  referenceTime: Date
): Date | null {
  const normStatus = (bill.status || '').toUpperCase();
  const outstanding = toDecimal(bill.outstandingAmount?.toString() || '0');

  if (normStatus === 'PAID' || isZeroDecimal(outstanding) || outstanding.lessThan(0)) {
    return null; // Not eligible for additional late-fee accrual
  }

  // Look for any TRUSTED successful payment on this bill
  const approvedPayments = (bill.Payment || []).filter((p) => p.status === 'APPROVED');
  let earliestTrustedTime: Date | null = null;

  for (const p of approvedPayments) {
    const verification = p.verification || p.paymentGroup?.verification;
    const trustedTime = resolveTrustedPaymentEffectiveAt({
      method: p.method,
      serverRecordedAt: p.paymentDate,
      verification,
    });

    if (trustedTime) {
      if (!earliestTrustedTime || trustedTime.getTime() < earliestTrustedTime.getTime()) {
        earliestTrustedTime = trustedTime;
      }
    }
  }

  if (earliestTrustedTime) {
    return earliestTrustedTime;
  }

  return referenceTime;
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
      // 1. Candidate query: UNPAID and PARTIALLY_PAID Monthly Utility bills past Bill.dueDate with outstanding balance
      const eligibleStatuses = ['unpaid', 'UNPAID', 'partially_paid', 'PARTIALLY_PAID', 'partial', 'PARTIAL'];
      const whereClause: Prisma.BillWhereInput = {
        billKind: 'MONTHLY_UTILITY',
        status: { in: eligibleStatuses },
        dueDate: {
          lt: referenceTime,
        },
      };

      if (dormitoryId) {
        whereClause.dormitoryId = dormitoryId;
      }

      let lastId: string | undefined = undefined;
      let batchCount = 0;
      const BATCH_SIZE = 200;
      const MAX_BATCHES_PER_RUN = 50;

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
   * resolves trusted payment effective time (Decision C),
   * generates canonical preview, and performs surgical BillItem updates.
   */
  public async reconcileSingleBillInTx(
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
      // 1. Acquire exclusive PostgreSQL row-level lock BEFORE calculation
      await tx.$executeRaw`SELECT id FROM "bills" WHERE id = ${billId}::uuid FOR UPDATE`;

      // 2. Refetch bill inside transaction for fresh locked state
      const bill = await tx.bill.findFirst({
        where: { id: billId, dormitoryId },
        include: {
          items: true,
          Payment: {
            where: { status: 'APPROVED' },
            include: {
              verification: true,
              paymentGroup: {
                include: {
                  verification: true,
                },
              },
            },
            orderBy: { paymentDate: 'asc' },
          },
          allocations: true,
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

      // FAIL-CLOSED LOCKED-STATE ELIGIBILITY VALIDATION (P0)
      const normalizedStatus = (bill.status || '').toUpperCase();
      const isEligibleStatus = normalizedStatus === 'UNPAID' || normalizedStatus === 'PARTIALLY_PAID';
      if (!isEligibleStatus) {
        return { status: 'skipped', reason: 'STATUS_NO_LONGER_LATE_FEE_ELIGIBLE' };
      }

      if (bill.billKind !== 'MONTHLY_UTILITY') {
        return { status: 'skipped', reason: 'NOT_MONTHLY_UTILITY' };
      }

      const outstanding = toDecimal(bill.outstandingAmount?.toString() || '0');
      if (outstanding.lessThanOrEqualTo(0)) {
        return { status: 'skipped', reason: 'NO_OUTSTANDING_BALANCE' };
      }

      if (!bill.dueDate) {
        return { status: 'skipped', reason: 'NO_DUE_DATE_ON_BILL' };
      }

      if (bill.dueDate >= referenceTime) {
        return { status: 'skipped', reason: 'DUE_DATE_NO_LONGER_OVERDUE' };
      }

      const effectiveAsOf = resolveBillLateFeeEffectiveAsOfInTx(bill, referenceTime);
      if (!effectiveAsOf) {
        return { status: 'skipped', reason: 'NOT_ELIGIBLE_FOR_LATE_FEE' };
      }

      const rateSnapshot = bill.billingCycle?.rateSnapshot;
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

      // 3. Generate canonical preview INSIDE the transaction using effectiveAsOf and frozen rateSnapshot
      const preview = await this.billingService.generateBillPreview(
        dormitoryId,
        bill.billingCycleId,
        bill.roomId,
        tx,
        'MONTHLY_UTILITY',
        effectiveAsOf,
        bill.dueDate
      );

      const existingLateItems = bill.items.filter((i) => i.type === 'late_fee');
      const currentLateFeeSum = existingLateItems.reduce(
        (sum, it) => sum.plus(toDecimal(it.amount.toString())),
        new Decimal(0)
      );
      const newLateFeeDec = toDecimal(preview.lateFeeAmount || '0.00');

      // 4. Semantic check: if late fee amount is unchanged, NO-OP
      if (currentLateFeeSum.equals(newLateFeeDec)) {
        return {
          status: 'noop',
          oldTotal: bill.totalAmount.toString(),
          newTotal: bill.totalAmount.toString(),
          reason: 'CANONICAL_FINANCIAL_TRUTH_UNCHANGED',
        };
      }

      // 5. Surgical BillItem update: preserve non-late items (RENT, WATER, ELECTRIC, etc.) and PaymentAllocation links
      const nonLateSubtotal = bill.items
        .filter((i) => i.type !== 'late_fee')
        .reduce((sum, it) => sum.plus(toDecimal(it.amount.toString())), new Decimal(0));

      const previewLateItem = preview.items.find((i) => i.type === 'late_fee');
      const lateFeeDescription = previewLateItem?.description || 'ค่าปรับชำระล่าช้า';

      if (newLateFeeDec.isZero()) {
        if (existingLateItems.length > 0) {
          await tx.billItem.deleteMany({
            where: { id: { in: existingLateItems.map((i) => i.id) } },
          });
        }
      } else {
        if (existingLateItems.length === 1) {
          await tx.billItem.update({
            where: { id: existingLateItems[0].id },
            data: {
              amount: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              unitPrice: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              quantity: new Prisma.Decimal('1.00'),
              description: lateFeeDescription,
            },
          });
        } else if (existingLateItems.length === 0) {
          await tx.billItem.create({
            data: {
              billId: bill.id,
              dormitoryId: bill.dormitoryId,
              type: 'late_fee',
              description: lateFeeDescription,
              quantity: new Prisma.Decimal('1.00'),
              unit: 'รายการ',
              unitPrice: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              amount: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              displayOrder: 99,
            },
          });
        } else {
          // Normalize duplicate legacy late fee rows
          const [firstLate, ...extraLates] = existingLateItems;
          if (extraLates.length > 0) {
            await tx.billItem.deleteMany({
              where: { id: { in: extraLates.map((i) => i.id) } },
            });
          }
          await tx.billItem.update({
            where: { id: firstLate.id },
            data: {
              amount: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              unitPrice: new Prisma.Decimal(newLateFeeDec.toFixed(2)),
              quantity: new Prisma.Decimal('1.00'),
              description: lateFeeDescription,
            },
          });
        }
      }

      // Update Bill header amounts consistently
      const newTotal = nonLateSubtotal.plus(newLateFeeDec);
      const paidAmount = toDecimal(bill.paidAmount ? bill.paidAmount.toString() : '0.00');
      const newOutstanding = Decimal.max(newTotal.minus(paidAmount), new Decimal(0));

      await tx.bill.update({
        where: { id: bill.id },
        data: {
          subtotal: new Prisma.Decimal(newTotal.toFixed(2)),
          totalAmount: new Prisma.Decimal(newTotal.toFixed(2)),
          outstandingAmount: new Prisma.Decimal(newOutstanding.toFixed(2)),
          version: { increment: 1 },
        },
      });

      // 6. Audit log event
      this.auditService.log({
        dormitoryId: bill.dormitoryId,
        actorUserId: 'system',
        action: 'bill.reconcile_late_fee',
        resourceType: 'bill',
        resourceId: bill.id,
        details: {
          oldTotal: bill.totalAmount.toString(),
          newTotal: formatDecimal(newTotal),
          lateFeeAmount: formatDecimal(newLateFeeDec),
          asOfDate: effectiveAsOf.toISOString(),
        },
      });

      return {
        status: 'changed',
        oldTotal: bill.totalAmount.toString(),
        newTotal: formatDecimal(newTotal),
      };
    });
  }

  private dailyTimerId: NodeJS.Timeout | null = null;

  /**
   * Calculates milliseconds until the next occurrence of 00:05:00 Asia/Bangkok (+07:00).
   * Note: 00:05:00 Bangkok is 17:05:00 UTC.
   */
  public getNextBangkok0005DelayMs(now: Date = new Date()): number {
    const targetUtcHour = 17;
    const targetUtcMinute = 5;
    const target = new Date(now.getTime());
    target.setUTCHours(targetUtcHour, targetUtcMinute, 0, 0);

    if (now.getTime() >= target.getTime()) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  /**
   * Starts the canonical daily reconciliation scheduler at 00:05 Asia/Bangkok.
   */
  public startDailySchedule(): void {
    if (this.dailyTimerId) return;

    const scheduleNext = () => {
      const delayMs = this.getNextBangkok0005DelayMs();
      this.dailyTimerId = setTimeout(async () => {
        try {
          await this.reconcileOverdueBills(new Date());
        } catch (err) {
          logger.error({ err }, '[LateFeeReconciliationService] Error during scheduled daily reconciliation');
        }
        scheduleNext();
      }, delayMs);
    };

    scheduleNext();
  }

  /**
   * Executes startup catch-up reconciliation on server boot.
   */
  public async runStartupCatchUp(referenceTime: Date = new Date(), dormitoryId?: string): Promise<ReconciliationSummary> {
    logger.info('[LateFeeReconciliationService] Running startup catch-up overdue reconciliation');
    return this.reconcileOverdueBills(referenceTime, dormitoryId);
  }

  /**
   * Stops the daily schedule timer.
   */
  public stop(): void {
    if (this.dailyTimerId) {
      clearTimeout(this.dailyTimerId);
      this.dailyTimerId = null;
    }
  }
}

export const lateFeeReconciliationService = new LateFeeReconciliationService();
