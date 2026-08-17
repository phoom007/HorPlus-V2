/**
 * HorPlus — Shared Owner Report Calculation and Aggregation Module
 * 
 * Extracts pure calculations and filter logic used across OwnerReports UI
 * and backend oracle verification suites to ensure single-source truth.
 * 
 * Exact-Money Standard:
 * Uses exact integer satang (minor unit) arithmetic for all financial authority
 * to eliminate binary floating-point drift (e.g. 0.10 + 0.20 === 0.30).
 * 
 * @license Apache-2.0
 */

/**
 * Converts any monetary input (string, number, Decimal, null/undefined) to exact BigInt satangs.
 * Handles fractional strings like "189.90", "0.10", "10.15", numbers, and null/undefined.
 */
export function toSatangs(val: string | number | bigint | any): bigint {
  if (val === null || val === undefined || val === '') return 0n;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'object' && val !== null && typeof val.toString === 'function') {
    val = val.toString();
  }
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 0n;
    val = val.toFixed(4);
  }
  const clean = String(val).trim();
  if (!clean || clean === 'NaN' || clean === 'undefined' || clean === 'null') return 0n;

  const isNegative = clean.startsWith('-');
  const unsigned = isNegative ? clean.slice(1) : clean;
  const parts = unsigned.split('.');
  const whole = parts[0] || '0';
  const frac = parts[1] || '00';
  const paddedFrac = frac.padEnd(2, '0').slice(0, 2);
  const wholeBig = BigInt(whole.replace(/[^0-9]/g, '') || '0');
  const fracBig = BigInt(paddedFrac.replace(/[^0-9]/g, '') || '0');
  const satangs = wholeBig * 100n + fracBig;
  return isNegative ? -satangs : satangs;
}

/**
 * Formats exact BigInt satangs back to canonical 2-decimal string (e.g. 30n -> "0.30", 18990n -> "189.90")
 */
export function satangsToString(satangs: bigint): string {
  const isNegative = satangs < 0n;
  const abs = isNegative ? -satangs : satangs;
  const baht = abs / 100n;
  const sat = abs % 100n;
  const prefix = isNegative ? '-' : '';
  return `${prefix}${baht.toString()}.${sat.toString().padStart(2, '0')}`;
}

/**
 * Formats exact BigInt satangs to number strictly at the presentation boundary
 */
export function satangsToNumber(satangs: bigint): number {
  return Number(satangsToString(satangs));
}

export interface ReportCalculationParams {
  rooms?: any[];
  bills?: any[];
  buildings?: any[];
  tenants?: any[];
  contracts?: any[];
  selectedBuilding?: string;
  selectedBillingCycleId?: string; // Authoritative UUID from /api/v1/billing-cycles
  selectedCycleCode?: string;      // Canonical YYYY-MM code (e.g. "2026-08")
  selectedCycle?: string;          // Backward compatibility (UUID or YYYY-MM)
  selectedYear?: string;
}

export interface MonthlyRevenueHistoryItem {
  cycleId: string;    // "2026-01"
  monthKey: string;   // "01"
  name: string;       // "ม.ค."
  fullName: string;   // "มกราคม"
  exactRent: string;
  exactWater: string;
  exactElec: string;
  exactCommonParking: string;
  exactOther: string;
  exactFine: string;
  exactTotal: string;
  rent: number;
  water: number;
  elec: number;
  commonParking: number;
  other: number;
  fine: number;
  total: number;
}

export interface BreakdownPercentages {
  rentPct: number;
  waterPct: number;
  elecPct: number;
  commonParkingPct: number;
  otherPct: number;
  finePct: number;
  depositPct: number;
}

export interface ReportCalculationResult {
  // Room Occupancy Statistics
  totalRooms: number;
  occupiedCount: number;
  vacantCount: number;
  reservedCount: number;
  maintenanceCount: number;
  occupiedPercent: number;
  vacantPercent: number;

  // Exact Monetary Values (Authoritative string / satang representation)
  exactFixedRentTotal: string;
  exactWaterTotal: string;
  exactElectricTotal: string;
  exactCommonParkingTotal: string;
  exactCommonTotal: string;
  exactInternetTotal: string;
  exactParkingTotal: string;
  exactOtherServiceTotal: string;
  exactFineTotal: string;
  exactDepositTotal: string;
  exactTotalBilledThisMonth: string;
  exactTotalRevenueThisMonth: string;
  exactTotalUnpaidThisMonth: string;
  exactTotalOverdueAmount: string;
  exactTotalBilledPlusDeposit: string;
  exactYearBilledTotal: string;
  exactArpu: string;

  // Presentation Monetary Values (Numbers for charts/UI, computed from exact satangs)
  fixedRentTotal: number;
  waterTotal: number;
  electricTotal: number;
  commonParkingTotal: number;
  commonTotal: number;
  internetTotal: number;
  parkingTotal: number;
  otherServiceTotal: number;
  fineTotal: number;
  depositTotal: number;
  totalBilledThisMonth: number;
  totalRevenueThisMonth: number;
  totalUnpaidThisMonth: number;
  totalOverdueAmount: number;
  totalBilledPlusDeposit: number;
  paidPercent: number;
  unpaidPercent: number;
  arpu: number;
  yearBilledTotal: number;

  // Month-by-month historical data for charts & CSV exports
  monthlyRevenueHistory: MonthlyRevenueHistoryItem[];
  breakdownPercentages: BreakdownPercentages;

  // Filtered Collections
  filteredRooms: any[];
  filteredBills: any[];
  currentMonthBills: any[];
  paidBills: any[];
  unpaidBills: any[];
  paidBillsRooms: { roomNumber: string; roomId: string; amount: number; exactAmount: string }[];
  unpaidBillsRooms: { roomNumber: string; roomId: string; amount: number; exactAmount: string }[];
}

const THAI_MONTH_ABBR: Record<string, string> = {
  '01': 'ม.ค.', '02': 'ก.พ.', '03': 'มี.ค.', '04': 'เม.ย.',
  '05': 'พ.ค.', '06': 'มิ.ย.', '07': 'ก.ค.', '08': 'ส.ค.',
  '09': 'ก.ย.', '10': 'ต.ค.', '11': 'พ.ย.', '12': 'ธ.ค.'
};

const THAI_MONTH_FULL: Record<string, string> = {
  '01': 'มกราคม', '02': 'กุมภาพันธ์', '03': 'มีนาคม', '04': 'เมษายน',
  '05': 'พฤษภาคม', '06': 'มิถุนายน', '07': 'กรกฎาคม', '08': 'สิงหาคม',
  '09': 'กันยายน', '10': 'ตุลาคม', '11': 'พฤศจิกายน', '12': 'ธันวาคม'
};

export function calculateOwnerReports(params: ReportCalculationParams): ReportCalculationResult {
  const rooms = params.rooms || [];
  const bills = params.bills || [];
  const contracts = params.contracts || [];
  const selectedBuilding = params.selectedBuilding || 'all';
  const currentYearStr = new Date().getFullYear().toString();

  // Authoritative cycle resolution
  const selectedBillingCycleId = params.selectedBillingCycleId || '';
  const selectedCycleCode = params.selectedCycleCode || '';
  const selectedCycle = params.selectedCycle || '';

  const selectedYear = params.selectedYear ||
    (selectedCycleCode ? selectedCycleCode.split('-')[0] :
    (selectedCycle && selectedCycle.length === 7 && selectedCycle.includes('-') ? selectedCycle.split('-')[0] : currentYearStr));

  // 1. Filtered rooms by selected building
  const filteredRooms = selectedBuilding === 'all'
    ? rooms
    : rooms.filter(r => r.buildingId === selectedBuilding);

  const filteredRoomIds = new Set(filteredRooms.map(r => r.id));

  // 2. Filtered bills by building
  const filteredBills = selectedBuilding === 'all'
    ? bills
    : bills.filter(b => filteredRoomIds.has(b.roomId));

  // 3. Current Month Bills — matches selectedBillingCycleId (authoritative UUID) or cycleCode/cycleId
  let currentMonthBills: any[];
  if (selectedBillingCycleId) {
    currentMonthBills = filteredBills.filter(b => b.billingCycleId === selectedBillingCycleId);
  } else if (selectedCycleCode) {
    currentMonthBills = filteredBills.filter(b =>
      b.cycleCode === selectedCycleCode ||
      b.cycleId === selectedCycleCode ||
      b.billingCycleId === selectedCycleCode
    );
  } else if (selectedCycle) {
    currentMonthBills = filteredBills.filter(b =>
      b.billingCycleId === selectedCycle ||
      b.cycleId === selectedCycle ||
      b.cycleCode === selectedCycle
    );
  } else {
    currentMonthBills = filteredBills;
  }

  const paidBills = currentMonthBills.filter(b => b.status === 'paid');
  const unpaidBills = currentMonthBills.filter(b => b.status !== 'paid');

  // 4. Occupancy stats
  const totalRooms = filteredRooms.length;
  const occupiedCount = filteredRooms.filter(r => r.status === 'occupied').length;
  const vacantCount = filteredRooms.filter(r => r.status === 'vacant').length;
  const reservedCount = filteredRooms.filter(r => r.status === 'reserved').length;
  const maintenanceCount = filteredRooms.filter(r => r.status === 'maintenance').length;

  // 5. Helper function to extract exact satangs per bill item category
  const getBillRentSatangs = (b: any): bigint => {
    const rentItem = b.items?.find((i: any) => i.category === 'rent' || i.type === 'rent' || i.description?.includes('ค่าเช่า'));
    return rentItem ? toSatangs(rentItem.amount) : toSatangs(b.rentAmount || 0);
  };

  const getBillWaterSatangs = (b: any): bigint => {
    const wItem = b.items?.find((i: any) => i.category === 'water' || i.type === 'water' || i.description?.includes('ค่าน้ำ'));
    return wItem ? toSatangs(wItem.amount) : toSatangs(b.waterAmount || 0);
  };

  const getBillElectricSatangs = (b: any): bigint => {
    const elItem = b.items?.find((i: any) => i.category === 'electricity' || i.category === 'electric' || i.type === 'electricity' || i.description?.includes('ค่าไฟ'));
    return elItem ? toSatangs(elItem.amount) : toSatangs(b.electricAmount || 0);
  };

  const getBillCommonSatangs = (b: any): bigint => {
    const commonItem = b.items?.find((i: any) => ['common_fee', 'common'].includes(i.category || i.type));
    return commonItem ? toSatangs(commonItem.amount) : toSatangs(b.commonFee || 0);
  };

  const getBillInternetSatangs = (b: any): bigint => {
    const internetItem = b.items?.find((i: any) => ['internet_fee', 'internet'].includes(i.category || i.type));
    return internetItem ? toSatangs(internetItem.amount) : toSatangs(b.internetFee || 0);
  };

  const getBillParkingSatangs = (b: any): bigint => {
    const pkItem = b.items?.find((i: any) => i.category === 'parking' || i.type === 'parking');
    return pkItem ? toSatangs(pkItem.amount) : toSatangs(b.parkingFee || 0);
  };

  const getBillOtherServiceSatangs = (b: any): bigint => {
    let feeSum = 0n;
    if (typeof b.otherFees === 'number' || typeof b.otherFees === 'string') {
      feeSum += toSatangs(b.otherFees);
    } else if (Array.isArray(b.otherFees)) {
      feeSum += b.otherFees.reduce((s: bigint, item: any): bigint => s + toSatangs(item?.amount), 0n);
    }
    const othItems: bigint = Array.isArray(b.items)
      ? b.items.filter((i: any) => ['other', 'repair', 'addon', 'cleaning'].includes(i?.category || i?.type))
          .reduce((s: bigint, i: any): bigint => s + toSatangs(i?.amount), 0n)
      : 0n;
    return feeSum + othItems;
  };

  const getBillFineSatangs = (b: any): bigint => {
    const fineItems: bigint = Array.isArray(b.items)
      ? b.items.filter((i: any) => i?.category === 'fine' || i?.type === 'fine')
          .reduce((s: bigint, i: any): bigint => s + toSatangs(i?.amount), 0n)
      : 0n;
    return fineItems + toSatangs(b.fineAmount || 0);
  };

  // 6. Current Month Authoritative Exact-Satang Aggregations
  const fixedRentSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillRentSatangs(b), 0n);
  const waterSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillWaterSatangs(b), 0n);
  const electricSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillElectricSatangs(b), 0n);
  const commonSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillCommonSatangs(b), 0n);
  const internetSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillInternetSatangs(b), 0n);
  const parkingSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillParkingSatangs(b), 0n);
  const commonParkingSatangs: bigint = commonSatangs + internetSatangs + parkingSatangs;
  const otherServiceSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillOtherServiceSatangs(b), 0n);
  const fineSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any) => sum + getBillFineSatangs(b), 0n);

  // Deposits
  const contractDepositSatangs: bigint = contracts
    .filter(c => c.status === 'active' || c.status === 'pending_signature')
    .reduce((sum: bigint, c: any): bigint => sum + toSatangs(c.depositAmount || 0), 0n);

  const roomDepositSatangs: bigint = filteredRooms
    .filter(r => r.status === 'occupied')
    .reduce((sum: bigint, r: any): bigint => sum + toSatangs(r.depositAmount || 0), 0n);

  const depositSatangs: bigint = contractDepositSatangs > 0n ? contractDepositSatangs : roomDepositSatangs;

  // Authoritative Total Billed, Revenue, Unpaid
  const sumBillsTotalSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);
  const sumCategoriesTotalSatangs: bigint = fixedRentSatangs + waterSatangs + electricSatangs + commonParkingSatangs + otherServiceSatangs + fineSatangs;
  const totalBilledSatangs: bigint = sumBillsTotalSatangs > 0n ? sumBillsTotalSatangs : sumCategoriesTotalSatangs;

  const totalRevenueSatangs: bigint = paidBills.reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.paidAmount || b.totalAmount), 0n);
  const totalUnpaidSatangs: bigint = totalBilledSatangs - totalRevenueSatangs;

  // Overdue Total
  const totalOverdueSatangs: bigint = filteredBills
    .filter(b => b.status === 'overdue')
    .reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);

  // 7. Month-by-Month Historical Revenue (01 to 12) for Charts & Yearly CSV
  const defaultMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthlyRevenueHistory: MonthlyRevenueHistoryItem[] = defaultMonths.map(m => {
    const cycleKey = `${selectedYear}-${m}`;
    const monthBills = filteredBills.filter(b => {
      if (b.cycleCode === cycleKey || b.cycleId === cycleKey) return true;
      if (b.billingCycle?.cycleCode === cycleKey) return true;
      if (b.billingDate) {
        const dStr = typeof b.billingDate === 'string' ? b.billingDate : b.billingDate.toISOString?.();
        if (dStr && dStr.startsWith(cycleKey)) return true;
      }
      return false;
    });

    const mRentSat = monthBills.reduce((s: bigint, b: any) => s + getBillRentSatangs(b), 0n);
    const mWaterSat = monthBills.reduce((s: bigint, b: any) => s + getBillWaterSatangs(b), 0n);
    const mElecSat = monthBills.reduce((s: bigint, b: any) => s + getBillElectricSatangs(b), 0n);
    const mCommonSat = monthBills.reduce((s: bigint, b: any) => s + getBillCommonSatangs(b), 0n);
    const mInternetSat = monthBills.reduce((s: bigint, b: any) => s + getBillInternetSatangs(b), 0n);
    const mParkingSat = monthBills.reduce((s: bigint, b: any) => s + getBillParkingSatangs(b), 0n);
    const mCommonParkingSat = mCommonSat + mInternetSat + mParkingSat;
    const mOtherSat = monthBills.reduce((s: bigint, b: any) => s + getBillOtherServiceSatangs(b), 0n);
    const mFineSat = monthBills.reduce((s: bigint, b: any) => s + getBillFineSatangs(b), 0n);

    const mSumBillsSat = monthBills.reduce((s: bigint, b: any) => s + toSatangs(b.totalAmount), 0n);
    const mSumCatSat = mRentSat + mWaterSat + mElecSat + mCommonParkingSat + mOtherSat + mFineSat;
    const mTotalSat = mSumBillsSat > 0n ? mSumBillsSat : mSumCatSat;

    // Combined other for chart: common/parking + other + fine
    const mChartOtherSat = mCommonParkingSat + mOtherSat + mFineSat;

    return {
      cycleId: cycleKey,
      monthKey: m,
      name: THAI_MONTH_ABBR[m] || m,
      fullName: THAI_MONTH_FULL[m] || m,
      exactRent: satangsToString(mRentSat),
      exactWater: satangsToString(mWaterSat),
      exactElec: satangsToString(mElecSat),
      exactCommonParking: satangsToString(mCommonParkingSat),
      exactOther: satangsToString(mChartOtherSat),
      exactFine: satangsToString(mFineSat),
      exactTotal: satangsToString(mTotalSat),
      rent: satangsToNumber(mRentSat),
      water: satangsToNumber(mWaterSat),
      elec: satangsToNumber(mElecSat),
      commonParking: satangsToNumber(mCommonParkingSat),
      other: satangsToNumber(mChartOtherSat),
      fine: satangsToNumber(mFineSat),
      total: satangsToNumber(mTotalSat),
    };
  });

  // Year Total is sum of exact satangs from all months in selectedYear
  const yearBilledSatangs: bigint = monthlyRevenueHistory.reduce(
    (sum: bigint, m) => sum + toSatangs(m.exactTotal),
    0n
  );

  // ARPU
  const arpuSatangs: bigint = occupiedCount > 0 ? (totalBilledSatangs / BigInt(occupiedCount)) : 0n;

  // Breakdown Percentages
  const totalBreakdownSatangs = totalBilledSatangs + depositSatangs;
  const calcPct = (catSatangs: bigint): number => {
    if (totalBreakdownSatangs <= 0n) return 0;
    const tenths = Number((catSatangs * 1000n) / totalBreakdownSatangs);
    return tenths / 10;
  };

  const breakdownPercentages: BreakdownPercentages = {
    rentPct: calcPct(fixedRentSatangs),
    waterPct: calcPct(waterSatangs),
    elecPct: calcPct(electricSatangs),
    commonParkingPct: calcPct(commonParkingSatangs),
    otherPct: calcPct(otherServiceSatangs),
    finePct: calcPct(fineSatangs),
    depositPct: calcPct(depositSatangs),
  };

  // Percentages
  const paidPercent = totalBilledSatangs > 0n ? Number((totalRevenueSatangs * 100n) / totalBilledSatangs) : 0;
  const unpaidPercent = totalBilledSatangs > 0n ? 100 - paidPercent : 0;
  const occupiedPercent = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;
  const vacantPercent = totalRooms > 0 ? Math.round((vacantCount / totalRooms) * 100) : 0;

  // Paid and Unpaid Bills Room Lists (sorted)
  const paidBillsRooms = paidBills.map(b => {
    const r = rooms.find(room => room.id === b.roomId);
    const sat = toSatangs(b.totalAmount);
    return {
      roomNumber: r ? r.roomNumber : 'ไม่ระบุ',
      roomId: b.roomId,
      amount: satangsToNumber(sat),
      exactAmount: satangsToString(sat),
    };
  }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

  const unpaidBillsRooms = unpaidBills.map(b => {
    const r = rooms.find(room => room.id === b.roomId);
    const sat = toSatangs(b.totalAmount);
    return {
      roomNumber: r ? r.roomNumber : 'ไม่ระบุ',
      roomId: b.roomId,
      amount: satangsToNumber(sat),
      exactAmount: satangsToString(sat),
    };
  }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

  return {
    totalRooms,
    occupiedCount,
    vacantCount,
    reservedCount,
    maintenanceCount,
    occupiedPercent,
    vacantPercent,

    // Authoritative Exact String Outputs
    exactFixedRentTotal: satangsToString(fixedRentSatangs),
    exactWaterTotal: satangsToString(waterSatangs),
    exactElectricTotal: satangsToString(electricSatangs),
    exactCommonParkingTotal: satangsToString(commonParkingSatangs),
    exactCommonTotal: satangsToString(commonSatangs),
    exactInternetTotal: satangsToString(internetSatangs),
    exactParkingTotal: satangsToString(parkingSatangs),
    exactOtherServiceTotal: satangsToString(otherServiceSatangs),
    exactFineTotal: satangsToString(fineSatangs),
    exactDepositTotal: satangsToString(depositSatangs),
    exactTotalBilledThisMonth: satangsToString(totalBilledSatangs),
    exactTotalRevenueThisMonth: satangsToString(totalRevenueSatangs),
    exactTotalUnpaidThisMonth: satangsToString(totalUnpaidSatangs),
    exactTotalOverdueAmount: satangsToString(totalOverdueSatangs),
    exactTotalBilledPlusDeposit: satangsToString(totalBreakdownSatangs),
    exactYearBilledTotal: satangsToString(yearBilledSatangs),
    exactArpu: satangsToString(arpuSatangs),

    // Presentation Numbers (derived safely from exact satangs)
    fixedRentTotal: satangsToNumber(fixedRentSatangs),
    waterTotal: satangsToNumber(waterSatangs),
    electricTotal: satangsToNumber(electricSatangs),
    commonParkingTotal: satangsToNumber(commonParkingSatangs),
    commonTotal: satangsToNumber(commonSatangs),
    internetTotal: satangsToNumber(internetSatangs),
    parkingTotal: satangsToNumber(parkingSatangs),
    otherServiceTotal: satangsToNumber(otherServiceSatangs),
    fineTotal: satangsToNumber(fineSatangs),
    depositTotal: satangsToNumber(depositSatangs),
    totalBilledThisMonth: satangsToNumber(totalBilledSatangs),
    totalRevenueThisMonth: satangsToNumber(totalRevenueSatangs),
    totalUnpaidThisMonth: satangsToNumber(totalUnpaidSatangs),
    totalOverdueAmount: satangsToNumber(totalOverdueSatangs),
    totalBilledPlusDeposit: satangsToNumber(totalBreakdownSatangs),
    paidPercent,
    unpaidPercent,
    arpu: satangsToNumber(arpuSatangs),
    yearBilledTotal: satangsToNumber(yearBilledSatangs),

    monthlyRevenueHistory,
    breakdownPercentages,

    filteredRooms,
    filteredBills,
    currentMonthBills,
    paidBills,
    unpaidBills,
    paidBillsRooms,
    unpaidBillsRooms,
  };
}
