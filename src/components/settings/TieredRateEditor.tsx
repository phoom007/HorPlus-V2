/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Plus, Trash2, RotateCcw, Droplet, Zap, AlertCircle } from 'lucide-react';

export interface CanonicalTierRecord {
  upTo: string | null;
  rate: string;
}

export const WATER_TIER_PRESET: CanonicalTierRecord[] = [
  { upTo: '10.00', rate: '18.00' },
  { upTo: '20.00', rate: '20.00' },
  { upTo: null, rate: '22.00' },
];

export const normalizeToCanonicalDecimal = (val: string | number | null | undefined): string => {
  const str = String(val ?? '').trim();
  if (!str) return '0.00';
  const parts = str.split('.');
  const intPart = parts[0] || '0';
  const decPart = parts.length > 1 ? parts[1] : '';
  const paddedDec = (decPart + '00').slice(0, 2);
  return `${intPart}.${paddedDec}`;
};

export const formatUpToDisplay = (upTo: string | number | null | undefined): string => {
  if (upTo === null || upTo === undefined) return '';
  const s = String(upTo).trim();
  if (!s) return '';
  const num = Number(s);
  if (isNaN(num)) return s;
  return String(Math.floor(num));
};

export const formatRateDisplay = (rate: string | number | null | undefined): string => {
  if (rate === null || rate === undefined) return '';
  const s = String(rate).trim();
  if (!s) return '';
  if (/^\d+\.00$/.test(s)) {
    return s.slice(0, -3);
  }
  if (/^\d+\.0$/.test(s)) {
    return s.slice(0, -2);
  }
  return s;
};

export const normalizeDisplayUpTo = (val: string): string => {
  const trimmed = val.trim();
  if (!trimmed) return '';
  const num = Number(trimmed);
  if (isNaN(num) || num <= 0 || !/^\d+$/.test(trimmed)) return trimmed;
  return String(Math.floor(num));
};

export const normalizeDisplayRate = (val: string): string => {
  const trimmed = val.trim();
  if (!trimmed) return '';
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return trimmed;
  if (/^0\d+/.test(trimmed)) {
    const parts = trimmed.split('.');
    const intPart = String(parseInt(parts[0], 10));
    return parts.length > 1 ? `${intPart}.${parts[1]}` : intPart;
  }
  return trimmed;
};

export const validateCanonicalTiers = (tiers: CanonicalTierRecord[]): boolean => {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 5) return false;
  let lastBound = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const upToStr = tiers[i].upTo;
    if (!upToStr || !/^\d+(\.0+)?$/.test(String(upToStr).trim())) return false;
    const upToNum = Number(upToStr);
    if (isNaN(upToNum) || upToNum <= lastBound) return false;
    lastBound = upToNum;
  }
  const lastTier = tiers[tiers.length - 1];
  if (lastTier.upTo !== null && lastTier.upTo !== undefined && String(lastTier.upTo).trim() !== '') {
    return false;
  }
  const ratePattern = /^\d+(\.\d{1,2})?$/;
  for (let i = 0; i < tiers.length; i++) {
    const rateStr = String(tiers[i].rate ?? '').trim();
    if (!ratePattern.test(rateStr)) return false;
  }
  return true;
};

export const normalizeCanonicalTiers = (rawTiers: CanonicalTierRecord[]): CanonicalTierRecord[] => {
  return rawTiers.map((t, idx) => {
    const isLast = idx === rawTiers.length - 1;
    let upTo: string | null = null;
    if (!isLast && t.upTo !== null && t.upTo !== undefined && String(t.upTo).trim() !== '') {
      upTo = normalizeToCanonicalDecimal(t.upTo);
    }
    const rate = normalizeToCanonicalDecimal(t.rate);
    return { upTo, rate };
  });
};

export const ELECTRICITY_TIER_PRESET: CanonicalTierRecord[] = [
  { upTo: '50.00', rate: '7.00' },
  { upTo: '150.00', rate: '8.00' },
  { upTo: null, rate: '9.00' },
];

export interface TieredRateEditorProps {
  utilityType: 'water' | 'electricity';
  tiers: CanonicalTierRecord[];
  onChange: (tiers: CanonicalTierRecord[]) => void;
  onSave?: (tiers: CanonicalTierRecord[]) => void;
  disabled?: boolean;
  isSaving?: boolean;
  className?: string;
}

export const TieredRateEditor: React.FC<TieredRateEditorProps> = ({
  utilityType,
  tiers,
  onChange,
  onSave,
  disabled = false,
  isSaving = false,
  className = '',
}) => {
  const isWater = utilityType === 'water';
  const [localError, setLocalError] = useState<string | null>(null);

  // Derive "from" value for each tier
  const getFromValue = (index: number): number => {
    if (index === 0) return 1;
    const prevUpTo = tiers[index - 1]?.upTo;
    if (prevUpTo !== null && prevUpTo !== undefined && prevUpTo !== '') {
      const parsed = Math.floor(Number(prevUpTo));
      return isNaN(parsed) ? 1 : parsed + 1;
    }
    return 1;
  };

  const handleRateChange = (index: number, value: string) => {
    setLocalError(null);
    // Reject invalid chars (letters, negative, scientific notation)
    if (value !== '' && !/^\d*(\.\d{0,2})?$/.test(value)) {
      setLocalError('อัตราต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่งและไม่ติดลบ');
      return;
    }
    const updated = tiers.map((t, i) => (i === index ? { ...t, rate: value } : t));
    onChange(updated);
  };

  const handleRateBlur = (index: number, value: string) => {
    if (value === '') return;
    const normalized = normalizeDisplayRate(value);
    if (normalized !== value) {
      const updated = tiers.map((t, i) => (i === index ? { ...t, rate: normalized } : t));
      onChange(updated);
    }
  };

  const handleUpToChange = (index: number, value: string) => {
    setLocalError(null);
    const fromVal = getFromValue(index);

    // Reject non-integer / negative / scientific notation / letters / decimals
    if (value !== '' && !/^\d+$/.test(value)) {
      setLocalError('หน่วยสูงสุดต้องเป็นจำนวนเต็มบวกเท่านั้น');
      return;
    }
    if (value !== '' && Number(value) <= 0) {
      setLocalError('หน่วยสูงสุดต้องเป็นจำนวนเต็มบวกเท่านั้น');
      return;
    }
    if (value !== '' && Number(value) < fromVal) {
      setLocalError(`หน่วยสูงสุดต้องมากกว่าจุดเริ่มต้น (${fromVal})`);
    }

    const updated = tiers.map((t, i) => (i === index ? { ...t, upTo: value } : t));
    onChange(updated);
  };

  const handleUpToBlur = (index: number, value: string) => {
    if (value === '') return;
    const normalized = normalizeDisplayUpTo(value);
    if (normalized !== value) {
      const updated = tiers.map((t, i) => (i === index ? { ...t, upTo: normalized } : t));
      onChange(updated);
    }
  };

  const handleAddTier = () => {
    if (tiers.length >= 5 || disabled) return;
    setLocalError(null);

    const lastIdx = tiers.length - 1;
    const lastFrom = getFromValue(lastIdx);
    const defaultStep = isWater ? 10 : 50;
    const newFiniteUpTo = String(lastFrom + defaultStep - 1);

    const updated: CanonicalTierRecord[] = [
      ...tiers.slice(0, lastIdx),
      { ...tiers[lastIdx], upTo: newFiniteUpTo },
      { upTo: null, rate: tiers[lastIdx]?.rate || '0.00' },
    ];

    onChange(updated);
  };

  const handleRemoveTier = (index: number) => {
    if (tiers.length <= 1 || disabled) return;
    setLocalError(null);

    let updated = tiers.filter((_, i) => i !== index);
    // Ensure the last tier is always unlimited (upTo: null)
    if (updated.length > 0) {
      const last = updated.length - 1;
      updated[last] = { ...updated[last], upTo: null };
    }

    onChange(updated);
  };

  const handleResetPreset = () => {
    if (disabled) return;
    setLocalError(null);
    const preset = isWater ? WATER_TIER_PRESET : ELECTRICITY_TIER_PRESET;
    onChange(preset.map((t) => ({ ...t })));
  };

  const handleSave = () => {
    if (disabled || isSaving || !onSave) return;

    // Structural guard: 1-5 tiers
    if (tiers.length < 1 || tiers.length > 5) {
      setLocalError('จำนวนขั้นบันไดต้องอยู่ระหว่าง 1 ถึง 5 ขั้น');
      return;
    }

    // Validate integer boundaries
    let lastBound = 0;
    for (let i = 0; i < tiers.length - 1; i++) {
      const upToStr = tiers[i].upTo;
      if (!upToStr || !/^\d+(\.0+)?$/.test(String(upToStr).trim())) {
        setLocalError('จุดสิ้นสุดขั้นบันไดต้องเป็นจำนวนเต็มบวก');
        return;
      }
      const upToNum = Number(upToStr);
      const fromNum = getFromValue(i);
      if (upToNum < fromNum) {
        setLocalError(`ขั้นที่ ${i + 1} ต้องมีหน่วยสิ้นสุดมากกว่าจุดเริ่มต้น (${fromNum})`);
        return;
      }
      if (upToNum <= lastBound) {
        setLocalError(`จุดสิ้นสุดของแต่ละขั้นต้องเพิ่มขึ้นตามลำดับ`);
        return;
      }
      lastBound = upToNum;
    }

    // Validate final tier has upTo: null
    if (tiers[tiers.length - 1].upTo !== null && tiers[tiers.length - 1].upTo !== undefined && String(tiers[tiers.length - 1].upTo).trim() !== '') {
      setLocalError('ขั้นสุดท้ายต้องไม่จำกัดหน่วย');
      return;
    }

    // Validate rates: non-negative <= 2 decimal places, no scientific notation, no NaN, no blank
    const ratePattern = /^\d+(\.\d{1,2})?$/;
    for (let i = 0; i < tiers.length; i++) {
      const rateStr = String(tiers[i].rate ?? '').trim();
      if (!ratePattern.test(rateStr)) {
        setLocalError(`ขั้นที่ ${i + 1} ต้องระบุอัตราเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่งและไม่ติดลบ`);
        return;
      }
    }

    const canonicalTiers = normalizeCanonicalTiers(tiers);
    onSave(canonicalTiers);
  };

  // Visual Theme mapping
  const theme = isWater
    ? {
        border: 'border-sky-200 dark:border-sky-800',
        bg: 'bg-sky-50/50 dark:bg-sky-950/20',
        cardBg: 'bg-white dark:bg-slate-900',
        badge: 'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800',
        headerIcon: <Droplet className="w-4 h-4 text-sky-500 shrink-0" />,
        title: 'อัตราค่าน้ำประปาแบบขั้นบันได',
        unitLabel: 'หน่วยน้ำ',
        accentBtn: 'bg-sky-600 hover:bg-sky-700 text-white focus:ring-sky-500',
        textAccent: 'text-sky-600 dark:text-sky-400',
      }
    : {
        border: 'border-amber-200 dark:border-amber-800',
        bg: 'bg-amber-50/50 dark:bg-amber-950/20',
        cardBg: 'bg-white dark:bg-slate-900',
        badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800',
        headerIcon: <Zap className="w-4 h-4 text-amber-500 shrink-0" />,
        title: 'อัตราค่าไฟฟ้าแบบขั้นบันได',
        unitLabel: 'หน่วยไฟ',
        accentBtn: 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500',
        textAccent: 'text-amber-600 dark:text-amber-400',
      };

  return (
    <div
      className={`rounded-2xl border ${theme.border} ${theme.bg} p-4 shadow-sm transition-all ${className}`}
      data-testid={`tiered-rate-editor-${utilityType}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {theme.headerIcon}
          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">{theme.title}</h4>
        </div>
        <button
          type="button"
          onClick={handleResetPreset}
          disabled={disabled}
          className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
          data-testid={`btn-reset-preset-${utilityType}`}
          title="คืนค่าเป็นตัวอย่างเริ่มต้น (บันทึกเมื่อพร้อม)"
        >
          <RotateCcw className="w-3 h-3 shrink-0" />
          <span className="whitespace-nowrap">คืนค่าเริ่มต้น</span>
        </button>
      </div>

      {/* Error Alert */}
      {localError && (
        <div className="mb-3 p-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs" data-testid={`alert-tier-error-${utilityType}`}>
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{localError}</span>
        </div>
      )}

      {/* Tier Table (Responsive container with stable min-width for columns) */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[340px] text-xs text-left">
          <thead>
            <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200/80 dark:border-slate-800">
              <th className="py-2 px-1 font-semibold w-12 text-center whitespace-nowrap">ขั้นที่</th>
              <th className="py-2 px-1 font-semibold whitespace-nowrap">ตั้งแต่</th>
              <th className="py-2 px-1 font-semibold whitespace-nowrap">ถึง</th>
              <th className="py-2 px-1 font-semibold whitespace-nowrap">อัตรา (บาท/หน่วย)</th>
              <th className="py-2 px-1 font-semibold w-10 text-center whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {tiers.map((tier, idx) => {
              const fromVal = getFromValue(idx);
              const isFinal = idx === tiers.length - 1;

              return (
                <tr key={idx} className="group" data-testid={`tier-row-${utilityType}-${idx}`}>
                  {/* Step index */}
                  <td className="py-2 px-1 text-center font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {idx + 1}
                  </td>

                  {/* From value (derived / read-only) */}
                  <td className="py-2 px-1 whitespace-nowrap">
                    <span
                      className="inline-block px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium"
                      data-testid={`tier-from-${utilityType}-${idx}`}
                    >
                      {fromVal}
                    </span>
                  </td>

                  {/* Up to value */}
                  <td className="py-2 px-1 whitespace-nowrap">
                    {isFinal ? (
                      <span
                        className={`inline-block px-2.5 py-1 rounded-lg ${theme.badge} font-semibold whitespace-nowrap`}
                        data-testid={`tier-upto-${utilityType}-${idx}`}
                      >
                        ไม่จำกัด
                      </span>
                    ) : (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={disabled}
                          value={formatUpToDisplay(tier.upTo)}
                          onChange={(e) => handleUpToChange(idx, e.target.value)}
                          onBlur={(e) => handleUpToBlur(idx, e.target.value)}
                          className="w-20 px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs disabled:opacity-50"
                          data-testid={`input-tier-upto-${utilityType}-${idx}`}
                        />
                        <span className="text-slate-400 dark:text-slate-500 text-[11px] whitespace-nowrap">หน่วย</span>
                      </div>
                    )}
                  </td>

                  {/* Rate value */}
                  <td className="py-2 px-1 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        disabled={disabled}
                        value={formatRateDisplay(tier.rate)}
                        onChange={(e) => handleRateChange(idx, e.target.value)}
                        onBlur={(e) => handleRateBlur(idx, e.target.value)}
                        className="w-24 px-2 py-1 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 text-xs disabled:opacity-50"
                        data-testid={`input-tier-rate-${utilityType}-${idx}`}
                      />
                      <span className="text-slate-400 dark:text-slate-500 text-[11px] whitespace-nowrap">฿</span>
                    </div>
                  </td>

                  {/* Delete action */}
                  <td className="py-2 px-1 text-center whitespace-nowrap">
                    {tiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTier(idx)}
                        disabled={disabled}
                        className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-30 cursor-pointer"
                        data-testid={`btn-remove-tier-${utilityType}-${idx}`}
                        title="ลบขั้นนี้"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer controls: Add Tier & Save Button */}
      <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
        {tiers.length < 5 ? (
          <button
            type="button"
            onClick={handleAddTier}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-slate-400 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800 transition-all text-xs font-medium whitespace-nowrap shrink-0 disabled:opacity-40 cursor-pointer"
            data-testid={`btn-add-tier-${utilityType}`}
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            <span className="whitespace-nowrap">เพิ่มขั้น</span>
          </button>
        ) : (
          <div />
        )}

        {onSave && (
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || isSaving}
            className={`px-3.5 py-1.5 rounded-xl ${theme.accentBtn} text-xs font-semibold transition-all shadow-sm whitespace-nowrap shrink-0 disabled:opacity-50 cursor-pointer`}
            data-testid={`btn-save-tiers-${utilityType}`}
          >
            <span className="whitespace-nowrap">{isSaving ? 'กำลังบันทึก...' : 'บันทึกอัตรา'}</span>
          </button>
        )}
      </div>
    </div>
  );
};

