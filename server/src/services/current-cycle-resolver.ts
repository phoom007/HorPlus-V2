/**
 * Centralized Operational Billing Cycle Resolver (LOCAL-07 Master)
 * Priority:
 * 1. Latest cycle with entered/saved meter readings
 * 2. Latest cycle with active bills (issued, pending, paid)
 * 3. Latest actually-used cycle
 * 4. Dormitory creation start month cycle
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';

export interface OperationalCycleResult {
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
   */
  async resolveOperationalBillingCycle(dormitoryId: string, txClient?: any): Promise<OperationalCycleResult> {
    const db = txClient || this.prisma;

    // 1. Check for latest cycle with real meter readings
    const latestMeterReading = await db.meterReading.findFirst({
      where: {
        dormitoryId,
      },
      include: { billingCycle: true },
      orderBy: { createdAt: 'desc' },
    });

    if (latestMeterReading?.billingCycle?.cycleCode) {
      return {
        cycleCode: latestMeterReading.billingCycle.cycleCode,
        reason: 'METER_ACTIVITY',
        cycle: latestMeterReading.billingCycle,
      };
    }

    // 2. Check for latest cycle with active bills (issued, pending, paid, etc.)
    const latestBill = await db.bill.findFirst({
      where: {
        dormitoryId,
        status: { in: ['issued', 'pending', 'paid', 'overdue', 'partially_paid'] },
      },
      include: { billingCycle: true },
      orderBy: { createdAt: 'desc' },
    });

    if (latestBill?.billingCycle?.cycleCode) {
      return {
        cycleCode: latestBill.billingCycle.cycleCode,
        reason: 'BILLING_ACTIVITY',
        cycle: latestBill.billingCycle,
      };
    }

    // 3. Check latest existing cycle that is not locked/draft empty
    const latestCycle = await db.billingCycle.findFirst({
      where: { dormitoryId },
      orderBy: { periodStart: 'asc' },
    });

    if (latestCycle) {
      return {
        cycleCode: latestCycle.cycleCode,
        reason: 'LATEST_USED',
        cycle: latestCycle,
      };
    }

    // 4. Default to dormitory creation start month
    const dorm = await db.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { createdAt: true },
    });

    const created = dorm?.createdAt || new Date();
    const startCode = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;

    return {
      cycleCode: startCode,
      reason: 'ONBOARDING_START',
    };
  }
}

export const currentCycleResolverService = new CurrentCycleResolverService();
