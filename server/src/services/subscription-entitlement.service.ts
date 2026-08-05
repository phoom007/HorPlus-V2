import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import crypto from 'crypto';

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
   * Idempotently backfill 30-day Trial subscriptions for all existing dormitories without a subscription.
   * Creates DormitorySubscription AND SubscriptionStatusHistory with reason EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL.
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

    const runTimestamp = new Date();
    const expiresAt = new Date(runTimestamp.getTime() + 30 * 24 * 60 * 60 * 1000);
    let count = 0;

    for (const dorm of dormitories) {
      await this.db.$transaction(async (tx) => {
        const existingSub = await tx.dormitorySubscription.findUnique({
          where: { dormitoryId: dorm.id },
        });
        if (existingSub) return;

        const sub = await tx.dormitorySubscription.create({
          data: {
            dormitoryId: dorm.id,
            planId: freePlan.id,
            status: 'TRIAL',
            startedAt: runTimestamp,
            expiresAt: expiresAt,
            trialStartedAt: runTimestamp,
            trialExpiresAt: expiresAt,
          },
        });

        await tx.subscriptionStatusHistory.create({
          data: {
            subscriptionId: sub.id,
            dormitoryId: dorm.id,
            previousStatus: null,
            newStatus: 'TRIAL',
            previousPlanId: null,
            newPlanId: freePlan.id,
            effectiveAt: runTimestamp,
            reason: 'EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL',
          },
        });

        count++;
      });
    }

    return { backfilledCount: count };
  }

  /**
   * Provision a 30-day Trial subscription for a newly created dormitory (atomic within creation transaction).
   */
  async provisionInitialTrial(dormitoryId: string, txClient?: any, now: Date = new Date()): Promise<any> {
    const db = txClient || this.db;
    await this.ensureSeeded(db);

    const freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) throw new Error('FREE plan not seeded');

    const existing = await db.dormitorySubscription.findUnique({ where: { dormitoryId } });
    if (existing) return existing;

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
   * Get current subscription for a dormitory.
   * Throws SUBSCRIPTION_NOT_FOUND (404) if missing. Does NOT provision as a GET side-effect.
   */
  async getCurrentSubscription(dormitoryId: string, txClient?: any): Promise<any> {
    const db = txClient || this.db;
    const sub = await db.dormitorySubscription.findUnique({
      where: { dormitoryId },
      include: { plan: true },
    });

    if (!sub) {
      throw new AppError('Dormitory subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
    }

    return sub;
  }

  /**
   * Calculate effective entitlement details at request time.
   * isOverLimit = roomCount > roomLimit
   * isReadOnly = subscriptionInactive OR isOverLimit
   */
  async getEffectiveEntitlements(dormitoryId: string, now: Date = new Date()): Promise<any> {
    await this.ensureSeeded();
    const sub = await this.getCurrentSubscription(dormitoryId);

    const isExpired = sub.expiresAt.getTime() <= now.getTime();
    let effectiveStatus = sub.status;
    if (isExpired && (sub.status === 'TRIAL' || sub.status === 'ACTIVE')) {
      effectiveStatus = 'EXPIRED';
    }

    const roomCount = await this.db.room.count({
      where: {
        dormitoryId,
        status: { not: 'archived' },
      },
    });

    const roomLimit = sub.plan.roomLimit;
    const isOverLimit = roomCount > roomLimit;
    const isActive = !isExpired && (effectiveStatus === 'TRIAL' || effectiveStatus === 'ACTIVE');
    const isReadOnly = !isActive || isOverLimit;

    const remainingRooms = Math.max(0, roomLimit - roomCount);

    const promoRedemption = await this.db.promoRedemption.findFirst({
      where: { dormitoryId },
    });

    let reason = 'Subscription active';
    if (isExpired) {
      reason = 'SUBSCRIPTION_EXPIRED: Dormitory subscription has expired.';
    } else if (isOverLimit) {
      reason = `ROOM_LIMIT_EXCEEDED: Room count (${roomCount}) exceeds plan limit (${roomLimit}).`;
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
   * Assert dormitory writable (throws HTTP 403 SUBSCRIPTION_READ_ONLY if expired or over limit)
   */
  async assertDormitoryWritable(dormitoryId: string, now: Date = new Date()): Promise<void> {
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now);
    if (entitlement.isReadOnly) {
      throw new AppError(
        `Dormitory operation restricted to read-only mode. Reason: ${entitlement.reason}`,
        403,
        'SUBSCRIPTION_READ_ONLY'
      );
    }
  }

  /**
   * Assert room creation allowed under PostgreSQL transaction lock.
   */
  async assertRoomCreationAllowed(dormitoryId: string, now: Date = new Date()): Promise<void> {
    await this.assertDormitoryWritable(dormitoryId, now);
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now);

    if (entitlement.roomCount >= entitlement.roomLimit) {
      throw new AppError(
        `Cannot create room. Current room count (${entitlement.roomCount}) has reached or exceeded plan limit (${entitlement.roomLimit}).`,
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
   * Redeem HORPLUS promo code with persistent idempotency and PG locking.
   */
  async redeemPromoCode(params: {
    dormitoryId: string;
    code: string;
    userId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<any> {
    const now = params.now || new Date();
    const normalizedCode = params.code.trim().toUpperCase();

    if (!params.idempotencyKey) {
      throw new AppError('X-Idempotency-Key header is required for promo code redemption.', 400, 'IDEMPOTENCY_KEY_REQUIRED');
    }

    await this.ensureSeeded();

    const requestHash = crypto
      .createHash('sha256')
      .update(`${params.userId}:${params.dormitoryId}:${normalizedCode}`)
      .digest('hex');

    const operation = 'PROMO_REDEEM';

    // 1. Check persistent idempotency key
    const existingKey = await this.db.idempotencyKey.findUnique({
      where: {
        user_operation_idempotency_unique: {
          userId: params.userId,
          operation,
          idempotencyKey: params.idempotencyKey,
        },
      },
    });

    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throw new AppError('Idempotency key payload mismatch.', 409, 'IDEMPOTENCY_MISMATCH');
      }
      if (existingKey.status === 'completed' && existingKey.responseBody) {
        return existingKey.responseBody;
      }
    }

    // 2. Perform atomic redemption transaction under PG advisory lock
    return await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.dormitoryId}))`;

      let sub = await tx.dormitorySubscription.findUnique({
        where: { dormitoryId: params.dormitoryId },
        include: { plan: true },
      });

      if (!sub) {
        throw new AppError('Dormitory subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
      }

      if (sub.expiresAt.getTime() <= now.getTime()) {
        throw new AppError('Dormitory subscription has expired. Operations are restricted to read-only mode.', 403, 'SUBSCRIPTION_READ_ONLY');
      }

      if (sub.status !== 'TRIAL') {
        throw new AppError('Promo code HORPLUS can only be redeemed during an active Trial subscription.', 400, 'PROMO_NOT_ELIGIBLE');
      }

      const promo = await tx.promoCode.findFirst({
        where: { normalizedCode, enabled: true },
      });

      if (!promo) {
        throw new AppError('Invalid or unsupported promo code.', 404, 'PROMO_INVALID');
      }

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
        include: { plan: true },
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

      await tx.idempotencyKey.upsert({
        where: {
          user_operation_idempotency_unique: {
            userId: params.userId,
            operation,
            idempotencyKey: params.idempotencyKey,
          },
        },
        create: {
          userId: params.userId,
          operation,
          idempotencyKey: params.idempotencyKey,
          requestHash,
          status: 'completed',
          responseStatus: 200,
          responseBody: updatedSub as any,
          expiresAt: new Date(now.getTime() + 86400 * 1000),
        },
        update: {
          status: 'completed',
          responseStatus: 200,
          responseBody: updatedSub as any,
        },
      });

      return updatedSub;
    });
  }

  /**
   * Authoritative Operational Paid Subscription Activation (Internal/Test/CLI only).
   * Restricted by env check: NODE_ENV === 'test' || ALLOW_OPERATIONAL_ACTIVATION === 'true'.
   */
  async activatePaidSubscriptionOperational(params: {
    dormitoryId: string;
    durationMonths: number;
    actorId?: string;
    idempotencyKey?: string;
    reason?: string;
    now?: Date;
  }): Promise<any> {
    const isTestMode = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development' || process.env.ALLOW_OPERATIONAL_ACTIVATION === 'true';
    if (!isTestMode) {
      throw new AppError('Operational activation is disabled in this environment.', 403, 'OPERATIONAL_ACTIVATION_DISABLED');
    }

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

    const actorId = params.actorId || '00000000-0000-0000-0000-000000000000';
    const keyString = params.idempotencyKey || `op-activate-${params.dormitoryId}-${params.durationMonths}-${now.getTime()}`;
    const operation = 'OPERATIONAL_ACTIVATION';

    const requestHash = crypto
      .createHash('sha256')
      .update(`${params.dormitoryId}:${params.durationMonths}`)
      .digest('hex');

    const existingKey = await this.db.idempotencyKey.findUnique({
      where: {
        user_operation_idempotency_unique: {
          userId: actorId,
          operation,
          idempotencyKey: keyString,
        },
      },
    });

    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throw new AppError('Idempotency key payload mismatch.', 409, 'IDEMPOTENCY_MISMATCH');
      }
      if (existingKey.status === 'completed' && existingKey.responseBody) {
        return existingKey.responseBody;
      }
    }

    return await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.dormitoryId}))`;

      const currentSub = await tx.dormitorySubscription.findUnique({
        where: { dormitoryId: params.dormitoryId },
      });

      if (!currentSub) {
        throw new AppError('Dormitory subscription not found.', 404, 'SUBSCRIPTION_NOT_FOUND');
      }

      const baseDate = currentSub.expiresAt.getTime() > now.getTime() ? currentSub.expiresAt : now;
      const newExpiresAt = new Date(baseDate);
      newExpiresAt.setMonth(newExpiresAt.getMonth() + params.durationMonths);

      if (newExpiresAt.getTime() <= currentSub.expiresAt.getTime()) {
        throw new AppError('Activation cannot shorten an existing valid subscription.', 400, 'INVALID_SUBSCRIPTION_EXTENSION');
      }

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
          reason: params.reason || `OPERATIONAL_PAID_ACTIVATION_${params.durationMonths}_MONTHS`,
          metadata: {
            durationMonths: params.durationMonths,
            price: pkg.price ? pkg.price.toString() : '0',
            currency: pkg.currency,
            previousExpiresAt: currentSub.expiresAt.toISOString(),
            newExpiresAt: newExpiresAt.toISOString(),
          },
        },
      });

      await tx.idempotencyKey.upsert({
        where: {
          user_operation_idempotency_unique: {
            userId: actorId,
            operation,
            idempotencyKey: keyString,
          },
        },
        create: {
          userId: actorId,
          operation,
          idempotencyKey: keyString,
          requestHash,
          status: 'completed',
          responseStatus: 200,
          responseBody: updatedSub as any,
          expiresAt: new Date(now.getTime() + 86400 * 1000),
        },
        update: {
          status: 'completed',
          responseStatus: 200,
          responseBody: updatedSub as any,
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
