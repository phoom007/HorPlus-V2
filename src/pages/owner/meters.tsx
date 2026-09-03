/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  ChevronUp,
  Circle,
  AlertCircle,
  Info,
  Clock,
  Pencil,
  Table,
  LayoutList
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, STALE_TIMES } from '../../lib/queryClient';
import { meterDraftStore, deriveMeterDraftPatches } from '../../lib/meterDraftStore';
import { OwnerMeterListCard } from '../../components/meters/OwnerMeterListCard';
import { MeterOtherFeesModal } from '../../components/meters/MeterOtherFeesModal';
import {
  calculateMeterRowPreview,
  calculateMeterUsageUnits,
  isMeterBasedUtilityMode,
  calculateProgressiveTieredChargeLocal,
  RoomPreviewContext,
  parseScaled2,
  formatScaled2,
  parseSatang,
  formatSatang,
  formatMoneyDisplay,
} from '../../utils/meterBillingCalculator';
import { isCycleInRollingThreeMonthWindow, toBangkokDateString, normalizeBangkokDate, formatShortThaiBuddhistDate } from '../../utils/calendarDate';
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
  } catch { }
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
  onNavigateToLineConfig?: () => void;
  selectedBillingCycleId: string;
  selectedCycleCode: string;
  selectedCycle?: string;
  billingCycles?: any[];
  onRefetchData?: () => void;
}

export interface MeterRowState {
  roomId: string;
  roomNumber: string;
  buildingId?: string;
  buildingCode?: string;
  buildingName?: string;
  waterPrev: number | string;
  waterCurr: number | string;
  elecPrev: number | string;
  elecCurr: number | string;
  isReplaced: boolean;
  peopleCount: number;
  overdueAmount: number | string;
  isPaid: boolean;
  billStatus: BillStatus;
  overallFinancialStatus?: string;
  monthlyUtilityBillStatus?: string;
  isMonthlyUtilityPaid?: boolean;
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
  const nextMonthDate = new Date(Date.UTC(cy, cm, 1));
  const cycleEndExclusive = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}-${String(nextMonthDate.getUTCDate()).padStart(2, '0')}`;

  const activeContract = (contracts || []).find(c => {
    if (c.roomId !== roomId) return false;
    const startValStr = normalizeBangkokDate(c.startDate);
    const endValStr = normalizeBangkokDate(c.endDate);
    const createdStr = (c as any).createdAt ? normalizeBangkokDate((c as any).createdAt) : startValStr;
    const effectiveStartStr = startValStr > createdStr ? startValStr : createdStr;

    return effectiveStartStr < cycleEndExclusive && endValStr > cycleStartStr;
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
  buildings?: Building[];
  selectedBillingCycleId?: string;
  selectedCycleCode?: string;
  selectedCycle?: string;
  currentDormId?: string;
  isFirstCycle?: boolean;
}): { rows: MeterRowState[]; originalRows: MeterRowState[] } {
  const {
    workspaceData,
    rooms,
    bills,
    contracts = [],
    tenants = [],
    buildings = [],
    selectedBillingCycleId,
    selectedCycleCode,
    selectedCycle,
    currentDormId,
    isFirstCycle,
  } = params;
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

    const waterPrev = roomReadings.waterPrev !== undefined && roomReadings.waterPrev !== null && String(roomReadings.waterPrev).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.waterPrev)
      : '';
    const waterCurr = roomReadings.waterCurr !== undefined && roomReadings.waterCurr !== null && String(roomReadings.waterCurr).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.waterCurr)
      : '';

    const elecPrev = roomReadings.elecPrev !== undefined && roomReadings.elecPrev !== null && String(roomReadings.elecPrev).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.elecPrev)
      : '';
    const elecCurr = roomReadings.elecCurr !== undefined && roomReadings.elecCurr !== null && String(roomReadings.elecCurr).trim() !== ''
      ? formatMeterReadingDisplay(roomReadings.elecCurr)
      : '';

    const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 1;
    const snap = snapshotMap[r.id];
    let rowPeople: number;
    if (snap?.peopleCount !== undefined) {
      rowPeople = Math.max(0, snap.peopleCount);
    } else if (isFirstCycle) {
      rowPeople = 1;
    } else {
      rowPeople = tenantDefaultPeople;
    }

    const existingMonthlyUtilityBill = (bills || []).find(b =>
      (b.cycleId === selectedBillingCycleId || b.cycleId === selectedCycleCode || (b as any).billingCycleId === selectedBillingCycleId || (b as any).cycleMonth === selectedCycleCode) &&
      (b.roomId === r.id || b.roomId === r.roomNumber) &&
      (!b.billKind || b.billKind === 'MONTHLY_UTILITY' || b.billKind === 'LEGACY_COMBINED' || (b.billKind as string).toUpperCase() === 'MONTHLY_UTILITY' || (b.billKind as string).toUpperCase() === 'LEGACY_COMBINED') &&
      (b.status as string) !== 'cancelled' && (b.status as string) !== 'void'
    );
    const previewRooms = workspaceData?.previewContext?.rooms || workspaceData?.rooms || [];
    const roomCtx = previewRooms.find((ctx: any) => ctx.roomId === r.id);
    const overallFinancialStatus = (roomCtx?.overallFinancialStatus as BillStatus) || (roomCtx?.billStatus as BillStatus) || (existingMonthlyUtilityBill ? existingMonthlyUtilityBill.status : 'draft');
    const monthlyUtilityBillStatus =
      (roomCtx?.monthlyUtilityBillStatus as string)
      || (existingMonthlyUtilityBill
          ? existingMonthlyUtilityBill.status
          : 'draft');
    const isMonthlyUtilityPaid =
      Boolean(
        roomCtx?.isMonthlyUtilityPaid
        || monthlyUtilityBillStatus === 'paid'
      );
    const isPaid =
      overallFinancialStatus === 'paid'
      || Boolean(roomCtx?.isPaid);
    const bld = (buildings || []).find(b => b.id === r.buildingId);
    const bCode = bld?.code || (bld?.name ? bld.name.replace(/^อาคาร\s*/, '').trim() : 'A');
    const bName = bld?.name || `อาคาร ${bCode}`;

    return {
      roomId: r.id,
      roomNumber: r.roomNumber,
      buildingId: r.buildingId,
      buildingCode: bCode,
      buildingName: bName,
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
      billStatus: overallFinancialStatus,
      overallFinancialStatus,
      monthlyUtilityBillStatus,
      isMonthlyUtilityPaid,
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

export interface CanonicalLineItem {
  id?: string;
  type: string;
  description: string;
  quantity: string;
  unit?: string | null;
  unitPrice: string;
  amount: string;
  metadata?: any;
}

export interface TopLevelFinancialComponent {
  type?: string;
  label: string;
  amount: number;
  formattedAmount: string;
  status: 'PREVIEW' | 'UNPAID' | 'PAID' | 'INVALID';
  title: string;
  errorMessage?: string;
  lineItems?: CanonicalLineItem[];
}

export interface OwnerFinancialBreakdown {
  operationalAmount: number;
  formattedAmount: string;
  components: TopLevelFinancialComponent[];
}

/**
 * Formats monetary amounts for component detail rows:
 * - Whole-baht amounts use compact PO notation: e.g. 650.00 -> "650.-", 4800.00 -> "4,800.-"
 * - Amounts with fractional satang preserve decimals: e.g. 650.50 -> "650.50"
 */
export function formatComponentDetailAmount(amt: number | string): string {
  const num = typeof amt === 'number' ? amt : parseFloat(String(amt).replace(/,/g, '')) || 0;
  if (Number.isInteger(num)) {
    return `${num.toLocaleString('th-TH')}.-`;
  }
  return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function calculateAutoScrollDelta(
  clientY: number,
  containerRect: { top: number; bottom: number },
  edgeThreshold = 35,
  scrollStep = 10
): number {
  if (clientY < containerRect.top + edgeThreshold) {
    return -scrollStep;
  }
  if (clientY > containerRect.bottom - edgeThreshold) {
    return scrollStep;
  }
  return 0;
}

export function isRowDraftDirty(row?: any, originalRow?: any): boolean {
  if (!row) return false;
  if (originalRow) {
    return (
      String(row.waterCurr ?? '') !== String(originalRow.waterCurr ?? '') ||
      String(row.waterPrev ?? '') !== String(originalRow.waterPrev ?? '') ||
      String(row.elecCurr ?? '') !== String(originalRow.elecCurr ?? '') ||
      String(row.elecPrev ?? '') !== String(originalRow.elecPrev ?? '') ||
      String(row.peopleCount ?? '') !== String(originalRow.peopleCount ?? '') ||
      String(row.overdueAmount ?? '') !== String(originalRow.overdueAmount ?? '') ||
      JSON.stringify(row.otherFees || []) !== JSON.stringify(originalRow.otherFees || [])
    );
  }
  return (
    (row.waterCurr !== undefined && row.waterCurr !== '') ||
    (row.elecCurr !== undefined && row.elecCurr !== '') ||
    (row.waterPrev !== undefined && row.waterPrev !== '') ||
    (row.elecPrev !== undefined && row.elecPrev !== '')
  );
}

export function getOwnerFinancialBreakdown(
  roomCtxOrRow: any,
  rowOrRoomCtx?: any,
  rateSnapshotParam?: any,
  originalRowParam?: any
): OwnerFinancialBreakdown {
  let roomCtx: any = null;
  let row: any = null;
  let rateSnapshot: any = rateSnapshotParam;
  let originalRow: any = originalRowParam;

  if (roomCtxOrRow && (roomCtxOrRow.chargeComponents || roomCtxOrRow.amountDue !== undefined || roomCtxOrRow.roomId || roomCtxOrRow.billingSource)) {
    roomCtx = roomCtxOrRow;
    row = rowOrRoomCtx;
  } else if (rowOrRoomCtx && (rowOrRoomCtx.chargeComponents || rowOrRoomCtx.amountDue !== undefined || rowOrRoomCtx.roomId || rowOrRoomCtx.billingSource)) {
    roomCtx = rowOrRoomCtx;
    row = roomCtxOrRow;
  } else {
    roomCtx = roomCtxOrRow;
  }

  const effectiveRateSnapshot = rateSnapshot || roomCtx?.rateSnapshot;

  const rawAmountDue = roomCtx?.amountDue ?? '0.00';
  const components: TopLevelFinancialComponent[] = (roomCtx?.chargeComponents || []).map((c: any) => {
    const rawAmt = c.amount ?? '0.00';
    const status = (c.status || 'UNPAID') as TopLevelFinancialComponent['status'];
    let title = 'รอชำระเงิน';
    if (status === 'PAID') title = 'ชำระแล้ว';
    else if (status === 'PREVIEW') title = 'ยังไม่ออกบิล (พรีวิว)';
    else if (status === 'INVALID') title = c.errorMessage || 'รูปแบบการคิดค่าบริการไม่ถูกต้อง';

    const normalizedType = (c.type || 'monthly_utility').toLowerCase();

    return {
      type: normalizedType,
      label: c.label || 'บิลรายเดือน',
      amount: typeof rawAmt === 'number' ? rawAmt : parseFloat(String(rawAmt).replace(/,/g, '')) || 0,
      formattedAmount: formatMoneyDisplay(rawAmt),
      status,
      title,
      errorMessage: c.errorMessage,
      lineItems: c.lineItems || [],
    };
  });

  // Precedence Rules A, B, C:
  // A. Issued/persisted financial Bill: SERVER persisted BillItem wins.
  // B. Unissued server PREVIEW + NO unsaved row changes: SERVER preview displayed.
  // C. Unissued server PREVIEW + current row has unsaved changes: LOCAL exact preview overlay.
  const overallStatus = (roomCtx?.overallFinancialStatus as string) || (roomCtx?.billStatus as string) || row?.billStatus || 'draft';
  const muStatus = (roomCtx?.monthlyUtilityBillStatus as string) || (row as any)?.monthlyUtilityBillStatus || row?.billStatus || 'draft';
  const isMuPaid = Boolean(roomCtx?.isMonthlyUtilityPaid || (row as any)?.isMonthlyUtilityPaid || muStatus === 'paid');
  const isMuIssued = (muStatus !== 'draft' && muStatus !== 'cancelled') || isMuPaid;
  const isDailyContext = roomCtx?.billingSource === 'DAILY_STAY';
  const hasNoServerComponents = components.length === 0 && Boolean(row && (row.waterCurr !== '' || row.elecCurr !== ''));
  const isDirty = isRowDraftDirty(row, originalRow);

  if (!isMuIssued && !isDailyContext && row && (isDirty || hasNoServerComponents)) {
    const localPreview = calculateMeterRowPreview(roomCtx, effectiveRateSnapshot, row);

    const monthlyIdx = components.findIndex(c => c.type === 'monthly_utility' || c.type === 'legacy_combined');
    const previewAmountNum = parseFloat(localPreview.totalAmount) || 0;
    const previewFormatted = formatMoneyDisplay(localPreview.totalAmount);
    const previewStatus: TopLevelFinancialComponent['status'] = localPreview.status === 'INVALID' ? 'INVALID' : 'PREVIEW';
    const previewTitle = localPreview.status === 'INVALID' ? (localPreview.errorMessage || 'รูปแบบการคิดค่าบริการไม่ถูกต้อง') : 'ยังไม่ออกบิล (พรีวิว)';

    if (monthlyIdx >= 0) {
      components[monthlyIdx] = {
        ...components[monthlyIdx],
        amount: previewAmountNum,
        formattedAmount: previewFormatted,
        status: previewStatus,
        title: previewTitle,
        errorMessage: localPreview.errorMessage,
      };
    } else {
      components.push({
        type: 'monthly_utility',
        label: 'บิลรายเดือน',
        amount: previewAmountNum,
        formattedAmount: previewFormatted,
        status: previewStatus,
        title: previewTitle,
        errorMessage: localPreview.errorMessage,
        lineItems: [],
      });
    }

    // Recompute total operational amountDue using exact Satang arithmetic
    let totalSatang = 0n;
    for (const c of components) {
      if (c.status !== 'PAID') {
        totalSatang += parseSatang(c.formattedAmount);
      }
    }
    const finalAmountStr = formatSatang(totalSatang);

    return {
      operationalAmount: parseFloat(finalAmountStr) || 0,
      formattedAmount: formatMoneyDisplay(finalAmountStr),
      components,
    };
  }

  return {
    operationalAmount: typeof rawAmountDue === 'number' ? rawAmountDue : parseFloat(String(rawAmountDue).replace(/,/g, '')) || 0,
    formattedAmount: formatMoneyDisplay(rawAmountDue),
    components,
  };
}

export interface OwnerMeterDisplayStatus {
  statusKey: 'UNISSUED' | 'UNPAID' | 'PAID' | 'DAILY_OVERDUE' | 'DAILY_PAID' | 'DAILY_UNPAID';
  label: string;
  tone: 'neutral' | 'warning' | 'success' | 'danger';
  isDaily: boolean;
  isMonthlyUtilityIssued: boolean;
  isMonthlyUtilityPaid: boolean;
  isOverallPaid: boolean;
  hasValidationError?: boolean;
}

export function resolveFinancialComponentTone(status?: string): 'neutral' | 'warning' | 'success' | 'danger' {
  if (status === 'PAID') return 'success';
  if (status === 'UNPAID') return 'warning';
  if (status === 'INVALID') return 'danger';
  return 'neutral';
}

/**
 * Canonical Presentation Status Resolver for Owner Meter Workspace (Table & List).
 * Product Owner Lifecycle Rules (Decisions P1-P4):
 * "ไม่ถูกต้อง" is NOT a bill status.
 *
 * 1. Daily context -> DAILY_OVERDUE / DAILY_PAID / DAILY_UNPAID ("รายวัน")
 * 2. Unissued Monthly Utility (!isMuIssued) -> UNISSUED ("ยังไม่ออกบิล", neutral tone, toggle OFF)
 * 3. Issued Monthly Utility + overall paid -> PAID ("ชำระแล้ว", success tone)
 * 4. Issued Monthly Utility + overall unpaid -> UNPAID ("รอชำระ", warning tone)
 */
export function resolveOwnerMeterDisplayStatus(roomCtx?: any, row?: any): OwnerMeterDisplayStatus {
  const isDailyContext = roomCtx?.billingSource === 'DAILY_STAY' || Boolean(roomCtx?.isDailyUnpaid) || Boolean(roomCtx?.isDailyFinancialTail);
  const isDailyOverdue = Boolean(roomCtx?.isDailyOverdue || roomCtx?.isDailyFinancialTail);
  const isDailyRentPaid = Boolean(roomCtx?.isDailyRentPaid);
  const hasHistoricalDaily = (roomCtx?.historicalDailyCount || 0) > 0;
  const hasMonthlyContractOrBill = Boolean(
    roomCtx?.billingSource === 'CONTRACT' ||
    roomCtx?.billingSource === 'PROVISIONAL_MONTHLY' ||
    roomCtx?.billingSource === 'PROVISIONAL_TERM' ||
    (row?.billStatus && row.billStatus !== 'draft' && row.billStatus !== 'cancelled')
  );

  const overallStatus = (roomCtx?.overallFinancialStatus as string) || (roomCtx?.billStatus as string) || row?.billStatus || 'draft';
  const muStatus = (roomCtx?.monthlyUtilityBillStatus as string) || (row as any)?.monthlyUtilityBillStatus || row?.billStatus || 'draft';
  const isMuPaid = Boolean(roomCtx?.isMonthlyUtilityPaid || (row as any)?.isMonthlyUtilityPaid || muStatus === 'paid');
  const isMuIssued = muStatus !== 'draft' && muStatus !== 'cancelled';
  const isOverallPaid = overallStatus === 'paid' || Boolean(roomCtx?.isPaid) || Boolean(row?.isPaid);

  const hasValidationError = Boolean(
    row?.meterValidationError ||
    (roomCtx?.chargeComponents || []).some((c: any) => c.status === 'INVALID')
  );

  // 1. Daily context
  if (isDailyContext || (hasHistoricalDaily && !hasMonthlyContractOrBill)) {
    if (isDailyOverdue) {
      return {
        statusKey: 'DAILY_OVERDUE',
        label: 'รายวัน',
        tone: 'danger',
        isDaily: true,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: false,
        hasValidationError,
      };
    }
    if (isDailyRentPaid) {
      return {
        statusKey: 'DAILY_PAID',
        label: 'รายวัน',
        tone: 'success',
        isDaily: true,
        isMonthlyUtilityIssued: false,
        isMonthlyUtilityPaid: false,
        isOverallPaid: true,
        hasValidationError,
      };
    }
    return {
      statusKey: 'DAILY_UNPAID',
      label: 'รายวัน',
      tone: 'neutral',
      isDaily: true,
      isMonthlyUtilityIssued: false,
      isMonthlyUtilityPaid: false,
      isOverallPaid: false,
      hasValidationError,
    };
  }

  // 2. DECISION P2: If MONTHLY_UTILITY unissued -> ALWAYS "ยังไม่ออกบิล" (neutral tone, toggle OFF)
  if (!isMuIssued) {
    return {
      statusKey: 'UNISSUED',
      label: 'ยังไม่ออกบิล',
      tone: 'neutral',
      isDaily: false,
      isMonthlyUtilityIssued: false,
      isMonthlyUtilityPaid: false,
      isOverallPaid: false,
      hasValidationError,
    };
  }

  // 3. Issued: S1 overall financial status
  if (isOverallPaid) {
    return {
      statusKey: 'PAID',
      label: 'ชำระแล้ว',
      tone: 'success',
      isDaily: false,
      isMonthlyUtilityIssued: true,
      isMonthlyUtilityPaid: isMuPaid,
      isOverallPaid: true,
      hasValidationError,
    };
  }

  return {
    statusKey: 'UNPAID',
    label: 'รอชำระ',
    tone: 'warning',
    isDaily: false,
    isMonthlyUtilityIssued: true,
    isMonthlyUtilityPaid: isMuPaid,
    isOverallPaid: false,
    hasValidationError,
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
  if (code === 'CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL') {
    return 'ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน';
  }
  if (code === 'UNSUPPORTED_AMOUNT') {
    return 'ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล';
  }
  if (code === 'ALREADY_PAID') {
    return 'บิลนี้ได้รับการชำระเงินแล้ว';
  }
  if (code === 'PAYMENT_IN_PROGRESS') {
    return 'มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลนี้แล้ว';
  }
  if (code === 'BILL_NOT_FOUND') {
    return 'ไม่พบข้อมูลบิลที่ระบุ';
  }
  if (code === 'FORBIDDEN') {
    return 'ไม่มีสิทธิ์ดำเนินการกับบิลนี้';
  }
  if (code === 'IDEMPOTENCY_MISMATCH') {
    return 'ข้อมูลการทำรายการไม่ตรงกับ Idempotency Key เดิม';
  }
  if (code === 'CONCURRENT_REQUEST_IN_PROGRESS') {
    return 'มีคำขอกำลังประมวลผลอยู่ กรุณารอสักครู่';
  }
  if (code === 'DUPLICATE_PAYMENT_EVIDENCE') {
    return 'มีการแนบหลักฐานการชำระเงินนี้ไปแล้ว';
  }
  if (code === 'ACTIVE_REVIEW_EXISTS') {
    return 'มีรายการชำระเงินที่รอตรวจสอบอยู่แล้ว';
  }
  if (code === 'INTERNAL_ERROR') {
    return 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
  }
  if (code === 'MISSING_WATER_METER_READING' || code === 'MISSING_METER_READING') {
    return 'กรุณากรอกเลขมิเตอร์น้ำของงวดนี้ก่อนออกบิล';
  }
  if (code === 'MISSING_ELECTRICITY_METER_READING') {
    return 'กรุณากรอกเลขมิเตอร์ไฟฟ้าของงวดนี้ก่อนออกบิล';
  }
  if (code === 'INVALID_METER_READING') {
    return 'ค่ามิเตอร์ไม่ถูกต้อง (ต้องเป็นจำนวนเต็ม 0 ถึง 99999)';
  }
  if (code === 'INVALID_METER_READING_LOWER') {
    return 'เลขมิเตอร์ปัจจุบันต้องไม่น้อยกว่าเลขมิเตอร์ครั้งก่อน';
  }
  if (code === 'INVALID_BILLING_MODE') {
    return 'ประเภทการคิดค่าบริการไม่ถูกต้อง';
  }
  if (code === 'MISSING_RATE_SNAPSHOT') {
    return 'ไม่พบข้อมูลอัตราค่าบริการ';
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
  if (msg.includes('CANNOT_CLEAR_METER_READING_FOR_ISSUED_BILL')) {
    return 'ห้องนี้มีบิลที่ออกแล้ว หากต้องการล้างเลขมิเตอร์ปัจจุบัน กรุณายกเลิกบิลก่อน';
  }
  if (msg.includes('UNSUPPORTED_AMOUNT')) {
    return 'ยอดเงินที่ชำระไม่ตรงกับยอดคงเหลือของบิล';
  }
  if (msg.includes('ALREADY_PAID')) {
    return 'บิลนี้ได้รับการชำระเงินแล้ว';
  }
  if (msg.includes('PAYMENT_IN_PROGRESS')) {
    return 'มีรายการชำระเงินที่อยู่ระหว่างรอการตรวจสอบสำหรับบิลนี้แล้ว';
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

  // Mask database / Prisma / SQL internal leaks
  if (
    /prisma|select\s+|insert\s+|update\s+|delete\s+|where\s+|constraint|foreign\s+key|table\s+"|column\s+"/i.test(msg) ||
    /prisma/i.test(String(raw?.stack || ''))
  ) {
    return 'ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง';
  }

  return msg || 'เกิดข้อผิดพลาดในการดำเนินการ';
}

export function isResolvedBaseline(val: any): boolean {
  if (val === null || val === undefined) return false;

  if (typeof val === 'number') {
    return Number.isInteger(val) && val >= 0 && val <= 99999;
  }

  const str = String(val).trim();
  if (str === '') return false;

  // Accept pure integer strings (1-5 digits: 0..99999)
  if (/^\d{1,5}$/.test(str)) {
    const num = parseInt(str, 10);
    return !isNaN(num) && num >= 0 && num <= 99999;
  }

  // Accept Postgres Decimal representations with all-zero fractional part (e.g. "0.00", "560.00", "99999.00")
  if (/^\d{1,5}\.0+$/.test(str)) {
    const intPart = str.split('.')[0];
    const num = parseInt(intPart, 10);
    return !isNaN(num) && num >= 0 && num <= 99999;
  }

  return false;
}

export function computeHasPersistedBaseline(params: {
  isRateSnapshotReady: boolean;
  isMeterWorkspaceReady: boolean;
  isWaterUnit: boolean;
  isElecUnit: boolean;
  rooms: Array<{ id: string; status?: string; rentCycle?: string }>;
  serverReadings: any[];
  previewRooms?: Array<{ roomId: string; billingSource?: string; isDailyUnpaid?: boolean }>;
}): boolean {
  const { isRateSnapshotReady, isMeterWorkspaceReady, isWaterUnit, isElecUnit, rooms = [], serverReadings = [], previewRooms } = params;
  if (!isRateSnapshotReady || !isMeterWorkspaceReady) {
    return false;
  }

  // Non-meter modes: if neither utility is per_unit, no meter baseline is required
  if (!isWaterUnit && !isElecUnit) {
    return true;
  }

  const applicableRooms = rooms.filter((room) => {
    if ((room.status as string) === 'archived') return false;
    return true;
  });

  if (applicableRooms.length === 0) {
    return false;
  }

  const waterBaselineByRoom = new Map<string, any>();
  const elecBaselineByRoom = new Map<string, any>();

  for (const r of serverReadings) {
    if (!r) continue;
    // Format A: { roomId, meterType: 'water' | 'electricity', previousReading }
    if (r.meterType === 'water') {
      waterBaselineByRoom.set(r.roomId, r.previousReading);
    } else if (r.meterType === 'electricity' || r.meterType === 'electric') {
      elecBaselineByRoom.set(r.roomId, r.previousReading);
    }
    // Format B: { roomId, waterPrevious, electricPrevious } (legacy / combined DTO)
    if (r.waterPrevious !== undefined && r.waterPrevious !== null) {
      waterBaselineByRoom.set(r.roomId, r.waterPrevious);
    }
    if (r.electricPrevious !== undefined && r.electricPrevious !== null) {
      elecBaselineByRoom.set(r.roomId, r.electricPrevious);
    }
  }

  // Every applicable room must satisfy applicable utility baseline requirements
  return applicableRooms.every((room) => {
    const isWaterSatisfied = !isWaterUnit || isResolvedBaseline(waterBaselineByRoom.get(room.id));
    const isElecSatisfied = !isElecUnit || isResolvedBaseline(elecBaselineByRoom.get(room.id));
    return isWaterSatisfied && isElecSatisfied;
  });
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
  onNavigateToLineConfig,
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
        buildings,
        selectedBillingCycleId,
        selectedCycleCode,
        selectedCycle,
        currentDormId,
      });
    }
    return null;
  }, [buildings]);

  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'list'>(() => {
    return getStored<'table' | 'list'>('owner_meter_view_mode', 'table');
  });

  const handleViewModeChange = (mode: 'table' | 'list') => {
    setViewMode(mode);
    setStored('owner_meter_view_mode', mode);
  };

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
  const [templateMode, setTemplateMode] = useState<'FULL' | 'METER_ONLY'>('FULL');
  const [isSpreadsheetMode, setIsSpreadsheetMode] = useState(false);

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
  const originalRowsCycleIdRef = React.useRef<string>(initialBuilt ? selectedBillingCycleId || '' : '');
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
  const isWaterUnit = isRateSnapshotReady ? isMeterBasedUtilityMode(rateSnapshot.waterBillingType) : false;
  const isElecUnit = isRateSnapshotReady ? isMeterBasedUtilityMode(rateSnapshot.electricityBillingType) : false;

  // Pure Canonical Normalization & Validation Authority for Meters & Spreadsheet (Amendment 4)
  const sanitizeMeterReadingPure = (val: string): string => {
    if (!val) return '';
    return val.replace(/[^0-9]/g, '').slice(0, 5);
  };

  const normalizeMeterValuePure = (val: string): string => {
    if (!val || val.trim() === '') return '';
    const trimmed = val.trim().replace(/[^0-9]/g, '').slice(0, 5);
    if (!trimmed) return '';
    return trimmed.replace(/^0+(?=\d)/, '');
  };

  const validateAndNormalizeSpreadsheetValue = (
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount',
    rawVal: any
  ): { valid: boolean; value: string | number } => {
    if (rawVal === undefined || rawVal === null) {
      return { valid: false, value: '' };
    }
    const strVal = String(rawVal).trim();

    if (colKey === 'peopleCount') {
      // Must be a single digit integer 0..9 without extraneous characters
      if (/^[0-9]$/.test(strVal)) {
        return { valid: true, value: parseInt(strVal, 10) };
      }
      return { valid: false, value: rawVal };
    } else {
      // Meter reading: must be empty string or digits only up to 5 digits
      if (strVal === '') {
        return { valid: true, value: '' };
      }
      if (/^[0-9]{1,5}$/.test(strVal)) {
        // Strip leading zeros unless it's just "0"
        const normalized = strVal.replace(/^0+(?=\d)/, '');
        return { valid: true, value: normalized };
      }
      return { valid: false, value: rawVal };
    }
  };

  // Spreadsheet Columns Authority
  const spreadsheetColumns = useMemo(() => {
    const cols: Array<{ key: 'buildingCode' | 'roomNumber' | 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount'; editable: boolean }> = [
      { key: 'buildingCode', editable: false },
      { key: 'roomNumber', editable: false },
    ];
    if (isElecUnit) {
      cols.push({ key: 'elecPrev', editable: true });
      cols.push({ key: 'elecCurr', editable: true });
    }
    if (isWaterUnit) {
      cols.push({ key: 'waterPrev', editable: true });
      cols.push({ key: 'waterCurr', editable: true });
    }
    cols.push({ key: 'peopleCount', editable: true });
    return cols;
  }, [isElecUnit, isWaterUnit]);

  // Spreadsheet Real Drag-Fill Handle, Range Selection & Rejected Cell State
  const [activeSpreadsheetCell, setActiveSpreadsheetCell] = useState<{
    rowIndex: number;
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount';
  } | null>(null);

  const [selectedSpreadsheetRange, setSelectedSpreadsheetRange] = useState<{
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  } | null>(null);
  const isSelectingRangeRef = useRef(false);
  const rangeAnchorRef = useRef<{ row: number; col: number } | null>(null);
  const [rejectedSpreadsheetCells, setRejectedSpreadsheetCells] = useState<Record<string, boolean>>({});

  const [dragFillRange, setDragFillRange] = useState<{
    startRow: number;
    targetRow: number;
    startCol?: number;
    targetCol?: number;
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount';
  } | null>(null);

  const isDraggingFillRef = useRef(false);
  const dragFillStateRef = useRef<{
    startRow: number;
    targetRow: number;
    startCol: number;
    targetCol: number;
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount';
  } | null>(null);

  const spreadsheetScrollContainerRef = useRef<HTMLDivElement | null>(null);

  const handleFocusCell = (rowIndex: number, colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount') => {
    setActiveSpreadsheetCell({ rowIndex, colKey });
    const colIdx = spreadsheetColumns.findIndex(c => c.key === colKey);
    const validColIdx = colIdx >= 0 ? colIdx : 2;
    setSelectedSpreadsheetRange({ startRow: rowIndex, endRow: rowIndex, startCol: validColIdx, endCol: validColIdx });
    setRejectedSpreadsheetCells(prev => {
      const cellKey = `${rowIndex}:${colKey}`;
      if (!prev[cellKey]) return prev;
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });
  };

  const handlePointerDownCell = (
    e: React.PointerEvent,
    rowIndex: number,
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount'
  ) => {
    if ((e.target as HTMLElement)?.getAttribute('data-testid') === 'drag-fill-handle') return;
    document.body.style.userSelect = 'none';
    isSelectingRangeRef.current = true;
    const colIdx = spreadsheetColumns.findIndex(c => c.key === colKey);
    const validColIdx = colIdx >= 0 ? colIdx : 2;
    rangeAnchorRef.current = { row: rowIndex, col: validColIdx };
    setActiveSpreadsheetCell({ rowIndex, colKey });
    setSelectedSpreadsheetRange({ startRow: rowIndex, endRow: rowIndex, startCol: validColIdx, endCol: validColIdx });
    setRejectedSpreadsheetCells(prev => {
      const cellKey = `${rowIndex}:${colKey}`;
      if (!prev[cellKey]) return prev;
      const next = { ...prev };
      delete next[cellKey];
      return next;
    });
  };

  const handlePointerEnterCell = (
    rowIndex: number,
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount'
  ) => {
    if (!isSelectingRangeRef.current || !rangeAnchorRef.current) return;
    const colIdx = spreadsheetColumns.findIndex(c => c.key === colKey);
    const validColIdx = colIdx >= 0 ? colIdx : 2;
    setSelectedSpreadsheetRange({
      startRow: Math.min(rangeAnchorRef.current.row, rowIndex),
      endRow: Math.max(rangeAnchorRef.current.row, rowIndex),
      startCol: Math.min(rangeAnchorRef.current.col, validColIdx),
      endCol: Math.max(rangeAnchorRef.current.col, validColIdx),
    });
  };

  const isCellInRangeSelected = (r: number, cKey: string) => {
    if (!selectedSpreadsheetRange) return false;
    const minR = Math.min(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow);
    const maxR = Math.max(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow);
    if (r < minR || r > maxR) return false;
    const minC = Math.min(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol);
    const maxC = Math.max(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol);
    const colIdx = spreadsheetColumns.findIndex(col => col.key === cKey);
    return colIdx >= minC && colIdx <= maxC;
  };

  const isCellInFillPreview = (r: number, cKey: string) => {
    if (!dragFillRange) return false;
    const minR = Math.min(dragFillRange.startRow, dragFillRange.targetRow);
    const maxR = Math.max(dragFillRange.startRow, dragFillRange.targetRow);
    if (r < minR || r > maxR) return false;
    if (dragFillRange.targetCol === undefined || dragFillRange.startCol === undefined) {
      return dragFillRange.colKey === cKey;
    }
    const minC = Math.min(dragFillRange.startCol, dragFillRange.targetCol);
    const maxC = Math.max(dragFillRange.startCol, dragFillRange.targetCol);
    const colIdx = spreadsheetColumns.findIndex(col => col.key === cKey);
    return colIdx >= minC && colIdx <= maxC;
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDraggingFillRef.current) {
          isDraggingFillRef.current = false;
          dragFillStateRef.current = null;
          setDragFillRange(null);
          document.body.style.userSelect = '';
        }
        isSelectingRangeRef.current = false;
        rangeAnchorRef.current = null;
        setSelectedSpreadsheetRange(null);
        setRejectedSpreadsheetCells({});
      } else if (isSpreadsheetMode && (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (selectedSpreadsheetRange || activeSpreadsheetCell) {
          const minR = selectedSpreadsheetRange ? Math.min(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow) : activeSpreadsheetCell!.rowIndex;
          const maxR = selectedSpreadsheetRange ? Math.max(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow) : activeSpreadsheetCell!.rowIndex;
          const anchorCol = activeSpreadsheetCell ? spreadsheetColumns.findIndex(c => c.key === activeSpreadsheetCell.colKey) : 2;
          const minC = selectedSpreadsheetRange ? Math.min(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol) : anchorCol;
          const maxC = selectedSpreadsheetRange ? Math.max(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol) : anchorCol;

          const lines: string[] = [];
          for (let r = minR; r <= maxR; r++) {
            const cells: string[] = [];
            for (let c = minC; c <= maxC; c++) {
              const col = spreadsheetColumns[c];
              if (col) {
                cells.push(String(meterRows[r]?.[col.key as keyof MeterRowState] ?? ''));
              }
            }
            lines.push(cells.join('\t'));
          }
          if (lines.length > 0 && navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(lines.join('\n'));
          }
        }
      } else if (isSpreadsheetMode && (e.key === 'Delete' || e.key === 'Backspace') && !isDraggingFillRef.current) {
        const activeTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
        if (activeTag !== 'input' && selectedSpreadsheetRange) {
          e.preventDefault();
          const minR = Math.min(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow);
          const maxR = Math.max(selectedSpreadsheetRange.startRow, selectedSpreadsheetRange.endRow);
          const minC = Math.min(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol);
          const maxC = Math.max(selectedSpreadsheetRange.startCol, selectedSpreadsheetRange.endCol);

          const updated = [...meterRows];
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              const col = spreadsheetColumns[c];
              if (col && col.editable) {
                updated[r] = {
                  ...updated[r],
                  [col.key]: col.key === 'peopleCount' ? 0 : '',
                };
              }
            }
          }
          setMeterRows(updated);
          pushHistory(updated);
        }
      }
    };
    const handleGlobalPointerUp = () => {
      isSelectingRangeRef.current = false;
      rangeAnchorRef.current = null;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('pointerup', handleGlobalPointerUp);
    };
  }, [isSpreadsheetMode, selectedSpreadsheetRange, activeSpreadsheetCell, meterRows, spreadsheetColumns]);

  const handlePointerDownFillHandle = (
    e: React.PointerEvent<HTMLDivElement>,
    rowIndex: number,
    colKey: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingFillRef.current = true;
    const colIdx = spreadsheetColumns.findIndex(c => c.key === colKey);
    const validColIdx = colIdx >= 0 ? colIdx : 2;
    dragFillStateRef.current = {
      startRow: rowIndex,
      targetRow: rowIndex,
      startCol: validColIdx,
      targetCol: validColIdx,
      colKey,
    };
    setDragFillRange({
      startRow: rowIndex,
      targetRow: rowIndex,
      startCol: validColIdx,
      targetCol: validColIdx,
      colKey,
    });
    document.body.style.userSelect = 'none';
  };

  const handlePointerMoveFillHandle = (e: React.PointerEvent) => {
    if (!isDraggingFillRef.current || !dragFillStateRef.current) return;
    const container = spreadsheetScrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const delta = calculateAutoScrollDelta(e.clientY, rect, 35, 10);
    if (delta !== 0) {
      container.scrollTop += delta;
    }

    const rowElements = container.querySelectorAll<HTMLTableRowElement>('tr[data-row-index]');
    let foundRow = dragFillStateRef.current.targetRow;
    rowElements.forEach((el) => {
      const rRect = el.getBoundingClientRect();
      if (e.clientY >= rRect.top && e.clientY <= rRect.bottom) {
        const idx = parseInt(el.getAttribute('data-row-index') || '-1', 10);
        if (idx >= 0) foundRow = idx;
      }
    });

    if (rowElements.length > 0) {
      const firstRect = rowElements[0].getBoundingClientRect();
      const lastRect = rowElements[rowElements.length - 1].getBoundingClientRect();
      if (e.clientY < firstRect.top) foundRow = 0;
      else if (e.clientY > lastRect.bottom) foundRow = rowElements.length - 1;
    }

    let foundCol = dragFillStateRef.current.targetCol;
    if (e.clientX !== undefined && e.clientX > 0) {
      const thElements = container.querySelectorAll<HTMLTableCellElement>('thead th');
      thElements.forEach((th, idx) => {
        const cRect = th.getBoundingClientRect();
        if (e.clientX >= cRect.left && e.clientX <= cRect.right) {
          foundCol = idx;
        }
      });
      if (thElements.length > 0) {
        const firstColRect = thElements[0].getBoundingClientRect();
        const lastColRect = thElements[thElements.length - 1].getBoundingClientRect();
        if (e.clientX < firstColRect.left) foundCol = 0;
        else if (e.clientX > lastColRect.right) foundCol = thElements.length - 1;
      }
    }

    if (foundRow !== dragFillStateRef.current.targetRow || foundCol !== dragFillStateRef.current.targetCol) {
      dragFillStateRef.current.targetRow = foundRow;
      dragFillStateRef.current.targetCol = foundCol;
      setDragFillRange({ ...dragFillStateRef.current });
    }
  };

  const handlePointerUpFillHandle = (e: React.PointerEvent) => {
    if (!isDraggingFillRef.current) return;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    isDraggingFillRef.current = false;
    document.body.style.userSelect = '';

    if (dragFillStateRef.current) {
      const { startRow, targetRow, startCol = 2, targetCol = 2, colKey } = dragFillStateRef.current;
      const minRow = Math.min(startRow, targetRow);
      const maxRow = Math.max(startRow, targetRow);
      const minCol = Math.min(startCol, targetCol);
      const maxCol = Math.max(startCol, targetCol);
      const sourceVal = meterRows[startRow]?.[colKey];

      if (sourceVal !== undefined && (minRow !== maxRow || minCol !== maxCol)) {
        const updated = [...meterRows];
        const newRejectedCells = { ...rejectedSpreadsheetCells };
        let hasChanges = false;
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const col = spreadsheetColumns[c];
            if (!col || !col.editable) continue;
            const norm = validateAndNormalizeSpreadsheetValue(col.key as any, sourceVal);
            const cellKey = `${r}:${col.key}`;
            if (norm.valid) {
              updated[r] = {
                ...updated[r],
                [col.key]: norm.value,
              };
              delete newRejectedCells[cellKey];
              hasChanges = true;
            } else {
              newRejectedCells[cellKey] = true;
            }
          }
        }
        setMeterRows(updated);
        setRejectedSpreadsheetCells(newRejectedCells);
        if (hasChanges) {
          pushHistory(updated);
          showToast(`คัดลอกข้อมูลเรียบร้อยแล้ว`);
        }
      }
    }
    setDragFillRange(null);
    dragFillStateRef.current = null;
  };

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

  // Durable Pull completion state: local session tracker + server-persisted baseline
  const [pulledCycles, setPulledCycles] = useState<Record<string, boolean>>({});

  // Utility-aware, mode-aware, and per-room persisted completion authority:
  // All applicable rooms must have their required utility baselines satisfied.
  const serverReadings = meterWorkspaceQuery.data?.serverReadings || [];
  const hasPersistedBaseline = computeHasPersistedBaseline({
    isRateSnapshotReady,
    isMeterWorkspaceReady,
    isWaterUnit,
    isElecUnit,
    rooms,
    serverReadings,
    previewRooms: previewContext?.rooms,
  });

  const isPullCompleted = Boolean(
    (selectedBillingCycleId && pulledCycles[selectedBillingCycleId]) ||
    hasPersistedBaseline
  );

  const showPullButton = Boolean(
    isSelectedCycleAuthorityReady &&
    isFirstCycle === false &&
    previousCycleExists &&
    isMeterWorkspaceReady &&
    isRateSnapshotReady &&
    !isPullCompleted
  );

  // Active Room ID for Other Fees Modal Editor (shared between Table and List modes)
  const [activeFeeModalRoomId, setActiveFeeModalRoomId] = useState<string | null>(null);

  const handleSaveOtherFeesModal = (roomId: string, nextFees: Array<{ description: string; amount: string }>) => {
    const currentRow = meterRowsRef.current.find(r => r.roomId === roomId) || meterRows.find(r => r.roomId === roomId);
    if (!currentRow) return;

    const prevFees = currentRow.otherFees || [];
    const isSame = prevFees.length === nextFees.length && prevFees.every((pf, i) => {
      const nf = nextFees[i];
      return nf && pf.description === nf.description && String(pf.amount) === String(nf.amount);
    });

    if (isSame) {
      setActiveFeeModalRoomId(null);
      return;
    }

    const nextRows = meterRows.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r);
    setMeterRows(nextRows);
    pushHistory(nextRows);

    if (currentDormId && selectedBillingCycleId && originalRowsRef.current) {
      const patches = deriveMeterDraftPatches(nextRows, originalRowsRef.current);
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, patches);
    }

    setActiveFeeModalRoomId(null);
  };

  const handleOpenQuickAddTenant = async (targetRoomId: string) => {
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
        if ((waterItem as any).metadata?.currentReading !== undefined && (waterItem as any).metadata?.currentReading !== null) {
          waterCurr = Number((waterItem as any).metadata.currentReading);
        } else {
          const match = waterItem.description?.match(/\(([\d.]+)\s*หน่วย\)/) || waterItem.description?.match(/\(([\d.]+)\s*-\s*([\d.]+)\)/);
          if (match && match[2]) {
            waterCurr = Number(match[2]);
          } else if (match && match[1]) {
            waterCurr = waterPrev + Number(match[1]);
          } else {
            const isUnit = rateSnapshot ? isMeterBasedUtilityMode(rateSnapshot.waterBillingType) : false;
            if (isUnit) {
              const rate = rateSnapshot?.waterRate ? Number(rateSnapshot.waterRate) : 0;
              waterCurr = rate > 0 ? (waterPrev + Number(waterItem.amount) / rate) : waterPrev;
            } else {
              waterCurr = waterPrev;
            }
          }
        }
      }

      const elecItem = bill.items.find(item => item.category === 'electricity' || (item as any).type === 'electricity');
      if (elecItem) {
        if ((elecItem as any).metadata?.currentReading !== undefined && (elecItem as any).metadata?.currentReading !== null) {
          elecCurr = Number((elecItem as any).metadata.currentReading);
        } else {
          const match = elecItem.description?.match(/\(([\d.]+)\s*หน่วย\)/) || elecItem.description?.match(/\(([\d.]+)\s*-\s*([\d.]+)\)/);
          if (match && match[2]) {
            elecCurr = Number(match[2]);
          } else if (match && match[1]) {
            elecCurr = elecPrev + Number(match[1]);
          } else {
            const isUnit = rateSnapshot ? isMeterBasedUtilityMode(rateSnapshot.electricityBillingType) : false;
            if (isUnit) {
              const rate = rateSnapshot?.electricityRate ? Number(rateSnapshot.electricityRate) : 0;
              elecCurr = rate > 0 ? (elecPrev + Number(elecItem.amount) / rate) : elecPrev;
            } else {
              elecCurr = elecPrev;
            }
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

        // Explicitly preserve current readings and other fees
        nextRow.waterCurr = row.waterCurr;
        nextRow.elecCurr = row.elecCurr;
        nextRow.otherFees = row.otherFees;

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

          let targetPeopleCount = row.peopleCount;
          if (pRoom.previousCyclePeopleCount !== null && pRoom.previousCyclePeopleCount !== undefined) {
            targetPeopleCount = pRoom.previousCyclePeopleCount;
          } else if (pRoom.currentHouseholdPeopleCount !== null && pRoom.currentHouseholdPeopleCount !== undefined) {
            targetPeopleCount = pRoom.currentHouseholdPeopleCount;
          }

          if (row.peopleCount !== targetPeopleCount) {
            nextRow.peopleCount = targetPeopleCount;
            newFlashing[`${row.roomId}-peopleCount`] = true;
          }

          // Compare previousCyclePeopleCount vs current for toast (Section 5)
          if (pRoom.previousCyclePeopleCount !== null && pRoom.previousCyclePeopleCount !== undefined) {
            if (pRoom.previousCyclePeopleCount !== targetPeopleCount) {
              peopleChanges.push({
                roomNumber: row.roomNumber,
                prev: pRoom.previousCyclePeopleCount,
                curr: targetPeopleCount,
              });
            }
          }
        }

        return nextRow;
      });

      setMeterRows(updatedRows);
      pushHistory(updatedRows);
      if (selectedBillingCycleId) {
        setPulledCycles((prev) => ({ ...prev, [selectedBillingCycleId]: true }));
      }

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

  const getTemplateFormatString = (mode: 'FULL' | 'METER_ONLY' = templateMode) => {
    const rawBld = meterRows[0]?.buildingCode || "A";
    const sampleBld = rawBld.replace(/^BLD-/, '').replace(/^อาคาร\s*/, '') || "A";
    const sampleRoom = meterRows[0]?.roomNumber || "101";
    const sampleIdent = `${sampleBld} ${sampleRoom}`;
    const sampleElec = formatMeterReadingDisplay(meterRows[0]?.elecPrev || 500);
    const sampleWater = formatMeterReadingDisplay(meterRows[0]?.waterPrev || 500);
    const samplePeople = formatCountDisplay(meterRows[0]?.peopleCount ?? 0);

    if (mode === 'METER_ONLY') {
      if (isElecUnit && isWaterUnit) {
        return `${sampleIdent} : ไฟ ${sampleElec} : น้ำ ${sampleWater}`;
      } else if (isElecUnit && !isWaterUnit) {
        return `${sampleIdent} : ไฟ ${sampleElec}`;
      } else if (!isElecUnit && isWaterUnit) {
        return `${sampleIdent} : น้ำ ${sampleWater}`;
      }
    }

    if (isElecUnit && isWaterUnit) {
      return `${sampleIdent} : ไฟ ${sampleElec} : น้ำ ${sampleWater} : ${samplePeople} คน`;
    } else if (isElecUnit && !isWaterUnit) {
      return `${sampleIdent} : ไฟ ${sampleElec} : ${samplePeople} คน`;
    } else if (!isElecUnit && isWaterUnit) {
      return `${sampleIdent} : น้ำ ${sampleWater} : ${samplePeople} คน`;
    } else {
      return `${sampleIdent} : ${samplePeople} คน`;
    }
  };

  const generateTemplateText = (mode: 'FULL' | 'METER_ONLY' = templateMode, freshHouseholdMap?: Map<string, number>) => {
    const sortedRows = [...meterRows].sort((a, b) => {
      const bComp = (a.buildingCode || '').localeCompare(b.buildingCode || '');
      if (bComp !== 0) return bComp;
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });

    return sortedRows.map(row => {
      const rawBld = row.buildingCode || 'A';
      const bCode = rawBld.replace(/^BLD-/, '').replace(/^อาคาร\s*/, '') || 'A';
      const parts = [`${bCode} ${row.roomNumber}`];
      if (isElecUnit) {
        parts.push(`ไฟ ${formatMeterReadingDisplay(row.elecPrev)}`);
      }
      if (isWaterUnit) {
        parts.push(`น้ำ ${formatMeterReadingDisplay(row.waterPrev)}`);
      }
      if (mode === 'FULL') {
        const freshCount = freshHouseholdMap?.get(row.roomId);
        const roomCtx = previewContext?.rooms?.find(r => r.roomId === row.roomId);
        const householdCount = freshCount !== undefined ? freshCount : (roomCtx?.currentHouseholdPeopleCount !== undefined ? roomCtx.currentHouseholdPeopleCount : row.peopleCount);
        parts.push(`${formatCountDisplay(householdCount)} คน`);
      }
      return parts.join(' : ');
    }).join('\n');
  };

  const parseQuickFillText = (text: string) => {
    const lines = text.split('\n');

    const matchRowForLine = (firstPart: string) => {
      if (!firstPart) return undefined;
      const trimmed = firstPart.trim();
      const tokens = trimmed.split(/\s+/);

      if (tokens.length >= 2) {
        let bCode = tokens[0].toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
        let rNum = tokens.slice(1).join(' ');
        if (!bCode && tokens[0].startsWith('อาคาร') && tokens.length >= 3) {
          bCode = tokens[1].toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
          rNum = tokens.slice(2).join(' ');
        }
        if (bCode) {
          const matched = meterRows.find(r => {
            const rB = (r.buildingCode || '').toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
            const rName = (r.buildingName || '').toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
            return (rB === bCode || rName === bCode) &&
              r.roomNumber.toLowerCase() === rNum.toLowerCase();
          });
          if (matched) return matched;
        }
      }

      // Fallback: match roomNumber directly if unique across dormitory
      const matchingRooms = meterRows.filter(r => r.roomNumber.toLowerCase() === trimmed.toLowerCase());
      if (matchingRooms.length === 1) {
        return matchingRooms[0];
      }
      return undefined;
    };

    const newFlashing: { [key: string]: boolean } = {};
    let matchedCount = 0;

    const updatedRows = meterRows.map(row => {
      const matchedLine = lines.find(line => {
        const firstPart = line.split(':')[0]?.trim();
        const matched = matchRowForLine(firstPart);
        return matched && matched.roomId === row.roomId;
      });

      if (!matchedLine) return row;
      matchedCount++;

      const parts = matchedLine.split(':').map(p => p.trim());

      let waterCurr = row.waterCurr;
      let elecCurr = row.elecCurr;
      let peopleCount = row.peopleCount;

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
        }
      });

      if (waterCurr !== row.waterCurr) newFlashing[`${row.roomId}-waterCurr`] = true;
      if (elecCurr !== row.elecCurr) newFlashing[`${row.roomId}-elecCurr`] = true;
      if (peopleCount !== row.peopleCount) newFlashing[`${row.roomId}-peopleCount`] = true;

      return {
        ...row,
        waterCurr,
        elecCurr,
        peopleCount,
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
  // สำหรับระบบ SaaS ในอนาคต หากหอพักตั้งค่ารูปแบบค่าน้ำ หรือค่าไฟฟ้า เป็น "ไม่ใช่ บาท/หน่วย"
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

    if (mode === 'tiered') {
      if (row.waterPrev === '' || row.waterCurr === '') return 0;
      const usageRes = calculateMeterUsageUnits(row.waterPrev, row.waterCurr);
      if (!usageRes.isValid) return 0;
      const prog = calculateProgressiveTieredChargeLocal({
        usageUnits: usageRes.usageUnits,
        tiers: rateSnapshot?.waterTierRates,
      });
      return prog.isValid ? Number(prog.totalAmount) : 0;
    } else if (mode === 'per_unit' || mode === 'unit') {
      return units * rate;
    } else if (mode === 'per_person' || mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else if (mode === 'free' || mode === 'none') {
      return 0;
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

    if (mode === 'tiered') {
      if (row.elecPrev === '' || row.elecCurr === '') return 0;
      const usageRes = calculateMeterUsageUnits(row.elecPrev, row.elecCurr);
      if (!usageRes.isValid) return 0;
      const prog = calculateProgressiveTieredChargeLocal({
        usageUnits: usageRes.usageUnits,
        tiers: rateSnapshot?.electricityTierRates,
      });
      return prog.isValid ? Number(prog.totalAmount) : 0;
    } else if (mode === 'per_unit' || mode === 'unit') {
      return units * rate;
    } else if (mode === 'per_person' || mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else if (mode === 'free' || mode === 'none') {
      return 0;
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
        originalRowsRef.current = [];
        originalRowsCycleIdRef.current = '';
      }
      return;
    }

    const built = buildRowsFromWorkspace({
      workspaceData: meterWorkspaceQuery.data,
      rooms,
      bills,
      contracts,
      tenants,
      buildings,
      selectedBillingCycleId,
      selectedCycleCode,
      selectedCycle,
      currentDormId,
      isFirstCycle,
    });

    // Merge any locally confirmed snapshotVersions in originalRowsRef ONLY if for the SAME cycle
    if (originalRowsCycleIdRef.current === selectedBillingCycleId && originalRowsRef.current && originalRowsRef.current.length > 0) {
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
    originalRowsCycleIdRef.current = selectedBillingCycleId;
    setMeterRows(built.rows);
    resetHistory(built.rows);
    setLoadedCycle(selectedBillingCycleId);
  }, [meterWorkspaceQuery.data, selectedBillingCycleId, rooms, bills, contracts, tenants, buildings]);

  // Synchronize unsaved deltas to isolated in-memory draft store
  useEffect(() => {
    if (
      meterRows &&
      meterRows.length > 0 &&
      meterWorkspaceQuery.isSuccess &&
      currentDormId &&
      selectedBillingCycleId &&
      loadedCycle === selectedBillingCycleId &&
      originalRowsCycleIdRef.current === selectedBillingCycleId &&
      originalRowsRef.current
    ) {
      const patches = deriveMeterDraftPatches(meterRows, originalRowsRef.current);
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, patches);
    }
  }, [meterRows, selectedBillingCycleId, loadedCycle, meterWorkspaceQuery.isSuccess, currentDormId]);

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
    if (loadedCycle !== selectedBillingCycleId || originalRowsCycleIdRef.current !== selectedBillingCycleId) {
      return false;
    }
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
      if (activeFeeModalRoomId || isQuickFillOpen || quickAddModalOpen || isLineModalOpen) {
        return;
      }

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
  }, [isDirty, isSaving, meterRows, bills, selectedCycle, activeFeeModalRoomId, isQuickFillOpen, quickAddModalOpen, isLineModalOpen]);

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
    const roomCtx = previewContext?.rooms?.find((r: any) => r.roomId === row.roomId);
    const isMonthlyUtilityPaid = Boolean(roomCtx?.isMonthlyUtilityPaid || (row as any).isMonthlyUtilityPaid);
    if (isMonthlyUtilityPaid) {
      showToast('บิลค่าใช้จ่ายรายเดือนนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');
      return;
    }
    const muStatus = (roomCtx?.monthlyUtilityBillStatus || (row as any).monthlyUtilityBillStatus || row.billStatus);
    const isCurrentlyIssued = muStatus !== 'draft' && muStatus !== 'cancelled';
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
        showToast(mapErrorMessageToThai(res?.error) || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล', 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err) || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล', 'error');
    }
  };

  const handleIssueAllBills = async () => {
    if (!isMutationReady) {
      showToast('ข้อมูลหรือสิทธิ์การคิดรอบบิลยังไม่พร้อมใช้งาน', 'error');
      return;
    }
    
    const rawDirtyRows: any[] = [];
    const previewRoomsList = previewContext?.rooms || [];
    for (const r of meterRows) {
        const roomCtx = previewRoomsList.find((ctx: any) => ctx.roomId === r.roomId);
        if (roomCtx?.billingSource === 'DAILY_STAY' || roomCtx?.isDailyUnpaid) {
          continue;
        }
        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        const dirtyObj: any = { roomId: r.roomId };
        let hasDelta = false;

        if (orig) {
          if (r.waterCurr !== orig.waterCurr) {
            dirtyObj.waterCurr = r.waterCurr;
            hasDelta = true;
          }
          if (r.waterPrev !== orig.waterPrev) {
            dirtyObj.waterPrev = r.waterPrev;
            hasDelta = true;
          }
          if (r.elecCurr !== orig.elecCurr) {
            dirtyObj.elecCurr = r.elecCurr;
            hasDelta = true;
          }
          if (r.elecPrev !== orig.elecPrev) {
            dirtyObj.elecPrev = r.elecPrev;
            hasDelta = true;
          }
          if (r.peopleCount !== orig.peopleCount) {
            dirtyObj.peopleCount = r.peopleCount;
            hasDelta = true;
          }
          if (r.overdueAmount !== orig.overdueAmount) {
            dirtyObj.manualOutstandingAmount = r.overdueAmount;
            hasDelta = true;
          }
          if (JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) {
            dirtyObj.otherFees = r.otherFees;
            hasDelta = true;
          }
          if (r.isReplaced !== orig.isReplaced) {
            dirtyObj.isReplaced = r.isReplaced;
            hasDelta = true;
          }
        } else {
          if (r.waterCurr !== undefined) dirtyObj.waterCurr = r.waterCurr;
          if (r.waterPrev !== undefined) dirtyObj.waterPrev = r.waterPrev;
          if (r.elecCurr !== undefined) dirtyObj.elecCurr = r.elecCurr;
          if (r.elecPrev !== undefined) dirtyObj.elecPrev = r.elecPrev;
          if (r.peopleCount !== undefined) dirtyObj.peopleCount = r.peopleCount;
          if (r.overdueAmount !== undefined) dirtyObj.manualOutstandingAmount = r.overdueAmount;
          if (r.otherFees !== undefined) dirtyObj.otherFees = r.otherFees;
          if (r.isReplaced !== undefined) dirtyObj.isReplaced = r.isReplaced;
          hasDelta = true;
        }

        if (hasDelta) {
          if (orig?.snapshotVersion !== undefined) {
            dirtyObj.expectedVersion = orig.snapshotVersion;
          }
          rawDirtyRows.push(dirtyObj);
        }
      }

      const dirtyRows = serializeMeterWorkspaceDirtyRows(rawDirtyRows);

      // Single real backend operation
      setIsSaving(true);
      try {
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
        showToast(mapErrorMessageToThai(res?.error), 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err), 'error');
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

    const rawDirtyRows: any[] = [];
    for (const r of meterRows) {
      const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
      const dirtyObj: any = { roomId: r.roomId };
      let hasDelta = false;

      if (orig) {
        if (r.waterCurr !== orig.waterCurr) {
          dirtyObj.waterCurr = r.waterCurr;
          hasDelta = true;
        }
        if (r.waterPrev !== orig.waterPrev) {
          dirtyObj.waterPrev = r.waterPrev;
          hasDelta = true;
        }
        if (r.elecCurr !== orig.elecCurr) {
          dirtyObj.elecCurr = r.elecCurr;
          hasDelta = true;
        }
        if (r.elecPrev !== orig.elecPrev) {
          dirtyObj.elecPrev = r.elecPrev;
          hasDelta = true;
        }
        if (r.peopleCount !== orig.peopleCount) {
          dirtyObj.peopleCount = r.peopleCount;
          hasDelta = true;
        }
        if (r.overdueAmount !== orig.overdueAmount) {
          dirtyObj.manualOutstandingAmount = r.overdueAmount;
          hasDelta = true;
        }
        if (JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) {
          dirtyObj.otherFees = r.otherFees;
          hasDelta = true;
        }
        if (r.isReplaced !== orig.isReplaced) {
          dirtyObj.isReplaced = r.isReplaced;
          hasDelta = true;
        }
      } else {
        if (r.waterCurr !== undefined) dirtyObj.waterCurr = r.waterCurr;
        if (r.waterPrev !== undefined) dirtyObj.waterPrev = r.waterPrev;
        if (r.elecCurr !== undefined) dirtyObj.elecCurr = r.elecCurr;
        if (r.elecPrev !== undefined) dirtyObj.elecPrev = r.elecPrev;
        if (r.peopleCount !== undefined) dirtyObj.peopleCount = r.peopleCount;
        if (r.overdueAmount !== undefined) dirtyObj.manualOutstandingAmount = r.overdueAmount;
        if (r.otherFees !== undefined) dirtyObj.otherFees = r.otherFees;
        if (r.isReplaced !== undefined) dirtyObj.isReplaced = r.isReplaced;
        hasDelta = true;
      }

      if (hasDelta) {
        if (orig?.snapshotVersion !== undefined) {
          dirtyObj.expectedVersion = orig.snapshotVersion;
        }
        rawDirtyRows.push(dirtyObj);
      }
    }

    if (rawDirtyRows.length === 0) {
      showToast('ไม่มีข้อมูลที่เปลี่ยนแปลง', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const serializedDirtyRows = serializeMeterWorkspaceDirtyRows(rawDirtyRows);

      const res = await getDataProvider().meters.saveBulkWorkspace?.(selectedBillingCycleId, serializedDirtyRows);
      setIsSaving(false);

      if (res && res.success) {
        showToast('บันทึกข้อมูลสำเร็จ', 'success');
        setSaveSuccess(true);
        if (saveSuccessTimeoutRef.current) clearTimeout(saveSuccessTimeoutRef.current);
        saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);

        const savedRows = (res as any)?.savedRows || (res as any)?.data?.savedRows;
        if (Array.isArray(savedRows) && savedRows.length > 0) {
          const versionMap = new Map(savedRows.map((s: any) => [s.roomId, s.version]));
          setMeterRows(prev => prev.map(row => {
            const v = versionMap.get(row.roomId);
            return v !== undefined ? { ...row, snapshotVersion: v } : row;
          }));
          meterRowsRef.current = meterRowsRef.current.map(row => {
            const v = versionMap.get(row.roomId);
            return v !== undefined ? { ...row, snapshotVersion: v } : row;
          });
        }

        originalRowsRef.current = JSON.parse(JSON.stringify(meterRowsRef.current));
        originalRowsCycleIdRef.current = selectedBillingCycleId;
        resetHistory(meterRowsRef.current);
        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.bills(currentDormId) });
      } else {
        showToast(mapErrorMessageToThai(res?.error) || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลมิเตอร์', 'error');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(mapErrorMessageToThai(err) || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลมิเตอร์', 'error');
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

  const filteredRows = meterRows.filter(row => {
    const query = (searchQuery || '').trim().toLowerCase();
    if (!query) return true;
    const roomMatch = (row?.roomNumber || '').toLowerCase().includes(query);
    if (roomMatch) return true;
    const roomCtx = previewContext?.rooms?.find((ctx: any) => ctx.roomId === row.roomId);
    const tenantName = roomCtx?.tenantName || getTenantForRoomAndCycleHelper(row.roomId, selectedCycleCode || selectedCycle || '', contracts, rooms, tenants)?.name || '';
    return tenantName.toLowerCase().includes(query);
  });

  const eligibleUnissuedRows = meterRows.filter((r) => {
    const roomCtx = previewContext?.rooms?.find((ctx: any) => ctx.roomId === r.roomId);
    if (roomCtx?.billingSource === 'DAILY_STAY') return false;
    if (r.billStatus !== 'draft' && r.billStatus !== 'cancelled') return false;
    return true;
  });
  const hasEligibleUnissuedBills = eligibleUnissuedRows.length > 0;

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
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] px-4.5 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${toastType === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800'
            : toastType === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-800'
              : toastType === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-sky-50 border-sky-200 text-sky-800'
            } ${isToastFading
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
        <div className="p-4 bg-slate-50/50 border-b border-gray-100 flex flex-col xl:flex-row gap-3 justify-between items-stretch xl:items-center">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-64 md:w-72 shrink-0">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="ค้นหาเลขห้อง..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 shadow-2xs"
              />
            </div>

            {/* View Mode Toggle & Table Scroll / List Breakdown Helper */}
            <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto">
              <div className="flex items-center bg-slate-100 p-1 rounded-xl shrink-0 border border-slate-200/60" data-testid="meter-view-mode-toggle">
                <button
                  type="button"
                  data-testid="view-mode-table-button"
                  onClick={() => handleViewModeChange('table')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${viewMode === 'table'
                    ? 'bg-white text-indigo-600 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                  title="มุมมองตาราง"
                >
                  <Table className="w-3.5 h-3.5" />
                  <span>ตาราง</span>
                </button>
                <button
                  type="button"
                  data-testid="view-mode-list-button"
                  onClick={() => handleViewModeChange('list')}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${viewMode === 'list'
                    ? 'bg-white text-indigo-600 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                    }`}
                  title="มุมมองรายการ"
                >
                  <LayoutList className="w-3.5 h-3.5" />
                  <span>รายการ</span>
                </button>
              </div>

              {/* Scroll table helper buttons (shown in table mode) */}
              {viewMode === 'table' && (
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0 border border-slate-200/60">
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
              )}

              {/* List Mode Global Toggle All Details */}
              {viewMode === 'list' && (
                <button
                  type="button"
                  onClick={() => {
                    const allExpanded = meterRows.every(r => expandedBreakdowns[r.roomId]);
                    const nextState = !allExpanded;
                    const nextMap: { [roomId: string]: boolean } = {};
                    meterRows.forEach(r => { nextMap[r.roomId] = nextState; });
                    setExpandedBreakdowns(nextMap);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-indigo-700 transition-all cursor-pointer border border-slate-200/60 shadow-2xs shrink-0"
                  title={meterRows.every(r => expandedBreakdowns[r.roomId]) ? "ซ่อนรายละเอียดทุกห้อง" : "แสดงรายละเอียดทุกห้อง"}
                >
                  {meterRows.every(r => expandedBreakdowns[r.roomId]) ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>ซ่อนรายละเอียด</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>แสดงรายละเอียด</span>
                    </>
                  )}
                </button>
              )}
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
                disabled={!isMutationReady || isSaving || !hasEligibleUnissuedBills}
                onClick={handleIssueAllBills}
                className={`w-full sm:w-auto px-3 sm:px-4 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-md whitespace-nowrap shrink-0 ${!hasEligibleUnissuedBills
                  ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed shadow-none'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10 cursor-pointer'
                  }`}
                title={!hasEligibleUnissuedBills ? 'ออกบิลครบทุกห้องแล้ว' : 'ออกบิลทุกห้อง'}
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

        {viewMode === 'table' ? (
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
                  const waterUsageRes = (row.waterPrev !== '' && row.waterCurr !== '') ? calculateMeterUsageUnits(row.waterPrev, row.waterCurr) : { isValid: true, usageUnits: 0 };
                  const elecUsageRes = (row.elecPrev !== '' && row.elecCurr !== '') ? calculateMeterUsageUnits(row.elecPrev, row.elecCurr) : { isValid: true, usageUnits: 0 };
                  const waterUnits = row.isReplaced ? Number(row.waterCurr) : (waterUsageRes.isValid ? waterUsageRes.usageUnits : -1);
                  const elecUnits = row.isReplaced ? Number(row.elecCurr) : (elecUsageRes.isValid ? elecUsageRes.usageUnits : -1);

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

                  const origRow = (originalRowsRef.current || []).find((o) => o.roomId === row.roomId);
                  const hasElecBaseline = Boolean(origRow?.elecPrev !== '' && origRow?.elecPrev !== null && origRow?.elecPrev !== undefined);
                  const isElecDirectEdit = isFirstCycle || !hasElecBaseline;

                  const hasWaterBaseline = Boolean(origRow?.waterPrev !== '' && origRow?.waterPrev !== null && origRow?.waterPrev !== undefined);
                  const isWaterDirectEdit = isFirstCycle || !hasWaterBaseline;

                  return (
                    <tr key={row.roomId} id={`room-row-${row.roomId}`} data-testid={`meter-row-${row.roomId}`} className="hover:bg-slate-50/50 transition-colors">
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
                                onChange={(e) => {
                                  handleMeterReadingChange(row.roomId, 'elecPrev', e.target.value);
                                }}
                                onBlur={() => handleMeterReadingBlur(row.roomId, 'elecPrev')}
                                onPaste={(e) => handlePaste(row.roomId, 'elecPrev', e)}
                                data-row={idx}
                                data-col="elecPrev"
                                className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${flashingCells[`${row.roomId}-elecPrev`]
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
                              className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${flashingCells[`${row.roomId}-elecCurr`]
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
                                onChange={(e) => {
                                  handleMeterReadingChange(row.roomId, 'waterPrev', e.target.value);
                                }}
                                onBlur={() => handleMeterReadingBlur(row.roomId, 'waterPrev')}
                                onPaste={(e) => handlePaste(row.roomId, 'waterPrev', e)}
                                data-row={idx}
                                data-col="waterPrev"
                                className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${flashingCells[`${row.roomId}-waterPrev`]
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
                              className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${flashingCells[`${row.roomId}-waterCurr`]
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
                            className={`w-14 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${flashingCells[`${row.roomId}-peopleCount`]
                              ? 'animate-vibrant-flash shadow-md z-10'
                              : 'border-gray-200'
                              }`}
                          />
                        </div>
                      </td>

                      {/* Custom Other Fees Column */}
                      <td className="p-4">
                        <div className="flex flex-col gap-1 min-w-[140px]">
                          {(row.otherFees || []).length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {(row.otherFees || []).slice(0, 2).map((fee, feeIdx) => (
                                <div key={feeIdx} className="flex items-center justify-between gap-1 text-[10px] text-slate-600 font-bold bg-slate-50 border border-slate-100 rounded-md px-1.5 py-0.5">
                                  <span className="truncate max-w-[80px]" title={fee.description}>{fee.description}</span>
                                  <span className="text-indigo-600 shrink-0">{formatOtherFeeAmountDisplay(fee.amount)}</span>
                                </div>
                              ))}
                              {(row.otherFees || []).length > 2 && (
                                <span className="text-[10px] text-slate-400 font-semibold pl-0.5">
                                  +{(row.otherFees || []).length - 2} รายการ
                                </span>
                              )}
                              {!isRowPaid && (
                                <button
                                  type="button"
                                  data-testid={`edit-table-other-fees-${row.roomId}`}
                                  onClick={() => setActiveFeeModalRoomId(row.roomId)}
                                  className="text-[10px] text-indigo-600 hover:text-indigo-800 hover:underline font-bold mt-0.5 inline-flex items-center gap-1 cursor-pointer w-fit"
                                >
                                  <Pencil className="w-2.5 h-2.5" />
                                  <span>แก้ไข</span>
                                </button>
                              )}
                            </div>
                          ) : (
                            !isRowPaid ? (
                              <button
                                type="button"
                                data-testid={`open-table-other-fees-${row.roomId}`}
                                onClick={() => setActiveFeeModalRoomId(row.roomId)}
                                className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline font-bold transition-all cursor-pointer inline-flex items-center gap-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>เพิ่มค่าใช้จ่าย</span>
                              </button>
                            ) : (
                              <span className="text-xs text-slate-400 font-bold">-</span>
                            )
                          )}
                        </div>
                      </td>

                      {/* Calculated Total & Financial Breakdown */}
                      <td className="p-4 text-right">
                        {(() => {
                          const orig = (originalRowsRef.current || []).find((o) => o.roomId === row.roomId);
                          const breakdown = getOwnerFinancialBreakdown(roomCtx, row, rateSnapshot, orig);
                          const amountDue = breakdown.formattedAmount;
                          const chargeComponents = breakdown.components;
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
                                  className="text-[10px] text-slate-400 hover:text-indigo-600 font-medium cursor-pointer transition-colors mt-0.5 whitespace-nowrap flex items-center gap-0.5"
                                >
                                  <span>
                                    {chargeComponents.length === 1
                                      ? 'ดูรายละเอียด'
                                      : `ดูรายละเอียด +${chargeComponents.length}`}
                                  </span>
                                  <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                </button>
                              )}
                              {isExpanded && chargeComponents.length > 0 && (
                                <div className="mt-1 flex flex-col items-end gap-1 text-right">
                                  {chargeComponents.map((c: any, cIdx: number) => {
                                    const isPaid = c.status === 'PAID';
                                    const isInvalid = c.status === 'INVALID';
                                    const isUnpaid = c.status === 'UNPAID';
                                    const isPreview = c.status === 'PREVIEW' || (!isPaid && !isInvalid && !isUnpaid);

                                    return (
                                      <div
                                        key={cIdx}
                                        data-testid={`charge-component-row-${row.roomId}-${cIdx}`}
                                        className="flex items-center justify-end gap-1.5 text-xs whitespace-nowrap"
                                        title={isInvalid ? (c.errorMessage || 'ข้อมูลไม่ถูกต้อง') : undefined}
                                      >
                                        {isPaid ? (
                                          <>
                                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                            <span className="text-emerald-700 font-medium">{c.label}</span>
                                            <span className="text-emerald-800 font-bold">{formatComponentDetailAmount(c.amount)}</span>
                                          </>
                                        ) : isInvalid ? (
                                          <>
                                            <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                            <span className="text-rose-600 font-medium">{c.label}</span>
                                            <span className="text-rose-600 font-bold">{formatComponentDetailAmount(c.amount)}</span>
                                          </>
                                        ) : isUnpaid ? (
                                          <>
                                            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span className="text-amber-700 font-medium">{c.label}</span>
                                            <span className="text-amber-800 font-bold">{formatComponentDetailAmount(c.amount)}</span>
                                          </>
                                        ) : (
                                          <>
                                            <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span className="text-slate-500 font-medium">{c.label}</span>
                                            <span className="text-slate-600 font-semibold">{formatComponentDetailAmount(c.amount)}</span>
                                          </>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Status Switch with real server authority */}
                      <td className={`p-4 text-center transition-all duration-300 ${flashingCells[`${row.roomId}-status`]
                        ? 'animate-vibrant-flash rounded-lg shadow-md z-10'
                        : ''
                        }`}>
                        {(() => {
                          const displayStatus = resolveOwnerMeterDisplayStatus(roomCtx, row);

                          if (displayStatus.isDaily) {
                            if (displayStatus.statusKey === 'DAILY_OVERDUE') {
                              return (
                                <div className="flex items-center justify-center min-w-[85px]">
                                  <span className="inline-flex items-center px-2 py-1 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg border border-rose-200">
                                    <AlertCircle className="w-3 h-3 text-rose-500 mr-1 shrink-0" />
                                    {displayStatus.label}
                                  </span>
                                </div>
                              );
                            }
                            if (displayStatus.statusKey === 'DAILY_PAID') {
                              return (
                                <div className="flex items-center justify-center min-w-[85px]">
                                  <span className="inline-flex items-center px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
                                    <CheckCircle className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                                    {displayStatus.label}
                                  </span>
                                </div>
                              );
                            }
                            return (
                              <div className="flex items-center justify-center min-w-[85px]">
                                <span className="inline-flex items-center px-2 py-1 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg border border-slate-200">
                                  {displayStatus.label}
                                </span>
                              </div>
                            );
                          }

                          const isMuIssued = displayStatus.isMonthlyUtilityIssued;
                          const isMuPaid = displayStatus.isMonthlyUtilityPaid;

                          const statusColorClass = displayStatus.tone === 'neutral'
                            ? 'text-slate-500'
                            : displayStatus.tone === 'success'
                              ? 'text-emerald-700'
                              : displayStatus.tone === 'warning'
                                ? 'text-amber-700'
                                : 'text-rose-600';

                          return (
                            <div className="flex flex-col items-center justify-center gap-1 min-w-[85px]">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={isMuIssued}
                                disabled={isSaving || isMuPaid || !selectedBillingCycleId}
                                onClick={() => handleToggleStatusSwitch(row)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${isMuPaid
                                  ? 'bg-emerald-600'
                                  : isMuIssued
                                    ? 'bg-amber-500'
                                    : 'bg-slate-300'
                                  }`}
                                title={
                                  isMuPaid
                                    ? 'ชำระแล้ว (ล็อค)'
                                    : isMuIssued
                                      ? 'คลิกเพื่อยกเลิกบิล'
                                      : 'คลิกเพื่อออกบิล'
                                }
                              >
                                <span
                                  aria-hidden="true"
                                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${isMuIssued ? 'translate-x-4' : 'translate-x-0'
                                    }`}
                                />
                              </button>
                              <span className={`text-[10px] font-extrabold leading-none ${statusColorClass}`}>
                                {displayStatus.label}
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
                          const dailyCheckOutDate = roomCtx?.dailyCheckOutDate || null;
                          const effectiveDailyTenantName = roomCtx?.dailyTenantName || (dailyCheckOutDate ? (effectiveTenantName || 'ผู้พักรายวัน') : null);
                          const isFuture = Boolean(roomCtx?.isFutureReservation);
                          const isLineLinked = roomCtx ? roomCtx.isLineLinked : Boolean((tenant as any)?.linkedUserId);
                          const peopleCountVal = Number(row.peopleCount ?? roomCtx?.currentHouseholdPeopleCount ?? roomCtx?.snapshotPeopleCount ?? 0);
                          const activeCycleCode = selectedCycleCode || selectedCycle || billingCycles?.find((c: any) => c.id === selectedBillingCycleId)?.cycleCode || '';
                          const isEligibleAddTenantCycle = isCycleInRollingThreeMonthWindow(activeCycleCode, billingCyclesData?.selectableBillingCycles || billingCycles);
                          const hasBookableGap = roomCtx?.hasBookableGap ?? true;
                          const historicalDailyCount = roomCtx?.historicalDailyCount || 0;
                          const checkInDate = roomCtx?.checkInDate || null;
                          const contractEndDate = roomCtx?.contractEndDate || (() => {
                            const activeContract = (contracts || []).find((c: any) => c.roomId === row.roomId && ['active', 'expiring_soon', 'pending_signature', 'waiting_extension', 'checking_out'].includes(c.status));
                            if (!activeContract?.endDate) return null;
                            const endStr = normalizeBangkokDate(activeContract.endDate);
                            if (activeCycleCode && endStr.slice(0, 7) === activeCycleCode) {
                              return endStr;
                            }
                            return null;
                          })();

                          if (isFuture) {
                            const futureLabel = checkInDate
                              ? `จองล่วงหน้า ${formatShortThaiBuddhistDate(checkInDate)}`
                              : 'จองล่วงหน้า';
                            return (
                              <div className="flex items-center gap-2">
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
                                    {futureLabel}
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          if (isEligibleAddTenantCycle) {
                            const hasTenant = Boolean(effectiveTenantId && effectiveTenantName);
                            const hasDailyStay = Boolean(dailyCheckOutDate);
                            const hasOccupantClaim = hasTenant || hasDailyStay;

                            return (
                              <div className="flex items-center gap-2">
                                {hasTenant && (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <div className="flex items-center gap-1.5">
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
                                    </div>
                                    {!isLineLinked && (
                                      <span className="text-[10px] text-slate-400 font-normal leading-tight">
                                        (ยังไม่ได้เชื่อม LINE)
                                      </span>
                                    )}
                                    {contractEndDate && (
                                      <span className="text-xs font-bold text-slate-800">
                                        ({formatShortThaiBuddhistDate(contractEndDate)})
                                      </span>
                                    )}
                                    {dailyCheckOutDate && (
                                      <span className="text-xs font-bold text-slate-700">
                                        ({formatShortThaiBuddhistDate(dailyCheckOutDate)})
                                      </span>
                                    )}
                                  </div>
                                )}
                                {!hasTenant && dailyCheckOutDate && (
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span className="text-xs font-bold text-slate-800">
                                      {effectiveDailyTenantName || 'ผู้พักรายวัน'}
                                    </span>
                                    <span className="text-xs font-bold text-slate-700">
                                      ({formatShortThaiBuddhistDate(dailyCheckOutDate)})
                                    </span>
                                  </div>
                                )}
                                {!hasOccupantClaim && hasBookableGap && (room || row.roomId) && (
                                  <button
                                    type="button"
                                    disabled={quickAddLoadingRoomId === (room?.id || row.roomId)}
                                    onClick={() => handleOpenQuickAddTenant(room?.id || row.roomId)}
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
                                {!hasOccupantClaim && !hasBookableGap && (
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
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                                    className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                                  >
                                    <User className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate max-w-[100px]">{effectiveTenantName}</span>
                                    <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                                  </button>
                                  {contractEndDate && (
                                    <span className="text-xs font-bold text-slate-800">
                                      ({formatShortThaiBuddhistDate(contractEndDate)})
                                    </span>
                                  )}
                                </div>
                                {dailyCheckOutDate && (
                                  <span className="text-xs font-bold text-slate-700">
                                    ({formatShortThaiBuddhistDate(dailyCheckOutDate)})
                                  </span>
                                )}
                              </div>
                            );
                          }

                          if (hasMonthly) {
                            return (
                              <div className="flex items-center gap-1.5">
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
                                {contractEndDate && (
                                  <span className="text-xs font-bold text-slate-800">
                                    ({formatShortThaiBuddhistDate(contractEndDate)})
                                  </span>
                                )}
                              </div>
                            );
                          }

                          if (hasDaily) {
                            return (
                              <div className="flex flex-col items-start gap-0.5">
                                <span className="text-xs font-bold text-slate-800">
                                  {effectiveDailyTenantName || 'ผู้พักรายวัน'}
                                </span>
                                {dailyCheckOutDate && (
                                  <span className="text-xs font-bold text-slate-700">
                                    ({formatShortThaiBuddhistDate(dailyCheckOutDate)})
                                  </span>
                                )}
                              </div>
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
        ) : (
          <div className="p-4 bg-slate-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="meter-list-container">
              {filteredRows.map((row, idx) => (
                <OwnerMeterListCard
                  key={row.roomId}
                  row={row}
                  idx={idx}
                  originalRow={(originalRowsRef.current || []).find(r => r.roomId === row.roomId)}
                  room={rooms.find(r => r.id === row.roomId)}
                  roomCtx={previewContext?.rooms?.find((r: any) => r.roomId === row.roomId)}
                  rateSnapshot={rateSnapshot}
                  tenant={getTenantForRoomAndCycle(row.roomId, selectedCycle)}
                  contracts={contracts}
                  isRateSnapshotReady={isRateSnapshotReady}
                  isWaterUnit={isWaterUnit}
                  isElecUnit={isElecUnit}
                  isFirstCycle={isFirstCycle}
                  selectedCycleCode={selectedCycleCode}
                  selectedCycle={selectedCycle}
                  selectedBillingCycleId={selectedBillingCycleId}
                  billingCycles={billingCyclesData?.selectableBillingCycles || billingCycles}
                  isSaving={isSaving}
                  isMutationReady={isMutationReady}
                  unlockedElecPrev={unlockedElecPrev}
                  unlockedWaterPrev={unlockedWaterPrev}
                  flashingCells={flashingCells}
                  isExpandedBreakdown={Boolean(expandedBreakdowns[row.roomId])}
                  quickAddLoadingRoomId={quickAddLoadingRoomId}
                  onOpenOtherFees={(targetRoomId) => setActiveFeeModalRoomId(targetRoomId)}
                  onMeterReadingChange={handleMeterReadingChange}
                  onMeterReadingBlur={handleMeterReadingBlur}
                  onPaste={handlePaste}
                  onUnlockElecPrev={(roomId) => setUnlockedElecPrev(prev => ({ ...prev, [roomId]: true }))}
                  onCancelElecPrev={(roomId) => {
                    const orig = (originalRowsRef.current || []).find((o) => o.roomId === roomId);
                    handleMeterReadingChange(roomId, 'elecPrev', orig ? orig.elecPrev : row.elecPrev);
                    setUnlockedElecPrev((prev) => ({ ...prev, [roomId]: false }));
                  }}
                  onUnlockWaterPrev={(roomId) => setUnlockedWaterPrev(prev => ({ ...prev, [roomId]: true }))}
                  onCancelWaterPrev={(roomId) => {
                    const orig = (originalRowsRef.current || []).find((o) => o.roomId === roomId);
                    handleMeterReadingChange(roomId, 'waterPrev', orig ? orig.waterPrev : row.waterPrev);
                    setUnlockedWaterPrev((prev) => ({ ...prev, [roomId]: false }));
                  }}
                  onPeopleCountChange={handlePeopleCountChange}
                  onToggleStatusSwitch={handleToggleStatusSwitch}
                  onToggleBreakdown={(roomId) => setExpandedBreakdowns(prev => ({ ...prev, [roomId]: !prev[roomId] }))}
                  onSelectTenant={onSelectTenant}
                  onOpenQuickAdd={handleOpenQuickAddTenant}
                />
              ))}
            </div>
            {filteredRows.length === 0 && (
              <div className="p-8 text-center text-gray-400 text-xs">
                ไม่พบข้อมูลห้องพักพักอาศัยที่ต้องการ
              </div>
            )}
          </div>
        )}

        {/* Floating Save Button - ONLY shown when changes exist (isDirty is true), always visible without scrolling */}
        {isDirty && (
          <div className="fixed bottom-[84px] md:bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-8 w-[calc(100%-32px)] md:w-auto z-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="relative w-full md:w-auto group">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveMeters}
                className={`relative w-full md:w-auto px-8 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-black text-xs md:text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-2xl transition-all select-none border border-indigo-400/40 ${isSaving
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
          <div className={`bg-white rounded-3xl p-6 ${isSpreadsheetMode ? 'max-w-4xl' : 'max-w-lg'} w-full shadow-2xl border border-gray-100 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200`}>

            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="bg-emerald-500 text-white rounded-full flex items-center justify-center w-11 h-11 shadow-md shadow-emerald-500/20">
                  <Zap className="w-5 h-5 fill-white text-emerald-300" />
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-slate-900 leading-tight">กรอกแบบรวดเร็ว</h4>
                  <p className="text-[11px] text-gray-400 font-bold mt-0.5 leading-none">
                    {isSpreadsheetMode ? 'โหมดตาราง สามารถคัดลอก/วาง (Paste) จาก Excel ได้' : 'วางข้อมูลหลายห้อง ระบบจะใส่ลงตารางให้'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsQuickFillOpen(false);
                  setTemplateUsed(false);
                  setIsSpreadsheetMode(false);
                }}
                className="text-rose-500 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-full p-2 cursor-pointer flex items-center justify-center transition-all shadow-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isSpreadsheetMode ? (
              /* Spreadsheet / Excel Connected Grid Mode */
              <div
                className="flex flex-col gap-2 h-[340px] overflow-hidden border border-slate-300 rounded-2xl bg-white shadow-2xs"
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text');
                  if (!text) return;
                  const lines = text.trim().split(/\r?\n/);
                  if (lines.length === 0) return;

                  // Amendment 5:
                  // MODE A: Active spreadsheet cell / range exists -> relative rectangular paste beginning at anchor
                  if (activeSpreadsheetCell && activeSpreadsheetCell.rowIndex >= 0) {
                    e.preventDefault();
                    const anchorRow = activeSpreadsheetCell.rowIndex;
                    const anchorColIndex = spreadsheetColumns.findIndex(c => c.key === activeSpreadsheetCell.colKey);
                    const startCol = anchorColIndex >= 0 ? anchorColIndex : 2;

                    const updated = [...meterRows];
                    const newRejectedCells = { ...rejectedSpreadsheetCells };
                    let pasteCount = 0;

                    lines.forEach((line, lineOffset) => {
                      const targetRow = anchorRow + lineOffset;
                      if (targetRow >= updated.length) return;

                      const cells = line.split('\t');
                      cells.forEach((cellVal, colOffset) => {
                        const targetCol = startCol + colOffset;
                        if (targetCol >= spreadsheetColumns.length) return;

                        const col = spreadsheetColumns[targetCol];
                        // Building and Room remain strictly immutable
                        if (!col || !col.editable) return;

                        const cellKey = `${targetRow}:${col.key}`;
                        const norm = validateAndNormalizeSpreadsheetValue(col.key as any, cellVal);
                        if (norm.valid) {
                          updated[targetRow] = {
                            ...updated[targetRow],
                            [col.key]: norm.value,
                          };
                          delete newRejectedCells[cellKey];
                          pasteCount++;
                        } else {
                          newRejectedCells[cellKey] = true;
                        }
                      });
                    });

                    setMeterRows(updated);
                    setRejectedSpreadsheetCells(newRejectedCells);
                    if (pasteCount > 0) {
                      pushHistory(updated);
                      showToast(`วางข้อมูลสำเร็จ (${pasteCount} ช่อง)`);
                    }
                    return;
                  }

                  // MODE B: No active spreadsheet cell / external import -> row-matching Excel paste
                  let matchCount = 0;
                  const updated = [...meterRows];
                  const newRejectedCells = { ...rejectedSpreadsheetCells };
                  lines.forEach(line => {
                    const cells = line.split('\t').map(c => c.trim());
                    if (cells.length >= 2) {
                      let bCode = cells[0];
                      let rNum = cells[1];
                      let elecPrevVal = cells[2];
                      let elecCurrVal = cells[3];
                      let waterPrevVal = cells[4];
                      let waterCurrVal = cells[5];
                      let peopleVal = cells[6];

                      const normB = bCode.toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');

                      let rowIdx = updated.findIndex(r => {
                        const rB = (r.buildingCode || '').toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
                        const rName = (r.buildingName || '').toUpperCase().replace(/^BLD-/, '').replace(/^อาคาร\s*/, '');
                        return (rB === normB || rName === normB) &&
                          r.roomNumber.toLowerCase() === rNum.toLowerCase();
                      });

                      if (rowIdx < 0) {
                        rowIdx = updated.findIndex(r => r.roomNumber.toLowerCase() === bCode.toLowerCase());
                        if (rowIdx >= 0) {
                          elecPrevVal = cells[1];
                          elecCurrVal = cells[2];
                          waterPrevVal = cells[3];
                          waterCurrVal = cells[4];
                          peopleVal = cells[5];
                        }
                      }

                      if (rowIdx >= 0) {
                        matchCount++;
                        if (elecPrevVal !== undefined && elecPrevVal !== '') {
                          const cellKey = `${rowIdx}:elecPrev`;
                          const norm = validateAndNormalizeSpreadsheetValue('elecPrev', elecPrevVal);
                          if (norm.valid) {
                            updated[rowIdx].elecPrev = norm.value as string;
                            delete newRejectedCells[cellKey];
                          } else {
                            newRejectedCells[cellKey] = true;
                          }
                        }
                        if (elecCurrVal !== undefined && elecCurrVal !== '') {
                          const cellKey = `${rowIdx}:elecCurr`;
                          const norm = validateAndNormalizeSpreadsheetValue('elecCurr', elecCurrVal);
                          if (norm.valid) {
                            updated[rowIdx].elecCurr = norm.value as string;
                            delete newRejectedCells[cellKey];
                          } else {
                            newRejectedCells[cellKey] = true;
                          }
                        }
                        if (waterPrevVal !== undefined && waterPrevVal !== '') {
                          const cellKey = `${rowIdx}:waterPrev`;
                          const norm = validateAndNormalizeSpreadsheetValue('waterPrev', waterPrevVal);
                          if (norm.valid) {
                            updated[rowIdx].waterPrev = norm.value as string;
                            delete newRejectedCells[cellKey];
                          } else {
                            newRejectedCells[cellKey] = true;
                          }
                        }
                        if (waterCurrVal !== undefined && waterCurrVal !== '') {
                          const cellKey = `${rowIdx}:waterCurr`;
                          const norm = validateAndNormalizeSpreadsheetValue('waterCurr', waterCurrVal);
                          if (norm.valid) {
                            updated[rowIdx].waterCurr = norm.value as string;
                            delete newRejectedCells[cellKey];
                          } else {
                            newRejectedCells[cellKey] = true;
                          }
                        }
                        if (peopleVal !== undefined && peopleVal !== '') {
                          const cellKey = `${rowIdx}:peopleCount`;
                          const norm = validateAndNormalizeSpreadsheetValue('peopleCount', peopleVal);
                          if (norm.valid) {
                            updated[rowIdx].peopleCount = norm.value as number;
                            delete newRejectedCells[cellKey];
                          } else {
                            newRejectedCells[cellKey] = true;
                          }
                        }
                      }
                    }
                  });
                  setMeterRows(updated);
                  setRejectedSpreadsheetCells(newRejectedCells);
                  if (matchCount > 0) {
                    pushHistory(updated);
                    showToast(`วางข้อมูลสำเร็จ ${matchCount} ห้อง`);
                  }
                }}
              >
                <div
                  ref={spreadsheetScrollContainerRef}
                  className="overflow-x-auto overflow-y-auto h-full"
                  onPointerMove={handlePointerMoveFillHandle}
                  onPointerUp={handlePointerUpFillHandle}
                >
                  <table className="w-full text-left text-xs border-collapse border border-slate-300 font-sans">
                    <thead className="bg-slate-100 text-slate-800 font-extrabold sticky top-0 z-30 border-b border-slate-300 select-none shadow-xs">
                      <tr>
                        <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center w-16">อาคาร</th>
                        <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center w-20">ห้อง</th>
                        {isElecUnit && <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center">มิเตอร์ไฟเดิม</th>}
                        {isElecUnit && <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center bg-indigo-50 text-indigo-900">มิเตอร์ไฟใหม่</th>}
                        {isWaterUnit && <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center">มิเตอร์น้ำเดิม</th>}
                        {isWaterUnit && <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center bg-blue-50 text-blue-900">มิเตอร์น้ำใหม่</th>}
                        <th className="py-2 px-2.5 whitespace-nowrap border border-slate-300 text-center w-20">จำนวนคน</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-slate-800">
                      {meterRows.map((row, rowIdx) => (
                        <tr key={row.roomId} data-row-index={rowIdx} className="hover:bg-slate-50/80 transition-colors">
                          <td
                            data-cell-row={rowIdx}
                            data-cell-col="buildingCode"
                            onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'buildingCode' as any)}
                            onPointerEnter={() => handlePointerEnterCell(rowIdx, 'buildingCode' as any)}
                            className={`p-0 border border-slate-300 text-center select-none text-slate-500 font-bold font-sans bg-slate-50/50 h-8 ${isCellInRangeSelected(rowIdx, 'buildingCode') ? 'bg-indigo-50/70 border-indigo-400' : ''}`}
                          >
                            {(row.buildingCode || 'A').replace(/^BLD-/, '').replace(/^อาคาร\s*/, '') || 'A'}
                          </td>
                          <td
                            data-cell-row={rowIdx}
                            data-cell-col="roomNumber"
                            onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'roomNumber' as any)}
                            onPointerEnter={() => handlePointerEnterCell(rowIdx, 'roomNumber' as any)}
                            className={`p-0 border border-slate-300 text-center select-none font-bold text-slate-900 bg-slate-50/50 h-8 ${isCellInRangeSelected(rowIdx, 'roomNumber') ? 'bg-indigo-50/70 border-indigo-400' : ''}`}
                          >
                            {row.roomNumber}
                          </td>
                          {isElecUnit && (() => {
                            const isActive = activeSpreadsheetCell?.rowIndex === rowIdx && activeSpreadsheetCell?.colKey === 'elecPrev';
                            const isFillPreview = isCellInFillPreview(rowIdx, 'elecPrev');
                            const isSelected = isCellInRangeSelected(rowIdx, 'elecPrev');
                            const isRejected = Boolean(rejectedSpreadsheetCells[`${rowIdx}:elecPrev`]);
                            return (
                              <td
                                data-cell-row={rowIdx}
                                data-cell-col="elecPrev"
                                onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'elecPrev')}
                                onPointerEnter={() => handlePointerEnterCell(rowIdx, 'elecPrev')}
                                title={isRejected ? 'ข้อมูลไม่ถูกต้องตามรูปแบบ (ถูกปฏิเสธ)' : undefined}
                                className={`p-0 border border-slate-300 relative ${isRejected ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500 ring-inset z-10' : (isActive ? 'ring-2 ring-indigo-600 ring-inset z-10' : '')} ${isSelected ? 'bg-indigo-50/70 border-indigo-400' : ''} ${isFillPreview ? 'bg-indigo-100/70 border-indigo-500' : ''}`}
                              >
                                <input
                                  type="text"
                                  value={row.elecPrev}
                                  onFocus={() => handleFocusCell(rowIdx, 'elecPrev')}
                                  onClick={() => handleFocusCell(rowIdx, 'elecPrev')}
                                  onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'elecPrev')}
                                  onPointerEnter={() => handlePointerEnterCell(rowIdx, 'elecPrev')}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMeterRows(prev => prev.map(r => r.roomId === row.roomId ? { ...r, elecPrev: v } : r));
                                  }}
                                  className="w-full h-8 px-2 text-center bg-transparent border-0 text-xs font-mono font-bold text-slate-700 focus:outline-none focus:bg-indigo-50/50 focus:ring-1 focus:ring-indigo-500"
                                />
                                {isActive && (
                                  <div
                                    data-testid="drag-fill-handle"
                                    onPointerDown={(e) => handlePointerDownFillHandle(e, rowIdx, 'elecPrev')}
                                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-20 shadow-xs select-none"
                                    title="ลากเพื่อเติมข้อมูลอัตโนมัติ"
                                  />
                                )}
                              </td>
                            );
                          })()}
                          {isElecUnit && (() => {
                            const isActive = activeSpreadsheetCell?.rowIndex === rowIdx && activeSpreadsheetCell?.colKey === 'elecCurr';
                            const isFillPreview = isCellInFillPreview(rowIdx, 'elecCurr');
                            const isSelected = isCellInRangeSelected(rowIdx, 'elecCurr');
                            const isRejected = Boolean(rejectedSpreadsheetCells[`${rowIdx}:elecCurr`]);
                            return (
                              <td
                                data-cell-row={rowIdx}
                                data-cell-col="elecCurr"
                                onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'elecCurr')}
                                onPointerEnter={() => handlePointerEnterCell(rowIdx, 'elecCurr')}
                                title={isRejected ? 'ข้อมูลไม่ถูกต้องตามรูปแบบ (ถูกปฏิเสธ)' : undefined}
                                className={`p-0 border border-slate-300 relative bg-indigo-50/20 ${isRejected ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500 ring-inset z-10' : (isActive ? 'ring-2 ring-indigo-600 ring-inset z-10' : '')} ${isSelected ? 'bg-indigo-50/70 border-indigo-400' : ''} ${isFillPreview ? 'bg-indigo-100/70 border-indigo-500' : ''}`}
                              >
                                <input
                                  type="text"
                                  value={row.elecCurr}
                                  onFocus={() => handleFocusCell(rowIdx, 'elecCurr')}
                                  onClick={() => handleFocusCell(rowIdx, 'elecCurr')}
                                  onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'elecCurr')}
                                  onPointerEnter={() => handlePointerEnterCell(rowIdx, 'elecCurr')}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMeterRows(prev => prev.map(r => r.roomId === row.roomId ? { ...r, elecCurr: v } : r));
                                  }}
                                  className="w-full h-8 px-2 text-center bg-transparent border-0 text-xs font-mono font-bold text-indigo-950 focus:outline-none focus:bg-indigo-50 focus:ring-1 focus:ring-indigo-500"
                                />
                                {isActive && (
                                  <div
                                    data-testid="drag-fill-handle"
                                    onPointerDown={(e) => handlePointerDownFillHandle(e, rowIdx, 'elecCurr')}
                                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-20 shadow-xs select-none"
                                    title="ลากเพื่อเติมข้อมูลอัตโนมัติ"
                                  />
                                )}
                              </td>
                            );
                          })()}
                          {isWaterUnit && (() => {
                            const isActive = activeSpreadsheetCell?.rowIndex === rowIdx && activeSpreadsheetCell?.colKey === 'waterPrev';
                            const isFillPreview = isCellInFillPreview(rowIdx, 'waterPrev');
                            const isSelected = isCellInRangeSelected(rowIdx, 'waterPrev');
                            const isRejected = Boolean(rejectedSpreadsheetCells[`${rowIdx}:waterPrev`]);
                            return (
                              <td
                                data-cell-row={rowIdx}
                                data-cell-col="waterPrev"
                                onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'waterPrev')}
                                onPointerEnter={() => handlePointerEnterCell(rowIdx, 'waterPrev')}
                                title={isRejected ? 'ข้อมูลไม่ถูกต้องตามรูปแบบ (ถูกปฏิเสธ)' : undefined}
                                className={`p-0 border border-slate-300 relative ${isRejected ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500 ring-inset z-10' : (isActive ? 'ring-2 ring-indigo-600 ring-inset z-10' : '')} ${isSelected ? 'bg-indigo-50/70 border-indigo-400' : ''} ${isFillPreview ? 'bg-indigo-100/70 border-indigo-500' : ''}`}
                              >
                                <input
                                  type="text"
                                  value={row.waterPrev}
                                  onFocus={() => handleFocusCell(rowIdx, 'waterPrev')}
                                  onClick={() => handleFocusCell(rowIdx, 'waterPrev')}
                                  onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'waterPrev')}
                                  onPointerEnter={() => handlePointerEnterCell(rowIdx, 'waterPrev')}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMeterRows(prev => prev.map(r => r.roomId === row.roomId ? { ...r, waterPrev: v } : r));
                                  }}
                                  className="w-full h-8 px-2 text-center bg-transparent border-0 text-xs font-mono font-bold text-slate-700 focus:outline-none focus:bg-blue-50/50 focus:ring-1 focus:ring-blue-500"
                                />
                                {isActive && (
                                  <div
                                    data-testid="drag-fill-handle"
                                    onPointerDown={(e) => handlePointerDownFillHandle(e, rowIdx, 'waterPrev')}
                                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-20 shadow-xs select-none"
                                    title="ลากเพื่อเติมข้อมูลอัตโนมัติ"
                                  />
                                )}
                              </td>
                            );
                          })()}
                          {isWaterUnit && (() => {
                            const isActive = activeSpreadsheetCell?.rowIndex === rowIdx && activeSpreadsheetCell?.colKey === 'waterCurr';
                            const isFillPreview = isCellInFillPreview(rowIdx, 'waterCurr');
                            const isSelected = isCellInRangeSelected(rowIdx, 'waterCurr');
                            const isRejected = Boolean(rejectedSpreadsheetCells[`${rowIdx}:waterCurr`]);
                            return (
                              <td
                                data-cell-row={rowIdx}
                                data-cell-col="waterCurr"
                                onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'waterCurr')}
                                onPointerEnter={() => handlePointerEnterCell(rowIdx, 'waterCurr')}
                                title={isRejected ? 'ข้อมูลไม่ถูกต้องตามรูปแบบ (ถูกปฏิเสธ)' : undefined}
                                className={`p-0 border border-slate-300 relative bg-blue-50/20 ${isRejected ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500 ring-inset z-10' : (isActive ? 'ring-2 ring-indigo-600 ring-inset z-10' : '')} ${isSelected ? 'bg-indigo-50/70 border-indigo-400' : ''} ${isFillPreview ? 'bg-indigo-100/70 border-indigo-500' : ''}`}
                              >
                                <input
                                  type="text"
                                  value={row.waterCurr}
                                  onFocus={() => handleFocusCell(rowIdx, 'waterCurr')}
                                  onClick={() => handleFocusCell(rowIdx, 'waterCurr')}
                                  onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'waterCurr')}
                                  onPointerEnter={() => handlePointerEnterCell(rowIdx, 'waterCurr')}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setMeterRows(prev => prev.map(r => r.roomId === row.roomId ? { ...r, waterCurr: v } : r));
                                  }}
                                  className="w-full h-8 px-2 text-center bg-transparent border-0 text-xs font-mono font-bold text-blue-950 focus:outline-none focus:bg-blue-50 focus:ring-1 focus:ring-blue-500"
                                />
                                {isActive && (
                                  <div
                                    data-testid="drag-fill-handle"
                                    onPointerDown={(e) => handlePointerDownFillHandle(e, rowIdx, 'waterCurr')}
                                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-20 shadow-xs select-none"
                                    title="ลากเพื่อเติมข้อมูลอัตโนมัติ"
                                  />
                                )}
                              </td>
                            );
                          })()}
                          {(() => {
                            const isActive = activeSpreadsheetCell?.rowIndex === rowIdx && activeSpreadsheetCell?.colKey === 'peopleCount';
                            const isFillPreview = isCellInFillPreview(rowIdx, 'peopleCount');
                            const isSelected = isCellInRangeSelected(rowIdx, 'peopleCount');
                            const isRejected = Boolean(rejectedSpreadsheetCells[`${rowIdx}:peopleCount`]);
                            return (
                              <td
                                data-cell-row={rowIdx}
                                data-cell-col="peopleCount"
                                onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'peopleCount')}
                                onPointerEnter={() => handlePointerEnterCell(rowIdx, 'peopleCount')}
                                title={isRejected ? 'ข้อมูลไม่ถูกต้องตามรูปแบบ (ถูกปฏิเสธ)' : undefined}
                                className={`p-0 border border-slate-300 relative ${isRejected ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-500 ring-inset z-10' : (isActive ? 'ring-2 ring-indigo-600 ring-inset z-10' : '')} ${isSelected ? 'bg-indigo-50/70 border-indigo-400' : ''} ${isFillPreview ? 'bg-indigo-100/70 border-indigo-500' : ''}`}
                              >
                                <input
                                  type="number"
                                  min={0}
                                  value={row.peopleCount}
                                  onFocus={() => handleFocusCell(rowIdx, 'peopleCount')}
                                  onClick={() => handleFocusCell(rowIdx, 'peopleCount')}
                                  onPointerDown={(e) => handlePointerDownCell(e, rowIdx, 'peopleCount')}
                                  onPointerEnter={() => handlePointerEnterCell(rowIdx, 'peopleCount')}
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value, 10);
                                    setMeterRows(prev => prev.map(r => r.roomId === row.roomId ? { ...r, peopleCount: isNaN(v) ? 0 : v } : r));
                                  }}
                                  className="w-full h-8 px-2 text-center bg-transparent border-0 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:bg-indigo-50/50 focus:ring-1 focus:ring-indigo-500"
                                />
                                {isActive && (
                                  <div
                                    data-testid="drag-fill-handle"
                                    onPointerDown={(e) => handlePointerDownFillHandle(e, rowIdx, 'peopleCount')}
                                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-indigo-600 border border-white cursor-crosshair z-20 shadow-xs select-none"
                                    title="ลากเพื่อเติมข้อมูลอัตโนมัติ"
                                  />
                                )}
                              </td>
                            );
                          })()}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* Template Section & Textarea Container with stable, non-jittery height */
              <div className="flex flex-col gap-4 h-[320px] justify-between shrink-0">
                {/* Template Section: only show if text is <= 1 line */}
                {quickFillText.split('\n').filter(l => l.trim()).length <= 1 && (
                  <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col gap-2 shrink-0 h-[100px] justify-center">
                    <span className="text-xs font-black text-slate-800 leading-none text-left">
                      รูปแบบ ({templateMode === 'METER_ONLY' ? 'เฉพาะมิเตอร์' : 'ทั้งหมด'})
                    </span>
                    <div className="bg-white border border-gray-200 rounded-xl p-3 font-mono text-xs text-slate-600 flex items-center justify-start text-left shadow-2xs leading-relaxed whitespace-nowrap overflow-x-auto select-all no-scrollbar">
                      {getTemplateFormatString(templateMode)}
                    </div>
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
            )}

            {/* Footer Buttons */}
            <div className="flex items-center justify-between gap-2.5 mt-2 flex-nowrap">
              <div className="flex items-center gap-2 shrink-0">
                {!isSpreadsheetMode && (
                  (!isElecUnit && !isWaterUnit) ? (
                    templateUsed ? (
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
                            }
                          } catch { }

                          const txt = generateTemplateText('FULL', freshHouseholdMap);
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
                    )
                  ) : (
                    /* Meter-driven toggle */
                    <button
                      type="button"
                      onClick={async () => {
                        const nextMode = templateMode === 'FULL' ? 'METER_ONLY' : 'FULL';
                        setTemplateMode(nextMode);

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
                          }
                        } catch { }

                        const txt = generateTemplateText(nextMode, freshHouseholdMap);
                        setQuickFillText(txt);
                        setTimeout(() => {
                          quickFillInputRef.current?.focus();
                        }, 50);
                      }}
                      className="border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-98 whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                      <span>{templateMode === 'FULL' ? 'แม่แบบ (เฉพาะมิเตอร์)' : 'แม่แบบ (ทั้งหมด)'}</span>
                    </button>
                  )
                )}

                {/* Excel Mode Icon Button */}
                <button
                  type="button"
                  onClick={() => setIsSpreadsheetMode(!isSpreadsheetMode)}
                  className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${isSpreadsheetMode ? 'bg-emerald-100 border-emerald-300 shadow-2xs' : 'bg-white hover:bg-slate-50 border-gray-200'}`}
                  title={isSpreadsheetMode ? 'สลับไปยังโหมดข้อความ' : 'สลับไปยังโหมดตาราง Excel'}
                >
                  <img
                    src="https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/Microsoft_Office_Excel_%282025%E2%80%93present%29.svg/330px-Microsoft_Office_Excel_%282025%E2%80%93present%29.svg.png"
                    alt="Excel Mode"
                    className="w-4 h-4 sm:w-5 sm:h-5 object-contain"
                  />
                </button>
              </div>

              <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setIsQuickFillOpen(false);
                    setTemplateUsed(false);
                    setIsSpreadsheetMode(false);
                  }}
                  className="border border-gray-200 hover:bg-gray-50 text-slate-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer active:scale-98 whitespace-nowrap shrink-0"
                >
                  {isSpreadsheetMode ? 'ปิด' : 'ยกเลิก'}
                </button>

                {!isSpreadsheetMode && (
                  quickFillText.trim() === '' ? (
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
                  )
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
        onNavigateToLineConfig={onNavigateToLineConfig}
        onNavigate={onNavigate}
      />

      {/* Shared Other Fees Modal Editor (Table and List modes) */}
      {activeFeeModalRoomId && (() => {
        const targetRow = meterRows.find(r => r.roomId === activeFeeModalRoomId);
        if (!targetRow) return null;
        const isRowPaid = targetRow.isPaid || targetRow.billStatus === 'paid';
        return (
          <MeterOtherFeesModal
            isOpen={Boolean(activeFeeModalRoomId)}
            roomId={targetRow.roomId}
            roomNumber={targetRow.roomNumber}
            initialFees={targetRow.otherFees || []}
            isLocked={isRowPaid}
            onClose={() => setActiveFeeModalRoomId(null)}
            onSave={(nextFees) => handleSaveOtherFeesModal(targetRow.roomId, nextFees)}
          />
        );
      })()}
    </div>
  );
};
