import { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { AuthenticationService } from '../services/auth.service.js';
import { UserEntity } from '../db/repositories/user.repository.js';
import { SessionEntity } from '../db/repositories/session.repository.js';
import { DormitoryMemberEntity } from '../db/repositories/membership.repository.js';

export interface AuthenticatedAuthContext {
  userId: string;
  sessionId: string;
  tokenVersion: number;
  user: UserEntity;
  session: SessionEntity;
  memberships: DormitoryMemberEntity[];
  dormitoryId?: string;
  role?: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedAuthContext;
      user?: UserEntity;
      dormitoryId?: string;
      requestId?: string;
      cookies?: Record<string, string>;
    }
  }
}

export function createRequireSessionMiddleware(authService: AuthenticationService) {
  const env = getEnv();

  return async (req: Request, res: Response, next: NextFunction) => {
    const sessionCookie = req.cookies?.[env.SESSION_COOKIE_NAME];
    const requestId = (req.headers['x-request-id'] as string) || 'req-unknown';

    if (!sessionCookie) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }

    try {
      const validated = await authService.validateSession(sessionCookie, requestId);

      if (!validated) {
        console.warn('require-session: session validation failed', { requestId, category: 'SESSION_INVALID' });
        return res.status(401).json({
          error: {
            code: 'SESSION_INVALID',
            message: 'เซสชันไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่',
            fieldErrors: null,
            requestId,
            timestamp: new Date().toISOString(),
          },
        });
      }


      
      req.auth = {
        userId: validated.user.id,
        sessionId: validated.rawSessionId,
        tokenVersion: validated.session.tokenVersion,
        user: validated.user,
        session: validated.session,
        memberships: validated.memberships,
        dormitoryId: validated.memberships[0]?.dormitoryId,
      };

      next();
    } catch (err: any) {
      console.warn('require-session: validation error', { requestId, category: 'SESSION_VALIDATION_ERROR' });
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'การตรวจสอบเซสชันผิดพลาด กรุณาเข้าสู่ระบบใหม่',
          fieldErrors: null,
          requestId,
          timestamp: new Date().toISOString(),
        },
      });
    }
  };
}
