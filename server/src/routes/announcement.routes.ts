import { Router, Request, Response } from 'express';
import { AnnouncementService } from '../services/announcement.service.js';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';

export function createAnnouncementRouter(announcementService: AnnouncementService = new AnnouncementService()): Router {
  const router = Router();

  router.use(extractUnifiedActor);

  const getContext = (req: Request) => {
    const actor = req.actor;
    const dormitoryId = req.headers['x-dormitory-id'] as string || actor?.dormitoryId;
    if (!dormitoryId) {
      throw new Error('BAD_REQUEST: Missing dormitory ID in headers or actor context');
    }
    return { actor, dormitoryId };
  };

  // GET /api/v1/announcements
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const query = {
        status: req.query.status as any,
        priority: req.query.priority as any,
        search: req.query.search as string,
        page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
        pageSize: req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 20
      };

      const result = await announcementService.getRepository().findAll(dormitoryId, query);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements (Create Draft)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const { title, summary, content, priority, isPinned, audiences } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Title and content are required' } });
      }

      const draft = await announcementService.createDraft({
        dormitoryId,
        title,
        summary,
        content,
        priority,
        isPinned,
        createdByUserId: actor?.userId || undefined,
        audiences: audiences || [{ targetType: 'all_tenants' }]
      });

      res.status(201).json(draft);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
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
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // PATCH /api/v1/announcements/:id
  router.patch('/:id', async (req: Request, res: Response) => {
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
      res.status(err.message.includes('CANNOT_MODIFY') ? 400 : 500).json({ error: { message: err.message } });
    }
  });

  // DELETE /api/v1/announcements/:id
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const deleted = await announcementService.getRepository().deleteAnnouncement(dormitoryId, req.params.id);

      if (!deleted) {
        return res.status(404).json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Announcement not found' } });
      }

      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements/:id/preview
  router.post('/:id/preview', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const preview = await announcementService.previewRecipients(dormitoryId, req.params.id);
      res.json(preview);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements/:id/publish
  router.post('/:id/publish', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const published = await announcementService.publishAnnouncement({
        dormitoryId,
        announcementId: req.params.id,
        publishedByUserId: actor?.userId || undefined
      });

      res.json(published);
    } catch (err: any) {
      res.status(err.message.includes('ANNOUNCEMENT_ALREADY_PUBLISHED') ? 400 : 500)
        .json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements/:id/schedule
  router.post('/:id/schedule', async (req: Request, res: Response) => {
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
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements/:id/cancel-schedule
  router.post('/:id/cancel-schedule', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const cancelled = await announcementService.cancelSchedule(dormitoryId, req.params.id);
      res.json(cancelled);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  // POST /api/v1/announcements/:id/archive
  router.post('/:id/archive', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const archived = await announcementService.archiveAnnouncement(dormitoryId, req.params.id);
      res.json(archived);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}
