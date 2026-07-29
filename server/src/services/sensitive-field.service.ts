import crypto from 'crypto';

export class SensitiveFieldService {
  private key: Buffer;
  private keyVersion: number;

  constructor(encryptionKeyHexOrString: string, keyVersion: number = 1) {
    this.keyVersion = keyVersion;
    // Derive a 32-byte key from string using sha256 or slice
    if (Buffer.from(encryptionKeyHexOrString, 'hex').length === 32) {
      this.key = Buffer.from(encryptionKeyHexOrString, 'hex');
    } else {
      this.key = crypto.createHash('sha256').update(encryptionKeyHexOrString).digest();
    }
  }

  public encrypt(plaintext: string): { ciphertext: string; keyVersion: number } {
    if (!plaintext) {
      return { ciphertext: '', keyVersion: this.keyVersion };
    }
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:encrypted
    const ciphertext = `${iv.toString('hex')}:${authTag}:${encrypted}`;
    return { ciphertext, keyVersion: this.keyVersion };
  }

  public decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('INVALID_CIPHERTEXT_FORMAT');
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  public maskNationalId(value: string | undefined): string {
    return this.maskPromptPay('national_id', value);
  }

  public maskPromptPay(type: string | undefined, value: string | undefined): string {
    if (!value) return '';
    const clean = value.replace(/\D/g, '');
    if (type === 'mobile_phone' || clean.length === 10) {
      // e.g. 0812345678 -> 081-XXX-5678
      if (clean.length === 10) {
        return `${clean.substring(0, 3)}-XXX-${clean.substring(6)}`;
      }
    }
    if (type === 'national_id' || clean.length === 13) {
      // e.g. 1100200123456 -> 1-1002-XXXXX-45-6
      if (clean.length === 13) {
        return `${clean.substring(0, 1)}-${clean.substring(1, 5)}-XXXXX-${clean.substring(10, 12)}-${clean.substring(12)}`;
      }
    }
    if (type === 'e_wallet' || clean.length === 15) {
      return `${clean.substring(0, 3)}-XXXXX-${clean.substring(11)}`;
    }
    // General fallback
    if (value.length <= 4) return '****';
    return `${value.substring(0, 2)}***${value.substring(value.length - 2)}`;
  }

  public maskBankAccount(value: string | undefined): string {
    if (!value) return '';
    const clean = value.replace(/\D/g, '');
    if (clean.length >= 10) {
      // e.g. 1234567890 -> XXX-X-XX789-0 or XXX-XXX-7890
      const last4 = clean.substring(clean.length - 4);
      return `XXX-XXX-${last4}`;
    }
    if (value.length <= 4) return '****';
    return `***${value.substring(value.length - 4)}`;
  }
}
