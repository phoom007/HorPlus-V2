/**
 * Canonical Promo Code Authority Service (LOCAL-07 Master)
 * Invariants:
 * - HORPLUS grants +2 months (60 days)
 * - First 100 Google Accounts globally (atomic concurrency cap)
 * - Single redemption per Google Account
 * - Works whether initial trial is unused (1 + 2 = 3 months) or already consumed (+2 months)
 * @license Apache-2.0
 */

import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { addCalendarMonths } from './subscription-entitlement.service.js';

export interface PromoValidationResult {
  valid: boolean;
  eligible: boolean;
  code: string;
  benefitType?: string;
  benefitUnit?: string;
  benefitValue?: number;
  trialMonths: number;
  promoBonusMonths: number;
  totalTrialMonths: number;
  message: string;
  errorCode?: string;
  promoCodeEntity?: any;
}

export class PromoService {
  private prisma: PrismaClient;

  constructor(prismaOrRepo?: any) {
    if (prismaOrRepo && typeof prismaOrRepo.$transaction === 'function') {
      this.prisma = prismaOrRepo;
    } else {
      this.prisma = getPrismaClient();
    }
  }

  /**
   * Authoritative promo validation used across Onboarding, Subscription Quote, and Renewal
   */
  public async validatePromo(
    code: string | undefined,
    userId?: string,
    dormitoryId?: string,
    txClient?: any
  ): Promise<PromoValidationResult> {
    const db = txClient || this.prisma;
    let initialTrialMonths = 1;
    let isInitialTrialClaimed = false;

    if (userId) {
      const existingClaim = await db.accountBenefitClaim.findFirst({
        where: {
          userId: userId,
          benefitKey: 'INITIAL_TRIAL_V1',
        },
      });
      if (existingClaim) {
        isInitialTrialClaimed = true;
        initialTrialMonths = 0;
      }
    }

    if (!code || !code.trim()) {
      if (isInitialTrialClaimed) {
        return {
          valid: false,
          eligible: false,
          code: '',
          trialMonths: 0,
          promoBonusMonths: 0,
          totalTrialMonths: 0,
          message: 'บัญชีนี้เคยใช้สิทธิ์ทดลองใช้งานฟรีเริ่มต้นไปแล้ว',
          errorCode: 'INITIAL_TRIAL_ALREADY_CLAIMED',
        };
      }
      return {
        valid: false,
        eligible: false,
        code: '',
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'กรุณากรอกรหัสโปรโมชัน',
      };
    }

    const normalizedCode = code.trim().toUpperCase();
    const promo = await db.promoCode.findFirst({
      where: {
        OR: [
          { normalizedCode },
          { code: normalizedCode },
        ],
      },
    });

    if (!promo) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'รหัสโปรโมชันไม่ถูกต้อง',
        errorCode: 'PROMO_NOT_FOUND',
      };
    }

    if (!promo.enabled) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'รหัสโปรโมชันนี้ไม่สามารถใช้งานได้แล้ว',
        errorCode: 'PROMO_DISABLED',
      };
    }

    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'รหัสโปรโมชันนี้ยังไม่ถึงเวลาเปิดใช้งาน',
        errorCode: 'PROMO_NOT_YET_ACTIVE',
      };
    }

    if (promo.endsAt && promo.endsAt < now) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'รหัสโปรโมชันหมดอายุแล้ว',
        errorCode: 'PROMO_EXPIRED',
      };
    }

    // Check account-level one-redemption-per-account invariant
    if (userId) {
      const existingRedemption = await db.promoRedemption.findFirst({
        where: {
          promoCodeId: promo.id,
          redeemedBy: userId,
        },
      });

      if (existingRedemption) {
        return {
          valid: false,
          eligible: false,
          code: normalizedCode,
          trialMonths: initialTrialMonths,
          promoBonusMonths: 0,
          totalTrialMonths: initialTrialMonths,
          message: 'บัญชีนี้เคยใช้สิทธิ์โปรโมชันนี้ไปแล้ว',
          errorCode: 'PROMO_ALREADY_REDEEMED',
        };
      }
    }

    // Check global capacity cap (first 100 accounts)
    if (promo.globalMaxRedemptions !== null && promo.globalMaxRedemptions !== undefined) {
      const currentCount = promo.currentRedemptionsCount;
      if (currentCount >= promo.globalMaxRedemptions) {
        return {
          valid: false,
          eligible: false,
          code: normalizedCode,
          trialMonths: initialTrialMonths,
          promoBonusMonths: 0,
          totalTrialMonths: initialTrialMonths,
          message: `สิทธิ์โปรโมชันนี้ครบตามจำนวนที่กำหนดแล้ว (${promo.globalMaxRedemptions} บัญชี)`,
          errorCode: 'PROMO_GLOBAL_LIMIT_REACHED',
        };
      }
    }

    // Check benefit configuration validity
    if (promo.benefitType !== 'TRIAL_EXTENSION' || promo.benefitValue <= 0) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'การตั้งค่าสิทธิ์โปรโมชันไม่ถูกต้อง',
        errorCode: 'PROMO_CONFIGURATION_INVALID',
      };
    }

    // Dual-State Promo Calculation:
    // If trial unused: 1 mo trial + 2 mo HORPLUS = 3 mo
    // If trial consumed: 0 mo trial + 2 mo HORPLUS = 2 mo
    const promoBonusMonths = promo.benefitValue;
    const totalTrialMonths = initialTrialMonths + promoBonusMonths;

    return {
      valid: true,
      eligible: true,
      code: normalizedCode,
      benefitType: promo.benefitType,
      benefitUnit: promo.benefitUnit,
      benefitValue: promo.benefitValue,
      trialMonths: initialTrialMonths,
      promoBonusMonths: promoBonusMonths,
      totalTrialMonths: totalTrialMonths,
      message: `ใช้รหัสโปรโมชัน ${normalizedCode} สำเร็จ (รับสิทธิ์เพิ่ม ${promoBonusMonths} เดือน)`,
      promoCodeEntity: promo,
    };
  }

  /**
   * Authoritative promo redemption with transactional capacity row-locking
   */
  public async redeemPromoAtomic(
    userId: string,
    dormitoryId?: string,
    code?: string,
    txClient?: any,
    idempotencyKey?: string,
    nowDate?: Date
  ) {
    const runInTx = async (tx: any) => {
      const now = nowDate || new Date();
      const rawCode = code || 'HORPLUS';
      const normalizedCode = rawCode.trim().toUpperCase();

      const promo = await tx.promoCode.findFirst({
        where: {
          OR: [
            { normalizedCode },
            { code: normalizedCode },
          ],
        },
      });

      if (!promo) {
        throw new AppError('ไม่พบรหัสโปรโมชัน (PROMO_CATALOG_NOT_CONFIGURED / PROMO_NOT_FOUND)', 404, 'PROMO_CATALOG_NOT_CONFIGURED');
      }

      if (!promo.enabled) {
        throw new AppError('รหัสโปรโมชันนี้ถูกปิดใช้งาน (PROMO_DISABLED)', 403, 'PROMO_DISABLED');
      }

      if (promo.startsAt && promo.startsAt > now) {
        throw new AppError('รหัสโปรโมชันนี้ยังไม่ถึงเวลาเปิดใช้งาน (PROMO_NOT_YET_ACTIVE)', 400, 'PROMO_NOT_YET_ACTIVE');
      }

      if (promo.endsAt && promo.endsAt < now) {
        throw new AppError('รหัสโปรโมชันหมดอายุแล้ว (PROMO_EXPIRED)', 400, 'PROMO_EXPIRED');
      }

      if (
        promo.benefitType !== 'TRIAL_EXTENSION' ||
        typeof promo.benefitValue !== 'number' ||
        promo.benefitValue <= 0
      ) {
        throw new AppError('การตั้งค่าสิทธิ์โปรโมชันไม่ถูกต้อง (PROMO_CONFIGURATION_INVALID)', 400, 'PROMO_CONFIGURATION_INVALID');
      }

      // 1. Lock promo row for atomic capacity count update
      await tx.$executeRaw`SELECT * FROM "promo_codes" WHERE "id" = ${promo.id}::uuid FOR UPDATE`;

      const lockedPromo = await tx.promoCode.findUniqueOrThrow({
        where: { id: promo.id },
      });

      if (lockedPromo.globalMaxRedemptions !== null && lockedPromo.currentRedemptionsCount >= lockedPromo.globalMaxRedemptions) {
        throw new AppError(
          `สิทธิ์โปรโมชันนี้ครบตามจำนวนที่กำหนดแล้ว (${lockedPromo.globalMaxRedemptions} บัญชี / PROMO_GLOBAL_LIMIT_REACHED)`,
          400,
          'PROMO_GLOBAL_LIMIT_REACHED'
        );
      }

      // 2. Check duplicate account redemption across all dormitories (one redemption per Google Account)
      const existingAccountRedemption = await tx.promoRedemption.findFirst({
        where: {
          promoCodeId: lockedPromo.id,
          redeemedBy: userId,
        },
      });

      if (existingAccountRedemption) {
        throw new AppError('บัญชีนี้เคยใช้สิทธิ์โปรโมชันนี้ไปแล้ว (Promo code has already been redeemed by this account / PROMO_ALREADY_REDEEMED)', 409, 'PROMO_ALREADY_REDEEMED');
      }

      // 3. Check dormitory-level redemption if dormitoryId provided
      if (dormitoryId) {
        const existingDormRedemption = await tx.promoRedemption.findFirst({
          where: {
            dormitoryId,
            promoCodeId: lockedPromo.id,
          },
        });
        if (existingDormRedemption) {
          throw new AppError('หอพักนี้เคยใช้สิทธิ์โปรโมชันนี้ไปแล้ว (Promo code has already been redeemed for this dormitory / PROMO_ALREADY_REDEEMED)', 409, 'PROMO_ALREADY_REDEEMED');
        }
      }

      // 4. Atomically increment capacity counter
      await tx.promoCode.update({
        where: { id: lockedPromo.id },
        data: {
          currentRedemptionsCount: { increment: 1 },
        },
      });

      const bonusMonths = lockedPromo.benefitValue || 2;
      let newExpiresAt = addCalendarMonths(now, bonusMonths);
      let previousExpiresAt: Date = now;
      let subscriptionId: string = '';

      // 5. If dormitoryId provided and dormitory subscription exists, extend it
      if (dormitoryId) {
        let sub = await tx.dormitorySubscription.findUnique({
          where: { dormitoryId },
          include: { plan: true },
        });

        const proPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });

        if (sub) {
          subscriptionId = sub.id;
          previousExpiresAt = sub.expiresAt;
          if (sub.expiresAt && sub.expiresAt > now) {
            newExpiresAt = addCalendarMonths(sub.expiresAt, bonusMonths);
          } else {
            newExpiresAt = addCalendarMonths(now, bonusMonths);
          }

          await tx.dormitorySubscription.update({
            where: { id: sub.id },
            data: {
              planId: proPlan?.id || sub.planId,
              status: 'TRIAL',
              expiresAt: newExpiresAt,
              promoExtendedAt: now,
              updatedAt: now,
            },
          });

          await tx.subscriptionStatusHistory.create({
            data: {
              subscriptionId: sub.id,
              dormitoryId,
              previousPlanId: sub.planId,
              newPlanId: proPlan?.id || sub.planId,
              previousStatus: sub.status,
              newStatus: 'TRIAL',
              reason: 'PROMO_EXTENSION_CALENDAR_MONTHS',
              actorId: userId,
            },
          });
        } else {
          sub = await tx.dormitorySubscription.create({
            data: {
              dormitoryId,
              planId: proPlan!.id,
              status: 'TRIAL',
              startedAt: now,
              expiresAt: newExpiresAt,
              trialStartedAt: now,
              trialExpiresAt: newExpiresAt,
              promoExtendedAt: now,
            },
          });
          previousExpiresAt = now;
          subscriptionId = sub.id;
        }

        // Create PromoRedemption record
        await tx.promoRedemption.create({
          data: {
            promoCodeId: lockedPromo.id,
            dormitoryId,
            subscriptionId: sub.id,
            redeemedBy: userId,
            previousExpiresAt,
            newExpiresAt,
          },
        });
      }

      return {
        status: 200,
        body: {
          success: true,
          message: `ใช้รหัสโปรโมชัน ${lockedPromo.code} สำเร็จ (รับสิทธิ์เพิ่ม ${bonusMonths} เดือน)`,
          data: {
            promoCode: lockedPromo.code,
            bonusMonths,
            expiresAt: newExpiresAt,
          },
        },
        id: lockedPromo.id,
        promoCodeEntity: lockedPromo,
        benefitValue: bonusMonths,
        bonusMonths,
        newExpiresAt,
      };
    };

    if (txClient) {
      return await runInTx(txClient);
    }
    return await this.prisma.$transaction(runInTx);
  }
}

export const promoService = new PromoService();
