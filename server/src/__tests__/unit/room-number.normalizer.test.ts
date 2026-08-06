import { describe, it, expect } from 'vitest';
import { normalizeRoomNumber, validateRoomNumberInput } from '../../utils/room-number.normalizer.js';

describe('normalizeRoomNumber', () => {
  it('handles basic room numbers', () => {
    expect(normalizeRoomNumber('101')).toBe('101');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeRoomNumber(' 101 ')).toBe('101');
    expect(normalizeRoomNumber('\t101\n')).toBe('101');
  });

  it('lowercases ASCII letters', () => {
    expect(normalizeRoomNumber('A101')).toBe('a101');
    expect(normalizeRoomNumber('a101')).toBe('a101');
    expect(normalizeRoomNumber('A101')).toBe(normalizeRoomNumber('a101'));
  });

  it('preserves hyphens and distinguishes hyphens from spaces', () => {
    expect(normalizeRoomNumber('B-201')).toBe('b-201');
    expect(normalizeRoomNumber('B 201')).toBe('b 201');
    expect(normalizeRoomNumber('B-201')).not.toBe(normalizeRoomNumber('B 201'));
  });

  it('preserves slashes', () => {
    expect(normalizeRoomNumber('1/1')).toBe('1/1');
    expect(normalizeRoomNumber('A/101')).toBe('a/101');
  });

  it('collapses multiple internal whitespaces', () => {
    expect(normalizeRoomNumber('B   201')).toBe('b 201');
    expect(normalizeRoomNumber('Building  A   101')).toBe('building a 101');
  });

  it('handles null and undefined safely', () => {
    expect(normalizeRoomNumber(null)).toBe('');
    expect(normalizeRoomNumber(undefined)).toBe('');
  });

  it('applies Unicode NFKC normalization', () => {
    // Fullwidth digits (101 in fullwidth: １０１)
    expect(normalizeRoomNumber('１０１')).toBe('101');
  });
});

describe('validateRoomNumberInput', () => {
  it('validates normal room number', () => {
    const res = validateRoomNumberInput('101');
    expect(res.isValid).toBe(true);
    expect(res.normalized).toBe('101');
  });

  it('rejects blank or whitespace-only room numbers with Thai error message', () => {
    const res1 = validateRoomNumberInput('');
    expect(res1.isValid).toBe(false);
    expect(res1.errorMessage).toBe('หมายเลขห้องพักต้องไม่เป็นค่าว่าง');

    const res2 = validateRoomNumberInput('   ');
    expect(res2.isValid).toBe(false);
    expect(res2.errorMessage).toBe('หมายเลขห้องพักต้องไม่เป็นค่าว่าง');

    const res3 = validateRoomNumberInput(null);
    expect(res3.isValid).toBe(false);
    expect(res3.errorMessage).toBe('หมายเลขห้องพักต้องไม่เป็นค่าว่าง');
  });

  it('rejects room numbers over 100 characters', () => {
    const longString = 'A'.repeat(101);
    const res = validateRoomNumberInput(longString);
    expect(res.isValid).toBe(false);
    expect(res.errorMessage).toBe('หมายเลขห้องพักต้องมีความยาวไม่เกิน 100 ตัวอักษร');
  });
});
