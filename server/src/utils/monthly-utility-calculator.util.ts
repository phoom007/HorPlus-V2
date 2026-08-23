/**
 * @license Apache-2.0
 * Canonical Central Monthly Utility Calculation Authority
 *
 * Exact Decimal / Satang Monetary Authority:
 * 1. ZERO floating-point operations. All financial amounts calculated using exact Decimal strings / BigInt.
 * 2. Exact two-decimal canonical strings ("0.00", "650.00", "1250.00").
 * 3. 100% Mathematical & Domain Parity between unissued PREVIEW and persisted Bill issuance.
 * 4. Meter usage preserves exact 2-decimal fractional units without integer rounding.
 * 5. Monthly Utility STRICTLY EXCLUDES Rent and Deposit (Rent and Deposit are independent financial domains).
 */

import { normalizeUtilityBillingMode, CanonicalUtilityBillingMode } from './billing-mode-normalizer.util.js';
import {
  toDecimal,
  addDecimals,
  subDecimals,
  mulDecimals,
  formatDecimal,
  isZeroDecimal,
} from './decimal-math.util.js';
import { calculateMeterUsageUnits, MeterUsageResult } from './meter-billing-calculator.util.js';

export interface CanonicalRateSnapshotInput {
  waterBillingType?: string | null;
  waterRate?: string | number | null;
  electricityBillingType?: string | null;
  electricityRate?: string | number | null;
  commonFeeMode?: string | null;
  commonFee?: string | number | null;
  internetFeeMode?: string | null;
  internetFee?: string | number | null;
  parkingFeeMode?: string | null;
  parkingFee?: string | number | null;
}

export interface CanonicalReadingInput {
  previousReading?: string | number | null;
  currentReading?: string | number | null;
  usageUnits?: string | number | null;
}

export interface CanonicalMonthlyUtilityInput {
  dormitoryId?: string;
  billingCycleId?: string;
  roomId?: string;
  rateSnapshot?: CanonicalRateSnapshotInput | null;
  waterReading?: CanonicalReadingInput | null;
  electricReading?: CanonicalReadingInput | null;
  peopleCount?: number | null;
  parkingQuantity?: string | number | null;
  manualOutstanding?: string | number | null;
  otherFees?: Array<{ description: string; amount: string | number }> | null;
}

export interface CanonicalMonthlyUtilityLineItem {
  type: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  metadata?: Record<string, any>;
}

export interface CanonicalMonthlyUtilityResult {
  waterUsage: string;
  waterRate: string;
  waterAmount: string;
  waterMode?: CanonicalUtilityBillingMode;
  electricityUsage: string;
  electricityRate: string;
  electricityAmount: string;
  electricityMode?: CanonicalUtilityBillingMode;
  commonFee: string;
  internetFee: string;
  parkingFee: string;
  manualOutstandingAmount: string;
  otherFees: Array<{ description: string; amount: string }>;
  peopleCount: number;
  subtotal: string;
  monthlyUtilityTotal: string;
  items: CanonicalMonthlyUtilityLineItem[];
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

function cleanReadingInput(val: string | number | null | undefined): string | number | null | undefined {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' && /^\d+\.0+$/.test(val.trim())) {
    return val.trim().replace(/\.0+$/, '');
  }
  return val;
}

/**
 * Calculates canonical Monthly Utility charges, line items, and total.
 * Throws standard error for fatal domain violations (e.g. INVALID_BILLING_MODE, MISSING_METER_READING, INVALID_METER_READING_LOWER).
 */
export function calculateCanonicalMonthlyUtility(
  input: CanonicalMonthlyUtilityInput
): CanonicalMonthlyUtilityResult {
  const {
    rateSnapshot,
    waterReading,
    electricReading,
    peopleCount: rawPeopleCount,
    parkingQuantity: rawParkingQuantity,
    manualOutstanding: rawManualOutstanding,
    otherFees: rawOtherFees,
  } = input;

  if (!rateSnapshot) {
    const err = new Error('MISSING_RATE_SNAPSHOT: Canonical BillingRateSnapshot is required for monthly utility calculation');
    (err as any).statusCode = 422;
    (err as any).code = 'MISSING_RATE_SNAPSHOT';
    throw err;
  }

  const peopleCount = Math.max(0, rawPeopleCount ?? 0);
  const peopleCountDec = toDecimal(peopleCount.toString());

  // 1. Water Calculation
  const waterMode = normalizeUtilityBillingMode(rateSnapshot.waterBillingType);
  const waterRate = toDecimal(rateSnapshot.waterRate ?? '0.00');
  let waterUsageStr = '0.00';
  let waterAmountStr = '0.00';
  const items: CanonicalMonthlyUtilityLineItem[] = [];

  if (waterMode === 'per_unit') {
    const prevRaw = cleanReadingInput(waterReading?.previousReading);
    const currRaw = cleanReadingInput(waterReading?.currentReading);
    const hasPrev = prevRaw !== undefined && prevRaw !== null && String(prevRaw).trim() !== '';
    const hasCurr = currRaw !== undefined && currRaw !== null && String(currRaw).trim() !== '';

    if (!hasPrev || !hasCurr) {
      if (!isZeroDecimal(waterRate)) {
        const err = new Error('MISSING_WATER_METER_READING: กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล');
        (err as any).statusCode = 400;
        (err as any).code = 'MISSING_WATER_METER_READING';
        throw err;
      }
    } else {
      const usageRes = calculateMeterUsageUnits(prevRaw, currRaw);
      if (!usageRes.isValid) {
        const err = new Error(usageRes.errorMessage || 'ค่ามิเตอร์น้ำไม่ถูกต้อง');
        (err as any).statusCode = 400;
        (err as any).code = usageRes.errorCode || 'INVALID_METER_READING';
        throw err;
      }

      const unitsDec = toDecimal(usageRes.usageUnits.toString());
      const isRollover = usageRes.isRollover;
      const rolloverType = usageRes.rolloverType;
      const amtDec = mulDecimals(unitsDec, waterRate);
      waterUsageStr = formatDecimal(unitsDec);
      waterAmountStr = formatDecimal(amtDec);
      items.push({
        type: 'water',
        description: `ค่าน้ำประปา (${prevRaw} - ${currRaw})`,
        quantity: waterUsageStr,
        unit: 'unit',
        unitPrice: formatDecimal(waterRate),
        amount: waterAmountStr,
        metadata: {
          previousReading: prevRaw,
          currentReading: currRaw,
          usageUnits: isRollover ? usageRes.usageUnits : Number(formatDecimal(unitsDec)),
          mode: 'per_unit',
          isRollover,
          rolloverType,
        },
      });
    }
  } else if (waterMode === 'per_person') {
    const amtDec = mulDecimals(peopleCountDec, waterRate);
    waterUsageStr = formatDecimal(peopleCountDec);
    waterAmountStr = formatDecimal(amtDec);
    items.push({
      type: 'water',
      description: `ค่าน้ำประปา (${peopleCount} คน)`,
      quantity: waterUsageStr,
      unit: 'person',
      unitPrice: formatDecimal(waterRate),
      amount: waterAmountStr,
      metadata: { mode: 'per_person', peopleCount },
    });
  } else if (waterMode === 'fixed') {
    if (!isZeroDecimal(waterRate)) {
      waterUsageStr = '1.00';
      waterAmountStr = formatDecimal(waterRate);
      items.push({
        type: 'water',
        description: 'ค่าน้ำประปา (เหมาจ่าย)',
        quantity: '1.00',
        unit: 'room',
        unitPrice: formatDecimal(waterRate),
        amount: waterAmountStr,
        metadata: { mode: 'fixed' },
      });
    }
  }

  // 2. Electricity Calculation
  const elecMode = normalizeUtilityBillingMode(rateSnapshot.electricityBillingType);
  const elecRate = toDecimal(rateSnapshot.electricityRate ?? '0.00');
  let elecUsageStr = '0.00';
  let elecAmountStr = '0.00';

  if (elecMode === 'per_unit') {
    const prevRaw = cleanReadingInput(electricReading?.previousReading);
    const currRaw = cleanReadingInput(electricReading?.currentReading);
    const hasPrev = prevRaw !== undefined && prevRaw !== null && String(prevRaw).trim() !== '';
    const hasCurr = currRaw !== undefined && currRaw !== null && String(currRaw).trim() !== '';

    if (!hasPrev || !hasCurr) {
      if (!isZeroDecimal(elecRate)) {
        const err = new Error('MISSING_ELECTRICITY_METER_READING: กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล');
        (err as any).statusCode = 400;
        (err as any).code = 'MISSING_ELECTRICITY_METER_READING';
        throw err;
      }
    } else {
      const usageRes = calculateMeterUsageUnits(prevRaw, currRaw);
      if (!usageRes.isValid) {
        const err = new Error(usageRes.errorMessage || 'ค่ามิเตอร์ไฟฟ้าไม่ถูกต้อง');
        (err as any).statusCode = 400;
        (err as any).code = usageRes.errorCode || 'INVALID_METER_READING';
        throw err;
      }

      const unitsDec = toDecimal(usageRes.usageUnits.toString());
      const isRollover = usageRes.isRollover;
      const rolloverType = usageRes.rolloverType;
      const amtDec = mulDecimals(unitsDec, elecRate);
      elecUsageStr = formatDecimal(unitsDec);
      elecAmountStr = formatDecimal(amtDec);
      items.push({
        type: 'electricity',
        description: `ค่าไฟฟ้า (${prevRaw} - ${currRaw})`,
        quantity: elecUsageStr,
        unit: 'unit',
        unitPrice: formatDecimal(elecRate),
        amount: elecAmountStr,
        metadata: {
          previousReading: prevRaw,
          currentReading: currRaw,
          usageUnits: isRollover ? usageRes.usageUnits : Number(formatDecimal(unitsDec)),
          mode: 'per_unit',
          isRollover,
          rolloverType,
        },
      });
    }
  } else if (elecMode === 'per_person') {
    const amtDec = mulDecimals(peopleCountDec, elecRate);
    elecUsageStr = formatDecimal(peopleCountDec);
    elecAmountStr = formatDecimal(amtDec);
    items.push({
      type: 'electricity',
      description: `ค่าไฟฟ้า (${peopleCount} คน)`,
      quantity: elecUsageStr,
      unit: 'person',
      unitPrice: formatDecimal(elecRate),
      amount: elecAmountStr,
      metadata: { mode: 'per_person', peopleCount },
    });
  } else if (elecMode === 'fixed') {
    if (!isZeroDecimal(elecRate)) {
      elecUsageStr = '1.00';
      elecAmountStr = formatDecimal(elecRate);
      items.push({
        type: 'electricity',
        description: 'ค่าไฟฟ้า (เหมาจ่าย)',
        quantity: '1.00',
        unit: 'room',
        unitPrice: formatDecimal(elecRate),
        amount: elecAmountStr,
        metadata: { mode: 'fixed' },
      });
    }
  }

  // 3. Common Fee Calculation
  const rawCommonMode = rateSnapshot.commonFeeMode || 'per_room';
  const commonFee = toDecimal(rateSnapshot.commonFee ?? '0.00');
  let commonFeeStr = '0.00';

  if (!isZeroDecimal(commonFee) && rawCommonMode !== 'free' && rawCommonMode !== 'none') {
    const isPerPerson = rawCommonMode === 'person' || rawCommonMode === 'per_person';
    const q = isPerPerson ? peopleCountDec : toDecimal('1.00');
    const amt = isPerPerson ? mulDecimals(peopleCountDec, commonFee) : commonFee;
    commonFeeStr = formatDecimal(amt);
    items.push({
      type: 'common_fee',
      description: isPerPerson ? `ค่าส่วนกลาง (${peopleCount} คน)` : 'ค่าส่วนกลาง',
      quantity: formatDecimal(q),
      unit: isPerPerson ? 'person' : 'room',
      unitPrice: formatDecimal(commonFee),
      amount: commonFeeStr,
      metadata: { mode: rawCommonMode, peopleCount: isPerPerson ? peopleCount : undefined },
    });
  }

  // 4. Internet Fee Calculation
  const rawInternetMode = rateSnapshot.internetFeeMode || 'per_room';
  const internetFee = toDecimal(rateSnapshot.internetFee ?? '0.00');
  let internetFeeStr = '0.00';

  if (!isZeroDecimal(internetFee) && rawInternetMode !== 'free' && rawInternetMode !== 'none') {
    const isPerPerson = rawInternetMode === 'person' || rawInternetMode === 'per_person';
    const q = isPerPerson ? peopleCountDec : toDecimal('1.00');
    const amt = isPerPerson ? mulDecimals(peopleCountDec, internetFee) : internetFee;
    internetFeeStr = formatDecimal(amt);
    items.push({
      type: 'internet',
      description: isPerPerson ? `ค่าอินเทอร์เน็ต (${peopleCount} คน)` : 'ค่าอินเทอร์เน็ต',
      quantity: formatDecimal(q),
      unit: isPerPerson ? 'person' : 'room',
      unitPrice: formatDecimal(internetFee),
      amount: internetFeeStr,
      metadata: { mode: rawInternetMode, peopleCount: isPerPerson ? peopleCount : undefined },
    });
  }

  // 5. Parking Fee Calculation
  const rawParkingMode = rateSnapshot.parkingFeeMode || 'per_room';
  const parkingFee = toDecimal(rateSnapshot.parkingFee ?? '0.00');
  let parkingFeeStr = '0.00';

  if (!isZeroDecimal(parkingFee) && rawParkingMode !== 'free' && rawParkingMode !== 'none') {
    const isPerPerson = rawParkingMode === 'person' || rawParkingMode === 'per_person';
    const isPerVehicle = rawParkingMode === 'vehicle' || rawParkingMode === 'per_vehicle';

    let q = toDecimal('1.00');
    let amt = parkingFee;
    let unit = 'room';
    let desc = 'ค่าที่จอดรถ';
    let meta: any = undefined;

    if (isPerPerson) {
      q = peopleCountDec;
      amt = mulDecimals(peopleCountDec, parkingFee);
      unit = 'person';
      desc = `ค่าที่จอดรถ (${peopleCount} คน)`;
      meta = { mode: 'person', peopleCount };
    } else if (isPerVehicle) {
      const vQty = toDecimal(rawParkingQuantity ?? '0.00');
      q = vQty;
      amt = mulDecimals(vQty, parkingFee);
      unit = 'vehicle';
      desc = `ค่าที่จอดรถ (${formatDecimal(vQty)} คัน)`;
      meta = { mode: 'vehicle', vehicleCount: formatDecimal(vQty) };
    }

    if (!isZeroDecimal(amt) || !isZeroDecimal(parkingFee)) {
      parkingFeeStr = formatDecimal(amt);
      items.push({
        type: 'parking',
        description: desc,
        quantity: formatDecimal(q),
        unit,
        unitPrice: formatDecimal(parkingFee),
        amount: parkingFeeStr,
        metadata: meta,
      });
    }
  }

  // 6. Manual Outstanding / Overdue Amount
  let manualOutstandingStr = '0.00';
  if (rawManualOutstanding) {
    const outAmt = toDecimal(rawManualOutstanding.toString());
    manualOutstandingStr = formatDecimal(outAmt);
    if (!isZeroDecimal(outAmt)) {
      items.push({
        type: 'manual_outstanding',
        description: 'ค้างชำระ',
        quantity: '1.00',
        unit: 'charge',
        unitPrice: manualOutstandingStr,
        amount: manualOutstandingStr,
      });
    }
  }

  // 7. Other Fees Calculation
  const otherFeesList: Array<{ description: string; amount: string }> = [];
  if (rawOtherFees && Array.isArray(rawOtherFees)) {
    for (const f of rawOtherFees) {
      if (f && f.description && f.amount) {
        const feeAmt = toDecimal(String(f.amount));
        if (!isZeroDecimal(feeAmt)) {
          const feeAmtStr = formatDecimal(feeAmt);
          const desc = String(f.description).trim();
          items.push({
            type: 'other_fee',
            description: desc,
            quantity: '1.00',
            unit: 'charge',
            unitPrice: feeAmtStr,
            amount: feeAmtStr,
          });
          otherFeesList.push({ description: desc, amount: feeAmtStr });
        }
      }
    }
  }

  // 8. Total Accumulation (Exact Satang / Decimal Addition)
  let subtotalDec = toDecimal('0.00');
  for (const item of items) {
    subtotalDec = addDecimals(subtotalDec, item.amount);
  }
  const totalStr = formatDecimal(subtotalDec);

  return {
    waterUsage: waterUsageStr,
    waterRate: formatDecimal(waterRate),
    waterAmount: waterAmountStr,
    waterMode,
    electricityUsage: elecUsageStr,
    electricityRate: formatDecimal(elecRate),
    electricityAmount: elecAmountStr,
    electricityMode: elecMode,
    commonFee: commonFeeStr,
    internetFee: internetFeeStr,
    parkingFee: parkingFeeStr,
    manualOutstandingAmount: manualOutstandingStr,
    otherFees: otherFeesList,
    peopleCount,
    subtotal: totalStr,
    monthlyUtilityTotal: totalStr,
    items,
    isValid: true,
  };
}
