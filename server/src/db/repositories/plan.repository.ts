import { v4 as uuidv4 } from 'uuid';

export interface PlatformPlanEntity {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string; // Decimal string
  currency: string;
  vatIncluded: boolean;
  roomLimit: number | null; // null for ENTERPRISE legacy if unconstrained, but now 150 for legacy paid
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
    code: 'PAID',
    name: 'Paid Plan',
    monthlyPrice: '189.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: true,
    displayOrder: 2,
  },
  // Legacy plans (retained for backward compatibility, marked inactive for new active plan list)
  {
    code: 'MICRO',
    name: 'Micro Plan (Legacy)',
    monthlyPrice: '189.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: false,
    displayOrder: 99,
  },
  {
    code: 'SMALL',
    name: 'Small Plan (Legacy)',
    monthlyPrice: '529.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: false,
    displayOrder: 100,
  },
  {
    code: 'MEDIUM',
    name: 'Medium Plan (Legacy)',
    monthlyPrice: '999.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: false,
    displayOrder: 101,
  },
  {
    code: 'LARGE',
    name: 'Large Plan (Legacy)',
    monthlyPrice: '1799.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: false,
    displayOrder: 102,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise Plan (Legacy)',
    monthlyPrice: '2999.00',
    currency: 'THB',
    vatIncluded: true,
    roomLimit: 150,
    messageQuotaMonthly: 300,
    isActive: false,
    displayOrder: 103,
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
      let id;
      if (item.code === 'FREE') id = '00000000-0000-0000-0000-000000000001';
      else if (item.code === 'PAID') id = '00000000-0000-0000-0000-000000000002';
      else if (item.code === 'MICRO') id = '00000000-0000-0000-0000-000000000003';
      else if (item.code === 'SMALL') id = '00000000-0000-0000-0000-000000000004';
      else if (item.code === 'MEDIUM') id = '00000000-0000-0000-0000-000000000005';
      else if (item.code === 'LARGE') id = '00000000-0000-0000-0000-000000000006';
      else if (item.code === 'ENTERPRISE') id = '00000000-0000-0000-0000-000000000007';
      else id = uuidv4();
      
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
