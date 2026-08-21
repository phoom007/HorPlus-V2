/**
 * @license Apache-2.0
 * Canonical Meter Live Billing Preview Calculator
 *
 * Exact Decimal / Satang Monetary Authority:
 * 1. ZERO floating-point operations. All financial amounts calculated in exact integer satangs (BigInt).
 * 2. Exact two-decimal canonical strings ("0.00", "3500.00", "4200.50").
 * 3. 100% Mathematical Parity with server BillingService.generateBillPreview & decimal-math.util.
 * 4. Meter usage preserves exact 2-decimal fractional units without integer rounding (e.g. 105.75 - 100.25 = 5.50).
 */

export interface RateSnapshotContext {
  waterBillingType?: 'per_unit' | 'per_person' | 'fixed' | 'per_room' | 'room' | 'person';
  waterRate?: string | number;
  electricityBillingType?: 'per_unit' | 'per_person' | 'fixed' | 'per_room' | 'room' | 'person';
  electricityRate?: string | number;
  commonFeeMode?: 'per_room' | 'per_person' | 'free' | 'room' | 'person' | 'none';
  commonFee?: string | number;
  internetFeeMode?: 'per_room' | 'per_person' | 'free' | 'room' | 'person' | 'none';
  internetFee?: string | number;
  parkingFeeMode?: 'per_room' | 'per_person' | 'per_vehicle' | 'free' | 'room' | 'person' | 'vehicle' | 'none';
  parkingFee?: string | number;
}

export interface RoomPreviewContext {
  roomId: string;
  roomNumber?: string;
  tenantId?: string | null;
  tenantName?: string | null;
  billingSource: 'CONTRACT' | 'PROVISIONAL_MONTHLY' | 'PROVISIONAL_TERM' | 'NONE';
  rentAmount: string | number;
  rentDescription?: string;
  parkingQuantity?: string | number;
  snapshotVersion?: number;
  snapshotOtherFees?: Array<{ description: string; amount: string | number }>;
  snapshotManualOutstanding?: string | number;
  snapshotPeopleCount?: number | null;
  currentHouseholdPeopleCount?: number;
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

export interface CalculatedMeterPreview {
  rentAmount: string;
  waterAmount: string;
  waterUsage: string;
  elecAmount: string;
  elecUsage: string;
  commonAmount: string;
  internetAmount: string;
  parkingAmount: string;
  otherFeesAmount: string;
  overdueAmount: string;
  totalAmount: string;
  formattedTotal: string;
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
export function formatMoneyDisplay(decimalStr: string): string {
  if (!decimalStr) return '0.00';
  const [intPart = '0', fracPart = '00'] = decimalStr.split('.');
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${formattedInt}.${fracPart}`;
}

/**
 * Formats a meter reading or unit value for clean display without trailing .00 for integers.
 * Example: "500.00" -> "500", 500 -> "500", "500.50" -> "500.5", 105.75 -> "105.75"
 */
export function formatMeterReadingDisplay(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0';
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return '0';
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

  const waterPrev = draft.waterPrev !== undefined ? String(draft.waterPrev) : '0.00';
  const waterCurr = draft.waterCurr !== undefined ? String(draft.waterCurr) : waterPrev;

  const elecPrev = draft.elecPrev !== undefined ? String(draft.elecPrev) : '0.00';
  const elecCurr = draft.elecCurr !== undefined ? String(draft.elecCurr) : elecPrev;

  // 1. Water Calculation
  const waterMode = rates?.waterBillingType || 'per_unit';
  const waterRateSatang = parseSatang(rates?.waterRate);
  let waterUsageScaled = 0n;
  let waterAmountSatang = 0n;

  if (waterMode === 'per_person' || waterMode === 'person') {
    waterAmountSatang = multiplyMoneyByQuantity(waterRateSatang, peopleCountStr);
    waterUsageScaled = parseScaled2(peopleCountStr);
  } else if (waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room') {
    waterAmountSatang = waterRateSatang;
    waterUsageScaled = 100n; // 1.00 room
  } else {
    // per_unit: exact 2-decimal fractional difference
    waterUsageScaled = subtractScaled2(waterCurr, waterPrev);
    const usageStr = formatScaled2(waterUsageScaled);
    waterAmountSatang = multiplyMoneyByQuantity(waterRateSatang, usageStr);
  }

  // 2. Electricity Calculation
  const elecMode = rates?.electricityBillingType || 'per_unit';
  const elecRateSatang = parseSatang(rates?.electricityRate);
  let elecUsageScaled = 0n;
  let elecAmountSatang = 0n;

  if (elecMode === 'per_person' || elecMode === 'person') {
    elecAmountSatang = multiplyMoneyByQuantity(elecRateSatang, peopleCountStr);
    elecUsageScaled = parseScaled2(peopleCountStr);
  } else if (elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room') {
    elecAmountSatang = elecRateSatang;
    elecUsageScaled = 100n; // 1.00 room
  } else {
    // per_unit: exact 2-decimal fractional difference
    elecUsageScaled = subtractScaled2(elecCurr, elecPrev);
    const usageStr = formatScaled2(elecUsageScaled);
    elecAmountSatang = multiplyMoneyByQuantity(elecRateSatang, usageStr);
  }

  // 3. Common Fee Calculation
  const commonMode = rates?.commonFeeMode || 'per_room';
  const commonFeeSatang = parseSatang(rates?.commonFee);
  let commonAmountSatang = 0n;

  if (commonMode === 'free' || commonMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
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

  if (internetMode === 'free' || internetMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
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

  if (parkingMode === 'free' || parkingMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
    parkingAmountSatang = 0n;
  } else if (parkingMode === 'per_person' || parkingMode === 'person') {
    parkingAmountSatang = multiplyMoneyByQuantity(parkingFeeSatang, peopleCountStr);
  } else if (parkingMode === 'per_vehicle' || parkingMode === 'vehicle') {
    const rawQty = roomCtx?.parkingQuantity;
    const qty = rawQty === 'per_person' ? peopleCountStr : (rawQty ?? '0.00');
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

  // 8. Total Amount
  const totalSatang =
    rentSatang +
    waterAmountSatang +
    elecAmountSatang +
    commonAmountSatang +
    internetAmountSatang +
    parkingAmountSatang +
    otherFeesSatang +
    overdueSatang;

  const totalStr = formatSatang(totalSatang);

  return {
    rentAmount: formatSatang(rentSatang),
    waterAmount: formatSatang(waterAmountSatang),
    waterUsage: formatScaled2(waterUsageScaled),
    elecAmount: formatSatang(elecAmountSatang),
    elecUsage: formatScaled2(elecUsageScaled),
    commonAmount: formatSatang(commonAmountSatang),
    internetAmount: formatSatang(internetAmountSatang),
    parkingAmount: formatSatang(parkingAmountSatang),
    otherFeesAmount: formatSatang(otherFeesSatang),
    overdueAmount: formatSatang(overdueSatang),
    totalAmount: totalStr,
    formattedTotal: formatMoneyDisplay(totalStr),
  };
}
