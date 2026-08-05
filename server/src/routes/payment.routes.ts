import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { paymentService } from '../services/payment.service.js';
import { localStorageProvider } from '../services/local-storage.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { logger } from '../config/logger.js';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import crypto from 'crypto';

const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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

export interface ImageValidationResult {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  extension: '.jpg' | '.png' | '.webp';
  size: number;
}

export function detectAndValidateImage(buffer: Buffer, expectedMime?: string | null): ImageValidationResult {
  if (!buffer || buffer.length < 16) {
    throw new Error('INVALID_FILE_STRUCTURE: File is too small or truncated');
  }

  let detectedMime: 'image/jpeg' | 'image/png' | 'image/webp' | null = null;
  let extension: '.jpg' | '.png' | '.webp' = '.jpg';

  // Check PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0D &&
    buffer[5] === 0x0A &&
    buffer[6] === 0x1A &&
    buffer[7] === 0x0A
  ) {
    // Structural check: Must contain IEND chunk (49 45 4E 44)
    const iendIndex = buffer.indexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44]));
    if (iendIndex === -1) {
      throw new Error('INVALID_FILE_STRUCTURE: Corrupt PNG image missing IEND chunk');
    }
    detectedMime = 'image/png';
    extension = '.png';
  }
  // Check JPEG: FF D8 FF
  else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    // Structural check: Must end with or contain EOI (FF D9)
    const eoiIndex = buffer.lastIndexOf(Buffer.from([0xFF, 0xD9]));
    if (eoiIndex === -1 || eoiIndex < 3) {
      throw new Error('INVALID_FILE_STRUCTURE: Corrupt JPEG image missing EOI marker');
    }
    detectedMime = 'image/jpeg';
    extension = '.jpg';
  }
  // Check WebP: RIFF at 0..3 and WEBP at 8..11
  else if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 && // RIFF
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50 // WEBP
  ) {
    // Check chunk type at 12..15 (VP8 , VP8L, VP8X)
    const chunkType = buffer.toString('ascii', 12, 16);
    if (!['VP8 ', 'VP8L', 'VP8X'].includes(chunkType)) {
      throw new Error('INVALID_FILE_STRUCTURE: Invalid WebP chunk header');
    }
    detectedMime = 'image/webp';
    extension = '.webp';
  }

  if (!detectedMime) {
    throw new Error('INVALID_FILE_TYPE: Unsupported or unrecognized image format');
  }

  if (expectedMime && expectedMime !== detectedMime) {
    throw new Error(`MIME_TYPE_MISMATCH: Declared ${expectedMime} but detected ${detectedMime}`);
  }

  return {
    mimeType: detectedMime,
    extension,
    size: buffer.length
  };
}

export function createPaymentRouter(authService: AuthenticationService) {
  const router = Router();
  const requireAuth = authService.requireAuth();
  const requireCsrf = createCsrfMiddleware(authService);

  const ensureTenant = async (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const membership = auth?.memberships?.find((m: any) => {
      const code = (m.roleCode || m.role || m.roleId || '').toLowerCase();
      return m.dormitoryId === dormitoryId && code.includes('tenant');
    });
    if (!membership) return null;
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
    return tenant;
  };

  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const isOk = auth?.memberships?.find((m: any) => {
      const code = (m.roleCode || m.role || m.roleId || '').toLowerCase();
      return m.dormitoryId === dormitoryId && (code.includes('owner') || code.includes('manager') || code.includes('admin'));
    });
    if (!isOk) {
      logger.warn('payment authorization denied', {
        requestId: (req as any).id,
        category: 'PAYMENT_AUTHORIZATION_DENIED',
      });
    }
    return isOk;
  };

  // Tenant: create upload intent
  router.post('/slip/intent', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });

      const tenant = await ensureTenant(req, res, dormitoryId);
      if (!tenant) return res.status(403).json({ error: 'Forbidden' });

      const schema = z.object({
        billId: z.string(),
        fileName: z.string(),
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        fileSize: z.number().int().positive()
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

      // Create PaymentUploadIntent in DB with 15-minute TTL
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

      res.json({
        intentId: intent.id,
        uploadUrl: `/api/v1/payments/slip/upload/${intent.id}`,
        expiresAt
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Secure multipart upload
  router.post('/slip/upload/:intentId', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, upload.single('file'), async (req, res) => {
    let objectKey: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;
      const intentId = req.params.intentId;
      const intent = await prisma.paymentUploadIntent.findUnique({ where: { id: intentId } });

      if (!intent || intent.dormitoryId !== dormitoryId) return res.status(404).json({ error: 'Intent not found' });
      if (intent.status !== 'CREATED') return res.status(409).json({ error: 'Intent already consumed or uploaded' });
      if (intent.expiresAt < new Date()) return res.status(400).json({ error: 'Intent expired' });
      if (intent.authenticatedUserId !== auth.userId) return res.status(403).json({ error: 'Forbidden' });

      const buffer = req.file.buffer;

      // 1. Structural and MIME validation against expected MIME
      const validation = detectAndValidateImage(buffer, intent.expectedMimeType);

      // 2. Expected size validation
      if (intent.expectedSize && buffer.length !== intent.expectedSize) {
        return res.status(400).json({ error: 'SIZE_MISMATCH: Uploaded size differs from expected size' });
      }

      // 3. Compute SHA-256 server-side only
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // 4. Check duplicate globally
      const duplicateIntent = await prisma.paymentUploadIntent.findFirst({
        where: { sha256: fileHash, status: { in: ['UPLOADED', 'CONSUMED'] } }
      });
      const duplicatePayment = await prisma.payment.findFirst({
        where: { fileHash: fileHash }
      });
      if (duplicateIntent || duplicatePayment) {
        return res.status(409).json({ error: 'DUPLICATE_PAYMENT_EVIDENCE' });
      }

      // 5. Generate secure object key and write file
      objectKey = `payments/${intent.dormitoryId}/${intent.billId}/${intent.id}_${crypto.randomBytes(8).toString('hex')}${validation.extension}`;
      await localStorageProvider.saveFile(objectKey, buffer);

      // 6. Update database record with verified MIME and size
      try {
        await prisma.paymentUploadIntent.update({
          where: { id: intent.id },
          data: {
            status: 'UPLOADED',
            verifiedMimeType: validation.mimeType,
            verifiedSize: validation.size,
            objectKey,
            sha256: fileHash,
            uploadedAt: new Date()
          }
        });
      } catch (dbErr: any) {
        // Concurrency unique collision or constraint error
        if (dbErr.code === 'P2002' || (dbErr.message && dbErr.message.includes('unique'))) {
          throw new Error('DUPLICATE_PAYMENT_EVIDENCE');
        }
        throw dbErr;
      }

      // Return success without exposing raw internal objectKey or fileHash to client
      res.json({ success: true, intentId: intent.id });
    } catch (err: any) {
      if (objectKey) {
        try {
          await localStorageProvider.deleteFile(objectKey);
        } catch {}
      }

      if (err.message === 'DUPLICATE_PAYMENT_EVIDENCE') {
        return res.status(409).json({ error: 'DUPLICATE_PAYMENT_EVIDENCE' });
      }
      if (err.message === 'INVALID_MIME_TYPE' || err.message.startsWith('MIME_TYPE_MISMATCH') || err.message.startsWith('INVALID_FILE')) {
        return res.status(400).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Tenant: confirm upload and submit payment
  router.post('/slip/submit', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;
      if (!dormitoryId) return res.status(400).json({ error: 'Missing dormitoryId' });

      const tenant = await ensureTenant(req, res, dormitoryId);
      if (!tenant) return res.status(403).json({ error: 'Forbidden' });

      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
        paymentDate: z.string(),
        intentId: z.string()
      });
      const data = schema.parse(req.body);

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.submitSlip({
        dormitoryId,
        billId: data.billId,
        tenantId: tenant.id,
        amount: data.amount,
        paymentDate: new Date(data.paymentDate),
        intentId: data.intentId,
        idempotencyKey,
        actorUserId: auth.userId
      });

      res.json(payment);
    } catch (err: any) {
      if (err.message === 'IDEMPOTENCY_MISMATCH') {
        return res.status(422).json({ error: 'IDEMPOTENCY_MISMATCH' });
      }
      if (err.message === 'CONCURRENT_REQUEST_IN_PROGRESS') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST_IN_PROGRESS' });
      }
      if (err.message === 'DUPLICATE_PAYMENT_EVIDENCE') {
        return res.status(409).json({ error: err.message });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Record Cash
  router.post('/cash', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schema = z.object({
        billId: z.string(),
        amount: z.string()
      });
      const data = schema.parse(req.body);

      const bill = await prisma.bill.findUnique({ where: { id: data.billId } });
      if (!bill || bill.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.recordCash({
        dormitoryId,
        ...data,
        userId: auth.userId,
        idempotencyKey
      });

      res.json(payment);
    } catch (err: any) {
      if (err.message === 'IDEMPOTENCY_MISMATCH') {
        return res.status(422).json({ error: 'IDEMPOTENCY_MISMATCH' });
      }
      if (err.message === 'CONCURRENT_REQUEST_IN_PROGRESS') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST_IN_PROGRESS' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Approve
  router.post('/:paymentId/approve', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: 'Forbidden' });

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.approvePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        idempotencyKey
      });

      res.json(payment);
    } catch (err: any) {
      if (err.message === 'IDEMPOTENCY_MISMATCH') {
        return res.status(422).json({ error: 'IDEMPOTENCY_MISMATCH' });
      }
      if (err.message === 'CONCURRENT_REQUEST_IN_PROGRESS') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST_IN_PROGRESS' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reject
  router.post('/:paymentId/reject', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: 'Forbidden' });

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.rejectPayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey
      });

      res.json(payment);
    } catch (err: any) {
      if (err.message === 'IDEMPOTENCY_MISMATCH') {
        return res.status(422).json({ error: 'IDEMPOTENCY_MISMATCH' });
      }
      if (err.message === 'CONCURRENT_REQUEST_IN_PROGRESS') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST_IN_PROGRESS' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner: Reverse
  router.post('/:paymentId/reverse', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: 'Not found' });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: 'Forbidden' });

      const isOwner = auth?.memberships?.find((m: any) => {
        const code = (m.roleCode || m.role || m.roleId || '').toLowerCase();
        return m.dormitoryId === dormitoryId && code.includes('owner');
      });
      if (!isOwner) {
        return res.status(403).json({ error: 'Forbidden: Owner only' });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.reversePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey
      });

      res.json(payment);
    } catch (err: any) {
      if (err.message === 'IDEMPOTENCY_MISMATCH') {
        return res.status(422).json({ error: 'IDEMPOTENCY_MISMATCH' });
      }
      if (err.message === 'CONCURRENT_REQUEST_IN_PROGRESS') {
        return res.status(409).json({ error: 'CONCURRENT_REQUEST_IN_PROGRESS' });
      }
      res.status(400).json({ error: err.message });
    }
  });

  // Owner/Tenant: Get payment evidence (preview)
  router.get('/:paymentId/evidence', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;

      const payment = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      if (payment.dormitoryId !== dormitoryId) return res.status(403).json({ error: 'Forbidden' });

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
      const ext = payment.evidenceUrl.endsWith('.png')
        ? 'image/png'
        : payment.evidenceUrl.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';

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
      const context = resolveAuthoritativeDormitoryContext(req);
      const dormitoryId = context.dormitoryId;
      
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
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
