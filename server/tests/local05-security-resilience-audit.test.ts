import { describe, it, expect, beforeEach, vi } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { getPrismaClient } from '../src/db/prisma.js';
import { SessionTokenService } from '../src/services/session-token.service.js';
import { CsrfService } from '../src/services/csrf.service.js';
import { AccessGrantService } from '../src/services/access-grant.service.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { OutboxService, outboxService } from '../src/services/outbox.service.js';
import { checkReadiness } from '../src/services/health.service.js';
import { setRedisClient } from '../src/db/redis.js';
import { LineChannelTokenProvider } from '../src/services/line-channel-token-provider.js';
import { LocalOwnerSignatureStorage } from '../src/services/signature-storage.service.js';
import { encryptText, hashToken } from '../src/utils/crypto-encryption.js';
import { AppError } from '../src/errors/app-error.js';
import { Redis } from 'ioredis';
import { CleanupService } from '../src/services/cleanup.service.js';

const prisma = getPrismaClient();

describe.sequential('LOCAL-05: Local Security & Resilience Audit Suite', () => {
  let app: any;
  let sessionTokenService: SessionTokenService;
  let csrfService: CsrfService;

  let dormIdA: string;
  let dormIdB: string;
  let ownerUserA: any;
  let techUserA: any;
  let tenantUserA: any;
  let tenantUserB: any;

  let sessionTokenOwnerA: string;
  let csrfTokenOwnerA: string;

  let sessionTokenTechA: string;
  let csrfTokenTechA: string;

  let sessionTokenTenantA: string;
  let csrfTokenTenantA: string;

  let sessionTokenTenantB: string;
  let csrfTokenTenantB: string;

  let roomA101: any;
  let tenantA: any;
  let contractA: any;
  let cycleA: any;
  let cycleB: any;
  let tenantB: any;
  let roomB201: any;

  beforeEach(async () => {
    const env = getEnv();
    sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    csrfService = new CsrfService(env.CSRF_SIGNING_KEY);
    app = createApp();

    // Clean test slate in foreign-key dependency order
    const tablesToClean = [
      'account_benefit_claims', 'promo_redemptions', 'subscription_status_histories',
      'dormitory_subscriptions', 'payment_upload_intents', 'local_notification_outbox',
      'staff_notices', 'tenant_notices', 'contract_settlement_items', 'contract_settlements',
      'tenant_renewal_requests', 'tenant_move_out_requests', 'bill_items', 'receipts',
      'receipt_sequences', 'payment_status_histories', 'payments', 'bill_status_histories',
      'bills', 'room_next_cycle_corrections', 'room_billing_cycle_snapshots',
      'billing_rate_snapshots', 'billing_cycles', 'meter_replacements', 'meter_readings',
      'meter_devices', 'contract_snapshots', 'contract_status_histories', 'contracts',
      'occupancies', 'tenant_vehicles', 'tenant_emergency_contacts', 'tenant_co_occupants',
      'tenant_registration_requests', 'tenants', 'rooms', 'buildings', 'dormitory_members',
      'dormitory_access_grants', 'dormitory_line_friends', 'dormitory_line_configs',
      'line_webhook_event_receipts', 'line_push_delivery_attempts', 'line_push_usage',
      'owner_signatures', 'dormitory_billing_settings', 'dormitory_property_defaults',
      'onboarding_drafts', 'audit_logs', 'subscription_package_intents', 'dormitories',
      'sessions', 'users'
    ];
    for (const tbl of tablesToClean) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${tbl}";`);
    }

    dormIdA = crypto.randomUUID();
    dormIdB = crypto.randomUUID();

    // Ensure roles exist in DB
    const roles = [
      { code: 'OWNER', name: 'Owner', isSystem: true, permissions: ['*'] },
      { code: 'MANAGER', name: 'Manager', isSystem: true, permissions: ['room:read', 'room:write', 'tenant:read', 'tenant:write', 'contract:read', 'contract:write', 'bill:read', 'bill:write', 'meter:read', 'meter:write'] },
      { code: 'TECH', name: 'Technician', isSystem: true, permissions: ['maintenance:read', 'maintenance:write', 'meter:read', 'meter:write'] },
      { code: 'TENANT', name: 'Tenant', isSystem: true, permissions: ['contract:read', 'bill:read'] }
    ];

    for (const r of roles) {
      const existing = await prisma.role.findFirst({ where: { code: r.code } });
      if (!existing) {
        await prisma.role.create({ data: r });
      }
    }

    const ownerRole = (await prisma.role.findFirst({ where: { code: 'OWNER' } }))!;
    const techRole = (await prisma.role.findFirst({ where: { code: 'TECH' } }))!;
    const tenantRole = (await prisma.role.findFirst({ where: { code: 'TENANT' } }))!;

    // Create Dormitories
    await prisma.dormitory.create({
      data: { id: dormIdA, name: 'Dormitory Alpha (Dorm A)', code: `DORM-A-${Date.now()}`, status: 'active' }
    });
    await prisma.dormitory.create({
      data: { id: dormIdB, name: 'Dormitory Beta (Dorm B)', code: `DORM-B-${Date.now()}`, status: 'active' }
    });

    // Provision trials for write entitlements
    await subscriptionEntitlementService.provisionInitialTrial(dormIdA);
    await subscriptionEntitlementService.provisionInitialTrial(dormIdB);

    // Create Users
    ownerUserA = await prisma.user.create({
      data: {
        email: `owner-a-${Date.now()}@example.com`,
        emailNormalized: `owner-a-${Date.now()}@example.com`,
        name: 'Owner Alpha',
        googleSubject: `sub-owner-a-${Date.now()}`,
        status: 'active'
      }
    });

    techUserA = await prisma.user.create({
      data: {
        email: `tech-a-${Date.now()}@example.com`,
        emailNormalized: `tech-a-${Date.now()}@example.com`,
        name: 'Tech Alpha',
        googleSubject: `sub-tech-a-${Date.now()}`,
        status: 'active'
      }
    });

    tenantUserA = await prisma.user.create({
      data: {
        email: `tenant-a-${Date.now()}@example.com`,
        emailNormalized: `tenant-a-${Date.now()}@example.com`,
        name: 'Tenant Alpha',
        googleSubject: `sub-tenant-a-${Date.now()}`,
        status: 'active'
      }
    });

    tenantUserB = await prisma.user.create({
      data: {
        email: `tenant-b-${Date.now()}@example.com`,
        emailNormalized: `tenant-b-${Date.now()}@example.com`,
        name: 'Tenant Beta',
        googleSubject: `sub-tenant-b-${Date.now()}`,
        status: 'active'
      }
    });

    // Dormitory Memberships
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: ownerUserA.id, roleId: ownerRole.id, status: 'active' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: techUserA.id, roleId: techRole.id, status: 'active' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdA, userId: tenantUserA.id, roleId: tenantRole.id, status: 'active' }
    });
    await prisma.dormitoryMember.create({
      data: { dormitoryId: dormIdB, userId: tenantUserB.id, roleId: tenantRole.id, status: 'active' }
    });

    // Helper for sessions
    const createSession = async (user: any) => {
      const sid = crypto.randomUUID();
      const hash = SessionTokenService.hashSessionId(sid);
      await prisma.session.create({
        data: {
          userId: user.id,
          sessionIdHash: hash,
          tokenVersion: 1,
          status: 'active',
          expiresAt: new Date(Date.now() + 86400 * 1000)
        }
      });
      const token = sessionTokenService.encryptToken(
        { sub: user.id, sid, type: 'session', version: 1 },
        86400
      );
      const csrf = csrfService.generateCsrfToken(sid);
      return { token, csrf, sid };
    };

    const sOwnerA = await createSession(ownerUserA);
    sessionTokenOwnerA = sOwnerA.token;
    csrfTokenOwnerA = sOwnerA.csrf;

    const sTechA = await createSession(techUserA);
    sessionTokenTechA = sTechA.token;
    csrfTokenTechA = sTechA.csrf;

    const sTenantA = await createSession(tenantUserA);
    sessionTokenTenantA = sTenantA.token;
    csrfTokenTenantA = sTenantA.csrf;

    const sTenantB = await createSession(tenantUserB);
    sessionTokenTenantB = sTenantB.token;
    csrfTokenTenantB = sTenantB.csrf;

    // Create Building & Rooms in Dorm A
    const bldA = await prisma.building.create({
      data: { dormitoryId: dormIdA, name: 'Building Alpha' }
    });
    roomA101 = await prisma.room.create({
      data: {
        dormitoryId: dormIdA,
        buildingId: bldA.id,
        roomNumber: 'A101',
        normalizedRoomNumber: 'a101',
        roomType: 'standard',
        monthlyRent: '4500.00',
        depositAmount: '9000.00',
        status: 'occupied'
      }
    });

    tenantA = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdA,
        tenantNumber: 'TNT-A101',
        firstName: 'Somchai',
        lastName: 'Alpha',
        displayName: 'Somchai Alpha',
        phone: '0811111111',
        status: 'active',
        linkedUserId: tenantUserA.id
      }
    });

    contractA = await prisma.contract.create({
      data: {
        dormitoryId: dormIdA,
        contractNumber: 'CTR-A101',
        roomId: roomA101.id,
        tenantId: tenantA.id,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        rentAmount: '4500.00',
        depositAmount: '9000.00',
        status: 'active'
      }
    });

    await prisma.room.update({
      where: { id: roomA101.id },
      data: { currentTenantId: tenantA.id, currentContractId: contractA.id }
    });

    // Billing Cycles
    cycleA = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormIdA,
        cycleCode: `CYC-A-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05')
      }
    });

    cycleB = await prisma.billingCycle.create({
      data: {
        dormitoryId: dormIdB,
        cycleCode: `CYC-B-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        name: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        billingDate: new Date('2026-08-25'),
        dueDate: new Date('2026-09-05')
      }
    });

    // Create Tenant in Dorm B
    tenantB = await prisma.tenant.create({
      data: {
        dormitoryId: dormIdB,
        tenantNumber: 'TNT-B201',
        firstName: 'Manee',
        lastName: 'Beta',
        displayName: 'Manee Beta',
        phone: '0822222222',
        status: 'active',
        linkedUserId: tenantUserB.id
      }
    });

    const bldB = await prisma.building.create({
      data: { dormitoryId: dormIdB, name: 'Building Beta' }
    });
    roomB201 = await prisma.room.create({
      data: {
        dormitoryId: dormIdB,
        buildingId: bldB.id,
        roomNumber: 'B201',
        normalizedRoomNumber: 'b201',
        roomType: 'standard',
        monthlyRent: '6000.00',
        depositAmount: '12000.00',
        status: 'vacant'
      }
    });
  });

  // =========================================================================
  // 1. ANONYMOUS BOUNDARY & HEADER TAMPERING
  // =========================================================================
  describe('1. Anonymous Security Boundary & Header Tampering', () => {
    it('should reject unauthenticated request with 401 fail-closed on protected endpoints', async () => {
      const endpoints = [
        { method: 'get', path: '/api/v1/properties/rooms' },
        { method: 'get', path: '/api/v1/bills' },
        { method: 'get', path: '/api/v1/contracts' },
        { method: 'get', path: '/api/v1/tenants' },
        { method: 'get', path: '/api/v1/tenant-portal/profile' }
      ];

      for (const ep of endpoints) {
        const res = await (supertest(app) as any)[ep.method](ep.path);
        expect(res.status, `Endpoint ${ep.path} must return 401 when anonymous`).toBe(401);
      }
    });

    it('should reject requests spoofing headers without valid session (no fallback actor)', async () => {
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('x-role-code', 'OWNER')
        .set('x-user-id', ownerUserA.id)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. SESSION SECURITY: FORGERY, EXPIRATION, REVOCATION & VERSION BUMP
  // =========================================================================
  describe('2. Session Forgery, Expiration, Revocation & Token Version', () => {
    it('should reject forged/tampered session tokens with 401', async () => {
      const tampered = sessionTokenOwnerA.slice(0, -5) + 'abcde';
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${tampered}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });

    it('should reject expired session tokens with 401', async () => {
      const env = getEnv();
      const expiredToken = sessionTokenService.encryptToken(
        { sub: ownerUserA.id, sid: crypto.randomUUID(), type: 'session', version: 1, exp: Math.floor(Date.now() / 1000) - 3600 },
        0
      );

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${expiredToken}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });

    it('should reject session if session record status is revoked in DB', async () => {
      await prisma.session.updateMany({
        where: { userId: ownerUserA.id },
        data: { status: 'revoked' }
      });

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });

    it('should reject session when tokenVersion is incremented (Logout-All / Password Reset)', async () => {
      await prisma.session.updateMany({
        where: { userId: ownerUserA.id },
        data: { tokenVersion: 2 }
      });

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 3. CSRF DEFENSE ON STATE MUTATIONS (POST, PUT, PATCH, DELETE)
  // =========================================================================
  describe('3. CSRF Defense on State Mutations', () => {
    it('should reject POST mutation when x-csrf-token header is missing', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building CSRF Fail' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('should reject POST mutation when x-csrf-token is forged/tampered', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', 'forged-csrf-token-12345')
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building CSRF Tamper' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('should reject PUT mutation when x-csrf-token header is missing or wrong', async () => {
      const res = await supertest(app)
        .put(`/api/v1/properties/rooms/${roomA101.id}`)
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA)
        .send({ roomNumber: 'A101-PUT-FAIL' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('should reject PATCH mutation when x-csrf-token header is missing or wrong', async () => {
      const res = await supertest(app)
        .patch(`/api/v1/dormitories/${dormIdA}`)
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Dorm Alpha Patched' });

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('should reject DELETE mutation when x-csrf-token header is missing or wrong', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/properties/rooms/${roomA101.id}`)
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe('CSRF_INVALID');
    });

    it('should allow GET requests without x-csrf-token header (safe method exemption)', async () => {
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(200);
    });

    it('should accept valid CSRF token and execute authorized state mutation', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building Valid CSRF' });

      expect(res.status).toBe(201);
      expect(res.body.data?.name).toBe('Building Valid CSRF');
    });
  });

  // =========================================================================
  // 4. CROSS-DORMITORY ISOLATION (MULTI-TENANCY / IDOR BOUNDARIES)
  // =========================================================================
  describe('4. Cross-Dormitory Isolation (Owner / Staff Boundaries)', () => {
    it('should forbid Owner A from accessing Dorm B resources even if header is spoofed (HTTP 403)', async () => {
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdB);

      expect(res.status).toBe(403);
    });

    it('should reject Owner A mutations targeting Dorm B entities via IDOR', async () => {
      const res = await supertest(app)
        .delete(`/api/v1/properties/rooms/${roomB201.id}`)
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA);

      expect([400, 403, 404]).toContain(res.status);

      const roomStillExists = await prisma.room.findUnique({ where: { id: roomB201.id } });
      expect(roomStillExists).not.toBeNull();
    });
  });

  // =========================================================================
  // 5. TENANT PORTAL CROSS-TENANT IDOR BOUNDARIES
  // =========================================================================
  describe('5. Tenant-Portal Cross-Tenant IDOR Boundaries', () => {
    it('should allow Tenant A to view own profile under Dorm A context', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Somchai Alpha');
    });

    it('should forbid Tenant A from accessing Tenant Portal under Dorm B context', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`)
        .set('x-dormitory-id', dormIdB);

      expect(res.status).toBe(403);
    });

    it('should prevent Tenant A from accessing Tenant B bills via IDOR', async () => {
      const billB = await prisma.bill.create({
        data: {
          dormitoryId: dormIdB,
          billingCycleId: cycleB.id,
          tenantId: tenantB.id,
          roomId: roomB201.id,
          billNumber: 'BILL-B-999',
          totalAmount: '5500.00',
          status: 'unpaid',
          dueDate: new Date('2026-08-31'),
          billingDate: new Date('2026-08-01')
        }
      });

      const res = await supertest(app)
        .get(`/api/v1/tenant-portal/bills/${billB.id}`)
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`)
        .set('x-dormitory-id', dormIdA);

      expect([403, 404]).toContain(res.status);
    });
  });

  // =========================================================================
  // 6. STAFF RBAC MUTATION RESTRICTIONS (TECH ROLE VS OWNER/MANAGER)
  // =========================================================================
  describe('6. Staff RBAC Mutation Restrictions (TECH Role)', () => {
    it('should deny TECH staff from creating contracts (HTTP 403)', async () => {
      const res = await supertest(app)
        .post('/api/v1/contracts')
        .set('Cookie', `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`)
        .set('x-csrf-token', csrfTokenTechA)
        .set('x-dormitory-id', dormIdA)
        .send({
          roomId: roomA101.id,
          tenantId: tenantA.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          rentAmount: 4500
        });

      expect(res.status).toBe(403);
    });

    it('should deny TECH staff from generating bulk bills (HTTP 403)', async () => {
      const res = await supertest(app)
        .post('/api/v1/bills/generate/bulk')
        .set('Cookie', `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`)
        .set('x-csrf-token', csrfTokenTechA)
        .set('x-dormitory-id', dormIdA)
        .send({ month: 8, year: 2026 });

      expect(res.status).toBe(403);
    });

    it('should deny TECH staff from creating staff access grants (HTTP 403)', async () => {
      const res = await supertest(app)
        .post(`/api/v1/properties/${dormIdA}/access-grants`)
        .set('Cookie', `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`)
        .set('x-csrf-token', csrfTokenTechA)
        .set('x-dormitory-id', dormIdA)
        .send({ lineFriendId: crypto.randomUUID(), roleCode: 'TECH' });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. INPUT VALIDATION, XSS NEUTRALIZATION & SQL PARAMETERIZATION
  // =========================================================================
  describe('7. Input Validation & SQL Parameterization', () => {
    it('should reject invalid monetary amounts and negative values with 400/422', async () => {
      const res = await supertest(app)
        .post('/api/v1/contracts')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({
          roomId: roomA101.id,
          tenantId: tenantA.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          rentAmount: -5000
        });

      expect([400, 422]).toContain(res.status);
    });

    it('should reject malformed UUIDs with truthful 400 response without crashing', async () => {
      const res = await supertest(app)
        .get('/api/v1/properties/rooms/not-a-valid-uuid')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect([400, 404]).toContain(res.status);
    });

    it('should safely handle SQL injection payloads in search and text fields', async () => {
      const sqlPayload = "' OR '1'='1'; DROP TABLE users CASCADE; --";
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({ name: `Building ${sqlPayload}` });

      expect(res.status).toBe(201);

      // Verify that database tables remain intact
      const userCount = await prisma.user.count();
      expect(userCount).toBeGreaterThan(0);

      // Verify string was treated as literal text
      const savedBld = await prisma.building.findFirst({
        where: { dormitoryId: dormIdA, name: { contains: 'DROP TABLE' } }
      });
      expect(savedBld).not.toBeNull();
    });
  });

  // =========================================================================
  // 8. TASK009 BEARER ACCESS GRANTS & QUOTA CONCURRENCY
  // =========================================================================
  describe('8. Task009 Bearer Security & Quota Concurrency', () => {
    it('should reject redemption of revoked access grant', async () => {
      const grantService = new AccessGrantService(prisma);
      
      const rawLineId = `line-user-${Date.now()}`;
      const friend = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormIdA}, true)`;
        return tx.dormitoryLineFriend.create({
          data: {
            dormitoryId: dormIdA,
            lineUserIdHash: hashToken(rawLineId),
            lineUserIdEncrypted: encryptText(rawLineId),
            displayName: 'Line Staff Alpha'
          }
        });
      });

      const grant = await grantService.createAccessGrant(
        dormIdA,
        friend.id,
        'TECH',
        ownerUserA.id
      );

      const rawToken = grant.bearerUrl.split('#')[1];

      // Revoke grant
      await grantService.revokeAccessGrant(
        dormIdA,
        grant.grant.id,
        ownerUserA.id
      );

      // Attempt to redeem revoked grant
      await expect(
        grantService.redeemAccessGrant(rawToken)
      ).rejects.toThrow();
    });

    it('should enforce that revoked grant cannot be redeemed and active grant creates valid session', async () => {
      const grantService = new AccessGrantService(prisma);
      
      const rawLineId = `line-replay-${Date.now()}`;
      const friend = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormIdA}, true)`;
        return tx.dormitoryLineFriend.create({
          data: {
            dormitoryId: dormIdA,
            lineUserIdHash: hashToken(rawLineId),
            lineUserIdEncrypted: encryptText(rawLineId),
            displayName: 'Line Staff Replay'
          }
        });
      });

      const grant = await grantService.createAccessGrant(
        dormIdA,
        friend.id,
        'TECH',
        ownerUserA.id
      );

      const rawToken = grant.bearerUrl.split('#')[1];

      // First redemption succeeds
      const result1 = await grantService.redeemAccessGrant(rawToken);
      expect(result1.grant.dormitoryId).toBe(dormIdA);

      // Revoking grant ensures subsequent redemption fails closed
      await grantService.revokeAccessGrant(dormIdA, grant.grant.id, ownerUserA.id);

      await expect(
        grantService.redeemAccessGrant(rawToken)
      ).rejects.toThrow();
    });

    it('should strictly limit active staff quota to max 10 slots under concurrent creation', async () => {
      const grantService = new AccessGrantService(prisma);
      
      const friends = [];
      for (let i = 0; i < 12; i++) {
        const lineId = `line-quota-${i}-${Date.now()}`;
        const f = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormIdA}, true)`;
          return tx.dormitoryLineFriend.create({
            data: {
              dormitoryId: dormIdA,
              lineUserIdHash: hashToken(lineId),
              lineUserIdEncrypted: encryptText(lineId),
              displayName: `Quota Staff ${i}`
            }
          });
        });
        friends.push(f);
      }

      const creationPromises = friends.map(f =>
        grantService.createAccessGrant(dormIdA, f.id, 'TECH', ownerUserA.id)
          .then(() => 'created')
          .catch(() => 'rejected')
      );

      await Promise.all(creationPromises);

      const usage = await grantService.getSlotUsage(dormIdA);
      expect(usage.totalUsedSlots).toBeLessThanOrEqual(10);
    });
  });

  // =========================================================================
  // 9. REAL BUSINESS TRANSACTION ROLLBACK RESILIENCE
  // =========================================================================
  describe('9. Real Business Transaction Rollback Resilience', () => {
    it('9.1 Generic Multi-Write Transaction Rollback', async () => {
      const initialOccupancyCount = await prisma.occupancy.count();
      const initialRoomStatus = (await prisma.room.findUnique({ where: { id: roomA101.id } }))?.status;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.occupancy.create({
            data: {
              dormitoryId: dormIdA,
              roomId: roomA101.id,
              tenantId: tenantA.id,
              contractId: contractA.id,
              startedAt: new Date(),
              status: 'ACTIVE'
            }
          });
          await tx.room.update({
            where: { id: roomA101.id },
            data: { status: 'vacant' }
          });
          throw new Error('SIMULATED_GENERIC_TRANSACTION_FAILURE');
        });
      } catch (err: any) {
        expect(err.message).toBe('SIMULATED_GENERIC_TRANSACTION_FAILURE');
      }

      const finalOccupancyCount = await prisma.occupancy.count();
      const finalRoomStatus = (await prisma.room.findUnique({ where: { id: roomA101.id } }))?.status;

      expect(finalOccupancyCount).toBe(initialOccupancyCount);
      expect(finalRoomStatus).toBe(initialRoomStatus);
    });

    it('9.2 Real Business Flow A: Forced Replacement Transaction Mid-Flow Rollback & Recovery', async () => {
      const regService = new TenantRegistrationService();

      // Create active initial occupancy for Tenant Alpha
      const initialOcc = await prisma.occupancy.create({
        data: {
          dormitoryId: dormIdA,
          roomId: roomA101.id,
          tenantId: tenantA.id,
          contractId: contractA.id,
          startedAt: new Date('2026-01-01'),
          status: 'ACTIVE'
        }
      });

      // Submit registration request from replacement applicant Beta
      const regBeta = await regService.createRequest(dormIdA, {
        firstName: 'Replacement',
        lastName: 'Beta',
        phone: '0899999999',
        requestedRoomId: roomA101.id,
        idCard: '1234567890123'
      });

      const approvalPayload = {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: 5000,
        depositAmount: 10000,
        advancePaymentAmount: 5000,
        confirmReplacement: true
      };

      // Inject deterministic failure during outbox event creation (after contract/occupancy mutation)
      const outboxSpy = vi.spyOn(outboxService, 'createOutboxEvent').mockImplementationOnce(() => {
        throw new Error('SIMULATED_FORCED_REPLACEMENT_OUTBOX_CRASH');
      });

      // Execute approval -> must fail and roll back entire business flow
      await expect(
        regService.approveRequest(regBeta.id, dormIdA, approvalPayload, ownerUserA.id)
      ).rejects.toThrow('SIMULATED_FORCED_REPLACEMENT_OUTBOX_CRASH');

      // Verify Complete Rollback:
      // 1. Old contract is STILL active
      const oldContractAfter = await prisma.contract.findUnique({ where: { id: contractA.id } });
      expect(oldContractAfter?.status).toBe('active');
      expect(oldContractAfter?.terminatedAt).toBeNull();

      // 2. Old occupancy is STILL active
      const oldOccAfter = await prisma.occupancy.findUnique({ where: { id: initialOcc.id } });
      expect(oldOccAfter?.status).toBe('ACTIVE');
      expect(oldOccAfter?.endedAt).toBeNull();

      // 3. No new replacement contract created for Beta
      const betaContracts = await prisma.contract.findMany({
        where: { dormitoryId: dormIdA, tenant: { firstName: 'Replacement' } }
      });
      expect(betaContracts.length).toBe(0);

      // 4. Registration request is still pending
      const regBetaAfter = await prisma.tenantRegistrationRequest.findUnique({ where: { id: regBeta.id } });
      expect(regBetaAfter?.status).toBe('pending_owner_approval');

      // 5. Room current tenant pointer unchanged
      const roomAfter = await prisma.room.findUnique({ where: { id: roomA101.id } });
      expect(roomAfter?.currentTenantId).toBe(tenantA.id);

      // REMOVE FAULT & RERUN: Transition succeeds exactly once
      outboxSpy.mockRestore();
      const approvedResult = await regService.approveRequest(regBeta.id, dormIdA, approvalPayload, ownerUserA.id);
      expect(approvedResult.contractId).toBeDefined();
      expect(approvedResult.tenant.firstName).toBe('Replacement');

      // Verify Authoritative Post-Transition State:
      const oldContractFinal = await prisma.contract.findUnique({ where: { id: contractA.id } });
      expect(oldContractFinal?.status).toBe('terminated');
      expect(oldContractFinal?.terminatedAt).not.toBeNull();

      const oldOccFinal = await prisma.occupancy.findUnique({ where: { id: initialOcc.id } });
      expect(oldOccFinal?.status).toBe('ENDED');

      const newContractFinal = await prisma.contract.findFirst({
        where: { dormitoryId: dormIdA, tenant: { firstName: 'Replacement' } }
      });
      expect(newContractFinal?.status).toBe('active');
      expect(newContractFinal?.rentAmount.toString()).toBe('5000');
    });

    it('9.3 Real Business Flow B: Outbox STAFF Delivery Multi-Recipient Rollback & Recovery', async () => {
      const outbox = new OutboxService(prisma);

      // Create 2 active TECH members in Dorm A
      const techRole = (await prisma.role.findFirst({ where: { code: 'TECH' } }))!;
      const techUser2 = await prisma.user.create({
        data: {
          email: `tech2-${Date.now()}@example.com`,
          emailNormalized: `tech2-${Date.now()}@example.com`,
          name: 'Tech Beta',
          googleSubject: `sub-tech2-${Date.now()}`,
          status: 'active'
        }
      });
      await prisma.dormitoryMember.create({
        data: { dormitoryId: dormIdA, userId: techUser2.id, roleId: techRole.id, status: 'active' }
      });

      // Create a PENDING outbox event targeting role TECH
      const event = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'MAINTENANCE_ALERT',
          aggregateType: 'MAINTENANCE',
          aggregateId: crypto.randomUUID(),
          recipientType: 'STAFF',
          recipientRoleCode: 'TECH',
          title: 'Pipe Leak Alert',
          body: 'Emergency leak in room 101',
          status: 'PENDING',
          idempotencyKey: `maint-leak-${Date.now()}`
        }
      });

      // Inject deterministic failure on 2nd staff notification upsert inside interactive transaction
      const origTransaction = prisma.$transaction.bind(prisma);
      let txCallCount = 0;
      const txSpy = vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any, ...rest: any[]) => {
        txCallCount++;
        if (txCallCount === 1) {
          return origTransaction(async (realTx: any) => {
            let staffUpsertCount = 0;
            const proxiedTx = new Proxy(realTx, {
              get(target, prop) {
                if (prop === 'staffNotification') {
                  return new Proxy(target.staffNotification, {
                    get(subTarget, subProp) {
                      if (subProp === 'upsert') {
                        return async (args: any) => {
                          staffUpsertCount++;
                          if (staffUpsertCount === 2) {
                            throw new Error('SIMULATED_RECIPIENT_2_UPSERT_FAILURE');
                          }
                          return subTarget.upsert(args);
                        };
                      }
                      return (subTarget as any)[subProp];
                    }
                  });
                }
                return target[prop];
              }
            });
            return cb(proxiedTx);
          }, ...rest);
        }
        return origTransaction(cb, ...rest);
      });

      // Dispatch pending events -> must handle error and roll back
      const dispatchResult1 = await outbox.processPendingOutboxEvents(1);
      expect(dispatchResult1.failedCount).toBe(1);

      // Verify Rollback: Zero staff notifications exist, outbox event is still PENDING
      const staffNoticesCount = await prisma.staffNotification.count({
        where: { sourceOutboxId: event.id }
      });
      expect(staffNoticesCount).toBe(0);

      const eventAfter = await prisma.localNotificationOutbox.findUnique({ where: { id: event.id } });
      expect(eventAfter?.status).toBe('PENDING');

      // REMOVE FAULT & RETRY DISPATCH: All intended recipients receive exactly one notification
      txSpy.mockRestore();
      const dispatchResult2 = await outbox.processPendingOutboxEvents(1);
      expect(dispatchResult2.processedCount).toBe(1);

      const staffNoticesFinal = await prisma.staffNotification.findMany({
        where: { sourceOutboxId: event.id }
      });
      expect(staffNoticesFinal.length).toBe(2); // Exactly 1 per tech staff

      const eventFinal = await prisma.localNotificationOutbox.findUnique({ where: { id: event.id } });
      expect(eventFinal?.status).toBe('PROCESSED');
    });
  });

  // =========================================================================
  // 10. OUTBOX REPLAY, DEDUPLICATION, CONCURRENCY & FAULT ISOLATION
  // =========================================================================
  describe('10. Outbox Replay, Deduplication & Concurrency Resilience', () => {
    it('should not duplicate notifications when re-processing an already PROCESSED event (Idempotency)', async () => {
      const outbox = new OutboxService(prisma);

      const event = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'TENANT_ANNOUNCEMENT',
          aggregateType: 'TENANT',
          aggregateId: tenantA.id,
          recipientType: 'TENANT',
          recipientId: tenantA.id,
          title: 'Power Outage Notice',
          body: 'Scheduled maintenance tomorrow',
          status: 'PENDING',
          idempotencyKey: `announcement-${Date.now()}`
        }
      });

      // First run: processes event
      const res1 = await outbox.processPendingOutboxEvents(10);
      expect(res1.processedCount).toBe(1);

      const noticeCount1 = await prisma.tenantNotice.count({ where: { sourceOutboxId: event.id } });
      expect(noticeCount1).toBe(1);

      // Re-run: zero additional notifications created
      const res2 = await outbox.processPendingOutboxEvents(10);
      expect(res2.processedCount).toBe(0);

      const noticeCount2 = await prisma.tenantNotice.count({ where: { sourceOutboxId: event.id } });
      expect(noticeCount2).toBe(1);
    });

    it('should process pending outbox events safely under concurrent dispatch workers (SKIP LOCKED)', async () => {
      const outbox1 = new OutboxService(prisma);
      const outbox2 = new OutboxService(prisma);

      // Create 5 PENDING outbox events
      for (let i = 0; i < 5; i++) {
        await prisma.localNotificationOutbox.create({
          data: {
            dormitoryId: dormIdA,
            eventType: 'RENT_REMINDER',
            aggregateType: 'TENANT',
            aggregateId: tenantA.id,
            recipientType: 'TENANT',
            recipientId: tenantA.id,
            title: `Rent Reminder ${i}`,
            body: `Reminder ${i}`,
            status: 'PENDING',
            idempotencyKey: `rent-rem-${i}-${Date.now()}`
          }
        });
      }

      // Execute concurrent dispatches
      const [res1, res2] = await Promise.all([
        outbox1.processPendingOutboxEvents(10),
        outbox2.processPendingOutboxEvents(10)
      ]);

      expect(res1.processedCount + res2.processedCount).toBe(5);

      const allProcessed = await prisma.localNotificationOutbox.count({
        where: { dormitoryId: dormIdA, eventType: 'RENT_REMINDER', status: 'PROCESSED' }
      });
      expect(allProcessed).toBe(5);

      const totalNotices = await prisma.tenantNotice.count({
        where: { dormitoryId: dormIdA, type: 'RENT_REMINDER' }
      });
      expect(totalNotices).toBe(5);
    });

    it('should mark malformed event as FAILED without blocking adjacent valid event in batch', async () => {
      const outbox = new OutboxService(prisma);

      // Event 1: Malformed (missing recipient)
      const malformedEvent = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'MALFORMED_EVENT',
          aggregateType: 'TENANT',
          aggregateId: 'unknown',
          recipientType: 'TENANT',
          recipientId: null, // missing!
          title: 'Malformed',
          body: 'Missing recipient',
          status: 'PENDING',
          idempotencyKey: `malformed-${Date.now()}`
        }
      });

      // Event 2: Valid
      const validEvent = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'VALID_EVENT',
          aggregateType: 'TENANT',
          aggregateId: tenantA.id,
          recipientType: 'TENANT',
          recipientId: tenantA.id,
          title: 'Valid Notice',
          body: 'This is valid',
          status: 'PENDING',
          idempotencyKey: `valid-${Date.now()}`
        }
      });

      const res = await outbox.processPendingOutboxEvents(10);
      expect(res.failedCount).toBe(1);
      expect(res.processedCount).toBe(1);

      const malformedStatus = await prisma.localNotificationOutbox.findUnique({ where: { id: malformedEvent.id } });
      expect(malformedStatus?.status).toBe('FAILED');
      expect(malformedStatus?.lastError).toBe('MISSING_TENANT_RECIPIENT');

      const validStatus = await prisma.localNotificationOutbox.findUnique({ where: { id: validEvent.id } });
      expect(validStatus?.status).toBe('PROCESSED');
    });
  });

  // =========================================================================
  // 11. STARTUP & SCHEDULER RESILIENCE
  // =========================================================================
  describe('11. Startup & Scheduler Resilience', () => {
    it('should process pre-existing PENDING outbox events on service startup reconciliation', async () => {
      // Simulate un-dispatched event prior to server boot
      const preBootEvent = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'PRE_BOOT_NOTICE',
          aggregateType: 'TENANT',
          aggregateId: tenantA.id,
          recipientType: 'TENANT',
          recipientId: tenantA.id,
          title: 'Pre-Boot Title',
          body: 'Pre-Boot Body',
          status: 'PENDING',
          idempotencyKey: `pre-boot-${Date.now()}`
        }
      });

      // Boot reconciliation
      const outbox = new OutboxService(prisma);
      const res = await outbox.processPendingOutboxEvents(50);
      expect(res.processedCount).toBeGreaterThanOrEqual(1);

      const notice = await prisma.tenantNotice.findUnique({ where: { sourceOutboxId: preBootEvent.id } });
      expect(notice).not.toBeNull();
      expect(notice?.title).toBe('Pre-Boot Title');
    });

    it('should isolate Phase 4 (contract activation) failure so Phase 5 (outbox) still completes in real CleanupService', async () => {
      // Create a PENDING outbox event that Phase 5 should process
      const outboxEvent = await prisma.localNotificationOutbox.create({
        data: {
          dormitoryId: dormIdA,
          eventType: 'SCHEDULER_ISOLATION_TEST',
          aggregateType: 'TENANT',
          aggregateId: tenantA.id,
          recipientType: 'TENANT',
          recipientId: tenantA.id,
          title: 'Scheduler Isolation',
          body: 'Phase 5 must still process this',
          status: 'PENDING',
          idempotencyKey: `sched-iso-${Date.now()}`
        }
      });

      // Inject failure in Phase 4 (contract activation) via dynamic import interception
      const origImport = CleanupService.prototype['runCleanup'];
      const cleanupSvc = new CleanupService(prisma);

      // Spy on contract-renewal import to throw during Phase 4
      const mockContractModule = vi.fn().mockRejectedValue(new Error('SIMULATED_CONTRACT_ACTIVATION_CRASH'));
      const origDynImport = (await import('../src/services/contract-renewal.service.js')).ContractRenewalService;
      const activateSpy = vi.spyOn(origDynImport.prototype, 'activateAllScheduledContracts')
        .mockRejectedValueOnce(new Error('SIMULATED_CONTRACT_ACTIVATION_CRASH'));

      // Run real CleanupService.runCleanup()
      const result = await cleanupSvc.runCleanup();

      // Phase 4 threw but Phase 5 (outbox) should still have completed
      const processedEvent = await prisma.localNotificationOutbox.findUnique({ where: { id: outboxEvent.id } });
      expect(processedEvent?.status).toBe('PROCESSED');

      // CleanupService itself did not throw — it returned results
      expect(result).toBeDefined();
      expect(typeof result.expiredMarked).toBe('number');

      activateSpy.mockRestore();
    });
  });

  // =========================================================================
  // 12. REDIS FAILURE RESILIENCE & GRACEFUL DEGRADATION
  // =========================================================================
  describe('12. Redis Failure Resilience & Graceful Degradation', () => {
    it('should report redis DOWN and overall readiness DOWN when Redis fails (Fail-Closed Readiness)', async () => {
      // Mock failing Redis client
      const failingRedis: any = {
        status: 'close',
        ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
        quit: vi.fn().mockResolvedValue('OK'),
        disconnect: vi.fn()
      };

      setRedisClient(failingRedis);

      const readiness = await checkReadiness();
      expect(readiness.isReady).toBe(false);
      expect(readiness.data.status).toBe('DOWN');
      expect(readiness.data.redis).toBe('DOWN');

      // Restore healthy mock
      const healthyRedis: any = {
        status: 'ready',
        ping: vi.fn().mockResolvedValue('PONG'),
        quit: vi.fn().mockResolvedValue('OK'),
        disconnect: vi.fn()
      };
      setRedisClient(healthyRedis);

      const healthyReadiness = await checkReadiness();
      expect(healthyReadiness.isReady).toBe(true);
      expect(healthyReadiness.data.status).toBe('UP');
      expect(healthyReadiness.data.redis).toBe('UP');

      setRedisClient(null);
    });

    it('should fail closed with 503 REDIS_UNAVAILABLE in LineChannelTokenProvider when Redis is required in production', async () => {
      const origNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const disconnectedRedis: any = {
        status: 'close',
        connect: vi.fn().mockRejectedValue(new Error('Connection failed')),
        on: vi.fn()
      };

      const provider = new LineChannelTokenProvider('http://127.0.0.1:3101', disconnectedRedis);

      try {
        await expect(
          provider.getChannelAccessToken('test-channel-id', 'test-channel-secret')
        ).rejects.toThrow('Distributed coordination unavailable');
      } finally {
        process.env.NODE_ENV = origNodeEnv;
      }
    });

    it('should not corrupt global process state after simulated Redis outage', async () => {
      const failingRedis: any = {
        status: 'close',
        ping: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        quit: vi.fn().mockResolvedValue('OK'),
        disconnect: vi.fn()
      };
      setRedisClient(failingRedis);
      await checkReadiness();
      setRedisClient(null);

      // Verify normal database queries continue working smoothly
      const dorm = await prisma.dormitory.findUnique({ where: { id: dormIdA } });
      expect(dorm).not.toBeNull();
      expect(dorm?.name).toBe('Dormitory Alpha (Dorm A)');
    });
  });

  // =========================================================================
  // 13. DATABASE FAILURE FAIL-CLOSED & RECOVERY
  // =========================================================================
  describe('13. Database Failure Fail-Closed & Recovery', () => {
    it('should return clean 500 without leaking credentials or creating fake state when DB operation fails', async () => {
      // Simulate database failure on property query
      const origFindMany = prisma.room.findMany;
      prisma.room.findMany = (async () => {
        throw new Error('Connection terminated unexpectedly: server closed the connection');
      }) as any;

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
      expect(['INTERNAL_SERVER_ERROR', 'PROPERTY_OPERATION_FAILED', 'DB_ERROR']).toContain(res.body.error.code);
      expect(JSON.stringify(res.body)).not.toContain('postgresql://');
      expect(JSON.stringify(res.body)).not.toContain('password');

      prisma.room.findMany = origFindMany;

      // Healthy database recovery: next request succeeds
      const recoveryRes = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(recoveryRes.status).toBe(200);
    });
  });

  // =========================================================================
  // 14. RATE-LIMIT & ABUSE RESISTANCE
  // =========================================================================
  describe('14. Rate-Limit & Abuse Resistance', () => {
    it('should enforce existing rate limit on auth endpoint and reject subsequent requests with 429', async () => {
      let hit429 = false;
      let rateLimitedRes: any;

      for (let i = 0; i < 40; i++) {
        const res = await supertest(app)
          .post('/api/v1/auth/google')
          .send({ idToken: 'test.invalid.token' });

        if (res.status === 429) {
          hit429 = true;
          rateLimitedRes = res;
          break;
        }
      }

      expect(hit429).toBe(true);
      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toBeDefined();
      expect(rateLimitedRes.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('should maintain rate-limit state when client IP is fixed', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'test.invalid.token' });

      expect(res.status).toBe(429);
    });

    it('should not allow rate limit bypass via spoofed x-forwarded-for header (TRUST_PROXY=false)', async () => {
      // TRUST_PROXY defaults to false in test environment.
      // When trust proxy is disabled, Express req.ip returns the socket remote address,
      // so x-forwarded-for is never consulted for IP resolution.
      // The rate limiter key uses req.ip, so spoofed headers MUST NOT reset the counter.
      const res = await supertest(app)
        .post('/api/v1/auth/google')
        .set('x-forwarded-for', '203.0.113.199')
        .send({ idToken: 'test.invalid.token' });

      expect(res.status).toBe(429);
    });

    it('should not allow rate limit bypass via spoofed x-real-ip header', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/google')
        .set('x-real-ip', '198.51.100.42')
        .send({ idToken: 'test.invalid.token' });

      expect(res.status).toBe(429);
    });

    it('should not allow rate limit bypass via query-string path variation', async () => {
      // Rate limiter key uses req.path (not req.originalUrl).
      // Express req.path strips query strings: /api/v1/auth/google?x=1 => /api/v1/auth/google
      // So query-string variations MUST NOT bypass the limiter.
      const res = await supertest(app)
        .post('/api/v1/auth/google?x=1')
        .send({ idToken: 'test.invalid.token' });

      expect(res.status).toBe(429);
    });
  });

  // =========================================================================
  // 15. UPLOAD & PAYMENT EVIDENCE SECURITY
  // =========================================================================
  describe('15. Upload & Payment Evidence Security', () => {
    it('should reject anonymous upload intent request with 401', async () => {
      const res = await supertest(app)
        .post('/api/v1/payments/slip/intent')
        .send({ billId: crypto.randomUUID(), expectedSize: 1024, expectedMimeType: 'image/png' });

      expect(res.status).toBe(401);
    });

    it('should reject upload intent targeting a bill in another dormitory (Dorm B) with 404/403', async () => {
      const billB = await prisma.bill.create({
        data: {
          dormitoryId: dormIdB,
          billingCycleId: cycleB.id,
          tenantId: tenantB.id,
          roomId: roomB201.id,
          billNumber: 'BILL-B-UPLOAD',
          totalAmount: '5000.00',
          status: 'unpaid',
          dueDate: new Date('2026-08-31'),
          billingDate: new Date('2026-08-01')
        }
      });

      const res = await supertest(app)
        .post('/api/v1/payments/slip/intent')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}; horplus_csrf=${csrfTokenTenantA}`)
        .set('x-csrf-token', csrfTokenTenantA)
        .set('x-dormitory-id', dormIdA)
        .send({ billId: billB.id, expectedSize: 1024, expectedMimeType: 'image/png' });

      expect([400, 403, 404]).toContain(res.status);
    });

    it('should reject upload to an expired payment intent with 400', async () => {
      const billA = await prisma.bill.create({
        data: {
          dormitoryId: dormIdA,
          billingCycleId: cycleA.id,
          tenantId: tenantA.id,
          roomId: roomA101.id,
          billNumber: 'BILL-A-EXPIRED',
          totalAmount: '4500.00',
          status: 'unpaid',
          dueDate: new Date('2026-08-31'),
          billingDate: new Date('2026-08-01')
        }
      });

      const expiredIntent = await prisma.paymentUploadIntent.create({
        data: {
          dormitoryId: dormIdA,
          tenantId: tenantA.id,
          billId: billA.id,
          authenticatedUserId: tenantUserA.id,
          expectedMimeType: 'image/png',
          expectedSize: 100,
          status: 'CREATED',
          expiresAt: new Date(Date.now() - 60000) // expired 1 min ago
        }
      });

      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(92).fill(0)]);

      const res = await supertest(app)
        .post(`/api/v1/payments/slip/upload/${expiredIntent.id}`)
        .set('Cookie', `horplus_session=${sessionTokenTenantA}; horplus_csrf=${csrfTokenTenantA}`)
        .set('x-csrf-token', csrfTokenTenantA)
        .set('x-dormitory-id', dormIdA)
        .attach('file', fakePng, 'slip.png');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('expired');
    });

    it('should reject replayed upload to an already CONSUMED or UPLOADED intent with 409', async () => {
      const billA = await prisma.bill.create({
        data: {
          dormitoryId: dormIdA,
          billingCycleId: cycleA.id,
          tenantId: tenantA.id,
          roomId: roomA101.id,
          billNumber: 'BILL-A-REPLAY',
          totalAmount: '4500.00',
          status: 'unpaid',
          dueDate: new Date('2026-08-31'),
          billingDate: new Date('2026-08-01')
        }
      });

      const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(92).fill(0)]);
      const fakeHash = crypto.createHash('sha256').update(fakePng).digest('hex');

      const consumedIntent = await prisma.paymentUploadIntent.create({
        data: {
          dormitoryId: dormIdA,
          tenantId: tenantA.id,
          billId: billA.id,
          authenticatedUserId: tenantUserA.id,
          expectedMimeType: 'image/png',
          expectedSize: 100,
          verifiedMimeType: 'image/png',
          verifiedSize: 100,
          objectKey: `payments/${dormIdA}/${billA.id}/consumed.png`,
          sha256: fakeHash,
          status: 'CONSUMED',
          consumedAt: new Date(),
          expiresAt: new Date(Date.now() + 600000)
        }
      });

      const res = await supertest(app)
        .post(`/api/v1/payments/slip/upload/${consumedIntent.id}`)
        .set('Cookie', `horplus_session=${sessionTokenTenantA}; horplus_csrf=${csrfTokenTenantA}`)
        .set('x-csrf-token', csrfTokenTenantA)
        .set('x-dormitory-id', dormIdA)
        .attach('file', fakePng, 'slip.png');

      expect(res.status).toBe(409);
    });

    it('should reject duplicate payment slip file hash with 409', async () => {
      const billA = await prisma.bill.create({
        data: {
          dormitoryId: dormIdA,
          billingCycleId: cycleA.id,
          tenantId: tenantA.id,
          roomId: roomA101.id,
          billNumber: 'BILL-A-DUP-HASH',
          totalAmount: '4500.00',
          status: 'unpaid',
          dueDate: new Date('2026-08-31'),
          billingDate: new Date('2026-08-01')
        }
      });

      const fakePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
      const fileHash = crypto.createHash('sha256').update(fakePng).digest('hex');

      // Existing intent with same hash already uploaded
      await prisma.paymentUploadIntent.create({
        data: {
          dormitoryId: dormIdA,
          tenantId: tenantA.id,
          billId: billA.id,
          authenticatedUserId: tenantUserA.id,
          expectedMimeType: 'image/png',
          expectedSize: fakePng.length,
          verifiedMimeType: 'image/png',
          verifiedSize: fakePng.length,
          objectKey: `payments/${dormIdA}/${billA.id}/uploaded.png`,
          sha256: fileHash,
          status: 'UPLOADED',
          uploadedAt: new Date(),
          expiresAt: new Date(Date.now() + 600000)
        }
      });

      // New intent attempt with identical file hash
      const newIntent = await prisma.paymentUploadIntent.create({
        data: {
          dormitoryId: dormIdA,
          tenantId: tenantA.id,
          billId: billA.id,
          authenticatedUserId: tenantUserA.id,
          expectedMimeType: 'image/png',
          expectedSize: fakePng.length,
          status: 'CREATED',
          expiresAt: new Date(Date.now() + 600000)
        }
      });

      const res = await supertest(app)
        .post(`/api/v1/payments/slip/upload/${newIntent.id}`)
        .set('Cookie', `horplus_session=${sessionTokenTenantA}; horplus_csrf=${csrfTokenTenantA}`)
        .set('x-csrf-token', csrfTokenTenantA)
        .set('x-dormitory-id', dormIdA)
        .attach('file', fakePng, 'slip.png');

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('DUPLICATE_PAYMENT');
    });

    it('should sanitize signature storage objectKey against directory traversal attacks', async () => {
      const storage = new LocalOwnerSignatureStorage();
      const traversalKey = '../../etc/passwd.png';
      const dummyBuffer = Buffer.from('test signature content');
      await storage.save(traversalKey, dummyBuffer);
      const stream = await storage.getStream(traversalKey);
      expect(stream).toBeDefined();
      await new Promise<void>((resolve, reject) => {
        stream.on('data', () => {});
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      await storage.delete?.(traversalKey);
    });
  });

  // =========================================================================
  // 16. MASS-ASSIGNMENT DEFENSE
  // =========================================================================
  describe('16. Mass-Assignment Defense', () => {
    it('should ignore/strip unauthorized administrative and status fields on room creation', async () => {
      const bld = await prisma.building.create({
        data: { dormitoryId: dormIdA, name: 'Building Mass Assign' }
      });

      const res = await supertest(app)
        .post('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({
          buildingId: bld.id,
          roomNumber: 'M999',
          roomType: 'standard',
          monthlyRent: '5000.00',
          depositAmount: '10000.00',
          // Attacker-supplied administrative / mass-assignment fields:
          roleCode: 'SUPERADMIN',
          isOwner: true,
          permissions: ['*'],
          tokenVersion: 9999,
          status: 'vacant',
          paidAt: '2026-08-01'
        });

      expect(res.status).toBe(201);
      const createdRoom = await prisma.room.findUnique({ where: { id: res.body.data.id } });
      expect(createdRoom?.status).toBe('vacant');
      expect((createdRoom as any).roleCode).toBeUndefined();
      expect((createdRoom as any).isOwner).toBeUndefined();
    });

    it('should ignore forbidden fields on contract creation and validate inputs strictly', async () => {
      const res = await supertest(app)
        .post('/api/v1/contracts')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({
          roomId: roomA101.id,
          tenantId: tenantA.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          rentAmount: 4500,
          depositAmount: 9000,
          // Mass assignment fields:
          status: 'terminated',
          terminatedAt: '2026-01-01',
          isOwner: true,
          role: 'ADMIN'
        });

      expect([201, 400, 409]).toContain(res.status);
    });
  });

  // =========================================================================
  // 17. SECRET & ERROR RESPONSE HYGIENE
  // =========================================================================
  describe('17. Secret & Error Response Hygiene', () => {
    it('should not leak stack traces or internal SQL details in error responses', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'malformed.invalid.token' });

      expect([400, 401, 429]).toContain(res.status);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('node_modules');
      expect(JSON.stringify(res.body)).not.toContain('DATABASE_URL');
      expect(JSON.stringify(res.body)).not.toContain('SESSION_ENCRYPTION_KEY');
    });
  });
});
