/**
 * LINE OA Administration & Webhook Routes (Task-009 Checkpoint 1C)
 * Public: webhook ingestion (opaque key + signature verification)
 * Protected: OA config management
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { LineOaService } from '../services/line-oa.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { LinePlatformAdapter } from '../services/line-platform-adapter.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { getEnv } from '../config/env.js';

export function createLineOaRoutes(
  prisma: PrismaClient,
  authService?: AuthenticationService,
  lineAdapter?: LinePlatformAdapter
) {
  const publicRouter = Router();
  const protectedRouter = Router();
  const lineOaService = new LineOaService(prisma, lineAdapter);

  const requireSession = authService
    ? authService.requireAuth()
    : (_req: Request, _res: Response, next: NextFunction) => next();

  const authGuard = (permission: string) => [
    requireSession,
    requireDormitoryPermission(permission),
  ];

  const mutationGuard = (permission: string) => [
    requireSession,
    requireDormitoryPermission(permission),
    requireDormitoryWriteEntitlement,
  ];

  // ---------- CSRF helper ----------
  const verifyCsrf = (req: Request, res: Response): boolean => {
    if (!authService) return true;
    const env = getEnv();
    const csrfHeaderName = 'x-csrf-token';
    const csrfCookieName = env.CSRF_COOKIE_NAME || 'horplus_csrf';
    const csrfToken = (req.headers[csrfHeaderName] as string) || req.cookies?.[csrfCookieName];
    const sessionId = req.auth?.sessionId;
    if (!sessionId || !authService.verifyCsrf(csrfToken, sessionId)) {
      res.status(403).json({
        error: {
          code: 'CSRF_INVALID',
          message: 'CSRF Token ไม่ถูกต้องหรือหมดอายุแล้ว',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
      return false;
    }
    return true;
  };

  const getDormitoryId = (req: Request): string => {
    const context = (req as any).dormitoryContext || resolveAuthoritativeDormitoryContext(req);
    return context.dormitoryId;
  };

  const verifyDormitoryMatch = (req: Request, res: Response, next: NextFunction) => {
    const routeDormId = req.params.id || req.params.dormId || req.params.dormitoryId;
    const authDormId = getDormitoryId(req);
    if (routeDormId && authDormId && routeDormId !== authDormId) {
      return res.status(403).json({
        error: {
          code: 'DORMITORY_MISMATCH',
          message: 'Target dormitory ID does not match authenticated dormitory context',
          fieldErrors: null,
          requestId: (req.headers['x-request-id'] as string) || 'req-unknown',
          timestamp: new Date().toISOString(),
        },
      });
    }
    next();
  };

  // ==========================================================================
  // PUBLIC WEBHOOK (no session required — opaque key + HMAC signature)
  // ==========================================================================

  publicRouter.post(
    '/line/webhook/:opaqueWebhookKey',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const opaqueKey = req.params.opaqueWebhookKey;
        const signatureHeader = req.headers['x-line-signature'] as string;

        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

        const result = await lineOaService.processWebhookEvent(
          opaqueKey, bodyBuffer, signatureHeader
        );

        return res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // ==========================================================================
  // PROTECTED LINE OA CONFIG
  // ==========================================================================

  protectedRouter.get(
    '/dormitories/:dormId/line-oa/config',
    ...authGuard('line_oa:manage'),
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = getDormitoryId(req);
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const config = await lineOaService.getDormitoryLineConfig(dormId, baseUrl);
        return res.status(200).json({ success: true, data: config });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.put(
    '/dormitories/:dormId/line-oa/config',
    ...mutationGuard('line_oa:manage'),
    verifyDormitoryMatch,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormId = getDormitoryId(req);
        const updated = await lineOaService.updateDormitoryLineConfig(dormId, req.body);
        return res.status(200).json({ success: true, data: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  return { publicRouter, protectedRouter };
}
