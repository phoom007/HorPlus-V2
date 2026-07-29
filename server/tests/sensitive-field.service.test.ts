import { describe, it, expect } from 'vitest';
import { SensitiveFieldService } from '../src/services/sensitive-field.service.js';

describe('SensitiveFieldService', () => {
  const keyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const service = new SensitiveFieldService(keyHex, 1);

  it('should encrypt and decrypt plaintext using AES-256-GCM', () => {
    const plaintext = '0812345678';
    const enc = service.encrypt(plaintext);
    expect(enc.ciphertext).toBeDefined();
    expect(enc.ciphertext).toContain(':');
    expect(enc.keyVersion).toBe(1);

    const decrypted = service.decrypt(enc.ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it('should correctly mask PromptPay phone number', () => {
    const masked = service.maskPromptPay('mobile_phone', '0812345678');
    expect(masked).toBe('081-XXX-5678');
  });

  it('should correctly mask PromptPay citizen ID', () => {
    const masked = service.maskPromptPay('national_id', '1100200123456');
    expect(masked).toBe('1-1002-XXXXX-45-6');
  });

  it('should correctly mask Bank Account number', () => {
    const masked = service.maskBankAccount('1234567890');
    expect(masked).toBe('XXX-XXX-7890');
  });
});
