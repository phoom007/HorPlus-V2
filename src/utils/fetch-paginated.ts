/**
 * Safe, Fail-Closed Multi-Page Fetcher for HorPlus Datasets
 * 
 * Invariants:
 * 1. Fetches all pages sequentially until complete dataset is loaded.
 * 2. Throws immediately if ANY page request fails (HTTP !2xx or network failure).
 * 3. Never returns a partial dataset.
 * 4. Throws if pagination.total is reported by the API but collected row count !== pagination.total.
 * 
 * @license Apache-2.0
 */

export interface PaginatedFetchResult<T = any> {
  data: T[];
  firstBillingCycleId?: string;
  operationalBillingCycleId?: string;
  operationalCycleCode?: string;
  operationalCycle?: any;
}

export async function fetchAllPaginated<T = any>(
  baseUrl: string,
  options: RequestInit = {}
): Promise<T[]> {
  const result = await fetchAllPaginatedWithMeta<T>(baseUrl, options);
  return result.data;
}

export async function fetchAllPaginatedWithMeta<T = any>(
  baseUrl: string,
  options: RequestInit = {}
): Promise<PaginatedFetchResult<T>> {
  let page = 1;
  const pageSize = 50;
  const allItems: T[] = [];
  let expectedTotal: number | undefined;
  let firstBillingCycleId: string | undefined;
  let operationalBillingCycleId: string | undefined;
  let operationalCycleCode: string | undefined;
  let operationalCycle: any;

  while (true) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${separator}page=${page}&pageSize=${pageSize}`;
    const res = await fetch(url, options);

    if (!res.ok) {
      throw new Error(`[fetchAllPaginated] Failed to fetch page ${page} from ${baseUrl}: HTTP ${res.status}`);
    }

    const json: any = await res.json();
    if (page === 1) {
      firstBillingCycleId = json.firstBillingCycleId;
      operationalBillingCycleId = json.operationalBillingCycleId;
      operationalCycleCode = json.operationalCycleCode;
      operationalCycle = json.operationalCycle;
    }
    const items = Array.isArray(json.data) ? json.data : [];
    allItems.push(...items);

    const total = json.pagination?.total;
    if (typeof total === 'number') {
      expectedTotal = total;
      if (allItems.length >= total || items.length === 0) {
        break;
      }
    } else {
      break;
    }
    page++;
  }

  if (typeof expectedTotal === 'number' && allItems.length !== expectedTotal) {
    throw new Error(
      `[fetchAllPaginated] Incomplete dataset from ${baseUrl}: expected total ${expectedTotal}, collected ${allItems.length}`
    );
  }

  return {
    data: allItems,
    firstBillingCycleId,
    operationalBillingCycleId,
    operationalCycleCode,
    operationalCycle,
  };
}
