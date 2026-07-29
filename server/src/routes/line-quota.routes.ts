import { Router, Request, Response, NextFunction } from 'express';
import { lineQuotaService } from '../services/line-quota.service.js';
import { lineRepository } from '../db/repositories/line.repository.js';
import { requirePermission } from '../middleware/permission.middleware.js';

export const lineQuotaRouter = Router();

// GET /api/v1/line/message-quota
lineQuotaRouter.get(
  '/line/message-quota',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const quota = await lineQuotaService.getQuotaStatus(dormId);
      res.json({ success: true, data: quota });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/line/message-deliveries
lineQuotaRouter.get(
  '/line/message-deliveries',
  requirePermission('line_deliveries.view'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const deliveries = await lineRepository.listDeliveries(dormId);
      res.json({ success: true, data: deliveries });
    } catch (err) {
      next(err);
    }
  }
);
