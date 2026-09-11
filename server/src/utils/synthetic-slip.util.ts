import sharp from 'sharp';

export interface SyntheticSlipOptions {
  roomNumber?: string;
  amount?: string | number;
  claimedDate?: string;
  status?: string;
  title?: string;
  subtitle?: string;
}

/**
 * Generates a deterministic, visible synthetic PNG slip buffer for UAT/testing.
 * Guarantees width >= 400, height >= 200, crisp typography, and no external OS font dependencies.
 */
export async function generateSyntheticSlipPng(options?: SyntheticSlipOptions): Promise<Buffer> {
  const roomNumber = options?.roomNumber || 'ROOM 302';
  const rawAmount = options?.amount !== undefined ? Number(options.amount) : 6500;
  const amount = isNaN(rawAmount)
    ? 'THB 6,500.00'
    : `THB ${rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const claimedDate = options?.claimedDate || '2026-08-28 14:30';
  const status = options?.status || 'UNVERIFIED';
  const title = options?.title || 'LOCAL UAT TEST SLIP';
  const subtitle = options?.subtitle || 'NOT REAL';

  const svgText = `
<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="#ffffff" stroke="#1e293b" stroke-width="4"/>
  <rect x="20" y="20" width="560" height="60" fill="#f1f5f9" rx="8"/>
  <text x="300" y="45" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="#0f172a" text-anchor="middle">${title}</text>
  <text x="300" y="70" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#dc2626" text-anchor="middle">${subtitle}</text>
  
  <line x1="40" y1="100" x2="560" y2="100" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="6,6"/>
  
  <text x="60" y="145" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#1e293b">${roomNumber}</text>
  <text x="60" y="185" font-family="Arial, sans-serif" font-size="18" fill="#334155">AMOUNT: <tspan font-weight="bold" fill="#0f172a">${amount}</tspan></text>
  <text x="60" y="225" font-family="Arial, sans-serif" font-size="18" fill="#334155">CLAIMED: <tspan font-weight="bold">${claimedDate}</tspan></text>
  <text x="60" y="265" font-family="Arial, sans-serif" font-size="18" fill="#334155">STATUS: <tspan font-weight="bold" fill="#d97706">${status}</tspan></text>
  
  <rect x="40" y="305" width="520" height="55" fill="#fef2f2" stroke="#f87171" stroke-width="1.5" rx="6"/>
  <text x="300" y="338" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#991b1b" text-anchor="middle">SYNTHETIC UAT FIXTURE — STRICTLY NOT A REAL TRANSACTION</text>
</svg>
`;

  return await sharp(Buffer.from(svgText)).png().toBuffer();
}
