/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Info, Sparkles } from 'lucide-react';

interface DemoDisclosureBannerProps {
  message?: string;
  compact?: boolean;
}

export const DemoDisclosureBanner: React.FC<DemoDisclosureBannerProps> = ({
  message = 'ระบบสาธิตการใช้งาน (Demo Mode) — ข้อมูลและระบบจำลองเพื่อการทดสอบในเบราว์เซอร์เท่านั้น ไม่มีการเรียกเก็บเงินจริง',
  compact = false
}) => {
  if (compact) {
    return (
      <div className="bg-amber-500/10 border-b border-amber-500/20 py-1.5 px-4 text-center">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-[11px] font-semibold text-amber-700">
          <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>{message}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-amber-50 via-amber-100/70 to-orange-50 border-y border-amber-200/80 py-2.5 px-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 text-xs text-amber-900 font-medium">
        <div className="flex items-center gap-2">
          <span className="bg-amber-600 text-white font-black text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 shadow-xs">
            DEMO
          </span>
          <span className="leading-tight">{message}</span>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-amber-800 font-bold bg-white/80 px-2.5 py-1 rounded-lg border border-amber-200/60 shadow-2xs shrink-0">
          <Info className="w-3.5 h-3.5 text-amber-600" />
          <span>จำลองระบบไร้ Backend</span>
        </div>
      </div>
    </div>
  );
};
