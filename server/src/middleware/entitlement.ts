import { Request, Response, NextFunction } from 'express';
import { subscriptionEntitlementService } from '../services/subscription-entitlement.service.js';

export async function requireDormitoryWriteEntitlement(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }

  const dormitoryId = (req.headers['x-dormitory-id'] as string) || (req as any).sessionData?.dormitoryId || (req as any).auth?.dormitoryId;

  if (!dormitoryId) {
    return next();
  }

  try {
    await subscriptionEntitlementService.assertDormitoryWritable(dormitoryId);
    next();
  } catch (err) {
    next(err);
  }
}
