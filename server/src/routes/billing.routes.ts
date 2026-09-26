import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { BillingService } from '../services/billing.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { AppError } from '../types/index.js';
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

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  const getDormitoryId = (req: Request): string => {
    const context = (req as any).dormitoryContext;
    if (context?.dormitoryId) return context.dormitoryId;
    if (req.auth?.dormitoryId) return req.auth.dormitoryId;
    const requestedDorm = ((req.headers['x-dormitory-id'] as string) || (req.query?.dormitoryId as string))?.trim();
    if (requestedDorm && req.auth?.memberships?.some((m: any) => m.dormitoryId === requestedDorm)) {
      return requestedDorm;
    }
    const defaultDorm = req.auth?.memberships?.[0]?.dormitoryId;
    if (defaultDorm) return defaultDorm;
    throw new AppError('ไม่พบข้อมูลหอพักในบริบทคำขอ', 400, 'DORMITORY_CONTEXT_REQUIRED');
  };

  const verifyCsrf = (req: Request, res: Response): boolean => {
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.['horplus_csrf'];
    const sessionId = req.auth?.sessionId;

    if (!csrfHeader || !sessionId || !authService.verifyCsrf(csrfHeader, sessionId) || (csrfCookie && csrfCookie !== csrfHeader)) {
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
    let statusCode = err.statusCode || err.status || 500;
    let code = err.errorCode || err.code || 'BILLING_OPERATION_FAILED';
    let message = err.message || 'เกิดข้อผิดพลาดในการจัดการใบแจ้งหนี้';

    if (err.code === 'P2023' || (err.message && (err.message.includes('Malformed UUID') || err.message.includes('invalid input syntax for type uuid')))) {
      statusCode = 400;
      code = 'INVALID_ID_FORMAT';
      message = 'รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      code = 'NOT_FOUND';
      message = 'ไม่พบข้อมูลที่ต้องการในระบบ';
    } else if (err.code === 'P2003') {
      statusCode = 400;
      code = 'FOREIGN_KEY_VIOLATION';
      message = 'ข้อมูลอ้างอิงไม่ถูกต้องหรือไม่พบในระบบ';
    } else if (
      statusCode >= 500 ||
      err.message?.includes('Prisma') ||
      err.message?.includes('SELECT ') ||
      err.message?.includes('database') ||
      err.message?.includes('connection')
    ) {
      statusCode = 500;
      code = 'INTERNAL_ERROR';
      message = 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
    }

    res.status(statusCode).json({
      error: {
        code,
        message,
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/bills/preview?billingCycleId=...&roomId=...
  router.get('/preview', requireDormitoryPermission('billing:view'), async (req: Request, res: Response) => {
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

      const billKind = req.query.billKind as string | undefined;
      const preview = await billingService.generateBillPreview(dormId, billingCycleId, roomId, undefined, billKind);
      res.json({ data: preview });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/generate
  router.post('/generate', mutationGuard('billing:write'), async (req: Request, res: Response) => {
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
  router.post('/generate/bulk', mutationGuard('billing:write'), async (req: Request, res: Response) => {
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
        req.auth?.userId,
        parsed.data.dirtyRows,
        parsed.data.billKind
      );
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/generate/recurring-rent
  router.post('/generate/recurring-rent', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = BulkGenerateBillSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างใบแจ้งหนี้ค่าเช่ารายเดือนไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await billingService.generateRecurringRentBills(
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

  // POST /api/v1/bills/send-line-notifications
  router.post('/send-line-notifications', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const { cycleId, tenantIds, billIds } = req.body || {};

      if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุผู้เช่าที่ต้องการส่งแจ้งเตือนอย่างน้อย 1 ราย',
            fieldErrors: [{ field: 'tenantIds', message: 'ต้องระบุผู้เช่าอย่างน้อย 1 ราย' }],
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const result = await billingService.sendManualBillLineNotifications({
        dormitoryId: dormId,
        cycleId,
        tenantIds,
        billIds,
        actor: req.auth,
      });

      res.status(200).json({
        data: result,
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/bills/summary
  router.get('/summary', requireDormitoryPermission('billing:view'), async (req: Request, res: Response) => {
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
  router.get('/', requireDormitoryPermission('billing:view'), async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const rawPage = Number(req.query.page || 1);
      const rawPageSize = Number(req.query.pageSize || 20);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Math.min(Math.max(Number.isFinite(rawPageSize) ? rawPageSize : 20, 1), 200);
      const query = {
        billingCycleId: req.query.billingCycleId as string,
        roomId: req.query.roomId as string,
        tenantId: req.query.tenantId as string,
        contractId: req.query.contractId as string,
        status: req.query.status as string,
        search: req.query.search as string,
        page,
        pageSize,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await billingService.getBills(dormId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page, pageSize },
      });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/bills/:id
  router.get('/:id', requireDormitoryPermission('billing:view'), async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const result = await billingService.getBillById(req.params.id, dormId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/bills/:id/cancel
  router.post('/:id/cancel', mutationGuard('billing:write'), async (req: Request, res: Response) => {
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

  // POST /api/v1/bills/:id/void (alias for cancel / void unpaid bill per TASK-011)
  router.post('/:id/void', mutationGuard('billing:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CancelBillSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการยกเลิก/ทำให้เป็นโมฆะใบแจ้งหนี้ไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const voided = await billingService.cancelBill(req.params.id, dormId, parsed.data.reason, req.auth?.userId);
      res.json({ data: voided });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
