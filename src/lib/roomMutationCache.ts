/**
 * @license Apache-2.0
 * Room Mutation Impact & Cache Invalidation Coordinator
 */

import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryClient';

export type RoomMutationImpact =
  | { kind: 'create' }
  | {
      kind: 'update';
      roomNumberChanged: boolean;
      statusChanged?: boolean;
      effectiveBillingCycleId?: string | null;
      effectivePeriodStart?: string | null;
    }
  | {
      kind: 'archive';
    }
  | {
      kind: 'status';
      effectiveBillingCycleId?: string | null;
      effectivePeriodStart?: string | null;
    }
  | { kind: 'refresh' };

/**
 * Invalidate cached queries in response to a Room mutation or reload.
 *
 * Rules:
 * 1. Always invalidates queryKeys.rooms(dormitoryId).
 * 2. Invalidate all cached Meter Preview Context queries for the SAME dormitory
 *    on create, archive, or update with roomNumberChanged === true.
 * 3. On status change (kind: 'status' or update with statusChanged === true):
 *    Invalidate cached preview context queries for the SAME dormitory where
 *    the cycle's periodStart >= effectiveStatusCycle.periodStart.
 * 4. Never invalidates meterWorkspace, meterReadings, contracts, tenants, bills,
 *    payments, maintenance, announcements, or another dormitory's queries.
 */
export function invalidateRoomMutationCaches(
  queryClient: QueryClient,
  dormitoryId: string,
  impact: RoomMutationImpact,
  billingCycles?: Array<{ id: string; periodStart: string | Date }>
): void {
  // Always invalidate canonical rooms query for this dormitory
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormitoryId) });

  const isStructuralChange =
    impact.kind === 'create' ||
    impact.kind === 'archive' ||
    (impact.kind === 'update' && impact.roomNumberChanged);

  if (isStructuralChange) {
    // Invalidate all cached preview-context queries for the SAME dormitory across all cycles
    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === 'meter' &&
          key[1] === dormitoryId &&
          key[3] === 'preview-context'
        );
      },
    });
    return;
  }

  const isStatusChange =
    impact.kind === 'status' ||
    (impact.kind === 'update' && impact.statusChanged);

  if (isStatusChange) {
    const effectiveCycleId = impact.effectiveBillingCycleId;
    let effectivePeriodStart: number | null = impact.effectivePeriodStart
      ? new Date(impact.effectivePeriodStart).getTime()
      : null;

    if (effectivePeriodStart === null && effectiveCycleId && billingCycles && billingCycles.length > 0) {
      const found = billingCycles.find((c) => c.id === effectiveCycleId);
      if (found && found.periodStart) {
        effectivePeriodStart = new Date(found.periodStart).getTime();
      }
    }

    queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        if (
          !Array.isArray(key) ||
          key[0] !== 'meter' ||
          key[1] !== dormitoryId ||
          key[3] !== 'preview-context'
        ) {
          return false;
        }

        // If cycle timing info is unavailable, safely invalidate all cycles for this dorm
        if (effectivePeriodStart === null || !billingCycles || billingCycles.length === 0) {
          return true;
        }

        const queryCycleId = key[2];
        const queryCycle = billingCycles.find((c) => c.id === queryCycleId);
        if (!queryCycle || !queryCycle.periodStart) {
          return true;
        }

        const queryPeriodStart = new Date(queryCycle.periodStart).getTime();
        // Invalidate forward: cycle periodStart >= effective status cycle periodStart
        return queryPeriodStart >= effectivePeriodStart;
      },
    });
  }
}

export { invalidateQuickAddTenantCaches, type QuickAddCacheImpact } from './quickAddCache';
