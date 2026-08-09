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
    const initialTrialMonths = 1;

    if (!code || !code.trim()) {
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
        };
      }
    }

    const bonusMonths = (promo.benefitType === 'TRIAL_EXTENSION' && promo.benefitUnit === 'MONTH')
      ? promo.benefitValue
      : 2;

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

