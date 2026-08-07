/**
 * LINE OA Administration & Webhook Routes (Task-009 Final Product Model)
 * @license Apache-2.0
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { LineOaService } from '../services/line-oa.service.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { AppError } from '../types/index.js';

export function createLineOaRoutes(prisma: PrismaClient) {
  const router = Router();
  const lineOaService = new LineOaService(prisma);

  // --------------------------------------------------------------------------
  // Public Webhook Endpoint (Opaque Key in Path, Raw Body Signature Verification)
  // --------------------------------------------------------------------------

  /**
   * POST /api/v1/line/webhook/:opaqueWebhookKey
   * Expects raw request body buffer (express.raw) for signature validation
   */
  router.post(
    '/line/webhook/:opaqueWebhookKey',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const opaqueKey = req.params.opaqueWebhookKey;
        const signatureHeader = req.headers['x-line-signature'] as string;

        // Ensure body is raw Buffer
        const bodyBuffer = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

        const result = await lineOaService.processWebhookEvent(
          opaqueKey,
          bodyBuffer,
          signatureHeader
        );

        return res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // --------------------------------------------------------------------------
  // OWNER-Only LINE OA Configuration Routes
  // --------------------------------------------------------------------------

  /**
   * GET /api/v1/dormitories/:dormId/line-oa/config
   * Get LINE OA connection status (Secrets REDACTED)
   */
  router.get(
    '/dormitories/:dormId/line-oa/config',
    requireDormitoryPermission('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const config = await lineOaService.getDormitoryLineConfig(dormId, baseUrl);
        return res.status(200).json({
          success: true,
          data: config
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * PUT /api/v1/dormitories/:dormId/line-oa/config
   * Update LINE OA credentials (Encrypted at rest)
   */
  router.put(
    '/dormitories/:dormId/line-oa/config',
    requireDormitoryPermission('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const { lineOaId, channelId, channelSecret, channelAccessToken } = req.body;

        const updated = await lineOaService.updateDormitoryLineConfig(dormId, {
          lineOaId,
          channelId,
          channelSecret,
          channelAccessToken
        });

        return res.status(200).json({
          success: true,
          data: updated
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/dormitories/:dormId/line-oa/disconnect
   * Disconnect LINE OA
   */
  router.post(
    '/dormitories/:dormId/line-oa/disconnect',
    requireDormitoryPermission('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const result = await lineOaService.disconnectLineConfig(dormId);
        return res.status(200).json({
          success: true,
          data: result
        });
      } catch (err) {
        next(err);
      }
    }
  );

  /**
   * POST /api/v1/dormitories/:dormId/line-oa/rotate-webhook-key
   * Rotate webhook opaque key
   */
  router.post(
    '/dormitories/:dormId/line-oa/rotate-webhook-key',
    requireDormitoryPermission('line_oa:manage'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const dormId = req.params.dormId;
        const result = await lineOaService.rotateWebhookKey(dormId);
        return res.status(200).json({
          success: true,
          data: result
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
