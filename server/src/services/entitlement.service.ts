import { ISubscriptionRepository } from '../db/repositories/subscription.repository.js';
import { IPlanRepository } from '../db/repositories/plan.repository.js';

export type EntitlementType = 'FREE' | 'PAID' | 'TRIAL';

export interface DormitoryEntitlement {
  type: EntitlementType;
  roomLimit: number;
  active: boolean;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  source: string;
}

export const ENTITLEMENT_ROOM_LIMITS = {
  FREE: 10,
  PAID: 150,
  TRIAL: 150,
} as const;

export class EntitlementService {
  constructor(
    private subRepo: ISubscriptionRepository,
    private planRepo: IPlanRepository
  ) {}

  public async resolveDormitoryEntitlement(
    dormitoryId: string,
    now: Date = new Date()
  ): Promise<DormitoryEntitlement> {
    const sub = await this.subRepo.findByDormitoryId(dormitoryId);
    if (!sub) {
      return {
        type: 'FREE',
        roomLimit: ENTITLEMENT_ROOM_LIMITS.FREE,
        active: true,
        source: 'default:FREE',
      };
    }

    const plan = await this.planRepo.findById(sub.planId);
    const planCode = plan ? plan.code.toUpperCase() : '';

    // Legacy plan codes compatibility mapping
    const isPaidCode = ['PAID', 'MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE', 'PRO', 'BASIC', 'STANDARD'].includes(planCode);

    if (planCode === 'FREE') {
      return {
        type: 'FREE',
        roomLimit: ENTITLEMENT_ROOM_LIMITS.FREE,
        active: true,
        startsAt: sub.trialStartedAt || sub.currentPeriodStartedAt,
        expiresAt: sub.trialEndsAt || sub.currentPeriodEndsAt,
        source: 'plan:FREE',
      };
    }

    if (sub.status === 'trialing') {
      if (sub.trialEndsAt && sub.trialEndsAt < now) {
        // Expired trial falls back to FREE entitlement
        return {
          type: 'FREE',
          roomLimit: ENTITLEMENT_ROOM_LIMITS.FREE,
          active: true,
          startsAt: sub.trialStartedAt,
          expiresAt: sub.trialEndsAt,
          source: 'expired_trial:FREE_fallback',
        };
      }
      return {
        type: 'TRIAL',
        roomLimit: ENTITLEMENT_ROOM_LIMITS.TRIAL,
        active: true,
        startsAt: sub.trialStartedAt,
        expiresAt: sub.trialEndsAt,
        source: `trial:${planCode || 'TRIAL'}`,
      };
    }

    if (sub.status === 'active' && (isPaidCode || planCode === 'PAID')) {
      return {
        type: 'PAID',
        roomLimit: ENTITLEMENT_ROOM_LIMITS.PAID,
        active: true,
        startsAt: sub.currentPeriodStartedAt,
        expiresAt: sub.currentPeriodEndsAt,
        source: `subscription:${planCode}`,
      };
    }

    if (sub.status === 'expired' || sub.status === 'cancelled' || sub.status === 'suspended' || sub.status === 'past_due') {
      return {
        type: 'FREE',
        roomLimit: ENTITLEMENT_ROOM_LIMITS.FREE,
        active: true,
        startsAt: sub.currentPeriodStartedAt,
        expiresAt: sub.currentPeriodEndsAt,
        source: `inactive_status:${sub.status}:FREE_fallback`,
      };
    }

    // Default fallback if plan is FREE or unmapped
    return {
      type: 'FREE',
      roomLimit: ENTITLEMENT_ROOM_LIMITS.FREE,
      active: true,
      source: `plan:${planCode || 'FREE'}`,
    };
  }
}
