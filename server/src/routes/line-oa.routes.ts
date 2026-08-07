/**
 * LINE OA Administration & Webhook Routes (Task-009 — Canonical Auth Stack)
 * Public: webhook ingestion (opaque key + signature verification)
 * Protected: OA config management
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { LineOaService } from '../services/line-oa.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { AppError } from '../types/index.js';

export function createLineOaRoutes(prisma: PrismaClient, authService?: AuthenticationService) {
  const publicRouter = Router();
  const protectedRouter = Router();
  const lineOaService = new LineOaService(prisma);

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
    const csrfToken = (req.headers['x-csrf-token'] as string) || req.cookies?.['horplus_csrf'];
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
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormId = getDormitoryId(req);
        const { lineOaId, channelId, channelSecret, channelAccessToken } = req.body;

        const updated = await lineOaService.updateDormitoryLineConfig(dormId, {
          lineOaId, channelId, channelSecret, channelAccessToken
        });

        return res.status(200).json({ success: true, data: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.post(
    '/dormitories/:dormId/line-oa/disconnect',
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormId = getDormitoryId(req);
        const result = await lineOaService.disconnectLineConfig(dormId);
        return res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  protectedRouter.post(
    '/dormitories/:dormId/line-oa/rotate-webhook-key',
    ...mutationGuard('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        if (!verifyCsrf(req, res)) return;
        const dormId = getDormitoryId(req);
        const result = await lineOaService.rotateWebhookKey(dormId);
        return res.status(200).json({ success: true, data: result });
      } catch (err) {
        next(err);
      }
    }
  );

  return { publicRouter, protectedRouter };
}
