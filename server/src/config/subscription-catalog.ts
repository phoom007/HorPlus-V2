/**
 * Versioned Package Catalog Source (Task-009 — Developer Catalog Source of Truth)
 * @license Apache-2.0
 */

export interface CatalogPackageDefinition {
  planCode: string;
  durationMonths: number;
  price: number | null;
  referencePrice?: number | null;
  currency: string;
  enabled: boolean;
}

export interface CatalogPlanDefinition {
  code: string;
  name: string;
  type: 'FREE' | 'PAID';
  roomLimit: number;
  messageQuotaMonthly: number;
  enabled: boolean;
}

export interface CatalogPromoCodeDefinition {
  code: string;
  normalizedCode: string;
  extensionDays: number;
  benefitType: string;
  benefitUnit: string;
  benefitValue: number;
  globalMaxRedemptions?: number | null;
  enabled: boolean;
  maximumRedemptionsPerDormitory: number;
}

export interface SubscriptionCatalogRelease {
  version: number;
  releaseDate: string;
  description: string;
  plans: CatalogPlanDefinition[];
  packages: CatalogPackageDefinition[];
  promoCodes?: CatalogPromoCodeDefinition[];
}

export const CANONICAL_SUBSCRIPTION_CATALOG: SubscriptionCatalogRelease = {
  version: 2,
  releaseDate: '2026-08-16',
  description: 'HorPlus Version 2 Canonical Product & Package Catalog (LOCAL-07 Master)',
  plans: [
    {
      code: 'FREE',
      name: 'HorPlus Free',
      type: 'FREE',
      roomLimit: 10,
      messageQuotaMonthly: 30,
      enabled: true,
    },
    {
      code: 'PAID',
      name: 'HorPlus PRO',
      type: 'PAID',
      roomLimit: 150,
      messageQuotaMonthly: 300,
      enabled: true,
    },
  ],
  packages: [
    {
      planCode: 'PAID',
      durationMonths: 1,
      price: 189,
      referencePrice: 990,
      currency: 'THB',
      enabled: true,
    },
    {
      planCode: 'PAID',
      durationMonths: 3,
      price: 529,
      referencePrice: 2990,
      currency: 'THB',
      enabled: true,
    },
    {
      planCode: 'PAID',
      durationMonths: 6,
      price: 999,
      referencePrice: 5990,
      currency: 'THB',
      enabled: true,
    },
    {
      planCode: 'PAID',
      durationMonths: 12,
      price: 1799,
      referencePrice: 10990,
      currency: 'THB',
      enabled: true,
    },
    {
      planCode: 'PAID',
      durationMonths: 24,
      price: 2999,
      referencePrice: 20000,
      currency: 'THB',
      enabled: true,
    },
  ],
  promoCodes: [
    {
      code: 'HORPLUS',
      normalizedCode: 'HORPLUS',
      extensionDays: 60,
      benefitType: 'TRIAL_EXTENSION',
      benefitUnit: 'MONTH',
      benefitValue: 2,
      globalMaxRedemptions: 100,
      enabled: true,
      maximumRedemptionsPerDormitory: 1,
    },
  ],
};
