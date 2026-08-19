/**
 * Shared Canonical Provisional Billing Source Resolver
 * 
 * Centralized authority to resolve the eligible active ProvisionalRentalTerm for a room in a billing cycle.
 * 
 * Enforces:
 * 1. status = 'ACTIVE'
 * 2. deletedAt = null
 * 3. startDate <= billingCycle.periodEnd
 * 4. endDate >= billingCycle.periodStart
 * 5. Deterministic ordering: [{ startDate: 'asc' }, { createdAt: 'desc' }]
 * Rejects RESERVED, CONVERTED, ENDED, CANCELLED, deleted, and non-overlapping terms.
 * 
 * @license Apache-2.0
 */

import { getPrismaClient } from '../db/prisma.js';

export interface ResolveProvisionalBillingSourceParams {
  dormitoryId: string;
  roomId: string;
  billingCycle: { periodStart: Date | string; periodEnd: Date | string };
  tx?: any;
}

export class ProvisionalBillingSourceService {
  /**
   * Resolves the authoritative active provisional rental term for a room in a cycle.
   */
  public static async resolveProvisionalBillingSource(
    params: ResolveProvisionalBillingSourceParams
  ): Promise<any | null> {
    const { dormitoryId, roomId, billingCycle, tx } = params;
    const prisma = getPrismaClient();
    const client = tx || prisma;
    const cycleStart = new Date(billingCycle.periodStart);
    const cycleEnd = new Date(billingCycle.periodEnd);

    const term = await client.provisionalRentalTerm.findFirst({
      where: {
        dormitoryId,
        roomId,
        status: 'ACTIVE',
        deletedAt: null,
        startDate: { lte: cycleEnd },
        endDate: { gte: cycleStart },
      },
      orderBy: [
        { startDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    return term;
  }
}

export const resolveProvisionalBillingSource =
  ProvisionalBillingSourceService.resolveProvisionalBillingSource;
