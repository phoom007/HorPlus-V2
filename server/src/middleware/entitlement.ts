import { Request, Response, NextFunction } from 'express';
import { resolveAuthoritativeDormitoryContext } from './dormitory-context.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';

export async function requireDormitoryWriteEntitlement(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  try {
    const context = (req as any).dormitoryContext;
    let dormitoryId = context?.dormitoryId || (req as any).actor?.dormitoryId || (req as any).dormitoryId || req.auth?.dormitoryId;
    if (!dormitoryId) {
      const resolved = await resolveAuthoritativeDormitoryContext(req).catch(() => null);
      dormitoryId = resolved?.dormitoryId;
    }
    if (dormitoryId) {
      await subscriptionEntitlementService.assertDormitoryWritable(dormitoryId);
    }
    next();
  } catch (err) {
    next(err);
  }
}
