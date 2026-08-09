import { Request } from 'express';
import type { AuthenticatedAuthContext } from './require-session.js';
import { AppError } from '../types/index.js';
import { DormitoryMemberEntity } from '../db/repositories/membership.repository.js';

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

export function resolveAuthoritativeDormitoryContext(req: Request): AuthoritativeDormitoryContext {
  const auth = req.auth;
  if (!auth || !auth.user || !auth.memberships) {
    throw new AppError('Authentication required.', 401, 'UNAUTHORIZED');
  }

  const urlUuidMatch = (req.originalUrl || req.url || '').match(/\/(?:properties|dormitories)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  const urlDormId = urlUuidMatch ? urlUuidMatch[1] : undefined;

  const requestedDormId =
    urlDormId ||
    (req.params?.dormitoryId as string) ||
    (req.headers['x-dormitory-id'] as string) ||
    (req.query?.dormitoryId as string);

  const activeMemberships = auth.memberships.filter((m) => (m.status || '').toLowerCase() === 'active');

  let targetMembership: DormitoryMemberEntity | undefined;

  if (requestedDormId) {
    targetMembership = activeMemberships.find((m) => m.dormitoryId === requestedDormId);
  } else {
    targetMembership = activeMemberships[0];
  }

  if (!targetMembership && requestedDormId) {
    const path = req.originalUrl || req.url || '';
    const isProvisionalOnboardingPath =
      path.includes('/api/v1/onboarding') ||
      path.includes('/line-oa') ||
      path.includes('/signatures');

    if (isProvisionalOnboardingPath) {
      targetMembership = {
        id: `provisional-${requestedDormId}`,
        dormitoryId: requestedDormId,
        userId: auth.userId,
        roleCode: 'OWNER',
        status: 'active',
        rolePermissions: ['onboarding:read', 'onboarding:write', 'line_oa:read', 'line_oa:write', 'line_oa:manage', 'signature:read', 'signature:write'],
      } as any;
    }
  }

  if (!targetMembership) {
    if (activeMemberships.length === 0) {
      throw new AppError('No active dormitory membership found for user.', 403, 'FORBIDDEN');
    } else {
      throw new AppError('Access denied for requested dormitory context.', 403, 'FORBIDDEN');
    }
  }

  if (!targetMembership) {
    throw new AppError('Dormitory membership not resolved.', 403, 'FORBIDDEN');
  }

  // Fail closed on role resolution
  const mem: DormitoryMemberEntity = targetMembership;
  const roleObj = (mem as any).role;
  const rawRoleCode = mem.roleCode || roleObj?.code;

  if (!rawRoleCode && !roleObj) {
    throw new AppError('Dormitory membership role is invalid or unassigned.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  const roleCode = String(rawRoleCode || '').toUpperCase();
  if (!roleCode) {
    throw new AppError('Dormitory membership role code is invalid.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  const rawPerms = mem.rolePermissions ?? roleObj?.permissions ?? (mem as any).permissions;
  const permissions = normalizeRolePermissions(rawPerms);

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
