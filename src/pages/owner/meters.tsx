/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  TrendingUp,
  Save,
  AlertTriangle,
  RotateCw,
  Search,
  CheckCircle,
  Sparkles,
  User,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Plus,
  X,
  Zap,
  RefreshCw,
  Loader2,
  Send,
  Calendar,
  Users,
  CheckCircle2,
  FileText,
  Shield,
  ChevronDown,
  Circle,
  AlertCircle,
  Info,
  Clock,
  Pencil
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, STALE_TIMES } from '../../lib/queryClient';
import { meterDraftStore, deriveMeterDraftPatches } from '../../lib/meterDraftStore';
import { calculateMeterRowPreview, calculateMeterUsageUnits, RoomPreviewContext, parseScaled2, formatScaled2, formatMoneyDisplay } from '../../utils/meterBillingCalculator';
import { isCycleInRollingThreeMonthWindow, toBangkokDateString, normalizeBangkokDate } from '../../utils/calendarDate';
import { Room, Building, QuickAddRoomContext, Bill, BillItem, Tenant, Contract, BillStatus, calculateRoomRentForCycle } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
import { httpRequest } from '../../data/httpClient';
import {
  formatBaht,
  formatThaiDate,
  formatOwnerDate,
  formatOwnerMonthYear,
  formatMeterReadingDisplay,
  formatCountDisplay,
  normalizeSingleDigitCount,
  Modal
} from '../../components/GlobalComponents';

import { LineNotificationModal } from '../../components/LineNotificationModal';
import { QuickAddTenantModal } from '../../components/QuickAddTenantModal';
import { fetchAllPaginatedWithMeta } from '../../utils/fetch-paginated';
import {
  serializeMeterWorkspaceDirtyRow,
  serializeMeterWorkspaceDirtyRows,
} from '../../utils/meter-serializer';

export function getStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function setStored<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export interface OwnerMetersProps {
  rooms: Room[];
  buildings?: Building[];
  dormitoryId?: string;
  bills: Bill[];
  tenants: Tenant[];
  contracts: Contract[];
  onSaveBills: (bills: Bill[]) => void;
  onSelectTenant: (tenantId: string, roomId?: string) => void;
  targetScrollRoomId?: string;
  onClearTargetScrollRoomId?: () => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onNavigate?: (tab: string) => void;
  selectedBillingCycleId: string;
  selectedCycleCode: string;
  selectedCycle?: string;
  billingCycles?: any[];
  onRefetchData?: () => void;
}

export interface MeterRowState {
  roomId: string;
  roomNumber: string;
  waterPrev: number | string;
  waterCurr: number | string;
  elecPrev: number | string;
  elecCurr: number | string;
  isReplaced: boolean;
  peopleCount: number;
  overdueAmount: number | string;
  isPaid: boolean;
  billStatus: BillStatus;
  editWaterPrev?: boolean;
  editElecPrev?: boolean;
  otherFees?: { description: string; amount: number | string }[];
  snapshotVersion?: number;
}

export function getTenantForRoomAndCycleHelper(
  roomId: string,
  cycle: string,
  contracts: Contract[] = [],
  rooms: Room[] = [],
  tenants: Tenant[] = []
): Tenant | undefined {
  if (!cycle) return undefined;
  const [cy, cm] = cycle.split('-').map(Number);
  if (isNaN(cy) || isNaN(cm)) return undefined;

  const cycleStartStr = `${cycle}-01`;
  const daysInMonth = new Date(cy, cm, 0).getDate();
  const cycleEndStr = `${cycle}-${String(daysInMonth).padStart(2, '0')}`;

  const activeContract = (contracts || []).find(c => {
    if (c.roomId !== roomId) return false;
    const startValStr = normalizeBangkokDate(c.startDate);
    const endValStr = normalizeBangkokDate(c.endDate);
    const createdStr = (c as any).createdAt ? normalizeBangkokDate((c as any).createdAt) : startValStr;
    const effectiveStartStr = startValStr > createdStr ? startValStr : createdStr;

    return effectiveStartStr <= cycleEndStr && endValStr >= cycleStartStr;
  });

  if (!activeContract) return undefined;
  return tenants.find(t => t.id === activeContract.tenantId);
}

export function buildRowsFromWorkspace(params: {
  workspaceData: any;
  rooms: Room[];
  bills: Bill[];
  contracts?: Contract[];
  tenants?: Tenant[];
  selectedBillingCycleId?: string;
  selectedCycleCode?: string;
  selectedCycle?: string;
  currentDormId?: string;
}): { rows: MeterRowState[]; originalRows: MeterRowState[] } {
  const { workspaceData, rooms, bills, contracts = [], tenants = [], selectedBillingCycleId, selectedCycleCode, selectedCycle, currentDormId } = params;
  if (!workspaceData) {
    return { rows: [], originalRows: [] };
  }

  const { serverReadings, cyclePeopleRes } = workspaceData;

  const readingsByRoom: { [roomId: string]: { waterPrev?: string; waterCurr?: string; elecPrev?: string; elecCurr?: string } } = {};
  (serverReadings || []).forEach((r: any) => {
    if (!readingsByRoom[r.roomId]) {
      readingsByRoom[r.roomId] = {};
    }
    if (r.meterType === 'water') {
      readingsByRoom[r.roomId].waterPrev = r.previousReading !== undefined && r.previousReading !== null ? String(r.previousReading) : undefined;
      readingsByRoom[r.roomId].waterCurr = r.currentReading !== undefined && r.currentReading !== null ? String(r.currentReading) : undefined;
    } else if (r.meterType === 'electricity' || r.meterType === 'electric') {
      readingsByRoom[r.roomId].elecPrev = r.previousReading !== undefined && r.previousReading !== null ? String(r.previousReading) : undefined;
      readingsByRoom[r.roomId].elecCurr = r.currentReading !== undefined && r.currentReading !== null ? String(r.currentReading) : undefined;
    }
  });

  const snapshots = (cyclePeopleRes && cyclePeopleRes.success && Array.isArray(cyclePeopleRes.data)) ? cyclePeopleRes.data : [];
  const snapshotMap: { [roomId: string]: { peopleCount?: number; manualOutstandingAmount?: string; otherFees?: any[]; version?: number } } = {};
  snapshots.forEach((s: any) => {
    if (s.roomId) {
      snapshotMap[s.roomId] = {
        peopleCount: s.peopleCount !== undefined ? Number(s.peopleCount) : undefined,
        manualOutstandingAmount: s.manualOutstandingAmount ? String(s.manualOutstandingAmount) : '0.00',
        otherFees: Array.isArray(s.otherFees) ? s.otherFees.map((f: any) => ({ description: f.description, amount: String(f.amount) })) : [],
        version: typeof s.version === 'number' ? s.version : 0,
      };
    }
  });

  const activeRooms = [...rooms].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
  );

  const rows: MeterRowState[] = activeRooms.map(r => {
    const roomReadings = readingsByRoom[r.id] || {};
    const cycleTenant = getTenantForRoomAndCycleHelper(r.id, selectedCycleCode || selectedCycle || '', contracts, rooms, tenants);

    const rawWaterBaseline = r.initialWaterMeter !== undefined && r.initialWaterMeter !== null && String(r.initialWaterMeter).trim() !== '' ? String(r.initialWaterMeter) : (r as any).initialWaterReading !== undefined && (r as any).initialWaterReading !== null && String((r as any).initialWaterReading).trim() !== '' ? String((r as any).initialWaterReading) : '';
    const rawElecBaseline = r.initialElectricMeter !== undefined && r.initialElectricMeter !== null && String(r.initialElectricMeter).trim() !== '' ? String(r.initialElectricMeter) : (r as any).initialElectricityReading !== undefined && (r as any).initialElectricityReading !== null && String((r as any).initialElectricityReading).trim() !== '' ? String((r as any).initialElectricityReading) : '';

    const waterPrev = roomReadings.waterPrev !== undefined && roomReadings.waterPrev !== null && String(roomReadings.waterPrev).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.waterPrev)
      : (rawWaterBaseline ? formatMeterReadingDisplay(rawWaterBaseline) : '');
    const waterCurr = roomReadings.waterCurr !== undefined && roomReadings.waterCurr !== null && String(roomReadings.waterCurr).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.waterCurr)
      : '';

    const elecPrev = roomReadings.elecPrev !== undefined && roomReadings.elecPrev !== null && String(roomReadings.elecPrev).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.elecPrev)
      : (rawElecBaseline ? formatMeterReadingDisplay(rawElecBaseline) : '');
    const elecCurr = roomReadings.elecCurr !== undefined && roomReadings.elecCurr !== null && String(roomReadings.elecCurr).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.elecCurr)
      : '';

    const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 0;
    const snap = snapshotMap[r.id];
    const rowPeople = snap?.peopleCount !== undefined ? Math.max(0, snap.peopleCount) : tenantDefaultPeople;

    const existingMonthlyUtilityBill = (bills || []).find(b =>
      (b.cycleId === selectedBillingCycleId || b.cycleId === selectedCycleCode || (b as any).billingCycleId === selectedBillingCycleId) &&
      (b.roomId === r.id || b.roomId === r.roomNumber) &&
      b.billKind === 'MONTHLY_UTILITY' &&
      (b.status as string) !== 'cancelled' && (b.status as string) !== 'void'
    );
    const billStatus: BillStatus = existingMonthlyUtilityBill ? existingMonthlyUtilityBill.status : 'draft';
    const isPaid = billStatus === 'paid';

    return {
      roomId: r.id,
      roomNumber: r.roomNumber,
      waterPrev,
      waterCurr,
      elecPrev,
      elecCurr,
      isReplaced: false,
      peopleCount: rowPeople,
      overdueAmount: snap?.manualOutstandingAmount !== undefined && snap?.manualOutstandingAmount !== null && String(snap.manualOutstandingAmount).trim() !== '' && String(snap.manualOutstandingAmount) !== '0.00' && String(snap.manualOutstandingAmount) !== '0'
        ? String(snap.manualOutstandingAmount)
        : snap?.manualOutstandingAmount === '0' || snap?.manualOutstandingAmount === '0.00'
        ? '0'
        : '',
      isPaid,
      billStatus,
      editWaterPrev: false,
      editElecPrev: false,
      otherFees: snap?.otherFees || [],
      snapshotVersion: snap?.version || 0,
    };
  });

  const originalRows = JSON.parse(JSON.stringify(rows));

  const localDraft = currentDormId && selectedBillingCycleId ? meterDraftStore.getDraft(currentDormId, selectedBillingCycleId) : null;
  if (localDraft && localDraft.length > 0) {
    const merged = rows.map(serverRow => {
      const draftPatch = localDraft.find(d => d.roomId === serverRow.roomId);
      if (draftPatch) {
        return {
          ...serverRow,
          waterCurr: draftPatch.waterCurr !== undefined ? draftPatch.waterCurr : serverRow.waterCurr,
          waterPrev: draftPatch.waterPrev !== undefined ? draftPatch.waterPrev : serverRow.waterPrev,
          elecCurr: draftPatch.elecCurr !== undefined ? draftPatch.elecCurr : serverRow.elecCurr,
          elecPrev: draftPatch.elecPrev !== undefined ? draftPatch.elecPrev : serverRow.elecPrev,
          peopleCount: draftPatch.peopleCount !== undefined ? draftPatch.peopleCount : serverRow.peopleCount,
          overdueAmount: draftPatch.overdueAmount !== undefined ? draftPatch.overdueAmount : serverRow.overdueAmount,
          isReplaced: draftPatch.isReplaced !== undefined ? draftPatch.isReplaced : serverRow.isReplaced,
          // serverRow.otherFees is authoritative from server query
          // serverRow.snapshotVersion is authoritative from server query
        };
      }
      return serverRow;
    });
    return { rows: merged, originalRows };
  }

  return { rows, originalRows };
}

export interface TopLevelFinancialComponent {
  label: string;
  amount: number;
  formattedAmount: string;
  status: 'PREVIEW' | 'UNPAID' | 'PAID' | 'INVALID';
  title: string;
}

export interface OwnerFinancialBreakdown {
  operationalAmount: number;
  formattedAmount: string;
  components: TopLevelFinancialComponent[];
}

export function getOwnerFinancialBreakdown(
  row: MeterRowState,
  roomCtx: any,
  rateSnapshot: any,
  bills: Bill[] = [],
  selectedBillingCycleId: string
): OwnerFinancialBreakdown {
  if (roomCtx?.billingSource === 'DAILY_STAY') {
    const baseRent = Number(roomCtx.rentAmount) || 0;
    const isDailyRentPaid = Boolean(roomCtx?.isDailyRentPaid || roomCtx?.isDailyPaid || roomCtx?.isPaid);
    const isDailyDepositPaid = Boolean(roomCtx?.isDailyDepositPaidInDisplayedPeriod || roomCtx?.isDepositPaid);
    const depositDue = (roomCtx.showDailyDepositLine && !isDailyDepositPaid)
      ? (Number(roomCtx.dailyDepositAmount) || 0)
      : 0;
    const rentDue = isDailyRentPaid ? 0 : baseRent;
    const totalDailyDue = rentDue + depositDue;

    const components: TopLevelFinancialComponent[] = [];
    if (roomCtx.showDailyDepositLine) {
      const depAmt = Number(roomCtx.dailyDepositAmount || 0);
      components.push({
        label: 'ค่าประกัน',
        amount: depAmt,
        formattedAmount: formatMoneyDisplay(formatScaled2(parseScaled2(depAmt))),
        status: isDailyDepositPaid ? 'PAID' : 'UNPAID',
        title: isDailyDepositPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
      });
    }

    if (baseRent > 0) {
      components.push({
        label: 'ค่าเช่า (วัน)',
        amount: baseRent,
        formattedAmount: formatMoneyDisplay(formatScaled2(parseScaled2(baseRent))),
        status: isDailyRentPaid ? 'PAID' : 'UNPAID',
        title: isDailyRentPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
      });
    }

    const opStr = formatScaled2(parseScaled2(totalDailyDue));
    return {
      operationalAmount: totalDailyDue,
      formattedAmount: formatMoneyDisplay(opStr),
      components,
    };
  }

  const preview = calculateMeterRowPreview(roomCtx, rateSnapshot, {
    waterCurr: row.waterCurr,
    waterPrev: row.waterPrev,
    elecCurr: row.elecCurr,
    elecPrev: row.elecPrev,
    peopleCount: row.peopleCount,
    overdueAmount: row.overdueAmount,
    otherFees: row.otherFees || [],
  });

  const previewSatang = preview.status === 'VALID' ? parseScaled2(preview.totalAmount) : 0n;

  const roomBills = (bills || []).filter(b => b.roomId === row.roomId && (b.billingCycleId === selectedBillingCycleId || b.cycleId === selectedBillingCycleId) && b.status !== 'cancelled' && (b.status as string) !== 'void');
  const monthlyBill = roomBills.find(b => b.billKind === 'MONTHLY_UTILITY');
  const depositBill = roomBills.find(b => b.billKind === 'DEPOSIT');
  const rentBill = roomBills.find(b => b.billKind === 'RENT');

  const components: TopLevelFinancialComponent[] = [];
  let operationalSatang = 0n;

  if (monthlyBill) {
    const isPaid = (monthlyBill.status as string) === 'paid' || (monthlyBill.status as string) === 'PAID';
    const bTotal = parseScaled2(monthlyBill.totalAmount);
    const bOutstanding = parseScaled2(monthlyBill.outstandingAmount ?? (isPaid ? '0.00' : monthlyBill.totalAmount));
    if (!isPaid) {
      operationalSatang += bOutstanding;
    }
    components.push({
      label: 'บิลรายเดือน',
      amount: Number(formatScaled2(bTotal)),
      formattedAmount: formatMoneyDisplay(formatScaled2(bTotal)),
      status: isPaid ? 'PAID' : 'UNPAID',
      title: isPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
    });
  } else {
    if (preview.status === 'INVALID') {
      components.push({
        label: 'บิลรายเดือน',
        amount: 0,
        formattedAmount: 'รูปแบบคิดเงินไม่ถูกต้อง',
        status: 'INVALID',
        title: 'รูปแบบการคิดค่าบริการไม่ถูกต้อง',
      });
    } else {
      const amtStr = preview.totalAmount;
      const pSatang = previewSatang;
      operationalSatang += pSatang;
      if (pSatang > 0n || roomCtx?.billingSource !== 'NONE') {
        components.push({
          label: 'บิลรายเดือน',
          amount: Number(amtStr),
          formattedAmount: formatMoneyDisplay(amtStr),
          status: 'PREVIEW',
          title: 'ยังไม่ออกบิล (พรีวิว)',
        });
      }
    }
  }

  if (depositBill) {
    const isPaid = (depositBill.status as string) === 'paid' || (depositBill.status as string) === 'PAID';
    const bTotal = parseScaled2(depositBill.totalAmount);
    const bOutstanding = parseScaled2(depositBill.outstandingAmount ?? (isPaid ? '0.00' : depositBill.totalAmount));
    if (!isPaid) {
      operationalSatang += bOutstanding;
    }
    components.push({
      label: 'ค่าประกัน',
      amount: Number(formatScaled2(bTotal)),
      formattedAmount: formatMoneyDisplay(formatScaled2(bTotal)),
      status: isPaid ? 'PAID' : 'UNPAID',
      title: isPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
    });
  } else if (Number(roomCtx?.depositAmount || 0) > 0) {
    const isPaid = Boolean(roomCtx?.isDepositPaid);
    const dSatang = parseScaled2(roomCtx.depositAmount);
    if (!isPaid) {
      operationalSatang += dSatang;
    }
    components.push({
      label: 'ค่าประกัน',
      amount: Number(roomCtx.depositAmount),
      formattedAmount: formatMoneyDisplay(formatScaled2(dSatang)),
      status: isPaid ? 'PAID' : 'UNPAID',
      title: isPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
    });
  }

  if (rentBill) {
    const isPaid = (rentBill.status as string) === 'paid' || (rentBill.status as string) === 'PAID';
    const bTotal = parseScaled2(rentBill.totalAmount);
    const bOutstanding = parseScaled2(rentBill.outstandingAmount ?? (isPaid ? '0.00' : rentBill.totalAmount));
    if (!isPaid) {
      operationalSatang += bOutstanding;
    }
    const isTerm = roomCtx?.billingSource === 'PROVISIONAL_TERM' || roomCtx?.billingSource === 'TERM_CONTRACT';
    components.push({
      label: isTerm ? 'ค่าเช่า (เทอม)' : 'ค่าเช่า (เดือน)',
      amount: Number(formatScaled2(bTotal)),
      formattedAmount: formatMoneyDisplay(formatScaled2(bTotal)),
      status: isPaid ? 'PAID' : 'UNPAID',
      title: isPaid ? 'ชำระแล้ว' : 'รอชำระเงิน',
    });
  } else if (Number(roomCtx?.rentAmount || 0) > 0 && roomCtx?.billingSource !== 'NONE' && !roomCtx?.isFutureReservation) {
    const rSatang = parseScaled2(roomCtx.rentAmount);
    operationalSatang += rSatang;
    const isTerm = roomCtx?.billingSource === 'PROVISIONAL_TERM' || roomCtx?.billingSource === 'TERM_CONTRACT';
    components.push({
      label: isTerm ? 'ค่าเช่า (เทอม)' : 'ค่าเช่า (เดือน)',
      amount: Number(roomCtx.rentAmount),
      formattedAmount: formatMoneyDisplay(formatScaled2(rSatang)),
      status: 'PREVIEW',
      title: 'ยังไม่ออกบิล (พรีวิว)',
    });
  }

  const opStr = formatScaled2(operationalSatang);
  return {
    operationalAmount: Number(opStr),
    formattedAmount: formatMoneyDisplay(opStr),
    components,
  };
}

export function mapErrorMessageToThai(raw: any): string {
  if (!raw) return 'เกิดข้อผิดพลาดในการดำเนินการ';

  // 1. Extract machine error code first (envelope / response object / error object)
  const rawCode =
    (typeof raw === 'object' && raw !== null
      ? raw.response?.data?.error?.code ??
        raw.response?.data?.code ??
        raw.error?.code ??
        raw.code
      : undefined);

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';

  const exactNoActiveCodes = [
    'NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM',
    'NO_ACTIVE_TENANCY',
  ];

  if (exactNoActiveCodes.includes(code)) {
    return 'ไม่พบผู้เช่า';
  }
  if (code === 'ROOM_LOCKED_PAID') {
    return 'บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้';
  }
  if (code === 'BILLING_CYCLE_NOT_FOUND') {
    return 'ไม่พบข้อมูลรอบบิล';
  }
  if (code === 'MISSING_WATER_METER_READING' || code === 'MISSING_METER_READING') {
    return 'กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล';
  }
  if (code === 'MISSING_ELECTRICITY_METER_READING') {
    return 'กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล';
  }
  if (code === 'STALE_VERSION') {
    return 'ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณารีเฟรชหน้านี้';
  }

  // 2. Fallback to message or string inspection if machine code was not explicitly provided
  const rawMessage =
    typeof raw === 'string'
      ? raw
      : (typeof raw === 'object' && raw !== null
          ? raw.response?.data?.error?.message ??
            raw.response?.data?.message ??
            raw.error?.message ??
            raw.message
          : '');

  const msg = typeof rawMessage === 'string' ? rawMessage.trim() : '';

  if (
    msg.includes('NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM') ||
    msg.includes('NO_ACTIVE_TENANCY')
  ) {
    return 'ไม่พบผู้เช่า';
  }
  if (msg.includes('ROOM_LOCKED_PAID')) {
    return 'บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้';
  }
  if (msg.includes('BILLING_CYCLE_NOT_FOUND')) {
    return 'ไม่พบข้อมูลรอบบิล';
  }
  if (msg.includes('MISSING_WATER_METER_READING') || msg.includes('MISSING_METER_READING')) {
    return 'กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล';
  }
  if (msg.includes('MISSING_ELECTRICITY_METER_READING')) {
    return 'กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล';
  }
  if (msg.includes('STALE_VERSION')) {
    return 'ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณารีเฟรชหน้านี้';
  }

  return msg || 'เกิดข้อผิดพลาดในการดำเนินการ';
}

export const OwnerMeters: React.FC<OwnerMetersProps> = ({
  rooms,
  buildings = [],
  dormitoryId = '',
  bills,
  tenants,
  contracts,
  onSaveBills,
  onSelectTenant,
  targetScrollRoomId,
  onClearTargetScrollRoomId,
  onAddLog,
  onNavigate,
  selectedBillingCycleId,
  selectedCycleCode,
  selectedCycle = selectedCycleCode,
  billingCycles: propBillingCycles,
  onRefetchData
}) => {
  const queryClient = useQueryClient();
  const currentDormId = dormitoryId || '';

  const initialCachedData = currentDormId && selectedBillingCycleId
    ? queryClient.getQueryData<any>(queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId))
    : null;

  const initialBuilt = React.useMemo(() => {
    if (initialCachedData && rooms.length > 0) {
      return buildRowsFromWorkspace({
        workspaceData: initialCachedData,
        rooms,
        bills,
        contracts,
        tenants,
        selectedBillingCycleId,
        selectedCycleCode,
        selectedCycle,
        currentDormId,
      });
    }
    return null;
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [meterRows, setMeterRows] = useState<MeterRowState[]>(() => initialBuilt?.rows || []);
  const [loadedCycle, setLoadedCycle] = useState<string>(() => (initialBuilt ? selectedBillingCycleId || '' : ''));
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning' | 'info'>('success');
  const [isToastFading, setIsToastFading] = useState(false);
  const [unlockedElecPrev, setUnlockedElecPrev] = useState<{ [roomId: string]: boolean }>({});
  const [unlockedWaterPrev, setUnlockedWaterPrev] = useState<{ [roomId: string]: boolean }>({});

  useEffect(() => {
    setUnlockedElecPrev({});
    setUnlockedWaterPrev({});
  }, [selectedBillingCycleId]);

  useEffect(() => {
    if (saveSuccess || toastMessage) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setSaveSuccess(false);
        setToastMessage(null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [saveSuccess, toastMessage]);

  useEffect(() => {
    if (targetScrollRoomId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`room-row-${targetScrollRoomId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        onClearTargetScrollRoomId?.();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [targetScrollRoomId, onClearTargetScrollRoomId]);

  const [isQuickFillOpen, setIsQuickFillOpen] = useState(false);
  const [quickFillText, setQuickFillText] = useState('');
  const [templateUsed, setTemplateUsed] = useState(false);
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [selectedQuickAddContext, setSelectedQuickAddContext] = useState<QuickAddRoomContext | null>(null);
  const [quickAddLoadingRoomId, setQuickAddLoadingRoomId] = useState<string | null>(null);

  const dormHeader = currentDormId ? { 'x-dormitory-id': currentDormId } : undefined;

  const billingCyclesQuery = useQuery({
    queryKey: queryKeys.billingCycles(currentDormId),
    queryFn: () => fetchAllPaginatedWithMeta('/api/v1/billing-cycles', { headers: dormHeader, credentials: 'include' }),
    enabled: Boolean(currentDormId),
    staleTime: STALE_TIMES.BILLING_CYCLES,
  });

  const billingCyclesData = billingCyclesQuery.data;
  const billingCycles: any[] = billingCyclesData?.data || propBillingCycles || [];
  const cycleAuthorityStatus: 'loading' | 'ready' | 'error' = billingCyclesQuery.isSuccess
    ? 'ready'
    : (billingCyclesQuery.isLoading ? 'loading' : (billingCyclesQuery.isError ? 'error' : (billingCycles.length > 0 ? 'ready' : 'ready')));
  const cycleAuthorityReady = cycleAuthorityStatus === 'ready' || billingCycles.length > 0;

  const firstBillingCycleId = billingCyclesData?.firstBillingCycleId || (propBillingCycles as any)?.firstBillingCycleId || billingCycles.find((c: any) => c.isFirstCycle)?.id || null;
  const operationalBillingCycleId = billingCyclesData?.operationalBillingCycleId || (propBillingCycles as any)?.operationalBillingCycleId || billingCycles.find((c: any) => c.isCurrent)?.id || null;
  const operationalCycleCode = billingCyclesData?.operationalCycleCode || (propBillingCycles as any)?.operationalCycleCode || billingCycles.find((c: any) => c.isCurrent)?.cycleCode || null;

  const isFirstCycle = cycleAuthorityReady
    ? Boolean(
        firstBillingCycleId && (
          firstBillingCycleId === selectedBillingCycleId ||
          billingCycles.find((c: any) => c.id === selectedBillingCycleId)?.isFirstCycle
        )
      )
    : false;

  const isCurrentOperationalCycle = cycleAuthorityReady
    ? Boolean(
        (operationalBillingCycleId && operationalBillingCycleId === selectedBillingCycleId) ||
        (operationalCycleCode && (selectedCycle === operationalCycleCode || selectedCycleCode === operationalCycleCode))
      )
    : false;

  const previousCycleExists = Boolean(
    cycleAuthorityReady &&
    billingCycles.length > 0 &&
    (() => {
      const idx = billingCycles.findIndex((c: any) => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode || c.cycleCode === selectedCycle);
      return idx !== -1 && idx < billingCycles.length - 1;
    })()
  );

  const [flashingCells, setFlashingCells] = useState<{ [key: string]: boolean }>({});
  const [issuedRoomsFromHeader, setIssuedRoomsFromHeader] = useState<string[]>([]);
  const [wasIssueAllPressed, setWasIssueAllPressed] = useState(false);
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [selectedTenantIdsForLine, setSelectedTenantIdsForLine] = useState<string[]>([]);
  const [lineToastSuccess, setLineToastSuccess] = useState<string | null>(null);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const originalRowsRef = React.useRef<MeterRowState[]>(initialBuilt?.originalRows || []);
  const meterRowsRef = React.useRef<MeterRowState[]>(meterRows);
  useEffect(() => {
    meterRowsRef.current = meterRows;
  }, [meterRows]);

  const historyRef = React.useRef<MeterRowState[][]>([JSON.parse(JSON.stringify(initialBuilt?.rows || []))]);
  const historyIndexRef = React.useRef<number>(0);
  const isPerformingHistoryActionRef = React.useRef<boolean>(false);
  const saveSuccessTimeoutRef = React.useRef<any>(null);

  useEffect(() => {
    return () => {
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
    };
  }, []);

  const [expandedBreakdowns, setExpandedBreakdowns] = useState<{ [roomId: string]: boolean }>({});

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateHistoryButtons = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  };

  const pushHistory = (newRows: MeterRowState[]) => {
    if (isPerformingHistoryActionRef.current) return;
    const cloned = JSON.parse(JSON.stringify(newRows));
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(cloned);
    historyRef.current = newHistory;
    historyIndexRef.current = newHistory.length - 1;
    updateHistoryButtons();
  };

  const undo = () => {
    if (historyIndexRef.current > 0) {
      isPerformingHistoryActionRef.current = true;
      historyIndexRef.current -= 1;
      const targetState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
      setMeterRows(targetState);
      updateHistoryButtons();
      setTimeout(() => {
        isPerformingHistoryActionRef.current = false;
      }, 0);
    }
  };

  const redo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isPerformingHistoryActionRef.current = true;
      historyIndexRef.current += 1;
      const targetState = JSON.parse(JSON.stringify(historyRef.current[historyIndexRef.current]));
      setMeterRows(targetState);
      updateHistoryButtons();
      setTimeout(() => {
        isPerformingHistoryActionRef.current = false;
      }, 0);
    }
  };

  const resetHistory = (initialRows: MeterRowState[]) => {
    const cloned = JSON.parse(JSON.stringify(initialRows));
    historyRef.current = [cloned];
    historyIndexRef.current = 0;
  };

  const [pendingFeeRooms, setPendingFeeRooms] = useState<{ [roomId: string]: boolean }>({});
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const quickFillInputRef = React.useRef<HTMLTextAreaElement>(null);

  const showToast = (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => {
    let resolvedType = type;
    if (!resolvedType) {
      if (
        msg.includes('ไม่น้อยกว่า') ||
        msg.includes('ไม่ถูกต้อง') ||
        msg.includes('ผิดพลาด') ||
        msg.includes('ไม่สามารถ') ||
        msg.includes('ยังไม่ได้') ||
        msg.includes('ขัดข้อง') ||
        msg.includes('ไม่พบ')
      ) {
        resolvedType = 'error';
      } else if (msg.includes('สำเร็จ') || msg.includes('เรียบร้อย') || msg.includes('แล้ว!')) {
        resolvedType = 'success';
      } else if (msg.includes('เตือน') || msg.includes('ตรวจสอบ') || msg.includes('ว่างเปล่า')) {
        resolvedType = 'warning';
      } else {
        resolvedType = 'info';
      }
    }
    setToastType(resolvedType);
    setToastMessage(msg);
  };

  const previewContextQuery = useQuery({
    queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId),
    queryFn: async () => {
      if (!currentDormId || !selectedBillingCycleId) return null;
      const res = await httpRequest<{ success: boolean; data: any; error?: string }>(
        'GET',
        `/api/v1/meters/workspace/preview-context?billingCycleId=${selectedBillingCycleId}`,
        undefined,
        { dormitoryId: currentDormId }
      );
      if (!res || res.success === false) {
        throw new Error(res?.error || 'ไม่สามารถโหลดข้อมูลอัตราค่าน้ำค่าไฟได้');
      }
      return res.data;
    },
    enabled: !!selectedBillingCycleId && !!currentDormId,
    staleTime: STALE_TIMES.PREVIEW_CONTEXT,
  });

  // Meter Workspace Query (Canonical observed query)
  const meterWorkspaceQuery = useQuery({
    queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId),
    queryFn: async () => {
      if (!currentDormId || !selectedBillingCycleId) return null;
      const [serverReadings, cyclePeopleRes] = await Promise.all([
        getDataProvider().meters.getByCycle(selectedBillingCycleId),
        getDataProvider().meters.getCyclePeopleCount(selectedBillingCycleId),
      ]);
      if (cyclePeopleRes && cyclePeopleRes.success === false) {
        const err = cyclePeopleRes.error;
        const errMsg = typeof err === 'object' && err !== null ? (err as any).message : (typeof err === 'string' ? err : 'ไม่สามารถโหลดข้อมูลจำนวนผู้พักอาศัยได้');
        throw new Error(errMsg);
      }
      return { serverReadings, cyclePeopleRes };
    },
    enabled: Boolean(currentDormId && selectedBillingCycleId),
    staleTime: STALE_TIMES.METER_WORKSPACE,
  });

  const previewContext = previewContextQuery.data;
  const rateSnapshot = previewContext?.rateSnapshot;

  // Authoritative billing mode derived strictly from rateSnapshot (fail-closed, no default assumption)
  const isRateSnapshotReady = Boolean(previewContextQuery.isSuccess && rateSnapshot);
  const isWaterUnit = isRateSnapshotReady ? (rateSnapshot.waterBillingType === 'per_unit') : false;
  const isElecUnit = isRateSnapshotReady ? (rateSnapshot.electricityBillingType === 'per_unit') : false;

  const isMeterWorkspaceReady = Boolean(meterWorkspaceQuery.isSuccess);
  const isSelectedCycleAuthorityReady = Boolean(
    cycleAuthorityReady &&
    selectedBillingCycleId &&
    billingCycles.some((c: any) => c.id === selectedBillingCycleId)
  );

  // Canonical mutation readiness predicate
  const isMutationReady = Boolean(
    isSelectedCycleAuthorityReady &&
    isRateSnapshotReady &&
    isMeterWorkspaceReady &&
    !isSaving
  );

  const showPullButton = Boolean(
    isSelectedCycleAuthorityReady &&
    isFirstCycle === false &&
    previousCycleExists &&
    isMeterWorkspaceReady &&
    isRateSnapshotReady
  );

  // Controlled input state for adding other fees per room
  const [newFeeInputs, setNewFeeInputs] = useState<Record<string, { description: string; amount: string }>>({});

  const handleFeeDescriptionChange = (roomId: string, desc: string) => {
    setNewFeeInputs(prev => ({
      ...prev,
      [roomId]: {
        description: desc,
        amount: prev[roomId]?.amount ?? '',
      }
    }));
  };

  const handleFeeAmountChange = (roomId: string, rawAmt: string) => {
    const sanitized = sanitizeMoneyTyping(rawAmt);
    setNewFeeInputs(prev => ({
      ...prev,
      [roomId]: {
        description: prev[roomId]?.description ?? '',
        amount: sanitized,
      }
    }));
  };

  const sanitizeMeterReadingTyping = (val: string): string => {
    if (!val) return '';
    // Integer only: digits 0-9, max 5 digits
    return val.replace(/[^0-9]/g, '').slice(0, 5);
  };

  const normalizeMeterValueOnBlur = (val: string): string => {
    if (!val || val.trim() === '') return '';
    const trimmed = val.trim().replace(/[^0-9]/g, '').slice(0, 5);
    if (!trimmed) return '';
    // Integer: normalize leading zeros, e.g. 0500 -> 500, 000 -> 0
    return trimmed.replace(/^0+(?=\d)/, '');
  };

  const formatOtherFeeAmountDisplay = (amount: number | string): string => {
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/,/g, ''));
    if (isNaN(num)) return `${amount} ฿`;
    if (Number.isInteger(num)) {
      return `${num} ฿`;
    }
    return `${num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
  };

  const sanitizeMoneyTyping = (val: string): string => {
    if (!val) return '';
    let cleaned = val.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
      const intPart = cleaned.slice(0, firstDot);
      const fracPart = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
      cleaned = `${intPart}.${fracPart}`;
    }
    return cleaned;
  };

  const handleAddOtherFee = (roomId: string) => {
    const input = newFeeInputs[roomId];
    const cleanDesc = (input?.description || '').trim();
    const amtStr = (input?.amount || '').trim();

    if (!cleanDesc) {
      showToast('กรุณาระบุชื่อรายการค่าใช้จ่าย');
      return;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(amtStr) || amtStr === '0' || amtStr === '0.0' || amtStr === '0.00') {
      showToast('กรุณาระบุจำนวนเงินเป็นตัวเลขที่มากกว่า 0');
      return;
    }

    const currentRow = meterRowsRef.current.find(r => r.roomId === roomId) || meterRows.find(r => r.roomId === roomId);
    if (!currentRow) return;

    const prevFees = currentRow.otherFees || [];
    const formattedAmt = String(amtStr);
    const nextFees = [...prevFees, { description: cleanDesc, amount: formattedAmt }];

    // 1. Update React meterRows state
    setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r));

    // 2. Clear input fields
    setNewFeeInputs(prev => ({
      ...prev,
      [roomId]: { description: '', amount: '' },
    }));

    // 3. Update localStorage drafts
    if (currentDormId && selectedBillingCycleId && originalRowsRef.current) {
      const latestRows = meterRowsRef.current.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r);
      const patches = deriveMeterDraftPatches(latestRows, originalRowsRef.current);
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, patches);
    }
  };

  const handleRemoveOtherFee = (roomId: string, feeIdx: number) => {
    const currentRow = meterRowsRef.current.find(r => r.roomId === roomId) || meterRows.find(r => r.roomId === roomId);
    if (!currentRow) return;

    const prevFees = currentRow.otherFees || [];
    const nextFees = prevFees.filter((_, idx) => idx !== feeIdx);

    // 1. Update React meterRows state
    setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r));

    // 2. Update localStorage drafts
    if (currentDormId && selectedBillingCycleId && originalRowsRef.current) {
      const latestRows = meterRowsRef.current.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r);
      const patches = deriveMeterDraftPatches(latestRows, originalRowsRef.current);
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, patches);
    }
  };

  const getCycleNewReadings = (roomId: string, cycleId: string): { waterCurr: number, elecCurr: number } => {
    const roomObj = rooms.find(r => r.id === roomId);
    const initialWater = roomObj ? (Number(roomObj.initialWaterMeter ?? (roomObj as any).initialWaterReading) || 0) : 0;
    const initialElec = roomObj ? (Number(roomObj.initialElectricMeter ?? (roomObj as any).initialElectricityReading) || 0) : 0;

    if (cycleId < '2026-01') {
      return { waterCurr: initialWater, elecCurr: initialElec };
    }

    // Check if there is an existing bill for this cycle
    const compactCycle = cycleId.replace('-', '');
    const bill = bills.find(b => {
      const matchRoom = b.roomId === roomId || (b as any).roomNumber === roomId;
      if (!matchRoom) return false;
      return Boolean(
        b.cycleId === cycleId ||
        (b as any).billingCycleId === cycleId ||
        (b as any).cycleCode === cycleId ||
        (b.billNumber && (b.billNumber.includes(cycleId) || b.billNumber.includes(compactCycle))) ||
        (b.billingDate && String(b.billingDate).startsWith(cycleId))
      );
    });

    // Get previous cycle's new readings
    const [cy, cm] = cycleId.split('-').map(Number);
    let prevYear = cy;
    let prevMonth = cm - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevCycleId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const prevData = getCycleNewReadings(roomId, prevCycleId);
    const waterPrev = prevData.waterCurr;
    const elecPrev = prevData.elecCurr;

    // Calculate this cycle's new readings from previous readings (no manufactured readings)
    let waterCurr = waterPrev;
    let elecCurr = elecPrev;

    if (bill && Array.isArray(bill.items)) {
      const waterItem = bill.items.find(item => item.category === 'water' || (item as any).type === 'water');
      if (waterItem) {
        const match = waterItem.description?.match(/\(([\d.]+)\s*หน่วย\)/);
        if (match) {
          waterCurr = waterPrev + Number(match[1]);
        } else {
          const isUnit = rateSnapshot ? (rateSnapshot.waterBillingType === 'per_unit') : false;
          if (isUnit) {
            const rate = rateSnapshot?.waterRate ? Number(rateSnapshot.waterRate) : 0;
            waterCurr = rate > 0 ? (waterPrev + Number(waterItem.amount) / rate) : waterPrev;
          } else {
            waterCurr = waterPrev;
          }
        }
      }

      const elecItem = bill.items.find(item => item.category === 'electricity' || (item as any).type === 'electricity');
      if (elecItem) {
        const match = elecItem.description?.match(/\(([\d.]+)\s*หน่วย\)/);
        if (match) {
          elecCurr = elecPrev + Number(match[1]);
        } else {
          const isUnit = rateSnapshot ? (rateSnapshot.electricityBillingType === 'per_unit') : false;
          if (isUnit) {
            const rate = rateSnapshot?.electricityRate ? Number(rateSnapshot.electricityRate) : 0;
            elecCurr = rate > 0 ? (elecPrev + Number(elecItem.amount) / rate) : elecPrev;
          } else {
            elecCurr = elecPrev;
          }
        }
      }
    }

    return { waterCurr, elecCurr };
  };

  const getTenantForRoomAndCycle = (roomId: string, cycle: string) => {
    return getTenantForRoomAndCycleHelper(roomId, cycle, contracts, rooms, tenants);
  };

  const handlePullPreviousData = async () => {
    if (!isMutationReady) {
      showToast('ข้อมูลหรือสิทธิ์การคิดรอบบิลยังไม่พร้อมใช้งาน');
      return;
    }

    setIsSaving(true);
    try {
      const pullRes = await getDataProvider().meters.pullPreviousWorkspace?.(selectedBillingCycleId);
      setIsSaving(false);

      if (!pullRes || !pullRes.success || !pullRes.data) {
        showToast(pullRes?.error?.message || 'ไม่สามารถดึงข้อมูลจากงวดก่อนหน้าได้');
        return;
      }

      const pullData = pullRes.data;
      const roomMap = new Map((pullData.rooms || []).map((r: any) => [r.roomId, r]));

      const newFlashing: { [key: string]: boolean } = {};
      const peopleChanges: Array<{ roomNumber: string; prev: number; curr: number }> = [];

      const updatedRows = meterRows.map((row) => {
        const pRoom: any = roomMap.get(row.roomId);
        const nextRow = { ...row };

        if (pRoom) {
          if (isWaterUnit && pRoom.previousWaterCurrentReading !== null && pRoom.previousWaterCurrentReading !== undefined) {
            const nextWaterPrev = formatMeterReadingDisplay(pRoom.previousWaterCurrentReading);
            if (row.waterPrev !== nextWaterPrev) {
              nextRow.waterPrev = nextWaterPrev;
              newFlashing[`${row.roomId}-waterPrev`] = true;
            }
          }

          if (isElecUnit && pRoom.previousElectricityCurrentReading !== null && pRoom.previousElectricityCurrentReading !== undefined) {
            const nextElecPrev = formatMeterReadingDisplay(pRoom.previousElectricityCurrentReading);
            if (row.elecPrev !== nextElecPrev) {
              nextRow.elecPrev = nextElecPrev;
              newFlashing[`${row.roomId}-elecPrev`] = true;
            }
          }

          const currHousehold = pRoom.currentHouseholdPeopleCount ?? 0;
          if (row.peopleCount !== currHousehold) {
            nextRow.peopleCount = currHousehold;
            newFlashing[`${row.roomId}-peopleCount`] = true;
          }

          // Compare previousCyclePeopleCount vs currentHouseholdPeopleCount for toast (Section 5)
          if (pRoom.previousCyclePeopleCount !== null && pRoom.previousCyclePeopleCount !== undefined) {
            if (pRoom.previousCyclePeopleCount !== currHousehold) {
              peopleChanges.push({
                roomNumber: row.roomNumber,
                prev: pRoom.previousCyclePeopleCount,
                curr: currHousehold,
              });
            }
          }
        }

        return nextRow;
      });

      setMeterRows(updatedRows);
      pushHistory(updatedRows);

      if (Object.keys(newFlashing).length > 0) {
        setFlashingCells((prev) => ({ ...prev, ...newFlashing }));
        setTimeout(() => {
          setFlashingCells((prev) => {
            const next = { ...prev };
            Object.keys(newFlashing).forEach((k) => {
              delete next[k];
            });
            return next;
          });
        }, 1500);
      }

      // Concise toast notification comparing previous cycle vs current household (Section 5)
      if (peopleChanges.length === 0) {
        showToast('ดึงข้อมูลก่อนหน้าเรียบร้อย');
      } else if (peopleChanges.length === 1) {
        const c = peopleChanges[0];
        showToast(`${c.roomNumber}: ผู้พัก ${c.prev} → ${c.curr} คน`);
      } else {
        showToast(`ดึงข้อมูลแล้ว • ผู้พักเปลี่ยน ${peopleChanges.length} ห้อง (ใช้จำนวนปัจจุบัน)`);
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูลก่อนหน้า');
    }
  };

  const getTemplateFormatString = () => {
    const sampleRoom = meterRows[0]?.roomNumber || "A101";
    const sampleElec = formatMeterReadingDisplay(meterRows[0]?.elecPrev || 500);
    const sampleWater = formatMeterReadingDisplay(meterRows[0]?.waterPrev || 500);
    const samplePeople = formatCountDisplay(meterRows[0]?.peopleCount ?? 0);
    const sampleOverdue = formatMeterReadingDisplay(meterRows[0]?.overdueAmount || 50);

    if (isElecUnit && isWaterUnit) {
      return `${sampleRoom} : ไฟ ${sampleElec} : น้ำ ${sampleWater} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else if (isElecUnit && !isWaterUnit) {
      return `${sampleRoom} : ไฟ ${sampleElec} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else if (!isElecUnit && isWaterUnit) {
      return `${sampleRoom} : น้ำ ${sampleWater} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else {
      return `${sampleRoom} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    }
  };

  const generateTemplateText = (freshHouseholdMap?: Map<string, number>) => {
    const sortedRows = [...meterRows].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' }));

    return sortedRows.map(row => {
      const parts = [row.roomNumber];
      if (isElecUnit) {
        parts.push(`ไฟ ${formatMeterReadingDisplay(row.elecPrev)}`);
      }
      if (isWaterUnit) {
        parts.push(`น้ำ ${formatMeterReadingDisplay(row.waterPrev)}`);
      }
      const freshCount = freshHouseholdMap?.get(row.roomId);
      const roomCtx = previewContext?.rooms?.find(r => r.roomId === row.roomId);
      const householdCount = freshCount !== undefined ? freshCount : (roomCtx?.currentHouseholdPeopleCount !== undefined ? roomCtx.currentHouseholdPeopleCount : row.peopleCount);
      parts.push(`${formatCountDisplay(householdCount)} คน`);
      if (Number(row.overdueAmount) > 0) {
        parts.push(`ค้าง ${formatMeterReadingDisplay(row.overdueAmount)}`);
      } else {
        parts.push(`ค้าง `);
      }
      return parts.join(' : ');
    }).join('\n');
  };

  const parseQuickFillText = (text: string) => {
    const lines = text.split('\n');

    const matchedCount = meterRows.filter(row => {
      return lines.some(line => {
        const firstPart = line.split(':')[0]?.trim();
        return firstPart && row?.roomNumber && firstPart.toLowerCase() === row.roomNumber.toLowerCase();
      });
    }).length;

    const newFlashing: { [key: string]: boolean } = {};

    const updatedRows = meterRows.map(row => {
      const matchedLine = lines.find(line => {
        const firstPart = line.split(':')[0]?.trim();
        return firstPart && row?.roomNumber && firstPart.toLowerCase() === row.roomNumber.toLowerCase();
      });

      if (!matchedLine) return row;

      const parts = matchedLine.split(':').map(p => p.trim());

      let waterCurr = row.waterCurr;
      let elecCurr = row.elecCurr;
      let peopleCount = row.peopleCount;
      let overdueAmount = row.overdueAmount;
      let otherFees = [...(row.otherFees || [])];

      parts.slice(1).forEach(part => {
        const trimmedPart = part.trim();
        if (!trimmedPart) return;

        if (trimmedPart.startsWith('ไฟ') || trimmedPart.includes('ไฟ')) {
          const match = trimmedPart.match(/\d+(\.\d{1,2})?/);
          if (match) elecCurr = match[0];
        } else if (trimmedPart.startsWith('น้ำ') || trimmedPart.includes('น้ำ')) {
          const match = trimmedPart.match(/\d+(\.\d{1,2})?/);
          if (match) waterCurr = match[0];
        } else if (trimmedPart.includes('คน')) {
          const match = trimmedPart.match(/\d+/);
          if (match) peopleCount = normalizeSingleDigitCount(match[0]);
        } else if (trimmedPart.startsWith('ค้างชำระ') || trimmedPart.startsWith('ค้าง')) {
          // Alias rule: "ค้าง <amount>" or "ค้างชำระ <amount>" -> description = 'ค้างชำระ', amount = <amount>
          const match = trimmedPart.match(/\d+(\.\d{1,2})?/);
          if (match) {
            const amt = match[0];
            const desc = 'ค้างชำระ';
            const existingIdx = otherFees.findIndex(f => f.description === desc);
            if (existingIdx >= 0) {
              otherFees[existingIdx] = { ...otherFees[existingIdx], amount: amt };
            } else {
              otherFees.push({ description: desc, amount: amt });
            }
          }
        } else {
          // Arbitrary other fee: e.g. "ค่าทำความสะอาด 50", "ค่าปรับ 100"
          const numMatch = trimmedPart.match(/(\d+(\.\d{1,2})?)$/);
          if (numMatch) {
            const amt = numMatch[1];
            const desc = trimmedPart.substring(0, trimmedPart.length - amt.length).trim();
            if (desc) {
              const existingIdx = otherFees.findIndex(f => f.description.toLowerCase() === desc.toLowerCase());
              if (existingIdx >= 0) {
                otherFees[existingIdx] = { ...otherFees[existingIdx], amount: amt };
              } else {
                otherFees.push({ description: desc, amount: amt });
              }
            }
          }
        }
      });

      if (waterCurr !== row.waterCurr) newFlashing[`${row.roomId}-waterCurr`] = true;
      if (elecCurr !== row.elecCurr) newFlashing[`${row.roomId}-elecCurr`] = true;
      if (peopleCount !== row.peopleCount) newFlashing[`${row.roomId}-peopleCount`] = true;
      if (overdueAmount !== row.overdueAmount) newFlashing[`${row.roomId}-overdueAmount`] = true;

      return {
        ...row,
        waterCurr,
        elecCurr,
        peopleCount,
        overdueAmount,
        otherFees,
      };
    });

    setMeterRows(updatedRows);
    pushHistory(updatedRows);

    if (Object.keys(newFlashing).length > 0) {
      setFlashingCells(prev => ({ ...prev, ...newFlashing }));
      setTimeout(() => {
        setFlashingCells(prev => {
          const next = { ...prev };
          Object.keys(newFlashing).forEach(k => {
            delete next[k];
          });
          return next;
        });
      }, 1500);
    }

    return matchedCount;
  };

  const handleApplyQuickFill = () => {
    if (!isMutationReady) {
      showToast('ข้อมูลหรือสิทธิ์การคิดรอบบิลยังไม่พร้อมใช้งาน', 'error');
      return;
    }
    const count = parseQuickFillText(quickFillText);
    if (count > 0) {
      showToast(`กรอกข้อมูลด่วนสำเร็จ! อัปเดตข้อมูล ${count} ห้อง`, 'success');
    } else {
      showToast("ไม่พบข้อมูลห้องพักที่ตรงกัน กรุณาตรวจสอบรูปแบบ", 'warning');
    }
    setIsQuickFillOpen(false);
  };

  // DEVELOPER NOTE / บันทึกผู้พัฒนา:
  // สำหรับระบบ SaaS ในอนาคต หากหอพักตั้งค่ารูปแบบค่าน้ำประปา หรือค่าไฟฟ้า เป็น "ไม่ใช่ บาท/หน่วย"
  // (เช่น เป็นรูปแบบ 'person' หรือ 'room' ซึ่งเป็นระบบเหมาจ่ายรายคนหรือรายห้อง)
  // ระบบจะไม่จำเป็นต้องใช้เลขอ่านมิเตอร์ ดังนั้นในตารางจะซ่อนช่องกรอกมิเตอร์เก่าและมิเตอร์ใหม่ไปโดยอัตโนมัติ
  // เพื่อความสะอาดของหน้าจอและความสอดคล้องตามการตั้งค่าบริการจริงของแต่ละหอพัก

  const scrollTable = (direction: 'left' | 'right') => {
    if (tableContainerRef.current) {
      const scrollAmount = 250;
      tableContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const getWaterCost = (row: MeterRowState) => {
    const mode = rateSnapshot?.waterBillingType || 'per_unit';
    const rate = Number(rateSnapshot?.waterRate) || 0;
    const wCurr = Number(row.waterCurr) || 0;
    const wPrev = Number(row.waterPrev) || 0;
    const units = row.isReplaced ? wCurr : Math.max(0, wCurr - wPrev);

    if (mode === 'per_unit' || mode === 'unit') {
      return units * rate;
    } else if (mode === 'per_person' || mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else {
      return rate;
    }
  };

  const getElectricCost = (row: MeterRowState) => {
    const mode = rateSnapshot?.electricityBillingType || 'per_unit';
    const rate = Number(rateSnapshot?.electricityRate) || 0;
    const eCurr = Number(row.elecCurr) || 0;
    const ePrev = Number(row.elecPrev) || 0;
    const units = row.isReplaced ? eCurr : Math.max(0, eCurr - ePrev);

    if (mode === 'per_unit' || mode === 'unit') {
      return units * rate;
    } else if (mode === 'per_person' || mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else {
      return rate;
    }
  };

  const getCommonFeeCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = rateSnapshot?.commonFeeMode || 'per_room';
    const fee = Number(rateSnapshot?.commonFee) || 0;

    if (mode === 'per_person' || mode === 'person') {
      return (row.peopleCount || 0) * fee;
    } else if (mode === 'free' || mode === 'none') {
      return 0;
    } else {
      return fee;
    }
  };

  const getInternetCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = rateSnapshot?.internetFeeMode || 'per_room';
    const fee = Number(rateSnapshot?.internetFee) || 0;
    if (fee <= 0 || mode === 'free' || mode === 'none') return 0;

    if (mode === 'per_person' || mode === 'person') {
      return (row.peopleCount || 0) * fee;
    } else {
      return fee;
    }
  };

  const getParkingCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = rateSnapshot?.parkingFeeMode || 'per_room';
    if (mode === 'free' || mode === 'none') return 0;
    const fee = Number(rateSnapshot?.parkingFee) || 0;
    if (fee <= 0) return 0;

    if (mode === 'per_vehicle' || mode === 'vehicle') {
      const tenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
      if (tenant && (tenant as any).vehicle && (tenant as any).vehicle.type && (tenant as any).vehicle.type !== 'none') {
        return fee;
      }
      return 0;
    } else if (mode === 'per_person' || mode === 'person') {
      return (row.peopleCount || 0) * fee;
    } else {
      return fee;
    }
  };

  // Initialize meter rows based on rooms list, stored states, and bills
  useEffect(() => {
    try {
      const shouldScroll = localStorage.getItem('scroll_to_meter_status');
      if (shouldScroll === 'true') {
        localStorage.removeItem('scroll_to_meter_status');
        const doScroll = () => {
          // Keep page at very top
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const mainContent = document.getElementById('owner-main-content') || document.querySelector('main');
          if (mainContent) {
            mainContent.scrollTop = 0;
          }

          const container = tableContainerRef.current;
          const statusHeader = document.getElementById('status-column-header');
          if (container) {
            if (statusHeader) {
              const containerWidth = container.clientWidth;
              const headerLeft = statusHeader.offsetLeft;
              const headerWidth = statusHeader.offsetWidth;
              const targetLeft = Math.max(0, headerLeft + (headerWidth / 2) - (containerWidth / 2));
              container.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } else {
              const containerWidth = container.clientWidth;
              const scrollWidth = container.scrollWidth;
              const targetLeft = Math.max(0, scrollWidth - containerWidth);
              container.scrollTo({ left: targetLeft, behavior: 'smooth' });
            }
          }
        };
        doScroll();
        requestAnimationFrame(doScroll);
        setTimeout(doScroll, 50);
        setTimeout(doScroll, 150);
        setTimeout(doScroll, 350);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedCycle]);

  useEffect(() => {
    if (!selectedBillingCycleId || !meterWorkspaceQuery.data) {
      if (!selectedBillingCycleId) {
        setMeterRows([]);
        setLoadedCycle('');
      }
      return;
    }

    const built = buildRowsFromWorkspace({
      workspaceData: meterWorkspaceQuery.data,
      rooms,
      bills,
      contracts,
      tenants,
      selectedBillingCycleId,
      selectedCycleCode,
      selectedCycle,
      currentDormId,
    });

    // Merge any locally confirmed snapshotVersions in originalRowsRef to prevent stale background refetch overwrite
    if (originalRowsRef.current && originalRowsRef.current.length > 0) {
      built.originalRows = built.originalRows.map(serverOrig => {
        const localOrig = originalRowsRef.current.find(o => o.roomId === serverOrig.roomId);
        if (localOrig && (localOrig.snapshotVersion ?? 0) > (serverOrig.snapshotVersion ?? 0)) {
          return {
            ...serverOrig,
            otherFees: localOrig.otherFees,
            snapshotVersion: localOrig.snapshotVersion,
          };
        }
        return serverOrig;
      });
    }

    originalRowsRef.current = built.originalRows;
    setMeterRows(built.rows);
    resetHistory(built.rows);
    setLoadedCycle(selectedBillingCycleId);
  }, [meterWorkspaceQuery.data, selectedBillingCycleId, rooms, bills, contracts, tenants]);

  // Synchronize unsaved deltas to isolated in-memory draft store
  useEffect(() => {
    if (meterRows && meterRows.length > 0 && meterWorkspaceQuery.isSuccess && currentDormId && selectedBillingCycleId && originalRowsRef.current) {
      const patches = deriveMeterDraftPatches(meterRows, originalRowsRef.current);
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, patches);
    }
  }, [meterRows, selectedBillingCycleId, meterWorkspaceQuery.isSuccess, currentDormId]);

  const handleMeterReadingChange = (
    roomId: string,
    field: 'waterCurr' | 'elecCurr' | 'waterPrev' | 'elecPrev' | 'overdueAmount',
    rawVal: string
  ) => {
    const sanitized = sanitizeMeterReadingTyping(rawVal);
    setMeterRows(prev => {
      const nextRows = prev.map(row => {
        if (row.roomId === roomId) {
          return {
            ...row,
            [field]: sanitized
          };
        }
        return row;
      });
      pushHistory(nextRows);
      return nextRows;
    });
  };

  const handleMeterReadingBlur = (
    roomId: string,
    field: 'waterCurr' | 'elecCurr' | 'waterPrev' | 'elecPrev' | 'overdueAmount'
  ) => {
    setMeterRows(prev => {
      let changed = false;
      const nextRows = prev.map(row => {
        if (row.roomId === roomId) {
          const currentVal = row[field];
          const normalized = normalizeMeterValueOnBlur(String(currentVal ?? ''));
          if (normalized !== currentVal) {
            changed = true;
            return { ...row, [field]: normalized };
          }
        }
        return row;
      });
      if (changed) {
        pushHistory(nextRows);
        return nextRows;
      }
      return prev;
    });
  };

  const handlePeopleCountChange = (roomId: string, rawVal: string) => {
    const count = normalizeSingleDigitCount(rawVal);
    setMeterRows(prev => {
      const nextRows = prev.map(row => {
        if (row.roomId === roomId) {
          return {
            ...row,
            peopleCount: count
          };
        }
        return row;
      });
      pushHistory(nextRows);
      return nextRows;
    });
  };

  const handleNumberChange = (roomId: string, field: 'waterCurr' | 'elecCurr' | 'peopleCount' | 'overdueAmount' | 'waterPrev' | 'elecPrev', value: number | string) => {
    if (field === 'peopleCount') {
      handlePeopleCountChange(roomId, String(value));
    } else {
      handleMeterReadingChange(roomId, field, String(value));
    }
  };

  const getRowEditableFields = (row: MeterRowState) => {
    const roomCtx = previewContext?.rooms?.find((r: any) => r.roomId === row.roomId);
    const isDaily = roomCtx?.billingSource === 'DAILY_STAY';
    const isRowPaid = !isDaily && (row.isPaid || row.billStatus === 'paid');
    if (isRowPaid) return [];
    const fields: ('elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount' | 'overdueAmount')[] = [];
    if (isElecUnit) {
      fields.push('elecPrev');
      fields.push('elecCurr');
    }
    if (isWaterUnit) {
      fields.push('waterPrev');
      fields.push('waterCurr');
    }
    fields.push('peopleCount');
    fields.push('overdueAmount');
    return fields;
  };

  const handlePaste = (
    startRoomId: string,
    startField: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount' | 'overdueAmount',
    e: React.ClipboardEvent<HTMLInputElement>
  ) => {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData.includes('\t') && !pasteData.includes('\n')) {
      return;
    }
    e.preventDefault();

    let lines = pasteData.split(/\r?\n/).map(line => line.split('\t'));
    if (lines.length > 1 && lines[lines.length - 1].length === 1 && lines[lines.length - 1][0] === '') {
      lines = lines.slice(0, -1);
    }
    if (lines.length === 1 && lines[0].length === 1 && lines[0][0] === '') {
      return;
    }

    const startRowIdx = filteredRows.findIndex(r => r.roomId === startRoomId);
    if (startRowIdx === -1) return;

    setMeterRows(prev => {
      const updated = [...prev];
      const newFlashing: { [key: string]: boolean } = {};

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const targetFilteredRowIdx = startRowIdx + lineIdx;
        if (targetFilteredRowIdx >= filteredRows.length) break;

        const targetFilteredRow = filteredRows[targetFilteredRowIdx];
        const masterIdx = updated.findIndex(r => r.roomId === targetFilteredRow.roomId);
        if (masterIdx === -1) continue;

        const row = { ...updated[masterIdx] };
        const editableFields = getRowEditableFields(row);

        let fieldStartIdx = editableFields.indexOf(startField);
        if (fieldStartIdx === -1) {
          fieldStartIdx = 0;
        }

        const cells = lines[lineIdx];
        for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
          const fieldIdx = fieldStartIdx + cellIdx;
          if (fieldIdx >= editableFields.length) break;

          const field = editableFields[fieldIdx];
          const rawVal = cells[cellIdx].trim();

          const val = field === 'peopleCount'
            ? normalizeSingleDigitCount(rawVal)
            : sanitizeMeterReadingTyping(rawVal);
          if (row[field] !== val) {
            (row as any)[field] = val;
            newFlashing[`${row.roomId}-${field}`] = true;
          }
        }

        updated[masterIdx] = row;
      }

      if (Object.keys(newFlashing).length > 0) {
        setFlashingCells(prev => ({ ...prev, ...newFlashing }));
        setTimeout(() => {
          setFlashingCells(prev => {
            const next = { ...prev };
            Object.keys(newFlashing).forEach(k => {
              delete next[k];
            });
            return next;
          });
        }, 1500);
      }

      pushHistory(updated);
      return updated;
    });
  };

  const filterMeaningfulFees = (fees?: Array<{ description?: string; amount?: number | string }>) => {
    return (fees || [])
      .filter(f => {
        if (!f) return false;
        const desc = String(f.description || '').trim();
        const amtStr = String(f.amount || '').trim();
        return desc !== '' && amtStr !== '' && !isNaN(Number(amtStr)) && Number(amtStr) > 0;
      })
      .map(f => ({ description: String(f.description || '').trim(), amount: String(f.amount || '') }));
  };

  const checkIsDirty = () => {
    if (!originalRowsRef.current || originalRowsRef.current.length === 0) return false;
    if (meterRows.length !== originalRowsRef.current.length) return true;
    for (let i = 0; i < meterRows.length; i++) {
      const cur = meterRows[i];
      const orig = originalRowsRef.current.find(o => o.roomId === cur.roomId);
      if (!orig) return true;

      if (
        cur.waterPrev !== orig.waterPrev ||
        cur.waterCurr !== orig.waterCurr ||
        cur.elecPrev !== orig.elecPrev ||
        cur.elecCurr !== orig.elecCurr ||
        cur.peopleCount !== orig.peopleCount ||
        cur.overdueAmount !== orig.overdueAmount ||
        cur.isPaid !== orig.isPaid ||
        cur.billStatus !== orig.billStatus ||
        cur.isReplaced !== orig.isReplaced ||
        JSON.stringify(filterMeaningfulFees(cur.otherFees)) !== JSON.stringify(filterMeaningfulFees(orig.otherFees))
      ) {
        return true;
      }
    }
    return false;
  };

  const isDirty = checkIsDirty();

  // Global Key handler for Enter to save, Ctrl+Z for Undo, Ctrl+Shift+Z / Ctrl+Y for Redo
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const active = document.activeElement;
      const activeTagName = active ? active.tagName.toUpperCase() : '';
      const isTextarea = activeTagName === 'TEXTAREA';
      const activeId = active?.id || '';
      const isModalInput = activeId.startsWith('fee-desc-') || activeId.startsWith('fee-amt-') || activeId.startsWith('quick-fill-');

      // Undo: Ctrl+Z (without shift)
      if (isCtrlOrMeta && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (!isTextarea && !isModalInput) {
          e.preventDefault();
          undo();
          return;
        }
      }

      // Redo: Ctrl+Shift+Z or Ctrl+Y
      if (isCtrlOrMeta && (((e.key === 'z' || e.key === 'Z') && e.shiftKey) || e.key === 'y' || e.key === 'Y')) {
        if (!isTextarea && !isModalInput) {
          e.preventDefault();
          redo();
          return;
        }
      }

      // Enter to save if dirty
      if (e.key === 'Enter' && isDirty && !isSaving) {
        if (isModalInput || isTextarea) {
          return;
        }
        e.preventDefault();
        handleSaveMeters();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isDirty, isSaving, meterRows, bills, selectedCycle]);

  useEffect(() => {
    if (isLineModalOpen) {
      const cycleBills = bills.filter(b => b.cycleId === selectedCycle);
      const tenantIds = Array.from(new Set(cycleBills.map(b => b.tenantId).filter(Boolean)));
      setSelectedTenantIdsForLine(tenantIds);
    }
  }, [isLineModalOpen, bills, selectedCycle]);

  const handleTableKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement;
    const isGridInput = target.tagName === 'INPUT' && target.hasAttribute('data-row');
    if (!isGridInput) return;

    if (e.key === 'Enter') {
      if (isDirty && !isSaving) {
        e.preventDefault();
        handleSaveMeters();
      }
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const rowIndex = Number(target.getAttribute('data-row'));
      const colName = target.getAttribute('data-col') || '';
      const tbody = target.closest('tbody');
      if (!tbody) return;

      const colOrder = ['elecPrev', 'elecCurr', 'waterPrev', 'waterCurr', 'peopleCount', 'overdueAmount'];
      const colIdx = colOrder.indexOf(colName);

      let targetRowIndex = rowIndex;
      let targetColName = colName;

      if (e.key === 'ArrowUp') {
        let r = rowIndex - 1;
        while (r >= 0) {
          const rowInput = tbody.querySelector(`input[data-row="${r}"]:not([disabled]):not([readonly])`);
          if (rowInput) {
            targetRowIndex = r;
            break;
          }
          r--;
        }
      } else if (e.key === 'ArrowDown') {
        let r = rowIndex + 1;
        while (r < filteredRows.length) {
          const rowInput = tbody.querySelector(`input[data-row="${r}"]:not([disabled]):not([readonly])`);
          if (rowInput) {
            targetRowIndex = r;
            break;
          }
          r++;
        }
      } else if (e.key === 'ArrowLeft') {
        let prevColIdx = colIdx - 1;
        while (prevColIdx >= 0) {
          const checkColName = colOrder[prevColIdx];
          const selector = `input[data-row="${rowIndex}"][data-col="${checkColName}"]`;
          const el = tbody.querySelector(selector) as HTMLInputElement | null;
          if (el && !el.readOnly && !el.disabled) {
            targetColName = checkColName;
            break;
          }
          prevColIdx--;
        }
      } else if (e.key === 'ArrowRight') {
        let nextColIdx = colIdx + 1;
        while (nextColIdx < colOrder.length) {
          const checkColName = colOrder[nextColIdx];
          const selector = `input[data-row="${rowIndex}"][data-col="${checkColName}"]`;
          const el = tbody.querySelector(selector) as HTMLInputElement | null;
          if (el && !el.readOnly && !el.disabled) {
            targetColName = checkColName;
            break;
          }
          nextColIdx++;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const selector = `input[data-row="${targetRowIndex}"][data-col="${colName}"]`;
        let el = tbody.querySelector(selector) as HTMLInputElement | null;
        if (el && !el.readOnly && !el.disabled) {
          el.focus();
          el.select();
        } else {
          const allInRow = Array.from(tbody.querySelectorAll(`input[data-row="${targetRowIndex}"]`)) as HTMLInputElement[];
          if (allInRow.length > 0) {
            let closestEl: HTMLInputElement | null = null;
            let minDiff = Infinity;
            allInRow.forEach(input => {
              if (input.readOnly || input.disabled) return;
              const cName = input.getAttribute('data-col');
              if (cName) {
                const cIdx = colOrder.indexOf(cName);
                const diff = Math.abs(cIdx - colIdx);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestEl = input;
                }
              }
            });
            if (closestEl) {
              (closestEl as HTMLInputElement).focus();
              (closestEl as HTMLInputElement).select();
            }
          }
        }
      } else {
        const selector = `input[data-row="${rowIndex}"][data-col="${targetColName}"]`;
        const el = tbody.querySelector(selector) as HTMLInputElement | null;
        if (el && !el.readOnly && !el.disabled) {
          el.focus();
          el.select();
        }
      }
    }
  };

  const handleCheckboxChange = (roomId: string) => {
    setMeterRows(prev => prev.map(row => {
      if (row.roomId === roomId) {
        const isReplaced = !row.isReplaced;
        return {
          ...row,
          isReplaced,
          waterCurr: isReplaced ? 0 : row.waterPrev,
          elecCurr: isReplaced ? 0 : row.elecPrev
        };
      }
      return row;
    }));
  };

  const handleToggleStatusSwitch = async (row: MeterRowState) => {
    if (!isMutationReady) {
      showToast('ข้อมูลหรือสิทธิ์การคิดรอบบิลยังไม่พร้อมใช้งาน');
      return;
    }
    if (row.isPaid || row.billStatus === 'paid') {
      showToast('บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');
      return;
    }
    const isCurrentlyIssued = row.billStatus !== 'draft' && row.billStatus !== 'cancelled';
    const targetAction = isCurrentlyIssued ? 'cancel' : 'issue';

    let dirtyRowData: any = undefined;
    if (targetAction === 'issue') {
      const orig = (originalRowsRef.current || []).find(o => o.roomId === row.roomId);
      const dirtyObj: any = { roomId: row.roomId };
      let hasChanges = false;

      if (!orig || row.waterCurr !== orig.waterCurr) { dirtyObj.waterCurr = row.waterCurr; hasChanges = true; }
      if (!orig || row.waterPrev !== orig.waterPrev) { dirtyObj.waterPrev = row.waterPrev; hasChanges = true; }
      if (!orig || row.elecCurr !== orig.elecCurr) { dirtyObj.elecCurr = row.elecCurr; hasChanges = true; }
      if (!orig || row.elecPrev !== orig.elecPrev) { dirtyObj.elecPrev = row.elecPrev; hasChanges = true; }
      if (!orig || row.peopleCount !== orig.peopleCount) { dirtyObj.peopleCount = row.peopleCount; hasChanges = true; }
      if (!orig || row.overdueAmount !== orig.overdueAmount) { dirtyObj.manualOutstandingAmount = row.overdueAmount; hasChanges = true; }
      if (!orig || JSON.stringify(row.otherFees || []) !== JSON.stringify(orig.otherFees || [])) { dirtyObj.otherFees = row.otherFees; hasChanges = true; }
      if (!orig || row.isReplaced !== orig.isReplaced) { dirtyObj.isReplaced = row.isReplaced; hasChanges = true; }

      if (hasChanges) {
        dirtyRowData = serializeMeterWorkspaceDirtyRow(dirtyObj);
      }
    }

    setIsSaving(true);
    try {
      const res = await getDataProvider().meters.toggleRoomBillSwitch?.(
        selectedBillingCycleId,
        row.roomId,
        targetAction,
        dirtyRowData,
        targetAction === 'cancel' ? 'OWNER_METER_SWITCH_OFF' : undefined
      );
      setIsSaving(false);
      if (res && res.success) {
        showToast(targetAction === 'issue' ? `ออกบิลห้อง ${row.roomNumber} เรียบร้อยแล้ว` : `ยกเลิกบิลห้อง ${row.roomNumber} เรียบร้อยแล้ว`, 'success');
        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.bills(currentDormId) });
      } else {
        showToast(mapErrorMessageToThai(res?.error?.message) || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล', 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err.message) || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล', 'error');
    }
  };

  const handleIssueAllBills = async () => {
    if (!isMutationReady) {
      showToast('ข้อมูลหรือสิทธิ์การคิดรอบบิลยังไม่พร้อมใช้งาน', 'error');
      return;
    }
    setIsSaving(true);
    try {
      // Exclude Daily rows from dirty rows payload for monthly bulk billing
      const rawDirtyRows = meterRows.filter(r => {
        const roomCtx = previewContext?.rooms?.find((ctx: any) => ctx.roomId === r.roomId);
        if (roomCtx?.billingSource === 'DAILY_STAY') return false;

        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        if (!orig) return true;
        return (
          r.waterCurr !== orig.waterCurr ||
          r.waterPrev !== orig.waterPrev ||
          r.elecCurr !== orig.elecCurr ||
          r.elecPrev !== orig.elecPrev ||
          r.peopleCount !== orig.peopleCount ||
          r.overdueAmount !== orig.overdueAmount ||
          JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || []) ||
          r.isReplaced !== orig.isReplaced
        );
      }).map(r => {
        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        const dirtyObj: any = { roomId: r.roomId };
        if (!orig || r.waterCurr !== orig.waterCurr) dirtyObj.waterCurr = r.waterCurr;
        if (!orig || r.waterPrev !== orig.waterPrev) dirtyObj.waterPrev = r.waterPrev;
        if (!orig || r.elecCurr !== orig.elecCurr) dirtyObj.elecCurr = r.elecCurr;
        if (!orig || r.elecPrev !== orig.elecPrev) dirtyObj.elecPrev = r.elecPrev;
        if (!orig || r.peopleCount !== orig.peopleCount) dirtyObj.peopleCount = r.peopleCount;
        if (!orig || r.overdueAmount !== orig.overdueAmount) dirtyObj.manualOutstandingAmount = r.overdueAmount;
        if (!orig || JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) dirtyObj.otherFees = r.otherFees;
        if (!orig || r.isReplaced !== orig.isReplaced) dirtyObj.isReplaced = r.isReplaced;
        return dirtyObj;
      });

      const dirtyRows = serializeMeterWorkspaceDirtyRows(rawDirtyRows);

      // Single real backend operation
      const res = await getDataProvider().billing.generateBulkBills(
        selectedBillingCycleId,
        undefined,
        dirtyRows.length > 0 ? dirtyRows : undefined
      );
      setIsSaving(false);
      if (res && res.success) {
        if (onSaveBills) {
          const freshBills = await getDataProvider().billing.getByCycle(selectedBillingCycleId);
          onSaveBills(freshBills);
        }

        const generatedList = (res.data as any)?.generated || [];
        const skippedList = (res.data as any)?.skipped || [];
        const genCount = generatedList.length;
        const skipCount = skippedList.length;

        // Filter LINE recipients using canonical Tenant.linkedUserId
        const linkedTenantIds = generatedList
          .map((g: any) => {
            const cycleTenant = getTenantForRoomAndCycle(g.roomId, selectedCycleCode || selectedCycle);
            const tenantObj = tenants.find(t => t.id === cycleTenant?.id);
            return tenantObj?.linkedUserId ? tenantObj.id : null;
          })
          .filter(Boolean) as string[];

        const baseSummary = skipCount > 0
          ? `ออกบิลสำเร็จ ${genCount} ห้อง ข้าม ${skipCount} ห้อง`
          : `ออกบิลสำหรับรอบบันทึกเรียบร้อยแล้ว (${genCount} ห้อง)`;

        if (linkedTenantIds.length > 0) {
          showToast(baseSummary, 'success');
          setSelectedTenantIdsForLine(linkedTenantIds);
          setIsLineModalOpen(true);
        } else {
          // Zero LINE-linked tenants: do NOT open empty modal
          showToast(`${baseSummary} (ยังไม่มีผู้เช่าที่เชื่อมต่อ LINE สำหรับส่งแจ้งเตือน)`, 'info');
        }

        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.bills(currentDormId) });
      } else {
        showToast(mapErrorMessageToThai(res?.error?.message), 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err.message), 'error');
    }
  };

  const handleSaveMeters = async () => {
    if (isSaving) return;
    if (!selectedBillingCycleId) {
      showToast('ยังไม่ได้ตั้งค่ารอบคำนวณ', 'error');
      return;
    }

    // Missing baseline check for per_unit utilities
    for (let rIdx = 0; rIdx < meterRows.length; rIdx++) {
      const row = meterRows[rIdx];
      if (isElecUnit && row.elecCurr !== '' && row.elecPrev === '') {
        showToast(`กรุณาระบุเลขมิเตอร์ไฟเดิมสำหรับห้อง ${row.roomNumber}`, 'error');
        const el = document.querySelector(`input[data-row="${rIdx}"][data-col="elecPrev"]`) as HTMLInputElement | null;
        el?.focus();
        return;
      }
      if (isWaterUnit && row.waterCurr !== '' && row.waterPrev === '') {
        showToast(`กรุณาระบุเลขมิเตอร์น้ำเดิมสำหรับห้อง ${row.roomNumber}`, 'error');
        const el = document.querySelector(`input[data-row="${rIdx}"][data-col="waterPrev"]`) as HTMLInputElement | null;
        el?.focus();
        return;
      }
    }

    // Lower reading check with rollover support
    let lowerReadingError = false;
    for (const row of meterRows) {
      if (!row.isReplaced) {
        if (isWaterUnit && row.waterCurr !== '' && row.waterPrev !== '') {
          const res = calculateMeterUsageUnits(row.waterPrev, row.waterCurr);
          if (!res.isValid) {
            lowerReadingError = true;
            break;
          }
        }
        if (isElecUnit && row.elecCurr !== '' && row.elecPrev !== '') {
          const res = calculateMeterUsageUnits(row.elecPrev, row.elecCurr);
          if (!res.isValid) {
            lowerReadingError = true;
            break;
          }
        }
      }
    }
    if (lowerReadingError) {
      showToast('เลขอ่านมิเตอร์ใหม่ต้องไม่น้อยกว่าเลขอ่านครั้งก่อน', 'error');
      return;
    }

    // Validate other fees fields
    let validationFailed = false;
    for (const row of meterRows) {
      const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement | null;
      const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement | null;
      if (descEl && amtEl) {
        const desc = descEl.value.trim();
        const amtVal = amtEl.value.trim();
        if ((desc !== '' && amtVal === '') || (desc === '' && amtVal !== '')) {
          alert(`กรุณากรอกข้อมูล "ชื่อรายการ" และ "จำนวนเงิน (บาท)" ของ "ค่าใช้จ่ายอื่นๆ" ให้ครบถ้วนสำหรับห้อง ${row.roomNumber}`);
          if (desc === '') {
            descEl.focus();
          } else {
            amtEl.focus();
          }
          validationFailed = true;
          break;
        }
      }
    }
    if (validationFailed) {
      return;
    }

    setIsSaving(true);
    try {
      const dirtyRows = meterRows.map(r => {
        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        const dirtyObj: any = { roomId: r.roomId };
        if (!orig || r.waterCurr !== orig.waterCurr) dirtyObj.waterCurr = r.waterCurr;
        if (!orig || r.waterPrev !== orig.waterPrev) dirtyObj.waterPrev = r.waterPrev;
        if (!orig || r.elecCurr !== orig.elecCurr) dirtyObj.elecCurr = r.elecCurr;
        if (!orig || r.elecPrev !== orig.elecPrev) dirtyObj.elecPrev = r.elecPrev;
        if (!orig || r.peopleCount !== orig.peopleCount) dirtyObj.peopleCount = r.peopleCount;
        if (!orig || r.overdueAmount !== orig.overdueAmount) dirtyObj.manualOutstandingAmount = r.overdueAmount;
        if (!orig || JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) dirtyObj.otherFees = r.otherFees;
        if (!orig || r.isReplaced !== orig.isReplaced) dirtyObj.isReplaced = r.isReplaced;
        return dirtyObj;
      });

      const serializedDirtyRows = serializeMeterWorkspaceDirtyRows(dirtyRows);

      const res = await getDataProvider().meters.saveBulkWorkspace?.(selectedBillingCycleId, serializedDirtyRows);
      setIsSaving(false);

      if (res && res.success) {
        showToast('บันทึกข้อมูลสำเร็จ', 'success');
        setSaveSuccess(true);
        if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
        saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
        originalRowsRef.current = JSON.parse(JSON.stringify(meterRowsRef.current));
        resetHistory(meterRowsRef.current);
        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.bills(currentDormId) });
      } else {
        showToast(mapErrorMessageToThai(res?.error?.message) || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลมิเตอร์', 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err.message) || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลมิเตอร์', 'error');
    }
  };

  const autofillMeters = () => {
    setMeterRows(prev => {
      const nextRows = prev.map(row => {
        const cycleTenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
        const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 0;
        return {
          ...row,
          waterCurr: row.waterPrev,
          elecCurr: row.elecPrev,
          peopleCount: tenantDefaultPeople,
          overdueAmount: '0.00'
        };
      });
      pushHistory(nextRows);
      return nextRows;
    });
  };

  const filteredRows = meterRows.filter(row =>
    (row?.roomNumber || '').toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  return (
    <div className="space-y-6">
      {!selectedBillingCycleId && (
        <div data-testid="missing-cycle-banner" className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-4 py-3 rounded-2xl flex items-center gap-2">
          <span>ยังไม่ได้ตั้งค่ารอบคำนวณ</span>
        </div>
      )}
      {/* Floating Toast Notification (Mobile: Centered above bottom nav, White/Red/Green/Amber bg, Smooth Fade) */}
      {(saveSuccess || toastMessage) && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] px-4.5 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            toastType === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : toastType === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : toastType === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'
          } ${
            isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          {toastType === 'error' ? (
            <AlertCircle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
          ) : toastType === 'warning' ? (
            <AlertTriangle className="w-4.5 h-4.5 text-amber-500 shrink-0" />
          ) : toastType === 'success' ? (
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          ) : (
            <Info className="w-4.5 h-4.5 text-sky-500 shrink-0" />
          )}
          <span className="whitespace-pre-line">{toastMessage || "บันทึกข้อมูลสำเร็จ"}</span>
        </div>
      )}

      {/* Recording table with validations */}
      <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-4 bg-slate-50/50 border-b border-gray-100 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="ค้นหาเลขห้อง..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800"
              />
            </div>

            {/* Scroll table helper buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => scrollTable('left')}
                className="p-1 hover:bg-white text-slate-600 rounded-lg transition-all cursor-pointer shadow-2xs"
                title="เลื่อนไปซ้าย"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-black text-slate-500 px-1.5 select-none whitespace-nowrap">เลื่อนดูตาราง</span>
              <button
                type="button"
                onClick={() => scrollTable('right')}
                className="p-1 hover:bg-white text-slate-600 rounded-lg transition-all cursor-pointer shadow-2xs"
                title="เลื่อนไปขวา"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action buttons */}
          <div className="w-full sm:w-auto flex flex-col sm:flex-row items-stretch sm:items-center gap-2 justify-end">
            {showPullButton && (
              <button
                type="button"
                disabled={!isMutationReady}
                onClick={handlePullPreviousData}
                className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>ดึงข้อมูลก่อนหน้า</span>
              </button>
            )}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                disabled={!isMutationReady}
                onClick={handleIssueAllBills}
                className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-600/10 whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>ออกบิลทุกห้อง</span>
              </button>
              <button
                type="button"
                disabled={!isMutationReady}
                onClick={() => {
                  setIsQuickFillOpen(true);
                  setTemplateUsed(false);
                  setTimeout(() => {
                    quickFillInputRef.current?.focus();
                  }, 100);
                }}
                className="w-full sm:w-auto px-3 sm:px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md whitespace-nowrap shrink-0"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                <span>กรอกแบบรวดเร็ว</span>
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto relative" ref={tableContainerRef}>
          <table onKeyDown={handleTableKeyDown} className="w-full text-left border-collapse text-xs min-w-[1050px]">
            <thead className="bg-slate-50 text-slate-400 font-bold uppercase border-b border-gray-100">
              <tr className="whitespace-nowrap">
                <th className="p-4 sticky left-0 bg-slate-50 z-20 min-w-[80px] shadow-[2px_0_5px_rgba(0,0,0,0.02)]">ห้อง</th>
                {isElecUnit && <th className="p-4 text-center">มิเตอร์ไฟเดิม</th>}
                {isElecUnit && <th className="p-4 text-center">มิเตอร์ไฟใหม่</th>}
                {isWaterUnit && <th className="p-4 text-center">มิเตอร์น้ำเดิม</th>}
                {isWaterUnit && <th className="p-4 text-center">มิเตอร์น้ำใหม่</th>}
                <th className="p-4 text-center">จำนวนคน</th>
                <th className="p-4">ค่าใช้จ่ายอื่นๆ</th>
                <th className="p-4 text-right">ยอดที่ต้องชำระ</th>
                <th id="status-column-header" className="p-4 text-center min-w-[105px]">
                  สถานะ
                </th>
                <th className="p-4">ผู้เช่า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-semibold">
              {filteredRows.map((row, idx) => {
                const waterUnits = row.isReplaced ? Number(row.waterCurr) : (Number(row.waterCurr) - Number(row.waterPrev));
                const elecUnits = row.isReplaced ? Number(row.elecCurr) : (Number(row.elecCurr) - Number(row.elecPrev));

                const waterCost = getWaterCost(row);
                const elecCost = getElectricCost(row);
                const commonCost = getCommonFeeCost(row);
                const internetCost = getInternetCost(row);
                const parkingCost = getParkingCost(row);
                const room = rooms.find(r => r.id === row.roomId);
                const roomRent = (room?.rentCycle === 'term') ? 0 : (room?.monthlyRent || 0);
                const otherFeesTotal = (row.otherFees || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

                const calculatedTotal = roomRent + waterCost + elecCost + commonCost + internetCost + parkingCost + (Number(row.overdueAmount) || 0) + otherFeesTotal;

                const tenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
                const roomCtx = previewContext?.rooms?.find((r: any) => r.roomId === row.roomId);
                const effectiveTenantId = roomCtx ? roomCtx.tenantId : tenant?.id;
                const effectiveTenantName = roomCtx ? roomCtx.tenantName : tenant?.name;
                const isDailyContext = roomCtx?.billingSource === 'DAILY_STAY' || Boolean(roomCtx?.isDailyUnpaid);
                const isBillIssued = row.billStatus !== 'draft' && row.billStatus !== 'cancelled';
                const isRowPaid = !isDailyContext && (row.isPaid || row.billStatus === 'paid');

                const hasElecBaseline = row.elecPrev !== '' && row.elecPrev !== null && row.elecPrev !== undefined;
                const isElecDirectEdit = isFirstCycle || !hasElecBaseline;

                const hasWaterBaseline = row.waterPrev !== '' && row.waterPrev !== null && row.waterPrev !== undefined;
                const isWaterDirectEdit = isFirstCycle || !hasWaterBaseline;

                return (
                  <tr key={row.roomId} id={`room-row-${row.roomId}`} className="hover:bg-slate-50/50 transition-colors">
                    {/* Sticky Room Column (Show only room number like A101) */}
                    <td className="p-4 sticky left-0 bg-white z-10 font-extrabold text-slate-800 text-sm shadow-[2px_0_5px_rgba(0,0,0,0.04)]">
                      {row.roomNumber}
                    </td>

                    {/* Elec Prev Input */}
                    {isElecUnit && (
                      <td className="p-4 text-center">
                        {isElecDirectEdit ? (
                          <div
                            onClick={(e) => {
                              if (!isRowPaid) {
                                const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
                                input?.focus();
                              }
                            }}
                            className={`flex items-center justify-center min-w-[80px] min-h-[32px] w-full ${!isRowPaid ? 'cursor-text' : 'cursor-default'}`}
                          >
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              disabled={isRowPaid}
                              value={row.elecPrev}
                              placeholder="0"
                              onChange={(e) => {
                                handleMeterReadingChange(row.roomId, 'elecPrev', e.target.value);
                              }}
                              onBlur={() => handleMeterReadingBlur(row.roomId, 'elecPrev')}
                              onPaste={(e) => handlePaste(row.roomId, 'elecPrev', e)}
                              data-row={idx}
                              data-col="elecPrev"
                              className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                                flashingCells[`${row.roomId}-elecPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-gray-200'
                              }`}
                            />
                          </div>
                        ) : isRowPaid ? (
                          <div className="flex items-center justify-center min-w-[80px] min-h-[32px] w-full">
                            <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.elecPrev)}</span>
                          </div>
                        ) : unlockedElecPrev[row.roomId] ? (
                          <div className="flex items-center justify-center gap-1 min-w-[80px] min-h-[32px] w-full">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoFocus
                              value={row.elecPrev}
                              onChange={(e) => {
                                handleMeterReadingChange(row.roomId, 'elecPrev', e.target.value);
                              }}
                              onBlur={() => handleMeterReadingBlur(row.roomId, 'elecPrev')}
                              onPaste={(e) => handlePaste(row.roomId, 'elecPrev', e)}
                              data-row={idx}
                              data-col="elecPrev"
                              className="w-16 px-2 py-1 text-xs border border-indigo-300 rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500"
                            />
                            <button
                              type="button"
                              data-testid={`cancel-elec-prev-${row.roomId}`}
                              title="ยกเลิกการแก้ไข"
                              onClick={(e) => {
                                e.stopPropagation();
                                const orig = (originalRowsRef.current || []).find((o) => o.roomId === row.roomId);
                                handleMeterReadingChange(row.roomId, 'elecPrev', orig ? orig.elecPrev : row.elecPrev);
                                setUnlockedElecPrev((prev) => ({ ...prev, [row.roomId]: false }));
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 min-w-[80px] min-h-[32px] w-full group">
                            <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.elecPrev)}</span>
                            <button
                              type="button"
                              data-testid={`unlock-elec-prev-${row.roomId}`}
                              title="แก้ไขเลขอ่านเดิม"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnlockedElecPrev((prev) => ({ ...prev, [row.roomId]: true }));
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}

                    {/* Elec Curr Input */}
                    {isElecUnit && (
                      <td className="p-4 text-center">
                        <div
                          onClick={(e) => {
                            if (!isRowPaid) {
                              const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
                              input?.focus();
                            }
                          }}
                          className={`flex items-center justify-center gap-1 min-h-[32px] w-full ${!isRowPaid ? 'cursor-text' : 'cursor-default'}`}
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={isRowPaid}
                            value={row.elecCurr}
                            onChange={(e) => {
                              handleMeterReadingChange(row.roomId, 'elecCurr', e.target.value);
                            }}
                            onBlur={() => handleMeterReadingBlur(row.roomId, 'elecCurr')}
                            onPaste={(e) => handlePaste(row.roomId, 'elecCurr', e)}
                            data-row={idx}
                            data-col="elecCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                              flashingCells[`${row.roomId}-elecCurr`]
                                ? 'animate-vibrant-flash shadow-md z-10'
                                : elecUnits < 0
                                ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                                : 'border-gray-200'
                            }`}
                          />
                        </div>
                      </td>
                    )}

                    {/* Water Prev Input */}
                    {isWaterUnit && (
                      <td className="p-4 text-center">
                        {isWaterDirectEdit ? (
                          <div
                            onClick={(e) => {
                              if (!isRowPaid) {
                                const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
                                input?.focus();
                              }
                            }}
                            className={`flex items-center justify-center min-w-[80px] min-h-[32px] w-full ${!isRowPaid ? 'cursor-text' : 'cursor-default'}`}
                          >
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              disabled={isRowPaid}
                              value={row.waterPrev}
                              placeholder="0"
                              onChange={(e) => {
                                handleMeterReadingChange(row.roomId, 'waterPrev', e.target.value);
                              }}
                              onBlur={() => handleMeterReadingBlur(row.roomId, 'waterPrev')}
                              onPaste={(e) => handlePaste(row.roomId, 'waterPrev', e)}
                              data-row={idx}
                              data-col="waterPrev"
                              className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                                flashingCells[`${row.roomId}-waterPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-gray-200'
                              }`}
                            />
                          </div>
                        ) : isRowPaid ? (
                          <div className="flex items-center justify-center min-w-[80px] min-h-[32px] w-full">
                            <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.waterPrev)}</span>
                          </div>
                        ) : unlockedWaterPrev[row.roomId] ? (
                          <div className="flex items-center justify-center gap-1 min-w-[80px] min-h-[32px] w-full">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoFocus
                              value={row.waterPrev}
                              onChange={(e) => {
                                handleMeterReadingChange(row.roomId, 'waterPrev', e.target.value);
                              }}
                              onBlur={() => handleMeterReadingBlur(row.roomId, 'waterPrev')}
                              onPaste={(e) => handlePaste(row.roomId, 'waterPrev', e)}
                              data-row={idx}
                              data-col="waterPrev"
                              className="w-16 px-2 py-1 text-xs border border-indigo-300 rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500"
                            />
                            <button
                              type="button"
                              data-testid={`cancel-water-prev-${row.roomId}`}
                              title="ยกเลิกการแก้ไข"
                              onClick={(e) => {
                                e.stopPropagation();
                                const orig = (originalRowsRef.current || []).find((o) => o.roomId === row.roomId);
                                handleMeterReadingChange(row.roomId, 'waterPrev', orig ? orig.waterPrev : row.waterPrev);
                                setUnlockedWaterPrev((prev) => ({ ...prev, [row.roomId]: false }));
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5 min-w-[80px] min-h-[32px] w-full group">
                            <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.waterPrev)}</span>
                            <button
                              type="button"
                              data-testid={`unlock-water-prev-${row.roomId}`}
                              title="แก้ไขเลขอ่านเดิม"
                              onClick={(e) => {
                                e.stopPropagation();
                                setUnlockedWaterPrev((prev) => ({ ...prev, [row.roomId]: true }));
                              }}
                              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}

                    {/* Water Curr Input */}
                    {isWaterUnit && (
                      <td className="p-4 text-center">
                        <div
                          onClick={(e) => {
                            if (!isRowPaid) {
                              const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
                              input?.focus();
                            }
                          }}
                          className={`flex items-center justify-center gap-1 min-h-[32px] w-full ${!isRowPaid ? 'cursor-text' : 'cursor-default'}`}
                        >
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={isRowPaid}
                            value={row.waterCurr}
                            onChange={(e) => {
                              handleMeterReadingChange(row.roomId, 'waterCurr', e.target.value);
                            }}
                            onBlur={() => handleMeterReadingBlur(row.roomId, 'waterCurr')}
                            onPaste={(e) => handlePaste(row.roomId, 'waterCurr', e)}
                            data-row={idx}
                            data-col="waterCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                              flashingCells[`${row.roomId}-waterCurr`]
                                ? 'animate-vibrant-flash shadow-md z-10'
                                : waterUnits < 0
                                ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                                : 'border-gray-200'
                            }`}
                          />
                        </div>
                      </td>
                    )}

                    {/* People Count Input */}
                    <td className="p-4 text-center">
                      <div
                        onClick={(e) => {
                          if (!isRowPaid) {
                            const input = e.currentTarget.querySelector('input') as HTMLInputElement | null;
                            input?.focus();
                          }
                        }}
                        className={`flex items-center justify-center min-h-[32px] w-full ${!isRowPaid ? 'cursor-text' : 'cursor-default'}`}
                      >
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          disabled={isRowPaid}
                          value={row.peopleCount}
                          onChange={(e) => {
                            handlePeopleCountChange(row.roomId, e.target.value);
                          }}
                          onPaste={(e) => handlePaste(row.roomId, 'peopleCount', e)}
                          data-row={idx}
                          data-col="peopleCount"
                          className={`w-14 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                            flashingCells[`${row.roomId}-peopleCount`]
                              ? 'animate-vibrant-flash shadow-md z-10'
                              : 'border-gray-200'
                          }`}
                        />
                      </div>
                    </td>

                    {/* Custom Other Fees Column */}
                    <td className="p-4">
                      <div className="flex flex-col gap-1.5 min-w-[150px]">
                        {/* List of existing other fees */}
                        {(row.otherFees || []).map((fee, feeIdx) => (
                          <div key={feeIdx} className="flex items-center justify-between gap-1 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 text-[10px] text-slate-600 font-bold">
                            <span className="truncate max-w-[80px]" title={fee.description}>{fee.description}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-indigo-600">{formatOtherFeeAmountDisplay(fee.amount)}</span>
                              {!isRowPaid && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOtherFee(row.roomId, feeIdx)}
                                  className="p-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                                  title="ลบรายการ"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Form to add a new other fee inline (visible even if PAID with disabled controls) */}
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            placeholder="ชื่อรายการ"
                            disabled={isRowPaid}
                            value={newFeeInputs[row.roomId]?.description ?? ''}
                            onChange={(e) => handleFeeDescriptionChange(row.roomId, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isRowPaid) {
                                handleAddOtherFee(row.roomId);
                              }
                            }}
                            className="w-16 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="บาท"
                            disabled={isRowPaid}
                            value={newFeeInputs[row.roomId]?.amount ?? ''}
                            onChange={(e) => handleFeeAmountChange(row.roomId, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !isRowPaid) {
                                handleAddOtherFee(row.roomId);
                              }
                            }}
                            className="w-12 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 text-center font-medium focus:outline-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddOtherFee(row.roomId)}
                            disabled={isRowPaid}
                            className={`p-1 rounded-lg transition-all flex items-center justify-center shrink-0 border ${
                              isRowPaid
                                ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed opacity-50'
                                : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border-indigo-100/50 cursor-pointer'
                            }`}
                            title="เพิ่มรายการค่าใช้จ่าย"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Calculated Total & Financial Breakdown */}
                    <td className="p-4 text-right">
                      {(() => {
                        const amountDue = roomCtx ? roomCtx.amountDue : calculatedTotal.toFixed(2);
                        const chargeComponents = roomCtx?.chargeComponents || [];
                        const isExpanded = Boolean(expandedBreakdowns[row.roomId]);

                        return (
                          <div className="flex flex-col items-end">
                            <span className="font-extrabold text-sm text-indigo-600 whitespace-nowrap">
                              {formatMoneyDisplay(amountDue)} ฿
                            </span>
                            {chargeComponents.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExpandedBreakdowns(prev => ({ ...prev, [row.roomId]: !prev[row.roomId] }))}
                                className="text-[10px] text-slate-400 hover:text-indigo-600 font-medium cursor-pointer transition-colors mt-0.5 flex items-center gap-0.5"
                              >
                                <span>ดูรายละเอียด +{chargeComponents.length}</span>
                                <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                              </button>
                            )}
                            {isExpanded && chargeComponents.length > 0 && (
                              <div className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg text-left shadow-sm min-w-[170px] space-y-1">
                                {chargeComponents.map((c: any, cIdx: number) => (
                                  <div key={cIdx} className="flex items-center justify-between gap-2 text-[10px]">
                                    <span className="text-slate-600 truncate max-w-[110px]" title={c.label}>{c.label}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="font-semibold text-slate-700">{formatMoneyDisplay(c.amount)} ฿</span>
                                      {c.status === 'PAID' ? (
                                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">จ่ายแล้ว</span>
                                      ) : (
                                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-700">ยังไม่จ่าย</span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* Status Switch with real server authority */}
                    <td className={`p-4 text-center transition-all duration-300 ${
                      flashingCells[`${row.roomId}-status`]
                        ? 'animate-vibrant-flash rounded-lg shadow-md z-10'
                        : ''
                    }`}>
                      {(() => {
                        if (isDailyContext) {
                          const isDailyOverdue = Boolean(roomCtx?.isDailyOverdue || roomCtx?.isDailyFinancialTail);
                          const isDailyRentPaid = Boolean(roomCtx?.isDailyRentPaid);

                          if (isDailyOverdue) {
                            return (
                              <div className="flex items-center justify-center min-w-[85px]">
                                <span className="inline-flex items-center px-2 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg border border-rose-200">
                                  <AlertCircle className="w-3 h-3 text-rose-500 mr-1 shrink-0" />
                                  รายวัน
                                </span>
                              </div>
                            );
                          }

                          if (isDailyRentPaid) {
                            return (
                              <div className="flex items-center justify-center min-w-[85px]">
                                <span className="inline-flex items-center px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
                                  <CheckCircle className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                                  รายวัน
                                </span>
                              </div>
                            );
                          }

                          // Active & Unpaid (now <= effectiveCheckOutAt) -> Normal existing Daily style (NOT red)
                          return (
                            <div className="flex items-center justify-center min-w-[85px]">
                              <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200">
                                รายวัน
                              </span>
                            </div>
                          );
                        }

                        // Historical Daily Stay (Checked-out & Paid): No active monthly contract/bill -> Non-operational status
                        if ((roomCtx?.historicalDailyCount || 0) > 0 && !effectiveTenantId && row.billStatus === 'draft') {
                          return (
                            <div className="flex items-center justify-center min-w-[85px]">
                              <span className="text-xs text-slate-400 font-bold">-</span>
                            </div>
                          );
                        }

                        return (
                          <div className="flex flex-col items-center justify-center gap-1 min-w-[85px]">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={row.billStatus !== 'draft' && row.billStatus !== 'cancelled'}
                              disabled={isSaving || row.isPaid || row.billStatus === 'paid' || !selectedBillingCycleId}
                              onClick={() => handleToggleStatusSwitch(row)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                                row.billStatus === 'paid'
                                  ? 'bg-emerald-600'
                                  : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                                  ? 'bg-amber-500'
                                  : 'bg-slate-300'
                              }`}
                              title={
                                row.billStatus === 'paid'
                                  ? 'ชำระแล้ว (ล็อค)'
                                  : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                                  ? 'คลิกเพื่อยกเลิกบิล'
                                  : 'คลิกเพื่อออกบิล'
                              }
                            >
                              <span
                                aria-hidden="true"
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                  row.billStatus !== 'draft' && row.billStatus !== 'cancelled' ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <span className={`text-[10px] font-extrabold leading-none ${
                              row.billStatus === 'paid'
                                ? 'text-emerald-700'
                                : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                                ? 'text-amber-700'
                                : 'text-slate-500'
                            }`}>
                              {row.billStatus === 'paid'
                                ? 'ชำระแล้ว'
                                : row.billStatus === 'draft' || row.billStatus === 'cancelled'
                                ? 'ยังไม่ออกบิล'
                                : 'รอชำระ'}
                            </span>
                          </div>
                        );
                      })()}
                    </td>

                    {/* Tenant Clickable Link */}
                    <td className="p-4 whitespace-nowrap">
                      {(() => {
                        const effectiveTenantId = roomCtx ? roomCtx.tenantId : tenant?.id;
                        const effectiveTenantName = roomCtx ? roomCtx.tenantName : tenant?.name;
                        const isFuture = Boolean(roomCtx?.isFutureReservation);
                        const isLineLinked = roomCtx ? roomCtx.isLineLinked : Boolean((tenant as any)?.linkedUserId);
                        const peopleCountVal = Number(row.peopleCount ?? roomCtx?.currentHouseholdPeopleCount ?? roomCtx?.snapshotPeopleCount ?? 1);
                        const activeCycleCode = selectedCycleCode || selectedCycle || billingCycles?.find((c: any) => c.id === selectedBillingCycleId)?.cycleCode || '';
                        const isEligibleAddTenantCycle = isCycleInRollingThreeMonthWindow(activeCycleCode);
                        const hasBookableGap = roomCtx?.hasBookableGap ?? true;
                        const historicalDailyCount = roomCtx?.historicalDailyCount || 0;

                        if (isFuture) {
                          return (
                            <div className="flex flex-col items-start gap-0.5">
                              {effectiveTenantId && effectiveTenantName ? (
                                <button
                                  type="button"
                                  onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                                  className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                                >
                                  <User className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate max-w-[100px]">{effectiveTenantName}</span>
                                  <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                                </button>
                              ) : null}
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                จองล่วงหน้า
                              </span>
                            </div>
                          );
                        }

                        if (isEligibleAddTenantCycle) {
                          const hasTenant = Boolean(effectiveTenantId && effectiveTenantName);
                          return (
                            <div className="flex items-center gap-2">
                              {hasTenant && (
                                <div className="flex flex-col items-start gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                                    className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                                  >
                                    {peopleCountVal > 1 ? (
                                      <Users className="w-3.5 h-3.5 shrink-0" />
                                    ) : (
                                      <User className="w-3.5 h-3.5 shrink-0" />
                                    )}
                                    <span className="truncate max-w-[100px]">{effectiveTenantName}</span>
                                    <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                                  </button>
                                  {!isLineLinked && (
                                    <span className="text-[10px] text-slate-400 font-normal leading-tight">
                                      (ยังไม่ได้เชื่อม LINE)
                                    </span>
                                  )}
                                  {historicalDailyCount > 0 && (
                                    <span className="text-xs font-bold text-slate-700">
                                      ผู้เช่ารายวัน {historicalDailyCount} คน
                                    </span>
                                  )}
                                </div>
                              )}
                              {!hasTenant && historicalDailyCount > 0 && (
                                <span className="text-xs font-bold text-slate-700">
                                  ผู้เช่ารายวัน {historicalDailyCount} คน
                                </span>
                              )}
                              {hasBookableGap && (room || row.roomId) && (
                                <button
                                  type="button"
                                  disabled={quickAddLoadingRoomId === (room?.id || row.roomId)}
                                  onClick={async () => {
                                    const targetRoomId = room?.id || row.roomId;
                                    try {
                                      setQuickAddLoadingRoomId(targetRoomId);
                                      const dormId = dormitoryId || localStorage.getItem('horplus_current_dormitory_id') || localStorage.getItem('selected_dormitory_id') || '';
                                      const res = await httpRequest<{ data: QuickAddRoomContext }>(
                                        'GET',
                                        `/api/v1/properties/rooms/${targetRoomId}/quick-add-context`,
                                        undefined,
                                        { headers: dormId ? { 'x-dormitory-id': dormId } : {} }
                                      );

                                      if (!res.data || !res.data.effective) {
                                        throw new Error('ไม่สามารถโหลดข้อมูลสิทธิ์และค่าเช่าห้องพักได้');
                                      }

                                      setSelectedQuickAddContext(res.data);
                                      setQuickAddModalOpen(true);
                                    } catch (err: any) {
                                      showToast(mapErrorMessageToThai(err.message || 'ไม่สามารถโหลดข้อมูลห้องพักได้ กรุณาลองใหม่อีกครั้ง'), 'error');
                                    } finally {
                                      setQuickAddLoadingRoomId(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200 transition-all cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                                >
                                  {quickAddLoadingRoomId === (room?.id || row.roomId) ? (
                                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                  ) : (
                                    <Plus className="w-3 h-3 shrink-0" />
                                  )}
                                  <span className="whitespace-nowrap">เพิ่มผู้เช่า</span>
                                </button>
                              )}
                              {!hasTenant && !hasBookableGap && (
                                <span className="text-gray-400">ไม่มีข้อมูล</span>
                              )}
                            </div>
                          );
                        }

                        // Historical cycles outside rolling action window
                        const hasMonthly = Boolean(effectiveTenantId && effectiveTenantName);
                        const hasDaily = historicalDailyCount > 0;

                        if (hasMonthly && hasDaily) {
                          return (
                            <div className="flex flex-col items-start gap-1">
                              <button
                                type="button"
                                onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                                className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                              >
                                <User className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate max-w-[100px]">{effectiveTenantName}</span>
                                <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                              </button>
                              <span className="text-xs font-bold text-slate-700">
                                ผู้เช่ารายวัน {historicalDailyCount} คน
                              </span>
                            </div>
                          );
                        }

                        if (hasMonthly) {
                          return (
                            <button
                              type="button"
                              onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                              className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                            >
                              {peopleCountVal > 1 ? (
                                <Users className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <User className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span className="truncate max-w-[100px]">{effectiveTenantName}</span>
                              <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                            </button>
                          );
                        }

                        if (hasDaily) {
                          return (
                            <span className="text-xs font-bold text-slate-700">
                              ผู้เช่ารายวัน {historicalDailyCount} คน
                            </span>
                          );
                        }

                        return <span className="text-gray-400">ไม่มีข้อมูล</span>;
                      })()}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6 + (isElecUnit ? 2 : 0) + (isWaterUnit ? 2 : 0)} className="p-8 text-center text-gray-400">
                    ไม่พบข้อมูลห้องพักพักอาศัยที่ต้องการ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Floating Save Button - ONLY shown when changes exist (isDirty is true), always visible without scrolling */}
        {isDirty && (
          <div className="fixed bottom-[84px] md:bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-8 w-[calc(100%-32px)] md:w-auto z-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="relative w-full md:w-auto group">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveMeters}
                className={`relative w-full md:w-auto px-8 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-black text-xs md:text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-2xl transition-all select-none border border-indigo-400/40 ${
                  isSaving
                    ? 'opacity-85 cursor-not-allowed'
                    : 'hover:from-indigo-550 hover:to-blue-550 hover:scale-[1.03] active:scale-95 cursor-pointer'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin shrink-0" />
                    <span className="tracking-wide">กำลังบันทึก...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 md:w-5 md:h-5 animate-bounce shrink-0" />
                    <span className="tracking-wide">บันทึกข้อมูล</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Fill Modal */}
      {isQuickFillOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl border border-gray-100 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">

            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="bg-emerald-500 text-white rounded-full flex items-center justify-center w-11 h-11 shadow-md shadow-emerald-500/20">
                  <Zap className="w-5 h-5 fill-white text-emerald-300" />
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-slate-900 leading-tight">กรอกแบบรวดเร็ว</h4>
                  <p className="text-[11px] text-gray-400 font-bold mt-0.5 leading-none">วางข้อมูลหลายห้อง ระบบจะใส่ลงตารางให้</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickFillOpen(false);
                  setTemplateUsed(false);
                }}
                className="text-rose-500 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-full p-2 cursor-pointer flex items-center justify-center transition-all shadow-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template Section & Textarea Container with stable, non-jittery height */}
            <div className="flex flex-col gap-4 h-[320px] justify-between shrink-0">
              {/* Template Section: only show if text is <= 1 line */}
              {quickFillText.split('\n').filter(l => l.trim()).length <= 1 && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col gap-2 shrink-0 h-[112px] justify-center">
                  <span className="text-xs font-black text-slate-800 leading-none text-left">รูปแบบ</span>
                  <div className="bg-white border border-gray-200 rounded-xl p-3 font-mono text-xs text-slate-600 flex items-center justify-start text-left shadow-2xs leading-relaxed whitespace-nowrap overflow-x-auto select-all no-scrollbar">
                    {getTemplateFormatString()}
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold leading-none mt-0.5 text-left">ถ้าไม่มีค้าง ไม่ต้องใส่ข้อมูลค้างก็ได้</span>
                </div>
              )}

              {/* Input Text Area - Single, Persistent to preserve focus */}
              <div
                className="flex flex-col gap-1 w-full shrink-0 transition-all duration-300"
                style={{
                  height: quickFillText.split('\n').filter(l => l.trim()).length <= 1 ? '192px' : '320px'
                }}
              >
                <textarea
                  ref={quickFillInputRef}
                  value={quickFillText}
                  onChange={(e) => setQuickFillText(e.target.value)}
                  wrap="off"
                  placeholder="วางข้อมูลหลายห้องที่นี่ . . ."
                  className="w-full h-full p-4 border border-gray-200 rounded-2xl bg-white text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none transition-all placeholder:text-gray-300 shadow-2xs overflow-x-auto whitespace-pre"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between gap-2.5 mt-2 flex-nowrap">
              {templateUsed ? (
                <button
                  type="button"
                  disabled
                  className="border border-gray-200 bg-gray-50 text-gray-400 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-1 cursor-not-allowed select-none whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 shrink-0" />
                  ใช้แม่แบบแล้ว
                </button>
              ) : (
                <button
                  type="button"
                  onClick={async () => {
                    let freshHouseholdMap = new Map<string, number>();
                    try {
                      const res = await httpRequest<{ success: boolean; data: Array<{ roomId: string; currentHouseholdPeopleCount: number }> }>(
                        'GET',
                        `/api/v1/meters/workspace/household-counts?billingCycleId=${selectedBillingCycleId}`,
                        undefined,
                        { headers: currentDormId ? { 'x-dormitory-id': currentDormId } : {} }
                      );
                      if (res?.data && Array.isArray(res.data)) {
                        res.data.forEach(h => freshHouseholdMap.set(h.roomId, h.currentHouseholdPeopleCount));
                      } else {
                        showToast('ไม่สามารถดึงจำนวนคนปัจจุบันได้ กรุณาลองอีกครั้ง');
                        return;
                      }
                    } catch {
                      showToast('ไม่สามารถดึงจำนวนคนปัจจุบันได้ กรุณาลองอีกครั้ง');
                      return;
                    }

                    const txt = generateTemplateText(freshHouseholdMap);
                    setQuickFillText(txt);
                    setTemplateUsed(true);
                    setTimeout(() => {
                      quickFillInputRef.current?.focus();
                    }, 50);
                  }}
                  className="border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-98 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                  ใช้แม่แบบ
                </button>
              )}

              <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsQuickFillOpen(false);
                    setTemplateUsed(false);
                  }}
                  className="border border-gray-200 hover:bg-gray-50 text-slate-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer active:scale-98 whitespace-nowrap shrink-0"
                >
                  ยกเลิก
                </button>

                {quickFillText.trim() === '' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          setQuickFillText(text);
                          showToast("วางข้อมูลจากคลิปบอร์ดแล้ว!");
                        } else {
                          showToast("คลิปบอร์ดว่างเปล่า หรือกรุณากดวาง (Ctrl+V)");
                        }
                        setTimeout(() => {
                          quickFillInputRef.current?.focus();
                        }, 50);
                      } catch (e) {
                        showToast("กรุณากดวาง (Ctrl+V) ข้อความด้วยตนเอง");
                        setTimeout(() => {
                          quickFillInputRef.current?.focus();
                        }, 50);
                      }
                    }}
                    className="bg-slate-950 hover:bg-slate-900 text-white font-bold text-[10px] sm:text-xs px-3 sm:px-5 py-2.5 rounded-xl transition-all shadow-md shadow-slate-950/10 cursor-pointer active:scale-98 flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    วางข้อความที่คัดลอก
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!isMutationReady}
                    onClick={handleApplyQuickFill}
                    className="bg-slate-950 hover:bg-slate-900 disabled:opacity-50 text-white font-bold text-[10px] sm:text-xs px-3 sm:px-5 py-2.5 rounded-xl transition-all shadow-md shadow-slate-950/10 cursor-pointer active:scale-98 flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    ต่อไป
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* LINE Notification Modal Popup */}
      <LineNotificationModal
        isOpen={isLineModalOpen}
        onClose={() => {
          setIsLineModalOpen(false);
        }}
        bills={bills}
        tenants={tenants}
        rooms={rooms}
        contracts={contracts}
        selectedCycle={selectedCycle}
        onSaveBills={onSaveBills}
        onAddLog={onAddLog}
        onShowToast={showToast}
      />

      {/* Quick Add Tenant Modal (3 Types: TERM, MONTHLY, DAILY) */}
      <QuickAddTenantModal
        isOpen={quickAddModalOpen}
        onClose={() => {
          setQuickAddModalOpen(false);
          setSelectedQuickAddContext(null);
        }}
        context={selectedQuickAddContext}
        onSuccess={async (msg) => {
          showToast(msg);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId), refetchType: 'active' }),
            queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId), refetchType: 'active' }),
            queryClient.invalidateQueries({ queryKey: queryKeys.rooms(currentDormId), refetchType: 'active' }),
            queryClient.invalidateQueries({ queryKey: queryKeys.tenants(currentDormId), refetchType: 'active' }),
            queryClient.invalidateQueries({ queryKey: queryKeys.contracts(currentDormId), refetchType: 'active' }),
          ]);
        }}
      />
    </div>
  );
};
