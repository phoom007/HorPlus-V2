// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LOCAL-07 — HTTP Client Header Composition & Normalization Test Suite
 *
 * Verifies:
 * 1. At most one logical X-Dormitory-Id header is emitted.
 * 2. Case variations (x-dormitory-id, X-Dormitory-Id, X-DORMITORY-ID) are deduplicated.
 * 3. Canonical options.dormitoryId is respected.
 * 4. Conflicting options.dormitoryId and headers['x-dormitory-id'] fail-fast.
 * 5. Matching options.dormitoryId and headers['x-dormitory-id'] emit single header.
 * 6. Idempotency key and CSRF headers are normalized without duplicate casing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpRequest } from '../data/httpClient';

describe('LOCAL-07 — HTTP Client Header Composition', () => {
  let capturedFetch: { url: string; options: RequestInit } | null = null;

  beforeEach(() => {
    capturedFetch = null;
    localStorage.clear();
    sessionStorage.clear();

    vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      capturedFetch = { url: String(url), options: options || {} };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, data: {} }),
        text: async () => JSON.stringify({ success: true, data: {} }),
      } as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one X-Dormitory-Id header when canonical dormitoryId option is passed', async () => {
    await httpRequest('GET', '/api/v1/test', undefined, {
      dormitoryId: 'dorm-uuid-1111',
    });

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const dormHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-dormitory-id'
    );
    expect(dormHeaderKeys).toEqual(['X-Dormitory-Id']);
    expect(headers['X-Dormitory-Id']).toBe('dorm-uuid-1111');
  });

  it('normalizes lowercase x-dormitory-id caller header and emits only one canonical header', async () => {
    await httpRequest('GET', '/api/v1/test', undefined, {
      headers: {
        'x-dormitory-id': 'dorm-uuid-2222',
      },
    });

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const dormHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-dormitory-id'
    );
    expect(dormHeaderKeys).toEqual(['X-Dormitory-Id']);
    expect(headers['X-Dormitory-Id']).toBe('dorm-uuid-2222');
  });

  it('normalizes uppercase X-DORMITORY-ID caller header and emits only one canonical header', async () => {
    await httpRequest('GET', '/api/v1/test', undefined, {
      headers: {
        'X-DORMITORY-ID': 'dorm-uuid-3333',
      },
    });

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const dormHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-dormitory-id'
    );
    expect(dormHeaderKeys).toEqual(['X-Dormitory-Id']);
    expect(headers['X-Dormitory-Id']).toBe('dorm-uuid-3333');
  });

  it('handles matching options.dormitoryId and headers[x-dormitory-id] without duplication', async () => {
    await httpRequest('GET', '/api/v1/test', undefined, {
      dormitoryId: 'dorm-uuid-4444',
      headers: {
        'x-dormitory-id': 'dorm-uuid-4444',
      },
    });

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const dormHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-dormitory-id'
    );
    expect(dormHeaderKeys).toEqual(['X-Dormitory-Id']);
    expect(headers['X-Dormitory-Id']).toBe('dorm-uuid-4444');
  });

  it('throws fail-fast error on conflicting dormitoryId option and caller header', async () => {
    await expect(
      httpRequest('GET', '/api/v1/test', undefined, {
        dormitoryId: 'dorm-uuid-5555',
        headers: {
          'x-dormitory-id': 'dorm-uuid-6666',
        },
      })
    ).rejects.toThrow(/Conflicting dormitory IDs/);
  });

  it('falls back to localStorage selected_dormitory_id when no option or header is given', async () => {
    localStorage.setItem('selected_dormitory_id', 'dorm-uuid-storage');

    await httpRequest('GET', '/api/v1/test');

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const dormHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-dormitory-id'
    );
    expect(dormHeaderKeys).toEqual(['X-Dormitory-Id']);
    expect(headers['X-Dormitory-Id']).toBe('dorm-uuid-storage');
  });

  it('deduplicates case variants of X-Idempotency-Key on mutation requests', async () => {
    await httpRequest('POST', '/api/v1/test', { data: 'test' }, {
      idempotencyKey: 'idemp-key-1',
      headers: {
        'x-idempotency-key': 'idemp-key-legacy',
      },
    });

    expect(capturedFetch).not.toBeNull();
    const headers = capturedFetch!.options.headers as Record<string, string>;

    const idempHeaderKeys = Object.keys(headers).filter(
      (k) => k.toLowerCase() === 'x-idempotency-key'
    );
    expect(idempHeaderKeys).toEqual(['X-Idempotency-Key']);
    expect(headers['X-Idempotency-Key']).toBe('idemp-key-1');
  });
});
