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
  selectedCycle?: string;
  selectedYear?: string;
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
  paidPercent: number;
  unpaidPercent: number;
  arpu: number;
  yearBilledTotal: number;

  // Filtered Collections
  filteredRooms: any[];
  filteredBills: any[];
  currentMonthBills: any[];
  paidBills: any[];
  unpaidBills: any[];
  paidBillsRooms: { roomNumber: string; roomId: string; amount: number; exactAmount: string }[];
  unpaidBillsRooms: { roomNumber: string; roomId: string; amount: number; exactAmount: string }[];
}

export function calculateOwnerReports(params: ReportCalculationParams): ReportCalculationResult {
  const rooms = params.rooms || [];
  const bills = params.bills || [];
  const contracts = params.contracts || [];
  const selectedBuilding = params.selectedBuilding || 'all';
  const selectedCycle = params.selectedCycle || '';
  const currentYearStr = new Date().getFullYear().toString();
  const selectedYear = params.selectedYear || (selectedCycle ? selectedCycle.split('-')[0] : currentYearStr);

  // 1. Filtered rooms by selected building
  const filteredRooms = selectedBuilding === 'all'
    ? rooms
    : rooms.filter(r => r.buildingId === selectedBuilding);

  const filteredRoomIds = new Set(filteredRooms.map(r => r.id));

  // 2. Filtered bills by building
  const filteredBills = selectedBuilding === 'all'
    ? bills
    : bills.filter(b => filteredRoomIds.has(b.roomId));

  // 3. Current Month Bills — matches cycleId or billingCycleId
  const currentMonthBills = selectedCycle
    ? filteredBills.filter(b => b.cycleId === selectedCycle || b.billingCycleId === selectedCycle)
    : filteredBills;

  const paidBills = currentMonthBills.filter(b => b.status === 'paid');
  const unpaidBills = currentMonthBills.filter(b => b.status !== 'paid');

  // 4. Occupancy stats
  const totalRooms = filteredRooms.length;
  const occupiedCount = filteredRooms.filter(r => r.status === 'occupied').length;
  const vacantCount = filteredRooms.filter(r => r.status === 'vacant').length;
  const reservedCount = filteredRooms.filter(r => r.status === 'reserved').length;
  const maintenanceCount = filteredRooms.filter(r => r.status === 'maintenance').length;

  // 5. Authoritative Exact-Satang Aggregations
  // 5.1 Fixed Rent
  const fixedRentSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const rentItem = b.items?.find((i: any) => i.category === 'rent' || i.type === 'rent');
    return sum + (rentItem ? toSatangs(rentItem.amount) : toSatangs(b.rentAmount || 0));
  }, 0n);

  // 5.2 Water
  const waterSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const wItem = b.items?.find((i: any) => i.category === 'water' || i.type === 'water');
    return sum + (wItem ? toSatangs(wItem.amount) : toSatangs(b.waterAmount || 0));
  }, 0n);

  // 5.3 Electricity
  const electricSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const elItem = b.items?.find((i: any) => i.category === 'electricity' || i.type === 'electricity');
    return sum + (elItem ? toSatangs(elItem.amount) : toSatangs(b.electricAmount || 0));
  }, 0n);

  // 5.4 Common, Internet, Parking
  const commonSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const commonItem = b.items?.find((i: any) => ['common_fee', 'common'].includes(i.category || i.type));
    return sum + (commonItem ? toSatangs(commonItem.amount) : toSatangs(b.commonFee || 0));
  }, 0n);

  const internetSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const internetItem = b.items?.find((i: any) => ['internet_fee', 'internet'].includes(i.category || i.type));
    return sum + (internetItem ? toSatangs(internetItem.amount) : toSatangs(b.internetFee || 0));
  }, 0n);

  const parkingSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const pkItem = b.items?.find((i: any) => i.category === 'parking' || i.type === 'parking');
    return sum + (pkItem ? toSatangs(pkItem.amount) : toSatangs(b.parkingFee || 0));
  }, 0n);

  const commonParkingSatangs: bigint = commonSatangs + internetSatangs + parkingSatangs;

  // 5.5 Other Services
  const calcOtherFeesSatangs = (b: any): bigint => {
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

  const otherServiceSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => sum + calcOtherFeesSatangs(b), 0n);

  // 5.6 Fines
  const fineSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => {
    const fineItems: bigint = Array.isArray(b.items)
      ? b.items.filter((i: any) => i?.category === 'fine' || i?.type === 'fine')
          .reduce((s: bigint, i: any): bigint => s + toSatangs(i?.amount), 0n)
      : 0n;
    return sum + fineItems + toSatangs(b.fineAmount || 0);
  }, 0n);

  // 5.7 Deposits
  const contractDepositSatangs: bigint = contracts
    .filter(c => c.status === 'active' || c.status === 'pending_signature')
    .reduce((sum: bigint, c: any): bigint => sum + toSatangs(c.depositAmount || 0), 0n);

  const roomDepositSatangs: bigint = filteredRooms
    .filter(r => r.status === 'occupied')
    .reduce((sum: bigint, r: any): bigint => sum + toSatangs(r.depositAmount || 0), 0n);

  const depositSatangs: bigint = contractDepositSatangs > 0n ? contractDepositSatangs : roomDepositSatangs;

  // 5.8 Authoritative Total Billed, Revenue, Unpaid
  const sumBillsTotalSatangs: bigint = currentMonthBills.reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);
  const sumCategoriesTotalSatangs: bigint = fixedRentSatangs + waterSatangs + electricSatangs + commonParkingSatangs + otherServiceSatangs + fineSatangs;
  const totalBilledSatangs: bigint = sumBillsTotalSatangs > 0n ? sumBillsTotalSatangs : sumCategoriesTotalSatangs;

  const totalRevenueSatangs: bigint = paidBills.reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.paidAmount || b.totalAmount), 0n);
  const totalUnpaidSatangs: bigint = totalBilledSatangs - totalRevenueSatangs;

  // 5.9 Overdue Total
  const totalOverdueSatangs: bigint = filteredBills
    .filter(b => b.status === 'overdue')
    .reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);

  // 5.10 Year Total
  const yearBilledSatangs: bigint = filteredBills
    .filter(b => (b.cycleId && b.cycleId.startsWith(selectedYear)) || (b.cycleCode && b.cycleCode.startsWith(selectedYear)))
    .reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);

  // 5.11 ARPU
  const arpuSatangs: bigint = occupiedCount > 0 ? (totalBilledSatangs / BigInt(occupiedCount)) : 0n;

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
    paidPercent,
    unpaidPercent,
    arpu: satangsToNumber(arpuSatangs),
    yearBilledTotal: satangsToNumber(yearBilledSatangs),

    filteredRooms,
    filteredBills,
    currentMonthBills,
    paidBills,
    unpaidBills,
    paidBillsRooms,
    unpaidBillsRooms,
  };
}
