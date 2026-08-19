/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * TenantDailyRequestModal (LOCAL-07 Batch 02)
 * Minimal additive modal for tenants/applicants to submit a Daily Stay Request (Option 2A).
 */

import React, { useState } from 'react';
import { X, Calendar, User, Phone, CheckCircle, AlertCircle, Loader2, BedDouble } from 'lucide-react';
import { httpRequest } from '../data/httpClient';

interface TenantDailyRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  dormitoryId: string;
  roomId: string;
  roomNumber?: string;
  onSuccess: (message: string) => void;
}

export const TenantDailyRequestModal: React.FC<TenantDailyRequestModalProps> = ({
  isOpen,
  onClose,
  dormitoryId,
  roomId,
  roomNumber,
  onSuccess,
}) => {
  const [applicantFullName, setApplicantFullName] = useState('');
  const [applicantPhone, setApplicantPhone] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applicantFullName.trim()) {
      setErrorText('กรุณาระบุชื่อ-นามสกุล');
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      await httpRequest('POST', '/api/v1/daily-stays/request', {
        dormitoryId,
        roomId,
        applicantFullName: applicantFullName.trim(),
        applicantPhone: applicantPhone.trim() || undefined,
        startDate,
        endDate,
      });

      onSuccess('ส่งคำขอเข้าพักรายวันเรียบร้อยแล้ว รอการอนุมัติจากเจ้าของหอพัก');
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการส่งคำขอ');
    } finally {
      setLoading(false);
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

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between font-bold text-amber-900">
            <span>จำนวนวันพักอาศัย (รวม):</span>
            <span>{daysCount} วัน</span>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
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
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-md shadow-amber-600/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
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
