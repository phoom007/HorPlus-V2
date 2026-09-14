/**
 * @license Apache-2.0
 * Server Runtime Stability & UUID Parameter Guard Unit Tests (SRU-01, SRU-02)
 */

import { describe, it, expect, vi } from 'vitest';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { createRequireDormitoryContextMiddleware } from '../../middleware/require-dormitory.js';
import { Request, Response } from 'express';

describe('Server Runtime Stability & UUID Parameter Guard (SRU-01 - SRU-02)', () => {
  describe('PrismaMembershipRepository UUID Guard (SRU-01)', () => {
    it('findByUserId returns empty array immediately for non-UUID synthetic userId without calling Prisma', async () => {
      const mockPrisma = {
        dormitoryMember: {
          findMany: vi.fn(),
        },
      } as any;

      const repo = new PrismaMembershipRepository(mockPrisma);
      const result = await repo.findByUserId('ag_user_f2a69e42-a5a2-4d53-891c-d1eae9b2af69');

      expect(result).toEqual([]);
      expect(mockPrisma.dormitoryMember.findMany).not.toHaveBeenCalled();
    });

    it('findByUserAndDormitory returns null immediately for non-UUID userId without calling Prisma', async () => {
      const mockPrisma = {
        dormitoryMember: {
          findFirst: vi.fn(),
        },
      } as any;

      const repo = new PrismaMembershipRepository(mockPrisma);
      const result = await repo.findByUserAndDormitory(
        'ag_user_f2a69e42-a5a2-4d53-891c-d1eae9b2af69',
        '20000001-0000-4000-8000-000000000002'
      );

      expect(result).toBeNull();
      expect(mockPrisma.dormitoryMember.findFirst).not.toHaveBeenCalled();
    });

    it('findByUserAndDormitory returns null immediately for non-UUID dormitoryId without calling Prisma', async () => {
      const mockPrisma = {
        dormitoryMember: {
          findFirst: vi.fn(),
        },
      } as any;

      const repo = new PrismaMembershipRepository(mockPrisma);
      const result = await repo.findByUserAndDormitory(
        '10000001-0000-4000-8000-000000000001',
        'invalid-dorm-id'
      );

      expect(result).toBeNull();
      expect(mockPrisma.dormitoryMember.findFirst).not.toHaveBeenCalled();
    });

    it('findById returns null immediately for non-UUID membershipId without calling Prisma', async () => {
      const mockPrisma = {
        dormitoryMember: {
          findUnique: vi.fn(),
        },
      } as any;

      const repo = new PrismaMembershipRepository(mockPrisma);
      const result = await repo.findById('mem_f2a69e42-a5a2-4d53-891c-d1eae9b2af69');

      expect(result).toBeNull();
      expect(mockPrisma.dormitoryMember.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('PrismaRoleRepository UUID Guard (SRU-01 / F-SRU-02)', () => {
    it('findById returns null immediately for non-UUID roleId without calling Prisma', async () => {
      const mockPrisma = {
        role: {
          findUnique: vi.fn(),
        },
      } as any;

      const repo = new PrismaRoleRepository(mockPrisma);
      const result = await repo.findById('role-staff');

      expect(result).toBeNull();
      expect(mockPrisma.role.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('Auth Context Membership Reuse in require-dormitory (SRU-02)', () => {
    it('reuses active synthetic membership from req.auth.memberships without querying repository', async () => {
      const mockMembershipRepo = {
        findByUserAndDormitory: vi.fn(),
      } as any;
      const mockRoleRepo = {
        findById: vi.fn().mockResolvedValue(null),
        findByCode: vi.fn().mockResolvedValue({
          code: 'STAFF',
          permissions: { meters: ['view', 'record'], maintenance: ['view', 'update'] },
        }),
      } as any;

      const middleware = createRequireDormitoryContextMiddleware(mockMembershipRepo, mockRoleRepo);

      const req = {
        headers: {
          'x-dormitory-id': '20000001-0000-4000-8000-000000000002',
          'x-request-id': 'req-test-uuid-reuse',
        },
        params: {},
        auth: {
          userId: 'ag_user_f2a69e42-a5a2-4d53-891c-d1eae9b2af69',
          sessionId: 'test-session-id',
          memberships: [
            {
              id: 'mem_f2a69e42-a5a2-4d53-891c-d1eae9b2af69',
              dormitoryId: '20000001-0000-4000-8000-000000000002',
              dormitoryName: 'Comprehensive Manor',
              userId: 'ag_user_f2a69e42-a5a2-4d53-891c-d1eae9b2af69',
              roleId: 'role-staff',
              roleCode: 'STAFF',
              rolePermissions: { meters: ['view', 'record'], maintenance: ['view', 'update'] },
              status: 'active',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        },
      } as unknown as Request;

      let statusCode = 200;
      const res = {
        status: vi.fn((code: number) => {
          statusCode = code;
          return res;
        }),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockMembershipRepo.findByUserAndDormitory).not.toHaveBeenCalled();
      expect(req.dormitoryContext).toBeDefined();
      expect(req.dormitoryContext?.dormitoryId).toBe('20000001-0000-4000-8000-000000000002');
      expect(req.dormitoryContext?.roleCode).toBe('STAFF');
      expect(req.dormitoryContext?.permissions).toEqual({
        meters: ['view', 'record'],
        maintenance: ['view', 'update'],
      });
    });

    it('returns 403 DORMITORY_ACCESS_DENIED safely when synthetic user has no membership in target dormitory', async () => {
      const mockMembershipRepo = {
        findByUserAndDormitory: vi.fn().mockResolvedValue(null),
      } as any;
      const mockRoleRepo = {
        findById: vi.fn(),
        findByCode: vi.fn(),
      } as any;

      const middleware = createRequireDormitoryContextMiddleware(mockMembershipRepo, mockRoleRepo);

      const req = {
        headers: {
          'x-dormitory-id': '99999999-0000-4000-8000-000000000002',
          'x-request-id': 'req-test-uuid-unauth',
        },
        params: {},
        auth: {
          userId: 'ag_user_f2a69e42-a5a2-4d53-891c-d1eae9b2af69',
          sessionId: 'test-session-id',
          memberships: [],
        },
      } as unknown as Request;

      let statusCode = 200;
      let jsonBody: any = null;
      const res = {
        status: vi.fn((code: number) => {
          statusCode = code;
          return res;
        }),
        json: vi.fn((body: any) => {
          jsonBody = body;
          return res;
        }),
      } as unknown as Response;

      const next = vi.fn();

      await middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusCode).toBe(403);
      expect(jsonBody.error.code).toBe('DORMITORY_ACCESS_DENIED');
    });
  });
});
