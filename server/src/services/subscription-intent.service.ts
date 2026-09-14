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
  dormitoryId?: string;
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
    await db.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;

    // 0. Support Direct Access Grant sessions (Manager & Direct Owner)
    const isDirectAccess = userId.startsWith('ag_user_') || userId.startsWith('ag_');
    if (isDirectAccess) {
      const grantId = userId.replace(/^ag_user_|^ag_/, '');
      let targetDormitoryId = requestedDormitoryId;
      if (!targetDormitoryId) {
        const rows = await db.$queryRaw<any[]>`
          SELECT dormitory_id FROM public.resolve_access_grant_by_id(${grantId}::uuid)
        `.catch(() => []);
        if (rows && rows.length > 0) {
          targetDormitoryId = rows[0].dormitory_id;
        }
      }

      if (targetDormitoryId) {
        await db.$executeRaw`SELECT set_config('app.current_dormitory_id', ${targetDormitoryId}, true)`;
        const grant = await db.dormitoryAccessGrant.findFirst({
          where: {
            id: grantId,
            dormitoryId: targetDormitoryId,
            status: 'ACTIVE',
            roleCode: { in: ['OWNER', 'MANAGER'] },
          },
        });
        if (grant) {
          if (!requestedDormitoryId || requestedDormitoryId === grant.dormitoryId) {
            return grant.dormitoryId;
          }
        }
      }
      throw new AppError('ไม่มีสิทธิ์เข้าถึงหอพักที่ระบุสำหรับแพ็กเกจนี้', 403, 'FORBIDDEN_DORMITORY_ACCESS');
    }

    // 1. If explicit requestedDormitoryId is provided, verify ownership/membership
    if (requestedDormitoryId) {
      // Check active membership with OWNER/ADMIN/MANAGER role
      const member = await db.dormitoryMember.findFirst({
        where: {
          dormitoryId: requestedDormitoryId,
          userId,
          status: 'active',
          role: { code: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
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

    // 2.5 Check if user has an active setup_pending provisional dormitory
    const existingProvDorm = await db.dormitory.findFirst({
      where: {
        createdByUserId: userId,
        status: 'setup_pending',
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingProvDorm) {
      return existingProvDorm.id;
    }

    // 3. Post-onboarding context: Check user's active memberships
    const activeMemberships = await db.dormitoryMember.findMany({
      where: {
        userId,
        status: 'active',
        role: { code: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
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

    // 4. Fallback: create fresh provisional dormitory & draft
    const provisionalDorm = await db.dormitory.create({
      data: {
        name: 'หอพักของฉัน (Provisional)',
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
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', true)`;
      const dormitoryId = await this.resolveOnboardingDormitoryId(userId, tx, requestedDormitoryId || params.dormitoryId);
      const isDirectAccess = userId.startsWith('ag_user_') || userId.startsWith('ag_');
      const dorm = await tx.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { id: true, createdByUserId: true },
      });
      let authoritativeUserId = userId;
      if (isDirectAccess) {
        if (dorm?.createdByUserId) {
          authoritativeUserId = dorm.createdByUserId;
        } else {
          const ownerMember = await tx.dormitoryMember.findFirst({
            where: {
              dormitoryId,
              status: 'active',
              role: { code: 'OWNER' },
            },
            select: { userId: true },
          });
          if (ownerMember?.userId) {
            authoritativeUserId = ownerMember.userId;
          }
        }
      }
      await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${dormitoryId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${authoritativeUserId}, true)`;

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
      const existingTrialClaim = await tx.accountBenefitClaim.findFirst({
        where: {
          userId: authoritativeUserId,
          benefitKey: 'INITIAL_TRIAL_V1',
        },
      });
      const accountTrialAvailable = !existingTrialClaim;

      let isTrialEligible = false;
      let priceAfterTrial = basePrice;

      if (!isFreePlan && durationMonths === 1 && accountTrialAvailable) {
        isTrialEligible = true;
        priceAfterTrial = new Prisma.Decimal(0); // First month PRO is free trial
      } else {
        isTrialEligible = false;
        priceAfterTrial = basePrice;
      }

      // 3. Evaluate Promo Code (if provided)
      let promoBonusMonths = 0;
      let promoBenefitUnit: string | null = null;
      let promoBenefitValue: number | null = null;
      let promoBenefitLabel: string | null = null;
      let validatedPromoCode: string | null = null;
      let promoDiscountAmount = new Prisma.Decimal(0);
      if (params.promoCode && params.promoCode.trim()) {
        const promoRes = await promoService.validatePromo(params.promoCode, authoritativeUserId, dormitoryId, tx);
        if (promoRes.valid && promoRes.eligible) {
          promoBonusMonths = promoRes.promoBonusMonths;
          promoBenefitUnit = promoRes.benefitUnit || 'MONTH';
          promoBenefitValue = promoRes.benefitValue ?? (promoBenefitUnit === 'MONTH' ? promoRes.promoBonusMonths : 0);
          promoBenefitLabel = promoRes.benefitLabel || (promoBenefitUnit === 'DAY' ? `${promoBenefitValue} วัน` : `${promoBenefitValue} เดือน`);
          validatedPromoCode = promoRes.code;

          if (promoRes.benefitType === 'PERCENT_DISCOUNT' && promoBenefitValue && promoBenefitValue > 0) {
            const discountRate = new Prisma.Decimal(promoBenefitValue).dividedBy(100);
            promoDiscountAmount = priceAfterTrial.times(discountRate).round();
            priceAfterTrial = priceAfterTrial.minus(promoDiscountAmount);
            if (priceAfterTrial.lessThan(new Prisma.Decimal(0))) {
              priceAfterTrial = new Prisma.Decimal(0);
            }
          }
        }
      }

      // 4. Evaluate Referral Code (if provided)
      let validatedReferralCode: string | null = null;
      let provisionalReferralCoin = 0;
      if (params.referralCode && params.referralCode.trim()) {
        const refRes = await referralService.validateAndBindReferral(authoritativeUserId, params.referralCode, dormitoryId, tx);
        if (refRes.valid) {
          validatedReferralCode = refRes.referralCode;
          provisionalReferralCoin = refRes.provisionalCoin;
        }
      } else {
        // Check if account already has a bound referral attribution
        const existingAttribution = await referralService.getAttributionForUser(authoritativeUserId, tx);
        if (existingAttribution && existingAttribution.status === 'PENDING') {
          validatedReferralCode = existingAttribution.referralCodeSnapshot;
          provisionalReferralCoin = existingAttribution.provisionalCoinGranted;
        }
      }

      // 5. Calculate Integer Coin Deduction (Exact Decimal/string minor-unit arithmetic)
      const coinBalance = await coinWalletService.getBalance(authoritativeUserId, tx);
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
          status: 'PENDING_PAYMENT',
        },
        data: {
          status: 'EXPIRED',
        },
      });

      const intent = await tx.subscriptionPackageIntent.create({
        data: {
          dormitoryId,
          userId: authoritativeUserId,
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
          isZeroPayValidated: isZeroPay,
          checkoutVersion: 2, // Explicit Version 2 for LOCAL-07 lifecycle
          currencySnapshot: 'THB',
          catalogVersion: 2,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h validity
        },
      });

      return {
        intentId: intent.id,
        dormitoryId,
        packageId: targetPackageId,
        isFreePlan,
        packageName: pkg?.plan?.name || (isFreePlan ? 'HorPlus Free' : 'HorPlus PRO'),
        durationMonths,
        basePrice: basePrice.toFixed(2),
        referencePrice: referencePrice ? referencePrice.toFixed(2) : null,
        isTrialEligible,
        accountTrialAvailable,
        initialTrialAvailable: accountTrialAvailable,
        promoCode: validatedPromoCode,
        promoBonusMonths,
        promoBenefitUnit,
        promoBenefitValue,
        promoBenefitLabel,
        promoDiscountAmount: promoDiscountAmount.toFixed(2),
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
      const cleanUserId = userId.replace(/^ag_user_|^ag_/, '');
      const isPureActorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanUserId);
      let validActorId: string | null = null;
      if (isPureActorUuid) {
        const userExists = tx.user ? await tx.user.findUnique({ where: { id: cleanUserId }, select: { id: true } }) : null;
        if (userExists) {
          validActorId = cleanUserId;
        }
      }
      if (validActorId) {
        await tx.$executeRaw`SELECT set_config('app.current_user_id', ${validActorId}, true)`;
      }

      // 1. Lock intent for update
      await tx.$executeRaw`SELECT * FROM "subscription_package_intents" WHERE "id" = ${intentId}::uuid FOR UPDATE`;

      const intent = await tx.subscriptionPackageIntent.findUnique({
        where: { id: intentId },
        include: { package: { include: { plan: true } } },
      });

      if (!intent) {
        throw new AppError('ไม่พบข้อมูลรายการสั่งซื้อ', 404, 'INTENT_NOT_FOUND');
      }

      let hasAccess = intent.userId === userId || (validActorId !== null && intent.userId === validActorId);
      if (!hasAccess) {
        const isDirectAccess = userId.startsWith('ag_user_') || userId.startsWith('ag_');
        if (isDirectAccess) {
          await tx.$executeRaw`SELECT set_config('app.current_dormitory_id', ${intent.dormitoryId}, true)`;
          const grant = await tx.dormitoryAccessGrant.findFirst({
            where: {
              id: cleanUserId,
              dormitoryId: intent.dormitoryId,
              status: 'ACTIVE',
              roleCode: { in: ['OWNER', 'MANAGER'] },
            },
          });
          if (grant) {
            hasAccess = true;
          }
        } else {
          const member = await tx.dormitoryMember.findFirst({
            where: {
              dormitoryId: intent.dormitoryId,
              userId,
              status: 'active',
              role: { code: { in: ['OWNER', 'ADMIN', 'MANAGER'] } },
            },
          });
          if (member) {
            hasAccess = true;
          }
        }
      }

      if (!hasAccess) {
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

      // 1. User/Benefit-Level Transactional Serialization & Revalidation
      if (intent.isTrialEligibleSnapshot) {
        // Lock authoritative user row to serialize concurrent benefit commitments globally per user
        await tx.$queryRaw`SELECT id FROM "users" WHERE id = ${intent.userId}::uuid FOR UPDATE`;

        const existingClaim = await tx.accountBenefitClaim.findFirst({
          where: {
            userId: intent.userId,
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
          intent.userId,
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

      if (!proPlan || !freePlan) {
        throw new AppError('ไม่พบข้อมูลแผนการใช้งานในระบบ', 500, 'PLAN_NOT_FOUND');
      }

      const existingSub = await tx.dormitorySubscription.findUnique({
        where: { dormitoryId: intent.dormitoryId },
        include: { plan: true },
      });

      const isExistingProActive = Boolean(
        existingSub &&
        existingSub.expiresAt &&
        existingSub.expiresAt.getTime() > now.getTime() &&
        existingSub.status !== 'CANCELLED' &&
        existingSub.status !== 'EXPIRED' &&
        (existingSub.plan?.type === 'PAID' || existingSub.plan?.code === 'PAID')
      );

      const isFreeWithoutPromo = intent.durationMonthsSnapshot === 0 && !intent.isTrialEligibleSnapshot && !intent.promoCodeSnapshot;
      const isFreeWithPromo = intent.durationMonthsSnapshot === 0 && !intent.isTrialEligibleSnapshot && Boolean(intent.promoCodeSnapshot);

      let targetPlanId = isFreeWithoutPromo ? freePlan.id : (intent.package?.planId || proPlan.id);
      let subStatus: 'TRIAL' | 'ACTIVE' = 'ACTIVE';
      let subExpiresAt: Date | null = null;
      let durationMonths = 0;

      if (intent.isTrialEligibleSnapshot) {
        subStatus = isExistingProActive ? (existingSub!.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE') : 'TRIAL';
        durationMonths = 1;
        const baseDate = isExistingProActive ? existingSub!.expiresAt! : now;
        subExpiresAt = addCalendarMonths(baseDate, 1);
        targetPlanId = proPlan.id;
      } else if (isFreeWithPromo) {
        // FREE plan chosen + valid promo (HORPLUS): initial sub starts at now, redeemPromoAtomic will extend by 2 calendar months
        subStatus = isExistingProActive ? (existingSub!.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE') : 'TRIAL';
        durationMonths = 0;
        const baseDate = isExistingProActive ? existingSub!.expiresAt! : now;
        subExpiresAt = baseDate;
        targetPlanId = proPlan.id;
      } else if (isFreeWithoutPromo) {
        subStatus = 'ACTIVE';
        subExpiresAt = addCalendarMonths(now, 1200);
        targetPlanId = freePlan.id;
      } else {
        // Paid package (e.g. 100% coin discount or promo bonus)
        subStatus = 'ACTIVE';
        durationMonths = intent.durationMonthsSnapshot;
        const baseDate = isExistingProActive ? existingSub!.expiresAt! : now;
        subExpiresAt = addCalendarMonths(baseDate, durationMonths);
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
          trialExpiresAt: intent.isTrialEligibleSnapshot ? subExpiresAt : null,
          promoExtendedAt: null,
        },
        update: {
          planId: targetPlanId,
          status: subStatus,
          startedAt: isExistingProActive ? (existingSub?.startedAt || now) : (existingSub?.startedAt || now),
          expiresAt: subExpiresAt,
          trialStartedAt: intent.isTrialEligibleSnapshot ? (existingSub?.trialStartedAt || now) : (existingSub?.trialStartedAt || null),
          trialExpiresAt: intent.isTrialEligibleSnapshot ? (isExistingProActive ? (existingSub?.status === 'TRIAL' ? subExpiresAt : existingSub?.trialExpiresAt) : subExpiresAt) : existingSub?.trialExpiresAt,
          updatedAt: now,
        },
      });

      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: sub.id,
          dormitoryId: intent.dormitoryId,
          previousPlanId: existingSub?.planId || null,
          newPlanId: targetPlanId,
          previousStatus: existingSub?.status || null,
          newStatus: subStatus,
          reason: intent.isTrialEligibleSnapshot
            ? (isExistingProActive ? 'TRIAL_EXTENSION_ACTIVE_PRO' : 'INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL')
            : 'ZERO_PAY_INTENT_ACTIVATED',
          actorId: validActorId,
        },
      });

      // 4. Claim Initial Trial if applicable
      if (intent.isTrialEligibleSnapshot) {
        await tx.accountBenefitClaim.create({
          data: {
            userId: intent.userId,
            benefitKey: 'INITIAL_TRIAL_V1',
            dormitoryId: intent.dormitoryId,
            subscriptionId: sub.id,
            grantedMonths: 1,
            previousExpiresAt: isExistingProActive ? existingSub!.expiresAt : null,
            newExpiresAt: subExpiresAt,
          },
        });
      }

      // 5. Redeem Promo Code atomically if applicable (PromoService performs duration extension)
      let promoApplied = false;
      let promoBonusMonths = 0;
      let promoBenefitUnit: string | null = null;
      let promoBenefitValue: number | null = null;
      let promoBenefitLabel: string | null = null;
      if (intent.promoCodeSnapshot) {
        const promoRes = await promoService.redeemPromoAtomic(intent.userId, intent.dormitoryId, intent.promoCodeSnapshot, tx);
        promoApplied = Boolean((promoRes as any).success ?? promoRes.body?.success ?? promoRes.id);
        promoBonusMonths = promoRes.bonusMonths ?? promoRes.body?.data?.bonusMonths ?? 0;
        promoBenefitUnit = promoRes.benefitUnit || promoRes.body?.data?.benefitUnit || (promoBonusMonths > 0 ? 'MONTH' : 'DAY');
        promoBenefitValue = promoRes.benefitValue ?? promoRes.body?.data?.benefitValue ?? (promoBenefitUnit === 'DAY' ? (promoRes.bonusDays || promoRes.body?.data?.bonusDays || 0) : promoBonusMonths);
        promoBenefitLabel = promoRes.benefitLabel || (promoBenefitUnit === 'DAY' ? `${promoBenefitValue} วัน` : `${promoBenefitValue} เดือน`);
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
        planCode: isFreeWithoutPromo ? 'FREE' : 'PAID',
        durationMonths,
        expiresAt: subExpiresAt,
        coinDebited: intent.coinApplied,
        isTrial: intent.isTrialEligibleSnapshot || isFreeWithPromo,
        isTrialEligible: Boolean(intent.isTrialEligibleSnapshot),
        isFreeWithPromo: Boolean(isFreeWithPromo),
        promoBonusMonths,
        promoBenefitUnit,
        promoBenefitValue,
        promoBenefitLabel,
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
