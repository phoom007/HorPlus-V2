import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  generatePromptPayPayload,
  maskPromptPayDisplay,
  generatePromptPayQrSvg,
  generatePromptPayQrPngBuffer,
  crc16ccitt
} from '../src/services/promptpay-payload.service.js';

function parseEmvTlv(payload: string): Record<string, string> {
  const tags: Record<string, string> = {};
  let idx = 0;
  while (idx < payload.length) {
    const tag = payload.slice(idx, idx + 2);
    const lenStr = payload.slice(idx + 2, idx + 4);
    const len = parseInt(lenStr, 10);
    if (isNaN(len)) break;
    const value = payload.slice(idx + 4, idx + 4 + len);
    tags[tag] = value;
    idx += 4 + len;
  }
  return tags;
}

function verifyCrc16(payload: string): boolean {
  const body = payload.slice(0, -4);
  const expectedCrc = payload.slice(-4);
  const calcCrc = crc16ccitt(body);
  return calcCrc === expectedCrc;
}

function decodeQrPngBuffer(pngBuffer: Buffer): string {
  const png = PNG.sync.read(pngBuffer);
  const code = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!code) {
    throw new Error('Independent jsQR decoder failed to decode QR PNG image');
  }
  return code.data;
}

describe('PromptPay EMV Standards & Point of Initiation Semantics Tests', () => {
  it('1. GOLDEN VECTOR FIXTURE: Explicit independent TLV string matches production output and decoded QR', async () => {
    // Explicitly constructed Golden Vector for mobile 0812345678 and amount 5300.00
    // Tag 00: 000201
    // Tag 01: 010212 (Dynamic POI for amount-bearing bill QR)
    // Tag 29: 29370016A00000067701011101130066812345678 (PromptPay AID + MSISDN)
    // Tag 53: 5303764 (THB)
    // Tag 54: 54075300.00 (Amount)
    // Tag 58: 5802TH (Country TH)
    // Tag 63: 6304 + CRC
    const rawGoldenBody = '00020101021229370016A00000067701011101130066812345678530376454075300.005802TH6304';
    const goldenCrc = crc16ccitt(rawGoldenBody);
    const goldenPayload = `${rawGoldenBody}${goldenCrc}`;

    // A. Production payload matches Golden Vector exactly
    const prodPayload = generatePromptPayPayload('0812345678', 5300.00);
    expect(prodPayload).toBe(goldenPayload);

    // B. Independent jsQR decode from PNG buffer matches Golden Vector exactly
    const pngBuffer = await generatePromptPayQrPngBuffer('0812345678', 5300.00);
    const decodedPayload = decodeQrPngBuffer(pngBuffer);
    expect(decodedPayload).toBe(goldenPayload);

    // C. Verify CRC
    expect(verifyCrc16(decodedPayload)).toBe(true);
  });

  it('2. POI Semantics: Amount-bearing bill QR uses Tag 01 = "12" (Dynamic), No-amount uses Tag 01 = "11" (Static)', async () => {
    // A. Mobile + 5300.00 -> Tag 01 = "12"
    const mobilePayload = generatePromptPayPayload('0812345678', 5300.00);
    const mobileTags = parseEmvTlv(mobilePayload);
    expect(mobileTags['01']).toBe('12');
    expect(mobileTags['54']).toBe('5300.00');

    // B. National ID + 1500.50 -> Tag 01 = "12"
    const natIdPayload = generatePromptPayPayload('1234567890123', 1500.50);
    const natIdTags = parseEmvTlv(natIdPayload);
    expect(natIdTags['01']).toBe('12');
    expect(natIdTags['54']).toBe('1500.50');

    // C. Representative larger amount + 125000.75 -> Tag 01 = "12"
    const largePayload = generatePromptPayPayload('0812345678', 125000.75);
    const largeTags = parseEmvTlv(largePayload);
    expect(largeTags['01']).toBe('12');
    expect(largeTags['54']).toBe('125000.75');

    // D. Zero / No-amount payload -> Tag 01 = "11" (Static), Tag 54 absent
    const zeroPayload = generatePromptPayPayload('0812345678', 0);
    const zeroTags = parseEmvTlv(zeroPayload);
    expect(zeroTags['01']).toBe('11');
    expect(zeroTags['54']).toBeUndefined();
  });

  it('3. Strict Target Validation: Rejects invalid PromptPay target lengths and formats', () => {
    expect(() => generatePromptPayPayload('12345', 500)).toThrow('Invalid PromptPay target number');
    expect(() => generatePromptPayPayload('1812345678', 500)).toThrow('Invalid PromptPay target number');
    expect(() => generatePromptPayPayload('abcdefghij', 500)).toThrow('Invalid PromptPay target number');
  });

  it('4. Strict Amount Validation: Rejects NaN, negative, and infinite amounts', () => {
    expect(() => generatePromptPayPayload('0812345678', NaN)).toThrow('Invalid PromptPay amount');
    expect(() => generatePromptPayPayload('0812345678', -500)).toThrow('Invalid PromptPay amount');
    expect(() => generatePromptPayPayload('0812345678', Infinity)).toThrow('Invalid PromptPay amount');
  });

  it('5. SVG QR generation produces valid SVG output', async () => {
    const svg = await generatePromptPayQrSvg('0812345678', 5300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('promptpay.io');
  });

  it('6. Masking display helper formats mobile and National ID correctly', () => {
    expect(maskPromptPayDisplay('0812345678')).toBe('081-***-5678');
    expect(maskPromptPayDisplay('1234567890123')).toBe('x-xxxx-xxxxx-12-3');
  });
});
