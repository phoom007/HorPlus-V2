/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  CheckCircle2,
  XCircle,
  FileText,
  Calendar,
  DollarSign,
  User,
  Phone,
  Eye,
  Edit2,
  RotateCw,
  Download,
} from 'lucide-react';
import { Room } from '../types';
import { formatBaht, formatThaiDate } from './GlobalComponents';
import { formatOwnerRoomOptionLabel } from '../utils/room-label.util';
import { OwnerDateInput } from './OwnerDateInput';
import { TenantRejectSheet } from './TenantRejectSheet';

const formatPhone = (val?: string | null) => {
  if (!val) return '-';
  const cleaned = val.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return val;
};

const formatCitizenId = (val?: string | null) => {
  if (!val) return '-';
  const cleaned = val.replace(/\D/g, '');
  if (cleaned.length === 13) {
    return `${cleaned.slice(0, 1)}-${cleaned.slice(1, 5)}-${cleaned.slice(5, 10)}-${cleaned.slice(10, 12)}-${cleaned.slice(12)}`;
  }
  return val;
};

export interface TenantApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: any | null;
  rooms: Room[];
  buildings?: any[];
  onApprove: (payload: {
    roomId: string;
    rentalType: 'MONTHLY' | 'TERM' | 'DAILY';
    startDate: string;
    endDate: string;
    rentAmount: number;
    depositAmount: number;
    depositDeclaredStatus: 'PAID' | 'UNPAID';
    days?: number;
    dailyRate?: number;
    durationMonths?: number;
  }) => void | Promise<void>;
  onReject: (reason: string) => void | Promise<void>;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export const TenantApprovalModal: React.FC<TenantApprovalModalProps> = ({
  isOpen,
  onClose,
  tenant,
  rooms,
  buildings = [],
  onApprove,
  onReject,
  isApproving = false,
  isRejecting = false,
}) => {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [rentalType, setRentalType] = useState<'MONTHLY' | 'TERM' | 'DAILY'>('MONTHLY');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [rentAmount, setRentAmount] = useState<string>('');
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [depositStatus, setDepositStatus] = useState<'UNPAID' | 'PAID'>('UNPAID');

  // Daily specific
  const [dailyDays, setDailyDays] = useState<number>(1);
  const [dailyRate, setDailyRate] = useState<string>('');

  // Term / Monthly duration
  const [durationMonths, setDurationMonths] = useState<number>(12);

  // Reject Sheet state
  const [isRejectSheetOpen, setIsRejectSheetOpen] = useState<boolean>(false);

  // Bottom Sheet gesture states
  const [startY, setStartY] = useState<number | null>(null);
  const [currentTranslateY, setCurrentTranslateY] = useState<number>(0);
  const isDraggingRef = useRef(false);
  const startYRef = useRef<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !tenant) return;

    const rawType = String(tenant.rentalType || tenant.rentalPlan || tenant.rentType || 'MONTHLY').toUpperCase();
    const type: 'MONTHLY' | 'TERM' | 'DAILY' = rawType === 'DAILY' ? 'DAILY' : rawType === 'TERM' ? 'TERM' : 'MONTHLY';
    setRentalType(type);

    // Initial Room: requestedRoomId -> currentTenantId -> vacant room -> first room
    const reqRoom = rooms.find(
      (r) => r.id === tenant.requestedRoomId || r.roomNumber === tenant.roomNumber || r.id === tenant.roomId
    );
    const vacantRoom = rooms.find((r) => r.status === 'vacant');
    const initialRoom = reqRoom || vacantRoom || rooms[0];

    setSelectedRoomId(initialRoom ? initialRoom.id : '');

    const start = tenant.moveInDate || tenant.startDate || tenant.requestedStartDate || tenant.contractStartDate || new Date().toISOString().split('T')[0];
    setStartDate(start);

    if (type === 'DAILY') {
      const days = tenant.requestedDays || tenant.totalDays || 1;
      const rate = tenant.requestedDailyRate || initialRoom?.dailyRent || 550;
      const rent = tenant.monthlyRent || tenant.rentAmount || (Number(rate) * days);
      const dep = tenant.deposit !== undefined ? tenant.deposit : (tenant.depositAmount !== undefined ? tenant.depositAmount : 500);

      setDailyDays(days);
      setDailyRate(String(rate));
      setRentAmount(String(rent));
      setDepositAmount(String(dep));

      const d = new Date(start);
      d.setDate(d.getDate() + days);
      setEndDate(d.toISOString().split('T')[0]);
    } else if (type === 'TERM') {
      const duration = tenant.requestedDurationMonths || (initialRoom?.termDurationMonths || 4);
      setDurationMonths(duration);
      const rent = tenant.monthlyRent || tenant.rentAmount || initialRoom?.termRent || 22000;
      const dep = tenant.deposit !== undefined ? tenant.deposit : (tenant.depositAmount !== undefined ? tenant.depositAmount : (initialRoom?.termDeposit || 5500));
      setRentAmount(String(rent));
      setDepositAmount(String(dep));

      const d = new Date(start);
      d.setMonth(d.getMonth() + duration);
      setEndDate(d.toISOString().split('T')[0]);
    } else {
      // MONTHLY
      const duration = tenant.requestedDurationMonths || 12;
      setDurationMonths(duration);
      const rent = tenant.monthlyRent || tenant.rentAmount || initialRoom?.monthlyRent || (initialRoom as any)?.price || 5000;
      const dep = tenant.deposit !== undefined ? tenant.deposit : (tenant.depositAmount !== undefined ? tenant.depositAmount : (initialRoom?.deposit || (Number(rent) * 2)));
      setRentAmount(String(rent));
      setDepositAmount(String(dep));

      const d = new Date(start);
      d.setMonth(d.getMonth() + duration);
      setEndDate(d.toISOString().split('T')[0]);
    }

    setDepositStatus(tenant.depositDeclaredStatus === 'PAID' ? 'PAID' : 'UNPAID');
    setIsRejectSheetOpen(false);
  }, [isOpen, tenant, rooms]);

  if (!isOpen || !tenant) return null;

  const handleRoomChange = (roomId: string) => {
    setSelectedRoomId(roomId);
    const rm = rooms.find((r) => r.id === roomId);
    if (!rm) return;

    if (rentalType === 'DAILY') {
      const rate = rm.dailyRent || 550;
      setDailyRate(String(rate));
      setRentAmount(String(Number(rate) * dailyDays));
      setDepositAmount(String(rm.deposit || 500));
    } else if (rentalType === 'TERM') {
      setRentAmount(String(rm.termRent || 22000));
      setDepositAmount(String(rm.termDeposit || rm.deposit || 5500));
    } else {
      setRentAmount(String(rm.monthlyRent || (rm as any).price || 5000));
      setDepositAmount(String(rm.deposit || (rm as any).monthlyDeposit || (Number(rm.monthlyRent || (rm as any).price || 5000) * 2)));
    }
  };

  const handleConfirmApprove = () => {
    if (!selectedRoomId) return;
    onApprove({
      roomId: selectedRoomId,
      rentalType,
      startDate,
      endDate,
      rentAmount: Number(rentAmount) || 0,
      depositAmount: Number(depositAmount) || 0,
      depositDeclaredStatus: depositStatus,
      days: rentalType === 'DAILY' ? dailyDays : undefined,
      dailyRate: rentalType === 'DAILY' ? Number(dailyRate) : undefined,
      durationMonths: rentalType !== 'DAILY' ? durationMonths : undefined,
    });
  };

  // Pointer drag handling on grab handle
  const handleGrabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    isDraggingRef.current = true;
    startYRef.current = e.clientY;
    setStartY(e.clientY);
  };

  const handleGrabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || startYRef.current === null) return;
    const deltaY = e.clientY - startYRef.current;
    if (deltaY > 0) {
      setCurrentTranslateY(deltaY);
    } else {
      setCurrentTranslateY(0);
    }
  };

  const handleGrabPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    if (currentTranslateY > 80) {
      onClose();
    }
    setStartY(null);
    setCurrentTranslateY(0);
    startYRef.current = null;
  };

  // Touch fallback on grab handle
  const handleHandleTouchStart = (e: React.TouchEvent) => {
    setStartY(e.touches[0].clientY);
    startYRef.current = e.touches[0].clientY;
  };

  const handleHandleTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;
    if (deltaY > 0) {
      setCurrentTranslateY(deltaY);
    }
  };

  const handleHandleTouchEnd = () => {
    if (currentTranslateY > 80) {
      onClose();
    }
    setStartY(null);
    setCurrentTranslateY(0);
    startYRef.current = null;
  };

  // Safe inner content drag check (only triggers if body is scrolled to the very top)
  const handleBodyTouchStart = (e: React.TouchEvent) => {
    if (bodyRef.current && bodyRef.current.scrollTop <= 0) {
      setStartY(e.touches[0].clientY);
      startYRef.current = e.touches[0].clientY;
    }
  };

  const handleBodyTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current === null) return;
    if (bodyRef.current && bodyRef.current.scrollTop > 0) {
      setStartY(null);
      setCurrentTranslateY(0);
      startYRef.current = null;
      return;
    }
    const currentY = e.touches[0].clientY;
    const deltaY = currentY - startYRef.current;
    if (deltaY > 0) {
      setCurrentTranslateY(deltaY);
    }
  };

  const backdropOpacity = Math.max(0, 1 - currentTranslateY / 320);

  const tenantName = tenant.tenantName || tenant.name || 'ผู้เช่า';
  const tenantPhone = tenant.phone || '-';
  const tenantCitizenId = tenant.citizenId || tenant.idCard || '-';

  // Attachment (ID document)
  const attachmentUrl = tenant.idCardPhoto || tenant.idCardPhotoMock || tenant.idCardUrl || (tenant.attachments && tenant.attachments[0]?.url);
  const attachmentName = tenant.idCardFileName || (tenant.attachments && tenant.attachments[0]?.name) || `สำเนาบัตรประชาชน_${tenantName.split(' ')[0]}.pdf`;

  return (
    <>
      <div className="fixed inset-0 z-[500] flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4 overflow-hidden animate-in fade-in duration-200">
        {/* Dynamic Backdrop */}
        <div
          data-testid="approval-modal-backdrop"
          style={{ opacity: backdropOpacity }}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
          onClick={onClose}
        />

        {/* Modal Container: Mobile Bottom Sheet / Desktop Centered Modal */}
        <div
          data-testid="approval-modal-container"
          style={{
            transform: currentTranslateY > 0 ? `translateY(${currentTranslateY}px)` : undefined,
            transition: startY !== null || isDraggingRef.current ? 'none' : 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
          className="bg-white w-full sm:max-w-2xl rounded-t-[32px] sm:rounded-3xl shadow-2xl border-t sm:border border-slate-100 relative z-10 flex flex-col max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
        >
          {/* Mobile Drag Handle Bar */}
          <div
            data-testid="approval-sheet-grab-handle"
            onPointerDown={handleGrabPointerDown}
            onPointerMove={handleGrabPointerMove}
            onPointerUp={handleGrabPointerUp}
            onPointerCancel={handleGrabPointerUp}
            onTouchStart={handleHandleTouchStart}
            onTouchMove={handleHandleTouchMove}
            onTouchEnd={handleHandleTouchEnd}
            className="pt-3.5 pb-2 flex flex-col items-center shrink-0 cursor-grab active:cursor-grabbing select-none touch-none sm:hidden"
          >
            <div className="w-12 h-1.5 bg-slate-300 rounded-full hover:bg-slate-400 transition-colors" />
          </div>

          {/* Header */}
          <div className="flex justify-between items-center px-6 py-4 sm:p-5 border-b border-slate-100 shrink-0 bg-white">
            <h3 className="text-base font-black text-slate-900">ยืนยันอนุมัติและรับผู้เช่าเข้าพัก</h3>
            <button
              type="button"
              data-testid="approval-modal-close-btn"
              onClick={onClose}
              className="hidden sm:flex p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div
            ref={bodyRef}
            onTouchStart={handleBodyTouchStart}
            onTouchMove={handleBodyTouchMove}
            onTouchEnd={handleHandleTouchEnd}
            className="p-6 overflow-y-auto flex-1 min-h-0 space-y-4"
          >
            {/* Top Tenant Info Banner (Green) */}
            <div className="p-4 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl flex items-center justify-between gap-3 shadow-3xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">{tenantName}</h4>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    เบอร์โทร: {formatPhone(tenantPhone)} • บัตรประชาชน: {formatCitizenId(tenantCitizenId)}
                  </p>
                </div>
              </div>
              <span
                className={`text-[11px] font-black px-2.5 py-1 rounded-xl border shrink-0 ${
                  rentalType === 'DAILY'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : rentalType === 'TERM'
                    ? 'bg-purple-100 text-purple-800 border-purple-300'
                    : 'bg-blue-100 text-blue-800 border-blue-300'
                }`}
              >
                {rentalType === 'DAILY'
                  ? 'การเข้าพักรายวัน'
                  : rentalType === 'TERM'
                  ? 'สัญญาเช่ารายเทอม'
                  : 'สัญญาเช่ารายเดือน'}
              </span>
            </div>

            {/* Room Selection */}
            <div>
              <label htmlFor="modal-approve-room-select" className="block text-xs font-bold text-slate-700 mb-1">
                เลือกห้องพักที่ต้องการจัดสรร <span className="text-rose-500">*</span>
              </label>
              <select
                id="modal-approve-room-select"
                data-testid="modal-approve-room-select"
                value={selectedRoomId}
                onChange={(e) => handleRoomChange(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold shadow-3xs cursor-pointer"
              >
                <option value="">-- เลือกห้องพัก --</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatOwnerRoomOptionLabel(r, buildings)}
                  </option>
                ))}
              </select>
            </div>

            {/* Financial Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เงินประกัน / มัดจำ (บาท)
                </label>
                <input
                  type="number"
                  data-testid="modal-approve-deposit-input"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-800 font-semibold focus:outline-none focus:border-indigo-600 shadow-3xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะเงินประกัน
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    data-testid="modal-deposit-unpaid-btn"
                    onClick={() => setDepositStatus('UNPAID')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      depositStatus === 'UNPAID'
                        ? 'bg-amber-50 border-amber-300 text-amber-900 shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    ยังไม่ชำระ
                  </button>
                  <button
                    type="button"
                    data-testid="modal-deposit-paid-btn"
                    onClick={() => setDepositStatus('PAID')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      depositStatus === 'PAID'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900 shadow-3xs'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    ชำระแล้ว
                  </button>
                </div>
              </div>
            </div>

            {/* Document Preview (Image 2 Parity) */}
            <div className="space-y-2 pt-1">
              <span className="block text-xs font-bold text-slate-700">
                รูปเอกสารสำเนาบัตรประชาชน (ถ้ามี)
              </span>
              <div className="border border-indigo-100 rounded-2xl overflow-hidden bg-slate-900 text-white shadow-xs">
                {/* PDF Toolbar Header */}
                <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    <span>{attachmentName}</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-md">
                    PDF • 1 KB
                  </span>
                </div>

                {/* PDF Viewer Mock / Document View */}
                <div className="p-4 bg-slate-800 flex items-center justify-center min-h-[220px]">
                  <div className="bg-white text-slate-900 p-6 rounded-lg shadow-lg max-w-sm w-full space-y-3">
                    <div className="border-b border-slate-100 pb-2">
                      <h5 className="text-xs font-black tracking-wider text-slate-800 uppercase">
                        IDENTITY DOCUMENT COPY
                      </h5>
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        Citizen ID: {formatCitizenId(tenantCitizenId)}
                      </p>
                      <p className="text-[9px] text-slate-400">
                        For tenancy agreement verification only
                      </p>
                    </div>
                    <div className="w-28 h-16 bg-slate-900 rounded-md flex items-center justify-center text-white text-[10px] font-bold">
                      [ ID CARD ]
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer (Image 2 Layout: [ยกเลิก] [ปฏิเสธคำขอ] [ยืนยันอนุมัติและรับผู้เช่าเข้าพัก]) */}
          <div className="p-4 sm:p-5 bg-slate-50/80 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0 rounded-b-none sm:rounded-b-3xl">
            <button
              type="button"
              data-testid="modal-approval-cancel-btn"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
            >
              ยกเลิก
            </button>

            <button
              type="button"
              data-testid="modal-approval-reject-btn"
              onClick={() => setIsRejectSheetOpen(true)}
              className="px-4 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
            >
              <XCircle className="w-4 h-4 text-rose-500" />
              <span>ปฏิเสธคำขอ</span>
            </button>

            <button
              type="button"
              data-testid="modal-approval-confirm-btn"
              disabled={!selectedRoomId || isApproving}
              onClick={handleConfirmApprove}
              className={`px-5 py-2 font-black text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${
                selectedRoomId && !isApproving
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-98'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isApproving ? 'กำลังอนุมัติ...' : 'ยืนยันอนุมัติและรับผู้เช่าเข้าพัก'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Reject Bottom Sheet / Modal */}
      <TenantRejectSheet
        isOpen={isRejectSheetOpen}
        onClose={() => setIsRejectSheetOpen(false)}
        tenant={{
          name: tenantName,
          phone: tenantPhone,
          roomNumber: rooms.find((r) => r.id === selectedRoomId)?.roomNumber || tenant.roomNumber,
        }}
        onConfirm={async (reason) => {
          await onReject(reason);
          setIsRejectSheetOpen(false);
          onClose();
        }}
        isSubmitting={isRejecting}
      />
    </>
  );
};
