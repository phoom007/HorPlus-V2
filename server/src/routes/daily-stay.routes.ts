/**
 * @license Apache-2.0
 * Daily Stay Routes (LOCAL-07 Batch 02)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthenticationService } from '../services/auth.service.js';
import { DailyStayService } from '../services/daily-stay.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { resolveDormitoryContextMiddleware, requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';

export function createDailyStayRouter(
  authService: AuthenticationService,
  dailyStayService: DailyStayService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);
  const requireCsrf = createCsrfMiddleware(authService);

  const getDormitoryId = (req: Request): string => {
    const dormId =
      (req as any).dormitoryContext?.dormitoryId ||
      req.auth?.dormitoryId ||
      (req.headers['x-dormitory-id'] as string) ||
      (req.body?.dormitoryId as string) ||
      (req.query?.dormitoryId as string);

    if (!dormId) {
      const err = new Error('DORMITORY_ID_REQUIRED');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_ID_REQUIRED';
      throw err;
    }
    return dormId;
  };

  const handleServiceError = (res: Response, err: any, req: Request) => {
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'DAILY_STAY_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการจัดการห้องพักรายวัน',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // 1. Tenant-submitted Daily Stay request (Option 2A - Authenticated Pre-link User with canonical CSRF)
  const TenantDailyRequestSchema = z.object({
    dormitoryId: z.string().uuid().optional(),
    roomId: z.string().min(1, 'กรุณาระบุห้องพัก'),
    applicantFullName: z.string().trim().min(1, 'กรุณาระบุชื่อ-นามสกุล'),
    applicantPhone: z.string().trim().max(50).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
    dailyRateAmount: z.union([z.string(), z.number()]).optional(),
    depositAmount: z.union([z.string(), z.number()]).optional(),
    depositDeclaredStatus: z.enum(['PAID', 'UNPAID']).optional(),
  });

  router.post('/request', requireSession, requireCsrf, async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const parsed = TenantDailyRequestSchema.parse(req.body);
      const requesterUserId = req.auth!.userId;

      const stay = await dailyStayService.createTenantDailyStayRequest(
        dormId,
        parsed,
        requesterUserId
      );

      res.status(201).json({
        data: stay,
        message: 'ส่งคำขอเข้าพักรายวันสำเร็จ รอการอนุมัติจากเจ้าของหอพัก',
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: err.errors[0]?.message || 'ข้อมูลไม่ถูกต้อง',
            fieldErrors: err.errors,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      handleServiceError(res, err, req);
    }
  });

  // 2. Owner Quick Add Daily Stay (1-step atomic create & approve)
  const OwnerQuickAddSchema = z.object({
    dormitoryId: z.string().uuid().optional(),
    roomId: z.string().min(1, 'กรุณาระบุห้องพัก'),
    fullName: z.string().trim().min(1, 'กรุณาระบุชื่อ-นามสกุล'),
    phone: z.string().trim().max(50).optional().nullable(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)'),
    dailyRateAmount: z.union([z.string(), z.number()]).optional(),
    depositAmount: z.union([z.string(), z.number()]).optional(),
    depositDeclaredStatus: z.enum(['PAID', 'UNPAID']).optional(),
  });

  router.post(
    '/owner-quick-add',
    requireSession,
    requireCsrf,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:write'),
    requireDormitoryWriteEntitlement,
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const parsed = OwnerQuickAddSchema.parse(req.body);
        const userId = req.auth!.userId;

        const result = await dailyStayService.ownerQuickAddDailyStay(dormId, parsed, userId);

        res.status(201).json({
          data: result,
          message: 'บันทึกข้อมูลผู้เช่ารายวันและออกใบแจ้งหนี้สำเร็จ',
        });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: err.errors[0]?.message || 'ข้อมูลไม่ถูกต้อง',
              fieldErrors: err.errors,
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
        handleServiceError(res, err, req);
      }
    }
  );

  // 3. Owner Edit Pending Daily Stay (Edit-Before-Approve)
  const UpdatePendingSchema = z.object({
    dailyRateAmount: z.union([z.string(), z.number()]).optional(),
    depositAmount: z.union([z.string(), z.number()]).optional(),
    depositDeclaredStatus: z.enum(['PAID', 'UNPAID']).optional(),
  });

  router.patch(
    '/:id/edit-pending',
    requireSession,
    requireCsrf,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:write'),
    requireDormitoryWriteEntitlement,
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const stayId = req.params.id;
        const parsed = UpdatePendingSchema.parse(req.body);
        const userId = req.auth!.userId;

        const result = await dailyStayService.updatePendingDailyStay(dormId, stayId, parsed, userId);

        res.json({
          data: result,
          message: 'แก้ไขข้อมูลคำขอเข้าพักรายวันสำเร็จ',
        });
      } catch (err: any) {
        if (err instanceof z.ZodError) {
          return res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: err.errors[0]?.message || 'ข้อมูลไม่ถูกต้อง',
              fieldErrors: err.errors,
              requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
              timestamp: new Date().toISOString(),
            },
          });
        }
        handleServiceError(res, err, req);
      }
    }
  );

  // 4. Owner Approve Daily Stay
  router.post(
    '/:id/approve',
    requireSession,
    requireCsrf,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:write'),
    requireDormitoryWriteEntitlement,
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const stayId = req.params.id;
        const userId = req.auth!.userId;

        const result = await dailyStayService.approveDailyStay(dormId, stayId, userId);

        res.json({
          data: result,
          message: 'อนุมัติการเข้าพักรายวันและสร้างใบแจ้งหนี้สำเร็จ',
        });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  // 5. Owner Reject Daily Stay
  router.post(
    '/:id/reject',
    requireSession,
    requireCsrf,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:write'),
    requireDormitoryWriteEntitlement,
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const stayId = req.params.id;
        const userId = req.auth!.userId;

        const result = await dailyStayService.rejectDailyStay(dormId, stayId, userId);

        res.json({
          data: result,
          message: 'ปฏิเสธคำขอเข้าพักรายวันเรียบร้อยแล้ว',
        });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  // 6. Checkout Daily Stay (Early or Regular)
  router.post(
    '/:id/checkout',
    requireSession,
    requireCsrf,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:write'),
    requireDormitoryWriteEntitlement,
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const stayId = req.params.id;
        const userId = req.auth!.userId;

        const result = await dailyStayService.checkoutDailyStay(dormId, stayId, userId);

        res.json({
          data: result,
          message: 'เช็คเอาท์ห้องพักรายวันเรียบร้อยแล้ว ห้องพักพร้อมใช้งานใหม่',
        });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  // 7. Get Daily Stays List
  router.get(
    '/',
    requireSession,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('rooms:read'),
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const status = req.query.status as string | undefined;

        const list = await dailyStayService.getDailyStays(dormId, status);

        res.json({ data: list });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  // 8. Get Daily Stay Invoices (for Payments Presentation View)
  router.get(
    '/invoices',
    requireSession,
    resolveDormitoryContextMiddleware,
    requireDormitoryPermission('bills:read'),
    async (req: Request, res: Response) => {
      try {
        const dormId = getDormitoryId(req);
        const invoices = await dailyStayService.getDailyStayInvoices(dormId);

        res.json({ data: invoices });
      } catch (err) {
        handleServiceError(res, err, req);
      }
    }
  );

  return router;
}
