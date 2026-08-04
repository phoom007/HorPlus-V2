import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service.js';
import { localStorageProvider } from '../services/local-storage.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import crypto from 'crypto';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_MIME_TYPE'));
    }
  }
});

const prisma = new PrismaClient();

export function createPaymentRouter(authService: AuthenticationService) {
  const router = Router();
  const requireAuth = authService.requireAuth();
  const requireCsrf = createCsrfMiddleware(authService);

  // Helper to ensure tenant authorization
  const ensureTenant = async (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const membership = auth.memberships.find((m: any) => m.dormitoryId === dormitoryId && m.role === 'tenant');
    if (!membership) return null;
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
    return tenant;
  };

  // Helper to ensure owner/manager authorization
  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    return auth.memberships.find((m: any) => m.dormitoryId === dormitoryId && (m.role === 'owner' || m.role === 'manager'));
  };

  // Tenant: create upload intent
  router.post('/slip/intent', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const dormitoryId = req.body.dormitoryId || auth.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });

      const tenant = await ensureTenant(req, res, dormitoryId);
      if (!tenant) return res.status(403).json({ error: 'Forbidden' });

      const schema = z.object({
        billId: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        fileSize: z.number()
      });
      const data = schema.parse(req.body);

      // Verify bill belongs to tenant
      const bill = await prisma.bill.findUnique({ where: { id: data.billId } });
      if (!bill || bill.tenantId !== tenant.id || bill.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (bill.status === 'PAID') {
        return res.status(400).json({ error: 'ALREADY_PAID' });
      }

      const activePayment = await prisma.payment.findFirst({
        where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] } }
      });
      if (activePayment) {
        return res.status(400).json({ error: 'ACTIVE_REVIEW_EXISTS' });
      }

      // Create PaymentUploadIntent in DB
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const intent = await prisma.paymentUploadIntent.create({
        data: {
          authenticatedUserId: auth.userId,
          tenantId: tenant.id,
          dormitoryId: dormitoryId,
          billId: data.billId,
          expectedMimeType: data.mimeType,
          expectedSize: data.fileSize,
          expiresAt: expiresAt,
          status: 'CREATED'
        }
      });
      
      res.json({ intentId: intent.id, uploadUrl: `/api/v1/payments/slip/upload/${intent.id}`, expiresAt });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Tenant: confirm upload and submit payment
  router.post('/slip/submit', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const dormitoryId = req.body.dormitoryId || auth.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });
      
      const tenant = await ensureTenant(req, res, dormitoryId);
      if (!tenant) return res.status(403).json({ error: 'Forbidden' });

      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
        paymentDate: z.string(),
        intentId: z.string(),
        fileHash: z.string().optional(), // Filehash should be resolved internally if using real storage
      });
      const data = schema.parse(req.body);

      const payment = await paymentService.submitSlip({
        dormitoryId,
        billId: data.billId,
        tenantId: tenant.id,
        amount: data.amount,
        paymentDate: new Date(data.paymentDate),
        intentId: data.intentId,
        idempotencyKey: req.headers['x-idempotency-key'] as string,
        actorUserId: auth.userId
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
  router.post('/cash', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const dormitoryId = req.body.dormitoryId || auth.dormitoryId;
      
      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
      });
      const data = schema.parse(req.body);
      const payment = await paymentService.recordCash({
        dormitoryId,
        ...data,
        userId: auth.userId,
        idempotencyKey: req.headers['x-idempotency-key'] as string,
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Approve
  router.post('/:paymentId/approve', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      
      const dormitoryId = paymentRecord.dormitoryId;
      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const payment = await paymentService.approvePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        idempotencyKey: req.headers['x-idempotency-key'] as string
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reject
  router.post('/:paymentId/reject', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      
      const dormitoryId = paymentRecord.dormitoryId;
      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      
      const payment = await paymentService.rejectPayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey: req.headers['x-idempotency-key'] as string
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reverse
  router.post('/:paymentId/reverse', requireAuth, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      
      const dormitoryId = paymentRecord.dormitoryId;
      const membership = auth.memberships.find((m: any) => m.dormitoryId === dormitoryId && m.role === 'owner');
      if (!membership) {
        return res.status(403).json({ error: 'Forbidden: Owner only' });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      const payment = await paymentService.reversePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey: req.headers['x-idempotency-key'] as string
      });
      res.json(payment);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Secure multipart upload
  router.post('/slip/upload/:intentId', requireAuth, requireCsrf, upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      
      const auth = (req as any).auth;
      const intentId = req.params.intentId;
      const intent = await prisma.paymentUploadIntent.findUnique({ where: { id: intentId } });
      
      if (!intent) return res.status(404).json({ error: 'Intent not found' });
      if (intent.status !== 'CREATED') return res.status(409).json({ error: 'Intent already consumed or uploaded' });
      if (intent.expiresAt < new Date()) return res.status(400).json({ error: 'Intent expired' });
      if (intent.authenticatedUserId !== auth.userId) return res.status(403).json({ error: 'Forbidden' });

      const buffer = req.file.buffer;
      
      // Validate Magic Bytes
      const hex = buffer.toString('hex', 0, 12).toUpperCase();
      let isValidMagic = false;
      let extension = '.jpg';
      if (hex.startsWith('FFD8FF')) { isValidMagic = true; extension = '.jpg'; }
      else if (hex.startsWith('89504E47')) { isValidMagic = true; extension = '.png'; }
      else if (hex.startsWith('52494646') && hex.includes('57454250')) { isValidMagic = true; extension = '.webp'; } // RIFF ... WEBP

      if (!isValidMagic) {
        return res.status(400).json({ error: 'INVALID_FILE_TYPE' });
      }

      // Calculate server SHA-256
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Check if duplicate globally (in payments or active/consumed upload intents)
      const duplicateIntent = await prisma.paymentUploadIntent.findFirst({
        where: { sha256: fileHash, status: { in: ['UPLOADED', 'CONSUMED'] } }
      });
      const duplicatePayment = await prisma.payment.findFirst({
        where: { fileHash: fileHash }
      });
      if (duplicateIntent || duplicatePayment) {
        return res.status(409).json({ error: 'DUPLICATE_PAYMENT_EVIDENCE' });
      }

      // Generate random object key
      const objectKey = `payments/${intent.dormitoryId}/${intent.billId}/${intent.id}_${crypto.randomBytes(8).toString('hex')}${extension}`;
      
      try {
        await localStorageProvider.saveFile(objectKey, buffer);
        
        await prisma.paymentUploadIntent.update({
          where: { id: intent.id },
          data: {
            status: 'UPLOADED',
            verifiedMimeType: req.file.mimetype,
            verifiedSize: req.file.size,
            objectKey,
            sha256: fileHash,
            uploadedAt: new Date()
          }
        });
      } catch (err) {
        // Orphan file rollback
        try {
          await localStorageProvider.deleteFile(objectKey);
        } catch (delErr) {}
        throw err;
      }
      
      res.json({ success: true, objectKey, fileHash });
    } catch(err: any) {
      if (err.message === 'INVALID_MIME_TYPE') return res.status(400).json({ error: err.message });
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Get payment evidence (preview)
  router.get('/:paymentId/evidence', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment) return res.status(404).json({ error: 'Payment not found' });

      const isOwner = ensureOwnerOrManager(req, res, payment.dormitoryId);
      let authorized = false;
      if (isOwner) {
        authorized = true;
      } else {
        const tenant = await ensureTenant(req, res, payment.dormitoryId);
        if (tenant && payment.tenantId === tenant.id) {
          authorized = true;
        }
      }

      if (!authorized) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (!payment.evidenceUrl) {
        return res.status(404).json({ error: 'Evidence not found' });
      }

      const fileBuffer = await localStorageProvider.getFile(payment.evidenceUrl);
      const ext = payment.evidenceUrl.endsWith('.png') ? 'image/png' : payment.evidenceUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', ext);
      res.send(fileBuffer);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Owner: List payments
  router.get('/', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const dormitoryId = req.query.dormitoryId || auth.dormitoryId;
      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const payments = await prisma.payment.findMany({
        where: { dormitoryId },
        include: {
          bill: { include: { tenant: true, room: true } },
          receipt: true,
          statusHistories: { orderBy: { effectiveAt: 'desc' } }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(payments);
    } catch(err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}

