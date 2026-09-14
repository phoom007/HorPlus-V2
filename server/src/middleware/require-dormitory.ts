import { Request, Response, NextFunction } from 'express';
import { IMembershipRepository, DormitoryMemberEntity } from '../db/repositories/membership.repository.js';
import { IRoleRepository, RolePermissions } from '../db/repositories/role.repository.js';

export interface DormitoryContext {
  dormitoryId: string;
  memberId: string;
  roleCode: string;
  permissions: RolePermissions;
}

declare global {
  namespace Express {
    interface Request {
      dormitoryContext?: DormitoryContext;
    }
  }
}

export function createRequireDormitoryContextMiddleware(
  membershipRepo: IMembershipRepository,
  roleRepo: IRoleRepository
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
    const dormitoryId = req.params.dormitoryId || (req.headers['x-dormitory-id'] as string | undefined);

    if (!dormitoryId) {
      return res.status(400).json({
        error: {
          code: 'DORMITORY_HEADER_REQUIRED',
          message: 'กรุณาระบุ X-Dormitory-Id ใน Request Header',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (!req.auth?.userId) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    // 1. Check if auth session context already contains an active membership for this dormitory (e.g. synthetic membership from access grant)
    let member: DormitoryMemberEntity | null | undefined = req.auth.memberships?.find(
      (m) => m.dormitoryId === dormitoryId && m.status === 'active'
    );

    // 2. If not found in session context, query repository defensively
    if (!member) {
      try {
        member = await membershipRepo.findByUserAndDormitory(req.auth.userId, dormitoryId);
      } catch {
        member = null;
      }
    }

    if (!member) {
      try {
        const { getPrismaClient } = await import('../db/prisma.js');
        const prisma = getPrismaClient();
        const dorm = await prisma.dormitory.findUnique({
          where: { id: dormitoryId },
          select: { status: true, createdByUserId: true },
        });
        if (dorm && dorm.status === 'setup_pending' && dorm.createdByUserId === req.auth.userId) {
          member = {
            id: `provisional-${dormitoryId}`,
            dormitoryId,
            userId: req.auth.userId,
            roleCode: 'OWNER',
            status: 'active',
          } as any;
        }
      } catch {}
    }

    if (!member) {
      return res.status(403).json({
        error: {
          code: 'DORMITORY_ACCESS_DENIED',
          message: 'ท่านไม่มีสิทธิ์เข้าถึงข้อมูลของหอพักนี้',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (member.status === 'suspended') {
      return res.status(403).json({
        error: {
          code: 'MEMBERSHIP_SUSPENDED',
          message: 'สมาชิกภาพของท่านในหอพักนี้ถูกระงับชั่วคราว',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    if (member.status !== 'active') {
      return res.status(403).json({
        error: {
          code: 'DORMITORY_ACCESS_DENIED',
          message: 'สมาชิกภาพของท่านยังไม่เปิดใช้งาน',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    let role = null;
    if (member.roleId) {
      try {
        role = await roleRepo.findById(member.roleId);
      } catch {
        role = null;
      }
    }
    if (!role && member.roleCode) {
      try {
        role = await roleRepo.findByCode(member.roleCode, member.dormitoryId);
      } catch {
        role = null;
      }
    }

    const roleCode = role?.code || member.roleCode || 'STAFF';
    const permissions: RolePermissions =
      (role?.permissions as RolePermissions) ||
      (member.rolePermissions as any) ||
      { rooms: ['view'] };

    req.dormitoryContext = {
      dormitoryId: member.dormitoryId,
      memberId: member.id,
      roleCode,
      permissions,
    };

    next();
  };
}

export function createRequireActiveDormitoryMiddleware(prisma: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
    const dormitoryId = req.dormitoryContext?.dormitoryId || req.params.dormitoryId || (req.headers['x-dormitory-id'] as string | undefined);

    if (!dormitoryId) {
      return next();
    }

    try {
      const dorm = await prisma.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { status: true },
      });

      const path = req.originalUrl || req.url || '';
      const isOnboardingSetupPath = path.includes('/signatures') || path.includes('/line-oa') || path.includes('/onboarding');

      if (dorm && dorm.status === 'setup_pending' && !isOnboardingSetupPath) {
        return res.status(403).json({
          error: {
            code: 'DORMITORY_SETUP_PENDING',
            message: 'หอพักนี้ยังอยู่ในขั้นตอนการลงทะเบียน กรุณาลงทะเบียนให้เสร็จสิ้นก่อนใช้งาน',
            fieldErrors: null,
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
      }

      next();
    } catch (err: any) {
      return res.status(500).json({
        error: {
          code: 'DORMITORY_STATUS_CHECK_FAILED',
          message: 'เกิดข้อผิดพลาดในการตรวจสอบสถานะหอพัก',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };
}

