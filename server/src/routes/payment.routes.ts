import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { paymentService } from '../services/payment.service.js';
import { localStorageProvider } from '../services/local-storage.service.js';
import { AuthenticationService } from '../services/auth.service.js';
import { createCsrfMiddleware } from '../middleware/csrf.js';
import { requireDormitoryPermission } from '../middleware/permission.js';
import { requireDormitoryWriteEntitlement } from '../middleware/entitlement.js';
import { resolveAuthoritativeDormitoryContext } from '../middleware/dormitory-context.js';
import { logger } from '../config/logger.js';
import { AppError } from '../types/index.js';
import { getPrismaClient } from '../db/prisma.js';
import multer from 'multer';

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

const prisma = getPrismaClient();

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
    const iendIndex = buffer.indexOf(Buffer.from([0x49, 0x45, 0x4E, 0x44]));
    if (iendIndex === -1) {
      throw new Error('INVALID_FILE_STRUCTURE: Corrupt PNG image missing IEND chunk');
    }
    detectedMime = 'image/png';
    extension = '.png';
  }
  // Check JPEG: FF D8 FF
  else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    const eoiIndex = buffer.lastIndexOf(Buffer.from([0xFF, 0xD9]));
    if (eoiIndex === -1 || eoiIndex < 3) {
      throw new Error('INVALID_FILE_STRUCTURE: Corrupt JPEG image missing EOI marker');
    }
    detectedMime = 'image/jpeg';
    extension = '.jpg';
  }
  // Check WebP: RIFF at 0..3 and WEBP at 8..11
  else if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
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
      const code = (m.roleCode || m.role?.code || m.role || m.roleId || '').toLowerCase();
      return m.dormitoryId === dormitoryId && code.includes('tenant');
    });
    if (!membership) return null;
    const tenant = await prisma.tenant.findFirst({ where: { linkedUserId: auth.userId, dormitoryId } });
    return tenant;
  };

  const ensureOwnerOrManager = (req: Request, res: Response, dormitoryId: string) => {
    const auth = (req as any).auth;
    const isOk = auth?.memberships?.find((m: any) => {
      const code = (m.roleCode || m.role?.code || m.role || m.roleId || '').toLowerCase();
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

  const handlePaymentError = (res: Response, req: Request, err: any) => {
    const requestId = (req.headers['x-request-id'] as string) || (req as any).id || (req as any).requestId || 'req-unknown';
    const timestamp = new Date().toISOString();

    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ข้อมูลการทำรายการไม่ถูกต้อง',
          fieldErrors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
          requestId,
          timestamp,
        },
      });
    }

    if (err?.code === 'P2002') {
      const targetStr = JSON.stringify(err.meta?.target || '') + (err.message || '');
      if (
        targetStr.includes('payload_hash') ||
        targetStr.includes('payloadHash') ||
        targetStr.includes('file_hash') ||
        targetStr.includes('fileHash') ||
        targetStr.includes('idx_verification_payload_hash_unique')
      ) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_PAYMENT_EVIDENCE',
            message: 'มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      }
    }

    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        error: {
          code: err.code || err.errorCode || 'PAYMENT_ERROR',
          message: err.message,
          fieldErrors: err.fieldErrors || null,
          requestId,
          timestamp,
        },
      });
    }

    const rawCode = err.code || (typeof err.message === 'string' ? err.message : '');

    switch (rawCode) {
      case 'GROUP_REVERSAL_REQUIRED':
        return res.status(400).json({
          error: {
            code: 'GROUP_REVERSAL_REQUIRED',
            message: 'ไม่อนุญาตให้ยกเลิกรายการย่อยของการรวมจ่าย กรุณายกเลิกทั้งกลุ่มรายการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'GROUP_APPROVAL_REQUIRED':
        return res.status(400).json({
          error: {
            code: 'GROUP_APPROVAL_REQUIRED',
            message: 'รายการนี้เป็นส่วนหนึ่งของการรวมจ่าย กรุณาอนุมัติทั้งกลุ่มรายการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'GROUP_REJECTION_REQUIRED':
        return res.status(400).json({
          error: {
            code: 'GROUP_REJECTION_REQUIRED',
            message: 'รายการนี้เป็นส่วนหนึ่งของการรวมจ่าย กรุณาปฏิเสธทั้งกลุ่มรายการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'GROUP_ALLOCATION_RECONCILIATION_FAILED':
        return res.status(400).json({
          error: {
            code: 'GROUP_ALLOCATION_RECONCILIATION_FAILED',
            message: 'การจัดสรรยอดเงินไม่ตรงกับยอดรวมของกลุ่มรายการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'COMBINED_GROUP_NOT_FOUND':
        return res.status(404).json({
          error: {
            code: 'COMBINED_GROUP_NOT_FOUND',
            message: 'ไม่พบกลุ่มรายการชำระเงิน',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'INVALID_GROUP_STATE':
        return res.status(400).json({
          error: {
            code: 'INVALID_GROUP_STATE',
            message: 'สถานะกลุ่มรายการไม่ถูกต้องสำหรับการดำเนินการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'INVALID_STATE':
        return res.status(400).json({
          error: {
            code: 'INVALID_STATE',
            message: 'สถานะรายการไม่ถูกต้องสำหรับการดำเนินการ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'UNSUPPORTED_AMOUNT':
        return res.status(400).json({
          error: {
            code: 'UNSUPPORTED_AMOUNT',
            message: 'ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING':
        return res.status(400).json({
          error: {
            code: 'PAYMENT_EXCEEDS_ELIGIBLE_OUTSTANDING',
            message: 'ยอดในสลิปเกินกว่ายอดที่ต้องชำระจริง กรุณาติดต่อเจ้าของหอพัก',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'FORBIDDEN_CROSS_ROOM':
        return res.status(400).json({
          error: {
            code: 'FORBIDDEN_CROSS_ROOM',
            message: 'ไม่อนุญาตให้จัดสรรการชำระเงินข้ามห้องพัก',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'NO_ELIGIBLE_BILLS':
        return res.status(400).json({
          error: {
            code: 'NO_ELIGIBLE_BILLS',
            message: 'ไม่พบบิลที่มียอดค้างชำระสำหรับห้องนี้',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'FINANCIAL_STATE_INCONSISTENT':
        return res.status(400).json({
          error: {
            code: 'FINANCIAL_STATE_INCONSISTENT',
            message: 'ข้อมูลทางการเงินไม่สอดคล้องกับระบบ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'ALREADY_PAID':
        return res.status(400).json({
          error: {
            code: 'ALREADY_PAID',
            message: 'บิลนี้ได้รับการชำระเงินแล้ว',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'BILL_NOT_FOUND':
      case 'NOT_FOUND':
        return res.status(404).json({
          error: {
            code: 'BILL_NOT_FOUND',
            message: 'ไม่พบข้อมูลบิลที่ระบุ',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'FORBIDDEN':
      case 'FORBIDDEN_BILL_OWNERSHIP':
      case 'FORBIDDEN_INTENT_MISMATCH':
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'ไม่มีสิทธิ์ดำเนินการกับบิลนี้',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'PAYMENT_IN_PROGRESS':
        return res.status(409).json({
          error: {
            code: 'PAYMENT_IN_PROGRESS',
            message: 'มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลนี้แล้ว',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'ACTIVE_REVIEW_EXISTS':
        return res.status(409).json({
          error: {
            code: 'ACTIVE_REVIEW_EXISTS',
            message: 'มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'IDEMPOTENCY_MISMATCH':
        return res.status(422).json({
          error: {
            code: 'IDEMPOTENCY_MISMATCH',
            message: 'ข้อมูลการทำรายการไม่ตรงกับ Idempotency Key เดิม',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'CONCURRENT_REQUEST_IN_PROGRESS':
        return res.status(409).json({
          error: {
            code: 'CONCURRENT_REQUEST_IN_PROGRESS',
            message: 'มีคำขอกำลังประมวลผลอยู่ กรุณารอสักครู่',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      case 'DUPLICATE_PAYMENT_EVIDENCE':
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_PAYMENT_EVIDENCE',
            message: 'มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
      default:
        logger.error({ err, requestId }, 'Unhandled payment error caught in payment error boundary');
        return res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง',
            fieldErrors: null,
            requestId,
            timestamp,
          },
        });
    }
  };

  // Tenant: create upload intent
  router.post('/slip/intent', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
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

      const bill = await prisma.bill.findUnique({ where: { id: data.billId } });
      if (!bill || bill.tenantId !== tenant.id || bill.dormitoryId !== dormitoryId) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      if (bill.status === 'PAID') {
        return res.status(400).json({ error: 'ALREADY_PAID' });
      }

      const activePayment = await prisma.payment.findFirst({
        where: { billId: bill.id, status: { in: ['PENDING', 'UNDER_REVIEW'] } }
      });
      if (activePayment) {
        return res.status(400).json({ error: 'ACTIVE_REVIEW_EXISTS' });
      }

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
      handlePaymentError(res, req, err);
    }
  });

  // Secure multipart upload
  router.post('/slip/upload/:intentId', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, upload.single('file'), async (req, res) => {
    let objectKey: string | null = null;
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const auth = (req as any).auth;
      const intent = await prisma.paymentUploadIntent.findUnique({ where: { id: req.params.intentId } });
      if (!intent) return res.status(404).json({ error: 'Upload intent not found' });
      if (intent.authenticatedUserId !== auth.userId) return res.status(403).json({ error: 'Forbidden' });
      if (intent.status !== 'CREATED') return res.status(400).json({ error: 'Intent already used or invalid' });
      if (intent.expiresAt < new Date()) return res.status(400).json({ error: 'Intent expired' });

      const validation = detectAndValidateImage(req.file.buffer, intent.expectedMimeType);
      const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      const existingVerification = await prisma.paymentEvidenceVerification.findFirst({
        where: { payloadHash: hash }
      });
      const existingDuplicate = await prisma.payment.findFirst({
        where: {
          fileHash: hash,
          status: { in: ['PENDING', 'UNDER_REVIEW', 'APPROVED'] }
        }
      });
      if (existingVerification || existingDuplicate) {
        const reqId = (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown';
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_PAYMENT_EVIDENCE',
            message: 'มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว',
            fieldErrors: null,
            requestId: reqId,
            timestamp: new Date().toISOString(),
          },
        });
      }

      const ext = validation.extension;
      objectKey = `slips/${intent.dormitoryId}/${intent.id}${ext}`;
      await localStorageProvider.saveFile(objectKey, req.file.buffer);

      await prisma.paymentUploadIntent.update({
        where: { id: intent.id },
        data: {
          status: 'UPLOADED',
          objectKey,
          sha256: hash,
          verifiedMimeType: validation.mimeType,
          verifiedSize: validation.size,
          uploadedAt: new Date()
        }
      });

      res.json({ success: true, objectKey, sha256: hash });
    } catch (err: any) {
      if (objectKey) {
        try { await localStorageProvider.deleteFile(objectKey); } catch (e) {}
      }
      handlePaymentError(res, req, err);
    }
  });

  // Tenant: Submit slip referencing intent
  router.post('/slip/submit', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;

      const tenant = await ensureTenant(req, res, dormitoryId);
      if (!tenant) return res.status(403).json({ error: 'Forbidden' });

      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
        intentId: z.string(),
        paymentDate: z.string().transform((val) => new Date(val))
      });
      const data = schema.parse(req.body);
      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.submitSlip({
        dormitoryId,
        tenantId: tenant.id,
        amount: data.amount,
        paymentDate: data.paymentDate,
        intentId: data.intentId,
        idempotencyKey,
        actorUserId: auth.userId
      });

      res.json(payment);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Owner: Record Cash (Strictly Single-Bill)
  router.post('/cash', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'ไม่มีสิทธิ์บันทึกการรับเงินสด',
            requestId: (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const schema = z.object({
        billId: z.string(),
        amount: z.string(),
      });
      const data = schema.parse(req.body);

      const bill = await prisma.bill.findUnique({ where: { id: data.billId } });
      if (!bill || bill.dormitoryId !== dormitoryId) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'ไม่มีสิทธิ์ดำเนินการกับบิลนี้',
            requestId: (req.headers['x-request-id'] as string) || (req as any).id || 'req-unknown',
            timestamp: new Date().toISOString(),
          },
        });
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.recordCash({
        dormitoryId,
        ...data,
        userId: auth.userId,
        idempotencyKey,
      });

      res.json(payment);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Owner: Approve
  router.post('/:paymentId/approve', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบรายการชำระเงิน' } });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });
      }

      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.approvePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        idempotencyKey,
      });

      res.json(payment);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Owner: Reject
  router.post('/:paymentId/reject', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบรายการชำระเงิน' } });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });

      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.rejectPayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey,
      });

      res.json(payment);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Owner: Reverse
  router.post('/:paymentId/reverse', requireAuth, requireDormitoryPermission('payment:write'), requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;

      const paymentRecord = await prisma.payment.findUnique({ where: { id: req.params.paymentId } });
      if (!paymentRecord) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'ไม่พบรายการชำระเงิน' } });
      if (paymentRecord.dormitoryId !== dormitoryId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์' } });

      const isOwner = auth?.memberships?.find((m: any) => {
        const code = (m.roleCode || m.role || m.roleId || '').toLowerCase();
        return m.dormitoryId === dormitoryId && code.includes('owner');
      });
      if (!isOwner) {
        return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Forbidden: Owner only' } });
      }

      const schema = z.object({ reason: z.string().min(1) });
      const data = schema.parse(req.body);
      const idempotencyKey = (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined;

      const payment = await paymentService.reversePayment({
        dormitoryId,
        paymentId: req.params.paymentId,
        userId: auth.userId,
        reason: data.reason,
        idempotencyKey,
      });

      res.json(payment);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Owner/Tenant: Get payment evidence (preview)
  router.get('/:paymentId/evidence', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
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
      handlePaymentError(res, req, err);
    }
  });

  // Owner: List payments
  router.get('/', requireAuth, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;
      
      if (!ensureOwnerOrManager(req, res, dormitoryId)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const payments = await prisma.payment.findMany({
        where: { dormitoryId },
        include: {
          bill: {
            include: {
              tenant: true,
              room: true,
              items: true,
              allocations: true,
            },
          },
          receipt: true,
          allocations: true,
          paymentGroup: {
            include: {
              allocations: true,
              receipts: true,
              billTargets: {
                include: {
                  bill: {
                    include: {
                      billingCycle: true,
                      room: true,
                      tenant: true,
                    },
                  },
                },
              },
              verification: true,
            },
          },
          verification: true,
          statusHistories: { orderBy: { effectiveAt: 'desc' } }
        },
        orderBy: { createdAt: 'desc' }
      });
      res.json(payments);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Tenant: Create upload intent for multiple bills combined with 1 slip
  router.post('/combined-slip-intent', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;
      const { billIds, mimeType, fileSize } = req.body;

      if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
        return res.status(400).json({ error: 'billIds array is required' });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { dormitoryId, linkedUserId: auth.userId, status: 'active' }
      });
      if (!tenant) return res.status(403).json({ error: 'Tenant profile not found' });

      const result = await paymentService.createCombinedUploadIntent({
        dormitoryId,
        tenantId: tenant.id,
        actorUserId: auth.userId,
        billIds,
        mimeType: mimeType || 'image/jpeg',
        fileSize: Number(fileSize) || 0,
      });

      res.json(result);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

  // Tenant: Submit combined slip payment referencing intent
  router.post('/submit-combined-slip', requireAuth, requireDormitoryWriteEntitlement, requireCsrf, async (req, res) => {
    try {
      const auth = (req as any).auth;
      const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
      const dormitoryId = context.dormitoryId;
      const { intentId, amount, paymentDate } = req.body;

      if (!intentId || !amount) {
        return res.status(400).json({ error: 'intentId and amount are required' });
      }

      const tenant = await prisma.tenant.findFirst({
        where: { dormitoryId, linkedUserId: auth.userId, status: 'active' }
      });
      if (!tenant) return res.status(403).json({ error: 'Tenant profile not found' });

      const result = await paymentService.submitCombinedSlipPayment({
        dormitoryId,
        tenantId: tenant.id,
        intentId,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        amount,
        actorUserId: auth.userId,
        idempotencyKey: (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined,
      });

      res.json(result);
    } catch (err: any) {
      handlePaymentError(res, req, err);
    }
  });

    // Owner: Approve combined payment group atomically
  router.post(
    '/combined-groups/:id/approve',
    requireAuth,
    requireCsrf,
    requireDormitoryPermission('payment:write'),
    requireDormitoryWriteEntitlement,
    async (req, res) => {
      try {
        const auth = (req as any).auth;
        const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
        const dormitoryId = context.dormitoryId;

        if (!ensureOwnerOrManager(req, res, dormitoryId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const result = await paymentService.approvePaymentGroup({
          dormitoryId,
          groupId: req.params.id,
          userId: auth.userId,
          notes: req.body?.notes,
          idempotencyKey: (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined,
        });

        res.json(result);
      } catch (err: any) {
        handlePaymentError(res, req, err);
      }
    }
  );

  // Owner: Reject combined payment group atomically
  router.post(
    '/combined-groups/:id/reject',
    requireAuth,
    requireCsrf,
    requireDormitoryPermission('payment:write'),
    requireDormitoryWriteEntitlement,
    async (req, res) => {
      try {
        const auth = (req as any).auth;
        const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
        const dormitoryId = context.dormitoryId;

        if (!ensureOwnerOrManager(req, res, dormitoryId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const reason = req.body?.reason;
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
          return res.status(400).json({ error: 'เหตุผลในการปฏิเสธมีความจำเป็น' });
        }

        const result = await paymentService.rejectPaymentGroup({
          dormitoryId,
          groupId: req.params.id,
          userId: auth.userId,
          reason: reason.trim(),
          notes: req.body?.notes,
          idempotencyKey: (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined,
        });

        res.json(result);
      } catch (err: any) {
        handlePaymentError(res, req, err);
      }
    }
  );

  // Owner: Reverse combined payment group atomically
  router.post(
    '/combined-groups/:id/reverse',
    requireAuth,
    requireCsrf,
    requireDormitoryPermission('payment:write'),
    requireDormitoryWriteEntitlement,
    async (req, res) => {
      try {
        const auth = (req as any).auth;
        const context = (req as any).dormitoryContext || (await resolveAuthoritativeDormitoryContext(req));
        const dormitoryId = context.dormitoryId;

        if (!ensureOwnerOrManager(req, res, dormitoryId)) {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const reason = req.body?.reason;
        if (!reason || typeof reason !== 'string' || !reason.trim()) {
          return res.status(400).json({ error: 'เหตุผลในการยกเลิกมีความจำเป็น' });
        }

        const result = await paymentService.reversePaymentGroup({
          dormitoryId,
          groupId: req.params.id,
          userId: auth.userId,
          reason: reason.trim(),
          idempotencyKey: (req.headers['x-idempotency-key'] || req.headers['idempotency-key']) as string | undefined,
        });

        res.json(result);
      } catch (err: any) {
        handlePaymentError(res, req, err);
      }
    }
  );

  return router;
}
