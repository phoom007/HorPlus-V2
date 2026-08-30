import { PrismaClient, Prisma } from '@prisma/client';

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
  commonFeeMode?: string;
  internetFee: string; // Decimal string
  internetFeeMode?: string;
  parkingRate?: string; // Decimal string
  parkingFeeMode?: string;
  gracePeriodDays?: number;
  advanceRentMonths?: number;
  lateFeeType: string;
  lateFeeValue: string; // Decimal string
  rentBillingType: string;
  cashAccepted?: boolean;
  promptPayType?: string | null;
  promptPayValue?: string | null;
  promptPayValueEncrypted?: string | null;
  promptPayAccountName?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountNumberEncrypted?: string | null;
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBillingSettingsData {
  id?: string;
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
  commonFeeMode?: string;
  internetFee?: string;
  internetFeeMode?: string;
  parkingRate?: string;
  parkingFeeMode?: string;
  gracePeriodDays?: number;
  advanceRentMonths?: number;
  lateFeeType?: string;
  lateFeeValue?: string;
  rentBillingType?: string;
  cashAccepted?: boolean;
  promptPayType?: string | null;
  promptPayValue?: string | null;
  promptPayValueEncrypted?: string | null;
  promptPayAccountName?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountNumberEncrypted?: string | null;
  version?: number;
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
      commonFeeMode: 'per_room',
      internetFee: '0.00',
      internetFeeMode: 'per_person',
      parkingRate: '0.00',
      parkingFeeMode: 'per_room',
      gracePeriodDays: 2,
      advanceRentMonths: 1,
      lateFeeType: 'fixed',
      lateFeeValue: '50.00',
      rentBillingType: 'monthly',
      cashAccepted: true,
      promptPayType: null,
      promptPayValue: null,
      promptPayValueEncrypted: null,
      promptPayAccountName: null,
      bankCode: null,
      bankAccountName: null,
      bankAccountNumber: null,
      bankAccountNumberEncrypted: null,
      version: 1,
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
      id: data.id || ('billset-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7)),
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
      commonFeeMode: data.commonFeeMode || 'per_room',
      internetFee: data.internetFee || '0.00',
      internetFeeMode: data.internetFeeMode || 'per_person',
      parkingRate: data.parkingRate || '0.00',
      parkingFeeMode: data.parkingFeeMode || 'per_room',
      gracePeriodDays: data.gracePeriodDays ?? 2,
      advanceRentMonths: data.advanceRentMonths ?? 1,
      lateFeeType: data.lateFeeType || 'fixed',
      lateFeeValue: data.lateFeeValue || '50.00',
      rentBillingType: data.rentBillingType || 'monthly',
      cashAccepted: data.cashAccepted ?? true,
      promptPayType: data.promptPayType ?? null,
      promptPayValue: data.promptPayValue ?? null,
      promptPayValueEncrypted: data.promptPayValueEncrypted ?? null,
      promptPayAccountName: data.promptPayAccountName ?? null,
      bankCode: data.bankCode ?? null,
      bankAccountName: data.bankAccountName ?? null,
      bankAccountNumber: data.bankAccountNumber ?? null,
      bankAccountNumberEncrypted: data.bankAccountNumberEncrypted ?? null,
      version: data.version ?? 1,
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

export class PrismaBillingSettingsRepository implements IBillingSettingsRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapToEntity(s: any): BillingSettingsEntity {
    const fmt = (val: any, dflt: string) =>
      val !== undefined && val !== null ? Number(val.toString()).toFixed(2) : dflt;
    const isNullTier = (t: any) =>
      t === null || t === undefined || t === Prisma.DbNull || t === Prisma.JsonNull;

    return {
      id: s.id,
      dormitoryId: s.dormitoryId,
      billingDay: s.billingDay,
      dueDay: s.dueDay,
      waterBillingType: s.waterBillingType,
      waterRate: fmt(s.waterRate, '0.00'),
      waterTierRates: isNullTier(s.waterTierRates) ? null : s.waterTierRates,
      electricityBillingType: s.electricityBillingType,
      electricityRate: fmt(s.electricityRate, '0.00'),
      electricityTierRates: isNullTier(s.electricityTierRates) ? null : s.electricityTierRates,
      commonFee: fmt(s.commonFee, '0.00'),
      commonFeeMode: s.commonFeeMode || 'per_room',
      internetFee: fmt(s.internetFee, '0.00'),
      internetFeeMode: s.internetFeeMode || 'per_person',
      parkingRate: fmt(s.parkingRate, '0.00'),
      parkingFeeMode: s.parkingFeeMode || 'per_room',
      gracePeriodDays: s.gracePeriodDays ?? 2,
      advanceRentMonths: s.advanceRentMonths ?? 1,
      lateFeeType: s.lateFeeType || 'none',
      lateFeeValue: fmt(s.lateFeeValue, '0.00'),
      rentBillingType: s.rentBillingType || 'monthly',
      cashAccepted: s.cashAccepted ?? true,
      promptPayType: s.promptPayType ?? null,
      promptPayValue: s.promptPayValue ?? null,
      promptPayValueEncrypted: s.promptPayValueEncrypted ?? null,
      promptPayAccountName: s.promptPayAccountName ?? null,
      bankCode: s.bankCode ?? null,
      bankAccountName: s.bankAccountName ?? null,
      bankAccountNumber: s.bankAccountNumber ?? null,
      bankAccountNumberEncrypted: s.bankAccountNumberEncrypted ?? null,
      version: s.version ?? 1,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  public async findByDormitoryId(dormitoryId: string): Promise<BillingSettingsEntity | null> {
    const isUuid = (str?: string | null) =>
      !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid(dormitoryId)) return null;

    const s = await this.prisma.dormitoryBillingSettings.findUnique({
      where: { dormitoryId },
    });
    return s ? this.mapToEntity(s) : null;
  }

  public async create(data: CreateBillingSettingsData): Promise<BillingSettingsEntity> {
    const s = await this.prisma.dormitoryBillingSettings.create({
      data: {
        id: data.id,
        dormitoryId: data.dormitoryId,
        billingDay: data.billingDay ?? 25,
        dueDay: data.dueDay ?? 5,
        waterBillingType: data.waterBillingType || 'per_person',
        waterRate: data.waterRate || '0.00',
        waterTierRates: data.waterTierRates !== undefined ? (data.waterTierRates === null ? Prisma.DbNull : data.waterTierRates) : undefined,
        electricityBillingType: data.electricityBillingType || 'per_unit',
        electricityRate: data.electricityRate || '0.00',
        electricityTierRates: data.electricityTierRates !== undefined ? (data.electricityTierRates === null ? Prisma.DbNull : data.electricityTierRates) : undefined,
        commonFee: data.commonFee || '0.00',
        commonFeeMode: data.commonFeeMode || 'per_room',
        internetFee: data.internetFee || '0.00',
        internetFeeMode: data.internetFeeMode || 'per_person',
        parkingRate: data.parkingRate || '0.00',
        parkingFeeMode: data.parkingFeeMode || 'per_room',
        gracePeriodDays: data.gracePeriodDays ?? 2,
        advanceRentMonths: data.advanceRentMonths ?? 1,
        lateFeeType: data.lateFeeType || 'none',
        lateFeeValue: data.lateFeeValue || '0.00',
        rentBillingType: data.rentBillingType || 'monthly',
        cashAccepted: data.cashAccepted ?? true,
        promptPayType: data.promptPayType ?? null,
        promptPayValue: data.promptPayValue ?? null,
        promptPayValueEncrypted: data.promptPayValueEncrypted ?? null,
        promptPayAccountName: data.promptPayAccountName ?? null,
        bankCode: data.bankCode ?? null,
        bankAccountName: data.bankAccountName ?? null,
        bankAccountNumber: data.bankAccountNumber ?? null,
        bankAccountNumberEncrypted: data.bankAccountNumberEncrypted ?? null,
      },
    });
    return this.mapToEntity(s);
  }

  public async update(
    dormitoryId: string,
    data: Partial<BillingSettingsEntity>
  ): Promise<BillingSettingsEntity | null> {
    const isUuid = (str?: string | null) =>
      !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (!isUuid(dormitoryId)) return null;

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (data.billingDay !== undefined) updateData.billingDay = data.billingDay;
    if (data.dueDay !== undefined) updateData.dueDay = data.dueDay;
    if (data.waterBillingType !== undefined) updateData.waterBillingType = data.waterBillingType;
    if (data.waterRate !== undefined) updateData.waterRate = data.waterRate;
    if (data.waterTierRates !== undefined) {
      updateData.waterTierRates = data.waterTierRates === null ? Prisma.DbNull : data.waterTierRates;
    }
    if (data.electricityBillingType !== undefined) updateData.electricityBillingType = data.electricityBillingType;
    if (data.electricityRate !== undefined) updateData.electricityRate = data.electricityRate;
    if (data.electricityTierRates !== undefined) {
      updateData.electricityTierRates = data.electricityTierRates === null ? Prisma.DbNull : data.electricityTierRates;
    }
    if (data.commonFee !== undefined) updateData.commonFee = data.commonFee;
    if (data.commonFeeMode !== undefined) updateData.commonFeeMode = data.commonFeeMode;
    if (data.internetFee !== undefined) updateData.internetFee = data.internetFee;
    if (data.internetFeeMode !== undefined) updateData.internetFeeMode = data.internetFeeMode;
    if (data.parkingRate !== undefined) updateData.parkingRate = data.parkingRate;
    if (data.parkingFeeMode !== undefined) updateData.parkingFeeMode = data.parkingFeeMode;
    if (data.gracePeriodDays !== undefined) updateData.gracePeriodDays = data.gracePeriodDays;
    if (data.advanceRentMonths !== undefined) updateData.advanceRentMonths = data.advanceRentMonths;
    if (data.lateFeeType !== undefined) updateData.lateFeeType = data.lateFeeType;
    if (data.lateFeeValue !== undefined) updateData.lateFeeValue = data.lateFeeValue;
    if (data.rentBillingType !== undefined) updateData.rentBillingType = data.rentBillingType;
    if (data.cashAccepted !== undefined) updateData.cashAccepted = data.cashAccepted;
    if (data.promptPayType !== undefined) updateData.promptPayType = data.promptPayType;
    if (data.promptPayValue !== undefined) updateData.promptPayValue = data.promptPayValue;
    if (data.promptPayValueEncrypted !== undefined) updateData.promptPayValueEncrypted = data.promptPayValueEncrypted;
    if (data.promptPayAccountName !== undefined) updateData.promptPayAccountName = data.promptPayAccountName;
    if (data.bankCode !== undefined) updateData.bankCode = data.bankCode;
    if (data.bankAccountName !== undefined) updateData.bankAccountName = data.bankAccountName;
    if (data.bankAccountNumber !== undefined) updateData.bankAccountNumber = data.bankAccountNumber;
    if (data.bankAccountNumberEncrypted !== undefined) updateData.bankAccountNumberEncrypted = data.bankAccountNumberEncrypted;

    try {
      const s = await this.prisma.dormitoryBillingSettings.update({
        where: { dormitoryId },
        data: updateData,
      });
      return this.mapToEntity(s);
    } catch {
      return null;
    }
  }
}
