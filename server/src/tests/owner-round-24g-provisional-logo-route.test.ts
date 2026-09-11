import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getPrismaClient } from '../db/prisma.js';
import { createApp } from '../app.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../config/env.js';
import { PrismaUserRepository } from '../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../db/repositories/role.repository.js';

describe('Owner Round 2.4G: Provisional Onboarding Dormitory Logo Route & Security', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: any;

  let ownerUserId: string;
  let sessionCookie: string;
  let csrfToken: string;
  let provisionalDormitoryId: string;

  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ]);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {}, logSecurityEvent: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    // 1. Create Onboarding Owner User
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-prov-logo-${Date.now()}`,
        email: `prov-logo-${Date.now()}@example.com`,
        emailNormalized: `prov-logo-${Date.now()}@example.com`.toLowerCase(),
        name: 'Provisional Logo Owner',
        status: 'active',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Active Session using test authenticator
    const auth = await authService.authenticateTestUser(ownerUserId);
    sessionCookie = `horplus_session=${auth.sessionToken}; horplus_csrf=${auth.csrfToken}`;
    csrfToken = auth.csrfToken;

    // 3. Create Provisional (setup_pending) Dormitory
    const provDorm = await prisma.dormitory.create({
      data: {
        name: `Prov Dorm Logo Test ${Date.now()}`,
        addressLine1: '123 Onboarding Road',
        status: 'setup_pending',
        createdByUserId: ownerUserId,
      },
    });
    provisionalDormitoryId = provDorm.id;
  });

  afterAll(async () => {
    try {
      if (provisionalDormitoryId) {
        await prisma.dormitory.delete({ where: { id: provisionalDormitoryId } }).catch(() => {});
      }
      if (ownerUserId) {
        await prisma.session.deleteMany({ where: { userId: ownerUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: ownerUserId } }).catch(() => {});
      }
    } catch {}
  });

  it('rejects POST logo without CSRF token with 403 CSRF_INVALID', async () => {
    const res = await request(app)
      .post(`/api/v1/dormitories/${provisionalDormitoryId}/logo`)
      .set('Cookie', [sessionCookie])
      .set('X-Dormitory-Id', provisionalDormitoryId)
      .attach('file', validPngBuffer, 'test-logo.png');

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('CSRF_INVALID');
  });

  it('proves provisional onboarding compatibility: allows logo upload for authorized setup-pending dormitory', async () => {
    const res = await request(app)
      .post(`/api/v1/dormitories/${provisionalDormitoryId}/logo`)
      .set('Cookie', [sessionCookie])
      .set('X-Dormitory-Id', provisionalDormitoryId)
      .set('X-CSRF-Token', csrfToken)
      .attach('file', validPngBuffer, 'test-logo.png');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    
    expect(res.body.data.logoUrl).toContain(`/api/v1/dormitories/${provisionalDormitoryId}/logo`);

    // Verify DB metadata persisted
    const dorm = await prisma.dormitory.findUnique({ where: { id: provisionalDormitoryId } });
    expect(dorm?.logoObjectKey).toBeTruthy();
    expect(dorm?.logoMimeType).toBe('image/png');
  });

  it('proves public logo GET accessibility without any session or CSRF header', async () => {
    const res = await request(app)
      .get(`/api/v1/dormitories/${provisionalDormitoryId}/logo`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('public');
  });

  it('proves provisional onboarding compatibility: allows logo deletion with CSRF', async () => {
    const res = await request(app)
      .delete(`/api/v1/dormitories/${provisionalDormitoryId}/logo`)
      .set('Cookie', [sessionCookie])
      .set('X-Dormitory-Id', provisionalDormitoryId)
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.success).toBe(true);

    // Verify DB metadata cleared
    const dorm = await prisma.dormitory.findUnique({ where: { id: provisionalDormitoryId } });
    expect(dorm?.logoObjectKey).toBeNull();
  });
});