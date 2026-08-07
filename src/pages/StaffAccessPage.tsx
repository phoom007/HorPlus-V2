/**
 * Staff Access Token Redemption Page (/staff-access#<RAW_TOKEN>)
 * Reads bearer token from hash fragment, removes hash from location bar immediately,
 * redeems token via POST /api/v1/staff-access/redeem with credentials: 'include',
 * and redirects to workspace on success or shows error state.
 * @license Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Loader2, ArrowRight } from 'lucide-react';
import { Task009ApiAdapter } from '../data/adapters/task009';

export const StaffAccessPage: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    let rawToken: string | null = null;

    // 1. Read raw token from window.location.hash
    if (window.location.hash && window.location.hash.length > 1) {
      rawToken = window.location.hash.substring(1);
    }

    // 2. Immediately remove hash fragment from location bar for security
    if (window.location.hash) {
      window.history.replaceState(
        null,
        document.title,
        window.location.pathname + window.location.search
      );
    }

    if (!rawToken) {
      setStatus('error');
      setErrorMessage('ไม่พบข้อมูล Token ยืนยันตัวตนในลิงก์ (Token Missing)');
      return;
    }

    // 3. Redeem raw bearer token via POST /api/v1/staff-access/redeem
    Task009ApiAdapter.redeemStaffAccess(rawToken)
      .then((res) => {
        // Clear in-memory token reference immediately
        rawToken = null;

        if (res.success && res.data) {
          setStatus('success');
          // Save active dormitory ID for session
          if (res.data.dormitoryId) {
            sessionStorage.setItem('active_dormitory_selected_for_session', res.data.dormitoryId);
            localStorage.setItem('selected_dormitory_id', res.data.dormitoryId);
          }
          // Brief pause then navigate into workspace
          setTimeout(() => {
            navigate('/owner/dashboard', { replace: true });
          }, 800);
        } else {
          setStatus('error');
          const serverMsg = res.error?.message || 'ลิงก์เข้าใช้งานนี้ไม่ถูกต้อง หรือสิทธิ์ถูกยกเลิกแล้ว';
          setErrorMessage(serverMsg);
        }
      })
      .catch((err) => {
        rawToken = null;
        setStatus('error');
        setErrorMessage(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
      });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-8 shadow-2xl text-center">
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <Loader2 className="w-12 h-12 text-indigo-400 animate-spin" />
            <h2 className="text-xl font-bold text-white">กำลังยืนยันสิทธิ์เข้าใช้งาน...</h2>
            <p className="text-sm text-slate-400">กรุณารอสักครู่ ระบบกำลังตรวจสอบ Access Token ของคุณ</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <div className="w-16 h-16 bg-emerald-500/20 border border-emerald-500/30 rounded-full flex items-center justify-center">
              <ShieldCheck className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">เข้าสู่ระบบสำเร็จ!</h2>
            <p className="text-sm text-slate-300">ยืนยันสิทธิ์เจ้าหน้าที่สำเร็จ กำลังนำคุณไปยังพื้นที่ทำงาน...</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center justify-center space-y-4 py-6">
            <div className="w-16 h-16 bg-rose-500/20 border border-rose-500/30 rounded-full flex items-center justify-center">
              <ShieldAlert className="w-10 h-10 text-rose-400" />
            </div>
            <h2 className="text-xl font-bold text-white">ไม่สามารถยืนยันสิทธิ์ได้</h2>
            <p className="text-sm text-rose-300 font-medium bg-rose-950/50 border border-rose-800/50 rounded-lg p-3 w-full">
              {errorMessage}
            </p>
            <p className="text-xs text-slate-400">
              หากคุณคิดว่านี่คือข้อผิดพลาด กรุณาติดต่อเจ้าของหอพักเพื่อขอรับลิงก์สิทธิ์ใหม่
            </p>
            <button
              onClick={() => navigate('/auth/owner')}
              className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium transition-colors"
            >
              <span>กลับไปยังหน้าเข้าสู่ระบบ</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
