import { Router, Request, Response, NextFunction } from 'express';
import { lineIntegrationService } from '../services/line-integration.service.js';
import { requirePermission } from '../middleware/permission.middleware.js';

export const lineIntegrationRouter = Router();

// GET /api/v1/integrations/line
lineIntegrationRouter.get(
  '/integrations/line',
  requirePermission('line_settings.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const settings = await lineIntegrationService.getIntegrationSettings(dormId);
      res.json({ success: true, data: settings });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/integrations/line
lineIntegrationRouter.put(
  '/integrations/line',
  requirePermission('line_settings.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const { messagingChannelId, channelSecret, lineLoginChannelId, liffId, liffEndpointUrl } = req.body;
      if (!messagingChannelId || !channelSecret) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'messagingChannelId and channelSecret are required' } });
        return;
      }
      const userId = req.user?.id || req.auth?.userId;
      const updated = await lineIntegrationService.saveIntegrationSettings({
        dormitoryId: dormId,
        messagingChannelId,
        channelSecret,
        lineLoginChannelId,
        liffId,
        liffEndpointUrl,
        userId
      });

      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/integrations/line/test
lineIntegrationRouter.post(
  '/integrations/line/test',
  requirePermission('line_settings.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const { channelSecret } = req.body || {};
      const result = await lineIntegrationService.testConnection(dormId, channelSecret);
      res.json({ success: result.success, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/integrations/line/disconnect
lineIntegrationRouter.post(
  '/integrations/line/disconnect',
  requirePermission('line_settings.update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const userId = req.user?.id || req.auth?.userId;
      const result = await lineIntegrationService.disconnectIntegration(dormId, userId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/integrations/line/owner-binding/complete
lineIntegrationRouter.post(
  '/integrations/line/owner-binding/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const userId = req.user?.id || req.auth?.userId || 'user-001';
      const memberId = req.dormitoryContext?.memberId || 'mem-001';
      const { liffIdToken } = req.body;

      if (!liffIdToken) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'liffIdToken is required' } });
        return;
      }

      const bound = await lineIntegrationService.bindOwnerLineAccount({
        dormitoryId: dormId,
        userId,
        memberId,
        liffIdToken
      });

      res.json({ success: true, data: bound });
    } catch (err) {
      next(err);
    }
  }
);
