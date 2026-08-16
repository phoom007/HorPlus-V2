/**
 * Final Pre-Operator Security & Real-LINE Closure Integration Tests
 * Covers SEC-01, LINE-01, LINE-02, LINE-03, TRIAL-01, and PROMO-01 mandates.
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import { PNG } from 'pngjs';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../../app.js';
import { getEnv, resetCachedEnv } from '../../config/env.js';
import { getPrismaClient } from '../../db/prisma.js';
import { AuthenticationService } from '../../services/auth.service.js';
import { PrismaUserRepository } from '../../db/repositories/user.repository.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { PrismaMembershipRepository } from '../../db/repositories/membership.repository.js';
import { PrismaRoleRepository } from '../../db/repositories/role.repository.js';
import { PromoService } from '../../services/promo.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { SensitiveFieldService } from '../../services/sensitive-field.service.js';
import {
  LineChannelTokenProvider,
  FakeLineTokenProvider,
} from '../../services/line-channel-token-provider.js';
import {
  MockLinePlatformAdapter,
  HttpLinePlatformAdapter,
} from '../../services/line-platform-adapter.js';
import { LineOaService } from '../../services/line-oa.service.js';

const prisma = getPrismaClient();

describe('Final Pre-Operator Security & Real-LINE Closure Tests', () => {
  let app: express.Express;
  let authService: AuthenticationService;
  let provisioningService: DormitoryProvisioningService;
  let promoService: PromoService;

  let ownerAUserId: string;
  let ownerASessionToken: string;
  let ownerACsrfToken: string;
  let ownerADormId: string;

  let ownerBUserId: string;
  let ownerBSessionToken: string;
  let ownerBCsrfToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_MODE = 'true';
    resetCachedEnv();

    const sensitiveFieldService = new SensitiveFieldService(getEnv().FIELD_ENCRYPTION_KEY, 1);
    provisioningService = new DormitoryProvisioningService(prisma, sensitiveFieldService);
    promoService = new PromoService(prisma);

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

    // Create Owner A
    ownerAUserId = crypto.randomUUID();
    const emailA = `owner_a_${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: ownerAUserId,
        email: emailA,
        emailNormalized: emailA.toLowerCase(),
        name: 'Owner Alice',
        googleSubject: `goog_sub_${ownerAUserId}`,
      },
    });
    const sessionA = await authService.authenticateTestUser(ownerAUserId);
    ownerASessionToken = sessionA.sessionToken;
    ownerACsrfToken = sessionA.csrfToken;

    // Create Owner B
    ownerBUserId = crypto.randomUUID();
    const emailB = `owner_b_${Date.now()}@test.com`;
    await prisma.user.create({
      data: {
        id: ownerBUserId,
        email: emailB,
        emailNormalized: emailB.toLowerCase(),
        name: 'Owner Bob',
        googleSubject: `goog_sub_${ownerBUserId}`,
      },
    });
    const sessionB = await authService.authenticateTestUser(ownerBUserId);
    ownerBSessionToken = sessionB.sessionToken;
    ownerBCsrfToken = sessionB.csrfToken;

    // Prepare provisional dormitory for Owner A
    const prepA = await provisioningService.prepareProvisionalDormitory(ownerAUserId, {
      name: "Owner A's Secret Dormitory",
    });
    ownerADormId = prepA.provisionalDormitoryId;
  });

  afterAll(async () => {
    for (const uId of [ownerAUserId, ownerBUserId]) {
      if (uId) {
        const user = await prisma.user.findUnique({
          where: { id: uId },
          include: { memberships: true },
        });
        if (user) {
          for (const m of user.memberships) {
            await prisma.dormitory.delete({ where: { id: m.dormitoryId } }).catch(() => {});
          }
          await prisma.user.delete({ where: { id: uId } }).catch(() => {});
        }
      }
    }
  });

  // ==========================================================================
  // 1. SEC-01: Cross-Dorm Provisional Context Closure
  // ==========================================================================
  describe('SEC-01: Cross-Dorm Provisional Access Prohibition', () => {
    it('Owner B cannot GET Owner A provisional LINE config (returns 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/dormitories/${ownerADormId}/line-oa`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId);

      expect(res.status).toBe(403);
    });

    it('Owner B cannot PUT Owner A LINE credentials (returns 403, 0 DB mutation)', async () => {
      const res = await request(app)
        .put(`/api/v1/dormitories/${ownerADormId}/line-oa`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId)
        .send({ channelId: '999999999', channelSecret: 'hacked_secret' });

      expect(res.status).toBe(403);

      const config = await prisma.dormitoryLineConfig.findUnique({
        where: { dormitoryId: ownerADormId },
      });
      expect(config?.channelId).not.toBe('999999999');
    });

    it('Owner B cannot set webhook endpoint on Owner A dormitory (returns 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/dormitories/${ownerADormId}/line-oa/webhook/endpoint`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId);

      expect(res.status).toBe(403);
    });

    it('Owner B cannot test webhook endpoint on Owner A dormitory (returns 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/dormitories/${ownerADormId}/line-oa/webhook/test`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId);

      expect(res.status).toBe(403);
    });

    it('Owner B cannot rotate webhook on Owner A dormitory (returns 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/dormitories/${ownerADormId}/line-oa/rotate-webhook`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId);

      expect(res.status).toBe(403);
    });

    it('Owner B cannot access or upload signatures on Owner A dormitory (returns 403)', async () => {
      const pngObj = new PNG({ width: 16, height: 16 });
      const validPngBuffer = PNG.sync.write(pngObj);

      const res = await request(app)
        .post(`/api/v1/dormitories/${ownerADormId}/signatures`)
        .set('Cookie', [`horplus_session=${ownerBSessionToken}`, `horplus_csrf=${ownerBCsrfToken}`])
        .set('x-csrf-token', ownerBCsrfToken)
        .set('x-dormitory-id', ownerADormId)
        .attach('file', validPngBuffer, 'sig.png');

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // 2. LINE-01 & LINE-03: Token Provider Composition & Hardened Base URL
  // ==========================================================================
  describe('LINE-01 & LINE-03: Token Provider & Base URL Hardening', () => {
    it('LineChannelTokenProvider enforces https://api.line.me in normal dev/prod without test boundary', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalE2E = process.env.HORPLUS_E2E;
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.HORPLUS_E2E;

        const provider = new LineChannelTokenProvider('http://attacker-controlled.site');
        expect(provider.baseUrl).toBe('https://api.line.me');
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalE2E) process.env.HORPLUS_E2E = originalE2E;
      }
    });

    it('LineOaService constructor correctly selects provider based on adapter type', () => {
      const mockAdapter = new MockLinePlatformAdapter();
      const serviceMock = new LineOaService(prisma, mockAdapter);
      expect((serviceMock as any).tokenProvider).toBeInstanceOf(FakeLineTokenProvider);

      const httpAdapter = new HttpLinePlatformAdapter();
      const serviceHttp = new LineOaService(prisma, httpAdapter);
      expect((serviceHttp as any).tokenProvider).toBeInstanceOf(LineChannelTokenProvider);
    });
  });

  // ==========================================================================
  // 3. LINE-02: Fail-Closed Webhook Active
  // ==========================================================================
  describe('LINE-02: Webhook Active Fails Closed', () => {
    it('test webhook endpoint returns NOT READY when getWebhookEndpoint returns inactive or null', async () => {
      const mockAdapter = new MockLinePlatformAdapter();
      mockAdapter.storedWebhookActive = false; // Inactive on LINE platform

      const tokenProvider = new FakeLineTokenProvider();
      const lineOaService = new LineOaService(prisma, mockAdapter, tokenProvider);

      // Set credentials first
      await lineOaService.updateDormitoryLineConfig(ownerADormId, {
        channelId: '1650000002',
        channelSecret: 'test_secret_123',
      });
      await lineOaService.setWebhookEndpoint(ownerADormId);

      const result = await lineOaService.testWebhookEndpoint(ownerADormId);
      expect(result.testResult.success).toBe(true);
      expect(result.config.webhookActive).toBe(false);
      expect(result.config.isReady).toBe(false);
    });
  });

  // ==========================================================================
  // 4. TRIAL-01 & PROMO-01: Concurrent Double-Trial and HORPLUS Race Closure
  // ==========================================================================
  describe('TRIAL-01 & PROMO-01: Concurrent Benefit Races Protected by Advisory Locks', () => {
    it('Concurrent finalization of two provisional dormitories for same user grants trial and HORPLUS promo to exactly ONE dormitory', async () => {
      // Create user for concurrency test
      const raceUserId = crypto.randomUUID();
      const raceEmail = `race_user_${Date.now()}@test.com`;
      await prisma.user.create({
        data: {
          id: raceUserId,
          email: raceEmail,
          emailNormalized: raceEmail.toLowerCase(),
          name: 'Concurrent Race Owner',
          googleSubject: `goog_sub_${raceUserId}`,
        },
      });

      // Prepare two separate provisional dormitories
      const dorm1Prep = await provisioningService.prepareProvisionalDormitory(raceUserId, { name: 'Race Dormitory Alpha' });
      const dorm2Prep = await provisioningService.prepareProvisionalDormitory(raceUserId, { name: 'Race Dormitory Beta' });

      // Save Owner signature on both provisional dormitories
      const pngObj = new PNG({ width: 16, height: 16 });
      for (let i = 0; i < pngObj.data.length; i += 4) {
        pngObj.data[i] = 0;
        pngObj.data[i + 1] = 0;
        pngObj.data[i + 2] = 0;
        pngObj.data[i + 3] = 255;
      }
      const validPngBuffer = PNG.sync.write(pngObj);

      const signatureStorageService = new (await import('../../services/signature-storage.service.js')).SignatureStorageService(prisma);
      await signatureStorageService.saveSignature({ dormitoryId: dorm1Prep.provisionalDormitoryId, userId: raceUserId, buffer: validPngBuffer });
      await signatureStorageService.saveSignature({ dormitoryId: dorm2Prep.provisionalDormitoryId, userId: raceUserId, buffer: validPngBuffer });

      // Configure LINE OA readiness on both dormitories under RLS context
      const nowTime = new Date();
      for (const dId of [dorm1Prep.provisionalDormitoryId, dorm2Prep.provisionalDormitoryId]) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dId}, true)`;
          await tx.dormitoryLineConfig.update({
            where: { dormitoryId: dId },
            data: {
              channelId: '1650000009',
              channelSecretEncrypted: 'mock_enc_secret',
              accessTokenVerifiedAt: nowTime,
              webhookEndpointSetAt: nowTime,
              webhookTestSucceededAt: nowTime,
              webhookActive: true,
              isConnected: true,
            },
          });
        });
      }

      const paidPkg = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(paidPkg).not.toBeNull();

      const finalizeDorm = async (dormId: string, name: string) => {
        return await provisioningService.completeOwnerOnboarding({
          userId: raceUserId,
          idempotencyKey: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          provisionalDormitoryId: dormId,
          planCode: 'PAID',
          packageId: paidPkg!.id,
          promoCode: 'HORPLUS',
          dormitory: {
            name,
            type: 'apartment',
            addressLine1: '123 Test St',
            province: 'Bangkok',
          },
          billing: { billingDay: 25, dueDay: 5, waterRate: '18.00', electricityRate: '7.00' },
          payment: { promptPayType: 'national_id', promptPayValue: '1234567890123' },
          buildings: [{ id: `bld-${dormId}`, name: 'Building 1', floorsCount: 1, roomsPerFloor: 1 }],
          rooms: [{ buildingId: `bld-${dormId}`, roomNumber: '101', floor: 1, monthlyRent: 3000, depositAmount: 3000, status: 'VACANT' }],
        });
      };

      // Execute both finalizations CONCURRENTLY
      const results = await Promise.allSettled([
        finalizeDorm(dorm1Prep.provisionalDormitoryId, 'Race Dormitory Alpha'),
        finalizeDorm(dorm2Prep.provisionalDormitoryId, 'Race Dormitory Beta'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      expect(fulfilled.length).toBe(1);
      expect(fulfilled[0].value.totalTrialMonths).toBe(3);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason?.code || rejected[0].reason?.message).toMatch(/PROMO_ALREADY_REDEEMED/);

      // Assert exactly ONE AccountBenefitClaim exists
      const totalClaims = await prisma.accountBenefitClaim.count({
        where: { userId: raceUserId, benefitKey: 'INITIAL_TRIAL_V1' },
      });
      expect(totalClaims).toBe(1);

      // Assert exactly ONE PromoRedemption exists
      const totalRedemptions = await prisma.promoRedemption.count({
        where: { redeemedBy: raceUserId },
      });
      expect(totalRedemptions).toBe(1);
    });

    it('PromoService strictly validates benefit fields and rejects invalid configs without falling back to 2 months', async () => {
      const invalidPromoCode = 'INVALID_BENEFIT_PROMO';
      await prisma.promoCode.upsert({
        where: { code: invalidPromoCode },
        create: {
          code: invalidPromoCode,
          normalizedCode: invalidPromoCode,
          benefitType: 'UNKNOWN_TYPE',
          benefitUnit: 'DAYS',
          benefitValue: 0,
          enabled: true,
        },
        update: {
          benefitType: 'UNKNOWN_TYPE',
          benefitUnit: 'DAYS',
          benefitValue: 0,
          enabled: true,
        },
      });

      const result = await promoService.validatePromo(invalidPromoCode);
      expect(result.valid).toBe(false);
      expect(result.eligible).toBe(false);
      expect(result.errorCode).toBe('PROMO_CONFIGURATION_INVALID');
      expect(result.promoBonusMonths).toBe(0);
    });

    it('PromoService preview rejects trial/promo months when account initial trial is already claimed', async () => {
      const claimUserId = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: claimUserId,
          email: `${claimUserId}@example.com`,
          emailNormalized: `${claimUserId}@example.com`,
          name: 'Trial Claimed User',
          googleSubject: `sub-claim-${Date.now()}`,
          status: 'active',
        },
      });

      const claimDorm = await prisma.dormitory.create({
        data: {
          name: 'Claimed Dorm 1',
          code: `DM-CLM-${Date.now()}`,
          createdByUserId: claimUserId,
          status: 'active',
        },
      });

      await prisma.accountBenefitClaim.create({
        data: {
          userId: claimUserId,
          benefitKey: 'INITIAL_TRIAL_V1',
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
          dormitoryId: claimDorm.id,
        },
      });

      const previewResult = await promoService.validatePromo('HORPLUS', claimUserId);
      expect(previewResult.valid).toBe(true);
      expect(previewResult.eligible).toBe(true);
      expect(previewResult.trialMonths).toBe(0);
      expect(previewResult.promoBonusMonths).toBe(2);
      expect(previewResult.totalTrialMonths).toBe(2);
    });

    it('redeemPromoCode endpoint requires catalog PromoCode definition and enforces account-level uniqueness & initial trial rule', async () => {
      const testUser = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: testUser,
          email: `${testUser}@example.com`,
          emailNormalized: `${testUser}@example.com`,
          name: 'Redeem Test User',
          googleSubject: `sub-rdm-${Date.now()}`,
          status: 'active',
        },
      });

      const testDorm = await prisma.dormitory.create({
        data: {
          name: 'Redeem Test Dorm 1',
          code: `DM-RDM-${Date.now()}`,
          createdByUserId: testUser,
          status: 'active',
        },
      });
      await subscriptionEntitlementService.provisionInitialTrial(testDorm.id);

      await expect(
        subscriptionEntitlementService.redeemPromoCode({
          dormitoryId: testDorm.id,
          code: 'UNCATALOGUED_CODE',
          userId: testUser,
          idempotencyKey: `idemp-uncat-${Date.now()}`,
        })
      ).rejects.toThrow(/PROMO_CATALOG_NOT_CONFIGURED/);

      await prisma.promoCode.upsert({
        where: { code: 'HORPLUS' },
        create: {
          code: 'HORPLUS',
          normalizedCode: 'HORPLUS',
          benefitType: 'TRIAL_EXTENSION',
          benefitUnit: 'MONTH',
          benefitValue: 2,
          enabled: true,
        },
        update: {
          benefitType: 'TRIAL_EXTENSION',
          benefitUnit: 'MONTH',
          benefitValue: 2,
          enabled: true,
        },
      });

      await prisma.accountBenefitClaim.create({
        data: {
          userId: testUser,
          benefitKey: 'INITIAL_TRIAL_V1',
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
          dormitoryId: testDorm.id,
        },
      });

      const redeemedResult = await subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: testDorm.id,
        code: 'HORPLUS',
        userId: testUser,
        idempotencyKey: `idemp-rdm1-${Date.now()}`,
      });
      expect(redeemedResult).toBeDefined();

      const testDorm2 = await prisma.dormitory.create({
        data: {
          name: 'Redeem Test Dorm 2',
          code: `DM-RDM2-${Date.now()}`,
          createdByUserId: testUser,
          status: 'active',
        },
      });
      await subscriptionEntitlementService.provisionInitialTrial(testDorm2.id);

      await expect(
        subscriptionEntitlementService.redeemPromoCode({
          dormitoryId: testDorm2.id,
          code: 'HORPLUS',
          userId: testUser,
          idempotencyKey: `idemp-rdm2-${Date.now()}`,
        })
      ).rejects.toThrow(/already been redeemed/);
    });

    it('proves REAL concurrent prepareProvisionalDormitory calls resolve to exact same provisionalDormitoryId with zero orphan records', async () => {
      const concUser = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: concUser,
          email: `${concUser}@example.com`,
          emailNormalized: `${concUser}@example.com`,
          name: 'Conc Prepare User',
          googleSubject: `sub-cnc-${Date.now()}`,
          status: 'active',
        },
      });

      const [prep1, prep2] = await Promise.all([
        provisioningService.prepareProvisionalDormitory(concUser, { name: 'Concurrent Dorm Alpha' }),
        provisioningService.prepareProvisionalDormitory(concUser, { name: 'Concurrent Dorm Beta' }),
      ]);

      expect(prep1.provisionalDormitoryId).toBeDefined();
      expect(prep2.provisionalDormitoryId).toBeDefined();
      expect(prep1.provisionalDormitoryId).toBe(prep2.provisionalDormitoryId);

      const pendingCount = await prisma.dormitory.count({
        where: { createdByUserId: concUser, status: 'setup_pending' },
      });
      expect(pendingCount).toBe(1);

      const memberCount = await prisma.dormitoryMember.count({
        where: { userId: concUser },
      });
      expect(memberCount).toBe(1);
    });

    it('OnboardingService.getDraft returns signatureSaved: false when unsigned and signatureSaved: true when signed', async () => {
      const sigUser = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: sigUser,
          email: `${sigUser}@example.com`,
          emailNormalized: `${sigUser}@example.com`,
          name: 'Sig Test User',
          googleSubject: `sub-sig-${Date.now()}`,
          status: 'active',
        },
      });

      const onboardingService = new OnboardingService(prisma);
      const prep = await provisioningService.prepareProvisionalDormitory(sigUser, { name: 'Sig Test Dorm' });
      await onboardingService.saveDraft(sigUser, 'signature', { dormitoryName: 'Sig Test Dorm' }, prep.provisionalDormitoryId);

      // CASE 1 — UNSIGNED RESUME
      const draftUnsigned = await onboardingService.getDraft(sigUser);
      expect(draftUnsigned?.signatureSaved).toBe(false);

      // CASE 2 — SIGNED RESUME
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prep.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prep.provisionalDormitoryId,
            signedByUserId: sigUser,
            objectKey: `signatures/${prep.provisionalDormitoryId}/sig.png`,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            byteSize: 100,
            isCurrent: true,
          },
        });
      });

      const draftSigned = await onboardingService.getDraft(sigUser);
      expect(draftSigned?.signatureSaved).toBe(true);

      // CASE 3 — SERVER AUTHORITY (Finalize without DB signature throws OWNER_SIGNATURE_REQUIRED)
      const unsignedUser = crypto.randomUUID();
      await prisma.user.create({
        data: {
          id: unsignedUser,
          email: `${unsignedUser}@example.com`,
          emailNormalized: `${unsignedUser}@example.com`,
          name: 'Unsigned Finalize User',
          googleSubject: `sub-unsig-${Date.now()}`,
          status: 'active',
        },
      });
      const unsignedPrep = await provisioningService.prepareProvisionalDormitory(unsignedUser, { name: 'Unsigned Dorm' });
      await expect(
        provisioningService.completeOwnerOnboarding({
          userId: unsignedUser,
          idempotencyKey: `idemp-unsig-${Date.now()}`,
          provisionalDormitoryId: unsignedPrep.provisionalDormitoryId,
          planCode: 'FREE',
          dormitory: {
            name: 'Unsigned Dorm',
            addressLine1: '123 Test St',
            province: 'Bangkok',
            postalCode: '10110',
          },
          buildings: [{ id: `bld-${unsignedPrep.provisionalDormitoryId}`, name: 'อาคาร A', floorsCount: 1 }],
          rooms: [{ buildingId: `bld-${unsignedPrep.provisionalDormitoryId}`, roomNumber: '101', floor: 1, monthlyRent: 3000, depositAmount: 3000, status: 'vacant' }],
        })
      ).rejects.toThrow(/กรุณาบันทึกลายเซ็นเจ้าของหอพัก/);
    });
  });
});
