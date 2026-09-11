/**
 * @license Apache-2.0
 * TanStack Query Client Configuration & Scoped Query Keys
 *
 * Invariants:
 * 1. All server-state queries MUST be explicitly scoped by authoritative dormitoryId.
 * 2. Meter cycle data MUST be scoped by (dormitoryId, billingCycleId).
 * 3. Stale-while-revalidate enabled with resource-specific stale times.
 * 4. Cache cleared completely on logout or dormitory switch.
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s default
      gcTime: 5 * 60_000, // 5 minutes garbage collection
      refetchOnWindowFocus: false,
      retry: (failureCount, error: any) => {
        // Do not retry on 401, 403, 404, or 409
        const status = error?.status || error?.statusCode;
        if (status === 401 || status === 403 || status === 404 || status === 409) return false;
        return failureCount < 2;
      },
    },
  },
});

/**
 * Deterministic Query Key Factory scoped by Dormitory & Billing Cycle.
 */
export const queryKeys = {
  dormitories: ['dormitories'] as const,
  dormitory: (dormId: string) => ['dormitory', dormId] as const,
  owner: (dormId: string) => ['owner', dormId] as const,
  rooms: (dormId: string) => ['owner', dormId, 'rooms'] as const,
  buildings: (dormId: string) => ['owner', dormId, 'buildings'] as const,
  tenants: (dormId: string) => ['owner', dormId, 'tenants'] as const,
  contracts: (dormId: string) => ['owner', dormId, 'contracts'] as const,
  bills: (dormId: string) => ['owner', dormId, 'bills'] as const,
  billingCycles: (dormId: string) => ['owner', dormId, 'billing-cycles'] as const,
  payments: (dormId: string) => ['owner', dormId, 'payments'] as const,
  dailyInvoices: (dormId: string) => ['owner', dormId, 'daily-invoices'] as const,
  maintenance: (dormId: string) => ['owner', dormId, 'maintenance'] as const,
  announcements: (dormId: string) => ['owner', dormId, 'announcements'] as const,
  notifications: (dormId: string) => ['owner', dormId, 'notifications'] as const,
  meterWorkspace: (dormId: string, cycleId: string) => ['meter', dormId, cycleId, 'workspace'] as const,
  meterReadings: (dormId: string, cycleId: string) => ['meter', dormId, cycleId, 'readings'] as const,
  meterSnapshots: (dormId: string, cycleId: string) => ['meter', dormId, cycleId, 'snapshots'] as const,
  meterHouseholdCounts: (dormId: string, cycleId: string) => ['meter', dormId, cycleId, 'household-counts'] as const,
  meterPreviewContext: (dormId: string, cycleId: string) => ['meter', dormId, cycleId, 'preview-context'] as const,
  lineOaConfig: (dormId: string) => ['owner', dormId, 'line-oa-config'] as const,
};

/**
 * Resource-specific stale time constants (milliseconds).
 */
export const STALE_TIMES = {
  ROOMS: 120_000,        // 2 minutes
  BUILDINGS: 120_000,    // 2 minutes
  BILLING_CYCLES: 60_000, // 1 minute
  TENANTS: 60_000,       // 1 minute
  CONTRACTS: 60_000,     // 1 minute
  BILLS: 30_000,         // 30 seconds
  PAYMENTS: 30_000,      // 30 seconds
  DAILY_INVOICES: 30_000,// 30 seconds
  MAINTENANCE: 60_000,   // 1 minute
  LINE_OA: 60_000,       // 1 minute
  ANNOUNCEMENTS: 60_000, // 1 minute
  METER_WORKSPACE: 30_000, // 30 seconds
  PREVIEW_CONTEXT: 30_000, // 30 seconds
};

/**
 * Clears or invalidates queries when switching dormitories or logging out.
 */
export function clearDormitoryQueryCache(dormitoryId?: string) {
  if (dormitoryId) {
    queryClient.removeQueries({ queryKey: ['owner', dormitoryId] });
    queryClient.removeQueries({ queryKey: ['meter', dormitoryId] });
  } else {
    queryClient.clear();
  }
}


import { httpRequest } from '../data/httpClient';

/**
 * Shared query fetch function for Meter Billing Preview Context.
 * Used by getTargetQueriesForTab in Owner shell and OwnerRooms / OwnerMeter useQuery hooks.
 */
export async function fetchMeterPreviewContext(dormitoryId: string, billingCycleId: string) {
  const res = await httpRequest<{ success: boolean; data: any; error?: string }>(
    'GET',
    `/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`,
    undefined,
    { dormitoryId }
  );
  if (!res || res.success === false) {
    throw new Error(res?.error || 'ไม่สามารถโหลดข้อมูลอัตราค่าน้ำค่าไฟได้');
  }
  return res.data;
}
