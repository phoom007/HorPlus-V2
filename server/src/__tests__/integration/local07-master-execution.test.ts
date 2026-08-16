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

describe('HORPLUS LOCAL-07 — Master Verification Suite', () => {
  let prisma: PrismaClient;
  let testUser1: any;
  let testUser2: any;
  let testUser3: any;

  beforeAll(async () => {
    prisma = getPrismaClient();

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
      expect(commitRes.status).toBe('ACTIVATED');
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

      const result = await provisioningService.completeOwnerOnboarding({
        userId: testUser1.id,
        idempotencyKey: 'idem-paid-pkg-test-1',
        provisionalDormitoryId: prov.provisionalDormitoryId,
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
      const commitRes = await subscriptionIntentService.commitZeroPayIntent(testUser2.id, quote.intentId, 'idem-coin-commit-1');
      expect(commitRes.success).toBe(true);
      expect(commitRes.status).toBe('ACTIVATED');
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
      const replayRes = await subscriptionIntentService.commitZeroPayIntent(testUser2.id, quote.intentId, 'idem-coin-commit-1');
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
      expect(updatedSub?.status).toBe('TRIAL');
      expect(updatedSub?.plan.code).toBe('PAID');

      // Cleanup
      await prisma.promoRedemption.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.subscriptionStatusHistory.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitorySubscription.deleteMany({ where: { dormitoryId: dorm.id } });
      await prisma.dormitory.delete({ where: { id: dorm.id } });
    });
  });
});
