export interface PlatformSubscriptionEntity {
  id: string;
  dormitoryId: string;
  planId: string;
  status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'expired';
  billingInterval: string;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  currentPeriodStartedAt?: Date | null;
  currentPeriodEndsAt?: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSubscriptionData {
  dormitoryId: string;
  planId: string;
  status?: PlatformSubscriptionEntity['status'];
  billingInterval?: string;
  trialStartedAt?: Date;
  trialEndsAt?: Date;
  currentPeriodStartedAt?: Date;
  currentPeriodEndsAt?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface ISubscriptionRepository {
  findByDormitoryId(dormitoryId: string): Promise<PlatformSubscriptionEntity | null>;
  create(data: CreateSubscriptionData): Promise<PlatformSubscriptionEntity>;
  update(id: string, data: Partial<PlatformSubscriptionEntity>): Promise<PlatformSubscriptionEntity | null>;
}

export class InMemorySubscriptionRepository implements ISubscriptionRepository {
  private subs: Map<string, PlatformSubscriptionEntity> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData(): void {
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    this.subs.set('dorm-001', {
      id: 'sub-demo-001',
      dormitoryId: 'dorm-001',
      planId: 'plan-free',
      status: 'trialing',
      billingInterval: 'monthly',
      trialStartedAt: now,
      trialEndsAt,
      currentPeriodStartedAt: now,
      currentPeriodEndsAt: trialEndsAt,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  public async findByDormitoryId(dormitoryId: string): Promise<PlatformSubscriptionEntity | null> {
    for (const sub of this.subs.values()) {
      if (sub.dormitoryId === dormitoryId) return sub;
    }
    return null;
  }

  public async create(data: CreateSubscriptionData): Promise<PlatformSubscriptionEntity> {
    const now = new Date();
    const entity: PlatformSubscriptionEntity = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      planId: data.planId,
      status: data.status || 'trialing',
      billingInterval: data.billingInterval || 'monthly',
      trialStartedAt: data.trialStartedAt || now,
      trialEndsAt: data.trialEndsAt || null,
      currentPeriodStartedAt: data.currentPeriodStartedAt || now,
      currentPeriodEndsAt: data.currentPeriodEndsAt || null,
      cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.subs.set(data.dormitoryId, entity);
    return entity;
  }

  public async update(id: string, data: Partial<PlatformSubscriptionEntity>): Promise<PlatformSubscriptionEntity | null> {
    for (const [dormId, sub] of this.subs.entries()) {
      if (sub.id === id) {
        const updated = { ...sub, ...data, updatedAt: new Date() };
        this.subs.set(dormId, updated);
        return updated;
      }
    }
    return null;
  }
}
