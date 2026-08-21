import React, { useState, useEffect, useRef } from 'react';
import { Clock, X, Check } from 'lucide-react';

export interface TimeWheelPickerProps {
  value?: string; // "HH:mm" e.g. "15:47"
  onChange: (time: string) => void;
  onClear?: () => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  name?: string;
  className?: string;
  'data-testid'?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

export const TimeWheelPicker: React.FC<TimeWheelPickerProps> = ({
  value = '',
  onChange,
  onClear,
  placeholder = 'เลือกเวลา (เช่น 14:00)',
  disabled = false,
  id,
  name,
  className = '',
  'data-testid': testId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  const parseTime = (t: string) => {
    if (t && /^\d{2}:\d{2}$/.test(t)) {
      const [h, m] = t.split(':');
      return { hour: h, minute: m };
    }
    return { hour: '12', minute: '00' };
  };

  const [selectedHour, setSelectedHour] = useState<string>(() => parseTime(value).hour);
  const [selectedMinute, setSelectedMinute] = useState<string>(() => parseTime(value).minute);

  useEffect(() => {
    if (value && /^\d{2}:\d{2}$/.test(value)) {
      const { hour, minute } = parseTime(value);
      setSelectedHour(hour);
      setSelectedMinute(minute);
    }
  }, [value]);

  useEffect(() => {
    if (isOpen) {
      const initial = parseTime(value || '12:00');
      setSelectedHour(initial.hour);
      setSelectedMinute(initial.minute);

      setTimeout(() => {
        if (hourListRef.current) {
          const hourIndex = HOURS.indexOf(initial.hour);
          if (hourIndex >= 0) {
            const el = hourListRef.current.children[hourIndex] as HTMLElement;
            el?.scrollIntoView({ block: 'center', behavior: 'instant' as any });
          }
        }
        if (minuteListRef.current) {
          const minuteIndex = MINUTES.indexOf(initial.minute);
          if (minuteIndex >= 0) {
            const el = minuteListRef.current.children[minuteIndex] as HTMLElement;
            el?.scrollIntoView({ block: 'center', behavior: 'instant' as any });
          }
        }
      }, 50);
    }
  }, [isOpen, value]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('touchstart', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, [isOpen]);

  const handleConfirm = () => {
    const formatted = `${selectedHour}:${selectedMinute}`;
    onChange(formatted);
    setIsOpen(false);
  };

  const handleClear = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (onClear) {
      onClear();
    } else {
      onChange('');
    }
    setIsOpen(false);
  };

  const handleHourSelect = (h: string) => {
    setSelectedHour(h);
    const hourIndex = HOURS.indexOf(h);
    if (hourListRef.current && hourIndex >= 0) {
      const el = hourListRef.current.children[hourIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  const handleMinuteSelect = (m: string) => {
    setSelectedMinute(m);
    const minuteIndex = MINUTES.indexOf(m);
    if (minuteListRef.current && minuteIndex >= 0) {
      const el = minuteListRef.current.children[minuteIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} data-testid={testId}>
      {/* Trigger Field */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setIsOpen(true);
          } else if (e.key === 'Escape') {
            setIsOpen(false);
          }
        }}
        className={`w-full pl-9 pr-8 py-2 text-xs border rounded-xl flex items-center justify-between cursor-pointer select-none transition-all ${
          disabled
            ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
            : isOpen
            ? 'bg-white border-indigo-600 ring-2 ring-indigo-100 text-slate-800'
            : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
        }`}
        id={id}
      >
        <Clock className="w-4 h-4 absolute left-3 text-slate-400 pointer-events-none" />
        <span className={`font-semibold ${value ? 'text-slate-800' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>

        {/* Clear Button */}
        {value && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 p-1 text-slate-400 hover:text-rose-500 rounded-md hover:bg-slate-100 transition-colors"
            title="ล้างเวลา"
            aria-label="ล้างเวลา"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Hidden input for standard form submission if needed */}
      {name && <input type="hidden" name={name} value={value} />}

      {/* 24-Hour Wheel Picker Popover */}
      {isOpen && (
        <div className="absolute z-50 mt-1.5 left-0 right-0 sm:left-auto sm:right-auto sm:w-64 bg-white border border-slate-200 rounded-2xl shadow-xl p-3 animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-700">เลือกเวลา (24 ชม.)</span>
            <span className="text-xs font-extrabold text-indigo-600 px-2 py-0.5 bg-indigo-50 rounded-lg">
              {selectedHour}:{selectedMinute}
            </span>
          </div>

          {/* Two Scroll Columns */}
          <div className="grid grid-cols-2 gap-2 text-center select-none">
            {/* Hour Column */}
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1">ชั่วโมง (00-23)</div>
              <div
                ref={hourListRef}
                className="h-40 overflow-y-auto rounded-xl bg-slate-50 border border-slate-100 p-1 space-y-1 scrollbar-thin scroll-smooth snap-y snap-mandatory"
                role="listbox"
                aria-label="ชั่วโมง"
              >
                {HOURS.map((h) => {
                  const isSelected = h === selectedHour;
                  return (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleHourSelect(h)}
                      className={`w-full py-1.5 text-xs font-bold rounded-lg transition-all snap-center cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Minute Column */}
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1">นาที (00-59)</div>
              <div
                ref={minuteListRef}
                className="h-40 overflow-y-auto rounded-xl bg-slate-50 border border-slate-100 p-1 space-y-1 scrollbar-thin scroll-smooth snap-y snap-mandatory"
                role="listbox"
                aria-label="นาที"
              >
                {MINUTES.map((m) => {
                  const isSelected = m === selectedMinute;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleMinuteSelect(m)}
                      className={`w-full py-1.5 text-xs font-bold rounded-lg transition-all snap-center cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-600 hover:bg-slate-200/70'
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={handleClear}
              className="px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
            >
              ล้างค่า
            </button>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="px-3 py-1 text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors flex items-center gap-1 shadow-sm cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>ตกลง</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
