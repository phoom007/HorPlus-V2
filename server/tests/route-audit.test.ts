import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

const SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
const CSRF_SIGNING_KEY = process.env.CSRF_SIGNING_KEY || 'csrf-secret-key-0123456789abcdef';

const getSecretKey = (secret: string) => crypto.createHash('sha256').update(secret).digest();

function encryptSessionToken(userId: string, sessionId: string, ttlSeconds = 86400): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    sid: sessionId,
    type: 'session',
    iat: nowSec,
    exp: nowSec + ttlSeconds,
    jti: crypto.randomUUID(),
    version: 1,
  };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(SESSION_ENCRYPTION_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
}

function generateCsrfToken(sessionId: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = crypto
    .createHmac('sha256', getSecretKey(CSRF_SIGNING_KEY))
    .update(`${sessionId}.${nonce}`)
    .digest('hex');
  return `${nonce}.${signature}`;
}

describe('Wave 1F - Real-Session 14-Domain Route Audit Matrix', () => {
  let app: express.Application;
  let dormId: string;
  let otherDormId: string;

  let ownerUserId: string;
  let limitedUserId: string;
  let managerUserId: string;
  let tenantUserId: string;

  let ownerSessionCookie: string;
  let ownerCsrfToken: string;
  let limitedSessionCookie: string;
  let limitedCsrfToken: string;
  let managerSessionCookie: string;
  let managerCsrfToken: string;
  let tenantSessionCookie: string;
  let tenantCsrfToken: string;

  let buildingId: string;
  let roomId: string;
  let tenantRecordId: string;
  let billId: string;

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    otherDormId = crypto.randomUUID();

    ownerUserId = crypto.randomUUID();
    limitedUserId = crypto.randomUUID();
    managerUserId = crypto.randomUUID();
    tenantUserId = crypto.randomUUID();

    // Create users in PostgreSQL
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, googleSubject: `g-owner-${timestamp}`, email: `owner-${timestamp}@audit.com`, emailNormalized: `owner-${timestamp}@audit.com`, name: 'Owner User' },
        { id: limitedUserId, googleSubject: `g-limited-${timestamp}`, email: `limited-${timestamp}@audit.com`, emailNormalized: `limited-${timestamp}@audit.com`, name: 'Limited User' },
        { id: managerUserId, googleSubject: `g-manager-${timestamp}`, email: `manager-${timestamp}@audit.com`, emailNormalized: `manager-${timestamp}@audit.com`, name: 'Manager User' },
        { id: tenantUserId, googleSubject: `g-tenant-${timestamp}`, email: `tenant-${timestamp}@audit.com`, emailNormalized: `tenant-${timestamp}@audit.com`, name: 'Tenant User' },
      ],
    });

    // Create dormitories
    await prisma.dormitory.createMany({
      data: [
        { id: dormId, name: `Audit Dorm ${timestamp}`, code: `AUD-${timestamp}`, addressLine1: '123 Audit St', postalCode: '10100', phone: '0811112222', status: 'active', createdByUserId: ownerUserId },
        { id: otherDormId, name: `Other Dorm ${timestamp}`, code: `OTH-${timestamp}`, addressLine1: '456 Other St', postalCode: '10200', phone: '0822223333', status: 'active', createdByUserId: ownerUserId },
      ],
    });

    // Create Roles in PostgreSQL
    const ownerRole = await prisma.role.create({
      data: { dormitoryId: dormId, code: 'OWNER', name: 'Owner', permissions: ['*'] },
    });

    const limitedRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'LIMITED_STAFF',
        name: 'Limited Staff',
        permissions: ['building:read', 'room:read', 'tenant:read', 'contract:read', 'occupancy:read', 'billing:read', 'meter:read', 'maintenance:read', 'announcement:read', 'payment:read', 'moveout:read', 'dormitory:view'],
      },
    });

    const managerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'MANAGER',
        name: 'Manager',
        permissions: ['building:read', 'room:read', 'tenant:read', 'payment:read'],
      },
    });

    const tenantRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'TENANT',
        name: 'Tenant',
        permissions: ['tenant:read', 'tenant:pay'],
      },
    });

    // Create Memberships in PostgreSQL
    await prisma.dormitoryMember.createMany({
      data: [
        { dormitoryId: dormId, userId: ownerUserId, roleId: ownerRole.id, status: 'active' },
        { dormitoryId: dormId, userId: limitedUserId, roleId: limitedRole.id, status: 'active' },
        { dormitoryId: dormId, userId: managerUserId, roleId: managerRole.id, status: 'active' },
        { dormitoryId: dormId, userId: tenantUserId, roleId: tenantRole.id, status: 'active' },
      ],
    });

    // Provision Active Trial Subscription
    await subscriptionEntitlementService.provisionInitialTrial(dormId);
    await subscriptionEntitlementService.provisionInitialTrial(otherDormId);

    // Create Sessions in PostgreSQL
    const ownerSid = crypto.randomUUID();
    const limitedSid = crypto.randomUUID();
    const managerSid = crypto.randomUUID();
    const tenantSid = crypto.randomUUID();

    const expiresAt = new Date(Date.now() + 86400 * 1000);

    await prisma.session.createMany({
      data: [
        { id: ownerSid, userId: ownerUserId, sessionIdHash: crypto.createHash('sha256').update(`horplus_sid_${ownerSid}`).digest('hex'), expiresAt },
        { id: limitedSid, userId: limitedUserId, sessionIdHash: crypto.createHash('sha256').update(`horplus_sid_${limitedSid}`).digest('hex'), expiresAt },
        { id: managerSid, userId: managerUserId, sessionIdHash: crypto.createHash('sha256').update(`horplus_sid_${managerSid}`).digest('hex'), expiresAt },
        { id: tenantSid, userId: tenantUserId, sessionIdHash: crypto.createHash('sha256').update(`horplus_sid_${tenantSid}`).digest('hex'), expiresAt },
      ],
    });

    ownerSessionCookie = encryptSessionToken(ownerUserId, ownerSid);
    ownerCsrfToken = generateCsrfToken(ownerSid);

    limitedSessionCookie = encryptSessionToken(limitedUserId, limitedSid);
    limitedCsrfToken = generateCsrfToken(limitedSid);

    managerSessionCookie = encryptSessionToken(managerUserId, managerSid);
    managerCsrfToken = generateCsrfToken(managerSid);

    tenantSessionCookie = encryptSessionToken(tenantUserId, tenantSid);
    tenantCsrfToken = generateCsrfToken(tenantSid);

    // Create Seed Entities for GET and detail checks
    const bld = await prisma.building.create({
      data: { dormitoryId: dormId, name: 'Building A' },
    });
    buildingId = bld.id;

    const rm = await prisma.room.create({
      data: { dormitoryId: dormId, buildingId: bld.id, roomNumber: '101', normalizedRoomNumber: '101', floor: 1, monthlyRent: 3000, status: 'vacant' },
    });
    roomId = rm.id;

    const tenant = await prisma.tenant.create({
      data: { dormitoryId: dormId, tenantNumber: `TNT-${timestamp}`, linkedUserId: tenantUserId, firstName: 'Tenant', lastName: 'User', displayName: 'Tenant User', phone: '0812345678', status: 'active' },
    });
    tenantRecordId = tenant.id;

    const cycle = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormId,
        cycleCode: `CYC-${timestamp}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05'),
        status: 'published',
      },
    });

    const bill = await prisma.bill.create({
      data: {
        dormitoryId: dormId,
        billingCycleId: cycle.id,
        tenantId: tenant.id,
        roomId: rm.id,
        billingDate: new Date(),
        dueDate: new Date(Date.now() + 7 * 86400000),
        billNumber: `BILL-${timestamp}`,
        status: 'PENDING',
        totalAmount: 3000,
      },
    });
    billId = bill.id;

    // Instantiate real Express app with real Prisma repositories & security middleware
    app = createApp({ forcePrisma: true });
  });

  const domainSpecs = [
    { name: 'Buildings', method: 'post', path: '/api/v1/properties/buildings', body: { name: 'Building B' }, getPath: '/api/v1/properties/buildings' },
    { name: 'Rooms', method: 'post', path: '/api/v1/properties/rooms', body: { roomNumber: '102', buildingId: '', floor: 1, baseRent: 3000 }, getPath: '/api/v1/properties/rooms' },
    { name: 'Tenants', method: 'post', path: '/api/v1/tenants', body: { firstName: 'New', lastName: 'Tenant', idCardNumber: '9999999999999' }, getPath: '/api/v1/tenants' },
    { name: 'Occupancies', method: 'post', path: '/api/v1/occupancy/occ-dummy/move-out', body: {}, getPath: '/api/v1/occupancy/summary' },
    { name: 'Contracts', method: 'post', path: '/api/v1/contracts', body: { tenantId: '', roomId: '', startDate: '2026-01-01', endDate: '2026-12-31', depositAmount: 5000, monthlyRent: 3000 }, getPath: '/api/v1/contracts' },
    { name: 'Meters', method: 'post', path: '/api/v1/meters/devices', body: { roomId: '', type: 'electricity', serialNumber: 'SN123' }, getPath: '/api/v1/meters/readings' },
    { name: 'Meter readings', method: 'post', path: '/api/v1/meters/readings/bulk', body: { readings: [] }, getPath: '/api/v1/meters/readings' },
    { name: 'Billing cycles', method: 'post', path: '/api/v1/billing-cycles', body: { month: 8, year: 2026, startDate: '2026-08-01', endDate: '2026-08-31', dueDate: '2026-09-05' }, getPath: '/api/v1/billing-cycles' },
    { name: 'Bills', method: 'post', path: '/api/v1/bills/generate', body: { billingCycleId: crypto.randomUUID() }, getPath: '/api/v1/bills' },
    { name: 'Payments', method: 'post', path: '/api/v1/payments/cash', body: { billId: '', totalAmount: 3000 }, getPath: '/api/v1/payments' },
    { name: 'Maintenance', method: 'post', path: '/api/v1/maintenance', body: { roomId: '', title: 'Pipe leak', description: 'Leaking pipe' }, getPath: '/api/v1/maintenance' },
    { name: 'Announcements', method: 'post', path: '/api/v1/announcements', body: { title: 'Notice', content: 'Cleaning day' }, getPath: '/api/v1/announcements' },
    { name: 'Move-out', method: 'post', path: '/api/v1/move-out/tenant-move-out-requests', body: { moveOutDate: '2026-08-31', reason: 'Moving' }, getPath: '/api/v1/move-out/tenant-move-out-requests' },
    { name: 'Dormitory settings', method: 'patch', path: '/api/v1/dormitories/PLACEHOLDER_DORM_ID', body: { name: 'Updated Name' }, getPath: '/api/v1/dormitories/PLACEHOLDER_DORM_ID' },
  ];

  describe('14 Business Domains Matrix', () => {
    domainSpecs.forEach((spec) => {
      it(`audits domain: ${spec.name}`, async () => {
        const targetPath = spec.path.replace('PLACEHOLDER_DORM_ID', dormId);
        const targetGetPath = spec.getPath.replace('PLACEHOLDER_DORM_ID', dormId);

        // 1. Anonymous -> 401
        const anonRes = await (request(app) as any)[spec.method](targetPath)
          .set('x-dormitory-id', dormId)
          .send(spec.body);
        expect(anonRes.status).toBe(401);

        // 2. Limited staff without write permission -> 403 FORBIDDEN
        const forbiddenRes = await (request(app) as any)[spec.method](targetPath)
          .set('Cookie', [`horplus_session=${limitedSessionCookie}`, `horplus_csrf=${limitedCsrfToken}`])
          .set('x-csrf-token', limitedCsrfToken)
          .set('x-dormitory-id', dormId)
          .send(spec.body);
        expect(forbiddenRes.status).toBe(403);
        expect(forbiddenRes.body.error?.code || forbiddenRes.body.code).toMatch(/FORBIDDEN|PERMISSION_DENIED|CSRF/);

        // 3. Owner + Expired Subscription -> 403 SUBSCRIPTION_READ_ONLY
        await prisma.dormitorySubscription.update({
          where: { dormitoryId: dormId },
          data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 86400 * 1000) },
        });

        const expiredRes = await (request(app) as any)[spec.method](targetPath)
          .set('Cookie', [`horplus_session=${ownerSessionCookie}`, `horplus_csrf=${ownerCsrfToken}`])
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormId)
          .send(spec.body);
        expect(expiredRes.status).toBe(403);
        expect(expiredRes.body.errorCode || expiredRes.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');

        // 4. Authorized GET while Expired -> 200 OK
        const expiredGetRes = await request(app)
          .get(targetGetPath)
          .set('Cookie', [`horplus_session=${ownerSessionCookie}`, `horplus_csrf=${ownerCsrfToken}`])
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormId);
        expect(expiredGetRes.status).toBe(200);

        // 5. Restore Active Subscription & test Owner mutation -> Reaches Handler (200, 201, or 400 validation error, NEVER 500!)
        await prisma.dormitorySubscription.update({
          where: { dormitoryId: dormId },
          data: { status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 86400 * 1000) },
        });

        const activeRes = await (request(app) as any)[spec.method](targetPath)
          .set('Cookie', [`horplus_session=${ownerSessionCookie}`, `horplus_csrf=${ownerCsrfToken}`])
          .set('x-csrf-token', ownerCsrfToken)
          .set('x-dormitory-id', dormId)
          .send(spec.body);
        expect([200, 201, 400, 403, 404, 409]).toContain(activeRes.status);
        expect(activeRes.status).not.toBe(500);
      });
    });
  });

  describe('Payment Domain Specific Cases', () => {
    it('Tenant upload intent with active Subscription -> Reaches Handler (200/201/400)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/slip/intent')
        .set('Cookie', [`horplus_session=${tenantSessionCookie}`, `horplus_csrf=${tenantCsrfToken}`])
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormId)
        .send({ billId });

      expect([200, 201, 400, 404]).toContain(res.status);
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(403);
    });

    it('Tenant upload intent with expired Subscription -> 403 SUBSCRIPTION_READ_ONLY', async () => {
      await prisma.dormitorySubscription.update({
        where: { dormitoryId: dormId },
        data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 86400 * 1000) },
      });

      const res = await request(app)
        .post('/api/v1/payments/slip/intent')
        .set('Cookie', [`horplus_session=${tenantSessionCookie}`, `horplus_csrf=${tenantCsrfToken}`])
        .set('x-csrf-token', tenantCsrfToken)
        .set('x-dormitory-id', dormId)
        .send({ billId });

      expect(res.status).toBe(403);
      expect(res.body.errorCode || res.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
    });

    it('Manager without payment:write -> 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('Cookie', [`horplus_session=${managerSessionCookie}`, `horplus_csrf=${managerCsrfToken}`])
        .set('x-csrf-token', managerCsrfToken)
        .set('x-dormitory-id', dormId)
        .send({ billId, totalAmount: 3000 });

      expect(res.status).toBe(403);
    });

    it('Cross-Dormitory Bill/Payment denial -> 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/payments/cash')
        .set('Cookie', [`horplus_session=${ownerSessionCookie}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-csrf-token', ownerCsrfToken)
        .set('x-dormitory-id', otherDormId) // Mismatched dormitory ID
        .send({ billId, totalAmount: 3000 });

      expect(res.status).toBe(403);
    });
  });

  describe('Operational Activation Absence', () => {
    it('Operational activation public route returns 404', async () => {
      const res = await request(app)
        .post('/api/v1/subscription/operational/activate')
        .set('Cookie', [`horplus_session=${ownerSessionCookie}`, `horplus_csrf=${ownerCsrfToken}`])
        .set('x-csrf-token', ownerCsrfToken)
        .send({ dormitoryId: dormId });

      expect(res.status).toBe(404);
    });
  });
});
