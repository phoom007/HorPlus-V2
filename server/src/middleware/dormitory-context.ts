import { Request } from 'express';
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
    (req.params?.dormitoryId as string);

  let targetMembership: DormitoryMemberEntity | undefined;

  if (requestedDormId) {
    targetMembership = activeMemberships.find((m) => m.dormitoryId === requestedDormId);
    if (!targetMembership) {
      throw new AppError('Access denied for requested dormitory context.', 403, 'FORBIDDEN');
    }
  } else {
    if (activeMemberships.length === 1) {
      targetMembership = activeMemberships[0];
    } else {
      throw new AppError('Dormitory context selector required (x-dormitory-id header).', 400, 'DORMITORY_ID_REQUIRED');
    }
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

  const permissions: string[] = Array.isArray(roleObj?.permissions)
    ? roleObj.permissions
    : (Array.isArray((targetMembership as any).permissions) ? (targetMembership as any).permissions : []);

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
