/**
 * Server-Authoritative Subscription Package Intent & Checkout Service (LOCAL-07 Master)
 * Invariants:
 * - Exact Decimal arithmetic (no Number() money authority)
 * - Server-resolved dormitory ID from active OnboardingDraft
 * - Zero-pay checkout activates only newly validated intents (checkoutVersion >= 2, finalPayableAmount == 0)
 * - Paid intents (finalPayableAmount > 0) remain PENDING_PAYMENT until verified server payment
 * @license Apache-2.0
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { coinWalletService } from './coin-wallet.service.js';
import { referralService } from './referral.service.js';
import { promoService } from './promo.service.js';
import { addCalendarMonths } from './subscription-entitlement.service.js';

export interface CreateIntentQuoteParams {
  packageId?: string;
  isFreePlan?: boolean;
  promoCode?: string;
  referralCode?: string;
  coinRequested?: number;
}

export class SubscriptionIntentService {
  private prisma: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || getPrismaClient();
  }

  /**
   * Derive server-authoritative dormitory ID from authenticated OnboardingDraft
   */
  async resolveOnboardingDormitoryId(userId: string, txClient?: any): Promise<string> {
    const db = txClient || this.prisma;
    const draft = await db.onboardingDraft.findFirst({
      where: {
        userId,
        finalizedAt: null,
      },
    });

    if (draft && draft.provisionalDormitoryId) {
      return draft.provisionalDormitoryId;
    }

    // Check if user owns an existing dormitory
    const ownedDorm = await db.dormitory.findFirst({
      where: {
        createdByUserId: userId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (ownedDorm) {
      return ownedDorm.id;
    }

    // If no draft exists yet, create a provisional draft & dormitory
    const provisionalDorm = await db.dormitory.create({
      data: {
        name: 'หอพักใหม่',
        type: 'apartment',
        status: 'setup_pending',
        createdByUserId: userId,
      },
    });

    await db.onboardingDraft.upsert({
      where: { userId },
      create: {
        userId,
        currentStep: 'packages',
        provisionalDormitoryId: provisionalDorm.id,
        payload: {},
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      },
      update: {
        provisionalDormitoryId: provisionalDorm.id,
      },
    });

    return provisionalDorm.id;
  }

  /**
   * Create server-authoritative pricing quote snapshot in SubscriptionPackageIntent
   */
  async createIntentQuote(userId: string, params: CreateIntentQuoteParams, txClient?: any) {
    const runInTx = async (tx: any) => {
      const dormitoryId = await this.resolveOnboardingDormitoryId(userId, tx);
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;

      // 1. Resolve Package
      let pkg: any = null;
      let durationMonths = 0;
      let referencePrice: Prisma.Decimal | null = null;
      let basePrice = new Prisma.Decimal(0);
      let isFreePlan = Boolean(params.isFreePlan);

      if (!isFreePlan && params.packageId) {
        pkg = await tx.subscriptionPackage.findUnique({
          where: { id: params.packageId },
          include: { plan: true },
        });

        if (!pkg || !pkg.enabled) {
          throw new AppError('ไม่พบแพ็กเกจที่เลือก หรือแพ็กเกจถูกปิดใช้งาน', 404, 'PACKAGE_NOT_FOUND');
        }

        durationMonths = pkg.durationMonths;
        referencePrice = pkg.referencePrice ? new Prisma.Decimal(pkg.referencePrice) : null;
        basePrice = pkg.price ? new Prisma.Decimal(pkg.price) : new Prisma.Decimal(0);
      } else {
        // Free plan
        const freePlan = await tx.subscriptionPlan.findUnique({
          where: { code: 'FREE' },
        });
        if (!freePlan) {
          throw new AppError('ไม่พบแพ็กเกจฟรีในระบบ', 500, 'FREE_PLAN_NOT_FOUND');
        }
        durationMonths = 0;
        basePrice = new Prisma.Decimal(0);
        isFreePlan = true;
      }

      // 2. Check 1-Month PRO Trial Eligibility for this Google Account
      let isTrialEligible = false;
      let priceAfterTrial = basePrice;

      if (!isFreePlan && durationMonths === 1) {
        const existingTrialClaim = await tx.accountBenefitClaim.findFirst({
          where: {
            userId,
            benefitKey: 'INITIAL_TRIAL_V1',
          },
        });

        if (!existingTrialClaim) {
          isTrialEligible = true;
          priceAfterTrial = new Prisma.Decimal(0); // First month PRO is free trial
        } else {
          isTrialEligible = false;
          priceAfterTrial = basePrice; // 189.00 THB
        }
      }

      // 3. Evaluate HORPLUS Promo Code (if provided)
      let promoBonusMonths = 0;
      let validatedPromoCode: string | null = null;
      if (params.promoCode && params.promoCode.trim()) {
        const promoRes = await promoService.validatePromo(params.promoCode, userId, dormitoryId, tx);
        if (promoRes.valid && promoRes.eligible) {
          promoBonusMonths = promoRes.promoBonusMonths;
          validatedPromoCode = promoRes.code;
        }
      }

      // 4. Evaluate Referral Code (if provided)
      let validatedReferralCode: string | null = null;
      let provisionalReferralCoin = 0;
      if (params.referralCode && params.referralCode.trim()) {
        const refRes = await referralService.validateAndBindReferral(userId, params.referralCode, dormitoryId, tx);
        if (refRes.valid) {
          validatedReferralCode = refRes.referralCode;
          provisionalReferralCoin = refRes.provisionalCoin;
        }
      } else {
        // Check if account already has a bound referral attribution
        const existingAttribution = await referralService.getAttributionForUser(userId, tx);
        if (existingAttribution && existingAttribution.status === 'PENDING') {
          validatedReferralCode = existingAttribution.referralCodeSnapshot;
          provisionalReferralCoin = existingAttribution.provisionalCoinGranted;
        }
      }

      // 5. Calculate Integer Coin Deduction
      const coinBalance = await coinWalletService.getBalance(userId, tx);
      const totalAvailableCoin = coinBalance + provisionalReferralCoin;

      let coinRequested = Number.isInteger(params.coinRequested) && (params.coinRequested ?? 0) > 0 ? (params.coinRequested ?? 0) : 0;
      // Cannot request more than available coins
      coinRequested = Math.min(coinRequested, totalAvailableCoin);

      // Convert exact money floor: max coin that can be applied to priceAfterTrial
      const priceAfterTrialInt = priceAfterTrial.floor().toNumber();
      const coinApplied = Math.min(coinRequested, priceAfterTrialInt);

      // 6. Compute Final Payable Amount using exact Decimal subtraction
      const finalPayable = priceAfterTrial.minus(new Prisma.Decimal(coinApplied));
      const finalPayableAmount = finalPayable.lessThan(new Prisma.Decimal(0))
        ? new Prisma.Decimal(0)
        : finalPayable;

      const isZeroPay = finalPayableAmount.equals(new Prisma.Decimal(0));

      // 7. Persist Intent Snapshot
      // If free plan, find or link packageId if available
      const targetPackageId = pkg ? pkg.id : (await tx.subscriptionPackage.findFirst({ where: { plan: { code: 'FREE' } } }))?.id || params.packageId;

      const intent = await tx.subscriptionPackageIntent.create({
        data: {
          dormitoryId,
          userId,
          packageId: targetPackageId,
          status: 'PENDING_PAYMENT',
          durationMonthsSnapshot: durationMonths,
          priceSnapshot: basePrice,
          referencePriceSnapshot: referencePrice,
          isTrialEligibleSnapshot: isTrialEligible,
          promoCodeSnapshot: validatedPromoCode,
          promoBonusMonthsSnapshot: promoBonusMonths,
          referralCodeSnapshot: validatedReferralCode,
          coinRequested,
          coinApplied,
          finalPayableAmount,
          checkoutVersion: 2, // Explicit Version 2 for LOCAL-07 lifecycle
          isZeroPayValidated: isZeroPay,
          currencySnapshot: 'THB',
          catalogVersion: 2,
          expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes quote TTL
        },
      });

      return {
        intentId: intent.id,
        dormitoryId,
        packageId: targetPackageId,
        isFreePlan,
        durationMonths,
        basePrice: basePrice.toFixed(2),
        referencePrice: referencePrice ? referencePrice.toFixed(2) : null,
        isTrialEligible,
        promoCode: validatedPromoCode,
        promoBonusMonths,
        referralCode: validatedReferralCode,
        totalAvailableCoin,
        coinApplied,
        finalPayableAmount: finalPayableAmount.toFixed(2),
        checkoutVersion: intent.checkoutVersion,
        isZeroPay,
        isZeroPayValidated: isZeroPay,
        expiresAt: intent.expiresAt,
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }

  /**
   * Commit zero-pay intent to activate subscription (Free plan, 1-mo PRO trial, or 100% Coin discount)
   */
  async commitZeroPayIntent(userId: string, intentId: string, idempotencyKey?: string, txClient?: any) {
    const runInTx = async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;

      // 1. Lock intent for update
      await tx.$executeRaw`SELECT * FROM "subscription_package_intents" WHERE "id" = ${intentId}::uuid FOR UPDATE`;

      const intent = await tx.subscriptionPackageIntent.findUnique({
        where: { id: intentId },
        include: { package: { include: { plan: true } } },
      });

      if (!intent) {
        throw new AppError('ไม่พบข้อมูลรายการสั่งซื้อ', 404, 'INTENT_NOT_FOUND');
      }

      if (intent.userId !== userId) {
        throw new AppError('ไม่มีสิทธิ์เข้าถึงรายการสั่งซื้อนี้', 403, 'FORBIDDEN_INTENT_ACCESS');
      }

      // Replay idempotency check
      if (intent.status === 'ACTIVATED') {
        return { success: true, status: 'ACTIVATED', message: 'รายการนี้ได้รับการเปิดใช้งานแล้ว' };
      }

      const now = new Date();

      if (intent.expiresAt && intent.expiresAt < now) {
        throw new AppError('รายการสั่งซื้อหมดอายุแล้ว กรุณาทำรายการใหม่อีกครั้ง', 400, 'INTENT_EXPIRED');
      }

      // Mandatory Guard 2: Explicit checkout lifecycle and exact Decimal zero check
      if (intent.checkoutVersion < 2) {
        throw new AppError('รายการสั่งซื้อนี้เป็นเวอร์ชันเดิม ไม่สามารถเปิดใช้งานอัตโนมัติได้', 400, 'LEGACY_INTENT_UNACTIVATABLE');
      }

      if (!intent.finalPayableAmount || !intent.finalPayableAmount.equals(new Prisma.Decimal(0)) || !intent.isZeroPayValidated) {
        throw new AppError(
          'รายการนี้มียอดที่ต้องชำระ ไม่สามารถเปิดใช้งานอัตโนมัติได้โดยไม่ผ่านการยืนยันชำระเงิน',
          400,
          'PAYMENT_REQUIRED'
        );
      }

      // 2. Lock and Debit Coin Wallet if Coin was applied
      if (intent.coinApplied > 0) {
        await coinWalletService.debitWallet(
          userId,
          intent.coinApplied,
          'SUBSCRIPTION_DEBIT',
          'SUBSCRIPTION_PACKAGE_INTENT',
          intent.id,
          `ชำระค่าแพ็กเกจ ${intent.package?.plan?.name || 'HorPlus'} (${intent.durationMonthsSnapshot} เดือน)`,
          idempotencyKey ? `zero-pay-coin-${intent.id}-${idempotencyKey}` : `zero-pay-coin-${intent.id}`,
          tx
        );
      }

      // 3. Resolve Subscription Plan & Duration Mutation
      const proPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      const freePlan = await tx.subscriptionPlan.findUnique({ where: { code: 'FREE' } });

      let targetPlanId = intent.package?.planId || (intent.isFreePlanSnapshot ? freePlan.id : proPlan.id);
      let subStatus: 'TRIAL' | 'ACTIVE' = 'ACTIVE';
      let subExpiresAt: Date | null = null;
      let durationMonths = 0;

      if (intent.isTrialEligibleSnapshot) {
        subStatus = 'TRIAL';
        durationMonths = 1 + (intent.promoBonusMonthsSnapshot || 0);
        subExpiresAt = addCalendarMonths(now, durationMonths);
        targetPlanId = proPlan.id;
      } else if (intent.isFreePlanSnapshot) {
        subStatus = 'ACTIVE';
        subExpiresAt = null;
        targetPlanId = freePlan.id;
      } else {
        // Paid package (e.g. 100% coin discount or promo bonus)
        subStatus = 'ACTIVE';
        durationMonths = intent.durationMonthsSnapshot + (intent.promoBonusMonthsSnapshot || 0);
        subExpiresAt = addCalendarMonths(now, durationMonths);
        targetPlanId = proPlan.id;
      }

      const sub = await tx.dormitorySubscription.upsert({
        where: { dormitoryId: intent.dormitoryId },
        create: {
          dormitoryId: intent.dormitoryId,
          planId: targetPlanId,
          status: subStatus,
          startedAt: now,
          expiresAt: subExpiresAt,
          trialStartedAt: intent.isTrialEligibleSnapshot ? now : null,
          trialExpiresAt: intent.isTrialEligibleSnapshot ? addCalendarMonths(now, 1) : null,
          promoExtendedAt: intent.promoBonusMonthsSnapshot > 0 ? now : null,
        },
        update: {
          planId: targetPlanId,
          status: subStatus,
          startedAt: now,
          expiresAt: subExpiresAt,
          trialStartedAt: intent.isTrialEligibleSnapshot ? now : null,
          trialExpiresAt: intent.isTrialEligibleSnapshot ? addCalendarMonths(now, 1) : null,
          promoExtendedAt: intent.promoBonusMonthsSnapshot > 0 ? now : null,
          updatedAt: now,
        },
      });

      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: sub.id,
          dormitoryId: intent.dormitoryId,
          previousPlanId: null,
          newPlanId: targetPlanId,
          previousStatus: null,
          newStatus: subStatus,
          reason: intent.isTrialEligibleSnapshot ? 'INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL' : 'ZERO_PAY_INTENT_ACTIVATED',
          actorId: userId,
        },
      });

      // 4. Claim Initial Trial if applicable
      if (intent.isTrialEligibleSnapshot) {
        await tx.accountBenefitClaim.upsert({
          where: {
            user_benefit_unique: {
              userId,
              benefitKey: 'INITIAL_TRIAL_V1',
            },
          },
          create: {
            userId,
            benefitKey: 'INITIAL_TRIAL_V1',
            dormitoryId: intent.dormitoryId,
            subscriptionId: sub.id,
            grantedMonths: 1,
            previousExpiresAt: null,
            newExpiresAt: addCalendarMonths(now, 1),
          },
          update: {},
        });
      }

      // 5. Redeem Promo Code atomically if applicable
      if (intent.promoCodeSnapshot) {
        await promoService.redeemPromoAtomic(userId, intent.dormitoryId, intent.promoCodeSnapshot, tx);
      }

      // 6. Mark intent ACTIVATED
      await tx.subscriptionPackageIntent.update({
        where: { id: intent.id },
        data: {
          status: 'ACTIVATED',
          activatedAt: now,
          idempotencyKey: idempotencyKey || null,
        },
      });

      return {
        success: true,
        status: 'ACTIVATED',
        dormitoryId: intent.dormitoryId,
        subscriptionId: sub.id,
        planCode: intent.isFreePlanSnapshot ? 'FREE' : 'PAID',
        durationMonths,
        expiresAt: subExpiresAt,
        coinDebited: intent.coinApplied,
        isTrial: intent.isTrialEligibleSnapshot,
        promoBonusMonths: intent.promoBonusMonthsSnapshot,
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }
}

export const subscriptionIntentService = new SubscriptionIntentService();
