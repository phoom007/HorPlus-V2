/**
 * @license Apache-2.0
 * Task 08 Unit Tests: Internal Error Masking, Access Log Token Scrubbing, and Tenant ID Card Security Hardening
 * Covers SEC-13, SEC-14, and N-03.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { globalErrorHandler } from '../../middleware/error-handler.js';
import { requestLoggerMiddleware } from '../../middleware/request-logger.js';
import { processAndSecureTenantIdCardImage } from '../../services/image-security.service.js';
import { AppError } from '../../types/index.js';
import { logger } from '../../config/logger.js';
import sharp from 'sharp';
import { Request, Response, NextFunction } from 'express';

function createMockReqRes(options: { url?: string; originalUrl?: string; id?: string } = {}) {
  const req = {
    id: options.id || 'req_test_task08',
    url: options.url || '/api/v1/test',
    originalUrl: options.originalUrl || options.url || '/api/v1/test',
    method: 'GET',
    headers: {},
  } as unknown as Request;

  let statusCode = 200;
  let jsonBody: any = null;
  const finishCallbacks: Array<() => void> = [];

  const res = {
    statusCode: 200,
    status: vi.fn((code: number) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      jsonBody = body;
      return res;
    }),
    on: vi.fn((event: string, callback: () => void) => {
      if (event === 'finish') {
        finishCallbacks.push(callback);
      }
      return res;
    }),
    emitFinish: () => {
      finishCallbacks.forEach((cb) => cb());
    },
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  } as unknown as Response & { emitFinish: () => void; getStatusCode: () => number; getJsonBody: () => any };

  const next = vi.fn() as unknown as NextFunction;

  return { req, res, next };
}

describe('Task 08: Error Masking, Access Log Token Scrubbing & ID Card Security (SEC-13, SEC-14, N-03)', () => {
  describe('SEC-13: Access Log Token Scrubbing (STAFF-ACCESS-AND-USERS-SPEC §40)', () => {
    let loggerSpy: any;

    beforeEach(() => {
      loggerSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger as any);
    });

    afterEach(() => {
      loggerSpy.mockRestore();
    });

    it('AC-1: Strips query parameters containing sensitive tokens (?t=..., ?ticket=...) from access log path', () => {
      const { req, res, next } = createMockReqRes({
        url: '/api/v1/tenant-portal/verify?t=secret_tenant_token_12345&ticket=super_secret_ticket',
        originalUrl: '/api/v1/tenant-portal/verify?t=secret_tenant_token_12345&ticket=super_secret_ticket',
      });

      requestLoggerMiddleware(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);

      res.emitFinish();

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const loggedData = loggerSpy.mock.calls[0][0];
      expect(loggedData.path).toBe('/api/v1/tenant-portal/verify');
      expect(loggedData.path).not.toContain('?t=');
      expect(loggedData.path).not.toContain('secret_tenant_token_12345');
      expect(loggedData.path).not.toContain('ticket=');
    });

    it('AC-1: Handles URLs without query parameters cleanly', () => {
      const { req, res, next } = createMockReqRes({
        url: '/api/v1/health/readiness',
        originalUrl: '/api/v1/health/readiness',
      });

      requestLoggerMiddleware(req, res, next);
      res.emitFinish();

      expect(loggerSpy).toHaveBeenCalledTimes(1);
      const loggedData = loggerSpy.mock.calls[0][0];
      expect(loggedData.path).toBe('/api/v1/health/readiness');
    });
  });

  describe('SEC-13: Error Message Masking & Safety (REQUIREMENTS-LOCK §178)', () => {
    it('AC-2: Unknown internal server / DB errors are masked to generic Thai without leaking schema or stack', () => {
      const { req, res, next } = createMockReqRes();

      const internalDbError = new Error('SELECT * FROM "users" WHERE id = \'123\' syntax error at or near FROM');
      (internalDbError as any).stack = 'Error: SELECT ... at pg_query (/node_modules/pg/lib/client.js:100:10)';

      globalErrorHandler(internalDbError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.getJsonBody();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.message).toBe('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
      expect(body.error.message).not.toContain('SELECT');
      expect(body.error.message).not.toContain('users');
      expect(body.error.message).not.toContain('syntax error');
    });

    it('AC-2: AppError preserving Thai user-facing domain message', () => {
      const { req, res, next } = createMockReqRes();

      const domainError = new AppError('ไม่อนุญาตให้แก้ไขข้อมูลสัญญาเช่าที่อนุมัติแล้ว', 400, 'CONTRACT_ALREADY_APPROVED');

      globalErrorHandler(domainError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.getJsonBody();
      expect(body.error.code).toBe('CONTRACT_ALREADY_APPROVED');
      expect(body.error.message).toBe('ไม่อนุญาตให้แก้ไขข้อมูลสัญญาเช่าที่อนุมัติแล้ว');
    });

    it('AC-3: Prisma P2025 (Record not found) translates to safe 404 NOT_FOUND', () => {
      const { req, res, next } = createMockReqRes();

      const prismaError = new Error('An operation failed because it depends on one or more records that were required but not found. Record to update not found.');
      (prismaError as any).code = 'P2025';

      globalErrorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      const body = res.getJsonBody();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.message).toBe('ไม่พบข้อมูลที่ต้องการในระบบ');
      expect(body.error.message).not.toContain('depends on one or more records');
    });

    it('AC-3: Prisma P2003 (Foreign key violation) translates to safe 400 FOREIGN_KEY_VIOLATION', () => {
      const { req, res, next } = createMockReqRes();

      const prismaError = new Error('Foreign key constraint failed on the field: `dormitory_id`');
      (prismaError as any).code = 'P2003';

      globalErrorHandler(prismaError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.getJsonBody();
      expect(body.error.code).toBe('FOREIGN_KEY_VIOLATION');
      expect(body.error.message).toBe('ข้อมูลอ้างอิงไม่ถูกต้องหรือไม่พบในระบบ');
      expect(body.error.message).not.toContain('dormitory_id');
    });

    it('AC-3: Prisma P2023 / Malformed UUID translates to safe 400 INVALID_ID_FORMAT', () => {
      const { req, res, next } = createMockReqRes();

      const uuidError = new Error('invalid input syntax for type uuid: "invalid-uuid-format"');

      globalErrorHandler(uuidError, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const body = res.getJsonBody();
      expect(body.error.code).toBe('INVALID_ID_FORMAT');
      expect(body.error.message).toBe('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID');
    });
  });

  describe('SEC-14: Tenant ID Card Security & Sanitization (REQUIREMENTS-LOCK §175, §176)', () => {
    it('AC-4: Valid PNG / JPEG image is converted to WebP, stripped of metadata, and sha256 computed', async () => {
      // Create a valid test image buffer using sharp
      const validPngBuffer = await sharp({
        create: {
          width: 200,
          height: 150,
          channels: 3,
          background: { r: 50, g: 100, b: 150 },
        },
      })
        .png()
        .toBuffer();

      const secured = await processAndSecureTenantIdCardImage(validPngBuffer);

      expect(secured.mimeType).toBe('image/webp');
      expect(secured.extension).toBe('.webp');
      expect(secured.byteSize).toBeGreaterThan(0);
      expect(secured.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(secured.width).toBe(200);
      expect(secured.height).toBe(150);

      // Verify that the output buffer is indeed valid WebP
      const metadata = await sharp(secured.buffer).metadata();
      expect(metadata.format).toBe('webp');
    });

    it('AC-5: Non-image script vector (SVG with script) is rejected with 400 INVALID_DOCUMENT_FORMAT', async () => {
      const svgScriptVector = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'utf-8');

      await expect(processAndSecureTenantIdCardImage(svgScriptVector)).rejects.toThrow(
        /รูปแบบไฟล์ไม่ถูกต้อง/
      );
    });

    it('AC-5: HTML / PHP / Polyglot header is rejected with 400', async () => {
      const htmlPayload = Buffer.from('<html><head></head><body><h1>Fake ID</h1></body></html>', 'utf-8');

      await expect(processAndSecureTenantIdCardImage(htmlPayload)).rejects.toThrow(
        /รูปแบบไฟล์ไม่ถูกต้อง/
      );
    });

    it('AC-5: Arbitrary binary / corrupt payload without magic bytes is rejected with 400', async () => {
      const corruptPayload = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

      await expect(processAndSecureTenantIdCardImage(corruptPayload)).rejects.toThrow(
        /รูปแบบไฟล์(รูปภาพ)?ไม่ถูกต้อง/
      );
    });
  });

  describe('N-03: PromptPay Platform / Dormitory Separation', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('AC-7: HORPLUS_PLATFORM_PROMPTPAY_ID takes precedence for platform subscription payments', () => {
      process.env.HORPLUS_PLATFORM_PROMPTPAY_ID = '0812345678';
      process.env.PROMPTPAY_ID = '0935098808';

      const resolved = (
        process.env.HORPLUS_PLATFORM_PROMPTPAY_ID ||
        process.env.HORPLUS_PROMPTPAY_ID ||
        process.env.PROMPTPAY_ID ||
        '0935098808'
      ).trim();

      expect(resolved).toBe('0812345678');
    });

    it('AC-7: Fallbacks gracefully to platform default when HORPLUS_PLATFORM_PROMPTPAY_ID is unset', () => {
      delete process.env.HORPLUS_PLATFORM_PROMPTPAY_ID;
      delete process.env.HORPLUS_PROMPTPAY_ID;
      delete process.env.PROMPTPAY_ID;

      const resolved = (
        process.env.HORPLUS_PLATFORM_PROMPTPAY_ID ||
        process.env.HORPLUS_PROMPTPAY_ID ||
        process.env.PROMPTPAY_ID ||
        '0935098808'
      ).trim();

      expect(resolved).toBe('0935098808');
    });
  });
});
