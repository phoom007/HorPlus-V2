import { Router, Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.js';
import { extractUnifiedActor } from '../middleware/unified-actor.middleware.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { getPrismaClient } from '../db/prisma.js';

export function createNotificationRouter(
  notificationService: NotificationService = new NotificationService(),
  authService?: AuthenticationService
): Router {
  const router = Router();

  if (authService) {
    const requireSession = createRequireSessionMiddleware(authService);
    router.use(requireSession);
  }

  router.use(extractUnifiedActor);

  const getStaffContext = async (req: Request) => {
    let context = (req as any).dormitoryContext;
    if (!context) {
      if (req.auth) {
        context = await resolveAuthoritativeDormitoryContext(req);
      } else {
        const actor = req.actor;
        const dormitoryId = (req.headers['x-dormitory-id'] as string) || actor?.dormitoryId;
        const userId = actor?.userId || (req.headers['x-user-id'] as string);
        const roleCode = actor?.roleCode || (req.headers['x-role-code'] as string) || 'OWNER';
        if (!dormitoryId) {
          throw new Error('BAD_REQUEST: Missing dormitory ID');
        }
        context = { dormitoryId, userId, roleCode };
      }
    }
    return context;
  };

  // GET /api/v1/notifications (Staff notifications)
  router.get('/', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const notifications = await notificationService.getStaffNotifications(
        context.dormitoryId,
        context.userId,
        context.roleCode
      );
      const unreadCount = await notificationService.getStaffUnreadCount(
        context.dormitoryId,
        context.userId
      );
      res.json({ notifications, unreadCount });
    } catch (err: any) {
      const status = err.statusCode || err.status || (err.message?.includes('Access denied') ? 403 : 500);
      res.status(status).json({ error: { code: 'FORBIDDEN', message: err.message } });
    }
  });

  // POST /api/v1/notifications/:id/read
  router.post('/:id/read', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const updated = await notificationService.markAsRead(
        context.dormitoryId,
        req.params.id,
        context.userId,
        undefined
      );
      if (!updated) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'ไม่พบรายการแจ้งเตือนที่ระบุ' },
        });
      }
      res.json(updated);
    } catch (err: any) {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ error: { code: 'ERROR', message: err.message } });
    }
  });

  // POST /api/v1/notifications/read-all
  router.post('/read-all', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const count = await notificationService.markAllStaffAsRead(
        context.dormitoryId,
        context.userId
      );
      res.json({ markedCount: count });
    } catch (err: any) {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ error: { code: 'ERROR', message: err.message } });
    }
  });

  // GET /api/v1/notifications/preferences
  router.get('/preferences', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const preferences = await notificationService.getPreferences(context.dormitoryId);
      res.json(preferences);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  // PATCH /api/v1/notifications/preferences
  router.patch('/preferences', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      if (context.roleCode !== 'OWNER') {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'เฉพาะเจ้าของหอพักเท่านั้นที่สามารถแก้ไขการตั้งค่าการแจ้งเตือนได้',
          },
        });
      }
      const updated = await notificationService.updatePreferences(
        context.dormitoryId,
        'OWNER',
        req.body
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}

export function createTenantNotificationRouter(
  notificationService: NotificationService = new NotificationService()
): Router {
  const router = Router();

  router.use(extractUnifiedActor);

  const getTenantContext = async (req: Request) => {
    const prisma = getPrismaClient();
    const actor = req.actor;
    let dormitoryId = (req.headers['x-dormitory-id'] as string) || actor?.dormitoryId;
    let tenantId = actor?.tenantId || (req.headers['x-tenant-id'] as string);

    if (req.auth?.userId) {
      const tenant = await prisma.tenant.findFirst({
        where: { linkedUserId: req.auth.userId, ...(dormitoryId ? { dormitoryId } : {}) },
      });
      if (tenant) {
        tenantId = tenant.id;
        dormitoryId = tenant.dormitoryId;
      }
    }

    if (!dormitoryId || !tenantId) {
      throw new Error('FORBIDDEN: Tenant session context missing');
    }
    return { actor, dormitoryId, tenantId };
  };

  router.get('/', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = await getTenantContext(req);
      const notifications = await notificationService.getTenantNotifications(
        dormitoryId,
        tenantId
      );
      const unreadCount = await notificationService.getTenantUnreadCount(
        dormitoryId,
        tenantId
      );
      res.json({ notifications, unreadCount });
    } catch (err: any) {
      res.status(403).json({ error: { message: err.message } });
    }
  });

  router.post('/:id/read', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = await getTenantContext(req);
      const updated = await notificationService.markAsRead(
        dormitoryId,
        req.params.id,
        undefined,
        tenantId
      );
      if (!updated) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'ไม่พบรายการแจ้งเตือนที่ระบุ' },
        });
      }
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  router.post('/read-all', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = await getTenantContext(req);
      const count = await notificationService.markAllTenantAsRead(dormitoryId, tenantId);
      res.json({ markedCount: count });
    } catch (err: any) {
      res.status(400).json({ error: { message: err.message } });
    }
  });

  return router;
}
