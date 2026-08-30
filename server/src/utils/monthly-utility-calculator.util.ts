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
import { CanonicalTierRecord, validateCanonicalUtilityTiers } from './utility-tier-validator.util.js';
import { calculateProgressiveTieredCharge } from './progressive-tier-calculator.util.js';
import { toBangkokDateString } from './calendar-date.util.js';

export const LATE_FEE_GRACE_DAYS = 2;

/**
 * Calculates chargeable overdue days in Asia/Bangkok calendar days with fixed 2-day silent grace.
 *
 * Invariant Rules:
 *   calendarDaysPastDue = differenceInCalendarDays(asOfDateBKK, dueDateBKK)
 *   chargeableOverdueDays = max(0, calendarDaysPastDue - LATE_FEE_GRACE_DAYS)
 *
 * Example (dueDate = Sep 5):
 *   Sep 5: 0 days
 *   Sep 6: grace day 1 -> 0 days
 *   Sep 7: grace day 2 -> 0 days
 *   Sep 8: 1 chargeable day
 *   Sep 9: 2 chargeable days
 */
export function calculateChargeableOverdueDays(dueDate: Date | string, asOfDate?: Date | string | null): number {
  const dueBangkokStr = toBangkokDateString(dueDate);
  const asOfBangkokStr = toBangkokDateString(asOfDate || new Date());
  const dueDt = new Date(`${dueBangkokStr}T00:00:00.000Z`);
  const asOfDt = new Date(`${asOfBangkokStr}T00:00:00.000Z`);
  const calendarDaysPastDue = Math.floor((asOfDt.getTime() - dueDt.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0, calendarDaysPastDue - LATE_FEE_GRACE_DAYS);
}

export interface CanonicalRateSnapshotInput {
  waterBillingType?: string | null;
  waterRate?: string | number | null;
  waterTierRates?: CanonicalTierRecord[] | null;
  electricityBillingType?: string | null;
  electricityRate?: string | number | null;
  electricityTierRates?: CanonicalTierRecord[] | null;
  commonFeeMode?: string | null;
  commonFee?: string | number | null;
  internetFeeMode?: string | null;
  internetFee?: string | number | null;
  parkingFeeMode?: string | null;
  parkingFee?: string | number | null;
  lateFeeType?: string | null;
  lateFeeValue?: string | number | null;
  gracePeriodDays?: number | null;
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
  dueDate?: Date | string | null;
  asOfDate?: Date | string | null;
  gracePeriodDays?: number | null;
}

export function normalizeLateFeeMode(raw: unknown): 'none' | 'daily' | 'fixed' | 'unsupported' {
  if (raw === null || raw === undefined || typeof raw !== 'string') return 'none';
  const cleaned = raw.trim().toLowerCase().replace(/[-\s]/g, '_');
  if (!cleaned || cleaned === 'none' || cleaned === 'null' || cleaned === 'undefined') return 'none';
  switch (cleaned) {
    case 'daily':
    case 'per_day':
    case 'per-day':
    case 'daily_rate':
      return 'daily';
    case 'fixed':
    case 'fixed_once':
    case 'flat':
    case 'once':
      return 'fixed';
    case 'percentage':
    case 'percent':
    default:
      return 'unsupported';
  }
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
  lateFeeAmount?: string;
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
        description: `ค่าน้ำ (${prevRaw} - ${currRaw})`,
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
    if (!isZeroDecimal(amtDec) || peopleCount > 0) {
      items.push({
        type: 'water',
        description: `ค่าน้ำ (${peopleCount} คน)`,
        quantity: waterUsageStr,
        unit: 'person',
        unitPrice: formatDecimal(waterRate),
        amount: waterAmountStr,
        metadata: { mode: 'per_person', peopleCount },
      });
    }
  } else if (waterMode === 'fixed') {
    if (!isZeroDecimal(waterRate)) {
      waterUsageStr = '1.00';
      waterAmountStr = formatDecimal(waterRate);
      items.push({
        type: 'water',
        description: 'ค่าน้ำ (เหมาจ่าย)',
        quantity: '1.00',
        unit: 'room',
        unitPrice: formatDecimal(waterRate),
        amount: waterAmountStr,
        metadata: { mode: 'fixed' },
      });
    }
  } else if (waterMode === 'tiered') {
    const prevRaw = cleanReadingInput(waterReading?.previousReading);
    const currRaw = cleanReadingInput(waterReading?.currentReading);
    const hasPrev = prevRaw !== undefined && prevRaw !== null && String(prevRaw).trim() !== '';
    const hasCurr = currRaw !== undefined && currRaw !== null && String(currRaw).trim() !== '';

    if (!hasPrev || !hasCurr) {
      const err = new Error('MISSING_WATER_METER_READING: กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_WATER_METER_READING';
      throw err;
    }

    const usageRes = calculateMeterUsageUnits(prevRaw, currRaw);
    if (!usageRes.isValid) {
      const err = new Error(usageRes.errorMessage || 'ค่ามิเตอร์น้ำไม่ถูกต้อง');
      (err as any).statusCode = 400;
      (err as any).code = usageRes.errorCode || 'INVALID_METER_READING';
      throw err;
    }

    if (!rateSnapshot.waterTierRates || !Array.isArray(rateSnapshot.waterTierRates) || rateSnapshot.waterTierRates.length === 0) {
      const err = new Error("INVALID_TIER_CONFIGURATION: Water billing mode is 'tiered' but no tier configuration was provided");
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    const validatedTiers = validateCanonicalUtilityTiers(rateSnapshot.waterTierRates);
    const progRes = calculateProgressiveTieredCharge({
      usageUnits: usageRes.usageUnits.toString(),
      tiers: validatedTiers,
    });

    waterUsageStr = progRes.usageUnits;
    waterAmountStr = progRes.totalAmount;
    items.push({
      type: 'water',
      description: `ค่าน้ำ (${prevRaw} - ${currRaw})`,
      quantity: waterUsageStr,
      unit: 'unit',
      unitPrice: '0.00',
      amount: waterAmountStr,
      metadata: {
        previousReading: String(prevRaw),
        currentReading: String(currRaw),
        usageUnits: waterUsageStr,
        mode: 'tiered',
        isRollover: usageRes.isRollover,
        rolloverType: usageRes.rolloverType,
        tierBreakdown: progRes.tierBreakdown,
      },
    });
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
    if (!isZeroDecimal(amtDec) || peopleCount > 0) {
      items.push({
        type: 'electricity',
        description: `ค่าไฟฟ้า (${peopleCount} คน)`,
        quantity: elecUsageStr,
        unit: 'person',
        unitPrice: formatDecimal(elecRate),
        amount: elecAmountStr,
        metadata: { mode: 'per_person', peopleCount },
      });
    }
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
  } else if (elecMode === 'tiered') {
    const prevRaw = cleanReadingInput(electricReading?.previousReading);
    const currRaw = cleanReadingInput(electricReading?.currentReading);
    const hasPrev = prevRaw !== undefined && prevRaw !== null && String(prevRaw).trim() !== '';
    const hasCurr = currRaw !== undefined && currRaw !== null && String(currRaw).trim() !== '';

    if (!hasPrev || !hasCurr) {
      const err = new Error('MISSING_ELECTRICITY_METER_READING: กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล');
      (err as any).statusCode = 400;
      (err as any).code = 'MISSING_ELECTRICITY_METER_READING';
      throw err;
    }

    const usageRes = calculateMeterUsageUnits(prevRaw, currRaw);
    if (!usageRes.isValid) {
      const err = new Error(usageRes.errorMessage || 'ค่ามิเตอร์ไฟฟ้าไม่ถูกต้อง');
      (err as any).statusCode = 400;
      (err as any).code = usageRes.errorCode || 'INVALID_METER_READING';
      throw err;
    }

    if (!rateSnapshot.electricityTierRates || !Array.isArray(rateSnapshot.electricityTierRates) || rateSnapshot.electricityTierRates.length === 0) {
      const err = new Error("INVALID_TIER_CONFIGURATION: Electricity billing mode is 'tiered' but no tier configuration was provided");
      (err as any).statusCode = 400;
      (err as any).code = 'INVALID_TIER_CONFIGURATION';
      throw err;
    }

    const validatedTiers = validateCanonicalUtilityTiers(rateSnapshot.electricityTierRates);
    const progRes = calculateProgressiveTieredCharge({
      usageUnits: usageRes.usageUnits.toString(),
      tiers: validatedTiers,
    });

    elecUsageStr = progRes.usageUnits;
    elecAmountStr = progRes.totalAmount;
    items.push({
      type: 'electricity',
      description: `ค่าไฟฟ้า (${prevRaw} - ${currRaw})`,
      quantity: elecUsageStr,
      unit: 'unit',
      unitPrice: '0.00',
      amount: elecAmountStr,
      metadata: {
        previousReading: String(prevRaw),
        currentReading: String(currRaw),
        usageUnits: elecUsageStr,
        mode: 'tiered',
        isRollover: usageRes.isRollover,
        rolloverType: usageRes.rolloverType,
        tierBreakdown: progRes.tierBreakdown,
      },
    });
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
    if (!isZeroDecimal(amt) || !isPerPerson) {
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
    if (!isZeroDecimal(amt) || !isPerPerson) {
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

    if (!isZeroDecimal(amt) || (!isPerPerson && !isPerVehicle)) {
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

  // 8. Late Fee / Overdue Penalty Calculation
  let lateFeeAmountStr = '0.00';
  const rawLateType = rateSnapshot?.lateFeeType || 'none';
  const lateFeeVal = toDecimal(rateSnapshot?.lateFeeValue ?? '0.00');
  const lateMode = normalizeLateFeeMode(rawLateType);

  if (lateMode === 'unsupported') {
    const err = new Error('INVALID_LATE_FEE_MODE');
    (err as any).code = 'INVALID_LATE_FEE_MODE';
    throw err;
  }

  // Late fees apply ONLY when an authoritative issued bill dueDate is provided
  if (lateMode !== 'none' && !isZeroDecimal(lateFeeVal) && input.dueDate) {
    const overdueDays = calculateChargeableOverdueDays(input.dueDate, input.asOfDate);

    if (overdueDays > 0) {
      if (lateMode === 'daily') {
        const amtDec = mulDecimals(overdueDays.toString(), lateFeeVal);
        lateFeeAmountStr = formatDecimal(amtDec);
        items.push({
          type: 'late_fee',
          description: `ค่าปรับล่าช้า (${overdueDays} วัน)`,
          quantity: overdueDays.toString(),
          unit: 'day',
          unitPrice: formatDecimal(lateFeeVal),
          amount: lateFeeAmountStr,
          metadata: { mode: 'daily', overdueDays, rate: formatDecimal(lateFeeVal) },
        });
      } else if (lateMode === 'fixed') {
        lateFeeAmountStr = formatDecimal(lateFeeVal);
        items.push({
          type: 'late_fee',
          description: 'ค่าปรับล่าช้า',
          quantity: '1.00',
          unit: 'charge',
          unitPrice: formatDecimal(lateFeeVal),
          amount: lateFeeAmountStr,
          metadata: { mode: 'fixed', overdueDays, rate: formatDecimal(lateFeeVal) },
        });
      }
    }
  }

  // 9. Total Accumulation (Exact Satang / Decimal Addition)
  let subtotalDec = toDecimal('0.00');
  for (const item of items) {
    subtotalDec = addDecimals(subtotalDec, item.amount);
  }
  const totalStr = formatDecimal(subtotalDec);

  return {
    waterUsage: waterUsageStr,
    waterRate: waterMode === 'tiered' ? '0.00' : formatDecimal(waterRate),
    waterAmount: waterAmountStr,
    waterMode,
    electricityUsage: elecUsageStr,
    electricityRate: elecMode === 'tiered' ? '0.00' : formatDecimal(elecRate),
    electricityAmount: elecAmountStr,
    electricityMode: elecMode,
    commonFee: commonFeeStr,
    internetFee: internetFeeStr,
    parkingFee: parkingFeeStr,
    manualOutstandingAmount: manualOutstandingStr,
    lateFeeAmount: lateFeeAmountStr,
    otherFees: otherFeesList,
    peopleCount,
    subtotal: totalStr,
    monthlyUtilityTotal: totalStr,
    items,
    isValid: true,
  };
}
