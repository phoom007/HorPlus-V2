import { PrismaClient } from '@prisma/client';
import { AppError } from '../types/index.js';
import { normalizeRolePermissions } from '../middleware/dormitory-context.js';

export function addCalendarMonths(startDate: Date, months: number): Date {
  const target = new Date(startDate.getTime());
  const originalDay = target.getDate();
  target.setMonth(target.getMonth() + months);

  if (target.getDate() !== originalDay) {
    target.setDate(0);
  }
  return target;
}

export interface EffectiveEntitlements {
  dormitoryId: string;
  plan: {
    code: string;
    name: string;
    type: string;
    roomLimit: number;
  };
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  isActive: boolean;
  isReadOnly: boolean;
  isOverLimit: boolean;
  roomCount: number;
  roomLimit: number;
  remainingRooms: number;
  expiresAt: Date;
  startedAt?: Date;
  trialStartedAt?: Date;
  trialExpiresAt?: Date;
  promoRedeemed: boolean;
  reason?: string;
}

export class SubscriptionEntitlementService {
  private db: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.db = prisma || new PrismaClient();
  }

  /**
   * Seed standard plans and packages idempotently if missing
   */
  async ensureSeeded(txClient?: any): Promise<void> {
    const db = txClient || this.db;
    const freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) {
      await db.subscriptionPlan.create({
        data: {
          code: 'FREE',
          name: 'Free / Trial',
          type: 'FREE',
          roomLimit: 10,
        },
      });
    }

    const paidPlan = await db.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!paidPlan) {
      const createdPaid = await db.subscriptionPlan.create({
        data: {
          code: 'PAID',
          name: 'Paid',
          type: 'PAID',
          roomLimit: 150,
        },
      });

      const packages = [
        { durationMonths: 1, price: 189.00, enabled: true },
        { durationMonths: 3, price: 0.00, enabled: false },
        { durationMonths: 6, price: 0.00, enabled: false },
        { durationMonths: 12, price: 0.00, enabled: false },
        { durationMonths: 24, price: 0.00, enabled: false },
      ];

      for (const pkg of packages) {
        await db.subscriptionPackage.create({
          data: {
            planId: createdPaid.id,
            durationMonths: pkg.durationMonths,
            price: pkg.price,
            currency: 'THB',
            enabled: pkg.enabled,
          },
        });
      }
    }

    const promo = await db.promoCode.findUnique({ where: { code: 'HORPLUS' } });
    if (!promo) {
      await db.promoCode.create({
        data: {
          code: 'HORPLUS',
          normalizedCode: 'HORPLUS',
          extensionDays: 60,
        },
      });
    }
  }

  /**
   * Provision a 30-day Trial subscription for a new dormitory inside transaction
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
        previousPlanId: freePlan.id,
        newPlanId: freePlan.id,
        previousStatus: null,
        newStatus: 'TRIAL',
        reason: 'INITIAL_PROVISIONING_30_DAY_TRIAL',
      },
    });

    return sub;
  }

  /**
   * Backfill missing subscriptions for existing dormitories
   */
  async backfillExistingDormitories(txClient?: any): Promise<number> {
    const db = txClient || this.db;
    await this.ensureSeeded(db);

    const dormitoriesWithoutSub = await db.dormitory.findMany({
      where: {
        dormitorySubscription: null,
      },
      select: { id: true, createdAt: true },
    });

    let count = 0;
    const freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
    if (!freePlan) return 0;

    for (const dorm of dormitoriesWithoutSub) {
      const now = new Date();
      const expiresAt = new Date(dorm.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const status = expiresAt.getTime() > now.getTime() ? 'TRIAL' : 'EXPIRED';

      const sub = await db.dormitorySubscription.create({
        data: {
          dormitoryId: dorm.id,
          planId: freePlan.id,
          status,
          startedAt: dorm.createdAt,
          expiresAt,
          trialStartedAt: dorm.createdAt,
          trialExpiresAt: expiresAt,
        },
      });

      await db.subscriptionStatusHistory.create({
        data: {
          subscriptionId: sub.id,
          dormitoryId: dorm.id,
          previousPlanId: freePlan.id,
          newPlanId: freePlan.id,
          previousStatus: null,
          newStatus: status,
          reason: 'EXISTING_DORMITORY_BACKFILL_30_DAY_TRIAL',
        },
      });

      count++;
    }

    return count;
  }

  /**
   * Get current raw subscription for a dormitory. Throws 404 if missing.
   */
  async getCurrentSubscription(dormitoryId: string, txClient?: any): Promise<any> {
    const db = txClient || this.db;
    let sub = await db.dormitorySubscription.findUnique({
      where: { dormitoryId },
      include: { plan: true },
    });

    if (!sub) {
      await this.provisionInitialTrial(dormitoryId, db);
      sub = await db.dormitorySubscription.findUnique({
        where: { dormitoryId },
        include: { plan: true },
      });
    }

    if (!sub) {
      throw new AppError('No subscription found for this dormitory.', 404, 'SUBSCRIPTION_NOT_FOUND');
    }

    return sub;
  }

  /**
   * Calculate effective entitlement details using txClient connection
   */
  async getEffectiveEntitlements(dormitoryId: string, now: Date = new Date(), txClient?: any): Promise<EffectiveEntitlements> {
    const db = txClient || this.db;
    await this.ensureSeeded(db);
    const sub = await this.getCurrentSubscription(dormitoryId, db);

    const isExpired = sub.expiresAt.getTime() <= now.getTime();
    let effectiveStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' = sub.status;
    if (isExpired && (sub.status === 'TRIAL' || sub.status === 'ACTIVE')) {
      effectiveStatus = 'EXPIRED';
    }

    const roomCount = await db.room.count({
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

    const promoRedemption = await db.promoRedemption.findFirst({
      where: { dormitoryId },
    });

    let reason: string | undefined;
    if (isExpired) {
      reason = 'SUBSCRIPTION_EXPIRED: Dormitory subscription has expired.';
    } else if (isOverLimit) {
      reason = `ROOM_LIMIT_EXCEEDED: Room count (${roomCount}) exceeds plan limit (${roomLimit}).`;
    } else if (sub.status === 'SUSPENDED') {
      reason = 'SUBSCRIPTION_SUSPENDED: Dormitory subscription is suspended.';
    }

    return {
      dormitoryId,
      plan: {
        code: sub.plan.code,
        name: sub.plan.name,
        type: sub.plan.type,
        roomLimit: sub.plan.roomLimit,
      },
      status: effectiveStatus,
      isActive,
      isReadOnly,
      isOverLimit,
      roomCount,
      roomLimit,
      remainingRooms,
      expiresAt: sub.expiresAt,
      startedAt: sub.startedAt,
      trialStartedAt: sub.trialStartedAt || undefined,
      trialExpiresAt: sub.trialExpiresAt || undefined,
      promoRedeemed: !!promoRedemption,
      reason,
    };
  }

  /**
   * Redeem promo code HORPLUS inside transaction
   */
  async redeemPromoCode(params: {
    dormitoryId: string;
    code: string;
    userId: string;
    idempotencyKey: string;
    txClient?: any;
    now?: Date;
  }): Promise<any> {
    const now = params.now || new Date();
    const normalizedCode = params.code.trim().toUpperCase();

    if (normalizedCode !== 'HORPLUS') {
      throw new AppError('Invalid promo code.', 404, 'PROMO_CODE_INVALID');
    }

    const executeRedeem = async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.dormitoryId}))`;

      const entitlements = await this.getEffectiveEntitlements(params.dormitoryId, now, tx);
      if (entitlements.isReadOnly || entitlements.status === 'EXPIRED') {
        throw new AppError('Cannot redeem promo code for an expired or read-only subscription.', 403, 'SUBSCRIPTION_READ_ONLY');
      }

      if (entitlements.promoRedeemed) {
        throw new AppError('Promo code HORPLUS has already been redeemed for this dormitory.', 409, 'PROMO_ALREADY_REDEEMED');
      }

      const promoCodeEntity = await tx.promoCode.findUnique({
        where: { code: 'HORPLUS' },
      });
      if (!promoCodeEntity) {
        throw new AppError('Promo code definition missing.', 404, 'PROMO_CODE_NOT_FOUND');
      }

      const currentSub = await this.getCurrentSubscription(params.dormitoryId, tx);

      const extensionMs = promoCodeEntity.extensionDays * 24 * 60 * 60 * 1000;
      const newTrialExpiresAt = new Date((currentSub.trialExpiresAt || currentSub.expiresAt).getTime() + extensionMs);
      const newExpiresAt = new Date(currentSub.expiresAt.getTime() + extensionMs);

      const updatedSub = await tx.dormitorySubscription.update({
        where: { id: currentSub.id },
        data: {
          expiresAt: newExpiresAt,
          trialExpiresAt: newTrialExpiresAt,
        },
        include: { plan: true },
      });

      await tx.promoRedemption.create({
        data: {
          promoCodeId: promoCodeEntity.id,
          dormitoryId: params.dormitoryId,
          subscriptionId: currentSub.id,
          redeemedBy: params.userId,
          previousExpiresAt: currentSub.expiresAt,
          newExpiresAt,
        },
      });

      await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: currentSub.id,
          dormitoryId: params.dormitoryId,
          previousPlanId: currentSub.planId,
          newPlanId: currentSub.planId,
          previousStatus: currentSub.status,
          newStatus: currentSub.status,
          actorId: params.userId,
          reason: `PROMO_REDEEMED: ${promoCodeEntity.code} (+${promoCodeEntity.extensionDays} days)`,
        },
      });

      return updatedSub;
    };

    if (params.txClient) {
      return await executeRedeem(params.txClient);
    }

    return await this.db.$transaction(async (tx) => {
      const payloadHash = `redeem:${params.dormitoryId}:${normalizedCode}`;
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const existingRecord = await tx.idempotencyKey.findUnique({
        where: {
          user_operation_idempotency_unique: {
            userId: params.userId,
            operation: 'PROMO_REDEEM',
            idempotencyKey: params.idempotencyKey,
          },
        },
      });

      if (existingRecord) {
        if (existingRecord.requestHash !== payloadHash) {
          throw new AppError('Idempotency key payload mismatch.', 409, 'IDEMPOTENCY_MISMATCH');
        }
        const currentSub = await this.getCurrentSubscription(params.dormitoryId, tx);
        return currentSub;
      }

      await tx.idempotencyKey.create({
        data: {
          userId: params.userId,
          operation: 'PROMO_REDEEM',
          idempotencyKey: params.idempotencyKey,
          requestHash: payloadHash,
          responseStatus: 200,
          responseBody: {},
          expiresAt,
        },
      });

      const result = await executeRedeem(tx);

      await tx.idempotencyKey.update({
        where: {
          user_operation_idempotency_unique: {
            userId: params.userId,
            operation: 'PROMO_REDEEM',
            idempotencyKey: params.idempotencyKey,
          },
        },
        data: {
          responseBody: JSON.parse(JSON.stringify(result)),
        },
      });

      return result;
    });
  }

  /**
   * Get available package options
   */
  async getAvailablePackages(txClient?: any): Promise<any[]> {
    const db = txClient || this.db;
    await this.ensureSeeded(db);
    const packages = await db.subscriptionPackage.findMany({
      include: { plan: true },
      orderBy: { durationMonths: 'asc' },
    });

    return packages.map((pkg: any) => ({
      id: pkg.id,
      planCode: pkg.plan.code,
      planName: pkg.plan.name,
      durationMonths: pkg.durationMonths,
      price: Number(pkg.price),
      currency: pkg.currency,
      enabled: pkg.enabled,
      roomLimit: pkg.plan.roomLimit,
    }));
  }

  /**
   * Assert writable entitlement using txClient
   */
  async assertDormitoryWritable(dormitoryId: string, now: Date = new Date(), txClient?: any): Promise<void> {
    const db = txClient || this.db;
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now, db);
    if (entitlement.isReadOnly) {
      throw new AppError(
        `Dormitory operation restricted to read-only mode. Reason: ${entitlement.reason}`,
        403,
        'SUBSCRIPTION_READ_ONLY'
      );
    }
  }

  /**
   * Assert room creation allowed under transaction client txClient
   */
  async assertRoomCreationAllowed(dormitoryId: string, now: Date = new Date(), txClient?: any): Promise<void> {
    const db = txClient || this.db;
    await this.assertDormitoryWritable(dormitoryId, now, db);
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now, db);

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
  async assertDormitoryCreationAllowed(ownerUserId: string, txClient?: any): Promise<void> {
    const db = txClient || this.db;
    const ownedCount = await db.dormitoryMember.count({
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
   * Operational paid subscription activation (Internal / CLI / Test only)
   */
  async activatePaidSubscriptionOperational(params: {
    dormitoryId: string;
    durationMonths: number;
    actorId?: string;
    idempotencyKey?: string;
    reason?: string;
    txClient?: any;
    now?: Date;
  }): Promise<any> {
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl) {
      throw new AppError('DATABASE_URL environment variable is missing.', 500, 'ENV_MISSING');
    }

    try {
      const parsedUrl = new URL(dbUrl);
      const host = parsedUrl.hostname;
      const port = parsedUrl.port;
      const dbName = parsedUrl.pathname.replace(/^\//, '');

      const isProduction = process.env.NODE_ENV === 'production';
      const isPilot = dbName.includes('horplus_pilot') || port === '5432';
      const isLoopback = host === '127.0.0.1' || host === 'localhost';

      if (isProduction || isPilot || !isLoopback) {
        throw new AppError('Operational activation is strictly prohibited in production, pilot, or non-loopback environments.', 403, 'OPERATIONAL_ACTIVATION_PROHIBITED');
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError('Operational activation environment URL parsing failed.', 403, 'OPERATIONAL_ACTIVATION_PROHIBITED');
    }

    if (process.env.ALLOW_OPERATIONAL_ACTIVATION !== 'true') {
      throw new AppError('Operational activation is disabled (ALLOW_OPERATIONAL_ACTIVATION !== true).', 403, 'OPERATIONAL_ACTIVATION_DISABLED');
    }

    const now = params.now || new Date();

    const executeActivation = async (tx: any) => {
      await this.ensureSeeded(tx);

      const allowedDurations = [1, 3, 6, 12, 24];
      if (!allowedDurations.includes(params.durationMonths)) {
        throw new AppError('Duration months must be one of 1, 3, 6, 12, or 24.', 400, 'VALIDATION_ERROR');
      }

      const paidPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      if (!paidPlan) throw new AppError('PAID plan not seeded.', 500, 'PLAN_NOT_FOUND');

      const currentSub = await this.getCurrentSubscription(params.dormitoryId, tx);

      const baseStart = currentSub.expiresAt.getTime() > now.getTime() ? currentSub.expiresAt : now;
      const newExpiresAt = addCalendarMonths(baseStart, params.durationMonths);

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
          previousPlanId: currentSub.planId,
          newPlanId: paidPlan.id,
          previousStatus: currentSub.status,
          newStatus: 'ACTIVE',
          actorId: params.actorId || null,
          reason: params.reason || `OPERATIONAL_PAID_ACTIVATION: ${params.durationMonths} month(s)`,
        },
      });

      return updatedSub;
    };

    if (params.txClient) {
      return await executeActivation(params.txClient);
    }

    return await this.db.$transaction(async (tx) => {
      if (params.idempotencyKey && params.actorId) {
        const payloadHash = `activate:${params.dormitoryId}:${params.durationMonths}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

        const existing = await tx.idempotencyKey.findUnique({
          where: {
            user_operation_idempotency_unique: {
              userId: params.actorId,
              operation: 'OPERATIONAL_ACTIVATION',
              idempotencyKey: params.idempotencyKey,
            },
          },
        });

        if (existing) {
          if (existing.requestHash !== payloadHash) {
            throw new AppError('Idempotency key payload mismatch.', 409, 'IDEMPOTENCY_MISMATCH');
          }
          return await this.getCurrentSubscription(params.dormitoryId, tx);
        }

        await tx.idempotencyKey.create({
          data: {
            userId: params.actorId,
            operation: 'OPERATIONAL_ACTIVATION',
            idempotencyKey: params.idempotencyKey,
            requestHash: payloadHash,
            responseStatus: 200,
            responseBody: {},
            expiresAt,
          },
        });

        const result = await executeActivation(tx);

        await tx.idempotencyKey.update({
          where: {
            user_operation_idempotency_unique: {
              userId: params.actorId,
              operation: 'OPERATIONAL_ACTIVATION',
              idempotencyKey: params.idempotencyKey,
            },
          },
          data: {
            responseBody: JSON.parse(JSON.stringify(result)),
          },
        });

        return result;
      }

      return await executeActivation(tx);
    });
  }
}

export const subscriptionEntitlementService = new SubscriptionEntitlementService();
