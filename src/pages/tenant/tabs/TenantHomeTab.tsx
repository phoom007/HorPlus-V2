/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Tab 1: Home (Mobile-First Dashboard)
 */

import React from 'react';
import {
  Building as BuildingIcon,
  Bell,
  AlertCircle,
  CreditCard,
  UserCheck,
  FileText,
  Wrench,
  Zap,
  FileCheck2,
  History,
  QrCode,
  Megaphone,
  Pin,
  Droplet,
  Shield,
  Sparkles,
  CheckCircle2,
  LogOut,
  ChevronDown,
  ChevronRight,
  Clock,
  Edit3
} from 'lucide-react';
import { Tenant, Bill, Announcement } from '../../../types';
import { getThaiGreeting, formatToBeDate, formatToBeFullDate, getAuthorRoleName } from '../tenantHelpers';
import { formatThaiDate } from '../../../components/GlobalComponents';
import { TenantDailyRequestModal } from '../../../components/TenantDailyRequestModal';

export interface TenantHomeTabProps {
  localTenant: Tenant;
  tenantRoom: any;
  hasRoom: boolean;
  financialLoading: boolean;
  financialError: string | null;
  activeUnpaidBill: Bill | null;
  totalUnpaidAmount?: number;
  allUnpaidBills?: Bill[];
  totalNotificationsCount: number;
  notices: any[];
  announcements: Announcement[];
  utilitiesData?: any;
  dormitoryName?: string;
  onOpenRoomSwitcher: () => void;
  onOpenNotifications: () => void;
  onOpenInvoice: (tab?: 'current' | 'history') => void;
  onOpenPayment: () => void;
  onOpenRepairs: () => void;
  onOpenUtilities: () => void;
  onOpenContract: () => void;
  onOpenMoveOut: () => void;
  onOpenRenewal: () => void;
  onGoToAnnouncements: () => void;
  onStartRegister: () => void;
  onRefresh: () => void;
  onZoomImage?: (url: string) => void;
  activeContract?: any;
}

export const TenantHomeTab: React.FC<TenantHomeTabProps> = ({
  localTenant,
  tenantRoom,
  hasRoom,
  financialLoading,
  financialError,
  activeUnpaidBill,
  totalUnpaidAmount,
  allUnpaidBills,
  totalNotificationsCount,
  notices = [],
  announcements = [],
  utilitiesData,
  dormitoryName,
  onOpenRoomSwitcher,
  onOpenNotifications,
  onOpenInvoice,
  onOpenPayment,
  onOpenRepairs,
  onOpenUtilities,
  onOpenContract,
  onOpenMoveOut,
  onOpenRenewal,
  onGoToAnnouncements,
  onStartRegister,
  onRefresh,
  onZoomImage,
  activeContract,
}) => {
  const effectiveContract = activeContract || (localTenant as any)?.activeContract || (localTenant as any)?.contracts?.[0];
  const isContractExpired = Boolean(
    hasRoom &&
    effectiveContract &&
    (
      effectiveContract.status === 'expired' ||
      (effectiveContract.endDate && new Date(effectiveContract.endDate).getTime() < new Date().getTime())
    )
  );
  const filteredAnnouncements = announcements || [];
  const [isDailyStayModalOpen, setIsDailyStayModalOpen] = React.useState(false);

  const effectivePrefix = (localTenant as any)?.prefix === 'ระบุเอง' || (localTenant as any)?.prefix === 'กำหนดเอง'
    ? ((localTenant as any)?.customPrefix || (localTenant as any)?.prefix || '')
    : ((localTenant as any)?.prefix || '');

  const registeredFullName = (localTenant.firstName && localTenant.firstName !== '-')
    ? `${localTenant.firstName} ${localTenant.lastName && localTenant.lastName !== '-' ? localTenant.lastName : ''}`.trim()
    : '';

  const isPending =
    (localTenant as any)?.status === 'pending_owner_approval' ||
    (localTenant as any)?.pendingRequest?.status === 'pending_owner_approval';
  const isAwaiting =
    (localTenant as any)?.status === 'awaiting_tenant_confirmation' ||
    (localTenant as any)?.pendingRequest?.status === 'awaiting_tenant_confirmation';
  const isRejected =
    (localTenant as any)?.status === 'rejected' ||
    (localTenant as any)?.pendingRequest?.status === 'rejected';

  let rawName =
    registeredFullName ||
    (localTenant.displayName !== 'ยังไม่ได้ลงทะเบียน' ? localTenant.displayName : null) ||
    localTenant.lineDisplayName ||
    (localTenant.name !== 'ยังไม่ได้ลงทะเบียน' ? localTenant.name : null) ||
    'ผู้เช่า';

  if (rawName.startsWith('คุณ ')) {
    rawName = rawName.slice(4).trim();
  }

  const isUnregistered =
    !hasRoom &&
    !isPending &&
    !isAwaiting &&
    !isRejected &&
    ((localTenant as any)?.status === 'unregistered' || !(localTenant as any)?.status || rawName === 'ยังไม่ได้ลงทะเบียน');
  let greetingName = 'ผู้เช่า';
  if (isUnregistered) {
    greetingName = 'ยังไม่ได้ลงทะเบียน';
  } else if (effectivePrefix) {
    greetingName = rawName.startsWith(effectivePrefix) ? rawName : `${effectivePrefix} ${rawName}`;
  } else if (/^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)(?:\s+|$)/i.test(rawName)) {
    greetingName = rawName;
  } else if (localTenant.displayName && localTenant.displayName !== localTenant.name) {
    greetingName = localTenant.displayName;
  } else {
    greetingName = rawName.startsWith('คุณ') ? rawName : `คุณ ${rawName}`;
  }

  return (
    <div className="space-y-5 pb-6 animate-in fade-in duration-200">
      {/* 1. Visual Indigo-Blue Gradient Hero Banner */}
      <div className="bg-gradient-to-br from-indigo-600 via-blue-600 to-indigo-700 text-white rounded-b-[32px] pt-7 pb-20 px-5 flex flex-col justify-between relative shadow-md">
        <div className="flex justify-between items-start">
          <div>
            <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-100 opacity-90 block">
              {dormitoryName || tenantRoom?.dormitoryName || 'หอพัก HorPlus'}
            </span>
            <h3 className="text-base font-black mt-0.5 tracking-tight text-white">
              {greetingName}
            </h3>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                data-testid="tenant-room-switcher-btn"
                onClick={onOpenRoomSwitcher}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white/20 hover:bg-white/30 active:scale-95 transition-all rounded-full text-[11px] text-white font-extrabold border border-white/25 backdrop-blur-md shadow-xs cursor-pointer"
                title="คลิกเพื่อสลับห้องพัก หรือเช่าห้องพักเพิ่ม"
              >
                <BuildingIcon className="w-3.5 h-3.5 text-indigo-200 shrink-0" />
                <span>
                  {financialLoading
                    ? 'กำลังโหลดข้อมูล...'
                    : hasRoom
                      ? `ห้อง ${tenantRoom?.roomNumber} • ${tenantRoom?.buildingName || 'อาคารหลัก'}`
                      : 'ยังไม่มีห้องพัก'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-white/80 shrink-0" />
              </button>
            </div>
          </div>

          {/* Notification bell badge */}
          <button
            type="button"
            data-testid="tenant-notification-bell-btn"
            onClick={onOpenNotifications}
            className="relative p-2.5 bg-white/15 hover:bg-white/25 active:scale-95 transition-all rounded-2xl text-white shrink-0 cursor-pointer border border-white/20 backdrop-blur-md shadow-xs"
            aria-label="การแจ้งเตือน"
          >
            <Bell className="w-4 h-4 stroke-[2.2]" />
            {totalNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-4.5 px-1 bg-rose-500 rounded-full border-2 border-indigo-700 text-[9px] text-white flex items-center justify-center font-black animate-pulse shadow-sm">
                {totalNotificationsCount > 99 ? '99+' : totalNotificationsCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/*
        # CRITICAL ARCHITECTURAL DESIGN RULE:
        # DO NOT render notification/announcement banners inside HomeTab above the hero card!
        # Any banner placed here shifts the floating hero card (mt-[-60px]) and pushes down
        # all subsequent navigation menus and bills, breaking the mobile UI layout (Layout Shift).
        # All notifications and notices MUST remain exclusively inside the Notification Center
        # modal accessible via the top-right bell button (totalNotificationsCount).
      */}

      {/* 3. Floating Overlapping Hero Card */}
      <div className="mt-[-60px] mx-4 bg-white rounded-3xl p-5 border border-slate-100 shadow-xl flex flex-col gap-3 relative z-10 transition-all">
        {financialLoading ? (
          <div className="space-y-3 pt-0.5 animate-pulse">
            <div className="h-4 bg-slate-200 rounded w-1/3" />
            <div className="h-8 bg-slate-200 rounded w-1/2" />
            <div className="h-3 bg-slate-200 rounded w-2/3" />
          </div>
        ) : (() => {
          const isSimulatingPending = Boolean(
            typeof window !== 'undefined' &&
            typeof window.localStorage !== 'undefined' &&
            window.localStorage?.getItem?.('dev_simulate_pending_registration') === 'true'
          );

          if (hasRoom && !isSimulatingPending) {
            const hasUnpaid = Boolean(activeUnpaidBill || (allUnpaidBills && allUnpaidBills.length > 0));
            const displayUnpaidAmount = totalUnpaidAmount !== undefined
              ? totalUnpaidAmount
              : (activeUnpaidBill ? Number(activeUnpaidBill.totalAmount || 0) : 0);

            return hasUnpaid && activeUnpaidBill ? (
              /* Mode A: ยอดค้างชำระ (Unpaid Bill Hero Card) */
              <div className="space-y-3 pt-0.5 animate-in fade-in duration-200" data-testid="tenant-unpaid-card">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-amber-700 font-black text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-500 stroke-[2.5]" />
                      <span>ยอดค้างชำระ{allUnpaidBills && allUnpaidBills.length > 1 ? ` (${allUnpaidBills.length} รายการ)` : ''}</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none pt-1" data-testid="tenant-unpaid-amount">
                      ฿ {displayUnpaidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h2>
                    <p className="text-[11px] sm:text-xs text-slate-500 font-bold pt-1">
                      กำหนดชำระภายใน: <span className="font-black text-slate-700">{formatToBeDate(activeUnpaidBill.dueDate)}</span>
                    </p>
                    {financialError && (
                      <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-700 flex items-center justify-between mt-2">
                        <span>{financialError}</span>
                        <button
                          type="button"
                          onClick={onRefresh}
                          className="px-2.5 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 text-[10px]"
                        >
                          ลองใหม่
                        </button>
                      </div>
                    )}
                    {(() => {
                      const paymentsList = activeUnpaidBill.payments || (activeUnpaidBill as any).Payment || [];
                      const isChecking = paymentsList.some((p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking') || activeUnpaidBill.status === 'checking';
                      if (isChecking) return null;
                      const rejectedPay = paymentsList.find((p: any) => p.status === 'REJECTED');
                      if (!rejectedPay) return null;
                      return (
                        <div className="bg-rose-50 border border-rose-200 rounded-xl p-2.5 text-xs text-rose-800 font-bold flex flex-col gap-1 mt-2">
                          <div className="flex items-center gap-1.5 text-rose-700">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 stroke-[2]" />
                            <span>สลิปถูกปฏิเสธ: {rejectedPay.rejectedReason || (rejectedPay as any).rejectionReason || 'สลิปไม่ชัดเจน กรุณาแนบภาพใหม่'}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  {(() => {
                    const paymentsList = activeUnpaidBill.payments || (activeUnpaidBill as any).Payment || [];
                    const isChecking = paymentsList.some((p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking') || activeUnpaidBill.status === 'checking';
                    const isRejected = !isChecking && (paymentsList.some((p: any) => p.status === 'REJECTED') || activeUnpaidBill.status === 'rejected');

                    if (isChecking) {
                      return (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black bg-indigo-50 border border-indigo-200 text-indigo-700 shrink-0 shadow-3xs animate-pulse">
                          รอตรวจสอบ
                        </span>
                      );
                    }
                    if (isRejected) {
                      return (
                        <span className="px-3 py-1 rounded-full text-[10px] font-black bg-rose-50 border border-rose-200 text-rose-700 shrink-0 shadow-3xs">
                          ปฏิเสธสลิป
                        </span>
                      );
                    }
                    return (
                      <span className="px-3 py-1 rounded-full text-[10px] font-black bg-amber-50 border border-amber-200 text-amber-800 shrink-0 shadow-3xs">
                        รอชำระ
                      </span>
                    );
                  })()}
                </div>

                <div className="pt-1">
                  {(() => {
                    const paymentsList = activeUnpaidBill.payments || (activeUnpaidBill as any).Payment || [];
                    const isChecking = paymentsList.some((p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking') || activeUnpaidBill.status === 'checking';
                    const isRejected = !isChecking && (paymentsList.some((p: any) => p.status === 'REJECTED') || activeUnpaidBill.status === 'rejected');

                    if (isChecking) {
                      return (
                        <div
                          data-testid="tenant-checking-banner"
                          className="w-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-extrabold py-3 px-4 rounded-xl text-center text-xs flex items-center justify-center gap-2"
                        >
                          <Clock className="w-4 h-4 text-indigo-600 animate-spin" />
                          <span>อยู่ระหว่างรอตรวจสอบสลิป</span>
                        </div>
                      );
                    }
                    if (isRejected) {
                      return (
                        <button
                          type="button"
                          data-testid="tenant-pay-btn"
                          onClick={onOpenPayment}
                          className="w-full bg-rose-600 hover:bg-rose-700 text-white font-black py-3 px-4 rounded-xl text-center transition-all text-xs shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                        >
                          <CreditCard className="w-4 h-4 text-rose-200 stroke-[2.2]" />
                          <span>ส่งสลิปใหม่</span>
                        </button>
                      );
                    }
                    return (
                      <button
                        type="button"
                        data-testid="tenant-pay-btn"
                        onClick={onOpenPayment}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl text-center transition-all text-xs shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <CreditCard className="w-4 h-4 text-indigo-200 stroke-[2.2]" />
                        <span>ชำระเงิน</span>
                      </button>
                    );
                  })()}
                </div>
              </div>
            ) : (
              /* Mode B: ไม่มีบิลค้างชำระ (Zero Balance) */
              <div className="space-y-3 pt-0.5 text-center py-4 animate-in fade-in duration-200" data-testid="tenant-zero-balance-card">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mx-auto shadow-3xs">
                  <CheckCircle2 className="w-6 h-6 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 tracking-tight">ไม่มีบิลค้างชำระในรอบนี้</h3>
                  <p className="text-xs text-slate-400 font-medium mt-0.5">
                    ท่านได้ชำระเงินค่าห้องพักเรียบร้อยแล้ว
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInvoice('history')}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 hover:underline pt-1 cursor-pointer"
                >
                  <span>ดูประวัติการชำระเงินย้อนหลัง</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          }

          /* Mode C: ลงทะเบียนผู้เช่า (สำหรับผู้เช่าที่ยังไม่มีห้อง หรือโหมดจำลอง) */
          const isAwaitingConfirmation = Boolean(
            !hasRoom && (
              (localTenant as any)?.status === 'awaiting_tenant_confirmation' ||
              (localTenant as any)?.pendingRequest?.status === 'awaiting_tenant_confirmation' ||
              (localTenant as any)?.registrationRequestStatus === 'awaiting_tenant_confirmation'
            )
          );

          let hasLocalPending = false;
          if (typeof window !== 'undefined' && window.localStorage) {
            try {
              const raw = window.localStorage.getItem('pending_tenant_registration');
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && (parsed.status === 'pending_owner_approval' || parsed.id)) {
                  hasLocalPending = true;
                }
              }
            } catch {}
          }

          const isAuthoritativelyUnregistered =
            (localTenant as any)?.status === 'unregistered' &&
            !(localTenant as any)?.pendingRequest &&
            !hasLocalPending;

          if (hasRoom || ((localTenant as any)?.status === 'active' && hasRoom) || (localTenant as any)?.pendingRequest?.status === 'approved' || isAwaitingConfirmation) {
            try {
              if (typeof window !== 'undefined' && window.localStorage) {
                window.localStorage.removeItem('pending_tenant_registration');
              }
            } catch {}
          }

          if (isAwaitingConfirmation) {
            const req = (localTenant as any)?.pendingRequest;
            return (
              <div className="space-y-3 pt-0.5 animate-in fade-in duration-200" data-testid="tenant-awaiting-confirmation-card">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-600 font-black text-xs">
                      <Sparkles className="w-4 h-4 text-emerald-500 fill-emerald-400" />
                      <span>คำขอได้รับการอนุมัติแล้ว</span>
                    </div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">
                      ยืนยันสัญญาเช่าห้อง {req?.requestedRoomNumber || ''}
                    </h2>
                    <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                      เจ้าของหอพักได้ตรวจสอบและอนุมัติคำขอเช่าแล้ว กรุณาตรวจสอบเงื่อนไขสัญญาและลงนามเพื่อเปิดใช้งานห้องพัก
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-50 border border-emerald-200 text-emerald-800 shrink-0">
                    รอคุณยืนยัน
                  </span>
                </div>

                {(() => {
                  const snap = req?.acceptanceSnapshot || {};
                  const diffList = snap.termsDiff || snap.approvedTerms?.termsDiff || [];
                  if (!Array.isArray(diffList) || diffList.length === 0) return null;
                  return (
                    <div className="bg-amber-50/90 border border-amber-200/80 rounded-2xl p-3 space-y-2 text-xs" data-testid="tenant-terms-diff-box">
                      <div className="flex items-center gap-1.5 font-bold text-amber-900 text-[11px]">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>รายการที่เจ้าของหอพักปรับแก้เงื่อนไข:</span>
                      </div>
                      <div className="space-y-1.5 divide-y divide-amber-200/60 pt-0.5">
                        {diffList.map((d: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center pt-1.5 text-[11px]">
                            <span className="text-amber-800 font-semibold">{d.label || d.field}:</span>
                            <div className="flex items-center gap-1.5 font-black">
                              <span className="line-through text-slate-400 font-normal">{String(d.oldValue ?? '-')}</span>
                              <span className="text-amber-600">➔</span>
                              <span className="text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md">{String(d.newValue ?? '-')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                <button
                  type="button"
                  data-testid="tenant-confirm-register-btn"
                  onClick={onStartRegister}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <FileCheck2 className="w-4 h-4 text-emerald-100" />
                  <span>ตรวจสอบและยืนยันสัญญาเช่า</span>
                </button>
              </div>
            );
          }

          const isRejectedRegistration = Boolean(
            !hasRoom && (
              (localTenant as any)?.status === 'rejected' ||
              (localTenant as any)?.pendingRequest?.status === 'rejected' ||
              (localTenant as any)?.registrationRequestStatus === 'rejected'
            )
          );

          if (isRejectedRegistration) {
            const req = (localTenant as any)?.pendingRequest;
            const reason = req?.rejectedReason || 'กรุณาตรวจสอบและแก้ไขข้อมูลให้ถูกต้องตามที่เจ้าของหอพักร้องขอ';
            return (
              <div className="space-y-3 pt-0.5 animate-in fade-in duration-200" data-testid="tenant-rejected-card">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-rose-600 font-black text-xs">
                      <AlertCircle className="w-4 h-4 text-rose-500 fill-rose-100" />
                      <span>คำขอลงทะเบียนถูกปฏิเสธ</span>
                    </div>
                    <h2 className="text-lg font-black text-slate-900 tracking-tight">
                      คำขอห้อง {req?.requestedRoomNumber || ''} ไม่ผ่านการอนุมัติ
                    </h2>
                    <p className="text-[11px] text-rose-700 bg-rose-50/90 border border-rose-200 p-2.5 rounded-xl font-medium leading-relaxed">
                      <span className="font-bold">เหตุผลจากเจ้าของหอพัก:</span> {reason}
                    </p>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-rose-50 border border-rose-200 text-rose-800 shrink-0">
                    ถูกปฏิเสธ
                  </span>
                </div>

                <button
                  type="button"
                  data-testid="tenant-resubmit-register-btn"
                  onClick={onStartRegister}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md shadow-rose-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <Edit3 className="w-4 h-4 text-rose-100" />
                  <span>แก้ไขและส่งคำขอใหม่</span>
                </button>
              </div>
            );
          }

          const isPendingRegistration = Boolean(
            isSimulatingPending ||
            (!hasRoom && !isAwaitingConfirmation && !isRejectedRegistration && (
              (localTenant as any)?.status === 'pending_owner_approval' ||
              (localTenant as any)?.pendingRequest?.status === 'pending_owner_approval' ||
              hasLocalPending
            ))
          );

          return (
            <div className="space-y-3 pt-0.5 animate-in fade-in duration-200">
              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-indigo-600 font-black text-xs">
                    <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
                    <span>{isPendingRegistration ? 'อยู่ระหว่างดำเนินการ' : 'ระบบลงทะเบียนผู้เช่าใหม่'}</span>
                  </div>
                  <h2 className="text-lg font-black text-slate-900 tracking-tight">
                    {isPendingRegistration ? 'รอการตรวจสอบข้อมูล' : 'ลงทะเบียนผู้เช่า'}
                  </h2>
                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                    {isPendingRegistration
                      ? 'ข้อมูลและสัญญาเช่าถูกส่งเรียบร้อยแล้ว เมื่อได้รับการอนุมัติระบบจะเปิดใช้งานห้องพักให้คุณทันที'
                      : 'กรอกข้อมูลผู้เช่า เลือกประเภทค่าเช่า มัดจำ ยานพาหนะ สัตว์เลี้ยง และเซ็นสัญญาเช่า'}
                  </p>
                </div>
                {isPendingRegistration ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-amber-50 border border-amber-200 text-amber-800 shrink-0">
                    รอการอนุมัติ
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-50 border border-indigo-100 text-indigo-700 shrink-0">
                    ยังไม่มีห้อง
                  </span>
                )}
              </div>

              {isPendingRegistration ? (
                <button
                  type="button"
                  data-testid="tenant-pending-register-btn"
                  disabled
                  className="bg-amber-500 hover:bg-amber-500 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 opacity-95 cursor-not-allowed"
                >
                  <Clock className="w-4 h-4 text-amber-100 animate-pulse" />
                  <span>อยู่ระหว่างรอเจ้าของหอพักอนุมัติ</span>
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="tenant-start-register-btn"
                  onClick={onStartRegister}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <UserCheck className="w-4 h-4 text-indigo-200" />
                  <span>ลงทะเบียนผู้เช่า</span>
                </button>
              )}
            </div>
          );
        })()}
      </div>

      {/* Contract Expired Warning Banner (PO-12 & OQ-27 Option A) */}
      {isContractExpired && (
        <div
          data-testid="tenant-contract-expired-banner"
          className="mx-4 p-4 rounded-2xl bg-amber-50 border border-amber-200/90 text-amber-900 shadow-sm flex flex-col gap-2.5 animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5 min-w-0">
              <h4 className="text-xs font-black text-amber-900">สัญญาเช่าสิ้นสุดแล้ว</h4>
              <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
                สัญญาเช่าของคุณสิ้นสุดแล้ว{effectiveContract?.endDate ? `เมื่อวันที่ ${formatToBeDate(effectiveContract.endDate)}` : ''} กรุณาติดต่อเจ้าของหอพัก หรือหากต้องการย้ายออกสามารถยื่นแจ้งย้ายออกได้
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              data-testid="tenant-expired-moveout-btn"
              onClick={onOpenMoveOut ? onOpenMoveOut : onOpenContract}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-xl text-xs font-black transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <span>แจ้งย้ายออก</span>
            </button>
            <button
              type="button"
              data-testid="tenant-expired-view-contract-btn"
              onClick={onOpenContract}
              className="px-3.5 py-1.5 bg-white hover:bg-amber-100/60 active:scale-95 text-amber-900 border border-amber-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              <span>ดูรายละเอียดสัญญา</span>
            </button>
          </div>
        </div>
      )}

      {/* 4. Quick Action Grid (6 Key Functions) */}
      <div>
        <h4 className="text-xs font-black text-slate-900 mb-3 px-5">เมนูหลัก</h4>
        <div className="grid grid-cols-3 gap-3 px-4">
          {/* 1. ใบแจ้งหนี้ */}
          <button
            type="button"
            data-testid="menu-invoice-btn"
            onClick={() => onOpenInvoice('current')}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-purple-50 text-purple-600 p-2.5 rounded-xl border border-purple-100/60 shadow-3xs">
              <FileText className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">ใบแจ้งหนี้</span>
          </button>

          {/* 2. ชำระค่าเช่า */}
          <button
            type="button"
            data-testid="menu-payment-btn"
            onClick={onOpenPayment}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-emerald-50 text-emerald-600 p-2.5 rounded-xl border border-emerald-100/60 shadow-3xs">
              <CreditCard className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">ชำระค่าเช่า</span>
          </button>

          {/* 3. แจ้งซ่อมบำรุง */}
          <button
            type="button"
            data-testid="menu-repairs-btn"
            onClick={onOpenRepairs}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-rose-50 text-rose-600 p-2.5 rounded-xl border border-rose-100/60 shadow-3xs">
              <Wrench className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">แจ้งซ่อมบำรุง</span>
          </button>

          {/* 4. ค่าน้ำ / ค่าไฟ */}
          <button
            type="button"
            data-testid="menu-utilities-btn"
            onClick={onOpenUtilities}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-blue-50 text-blue-500 p-2.5 rounded-xl border border-blue-100/60 shadow-3xs">
              <Zap className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">ค่าน้ำ / ค่าไฟ</span>
          </button>

          {/* 5. เอกสารสัญญา */}
          <button
            type="button"
            data-testid="menu-contract-btn"
            onClick={onOpenContract}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-indigo-50 text-indigo-600 p-2.5 rounded-xl border border-indigo-100/60 shadow-3xs">
              <FileCheck2 className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">เอกสารสัญญา</span>
          </button>

          {/* 6. ประวัติการชำระ */}
          <button
            type="button"
            data-testid="menu-history-btn"
            onClick={() => onOpenInvoice('history')}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-slate-100 text-slate-600 p-2.5 rounded-xl border border-slate-200/60 shadow-3xs">
              <History className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">ประวัติการชำระ</span>
          </button>

          {/* 7. ขอพักรายวัน */}
          <button
            type="button"
            data-testid="menu-daily-stay-btn"
            onClick={() => setIsDailyStayModalOpen(true)}
            className="bg-white rounded-2xl border border-slate-100 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 hover:shadow-xs active:scale-95 transition-all cursor-pointer shadow-3xs"
          >
            <div className="bg-amber-50 text-amber-600 p-2.5 rounded-xl border border-amber-100/60 shadow-3xs">
              <Sparkles className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-[10px] font-bold text-slate-700">ขอพักรายวัน</span>
          </button>
        </div>
      </div>

      {/* 5. Announcements Section (Latest News) */}
      <div className="mx-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-900">ประกาศล่าสุด</h4>
          <button
            type="button"
            data-testid="view-all-announcements-btn"
            onClick={onGoToAnnouncements}
            className="text-[10px] font-bold text-indigo-600 hover:underline cursor-pointer"
          >
            ดูทั้งหมด ({filteredAnnouncements.length})
          </button>
        </div>

        {filteredAnnouncements.length > 0 ? (
          (() => {
            const ann = filteredAnnouncements[0];
            const authorRole = getAuthorRoleName(ann.author);
            const authorInitial = authorRole.substring(0, 2);
            const authorBg = authorRole.includes('ช่าง') ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white';

            let badgeBg = 'bg-indigo-50 text-indigo-700 border-indigo-100';
            let badgeLabel = 'ทั่วไป';
            let badgeIcon = <Megaphone className="w-3 h-3 text-indigo-500" />;

            if (ann.type === 'electric_off') {
              badgeBg = 'bg-violet-50 text-violet-700 border-violet-100';
              badgeLabel = 'บำรุงรักษาระบบไฟฟ้า';
              badgeIcon = <Zap className="w-3 h-3 text-violet-500" />;
            } else if (ann.type === 'water_off') {
              badgeBg = 'bg-rose-50 text-rose-700 border-rose-100';
              badgeLabel = 'บำรุงรักษาระบบประปา';
              badgeIcon = <Droplet className="w-3 h-3 text-rose-500" />;
            } else if (ann.type === 'maintenance') {
              badgeBg = 'bg-emerald-50 text-emerald-700 border-emerald-100';
              badgeLabel = 'งานซ่อมบำรุง';
              badgeIcon = <Wrench className="w-3 h-3 text-emerald-500" />;
            } else if (ann.type === 'payment') {
              badgeBg = 'bg-amber-50 text-amber-700 border-amber-100';
              badgeLabel = 'แจ้งชำระเงินค่าเช่ารายเดือน';
              badgeIcon = <CreditCard className="w-3 h-3 text-amber-500" />;
            } else if (ann.type === 'safety') {
              badgeBg = 'bg-slate-50 text-slate-700 border-slate-100';
              badgeLabel = 'ระเบียบหอพัก';
              badgeIcon = <Shield className="w-3 h-3 text-slate-500" />;
            }

            return (
              <div className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-3xs hover:shadow-xs transition-all">
                {ann.attachmentUrl && (
                  <img
                    src={ann.attachmentUrl}
                    alt="announcement"
                    className="w-full h-32 object-cover border-b border-slate-50 cursor-zoom-in hover:brightness-95 transition-all"
                    referrerPolicy="no-referrer"
                    onClick={() => onZoomImage && onZoomImage(ann.attachmentUrl!)}
                  />
                )}
                <div className="p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ann.isPinned && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] bg-violet-600 text-white font-black px-2 py-0.5 rounded-full shadow-3xs">
                        <Pin className="w-2.5 h-2.5 fill-white text-white" />
                        ปักหมุด
                      </span>
                    )}
                    {ann.isUrgent && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-full shadow-3xs animate-pulse">
                        <AlertCircle className="w-2.5 h-2.5" />
                        ด่วน
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full border ${badgeBg}`}>
                      {badgeIcon}
                      <span>{badgeLabel}</span>
                    </span>
                  </div>

                  <div className="flex">
                    <span className="inline-flex items-center gap-1 text-[9px] bg-slate-100 text-slate-600 font-extrabold px-2 py-0.5 rounded-md">
                      <BuildingIcon className="w-3 h-3 text-slate-500" />
                      <span>{ann.customTarget || 'ทุกอาคาร'}</span>
                    </span>
                  </div>

                  <h5 className="font-extrabold text-slate-900 text-xs tracking-tight line-clamp-1">
                    {ann.title}
                  </h5>
                  <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                    {ann.content}
                  </p>

                  <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-[9px] text-slate-400">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-4.5 h-4.5 rounded-full flex items-center justify-center text-[8px] font-black ${authorBg}`}>
                        {authorInitial}
                      </div>
                      <span className="font-bold text-slate-500">โดย {authorRole}</span>
                    </div>
                    <span className="font-bold">{formatThaiDate(ann.publishDate || ann.createdAt.split('T')[0])}</span>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <p className="text-center py-6 text-slate-400 font-medium bg-white border border-slate-100 rounded-2xl shadow-3xs text-xs">
            ไม่มีประกาศแจ้งเตือนในขณะนี้
          </p>
        )}
      </div>

      {isDailyStayModalOpen && (
        <TenantDailyRequestModal
          isOpen={isDailyStayModalOpen}
          onClose={() => setIsDailyStayModalOpen(false)}
          dormitoryId={localTenant.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '')}
          roomNumber="205"
          roomId="3558477a-20a0-4c45-b695-4a1c009bfb55"
          onSuccess={(msg) => {
            setIsDailyStayModalOpen(false);
            onRefresh();
          }}
        />
      )}
    </div>
  );
};
