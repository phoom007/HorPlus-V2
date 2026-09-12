/**
 * @license Apache-2.0
 * PromptPay EMVCo Payload & Client-Side QR Generator
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

export function generatePromptPayPayload(target: string, amount?: number): string {
  const cleanTarget = (target || '').replace(/[^0-9]/g, '');

  let subTag = '';
  if (cleanTarget.length === 10 && cleanTarget.startsWith('0')) {
    const msisdn = `0066${cleanTarget.slice(1)}`;
    subTag = formatTlv('01', msisdn);
  } else if (cleanTarget.length === 13) {
    subTag = formatTlv('02', cleanTarget);
  } else {
    // Default fallback
    const msisdn = `0066${cleanTarget.replace(/^0/, '')}`;
    subTag = formatTlv('01', msisdn);
  }

  const tag29Value = `0016A000000677010111${subTag}`;
  const tag29 = formatTlv('29', tag29Value);

  let raw = `0002010102${amount && amount > 0 ? '12' : '11'}${tag29}5303764`;

  if (amount && amount > 0) {
    const formattedAmount = amount.toFixed(2);
    raw += formatTlv('54', formattedAmount);
  }

  raw += '5802TH';
  const checkSumPayload = `${raw}6304`;
  const checksum = crc16ccitt(checkSumPayload);
  return `${checkSumPayload}${checksum}`;
}

export async function generatePromptPayQrDataUrl(promptPayId: string, amount: number): Promise<string> {
  const payload = generatePromptPayPayload(promptPayId, amount);
  return QRCode.toDataURL(payload, {
    margin: 2,
    width: 320,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  });
}
