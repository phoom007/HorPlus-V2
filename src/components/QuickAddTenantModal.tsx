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

      const buildingObj = (room as any).building || {};

      // Monthly defaults
      const mRent = Number(room.monthlyRent || 0);
      setMonthlyRent(mRent);
      setDurationMonths(1);
      setMonthlyEndDate(calculateMonthEndDate(today, 1));

      // Term defaults: strictly Building-authoritative
      const tMonths = Number(buildingObj.termMonths || (room as any).termMonths || 6);
      const tRent = Number(room.termRent || (mRent * tMonths));
      const maxInst = Math.max(1, Number(buildingObj.maxTermRentInstallments || 1));
      setTermMonths(tMonths);
      setTermRent(tRent);
      setMaxInstallments(maxInst);
      setTermInstallmentCount(1);
      setTermEndDate(calculateMonthEndDate(today, tMonths));

      // Daily defaults: strictly Room -> Building -> 0 (NO hardcoded fake 500 rate; 0 deposit strictly preserved)
      const dRent = room.dailyRent !== null && room.dailyRent !== undefined
        ? Number(room.dailyRent)
        : buildingObj.dailyRent !== null && buildingObj.dailyRent !== undefined
        ? Number(buildingObj.dailyRent)
        : 0;

      const dDep = room.depositAmount !== null && room.depositAmount !== undefined
        ? Number(room.depositAmount)
        : buildingObj.depositAmount !== null && buildingObj.depositAmount !== undefined
        ? Number(buildingObj.depositAmount)
        : 0;

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
          endDate: monthlyEndDate || undefined,
          durationMonths: Number(durationMonths),
          unitRentAmount: monthlyRent.toFixed(2),
          totalRentAmount: (monthlyRent * durationMonths).toFixed(2),
        };

        await httpRequest('POST', '/api/v1/meters/provisional-terms', payload, {
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

        await httpRequest('POST', '/api/v1/meters/provisional-terms', payload, {
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
            <h3 className="font-extrabold text-slate-900 text-base">
              เพิ่มผู้เช่าด่วน (Quick Add)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              ห้อง <span className="font-bold text-indigo-600">{room.roomNumber}</span> — สร้างสัญญาชั่วคราว/รายวันใน 1 ขั้นตอน
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3-Type Rental Mode Tabs */}
        <div className="p-4 bg-slate-50 border-b border-slate-100">
          <div className="grid grid-cols-3 gap-2 bg-slate-200/70 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => setActiveTab('MONTHLY')}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'MONTHLY'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายเดือน
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('TERM')}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'TERM'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายเทอม
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('DAILY')}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                activeTab === 'DAILY'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              รายวัน
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          {errorText && (
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="font-semibold">{errorText}</div>
            </div>
          )}

          {/* Common fields: Name, Phone, StartDate */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                ชื่อ-นามสกุล ผู้เช่า <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เบอร์โทรศัพท์
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
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
                  วันที่เริ่มต้น <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
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
                    วันเช็คเอาท์ <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={dailyEndDate}
                    onChange={(e) => setDailyEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    จำนวนวันเข้าพัก (นับหัวท้าย)
                  </label>
                  <div className="px-3 py-2 text-xs bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-extrabold flex items-center justify-between">
                    <span>{inclusiveDays} วัน</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    อัตราค่าเช่ารายวัน (บาท/วัน)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={dailyRate}
                    onChange={(e) => setDailyRate(parseFloat(e.target.value) || 0)}
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
                    required
                    value={dailyDeposit}
                    onChange={(e) => setDailyDeposit(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
              </div>

              {/* Deposit Declaration */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  สถานะการชำระเงินมัดจำ
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setDepositDeclaredStatus('UNPAID')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      depositDeclaredStatus === 'UNPAID'
                        ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    ยังไม่ชำระ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositDeclaredStatus('PAID')}
                    className={`py-1.5 px-3 rounded-xl text-xs font-bold border transition-all ${
                      depositDeclaredStatus === 'PAID'
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
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
              disabled={loading}
              className="px-4 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>บันทึกและเปิดสัญญาทันที</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
