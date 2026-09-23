import { Router, Request, Response, NextFunction } from 'express';
import { moveOutService } from '../services/move-out.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { AppError } from '../types/index.js';

export const moveOutRouter = Router();

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

// POST /api/v1/tenant-move-out-requests (Tenant Submission Endpoint)
moveOutRouter.post(
  '/tenant-move-out-requests',
  mutationGuard('moveout:write'),
  async (req: Request, res: Response, next: NextFunction) => {
    res.status(403).json({
      success: false,
      error: { code: 'DEFERRED_BY_PRODUCT_POLICY', message: 'Tenant-facing move-out submission is deferred in Release 1.' }
    });
  }
);

// GET /api/v1/tenant-move-out-requests (Owner / Staff View)
moveOutRouter.get(
  '/tenant-move-out-requests',
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

// POST /api/v1/tenant-move-out-requests/:requestId/complete-end-tenancy (Deprecated — 410 Gone)
moveOutRouter.post(
  '/tenant-move-out-requests/:requestId/complete-end-tenancy',
  mutationGuard('moveout:write'),
  async (req: Request, res: Response) => {
    res.status(410).json({
      success: false,
      error: {
        code: 'ROUTE_DEPRECATED',
        message: 'DEPRECATED: The normal move-out flow completes automatically upon arrival of the scheduled date. Use /emergency-terminate for exceptional administrative overrides.'
      }
    });
  }
);
