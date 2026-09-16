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
  repairs?: any[];
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
  exactCommon?: string;
  exactInternet?: string;
  exactParking?: string;
  exactOther: string;
  exactFine: string;
  exactDiscount?: string;
  exactTotal: string;
  exactRepairCost?: string;
  exactDepositRefund?: string;
  rent: number;
  water: number;
  elec: number;
  commonParking: number;
  common?: number;
  internet?: number;
  parking?: number;
  other: number;
  fine: number;
  discount?: number;
  total: number;
  repairCost?: number;
  depositRefund?: number;
}

export interface BreakdownPercentages {
  rentPct: number;
  waterPct: number;
  elecPct: number;
  commonParkingPct: number;
  commonPct?: number;
  internetPct?: number;
  parkingPct?: number;
  otherPct: number;
  finePct: number;
  discountPct?: number;
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
  exactDiscountTotal: string;
  exactDepositTotal: string;
  exactDepositRefundTotal: string;
  exactTotalBilledThisMonth: string;
  exactTotalRevenueThisMonth: string;
  exactTotalUnpaidThisMonth: string;
  exactTotalOverdueAmount: string;
  exactTotalBilledPlusDeposit: string;
  exactYearBilledTotal: string;
  exactArpu: string;
  exactTotalRepairCostThisMonth: string;
  exactTotalRepairCostYear: string;
  exactNetIncomeThisMonth: string;
  exactVatTotal?: string;

  // Presentation Monetary Values (Numbers for charts/UI, computed from exact satangs)
  fixedRentTotal: number;
  waterTotal: number;
  electricTotal: number;
  commonParkingTotal: number;
  commonTotal: number;
  internetTotal: number;
  parkingTotal: number;
  otherServiceTotal: number;
  vatTotal?: number;
  fineTotal: number;
  discountTotal: number;
  depositTotal: number;
  depositRefundTotal: number;
  totalBilledThisMonth: number;
  totalRevenueThisMonth: number;
  totalUnpaidThisMonth: number;
  totalOverdueAmount: number;
  totalBilledPlusDeposit: number;
  totalRepairCostThisMonth: number;
  totalRepairCostYear: number;
  repairsCountThisMonth: number;
  repairsCountYear: number;
  netIncomeThisMonth: number;
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

/**
 * Determines if a PAID bill was settled by imported pre-HorPlus payment evidence.
 * 
 * Invariant (Q7=A / Round 2.4B):
 * - Historical obligation (BillItem.metadata.isHistoricalImport) represents the pre-HorPlus origin of the DEBT.
 * - Historical payment import (Payment.metadata.isHistoricalImport) represents money already PAID before HorPlus.
 * - A Bill is excluded from revenue/collection metrics ONLY when its settled payments are imported pre-HorPlus payments.
 * - A historical debt settled via a LIVE HorPlus payment (Payment.metadata.isHistoricalImport !== true) MUST be included in the bill's cycle revenue.
 */
export const isHistoricalPaidBill = (b: any): boolean => {
  if (!b) return false;
  const isPaid = (b.status || '').toLowerCase() === 'paid';
  if (!isPaid) return false;

  // 1. If explicit Payment records are populated on the Bill:
  if (Array.isArray(b.Payment) && b.Payment.length > 0) {
    const approvedPayments = b.Payment.filter((p: any) => {
      const s = (p.status || '').toUpperCase();
      return !s || s === 'APPROVED' || s === 'COMPLETED';
    });
    if (approvedPayments.length > 0) {
      // Must be settled exclusively by historical imported payments
      return approvedPayments.every((p: any) =>
        p?.metadata?.isHistoricalImport === true ||
        (p?.metadata && typeof p.metadata === 'object' && (p.metadata as any).isHistoricalImport === true) ||
        p?.isHistoricalImport === true
      );
    }
  }

  // 2. Direct Payment-level flag on the bill if Payment array is unpopulated:
  const isDirectPaymentFlag = Boolean(
    b.isHistoricalPaymentImport ||
    b.metadata?.isHistoricalPaymentImport
  );

  return isDirectPaymentFlag;
};

export const isPreHorPlusPaidBill = isHistoricalPaidBill;

export function calculateOwnerReports(params: ReportCalculationParams): ReportCalculationResult {
  const rooms = params.rooms || [];
  const bills = params.bills || [];
  const contracts = params.contracts || [];
  const selectedBuilding = params.selectedBuilding || 'all';
  const currentYearStr = new Date().getFullYear().toString();
  const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');

  // Authoritative cycle resolution
  const selectedBillingCycleId = params.selectedBillingCycleId || '';
  const selectedCycleCode = params.selectedCycleCode || '';
  const selectedCycle = params.selectedCycle || '';

  const selectedYear = params.selectedYear ||
    (selectedCycleCode ? selectedCycleCode.split('-')[0] :
    (selectedCycle && selectedCycle.length === 7 && selectedCycle.includes('-') ? selectedCycle.split('-')[0] : currentYearStr));

  const effectiveCyclePrefix = selectedCycleCode
    ? selectedCycleCode.slice(0, 7)
    : (selectedCycle && selectedCycle.length === 7 && selectedCycle.includes('-') ? selectedCycle.slice(0, 7) : `${currentYearStr}-${currentMonthStr}`);

  // 1. Filtered rooms by selected building
  const filteredRooms = selectedBuilding === 'all'
    ? rooms
    : (selectedBuilding === 'unspecified'
        ? rooms.filter(r => !r.buildingId)
        : rooms.filter(r => r.buildingId === selectedBuilding));

  const filteredRoomIds = new Set(filteredRooms.map(r => r.id).filter(Boolean));
  const filteredRoomNumbers = new Set(filteredRooms.map(r => r.roomNumber).filter(Boolean));

  // 2. Filtered bills by building
  const filteredBills = selectedBuilding === 'all'
    ? bills
    : bills.filter(b => {
        if (b.roomId && filteredRoomIds.has(b.roomId)) return true;
        if (b.roomId && filteredRoomNumbers.has(b.roomId)) return true;
        if (b.roomNumber && filteredRoomNumbers.has(b.roomNumber)) return true;
        return false;
      });

  // 3. Current Month Bills — matches selectedBillingCycleId (authoritative UUID) or cycleCode/cycleId
  let currentMonthBills: any[];
  if (selectedBillingCycleId) {
    currentMonthBills = filteredBills.filter(b => b.billingCycleId === selectedBillingCycleId);
  } else if (selectedCycleCode) {
    currentMonthBills = filteredBills.filter(b =>
      b.cycleCode === selectedCycleCode ||
      b.cycleId === selectedCycleCode ||
      b.billingCycleId === selectedCycleCode ||
      b.billingCycle?.cycleCode === selectedCycleCode
    );
  } else if (selectedCycle) {
    currentMonthBills = filteredBills.filter(b =>
      b.billingCycleId === selectedCycle ||
      b.cycleId === selectedCycle ||
      b.cycleCode === selectedCycle ||
      b.billingCycle?.cycleCode === selectedCycle
    );
  } else {
    currentMonthBills = filteredBills;
  }

  const revenueActiveBills = currentMonthBills.filter(b => !isHistoricalPaidBill(b));
  const paidBills = revenueActiveBills.filter(b => (b.status || '').toLowerCase() === 'paid');
  const unpaidBills = currentMonthBills.filter(b => (b.status || '').toLowerCase() !== 'paid');

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
    // 1. Authoritative BillItems if present
    const othItems: bigint = Array.isArray(b.items)
      ? b.items
          .filter((i: any) => {
            const t = (i?.type || i?.category || '').toLowerCase();
            const d = (i?.description || '').toLowerCase();
            // Exclude negative deposit credits or rent discount lines
            if (toSatangs(i?.amount) < 0n || d.includes('หักชำระจากเงินประกัน') || d.includes('เงินประกัน')) {
              return false;
            }
            return (
              ['other', 'other_fee', 'other_fees', 'repair', 'addon', 'cleaning'].includes(t) ||
              d.includes('ค่าใช้จ่ายอื่น') ||
              d.includes('ก่อนย้ายออก') ||
              d.includes('ค่าบริการ')
            );
          })
          .reduce((s: bigint, i: any): bigint => s + toSatangs(i?.amount), 0n)
      : 0n;

    if (othItems > 0n) {
      return othItems;
    }

    // 2. Fallback to header or snapshot otherFees if items array is empty/unpopulated
    let feeSum = 0n;
    if (typeof b.otherFees === 'number' || typeof b.otherFees === 'string') {
      feeSum += toSatangs(b.otherFees);
    } else if (Array.isArray(b.otherFees)) {
      feeSum += b.otherFees.reduce((s: bigint, item: any): bigint => s + toSatangs(item?.amount), 0n);
    } else if (b.otherAmount !== undefined && b.otherAmount !== null) {
      feeSum += toSatangs(b.otherAmount);
    }
    return feeSum;
  };

  const getBillFineSatangs = (b: any): bigint => {
    // 1. Authoritative BillItems if present
    const fineItems: bigint = Array.isArray(b.items)
      ? b.items
          .filter((i: any) => {
            const t = (i?.type || i?.category || '').toLowerCase();
            const d = (i?.description || '').toLowerCase();
            return (
              ['fine', 'late_fee', 'late_fine'].includes(t) ||
              d.includes('ค่าปรับ') ||
              d.includes('ล่าช้า')
            );
          })
          .reduce((s: bigint, i: any): bigint => s + toSatangs(i?.amount), 0n)
      : 0n;

    if (fineItems > 0n) {
      return fineItems;
    }

    // 2. Fallback to header fineAmount if items array is empty/unpopulated
    return toSatangs(b.fineAmount || 0);
  };

  const getBillDiscountSatangs = (b: any): bigint => {
    // 1. Authoritative BillItems if present
    const discItems: bigint = Array.isArray(b.items)
      ? b.items
          .filter((i: any) => {
            const t = (i?.type || i?.category || '').toLowerCase();
            const d = (i?.description || '').toLowerCase();
            return t === 'discount' || d.includes('ส่วนลด') || d.includes('โปรโมชั่น');
          })
          .reduce((s: bigint, i: any): bigint => s + toSatangs(Math.abs(Number(i?.amount || 0))), 0n)
      : 0n;

    if (discItems > 0n) {
      return discItems;
    }

    // 2. Fallback to header discountAmount if items array is empty/unpopulated
    return toSatangs(Math.abs(Number(b.discountAmount || 0)));
  };

  // 6. Current Month Authoritative Exact-Satang Aggregations
  const fixedRentSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillRentSatangs(b), 0n);
  const waterSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillWaterSatangs(b), 0n);
  const electricSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillElectricSatangs(b), 0n);
  const commonSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillCommonSatangs(b), 0n);
  const internetSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillInternetSatangs(b), 0n);
  const parkingSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillParkingSatangs(b), 0n);
  const commonParkingSatangs: bigint = commonSatangs + internetSatangs + parkingSatangs;
  const otherServiceSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillOtherServiceSatangs(b), 0n);
  const fineSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillFineSatangs(b), 0n);
  const discountSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any) => sum + getBillDiscountSatangs(b), 0n);

  // Deposits: contracts filtered by selected building
  const filteredContracts = selectedBuilding === 'all'
    ? contracts
    : contracts.filter(c => {
        const contractRoomId = c.roomId || c.room?.id;
        const contractRoomNumber = c.roomNumber || c.room?.roomNumber;
        if (contractRoomId && (filteredRoomIds.has(contractRoomId) || filteredRoomNumbers.has(contractRoomId))) return true;
        if (contractRoomNumber && filteredRoomNumbers.has(contractRoomNumber)) return true;
        return false;
      });

  const contractDepositSatangs: bigint = filteredContracts
    .filter(c => c.status === 'active' || c.status === 'pending_signature')
    .reduce((sum: bigint, c: any): bigint => sum + toSatangs(c.depositAmount || 0), 0n);

  const roomDepositSatangs: bigint = filteredRooms
    .filter(r => r.status === 'occupied')
    .reduce((sum: bigint, r: any): bigint => sum + toSatangs(r.depositAmount || 0), 0n);

  const depositSatangs: bigint = contractDepositSatangs > 0n ? contractDepositSatangs : roomDepositSatangs;

  // Deposit refunds from contracts terminated in current cycle (matches effectiveCyclePrefix)
  const terminatedContractsInCycle = filteredContracts.filter((c: any) => {
    if (c.status !== 'terminated') return false;
    const termDate = c.terminationEffectiveDate || c.terminatedAt || c.settlementSummary?.terminatedAt || c.endDate;
    const termDateStr = typeof termDate === 'string'
      ? termDate
      : termDate instanceof Date
      ? termDate.toISOString()
      : '';
    return termDateStr.startsWith(effectiveCyclePrefix);
  });

  const depositRefundSatangs: bigint = terminatedContractsInCycle.reduce(
    (sum: bigint, c: any): bigint => {
      const refundAmt = c.settlementSummary?.depositRefundAmount || c.depositRefundAmount || 0;
      return sum + toSatangs(refundAmt);
    },
    0n
  );

  // Authoritative VAT Calculation across revenue active bills
  const totalVatSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any): bigint => {
    if (b.vatAmount !== undefined && b.vatAmount !== null) {
      return sum + toSatangs(b.vatAmount);
    }
    if (Array.isArray(b.items)) {
      const itemVat = b.items.reduce((iSum: bigint, it: any) => {
        return it.metadata?.vatAmount ? iSum + toSatangs(it.metadata.vatAmount) : iSum;
      }, 0n);
      if (itemVat > 0n) return sum + itemVat;
    }
    return sum;
  }, 0n);

  // Authoritative Total Billed, Revenue, Unpaid
  const sumBillsTotalSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any): bigint => sum + toSatangs(b.totalAmount), 0n);
  const sumCategoriesTotalSatangs: bigint = fixedRentSatangs + waterSatangs + electricSatangs + commonParkingSatangs + otherServiceSatangs + fineSatangs + totalVatSatangs - discountSatangs;
  const totalBilledSatangs: bigint = sumBillsTotalSatangs > 0n ? sumBillsTotalSatangs : sumCategoriesTotalSatangs;

  const totalRevenueSatangs: bigint = revenueActiveBills.reduce((sum: bigint, b: any): bigint => {
    const s = (b.status || '').toLowerCase();
    if (s === 'paid') {
      return sum + toSatangs(b.paidAmount || b.totalAmount);
    }
    if (s === 'partially_paid' || s === 'partial') {
      return sum + toSatangs(b.paidAmount || 0);
    }
    return sum;
  }, 0n);

  const totalUnpaidSatangs: bigint = totalBilledSatangs > totalRevenueSatangs ? totalBilledSatangs - totalRevenueSatangs : 0n;

  // Overdue Total: checks explicit status === 'overdue' OR unpaid bills whose dueDate (+ grace period) has passed
  const now = new Date();
  const totalOverdueSatangs: bigint = filteredBills
    .filter(b => {
      const s = (b.status || '').toLowerCase();
      if (s === 'paid' || s === 'cancelled' || s === 'void') return false;
      if (s === 'overdue') return true;
      if (b.dueDate) {
        const due = new Date(b.dueDate);
        const graceDays = Number(b.rateSnapshot?.gracePeriodDays ?? 2);
        const graceEnd = new Date(due.getTime() + graceDays * 24 * 60 * 60 * 1000);
        if (now > graceEnd) return true;
      }
      return false;
    })
    .reduce((sum: bigint, b: any): bigint => {
      const outstanding = b.outstandingAmount !== undefined ? toSatangs(b.outstandingAmount) : (toSatangs(b.totalAmount) - toSatangs(b.paidAmount || 0));
      return sum + (outstanding > 0n ? outstanding : toSatangs(b.totalAmount));
    }, 0n);

  // 6.5. Maintenance Repair Expenses Aggregation
  const rawRepairs = params.repairs || [];
  const filteredRepairs = selectedBuilding === 'all'
    ? rawRepairs
    : rawRepairs.filter(r => {
        if (r.buildingId && r.buildingId === selectedBuilding) return true;
        if (r.roomId && (filteredRoomIds.has(r.roomId) || filteredRoomNumbers.has(r.roomId))) return true;
        return false;
      });

  const getRepairIsoString = (r: any): string => {
    if (!r) return '';
    if (typeof r.createdAt === 'string') return r.createdAt;
    if (r.createdAt instanceof Date) return r.createdAt.toISOString();
    if (r.createdAt?.toISOString && typeof r.createdAt.toISOString === 'function') {
      return r.createdAt.toISOString();
    }
    return '';
  };

  const currentMonthRepairs = filteredRepairs.filter(r => {
    const dStr = getRepairIsoString(r);
    return dStr.startsWith(effectiveCyclePrefix);
  });

  const repairCostThisMonthSatangs = currentMonthRepairs.reduce((s: bigint, r: any) => s + toSatangs(r.cost || 0), 0n);
  const repairsCountThisMonth = currentMonthRepairs.length;

  const yearRepairs = filteredRepairs.filter(r => {
    const dStr = getRepairIsoString(r);
    return dStr.startsWith(selectedYear);
  });

  const repairCostYearSatangs = yearRepairs.reduce((s: bigint, r: any) => s + toSatangs(r.cost || 0), 0n);
  const repairsCountYear = yearRepairs.length;

  const netIncomeThisMonthSatangs = totalRevenueSatangs - repairCostThisMonthSatangs - depositRefundSatangs;

  // 7. Month-by-Month Historical Revenue (01 to 12) for Charts & Yearly CSV
  const defaultMonths = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
  const monthlyRevenueHistory: MonthlyRevenueHistoryItem[] = defaultMonths.map(m => {
    const cycleKey = `${selectedYear}-${m}`;
    const monthBills = filteredBills
      .filter(b => {
        if (b.cycleCode === cycleKey || b.cycleId === cycleKey) return true;
        if (b.billingCycle?.cycleCode === cycleKey) return true;
        if (b.billingDate) {
          const dStr = typeof b.billingDate === 'string' ? b.billingDate : b.billingDate.toISOString?.();
          if (dStr && dStr.startsWith(cycleKey)) return true;
        }
        return false;
      })
      .filter(b => !isPreHorPlusPaidBill(b));

    const mRentSat = monthBills.reduce((s: bigint, b: any) => s + getBillRentSatangs(b), 0n);
    const mWaterSat = monthBills.reduce((s: bigint, b: any) => s + getBillWaterSatangs(b), 0n);
    const mElecSat = monthBills.reduce((s: bigint, b: any) => s + getBillElectricSatangs(b), 0n);
    const mCommonSat = monthBills.reduce((s: bigint, b: any) => s + getBillCommonSatangs(b), 0n);
    const mInternetSat = monthBills.reduce((s: bigint, b: any) => s + getBillInternetSatangs(b), 0n);
    const mParkingSat = monthBills.reduce((s: bigint, b: any) => s + getBillParkingSatangs(b), 0n);
    const mCommonParkingSat = mCommonSat + mInternetSat + mParkingSat;
    const mOtherSat = monthBills.reduce((s: bigint, b: any) => s + getBillOtherServiceSatangs(b), 0n);
    const mFineSat = monthBills.reduce((s: bigint, b: any) => s + getBillFineSatangs(b), 0n);
    const mDiscountSat = monthBills.reduce((s: bigint, b: any) => s + getBillDiscountSatangs(b), 0n);

    const mSumBillsSat = monthBills.reduce((s: bigint, b: any) => s + toSatangs(b.totalAmount), 0n);
    const mSumCatSat = mRentSat + mWaterSat + mElecSat + mCommonParkingSat + mOtherSat + mFineSat - mDiscountSat;
    const mTotalSat = mSumBillsSat > 0n ? mSumBillsSat : mSumCatSat;

    // Combined other for chart: common/parking + other + fine
    const mChartOtherSat = mCommonParkingSat + mOtherSat + mFineSat;

    const monthRepairs = filteredRepairs.filter(r => {
      const dStr = getRepairIsoString(r);
      return dStr.startsWith(cycleKey);
    });
    const mRepairSat = monthRepairs.reduce((s: bigint, r: any) => s + toSatangs(r.cost || 0), 0n);

    const monthTerminatedContracts = filteredContracts.filter((c: any) => {
      if (c.status !== 'terminated') return false;
      const termDate = c.terminationEffectiveDate || c.terminatedAt || c.settlementSummary?.terminatedAt || c.endDate;
      const termDateStr = typeof termDate === 'string'
        ? termDate
        : termDate instanceof Date
        ? termDate.toISOString()
        : '';
      return termDateStr.startsWith(cycleKey);
    });
    const mDepositRefundSat = monthTerminatedContracts.reduce(
      (sum: bigint, c: any): bigint => {
        const refundAmt = c.settlementSummary?.depositRefundAmount || c.depositRefundAmount || 0;
        return sum + toSatangs(refundAmt);
      },
      0n
    );

    return {
      cycleId: cycleKey,
      monthKey: m,
      name: THAI_MONTH_ABBR[m] || m,
      fullName: THAI_MONTH_FULL[m] || m,
      exactRent: satangsToString(mRentSat),
      exactWater: satangsToString(mWaterSat),
      exactElec: satangsToString(mElecSat),
      exactCommonParking: satangsToString(mCommonParkingSat),
      exactCommon: satangsToString(mCommonSat),
      exactInternet: satangsToString(mInternetSat),
      exactParking: satangsToString(mParkingSat),
      exactOther: satangsToString(mChartOtherSat),
      exactFine: satangsToString(mFineSat),
      exactDiscount: satangsToString(mDiscountSat),
      exactTotal: satangsToString(mTotalSat),
      exactRepairCost: satangsToString(mRepairSat),
      exactDepositRefund: satangsToString(mDepositRefundSat),
      rent: satangsToNumber(mRentSat),
      water: satangsToNumber(mWaterSat),
      elec: satangsToNumber(mElecSat),
      commonParking: satangsToNumber(mCommonParkingSat),
      common: satangsToNumber(mCommonSat),
      internet: satangsToNumber(mInternetSat),
      parking: satangsToNumber(mParkingSat),
      other: satangsToNumber(mChartOtherSat),
      fine: satangsToNumber(mFineSat),
      discount: satangsToNumber(mDiscountSat),
      total: satangsToNumber(mTotalSat),
      repairCost: satangsToNumber(mRepairSat),
      depositRefund: satangsToNumber(mDepositRefundSat),
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
  const grossBreakdownSatangs = totalBilledSatangs + depositSatangs;
  const totalBreakdownSatangs = grossBreakdownSatangs >= depositRefundSatangs
    ? grossBreakdownSatangs - depositRefundSatangs
    : 0n;
  const calcPct = (catSatangs: bigint): number => {
    if (grossBreakdownSatangs <= 0n) return 0;
    const tenths = Number((catSatangs * 1000n) / grossBreakdownSatangs);
    return tenths / 10;
  };

  const breakdownPercentages: BreakdownPercentages = {
    rentPct: calcPct(fixedRentSatangs),
    waterPct: calcPct(waterSatangs),
    elecPct: calcPct(electricSatangs),
    commonParkingPct: calcPct(commonParkingSatangs),
    commonPct: calcPct(commonSatangs),
    internetPct: calcPct(internetSatangs),
    parkingPct: calcPct(parkingSatangs),
    otherPct: calcPct(otherServiceSatangs),
    finePct: calcPct(fineSatangs),
    discountPct: calcPct(discountSatangs),
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
    exactDiscountTotal: satangsToString(discountSatangs),
    exactDepositTotal: satangsToString(depositSatangs),
    exactDepositRefundTotal: satangsToString(depositRefundSatangs),
    exactTotalBilledThisMonth: satangsToString(totalBilledSatangs),
    exactTotalRevenueThisMonth: satangsToString(totalRevenueSatangs),
    exactTotalUnpaidThisMonth: satangsToString(totalUnpaidSatangs),
    exactTotalOverdueAmount: satangsToString(totalOverdueSatangs),
    exactTotalBilledPlusDeposit: satangsToString(totalBreakdownSatangs),
    exactYearBilledTotal: satangsToString(yearBilledSatangs),
    exactArpu: satangsToString(arpuSatangs),
    exactTotalRepairCostThisMonth: satangsToString(repairCostThisMonthSatangs),
    exactTotalRepairCostYear: satangsToString(repairCostYearSatangs),
    exactNetIncomeThisMonth: satangsToString(netIncomeThisMonthSatangs),
    exactVatTotal: satangsToString(totalVatSatangs),

    // Presentation Numbers (derived safely from exact satangs)
    fixedRentTotal: satangsToNumber(fixedRentSatangs),
    waterTotal: satangsToNumber(waterSatangs),
    electricTotal: satangsToNumber(electricSatangs),
    commonParkingTotal: satangsToNumber(commonParkingSatangs),
    commonTotal: satangsToNumber(commonSatangs),
    internetTotal: satangsToNumber(internetSatangs),
    parkingTotal: satangsToNumber(parkingSatangs),
    otherServiceTotal: satangsToNumber(otherServiceSatangs),
    vatTotal: satangsToNumber(totalVatSatangs),
    fineTotal: satangsToNumber(fineSatangs),
    discountTotal: satangsToNumber(discountSatangs),
    depositTotal: satangsToNumber(depositSatangs),
    depositRefundTotal: satangsToNumber(depositRefundSatangs),
    totalBilledThisMonth: satangsToNumber(totalBilledSatangs),
    totalRevenueThisMonth: satangsToNumber(totalRevenueSatangs),
    totalUnpaidThisMonth: satangsToNumber(totalUnpaidSatangs),
    totalOverdueAmount: satangsToNumber(totalOverdueSatangs),
    totalBilledPlusDeposit: satangsToNumber(totalBreakdownSatangs),
    totalRepairCostThisMonth: satangsToNumber(repairCostThisMonthSatangs),
    totalRepairCostYear: satangsToNumber(repairCostYearSatangs),
    repairsCountThisMonth,
    repairsCountYear,
    netIncomeThisMonth: satangsToNumber(netIncomeThisMonthSatangs),
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
