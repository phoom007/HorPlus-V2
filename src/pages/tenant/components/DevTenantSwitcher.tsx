/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Dev Tenant Quick Switcher (DEV ONLY)
 */

import React, { useState } from 'react';
import { Users, Shield, ArrowRightLeft, ExternalLink, X, Building2, UserPlus, Clock, Calendar, RotateCcw } from 'lucide-react';

interface DevTenantSwitcherProps {
  currentRoomNumber?: string;
  currentTenantName?: string;
  currentDormitoryId?: string;
  currentDormitoryName?: string;
}

export const DevTenantSwitcher: React.FC<DevTenantSwitcherProps> = ({
  currentRoomNumber,
  currentTenantName,
  currentDormitoryId,
  currentDormitoryName,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSimulatingPending, setIsSimulatingPending] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      return window.localStorage.getItem('dev_simulate_pending_registration') === 'true';
    }
    return false;
  });

  // Only render in development mode
  if (import.meta.env.PROD) {
    return null;
  }

  const CANONICAL_UAT_DORMITORY_ID = '20000001-0000-4000-8000-000000000002'; // หอพัก HorPlus UAT Comprehensive Manor

  const sampleProfiles = [
    { label: 'ห้อง 101 (มีบิลค้างชำระ)', room: '101', hint: 'ทดสอบยอดค้างชำระ & โอนจ่ายเงิน' },
    { label: 'ห้อง 105 (ผู้เช่าใหม่/ยังไม่มีบิล)', room: '105', hint: 'ทดสอบสถานะยังไม่มีบิล (ยอดเป็นศูนย์)' },
    { label: 'ห้อง 201 (ชำระเงินแล้ว)', room: '201', hint: 'ทดสอบสถานะชำระครบ & ดูใบเสร็จ' },
    { label: 'ห้อง 204 (รายเดือนหมดสัญญา)', room: '204', hint: 'ทดสอบสัญญาหมดอายุ & การขอต่อสัญญา/ย้ายออก' },
    { label: 'ห้อง 106 (ผู้พักรายวัน)', room: '106', hint: 'ทดสอบสถานะสัญญาและบิลพักรายวัน' },
    { label: 'ผู้เช่าคนล่าสุดในระบบ', room: '', hint: 'Auto-detect active lease' },
  ];

  const handleSwitchTenant = (roomNumber?: string) => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('tenant_selected_room_id');
    }
    const params = new URLSearchParams();
    if (roomNumber) params.set('roomNumber', roomNumber);
    const dormId = currentDormitoryId && currentDormitoryId !== 'undefined' && currentDormitoryId !== 'null'
      ? currentDormitoryId
      : CANONICAL_UAT_DORMITORY_ID;
    params.set('dormitoryId', dormId);
    params.set('redirect', '/tenant/dashboard');
    window.location.href = `/api/v1/auth/dev-tenant-login?${params.toString()}`;
  };

  const handleSwitchToRegistrationFlow = () => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('tenant_selected_room_id');
    }
    const dormId = currentDormitoryId && currentDormitoryId !== 'undefined' && currentDormitoryId !== 'null'
      ? currentDormitoryId
      : CANONICAL_UAT_DORMITORY_ID;
    const params = new URLSearchParams();
    params.set('mode', 'unregistered');
    params.set('dormitoryId', dormId);
    params.set('redirect', '/tenant/dashboard');
    window.location.href = `/api/v1/auth/dev-tenant-login?${params.toString()}`;
  };

  const handleToggleSimulatePending = (simulate: boolean) => {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      if (simulate) {
        window.localStorage.setItem('dev_simulate_pending_registration', 'true');
        setIsSimulatingPending(true);
      } else {
        window.localStorage.removeItem('dev_simulate_pending_registration');
        window.localStorage.removeItem('pending_tenant_registration');
        setIsSimulatingPending(false);
      }
      window.location.reload();
    }
  };

  const handleSwitchToOwner = () => {
    window.location.href = '/api/v1/auth/dev-login?redirect=/owner/home';
  };

  return (
    <>
      {/* Floating Toggle Pill */}
      <div className="fixed bottom-20 right-3 z-30">
        <button
          type="button"
          data-testid="dev-tenant-switcher-btn"
          onClick={() => setIsOpen(true)}
          className="bg-slate-900/90 hover:bg-slate-900 text-white p-2 sm:px-3 sm:py-1.5 rounded-full shadow-xl border border-slate-700/80 backdrop-blur-md flex items-center gap-1.5 text-[11px] font-black cursor-pointer transition-all hover:scale-105 active:scale-95 group"
          title="เครื่องมือสลับผู้เช่า / สลับกลับ Owner (Dev Tool)"
        >
          <span className={`w-2 h-2 rounded-full ${isSimulatingPending ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`} />
          <span className="hidden sm:inline">DEV SWITCHER</span>
          {isSimulatingPending && (
            <span className="text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-black">
              SIM PENDING
            </span>
          )}
          <ArrowRightLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-400 transition-colors" />
        </button>
      </div>

      {/* Popover / Bottom Sheet */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-100 p-5 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-900 text-xs">Tenant Dev Tooling</h4>
                  <p className="text-[10px] text-slate-400 font-medium">สลับบัญชีผู้เช่าเพื่อทดสอบ UI & Flows</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Current Active Context */}
            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/70 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">บัญชีปัจจุบัน</span>
                {currentDormitoryName && (
                  <span className="text-[9px] font-black text-indigo-700 bg-indigo-50 border border-indigo-100/80 px-2 py-0.5 rounded-full truncate max-w-[160px]">
                    🏢 {currentDormitoryName}
                  </span>
                )}
              </div>
              <p className="font-black text-slate-800 text-xs">
                {currentTenantName || 'ผู้เช่า'} {currentRoomNumber ? `(ห้อง ${currentRoomNumber})` : ''}
              </p>
            </div>

            {/* Registration Flow Simulator */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">โหมดลงทะเบียนผู้เช่า</span>
              <button
                type="button"
                data-testid="btn-dev-register-flow"
                onClick={handleSwitchToRegistrationFlow}
                className="w-full text-left p-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-100/60 transition-all flex items-center justify-between group cursor-pointer active:scale-98 shadow-3xs"
              >
                <div>
                  <span className="font-extrabold text-emerald-800 text-xs block group-hover:text-emerald-900">
                    ลงทะเบียนผู้เช่าใหม่ (Registration Flow)
                  </span>
                  <span className="text-[10px] text-emerald-600 block font-medium">
                    เข้าสู่หน้าหลักผู้เช่าใหม่ & กดปุ่มลงทะเบียน
                  </span>
                </div>
                <UserPlus className="w-4 h-4 text-emerald-500 group-hover:text-emerald-700 transition-colors shrink-0" />
              </button>

              {/* Pending Registration Simulation Toggle */}
              {isSimulatingPending ? (
                <div className="p-3 rounded-2xl border border-amber-200 bg-amber-50/70 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-amber-800 font-black text-xs">
                      <Clock className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
                      <span>กำลังจำลองสถานะ: รอตรวจสอบ</span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-amber-100 border border-amber-300 text-amber-900">
                      Active
                    </span>
                  </div>
                  <p className="text-[10px] text-amber-700 font-medium">
                    หน้า HomeTab แสดงสถานะ "รอเจ้าของหอพักตรวจสอบข้อมูล"
                  </p>
                  <button
                    type="button"
                    data-testid="btn-dev-reset-pending-sim"
                    onClick={() => handleToggleSimulatePending(false)}
                    className="w-full py-1.5 px-3 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer active:scale-98 shadow-3xs"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
                    <span>รีเซ็ตสถานะกลับปกติ</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="btn-dev-simulate-pending-btn"
                  onClick={() => handleToggleSimulatePending(true)}
                  className="w-full text-left p-3 rounded-2xl border border-amber-200 bg-amber-50/50 hover:bg-amber-100/60 transition-all flex items-center justify-between group cursor-pointer active:scale-98 shadow-3xs"
                >
                  <div>
                    <span className="font-extrabold text-amber-900 text-xs block group-hover:text-amber-950">
                      จำลองสถานะ: ส่งคำขอแล้ว (รอเจ้าของหอพักอนุมัติ)
                    </span>
                    <span className="text-[10px] text-amber-700 block font-medium">
                      แสดงสถานะ "รอเจ้าของหอพักตรวจสอบข้อมูล" บน HomeTab
                    </span>
                  </div>
                  <Clock className="w-4 h-4 text-amber-600 group-hover:text-amber-800 transition-colors shrink-0" />
                </button>
              )}
            </div>

            {/* Sample Profiles */}
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-400 font-bold block uppercase tracking-wider">เลือกผู้เช่าตัวอย่าง</span>
              {sampleProfiles.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSwitchTenant(p.room)}
                  className="w-full text-left p-3 rounded-2xl border border-slate-100 bg-white hover:bg-indigo-50/60 hover:border-indigo-100 transition-all flex items-center justify-between group cursor-pointer active:scale-98 shadow-3xs"
                >
                  <div>
                    <span className="font-extrabold text-slate-800 text-xs block group-hover:text-indigo-600">
                      {p.label}
                    </span>
                    <span className="text-[10px] text-slate-400 block font-medium">
                      {p.hint}
                    </span>
                  </div>
                  <Building2 className="w-4 h-4 text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                </button>
              ))}
            </div>

            {/* Switch back to Owner */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleSwitchToOwner}
                className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white font-extrabold rounded-2xl text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-xs"
              >
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span>สลับกลับฝั่งเจ้าของหอพัก (Owner Home)</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
