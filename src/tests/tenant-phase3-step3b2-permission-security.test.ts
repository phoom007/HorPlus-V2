import { describe, it, expect, beforeAll, vi } from 'vitest';
import express, { Express, Router } from 'express';
import request from '../../server/node_modules/supertest/index.js';
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
import { InMemoryTenantRepository } from '../../server/src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../server/src/db/repositories/contract.repository.js';
import { globalErrorHandler } from '../../server/src/middleware/error-handler.js';
import { subscriptionEntitlementService } from '../../server/src/services/subscription-entitlement.service.js';
import { billingOrchestrationService } from '../../server/src/services/billing-orchestration.service.js';
import {
  toTenantApiDTO,
  toCoOccupantApiDTO,
  toEmergencyContactApiDTO,
  toVehicleApiDTO,
  toContractApiDTO,
  toOccupancyApiDTO,
  toDailyStayApiDTO,
  toBillApiDTO,
  toSettlementApiDTO,
  toRoomSummaryApiDTO,
  toTenantDetailsApiDTO,
} from '../../server/src/mappers/tenant-api.mapper.js';

if (typeof localStorage === 'undefined') {
  let store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
}

/**
 * Recursive assertion helper to guarantee that a forbidden sensitive key
 * (such as 'nationalIdEncrypted' or 'idCardObjectKey') does not appear ANYWHERE
 * in a response object tree.
 */
function assertForbiddenKeyAbsent(target: any, forbiddenKey: string, currentPath = '$'): void {
  if (target === null || target === undefined) return;
  if (Array.isArray(target)) {
    target.forEach((item, index) => {
      assertForbiddenKeyAbsent(item, forbiddenKey, `${currentPath}[${index}]`);
    });
    return;
  }
  if (typeof target === 'object') {
    for (const key of Object.keys(target)) {
      if (key === forbiddenKey) {
        throw new Error(`Forbidden key "${forbiddenKey}" found at path "${currentPath}.${key}"`);
      }
      assertForbiddenKeyAbsent(target[key], forbiddenKey, `${currentPath}.${key}`);
    }
  }
}

describe('TENANT PHASE 3 STEP 3B.2: Owner Tenant API Permission & Final Security Closure', () => {
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
  let managerUserId: string;
  let staffUserId: string;
  let tenantUserId: string;
  let crossOwnerUserId: string;

  let ownerAuth: any;
  let managerAuth: any;
  let staffAuth: any;
  let tenantAuth: any;
  let crossOwnerAuth: any;

  let testTenantId: string;

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

    const mockGoogleVerifier: any = {};
    const mockAuditService: any = {
      log: async () => {},
      logAction: async () => {},
      logSecurityEvent: async () => {},
    };

    sensitiveFieldService = new SensitiveFieldService(env.FIELD_ENCRYPTION_KEY, env.FIELD_ENCRYPTION_KEY_VERSION);
    tenantService = new TenantService(tenantRepo, contractRepo, sensitiveFieldService, mockAuditService);

    authService = new AuthenticationService(
      env,
      mockGoogleVerifier,
      userRepo,
      sessionRepo,
      membershipRepo,
      roleRepo,
      mockAuditService
    );

    // 1. Create Users
    const ownerUser = await userRepo.upsertFromGoogle({
      email: 'owner@dorma.com',
      name: 'Dorm A Owner',
      googleSubject: 'g-sub-owner-a',
    });
    ownerUserId = ownerUser.id;

    const managerUser = await userRepo.upsertFromGoogle({
      email: 'manager@dorma.com',
      name: 'Dorm A Manager',
      googleSubject: 'g-sub-manager-a',
    });
    managerUserId = managerUser.id;

    const staffUser = await userRepo.upsertFromGoogle({
      email: 'staff@dorma.com',
      name: 'Dorm A Staff',
      googleSubject: 'g-sub-staff-a',
    });
    staffUserId = staffUser.id;

    const tenantUser = await userRepo.upsertFromGoogle({
      email: 'tenant@dorma.com',
      name: 'Dorm A Tenant User',
      googleSubject: 'g-sub-tenant-a',
    });
    tenantUserId = tenantUser.id;

    const crossOwnerUser = await userRepo.upsertFromGoogle({
      email: 'owner@dormb.com',
      name: 'Dorm B Owner',
      googleSubject: 'g-sub-owner-b',
    });
    crossOwnerUserId = crossOwnerUser.id;

    // 2. Create Memberships
    // OWNER membership in Dorm A
    await membershipRepo.addMembership({
      userId: ownerUserId,
      dormitoryId: dormAId,
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    // MANAGER membership in Dorm A (seeded with basic role, tests that manager receives full Tenant capabilities!)
    await membershipRepo.addMembership({
      userId: managerUserId,
      dormitoryId: dormAId,
      roleId: 'role-manager',
      roleCode: 'MANAGER',
      status: 'active',
    });

    // STAFF membership in Dorm A (Read-only)
    await membershipRepo.addMembership({
      userId: staffUserId,
      dormitoryId: dormAId,
      roleId: 'role-staff',
      roleCode: 'STAFF',
      status: 'active',
    });

    // TENANT membership in Dorm A
    await membershipRepo.addMembership({
      userId: tenantUserId,
      dormitoryId: dormAId,
      roleId: 'role-tenant',
      roleCode: 'TENANT',
      status: 'active',
    });

    // OWNER membership in Dorm B
    await membershipRepo.addMembership({
      userId: crossOwnerUserId,
      dormitoryId: dormBId,
      roleId: 'role-owner',
      roleCode: 'OWNER',
      status: 'active',
    });

    // 3. Authenticate Test Users to obtain real sessions & CSRF tokens
    ownerAuth = await authService.authenticateTestUser(ownerUserId);
    managerAuth = await authService.authenticateTestUser(managerUserId);
    staffAuth = await authService.authenticateTestUser(staffUserId);
    tenantAuth = await authService.authenticateTestUser(tenantUserId);
    crossOwnerAuth = await authService.authenticateTestUser(crossOwnerUserId);

    // 4. Seed a Tenant record in Dorm A with co-occupants, emergency contact (with isPrimary), vehicle
    const createdTenant = await tenantRepo.create(dormAId, {
      tenantNumber: 'T-001',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      displayName: 'นายสมชาย ใจดี',
      phone: '0812345678',
      email: 'somchai@example.com',
      status: 'active',
    });
    testTenantId = createdTenant.id;

    await tenantRepo.createEmergencyContact(dormAId, testTenantId, {
      name: 'นางสมศรี ใจดี',
      phone: '0898765432',
      relationship: 'มารดา',
      isPrimary: true,
    });

    await tenantRepo.createVehicle(dormAId, testTenantId, {
      type: 'car',
      licensePlate: '1กก-1234',
      province: 'กรุงเทพมหานคร',
      brand: 'Toyota',
      model: 'Yaris',
      color: 'ขาว',
      status: 'active',
    });

    await tenantRepo.createCoOccupant(dormAId, testTenantId, {
      contractId: null,
      name: 'นายสมศักดิ์ ใจดี',
      phone: '0855555555',
      relationship: 'น้องชาย',
      nationalIdMasked: '1-1004-XXXXX-99-9',
      status: 'active',
    });

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined);
    vi.spyOn(billingOrchestrationService, 'addTenantCoOccupant').mockResolvedValue({
      coOccupant: {
        id: 'co-new-1',
        tenantId: testTenantId,
        dormitoryId: dormAId,
        name: 'ผู้ร่วมพักใหม่ โดยผู้จัดการ',
        relationship: 'เพื่อน',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      peopleCount: 2,
      recalculation: null,
    } as any);

    // 5. Build canonical parent Express application with real middleware composition:
    // requireSession -> resolveDormitoryContextMiddleware -> requireActiveDormitory -> createTenantRouter
    app = express();
    app.use(express.json());
    app.use(cookieParserMiddleware);
    app.use(requestIdMiddleware);

    const requireSession = authService.requireAuth();
    const mockPrisma: any = {
      dormitory: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (where.id === dormAId) {
            return { id: dormAId, name: 'Dormitory A', status: 'active', deletedAt: null };
          }
          if (where.id === dormBId) {
            return { id: dormBId, name: 'Dormitory B', status: 'active', deletedAt: null };
          }
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

  const authHeaders = (auth: any, dormId = dormAId) => ({
    Cookie: `horplus_session=${auth.sessionToken}; horplus_csrf=${auth.csrfToken}`,
    'x-csrf-token': auth.csrfToken,
    'x-dormitory-id': dormId,
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. OWNER FULL TENANT AUTHORITY
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. OWNER Full Tenant Authority', () => {
    it('allows OWNER to list tenants', async () => {
      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(ownerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThan(0);
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });

    it('allows OWNER to get tenant details', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(ownerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data.tenant).toBeDefined();
      expect(res.body.data.tenant.id).toBe(testTenantId);
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });

    it('allows OWNER to create a tenant', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(ownerAuth))
        .send({
          displayName: 'นายวิชัย สุขใจ',
          phone: '0891112233',
          nationalId: '1100412345678',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.displayName).toBe('นายวิชัย สุขใจ');
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });

    it('allows OWNER to update a tenant', async () => {
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(ownerAuth))
        .send({
          displayName: 'นายสมชาย ใจดี ยิ่งขึ้น',
          phone: '0812345679',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.displayName).toBe('นายสมชาย ใจดี ยิ่งขึ้น');
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
    });

    it('allows OWNER to upload identity document and strictly omits idCardObjectKey', async () => {
      const res = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(ownerAuth))
        .attach('file', validPngBuffer, 'id-card.png');

      expect(res.status).toBe(200);
      expect(res.body.data.tenantId).toBe(testTenantId);
      expect(res.body.data.hasIdentityDocument).toBe(true);
      assertForbiddenKeyAbsent(res.body, 'idCardObjectKey');
      assertForbiddenKeyAbsent(res.body, 'idCardUploadedByUserId');
    });

    it('allows OWNER to read identity document', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(ownerAuth));

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/webp');
    });

    it('allows OWNER to archive a tenant (DELETE /tenants/:id)', async () => {
      const newTenant = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-TEMP-OWNER',
        firstName: 'ทดสอบ',
        displayName: 'ทดสอบ ลบ',
        phone: '0899999999',
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/v1/tenants/${newTenant.id}`)
        .set(authHeaders(ownerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      const archivedRecord = (tenantRepo as any).tenants.get(newTenant.id);
      expect(archivedRecord?.status).toBe('archived');
      expect(await tenantRepo.findById(newTenant.id)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. MANAGER FULL TENANT AUTHORITY EQUIVALENT TO OWNER
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. MANAGER Full Tenant Authority', () => {
    it('allows MANAGER to list tenants', async () => {
      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(managerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      assertForbiddenKeyAbsent(res.body, 'nationalIdEncrypted');
    });

    it('allows MANAGER to get tenant details', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(managerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data.tenant.id).toBe(testTenantId);
    });

    it('allows MANAGER to create a tenant', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(managerAuth))
        .send({
          displayName: 'นายผู้เช่า สร้างโดยผู้จัดการ',
          phone: '0867778899',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.displayName).toBe('นายผู้เช่า สร้างโดยผู้จัดการ');
    });

    it('allows MANAGER to update a tenant', async () => {
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(managerAuth))
        .send({
          notes: 'อัปเดตโดยผู้จัดการ',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.notes).toBe('อัปเดตโดยผู้จัดการ');
    });

    it('allows MANAGER to manage sub-entities (co-occupants, emergency contacts, vehicles)', async () => {
      // Co-occupant create
      const coRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/co-occupants`)
        .set(authHeaders(managerAuth))
        .send({
          name: 'ผู้ร่วมพักใหม่ โดยผู้จัดการ',
          relationship: 'เพื่อน',
        });
      expect(coRes.status).toBe(201);

      // Emergency contact create
      const ecRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/emergency-contacts`)
        .set(authHeaders(managerAuth))
        .send({
          name: 'ผู้ติดต่อฉุกเฉิน โดยผู้จัดการ',
          phone: '0812349999',
          relationship: 'ญาติ',
          isPrimary: false,
        });
      expect(ecRes.status).toBe(201);
      expect(ecRes.body.data.isPrimary).toBe(false);

      // Vehicle create
      const vehRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/vehicles`)
        .set(authHeaders(managerAuth))
        .send({
          type: 'motorcycle',
          licensePlate: '2ขข-5678',
        });
      expect(vehRes.status).toBe(201);
    });

    it('allows MANAGER to upload and read identity document', async () => {
      const uploadRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(managerAuth))
        .attach('file', validPngBuffer, 'id-mgr.png');

      expect(uploadRes.status).toBe(200);
      expect(uploadRes.body.data.hasIdentityDocument).toBe(true);

      const readRes = await request(app)
        .get(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(managerAuth));

      expect(readRes.status).toBe(200);
    });

    it('allows MANAGER to archive a tenant', async () => {
      const newTenant = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-TEMP-MGR',
        firstName: 'ทดสอบ',
        displayName: 'ทดสอบ ลบโดยผู้จัดการ',
        phone: '0899999998',
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/v1/tenants/${newTenant.id}`)
        .set(authHeaders(managerAuth));

      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
      const archivedRecord = (tenantRepo as any).tenants.get(newTenant.id);
      expect(archivedRecord?.status).toBe('archived');
      expect(await tenantRepo.findById(newTenant.id)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. STAFF STRICT READ-ONLY ENFORCEMENT
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. STAFF Strict Read-Only Enforcement', () => {
    it('allows STAFF to view tenant list and details', async () => {
      const listRes = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(staffAuth));
      expect(listRes.status).toBe(200);

      const detailRes = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(staffAuth));
      expect(detailRes.status).toBe(200);
    });

    it('forbids STAFF from creating tenant (403)', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(staffAuth))
        .send({
          displayName: 'พยายามสร้างโดยพนักงาน',
          phone: '0811111111',
        });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids STAFF from updating tenant (403)', async () => {
      const res = await request(app)
        .put(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(staffAuth))
        .send({ notes: 'พยายามแก้ไข' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids STAFF from archiving tenant (403)', async () => {
      const res = await request(app)
        .delete(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(staffAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids STAFF from modifying sub-entities (403)', async () => {
      const coRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/co-occupants`)
        .set(authHeaders(staffAuth))
        .send({ name: 'พนักงานสร้าง' });
      expect(coRes.status).toBe(403);

      const ecRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/emergency-contacts`)
        .set(authHeaders(staffAuth))
        .send({ name: 'พนักงานสร้าง', phone: '0811111111', relationship: 'เพื่อน' });
      expect(ecRes.status).toBe(403);

      const vehRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/vehicles`)
        .set(authHeaders(staffAuth))
        .send({ type: 'car', licensePlate: '9กก-9999' });
      expect(vehRes.status).toBe(403);
    });

    it('forbids STAFF from reading identity document (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(staffAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids STAFF from uploading identity document before file parsing (403)', async () => {
      const res = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(staffAuth))
        .attach('file', validPngBuffer, 'id-staff.png');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. TENANT ROLE HARD DENY ON OWNER APIS
  // ──────────────────────────────────────────────────────────────────────────
  describe('4. TENANT Role Hard Deny on Owner Tenant APIs', () => {
    it('denies TENANT role from GET /api/v1/tenants (403)', async () => {
      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(tenantAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies TENANT role from GET /api/v1/tenants/:id (403)', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(tenantAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies TENANT role from POST /api/v1/tenants (403)', async () => {
      const res = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(tenantAuth))
        .send({ displayName: 'แอบสร้าง' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('denies TENANT role from ID document read & write (403)', async () => {
      const readRes = await request(app)
        .get(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(tenantAuth));
      expect(readRes.status).toBe(403);

      const writeRes = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(tenantAuth))
        .attach('file', validPngBuffer, 'id-tenant.png');
      expect(writeRes.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. CROSS-DORMITORY ISOLATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('5. Cross-Dormitory Isolation', () => {
    it('denies user from Dorm B when requesting Dorm A context (403)', async () => {
      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(crossOwnerAuth, dormAId)); // Header says Dorm A, but user only has Dorm B membership
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('fails closed when Dorm B user requests a Dorm A tenant under Dorm B context (404)', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(crossOwnerAuth, dormBId)); // Authorized in Dorm B, but tenant belongs to Dorm A
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. EMERGENCY CONTACT DTO WITH isPrimary
  // ──────────────────────────────────────────────────────────────────────────
  describe('6. Emergency Contact DTO with isPrimary', () => {
    it('preserves and maps isPrimary: boolean in SafeEmergencyContactApiDTO', () => {
      const rawContactPrimary = {
        id: 'ec-1',
        tenantId: 't-1',
        dormitoryId: 'd-1',
        name: 'คุณแม่',
        phone: '0812345678',
        relationship: 'มารดา',
        isPrimary: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const dtoPrimary = toEmergencyContactApiDTO(rawContactPrimary);
      expect(dtoPrimary?.isPrimary).toBe(true);

      const rawContactSecondary = {
        id: 'ec-2',
        tenantId: 't-1',
        dormitoryId: 'd-1',
        name: 'เพื่อนบ้าน',
        phone: '0899999999',
        relationship: 'เพื่อน',
        isPrimary: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const dtoSecondary = toEmergencyContactApiDTO(rawContactSecondary);
      expect(dtoSecondary?.isPrimary).toBe(false);
    });

    it('returns isPrimary in real HTTP tenant details response', async () => {
      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(ownerAuth));

      expect(res.status).toBe(200);
      const contacts = res.body.data.emergencyContacts;
      expect(contacts).toBeDefined();
      expect(contacts.length).toBeGreaterThan(0);
      expect(contacts[0].isPrimary).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. GENERIC-SAFE ERROR RESPONSES (500 / UPLOAD / STORAGE)
  // ──────────────────────────────────────────────────────────────────────────
  describe('7. Generic-Safe Error Responses (No Internal Leakage)', () => {
    it('returns generic safe error response on internal database/service failure without leaking message or stack', async () => {
      const getSpy = vi.spyOn(tenantRepo, 'findById').mockRejectedValueOnce(
        new Error('PRISMA_QUERY_FAILED: Connection timeout at /var/run/postgresql/.s.PGSQL.5432 with password ***')
      );

      const res = await request(app)
        .get(`/api/v1/tenants/${testTenantId}`)
        .set(authHeaders(ownerAuth));

      getSpy.mockRestore();

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('TENANT_OPERATION_FAILED');
      expect(res.body.error.message).toBe('เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง');
      // Verify internal path, query, and password are NOT in serialized response
      const jsonStr = JSON.stringify(res.body);
      expect(jsonStr).not.toContain('PRISMA_QUERY_FAILED');
      expect(jsonStr).not.toContain('/var/run/postgresql');
      expect(jsonStr).not.toContain('password');
    });

    it('returns generic safe error response on unexpected upload/storage error without leaking internal path', async () => {
      const saveSpy = vi.spyOn(tenantRepo, 'update').mockRejectedValueOnce(
        new Error('EACCES: permission denied, open /secure/internal/storage/keys/id_card_001.webp')
      );

      const res = await request(app)
        .post(`/api/v1/tenants/${testTenantId}/identity-document`)
        .set(authHeaders(ownerAuth))
        .attach('file', validPngBuffer, 'id-test.png');

      saveSpy.mockRestore();

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('TENANT_OPERATION_FAILED');
      expect(res.body.error.message).toBe('เกิดข้อผิดพลาดในการดำเนินการ กรุณาลองใหม่อีกครั้ง');
      const jsonStr = JSON.stringify(res.body);
      expect(jsonStr).not.toContain('/secure/internal/storage');
      expect(jsonStr).not.toContain('EACCES');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. EXPLICIT SAFE AGGREGATE DTOS & NESTED WHITELIST SANITIZATION
  // ──────────────────────────────────────────────────────────────────────────
  describe('8. Explicit Safe Aggregate DTOs', () => {
    it('toContractApiDTO strictly strips raw signature blobs, internal user IDs, and secrets', () => {
      const rawContract = {
        id: 'c-001',
        contractNumber: 'CN-2026-001',
        tenantId: 't-001',
        dormitoryId: 'd-001',
        roomId: 'r-001',
        status: 'active',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        durationMonths: 12,
        rentBillingType: 'monthly',
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        // Sensitive internals to be stripped:
        signatureBlobRaw: '0xDEADBEEF...',
        internalCreatedByUserId: 'usr-admin-secret',
        encryptionVersion: 2,
        paymentProviderSecret: 'sk_live_123456789',
        room: {
          id: 'r-001',
          roomNumber: '101',
          buildingId: 'b-001',
          floor: 1,
          roomType: 'studio',
          status: 'occupied',
          rawBuildingPrismaRelation: { secret: true },
        },
      };

      const dto = toContractApiDTO(rawContract);
      expect(dto?.id).toBe('c-001');
      expect(dto?.contractNumber).toBe('CN-2026-001');
      expect(dto?.rentAmount).toBe(5000);
      expect(dto?.room?.roomNumber).toBe('101');

      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('signatureBlobRaw');
      expect(jsonStr).not.toContain('usr-admin-secret');
      expect(jsonStr).not.toContain('sk_live_123456789');
      expect(jsonStr).not.toContain('rawBuildingPrismaRelation');
    });

    it('toOccupancyApiDTO strictly strips endedByUserId and internal operator metadata', () => {
      const rawOccupancy = {
        id: 'occ-001',
        tenantId: 't-001',
        dormitoryId: 'd-001',
        roomId: 'r-001',
        status: 'ACTIVE',
        startedAt: '2026-01-01',
        endedAt: null,
        endedReason: null,
        endedByUserId: 'usr-secret-admin',
        auditLogId: 'audit-999',
      };

      const dto = toOccupancyApiDTO(rawOccupancy);
      expect(dto?.id).toBe('occ-001');
      expect(dto?.status).toBe('ACTIVE');

      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('usr-secret-admin');
      expect(jsonStr).not.toContain('auditLogId');
    });

    it('toDailyStayApiDTO strictly separates daily stays from contract and strips operator actor IDs', () => {
      const rawDailyStay = {
        id: 'ds-001',
        tenantId: 't-001',
        dormitoryId: 'd-001',
        roomId: 'r-001',
        status: 'CHECKED_IN',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        inclusiveDayCount: 4,
        dailyRateAmount: 800,
        totalRentAmount: 3200,
        depositAmount: 500,
        depositDeclaredStatus: 'PAID',
        checkedInByUserId: 'usr-desk-clerk',
        internalNotes: 'VIP guest',
      };

      const dto = toDailyStayApiDTO(rawDailyStay);
      expect(dto?.id).toBe('ds-001');
      expect(dto?.totalRentAmount).toBe(3200);

      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('checkedInByUserId');
      expect(jsonStr).not.toContain('internalNotes');
    });

    it('toBillApiDTO strictly strips payment secrets, internal slip object keys, and reviewer IDs', () => {
      const rawBill = {
        id: 'bill-001',
        dormitoryId: 'd-001',
        tenantId: 't-001',
        roomId: 'r-001',
        billingCycleId: 'bc-001',
        billNumber: 'B-2026-09-001',
        billKind: 'MONTHLY_UTILITY',
        billingDate: '2026-09-01',
        dueDate: '2026-09-05',
        status: 'PENDING',
        subtotal: 5500,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5500,
        paidAmount: 0,
        outstandingAmount: 5500,
        rawSlipObjectKey: 'slips/2026/09/internal_slip_xyz.jpg',
        approvedByUserId: 'usr-accountant',
        paymentGatewaySecretKey: 'whsec_99999',
        items: [
          {
            id: 'bi-1',
            billId: 'bill-001',
            type: 'rent',
            name: 'ค่าเช่าห้อง',
            amount: 5000,
            quantity: 1,
            unitPrice: 5000,
            internalAccountingLedgerId: 'acct-ledger-777',
          },
        ],
      };

      const dto = toBillApiDTO(rawBill);
      expect(dto?.id).toBe('bill-001');
      expect(dto?.totalAmount).toBe(5500);
      expect(dto?.items?.[0].name).toBe('ค่าเช่าห้อง');

      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('rawSlipObjectKey');
      expect(jsonStr).not.toContain('approvedByUserId');
      expect(jsonStr).not.toContain('paymentGatewaySecretKey');
      expect(jsonStr).not.toContain('acct-ledger-777');
    });

    it('toSettlementApiDTO strictly strips bank account numbers, PromptPay accounts, and provider secrets', () => {
      const rawSettlement = {
        id: 'set-001',
        tenantId: 't-001',
        dormitoryId: 'd-001',
        contractId: 'c-001',
        roomId: 'r-001',
        depositAmount: 10000,
        unpaidBillAmount: 2000,
        damageChargeTotal: 1500,
        netSettlement: 6500,
        settlementDirection: 'REFUND',
        settlementStatus: 'COMPLETED',
        refundBankAccountNumber: '123-4-56789-0',
        refundPromptPayId: '0812345678',
        refundTransactionId: 'txn_kbank_9999',
        items: [
          {
            id: 'si-1',
            description: 'ค่าทำความสะอาด',
            amount: 500,
            evidenceUrl: 'https://storage/evidence/clean.jpg',
            internalDamageCode: 'DMG-001',
          },
        ],
      };

      const dto = toSettlementApiDTO(rawSettlement);
      expect(dto?.id).toBe('set-001');
      expect(dto?.netSettlement).toBe(6500);
      expect(dto?.items?.[0].description).toBe('ค่าทำความสะอาด');

      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('refundBankAccountNumber');
      expect(jsonStr).not.toContain('refundPromptPayId');
      expect(jsonStr).not.toContain('txn_kbank_9999');
      expect(jsonStr).not.toContain('DMG-001');
    });

    it('toRoomSummaryApiDTO only exposes approved whitelist fields', () => {
      const rawRoom = {
        id: 'rm-101',
        roomNumber: '101',
        buildingId: 'b-01',
        floor: 1,
        roomType: 'Standard',
        status: 'occupied',
        internalNote: 'Needs aircon repair',
        smartLockDeviceId: 'lock-dev-xyz',
      };
      const dto = toRoomSummaryApiDTO(rawRoom);
      expect(dto).toEqual({
        id: 'rm-101',
        roomNumber: '101',
        buildingId: 'b-01',
        floor: 1,
        roomType: 'Standard',
        status: 'occupied',
      });
      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('smartLockDeviceId');
      expect(jsonStr).not.toContain('internalNote');
    });

    it('toBillApiDTO maps canonical Payment fields (method, paymentDate) and strips evidence/hash/reviewer/secrets', () => {
      const rawBill = {
        id: 'bill-pay-test',
        dormitoryId: dormAId,
        tenantId: testTenantId,
        roomId: 'r-001',
        billingCycleId: 'bc-001',
        billNumber: 'B-2026-09-999',
        billKind: 'MONTHLY_UTILITY',
        billingDate: '2026-09-01',
        dueDate: '2026-09-05',
        status: 'PAID',
        subtotal: 5500,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5500,
        paidAmount: 5500,
        outstandingAmount: 0,
        Payment: [
          {
            id: 'pay-actual-01',
            amount: 5500,
            status: 'CONFIRMED',
            method: 'PROMPTPAY',
            paymentDate: new Date('2026-09-02T10:00:00Z'),
            evidenceUrl: 'https://storage/secret/ev-01.jpg',
            fileHash: 'sha256-secret-hash-999',
            reviewedByUserId: 'usr-reviewer-id',
            internalStorageKey: 'keys/internal/pay.bin',
          },
        ],
      };

      const dto = toBillApiDTO(rawBill);
      expect(dto?.payments).toHaveLength(1);
      const paymentDto = dto!.payments![0];
      expect(paymentDto.id).toBe('pay-actual-01');
      expect(paymentDto.amount).toBe(5500);
      expect(paymentDto.status).toBe('CONFIRMED');
      expect(paymentDto.method).toBe('PROMPTPAY');
      expect(paymentDto.paymentDate).toEqual(new Date('2026-09-02T10:00:00Z'));

      // Non-canonical / fictional fields must not exist
      expect((paymentDto as any).paymentMethod).toBeUndefined();
      expect((paymentDto as any).paidAt).toBeUndefined();
      expect((paymentDto as any).paymentNumber).toBeUndefined();

      // Stripped internals
      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('evidenceUrl');
      expect(jsonStr).not.toContain('fileHash');
      expect(jsonStr).not.toContain('reviewedByUserId');
      expect(jsonStr).not.toContain('internalStorageKey');
    });

    it('toBillApiDTO maps canonical Receipt fields (receiptNumber, receiptKind, isVoided, issuedAt) and strips snapshotData/status/total', () => {
      const rawBill = {
        id: 'bill-rec-test',
        dormitoryId: dormAId,
        tenantId: testTenantId,
        roomId: 'r-001',
        billingCycleId: 'bc-001',
        billNumber: 'B-2026-09-888',
        billKind: 'MONTHLY_UTILITY',
        billingDate: '2026-09-01',
        dueDate: '2026-09-05',
        status: 'PAID',
        subtotal: 5500,
        discountAmount: 0,
        fineAmount: 0,
        totalAmount: 5500,
        paidAmount: 5500,
        outstandingAmount: 0,
        Receipt: [
          {
            id: 'rec-actual-01',
            receiptNumber: 'RC-2026-0001',
            receiptKind: 'EVENT',
            isVoided: false,
            issuedAt: new Date('2026-09-02T10:05:00Z'),
            snapshotData: { rawTaxId: '1234567890123', secretMemo: 'Internal only' },
            totalAmount: 5500, // Non-canonical on Receipt model
            status: 'ISSUED',  // Non-canonical on Receipt model
          },
        ],
      };

      const dto = toBillApiDTO(rawBill);
      expect(dto?.receipts).toHaveLength(1);
      const receiptDto = dto!.receipts![0];
      expect(receiptDto.id).toBe('rec-actual-01');
      expect(receiptDto.receiptNumber).toBe('RC-2026-0001');
      expect(receiptDto.receiptKind).toBe('EVENT');
      expect(receiptDto.isVoided).toBe(false);
      expect(receiptDto.issuedAt).toEqual(new Date('2026-09-02T10:05:00Z'));

      // Non-canonical / fictional fields must not exist
      expect((receiptDto as any).totalAmount).toBeUndefined();
      expect((receiptDto as any).status).toBeUndefined();

      // Raw snapshotData must never leak
      const jsonStr = JSON.stringify(dto);
      expect(jsonStr).not.toContain('snapshotData');
      expect(jsonStr).not.toContain('rawTaxId');
      expect(jsonStr).not.toContain('secretMemo');
    });

    it('toDailyStayApiDTO maps canonical DailyStayInvoice fields (totalAgreedAmount, outstandingAmount, depositDeclaredStatus) without totalAmount', () => {
      const rawDailyStay = {
        id: 'ds-inv-test',
        tenantId: testTenantId,
        dormitoryId: dormAId,
        roomId: 'r-001',
        status: 'CHECKED_IN',
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        inclusiveDayCount: 4,
        dailyRateAmount: 800,
        totalRentAmount: 3200,
        depositAmount: 500,
        depositDeclaredStatus: 'PAID',
        invoice: {
          id: 'inv-actual-01',
          invoiceNumber: 'DSI-2026-0001',
          totalRentAmount: 3200,
          depositAmount: 500,
          totalAgreedAmount: 3700,
          outstandingAmount: 0,
          depositDeclaredStatus: 'PAID',
          status: 'SETTLED',
          issuedAt: new Date('2026-09-01T14:00:00Z'),
          totalAmount: 3700, // Non-canonical authority
        },
      };

      const dto = toDailyStayApiDTO(rawDailyStay);
      expect(dto?.invoice).toBeDefined();
      const invDto = dto!.invoice!;
      expect(invDto.id).toBe('inv-actual-01');
      expect(invDto.invoiceNumber).toBe('DSI-2026-0001');
      expect(invDto.totalRentAmount).toBe(3200);
      expect(invDto.depositAmount).toBe(500);
      expect(invDto.totalAgreedAmount).toBe(3700);
      expect(invDto.outstandingAmount).toBe(0);
      expect(invDto.depositDeclaredStatus).toBe('PAID');
      expect(invDto.status).toBe('SETTLED');
      expect(invDto.issuedAt).toEqual(new Date('2026-09-01T14:00:00Z'));

      // Non-canonical totalAmount must not exist
      expect((invDto as any).totalAmount).toBeUndefined();
    });

    it('toContractApiDTO eliminates non-canonical depositStatus and depositType', () => {
      const rawContract = {
        id: 'c-canon-01',
        contractNumber: 'CN-2026-0001',
        tenantId: testTenantId,
        dormitoryId: dormAId,
        roomId: 'r-001',
        status: 'active',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        durationMonths: 12,
        rentBillingType: 'monthly',
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        depositStatus: 'paid',
        depositType: 'fixed',
      };

      const dto = toContractApiDTO(rawContract);
      expect(dto?.id).toBe('c-canon-01');
      expect(dto?.depositAmount).toBe(10000);
      expect((dto as any).depositStatus).toBeUndefined();
      expect((dto as any).depositType).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. SINGLE PERMISSION AUTHORITY: RUNTIME CONTEXT NORMALIZATION (PARTS 15, 16, 17, 18)
  // ──────────────────────────────────────────────────────────────────────────
  describe('9. Single Permission Authority & Runtime Context Normalization', () => {
    const makeReq = async (auth: any, dormId = dormAId) => {
      const validated = await authService.validateSession(auth.sessionToken);
      return {
        auth: {
          userId: validated!.user.id,
          sessionId: validated!.rawSessionId,
          user: validated!.user,
          session: validated!.session,
          memberships: validated!.memberships,
          dormitoryId: dormId,
        },
        headers: { 'x-dormitory-id': dormId },
        cookies: { horplus_session: auth.sessionToken },
      } as any;
    };

    it('PART 15: resolves MANAGER context with full six Tenant capabilities', async () => {
      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(managerAuth, dormAId));
      expect(ctx.roleCode).toBe('MANAGER');
      expect(ctx.permissions).toContain('tenants:view');
      expect(ctx.permissions).toContain('tenants:create');
      expect(ctx.permissions).toContain('tenants:update');
      expect(ctx.permissions).toContain('tenants:archive');
      expect(ctx.permissions).toContain('tenants:document:read');
      expect(ctx.permissions).toContain('tenants:document:write');
    });

    it('PART 15: resolves STAFF context with tenants:view and NO mutation/document capabilities', async () => {
      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(staffAuth, dormAId));
      expect(ctx.roleCode).toBe('STAFF');
      expect(ctx.permissions).toContain('tenants:view');
      expect(ctx.permissions).not.toContain('tenants:create');
      expect(ctx.permissions).not.toContain('tenants:update');
      expect(ctx.permissions).not.toContain('tenants:archive');
      expect(ctx.permissions).not.toContain('tenants:document:read');
      expect(ctx.permissions).not.toContain('tenants:document:write');
    });

    it('PART 15: resolves TENANT context with ZERO Owner Tenant permissions', async () => {
      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(tenantAuth, dormAId));
      expect(ctx.roleCode).toBe('TENANT');
      const tenantPerms = ctx.permissions.filter((p) => p.startsWith('tenants:') || p.startsWith('tenant:'));
      expect(tenantPerms).toEqual([]);
    });

    it('PART 16: grants full authority to legacy MANAGER role intentionally lacking archive & document:write', async () => {
      const legacyMgrRole = {
        id: 'role-legacy-mgr-1',
        dormitoryId: dormAId,
        code: 'MANAGER',
        name: 'Legacy Manager Without Archive',
        permissions: {
          rooms: ['view'],
          tenants: ['view', 'create', 'update', 'document:read'], // Intentionally lacks archive & document:write
        },
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(legacyMgrRole.id, legacyMgrRole);

      const legacyUser = await userRepo.upsertFromGoogle({
        email: 'legacy-mgr@example.com',
        name: 'Legacy Manager',
        googleSubject: 'g-sub-legacy-mgr',
      });
      await membershipRepo.addMembership({
        userId: legacyUser.id,
        dormitoryId: dormAId,
        roleId: legacyMgrRole.id,
        roleCode: 'MANAGER',
        status: 'active',
      });
      const legacyAuth = await authService.authenticateTestUser(legacyUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(legacyAuth, dormAId));
      expect(ctx.permissions).toContain('tenants:archive');
      expect(ctx.permissions).toContain('tenants:document:write');

      const tempTenant = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-LEGACY-MGR',
        firstName: 'ทดสอบ',
        displayName: 'ทดสอบ ลบโดยเลกาซี่',
        phone: '0891112233',
        status: 'active',
      });
      const res = await request(app)
        .delete(`/api/v1/tenants/${tempTenant.id}`)
        .set(authHeaders(legacyAuth));
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
    });

    it('PART 17: strips mutation & doc permissions from contaminated STAFF role, leaving only tenants:view', async () => {
      const contaminatedRole = {
        id: 'role-contaminated-staff-1',
        dormitoryId: dormAId,
        code: 'STAFF',
        name: 'Contaminated Staff',
        permissions: {
          rooms: ['view'],
          tenants: ['view', 'create', 'update', 'archive', 'document:read', 'document:write'], // Contaminated!
        },
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(contaminatedRole.id, contaminatedRole);

      const badStaffUser = await userRepo.upsertFromGoogle({
        email: 'bad-staff@example.com',
        name: 'Bad Staff',
        googleSubject: 'g-sub-bad-staff',
      });
      await membershipRepo.addMembership({
        userId: badStaffUser.id,
        dormitoryId: dormAId,
        roleId: contaminatedRole.id,
        roleCode: 'STAFF',
        status: 'active',
      });
      const badStaffAuth = await authService.authenticateTestUser(badStaffUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(badStaffAuth, dormAId));
      expect(ctx.permissions).toContain('tenants:view');
      expect(ctx.permissions).not.toContain('tenants:create');
      expect(ctx.permissions).not.toContain('tenants:update');
      expect(ctx.permissions).not.toContain('tenants:archive');
      expect(ctx.permissions).not.toContain('tenants:document:read');
      expect(ctx.permissions).not.toContain('tenants:document:write');

      const res = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(badStaffAuth))
        .send({
          firstName: 'พนักงานแอบสร้าง',
          phone: '0899990000',
        });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PART 18: strips all Owner Tenant permissions from contaminated TENANT role, rejecting HTTP with 403', async () => {
      const contaminatedTenantRole = {
        id: 'role-contaminated-tenant-1',
        dormitoryId: dormAId,
        code: 'TENANT',
        name: 'Contaminated Tenant',
        permissions: {
          tenants: ['view', 'create', 'update', 'archive', 'document:read', 'document:write'], // Contaminated!
        },
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(contaminatedTenantRole.id, contaminatedTenantRole);

      const rogueTenantUser = await userRepo.upsertFromGoogle({
        email: 'rogue-tenant@example.com',
        name: 'Rogue Tenant',
        googleSubject: 'g-sub-rogue-tenant',
      });
      await membershipRepo.addMembership({
        userId: rogueTenantUser.id,
        dormitoryId: dormAId,
        roleId: contaminatedTenantRole.id,
        roleCode: 'TENANT',
        status: 'active',
      });
      const rogueTenantAuth = await authService.authenticateTestUser(rogueTenantUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(rogueTenantAuth, dormAId));
      const survivingPerms = ctx.permissions.filter((p) => p.startsWith('tenants:') || p.startsWith('tenant:'));
      expect(survivingPerms).toEqual([]);

      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(rogueTenantAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('PART 19 (Wildcard Hardening A): strips global wildcard from contaminated MANAGER role, preventing global owner escalation while preserving full Tenant domain', async () => {
      const wildcardManagerRole = {
        id: 'role-wildcard-manager-1',
        dormitoryId: dormAId,
        code: 'MANAGER',
        name: 'Contaminated Wildcard Manager',
        permissions: ['*'], // Contaminated with global wildcard!
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(wildcardManagerRole.id, wildcardManagerRole);

      const wcManagerUser = await userRepo.upsertFromGoogle({
        email: 'wc-manager@example.com',
        name: 'Wildcard Manager',
        googleSubject: 'g-sub-wc-manager',
      });
      await membershipRepo.addMembership({
        userId: wcManagerUser.id,
        dormitoryId: dormAId,
        roleId: wildcardManagerRole.id,
        roleCode: 'MANAGER',
        status: 'active',
      });
      const wcManagerAuth = await authService.authenticateTestUser(wcManagerUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(wcManagerAuth, dormAId));
      // Global '*' must NOT survive for MANAGER
      expect(ctx.permissions).not.toContain('*');
      // But full Tenant domain must be present
      expect(ctx.permissions).toContain('tenants:view');
      expect(ctx.permissions).toContain('tenants:create');
      expect(ctx.permissions).toContain('tenants:update');
      expect(ctx.permissions).toContain('tenants:archive');
      expect(ctx.permissions).toContain('tenants:document:read');
      expect(ctx.permissions).toContain('tenants:document:write');

      // HTTP action inside Tenant domain succeeds
      const tempTenant = await tenantRepo.create(dormAId, {
        tenantNumber: 'T-WC-MGR',
        firstName: 'ทดสอบ',
        displayName: 'ทดสอบ ไวด์การ์ด',
        phone: '0891114455',
        status: 'active',
      });
      const res = await request(app)
        .delete(`/api/v1/tenants/${tempTenant.id}`)
        .set(authHeaders(wcManagerAuth));
      expect(res.status).toBe(200);
      expect(res.body.data.success).toBe(true);
    });

    it('PART 20 (Wildcard Hardening B): strips global wildcard from contaminated STAFF role, allowing tenants:view but strictly blocking Tenant mutations', async () => {
      const wildcardStaffRole = {
        id: 'role-wildcard-staff-1',
        dormitoryId: dormAId,
        code: 'STAFF',
        name: 'Contaminated Wildcard Staff',
        permissions: ['*'], // Contaminated with global wildcard!
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(wildcardStaffRole.id, wildcardStaffRole);

      const wcStaffUser = await userRepo.upsertFromGoogle({
        email: 'wc-staff@example.com',
        name: 'Wildcard Staff',
        googleSubject: 'g-sub-wc-staff',
      });
      await membershipRepo.addMembership({
        userId: wcStaffUser.id,
        dormitoryId: dormAId,
        roleId: wildcardStaffRole.id,
        roleCode: 'STAFF',
        status: 'active',
      });
      const wcStaffAuth = await authService.authenticateTestUser(wcStaffUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(wcStaffAuth, dormAId));
      // Global '*' must NOT survive for STAFF
      expect(ctx.permissions).not.toContain('*');
      // Must retain ONLY tenants:view / tenant:view in tenant domain
      expect(ctx.permissions).toContain('tenants:view');
      expect(ctx.permissions).not.toContain('tenants:create');
      expect(ctx.permissions).not.toContain('tenants:update');
      expect(ctx.permissions).not.toContain('tenants:archive');
      expect(ctx.permissions).not.toContain('tenants:document:read');
      expect(ctx.permissions).not.toContain('tenants:document:write');

      // HTTP GET allowed
      const getRes = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(wcStaffAuth));
      expect(getRes.status).toBe(200);

      // HTTP POST mutation strictly rejected with 403 Forbidden
      const postRes = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders(wcStaffAuth))
        .send({
          firstName: 'พนักงานไวด์การ์ด',
          phone: '0812345678',
        });
      expect(postRes.status).toBe(403);
      expect(postRes.body.error.code).toBe('FORBIDDEN');
    });

    it('PART 21 (Wildcard Hardening C): strips global wildcard from contaminated TENANT role, denying Owner Tenant API access completely', async () => {
      const wildcardTenantRole = {
        id: 'role-wildcard-tenant-1',
        dormitoryId: dormAId,
        code: 'TENANT',
        name: 'Contaminated Wildcard Tenant',
        permissions: ['*'], // Contaminated with global wildcard!
        isSystem: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (roleRepo as any).roles.set(wildcardTenantRole.id, wildcardTenantRole);

      const wcTenantUser = await userRepo.upsertFromGoogle({
        email: 'wc-tenant@example.com',
        name: 'Wildcard Tenant',
        googleSubject: 'g-sub-wc-tenant',
      });
      await membershipRepo.addMembership({
        userId: wcTenantUser.id,
        dormitoryId: dormAId,
        roleId: wildcardTenantRole.id,
        roleCode: 'TENANT',
        status: 'active',
      });
      const wcTenantAuth = await authService.authenticateTestUser(wcTenantUser.id);

      const ctx = await resolveAuthoritativeDormitoryContext(await makeReq(wcTenantAuth, dormAId));
      // Global '*' must NOT survive
      expect(ctx.permissions).not.toContain('*');
      // ZERO Owner Tenant permissions survive
      const survivingPerms = ctx.permissions.filter((p) => p.startsWith('tenants:') || p.startsWith('tenant:'));
      expect(survivingPerms).toEqual([]);

      // HTTP GET must be rejected with 403 Forbidden
      const res = await request(app)
        .get('/api/v1/tenants')
        .set(authHeaders(wcTenantAuth));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
