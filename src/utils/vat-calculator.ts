/**
 * Frontend Authoritative Central Category-Strict VAT 7% Engine
 * Mirrors server/src/utils/monthly-utility-calculator.util.ts
 * Exact satangs / integer calculation without floating point drift.
 * @license Apache-2.0
 */

export interface VatSettings {
  enabled?: boolean | null;
  rate?: number | string | null;
  appliedCategories?: string[] | null;
}

export interface VatItemInput {
  type: string;
  amount: string | number;
  description?: string;
  metadata?: any;
  [key: string]: any;
}

export interface VatItemResult<T extends VatItemInput = VatItemInput> {
  item: T;
  type: string;
  baseAmount: string;
  isTaxable: boolean;
  vatRate: string;
  vatAmount: string;
  netAmount: string;
}

export interface VatCalculationResult<T extends VatItemInput = VatItemInput> {
  baseSubtotal: string;
  vatableSubtotal: string;
  nonVatableSubtotal: string;
  vatRate: string;
  vatAmount: string;
  netTotal: string;
  isVatActive: boolean;
  items: VatItemResult<T>[];
}

export function parseToSatangs(amountStr: string | number): bigint {
  const str = typeof amountStr === 'number' ? amountStr.toFixed(2) : String(amountStr || '0').trim();
  if (!str) return 0n;
  const isNegative = str.startsWith('-');
  const cleanStr = (isNegative ? str.slice(1) : str).replace(/,/g, '').replace(/\.-$/, '').replace(/฿/g, '').trim();
  if (!cleanStr) return 0n;
  const [intPart = '0', fracPart = ''] = cleanStr.split('.');
  const sanitizedFrac = fracPart.replace(/\D/g, '');
  const paddedFrac = (sanitizedFrac + '00').slice(0, 2);
  const sanitizedInt = intPart.replace(/\D/g, '') || '0';
  const val = BigInt(sanitizedInt) * 100n + BigInt(paddedFrac);
  return isNegative ? -val : val;
}

export function formatSatangs(satangs: bigint): string {
  const isNegative = satangs < 0n;
  const absVal = isNegative ? -satangs : satangs;
  const intPart = (absVal / 100n).toString();
  const fracPart = (absVal % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

export function isCategoryTaxable(
  itemType: string,
  vatSettings?: VatSettings | null
): boolean {
  if (!vatSettings || !vatSettings.enabled) return false;
  const applied = vatSettings.appliedCategories || (vatSettings as any).categories;
  if (!Array.isArray(applied) || applied.length === 0) return false;

  const normalizedType = itemType.toLowerCase().replace(/[-\s_]/g, '');
  return applied.some((cat) => {
    const normalizedCat = String(cat).toLowerCase().replace(/[-\s_]/g, '');
    if (normalizedCat === normalizedType) return true;
    if ((normalizedCat === 'rent' || normalizedCat === 'room') && (normalizedType === 'rent' || normalizedType === 'room' || normalizedType === 'roomrent')) return true;
    if (normalizedCat === 'commonfee' && (normalizedType === 'common' || normalizedType === 'commonfee')) return true;
    if (normalizedCat === 'internetfee' && (normalizedType === 'internet' || normalizedType === 'internetfee')) return true;
    if (normalizedCat === 'parking' && (normalizedType === 'parking' || normalizedType === 'parkingfee')) return true;
    if (normalizedCat === 'fine' && (normalizedType === 'fine' || normalizedType === 'latefee')) return true;
    if (normalizedCat === 'other' && (normalizedType === 'other' || normalizedType === 'custom' || normalizedType === 'otherfee')) return true;
    return false;
  });
}

export function calculateCategoryStrictVat<T extends VatItemInput = VatItemInput>(
  items: T[],
  vatSettings?: VatSettings | null,
  discountAmount?: string | number | null
): VatCalculationResult<T> {
  const isVatEnabled = Boolean(vatSettings?.enabled);
  const vatRateNum = typeof vatSettings?.rate === 'number' ? vatSettings.rate : (Number(vatSettings?.rate) || 7);
  const vatRateStr = vatRateNum.toFixed(2);
  const vatRateBigInt = BigInt(Math.round(vatRateNum * 100)); // 7.00% = 700n (basis points)

  let baseSubtotalSatangs = 0n;
  let vatableSubtotalSatangs = 0n;
  let nonVatableSubtotalSatangs = 0n;
  let totalVatSatangs = 0n;

  const itemResults: VatItemResult<T>[] = items.map((item) => {
    const baseSatangs = parseToSatangs(item.amount);
    baseSubtotalSatangs += baseSatangs;

    const taxable = isVatEnabled && isCategoryTaxable(item.type, vatSettings);
    let itemVatSatangs = 0n;

    if (taxable && baseSatangs > 0n) {
      vatableSubtotalSatangs += baseSatangs;
      itemVatSatangs = (baseSatangs * vatRateBigInt + 5000n) / 10000n;
      totalVatSatangs += itemVatSatangs;
    } else {
      nonVatableSubtotalSatangs += baseSatangs;
    }

    const netSatangs = baseSatangs + itemVatSatangs;

    return {
      item,
      type: item.type,
      baseAmount: formatSatangs(baseSatangs),
      isTaxable: taxable,
      vatRate: taxable ? vatRateStr : '0.00',
      vatAmount: formatSatangs(itemVatSatangs),
      netAmount: formatSatangs(netSatangs),
    };
  });

  const discountSatangs = discountAmount ? parseToSatangs(discountAmount) : 0n;
  const netTotalSatangs = baseSubtotalSatangs + totalVatSatangs - discountSatangs;
  const finalNetTotal = netTotalSatangs < 0n ? 0n : netTotalSatangs;

  return {
    baseSubtotal: formatSatangs(baseSubtotalSatangs),
    vatableSubtotal: formatSatangs(vatableSubtotalSatangs),
    nonVatableSubtotal: formatSatangs(nonVatableSubtotalSatangs),
    vatRate: isVatEnabled ? vatRateStr : '0.00',
    vatAmount: formatSatangs(totalVatSatangs),
    netTotal: formatSatangs(finalNetTotal),
    isVatActive: isVatEnabled && totalVatSatangs > 0n,
    items: itemResults,
  };
}

/**
 * Pure Satang Math Thai Baht Text Formatter.
 * Handles integer and satang components according to Royal Institute of Thailand conventions.
 * Examples:
 *   3270n -> "สามสิบสองบาทเจ็ดสิบสตางค์"
 *   2200n -> "ยี่สิบสองบาทถ้วน"
 *   100000000n -> "หนึ่งล้านบาทถ้วน"
 */
export function formatThaiBahtText(satangs: bigint): string {
  if (satangs === 0n) return 'ศูนย์บาทถ้วน';
  const isNeg = satangs < 0n;
  const absSatangs = isNeg ? -satangs : satangs;
  const baht = absSatangs / 100n;
  const sat = absSatangs % 100n;

  const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const POSITIONS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  function convertGroup(num: number): string {
    let result = '';
    const digits = String(num).split('').map(Number);
    const len = digits.length;
    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const pos = len - i - 1;
      if (d === 0) continue;
      if (pos === 0 && d === 1 && len > 1) {
        result += 'เอ็ด';
      } else if (pos === 1 && d === 1) {
        result += 'สิบ';
      } else if (pos === 1 && d === 2) {
        result += 'ยี่สิบ';
      } else {
        result += DIGITS[d] + POSITIONS[pos];
      }
    }
    return result;
  }

  function convertInteger(b: bigint): string {
    if (b === 0n) return '';
    let result = '';
    let remaining = b;
    let groupIndex = 0;
    while (remaining > 0n) {
      const groupVal = Number(remaining % 1000000n);
      remaining = remaining / 1000000n;
      if (groupVal > 0) {
        const groupText = convertGroup(groupVal);
        result = groupText + (groupIndex > 0 ? 'ล้าน' : '') + result;
      } else if (groupIndex > 0 && remaining > 0n) {
        result = 'ล้าน' + result;
      }
      groupIndex++;
    }
    return result;
  }

  let text = '';
  if (baht > 0n) {
    text += convertInteger(baht) + 'บาท';
  }
  if (sat > 0n) {
    text += convertGroup(Number(sat)) + 'สตางค์';
  } else {
    text += 'ถ้วน';
  }
  return (isNeg ? 'ลบ' : '') + text;
}
