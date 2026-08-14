import { Router, Request, Response } from 'express';
import { AuthenticationService } from '../services/auth.service.js';
import { contractRenewalService } from '../services/contract-renewal.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission, resolveDormitoryContextMiddleware } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';

export function createContractRenewalRouter(authService: AuthenticationService): Router {
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
        code: err.code || 'RENEWAL_OPERATION_FAILED',
        message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการต่อสัญญา',
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

  // GET /api/v1/contract-renewals/eligibility
  router.get('/eligibility', requireDormitoryPermission('contract:read'), async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { contractId, tenantId } = req.query as { contractId: string; tenantId: string };
      if (!contractId || !tenantId) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'ต้องระบุ contractId และ tenantId',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }
      const eligibility = await contractRenewalService.getRenewalEligibility(dormId, tenantId, contractId);
      res.json({ data: eligibility });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contract-renewals/request (Tenant submits renewal request with duration, NOT financial terms)
  router.post('/request', requireDormitoryPermission('contract:read'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const { tenantId, contractId, requestedStartDate, requestedDurationMonths } = req.body || {};

      // Security check: Reject client-supplied financial fields (Rule 20)
      if (req.body.rentAmount !== undefined || req.body.depositAmount !== undefined) {
        return res.status(400).json({
          error: {
            code: 'FINANCIAL_TERMS_MUTATION_DENIED',
            message: 'ผู้เช่าไม่สามารถระบุหรือปรับเปลี่ยนจำนวนเงินในคำขอต่อสัญญาได้',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      if (!tenantId || !contractId || !requestedStartDate || !requestedDurationMonths) {
        return res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'กรุณาระบุข้อมูลคำขอต่อสัญญาให้ครบถ้วน',
            requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const request = await contractRenewalService.submitRenewalRequest({
        dormitoryId: dormId,
        tenantId,
        contractId,
        requestedStartDate,
        requestedDurationMonths: Number(requestedDurationMonths),
        actorUserId: req.auth?.userId,
      });

      res.status(201).json({ data: request });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // GET /api/v1/contract-renewals/requests or /pending
  const getRequestsHandler = async (req: Request, res: Response) => {
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const status = (req.query.status as string) || (req.path.endsWith('/pending') ? 'PENDING_OWNER_APPROVAL' : undefined);
      const requests = await contractRenewalService.listRenewalRequests(dormId, status);
      res.json({ data: requests });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  };
  router.get('/requests', requireDormitoryPermission('contract:read'), getRequestsHandler);
  router.get('/pending', requireDormitoryPermission('contract:read'), getRequestsHandler);

  // POST /api/v1/contract-renewals/requests/:id/approve or /:id/approve
  const approveRequestHandler = async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';

      const result = await contractRenewalService.approveRenewalRequest({
        dormitoryId: dormId,
        requestId: req.params.id,
        rentAmount: req.body?.rentAmount,
        depositAmount: req.body?.depositAmount,
        advancePaymentAmount: req.body?.advancePaymentAmount,
        terms: req.body?.terms,
        actorUserId: req.auth?.userId!,
        actorRole: role.toUpperCase(),
      });

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  };
  router.post('/requests/:id/approve', ...mutationGuard('contract:write'), approveRequestHandler);
  router.post('/:id/approve', ...mutationGuard('contract:write'), approveRequestHandler);

  // POST /api/v1/contract-renewals/requests/:id/reject or /:id/reject
  const rejectRequestHandler = async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const role = (req as any).dormitoryContext?.role?.code || req.auth?.role || '';

      const result = await contractRenewalService.rejectRenewalRequest(
        dormId,
        req.params.id,
        req.body?.reason,
        req.auth?.userId!,
        role.toUpperCase()
      );

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  };
  router.post('/requests/:id/reject', ...mutationGuard('contract:write'), rejectRequestHandler);
  router.post('/:id/reject', ...mutationGuard('contract:write'), rejectRequestHandler);

  // POST /api/v1/contract-renewals/activate-scheduled (Owner/Manager or System triggers scheduled contract activation)
  router.post('/activate-scheduled', ...mutationGuard('contract:write'), async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const dormId = getAuthoritativeDormitoryId(req);
      const effectiveDate = req.body?.effectiveDate;
      const result = await contractRenewalService.activateScheduledContracts(
        dormId,
        effectiveDate,
        req.auth?.userId
      );
      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  return router;
}
