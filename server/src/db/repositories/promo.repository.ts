export interface PlatformPromoCodeEntity {
  id: string;
  code: string;
  codeNormalized: string;
  status: 'active' | 'inactive' | 'expired';
  trialBonusDays: number;
  validFrom?: Date | null;
  validUntil?: Date | null;
  maxRedemptions?: number | null;
  redemptionCount: number;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformPromoRedemptionEntity {
  id: string;
  promoCodeId: string;
  dormitoryId: string;
  userId: string;
  subscriptionId: string;
  bonusDays: number;
  redeemedAt: Date;
  createdAt: Date;
}

export interface IPromoRepository {
  findByCode(code: string): Promise<PlatformPromoCodeEntity | null>;
  findRedemption(promoCodeId: string, dormitoryId: string): Promise<PlatformPromoRedemptionEntity | null>;
  createRedemption(data: {
    promoCodeId: string;
    dormitoryId: string;
    userId: string;
    subscriptionId: string;
    bonusDays: number;
  }): Promise<PlatformPromoRedemptionEntity>;
  incrementRedemptionCount(promoCodeId: string): Promise<void>;
}

export class InMemoryPromoRepository implements IPromoRepository {
  private promoCodes: Map<string, PlatformPromoCodeEntity> = new Map();
  private redemptions: Map<string, PlatformPromoRedemptionEntity> = new Map();

  constructor() {
    this.seedData();
  }

  private seedData(): void {
    const now = new Date();
    this.promoCodes.set('11111111-1111-1111-1111-111111111111', {
      id: '11111111-1111-1111-1111-111111111111',
      code: 'HORPLUS',
      codeNormalized: 'HORPLUS',
      status: 'active',
      trialBonusDays: 60,
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validUntil: new Date('2030-12-31T23:59:59Z'),
      maxRedemptions: null,
      redemptionCount: 0,
      metadata: { description: 'Special 60-day trial extension promo for HorPlus Onboarding' },
      createdAt: now,
      updatedAt: now,
    });
  }

  public async findByCode(code: string): Promise<PlatformPromoCodeEntity | null> {
    const normalized = code.trim().toUpperCase();
    for (const promo of this.promoCodes.values()) {
      if (promo.codeNormalized === normalized) return promo;
    }
    return null;
  }

  public async findRedemption(promoCodeId: string, dormitoryId: string): Promise<PlatformPromoRedemptionEntity | null> {
    const key = `${promoCodeId}:${dormitoryId}`;
    return this.redemptions.get(key) || null;
  }

  public async createRedemption(data: {
    promoCodeId: string;
    dormitoryId: string;
    userId: string;
    subscriptionId: string;
    bonusDays: number;
  }): Promise<PlatformPromoRedemptionEntity> {
    const now = new Date();
    const redemption: PlatformPromoRedemptionEntity = {
      id: `red-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      promoCodeId: data.promoCodeId,
      dormitoryId: data.dormitoryId,
      userId: data.userId,
      subscriptionId: data.subscriptionId,
      bonusDays: data.bonusDays,
      redeemedAt: now,
      createdAt: now,
    };
    const key = `${data.promoCodeId}:${data.dormitoryId}`;
    this.redemptions.set(key, redemption);
    await this.incrementRedemptionCount(data.promoCodeId);
    return redemption;
  }

  public async incrementRedemptionCount(promoCodeId: string): Promise<void> {
    const promo = this.promoCodes.get(promoCodeId);
    if (promo) {
      promo.redemptionCount += 1;
      promo.updatedAt = new Date();
    }
  }
}
