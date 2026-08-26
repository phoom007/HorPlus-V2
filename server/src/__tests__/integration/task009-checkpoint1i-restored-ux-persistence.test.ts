/**
 * TASK-009 Checkpoint 1I — Authoritative Restored UX & LINE Config Truth Integration Suite
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { LineOaService, validatePublicWebhookOrigin } from '../../services/line-oa.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { FakeLineTokenProvider } from '../../services/line-channel-token-provider.js';
import { OnboardingService } from '../../services/onboarding.service.js';

function getGuardedAdminUrl(): string {
  const rawUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('FAIL CLOSED: DIRECT_URL or DATABASE_URL is required');
  }
  const parsed = new URL(rawUrl);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5455' || parsed.pathname.replace(/^\/+/, '') !== 'horplus_wave1d_fasttrack_test') {
    throw new Error('FAIL CLOSED: Target must be 127.0.0.1:5455/horplus_wave1d_fasttrack_test');
  }
  return rawUrl;
}

const ADMIN_URL = getGuardedAdminUrl();

describe('TASK-009 Checkpoint 1I — Authoritative Restored UX & LINE Config Truth Suite', () => {
  let prisma: PrismaClient;
  let provisioningService: DormitoryProvisioningService;
  let lineService: LineOaService;
  let fakeAdapter: MockLinePlatformAdapter;
  let fakeTokenProvider: FakeLineTokenProvider;
  let sensitiveService: SensitiveFieldService;
  let testUserId: string;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    prisma = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    sensitiveService = new SensitiveFieldService(process.env.ENCRYPTION_KEY);
    fakeAdapter = new MockLinePlatformAdapter();
    fakeTokenProvider = new FakeLineTokenProvider();
    provisioningService = new DormitoryProvisioningService(prisma, sensitiveService);
    lineService = new LineOaService(prisma, fakeAdapter, fakeTokenProvider);

    const user = await prisma.user.create({
      data: {
        email: `test_owner_1i_${Date.now()}@test.com`,
        emailNormalized: `test_owner_1i_${Date.now()}@test.com`,
        name: 'Test Owner 1I',
        googleSubject: `goog_sub_1i_${Date.now()}`,
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('1. Canonical LINE OA Config DTO & Public Webhook Origin Fail-Closed Rules', () => {
    it('1.1 validatePublicWebhookOrigin rejects localhost and HTTP in non-test mode', () => {
      const origEnv = process.env.NODE_ENV;
      const origE2E = process.env.HORPLUS_E2E;
      try {
        process.env.NODE_ENV = 'production';
        process.env.HORPLUS_E2E = 'false';

        const res1 = validatePublicWebhookOrigin('http://127.0.0.1:3001');
        expect(res1.isConfigured).toBe(false);
        expect(res1.origin).toBeNull();
        expect(res1.errorReason).toBe('PUBLIC_WEBHOOK_ORIGIN_LOCALHOST_REJECTED');

        const res2 = validatePublicWebhookOrigin('http://public-domain.com');
        expect(res2.isConfigured).toBe(false);
        expect(res2.origin).toBeNull();
        expect(res2.errorReason).toBe('PUBLIC_WEBHOOK_ORIGIN_HTTPS_REQUIRED');

        const res3 = validatePublicWebhookOrigin('https://app.horplus.com');
        expect(res3.isConfigured).toBe(true);
        expect(res3.origin).toBe('https://app.horplus.com');
      } finally {
        process.env.NODE_ENV = origEnv;
        process.env.HORPLUS_E2E = origE2E;
      }
    });

    it('1.2 PUT credentials response returns identical canonical DTO as GET config and updates profile card metadata immediately', async () => {
      const prep = await provisioningService.prepareProvisionalDormitory(testUserId, {
        name: 'LINE Config Test Dorm',
        province: 'กรุงเทพมหานคร',
      });
      const dormId = prep.provisionalDormitoryId;

      // Ensure mock adapter returns rich bot info
      fakeAdapter.setVerifyResult({
        verified: true,
        botInfo: {
          userId: 'U_bot_1i_test_user_id',
          basicId: '@1i_bot_basic',
          premiumId: '@premium_1i_bot',
          displayName: 'HorPlus Bot 1I',
          pictureUrl: 'https://example.com/avatar_1i.png',
          chatMode: 'chat',
        },
      });

      // PUT credentials (without lineOaId in request payload)
      const putRes = await lineService.updateDormitoryLineConfig(dormId, {
        channelId: '2006123456',
        channelSecret: 'test_channel_secret_12345',
      }, 'https://webhook.horplus.com');

      // Assert PUT response canonical fields
      expect(putRes.credentialsVerified).toBe(true);
      expect(putRes.isPublicWebhookConfigured).toBe(true);
      expect(putRes.channelId).toBe('2006123456');
      expect(putRes.lineOaId).toBe('@1i_bot_basic');
      expect(putRes.botUserId).toBe('U_bot_1i_test_user_id');
      expect(putRes.botDisplayName).toBe('HorPlus Bot 1I');
      expect(putRes.botPictureUrl).toBe('https://example.com/avatar_1i.png');
      expect(putRes.botPremiumId).toBe('@premium_1i_bot');
      expect(putRes.botChatMode).toBe('chat');
      expect(putRes.webhookUrl).toBe('https://webhook.horplus.com/api/v1/line/webhook/' + extractOpaqueKey(putRes.webhookUrl));

      // GET config returns identical DTO
      const getRes = await lineService.getDormitoryLineConfig(dormId, 'https://webhook.horplus.com');
      expect(getRes).toEqual(putRes);

      // Verify PostgreSQL DB records
      const dbConfig = await prisma.dormitoryLineConfig.findUnique({ where: { dormitoryId: dormId } });
      expect(dbConfig?.channelId).toBe('2006123456');
      expect(dbConfig?.lineOaId).toBe('@1i_bot_basic');
      expect(dbConfig?.botUserId).toBe('U_bot_1i_test_user_id');
      expect(dbConfig?.botDisplayName).toBe('HorPlus Bot 1I');
      expect(dbConfig?.botPictureUrl).toBe('https://example.com/avatar_1i.png');
      expect(dbConfig?.botPremiumId).toBe('@premium_1i_bot');
      expect(dbConfig?.botChatMode).toBe('chat');
    });
  });

  describe('2. Real Database Finalization Proof for Rich Restored Payload & Zero-Value Fidelity', () => {
    it('2.1 Finalizes rich onboarding payload and verifies PostgreSQL persistence for every field including termMonths and 0 values', async () => {
      const prep = await provisioningService.prepareProvisionalDormitory(testUserId, {
        name: 'Rich Restored Dormitory',
        addressLine1: '123/45 ถนนสุขุมวิท',
        province: 'กรุงเทพมหานคร',
      });
      const dormId = prep.provisionalDormitoryId;

      const ik = `ik-finalize-restored-${Date.now()}`;
      const payload = {
        provisionalDormitoryId: dormId,
        dormitory: {
          name: 'Rich Restored Dormitory',
          type: 'apartment',
          genderPolicy: 'ชาย',
          addressLine1: '123/45 ถนนสุขุมวิท',
          province: 'กรุงเทพมหานคร',
          estimatedBuildingCount: 2,
          estimatedRoomCount: 10,
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
          waterBillingType: 'per_unit',
          waterRate: '20.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          commonFee: '300.00',
          commonFeeMode: 'flat',
          internetFee: '200.00',
          internetFeeMode: 'flat',
          parkingRate: '500.00',
          parkingFeeMode: 'flat',
          gracePeriodDays: 3,
          advanceRentMonths: 0, // ZERO-VALUE FIDELITY TEST (0 stays 0)
          lateFeeType: 'fixed',
          lateFeeValue: '100.00',
          rentBillingType: 'monthly',
        },
        payment: {
          cashAccepted: true,
          promptPayType: 'mobile_phone',
          promptPayValue: '0812345678',
          bankCode: 'KBank',
          bankAccountName: 'นาย สมชาย ใจดี',
          bankAccountNumber: '123-4-56789-0',
        },
        buildings: [
          {
            id: 'bld-alpha',
            name: 'Building Alpha',
            floorsCount: 2,
            roomsPerFloor: 3,
            roomPrefix: 'A',
            hasElevator: true,
            numberingPattern: 'prefix_floor_room',
            formatPattern: 'prefix_floor_room',
            monthlyRent: 4500,
            dailyRent: 500,
            termRent: 25000,
            termMonths: 6,
            maximumOccupants: 3,
          },
          {
            id: 'bld-beta',
            name: 'Building Beta',
            floorsCount: 1,
            roomsPerFloor: 2,
            roomPrefix: 'B',
            hasElevator: false,
            numberingPattern: 'floor_room',
            formatPattern: 'floor_room',
            monthlyRent: 3800,
            dailyRent: 0, // ZERO-VALUE FIDELITY TEST
            termRent: 20000,
            termMonths: 12,
            maximumOccupants: 2,
          },
        ],
        rooms: [
          {
            buildingId: 'bld-alpha',
            roomNumber: 'A101',
            floor: 1,
            monthlyRent: 4500,
            dailyRent: 500,
            termRent: 25000,
            termMonths: 6,
            depositAmount: 5000,
            maximumOccupants: 3,
            status: 'vacant',
          },
          {
            buildingId: 'bld-beta',
            roomNumber: '101',
            floor: 1,
            monthlyRent: 3800,
            dailyRent: 0,
            termRent: 20000,
            termMonths: 12,
            depositAmount: 4000,
            maximumOccupants: 2,
            status: 'vacant',
          },
        ],
        planCode: 'PAID',
      };

      // Seed owner signature & verified LINE OA config required by completeOwnerOnboarding (under dormitory RLS context)
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_dormitory_id', '${dormId}', true)`);
        await tx.ownerSignature.create({
          data: {
            dormitory: { connect: { id: dormId } },
            signedBy: { connect: { id: testUserId } },
            objectKey: 'signatures/sig_test_1i.png',
            sha256: 'hash_1i_sig_12345',
            byteSize: 1024,
            isCurrent: true,
          },
        });
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId: dormId },
          data: {
            channelId: '2006123456',
            channelSecretEncrypted: 'encrypted_secret_1i',
            accessTokenVerifiedAt: new Date(),
            webhookEndpointSetAt: new Date(),
            webhookTestSucceededAt: new Date(),
            webhookActive: true,
            isConnected: true,
          },
        });
      });

      const quote1 = await subscriptionIntentService.createIntentQuote(testUserId, { isFreePlan: true }, undefined, dormId);

      const res = await provisioningService.completeOwnerOnboarding({
        userId: testUserId,
        idempotencyKey: ik,
        packageIntentId: quote1.intentId,
        ...payload,
      });

      expect(res.dormitory.id).toBe(dormId);

      // Query PostgreSQL directly and assert every field
      const dbDorm = await prisma.dormitory.findUnique({ where: { id: dormId } });
      expect(dbDorm?.name).toBe('Rich Restored Dormitory');
      expect(dbDorm?.genderPolicy).toBe('ชาย');
      expect(dbDorm?.addressLine1).toBe('123/45 ถนนสุขุมวิท');
      expect(dbDorm?.province).toBe('กรุงเทพมหานคร');

      const dbBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: dormId } });
      expect(dbBilling?.advanceRentMonths).toBe(0); // ZERO-VALUE FIDELITY ASSERTION
      expect(dbBilling?.gracePeriodDays).toBe(2);
      expect(Number(dbBilling?.waterRate)).toBe(20);
      expect(Number(dbBilling?.electricityRate)).toBe(8);
      expect(Number(dbBilling?.commonFee)).toBe(300);
      expect(dbBilling?.commonFeeMode).toBe('flat');
      expect(Number(dbBilling?.internetFee)).toBe(200);
      expect(dbBilling?.internetFeeMode).toBe('flat');
      expect(Number(dbBilling?.parkingRate)).toBe(500);
      expect(dbBilling?.parkingFeeMode).toBe('flat');
      expect(dbBilling?.bankCode).toBe('KBank');
      expect(dbBilling?.bankAccountName).toBe('นาย สมชาย ใจดี');

      const dbBldAlpha = await prisma.building.findFirst({ where: { dormitoryId: dormId, name: 'Building Alpha' } });
      expect(dbBldAlpha?.roomPrefix).toBe('A');
      expect(dbBldAlpha?.hasElevator).toBe(true);
      expect(dbBldAlpha?.numberingPattern).toBe('prefix_floor_room');
      expect(Number(dbBldAlpha?.monthlyRent)).toBe(4500);
      expect(Number(dbBldAlpha?.dailyRent)).toBe(500);
      expect(Number(dbBldAlpha?.termRent)).toBe(25000);
      expect(dbBldAlpha?.termMonths).toBe(6);
      expect(dbBldAlpha?.maximumOccupants).toBe(3);

      const dbBldBeta = await prisma.building.findFirst({ where: { dormitoryId: dormId, name: 'Building Beta' } });
      expect(dbBldBeta?.roomPrefix).toBe('B');
      expect(dbBldBeta?.hasElevator).toBe(false);
      expect(dbBldBeta?.numberingPattern).toBe('floor_room');
      expect(Number(dbBldBeta?.monthlyRent)).toBe(3800);
      expect(Number(dbBldBeta?.dailyRent)).toBe(0); // ZERO-VALUE FIDELITY ASSERTION
      expect(Number(dbBldBeta?.termRent)).toBe(20000);
      expect(dbBldBeta?.termMonths).toBe(12);
      expect(dbBldBeta?.maximumOccupants).toBe(2);

      const dbRoomA101 = await prisma.room.findFirst({ where: { dormitoryId: dormId, roomNumber: 'A101' } });
      expect(Number(dbRoomA101?.monthlyRent)).toBe(4500);
      expect(Number(dbRoomA101?.dailyRent)).toBe(500);
      expect(Number(dbRoomA101?.termRent)).toBe(25000);
      expect(dbRoomA101?.termMonths).toBe(6);
      expect(Number(dbRoomA101?.depositAmount)).toBe(5000);

      const dbRoom101 = await prisma.room.findFirst({ where: { dormitoryId: dormId, roomNumber: '101' } });
      expect(Number(dbRoom101?.monthlyRent)).toBe(3800);
      expect(Number(dbRoom101?.dailyRent)).toBe(0); // ZERO-VALUE FIDELITY ASSERTION
      expect(Number(dbRoom101?.termRent)).toBe(20000);
      expect(dbRoom101?.termMonths).toBe(12);
      expect(Number(dbRoom101?.depositAmount)).toBe(4000);
    });

    it('2.2 Regression test: unsupplied/untouched business-value fields CANNOT silently create 3500 / 18 / 7 values in PostgreSQL', async () => {
      const user2 = await prisma.user.create({
        data: {
          email: `test_owner_1i_reg_${Date.now()}@test.com`,
          emailNormalized: `test_owner_1i_reg_${Date.now()}@test.com`,
          name: 'Test Owner 1I Regression',
          googleSubject: `goog_sub_1i_reg_${Date.now()}`,
        },
      });
      const testUserId2 = user2.id;

      const prep = await provisioningService.prepareProvisionalDormitory(testUserId2, {
        name: 'Neutral Default Dormitory',
      });
      const dormId = prep.provisionalDormitoryId;

      const ik = `ik-neutral-defaults-${Date.now()}`;
      const payload = {
        provisionalDormitoryId: dormId,
        dormitory: {
          name: 'Neutral Default Dormitory',
        },
        billing: {
          dueDay: 10,
          waterRate: '0.00',
          electricityRate: '0.00',
        },
        payment: {
          cashAccepted: true,
          bankCode: 'KBank',
          bankAccountName: 'Neutral Owner',
          bankAccountNumber: '999-0-11111-2',
        },
        buildings: [
          {
            id: 'bld-neutral',
            name: 'อาคาร 1',
            floorsCount: 1,
            roomsPerFloor: 1,
            monthlyRent: 0,
          },
        ],
        rooms: [
          {
            buildingId: 'bld-neutral',
            roomNumber: '101',
            floor: 1,
            monthlyRent: 0,
            depositAmount: 0,
          },
        ],
        planCode: 'FREE',
      };

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_dormitory_id', '${dormId}', true)`);
        await tx.ownerSignature.create({
          data: {
            dormitory: { connect: { id: dormId } },
            signedBy: { connect: { id: testUserId2 } },
            objectKey: 'signatures/sig_test_neutral.png',
            sha256: 'hash_neutral_sig',
            byteSize: 512,
            isCurrent: true,
          },
        });
        await tx.dormitoryLineConfig.update({
          where: { dormitoryId: dormId },
          data: {
            channelId: '2006999999',
            channelSecretEncrypted: 'encrypted_secret_neutral',
            accessTokenVerifiedAt: new Date(),
            webhookEndpointSetAt: new Date(),
            webhookTestSucceededAt: new Date(),
            webhookActive: true,
            isConnected: true,
          },
        });
      });

      const quote2 = await subscriptionIntentService.createIntentQuote(testUserId2, { isFreePlan: true }, undefined, dormId);

      await provisioningService.completeOwnerOnboarding({
        userId: testUserId2,
        idempotencyKey: ik,
        packageIntentId: quote2.intentId,
        ...payload,
      });

      const dbBilling = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: dormId } });
      expect(Number(dbBilling?.waterRate)).not.toBe(18);
      expect(Number(dbBilling?.electricityRate)).not.toBe(7);
      expect(Number(dbBilling?.waterRate)).toBe(0);
      expect(Number(dbBilling?.electricityRate)).toBe(0);

      const dbBld = await prisma.building.findFirst({ where: { dormitoryId: dormId, name: 'อาคาร 1' } });
      expect(Number(dbBld?.monthlyRent)).not.toBe(3500);
      expect(Number(dbBld?.monthlyRent)).toBe(0);
    });

    it('2.3 Concurrency & Isolation: Concurrent getOnboardingDraft for 2 users in parallel using Promise.all returns distinct normalized payloads without cross-contamination', async () => {
      const userA = await prisma.user.create({
        data: {
          email: `conc_user_a_${Date.now()}@test.com`,
          emailNormalized: `conc_user_a_${Date.now()}@test.com`,
          name: 'User A',
          googleSubject: `goog_sub_conc_a_${Date.now()}`,
        },
      });

      const userB = await prisma.user.create({
        data: {
          email: `conc_user_b_${Date.now()}@test.com`,
          emailNormalized: `conc_user_b_${Date.now()}@test.com`,
          name: 'User B',
          googleSubject: `goog_sub_conc_b_${Date.now()}`,
        },
      });

      await prisma.onboardingDraft.create({
        data: {
          userId: userA.id,
          currentStep: 'utilities',
          payload: {
            dormitoryName: 'Dorm A',
            address: '111 A Street',
            province: 'กรุงเทพมหานคร',
            buildings: [
              { id: 'b-a', name: 'Building A', rentRates: { monthly: 5000, term: 0, termMonths: 6, daily: 0, maxOccupants: 2 } }
            ],
            utilities: { waterRate: 15, electricRate: 7 }
          },
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000)
        }
      });

      await prisma.onboardingDraft.create({
        data: {
          userId: userB.id,
          currentStep: 'utilities',
          payload: {
            dormitoryName: 'Dorm B',
            address: '222 B Street',
            province: 'เชียงใหม่',
            buildings: [
              { id: 'b-b', name: 'Building B', rentRates: { monthly: 3000, term: 0, termMonths: 12, daily: 0, maxOccupants: 1 } }
            ],
            utilities: { waterRate: 20, electricRate: 8 }
          },
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000)
        }
      });

      const onboardingService = new OnboardingService(prisma);
      const [resA, resB] = await Promise.all([
        onboardingService.getDraft(userA.id),
        onboardingService.getDraft(userB.id)
      ]);

      expect(resA).toBeTruthy();
      expect(resB).toBeTruthy();
      if (!resA || !resB) throw new Error('Draft not found');
      expect(resA.payload?.dormitoryName).toBe('Dorm A');
      expect(resB.payload?.dormitoryName).toBe('Dorm B');
      expect(resA.payload?.address).toBe('111 A Street');
      expect(resB.payload?.address).toBe('222 B Street');
      expect(resA.payload?.buildings[0].name).toBe('Building A');
      expect(resB.payload?.buildings[0].name).toBe('Building B');
      expect(resA.payload?.buildings[0].rentRates.monthly).toBe(5000);
      expect(resB.payload?.buildings[0].rentRates.monthly).toBe(3000);

      // Cleanup
      await prisma.onboardingDraft.deleteMany({ where: { userId: { in: [userA.id, userB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
    });
  });
});

function extractOpaqueKey(url?: string | null): string {
  if (!url) return '';
  const parts = url.split('/');
  return parts[parts.length - 1];
}
