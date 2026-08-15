/**
 * TASK-009 Typed Frontend API Adapter
 * Handles Staff Management, LINE Friends, Access Grants, and LINE OA Settings
 * Calls authoritative backend endpoints with credentials: 'include' and automatic CSRF tokens.
 * @license Apache-2.0
 */

import { httpRequest, HttpClientError } from '../httpClient';

export interface StaffMember {
  id: string;
  type: 'PERMANENT_GOOGLE_OWNER' | 'ACCESS_GRANT';
  displayName: string;
  email?: string;
  pictureUrl?: string;
  roleCode: 'OWNER' | 'MANAGER' | 'TECH';
  roleName?: string;
  membershipOrigin?: string;
  label?: string;
  status?: string;
  version?: number;
  tokenPrefix?: string;
  createdAt?: string;
  lastDeliveryStatus?: string | null;
  lastDeliveryAttemptAt?: string | null;
  lastDeliverySuccessAt?: string | null;
  lastDeliveryErrorCode?: string | null;
  isPermanent: boolean;
  canRevoke: boolean;
  canChangeRole: boolean;
}

export interface LineFriend {
  id: string;
  displayName: string;
  pictureUrl?: string;
  friendStatus: string;
}

export interface SlotUsage {
  googleOwnersCount: number;
  activeGrantsCount: number;
  totalUsedSlots: number;
  maxSlots: number;
}

export interface StaffDataResponse {
  permanentOwners: StaffMember[];
  accessGrants: StaffMember[];
  slotUsage: SlotUsage;
}

export interface LineOaConfigResponse {
  connected: boolean;
  hasChannelSecret: boolean;
  hasAccessToken: boolean;
  lineOaId: string | null;
  channelId: string | null;
  accessTokenVerifiedAt: string | null;
  webhookVerifiedAt: string | null;
  webhookUrl: string | null;
}

export interface RedeemResult {
  sessionToken: string;
  grantId: string;
  dormitoryId: string;
  roleCode: string;
}

export const Task009ApiAdapter = {
  /**
   * Get Staff members and slot usage for a property (dormitory)
   */
  async getStaff(propertyId: string): Promise<{ success: boolean; data?: StaffDataResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('GET', `/properties/${propertyId}/staff`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Get LINE Friends for a property
   */
  async getLineFriends(propertyId: string): Promise<{ success: boolean; data?: LineFriend[]; error?: any }> {
    try {
      const res = await httpRequest<any>('GET', `/properties/${propertyId}/line-friends`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Create an Access Grant for a LINE Friend
   */
  async createAccessGrant(
    propertyId: string,
    lineFriendId: string,
    roleCode: 'OWNER' | 'MANAGER' | 'TECH'
  ): Promise<{ success: boolean; data?: { bearerUrl: string; grant: any; pushed?: boolean; deliveryStatus?: string }; error?: any }> {
    try {
      const res = await httpRequest<any>('POST', `/properties/${propertyId}/access-grants`, {
        lineFriendId,
        roleCode
      });
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Copy bearer link for an existing Access Grant
   */
  async getCopyLink(propertyId: string, grantId: string): Promise<{ success: boolean; data?: { bearerUrl: string; grantId: string }; error?: any }> {
    try {
      const res = await httpRequest<any>('GET', `/properties/${propertyId}/access-grants/${grantId}/copy-link`);
      const payload = res.data || res;
      const bearerUrl = payload.bearerUrl || payload.url || '';
      return { success: true, data: { bearerUrl, grantId } };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Change Role of an existing Access Grant
   */
  async updateAccessGrantRole(
    propertyId: string,
    grantId: string,
    roleCode: 'OWNER' | 'MANAGER' | 'TECH'
  ): Promise<{ success: boolean; data?: any; error?: any }> {
    try {
      const res = await httpRequest<any>('PATCH', `/properties/${propertyId}/access-grants/${grantId}/role`, {
        roleCode
      });
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Revoke an Access Grant
   */
  async revokeAccessGrant(propertyId: string, grantId: string): Promise<{ success: boolean; data?: any; error?: any }> {
    try {
      const res = await httpRequest<any>('DELETE', `/properties/${propertyId}/access-grants/${grantId}`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Retry delivery of an Access Grant push message
   */
  async retryDelivery(propertyId: string, grantId: string): Promise<{ success: boolean; data?: any; error?: any }> {
    try {
      const res = await httpRequest<any>('POST', `/properties/${propertyId}/access-grants/${grantId}/retry-delivery`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Read LINE OA Config for a dormitory
   */
  async getLineOaConfig(dormId: string): Promise<{ success: boolean; data?: LineOaConfigResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('GET', `/dormitories/${dormId}/line-oa/config`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Update LINE OA Config for a dormitory
   */
  async updateLineOaConfig(
    dormId: string,
    data: { lineOaId?: string; channelId?: string; channelSecret?: string; channelAccessToken?: string }
  ): Promise<{ success: boolean; data?: LineOaConfigResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('PUT', `/dormitories/${dormId}/line-oa/config`, data);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Rotate Webhook key for a dormitory
   */
  async rotateWebhookKey(dormId: string): Promise<{ success: boolean; data?: LineOaConfigResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('POST', `/dormitories/${dormId}/line-oa/rotate-webhook`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Test Webhook Endpoint for a dormitory
   */
  async testWebhookEndpoint(dormId: string): Promise<{ success: boolean; data?: LineOaConfigResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('POST', `/dormitories/${dormId}/line-oa/test-webhook`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Disconnect LINE OA for a dormitory
   */
  async disconnectLineOa(dormId: string): Promise<{ success: boolean; data?: LineOaConfigResponse; error?: any }> {
    try {
      const res = await httpRequest<any>('DELETE', `/dormitories/${dormId}/line-oa/disconnect`);
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  },

  /**
   * Redeem raw bearer token for staff access session
   */
  async redeemStaffAccess(token: string): Promise<{ success: boolean; data?: RedeemResult; error?: any }> {
    try {
      const res = await httpRequest<any>('POST', `/staff-access/redeem`, { token });
      return { success: true, data: res.data || res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
};
