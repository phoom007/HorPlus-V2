import { Request, Response, NextFunction } from 'express';
import { resolveAuthoritativeDormitoryContext } from './dormitory-context.js';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';

export async function requireDormitoryWriteEntitlement(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  try {
    const context = resolveAuthoritativeDormitoryContext(req);
    await subscriptionEntitlementService.assertDormitoryWritable(context.dormitoryId);
    next();
  } catch (err) {
    next(err);
  }
}
