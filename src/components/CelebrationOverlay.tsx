/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef } from 'react';
import {
  Sparkles,
  Crown,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Building,
  Zap,
  Check,
  X,
  Receipt
} from 'lucide-react';

export interface CelebrationOverlayProps {
  isOpen: boolean;
  planName?: string;
  durationMonths?: number;
  daysAdded: number;
  paidAmount: number;
  previousDaysLeft?: number;
  newDaysLeft?: number;
  previousExpiryDate?: string;
  newExpiryDate: string;
  orderId?: string;
  receiptNumber?: string;
  onComplete: () => void;
}

export const CelebrationOverlay: React.FC<CelebrationOverlayProps> = ({
  isOpen,
  planName = 'HORPLUS PRO',
  durationMonths = 12,
  daysAdded,
  paidAmount,
  previousDaysLeft = 0,
  newDaysLeft,
  previousExpiryDate,
  newExpiryDate,
  orderId,
  receiptNumber,
  onComplete,
}) => {
  const [displayDays, setDisplayDays] = useState(previousDaysLeft);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const targetDays = newDaysLeft !== undefined ? newDaysLeft : previousDaysLeft + daysAdded;

  // Confetti Particle Animation on Canvas
  useEffect(() => {
    if (!isOpen) return;

    // Reset display days and animate counting up
    setDisplayDays(previousDaysLeft);
    const startDays = previousDaysLeft;
    const endDays = targetDays;
    const diff = endDays - startDays;
    const duration = 1200; // 1.2s
    const startTime = performance.now();

    const timer = setInterval(() => {
      const now = performance.now();
      const progress = Math.min(1, (now - startTime) / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startDays + diff * eased);
      setDisplayDays(current);

      if (progress >= 1) {
        clearInterval(timer);
      }
    }, 16);

    // Canvas Confetti
    const canvas = canvasRef.current;
    if (!canvas) return () => clearInterval(timer);

    const ctx = canvas.getContext('2d');
    if (!ctx) return () => clearInterval(timer);

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444', '#ffd700'];
    const particles: Array<{
      x: number;
      y: number;
      r: number;
      d: number;
      color: string;
      tilt: number;
      tiltAngleIncremental: number;
      tiltAngle: number;
      vx: number;
      vy: number;
    }> = [];

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height * 0.4,
        r: Math.random() * 6 + 4,
        d: Math.random() * 90 + 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleIncremental: Math.random() * 0.07 + 0.05,
        tiltAngle: 0,
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 3 + 2,
      });
    }

    let animationFrameId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      particles.forEach((p) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(p.d) + 1 + p.r / 2) / 1.5 + p.vy * 0.5;
        p.x += Math.sin(p.tiltAngle) * 1.5 + p.vx * 0.5;
        p.tilt = Math.sin(p.tiltAngle - p.r / 2) * 12;

        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();

        // Recycle particles
        if (p.y > canvas.height) {
          p.x = Math.random() * canvas.width;
          p.y = -20;
        }
      });

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    const handleResize = () => {
      if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      clearInterval(timer);
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen, previousDaysLeft, targetDays]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Background Canvas for Confetti */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-10"
      />

      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onComplete}
      />

      {/* Celebration Card Dialog */}
      <div className="relative z-20 w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-amber-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Top Decorative Gradient Banner */}
        <div className="bg-gradient-to-r from-amber-500 via-emerald-600 to-teal-600 px-6 pt-6 pb-8 text-white relative">
          <button
            onClick={onComplete}
            className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white transition-colors"
            title="ปิด"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center shadow-inner">
              <Crown className="w-7 h-7 text-amber-200 fill-amber-300" />
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-xs font-semibold tracking-wide">
                <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                <span>อัปเกรดสำเร็จเรียบร้อย</span>
              </div>
              <h2 className="text-xl font-bold text-white mt-1">
                ยินดีด้วย! คุณเปิดใช้งาน {planName}
              </h2>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 -mt-4 bg-white rounded-t-2xl space-y-5">
          {/* Visual Before & After Days Transformation Box */}
          <div className="bg-gradient-to-br from-amber-50/80 via-emerald-50/60 to-slate-50 border border-amber-200/80 rounded-xl p-4 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>การเปลี่ยนแปลงวันใช้งาน</span>
              <span className="text-emerald-600 font-bold bg-emerald-100/80 px-2 py-0.5 rounded-md text-xs">
                +{daysAdded} วัน
              </span>
            </div>

            <div className="flex items-center justify-between gap-3">
              {/* Previous Days */}
              <div className="flex-1 bg-white/90 rounded-lg p-3 border border-slate-200 text-center shadow-xs">
                <div className="text-xs text-slate-400 font-medium">เดิมคงเหลือ</div>
                <div className="text-2xl font-bold text-slate-600 mt-0.5">
                  {previousDaysLeft} <span className="text-xs font-normal text-slate-400">วัน</span>
                </div>
              </div>

              {/* Animated Arrow */}
              <div className="flex flex-col items-center justify-center px-1">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                  <ArrowRight className="w-4 h-4 animate-pulse" />
                </div>
              </div>

              {/* New Days (Animated Counter) */}
              <div className="flex-1 bg-white/90 rounded-lg p-3 border border-emerald-300 text-center shadow-xs ring-2 ring-emerald-400/20">
                <div className="text-xs text-emerald-600 font-semibold">กลายเป็น</div>
                <div className="text-3xl font-extrabold text-emerald-600 mt-0.5">
                  {displayDays} <span className="text-xs font-normal text-emerald-600">วัน</span>
                </div>
              </div>
            </div>

            {/* Expiry Date Transformation */}
            <div className="mt-3 pt-3 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
              <span className="text-slate-400">วันหมดอายุใหม่:</span>
              <span className="font-bold text-slate-800 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-2xs">
                📅 {newExpiryDate}
              </span>
            </div>
          </div>

          {/* Unlocked Entitlements Highlights */}
          <div className="space-y-2.5">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              สิทธิพิเศษที่คุณได้รับทันที
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="w-7 h-7 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <Building className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-slate-800">รองรับ 150 ห้องพัก</span>
                  <span className="text-xs text-slate-500 ml-1.5">(ขยายจาก 10 ห้องแรก)</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>

              <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-slate-800">ตรวจสลิปอัตโนมัติ ไม่จำกัด</span>
                  <span className="text-xs text-slate-500 ml-1.5">(ตรวจจับสลิปปลอม/ซ้ำ)</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>

              <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                <div className="w-7 h-7 rounded-md bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <span className="font-semibold text-slate-800">LINE แจ้งเตือน 300 ครั้ง/เดือน</span>
                  <span className="text-xs text-slate-500 ml-1.5">(ส่งบิลและใบเสร็จ)</span>
                </div>
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              </div>
            </div>
          </div>

          {/* Receipt Info / Order Trail */}
          {(receiptNumber || orderId) && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 text-xs text-slate-500 border border-slate-200/60">
              <div className="flex items-center gap-1.5">
                <Receipt className="w-3.5 h-3.5 text-slate-400" />
                <span>เลขที่ใบเสร็จ: <strong className="text-slate-700">{receiptNumber || orderId}</strong></span>
              </div>
              <div>
                <span>ยอดชำระ: <strong className="text-emerald-600">฿{paidAmount.toLocaleString()}</strong></span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2">
            <button
              onClick={onComplete}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-base shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Check className="w-5 h-5" />
              <span>ยืนยันและกลับสู่หน้ารายการ</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
