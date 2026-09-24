import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { ContractService } from '../services/contract.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { getPrismaClient } from '../db/prisma.js';
import {
  CreateContractSchema,
  ActivateContractSchema,
  ExtendContractSchema,
  TerminateContractSchema,
} from '../schemas/property-tenant-contract.schemas.js';
import { resolveAuthoritativeTenantContext, getTenantIdsForPortalContext } from '../utils/tenant-resolution.util.js';
import { AppError } from '../types/index.js';

export function createContractRouter(
  authService: AuthenticationService,
  contractService: ContractService
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
    let code = err.code || 'CONTRACT_OPERATION_FAILED';
    let message = err.message || 'เกิดข้อผิดพลาดในการจัดการสัญญาเช่า';

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

  // GET /api/v1/contracts
  router.get('/', requireDormitoryPermission('contracts:view'), async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const rawPage = Number(req.query.page || 1);
      const rawPageSize = Number(req.query.pageSize || 20);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Math.min(Math.max(Number.isFinite(rawPageSize) ? rawPageSize : 20, 1), 200);
      const query = {
        status: req.query.status as string,
        roomId: req.query.roomId as string,
        tenantId: req.query.tenantId as string,
        expiringWithinDays: req.query.expiringWithinDays ? Number(req.query.expiringWithinDays) : undefined,
        search: req.query.search as string,
        page,
        pageSize,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await contractService.getContracts(dormId, query);
      res.json({ data: result.items, pagination: { total: result.total, page, pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/contracts/:id
  router.get('/:id', requireDormitoryPermission('contracts:view'), async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const contract = await contractService.getContractById(req.params.id, dormId);
      res.json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/contracts/:id/pdf
  router.get('/:id/pdf', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const contract = await contractService.getContractById(req.params.id, dormId);
      if (!contract) {
        return res.status(404).json({
          error: {
            code: 'CONTRACT_NOT_FOUND',
            message: 'ไม่พบสัญญาเช่าที่ระบุ',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      let context = (req as any).dormitoryContext;
      if (!context) {
        try {
          context = await resolveAuthoritativeDormitoryContext(req);
          (req as any).dormitoryContext = context;
        } catch {
          // Context resolution fallback
        }
      }

      const roleCode = String(
        context?.roleCode ||
        (req as any).auth?.roleCode ||
        (req as any).auth?.role ||
        (req as any).auth?.memberships?.[0]?.roleCode ||
        ''
      ).toUpperCase();

      let authorized = false;
      if (roleCode === 'OWNER' || roleCode === 'MANAGER') {
        authorized = true;
      } else if (roleCode === 'TENANT') {
        const tenantCtx = await resolveAuthoritativeTenantContext(req);
        if (!tenantCtx.error && tenantCtx.tenant) {
          const allowedTenantIds = getTenantIdsForPortalContext(tenantCtx);
          if (allowedTenantIds.includes(contract.tenantId)) {
            authorized = true;
          }
        }
      }

      if (!authorized) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'คุณไม่มีสิทธิ์ดาวน์โหลดหรือเปิดดูเอกสารสัญญาเช่านี้ (อนุญาตเฉพาะเจ้าของหอพัก, ผู้จัดการ, หรือผู้เช่าเจ้าของสัญญา)',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const pdfBuffer = await contractService.getContractPdf(req.params.id, dormId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Contract-${req.params.id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error('CONTRACT PDF ERROR:', err);
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contracts
  router.post('/', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = CreateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างสัญญาไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const contract = await contractService.createContract(dormId, {
        ...parsed.data,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      }, req.auth?.userId);
      const isIdempotent = (contract as any)._isIdempotent;
      delete (contract as any)._isIdempotent;
      res.status(isIdempotent ? 200 : 201).json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contracts/:id/activate
  router.post('/:id/activate', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = ActivateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการเปิดใช้งานสัญญาไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const contract = await contractService.activateContract(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contracts/:id/extend
  router.post('/:id/extend', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = ExtendContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการต่อสัญญาไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const contract = await contractService.extendContract(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contracts/:id/renew
  router.post('/:id/renew', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      if (!req.body.startDate || !req.body.endDate || req.body.rentAmount === undefined) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการสร้างสัญญาต่อเนื่องไม่ถูกต้อง',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const contract = await contractService.renewContract(req.params.id, dormId, {
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        rentAmount: req.body.rentAmount,
        durationMonths: req.body.durationMonths
      }, req.auth?.userId);
      const isIdempotent = (contract as any)._isIdempotent;
      delete (contract as any)._isIdempotent;
      res.status(isIdempotent ? 200 : 201).json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contracts/:id/terminate
  router.post('/:id/terminate', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const parsed = TerminateContractSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการยกเลิกสัญญาไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const contract = await contractService.terminateContract(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: contract });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // DELETE /api/v1/contracts/:id
  router.delete('/:id', mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const deleted = await contractService.deleteDraftContract(req.params.id, dormId, req.auth?.userId);
      res.json({ data: { success: deleted, message: 'ลบสัญญาร่างเรียบร้อยแล้ว' } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
