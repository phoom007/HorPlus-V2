import { Router } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service.js';
import { localStorageProvider } from '../services/local-storage.service.js';

export function createPaymentRouter() {
  const router = Router();

  // Tenant: create upload intent
  router.post('/slip/intent', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });

      const schema = z.object({
        billId: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        fileSize: z.number()
      });
      const data = schema.parse(req.body);

      const intent = await localStorageProvider.createUploadIntent({
        dormitoryId,
        ...data
      });
      res.json(intent);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Tenant: confirm upload and submit payment
  router.post('/slip/submit', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });
      // TODO: ensure tenantId matches current user or occupancy

      const schema = z.object({
        billId: z.string(),
        tenantId: z.string(),
        amount: z.string(),
        paymentDate: z.string(),
        intentId: z.string(),
        fileHash: z.string(),
      });
      const data = schema.parse(req.body);

      const payment = await paymentService.submitSlip({
        dormitoryId,
        ...data,
        paymentDate: new Date(data.paymentDate),
        idempotencyKey: req.headers['x-idempotency-key'] as string
      });
      res.json(payment);
    } catch (err: any) {
      if (err.message === 'DUPLICATE_PAYMENT_EVIDENCE') {
        return res.status(409).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Record Cash
  router.post('/cash', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
      });
      const data = schema.parse(req.body);
      const payment = await paymentService.recordCash({
        dormitoryId,
        ...data,
        userId: req.user?.id || 'sys'
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Approve
  router.post('/:paymentId/approve', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      const payment = await paymentService.approvePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: req.user?.id || 'sys',
        idempotencyKey: req.headers['x-idempotency-key'] as string
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reject
  router.post('/:paymentId/reject', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      const payment = await paymentService.rejectPayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: req.user?.id || 'sys',
        reason: data.reason
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reverse
  router.post('/:paymentId/reverse', async (req, res) => {
    try {
      const dormitoryId = (req as any).dormitory?.id || req.body.dormitoryId;
      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      const payment = await paymentService.reversePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: req.user?.id || 'sys',
        reason: data.reason
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Handle raw file upload for local dev mock
  router.post('/slip/upload-chunk/:intentId', require('express').raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    try {
      const buffer = req.body;
      const objectKey = `payments/mock/${req.params.intentId}.jpg`;
      await localStorageProvider.saveFile(objectKey, buffer);
      res.json({ success: true, objectKey });
    } catch(err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
