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

  const activeMemberships = auth.memberships.filter((m) => m.status === 'active');
  if (activeMemberships.length === 0) {
    throw new AppError('No active dormitory membership found for user.', 403, 'FORBIDDEN');
  }

  const requestedDormId =
    (req.headers['x-dormitory-id'] as string) ||
    (req.query?.dormitoryId as string) ||
    (req.params?.dormitoryId as string) ||
    (req.params?.id as string);

  let targetMembership: DormitoryMemberEntity | undefined;

  if (requestedDormId) {
    targetMembership = activeMemberships.find((m) => m.dormitoryId === requestedDormId);
    if (!targetMembership) {
      throw new AppError('Access denied for requested dormitory context.', 403, 'FORBIDDEN');
    }
  } else {
    targetMembership = activeMemberships[0];
  }

  // Fail closed on role resolution
  const roleObj = (targetMembership as any).role;
  const rawRoleCode = targetMembership.roleCode || roleObj?.code;

  if (!rawRoleCode && !roleObj) {
    throw new AppError('Dormitory membership role is invalid or unassigned.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  const roleCode = String(rawRoleCode || '').toUpperCase();
  if (!roleCode) {
    throw new AppError('Dormitory membership role code is invalid.', 403, 'MEMBERSHIP_ROLE_INVALID');
  }

  const rawPerms = targetMembership.rolePermissions ?? roleObj?.permissions ?? (targetMembership as any).permissions;
  const permissions = normalizeRolePermissions(rawPerms);

  const context: AuthoritativeDormitoryContext = {
    dormitoryId: targetMembership.dormitoryId,
    membership: targetMembership,
    roleCode,
    userId: auth.userId,
    memberId: targetMembership.id,
    permissions,
  };

  (req as any).dormitoryContext = context;
  if (req.auth) {
    req.auth.dormitoryId = context.dormitoryId;
    req.auth.role = context.roleCode;
  }

  return context;
}
