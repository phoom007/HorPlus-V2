/**
 * Billing Settings Shared API Client Service
 * Uses authoritative shared httpRequest client (handles CSRF, credentials, headers, error throwing).
 * @license Apache-2.0
 */

import { httpRequest } from '../data/httpClient';

export interface VatSettingsDTO {
  enabled: boolean;
  rate: number;
  appliedCategories: string[];
}

export interface BillingSettingsDTO {
  id: string;
  dormitoryId: string;
  billingDay?: number | null;
  dueDay: number;
  waterBillingType: string;
  waterRate: string;
  waterTierRates?: any[] | null;
  electricityBillingType: string;
  electricityRate: string;
  electricityTierRates?: any[] | null;
  commonFee: string;
  commonFeeMode?: string;
  internetFee: string;
  internetFeeMode?: string;
  parkingRate?: string;
  parkingFeeMode?: string;
  lateFeeType: string;
  lateFeeValue: string;
  rentBillingType: string;
  vatSettings?: VatSettingsDTO | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateBillingSettingsPayload {
  billingDay?: number;
  dueDay?: number;
  waterBillingType?: string;
  waterRate?: string | number;
  waterTierRates?: any[] | null;
  electricityBillingType?: string;
  electricityRate?: string | number;
  electricityTierRates?: any[] | null;
  commonFee?: string | number;
  commonFeeMode?: string;
  internetFee?: string | number;
  internetFeeMode?: string;
  parkingRate?: string | number;
  parkingFeeMode?: string;
  lateFeeType?: string;
  lateFeeValue?: string | number;
  rentBillingType?: string;
  vatSettings?: VatSettingsDTO | null;
}

export async function getBillingSettings(dormitoryId: string): Promise<BillingSettingsDTO> {
  const res = await httpRequest<{ data: BillingSettingsDTO }>('GET', `/dormitories/${dormitoryId}/billing-settings`, undefined, {
    dormitoryId,
  });
  return res.data;
}

export async function updateBillingSettings(
  dormitoryId: string,
  payload: UpdateBillingSettingsPayload
): Promise<BillingSettingsDTO> {
  const res = await httpRequest<{ data: BillingSettingsDTO }>('PATCH', `/dormitories/${dormitoryId}/billing-settings`, payload, {
    dormitoryId,
  });
  return res.data;
}
