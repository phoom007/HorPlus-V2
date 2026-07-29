import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const responseTimeMs = Date.now() - startTime;
    logger.info({
      requestId: req.id,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      responseTimeMs,
    }, 'HTTP Request processed');
  });

  next();
}
