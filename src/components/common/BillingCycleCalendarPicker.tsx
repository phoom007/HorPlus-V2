/**
 * @license Apache-2.0
 * Shared Billing-Cycle Calendar Component (Product Owner Manual UAT Batch 02)
 * Renders standard Buddhist Year (+543) navigation and 3-column x 4-row Thai month grid.
 */

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface BillingCycleCalendarPickerProps {
  selectedCycleCode: string;
  availableCycles?: Array<{ id?: string; cycleCode: string; status?: string; name?: string }>;
  minCycle?: string;
  maxCycle?: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectCycle: (cycleCode: string, cycle?: any) => void;
  align?: 'left' | 'right' | 'center';
}

const THAI_MONTHS = [
  { val: '01', label: 'มกราคม' },
  { val: '02', label: 'กุมภาพันธ์' },
  { val: '03', label: 'มีนาคม' },
  { val: '04', label: 'เมษายน' },
  { val: '05', label: 'พฤษภาคม' },
  { val: '06', label: 'มิถุนายน' },
  { val: '07', label: 'กรกฎาคม' },
  { val: '08', label: 'สิงหาคม' },
  { val: '09', label: 'กันยายน' },
  { val: '10', label: 'ตุลาคม' },
  { val: '11', label: 'พฤศจิกายน' },
  { val: '12', label: 'ธันวาคม' },
];

export const BillingCycleCalendarPicker: React.FC<BillingCycleCalendarPickerProps> = ({
  selectedCycleCode,
  availableCycles = [],
  minCycle: propMinCycle,
  maxCycle: propMaxCycle,
  isOpen,
  onClose,
  onSelectCycle,
  align = 'center',
}) => {
  const initialYear = selectedCycleCode
    ? parseInt(selectedCycleCode.split('-')[0], 10) || new Date().getFullYear()
    : new Date().getFullYear();

  const [tempYear, setTempYear] = useState<number>(initialYear);

  useEffect(() => {
    if (selectedCycleCode) {
      const y = parseInt(selectedCycleCode.split('-')[0], 10);
      if (y) setTempYear(y);
    }
  }, [selectedCycleCode]);

  if (!isOpen) return null;

  // Determine dynamic min/max cycles from availableCycles if not explicitly passed
  let minCycle = propMinCycle;
  let maxCycle = propMaxCycle;

  if (availableCycles.length > 0) {
    const sortedCodes = availableCycles
      .map((c) => c.cycleCode)
      .filter(Boolean)
      .sort();
    if (!minCycle && sortedCodes.length > 0) minCycle = sortedCodes[0];
    if (!maxCycle && sortedCodes.length > 0) maxCycle = sortedCodes[sortedCodes.length - 1];
  }

  const curYear = new Date().getFullYear();
  if (!minCycle) minCycle = `${curYear - 2}-01`;
  if (!maxCycle) maxCycle = `${curYear + 2}-12`;

  const minYear = parseInt(minCycle.split('-')[0], 10) || (curYear - 2);
  const maxYear = parseInt(maxCycle.split('-')[0], 10) || (curYear + 2);

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
      ? 'right-0'
      : 'left-1/2 -translate-x-1/2';

  return (
    <>
      <div className="fixed inset-0 z-40 cursor-default" onClick={onClose} />

      <div
        className={`absolute top-full mt-2 bg-white p-5 rounded-3xl w-[300px] border border-slate-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 text-left ${alignClass}`}
        data-testid="billing-cycle-calendar-picker"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-black text-slate-800">เลือกงวดประจำเดือน</h3>
          <button
            type="button"
            data-testid="calendar-close-button"
            onClick={onClose}
            className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
          >
            ปิด
          </button>
        </div>

        {/* Year selector with Buddhist Year */}
        <div className="flex items-center justify-between bg-slate-50 p-1 rounded-2xl border border-slate-100 mb-4">
          <button
            type="button"
            onClick={() => setTempYear((prev) => (prev > minYear ? prev - 1 : prev))}
            disabled={tempYear <= minYear}
            className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer shadow-2xs ${
              tempYear <= minYear ? 'opacity-25 cursor-not-allowed' : ''
            }`}
            aria-label="ปีก่อนหน้า"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-black text-slate-800" data-testid="calendar-year-label">
            {tempYear + 543}
          </span>

          <button
            type="button"
            onClick={() => setTempYear((prev) => (prev < maxYear ? prev + 1 : prev))}
            disabled={tempYear >= maxYear}
            className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer shadow-2xs ${
              tempYear >= maxYear ? 'opacity-25 cursor-not-allowed' : ''
            }`}
            aria-label="ปีถัดไป"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Grid of Months (3 columns, 4 rows) */}
        <div className="grid grid-cols-3 gap-1.5" data-testid="calendar-months-grid">
          {THAI_MONTHS.map((m) => {
            const targetCycle = `${tempYear}-${m.val}`;
            const isSelected = selectedCycleCode === targetCycle;
            const matchingCycle = availableCycles.find((c) => c.cycleCode === targetCycle);

            const isOutOfRange = (minCycle && targetCycle < minCycle) || (maxCycle && targetCycle > maxCycle);
            const isDisabled = isOutOfRange && !matchingCycle;

            return (
              <button
                key={m.val}
                type="button"
                data-testid={`calendar-month-${m.val}`}
                data-cycle-code={targetCycle}
                data-cycle-id={matchingCycle?.id}
                disabled={isDisabled}
                onClick={() => {
                  onSelectCycle(targetCycle, matchingCycle);
                  onClose();
                }}
                className={`py-1.5 px-1 text-[10px] font-bold rounded-xl transition-all text-center border ${
                  isSelected
                    ? 'bg-blue-600 border-blue-650 hover:bg-blue-700 text-white shadow-sm cursor-pointer'
                    : isDisabled
                    ? 'bg-slate-50 text-slate-300 border border-slate-100/50 cursor-not-allowed opacity-40'
                    : 'bg-white hover:bg-slate-50 border border-slate-100 text-slate-600 hover:text-slate-800 cursor-pointer'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
};
