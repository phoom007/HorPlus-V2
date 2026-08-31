/**
 * @license Apache-2.0
 * Canonical Meter Live Billing Preview Calculator
 *
 * Exact Decimal / Satang Monetary Authority:
 * 1. ZERO floating-point operations. All financial amounts calculated in exact integer satangs (BigInt).
 * 2. Exact two-decimal canonical strings ("0.00", "3500.00", "4200.50").
 * 3. 100% Mathematical Parity with server BillingService.generateBillPreview & decimal-math.util.
 * 4. Meter reading and usage domain is whole integer units (0..99999). Rates and financial products preserve exact 2-decimal satang precision.
 */

export function isMeterBasedUtilityMode(mode?: string | null): boolean {
  if (!mode) return false;
  const m = String(mode).trim().toLowerCase();
  return m === 'per_unit' || m === 'unit' || m === 'tiered';
}

export interface CanonicalTierRecord {
  upTo: string | null;
  rate: string;
}

export interface CanonicalTierBreakdown {
  lowerExclusive: string;
  upperInclusive: string | null;
  billedUnits: string;
  rate: string;
  amount: string;
}

export interface ProgressiveTierResult {
  isValid: boolean;
  errorMessage?: string;
  totalAmountSatang: bigint;
  totalAmount: string;
  usageUnits: string;
  tierBreakdown: CanonicalTierBreakdown[];
}

export interface RateSnapshotContext {
  waterBillingType?: 'per_unit' | 'per_person' | 'fixed' | 'per_room' | 'room' | 'person' | 'tiered' | string;
  waterRate?: string | number;
  waterTierRates?: Array<CanonicalTierRecord> | null;
  electricityBillingType?: 'per_unit' | 'per_person' | 'fixed' | 'per_room' | 'room' | 'person' | 'tiered' | string;
  electricityRate?: string | number;
  electricityTierRates?: Array<CanonicalTierRecord> | null;
  commonFeeMode?: 'per_room' | 'per_person' | 'free' | 'room' | 'person' | 'none' | string;
  commonFee?: string | number;
  internetFeeMode?: 'per_room' | 'per_person' | 'free' | 'room' | 'person' | 'none' | string;
  internetFee?: string | number;
  parkingFeeMode?: 'per_room' | 'per_person' | 'per_vehicle' | 'free' | 'room' | 'person' | 'vehicle' | 'none' | string;
  parkingFee?: string | number;
}

export interface RoomPreviewContext {
  roomId: string;
  roomNumber?: string;
  tenantId?: string | null;
  tenantName?: string | null;
  billingSource: 'CONTRACT' | 'PROVISIONAL_MONTHLY' | 'PROVISIONAL_TERM' | 'DAILY_STAY' | 'NONE';
  rentAmount: string | number;
  rentDescription?: string;
  parkingQuantity?: string | number;
  snapshotVersion?: number;
  snapshotOtherFees?: Array<{ description: string; amount: string | number }>;
  snapshotManualOutstanding?: string | number;
  snapshotPeopleCount?: number | null;
  currentHouseholdPeopleCount?: number;
  dailyDepositAmount?: string | number;
  showDailyDepositLine?: boolean;
  isDailyDepositPaidInDisplayedPeriod?: boolean;
  dailyCheckOutDate?: string | null;
  historicalDailyCount?: number;
  checkInDate?: string | null;
  contractEndDate?: string | null;
}

export interface TransientRowDraft {
  waterCurr?: number | string;
  waterPrev?: number | string;
  elecCurr?: number | string;
  elecPrev?: number | string;
  peopleCount?: number;
  overdueAmount?: number | string;
  otherFees?: Array<{ description: string; amount: number | string }>;
}

export type MeterCalculationStatus = 'VALID' | 'NOT_READY' | 'INVALID';

export interface CalculatedMeterPreview {
  status: MeterCalculationStatus;
  isReady: boolean;
  isValid: boolean;
  errorMessage?: string;
  rentAmount: string;
  waterAmount: string;
  waterUsage: string;
  waterStatus: MeterCalculationStatus;
  waterTierBreakdown?: CanonicalTierBreakdown[];
  elecAmount: string;
  elecUsage: string;
  elecStatus: MeterCalculationStatus;
  elecTierBreakdown?: CanonicalTierBreakdown[];
  commonAmount: string;
  internetAmount: string;
  parkingAmount: string;
  otherFeesAmount: string;
  overdueAmount: string;
  totalAmount: string;
  formattedTotal: string;
}

export function validateCanonicalUtilityTiersLocal(input: unknown): {
  isValid: boolean;
  tiers: CanonicalTierRecord[];
  errorMessage?: string;
} {
  if (!Array.isArray(input)) {
    return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Tier configuration must be an array' };
  }
  if (input.length === 0 || input.length > 5) {
    return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Tiers count must be between 1 and 5' };
  }

  const normalizedTiers: CanonicalTierRecord[] = [];
  let prevUpToSatang = 0n;

  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object') {
      return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Malformed tier record' };
    }

    const isLast = i === input.length - 1;
    const rawRate = raw.rate;
    const rawUpTo = raw.upTo;

    if (rawRate === undefined || rawRate === null || String(rawRate).trim() === '') {
      return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Rate is required' };
    }

    const rateStr = String(rawRate).trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(rateStr)) {
      return { isValid: false, tiers: [], errorMessage: `INVALID_TIER_CONFIGURATION: Invalid rate '${rateStr}'` };
    }
    const rateSatang = parseSatang(rateStr);
    if (rateSatang < 0n) {
      return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Rate cannot be negative' };
    }

    let upToStr: string | null = null;
    if (isLast) {
      const isNullish = rawUpTo === null || rawUpTo === undefined || rawUpTo === '' || rawUpTo === 'null';
      if (!isNullish) {
        return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Final tier upTo must be null' };
      }
      upToStr = null;
    } else {
      if (rawUpTo === null || rawUpTo === undefined || rawUpTo === '' || rawUpTo === 'null') {
        return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: Intermediate tier upTo is required' };
      }
      const uStr = String(rawUpTo).trim();
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(uStr)) {
        return { isValid: false, tiers: [], errorMessage: `INVALID_TIER_CONFIGURATION: Invalid upTo '${uStr}'` };
      }
      const upToSatang = parseSatang(uStr);
      if (upToSatang <= 0n) {
        return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: upTo must be positive' };
      }
      if (upToSatang % 100n !== 0n) {
        return { isValid: false, tiers: [], errorMessage: `INVALID_TIER_CONFIGURATION: Tier at index ${i} upTo boundary '${uStr}' must represent a whole positive integer unit threshold (fractional boundaries are not permitted)` };
      }
      if (upToSatang <= prevUpToSatang) {
        return { isValid: false, tiers: [], errorMessage: 'INVALID_TIER_CONFIGURATION: upTo values must be strictly ascending' };
      }
      prevUpToSatang = upToSatang;
      upToStr = formatSatang(upToSatang);
    }

    normalizedTiers.push({
      upTo: upToStr,
      rate: formatSatang(rateSatang),
    });
  }

  return { isValid: true, tiers: normalizedTiers };
}

export function calculateProgressiveTieredChargeLocal(input: {
  usageUnits: number | string | bigint;
  tiers?: CanonicalTierRecord[] | null;
}): ProgressiveTierResult {
  const tierVal = validateCanonicalUtilityTiersLocal(input.tiers);
  if (!tierVal.isValid) {
    return {
      isValid: false,
      errorMessage: tierVal.errorMessage,
      totalAmountSatang: 0n,
      totalAmount: '0.00',
      usageUnits: '0.00',
      tierBreakdown: [],
    };
  }

  const rawUsage = input.usageUnits;
  let usageInt: bigint;
  if (typeof rawUsage === 'bigint') {
    if (rawUsage < 0n) {
      return {
        isValid: false,
        errorMessage: 'INVALID_USAGE: Usage cannot be negative',
        totalAmountSatang: 0n,
        totalAmount: '0.00',
        usageUnits: '0.00',
        tierBreakdown: [],
      };
    }
    usageInt = rawUsage;
  } else if (typeof rawUsage === 'number') {
    if (isNaN(rawUsage) || !Number.isFinite(rawUsage) || rawUsage < 0 || !Number.isInteger(rawUsage)) {
      return {
        isValid: false,
        errorMessage: 'INVALID_USAGE: Usage must be a whole non-negative integer unit',
        totalAmountSatang: 0n,
        totalAmount: '0.00',
        usageUnits: '0.00',
        tierBreakdown: [],
      };
    }
    usageInt = BigInt(rawUsage);
  } else if (typeof rawUsage === 'string') {
    const str = rawUsage.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(str)) {
      return {
        isValid: false,
        errorMessage: 'INVALID_USAGE: Usage must be a whole non-negative integer unit',
        totalAmountSatang: 0n,
        totalAmount: '0.00',
        usageUnits: '0.00',
        tierBreakdown: [],
      };
    }
    const scaled = parseScaled2(str);
    if (scaled < 0n || scaled % 100n !== 0n) {
      return {
        isValid: false,
        errorMessage: 'INVALID_USAGE: Usage must be a whole non-negative integer unit',
        totalAmountSatang: 0n,
        totalAmount: '0.00',
        usageUnits: '0.00',
        tierBreakdown: [],
      };
    }
    usageInt = scaled / 100n;
  } else {
    return {
      isValid: false,
      errorMessage: 'INVALID_USAGE: Usage must be a whole non-negative integer unit',
      totalAmountSatang: 0n,
      totalAmount: '0.00',
      usageUnits: '0.00',
      tierBreakdown: [],
    };
  }

  const usageUnitsStr = `${usageInt}.00`;
  if (usageInt === 0n) {
    return {
      isValid: true,
      totalAmountSatang: 0n,
      totalAmount: '0.00',
      usageUnits: '0.00',
      tierBreakdown: [],
    };
  }

  let remaining = usageInt;
  let prevBound = 0n;
  let totalSatang = 0n;
  const breakdown: CanonicalTierBreakdown[] = [];

  for (let i = 0; i < tierVal.tiers.length; i++) {
    if (remaining <= 0n) break;
    const tier = tierVal.tiers[i];
    const isLast = i === tierVal.tiers.length - 1;

    let billedUnits: bigint;
    let upperInclusiveStr: string | null = null;

    if (!isLast && tier.upTo !== null) {
      const upToSatang = parseSatang(tier.upTo);
      if (upToSatang % 100n !== 0n) {
        return {
          isValid: false,
          errorMessage: 'INVALID_TIER_CONFIGURATION: upTo must be a whole integer',
          totalAmountSatang: 0n,
          totalAmount: '0.00',
          usageUnits: '0.00',
          tierBreakdown: [],
        };
      }
      const upToUnits = upToSatang / 100n;
      upperInclusiveStr = `${upToUnits}.00`;
      const capacity = upToUnits - prevBound;
      billedUnits = remaining > capacity ? capacity : remaining;
    } else {
      upperInclusiveStr = null;
      billedUnits = remaining;
    }

    if (billedUnits > 0n) {
      const rateSatang = parseSatang(tier.rate);
      const billedUnitsStr = `${billedUnits}.00`;
      // Round-Half-Up per tier product to 2 DP
      const tierAmountSatang = multiplyMoneyByQuantity(rateSatang, billedUnitsStr);
      totalSatang += tierAmountSatang;

      breakdown.push({
        lowerExclusive: `${prevBound}.00`,
        upperInclusive: upperInclusiveStr,
        billedUnits: billedUnitsStr,
        rate: formatSatang(rateSatang),
        amount: formatSatang(tierAmountSatang),
      });

      remaining -= billedUnits;
    }

    if (!isLast && tier.upTo !== null) {
      const upToSatang = parseSatang(tier.upTo);
      prevBound = upToSatang / 100n;
    }
  }

  return {
    isValid: true,
    totalAmountSatang: totalSatang,
    totalAmount: formatSatang(totalSatang),
    usageUnits: usageUnitsStr,
    tierBreakdown: breakdown,
  };
}

/**
 * Exact scaled 2-decimal integer parser (scaled by 100).
 * Examples: "100.25" -> 10025n, "105.75" -> 10575n, "3500.50" -> 350050n, "-10.00" -> -1000n.
 */
export function parseScaled2(val: string | number | null | undefined): bigint {
  if (val === null || val === undefined || val === '') return 0n;
  const str = String(val).trim();
  if (!str || str === '0' || str === '0.0' || str === '0.00') return 0n;
  const isNegative = str.startsWith('-');
  const clean = isNegative ? str.slice(1) : str;
  const [intPart = '0', fracPart = ''] = clean.split('.');
  const cleanInt = intPart.replace(/\D/g, '') || '0';
  const cleanFrac = (fracPart.replace(/\D/g, '') + '00').slice(0, 2);
  const scaled = BigInt(cleanInt) * 100n + BigInt(cleanFrac);
  return isNegative ? -scaled : scaled;
}

/**
 * Formats a scaled 2-decimal BigInt into a canonical string ("5.50", "100.25", "3500.00").
 */
export function formatScaled2(scaled: bigint): string {
  const isNegative = scaled < 0n;
  const abs = isNegative ? -scaled : scaled;
  const intPart = abs / 100n;
  const fracPart = (abs % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/**
 * Subtracts previous reading from current reading, ensuring non-negative (>= 0).
 */
export function subtractScaled2(curr: string | number | null | undefined, prev: string | number | null | undefined): bigint {
  const c = parseScaled2(curr);
  const p = parseScaled2(prev);
  const diff = c - p;
  return diff > 0n ? diff : 0n;
}

/**
 * Multiplies money rate (in satang, scaled 100) by a decimal quantity (scaled 100) with Round-Half-Up.
 * Examples: 1800n (18.00 ฿) * "5.50" -> 9900n (99.00 ฿)
 */
export function multiplyMoneyByQuantity(satangRate: bigint, quantity: string | number | null | undefined): bigint {
  if (satangRate === 0n || quantity === null || quantity === undefined || quantity === '' || quantity === 0) {
    return 0n;
  }
  const qScaled = parseScaled2(quantity);
  // satangRate * (qScaled / 100) -> (satangRate * qScaled) / 100 with round-half-up
  const product = satangRate * qScaled;
  const quotient = product / 100n;
  const remainder = product % 100n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder >= 50n) {
    return quotient + (product > 0n ? 1n : -1n);
  }
  return quotient;
}

// Aliases for monetary semantics
export const parseSatang = parseScaled2;
export const formatSatang = formatScaled2;
export const multiplySatangByQuantity = multiplyMoneyByQuantity;

/**
 * Formats a canonical two-decimal string into Thai display format with commas.
 * Example: "3500.00" -> "3,500.00"
 */
export function formatMoneyDisplay(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0.00';
  const decimalStr = typeof val === 'number' ? (Number.isInteger(val) ? `${val}.00` : val.toFixed(2)) : String(val);
  const [intPart = '0', fracPart = '00'] = decimalStr.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${formattedInt}.${(fracPart + '00').slice(0, 2)}`;
}

/**
 * Formats a meter reading or unit value for clean display without trailing .00 for integers.
 * Example: "500.00" -> "500", 500 -> "500", "500.50" -> "500.5", 105.75 -> "105.75"
 */
export function formatMeterReadingDisplay(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '';
  if (Number.isInteger(num)) {
    return num.toString();
  }
  const str = num.toFixed(2);
  return str.replace(/\.00$/, '').replace(/(\.[0-9]*[1-9])0+$/, '$1');
}

/**
 * Formats an integer count value for display.
 * Example: 2 -> "2", "2.00" -> "2", 0 -> "0"
 */
export function formatCountDisplay(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0';
  const num = typeof val === 'number' ? val : parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(num) ? '0' : Math.max(0, num).toString();
}

/**
 * Pure, Decimal-safe Live Meter Row Preview Calculator matching BillingService.generateBillPreview.
 */
export function calculateMeterRowPreview(
  roomCtx: RoomPreviewContext | undefined,
  rates: RateSnapshotContext | undefined,
  draft: TransientRowDraft
): CalculatedMeterPreview {
  const rentSatang = parseSatang(roomCtx?.rentAmount);
  const peopleCount = Math.max(0, draft.peopleCount ?? roomCtx?.currentHouseholdPeopleCount ?? roomCtx?.snapshotPeopleCount ?? 0);
  const peopleCountStr = peopleCount.toString();

  const rawWaterPrev = draft.waterPrev !== undefined && draft.waterPrev !== null ? String(draft.waterPrev).trim() : '';
  const rawWaterCurr = draft.waterCurr !== undefined && draft.waterCurr !== null ? String(draft.waterCurr).trim() : '';

  const rawElecPrev = draft.elecPrev !== undefined && draft.elecPrev !== null ? String(draft.elecPrev).trim() : '';
  const rawElecCurr = draft.elecCurr !== undefined && draft.elecCurr !== null ? String(draft.elecCurr).trim() : '';

  // 1. Water Calculation
  const rawWaterMode = rates?.waterBillingType as string | undefined;
  const waterRateSatang = parseSatang(rates?.waterRate);
  let waterUsageScaled = 0n;
  let waterAmountSatang = 0n;
  let waterStatus: MeterCalculationStatus = 'VALID';
  let waterTierBreakdown: CanonicalTierBreakdown[] | undefined = undefined;

  if (!rates || !rawWaterMode) {
    // Rates not loaded / not ready -> NOT_READY (no default assumption)
    waterStatus = 'NOT_READY';
    waterUsageScaled = 0n;
    waterAmountSatang = 0n;
  } else if (rawWaterMode === 'per_person' || rawWaterMode === 'person') {
    waterStatus = 'VALID';
    waterAmountSatang = multiplyMoneyByQuantity(waterRateSatang, peopleCountStr);
    waterUsageScaled = parseScaled2(peopleCountStr);
  } else if (rawWaterMode === 'fixed' || rawWaterMode === 'room' || rawWaterMode === 'per_room') {
    waterStatus = 'VALID';
    waterAmountSatang = waterRateSatang;
    waterUsageScaled = 100n; // 1.00 room
  } else if (rawWaterMode === 'free' || rawWaterMode === 'none') {
    waterStatus = 'VALID';
    waterAmountSatang = 0n;
    waterUsageScaled = 0n;
  } else if (rawWaterMode === 'per_unit' || rawWaterMode === 'unit') {
    waterStatus = 'VALID';
    // per_unit: calculate usage units with 4/5-digit rollover support
    if (rawWaterPrev !== '' && rawWaterCurr !== '') {
      const usageRes = calculateMeterUsageUnits(rawWaterPrev, rawWaterCurr);
      if (usageRes.isValid) {
        waterUsageScaled = BigInt(usageRes.usageUnits) * 100n;
      } else {
        const prevScaled = parseScaled2(rawWaterPrev);
        const currScaled = parseScaled2(rawWaterCurr);
        if (currScaled >= prevScaled) {
          waterUsageScaled = currScaled - prevScaled;
        }
      }
      if (waterUsageScaled > 0n) {
        const usageStr = formatScaled2(waterUsageScaled);
        waterAmountSatang = multiplyMoneyByQuantity(waterRateSatang, usageStr);
      }
    }
  } else if (rawWaterMode === 'tiered') {
    if (rawWaterPrev === '' || rawWaterCurr === '') {
      waterStatus = 'NOT_READY';
      waterUsageScaled = 0n;
      waterAmountSatang = 0n;
    } else {
      const usageRes = calculateMeterUsageUnits(rawWaterPrev, rawWaterCurr);
      if (!usageRes.isValid) {
        waterStatus = 'INVALID';
        waterUsageScaled = 0n;
        waterAmountSatang = 0n;
      } else {
        const progRes = calculateProgressiveTieredChargeLocal({
          usageUnits: usageRes.usageUnits,
          tiers: rates.waterTierRates,
        });
        if (!progRes.isValid) {
          waterStatus = 'INVALID';
          waterUsageScaled = 0n;
          waterAmountSatang = 0n;
        } else {
          waterStatus = 'VALID';
          waterUsageScaled = BigInt(usageRes.usageUnits) * 100n;
          waterAmountSatang = progRes.totalAmountSatang;
          waterTierBreakdown = progRes.tierBreakdown;
        }
      }
    }
  } else {
    // Unsupported/unknown present mode -> INVALID (fail closed, never assume per_unit)
    waterStatus = 'INVALID';
    waterUsageScaled = 0n;
    waterAmountSatang = 0n;
  }

  // 2. Electricity Calculation
  const rawElecMode = rates?.electricityBillingType as string | undefined;
  const elecRateSatang = parseSatang(rates?.electricityRate);
  let elecUsageScaled = 0n;
  let elecAmountSatang = 0n;
  let elecStatus: MeterCalculationStatus = 'VALID';
  let elecTierBreakdown: CanonicalTierBreakdown[] | undefined = undefined;

  if (!rates || !rawElecMode) {
    // Rates not loaded / not ready -> NOT_READY (no default assumption)
    elecStatus = 'NOT_READY';
    elecUsageScaled = 0n;
    elecAmountSatang = 0n;
  } else if (rawElecMode === 'per_person' || rawElecMode === 'person') {
    elecStatus = 'VALID';
    elecAmountSatang = multiplyMoneyByQuantity(elecRateSatang, peopleCountStr);
    elecUsageScaled = parseScaled2(peopleCountStr);
  } else if (rawElecMode === 'fixed' || rawElecMode === 'room' || rawElecMode === 'per_room') {
    elecStatus = 'VALID';
    elecAmountSatang = elecRateSatang;
    elecUsageScaled = 100n; // 1.00 room
  } else if (rawElecMode === 'free' || rawElecMode === 'none') {
    elecStatus = 'VALID';
    elecAmountSatang = 0n;
    elecUsageScaled = 0n;
  } else if (rawElecMode === 'per_unit' || rawElecMode === 'unit') {
    elecStatus = 'VALID';
    // per_unit: calculate usage units with 4/5-digit rollover support
    if (rawElecPrev !== '' && rawElecCurr !== '') {
      const usageRes = calculateMeterUsageUnits(rawElecPrev, rawElecCurr);
      if (usageRes.isValid) {
        elecUsageScaled = BigInt(usageRes.usageUnits) * 100n;
      } else {
        const prevScaled = parseScaled2(rawElecPrev);
        const currScaled = parseScaled2(rawElecCurr);
        if (currScaled >= prevScaled) {
          elecUsageScaled = currScaled - prevScaled;
        }
      }
      if (elecUsageScaled > 0n) {
        const usageStr = formatScaled2(elecUsageScaled);
        elecAmountSatang = multiplyMoneyByQuantity(elecRateSatang, usageStr);
      }
    }
  } else if (rawElecMode === 'tiered') {
    if (rawElecPrev === '' || rawElecCurr === '') {
      elecStatus = 'NOT_READY';
      elecUsageScaled = 0n;
      elecAmountSatang = 0n;
    } else {
      const usageRes = calculateMeterUsageUnits(rawElecPrev, rawElecCurr);
      if (!usageRes.isValid) {
        elecStatus = 'INVALID';
        elecUsageScaled = 0n;
        elecAmountSatang = 0n;
      } else {
        const progRes = calculateProgressiveTieredChargeLocal({
          usageUnits: usageRes.usageUnits,
          tiers: rates.electricityTierRates,
        });
        if (!progRes.isValid) {
          elecStatus = 'INVALID';
          elecUsageScaled = 0n;
          elecAmountSatang = 0n;
        } else {
          elecStatus = 'VALID';
          elecUsageScaled = BigInt(usageRes.usageUnits) * 100n;
          elecAmountSatang = progRes.totalAmountSatang;
          elecTierBreakdown = progRes.tierBreakdown;
        }
      }
    }
  } else {
    // Unsupported/unknown present mode -> INVALID (fail closed, never assume per_unit)
    elecStatus = 'INVALID';
    elecUsageScaled = 0n;
    elecAmountSatang = 0n;
  }

  // 3. Common Fee Calculation
  const commonMode = rates?.commonFeeMode || 'per_room';
  const commonFeeSatang = parseSatang(rates?.commonFee);
  let commonAmountSatang = 0n;

  if (commonMode === 'free' || commonMode === 'none') {
    commonAmountSatang = 0n;
  } else if (commonMode === 'per_person' || commonMode === 'person') {
    commonAmountSatang = multiplyMoneyByQuantity(commonFeeSatang, peopleCountStr);
  } else {
    commonAmountSatang = commonFeeSatang;
  }

  // 4. Internet Fee Calculation
  const internetMode = rates?.internetFeeMode || 'per_room';
  const internetFeeSatang = parseSatang(rates?.internetFee);
  let internetAmountSatang = 0n;

  if (internetMode === 'free' || internetMode === 'none') {
    internetAmountSatang = 0n;
  } else if (internetMode === 'per_person' || internetMode === 'person') {
    internetAmountSatang = multiplyMoneyByQuantity(internetFeeSatang, peopleCountStr);
  } else {
    internetAmountSatang = internetFeeSatang;
  }

  // 5. Parking Fee Calculation
  const parkingMode = rates?.parkingFeeMode || 'per_room';
  const parkingFeeSatang = parseSatang(rates?.parkingFee);
  let parkingAmountSatang = 0n;

  if (parkingMode === 'free' || parkingMode === 'none') {
    parkingAmountSatang = 0n;
  } else if (parkingMode === 'per_person' || parkingMode === 'person') {
    parkingAmountSatang = multiplyMoneyByQuantity(parkingFeeSatang, peopleCountStr);
  } else if (parkingMode === 'per_vehicle' || parkingMode === 'vehicle') {
    const rawQty = roomCtx?.parkingQuantity;
    const qty = rawQty === 'per_person' ? peopleCountStr : (rawQty ?? '1.00');
    parkingAmountSatang = multiplyMoneyByQuantity(parkingFeeSatang, qty);
  } else {
    parkingAmountSatang = parkingFeeSatang;
  }

  // 6. Other Fees Calculation (direct sum of satangs)
  let otherFeesSatang = 0n;
  for (const f of draft.otherFees || []) {
    otherFeesSatang += parseSatang(f.amount);
  }

  // 7. Overdue Amount Calculation
  const overdueSatang = parseSatang(draft.overdueAmount);

  // Overall Status Derivation
  let overallStatus: MeterCalculationStatus = 'VALID';
  let isReady = true;
  let isValid = true;
  let errorMessage: string | undefined = undefined;

  if (waterStatus === 'INVALID' || elecStatus === 'INVALID') {
    overallStatus = 'INVALID';
    isValid = false;
    isReady = true;
    errorMessage = 'รูปแบบการคิดค่าบริการไม่ถูกต้อง (Invalid billing mode)';
  } else if (waterStatus === 'NOT_READY' || elecStatus === 'NOT_READY' || !rates) {
    overallStatus = 'NOT_READY';
    isReady = false;
    isValid = false;
  }

  // 8. Special Financial Rule for DAILY_STAY:
  // Meter readings for electricity/water are recorded for history/record purposes only,
  // but MUST NOT be added to the Daily amount due or total.
  // The Daily total contains strictly: rentAmount + (deposit still due in the displayed period).
  if (roomCtx?.billingSource === 'DAILY_STAY') {
    const depositDueSatang = (roomCtx.showDailyDepositLine && !roomCtx.isDailyDepositPaidInDisplayedPeriod)
      ? parseSatang(roomCtx.dailyDepositAmount)
      : 0n;
    const totalDailySatang = rentSatang + depositDueSatang;
    const totalStr = formatSatang(totalDailySatang);

    return {
      status: overallStatus,
      isReady,
      isValid,
      errorMessage,
      rentAmount: formatSatang(rentSatang),
      waterAmount: '0.00',
      waterUsage: formatScaled2(waterUsageScaled),
      waterStatus,
      waterTierBreakdown,
      elecAmount: '0.00',
      elecUsage: formatScaled2(elecUsageScaled),
      elecStatus,
      elecTierBreakdown,
      commonAmount: '0.00',
      internetAmount: '0.00',
      parkingAmount: '0.00',
      otherFeesAmount: '0.00',
      overdueAmount: '0.00',
      totalAmount: totalStr,
      formattedTotal: formatMoneyDisplay(totalStr),
    };
  }

  // 9. Standard Monthly Utility Total Amount (Monthly Utility never absorbs rent; rent is independent)
  const totalSatang =
    waterAmountSatang +
    elecAmountSatang +
    commonAmountSatang +
    internetAmountSatang +
    parkingAmountSatang +
    otherFeesSatang +
    overdueSatang;

  const totalStr = formatSatang(totalSatang);

  return {
    status: overallStatus,
    isReady,
    isValid,
    errorMessage,
    rentAmount: formatSatang(rentSatang),
    waterAmount: waterStatus === 'INVALID' ? 'INVALID' : formatSatang(waterAmountSatang),
    waterUsage: formatScaled2(waterUsageScaled),
    waterStatus,
    waterTierBreakdown,
    elecAmount: elecStatus === 'INVALID' ? 'INVALID' : formatSatang(elecAmountSatang),
    elecUsage: formatScaled2(elecUsageScaled),
    elecStatus,
    elecTierBreakdown,
    commonAmount: formatSatang(commonAmountSatang),
    internetAmount: formatSatang(internetAmountSatang),
    parkingAmount: formatSatang(parkingAmountSatang),
    otherFeesAmount: formatSatang(otherFeesSatang),
    overdueAmount: formatSatang(overdueSatang),
    totalAmount: overallStatus === 'INVALID' ? 'INVALID' : totalStr,
    formattedTotal: overallStatus === 'INVALID' ? 'รูปแบบคิดเงินไม่ถูกต้อง' : formatMoneyDisplay(totalStr),
  };
}

export interface MeterUsageResult {
  isValid: boolean;
  isRollover: boolean;
  rolloverType: '4_DIGIT' | '5_DIGIT' | null;
  usageUnits: number;
  errorMessage?: string;
}

/**
 * Validates whether an input represents a non-negative integer between 0 and 99999 (maximum 5 digits).
 * Strictly rejects decimals, negatives, non-numeric strings, and numbers > 99999.
 */
export function parseMeterIntegerReading(val: string | number | null | undefined): { isValid: boolean; value: number; errorMessage?: string } {
  if (val === null || val === undefined || val === '') {
    return { isValid: false, value: 0, errorMessage: 'กรุณาระบุค่ามิเตอร์' };
  }

  if (typeof val === 'number') {
    if (!Number.isInteger(val) || val < 0 || val > 99999) {
      return { isValid: false, value: 0, errorMessage: 'ค่ามิเตอร์ต้องเป็นจำนวนเต็มระหว่าง 0 ถึง 99999 (สูงสุด 5 หลัก)' };
    }
    return { isValid: true, value: val };
  }

  const str = String(val).trim();
  if (!/^\d{1,5}$/.test(str)) {
    return { isValid: false, value: 0, errorMessage: 'ค่ามิเตอร์ต้องเป็นตัวเลขจำนวนเต็ม 0 ถึง 99999 (สูงสุด 5 หลัก)' };
  }

  const parsed = parseInt(str, 10);
  if (isNaN(parsed) || parsed < 0 || parsed > 99999) {
    return { isValid: false, value: 0, errorMessage: 'ค่ามิเตอร์ต้องเป็นจำนวนเต็มระหว่าง 0 ถึง 99999' };
  }

  return { isValid: true, value: parsed };
}

/**
 * Canonical Meter Usage & Rollover Calculator
 *
 * Order of Evaluation:
 * 1. 5-digit Rollover: 99900 < prev <= 99999 AND curr < 200 => (100000 - prev) + curr
 * 2. 4-digit Rollover: 9900 < prev <= 9999 AND curr < 200 => (10000 - prev) + curr
 * 3. Normal Progressive: curr >= prev => curr - prev
 * 4. Fail-Closed Lower Reading outside rollover => invalid
 */
export function calculateMeterUsageUnits(
  previousReading: string | number | null | undefined,
  currentReading: string | number | null | undefined
): MeterUsageResult {
  const prevParsed = parseMeterIntegerReading(previousReading);
  if (!prevParsed.isValid) {
    return {
      isValid: false,
      isRollover: false,
      rolloverType: null,
      usageUnits: 0,
      errorMessage: `ค่ามิเตอร์เดิมไม่ถูกต้อง: ${prevParsed.errorMessage}`,
    };
  }

  const currParsed = parseMeterIntegerReading(currentReading);
  if (!currParsed.isValid) {
    return {
      isValid: false,
      isRollover: false,
      rolloverType: null,
      usageUnits: 0,
      errorMessage: `ค่ามิเตอร์ปัจจุบันไม่ถูกต้อง: ${currParsed.errorMessage}`,
    };
  }

  const prev = prevParsed.value;
  const curr = currParsed.value;

  // 1. Test 5-digit rollover: 99900 < prev <= 99999 AND curr < 200
  if (prev > 99900 && prev <= 99999 && curr < 200) {
    return {
      isValid: true,
      isRollover: true,
      rolloverType: '5_DIGIT',
      usageUnits: (100000 - prev) + curr,
    };
  }

  // 2. Test 4-digit rollover: 9900 < prev <= 9999 AND curr < 200
  if (prev > 9900 && prev <= 9999 && curr < 200) {
    return {
      isValid: true,
      isRollover: true,
      rolloverType: '4_DIGIT',
      usageUnits: (10000 - prev) + curr,
    };
  }

  // 3. Normal progressive reading: curr >= prev
  if (curr >= prev) {
    return {
      isValid: true,
      isRollover: false,
      rolloverType: null,
      usageUnits: curr - prev,
    };
  }

  // 4. Fail-closed lower reading outside rollover
  return {
    isValid: false,
    isRollover: false,
    rolloverType: null,
    usageUnits: 0,
    errorMessage: `ค่ามิเตอร์ปัจจุบัน (${curr}) ต้องไม่น้อยกว่าค่ามิเตอร์เดิม (${prev})`,
  };
}
