/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Building,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  XCircle,
  HelpCircle
} from 'lucide-react';
const setTenantDemoSession = (_t?: any) => {};
const initialTenants: any[] = [{ id: 'tenant-02', name: 'ผู้เช่าตัวอย่าง' }];
const initialDormitory = { name: 'หอพัก HorPlus' };
const getRooms = () => [{ roomNumber: '101', currentTenantId: 'tenant-02' }];
import { Tenant } from '../../types';
import { DemoDisclosureBanner } from '../../components/public/DemoDisclosureBanner';

interface TenantInvitePageProps {
  onLoginSuccess?: (tenant: Tenant) => void;
}

export const TenantInvitePage: React.FC<TenantInvitePageProps> = ({ onLoginSuccess }) => {
  const { token } = useParams<{ token?: string }>();
  const navigate = useNavigate();
  const [isActivating, setIsActivating] = useState(false);

  const cleanToken = (token || '').toLowerCase().trim();

  // Find demo tenant for valid token
  const demoTenant = initialTenants.find(t => t.id === 'tenant-02') || initialTenants[0];
  const rooms = getRooms();
  const demoRoom = rooms.find(r => r.currentTenantId === demoTenant.id) || rooms[0];

  const handleActivateValidInvite = () => {
    setIsActivating(true);
    setTimeout(() => {
      setTenantDemoSession(demoTenant);
      if (onLoginSuccess) onLoginSuccess(demoTenant);
      setIsActivating(false);
      navigate('/tenant/dashboard');
    }, 500);
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      <DemoDisclosureBanner />

      <div className="p-4">
        <Link
          to="/demo"
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white font-bold bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700/60 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>กลับสู่หน้า Demo Portal</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        {/* CASE 1: VALID TOKEN */}
        {(cleanToken === 'invite-valid' || (cleanToken && !['invite-expired', 'invite-used', 'invite-invalid'].includes(cleanToken))) && (
          <div className="bg-slate-800 border border-slate-700/80 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
                <ShieldCheck className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-white">ยืนยันคำเชิญเข้าสู่ระบบผู้เช่า</h2>
              <p className="text-xs text-slate-400">
                เจ้าของหอพักได้ส่งคำเชิญให้คุณเข้าใช้งาน Tenant Mobile Portal
              </p>
            </div>

            <div className="bg-slate-900/80 border border-slate-700/80 p-4 rounded-2xl space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">หอพัก:</span>
                <span className="font-bold text-white">{initialDormitory.name}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">ห้องพัก:</span>
                <span className="font-bold text-emerald-400 text-sm">ห้อง {demoRoom.roomNumber}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-slate-400">ชื่อผู้เช่า:</span>
                <span className="font-bold text-white">{demoTenant.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">สถานะโทเค็น:</span>
                <span className="font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                  Valid Token
                </span>
              </div>
            </div>

            <button
              onClick={handleActivateValidInvite}
              disabled={isActivating}
              className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
            >
              <UserCheck className="w-4 h-4 text-emerald-100" />
              <span>{isActivating ? 'กำลังเปิดใช้งานเซสชัน...' : 'ยืนยันตัวตนด้วย Google (Demo)'}</span>
            </button>

            <p className="text-[10px] text-center text-slate-500">
              เมื่อกดยืนยัน ระบบจะเชื่อมต่อสิทธิ์ผู้เช่าห้อง {demoRoom.roomNumber} เข้าสู่พอร์ทัลทันที
            </p>
          </div>
        )}

        {/* CASE 2: EXPIRED TOKEN */}
        {cleanToken === 'invite-expired' && (
          <div className="bg-slate-800 border border-slate-700/80 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-6 shadow-2xl text-center animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center mx-auto shadow-inner">
              <Clock className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-white">คำเชิญนี้หมดอายุการใช้งานแล้ว</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                ขออภัย ลิงก์หรือรหัสคำเชิญนี้เกินกำหนดระยะเวลา 7 วันที่กำหนด โปรดติดต่อเจ้าของหอพักเพื่อขอรับลิงก์คำเชิญใหม่อีกครั้ง
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Link
                to="/demo"
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all"
              >
                กลับสู่หน้า Demo Portal
              </Link>
            </div>
          </div>
        )}

        {/* CASE 3: USED TOKEN */}
        {cleanToken === 'invite-used' && (
          <div className="bg-slate-800 border border-slate-700/80 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-6 shadow-2xl text-center animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-white">คำเชิญนี้ถูกเปิดใช้งานเรียบร้อยแล้ว</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                รหัสคำเชิญนี้ได้รับการยืนยันตัวตนผูกเข้ากับบัญชีผู้เช่าในระบบแล้ว คุณสามารถเข้าสู่พอร์ทัลได้ทันที
              </p>
            </div>

            <div className="pt-2">
              <button
                onClick={handleActivateValidInvite}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span>เข้าสู่ Tenant Mobile Portal</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* CASE 4: INVALID TOKEN */}
        {cleanToken === 'invite-invalid' && (
          <div className="bg-slate-800 border border-slate-700/80 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-6 shadow-2xl text-center animate-in zoom-in-95">
            <div className="w-14 h-14 rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center mx-auto shadow-inner">
              <XCircle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-black text-white">ไม่พบข้อมูลรหัสคำเชิญ</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                รหัสโทเค็นคำเชิญไม่ถูกต้อง หรือไม่มีอยู่ในระบบ โปรดตรวจสอบตัวอักษรในลิงก์ หรือติดต่อเจ้าของหอพัก
              </p>
            </div>

            <div className="pt-2">
              <Link
                to="/demo"
                className="w-full py-3 block bg-slate-700 hover:bg-slate-600 text-white font-bold text-xs rounded-xl transition-all"
              >
                กลับสู่หน้า Demo Portal
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
