/**
 * Centralized Operational Billing Cycle Resolver (LOCAL-07 Master)
 *
 * Rules:
 * 1. Base Default: CURRENT Asia/Bangkok business month (YYYY-MM).
 * 2. Qualifying Future Activated Cycles:
 *    A cycle is activated ONLY IF it contains at least one real persisted Monthly Utility bill that is
 *    legitimate billing history/state:
 *      - billKind IN ('MONTHLY_UTILITY', 'LEGACY_COMBINED')
 *      - status IN ('issued', 'pending', 'unpaid', 'overdue', 'paid', 'partially_paid')
 *      - cancelledAt IS NULL (and status NOT IN ('cancelled', 'draft', 'voided', 'withdrawn', 'superseded'))
 *      - billingCycle.cycleCode >= current Bangkok business month (YYYY-MM)
 *    If one or more such future activated cycles exist, resolve to the LATEST cycle (by cycleCode desc / periodStart desc).
 * 3. If no future cycle has qualifying activation:
 *    Resolve to the billing cycle matching current Asia/Bangkok business month.
 * 4. Historical cycles (< current Bangkok business month):
 *    Historical paid bills or activity do NOT move the default backward from current Bangkok month.
 * 5. Fallback:
 *    If current Bangkok month cycle does not exist, fallback to dormitory onboarding start cycle or earliest cycle.
 *
 * What MUST NOT activate a cycle:
 * - Meter readings alone
 * - Unsaved / draft state
 * - RENT, DEPOSIT, DAILY bills
 * - Future reservations, Contracts, Provisional terms
 * - BillingCycle record existence alone
 *
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import {
  currentBusinessDateInBangkok,
  toBangkokDateString,
  getBangkokStartOfDayUtc,
} from '../utils/calendar-date.util.js';

export interface OperationalCycleResult {
  billingCycleId?: string;
  cycleCode: string;
  reason: 'CURRENT_DATE_ACTIVE' | 'BILLING_ACTIVITY' | 'ONBOARDING_START';
  cycle?: any;
}

export class CurrentCycleResolverService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Authoritatively resolve current operational cycle for a dormitory.
   */
  async resolveOperationalBillingCycle(dormitoryId: string, txClient?: any): Promise<OperationalCycleResult> {
    const db = txClient || this.prisma;

    const todayBangkok = currentBusinessDateInBangkok();
    const currentYearMonth = todayBangkok.slice(0, 7); // 'YYYY-MM', e.g. '2026-08'
    const todayBangkokStartUtc = getBangkokStartOfDayUtc(todayBangkok);

    // 1. Check for latest qualifying activated Monthly Utility cycle at or after current Bangkok month
    const activeFutureBills = db.bill ? await db.bill.findMany({
      where: {
        dormitoryId,
        billKind: { in: ['MONTHLY_UTILITY', 'LEGACY_COMBINED'] },
        status: { in: ['issued', 'pending', 'paid', 'overdue', 'partially_paid', 'unpaid'] },
        cancelledAt: null,
        billingCycle: {
          cycleCode: { gte: currentYearMonth },
        },
      },
      include: { billingCycle: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }) : [];

    if (activeFutureBills.length > 0) {
      const sorted = [...activeFutureBills].sort((a: any, b: any) => {
        const codeA = a.billingCycle?.cycleCode || '';
        const codeB = b.billingCycle?.cycleCode || '';
        if (codeA !== codeB) return codeB.localeCompare(codeA);
        const startA = a.billingCycle?.periodStart ? new Date(a.billingCycle.periodStart).getTime() : 0;
        const startB = b.billingCycle?.periodStart ? new Date(b.billingCycle.periodStart).getTime() : 0;
        return startB - startA;
      });

      const topBill = sorted[0];
      if (topBill?.billingCycle?.cycleCode) {
        return {
          billingCycleId: topBill.billingCycle.id,
          cycleCode: topBill.billingCycle.cycleCode,
          reason: 'BILLING_ACTIVITY',
          cycle: topBill.billingCycle,
        };
      }
    }

    // 2. Base default: Cycle matching current Asia/Bangkok business month (YYYY-MM or active date range)
    let currentCycle = db.billingCycle ? await db.billingCycle.findFirst({
      where: {
        dormitoryId,
        OR: [
          { cycleCode: currentYearMonth },
          {
            periodStart: { lte: todayBangkokStartUtc },
            periodEnd: { gte: todayBangkokStartUtc },
          },
        ],
      },
      orderBy: { periodStart: 'desc' },
    }) : null;

    if (currentCycle) {
      return {
        billingCycleId: currentCycle.id,
        cycleCode: currentCycle.cycleCode,
        reason: 'CURRENT_DATE_ACTIVE',
        cycle: currentCycle,
      };
    }

    // 3. Fallback to onboarding start cycle or earliest cycle (normalized via Asia/Bangkok date utility)
    const dorm = db.dormitory ? await db.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { createdAt: true },
    }) : null;

    const createdDate = dorm?.createdAt || new Date();
    const startCode = toBangkokDateString(createdDate).slice(0, 7);

    let startCycle = db.billingCycle ? await db.billingCycle.findFirst({
      where: { dormitoryId, cycleCode: startCode },
    }) : null;

    if (!startCycle) {
      startCycle = db.billingCycle ? await db.billingCycle.findFirst({
        where: { dormitoryId },
        orderBy: { periodStart: 'asc' },
      }) : null;
    }

    const fallbackCode = startCycle?.cycleCode || currentYearMonth;

    return {
      billingCycleId: startCycle?.id,
      cycleCode: fallbackCode,
      reason: 'ONBOARDING_START',
      cycle: startCycle || undefined,
    };
  }
}

export const currentCycleResolverService = new CurrentCycleResolverService();
