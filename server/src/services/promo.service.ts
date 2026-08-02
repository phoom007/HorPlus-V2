import { IPromoRepository, PlatformPromoCodeEntity } from '../db/repositories/promo.repository.js';

export interface PromoValidationResult {
  valid: boolean;
  code: string;
  standardTrialDays: number;
  bonusTrialDays: number;
  totalTrialDays: number;
  message?: string;
  promoCodeEntity?: PlatformPromoCodeEntity;
}

export class PromoService {
  private promoRepo: IPromoRepository;

  constructor(promoRepo: IPromoRepository) {
    this.promoRepo = promoRepo;
  }

  public async validatePromo(code: string | undefined, dormitoryId?: string): Promise<PromoValidationResult> {
    const standardTrialDays = 30;

    if (!code || !code.trim()) {
      return {
        valid: false,
        code: '',
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'กรุณากรอกรหัสโปรโมชัน',
      };
    }

    const normalizedCode = code.trim().toUpperCase();
    const promo = await this.promoRepo.findByCode(normalizedCode);

    if (!promo) {
      return {
        valid: false,
        code: normalizedCode,
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'รหัสโปรโมชันไม่ถูกต้อง',
      };
    }

    if (promo.status !== 'active') {
      return {
        valid: false,
        code: normalizedCode,
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'รหัสโปรโมชันนี้ไม่สามารถใช้งานได้แล้ว',
      };
    }

    const now = new Date();
    if (promo.validFrom && promo.validFrom > now) {
      return {
        valid: false,
        code: normalizedCode,
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'รหัสโปรโมชันนี้ยังไม่ถึงเวลาเปิดใช้งาน',
      };
    }

    if (promo.validUntil && promo.validUntil < now) {
      return {
        valid: false,
        code: normalizedCode,
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'รหัสโปรโมชันหมดอายุแล้ว',
      };
    }

    if (promo.maxRedemptions !== null && promo.maxRedemptions !== undefined && promo.redemptionCount >= promo.maxRedemptions) {
      return {
        valid: false,
        code: normalizedCode,
        standardTrialDays,
        bonusTrialDays: 0,
        totalTrialDays: standardTrialDays,
        message: 'รหัสโปรโมชันนี้ถูกใช้งานครบตามจำนวนโควต้าแล้ว',
      };
    }

    if (dormitoryId) {
      const existingRedemption = await this.promoRepo.findRedemption(promo.id, dormitoryId);
      if (existingRedemption) {
        return {
          valid: false,
          code: normalizedCode,
          standardTrialDays,
          bonusTrialDays: 0,
          totalTrialDays: standardTrialDays,
          message: 'รหัสโปรโมชันนี้ถูกใช้งานไปแล้วกับหอพักนี้',
        };
      }
    }

    const bonusTrialDays = promo.trialBonusDays || 0;
    const totalTrialDays = Math.min(90, standardTrialDays + bonusTrialDays);

    return {
      valid: true,
      code: normalizedCode,
      standardTrialDays,
      bonusTrialDays,
      totalTrialDays,
      promoCodeEntity: promo,
    };
  }
}
