import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

export interface OwnerDateInputProps {
  value?: string; // ISO date format YYYY-MM-DD (e.g. "2026-08-20")
  onChange: (isoDate: string) => void;
  min?: string; // ISO date format YYYY-MM-DD
  max?: string; // ISO date format YYYY-MM-DD
  disabled?: boolean;
  required?: boolean;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  'data-testid'?: string;
  align?: 'left' | 'right' | 'auto';
  verticalAlign?: 'top' | 'bottom' | 'auto';
}

/**
 * Converts ISO Gregorian "YYYY-MM-DD" to Buddhist Era "DD/MM/BBBB"
 */
export function isoToThaiBe(isoStr?: string): string {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  const beYear = y + 543;
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return `${dd}/${mm}/${beYear}`;
}

/**
 * Converts Buddhist Era "DD/MM/BBBB" (or CE "DD/MM/YYYY") to ISO Gregorian "YYYY-MM-DD"
 */
export function thaiBeToIso(thaiStr?: string): string | null {
  if (!thaiStr) return '';
  const clean = thaiStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean;
  }
  const parts = clean.split(/[/.-]/);
  if (parts.length !== 3) return null;

  let [dStr, mStr, yStr] = parts;
  const d = parseInt(dStr, 10);
  const m = parseInt(mStr, 10);
  let y = parseInt(yStr, 10);

  if (isNaN(d) || isNaN(m) || isNaN(y)) return null;
  if (m < 1 || m > 12) return null;

  // If year is >= 2400, assume Buddhist Era and subtract 543
  if (y >= 2400) {
    y -= 543;
  } else if (y < 1900 && y >= 0) {
    // 2-digit Buddhist Era or CE handling if typed
    if (y > 50) {
      y = (y + 2500) - 543;
    } else {
      y = (y + 2500) - 543;
    }
  }

  // Validate day range in target month
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d < 1 || d > maxDay) return null;

  const yyyy = String(y).padStart(4, '0');
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
];

const THAI_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export const OwnerDateInput: React.FC<OwnerDateInputProps> = ({
  value,
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  readOnly = true,
  className = '',
  placeholder = 'วว/ดด/ปปปป',
  id,
  name,
  'data-testid': testId,
  align = 'auto',
  verticalAlign = 'auto',
}) => {
  const [displayText, setDisplayText] = useState<string>(() => isoToThaiBe(value));
  const [isOpen, setIsOpen] = useState(false);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const [placement, setPlacement] = useState<'left' | 'right'>(align === 'right' ? 'right' : 'left');
  const [verticalPlacement, setVerticalPlacement] = useState<'top' | 'bottom'>('bottom');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && containerRef.current && typeof window !== 'undefined') {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect) {
        if (align === 'right') {
          setPlacement('right');
        } else if (align === 'left') {
          setPlacement('left');
        } else if (rect.left + 260 > window.innerWidth) {
          setPlacement('right');
        } else {
          setPlacement('left');
        }

        if (verticalAlign === 'top') {
          setVerticalPlacement('top');
        } else if (verticalAlign === 'bottom') {
          setVerticalPlacement('bottom');
        } else {
          // Smart dynamic flip: if space below input is less than 320px and space above is larger, flip to open upwards
          const spaceBelow = window.innerHeight - rect.bottom;
          if (spaceBelow < 320 && rect.top > 280) {
            setVerticalPlacement('top');
          } else {
            setVerticalPlacement('bottom');
          }
        }
      }
    } else {
      if (align === 'right') setPlacement('right');
      else if (align === 'left') setPlacement('left');
      if (verticalAlign === 'top') setVerticalPlacement('top');
      else if (verticalAlign === 'bottom') setVerticalPlacement('bottom');
    }
  }, [isOpen, align, verticalAlign]);

  // Sync internal display text when external value changes
  useEffect(() => {
    setDisplayText(isoToThaiBe(value));
  }, [value]);

  // Handle outside click to close calendar popup
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsYearPickerOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Active view date for calendar navigation
  const resolvedIso = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
  const [activeYear, setActiveYear] = useState<number>(() => parseInt(resolvedIso.slice(0, 4), 10));
  const [activeMonth, setActiveMonth] = useState<number>(() => parseInt(resolvedIso.slice(5, 7), 10) - 1);

  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      setActiveYear(parseInt(value.slice(0, 4), 10));
      setActiveMonth(parseInt(value.slice(5, 7), 10) - 1);
    }
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
      const be = isoToThaiBe(text.trim());
      setDisplayText(be || text);
      onChange(text.trim());
      return;
    }
    setDisplayText(text);

    if (!text.trim()) {
      if (!required) {
        onChange('');
      }
      return;
    }

    const iso = thaiBeToIso(text);
    if (iso) {
      onChange(iso);
    }
  };

  const handleInputBlur = () => {
    if (!displayText.trim()) {
      onChange('');
      return;
    }
    const iso = thaiBeToIso(displayText);
    if (iso) {
      if (min && iso < min) {
        onChange(min);
        setDisplayText(isoToThaiBe(min));
        return;
      }
      if (max && iso > max) {
        onChange(max);
        setDisplayText(isoToThaiBe(max));
        return;
      }
      onChange(iso);
      setDisplayText(isoToThaiBe(iso));
    } else {
      // Revert to last valid value if invalid
      setDisplayText(isoToThaiBe(value));
    }
  };

  const handleSelectDate = (d: number) => {
    const yyyy = String(activeYear).padStart(4, '0');
    const mm = String(activeMonth + 1).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd}`;
    if (min && iso < min) return;
    if (max && iso > max) return;
    onChange(iso);
    setDisplayText(isoToThaiBe(iso));
    setIsOpen(false);
  };

  const handlePrevMonth = () => {
    if (activeMonth === 0) {
      setActiveMonth(11);
      setActiveYear(prev => prev - 1);
    } else {
      setActiveMonth(prev => prev - 1);
    }
  };

  const handleNextMonth = () => {
    if (activeMonth === 11) {
      setActiveMonth(0);
      setActiveYear(prev => prev + 1);
    } else {
      setActiveMonth(prev => prev + 1);
    }
  };

  // Min/Max year and month bounds
  const minYear = min ? parseInt(min.slice(0, 4), 10) : null;
  const minMonth = min ? parseInt(min.slice(5, 7), 10) - 1 : null;
  const maxYear = max ? parseInt(max.slice(0, 4), 10) : null;
  const maxMonth = max ? parseInt(max.slice(5, 7), 10) - 1 : null;

  const isPrevMonthDisabled = Boolean(
    isYearPickerOpen ||
    (minYear !== null && minMonth !== null && (activeYear < minYear || (activeYear === minYear && activeMonth <= minMonth)))
  );

  const isNextMonthDisabled = Boolean(
    isYearPickerOpen ||
    (maxYear !== null && maxMonth !== null && (activeYear > maxYear || (activeYear === maxYear && activeMonth >= maxMonth)))
  );

  // Calendar calculations
  const daysInMonth = new Date(Date.UTC(activeYear, activeMonth + 1, 0)).getUTCDate();
  const firstDayOfWeek = new Date(Date.UTC(activeYear, activeMonth, 1)).getUTCDay();

  return (
    <div ref={containerRef} className="relative inline-block w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          id={id}
          name={name}
          data-testid={testId}
          value={displayText}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onClick={() => !disabled && setIsOpen(prev => !prev)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (!disabled) setIsOpen(prev => !prev);
            }
          }}
          readOnly={readOnly}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          className={`w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer ${className}`}
        />
        <button
          type="button"
          data-testid={testId ? `${testId}-picker-btn` : 'owner-date-input-calendar-btn'}
          disabled={disabled}
          onClick={() => !disabled && setIsOpen(prev => !prev)}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer p-0.5"
          tabIndex={-1}
        >
          <CalendarIcon className="w-4 h-4" />
        </button>
      </div>

      {/* Calendar Popover */}
      {isOpen && !disabled && (
        <div
          data-testid="owner-date-input-popover"
          className={`absolute ${
            placement === 'right' ? 'right-0' : 'left-0 sm:left-0 sm:right-auto'
          } ${
            verticalPlacement === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          } z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 w-64 max-w-[calc(100vw-2rem)] text-slate-800`}
        >
          {/* Header Month / Year in Buddhist Era */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <button
              type="button"
              onClick={handlePrevMonth}
              disabled={isPrevMonthDisabled}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-1.5 text-xs font-black text-slate-700">
              <span>{THAI_MONTHS_SHORT[activeMonth]}</span>
              <button
                type="button"
                data-testid="date-picker-year-btn"
                onClick={() => setIsYearPickerOpen(prev => !prev)}
                className={`px-2 py-0.5 rounded-lg border transition-all cursor-pointer font-black ${
                  isYearPickerOpen
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-indigo-50/80 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                }`}
                title="คลิกเพื่อเลือกปี พ.ศ."
              >
                {activeYear + 543}
              </button>
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              disabled={isNextMonthDisabled}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {isYearPickerOpen ? (
            /* Year Selector Grid (Buddhist Era) */
            <div className="space-y-1.5 py-1 animate-in fade-in duration-150">
              <div className="text-[10px] font-bold text-slate-400 text-center pb-1">
                เลือกปี พ.ศ. (แตะเพื่อเลือก)
              </div>
              <div
                data-testid="year-grid-container"
                className="max-h-48 overflow-y-auto grid grid-cols-3 gap-1.5 p-1 border border-slate-100 rounded-xl bg-slate-50/50"
              >
                {Array.from({ length: 90 }, (_, i) => (new Date().getFullYear() + 543 + 5) - i)
                  .filter(beYear => {
                    const ceYear = beYear - 543;
                    if (minYear !== null && ceYear < minYear) return false;
                    if (maxYear !== null && ceYear > maxYear) return false;
                    return true;
                  })
                  .map((beYear) => {
                    const isSelected = (activeYear + 543) === beYear;
                    return (
                      <button
                        key={beYear}
                        type="button"
                        data-testid={`year-option-${beYear}`}
                        onClick={() => {
                          setActiveYear(beYear - 543);
                          setIsYearPickerOpen(false);
                        }}
                        className={`py-1.5 px-1 rounded-xl text-center text-[11px] font-bold transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-600 text-white font-black shadow-xs'
                            : 'bg-white hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 border border-slate-100'
                        }`}
                      >
                        {beYear}
                      </button>
                    );
                  })}
              </div>
            </div>
          ) : (
            <>
              {/* Days Header */}
              <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">
                {THAI_DAYS.map((day, idx) => (
                  <div key={idx} className="py-0.5">{day}</div>
                ))}
              </div>

              {/* Days Grid */}
              <div className="grid grid-cols-7 gap-1 text-xs">
                {Array.from({ length: firstDayOfWeek }).map((_, idx) => (
                  <div key={`empty-${idx}`} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, idx) => {
                  const day = idx + 1;
                  const yyyy = String(activeYear).padStart(4, '0');
                  const mm = String(activeMonth + 1).padStart(2, '0');
                  const dd = String(day).padStart(2, '0');
                  const currentIso = `${yyyy}-${mm}-${dd}`;
                  const isSelected = value === currentIso;
                  const isDayDisabled = Boolean(
                    (min && currentIso < min) || (max && currentIso > max)
                  );

                  return (
                    <button
                      key={day}
                      type="button"
                      disabled={isDayDisabled}
                      onClick={() => !isDayDisabled && handleSelectDate(day)}
                      className={`h-7 w-7 rounded-lg text-[11px] font-bold flex items-center justify-center transition-all ${
                        isDayDisabled
                          ? 'opacity-25 cursor-not-allowed text-slate-300'
                          : isSelected
                          ? 'bg-indigo-600 text-white shadow-xs cursor-pointer'
                          : 'hover:bg-indigo-50 text-slate-700 hover:text-indigo-700 cursor-pointer'
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Today Button */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            {(() => {
              const todayIso = new Date().toISOString().slice(0, 10);
              const isTodayDisabled = Boolean((min && todayIso < min) || (max && todayIso > max));
              return (
                <button
                  type="button"
                  disabled={isTodayDisabled}
                  onClick={() => {
                    if (isTodayDisabled) return;
                    onChange(todayIso);
                    setDisplayText(isoToThaiBe(todayIso));
                    setIsOpen(false);
                  }}
                  className={`text-[11px] font-bold transition-colors ${
                    isTodayDisabled
                      ? 'text-slate-300 cursor-not-allowed opacity-40'
                      : 'text-indigo-600 hover:text-indigo-800 cursor-pointer'
                  }`}
                >
                  วันนี้
                </button>
              );
            })()}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors"
            >
              ปิด
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
