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
  } else if ((err as any).code === 'P2025') {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = 'ไม่พบข้อมูลที่ต้องการในระบบ';
  } else if ((err as any).code === 'P2003') {
    statusCode = 400;
    errorCode = 'FOREIGN_KEY_VIOLATION';
    message = 'ข้อมูลอ้างอิงไม่ถูกต้องหรือไม่พบในระบบ';
  } else {
    const explicitStatus = Number((err as any).statusCode ?? (err as any).status);
    if (Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599) {
      statusCode = explicitStatus;
      errorCode = (err as any).code || (err as any).errorCode || (explicitStatus >= 500 ? 'INTERNAL_ERROR' : 'DOMAIN_ERROR');
      
      const rawMsg = err.message || '';
      const isInternalLeak = explicitStatus >= 500 ||
        rawMsg.includes('Prisma') ||
        rawMsg.includes('SELECT ') ||
        rawMsg.includes('INSERT ') ||
        rawMsg.includes('UPDATE ') ||
        rawMsg.includes('DELETE ') ||
        rawMsg.includes('relation ') ||
        rawMsg.includes('column ') ||
        rawMsg.includes('database') ||
        rawMsg.includes('connection');

      message = isInternalLeak ? 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง' : (rawMsg || 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
      fieldErrors = (err as any).fieldErrors || null;
    }
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
