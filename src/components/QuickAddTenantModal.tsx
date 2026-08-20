/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * QuickAddTenantModal (LOCAL-07 Batch 02)
 * 3-Type Owner Quick Add: รายเทอม (TERM), รายเดือน (MONTHLY), รายวัน (DAILY).
 */

import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Phone, DollarSign, Clock, Shield, CheckCircle, AlertCircle, Loader2, Image as ImageIcon, Trash2 } from 'lucide-react';
import { QuickAddRoomContext } from '../types';
import { httpRequest } from '../data/httpClient';
import { formatBaht, formatThaiDate, normalizeMoneyInput, OwnerDateInput } from './GlobalComponents';
import { calculateInstallmentSchedule } from '../utils/installmentCalculator';

interface QuickAddTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: QuickAddRoomContext | null;
  onSuccess: (message: string) => void;
}

type RentalTypeTab = 'TERM' | 'MONTHLY' | 'DAILY';

export const QuickAddTenantModal: React.FC<QuickAddTenantModalProps> = ({
  isOpen,
  onClose,
  context,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<RentalTypeTab>('TERM');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Identity Card Document upload (0 or 1 image, max 5 MB, JPEG/PNG/WebP only, no PDF)
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [idCardError, setIdCardError] = useState<string | null>(null);

  // Monthly fields
  const [durationMonths, setDurationMonths] = useState(1);
  const [monthlyRent, setMonthlyRent] = useState<number>(0);
  const [monthlyEndDate, setMonthlyEndDate] = useState('');

  // Term fields (Strictly Building-authoritative)
  const [termMonths, setTermMonths] = useState<number | null>(null);
  const [termRent, setTermRent] = useState<number | null>(null);
  const [termInstallmentCount, setTermInstallmentCount] = useState(1);
  const [maxInstallments, setMaxInstallments] = useState(1);
  const [termEndDate, setTermEndDate] = useState('');

  // Daily fields
  const [dailyEndDate, setDailyEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dailyRate, setDailyRate] = useState<number | null>(null);
  const [dailyDeposit, setDailyDeposit] = useState<number>(0);
  const [depositDeclaredStatus, setDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

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
      setMonthlyRent(mRent);
      setDurationMonths(1);
      setMonthlyEndDate(calculateMonthEndDate(today, 1));

      // 2. Term defaults: Strictly Building-authoritative
      const bldTermMonths = bld?.termMonths && Number(bld.termMonths) >= 1 ? Number(bld.termMonths) : null;
      const bldMaxInstallments = bld?.maxTermRentInstallments && Number(bld.maxTermRentInstallments) >= 1
        ? Number(bld.maxTermRentInstallments)
        : 1;

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
      const dDep = eff?.depositAmount !== null && eff?.depositAmount !== undefined ? Number(eff.depositAmount) : 0;

      setDailyRate(dRent);
      setDailyDeposit(dDep);
      setDailyEndDate(today);
      setDepositDeclaredStatus('UNPAID');

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

  const inclusiveDays = calculateInclusiveDays(startDate, dailyEndDate);
  const dailyTotalRent = (dailyRate ?? 0) * inclusiveDays;
  const dailyTotalAgreed = dailyTotalRent + dailyDeposit;
  const dailyOutstanding = depositDeclaredStatus === 'PAID' ? dailyTotalRent : dailyTotalAgreed;

  const isTermDisabled =
    activeTab === 'TERM' &&
    (!termMonths || termMonths < 1 || termRent === null || termRent === undefined || isNaN(Number(termRent)) || Number(termRent) <= 0);

  const isDailyDisabled =
    activeTab === 'DAILY' &&
    (dailyRate === null || dailyRate === undefined || isNaN(Number(dailyRate)) || Number(dailyRate) < 0);

  const isSubmitDisabled = isTermDisabled || isDailyDisabled;

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
      if (termRent === null || termRent === undefined || isNaN(Number(termRent)) || Number(termRent) <= 0) {
        setErrorText('กรุณาระบุค่าเช่ารายเทอม');
        return;
      }
    }

    if (activeTab === 'DAILY') {
      if (dailyRate === null || dailyRate === undefined || isNaN(Number(dailyRate)) || Number(dailyRate) < 0) {
        setErrorText('กรุณาระบุค่าเช่ารายวัน');
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
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/meters/provisional-terms', formData, {
            headers: {
              'x-dormitory-id': context.dormitoryId,
            },
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
          unitRentAmount: Number(termRent).toFixed(2),
          totalRentAmount: Number(termRent).toFixed(2),
          termInstallmentCount: Number(termInstallmentCount),
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/meters/provisional-terms', formData, {
            headers: {
              'x-dormitory-id': context.dormitoryId,
            },
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
          dailyRateAmount: dailyRate.toFixed(2),
          depositAmount: dailyDeposit.toFixed(2),
          depositDeclaredStatus,
        };

        if (idCardFile) {
          const formData = new FormData();
          formData.append('data', JSON.stringify(payload));
          formData.append('idCardImage', idCardFile);
          await httpRequest('POST', '/api/v1/daily-stays/owner-quick-add', formData, {
            headers: {
              'x-dormitory-id': context.dormitoryId,
            },
          });
        } else {
          await httpRequest('POST', '/api/v1/daily-stays/owner-quick-add', payload, {
            headers: { 'x-dormitory-id': context.dormitoryId },
          });
        }

        onSuccess(`เพิ่มผู้เช่ารายวัน (${context.roomNumber}) และออกใบแจ้งหนี้เรียบร้อยแล้ว`);
        onClose();
      }
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              เพิ่มผู้เช่าด่วน
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              ห้อง <span className="font-bold text-indigo-600">{context.roomNumber}</span> — สร้างสัญญาชั่วคราว/รายวันใน 1 ขั้นตอน
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Type Rental Mode Tabs: TERM -> MONTHLY -> DAILY */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="flex bg-slate-200/80 p-1 rounded-2xl gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('TERM')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all ${
                activeTab === 'TERM'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายเทอม
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('MONTHLY')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all ${
                activeTab === 'MONTHLY'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายเดือน
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DAILY')}
              className={`flex-1 py-2 text-xs font-extrabold rounded-xl transition-all ${
                activeTab === 'DAILY'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายวัน
            </button>
          </div>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {errorText && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-bold flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorText}</span>
            </div>
          )}

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
                        ระยะเวลาตามเทอม (อาคาร)
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold">
                        {termMonths} เดือน
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        วันที่สิ้นสุด
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold">
                        {formatThaiDate(termEndDate)}
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
                    วันที่สิ้นสุด (แก้ไขได้)
                  </label>
                  <OwnerDateInput
                    value={monthlyEndDate}
                    onChange={(iso) => setMonthlyEndDate(iso)}
                  />
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
                    onClick={() => setDepositDeclaredStatus('UNPAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                      depositDeclaredStatus === 'UNPAID'
                        ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ยังไม่ชำระมัดจำ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositDeclaredStatus('PAID')}
                    className={`py-2 text-xs font-bold rounded-xl border transition-all ${
                      depositDeclaredStatus === 'PAID'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ชำระเงินมัดจำแล้ว
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
      </div>
    </div>
  );
};
