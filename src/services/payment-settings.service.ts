/**
 * Payment Settings Shared API Client Service
 * Uses authoritative shared httpRequest client (handles CSRF, credentials, headers, error throwing).
 * @license Apache-2.0
 */

import { httpRequest } from '../data/httpClient';

export interface PaymentSettingsDTO {
  id: string;
  dormitoryId: string;
  cashAccepted: boolean;
  promptPayType: 'mobile_phone' | 'national_id' | null;
  maskedPromptPayValue: string | null;
  hasPromptPay: boolean;
  bankCode: string | null;
  bankAccountName: string | null;
  maskedBankAccountNumber: string | null;
  hasBankAccount: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSettingsUpdatePayload {
  cashAccepted?: boolean;
  promptPayType?: 'mobile_phone' | 'national_id' | null;
  promptPayValue?: string | null;
  bankCode?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
}

export async function getPaymentSettings(dormitoryId: string): Promise<PaymentSettingsDTO> {
  const res = await httpRequest<{ data: PaymentSettingsDTO }>('GET', `/dormitories/${dormitoryId}/payment-settings`, undefined, {
    dormitoryId,
  });
  return res.data;
}

export async function updatePaymentSettings(
  dormitoryId: string,
  payload: PaymentSettingsUpdatePayload
): Promise<PaymentSettingsDTO> {
  const res = await httpRequest<{ data: PaymentSettingsDTO }>('PATCH', `/dormitories/${dormitoryId}/payment-settings`, payload, {
    dormitoryId,
  });
  return res.data;
}
