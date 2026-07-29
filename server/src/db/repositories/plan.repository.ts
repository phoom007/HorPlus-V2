export interface PlatformPlanEntity {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string; // Decimal string
  currency: string;
  vatIncluded: boolean;
  roomLimit: number | null; // null for ENTERPRISE
  messageQuotaMonthly: number;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPlanRepository {
  findAllActive(): Promise<PlatformPlanEntity[]>;
  findByCode(code: string): Promise<PlatformPlanEntity | null>;
  findById(id: string): Promise<PlatformPlanEntity | null>;
}

export const SYSTEM_PLANS_SEED: Omit<PlatformPlanEntity, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    code: 'FREE',
    name: 'Free Plan',
    monthlyPrice: '0.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 10,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 1,
  },
  {
    code: 'MICRO',
    name: 'Micro Plan',
    monthlyPrice: '189.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 25,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 2,
  },
  {
    code: 'SMALL',
    name: 'Small Plan',
    monthlyPrice: '529.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 50,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 3,
  },
  {
    code: 'MEDIUM',
    name: 'Medium Plan',
    monthlyPrice: '999.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 100,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 4,
  },
  {
    code: 'LARGE',
    name: 'Large Plan',
    monthlyPrice: '1799.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 200,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 5,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise Plan',
    monthlyPrice: '2999.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: null, // Unlimited
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 6,
  },
];

export class InMemoryPlanRepository implements IPlanRepository {
  private plans: Map<string, PlatformPlanEntity> = new Map();

  constructor() {
    this.seedData();
  }

  private seedData(): void {
    const now = new Date();
    SYSTEM_PLANS_SEED.forEach((item) => {
      const id = `plan-${item.code.toLowerCase()}`;
      this.plans.set(id, {
        ...item,
        id,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  public async findAllActive(): Promise<PlatformPlanEntity[]> {
    const list: PlatformPlanEntity[] = [];
    for (const plan of this.plans.values()) {
      if (plan.isActive) list.push(plan);
    }
    return list.sort((a, b) => a.displayOrder - b.displayOrder);
  }

  public async findByCode(code: string): Promise<PlatformPlanEntity | null> {
    const normalized = code.trim().toUpperCase();
    for (const plan of this.plans.values()) {
      if (plan.code.toUpperCase() === normalized) return plan;
    }
    return null;
  }

  public async findById(id: string): Promise<PlatformPlanEntity | null> {
    return this.plans.get(id) || null;
  }
}
