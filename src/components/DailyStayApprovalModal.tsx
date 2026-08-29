/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * DailyStayApprovalModal (LOCAL-07 Batch 02)
 * Owner Review Modal for Tenant-submitted Daily Stay Requests:
 * Features explicit "แก้ไข" (Edit-Before-Approve), "อนุมัติ" (Approve), and "ปฏิเสธ" (Reject).
 */

import React, { useState, useEffect } from 'react';
import { X, Calendar, User, Phone, CheckCircle, AlertCircle, Loader2, Edit3, XCircle } from 'lucide-react';
import { httpRequest } from '../data/httpClient';
import { formatBaht } from './GlobalComponents';

interface DailyStayApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  stay: any | null;
  dormitoryId: string;
  onSuccess: (message: string) => void;
}

export const DailyStayApprovalModal: React.FC<DailyStayApprovalModalProps> = ({
  isOpen,
  onClose,
  stay,
  dormitoryId,
  onSuccess,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [dailyRate, setDailyRate] = useState<number>(0);
  const [depositAmount, setDepositAmount] = useState<number>(0);
  const [depositDeclaredStatus, setDepositDeclaredStatus] = useState<'PAID' | 'UNPAID'>('UNPAID');

  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (stay && isOpen) {
      setErrorText(null);
      setIsEditing(false);
      setDailyRate(Number(stay.dailyRateAmount || 0));
      setDepositAmount(Number(stay.depositAmount || 0));
      setDepositDeclaredStatus(stay.depositDeclaredStatus || 'UNPAID');
    }
  }, [stay, isOpen]);

  if (!isOpen || !stay) return null;

  const inclusiveDays = stay.inclusiveDayCount || 1;
  const currentTotalRent = dailyRate * inclusiveDays;
  const currentTotalAgreed = currentTotalRent + depositAmount;
  const currentOutstanding = depositDeclaredStatus === 'PAID' ? currentTotalRent : currentTotalAgreed;

  const handleSaveEditAndApprove = async () => {
    setLoading(true);
    setErrorText(null);

    try {
      // 1. If edited, send PATCH /api/v1/daily-stays/:id/edit-pending first
      if (isEditing) {
        await httpRequest('PATCH', `/api/v1/daily-stays/${stay.id}/edit-pending`, {
          dailyRateAmount: dailyRate.toFixed(2),
          depositAmount: depositAmount.toFixed(2),
          depositDeclaredStatus,
        }, {
          headers: { 'x-dormitory-id': dormitoryId },
        });
      }

      // 2. Approve stay
      await httpRequest('POST', `/api/v1/daily-stays/${stay.id}/approve`, {}, {
        headers: { 'x-dormitory-id': dormitoryId },
      });

      onSuccess(`อนุมัติคำขอเข้าพักรายวัน (${stay.room?.roomNumber || ''}) เรียบร้อยแล้ว`);
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการดำเนินการ');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!window.confirm('คุณต้องการปฏิเสธคำขอเข้าพักรายวันนี้ใช่หรือไม่?')) {
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      await httpRequest('POST', `/api/v1/daily-stays/${stay.id}/reject`, {}, {
        headers: { 'x-dormitory-id': dormitoryId },
      });

      onSuccess('ปฏิเสธคำขอเข้าพักรายวันเรียบร้อยแล้ว');
      onClose();
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการปฏิเสธ');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (d: string) => {
    if (!d) return '-';
    return d.slice(0, 10);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-amber-50/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                รายวัน
              </span>
              <h2 className="text-base font-extrabold text-slate-800">
                พิจารณาคำขอห้อง {stay.room?.roomNumber || '-'}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 font-medium">
              ตรวจสอบ แก้ไขอัตราค่าบริการ และอนุมัติการเข้าพัก
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

        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Applicant Info */}
          <div className="p-3.5 bg-slate-50 border border-slate-100 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 font-bold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-400" /> ผู้ยื่นคำขอ:
              </span>
              <span className="font-extrabold text-slate-800">{stay.applicantFullName || '-'}</span>
            </div>
            {stay.applicantPhone && (
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-bold flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" /> เบอร์โทรศัพท์:
                </span>
                <span className="font-bold text-slate-700">{stay.applicantPhone}</span>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-slate-200/60 pt-1.5">
              <span className="text-slate-500 font-bold flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-400" /> ช่วงเวลาที่พัก:
              </span>
              <span className="font-extrabold text-indigo-700">
                {formatDate(stay.startDate)} ถึง {formatDate(stay.endDate)} ({inclusiveDays} วัน)
              </span>
            </div>
          </div>

          {/* Financial Breakdown & Edit Action */}
          <div className="p-4 bg-amber-50/60 border border-amber-200/70 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-slate-800 text-xs">รายการคิดค่าบริการ</span>
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-white border border-indigo-200 px-2 py-1 rounded-lg shadow-2xs hover:bg-indigo-50 transition-all cursor-pointer"
              >
                <Edit3 className="w-3 h-3" />
                <span>{isEditing ? 'เสร็จสิ้นการแก้ไข' : 'แก้ไข'}</span>
              </button>
            </div>

            {isEditing ? (
              <div className="space-y-2.5 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    ค่าเช่าต่อวัน (บาท)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={dailyRate}
                    onChange={(e) => setDailyRate(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    ค่าประกัน/มัดจำ (บาท - 0 คือไม่มีมัดจำ)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs border border-amber-300 rounded-xl focus:outline-none focus:border-amber-600 bg-white text-slate-800 font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    สถานะการชำระมัดจำ
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositDeclaredStatus('PAID')}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        depositDeclaredStatus === 'PAID'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      จ่ายแล้ว
                    </button>
                    <button
                      type="button"
                      onClick={() => setDepositDeclaredStatus('UNPAID')}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                        depositDeclaredStatus === 'UNPAID'
                          ? 'bg-amber-50 border-amber-300 text-amber-700'
                          : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      ยังไม่จ่าย
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5 text-xs text-slate-700 font-medium">
                <div className="flex justify-between">
                  <span>ค่าเช่าต่อวัน:</span>
                  <span className="font-bold">{formatBaht(dailyRate)}</span>
                </div>
                <div className="flex justify-between">
                  <span>ค่าเช่ารวม ({inclusiveDays} วัน):</span>
                  <span className="font-bold">{formatBaht(currentTotalRent)}</span>
                </div>
                <div className="flex justify-between">
                  <span>เงินประกัน/มัดจำ:</span>
                  <span className="font-bold">{formatBaht(depositAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span>สถานะมัดจำ:</span>
                  <span className={`font-bold ${depositDeclaredStatus === 'PAID' ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {depositDeclaredStatus === 'PAID' ? 'ชำระแล้ว' : 'รอชำระ'}
                  </span>
                </div>
              </div>
            )}

            {/* Financial Summary */}
            <div className="border-t border-amber-200/80 pt-2 space-y-1">
              <div className="flex justify-between text-slate-800">
                <span className="font-bold">ยอดตามข้อตกลง:</span>
                <span className="font-extrabold text-amber-900">{formatBaht(currentTotalAgreed)}</span>
              </div>
              <div className="flex justify-between text-indigo-700">
                <span className="font-bold">ยอดคงเหลือที่ต้องชำระ:</span>
                <span className="font-extrabold text-indigo-800 text-sm">{formatBaht(currentOutstanding)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions: แก้ไข, ปฏิเสธ, อนุมัติ */}
        <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
          <button
            type="button"
            disabled={loading}
            onClick={handleReject}
            className="px-3.5 py-2 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-rose-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" />
            <span>ปฏิเสธ</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
            >
              ปิด
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={handleSaveEditAndApprove}
              className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-md shadow-emerald-600/10 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังอนุมัติ...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>อนุมัติ</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
