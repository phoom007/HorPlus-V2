/**
 * @license Apache-2.0
 * LINE ID Token Verification Service
 * Validates LIFF ID tokens against LINE OAuth2 /oauth2/v2.1/verify endpoint
 * per ADR-003:16 and docs/security/SECURITY-CONTRACTS.md:69-70
 */

import { getTenantLiffChannelId } from './line-oa.service.js';

export interface LineIdTokenVerificationResult {
  valid: boolean;
  lineUserId?: string;
  displayName?: string;
  pictureUrl?: string;
  email?: string;
  expiresAt?: Date;
  error?: string;
  rawPayload?: any;
}

export type LineTokenVerifierFn = (
  idToken: string,
  channelId?: string,
  nonce?: string
) => Promise<LineIdTokenVerificationResult>;

export class LineTokenService {
  private static mockVerifier: LineTokenVerifierFn | null = null;

  /**
   * Override verifier for automated unit testing
   */
  static setMockVerifier(verifier: LineTokenVerifierFn | null): void {
    LineTokenService.mockVerifier = verifier;
  }

  /**
   * Verify a LINE ID token issued by LIFF SDK
   */
  async verifyLineIdToken(options: {
    idToken: string;
    channelId?: string;
    nonce?: string;
  }): Promise<LineIdTokenVerificationResult> {
    const { idToken, channelId, nonce } = options;

    if (!idToken || typeof idToken !== 'string' || !idToken.trim()) {
      return {
        valid: false,
        error: 'MISSING_ID_TOKEN',
      };
    }

    const expectedChannelId = (channelId || getTenantLiffChannelId() || '').trim();

    // Use mock verifier if set (for vitest without network)
    if (LineTokenService.mockVerifier) {
      return LineTokenService.mockVerifier(idToken, expectedChannelId, nonce);
    }

    try {
      const bodyParams = new URLSearchParams();
      bodyParams.append('id_token', idToken.trim());
      if (expectedChannelId) {
        bodyParams.append('client_id', expectedChannelId);
      }
      if (nonce) {
        bodyParams.append('nonce', nonce);
      }

      const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
      });

      const data = (await response.json().catch(() => null)) as any;

      if (!response.ok || !data) {
        const errDetail = data?.error_description || data?.error || `HTTP_${response.status}`;
        return {
          valid: false,
          error: errDetail,
        };
      }

      // ADR-003:16 Security checks:
      // 1. Issuer check
      if (data.iss !== 'https://access.line.me') {
        return {
          valid: false,
          error: 'INVALID_ISSUER',
        };
      }

      // 2. Audience check (must match expected Channel ID if configured)
      if (expectedChannelId && data.aud !== expectedChannelId) {
        return {
          valid: false,
          error: 'AUDIENCE_MISMATCH',
        };
      }

      // 3. Expiration check
      const currentEpochSeconds = Math.floor(Date.now() / 1000);
      if (typeof data.exp === 'number' && data.exp <= currentEpochSeconds) {
        return {
          valid: false,
          error: 'TOKEN_EXPIRED',
        };
      }

      // 4. Nonce check if requested
      if (nonce && data.nonce !== nonce) {
        return {
          valid: false,
          error: 'NONCE_MISMATCH',
        };
      }

      if (!data.sub || typeof data.sub !== 'string') {
        return {
          valid: false,
          error: 'MISSING_SUBJECT_USER_ID',
        };
      }

      return {
        valid: true,
        lineUserId: data.sub,
        displayName: data.name,
        pictureUrl: data.picture,
        email: data.email,
        expiresAt: data.exp ? new Date(data.exp * 1000) : undefined,
        rawPayload: data,
      };
    } catch (err: any) {
      return {
        valid: false,
        error: `VERIFICATION_EXCEPTION: ${err.message || 'Unknown network error'}`,
      };
    }
  }
}

export const lineTokenService = new LineTokenService();
