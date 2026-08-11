import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import {
  generatePromptPayPayload,
  maskPromptPayDisplay,
  generatePromptPayQrSvg,
  generatePromptPayQrPngBuffer
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
  let crc = 0xffff;
  for (let i = 0; i < body.length; i++) {
    let c = body.charCodeAt(i);
    crc ^= c << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  const calcCrc = crc.toString(16).toUpperCase().padStart(4, '0');
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

describe('PromptPay Standards Compliance & Independent QR Decoding Tests', () => {
  it('A. Mobile PromptPay (0812345678, 5300.00): EMV payload, PNG generation, and independent jsQR decode', async () => {
    const target = '0812345678';
    const amount = 5300.00;
    const expectedPayload = generatePromptPayPayload(target, amount);

    // 1. Generate PNG via qrcode library
    const pngBuffer = await generatePromptPayQrPngBuffer(target, amount);
    expect(pngBuffer).toBeInstanceOf(Buffer);

    // 2. Decode using independent decoder jsQR
    const decodedPayload = decodeQrPngBuffer(pngBuffer);
    expect(decodedPayload).toBe(expectedPayload);

    // 3. Parse EMV TLVs
    const tags = parseEmvTlv(decodedPayload);
    expect(tags['00']).toBe('01'); // Payload format indicator
    expect(tags['01']).toBe('11'); // Dynamic POI for amount-bearing bill QR
    expect(tags['29']).toContain('A000000677010111'); // PromptPay AID
    expect(tags['29']).toContain('0066812345678'); // MSISDN
    expect(tags['53']).toBe('764'); // THB
    expect(tags['54']).toBe('5300.00'); // Bill amount
    expect(tags['58']).toBe('TH'); // Country TH
    expect(verifyCrc16(decodedPayload)).toBe(true);
  });

  it('B. National ID PromptPay (13-digit fixture, 1500.50): PNG generation and independent jsQR decode', async () => {
    const target = '1234567890123';
    const amount = 1500.50;
    const expectedPayload = generatePromptPayPayload(target, amount);

    const pngBuffer = await generatePromptPayQrPngBuffer(target, amount);
    const decodedPayload = decodeQrPngBuffer(pngBuffer);
    expect(decodedPayload).toBe(expectedPayload);

    const tags = parseEmvTlv(decodedPayload);
    expect(tags['00']).toBe('01');
    expect(tags['01']).toBe('11');
    expect(tags['29']).toContain('A000000677010111');
    expect(tags['29']).toContain('02131234567890123'); // Tag 02 National ID
    expect(tags['53']).toBe('764');
    expect(tags['54']).toBe('1500.50');
    expect(tags['58']).toBe('TH');
    expect(verifyCrc16(decodedPayload)).toBe(true);
  });

  it('C. Representative Larger Amount (125000.75): PNG generation and independent jsQR decode', async () => {
    const target = '0812345678';
    const amount = 125000.75;
    const expectedPayload = generatePromptPayPayload(target, amount);

    const pngBuffer = await generatePromptPayQrPngBuffer(target, amount);
    const decodedPayload = decodeQrPngBuffer(pngBuffer);
    expect(decodedPayload).toBe(expectedPayload);

    const tags = parseEmvTlv(decodedPayload);
    expect(tags['54']).toBe('125000.75');
    expect(verifyCrc16(decodedPayload)).toBe(true);
  });

  it('D. Zero / No-amount payload (Static POI 12): PNG generation and independent jsQR decode', async () => {
    const target = '0812345678';
    const expectedPayload = generatePromptPayPayload(target, 0);

    const pngBuffer = await generatePromptPayQrPngBuffer(target, 0);
    const decodedPayload = decodeQrPngBuffer(pngBuffer);
    expect(decodedPayload).toBe(expectedPayload);

    const tags = parseEmvTlv(decodedPayload);
    expect(tags['01']).toBe('12'); // Static POI when no amount
    expect(tags['54']).toBeUndefined(); // Tag 54 absent
    expect(verifyCrc16(decodedPayload)).toBe(true);
  });

  it('E. SVG QR generation produces valid SVG', async () => {
    const svg = await generatePromptPayQrSvg('0812345678', 5300);
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
    expect(svg).not.toContain('promptpay.io');
  });

  it('F. Correctly masks promptPayDisplay', () => {
    expect(maskPromptPayDisplay('0812345678')).toBe('081-***-5678');
    expect(maskPromptPayDisplay('1234567890123')).toBe('x-xxxx-xxxxx-12-3');
  });
});
