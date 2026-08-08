/**
 * Real Owner Onboarding Lifecycle & Idempotency Regression Tests
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import { PrismaDormitoryRepository } from '../../db/repositories/dormitory.repository.js';
import { InMemoryBillingSettingsRepository } from '../../db/repositories/billing-settings.repository.js';
import { InMemoryPlanRepository } from '../../db/repositories/plan.repository.js';
import { PrismaSubscriptionRepository } from '../../db/repositories/subscription.repository.js';
import { InMemoryPromoRepository } from '../../db/repositories/promo.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { InMemoryOnboardingDraftRepository } from '../../db/repositories/onboarding-draft.repository.js';
import { InMemoryIdempotencyRepository } from '../../db/repositories/idempotency.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { PromoService } from '../../services/promo.service.js';
import { AuditService } from '../../services/audit.service.js';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Real Owner Onboarding Lifecycle & Idempotency', () => {
  let provisioningService: DormitoryProvisioningService;
  let onboardingService: OnboardingService;
  let testUserId: string;

  beforeAll(async () => {
    const dormRepo = new PrismaDormitoryRepository(prisma);
    const billingRepo = new InMemoryBillingSettingsRepository();
    const planRepo = new InMemoryPlanRepository();
    const subRepo = new PrismaSubscriptionRepository(prisma);
    const promoRepo = new InMemoryPromoRepository();
    const membershipRepo = new PrismaMembershipRepository(prisma);
    const roleRepo = new PrismaRoleRepository(prisma);
    const draftRepo = new InMemoryOnboardingDraftRepository();
    const idempotencyRepo = new InMemoryIdempotencyRepository();
    const buildingRepo = new PrismaBuildingRepository(prisma);
    const roomRepo = new PrismaRoomRepository(prisma);
    const sensitiveFieldService = new SensitiveFieldService(process.env.DORM_ENCRYPTION_KEY || 'default_32_byte_secret_key_123456');
    const promoService = new PromoService(promoRepo, subRepo);
    const auditService = new AuditService();

    provisioningService = new DormitoryProvisioningService(
      dormRepo,
      billingRepo,
      planRepo,
      subRepo,
      promoRepo,
      membershipRepo,
      roleRepo,
      draftRepo,
      idempotencyRepo,
      buildingRepo,
      roomRepo,
      sensitiveFieldService,
      promoService,
      auditService,
      prisma
    );

    onboardingService = new OnboardingService(draftRepo, membershipRepo, dormRepo, subRepo, planRepo);

    // Create fresh test user with 0 memberships
    testUserId = crypto.randomUUID();
    const email = `fresh_owner_${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Fresh Real Owner',
        googleSubject: `goog_sub_${testUserId}`,
      }
    });
  });

  afterAll(async () => {
    if (testUserId) {
      // Cleanup created dormitories and user
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { memberships: true }
      });
      if (user) {
        for (const m of user.memberships) {
          await prisma.dormitory.delete({ where: { id: m.dormitoryId } }).catch(() => {});
        }
        await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
      }
    }
  });

  it('1. Fresh Owner initially has 0 owned dormitories and onboardingRequired = true', async () => {
    const status = await onboardingService.getStatus(testUserId);
    expect(status.ownedDormitoryCount).toBe(0);
    expect(status.onboardingRequired).toBe(true);
  });

  it('2. Completing onboarding provisions real Dormitory, OWNER membership, Buildings & Rooms in PostgreSQL', async () => {
    const idempotencyKey = `idemp_onb_${Date.now()}`;
    const result = await provisioningService.completeOwnerOnboarding({
      userId: testUserId,
      idempotencyKey,
      dormitory: {
        name: 'Real Test Provisioned Dormitory',
        type: 'apartment',
        addressLine1: '123 Real St',
        phone: '0812345678',
        email: 'real@dorm.com',
        estimatedBuildingCount: 1,
        estimatedRoomCount: 4,
      },
      billing: {
        billingDay: 25,
        dueDay: 5,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFee: '200.00',
        internetFee: '150.00',
        lateFeeType: 'per_day',
        lateFeeValue: '100.00',
        rentBillingType: 'monthly',
      },
      buildings: [
        {
          id: 'bld-temp-1',
          name: 'Building A',
          floorsCount: 2,
          roomsPerFloor: 2,
        }
      ],
      rooms: [
        { buildingId: 'bld-temp-1', roomNumber: '101', floor: 1, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '102', floor: 1, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '201', floor: 2, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '202', floor: 2, monthlyRent: 4500, depositAmount: 5000 },
      ],
      planCode: 'FREE',
    });

    expect(result.dormitory.id).toBeDefined();
    expect(result.dormitory.name).toBe('Real Test Provisioned Dormitory');
    expect(result.membership.roleCode).toBe('OWNER');

    // Verify PostgreSQL state under RLS context
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${result.dormitory.id}, true)`;

      const dormDb = await tx.dormitory.findUnique({ where: { id: result.dormitory.id } });
      expect(dormDb).not.toBeNull();
      expect(dormDb?.name).toBe('Real Test Provisioned Dormitory');

      const memberDb = await tx.dormitoryMember.findFirst({
        where: { dormitoryId: result.dormitory.id, userId: testUserId }
      });
      expect(memberDb).not.toBeNull();

      const buildingsDb = await tx.building.findMany({ where: { dormitoryId: result.dormitory.id } });
      expect(buildingsDb.length).toBe(1);
      expect(buildingsDb[0].name).toBe('Building A');

      const roomsDb = await tx.room.findMany({ where: { dormitoryId: result.dormitory.id } });
      expect(roomsDb.length).toBe(4);
    });
  });

  it('3. After onboarding completion, onboardingRequired becomes false and ownedDormitoryCount = 1', async () => {
    const status = await onboardingService.getStatus(testUserId);
    expect(status.ownedDormitoryCount).toBe(1);
    expect(status.onboardingRequired).toBe(false);
  });
});
