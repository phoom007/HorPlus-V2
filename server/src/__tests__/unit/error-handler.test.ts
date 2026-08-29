/**
 * @license Apache-2.0
 * Global Error Handler Safety & Domain Classification Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { globalErrorHandler } from '../../middleware/error-handler.js';
import { AppError } from '../../types/index.js';
import { Request, Response } from 'express';

function createMockReqRes() {
  const req = {
    id: 'req_test_123',
  } as Request;

  let statusCode = 200;
  let jsonBody: any = null;

  const res = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return res;
    }),
    json: vi.fn((body: any) => {
      jsonBody = body;
      return res;
    }),
    getStatusCode: () => statusCode,
    getJsonBody: () => jsonBody,
  } as unknown as Response & { getStatusCode: () => number; getJsonBody: () => any };

  const next = vi.fn();

  return { req, res, next };
}

describe('Global Error Handler Safety & Domain Classification Suite', () => {
  it('1. Plain domain Error with explicit status (409) preserves code, message, and HTTP status', () => {
    const { req, res, next } = createMockReqRes();

    const domainError = new Error('ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า');
    (domainError as any).statusCode = 409;
    (domainError as any).code = 'DEPOSIT_BILLING_CYCLE_NOT_FOUND';

    globalErrorHandler(domainError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    const body = (res as any).getJsonBody();
    expect(body.error.code).toBe('DEPOSIT_BILLING_CYCLE_NOT_FOUND');
    expect(body.error.message).toBe('ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า');
    expect(body.error.requestId).toBe('req_test_123');
  });

  it('2. Prisma / Internal constraint error (P2002) without statusCode is masked to safe generic 500 INTERNAL_ERROR', () => {
    const { req, res, next } = createMockReqRes();

    const prismaError = new Error('Unique constraint failed on the fields: (room_number, dormitory_id)');
    (prismaError as any).code = 'P2002'; // Prisma error code without HTTP status

    globalErrorHandler(prismaError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res as any).getJsonBody();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
    // Ensure raw internal schema details are strictly NOT leaked to response
    expect(body.error.message).not.toContain('Unique constraint');
    expect(body.error.message).not.toContain('room_number');
  });

  it('3. Arbitrary internal library error with code but no HTTP status returns safe generic 500', () => {
    const { req, res, next } = createMockReqRes();

    const libError = new Error('ECONNREFUSED 127.0.0.1:5432');
    (libError as any).code = 'SOME_INTERNAL_LIBRARY_CODE';

    globalErrorHandler(libError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = (res as any).getJsonBody();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง');
    expect(body.error.message).not.toContain('ECONNREFUSED');
  });

  it('4. AppError instance returns configured statusCode, errorCode, and message', () => {
    const { req, res, next } = createMockReqRes();

    const appError = new AppError('ไม่อนุญาตให้เข้าถึง', 403, 'FORBIDDEN');

    globalErrorHandler(appError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = (res as any).getJsonBody();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toBe('ไม่อนุญาตให้เข้าถึง');
  });

  it('5. Malformed UUID / P2023 error maps to 400 INVALID_ID_FORMAT', () => {
    const { req, res, next } = createMockReqRes();

    const uuidError = new Error('invalid input syntax for type uuid: "not-a-uuid"');

    globalErrorHandler(uuidError, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res as any).getJsonBody();
    expect(body.error.code).toBe('INVALID_ID_FORMAT');
    expect(body.error.message).toBe('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID');
  });
});
