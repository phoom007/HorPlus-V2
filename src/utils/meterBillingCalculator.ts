/**
 * @license Apache-2.0
 * Canonical Meter Live Billing Preview Calculator
 * 
 * Invariants:
 * 1. Pure function with zero network calls and zero side effects.
 * 2. Uses exact Decimal satang-safe rounding.
 * 3. Parity with BillingService.generateBill / generateBillPreview.
 * 4. Supports:
 *    - Contract monthly rent & Term installment schedule
 *    - Provisional Monthly & Provisional Term installment
 *    - Water: per_unit, per_person, per_room (fixed)
 *    - Electricity: per_unit, per_person, per_room (fixed)
 *    - Common fee: per_person, per_room, free
 *    - Internet fee: per_person, per_room, free
 *    - Parking fee: per_person, per_vehicle, per_room, free
 *    - Manual outstanding amount
 *    - Other fees (direct per-room sum)
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
  waterCurr: number;
  waterPrev: number;
  elecCurr: number;
  elecPrev: number;
  peopleCount: number;
  overdueAmount: number;
  otherFees: Array<{ description: string; amount: number }>;
}

export interface CalculatedMeterPreview {
  rentAmount: number;
  waterAmount: number;
  waterUsage: number;
  elecAmount: number;
  elecUsage: number;
  commonAmount: number;
  internetAmount: number;
  parkingAmount: number;
  otherFeesAmount: number;
  overdueAmount: number;
  totalAmount: number;
  formattedTotal: string;
}

function roundTo2Decimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

export function calculateMeterRowPreview(
  roomCtx: RoomPreviewContext | undefined,
  rates: RateSnapshotContext | undefined,
  draft: TransientRowDraft
): CalculatedMeterPreview {
  const rent = Number(roomCtx?.rentAmount) || 0;
  const peopleCount = Math.max(0, draft.peopleCount);

  // 1. Water Calculation
  const waterMode = rates?.waterBillingType || 'per_unit';
  const waterRate = Number(rates?.waterRate) || 0;
  let waterUsage = 0;
  let waterAmount = 0;

  if (waterMode === 'per_person' || waterMode === 'person') {
    waterAmount = roundTo2Decimals(peopleCount * waterRate);
  } else if (waterMode === 'fixed' || waterMode === 'per_room' || waterMode === 'room') {
    waterAmount = roundTo2Decimals(waterRate);
  } else {
    // per_unit
    waterUsage = Math.max(0, draft.waterCurr - draft.waterPrev);
    waterAmount = roundTo2Decimals(waterUsage * waterRate);
  }

  // 2. Electricity Calculation
  const elecMode = rates?.electricityBillingType || 'per_unit';
  const elecRate = Number(rates?.electricityRate) || 0;
  let elecUsage = 0;
  let elecAmount = 0;

  if (elecMode === 'per_person' || elecMode === 'person') {
    elecAmount = roundTo2Decimals(peopleCount * elecRate);
  } else if (elecMode === 'fixed' || elecMode === 'per_room' || elecMode === 'room') {
    elecAmount = roundTo2Decimals(elecRate);
  } else {
    // per_unit
    elecUsage = Math.max(0, draft.elecCurr - draft.elecPrev);
    elecAmount = roundTo2Decimals(elecUsage * elecRate);
  }

  // 3. Common Fee Calculation
  const commonMode = rates?.commonFeeMode || 'per_room';
  const commonFee = Number(rates?.commonFee) || 0;
  let commonAmount = 0;

  if (commonMode === 'free' || commonMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
    commonAmount = 0;
  } else if (commonMode === 'per_person' || commonMode === 'person') {
    commonAmount = roundTo2Decimals(peopleCount * commonFee);
  } else {
    commonAmount = roundTo2Decimals(commonFee);
  }

  // 4. Internet Fee Calculation
  const internetMode = rates?.internetFeeMode || 'per_room';
  const internetFee = Number(rates?.internetFee) || 0;
  let internetAmount = 0;

  if (internetMode === 'free' || internetMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
    internetAmount = 0;
  } else if (internetMode === 'per_person' || internetMode === 'person') {
    internetAmount = roundTo2Decimals(peopleCount * internetFee);
  } else {
    internetAmount = roundTo2Decimals(internetFee);
  }

  // 5. Parking Fee Calculation
  const parkingMode = rates?.parkingFeeMode || 'per_room';
  const parkingFee = Number(rates?.parkingFee) || 0;
  let parkingAmount = 0;

  if (parkingMode === 'free' || parkingMode === 'none' || (peopleCount === 0 && roomCtx?.billingSource === 'NONE')) {
    parkingAmount = 0;
  } else if (parkingMode === 'per_person' || parkingMode === 'person') {
    parkingAmount = roundTo2Decimals(peopleCount * parkingFee);
  } else if (parkingMode === 'per_vehicle' || parkingMode === 'vehicle') {
    const qty = typeof roomCtx?.parkingQuantity === 'number' ? roomCtx.parkingQuantity : (Number(roomCtx?.parkingQuantity) || 0);
    parkingAmount = roundTo2Decimals(qty * parkingFee);
  } else {
    parkingAmount = roundTo2Decimals(parkingFee);
  }

  // 6. Other Fees (direct per-room sum)
  const otherFeesSum = (draft.otherFees || []).reduce((acc, f) => acc + (Number(f.amount) || 0), 0);
  const otherFeesAmount = roundTo2Decimals(otherFeesSum);

  // 7. Overdue Amount
  const overdueAmount = roundTo2Decimals(Number(draft.overdueAmount) || 0);

  // 8. Total Amount
  const total = roundTo2Decimals(
    rent + waterAmount + elecAmount + commonAmount + internetAmount + parkingAmount + otherFeesAmount + overdueAmount
  );

  return {
    rentAmount: rent,
    waterAmount,
    waterUsage,
    elecAmount,
    elecUsage,
    commonAmount,
    internetAmount,
    parkingAmount,
    otherFeesAmount,
    overdueAmount,
    totalAmount: total,
    formattedTotal: total.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
}
