import { Router, Request, Response, NextFunction } from 'express';
import { liffSessionService } from '../services/liff-session.service.js';

export const liffSessionRouter = Router();

// POST /api/v1/line/session/exchange
liffSessionRouter.post(
  '/line/session/exchange',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dormId = req.dormitoryId || 'dorm-001';
      const { idToken } = req.body;

      if (!idToken) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'idToken is required' } });
        return;
      }

      const { session, targetRoute, workspaces, selectedWorkspace } = await liffSessionService.exchangeIdToken({
        dormitoryId: dormId,
        idToken
      });

      res.cookie('horplus_line_session', session.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          accessType: session.accessType,
          roleCode: session.roleCode,
          displayName: session.displayName,
          pictureUrl: session.pictureUrl,
          workspaces,
          selectedWorkspace,
          targetRoute
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/line/session/select-workspace
liffSessionRouter.post(
  '/line/session/select-workspace',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentSessionId = req.cookies?.horplus_line_session || (req.headers['x-line-session-id'] as string);
      const { workspaceId } = req.body;

      if (!currentSessionId) {
        res.status(401).json({ success: false, error: { code: 'LINE_SESSION_REQUIRED', message: 'No active LINE session' } });
        return;
      }

      if (!workspaceId) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'workspaceId is required' } });
        return;
      }

      const { session, targetRoute, selectedWorkspace } = await liffSessionService.selectWorkspace({
        currentSessionId,
        workspaceId
      });

      res.cookie('horplus_line_session', session.sessionId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          accessType: session.accessType,
          roleCode: session.roleCode,
          displayName: session.displayName,
          pictureUrl: session.pictureUrl,
          selectedWorkspace,
          targetRoute
        }
      });
    } catch (err: any) {
      if (err.message?.startsWith('WORKSPACE_NOT_AVAILABLE')) {
        res.status(403).json({ success: false, error: { code: 'WORKSPACE_NOT_AVAILABLE', message: err.message } });
        return;
      }
      next(err);
    }
  }
);

// GET /api/v1/line/session
liffSessionRouter.get(
  '/line/session',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.cookies?.horplus_line_session || req.headers['x-line-session-id'];
      const session = liffSessionService.getSession(sessionId as string);

      if (!session) {
        res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'No active session' } });
        return;
      }

      res.json({ success: true, data: session });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/line/session/logout
liffSessionRouter.post(
  '/line/session/logout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.cookies?.horplus_line_session || req.headers['x-line-session-id'];
      if (sessionId) {
        liffSessionService.destroySession(sessionId as string);
      }
      res.clearCookie('horplus_line_session');
      res.json({ success: true, message: 'Logged out' });
    } catch (err) {
      next(err);
    }
  }
);
