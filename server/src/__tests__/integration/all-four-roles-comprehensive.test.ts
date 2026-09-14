/**
 * Comprehensive Multi-Role Integration Test Suite
 * Tests all 4 roles across core modules and verifies:
 * 1. STAFF (Direct Grant) - Scoped dashboard (rooms, meters, maintenance), bill/tenant 403,
 *    meter record, maintenance creation without UUID error, strict 403 on announcements,
 *    LINE OA, payment settings, and staff management.
 * 2. MANAGER (Direct Grant) - Dashboard, bills, payments, rooms, tenants, maintenance,
 *    LINE OA config read/write, tenant ID upload/view, ANNOUNCEMENTS CREATE without
 *    Prisma UUID error (fix for media_1789322626899), strict 403 on payment settings and staff.
 * 3. OWNER (Direct Grant) - Full operations, announcements create, LINE OA config,
 *    PLUS payment settings 200 and staff management 200.
 * 4. GOOGLE OWNER (Google Session) - Full operations, announcements create, LINE OA config,
 *    payment settings 200, staff management 200, subscription status 200.
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../app.js';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { SessionTokenService } from '../../services/session-token.service.js';
import { CsrfService } from '../../services/csrf.service.js';
import { getEnv } from '../../config/env.js';

const prisma = new PrismaClient();

describe('All Four Roles Comprehensive Integration Suite', () => {
  let app: any;
  let grantService: AccessGrantService;
  let sessionTokenService: SessionTokenService;
  let csrfService: CsrfService;

  let testDormitoryId: string;
  let testGoogleOwnerUserId: string;
  let testTenantId: string;

  // Role Auth Contexts
  let staffCookie: string;
  let staffCsrfToken: string;

  let managerCookie: string;
  let managerCsrfToken: string;

  let directOwnerCookie: string;
  let directOwnerCsrfToken: string;

  let googleOwnerCookie: string;
  let googleOwnerCsrfToken: string;

  beforeAll(async () => {
    app = createApp({ forcePrisma: true });
    const env = getEnv();
    grantService = new AccessGrantService(prisma, new MockLinePlatformAdapter());
    sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    csrfService = new CsrfService(env.CSRF_SIGNING_KEY);

    const stamp = Date.now();

    // 1. Create Google Owner user & Dormitory
    const googleOwner = await prisma.user.create({
      data: {
        email: `all4_google_owner_${stamp}@example.com`,
        emailNormalized: `all4_google_owner_${stamp}@example.com`,
        name: 'Google Authoritative Owner',
        googleSubject: `goog_all4_${stamp}`,
      },
    });
    testGoogleOwnerUserId = googleOwner.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'HorPlus All 4 Roles Manor',
        createdByUserId: testGoogleOwnerUserId,
        status: 'active',
        timezone: 'Asia/Bangkok',
      },
    });
    testDormitoryId = dorm.id;

    // 2. Ensure system roles exist in DB
    let ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
    if (!ownerRole) {
      ownerRole = await prisma.role.create({
        data: {
          code: 'OWNER',
          name: 'เจ้าของหอพัก',
          isSystem: true,
          permissions: { '*': ['*'] },
        },
      });
    }

    let managerRole = await prisma.role.findFirst({ where: { code: 'MANAGER' } });
    if (!managerRole) {
      managerRole = await prisma.role.create({
        data: {
          code: 'MANAGER',
          name: 'ผู้จัดการ',
          isSystem: true,
          permissions: {
            rooms: ['view', 'create', 'update', 'delete', 'manage'],
            buildings: ['view', 'create', 'update', 'delete', 'manage'],
            tenants: ['view', 'create', 'update', 'archive', 'document:read', 'document:write'],
            contracts: ['view', 'create', 'update', 'delete', 'manage'],
            bills: ['view', 'generate', 'create', 'update', 'cancel', 'manage'],
            billing: ['view', 'manage', 'write', 'read'],
            billing_cycles: ['view', 'create', 'update'],
            billing_settings: ['view', 'read'],
            maintenance: ['view', 'create', 'update', 'close', 'delete', 'manage'],
            meters: ['view', 'record', 'write', 'manage'],
            payments: ['view', 'create', 'update', 'manage', 'write'],
            receipts: ['view', 'create', 'manage', 'write'],
            announcements: ['view', 'create', 'update', 'delete', 'manage'],
            reports: ['view'],
            billboard: ['view'],
            dormitory: ['view'],
            line_oa: ['view', 'read', 'write', 'manage'],
            subscription: ['view', 'read', 'write', 'manage'],
          },
        },
      });
    }

    let freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      freePlan = await prisma.subscriptionPlan.create({
        data: {
          code: 'FREE',
          name: 'HorPlus Free',
          type: 'FREE',
          roomLimit: 10,
          enabled: true,
        },
      });
    }

    let paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) {
      paidPlan = await prisma.subscriptionPlan.create({
        data: {
          code: 'PAID',
          name: 'HorPlus PRO',
          type: 'PAID',
          roomLimit: 9999,
          enabled: true,
        },
      });
    }

    let staffRole = await prisma.role.findFirst({ where: { code: 'STAFF' } });
    if (!staffRole) {
      staffRole = await prisma.role.create({
        data: {
          code: 'STAFF',
          name: 'ช่าง / แม่บ้าน',
          isSystem: true,
          permissions: {
            rooms: ['view'],
            meters: ['view', 'record', 'write'],
            maintenance: ['view', 'create', 'update', 'write'],
          },
        },
      });
    }

    // 3. Bind Google Owner as active DormitoryMember
    await prisma.dormitoryMember.create({
      data: {
        dormitoryId: testDormitoryId,
        userId: testGoogleOwnerUserId,
        roleId: ownerRole.id,
        status: 'active',
        membershipOrigin: 'GOOGLE_BOOTSTRAP',
      },
    });

    // 4. Create a test tenant for document upload/view tests
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantNumber: 'T-ALL4-01',
        firstName: 'Thanakorn',
        lastName: 'Jaidee',
        displayName: 'Thanakorn Jaidee',
        phone: '0899999999',
        status: 'active',
      },
    });
    testTenantId = tenant.id;

    // Helper to redeem direct access grant
    async function redeemDirectGrant(role: 'STAFF' | 'MANAGER' | 'OWNER') {
      const grantRes = await grantService.createAccessGrant(
        testDormitoryId,
        null,
        role,
        `usr_${testGoogleOwnerUserId}`
      );
      const token = grantRes.bearerUrl.split('#')[1];
      const redeemRes = await request(app)
        .post('/api/v1/staff-access/redeem')
        .send({ token });

      expect(redeemRes.status).toBe(200);
      const rawCookies = redeemRes.headers['set-cookie'];
      const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : rawCookies;
      const csrfToken = redeemRes.body.data?.csrfToken;
      return { cookie: cookieStr, csrfToken };
    }

    // 5. Redeem Direct Grants for STAFF, MANAGER, OWNER
    const staffAuth = await redeemDirectGrant('STAFF');
    staffCookie = staffAuth.cookie;
    staffCsrfToken = staffAuth.csrfToken;

    const managerAuth = await redeemDirectGrant('MANAGER');
    managerCookie = managerAuth.cookie;
    managerCsrfToken = managerAuth.csrfToken;

    const directOwnerAuth = await redeemDirectGrant('OWNER');
    directOwnerCookie = directOwnerAuth.cookie;
    directOwnerCsrfToken = directOwnerAuth.csrfToken;

    // 6. Setup Google Owner session
    const googleSessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(googleSessionId);
    await prisma.session.create({
      data: {
        userId: testGoogleOwnerUserId,
        sessionIdHash,
        expiresAt: new Date(Date.now() + 86400 * 1000),
        tokenVersion: 1,
      },
    });
    const googleSessionToken = sessionTokenService.encryptToken(
      { sub: testGoogleOwnerUserId, sid: googleSessionId, type: 'session', version: 1 },
      86400
    );
    googleOwnerCsrfToken = csrfService.generateCsrfToken(googleSessionId);
    googleOwnerCookie = `horplus_session=${googleSessionToken}; horplus_csrf=${googleOwnerCsrfToken}`;
  });

  afterAll(async () => {
    try {
      if (testTenantId) {
        await prisma.tenant.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
      }
      if (testDormitoryId) {
        await prisma.dormitoryAccessGrant.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.dormitoryLineConfig.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.announcement.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.maintenanceRequest.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.auditLog.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
        await prisma.dormitory.delete({ where: { id: testDormitoryId } }).catch(() => {});
      }
      if (testGoogleOwnerUserId) {
        await prisma.session.deleteMany({ where: { userId: testGoogleOwnerUserId } }).catch(() => {});
        await prisma.user.delete({ where: { id: testGoogleOwnerUserId } }).catch(() => {});
      }
    } catch {
      // Ignore cleanup failures
    }
    await prisma.$disconnect();
  });

  // ==========================================
  // ROLE 1: ช่าง / แม่บ้าน (STAFF)
  // ==========================================
  describe('Role 1: ช่าง / แม่บ้าน (STAFF - Direct Grant)', () => {
    it('allows Staff to access permitted resources (rooms, maintenance, meter readings)', async () => {
      const roomsRes = await request(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(roomsRes.status).toBe(200);

      const maintRes = await request(app)
        .get('/api/v1/maintenance')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(maintRes.status).toBe(200);

      const meterRes = await request(app)
        .get('/api/v1/meters/readings')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(meterRes.status).toBe(200);
    });

    it('allows Staff to create maintenance request without UUID error, appending provenance note', async () => {
      const res = await request(app)
        .post('/api/v1/maintenance-requests')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .send({
          title: 'หลอดไฟทางเดินเสีย',
          description: 'หลอดไฟหน้าห้อง 102 กะพริบ',
          category: 'electricity',
          priority: 'normal',
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.title || res.body.data?.title).toBe('หลอดไฟทางเดินเสีย');
      const note = res.body.note || res.body.data?.note || '';
      expect(note).toContain('ช่าง / แม่บ้าน');
    });

    it('denies Staff mutation permissions for billing issuance and tenant documents (403)', async () => {
      const billsRes = await request(app)
        .post('/api/v1/bills/generate')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .send({
          roomId: crypto.randomUUID(),
          billingCycleId: crypto.randomUUID(),
          waterStart: 100,
          waterEnd: 110,
          electricStart: 200,
          electricEnd: 220,
        });
      expect(billsRes.status).toBe(403);

      const docRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .attach('file', Buffer.from('fake-png'), 'test.png');
      expect(docRes.status).toBe(403);
    });

    it('strictly denies Staff on announcements create, LINE OA, payment-settings, and staff manage (403)', async () => {
      const annRes = await request(app)
        .post('/api/v1/announcements')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .send({
          title: 'ทดสอบประกาศโดยช่าง',
          content: 'ควรถูกปฏิเสธด้วย 403',
        });
      expect(annRes.status).toBe(403);

      const lineRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(lineRes.status).toBe(403);

      const payRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/payment-settings`)
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(payRes.status).toBe(403);

      const staffRes = await request(app)
        .get(`/api/v1/properties/${testDormitoryId}/staff`)
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(staffRes.status).toBe(403);
    });

    it('strictly denies Staff from subscription quote, commit, and slip upload (403)', async () => {
      const quoteRes = await request(app)
        .post('/api/v1/subscription/quote')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .send({ durationMonths: 1 });
      expect(quoteRes.status).toBe(403);

      const commitRes = await request(app)
        .post('/api/v1/subscription/commit')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .send({ intentId: crypto.randomUUID() });
      expect(commitRes.status).toBe(403);

      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );
      const slipRes = await request(app)
        .post('/api/v1/subscription/payment/slip')
        .set('Cookie', staffCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', staffCsrfToken)
        .attach('file', pngBuffer, 'slip.png');
      expect(slipRes.status).toBe(403);
    });
  });

  // ==========================================
  // ROLE 2: ผู้จัดการ (MANAGER)
  // ==========================================
  describe('Role 2: ผู้จัดการ (MANAGER - Direct Grant)', () => {
    it('allows Manager to access operational modules (rooms, bills, payments, maintenance, tenants)', async () => {
      const roomsRes = await request(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(roomsRes.status).toBe(200);

      const billsRes = await request(app)
        .get('/api/v1/bills')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(billsRes.status).toBe(200);

      const payRes = await request(app)
        .get('/api/v1/payments')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(payRes.status).toBe(200);

      const maintRes = await request(app)
        .get('/api/v1/maintenance')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(maintRes.status).toBe(200);

      const tenantsRes = await request(app)
        .get('/api/v1/tenants')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(tenantsRes.status).toBe(200);
    });

    it('CRITICAL BUG FIX VERIFICATION: allows Manager to create announcement WITHOUT Prisma UUID crash (P2023)', async () => {
      const annRes = await request(app)
        .post('/api/v1/announcements')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', managerCsrfToken)
        .send({
          title: 'แจ้งทำความสะอาดถังพักน้ำส่วนกลาง',
          content: 'จะมีการล้างถังพักน้ำในวันเสาร์นี้ เวลา 09:00 - 12:00 น.',
          type: 'general',
          priority: 'normal',
          targetType: 'all',
          isPinned: false,
        });

      // Must succeed with 201 Created and NOT throw 500 P2023 UUID error
      expect([200, 201]).toContain(annRes.status);
      expect(annRes.body.title).toBe('แจ้งทำความสะอาดถังพักน้ำส่วนกลาง');
      expect(annRes.body.id).toBeDefined();

      // Verify the announcement can be queried back
      const listRes = await request(app)
        .get('/api/v1/announcements')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(listRes.status).toBe(200);
      const items = listRes.body.data || listRes.body.items || [];
      expect(items.some((a: any) => a.title === 'แจ้งทำความสะอาดถังพักน้ำส่วนกลาง')).toBe(true);
    });

    it('allows Manager to read & update LINE OA configuration', async () => {
      const getLineRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(getLineRes.status).toBe(200);
      expect(getLineRes.body.success).toBe(true);

      const putLineRes = await request(app)
        .put(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', managerCsrfToken)
        .send({
          channelId: '2009998888',
          channelSecret: 'mgr_line_oa_secret_1234567890',
        });
      expect(putLineRes.status).toBe(200);
      expect(putLineRes.body.success).toBe(true);
    });

    it('allows Manager to upload and view tenant identity document', async () => {
      const pngBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
        'base64'
      );

      const uploadRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', managerCsrfToken)
        .attach('file', pngBuffer, 'mgr-id-card.png');

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.data?.hasIdentityDocument).toBe(true);

      const viewRes = await request(app)
        .get(`/api/v1/tenants/${testTenantId}/identity-document`)
        .query({ dormitoryId: testDormitoryId })
        .set('Cookie', managerCookie);

      expect(viewRes.status).toBe(200);
      expect(viewRes.headers['content-type']).toMatch(/image\/(png|webp)/);
    });

    it('strictly denies Manager on Payment Settings and Staff Management (403)', async () => {
      const payRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/payment-settings`)
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(payRes.status).toBe(403);

      const staffRes = await request(app)
        .get(`/api/v1/properties/${testDormitoryId}/staff`)
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(staffRes.status).toBe(403);
    });

    it('allows Manager to access subscription endpoints (plans, quote, and status 200)', async () => {
      const plansRes = await request(app)
        .get('/api/v1/subscription/plans')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(plansRes.status).toBe(200);

      const statusRes = await request(app)
        .get('/api/v1/subscription/current')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(statusRes.status).toBe(200);

      const quoteRes = await request(app)
        .post('/api/v1/subscription/quote')
        .set('Cookie', managerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', managerCsrfToken)
        .send({ isFreePlan: true });
      if (quoteRes.status !== 200) {
        console.log('MANAGER QUOTE ERROR:', JSON.stringify(quoteRes.body, null, 2));
      }
      expect(quoteRes.status).toBe(200);
      expect(quoteRes.body.success).toBe(true);
    });
  });

  // ==========================================
  // ROLE 3: เจ้าของหอพัก (OWNER - Direct Grant)
  // ==========================================
  describe('Role 3: เจ้าของหอพัก (OWNER - Direct Grant)', () => {
    it('allows Direct Owner full operational capabilities including announcement create without UUID crash', async () => {
      const annRes = await request(app)
        .post('/api/v1/announcements')
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', directOwnerCsrfToken)
        .send({
          title: 'ประกาศปรับปรุงระบบกล้องวงจรปิด',
          content: 'โดยเจ้าของหอพักผ่านลิงก์ตรง',
          type: 'general',
          priority: 'normal',
          targetType: 'all',
          isPinned: false,
        });

      expect([200, 201]).toContain(annRes.status);
      expect(annRes.body.title).toBe('ประกาศปรับปรุงระบบกล้องวงจรปิด');
    });

    it('allows Direct Owner to access Payment Settings (200)', async () => {
      const payRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/payment-settings`)
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(payRes.status).toBe(200);
    });

    it('allows Direct Owner to access Staff Management (200)', async () => {
      const staffRes = await request(app)
        .get(`/api/v1/properties/${testDormitoryId}/staff`)
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.success).toBe(true);
    });

    it('allows Direct Owner to access LINE OA configuration (200)', async () => {
      const lineRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(lineRes.status).toBe(200);
    });

    it('allows Direct Owner to access subscription endpoints (plans, quote, and status 200)', async () => {
      const plansRes = await request(app)
        .get('/api/v1/subscription/plans')
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(plansRes.status).toBe(200);

      const statusRes = await request(app)
        .get('/api/v1/subscription/current')
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(statusRes.status).toBe(200);

      const quoteRes = await request(app)
        .post('/api/v1/subscription/quote')
        .set('Cookie', directOwnerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', directOwnerCsrfToken)
        .send({ isFreePlan: true });
      expect(quoteRes.status).toBe(200);
      expect(quoteRes.body.success).toBe(true);
    });
  });

  // ==========================================
  // ROLE 4: เจ้าของหอพักจำลองจาก Google (GOOGLE OWNER)
  // ==========================================
  describe('Role 4: เจ้าของหอพักจำลองจาก Google (GOOGLE OWNER - Session)', () => {
    it('allows Google Owner full operational capabilities including announcement create', async () => {
      const annRes = await request(app)
        .post('/api/v1/announcements')
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', googleOwnerCsrfToken)
        .send({
          title: 'ประกาศต้อนรับผู้เช่าใหม่ประจำเดือน',
          content: 'โดยเจ้าของหอพักผ่าน Google Login',
          type: 'general',
          priority: 'normal',
          targetType: 'all',
          isPinned: false,
        });

      expect([200, 201]).toContain(annRes.status);
      expect(annRes.body.title).toBe('ประกาศต้อนรับผู้เช่าใหม่ประจำเดือน');
    });

    it('allows Google Owner to access Payment Settings (200)', async () => {
      const payRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/payment-settings`)
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(payRes.status).toBe(200);
    });

    it('allows Google Owner to access Staff Management (200)', async () => {
      const staffRes = await request(app)
        .get(`/api/v1/properties/${testDormitoryId}/staff`)
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(staffRes.status).toBe(200);
      expect(staffRes.body.success).toBe(true);
    });

    it('allows Google Owner to access LINE OA configuration (200)', async () => {
      const lineRes = await request(app)
        .get(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);

      expect(lineRes.status).toBe(200);
    });

    it('allows Google Owner to access subscription endpoints (plans, quote, and status 200)', async () => {
      const subRes = await request(app)
        .get('/api/v1/subscription/plans')
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(subRes.status).toBe(200);

      const statusRes = await request(app)
        .get('/api/v1/subscription/current')
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId);
      expect(statusRes.status).toBe(200);

      const quoteRes = await request(app)
        .post('/api/v1/subscription/quote')
        .set('Cookie', googleOwnerCookie)
        .set('x-dormitory-id', testDormitoryId)
        .set('x-csrf-token', googleOwnerCsrfToken)
        .send({ isFreePlan: true });
      expect(quoteRes.status).toBe(200);
      expect(quoteRes.body.success).toBe(true);
    });
  });
});
