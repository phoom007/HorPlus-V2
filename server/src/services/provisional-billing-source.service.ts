/**
 * Shared Canonical Provisional Billing Source Resolver
 * 
 * Centralized authority to resolve the eligible active ProvisionalRentalTerm for a room in a billing cycle.
 * 
 * Enforces Half-Open Policy B: [startDate, endDate)
 * 1. status = 'ACTIVE'
 * 2. deletedAt = null
 * 3. startDate < cycleEndExclusive (day after billingCycle.periodEnd)
 * 4. endDate > cycleStart (billingCycle.periodStart)
 * 5. Deterministic ordering: [{ startDate: 'asc' }, { createdAt: 'desc' }]
 * Rejects RESERVED, CONVERTED, ENDED, CANCELLED, deleted, and non-overlapping terms.
 * 
 * @license Apache-2.0
 */

import { getPrismaClient } from '../db/prisma.js';
import { isAgreementEligibleForBillingCycle } from '../utils/calendar-date.util.js';

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

    const terms = await client.provisionalRentalTerm.findMany({
      where: {
        dormitoryId,
        roomId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      orderBy: [
        { startDate: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    const eligible = terms.filter((term: any) =>
      isAgreementEligibleForBillingCycle({
        agreementStartDate: term.startDate,
        agreementEndDate: term.endDate,
        cyclePeriodStart: billingCycle.periodStart,
        cyclePeriodEnd: billingCycle.periodEnd,
      })
    );

    return eligible.length > 0 ? eligible[0] : null;
  }
}

export const resolveProvisionalBillingSource =
  ProvisionalBillingSourceService.resolveProvisionalBillingSource;

