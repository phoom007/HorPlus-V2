import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { settlementService } from '../services/settlement.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';

export function createSettlementRouter(authService: AuthenticationService): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const getAuthoritativeDormitoryId = (req: Request): string => {
    const dormId = (req as any).dormitoryContext?.dormitoryId || req.auth?.dormitoryId;
    if (!dormId) {
      const err: any = new Error('DORMITORY_ID_REQUIRED');
      err.statusCode = 400;
      err.code = 'DORMITORY_ID_REQUIRED';
      throw err;
    }
    return dormId;
  };

  const verifyCsrf = (req: Request, res: Response): boolean => {
    const csrfToken = (req.headers['x-csrf-token'] as string) || req.cookies?.['horplus_csrf'];
    const sessionId = req.auth?.sessionId;
    if (!sessionId || !authService.verifyCsrf(csrfToken, sessionId)) {
      res.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return false;
    }
    return true;
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'SETTLEMENT_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการคำนวณยอดย้ายออก',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // GET /api/v1/settlements/:contractId
  router.get('/:contractId', requireDormitoryPermission('contract:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const settlement = await settlementService.getOrCreateSettlement(dormId, req.params.contractId);
      res.json({ data: settlement });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/settlements/:settlementId/damage-items
  router.post('/:settlementId/damage-items', ...mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';
      const { description, amount, evidenceUrl } = req.body || {};

      const item = await settlementService.addDamageItem({
        dormitoryId: dormId,
        settlementId: req.params.settlementId,
        description,
        amount,
        evidenceUrl,
        actorUserId: req.auth?.userId!,
        actorRole: role.toUpperCase(),
      });

      res.status(201).json({ data: item });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/settlements/damage-items/:itemId
  router.put('/damage-items/:itemId', ...mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';
      const { description, amount, evidenceUrl } = req.body || {};

      const item = await settlementService.editDamageItem({
        dormitoryId: dormId,
        itemId: req.params.itemId,
        description,
        amount,
        evidenceUrl,
        actorUserId: req.auth?.userId!,
        actorRole: role.toUpperCase(),
      });

      res.json({ data: item });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/settlements/damage-items/:itemId (Soft-Remove ONLY, hard delete forbidden)
  router.delete('/damage-items/:itemId', ...mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';

      const softRemoved = await settlementService.softRemoveDamageItem(
        dormId,
        req.params.itemId,
        req.auth?.userId!,
        role.toUpperCase()
      );

      res.json({ data: softRemoved });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/settlements/:settlementId/confirm (Locks settlement status)
  router.post('/:settlementId/confirm', ...mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';
      const { status } = req.body || {};

      const confirmed = await settlementService.confirmSettlementStatus(
        dormId,
        req.params.settlementId,
        status,
        req.auth?.userId!,
        role.toUpperCase()
      );

      res.json({ data: confirmed });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
