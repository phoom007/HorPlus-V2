import { subscriptionEntitlementService, SubscriptionEntitlementService } from './subscription-entitlement.service.js';

export type EntitlementType = 'FREE' | 'PAID' | 'TRIAL';

export interface DormitoryEntitlement {
  type: EntitlementType;
  roomLimit: number;
  active: boolean;
  isReadOnly: boolean;
  startsAt?: Date | null;
  expiresAt?: Date | null;
  source: string;
}

export const ENTITLEMENT_ROOM_LIMITS = {
  FREE: 10,
  PAID: 150,
  TRIAL: 10,
} as const;

export class EntitlementService {
  private entService: SubscriptionEntitlementService;

  constructor(entServiceOrSubRepo?: any, _planRepo?: any) {
    if (entServiceOrSubRepo && typeof entServiceOrSubRepo.getEffectiveEntitlements === 'function') {
      this.entService = entServiceOrSubRepo;
    } else {
      this.entService = subscriptionEntitlementService;
    }
  }

  public async resolveDormitoryEntitlement(
    dormitoryId: string,
    now: Date = new Date()
  ): Promise<DormitoryEntitlement> {
    const details = await this.entService.getEffectiveEntitlements(dormitoryId, now);

    return {
      type: details.plan.code === 'PAID' ? 'PAID' : (details.status === 'TRIAL' ? 'TRIAL' : 'FREE'),
      roomLimit: details.roomLimit,
      active: details.isActive,
      isReadOnly: details.isReadOnly,
      startsAt: details.startedAt || details.expiresAt,
      expiresAt: details.expiresAt,
      source: `plan:${details.plan.code}`,
    };
  }
}

export const entitlementService = new EntitlementService();
