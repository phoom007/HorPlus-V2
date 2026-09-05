import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Express, Router } from 'express';
import request from '../../server/node_modules/supertest/index.js';
import fs from 'fs';
import path from 'path';
import { getEnv, resetCachedEnv } from '../../server/src/config/env.js';
import { cookieParserMiddleware } from '../../server/src/middleware/cookie-parser.middleware.js';
import { requestIdMiddleware } from '../../server/src/middleware/request-id.js';
import { resolveDormitoryContextMiddleware } from '../../server/src/middleware/permission.js';
import { resolveAuthoritativeDormitoryContext } from '../../server/src/middleware/dormitory-context.js';
import { createRequireActiveDormitoryMiddleware } from '../../server/src/middleware/require-dormitory.js';
import { createTenantRouter } from '../../server/src/routes/tenant.routes.js';
import { AuthenticationService } from '../../server/src/services/auth.service.js';
import { TenantService } from '../../server/src/services/tenant.service.js';
import { SensitiveFieldService } from '../../server/src/services/sensitive-field.service.js';
import { InMemoryUserRepository } from '../../server/src/db/repositories/user.repository.js';
import { InMemorySessionRepository } from '../../server/src/db/repositories/session.repository.js';
import { InMemoryMembershipRepository } from '../../server/src/db/repositories/membership.repository.js';
import { InMemoryRoleRepository } from '../../server/src/db/repositories/role.repository.js';
import { InMemoryTenantRepository, PrismaTenantRepository } from '../../server/src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../server/src/db/repositories/contract.repository.js';
import { globalErrorHandler } from '../../server/src/middleware/error-handler.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { localStorageProvider } from '../../server/src/services/local-storage.service.js';

if (typeof localStorage === 'undefined') {
  let store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
}

describe('TENANT PHASE 3 STEP 3C.1E: Atomic Profile Save, Document Security & Dorm Context', () => {
  const dormAId = '10000000-0000-0000-0000-000000000001';
  const dormBId = '20000000-0000-0000-0000-000000000002';

  let app: Express;
  let authService: AuthenticationService;
  let tenantService: TenantService;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let membershipRepo: InMemoryMembershipRepository;
  let roleRepo: InMemoryRoleRepository;
  let tenantRepo: InMemoryTenantRepository;
  let contractRepo: InMemoryContractRepository;
  let sensitiveFieldService: SensitiveFieldService;

  let ownerUserId: string;
  let multiDormOwnerUserId: string;
  let ownerAuth: any;
  let multiDormOwnerAuth: any;
  let staffUserId: string;
  let staffAuth: any;
  let tenantUserId: string;
  let tenantAuth: any;
  let managerUserId: string;
  let managerAuth: any;

  let testTenantAId: string;
  let testTenantBId: string;

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
    process.env.REPOSITORY_MODE = 'in-memory';
    resetCachedEnv();

    const env = getEnv();
    userRepo = new InMemoryUserRepository();
    sessionRepo = new InMemorySessionRepository();
    membershipRepo = new InMemoryMembershipRepository();
    roleRepo = new InMemoryRoleRepository();
    tenantRepo = new InMemoryTenantRepository();
    contractRepo = new InMemoryContractRepository();

    const mockAuditService: any = {
      log: async () => {},
      logAction: async () => {},
      logSecurityEvent: async () => {},
    };

    sensitiveFieldService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEY_VERSION);
    tenantService = new TenantService(tenantRepo, contractRepo, sensitiveFieldService, mockAuditService);

    authService = new AuthenticationService(
      env,
      {} as any,
      userRepo,
      sessionRepo,
      membershipRepo,
      roleRepo,
      mockAuditService
    );

    // 1. Create single-dorm owner (Dorm A only)
    const ownerUser = await userRepo.upsertFromGoogle({
      email: 'owner@dorma.com',
      name: 'Dorm A Owner',
      googleSubject: 'g-sub-owner-a-3c1e',
    });
    ownerUserId = ownerUser.id;

    await membershipRepo.addMembership({
      userId: ownerUserId,
      dormitoryId: dormAId,
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    // 2. Create multi-dorm owner (Dorm A and Dorm B)
    const multiOwnerUser = await userRepo.upsertFromGoogle({
      email: 'multi-owner@dormab.com',
      name: 'Multi Dorm Owner',
      googleSubject: 'g-sub-multi-owner-ab',
    });
    multiDormOwnerUserId = multiOwnerUser.id;

    await membershipRepo.addMembership({
      userId: multiDormOwnerUserId,
      dormitoryId: dormAId,
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    await membershipRepo.addMembership({
      userId: multiDormOwnerUserId,
      dormitoryId: dormBId,
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    ownerAuth = await authService.authenticateTestUser(ownerUserId);
    multiDormOwnerAuth = await authService.authenticateTestUser(multiDormOwnerUserId);

    // 3. Create STAFF user (Dorm A)
    const staffUser = await userRepo.upsertFromGoogle({
      email: 'staff@dorma.com',
      name: 'Dorm A Staff',
      googleSubject: 'g-sub-staff-a',
    });
    staffUserId = staffUser.id;
    await membershipRepo.addMembership({
      userId: staffUserId,
      dormitoryId: dormAId,
      roleId: 'role-staff',
      roleCode: 'STAFF',
      status: 'active',
      rolePermissions: ['tenants:view', 'tenant:view'],
    });
    staffAuth = await authService.authenticateTestUser(staffUserId);

    // 4. Create TENANT user (Dorm A)
    const tenantUser = await userRepo.upsertFromGoogle({
      email: 'tenant@dorma.com',
      name: 'Dorm A Tenant',
      googleSubject: 'g-sub-tenant-a',
    });
    tenantUserId = tenantUser.id;
    await membershipRepo.addMembership({
      userId: tenantUserId,
      dormitoryId: dormAId,
      roleId: 'role-tenant',
      roleCode: 'TENANT',
      status: 'active',
      rolePermissions: ['tenant:read'],
    });
    tenantAuth = await authService.authenticateTestUser(tenantUserId);

    // 5. Create MANAGER user (Dorm A)
    const managerUser = await userRepo.upsertFromGoogle({
      email: 'manager@dorma.com',
      name: 'Dorm A Manager',
      googleSubject: 'g-sub-manager-a',
    });
    managerUserId = managerUser.id;
    await membershipRepo.addMembership({
      userId: managerUserId,
      dormitoryId: dormAId,
      roleId: 'role-manager',
      roleCode: 'MANAGER',
      status: 'active',
      rolePermissions: ['tenants:view', 'tenants:create', 'tenants:update', 'tenants:document:read', 'tenants:document:write'],
    });
    managerAuth = await authService.authenticateTestUser(managerUserId);

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined);

    // Build Express App
    app = express();
    app.use(express.json());
    app.use(cookieParserMiddleware);
    app.use(requestIdMiddleware);

    const requireSession = authService.requireAuth();
    const mockPrisma: any = {
      dormitory: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (where.id === dormAId) return { id: dormAId, name: 'Dormitory A', status: 'active', deletedAt: null };
          if (where.id === dormBId) return { id: dormBId, name: 'Dormitory B', status: 'active', deletedAt: null };
          return null;
        },
      },
    };

    const requireActiveDormitory = createRequireActiveDormitoryMiddleware(mockPrisma);

    const protectedRouter = Router();
    protectedRouter.use(requireSession);
    protectedRouter.use(resolveDormitoryContextMiddleware);
    protectedRouter.use(requireActiveDormitory);
    protectedRouter.use('/tenants', createTenantRouter(authService, tenantService));

    const apiRouter = Router();
    apiRouter.use('/', protectedRouter);
    app.use('/api/v1', apiRouter);
    app.use(globalErrorHandler);
  });

  beforeEach(async () => {
    // Reset seed tenant in Dorm A
    const tA = await tenantRepo.create(dormAId, {
      tenantNumber: 'T-A001',
      displayName: 'สมชาย เดินทาง',
      phone: '0812345678',
      email: 'somchai@test.com',
      status: 'active',
    });
    testTenantAId = tA.id;

    // Reset seed tenant in Dorm B
    const tB = await tenantRepo.create(dormBId, {
      tenantNumber: 'T-B001',
      displayName: 'สมศรี อยู่ดี',
      phone: '0899998888',
      email: 'somsri@test.com',
      status: 'active',
    });
    testTenantBId = tB.id;

    // Set default pet policy for Dorm A
    tenantRepo.setDormitoryPetPolicy(dormAId, {
      allowed: 'conditional',
      allowedTypes: ['cat', 'dog'],
    });

    // Set default pet policy for Dorm B (no pets allowed)
    tenantRepo.setDormitoryPetPolicy(dormBId, {
      allowed: 'none',
      allowedTypes: [],
    });
  });

  const authHeaders = (auth: any, dormId = dormAId) => ({
    Cookie: `horplus_session=${auth.sessionToken}; horplus_csrf=${auth.csrfToken}`,
    'x-csrf-token': auth.csrfToken,
    'x-dormitory-id': dormId,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 1: 12 REQUIRED SERVICE / ROUTE TRANSACTION TESTS
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 1: 12 Required Transaction & Integrity Tests', () => {
    it('1. Basic update + emergency + vehicles + pet success commit together', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย ปรับปรุงใหม่',
          phone: '0819998877',
          email: 'updated@example.com',
          nationalId: '1100412345678',
          version: tenant!.version,
          emergencyContact: {
            name: 'นายฉุกเฉิน มั่นคง',
            phone: '0891112233',
            relationship: 'พี่ชาย',
            isPrimary: true,
          },
          vehicles: [
            { type: 'car', licensePlate: 'กข-9999', brand: 'Honda' },
            { type: 'motorcycle', licensePlate: '1มก-1111', brand: 'Yamaha' },
          ],
          pets: [
            { type: 'cat', name: 'สีสวาด' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.displayName).toBe('สมชาย ปรับปรุงใหม่');
      expect(res.body.data.tenant.version).toBe(tenant!.version + 1);

      // Verify all child entities committed together
      const updatedTenant = await tenantRepo.findById(testTenantAId, dormAId);
      expect(updatedTenant?.displayName).toBe('สมชาย ปรับปรุงใหม่');
      expect(updatedTenant?.email).toBe('updated@example.com');
      expect(updatedTenant?.version).toBe(tenant!.version + 1);

      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(1);
      expect(contacts[0].name).toBe('นายฉุกเฉิน มั่นคง');

      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(2);

      const petInfo = updatedTenant?.petInfo as any[];
      expect(petInfo).toBeDefined();
      expect(petInfo.length).toBe(1);
      expect(petInfo[0].type).toBe('cat');
    });

    it('2. Emergency failure rolls back basic profile', async () => {
      const tenantBefore = await tenantRepo.findById(testTenantAId, dormAId);

      // Spy on createEmergencyContact to simulate a database failure
      const spy = vi.spyOn(tenantRepo, 'createEmergencyContact').mockRejectedValueOnce(
        new Error('DB_EMERGENCY_INSERT_FAIL: Foreign key violation')
      );

      await expect(
        tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
          displayName: 'สมชาย ที่ไม่ควรเซฟ',
          phone: '0810000000',
          version: tenantBefore!.version,
          emergencyContact: {
            name: 'นายฉุกเฉิน พัง',
            phone: '0890000000',
            relationship: 'เพื่อน',
          },
        })
      ).rejects.toThrow();

      spy.mockRestore();

      // Verify basic profile was rolled back completely
      const tenantAfter = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenantAfter?.displayName).toBe(tenantBefore?.displayName);
      expect(tenantAfter?.phone).toBe(tenantBefore?.phone);
      expect(tenantAfter?.version).toBe(tenantBefore?.version);

      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(0);
    });

    it('3. Vehicle failure rolls back basic + emergency', async () => {
      const tenantBefore = await tenantRepo.findById(testTenantAId, dormAId);

      const spy = vi.spyOn(tenantRepo, 'createVehicle').mockRejectedValueOnce(
        new Error('DB_VEHICLE_INSERT_FAIL: Constraint error')
      );

      await expect(
        tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
          displayName: 'ชื่อใหม่ไม่ควรเซฟ',
          phone: '0810000000',
          version: tenantBefore!.version,
          emergencyContact: {
            name: 'ฉุกเฉินไม่ควรเซฟ',
            phone: '0890000000',
            relationship: 'ญาติ',
          },
          vehicles: [
            { type: 'car', licensePlate: 'พัง-001' },
          ],
        })
      ).rejects.toThrow();

      spy.mockRestore();

      const tenantAfter = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenantAfter?.displayName).toBe(tenantBefore?.displayName);
      expect(tenantAfter?.version).toBe(tenantBefore?.version);

      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(0);

      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(0);
    });

    it('4. Pet validation failure rolls back everything', async () => {
      const tenantBefore = await tenantRepo.findById(testTenantAId, dormAId);

      // Attempt to submit disallowed pet 'snake' under conditional policy allowing ['cat', 'dog']
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย เลี้ยงงู',
          phone: '0812345678',
          version: tenantBefore!.version,
          emergencyContact: {
            name: 'คุณน้า',
            phone: '0891111111',
            relationship: 'น้า',
          },
          vehicles: [{ type: 'car', licensePlate: 'งู-111' }],
          pets: [{ type: 'snake', name: 'เจ้าหลาม' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      // Verify zero mutation in DB
      const tenantAfter = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenantAfter?.displayName).toBe(tenantBefore?.displayName);
      expect(tenantAfter?.version).toBe(tenantBefore?.version);

      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(0);

      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(0);
    });

    it('5. Failure on the second/new vehicle leaves ZERO newly created vehicles', async () => {
      const tenantBefore = await tenantRepo.findById(testTenantAId, dormAId);

      let callCount = 0;
      const originalCreateVehicle = tenantRepo.createVehicle.bind(tenantRepo);
      const spy = vi.spyOn(tenantRepo, 'createVehicle').mockImplementation(async (...args) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('VEHICLE_2_CRASH');
        }
        return originalCreateVehicle(...args);
      });

      await expect(
        tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
          displayName: 'ทดสอบ 2 คัน',
          phone: '0812345678',
          version: tenantBefore!.version,
          vehicles: [
            { type: 'car', licensePlate: 'คันแรก-111' },
            { type: 'motorcycle', licensePlate: 'คันสอง-222' },
          ],
        })
      ).rejects.toThrow();

      spy.mockRestore();

      // Assert rollback: exactly ZERO vehicles exist for this tenant
      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(0);
    });

    it('6. Stale Tenant version returns conflict with ZERO child mutations', async () => {
      // First update to bump version to 2
      await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย เวอร์ชัน 2',
          phone: '0812345678',
          version: 1,
        });

      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenant!.version).toBe(2);

      // Send stale version 1 (which satisfies schema min(1) but fails compare-and-swap)
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย สับสนเวอร์ชัน',
          phone: '0812345678',
          version: 1, // Stale!
          emergencyContact: {
            name: 'ฉุกเฉินไม่ควรมา',
            phone: '0899999999',
            relationship: 'เพื่อน',
          },
          vehicles: [{ type: 'car', licensePlate: 'หลง-001' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('RESOURCE_VERSION_CONFLICT');

      // Zero child mutations
      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(0);
      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(0);
    });

    it('7. Retry stale request cannot create duplicate vehicle/emergency records', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const initialVersion = tenant!.version;

      const payload = {
        displayName: 'สมชาย ยิงซ้ำ',
        phone: '0812345678',
        version: initialVersion,
        emergencyContact: {
          name: 'แม่สายใจ',
          phone: '0891234567',
          relationship: 'มารดา',
        },
        vehicles: [{ type: 'car', licensePlate: 'ซ้ำ-999' }],
      };

      // First call succeeds -> version becomes initialVersion + 1
      const res1 = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send(payload);

      expect(res1.status).toBe(200);
      expect(res1.body.data.tenant.version).toBe(initialVersion + 1);

      // Stale retry with initialVersion
      const res2 = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send(payload);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('RESOURCE_VERSION_CONFLICT');

      // Verify ZERO duplicate records created
      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(1);
      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(1);
    });

    it('8. Cross-tenant vehicle ID fails closed and rolls back', async () => {
      // Create vehicle belonging to Tenant B in Dorm B
      const vehB = await tenantRepo.createVehicle(dormBId, testTenantBId, {
        type: 'car',
        licensePlate: 'ข้ามคน-888',
      });

      const tenantA = await tenantRepo.findById(testTenantAId, dormAId);

      // Attempt to submit Tenant B's vehicle ID for Tenant A
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย ขโมยรถ',
          phone: '0812345678',
          version: tenantA!.version,
          vehicles: [{ id: vehB.id, type: 'car', licensePlate: 'ขโมยมา-888' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_CHILD_OWNERSHIP');

      // Tenant A vehicles remain empty
      const vA = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vA.length).toBe(0);
    });

    it('9. Cross-dorm child ID fails closed and rolls back', async () => {
      // Create emergency contact in Dorm B
      const contactB = await tenantRepo.createEmergencyContact(dormBId, testTenantBId, {
        name: 'คนหอ บี',
        phone: '0892223333',
        relationship: 'เพื่อน',
      });

      const tenantA = await tenantRepo.findById(testTenantAId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย ข้ามหอ',
          phone: '0812345678',
          version: tenantA!.version,
          emergencyContact: {
            id: contactB.id,
            name: 'คนหอ บี ปลอม',
            phone: '0892223333',
            relationship: 'เพื่อน',
          },
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INVALID_CHILD_OWNERSHIP');

      const cA = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(cA.length).toBe(0);
    });

    it('10. Disallowed pet type rejected server-side', async () => {
      // Dorm A allows ['cat', 'dog']. Submit 'bird'.
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย เลี้ยงนก',
          phone: '0812345678',
          version: tenant!.version,
          pets: [{ type: 'bird', name: 'ขุนทอง' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');
    });

    it('11. allowed:none rejects non-empty pet list', async () => {
      // Dorm B pet policy has allowed: 'none'
      const tenantB = await tenantRepo.findById(testTenantBId, dormBId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantBId}/profile`)
        .set(authHeaders(multiDormOwnerAuth, dormBId))
        .send({
          displayName: 'สมศรี แอบเลี้ยงแมว',
          phone: '0899998888',
          version: tenantB!.version,
          pets: [{ type: 'cat', name: 'แมวดำ' }],
        });

      expect(res.status).toBe(400);
      expect(['PET_NOT_ALLOWED', 'PETS_NOT_ALLOWED']).toContain(res.body.error.code);
    });

    it('12. Canonical pet policy unavailable fails closed for pet change', async () => {
      // Remove pet policy completely for a new dorm ID
      const dormCId = '30000000-0000-0000-0000-000000000003';
      const tC = await tenantRepo.create(dormCId, {
        tenantNumber: 'T-C001',
        displayName: 'สมศักดิ์ ไร้นโยบาย',
        phone: '0811112222',
        status: 'active',
      });

      // No pet policy set for dormCId -> getDormitoryPetPolicy returns null
      await expect(
        tenantService.updateTenantProfileAggregate(dormCId, tC.id, {
          displayName: 'สมศักดิ์ ไร้นโยบาย',
          phone: '0811112222',
          version: tC.version,
          pets: [{ type: 'cat', name: 'แมวไร้นโยบาย' }],
        })
      ).rejects.toThrow();

      try {
        await tenantService.updateTenantProfileAggregate(dormCId, tC.id, {
          displayName: 'สมศักดิ์ ไร้นโยบาย',
          phone: '0811112222',
          version: tC.version,
          pets: [{ type: 'cat', name: 'แมวไร้นโยบาย' }],
        });
      } catch (err: any) {
        expect(['PET_NOT_ALLOWED', 'PET_POLICY_UNAVAILABLE']).toContain(err.code);
        expect(err.statusCode).toBe(400);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 2: 9 REQUIRED ID DOCUMENT REPLACEMENT & DORM SCOPING TESTS
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 2: 9 Required Identity Document Tests', () => {
    it('1. replacement succeeds -> new document becomes current', async () => {
      const upload1 = await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      const tenantAfter1 = await tenantRepo.findById(testTenantAId, dormAId);
      const key1 = tenantAfter1?.idCardObjectKey;
      expect(key1).toBeDefined();

      // Upload replacement image
      const upload2 = await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      const tenantAfter2 = await tenantRepo.findById(testTenantAId, dormAId);
      const key2 = tenantAfter2?.idCardObjectKey;

      expect(key2).toBeDefined();
      expect(key2).not.toBe(key1);
      expect(tenantAfter2?.idCardSha256).toBe(upload2.idCardSha256);
    });

    it('2. replacement succeeds -> old private file is removed', async () => {
      const upload1 = await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      const tenant1 = await tenantRepo.findById(testTenantAId, dormAId);
      const oldKey = tenant1?.idCardObjectKey!;

      const deleteSpy = vi.spyOn(localStorageProvider, 'deleteFile');

      await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);

      // Verify deleteFile was invoked for oldKey
      expect(deleteSpy).toHaveBeenCalledWith(oldKey);
      deleteSpy.mockRestore();
    });

    it('3. DB metadata update fails -> new staged file is removed (compensation)', async () => {
      const tenantBefore = await tenantRepo.findById(testTenantAId, dormAId);
      const oldKey = tenantBefore?.idCardObjectKey;

      let deletedKey: string | null = null;
      const originalDelete = localStorageProvider.deleteFile.bind(localStorageProvider);
      const delSpy = vi.spyOn(localStorageProvider, 'deleteFile').mockImplementation(async (key: string) => {
        deletedKey = key;
        return originalDelete(key);
      });

      // Cause DB update to fail
      const updateSpy = vi.spyOn(tenantRepo, 'update').mockRejectedValueOnce(
        new Error('SIMULATED_DB_WRITE_FAILURE')
      );

      await expect(
        tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer)
      ).rejects.toThrow('SIMULATED_DB_WRITE_FAILURE');

      updateSpy.mockRestore();
      delSpy.mockRestore();

      // Verify newly staged key was deleted as compensation
      expect(deletedKey).toBeDefined();
      expect(deletedKey).not.toBe(oldKey);
      expect(deletedKey).toContain(`tenants/${dormAId}/${testTenantAId}/id-card-`);
    });

    it('4. DB update fails -> old document remains intact/current', async () => {
      // First seed a document
      await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      const tenantWithDoc = await tenantRepo.findById(testTenantAId, dormAId);
      const initialKey = tenantWithDoc?.idCardObjectKey;
      const initialSha = tenantWithDoc?.idCardSha256;

      const updateSpy = vi.spyOn(tenantRepo, 'update').mockRejectedValueOnce(
        new Error('FAIL_ON_UPDATE')
      );

      await expect(
        tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer)
      ).rejects.toThrow();

      updateSpy.mockRestore();

      // Verify old document pointer remains intact in DB
      const tenantCurrent = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenantCurrent?.idCardObjectKey).toBe(initialKey);
      expect(tenantCurrent?.idCardSha256).toBe(initialSha);
    });

    it('5. there is NO user DELETE identity-document endpoint added', async () => {
      const res = await request(app)
        .delete(`/api/v1/tenants/${testTenantAId}/identity-document`)
        .set(authHeaders(ownerAuth, dormAId));

      // Route must not exist (404 or 405)
      expect([404, 405]).toContain(res.status);
    });

    it('6. button text is exactly "เปลี่ยน" in UI code (Option B decision)', () => {
      const pageCode = fs.readFileSync(path.resolve(__dirname, '../pages/owner/tenants.tsx'), 'utf8');

      // Verify exact button label "เปลี่ยน"
      expect(pageCode).toContain('<span>เปลี่ยน</span>');
      // Verify forbidden labels are completely absent
      expect(pageCode).not.toContain('<span>เปลี่ยนรูปภาพ</span>');
      expect(pageCode).not.toContain('<span>ลบรูปภาพ</span>');
    });

    it('7. direct preview is scoped to active dormitory', async () => {
      // Seed document for Tenant A
      await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);

      // GET identity document specifying dormitoryId in query
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantAId}/identity-document?dormitoryId=${dormAId}`)
        .set(authHeaders(ownerAuth, dormAId));

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('image/');
    });

    it('8. owner with multiple memberships can preview correct dorm B document', async () => {
      // Seed document for Tenant B in Dorm B
      await tenantService.updateTenantIdentityDocument(dormBId, testTenantBId, validPngBuffer);

      // Multi-dorm owner previews Tenant B using dorm B query parameter
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantBId}/identity-document?dormitoryId=${dormBId}`)
        .set(authHeaders(multiDormOwnerAuth, dormBId));

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('image/');
    });

    it('9. cross-dorm preview fails closed', async () => {
      // Seed document for Tenant A in Dorm A
      await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);

      // Owner requests Tenant A while sending header/query for Dorm B
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantAId}/identity-document?dormitoryId=${dormBId}`)
        .set(authHeaders(multiDormOwnerAuth, dormBId));

      // Fails closed (404 Tenant not found in Dorm B)
      expect([403, 404]).toContain(res.status);
    });

    it('10. Save profile with replacement document -> document succeeds -> next profile edit uses latest authoritative version (N+2) -> no false RESOURCE_VERSION_CONFLICT', async () => {
      // Fetch initial state: version N
      const initial = await tenantRepo.findById(testTenantAId, dormAId);
      const vN = initial!.version;

      // 1. Profile aggregate save: N -> N+1
      const profileRes = await tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
        displayName: 'สมชาย รักชาติ อัปเดตครั้งที่ 1',
        phone: '0812345678',
        version: vN,
      });
      expect(profileRes.tenant.version).toBe(vN + 1);

      // 2. Replacement document upload succeeds: N+1 -> N+2
      const docRes = await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      expect(docRes.version).toBe(vN + 2);

      const tenantAfterDoc = await tenantRepo.findById(testTenantAId, dormAId);
      expect(tenantAfterDoc?.version).toBe(vN + 2);

      // Attempting to save subsequent profile with stale version N+1 must fail with 409 RESOURCE_VERSION_CONFLICT
      await expect(
        tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
          displayName: 'สมชาย รักชาติ อัปเดตด้วยเวอร์ชันเก่า',
          phone: '0812345678',
          version: vN + 1,
        })
      ).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

      // 3. Next profile edit uses authoritative version N+2 -> succeeds without conflict -> becomes N+3
      const nextProfileRes = await tenantService.updateTenantProfileAggregate(dormAId, testTenantAId, {
        displayName: 'สมชาย รักชาติ อัปเดตครั้งที่ 2 ด้วย N+2',
        phone: '0812345678',
        version: docRes.version!,
      });
      expect(nextProfileRes.tenant.version).toBe(vN + 3);

      const finalTenant = await tenantRepo.findById(testTenantAId, dormAId);
      expect(finalTenant?.version).toBe(vN + 3);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 3: ROUTE AUTHORIZATION & GUARDS (STAFF, TENANT, MANAGER, CSRF)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 3: Route Authorization & Security Guards', () => {
    it('1. STAFF profile PUT returns 403 FORBIDDEN (read-only)', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(staffAuth, dormAId))
        .send({
          displayName: 'สมชาย พยายามแก้ไขโดยสตาฟ',
          phone: '0812345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('2. TENANT role profile PUT is hard denied with 403 FORBIDDEN', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(tenantAuth, dormAId))
        .send({
          displayName: 'สมชาย พยายามแก้เอง',
          phone: '0812345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('3. MANAGER role profile PUT is permitted according to tenant-domain policy', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(managerAuth, dormAId))
        .send({
          displayName: 'สมชาย แก้ไขโดยผู้จัดการ',
          phone: '0812345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.displayName).toBe('สมชาย แก้ไขโดยผู้จัดการ');
    });

    it('4. Missing or invalid CSRF returns 403 CSRF_INVALID', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set({
          Cookie: `horplus_session=${ownerAuth.sessionToken}`,
          'x-dormitory-id': dormAId,
        })
        .send({
          displayName: 'สมชาย ยิงไร้ซีเอสอาร์เอฟ',
          phone: '0812345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('CSRF_INVALID');
    });

    it('5. Document preview requires read permission', async () => {
      await tenantService.updateTenantIdentityDocument(dormAId, testTenantAId, validPngBuffer);
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantAId}/identity-document`)
        .set(authHeaders(tenantAuth, dormAId));

      expect(res.status).toBe(403);
    });

    it('6. Document upload requires write permission', async () => {
      const res = await request(app)
        .post(`/api/v1/tenants/${testTenantAId}/identity-document`)
        .set(authHeaders(staffAuth, dormAId))
        .attach('file', validPngBuffer, 'id_card.png');

      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 4: CANONICAL NAME & NATIONAL ID ENCRYPTION PIPELINE
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 4: Canonical Name & National ID Encryption Pipeline', () => {
    it('1. displayName edit updates canonical firstName and lastName via parseAndNormalizeName', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมศักดิ์ รักสงบ',
          phone: '0812345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(200);
      const saved = await tenantRepo.findById(testTenantAId, dormAId);
      expect(saved?.displayName).toBe('สมศักดิ์ รักสงบ');
      expect(saved?.firstName).toBe('สมศักดิ์');
      expect(saved?.lastName).toBe('รักสงบ');
    });

    it('2. National ID masked preserve: unchanged masked input preserves existing ciphertext & mask', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย มีบัตร',
          phone: '0812345678',
          nationalId: '1100412345678',
          version: tenant!.version,
        });

      const savedWithId = await tenantRepo.findById(testTenantAId, dormAId);
      const originalEncrypted = savedWithId?.nationalIdEncrypted;
      const originalMasked = savedWithId?.nationalIdMasked;
      expect(originalEncrypted).toBeDefined();
      expect(originalMasked).toBeDefined();

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย แก้ไขชื่อแต่ไม่แก้บัตร',
          phone: '0812345678',
          nationalId: originalMasked,
          version: savedWithId!.version,
        });

      expect(res.status).toBe(200);
      const reSaved = await tenantRepo.findById(testTenantAId, dormAId);
      expect(reSaved?.nationalIdEncrypted).toBe(originalEncrypted);
      expect(reSaved?.nationalIdMasked).toBe(originalMasked);
    });

    it('3. National ID blank clear: submitting "" clears encrypted and masked fields to null', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย ลบบัตร',
          phone: '0812345678',
          nationalId: '',
          version: tenant!.version,
        });

      expect(res.status).toBe(200);
      const saved = await tenantRepo.findById(testTenantAId, dormAId);
      expect(saved?.nationalIdEncrypted).toBeNull();
      expect(saved?.nationalIdMasked).toBeNull();
    });

    it('4. Browser DTO never leaks raw or encrypted National ID', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย ตรวจสอบความปลอดภัยบัตร',
          phone: '0812345678',
          nationalId: '1100412345678',
          version: tenant!.version,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.nationalId).toBeUndefined();
      expect(res.body.data.tenant.nationalIdEncrypted).toBeUndefined();
      expect(res.body.data.tenant.nationalIdMasked).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 5: PRODUCTION PRISMA TRANSACTION & ATOMIC CONCURRENCY PROOF
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 5: Production Prisma Transaction & Atomic Concurrency Proof', () => {
    it('1. Prisma runInTransaction instantiates transaction-scoped PrismaTenantRepository', async () => {
      let txArgPassedToCallback: any = null;
      const mockTx = {
        tenant: {},
        dormitoryPropertyDefaults: {},
      };
      const mockPrismaClient: any = {
        $transaction: async (fn: any) => {
          return fn(mockTx);
        },
      };

      const prismaRepo = new PrismaTenantRepository(mockPrismaClient);
      await prismaRepo.runInTransaction(async (txRepo) => {
        txArgPassedToCallback = txRepo;
      });

      expect(txArgPassedToCallback).toBeInstanceOf(PrismaTenantRepository);
      expect((txArgPassedToCallback as any).prisma).toBe(mockTx);
    });

    it('2. Concurrent requests with same version: exactly one succeeds, one gets 409 conflict, final version N+1', async () => {
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);
      const baseVersion = tenant!.version;

      const call1 = request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย แข่งขัน 1',
          phone: '0812345678',
          version: baseVersion,
          emergencyContact: { name: 'ฉุกเฉิน 1', phone: '0891111111', relationship: 'เพื่อน' },
          vehicles: [{ type: 'car', licensePlate: 'แข่ง-001' }],
        });

      const call2 = request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'สมชาย แข่งขัน 2',
          phone: '0812345678',
          version: baseVersion,
          emergencyContact: { name: 'ฉุกเฉิน 2', phone: '0892222222', relationship: 'เพื่อน' },
          vehicles: [{ type: 'car', licensePlate: 'แข่ง-002' }],
        });

      const [res1, res2] = await Promise.all([call1, call2]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const finalTenant = await tenantRepo.findById(testTenantAId, dormAId);
      expect(finalTenant?.version).toBe(baseVersion + 1);

      // Verify ZERO duplicate children
      const contacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(contacts.length).toBe(1);

      const vehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(vehicles.length).toBe(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 6: EMERGENCY & VEHICLE RECONCILIATION ID PRESERVATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 6: Emergency & Vehicle ID Preservation Reconciliation', () => {
    it('1. Updating emergency contact preserves the existing record ID and does not recreate', async () => {
      const initContact = await tenantRepo.createEmergencyContact(dormAId, testTenantAId, {
        name: 'ฉุกเฉินตั้งต้น',
        phone: '0811111111',
        relationship: 'บิดา',
        isPrimary: true,
      });
      const originalContactId = initContact.id;
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          emergencyContact: {
            id: originalContactId,
            name: 'นายฉุกเฉิน ชื่อใหม่',
            phone: '0895554444',
            relationship: 'น้องชาย',
          },
        });

      expect(res.status).toBe(200);
      const updatedContacts = await tenantRepo.findEmergencyContacts(testTenantAId, dormAId);
      expect(updatedContacts.length).toBe(1);
      expect(updatedContacts[0].id).toBe(originalContactId);
      expect(updatedContacts[0].name).toBe('นายฉุกเฉิน ชื่อใหม่');
    });

    it('2. Vehicle reconciliation: updates existing vehicle in place, creates new, removes omitted', async () => {
      const initVeh = await tenantRepo.createVehicle(dormAId, testTenantAId, {
        type: 'car',
        licensePlate: 'เดิม-111',
        brand: 'Toyota',
      });
      const keptVehId = initVeh.id;
      const tenant = await tenantRepo.findById(testTenantAId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          vehicles: [
            // Keep and update first vehicle
            { id: keptVehId, type: 'car', licensePlate: 'อัพเดท-777', brand: 'Toyota' },
            // Add a new vehicle with no ID
            { type: 'motorcycle', licensePlate: 'ใหม่-888', brand: 'Honda' },
          ],
        });

      expect(res.status).toBe(200);
      const currentVehicles = await tenantRepo.findVehicles(testTenantAId, dormAId);
      expect(currentVehicles.length).toBe(2);

      const kept = currentVehicles.find(v => v.id === keptVehId);
      expect(kept).toBeDefined();
      expect(kept?.licensePlate).toBe('อัพเดท-777');

      const created = currentVehicles.find(v => v.id !== keptVehId);
      expect(created).toBeDefined();
      expect(created?.licensePlate).toBe('ใหม่-888');
      expect(created?.id).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 7: ZERO REAL LINE OA CALLS
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 7: Zero Real LINE Hard Lock', () => {
    it('1. Zero network requests or references to real line.me', () => {
      const code = fs.readFileSync(path.resolve(__dirname, '../pages/owner/tenants.tsx'), 'utf8');
      expect(code).not.toContain('api.line.me');
      expect(code).not.toContain('access.line.me');
    });
  });


  // ──────────────────────────────────────────────────────────────────────────
  // PART 8: GRANDFATHER PET POLICY SEMANTICS & ROLLBACK (STEP 3C.1G)
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 8: Grandfather Pet Policy Semantics & Rollback (Step 3C.1G)', () => {
    let petTenantId: string;

    beforeEach(async () => {
      const created = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-PET-001',
        firstName: 'ก้องภพ',
        lastName: 'คนรักสัตว์',
        displayName: 'ก้องภพ คนรักสัตว์',
        phone: '0851112233',
        status: 'active',
      });
      petTenantId = created.id;
      // Initialize with 1 grandfathered cat
      await tenantRepo.update(petTenantId, dormAId, {
        petInfo: [{ id: 'pet-orig-cat', type: 'cat', name: 'Milo' }],
      });
    });

    it('1. grandfathered disallowed existing pet + unrelated phone edit -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: '0899998877',
          version: tenant!.version,
          pets: [{ id: 'pet-orig-cat', type: 'cat', name: 'Milo' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.phone).toBe('0899998877');
      expect(updated?.version).toBe(tenant!.version + 1);
    });

    it('2. grandfathered disallowed existing pet + pet name-only edit -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ id: 'pet-orig-cat', type: 'cat', name: 'Luna' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo[0].name).toBe('Luna');
      expect(updated?.version).toBe(tenant!.version + 1);
    });

    it('3. grandfathered existing pet deletion -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo).toEqual([]);
      expect(updated?.version).toBe(tenant!.version + 1);
    });

    it('4. current policy none + new pet -> REJECT and rollback', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);
      const originalVersion = tenant!.version;

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'เปลี่ยนชื่อล้มเหลว',
          phone: tenant!.phone,
          version: originalVersion,
          pets: [
            { id: 'pet-orig-cat', type: 'cat', name: 'Milo' },
            { type: 'dog', name: 'Lucky' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_NOT_ALLOWED');

      // Verify transaction rollback
      const current = await tenantRepo.findById(petTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
      expect(current?.displayName).toBe(tenant!.displayName);
    });

    it('5. conditional policy + approved new type -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['cat', 'bird'] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { id: 'pet-orig-cat', type: 'cat', name: 'Milo' },
            { type: 'bird', name: 'Tweety' },
          ],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo.length).toBe(2);
    });

    it('6. conditional policy + unapproved new type -> REJECT and rollback', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['cat'] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);
      const originalVersion = tenant!.version;

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'เปลี่ยนชื่อล้มเหลว',
          phone: tenant!.phone,
          version: originalVersion,
          pets: [
            { id: 'pet-orig-cat', type: 'cat', name: 'Milo' },
            { type: 'dog', name: 'Lucky' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      const current = await tenantRepo.findById(petTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
    });

    it('7. existing disallowed cat changed to dog while dog disallowed -> REJECT and rollback', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['fish'] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);
      const originalVersion = tenant!.version;

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'เปลี่ยนชื่อล้มเหลว',
          phone: tenant!.phone,
          version: originalVersion,
          pets: [{ id: 'pet-orig-cat', type: 'dog', name: 'ChangedToDog' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      const current = await tenantRepo.findById(petTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
      expect(current?.petInfo[0].type).toBe('cat');
    });

    it('8. existing disallowed cat changed to currently allowed dog -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['dog'] });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ id: 'pet-orig-cat', type: 'dog', name: 'ChangedToDog' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo[0].type).toBe('dog');
    });

    it('9. two existing cats -> submitted two same cats reordered -> PASS', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      await tenantRepo.update(petTenantId, dormAId, {
        petInfo: [
          { type: 'cat', name: 'Cat-Alpha' },
          { type: 'cat', name: 'Cat-Beta' },
        ],
      });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      // Reordered
      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { type: 'cat', name: 'Cat-Beta' },
            { type: 'cat', name: 'Cat-Alpha' },
          ],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo.length).toBe(2);
    });

    it('10. two existing cats -> submitted three cats -> third cat treated as NEW', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      await tenantRepo.update(petTenantId, dormAId, {
        petInfo: [
          { type: 'cat', name: 'Cat-Alpha' },
          { type: 'cat', name: 'Cat-Beta' },
        ],
      });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);
      const originalVersion = tenant!.version;

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: originalVersion,
          pets: [
            { type: 'cat', name: 'Cat-Alpha' },
            { type: 'cat', name: 'Cat-Beta' },
            { type: 'cat', name: 'Cat-Gamma-New' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_NOT_ALLOWED');

      const current = await tenantRepo.findById(petTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
    });

    it('11. no stable IDs / reordered legacy petInfo does NOT become false new pets', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      await tenantRepo.update(petTenantId, dormAId, {
        petInfo: [
          { type: 'อื่นๆ', customType: 'หนูแฮมสเตอร์', name: 'Hamtaro' },
        ],
      });
      const tenant = await tenantRepo.findById(petTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { type: 'อื่นๆ', customType: 'หนูแฮมสเตอร์', name: 'Hamtaro Jr.' },
          ],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petTenantId, dormAId);
      expect(updated?.petInfo[0].name).toBe('Hamtaro Jr.');
    });

    it('12. pet policy unavailable + NO pet type change -> unrelated profile save PASS', async () => {
      // Simulate pet policy read failure/unavailability
      const origGetPetPolicy = tenantRepo.getDormitoryPetPolicy.bind(tenantRepo);
      tenantRepo.getDormitoryPetPolicy = async () => {
        throw new Error('Database connection timeout reading pet policy');
      };

      try {
        const tenant = await tenantRepo.findById(petTenantId, dormAId);
        const res = await request(app)
          .put(`/api/v1/tenants/${petTenantId}/profile`)
          .set(authHeaders(ownerAuth, dormAId))
          .send({
            displayName: tenant!.displayName,
            phone: '0877776655',
            version: tenant!.version,
            pets: [{ id: 'pet-orig-cat', type: 'cat', name: 'Milo' }],
          });

        expect(res.status).toBe(200);
        const updated = await tenantRepo.findById(petTenantId, dormAId);
        expect(updated?.phone).toBe('0877776655');
      } finally {
        tenantRepo.getDormitoryPetPolicy = origGetPetPolicy;
      }
    });

    it('13. pet policy unavailable + NEW/CHANGED pet type -> FAIL CLOSED and rollback', async () => {
      const origGetPetPolicy = tenantRepo.getDormitoryPetPolicy.bind(tenantRepo);
      tenantRepo.getDormitoryPetPolicy = async () => {
        throw new Error('Database connection timeout reading pet policy');
      };

      try {
        const tenant = await tenantRepo.findById(petTenantId, dormAId);
        const originalVersion = tenant!.version;

        const res = await request(app)
          .put(`/api/v1/tenants/${petTenantId}/profile`)
          .set(authHeaders(ownerAuth, dormAId))
          .send({
            displayName: 'ชื่อใหม่ล้มเหลว',
            phone: tenant!.phone,
            version: originalVersion,
            pets: [
              { id: 'pet-orig-cat', type: 'cat', name: 'Milo' },
              { type: 'dog', name: 'Lucky' },
            ],
          });

        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('PET_POLICY_UNAVAILABLE');

        // Rollback verified
        const current = await tenantRepo.findById(petTenantId, dormAId);
        expect(current?.version).toBe(originalVersion);
      } finally {
        tenantRepo.getDormitoryPetPolicy = origGetPetPolicy;
      }
    });

    it('14. deletion remains allowed even when policy is unavailable', async () => {
      const origGetPetPolicy = tenantRepo.getDormitoryPetPolicy.bind(tenantRepo);
      tenantRepo.getDormitoryPetPolicy = async () => {
        throw new Error('Database connection timeout reading pet policy');
      };

      try {
        const tenant = await tenantRepo.findById(petTenantId, dormAId);
        const res = await request(app)
          .put(`/api/v1/tenants/${petTenantId}/profile`)
          .set(authHeaders(ownerAuth, dormAId))
          .send({
            displayName: tenant!.displayName,
            phone: tenant!.phone,
            version: tenant!.version,
            pets: [],
          });

        expect(res.status).toBe(200);
        const updated = await tenantRepo.findById(petTenantId, dormAId);
        expect(updated?.petInfo).toEqual([]);
      } finally {
        tenantRepo.getDormitoryPetPolicy = origGetPetPolicy;
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 9: STEP 3C.1H REMOTE SOURCE REVIEW BLOCKER CLOSURE
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 9: Step 3C.1H Remote Source Review Blocker Closure', () => {
    let customPetTenantId: string;

    beforeEach(async () => {
      const created = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-CUSTOM-PET-001',
        firstName: 'ก้องเกียรติ',
        lastName: 'คนเลี้ยงงู',
        displayName: 'ก้องเกียรติ คนเลี้ยงงู',
        phone: '0859998888',
        status: 'active',
      });
      customPetTenantId = created.id;
    });

    it('1. Server: legacy direct custom type vs explicit other/custom is grandfather-equivalent', async () => {
      // Legacy custom pet stored directly as { type: "งู", name: "เขียว" }
      await tenantRepo.update(customPetTenantId, dormAId, {
        petInfo: [{ type: 'งู', name: 'เขียว' }],
      });
      // Current policy is strictly none
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });

      const tenant = await tenantRepo.findById(customPetTenantId, dormAId);

      // User submits explicit { type: "other", customType: "งู", name: "เขียว" }
      const res = await request(app)
        .put(`/api/v1/tenants/${customPetTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: '0811112222',
          version: tenant!.version,
          pets: [{ type: 'other', customType: 'งู', name: 'เขียว' }],
        });

      // Must be grandfathered and succeed, NOT rejected as new pet!
      expect(res.status).toBe(200);
      expect(res.body.data.tenant.phone).toBe('0811112222');
      const updated = await tenantRepo.findById(customPetTenantId, dormAId);
      expect(updated?.petInfo).toEqual([
        expect.objectContaining({ type: 'other', customType: 'งู', name: 'เขียว' }),
      ]);
    });

    it('2. Server: policy conditional allowedTypes=["other"] accepts new custom pet', async () => {
      await tenantRepo.update(customPetTenantId, dormAId, { petInfo: [] });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['other'] });

      const tenant = await tenantRepo.findById(customPetTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${customPetTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'other', customType: 'งู', name: 'น้องงู' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.petInfo).toEqual([
        expect.objectContaining({ type: 'other', customType: 'งู', name: 'น้องงู' }),
      ]);
    });

    it('3. Server: policy conditional exact custom allowed value accepts it', async () => {
      await tenantRepo.update(customPetTenantId, dormAId, { petInfo: [] });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['งู'] });

      const tenant = await tenantRepo.findById(customPetTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${customPetTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'other', customType: 'งู', name: 'น้องงู' }],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.petInfo).toEqual([
        expect.objectContaining({ type: 'other', customType: 'งู', name: 'น้องงู' }),
      ]);
    });

    it('4. Server: disallowed custom pet rejects atomically with PET_TYPE_NOT_ALLOWED', async () => {
      await tenantRepo.update(customPetTenantId, dormAId, { petInfo: [] });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['cat', 'dog'] });

      const tenant = await tenantRepo.findById(customPetTenantId, dormAId);
      const originalVersion = tenant!.version;

      const res = await request(app)
        .put(`/api/v1/tenants/${customPetTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: 'ชื่อต้องไม่เปลี่ยน',
          phone: tenant!.phone,
          version: originalVersion,
          pets: [{ type: 'other', customType: 'งู', name: 'น้องงู' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      // Atomic rollback: version and name remain untouched
      const current = await tenantRepo.findById(customPetTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
      expect(current?.displayName).toBe(tenant!.displayName);
    });

    it('5. Mutation transaction commits but unrelated full-detail dependency fails -> profile mutation still returns success', async () => {
      // Spy on getTenantDetails to throw, simulating post-commit failure if it were called
      const spy = vi.spyOn(tenantService, 'getTenantDetails').mockImplementation(async () => {
        throw new Error('Unrelated full detail aggregation failure: contracts/bills DB unavailable');
      });

      try {
        const tenant = await tenantRepo.findById(testTenantAId, dormAId);
        const originalVersion = tenant!.version;

        const res = await request(app)
          .put(`/api/v1/tenants/${testTenantAId}/profile`)
          .set(authHeaders(ownerAuth, dormAId))
          .send({
            displayName: 'นาย สมชาย แก้ไขสำเร็จแม้ดีเทลพัง',
            phone: '0812345678',
            version: originalVersion,
          });

        // SUCCESS! Must return 200 without invoking getTenantDetails
        expect(res.status).toBe(200);
        expect(res.body.data.tenant.version).toBe(originalVersion + 1);
        expect(res.body.data.tenant.displayName).toBe('นาย สมชาย แก้ไขสำเร็จแม้ดีเทลพัง');

        // Confirmed: getTenantDetails was NEVER called
        expect(spy).not.toHaveBeenCalled();

        const inDb = await tenantRepo.findById(testTenantAId, dormAId);
        expect(inDb?.version).toBe(originalVersion + 1);
      } finally {
        spy.mockRestore();
      }
    });

    it('6. Profile mutation response contains safe Tenant DTO only, no sensitive or internal fields', async () => {
      // Pre-populate tenant with encrypted nationalId and internal id card object key
      await tenantRepo.update(testTenantAId, dormAId, {
        nationalIdEncrypted: 'enc:secret-cipher-bytes',
        nationalIdMasked: '1-1004-XXXXX-55-5',
        idCardObjectKey: 'private/dorms/dormA/internal-raw-key.webp',
        idCardUploadedByUserId: 'user-actor-internal-id',
      });

      const tenant = await tenantRepo.findById(testTenantAId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantAId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
        });

      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.tenant).toBeDefined();

      // STRICT NEGATIVE ASSERTIONS on safe API DTO
      expect(data.tenant.nationalIdEncrypted).toBeUndefined();
      expect(data.tenant.idCardObjectKey).toBeUndefined();
      expect(data.tenant.idCardUploadedByUserId).toBeUndefined();

      // Raw body text search strictly confirms absence of leaked secrets
      const rawBody = JSON.stringify(res.body);
      expect(rawBody).not.toContain('enc:secret-cipher-bytes');
      expect(rawBody).not.toContain('private/dorms/dormA/internal-raw-key.webp');
      expect(rawBody).not.toContain('user-actor-internal-id');

      // Safe presentation fields are present
      expect(data.tenant.nationalIdMasked).toBe('1-1004-XXXXX-55-5');
      expect(data.tenant.hasIdentityDocument).toBe(true);
      expect(Array.isArray(data.emergencyContacts)).toBe(true);
      expect(Array.isArray(data.vehicles)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PART 10: STEP 3C.1I PET IDENTITY, STABLE-ID TYPE LOCK & FAIL-SOFT AUDIT
  // ──────────────────────────────────────────────────────────────────────────
  describe('Part 10: Step 3C.1I Pet Identity, Stable-ID Type Lock & Fail-Soft Audit', () => {
    let petIdTenantId: string;

    beforeEach(async () => {
      const created = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-PET-ID-001',
        firstName: 'สิทธิชัย',
        lastName: 'เลี้ยงสัตว์ระเบียบ',
        displayName: 'สิทธิชัย เลี้ยงสัตว์ระเบียบ',
        phone: '0861112233',
        status: 'active',
      });
      petIdTenantId = created.id;
    });

    it('A. existing id=pet-1 cat -> submitted id=pet-1 dog -> policy allows cat only -> PET_TYPE_NOT_ALLOWED', async () => {
      // Existing cat with stable ID pet-1
      await tenantRepo.update(petIdTenantId, dormAId, {
        petInfo: [{ id: 'pet-1', type: 'cat', name: 'Milo' }],
      });
      // Dorm policy allows only cats
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'conditional', allowedTypes: ['cat'] });

      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);
      const originalVersion = tenant!.version;

      // User attempts to change pet type to 'dog' while keeping stable ID 'pet-1'
      const res = await request(app)
        .put(`/api/v1/tenants/${petIdTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: originalVersion,
          pets: [{ id: 'pet-1', type: 'dog', name: 'Milo' }],
        });

      // Must be rejected! Stable ID proves record identity, not authority to change pet type
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      // Atomic rollback: version unchanged
      const current = await tenantRepo.findById(petIdTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
    });

    it('B. existing id=pet-1 cat -> submitted id=pet-1 cat, different name -> policy none -> PASS', async () => {
      await tenantRepo.update(petIdTenantId, dormAId, {
        petInfo: [{ id: 'pet-1', type: 'cat', name: 'มะลิ' }],
      });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });

      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);

      // Name change only (มะลิ -> มะลิใหม่) with same ID and type
      const res = await request(app)
        .put(`/api/v1/tenants/${petIdTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ id: 'pet-1', type: 'cat', name: 'มะลิใหม่' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petIdTenantId, dormAId);
      expect(updated?.petInfo[0].name).toBe('มะลิใหม่');
      expect(updated?.petInfo[0].type).toBe('cat');
    });

    it('C. legacy pet without id: cat name A -> cat name B -> policy none -> PASS', async () => {
      await tenantRepo.update(petIdTenantId, dormAId, {
        petInfo: [{ type: 'cat', name: 'Cat-Alpha' }],
      });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });

      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);

      // Name change without stable ID
      const res = await request(app)
        .put(`/api/v1/tenants/${petIdTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'cat', name: 'Cat-Beta' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petIdTenantId, dormAId);
      expect(updated?.petInfo[0].name).toBe('Cat-Beta');
    });

    it('D. existing one cat -> submit two cats -> policy none -> second one classified new -> reject atomically', async () => {
      await tenantRepo.update(petIdTenantId, dormAId, {
        petInfo: [{ type: 'cat', name: 'Cat-Solo' }],
      });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });

      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);
      const originalVersion = tenant!.version;

      // Submit two cats when only one is grandfathered
      const res = await request(app)
        .put(`/api/v1/tenants/${petIdTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: originalVersion,
          pets: [
            { type: 'cat', name: 'Cat-Solo' },
            { type: 'cat', name: 'Cat-Second-New' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_NOT_ALLOWED');

      const current = await tenantRepo.findById(petIdTenantId, dormAId);
      expect(current?.version).toBe(originalVersion);
    });

    it('E. existing custom: {type:"งู"} -> submitted: {type:"other", customType:"งู"} -> policy none -> PASS', async () => {
      await tenantRepo.update(petIdTenantId, dormAId, {
        petInfo: [{ type: 'งู', name: 'น้องงูเขียว' }],
      });
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });

      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${petIdTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'other', customType: 'งู', name: 'น้องงูเขียว' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(petIdTenantId, dormAId);
      expect(updated?.petInfo[0].customType).toBe('งู');
    });

    it('11. profile transaction succeeds -> auditService.log throws -> PUT /profile returns success (fail-soft)', async () => {
      const tenant = await tenantRepo.findById(petIdTenantId, dormAId);
      const originalVersion = tenant!.version;

      // Spy on auditService.log on tenantService to reject
      const auditSpy = vi.spyOn((tenantService as any).auditService, 'log').mockRejectedValueOnce(
        new Error('Audit Elasticsearch cluster unavailable')
      );

      try {
        const res = await request(app)
          .put(`/api/v1/tenants/${petIdTenantId}/profile`)
          .set(authHeaders(ownerAuth, dormAId))
          .send({
            displayName: 'นาย สิทธิชัย เซฟสำเร็จแม้ออดิตพัง',
            phone: '0869998877',
            version: originalVersion,
          });

        // Fail-soft: Mutation succeeds with 200, no 500 error!
        expect(res.status).toBe(200);
        expect(res.body.data.tenant.displayName).toBe('นาย สิทธิชัย เซฟสำเร็จแม้ออดิตพัง');
        expect(res.body.data.tenant.version).toBe(originalVersion + 1);

        // Verify persisted state in DB
        const updated = await tenantRepo.findById(petIdTenantId, dormAId);
        expect(updated?.displayName).toBe('นาย สิทธิชัย เซฟสำเร็จแม้ออดิตพัง');
        expect(updated?.phone).toBe('0869998877');
        expect(updated?.version).toBe(originalVersion + 1);
      } finally {
        auditSpy.mockRestore();
      }
    });
  });

  describe('Part 11: Canonical Pet ID Defense & small_pet Policy Normalization (Step 3C.1J)', () => {
    let testTenantId: string;

    beforeEach(async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'all', allowedTypes: [] });
      const created = await tenantRepo.create(dormAId, {
        displayName: 'นาย สเต็ป เจ ทดสอบ',
        phone: '0812345678',
        status: 'active',
        version: 1,
        petInfo: [{ id: 'pet-canonical-101', type: 'cat', name: 'เหมียวมีชิพ' }],
      });
      testTenantId = created.id;
    });

    it('1. unknown submitted browser ID is stripped and NOT persisted into canonical stored petInfo', async () => {
      const tenant = await tenantRepo.findById(testTenantId, dormAId);

      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { id: 'pet-canonical-101', type: 'cat', name: 'เหมียวมีชิพ' },
            { id: 'fabricated-browser-id-999', type: 'cat', name: 'เหมียวใหม่' },
          ],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(testTenantId, dormAId);
      expect(updated?.petInfo.length).toBe(2);
      // Canonical ID is preserved
      expect(updated?.petInfo[0].id).toBe('pet-canonical-101');
      // Unknown browser ID is stripped!
      expect(updated?.petInfo[1].id).toBeUndefined();
    });

    it('2. unknown submitted ID cannot bypass new/changed policy classification', async () => {
      // Policy changed to 'none'
      tenantRepo.setDormitoryPetPolicy(dormAId, { allowed: 'none', allowedTypes: [] });
      const tenant = await tenantRepo.findById(testTenantId, dormAId);

      // Attempt to submit a dog with a fabricated ID claim
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { id: 'pet-canonical-101', type: 'cat', name: 'เหมียวมีชิพ' },
            { id: 'fake-id-bypass', type: 'dog', name: 'ด็อกกี้' },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PET_NOT_ALLOWED');
    });

    it('3. small_pet policy authorizes new bird, fish, rabbit, hamster in English and Thai', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, {
        allowed: 'conditional',
        allowedTypes: ['small_pet'],
      });

      // Clear existing pets so all submitted are new
      await tenantRepo.update(testTenantId, dormAId, { petInfo: [] });
      let tenant = await tenantRepo.findById(testTenantId, dormAId);

      // A. English: bird, fish, rabbit, hamster
      const resEn = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { type: 'bird', name: 'Tweety' },
            { type: 'fish', name: 'Nemo' },
            { type: 'rabbit', name: 'Bunny' },
            { type: 'hamster', name: 'Hamtaro' },
          ],
        });

      expect(resEn.status).toBe(200);
      let updated = await tenantRepo.findById(testTenantId, dormAId);
      expect(updated?.petInfo.length).toBe(4);

      // B. Thai: นก, ปลา, กระต่าย, หนูแฮมสเตอร์
      tenant = await tenantRepo.findById(testTenantId, dormAId);
      const resTh = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [
            { type: 'นก', name: 'เจ้านก' },
            { type: 'ปลา', name: 'เจ้าปลา' },
            { type: 'กระต่าย', name: 'เจ้าต่าย' },
            { type: 'หนูแฮมสเตอร์', name: 'เจ้าหนู' },
          ],
        });

      expect(resTh.status).toBe(200);
      updated = await tenantRepo.findById(testTenantId, dormAId);
      expect(updated?.petInfo.length).toBe(4);
    });

    it('4. small_pet policy rejects new dog, cat, and arbitrary custom pets', async () => {
      tenantRepo.setDormitoryPetPolicy(dormAId, {
        allowed: 'conditional',
        allowedTypes: ['small_pet'],
      });
      await tenantRepo.update(testTenantId, dormAId, { petInfo: [] });
      const tenant = await tenantRepo.findById(testTenantId, dormAId);

      // A. Dog is rejected
      const resDog = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'dog', name: 'Onyx' }],
        });
      expect(resDog.status).toBe(400);
      expect(resDog.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      // B. Cat is rejected
      const resCat = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'cat', name: 'Milo' }],
        });
      expect(resCat.status).toBe(400);
      expect(resCat.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');

      // C. Custom pet (e.g. งู) is rejected unless separately allowed
      const resCustom = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          pets: [{ type: 'other', customType: 'งู', name: 'เขียว' }],
        });
      expect(resCustom.status).toBe(400);
      expect(resCustom.body.error.code).toBe('PET_TYPE_NOT_ALLOWED');
    });

    it('5. grandfathered dog remains allowed when policy changes to small_pet', async () => {
      // Tenant already has a dog
      await tenantRepo.update(testTenantId, dormAId, {
        petInfo: [{ id: 'pet-dog-1', type: 'dog', name: 'หมาด่าง' }],
      });
      tenantRepo.setDormitoryPetPolicy(dormAId, {
        allowed: 'conditional',
        allowedTypes: ['small_pet'],
      });

      const tenant = await tenantRepo.findById(testTenantId, dormAId);
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}/profile`)
        .set(authHeaders(ownerAuth, dormAId))
        .send({
          displayName: tenant!.displayName,
          phone: tenant!.phone,
          version: tenant!.version,
          // Grandfathered dog type unchanged, only name modified
          pets: [{ id: 'pet-dog-1', type: 'dog', name: 'หมาด่างแสนรู้' }],
        });

      expect(res.status).toBe(200);
      const updated = await tenantRepo.findById(testTenantId, dormAId);
      expect(updated?.petInfo[0].id).toBe('pet-dog-1');
      expect(updated?.petInfo[0].name).toBe('หมาด่างแสนรู้');
    });
  });
});
