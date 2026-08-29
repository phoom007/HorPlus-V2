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
  } else if ((err as any).code === 'P2023' || (err.message && err.message.includes('Malformed UUID')) || (err.message && err.message.includes('invalid input syntax for type uuid'))) {
    statusCode = 400;
    errorCode = 'INVALID_ID_FORMAT';
    message = 'รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID';
  } else if ((err as any).statusCode || (err as any).status || (err as any).code || (err as any).errorCode) {
    statusCode = Number((err as any).statusCode || (err as any).status) || 500;
    errorCode = (err as any).code || (err as any).errorCode || 'INTERNAL_ERROR';
    message = err.message || 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
    fieldErrors = (err as any).fieldErrors || null;
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
