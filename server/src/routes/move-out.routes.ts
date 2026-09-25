import { Router, Request, Response, NextFunction } from 'express';
import { moveOutService } from '../services/move-out.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { AppError } from '../types/index.js';
import { getPrismaClient } from '../db/prisma.js';
import { resolveAuthoritativeTenantContext, getTenantIdsForPortalContext } from '../utils/tenant-resolution.util.js';
import { CsrfService } from '../services/csrf.service.js';

import { getEnv } from '../config/env.js';

export const moveOutRouter = Router();
const csrfService = new CsrfService(getEnv().CSRF_SIGNING_KEY);

const verifyTenantCsrf = (req: Request, res: Response): boolean => {
  const csrfHeader = (req.headers['x-csrf-token'] as string | undefined)?.trim();
  const sessionId = req.auth?.sessionId || req.auth?.session?.id;
  if (!csrfHeader || !sessionId || !csrfService.verifyCsrfToken(csrfHeader, sessionId)) {
    res.status(403).json({
      success: false,
      error: { code: 'CSRF_INVALID', message: 'เซสชันความปลอดภัยไม่ถูกต้อง กรุณารีเฟรชหน้าจอแล้วลองใหม่' },
    });
    return false;
  }
  return true;
};

const mutationGuard = (permission: string) => [
  requireDormitoryPermission(permission),
  requireDormitoryWriteEntitlement,
];

const getDormitoryId = (req: Request): string => {
  const context = (req as any).dormitoryContext;
  if (context?.dormitoryId) return context.dormitoryId;
  if ((req as any).dormitoryId) return (req as any).dormitoryId;
  if (req.auth?.dormitoryId) return req.auth.dormitoryId;
  const requestedDorm = ((req.headers['x-dormitory-id'] as string) || (req.query?.dormitoryId as string))?.trim();
  if (requestedDorm && req.auth?.memberships?.some((m: any) => m.dormitoryId === requestedDorm)) {
    return requestedDorm;
  }
  const defaultDorm = req.auth?.memberships?.[0]?.dormitoryId;
  if (defaultDorm) return defaultDorm;
  throw new AppError('ไม่พบข้อมูลหอพักในบริบทคำขอ', 400, 'DORMITORY_CONTEXT_REQUIRED');
};

// GET /api/v1/tenant-move-out-requests/my (Tenant Reload Persistence — AC C3-1)
moveOutRouter.get(
  '/tenant-move-out-requests/my',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx: any = await resolveAuthoritativeTenantContext(req);
      if (ctx.error || !ctx.tenant) {
        res.status(ctx.error?.statusCode || 403).json({
          success: false,
          error: { code: ctx.error?.code || 'FORBIDDEN', message: ctx.error?.message || 'ไม่มีสิทธิ์เข้าถึงข้อมูลผู้เช่า' },
        });
        return;
      }

      const allowedTenantIds = getTenantIdsForPortalContext(ctx);
      const prisma = getPrismaClient();
      const activeRequest = await prisma.tenantMoveOutRequest.findFirst({
        where: {
          dormitoryId: ctx.dormitoryId,
          tenantId: { in: allowedTenantIds },
          status: { in: ['SCHEDULED', 'PENDING_OWNER_CONFIRMATION'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({ success: true, data: activeRequest || null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/tenant-move-out-requests (Tenant Submission Endpoint — AC C3-1, AC C3-2, OQ-6)
moveOutRouter.post(
  '/tenant-move-out-requests',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!verifyTenantCsrf(req, res)) return;

      const ctx: any = await resolveAuthoritativeTenantContext(req);
      if (ctx.error || !ctx.tenant) {
        res.status(ctx.error?.statusCode || 403).json({
          success: false,
          error: { code: ctx.error?.code || 'FORBIDDEN', message: ctx.error?.message || 'ไม่มีสิทธิ์ส่งคำขอแจ้งย้ายออก' },
        });
        return;
      }

      const allowedTenantIds = getTenantIdsForPortalContext(ctx);
      const prisma = getPrismaClient();

      // Cross-tenant isolation check (AC C3-2): reject if body specifies another tenant's tenantId
      const requestedTenantId = req.body?.tenantId ? String(req.body.tenantId).trim() : null;
      if (requestedTenantId && !allowedTenantIds.includes(requestedTenantId)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'คุณไม่มีสิทธิ์ส่งคำขอแจ้งย้ายออกแทนผู้เช่ารายอื่น' },
        });
        return;
      }

      const targetTenantId = requestedTenantId || String(ctx.tenant.id);
      const requestedRoomId = req.body?.roomId ? String(req.body.roomId).trim() : null;

      // Verify occupancy belongs to the authenticated tenant (AC C3-2)
      const activeOccupancies = await prisma.occupancy.findMany({
        where: {
          dormitoryId: ctx.dormitoryId,
          tenantId: { in: allowedTenantIds },
          status: 'ACTIVE',
        },
      });

      if (requestedRoomId && !activeOccupancies.some((o) => o.roomId === requestedRoomId)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'คุณไม่มีสิทธิ์ส่งคำขอแจ้งย้ายออกสำหรับห้องพักของผู้อื่น' },
        });
        return;
      }

      const targetOccupancy = requestedRoomId
        ? activeOccupancies.find((o) => o.roomId === requestedRoomId)
        : activeOccupancies.find((o) => o.tenantId === targetTenantId) || activeOccupancies[0];

      if (!targetOccupancy) {
        res.status(404).json({
          success: false,
          error: { code: 'ACTIVE_OCCUPANCY_NOT_FOUND', message: 'ไม่พบข้อมูลการเข้าพักที่ยังมีผลบังคับใช้' },
        });
        return;
      }

      const intendedMoveOutDate = req.body?.intendedMoveOutDate || req.body?.moveOutDate;
      if (!intendedMoveOutDate) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_DATE', message: 'กรุณาระบุวันที่ต้องการย้ายออก' },
        });
        return;
      }

      const result = await moveOutService.submitMoveOutRequest({
        dormitoryId: ctx.dormitoryId,
        tenantId: targetOccupancy.tenantId,
        roomId: targetOccupancy.roomId,
        intendedMoveOutDate: String(intendedMoveOutDate),
        refundBankName: req.body?.refundBankName,
        refundAccountNumber: req.body?.refundAccountNumber,
        refundAccountName: req.body?.refundAccountName,
        reason: req.body?.reason,
      });

      res.status(201).json({ success: true, data: result.request, message: result.message });
    } catch (err: any) {
      if (err.code) {
        res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/tenant-move-out-requests/:requestId/cancel (Tenant Cancel Move-Out Request — OQ-6, AC C3-1, AC C3-2)
moveOutRouter.post(
  '/tenant-move-out-requests/:requestId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!verifyTenantCsrf(req, res)) return;

      const ctx: any = await resolveAuthoritativeTenantContext(req);
      if (ctx.error || !ctx.tenant) {
        res.status(ctx.error?.statusCode || 403).json({
          success: false,
          error: { code: ctx.error?.code || 'FORBIDDEN', message: ctx.error?.message || 'ไม่มีสิทธิ์ยกเลิกคำขอแจ้งย้ายออก' },
        });
        return;
      }

      const result = await moveOutService.cancelMoveOutRequest(req.params.requestId, String(ctx.tenant.id));
      res.json({ success: true, data: result.request, message: result.message });
    } catch (err: any) {
      if (err.code) {
        res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// GET /api/v1/tenant-move-out-requests (Owner / Staff View)
moveOutRouter.get(
  '/tenant-move-out-requests',
  requireDormitoryPermission('moveout:view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = getDormitoryId(req);
      const status = req.query.status as string;
      const requests = await moveOutService.listMoveOutRequestsForOwner(dormId, status);
      res.json({ success: true, data: requests });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/tenant-move-out-requests/:requestId/emergency-terminate (Owner Administrative Override)
moveOutRouter.post(
  '/tenant-move-out-requests/:requestId/emergency-terminate',
  mutationGuard('moveout:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = getDormitoryId(req);
      const requestId = req.params.requestId;
      const reviewedByUserId = req.auth?.userId || req.user?.id;
      const actorRole = req.dormitoryContext?.roleCode || (req.auth as any)?.roleCode || req.auth?.role;
      const { actualEndedAt, emergencyReason } = req.body;

      if (!dormId || !reviewedByUserId || !actorRole || !emergencyReason) {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Missing required parameters for emergency termination (dormitoryId, reviewedByUserId, actorRole, emergencyReason)' }
        });
        return;
      }

      const normalizedRole = String(actorRole).toUpperCase();
      if (!['OWNER', 'MANAGER'].includes(normalizedRole)) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only Owner or Manager is authorized to perform emergency tenancy terminations' }
        });
        return;
      }

      const result = await moveOutService.completeEndTenancy({
        dormitoryId: dormId,
        requestId,
        actualEndedAt,
        reviewedByUserId,
        actorRole,
        emergencyReason
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      console.error('EMERGENCY TERMINATION OVERRIDE ERROR:', err);
      if (err.code) {
        res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/tenant-move-out-requests/:requestId/complete-end-tenancy (Owner/Manager Confirmation)
// POST /api/v1/tenant-move-out-requests/:requestId/confirm (Alias)
const handleCompleteMoveOut = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dormId = getDormitoryId(req);
    const requestId = req.params.requestId;
    const reviewedByUserId = req.auth?.userId || req.user?.id;
    const actorRole = req.dormitoryContext?.roleCode || (req.auth as any)?.roleCode || req.auth?.role;
    const actualEndedAt = req.body?.actualEndedAt || new Date().toISOString().split('T')[0];
    const emergencyReason = req.body?.emergencyReason || req.body?.reason || 'ยืนยันการย้ายออกโดยเจ้าของ/ผู้จัดการ';

    if (!dormId || !reviewedByUserId || !actorRole) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'Missing required parameters for move-out completion (dormitoryId, reviewedByUserId, actorRole)' }
      });
      return;
    }

    const normalizedRole = String(actorRole).toUpperCase();
    if (!['OWNER', 'MANAGER'].includes(normalizedRole)) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'เฉพาะเจ้าของหอพักหรือผู้จัดการเท่านั้นที่สามารถยืนยันสิ้นสุดการเช่าได้' }
      });
      return;
    }

    const result = await moveOutService.completeEndTenancy({
      dormitoryId: dormId,
      requestId,
      actualEndedAt,
      reviewedByUserId,
      actorRole: normalizedRole,
      emergencyReason
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.code) {
      res.status(err.status || 400).json({ success: false, error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
};

moveOutRouter.post(
  '/tenant-move-out-requests/:requestId/complete-end-tenancy',
  mutationGuard('moveout:write'),
  handleCompleteMoveOut
);

moveOutRouter.post(
  '/tenant-move-out-requests/:requestId/confirm',
  mutationGuard('moveout:write'),
  handleCompleteMoveOut
);

