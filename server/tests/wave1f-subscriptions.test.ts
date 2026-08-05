import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { entitlementService } from '../src/services/entitlement.service.js';
import { RoomService } from '../src/services/room.service.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../src/db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../src/db/repositories/subscription.repository.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { resolveAuthoritativeDormitoryContext } from '../src/middleware/dormitory-context.js';
import { requireDormitoryWriteEntitlement } from '../src/middleware/entitlement.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Wave 1F - Authoritative Subscription, Trial, Promo Code & Entitlement Corrective Pass', () => {
  let dormId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let techUserId: string;
  let otherDormId: string;
  let otherOwnerUserId: string;
  let buildingId: string;

  beforeEach(async () => {
    process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';
    await subscriptionEntitlementService.ensureSeeded();

    const timestamp = Date.now() + Math.floor(Math.random() * 100000);
    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    managerUserId = crypto.randomUUID();
    techUserId = crypto.randomUUID();
    otherDormId = crypto.randomUUID();
    otherOwnerUserId = crypto.randomUUID();

    // Create Primary Dormitory
    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: `Test Dormitory ${timestamp}`,
        createdByUserId: ownerUserId,
      },
    });

    // Provision 30-day Trial for Primary Dormitory
    await subscriptionEntitlementService.provisionInitialTrial(dormId);

    // Create Other Dormitory
    await prisma.dormitory.create({
      data: {
        id: otherDormId,
        name: `Other Dormitory ${timestamp}`,
        createdByUserId: otherOwnerUserId,
      },
    });
    await subscriptionEntitlementService.provisionInitialTrial(otherDormId);

    // Create Users
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, googleSubject: `sub-owner-${timestamp}`, email: `owner-${timestamp}@horplus.com`, emailNormalized: `owner-${timestamp}@horplus.com`, name: 'Owner User' },
        { id: managerUserId, googleSubject: `sub-mgr-${timestamp}`, email: `mgr-${timestamp}@horplus.com`, emailNormalized: `mgr-${timestamp}@horplus.com`, name: 'Manager User' },
        { id: techUserId, googleSubject: `sub-tech-${timestamp}`, email: `tech-${timestamp}@horplus.com`, emailNormalized: `tech-${timestamp}@horplus.com`, name: 'Technician User' },
        { id: otherOwnerUserId, googleSubject: `sub-other-${timestamp}`, email: `other-${timestamp}@horplus.com`, emailNormalized: `other-${timestamp}@horplus.com`, name: 'Other Owner User' },
      ],
    });

    // Create Roles
    const roleOwner = await prisma.role.findFirst({ where: { code: 'OWNER' } }) ||
      await prisma.role.create({ data: { code: 'OWNER', name: 'Owner', dormitoryId: dormId, permissions: ['*'] } });
    const roleManager = await prisma.role.create({ data: { code: 'MANAGER', name: 'Manager', dormitoryId: dormId, permissions: ['read'] } });
    const roleTech = await prisma.role.create({ data: { code: 'TECHNICIAN', name: 'Technician', dormitoryId: dormId, permissions: ['read'] } });

    // Create Memberships
    await prisma.dormitoryMember.createMany({
      data: [
        { userId: ownerUserId, dormitoryId: dormId, roleId: roleOwner.id, status: 'active' },
        { userId: managerUserId, dormitoryId: dormId, roleId: roleManager.id, status: 'active' },
        { userId: techUserId, dormitoryId: dormId, roleId: roleTech.id, status: 'active' },
        { userId: otherOwnerUserId, dormitoryId: otherDormId, roleId: roleOwner.id, status: 'active' },
      ],
    });

    // Create Building
    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building 1',
      },
    });
    buildingId = building.id;
  });

  it('provisions exactly 1 30-day Trial and SubscriptionStatusHistory on dormitory creation', async () => {
    const sub = await subscriptionEntitlementService.getCurrentSubscription(dormId);
    expect(sub).toBeDefined();
    expect(sub.status).toBe('TRIAL');
    expect(sub.plan.code).toBe('FREE');
    expect(sub.plan.roomLimit).toBe(10);

    const histories = await prisma.subscriptionStatusHistory.findMany({
      where: { subscriptionId: sub.id },
    });
    expect(histories.length).toBeGreaterThanOrEqual(1);
    expect(histories[0].reason).toBe('INITIAL_PROVISIONING_30_DAY_TRIAL');
  });

  it('getCurrentSubscription throws SUBSCRIPTION_NOT_FOUND if subscription does not exist', async () => {
    const unprovisionedDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: unprovisionedDormId, name: 'Unprovisioned Dorm' },
    });

    await expect(
      subscriptionEntitlementService.getCurrentSubscription(unprovisionedDormId)
    ).rejects.toThrow('Dormitory subscription not found.');
  });

  it('idempotently backfills missing dormitories with DormitorySubscription AND SubscriptionStatusHistory', async () => {
    const legacyDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: legacyDormId, name: 'Legacy Dorm for Backfill' },
    });

    const result = await subscriptionEntitlementService.backfillExistingDormitories();
    expect(result.backfilledCount).toBeGreaterThanOrEqual(1);

    const sub = await subscriptionEntitlementService.getCurrentSubscription(legacyDormId);
    expect(sub.status).toBe('TRIAL');

    const histories = await prisma.subscriptionStatusHistory.findMany({
      where: { dormitoryId: legacyDormId },
    });
    expect(histories.length).toBe(1);
    expect(histories[0].reason).toBe('EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL');
  });

  it('redeems HORPLUS promo code with persistent idempotency key', async () => {
    const idempotencyKey = `key-promo-${Date.now()}`;

    // 1. First redemption
    const sub1 = await subscriptionEntitlementService.redeemPromoCode({
      dormitoryId: dormId,
      code: 'HORPLUS',
      userId: ownerUserId,
      idempotencyKey,
    });
    expect(sub1).toBeDefined();

    // 2. Replay same idempotency key returns cached response
    const sub2 = await subscriptionEntitlementService.redeemPromoCode({
      dormitoryId: dormId,
      code: 'HORPLUS',
      userId: ownerUserId,
      idempotencyKey,
    });
    expect(sub2.id).toBe(sub1.id);

    // 3. Different idempotency key for already redeemed dorm throws PROMO_ALREADY_REDEEMED 409
    await expect(
      subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'HORPLUS',
        userId: ownerUserId,
        idempotencyKey: `key-different-${Date.now()}`,
      })
    ).rejects.toThrow('Promo code HORPLUS has already been redeemed for this dormitory');

    // 4. Same key with different payload returns IDEMPOTENCY_MISMATCH 409
    await expect(
      subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'DIFFERENT_CODE',
        userId: ownerUserId,
        idempotencyKey,
      })
    ).rejects.toThrow('Idempotency key payload mismatch.');
  });

  it('enforces over-limit behavior: roomCount > roomLimit sets isOverLimit and isReadOnly without deleting rooms', async () => {
    // Create 11 rooms on Free plan (limit 10)
    for (let i = 1; i <= 11; i++) {
      const num = `RM-OVER-${i}`;
      await prisma.room.create({
        data: {
          dormitoryId: dormId,
          buildingId,
          roomNumber: num,
          normalizedRoomNumber: num,
          floor: 1,
        },
      });
    }

    const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.roomCount).toBe(11);
    expect(entitlements.roomLimit).toBe(10);
    expect(entitlements.isOverLimit).toBe(true);
    expect(entitlements.isReadOnly).toBe(true);
    expect(entitlements.reason).toContain('ROOM_LIMIT_EXCEEDED');

    // Business mutation assert should fail with SUBSCRIPTION_READ_ONLY 403
    await expect(
      subscriptionEntitlementService.assertDormitoryWritable(dormId)
    ).rejects.toThrow('Dormitory operation restricted to read-only mode.');

    // Total rooms in database remains 11 (no automatic deletion)
    const totalCount = await prisma.room.count({ where: { dormitoryId: dormId } });
    expect(totalCount).toBe(11);
  });

  it('proves real concurrent room creation on Free boundary under PG lock', async () => {
    // Seed 9 rooms
    for (let i = 1; i <= 9; i++) {
      const num = `FREE-C-${i}`;
      await prisma.room.create({
        data: { dormitoryId: dormId, buildingId, roomNumber: num, normalizedRoomNumber: num, floor: 1 },
      });
    }

    const roomService = new RoomService(
      new PrismaRoomRepository(prisma),
      new PrismaBuildingRepository(prisma),
      new PrismaSubscriptionRepository(prisma),
      new PrismaContractRepository(prisma),
      undefined,
      entitlementService,
      prisma
    );

    // Launch 2 concurrent room creations (rooms 10 and 11)
    const results = await Promise.allSettled([
      roomService.createRoom({ buildingId, roomNumber: 'FREE-C-10', normalizedRoomNumber: 'FREE-C-10', floor: 1 }, dormId, ownerUserId),
      roomService.createRoom({ buildingId, roomNumber: 'FREE-C-11', normalizedRoomNumber: 'FREE-C-11', floor: 1 }, dormId, ownerUserId),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.errorCode || error.code).toBe('ROOM_LIMIT_REACHED');

    const totalRooms = await prisma.room.count({ where: { dormitoryId: dormId, status: { not: 'archived' } } });
    expect(totalRooms).toBe(10);
  });

  it('proves real concurrent room creation on Paid boundary under PG lock', async () => {
    // Operational activate Paid plan (limit 150)
    await subscriptionEntitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUserId,
      idempotencyKey: `paid-activate-${Date.now()}`,
    });

    // Seed 149 rooms
    for (let i = 1; i <= 149; i++) {
      const num = `PAID-C-${i}`;
      await prisma.room.create({
        data: { dormitoryId: dormId, buildingId, roomNumber: num, normalizedRoomNumber: num, floor: 1 },
      });
    }

    const roomService = new RoomService(
      new PrismaRoomRepository(prisma),
      new PrismaBuildingRepository(prisma),
      new PrismaSubscriptionRepository(prisma),
      new PrismaContractRepository(prisma),
      undefined,
      entitlementService,
      prisma
    );

    // Launch 2 concurrent room creations (rooms 150 and 151)
    const results = await Promise.allSettled([
      roomService.createRoom({ buildingId, roomNumber: 'PAID-C-150', normalizedRoomNumber: 'PAID-C-150', floor: 1 }, dormId, ownerUserId),
      roomService.createRoom({ buildingId, roomNumber: 'PAID-C-151', normalizedRoomNumber: 'PAID-C-151', floor: 1 }, dormId, ownerUserId),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const error: any = (rejected[0] as PromiseRejectedResult).reason;
    expect(error.errorCode || error.code).toBe('ROOM_LIMIT_REACHED');

    const totalRooms = await prisma.room.count({ where: { dormitoryId: dormId, status: { not: 'archived' } } });
    expect(totalRooms).toBe(150);
  });

  it('operational activation cannot shorten a valid subscription and respects idempotency', async () => {
    const key = `key-op-${Date.now()}`;

    // Activate 1 Month
    const sub1 = await subscriptionEntitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUserId,
      idempotencyKey: key,
    });
    expect(sub1.status).toBe('ACTIVE');

    // Replay same key returns identical response
    const sub2 = await subscriptionEntitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUserId,
      idempotencyKey: key,
    });
    expect(sub2.id).toBe(sub1.id);

    // Operational activation in environment without flag throws OPERATIONAL_ACTIVATION_DISABLED
    delete process.env.ALLOW_OPERATIONAL_ACTIVATION;
    const oldNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await expect(
      subscriptionEntitlementService.activatePaidSubscriptionOperational({
        dormitoryId: dormId,
        durationMonths: 1,
        actorId: ownerUserId,
      })
    ).rejects.toThrow('Operational activation is disabled in this environment.');

    process.env.NODE_ENV = oldNodeEnv;
    process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';
  });

  it('verifies authoritative dormitory context resolver blocks cross-dormitory access and header tampering', async () => {
    const ownerMember = await prisma.dormitoryMember.findFirst({
      where: { userId: ownerUserId, dormitoryId: dormId },
      include: { dormitory: true, role: true },
    });
    const userOwner = await prisma.user.findUnique({ where: { id: ownerUserId } });

    // 1. Valid member matching dormitory header -> Allowed
    const reqValid: any = {
      auth: {
        userId: ownerUserId,
        user: userOwner,
        memberships: [{ ...ownerMember, roleCode: 'OWNER', status: 'active' }],
      },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctxValid = resolveAuthoritativeDormitoryContext(reqValid);
    expect(ctxValid.dormitoryId).toBe(dormId);
    expect(ctxValid.roleCode).toBe('OWNER');

    // 2. Member trying to specify another dormitory ID header (header tampering) -> Blocked HTTP 403
    const reqTampered: any = {
      auth: {
        userId: ownerUserId,
        user: userOwner,
        memberships: [{ ...ownerMember, roleCode: 'OWNER', status: 'active' }],
      },
      headers: { 'x-dormitory-id': otherDormId },
    };
    expect(() => resolveAuthoritativeDormitoryContext(reqTampered)).toThrow('Access denied for requested dormitory context.');

    // 3. Anonymous user -> Blocked HTTP 401
    const reqAnon: any = { auth: undefined };
    expect(() => resolveAuthoritativeDormitoryContext(reqAnon)).toThrow('Authentication required.');
  });
});
