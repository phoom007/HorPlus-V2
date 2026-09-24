/**
 * @license Apache-2.0
 * Unit Test Suite for Card S2: LINE Server-Side ID Token Verification & LIFF Session
 * Covers AC S2-1 through S2-7 per ADR-003:16 and REQUIREMENTS-LOCK §10 line 171
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { LineTokenService } from '../../services/line-token.service.js';
import { getTenantLiffId, getTenantLiffChannelId } from '../../services/line-oa.service.js';
import { createAuthRouter } from '../../routes/auth.routes.js';
import { tenantRegistrationInviteService } from '../../services/tenant-registration-invite.service.js';
import { hashToken } from '../../utils/crypto-encryption.js';

const TEST_DORM_ID = '20000001-0000-4000-8000-000000000002';
const TEST_FRIEND_ID = '33333333-3333-3333-3333-333333333333';
const TEST_GRANT_ID = '44444444-4444-4444-4444-444444444444';

const { mockPrisma } = vi.hoisted(() => {
  const p: any = {
    dormitory: {
      findUnique: vi.fn(),
    },
    dormitoryLineFriend: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    dormitoryAccessGrant: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    tenant: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenantRegistrationRequest: {
      findFirst: vi.fn(),
    },
    session: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  p.$transaction = vi.fn().mockImplementation(async (callback: any) => callback(p));
  return { mockPrisma: p };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

describe('Card S2 — Server-side LIFF ID Token Verification & Identity Binding', () => {
  let app: express.Express;
  let mockAuthService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    LineTokenService.setMockVerifier(null);

    mockPrisma.dormitory.findUnique.mockResolvedValue({ id: TEST_DORM_ID, name: 'หอพักทดสอบ S2' });
    mockPrisma.session.create.mockResolvedValue({ id: 'sess-s2-1' });

    mockAuthService = {
      getSessionTokenService: () => ({
        encryptToken: vi.fn().mockReturnValue('mock_encrypted_session_token_s2'),
        decryptToken: vi.fn(),
      }),
      getCsrfService: () => ({
        generateCsrfToken: vi.fn().mockReturnValue('mock_csrf_token_s2'),
      }),
    };

    app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    const router = createAuthRouter(mockAuthService);
    app.use('/api/v1/auth', router);
  });

  afterEach(() => {
    LineTokenService.setMockVerifier(null);
  });

  describe('1. LineTokenService Unit Logic & Security Checks (ADR-003:16)', () => {
    it('rejects empty, null, or whitespace-only idToken with MISSING_ID_TOKEN', async () => {
      const service = new LineTokenService();
      const res1 = await service.verifyLineIdToken({ idToken: '' });
      expect(res1.valid).toBe(false);
      expect(res1.error).toBe('MISSING_ID_TOKEN');

      const res2 = await service.verifyLineIdToken({ idToken: '   ' });
      expect(res2.valid).toBe(false);
      expect(res2.error).toBe('MISSING_ID_TOKEN');
    });

    it('validates issuer, audience, expiration, and extracts claims when LINE API returns success', async () => {
      const service = new LineTokenService();
      const mockPayload = {
        iss: 'https://access.line.me',
        sub: 'U_TEST_USER_SOMCHAI',
        aud: '2011672957',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour in future
        name: 'สมชาย ผู้เช่า',
        picture: 'https://profile.line-scdn.net/somchai.jpg',
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => mockPayload,
      } as any);

      try {
        const result = await service.verifyLineIdToken({
          idToken: 'valid.mock.jwt.token',
          channelId: '2011672957',
        });

        expect(result.valid).toBe(true);
        expect(result.lineUserId).toBe('U_TEST_USER_SOMCHAI');
        expect(result.displayName).toBe('สมชาย ผู้เช่า');
        expect(result.pictureUrl).toBe('https://profile.line-scdn.net/somchai.jpg');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects invalid issuer with INVALID_ISSUER', async () => {
      const service = new LineTokenService();
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iss: 'https://evil-issuer.com',
          sub: 'U_ATTACKER',
          aud: '2011672957',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      } as any);

      try {
        const result = await service.verifyLineIdToken({
          idToken: 'spoofed.jwt.token',
          channelId: '2011672957',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toBe('INVALID_ISSUER');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects audience mismatch with AUDIENCE_MISMATCH', async () => {
      const service = new LineTokenService();
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iss: 'https://access.line.me',
          sub: 'U_ATTACKER',
          aud: 'different-channel-id-999',
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      } as any);

      try {
        const result = await service.verifyLineIdToken({
          idToken: 'wrong.audience.token',
          channelId: '2011672957',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toBe('AUDIENCE_MISMATCH');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('rejects expired tokens with TOKEN_EXPIRED', async () => {
      const service = new LineTokenService();
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          iss: 'https://access.line.me',
          sub: 'U_EXPIRED_USER',
          aud: '2011672957',
          exp: Math.floor(Date.now() / 1000) - 300, // expired 5 minutes ago
        }),
      } as any);

      try {
        const result = await service.verifyLineIdToken({
          idToken: 'expired.jwt.token',
          channelId: '2011672957',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toBe('TOKEN_EXPIRED');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('2. POST /api/v1/auth/line-liff-session Endpoint (AC S2-3, S2-4, S2-5)', () => {
    it('AC S2-5: returns HTTP 401 when idToken is missing or invalid/expired', async () => {
      // 1. Missing token
      const resMissing = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({});
      expect(resMissing.status).toBe(401);
      expect(resMissing.body.error.code).toBe('MISSING_ID_TOKEN');

      // 2. Mock verifier returning invalid
      LineTokenService.setMockVerifier(async () => ({
        valid: false,
        error: 'id_token expired',
      }));

      const resExpired = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({ idToken: 'expired-fake-token' });

      expect(resExpired.status).toBe(401);
      expect(resExpired.body.error.code).toBe('UNAUTHORIZED');
      expect(resExpired.body.error.message).toContain('โทเค็น LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
      expect(resExpired.body.error.detail).toBe('id_token expired');
    });

    it('AC S2-2, S2-4: establishes tenant session, sets cookies, and creates grant for valid LINE ID token', async () => {
      const testLineUserId = 'U_PHOOM_TENANT_TEST';
      const testLineUserIdHash = hashToken(testLineUserId);

      LineTokenService.setMockVerifier(async () => ({
        valid: true,
        lineUserId: testLineUserId,
        displayName: 'Phoom Tenant Test',
        pictureUrl: 'https://example.com/pic.jpg',
      }));

      mockPrisma.dormitoryLineFriend.findFirst.mockResolvedValueOnce({
        id: TEST_FRIEND_ID,
        dormitoryId: TEST_DORM_ID,
        lineUserIdHash: testLineUserIdHash,
        displayName: 'Phoom Tenant Test',
      });

      mockPrisma.dormitoryLineFriend.findUnique.mockResolvedValueOnce({
        id: TEST_FRIEND_ID,
        dormitoryId: TEST_DORM_ID,
        lineUserIdHash: testLineUserIdHash,
        displayName: 'Phoom Tenant Test',
      });

      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValueOnce({
        id: TEST_GRANT_ID,
        dormitoryId: TEST_DORM_ID,
        lineFriendId: TEST_FRIEND_ID,
        roleCode: 'TENANT',
        status: 'ACTIVE',
      });

      const res = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({ idToken: 'valid-test-id-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dormitoryId).toBe(TEST_DORM_ID);
      expect(res.body.data.grantId).toBe(TEST_GRANT_ID);
      expect(res.body.data.lineUserId).toBe(testLineUserId);

      // Verify cookies are set
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some((c: string) => c.includes('horplus_session='))).toBe(true);
      expect(cookies.some((c: string) => c.includes('horplus_csrf='))).toBe(true);
      expect(cookies.some((c: string) => c.includes(`active_dormitory_id=${TEST_DORM_ID}`))).toBe(true);

      // S2-4: Reusable entry - calling it again with valid token also succeeds
      mockPrisma.dormitoryLineFriend.findFirst.mockResolvedValueOnce({
        id: TEST_FRIEND_ID,
        dormitoryId: TEST_DORM_ID,
        lineUserIdHash: testLineUserIdHash,
      });
      mockPrisma.dormitoryLineFriend.findUnique.mockResolvedValueOnce({
        id: TEST_FRIEND_ID,
        dormitoryId: TEST_DORM_ID,
        lineUserIdHash: testLineUserIdHash,
      });
      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValueOnce({
        id: TEST_GRANT_ID,
        dormitoryId: TEST_DORM_ID,
        lineFriendId: TEST_FRIEND_ID,
        roleCode: 'TENANT',
        status: 'ACTIVE',
      });

      const res2 = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({ idToken: 'valid-test-id-token' });

      expect(res2.status).toBe(200);
      expect(res2.body.success).toBe(true);
    });

    it('AC S2-3: unlinked user with no dormitory connection returns 404 LINE_FRIEND_NOT_FOUND', async () => {
      LineTokenService.setMockVerifier(async () => ({
        valid: true,
        lineUserId: 'U_STRANGER_9999',
        displayName: 'Stranger User',
      }));

      mockPrisma.dormitoryLineFriend.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({ idToken: 'stranger-valid-token' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LINE_FRIEND_NOT_FOUND');
      expect(res.body.error.message).toContain('ไม่พบประวัติการเชื่อมต่อ LINE กับหอพัก');
    });

    it('successfully links via entryToken when new tenant arrives with valid invite token', async () => {
      LineTokenService.setMockVerifier(async () => ({
        valid: true,
        lineUserId: 'U_NEW_TENANT_INVITED',
        displayName: 'New Tenant',
      }));

      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockResolvedValueOnce({
        id: 'inv-s2-123',
        dormitoryId: TEST_DORM_ID,
        dormitoryName: 'หอพักทดสอบ S2',
        lineFriendId: TEST_FRIEND_ID,
        expiresAt: new Date(Date.now() + 86400000),
        purpose: 'TENANT_REGISTRATION',
      } as any);

      mockPrisma.dormitoryLineFriend.findUnique.mockResolvedValueOnce({
        id: TEST_FRIEND_ID,
        dormitoryId: TEST_DORM_ID,
      });

      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dormitoryAccessGrant.create.mockResolvedValueOnce({
        id: TEST_GRANT_ID,
        dormitoryId: TEST_DORM_ID,
        lineFriendId: TEST_FRIEND_ID,
        roleCode: 'TENANT',
        status: 'ACTIVE',
      });

      const res = await request(app)
        .post('/api/v1/auth/line-liff-session')
        .send({
          idToken: 'new-tenant-id-token',
          entryToken: 'invite-raw-token-456',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dormitoryId).toBe(TEST_DORM_ID);
      expect(res.body.data.grantId).toBe(TEST_GRANT_ID);
    });
  });

  describe('3. AC S2-7: Configuration & No Hardcoded LIFF IDs', () => {
    it('getTenantLiffId reads from environment variables without hardcoded fallback', () => {
      const origEnv = process.env.LINE_TENANT_LIFF_ID;
      try {
        process.env.LINE_TENANT_LIFF_ID = 'test-channel-999-customliff';
        expect(getTenantLiffId()).toBe('test-channel-999-customliff');

        delete process.env.LINE_TENANT_LIFF_ID;
        delete process.env.VITE_LINE_TENANT_LIFF_ID;
        delete process.env.VITE_LINE_LIFF_ID;
        delete process.env.LINE_LIFF_ID;

        // When all env vars are unset, it returns empty string, NOT hardcoded value
        expect(getTenantLiffId()).toBe('');
      } finally {
        if (origEnv) process.env.LINE_TENANT_LIFF_ID = origEnv;
      }
    });

    it('getTenantLiffChannelId extracts channel ID from LIFF ID or explicit channel ID env', () => {
      const origEnv = process.env.LINE_TENANT_LIFF_ID;
      try {
        process.env.LINE_TENANT_LIFF_ID = '2011672957-customPart';
        expect(getTenantLiffChannelId()).toBe('2011672957');
      } finally {
        if (origEnv) process.env.LINE_TENANT_LIFF_ID = origEnv;
      }
    });
  });
});
