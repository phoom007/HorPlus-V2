import { describe, it, expect } from 'vitest';
import { normalizeNumericInput } from '../utils/numericInput';

describe('normalizeNumericInput utility', () => {
  describe('Integer Normalization', () => {
    it('normalizes leading zeroes from integers', () => {
      expect(normalizeNumericInput('01')).toBe('1');
      expect(normalizeNumericInput('014000')).toBe('14000');
      expect(normalizeNumericInput('0005000')).toBe('5000');
      expect(normalizeNumericInput('000')).toBe('0');
      expect(normalizeNumericInput('0')).toBe('0');
    });

    it('handles empty and whitespace values', () => {
      expect(normalizeNumericInput('')).toBe('');
      expect(normalizeNumericInput('   ')).toBe('');
      expect(normalizeNumericInput(null)).toBe('');
      expect(normalizeNumericInput(undefined)).toBe('');
    });

    it('strips non-numeric characters in integer mode', () => {
      expect(normalizeNumericInput('100a')).toBe('100');
      expect(normalizeNumericInput('฿5,000')).toBe('5000');
      expect(normalizeNumericInput('00abc123')).toBe('123');
    });
  });

  describe('Decimal Normalization', () => {
    it('normalizes leading zeroes from decimal numbers', () => {
      expect(normalizeNumericInput('000.50', true)).toBe('0.50');
      expect(normalizeNumericInput('014000.25', true)).toBe('14000.25');
      expect(normalizeNumericInput('.5', true)).toBe('0.5');
      expect(normalizeNumericInput('0.', true)).toBe('0.');
      expect(normalizeNumericInput('00.', true)).toBe('0.');
      expect(normalizeNumericInput('000.00', true)).toBe('0.00');
      expect(normalizeNumericInput('7.00', true)).toBe('7.00');
      expect(normalizeNumericInput('018.5', true)).toBe('18.5');
    });

    it('prevents multiple decimal points', () => {
      expect(normalizeNumericInput('12.34.56', true)).toBe('12.3456');
    });
  });

  describe('Identifier Exclusions', () => {
    it('documents that identifier fields must not use normalizeNumericInput', () => {
      // Room number identifier "001" must remain intact without normalizer
      const rawRoomNumber = '001';
      expect(rawRoomNumber).toBe('001');

      // Phone number identifier "0812345678" must remain intact
      const rawPhone = '0812345678';
      expect(rawPhone).toBe('0812345678');

      // Referral code "012345" must remain intact
      const rawReferral = '012345';
      expect(rawReferral).toBe('012345');

      // LINE Channel ID "01657889900" must remain intact
      const rawChannelId = '01657889900';
      expect(rawChannelId).toBe('01657889900');
    });
  });
});
