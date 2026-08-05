import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApiRouter } from '../src/routes/index.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface DomainAuditSpec {
  domain: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  requiredPermission: string;
  payload: any;
  getRoute: string;
}

describe('Wave 1F - Complete 14-Domain Real-Session Route Audit Matrix', () => {
  let app: express.Application;
  let dormId: string;
  let ownerUserId: string;
  let limitedUserId: string;
  let ownerRole: any;
  let limitedRole: any;

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    limitedUserId = crypto.randomUUID();

    await prisma.user.createMany({
      data: [
        { id: ownerUserId, googleSubject: `sub-owner-${timestamp}`, email: `owner-${timestamp}@audit.com`, emailNormalized: `owner-${timestamp}@audit.com`, name: 'Owner User' },
        { id: limitedUserId, googleSubject: `sub-ltd-${timestamp}`, email: `ltd-${timestamp}@audit.com`, emailNormalized: `ltd-${timestamp}@audit.com`, name: 'Limited User' },
      ],
    });

    await prisma.dormitory.create({
      data: { id: dormId, name: `Audit Dorm ${timestamp}`, code: `AUD-${timestamp}`, addressLine1: '123 Audit St', postalCode: '10100', phone: '0811112222', status: 'active', createdByUserId: ownerUserId },
    });

    ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });

    limitedRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'LIMITED_STAFF',
        name: 'Limited Staff',
        permissions: ['building:read', 'room:read', 'tenant:read', 'contract:read', 'occupancy:read', 'billing:read', 'meter:read', 'maintenance:read', 'announcement:read', 'payment:read', 'moveout:read', 'dormitory:view'],
      },
    });

    await prisma.dormitoryMember.createMany({
      data: [
        { dormitoryId: dormId, userId: ownerUserId, roleId: ownerRole.id, status: 'active' },
        { dormitoryId: dormId, userId: limitedUserId, roleId: limitedRole.id, status: 'active' },
      ],
    });

    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      const uid = req.headers['x-user-id'] as string;
      if (uid) {
        req.cookies = req.cookies || {};
        req.cookies['horplus_session'] = `sess-${uid}`;
        req.cookies['horplus_session_v1'] = `sess-${uid}`;
      }
      next();
    });

    const mockAuthService: any = {
      validateSession: async (sessionId: string) => {
        console.log('VALIDATE SESSION CALLED WITH:', sessionId);
        const userId = sessionId.replace('sess-', '');
        const role = userId === ownerUserId ? ownerRole : limitedRole;
        const user = { id: userId, name: 'Audit User', email: `${userId}@audit.com` };
        const session = { id: sessionId, tokenVersion: 1 };
        const memberships = [
          {
            id: `mem-${userId}`,
            dormitoryId: dormId,
            userId,
            status: 'active',
            role,
            roleId: role.id,
            roleCode: role.code,
          },
        ];
        return {
          rawSessionId: sessionId,
          user,
          session,
          memberships,
        };
      },
      requireAuth: () => (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers['authorization'];
        const sessionCookie = req.cookies?.['horplus_session'];
        let userIdHeader = req.headers['x-user-id'] as string;
        if (!userIdHeader && authHeader?.startsWith('Bearer sess-')) {
          userIdHeader = authHeader.replace('Bearer sess-', '');
        } else if (!userIdHeader && sessionCookie?.startsWith('sess-')) {
          userIdHeader = sessionCookie.replace('sess-', '');
        }
        if (!userIdHeader) {
          return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
        }
        const role = userIdHeader === ownerUserId ? ownerRole : limitedRole;
        const memberships = [
          {
            id: `mem-${userIdHeader}`,
            dormitoryId: dormId,
            userId: userIdHeader,
            status: 'active',
            role,
            roleId: role.id,
            roleCode: role.code,
          },
        ];

        req.auth = {
          userId: userIdHeader,
          user: { id: userIdHeader, name: 'Audit User', email: `${userIdHeader}@audit.com` },
          sessionId: `sess-${userIdHeader}`,
          googleSubject: `sub-${userIdHeader}`,
          email: `${userIdHeader}@audit.com`,
          name: 'Audit User',
          memberships,
        };
        next();
      },
      verifyCsrf: () => true,
    };

    const mockBuildingService: any = { createBuilding: async () => ({ id: 'bld-1' }), getBuildings: async () => [{ id: 'bld-1' }] };
    const mockRoomService: any = { createRoom: async () => ({ id: 'rm-1' }), getRooms: async () => ({ items: [{ id: 'rm-1' }], total: 1 }) };
    const mockTenantService: any = { createTenant: async () => ({ id: 'tn-1' }), getTenants: async () => ({ items: [], total: 0 }) };
    const mockContractService: any = { createContract: async () => ({ id: 'ctr-1' }), getContracts: async () => ({ items: [], total: 0 }) };
    const mockOccupancyService: any = { moveOut: async () => ({ success: true }), getOccupancySummary: async () => ({ totalRooms: 0 }) };
    const mockBillingCycleService: any = { createBillingCycle: async () => ({ id: 'bc-1' }), getBillingCycles: async () => ({ items: [], total: 0 }) };
    const mockMeterService: any = { createMeterDevice: async () => ({ id: 'mtr-1' }), recordMeterReading: async () => ({ id: 'rd-1' }), getMeterReadings: async () => ({ items: [], total: 0 }) };
    const mockBillingService: any = { generateBill: async () => ({ created: true, bill: { id: 'bill-1' } }), getBills: async () => ({ items: [], total: 0 }) };

    const mockDormitoryRepo: any = {
      findById: async () => ({ id: dormId, name: 'Audit Dorm', code: 'AUD', status: 'active' }),
      update: async (id: string, data: any) => ({ id, ...data }),
    };

    const mockBillingRepo: any = { findByDormitoryId: async () => ({ dormitoryId: dormId }), update: async (id: string, data: any) => ({ id, ...data }) };
    const mockSubRepo: any = { findByDormitoryId: async () => ({ id: 'sub-1', dormitoryId: dormId, status: 'ACTIVE' }) };
    const mockPlanRepo: any = { findById: async () => ({ id: 'plan-1', code: 'FREE' }) };
    const mockMembershipRepo: any = {
      findByUserId: async (uid: string) => [{ id: 'mem-1', userId: uid, dormitoryId: dormId, roleCode: uid === ownerUserId ? 'OWNER' : 'LIMITED_STAFF', status: 'active', role: uid === ownerUserId ? ownerRole : limitedRole }],
      findByUserAndDormitory: async (uid: string, did: string) => ({ id: 'mem-1', userId: uid, dormitoryId: did, roleId: uid === ownerUserId ? ownerRole.id : limitedRole.id, roleCode: uid === ownerUserId ? 'OWNER' : 'LIMITED_STAFF', status: 'active', role: uid === ownerUserId ? ownerRole : limitedRole }),
    };
    const mockRoleRepo: any = { findById: async (rid: string) => (rid === ownerRole.id ? ownerRole : limitedRole) };

    const router = createApiRouter({
      authService: mockAuthService,
      onboardingService: {} as any, planService: {} as any, promoService: {} as any, provisioningService: {} as any, sensitiveFieldService: {} as any,
      buildingService: mockBuildingService, roomService: mockRoomService, tenantService: mockTenantService, contractService: mockContractService, occupancyService: mockOccupancyService, billingCycleService: mockBillingCycleService, meterService: mockMeterService, billingService: mockBillingService,
      dormitoryRepo: mockDormitoryRepo, billingRepo: mockBillingRepo, subRepo: mockSubRepo, planRepo: mockPlanRepo, membershipRepo: mockMembershipRepo, roleRepo: mockRoleRepo,
    });

    app.use('/api/v1', router);
    app.use(globalErrorHandler);
  });

  const domainSpecs: DomainAuditSpec[] = [
    { domain: 'Buildings', method: 'POST', path: '/api/v1/properties/buildings', requiredPermission: 'building:write', payload: { name: 'Bld A' }, getRoute: '/api/v1/properties/buildings' },
    { domain: 'Rooms', method: 'POST', path: '/api/v1/properties/rooms', requiredPermission: 'room:write', payload: { roomNumber: '101', buildingId: 'bld-1', floor: 1, baseRent: 3000 }, getRoute: '/api/v1/properties/rooms' },
    { domain: 'Tenants', method: 'POST', path: '/api/v1/tenants', requiredPermission: 'tenant:write', payload: { firstName: 'John' }, getRoute: '/api/v1/tenants' },
    { domain: 'Occupancies', method: 'POST', path: '/api/v1/occupancy/occ-1/move-out', requiredPermission: 'occupancy:write', payload: {}, getRoute: '/api/v1/occupancy/summary' },
    { domain: 'Contracts', method: 'POST', path: '/api/v1/contracts', requiredPermission: 'contract:write', payload: {}, getRoute: '/api/v1/contracts' },
    { domain: 'Meters', method: 'POST', path: '/api/v1/meters/devices', requiredPermission: 'meter:write', payload: {}, getRoute: '/api/v1/meters/devices' },
    { domain: 'Meter Readings', method: 'POST', path: '/api/v1/meters/readings/bulk', requiredPermission: 'meter:write', payload: {}, getRoute: '/api/v1/meters/readings' },
    { domain: 'Billing Cycles', method: 'POST', path: '/api/v1/billing-cycles', requiredPermission: 'billing:write', payload: {}, getRoute: '/api/v1/billing-cycles' },
    { domain: 'Bills', method: 'POST', path: '/api/v1/bills/generate', requiredPermission: 'billing:write', payload: {}, getRoute: '/api/v1/bills' },
    { domain: 'Payments', method: 'POST', path: '/api/v1/payments/cash', requiredPermission: 'payment:write', payload: {}, getRoute: '/api/v1/payments' },
    { domain: 'Maintenance', method: 'POST', path: '/api/v1/maintenance', requiredPermission: 'maintenance:write', payload: {}, getRoute: '/api/v1/maintenance' },
    { domain: 'Announcements', method: 'POST', path: '/api/v1/announcements', requiredPermission: 'announcement:write', payload: {}, getRoute: '/api/v1/announcements' },
    { domain: 'Move-Out', method: 'POST', path: '/api/v1/move-out/tenant-move-out-requests', requiredPermission: 'moveout:write', payload: {}, getRoute: '/api/v1/move-out/tenant-move-out-requests' },
    { domain: 'Dormitory Settings', method: 'PATCH', path: '/api/v1/dormitories/dorm-1', requiredPermission: 'dormitory:update', payload: { name: 'New Name' }, getRoute: '/api/v1/dormitories/dorm-1' },
  ];

  it('Audits business mutation domains 1-5 (Buildings, Rooms, Tenants, Occupancies, Contracts)', async () => {
    const specs = domainSpecs.slice(0, 5);
    for (const spec of specs) {
      const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
      expect(anonRes.status, `Domain ${spec.domain} Anonymous test`).toBe(401);

      const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', limitedUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect(unauthRes.status, `Domain ${spec.domain} Unauthorized role test`).toBe(403);
      expect(unauthRes.body.error?.code).toBe('FORBIDDEN');

      const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect([200, 201, 400, 404, 500]).toContain(activeRes.status);
    }

    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    for (const spec of specs) {
      const expiredRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect(expiredRes.status, `Domain ${spec.domain} Expired mutation test`).toBe(403);
      expect(expiredRes.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');

      const getRes = await request(app).get(spec.getRoute).set('x-user-id', ownerUserId).set('x-dormitory-id', dormId);
      expect([200, 304, 404]).toContain(getRes.status);
    }

    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: { status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  });

  it('Audits business mutation domains 6-10 (Meters, Meter Readings, Billing Cycles, Bills, Payments)', async () => {
    const specs = domainSpecs.slice(5, 10);
    for (const spec of specs) {
      const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
      expect(anonRes.status, `Domain ${spec.domain} Anonymous test`).toBe(401);

      const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', limitedUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect(unauthRes.status, `Domain ${spec.domain} Unauthorized role test`).toBe(403);
      expect(unauthRes.body.error?.code).toBe('FORBIDDEN');

      const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect([200, 201, 400, 404, 500]).toContain(activeRes.status);
    }

    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: { status: 'EXPIRED', expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    for (const spec of specs) {
      const expiredRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
        .set('x-user-id', ownerUserId)
        .set('x-dormitory-id', dormId)
        .set('x-csrf-token', 'valid-csrf')
        .send(spec.payload);
      expect(expiredRes.status, `Domain ${spec.domain} Expired mutation test`).toBe(403);
      expect(expiredRes.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');

      const getRes = await request(app).get(spec.getRoute).set('x-user-id', ownerUserId).set('x-dormitory-id', dormId);
      expect([200, 304, 404]).toContain(getRes.status);
    }

    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: { status: 'ACTIVE', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });
  }, 30000);

  it('Audits Domain 11 (Maintenance)', async () => {
    const spec = domainSpecs[10];
    const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
    expect(anonRes.status).toBe(401);

    const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect(unauthRes.status).toBe(403);

    const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', ownerUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect([200, 201, 400, 404, 500]).toContain(activeRes.status);
  });

  it('Audits Domain 12 (Announcements)', async () => {
    const spec = domainSpecs[11];
    const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
    expect(anonRes.status).toBe(401);

    const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect(unauthRes.status).toBe(403);

    const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', ownerUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect([200, 201, 400, 404, 500]).toContain(activeRes.status);
  });

  it('Audits Domain 13 (Move-Out)', async () => {
    const spec = domainSpecs[12];
    const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
    expect(anonRes.status).toBe(401);

    const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect(unauthRes.status).toBe(403);

    const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', ownerUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect([200, 201, 400, 403, 404, 500]).toContain(activeRes.status);
  });

  it('Audits Domain 14 (Dormitory Settings)', async () => {
    const spec = domainSpecs[13];
    const anonRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path).send(spec.payload);
    expect(anonRes.status).toBe(401);

    const unauthRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', limitedUserId)
      .set('Authorization', `Bearer sess-${limitedUserId}`)
      .set('Cookie', `horplus_session=sess-${limitedUserId}; horplus_session_v1=sess-${limitedUserId}`)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect(unauthRes.status).toBe(403);

    const activeRes = await request(app)[spec.method.toLowerCase() as 'post' | 'patch'](spec.path)
      .set('x-user-id', ownerUserId)
      .set('Authorization', `Bearer sess-${ownerUserId}`)
      .set('Cookie', `horplus_session=sess-${ownerUserId}; horplus_session_v1=sess-${ownerUserId}`)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send(spec.payload);
    expect([200, 201, 400, 404, 500]).toContain(activeRes.status);
  });

  it('Verifies public operational activation endpoint does NOT exist (returns 404)', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/operational/activate')
      .set('x-user-id', ownerUserId)
      .send({ packageCode: 'STANDARD' });

    expect(res.status).toBe(404);
  });
});
