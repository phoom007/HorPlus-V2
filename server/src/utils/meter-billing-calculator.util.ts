/**
 * @license Apache-2.0
 * Canonical Meter Live Billing Preview Calculator
 * 
 * Exact Decimal / Satang Monetary Authority:
 * 1. ZERO floating-point operations. All financial amounts calculated in exact integer satangs (BigInt).
 * 2. Exact two-decimal canonical strings ("0.00", "3500.00", "4200.50").
 * 3. 100% Mathematical Parity with server BillingService.generateBillPreview & decimal-math.util.
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
  waterCurr?: number;
  waterPrev?: number;
  elecCurr?: number;
  elecPrev?: number;
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
 * Converts a monetary string or number into exact integer satangs (BigInt).
 * Examples: "3500" -> 350000n, "3500.5" -> 350050n, "3500.50" -> 350050n, "-10.00" -> -1000n.
 */
export function parseSatang(val: string | number | null | undefined): bigint {
  if (val === null || val === undefined || val === '') return 0n;
  const str = String(val).trim();
  if (!str || str === '0' || str === '0.0' || str === '0.00') return 0n;
  const isNegative = str.startsWith('-');
  const clean = isNegative ? str.slice(1) : str;
  const [intPart = '0', fracPart = ''] = clean.split('.');
  const cleanInt = intPart.replace(/\D/g, '') || '0';
  const cleanFrac = (fracPart.replace(/\D/g, '') + '00').slice(0, 2);
  const satang = BigInt(cleanInt) * 100n + BigInt(cleanFrac);
  return isNegative ? -satang : satang;
}

/**
 * Converts exact integer satangs (BigInt) into a canonical two-decimal monetary string ("3500.00").
 */
export function formatSatang(satang: bigint): string {
  const isNegative = satang < 0n;
  const abs = isNegative ? -satang : satang;
  const intPart = abs / 100n;
  const fracPart = (abs % 100n).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${intPart.toString()}.${fracPart}`;
}

/**
 * Multiplies a satang rate by a decimal or integer quantity with exact Round-Half-Up satang rounding.
 * Examples: 1800n (18.00 ฿) * "5" -> 9000n (90.00 ฿)
 */
export function multiplySatangByQuantity(satangRate: bigint, quantity: string | number | null | undefined): bigint {
  if (satangRate === 0n || quantity === null || quantity === undefined || quantity === '' || quantity === 0) {
    return 0n;
  }
  const qSatang = parseSatang(quantity);
  // satangRate * (qSatang / 100) -> (satangRate * qSatang) / 100 with round-half-up
  const product = satangRate * qSatang;
  const quotient = product / 100n;
  const remainder = product % 100n;
  const absRemainder = remainder < 0n ? -remainder : remainder;
  if (absRemainder >= 50n) {
    return quotient + (product > 0n ? 1n : -1n);
  }
  return quotient;
}

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

  const waterPrev = draft.waterPrev !== undefined ? Number(draft.waterPrev) : 0;
  const waterCurr = draft.waterCurr !== undefined ? Number(draft.waterCurr) : waterPrev;

  const elecPrev = draft.elecPrev !== undefined ? Number(draft.elecPrev) : 0;
  const elecCurr = draft.elecCurr !== undefined ? Number(draft.elecCurr) : elecPrev;

  // 1. Water Calculation
  const waterMode = rates?.waterBillingType || 'per_unit';
  const waterRateSatang = parseSatang(rates?.waterRate);
  let waterUsageSatang = 0n;
  let waterAmountSatang = 0n;

  if (waterMode === 'per_person' || waterMode === 'person') {
    waterAmountSatang = multiplySatangByQuantity(waterRateSatang, peopleCountStr);
    waterUsageSatang = parseSatang(peopleCountStr);
  } else if (waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room') {
    waterAmountSatang = waterRateSatang;
    waterUsageSatang = 100n; // 1.00 room
  } else {
    // per_unit
    const usage = Math.max(0, Math.round(waterCurr - waterPrev));
    waterUsageSatang = BigInt(usage) * 100n;
    waterAmountSatang = multiplySatangByQuantity(waterRateSatang, usage.toString());
  }

  // 2. Electricity Calculation
  const elecMode = rates?.electricityBillingType || 'per_unit';
  const elecRateSatang = parseSatang(rates?.electricityRate);
  let elecUsageSatang = 0n;
  let elecAmountSatang = 0n;

  if (elecMode === 'per_person' || elecMode === 'person') {
    elecAmountSatang = multiplySatangByQuantity(elecRateSatang, peopleCountStr);
    elecUsageSatang = parseSatang(peopleCountStr);
  } else if (elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room') {
    elecAmountSatang = elecRateSatang;
    elecUsageSatang = 100n; // 1.00 room
  } else {
    // per_unit
    const usage = Math.max(0, Math.round(elecCurr - elecPrev));
    elecUsageSatang = BigInt(usage) * 100n;
    elecAmountSatang = multiplySatangByQuantity(elecRateSatang, usage.toString());
  }

  // 3. Common Fee Calculation
  const commonMode = rates?.commonFeeMode || 'per_room';
  const commonFeeSatang = parseSatang(rates?.commonFee);
  let commonAmountSatang = 0n;

  if (commonMode === 'free' || commonMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
    commonAmountSatang = 0n;
  } else if (commonMode === 'per_person' || commonMode === 'person') {
    commonAmountSatang = multiplySatangByQuantity(commonFeeSatang, peopleCountStr);
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
    internetAmountSatang = multiplySatangByQuantity(internetFeeSatang, peopleCountStr);
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
    parkingAmountSatang = multiplySatangByQuantity(parkingFeeSatang, peopleCountStr);
  } else if (parkingMode === 'per_vehicle' || parkingMode === 'vehicle') {
    const rawQty = roomCtx?.parkingQuantity;
    const qty = rawQty === 'per_person' ? peopleCountStr : (rawQty ?? '0.00');
    parkingAmountSatang = multiplySatangByQuantity(parkingFeeSatang, qty);
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
    waterUsage: formatSatang(waterUsageSatang),
    elecAmount: formatSatang(elecAmountSatang),
    elecUsage: formatSatang(elecUsageSatang),
    commonAmount: formatSatang(commonAmountSatang),
    internetAmount: formatSatang(internetAmountSatang),
    parkingAmount: formatSatang(parkingAmountSatang),
    otherFeesAmount: formatSatang(otherFeesSatang),
    overdueAmount: formatSatang(overdueSatang),
    totalAmount: totalStr,
    formattedTotal: formatMoneyDisplay(totalStr),
  };
}
