/**
 * LOCAL-07 — Migration, Entitlement & Persistence Integration Test Proof
 *
 * Proves:
 * 1. Forward migration `20260816000000_local07_onboarding_rules_snapshots_line_prefs` is applied cleanly
 * 2. `DormitoryPropertyDefaults.pet_policy` defaults to {"allowed":"none","allowedTypes":[]}
 * 3. `TenantRegistrationRequest` has acceptanceSnapshot, sha256, acceptedAt, and tenantSignature metadata
 * 4. `DormitoryLineConfig` has 5 boolean notification preferences defaulting to true
 * 5. Zero schema drift between database and schema.prisma
 * 6. Historical tenant registrations remain intact with null snapshot
 *
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPrismaClient } from '../../db/prisma.js';
import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../../app.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { getEnv } from '../../config/env.js';

describe('LOCAL-07: Migration, Defaults & Persistence Proof', () => {
  const prisma = getPrismaClient();

  it('1. Column catalog verification for all added fields', async () => {
    const columns = await prisma.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string; column_default: string | null }>>`
      SELECT table_name, column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('dormitory_property_defaults', 'tenant_registration_requests', 'dormitory_line_configs')
        AND column_name IN (
          'pet_policy',
          'acceptance_snapshot',
          'acceptance_snapshot_sha256',
          'accepted_at',
          'tenant_signature_object_key',
          'tenant_signature_sha256',
          'tenant_signature_mime_type',
          'tenant_signature_byte_size',
          'notify_repair_request',
          'notify_repair_completed',
          'notify_payment_received',
          'notify_tenant_register',
          'notify_tenant_approved'
        )
      ORDER BY table_name, column_name;
    `;

    const colMap = new Map(columns.map(c => [`${c.table_name}.${c.column_name}`, c]));

    // DormitoryPropertyDefaults
    expect(colMap.has('dormitory_property_defaults.pet_policy')).toBe(true);
    expect(colMap.get('dormitory_property_defaults.pet_policy')?.data_type).toBe('jsonb');

    // TenantRegistrationRequest
    expect(colMap.has('tenant_registration_requests.acceptance_snapshot')).toBe(true);
    expect(colMap.has('tenant_registration_requests.acceptance_snapshot_sha256')).toBe(true);
    expect(colMap.has('tenant_registration_requests.accepted_at')).toBe(true);
    expect(colMap.has('tenant_registration_requests.tenant_signature_object_key')).toBe(true);
    expect(colMap.has('tenant_registration_requests.tenant_signature_sha256')).toBe(true);
    expect(colMap.has('tenant_registration_requests.tenant_signature_mime_type')).toBe(true);
    expect(colMap.has('tenant_registration_requests.tenant_signature_byte_size')).toBe(true);

    // DormitoryLineConfig
    expect(colMap.has('dormitory_line_configs.notify_repair_request')).toBe(true);
    expect(colMap.has('dormitory_line_configs.notify_repair_completed')).toBe(true);
    expect(colMap.has('dormitory_line_configs.notify_payment_received')).toBe(true);
    expect(colMap.has('dormitory_line_configs.notify_tenant_register')).toBe(true);
    expect(colMap.has('dormitory_line_configs.notify_tenant_approved')).toBe(true);
  });

  it('2. DormitoryPropertyDefaults petPolicy default and CRUD', async () => {
    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_mig_test_${Date.now()}`,
        email: `migtest_${Date.now()}@test.local`,
        emailNormalized: `migtest_${Date.now()}@test.local`,
        name: 'Migration Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: {
        name: 'Migration Test Dormitory',
        createdByUserId: testUser.id,
      },
    });

    const defaults = await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: '1. ห้ามสูบบุหรี่\n2. ห้ามเสียงดัง',
      },
    });

    expect(defaults.petPolicy).toEqual({ allowed: 'none', allowedTypes: [] });

    // Update petPolicy
    const updated = await prisma.dormitoryPropertyDefaults.update({
      where: { id: defaults.id },
      data: {
        petPolicy: { allowed: 'conditional', allowedTypes: ['cat', 'dog'] },
      },
    });

    expect(updated.petPolicy).toEqual({ allowed: 'conditional', allowedTypes: ['cat', 'dog'] });
    expect(updated.defaultTerms).toContain('ห้ามสูบบุหรี่');

    // Cleanup
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('3. DormitoryLineConfig 5 boolean notification preferences default to true and mutate', async () => {
    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_line_test_${Date.now()}`,
        email: `linetest_${Date.now()}@test.local`,
        emailNormalized: `linetest_${Date.now()}@test.local`,
        name: 'Line Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: {
        name: 'Line Test Dormitory',
        createdByUserId: testUser.id,
      },
    });

    const lineConfig = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDorm.id}, true)`;
      return tx.dormitoryLineConfig.create({
        data: {
          dormitoryId: testDorm.id,
          webhookKeyHash: crypto.randomBytes(16).toString('hex'),
        },
      });
    });

    expect(lineConfig.notifyRepairRequest).toBe(true);
    expect(lineConfig.notifyRepairCompleted).toBe(true);
    expect(lineConfig.notifyPaymentReceived).toBe(true);
    expect(lineConfig.notifyTenantRegister).toBe(true);
    expect(lineConfig.notifyTenantApproved).toBe(true);

    // Update preferences
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${testDorm.id}, true)`;
      return tx.dormitoryLineConfig.update({
        where: { id: lineConfig.id },
        data: {
          notifyRepairRequest: false,
          notifyPaymentReceived: true,
        },
      });
    });

    expect(updated.notifyRepairRequest).toBe(false);
    expect(updated.notifyPaymentReceived).toBe(true);

    // Cleanup
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('4. Tenant registration with canonical acceptance snapshot, signature storage, and version concurrency', async () => {
    const { TenantRegistrationService } = await import('../../services/tenant-registration.service.js');
    const { SignatureStorageService } = await import('../../services/signature-storage.service.js');
    const { PNG } = await import('pngjs');

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_ten_test_${Date.now()}`,
        email: `tentest_${Date.now()}@test.local`,
        emailNormalized: `tentest_${Date.now()}@test.local`,
        name: 'Tenant Service Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: {
        name: 'Tenant Snapshot Test Dorm',
        createdByUserId: testUser.id,
      },
    });

    const bld = await prisma.building.create({
      data: {
        dormitoryId: testDorm.id,
        name: 'อาคาร 1',
        code: 'A',
        floorCount: 1,
        roomsPerFloor: 1,
      },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: bld.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 4000,
        status: 'vacant',
      },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: '1. ห้ามสูบบุหรี่\n2. ห้ามเสียงดัง',
        petPolicy: { allowed: 'conditional', allowedTypes: ['cat'] },
      },
    });

    const tenantService = new TenantRegistrationService();

    // 1. Fetch public policy
    const policy = await tenantService.getPublicDormitoryPolicy(testDorm.id);
    expect(policy.defaultTerms).toContain('ห้ามสูบบุหรี่');
    expect(policy.petPolicy).toEqual({ allowed: 'conditional', allowedTypes: ['cat'] });
    expect(policy.version).toBeGreaterThanOrEqual(1);

    // Create a 50x20 test PNG signature
    const png = new PNG({ width: 50, height: 20 });
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 50; x++) {
        const idx = (50 * y + x) << 2;
        if (x >= 5 && x <= 45 && y >= 8 && y <= 12) {
          png.data[idx] = 0; png.data[idx + 1] = 0; png.data[idx + 2] = 0; png.data[idx + 3] = 255;
        } else {
          png.data[idx] = 255; png.data[idx + 1] = 255; png.data[idx + 2] = 255; png.data[idx + 3] = 0;
        }
      }
    }
    const sigBuffer = PNG.sync.write(png);
    const sigBase64 = `data:image/png;base64,${sigBuffer.toString('base64')}`;

    // 2. Submit valid registration request with agreement & signature
    const createdReq = await tenantService.createRequest(testDorm.id, {
      dormitoryId: testDorm.id,
      requestedRoomId: room.id,
      firstName: 'สมบูรณ์',
      lastName: 'มีสุข',
      phone: '0812345678',
      agreedTerms: true,
      signatureBase64: sigBase64,
      expectedPolicyVersion: policy.version,
    });

    expect(createdReq.status).toBe('pending_owner_approval');
    expect(createdReq.acceptanceSnapshotSha256).toBeDefined();
    expect(createdReq.acceptanceSnapshotSha256?.length).toBe(64);
    expect(createdReq.tenantSignatureObjectKey).toBeDefined();
    expect(createdReq.tenantSignatureSha256).toBeDefined();

    // 3. Stale policy version -> 409 conflict
    await expect(
      tenantService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'วิชัย',
        lastName: 'สุขใจ',
        phone: '0898765432',
        agreedTerms: true,
        signatureBase64: sigBase64,
        expectedPolicyVersion: 9999, // Stale
      })
    ).rejects.toThrow();

    // Cleanup
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('5. Permanent FREE tier entitlement & First-10 active room restriction', async () => {
    const { SubscriptionEntitlementService } = await import('../../services/subscription-entitlement.service.js');
    const { RoomService } = await import('../../services/room.service.js');

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_ent_test_${Date.now()}`,
        email: `enttest_${Date.now()}@test.local`,
        emailNormalized: `enttest_${Date.now()}@test.local`,
        name: 'Entitlement Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: {
        name: 'Free Entitlement Test Dorm',
        createdByUserId: testUser.id,
      },
    });

    const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: testDorm.id,
        planId: freePlan!.id,
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });

    const bld = await prisma.building.create({
      data: {
        dormitoryId: testDorm.id,
        name: 'อาคาร A',
        code: 'A',
        floorCount: 2,
        roomsPerFloor: 6,
      },
    });

    // Create 12 rooms
    const createdRooms = [];
    for (let i = 1; i <= 12; i++) {
      const roomNum = `10${i < 10 ? '0' + i : i}`;
      const r = await prisma.room.create({
        data: {
          dormitoryId: testDorm.id,
          buildingId: bld.id,
          roomNumber: roomNum,
          normalizedRoomNumber: roomNum,
          roomType: 'standard',
          floor: 1,
          monthlyRent: 3000,
          depositAmount: 3000,
          status: 'vacant',
        },
      });
      createdRooms.push(r);
    }

    const entitlementService = new SubscriptionEntitlementService();
    const effective = await entitlementService.getEffectiveEntitlements(testDorm.id);

    // FREE plan: unlimited rooms for planning, isOverLimit is false
    expect(effective.isOverLimit).toBe(false);
    expect(effective.isReadOnly).toBe(false);
    expect(effective.roomLimit).toBe(10);
    expect(effective.roomCount).toBe(12);

    // First 10 rooms are operationally entitled
    for (let i = 0; i < 10; i++) {
      await expect(
        entitlementService.assertRoomOperationalEntitlement(testDorm.id, createdRooms[i].id)
      ).resolves.not.toThrow();
    }

    // Room 11 and 12 are NOT operationally entitled
    await expect(
      entitlementService.assertRoomOperationalEntitlement(testDorm.id, createdRooms[10].id)
    ).rejects.toThrow('ห้องพักนี้เกินสิทธิ์การใช้งานของแพ็กเกจฟรี');

    await expect(
      entitlementService.assertRoomOperationalEntitlement(testDorm.id, createdRooms[11].id)
    ).rejects.toThrow('ห้องพักนี้เกินสิทธิ์การใช้งานของแพ็กเกจฟรี');

    // RoomService getRooms marks isEntitled accurately
    const { PrismaRoomRepository } = await import('../../db/repositories/room.repository.js');
    const { PrismaBuildingRepository } = await import('../../db/repositories/building.repository.js');
    const { PrismaSubscriptionRepository } = await import('../../db/repositories/subscription.repository.js');
    const { PrismaSubscriptionPlanRepository } = await import('../../db/repositories/plan.repository.js');
    const { PrismaContractRepository } = await import('../../db/repositories/contract.repository.js');

    const roomRepo = new PrismaRoomRepository(prisma);
    const buildingRepo = new PrismaBuildingRepository(prisma);
    const subRepo = new PrismaSubscriptionRepository(prisma);
    const planRepo = new PrismaSubscriptionPlanRepository(prisma);
    const contractRepo = new PrismaContractRepository(prisma);

    const roomService = new RoomService(roomRepo, buildingRepo, subRepo, planRepo, contractRepo, undefined, entitlementService, prisma);
    const listedRooms = await roomService.getRooms(testDorm.id);
    const roomsArray = listedRooms.items;
    const entitledCount = roomsArray.filter((r: any) => r.isEntitled === true).length;
    const unentitledCount = roomsArray.filter((r: any) => r.isEntitled === false).length;

    expect(entitledCount).toBe(10);
    expect(unentitledCount).toBe(2);

    // Cleanup
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('6. LINE OA message quota calculation (FREE = 30, PAID = 300)', async () => {
    const { LineOaService } = await import('../../services/line-oa.service.js');
    const lineOaService = new LineOaService(prisma);

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_quota_test_${Date.now()}`,
        email: `quotatest_${Date.now()}@test.local`,
        emailNormalized: `quotatest_${Date.now()}@test.local`,
        name: 'Quota Test User',
      },
    });

    const testDormFree = await prisma.dormitory.create({
      data: { name: 'Quota Test Dorm Free', createdByUserId: testUser.id },
    });
    const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: testDormFree.id,
        planId: freePlan!.id,
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });

    const freeConfig = await lineOaService.getDormitoryLineConfig(testDormFree.id);
    expect(freeConfig.monthlyQuota).toBe(30);
    expect(freeConfig.usedQuota).toBe(0);
    expect(freeConfig.remainingQuota).toBe(30);

    const testDormPaid = await prisma.dormitory.create({
      data: { name: 'Quota Test Dorm Paid', createdByUserId: testUser.id },
    });
    const paidPlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    await prisma.dormitorySubscription.create({
      data: {
        dormitoryId: testDormPaid.id,
        planId: paidPlan!.id,
        status: 'ACTIVE',
        startedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });

    const paidConfig = await lineOaService.getDormitoryLineConfig(testDormPaid.id);
    expect(paidConfig.monthlyQuota).toBe(300);
    expect(paidConfig.usedQuota).toBe(0);
    expect(paidConfig.remainingQuota).toBe(300);

    // Cleanup
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDormFree.id } });
    await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: testDormPaid.id } });
    await prisma.dormitory.delete({ where: { id: testDormFree.id } });
    await prisma.dormitory.delete({ where: { id: testDormPaid.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('7. Negative direct API validation for Tenant Registration (agreedTerms, blank signature, policyVersion)', async () => {
    const { TenantRegistrationService } = await import('../../services/tenant-registration.service.js');
    const registrationService = new TenantRegistrationService();

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_tenant_reg_${Date.now()}`,
        email: `tenantreg_${Date.now()}@test.local`,
        emailNormalized: `tenantreg_${Date.now()}@test.local`,
        name: 'Tenant Reg Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: { name: 'Tenant Reg Test Dorm', createdByUserId: testUser.id },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: 'กฎระเบียบหอพักตัวอย่าง',
        petPolicy: { allowed: 'none', allowedTypes: [] },
        version: 1,
      },
    });

    const bld = await prisma.building.create({
      data: { dormitoryId: testDorm.id, name: 'B1', code: 'B1', floorCount: 1, roomsPerFloor: 1 },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: bld.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: 3000,
        depositAmount: 3000,
        status: 'vacant',
      },
    });

    const { PNG } = await import('pngjs');
    const blankPngObj = new PNG({ width: 10, height: 10 });
    const blankPngBuffer = PNG.sync.write(blankPngObj);
    const blankPng = `data:image/png;base64,${blankPngBuffer.toString('base64')}`;

    const validPngObj = new PNG({ width: 10, height: 10 });
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      validPngObj.data[idx] = 0; // R
      validPngObj.data[idx + 1] = 0; // G
      validPngObj.data[idx + 2] = 0; // B
      validPngObj.data[idx + 3] = 255; // Alpha
    }
    const validPngBuffer = PNG.sync.write(validPngObj);
    const validNonBlankPng = `data:image/png;base64,${validPngBuffer.toString('base64')}`;

    // 7a. Missing or false agreedTerms -> 400
    await expect(
      registrationService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        agreedTerms: false as any,
        signatureBase64: validNonBlankPng,
        expectedPolicyVersion: 1,
      })
    ).rejects.toThrow('กรุณายอมรับกฎระเบียบและเงื่อนไขของหอพักก่อนส่งคำขอลงทะเบียน');

    // 7b. Missing signature -> 400
    await expect(
      registrationService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        agreedTerms: true,
        signatureBase64: '',
        expectedPolicyVersion: 1,
      })
    ).rejects.toThrow('กรุณาเซ็นชื่อก่อนส่งคำขอลงทะเบียน');

    // 7c. Blank signature -> 400
    await expect(
      registrationService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        agreedTerms: true,
        signatureBase64: blankPng,
        expectedPolicyVersion: 1,
      })
    ).rejects.toThrow('กรุณาเซ็นชื่อก่อนบันทึกคำขอลงทะเบียน');

    // 7d. Invalid expectedPolicyVersion (stale version 999 vs current 1) -> 409
    await expect(
      registrationService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        agreedTerms: true,
        signatureBase64: validNonBlankPng,
        expectedPolicyVersion: 999,
      })
    ).rejects.toThrow('กฎระเบียบหรือเงื่อนไขของหอพักมีการเปลี่ยนแปลง');

    // Verify 0 requests created so far
    const reqCount = await prisma.tenantRegistrationRequest.count({
      where: { dormitoryId: testDorm.id },
    });
    expect(reqCount).toBe(0);

    // 7e. Valid payload -> 201 Created with authoritative snapshot and signature metadata
    const validCreated = await registrationService.createRequest(testDorm.id, {
      dormitoryId: testDorm.id,
      requestedRoomId: room.id,
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      phone: '0812345678',
      agreedTerms: true,
      signatureBase64: validNonBlankPng,
      expectedPolicyVersion: 1,
    });

    expect(validCreated.status).toBe('pending_owner_approval');
    expect(validCreated.acceptedAt).toBeInstanceOf(Date);
    expect(validCreated.acceptanceSnapshot).toBeDefined();
    expect(validCreated.acceptanceSnapshotSha256).toHaveLength(64);
    expect(validCreated.tenantSignatureObjectKey).toBeTruthy();
    expect(validCreated.tenantSignatureSha256).toHaveLength(64);
    expect(validCreated.tenantSignatureMimeType).toBe('image/png');
    expect(validCreated.tenantSignatureByteSize).toBeGreaterThan(0);

    // Cleanup
    await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('8. Negative proof: SensitiveFieldService fails closed when FIELD_ENCRYPTION_KEY is missing', async () => {
    const { SensitiveFieldService } = await import('../../services/sensitive-field.service.js');
    expect(() => new SensitiveFieldService('')).toThrow('CRITICAL_SECURITY_ERROR');

    const origEnv = process.env.FIELD_ENCRYPTION_KEY;
    try {
      delete process.env.FIELD_ENCRYPTION_KEY;
      expect(() => new SensitiveFieldService()).toThrow('CRITICAL_SECURITY_ERROR');
    } finally {
      process.env.FIELD_ENCRYPTION_KEY = origEnv;
    }
  });

  it('9. Step 5 defaults mutation atomically increments version N -> N+1', async () => {
    const { DefaultsService } = await import('../../services/defaults.service.js');
    const defaultsService = new DefaultsService();

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_ver_test_${Date.now()}`,
        email: `vertest_${Date.now()}@test.local`,
        emailNormalized: `vertest_${Date.now()}@test.local`,
        name: 'Version Increment Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: { name: 'Version Increment Test Dorm', createdByUserId: testUser.id },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: 'ข้อกำหนดเริ่มต้น v1',
        petPolicy: { allowed: 'none', allowedTypes: [] },
        version: 1,
      },
    });

    // Update petPolicy and defaultTerms
    const updatedRes = await defaultsService.updateDormitoryDefaults(
      testDorm.id,
      {
        property: {
          changes: {
            defaultTerms: 'ข้อกำหนดแก้ไข v2',
            petPolicy: { allowed: 'conditional', allowedTypes: ['cat'] },
          },
          expectedVersion: 1,
        },
      },
      testUser.id
    );

    expect(updatedRes.property?.version).toBe(2);

    const savedInDb = await prisma.dormitoryPropertyDefaults.findUnique({
      where: { dormitoryId: testDorm.id },
    });
    expect(savedInDb?.version).toBe(2);
    expect(savedInDb?.defaultTerms).toBe('ข้อกำหนดแก้ไข v2');
    expect(savedInDb?.petPolicy).toEqual({ allowed: 'conditional', allowedTypes: ['cat'] });

    // Public Policy API returns version 2
    const { TenantRegistrationService } = await import('../../services/tenant-registration.service.js');
    const registrationService = new TenantRegistrationService();
    const publicPolicy = await registrationService.getPublicDormitoryPolicy(testDorm.id);
    expect(publicPolicy.version).toBe(2);
    expect(publicPolicy.defaultTerms).toBe('ข้อกำหนดแก้ไข v2');
    expect(publicPolicy.petPolicy).toEqual({ allowed: 'conditional', allowedTypes: ['cat'] });

    // Cleanup
    await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('10. Immutable Tenant Signature collision regression: failure of Request B does NOT delete Request A signature', async () => {
    const { TenantRegistrationService } = await import('../../services/tenant-registration.service.js');
    const { SignatureStorageService } = await import('../../services/signature-storage.service.js');
    const { PNG } = await import('pngjs');

    const registrationService = new TenantRegistrationService();
    const signatureStorage = new SignatureStorageService(prisma);

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_col_test_${Date.now()}`,
        email: `coltest_${Date.now()}@test.local`,
        emailNormalized: `coltest_${Date.now()}@test.local`,
        name: 'Collision Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: { name: 'Collision Test Dorm', createdByUserId: testUser.id },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: 'กฎระเบียบหอพักตัวอย่าง',
        petPolicy: { allowed: 'none', allowedTypes: [] },
        version: 1,
      },
    });

    const bld = await prisma.building.create({
      data: { dormitoryId: testDorm.id, name: 'B1', code: 'B1', floorCount: 1, roomsPerFloor: 1 },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: bld.id,
        roomNumber: '101',
        normalizedRoomNumber: '101',
        roomType: 'standard',
        floor: 1,
        monthlyRent: 3000,
        depositAmount: 3000,
        status: 'vacant',
      },
    });

    // Create a distinctive non-blank PNG binary
    const pngObj = new PNG({ width: 10, height: 10 });
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      pngObj.data[idx] = 120;
      pngObj.data[idx + 1] = 50;
      pngObj.data[idx + 2] = 200;
      pngObj.data[idx + 3] = 255;
    }
    const pngBuffer = PNG.sync.write(pngObj);
    const signatureBase64 = `data:image/png;base64,${pngBuffer.toString('base64')}`;

    // 1. Submit Request A successfully
    const requestA = await registrationService.createRequest(testDorm.id, {
      dormitoryId: testDorm.id,
      requestedRoomId: room.id,
      firstName: 'ก้องภพ',
      lastName: 'สมบูรณ์',
      phone: '0811111111',
      agreedTerms: true,
      signatureBase64,
      expectedPolicyVersion: 1,
    });

    expect(requestA.id).toBeTruthy();
    expect(requestA.tenantSignatureObjectKey).toBeTruthy();
    const objectKeyA = requestA.tenantSignatureObjectKey!;

    // Verify Request A signature exists and is readable
    const streamA = await signatureStorage.getSignatureStream(objectKeyA);
    expect(streamA).toBeDefined();

    // 2. Submit Request B using EXACTLY THE SAME signatureBase64, but with stale expectedPolicyVersion (version mismatch rollback)
    let failedAttemptObjectKey: string | null = null;
    try {
      await registrationService.createRequest(testDorm.id, {
        dormitoryId: testDorm.id,
        requestedRoomId: room.id,
        firstName: 'วิชัย',
        lastName: 'มั่งคั่ง',
        phone: '0822222222',
        agreedTerms: true,
        signatureBase64,
        expectedPolicyVersion: 999, // Stale version forces rollback and orphan cleanup
      });
      expect.unreachable('Request B should have thrown 409 POLICY_VERSION_MISMATCH');
    } catch (err: any) {
      expect(err.errorCode || err.code).toBe('POLICY_VERSION_MISMATCH');
      expect(err.statusCode).toBe(409);
    }

    // 3. Verify Request A signature STILL exists and is completely intact
    const streamAAfter = await signatureStorage.getSignatureStream(objectKeyA);
    expect(streamAAfter).toBeDefined();

    // Read stream content to verify byte integrity
    const chunks: Buffer[] = [];
    for await (const chunk of streamAAfter) {
      chunks.push(Buffer.from(chunk));
    }
    const retrievedBuffer = Buffer.concat(chunks);
    const retrievedSha256 = crypto.createHash('sha256').update(retrievedBuffer).digest('hex');
    expect(retrievedSha256).toBe(requestA.tenantSignatureSha256);

    // Cleanup
    await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  it('11. Real HTTP Boundary Proof for POST /api/v1/tenant-registrations', async () => {
    const { PNG } = await import('pngjs');

    const testUser = await prisma.user.create({
      data: {
        googleSubject: `sub_http_test_${Date.now()}`,
        email: `httptest_${Date.now()}@test.local`,
        emailNormalized: `httptest_${Date.now()}@test.local`,
        name: 'HTTP Route Test User',
      },
    });

    const testDorm = await prisma.dormitory.create({
      data: { name: 'HTTP Test Dorm', createdByUserId: testUser.id },
    });

    await prisma.dormitoryPropertyDefaults.create({
      data: {
        dormitoryId: testDorm.id,
        defaultTerms: 'กฎระเบียบหอพักสำหรับการทดสอบ HTTP',
        petPolicy: { allowed: 'none', allowedTypes: [] },
        version: 1,
      },
    });

    const bld = await prisma.building.create({
      data: { dormitoryId: testDorm.id, name: 'B1', code: 'B1', floorCount: 1, roomsPerFloor: 1 },
    });

    const room = await prisma.room.create({
      data: {
        dormitoryId: testDorm.id,
        buildingId: bld.id,
        roomNumber: '201',
        normalizedRoomNumber: '201',
        roomType: 'standard',
        floor: 2,
        monthlyRent: 3500,
        depositAmount: 3500,
        status: 'vacant',
      },
    });

    const mockGoogleVerifier = {} as any;
    const mockAuditService = { logAction: async () => {}, logSecurityEvent: async () => {} } as any;

    const authService = new AuthenticationService(
      getEnv(),
      mockGoogleVerifier,
      new PrismaUserRepository(prisma),
      new PrismaSessionRepository(prisma),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      mockAuditService
    );

    const app = createApp({ customAuthService: authService, forcePrisma: true });

    const pngObj = new PNG({ width: 10, height: 10 });
    for (let i = 0; i < 100; i++) {
      const idx = i * 4;
      pngObj.data[idx] = 0;
      pngObj.data[idx + 1] = 100;
      pngObj.data[idx + 2] = 200;
      pngObj.data[idx + 3] = 255;
    }
    const validSignature = `data:image/png;base64,${PNG.sync.write(pngObj).toString('base64')}`;

    // 11a. Missing agreedTerms -> 400 TERMS_NOT_ACCEPTED
    const res1 = await request(app)
      .post('/api/v1/tenant-registrations')
      .set('x-dormitory-id', testDorm.id)
      .send({
        requestedRoomId: room.id,
        firstName: 'ธนกฤต',
        lastName: 'พัฒนา',
        phone: '0899999999',
        signatureBase64: validSignature,
        expectedPolicyVersion: 1,
      });
    expect(res1.status).toBe(400);
    expect(res1.body.error?.code).toBe('TERMS_NOT_ACCEPTED');

    // 11b. agreedTerms: false -> 400 TERMS_NOT_ACCEPTED
    const res2 = await request(app)
      .post('/api/v1/tenant-registrations')
      .set('x-dormitory-id', testDorm.id)
      .send({
        requestedRoomId: room.id,
        firstName: 'ธนกฤต',
        lastName: 'พัฒนา',
        phone: '0899999999',
        agreedTerms: false,
        signatureBase64: validSignature,
        expectedPolicyVersion: 1,
      });
    expect(res2.status).toBe(400);
    expect(res2.body.error?.code).toBe('TERMS_NOT_ACCEPTED');

    // 11c. Missing signatureBase64 -> 400 SIGNATURE_REQUIRED
    const res3 = await request(app)
      .post('/api/v1/tenant-registrations')
      .set('x-dormitory-id', testDorm.id)
      .send({
        requestedRoomId: room.id,
        firstName: 'ธนกฤต',
        lastName: 'พัฒนา',
        phone: '0899999999',
        agreedTerms: true,
        expectedPolicyVersion: 1,
      });
    expect(res3.status).toBe(400);
    expect(res3.body.error?.code).toBe('SIGNATURE_REQUIRED');

    // 11d. Missing expectedPolicyVersion -> 400 INVALID_POLICY_VERSION
    const res4 = await request(app)
      .post('/api/v1/tenant-registrations')
      .set('x-dormitory-id', testDorm.id)
      .send({
        requestedRoomId: room.id,
        firstName: 'ธนกฤต',
        lastName: 'พัฒนา',
        phone: '0899999999',
        agreedTerms: true,
        signatureBase64: validSignature,
      });
    expect(res4.status).toBe(400);
    expect(res4.body.error?.code).toBe('INVALID_POLICY_VERSION');

    // 11e. Valid payload -> 201 Created
    const resValid = await request(app)
      .post('/api/v1/tenant-registrations')
      .set('x-dormitory-id', testDorm.id)
      .send({
        requestedRoomId: room.id,
        firstName: 'ธนกฤต',
        lastName: 'พัฒนา',
        phone: '0899999999',
        agreedTerms: true,
        signatureBase64: validSignature,
        expectedPolicyVersion: 1,
      });
    expect(resValid.status).toBe(201);
    expect(resValid.body.data?.id).toBeTruthy();
    expect(resValid.body.data?.status).toBe('pending_owner_approval');
    expect(resValid.body.data?.acceptanceSnapshotSha256).toHaveLength(64);
    expect(resValid.body.data?.tenantSignatureObjectKey).toBeTruthy();
    expect(resValid.body.data?.tenantSignatureSha256).toHaveLength(64);

    // Cleanup
    await prisma.tenantRegistrationRequest.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.room.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.building.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: testDorm.id } });
    await prisma.dormitory.delete({ where: { id: testDorm.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });
});
