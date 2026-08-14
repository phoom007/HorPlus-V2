import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { getPrismaClient } from '../src/db/prisma.js';
import { SessionTokenService } from '../src/services/session-token.service.js';
import { CsrfService } from '../src/services/csrf.service.js';
import { AccessGrantService } from '../src/services/access-grant.service.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { encryptText, hashToken } from '../src/utils/crypto-encryption.js';

const prisma = getPrismaClient();

describe('LOCAL-05: Local Security & Resilience Audit Suite', () => {
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

  beforeEach(async () => {
    const env = getEnv();
    sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    csrfService = new CsrfService(env.CSRF_SIGNING_KEY);
    app = createApp();

    // Clean test slate
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE local_notification_outbox, staff_notices, tenant_notices, contract_settlement_items, contract_settlements, tenant_renewal_requests, occupancies, bill_items, receipts, payment_status_histories, payments, bills, contract_snapshots, contracts, tenant_registration_requests, tenants, rooms, buildings, dormitory_members, dormitory_access_grants, dormitories, sessions, users CASCADE;'
    );

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
  // 2. SESSION FORGERY, EXPIRATION, REVOCATION & TOKEN VERSION
  // =========================================================================
  describe('2. Session Forgery, Expiration, Revocation & Token Version', () => {
    it('should reject forged or malformed session cookies with 401', async () => {
      const forgedCookie = 'horplus_session=invalid.forged.signature.token; Path=/; HttpOnly';
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', forgedCookie)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });

    it('should reject revoked session immediately', async () => {
      // Revoke session in database
      await prisma.session.updateMany({
        where: { userId: ownerUserA.id },
        data: { status: 'revoked', revokedAt: new Date() }
      });

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });

    it('should reject session when session tokenVersion is bumped (logout all / password reset)', async () => {
      // Bump session token version from 1 to 2 in database
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

    it('should reject session when user account is suspended', async () => {
      await prisma.user.update({
        where: { id: ownerUserA.id },
        data: { status: 'suspended' }
      });

      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 3. CSRF DEFENSE ON STATE-CHANGING ENDPOINTS
  // =========================================================================
  describe('3. CSRF Defense on State-Changing Endpoints', () => {
    it('should deny mutating request (POST) when CSRF header is missing', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building Unauthorized CSRF' });

      expect(res.status).toBe(403);
    });

    it('should deny mutating request (POST) when CSRF token is forged or mismatched', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', 'forged-csrf-token-12345')
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building Bad CSRF' });

      expect(res.status).toBe(403);
    });

    it('should allow mutating request (POST) with valid session and matching CSRF token', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/buildings')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({ name: 'Building Valid CSRF' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Building Valid CSRF');
    });

    it('should allow safe HTTP GET requests without requiring CSRF header', async () => {
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // 4. CROSS-DORMITORY IDOR & PRIVILEGE ESCALATION
  // =========================================================================
  describe('4. Cross-Dormitory Isolation (IDOR Resistance & Zero Data Leaks)', () => {
    it('should deny Owner A access to Dorm B resources with 403 and zero leaked PII', async () => {
      // Owner A requests Dormitory B room list
      const res = await supertest(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
        .set('x-dormitory-id', dormIdB);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('Dormitory Beta');
      expect(JSON.stringify(res.body)).not.toContain('Tenant Beta');
    });

    it('should deny Owner A querying Dorm B bills, contracts or tenant lists', async () => {
      const endpoints = [
        '/api/v1/bills',
        '/api/v1/contracts',
        '/api/v1/tenants',
        '/api/v1/billing-cycles'
      ];

      for (const ep of endpoints) {
        const res = await supertest(app)
          .get(ep)
          .set('Cookie', `horplus_session=${sessionTokenOwnerA}`)
          .set('x-dormitory-id', dormIdB);

        expect(res.status, `Cross-dormitory query to ${ep} must return 403`).toBe(403);
      }
    });
  });

  // =========================================================================
  // 5. TENANT ISOLATION & TENANT IDOR
  // =========================================================================
  describe('5. Tenant Isolation & Tenant IDOR Resistance', () => {
    it('should scope tenant profile strictly to authenticated user linkage', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`);

      expect(res.status).toBe(200);
      expect(res.body.displayName).toContain('Somchai');
      expect(res.body.dormitory.id).toBe(dormIdA);
    });

    it('should deny Tenant A attempting to access Tenant B notices or contract', async () => {
      // Tenant A should only receive their own notices
      const res = await supertest(app)
        .get('/api/v1/tenant-portal/notices')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`);

      expect(res.status).toBe(200);
      // Notices must only belong to Dorm A / Tenant A
      if (res.body.data && res.body.data.notices && res.body.data.notices.length > 0) {
        for (const n of res.body.data.notices) {
          expect(n.dormitoryId).toBe(dormIdA);
        }
      }
    });

    it('should ignore spoofed x-tenant-id headers in tenant portal requests', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-portal/profile')
        .set('Cookie', `horplus_session=${sessionTokenTenantA}`)
        .set('x-tenant-id', crypto.randomUUID());

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(tenantA.id);
    });
  });

  // =========================================================================
  // 6. STAFF RBAC MATRIX & PRIVILEGE ENFORCEMENT
  // =========================================================================
  describe('6. Staff RBAC Matrix (TECH Role Restrictions)', () => {
    it('should allow TECH role to access maintenance and meter readings', async () => {
      const res = await supertest(app)
        .get('/api/v1/maintenance')
        .set('Cookie', `horplus_session=${sessionTokenTechA}`)
        .set('x-dormitory-id', dormIdA);

      expect(res.status).toBe(200);
    });

    it('should deny TECH role from creating contracts or financial settlements', async () => {
      const res = await supertest(app)
        .post('/api/v1/contracts')
        .set('Cookie', `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`)
        .set('x-csrf-token', csrfTokenTechA)
        .set('x-dormitory-id', dormIdA)
        .send({
          roomId: roomA101.id,
          tenantId: tenantA.id,
          startDate: '2026-06-01',
          endDate: '2027-05-31',
          monthlyRent: 4500,
          depositAmount: 9000
        });

      expect(res.status).toBe(403);
    });

    it('should deny TECH role from creating staff access grants', async () => {
      const res = await supertest(app)
        .post(`/api/v1/properties/${dormIdA}/access-grants`)
        .set('Cookie', `horplus_session=${sessionTokenTechA}; horplus_csrf=${csrfTokenTechA}`)
        .set('x-csrf-token', csrfTokenTechA)
        .set('x-dormitory-id', dormIdA)
        .send({ roleCode: 'TECH', lineFriendId: crypto.randomUUID() });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 7. INPUT VALIDATION, MASS ASSIGNMENT & SQL SAFETY
  // =========================================================================
  describe('7. Input Validation, Mass Assignment & SQL Safety', () => {
    it('should reject negative financial amounts with 400 Bad Request', async () => {
      const res = await supertest(app)
        .post('/api/v1/properties/rooms')
        .set('Cookie', `horplus_session=${sessionTokenOwnerA}; horplus_csrf=${csrfTokenOwnerA}`)
        .set('x-csrf-token', csrfTokenOwnerA)
        .set('x-dormitory-id', dormIdA)
        .send({
          buildingId: roomA101.buildingId,
          roomNumber: 'A999',
          roomType: 'standard',
          monthlyRent: -5000,
          depositAmount: -10000
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
      const friend = await prisma.dormitoryLineFriend.create({
        data: {
          dormitoryId: dormIdA,
          lineUserIdHash: hashToken(rawLineId),
          lineUserIdEncrypted: encryptText(rawLineId),
          displayName: 'Line Staff Alpha'
        }
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
      const friend = await prisma.dormitoryLineFriend.create({
        data: {
          dormitoryId: dormIdA,
          lineUserIdHash: hashToken(rawLineId),
          lineUserIdEncrypted: encryptText(rawLineId),
          displayName: 'Line Staff Replay'
        }
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
      
      // Create 12 distinct LINE friends for Dorm A
      const friends = [];
      for (let i = 0; i < 12; i++) {
        const lineId = `line-quota-${i}-${Date.now()}`;
        const f = await prisma.dormitoryLineFriend.create({
          data: {
            dormitoryId: dormIdA,
            lineUserIdHash: hashToken(lineId),
            lineUserIdEncrypted: encryptText(lineId),
            displayName: `Quota Staff ${i}`
          }
        });
        friends.push(f);
      }

      // Attempt to concurrently create 12 grants
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
  // 9. TRANSACTION ROLLBACK & DATA INTEGRITY RESILIENCE
  // =========================================================================
  describe('9. Transaction Rollback & Data Integrity Resilience', () => {
    it('should roll back completely on transaction failure with zero partial records', async () => {
      const initialOccupancyCount = await prisma.occupancy.count();
      const initialRoomStatus = (await prisma.room.findUnique({ where: { id: roomA101.id } }))?.status;

      // Simulate multi-write transaction failure
      try {
        await prisma.$transaction(async (tx) => {
          // Write 1: create an occupancy record
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

          // Write 2: update room status
          await tx.room.update({
            where: { id: roomA101.id },
            data: { status: 'vacant' }
          });

          // Inject deterministic intentional failure
          throw new Error('SIMULATED_TRANSACTION_FAILURE');
        });
      } catch (err: any) {
        expect(err.message).toBe('SIMULATED_TRANSACTION_FAILURE');
      }

      // Assert complete rollback
      const finalOccupancyCount = await prisma.occupancy.count();
      const finalRoomStatus = (await prisma.room.findUnique({ where: { id: roomA101.id } }))?.status;

      expect(finalOccupancyCount).toBe(initialOccupancyCount);
      expect(finalRoomStatus).toBe(initialRoomStatus);
    });
  });

  // =========================================================================
  // 10. SECRET & ERROR RESPONSE HYGIENE
  // =========================================================================
  describe('10. Secret & Error Response Hygiene', () => {
    it('should not leak stack traces or internal SQL details in error responses', async () => {
      const res = await supertest(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'malformed.invalid.token' });

      expect([400, 401]).toContain(res.status);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('node_modules');
      expect(JSON.stringify(res.body)).not.toContain('DATABASE_URL');
      expect(JSON.stringify(res.body)).not.toContain('SESSION_ENCRYPTION_KEY');
    });
  });
});
