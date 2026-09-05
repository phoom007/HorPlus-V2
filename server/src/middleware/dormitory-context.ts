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

  // Centralized Tenant-domain role normalization policy
  if (roleCode === 'MANAGER') {
    const managerTenantPermissions = [
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
    ];
    const permSet = new Set(permissions);
    for (const p of managerTenantPermissions) {
      permSet.add(p);
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
