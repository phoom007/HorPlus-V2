/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * TenantDailyRequestModal (LOCAL-07 Batch 02)
 * Complete financial context for tenants/applicants to submit a Daily Stay Request (Option 2A).
 */

import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Phone, CheckCircle, AlertCircle, Loader2, BedDouble } from 'lucide-react';
import { httpRequest } from '../data/httpClient';
import { QuickAddRoomContext } from '../types';
import { formatBaht } from './GlobalComponents';

interface TenantDailyRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  dormitoryId: string;
  roomNumber: string;
  roomId?: string;
  onSuccess: (message: string) => void;
}

export const TenantDailyRequestModal: React.FC<TenantDailyRequestModalProps> = ({
  isOpen,
  onClose,
  dormitoryId,
  roomNumber,
  roomId,
  onSuccess,
}) => {
  const [applicantFullName, setApplicantFullName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Authoritative financial state
  const [dailyRate, setDailyRate] = useState<number>(0);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositDeclaredStatus, setDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');

  const [contextState, setContextState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Fetch authoritative rates from pre-link daily request context
  useEffect(() => {
    if (isOpen && (roomNumber || roomId)) {
      setErrorText(null);
      setContextState('loading');
      const dormId = dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');
      const query = new URLSearchParams();
      if (dormId) query.set('dormitoryId', dormId);
      if (roomNumber) query.set('roomNumber', roomNumber);
      if (roomId) query.set('roomId', roomId);

      httpRequest<{ data: { roomId: string; roomNumber: string; dailyRateAmount: string; depositDefaultAmount: string } }>(
        'GET',
        `/api/v1/daily-stays/request-context?${query.toString()}`,
        undefined,
        { headers: dormId ? { 'x-dormitory-id': dormId } : {} }
      )
        .then((res) => {
          if (res?.data) {
            const data = res.data;
            const rate = data.dailyRateAmount ? Number(data.dailyRateAmount) : 0;
            const dep = data.depositDefaultAmount ? Number(data.depositDefaultAmount) : 0;
            setDailyRate(rate);
            setDepositAmount(dep);
            setContextState('ready');
          } else {
            setContextState('error');
            setErrorText('ไม่พบข้อมูลห้องพักหรืออัตราค่าเช่ารายวัน');
          }
        })
        .catch((err: any) => {
          setContextState('error');
          setErrorText(err.message || 'ไม่สามารถโหลดข้อมูลห้องพักหรืออัตราค่าเช่ารายวันได้');
        });
    } else if (!isOpen) {
      setContextState('idle');
    }
  }, [isOpen, roomNumber, roomId, dormitoryId]);

  if (!isOpen) return null;

  const calculateDays = (s: string, e: string) => {
    if (!s || !e) return 1;
    const [sy, sm, sd] = s.split('-').map(Number);
    const [ey, em, ed] = e.split('-').map(Number);
    const startUtc = Date.UTC(sy, sm - 1, sd);
    const endUtc = Date.UTC(ey, em - 1, ed);
    if (endUtc < startUtc) return 1;
    return Math.round((endUtc - startUtc) / (24 * 3600 * 1000)) + 1;
  };

  const daysCount = calculateDays(startDate, endDate);
  const totalRent = dailyRate * daysCount;
  const safeDeposit = isNaN(depositAmount) || depositAmount < 0 ? 0 : depositAmount;
  const totalAgreed = totalRent + safeDeposit;
  const outstanding = depositDeclaredStatus === 'PAID' ? totalRent : totalAgreed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicantFullName.trim()) {
      setErrorText('กรุณาระบุชื่อ-นามสกุล');
      return;
    }

    if (contextState !== 'ready') {
      setErrorText('ไม่สามารถส่งคำขอได้ เนื่องจากข้อมูลห้องพักไม่พร้อมใช้งาน');
      return;
    }

    setSubmitting(true);
    setErrorText(null);

    try {
      await httpRequest('POST', '/api/v1/daily-stays/request', {
        dormitoryId,
        roomNumber,
        roomId: roomId || undefined,
        applicantFullName: applicantFullName.trim(),
        applicantPhone: applicantPhone.trim() || undefined,
        startDate,
        endDate,
        depositAmount: safeDeposit.toFixed(2),
        depositDeclaredStatus,
      }, {
        headers: dormitoryId ? { 'x-dormitory-id': dormitoryId } : {},
      });

      onSuccess('ส่งคำขอเข้าพักรายวันเรียบร้อยแล้ว รอการอนุมัติจากเจ้าของหอพัก');
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการส่งคำขอ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/50">
          <div>
            <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <BedDouble className="w-5 h-5 text-amber-600" />
              <span>ขอเข้าพักรายวันห้อง {roomNumber || ''}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              ส่งคำขอเข้าพักรายวันเพื่อรอการอนุมัติจากเจ้าของหอพัก
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error notification */}
        {errorText && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs font-bold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{errorText}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {contextState === 'loading' ? (
            <div className="p-6 text-center text-slate-400 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
              <span>กำลังโหลดข้อมูลค่าเช่าห้องพัก...</span>
            </div>
          ) : contextState === 'error' ? (
            <div className="p-6 text-center text-rose-600 flex flex-col items-center gap-2 bg-rose-50/50 rounded-2xl border border-rose-100">
              <AlertCircle className="w-6 h-6 text-rose-500" />
              <span className="font-bold">ไม่สามารถโหลดข้อมูลห้องพักหรืออัตราค่าเช่าได้</span>
              <span className="text-xs text-rose-500">{errorText || 'กรุณาลองใหม่อีกครั้งหรือติดต่อเจ้าหน้าที่'}</span>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  ชื่อ-นามสกุล ผู้ขอเข้าพัก <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    placeholder="เช่น นายสมชาย ใจดี"
                    value={applicantFullName}
                    onChange={(e) => setApplicantFullName(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เบอร์โทรศัพท์ติดต่อ <span className="text-slate-400 font-normal">(ไม่บังคับ)</span>
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="tel"
                    placeholder="08X-XXX-XXXX"
                    value={applicantPhone}
                    onChange={(e) => setApplicantPhone(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่เริ่มพัก <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่สิ้นสุด <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="date"
                      required
                      min={startDate}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                    />
                  </div>
                </div>
              </div>

              {/* Financial Context & Calculations */}
              <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-2xl space-y-2 text-xs">
                <div className="flex items-center justify-between font-medium text-slate-700">
                  <span>อัตราค่าเช่ารายวัน (ตามที่หอพักกำหนด):</span>
                  <span className="font-extrabold text-slate-900">{formatBaht(dailyRate)} / วัน</span>
                </div>
                <div className="flex items-center justify-between font-medium text-slate-700">
                  <span>จำนวนวันเข้าพัก (รวม):</span>
                  <span className="font-bold text-amber-800">{daysCount} วัน</span>
                </div>
                <div className="flex items-center justify-between font-medium text-slate-700">
                  <span>รวมค่าเช่า:</span>
                  <span className="font-extrabold text-slate-900">{formatBaht(totalRent)}</span>
                </div>

                {/* Editable Deposit */}
                <div className="pt-2 border-t border-amber-200/60 flex items-center justify-between gap-2">
                  <div>
                    <label className="font-bold text-slate-700 block">เงินมัดจำ/ประกัน (บาท):</label>
                    <span className="text-[10px] text-slate-400">ระบุ 0 ได้หากไม่มีมัดจำ</span>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(Number(e.target.value))}
                    className="w-28 px-2.5 py-1 text-right border border-amber-300 rounded-lg bg-white font-bold text-slate-800 focus:outline-none focus:border-amber-600"
                  />
                </div>

                {/* Deposit Declared Status */}
                <div className="pt-2 border-t border-amber-200/60 space-y-1">
                  <span className="text-[11px] font-bold text-slate-700 block">
                    แจ้งสถานะการชำระเงินมัดจำ (แจ้งล่วงหน้า):
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositDeclaredStatus('UNPAID')}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        depositDeclaredStatus === 'UNPAID'
                          ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      ยังไม่ชำระมัดจำ
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositDeclaredStatus('PAID')}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all cursor-pointer ${
                        depositDeclaredStatus === 'PAID'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      ชำระมัดจำแล้ว (แจ้งสถานะ)
                    </button>
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="pt-2 border-t border-amber-200 space-y-1">
                  <div className="flex items-center justify-between font-bold text-slate-800">
                    <span>ยอดรวมทั้งหมด (ค่าเช่า + มัดจำ):</span>
                    <span className="text-sm font-black text-amber-900">{formatBaht(totalAgreed)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-bold text-slate-600">
                    <span>ยอดที่ต้องชำระเมื่อเช็คอิน:</span>
                    <span className="font-extrabold text-slate-800">{formatBaht(outstanding)}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              data-testid="tenant-daily-submit-btn"
              disabled={submitting || contextState !== 'ready'}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-md shadow-amber-600/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังส่งคำขอ...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>ส่งคำขอเข้าพัก</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
