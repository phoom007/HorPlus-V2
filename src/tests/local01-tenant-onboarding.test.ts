/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiTenantAdapter, submitTenantRegistrationRequest, getTenantRegistrationRequests, approveTenantRegistrationRequest, rejectTenantRegistrationRequest } from '../data/adapters/api';

describe('LOCAL-01 — Frontend Adapters & API Helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should expose active co-occupant management methods on ApiTenantAdapter', async () => {
    const adapter = new ApiTenantAdapter();
    expect(typeof adapter.addCoOccupant).toBe('function');
    expect(typeof adapter.updateCoOccupant).toBe('function');
    expect(typeof adapter.removeCoOccupant).toBe('function');
  });

  it('should expose tenant registration request helper functions', async () => {
    expect(typeof submitTenantRegistrationRequest).toBe('function');
    expect(typeof getTenantRegistrationRequests).toBe('function');
    expect(typeof approveTenantRegistrationRequest).toBe('function');
    expect(typeof rejectTenantRegistrationRequest).toBe('function');
  });
});
