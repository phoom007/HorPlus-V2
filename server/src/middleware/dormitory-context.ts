import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      dormitoryId?: string;
      tenantId?: string;
      requestId?: string;
    }
  }
}

export function extractDormitoryContext() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const headerId = req.headers['x-dormitory-id'] as string | undefined;
    req.dormitoryId = headerId || req.auth?.dormitoryId || 'dorm-001';
    req.requestId = (req.headers['x-request-id'] as string) || `req-${Date.now()}`;
    next();
  };
}
