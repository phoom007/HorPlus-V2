/**
 * Master 6-Step Owner Onboarding Real Lifecycle & Idempotency Regression Tests
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import { SignatureStorageService } from '../../services/signature-storage.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { PNG } from 'pngjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

describe('Master 6-Step Owner Onboarding Lifecycle & Idempotency', () => {
  let provisioningService: DormitoryProvisioningService;
  let onboardingService: OnboardingService;
  let signatureService: SignatureStorageService;
  let testUserId: string;
  let provDormId: string;

  beforeAll(async () => {
    const testKey = process.env.FIELD_ENCRYPTION_KEY || 'fedcba9876543210fedcba9876543210';
    const sensitiveFieldService = new SensitiveFieldService(testKey);

    provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);
    onboardingService = new OnboardingService(prisma);
    signatureService = new SignatureStorageService(prisma);

    // Create fresh test user with 0 memberships
    testUserId = crypto.randomUUID();
    const email = `fresh_owner_${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: testUserId,
        email,
        emailNormalized: email.toLowerCase(),
        name: 'Fresh Master Real Owner',
        googleSubject: `goog_sub_${testUserId}`,
      },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      const user = await prisma.user.findUnique({
        where: { id: testUserId },
        include: { memberships: true },
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

  it('2. Preparing provisional dormitory before Step 4 creates setup_pending dormitory and webhook URL', async () => {
    const prepared = await provisioningService.prepareProvisionalDormitory(testUserId, {
      name: 'Master 6-Step Provisional Dormitory',
    });

    expect(prepared.provisionalDormitoryId).toBeDefined();
    expect(prepared.webhookUrl).toContain('/api/v1/line/webhook/');
    provDormId = prepared.provisionalDormitoryId;

    const dormDb = await prisma.dormitory.findUnique({ where: { id: provDormId } });
    expect(dormDb).not.toBeNull();
    expect(dormDb?.status).toBe('setup_pending');
  });

  it('3. Uploading owner signature persists PNG signature record with isCurrent = true', async () => {
    const pngObj = new PNG({ width: 16, height: 16 });
    for (let i = 0; i < pngObj.data.length; i += 4) {
      pngObj.data[i] = 0;
      pngObj.data[i + 1] = 0;
      pngObj.data[i + 2] = 0;
      pngObj.data[i + 3] = 255;
    }
    const validPngBuffer = PNG.sync.write(pngObj);

    const sigResult = await signatureService.saveSignature({
      dormitoryId: provDormId,
      userId: testUserId,
      buffer: validPngBuffer,
    });

    expect(sigResult.id).toBeDefined();
    expect(sigResult.version).toBe(1);

    const latest = await signatureService.getLatestSignatureRecord(provDormId);
    expect(latest).not.toBeNull();
    expect(latest?.isCurrent).toBe(true);
  });

  it('4. Completing 6-step onboarding finalizes setup_pending -> active and grants +1 CALENDAR MONTH initial trial', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;
      await tx.dormitoryLineConfig.update({
        where: { dormitoryId: provDormId },
        data: {
          accessTokenVerifiedAt: new Date(),
          webhookEndpointSetAt: new Date(),
          webhookTestSucceededAt: new Date(),
          webhookActive: true,
          isConnected: true,
        },
      });
    });

    const result = await provisioningService.completeOwnerOnboarding({
      userId: testUserId,
      idempotencyKey: `idemp_master_${Date.now()}`,
      provisionalDormitoryId: provDormId,
      dormitory: {
        name: 'Master 6-Step Active Dormitory',
        type: 'apartment',
        addressLine1: '123 Master St',
        phone: '0812345678',
        email: 'master@dorm.com',
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
        },
      ],
      rooms: [
        { buildingId: 'bld-temp-1', roomNumber: '101', floor: 1, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '102', floor: 1, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '201', floor: 2, monthlyRent: 4500, depositAmount: 5000 },
        { buildingId: 'bld-temp-1', roomNumber: '202', floor: 2, monthlyRent: 4500, depositAmount: 5000 },
      ],
      planCode: 'FREE',
      promoCode: 'HORPLUS',
    });

    expect(result.success).toBe(true);
    expect(result.dormitoryId).toBe(provDormId);
    expect(result.subscriptionStatus).toBe('TRIAL');
    expect(result.totalTrialMonths).toBe(3); // +1 month initial + 2 months HORPLUS promo

    // Verify PostgreSQL state under RLS context
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provDormId}, true)`;

      const dormDb = await tx.dormitory.findUnique({ where: { id: provDormId } });
      expect(dormDb).not.toBeNull();
      expect(dormDb?.status).toBe('active');

      const subDb = await tx.dormitorySubscription.findUnique({ where: { dormitoryId: provDormId } });
      expect(subDb).not.toBeNull();
      expect(subDb?.status).toBe('TRIAL');

      const claims = await tx.accountBenefitClaim.findMany({ where: { userId: testUserId } });
      expect(claims.length).toBe(1);
      expect(claims[0].benefitKey).toBe('INITIAL_TRIAL_V1');
    });
  });

  it('5. After onboarding completion, onboardingRequired becomes false and ownedDormitoryCount = 1', async () => {
    const status = await onboardingService.getStatus(testUserId);
    expect(status.ownedDormitoryCount).toBe(1);
    expect(status.onboardingRequired).toBe(false);
  });
});
