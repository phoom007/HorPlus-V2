/**
 * @license Apache-2.0
 * Room Mutation Impact & Cache Invalidation Coordinator
 */

import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryClient';

export type RoomMutationImpact =
  | { kind: 'create' }
  | { kind: 'update'; roomNumberChanged: boolean }
  | { kind: 'archive' }
  | { kind: 'status' }
  | { kind: 'refresh' };

/**
 * Invalidate cached queries in response to a Room mutation or reload.
 * 
 * Rules:
 * 1. Always invalidates queryKeys.rooms(dormitoryId).
 * 2. Invalidate all cached Meter Preview Context queries for the SAME dormitory
 *    ONLY on create, archive, or update with roomNumberChanged === true.
 * 3. Never invalidates meterWorkspace, meterReadings, contracts, tenants, bills,
 *    payments, maintenance, announcements, or another dormitory's queries.
 */
export function invalidateRoomMutationCaches(
  queryClient: QueryClient,
  dormitoryId: string,
  impact: RoomMutationImpact
): void {
  // Always invalidate canonical rooms query for this dormitory
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormitoryId) });

  const shouldInvalidatePreview =
    impact.kind === 'create' ||
    impact.kind === 'archive' ||
    (impact.kind === 'update' && impact.roomNumberChanged);

  if (shouldInvalidatePreview) {
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
  }
}
