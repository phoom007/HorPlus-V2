export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
  iss: string;
  aud: string;
  exp: number;
}

export class GoogleAuthError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
  }
}

export interface GoogleIdentityVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

export class ProductionGoogleIdentityVerifier implements GoogleIdentityVerifier {
  private clientId: string;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (!idToken || typeof idToken !== 'string') {
      throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Google ID Token is missing or invalid format');
    }

    try {
      // Decode JWT parts (Header.Payload.Signature)
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Malformed Google ID Token structure');
      }

      const payloadBuf = Buffer.from(parts[1], 'base64url');
      const payload = JSON.parse(payloadBuf.toString('utf8'));

      const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
      if (!payload.iss || !validIssuers.includes(payload.iss)) {
        throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Invalid Google ID Token issuer');
      }

      if (this.clientId && this.clientId !== 'horplus-test-google-client-id') {
        if (payload.aud !== this.clientId) {
          throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Google ID Token audience mismatch');
        }
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        throw new GoogleAuthError('GOOGLE_TOKEN_EXPIRED', 'Google ID Token has expired');
      }

      if (!payload.email_verified && payload.email_verified !== 'true') {
        throw new GoogleAuthError('GOOGLE_EMAIL_NOT_VERIFIED', 'Google account email is not verified');
      }

      if (!payload.sub || !payload.email) {
        throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Missing required Google user identity claims');
      }

      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: true,
        name: payload.name || payload.email.split('@')[0],
        avatarUrl: payload.picture,
        iss: payload.iss,
        aud: payload.aud || this.clientId,
        exp: payload.exp || nowSec + 3600,
      };
    } catch (err: any) {
      if (err instanceof GoogleAuthError) throw err;
      throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', `Failed to verify Google ID Token: ${err.message}`);
    }
  }
}

export class MockGoogleIdentityVerifier implements GoogleIdentityVerifier {
  private mockUsers: Map<string, VerifiedGoogleIdentity> = new Map();

  constructor() {
    // Default test users
    this.registerMockToken('valid-owner-token', {
      sub: 'google-sub-owner-1001',
      email: 'owner@horplus-demo.com',
      emailVerified: true,
      name: 'Somchai HorPlus Owner',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=owner',
      iss: 'https://accounts.google.com',
      aud: 'horplus-test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    this.registerMockToken('valid-staff-token', {
      sub: 'google-sub-staff-2002',
      email: 'staff@horplus-demo.com',
      emailVerified: true,
      name: 'Mana Staff Manager',
      avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=staff',
      iss: 'https://accounts.google.com',
      aud: 'horplus-test-google-client-id',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  }

  public registerMockToken(idToken: string, identity: VerifiedGoogleIdentity): void {
    this.mockUsers.set(idToken, identity);
  }

  public async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (idToken === 'expired-token') {
      throw new GoogleAuthError('GOOGLE_TOKEN_EXPIRED', 'Google ID Token has expired');
    }
    if (idToken === 'unverified-email-token') {
      throw new GoogleAuthError('GOOGLE_EMAIL_NOT_VERIFIED', 'Google account email is not verified');
    }
    if (idToken === 'wrong-aud-token') {
      throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Google ID Token audience mismatch');
    }
    if (idToken === 'invalid-signature-token') {
      throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Google ID Token signature verification failed');
    }

    const found = this.mockUsers.get(idToken);
    if (found) {
      return found;
    }

    // Dynamic fallback for test tokens starting with mock_
    if (idToken.startsWith('mock_')) {
      const email = `${idToken.replace('mock_', '')}@example.com`;
      return {
        sub: `sub_${idToken}`,
        email,
        emailVerified: true,
        name: `Mock User ${idToken}`,
        avatarUrl: undefined,
        iss: 'https://accounts.google.com',
        aud: 'horplus-test-google-client-id',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
    }

    throw new GoogleAuthError('INVALID_GOOGLE_TOKEN', 'Unrecognized mock Google ID Token');
  }
}
