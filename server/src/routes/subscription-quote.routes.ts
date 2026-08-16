/**
 * Subscription Package Intent Quote & Commit API Routes (LOCAL-07 Master)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { subscriptionIntentService } from '../services/subscription-intent.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createRequireSessionMiddleware } from '../middleware/require-session.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';

const createQuoteSchema = z.object({
  packageId: z.string().uuid().optional(),
  dormitoryId: z.string().uuid().optional(),
  isFreePlan: z.boolean().optional(),
  promoCode: z.string().optional(),
  referralCode: z.string().optional(),
  coinRequested: z.number().int().min(0).optional(),
});

const commitIntentSchema = z.object({
  intentId: z.string().uuid(),
  idempotencyKey: z.string().optional(),
});

export function createSubscriptionQuoteRouter(authService: AuthenticationService): Router {
  const router = Router();
  const requireSession = createRequireSessionMiddleware(authService);
  const csrfMiddleware = createCsrfMiddleware(authService);

  /**
   * GET /api/v1/subscription/packages
   * List all available packages with sale price, reference price, and duration
   */
  router.get('/packages', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const prisma = getPrismaClient();
      const packages = await prisma.subscriptionPackage.findMany({
        where: { enabled: true },
        include: { plan: true },
        orderBy: { durationMonths: 'asc' },
      });

      const freePlan = await prisma.subscriptionPlan.findUnique({
        where: { code: 'FREE' },
      });

      res.json({
        success: true,
        data: {
          freePlan,
          packages: packages.map((pkg) => ({
            id: pkg.id,
            planCode: pkg.plan.code,
            durationMonths: pkg.durationMonths,
            price: pkg.price ? pkg.price.toString() : null,
            referencePrice: pkg.referencePrice ? pkg.referencePrice.toString() : null,
            currency: pkg.currency,
            enabled: pkg.enabled,
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/subscription/quote
   * Create authoritative server-side pricing quote snapshot in SubscriptionPackageIntent
   */
  router.post('/quote', requireSession, csrfMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth!.userId;
      const body = createQuoteSchema.parse(req.body);
      const requestedDormId =
        (req.headers['x-dormitory-id'] as string) ||
        body.dormitoryId ||
        (req.query?.dormitoryId as string);
      const quote = await subscriptionIntentService.createIntentQuote(userId, body, undefined, requestedDormId);

      res.json({
        success: true,
        data: quote,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /api/v1/subscription/commit
   * Commit zero-pay intent to activate subscription (Free plan, 1-mo PRO trial, or 100% Coin discount)
   */
  router.post('/commit', requireSession, csrfMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.auth!.userId;
      const { intentId, idempotencyKey } = commitIntentSchema.parse(req.body);
      const result = await subscriptionIntentService.commitZeroPayIntent(userId, intentId, idempotencyKey);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export default createSubscriptionQuoteRouter;
