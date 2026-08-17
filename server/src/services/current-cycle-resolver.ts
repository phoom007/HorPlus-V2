/**
 * Centralized Operational Billing Cycle Resolver (LOCAL-07 Master)
 * Priority:
 * 1. Latest cycle with entered/saved meter readings
 * 2. Latest cycle with active bills (issued, pending, paid, unpaid, overdue, partially_paid)
 * 3. Dormitory creation start month cycle (Onboarding start cycle)
 * 
 * Auto-created future draft cycles are untouched and must NOT become operational.
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';

export interface OperationalCycleResult {
  billingCycleId?: string;
  cycleCode: string;
  reason: 'METER_ACTIVITY' | 'BILLING_ACTIVITY' | 'LATEST_USED' | 'ONBOARDING_START';
  cycle?: any;
}

export class CurrentCycleResolverService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Authoritatively resolve current operational cycle for a dormitory
   * Priority:
   * 1. Latest cycle with entered/saved meter readings (ordered by billingCycle.periodStart desc)
   * 2. Latest cycle with active bills (issued, pending, paid, unpaid, overdue, partially_paid)
   * 3. Dormitory creation start month cycle (Onboarding start cycle)
   */
  async resolveOperationalBillingCycle(dormitoryId: string, txClient?: any): Promise<OperationalCycleResult> {
    const db = txClient || this.prisma;

    // 1. Check for latest cycle with real meter readings
    const readingWithCycle = await db.meterReading.findFirst({
      where: {
        dormitoryId,
      },
      include: { billingCycle: true },
      orderBy: [
        { billingCycle: { periodStart: 'desc' } },
        { createdAt: 'desc' },
      ],
    });

    if (readingWithCycle?.billingCycle?.cycleCode) {
      return {
        billingCycleId: readingWithCycle.billingCycle.id,
        cycleCode: readingWithCycle.billingCycle.cycleCode,
        reason: 'METER_ACTIVITY',
        cycle: readingWithCycle.billingCycle,
      };
    }

    // 2. Check for latest cycle with active bills (issued, pending, paid, unpaid, overdue, partially_paid)
    const billWithCycle = await db.bill.findFirst({
      where: {
        dormitoryId,
        status: { in: ['issued', 'pending', 'paid', 'overdue', 'partially_paid', 'unpaid'] },
      },
      include: { billingCycle: true },
      orderBy: [
        { billingCycle: { periodStart: 'desc' } },
        { createdAt: 'desc' },
      ],
    });

    if (billWithCycle?.billingCycle?.cycleCode) {
      return {
        billingCycleId: billWithCycle.billingCycle.id,
        cycleCode: billWithCycle.billingCycle.cycleCode,
        reason: 'BILLING_ACTIVITY',
        cycle: billWithCycle.billingCycle,
      };
    }

    // 3. Fallback to onboarding / start cycle
    // Note: Auto-created future draft rolling cycles with zero activity must NOT be chosen
    const dorm = await db.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { createdAt: true },
    });

    const created = dorm?.createdAt || new Date();
    const startCode = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;

    let startCycle = await db.billingCycle.findFirst({
      where: { dormitoryId, cycleCode: startCode },
    });

    if (!startCycle) {
      // Find the earliest existing cycle by periodStart as the true start cycle
      startCycle = await db.billingCycle.findFirst({
        where: { dormitoryId },
        orderBy: { periodStart: 'asc' },
      });
    }

    const resolvedCode = startCycle?.cycleCode || startCode;

    return {
      billingCycleId: startCycle?.id,
      cycleCode: resolvedCode,
      reason: 'ONBOARDING_START',
      cycle: startCycle || undefined,
    };
  }
}

export const currentCycleResolverService = new CurrentCycleResolverService();
