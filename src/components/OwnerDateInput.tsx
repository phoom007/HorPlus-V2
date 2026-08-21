import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';

export interface OwnerDateInputProps {
  value?: string; // ISO date format YYYY-MM-DD (e.g. "2026-08-20")
  onChange: (isoDate: string) => void;
  min?: string; // ISO date format YYYY-MM-DD
  max?: string; // ISO date format YYYY-MM-DD
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  name?: string;
  'data-testid'?: string;
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
  className = '',
  placeholder = 'วว/ดด/ปปปป',
  id,
  name,
  'data-testid': testId,
}) => {
  const [displayText, setDisplayText] = useState<string>(() => isoToThaiBe(value));
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync internal display text when external value changes
  useEffect(() => {
    setDisplayText(isoToThaiBe(value));
  }, [value]);

  // Handle outside click to close calendar popup
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
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
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          className={`w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
        />
        <button
          type="button"
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
        <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 w-64 text-slate-800">
          {/* Header Month / Year in Buddhist Era */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-xs font-black text-slate-700">
              {THAI_MONTHS_SHORT[activeMonth]} {activeYear + 543}
            </div>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

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

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => handleSelectDate(day)}
                  className={`h-7 w-7 rounded-lg text-[11px] font-bold flex items-center justify-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'hover:bg-indigo-50 text-slate-700 hover:text-indigo-700'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Today Button */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                const todayIso = new Date().toISOString().slice(0, 10);
                onChange(todayIso);
                setDisplayText(isoToThaiBe(todayIso));
                setIsOpen(false);
              }}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              วันนี้
            </button>
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
