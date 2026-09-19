import React, { useState, useEffect, useRef } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { isoToThaiBe, thaiBeToIso } from './OwnerDateInput';

export interface ChromeThaiDatePickerProps {
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
  align?: 'left' | 'right' | 'auto';
}

export const ChromeThaiDatePicker: React.FC<ChromeThaiDatePickerProps> = ({
  value,
  onChange,
  min,
  max,
  disabled = false,
  required = false,
  className = '',
  placeholder = 'วว/ดด/ปปปป (พ.ศ.)',
  id,
  name,
  'data-testid': testId,
}) => {
  const [displayText, setDisplayText] = useState<string>(() => isoToThaiBe(value));
  const nativeDateInputRef = useRef<HTMLInputElement>(null);

  // Synchronize display text when external value prop changes
  useEffect(() => {
    setDisplayText(isoToThaiBe(value));
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setDisplayText(text);

    if (!text.trim()) {
      onChange('');
      return;
    }

    // Direct ISO match (e.g. from tests or standard ISO format: 2026-09-19)
    if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim())) {
      onChange(text.trim());
      return;
    }

    // Thai Buddhist Era match (e.g. 30/12/2569 or 30-12-2569)
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(text.trim())) {
      const iso = thaiBeToIso(text.trim());
      if (iso) {
        onChange(iso);
      }
    }
  };

  const handleBlur = () => {
    if (!displayText.trim()) {
      if (value) onChange('');
      return;
    }

    // If text matches Thai BE format
    if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}$/.test(displayText.trim())) {
      const iso = thaiBeToIso(displayText.trim());
      if (iso) {
        onChange(iso);
        setDisplayText(isoToThaiBe(iso));
        return;
      }
    }

    // If text was ISO
    if (/^\d{4}-\d{2}-\d{2}$/.test(displayText.trim())) {
      onChange(displayText.trim());
      setDisplayText(isoToThaiBe(displayText.trim()));
      return;
    }

    // Fallback to reverting to external value
    setDisplayText(isoToThaiBe(value));
  };

  const handleNativeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const isoVal = e.target.value;
    if (isoVal) {
      onChange(isoVal);
      setDisplayText(isoToThaiBe(isoVal));
    } else {
      onChange('');
      setDisplayText('');
    }
  };

  const triggerPicker = () => {
    if (disabled) return;
    if (nativeDateInputRef.current) {
      if (typeof nativeDateInputRef.current.showPicker === 'function') {
        try {
          nativeDateInputRef.current.showPicker();
          return;
        } catch {
          // Fallback if browser security or platform blocks showPicker
        }
      }
      nativeDateInputRef.current.focus();
    }
  };

  return (
    <div className={`relative inline-flex items-center w-full ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
      {/* Hidden Native Date Input for Chrome's native date picker */}
      <input
        ref={nativeDateInputRef}
        type="date"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={handleNativeChange}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          width: 0,
          height: 0,
          overflow: 'hidden'
        }}
      />

      {/* Visible Input Displaying Buddhist Era date (DD/MM/BBBB) */}
      <input
        type="text"
        id={id}
        name={name}
        data-testid={testId}
        value={displayText}
        onChange={handleTextChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className={`w-full pr-10 ${className}`}
      />

      {/* Calendar Icon Button triggering native Chrome Date Picker */}
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={triggerPicker}
        data-testid={testId ? `${testId}-picker-btn` : undefined}
        title="เปิดปฏิทิน"
        aria-label="เปิดปฏิทิน"
        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 focus:outline-none transition-colors"
      >
        <CalendarIcon className="w-4 h-4" />
      </button>
    </div>
  );
};

export default ChromeThaiDatePicker;
