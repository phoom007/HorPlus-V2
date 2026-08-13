import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantRegistrationService } from '../services/tenant-registration.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { ApproveRegistrationSchema } from '../schemas/property-tenant-contract.schemas.js';

export function createTenantRegistrationRouter(
  authService: AuthenticationService,
  registrationService: TenantRegistrationService
): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);

  const getAuthoritativeDormitoryId = (req: Request): string => {
    const dormId = (req as any).dormitoryContext?.dormitoryId || req.auth?.dormitoryId;
    if (!dormId) {
      const err = new Error('DORMITORY_ID_REQUIRED');
      (err as any).statusCode = 400;
      (err as any).code = 'DORMITORY_ID_REQUIRED';
      throw err;
    }
    return dormId;
  };

  const getPublicDormitoryId = (req: Request): string => {
    const dormId = (req.body?.dormitoryId as string) || (req.headers['x-dormitory-id'] as string) || (req.query?.dormitoryId as string);
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
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: {
        code: err.code || 'REGISTRATION_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการจัดการคำขอลงทะเบียน',
        fieldErrors: err.fieldErrors || null,
        requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
        timestamp: new Date().toISOString(),
      },
    });
  };

  // 1. PUBLIC ENDPOINT: POST /api/v1/tenant-registrations
  router.post('/', async (req: Request, res: Response) => {
    try {
      const dormId = getPublicDormitoryId(req);
      const { requestedRoomId, firstName, lastName, phone, note } = req.body || {};
      if (!requestedRoomId || !firstName || !lastName || !phone) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const newReq = await registrationService.createRequest(dormId, {
        dormitoryId: dormId,
        requestedRoomId,
        firstName,
        lastName,
        phone,
        note,
      });
      res.status(201).json({ data: newReq });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // 2. PROTECTED PRIVATE ENDPOINTS
  const privateRouter = Router();
  privateRouter.use(requireSession);
  privateRouter.use(resolveDormitoryContextMiddleware);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // GET /api/v1/tenant-registrations
  privateRouter.get('/', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const requests = await registrationService.listRequests(dormId);
      res.json({ data: requests });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id
  privateRouter.get('/:id', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const request = await registrationService.getRequestById(req.params.id, dormId);
      res.json({ data: request });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id/replacement-warning
  privateRouter.get('/:id/replacement-warning', requireDormitoryPermission('tenant:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const details = await registrationService.getReplacementWarningDetails(dormId, req.params.id);
      res.json({ data: details });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // PATCH /api/v1/tenant-registrations/:id
  privateRouter.patch('/:id', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { requestedRoomId } = req.body || {};
      if (!requestedRoomId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุรหัสห้องพักใหม่',
            fieldErrors: null,
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const updated = await registrationService.updateRequestRoom(req.params.id, dormId, requestedRoomId, req.auth?.userId);
      res.json({ data: updated });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/approve
  privateRouter.post('/:id/approve', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const parsed = ApproveRegistrationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ข้อมูลการอนุมัติคำขอลงทะเบียนไม่ถูกต้อง',
            fieldErrors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const result = await registrationService.approveRequest(req.params.id, dormId, parsed.data, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/reject
  privateRouter.post('/:id/reject', ...mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const result = await registrationService.rejectRequest(req.params.id, dormId, req.body?.reason, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  router.use('/', privateRouter);

  return router;
}
