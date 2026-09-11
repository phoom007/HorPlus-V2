/**
 * @license Apache-2.0
 * Quick Add Tenant Mutation Cache Coordinator
 */

import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryClient';

export interface QuickAddCacheImpact {
  rentalType?: 'TERM' | 'MONTHLY' | 'DAILY' | string;
  affectedCycleIds?: string[];
}

/**
 * Invalidate cached queries in response to a successful Quick Add Tenant mutation.
 *
 * Rules:
 * 1. Always invalidates queryKeys.rooms(dormitoryId).
 * 2. Always invalidates queryKeys.tenants(dormitoryId).
 * 3. Always invalidates queryKeys.bills(dormitoryId) (since a Deposit Bill or Daily Invoice is created).
 * 4. Always invalidates all cached Meter Preview Context queries for the SAME dormitory across all cycles.
 * 5. When rentalType === 'MONTHLY' (traditional contract), invalidates queryKeys.contracts(dormitoryId).
 * 6. When rentalType === 'DAILY', additionally invalidates queryKeys.dailyInvoices(dormitoryId) and queryKeys.payments(dormitoryId).
 */
export function invalidateQuickAddTenantCaches(
  queryClient: QueryClient,
  dormitoryId: string,
  impact?: QuickAddCacheImpact
): void {
  // 1. Canonical rooms query
  queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormitoryId) });

  // 2. Authoritative tenants query
  queryClient.invalidateQueries({ queryKey: queryKeys.tenants(dormitoryId) });

  // 3. Bills / Financial query
  queryClient.invalidateQueries({ queryKey: queryKeys.bills(dormitoryId) });

  // 4. Invalidate all cached preview-context queries for the SAME dormitory across all cycles
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

  // 5. Monthly rental creates traditional Contract in contracts query
  if (impact?.rentalType === 'MONTHLY') {
    queryClient.invalidateQueries({ queryKey: queryKeys.contracts(dormitoryId) });
  }

  // 6. Daily stay creates daily invoice / payment
  if (impact?.rentalType === 'DAILY') {
    queryClient.invalidateQueries({ queryKey: queryKeys.dailyInvoices(dormitoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.payments(dormitoryId) });
  }
}
