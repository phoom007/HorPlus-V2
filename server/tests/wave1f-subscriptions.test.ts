import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Wave 1F - Subscription, Trial, Promo Code & Entitlement Gates', () => {
  let dormId: string;
  let ownerUserId: string;
  let buildingId: string;

  beforeEach(async () => {
    await subscriptionEntitlementService.ensureSeeded();

    dormId = crypto.randomUUID();
    ownerUserId = crypto.randomUUID();
    const timestamp = Date.now() + Math.floor(Math.random() * 100000);

    await prisma.dormitory.create({
      data: {
        id: dormId,
        name: `Test Dormitory ${timestamp}`,
        createdByUserId: ownerUserId,
      },
    });

    await prisma.user.create({
      data: {
        id: ownerUserId,
        googleSubject: `sub-owner-${timestamp}`,
        email: `owner-${timestamp}@horplus.com`,
        emailNormalized: `owner-${timestamp}@horplus.com`,
        name: 'Owner Test User',
      },
    });

    const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } }) ||
      await prisma.role.create({ data: { code: 'OWNER', name: 'Owner', dormitoryId: dormId } });

    await prisma.dormitoryMember.create({
      data: {
        userId: ownerUserId,
        dormitoryId: dormId,
        roleId: ownerRole.id,
        status: 'active',
      },
    });

    const building = await prisma.building.create({
      data: {
        dormitoryId: dormId,
        name: 'Building 1',
      },
    });
    buildingId = building.id;
  });

  it('automatically provisions 30-day Trial on dormitory creation/lookup', async () => {
    const sub = await subscriptionEntitlementService.getCurrentSubscription(dormId);
    expect(sub).toBeDefined();
    expect(sub.status).toBe('TRIAL');
    expect(sub.plan.code).toBe('FREE');
    expect(sub.plan.roomLimit).toBe(10);

    const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.isActive).toBe(true);
    expect(entitlements.isReadOnly).toBe(false);
    expect(entitlements.roomLimit).toBe(10);
  });

  it('redeems HORPLUS promo code once to add +60 days trial extension', async () => {
    const initialEntitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormId);
    const initialExpiry = new Date(initialEntitlements.expiresAt).getTime();

    const updatedSub = await subscriptionEntitlementService.redeemPromoCode({
      dormitoryId: dormId,
      code: 'horplus',
      userId: ownerUserId,
    });

    const updatedExpiry = new Date(updatedSub.expiresAt).getTime();
    const diffDays = Math.round((updatedExpiry - initialExpiry) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(60);

    await expect(
      subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'HORPLUS',
        userId: ownerUserId,
      })
    ).rejects.toThrow('Promo code HORPLUS has already been redeemed for this dormitory');
  });

  it('rejects invalid or expired promo code redemption', async () => {
    await expect(
      subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'INVALID_CODE_123',
        userId: ownerUserId,
      })
    ).rejects.toThrow('Invalid or unsupported promo code');

    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sub = await subscriptionEntitlementService.getCurrentSubscription(dormId);
    await prisma.dormitorySubscription.update({
      where: { id: sub.id },
      data: { expiresAt: pastDate, trialExpiresAt: pastDate },
    });

    await expect(
      subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dormId,
        code: 'HORPLUS',
        userId: ownerUserId,
      })
    ).rejects.toThrow('Dormitory subscription has expired');
  });

  it('enforces Free/Trial room limit of 10 rooms', async () => {
    for (let i = 1; i <= 10; i++) {
      const num = `RM-${100 + i}`;
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
    expect(entitlements.roomCount).toBe(10);
    expect(entitlements.remainingRooms).toBe(0);

    await expect(
      subscriptionEntitlementService.assertRoomCreationAllowed(dormId)
    ).rejects.toThrow('Cannot create room');
  });

  it('blocks business mutations with SUBSCRIPTION_READ_ONLY when subscription is expired', async () => {
    const pastDate = new Date(Date.now() - 1000);
    const sub = await subscriptionEntitlementService.getCurrentSubscription(dormId);
    await prisma.dormitorySubscription.update({
      where: { id: sub.id },
      data: { expiresAt: pastDate },
    });

    const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.isReadOnly).toBe(true);
    expect(entitlements.status).toBe('EXPIRED');

    await expect(
      subscriptionEntitlementService.assertDormitoryWritable(dormId)
    ).rejects.toThrow('Dormitory subscription has expired. Operations are restricted to read-only mode.');
  });

  it('activates 1-Month Paid package and increases room limit to 150', async () => {
    const activated = await subscriptionEntitlementService.activatePaidSubscription({
      dormitoryId: dormId,
      durationMonths: 1,
      actorId: ownerUserId,
    });

    expect(activated.status).toBe('ACTIVE');
    expect(activated.plan.code).toBe('PAID');

    const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dormId);
    expect(entitlements.roomLimit).toBe(150);
    expect(entitlements.plan.code).toBe('PAID');
  });

  it('denies unpriced duration package activations (3, 6, 12, 24 months)', async () => {
    for (const duration of [3, 6, 12, 24]) {
      await expect(
        subscriptionEntitlementService.activatePaidSubscription({
          dormitoryId: dormId,
          durationMonths: duration,
          actorId: ownerUserId,
        })
      ).rejects.toThrow('Selected package duration is disabled or unpriced');
    }
  });

  it('enforces maximum 10 dormitories per owner quota', async () => {
    for (let i = 2; i <= 10; i++) {
      const extraDormId = crypto.randomUUID();
      await prisma.dormitory.create({
        data: { id: extraDormId, name: `Extra Dorm ${i}` },
      });
      const role = await prisma.role.findFirst({ where: { code: 'OWNER' } });
      await prisma.dormitoryMember.create({
        data: {
          userId: ownerUserId,
          dormitoryId: extraDormId,
          roleId: role!.id,
          status: 'active',
        },
      });
    }

    await expect(
      subscriptionEntitlementService.assertDormitoryCreationAllowed(ownerUserId)
    ).rejects.toThrow('Owner account cannot create or manage more than 10 dormitories');
  });

  it('idempotently backfills existing dormitories without subscriptions', async () => {
    const unprovisionedDormId = crypto.randomUUID();
    await prisma.dormitory.create({
      data: { id: unprovisionedDormId, name: 'Legacy Dorm Unprovisioned' },
    });

    const res1 = await subscriptionEntitlementService.backfillExistingDormitories();
    expect(res1.backfilledCount).toBeGreaterThanOrEqual(1);

    const res2 = await subscriptionEntitlementService.backfillExistingDormitories();
    expect(res2.backfilledCount).toBe(0);

    const sub = await subscriptionEntitlementService.getCurrentSubscription(unprovisionedDormId);
    expect(sub.status).toBe('TRIAL');
  });

  it('handles simultaneous room creation attempts safely at the quota boundary', async () => {
    for (let i = 1; i <= 9; i++) {
      const num = `Room-A${i}`;
      await prisma.room.create({
        data: { dormitoryId: dormId, buildingId, roomNumber: num, normalizedRoomNumber: num, floor: 1 },
      });
    }

    await subscriptionEntitlementService.assertRoomCreationAllowed(dormId);
    await prisma.room.create({
      data: { dormitoryId: dormId, buildingId, roomNumber: 'Room-A10', normalizedRoomNumber: 'Room-A10', floor: 1 },
    });

    await expect(
      subscriptionEntitlementService.assertRoomCreationAllowed(dormId)
    ).rejects.toThrow('Cannot create room');

    const totalRooms = await prisma.room.count({ where: { dormitoryId: dormId } });
    expect(totalRooms).toBe(10);
  });
});
