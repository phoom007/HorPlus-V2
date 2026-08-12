import { describe, it, expect, beforeEach } from 'vitest';
import supertest from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app.js';
import { SessionTokenService } from '../src/services/session-token.service.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { TenantService } from '../src/services/tenant.service.js';
import { InMemoryTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../src/db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../src/db/repositories/room.repository.js';
import { SensitiveFieldService } from '../src/services/sensitive-field.service.js';

import { getPrismaClient } from '../src/db/prisma.js';

describe('LOCAL-01 — Tenant Onboarding & Co-Occupant Management', () => {
  let tenantRepo: InMemoryTenantRepository;
  let contractRepo: InMemoryContractRepository;
  let roomRepo: InMemoryRoomRepository;
  let tenantService: TenantService;
  let registrationService: TenantRegistrationService;

  const dormA = '11111111-1111-4111-8111-111111111111';
  const dormB = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    tenantRepo = new InMemoryTenantRepository();
    contractRepo = new InMemoryContractRepository();
    roomRepo = new InMemoryRoomRepository();
    const sensitiveService = new SensitiveFieldService('test-secret-key-32-chars-long!!!!!!');

    tenantService = new TenantService(tenantRepo, contractRepo, sensitiveService);
    registrationService = new TenantRegistrationService();

    const prisma = getPrismaClient();
    await prisma.dormitory.upsert({
      where: { id: dormA },
      create: { id: dormA, name: 'Dorm A', code: 'DORM-A' },
      update: {},
    });
  });

  describe('Co-Occupant Management & RLS Isolation', () => {
    const createActiveContractForTenant = async (dormId: string, tenantId: string) => {
      return contractRepo.create(dormId, {
        tenantId,
        roomId: '11111111-0000-0000-0000-000000000000',
        status: 'active',
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000 * 30),
        durationMonths: 1,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      });
    };

    it('should add, update, and soft-remove co-occupants with historical auditability', async () => {
      // 1. Create Tenant in Dorm A with active contract
      const tenant = await tenantService.createTenant(dormA, {
        firstName: 'Somchai',
        lastName: 'Jaidee',
        phone: '0812345678',
      });
      await createActiveContractForTenant(dormA, tenant.id);

      // 2. Add Co-Occupant
      const co1 = await tenantService.addCoOccupant(dormA, tenant.id, {
        name: 'Somying Jaidee',
        phone: '0898765432',
        relationship: 'Sister',
      });

      expect(co1.id).toBeDefined();
      expect(co1.name).toBe('Somying Jaidee');
      expect(co1.status).toBe('active');

      // 3. Verify co-occupant appears in tenant details
      const details = await tenantService.getTenantDetails(tenant.id, dormA);
      expect(details.coOccupants.length).toBe(1);
      expect(details.coOccupants[0].name).toBe('Somying Jaidee');

      // 4. Update Co-Occupant
      const updated = await tenantService.updateCoOccupant(dormA, tenant.id, co1.id, {
        name: 'Somying Jaidee-Rak',
        relationship: 'Wife',
      });
      expect(updated.name).toBe('Somying Jaidee-Rak');

      // 5. Remove Co-Occupant
      const removeRes = await tenantService.removeCoOccupant(dormA, tenant.id, co1.id);
      expect(removeRes.success).toBe(true);

      // 6. Verify soft-removal preserves historical accountability
      const detailsAfterRemove = await tenantService.getTenantDetails(tenant.id, dormA);
      expect(detailsAfterRemove.coOccupants.length).toBe(0);
    });

    it('should reject co-occupant update/delete if coOccupant belongs to another tenant (ownership binding attack)', async () => {
      // Create Tenant A and Tenant B in same Dorm A with active contracts
      const tenantA = await tenantService.createTenant(dormA, { firstName: 'TenantA', lastName: 'Alpha', phone: '0811111111' });
      await createActiveContractForTenant(dormA, tenantA.id);

      const tenantB = await tenantService.createTenant(dormA, { firstName: 'TenantB', lastName: 'Beta', phone: '0822222222' });
      await createActiveContractForTenant(dormA, tenantB.id);

      // Add co-occupant to Tenant B
      const coB = await tenantService.addCoOccupant(dormA, tenantB.id, { name: 'CoOccupant B1' });

      // Attempt updating B's co-occupant via Tenant A's route -> Must fail
      await expect(
        tenantService.updateCoOccupant(dormA, tenantA.id, coB.id, { name: 'Hacked CoOccupant B1' })
      ).rejects.toThrow();

      // Attempt deleting B's co-occupant via Tenant A's route -> Must fail
      await expect(
        tenantService.removeCoOccupant(dormA, tenantA.id, coB.id)
      ).rejects.toThrow();
    });

    it('should reject co-occupant mutations if tenant has no active contract or occupancy', async () => {
      // Create inactive/archived tenant without active contract or occupancy
      const inactiveTenant = await tenantService.createTenant(dormA, { firstName: 'Inactive', lastName: 'Tenant', phone: '0833333333' });

      // Active tenancy check fails because no active contract or occupancy exists
      await expect(
        tenantService.addCoOccupant(dormA, inactiveTenant.id, { name: 'New CoOccupant' })
      ).rejects.toThrow();
    });

    it('should enforce strict cross-dormitory isolation on co-occupant mutations', async () => {
      // Create Tenant in Dorm A with active contract
      const tenantA = await tenantService.createTenant(dormA, {
        firstName: 'TenantA',
        lastName: 'Test',
        phone: '0811111111',
      });
      await createActiveContractForTenant(dormA, tenantA.id);

      const coA = await tenantService.addCoOccupant(dormA, tenantA.id, {
        name: 'CoOccupant A',
      });

      // Attempt mutating Dorm A tenant co-occupant from Dorm B context -> Must throw 404 / error
      await expect(
        tenantService.addCoOccupant(dormB, tenantA.id, { name: 'Hacker Co' })
      ).rejects.toThrow();

      await expect(
        tenantService.updateCoOccupant(dormB, tenantA.id, coA.id, { name: 'Hacked Name' })
      ).rejects.toThrow();

      await expect(
        tenantService.removeCoOccupant(dormB, tenantA.id, coA.id)
      ).rejects.toThrow();
    });
  });

  describe('Registration Approval Concurrency, Idempotency & Rollback Safety', () => {
    const buildingId = '33333333-3333-4333-8333-333333333333';
    const roomId = '44444444-4444-4444-8444-444444444444';

    beforeEach(async () => {
      const prisma = getPrismaClient();
      // Clean up from prior runs (order respects FK constraints)
      await prisma.occupancy.deleteMany({ where: { dormitoryId: dormA } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dormA } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dormA } });
      await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: dormA } });
      await prisma.room.deleteMany({ where: { dormitoryId: dormA } });
      await prisma.building.deleteMany({ where: { dormitoryId: dormA } });

      // Create shared building + room
      await prisma.building.create({
        data: { id: buildingId, dormitoryId: dormA, name: 'Building 1', code: 'B1' },
      });
      await prisma.room.create({
        data: {
          id: roomId,
          dormitoryId: dormA,
          buildingId,
          roomNumber: '101',
          normalizedRoomNumber: '101',
          floor: 1,
          roomType: 'standard',
          monthlyRent: '5000',
          status: 'vacant',
        },
      });
    });

    it('should reject duplicate approval attempt on an already approved request (idempotency)', async () => {
      // 1. Create registration request with a valid room (schema requires requestedRoomId)
      const req = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'Idempotent',
        lastName: 'Test',
        phone: '0819991111',
      });

      // 2. Approve request once (with contract to exercise full path)
      const approved = await registrationService.approveRequest(req.id, dormA, {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      });
      expect(approved.request.status).toBe('approved');

      // 3. Second approval attempt must fail with INVALID_REQUEST_STATUS
      await expect(
        registrationService.approveRequest(req.id, dormA, {
          startDate: '2026-09-01',
          endDate: '2027-08-31',
          durationMonths: 12,
          rentAmount: '5000',
          depositAmount: '5000',
          advancePaymentAmount: '5000',
        })
      ).rejects.toThrow();
    });

    it('should enforce concurrency control: exactly ONE winner and ONE conflict on concurrent approval attempts', async () => {
      // 1. Create 2 registration requests for the same room
      const reqA = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'ConcurrentA',
        lastName: 'WinnerOrLoser',
        phone: '0812221111',
      });

      const reqB = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'ConcurrentB',
        lastName: 'WinnerOrLoser',
        phone: '0812222222',
      });

      const contractPayload = {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      };

      // 2. Run concurrent approval attempts using Promise.allSettled
      const results = await Promise.allSettled([
        registrationService.approveRequest(reqA.id, dormA, contractPayload),
        registrationService.approveRequest(reqB.id, dormA, contractPayload),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Verify winner is approved and loser remains pending
      const checkA = await registrationService.getRequestById(reqA.id, dormA);
      const checkB = await registrationService.getRequestById(reqB.id, dormA);

      const statuses = [checkA.status, checkB.status];
      expect(statuses).toContain('approved');
      expect(statuses).toContain('pending_owner_approval');
    });

    it('should reject approval with missing contract terms (partial-approval prevention)', async () => {
      const req = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'Partial',
        lastName: 'Blocked',
        phone: '0818881111',
      });

      // Attempt approval without contract terms → must fail BEFORE any mutation
      await expect(
        registrationService.approveRequest(req.id, dormA, {} as any)
      ).rejects.toThrow();

      // Verify zero side effects: request still pending, no tenant/contract/occupancy created
      const check = await registrationService.getRequestById(req.id, dormA);
      expect(check.status).toBe('pending_owner_approval');

      const prisma = getPrismaClient();
      const tenantCount = await prisma.tenant.count({ where: { dormitoryId: dormA, firstName: 'Partial' } });
      expect(tenantCount).toBe(0);
    });

    it('should create complete tenancy state on valid approval (Tenant + Contract + Occupancy + Room=occupied)', async () => {
      const req = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'Complete',
        lastName: 'State',
        phone: '0817771111',
      });

      const result = await registrationService.approveRequest(req.id, dormA, {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      });

      // Verify all entities created
      expect(result.request.status).toBe('approved');
      expect(result.tenant).toBeDefined();
      expect(result.tenant.firstName).toBe('Complete');
      expect(result.contractId).toBeDefined();
      expect(result.occupancy).toBeDefined();
      expect(result.occupancy.status).toBe('ACTIVE');

      // Verify Room is occupied via direct PostgreSQL query
      const prisma = getPrismaClient();
      const room = await prisma.room.findUnique({ where: { id: roomId } });
      expect(room!.status).toBe('occupied');
      expect(room!.currentTenantId).toBe(result.tenant.id);
      expect(room!.currentContractId).toBe(result.contractId);

      // Verify Contract exists and is active
      const contract = await prisma.contract.findUnique({ where: { id: result.contractId! } });
      expect(contract!.status).toBe('active');
      expect(contract!.tenantId).toBe(result.tenant.id);

      // Verify Occupancy exists and is active
      const occupancy = await prisma.occupancy.findFirst({ where: { roomId, dormitoryId: dormA, status: 'ACTIVE' } });
      expect(occupancy).toBeDefined();
      expect(occupancy!.tenantId).toBe(result.tenant.id);
    });

    it('should block approval for an already-occupied room', async () => {
      // Create BOTH requests while room is still vacant (product rule: multiple pending allowed)
      const req1 = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'First',
        lastName: 'Tenant',
        phone: '0816661111',
      });
      const req2 = await registrationService.createRequest(dormA, {
        requestedRoomId: roomId,
        firstName: 'Second',
        lastName: 'Applicant',
        phone: '0816662222',
      });

      // Approve the first request → room becomes occupied
      await registrationService.approveRequest(req1.id, dormA, {
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        durationMonths: 12,
        rentAmount: '5000',
        depositAmount: '5000',
        advancePaymentAmount: '5000',
      });

      // Attempt to approve second applicant for same occupied room → must fail
      await expect(
        registrationService.approveRequest(req2.id, dormA, {
          startDate: '2026-09-01',
          endDate: '2027-08-31',
          durationMonths: 12,
          rentAmount: '5000',
          depositAmount: '5000',
          advancePaymentAmount: '5000',
        })
      ).rejects.toThrow();

      // Loser remains pending
      const check = await registrationService.getRequestById(req2.id, dormA);
      expect(check.status).toBe('pending_owner_approval');
    });
  });

  describe('Security & Authorization Boundary (Phase 9 & Phase 10)', () => {
    let app: any;
    let dormAId: string;
    let dormBId: string;
    let userAId: string;
    let userBId: string;
    let userCId: string;
    let sessionTokenA: string;
    let sessionTokenB: string;
    let sessionTokenC: string;
    let reqAId: string;
    let reqBId: string;
    let roomAId: string;

    beforeEach(async () => {
      await subscriptionEntitlementService.ensureSeeded();
      app = createApp({ forcePrisma: true });
      const prisma = getPrismaClient();

      const sessionSecret = process.env.SESSION_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef';
      const tokenService = new SessionTokenService(sessionSecret);

      // Create User A & Dorm A
      const emailA = `sec-owner-a-${Date.now()}-${Math.random()}@example.com`;
      const userA = await prisma.user.create({
        data: {
          email: emailA,
          emailNormalized: emailA.toLowerCase(),
          name: 'Sec Owner A',
          googleSubject: `sub-sec-a-${Date.now()}-${Math.random()}`,
          status: 'active',
        },
      });
      userAId = userA.id;

      const dormAObj = await prisma.dormitory.create({
        data: {
          name: `Sec Dorm A ${Date.now()}`,
          code: `SDA-${Date.now()}`,
          status: 'active',
          createdByUserId: userA.id,
        },
      });
      dormAId = dormAObj.id;

      const roleOwnerA = await prisma.role.create({
        data: { dormitoryId: dormAId, code: 'OWNER', name: 'Owner', isSystem: true, permissions: ['*'] },
      });
      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: dormAId,
          userId: userAId,
          roleId: roleOwnerA.id,
          status: 'active',
        },
      });

      const sidA = crypto.randomUUID();
      const sidAHash = SessionTokenService.hashSessionId(sidA);
      await prisma.session.create({
        data: { user: { connect: { id: userAId } }, sessionIdHash: sidAHash, expiresAt: new Date(Date.now() + 86400000), status: 'active' },
      });
      sessionTokenA = tokenService.encryptToken({ sub: userAId, sid: sidA, type: 'session', version: 1 }, 86400);

      // Create User B & Dorm B
      const emailB = `sec-owner-b-${Date.now()}-${Math.random()}@example.com`;
      const userB = await prisma.user.create({
        data: {
          email: emailB,
          emailNormalized: emailB.toLowerCase(),
          name: 'Sec Owner B',
          googleSubject: `sub-sec-b-${Date.now()}-${Math.random()}`,
          status: 'active',
        },
      });
      userBId = userB.id;

      const dormBObj = await prisma.dormitory.create({
        data: {
          name: `Sec Dorm B ${Date.now()}`,
          code: `SDB-${Date.now()}`,
          status: 'active',
          createdByUserId: userB.id,
        },
      });
      dormBId = dormBObj.id;

      const roleOwnerB = await prisma.role.create({
        data: { dormitoryId: dormBId, code: 'OWNER', name: 'Owner', isSystem: true, permissions: ['*'] },
      });
      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: dormBId,
          userId: userBId,
          roleId: roleOwnerB.id,
          status: 'active',
        },
      });

      const sidB = crypto.randomUUID();
      const sidBHash = SessionTokenService.hashSessionId(sidB);
      await prisma.session.create({
        data: { user: { connect: { id: userBId } }, sessionIdHash: sidBHash, expiresAt: new Date(Date.now() + 86400000), status: 'active' },
      });
      sessionTokenB = tokenService.encryptToken({ sub: userBId, sid: sidB, type: 'session', version: 1 }, 86400);

      // Create User C (TECH role in Dorm A — no tenant:read permission)
      const emailC = `sec-tech-c-${Date.now()}-${Math.random()}@example.com`;
      const userC = await prisma.user.create({
        data: {
          email: emailC,
          emailNormalized: emailC.toLowerCase(),
          name: 'Sec Tech C',
          googleSubject: `sub-sec-c-${Date.now()}-${Math.random()}`,
          status: 'active',
        },
      });
      userCId = userC.id;

      const roleTechA = await prisma.role.create({
        data: { dormitoryId: dormAId, code: 'TECH', name: 'Tech', isSystem: true, permissions: ['maintenance:*'] },
      });
      await prisma.dormitoryMember.create({
        data: {
          dormitoryId: dormAId,
          userId: userCId,
          roleId: roleTechA.id,
          status: 'active',
        },
      });

      const sidC = crypto.randomUUID();
      const sidCHash = SessionTokenService.hashSessionId(sidC);
      await prisma.session.create({
        data: { user: { connect: { id: userCId } }, sessionIdHash: sidCHash, expiresAt: new Date(Date.now() + 86400000), status: 'active' },
      });
      sessionTokenC = tokenService.encryptToken({ sub: userCId, sid: sidC, type: 'session', version: 1 }, 86400);

      // Rooms in Dorm A & Dorm B
      const buildingA = await prisma.building.create({
        data: { dormitoryId: dormAId, name: 'Bldg A', floorCount: 1 },
      });
      const roomA = await prisma.room.create({
        data: { dormitoryId: dormAId, buildingId: buildingA.id, roomNumber: 'R101', normalizedRoomNumber: 'R101', status: 'vacant', monthlyRent: '5000' },
      });
      roomAId = roomA.id;

      const buildingB = await prisma.building.create({
        data: { dormitoryId: dormBId, name: 'Bldg B', floorCount: 1 },
      });
      const roomB = await prisma.room.create({
        data: { dormitoryId: dormBId, buildingId: buildingB.id, roomNumber: 'R201', normalizedRoomNumber: 'R201', status: 'vacant', monthlyRent: '6000' },
      });

      // Registration Requests in Dorm A & Dorm B
      const reqA = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId: dormAId,
          requestedRoomId: roomA.id,
          firstName: 'ApplicantA',
          lastName: 'DormA',
          phone: '0811119999',
          note: 'Secret Note A',
          status: 'pending_owner_approval',
        },
      });
      reqAId = reqA.id;

      const reqB = await prisma.tenantRegistrationRequest.create({
        data: {
          dormitoryId: dormBId,
          requestedRoomId: roomB.id,
          firstName: 'ApplicantB',
          lastName: 'DormB',
          phone: '0822229999',
          note: 'Secret Note B',
          status: 'pending_owner_approval',
        },
      });
      reqBId = reqB.id;
    });

    it('Test A — Anonymous public submission succeeds without granting authority', async () => {
      const res = await supertest(app)
        .post('/api/v1/tenant-registrations')
        .send({
          dormitoryId: dormAId,
          requestedRoomId: roomAId,
          firstName: 'PublicAnon',
          lastName: 'Applicant',
          phone: '0899990000',
          note: 'Public submission test',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.status).toBe('pending_owner_approval');
      expect(res.body.data.firstName).toBe('PublicAnon');
      expect(res.headers['set-cookie']).toBeUndefined(); // Zero session/authority granted
    });

    it('Test B — Anonymous private list is rejected (401) with zero PII leakage', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-registrations')
        .set('x-dormitory-id', dormAId);

      expect(res.status).toBe(401);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('ApplicantA');
      expect(text).not.toContain('0811119999');
      expect(text).not.toContain('Secret Note A');
    });

    it('Test C — Anonymous private detail is rejected (401) with zero PII leakage', async () => {
      const res = await supertest(app)
        .get(`/api/v1/tenant-registrations/${reqAId}`)
        .set('x-dormitory-id', dormAId);

      expect(res.status).toBe(401);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('ApplicantA');
      expect(text).not.toContain('0811119999');
      expect(text).not.toContain('Secret Note A');
    });

    it('Test D — Same-dorm authorized read succeeds for Owner', async () => {
      const res = await supertest(app)
        .get('/api/v1/tenant-registrations')
        .set('Cookie', `horplus_session=${sessionTokenA}`)
        .set('x-dormitory-id', dormAId);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.some((r: any) => r.id === reqAId)).toBe(true);
    });

    it('Test E — Cross-dorm list attack is rejected (403) with zero Dorm B PII leakage', async () => {
      // User A (belongs ONLY to Dorm A) sends GET with x-dormitory-id: Dorm B
      const res = await supertest(app)
        .get('/api/v1/tenant-registrations')
        .set('Cookie', `horplus_session=${sessionTokenA}`)
        .set('x-dormitory-id', dormBId);

      expect(res.status).toBe(403);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('ApplicantB');
      expect(text).not.toContain('0822229999');
      expect(text).not.toContain('Secret Note B');
    });

    it('Test F — Cross-dorm detail attack is rejected with zero PII leakage', async () => {
      // User A (belongs ONLY to Dorm A) attempts to read Dorm B request ID
      // Scenario F1: User A sends x-dormitory-id: Dorm B -> 403 FORBIDDEN
      const res1 = await supertest(app)
        .get(`/api/v1/tenant-registrations/${reqBId}`)
        .set('Cookie', `horplus_session=${sessionTokenA}`)
        .set('x-dormitory-id', dormBId);

      expect(res1.status).toBe(403);
      const text1 = JSON.stringify(res1.body);
      expect(text1).not.toContain('ApplicantB');
      expect(text1).not.toContain('0822229999');

      // Scenario F2: User A sends x-dormitory-id: Dorm A -> 404 NOT FOUND (non-enumerating)
      const res2 = await supertest(app)
        .get(`/api/v1/tenant-registrations/${reqBId}`)
        .set('Cookie', `horplus_session=${sessionTokenA}`)
        .set('x-dormitory-id', dormAId);

      expect(res2.status).toBe(404);
      const text2 = JSON.stringify(res2.body);
      expect(text2).not.toContain('ApplicantB');
      expect(text2).not.toContain('0822229999');
    });

    it('Test G — Unauthorized role (TECH) is denied read access (403) with zero PII leakage', async () => {
      // User C has TECH role in Dorm A (no tenant:read privilege)
      const res = await supertest(app)
        .get('/api/v1/tenant-registrations')
        .set('Cookie', `horplus_session=${sessionTokenC}`)
        .set('x-dormitory-id', dormAId);

      expect(res.status).toBe(403);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('ApplicantA');
      expect(text).not.toContain('0811119999');
    });
  });
});
