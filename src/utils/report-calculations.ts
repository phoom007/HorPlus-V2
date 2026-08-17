/**
 * HorPlus — Shared Owner Report Calculation and Aggregation Module
 * 
 * Extracts pure calculations and filter logic used across OwnerReports UI
 * and backend oracle verification suites to ensure single-source truth.
 * 
 * @license Apache-2.0
 */

import { Room, Bill, Building, Tenant, Contract } from '../types';

export interface ReportCalculationParams {
  rooms?: Room[];
  bills?: (Bill | any)[];
  buildings?: Building[];
  tenants?: Tenant[];
  contracts?: Contract[];
  selectedBuilding?: string;
  selectedCycle?: string;
  selectedYear?: string;
}

export interface ReportCalculationResult {
  totalRooms: number;
  occupiedCount: number;
  vacantCount: number;
  reservedCount: number;
  maintenanceCount: number;
  occupiedPercent: number;
  vacantPercent: number;
  fixedRentTotal: number;
  waterTotal: number;
  electricTotal: number;
  commonParkingTotal: number;
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
  filteredRooms: Room[];
  filteredBills: (Bill | any)[];
  currentMonthBills: (Bill | any)[];
  paidBills: (Bill | any)[];
  unpaidBills: (Bill | any)[];
  paidBillsRooms: { roomNumber: string; roomId: string; amount: number }[];
  unpaidBillsRooms: { roomNumber: string; roomId: string; amount: number }[];
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

  // 5. Revenue & Expense Breakdown Calculations
  const fixedRentTotal = currentMonthBills.reduce((sum, b) => {
    const rentItem = b.items?.find((i: any) => i.category === 'rent' || i.type === 'rent');
    return sum + (rentItem ? Number(rentItem.amount) : Number(b.rentAmount || 0));
  }, 0);

  const waterTotal = currentMonthBills.reduce((sum, b) => {
    const wItem = b.items?.find((i: any) => i.category === 'water' || i.type === 'water');
    return sum + (wItem ? Number(wItem.amount) : Number(b.waterAmount || 0));
  }, 0);

  const electricTotal = currentMonthBills.reduce((sum, b) => {
    const elItem = b.items?.find((i: any) => i.category === 'electricity' || i.type === 'electricity');
    return sum + (elItem ? Number(elItem.amount) : Number(b.electricAmount || 0));
  }, 0);

  const commonParkingTotal = currentMonthBills.reduce((sum, b) => {
    const pkItem = b.items?.find((i: any) => i.category === 'parking' || i.type === 'parking');
    const commonItem = b.items?.find((i: any) => ['common_fee', 'common'].includes(i.category || i.type));
    const internetItem = b.items?.find((i: any) => ['internet_fee', 'internet'].includes(i.category || i.type));

    const parkingVal = pkItem ? Number(pkItem.amount) : Number(b.parkingFee || 0);
    const commonVal = commonItem ? Number(commonItem.amount) : Number(b.commonFee || 0);
    const internetVal = internetItem ? Number(internetItem.amount) : Number(b.internetFee || 0);

    return sum + parkingVal + commonVal + internetVal;
  }, 0);

  const calcOtherFees = (b: any) => {
    let feeSum = 0;
    if (typeof b.otherFees === 'number') {
      feeSum += b.otherFees;
    } else if (Array.isArray(b.otherFees)) {
      feeSum += b.otherFees.reduce((s: number, item: any) => s + (Number(item?.amount) || 0), 0);
    }
    const othItems = b.items?.filter((i: any) => ['other', 'repair', 'addon', 'cleaning'].includes(i.category || i.type))
      .reduce((s: number, i: any) => s + (Number(i?.amount) || 0), 0) || 0;
    return feeSum + othItems;
  };

  const otherServiceTotal = currentMonthBills.reduce((sum, b) => sum + calcOtherFees(b), 0);

  const fineTotal = currentMonthBills.reduce((sum, b) => {
    const fineItems = b.items?.filter((i: any) => i.category === 'fine' || i.type === 'fine')
      .reduce((s: number, i: any) => s + Number(i.amount), 0) || 0;
    return sum + fineItems + Number(b.fineAmount || 0);
  }, 0);

  const depositTotal = contracts
    .filter(c => c.status === 'active' || c.status === 'pending_signature')
    .reduce((sum, c) => sum + Number(c.depositAmount || 0), 0) ||
    filteredRooms.filter(r => r.status === 'occupied').reduce((sum, r) => sum + Number(r.depositAmount || 0), 0);

  const totalBilledThisMonth = currentMonthBills.reduce((sum, b) => sum + Number(b.totalAmount), 0) ||
    (fixedRentTotal + waterTotal + electricTotal + commonParkingTotal + otherServiceTotal + fineTotal);

  const totalRevenueThisMonth = paidBills.reduce((sum, b) => sum + Number(b.paidAmount || b.totalAmount), 0);
  const totalUnpaidThisMonth = totalBilledThisMonth - totalRevenueThisMonth;

  const totalOverdueAmount = filteredBills
    .filter(b => b.status === 'overdue')
    .reduce((sum, b) => sum + Number(b.totalAmount), 0);

  const paidPercent = totalBilledThisMonth > 0 ? Math.round((totalRevenueThisMonth / totalBilledThisMonth) * 100) : 0;
  const unpaidPercent = totalBilledThisMonth > 0 ? 100 - paidPercent : 0;
  const occupiedPercent = totalRooms > 0 ? Math.round((occupiedCount / totalRooms) * 100) : 0;
  const vacantPercent = totalRooms > 0 ? Math.round((vacantCount / totalRooms) * 100) : 0;
  const arpu = occupiedCount > 0 ? Math.round(totalBilledThisMonth / occupiedCount) : 0;

  const yearBilledTotal = filteredBills
    .filter(b => (b.cycleId && b.cycleId.startsWith(selectedYear)) || (b.cycleCode && b.cycleCode.startsWith(selectedYear)))
    .reduce((sum, b) => sum + Number(b.totalAmount), 0);

  // Paid and Unpaid Bills Room Lists (sorted)
  const paidBillsRooms = paidBills.map(b => {
    const r = rooms.find(room => room.id === b.roomId);
    return { roomNumber: r ? r.roomNumber : 'ไม่ระบุ', roomId: b.roomId, amount: Number(b.totalAmount) };
  }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

  const unpaidBillsRooms = unpaidBills.map(b => {
    const r = rooms.find(room => room.id === b.roomId);
    return { roomNumber: r ? r.roomNumber : 'ไม่ระบุ', roomId: b.roomId, amount: Number(b.totalAmount) };
  }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));

  return {
    totalRooms,
    occupiedCount,
    vacantCount,
    reservedCount,
    maintenanceCount,
    occupiedPercent,
    vacantPercent,
    fixedRentTotal,
    waterTotal,
    electricTotal,
    commonParkingTotal,
    otherServiceTotal,
    fineTotal,
    depositTotal,
    totalBilledThisMonth,
    totalRevenueThisMonth,
    totalUnpaidThisMonth,
    totalOverdueAmount,
    paidPercent,
    unpaidPercent,
    arpu,
    yearBilledTotal,
    filteredRooms,
    filteredBills,
    currentMonthBills,
    paidBills,
    unpaidBills,
    paidBillsRooms,
    unpaidBillsRooms,
  };
}
