/**
 * Canonical Onboarding Draft Normalizer (Task-009)
 * Normalizes legacy or partial draft payloads into a guaranteed canonical shape.
 * @license Apache-2.0
 */

import { LATE_FEE_GRACE_DAYS } from '../utils/monthly-utility-calculator.util.js';

export const CURRENT_ONBOARDING_DRAFT_SCHEMA_VERSION = 2;

function parseNum(val: any, fallback: number): number {
  if (val === undefined || val === null || val === '') return fallback;
  const num = Number(val);
  return Number.isNaN(num) ? fallback : num;
}

export function normalizeOnboardingDraftPayload(rawPayload: any): Record<string, any> {
  const p = (rawPayload && typeof rawPayload === 'object') ? rawPayload : {};

  // Step 1: Dormitory Info (preserve legacy field names: dormName -> dormitoryName, dormAddress -> address)
  const dormitoryName = (p.dormitoryName ?? p.dormName ?? p.name ?? '').toString();
  const address = (p.address ?? p.dormAddress ?? p.addressLine1 ?? '').toString();
  const province = (p.province ?? '').toString();
  const dormType = (p.dormType ?? p.dormitoryType ?? p.type ?? 'อพาร์ตเมนต์').toString();
  const genderType = (p.genderType ?? p.genderPolicy ?? 'รวม').toString();

  // Step 2: Buildings & Rooms (Deep Field-by-Field Normalization)
  let buildings: any[] = [];
  if (Array.isArray(p.buildings) && p.buildings.length > 0) {
    buildings = p.buildings.map((b: any, idx: number) => {
      const bObj = (b && typeof b === 'object') ? b : {};
      const rawRates = bObj.rentRates || {};

      const monthly = parseNum(rawRates.monthly ?? bObj.monthlyRent ?? bObj.monthly, 0);
      const daily = parseNum(rawRates.daily ?? bObj.dailyRent ?? bObj.daily, 0);
      const term = parseNum(rawRates.term ?? bObj.termRent ?? bObj.term, 0);
      const termMonths = parseNum(rawRates.termMonths ?? bObj.termMonths, 1);
      const maxOccupants = parseNum(rawRates.maxOccupants ?? bObj.maxOccupants ?? bObj.maximumOccupants, 2);

      const totalFloors = parseNum(bObj.totalFloors ?? bObj.floorsCount ?? bObj.floorCount, 1);
      const roomsPerFloor = parseNum(bObj.roomsPerFloor ?? bObj.roomsCount, 0);
      const securityDeposit = parseNum(bObj.securityDeposit ?? bObj.depositAmount, 0);

      return {
        id: (bObj.id ?? `b-${idx + 1}`).toString(),
        name: (bObj.name ?? `อาคาร ${String.fromCharCode(65 + idx)}`).toString(),
        totalFloors: Math.max(1, totalFloors),
        roomsPerFloor: Math.max(0, roomsPerFloor),
        hasElevator: Boolean(bObj.hasElevator ?? false),
        roomPrefix: (bObj.roomPrefix ?? '').toString().trim().toUpperCase(),
        formatPattern: (bObj.formatPattern ?? bObj.numberingPattern ?? 'prefix_floor_room').toString(),
        mode: (bObj.mode ?? 'auto').toString(),
        customRooms: Array.isArray(bObj.customRooms) ? bObj.customRooms : [],
        securityDeposit,
        rentRates: {
          monthly,
          daily,
          term,
          termMonths: Math.max(1, termMonths),
          maxOccupants: Math.max(1, maxOccupants),
        },
      };
    });
  } else {
    buildings = [
      {
        id: 'b-1',
        name: 'อาคาร A',
        totalFloors: 1,
        roomsPerFloor: 0,
        hasElevator: false,
        roomPrefix: '',
        formatPattern: 'prefix_floor_room',
        mode: 'auto',
        customRooms: [],
        securityDeposit: 0,
        rentRates: {
          monthly: 0,
          daily: 0,
          term: 0,
          termMonths: 1,
          maxOccupants: 2,
        },
      },
    ];
  }

  // Step 3: Utilities & Service Rates
  const rawUtil = (p.utilities && typeof p.utilities === 'object') ? p.utilities : {};
  const utilities = {
    waterBillingMode: (rawUtil.waterBillingMode ?? 'unit').toString(),
    waterRate: parseNum(rawUtil.waterRate, 0),
    electricBillingMode: (rawUtil.electricBillingMode ?? 'unit').toString(),
    electricRate: parseNum(rawUtil.electricRate, 0),
    commonFeeMode: (rawUtil.commonFeeMode ?? 'none').toString(),
    commonFeeRate: parseNum(rawUtil.commonFeeRate, 0),
    internetFeeMode: (rawUtil.internetFeeMode ?? 'none').toString(),
    internetRate: parseNum(rawUtil.internetRate, 0),
    parkingFeeMode: (rawUtil.parkingFeeMode ?? 'none').toString(),
    parkingFeeRate: parseNum(rawUtil.parkingFeeRate, 0),
  };

  // Step 4: Deposits & Billing & Payment Account
  const rawDep = (p.deposits && typeof p.deposits === 'object') ? p.deposits : {};
  const deposits = {
    securityDeposit: parseNum(rawDep.securityDeposit, 0),
    advanceRentMonths: parseNum(rawDep.advanceRentMonths, 1),
    dueDateDay: parseNum(rawDep.dueDateDay, 15),
    gracePeriodDays: LATE_FEE_GRACE_DAYS,
    lateFeeType: (rawDep.lateFeeType ?? 'none').toString(),
    lateFeeAmount: parseNum(rawDep.lateFeeAmount, 0),
  };

  const rawPay = (p.paymentAccount && typeof p.paymentAccount === 'object') ? p.paymentAccount : {};
  const paymentAccount = {
    bankName: (rawPay.bankName ?? rawPay.bankCode ?? '').toString(),
    accountNumber: (rawPay.accountNumber ?? rawPay.bankAccountNumber ?? '').toString(),
    accountName: (rawPay.accountName ?? rawPay.bankAccountName ?? '').toString(),
    bankAccountName: (rawPay.bankAccountName ?? rawPay.accountName ?? '').toString(),
    promptPayId: (rawPay.promptPayId ?? rawPay.promptPayValue ?? '').toString(),
  };

  return {
    ...p,
    schemaVersion: CURRENT_ONBOARDING_DRAFT_SCHEMA_VERSION,
    dormitoryName,
    address,
    province,
    dormType,
    genderType,
    buildings,
    utilities,
    deposits,
    paymentAccount,
  };
}
