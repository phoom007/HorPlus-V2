export interface BillingSettingsEntity {
  id: string;
  dormitoryId: string;
  billingDay: number;
  dueDay: number;
  waterBillingType: string;
  waterRate: string; // Decimal string
  waterTierRates?: any;
  electricityBillingType: string;
  electricityRate: string; // Decimal string
  electricityTierRates?: any;
  commonFee: string; // Decimal string
  internetFee: string; // Decimal string
  lateFeeType: string;
  lateFeeValue: string; // Decimal string
  rentBillingType: string;
  cashAccepted?: boolean;
  promptPayType?: string | null;
  promptPayValue?: string | null;
  promptPayValueEncrypted?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountNumberEncrypted?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBillingSettingsData {
  dormitoryId: string;
  billingDay?: number;
  dueDay?: number;
  waterBillingType?: string;
  waterRate?: string;
  waterTierRates?: any;
  electricityBillingType?: string;
  electricityRate?: string;
  electricityTierRates?: any;
  commonFee?: string;
  internetFee?: string;
  lateFeeType?: string;
  lateFeeValue?: string;
  rentBillingType?: string;
  cashAccepted?: boolean;
  promptPayType?: string | null;
  promptPayValue?: string | null;
  promptPayValueEncrypted?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountNumberEncrypted?: string | null;
}

export interface IBillingSettingsRepository {
  findByDormitoryId(dormitoryId: string): Promise<BillingSettingsEntity | null>;
  create(data: CreateBillingSettingsData): Promise<BillingSettingsEntity>;
  update(dormitoryId: string, data: Partial<BillingSettingsEntity>): Promise<BillingSettingsEntity | null>;
}

export class InMemoryBillingSettingsRepository implements IBillingSettingsRepository {
  private settings: Map<string, BillingSettingsEntity> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData(): void {
    this.settings.set('dorm-001', {
      id: 'bill-set-001',
      dormitoryId: 'dorm-001',
      billingDay: 25,
      dueDay: 5,
      waterBillingType: 'per_unit',
      waterRate: '18.00',
      electricityBillingType: 'per_unit',
      electricityRate: '7.00',
      commonFee: '0.00',
      internetFee: '0.00',
      lateFeeType: 'fixed',
      lateFeeValue: '50.00',
      rentBillingType: 'monthly',
      cashAccepted: true,
      promptPayType: null,
      promptPayValue: null,
      promptPayValueEncrypted: null,
      bankCode: null,
      bankAccountName: null,
      bankAccountNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public async findByDormitoryId(dormitoryId: string): Promise<BillingSettingsEntity | null> {
    return this.settings.get(dormitoryId) || null;
  }

  public async create(data: CreateBillingSettingsData): Promise<BillingSettingsEntity> {
    const now = new Date();
    const entity: BillingSettingsEntity = {
      id: `billset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      billingDay: data.billingDay ?? 25,
      dueDay: data.dueDay ?? 5,
      waterBillingType: data.waterBillingType || 'per_unit',
      waterRate: data.waterRate || '18.00',
      waterTierRates: data.waterTierRates ?? null,
      electricityBillingType: data.electricityBillingType || 'per_unit',
      electricityRate: data.electricityRate || '7.00',
      electricityTierRates: data.electricityTierRates ?? null,
      commonFee: data.commonFee || '0.00',
      internetFee: data.internetFee || '0.00',
      lateFeeType: data.lateFeeType || 'fixed',
      lateFeeValue: data.lateFeeValue || '50.00',
      rentBillingType: data.rentBillingType || 'monthly',
      cashAccepted: data.cashAccepted ?? true,
      promptPayType: data.promptPayType ?? null,
      promptPayValue: data.promptPayValue ?? null,
      promptPayValueEncrypted: data.promptPayValueEncrypted ?? null,
      bankCode: data.bankCode ?? null,
      bankAccountName: data.bankAccountName ?? null,
      bankAccountNumber: data.bankAccountNumber ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.settings.set(data.dormitoryId, entity);
    return entity;
  }

  public async update(dormitoryId: string, data: Partial<BillingSettingsEntity>): Promise<BillingSettingsEntity | null> {
    const current = this.settings.get(dormitoryId);
    if (!current) return null;
    const updated: BillingSettingsEntity = {
      ...current,
      ...data,
      updatedAt: new Date(),
    };
    this.settings.set(dormitoryId, updated);
    return updated;
  }
}
