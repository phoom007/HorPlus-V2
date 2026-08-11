/**
 * PromptPay EMVCo Payload Generator & Server-Side QR SVG Service
 * @license Apache-2.0
 */

function crc16ccitt(str: string): string {
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

export function generatePromptPayPayload(target: string, amount?: number | string): string {
  const cleanTarget = (target || '').replace(/[^0-9]/g, '');
  if (!cleanTarget) {
    throw new Error('Invalid PromptPay target number');
  }

  let subTag = '';
  if (cleanTarget.length === 10 && cleanTarget.startsWith('0')) {
    // Mobile Phone (MSISDN): Tag 01, format 0066 + 9 digits
    const msisdn = `0066${cleanTarget.slice(1)}`;
    subTag = formatTlv('01', msisdn);
  } else if (cleanTarget.length === 13) {
    // National ID / Tax ID: Tag 02, format 13 digits
    subTag = formatTlv('02', cleanTarget);
  } else if (cleanTarget.length === 15) {
    // E-Wallet: Tag 03, format 15 digits
    subTag = formatTlv('03', cleanTarget);
  } else {
    // Fallback: use Tag 02 for 13-digit or Tag 01 for mobile
    if (cleanTarget.length <= 10) {
      const msisdn = `0066${cleanTarget.padStart(10, '0').slice(1)}`;
      subTag = formatTlv('01', msisdn);
    } else {
      subTag = formatTlv('02', cleanTarget);
    }
  }

  // Merchant Account Info Tag 29
  const aid = formatTlv('00', 'A000000677010111');
  const merchantInfo = formatTlv('29', `${aid}${subTag}`);

  // Base TLVs
  const payloadFormat = formatTlv('00', '01');
  const numAmount = amount ? Number(amount) : 0;
  const poi = formatTlv('01', numAmount > 0 ? '11' : '12');
  const currency = formatTlv('53', '764');
  const country = formatTlv('58', 'TH');

  let amountTlv = '';
  if (numAmount > 0) {
    const formattedAmount = numAmount.toFixed(2);
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

// -------------------------------------------------------------------
// Pure TypeScript QR Code Generator (Reed-Solomon Byte Mode + SVG Output)
// -------------------------------------------------------------------

class QRCodeGenerator {
  private static GALOIS_EXP: number[] = new Array(512);
  private static GALOIS_LOG: number[] = new Array(256);

  private static initGalois() {
    if (this.GALOIS_EXP[0] === 1) return;
    let x = 1;
    for (let i = 0; i < 255; i++) {
      this.GALOIS_EXP[i] = x;
      this.GALOIS_LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      this.GALOIS_EXP[i] = this.GALOIS_EXP[i - 255];
    }
  }

  private static gfMul(x: number, y: number): number {
    if (x === 0 || y === 0) return 0;
    return this.GALOIS_EXP[this.GALOIS_LOG[x] + this.GALOIS_LOG[y]];
  }

  private static polyMul(p1: number[], p2: number[]): number[] {
    const result = new Array(p1.length + p2.length - 1).fill(0);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        result[i + j] ^= this.gfMul(p1[i], p2[j]);
      }
    }
    return result;
  }

  private static getGeneratorPoly(degree: number): number[] {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      poly = this.polyMul(poly, [1, this.GALOIS_EXP[i]]);
    }
    return poly;
  }

  private static calculateReedSolomon(data: number[], ecCount: number): number[] {
    this.initGalois();
    const genPoly = this.getGeneratorPoly(ecCount);
    const result = new Array(data.length + ecCount).fill(0);
    for (let i = 0; i < data.length; i++) {
      result[i] = data[i];
    }

    for (let i = 0; i < data.length; i++) {
      const coef = result[i];
      if (coef !== 0) {
        for (let j = 0; j < genPoly.length; j++) {
          result[i + j] ^= this.gfMul(genPoly[j], coef);
        }
      }
    }
    return result.slice(data.length);
  }

  public static generateSvg(text: string, size = 256): string {
    // Generate QR matrix version based on text length
    // For EMVCo payloads (~100 chars), Version 5 or 6 with Medium/Low EC works reliably.
    const utf8Bytes = Array.from(new TextEncoder().encode(text));
    
    // Choose QR Version: 1..10
    let version = 4;
    if (utf8Bytes.length > 120) version = 7;
    else if (utf8Bytes.length > 80) version = 6;
    else if (utf8Bytes.length > 50) version = 5;

    const moduleCount = 17 + version * 4;
    const grid: (boolean | null)[][] = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null));

    // Place Function Patterns (Finder, Alignment, Timing, Format)
    const placeFinder = (row: number, col: number) => {
      for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
          const mr = row + r;
          const mc = col + c;
          if (mr >= 0 && mr < moduleCount && mc >= 0 && mc < moduleCount) {
            if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
              const isBlack = (r === 0 || r === 6 || c === 0 || c === 6) || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
              grid[mr][mc] = isBlack;
            } else {
              grid[mr][mc] = false; // Separator
            }
          }
        }
      }
    };

    placeFinder(0, 0);
    placeFinder(0, moduleCount - 7);
    placeFinder(moduleCount - 7, 0);

    // Timing patterns
    for (let i = 8; i < moduleCount - 8; i++) {
      if (grid[6][i] === null) grid[6][i] = i % 2 === 0;
      if (grid[i][6] === null) grid[i][6] = i % 2 === 0;
    }

    // Alignment patterns for version >= 2
    if (version >= 2) {
      const alignPos = [6, moduleCount - 7];
      for (const r of alignPos) {
        for (const c of alignPos) {
          if (grid[r][c] !== null) continue;
          for (let ar = -2; ar <= 2; ar++) {
            for (let ac = -2; ac <= 2; ac++) {
              const isBlack = (Math.abs(ar) === 2 || Math.abs(ac) === 2) || (ar === 0 && ac === 0);
              grid[r + ar][c + ac] = isBlack;
            }
          }
        }
      }
    }

    // Dark module
    grid[4 * version + 9][8] = true;

    // Reserve format information area
    for (let i = 0; i < 9; i++) {
      if (grid[8][i] === null) grid[8][i] = false;
      if (grid[i][8] === null) grid[i][8] = false;
      if (grid[8][moduleCount - 1 - i] === null) grid[8][moduleCount - 1 - i] = false;
      if (grid[moduleCount - 1 - i][8] === null) grid[moduleCount - 1 - i][8] = false;
    }

    // Data capacities for Medium EC
    // Simple Byte-mode bitstream encoding
    const bitBuffer: number[] = [];
    const pushBits = (val: number, len: number) => {
      for (let i = len - 1; i >= 0; i--) {
        bitBuffer.push((val >> i) & 1);
      }
    };

    // Mode: Byte (0100)
    pushBits(0b0100, 4);
    // Count indicator (8 bits for V1..9)
    pushBits(utf8Bytes.length, 8);
    // Bytes
    for (const b of utf8Bytes) {
      pushBits(b, 8);
    }

    // Total data capacity for Version
    const dataCapacities = [0, 19, 34, 55, 80, 108, 136, 156, 194, 232, 274];
    const totalDataBytes = dataCapacities[version] || 108;
    const totalDataBits = totalDataBytes * 8;

    // Terminator & Padding
    while (bitBuffer.length < totalDataBits && bitBuffer.length % 8 !== 0) {
      bitBuffer.push(0);
    }
    const padBytes = [236, 17];
    let padIdx = 0;
    while (bitBuffer.length < totalDataBits) {
      pushBits(padBytes[padIdx % 2], 8);
      padIdx++;
    }

    // Convert bits to bytes
    const dataCodewords: number[] = [];
    for (let i = 0; i < bitBuffer.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) {
        b = (b << 1) | (bitBuffer[i + j] || 0);
      }
      dataCodewords.push(b);
    }

    // Calculate EC Codewords (Low/Medium EC)
    const ecCounts = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
    const ecCount = ecCounts[version] || 20;
    const ecCodewords = this.calculateReedSolomon(dataCodewords, ecCount);

    const finalCodewords = [...dataCodewords, ...ecCodewords];
    const finalBits: number[] = [];
    for (const cw of finalCodewords) {
      for (let i = 7; i >= 0; i--) {
        finalBits.push((cw >> i) & 1);
      }
    }

    // Fill Matrix in zigzag pattern
    let bitIdx = 0;
    let dir = -1;
    for (let col = moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--; // Skip vertical timing column
      const rows = dir === -1 ? Array.from({ length: moduleCount }, (_, i) => moduleCount - 1 - i) : Array.from({ length: moduleCount }, (_, i) => i);
      for (const r of rows) {
        for (const c of [col, col - 1]) {
          if (grid[r][c] === null) {
            const bit = bitIdx < finalBits.length ? finalBits[bitIdx++] === 1 : false;
            // Apply mask 0: (r + c) % 2 === 0
            const mask = (r + c) % 2 === 0;
            grid[r][c] = bit !== mask;
          }
        }
      }
      dir = -dir;
    }

    // Render SVG
    const padding = 4;
    const totalModules = moduleCount + padding * 2;
    const cellSize = size / totalModules;
    
    let pathD = '';
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (grid[r][c] === true) {
          const x = (c + padding) * cellSize;
          const y = (r + padding) * cellSize;
          pathD += `M${x.toFixed(2)},${y.toFixed(2)}h${cellSize.toFixed(2)}v${cellSize.toFixed(2)}h-${cellSize.toFixed(2)}z `;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="#ffffff"/>
      <path d="${pathD}" fill="#000000"/>
    </svg>`;
  }
}

export function generatePromptPayQrSvg(target: string, amount?: number | string, size = 256): string {
  const payload = generatePromptPayPayload(target, amount);
  return QRCodeGenerator.generateSvg(payload, size);
}
