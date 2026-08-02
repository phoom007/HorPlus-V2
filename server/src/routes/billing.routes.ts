import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { BillingService } from '../services/billing.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import {
  GenerateBillSchema,
  BulkGenerateBillSchema,
  CancelBillSchema,
} from '../schemas/billing-meter.schemas.js';

export function createBillingRouter(
  authService: AuthenticationService,
  billingService: BillingService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const getDormitoryId = (req: Request): string => {
    return (req.headers['x-dormitory-id'] as string) || req.auth?.dormitoryId || 'dorm-001';
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
        code: err.code || 'BILLING_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการจัดการใบแจ้งหนี้',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/bills/preview?billingCycleId=...&roomId=...
  router.get('/preview', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      const roomId = req.query.roomId as string;

      if (!billingCycleId || !roomId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_PARAMETERS',
            message: 'ต้องระบุ billingCycleId และ roomId',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const preview = await billingService.generateBillPreview(dormId, billingCycleId, roomId);
      res.json({ data: preview });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/generate
  router.post('/generate', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = GenerateBillSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างใบแจ้งหนี้ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const result = await billingService.generateBill(dormId, parsed.data, req.auth?.userId);
      const status = result.created ? 201 : 200;
      res.status(status).json({ data: { bill: result.bill, items: result.items } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/generate/bulk
  router.post('/generate/bulk', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = BulkGenerateBillSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างใบแจ้งหนี้แบบกลุ่มไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await billingService.bulkGenerateBills(
        dormId,
        parsed.data.billingCycleId,
        parsed.data.roomIds,
        req.auth?.userId
      );
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/bills/summary
  router.get('/summary', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const billingCycleId = req.query.billingCycleId as string;
      const summary = await billingService.getBillingSummary(dormId, billingCycleId);
      res.json({ data: summary });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/bills
  router.get('/', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        billingCycleId: req.query.billingCycleId as string,
        roomId: req.query.roomId as string,
        tenantId: req.query.tenantId as string,
        contractId: req.query.contractId as string,
        status: req.query.status as string,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await billingService.getBills(dormId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page: query.page, pageSize: query.pageSize },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/bills/:id
  router.get('/:id', requireSession, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const result = await billingService.getBillById(req.params.id, dormId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/:id/cancel
  router.post('/:id/cancel', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CancelBillSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการยกเลิกใบแจ้งหนี้ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const cancelled = await billingService.cancelBill(req.params.id, dormId, parsed.data.reason, req.auth?.userId);
      res.json({ data: cancelled });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
