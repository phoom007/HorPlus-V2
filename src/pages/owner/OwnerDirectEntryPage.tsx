/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { cleanLiffStateFromUrl, isTicketConsumed, markTicketConsumed } from '../../utils/liffToken';

export const OwnerDirectEntryPage: React.FC = () => {
  const [errorState, setErrorState] = useState<string | null>(null);

  useEffect(() => {
    // 1. Search in both search and hash for ticket or liff.state
    const searchSources = [window.location.search, window.location.hash];
    let ticket: string | null = null;

    for (const src of searchSources) {
      if (!src) continue;
      const cleanSrc = src.startsWith('?') || src.startsWith('#') ? src.slice(1) : src;
      const params = new URLSearchParams(cleanSrc.includes('?') ? cleanSrc.split('?')[1] : cleanSrc);

      const directTicket = params.get('ticket');
      if (directTicket && directTicket.trim()) {
        ticket = directTicket.trim();
        break;
      }

      // Check liff.state with multi-layer decode
      const liffState = params.get('liff.state');
      if (liffState) {
        try {
          let decoded = decodeURIComponent(liffState);
          if (decoded.includes('%')) {
            try { decoded = decodeURIComponent(decoded); } catch {}
          }
          const match = decoded.match(/(?:[?&])ticket=([^&#]+)/i);
          if (match && match[1]) {
            ticket = match[1].trim();
            break;
          }
        } catch {}
      }
    }

    if (ticket) {
      const raw = ticket.trim();
      if (!isTicketConsumed(raw)) {
        markTicketConsumed(raw);
        cleanLiffStateFromUrl();
        window.location.replace(`/api/v1/auth/line-direct-entry?ticket=${encodeURIComponent(raw)}`);
        return;
      }
    }

    cleanLiffStateFromUrl();

    // Fallback: If no ticket or already consumed, navigate to owner home
    const timer = setTimeout(() => {
      window.location.replace('/owner/home');
    }, 1200);

    // Timeout fallback: if still hanging after 4 seconds, show manual button
    const fallbackTimer = setTimeout(() => {
      setErrorState('การเชื่อมต่อใช้เวลานานกว่าปกติ');
    }, 4000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-700 px-4">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="font-semibold text-slate-800 text-base">กำลังเข้าสู่ระบบจัดการหอพัก...</p>
      <p className="text-slate-500 text-xs mt-1 text-center">กรุณารอสักครู่ ระบบกำลังยืนยันสิทธิ์ความปลอดภัย</p>
      {errorState && (
        <div className="mt-6 flex flex-col items-center animate-fade-in">
          <p className="text-amber-600 text-xs mb-3 font-medium">{errorState}</p>
          <button
            onClick={() => window.location.replace('/owner/home')}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
          >
            ไปที่หน้าจัดการหอพัก
          </button>
        </div>
      )}
    </div>
  );
};

export default OwnerDirectEntryPage;
