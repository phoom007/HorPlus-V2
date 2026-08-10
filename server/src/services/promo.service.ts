import { PrismaClient } from '@prisma/client';

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
      this.prisma = new PrismaClient();
    }
  }

  public async validatePromo(code: string | undefined, userId?: string): Promise<PromoValidationResult> {
    let initialTrialMonths = 1;
    let isInitialTrialClaimed = false;

    if (userId) {
      const existingClaim = await this.prisma.accountBenefitClaim.findFirst({
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
    const promo = await this.prisma.promoCode.findFirst({
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

    // PROMO-01: Strictly validate benefit configuration (No silent hardcoded fallback)
    if (
      promo.benefitType !== 'TRIAL_EXTENSION' ||
      promo.benefitUnit !== 'MONTH' ||
      typeof promo.benefitValue !== 'number' ||
      promo.benefitValue <= 0
    ) {
      return {
        valid: false,
        eligible: false,
        code: normalizedCode,
        trialMonths: initialTrialMonths,
        promoBonusMonths: 0,
        totalTrialMonths: initialTrialMonths,
        message: 'การกำหนดค่าสิทธิประโยชน์ของโปรโมชันไม่ถูกต้อง',
        errorCode: 'PROMO_CONFIGURATION_INVALID',
      };
    }

    if (isInitialTrialClaimed) {
      return {
        valid: true,
        eligible: false,
        code: normalizedCode,
        benefitType: promo.benefitType,
        benefitUnit: promo.benefitUnit,
        benefitValue: promo.benefitValue,
        trialMonths: 0,
        promoBonusMonths: 0,
        totalTrialMonths: 0,
        message: 'บัญชีนี้เคยใช้สิทธิ์ทดลองใช้งานฟรีเริ่มต้นไปแล้ว ไม่สามารถรับสิทธิ์ส่วนขยายทดลองใช้ฟรีซ้ำได้',
        errorCode: 'INITIAL_TRIAL_ALREADY_CLAIMED',
      };
    }

    if (userId) {
      const existingRedemption = await this.prisma.promoRedemption.findFirst({
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
          message: 'รหัสโปรโมชันนี้ถูกใช้งานไปแล้วกับบัญชีนี้',
          errorCode: 'PROMO_ALREADY_REDEEMED',
        };
      }
    }

    const bonusMonths = promo.benefitValue;

    return {
      valid: true,
      eligible: true,
      code: normalizedCode,
      benefitType: promo.benefitType,
      benefitUnit: promo.benefitUnit,
      benefitValue: bonusMonths,
      trialMonths: initialTrialMonths,
      promoBonusMonths: bonusMonths,
      totalTrialMonths: initialTrialMonths + bonusMonths,
      message: `รหัสโปรโมชันถูกต้อง คุณได้รับส่วนขยายเพิ่ม ${bonusMonths} เดือน`,
      promoCodeEntity: promo,
    };
  }
}
