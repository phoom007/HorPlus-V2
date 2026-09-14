/**
 * Manager Role LINE OA & Tenant Document Integration Test Suite (TDD)
 * Tests MLD-01 to MLD-05:
 * - Direct Access Grant Manager uploading tenant identity document (UUID sanitization)
 * - Manager streaming/viewing tenant identity document
 * - Manager reading & updating LINE OA config without 403
 * - Owner-only security boundaries preserved (payment-settings 403, staff 403)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../../app.js';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';

const prisma = new PrismaClient();

describe('Manager Role LINE OA & Tenant Document Suite (MLD-01 - MLD-05)', () => {
  let app: any;
  let grantService: AccessGrantService;
  let testDormitoryId: string;
  let testOwnerUserId: string;
  let testTenantId: string;
  let managerCookie: string;
  let managerCsrfToken: string;

  beforeAll(async () => {
    app = createApp();
    grantService = new AccessGrantService(prisma, new MockLinePlatformAdapter());

    // 1. Create test owner user & dormitory
    const stamp = Date.now();
    const owner = await prisma.user.create({
      data: {
        email: `mgr_owner_${stamp}@example.com`,
        emailNormalized: `mgr_owner_${stamp}@example.com`,
        name: 'Manager Test Owner',
        googleSubject: `goog_mgr_${stamp}`
      }
    });
    testOwnerUserId = owner.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Manager Test Manor',
        createdByUserId: testOwnerUserId,
        status: 'active',
        timezone: 'Asia/Bangkok'
      }
    });
    testDormitoryId = dorm.id;

    // 2. Create test tenant in this dormitory
    const tenant = await prisma.tenant.create({
      data: {
        dormitoryId: testDormitoryId,
        tenantNumber: 'T-001',
        firstName: 'Somchai',
        lastName: 'Jaidee',
        displayName: 'Somchai Jaidee',
        phone: '0812345678',
        status: 'active'
      }
    });
    testTenantId = tenant.id;

    // 3. Create direct access grant for MANAGER
    const grantResult = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'MANAGER',
      `usr_${testOwnerUserId}`
    );

    const token = grantResult.bearerUrl.split('#')[1];

    // 4. Redeem direct access grant
    const redeemRes = await request(app)
      .post('/api/v1/staff-access/redeem')
      .send({ token });

    expect(redeemRes.status).toBe(200);
    const rawCookies = redeemRes.headers['set-cookie'];
    expect(rawCookies).toBeDefined();
    managerCookie = Array.isArray(rawCookies) ? rawCookies.join('; ') : rawCookies;
    managerCsrfToken = redeemRes.body.data?.csrfToken;
  });

  afterAll(async () => {
    if (testTenantId) {
      await prisma.tenant.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
    }
    if (testDormitoryId) {
      await prisma.dormitoryAccessGrant.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
      await prisma.dormitoryLineConfig.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
      await prisma.auditLog.deleteMany({ where: { dormitoryId: testDormitoryId } }).catch(() => {});
      await prisma.dormitory.delete({ where: { id: testDormitoryId } }).catch(() => {});
    }
    if (testOwnerUserId) {
      await prisma.user.delete({ where: { id: testOwnerUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('MLD-04: allows Direct Access Grant Manager to upload tenant identity document without UUID crash or 500 error', async () => {
    // 1x1 valid transparent PNG buffer
    const pngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      'base64'
    );

    const uploadRes = await request(app)
      .post(`/api/v1/tenants/${testTenantId}/identity-document`)
      .set('Cookie', managerCookie)
      .set('X-Dormitory-Id', testDormitoryId)
      .set('X-CSRF-Token', managerCsrfToken)
      .attach('file', pngBuffer, 'test-id-card.png');

    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.data?.hasIdentityDocument).toBe(true);
    expect(uploadRes.body.data?.tenantId).toBe(testTenantId);

    // Verify DB record has valid uploader UUID without ag_user_ prefix
    const dbTenant = await prisma.tenant.findUnique({
      where: { id: testTenantId }
    });
    expect(dbTenant?.idCardObjectKey).toBeDefined();
    expect(dbTenant?.idCardUploadedAt).toBeDefined();
    if (dbTenant?.idCardUploadedByUserId) {
      expect(dbTenant.idCardUploadedByUserId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
      expect(dbTenant.idCardUploadedByUserId).not.toContain('ag_user_');
    }
  });

  it('MLD-05: allows Manager to stream/view uploaded tenant identity document', async () => {
    const viewRes = await request(app)
      .get(`/api/v1/tenants/${testTenantId}/identity-document`)
      .query({ dormitoryId: testDormitoryId })
      .set('Cookie', managerCookie);

    expect(viewRes.status).toBe(200);
    expect(viewRes.headers['content-type']).toMatch(/image\/(png|webp)/);
    expect(viewRes.body).toBeDefined();
  });

  it('MLD-01: allows Manager to GET LINE OA config without 403 Forbidden', async () => {
    const getRes = await request(app)
      .get(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
      .set('Cookie', managerCookie)
      .set('X-Dormitory-Id', testDormitoryId);

    expect(getRes.status).toBe(200);
    expect(getRes.body.success).toBe(true);
    expect(getRes.body.config).toBeDefined();
  });

  it('MLD-01: allows Manager to update LINE OA config credentials via PUT', async () => {
    const putRes = await request(app)
      .put(`/api/v1/dormitories/${testDormitoryId}/line-oa/config`)
      .set('Cookie', managerCookie)
      .set('X-Dormitory-Id', testDormitoryId)
      .set('X-CSRF-Token', managerCsrfToken)
      .send({
        channelId: '2001234567',
        channelSecret: 'sec_test_mock_secret_key_12345678'
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.success).toBe(true);
    expect(putRes.body.config?.channelId).toBe('2001234567');
  });

  it('MLD-01 & SEC: strictly preserves Owner-only security boundaries (Manager denied payment-settings and staff)', async () => {
    const paymentRes = await request(app)
      .get(`/api/v1/dormitories/${testDormitoryId}/payment-settings`)
      .set('Cookie', managerCookie)
      .set('X-Dormitory-Id', testDormitoryId);

    expect(paymentRes.status).toBe(403);

    const staffRes = await request(app)
      .get(`/api/v1/properties/${testDormitoryId}/staff`)
      .set('Cookie', managerCookie)
      .set('X-Dormitory-Id', testDormitoryId);

    expect(staffRes.status).toBe(403);
  });
});
