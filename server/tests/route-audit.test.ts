import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApiRouter } from '../src/routes/index.js';
import { globalErrorHandler } from '../src/middleware/error-handler.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Wave 1F - Real Supertest Express Route Audit Matrix Test', () => {
  let app: express.Application;
  let dormId: string;
  let ownerUserId: string;
  let limitedUserId: string;

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    limitedUserId = crypto.randomUUID();

    // Create owner and limited user
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, googleSubject: `sub-owner-${timestamp}`, email: `owner-${timestamp}@audit.com`, emailNormalized: `owner-${timestamp}@audit.com`, name: 'Owner User' },
        { id: limitedUserId, googleSubject: `sub-ltd-${timestamp}`, email: `ltd-${timestamp}@audit.com`, emailNormalized: `ltd-${timestamp}@audit.com`, name: 'Limited User' },
      ],
    });

    await prisma.dormitory.create({
      data: { id: dormId, name: `Audit Dorm ${timestamp}`, code: `AUD-${timestamp}`, addressLine1: '123 Audit St', postalCode: '10100', phone: '0811112222', status: 'active', createdByUserId: ownerUserId },
    });

    // Create OWNER role with all permissions
    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['building:read', 'building:write', 'room:read', 'room:write', 'tenant:read', 'tenant:write', 'contract:read', 'contract:write', 'occupancy:read', 'occupancy:write', 'billing:read', 'billing:write', 'meter:read', 'meter:write', 'maintenance:read', 'maintenance:write', 'announcement:read', 'announcement:write', 'payment:read', 'payment:write', 'moveout:read', 'moveout:write', 'dormitory:view', 'dormitory:update'],
      },
    });

    // Create LIMITED role with read-only permissions (no write permissions)
    const limitedRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        code: 'LIMITED_STAFF',
        name: 'Limited Staff',
        permissions: ['building:read', 'room:read', 'tenant:read', 'contract:read', 'occupancy:read', 'billing:read', 'meter:read', 'maintenance:read', 'announcement:read', 'payment:read', 'moveout:read', 'dormitory:view'],
      },
    });

    // Create memberships
    await prisma.dormitoryMember.createMany({
      data: [
        { dormitoryId: dormId, userId: ownerUserId, roleId: ownerRole.id, status: 'active' },
        { dormitoryId: dormId, userId: limitedUserId, roleId: limitedRole.id, status: 'active' },
      ],
    });

    // Provision Active Free Trial subscription for the dormitory via authoritative service
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // Set up Express App with real routers & mock auth middleware
    app = express();
    app.use(express.json());

    // Mock session middleware based on x-user-id header
    const mockAuthService: any = {
      requireAuth: () => (req: Request, res: Response, next: NextFunction) => {
        const userIdHeader = (req.headers['x-user-id'] as string) || ownerUserId;
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

    const mockBuildingService: any = {
      createBuilding: async () => ({ id: 'bld-1', name: 'Building A' }),
      getBuildings: async () => [{ id: 'bld-1', name: 'Building A' }],
    };

    const mockRoomService: any = {
      createRoom: async () => ({ id: 'rm-1', roomNumber: '101' }),
      getRooms: async () => ({ items: [{ id: 'rm-1', roomNumber: '101' }], total: 1 }),
    };

    const mockTenantService: any = {
      createTenant: async () => ({ id: 'tn-1', firstName: 'John' }),
      getTenants: async () => ({ items: [], total: 0 }),
    };

    const mockContractService: any = {
      createContract: async () => ({ id: 'ctr-1' }),
      getContracts: async () => ({ items: [], total: 0 }),
    };

    const mockOccupancyService: any = {
      moveOut: async () => ({ success: true }),
      getOccupancySummary: async () => ({ totalRooms: 0 }),
    };

    const mockBillingCycleService: any = {
      createBillingCycle: async () => ({ id: 'bc-1' }),
      getBillingCycles: async () => ({ items: [], total: 0 }),
    };

    const mockMeterService: any = {
      createMeterDevice: async () => ({ id: 'mtr-1' }),
      getMeterReadings: async () => ({ items: [], total: 0 }),
    };

    const mockBillingService: any = {
      generateBill: async () => ({ created: true, bill: { id: 'bill-1' }, items: [] }),
      getBills: async () => ({ items: [], total: 0 }),
    };

    const mockDormitoryRepo: any = {
      findById: async () => ({ id: dormId, name: 'Audit Dorm', code: 'AUD', status: 'active' }),
      update: async (id: string, data: any) => ({ id, ...data }),
    };

    const mockBillingRepo: any = {
      findByDormitoryId: async () => ({ dormitoryId: dormId }),
      update: async (id: string, data: any) => ({ id, ...data }),
    };

    const mockSubRepo: any = {
      findByDormitoryId: async () => ({ id: 'sub-1', dormitoryId: dormId, status: 'ACTIVE' }),
    };

    const mockPlanRepo: any = {
      findById: async () => ({ id: 'plan-1', code: 'FREE' }),
    };

    const mockMembershipRepo: any = {
      findByUserId: async (uid: string) => [
        { id: 'mem-1', userId: uid, dormitoryId: dormId, roleCode: uid === ownerUserId ? 'OWNER' : 'LIMITED_STAFF', status: 'active', role: uid === ownerUserId ? ownerRole : limitedRole },
      ],
    };

    const mockRoleRepo: any = {
      findById: async (rid: string) => (rid === ownerRole.id ? ownerRole : limitedRole),
    };

    const router = createApiRouter({
      authService: mockAuthService,
      onboardingService: {} as any,
      planService: {} as any,
      promoService: {} as any,
      provisioningService: {} as any,
      sensitiveFieldService: {} as any,
      buildingService: mockBuildingService,
      roomService: mockRoomService,
      tenantService: mockTenantService,
      contractService: mockContractService,
      occupancyService: mockOccupancyService,
      billingCycleService: mockBillingCycleService,
      meterService: mockMeterService,
      billingService: mockBillingService,
      dormitoryRepo: mockDormitoryRepo,
      billingRepo: mockBillingRepo,
      subRepo: mockSubRepo,
      planRepo: mockPlanRepo,
      membershipRepo: mockMembershipRepo,
      roleRepo: mockRoleRepo,
    });

    app.use('/api/v1', router);
    app.use(globalErrorHandler);
  });

  it('1. Returns 403 FORBIDDEN when authenticated user lacks domain write permission', async () => {
    // Limited user lacks room:write and tenant:write
    const roomRes = await request(app)
      .post('/api/v1/properties/rooms')
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send({ roomNumber: '102', buildingId: 'bld-1', floor: 1, baseRent: 3500 });

    expect(roomRes.status).toBe(403);
    expect(roomRes.body.error?.code).toBe('FORBIDDEN');

    const tenantRes = await request(app)
      .post('/api/v1/tenants')
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send({ firstName: 'Jane', lastName: 'Doe', phone: '0812345678', idCardNumber: '1234567890123' });

    expect(tenantRes.status).toBe(403);
    expect(tenantRes.body.error?.code).toBe('FORBIDDEN');
  });

  it('2. Returns 403 SUBSCRIPTION_READ_ONLY when subscription is expired even with valid write permission', async () => {
    // Expire the subscription in DB
    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: {
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    // Owner user has room:write permission, but subscription is EXPIRED
    const roomRes = await request(app)
      .post('/api/v1/properties/rooms')
      .set('x-user-id', ownerUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send({ roomNumber: '103', buildingId: 'bld-1', floor: 1, baseRent: 3500 });

    expect(roomRes.status).toBe(403);
    expect(roomRes.body.error?.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('3. Allows 200/201 when subscription is active and user has valid write permission', async () => {
    // Owner user has building:write permission and subscription is ACTIVE
    const bldRes = await request(app)
      .post('/api/v1/properties/buildings')
      .set('x-user-id', ownerUserId)
      .set('x-dormitory-id', dormId)
      .set('x-csrf-token', 'valid-csrf')
      .send({ name: 'Building B', floorCount: 4 });

    expect([200, 201]).toContain(bldRes.status);
    expect(bldRes.body.data).toBeDefined();
  });

  it('4. GET endpoints remain accessible (200) even when subscription is expired or user lacks write permission', async () => {
    // Expire subscription
    await prisma.dormitorySubscription.updateMany({
      where: { dormitoryId: dormId },
      data: {
        status: 'EXPIRED',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });

    // Limited user (no write permission) calls GET /rooms with expired subscription
    const getRes = await request(app)
      .get('/api/v1/properties/rooms')
      .set('x-user-id', limitedUserId)
      .set('x-dormitory-id', dormId);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toBeDefined();
  });

  it('5. Verifies public operational activation endpoint does NOT exist (returns 404)', async () => {
    const res = await request(app)
      .post('/api/v1/subscription/operational/activate')
      .set('x-user-id', ownerUserId)
      .send({ packageCode: 'STANDARD' });

    expect(res.status).toBe(404);
  });
});
