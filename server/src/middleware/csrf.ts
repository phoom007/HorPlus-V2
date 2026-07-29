import { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { AuthenticationService } from '../services/auth.service.js';

export function createCsrfMiddleware(authService: AuthenticationService) {
  const env = getEnv();

  return (req: Request, res: Response, next: NextFunction) => {
    // Exempt safe methods
    const method = req.method.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return next();
    }

    // Exempt initial Google Auth exchange endpoint
    const path = req.path || req.originalUrl;
    if (path.endsWith('/auth/google')) {
      return next();
    }

    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';
    const csrfHeader = req.headers['x-csrf-token'] as string | undefined;
    const csrfCookie = req.cookies?.[env.CSRF_COOKIE_NAME];

    if (!csrfHeader) {
      return res.status(403).json({
        error: {
          code: 'CSRF_TOKEN_REQUIRED',
          message: 'ไม่พบ CSRF token ในคำขอ (X-CSRF-Token header missing)',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const sessionId = req.auth?.sessionId;
    if (!sessionId) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'ไม่พบข้อมูลเซสชันสำหรับตรวจสอบ CSRF token',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    const isValid = authService.verifyCsrf(csrfHeader, sessionId);
    if (!isValid || (csrfCookie && csrfCookie !== csrfHeader)) {
      return res.status(403).json({
        error: {
          code: 'CSRF_TOKEN_INVALID',
          message: 'CSRF token ไม่ถูกต้องหรือไม่สัมพันธ์กับเซสชันปัจจุบัน',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    next();
  };
}
