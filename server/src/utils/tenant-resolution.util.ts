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

  if (typeof prisma.$executeRaw === 'function') {
    try {
      await prisma.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, false)`;
    } catch {}
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

export async function resolveAuthoritativeTenantContext(req: any, client?: any) {
  const basePrisma = client || getPrismaClient();
  const auth = req.auth;
  if (!auth?.userId) {
    return { error: { code: 'SESSION_REQUIRED', message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ', statusCode: 401 } };
  }

  const runWithClient = async (prisma: any) => {
    let dormId =
      req.dormitoryContext?.dormitoryId ||
      req.activeDormitoryId ||
      req.auth?.memberships?.find((m: any) => (m.status || '').toLowerCase() === 'active')?.dormitoryId;

    const userId = String(auth.userId);
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(userId);
    const accessGrantId =
      auth.session?.accessGrantId || (userId.startsWith('ag_user_') ? userId.replace('ag_user_', '') : null);

    if (!dormId && accessGrantId && prisma.dormitoryAccessGrant?.findUnique) {
      const grant = await prisma.dormitoryAccessGrant.findUnique({
        where: { id: accessGrantId },
      });
      if (grant && grant.status === 'ACTIVE') {
        dormId = grant.dormitoryId;
      }
    }

    if (!dormId && isUuid && prisma.dormitoryMember?.findMany) {
      const members = await prisma.dormitoryMember.findMany({
        where: { userId, status: 'active' },
      });
      if (members.length > 0) {
        dormId = members[0].dormitoryId;
      }
    }

    if (!dormId) {
      return { error: { code: 'FORBIDDEN', message: 'ไม่พบข้อมูลหอพักของผู้เช่า', statusCode: 403 } };
    }

    if (typeof prisma.$executeRaw === 'function') {
      try {
        await prisma.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormId}, true)`;
      } catch {}
    }

    let primaryTenant = await findAuthoritativeActiveTenant({
      dormitoryId: dormId,
      auth,
      client: prisma,
    });

    if (!primaryTenant && auth.user?.phone && prisma.tenant?.findFirst) {
      primaryTenant = await prisma.tenant.findFirst({
        where: {
          dormitoryId: dormId,
          phone: auth.user.phone,
          deletedAt: null,
          status: 'active',
        },
      });
    }

    if (!primaryTenant) {
      return { error: { code: 'FORBIDDEN', message: 'ไม่พบข้อมูลผู้เช่าที่ใช้งานอยู่ในหอพักนี้', statusCode: 403 } };
    }

    let tenants = [primaryTenant];
    if (prisma.tenant?.findMany) {
      const orFilters: any[] = [];
      if (isUuid) orFilters.push({ linkedUserId: userId });
      if (primaryTenant.lineFriendId) orFilters.push({ lineFriendId: primaryTenant.lineFriendId });
      if (orFilters.length > 0) {
        const allTenants = await prisma.tenant.findMany({
          where: {
            dormitoryId: dormId,
            deletedAt: null,
            status: 'active',
            OR: orFilters,
          },
        });
        if (Array.isArray(allTenants) && allTenants.length > 0) {
          tenants = allTenants;
        }
      }
    }

    return {
      tenant: primaryTenant,
      tenants,
      dormitoryId: dormId,
    };
  };

  if (!client && typeof basePrisma.$transaction === 'function') {
    return basePrisma.$transaction(async (tx: any) => runWithClient(tx));
  }
  return runWithClient(basePrisma);
}

export function getTenantIdsForPortalContext(ctx: any): string[] {
  if (Array.isArray(ctx?.tenants) && ctx.tenants.length > 0) {
    return ctx.tenants.map((t: any) => String(t.id));
  }
  if (ctx?.tenant?.id) {
    return [String(ctx.tenant.id)];
  }
  return [];
}

