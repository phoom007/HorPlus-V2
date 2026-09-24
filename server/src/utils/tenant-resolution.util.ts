/**
 * @license Apache-2.0
 * Unified Authoritative Tenant Resolution Utility
 * Resolves active tenant record across standard UUID user sessions and LINE ACCESS_GRANT sessions (ag_user_).
 */
import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';

export interface AuthoritativeTenantLookupOptions {
  dormitoryId: string;
  auth: {
    userId?: string;
    session?: { accessGrantId?: string };
    lineFriendId?: string;
    memberships?: any[];
    user?: { phone?: string; name?: string; email?: string };
  };
  client?: PrismaClient | any;
}

export async function findAuthoritativeActiveTenant(options: AuthoritativeTenantLookupOptions) {
  const { dormitoryId, auth, client } = options;
  const prisma = client || getPrismaClient();
  const userId = auth?.userId;
  if (!userId || !dormitoryId) {
    return null;
  }

  const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId);

  // 1. Direct lookup by linkedUserId if userId is a valid UUID
  if (isUuid) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        linkedUserId: userId,
        dormitoryId,
        deletedAt: null,
        status: 'active',
      },
    });
    if (tenant) {
      return tenant;
    }
  }

  // 2. Lookup via access grant if userId starts with ag_user_ or session has accessGrantId
  const accessGrantId = auth.session?.accessGrantId || (userId.startsWith('ag_user_') ? userId.replace('ag_user_', '') : null);
  if (accessGrantId) {
    const grant = await prisma.dormitoryAccessGrant.findUnique({
      where: { id: accessGrantId },
      include: { lineFriend: true },
    });

    if (grant && grant.status === 'ACTIVE' && grant.dormitoryId === dormitoryId && (grant.roleCode || '').toUpperCase() === 'TENANT') {
      const targetFriendId = grant.lineFriendId || grant.lineFriend?.id;
      if (targetFriendId) {
        // Direct active tenant with lineFriendId
        const tenant = await prisma.tenant.findFirst({
          where: {
            dormitoryId,
            lineFriendId: targetFriendId,
            deletedAt: null,
            status: 'active',
          },
        });
        if (tenant) {
          return tenant;
        }

        // Approved registration request linking this LINE friend
        const regReq = await prisma.tenantRegistrationRequest.findFirst({
          where: {
            dormitoryId,
            status: 'approved',
            approvedTenantId: { not: null },
            lineFollowerId: targetFriendId,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (regReq?.approvedTenantId) {
          const approvedTenant = await prisma.tenant.findFirst({
            where: {
              id: regReq.approvedTenantId,
              dormitoryId,
              deletedAt: null,
              status: 'active',
            },
          });
          if (approvedTenant) {
            // Self-heal lineFriendId if not yet set
            if (!approvedTenant.lineFriendId) {
              await prisma.tenant.update({
                where: { id: approvedTenant.id },
                data: { lineFriendId: targetFriendId },
              });
            }
            return approvedTenant;
          }
        }
      }
    }
  }

  // 3. Fallback to auth.lineFriendId if available in auth object
  if (auth.lineFriendId) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        dormitoryId,
        lineFriendId: auth.lineFriendId,
        deletedAt: null,
        status: 'active',
      },
    });
    if (tenant) {
      return tenant;
    }
  }

  return null;
}

export async function findAuthoritativeActiveTenantForRequest(req: any, dormitoryId?: string, client?: any) {
  const auth = req.auth;
  if (!auth) return null;
  const dormId =
    dormitoryId ||
    req.dormitoryContext?.dormitoryId ||
    req.activeDormitoryId ||
    req.auth?.memberships?.[0]?.dormitoryId;
  if (!dormId) return null;
  return findAuthoritativeActiveTenant({
    dormitoryId: dormId,
    auth,
    client,
  });
}
