// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Unit tests for fail-closed multi-page fetcher with metadata extraction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAllPaginated, fetchAllPaginatedWithMeta } from '../utils/fetch-paginated';

describe('fetchAllPaginated & fetchAllPaginatedWithMeta', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches a single page dataset and returns items', async () => {
    const mockData = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: mockData,
        pagination: { total: 2, page: 1, pageSize: 50 },
      }),
    } as any);

    const items = await fetchAllPaginated('/api/v1/test');
    expect(items).toEqual(mockData);
  });

  it('fetches multiple pages sequentially until total is reached', async () => {
    const page1Data = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1) }));
    const page2Data = Array.from({ length: 25 }, (_, i) => ({ id: String(i + 51) }));

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: page1Data,
          pagination: { total: 75, page: 1, pageSize: 50 },
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: page2Data,
          pagination: { total: 75, page: 2, pageSize: 50 },
        }),
      } as any);

    const items = await fetchAllPaginated('/api/v1/test');
    expect(items.length).toBe(75);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain('page=1');
    expect(fetchSpy.mock.calls[1][0]).toContain('page=2');
  });

  it('extracts cycle authority metadata from page 1', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'c-1', cycleCode: '2026-08' }],
        firstBillingCycleId: 'c-first-uuid',
        operationalBillingCycleId: 'c-1',
        operationalCycleCode: '2026-08',
        operationalCycle: { id: 'c-1', cycleCode: '2026-08', status: 'draft' },
        pagination: { total: 1, page: 1, pageSize: 50 },
      }),
    } as any);

    const result = await fetchAllPaginatedWithMeta('/api/v1/billing-cycles');
    expect(result.data.length).toBe(1);
    expect(result.firstBillingCycleId).toBe('c-first-uuid');
    expect(result.operationalBillingCycleId).toBe('c-1');
    expect(result.operationalCycleCode).toBe('2026-08');
    expect(result.operationalCycle?.status).toBe('draft');
  });

  it('throws fail-closed error if HTTP status is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Internal Server Error' }),
    } as any);

    await expect(fetchAllPaginated('/api/v1/fail')).rejects.toThrow('HTTP 500');
  });

  it('throws fail-closed error if collected count !== expected total', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: '1' }],
        pagination: { total: 10, page: 1, pageSize: 50 }, // Reports 10 but returns 1
      }),
    } as any);

    await expect(fetchAllPaginated('/api/v1/incomplete')).rejects.toThrow('expected total 10, collected 1');
  });
});
