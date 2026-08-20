import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeRolePermissions, resolveAuthoritativeDormitoryContext } from '../src/middleware/dormitory-context.js';
import { InMemoryRoleRepository } from '../src/db/repositories/role.repository.js';
import { AccessGrantService } from '../src/services/access-grant.service.js';
import { MaintenanceService } from '../src/services/maintenance.service.js';
import { AppError } from '../src/types/index.js';
import { normalizeRole } from '../../src/utils/role.js';

const VALID_DORM_ID = '11111111-1111-4111-8111-111111111111';
const VALID_FRIEND_ID = '22222222-2222-4222-8222-222222222222';

describe('Commit A: Canonical Three-Role RBAC & Legacy Deprecation Proofs', () => {
  let roleRepo: InMemoryRoleRepository;

  beforeEach(() => {
    roleRepo = new InMemoryRoleRepository();
  });

  describe('1. Role Repository & System Role Definitions', () => {
    it('seeds exactly OWNER, MANAGER, and STAFF (no FINANCE, no TECH)', async () => {
      const systemRoles = await roleRepo.getSystemRoles();
      const codes = systemRoles.map(r => r.code);
      expect(codes).toEqual(['OWNER', 'MANAGER', 'STAFF']);
      expect(codes).not.toContain('FINANCE');
      expect(codes).not.toContain('TECH');
    });

    it('MANAGER role includes document:read on tenants domain', async () => {
      const manager = await roleRepo.findByCode('MANAGER');
      expect(manager).toBeDefined();
      expect(manager?.permissions.tenants).toContain('document:read');
      expect(manager?.permissions.maintenance).toContain('close');
    });

    it('STAFF role contains view-only tenants and cannot close maintenance', async () => {
      const staff = await roleRepo.findByCode('STAFF');
      expect(staff).toBeDefined();
      expect(staff?.permissions.tenants).toEqual(['view']);
      expect(staff?.permissions.tenants).not.toContain('document:read');
      expect(staff?.permissions.maintenance).toEqual(['view', 'update']);
      expect(staff?.permissions.maintenance).not.toContain('close');
    });
  });

  describe('2. Access Grant Service Role Whitelist Validation', () => {
    const mockPrisma: any = {
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
          $executeRaw: vi.fn(),
          dormitoryLineFriend: { findFirst: vi.fn().mockResolvedValue({ id: VALID_FRIEND_ID, dormitoryId: VALID_DORM_ID, displayName: 'Staff Friend' }) },
          dormitoryAccessGrant: {
            findFirst: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue({ id: 'grant-1', roleCode: 'STAFF', lineFriend: { id: VALID_FRIEND_ID }, dormitory: { id: VALID_DORM_ID, name: 'Dorm' } }),
            update: vi.fn().mockResolvedValue({ id: 'grant-1', roleCode: 'STAFF' }),
          },
          dormitoryMember: { count: vi.fn().mockResolvedValue(1) },
          auditLog: { create: vi.fn().mockResolvedValue({ id: 'log-1' }) },
        });
      }),
    };

    it('allows assigning canonical roles: OWNER, MANAGER, STAFF', async () => {
      const grantService = new AccessGrantService(mockPrisma);
      
      for (const validRole of ['OWNER', 'MANAGER', 'STAFF'] as const) {
        await expect(grantService.createAccessGrant(VALID_DORM_ID, VALID_FRIEND_ID, validRole, 'usr_owner')).resolves.toBeDefined();
      }
    });

    it('strictly rejects assigning deprecated TECH role with HTTP 400 INVALID_ROLE_CODE', async () => {
      const grantService = new AccessGrantService(mockPrisma);
      await expect(grantService.createAccessGrant(VALID_DORM_ID, VALID_FRIEND_ID, 'TECH' as any, 'usr_owner'))
        .rejects.toThrow('Role must be OWNER, MANAGER, or STAFF');
    });

    it('strictly rejects assigning deprecated FINANCE role with HTTP 400 INVALID_ROLE_CODE', async () => {
      const grantService = new AccessGrantService(mockPrisma);
      await expect(grantService.createAccessGrant(VALID_DORM_ID, VALID_FRIEND_ID, 'FINANCE' as any, 'usr_owner'))
        .rejects.toThrow('Role must be OWNER, MANAGER, or STAFF');
    });

    it('strictly rejects changing grant role to TECH or FINANCE', async () => {
      const grantService = new AccessGrantService(mockPrisma);
      await expect(grantService.changeGrantRole(VALID_DORM_ID, 'grant-1', 'TECH' as any, 'usr_owner'))
        .rejects.toThrow('Role must be OWNER, MANAGER, or STAFF');
      await expect(grantService.changeGrantRole(VALID_DORM_ID, 'grant-1', 'FINANCE' as any, 'usr_owner'))
        .rejects.toThrow('Role must be OWNER, MANAGER, or STAFF');
    });
  });

  describe('3. Stale Session & Deprecated Role Claim Defense', () => {
    it('throws 403 ROLE_DEPRECATED for stale session containing FINANCE roleCode', async () => {
      const req: any = {
        auth: {
          user: { id: 'usr-fin' },
          userId: 'usr-fin',
          memberships: [
            {
              id: 'mem-fin',
              dormitoryId: VALID_DORM_ID,
              roleCode: 'FINANCE',
              status: 'active',
            },
          ],
        },
        headers: { 'x-dormitory-id': VALID_DORM_ID },
      };

      await expect(resolveAuthoritativeDormitoryContext(req)).rejects.toThrowError(
        expect.objectContaining({
          code: 'ROLE_DEPRECATED',
          statusCode: 403,
        })
      );
    });

    it('remaps legacy session containing TECH to STAFF', async () => {
      const req: any = {
        auth: {
          user: { id: 'usr-tech' },
          userId: 'usr-tech',
          memberships: [
            {
              id: 'mem-tech',
              dormitoryId: VALID_DORM_ID,
              roleCode: 'TECH',
              status: 'active',
              permissions: { maintenance: ['view', 'update'] },
            },
          ],
        },
        headers: { 'x-dormitory-id': VALID_DORM_ID },
      };

      const context = await resolveAuthoritativeDormitoryContext(req);
      expect(context.roleCode).toBe('STAFF');
      expect(req.auth.role).toBe('STAFF');
    });
  });

  describe('4. Maintenance Role Restrictions', () => {
    it('throws FORBIDDEN if STAFF attempts to close a maintenance request', async () => {
      const mockRepo: any = {
        findById: vi.fn().mockResolvedValue({
          id: 'req-1',
          dormitoryId: VALID_DORM_ID,
          status: 'resolved',
        }),
      };
      const maintenanceService = new MaintenanceService(mockRepo);

      await expect(
        maintenanceService.updateStatus({
          dormitoryId: VALID_DORM_ID,
          requestId: 'req-1',
          status: 'closed',
          actorType: 'staff',
          actorRoleCode: 'STAFF',
        })
      ).rejects.toThrow('FORBIDDEN: STAFF role is not permitted to close maintenance requests');
    });
  });

  describe('5. Client Role Normalizer (Fail-Closed)', () => {
    it('normalizes OWNER to owner', () => {
      expect(normalizeRole('OWNER')).toBe('owner');
      expect(normalizeRole('เจ้าของหอพัก')).toBe('owner');
    });

    it('normalizes MANAGER to manager', () => {
      expect(normalizeRole('MANAGER')).toBe('manager');
      expect(normalizeRole('ผู้จัดการ')).toBe('manager');
    });

    it('normalizes STAFF and legacy TECH to staff', () => {
      expect(normalizeRole('STAFF')).toBe('staff');
      expect(normalizeRole('TECH')).toBe('staff');
      expect(normalizeRole('ช่างซ่อม')).toBe('staff');
      expect(normalizeRole('พนักงานทั่วไป')).toBe('staff');
    });

    it('fails closed and returns null for FINANCE', () => {
      expect(normalizeRole('FINANCE')).toBeNull();
      expect(normalizeRole('ROLE-FINANCE')).toBeNull();
      expect(normalizeRole('เจ้าหน้าที่การเงิน')).toBeNull();
    });
  });
});
