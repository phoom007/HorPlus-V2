/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * QuickAddTenantModal (LOCAL-07 Batch 02)
 * 3-Type Owner Quick Add: รายเทอม (TERM), รายเดือน (MONTHLY), รายวัน (DAILY).
 */

import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Phone, DollarSign, Clock, Shield, CheckCircle, AlertCircle, Loader2, Image as ImageIcon, Trash2, Building2, GraduationCap, CalendarDays, MessageSquare, Check, Copy, ExternalLink, Settings, CheckCircle2 } from 'lucide-react';
import { QuickAddRoomContext } from '../types';
import { httpRequest } from '../data/httpClient';
import { formatBaht, formatThaiDate, normalizeMoneyInput, OwnerDateInput } from './GlobalComponents';
import { TimeWheelPicker } from './TimeWheelPicker';
import { calculateInstallmentSchedule } from '../utils/installmentCalculator';
import { Task009ApiAdapter, LineOaConfigResponse } from '../data/adapters/task009';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import { resolveLineFriendAddUrl } from '../utils/lineOa.util';
import { LineLogo } from './LineLogo';

interface QuickAddTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: QuickAddRoomContext | null;
  onSuccess: (message: string) => void;
  onNavigateToLineConfig?: () => void;
  onNavigate?: (tab: string) => void;
}

export type QuickAddMode = 'TERM' | 'MONTHLY' | 'DAILY' | 'LINE';

export const QuickAddTenantModal: React.FC<QuickAddTenantModalProps> = ({
  isOpen,
  onClose,
  context,
  onSuccess,
  onNavigateToLineConfig,
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<QuickAddMode>('LINE');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [copiedLineId, setCopiedLineId] = useState(false);

  // Identity Card Document upload (0 or 1 image, max 5 MB, JPEG/PNG/WebP only, no PDF)
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [idCardError, setIdCardError] = useState<string | null>(null);

  // Monthly fields
  const [durationMonths, setDurationMonths] = useState(1);
  const [monthlyRent, setMonthlyRent] = useState<number>(0);
  const [monthlyDeposit, setMonthlyDeposit] = useState<number>(0);
  const [monthlyDepositDeclaredStatus, setMonthlyDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');
  const [monthlyEndDate, setMonthlyEndDate] = useState('');

  // Term fields (Strictly Building-authoritative)
  const [termMonths, setTermMonths] = useState<number | null>(null);
  const [termRent, setTermRent] = useState<number | null>(null);
  const [termDeposit, setTermDeposit] = useState<number>(0);
  const [termDepositDeclaredStatus, setTermDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');
  const [termInstallmentCount, setTermInstallmentCount] = useState(1);
  const [maxInstallments, setMaxInstallments] = useState(1);
  const [termEndDate, setTermEndDate] = useState('');

  // Daily fields
  const [dailyEndDate, setDailyEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [checkInTime, setCheckInTime] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [dailyRate, setDailyRate] = useState<number | null>(null);
  const [dailyDeposit, setDailyDeposit] = useState<number>(0);
  const [dailyDepositDeclaredStatus, setDailyDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // LINE OA Config state scoped strictly by context.dormitoryId
  const [lineConfig, setLineConfig] = useState<LineOaConfigResponse | null>(null);
  const [isLineLoading, setIsLineLoading] = useState(false);
  const [isLineError, setIsLineError] = useState(false);

  const fetchLineOaConfig = async () => {
    if (!context?.dormitoryId) return;
    setIsLineLoading(true);
    setIsLineError(false);
    try {
      const res = await Task009ApiAdapter.getLineOaConfig(context.dormitoryId);
      if (res.success && res.data) {
        setLineConfig(res.data);
      } else {
        setIsLineError(true);
      }
    } catch {
      setIsLineError(true);
    } finally {
      setIsLineLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && context?.dormitoryId) {
      fetchLineOaConfig();
    }
  }, [isOpen, context?.dormitoryId]);

  const rawPublicId = lineConfig?.botPremiumId || lineConfig?.lineOaId;
  const effectiveLineId = rawPublicId ? (rawPublicId.startsWith('@') ? rawPublicId : `@${rawPublicId}`) : null;
  const isLineReady = Boolean(lineConfig?.isReady && effectiveLineId && lineConfig?.qrSvg);
  const friendAddUrl = lineConfig?.friendAddUrl || resolveLineFriendAddUrl(effectiveLineId);

  const isLineConfigured = Boolean(
    lineConfig?.connected ||
    lineConfig?.credentialsVerified ||
    lineConfig?.hasChannelSecret ||
    lineConfig?.hasAccessToken ||
    lineConfig?.channelId ||
    lineConfig?.lineOaId ||
    lineConfig?.botDisplayName
  );

  const handleCopyLineId = async () => {
    if (!effectiveLineId) return;
    try {
      await navigator.clipboard.writeText(effectiveLineId);
      setCopiedLineId(true);
      setTimeout(() => setCopiedLineId(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleManageLineOa = () => {
    onClose();
    if (onNavigateToLineConfig) {
      onNavigateToLineConfig();
    } else if (onNavigate) {
      onNavigate('settings');
    }
  };

  // Helper: add calendar months minus 1 day
  const calculateMonthEndDate = (start: string, months: number): string => {
    if (!start || months < 1) return '';
    const [y, m, d] = start.split('-').map(Number);
    let targetYear = y;
    let targetMonth = m - 1 + months;
    targetYear += Math.floor(targetMonth / 12);
    targetMonth = targetMonth % 12;

    const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(d, maxDay);

    const anniversary = new Date(Date.UTC(targetYear, targetMonth, targetDay));
    anniversary.setUTCDate(anniversary.getUTCDate() - 1);
    return anniversary.toISOString().slice(0, 10);
  };

  // Helper: inclusive days
  const calculateInclusiveDays = (start: string, end: string): number => {
    if (!start || !end) return 1;
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    const startUtc = Date.UTC(sy, sm - 1, sd);
    const endUtc = Date.UTC(ey, em - 1, ed);
    if (endUtc < startUtc) return 1;
    return Math.round((endUtc - startUtc) / (24 * 3600 * 1000)) + 1;
  };

  // Initialize room and building defaults when context opens
  useEffect(() => {
    if (context && isOpen) {
      setErrorText(null);
      setFullName('');
      setPhone('');
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today);

      const eff = context.effective;
      const bld = context.building;

      // 1. Monthly defaults: from authoritative server context
      const mRent = eff && typeof eff.monthlyRent === 'number' ? Number(eff.monthlyRent) : 0;
      const mDep = eff?.monthlyDeposit !== null && eff?.monthlyDeposit !== undefined
        ? Number(eff.monthlyDeposit)
        : (eff?.depositAmount !== null && eff?.depositAmount !== undefined ? Number(eff.depositAmount) : 0);
      setMonthlyRent(mRent);
      setMonthlyDeposit(mDep);
      setMonthlyDepositDeclaredStatus('UNPAID');
      setDurationMonths(1);
      setMonthlyEndDate(calculateMonthEndDate(today, 1));

      // 2. Term defaults: Strictly Building-authoritative
      const bldTermMonths = bld?.termMonths && Number(bld.termMonths) >= 1 ? Number(bld.termMonths) : null;
      const bldMaxInstallments = bld?.maxTermRentInstallments && Number(bld.maxTermRentInstallments) >= 1
        ? Number(bld.maxTermRentInstallments)
        : 1;

      const tDep = eff?.termDeposit !== null && eff?.termDeposit !== undefined
        ? Number(eff.termDeposit)
        : (eff?.depositAmount !== null && eff?.depositAmount !== undefined ? Number(eff.depositAmount) : 0);
      setTermDeposit(tDep);
      setTermDepositDeclaredStatus('UNPAID');

      if (bldTermMonths) {
        setTermMonths(bldTermMonths);
        const tRent = eff?.termRent !== null && eff?.termRent !== undefined
          ? Number(eff.termRent)
          : null;
        setTermRent(tRent);
        setMaxInstallments(bldMaxInstallments);
        setTermInstallmentCount(bldMaxInstallments);
        setTermEndDate(calculateMonthEndDate(today, bldTermMonths));
      } else {
        setTermMonths(null);
        setTermRent(null);
        setMaxInstallments(1);
        setTermInstallmentCount(1);
        setTermEndDate('');
      }

      // 3. Daily defaults: strictly from authoritative server context (preserves null vs 0, and explicit 0 deposit)
      const dRent = eff?.dailyRent !== null && eff?.dailyRent !== undefined ? Number(eff.dailyRent) : null;
      const dDep = eff?.dailyDeposit !== null && eff?.dailyDeposit !== undefined
        ? Number(eff.dailyDeposit)
        : (eff?.depositAmount !== null && eff?.depositAmount !== undefined ? Number(eff.depositAmount) : 0);

      setDailyRate(dRent);
      setDailyDeposit(dDep);
      setDailyDepositDeclaredStatus('UNPAID');
      setDailyEndDate(today);
      setCheckInTime('');
      setCheckOutTime('');

      // Set initial active tab: default = 'LINE' (Requirement R1 / T1)
      setActiveTab('LINE');

      // Clear ID card attachment on open
      if (idCardPreview) {
        URL.revokeObjectURL(idCardPreview);
      }
      setIdCardFile(null);
      setIdCardPreview(null);
      setIdCardError(null);
    }
  }, [context?.roomId, context, isOpen]);

  const handleFileSelect = (file: File | null) => {
    setIdCardError(null);
    if (!file) {
      if (idCardPreview) URL.revokeObjectURL(idCardPreview);
      setIdCardFile(null);
      setIdCardPreview(null);
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setIdCardError('รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, WebP) เท่านั้น ไม่รองรับไฟล์ PDF');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setIdCardError(`ขนาดไฟล์รูปภาพเกิน 5 MB (${(file.size / (1024 * 1024)).toFixed(2)} MB) กรุณาเลือกไฟล์ขนาดไม่เกิน 5 MB`);
      return;
    }

    if (idCardPreview) URL.revokeObjectURL(idCardPreview);
    setIdCardFile(file);
    setIdCardPreview(URL.createObjectURL(file));
  };

  // Recalculate monthly end date on start or duration change
  useEffect(() => {
    if (startDate && durationMonths > 0) {
      setMonthlyEndDate(calculateMonthEndDate(startDate, durationMonths));
    }
  }, [startDate, durationMonths]);

  // Recalculate term end date on start change
  useEffect(() => {
    if (startDate && termMonths && termMonths > 0) {
      setTermEndDate(calculateMonthEndDate(startDate, termMonths));
    }
  }, [startDate, termMonths]);

  if (!isOpen || !context) return null;

  const isTermTabDisabled =
    !context.building?.termMonths ||
    !context.effective?.termRent ||
    Number(context.effective?.termRent) <= 0;

  const inclusiveDays = calculateInclusiveDays(startDate, dailyEndDate);
  const dailyTotalRent = (dailyRate ?? 0) * inclusiveDays;
  const dailyTotalAgreed = dailyTotalRent + dailyDeposit;
  const dailyOutstanding = dailyDepositDeclaredStatus === 'PAID' ? dailyTotalRent : dailyTotalAgreed;

  const isTermDisabled =
    activeTab === 'TERM' &&
    (!termMonths || termMonths < 1 || termRent === null || termRent === undefined || isNaN(Number(termRent)) || Number(termRent) < 0);

  const isMonthlyDisabled =
    activeTab === 'MONTHLY' &&
    (monthlyRent === null || monthlyRent === undefined || isNaN(Number(monthlyRent)) || Number(monthlyRent) < 0);

  const isDailyDateInvalid = dailyEndDate < startDate;

  const isDailyDisabled =
    activeTab === 'DAILY' &&
    (isDailyDateInvalid || dailyRate === null || dailyRate === undefined || isNaN(Number(dailyRate)) || Number(dailyRate) < 0);

  const isSubmitDisabled = isTermDisabled || isMonthlyDisabled || isDailyDisabled;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorText('กรุณากรอกชื่อ-นามสกุล');
      return;
    }

    if (activeTab === 'TERM') {
      if (!termMonths || termMonths < 1) {
        setErrorText('ไม่พบข้อมูลระยะเวลาสัญญาแบบเทอมของอาคาร (termMonths) กรุณากำหนดการตั้งค่าอาคารก่อนทำสัญญาแบบเทอม');
        return;
      }
      if (termRent === null || termRent === undefined || isNaN(Number(termRent)) || Number(termRent) < 0) {
        setErrorText('กรุณาระบุค่าเช่ารวมตลอดสัญญาแบบเทอม');
        return;
      }
    }

    if (activeTab === 'MONTHLY') {
      if (monthlyRent === null || monthlyRent === undefined || isNaN(Number(monthlyRent)) || Number(monthlyRent) < 0) {
        setErrorText('กรุณาระบุค่าเช่ารายเดือน');
        return;
      }
    }

    if (activeTab === 'DAILY') {
      if (dailyRate === null || dailyRate === undefined || isNaN(Number(dailyRate)) || Number(dailyRate) < 0) {
        setErrorText('กรุณาระบุค่าเช่ารายวัน');
        return;
      }
      if (dailyEndDate < startDate) {
        setErrorText('วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มพัก');
        return;
      }
    }

    setLoading(true);
    setErrorText(null);

    try {
      if (activeTab === 'MONTHLY') {
        const payload = {
          roomId: context.roomId,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          rentalType: 'MONTHLY',
          startDate,
          endDate: monthlyEndDate || undefined,
          durationMonths: Number(durationMonths),
          unitRentAmount: monthlyRent.toFixed(2),
          totalRentAmount: (monthlyRent * durationMonths).toFixed(2),
          depositAmount: Number(monthlyDeposit || 0).toFixed(2),
          depositDeclaredStatus: monthlyDepositDeclaredStatus,
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/meters/provisional-terms', formData, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        } else {
          await httpRequest('POST', '/api/v1/meters/provisional-terms', payload, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        }

        onSuccess(`เพิ่มผู้เช่ารายเดือน (${context.roomNumber}) เรียบร้อยแล้ว`);
        onClose();
      } else if (activeTab === 'TERM') {
        const payload = {
          roomId: context.roomId,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          rentalType: 'TERM',
          startDate,
          endDate: termEndDate || undefined,
          durationMonths: termMonths ? Number(termMonths) : undefined,
          unitRentAmount: Number(termRent).toFixed(2),
          totalRentAmount: Number(termRent).toFixed(2),
          depositAmount: Number(termDeposit || 0).toFixed(2),
          depositDeclaredStatus: termDepositDeclaredStatus,
          termInstallmentCount: Number(termInstallmentCount),
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/meters/provisional-terms', formData, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        } else {
          await httpRequest('POST', '/api/v1/meters/provisional-terms', payload, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        }

        onSuccess(`เพิ่มผู้เช่ารายเทอม (${context.roomNumber}) เรียบร้อยแล้ว`);
        onClose();
      } else if (activeTab === 'DAILY') {
        const payload = {
          dormitoryId: context.dormitoryId,
          roomId: context.roomId,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          startDate,
          endDate: dailyEndDate,
          checkInTime: checkInTime || undefined,
          checkOutTime: checkOutTime || undefined,
          dailyRateAmount: Number(dailyRate).toFixed(2),
          depositAmount: Number(dailyDeposit || 0).toFixed(2),
          depositDeclaredStatus: dailyDepositDeclaredStatus,
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/daily-stays/owner-quick-add', formData, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        } else {
          await httpRequest('POST', '/api/v1/daily-stays/owner-quick-add', payload, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        }

        onSuccess('เพิ่มผู้เช่า รายวัน เรียบร้อยแล้ว');
        onClose();
      }
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการเพิ่มผู้เช่า');
    } finally {
      setLoading(false);
    }
  };


  if (!isOpen || !context) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              เพิ่มผู้เช่าด่วน
            </h3>
            {activeTab === 'LINE' ? (
              <p className="text-xs text-slate-500 mt-0.5">
                ลงทะเบียนผู้เช่าผ่าน LINE Official Account ประจำหอพัก
              </p>
            ) : (
              <p className="text-xs text-slate-500 mt-0.5">
                ห้อง <span className="font-bold text-indigo-600">{context.roomNumber}</span> — {context.building?.name || ''} {context.roomType ? `(${context.roomType})` : 'สร้างสัญญาชั่วคราว/รายวันใน 1 ขั้นตอน'}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 4-Mode Tabs: Row 1 = TERM / MONTHLY / DAILY, Row 2 = LINE */}
        <div className="p-4 bg-slate-50 border-b border-slate-100 space-y-2">
          {/* Row 1: Traditional Rental Types (TERM / MONTHLY / DAILY) */}
          <div className="flex bg-slate-200/80 p-1 rounded-2xl gap-1">
            <button
              type="button"
              disabled={isTermTabDisabled}
              title={isTermTabDisabled ? 'ยังไม่ได้กำหนดค่าเช่ารายเทอมของห้องพัก' : undefined}
              onClick={() => !isTermTabDisabled && setActiveTab('TERM')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                isTermTabDisabled
                  ? 'opacity-40 cursor-not-allowed text-slate-400 bg-slate-100'
                  : activeTab === 'TERM'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-3.5 h-3.5 shrink-0" />
              <span>รายเทอม</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('MONTHLY')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'MONTHLY'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5 shrink-0" />
              <span>รายเดือน</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DAILY')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                activeTab === 'DAILY'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>รายวัน</span>
            </button>
          </div>

          {/* Row 2: Recommended LINE Onboarding */}
          <button
            type="button"
            onClick={() => setActiveTab('LINE')}
            className={`w-full py-2.5 px-3 text-xs font-extrabold rounded-xl transition-all flex items-center justify-center gap-2 border cursor-pointer ${
              activeTab === 'LINE'
                ? 'bg-[#06C755] text-white border-[#05B34C] shadow-xs'
                : 'bg-white text-slate-700 hover:text-slate-900 border-slate-200 hover:border-slate-300'
            }`}
          >
            <LineLogo className="w-4 h-4 shrink-0 rounded-sm" />
            <span>เพิ่มผู้เช่า LINE</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              activeTab === 'LINE' ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
            }`}>
              แนะนำ
            </span>
          </button>
        </div>

        {activeTab === 'LINE' ? (
          <div className="flex flex-col flex-1 overflow-y-auto">
            {isLineLoading ? (
              <div className="p-8 flex flex-col items-center justify-center space-y-3 min-h-[320px]">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
                <p className="text-xs font-semibold text-slate-500">กำลังโหลดข้อมูล LINE OA...</p>
              </div>
            ) : isLineError ? (
              <div className="p-6 text-center space-y-4 min-h-[320px] flex flex-col items-center justify-center">
                <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <p className="text-sm font-bold text-slate-800">ไม่สามารถโหลดข้อมูล LINE OA ได้</p>
                <button
                  type="button"
                  onClick={() => fetchLineOaConfig()}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  ลองใหม่
                </button>
              </div>
            ) : !isLineConfigured ? (
              <div className="p-6 text-center space-y-4 min-h-[320px] flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-500 flex items-center justify-center mx-auto ring-8 ring-amber-50/50">
                  <AlertCircle className="w-7 h-7 stroke-[2.2]" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <h4 className="text-base font-extrabold text-slate-900">ยังไม่ได้เชื่อมต่อ LINE OA</h4>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    กรุณาตั้งค่า LINE Official Account ของหอพักก่อนใช้งานการเพิ่มผู้เช่าผ่าน LINE
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleManageLineOa}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl transition-all shadow-xs hover:shadow-md cursor-pointer flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  <span>จัดการ LINE Official Account (LINE OA)</span>
                </button>
              </div>
            ) : !isLineReady ? (
              <div className="p-6 text-center space-y-4 min-h-[320px] flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto ring-8 ring-amber-50/50">
                  <AlertCircle className="w-7 h-7 stroke-[2.2]" />
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <h4 className="text-base font-extrabold text-slate-900">เชื่อมต่อ LINE OA แล้ว แต่ Webhook ยังไม่พร้อม</h4>
                  <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    เชื่อมต่อบัญชี LINE Official Account เรียบร้อยแล้ว แต่ระบบ Webhook ยังไม่พร้อมใช้งาน การลงทะเบียนผ่าน LINE จะเปิดให้ผู้เช่าใช้งานได้เมื่อการตั้งค่า Webhook เสร็จสมบูรณ์
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleManageLineOa}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold rounded-xl transition-all shadow-xs hover:shadow-md cursor-pointer flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  <span>จัดการ LINE Official Account (LINE OA)</span>
                </button>
              </div>
            ) : (
              <div className="p-5 space-y-5 flex-1">
                {/* LINE OA Header Info */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-2xl bg-[#06C755] flex items-center justify-center text-white font-bold shadow-xs p-1">
                      <LineLogo className="w-full h-full rounded-sm" />
                    </div>
                    <div>
                      <h4 className="text-sm font-extrabold text-slate-900">LINE Official Account</h4>
                      <p className="text-xs text-slate-500 font-semibold">{lineConfig?.botDisplayName || 'หอพัก'}</p>
                    </div>
                  </div>
                </div>

                {/* QR Area Box */}
                <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-5 flex flex-col items-center justify-center space-y-3.5">
                  {lineConfig?.qrSvg ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: lineConfig.qrSvg }}
                      className="w-48 h-48 bg-white p-2 rounded-2xl shadow-xs border border-slate-100 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                      data-testid="line-oa-qr-svg-container"
                    />
                  ) : (
                    <div className="w-48 h-48 bg-white p-2 rounded-2xl shadow-xs border border-slate-100 flex items-center justify-center text-xs text-slate-400">
                      ไม่สามารถแสดง QR Code ได้
                    </div>
                  )}

                  {/* LINE ID with Copy */}
                  <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-xs font-bold text-slate-500">LINE ID:</span>
                    <span className="text-xs font-extrabold text-slate-900 font-mono" data-testid="line-oa-id-display">
                      {effectiveLineId}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyLineId}
                      className="ml-1 p-1 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-bold"
                      title="คัดลอก LINE ID"
                    >
                      {copiedLineId ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                          <span className="text-emerald-600">คัดลอกแล้ว</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>คัดลอก</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Direct Friend Link */}
                  {friendAddUrl && (
                    <a
                      href={friendAddUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full max-w-xs py-2.5 bg-[#06C755] hover:bg-[#05B34C] text-white text-xs font-extrabold rounded-xl transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>เพิ่มเพื่อนใน LINE</span>
                    </a>
                  )}
                </div>

                {/* Registration Steps */}
                <div className="bg-emerald-50/60 border border-emerald-100/80 rounded-2xl p-4 space-y-2.5">
                  <h5 className="text-xs font-extrabold text-emerald-900 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>ขั้นตอนการลงทะเบียนสำหรับผู้เช่า</span>
                  </h5>
                  <ol className="text-xs text-emerald-800/90 font-medium space-y-1.5 pl-5 list-decimal leading-relaxed">
                    <li>สแกน QR Code หรือเพิ่มเพื่อนผ่าน LINE ID ที่แสดง</li>
                    <li>กดปุ่ม &quot;ลงทะเบียนผู้เช่า&quot; ใน LINE</li>
                    <li>กรอกข้อมูลให้ครบถ้วน พร้อมแนบเอกสารที่กำหนด</li>
                    <li>รอเจ้าของหอพักตรวจสอบและอนุมัติ</li>
                    <li>ลงทะเบียนสำเร็จ พร้อมใช้งาน</li>
                  </ol>
                </div>
              </div>
            )}
            {/* Modal Bottom Action for LINE Tab */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-end bg-slate-50/50">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200/80 rounded-xl transition-colors cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {/* Common Tenant Identity Fields */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ชื่อ-นามสกุล ผู้เช่า <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  required
                  placeholder="เช่น นายสมชาย ใจดี"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                เบอร์โทรศัพท์ (ถ้ามี)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="tel"
                  placeholder="เช่น 081-234-5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                />
              </div>
            </div>

            {/* Optional ID-Card Document Attachment */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                รูปเอกสารสำเนาบัตรประชาชน (ถ้ามี)
              </label>
              <div className="space-y-2">
                {!idCardFile ? (
                  <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/60 hover:bg-indigo-50/30 rounded-2xl p-3.5 flex flex-col items-center justify-center cursor-pointer transition-all group">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        handleFileSelect(f);
                      }}
                    />
                    <div className="flex items-center gap-2 text-slate-500 group-hover:text-indigo-600">
                      <ImageIcon className="w-4 h-4" />
                      <span className="text-xs font-bold">แนบรูปภาพบัตรประชาชน (JPG, PNG, WebP)</span>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5">สูงสุด 1 รูป ขนาดไม่เกิน 5 MB (ไม่บังคับ)</span>
                  </label>
                ) : (
                  <div className="flex items-center justify-between p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {idCardPreview && (
                        <img
                          src={idCardPreview}
                          alt="ID Card Preview"
                          className="w-10 h-10 object-cover rounded-xl border border-indigo-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{idCardFile.name}</p>
                        <p className="text-[10px] text-slate-500">{(idCardFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleFileSelect(null)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                      title="ลบไฟล์รูปภาพ"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {idCardError && (
                  <p className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {idCardError}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                วันที่เริ่มเข้าพัก / เริ่มสัญญา <span className="text-rose-500">*</span>
              </label>
              <OwnerDateInput
                required
                value={startDate}
                onChange={(iso) => setStartDate(iso)}
              />
            </div>
          </div>

          {/* TAB 1: TERM */}
          {activeTab === 'TERM' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              {!termMonths ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <span>ไม่พบข้อมูลระยะเวลาสัญญาแบบเทอมของอาคาร (termMonths) กรุณากำหนดการตั้งค่าอาคารก่อนทำสัญญาแบบเทอม</span>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        ระยะเวลาตามเทอม (เดือน) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={termMonths || ''}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setTermMonths(isNaN(val) || val < 1 ? 1 : val);
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        วันที่สิ้นสุด
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[34px] flex items-center">
                        {termEndDate ? formatThaiDate(termEndDate) : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        ค่าเช่ารายเทอม (บาท) <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        placeholder="ระบุค่าเช่ารายเทอม"
                        value={termRent !== null && termRent !== undefined ? termRent : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTermRent(val === '' ? null : normalizeMoneyInput(val));
                        }}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        เงินประกัน/มัดจำ (บาท)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={termDeposit}
                        onChange={(e) => setTermDeposit(normalizeMoneyInput(e.target.value))}
                        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                      />
                    </div>
                  </div>

                  {/* Term Deposit Status Toggle */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      สถานะการรับเงินมัดจำ
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setTermDepositDeclaredStatus('UNPAID')}
                        className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                          termDepositDeclaredStatus === 'UNPAID'
                            ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        รอชำระ
                      </button>
                      <button
                        type="button"
                        onClick={() => setTermDepositDeclaredStatus('PAID')}
                        className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                          termDepositDeclaredStatus === 'PAID'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        ชำระแล้ว
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      จำนวนงวดชำระ <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={termInstallmentCount}
                      onChange={(e) => setTermInstallmentCount(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold cursor-pointer"
                    >
                      {Array.from({ length: maxInstallments }, (_, i) => i + 1).map((num) => (
                        <option key={num} value={num}>
                          {num} งวด {num === 1 ? '(ชำระครั้งเดียว)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Live Installment Breakdown Preview & Total Term Rent */}
                  {(() => {
                    const schedule = calculateInstallmentSchedule(termRent || 0, termInstallmentCount);
                    return (
                      <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl space-y-2.5">
                        <div className="flex items-center justify-between text-xs pb-2 border-b border-indigo-100/70">
                          <span className="font-bold text-indigo-900">ค่าเช่ารายเทอมทั้งหมด:</span>
                          <span className="font-extrabold text-indigo-700 text-sm">{formatBaht(termRent || 0)}</span>
                        </div>

                        <div className="space-y-1">
                          <div className="text-[11px] font-bold text-slate-500 flex items-center justify-between">
                            <span>ตารางแบ่งชำระรายงวด ({termInstallmentCount} งวด):</span>
                            {termInstallmentCount === 1 && (
                              <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-100/60 px-2 py-0.5 rounded-md">ชำระเต็มจำนวน</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                            {schedule.map((inst) => (
                              <div
                                key={inst.installmentNo}
                                className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded-xl border border-indigo-100/80 text-xs shadow-2xs"
                              >
                                <span className="font-bold text-slate-600">งวดที่ {inst.installmentNo}:</span>
                                <span className="font-extrabold text-slate-900 font-mono">฿{inst.formattedAmount}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* TAB 2: MONTHLY */}
          {activeTab === 'MONTHLY' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ระยะเวลาสัญญา (เดือน) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่สิ้นสุด
                  </label>
                  <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[34px] flex items-center">
                    {monthlyEndDate ? formatThaiDate(monthlyEndDate) : '-'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าเช่ารายเดือน (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(normalizeMoneyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    เงินประกัน/มัดจำ (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={monthlyDeposit}
                    onChange={(e) => setMonthlyDeposit(normalizeMoneyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              {/* Monthly Deposit Status Toggle */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะการรับเงินมัดจำ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMonthlyDepositDeclaredStatus('UNPAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      monthlyDepositDeclaredStatus === 'UNPAID'
                        ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    รอชำระ
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonthlyDepositDeclaredStatus('PAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      monthlyDepositDeclaredStatus === 'PAID'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ชำระแล้ว
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าเช่ารวม (บาท)
                  </label>
                  <div className="px-3 py-2 text-xs bg-indigo-50 border border-indigo-100 rounded-xl text-indigo-700 font-extrabold flex items-center justify-between">
                    <span>{formatBaht(monthlyRent * durationMonths)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: DAILY */}
          {activeTab === 'DAILY' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่สิ้นสุด (เช็คเอาท์) <span className="text-rose-500">*</span>
                  </label>
                  <OwnerDateInput
                    required
                    min={startDate}
                    value={dailyEndDate}
                    onChange={(iso) => setDailyEndDate(iso)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    จำนวนวันเข้าพัก (รวม)
                  </label>
                  <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold">
                    {inclusiveDays} วัน
                  </div>
                </div>
              </div>

              {/* Optional Check-in / Check-out Times (Strict 24-Hour Thai HH:mm Wheel Picker) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      เวลาเช็คอิน (ไม่บังคับ)
                    </label>
                    <span className="text-[10px] text-slate-400 font-semibold">24 ชม.</span>
                  </div>
                  <TimeWheelPicker
                    value={checkInTime}
                    onChange={setCheckInTime}
                    onClear={() => setCheckInTime('')}
                    placeholder="เช่น 14:00"
                    data-testid="daily-checkin-time-picker"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">
                      เวลาเช็คเอาท์ (ไม่บังคับ)
                    </label>
                    <span className="text-[10px] text-slate-400 font-semibold">24 ชม.</span>
                  </div>
                  <TimeWheelPicker
                    value={checkOutTime}
                    onChange={setCheckOutTime}
                    onClear={() => setCheckOutTime('')}
                    placeholder="เช่น 12:00"
                    data-testid="daily-checkout-time-picker"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    อัตราค่าเช่าต่อวัน (บาท) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    placeholder="ยังไม่ได้กำหนดค่าเช่ารายวัน"
                    value={dailyRate === null || dailyRate === undefined ? '' : dailyRate}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        setDailyRate(null);
                      } else {
                        setDailyRate(normalizeMoneyInput(val));
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                  {dailyRate === null && (
                    <p className="text-[11px] text-amber-600 font-medium mt-1">
                      ยังไม่ได้กำหนดค่าเช่ารายวัน กรุณาระบุราคาที่ตกลงกัน
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    เงินประกัน/มัดจำ (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dailyDeposit}
                    onChange={(e) => setDailyDeposit(normalizeMoneyInput(e.target.value))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              {/* Deposit Status Toggle */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะการรับเงินมัดจำ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDailyDepositDeclaredStatus('UNPAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      dailyDepositDeclaredStatus === 'UNPAID'
                        ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    รอชำระ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDailyDepositDeclaredStatus('PAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                      dailyDepositDeclaredStatus === 'PAID'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ชำระแล้ว
                  </button>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-1.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>ค่าเช่ารวม ({inclusiveDays} วัน):</span>
                  <span className="font-bold">{formatBaht(dailyTotalRent)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>เงินประกัน/มัดจำ:</span>
                  <span className="font-bold">{formatBaht(dailyDeposit)}</span>
                </div>
                <div className="flex justify-between text-slate-900 pt-1 border-t border-slate-200 font-extrabold">
                  <span>ยอดตามข้อตกลง:</span>
                  <span className="text-indigo-700">{formatBaht(dailyTotalAgreed)}</span>
                </div>
                <div className="flex justify-between text-slate-900 pt-1 font-extrabold">
                  <span>ยอดค้างชำระคงเหลือ:</span>
                  <span className="text-rose-600">{formatBaht(dailyOutstanding)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Form-level validation / business error */}
          {errorText && (
            <div data-testid="quick-add-error-box" className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-bold flex items-start gap-2 animate-in fade-in duration-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorText}</span>
            </div>
          )}

          {/* Submit Action */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={loading || isSubmitDisabled}
              className={`px-4 py-2 text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 ${
                isSubmitDisabled
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
              }`}
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>ยืนยันเพิ่มผู้เช่า</span>
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
};
