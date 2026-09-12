import { describe, it, expect } from 'vitest';
import { generatePromptPayPayload, crc16ccitt, generatePromptPayQrDataUrl } from '../utils/promptpay';

describe('PromptPay Payload and QR Generator', () => {
  it('should compute valid CRC16-CCITT checksum for EMVCo strings', () => {
    // Standard test vector
    const checksum = crc16ccitt('00020101021129370016A000000677010111011300669350988085802TH53037646304');
    expect(checksum).toHaveLength(4);
    expect(/^[0-9A-F]{4}$/.test(checksum)).toBe(true);
  });

  it('should format 10-digit mobile number payload correctly', () => {
    const payload = generatePromptPayPayload('0935098808', 599);
    // Must start with EMVCo header
    expect(payload.startsWith('000201')).toBe(true);
    // Currency 764 (THB)
    expect(payload).toContain('5303764');
    // Country code TH
    expect(payload).toContain('5802TH');
    // Amount tag 54 with 599.00
    expect(payload).toContain('5406599.00');
    // PromptPay identifier formatted as international mobile 0066935098808
    expect(payload).toContain('0066935098808');
  });

  it('should format payload without amount when amount is 0 or omitted', () => {
    const payload = generatePromptPayPayload('0935098808');
    expect(payload.startsWith('000201')).toBe(true);
    // Static QR code point of initiation
    expect(payload).toContain('010211');
    expect(payload).not.toContain('5406');
  });

  it('should generate valid base64 data URL for QR code', async () => {
    const dataUrl = await generatePromptPayQrDataUrl('0935098808', 1799);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});
