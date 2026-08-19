/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * QuickAddTenantModal (LOCAL-07 Batch 02)
 * 3-Type Owner Quick Add: รายเทอม (TERM), รายเดือน (MONTHLY), รายวัน (DAILY).
 */

import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Phone, DollarSign, Clock, Shield, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Room } from '../types';
import { httpRequest } from '../data/httpClient';
import { formatBaht } from './GlobalComponents';

interface QuickAddTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room | null;
  dormitoryId: string;
  onSuccess: (message: string) => void;
}

type RentalTypeTab = 'TERM' | 'MONTHLY' | 'DAILY';

export const QuickAddTenantModal: React.FC<QuickAddTenantModalProps> = ({
  isOpen,
  onClose,
  room,
  dormitoryId,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<RentalTypeTab>('MONTHLY');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  
  // Monthly fields
  const [durationMonths, setDurationMonths] = useState(1);
  const [monthlyRent, setMonthlyRent] = useState<number>(0);
  const [monthlyEndDate, setMonthlyEndDate] = useState('');

  // Term fields
  const [termMonths, setTermMonths] = useState(6);
  const [termRent, setTermRent] = useState<number>(0);
  const [termInstallmentCount, setTermInstallmentCount] = useState(1);
  const [maxInstallments, setMaxInstallments] = useState(1);
  const [termEndDate, setTermEndDate] = useState('');

  // Daily fields
  const [dailyEndDate, setDailyEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dailyRate, setDailyRate] = useState<number>(0);
  const [dailyDeposit, setDailyDeposit] = useState<number>(0);
  const [depositDeclaredStatus, setDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Helper: add calendar months minus 1 day
  const calculateMonthEndDate = (start: string, months: number): string => {
    if (!start) return '';
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

  // Initialize room and building defaults when opened
  useEffect(() => {
    if (room && isOpen) {
      setErrorText(null);
      setFullName('');
      setPhone('');
      const today = new Date().toISOString().slice(0, 10);
      setStartDate(today);

      // Monthly defaults
      const mRent = Number(room.monthlyRent || 0);
      setMonthlyRent(mRent);
      setDurationMonths(1);
      setMonthlyEndDate(calculateMonthEndDate(today, 1));

      // Term defaults
      const tMonths = Number(room.termMonths || 6);
      const tRent = Number(room.termRent || (mRent * tMonths));
      const maxInst = Number((room as any).building?.maxTermRentInstallments || (room as any).maxTermRentInstallments || 1);
      setTermMonths(tMonths);
      setTermRent(tRent);
      setMaxInstallments(maxInst);
      setTermInstallmentCount(1);
      setTermEndDate(calculateMonthEndDate(today, tMonths));

      // Daily defaults
      const dRent = Number(room.dailyRent || (room as any).building?.dailyRent || 500);
      const dDep = Number(room.depositAmount || (room as any).building?.depositAmount || 0);
      setDailyRate(dRent);
      setDailyDeposit(dDep);
      setDailyEndDate(today);
      setDepositDeclaredStatus('UNPAID');
    }
  }, [room, isOpen]);

  // Recalculate monthly end date on start or duration change
  useEffect(() => {
    if (startDate && durationMonths > 0) {
      setMonthlyEndDate(calculateMonthEndDate(startDate, durationMonths));
    }
  }, [startDate, durationMonths]);

  // Recalculate term end date on start change
  useEffect(() => {
    if (startDate && termMonths > 0) {
      setTermEndDate(calculateMonthEndDate(startDate, termMonths));
    }
  }, [startDate, termMonths]);

  if (!isOpen || !room) return null;

  const inclusiveDays = calculateInclusiveDays(startDate, dailyEndDate);
  const dailyTotalRent = dailyRate * inclusiveDays;
  const dailyTotalAgreed = dailyTotalRent + dailyDeposit;
  const dailyOutstanding = depositDeclaredStatus === 'PAID' ? dailyTotalRent : dailyTotalAgreed;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setErrorText('กรุณากรอกชื่อ-นามสกุล');
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      if (activeTab === 'MONTHLY') {
        const payload = {
          roomId: room.id,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          rentalType: 'MONTHLY',
          startDate,
          durationMonths: Number(durationMonths),
          unitRentAmount: monthlyRent.toFixed(2),
          totalRentAmount: (monthlyRent * durationMonths).toFixed(2),
        };

        await httpRequest('POST', '/api/v1/meters/provisional-tenant', payload, {
          headers: { 'x-dormitory-id': dormitoryId },
        });

        onSuccess(`เพิ่มผู้เช่ารายเดือน (${room.roomNumber}) เรียบร้อยแล้ว`);
        onClose();
      } else if (activeTab === 'TERM') {
        const payload = {
          roomId: room.id,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          rentalType: 'TERM',
          startDate,
          unitRentAmount: termRent.toFixed(2),
          totalRentAmount: termRent.toFixed(2),
          termInstallmentCount: Number(termInstallmentCount),
        };

        await httpRequest('POST', '/api/v1/meters/provisional-tenant', payload, {
          headers: { 'x-dormitory-id': dormitoryId },
        });

        onSuccess(`เพิ่มผู้เช่ารายเทอม (${room.roomNumber}) เรียบร้อยแล้ว`);
        onClose();
      } else if (activeTab === 'DAILY') {
        const payload = {
          dormitoryId,
          roomId: room.id,
          fullName: fullName.trim(),
          phone: phone.trim() || undefined,
          startDate,
          endDate: dailyEndDate,
          dailyRateAmount: dailyRate.toFixed(2),
          depositAmount: dailyDeposit.toFixed(2),
          depositDeclaredStatus,
        };

        await httpRequest('POST', '/api/v1/daily-stays/owner-quick-add', payload, {
          headers: { 'x-dormitory-id': dormitoryId },
        });

        onSuccess(`เพิ่มผู้เช่ารายวัน (${room.roomNumber}) และออกใบแจ้งหนี้เรียบร้อยแล้ว`);
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
            <h2 className="text-base font-extrabold text-slate-800 flex items-center gap-2">
              <span>+ เพิ่มผู้เช่าห้อง {room.roomNumber}</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              เลือกประเภทสัญญาเช่าที่ต้องการบันทึก
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

        {/* 3 Tabs Selection */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-200/70 rounded-2xl">
            <button
              type="button"
              onClick={() => setActiveTab('MONTHLY')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'MONTHLY'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              รายเดือน
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TERM')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'TERM'
                  ? 'bg-white text-indigo-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              รายเทอม
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DAILY')}
              className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'DAILY'
                  ? 'bg-white text-amber-600 shadow-xs'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              รายวัน
            </button>
          </div>
        </div>

        {/* Error notification */}
        {errorText && (
          <div className="mx-5 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center gap-2 text-xs font-bold text-rose-700">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{errorText}</span>
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Common Fields: Name & Phone */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ชื่อ-นามสกุล <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
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
                เบอร์โทรศัพท์ <span className="text-slate-400 font-normal">(ไม่บังคับ)</span>
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="tel"
                  placeholder="08X-XXX-XXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                />
              </div>
            </div>

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
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                />
              </div>
            </div>
          </div>

          {/* TAB 1: MONTHLY */}
          {activeTab === 'MONTHLY' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    จำนวนเดือน <span className="text-rose-500">*</span>
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
                  <input
                    type="date"
                    value={monthlyEndDate}
                    onChange={(e) => setMonthlyEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
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
                    onChange={(e) => setMonthlyRent(parseFloat(e.target.value) || 0)}
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

          {/* TAB 2: TERM */}
          {activeTab === 'TERM' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ระยะเวลาตามเทอม
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
                    {termEndDate}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าเช่ารายเทอม (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={termRent}
                    onChange={(e) => setTermRent(parseFloat(e.target.value) || 0)}
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

              <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-between text-xs">
                <span className="font-bold text-indigo-900">ยอดรวมทั้งเทอม:</span>
                <span className="font-extrabold text-indigo-700 text-sm">{formatBaht(termRent)}</span>
              </div>
            </div>
          )}

          {/* TAB 3: DAILY */}
          {activeTab === 'DAILY' && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่สิ้นสุดการพัก <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    min={startDate}
                    value={dailyEndDate}
                    onChange={(e) => setDailyEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    จำนวนวัน (รวม)
                  </label>
                  <div className="px-3 py-2 text-xs bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-bold flex items-center justify-between">
                    <span>{inclusiveDays} วัน</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าเช่าต่อวัน (บาท) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={dailyRate}
                    onChange={(e) => setDailyRate(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าประกัน/มัดจำ (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dailyDeposit}
                    onChange={(e) => setDailyDeposit(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะมัดจำ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDepositDeclaredStatus('PAID')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      depositDeclaredStatus === 'PAID'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositDeclaredStatus('UNPAID')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                      depositDeclaredStatus === 'UNPAID'
                        ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>

              {/* Financial summary for Daily */}
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-2xl space-y-1.5 text-xs text-slate-700 font-semibold">
                <div className="flex justify-between">
                  <span>ค่าเช่ารวม ({inclusiveDays} วัน):</span>
                  <span className="font-bold">{formatBaht(dailyTotalRent)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ค่าประกัน/มัดจำ:</span>
                  <span className="font-bold">{formatBaht(dailyDeposit)}</span>
                </div>
                <div className="flex justify-between border-t border-amber-200/60 pt-1 text-slate-800">
                  <span className="font-bold">ยอดตามข้อตกลง:</span>
                  <span className="font-extrabold text-amber-900">{formatBaht(dailyTotalAgreed)}</span>
                </div>
                <div className="flex justify-between text-indigo-700">
                  <span className="font-bold">ยอดคงเหลือที่ต้องชำระ:</span>
                  <span className="font-extrabold text-indigo-800 text-sm">{formatBaht(dailyOutstanding)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Modal Footer Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-5 py-2 text-xs font-bold text-white rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                activeTab === 'DAILY'
                  ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/10'
                  : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/10'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังบันทึก...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>ยืนยันเพิ่มผู้เช่า</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
