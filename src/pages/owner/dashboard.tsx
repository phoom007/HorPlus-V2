/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Eye,
  Gauge,
  FileCheck2,
  Building,
  Users,
  FileText,
  Wrench,
  Megaphone,
  BarChart4,
  ShieldCheck,
  Settings,
  Plus,
  ChevronDown,
  User,
  AlertTriangle,
  CheckCircle,
  X,
  CreditCard,
  PlusCircle,
  ArrowRight,
  Sparkles,
  Clock,
  Gift,
  CheckCircle2,
  ArrowLeft,
  Copy,
  Check,
  Upload,
  QrCode,
  Loader2,
  AlertCircle,
  Send
} from 'lucide-react';
import { formatBaht } from '../../components/GlobalComponents';
import { LineNotificationModal } from '../../components/LineNotificationModal';
import { tempMeterRowsCache } from './meters';
import {
  Bill,
  Room,
  MaintenanceRequest,
  Contract,
  Tenant,
  User as UserType
} from '../../types';


interface OwnerDashboardProps {
  rooms: Room[];
  bills: Bill[];
  maintenance: MaintenanceRequest[];
  contracts: Contract[];
  tenants?: Tenant[];
  activeUser: UserType;
  onNavigate: (tab: string, param?: string) => void;
  onActionClick?: (action: string) => void;
  selectedCycle?: string;
  setSelectedCycle?: (cycle: string) => void;
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  rooms = [],
  bills = [],
  maintenance = [],
  contracts = [],
  tenants = [],
  activeUser,
  onNavigate,
  onActionClick,
  selectedCycle: propSelectedCycle,
  setSelectedCycle: propSetSelectedCycle,
  onAddLog
}) => {
  const selectedCycle = propSelectedCycle || '';

  const [visibleRoomsCount, setVisibleRoomsCount] = useState(8);
  const [sortByStatus, setSortByStatus] = useState<'vacant' | 'occupied' | 'maintenance' | null>(null);
  const [showUnpaidModal, setShowUnpaidModal] = useState(false);

  // Subscription Remaining Days & Package Modal State
  const [remainingDays, setRemainingDays] = useState<number | null>(null);
  const [remainingDaysLoading, setRemainingDaysLoading] = useState<boolean>(false);
  const [remainingDaysError, setRemainingDaysError] = useState<boolean>(false);
  const [isLineModalOpen, setIsLineModalOpen] = useState<boolean>(false);
  const [isPackageModalOpen, setIsPackageModalOpen] = useState<boolean>(false);
  const [modalStep, setModalStep] = useState<'select' | 'payment'>('select');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('micro');
  const [promoCode, setPromoCode] = useState<string>('');
  const [promoSuccessMsg, setPromoSuccessMsg] = useState<string>('');
  const [successNotice, setSuccessNotice] = useState<string>('');
  const [entitlements, setEntitlements] = useState<any>(null);
  const [entitlementsLoading, setEntitlementsLoading] = useState<boolean>(false);
  const [entitlementsError, setEntitlementsError] = useState<string | null>(null);

  useEffect(() => {
    const activeDormId = sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
    if (activeDormId) {
      setRemainingDaysLoading(true);
      fetch('/api/v1/subscription/entitlements', {
        headers: { 'x-dormitory-id': activeDormId }
      })
        .then(res => res.ok ? res.json() : null)
        .then(json => {
          if (json && json.data && typeof json.data.remainingDays === 'number') {
            setRemainingDays(json.data.remainingDays);
          } else {
            setRemainingDays(null);
          }
        })
        .catch(() => {
          setRemainingDaysError(true);
          setRemainingDays(null);
        })
        .finally(() => setRemainingDaysLoading(false));
    }
  }, []);

  useEffect(() => {
    if (isPackageModalOpen) {
      const activeDormId = sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id') || '';
      if (activeDormId) {
        setEntitlementsLoading(true);
        setEntitlementsError(null);
        fetch('/api/v1/subscription/entitlements', {
          headers: { 'x-dormitory-id': activeDormId }
        })
          .then(res => {
            if (!res.ok) throw new Error('ไม่สามารถโหลดข้อมูลแพ็กเกจได้');
            return res.json();
          })
          .then(json => {
            setEntitlements(json.data);
            if (json.data && typeof json.data.remainingDays === 'number') {
              setRemainingDays(json.data.remainingDays);
            }
          })
          .catch(err => {
            setEntitlementsError(err.message || 'ไม่สามารถโหลดข้อมูลแพ็กเกจจากเซิร์ฟเวอร์');
          })
          .finally(() => setEntitlementsLoading(false));
      } else {
        setEntitlementsError('โปรดระบุหอพักที่ต้องการดำเนินการ');
      }
    }
  }, [isPackageModalOpen]);

  // Auto-dismiss Toast notification after 4 seconds
  useEffect(() => {
    if (successNotice) {
      const timer = setTimeout(() => {
        setSuccessNotice('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [successNotice]);

  // Payment step states
  const [slipImage, setSlipImage] = useState<string | null>(null);

  const getRemainingDaysBadgeStyle = (days: number) => {
    if (days <= 3) {
      return 'bg-rose-500 text-white font-black shadow-md animate-pulse border border-rose-300';
    }
    if (days <= 7) {
      return 'bg-orange-500 text-white font-black shadow-md border border-orange-300';
    }
    if (days <= 14) {
      return 'bg-amber-300 text-amber-950 font-black shadow-md border border-amber-400';
    }
    return 'bg-white/20 text-white hover:bg-white/30 backdrop-blur-xs font-black border border-white/20';
  };

  const handleSlipUpload = (_e: React.ChangeEvent<HTMLInputElement>) => {
    setSuccessNotice('ระบบสั่งซื้อแพ็กเกจขยายระยะเวลาใช้งานยังไม่พร้อมให้บริการแบบตอบรับอัตโนมัติในขณะนี้ (โปรดติดต่อเจ้าหน้าที่)');
  };

  // Stats Calculations
  const currentMonthBills = bills.filter(b => b.cycleId === selectedCycle);
  const checkingCount = currentMonthBills.filter(b => b.status === 'checking').length;
  
  const occupiedRooms = rooms.filter(r => r.status === 'occupied');
  const paidRoomIds = new Set(currentMonthBills.filter(b => b.status === 'paid').map(b => b.roomId));
  const unpaidRoomsCount = occupiedRooms.length > 0
    ? occupiedRooms.filter(r => !paidRoomIds.has(r.id)).length
    : currentMonthBills.filter(b => b.status !== 'paid').length;

  // Calculate total unpaid amount directly based on unpaid bills (no fake utility generation)
  const unpaidBills = currentMonthBills.filter(b => b.status !== 'paid');
  const totalUnpaidAmount = unpaidBills.reduce((sum, b) => sum + Number(b.totalAmount || b.outstandingAmount || 0), 0);


  const formatDueDateThai = () => {
    const rawDueDate = selectedBillingCycle?.dueDate;
    if (!rawDueDate) return 'ยังไม่ได้กำหนดวันครบกำหนด';
    try {
      const d = new Date(rawDueDate);
      if (isNaN(d.getTime())) return 'ยังไม่ได้กำหนดวันครบกำหนด';
      const yearBE = d.getFullYear() + 543;
      const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      return `กำหนดชำระ: ${d.getDate()} ${months[d.getMonth()]} ${yearBE}`;
    } catch {
      return 'ยังไม่ได้กำหนดวันครบกำหนด';
    }
  };

  const formatThaiCycleName = (cycleStr: string) => {
    if (!cycleStr) return '';
    const parts = cycleStr.split('-');
    if (parts.length === 2) {
      const yearCE = parseInt(parts[0], 10);
      const yearBE = yearCE + 543;
      const monthIdx = parseInt(parts[1], 10) - 1;
      const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `งวดเดือน${months[monthIdx]} ${yearBE}`;
      }
    }
    return `งวด ${cycleStr}`;
  };

  // Billing Cycle Workflow Stats for selectedCycle
  const actualOccupiedCount = rooms.filter(r => r.status === 'occupied').length;
  
  // 1. Meter recorded count (from MeterReading records for selectedBillingCycle)
  const currentCycleBills = bills.filter(b => b.cycleId === selectedCycle);
  const metersRecordedCount = selectedBillingCycle?.id
    ? new Set((meterReadings || []).map((m: any) => m.roomId)).size
    : currentCycleBills.length;
  const isMetersDone = actualOccupiedCount > 0 && metersRecordedCount >= actualOccupiedCount;

  // 2. Billing issued count
  const issuedBillsCount = currentCycleBills.filter(b => b.status !== 'draft').length;
  const isBillingDone = actualOccupiedCount > 0 && (issuedBillsCount >= actualOccupiedCount || (currentCycleBills.length >= actualOccupiedCount && issuedBillsCount > 0));

  // 3. LINE notifications sent count (strictly from server bill state)
  const lineSentCount = currentCycleBills.filter(b => (b as any).lineNotifiedAt || (b as any).lineSent).length;
  const isLineDone = currentCycleBills.length > 0 && lineSentCount >= currentCycleBills.length;

  // 4. Payment status
  const paidBillsCount = currentCycleBills.filter(b => b.status === 'paid').length;
  const checkingBillsCount = currentCycleBills.filter(b => b.status === 'checking').length;
  const unpaidBillsCount = currentCycleBills.filter(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'unpaid').length;
  const isFullyPaid = actualOccupiedCount > 0 && paidBillsCount >= actualOccupiedCount;

  // Current active step index (0: จดมิเตอร์, 1: ออกบิล, 2: ส่ง LINE, 3: รอชำระเงิน, 4: จ่ายครบเรียบร้อย)
  const step0Done = isMetersDone;
  const step1Done = step0Done && isBillingDone;
  const step2Done = step1Done && isLineDone;
  const step3Done = step2Done && (isFullyPaid || (paidBillsCount > 0 && unpaidBillsCount === 0 && checkingBillsCount === 0));
  const step4Done = isFullyPaid;

  let currentStepIdx = 0;
  if (step4Done) {
    currentStepIdx = 4;
  } else if (step3Done || checkingBillsCount > 0 || unpaidBillsCount > 0 || isLineDone) {
    currentStepIdx = 3;
  } else if (step1Done || isBillingDone) {
    currentStepIdx = 2;
  } else if (step0Done || isMetersDone) {
    currentStepIdx = 1;
  } else {
    currentStepIdx = 0;
  }

  const totalRooms = rooms.length;
  const occupiedCount = rooms.filter(r => r.status === 'occupied').length;
  const vacantCount = rooms.filter(r => r.status === 'vacant').length;
  const maintenanceCount = rooms.filter(r => r.status === 'maintenance').length;

  // Notification Badge / Red Alert Dot Logics (Cycle-Specific):
  // 1. จดมิเตอร์: occupied rooms that have NOT been issued a bill or bill status is draft in selectedCycle
  const hasUnissuedMeters = occupiedRooms.length > 0 && occupiedRooms.some(r => {
    const b = currentMonthBills.find(bill => bill.roomId === r.id);
    return !b || b.status === 'draft';
  });

  // 2. การชำระเงิน: if there are items in 'รอตรวจสลิป' (checking status) in selectedCycle
  const hasPendingSlips = currentMonthBills.some(b => b.status === 'checking');

  // 3. งานแจ้งซ่อม: if there are items pending repair
  const hasPendingMaintenance = maintenance.some(r =>
    ['submitted', 'accepted', 'more_info', 'scheduled', 'pending'].includes(r.status)
  );

  // Helper fallback functions
  function getTenantIdsList(tList: Tenant[]) {
    return tList.map(t => t.id);
  }

  // 4. ผู้เช่า: if new tenants added that haven't been opened/viewed in selectedCycle
  const [seenTenantIds, setSeenTenantIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_tenants_${selectedCycle}`);
      return saved ? JSON.parse(saved) : getTenantIdsList(tenants);
    } catch {
      return getTenantIdsList(tenants);
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_tenants_${selectedCycle}`);
      if (saved) {
        setSeenTenantIds(JSON.parse(saved));
      } else {
        setSeenTenantIds(getTenantIdsList(tenants));
      }
    } catch {}
  }, [selectedCycle, tenants]);

  const hasUnviewedTenants = tenants.some(t => !seenTenantIds.includes(t.id));

  // Helper fallback functions
  function getContractIdsList(cList: Contract[]) {
    return cList.map(c => c.id);
  }

  // 5. สัญญาเช่า: if new contracts created that haven't been opened/viewed
  const [seenContractIds, setSeenContractIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_contracts_${selectedCycle}`);
      return saved ? JSON.parse(saved) : getContractIdsList(contracts);
    } catch {
      return getContractIdsList(contracts);
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_contracts_${selectedCycle}`);
      if (saved) {
        setSeenContractIds(JSON.parse(saved));
      } else {
        setSeenContractIds(getContractIdsList(contracts));
      }
    } catch {}
  }, [selectedCycle, contracts]);

  const hasUnviewedContracts = contracts.some(c => !seenContractIds.includes(c.id));

  // Pending contract submissions badge state
  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_pending_contract_submissions');
      if (saved) {
        const subs = JSON.parse(saved);
        return subs.filter((s: any) => s.status === 'pending').length;
      }
    } catch {}
    return 0;
  });

  useEffect(() => {
    setPendingSubmissionsCount(0);
  }, []);

  // Settings completeness status (suppressed until authoritative API settings completeness contract exists)
  const isSettingsIncomplete = false;

  // Handler for clicking 'ดูรายละเอียด' button
  const handleDetailClick = () => {
    const checkingCount = currentMonthBills.filter(b => b.status === 'checking').length;
    const unpaidCount = currentMonthBills.filter(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'unpaid').length;

    let targetTab = 'paid';
    if (checkingCount > 0) {
      targetTab = 'checking';
    } else if (unpaidCount > 0) {
      targetTab = 'cash';
    }

    localStorage.setItem('payments_active_tab', targetTab);
    onNavigate('payments', targetTab);
  };

  // Handler for clicking menu buttons
  const handleMenuClick = (target: string) => {
    if (target === 'payments') {
      handleDetailClick();
      return;
    }
    if (target === 'tenants') {
      const allTenantIds = tenants.map(t => t.id);
      setSeenTenantIds(allTenantIds);
      localStorage.setItem(`HorPlus_seen_tenants_${selectedCycle}`, JSON.stringify(allTenantIds));
    } else if (target === 'contracts') {
      const allContractIds = contracts.map(c => c.id);
      setSeenContractIds(allContractIds);
      localStorage.setItem(`HorPlus_seen_contracts_${selectedCycle}`, JSON.stringify(allContractIds));
    }
    onNavigate(target);
  };

  // Sorted rooms (excluding reserved rooms)
  const activeDashboardRooms = rooms.filter(r => r.status !== 'reserved');
  const sortedRooms = [...activeDashboardRooms].sort((a, b) => {
    if (sortByStatus) {
      if (a.status === sortByStatus && b.status !== sortByStatus) return -1;
      if (a.status !== sortByStatus && b.status === sortByStatus) return 1;
    }
    return a.roomNumber.localeCompare(b.roomNumber);
  });

  // 10 Main Navigation Menu Items matching owner.tsx menu icons
  const mainMenus = [
    {
      id: 'meters',
      title: 'จดมิเตอร์',
      target: 'meters',
      icon: Gauge,
      bgClass: 'bg-indigo-50 text-indigo-600'
    },
    {
      id: 'payments',
      title: 'การชำระเงิน',
      target: 'payments',
      icon: FileCheck2,
      bgClass: 'bg-emerald-50 text-emerald-600'
    },
    {
      id: 'rooms',
      title: 'ห้องพัก',
      target: 'rooms',
      icon: Building,
      bgClass: 'bg-rose-50 text-rose-500'
    },
    {
      id: 'tenants',
      title: 'ผู้เช่า',
      target: 'tenants',
      icon: Users,
      bgClass: 'bg-purple-50 text-purple-600'
    },
    {
      id: 'contracts',
      title: 'สัญญาเช่า',
      target: 'contracts',
      icon: FileText,
      bgClass: 'bg-amber-50 text-amber-600'
    },
    {
      id: 'maintenance',
      title: 'งานแจ้งซ่อม',
      target: 'maintenance',
      icon: Wrench,
      bgClass: 'bg-cyan-50 text-cyan-600'
    },
    {
      id: 'announcements',
      title: 'ประชาสัมพันธ์',
      target: 'announcements',
      icon: Megaphone,
      bgClass: 'bg-pink-50 text-pink-500'
    },
    {
      id: 'reports',
      title: 'รายงานสถิติ',
      target: 'reports',
      icon: BarChart4,
      bgClass: 'bg-indigo-50 text-indigo-600'
    },
    {
      id: 'users',
      title: 'สิทธิ์และพนักงาน',
      target: 'users',
      icon: ShieldCheck,
      bgClass: 'bg-violet-50 text-violet-600'
    },
    {
      id: 'settings',
      title: 'ตั้งค่า',
      target: 'settings',
      icon: Settings,
      bgClass: 'bg-slate-100 text-slate-600'
    }
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-10">
      {/* Toast Notification (Floating Top-Right) */}
      {successNotice && (
        <div className="fixed top-5 right-5 z-[9999] max-w-sm w-full bg-slate-900/95 text-white p-4 rounded-2xl shadow-2xl border border-slate-700/80 flex items-start justify-between gap-3 animate-in slide-in-from-top-3 fade-in duration-300">
          <div className="flex items-start gap-2.5">
            <div className={`p-1.5 rounded-xl shrink-0 mt-0.5 border ${
              successNotice.includes('❌') 
                ? 'bg-rose-500/20 text-rose-400 border-rose-500/30' 
                : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
            }`}>
              {successNotice.includes('❌') ? <AlertCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
            </div>
            <div>
              <h4 className={`text-[11px] font-black uppercase tracking-wider ${
                successNotice.includes('❌') ? 'text-rose-400' : 'text-emerald-400'
              }`}>
                {successNotice.includes('❌') ? 'แจ้งเตือน' : 'ทำรายการสำเร็จ'}
              </h4>
              <p className="text-xs font-bold text-slate-100 leading-snug mt-0.5">{successNotice}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice('')}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      
      {/* 1. TOP SUMMARY CARD: "สรุปยอดค้างชำระทั้งหมด" */}
      <div className="-mx-4 -mt-4 md:-mx-6 md:-mt-6 mb-6 bg-[#2b64f6] relative overflow-hidden transition-all duration-300">
        
        {/* Decorative Top Banner Header */}
        <div className="px-5 sm:px-8 pt-4 sm:pt-5 pb-6 sm:pb-7 text-white flex items-center justify-between max-w-7xl mx-auto">
          <span className="text-xs sm:text-sm font-black tracking-wide opacity-95">เวลาใช้งานคงเหลือ</span>
          <button
            type="button"
            onClick={() => setIsPackageModalOpen(true)}
            className={`text-[11px] sm:text-xs font-black px-3.5 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs hover:scale-105 active:scale-95 ${remainingDays !== null ? getRemainingDaysBadgeStyle(remainingDays) : 'bg-white/20 text-white font-black border border-white/20'}`}
            title="คลิกเพื่อดูหรือเลือกแพ็กเกจการใช้งาน"
          >
            <span>{remainingDaysLoading ? '--' : remainingDays !== null ? `${remainingDays} วัน` : '--'}</span>
          </button>
        </div>

        {/* White Summary Content Card - Flush to left, right, and bottom edges */}
        <div className="bg-white p-5 sm:p-6 rounded-t-[26px] sm:rounded-t-[32px] shadow-sm text-slate-900 border-t border-slate-100/60">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-7xl mx-auto">
            
            {/* Left Text and Price */}
            <div className="space-y-2">
              <div className="flex items-center justify-between md:justify-start gap-3">
                <span className="text-xs sm:text-sm font-extrabold text-slate-500">ยอดค้างชำระ</span>
                {checkingCount > 0 ? (
                  <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200/60 font-extrabold text-xs sm:text-xs rounded-full shadow-2xs">
                    รอตรวจสลิป {checkingCount} ห้อง
                  </span>
                ) : (
                  <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200/60 font-extrabold text-xs sm:text-xs rounded-full shadow-2xs">
                    รอชำระ {unpaidRoomsCount} ห้อง
                  </span>
                )}
              </div>

              <div className="flex items-baseline gap-1.5 pt-0.5">
                <span className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 tracking-tight">
                  ฿ {totalUnpaidAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              <p className="text-[11px] sm:text-xs text-slate-400 font-semibold pt-0.5">
                {formatDueDateThai()}
              </p>
            </div>

            {/* Right Action Button -> Navigates to payments tab */}
            <div className="shrink-0 w-full md:w-auto">
              <button
                onClick={handleDetailClick}
                className="w-full md:w-auto px-6 py-3.5 bg-[#2b64f6] hover:bg-blue-700 active:scale-[0.98] text-white font-extrabold text-xs sm:text-sm rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition-all cursor-pointer"
              >
                <Eye className="w-4 h-4 stroke-[2.5]" />
                <span>ดูรายละเอียด</span>
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* 2. MAIN MENU SECTION: "เมนูหลัก" */}
      <div>
        <h3 className="text-base sm:text-lg font-black text-slate-800 mb-3 sm:mb-4">
          เมนูหลัก
        </h3>

        {/* Responsive Grid: 3 columns on mobile, 5 columns on tablet/PC */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-5 gap-3 sm:gap-4">
          {mainMenus.map((menu) => {
            const hasBadge = (
              (menu.id === 'meters' && hasUnissuedMeters) ||
              (menu.id === 'maintenance' && hasPendingMaintenance) ||
              (menu.id === 'payments' && hasPendingSlips) ||
              (menu.id === 'tenants' && hasUnviewedTenants) ||
              (menu.id === 'contracts' && (hasUnviewedContracts || pendingSubmissionsCount > 0)) ||
              (menu.id === 'settings' && isSettingsIncomplete)
            );

            return (
              <button
                key={menu.id}
                onClick={() => handleMenuClick(menu.target)}
                className="bg-white p-3.5 sm:p-4 rounded-2xl sm:rounded-3xl border border-slate-100/90 shadow-3xs hover:shadow-md transition-all active:scale-95 flex flex-col items-center justify-center text-center group cursor-pointer relative"
              >
                <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center mb-2 sm:mb-2.5 transition-transform group-hover:scale-110 relative ${menu.bgClass}`}>
                  <menu.icon className="w-5 h-5 sm:w-6 sm:h-6 stroke-[2.2]" />
                  {hasBadge && (
                    <span className="w-3 h-3 bg-rose-500 rounded-full border-2 border-white absolute -top-0.5 -right-0.5 animate-pulse shadow-xs" />
                  )}
                </div>
                <span className="text-xs sm:text-xs font-bold text-slate-700 group-hover:text-indigo-600 leading-snug">
                  {menu.title}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. MINIMAL CYCLE BILLING WORKFLOW STEPPER */}
      <div className="bg-white border border-slate-100 shadow-xs p-4 sm:p-5 rounded-2xl sm:rounded-3xl">
        <div className="relative">
          {/* Background Connecting Line - starts at center of 1st node (10%) and ends at 5th node (90%) */}
          <div className="absolute top-4 sm:top-5 left-[10%] right-[10%] h-0.5 bg-slate-200/90 -z-0" />
          
          {/* Active Progress Line Fill */}
          <div 
            className={`absolute top-4 sm:top-5 left-[10%] h-0.5 transition-all duration-500 -z-0 ${
              isFullyPaid ? 'bg-emerald-500' : 'bg-indigo-600'
            }`}
            style={{
              width: `${(currentStepIdx / 4) * 80}%`
            }}
          />

          <div className="grid grid-cols-5 gap-1 sm:gap-2 relative z-10">
            {[
              {
                id: 'meters',
                desktopLabel: '1. จดมิเตอร์',
                mobileLabel: 'จดมิเตอร์',
                icon: Gauge,
                isDone: step0Done,
                isCurrent: currentStepIdx === 0,
                onClick: () => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  const mainEl = document.getElementById('owner-main-content') || document.querySelector('main');
                  if (mainEl) mainEl.scrollTop = 0;
                  onNavigate('meters');
                }
              },
              {
                id: 'bills',
                desktopLabel: '2. ออกบิล',
                mobileLabel: 'ออกบิล',
                icon: FileText,
                isDone: step1Done,
                isCurrent: currentStepIdx === 1,
                onClick: () => {
                  try {
                    localStorage.setItem('scroll_to_meter_status', 'true');
                  } catch (e) {
                    console.error(e);
                  }
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  const mainEl = document.getElementById('owner-main-content') || document.querySelector('main');
                  if (mainEl) mainEl.scrollTop = 0;
                  onNavigate('meters');
                }
              },
              {
                id: 'line',
                desktopLabel: '3. ส่ง LINE',
                mobileLabel: 'ส่ง LINE',
                icon: Send,
                isDone: step2Done,
                isCurrent: currentStepIdx === 2,
                onClick: () => setIsLineModalOpen(true)
              },
              {
                id: 'pending',
                desktopLabel: '4. รอชำระเงิน',
                mobileLabel: 'รอชำระเงิน',
                icon: CreditCard,
                isDone: step3Done || isFullyPaid,
                isCurrent: currentStepIdx === 3,
                onClick: () => handleDetailClick()
              },
              {
                id: 'paid',
                desktopLabel: '5. จ่ายครบ',
                mobileLabel: 'จ่ายครบ',
                icon: ShieldCheck,
                isDone: step4Done,
                isCurrent: currentStepIdx === 4,
                onClick: () => {
                  localStorage.setItem('payments_active_tab', 'paid');
                  onNavigate('payments', 'paid');
                }
              }
            ].map((step, idx) => {
              const Icon = step.icon;
              const isGreen = step.isDone || isFullyPaid;
              const isPassed = idx < currentStepIdx || isGreen;

              return (
                <button
                  key={step.id}
                  onClick={step.onClick}
                  className="flex flex-col items-center group cursor-pointer text-center"
                >
                  {/* Circle Node */}
                  <div
                    className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isGreen
                        ? 'bg-emerald-500 text-white shadow-xs ring-2 ring-emerald-100'
                        : step.isCurrent
                        ? 'bg-indigo-600 text-white shadow-md ring-4 ring-indigo-100 scale-105'
                        : isPassed
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-slate-500 border-2 border-slate-300 group-hover:border-indigo-400 group-hover:text-indigo-600'
                    }`}
                  >
                    {isGreen ? (
                      <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                    ) : (
                      <Icon className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" />
                    )}
                  </div>

                  {/* Step Label: Mobile view hides numbers */}
                  <span
                    className={`text-[11px] sm:text-xs font-extrabold mt-2 leading-tight transition-colors ${
                      isGreen
                        ? 'text-emerald-700 font-extrabold'
                        : step.isCurrent
                        ? 'text-indigo-700 font-black'
                        : 'text-slate-700 font-bold group-hover:text-indigo-600'
                    }`}
                  >
                    <span className="hidden sm:inline">{step.desktopLabel}</span>
                    <span className="inline sm:hidden">{step.mobileLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 4. ROOM STATUS GRID SECTION: "สถานะห้องพักจริงในตึก" (Matches Screenshot 2) */}
      <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-xs space-y-4">
        
        {/* Header & Status Filter Badges */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-1">
          <div>
            <h3 className="text-sm sm:text-base font-black text-slate-800" data-testid="total-rooms-count">สถานะห้องพักจริงในตึก ({totalRooms} ห้อง)</h3>
            <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5 font-medium">
              ตรวจสอบการเข้าใช้ แผนผังห้องว่าง ยอดคนพัก และสัญญาเช่าอาคาร
            </p>
          </div>

          {/* Status filter legend buttons */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10px] sm:text-xs font-bold">
            <button
              onClick={() => setSortByStatus(sortByStatus === 'vacant' ? null : 'vacant')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                sortByStatus === 'vacant' 
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                  : 'bg-emerald-50/60 text-emerald-700 border-emerald-100 hover:bg-emerald-100'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${sortByStatus === 'vacant' ? 'bg-white' : 'bg-emerald-500'}`} />
              <span>ว่าง ({vacantCount})</span>
            </button>

            <button
              onClick={() => setSortByStatus(sortByStatus === 'occupied' ? null : 'occupied')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                sortByStatus === 'occupied' 
                  ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs' 
                  : 'bg-indigo-50/60 text-indigo-700 border-indigo-100 hover:bg-indigo-100'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${sortByStatus === 'occupied' ? 'bg-white' : 'bg-indigo-500'}`} />
              <span>เข้าพักแล้ว ({occupiedCount})</span>
            </button>

            <button
              onClick={() => setSortByStatus(sortByStatus === 'maintenance' ? null : 'maintenance')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all cursor-pointer ${
                sortByStatus === 'maintenance' 
                  ? 'bg-rose-600 text-white border-rose-600 shadow-xs' 
                  : 'bg-rose-50/60 text-rose-700 border-rose-100 hover:bg-rose-100'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${sortByStatus === 'maintenance' ? 'bg-white' : 'bg-rose-500'}`} />
              <span>ปิดปรับปรุง ({maintenanceCount})</span>
            </button>
          </div>
        </div>

        {/* Room Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 gap-3 sm:gap-4">
          {sortedRooms.slice(0, visibleRoomsCount).map((room) => {
            let meterBillStatus: 'draft' | 'pending' | 'paid' = 'draft';
            if (room.status === 'occupied') {
              const cachedRow = tempMeterRowsCache[selectedCycle]?.find(r => r.roomId === room.id);
              const existingBill = bills.find(b => b.roomId === room.id && b.cycleId === selectedCycle);
              const rawStatus = existingBill ? existingBill.status : (cachedRow?.billStatus ?? 'draft');
              if (rawStatus === 'paid') {
                meterBillStatus = 'paid';
              } else if (rawStatus === 'draft') {
                meterBillStatus = 'draft';
              } else {
                meterBillStatus = 'pending';
              }
            }

            let cardBg = 'bg-slate-50/60 border-slate-100 hover:bg-slate-100/60';
            let dotColor = 'bg-emerald-500';

            if (room.status === 'occupied') {
              if (meterBillStatus === 'paid') {
                cardBg = 'bg-emerald-50/20 border-emerald-100 hover:bg-emerald-50/50';
                dotColor = 'bg-emerald-500';
              } else if (meterBillStatus === 'pending') {
                cardBg = 'bg-amber-50/20 border-amber-100 hover:bg-amber-50/50';
                dotColor = 'bg-amber-500';
              } else {
                cardBg = 'bg-indigo-50/30 border-indigo-100 hover:bg-indigo-50/60';
                dotColor = 'bg-indigo-500';
              }
            } else if (room.status === 'maintenance') {
              cardBg = 'bg-rose-50/30 border-rose-100 hover:bg-rose-100/50';
              dotColor = 'bg-rose-500';
            }

            const currentTenant = tenants.find(t => t.id === room.currentTenantId);
            const tenantDisplayName = currentTenant ? currentTenant.name : 'มีผู้เช่าแล้ว';

            return (
              <button
                key={room.id}
                onClick={() => {
                  onNavigate('rooms', room.id);
                }}
                className={`p-3.5 sm:p-4 rounded-2xl border text-left cursor-pointer transition-all active:scale-[0.98] flex flex-col justify-between h-[116px] shadow-3xs ${cardBg}`}
              >
                <div className="flex justify-between items-center w-full">
                  <span className="text-xs sm:text-sm font-black text-slate-800">ห้อง {room.roomNumber}</span>
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                </div>

                <div className="text-[11px] font-bold flex items-center gap-1.5 truncate text-slate-600">
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">
                    {room.status === 'occupied' ? tenantDisplayName : room.status === 'maintenance' ? 'ปิดปรับปรุง' : 'ห้องว่าง'}
                  </span>
                </div>

                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-slate-400 font-semibold">
                    {room.derivedFloor ? `ชั้น ${room.derivedFloor}` : <span className="text-red-500 font-semibold">[Data Integrity Error]</span>}
                  </span>
                  {room.status === 'occupied' && (
                    meterBillStatus === 'paid' ? (
                      <span className="text-[9px] font-black text-emerald-700 bg-emerald-100/80 px-1.5 py-0.5 rounded-md">
                        จ่ายแล้ว
                      </span>
                    ) : meterBillStatus === 'pending' ? (
                      <span className="text-[9px] font-black text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded-md">
                        รอชำระเงิน
                      </span>
                    ) : (
                      <span className="text-[9px] font-black text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md">
                        ยังไม่ออกบิล
                      </span>
                    )
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Load More Button */}
        {rooms.length > visibleRoomsCount && (
          <div className="pt-2 text-center flex justify-center">
            <button
              onClick={() => setVisibleRoomsCount(prev => Math.min(rooms.length, prev + 8))}
              className="w-10 h-10 bg-slate-50 hover:bg-slate-100 text-indigo-600 rounded-full flex items-center justify-center transition-all active:scale-95 border border-slate-200/60 cursor-pointer"
              title="แสดงห้องเพิ่มขึ้น"
            >
              <ChevronDown className="w-5 h-5 stroke-[2.5]" />
            </button>
          </div>
        )}

      </div>

      {/* MODAL: Details of unpaid/overdue rooms ("ดูรายละเอียดห้องที่ค้าง") */}
      {showUnpaidModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-xl border border-slate-100 p-6 space-y-4 max-h-[85vh] flex flex-col">
            
            <div className="flex justify-between items-center border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
                <h3 className="text-base font-black text-slate-800">รายการห้องที่ค้างชำระ ({unpaidBills.length} ห้อง)</h3>
              </div>
              <button 
                onClick={() => setShowUnpaidModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2.5 pr-1 flex-1">
              {unpaidBills.map((bill) => {
                const room = rooms.find(r => r.id === bill.roomId);
                return (
                  <div key={bill.id} className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-800">ห้อง {room?.roomNumber || 'ไม่ระบุ'}</span>
                        <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-100">
                          ค้างชำระ
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                        ผู้เช่า: อิทธิพล บัวลา
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-sm font-black text-slate-800">
                        {formatBaht(bill.totalAmount)}
                      </p>
                      <button
                        onClick={() => {
                          setShowUnpaidModal(false);
                          handleDetailClick();
                        }}
                        className="mt-1 text-[10px] font-bold text-indigo-600 hover:underline flex items-center justify-end gap-0.5 cursor-pointer"
                      >
                        <span>แจ้งเตือนชำระ</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {unpaidBills.length === 0 && (
                <p className="text-center py-6 text-xs text-slate-400 font-bold">ไม่มีรายการค้างชำระในระบบ</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => {
                  setShowUnpaidModal(false);
                  handleDetailClick();
                }}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                ไปที่หน้าจัดการการชำระเงิน
              </button>
            </div>

          </div>
        </div>
      )}

      {/* PACKAGE SELECTION MODAL POPUP */}
      {isPackageModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in">
          <div className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl border border-slate-100 overflow-hidden my-auto space-y-0">
            <div className="p-4 sm:p-5 bg-white border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-800">แพ็กเกจการใช้งานระบบ</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPackageModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-6 max-h-[65vh] overflow-y-auto">
              {entitlementsLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs font-bold">กำลังโหลดข้อมูลแพ็กเกจ...</div>
              ) : entitlementsError || !entitlements?.availablePackages ? (
                <div data-testid="entitlement-catalog-error" className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-xs font-bold text-center">
                  {entitlementsError || 'ไม่สามารถโหลดแค็ตตาล็อกแพ็กเกจจากเซิร์ฟเวอร์หลักได้'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(entitlements.availablePackages || []).map((pkg: any) => (
                    <div
                      key={pkg.id || pkg.code}
                      className="p-4 rounded-2xl border border-slate-200 bg-white flex flex-col justify-between"
                    >
                      <div>
                        <h4 className="font-black text-slate-900 text-sm mb-1">{pkg.name || pkg.code}</h4>
                        <p className="text-xs text-slate-500 mb-2">{pkg.description || ''}</p>
                        <div className="mb-3">
                          <span className="text-lg font-black text-blue-600">฿{pkg.priceTHB ?? pkg.price}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled
                        className="w-full mt-4 py-2 rounded-xl text-xs font-black bg-slate-100 text-slate-400 cursor-not-allowed"
                      >
                        ไม่สามารถสั่งซื้อในโหมดอ่านอย่างเดียว
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsPackageModalOpen(false)}
                className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-100 rounded-xl font-bold text-xs transition-all cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Line Notification Modal */}
      <LineNotificationModal
        isOpen={isLineModalOpen}
        onClose={() => setIsLineModalOpen(false)}
        bills={bills}
        tenants={tenants}
        rooms={rooms}
        selectedCycle={selectedCycle}
        onAddLog={onAddLog}
        onShowToast={(msg) => setSuccessNotice(msg)}
      />

    </div>
  );
};
