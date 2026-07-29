import { Request, Response, NextFunction } from 'express';

export function enforceIdempotency(actionName: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = (req.headers['x-idempotency-key'] as string) || req.headers['idempotency-key'] as string;
    if (key) {
      (req as any).idempotencyKey = `${actionName}_${key}`;
    }
    next();
  };
}
