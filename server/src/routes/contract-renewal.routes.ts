import { Router, Request, Response } from 'express';
import { getPrismaClient } from '../db/prisma.js';
import { AuthenticationService } from '../services/auth.service.js';
import { contractRenewalService } from '../services/contract-renewal.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import {
  resolveAuthoritativeTenantContext,
  getTenantIdsForPortalContext,
} from '../utils/tenant-resolution.util.js';

export function createContractRenewalRouter(authService: AuthenticationService): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);
  const prisma = getPrismaClient();

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

  /**
   * Resolves renewal actor strictly from session.
   * - For TENANT sessions: derives dormitoryId & tenantId from resolveAuthoritativeTenantContext(req)
   *   and rejects any mismatched tenantId or contractId with 403 FORBIDDEN (Card C2 / REQ §10).
   * - For Owner/Manager/Staff sessions with contract:read: uses dormitoryContext.
   */
  const resolveRenewalActorContext = async (
    req: Request,
    res: Response
  ): Promise<{
    isTenantActor: boolean;
    dormitoryId: string;
    tenantId: string;
    contractId?: string;
  } | null> => {
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
    if (!req.auth?.userId) {
      res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนดำเนินการ',
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
      return null;
    }

    const passedTenantId =
      (req.body?.tenantId as string | undefined) ||
      (req.query?.tenantId as string | undefined);
    const passedContractId =
      (req.body?.contractId as string | undefined) ||
      (req.query?.contractId as string | undefined);

    // Check if the caller is an Owner/Manager/Staff member with contract:read
    const roleCode = String(
      (req as any).dormitoryContext?.role?.code || req.auth?.role || ''
    ).toUpperCase();
    const authPermissions = (req.auth as any)?.permissions;
    const hasStaffContractRead =
      ['OWNER', 'MANAGER', 'STAFF', 'PLATFORM_ADMIN', 'SUPER_ADMIN'].includes(roleCode) &&
      (!Array.isArray(authPermissions) ||
        authPermissions.length === 0 ||
        authPermissions.includes('contract:read'));

    const tenantCtx = await resolveAuthoritativeTenantContext(req);
    if (!tenantCtx.error && tenantCtx.tenant) {
      const allowedTenantIds = getTenantIdsForPortalContext(tenantCtx);

      if (passedTenantId && !allowedTenantIds.includes(passedTenantId)) {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'คุณไม่มีสิทธิ์ดำเนินการต่อสัญญาของผู้เช่ารายอื่น',
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
        return null;
      }

      if (passedContractId) {
        if (typeof (prisma as any).$executeRaw === 'function') {
          try {
            await prisma.$executeRaw`SELECT set_config('app.current_dormitory_id', ${tenantCtx.dormitoryId}, false)`;
          } catch {}
        }
        const targetContract = await prisma.contract.findFirst({
          where: {
            id: passedContractId,
            dormitoryId: tenantCtx.dormitoryId,
            deletedAt: null,
          },
          select: { id: true, tenantId: true },
        });
        if (targetContract && !allowedTenantIds.includes(targetContract.tenantId)) {
          res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'คุณไม่มีสิทธิ์ดำเนินการต่อสัญญาของผู้เช่ารายอื่น',
              requestId,
              timestamp: new Date().toISOString(),
            },
          });
          return null;
        }
      }

      const effectiveTenantId =
        passedTenantId && allowedTenantIds.includes(passedTenantId)
          ? passedTenantId
          : tenantCtx.tenant.id;

      return {
        isTenantActor: true,
        dormitoryId: tenantCtx.dormitoryId,
        tenantId: effectiveTenantId,
        contractId: passedContractId || (tenantCtx as any).contract?.id,
      };
    }

    if (hasStaffContractRead) {
      const dormId = getAuthoritativeDormitoryId(req);
      return {
        isTenantActor: false,
        dormitoryId: dormId,
        tenantId: passedTenantId || '',
        contractId: passedContractId,
      };
    }

    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'คุณไม่มีสิทธิ์เข้าถึงการต่อสัญญานี้',
        requestId,
        timestamp: new Date().toISOString(),
      },
    });
    return null;
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
  router.get('/eligibility', requireSession, async (req: Request, res: Response) => {
    try {
      const actor = await resolveRenewalActorContext(req, res);
      if (!actor) return;

      const contractId = actor.contractId;
      const tenantId = actor.tenantId;
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
      const eligibility = await contractRenewalService.getRenewalEligibility(
        actor.dormitoryId,
        tenantId,
        contractId
      );
      res.json({ data: eligibility });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  });

  // POST /api/v1/contract-renewals/request (Tenant submits renewal request with duration, NOT financial terms)
  router.post('/request', requireSession, async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const actor = await resolveRenewalActorContext(req, res);
      if (!actor) return;

      const { requestedStartDate, requestedDurationMonths } = req.body || {};
      const contractId = actor.contractId;
      const tenantId = actor.tenantId;

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

      if (!tenantId || !contractId || !requestedDurationMonths) {
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
        dormitoryId: actor.dormitoryId,
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

  // POST /api/v1/contract-renewals/requests/:id/cancel or /:id/cancel (Tenant cancels pending renewal)
  const cancelRequestHandler = async (req: Request, res: Response) => {
    if (!verifyCsrf(req, res)) return;
    try {
      const actor = await resolveRenewalActorContext(req, res);
      if (!actor) return;

      if (actor.isTenantActor) {
        if (req.body?.tenantId && String(req.body.tenantId) !== actor.tenantId) {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'ไม่มีสิทธิ์ยกเลิกคำขอต่อสัญญาของผู้เช่ารายอื่น',
            },
          });
        }
      }

      const result = await contractRenewalService.cancelRenewalRequest({
        dormitoryId: actor.dormitoryId,
        requestId: req.params.id,
        tenantId: actor.isTenantActor ? actor.tenantId : req.body?.tenantId,
      });

      res.json({ data: result });
    } catch (err) {
      handleServiceError(res, err, req);
    }
  };
  router.post('/requests/:id/cancel', requireSession, cancelRequestHandler);
  router.post('/:id/cancel', requireSession, cancelRequestHandler);

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
