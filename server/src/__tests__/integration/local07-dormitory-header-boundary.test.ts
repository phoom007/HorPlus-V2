/**
 * @license Apache-2.0
 * LOCAL-07 DORMITORY CONTEXT HEADER BOUNDARY & INTEGRATION TEST SUITE
 *
 * Verifies:
 * 1. Single valid UUID dormitory header proceeds with 200 OK to /meters/workspace/preview-context.
 * 2. Malformed non-UUID header returns controlled 400 INVALID_ID_FORMAT before Prisma query.
 * 3. Comma-separated duplicate header (<uuid>, <uuid>) returns controlled 400 INVALID_ID_FORMAT without silent reduction.
 * 4. Unauthorized valid UUID header returns 403 FORBIDDEN.
 * 5. Preview context for Fresh Owner / August 2026 succeeds with 200 OK and expected rate snapshot.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getPrismaClient } from '../../db/prisma.js';
import { createApp } from '../../app.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';

describe('LOCAL-07 Dormitory Header Boundary & Preview Context Integration', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: any;
  let ownerSessionCookie: string;
  let otherOwnerSessionCookie: string;

  let ownerUserId: string;
  let otherOwnerUserId: string;
  let dormitoryId: string;
  let otherDormitoryId: string;
  let billingCycleId: string;

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

    // 1. Create Primary Owner User
    const ownerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-owner-hdr-${Date.now()}`,
        email: `hdr-owner-${Date.now()}@example.com`,
        emailNormalized: `hdr-owner-${Date.now()}@example.com`.toLowerCase(),
        name: 'เจ้าของหอพัก Header Test',
      },
    });
    ownerUserId = ownerUser.id;

    // 2. Create Other Owner User
    const otherOwnerUser = await prisma.user.create({
      data: {
        googleSubject: `sub-other-hdr-${Date.now()}`,
        email: `other-owner-${Date.now()}@example.com`,
        emailNormalized: `other-owner-${Date.now()}@example.com`.toLowerCase(),
        name: 'เจ้าของหอพัก อื่นๆ',
      },
    });
    otherOwnerUserId = otherOwnerUser.id;

    // 3. Create Primary Dormitory & Membership
    const dorm = await prisma.dormitory.create({
      data: {
        name: 'หอพัก ทดสอบ Header Boundary',
        createdByUserId: ownerUserId,
        status: 'active',
      },
    });
    dormitoryId = dorm.id;

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        isSystem: true,
        permissions: { all: true },
      },
    });

    await prisma.dormitoryMember.create({
      data: {
        dormitoryId,
        userId: ownerUserId,
        roleId: ownerRole.id,
        status: 'active',
      },
    });

    // 4. Create Other Dormitory
    const otherDorm = await prisma.dormitory.create({
      data: {
        name: 'หอพัก อื่นๆ',
        createdByUserId: otherOwnerUserId,
        status: 'active',
      },
    });
    otherDormitoryId = otherDorm.id;

    // 5. Create Billing Settings & Billing Cycle with Rate Snapshot
    await prisma.dormitoryBillingSettings.create({
      data: {
        dormitoryId,
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFee: '150.00',
        commonFeeMode: 'fixed',
      },
    });

    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId,
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T00:00:00.000Z'),
        billingDate: new Date('2026-08-25T00:00:00.000Z'),
        dueDate: new Date('2026-09-05T00:00:00.000Z'),
        status: 'draft',
        createdByUserId: ownerUserId,
      },
    });
    billingCycleId = cycle.id;

    await prisma.billingRateSnapshot.create({
      data: {
        dormitoryId,
        billingCycleId,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFee: '150.00',
        commonFeeMode: 'fixed',
        internetFee: '0.00',
        internetFeeMode: 'fixed',
        parkingFee: '0.00',
        parkingFeeMode: 'fixed',
        lateFeeType: 'flat',
        lateFeeValue: '0.00',
        source: 'TEMPLATE_DEFAULT',
      },
    });

    // 6. Create Sessions
    const ownerAuth = await authService.authenticateTestUser(ownerUserId);
    ownerSessionCookie = `horplus_session=${ownerAuth.sessionToken}; horplus_csrf=${ownerAuth.csrfToken}`;

    const otherAuth = await authService.authenticateTestUser(otherOwnerUserId);
    otherOwnerSessionCookie = `horplus_session=${otherAuth.sessionToken}; horplus_csrf=${otherAuth.csrfToken}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. Single valid UUID header proceeds with 200 OK and returns rate snapshot', async () => {
    const res = await request(app)
      .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
      .set('Cookie', [ownerSessionCookie])
      .set('x-dormitory-id', dormitoryId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.billingCycleId).toBe(billingCycleId);
    expect(res.body.data.cycleCode).toBe('2026-08');
    expect(res.body.data.rateSnapshot).toBeDefined();
    expect(res.body.data.rateSnapshot.waterRate).toBe('18.00');
  });

  it('2. Malformed non-UUID header returns controlled 400 INVALID_ID_FORMAT before Prisma query', async () => {
    const res = await request(app)
      .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
      .set('Cookie', [ownerSessionCookie])
      .set('x-dormitory-id', 'invalid-non-uuid-dorm-id');

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INVALID_ID_FORMAT');
    expect(res.body.error.message).toBe('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID');
  });

  it('3. Comma-separated duplicate header returns controlled 400 INVALID_ID_FORMAT (not silently truncated)', async () => {
    const res = await request(app)
      .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
      .set('Cookie', [ownerSessionCookie])
      .set('x-dormitory-id', `${dormitoryId}, ${dormitoryId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INVALID_ID_FORMAT');
    expect(res.body.error.message).toBe('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID');
  });

  it('4. Comma-separated multiple distinct UUIDs return controlled 400 INVALID_ID_FORMAT', async () => {
    const res = await request(app)
      .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
      .set('Cookie', [ownerSessionCookie])
      .set('x-dormitory-id', `${dormitoryId},${otherDormitoryId}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INVALID_ID_FORMAT');
    expect(res.body.error.message).toBe('รหัสระบุตัวตน (ID) ไม่ถูกต้องตามรูปแบบ UUID');
  });

  it('5. Valid but unauthorized dormitory ID returns 403 FORBIDDEN', async () => {
    const res = await request(app)
      .get(`/api/v1/meters/workspace/preview-context?billingCycleId=${billingCycleId}`)
      .set('Cookie', [otherOwnerSessionCookie])
      .set('x-dormitory-id', dormitoryId);

    expect(res.status).toBe(403);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
