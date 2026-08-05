import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { AuthenticationService } from '../services/auth.service.js';
import { AppError } from '../types/index.js';

const promoRedeemSchema = z.object({
  code: z.string().min(1, 'Promo code is required'),
});

const activatePackageSchema = z.object({
  durationMonths: z.number().int().positive(),
});

function getContext(req: Request) {
  const auth = (req as any).auth;
  const dormitoryId = (req.headers['x-dormitory-id'] as string) || (req as any).sessionData?.dormitoryId || auth?.dormitoryId || (req.params as any)?.dormitoryId || (req.query as any)?.dormitoryId;
  const userId = auth?.user?.id || (req as any).sessionData?.userId;
  return { dormitoryId, userId };
}

export function createSubscriptionRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const csrfMiddleware = authService
    ? createCsrfMiddleware(authService)
    : (_req: Request, _res: Response, next: NextFunction) => next();

  if (authService) {
    router.use(authService.requireAuth());
  }

  // GET /api/v1/subscription/current
  router.get('/current', async (req: Request, res: Response, next) => {
    try {
      const { dormitoryId } = getContext(req);
      if (!dormitoryId) {
        throw new AppError('Dormitory context required (x-dormitory-id header)', 400, 'DORMITORY_ID_REQUIRED');
      }

      const subscription = await subscriptionEntitlementService.getCurrentSubscription(dormitoryId);
      return res.json({ data: subscription });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/subscription/entitlements
  router.get('/entitlements', async (req: Request, res: Response, next) => {
    try {
      const { dormitoryId } = getContext(req);
      if (!dormitoryId) {
        throw new AppError('Dormitory context required (x-dormitory-id header)', 400, 'DORMITORY_ID_REQUIRED');
      }

      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormitoryId);
      const availablePackages = await subscriptionEntitlementService.getAvailablePackages();

      return res.json({
        data: {
          ...entitlements,
          availablePackages,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/subscription/plans
  router.get('/plans', async (_req: Request, res: Response, next) => {
    try {
      const availablePackages = await subscriptionEntitlementService.getAvailablePackages();
      return res.json({ data: availablePackages });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/subscription/promo/redeem
  router.post('/promo/redeem', csrfMiddleware, async (req: Request, res: Response, next) => {
    try {
      const { dormitoryId, userId } = getContext(req);
      if (!dormitoryId || !userId) {
        throw new AppError('Authenticated dormitory context required.', 401, 'UNAUTHORIZED');
      }

      const parsed = promoRedeemSchema.parse(req.body);
      const subscription = await subscriptionEntitlementService.redeemPromoCode({
        dormitoryId,
        code: parsed.code,
        userId,
      });

      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormitoryId);
      return res.json({
        message: 'Promo code redeemed successfully',
        data: subscription,
        entitlements,
      });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/subscription/activate (Operational test activation)
  router.post('/activate', csrfMiddleware, async (req: Request, res: Response, next) => {
    try {
      const { dormitoryId, userId } = getContext(req);
      if (!dormitoryId || !userId) {
        throw new AppError('Authenticated dormitory context required.', 401, 'UNAUTHORIZED');
      }

      const parsed = activatePackageSchema.parse(req.body);
      const subscription = await subscriptionEntitlementService.activatePaidSubscription({
        dormitoryId,
        durationMonths: parsed.durationMonths,
        actorId: userId,
      });

      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormitoryId);
      return res.json({
        message: `Paid package for ${parsed.durationMonths} month(s) activated successfully`,
        data: subscription,
        entitlements,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
