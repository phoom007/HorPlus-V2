import { describe, it, expect } from 'vitest';
import { normalizeBankCode, getBankDisplayName, SUPPORTED_BANKS } from '../utils/bank-helper';

describe('Seam 3: Bank Helper & Bidirectional Normalizer Adapter', () => {
  it('SUPPORTED_BANKS contains the major Thai commercial and state banks with code and label', () => {
    expect(SUPPORTED_BANKS.length).toBeGreaterThanOrEqual(10);
    const scb = SUPPORTED_BANKS.find(b => b.code === 'SCB');
    expect(scb).toBeDefined();
    expect(scb?.label).toContain('ไทยพาณิชย์');
    expect(scb?.label).toContain('SCB');
  });

  it('normalizeBankCode normalizes Thai labels with parentheses to canonical uppercase short codes', () => {
    expect(normalizeBankCode('ไทยพาณิชย์ (SCB)')).toBe('SCB');
    expect(normalizeBankCode('กสิกรไทย (KBank)')).toBe('KBANK');
    expect(normalizeBankCode('กรุงเทพ (BBL)')).toBe('BBL');
    expect(normalizeBankCode('กรุงไทย (KTB)')).toBe('KTB');
    expect(normalizeBankCode('ทหารไทยธนชาต (ttb)')).toBe('TTB');
    expect(normalizeBankCode('กรุงศรีอยุธยา (BAY)')).toBe('BAY');
    expect(normalizeBankCode('ออมสิน (GSB)')).toBe('GSB');
  });

  it('normalizeBankCode preserves and standardizes already canonical short codes in any casing', () => {
    expect(normalizeBankCode('SCB')).toBe('SCB');
    expect(normalizeBankCode('scb')).toBe('SCB');
    expect(normalizeBankCode('kbank')).toBe('KBANK');
    expect(normalizeBankCode('KBANK')).toBe('KBANK');
    expect(normalizeBankCode('ttb')).toBe('TTB');
    expect(normalizeBankCode('TTB')).toBe('TTB');
    expect(normalizeBankCode('bbl')).toBe('BBL');
  });

  it('normalizeBankCode resolves plain Thai bank names without parenthesis', () => {
    expect(normalizeBankCode('ไทยพาณิชย์')).toBe('SCB');
    expect(normalizeBankCode('กสิกรไทย')).toBe('KBANK');
    expect(normalizeBankCode('กรุงไทย')).toBe('KTB');
    expect(normalizeBankCode('ออมสิน')).toBe('GSB');
  });

  it('normalizeBankCode safely handles null, undefined, empty, and unknown bank strings', () => {
    expect(normalizeBankCode(null)).toBe('');
    expect(normalizeBankCode(undefined)).toBe('');
    expect(normalizeBankCode('')).toBe('');
    expect(normalizeBankCode('   ')).toBe('');
    expect(normalizeBankCode('-- เลือกธนาคาร --')).toBe('');
    expect(normalizeBankCode('ธนาคารไม่รู้จัก')).toBe('');
  });

  it('getBankDisplayName returns Thai display name with code in parentheses', () => {
    expect(getBankDisplayName('SCB')).toBe('ไทยพาณิชย์ (SCB)');
    expect(getBankDisplayName('KBANK')).toBe('กสิกรไทย (KBank)');
    expect(getBankDisplayName('ไทยพาณิชย์ (SCB)')).toBe('ไทยพาณิชย์ (SCB)');
    expect(getBankDisplayName('')).toBe('');
    expect(getBankDisplayName(null)).toBe('');
  });
});
