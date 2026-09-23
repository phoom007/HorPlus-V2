import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import { cookieParserMiddleware } from '../../middleware/cookie-parser.middleware.js';
import request from 'supertest';
import { getEnv } from '../../config/env.js';

const { mockPrisma } = vi.hoisted(() => {
  const client: any = {
    room: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    tenant: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    contract: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    provisionalRentalTerm: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    tenantEmergencyContact: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    tenantCoOccupant: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    tenantVehicle: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  client.$transaction = vi.fn().mockImplementation(async (callback: any) => {
    return callback(client);
  });
  return { mockPrisma: client };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../services/signature-storage.service.js', () => ({
  SignatureStorageService: class {
    saveTenantSignature = vi.fn().mockResolvedValue({
      objectKey: 'sig-mock',
      sha256: 'sha-mock',
      mimeType: 'image/png',
      byteSize: 512,
    });
  },
}));

import {
  TenantRegistrationService,
  generateClaimVerificationToken,
  verifyClaimVerificationToken,
} from '../../services/tenant-registration.service.js';
import { createTenantRegistrationRouter } from '../../routes/tenant-registration.routes.js';
import { SessionTokenService } from '../../services/session-token.service.js';
import { AppError } from '../../types/index.js';

describe('Task 02: Tenant Claim Verification Hardening (SEC-01)', () => {
  const dummyDormId = '11111111-1111-4111-8111-111111111111';
  const dummyRoomId = '22222222-2222-4222-8222-222222222222';
  const dummyTenantId = '33333333-3333-4333-8333-333333333333';

  describe('1. Signed Claim Verification Token (AC-2)', () => {
    it('generates a valid signed claimVerificationToken and verifies it successfully', () => {
      const token = generateClaimVerificationToken({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        tenantId: dummyTenantId,
      });

      expect(typeof token).toBe('string');
      expect(token).toContain('.');

      const payload = verifyClaimVerificationToken(token);
      expect(payload.dormitoryId).toBe(dummyDormId);
      expect(payload.roomId).toBe(dummyRoomId);
      expect(payload.tenantId).toBe(dummyTenantId);
      expect(payload.exp).toBeGreaterThan(Date.now());
    });

    it('rejects missing or empty token with CLAIM_VERIFICATION_REQUIRED', () => {
      expect(() => verifyClaimVerificationToken('')).toThrowError(AppError);
      try {
        verifyClaimVerificationToken('');
      } catch (err: any) {
        expect(err.code).toBe('CLAIM_VERIFICATION_REQUIRED');
        expect(err.statusCode).toBe(400);
      }
    });

    it('rejects tampered token with CLAIM_VERIFICATION_INVALID', () => {
      const token = generateClaimVerificationToken({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        tenantId: dummyTenantId,
      });
      const [data] = token.split('.');
      const tamperedToken = `${data}.tamperedSignature12345`;

      expect(() => verifyClaimVerificationToken(tamperedToken)).toThrowError(AppError);
      try {
        verifyClaimVerificationToken(tamperedToken);
      } catch (err: any) {
        expect(err.code).toBe('CLAIM_VERIFICATION_INVALID');
        expect(err.statusCode).toBe(403);
      }
    });

    it('rejects expired token with CLAIM_VERIFICATION_EXPIRED', () => {
      const expiredPayload = {
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        tenantId: dummyTenantId,
        exp: Date.now() - 1000, // expired 1 sec ago
      };
      const b64Data = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
      const env = getEnv();
      const secret = env.SESSION_ENCRYPTION_KEY || 'claim-verification-secret';
      const sig = crypto.createHmac('sha256', secret).update(b64Data).digest('base64url');
      const expiredToken = `${b64Data}.${sig}`;

      expect(() => verifyClaimVerificationToken(expiredToken)).toThrowError(AppError);
      try {
        verifyClaimVerificationToken(expiredToken);
      } catch (err: any) {
        expect(err.code).toBe('CLAIM_VERIFICATION_EXPIRED');
        expect(err.statusCode).toBe(400);
      }
    });
  });

  describe('2. verifyTenantClaim Strict Matching & Substring Bypass Rejection (AC-1)', () => {
    let service: TenantRegistrationService;

    beforeEach(() => {
      vi.clearAllMocks();

      mockPrisma.room.findFirst.mockResolvedValue({
        id: dummyRoomId,
        dormitoryId: dummyDormId,
        roomNumber: '101',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        currentTenantId: dummyTenantId,
        deletedAt: null,
      });

      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: dummyTenantId,
        dormitoryId: dummyDormId,
        status: 'active',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        displayName: 'สมชาย ใจดี',
        phone: '0812345678',
        lineFriendId: null,
        linkedUserId: null,
        contracts: [],
        provisionalRentalTerms: [],
        emergencyContacts: [],
        vehicles: [],
        coOccupants: [],
      });

      service = new TenantRegistrationService();
    });

    it('rejects single-letter substring match with 404 CLAIM_MATCH_FAILED', async () => {
      await expect(
        service.verifyTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          claimInput: 'ส', // single letter of 'สมชาย'
          actorId: 'test-actor-1',
        })
      ).rejects.toMatchObject({
        code: 'CLAIM_MATCH_FAILED',
        statusCode: 404,
      });
    });

    it('rejects partial first-name match when full name is required (similarity < 0.90)', async () => {
      await expect(
        service.verifyTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          claimInput: 'สมชาย', // Only first name when stored is 'สมชาย ใจดี' -> similarity < 0.90
          actorId: 'test-actor-2',
        })
      ).rejects.toMatchObject({
        code: 'CLAIM_MATCH_FAILED',
        statusCode: 404,
      });
    });

    it('succeeds on full name match (similarity >= 0.90) and issues claimVerificationToken', async () => {
      const result = await service.verifyTenantClaim({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        claimInput: 'สมชาย ใจดี',
        actorId: 'test-actor-3',
      });

      expect(result.verified).toBe(true);
      expect(result.tenantId).toBe(dummyTenantId);
      expect(typeof result.claimVerificationToken).toBe('string');

      // Verify the returned token is valid
      const parsedProof = verifyClaimVerificationToken(result.claimVerificationToken!);
      expect(parsedProof.tenantId).toBe(dummyTenantId);
      expect(parsedProof.roomId).toBe(dummyRoomId);
      expect(parsedProof.dormitoryId).toBe(dummyDormId);
    });

    it('succeeds on full name with Thai honorific prefix (e.g. นายสมชาย ใจดี)', async () => {
      const result = await service.verifyTenantClaim({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        claimInput: 'นายสมชาย ใจดี',
        actorId: 'test-actor-4',
      });

      expect(result.verified).toBe(true);
      expect(result.tenantId).toBe(dummyTenantId);
      expect(typeof result.claimVerificationToken).toBe('string');
    });

    it('succeeds on exact phone match (normalized digits)', async () => {
      const result = await service.verifyTenantClaim({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        claimInput: '081-234-5678', // with hyphens
        actorId: 'test-actor-5',
      });

      expect(result.verified).toBe(true);
      expect(result.tenantId).toBe(dummyTenantId);
      expect(typeof result.claimVerificationToken).toBe('string');
    });

    it('rejects wrong phone number with 404 CLAIM_MATCH_FAILED', async () => {
      await expect(
        service.verifyTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          claimInput: '0899999999',
          actorId: 'test-actor-6',
        })
      ).rejects.toMatchObject({
        code: 'CLAIM_MATCH_FAILED',
        statusCode: 404,
      });
    });
  });

  describe('3. completeTenantClaim Validation & Security Guards (AC-2, AC-3, AC-4)', () => {
    let service: TenantRegistrationService;
    let validToken: string;

    beforeEach(() => {
      vi.clearAllMocks();

      validToken = generateClaimVerificationToken({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        tenantId: dummyTenantId,
      });

      mockPrisma.tenant.findFirst.mockResolvedValue({
        id: dummyTenantId,
        dormitoryId: dummyDormId,
        lineFriendId: null,
        linkedUserId: null,
        displayName: 'สมชาย ใจดี',
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        occupancies: [{ roomId: dummyRoomId, status: 'ACTIVE' }],
        contracts: [],
        provisionalRentalTerms: [],
      });

      mockPrisma.tenant.update.mockResolvedValue({
        id: dummyTenantId,
        status: 'active',
      });

      mockPrisma.room.findFirst.mockResolvedValue({
        id: dummyRoomId,
        dormitoryId: dummyDormId,
        currentTenantId: dummyTenantId,
      });

      service = new TenantRegistrationService();
    });

    it('rejects completeTenantClaim when claimVerificationToken is missing (AC-2)', async () => {
      await expect(
        service.completeTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
          // no claimVerificationToken
        })
      ).rejects.toMatchObject({
        code: 'CLAIM_VERIFICATION_REQUIRED',
        statusCode: 400,
      });
    });

    it('rejects completeTenantClaim when token tenant/room does not match payload (AC-2)', async () => {
      const mismatchedToken = generateClaimVerificationToken({
        dormitoryId: dummyDormId,
        roomId: 'other-room-id',
        tenantId: dummyTenantId,
      });

      await expect(
        service.completeTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          claimVerificationToken: mismatchedToken,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
        })
      ).rejects.toMatchObject({
        code: 'CLAIM_VERIFICATION_MISMATCH',
        statusCode: 403,
      });
    });

    it('rejects completeTenantClaim when tenant is already claimed (lineFriendId != null) (AC-3)', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValueOnce({
        id: dummyTenantId,
        dormitoryId: dummyDormId,
        lineFriendId: 'U1234567890abcdef', // Already bound to LINE!
        linkedUserId: null,
        occupancies: [{ roomId: dummyRoomId, status: 'ACTIVE' }],
        contracts: [],
        provisionalRentalTerms: [],
      });

      await expect(
        service.completeTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          claimVerificationToken: validToken,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
        })
      ).rejects.toMatchObject({
        code: 'TENANT_ALREADY_CLAIMED',
        statusCode: 409,
      });
    });

    it('rejects completeTenantClaim when tenant is not associated with target room (AC-4)', async () => {
      mockPrisma.tenant.findFirst.mockResolvedValueOnce({
        id: dummyTenantId,
        dormitoryId: dummyDormId,
        lineFriendId: null,
        linkedUserId: null,
        occupancies: [], // No occupancy on target room!
        contracts: [],
        provisionalRentalTerms: [],
      });
      mockPrisma.room.findFirst.mockResolvedValueOnce({
        id: dummyRoomId,
        dormitoryId: dummyDormId,
        currentTenantId: 'another-tenant-id', // Not this tenant!
      });

      await expect(
        service.completeTenantClaim({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          claimVerificationToken: validToken,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
        })
      ).rejects.toMatchObject({
        code: 'ROOM_TENANT_MISMATCH',
        statusCode: 400,
      });
    });

    it('successfully completes claim when token and all guards pass without inviteToken (AC-6)', async () => {
      const res = await service.completeTenantClaim({
        dormitoryId: dummyDormId,
        roomId: dummyRoomId,
        tenantId: dummyTenantId,
        claimVerificationToken: validToken,
        signatureBase64: 'data:image/png;base64,dGVzdA==',
        // No inviteToken provided!
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(res.tenant.id).toBe(dummyTenantId);
      expect(res.tenant.status).toBe('active');
    });
  });

  describe('4. Router Level CSRF Enforcement for Cookie Session (AC-5)', () => {
    let app: express.Express;
    let mockAuthService: any;
    let mockRegService: any;

    beforeEach(() => {
      mockAuthService = {
        verifyCsrf: vi.fn((headerToken, sessionId) => headerToken === 'valid-csrf-token' && sessionId === 'sess-123'),
        requireAuth: () => (req: any, res: any, next: any) => next(),
      };
      mockRegService = {
        completeTenantClaim: vi.fn().mockResolvedValue({ id: dummyTenantId, status: 'active' }),
      };

      app = express();
      app.use(express.json());
      app.use(cookieParserMiddleware);
      app.use('/api/v1/tenant-registrations', createTenantRegistrationRouter(mockAuthService, mockRegService));
    });

    it('rejects complete-claim with 403 CSRF_INVALID when cookie session present without CSRF token (AC-5)', async () => {
      const env = getEnv();
      const tokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
      const encryptedSessionCookie = tokenService.encryptToken({
        sub: 'user-123',
        sid: 'sess-123',
        type: 'session',
        version: 1,
      }, 3600);

      const res = await request(app)
        .post('/api/v1/tenant-registrations/complete-claim')
        .set('Cookie', [`horplus_session=${encryptedSessionCookie}`])
        .send({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
          claimVerificationToken: 'some-token',
        });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('allows complete-claim when cookie session and valid CSRF header are provided (AC-5)', async () => {
      const env = getEnv();
      const tokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
      const encryptedSessionCookie = tokenService.encryptToken({
        sub: 'user-123',
        sid: 'sess-123',
        type: 'session',
        version: 1,
      }, 3600);

      const res = await request(app)
        .post('/api/v1/tenant-registrations/complete-claim')
        .set('Cookie', [
          `horplus_session=${encryptedSessionCookie}`,
          `horplus_csrf=valid-csrf-token`,
        ])
        .set('x-csrf-token', 'valid-csrf-token')
        .send({
          dormitoryId: dummyDormId,
          roomId: dummyRoomId,
          tenantId: dummyTenantId,
          signatureBase64: 'data:image/png;base64,dGVzdA==',
          claimVerificationToken: 'some-token',
        });

      expect(res.status).toBe(200);
      expect(mockRegService.completeTenantClaim).toHaveBeenCalled();
    });
  });
});
