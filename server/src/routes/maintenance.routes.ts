import { Router, Request, Response } from 'express';
import { MaintenanceService } from '../services/maintenance.service.js';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { AppError } from '../types/index.js';

function safeErrorMessage(err: any): string {
  if (err instanceof AppError) return err.message;
  return 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
}

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
    const dormitoryId = actor?.dormitoryId || (req.headers['x-dormitory-id'] as string);
    if (!dormitoryId) {
      throw new Error('BAD_REQUEST: Missing dormitory ID in headers or actor context');
    }
    return { actor, dormitoryId };
  };

  // GET /api/v1/maintenance-requests
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const rawPage = parseInt(req.query.page as string, 10);
      const rawPageSize = parseInt(req.query.pageSize as string, 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Math.min(Math.max(Number.isFinite(rawPageSize) ? rawPageSize : 20, 1), 200);

      let assignedMemberId = req.query.assignedMemberId as string;
      if (actor?.roleCode === 'STAFF') {
        const membership = actor.dormitoryMemberId
          ? { id: actor.dormitoryMemberId }
          : await maintenanceService.getMembershipRepository().findByUserAndDormitory(actor.userId || '', dormitoryId);
        assignedMemberId = membership?.id || 'unassigned-none';
      }

      const query = {
        status: req.query.status as any,
        priority: req.query.priority as any,
        category: req.query.category as any,
        buildingId: req.query.buildingId as string,
        roomId: req.query.roomId as string,
        assignedMemberId,
        tenantId: req.query.tenantId as string,
        search: req.query.search as string,
        page,
        pageSize
      };

      const result = await maintenanceService.getStaffRequests(dormitoryId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page, pageSize },
        items: result.items,
        total: result.total
      });
    } catch (err: any) {
      res.status(err.message.startsWith('BAD_REQUEST') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests (Created by Staff on behalf of tenant)
  router.post('/', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const {
        tenantId,
        roomId,
        category,
        title,
        description,
        priority,
        assignedStaff,
        cost,
        note,
        imageBefore,
        imageAfter,
        preferredDate,
        preferredTimeRange
      } = req.body;

      if (!title || !description) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title and description are required' } });
      }

      const staffProvenanceTag = '[แจ้งโดย: ช่าง / แม่บ้าน]';
      let finalNote = note ? String(note).trim() : null;
      if (actor?.userId?.startsWith('ag_user_')) {
        if (!finalNote) {
          finalNote = staffProvenanceTag;
        } else if (!finalNote.includes(staffProvenanceTag)) {
          finalNote = `${finalNote}\n${staffProvenanceTag}`;
        }
      }

      const request = await maintenanceService.getRepository().createRequest({
        dormitoryId,
        tenantId: tenantId || null,
        roomId: roomId || null,
        category: category || 'other',
        title: title.trim(),
        description: description.trim(),
        priority: priority || 'normal',
        assignedStaff: assignedStaff || null,
        cost: cost !== undefined ? Number(cost) : 0,
        note: finalNote,
        imageBefore: imageBefore || null,
        imageAfter: imageAfter || null,
        preferredDate,
        preferredTimeRange,
        createdByUserId: actor?.userId || null,
        status: req.body.status || 'submitted'
      });

      res.status(201).json(request);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // GET /api/v1/maintenance-requests/:requestId
  router.get('/:requestId', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const detail = await maintenanceService.getStaffRequestById(dormitoryId, req.params.requestId);

      if (!detail) {
        const anywhere = await (maintenanceService.getRepository() as any).findAnywhere?.(req.params.requestId);
        if (anywhere && anywhere.dormitoryId !== dormitoryId) {
          return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงงานแจ้งซ่อมนอกหอพัก' } });
        }
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Maintenance request not found' } });
      }

      if (detail.request.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงงานแจ้งซ่อมนอกหอพัก' } });
      }

      if (actor?.roleCode === 'STAFF') {
        const currentMember = actor.dormitoryMemberId
          ? { id: actor.dormitoryMemberId, userId: actor.userId }
          : await maintenanceService.getMembershipRepository().findByUserAndDormitory(actor.userId || '', dormitoryId);

        const isAssigned =
          (detail.assignment && detail.assignment.assignedMemberId === currentMember?.id) ||
          (detail.request.assignedStaff && (detail.request.assignedStaff === currentMember?.id || detail.request.assignedStaff === actor.userId));

        if (!isAssigned) {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'เจ้าหน้าที่สามารถเข้าถึงได้เฉพาะงานแจ้งซ่อมที่ได้รับมอบหมายเท่านั้น'
            }
          });
        }
      }

      res.json(detail);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
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
      if (actor?.roleCode === 'STAFF') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'เฉพาะเจ้าของหรือผู้จัดการเท่านั้นที่สามารถมอบหมายงานได้' } });
      }
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

  const handleStatusUpdate = async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { status, note, assignedStaff, cost, imageAfter } = req.body;

      if (!status) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Missing status' } });
      }

      const request = await maintenanceService.getRepository().findById(dormitoryId, req.params.requestId);
      if (!request) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Maintenance request not found' } });
      }

      if (request.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงงานแจ้งซ่อมนอกหอพัก' } });
      }

      if (actor?.roleCode === 'STAFF') {
        const currentMember = actor.dormitoryMemberId
          ? { id: actor.dormitoryMemberId, userId: actor.userId }
          : await maintenanceService.getMembershipRepository().findByUserAndDormitory(actor.userId || '', dormitoryId);

        const activeAssignment = await maintenanceService.getRepository().getActiveAssignment(dormitoryId, req.params.requestId);
        const isAssigned =
          (activeAssignment && activeAssignment.assignedMemberId === currentMember?.id) ||
          (request.assignedStaff && (request.assignedStaff === currentMember?.id || request.assignedStaff === actor.userId));

        if (!isAssigned) {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'เจ้าหน้าที่สามารถจัดการได้เฉพาะงานแจ้งซ่อมที่ได้รับมอบหมายเท่านั้น'
            }
          });
        }
      }

      const extraUpdates: any = {};
      if (assignedStaff !== undefined) extraUpdates.assignedStaff = assignedStaff;
      if (cost !== undefined) extraUpdates.cost = Number(cost);
      if (note !== undefined) extraUpdates.note = note;
      if (imageAfter !== undefined) extraUpdates.imageAfter = imageAfter;

      if (Object.keys(extraUpdates).length > 0) {
        await maintenanceService.getRepository().updateRequest(dormitoryId, req.params.requestId, extraUpdates);
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
      const isForbidden = err.message?.includes('FORBIDDEN');
      const isInvalid = err.message?.includes('INVALID_MAINTENANCE') || err.message?.includes('MAINTENANCE_REQUEST_');
      const statusCode = isForbidden ? 403 : (isInvalid ? 400 : (err.statusCode || 500));
      res.status(statusCode).json({ error: { code: isForbidden ? 'FORBIDDEN' : (isInvalid ? 'BAD_REQUEST' : 'INTERNAL_ERROR'), message: err.message } });
    }
  };

  // POST & PATCH /api/v1/maintenance-requests/:requestId/status
  router.post('/:requestId/status', mutationGuard('maintenance:write'), handleStatusUpdate);
  router.patch('/:requestId/status', mutationGuard('maintenance:write'), handleStatusUpdate);
  router.patch('/:requestId', mutationGuard('maintenance:write'), handleStatusUpdate);

  // DELETE /api/v1/maintenance-requests/:requestId
  router.delete('/:requestId', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      if (actor?.roleCode === 'STAFF') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'เจ้าหน้าที่ไม่มีสิทธิ์ลบรายการแจ้งซ่อม' } });
      }
      const deleted = await maintenanceService.getRepository().deleteRequest(dormitoryId, req.params.requestId);
      if (!deleted) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Maintenance request not found' } });
      }
      res.status(204).send();
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/close
  router.post('/:requestId/close', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { note } = req.body;

      const request = await maintenanceService.getRepository().findById(dormitoryId, req.params.requestId);
      if (!request) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Maintenance request not found' } });
      }

      if (request.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึงงานแจ้งซ่อมนอกหอพัก' } });
      }

      if (actor?.roleCode === 'STAFF') {
        const currentMember = actor.dormitoryMemberId
          ? { id: actor.dormitoryMemberId, userId: actor.userId }
          : await maintenanceService.getMembershipRepository().findByUserAndDormitory(actor.userId || '', dormitoryId);

        const activeAssignment = await maintenanceService.getRepository().getActiveAssignment(dormitoryId, req.params.requestId);
        const isAssigned =
          (activeAssignment && activeAssignment.assignedMemberId === currentMember?.id) ||
          (request.assignedStaff && (request.assignedStaff === currentMember?.id || request.assignedStaff === actor.userId));

        if (!isAssigned) {
          return res.status(403).json({
            error: {
              code: 'FORBIDDEN',
              message: 'เจ้าหน้าที่สามารถจัดการได้เฉพาะงานแจ้งซ่อมที่ได้รับมอบหมายเท่านั้น'
            }
          });
        }
      }

      const actorType = actor?.roleCode === 'STAFF' ? 'staff' : (actor?.roleCode === 'MANAGER' ? 'manager' : 'owner');

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: req.params.requestId,
        status: 'closed',
        note,
        actorType,
        actorUserId: actor?.userId || undefined,
        actorRoleCode: actor?.roleCode || undefined
      });

      res.json(updated);
    } catch (err: any) {
      const isForbidden = err.message?.includes('FORBIDDEN');
      res.status(isForbidden ? 403 : 400).json({ error: { code: isForbidden ? 'FORBIDDEN' : 'BAD_REQUEST', message: err.message } });
    }
  });

  // POST /api/v1/maintenance-requests/:requestId/reopen
  router.post('/:requestId/reopen', mutationGuard('maintenance:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      if (actor?.roleCode === 'STAFF') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'เจ้าหน้าที่ไม่มีสิทธิ์เปิดงานใหม่' } });
      }
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
      if (actor?.roleCode === 'STAFF') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'เจ้าหน้าที่ไม่มีสิทธิ์ยกเลิกรายการแจ้งซ่อม' } });
      }
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
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // GET /api/v1/maintenance-requests/:requestId/cost
  router.get('/:requestId/cost', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const cost = await maintenanceService.getCost(dormitoryId, req.params.requestId);
      res.json(cost || { laborCost: '0.00', materialCost: '0.00', otherCost: '0.00', totalCost: '0.00' });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
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
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  return router;
}
