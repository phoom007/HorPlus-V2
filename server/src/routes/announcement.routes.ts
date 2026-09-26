import { Router, Request, Response } from 'express';
import { AnnouncementService } from '../services/announcement.service.js';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { AppError } from '../types/index.js';
import { getPrismaClient } from '../db/prisma.js';

function safeErrorMessage(err: any): string {
  if (err instanceof AppError) return err.message;
  return 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
}

export function createAnnouncementRouter(announcementService: AnnouncementService = new AnnouncementService()): Router {
  const router = Router();

  router.use(extractUnifiedActor);

  const mutationGuard = (permission: string) => [
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  const getContext = (req: Request) => {
    const actor = req.actor;
    const dormitoryId = actor?.dormitoryId || (req.headers['x-dormitory-id'] as string);
    if (!dormitoryId) {
      throw new Error('BAD_REQUEST: Missing dormitory ID in headers or actor context');
    }
    return { actor, dormitoryId };
  };

  // GET /api/v1/announcements
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const rawPage = parseInt(req.query.page as string, 10);
      const rawPageSize = parseInt(req.query.pageSize as string, 10);
      const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
      const pageSize = Math.min(Math.max(Number.isFinite(rawPageSize) ? rawPageSize : 20, 1), 200);
      const query = {
        status: req.query.status as any,
        priority: req.query.priority as any,
        search: req.query.search as string,
        page,
        pageSize
      };

      const result = await announcementService.getRepository().findAll(dormitoryId, query);
      res.json({
        data: result.items,
        pagination: { total: result.total, page, pageSize },
        items: result.items,
        total: result.total
      });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // POST /api/v1/announcements (Create and Publish Immediately)
  router.post('/', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const {
        title,
        summary,
        content,
        priority,
        isPinned,
        type,
        targetType,
        targetBuildingId,
        customTarget,
        targetRooms,
        attachmentUrl,
        linkUrl,
        author,
        status,
        publishDate,
        audiences
      } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title and content are required' } });
      }

      let resolvedAudiences = audiences;
      if (!resolvedAudiences && (targetType === 'rooms' || targetType === 'room' || targetRooms)) {
        const roomNumbers = Array.isArray(targetRooms)
          ? targetRooms.map((r: any) => String(r).trim())
          : (typeof targetRooms === 'string' ? targetRooms.split(',').map((r: string) => r.trim()).filter(Boolean) : []);

        if (roomNumbers.length > 0) {
          const prisma = getPrismaClient();
          const foundRooms = await prisma.room.findMany({
            where: {
              dormitoryId,
              roomNumber: { in: roomNumbers },
              deletedAt: null,
            },
            select: { id: true, roomNumber: true },
          });
          if (foundRooms.length > 0) {
            resolvedAudiences = foundRooms.map((rm) => ({
              targetType: 'room' as const,
              roomId: rm.id,
            }));
          }
        }
      } else if (!resolvedAudiences && targetType === 'building' && targetBuildingId) {
        resolvedAudiences = [{
          targetType: 'building' as const,
          buildingId: targetBuildingId,
        }];
      }

      const targetStatus = status || 'published';
      const announcement = await announcementService.createDraft({
        dormitoryId,
        title: title.trim(),
        summary: summary || (content.trim().length > 50 ? content.trim().substring(0, 50) + '...' : content.trim()),
        content: content.trim(),
        type: type || 'general',
        targetType: targetType || 'all',
        targetBuildingId: targetBuildingId || null,
        customTarget: customTarget || null,
        targetRooms: Array.isArray(targetRooms) ? targetRooms.join(', ') : (targetRooms || null),
        attachmentUrl: attachmentUrl || null,
        linkUrl: linkUrl || null,
        author: author || null,
        priority: priority || 'normal',
        isPinned: isPinned !== undefined ? isPinned : true,
        createdByUserId: actor?.userId || undefined,
        status: targetStatus === 'published' ? 'draft' : targetStatus,
        publishDate: publishDate ? new Date(publishDate) : new Date(),
        audiences: resolvedAudiences || [{ targetType: 'all_tenants' }]
      });

      if (targetStatus === 'published') {
        const sendLinePush = req.body?.sendLinePush !== undefined ? Boolean(req.body.sendLinePush) : true;
        const published = await announcementService.publishAnnouncement({
          dormitoryId,
          announcementId: announcement.id,
          publishedByUserId: actor?.userId || undefined,
          sendLinePush,
        });
        return res.status(201).json(published);
      }

      res.status(201).json(announcement);
    } catch (err: any) {
      const isQuotaError = err.errorCode === 'LINE_MESSAGE_QUOTA_INSUFFICIENT' || err.code === 'LINE_MESSAGE_QUOTA_INSUFFICIENT' || err.message?.includes('LINE_MESSAGE_QUOTA_INSUFFICIENT');
      const status = isQuotaError ? 400 : (err.statusCode || 500);
      const code = isQuotaError ? 'LINE_MESSAGE_QUOTA_INSUFFICIENT' : (err.errorCode || err.code || 'INTERNAL_ERROR');
      res.status(status).json({ error: { code, message: isQuotaError ? err.message : (status >= 500 ? safeErrorMessage(err) : err.message) } });
    }
  });

  // GET /api/v1/announcements/:id
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const announcement = await announcementService.getRepository().findById(dormitoryId, req.params.id);

      if (!announcement) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Announcement not found' } });
      }

      const audiences = await announcementService.getRepository().getAudiences(dormitoryId, req.params.id);
      res.json({ announcement, audiences });
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // PATCH /api/v1/announcements/:id
  router.patch('/:id', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const updated = await announcementService.updateAnnouncement(dormitoryId, req.params.id, {
        ...req.body,
        createdByUserId: actor?.userId || undefined
      });

      if (!updated) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Announcement not found' } });
      }

      res.json(updated);
    } catch (err: any) {
      const status = err.statusCode || (err.message?.includes('CANNOT_MODIFY') ? 400 : 500);
      res.status(status).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: status >= 500 ? safeErrorMessage(err) : err.message } });
    }
  });

  // DELETE /api/v1/announcements/:id
  router.delete('/:id', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const deleted = await announcementService.getRepository().deleteAnnouncement(dormitoryId, req.params.id);

      if (!deleted) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Announcement not found' } });
      }

      res.status(204).send();
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // POST /api/v1/announcements/:id/preview
  router.post('/:id/preview', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const preview = await announcementService.previewRecipients(dormitoryId, req.params.id);
      res.json(preview);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  // POST /api/v1/announcements/:id/publish
  router.post('/:id/publish', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const sendLinePush = req.body?.sendLinePush !== undefined ? Boolean(req.body.sendLinePush) : true;
      const published = await announcementService.publishAnnouncement({
        dormitoryId,
        announcementId: req.params.id,
        publishedByUserId: actor?.userId || undefined,
        sendLinePush,
      });

      res.json(published);
    } catch (err: any) {
      const isQuotaError = err.errorCode === 'LINE_MESSAGE_QUOTA_INSUFFICIENT' || err.code === 'LINE_MESSAGE_QUOTA_INSUFFICIENT' || err.message?.includes('LINE_MESSAGE_QUOTA_INSUFFICIENT');
      const status = isQuotaError ? 400 : (err.statusCode || (err.message?.includes('ANNOUNCEMENT_ALREADY_PUBLISHED') ? 400 : 500));
      const code = isQuotaError ? 'LINE_MESSAGE_QUOTA_INSUFFICIENT' : (err.errorCode || err.code || 'INTERNAL_ERROR');
      res.status(status).json({ error: { code, message: isQuotaError ? err.message : (status >= 500 ? safeErrorMessage(err) : err.message) } });
    }
  });

  // POST /api/v1/announcements/:id/schedule
  router.post('/:id/schedule', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { scheduledAt } = req.body;

      if (!scheduledAt) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'scheduledAt is required' } });
      }

      const scheduled = await announcementService.scheduleAnnouncement({
        dormitoryId,
        announcementId: req.params.id,
        scheduledAt: new Date(scheduledAt),
        scheduledByUserId: actor?.userId || undefined
      });

      res.json(scheduled);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: { code: err.errorCode || 'BAD_REQUEST', message: err instanceof AppError ? err.message : (err.message || 'เกิดข้อผิดพลาด') } });
    }
  });

  // POST /api/v1/announcements/:id/cancel-schedule
  router.post('/:id/cancel-schedule', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const cancelled = await announcementService.cancelSchedule(dormitoryId, req.params.id);
      res.json(cancelled);
    } catch (err: any) {
      res.status(err.statusCode || 400).json({ error: { code: err.errorCode || 'BAD_REQUEST', message: err instanceof AppError ? err.message : (err.message || 'เกิดข้อผิดพลาด') } });
    }
  });

  // POST /api/v1/announcements/:id/archive
  router.post('/:id/archive', mutationGuard('announcement:write'), async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const archived = await announcementService.archiveAnnouncement(dormitoryId, req.params.id);
      res.json(archived);
    } catch (err: any) {
      res.status(err.statusCode || 500).json({ error: { code: err.errorCode || 'INTERNAL_ERROR', message: safeErrorMessage(err) } });
    }
  });

  return router;
}
