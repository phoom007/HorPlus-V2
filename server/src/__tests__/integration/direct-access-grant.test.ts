/**
 * Direct Access Grant Integration Test Suite (TDD)
 * Tests creating, listing, copying, and redeeming Access Grants without a LINE Friend (Direct Links)
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AccessGrantService } from '../../services/access-grant.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';

const prisma = new PrismaClient();

describe('Direct Access Grant Integration Suite (No LINE Friend)', () => {
  let grantService: AccessGrantService;
  let testDormitoryId: string;
  let testOwnerUserId: string;

  beforeAll(async () => {
    grantService = new AccessGrantService(prisma, new MockLinePlatformAdapter());

    // Create test user and dormitory
    const stamp = Date.now();
    const u = await prisma.user.create({
      data: {
        email: `direct_owner_${stamp}@example.com`,
        emailNormalized: `direct_owner_${stamp}@example.com`,
        name: 'Direct Grant Owner',
        googleSubject: `goog_direct_${stamp}`
      }
    });
    testOwnerUserId = u.id;

    const dorm = await prisma.dormitory.create({
      data: {
        name: 'Direct Grant Test Dorm',
        createdByUserId: testOwnerUserId,
        status: 'active',
        timezone: 'Asia/Bangkok'
      }
    });
    testDormitoryId = dorm.id;
  });

  afterAll(async () => {
    if (testDormitoryId) {
      await prisma.dormitoryAccessGrant.deleteMany({ where: { dormitoryId: testDormitoryId } });
      await prisma.auditLog.deleteMany({ where: { dormitoryId: testDormitoryId } });
      await prisma.dormitory.delete({ where: { id: testDormitoryId } }).catch(() => {});
    }
    if (testOwnerUserId) {
      await prisma.user.delete({ where: { id: testOwnerUserId } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  it('creates an active direct access grant with lineFriendId: null without database constraint violations', async () => {
    const result = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'OWNER',
      `usr_${testOwnerUserId}`
    );

    expect(result).toBeDefined();
    expect(result.grant).toBeDefined();
    expect(result.grant.roleCode).toBe('OWNER');
    expect(result.grant.status).toBe('ACTIVE');
    expect(result.grant.lineFriendId).toBeNull();
    expect(result.pushed).toBe(false);
    expect(result.deliveryStatus).toBeNull();
    expect(result.bearerUrl).toContain('/staff-access#');

    // Verify recovery via getGrantCopyLink
    const copyResult = await grantService.getGrantCopyLink(testDormitoryId, result.grant.id);
    expect(copyResult.url).toContain('/staff-access#');
    expect(copyResult.grantId).toBe(result.grant.id);

    // Verify redemption of direct grant token
    const token = result.bearerUrl.split('#')[1];
    const redeemResult = await grantService.redeemAccessGrant(token);
    expect(redeemResult.grant.id).toBe(result.grant.id);
    expect(redeemResult.grant.roleCode).toBe('OWNER');
    expect(redeemResult.grant.dormitoryId).toBe(testDormitoryId);
  });

  it('verifies STAFF role redemption and checks which dashboard endpoints succeed or fail', async () => {
    const { createApp } = await import('../../app.js');
    const request = (await import('supertest')).default;
    const app = createApp();

    const result = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'STAFF',
      `usr_${testOwnerUserId}`
    );

    const token = result.bearerUrl.split('#')[1];
    const redeemRes = await request(app)
      .post('/api/v1/staff-access/redeem')
      .send({ token });

    expect(redeemRes.status).toBe(200);
    const cookie = redeemRes.headers['set-cookie'];
    expect(cookie).toBeDefined();

    // Check auth/session
    const sessionRes = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookie);
    console.log('SESSION RES:', sessionRes.status, JSON.stringify(sessionRes.body, null, 2));

    const endpoints = [
      { name: 'rooms', url: '/api/v1/properties/rooms' },
      { name: 'buildings', url: '/api/v1/properties/buildings' },
      { name: 'billing-cycles', url: '/api/v1/billing-cycles' },
      { name: 'bills', url: '/api/v1/bills' },
      { name: 'maintenance', url: '/api/v1/maintenance' },
      { name: 'tenants', url: '/api/v1/tenants' },
      { name: 'contracts', url: '/api/v1/contracts' },
    ];

    for (const ep of endpoints) {
      const epRes = await request(app)
        .get(ep.url)
        .set('Cookie', cookie)
        .set('x-dormitory-id', testDormitoryId);
      console.log(`ENDPOINT [${ep.name}] (${ep.url}): status = ${epRes.status}, body =`, epRes.status !== 200 ? epRes.body : 'OK');
    }
  });

  it('SPM-07: issues canonical signed CSRF token on staff redemption and refreshes in GET /auth/session', async () => {
    const { createApp } = await import('../../app.js');
    const request = (await import('supertest')).default;
    const app = createApp();

    const result = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'STAFF',
      `usr_${testOwnerUserId}`
    );

    const token = result.bearerUrl.split('#')[1];
    const redeemRes = await request(app)
      .post('/api/v1/staff-access/redeem')
      .send({ token });

    expect(redeemRes.status).toBe(200);
    const csrfToken = redeemRes.body.data.csrfToken;
    expect(csrfToken).toBeDefined();
    // Signed token format: ${nonce}.${signature}
    expect(csrfToken.split('.')).toHaveLength(2);

    const cookies = redeemRes.headers['set-cookie'];
    const csrfCookieHeader = cookies.find((c: string) => c.startsWith('horplus_csrf='));
    expect(csrfCookieHeader).toBeDefined();
    expect(csrfCookieHeader).toContain(csrfToken);

    // Verify GET /auth/session also issues/refreshes canonical signed CSRF cookie
    const sessionRes = await request(app)
      .get('/api/v1/auth/session')
      .set('Cookie', cookies);

    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body.data.csrfToken).toBeDefined();
    expect(sessionRes.body.data.csrfToken.split('.')).toHaveLength(2);
    const sessionCookies = sessionRes.headers['set-cookie'];
    const refreshedCsrfCookie = sessionCookies.find((c: string) => c.startsWith('horplus_csrf='));
    expect(refreshedCsrfCookie).toBeDefined();
  });

  it('SPM-08: allows direct access staff (ag_user_...) to create maintenance request without UUID error, persisting provenance note', async () => {
    const { createApp } = await import('../../app.js');
    const request = (await import('supertest')).default;
    const app = createApp();

    const result = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'STAFF',
      `usr_${testOwnerUserId}`
    );

    const token = result.bearerUrl.split('#')[1];
    const redeemRes = await request(app)
      .post('/api/v1/staff-access/redeem')
      .send({ token });

    expect(redeemRes.status).toBe(200);
    const cookies = redeemRes.headers['set-cookie'];
    const csrfToken = redeemRes.body.data.csrfToken;

    // Direct access staff creates maintenance request
    const maintRes = await request(app)
      .post('/api/v1/maintenance-requests')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', testDormitoryId)
      .send({
        title: 'ก๊อกน้ำรั่ว ห้อง 101',
        description: 'มีน้ำหยดตลอดเวลาใต้ซิงค์ล้างจาน',
        priority: 'high',
        category: 'plumbing',
        note: 'ตรวจสอบเบื้องต้นแล้ว'
      });

    expect(maintRes.status).toBe(201);
    expect(maintRes.body.id).toBeDefined();
    expect(maintRes.body.title).toBe('ก๊อกน้ำรั่ว ห้อง 101');
    // Note must contain provenance tag
    expect(maintRes.body.note).toContain('[แจ้งโดย: ช่าง / แม่บ้าน]');
    expect(maintRes.body.note).toContain('ตรวจสอบเบื้องต้นแล้ว');

    // In DB, createdByUserId must be null (sanitized) to prevent Postgres UUID error
    const savedInDb = await prisma.maintenanceRequest.findUnique({
      where: { id: maintRes.body.id }
    });
    expect(savedInDb).not.toBeNull();
    expect(savedInDb?.createdByUserId).toBeNull();
    expect(savedInDb?.note).toContain('[แจ้งโดย: ช่าง / แม่บ้าน]');

    // Clean up
    await prisma.maintenanceRequest.delete({ where: { id: maintRes.body.id } });
  });

  it('SPM-01 & SPM-07: allows direct access staff to bulk save meter workspace with signed CSRF token without 403', async () => {
    const { createApp } = await import('../../app.js');
    const request = (await import('supertest')).default;
    const app = createApp();

    // Create building, room, and billing cycle
    const bldg = await prisma.building.create({
      data: {
        dormitoryId: testDormitoryId,
        name: 'Building 9',
      },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDormitoryId,
        buildingId: bldg.id,
        roomNumber: '901',
        normalizedRoomNumber: '901',
        monthlyRent: 4000,
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
        status: 'occupied',
        waterBillingType: 'per_unit',
        electricityBillingType: 'per_unit'
      }
    });

    const now = new Date();
    const cycleCode = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: testDormitoryId,
        name: 'รอบกันยายน 2026',
        cycleCode,
        periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
        periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        billingDate: new Date(now.getFullYear(), now.getMonth(), 25),
        dueDate: new Date(now.getFullYear(), now.getMonth() + 1, 5),
        status: 'active'
      }
    });

    const result = await grantService.createAccessGrant(
      testDormitoryId,
      null,
      'STAFF',
      `usr_${testOwnerUserId}`
    );

    const token = result.bearerUrl.split('#')[1];
    const redeemRes = await request(app)
      .post('/api/v1/staff-access/redeem')
      .send({ token });

    expect(redeemRes.status).toBe(200);
    const cookies = redeemRes.headers['set-cookie'];
    const csrfToken = redeemRes.body.data.csrfToken;

    // Staff performs bulk save on meters
    const bulkRes = await request(app)
      .post('/api/v1/meters/workspace/bulk')
      .set('Cookie', cookies)
      .set('x-csrf-token', csrfToken)
      .set('x-dormitory-id', testDormitoryId)
      .send({
        billingCycleId: cycle.id,
        rows: [
          {
            roomId: room.id,
            waterCurr: '120',
            waterPrev: '100',
            elecCurr: '250',
            elecPrev: '200',
            peopleCount: 2,
            otherFees: [{ description: 'ค่าทำความสะอาด', amount: '300.00' }]
          }
        ]
      });

    expect(bulkRes.status).toBe(200);
    expect(bulkRes.body.success).toBe(true);

    // Clean up
    await prisma.roomBillingCycleSnapshot.deleteMany({ where: { billingCycleId: cycle.id } });
    await prisma.meterReading.deleteMany({ where: { billingCycleId: cycle.id } });
    await prisma.billingCycle.delete({ where: { id: cycle.id } });
    await prisma.room.delete({ where: { id: room.id } });
    await prisma.building.delete({ where: { id: bldg.id } });
  });
});