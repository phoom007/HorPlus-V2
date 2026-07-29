import { Request, Response, NextFunction } from 'express';
import { AppError } from '../types/index.js';
import { logger } from '../config/logger.js';

export function globalErrorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id || 'req_unknown';
  const timestamp = new Date().toISOString();

  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
  let fieldErrors: Record<string, string[]> | null = null;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    fieldErrors = err.fieldErrors || null;
  }

  logger.error({
    requestId,
    statusCode,
    errorCode,
    errMessage: err.message,
    stack: err.stack,
  }, 'Error handled by global error handler');

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      fieldErrors,
      requestId,
      timestamp,
    },
  });
}
