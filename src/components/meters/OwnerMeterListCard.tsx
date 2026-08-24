/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * OwnerMeterListCard — List Mode Presentation for HorPlus Meter Workspace
 */

import React from 'react';
import {
  Zap,
  Gauge,
  User,
  Users,
  ArrowRight,
  Pencil,
  X,
  Plus,
  ChevronDown,
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
  flashingCells: { [key: string]: boolean };
  newFeeInput?: { description: string; amount: string };
  isExpandedBreakdown: boolean;
  quickAddLoadingRoomId: string | null;
  onMeterReadingChange: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr', value: string) => void;
  onMeterReadingBlur: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr') => void;
  onPaste: (roomId: string, field: 'waterPrev' | 'waterCurr' | 'elecPrev' | 'elecCurr' | 'peopleCount' | 'overdueAmount', e: React.ClipboardEvent<HTMLInputElement>) => void;
  onUnlockElecPrev: (roomId: string) => void;
  onCancelElecPrev: (roomId: string) => void;
  onUnlockWaterPrev: (roomId: string) => void;
  onCancelWaterPrev: (roomId: string) => void;
  onPeopleCountChange: (roomId: string, value: string) => void;
  onFeeDescriptionChange: (roomId: string, description: string) => void;
  onFeeAmountChange: (roomId: string, amount: string) => void;
  onAddOtherFee: (roomId: string) => void;
  onRemoveOtherFee: (roomId: string, feeIdx: number) => void;
  onToggleStatusSwitch: (row: MeterRowState) => void;
  onToggleBreakdown: (roomId: string) => void;
  onSelectTenant: (tenantId: string, roomId?: string) => void;
  onOpenQuickAdd: (targetRoomId: string) => void;
}

export const OwnerMeterListCard: React.FC<OwnerMeterListCardProps> = ({
  row,
  idx,
  room,
  roomCtx,
  tenant,
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
  flashingCells,
  newFeeInput,
  isExpandedBreakdown,
  quickAddLoadingRoomId,
  onMeterReadingChange,
  onMeterReadingBlur,
  onPaste,
  onUnlockElecPrev,
  onCancelElecPrev,
  onUnlockWaterPrev,
  onCancelWaterPrev,
  onPeopleCountChange,
  onFeeDescriptionChange,
  onFeeAmountChange,
  onAddOtherFee,
  onRemoveOtherFee,
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
  const isEligibleAddTenantCycle = isCycleInRollingThreeMonthWindow(activeCycleCode);
  const hasBookableGap = roomCtx?.hasBookableGap ?? true;
  const historicalDailyCount = roomCtx?.historicalDailyCount || 0;
  const dailyCheckOutDate = roomCtx?.dailyCheckOutDate || null;

  return (
    <div
      id={`room-row-${row.roomId}`}
      data-testid={`meter-list-card-${row.roomId}`}
      className="bg-white border border-gray-200/80 rounded-2xl p-4 shadow-xs flex flex-col justify-between gap-3.5 transition-all hover:shadow-md hover:border-indigo-100"
    >
      {/* 1. Header: Room Number & Status Switch */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="text-base font-extrabold text-slate-800 tracking-tight">
            ห้อง {row.roomNumber}
          </span>
        </div>

        {/* Room / Bill Status */}
        <div className="flex items-center gap-2">
          {(() => {
            if (isDailyContext) {
              const isDailyOverdue = Boolean(roomCtx?.isDailyOverdue || roomCtx?.isDailyFinancialTail);
              const isDailyRentPaid = Boolean(roomCtx?.isDailyRentPaid);

              if (isDailyOverdue) {
                return (
                  <span className="inline-flex items-center px-2 py-0.5 bg-rose-50 text-rose-700 text-xs font-bold rounded-lg border border-rose-200">
                    <AlertCircle className="w-3 h-3 text-rose-500 mr-1 shrink-0" />
                    รายวัน
                  </span>
                );
              }

              if (isDailyRentPaid) {
                return (
                  <span className="inline-flex items-center px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200">
                    <CheckCircle className="w-3 h-3 text-emerald-600 mr-1 shrink-0" />
                    รายวัน
                  </span>
                );
              }

              return (
                <span className="inline-flex items-center px-2 py-0.5 bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-200">
                  รายวัน
                </span>
              );
            }

            if ((roomCtx?.historicalDailyCount || 0) > 0 && !effectiveTenantId && row.billStatus === 'draft') {
              return <span className="text-xs text-slate-400 font-bold">-</span>;
            }

            return (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-extrabold leading-none ${
                    row.billStatus === 'paid'
                      ? 'text-emerald-700'
                      : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                      ? 'text-amber-700'
                      : 'text-slate-500'
                  }`}
                >
                  {row.billStatus === 'paid'
                    ? 'ชำระแล้ว'
                    : row.billStatus === 'draft' || row.billStatus === 'cancelled'
                    ? 'ยังไม่ออกบิล'
                    : 'รอชำระ'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={row.billStatus !== 'draft' && row.billStatus !== 'cancelled'}
                  disabled={isSaving || row.isPaid || row.billStatus === 'paid' || !selectedBillingCycleId}
                  onClick={() => onToggleStatusSwitch(row)}
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
              </div>
            );
          })()}
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
                    className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                  >
                    <User className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate max-w-[150px]">{effectiveTenantName}</span>
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
            const hasDailyStay = Boolean(dailyCheckOutDate);
            const hasOccupantClaim = hasTenant || hasDailyStay;

            return (
              <div className="flex items-center justify-between gap-2">
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
                      <span className="truncate max-w-[150px]">{effectiveTenantName}</span>
                      <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
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
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200 transition-all cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    {quickAddLoadingRoomId === (room?.id || row.roomId) ? (
                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    ) : (
                      <Plus className="w-3 h-3 shrink-0" />
                    )}
                    <span>เพิ่มผู้เช่า</span>
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
                <button
                  type="button"
                  onClick={() => onSelectTenant(effectiveTenantId, row.roomId)}
                  className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                >
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate max-w-[150px]">{effectiveTenantName}</span>
                  <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
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
                className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
              >
                <User className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-[150px]">{effectiveTenantName}</span>
                <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
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

          return <span className="text-gray-400">ไม่มีข้อมูล</span>;
        })()}
      </div>

      {/* 3. Meter Inputs (⚡ ไฟฟ้า & 💧 น้ำประปา) */}
      {(isElecUnit || isWaterUnit) && (
        <div className={`grid ${isElecUnit && isWaterUnit ? 'grid-cols-2' : 'grid-cols-1'} gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-100`}>
          {/* Electricity Block */}
          {isElecUnit && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs font-bold text-amber-700">
                  <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
                  <span>ไฟฟ้า</span>
                </div>
                {row.elecPrev !== '' && row.elecCurr !== '' && (
                  <span className={`text-[10px] font-bold ${elecUnits < 0 ? 'text-rose-600' : 'text-slate-600'}`}>
                    {elecUnits < 0 ? 'เลขอ่านไม่ถูกต้อง' : `${elecUnits} หน่วย`}
                  </span>
                )}
              </div>

              {/* Prev Reading */}
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
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
                    className={`w-20 px-2 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                      flashingCells[`${row.roomId}-elecPrev`] ? 'animate-vibrant-flash shadow-md z-10' : 'border-gray-200'
                    }`}
                  />
                ) : isRowPaid ? (
                  <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.elecPrev)}</span>
                ) : unlockedElecPrev[row.roomId] ? (
                  <div className="flex items-center gap-1">
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
                      className="w-16 px-1.5 py-0.5 text-xs border border-indigo-300 rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500"
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
                  <div className="flex items-center gap-1 group">
                    <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.elecPrev)}</span>
                    <button
                      type="button"
                      data-testid={`unlock-elec-prev-${row.roomId}`}
                      title="แก้ไขเลขอ่านเดิม"
                      onClick={() => onUnlockElecPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Curr Reading */}
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="text-[11px] text-slate-500 font-medium shrink-0">ใหม่</span>
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
                  className={`w-20 px-2 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                    flashingCells[`${row.roomId}-elecCurr`]
                      ? 'animate-vibrant-flash shadow-md z-10'
                      : elecUnits < 0
                      ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
            </div>
          )}

          {/* Water Block */}
          {isWaterUnit && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs font-bold text-sky-700">
                  <Gauge className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>น้ำประปา</span>
                </div>
                {row.waterPrev !== '' && row.waterCurr !== '' && (
                  <span className={`text-[10px] font-bold ${waterUsageRes.isValid ? 'text-slate-600' : 'text-rose-600'}`}>
                    {waterUnits < 0 ? 'เลขอ่านไม่ถูกต้อง' : `${waterUnits} หน่วย`}
                  </span>
                )}
              </div>

              {/* Prev Reading */}
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="text-[11px] text-slate-500 font-medium shrink-0">เดิม</span>
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
                    className={`w-20 px-2 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                      flashingCells[`${row.roomId}-waterPrev`] ? 'animate-vibrant-flash shadow-md z-10' : 'border-gray-200'
                    }`}
                  />
                ) : isRowPaid ? (
                  <span className="text-xs font-bold text-slate-400">{formatMeterReadingDisplay(row.waterPrev)}</span>
                ) : unlockedWaterPrev[row.roomId] ? (
                  <div className="flex items-center gap-1">
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
                      className="w-16 px-1.5 py-0.5 text-xs border border-indigo-300 rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500"
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
                  <div className="flex items-center gap-1 group">
                    <span className="text-xs font-bold text-slate-700">{formatMeterReadingDisplay(row.waterPrev)}</span>
                    <button
                      type="button"
                      data-testid={`unlock-water-prev-${row.roomId}`}
                      title="แก้ไขเลขอ่านเดิม"
                      onClick={() => onUnlockWaterPrev(row.roomId)}
                      className="p-0.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Curr Reading */}
              <div className="flex items-center justify-between text-xs gap-1">
                <span className="text-[11px] text-slate-500 font-medium shrink-0">ใหม่</span>
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
                  className={`w-20 px-2 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                    flashingCells[`${row.roomId}-waterCurr`]
                      ? 'animate-vibrant-flash shadow-md z-10'
                      : waterUnits < 0
                      ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                      : 'border-gray-200'
                  }`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. People Count */}
      <div className="flex items-center justify-between text-xs py-1 border-t border-gray-50">
        <div className="flex items-center gap-1.5 text-slate-600 font-bold">
          <Users className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          <span>จำนวนคน</span>
        </div>
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
          className={`w-14 px-2 py-0.5 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
            flashingCells[`${row.roomId}-peopleCount`] ? 'animate-vibrant-flash shadow-md z-10' : 'border-gray-200'
          }`}
        />
      </div>

      {/* 5. Other Fees Summary & Inline Add */}
      <div className="flex flex-col gap-1.5 text-xs border-t border-gray-50 pt-1.5">
        <div className="text-[11px] font-bold text-slate-500">ค่าใช้จ่ายอื่นๆ</div>

        {/* Existing other fees */}
        {(row.otherFees || []).map((fee, feeIdx) => (
          <div
            key={feeIdx}
            className="flex items-center justify-between gap-1 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 text-[11px] text-slate-600 font-bold"
          >
            <span className="truncate max-w-[120px]" title={fee.description}>{fee.description}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-indigo-600">
                {Number(fee.amount).toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(Number(fee.amount)) ? 0 : 2 })} ฿
              </span>
              {!isRowPaid && (
                <button
                  type="button"
                  onClick={() => onRemoveOtherFee(row.roomId, feeIdx)}
                  className="p-0.5 text-rose-500 hover:text-rose-700 cursor-pointer"
                  title="ลบรายการ"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Inline Add Other Fee */}
        <div className="flex items-center gap-1 mt-0.5">
          <input
            type="text"
            placeholder="ชื่อรายการ"
            disabled={isRowPaid}
            value={newFeeInput?.description ?? ''}
            onChange={(e) => onFeeDescriptionChange(row.roomId, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isRowPaid) {
                onAddOtherFee(row.roomId);
              }
            }}
            className="flex-1 min-w-0 px-2 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <input
            type="text"
            inputMode="decimal"
            placeholder="บาท"
            disabled={isRowPaid}
            value={newFeeInput?.amount ?? ''}
            onChange={(e) => onFeeAmountChange(row.roomId, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isRowPaid) {
                onAddOtherFee(row.roomId);
              }
            }}
            className="w-14 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 text-center font-medium focus:outline-indigo-500 disabled:bg-slate-50 disabled:text-slate-400"
          />
          <button
            type="button"
            onClick={() => onAddOtherFee(row.roomId)}
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

      {/* 6. Payable / Total & Financial Breakdown */}
      <div className="border-t border-gray-100 pt-3 mt-1 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-slate-600">ยอดรวม</span>
            {chargeComponents.length > 0 && (
              <button
                type="button"
                onClick={() => onToggleBreakdown(row.roomId)}
                className="text-[10px] text-slate-400 hover:text-indigo-600 font-medium cursor-pointer transition-colors ml-1 flex items-center gap-0.5"
              >
                <span>
                  {chargeComponents.length === 1
                    ? 'ดูรายละเอียด'
                    : `ดูรายละเอียด +${chargeComponents.length}`}
                </span>
                <ChevronDown className={`w-2.5 h-2.5 transition-transform duration-200 ${isExpandedBreakdown ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
          <span className="font-extrabold text-sm text-indigo-600 whitespace-nowrap">
            {formatMoneyDisplay(amountDue)} ฿
          </span>
        </div>

        {/* Expanded Financial Breakdown Rows */}
        {isExpandedBreakdown && chargeComponents.length > 0 && (
          <div className="mt-1 pt-1.5 border-t border-dashed border-gray-100 flex flex-col gap-1">
            {chargeComponents.map((c: any, cIdx: number) => {
              const isPaid = c.status === 'PAID';
              const isInvalid = c.status === 'INVALID';
              const isUnpaid = c.status === 'UNPAID';

              return (
                <div
                  key={cIdx}
                  data-testid={`charge-component-row-${row.roomId}-${cIdx}`}
                  className="flex items-center justify-between text-xs py-0.5"
                  title={isInvalid ? (c.errorMessage || 'ข้อมูลไม่ถูกต้อง') : undefined}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {isPaid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : isInvalid ? (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    ) : isUnpaid ? (
                      <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span
                      className={`truncate ${
                        isPaid
                          ? 'text-emerald-700 font-medium'
                          : isInvalid
                          ? 'text-rose-600 font-medium'
                          : isUnpaid
                          ? 'text-amber-700 font-medium'
                          : 'text-slate-500 font-medium'
                      }`}
                    >
                      {c.label}
                    </span>
                  </div>
                  <span
                    className={`font-bold shrink-0 ml-2 ${
                      isPaid
                        ? 'text-emerald-800'
                        : isInvalid
                        ? 'text-rose-600'
                        : isUnpaid
                        ? 'text-amber-800'
                        : 'text-slate-600'
                    }`}
                  >
                    {formatComponentDetailAmount(c.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
