import { Request } from 'express';
import type { AuthenticatedAuthContext } from './require-session.js';
import { AppError } from '../types/index.js';
import { DormitoryMemberEntity } from '../db/repositories/membership.repository.js';
import { getPrismaClient } from '../db/prisma.js';

export interface AuthoritativeDormitoryContext {
  dormitoryId: string;
  membership: DormitoryMemberEntity;
  roleCode: string;
  userId: string;
  memberId?: string;
  permissions: string[];
}

export function normalizeRolePermissions(rawPermissions: any): string[] {
  if (!rawPermissions) return [];

  const normalized = new Set<string>();

  if (Array.isArray(rawPermissions)) {
    for (const item of rawPermissions) {
      if (typeof item === 'string' && item.trim()) {
        normalized.add(item.trim());
      }
    }
  } else if (typeof rawPermissions === 'object' && rawPermissions !== null) {
    for (const [domain, actions] of Object.entries(rawPermissions)) {
      if (domain === '*' && Array.isArray(actions) && actions.includes('*')) {
        normalized.add('*');
      } else if (Array.isArray(actions)) {
        for (const action of actions) {
          if (typeof action === 'string') {
            if (domain === '*') {
              normalized.add('*');
            } else if (action === '*') {
              normalized.add(`${domain}:*`);
            } else {
              normalized.add(`${domain}:${action}`);
            }
          }
        }
      }
    }
  }

  return Array.from(normalized);
}

export async function resolveAuthoritativeDormitoryContext(req: Request): Promise<AuthoritativeDormitoryContext> {
  const auth = req.auth;
  if (!auth || !auth.user || !auth.memberships) {
    throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  }

  const urlUuidMatch = (req.originalUrl || req.url || '').match(/\/(?:properties|dormitories)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  const urlDormId = urlUuidMatch ? urlUuidMatch[1] : undefined;

  const rawHeader = req.headers['x-dormitory-id'];
  const headerDormId = Array.isArray(rawHeader) ? rawHeader.join(',') : (rawHeader as string | undefined);

  const rawRequested =
    urlDormId ||
    (req.params?.dormitoryId as string) ||
    headerDormId ||
    (req.query?.dormitoryId as string);

  let requestedDormId: string | undefined;

  if (rawRequested !== undefined && rawRequested !== '') {
    const trimmed = String(rawRequested).trim();
    // Strict UUID format verification: rejects malformed strings, comma-separated duplicates, and non-UUID input
    const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!UUID_REGEX.test(trimmed)) {
      throw new AppError('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID', 400, 'INVALID_ID_FORMAT');
    }
    requestedDormId = trimmed;
  }

  const activeMemberships = auth.memberships.filter((m) => (m.status || '').toLowerCase() === 'active');

  let targetMembership: DormitoryMemberEntity | undefined;

  if (requestedDormId) {
    targetMembership = activeMemberships.find((m) => m.dormitoryId === requestedDormId);
  } else {
    targetMembership = activeMemberships[0];
  }

  // SEC-01: DB-backed authoritative provisional ownership resolver (NEVER route-string based)
  if (!targetMembership && requestedDormId) {
    const prisma = getPrismaClient();
    if (prisma) {
      const dorm = await prisma.dormitory.findUnique({
        where: { id: requestedDormId },
        select: { id: true, status: true, createdByUserId: true, name: true },
      });

      // Require ALL: dormitory exists, status is setup_pending, AND createdByUserId matches authenticated user
      if (dorm && dorm.status === 'setup_pending' && dorm.createdByUserId === auth.userId) {
        targetMembership = {
          id: `provisional-${requestedDormId}`,
          dormitoryId: requestedDormId,
          dormitoryName: dorm.name,
          dormitoryStatus: 'setup_pending',
          userId: auth.userId,
          roleCode: 'OWNER',
          status: 'active',
          rolePermissions: [
            'onboarding:read',
            'onboarding:write',
            'line_oa:read',
            'line_oa:write',
            'line_oa:manage',
            'signature:read',
            'signature:write',
            'dormitory:view',
            'dormitory:update',
          ],
        } as any;
      }
    }
  }

  if (!targetMembership) {
    if (activeMemberships.length === 0) {
      throw new AppError('No active dormitory membership found for user.', 403, 'FORBIDDEN');
    } else {
      throw new AppError('Access denied for requested dormitory context.', 403, 'FORBIDDEN');
    }
  }

  // Fail closed on role resolution
  const mem: DormitoryMemberEntity = targetMembership;
  const roleObj = (mem as any).role;
  const rawRoleCode = mem.roleCode || roleObj?.code;

  if (!rawRoleCode && !roleObj) {
    throw new AppError('Dormitory membership role is invalid or unassigned.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  let roleCode = String(rawRoleCode || '').toUpperCase();
  if (!roleCode) {
    throw new AppError('Dormitory membership role code is invalid.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  // Defend against deprecated role claims in stale sessions
  if (roleCode === 'FINANCE') {
    throw new AppError('The FINANCE role has been deprecated and revoked. Please contact the dormitory owner.', 403, 'ROLE_DEPRECATED');
  }

  // Remap legacy TECH session claims to STAFF
  if (roleCode === 'TECH') {
    roleCode = 'STAFF';
  }

  if (!['OWNER', 'MANAGER', 'STAFF', 'TENANT'].includes(roleCode)) {
    throw new AppError('Dormitory membership role is unrecognized.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  const rawPerms = mem.rolePermissions ?? roleObj?.permissions ?? (mem as any).permissions;
  let permissions = normalizeRolePermissions(rawPerms);

  // Non-OWNER roles must not retain global '*' wildcard authority
  if (roleCode !== 'OWNER') {
    permissions = permissions.filter((p) => p !== '*');
  }

  // Centralized Manager-domain role normalization policy (MGR-01, MGR-02)
  if (roleCode === 'MANAGER') {
    const managerOperationalPermissions = [
      // 1. Tenants, Contracts, Occupancy, Move-Out, Settlements
      'tenants:view',
      'tenants:create',
      'tenants:update',
      'tenants:archive',
      'tenants:document:read',
      'tenants:document:write',
      'tenant:view',
      'tenant:create',
      'tenant:update',
      'tenant:archive',
      'tenant:document:read',
      'tenant:document:write',
      'tenant:read',
      'tenant:write',
      'tenants:read',
      'tenants:write',
      'contracts:view',
      'contracts:create',
      'contracts:update',
      'contracts:delete',
      'contracts:manage',
      'contracts:write',
      'contract:read',
      'contract:write',
      'contract:create',
      'contract:update',
      'contract:delete',
      'occupancy:view',
      'occupancy:read',
      'occupancy:write',
      'moveout:write',
      'moveout:read',
      'moveout:view',
      'move_out:create',
      'settlement:read',
      'settlement:write',
      'daily_stays:view',
      'daily_stays:create',
      'daily_stays:update',
      'daily_stay:read',
      'daily_stay:write',

      // 2. Meters Domain
      'meters:view',
      'meters:read',
      'meter:read',
      'meters:record',
      'meters:write',
      'meter:write',

      // 3. Billing & Bills Domain (including F-01 billing_settings:view/read)
      'bills:view',
      'bills:read',
      'bill:read',
      'bills:generate',
      'bills:create',
      'bills:write',
      'bills:cancel',
      'bill:create',
      'bill:write',
      'billing:view',
      'billing:read',
      'billing:write',
      'billing:manage',
      'billing_cycles:view',
      'billing_cycles:create',
      'billing_cycles:update',
      'billing_cycle:read',
      'billing_cycle:write',
      'billing_cycle:create',
      'billing_settings:view',
      'billing_settings:read',

      // 4. Payments & Receipts Domain
      'payments:view',
      'payments:read',
      'payment:read',
      'payments:create',
      'payments:write',
      'payments:manage',
      'payment:write',
      'payment:create',
      'receipts:view',
      'receipts:read',
      'receipt:read',
      'receipts:manage',
      'receipt:write',

      // 5. Property (Rooms & Buildings) Domain
      'rooms:view',
      'rooms:read',
      'room:read',
      'rooms:create',
      'rooms:update',
      'rooms:delete',
      'rooms:manage',
      'rooms:write',
      'room:write',
      'room:create',
      'room:update',
      'room:delete',
      'buildings:view',
      'buildings:read',
      'building:read',
      'buildings:create',
      'buildings:update',
      'buildings:delete',
      'buildings:manage',
      'buildings:write',
      'building:write',
      'building:create',
      'building:update',
      'building:delete',
      'property:read',
      'property:write',
      'property:manage',

      // 6. Maintenance Domain
      'maintenance:view',
      'maintenance:read',
      'maintenance:create',
      'maintenance:update',
      'maintenance:close',
      'maintenance:write',
      'maintenance:delete',

      // 7. Announcements Domain
      'announcements:view',
      'announcements:read',
      'announcement:read',
      'announcements:create',
      'announcements:update',
      'announcements:delete',
      'announcements:manage',
      'announcements:write',
      'announcement:write',
      'announcement:create',
      'announcement:update',
      'announcement:delete',

      // 8. Reports & Billboard Domain
      'reports:view',
      'reports:read',
      'report:view',
      'report:read',
      'billboard:view',
      'billboard:read',
      'analytics:view',

      // 9. Dormitory Core View
      'dormitory:view',
      'dormitory:read',

      // 10. LINE Official Account Configuration Domain (MLD-01)
      'line_oa:view',
      'line_oa:read',
      'line_oa:write',
      'line_oa:manage',

      // 11. Subscription Domain (SPEC-SUB-MR-01)
      'subscription:view',
      'subscription:read',
      'subscription:write',
      'subscription:manage',
    ];
    const permSet = new Set(permissions);
    for (const p of managerOperationalPermissions) {
      permSet.add(p);
    }
    // Strictly preserve owner-only security exclusions (MGR-02)
    for (const p of Array.from(permSet)) {
      if (
        p === '*' ||
        p.startsWith('payment_settings:') ||
        p.startsWith('staff:') ||
        p.startsWith('users:') ||
        p.startsWith('access_grants:') ||
        p === 'dormitory:delete' ||
        p === 'dormitory:transfer'
      ) {
        permSet.delete(p);
      }
    }
    permissions = Array.from(permSet);
  } else if (roleCode === 'STAFF') {
    // Remove all Tenant-domain mutation and document permissions, keeping only view/read
    const permSet = new Set(permissions);
    for (const p of Array.from(permSet)) {
      if (p.startsWith('tenants:') || p.startsWith('tenant:')) {
        if (!['tenants:view', 'tenant:view', 'tenants:read', 'tenant:read'].includes(p)) {
          permSet.delete(p);
        }
      }
    }
    permSet.add('tenants:view');
    permSet.add('tenant:view');
    permSet.add('meters:view');
    permSet.add('meters:record');
    permSet.add('meter:write');
    permSet.add('maintenance:view');
    permSet.add('maintenance:update');
    permSet.add('maintenance:write');
    permSet.add('maintenance:create');
    permissions = Array.from(permSet);
  } else if (roleCode === 'TENANT') {
    // Remove ALL Owner Tenant-domain permissions
    permissions = permissions.filter(
      (p) => !p.startsWith('tenants:') && !p.startsWith('tenant:')
    );
  }

  const context: AuthoritativeDormitoryContext = {
    dormitoryId: mem.dormitoryId,
    membership: mem,
    roleCode,
    userId: auth.userId,
    memberId: mem.id,
    permissions,
  };

  (req as any).dormitoryContext = context;
  if (req.auth) {
    req.auth.dormitoryId = context.dormitoryId;
    req.auth.role = context.roleCode;
  }

  return context;
}
