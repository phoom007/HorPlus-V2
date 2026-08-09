/**
 * Versioned Package Catalog Source (Task-009 — Developer Catalog Source of Truth)
 * @license Apache-2.0
 */

export interface CatalogPackageDefinition {
  planCode: string;
  durationMonths: number;
  price: number | null;
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

export interface SubscriptionCatalogRelease {
  version: number;
  releaseDate: string;
  description: string;
  plans: CatalogPlanDefinition[];
  packages: CatalogPackageDefinition[];
}

export const CANONICAL_SUBSCRIPTION_CATALOG: SubscriptionCatalogRelease = {
  version: 1,
  releaseDate: '2026-08-09',
  description: 'HorPlus Version 1 Canonical Product & Package Catalog',
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
      currency: 'THB',
      enabled: true,
    },
    {
      planCode: 'PAID',
      durationMonths: 3,
      price: null,
      currency: 'THB',
      enabled: false,
    },
    {
      planCode: 'PAID',
      durationMonths: 6,
      price: null,
      currency: 'THB',
      enabled: false,
    },
    {
      planCode: 'PAID',
      durationMonths: 12,
      price: null,
      currency: 'THB',
      enabled: false,
    },
    {
      planCode: 'PAID',
      durationMonths: 24,
      price: null,
      currency: 'THB',
      enabled: false,
    },
  ],
};
