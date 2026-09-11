import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { getPrismaClient } from '../db/prisma.js';
import { createApp } from '../app.js';
import { AuthenticationService } from '../services/auth.service.js';
import { getEnv, resetCachedEnv } from '../config/env.js';
import { PrismaUserRepository } from '../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../db/repositories/role.repository.js';
import { getCanonicalSignatureStorageDir } from '../services/signature-storage.service.js';

describe('Tenant Phase 3 Step 3C.5A: Contract Signature Streaming Endpoint Security & Isolation', () => {
  const prisma = getPrismaClient();
  let app: any;
  let authService: any;

  let owner1UserId: string;
  let owner2UserId: string;
  let dorm1Id: string;
  let dorm2Id: string;
  let building1Id: string;
  let building2Id: string;
  let room1Id: string;
  let room2Id: string;
  let tenant1Id: string;
  let tenant2Id: string;
  let contractWithSigsId: string;
  let contractWithoutSigsId: string;
  let contractInDorm2Id: string;

  let sessionCookie1: string;
  let sessionCookie2: string;

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

  const testSigFileName = `test-sig-${Date.now()}.png`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const storageDir = getCanonicalSignatureStorageDir();
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    fs.writeFileSync(path.join(storageDir, testSigFileName), validPngBuffer);

    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {}, logSecurityEvent: async () => {} } as any;

    authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    app = createApp({ customAuthService: authService, forcePrisma: true });

    // 1. Create Owner User 1 and Dormitory 1
    const owner1 = await prisma.user.create({
      data: {
        googleSubject: `sub-sig1-${Date.now()}`,
        email: `owner-sig1-${Date.now()}@example.com`,
        emailNormalized: `owner-sig1-${Date.now()}@example.com`.toLowerCase(),
        name: 'Signature Owner 1',
        status: 'active',
      },
    });
    owner1UserId = owner1.id;

    const dorm1 = await prisma.dormitory.create({
      data: {
        name: `Signature Dorm 1 ${Date.now()}`,
        addressLine1: '123 Test Road',
        status: 'active',
        createdByUserId: owner1UserId,
      },
    });
    dorm1Id = dorm1.id;

    // Create OWNER role and membership for Owner 1 in Dorm 1
    const role1 = await prisma.role.create({
      data: {
        dormitoryId: dorm1Id,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        userId: owner1UserId,
        dormitoryId: dorm1Id,
        roleId: role1.id,
        status: 'active',
      },
    });

    const auth1 = await authService.authenticateTestUser(owner1UserId);
    sessionCookie1 = `horplus_session=${auth1.sessionToken}; horplus_csrf=${auth1.csrfToken}`;

    // 2. Create Owner User 2 and Dormitory 2 (Cross-dorm testing)
    const owner2 = await prisma.user.create({
      data: {
        googleSubject: `sub-sig2-${Date.now()}`,
        email: `owner-sig2-${Date.now()}@example.com`,
        emailNormalized: `owner-sig2-${Date.now()}@example.com`.toLowerCase(),
        name: 'Signature Owner 2',
        status: 'active',
      },
    });
    owner2UserId = owner2.id;

    const dorm2 = await prisma.dormitory.create({
      data: {
        name: `Signature Dorm 2 ${Date.now()}`,
        addressLine1: '456 Cross Road',
        status: 'active',
        createdByUserId: owner2UserId,
      },
    });
    dorm2Id = dorm2.id;

    const role2 = await prisma.role.create({
      data: {
        dormitoryId: dorm2Id,
        code: 'OWNER',
        name: 'Owner',
        permissions: ['*'],
      },
    });
    await prisma.dormitoryMember.create({
      data: {
        userId: owner2UserId,
        dormitoryId: dorm2Id,
        roleId: role2.id,
        status: 'active',
      },
    });

    const auth2 = await authService.authenticateTestUser(owner2UserId);
    sessionCookie2 = `horplus_session=${auth2.sessionToken}; horplus_csrf=${auth2.csrfToken}`;

    // 3. Create buildings and rooms
    const building1 = await prisma.building.create({
      data: {
        dormitoryId: dorm1Id,
        name: 'Building Sig 1',
        monthlyDeposit: 8000,
        termDeposit: 8000,
        dailyDeposit: 1000,
        depositAmount: 8000,
      },
    });
    building1Id = building1.id;

    const room1 = await prisma.room.create({
      data: {
        dormitoryId: dorm1Id,
        buildingId: building1Id,
        roomNumber: 'SIG-101',
        normalizedRoomNumber: 'SIG-101',
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        depositAmount: 8000,
        monthlyDeposit: 8000,
        termDeposit: 8000,
        dailyDeposit: 1000,
      },
    });
    room1Id = room1.id;

    const tenant1 = await prisma.tenant.create({
      data: {
        dormitoryId: dorm1Id,
        tenantNumber: `TSIG-${Date.now().toString().slice(-4)}`,
        firstName: 'ทดสอบ',
        lastName: 'ลายเซ็น',
        displayName: 'ทดสอบ ลายเซ็น',
        phone: '0812345678',
        status: 'active',
      },
    });
    tenant1Id = tenant1.id;

    // 4. Create Contract with signatures in Dorm 1
    const contractWithSigs = await prisma.contract.create({
      data: {
        dormitoryId: dorm1Id,
        roomId: room1Id,
        tenantId: tenant1Id,
        contractNumber: `CT-SIG-WITH-${Date.now()}`,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: 4000,
        depositAmount: 8000,
        tenantSignature: testSigFileName,
        ownerSignature: testSigFileName,
        signedByTenantAt: new Date(),
        signedByOwnerAt: new Date(),
      },
    });
    contractWithSigsId = contractWithSigs.id;

    // 5. Create Contract without signatures in Dorm 1
    const contractWithoutSigs = await prisma.contract.create({
      data: {
        dormitoryId: dorm1Id,
        roomId: room1Id,
        tenantId: tenant1Id,
        contractNumber: `CT-SIG-WITHOUT-${Date.now()}`,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: 4000,
        depositAmount: 8000,
        tenantSignature: null,
        ownerSignature: null,
      },
    });
    contractWithoutSigsId = contractWithoutSigs.id;

    // 6. Create Building, Room & Contract in Dorm 2
    const building2 = await prisma.building.create({
      data: {
        dormitoryId: dorm2Id,
        name: 'Building Sig 2',
        monthlyDeposit: 8000,
        termDeposit: 8000,
        dailyDeposit: 1000,
        depositAmount: 8000,
      },
    });
    building2Id = building2.id;

    const room2 = await prisma.room.create({
      data: {
        dormitoryId: dorm2Id,
        buildingId: building2Id,
        roomNumber: 'SIG-201',
        normalizedRoomNumber: 'SIG-201',
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        depositAmount: 8000,
        monthlyDeposit: 8000,
        termDeposit: 8000,
        dailyDeposit: 1000,
      },
    });
    room2Id = room2.id;

    const tenant2 = await prisma.tenant.create({
      data: {
        dormitoryId: dorm2Id,
        tenantNumber: `TSIG2-${Date.now().toString().slice(-4)}`,
        firstName: 'ผู้เช่า',
        lastName: 'หอสอง',
        displayName: 'ผู้เช่า หอสอง',
        phone: '0898765432',
        status: 'active',
      },
    });
    tenant2Id = tenant2.id;

    const contract2 = await prisma.contract.create({
      data: {
        dormitoryId: dorm2Id,
        roomId: room2.id,
        tenantId: tenant2.id,
        contractNumber: `CT-SIG-DORM2-${Date.now()}`,
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        durationMonths: 12,
        rentAmount: 4000,
        depositAmount: 8000,
        tenantSignature: testSigFileName,
        ownerSignature: testSigFileName,
      },
    });
    contractInDorm2Id = contract2.id;
  });

  afterAll(async () => {
    try {
      const storageDir = path.join(process.cwd(), 'storage', 'signatures');
      const testFilePath = path.join(storageDir, testSigFileName);
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
      if (contractWithSigsId) await prisma.contract.deleteMany({ where: { id: contractWithSigsId } }).catch(() => {});
      if (contractWithoutSigsId) await prisma.contract.deleteMany({ where: { id: contractWithoutSigsId } }).catch(() => {});
      if (contractInDorm2Id) await prisma.contract.deleteMany({ where: { id: contractInDorm2Id } }).catch(() => {});
      if (tenant1Id) await prisma.tenant.deleteMany({ where: { id: tenant1Id } }).catch(() => {});
      if (tenant2Id) await prisma.tenant.deleteMany({ where: { id: tenant2Id } }).catch(() => {});
      if (room1Id) await prisma.room.deleteMany({ where: { id: room1Id } }).catch(() => {});
      if (room2Id) await prisma.room.deleteMany({ where: { id: room2Id } }).catch(() => {});
      if (building1Id) await prisma.building.deleteMany({ where: { id: building1Id } }).catch(() => {});
      if (building2Id) await prisma.building.deleteMany({ where: { id: building2Id } }).catch(() => {});
      if (dorm1Id) {
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm1Id } }).catch(() => {});
        await prisma.role.deleteMany({ where: { dormitoryId: dorm1Id } }).catch(() => {});
        await prisma.dormitory.deleteMany({ where: { id: dorm1Id } }).catch(() => {});
      }
      if (dorm2Id) {
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm2Id } }).catch(() => {});
        await prisma.role.deleteMany({ where: { dormitoryId: dorm2Id } }).catch(() => {});
        await prisma.dormitory.deleteMany({ where: { id: dorm2Id } }).catch(() => {});
      }
      if (owner1UserId) {
        await prisma.session.deleteMany({ where: { userId: owner1UserId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: owner1UserId } }).catch(() => {});
      }
      if (owner2UserId) {
        await prisma.session.deleteMany({ where: { userId: owner2UserId } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: owner2UserId } }).catch(() => {});
      }
    } catch {}
  });

  // 1. Returns 401 when unauthenticated (no session)
  it('1. Returns 401 when unauthenticated (no session cookie)', async () => {
    const res = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/tenant-signature`)
      .set('X-Dormitory-Id', dorm1Id);

    expect(res.status).toBe(401);
  });

  // 2. Returns 403 when user is not a member of the dormitory (cross-dorm owner)
  it('2. Returns 403 when user has no permission on dormitory (cross-dorm owner)', async () => {
    const res = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/tenant-signature`)
      .set('Cookie', [sessionCookie2])
      .set('X-Dormitory-Id', dorm1Id);

    expect(res.status).toBe(403);
  });

  // 3. Returns 404 when contract belongs to another dormitory (cross-dorm contract isolation)
  it('3. Returns 404 when contract belongs to another dormitory', async () => {
    const res = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractInDorm2Id}/tenant-signature`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(res.status).toBe(404);
  });

  // 4. Returns 404 when contract does not exist
  it('4. Returns 404 when contract does not exist', async () => {
    const fakeContractId = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${fakeContractId}/tenant-signature`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(res.status).toBe(404);
  });

  // 5. Returns 404 when requested party signature is absent
  it('5. Returns 404 when requested party signature is absent / null', async () => {
    const res = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithoutSigsId}/tenant-signature`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(res.status).toBe(404);
  });

  // 6. Returns 200 with Content-Type: image/png when valid and authorized
  it('6. Returns 200 with Content-Type: image/png when valid and authorized for both tenant and owner signatures', async () => {
    // Tenant signature via dedicated route
    const resTenant = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/tenant-signature`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(resTenant.status).toBe(200);
    expect(resTenant.headers['content-type']).toContain('image/png');
    expect(resTenant.body).toEqual(validPngBuffer);

    // Owner signature via dedicated route
    const resOwner = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/owner-signature`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(resOwner.status).toBe(200);
    expect(resOwner.headers['content-type']).toContain('image/png');
    expect(resOwner.body).toEqual(validPngBuffer);

    // Signatures via party route
    const resPartyTenant = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/signatures/tenant`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(resPartyTenant.status).toBe(200);
    expect(resPartyTenant.headers['content-type']).toContain('image/png');

    const resPartyOwner = await request(app)
      .get(`/api/v1/dormitories/${dorm1Id}/contracts/${contractWithSigsId}/signatures/owner`)
      .set('Cookie', [sessionCookie1])
      .set('X-Dormitory-Id', dorm1Id);

    expect(resPartyOwner.status).toBe(200);
    expect(resPartyOwner.headers['content-type']).toContain('image/png');
  });
});
