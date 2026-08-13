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
    if (!req.auth?.userId) {
      const err: any = new Error('UNAUTHORIZED: Authentication required');
      err.statusCode = 401;
      throw err;
    }

    const context = await resolveAuthoritativeDormitoryContext(req);
    if (!context || !context.dormitoryId || !context.userId || !context.roleCode) {
      const err: any = new Error('FORBIDDEN: Authoritative dormitory context missing or invalid');
      err.statusCode = 403;
      throw err;
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
      const status = err.statusCode || err.status || (err.message?.includes('UNAUTHORIZED') ? 401 : 403);
      res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: err.message } });
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
      const status = err.statusCode || err.status || (err.message?.includes('UNAUTHORIZED') ? 401 : 403);
      res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: err.message } });
    }
  });

  // POST /api/v1/notifications/:id/dismiss (Swipe-to-delete per-user dismissal)
  router.post('/:id/dismiss', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const dismissed = await notificationService.dismissStaffNotification(
        context.dormitoryId,
        req.params.id,
        context.userId
      );
      if (!dismissed) {
        return res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'ไม่พบรายการแจ้งเตือนที่ระบุ' },
        });
      }
      res.json({ success: true, id: req.params.id });
    } catch (err: any) {
      const status = err.statusCode || err.status || (err.message?.includes('UNAUTHORIZED') ? 401 : 403);
      res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: err.message } });
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
      const status = err.statusCode || err.status || (err.message?.includes('UNAUTHORIZED') ? 401 : 403);
      res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: err.message } });
    }
  });

  // GET /api/v1/notifications/preferences
  router.get('/preferences', async (req: Request, res: Response) => {
    try {
      const context = await getStaffContext(req);
      const preferences = await notificationService.getPreferences(context.dormitoryId);
      res.json(preferences);
    } catch (err: any) {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ error: { message: err.message } });
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
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ error: { message: err.message } });
    }
  });

  return router;
}

export function createTenantNotificationRouter(
  notificationService: NotificationService = new NotificationService(),
  authService?: AuthenticationService
): Router {
  const router = Router();

  if (authService) {
    const requireSession = createRequireSessionMiddleware(authService);
    router.use(requireSession);
  }

  router.use(extractUnifiedActor);

  const getTenantContext = async (req: Request) => {
    const userId = req.auth?.userId;
    if (!userId) {
      const err: any = new Error('UNAUTHORIZED: Not logged in');
      err.statusCode = 401;
      throw err;
    }

    const prisma = getPrismaClient();
    const activeMemberships = await prisma.dormitoryMember.findMany({
      where: { userId, status: 'active' },
      include: { role: true },
    });

    const membership = activeMemberships.find(
      (m) => !m.role || (m.role.code || '').toUpperCase() === 'TENANT'
    );

    if (!membership) {
      const err: any = new Error('FORBIDDEN: Not an active tenant member');
      err.statusCode = 403;
      throw err;
    }

    const clientDormId = req.headers['x-dormitory-id'] as string;
    if (clientDormId && clientDormId !== membership.dormitoryId) {
      const err: any = new Error('FORBIDDEN: Dormitory mismatch');
      err.statusCode = 403;
      throw err;
    }

    const tenant = await prisma.tenant.findFirst({
      where: { linkedUserId: userId, dormitoryId: membership.dormitoryId },
    });

    if (!tenant) {
      const err: any = new Error('FORBIDDEN: Tenant record not found');
      err.statusCode = 403;
      throw err;
    }

    return { dormitoryId: membership.dormitoryId, tenantId: tenant.id };
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
      const status = err.statusCode || err.status || 403;
      res.status(status).json({ error: { code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: err.message } });
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
      const status = err.statusCode || err.status || 400;
      res.status(status).json({ error: { message: err.message } });
    }
  });

  router.post('/read-all', async (req: Request, res: Response) => {
    try {
      const { dormitoryId, tenantId } = await getTenantContext(req);
      const count = await notificationService.markAllTenantAsRead(dormitoryId, tenantId);
      res.json({ markedCount: count });
    } catch (err: any) {
      const status = err.statusCode || err.status || 400;
      res.status(status).json({ error: { message: err.message } });
    }
  });

  return router;
}
