/**
 * PromptPay EMVCo Payload Generator & Server-Side QR Code Service
 * Standard: Thai QR Payment / PromptPay Merchant-Presented Standard
 * @license Apache-2.0
 */

import QRCode from 'qrcode';

export function crc16ccitt(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    crc ^= c << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function formatTlv(tag: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

/**
 * Format exact decimal money string without floating-point IEEE-754 precision issues
 * Rejects excess precision (>2 fractional digits) rather than silently truncating
 */
export function formatExactPromptPayAmount(amount?: number | string): { formattedAmount: string; isZero: boolean } {
  if (amount === undefined || amount === null || amount === '') {
    return { formattedAmount: '0.00', isZero: true };
  }

  const str = String(amount).trim();
  if (str === '0' || str === '0.0' || str === '0.00') {
    return { formattedAmount: '0.00', isZero: true };
  }

  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    throw new Error(`Invalid PromptPay amount format: "${str}". Must be a non-negative decimal with at most 2 decimal places.`);
  }

  const [whole, fraction = ''] = str.split('.');
  const wholeBigInt = BigInt(whole);
  const fracPadded = fraction.padEnd(2, '0');
  const minorUnits = wholeBigInt * 100n + BigInt(fracPadded);

  if (minorUnits === 0n) {
    return { formattedAmount: '0.00', isZero: true };
  }

  const minorWhole = minorUnits / 100n;
  const minorFrac = (minorUnits % 100n).toString().padStart(2, '0');
  const formatted = `${minorWhole}.${minorFrac}`;

  return { formattedAmount: formatted, isZero: false };
}

export function generatePromptPayPayload(target: string, amount?: number | string): string {
  const cleanTarget = (target || '').replace(/[^0-9]/g, '');

  let subTag = '';
  if (cleanTarget.length === 10 && cleanTarget.startsWith('0')) {
    // 10-digit Thai Mobile (MSISDN): Tag 01, format 0066 + 9 digits
    const msisdn = `0066${cleanTarget.slice(1)}`;
    subTag = formatTlv('01', msisdn);
  } else if (cleanTarget.length === 13) {
    // 13-digit National ID / Tax ID: Tag 02, format 13 digits
    subTag = formatTlv('02', cleanTarget);
  } else {
    throw new Error('Invalid PromptPay target number: Must be a 10-digit mobile number starting with 0 or a 13-digit National ID');
  }

  // Exact Money formatting
  const { formattedAmount, isZero } = formatExactPromptPayAmount(amount);

  // Merchant Account Info Tag 29
  const aid = formatTlv('00', 'A000000677010111');
  const merchantInfo = formatTlv('29', `${aid}${subTag}`);

  // Base TLVs
  const payloadFormat = formatTlv('00', '01');
  // EMV Merchant-Presented Specification:
  // Tag 01 = "12" for Dynamic QR (amount-bearing bill/transaction)
  // Tag 01 = "11" for Static QR (reusable / customer-entered amount)
  const poi = formatTlv('01', !isZero ? '12' : '11');
  const currency = formatTlv('53', '764');
  const country = formatTlv('58', 'TH');

  let amountTlv = '';
  if (!isZero) {
    amountTlv = formatTlv('54', formattedAmount);
  }

  const rawPayload = `${payloadFormat}${poi}${merchantInfo}${currency}${amountTlv}${country}6304`;
  const checksum = crc16ccitt(rawPayload);
  return `${rawPayload}${checksum}`;
}

export function maskPromptPayDisplay(target: string, type?: string | null): string {
  const clean = (target || '').replace(/[^0-9]/g, '');
  if (!clean) return '***';

  if (clean.length === 13) {
    // National ID e.g. 1-2345-67890-12-3 -> x-xxxx-xxxxx-12-3
    return `x-xxxx-xxxxx-${clean.slice(10, 12)}-${clean.slice(12)}`;
  }
  if (clean.length === 10) {
    // Phone e.g. 0812345678 -> 081-***-5678
    return `${clean.slice(0, 3)}-***-${clean.slice(6)}`;
  }
  if (clean.length > 4) {
    return `***${clean.slice(-4)}`;
  }
  return '***';
}

export async function generatePromptPayQrSvg(target: string, amount?: number | string, size = 256): Promise<string> {
  const payload = generatePromptPayPayload(target, amount);
  return QRCode.toString(payload, {
    type: 'svg',
    margin: 4,
    width: size,
    errorCorrectionLevel: 'M'
  });
}

export async function generatePromptPayQrPngBuffer(target: string, amount?: number | string, size = 256): Promise<Buffer> {
  const payload = generatePromptPayPayload(target, amount);
  return QRCode.toBuffer(payload, {
    type: 'png',
    margin: 4,
    width: size,
    errorCorrectionLevel: 'M'
  });
}
