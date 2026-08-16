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
   * Derive server-authoritative dormitory ID from context, draft, or membership
   */
  async resolveOnboardingDormitoryId(userId: string, txClient?: any, requestedDormitoryId?: string): Promise<string> {
    const db = txClient || this.prisma;

    // 1. If explicit requestedDormitoryId is provided, verify ownership/membership
    if (requestedDormitoryId) {
      // Check active membership with OWNER/ADMIN role
      const member = await db.dormitoryMember.findFirst({
        where: {
          dormitoryId: requestedDormitoryId,
          userId,
          status: 'active',
          role: { code: { in: ['OWNER', 'ADMIN'] } },
        },
      });
      if (member) {
        return requestedDormitoryId;
      }

      // Or check provisional dormitory created by user
      const provDorm = await db.dormitory.findFirst({
        where: {
          id: requestedDormitoryId,
          createdByUserId: userId,
          status: 'setup_pending',
          deletedAt: null,
        },
      });
      if (provDorm) {
        return requestedDormitoryId;
      }

      throw new AppError('ไม่มีสิทธิ์เข้าถึงหอพักที่ระบุสำหรับแพ็กเกจนี้', 403, 'FORBIDDEN_DORMITORY_ACCESS');
    }

    // 2. Check active onboarding draft
    const draft = await db.onboardingDraft.findFirst({
      where: {
        userId,
        finalizedAt: null,
      },
    });

    if (draft && draft.provisionalDormitoryId) {
      return draft.provisionalDormitoryId;
    }

    // 3. Post-onboarding context: Check user's active memberships
    const activeMemberships = await db.dormitoryMember.findMany({
      where: {
        userId,
        status: 'active',
        role: { code: { in: ['OWNER', 'ADMIN'] } },
      },
    });

    if (activeMemberships.length === 1) {
      return activeMemberships[0].dormitoryId;
    } else if (activeMemberships.length > 1) {
      throw new AppError(
        'กรุณาระบุหอพักที่ต้องการดำเนินการ (Dormitory context required for multi-dorm owner)',
        400,
        'DORMITORY_CONTEXT_REQUIRED'
      );
    }

    // 4. If no draft or existing dorms, create provisional draft & dormitory
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
  async createIntentQuote(userId: string, params: CreateIntentQuoteParams, txClient?: any, requestedDormitoryId?: string) {
    const runInTx = async (tx: any) => {
      const dormitoryId = await this.resolveOnboardingDormitoryId(userId, tx, requestedDormitoryId);
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;

      // 1. Resolve Package
      let pkg: any = null;
      let durationMonths = 0;
      let referencePrice: Prisma.Decimal | null = null;
      let basePrice = new Prisma.Decimal(0);
      let isFreePlan = Boolean(params.isFreePlan);

      if (!isFreePlan) {
        if (params.packageId) {
          pkg = await tx.subscriptionPackage.findUnique({
            where: { id: params.packageId },
            include: { plan: true },
          });
        } else {
          pkg = await tx.subscriptionPackage.findFirst({
            where: { durationMonths: 1, enabled: true },
            include: { plan: true },
          });
        }

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

      // 5. Calculate Integer Coin Deduction (Exact Decimal/string minor-unit arithmetic)
      const coinBalance = await coinWalletService.getBalance(userId, tx);
      const totalAvailableCoin = coinBalance + provisionalReferralCoin;

      let coinRequested = Number.isInteger(params.coinRequested) && (params.coinRequested ?? 0) > 0 ? (params.coinRequested ?? 0) : 0;
      // Cannot request more than available coins
      coinRequested = Math.min(coinRequested, totalAvailableCoin);

      // Derive maximum applicable Coin using exact Decimal without Float/JS Number conversion
      const maxCoinPayableDecimal = priceAfterTrial.floor();
      const coinRequestedDecimal = new Prisma.Decimal(coinRequested);
      const coinAppliedDecimal = Prisma.Decimal.min(coinRequestedDecimal, maxCoinPayableDecimal);
      const coinApplied = parseInt(coinAppliedDecimal.toFixed(0), 10);

      // 6. Compute Final Payable Amount using exact Decimal subtraction
      const finalPayable = priceAfterTrial.minus(new Prisma.Decimal(coinApplied));
      const finalPayableAmount = finalPayable.lessThan(new Prisma.Decimal(0))
        ? new Prisma.Decimal(0)
        : finalPayable;

      const isZeroPay = finalPayableAmount.equals(new Prisma.Decimal(0));

      // 7. Persist Intent Snapshot
      // If free plan, link to 1-mo default package
      const targetPackageId = pkg
        ? pkg.id
        : (await tx.subscriptionPackage.findFirst({ where: { durationMonths: 1 } }))?.id || params.packageId;

      // Supersede / expire older pending quote intents for this dormitory/user
      await tx.subscriptionPackageIntent.updateMany({
        where: {
          dormitoryId,
          userId,
          status: 'PENDING_PAYMENT',
        },
        data: {
          status: 'EXPIRED',
        },
      });

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
   * Canonical single implementation for all zero-pay financial state transitions.
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

      // Replay idempotency check (Terminal status is SUCCEEDED)
      if (intent.status === 'SUCCEEDED' || intent.status === 'ACTIVATED') {
        const existingSub = await tx.dormitorySubscription.findUnique({
          where: { dormitoryId: intent.dormitoryId },
          include: { plan: true },
        });
        const isFreeReplay = intent.durationMonthsSnapshot === 0 && !intent.isTrialEligibleSnapshot;
        return {
          success: true,
          status: 'SUCCEEDED',
          isReplay: true,
          packageIntentId: intent.id,
          dormitoryId: intent.dormitoryId,
          subscriptionId: existingSub?.id || '',
          planCode: existingSub?.plan?.code || (isFreeReplay ? 'FREE' : 'PAID'),
          durationMonths: intent.durationMonthsSnapshot,
          expiresAt: existingSub?.expiresAt || null,
          coinDebited: intent.coinApplied,
          isTrial: intent.isTrialEligibleSnapshot,
          promoBonusMonths: intent.promoBonusMonthsSnapshot,
          message: 'รายการนี้ได้รับการเปิดใช้งานแล้ว',
        };
      } else if (intent.status !== 'PENDING_PAYMENT') {
        throw new AppError('สถานะรายการสั่งซื้อไม่ถูกต้อง', 400, 'INVALID_INTENT_STATUS');
      }

      const now = new Date();

      if (intent.expiresAt && intent.expiresAt < now) {
        throw new AppError('รายการสั่งซื้อหมดอายุแล้ว กรุณาทำรายการใหม่อีกครั้ง', 400, 'INTENT_EXPIRED');
      }

      // Mandatory Guard: Explicit checkout lifecycle version 2+
      if (intent.checkoutVersion < 2) {
        throw new AppError('รายการสั่งซื้อนี้เป็นเวอร์ชันเดิม ไม่สามารถเปิดใช้งานอัตโนมัติได้', 400, 'LEGACY_INTENT_UNACTIVATABLE');
      }

      // Require BOTH finalPayableAmount === 0 AND isZeroPayValidated === true
      if (!intent.finalPayableAmount || !intent.finalPayableAmount.equals(new Prisma.Decimal(0)) || intent.isZeroPayValidated !== true) {
        throw new AppError(
          'รายการนี้มียอดที่ต้องชำระ หรือไม่ผ่านการตรวจสอบความถูกต้อง ไม่สามารถเปิดใช้งานอัตโนมัติได้',
          400,
          'ZERO_PAY_UNVALIDATED'
        );
      }

      // Revalidate INITIAL_TRIAL_V1 at commit time
      if (intent.isTrialEligibleSnapshot) {
        const existingClaim = await tx.accountBenefitClaim.findFirst({
          where: {
            userId,
            benefitKey: 'INITIAL_TRIAL_V1',
          },
        });
        if (existingClaim) {
          throw new AppError('สิทธิ์ทดลองใช้งานฟรี 1 เดือนถูกใช้งานไปแล้ว กรุณาขอใบเสนอราคาใหม่', 409, 'TRIAL_ALREADY_CLAIMED');
        }
      }

      // 2. Lock and Debit Coin Wallet if Coin was applied (Exactly Once)
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

      // 3. Resolve Subscription Plan & Set BASE Entitlement Duration (PromoService performs the +2 extension)
      const proPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      const freePlan = await tx.subscriptionPlan.findUnique({ where: { code: 'FREE' } });

      const isFree = intent.durationMonthsSnapshot === 0 && !intent.isTrialEligibleSnapshot;
      let targetPlanId = isFree ? freePlan.id : (intent.package?.planId || proPlan.id);
      let subStatus: 'TRIAL' | 'ACTIVE' = 'ACTIVE';
      let subExpiresAt: Date | null = null;
      let durationMonths = 0;

      if (intent.isTrialEligibleSnapshot) {
        subStatus = 'TRIAL';
        durationMonths = 1;
        subExpiresAt = addCalendarMonths(now, 1);
        targetPlanId = proPlan.id;
      } else if (isFree) {
        subStatus = 'ACTIVE';
        subExpiresAt = addCalendarMonths(now, 1200);
        targetPlanId = freePlan.id;
      } else {
        // Paid package (e.g. 100% coin discount or promo bonus)
        subStatus = 'ACTIVE';
        durationMonths = intent.durationMonthsSnapshot;
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
          promoExtendedAt: null,
        },
        update: {
          planId: targetPlanId,
          status: subStatus,
          startedAt: now,
          expiresAt: subExpiresAt,
          trialStartedAt: intent.isTrialEligibleSnapshot ? now : null,
          trialExpiresAt: intent.isTrialEligibleSnapshot ? addCalendarMonths(now, 1) : null,
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

      // 5. Redeem Promo Code atomically if applicable (PromoService performs the single +2 months bonus extension)
      let promoApplied = false;
      let promoBonusMonths = 0;
      if (intent.promoCodeSnapshot) {
        const promoRes = await promoService.redeemPromoAtomic(userId, intent.dormitoryId, intent.promoCodeSnapshot, tx);
        promoApplied = Boolean((promoRes as any).success ?? promoRes.body?.success ?? promoRes.id);
        promoBonusMonths = promoRes.bonusMonths || promoRes.body?.data?.bonusMonths || 2;
        const updatedSub = await tx.dormitorySubscription.findUnique({ where: { id: sub.id } });
        if (updatedSub) {
          subExpiresAt = updatedSub.expiresAt;
        }
      }

      // 6. Mark intent SUCCEEDED
      await tx.subscriptionPackageIntent.update({
        where: { id: intent.id },
        data: {
          status: 'SUCCEEDED',
          activatedAt: now,
          isZeroPayValidated: true,
        },
      });

      return {
        success: true,
        status: 'SUCCEEDED',
        dormitoryId: intent.dormitoryId,
        subscriptionId: sub.id,
        planCode: intent.isFreePlanSnapshot ? 'FREE' : 'PAID',
        durationMonths,
        expiresAt: subExpiresAt,
        coinDebited: intent.coinApplied,
        isTrial: intent.isTrialEligibleSnapshot,
        promoBonusMonths,
        promoApplied,
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }
}

export const subscriptionIntentService = new SubscriptionIntentService();
