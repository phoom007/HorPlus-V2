/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  AlertTriangle,
  X
} from 'lucide-react';
import { getLineQuotaInfo, LineQuotaInfo } from '../utils/lineQuota';

interface LineQuotaBadgeProps {
  selectedCycle?: string;
  className?: string;
  hideIcon?: boolean;
  hideLabelText?: boolean;
}

const DEFAULT_ENABLED_EVENTS = [
  'repair_request',
  'repair_completed',
  'payment_received',
  'tenant_register',
  'tenant_approved'
];

const QuotaUsageEventSelector: React.FC = () => {
  const [selectedEvents, setSelectedEvents] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_line_quota_events');
      return saved ? JSON.parse(saved) : DEFAULT_ENABLED_EVENTS;
    } catch {
      return DEFAULT_ENABLED_EVENTS;
    }
  });

  const toggleEvent = (eventId: string) => {
    const updated = selectedEvents.includes(eventId)
      ? selectedEvents.filter(e => e !== eventId)
      : [...selectedEvents, eventId];
    setSelectedEvents(updated);
    localStorage.setItem('HorPlus_line_quota_events', JSON.stringify(updated));
  };

  const eventItems = [
    { id: 'repair_request', label: 'แจ้งงานซ่อม' },
    { id: 'repair_completed', label: 'แจ้งซ่อมสำเร็จ' },
    { id: 'payment_received', label: 'แจ้งโอนเงิน' },
    { id: 'tenant_register', label: 'แจ้งขอเช่า' },
    { id: 'tenant_approved', label: 'แจ้งอนุมัติผู้เช่า' },
  ];

  return (
    <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-2">
      <label className="block text-xs font-black text-slate-800">
        เลือกใช้โควต้าส่งแจ้งเตือน LINE:
      </label>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2 pt-1">
        {eventItems.map(item => {
          const isChecked = selectedEvents.includes(item.id);
          return (
            <label
              key={item.id}
              className={`flex items-center gap-2 p-2 rounded-xl border text-xs font-bold cursor-pointer transition-all select-none ${
                isChecked
                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 shadow-3xs'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100/50'
              }`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggleEvent(item.id)}
                className="w-4 h-4 rounded text-[#06C755] focus:ring-[#06C755] accent-[#06C755] cursor-pointer"
              />
              <span>{item.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

export const LineQuotaBadge: React.FC<LineQuotaBadgeProps> = ({
  selectedCycle = '2026-07',
  className = '',
  hideIcon = false,
  hideLabelText = true
}) => {
  const [quotaInfo, setQuotaInfo] = useState<LineQuotaInfo>(() =>
    getLineQuotaInfo(selectedCycle)
  );
  const [isOpen, setIsOpen] = useState(false);

  const refreshQuota = () => {
    setQuotaInfo(getLineQuotaInfo(selectedCycle));
  };

  useEffect(() => {
    refreshQuota();

    const handleQuotaUpdate = () => {
      refreshQuota();
    };

    window.addEventListener('line_quota_updated', handleQuotaUpdate);
    window.addEventListener('storage', handleQuotaUpdate);
    return () => {
      window.removeEventListener('line_quota_updated', handleQuotaUpdate);
      window.removeEventListener('storage', handleQuotaUpdate);
    };
  }, [selectedCycle]);

  const usagePercent = Math.min(
    100,
    Math.round((quotaInfo.usedCount / quotaInfo.totalQuota) * 100)
  );
  const isWarning = quotaInfo.remainingQuota <= 50 && quotaInfo.remainingQuota > 0;
  const isExhausted = quotaInfo.remainingQuota === 0;

  return (
    <>
      {/* LINE Quota Counter Button */}
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className={`group relative inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full border bg-emerald-50/90 border-emerald-200/80 hover:bg-emerald-100/90 text-emerald-800 shadow-3xs transition-all cursor-pointer select-none active:scale-95 ${
          !hideIcon && isExhausted
            ? 'bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700'
            : !hideIcon && isWarning
            ? 'bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-800'
            : ''
        } ${className}`}
        title="คลิกเพื่อดูรายละเอียดโควต้า LINE"
      >
        {/* LINE Icon / Message Bubble with indicator */}
        {!hideIcon && (
          <div className="relative flex items-center justify-center shrink-0">
            <div className="w-4 h-4 rounded-full bg-[#06C755] text-white flex items-center justify-center font-bold shadow-2xs">
              <MessageSquare className="w-2.5 h-2.5 fill-white/20 text-white" />
            </div>
            <span
              className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full border border-white ${
                isExhausted
                  ? 'bg-rose-500 animate-ping'
                  : isWarning
                  ? 'bg-amber-500 animate-pulse'
                  : 'bg-emerald-500'
              }`}
            />
          </div>
        )}

        {/* Text Label & Counter */}
        <div className="flex items-center gap-1 text-xs shrink-0 whitespace-nowrap">
          {!hideLabelText && (
            <span className="font-bold tracking-tight text-slate-700 whitespace-nowrap">
              โควต้า LINE:
            </span>
          )}
          <span
            className={`font-black px-1.5 py-0.5 rounded-md leading-none whitespace-nowrap text-[10.5px] ${
              isExhausted
                ? 'bg-rose-600 text-white'
                : isWarning
                ? 'bg-amber-600 text-white'
                : 'bg-[#06C755] text-white'
            }`}
          >
            {quotaInfo.remainingQuota}/{quotaInfo.totalQuota}
          </span>
        </div>
      </button>

      {/* Details Modal / Popover when clicked */}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
          {/* Click outside to dismiss */}
          <div
            className="fixed inset-0 cursor-default"
            onClick={() => setIsOpen(false)}
          />

          {/* Modal Content Box */}
          <div className="relative w-full max-w-md bg-white rounded-3xl border border-slate-100 shadow-2xl overflow-hidden z-10 animate-in zoom-in-95 duration-200">
            {/* Header banner with LINE brand green */}
            <div className="bg-gradient-to-r from-[#06C755] to-emerald-600 p-5 text-white relative">
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-4 right-4 p-1.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-colors cursor-pointer"
                aria-label="ปิด"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/30">
                  <MessageSquare className="w-5 h-5 text-white fill-white/20" />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-tight text-white leading-tight">
                    โควต้าการส่งข้อความ LINE
                  </h3>
                  <span className="text-[11px] font-bold text-emerald-100 block mt-0.5">
                    รีเซ็ตอัตโนมัติ 300/300 ทุกวันที่ 1
                  </span>
                </div>
              </div>
            </div>

            {/* Content Body */}
            <div className="p-5 space-y-4">
              {/* Stat Progress Card */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">
                    โควต้าคงเหลือเดือนนี้
                  </span>
                  <span
                    className={`text-xs font-black px-2 py-0.5 rounded-full ${
                      isExhausted
                        ? 'bg-rose-100 text-rose-700'
                        : isWarning
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {quotaInfo.remainingQuota} / {quotaInfo.totalQuota} ครั้ง
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-2.5 bg-slate-200/80 rounded-full overflow-hidden p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isExhausted
                        ? 'bg-rose-500'
                        : isWarning
                        ? 'bg-amber-500'
                        : 'bg-[#06C755]'
                    }`}
                    style={{ width: `${Math.max(5, 100 - usagePercent)}%` }}
                  />
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold pt-1">
                  <span>ส่งไปแล้ว {quotaInfo.usedCount} ครั้ง</span>
                  <span>รีเซ็ตถัดไป: {quotaInfo.nextResetDate}</span>
                </div>
              </div>

              {/* Checkboxes for quota usage events */}
              <QuotaUsageEventSelector />

              {/* Concise Bullet Info */}
              <div className="space-y-2.5 text-xs text-slate-700">
                <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-rose-50/60 border border-rose-100/80">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-900 font-bold block mb-0.5">
                      ข้อควรระวังเมื่อโควต้าหมด
                    </strong>
                    <span className="text-slate-600 text-[11px] leading-relaxed">
                      ถ้าโควต้าหมด จะส่งข้อความแจ้งเตือนอัตโนมัติไปยัง LINE ไม่ได้ จนกว่าจะถึงวันรีเซ็ตประจำเดือน
                    </span>
                  </div>
                </div>
              </div>

              {/* Footer Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="w-full py-2.5 bg-[#06C755] hover:bg-emerald-600 text-white font-extrabold text-xs rounded-xl transition-colors shadow-md shadow-emerald-500/20 cursor-pointer text-center"
              >
                ตกลง เข้าใจแล้ว
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
