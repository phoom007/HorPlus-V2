import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../db/prisma.js';
import { AppError } from '../types/index.js';
import { normalizeRolePermissions } from '../middleware/dormitory-context.js';
import { promoService } from './promo.service.js';

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
  remainingDays?: number | null;
  expiresAt: Date;
  startedAt?: Date;
  trialStartedAt?: Date;
  trialExpiresAt?: Date;
  promoRedeemed: boolean;
  reason?: string;
}

export interface OperationalRoomEntitlementSet {
  roomLimit: number;
  operationalRoomIds: Set<string>;
  lockedRoomIds: Set<string>;
  planCode: string;
  isReadOnly: boolean;
}

export class SubscriptionEntitlementService {
  private db: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.db = prisma || getPrismaClient();
  }

  /**
   * Syncs canonical subscription catalog (plans, packages, promo codes) into database.
   */
  async ensureSeeded(txClient?: any): Promise<void> {
    const db = (txClient && typeof txClient.subscriptionPlan?.findUnique === 'function') ? txClient : (this.db || getPrismaClient());
    const { syncSubscriptionCatalog } = await import('../scripts/subscription-catalog-sync.js');
    await syncSubscriptionCatalog(db);
  }
  async provisionInitialTrial(dormitoryId: string, txClient?: any, now: Date = new Date()): Promise<any> {
    const db = (txClient && typeof txClient.subscriptionPlan?.findUnique === 'function') ? txClient : (this.db || getPrismaClient());

    const proPlan = await db.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
    if (!proPlan) throw new Error('PAID plan (HorPlus PRO) not found in database. Run catalog sync script.');

    const existing = await db.dormitorySubscription.findUnique({ where: { dormitoryId } });
    if (existing) return existing;

    const expiresAt = addCalendarMonths(now, 1);

    const sub = await db.dormitorySubscription.create({
      data: {
        dormitoryId,
        planId: proPlan.id,
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
        previousPlanId: null,
        newPlanId: proPlan.id,
        previousStatus: null,
        newStatus: 'TRIAL',
        reason: 'INITIAL_PROVISIONING_CALENDAR_MONTH_TRIAL',
      },
    });

    return sub;
  }

  /**
   * Backfill missing subscriptions for existing dormitories
   */
  async backfillExistingDormitories(txClient?: any): Promise<number> {
    const db = txClient || this.db;

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
      const expiresAt = addCalendarMonths(dorm.createdAt, 1);
      const status = expiresAt.getTime() > now.getTime() ? 'TRIAL' : 'EXPIRED';

      try {
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
            reason: 'EXISTING_DORMITORY_BACKFILL_CALENDAR_MONTH_TRIAL',
          },
        });
        count++;
      } catch (err: any) {
        // Skip if concurrently created
        if (err.code !== 'P2002') throw err;
      }
    }

    return count;
  }

  /**
   * Get current raw subscription for a dormitory. Throws 404 if missing.
   */
  async getCurrentSubscription(dormitoryId: string, txClient?: any): Promise<any> {
    const db = txClient || this.db;
    const sub = await db.dormitorySubscription.findUnique({
      where: { dormitoryId },
      include: { plan: true },
    });

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
    let sub: any = null;
    try {
      sub = await this.getCurrentSubscription(dormitoryId, db);
    } catch {
      // Fallback to canonical FREE plan for dormitories without an explicit subscription record
    }

    if (!sub) {
      const freePlan = await db.subscriptionPlan.findUnique({ where: { code: 'FREE' } });
      const roomLimit = freePlan?.roomLimit || 10;
      const roomCount = await db.room.count({
        where: {
          dormitoryId,
          status: { not: 'archived' },
        },
      });

      return {
        dormitoryId,
        plan: {
          code: 'FREE',
          name: freePlan?.name || 'HorPlus Free',
          type: 'FREE',
          roomLimit,
        },
        status: 'ACTIVE',
        isActive: true,
        isReadOnly: false,
        isOverLimit: false,
        roomCount,
        roomLimit,
        remainingRooms: Math.max(0, roomLimit - roomCount),
        remainingDays: null,
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        promoRedeemed: false,
      };
    }

    const isFreePlan = sub.plan.type === 'FREE' || sub.plan.code === 'FREE';
    const isExpiredByTime = !isFreePlan && sub.expiresAt.getTime() <= now.getTime();
    const isExpired = sub.status === 'EXPIRED' || isExpiredByTime;
    let effectiveStatus: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' = sub.status;
    if (isExpired) {
      effectiveStatus = 'EXPIRED';
    } else if (sub.status === 'TRIAL') {
      effectiveStatus = 'TRIAL';
    } else if (isFreePlan) {
      effectiveStatus = sub.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
    }

    const roomCount = await db.room.count({
      where: {
        dormitoryId,
        status: { not: 'archived' },
      },
    });

    const roomLimit = sub.plan.roomLimit;
    const isOverLimit = isFreePlan ? false : roomCount > roomLimit;
    const isActive = !isExpired && (effectiveStatus === 'TRIAL' || effectiveStatus === 'ACTIVE');
    const isReadOnly = !isActive || isOverLimit;

    const remainingRooms = isFreePlan ? Math.max(0, roomLimit - roomCount) : Math.max(0, roomLimit - roomCount);

    const promoRedemption = await db.promoRedemption.findFirst({
      where: { dormitoryId },
    });

    let reason: string | undefined;
    if (isExpired) {
      reason = 'SUBSCRIPTION_EXPIRED: Dormitory subscription has expired.';
    } else if (isOverLimit && !isFreePlan) {
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
      remainingDays: isFreePlan ? null : Math.max(0, Math.ceil((sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))),
      expiresAt: sub.expiresAt,
      startedAt: sub.startedAt,
      trialStartedAt: sub.trialStartedAt || undefined,
      trialExpiresAt: sub.trialExpiresAt || undefined,
      promoRedeemed: !!promoRedemption,
      reason,
    };
  }

  /**
   * Redeem promo code HORPLUS (+2 calendar months) inside transaction
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

    const executeRedeem = async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${params.dormitoryId}))`;

      const promoResult = await promoService.redeemPromoAtomic(
        params.userId,
        params.dormitoryId,
        normalizedCode,
        tx,
        params.idempotencyKey,
        now
      );

      const entitlements = await this.getEffectiveEntitlements(params.dormitoryId, now, tx);
      const currentSub = await this.getCurrentSubscription(params.dormitoryId, tx);

      return {
        status: 200,
        body: {
          message: 'Promo code redeemed successfully',
          data: currentSub,
          entitlements,
        },
      };
    };

    if (params.txClient) {
      return await executeRedeem(params.txClient);
    }

    return await this.db.$transaction(async (tx) => {
      const payloadHash = `redeem:${params.userId}:${params.dormitoryId}:${normalizedCode}`;
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
        return {
          status: existingRecord.responseStatus,
          body: existingRecord.responseBody,
        };
      }

      const result = await executeRedeem(tx);

      await tx.idempotencyKey.create({
        data: {
          userId: params.userId,
          operation: 'PROMO_REDEEM',
          idempotencyKey: params.idempotencyKey,
          requestHash: payloadHash,
          responseStatus: 200,
          responseBody: JSON.parse(JSON.stringify(result.body)),
          expiresAt,
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
    const packages = await db.subscriptionPackage.findMany({
      include: { plan: true },
      orderBy: { durationMonths: 'asc' },
    });

    return packages.map((pkg: any) => ({
      id: pkg.id,
      planCode: pkg.plan.code,
      planName: pkg.plan.name,
      durationMonths: pkg.durationMonths,
      price: pkg.price !== null ? Number(pkg.price) : null,
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
    const dorm = await db.dormitory.findUnique({
      where: { id: dormitoryId },
      select: { status: true },
    });
    if (dorm && dorm.status === 'setup_pending') {
      return;
    }

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

    const isFreePlan = entitlement.plan.type === 'FREE' || entitlement.plan.code === 'FREE';
    if (!isFreePlan && entitlement.roomCount >= entitlement.roomLimit) {
      throw new AppError(
        `Cannot create room. Current room count (${entitlement.roomCount}) has reached or exceeded plan limit (${entitlement.roomLimit}).`,
        409,
        'ROOM_LIMIT_REACHED'
      );
    }
  }

  /**
   * Bounded batch authority to resolve operational vs locked rooms for a dormitory.
   * - FREE tier: first 10 non-archived rooms (by createdAt ASC, id ASC) are operational, 11+ are locked.
   * - PAID tier: up to 150 non-archived rooms are operational.
   * - Bounded by canonical provisioning ceiling (150).
   */
  async resolveOperationalRoomEntitlementSet(
    dormitoryId: string,
    now: Date = new Date(),
    txClient?: any
  ): Promise<OperationalRoomEntitlementSet> {
    const db = txClient || this.db;
    const entitlement = await this.getEffectiveEntitlements(dormitoryId, now, db);
    const roomLimit = entitlement.roomLimit; // 10 for FREE, 150 for PAID

    const eligibleRooms = await db.room.findMany({
      where: {
        dormitoryId,
        status: { not: 'archived' },
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: { id: true },
      take: 150, // bounded by canonical provisioning ceiling
    });

    const operationalRoomIds = new Set<string>();
    const lockedRoomIds = new Set<string>();

    eligibleRooms.forEach((r: { id: string }, index: number) => {
      if (index < roomLimit) {
        operationalRoomIds.add(r.id);
      } else {
        lockedRoomIds.add(r.id);
      }
    });

    return {
      roomLimit,
      operationalRoomIds,
      lockedRoomIds,
      planCode: entitlement.plan.code,
      isReadOnly: entitlement.isReadOnly,
    };
  }

  /**
   * Assert operational entitlement for a specific room.
   * Under FREE tier, the first 10 non-archived rooms (by createdAt ASC, id ASC) are operational.
   * Rooms #11+ cannot perform operational actions (assigning tenant, active contracts, billing, meters).
   */
  async assertRoomOperationalEntitlement(dormitoryId: string, roomId: string, now: Date = new Date(), txClient?: any): Promise<void> {
    const db = txClient || this.db;
    await this.assertDormitoryWritable(dormitoryId, now, db);
    const set = await this.resolveOperationalRoomEntitlementSet(dormitoryId, now, db);

    if (set.lockedRoomIds.has(roomId)) {
      throw new AppError(
        `ห้องพักนี้เกินสิทธิ์การใช้งานของแพ็กเกจฟรี (จำกัด ${set.roomLimit} ห้องที่เปิดใช้งานพร้อมกัน) กรุณาอัปเกรดแพ็กเกจเพื่อเปิดใช้งานห้องนี้`,
        403,
        'ROOM_ENTITLEMENT_LOCKED'
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
    actorId: string;
    idempotencyKey: string;
    reason: string;
    txClient?: any;
    now?: Date;
  }): Promise<any> {
    // Validate required params at service boundary
    if (!params.actorId || !params.actorId.trim()) {
      throw new AppError('actorId is required for operational activation.', 400, 'VALIDATION_ERROR');
    }
    if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
      throw new AppError('idempotencyKey is required for operational activation.', 400, 'VALIDATION_ERROR');
    }
    if (params.idempotencyKey.length > 255) {
      throw new AppError('idempotencyKey exceeds maximum length (255).', 400, 'VALIDATION_ERROR');
    }
    if (!params.reason || !params.reason.trim()) {
      throw new AppError('reason is required for operational activation.', 400, 'VALIDATION_ERROR');
    }
    if (params.reason.length > 1000) {
      throw new AppError('reason exceeds maximum length (1000).', 400, 'VALIDATION_ERROR');
    }

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
      // Load and validate SubscriptionPackage from PostgreSQL catalog
      const paidPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      if (!paidPlan) throw new AppError('CATALOG_NOT_SYNCED: PAID plan not seeded.', 500, 'PLAN_NOT_FOUND');

      const pkg = await tx.subscriptionPackage.findFirst({
        where: {
          planId: paidPlan.id,
          durationMonths: params.durationMonths,
        },
      });

      if (!pkg) {
        throw new AppError(`No subscription package found for PAID plan with ${params.durationMonths} month(s).`, 404, 'PACKAGE_NOT_FOUND');
      }
      if (!pkg.enabled) {
        throw new AppError(`Subscription package for ${params.durationMonths} month(s) is disabled.`, 403, 'PACKAGE_DISABLED');
      }
      if (pkg.price === null || pkg.price === undefined) {
        throw new AppError(`Subscription package for ${params.durationMonths} month(s) has no confirmed price.`, 400, 'PACKAGE_PRICE_NOT_CONFIGURED');
      }
      if (Number(pkg.price) < 0) {
        throw new AppError(`Subscription package price is invalid.`, 400, 'PACKAGE_PRICE_NOT_CONFIGURED');
      }
      if (pkg.currency !== 'THB') {
        throw new AppError(`Subscription package currency must be THB, got ${pkg.currency}.`, 400, 'PACKAGE_CURRENCY_INVALID');
      }

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

      const historyRecord = await tx.subscriptionStatusHistory.create({
        data: {
          subscriptionId: currentSub.id,
          dormitoryId: params.dormitoryId,
          previousPlanId: currentSub.planId,
          newPlanId: paidPlan.id,
          previousStatus: currentSub.status,
          newStatus: 'ACTIVE',
          actorId: params.actorId,
          reason: params.reason,
          metadata: {
            packageId: pkg.id,
            durationMonths: params.durationMonths,
            price: Number(pkg.price),
            currency: pkg.currency,
            idempotencyKey: params.idempotencyKey,
          },
        },
      });

      const snapshot = {
        subscription: updatedSub,
        packageId: pkg.id,
        durationMonths: params.durationMonths,
        price: Number(pkg.price),
        currency: pkg.currency,
        effectiveStart: baseStart,
        newExpiry: newExpiresAt,
        historyId: historyRecord.id,
      };

      return snapshot;
    };

    if (params.txClient) {
      return await executeActivation(params.txClient);
    }

    return await this.db.$transaction(async (tx) => {
      // Load pkg to construct payloadHash with package ID
      const paidPlan = await tx.subscriptionPlan.findUnique({ where: { code: 'PAID' } });
      const pkg = paidPlan ? await tx.subscriptionPackage.findFirst({ where: { planId: paidPlan.id, durationMonths: params.durationMonths } }) : null;
      const pkgId = pkg?.id || 'unknown';

      const payloadHash = `activate:${params.actorId}:${params.dormitoryId}:${params.durationMonths}:${pkgId}:${params.reason}`;
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
        return {
          status: existing.responseStatus,
          body: existing.responseBody,
        };
      }

      const snapshot = await executeActivation(tx);

      await tx.idempotencyKey.create({
        data: {
          userId: params.actorId,
          operation: 'OPERATIONAL_ACTIVATION',
          idempotencyKey: params.idempotencyKey,
          requestHash: payloadHash,
          responseStatus: 200,
          responseBody: JSON.parse(JSON.stringify(snapshot)),
          expiresAt,
        },
      });

      return {
        status: 200,
        body: snapshot,
      };
    });
  }
}

export const subscriptionEntitlementService = new SubscriptionEntitlementService();
