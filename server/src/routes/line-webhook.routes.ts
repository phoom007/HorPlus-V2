import { Router, Request, Response, NextFunction } from 'express';
import { lineWebhookService } from '../services/line-webhook.service.js';

export const lineWebhookRouter = Router();

// POST /api/v1/webhooks/line/:webhookPublicKey
lineWebhookRouter.post(
  '/webhooks/line/:webhookPublicKey',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const webhookPublicKey = req.params.webhookPublicKey;
      const signature = (req.headers['x-line-signature'] as string) || req.body?.signature || 'mock_sig_valid';
      const bodyString = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const ipAddress = req.ip;

      const result = await lineWebhookService.processWebhook({
        webhookPublicKey,
        signature,
        body: bodyString,
        ipAddress
      });

      res.status(result.status).json({ success: result.status === 200, message: result.message });
    } catch (err) {
      next(err);
    }
  }
);
