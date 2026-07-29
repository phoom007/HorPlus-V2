import { Router, Request, Response } from 'express';
import { PlanService } from '../services/plan.service.js';

export function createPublicRouter(planService: PlanService): Router {
  const router = Router();

  router.get('/plans', async (_req: Request, res: Response) => {
    const plans = await planService.getActivePlans();
    res.json({
      data: plans.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        monthlyPrice: p.monthlyPrice,
        currency: p.currency,
        vatIncluded: p.vatIncluded,
        roomLimit: p.roomLimit, // null for ENTERPRISE
        messageQuotaMonthly: p.messageQuotaMonthly,
        displayOrder: p.displayOrder,
      })),
    });
  });

  return router;
}
