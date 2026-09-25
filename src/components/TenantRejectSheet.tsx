/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { X, XCircle } from 'lucide-react';

export interface TenantRejectSheetProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: {
    name?: string;
    phone?: string;
    roomNumber?: string;
  } | null;
  onConfirm: (reason: string) => void | Promise<void>;
  isSubmitting?: boolean;
}

export const REJECT_REASON_OPTIONS = [
  'ข้อมูลเอกสารไม่ครบถ้วน',
  'ห้องพักประเภทที่ต้องการเต็มแล้ว',
  'ไม่ผ่านเกณฑ์การพิจารณาเบื้องต้น',
  'ผู้เช่ายกเลิกความประสงค์',
  'อื่นๆ',
];

export const TenantRejectSheet: React.FC<TenantRejectSheetProps> = ({
  isOpen,
  onClose,
  tenant,
  onConfirm,
  isSubmitting = false,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>('ข้อมูลเอกสารไม่ครบถ้วน');
  const [customReason, setCustomReason] = useState<string>('');

  // Mobile Bottom Sheet Drag-to-Dismiss State
  const [dragOffsetY, setDragOffsetY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartYRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      setSelectedReason('ข้อมูลเอกสารไม่ครบถ้วน');
      setCustomReason('');
      setDragOffsetY(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !tenant) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentY = e.touches[0].clientY;
    const diff = currentY - touchStartYRef.current;
    if (diff > 0) {
      setDragOffsetY(diff);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (dragOffsetY > 80) {
      onClose();
    }
    setDragOffsetY(0);
  };

  // Pointer drag handling on grab handle
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    setIsDragging(true);
    touchStartYRef.current = e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const currentY = e.clientY;
    const diff = currentY - touchStartYRef.current;
    if (diff > 0) {
      setDragOffsetY(diff);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (dragOffsetY > 80) {
      onClose();
    }
    setDragOffsetY(0);
  };

  const backdropOpacity = Math.max(0, 1 - dragOffsetY / 320);

  const isReasonValid = Boolean(
    selectedReason &&
    (selectedReason !== 'อื่นๆ' || customReason.trim().length > 0)
  );

  const finalReason = selectedReason === 'อื่นๆ' ? customReason.trim() : selectedReason;

  const handleConfirmClick = () => {
    if (!isReasonValid || !finalReason) return;
    onConfirm(finalReason);
  };

  return (
    <div className="fixed inset-0 z-[600] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200">
      {/* Dynamic Backdrop */}
      <div
        data-testid="reject-sheet-backdrop"
        style={{ opacity: backdropOpacity }}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Sheet Container: Mobile Bottom Sheet / Desktop Centered Modal */}
      <div
        data-testid="tenant-reject-sheet"
        style={{
          transform: dragOffsetY > 0 ? `translateY(${dragOffsetY}px)` : undefined,
          transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        className="bg-white w-full sm:max-w-md rounded-t-[32px] sm:rounded-3xl shadow-2xl border-t sm:border border-slate-100 relative z-10 overflow-hidden flex flex-col animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
      >
        {/* Mobile Grab Handle */}
        <div
          data-testid="reject-sheet-grab-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="pt-3.5 pb-2 flex flex-col items-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none sm:hidden"
        >
          <div className="w-12 h-1.5 bg-slate-300 rounded-full hover:bg-slate-400 transition-colors" />
        </div>

        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 sm:p-5 border-b border-slate-100 shrink-0 bg-white">
          <h3 className="text-base font-black text-slate-900">ยืนยันการปฏิเสธคำขอเช่า</h3>
          <button
            type="button"
            data-testid="reject-sheet-close-btn"
            onClick={onClose}
            className="hidden sm:flex p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Tenant Summary Banner (Pink) */}
          <div className="p-4 bg-rose-50/90 border border-rose-200/80 rounded-2xl flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0 shadow-3xs">
              <XCircle className="w-6 h-6 stroke-[2.2]" />
            </div>
            <div>
              <h4 className="text-xs sm:text-sm font-black text-rose-950">
                ปฏิเสธคำของคุณ {tenant.name || 'ผู้ขอเช่า'}
              </h4>
              <p className="text-[11px] text-rose-700 font-medium mt-0.5">
                เบอร์โทร: {tenant.phone || '-'}
                {tenant.roomNumber ? ` • ห้อง ${tenant.roomNumber}` : ''}
              </p>
            </div>
          </div>

          {/* Reason Selection */}
          <div className="space-y-1.5">
            <label htmlFor="reject-reason-select" className="block text-xs font-black text-slate-800">
              เหตุผลในการปฏิเสธคำขอ
            </label>
            <select
              id="reject-reason-select"
              data-testid="reject-reason-select"
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-rose-500 bg-white text-slate-800 font-bold shadow-3xs cursor-pointer"
            >
              {REJECT_REASON_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>

            {selectedReason === 'อื่นๆ' && (
              <div className="pt-2 animate-in fade-in duration-150">
                <input
                  type="text"
                  data-testid="reject-custom-reason-input"
                  placeholder="ระบุเหตุผลเพิ่มเติม..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-rose-500 bg-white text-slate-800 font-medium shadow-3xs"
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0 rounded-b-none sm:rounded-b-3xl">
          <button
            type="button"
            data-testid="reject-sheet-cancel-btn"
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            data-testid="reject-sheet-confirm-btn"
            disabled={isSubmitting || !isReasonValid}
            onClick={handleConfirmClick}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white font-black rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <XCircle className="w-4 h-4" />
            <span>{isSubmitting ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธ'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
