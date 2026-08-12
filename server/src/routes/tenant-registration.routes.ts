import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { TenantRegistrationService } from '../services/tenant-registration.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';

export function createTenantRegistrationRouter(
  authService: AuthenticationService,
  registrationService: TenantRegistrationService
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

  // GET /api/v1/tenant-registrations
  router.get('/', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const requests = await registrationService.listRequests(dormId);
      res.json({ data: requests });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/tenant-registrations/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const dormId = getDormitoryId(req);
      const request = await registrationService.getRequestById(req.params.id, dormId);
      res.json({ data: request });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/approve
  router.post('/:id/approve', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const result = await registrationService.approveRequest(req.params.id, dormId, req.body, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/tenant-registrations/:id/reject
  router.post('/:id/reject', mutationGuard('tenant:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getDormitoryId(req);
      const result = await registrationService.rejectRequest(req.params.id, dormId, req.body?.reason, req.auth?.userId);
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
