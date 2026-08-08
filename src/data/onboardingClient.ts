/**
 * Authoritative Frontend Onboarding API Adapter (Task-009 / Wave 1F)
 * Uses shared httpRequest for authenticated session, CSRF, and idempotency.
 * @license Apache-2.0
 */

import { httpRequest } from './httpClient';

export interface CompleteOnboardingPayload {
  dormitory: {
    name: string;
    type?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    subdistrict?: string | null;
    district?: string | null;
    province?: string | null;
    postalCode?: string | null;
    phone?: string | null;
    email?: string | null;
    estimatedBuildingCount?: number;
    estimatedRoomCount?: number;
  };
  billing?: {
    billingDay?: number;
    dueDay?: number;
    waterBillingType?: string;
    waterRate?: string;
    electricityBillingType?: string;
    electricityRate?: string;
    commonFee?: string;
    internetFee?: string;
    lateFeeType?: string;
    lateFeeValue?: string;
    rentBillingType?: string;
  };
  payment?: {
    cashAccepted?: boolean;
    promptPayType?: string | null;
    promptPayValue?: string | null;
    bankCode?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
  };
  buildings?: {
    id: string;
    name: string;
    code?: string | null;
    floorsCount: number;
    roomsPerFloor?: number | null;
    numberingPattern?: string | null;
    description?: string | null;
  }[];
  rooms?: {
    buildingId?: string;
    roomNumber: string;
    floor: number;
    monthlyRent: number;
    depositAmount: number;
    parkingFee?: number;
    maximumOccupants?: number;
    initialWaterReading?: number;
    initialElectricityReading?: number;
    status?: string;
  }[];
  planCode: string;
  promoCode?: string;
}

export interface CompleteOnboardingResponse {
  data: {
    dormitory: {
      id: string;
      name: string;
      type?: string;
      status: string;
      createdAt: string;
    };
    membership: {
      id: string;
      dormitoryId: string;
      roleCode: string;
      status: string;
    };
    subscription: {
      id: string;
      planCode: string;
      planName: string;
      status: string;
    };
  };
}

export const onboardingClient = {
  async getStatus() {
    return httpRequest<any>('GET', '/api/v1/onboarding/status');
  },

  async getDraft() {
    return httpRequest<any>('GET', '/api/v1/onboarding/draft');
  },

  async saveDraft(currentStep: string, payload: Record<string, any>) {
    return httpRequest<any>('PUT', '/api/v1/onboarding/draft', { currentStep, payload });
  },

  async deleteDraft() {
    return httpRequest<any>('DELETE', '/api/v1/onboarding/draft');
  },

  async validatePromo(code: string, planCode?: string) {
    return httpRequest<any>('POST', '/api/v1/onboarding/promo/validate', { code, planCode });
  },

  async complete(payload: CompleteOnboardingPayload, idempotencyKey: string): Promise<CompleteOnboardingResponse> {
    return httpRequest<CompleteOnboardingResponse>(
      'POST',
      '/api/v1/onboarding/complete',
      { ...payload, idempotencyKey },
      { idempotencyKey }
    );
  }
};
