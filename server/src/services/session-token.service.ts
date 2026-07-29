import crypto from 'crypto';

export interface SessionTokenPayload {
  sub: string;       // userId
  sid: string;       // sessionId
  type: 'session';
  iat: number;       // issued at timestamp (seconds)
  exp: number;       // expiration timestamp (seconds)
  jti: string;       // token unique identifier
  version: number;   // token version
}

export class SessionTokenService {
  private secretKey: Buffer;

  constructor(secretKeyHexOrString: string) {
    // Derive a 32-byte key using SHA-256 from the secret key string
    this.secretKey = crypto.createHash('sha256').update(secretKeyHexOrString).digest();
  }

  /**
   * Encrypt session payload into AES-256-GCM token string format: iv.ciphertext.authTag
   */
  public encryptToken(payload: Omit<SessionTokenPayload, 'iat' | 'exp' | 'jti'>, ttlSeconds: number): string {
    const nowSec = Math.floor(Date.now() / 1000);
    const fullPayload: SessionTokenPayload = {
      ...payload,
      iat: nowSec,
      exp: nowSec + ttlSeconds,
      jti: crypto.randomUUID(),
    };

    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.secretKey, iv);

    const jsonStr = JSON.stringify(fullPayload);
    const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${authTag.toString('base64url')}`;
  }

  /**
   * Decrypt AES-256-GCM token and validate payload claims & expiration.
   */
  public decryptToken(token: string): SessionTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [ivB64, encryptedB64, authTagB64] = parts;
      const iv = Buffer.from(ivB64, 'base64url');
      const encrypted = Buffer.from(encryptedB64, 'base64url');
      const authTag = Buffer.from(authTagB64, 'base64url');

      if (iv.length !== 12 || authTag.length !== 16) return null;

      const decipher = crypto.createDecipheriv('aes-256-gcm', this.secretKey, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      const payload: SessionTokenPayload = JSON.parse(decrypted.toString('utf8'));

      if (payload.type !== 'session' || !payload.sub || !payload.sid) {
        return null;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        return null; // Expired
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * Utility to hash sessionId before database lookup (SHA-256).
   */
  public static hashSessionId(sessionId: string): string {
    return crypto.createHash('sha256').update(`horplus_sid_${sessionId}`).digest('hex');
  }
}
