import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { AuthenticationService } from '../services/auth.service.js';
import { AppError } from '../types/index.js';

const promoRedeemSchema = z.object({
  code: z.string().min(1, 'Promo code is required'),
});

export function createSubscriptionRouter(authService?: AuthenticationService): Router {
  const router = Router();
  const csrfMiddleware = authService
    ? createCsrfMiddleware(authService)
    : (_req: Request, _res: Response, next: NextFunction) => next();

  if (authService) {
    router.use(authService.requireAuth());
  }

  // GET /api/v1/subscription/current
  router.get('/current', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = resolveAuthoritativeDormitoryContext(req);
      const subscription = await subscriptionEntitlementService.getCurrentSubscription(context.dormitoryId);
      return res.json({ data: subscription });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/subscription/entitlements
  router.get('/entitlements', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = resolveAuthoritativeDormitoryContext(req);
      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(context.dormitoryId);
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
  router.get('/plans', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const availablePackages = await subscriptionEntitlementService.getAvailablePackages();
      return res.json({ data: availablePackages });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/subscription/promo/redeem
  router.post('/promo/redeem', csrfMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const context = resolveAuthoritativeDormitoryContext(req);

      const isOwner = context.roleCode === 'OWNER';
      const isManager = context.roleCode === 'MANAGER';
      const hasPromoPermission = (context.permissions || []).some((p) =>
        ['*', 'subscription:write', 'subscription:*', 'promo:redeem'].includes(p)
      );

      if (!isOwner && (!isManager || !hasPromoPermission)) {
        throw new AppError('Only dormitory Owners or Managers with promo permissions can redeem promo codes.', 403, 'FORBIDDEN');
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] as string) || (req.headers['idempotency-key'] as string);
      if (!idempotencyKey) {
        throw new AppError('X-Idempotency-Key header is required for promo code redemption.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
      }

      const parsed = promoRedeemSchema.parse(req.body);
      const subscription = await subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: context.dormitoryId,
        code: parsed.code,
        userId: context.userId,
        idempotencyKey,
      });

      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(context.dormitoryId);
      return res.json({
        message: 'Promo code redeemed successfully',
        data: subscription,
        entitlements,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
