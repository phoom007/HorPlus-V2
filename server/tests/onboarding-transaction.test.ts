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

    const result = await service.completeOwnerOnboarding({
      userId,
      idempotencyKey: `idempotency-onb-${timestamp}`,
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

    const initialDormCount = await prisma.dormitory.count({ where: { createdByUserId: userId } });
    const initialMemberCount = await prisma.dormitoryMember.count({ where: { userId } });

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

    // Inject a controlled dependency failure inside the transaction
    const spy = vi.spyOn(subscriptionEntitlementService, 'provisionInitialTrial').mockImplementationOnce(async () => {
      throw new Error('SIMULATED_TRANSACTION_FAILURE: Subscription creation failed inside transaction');
    });

    await expect(
      service.completeOwnerOnboarding({
        userId,
        idempotencyKey: `idempotency-rollback-${timestamp}`,
        planCode: 'FREE',
        dormitory: {
          name: `Rollback Dorm ${timestamp}`,
          addressLine1: '456 Fail St',
          phone: '0899999999',
          postalCode: '10220',
          estimatedRoomCount: 5,
        },
      })
    ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE');

    spy.mockRestore();

    // Verify 100% UNCHANGED entity counts for this user after atomic PostgreSQL rollback
    const finalDormCount = await prisma.dormitory.count({ where: { createdByUserId: userId } });
    const finalMemberCount = await prisma.dormitoryMember.count({ where: { userId } });

    expect(finalDormCount).toBe(initialDormCount); // 0 === 0
    expect(finalMemberCount).toBe(initialMemberCount); // 0 === 0
  });
});
