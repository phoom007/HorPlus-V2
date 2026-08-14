import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { ContractService } from '../services/contract.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import {
  CreateContractSchema,
  ActivateContractSchema,
  ExtendContractSchema,
  TerminateContractSchema,
} from '../schemas/property-tenant-contract.schemas.js';

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
    return (req.headers['x-dormitory-id'] as string) || req.auth?.dormitoryId || 'dorm-001';
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
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'CONTRACT_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการจัดการสัญญาเช่า',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // GET /api/v1/contracts
  router.get('/', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const query = {
        status: req.query.status as string,
        roomId: req.query.roomId as string,
        tenantId: req.query.tenantId as string,
        expiringWithinDays: req.query.expiringWithinDays ? Number(req.query.expiringWithinDays) : undefined,
        search: req.query.search as string,
        page: req.query.page ? Number(req.query.page) : 1,
        pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
        sortBy: req.query.sortBy as string,
        sortDirection: req.query.sortDirection as 'asc' | 'desc',
      };
      const result = await contractService.getContracts(dormId, query);
      res.json({ data: result.items, pagination: { total: result.total, page: query.page, pageSize: query.pageSize } });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/contracts/:id
  router.get('/:id', async (req: Request, res: Response) => {
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
