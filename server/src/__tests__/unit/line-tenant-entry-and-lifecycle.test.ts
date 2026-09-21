/**
 * Unit tests for LINE Tenant Direct Entry Bridge and Candidate Lifecycle Context
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAuthRouter } from '../../routes/auth.routes.js';
import { tenantRegistrationInviteService } from '../../services/tenant-registration-invite.service.js';
import { encryptText } from '../../utils/crypto-encryption.js';

process.env.DATABASE_URL = 'postgresql://horplus_app:mock_password@127.0.0.1:5432/mock_db';

const { mockPrisma } = vi.hoisted(() => {
  const grantObj = {
    findFirst: vi.fn(),
    create: vi.fn().mockResolvedValue({
      id: 'grant-tenant-123',
      dormitoryId: 'dorm-001',
      lineFriendId: 'friend-001',
      roleCode: 'TENANT',
      status: 'ACTIVE',
    }),
  };
  const sessionObj = {
    create: vi.fn().mockResolvedValue({
      id: 'session-123',
      status: 'active',
    }),
  };
  const client: any = {
    dormitoryAccessGrant: grantObj,
    session: sessionObj,
    $executeRaw: vi.fn().mockResolvedValue(1),
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
  client.$transaction = vi.fn().mockImplementation(async (callback: any) => {
    return callback(client);
  });
  return { mockPrisma: client };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

describe('LINE Tenant Entry Bridge & Candidate Lifecycle Suite', () => {
  let app: express.Express;
  let mockAuthService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAuthService = {
      getSessionTokenService: () => ({
        encryptToken: vi.fn().mockReturnValue('encrypted-mock-session-token'),
      }),
      getCsrfService: () => ({
        generateCsrfToken: vi.fn().mockReturnValue('mock-csrf-token'),
      }),
      authenticateGoogle: vi.fn(),
      validateSession: vi.fn(),
      requireAuth: () => (req: any, res: any, next: any) => next(),
    };

    app = express();
    app.use(express.json());
    app.use('/api/v1/auth', createAuthRouter(mockAuthService));
  });

  describe('GET /api/v1/auth/line-tenant-entry', () => {
    it('rejects missing token with 400 Bad Request HTML page', async () => {
      const res = await request(app).get('/api/v1/auth/line-tenant-entry');
      expect(res.status).toBe(400);
      expect(res.text).toContain('ไม่พบรหัสเชิญลงทะเบียน');
    });

    it('handles expired or invalid invite token with user-friendly error page', async () => {
      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockRejectedValueOnce({
        statusCode: 410,
        message: 'ลิงก์ลงทะเบียนนี้หมดอายุแล้ว (อายุการใช้งาน 7 วัน)',
      });

      const res = await request(app).get('/api/v1/auth/line-tenant-entry?t=invalid-token');
      expect(res.status).toBe(410);
      expect(res.text).toContain('ลิงก์ลงทะเบียนนี้หมดอายุแล้ว');
    });

    it('exchanges valid invite token, provisions TENANT grant, sets cookies, and redirects to /tenant', async () => {
      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockResolvedValueOnce({
        id: 'invite-123',
        dormitoryId: 'dorm-001',
        dormitoryName: 'หอพักสุขสบายแกรนด์',
        lineFriendId: 'friend-001',
        lineDisplayName: 'น้องเช่า สมหวัง',
        expiresAt: new Date(Date.now() + 86400000),
        purpose: 'TENANT_REGISTRATION',
      });

      const res = await request(app).get('/api/v1/auth/line-tenant-entry?t=valid-raw-token-123');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/tenant');

      // Verified cookies are set
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.some((c: string) => c.includes('horplus_session='))).toBe(true);
      expect(cookies.some((c: string) => c.includes('horplus_csrf='))).toBe(true);
      expect(cookies.some((c: string) => c.includes('active_dormitory_id=dorm-001'))).toBe(true);

      // Verified TENANT grant was created
      expect(mockPrisma.dormitoryAccessGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId: 'dorm-001',
            lineFriendId: 'friend-001',
            roleCode: 'TENANT',
            status: 'ACTIVE',
          }),
        })
      );

      // Verified Session was created with ACCESS_GRANT
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            principalType: 'ACCESS_GRANT',
            accessGrantId: 'grant-tenant-123',
            status: 'active',
          }),
        })
      );
    });

    it('successfully extracts token when percent-encoded query format (?t%3D...) is sent', async () => {
      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockResolvedValueOnce({
        id: 'invite-encoded-456',
        dormitoryId: 'dorm-001',
        dormitoryName: 'หอพักสุขสบายแกรนด์',
        lineFriendId: 'friend-001',
        lineDisplayName: 'น้องเช่า สมหวัง',
        expiresAt: new Date(Date.now() + 86400000),
        purpose: 'TENANT_REGISTRATION',
      });

      const res = await request(app).get('/api/v1/auth/line-tenant-entry?t%3Dencoded-token-456');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/tenant?sub=register');
    });

    it('successfully extracts token from liff.state query parameter', async () => {
      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockResolvedValueOnce({
        id: 'invite-liff-789',
        dormitoryId: 'dorm-001',
        dormitoryName: 'หอพักสุขสบายแกรนด์',
        lineFriendId: 'friend-001',
        lineDisplayName: 'น้องเช่า สมหวัง',
        expiresAt: new Date(Date.now() + 86400000),
        purpose: 'TENANT_REGISTRATION',
      });

      const res = await request(app).get('/api/v1/auth/line-tenant-entry?liff.state=%3Ft%3Dliff-token-789');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/tenant?sub=register');
    });

    it('reuses existing active grant (e.g. owner testing tenant flow) without unique constraint error', async () => {
      vi.spyOn(tenantRegistrationInviteService, 'resolveInvite').mockResolvedValueOnce({
        id: 'invite-existing-owner',
        dormitoryId: 'dorm-001',
        dormitoryName: 'หอพักสุขสบายแกรนด์',
        lineFriendId: 'friend-owner-001',
        lineDisplayName: 'เจ้าของหอพักใจดี',
        expiresAt: new Date(Date.now() + 86400000),
        purpose: 'TENANT_REGISTRATION',
      });

      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValueOnce({
        id: 'existing-owner-grant-id',
        dormitoryId: 'dorm-001',
        lineFriendId: 'friend-owner-001',
        roleCode: 'OWNER',
        status: 'ACTIVE',
      });

      const res = await request(app).get('/api/v1/auth/line-tenant-entry?t=existing-owner-token');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/tenant?sub=register');

      // Verified existing grant was reused, and create was NOT called
      expect(mockPrisma.dormitoryAccessGrant.create).not.toHaveBeenCalled();
      expect(mockPrisma.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            principalType: 'ACCESS_GRANT',
            accessGrantId: 'existing-owner-grant-id',
            status: 'active',
          }),
        })
      );
    });
  });

  describe('LINE Flex Message Builders for Registration Lifecycle', () => {
    it('builds owner notification flex message with applicant details and review button', async () => {
      const { buildOwnerNewTenantRegistrationFlexMessage } = await import('../../services/line-oa.service.js');
      const flex = buildOwnerNewTenantRegistrationFlexMessage(
        'หอพักแสนสุข',
        'สมชาย ใจดี',
        '101',
        '0812345678',
        'https://app.horplus.com'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('101');
      expect(flex.altText).toContain('หอพักแสนสุข');
      expect(flex.contents.type).toBe('bubble');
      expect(flex.contents.footer.contents[0].action.uri).toBe('https://app.horplus.com/owner/home');
    });
  });
});
