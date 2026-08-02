import { PrismaClient } from '@prisma/client';

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
      planId: '00000000-0000-0000-0000-000000000001',
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

export class PrismaSubscriptionRepository implements ISubscriptionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapToEntity(model: any): PlatformSubscriptionEntity {
    return {
      id: model.id,
      dormitoryId: model.dormitoryId,
      planId: model.planId,
      status: model.status as any,
      billingInterval: model.billingInterval,
      trialStartedAt: model.trialStartedAt,
      trialEndsAt: model.trialEndsAt,
      currentPeriodStartedAt: model.currentPeriodStartedAt,
      currentPeriodEndsAt: model.currentPeriodEndsAt,
      cancelAtPeriodEnd: model.cancelAtPeriodEnd,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  public async findByDormitoryId(dormitoryId: string): Promise<PlatformSubscriptionEntity | null> {
    const sub = await this.prisma.platformSubscription.findFirst({
      where: { dormitoryId },
      orderBy: { createdAt: 'desc' },
    });
    return sub ? this.mapToEntity(sub) : null;
  }

  public async create(data: CreateSubscriptionData): Promise<PlatformSubscriptionEntity> {
    const sub = await this.prisma.platformSubscription.create({
      data: {
        dormitoryId: data.dormitoryId,
        planId: data.planId,
        status: data.status || 'trialing',
        billingInterval: data.billingInterval || 'monthly',
        trialStartedAt: data.trialStartedAt,
        trialEndsAt: data.trialEndsAt,
        currentPeriodStartedAt: data.currentPeriodStartedAt,
        currentPeriodEndsAt: data.currentPeriodEndsAt,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
      },
    });
    return this.mapToEntity(sub);
  }

  public async update(id: string, data: Partial<PlatformSubscriptionEntity>): Promise<PlatformSubscriptionEntity | null> {
    const sub = await this.prisma.platformSubscription.update({
      where: { id },
      data: {
        ...(data.planId && { planId: data.planId }),
        ...(data.status && { status: data.status }),
        ...(data.billingInterval && { billingInterval: data.billingInterval }),
        ...(data.trialStartedAt !== undefined && { trialStartedAt: data.trialStartedAt }),
        ...(data.trialEndsAt !== undefined && { trialEndsAt: data.trialEndsAt }),
        ...(data.currentPeriodStartedAt !== undefined && { currentPeriodStartedAt: data.currentPeriodStartedAt }),
        ...(data.currentPeriodEndsAt !== undefined && { currentPeriodEndsAt: data.currentPeriodEndsAt }),
        ...(data.cancelAtPeriodEnd !== undefined && { cancelAtPeriodEnd: data.cancelAtPeriodEnd }),
      },
    });
    return sub ? this.mapToEntity(sub) : null;
  }
}
