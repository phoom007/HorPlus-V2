import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { RoomService } from '../src/services/room.service.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaBuildingRepository } from '../src/db/repositories/building.repository.js';
import { PrismaSubscriptionRepository } from '../src/db/repositories/subscription.repository.js';
import { PrismaContractRepository } from '../src/db/repositories/contract.repository.js';
import { resolveAuthoritativeDormitoryContext } from '../src/middleware/dormitory-context.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Wave 1F - Authoritative Subscription, Trial, Promo Code & Entitlement Corrective Pass', () => {
  let dormId: string;
  let otherDormId: string;
  let ownerUserId: string;
  let managerUserId: string;
  let buildingId: string;
  let entitlementService: typeof subscriptionEntitlementService;

  beforeAll(async () => {
    process.env.ALLOW_OPERATIONAL_ACTIVATION = 'true';
    entitlementService = subscriptionEntitlementService;
    await entitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    dormId = crypto.randomUUID();
    otherDormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    managerUserId = crypto.randomUUID();

    const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      await entitlementService.ensureSeeded();
    }

    await prisma.user.createMany({
      data: [
        {
          id: ownerUserId,
          googleSubject: `sub-owner-${timestamp}`,
          email: `owner-${timestamp}@test.com`,
          emailNormalized: `owner-${timestamp}@test.com`,
          name: 'Owner User',
        },
        {
          id: managerUserId,
          googleSubject: `sub-mgr-${timestamp}`,
          email: `mgr-${timestamp}@test.com`,
          emailNormalized: `mgr-${timestamp}@test.com`,
          name: 'Manager User',
        },
      ],
    });

    await prisma.dormitory.createMany({
      data: [
        {
          id: dormId,
          name: `Dormitory Test ${timestamp}`,
          code: `DORM-${timestamp}`,
          addressLine1: '123 Test St',
          postalCode: '10100',
          phone: '0812345678',
          status: 'active',
          createdByUserId: ownerUserId,
        },
        {
          id: otherDormId,
          name: `Other Dormitory ${timestamp}`,
          code: `OTHER-${timestamp}`,
          addressLine1: '456 Other St',
          postalCode: '10200',
          phone: '0887654321',
          status: 'active',
          createdByUserId: ownerUserId,
        },
      ],
    });

    const ownerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        name: 'Owner',
        code: 'OWNER',
        permissions: ['*'],
      },
    });

    const managerRole = await prisma.role.create({
      data: {
        dormitoryId: dormId,
        name: 'Manager',
        code: 'MANAGER',
        permissions: ['subscription:read'],
      },
    });

    await prisma.dormitoryMember.createMany({
      data: [
        {
          userId: ownerUserId,
          dormitoryId: dormId,
          roleId: ownerRole.id,
          status: 'active',
        },
        {
          userId: managerUserId,
          dormitoryId: dormId,
          roleId: managerRole.id,
          status: 'active',
        },
      ],
    });

    await entitlementService.provisionInitialTrial(dormId);
    await entitlementService.provisionInitialTrial(otherDormId);

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building 1',
      },
    });
    buildingId = building.id;
  });

  it('provisions 1 30-day Trial in DormitorySubscription and status history atomically without duplicate writes', async () => {
    const freshDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: {
        id: freshDormId,
        name: 'Fresh Provisioned Dorm',
        code: `FRESH-${Date.now()}`,
        addressLine1: '789 Fresh Rd',
        postalCode: '10300',
        phone: '0899999999',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });

    const sub = await entitlementService.provisionInitialTrial(freshDormId);
    expect(sub.status).toBe('TRIAL');
    expect(sub.dormitoryId).toBe(freshDormId);

    const history = await prisma.subscriptionStatusHistory.findMany({
      where: { dormitoryId: freshDormId },
    });
    expect(history.length).toBe(1);
    expect(history[0].reason).toBe('INITIAL_PROVISIONING_30_DAY_TRIAL');

    // PlatformSubscription (legacy table) must have 0 newly created rows for freshDormId
    const legacySubs = await prisma.platformSubscription.findMany({
      where: { dormitoryId: freshDormId },
    });
    expect(legacySubs.length).toBe(0);
  });

  it('backfills missing subscriptions for existing dormitories idempotently', async () => {
    const unbackedDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: {
        id: unbackedDormId,
        name: 'Unbacked Dorm',
        code: `UNBACKED-${Date.now()}`,
        addressLine1: '999 Unbacked St',
        postalCode: '10400',
        phone: '0855555555',
        status: 'active',
        createdByUserId: ownerUserId,
      },
    });

    const count = await entitlementService.backfillExistingDormitories();
    expect(count).toBeGreaterThanOrEqual(1);

    const sub = await entitlementService.getCurrentSubscription(unbackedDormId);
    expect(sub.status).toBe('TRIAL');

    const history = await prisma.subscriptionStatusHistory.findMany({
      where: { dormitoryId: unbackedDormId },
    });
    expect(history.length).toBe(1);
    expect(history[0].reason).toBe('EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL');
  });

  it('redeems promo code HORPLUS with persistent idempotency and rejects Manager without promo permissions', async () => {
    const idempotencyKey = `key-promo-${Date.now()}`;

    // Manager without promo:redeem or subscription:write permission is blocked by route/role check
    const managerMember = await prisma.dormitoryMember.findFirst({
      where: { userId: managerUserId, dormitoryId: dormId },
      include: { role: true },
    });
    const reqMgr: any = {
      auth: {
        userId: managerUserId,
        user: { id: managerUserId },
        memberships: [{ ...managerMember, roleCode: 'MANAGER', status: 'active' }],
      },
      headers: { 'x-dormitory-id': dormId },
    };
    const ctxMgr = resolveAuthoritativeDormitoryContext(reqMgr);
    const hasPromoPerm = (ctxMgr.permissions || []).some((p) =>
      ['*', 'subscription:write', 'subscription:*', 'promo:redeem'].includes(p)
    );
    expect(hasPromoPerm).toBe(false);

    // Owner redeems HORPLUS code successfully (+60 days extension)
    const initialSub = await entitlementService.getCurrentSubscription(dormId);
    const initialExpiry = initialSub.expiresAt.getTime();

    const sub1 = await entitlementService.redeemPromoCode({
      dormitoryId: dormId,
      code: 'HORPLUS',
      userId: ownerUserId,
      idempotencyKey,
    });

    const extendedExpiry = sub1.expiresAt.getTime();
    expect(extendedExpiry - initialExpiry).toBeGreaterThanOrEqual(59 * 24 * 60 * 60 * 1000);

    // Replay with identical key + payload returns cached response without duplicate extension
    const sub2 = await entitlementService.redeemPromoCode({
      dormitoryId: dormId,
      code: 'HORPLUS',
      userId: ownerUserId,
      idempotencyKey,
    });
    expect(sub2.expiresAt.getTime()).toBe(extendedExpiry);

    // Attempt second redemption with a different key throws PROMO_ALREADY_REDEEMED 409
    await expect(
      entitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'HORPLUS',
        userId: ownerUserId,
        idempotencyKey: `key-different-${Date.now()}`,
      })
    ).rejects.toThrow('Promo code HORPLUS has already been redeemed for this dormitory');
  });

  it('enforces over-limit read-only behavior across multiple domain mutation guards', async () => {
    // Seed 11 rooms on Free plan (limit 10)
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

    const entitlements = await entitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.roomCount).toBe(11);
    expect(entitlements.roomLimit).toBe(10);
    expect(entitlements.isOverLimit).toBe(true);
    expect(entitlements.isReadOnly).toBe(true);
    expect(entitlements.reason).toContain('ROOM_LIMIT_EXCEEDED');

    // All business domain mutation assertions must throw SUBSCRIPTION_READ_ONLY (403)
    await expect(entitlementService.assertDormitoryWritable(dormId)).rejects.toThrow('Dormitory operation restricted to read-only mode.');
    await expect(entitlementService.assertRoomCreationAllowed(dormId)).rejects.toThrow('Dormitory operation restricted to read-only mode.');

    // GET / Read Operations remain 100% functional
    const rooms = await prisma.room.findMany({ where: { dormitoryId: dormId } });
    expect(rooms.length).toBe(11);
  });

  it('proves real concurrent room creation on Free boundary under PG transaction lock', async () => {
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

    const results = await Promise.allSettled([
      roomService.createRoom(dormId, { buildingId, roomNumber: 'FREE-C-10', normalizedRoomNumber: 'FREE-C-10', floor: 1 }, ownerUserId),
      roomService.createRoom(dormId, { buildingId, roomNumber: 'FREE-C-11', normalizedRoomNumber: 'FREE-C-11', floor: 1 }, ownerUserId),
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

  it('proves real concurrent room creation on Paid boundary under PG transaction lock', async () => {
    await entitlementService.activatePaidSubscriptionOperational({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUserId,
      idempotencyKey: `paid-activate-${Date.now()}`,
    });

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

    const results = await Promise.allSettled([
      roomService.createRoom(dormId, { buildingId, roomNumber: 'PAID-C-150', normalizedRoomNumber: 'PAID-C-150', floor: 1 }, ownerUserId),
      roomService.createRoom(dormId, { buildingId, roomNumber: 'PAID-C-151', normalizedRoomNumber: 'PAID-C-151', floor: 1 }, ownerUserId),
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

  it('fails closed when dormitory membership role is invalid or missing', async () => {
    const invalidMemberReq: any = {
      auth: {
        userId: ownerUserId,
        user: { id: ownerUserId },
        memberships: [
          {
            id: 'mem-invalid',
            dormitoryId: dormId,
            status: 'active',
            role: null,
            roleCode: null,
          },
        ],
      },
      headers: { 'x-dormitory-id': dormId },
    };

    expect(() => resolveAuthoritativeDormitoryContext(invalidMemberReq)).toThrow('Dormitory membership role is invalid or unassigned.');
  });
});
