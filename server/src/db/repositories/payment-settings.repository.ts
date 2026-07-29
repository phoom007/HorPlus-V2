export interface PaymentSettingsEntity {
  id: string;
  dormitoryId: string;
  cashAccepted: boolean;
  promptPayType?: string | null;
  promptPayValueEncrypted?: string | null;
  promptPayValueMasked?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumberEncrypted?: string | null;
  bankAccountNumberMasked?: string | null;
  encryptionKeyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentSettingsData {
  dormitoryId: string;
  cashAccepted?: boolean;
  promptPayType?: string | null;
  promptPayValueEncrypted?: string | null;
  promptPayValueMasked?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumberEncrypted?: string | null;
  bankAccountNumberMasked?: string | null;
  encryptionKeyVersion?: number;
}

export interface IPaymentSettingsRepository {
  findByDormitoryId(dormitoryId: string): Promise<PaymentSettingsEntity | null>;
  create(data: CreatePaymentSettingsData): Promise<PaymentSettingsEntity>;
  update(dormitoryId: string, data: Partial<PaymentSettingsEntity>): Promise<PaymentSettingsEntity | null>;
}

export class InMemoryPaymentSettingsRepository implements IPaymentSettingsRepository {
  private settings: Map<string, PaymentSettingsEntity> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData(): void {
    this.settings.set('dorm-001', {
      id: 'pay-set-001',
      dormitoryId: 'dorm-001',
      cashAccepted: true,
      promptPayType: 'mobile_phone',
      promptPayValueEncrypted: 'mock-enc-0812345678',
      promptPayValueMasked: '081-XXX-5678',
      bankCode: 'KBANK',
      bankAccountName: 'บริษัท หอพฤกษ์ จำกัด',
      bankAccountNumberEncrypted: 'mock-enc-1234567890',
      bankAccountNumberMasked: 'XXX-XXX-7890',
      encryptionKeyVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public async findByDormitoryId(dormitoryId: string): Promise<PaymentSettingsEntity | null> {
    return this.settings.get(dormitoryId) || null;
  }

  public async create(data: CreatePaymentSettingsData): Promise<PaymentSettingsEntity> {
    const now = new Date();
    const entity: PaymentSettingsEntity = {
      id: `payset-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      cashAccepted: data.cashAccepted ?? true,
      promptPayType: data.promptPayType || null,
      promptPayValueEncrypted: data.promptPayValueEncrypted || null,
      promptPayValueMasked: data.promptPayValueMasked || null,
      bankCode: data.bankCode || null,
      bankAccountName: data.bankAccountName || null,
      bankAccountNumberEncrypted: data.bankAccountNumberEncrypted || null,
      bankAccountNumberMasked: data.bankAccountNumberMasked || null,
      encryptionKeyVersion: data.encryptionKeyVersion ?? 1,
      createdAt: now,
      updatedAt: now,
    };
    this.settings.set(data.dormitoryId, entity);
    return entity;
  }

  public async update(dormitoryId: string, data: Partial<PaymentSettingsEntity>): Promise<PaymentSettingsEntity | null> {
    const current = this.settings.get(dormitoryId);
    if (!current) return null;
    const updated: PaymentSettingsEntity = {
      ...current,
      ...data,
      updatedAt: new Date(),
    };
    this.settings.set(dormitoryId, updated);
    return updated;
  }
}
