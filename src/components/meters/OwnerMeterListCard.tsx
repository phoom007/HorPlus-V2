/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * OwnerMeterListCard — List Mode Presentation for HorPlus Meter Workspace
 */

import React, { useMemo } from 'react';
import {
  Zap,
  Droplets,
  Gauge,
  User,
  Users,
  ArrowRight,
  Pencil,
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Tag,
  Wifi,
  Smartphone,
  Building2,
  Car,
  CheckCircle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
} from 'lucide-react';
import {
  MeterRowState,
  formatComponentDetailAmount,
  getOwnerFinancialBreakdown,
} from '../../pages/owner/meters';
import {
  Room,
  Tenant,
  Contract,
} from '../../types';
import {
  formatMeterReadingDisplay,
} from '../../components/GlobalComponents';
import {
  calculateMeterUsageUnits,
  formatMoneyDisplay,
} from '../../utils/meterBillingCalculator';
import {
  formatShortThaiBuddhistDate,
  isCycleInRollingThreeMonthWindow,
} from '../../utils/calendarDate';

export interface OwnerMeterListCardProps {
  row: MeterRowState;
  idx: number;
  room?: Room;
  roomCtx?: any;
  tenant?: Tenant;
  contracts?: Contract[];
  rateSnapshot?: any;
  isRateSnapshotReady: boolean;
  isWaterUnit: boolean;
  isElecUnit: boolean;
  isFirstCycle: boolean;
  selectedCycleCode?: string;
  selectedCycle?: string;
  selectedBillingCycleId?: string;
  billingCycles?: any[];
  isSaving: boolean;
  isMutationReady: boolean;
  unlockedElecPrev: { [roomId: string]: boolean };
  unlockedWaterPrev: { [roomId: string]: boolean };
  flashingCells?: { [key: string]: boolean };
  isExpandedBreakdown: boolean;
  quickAddLoadingRoomId: string | null;
  onOpenOtherFees: (roomId: string) => void;
  onMeterReadingChange: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr', value: string) => void;
  onMeterReadingBlur: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr') => void;
  onPaste: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr' | 'peopleCount' | 'overdueAmount', e: React.ClipboardEvent<HTMLInputElement>) => void;
  onUnlockElecPrev: (roomId: string) => void;
  onCancelElecPrev: (roomId: string) => void;
  onUnlockWaterPrev: (roomId: string) => void;
  onCancelWaterPrev: (roomId: string) => void;
  onPeopleCountChange: (roomId: string, value: string) => void;
  onToggleStatusSwitch: (row: MeterRowState) => void;
  onToggleBreakdown: (roomId: string) => void;
  onSelectTenant: (tenantId: string, roomId?: string) => void;
  onOpenQuickAdd: (targetRoomId: string) => void;
}

export function getComponentItemIcon(label: string, type?: string) {
  const l = (label || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (l.includes('น้ำ') || t.includes('water')) {
    return <Droplets className="w-3.5 h-3.5 text-sky-500 shrink-0" />;
  }
  if (l.includes('ไฟ') || t.includes('elec') || t.includes('electric')) {
    return <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />;
  }
  if (l.includes('ส่วนกลาง') || t.includes('common')) {
    return <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
  }
  if (l.includes('อินเทอร์เน็ต') || l.includes('เน็ต') || l.includes('wifi') || t.includes('internet')) {
    return <Wifi className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
  }
  if (l.includes('จอดรถ') || t.includes('parking') || t.includes('car')) {
    return <Car className="w-3.5 h-3.5 text-purple-500 shrink-0" />;
  }
  if (l.includes('ปรับ') || l.includes('ล่าช้า') || t.includes('penalty') || t.includes('late')) {
    return <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />;
  }
  if (l.includes('เช่า') || t.includes('rent')) {
    return <Building2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  }
  return <Tag className="w-3.5 h-3.5 text-indigo-500 shrink-0" />;
}

export const OwnerMeterListCard: React.FC<OwnerMeterListCardProps> = ({
  row,
  idx,
  room,
  roomCtx,
  tenant,
  rateSnapshot,
  isWaterUnit,
  isElecUnit,
  isFirstCycle,
  selectedCycleCode,
  selectedCycle,
  selectedBillingCycleId,
  billingCycles = [],
  isSaving,
  unlockedElecPrev,
  unlockedWaterPrev,
  flashingCells = {},
  isExpandedBreakdown,
  quickAddLoadingRoomId,
  onOpenOtherFees,
  onMeterReadingChange,
  onMeterReadingBlur,
  onPaste,
  onUnlockElecPrev,
  onCancelElecPrev,
  onUnlockWaterPrev,
  onCancelWaterPrev,
  onPeopleCountChange,
  onToggleStatusSwitch,
  onToggleBreakdown,
  onSelectTenant,
  onOpenQuickAdd,
}) => {
  // Usage calculations matching Table
  const waterUsageRes = (row.waterPrev !== '' && row.waterCurr !== '') ? calculateMeterUsageUnits(row.waterPrev, row.waterCurr) : { isValid: true, usageUnits: 0 };
  const elecUsageRes = (row.elecPrev !== '' && row.elecCurr !== '') ? calculateMeterUsageUnits(row.elecPrev, row.elecCurr) : { isValid: true, usageUnits: 0 };
  const waterUnits = row.isReplaced ? Number(row.waterCurr) : (waterUsageRes.isValid ? waterUsageRes.usageUnits : -1);
  const elecUnits = row.isReplaced ? Number(row.elecCurr) : (elecUsageRes.isValid ? elecUsageRes.usageUnits : -1);

  const effectiveTenantId = roomCtx ? roomCtx.tenantId : tenant?.id;
  const effectiveTenantName = roomCtx ? roomCtx.tenantName : tenant?.name;
  const isDailyContext = roomCtx?.billingSource === 'DAILY_STAY' || Boolean(roomCtx?.isDailyUnpaid);
  const isDailyOverdue = Boolean(roomCtx?.isDailyOverdue || roomCtx?.isDailyFinancialTail);
  const isDailyRentPaid = Boolean(roomCtx?.isDailyRentPaid);
  const isRowPaid = !isDailyContext && (row.isPaid || row.billStatus === 'paid');

  const hasElecBaseline = row.elecPrev !== '' && row.elecPrev !== null && row.elecPrev !== undefined;
  const isElecDirectEdit = isFirstCycle || !hasElecBaseline;

  const hasWaterBaseline = row.waterPrev !== '' && row.waterPrev !== null && row.waterPrev !== undefined;
  const isWaterDirectEdit = isFirstCycle || !hasWaterBaseline;

  const breakdown = getOwnerFinancialBreakdown(roomCtx);
  const amountDue = breakdown.formattedAmount;
  const chargeComponents = breakdown.components;

  const isFuture = Boolean(roomCtx?.isFutureReservation);
  const isLineLinked = roomCtx ? roomCtx.isLineLinked : Boolean((tenant as any)?.linkedUserId);
  const peopleCountVal = Number(row.peopleCount ?? roomCtx?.currentHouseholdPeopleCount ?? roomCtx?.snapshotPeopleCount ?? 1);
  const activeCycleCode = selectedCycleCode || selectedCycle || billingCycles?.find((c: any) => c.id === selectedBillingCycleId)?.cycleCode || '';
  const isEligibleAddTenantCycle = isCycleInRollingThreeMonthWindow(activeCycleCode, billingCycles);
  const hasBookableGap = roomCtx?.hasBookableGap ?? true;
  const historicalDailyCount = roomCtx?.historicalDailyCount || 0;
  const dailyCheckOutDate = roomCtx?.dailyCheckOutDate || null;

  // Rate calculations
  const rates = rateSnapshot || roomCtx?.rateSnapshot;
  const elecRate = Number(rates?.electricityRate ?? 7);
  const waterRate = Number(rates?.waterRate ?? 18);
  const waterBillingType = rates?.waterBillingType ?? 'per_unit';

  let elecCostText = '-';
  if (elecUnits >= 0 && row.elecCurr !== '') {
    const cost = elecUnits * elecRate;
    elecCostText = `${Math.round(cost).toLocaleString('th-TH')} .-`;
  }

  let waterCostText = '-';
  if (waterUnits >= 0 && row.waterCurr !== '') {
    let cost = 0;
    if (waterBillingType === 'per_person') {
      cost = peopleCountVal * waterRate;
    } else {
      cost = waterUnits * waterRate;
    }
    waterCostText = `${Math.round(cost).toLocaleString('th-TH')} .-`;
  }

  // Rent type & amount
  const rentalTypeLabel = roomCtx?.billingSource === 'DAILY_STAY' ? 'วัน' : roomCtx?.billingSource === 'TERM_CONTRACT' ? 'เทอม' : 'เดือน';
  const rentAmountNum = Number(roomCtx?.rentAmount ?? room?.monthlyRent ?? 0);
  const rentDisplay = rentAmountNum > 0 ? `${rentAmountNum.toLocaleString('th-TH')} .-` : '-';

  const otherFeesCount = (row.otherFees || []).length;

  // Decompose and itemize breakdown rows for List Mode (excluding rent which is already displayed on the top summary row)
  const listItemizedBreakdown = useMemo(() => {
    const items: Array<{
      id: string;
      label: string;
      amount: string | number;
      type: string;
      icon: React.ReactNode;
      errorMessage?: string;
    }> = [];

    const hasGenericMonthlyUtility = chargeComponents.some(
      (c: any) => c.type === 'monthly_utility' || (c.label && c.label.includes('บิลรายเดือน'))
    );

    if (hasGenericMonthlyUtility && rates) {
      // 1. 💧 ค่าน้ำประปา: กรณีคิดแบบเหมาจ่าย (บาท/ห้อง) หรือ คิดตามจำนวนคน (บาท/คน)
      if (!isWaterUnit && rates.waterBillingType && rates.waterBillingType !== 'none') {
        const wMode = rates.waterBillingType;
        const wRate = Number(rates.waterRate || 0);
        if (wMode === 'per_person' && wRate > 0) {
          const amt = peopleCountVal * wRate;
          items.push({
            id: 'item-water',
            label: `ค่าน้ำประปา (${peopleCountVal} คน)`,
            amount: amt,
            type: 'water',
            icon: <Droplets className="w-3.5 h-3.5 text-sky-500 shrink-0" />,
          });
        } else if ((wMode === 'fixed' || wMode === 'per_room' || wMode === 'fixed_per_room') && wRate > 0) {
          items.push({
            id: 'item-water',
            label: 'ค่าน้ำประปา (เหมาจ่าย)',
            amount: wRate,
            type: 'water',
            icon: <Droplets className="w-3.5 h-3.5 text-sky-500 shrink-0" />,
          });
        }
      }

      // 2. ⚡ ค่าไฟฟ้า: กรณีคิดแบบเหมาจ่าย (บาท/ห้อง) หรือ คิดตามจำนวนคน (บาท/คน)
      if (!isElecUnit && rates.electricityBillingType && rates.electricityBillingType !== 'none') {
        const eMode = rates.electricityBillingType;
        const eRate = Number(rates.electricityRate || 0);
        if (eMode === 'per_person' && eRate > 0) {
          const amt = peopleCountVal * eRate;
          items.push({
            id: 'item-elec',
            label: `ค่าไฟฟ้า (${peopleCountVal} คน)`,
            amount: amt,
            type: 'electricity',
            icon: <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
          });
        } else if ((eMode === 'fixed' || eMode === 'per_room' || eMode === 'fixed_per_room') && eRate > 0) {
          items.push({
            id: 'item-elec',
            label: 'ค่าไฟฟ้า (เหมาจ่าย)',
            amount: eRate,
            type: 'electricity',
            icon: <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />,
          });
        }
      }

      // 3. 🏢 ค่าส่วนกลาง: แสดงไอคอนและยอดตามที่ตั้งค่า
      if (rates.commonFeeMode && rates.commonFeeMode !== 'free' && rates.commonFeeMode !== 'none') {
        const cMode = rates.commonFeeMode;
        const cFee = Number(rates.commonFee || 0);
        if (cFee > 0) {
          const amt = (cMode === 'per_person' || cMode === 'person') ? peopleCountVal * cFee : cFee;
          items.push({
            id: 'item-common',
            label: (cMode === 'per_person' || cMode === 'person') ? `ค่าส่วนกลาง (${peopleCountVal} คน)` : 'ค่าส่วนกลาง',
            amount: amt,
            type: 'common_fee',
            icon: <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
          });
        }
      }

      // 4. 📶 ค่าอินเทอร์เน็ต: แสดงไอคอน WiFi และยอดตามที่ตั้งค่า
      if (rates.internetFeeMode && rates.internetFeeMode !== 'free' && rates.internetFeeMode !== 'none') {
        const iMode = rates.internetFeeMode;
        const iFee = Number(rates.internetFee || 0);
        if (iFee > 0) {
          const amt = (iMode === 'per_person' || iMode === 'person') ? peopleCountVal * iFee : iFee;
          items.push({
            id: 'item-internet',
            label: (iMode === 'per_person' || iMode === 'person') ? `ค่าอินเทอร์เน็ต (${peopleCountVal} คน)` : 'ค่าอินเทอร์เน็ต',
            amount: amt,
            type: 'internet',
            icon: <Wifi className="w-3.5 h-3.5 text-indigo-500 shrink-0" />,
          });
        }
      }

      // 5. 🚗 ค่าจอดรถ: แสดงไอคอนรถยนต์และยอดตามที่ตั้งค่า
      if (rates.parkingFeeMode && rates.parkingFeeMode !== 'free' && rates.parkingFeeMode !== 'none') {
        const pMode = rates.parkingFeeMode;
        const pFee = Number(rates.parkingFee || 0);
        if (pFee > 0) {
          let amt = pFee;
          let pLabel = 'ค่าจอดรถ';
          if (pMode === 'per_person' || pMode === 'person') {
            amt = peopleCountVal * pFee;
            pLabel = `ค่าจอดรถ (${peopleCountVal} คน)`;
          } else if (pMode === 'per_vehicle' || pMode === 'vehicle') {
            const qty = Number(roomCtx?.parkingQuantity || 1);
            amt = qty * pFee;
            pLabel = `ค่าจอดรถ (${qty} คัน)`;
          }
          items.push({
            id: 'item-parking',
            label: pLabel,
            amount: amt,
            type: 'parking',
            icon: <Car className="w-3.5 h-3.5 text-purple-500 shrink-0" />,
          });
        }
      }

      // 6. ⏰ ค่าปรับชำระล่าช้า (X วัน): แสดงไอคอนแจ้งเตือนและจำนวนเงิน
      const overdueAmt = Number(row.overdueAmount || roomCtx?.manualOutstandingAmount || 0);
      if (overdueAmt > 0) {
        items.push({
          id: 'item-overdue',
          label: 'ค่าปรับชำระล่าช้า',
          amount: overdueAmt,
          type: 'late_fee',
          icon: <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0" />,
        });
      }

      // 7. Non-monthly utility items from chargeComponents (e.g. deposit, custom fees) - omit rent since it is already displayed on top
      for (const c of chargeComponents) {
        if (
          c.type !== 'monthly_utility' &&
          c.type !== 'rent' &&
          (!c.label || (!c.label.includes('บิลรายเดือน') && !c.label.includes('ค่าเช่า')))
        ) {
          items.push({
            id: `item-comp-${c.label}`,
            label: c.label,
            amount: c.amount,
            type: c.type || 'other',
            icon: getComponentItemIcon(c.label, c.type),
            errorMessage: c.errorMessage,
          });
        }
      }

      // Fallback: If 0 items were generated from rate settings, display the original non-rent charge components
      if (items.length === 0 && chargeComponents.length > 0) {
        for (const c of chargeComponents) {
          if (
            c.type !== 'rent' &&
            (!c.label || !c.label.includes('ค่าเช่า'))
          ) {
            items.push({
              id: `item-comp-${c.label}`,
              label: c.label,
              amount: c.amount,
              type: c.type || 'other',
              icon: getComponentItemIcon(c.label, c.type),
              errorMessage: c.errorMessage,
            });
          }
        }
      }
    } else {
      // Direct pass-through for non-rent charge components
      for (const c of chargeComponents) {
        if (
          c.type !== 'rent' &&
          (!c.label || !c.label.includes('ค่าเช่า'))
        ) {
          items.push({
            id: `item-comp-${c.label}`,
            label: c.label,
            amount: c.amount,
            type: c.type || 'other',
            icon: getComponentItemIcon(c.label, c.type),
            errorMessage: c.errorMessage,
          });
        }
      }
    }

    return items;
  }, [chargeComponents, rates, isWaterUnit, isElecUnit, peopleCountVal, row.overdueAmount, roomCtx?.manualOutstandingAmount, roomCtx?.parkingQuantity]);

  // Dynamic Card Border Color based on Status:
  // - ยังไม่ออกบิล / ว่าง: สีเทา (border-slate-200)
  // - รอชำระ: สีส้ม (border-amber-400)
  // - จองล่วงหน้า: สีเหลือง (border-yellow-400)
  // - เกินกำหนด / รายวันค้างชำระ: สีแดง (border-rose-400)
  // - ชำระแล้ว: สีเขียว (border-emerald-400)
  const cardBorderClass = (() => {
    if (isDailyOverdue) {
      return 'border-rose-400 hover:border-rose-500';
    }
    if (isFuture) {
      return 'border-yellow-400 hover:border-yellow-500';
    }
    if (isRowPaid) {
      return 'border-emerald-400 hover:border-emerald-500';
    }
    if (row.billStatus !== 'draft' && row.billStatus !== 'cancelled') {
      return 'border-amber-400 hover:border-amber-500';
    }
    const hasUnpaidCharges = chargeComponents.some((c: any) => c.status === 'UNPAID');
    if (hasUnpaidCharges) {
      return 'border-amber-400 hover:border-amber-500';
    }
    return 'border-slate-200 hover:border-slate-300';
  })();

  return (
    <div
      id={`room-row-${row.roomId}`}
      data-testid={`meter-list-card-${row.roomId}`}
      className={`bg-white border-2 rounded-3xl p-5 shadow-xs flex flex-col justify-between gap-4 transition-all hover:shadow-md ${cardBorderClass}`}
    >
      {/* 1. Header: Room Number & Status Switch */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-xl font-black text-slate-900 tracking-tight">
            ห้อง {row.roomNumber}
          </span>
          {/* Status Badge */}
          {(() => {
            if (isDailyContext) {
              if (isDailyOverdue) {
                return (
                  <span className="inline-flex items-center px-2.5 py-0.5 bg-rose-100 text-rose-800 text-xs font-bold rounded-md border border-rose-200">
                    <AlertCircle className="w-3 h-3 text-rose-500 mr-1 shrink-0" />
                    รายวัน
                  </span>
                );
              }

              if (isDailyRentPaid) {
                return (
                  <span className="inline-flex items-center px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded-md border border-emerald-200">
                    <CheckCircle className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                    รายวัน
                  </span>
                );
              }

              return (
                <span className="inline-flex items-center px-2.5 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-md">
                  รายวัน
                </span>
              );
            }

            if ((roomCtx?.historicalDailyCount || 0) > 0 && !effectiveTenantId && row.billStatus === 'draft') {
              return <span className="text-xs text-slate-400 font-bold">-</span>;
            }

            return (
              <span
                className={`text-xs font-extrabold px-2.5 py-0.5 rounded-md ${
                  row.billStatus === 'paid'
                    ? 'bg-emerald-100 text-emerald-800'
                    : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {row.billStatus === 'paid'
                  ? 'ชำระแล้ว'
                  : row.billStatus === 'draft' || row.billStatus === 'cancelled'
                  ? 'ยังไม่ออกบิล'
                  : 'รอชำระเงิน'}
              </span>
            );
          })()}
        </div>

        {/* Status Toggle Switch */}
        <div className="flex items-center">
          <button
            type="button"
            role="switch"
            aria-checked={row.billStatus !== 'draft' && row.billStatus !== 'cancelled'}
            disabled={isSaving || row.isPaid || row.billStatus === 'paid' || !selectedBillingCycleId}
            onClick={() => onToggleStatusSwitch(row)}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
              row.billStatus === 'paid'
                ? 'bg-emerald-600'
                : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                ? 'bg-amber-400'
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
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                row.billStatus !== 'draft' && row.billStatus !== 'cancelled' ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* 2. Tenant / Occupant / Reservation / Daily Context */}
      <div className="text-xs">
        {(() => {
          if (isFuture) {
            return (
              <div className="flex items-center gap-2">
                {effectiveTenantId && effectiveTenantName ? (
                  <button
                    type="button"
                    onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                    className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 transition-all cursor-pointer font-bold whitespace-nowrap"
                  >
                    <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    <span className="truncate max-w-[180px]">{effectiveTenantName}</span>
                    <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                  </button>
                ) : null}
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-yellow-100 text-yellow-800 border border-yellow-300">
                  จองล่วงหน้า
                </span>
              </div>
            );
          }

          if (isEligibleAddTenantCycle) {
            const hasTenant = Boolean(effectiveTenantId && effectiveTenantName);
            const hasDailyStay = Boolean(dailyCheckOutDate);
            const hasOccupantClaim = hasTenant || hasDailyStay;

            return (
              <div className="flex items-center justify-between gap-2">
                {hasTenant && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                      className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 transition-all cursor-pointer font-bold whitespace-nowrap text-sm"
                    >
                      <User className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="truncate max-w-[200px]">{effectiveTenantName}</span>
                    </button>
                    {!isLineLinked && (
                      <span className="text-[10px] text-slate-400 font-normal leading-tight">
                        (ยังไม่ได้เชื่อม LINE)
                      </span>
                    )}
                    {dailyCheckOutDate && (
                      <span className="text-xs font-bold text-slate-700">
                        {formatShortThaiBuddhistDate(dailyCheckOutDate)}
                      </span>
                    )}
                  </div>
                )}
                {!hasTenant && dailyCheckOutDate && (
                  <span className="text-xs font-bold text-slate-700">
                    {formatShortThaiBuddhistDate(dailyCheckOutDate)}
                  </span>
                )}
                {!hasOccupantClaim && hasBookableGap && (
                  <button
                    type="button"
                    disabled={quickAddLoadingRoomId === (room?.id || row.roomId)}
                    onClick={() => onOpenQuickAdd(room?.id || row.roomId)}
                    className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2.5 py-1 rounded-xl border border-indigo-200 transition-all cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {quickAddLoadingRoomId === (room?.id || row.roomId) ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    ) : (
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                    )}
                    <span>เพิ่มผู้เช่า</span>
                  </button>
                )}
                {!hasOccupantClaim && !hasBookableGap && (
                  <span className="text-gray-400 font-medium">ไม่มีข้อมูล</span>
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
                  className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 transition-all cursor-pointer font-bold whitespace-nowrap"
                >
                  <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span className="truncate max-w-[180px]">{effectiveTenantName}</span>
                </button>
                {dailyCheckOutDate && (
                  <span className="text-xs font-bold text-slate-700">
                    {formatShortThaiBuddhistDate(dailyCheckOutDate)}
                  </span>
                )}
              </div>
            );
          }

          if (hasMonthly) {
            return (
              <button
                type="button"
                onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                className="inline-flex items-center gap-1.5 text-indigo-700 hover:text-indigo-900 transition-all cursor-pointer font-bold whitespace-nowrap text-sm"
              >
                <User className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="truncate max-w-[200px]">{effectiveTenantName}</span>
              </button>
            );
          }

          if (hasDaily && dailyCheckOutDate) {
            return (
              <span className="text-xs font-bold text-slate-700">
                {formatShortThaiBuddhistDate(dailyCheckOutDate)}
              </span>
            );
          }

          return <span className="text-gray-400 font-medium">ไม่มีข้อมูล</span>;
        })()}
      </div>

      {/* 3. Utility Meter Boxes (⚡ ไฟฟ้า & 💧 น้ำประปา — 2 คอลัมน์) */}
      {(isElecUnit || isWaterUnit) && (
        <div className={`grid ${isElecUnit && isWaterUnit ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
          {/* Electricity Box (Amber / Yellow Theme) */}
          {isElecUnit && (
            <div className="border-2 border-amber-300/80 bg-amber-50/20 rounded-2xl p-3 flex flex-col justify-between gap-2.5">
              {/* Header: Title & Previous Reading */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-white shrink-0">
                    <Zap className="w-3 h-3 fill-white text-white" />
                  </div>
                  <span className="text-xs font-black text-amber-950 tracking-tight">ไฟฟ้า</span>
                </div>

                {/* Previous Reading */}
                {isElecDirectEdit ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={isRowPaid}
                    value={row.elecPrev}
                    onChange={(e) => onMeterReadingChange(row.roomId, 'elecPrev', e.target.value)}
                    onBlur={() => onMeterReadingBlur(row.roomId, 'elecPrev')}
                    onPaste={(e) => onPaste(row.roomId, 'elecPrev', e)}
                    data-row={idx}
                    data-col="elecPrev"
                    className={`w-16 px-1.5 py-0.5 text-xs border-2 border-amber-400 rounded-lg bg-white text-slate-900 text-center font-bold focus:outline-none transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                      flashingCells[`${row.roomId}-elecPrev`] ? 'animate-vibrant-flash shadow-md z-10' : ''
                    }`}
                  />
                ) : isRowPaid ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">เดิม</span>
                    <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.elecPrev)}</span>
                  </div>
                ) : unlockedElecPrev[row.roomId] ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoFocus
                      value={row.elecPrev}
                      onChange={(e) => onMeterReadingChange(row.roomId, 'elecPrev', e.target.value)}
                      onBlur={() => onMeterReadingBlur(row.roomId, 'elecPrev')}
                      onPaste={(e) => onPaste(row.roomId, 'elecPrev', e)}
                      data-row={idx}
                      data-col="elecPrev"
                      className="w-16 px-1.5 py-0.5 text-xs border-2 border-amber-400 rounded-lg bg-white text-slate-900 text-center font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      data-testid={`cancel-elec-prev-${row.roomId}`}
                      title="ยกเลิกการแก้ไข"
                      onClick={() => onCancelElecPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
                    <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.elecPrev)}</span>
                    <button
                      type="button"
                      data-testid={`unlock-elec-prev-${row.roomId}`}
                      title="แก้ไขเลขอ่านเดิม"
                      onClick={() => onUnlockElecPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Large Current Reading Input */}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isRowPaid}
                placeholder="กรอกมิเตอร์"
                value={row.elecCurr}
                onChange={(e) => onMeterReadingChange(row.roomId, 'elecCurr', e.target.value)}
                onBlur={() => onMeterReadingBlur(row.roomId, 'elecCurr')}
                onPaste={(e) => onPaste(row.roomId, 'elecCurr', e)}
                data-row={idx}
                data-col="elecCurr"
                className={`w-full py-1.5 px-3 text-lg font-black text-center text-slate-900 bg-white border-2 rounded-xl focus:outline-none transition-all duration-300 ${
                  flashingCells[`${row.roomId}-elecCurr`]
                    ? 'animate-vibrant-flash shadow-md border-amber-500 z-10'
                    : elecUnits < 0
                    ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                    : 'border-amber-300/90 focus:border-amber-500'
                } disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200`}
              />

              {/* Footer: Units & Usage Amount */}
              <div className="flex items-center justify-between text-xs font-bold">
                <span className={elecUnits < 0 ? 'text-rose-600' : 'text-slate-800 font-extrabold'}>
                  {elecUnits < 0 ? 'เลขอ่านไม่ถูกต้อง' : `${elecUnits} หน่วย`}
                </span>
                <span className="text-slate-900 font-black">
                  {elecCostText}
                </span>
              </div>
            </div>
          )}

          {/* Water Box (Sky / Cyan Theme) */}
          {isWaterUnit && (
            <div className="border-2 border-sky-300/80 bg-sky-50/20 rounded-2xl p-3 flex flex-col justify-between gap-2.5">
              {/* Header: Title & Previous Reading */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-white shrink-0">
                    <Droplets className="w-3 h-3 fill-white text-white" />
                  </div>
                  <span className="text-xs font-black text-sky-950 tracking-tight">น้ำประปา</span>
                </div>

                {/* Previous Reading */}
                {isWaterDirectEdit ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    disabled={isRowPaid}
                    value={row.waterPrev}
                    onChange={(e) => onMeterReadingChange(row.roomId, 'waterPrev', e.target.value)}
                    onBlur={() => onMeterReadingBlur(row.roomId, 'waterPrev')}
                    onPaste={(e) => onPaste(row.roomId, 'waterPrev', e)}
                    data-row={idx}
                    data-col="waterPrev"
                    className={`w-16 px-1.5 py-0.5 text-xs border-2 border-sky-400 rounded-lg bg-white text-slate-900 text-center font-bold focus:outline-none transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                      flashingCells[`${row.roomId}-waterPrev`] ? 'animate-vibrant-flash shadow-md z-10' : ''
                    }`}
                  />
                ) : isRowPaid ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 font-medium shrink-0">เดิม</span>
                    <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.waterPrev)}</span>
                  </div>
                ) : unlockedWaterPrev[row.roomId] ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoFocus
                      value={row.waterPrev}
                      onChange={(e) => onMeterReadingChange(row.roomId, 'waterPrev', e.target.value)}
                      onBlur={() => onMeterReadingBlur(row.roomId, 'waterPrev')}
                      onPaste={(e) => onPaste(row.roomId, 'waterPrev', e)}
                      data-row={idx}
                      data-col="waterPrev"
                      className="w-16 px-1.5 py-0.5 text-xs border-2 border-sky-400 rounded-lg bg-white text-slate-900 text-center font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      data-testid={`cancel-water-prev-${row.roomId}`}
                      title="ยกเลิกการแก้ไข"
                      onClick={() => onCancelWaterPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
                    <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.waterPrev)}</span>
                    <button
                      type="button"
                      data-testid={`unlock-water-prev-${row.roomId}`}
                      title="แก้ไขเลขอ่านเดิม"
                      onClick={() => onUnlockWaterPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Large Current Reading Input */}
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isRowPaid}
                placeholder="กรอกมิเตอร์"
                value={row.waterCurr}
                onChange={(e) => onMeterReadingChange(row.roomId, 'waterCurr', e.target.value)}
                onBlur={() => onMeterReadingBlur(row.roomId, 'waterCurr')}
                onPaste={(e) => onPaste(row.roomId, 'waterCurr', e)}
                data-row={idx}
                data-col="waterCurr"
                className={`w-full py-1.5 px-3 text-lg font-black text-center text-slate-900 bg-white border-2 rounded-xl focus:outline-none transition-all duration-300 ${
                  flashingCells[`${row.roomId}-waterCurr`]
                    ? 'animate-vibrant-flash shadow-md border-sky-500 z-10'
                    : waterUnits < 0
                    ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                    : 'border-sky-300/90 focus:border-sky-500'
                } disabled:bg-slate-50 disabled:text-slate-500 disabled:border-slate-200`}
              />

              {/* Footer: Units & Usage Amount */}
              <div className="flex items-center justify-between text-xs font-bold">
                <span className={waterUnits < 0 ? 'text-rose-600' : 'text-slate-800 font-extrabold'}>
                  {waterUnits < 0 ? 'เลขอ่านไม่ถูกต้อง' : `${waterUnits} หน่วย`}
                </span>
                <span className="text-slate-900 font-black">
                  {waterCostText}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Other Expenses & Breakdown Box (กล่องค่าใช้จ่ายอื่นๆ & รายละเอียด) */}
      <div className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-3.5 flex flex-col gap-2.5 transition-all">
        {/* Main Bar: Trigger & Add Fee Button */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="text-xs font-extrabold text-indigo-900">
              ค่าใช้จ่ายอื่นๆ {otherFeesCount > 0 ? `(${otherFeesCount})` : ''}
            </span>
            {listItemizedBreakdown.length > 0 && (
              <button
                type="button"
                onClick={() => onToggleBreakdown(row.roomId)}
                className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer transition-colors ml-1 flex items-center gap-0.5"
              >
                <span>
                  {listItemizedBreakdown.length === 1
                    ? 'ดูรายละเอียด'
                    : `ดูรายละเอียด +${listItemizedBreakdown.length}`}
                </span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isExpandedBreakdown ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>

          {!isRowPaid && (
            <button
              type="button"
              data-testid={`open-other-fees-modal-${row.roomId}`}
              onClick={() => onOpenOtherFees(row.roomId)}
              className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-indigo-200 rounded-xl text-xs font-extrabold text-indigo-600 hover:bg-indigo-50 hover:border-indigo-300 transition-all shadow-2xs cursor-pointer"
            >
              <Plus className="w-3 h-3 shrink-0" />
              <span>รายการ</span>
            </button>
          )}
        </div>

        {/* Row 1: Occupants count input & Rent amount */}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1.5 text-slate-600 font-bold">
            <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>ผู้พัก:</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              disabled={isRowPaid}
              value={row.peopleCount}
              onChange={(e) => onPeopleCountChange(row.roomId, e.target.value)}
              onPaste={(e) => onPaste(row.roomId, 'peopleCount', e)}
              data-row={idx}
              data-col="peopleCount"
              className={`w-11 px-1.5 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all ${
                flashingCells[`${row.roomId}-peopleCount`] ? 'animate-vibrant-flash shadow-md border-indigo-400' : 'border-gray-200'
              } disabled:bg-slate-50 disabled:text-slate-500`}
            />
            <span>คน</span>
          </div>
          <div className="text-xs font-extrabold text-slate-800">
            <span>ค่าเช่า ({rentalTypeLabel}) </span>
            <span>{rentDisplay}</span>
          </div>
        </div>

        {/* Existing Other Fees List */}
        {(row.otherFees || []).length > 0 && (
          <div className="flex flex-col gap-1 pt-1 border-t border-slate-100">
            {(row.otherFees || []).map((fee, feeIdx) => {
              const feeIcon = getComponentItemIcon(fee.description);
              return (
                <div
                  key={feeIdx}
                  className="flex items-center justify-between gap-1 bg-white border border-slate-100 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-bold shadow-2xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    {feeIcon}
                    <span className="truncate max-w-[160px]" title={fee.description}>{fee.description}</span>
                  </div>
                  <span className="text-indigo-600 shrink-0 font-extrabold">
                    {Number(fee.amount).toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(Number(fee.amount)) ? 0 : 2 })} ฿
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Expanded Financial Breakdown Rows */}
        {isExpandedBreakdown && listItemizedBreakdown.length > 0 && (
          <div className="mt-1 pt-1.5 border-t border-dashed border-gray-200 flex flex-col gap-1 animate-in fade-in duration-150">
            {listItemizedBreakdown.map((item, itemIdx) => {
              return (
                <div
                  key={item.id || itemIdx}
                  data-testid={`charge-component-row-${row.roomId}-${itemIdx}`}
                  className="flex items-center justify-between text-xs py-0.5"
                  title={item.errorMessage || undefined}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {item.icon}
                    <span className="truncate text-slate-800 font-medium">
                      {item.label}
                    </span>
                  </div>
                  <span className="font-bold shrink-0 ml-2 text-slate-900">
                    {formatComponentDetailAmount(item.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Bottom Total Row (ยอดรวมทั้งสิ้น) */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100">
        <span className="text-xs font-black text-slate-700">ยอดรวมทั้งสิ้น</span>
        <span className="text-xl font-black text-indigo-700 tracking-tight">
          {formatMoneyDisplay(amountDue)} ฿
        </span>
      </div>
    </div>
  );
};
