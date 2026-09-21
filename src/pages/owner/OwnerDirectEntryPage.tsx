/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { cleanLiffStateFromUrl, isTicketConsumed, markTicketConsumed } from '../../utils/liffToken';

export const OwnerDirectEntryPage: React.FC = () => {
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    let ticket = urlParams.get('ticket');

    // Also check liff.state if passed through LIFF redirect
    if (!ticket) {
      const liffState = urlParams.get('liff.state');
      if (liffState) {
        try {
          const decoded = decodeURIComponent(liffState);
          const match = decoded.match(/(?:[?&])ticket=([^&#]+)/i);
          if (match && match[1]) {
            ticket = match[1];
          }
        } catch {}
      }
    }

    cleanLiffStateFromUrl();

    if (ticket) {
      const raw = ticket.trim();
      if (!isTicketConsumed(raw)) {
        markTicketConsumed(raw);
        window.location.replace(`/api/v1/auth/line-direct-entry?ticket=${encodeURIComponent(raw)}`);
        return;
      }
    }
    window.location.replace('/owner/home');
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-700 px-4">
      <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
      <p className="font-semibold text-slate-800 text-base">กำลังเข้าสู่ระบบจัดการหอพัก...</p>
      <p className="text-slate-500 text-xs mt-1 text-center">กรุณารอสักครู่ ระบบกำลังยืนยันสิทธิ์ความปลอดภัย</p>
    </div>
  );
};

export default OwnerDirectEntryPage;
