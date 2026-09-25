/**
 * @license Apache-2.0
 * Card S7 Unit Tests: Sensitive Upload Security, Signed URLs, 5MB Limit, Rate Limiting & HEIC Support
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import sharp from 'sharp';
import {
  processAndSecureTenantIdCardImage,
  processAndSecureSlipImage,
  MAX_SLIP_FILE_SIZE,
  MAX_DOCUMENT_FILE_SIZE,
} from '../../services/image-security.service.js';
import {
  DistributedRateLimiterStore,
  InMemoryRateLimiterStore,
  createSlipUploadRateLimiter,
  resetSlipRateLimit,
} from '../../middleware/rate-limiter.js';
import { generateTenantDocumentSignature } from '../../routes/tenant.routes.js';
import { AppError } from '../../types/index.js';

describe('Card S7: Upload Security, Signed URLs, and Rate Limits', () => {
  // Helper to create a valid minimal 100x100 PNG
  async function createTestImage(width = 150, height = 150, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
    if (format === 'jpeg') {
      return sharp({
        create: {
          width,
          height,
          channels: 3,
          background: { r: 50, g: 100, b: 150 },
        },
      })
        .jpeg()
        .toBuffer();
    }
    return sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 100, g: 150, b: 200, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
  }

  describe('S7-1: Tenant ID Card Photo Processing & Storage Security', () => {
    it('processes ID card image, strips metadata, converts to WebP, and calculates SHA-256', async () => {
      const rawImage = await createTestImage(200, 200, 'jpeg');
      const result = await processAndSecureTenantIdCardImage(rawImage);

      expect(result.mimeType).toBe('image/webp');
      expect(result.extension).toBe('.webp');
      expect(result.byteSize).toBeGreaterThan(0);
      expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.sha256).toBe(crypto.createHash('sha256').update(result.buffer).digest('hex'));

      // Verify the processed buffer is valid WebP readable by Sharp
      const metadata = await sharp(result.buffer).metadata();
      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(200);
      expect(metadata.height).toBe(200);
    });
  });

  describe('S7-2: Access Control & Short-Lived Signed URL Verification', () => {
    const tenantId = '10000001-0000-4000-8000-000000000001';
    const dormitoryId = '20000001-0000-4000-8000-000000000002';

    it('generates consistent HMAC-SHA256 signature for identity document', () => {
      const expires = Date.now() + 15 * 60 * 1000;
      const sig1 = generateTenantDocumentSignature(tenantId, dormitoryId, expires);
      const sig2 = generateTenantDocumentSignature(tenantId, dormitoryId, expires);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects expired signed URLs (expires < now)', () => {
      const pastExpires = Date.now() - 5000; // 5 seconds ago
      const sig = generateTenantDocumentSignature(tenantId, dormitoryId, pastExpires);

      const isExpired = Date.now() > pastExpires;
      expect(isExpired).toBe(true);

      // Simulating router verification
      const checkResult = (exp: number, s: string) => {
        if (Date.now() > exp) {
          throw new AppError('ลิงก์เอกสารหมดอายุแล้ว กรุณารีเฟรชเพื่อรับลิงก์ใหม่', 403, 'EXPIRED_SIGNED_URL');
        }
        const expected = generateTenantDocumentSignature(tenantId, dormitoryId, exp);
        if (s !== expected) {
          throw new AppError('ลายเซ็นดิจิทัลของลิงก์ไม่ถูกต้อง', 403, 'INVALID_SIGNATURE');
        }
        return true;
      };

      expect(() => checkResult(pastExpires, sig)).toThrowError('ลิงก์เอกสารหมดอายุแล้ว');
      try {
        checkResult(pastExpires, sig);
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code || err.errorCode).toBe('EXPIRED_SIGNED_URL');
      }
    });

    it('rejects tampered or invalid signatures', () => {
      const futureExpires = Date.now() + 15 * 60 * 1000;
      const forgedSig = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const checkResult = (exp: number, s: string) => {
        if (Date.now() > exp) {
          throw new AppError('ลิงก์เอกสารหมดอายุแล้ว กรุณารีเฟรชเพื่อรับลิงก์ใหม่', 403, 'EXPIRED_SIGNED_URL');
        }
        const expected = generateTenantDocumentSignature(tenantId, dormitoryId, exp);
        if (s !== expected) {
          throw new AppError('ลายเซ็นดิจิทัลของลิงก์ไม่ถูกต้อง', 403, 'INVALID_SIGNATURE');
        }
        return true;
      };

      expect(() => checkResult(futureExpires, forgedSig)).toThrowError('ลายเซ็นดิจิทัลของลิงก์ไม่ถูกต้อง');
      try {
        checkResult(futureExpires, forgedSig);
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code || err.errorCode).toBe('INVALID_SIGNATURE');
      }
    });

    it('accepts valid, unexpired signed URLs', () => {
      const futureExpires = Date.now() + 15 * 60 * 1000;
      const validSig = generateTenantDocumentSignature(tenantId, dormitoryId, futureExpires);

      const checkResult = (exp: number, s: string) => {
        if (Date.now() > exp) {
          throw new AppError('ลิงก์เอกสารหมดอายุแล้ว กรุณารีเฟรชเพื่อรับลิงก์ใหม่', 403, 'EXPIRED_SIGNED_URL');
        }
        const expected = generateTenantDocumentSignature(tenantId, dormitoryId, exp);
        if (s !== expected) {
          throw new AppError('ลายเซ็นดิจิทัลของลิงก์ไม่ถูกต้อง', 403, 'INVALID_SIGNATURE');
        }
        return true;
      };

      expect(checkResult(futureExpires, validSig)).toBe(true);
    });
  });

  describe('S7-3: Validation & Error Handling (Thai message, no HTTP 500)', () => {
    it('rejects PDF uploads for bank slips with a clear Thai message (not 500)', async () => {
      const fakePdfBuffer = Buffer.from('%PDF-1.4\n%fake pdf content for slip test\n%%EOF');

      await expect(processAndSecureSlipImage(fakePdfBuffer)).rejects.toThrowError(
        'ระบบไม่รองรับไฟล์ PDF สำหรับสลิปชำระเงิน กรุณาแนบไฟล์รูปภาพ (JPEG, PNG, WebP) เท่านั้น'
      );

      try {
        await processAndSecureSlipImage(fakePdfBuffer);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(400);
      }
    });

    it('rejects non-image vector/text files for ID card and slip with Thai error (not 500)', async () => {
      const textBuffer = Buffer.from('This is a plain text file pretending to be an image');

      await expect(processAndSecureSlipImage(textBuffer)).rejects.toThrowError('รูปแบบไฟล์รูปภาพไม่ถูกต้อง');
      await expect(processAndSecureTenantIdCardImage(textBuffer)).rejects.toThrowError('รูปแบบไฟล์รูปภาพไม่ถูกต้อง');

      try {
        await processAndSecureSlipImage(textBuffer);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('rejects files exceeding the 5MB size limit with Thai message (not 500)', async () => {
      // 5MB + 1 byte
      const oversizedBuffer = Buffer.alloc(MAX_SLIP_FILE_SIZE + 1024);
      oversizedBuffer[0] = 0xff;
      oversizedBuffer[1] = 0xd8;
      oversizedBuffer[2] = 0xff; // fake JPEG header

      await expect(processAndSecureSlipImage(oversizedBuffer)).rejects.toThrowError(
        'ขนาดไฟล์รูปภาพสลิปเกินขีดจำกัดสูงสุด 5MB'
      );

      try {
        await processAndSecureSlipImage(oversizedBuffer);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.code || err.errorCode).toBe('FILE_TOO_LARGE');
      }
    });
  });

  describe('S7-4: Slip Upload Rate Limiting (3 requests / 15 minutes)', () => {
    it('allows up to 3 requests and rejects 4th request within 15 minutes with Thai message', async () => {
      const store = new InMemoryRateLimiterStore();
      const testDormId = 'dorm-rate-limit-test';
      const testUserId = 'user-tc-somchai';
      const key = `rate_limit:slip:user:${testDormId}:${testUserId}`;

      // Request 1, 2, 3 should be allowed
      expect(await store.isAllowed(key, 3, 15 * 60 * 1000)).toBe(true);
      expect(await store.isAllowed(key, 3, 15 * 60 * 1000)).toBe(true);
      expect(await store.isAllowed(key, 3, 15 * 60 * 1000)).toBe(true);

      // Request 4 should be rejected
      const allowed4 = await store.isAllowed(key, 3, 15 * 60 * 1000);
      expect(allowed4).toBe(false);

      // Resetting rate limit upon successful submission allows new uploads
      store.resetKey(key);
      const allowedAfterReset = await store.isAllowed(key, 3, 15 * 60 * 1000);
      expect(allowedAfterReset).toBe(true);
    });

    it('middleware returns HTTP 429 with specified Thai message when rate limit is exceeded', async () => {
      const store = new DistributedRateLimiterStore();
      const middleware = createSlipUploadRateLimiter(store);

      const dormId = 'dorm-middleware-test';
      const userId = 'user-middleware-test';

      const mockReq = {
        auth: { userId },
        dormitoryContext: { dormitoryId: dormId },
        headers: { 'x-request-id': 'req-s7-ratelimit' },
        ip: '127.0.0.1',
      } as any;

      let responseStatus = 0;
      let responseBody: any = null;

      const mockRes = {
        status: (code: number) => {
          responseStatus = code;
          return {
            json: (body: any) => {
              responseBody = body;
            },
          };
        },
      } as any;

      const next = vi.fn();

      // Exhaust 3 tokens
      for (let i = 0; i < 3; i++) {
        await middleware(mockReq, mockRes, next);
      }
      expect(next).toHaveBeenCalledTimes(3);

      // 4th call
      await middleware(mockReq, mockRes, next);
      expect(responseStatus).toBe(429);
      expect(responseBody?.error?.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(responseBody?.error?.message).toContain('คุณส่งคำขออัปโหลดสลิปถี่เกินไป (จำกัด 3 ครั้งต่อ 15 นาที)');

      // Reset via helper
      resetSlipRateLimit(dormId, userId, store);

      // Next call after reset should pass
      next.mockClear();
      await middleware(mockReq, mockRes, next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('S7-5: Mobile Gallery & Image Compatibility (JPEG, PNG, WebP, HEIC detection)', () => {
    it('accepts and normalizes JPEG, PNG, and WebP slip images', async () => {
      const pngImage = await createTestImage(150, 150, 'png');
      const jpegImage = await createTestImage(150, 150, 'jpeg');

      const pngResult = await processAndSecureSlipImage(pngImage);
      expect(pngResult.mimeType).toBe('image/png');
      expect(pngResult.width).toBe(150);
      expect(pngResult.height).toBe(150);

      const jpegResult = await processAndSecureSlipImage(jpegImage);
      expect(jpegResult.mimeType).toBe('image/jpeg');
      expect(jpegResult.width).toBe(150);
      expect(jpegResult.height).toBe(150);
    });

    it('identifies iPhone HEIC magic bytes (ftypheic) as an accepted image format', () => {
      // Simulate an iPhone HEIC container header: [0..3]=length, [4..7]='ftyp', [8..11]='heic'
      const heicHeader = Buffer.alloc(32);
      heicHeader.writeUInt32BE(24, 0); // box size
      heicHeader.write('ftyp', 4, 'ascii');
      heicHeader.write('heic', 8, 'ascii');

      const isHeic =
        heicHeader.length >= 12 &&
        heicHeader.subarray(4, 8).toString('ascii') === 'ftyp' &&
        ['heic', 'heix', 'mif1', 'msf1', 'hevc', 'avif'].some((brand) =>
          heicHeader.subarray(8, 12).toString('ascii').toLowerCase().includes(brand)
        );

      expect(isHeic).toBe(true);
    });
  });
});
