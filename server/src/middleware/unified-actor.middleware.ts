import { Request, Response, NextFunction } from 'express';


export interface AuthenticatedActor {
  actorType: 'google_owner';
  sessionId: string;
  userId?: string;
  dormitoryId: string;
  dormitoryMemberId?: string;
  roleCode?: 'OWNER' | 'MANAGER' | 'TECH' | 'STAFF';
  tenantId?: string;
  contractId?: string;
  roomId?: string;
  displayName?: string;
  pictureUrl?: string;
}

declare global {
  namespace Express {
    interface Request {
      actor?: AuthenticatedActor;
    }
  }
}

export function extractUnifiedActor() {
  return (req: Request, _res: Response, next: NextFunction) => {
    // 1. Check Google Owner Session
    if (req.auth?.userId) {
      req.actor = {
        actorType: 'google_owner',
        sessionId: req.auth.sessionId,
        userId: req.auth.userId,
        dormitoryId: req.dormitoryId || 'dorm-001',
        roleCode: 'OWNER',
        displayName: req.auth.user.name
      };
      return next();
    }

    next();
  };
}

export function requireAnyAuthenticatedActor() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({
        error: {
          code: 'LINE_SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}

export function requireGoogleOwnerSession() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || req.actor.actorType !== 'google_owner') {
      return res.status(403).json({
        error: {
          code: 'GOOGLE_SESSION_REQUIRED',
          message: 'สิทธิ์นี้จำเป็นต้องเข้าสู่ระบบด้วย Google Owner',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}

export function requireStaffSession() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || req.actor.actorType !== 'google_owner') {
      return res.status(403).json({
        error: {
          code: 'STAFF_SESSION_REQUIRED',
          message: 'สิทธิ์นี้สำหรับเจ้าของหรือพนักงานหอพักเท่านั้น',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}

export function requireOwnerOrManager() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }

    const role = req.actor.roleCode;
    if (role !== 'OWNER' && role !== 'MANAGER') {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSION',
          message: 'สิทธิ์นี้เฉพาะเจ้าของหรือผู้จัดการหอพักเท่านั้น',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}

export function requireOwnerOnly() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || req.actor.roleCode !== 'OWNER') {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSION',
          message: 'สิทธิ์นี้เฉพาะเจ้าของหอพักเท่านั้น',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}

export function requireTechAccess() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor) {
      return res.status(401).json({
        error: {
          code: 'SESSION_REQUIRED',
          message: 'กรุณาเข้าสู่ระบบก่อนใช้งาน',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    const role = req.actor.roleCode;
    if (role !== 'OWNER' && role !== 'MANAGER' && role !== 'TECH') {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSION',
          message: 'ไม่มีสิทธิ์เข้าถึงฟังก์ชันนี้',
          requestId: req.requestId || 'req-unknown',
          timestamp: new Date().toISOString()
        }
      });
    }
    next();
  };
}
