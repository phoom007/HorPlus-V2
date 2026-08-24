/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * MeterOtherFeesModal — Shared Other Fees Modal Editor for HorPlus Meter Workspace
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Tag,
  X,
  Plus,
  Trash2,
  AlertCircle,
} from 'lucide-react';
export function sanitizeMoneyTyping(val: string): string {
  if (!val) return '';
  const trimmed = val.trim();
  const isNegative = trimmed.startsWith('-');
  let cleaned = trimmed.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot !== -1) {
    const intPart = cleaned.slice(0, firstDot);
    const fracPart = cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2);
    cleaned = `${intPart}.${fracPart}`;
  }
  if (isNegative) {
    return cleaned ? `-${cleaned}` : '-';
  }
  return cleaned;
}

export interface OtherFeeDraftItem {
  id: string;
  description: string;
  amount: string;
}

export interface MeterOtherFeesModalProps {
  isOpen: boolean;
  roomId: string;
  roomNumber: string;
  initialFees: Array<{ description: string; amount: string | number }>;
  isLocked?: boolean;
  onClose: () => void;
  onSave: (fees: Array<{ description: string; amount: string }>) => void;
}

const PRESET_LABELS = [
  'ค่าคีย์การ์ด',
  'ค่าล้างแอร์',
  'ค่าทำความสะอาด',
  'ค่าที่จอดรถเพิ่ม',
  'ค่าซ่อมแซมอุปกรณ์',
];

export const MeterOtherFeesModal: React.FC<MeterOtherFeesModalProps> = ({
  isOpen,
  roomId,
  roomNumber,
  initialFees,
  isLocked = false,
  onClose,
  onSave,
}) => {
  const [draftFees, setDraftFees] = useState<OtherFeeDraftItem[]>([]);
  const [descInput, setDescInput] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const descInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Initialize draft on open or when room/initialFees change
  useEffect(() => {
    if (isOpen) {
      const items: OtherFeeDraftItem[] = (initialFees || []).map((f, idx) => ({
        id: `fee-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        description: String(f.description || '').trim(),
        amount: String(f.amount || '').trim(),
      }));
      setDraftFees(items);
      setDescInput('');
      setAmountInput('');
      setErrorMessage(null);
    }
  }, [isOpen, roomId, initialFees]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handlePresetClick = (label: string) => {
    if (isLocked) return;
    setDescInput(label);
    setErrorMessage(null);
    setTimeout(() => {
      amountInputRef.current?.focus();
    }, 50);
  };

  const handleAddItem = () => {
    if (isLocked) return;
    const cleanDesc = descInput.trim();
    const cleanAmt = amountInput.trim();

    if (!cleanDesc) {
      setErrorMessage('กรุณาระบุชื่อรายการค่าใช้จ่าย');
      descInputRef.current?.focus();
      return;
    }

    if (!cleanAmt) {
      setErrorMessage('กรุณาระบุจำนวนเงิน');
      amountInputRef.current?.focus();
      return;
    }

    // Backend constraint: /^-?\d+(\.\d{1,2})?$/
    if (!/^-?\d+(\.\d{1,2})?$/.test(cleanAmt)) {
      setErrorMessage('จำนวนเงินต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง');
      amountInputRef.current?.focus();
      return;
    }

    if (draftFees.length >= 20) {
      setErrorMessage('ไม่สามารถเพิ่มค่าใช้จ่ายอื่นๆ เกิน 20 รายการต่อห้องได้');
      return;
    }

    const newItem: OtherFeeDraftItem = {
      id: `fee-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      description: cleanDesc.slice(0, 100),
      amount: cleanAmt,
    };

    setDraftFees(prev => [...prev, newItem]);
    setDescInput('');
    setAmountInput('');
    setErrorMessage(null);
    setTimeout(() => {
      descInputRef.current?.focus();
    }, 50);
  };

  const handleRemoveItem = (id: string) => {
    if (isLocked) return;
    setDraftFees(prev => prev.filter(item => item.id !== id));
    setErrorMessage(null);
  };

  const handleSave = () => {
    if (isLocked) {
      onClose();
      return;
    }

    // If user filled partially into the input box without clicking add
    const cleanDesc = descInput.trim();
    const cleanAmt = amountInput.trim();

    let finalItems = [...draftFees];

    if (cleanDesc && cleanAmt) {
      if (!/^-?\d+(\.\d{1,2})?$/.test(cleanAmt)) {
        setErrorMessage('จำนวนเงินต้องเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง');
        amountInputRef.current?.focus();
        return;
      }
      if (finalItems.length < 20) {
        finalItems.push({
          id: `fee-${Date.now()}`,
          description: cleanDesc.slice(0, 100),
          amount: cleanAmt,
        });
      }
    } else if (cleanDesc && !cleanAmt) {
      setErrorMessage('กรุณาระบุจำนวนเงินสำหรับรายการที่กำลังกรอก หรือลบชื่อรายการออก');
      amountInputRef.current?.focus();
      return;
    } else if (!cleanDesc && cleanAmt) {
      setErrorMessage('กรุณาระบุชื่อรายการสำหรับจำนวนเงินที่กำลังกรอก');
      descInputRef.current?.focus();
      return;
    }

    const cleanResult = finalItems.map(item => ({
      description: item.description.trim(),
      amount: item.amount.trim(),
    }));

    onSave(cleanResult);
  };

  // Calculate sum of draft fees (presentation-only)
  const totalDraftAmount = draftFees.reduce((sum, item) => {
    const n = parseFloat(item.amount) || 0;
    return sum + n;
  }, 0);

  const formattedTotal = totalDraftAmount.toLocaleString('th-TH', {
    minimumFractionDigits: Number.isInteger(totalDraftAmount) ? 0 : 2,
    maximumFractionDigits: 2,
  });

  return (
    <div
      data-testid="meter-other-fees-modal-backdrop"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`modal-title-${roomId}`}
    >
      <div
        data-testid="meter-other-fees-modal-content"
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        onKeyDown={(e) => {
          // Stop propagation so global Enter-save handler does not fire while inside popup
          e.stopPropagation();
        }}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-start justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100/60 flex items-center justify-center text-indigo-600 shadow-2xs shrink-0">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h3
                id={`modal-title-${roomId}`}
                className="text-base font-extrabold text-slate-800 tracking-tight flex items-center gap-2"
              >
                <span>ค่าใช้จ่ายอื่นๆ</span>
                <span className="text-xs px-2 py-0.5 bg-indigo-100/70 text-indigo-700 font-extrabold rounded-lg">
                  ห้อง {roomNumber}
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                เพิ่มหรือแก้ไขรายการเพิ่มเติมสำหรับงวดนี้
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิดหน้าต่าง"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Preset Buttons */}
          {!isLocked && (
            <div>
              <div className="text-[11px] font-bold text-slate-500 mb-1.5">
                รายการที่ใช้บ่อย
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_LABELS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-200/80 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-slate-700 hover:text-indigo-600 transition-all cursor-pointer shadow-2xs active:scale-98"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Items List */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-500">
                รายการที่เพิ่มแล้ว ({draftFees.length})
              </span>
              {draftFees.length > 0 && (
                <span className="text-xs font-extrabold text-indigo-600">
                  รวม {formattedTotal} ฿
                </span>
              )}
            </div>

            <div className="border border-slate-200/80 rounded-2xl p-2 bg-slate-50/40 max-h-48 overflow-y-auto space-y-1.5">
              {draftFees.length === 0 ? (
                <div className="py-6 text-center text-slate-400 font-medium">
                  ยังไม่มีรายการค่าใช้จ่ายอื่นๆ
                </div>
              ) : (
                draftFees.map((item, idx) => (
                  <div
                    key={item.id || idx}
                    data-testid={`modal-fee-item-${idx}`}
                    className="flex items-center justify-between gap-2 bg-white p-2.5 rounded-xl border border-slate-100 shadow-2xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-800 truncate" title={item.description}>
                        {item.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-extrabold text-indigo-600 text-xs">
                        {Number(item.amount).toLocaleString('th-TH', { minimumFractionDigits: Number.isInteger(Number(item.amount)) ? 0 : 2 })} ฿
                      </span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.id)}
                          aria-label={`ลบรายการ ${item.description}`}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="ลบรายการ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Add Item Form */}
          {!isLocked && (
            <div className="space-y-1.5 pt-1">
              <div className="text-[11px] font-bold text-slate-500">
                เพิ่มรายการใหม่
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={descInputRef}
                  type="text"
                  placeholder="ชื่อรายการ (เช่น ค่ากุญแจ)"
                  value={descInput}
                  onChange={(e) => {
                    setDescInput(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.stopPropagation();
                      amountInputRef.current?.focus();
                    }
                  }}
                  className="flex-1 min-w-0 px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-gray-300"
                />
                <div className="w-28 shrink-0">
                  <input
                    ref={amountInputRef}
                    type="text"
                    inputMode="decimal"
                    placeholder="จำนวนเงิน"
                    value={amountInput}
                    onChange={(e) => {
                      setAmountInput(sanitizeMoneyTyping(e.target.value));
                      if (errorMessage) setErrorMessage(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddItem();
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 font-bold text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-gray-300"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 font-bold rounded-xl border border-indigo-200/60 transition-all flex items-center gap-1 cursor-pointer active:scale-98 shrink-0"
                  title="เพิ่มรายการ"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>เพิ่ม</span>
                </button>
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-1.5 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-50 border-t border-gray-100 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-500">
            {draftFees.length > 0 ? (
              <span>รวม {formattedTotal} ฿</span>
            ) : (
              <span>0 รายการ</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-slate-600 transition-all cursor-pointer active:scale-98"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-900 hover:bg-slate-800 text-white transition-all cursor-pointer shadow-md shadow-slate-900/10 active:scale-98"
            >
              บันทึกรายการ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
