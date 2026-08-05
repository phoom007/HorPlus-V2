import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';

export class SubscriptionEntitlementService {
  private customPrisma?: PrismaClient;

  constructor(customPrisma?: PrismaClient) {
    this.customPrisma = customPrisma;
  }

  private get db(): PrismaClient {
    return this.customPrisma || getPrismaClient();
  }

  /**
   * Seed plans, packages, and promo code if not already present
   */
  async ensureSeeded(txClient?: any): Promise<void> {
    const db = txClient || this.db;
    if (!db || typeof db.subscriptionPlan?.findUnique !== 'function') return;

    // 1. FREE Plan (room limit 10)
    let freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      freePlan = await db.subscriptionPlan.create({
        data: {
          code: 'FREE',
          name: 'Free / Trial',
          type: 'FREE',
          roomLimit: 10,
          enabled: true,
        },
      });
    }

    // 2. PAID Plan (room limit 150)
    let paidPlan = await db.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) {
      paidPlan = await db.subscriptionPlan.create({
        data: {
          code: 'PAID',
          name: 'Paid',
          type: 'PAID',
          roomLimit: 150,
          enabled: true,
        },
      });
    }

    // 3. Subscription Packages for PAID plan
    const packagesToSeed = [
      { durationMonths: 1, price: 189.00, enabled: true },
      { durationMonths: 3, price: null, enabled: false },
      { durationMonths: 6, price: null, enabled: false },
      { durationMonths: 12, price: null, enabled: false },
      { durationMonths: 24, price: null, enabled: false },
    ];

    for (const pkg of packagesToSeed) {
      const existing = await db.subscriptionPackage.findFirst({
        where: { planId: paidPlan.id, durationMonths: pkg.durationMonths },
      });
      if (!existing) {
        await db.subscriptionPackage.create({
          data: {
            planId: paidPlan.id,
            durationMonths: pkg.durationMonths,
            price: pkg.price !== null ? pkg.price : undefined,
            currency: 'THB',
            enabled: pkg.enabled,
          },
        });
      }
    }

    // 4. Promo Code HORPLUS (+60 days, max 1 redemption per dorm)
    const existingPromo = await db.promoCode.findUnique({ where: { code: 'HORPLUS' } });
    if (!existingPromo) {
      await db.promoCode.create({
        data: {
          code: 'HORPLUS',
          normalizedCode: 'HORPLUS',
          extensionDays: 60,
          enabled: true,
          maximumRedemptionsPerDormitory: 1,
        },
      });
    }
  }

  /**
   * Idempotently backfill 30-day Trial subscriptions for all existing dormitories without a subscription
   */
  async backfillExistingDormitories(): Promise<{ backfilledCount: number }> {
    await this.ensureSeeded();

    const freePlan = await this.db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) throw new Error('FREE plan not seeded');

    const dormitories = await this.db.dormitory.findMany({
      where: {
        dormitorySubscription: null,
      },
    });

    if (dormitories.length === 0) return { backfilledCount: 0 };

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subData = dormitories.map((d) => ({
      dormitoryId: d.id,
      planId: freePlan.id,
      status: 'TRIAL' as const,
      startedAt: now,
      expiresAt: expiresAt,
      trialStartedAt: now,
      trialExpiresAt: expiresAt,
    }));

    await this.db.dormitorySubscription.createMany({
      data: subData,
      skipDuplicates: true,
    });

    return { backfilledCount: dormitories.length };
  }

  /**
   * Provision a 30-day Trial subscription for a newly created dormitory (atomic within transaction)
   */
  async provisionInitialTrial(dormitoryId: string, txClient?: any): Promise<any> {
    const db = txClient || this.db;
    await this.ensureSeeded(db);

    const freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) throw new Error('FREE plan not seeded');

    const existing = await db.dormitorySubscription.findUnique({ where: { dormitoryId } });
    if (existing) return existing;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const sub = await db.dormitorySubscription.create({
      data: {
        dormitoryId,
        planId: freePlan.id,
        status: 'TRIAL',
        startedAt: now,
        expiresAt,
        trialStartedAt: now,
        trialExpiresAt: expiresAt,
      },
    });

    await db.subscriptionStatusHistory.create({
      data: {
        subscriptionId: sub.id,
        dormitoryId,
        previousStatus: null,
        newStatus: 'TRIAL',
        previousPlanId: null,
        newPlanId: freePlan.id,
        effectiveAt: now,
        reason: 'INITIAL_PROVISIONING_30_DAY_TRIAL',
      },
    });

    return sub;
  }

  /**
   * Get current subscription for a dormitory (auto-provisions trial if missing)
   */
  async getCurrentSubscription(dormitoryId: string, txClient?: any): Promise<any> {
    const db = txClient || this.db;
    let sub = await db.dormitorySubscription.findUnique({
      where: { dormitoryId },
      include: { plan: true },
    });

    if (!sub) {
      sub = await this.provisionInitialTrial(dormitoryId, db);
      sub = await db.dormitorySubscription.findUnique({
        where: { dormitoryId },
        include: { plan: true },
      });
    }

    return sub;
  }

  /**
   * Calculate effective entitlement details at request time
   */
  async getEffectiveEntitlements(dormitoryId: string, now: Date = new Date()): Promise<any> {
    await this.ensureSeeded();
    const sub = await this.getCurrentSubscription(dormitoryId);
    if (!sub) {
      throw new AppError('Dormitory subscription not found', 404, 'SUBSCRIPTION_NOT_FOUND');
    }

    const isExpired = sub.expiresAt.getTime() <= now.getTime();
    let effectiveStatus = sub.status;
    if (isExpired && (sub.status === 'TRIAL' || sub.status === 'ACTIVE')) {
      effectiveStatus = 'EXPIRED';
    }

    const isActive = !isExpired && (effectiveStatus === 'TRIAL' || effectiveStatus === 'ACTIVE');
    const isReadOnly = !isActive;

    const roomCount = await this.db.room.count({
      where: {
        dormitoryId,
      },
    });

    const roomLimit = sub.plan.roomLimit;
    const remainingRooms = Math.max(0, roomLimit - roomCount);
    const isOverLimit = roomCount > roomLimit;

    const promoRedemption = await this.db.promoRedemption.findFirst({
      where: { dormitoryId },
    });

    let reason = 'Subscription active';
    if (isReadOnly) {
      reason = 'Subscription expired. Dormitory is read-only.';
    } else if (isOverLimit) {
      reason = `Room count (${roomCount}) exceeds plan limit (${roomLimit}).`;
    }

    return {
      dormitoryId,
      subscriptionId: sub.id,
      plan: {
        id: sub.plan.id,
        code: sub.plan.code,
        name: sub.plan.name,
        type: sub.plan.type,
        roomLimit: sub.plan.roomLimit,
      },
      status: effectiveStatus,
      rawStatus: sub.status,
      isActive,
      isReadOnly,
      isOverLimit,
      roomLimit,
      roomCount,
      remainingRooms,
      startedAt: sub.startedAt,
      expiresAt: sub.expiresAt,
      trialStartedAt: sub.trialStartedAt,
      trialExpiresAt: sub.trialExpiresAt,
      promoExtendedAt: sub.promoExtendedAt,
      promoRedeemed: !!promoRedemption,
      reason,
    };
  }

  /**
   * Assert dormitory writable (throws HTTP 403 SUBSCRIPTION_READ_ONLY if expired/read-only)
   */
  async assertDormitoryWritable(dormitoryId: string, now: Date = new Date()): Promise<void> {
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now);
    if (entitlement.isReadOnly) {
      throw new AppError('Dormitory subscription has expired. Operations are restricted to read-only mode.', 403, 'SUBSCRIPTION_READ_ONLY');
    }
  }

  /**
   * Assert room creation allowed (throws 403 if read-only, 409 ROOM_LIMIT_REACHED if over limit)
   */
  async assertRoomCreationAllowed(dormitoryId: string, now: Date = new Date()): Promise<void> {
    await this.assertDormitoryWritable(dormitoryId, now);
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now);

    if (entitlement.roomCount >= entitlement.roomLimit) {
      throw new AppError(
        `Cannot create room. Current room count (${entitlement.roomCount}) has reached the plan limit (${entitlement.roomLimit}).`,
        409,
        'ROOM_LIMIT_REACHED'
      );
    }
  }

  /**
   * Assert owner dormitory limit (max 10 dormitories per owner)
   */
  async assertDormitoryCreationAllowed(ownerUserId: string): Promise<void> {
    const ownedCount = await this.db.dormitoryMember.count({
      where: {
        userId: ownerUserId,
        role: { code: 'OWNER' },
        status: 'active',
      },
    });

    if (ownedCount >= 10) {
      throw new AppError('Owner account cannot create or manage more than 10 dormitories.', 409, 'DORMITORY_LIMIT_REACHED');
    }
  }

  /**
   * Redeem HORPLUS promo code
   */
  async redeemPromoCode(params: {
    dormitoryId: string;
    code: string;
    userId: string;
    now?: Date;
  }): Promise<any> {
    const now = params.now || new Date();
    const normalizedCode = params.code.trim().toUpperCase();

    await this.ensureSeeded();
    await this.assertDormitoryWritable(params.dormitoryId, now);

    // 1. Validate promo code
    const promo = await this.db.promoCode.findFirst({
      where: {
        normalizedCode,
        enabled: true,
      },
    });

    if (!promo) {
      throw new AppError('Invalid or unsupported promo code.', 404, 'PROMO_INVALID');
    }

    if (promo.startsAt && promo.startsAt > now) {
      throw new AppError('Promo code is not active yet.', 400, 'PROMO_NOT_ELIGIBLE');
    }
    if (promo.endsAt && promo.endsAt < now) {
      throw new AppError('Promo code has expired.', 400, 'PROMO_NOT_ELIGIBLE');
    }

    // 2. Validate current subscription
    const sub = await this.getCurrentSubscription(params.dormitoryId);
    if (!sub) {
      throw new AppError('Dormitory subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
    }

    if (sub.status !== 'TRIAL') {
      throw new AppError('Promo code HORPLUS can only be redeemed during an active Trial subscription.', 400, 'PROMO_NOT_ELIGIBLE');
    }

    if (sub.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('Trial subscription has already expired.', 400, 'TRIAL_EXPIRED');
    }

    // 3. Perform atomic redemption transaction
    return await this.db.$transaction(async (tx) => {
      const existingRedemption = await tx.promoRedemption.findUnique({
        where: {
          promo_dormitory_unique: {
            promoCodeId: promo.id,
            dormitoryId: params.dormitoryId,
          },
        },
      });

      if (existingRedemption) {
        throw new AppError('Promo code HORPLUS has already been redeemed for this dormitory.', 409, 'PROMO_ALREADY_REDEEMED');
      }

      const previousExpiresAt = sub.expiresAt;
      const extensionMs = promo.extensionDays * 24 * 60 * 60 * 1000;
      const newExpiresAt = new Date(previousExpiresAt.getTime() + extensionMs);
      const newTrialExpiresAt = sub.trialExpiresAt
        ? new Date(sub.trialExpiresAt.getTime() + extensionMs)
        : newExpiresAt;

      const updatedSub = await tx.dormitorySubscription.update({
        where: { id: sub.id },
        data: {
          expiresAt: newExpiresAt,
          trialExpiresAt: newTrialExpiresAt,
          promoExtendedAt: now,
        },
      });

      await tx.promoRedemption.create({
        data: {
          promoCodeId: promo.id,
          dormitoryId: params.dormitoryId,
          subscriptionId: sub.id,
          redeemedBy: params.userId,
          previousExpiresAt,
          newExpiresAt,
        },
      });

      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: sub.id,
          dormitoryId: params.dormitoryId,
          previousStatus: sub.status,
          newStatus: sub.status,
          previousPlanId: sub.planId,
          newPlanId: sub.planId,
          effectiveAt: now,
          actorId: params.userId,
          reason: `PROMO_REDEMPTION_${promo.code}`,
          metadata: {
            promoCode: promo.code,
            extensionDays: promo.extensionDays,
            previousExpiresAt: previousExpiresAt.toISOString(),
            newExpiresAt: newExpiresAt.toISOString(),
          },
        },
      });

      return updatedSub;
    });
  }

  /**
   * Activate or renew an operational Paid subscription
   */
  async activatePaidSubscription(params: {
    dormitoryId: string;
    durationMonths: number;
    actorId?: string;
    now?: Date;
  }): Promise<any> {
    const now = params.now || new Date();
    await this.ensureSeeded();

    const allowedDurations = [1, 3, 6, 12, 24];
    if (!allowedDurations.includes(params.durationMonths)) {
      throw new AppError('Duration months must be one of 1, 3, 6, 12, or 24.', 400, 'VALIDATION_ERROR');
    }

    const paidPlan = await this.db.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) throw new AppError('PAID plan configuration missing.', 500, 'INTERNAL_ERROR');

    const pkg = await this.db.subscriptionPackage.findFirst({
      where: { planId: paidPlan.id, durationMonths: params.durationMonths },
    });

    if (!pkg || !pkg.enabled || pkg.price === null) {
      throw new AppError('Selected package duration is disabled or unpriced.', 400, 'PACKAGE_DISABLED');
    }

    const currentSub = await this.getCurrentSubscription(params.dormitoryId);

    const baseDate = (currentSub.expiresAt.getTime() > now.getTime())
      ? currentSub.expiresAt
      : now;

    const newExpiresAt = new Date(baseDate);
    newExpiresAt.setMonth(newExpiresAt.getMonth() + params.durationMonths);

    return await this.db.$transaction(async (tx) => {
      const updatedSub = await tx.dormitorySubscription.update({
        where: { id: currentSub.id },
        data: {
          planId: paidPlan.id,
          status: 'ACTIVE',
          expiresAt: newExpiresAt,
        },
        include: { plan: true },
      });

      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: currentSub.id,
          dormitoryId: params.dormitoryId,
          previousStatus: currentSub.status,
          newStatus: 'ACTIVE',
          previousPlanId: currentSub.planId,
          newPlanId: paidPlan.id,
          effectiveAt: now,
          actorId: params.actorId || null,
          reason: `PAID_SUBSCRIPTION_ACTIVATION_${params.durationMonths}_MONTHS`,
          metadata: {
            durationMonths: params.durationMonths,
            price: pkg.price ? pkg.price.toString() : '0',
            currency: pkg.currency,
            previousExpiresAt: currentSub.expiresAt.toISOString(),
            newExpiresAt: newExpiresAt.toISOString(),
          },
        },
      });

      return updatedSub;
    });
  }

  /**
   * Get available purchasable packages
   */
  async getAvailablePackages(): Promise<any[]> {
    await this.ensureSeeded();
    const paidPlan = await this.db.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) return [];

    const packages = await this.db.subscriptionPackage.findMany({
      where: { planId: paidPlan.id },
      orderBy: { durationMonths: 'asc' },
    });

    return packages.map((pkg) => ({
      id: pkg.id,
      durationMonths: pkg.durationMonths,
      price: pkg.price ? Number(pkg.price) : null,
      currency: pkg.currency,
      enabled: pkg.enabled && pkg.price !== null,
    }));
  }
}

export const subscriptionEntitlementService = new SubscriptionEntitlementService();
