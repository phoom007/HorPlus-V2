import { Router, Request, Response } from 'express';
import { MaintenanceService } from '../services/maintenance.service.js';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';

export function createMaintenanceRouter(maintenanceService: MaintenanceService = new MaintenanceService()): Router {
  const router = Router();

  router.use(extractUnifiedActor);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // Helper to extract actor & dormitoryId
  const getContext = (req: Request) => {
    const actor = req.actor;
    const dormitoryId = req.headers['x-dormitory-id'] as string || actor?.dormitoryId;
    if (!dormitoryId) {
      throw new Error('BAD_REQUEST: Missing dormitory ID in headers or actor context');
    }
    return { actor, dormitoryId };
  };

  // GET /api/v1/maintenance-requests
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const query = {
        status: req.query.status as any,
        priority: req.query.priority as any,
        category: req.query.category as any,
        buildingId: req.query.buildingId as string,
        roomId: req.query.roomId as string,
        assignedMemberId: req.query.assignedMemberId as string,
        tenantId: req.query.tenantId as string,
        search: req.query.search as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
        pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20
      };

      const result = await maintenanceService.getStaffRequests(dormitoryId, query);
      res.json(result);
    } catch (err: any) {
      res.status(err.message.startsWith('BAD_REQUEST') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests (Created by Staff on behalf of tenant)
  router.post('/', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { tenantId, roomId, category, title, description, priority, preferredDate, preferredTimeRange } = req.body;

      if (!tenantId || !roomId || !category || !title || !description) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing required maintenance fields' } });
      }

      const request = await maintenanceService.getRepository().createRequest({
        dormitoryId,
        tenantId,
        roomId,
        category,
        title,
        description,
        priority: priority || 'normal',
        preferredDate,
        preferredTimeRange,
        createdByUserId: actor?.userId || null,
        status: 'submitted'
      });

      res.status(201).json(request);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // GET /api/v1/maintenance-requests/:requestId
  router.get('/:requestId', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const detail = await maintenanceService.getStaffRequestById(dormitoryId, req.params.requestId);

      if (!detail) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Maintenance request not found' } });
      }

      res.json(detail);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/acknowledge
  router.post('/:requestId/acknowledge', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const updated = await maintenanceService.acknowledgeRequest(dormitoryId, req.params.requestId, actor?.userId || 'system');
      res.json(updated);
    } catch (err: any) {
      res.status(err.message.includes('INVALID_MAINTENANCE') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/assign
  router.post('/:requestId/assign', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { assignedMemberId } = req.body;

      if (!assignedMemberId) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing assignedMemberId' } });
      }

      const result = await maintenanceService.assignTechnician({
        dormitoryId,
        requestId: req.params.requestId,
        assignedMemberId,
        assignedByUserId: actor?.userId || 'system'
      });

      res.json(result);
    } catch (err: any) {
      res.status(err.message.includes('INVALID_MEMBER') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/status
  router.post('/:requestId/status', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { status, note } = req.body;

      if (!status) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing status' } });
      }

      const actorType = actor?.roleCode === 'STAFF' ? 'staff' : (actor?.roleCode === 'MANAGER' ? 'manager' : 'owner');

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: req.params.requestId,
        status,
        note,
        actorType,
        actorUserId: actor?.userId || undefined,
        actorRoleCode: actor?.roleCode || undefined
      });

      res.json(updated);
    } catch (err: any) {
      res.status(err.message.includes('INVALID_MAINTENANCE') || err.message.includes('FORBIDDEN') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/close
  router.post('/:requestId/close', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { note } = req.body;

      if (actor?.roleCode === 'STAFF') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'STAFF role is not permitted to close maintenance requests' } });
      }

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: req.params.requestId,
        status: 'closed',
        note,
        actorType: actor?.roleCode === 'MANAGER' ? 'manager' : 'owner',
        actorUserId: actor?.userId || undefined,
        actorRoleCode: actor?.roleCode || undefined
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/reopen
  router.post('/:requestId/reopen', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Reason is required to reopen maintenance request' } });
      }

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: req.params.requestId,
        status: 'in_progress',
        note: `Reopened: ${reason}`,
        reopenReason: reason,
        actorType: actor?.roleCode === 'MANAGER' ? 'manager' : 'owner',
        actorUserId: actor?.userId || undefined,
        actorRoleCode: actor?.roleCode || undefined
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/cancel
  router.post('/:requestId/cancel', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { reason } = req.body;

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: req.params.requestId,
        status: 'cancelled',
        cancellationReason: reason || 'Cancelled by staff',
        actorType: actor?.roleCode === 'MANAGER' ? 'manager' : 'owner',
        actorUserId: actor?.userId || undefined,
        actorRoleCode: actor?.roleCode || undefined
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/comments
  router.post('/:requestId/comments', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { message, visibility } = req.body;

      if (!message) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Comment message is required' } });
      }

      const comment = await maintenanceService.addComment(dormitoryId, req.params.requestId, {
        senderType: 'staff',
        senderUserId: actor?.userId || undefined,
        senderName: actor?.roleCode || 'Staff',
        message,
        visibility: visibility || 'tenant_visible'
      });

      res.status(201).json(comment);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // GET /api/v1/maintenance-requests/:requestId/cost
  router.get('/:requestId/cost', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const cost = await maintenanceService.getCost(dormitoryId, req.params.requestId);
      res.json(cost || { laborCost: '0.00', materialCost: '0.00', otherCost: '0.00', totalCost: '0.00' });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // PATCH /api/v1/maintenance-requests/:requestId/cost
  router.patch('/:requestId/cost', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { laborCost, materialCost, otherCost, note } = req.body;

      const updated = await maintenanceService.updateCost(dormitoryId, req.params.requestId, {
        laborCost,
        materialCost,
        otherCost,
        note,
        recordedByUserId: actor?.userId || undefined
      });

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}
