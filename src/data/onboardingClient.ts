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
    genderPolicy?: string | null;
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
  };
  payment?: {
    cashAccepted?: boolean;
    promptPayType?: string | null;
    promptPayValue?: string | null;
    promptPayAccountName?: string | null;
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
    roomPrefix?: string | null;
    hasElevator?: boolean;
    numberingPattern?: string | null;
    formatPattern?: string | null;
    description?: string | null;
    monthlyRent?: number;
    dailyRent?: number;
    termRent?: number;
    termMonths?: number;
    maxInstallmentMonths?: number;
    maximumOccupants?: number;
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
  packageIntentId?: string;
  promoCode?: string;
  referralCode?: string;
  coinApplied?: number;
  marketingSource?: string;
  termsAccepted?: boolean;
  ownerSignatureUrl?: string;
  defaultTerms?: string;
  petPolicy?: any;
  rules?: any;
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

  async complete(payload: CompleteOnboardingPayload, idempotencyKey?: string): Promise<CompleteOnboardingResponse> {
    const ik = idempotencyKey || `finalize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return httpRequest<CompleteOnboardingResponse>(
      'POST',
      '/onboarding/finalize',
      { ...payload, idempotencyKey: ik },
      { idempotencyKey: ik }
    );
  },

  async finalize(payload: CompleteOnboardingPayload, idempotencyKey?: string): Promise<CompleteOnboardingResponse> {
    const ik = idempotencyKey || `finalize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return httpRequest<CompleteOnboardingResponse>(
      'POST',
      '/onboarding/finalize',
      { ...payload, idempotencyKey: ik },
      { idempotencyKey: ik }
    );
  },

  async uploadSignature(dormitoryId: string, dataUrlOrFormData: string | FormData) {
    let body: any;
    const headers: Record<string, string> = { 'X-Dormitory-Id': dormitoryId };

    if (typeof dataUrlOrFormData === 'string') {
      const fd = new FormData();
      // Convert base64 dataUrl to file blob if needed
      if (dataUrlOrFormData.startsWith('data:')) {
        const parts = dataUrlOrFormData.split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        const file = new File([u8arr], 'signature.png', { type: mime });
        fd.append('file', file);
        body = fd;
      } else {
        body = dataUrlOrFormData;
      }
    } else {
      body = dataUrlOrFormData;
    }

    return httpRequest<any>('POST', `/dormitories/${dormitoryId}/signatures`, body, { headers });
  },

  async getLineConfig(dormitoryId: string) {
    return httpRequest<any>('GET', `/dormitories/${dormitoryId}/line-oa`, undefined, {
      headers: { 'X-Dormitory-Id': dormitoryId },
    });
  },

  async updateLineConfig(dormitoryId: string, data: { channelId?: string; channelSecret?: string }) {
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
  },

  async getPublicCatalog() {
    return httpRequest<any>('GET', '/subscription/packages');
  },

  async getReferralMe() {
    return httpRequest<any>('GET', '/referral/me');
  },

  async validateReferral(code: string) {
    return httpRequest<any>('POST', '/referral/validate', { code });
  },

  async getCoinWallet() {
    return httpRequest<any>('GET', '/referral/wallet');
  },

  async getPackages() {
    return httpRequest<any>('GET', '/subscription/packages');
  },

  async getSubscriptionQuote(data: {
    packageId?: string;
    isFreePlan?: boolean;
    promoCode?: string;
    referralCode?: string;
    coinRequested?: number;
  }) {
    return httpRequest<any>('POST', '/subscription/quote', data);
  },

  async commitSubscriptionIntent(intentId: string, idempotencyKey?: string) {
    return httpRequest<any>('POST', '/subscription/commit', { intentId, idempotencyKey });
  }
};
