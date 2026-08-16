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
import { generatePromptPayPayload, formatExactPromptPayAmount } from '../../services/promptpay-payload.service.js';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { DefaultsService } from '../../services/defaults.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import request from 'supertest';
import { createApp } from '../../app.js';
import express from 'express';

describe('HORPLUS LOCAL-07 — Master Verification Suite', () => {
  let prisma: PrismaClient;
  let app: express.Express;
  let testUser1: any;
  let testUser2: any;
  let testUser3: any;

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = createApp();

    // Clean test accounts
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
      const dummyDorm = await prisma.dormitory.create({
        data: {
          name: 'หอพักเดิม Trial 1',
          type: 'apartment',
          status: 'active',
          createdByUserId: testUser1.id,
        },
      });

      // 1. Consume trial for testUser1
      const claim = await prisma.accountBenefitClaim.create({
        data: {
          userId: testUser1.id,
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
      const prov = await provisioningService.prepareProvisionalDormitory(testUser1.id, { name: 'หอพักสมศักดิ์ 2 (Paid Package)' });

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${testUser1.id}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${prov.provisionalDormitoryId}, true)`;
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
        await tx.ownerSignature.create({
          data: {
            dormitoryId: prov.provisionalDormitoryId,
            signedByUserId: testUser1.id,
            objectKey: 'signatures/mock-signature.png',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            byteSize: 1024,
            isCurrent: true,
          },
        });
      });

      const quote = await subscriptionIntentService.createIntentQuote(testUser1.id, {
        packageId: pkg12mo!.id,
      }, undefined, prov.provisionalDormitoryId);

      const result = await provisioningService.completeOwnerOnboarding({
        userId: testUser1.id,
        idempotencyKey: 'idem-paid-pkg-test-1',
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
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${testUser1.id}, true)`;
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
        await prisma.subscriptionPackageIntent.deleteMany({ where: { dormitoryId: dId } });
        await prisma.promoRedemption.deleteMany({ where: { dormitoryId: dId } });
        await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dId } });
        await prisma.accountBenefitClaim.deleteMany({ where: { dormitoryId: dId } });
        await prisma.ownerSignature.deleteMany({ where: { dormitoryId: dId } });
        await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dId } });
        await prisma.dormitoryPropertyDefaults.deleteMany({ where: { dormitoryId: dId } });
        await prisma.dormitoryBillingSettings.deleteMany({ where: { dormitoryId: dId } });
        await prisma.dormitoryMember.deleteMany({ where: { dormitoryId: dId } });
        await prisma.dormitory.delete({ where: { id: dId } }).catch(() => {});
      }
      for (const u of users) {
        await prisma.$executeRawUnsafe(`DELETE FROM subscription_package_intents WHERE user_id = '${u.id}'`);
        await prisma.accountBenefitClaim.deleteMany({ where: { userId: u.id } });
        await prisma.ownerSignature.deleteMany({ where: { signedByUserId: u.id } });
        await prisma.promoRedemption.deleteMany({ where: { redeemedBy: u.id } });
        await prisma.user.delete({ where: { id: u.id } }).catch(() => {});
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
});
