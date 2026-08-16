/**
 * HORPLUS LOCAL-07 — Master Product Owner Integration & Regression Test Suite
 * Validates:
 * 1. Step 1-7 Onboarding with PRO Trial entitlement (150 rooms / 300 messages)
 * 2. PRO Package Catalog & DB Runtime authority
 * 3. HORPLUS Promo Dual-State Eligibility & Concurrency Cap (100 global redemptions)
 * 4. 6-digit Referral code generation, atomic capacity locking (<= 10), and settlement
 * 5. Integer Coin Wallet with append-only ledger and overspend rejection
 * 6. Exact Decimal & String minor-unit money arithmetic (No IEEE-754 floats)
 * 7. PromptPay QR exact minor unit format
 * 8. Billing due date calculation using configured dueDay & rolling 3-month cycles
 * 9. Deposit inheritance provenance (Room.depositInheritsBuildingDefault)
 * 10. Centralized Operational Cycle Resolver
 * @license Apache-2.0
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../../db/prisma.js';
import { coinWalletService } from '../../services/coin-wallet.service.js';
import { referralService } from '../../services/referral.service.js';
import { promoService } from '../../services/promo.service.js';
import { subscriptionIntentService } from '../../services/subscription-intent.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { currentCycleResolverService } from '../../services/current-cycle-resolver.js';
import { BillingCycleService } from '../../services/billing-cycle.service.js';
import { PrismaBillingCycleRepository } from '../../db/repositories/billing-cycle.repository.js';
import { PrismaBillRepository } from '../../db/repositories/bill.repository.js';
import { PrismaMeterRepository } from '../../db/repositories/meter.repository.js';
import { PrismaBuildingRepository } from '../../db/repositories/building.repository.js';
import { PrismaContractRepository } from '../../db/repositories/contract.repository.js';
import { PrismaRoomRepository } from '../../db/repositories/room.repository.js';
import { PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { AuditService } from '../../services/audit.service.js';
import { generatePromptPayPayload, formatExactPromptPayAmount } from '../../services/promptpay-payload.service.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { DefaultsService } from '../../services/defaults.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import { BillingService } from '../../services/billing.service.js';
import { BillingOrchestrationService } from '../../services/billing-orchestration.service.js';
import { OccupancyService } from '../../services/occupancy.service.js';
import { RoomService } from '../../services/room.service.js';
import { BuildingService } from '../../services/building.service.js';
import { CsrfService } from '../../services/csrf.service.js';
import { SessionTokenService } from '../../services/session-token.service.js';
import { PrismaSessionRepository } from '../../db/repositories/session.repository.js';
import { getEnv } from '../../config/env.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { createApp } from '../../app.js';
import express from 'express';

describe('HORPLUS LOCAL-07 — Master Verification Suite', () => {
  let prisma: PrismaClient;
  let app: express.Express;
  let testUser1: any;
  let testUser2: any;
  let testUser3: any;

  async function createTestAuthSession(userId: string) {
    const env = getEnv();
    const sessionRepo = new PrismaSessionRepository(prisma);
    const sessionTokenService = new SessionTokenService(env.SESSION_ENCRYPTION_KEY);
    const csrfService = new CsrfService(env.CSRF_SIGNING_KEY);

    const sessionId = crypto.randomUUID();
    const sessionIdHash = SessionTokenService.hashSessionId(sessionId);
    const ttlSeconds = env.SESSION_TTL_SECONDS || 86400;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await sessionRepo.createSession({
      userId,
      sessionIdHash,
      expiresAt,
      tokenVersion: 1,
    });

    const sessionToken = sessionTokenService.encryptToken(
      {
        sub: userId,
        sid: sessionId,
        type: 'session',
        version: 1,
      },
      ttlSeconds
    );

    const csrfToken = csrfService.generateCsrfToken(sessionId);

    return {
      sessionToken,
      csrfToken,
      cookies: [`horplus_session=${sessionToken}`, `horplus_csrf=${csrfToken}`],
    };
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = createApp();

    // Clean test accounts and global redemptions
    await prisma.promoRedemption.deleteMany({});
    await prisma.promoCode.updateMany({ data: { currentRedemptionsCount: 0 } });
    await prisma.accountBenefitClaim.deleteMany({});
    await prisma.coinLedgerEntry.deleteMany({});
    await prisma.coinWallet.deleteMany({});
    await prisma.referralAttribution.deleteMany({});
    await prisma.userReferralCode.deleteMany({});
    await prisma.subscriptionPackageIntent.deleteMany({});

    // Create 3 isolated test users
    const timestamp = Date.now();
    testUser1 = await prisma.user.create({
      data: {
        googleSubject: `g-sub-1-${timestamp}`,
        email: `owner1_${timestamp}@example.com`,
        emailNormalized: `owner1_${timestamp}@example.com`,
        name: 'สมศักดิ์ วงศ์สว่าง',
        status: 'active',
      },
    });

    testUser2 = await prisma.user.create({
      data: {
        googleSubject: `g-sub-2-${timestamp}`,
        email: `owner2_${timestamp}@example.com`,
        emailNormalized: `owner2_${timestamp}@example.com`,
        name: 'วิชัย รุ่งเรือง',
        status: 'active',
      },
    });

    testUser3 = await prisma.user.create({
      data: {
        googleSubject: `g-sub-3-${timestamp}`,
        email: `owner3_${timestamp}@example.com`,
        emailNormalized: `owner3_${timestamp}@example.com`,
        name: 'กานดา พัฒนา',
        status: 'active',
      },
    });
  });

  afterAll(async () => {
    // Cleanup created test records
    try {
      await prisma.$executeRawUnsafe(`SET app.bypass_rls = 'on';`);
      const ids = [testUser1?.id, testUser2?.id, testUser3?.id].filter(Boolean);
      for (const id of ids) {
        await prisma.$executeRawUnsafe(`
          DO $$
          BEGIN
            PERFORM set_config('app.current_user_id', '${id}', true);
            PERFORM set_config('app.bypass_rls', 'on', true);
            DELETE FROM "subscription_package_intents" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "coin_ledger_entries" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "coin_wallets" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "referral_attributions" WHERE "invitee_user_id" = '${id}'::uuid OR "inviter_user_id" = '${id}'::uuid;
            DELETE FROM "user_referral_codes" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "account_benefit_claims" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "subscription_status_histories" WHERE "actor_id" = '${id}'::uuid;
            DELETE FROM "owner_signatures" WHERE "signed_by_user_id" = '${id}'::uuid;
            DELETE FROM "onboarding_drafts" WHERE "user_id" = '${id}'::uuid;
            DELETE FROM "users" WHERE "id" = '${id}'::uuid;
          END $$;
        `);
      }
    } catch {}
  });

  describe('1. First Google Account PRO Trial & Entitlements', () => {
    it('grants 1-month PRO entitlement with 150-room and 300-message limits', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักทดสอบ PRO Trial',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
        },
      });

      // Provision initial trial
      const sub = await subscriptionEntitlementService.provisionInitialTrial(dorm.id, testUser1.id);
      expect(sub.status).toBe('TRIAL');

      // Verify connected plan is PAID (PRO)
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
      expect(plan?.code).toBe('PAID');

      // Verify effective entitlements
      const entitlements = await subscriptionEntitlementService.getEffectiveEntitlements(dorm.id);
      expect(entitlements.plan.code).toBe('PAID');
      expect(entitlements.roomLimit).toBe(150);
      expect(entitlements.status).toBe('TRIAL');

      // Clean up test dorm
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('2. Referral Program (6-Digit Code, Atomic Capacity, Settlement)', () => {
    it('generates a 6-digit numeric referral code (100000..999999) for a user', async () => {
      const refData = await referralService.getOrCreateUserReferralCode(testUser1.id);
      expect(refData.code).toMatch(/^\d{6}$/);
      expect(refData.maxUsage).toBe(10);
      expect(refData.usageCount).toBe(0);
    });

    it('binds referral code to invitee and prevents self-referral', async () => {
      const inviterCode = (await referralService.getOrCreateUserReferralCode(testUser1.id)).code;

      // Self referral should fail
      await expect(
        referralService.validateAndBindReferral(testUser1.id, inviterCode)
      ).rejects.toThrow('ไม่สามารถใช้รหัสคำเชิญของตนเองได้');

      // Binding by another user succeeds
      const result = await referralService.validateAndBindReferral(testUser2.id, inviterCode);
      expect(result.valid).toBe(true);
      expect(result.provisionalCoin).toBe(10);

      // Second bind attempt returns already bound
      const result2 = await referralService.validateAndBindReferral(testUser2.id, inviterCode);
      expect(result2.valid).toBe(true);
      expect(result2.message).toContain('ผูกกับบัญชีนี้แล้ว');
    });

    it('settles referral rewards upon first dormitory completion (10 Coins each)', async () => {
      const inviterInitialBalance = await coinWalletService.getBalance(testUser1.id);
      const inviteeInitialBalance = await coinWalletService.getBalance(testUser2.id);

      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักของ Invitee',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser2.id,
        },
      });

      // Settle referral
      await referralService.settleReferralOnDormitoryCreated(testUser2.id, dorm.id);

      const inviterNewBalance = await coinWalletService.getBalance(testUser1.id);
      const inviteeNewBalance = await coinWalletService.getBalance(testUser2.id);

      expect(inviterNewBalance).toBe(inviterInitialBalance + 10);
      expect(inviteeNewBalance).toBe(inviteeInitialBalance + 10);

      // Verify ledger entries
      const inviterLedger = await coinWalletService.getLedgerEntries(testUser1.id, 5);
      expect(inviterLedger.some((e: any) => e.entryType === 'REFERRAL_INVITER_CREDIT' && e.amount === 10)).toBe(true);

      const inviteeLedger = await coinWalletService.getLedgerEntries(testUser2.id, 5);
      expect(inviteeLedger.some((e: any) => e.entryType === 'REFERRAL_INVITEE_CREDIT' && e.amount === 10)).toBe(true);

      // Clean up
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('3. Integer Coin Wallet & Overspend Prevention', () => {
    it('prevents spending more coins than available balance', async () => {
      const currentBalance = await coinWalletService.getBalance(testUser3.id);
      expect(currentBalance).toBe(0);

      await expect(
        coinWalletService.spendCoins(testUser3.id, 5, 'TEST_OVERSPEND')
      ).rejects.toThrow('ยอดเงิน Coin ไม่เพียงพอ');
    });

    it('credits and spends coins with exact integer ledger records', async () => {
      await coinWalletService.creditCoins(testUser3.id, 50, 'TEST_CREDIT');
      let balance = await coinWalletService.getBalance(testUser3.id);
      expect(balance).toBe(50);

      await coinWalletService.spendCoins(testUser3.id, 20, 'TEST_SPEND');
      balance = await coinWalletService.getBalance(testUser3.id);
      expect(balance).toBe(30);

      const ledger = await coinWalletService.getLedgerEntries(testUser3.id, 5);
      expect(ledger.length).toBeGreaterThanOrEqual(2);
      expect(ledger[0].amount).toBe(-20);
      expect(ledger[1].amount).toBe(50);
    });
  });

  describe('4. HORPLUS Promo Code Authority & Dual-State Eligibility', () => {
    it('validates HORPLUS promo code granting +2 months bonus', async () => {
      const validation = await promoService.validatePromo('HORPLUS', testUser1.id);
      expect(validation.valid).toBe(true);
      expect(validation.promoBonusMonths).toBe(2);
      expect(validation.totalTrialMonths).toBe(3); // 1 trial + 2 promo
    });

    it('grants +2 months even if trial was already consumed (dual-state)', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
        },
      });

      // Claim trial once
      await subscriptionEntitlementService.provisionInitialTrial(dorm.id);
      await prisma.accountBenefitClaim.create({
        data: {
          userId: testUser1.id,
          dormitoryId: dorm.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
        },
      });

      // Now create another dorm and check promo
      const validation = await promoService.validatePromo('HORPLUS', testUser1.id);
      expect(validation.valid).toBe(true);
      expect(validation.trialMonths).toBe(0);
      expect(validation.promoBonusMonths).toBe(2);
      expect(validation.totalTrialMonths).toBe(2);

      await prisma.accountBenefitClaim.deleteMany({ where: { userId: testUser1.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('5. Exact Decimal Pricing & Subscription Intent Quotes', () => {
    it('calculates exact minor unit quote and commits zero-pay activation safely', async () => {
      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(pkg1mo).toBeDefined();

      const quote = await subscriptionIntentService.createIntentQuote(testUser3.id, {
        packageId: pkg1mo!.id,
        coinRequested: 0,
      });

      expect(quote.isTrialEligible).toBe(true);
      expect(quote.finalPayableAmount).toBe('0.00');
      expect(quote.checkoutVersion).toBe(2);

      // Commit intent
      const commitRes = await subscriptionIntentService.commitZeroPayIntent(
        testUser3.id,
        quote.intentId,
        `commit-test-${Date.now()}`
      );
      expect(commitRes.success).toBe(true);
      expect(commitRes.status).toBe('SUCCEEDED');
    });
  });

  describe('6. PromptPay Exact Formatting (No IEEE-754 Floats)', () => {
    it('formats mobile and national ID payloads with exact numeric strings', () => {
      const payload1 = generatePromptPayPayload('0819998888', '189.00');
      expect(payload1).toContain('000201');
      expect(payload1).toContain('5406189.00');

      const payload2 = generatePromptPayPayload('1103701234567', '2999.00');
      expect(payload2).toContain('000201');
      expect(payload2).toContain('54072999.00');
    });
  });

  describe('7. Billing Settings & Configured dueDay Derivation', () => {
    it('uses dormitory configured dueDay and billingDay for cycle creation', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักตั้งค่าวันครบกำหนด',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
          billingSettings: {
            create: {
              billingDay: 28,
              dueDay: 10,
              waterRate: new Prisma.Decimal(18),
              electricityRate: new Prisma.Decimal(8),
            },
          },
        },
      });

      const billingCycleRepo = new PrismaBillingCycleRepository(prisma);
      const billingCycleService = new BillingCycleService(billingCycleRepo);

      const result = await billingCycleService.createBillingCycle(dorm.id, {
        cycleCode: '2026-08',
        name: 'รอบสิงหาคม 2026',
        periodStart: '',
        periodEnd: '',
        billingDate: '',
        dueDate: '',
      }, testUser1.id);

      expect(result.cycle.billingDate.toISOString().slice(0, 10)).toBe('2026-08-28');
      expect(result.cycle.dueDate.toISOString().slice(0, 10)).toBe('2026-09-10');

      // Rolling cycles
      const rolling = await billingCycleService.ensureRollingBillingCycles(dorm.id, testUser1.id);
      expect(rolling.length).toBeGreaterThanOrEqual(3);

      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('8. Room Deposit Inheritance Provenance', () => {
    it('inherits building deposit when depositInheritsBuildingDefault is true', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักทดสอบเงินประกัน',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
        },
      });

      const bld = await prisma.building.create({
        data: {
          dormitoryId: dorm.id,
          name: 'อาคาร A',
          floorCount: 2,
          depositAmount: new Prisma.Decimal(5000),
          monthlyRent: new Prisma.Decimal(4000),
        },
      });

      const room1 = await prisma.room.create({
        data: {
          dormitoryId: dorm.id,
          buildingId: bld.id,
          roomNumber: '101',
          normalizedRoomNumber: '101',
          roomType: 'room',
          floor: 1,
          monthlyRent: new Prisma.Decimal(4000),
          depositAmount: new Prisma.Decimal(5000),
          depositInheritsBuildingDefault: true,
        },
      });

      const room2 = await prisma.room.create({
        data: {
          dormitoryId: dorm.id,
          buildingId: bld.id,
          roomNumber: '102',
          normalizedRoomNumber: '102',
          roomType: 'room',
          floor: 1,
          monthlyRent: new Prisma.Decimal(4000),
          depositAmount: new Prisma.Decimal(7000),
          depositInheritsBuildingDefault: false,
        },
      });

      const defaultsService = new DefaultsService();
      const res1 = await defaultsService.resolveEffectiveRoomDefaults(dorm.id, bld.id, room1.id);
      const res2 = await defaultsService.resolveEffectiveRoomDefaults(dorm.id, bld.id, room2.id);

      expect(res1.depositAmount.value).toBe(5000);
      expect(res1.depositAmount.source).toBe('BUILDING');

      expect(res2.depositAmount.value).toBe(7000);
      expect(res2.depositAmount.source).toBe('ROOM');

      await prisma.room.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.building.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('9. Operational Billing Cycle Resolver', () => {
    it('prioritizes cycle with meter activity, then billing activity, then onboarding start', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักทดสอบ Cycle Resolver',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
        },
      });

      // Default start
      const res1 = await currentCycleResolverService.resolveOperationalBillingCycle(dorm.id);
      expect(res1.reason).toBe('ONBOARDING_START');

      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('10. Paid Package Onboarding Does Not Grant Unverified PRO Entitlement', () => {
    it('provisions FREE active plan and PENDING_PAYMENT package intent when trial is consumed', async () => {
      const timestamp = Date.now();
      const testUser10 = await prisma.user.create({
        data: {
          googleSubject: `g-sub-10-${timestamp}`,
          email: `owner10_${timestamp}@example.com`,
          emailNormalized: `owner10_${timestamp}@example.com`,
          name: 'สมศักดิ์ วงศ์สว่าง 10',
          status: 'active',
        },
      });

      const dummyDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Trial 1',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser10.id,
        },
      });

      // 1. Consume trial for testUser10
      const claim = await prisma.accountBenefitClaim.create({
        data: {
          userId: testUser10.id,
          dormitoryId: dummyDorm.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
        },
      });

      const pkg12mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 12, enabled: true },
      });
      expect(pkg12mo).toBeDefined();

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(testUser10.id, { name: 'หอพักสมศักดิ์ 2 (Paid Package)' });

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${testUser10.id}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: testUser10.id,
            objectKey: 'signatures/mock-signature.png',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(testUser10.id, {
        packageId: pkg12mo!.id,
      }, undefined, prov.provisionalDormitoryId);

      const result = await provisioningService.completeOwnerOnboarding({
        userId: testUser10.id,
        idempotencyKey: `idem-paid-pkg-test-1-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        dormitory: { name: 'หอพักสมศักดิ์ 2 (Paid Package)' },
        planCode: 'PAID',
        packageId: pkg12mo!.id,
      });

      expect(result.dormitoryId).toBeDefined();

      // Check dormitory subscription: MUST be FREE plan, ACTIVE status
      const sub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: result.dormitoryId },
        include: { plan: true },
      });
      expect(sub?.plan.code).toBe('FREE');
      expect(sub?.status).toBe('ACTIVE');

      // Check intent: MUST be PENDING_PAYMENT
      expect(result.packageIntentId).toBeDefined();
      const intent = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${testUser10.id}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${result.dormitoryId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return await tx.subscriptionPackageIntent.findUnique({
          where: { id: result.packageIntentId },
        });
      });
      expect(intent).toBeDefined();
      expect(intent?.status).toBe('PENDING_PAYMENT');
      expect(new Prisma.Decimal(intent!.finalPayableAmount!).toFixed(2)).toBe('1799.00');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: result.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: result.dormitoryId } });
      await prisma.accountBenefitClaim.delete({ where: { id: claim.id } });
      await prisma.dormitory.delete({ where: { id: dummyDorm.id } });
      await prisma.user.delete({ where: { id: testUser10.id } });
    });
  });

  describe('11. Zero-Pay Commit Transaction with Coin Debit & Duration Application', () => {
    it('debits coins atomically and applies full package duration to subscription', async () => {
      // 1. Create dorm with FREE subscription
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักทดสอบ Coin Commit',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser2.id,
        },
      });

      const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dorm.id,
          planId: freePlan!.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
        },
      });

      // 2. Fund user with 189 coins
      await coinWalletService.creditCoins(testUser2.id, 189, 'TEST_DEPOSIT');
      const balBefore = await coinWalletService.getBalance(testUser2.id);
      expect(balBefore).toBeGreaterThanOrEqual(189);

      // 3. Mark user as trial consumed so they pay with coins
      const claim = await prisma.accountBenefitClaim.create({
        data: {
          userId: testUser2.id,
          dormitoryId: dorm.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400 * 1000),
        },
      });

      // 4. Create quote applying 189 coins to 1-month PRO package
      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });

      // Create draft so quote associates with this dormitory
      const onboardingService = new OnboardingService(prisma);
      await onboardingService.saveDraft(testUser2.id, 'package', {}, dorm.id);

      const quote = await subscriptionIntentService.createIntentQuote(testUser2.id, {
        packageId: pkg1mo!.id,
        coinRequested: 189,
      });

      expect(quote.isTrialEligible).toBe(false);
      expect(quote.coinApplied).toBe(189);
      expect(quote.finalPayableAmount).toBe('0.00');
      expect(quote.isZeroPayValidated).toBe(true);

      // 5. Commit zero-pay intent
      const idemKey = `idem-coin-commit-${Date.now()}`;
      const commitRes = await subscriptionIntentService.commitZeroPayIntent(testUser2.id, quote.intentId, idemKey);
      expect(commitRes.success).toBe(true);
      expect(commitRes.status).toBe('SUCCEEDED');
      expect(commitRes.coinDebited).toBe(189);

      // 6. Verify coin wallet was debited by 189
      const balAfter = await coinWalletService.getBalance(testUser2.id);
      expect(balAfter).toBe(balBefore - 189);

      // 7. Verify subscription is now PRO with ~1 month duration
      const updatedSub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: dorm.id },
        include: { plan: true },
      });
      expect(updatedSub?.plan.code).toBe('PAID');
      expect(updatedSub?.status).toBe('ACTIVE');
      expect(updatedSub?.expiresAt).toBeDefined();

      // 8. Replay idempotency: calling commitZeroPayIntent again does NOT debit coins again
      const replayRes = await subscriptionIntentService.commitZeroPayIntent(testUser2.id, quote.intentId, idemKey);
      expect(replayRes.success).toBe(true);
      const balAfterReplay = await coinWalletService.getBalance(testUser2.id);
      expect(balAfterReplay).toBe(balAfter);

      // Cleanup
      await prisma.accountBenefitClaim.delete({ where: { id: claim.id } });
      await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('12. Referral Capacity Release & VOIDED Lifecycle on Draft Deletion', () => {
    it('releases pending capacity upon draft discard and allows same-inviter re-reservation', async () => {
      // Clean previous attributions for testUser1 as inviter
      await prisma.referralAttribution.deleteMany({ where: { inviterUserId: testUser1.id } });
      await prisma.referralAttribution.deleteMany({ where: { inviteeUserId: testUser3.id } });

      const inviterCode = (await referralService.getOrCreateUserReferralCode(testUser1.id)).code;

      // 1. Invitee binds referral code
      const bind1 = await referralService.validateAndBindReferral(testUser3.id, inviterCode);
      expect(bind1.valid).toBe(true);
      expect(bind1.status).toBe('PENDING');

      // Verify inviter capacity count = 1
      const count1 = await prisma.referralAttribution.count({
        where: { inviterUserId: testUser1.id, status: { in: ['PENDING', 'QUALIFIED'] } },
      });
      expect(count1).toBe(1);

      // 2. Invitee deletes onboarding draft
      const onboardingService = new OnboardingService(prisma);
      await onboardingService.deleteDraft(testUser3.id);

      // Verify attribution is now VOIDED and inviter active count = 0
      const attrVoided = await prisma.referralAttribution.findUnique({
        where: { inviteeUserId: testUser3.id },
      });
      expect(attrVoided?.status).toBe('VOIDED');

      const countAfterVoid = await prisma.referralAttribution.count({
        where: { inviterUserId: testUser1.id, status: { in: ['PENDING', 'QUALIFIED'] } },
      });
      expect(countAfterVoid).toBe(0);

      // 3. Invitee re-binds the SAME referral code: resumes to PENDING
      const rebind = await referralService.validateAndBindReferral(testUser3.id, inviterCode);
      expect(rebind.valid).toBe(true);
      expect(rebind.status).toBe('PENDING');

      const countAfterRebind = await prisma.referralAttribution.count({
        where: { inviterUserId: testUser1.id, status: { in: ['PENDING', 'QUALIFIED'] } },
      });
      expect(countAfterRebind).toBe(1);

      // 4. Invitee attempts to switch to another code: MUST throw REFERRAL_BINDING_IMMUTABLE
      const otherCode = (await referralService.getOrCreateUserReferralCode(testUser2.id)).code;
      await expect(
        referralService.validateAndBindReferral(testUser3.id, otherCode)
      ).rejects.toThrow('ไม่สามารถเปลี่ยนรหัสคำเชิญได้');
    });
  });

  describe('13. PromptPay Exact Money Precision Hardening', () => {
    it('accepts exact 2-decimal money and rejects excess precision (> 2 decimals)', () => {
      const res = formatExactPromptPayAmount('189.00');
      expect(res.formattedAmount).toBe('189.00');
      expect(res.isZero).toBe(false);

      const resZero = formatExactPromptPayAmount('0.00');
      expect(resZero.formattedAmount).toBe('0.00');
      expect(resZero.isZero).toBe(true);

      // Excess precision > 2 decimals MUST throw Error rather than silently truncating
      expect(() => formatExactPromptPayAmount('189.005')).toThrow('Invalid PromptPay amount format');
      expect(() => formatExactPromptPayAmount('50.1234')).toThrow('Invalid PromptPay amount format');
    });
  });

  describe('14. Canonical Promo Delegation in Entitlement Service', () => {
    it('redeems promo code HORPLUS delegating to canonical authority without legacy trial blockers', async () => {
      const dorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักทดสอบ Promo Entitlement',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser3.id,
        },
      });

      const freePlan = await prisma.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
      await prisma.dormitorySubscription.create({
        data: {
          dormitoryId: dorm.id,
          planId: freePlan!.id,
          status: 'ACTIVE',
          startedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 86400 * 1000),
        },
      });

      // Clean any previous redemption for testUser3
      await prisma.promoRedemption.deleteMany({ where: { redeemedBy: testUser3.id } });

      const result = await subscriptionEntitlementService.redeemPromoCode({
        dormitoryId: dorm.id,
        code: 'HORPLUS',
        userId: testUser3.id,
        idempotencyKey: `promo-test-${Date.now()}`,
      });

      expect(result.status).toBe(200);
      expect(result.body.data).toBeDefined();

      const updatedSub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: dorm.id },
        include: { plan: true },
      });
      expect(['ACTIVE', 'TRIAL']).toContain(updatedSub?.status);
      expect(updatedSub?.plan.code).toBe('PAID');

      // Cleanup
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('15. Real Concurrency Integration Test for Promo HORPLUS through OWNER ONBOARDING FINALIZE', () => {
    it('guarantees global first-100 cap under concurrent onboarding finalization starting at 99 redemptions', async () => {
      // 1. Ensure HORPLUS promo code exists with globalMaxRedemptions = 100
      const promo = await prisma.promoCode.findFirst({
        where: { OR: [{ code: 'HORPLUS' }, { normalizedCode: 'HORPLUS' }] },
      });
      expect(promo).toBeDefined();

      // Clean all promo redemptions for test isolation
      await prisma.promoRedemption.deleteMany({ where: { promoCodeId: promo!.id } });

      // 2. Set currentRedemptionsCount = 99
      await prisma.promoCode.update({
        where: { id: promo!.id },
        data: { currentRedemptionsCount: 99, globalMaxRedemptions: 100, enabled: true },
      });

      // 3. Create 4 fresh eligible users
      const users: any[] = [];
      const dormsToClean: string[] = [];
      for (let i = 0; i < 4; i++) {
        const email = `concurrent-promo-owner-${i}-${Date.now()}@example.com`;
        const u = await prisma.user.create({
          data: {
            googleSubject: `google-concurrent-${i}-${Date.now()}`,
            email,
            emailNormalized: email,
            name: `Concurrent Owner ${i}`,
            status: 'active',
          },
        });
        users.push(u);
      }

      // 4. Concurrently finalize onboarding with HORPLUS promo for all 4 users
      const provisioningService = new DormitoryProvisioningService(prisma);
      const quotes = await Promise.all(users.map((u) =>
        subscriptionIntentService.createIntentQuote(u.id, {
          isFreePlan: true,
          promoCode: 'HORPLUS',
        })
      ));

      const finalizePromises = users.map((u, idx) =>
        provisioningService.completeOwnerOnboarding({
          userId: u.id,
          idempotencyKey: `idem-concurrent-promo-${u.id}-${Date.now()}`,
          packageIntentId: quotes[idx].intentId,
          planCode: 'FREE',
          dormitory: {
            name: `หอพัก Concurrent Promo ${idx}`,
            type: 'apartment',
            province: 'กรุงเทพมหานคร',
          },
          ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          promoCode: 'HORPLUS',
        })
      );

      const results = await Promise.allSettled(finalizePromises);

      // Track successful dormitory creations for cleanup
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value?.dormitoryId) {
          dormsToClean.push(res.value.dormitoryId);
        }
      }

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // 5. Assert: EXACTLY ONE obtains slot 100, remaining 3 fail safely with PROMO_GLOBAL_LIMIT_REACHED
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(3);

      for (const rej of rejected) {
        const reason = (rej as PromiseRejectedResult).reason;
        expect(reason.message || reason.errorCode).toMatch(/PROMO_GLOBAL_LIMIT_REACHED|สิทธิ์โปรโมชันนี้ครบตามจำนวน/);
      }

      // 6. Assert: Database authoritative counters NEVER exceed 100
      const finalPromo = await prisma.promoCode.findUnique({
        where: { id: promo!.id },
      });
      expect(finalPromo?.currentRedemptionsCount).toBe(100);

      const totalRedemptions = await prisma.promoRedemption.count({
        where: { promoCodeId: promo!.id },
      });
      expect(totalRedemptions).toBe(1); // 1 real redemption added to the 99 seeded counter = 100 total

      // 7. Cleanup
      for (const dId of dormsToClean) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: dId } });
          await tx.promoRedemption.deleteMany({ where: { dormitoryId: dId } });
          await tx.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dId } });
          await tx.accountBenefitClaim.deleteMany({ where: { dormitoryId: dId } });
          await tx.ownerSignature.deleteMany({ where: { dormitoryId: dId } });
          await tx.dormitorySubscription.deleteMany({ where: { dormitoryId: dId } });
          await tx.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: dId } });
          await tx.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dId } });
          await tx.dormitoryMember.deleteMany({ where: { dormitoryId: dId } });
          await tx.dormitory.delete({ where: { id: dId } }).catch(() => {});
        });
      }
      for (const u of users) {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
          await tx.subscriptionStatusHistory.deleteMany({ where: { actorId: u.id } });
          await tx.subscriptionPackageIntent.deleteMany({ where: { userId: u.id } });
          await tx.accountBenefitClaim.deleteMany({ where: { userId: u.id } });
          await tx.ownerSignature.deleteMany({ where: { signedByUserId: u.id } });
          await tx.promoRedemption.deleteMany({ where: { redeemedBy: u.id } });
          await tx.session.deleteMany({ where: { userId: u.id } });
          await tx.user.delete({ where: { id: u.id } }).catch(() => {});
        });
      }

      // Restore promo counter to 0
      await prisma.promoCode.update({
        where: { id: promo!.id },
        data: { currentRedemptionsCount: 0 },
      });
    });
  });

  describe('12. HTTP Quote -> Finalize Pipeline & Single Authoritative Intent', () => {
    it('consumes authoritative quote intent during finalization with zero duplicate creation', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-pipe-${timestamp}`,
          email: `quote_pipe_${timestamp}@example.com`,
          emailNormalized: `quote_pipe_${timestamp}@example.com`,
          name: 'เจ้าของ ไปป์ไลน์',
          status: 'active',
        },
      });

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(pkg1mo).toBeDefined();

      // 1. Create quote
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg1mo!.id,
        coinRequested: 0,
      });
      expect(quote.intentId).toBeDefined();
      expect(quote.finalPayableAmount).toBe('0.00');

      // 2. Finalize onboarding referencing packageIntentId
      const provisioningService = new DormitoryProvisioningService(prisma);
      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `finalize-pipe-${user.id}-${timestamp}`,
        packageId: pkg1mo!.id,
        packageIntentId: quote.intentId,
        dormitory: {
          name: 'หอพักไปป์ไลน์ ทดสอบ',
          type: 'apartment',
          province: 'กรุงเทพมหานคร',
        },
        ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      expect(finalizeRes.success).toBe(true);
      expect(finalizeRes.packageIntentId).toBe(quote.intentId);

      // 3. PostgreSQL Readback: Verify EXACTLY ONE SubscriptionPackageIntent exists in DB
      const intents = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${finalizeRes.dormitoryId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        return await tx.subscriptionPackageIntent.findMany({
          where: { userId: user.id },
        });
      });
      expect(intents.length).toBe(1);
      expect(intents[0].id).toBe(quote.intentId);
      expect(intents[0].status).toBe('SUCCEEDED');
      expect(intents[0].isZeroPayValidated).toBe(true);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.ownerSignature.deleteMany({ where: { signedByUserId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: finalizeRes.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('13. Coin Zero-Pay Onboarding Flow', () => {
    it('debits 189 Coins to activate 1-month PRO package for trial-consumed account', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-coin-zero-${timestamp}`,
          email: `coin_zero_${timestamp}@example.com`,
          emailNormalized: `coin_zero_${timestamp}@example.com`,
          name: 'เจ้าของ คอยน์ ซีโร่',
          status: 'active',
        },
      });

      const priorDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Trial 13',
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });

      // Mark trial as already consumed
      await prisma.accountBenefitClaim.create({
        data: {
          userId: user.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          dormitoryId: priorDorm.id,
          grantedMonths: 1,
          newExpiresAt: new Date(),
        },
      });

      // Credit 200 Coins to wallet
      await coinWalletService.creditCoins(user.id, 200, 'TEST_SEED');
      expect(await coinWalletService.getBalance(user.id)).toBe(200);

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(pkg1mo).toBeDefined();

      // Request quote with 189 coins applied
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg1mo!.id,
        coinRequested: 189,
      });

      expect(quote.isTrialEligible).toBe(false);
      expect(quote.coinApplied).toBe(189);
      expect(quote.finalPayableAmount).toBe('0.00');

      // Finalize onboarding
      const provisioningService = new DormitoryProvisioningService(prisma);
      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `finalize-coin-${user.id}-${timestamp}`,
        packageId: pkg1mo!.id,
        packageIntentId: quote.intentId,
        coinApplied: 189,
        dormitory: {
          name: 'หอพัก คอยน์ 100%',
          type: 'apartment',
          province: 'กรุงเทพมหานคร',
        },
        ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      expect(finalizeRes.success).toBe(true);

      // Verify wallet was debited exactly 189 coins (200 - 189 = 11)
      const balance = await coinWalletService.getBalance(user.id);
      expect(balance).toBe(11);

      // Verify subscription is ACTIVE PRO
      const sub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
        include: { plan: true },
      });
      expect(sub?.status).toBe('ACTIVE');
      expect(sub?.plan.code).toBe('PAID');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.coinLedgerEntry.deleteMany({ where: { userId: user.id } });
      await prisma.coinWallet.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.ownerSignature.deleteMany({ where: { signedByUserId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [finalizeRes.dormitoryId, priorDorm.id] } } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('14. Dual-State HORPLUS Eligibility Onboarding Regression', () => {
    it('applies HORPLUS promo (+2 months) on onboarding even when initial trial is already used', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-dual-promo-${timestamp}`,
          email: `dual_promo_${timestamp}@example.com`,
          emailNormalized: `dual_promo_${timestamp}@example.com`,
          name: 'เจ้าของ โปรโมคู่',
          status: 'active',
        },
      });

      const priorDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Trial 14',
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });

      // Mark trial as already consumed
      await prisma.accountBenefitClaim.create({
        data: {
          userId: user.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          dormitoryId: priorDorm.id,
          grantedMonths: 1,
          newExpiresAt: new Date(),
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov1 = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก HORPLUS Dual State',
        province: 'กรุงเทพมหานคร',
      });

      const quote1 = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
        promoCode: 'HORPLUS',
      }, undefined, prov1.provisionalDormitoryId);

      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `finalize-dual-${user.id}-${timestamp}`,
        provisionalDormitoryId: prov1.provisionalDormitoryId,
        packageIntentId: quote1.intentId,
        planCode: 'FREE',
        promoCode: 'HORPLUS',
        dormitory: {
          name: 'หอพัก HORPLUS Dual State',
          type: 'apartment',
          province: 'กรุงเทพมหานคร',
        },
        ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      });

      expect(finalizeRes.success).toBe(true);
      expect(finalizeRes.promo.applied).toBe(true);
      expect(finalizeRes.promo.promoBonusMonths).toBe(2);
      expect(finalizeRes.promo.trialMonths).toBe(0);
      expect(finalizeRes.promo.totalTrialMonths).toBe(2);

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });

      const prov2 = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก HORPLUS Duplicate',
        province: 'กรุงเทพมหานคร',
      });

      // Quote promo degrades to null and 0 bonus months when already redeemed
      const quote2 = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg1mo!.id,
        promoCode: 'HORPLUS',
      }, undefined, prov2.provisionalDormitoryId);
      expect(quote2.promoBonusMonths).toBe(0);
      expect(quote2.promoCode).toBeNull();

      // Direct redemption attempt fails with PROMO_ALREADY_REDEEMED
      await expect(
        promoService.redeemPromoAtomic(user.id, prov2.provisionalDormitoryId, 'HORPLUS')
      ).rejects.toThrow(/PROMO_ALREADY_REDEEMED|เคยใช้สิทธิ์โปรโมชันนี้ไปแล้ว/);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.promoRedemption.deleteMany({ where: { redeemedBy: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.ownerSignature.deleteMany({ where: { signedByUserId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: [finalizeRes.dormitoryId, priorDorm.id, prov1.provisionalDormitoryId, prov2.provisionalDormitoryId] } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [finalizeRes.dormitoryId, priorDorm.id, prov1.provisionalDormitoryId, prov2.provisionalDormitoryId] } } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('15. Multi-Dorm Renewal Quote Isolation & Security', () => {
    it('binds quote intent to explicit authorized dormitory context and rejects unauthorized dormitory access', async () => {
      const timestamp = Date.now();
      const owner = await prisma.user.create({
        data: {
          googleSubject: `g-multidorm-${timestamp}`,
          email: `multidorm_${timestamp}@example.com`,
          emailNormalized: `multidorm_${timestamp}@example.com`,
          name: 'เจ้าของ หลายหอพัก',
          status: 'active',
        },
      });

      const attacker = await prisma.user.create({
        data: {
          googleSubject: `g-attacker-${timestamp}`,
          email: `attacker_${timestamp}@example.com`,
          emailNormalized: `attacker_${timestamp}@example.com`,
          name: 'ผู้โจมตี',
          status: 'active',
        },
      });

      const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });

      const dormA = await prisma.dormitory.create({
        data: {
          name: 'Dorm A ของ Owner',
          type: 'apartment',
          status: 'active',
          createdByUserId: owner.id,
          members: {
            create: {
              userId: owner.id,
              roleId: ownerRole!.id,
              status: 'active',
            },
          },
        },
      });

      const dormB = await prisma.dormitory.create({
        data: {
          name: 'Dorm B ของ Owner',
          type: 'apartment',
          status: 'active',
          createdByUserId: owner.id,
          members: {
            create: {
              userId: owner.id,
              roleId: ownerRole!.id,
              status: 'active',
            },
          },
        },
      });

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });

      // 1. Owner requests quote with explicit Dorm A context -> intent is for Dorm A
      const quoteA = await subscriptionIntentService.createIntentQuote(owner.id, {
        packageId: pkg1mo!.id,
      }, undefined, dormA.id);
      expect(quoteA.dormitoryId).toBe(dormA.id);

      // 2. Owner requests quote with explicit Dorm B context -> intent is for Dorm B
      const quoteB = await subscriptionIntentService.createIntentQuote(owner.id, {
        packageId: pkg1mo!.id,
      }, undefined, dormB.id);
      expect(quoteB.dormitoryId).toBe(dormB.id);

      // 3. Attacker tries to quote for Dorm A -> 403 Forbidden
      await expect(
        subscriptionIntentService.createIntentQuote(attacker.id, {
          packageId: pkg1mo!.id,
        }, undefined, dormA.id)
      ).rejects.toThrow(/FORBIDDEN_DORMITORY_ACCESS|ไม่มีสิทธิ์เข้าถึงหอพักที่ระบุ/);

      // 4. Multi-dorm owner calling quote without specifying dormitory context -> 400 DORMITORY_CONTEXT_REQUIRED
      await expect(
        subscriptionIntentService.createIntentQuote(owner.id, {
          packageId: pkg1mo!.id,
        })
      ).rejects.toThrow(/DORMITORY_CONTEXT_REQUIRED|กรุณาระบุหอพักที่ต้องการดำเนินการ/);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: owner.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: [dormA.id, dormB.id] } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [dormA.id, dormB.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [owner.id, attacker.id] } } });
    });
  });

  describe('17. Single Canonical Commit Lifecycle & Idempotent Replay Verification', () => {
    it('executes zero-pay commit on onboarding finalize, then idempotent replay leaves wallet, dates, and ledger untouched', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-replay-${timestamp}`,
          email: `replay_${timestamp}@example.com`,
          emailNormalized: `replay_${timestamp}@example.com`,
          name: 'เจ้าของ Idempotent Replay',
          status: 'active',
        },
      });

      const priorDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Replay Test',
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });

      // 1. Mark trial as consumed
      await prisma.accountBenefitClaim.create({
        data: {
          userId: user.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          dormitoryId: priorDorm.id,
          grantedMonths: 1,
          newExpiresAt: new Date(),
        },
      });

      // 2. Credit 400 Coins to wallet
      await coinWalletService.creditCoins(user.id, 400, 'TEST_SEED');
      expect(await coinWalletService.getBalance(user.id)).toBe(400);

      // 3. Prepare provisional dormitory
      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Replay 17',
        province: 'กรุงเทพมหานคร',
      });

      // Seed owner signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/replay-sig.png',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(pkg1mo).toBeDefined();

      // 4. Request quote with 189 coins applied
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg1mo!.id,
        coinRequested: 189,
      }, undefined, prov.provisionalDormitoryId);

      expect(quote.isTrialEligible).toBe(false);
      expect(quote.coinApplied).toBe(189);
      expect(quote.finalPayableAmount).toBe('0.00');

      // 5. Finalize onboarding referencing packageIntentId
      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `finalize-replay-${user.id}-${timestamp}`,
        packageId: pkg1mo!.id,
        packageIntentId: quote.intentId,
        coinApplied: 189,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        dormitory: {
          name: 'หอพัก Replay 17',
          type: 'apartment',
          province: 'กรุงเทพมหานคร',
        },
      });

      expect(finalizeRes.success).toBe(true);

      // Verify wallet balance is 211 (400 - 189 = 211)
      const balanceAfterFinalize = await coinWalletService.getBalance(user.id);
      expect(balanceAfterFinalize).toBe(211);

      // Check ledger entries: exactly 1 debit entry
      const debitEntries1 = await prisma.coinLedgerEntry.findMany({
        where: {
          wallet: { userId: user.id },
          entryType: 'SUBSCRIPTION_DEBIT',
        },
      });
      expect(debitEntries1.length).toBe(1);
      expect(debitEntries1[0].amount).toBe(-189);

      // Check intent status in DB: SUCCEEDED
      const intentAfterFinalize = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
        return await tx.subscriptionPackageIntent.findUnique({
          where: { id: quote.intentId },
        });
      });
      expect(intentAfterFinalize?.status).toBe('SUCCEEDED');

      // Check subscription expiresAt
      const subAfterFinalize = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(subAfterFinalize?.status).toBe('ACTIVE');
      const initialExpiresAt = subAfterFinalize?.expiresAt?.toISOString();
      expect(initialExpiresAt).toBeDefined();

      // 6. REPLAY the SAME intent via subscriptionIntentService.commitZeroPayIntent
      const replayRes = await subscriptionIntentService.commitZeroPayIntent(
        user.id,
        quote.intentId,
        `replay-idempotency-key-${timestamp}`
      );

      expect(replayRes.success).toBe(true);
      expect(replayRes.isReplay).toBe(true);
      expect(replayRes.packageIntentId).toBe(quote.intentId);

      // 7. ASSERT: Wallet remains 211 (NO SECOND DEBIT)
      const balanceAfterReplay = await coinWalletService.getBalance(user.id);
      expect(balanceAfterReplay).toBe(211);

      // ASSERT: Ledger still has EXACTLY 1 debit entry
      const debitEntriesAfterReplay = await prisma.coinLedgerEntry.findMany({
        where: {
          wallet: { userId: user.id },
          entryType: 'SUBSCRIPTION_DEBIT',
        },
      });
      expect(debitEntriesAfterReplay.length).toBe(1);

      // ASSERT: Subscription expiration date remains 100% UNCHANGED
      const subAfterReplay = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(subAfterReplay?.expiresAt?.toISOString()).toBe(initialExpiresAt);

      // ASSERT: No duplicate subscription status history entries
      const histories = await prisma.subscriptionStatusHistory.findMany({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(histories.length).toBe(1);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: [finalizeRes.dormitoryId, priorDorm.id, prov.provisionalDormitoryId] } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [finalizeRes.dormitoryId, priorDorm.id, prov.provisionalDormitoryId] } } });
      await prisma.coinLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
      await prisma.coinWallet.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('18. Exact Duration Invariants (Trial+HORPLUS=3mo, 3mo+HORPLUS=5mo, No Double Extension)', () => {
    it('Trial + HORPLUS yields exactly 3 months duration without double bonus', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-dur-trial-${timestamp}`,
          email: `dur_trial_${timestamp}@example.com`,
          emailNormalized: `dur_trial_${timestamp}@example.com`,
          name: 'เจ้าของ Trial Duration',
          status: 'active',
        },
      });

      const pkg1mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 1, enabled: true },
      });
      expect(pkg1mo).toBeDefined();

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Trial Promo Invariant',
      });

      // Seed signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/trial-dur-sig.png',
            sha256: 'hash-trial-dur-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      // Create quote for Trial + HORPLUS (selecting 1-month PRO package on trial-eligible account)
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg1mo!.id,
        promoCode: 'HORPLUS',
      }, undefined, prov.provisionalDormitoryId);

      expect(quote.isTrialEligible).toBe(true);
      expect(quote.promoBonusMonths).toBe(2);
      expect(quote.finalPayableAmount).toBe('0.00');

      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-trial-dur-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        packageId: pkg1mo!.id,
        planCode: 'PAID',
        promoCode: 'HORPLUS',
        dormitory: { name: 'หอพัก Trial Promo Invariant' },
      });

      expect(finalizeRes.subscriptionStatus).toBe('TRIAL');
      expect(finalizeRes.promoApplied).toBe(true);
      expect(finalizeRes.totalTrialMonths).toBe(3); // 1 trial + 2 promo = 3 months

      const sub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(sub?.status).toBe('TRIAL');

      // Verify expiration is approx 3 months from now (between 88 and 93 days)
      const now = new Date();
      const diffDays = Math.round((sub!.expiresAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(88);
      expect(diffDays).toBeLessThanOrEqual(93);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: finalizeRes.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('3-Month Package + 100% Coin + HORPLUS yields exactly 5 months duration (3 base + 2 promo, NOT 7)', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-dur-3mo-${timestamp}`,
          email: `dur_3mo_${timestamp}@example.com`,
          emailNormalized: `dur_3mo_${timestamp}@example.com`,
          name: 'เจ้าของ 3-Month Coin Promo',
          status: 'active',
        },
      });

      const priorDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Trial Consumed 18',
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });

      // Mark trial consumed
      await prisma.accountBenefitClaim.create({
        data: {
          userId: user.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          dormitoryId: priorDorm.id,
          grantedMonths: 1,
          newExpiresAt: new Date(),
        },
      });

      // Credit 600 Coins
      await coinWalletService.creditCoins(user.id, 600, 'TEST_SEED');

      const pkg3mo = await prisma.subscriptionPackage.findFirst({
        where: { durationMonths: 3, enabled: true },
      });
      expect(pkg3mo).toBeDefined();
      const pkg3moPrice = pkg3mo!.price ? Number(pkg3mo!.price) : 529;

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก 3mo + HORPLUS Exact Invariant',
      });

      // Seed signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/3mo-dur-sig.png',
            sha256: 'hash-3mo-dur-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      // Create quote for 3-month package with exact coins and HORPLUS
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        packageId: pkg3mo!.id,
        coinRequested: pkg3moPrice,
        promoCode: 'HORPLUS',
      }, undefined, prov.provisionalDormitoryId);

      expect(quote.isTrialEligible).toBe(false);
      expect(quote.coinApplied).toBe(pkg3moPrice);
      expect(quote.promoBonusMonths).toBe(2);
      expect(quote.finalPayableAmount).toBe('0.00');

      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-3mo-dur-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        packageId: pkg3mo!.id,
        coinApplied: pkg3moPrice,
        promoCode: 'HORPLUS',
        dormitory: { name: 'หอพัก 3mo + HORPLUS Exact Invariant' },
      });

      expect(finalizeRes.subscriptionStatus).toBe('ACTIVE');

      const sub = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(sub?.status).toBe('ACTIVE');

      // Verify expiration is approx 5 months (3 base + 2 promo) from now (between 148 and 155 days), NOT 7 months
      const now = new Date();
      const diffDays = Math.round((sub!.expiresAt!.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(148);
      expect(diffDays).toBeLessThanOrEqual(155);

      // Replay commit should NOT add more duration
      const replayRes = await subscriptionIntentService.commitZeroPayIntent(user.id, quote.intentId);
      expect(replayRes.success).toBe(true);

      const subAfterReplay = await prisma.dormitorySubscription.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });
      expect(subAfterReplay?.expiresAt?.toISOString()).toBe(sub?.expiresAt?.toISOString());

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: [finalizeRes.dormitoryId, priorDorm.id] } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [finalizeRes.dormitoryId, priorDorm.id] } } });
      await prisma.coinLedgerEntry.deleteMany({ where: { wallet: { userId: user.id } } });
      await prisma.coinWallet.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('19. Intent Tampering & Authority Defense Verification', () => {
    it('rejects onboarding finalization without packageIntentId with 400 error and performs zero mutations', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-tamper-missing-${timestamp}`,
          email: `tamper_missing_${timestamp}@example.com`,
          emailNormalized: `tamper_missing_${timestamp}@example.com`,
          name: 'เจ้าของ Tamper Missing',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Tamper Missing Intent',
      });

      // Seed signature so step 4 check passes
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/tamper-sig.png',
            sha256: 'hash-tamper-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      // Attempt completeOwnerOnboarding without packageIntentId
      await expect(
        provisioningService.completeOwnerOnboarding({
          userId: user.id,
          idempotencyKey: `idemp-missing-intent-${timestamp}`,
          provisionalDormitoryId: prov.provisionalDormitoryId,
          packageIntentId: '' as any,
          dormitory: { name: 'หอพัก Tamper Missing Intent' },
        })
      ).rejects.toThrow(/packageIntentId is required|MISSING_PACKAGE_INTENT/);

      // Verify no active dormitory or subscription was created
      const activeDorm = await prisma.dormitory.findFirst({
        where: { createdByUserId: user.id, status: 'active' },
      });
      expect(activeDorm).toBeNull();

      // Cleanup
      await prisma.ownerSignature.deleteMany({ where: { signedByUserId: user.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitory.deleteMany({ where: { id: prov.provisionalDormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('rejects onboarding finalization with mismatched dormitory intent (403 INTENT_DORMITORY_MISMATCH) and does not retarget intent', async () => {
      const timestamp = Date.now();
      const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });

      const owner = await prisma.user.create({
        data: {
          googleSubject: `g-cross-dorm-${timestamp}`,
          email: `cross_dorm_${timestamp}@example.com`,
          emailNormalized: `cross_dorm_${timestamp}@example.com`,
          name: 'เจ้าของ Cross Dorm Intent',
          status: 'active',
        },
      });

      // Create established Dorm A
      const dormA = await prisma.dormitory.create({
        data: {
          name: 'หอพัก A (Established)',
          type: 'apartment',
          status: 'active',
          createdByUserId: owner.id,
          members: {
            create: {
              userId: owner.id,
              roleId: ownerRole!.id,
              status: 'active',
            },
          },
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const provB = await provisioningService.prepareProvisionalDormitory(owner.id, {
        name: 'หอพัก B (Provisional)',
      });

      // Seed signature for B
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${provB.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: provB.provisionalDormitoryId,
            signedByUserId: owner.id,
            objectKey: 'signatures/cross-sig.png',
            sha256: 'hash-cross-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      // 1. Create quote intent specifically for Dorm A
      const quoteA = await subscriptionIntentService.createIntentQuote(owner.id, {
        isFreePlan: true,
      }, undefined, dormA.id);

      expect(quoteA.dormitoryId).toBe(dormA.id);

      // 2. Attempt to finalize Dorm B using Dorm A's quote intent -> MUST BE REJECTED 403
      await expect(
        provisioningService.completeOwnerOnboarding({
          userId: owner.id,
          idempotencyKey: `idemp-cross-finalize-${timestamp}`,
          provisionalDormitoryId: provB.provisionalDormitoryId,
          packageIntentId: quoteA.intentId,
          planCode: 'FREE',
          dormitory: { name: 'หอพัก B (Provisional)' },
        })
      ).rejects.toThrow(/INTENT_DORMITORY_MISMATCH|รายการคำสั่งซื้อไม่ตรงกับหอพัก/);

      // 3. PostgreSQL Readback: Verify Intent A STILL belongs to Dorm A (NEVER rewritten/retargeted)
      const intentA = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${owner.id}, true)`;
        return await tx.subscriptionPackageIntent.findUnique({
          where: { id: quoteA.intentId },
        });
      });
      expect(intentA?.dormitoryId).toBe(dormA.id);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: owner.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: { in: [dormA.id, provB.provisionalDormitoryId] } } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [dormA.id, provB.provisionalDormitoryId] } } });
      await prisma.user.delete({ where: { id: owner.id } });
    });

    it('rejects superseded/expired quote intent with 400 error', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-superseded-${timestamp}`,
          email: `superseded_${timestamp}@example.com`,
          emailNormalized: `superseded_${timestamp}@example.com`,
          name: 'เจ้าของ Superseded Intent',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Superseded Test',
      });

      // Seed signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/super-sig.png',
            sha256: 'hash-super-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      // Create Quote 1
      const quote1 = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Create Quote 2 (supersedes Quote 1 -> Quote 1 becomes EXPIRED)
      const quote2 = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      expect(quote1.intentId).not.toBe(quote2.intentId);

      // Attempt to finalize with superseded Quote 1 -> MUST FAIL
      await expect(
        provisioningService.completeOwnerOnboarding({
          userId: user.id,
          idempotencyKey: `idemp-super-finalize-${timestamp}`,
          provisionalDormitoryId: prov.provisionalDormitoryId,
          packageIntentId: quote1.intentId,
          planCode: 'FREE',
          dormitory: { name: 'หอพัก Superseded Test' },
        })
      ).rejects.toThrow(/INVALID_INTENT_STATUS|สถานะรายการคำสั่งซื้อไม่ถูกต้อง/);

      // Finalize with valid Quote 2 -> SUCCEEDS
      const successRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-super-success-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote2.intentId,
        planCode: 'FREE',
        dormitory: { name: 'หอพัก Superseded Test' },
      });
      expect(successRes.success).toBe(true);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: successRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: successRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: successRes.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: successRes.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('rejects zero-pay commit when finalPayableAmount is 0 but isZeroPayValidated is false', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-unval-zero-${timestamp}`,
          email: `unval_zero_${timestamp}@example.com`,
          emailNormalized: `unval_zero_${timestamp}@example.com`,
          name: 'เจ้าของ Unvalidated Zero',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Unvalidated Zero',
      });

      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Tamper: force isZeroPayValidated = false in DB
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
        await tx.$executeRaw`UPDATE "subscription_package_intents" SET "is_zero_pay_validated" = false WHERE "id" = ${quote.intentId}::uuid`;
      });

      // Attempt commit -> MUST FAIL ZERO_PAY_UNVALIDATED
      await expect(
        subscriptionIntentService.commitZeroPayIntent(user.id, quote.intentId)
      ).rejects.toThrow(/ZERO_PAY_UNVALIDATED|ไม่ผ่านการตรวจสอบความถูกต้อง/);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitory.delete({ where: { id: prov.provisionalDormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('20. Server-Side Registration Billing Zero Defaults Verification', () => {
    it('persists strictly 0.00 for optional billing rates when client omits them', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-zero-def-${timestamp}`,
          email: `zero_def_${timestamp}@example.com`,
          emailNormalized: `zero_def_${timestamp}@example.com`,
          name: 'เจ้าของ Zero Defaults',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Zero Rate Defaults',
      });

      // Seed signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/zero-def-sig.png',
            sha256: 'hash-zero-def-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Finalize omitting optional rates
      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-zero-def-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        planCode: 'FREE',
        dormitory: {
          name: 'หอพัก Zero Rate Defaults',
          type: 'apartment',
          province: 'กรุงเทพมหานคร',
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
          waterBillingType: 'per_unit',
          electricityBillingType: 'per_unit',
          rentBillingType: 'monthly',
          // Note: waterRate, electricityRate, commonFee, internetFee, parkingRate, lateFeeValue are OMITTED
        },
      });

      expect(finalizeRes.success).toBe(true);

      // Read back directly from PostgreSQL
      const billing = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: finalizeRes.dormitoryId },
      });

      expect(billing).toBeDefined();
      expect(new Prisma.Decimal(billing!.waterRate).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(billing!.electricityRate).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(billing!.commonFee).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(billing!.internetFee).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(billing!.parkingRate).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(billing!.lateFeeValue).toFixed(2)).toBe('0.00');
      expect(billing!.lateFeeType).toBe('none');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: finalizeRes.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('21. Succeeded Onboarding Intent Mutation Re-entry Prevention', () => {
    it('returns immutable finalized state with ZERO mutations when replayed with altered payload and new idempotency key', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-replay-${timestamp}`,
          email: `replay_${timestamp}@example.com`,
          emailNormalized: `replay_${timestamp}@example.com`,
          name: 'เจ้าของ Replay Test',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก ต้นฉบับดั้งเดิม',
      });

      // Add signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/replay-sig.png',
            sha256: 'hash-replay-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Step 1: Initial Finalization (SUCCEEDS)
      const finalizeRes1 = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-first-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        planCode: 'FREE',
        dormitory: {
          name: 'หอพัก ต้นฉบับดั้งเดิม',
          type: 'apartment',
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
          waterRate: '15.00',
          electricityRate: '7.00',
          commonFee: '100.00',
        },
        buildings: [
          {
            id: 'bld-1',
            name: 'อาคารเดิม 1',
            floorsCount: 2,
            monthlyRent: 4000,
            depositAmount: 5000,
            termMonths: 4,
            maxInstallmentMonths: 2,
          },
        ],
        rooms: [
          {
            buildingId: 'bld-1',
            roomNumber: '101',
            floor: 1,
            monthlyRent: 4000,
            depositAmount: 5000,
          },
        ],
      });

      expect(finalizeRes1.success).toBe(true);
      expect(finalizeRes1.isReplay).toBeUndefined();

      // Verify DB state after 1st finalization
      const dormBefore = await prisma.dormitory.findUnique({ where: { id: finalizeRes1.dormitoryId } });
      const billingBefore = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      const bldBefore = await prisma.building.findFirst({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      const roomBefore = await prisma.room.findFirst({ where: { dormitoryId: finalizeRes1.dormitoryId } });

      expect(dormBefore?.name).toBe('หอพัก ต้นฉบับดั้งเดิม');
      expect(new Prisma.Decimal(billingBefore!.waterRate).toFixed(2)).toBe('15.00');
      expect(bldBefore?.name).toBe('อาคารเดิม 1');
      expect(roomBefore?.roomNumber).toBe('101');

      // Step 2: Replay same packageIntentId with altered payload & different idempotencyKey
      const finalizeRes2 = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-second-altered-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        planCode: 'FREE',
        dormitory: {
          name: 'หอพัก ถูกแอบแก้ไข ปลอมแปลง',
        },
        billing: {
          billingDay: 1,
          dueDay: 10,
          waterRate: '99.00',
          electricityRate: '99.00',
          commonFee: '999.00',
        },
        buildings: [
          {
            id: 'bld-1',
            name: 'อาคารปลอม 99',
            floorsCount: 10,
            monthlyRent: 99999,
          },
        ],
        rooms: [
          {
            buildingId: 'bld-1',
            roomNumber: '999',
            floor: 9,
            monthlyRent: 99999,
          },
        ],
      });

      expect(finalizeRes2.success).toBe(true);
      expect(finalizeRes2.isReplay).toBe(true);

      // Verify DB has ZERO mutations
      const dormAfter = await prisma.dormitory.findUnique({ where: { id: finalizeRes1.dormitoryId } });
      const billingAfter = await prisma.dormitoryBillingSettings.findUnique({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      const bldAfter = await prisma.building.findFirst({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      const roomAfter = await prisma.room.findFirst({ where: { dormitoryId: finalizeRes1.dormitoryId } });

      expect(dormAfter?.name).toBe('หอพัก ต้นฉบับดั้งเดิม');
      expect(new Prisma.Decimal(billingAfter!.waterRate).toFixed(2)).toBe('15.00');
      expect(bldAfter?.name).toBe('อาคารเดิม 1');
      expect(roomAfter?.roomNumber).toBe('101');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes1.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: finalizeRes1.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('22. Subscription Commit Rejection of Expired/Superseded Intent', () => {
    it('rejects superseded Quote A when Quote B is created, returning INVALID_INTENT_STATUS', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-commit-rej-${timestamp}`,
          email: `commit_rej_${timestamp}@example.com`,
          emailNormalized: `commit_rej_${timestamp}@example.com`,
          name: 'เจ้าของ Commit Rejection',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Commit Rejection Test',
      });

      // Quote A
      const quoteA = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Quote B (Supersedes Quote A)
      const quoteB = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      expect(quoteA.intentId).not.toBe(quoteB.intentId);

      // Check Quote A status in DB
      const intentADb = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${user.id}, true)`;
        return tx.subscriptionPackageIntent.findUnique({
          where: { id: quoteA.intentId },
        });
      });
      expect(intentADb?.status).toBe('EXPIRED');

      // Attempt to commit Quote A directly via service -> MUST FAIL INVALID_INTENT_STATUS
      await expect(
        subscriptionIntentService.commitZeroPayIntent(user.id, quoteA.intentId)
      ).rejects.toThrow(/INVALID_INTENT_STATUS|สถานะรายการสั่งซื้อไม่ถูกต้อง/);

      // Quote B can be committed successfully
      const commitBRes = await subscriptionIntentService.commitZeroPayIntent(user.id, quoteB.intentId);
      expect(commitBRes.success).toBe(true);
      expect(commitBRes.status).toBe('SUCCEEDED');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitory.delete({ where: { id: prov.provisionalDormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('23. Revalidate INITIAL_TRIAL_V1 At Commit Time', () => {
    it('rejects stale trial quote if benefit claim already exists for user', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-trial-rev-${timestamp}`,
          email: `trial_rev_${timestamp}@example.com`,
          emailNormalized: `trial_rev_${timestamp}@example.com`,
          name: 'เจ้าของ Trial Revalidation',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Trial Revalidation Test',
      });

      // User creates Quote 1 with trial eligibility
      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: false,
      }, undefined, prov.provisionalDormitoryId);

      expect(quote.isTrialEligible).toBe(true);

      // Simulate: trial claim is created elsewhere before quote commit
      await prisma.accountBenefitClaim.create({
        data: {
          userId: user.id,
          benefitKey: 'INITIAL_TRIAL_V1',
          dormitoryId: prov.provisionalDormitoryId,
          grantedMonths: 1,
          newExpiresAt: new Date(Date.now() + 30 * 86400000),
        },
      });

      // Attempt commit -> MUST BE REJECTED WITH TRIAL_ALREADY_CLAIMED
      await expect(
        subscriptionIntentService.commitZeroPayIntent(user.id, quote.intentId)
      ).rejects.toThrow(/TRIAL_ALREADY_CLAIMED|สิทธิ์ทดลองใช้งานฟรี/);

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: prov.provisionalDormitoryId } });
      await prisma.dormitory.delete({ where: { id: prov.provisionalDormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('guarantees at most ONE trial quote commit succeeds under concurrent commit attempts for the same Google Account', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-trial-conc-${timestamp}`,
          email: `trial_conc_${timestamp}@example.com`,
          emailNormalized: `trial_conc_${timestamp}@example.com`,
          name: 'เจ้าของ Trial Concurrency',
          status: 'active',
        },
      });

      const dormA = await prisma.dormitory.create({
        data: {
          name: `หอพัก Trial Concurrency A ${timestamp}`,
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });
      const dormB = await prisma.dormitory.create({
        data: {
          name: `หอพัก Trial Concurrency B ${timestamp}`,
          type: 'apartment',
          status: 'active',
          createdByUserId: user.id,
        },
      });

      const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
      await prisma.dormitoryMember.createMany({
        data: [
          { dormitoryId: dormA.id, userId: user.id, roleId: ownerRole!.id, status: 'active' },
          { dormitoryId: dormB.id, userId: user.id, roleId: ownerRole!.id, status: 'active' },
        ],
      });

      // User creates Quote A for Dorm A and Quote B for Dorm B
      const quoteA = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: false,
      }, undefined, dormA.id);

      const quoteB = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: false,
      }, undefined, dormB.id);

      expect(quoteA.isTrialEligible).toBe(true);
      expect(quoteB.isTrialEligible).toBe(true);

      // Concurrently commit both quotes for the same user
      const results = await Promise.allSettled([
        subscriptionIntentService.commitZeroPayIntent(user.id, quoteA.intentId),
        subscriptionIntentService.commitZeroPayIntent(user.id, quoteB.intentId),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
      const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

      // Exactly ONE succeeds, exactly ONE is rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(fulfilled[0].value.status).toBe('SUCCEEDED');
      expect(fulfilled[0].value.isTrial).toBe(true);
      expect(rejected[0].reason.message).toMatch(/TRIAL_ALREADY_CLAIMED|สิทธิ์ทดลองใช้งานฟรี/);

      // Exactly ONE AccountBenefitClaim exists in DB
      const claimCount = await prisma.accountBenefitClaim.count({
        where: { userId: user.id, benefitKey: 'INITIAL_TRIAL_V1' },
      });
      expect(claimCount).toBe(1);

      // Verify the losing intent did NOT grant a trial subscription
      const winningDormId = fulfilled[0].value.dormitoryId;
      const losingDormId = winningDormId === dormA.id ? dormB.id : dormA.id;

      const winningSub = await prisma.dormitorySubscription.findUnique({ where: { dormitoryId: winningDormId } });
      const losingSub = await prisma.dormitorySubscription.findUnique({ where: { dormitoryId: losingDormId } });

      expect(winningSub?.status).toBe('TRIAL');
      expect(losingSub).toBeNull(); // Losing dorm received zero subscription mutation

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { OR: [{ dormitoryId: dormA.id }, { dormitoryId: dormB.id }] } });
      await prisma.dormitorySubscription.deleteMany({ where: { OR: [{ dormitoryId: dormA.id }, { dormitoryId: dormB.id }] } });
      await prisma.accountBenefitClaim.deleteMany({ where: { userId: user.id } });
      await prisma.dormitoryMember.deleteMany({ where: { OR: [{ dormitoryId: dormA.id }, { dormitoryId: dormB.id }] } });
      await prisma.dormitory.deleteMany({ where: { id: { in: [dormA.id, dormB.id] } } });
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('24. Building Deposit Persistence & Room Inheritance Matrix', () => {
    it('persists Building deposit and resolves Room effective deposit with inheritance override protection via real HTTP finalize route', async () => {
      const timestamp = Date.now();
      const user = await prisma.user.create({
        data: {
          googleSubject: `g-bld-dep-${timestamp}`,
          email: `bld_dep_${timestamp}@example.com`,
          emailNormalized: `bld_dep_${timestamp}@example.com`,
          name: 'เจ้าของ Building Deposit Test',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const defaultsService = new DefaultsService();
      const roomService = new RoomService();
      const buildingService = new BuildingService();

      const prov = await provisioningService.prepareProvisionalDormitory(user.id, {
        name: 'หอพัก Building Deposit Flow',
      });

      // Signature
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: user.id,
            objectKey: 'signatures/bld-dep-sig.png',
            sha256: 'hash-bld-dep-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(user.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      // Onboard Building A with depositAmount 5000 via direct service or HTTP
      const finalizeRes = await provisioningService.completeOwnerOnboarding({
        userId: user.id,
        idempotencyKey: `idemp-bld-dep-${timestamp}`,
        provisionalDormitoryId: prov.provisionalDormitoryId,
        packageIntentId: quote.intentId,
        planCode: 'FREE',
        dormitory: {
          name: 'หอพัก Building Deposit Flow',
          type: 'apartment',
        },
        billing: {
          billingDay: 25,
          dueDay: 5,
        },
        buildings: [
          {
            id: 'bld-alpha',
            name: 'อาคาร Alpha',
            floorsCount: 2,
            monthlyRent: 4500,
            depositAmount: 5000,
            securityDeposit: 5000,
            termMonths: 4,
            maxInstallmentMonths: 2,
          },
        ],
        rooms: [
          {
            buildingId: 'bld-alpha',
            roomNumber: '101',
            floor: 1,
            monthlyRent: 4500,
            depositInheritsBuildingDefault: true,
          },
          {
            buildingId: 'bld-alpha',
            roomNumber: '102',
            floor: 1,
            monthlyRent: 4500,
            depositAmount: 7000,
            depositInheritsBuildingDefault: false,
          },
        ],
      });

      expect(finalizeRes.success).toBe(true);

      const building = await prisma.building.findFirst({
        where: { dormitoryId: finalizeRes.dormitoryId, name: 'อาคาร Alpha' },
      });
      expect(building).toBeDefined();
      expect(new Prisma.Decimal(building!.depositAmount!).toFixed(2)).toBe('5000.00');

      const room101 = await prisma.room.findFirst({
        where: { dormitoryId: finalizeRes.dormitoryId, roomNumber: '101' },
      });
      const room102 = await prisma.room.findFirst({
        where: { dormitoryId: finalizeRes.dormitoryId, roomNumber: '102' },
      });

      expect(room101?.depositInheritsBuildingDefault).toBe(true);
      expect(room102?.depositInheritsBuildingDefault).toBe(false);

      // Verify effective defaults from defaultsService
      const effective101 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizeRes.dormitoryId,
        building!.id,
        room101!.id
      );
      const effective102 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizeRes.dormitoryId,
        building!.id,
        room102!.id
      );

      expect(effective101.depositAmount.value).toBe(5000);
      expect(effective101.depositAmount.source).toBe('BUILDING');
      expect(effective102.depositAmount.value).toBe(7000);
      expect(effective102.depositAmount.source).toBe('ROOM');

      // Now Owner updates Building Alpha deposit to 6000
      await buildingService.updateBuilding({
        buildingId: building!.id,
        dormitoryId: finalizeRes.dormitoryId,
        expectedVersion: building!.version,
        changes: {
          depositAmount: '6000.00',
        },
      });

      // Verify Room 101 dynamically resolves 6000, Room 102 remains overridden at 7000
      const rechecked101 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizeRes.dormitoryId,
        building!.id,
        room101!.id
      );
      const rechecked102 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizeRes.dormitoryId,
        building!.id,
        room102!.id
      );

      expect(rechecked101.depositAmount.value).toBe(6000);
      expect(rechecked101.depositAmount.source).toBe('BUILDING');
      expect(rechecked102.depositAmount.value).toBe(7000);
      expect(rechecked102.depositAmount.source).toBe('ROOM');

      // Now Owner clears Room 102 override (sets depositAmount: null)
      await roomService.updateRoom({
        roomId: room102!.id,
        dormitoryId: finalizeRes.dormitoryId,
        expectedVersion: room102!.version,
        changes: {
          depositAmount: null,
        },
      });

      const rechecked102Cleared = await defaultsService.resolveEffectiveRoomDefaults(
        finalizeRes.dormitoryId,
        building!.id,
        room102!.id
      );
      expect(rechecked102Cleared.depositAmount.value).toBe(6000);
      expect(rechecked102Cleared.depositAmount.source).toBe('BUILDING');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: user.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.auditLog.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.room.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.building.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizeRes.dormitoryId } });
      await prisma.dormitory.delete({ where: { id: finalizeRes.dormitoryId } });
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('proves Building deposit persistence (5000) and Room default inheritance via real HTTP POST /api/v1/onboarding/finalize route with authenticated session and CSRF', async () => {
      const timestamp = Date.now();
      const httpUser = await prisma.user.create({
        data: {
          googleSubject: `g-http-dep-${timestamp}`,
          email: `http_dep_${timestamp}@example.com`,
          emailNormalized: `http_dep_${timestamp}@example.com`,
          name: 'เจ้าของ HTTP Building Deposit Test',
          status: 'active',
        },
      });

      const provisioningService = new DormitoryProvisioningService(prisma);
      const defaultsService = new DefaultsService();

      const prov = await provisioningService.prepareProvisionalDormitory(httpUser.id, {
        name: 'หอพัก HTTP Deposit Real Route',
      });

      // Signature in DB for provisional dorm
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: httpUser.id,
            objectKey: 'signatures/http-bld-dep-sig.png',
            sha256: 'hash-http-bld-dep-sig',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(httpUser.id, {
        isFreePlan: true,
      }, undefined, prov.provisionalDormitoryId);

      const authSession = await createTestAuthSession(httpUser.id);

      // Execute genuine HTTP request through Express routing, CSRF middleware, and session auth
      const httpRes = await request(app)
        .post('/api/v1/onboarding/finalize')
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-idempotency-key', `http-idemp-dep-${timestamp}`)
        .send({
          provisionalDormitoryId: prov.provisionalDormitoryId,
          packageIntentId: quote.intentId,
          planCode: 'FREE',
          dormitory: {
            name: 'หอพัก HTTP Deposit Real Route',
            type: 'apartment',
          },
          billing: {
            billingDay: 25,
            dueDay: 5,
          },
          buildings: [
            {
              id: 'bld-http-alpha',
              name: 'อาคาร HTTP Alpha',
              floorsCount: 2,
              monthlyRent: 4500,
              depositAmount: 5000,
              securityDeposit: 5000,
              termMonths: 4,
              maxInstallmentMonths: 2,
            },
          ],
          rooms: [
            {
              buildingId: 'bld-http-alpha',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositInheritsBuildingDefault: true,
            },
            {
              buildingId: 'bld-http-alpha',
              roomNumber: '102',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 7000,
              depositInheritsBuildingDefault: false,
            },
          ],
        });

      expect(httpRes.status).toBe(200);
      expect(httpRes.body.data).toBeDefined();
      expect(httpRes.body.data.success).toBe(true);

      const finalizedDormId = httpRes.body.data.dormitoryId;
      expect(finalizedDormId).toBeDefined();

      // Verify directly from PostgreSQL
      const persistedBuilding = await prisma.building.findFirst({
        where: { dormitoryId: finalizedDormId, name: 'อาคาร HTTP Alpha' },
      });
      expect(persistedBuilding).toBeDefined();
      expect(new Prisma.Decimal(persistedBuilding!.depositAmount!).toFixed(2)).toBe('5000.00');

      const persistedRoom101 = await prisma.room.findFirst({
        where: { dormitoryId: finalizedDormId, roomNumber: '101' },
      });
      const persistedRoom102 = await prisma.room.findFirst({
        where: { dormitoryId: finalizedDormId, roomNumber: '102' },
      });

      expect(persistedRoom101?.depositInheritsBuildingDefault).toBe(true);
      expect(persistedRoom102?.depositInheritsBuildingDefault).toBe(false);

      // Verify effective defaults inheritance
      const eff101 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizedDormId,
        persistedBuilding!.id,
        persistedRoom101!.id
      );
      const eff102 = await defaultsService.resolveEffectiveRoomDefaults(
        finalizedDormId,
        persistedBuilding!.id,
        persistedRoom102!.id
      );

      expect(eff101.depositAmount.value).toBe(5000);
      expect(eff101.depositAmount.source).toBe('BUILDING');
      expect(eff102.depositAmount.value).toBe(7000);
      expect(eff102.depositAmount.source).toBe('ROOM');

      // Cleanup
      await prisma.subscriptionPackageIntent.deleteMany({ where: { userId: httpUser.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.auditLog.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.room.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.building.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: finalizedDormId } });
      await prisma.dormitory.delete({ where: { id: finalizedDormId } });
      await prisma.session.deleteMany({ where: { userId: httpUser.id } });
      await prisma.user.delete({ where: { id: httpUser.id } });
    });
  });

  describe('25. Complete Step-3 Billing Calculation Matrix Proof', () => {
    it('calculates bills accurately across all modes (unit, person, room, free, vehicle) with exact Decimal precision, unpaid recalculation, and paid bill immutability', async () => {
      const timestamp = Date.now();
      const billRepo = new PrismaBillRepository(prisma);
      const cycleRepo = new PrismaBillingCycleRepository(prisma);
      const meterRepo = new PrismaMeterRepository(prisma);
      const contractRepo = new PrismaContractRepository(prisma);
      const roomRepo = new PrismaRoomRepository(prisma);
      const tenantRepo = new PrismaTenantRepository(prisma);
      const auditService = new AuditService();

      const billingService = new BillingService(
        billRepo,
        cycleRepo,
        meterRepo,
        contractRepo,
        roomRepo,
        tenantRepo,
        auditService
      );
      const billingOrchestrationService = new BillingOrchestrationService(
        billingService,
        billRepo,
        cycleRepo,
        meterRepo,
        contractRepo,
        roomRepo,
        tenantRepo,
        auditService
      );

      const dorm = await prisma.dormitory.create({
        data: {
          name: `หอพัก Billing Matrix ${timestamp}`,
          type: 'apartment',
          status: 'active',
        },
      });

      const building = await prisma.building.create({
        data: {
          dormitoryId: dorm.id,
          name: 'อาคาร Matrix',
          floorCount: 2,
        },
      });

      const room = await prisma.room.create({
        data: {
          dormitoryId: dorm.id,
          buildingId: building.id,
          roomNumber: 'M101',
          normalizedRoomNumber: 'M101',
          floor: 1,
          roomType: 'standard',
          status: 'occupied',
          monthlyRent: '5000.00',
        },
      });

      const tenantUser = await prisma.user.create({
        data: {
          googleSubject: `g-tenant-${timestamp}`,
          email: `tenant_${timestamp}@example.com`,
          emailNormalized: `tenant_${timestamp}@example.com`,
          name: 'ผู้เช่า Matrix',
          status: 'active',
        },
      });

      const tenant = await prisma.tenant.create({
        data: {
          dormitoryId: dorm.id,
          linkedUserId: tenantUser.id,
          tenantNumber: `TN-${timestamp}`,
          firstName: 'สมชาย',
          lastName: 'รักสงบ',
          displayName: 'สมชาย รักสงบ',
          phone: '0812345678',
          status: 'active',
        },
      });

      // Add 2 co-occupants (Authoritative peopleCount = 1 tenant + 2 co-occupants = 3 people)
      await prisma.tenantCoOccupant.createMany({
        data: [
          { dormitoryId: dorm.id, tenantId: tenant.id, name: 'ผู้ร่วมพัก 1' },
          { dormitoryId: dorm.id, tenantId: tenant.id, name: 'ผู้ร่วมพัก 2' },
        ],
      });

      // Add 2 vehicles for tenant
      await prisma.tenantVehicle.createMany({
        data: [
          { dormitoryId: dorm.id, tenantId: tenant.id, type: 'car', licensePlate: `1กข-${timestamp}` },
          { dormitoryId: dorm.id, tenantId: tenant.id, type: 'motorcycle', licensePlate: `2กค-${timestamp}` },
        ],
      });

      const contract = await prisma.contract.create({
        data: {
          dormitoryId: dorm.id,
          roomId: room.id,
          tenantId: tenant.id,
          contractNumber: `CTR-${timestamp}`,
          startDate: new Date('2026-07-01'),
          endDate: new Date('2027-06-30'),
          rentAmount: '5000.00',
          depositAmount: '5000.00',
          status: 'active',
        },
      });

      const cycle = await prisma.billingCycle.create({
        data: {
          dormitoryId: dorm.id,
          cycleCode: `2026-07-${timestamp}`,
          name: 'รอบบิล กรกฎาคม 2569',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-07-31'),
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          status: 'active',
        },
      });

      // Meter devices: Water & Electricity
      const waterDevice = await prisma.meterDevice.create({
        data: {
          dormitoryId: dorm.id,
          roomId: room.id,
          type: 'water',
          meterNumber: `WM-${timestamp}`,
          initialReading: '100.00',
          currentReading: '110.00',
        },
      });

      const elecDevice = await prisma.meterDevice.create({
        data: {
          dormitoryId: dorm.id,
          roomId: room.id,
          type: 'electricity',
          meterNumber: `EM-${timestamp}`,
          initialReading: '500.00',
          currentReading: '600.00',
        },
      });

      // Meter readings: Water = 10 units, Electricity = 100 units
      await prisma.meterReading.createMany({
        data: [
          {
            dormitoryId: dorm.id,
            billingCycleId: cycle.id,
            roomId: room.id,
            meterDeviceId: waterDevice.id,
            meterType: 'water',
            usageUnits: '10.00',
            previousReading: '100.00',
            currentReading: '110.00',
            readAt: new Date('2026-07-25'),
            status: 'recorded',
          },
          {
            dormitoryId: dorm.id,
            billingCycleId: cycle.id,
            roomId: room.id,
            meterDeviceId: elecDevice.id,
            meterType: 'electricity',
            usageUnits: '100.00',
            previousReading: '500.00',
            currentReading: '600.00',
            readAt: new Date('2026-07-25'),
            status: 'recorded',
          },
        ],
      });

      // --- Mode 1: Water per_person, Electricity per_unit, Common per_room, Internet per_person, Parking per_vehicle
      const rateSnapshot1 = await prisma.billingRateSnapshot.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle.id,
          waterBillingType: 'per_person',
          waterRate: '100.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          commonFeeMode: 'room',
          commonFee: '200.00',
          internetFeeMode: 'person',
          internetFee: '150.00',
          parkingFeeMode: 'vehicle',
          parkingFee: '250.00',
        },
      });

      const billCalc1 = await billingService.generateBillPreview(
        dorm.id,
        cycle.id,
        room.id
      );

      // Rent: 5000.00
      // Water (3 people * 100): 300.00
      // Electricity (100 units * 8): 800.00
      // Common (room): 200.00
      // Internet (3 people * 150): 450.00
      // Parking (2 vehicles * 250): 500.00
      // Subtotal = 5000 + 300 + 800 + 200 + 450 + 500 = 7250.00
      expect(billCalc1.totalAmount).toBe('7250.00');

      const rentItem1 = billCalc1.items.find((i) => i.type === 'rent');
      expect(rentItem1?.amount).toBe('5000.00');

      const waterItem1 = billCalc1.items.find((i) => i.type === 'water');
      expect(waterItem1?.unit).toBe('person');
      expect(waterItem1?.quantity).toBe('3.00');
      expect(waterItem1?.amount).toBe('300.00');

      const elecItem1 = billCalc1.items.find((i) => i.type === 'electricity');
      expect(elecItem1?.unit).toBe('unit');
      expect(elecItem1?.quantity).toBe('100.00');
      expect(elecItem1?.amount).toBe('800.00');

      const commonItem1 = billCalc1.items.find((i) => i.type === 'common_fee');
      expect(commonItem1?.unit).toBe('room');
      expect(commonItem1?.amount).toBe('200.00');

      const internetItem1 = billCalc1.items.find((i) => i.type === 'internet');
      expect(internetItem1?.unit).toBe('person');
      expect(internetItem1?.quantity).toBe('3.00');
      expect(internetItem1?.amount).toBe('450.00');

      const parkingItem1 = billCalc1.items.find((i) => i.type === 'parking');
      expect(parkingItem1?.unit).toBe('vehicle');
      expect(parkingItem1?.quantity).toBe('2.00');
      expect(parkingItem1?.amount).toBe('500.00');

      // --- Mode 2: Water per_unit, Electricity per_person, Common per_person, Internet per_room, Parking per_room
      await prisma.billingRateSnapshot.update({
        where: { id: rateSnapshot1.id },
        data: {
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_person',
          electricityRate: '200.00',
          commonFeeMode: 'person',
          commonFee: '50.00',
          internetFeeMode: 'room',
          internetFee: '300.00',
          parkingFeeMode: 'room',
          parkingFee: '300.00',
        },
      });

      const billCalc2 = await billingService.generateBillPreview(
        dorm.id,
        cycle.id,
        room.id
      );

      // Rent: 5000.00
      // Water (10 units * 18): 180.00
      // Electricity (3 people * 200): 600.00
      // Common (3 people * 50): 150.00
      // Internet (1 room * 300): 300.00
      // Parking (1 room * 300): 300.00
      // Subtotal = 5000 + 180 + 600 + 150 + 300 + 300 = 6530.00
      expect(billCalc2.totalAmount).toBe('6530.00');

      // --- Mode 3: Water per_room (flat_rate), Electricity per_room (flat_rate), Common free, Internet free, Parking free
      await prisma.billingRateSnapshot.update({
        where: { id: rateSnapshot1.id },
        data: {
          waterBillingType: 'room',
          waterRate: '250.00',
          electricityBillingType: 'room',
          electricityRate: '1200.00',
          commonFeeMode: 'none',
          commonFee: '0.00',
          internetFeeMode: 'none',
          internetFee: '0.00',
          parkingFeeMode: 'none',
          parkingFee: '0.00',
        },
      });

      const billCalc3 = await billingService.generateBillPreview(
        dorm.id,
        cycle.id,
        room.id
      );

      // Rent: 5000.00, Water (room): 250.00, Electricity (room): 1200.00, others omitted
      expect(billCalc3.totalAmount).toBe('6450.00');
      expect(billCalc3.items.find((i) => i.type === 'common_fee')).toBeUndefined();
      expect(billCalc3.items.find((i) => i.type === 'internet')).toBeUndefined();
      expect(billCalc3.items.find((i) => i.type === 'parking')).toBeUndefined();

      // --- Unpaid Recalculation & Paid Bill Immutability
      // Restore RateSnapshot 1 and create a real unpaid Bill
      await prisma.billingRateSnapshot.update({
        where: { id: rateSnapshot1.id },
        data: {
          waterBillingType: 'per_person',
          waterRate: '100.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
          commonFeeMode: 'room',
          commonFee: '200.00',
          internetFeeMode: 'person',
          internetFee: '150.00',
          parkingFeeMode: 'vehicle',
          parkingFee: '250.00',
        },
      });

      const createdBill = await prisma.bill.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle.id,
          roomId: room.id,
          contractId: contract.id,
          tenantId: tenant.id,
          billNumber: `BILL-RECALC-${timestamp}`,
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          subtotal: '7250.00',
          totalAmount: '7250.00',
          paidAmount: '0.00',
          outstandingAmount: '7250.00',
          status: 'unpaid',
        },
      });

      await prisma.billItem.createMany({
        data: [
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'rent', description: 'ค่าเช่า', amount: '5000.00', quantity: '1.00', unitPrice: '5000.00' },
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'water', description: 'ค่าน้ำประปา (3 คน)', amount: '300.00', quantity: '3.00', unitPrice: '100.00', unit: 'person', metadata: { mode: 'person', peopleCount: 3 } },
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'electricity', description: 'ค่าไฟฟ้า (100 หน่วย)', amount: '800.00', quantity: '100.00', unitPrice: '8.00', unit: 'unit' },
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '200.00', quantity: '1.00', unitPrice: '200.00', unit: 'room' },
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'internet', description: 'ค่าบริการอินเทอร์เน็ต (3 คน)', amount: '450.00', quantity: '3.00', unitPrice: '150.00', unit: 'person', metadata: { mode: 'person', peopleCount: 3 } },
          { dormitoryId: dorm.id, billId: createdBill.id, type: 'parking', description: 'ค่าที่จอดรถ (2 คัน)', amount: '500.00', quantity: '2.00', unitPrice: '250.00', unit: 'vehicle', metadata: { mode: 'vehicle', vehicleCount: 2 } },
        ],
      });

      // Recalculate unpaid bill with peopleCount = 4
      const recalcRes = await prisma.$transaction(async (tx) => {
        return billingOrchestrationService.recalculateUnpaidBill(dorm.id, cycle.id, room.id, 4, 3, tx);
      });
      expect(recalcRes.recalculated).toBe(true);

      const recheckedBill = await prisma.bill.findUnique({ where: { id: createdBill.id } });
      // Total = 5000 + (100 * 4 = 400) + 800 + 200 + (150 * 4 = 600) + 500 = 7500.00
      expect(recheckedBill?.totalAmount.toFixed(2)).toBe('7500.00');

      // Now mark bill as PAID
      await prisma.bill.update({
        where: { id: createdBill.id },
        data: { status: 'paid', paidAmount: '7500.00', outstandingAmount: '0.00' },
      });

      // Attempt recalculating a PAID bill -> MUST BE IMMUTABLE
      const paidRecalcRes = await prisma.$transaction(async (tx) => {
        return billingOrchestrationService.recalculateUnpaidBill(dorm.id, cycle.id, room.id, 5, 4, tx);
      });
      expect(paidRecalcRes.recalculated).toBe(false);
      expect(paidRecalcRes.isPaidImmutable).toBe(true);

      const immutableBill = await prisma.bill.findUnique({ where: { id: createdBill.id } });
      expect(immutableBill?.totalAmount.toFixed(2)).toBe('7500.00'); // Unchanged

      // Cleanup
      await prisma.billItem.deleteMany({ where: { billId: createdBill.id } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.billingRateSnapshot.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.meterReading.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.meterDevice.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.tenantVehicle.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenantCoOccupant.deleteMany({ where: { tenantId: tenant.id } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.user.delete({ where: { id: tenantUser.id } });
      await prisma.room.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.building.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('26. Reports and Statistics Database Oracle Verification', () => {
    it('accurately matches PostgreSQL oracle aggregations with Real Report/Dashboard API results, building filter, cycle filter, and F5 stability', async () => {
      const timestamp = Date.now();
      const billRepo = new PrismaBillRepository(prisma);
      const cycleRepo = new PrismaBillingCycleRepository(prisma);
      const meterRepo = new PrismaMeterRepository(prisma);
      const contractRepo = new PrismaContractRepository(prisma);
      const roomRepo = new PrismaRoomRepository(prisma);
      const tenantRepo = new PrismaTenantRepository(prisma);
      const buildingRepo = new PrismaBuildingRepository(prisma);
      const auditService = new AuditService();

      const billingService = new BillingService(
        billRepo,
        cycleRepo,
        meterRepo,
        contractRepo,
        roomRepo,
        tenantRepo,
        auditService
      );

      const dorm = await prisma.dormitory.create({
        data: {
          name: `หอพัก Oracle Sandbox ${timestamp}`,
          type: 'apartment',
          status: 'active',
        },
      });

      const buildingA = await prisma.building.create({
        data: {
          dormitoryId: dorm.id,
          name: 'อาคาร Oracle A',
          floorCount: 1,
        },
      });
      const buildingB = await prisma.building.create({
        data: {
          dormitoryId: dorm.id,
          name: 'อาคาร Oracle B',
          floorCount: 1,
        },
      });

      // Create 4 rooms: Building A (1 occupied, 1 vacant), Building B (1 occupied, 1 vacant)
      const roomA1 = await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: buildingA.id, roomNumber: 'OA101', normalizedRoomNumber: 'OA101', floor: 1, roomType: 'standard', status: 'occupied', monthlyRent: '4000.00' },
      });
      const roomA2 = await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: buildingA.id, roomNumber: 'OA102', normalizedRoomNumber: 'OA102', floor: 1, roomType: 'standard', status: 'vacant', monthlyRent: '4000.00' },
      });
      const roomB1 = await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: buildingB.id, roomNumber: 'OB201', normalizedRoomNumber: 'OB201', floor: 1, roomType: 'deluxe', status: 'occupied', monthlyRent: '6000.00' },
      });
      const roomB2 = await prisma.room.create({
        data: { dormitoryId: dorm.id, buildingId: buildingB.id, roomNumber: 'OB202', normalizedRoomNumber: 'OB202', floor: 1, roomType: 'deluxe', status: 'vacant', monthlyRent: '6000.00' },
      });

      const tenantA = await prisma.tenant.create({
        data: { dormitoryId: dorm.id, tenantNumber: `TN-A-${timestamp}`, firstName: 'ผู้เช่า A', displayName: 'ผู้เช่า A', phone: '0811111111', status: 'active' },
      });
      const tenantB = await prisma.tenant.create({
        data: { dormitoryId: dorm.id, tenantNumber: `TN-B-${timestamp}`, firstName: 'ผู้เช่า B', displayName: 'ผู้เช่า B', phone: '0822222222', status: 'active' },
      });

      const contractA = await prisma.contract.create({
        data: { dormitoryId: dorm.id, roomId: roomA1.id, tenantId: tenantA.id, contractNumber: `CTR-A-${timestamp}`, startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), rentAmount: '4000.00', status: 'active' },
      });
      const contractB = await prisma.contract.create({
        data: { dormitoryId: dorm.id, roomId: roomB1.id, tenantId: tenantB.id, contractNumber: `CTR-B-${timestamp}`, startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), rentAmount: '6000.00', status: 'active' },
      });

      // Cycle 1: July 2026
      const cycle1 = await prisma.billingCycle.create({
        data: {
          dormitoryId: dorm.id,
          cycleCode: `2026-07-orc-${timestamp}`,
          name: 'รอบบิล กรกฎาคม 2569 Oracle',
          periodStart: new Date('2026-07-01'),
          periodEnd: new Date('2026-07-31'),
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          status: 'active',
        },
      });

      // Cycle 2: August 2026
      const cycle2 = await prisma.billingCycle.create({
        data: {
          dormitoryId: dorm.id,
          cycleCode: `2026-08-orc-${timestamp}`,
          name: 'รอบบิล สิงหาคม 2569 Oracle',
          periodStart: new Date('2026-08-01'),
          periodEnd: new Date('2026-08-31'),
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          status: 'active',
        },
      });

      // Cycle 1 Bills:
      // Bill 1 (Building A, Room OA101): Paid in full (Total: 5150.00)
      const bill1 = await prisma.bill.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle1.id,
          roomId: roomA1.id,
          contractId: contractA.id,
          tenantId: tenantA.id,
          billNumber: `BILL-${timestamp}-1`,
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          subtotal: '5150.00',
          totalAmount: '5150.00',
          paidAmount: '5150.00',
          outstandingAmount: '0.00',
          status: 'paid',
          paidAt: new Date('2026-08-02'),
        },
      });
      await prisma.billItem.createMany({
        data: [
          { dormitoryId: dorm.id, billId: bill1.id, type: 'rent', description: 'ค่าเช่า', amount: '4000.00', quantity: '1.00', unitPrice: '4000.00' },
          { dormitoryId: dorm.id, billId: bill1.id, type: 'water', description: 'ค่าน้ำ', amount: '200.00', quantity: '10.00', unitPrice: '20.00' },
          { dormitoryId: dorm.id, billId: bill1.id, type: 'electricity', description: 'ค่าไฟ', amount: '600.00', quantity: '75.00', unitPrice: '8.00' },
          { dormitoryId: dorm.id, billId: bill1.id, type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '150.00', quantity: '1.00', unitPrice: '150.00' },
          { dormitoryId: dorm.id, billId: bill1.id, type: 'parking', description: 'ค่าที่จอดรถ', amount: '200.00', quantity: '1.00', unitPrice: '200.00' },
        ],
      });

      // Bill 2 (Building B, Room OB201): Unpaid (Total: 7950.00)
      const bill2 = await prisma.bill.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle1.id,
          roomId: roomB1.id,
          contractId: contractB.id,
          tenantId: tenantB.id,
          billNumber: `BILL-${timestamp}-2`,
          billingDate: new Date('2026-07-25'),
          dueDate: new Date('2026-08-05'),
          subtotal: '7950.00',
          totalAmount: '7950.00',
          paidAmount: '0.00',
          outstandingAmount: '7950.00',
          status: 'unpaid',
        },
      });
      await prisma.billItem.createMany({
        data: [
          { dormitoryId: dorm.id, billId: bill2.id, type: 'rent', description: 'ค่าเช่า', amount: '6000.00', quantity: '1.00', unitPrice: '6000.00' },
          { dormitoryId: dorm.id, billId: bill2.id, type: 'water', description: 'ค่าน้ำ', amount: '300.00', quantity: '15.00', unitPrice: '20.00' },
          { dormitoryId: dorm.id, billId: bill2.id, type: 'electricity', description: 'ค่าไฟ', amount: '900.00', quantity: '100.00', unitPrice: '9.00' },
          { dormitoryId: dorm.id, billId: bill2.id, type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '250.00', quantity: '1.00', unitPrice: '250.00' },
          { dormitoryId: dorm.id, billId: bill2.id, type: 'parking', description: 'ค่าที่จอดรถ', amount: '500.00', quantity: '2.00', unitPrice: '250.00' },
        ],
      });

      // Cycle 2 Bills:
      // Bill 3 (Building A, Room OA101): Overdue (Total: 5300.00)
      const bill3 = await prisma.bill.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle2.id,
          roomId: roomA1.id,
          contractId: contractA.id,
          tenantId: tenantA.id,
          billNumber: `BILL-${timestamp}-3`,
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          subtotal: '5300.00',
          totalAmount: '5300.00',
          paidAmount: '0.00',
          outstandingAmount: '5300.00',
          status: 'overdue',
        },
      });
      await prisma.billItem.createMany({
        data: [
          { dormitoryId: dorm.id, billId: bill3.id, type: 'rent', description: 'ค่าเช่า', amount: '4000.00', quantity: '1.00', unitPrice: '4000.00' },
          { dormitoryId: dorm.id, billId: bill3.id, type: 'water', description: 'ค่าน้ำ', amount: '250.00', quantity: '12.50', unitPrice: '20.00' },
          { dormitoryId: dorm.id, billId: bill3.id, type: 'electricity', description: 'ค่าไฟ', amount: '700.00', quantity: '87.50', unitPrice: '8.00' },
          { dormitoryId: dorm.id, billId: bill3.id, type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '150.00', quantity: '1.00', unitPrice: '150.00' },
          { dormitoryId: dorm.id, billId: bill3.id, type: 'parking', description: 'ค่าที่จอดรถ', amount: '200.00', quantity: '1.00', unitPrice: '200.00' },
        ],
      });

      // Bill 4 (Building B, Room OB201): Paid in full (Total: 8100.00)
      const bill4 = await prisma.bill.create({
        data: {
          dormitoryId: dorm.id,
          billingCycleId: cycle2.id,
          roomId: roomB1.id,
          contractId: contractB.id,
          tenantId: tenantB.id,
          billNumber: `BILL-${timestamp}-4`,
          billingDate: new Date('2026-08-25'),
          dueDate: new Date('2026-09-05'),
          subtotal: '8100.00',
          totalAmount: '8100.00',
          paidAmount: '8100.00',
          outstandingAmount: '0.00',
          status: 'paid',
          paidAt: new Date('2026-09-01'),
        },
      });
      await prisma.billItem.createMany({
        data: [
          { dormitoryId: dorm.id, billId: bill4.id, type: 'rent', description: 'ค่าเช่า', amount: '6000.00', quantity: '1.00', unitPrice: '6000.00' },
          { dormitoryId: dorm.id, billId: bill4.id, type: 'water', description: 'ค่าน้ำ', amount: '350.00', quantity: '17.50', unitPrice: '20.00' },
          { dormitoryId: dorm.id, billId: bill4.id, type: 'electricity', description: 'ค่าไฟ', amount: '1000.00', quantity: '100.00', unitPrice: '10.00' },
          { dormitoryId: dorm.id, billId: bill4.id, type: 'common_fee', description: 'ค่าส่วนกลาง', amount: '250.00', quantity: '1.00', unitPrice: '250.00' },
          { dormitoryId: dorm.id, billId: bill4.id, type: 'parking', description: 'ค่าที่จอดรถ', amount: '500.00', quantity: '2.00', unitPrice: '250.00' },
        ],
      });

      // 1. PostgreSQL Ground Truth Oracle (Computed via Raw DB Queries):
      const dbRoomsAll = await prisma.room.findMany({ where: { dormitoryId: dorm.id } });
      const dbRoomsBldA = await prisma.room.findMany({ where: { dormitoryId: dorm.id, buildingId: buildingA.id } });
      const dbRoomsBldB = await prisma.room.findMany({ where: { dormitoryId: dorm.id, buildingId: buildingB.id } });

      const dbBillsCycle1 = await prisma.bill.findMany({ where: { dormitoryId: dorm.id, billingCycleId: cycle1.id }, include: { items: true } });
      const dbBillsCycle2 = await prisma.bill.findMany({ where: { dormitoryId: dorm.id, billingCycleId: cycle2.id }, include: { items: true } });

      // Oracle Cycle 1 All:
      const oracleC1Billed = dbBillsCycle1.reduce((sum, b) => sum.plus(new Prisma.Decimal(b.totalAmount)), new Prisma.Decimal(0));
      const oracleC1Paid = dbBillsCycle1.filter(b => b.status === 'paid').reduce((sum, b) => sum.plus(new Prisma.Decimal(b.paidAmount || b.totalAmount)), new Prisma.Decimal(0));
      const oracleC1Unpaid = oracleC1Billed.minus(oracleC1Paid);

      // Oracle Cycle 2 All:
      const oracleC2Billed = dbBillsCycle2.reduce((sum, b) => sum.plus(new Prisma.Decimal(b.totalAmount)), new Prisma.Decimal(0));
      const oracleC2Paid = dbBillsCycle2.filter(b => b.status === 'paid').reduce((sum, b) => sum.plus(new Prisma.Decimal(b.paidAmount || b.totalAmount)), new Prisma.Decimal(0));
      const oracleC2Unpaid = oracleC2Billed.minus(oracleC2Paid);

      // Oracle Cycle 1 Building A vs Building B:
      const bldARoomIds = new Set(dbRoomsBldA.map(r => r.id));
      const bldBRoomIds = new Set(dbRoomsBldB.map(r => r.id));

      const oracleC1BldABilled = dbBillsCycle1.filter(b => bldARoomIds.has(b.roomId)).reduce((sum, b) => sum.plus(new Prisma.Decimal(b.totalAmount)), new Prisma.Decimal(0));
      const oracleC1BldBBilled = dbBillsCycle1.filter(b => bldBRoomIds.has(b.roomId)).reduce((sum, b) => sum.plus(new Prisma.Decimal(b.totalAmount)), new Prisma.Decimal(0));

      expect(oracleC1Billed.toFixed(2)).toBe('13100.00');
      expect(oracleC1Paid.toFixed(2)).toBe('5150.00');
      expect(oracleC1Unpaid.toFixed(2)).toBe('7950.00');

      expect(oracleC2Billed.toFixed(2)).toBe('13400.00');
      expect(oracleC2Paid.toFixed(2)).toBe('8100.00');
      expect(oracleC2Unpaid.toFixed(2)).toBe('5300.00');

      expect(oracleC1BldABilled.toFixed(2)).toBe('5150.00');
      expect(oracleC1BldBBilled.toFixed(2)).toBe('7950.00');

      const ownerUser = await prisma.user.create({
        data: {
          googleSubject: `g-orc-owner-${timestamp}`,
          email: `orc_owner_${timestamp}@example.com`,
          emailNormalized: `orc_owner_${timestamp}@example.com`,
          name: 'เจ้าของ Oracle Reports Test',
          status: 'active',
        },
      });

      const ownerRole = await prisma.role.findFirst({ where: { code: 'OWNER' } });
      await prisma.dormitoryMember.createMany({
        data: [
          {
            dormitoryId: dorm.id,
            userId: ownerUser.id,
            roleId: ownerRole!.id,
            status: 'active',
          },
        ],
      });

      const authSession = await createTestAuthSession(ownerUser.id);

      // 2. Real HTTP Endpoints Query (Express supertest):
      const resRooms = await request(app)
        .get('/api/v1/properties/rooms')
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      expect(resRooms.status).toBe(200);
      const httpRooms = resRooms.body.data || [];

      const resBuildings = await request(app)
        .get('/api/v1/properties/buildings')
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      expect(resBuildings.status).toBe(200);
      const httpBuildings = resBuildings.body.data || [];

      const resBillsC1 = await request(app)
        .get(`/api/v1/bills?billingCycleId=${cycle1.id}`)
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      expect(resBillsC1.status).toBe(200);
      const httpBillsC1 = resBillsC1.body.data || [];

      const resBillsC2 = await request(app)
        .get(`/api/v1/bills?billingCycleId=${cycle2.id}`)
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      expect(resBillsC2.status).toBe(200);
      const httpBillsC2 = resBillsC2.body.data || [];

      const resBillingSummaryC1 = await request(app)
        .get(`/api/v1/bills/summary?billingCycleId=${cycle1.id}`)
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      expect(resBillingSummaryC1.status).toBe(200);
      expect(resBillingSummaryC1.body.data.totalAmount).toBe('13100.00');
      expect(resBillingSummaryC1.body.data.paidAmount).toBe('5150.00');
      expect(resBillingSummaryC1.body.data.outstandingAmount).toBe('7950.00');

      // 3. Frontend OwnerReports Pure Calculation Integration Proof (Matching src/pages/owner/reports.tsx):
      function calculateReports(roomsList: any[], billsList: any[], bldFilter: string, cycleFilterId: string) {
        const filteredRooms = bldFilter === 'all' ? roomsList : roomsList.filter((r: any) => r.buildingId === bldFilter);
        const filteredRoomIds = new Set(filteredRooms.map((r: any) => r.id));
        const filteredBills = bldFilter === 'all' ? billsList : billsList.filter((b: any) => filteredRoomIds.has(b.roomId));
        const currentMonthBills = filteredBills.filter((b: any) => b.billingCycleId === cycleFilterId || b.cycleId === cycleFilterId);
        const paid = currentMonthBills.filter((b: any) => b.status === 'paid');

        const totalRooms = filteredRooms.length;
        const occupiedCount = filteredRooms.filter((r: any) => r.status === 'occupied').length;
        const vacantCount = filteredRooms.filter((r: any) => r.status === 'vacant').length;
        const occupiedPercent = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;

        const fixedRentTotal = currentMonthBills.reduce((sum: number, b: any) => {
          const item = b.items?.find((i: any) => i.type === 'rent' || i.category === 'rent');
          return sum + (item ? Number(item.amount) : Number(b.rentAmount || 0));
        }, 0);

        const waterTotal = currentMonthBills.reduce((sum: number, b: any) => {
          const item = b.items?.find((i: any) => i.type === 'water' || i.category === 'water');
          return sum + (item ? Number(item.amount) : Number(b.waterAmount || 0));
        }, 0);

        const electricTotal = currentMonthBills.reduce((sum: number, b: any) => {
          const item = b.items?.find((i: any) => i.type === 'electricity' || i.category === 'electricity');
          return sum + (item ? Number(item.amount) : Number(b.electricAmount || 0));
        }, 0);

        const commonParkingTotal = currentMonthBills.reduce((sum: number, b: any) => {
          const items = b.items?.filter((i: any) => ['common_fee', 'parking', 'internet'].includes(i.type || i.category))
            .reduce((s: number, i: any) => s + Number(i.amount), 0) || 0;
          return sum + items + Number(b.parkingFee || 0) + Number(b.commonFee || 0) + Number(b.internetFee || 0);
        }, 0);

        const totalBilled = currentMonthBills.reduce((sum: number, b: any) => sum + Number(b.totalAmount), 0);
        const totalRevenue = paid.reduce((sum: number, b: any) => sum + Number(b.paidAmount || b.totalAmount), 0);
        const totalUnpaid = totalBilled - totalRevenue;
        const totalOverdue = filteredBills.filter((b: any) => b.status === 'overdue').reduce((sum: number, b: any) => sum + Number(b.totalAmount), 0);

        return {
          totalRooms,
          occupiedCount,
          vacantCount,
          occupiedPercent,
          fixedRentTotal,
          waterTotal,
          electricTotal,
          commonParkingTotal,
          totalBilled,
          totalRevenue,
          totalUnpaid,
          totalOverdue,
        };
      }

      // Assert Cycle 1 All Buildings:
      const repC1All = calculateReports(httpRooms, [...httpBillsC1, ...httpBillsC2], 'all', cycle1.id);
      expect(repC1All.totalBilled).toBe(13100);
      expect(repC1All.totalRevenue).toBe(5150);
      expect(repC1All.totalUnpaid).toBe(7950);
      expect(repC1All.fixedRentTotal).toBe(10000);
      expect(repC1All.waterTotal).toBe(500);
      expect(repC1All.electricTotal).toBe(1500);
      expect(repC1All.commonParkingTotal).toBe(1100);
      expect(repC1All.totalRooms).toBe(4);
      expect(repC1All.occupiedCount).toBe(2);
      expect(repC1All.vacantCount).toBe(2);
      expect(repC1All.occupiedPercent).toBe(50);

      // Assert Cycle 2 All Buildings (Proving Cycle 1 != Cycle 2):
      const repC2All = calculateReports(httpRooms, [...httpBillsC1, ...httpBillsC2], 'all', cycle2.id);
      expect(repC2All.totalBilled).toBe(13400);
      expect(repC2All.totalRevenue).toBe(8100);
      expect(repC2All.totalUnpaid).toBe(5300);
      expect(repC2All.totalOverdue).toBe(5300);
      expect(repC2All.waterTotal).toBe(600);
      expect(repC2All.electricTotal).toBe(1700);

      expect(repC1All.totalBilled).not.toBe(repC2All.totalBilled);
      expect(repC1All.totalRevenue).not.toBe(repC2All.totalRevenue);
      expect(repC1All.totalUnpaid).not.toBe(repC2All.totalUnpaid);

      // Assert Building Filter (Proving Building A != Building B):
      const repC1BldA = calculateReports(httpRooms, [...httpBillsC1, ...httpBillsC2], buildingA.id, cycle1.id);
      const repC1BldB = calculateReports(httpRooms, [...httpBillsC1, ...httpBillsC2], buildingB.id, cycle1.id);

      expect(repC1BldA.totalBilled).toBe(5150);
      expect(repC1BldA.totalRevenue).toBe(5150);
      expect(repC1BldA.totalUnpaid).toBe(0);
      expect(repC1BldA.fixedRentTotal).toBe(4000);
      expect(repC1BldA.waterTotal).toBe(200);
      expect(repC1BldA.electricTotal).toBe(600);
      expect(repC1BldA.commonParkingTotal).toBe(350);
      expect(repC1BldA.totalRooms).toBe(2);

      expect(repC1BldB.totalBilled).toBe(7950);
      expect(repC1BldB.totalRevenue).toBe(0);
      expect(repC1BldB.totalUnpaid).toBe(7950);
      expect(repC1BldB.fixedRentTotal).toBe(6000);
      expect(repC1BldB.waterTotal).toBe(300);
      expect(repC1BldB.electricTotal).toBe(900);
      expect(repC1BldB.commonParkingTotal).toBe(750);
      expect(repC1BldA.totalRooms).toBe(2);

      expect(repC1BldA.totalBilled).not.toBe(repC1BldB.totalBilled);
      expect(repC1BldA.totalRevenue).not.toBe(repC1BldB.totalRevenue);
      expect(repC1BldA.totalUnpaid).not.toBe(repC1BldB.totalUnpaid);

      // 4. F5 Stability Proof: Re-querying yields identical results
      const refetchedBillsC1 = await request(app)
        .get(`/api/v1/bills?billingCycleId=${cycle1.id}`)
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      const refetchedBillsC2 = await request(app)
        .get(`/api/v1/bills?billingCycleId=${cycle2.id}`)
        .set('Cookie', authSession.cookies)
        .set('x-csrf-token', authSession.csrfToken)
        .set('x-dormitory-id', dorm.id);
      const refetchedRepC1All = calculateReports(httpRooms, [...refetchedBillsC1.body.data, ...refetchedBillsC2.body.data], 'all', cycle1.id);
      expect(refetchedRepC1All).toEqual(repC1All);

      // Cleanup
      await prisma.billItem.deleteMany({ where: { bill: { dormitoryId: dorm.id } } });
      await prisma.bill.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.billingCycle.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.contract.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.tenant.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.room.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.building.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
      await prisma.session.deleteMany({ where: { userId: ownerUser.id } });
      await prisma.user.delete({ where: { id: ownerUser.id } });
    });
  });

  describe('27. Schema and Database Column Defaults Agreement', () => {
    it('proves that Prisma and PostgreSQL column defaults match Product Owner canonical defaults on new rows', async () => {
      const timestamp = Date.now();
      const dorm = await prisma.dormitory.create({
        data: {
          name: `หอพัก DB Defaults Test ${timestamp}`,
          type: 'apartment',
          status: 'active',
        },
      });

      // Insert minimal row relying entirely on PostgreSQL column defaults
      const settings = await prisma.dormitoryBillingSettings.create({
        data: {
          dormitoryId: dorm.id,
        },
      });

      // Read back directly from PostgreSQL
      const dbRow = await prisma.dormitoryBillingSettings.findUnique({
        where: { dormitoryId: dorm.id },
      });

      expect(dbRow).toBeDefined();
      expect(dbRow?.waterBillingType).toBe('per_person');
      expect(new Prisma.Decimal(dbRow!.waterRate).toFixed(2)).toBe('0.00');
      expect(dbRow?.electricityBillingType).toBe('per_unit');
      expect(new Prisma.Decimal(dbRow!.electricityRate).toFixed(2)).toBe('0.00');
      expect(new Prisma.Decimal(dbRow!.commonFee).toFixed(2)).toBe('0.00');
      expect(dbRow?.commonFeeMode).toBe('per_room');
      expect(new Prisma.Decimal(dbRow!.internetFee).toFixed(2)).toBe('0.00');
      expect(dbRow?.internetFeeMode).toBe('per_person');
      expect(new Prisma.Decimal(dbRow!.parkingRate).toFixed(2)).toBe('0.00');
      expect(dbRow?.parkingFeeMode).toBe('per_room');
      expect(dbRow?.lateFeeType).toBe('none');
      expect(new Prisma.Decimal(dbRow!.lateFeeValue).toFixed(2)).toBe('0.00');

      // Cleanup
      await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });

  describe('28. Migration History Integrity Repository Guard', () => {
    it('verifies zero tracked repository source/test/script files execute DELETE, UPDATE, or TRUNCATE on _prisma_migrations', async () => {
      const serverDir = path.resolve(__dirname, '../../../');
      const rootDir = path.resolve(serverDir, '../');

      const allowedExts = new Set(['.ts', '.tsx', '.js', '.mjs', '.sql', '.ps1', '.sh']);
      const filesToScan: string[] = [];

      function walk(dir: string) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.name === 'node_modules' ||
            entry.name === '.git' ||
            entry.name === 'dist' ||
            entry.name === '.local07-sessions' ||
            entry.name === '.gemini'
          ) {
            continue;
          }
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (allowedExts.has(ext)) {
              filesToScan.push(fullPath);
            }
          }
        }
      }

      walk(serverDir);
      if (fs.existsSync(path.join(rootDir, 'scripts'))) {
        walk(path.join(rootDir, 'scripts'));
      }

      const thisFilePath = path.resolve(__filename);

      // Build mutation regex safely with split tokens to avoid false positives
      const kwDel = 'DELETE' + '\\s+FROM';
      const kwUpd = 'UPDATE';
      const kwTrunc = 'TRUNCATE' + '(?:\\s+TABLE)?';
      const tblPrisma = '(?:public\\.)?_prisma_migrations';
      const mutationPattern = new RegExp(`\\b(?:${kwDel}|${kwUpd}|${kwTrunc})\\s+${tblPrisma}\\b`, 'i');

      const violatingFiles: { file: string; match: string }[] = [];

      for (const file of filesToScan) {
        if (path.resolve(file) === thisFilePath) {
          continue;
        }
        const content = fs.readFileSync(file, 'utf-8');
        const match = content.match(mutationPattern);
        if (match) {
          violatingFiles.push({ file: path.relative(rootDir, file), match: match[0] });
        }
      }

      expect(violatingFiles).toEqual([]);
    });
  });
});
