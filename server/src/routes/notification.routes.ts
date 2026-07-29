import { Router, Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.ts';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';

export function createNotificationRouter(notificationService: NotificationService = new NotificationService()): Router {
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

  // Staff Notifications
  router.get('/', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const notifications = await notificationService.getStaffNotifications(dormitoryId, actor?.userId || undefined, actor?.roleCode || undefined);
      const unreadCount = await notificationService.getStaffUnreadCount(dormitoryId, actor?.userId || undefined);
      res.json({ notifications, unreadCount });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post('/:id/read', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const updated = await notificationService.markAsRead(dormitoryId, req.params.id);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.post('/read-all', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      const count = await notificationService.markAllStaffAsRead(dormitoryId, actor?.userId || undefined);
      res.json({ markedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // Owner Notification Preferences
  router.get('/preferences', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getContext(req);
      const preferences = await notificationService.getPreferences(dormitoryId);
      res.json(preferences);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  router.patch('/preferences', async (req: Request, res: Response) => {
    try {
      const { actor, dormitoryId } = getContext(req);
      if (actor?.roleCode !== 'OWNER') {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Only OWNER can update notification preferences' } });
      }

      const updated = await notificationService.updatePreferences(dormitoryId, 'OWNER', req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}

export function createTenantNotificationRouter(notificationService: NotificationService = new NotificationService()): Router {
  const router = Router();

  router.use(extractUnifiedActor);

  const getTenantContext = (req: Request) => {
    const actor = req.actor;
    const dormitoryId = req.headers['x-dormitory-id'] as string || actor?.dormitoryId;
    const tenantId = actor?.tenantId;
    if (!dormitoryId || !tenantId) {
      throw new Error('FORBIDDEN: Tenant session context missing');
    }
    return { actor, dormitoryId, tenantId };
  };

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = getTenantContext(req);
      const notifications = await notificationService.getTenantNotifications(dormitoryId, tenantId);
      const unreadCount = await notificationService.getTenantUnreadCount(dormitoryId, tenantId);
      res.json({ notifications, unreadCount });
    } catch (err: any) {
      res.status(403).json({ error: { message: err.message } });
    }
  });

  router.post('/:id/read', async (req: Request, res: Response) => {
    try {
      const { dormitoryId } = getTenantContext(req);
      const updated = await notificationService.markAsRead(dormitoryId, req.params.id);
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post('/read-all', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = getTenantContext(req);
      const count = await notificationService.markAllTenantAsRead(dormitoryId, tenantId);
      res.json({ markedCount: count });
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  return router;
}
