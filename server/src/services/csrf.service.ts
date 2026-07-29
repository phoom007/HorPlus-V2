import crypto from 'crypto';

export class CsrfService {
  private signingKey: Buffer;

  constructor(signingKeyString: string) {
    this.signingKey = crypto.createHash('sha256').update(signingKeyString).digest();
  }

  /**
   * Generates signed CSRF token bound to a specific sessionId.
   */
  public generateCsrfToken(sessionId: string): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = this.sign(sessionId, nonce);
    return `${nonce}.${signature}`;
  }

  /**
   * Verifies that provided CSRF token matches signed signature for the sessionId using timing-safe comparison.
   */
  public verifyCsrfToken(token: string | undefined, sessionId: string): boolean {
    if (!token || typeof token !== 'string') return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [nonce, providedSignature] = parts;
    if (!nonce || !providedSignature) return false;

    const expectedSignature = this.sign(sessionId, nonce);

    try {
      const a = Buffer.from(providedSignature, 'utf8');
      const b = Buffer.from(expectedSignature, 'utf8');

      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private sign(sessionId: string, nonce: string): string {
    return crypto
      .createHmac('sha256', this.signingKey)
      .update(`${sessionId}.${nonce}`)
      .digest('hex');
  }
}
