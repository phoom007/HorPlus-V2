/**
 * Authoritative Frontend Onboarding API Adapter (Task-009 / Wave 1F)
 * Uses shared httpRequest for authenticated session, CSRF, and idempotency.
 * @license Apache-2.0
 */

import { httpRequest } from './httpClient';

export interface CompleteOnboardingPayload {
  provisionalDormitoryId?: string;
  packageId?: string;
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
    return httpRequest<any>('GET', '/onboarding/status');
  },

  async getDraft() {
    return httpRequest<any>('GET', '/onboarding/draft');
  },

  async saveDraft(currentStep: string, payload: Record<string, any>, provisionalDormitoryId?: string) {
    return httpRequest<any>('PUT', '/onboarding/draft', { currentStep, payload, provisionalDormitoryId });
  },

  async deleteDraft() {
    return httpRequest<any>('DELETE', '/onboarding/draft');
  },

  async prepare(data: { name?: string; addressLine1?: string; province?: string }) {
    return httpRequest<any>('POST', '/onboarding/prepare', data);
  },

  async validatePromo(code: string, planCode?: string) {
    return httpRequest<any>('POST', '/onboarding/promo/validate', { code, planCode });
  },

  async complete(payload: CompleteOnboardingPayload, idempotencyKey: string): Promise<CompleteOnboardingResponse> {
    return httpRequest<CompleteOnboardingResponse>(
      'POST',
      '/onboarding/finalize',
      { ...payload, idempotencyKey },
      { idempotencyKey }
    );
  },

  async finalize(payload: CompleteOnboardingPayload, idempotencyKey: string): Promise<CompleteOnboardingResponse> {
    return httpRequest<CompleteOnboardingResponse>(
      'POST',
      '/onboarding/finalize',
      { ...payload, idempotencyKey },
      { idempotencyKey }
    );
  },

  async uploadSignature(dormitoryId: string, formData: FormData) {
    return httpRequest<any>('POST', `/dormitories/${dormitoryId}/signatures`, formData, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async getLineConfig(dormitoryId: string) {
    return httpRequest<any>('GET', `/dormitories/${dormitoryId}/line-oa`, undefined, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async updateLineConfig(dormitoryId: string, data: { channelId?: string; channelSecret?: string; lineOaId?: string }) {
    return httpRequest<any>('PUT', `/dormitories/${dormitoryId}/line-oa`, data, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async setLineWebhook(dormitoryId: string) {
    return httpRequest<any>('POST', `/dormitories/${dormitoryId}/line-oa/webhook/endpoint`, {}, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async testLineWebhook(dormitoryId: string) {
    return httpRequest<any>('POST', `/dormitories/${dormitoryId}/line-oa/webhook/test`, {}, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async getAvailablePackages() {
    return httpRequest<any>('GET', '/subscription/packages');
  }
};
