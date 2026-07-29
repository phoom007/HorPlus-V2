import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incomingRequestId = req.header('X-Request-Id');
  const validRequestIdRegex = /^[a-zA-Z0-9\-_]{8,64}$/;

  const requestId = incomingRequestId && validRequestIdRegex.test(incomingRequestId)
    ? incomingRequestId
    : `req_${uuidv4()}`;

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
