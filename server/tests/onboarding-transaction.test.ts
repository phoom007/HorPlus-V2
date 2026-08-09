import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DormitoryProvisioningService } from '../src/services/dormitory-provisioning.service.js';
import { PrismaDormitoryRepository } from '../src/db/repositories/dormitory.repository.js';
import { PrismaSubscriptionRepository } from '../src/db/repositories/subscription.repository.js';
import { PrismaMembershipRepository } from '../src/db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../src/db/repositories/role.repository.js';
import { PrismaBuildingRepository } from '../src/db/repositories/building.repository.js';
import { PrismaRoomRepository } from '../src/db/repositories/room.repository.js';
import { PrismaSubscriptionPlanRepository } from '../src/db/repositories/plan.repository.js';
import { InMemoryBillingSettingsRepository } from '../src/db/repositories/billing-settings.repository.js';
import { InMemoryPromoRepository } from '../src/db/repositories/promo.repository.js';
import { InMemoryOnboardingDraftRepository } from '../src/db/repositories/onboarding-draft.repository.js';
import { InMemoryIdempotencyRepository } from '../src/db/repositories/idempotency.repository.js';
import { SensitiveFieldService } from '../src/services/sensitive-field.service.js';
import { PromoService } from '../src/services/promo.service.js';
import { AuditService } from '../src/services/audit.service.js';
import { subscriptionEntitlementService } from '../src/services/subscription-entitlement.service.js';
import { SignatureStorageService } from '../src/services/signature-storage.service.js';
import { PNG } from 'pngjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Wave 1F - Owner Onboarding Transaction & Atomicity Rollback Proof', () => {
  let userId: string;

  beforeAll(async () => {
    await subscriptionEntitlementService.ensureSeeded();
  });

  beforeEach(async () => {
    const timestamp = Date.now();
    userId = crypto.randomUUID();

    await prisma.user.create({
      data: {
        id: userId,
        googleSubject: `g-onb-user-${timestamp}`,
        email: `onb-user-${timestamp}@test.com`,
        emailNormalized: `onb-user-${timestamp}@test.com`,
        name: 'Onboarding Test User',
        status: 'active',
      },
    });
  });

  it('executes production completeOwnerOnboarding transaction with exact entity counts', async () => {
    const timestamp = Date.now();
    const service = new DormitoryProvisioningService(
      new PrismaDormitoryRepository(prisma),
      new InMemoryBillingSettingsRepository(),
      new PrismaSubscriptionPlanRepository(prisma),
      new PrismaSubscriptionRepository(prisma),
      new InMemoryPromoRepository(),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      new InMemoryOnboardingDraftRepository(),
      new InMemoryIdempotencyRepository(),
      new PrismaBuildingRepository(prisma),
      new PrismaRoomRepository(prisma),
      new SensitiveFieldService('0123456789abcdef0123456789abcdef', 1),
      new PromoService(new InMemoryPromoRepository()),
      new AuditService(),
      prisma
    );

    const prepared = await service.prepareProvisionalDormitory(userId, { name: `Onboard Dorm ${timestamp}` });
    const provDormId = prepared.provisionalDormitoryId;
    const sigService = new SignatureStorageService(prisma);
    const pngObj = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < pngObj.data.length; i += 4) {
      pngObj.data[i] = 0;
      pngObj.data[i + 1] = 0;
      pngObj.data[i + 2] = 0;
      pngObj.data[i + 3] = 255;
    }
    const validPngBuffer = PNG.sync.write(pngObj);
    await sigService.saveSignature({ dormitoryId: provDormId, userId, buffer: validPngBuffer });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
      await tx.dormitoryLineConfig.update({ where: { dormitoryId: provDormId }, data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true } });
    });

    const result = await service.completeOwnerOnboarding({
      userId,
      idempotencyKey: `idempotency-onb-${timestamp}`,
      provisionalDormitoryId: provDormId,
      planCode: 'FREE',
      dormitory: {
        name: `Onboard Dorm ${timestamp}`,
        addressLine1: '123 Onboard Street',
        phone: '0812345678',
        postalCode: '10110',
        estimatedRoomCount: 5,
      },
      billing: {
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'PER_UNIT',
        waterRate: '18',
        electricityBillingType: 'PER_UNIT',
        electricityRate: '7',
      },
      buildings: [
        { id: 'temp-bld-1', name: 'Building 1', floorsCount: 2 },
      ],
      rooms: [
        { buildingId: 'temp-bld-1', roomNumber: '101', floor: 1, monthlyRent: 3500, depositAmount: 3500 },
      ],
    });

    expect(result.dormitory).toBeDefined();
    const dormId = result.dormitory.id;

    // Verify EXACT entity counts in PostgreSQL
    const dormitories = await prisma.dormitory.findMany({ where: { id: dormId } });
    expect(dormitories.length).toBe(1);

    const ownerMemberships = await prisma.dormitoryMember.findMany({
      where: { dormitoryId: dormId, userId, role: { code: 'OWNER' } },
    });
    expect(ownerMemberships.length).toBe(1);

    const subscriptions = await prisma.dormitorySubscription.findMany({
      where: { dormitoryId: dormId },
    });
    expect(subscriptions.length).toBe(1);

    const statusHistories = await prisma.subscriptionStatusHistory.findMany({
      where: { subscriptionId: subscriptions[0].id },
    });
    expect(statusHistories.length).toBe(1);

    // Verify 0 legacy promo/platform subscription records
    const platformSubs = await prisma.platformSubscription.findMany({ where: { dormitoryId: dormId } });
    expect(platformSubs.length).toBe(0);

    const legacyPromos = await prisma.platformPromoCode.findMany({ where: { code: 'LEGACY_PROMO' } });
    expect(legacyPromos.length).toBe(0);
  });

  it('proves atomic PostgreSQL rollback on transaction dependency failure', async () => {
    const timestamp = Date.now();

    async function getEntityCountsForUser(uId: string) {
      const dorms = await prisma.dormitory.findMany({ where: { createdByUserId: uId }, select: { id: true } });
      const dormIds = dorms.map((d) => d.id);
      const subs = await prisma.dormitorySubscription.findMany({ where: { dormitoryId: { in: dormIds } }, select: { id: true } });
      const subIds = subs.map((s) => s.id);

      return {
        dormitory: dorms.length,
        dormitoryMember: await prisma.dormitoryMember.count({ where: { userId: uId } }),
        dormitorySubscription: subs.length,
        subscriptionStatusHistory: await prisma.subscriptionStatusHistory.count({ where: { subscriptionId: { in: subIds } } }),
        platformSubscription: await prisma.platformSubscription.count({ where: { dormitoryId: { in: dormIds } } }),
        platformPromoCode: await prisma.platformPromoCode.count({ where: { code: `PROMO-${uId}` } }),
        building: await prisma.building.count({ where: { dormitoryId: { in: dormIds } } }),
        room: await prisma.room.count({ where: { dormitoryId: { in: dormIds } } }),
      };
    }

    // 1. Capture BEFORE counts for ALL 8 entities in PostgreSQL
    // NOTE: Captured BEFORE prepareProvisionalDormitory was not suitable because
    // prepareProvisionalDormitory creates a setup_pending dormitory outside the
    // completeOwnerOnboarding transaction. We now need to account for it.

    const service = new DormitoryProvisioningService(
      new PrismaDormitoryRepository(prisma),
      new InMemoryBillingSettingsRepository(),
      new PrismaSubscriptionPlanRepository(prisma),
      new PrismaSubscriptionRepository(prisma),
      new InMemoryPromoRepository(),
      new PrismaMembershipRepository(prisma),
      new PrismaRoleRepository(prisma),
      new InMemoryOnboardingDraftRepository(),
      new InMemoryIdempotencyRepository(),
      new PrismaBuildingRepository(prisma),
      new PrismaRoomRepository(prisma),
      new SensitiveFieldService('0123456789abcdef0123456789abcdef', 1),
      new PromoService(new InMemoryPromoRepository()),
      new AuditService(),
      prisma
    );

    // Inject a controlled dependency failure inside the transaction boundary
    const spy = vi.spyOn(subscriptionEntitlementService, 'provisionInitialTrial').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_TRANSACTION_FAILURE: Subscription creation failed inside transaction');
    });

    const preparedRollback = await service.prepareProvisionalDormitory(userId, { name: `Rollback Dorm ${timestamp}` });
    const provDormIdRollback = preparedRollback.provisionalDormitoryId;
    const sigService = new SignatureStorageService(prisma);
    const pngObj = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < pngObj.data.length; i += 4) {
      pngObj.data[i] = 0;
      pngObj.data[i + 1] = 0;
      pngObj.data[i + 2] = 0;
      pngObj.data[i + 3] = 255;
    }
    const validPngBuffer = PNG.sync.write(pngObj);
    await sigService.saveSignature({ dormitoryId: provDormIdRollback, userId, buffer: validPngBuffer });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormIdRollback}, true)`;
      await tx.dormitoryLineConfig.update({ where: { dormitoryId: provDormIdRollback }, data: { accessTokenVerifiedAt: new Date(), webhookEndpointSetAt: new Date(), webhookTestSucceededAt: new Date(), webhookActive: true, isConnected: true } });
    });

    // Capture counts AFTER prepare (provisional dorm + membership exist)
    const initialCounts = await getEntityCountsForUser(userId);

    await expect(
      service.completeOwnerOnboarding({
        userId,
        idempotencyKey: `idempotency-rollback-${timestamp}`,
        provisionalDormitoryId: provDormIdRollback,
        planCode: 'FREE',
        dormitory: {
          name: `Rollback Dorm ${timestamp}`,
          addressLine1: '456 Fail St',
          phone: '0899999999',
          postalCode: '10220',
          estimatedRoomCount: 5,
        },
        buildings: [
          { id: 'temp-bld-rollback', name: 'Building Fail', floorsCount: 1 },
        ],
        rooms: [
          { buildingId: 'temp-bld-rollback', roomNumber: '999', floor: 1, monthlyRent: 3000 },
        ],
      })
    ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE');

    spy.mockRestore();

    // 2. Capture AFTER counts for ALL 8 entities in PostgreSQL
    const finalCounts = await getEntityCountsForUser(userId);

    // 3. Require EVERY count to remain 100% UNCHANGED after atomic PostgreSQL rollback
    expect(finalCounts).toEqual(initialCounts);
  });
});
