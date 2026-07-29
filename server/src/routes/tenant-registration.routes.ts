import { Router, Request, Response, NextFunction } from 'express';
import { tenantRegistrationService } from '../services/tenant-registration.service.js';
import { liffSessionService } from '../services/liff-session.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';

export const tenantRegistrationRouter = Router();

// GET /api/v1/line/registration/rooms (Safe room selection API for LIFF)
tenantRegistrationRouter.get(
  '/line/registration/rooms',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const rooms = await tenantRegistrationService.getAvailableRoomsForRegistration(dormId);
      res.json({ success: true, data: rooms });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/line/registration/status
tenantRegistrationRouter.get(
  '/line/registration/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const sessionId = req.cookies?.horplus_line_session || req.headers['x-line-session-id'];
      const session = liffSessionService.getSession(sessionId as string);

      if (!session) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No valid LINE session' } });
        return;
      }

      const status = await tenantRegistrationService.getRegistrationStatusForIdentity(dormId, session.lineIdentityId);
      res.json({ success: true, data: status });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/line/registration/submit
tenantRegistrationRouter.post(
  '/line/registration/submit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const sessionId = req.cookies?.horplus_line_session || req.headers['x-line-session-id'];
      const session = liffSessionService.getSession(sessionId as string);

      if (!session) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No valid LINE session' } });
        return;
      }

      const { requestedRoomId, firstName, lastName, phone, note } = req.body;
      if (!requestedRoomId || !firstName || !lastName || !phone) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'requestedRoomId, firstName, lastName, and phone are required' } });
        return;
      }

      const result = await tenantRegistrationService.submitRegistration({
        dormitoryId: dormId,
        lineIdentityId: session.lineIdentityId,
        requestedRoomId,
        firstName,
        lastName,
        phone,
        note
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/tenant-registration-requests (Owner View)
tenantRegistrationRouter.get(
  '/tenant-registration-requests',
  requirePermission('tenant_registration.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const status = req.query.status as string;
      const requests = await tenantRegistrationService.listRequestsForOwner(dormId, status);
      res.json({ success: true, data: requests });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/tenant-registration-requests/:requestId/approve
tenantRegistrationRouter.post(
  '/tenant-registration-requests/:requestId/approve',
  requirePermission('tenant_registration.approve'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const requestId = req.params.requestId;
      const reviewedByUserId = req.user?.id || req.auth?.userId || 'user-001';
      const { tenantId, contractId, sendLineNotification } = req.body;

      if (!tenantId || !contractId) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'tenantId and contractId are required' } });
        return;
      }

      const result = await tenantRegistrationService.approveRegistration({
        dormitoryId: dormId,
        requestId,
        tenantId,
        contractId,
        sendLineNotification: !!sendLineNotification,
        reviewedByUserId
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      if (err.message?.startsWith('CONTRACT_TENANT_MISMATCH')) {
        res.status(400).json({ success: false, error: { code: 'MISMATCH', message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/tenant-registration-requests/:requestId/reject
tenantRegistrationRouter.post(
  '/tenant-registration-requests/:requestId/reject',
  requirePermission('tenant_registration.reject'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const requestId = req.params.requestId;
      const reviewedByUserId = req.user?.id || req.auth?.userId || 'user-001';
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'reason is required for rejection' } });
        return;
      }

      const result = await tenantRegistrationService.rejectRegistration({
        dormitoryId: dormId,
        requestId,
        reviewedByUserId,
        rejectedReason: reason
      });

      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
