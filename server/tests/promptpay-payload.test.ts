import { describe, it, expect } from 'vitest';
import { generatePromptPayPayload, maskPromptPayDisplay, generatePromptPayQrSvg } from '../src/services/promptpay-payload.service.js';

describe('PromptPay Payload & QR Service Unit Tests', () => {
  it('generates valid EMVCo payload for mobile phone (0812345678) with amount', () => {
    const payload = generatePromptPayPayload('0812345678', 5300.00);
    expect(payload).toContain('000201'); // Payload format indicator
    expect(payload).toContain('010211'); // Dynamic POI
    expect(payload).toContain('A000000677010111'); // PromptPay AID
    expect(payload).toContain('0066812345678'); // Formatted MSISDN
    expect(payload).toContain('5303764'); // THB
    expect(payload).toContain('54075300.00'); // Amount
    expect(payload).toContain('5802TH'); // Country TH
    expect(payload).toMatch(/6304[0-9A-F]{4}$/); // CRC16 checksum
  });

  it('generates valid EMVCo payload for 13-digit National ID', () => {
    const payload = generatePromptPayPayload('1234567890123', 1500.50);
    expect(payload).toContain('000201');
    expect(payload).toContain('A000000677010111');
    expect(payload).toContain('02131234567890123'); // Tag 02 National ID
    expect(payload).toContain('54071500.50');
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);
  });

  it('correctly masks promptPayDisplay for phone and national ID', () => {
    expect(maskPromptPayDisplay('0812345678')).toBe('081-***-5678');
    expect(maskPromptPayDisplay('1234567890123')).toBe('x-xxxx-xxxxx-12-3');
  });

  it('generates SVG QR code string cleanly', () => {
    const svg = generatePromptPayQrSvg('0812345678', 5300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox=');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('promptpay.io');
  });
});
