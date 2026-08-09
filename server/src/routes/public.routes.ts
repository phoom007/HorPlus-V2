/**
 * Public Unauthenticated API Routes (Task-009 — Website Price Propagation Catalog)
 * @license Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { PlanService } from '../services/plan.service.js';
import { getPrismaClient } from '../db/prisma.js';

export function createPublicRouter(planService: PlanService): Router {
  const router = Router();

  // GET /api/v1/public/plans
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
        roomLimit: p.roomLimit,
        messageQuotaMonthly: p.messageQuotaMonthly,
        displayOrder: p.displayOrder,
      })),
    });
  });

  // GET /api/v1/public/subscription-catalog (Amendment A10 Website Price Propagation)
  router.get('/subscription-catalog', async (_req: Request, res: Response) => {
    try {
      const prisma = getPrismaClient();
      const packages = await prisma.subscriptionPackage.findMany({
        where: { enabled: true, plan: { enabled: true } },
        include: { plan: true },
        orderBy: { durationMonths: 'asc' },
      });

      const catalogDTO = packages.map((pkg) => ({
        id: pkg.id,
        planCode: pkg.plan.code,
        planName: pkg.plan.name,
        durationMonths: pkg.durationMonths,
        price: Number(pkg.price),
        currency: pkg.currency,
        catalogVersion: pkg.catalogVersion,
        roomLimit: pkg.plan.roomLimit,
        messageQuotaMonthly: pkg.plan.messageQuotaMonthly,
      }));

      res.json({ data: catalogDTO });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'CATALOG_FETCH_FAILED',
          message: 'ไม่สามารถดึงข้อมูลแพ็กเกจจากระบบได้',
          fieldErrors: null,
          requestId: (_req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
  });

  return router;
}
