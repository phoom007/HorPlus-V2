/**
 * Card S1: Unified Tenant Identity & Fallback Elimination Unit Tests
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findAuthoritativeActiveTenant, findAuthoritativeActiveTenantForRequest } from '../../utils/tenant-resolution.util.js';

describe('Card S1: Unified Authoritative Tenant Resolution', () => {
  const mockTenant = {
    id: 'tenant-uuid-1',
    dormitoryId: 'dorm-001',
    name: 'นายทดสอบ ผู้เช่า',
    phone: '0891234567',
    status: 'active',
    linkedUserId: '11111111-2222-3333-4444-555555555555',
    lineFriendId: 'line-friend-001',
    deletedAt: null,
  };

  const mockGrant = {
    id: 'grant-001',
    dormitoryId: 'dorm-001',
    lineFriendId: 'line-friend-001',
    roleCode: 'TENANT',
    status: 'ACTIVE',
  };

  it('resolves tenant directly by linkedUserId when auth.userId is a UUID', async () => {
    const mockPrisma = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue(mockTenant),
      },
    };

    const result = await findAuthoritativeActiveTenant({
      dormitoryId: 'dorm-001',
      auth: {
        userId: '11111111-2222-3333-4444-555555555555',
      },
      client: mockPrisma,
    });

    expect(result).toEqual(mockTenant);
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({
      where: {
        linkedUserId: '11111111-2222-3333-4444-555555555555',
        dormitoryId: 'dorm-001',
        deletedAt: null,
        status: 'active',
      },
    });
  });

  it('resolves tenant via access grant when auth.userId is an ag_user_ identifier', async () => {
    const mockPrisma = {
      dormitoryAccessGrant: {
        findUnique: vi.fn().mockResolvedValue(mockGrant),
      },
      tenant: {
        findFirst: vi.fn().mockResolvedValue(mockTenant),
      },
    };

    const result = await findAuthoritativeActiveTenant({
      dormitoryId: 'dorm-001',
      auth: {
        userId: 'ag_user_grant-001',
        session: { accessGrantId: 'grant-001' },
      },
      client: mockPrisma,
    });

    expect(result).toEqual(mockTenant);
    expect(mockPrisma.dormitoryAccessGrant.findUnique).toHaveBeenCalledWith({
      where: { id: 'grant-001' },
      include: { lineFriend: true },
    });
    expect(mockPrisma.tenant.findFirst).toHaveBeenCalledWith({
      where: {
        dormitoryId: 'dorm-001',
        lineFriendId: 'line-friend-001',
        deletedAt: null,
        status: 'active',
      },
    });
  });

  it('resolves approved tenant via registration request and self-heals lineFriendId', async () => {
    const approvedTenantWithoutFriend = {
      ...mockTenant,
      lineFriendId: null,
    };

    const mockPrisma = {
      dormitoryAccessGrant: {
        findUnique: vi.fn().mockResolvedValue(mockGrant),
      },
      tenant: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // First direct search by lineFriendId returns null
          .mockResolvedValueOnce(approvedTenantWithoutFriend), // Search by approvedTenantId succeeds
        update: vi.fn().mockResolvedValue({ ...approvedTenantWithoutFriend, lineFriendId: 'line-friend-001' }),
      },
      tenantRegistrationRequest: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'req-001',
          dormitoryId: 'dorm-001',
          status: 'approved',
          approvedTenantId: 'tenant-uuid-1',
          lineFollowerId: 'line-friend-001',
        }),
      },
    };

    const result = await findAuthoritativeActiveTenant({
      dormitoryId: 'dorm-001',
      auth: {
        userId: 'ag_user_grant-001',
      },
      client: mockPrisma,
    });

    expect(result).toBeDefined();
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: 'tenant-uuid-1' },
      data: { lineFriendId: 'line-friend-001' },
    });
  });

  it('fails closed and returns null if access grant belongs to another dormitory', async () => {
    const foreignGrant = {
      ...mockGrant,
      dormitoryId: 'other-dorm-999',
    };

    const mockPrisma = {
      dormitoryAccessGrant: {
        findUnique: vi.fn().mockResolvedValue(foreignGrant),
      },
      tenant: {
        findFirst: vi.fn(),
      },
    };

    const result = await findAuthoritativeActiveTenant({
      dormitoryId: 'dorm-001',
      auth: {
        userId: 'ag_user_grant-001',
      },
      client: mockPrisma,
    });

    expect(result).toBeNull();
    expect(mockPrisma.tenant.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed and returns null if no auth or no userId is provided', async () => {
    const mockPrisma = {
      tenant: { findFirst: vi.fn() },
    };

    const result1 = await findAuthoritativeActiveTenant({
      dormitoryId: 'dorm-001',
      auth: {} as any,
      client: mockPrisma,
    });
    expect(result1).toBeNull();

    const result2 = await findAuthoritativeActiveTenantForRequest(
      { auth: null },
      'dorm-001',
      mockPrisma
    );
    expect(result2).toBeNull();
  });
});
