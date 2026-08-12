import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { BillingCycleService } from '../services/billing-cycle.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import {
  CreateBillingCycleSchema,
  UpdateBillingCycleSchema,
} from '../schemas/billing-meter.schemas.js';

export function createBillingCycleRouter(
  authService: AuthenticationService,
  billingCycleService: BillingCycleService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  const getDormitoryId = (req: Request): string => {
    const dormId = (req.headers['x-dormitory-id'] as string) || req.auth?.dormitoryId;
    if (!dormId) {
      const err = new Error('DORMITORY_ID_REQUIRED');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_ID_REQUIRED';
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
    console.error('BILLING CYCLE SERVICE ERROR:', err);
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'BILLING_CYCLE_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการจัดการรอบการเรียกเก็บเงิน',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/billing-cycles
  router.get('/', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await billingCycleService.getBillingCycles(dormId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page: query.page, pageSize: query.pageSize },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/billing-cycles/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const result = await billingCycleService.getBillingCycleById(req.params.id, dormId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/billing-cycles
  router.post('/', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateBillingCycleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างรอบบิลไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const result = await billingCycleService.createBillingCycle(dormId, parsed.data, req.auth?.userId);
      res.status(201).json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PUT /api/v1/billing-cycles/:id
  router.put('/:id', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = UpdateBillingCycleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการแก้ไขรอบบิลไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const updated = await billingCycleService.updateBillingCycle(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: updated });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/billing-cycles/:id/lock
  router.post('/:id/lock', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const locked = await billingCycleService.lockBillingCycle(req.params.id, dormId, req.auth?.userId);
      res.json({ data: locked });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
