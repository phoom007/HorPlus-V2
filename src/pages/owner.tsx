/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Building as BuildingIcon,
  Users,
  FileText,
  TrendingUp,
  FileSpreadsheet,
  FileCheck2,
  Wrench,
  Megaphone,
  BarChart4,
  ShieldCheck,
  Settings,
  LogOut,
  ChevronRight,
  ChevronLeft,
  Calendar as CalendarIcon,
  Moon,
  Sun,
  Bell,
  Sparkles,
  Menu,
  X,
  Search,
  Droplet,
  Trash2,
  Gauge,
  CreditCard
} from 'lucide-react';

import { User, Room, Tenant, Bill, Contract, MaintenanceRequest, Announcement, AuditLog, Building } from '../types';

// Import sub-modules
import { OwnerDashboard } from './owner/dashboard';
import { OwnerRooms } from './owner/rooms';
import { OwnerTenants } from './owner/tenants';
import { OwnerContracts } from './owner/contracts';
import { OwnerMeters } from './owner/meters';

import { AuthContext } from '../router/guards';
import { normalizeRole } from '../utils/role';
import { OwnerMaintenance } from './owner/maintenance';
import { OwnerAnnouncements } from './owner/announcements';
import { OwnerReports } from './owner/reports';
import { OwnerUsers } from './owner/users';
import { OwnerSettings } from './owner/settings';
import { OwnerRegister } from './owner/register';
import { PaymentsOwnerView } from './owner/payments';
import { SubscriptionPage } from './owner/subscription';
import { fetchAllPaginated, fetchAllPaginatedWithMeta } from '../utils/fetch-paginated';


interface SlidableNotificationItemProps {
  notif: {
    id: string | number;
    title: string;
    description: string;
    time: string;
    tag: string;
    tagColor: string;
  };
  onDelete: (id: string | number) => void;
}

const SlidableNotificationItem: React.FC<SlidableNotificationItemProps> = ({ notif, onDelete }) => {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = React.useRef(0);

  const handleStart = (clientX: number) => {
    startXRef.current = clientX;
    setIsSwiping(true);
  };

  const handleMove = (clientX: number) => {
    if (!isSwiping) return;
    const diff = clientX - startXRef.current;
    if (diff < 0) {
      setOffsetX(Math.max(diff, -140));
    }
  };

  const handleEnd = () => {
    if (!isSwiping) return;
    setIsSwiping(false);
    if (offsetX < -80) {
      onDelete(notif.id);
    }
    setOffsetX(0);
  };

  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-150 border border-transparent select-none group">
      {/* Background deletion panel revealed upon swipe */}
      <div 
        className="absolute inset-y-0 right-0 flex items-center pr-4 text-slate-600 font-extrabold text-xs transition-opacity duration-200 pointer-events-none"
        style={{ opacity: offsetX < -15 ? 1 : 0 }}
      >
        <div className="flex items-center gap-1.5">
          <span className="text-slate-700">ปัดซ้ายเพื่อลบ</span>
          <Trash2 className="w-3.5 h-3.5 animate-bounce text-rose-500" />
        </div>
      </div>

      {/* Foreground slidable content card */}
      <div
        onTouchStart={(e) => handleStart(e.targetTouches[0].clientX)}
        onTouchMove={(e) => handleMove(e.targetTouches[0].clientX)}
        onTouchEnd={handleEnd}
        onMouseDown={(e) => handleStart(e.clientX)}
        onMouseMove={(e) => isSwiping && handleMove(e.clientX)}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        style={{ transform: `translateX(${offsetX}px)` }}
        className="relative bg-white p-2.5 rounded-xl border border-slate-100 hover:border-slate-200 transition-all text-left flex flex-col cursor-grab active:cursor-grabbing z-10"
      >
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border ${notif.tagColor}`}>
            {notif.tag}
          </span>
          <span className="text-[9px] text-slate-400 font-medium ml-auto">{notif.time}</span>
        </div>
        <h5 className="text-xs font-bold text-slate-800 mb-0.5">
          {notif.title}
        </h5>
        <p className="text-[10px] text-slate-500 leading-normal font-medium">{notif.description}</p>
      </div>
    </div>
  );
};

export const UserAvatar: React.FC<{ user: { name?: string; avatar?: string; avatarUrl?: string; picture?: string; email?: string }; className?: string }> = ({ user, className = "w-10 h-10 rounded-full" }) => {
  const [imgError, setImgError] = useState(false);
  const src = user?.avatarUrl || user?.avatar || user?.picture;
  const initial = (user?.name || user?.email || 'U').charAt(0).toUpperCase();

  if (src && !imgError) {
    return (
      <img
        src={src}
        alt={user?.name || 'User'}
        onError={() => setImgError(true)}
        className={`${className} object-cover shrink-0 shadow-2xs`}
      />
    );
  }

  return (
    <div className={`${className} bg-blue-600 text-white font-black flex items-center justify-center text-xs shrink-0 shadow-2xs select-none`}>
      {initial}
    </div>
  );
};

interface OwnerWorkspaceProps {
  user: User;
  onLogout: () => void;
}

export const OwnerWorkspace: React.FC<OwnerWorkspaceProps> = ({
  user,
  onLogout
}) => {
  const { userType, user: sessionUser, onboardingRequired } = React.useContext(AuthContext) || {};
  const navigate = useNavigate();
  const location = useLocation();

  const pathSegment = location.pathname.startsWith('/owner/dormitories/new')
    ? 'dormitories/new'
    : (location.pathname.split('/')[2] || 'dashboard');
  const [activeTab, setActiveTab] = useState(onboardingRequired ? 'register' : pathSegment);

  useEffect(() => {
    console.log('[DEBUG] OwnerWorkspace activeTab updated to:', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (onboardingRequired && pathSegment !== 'register') {
      navigate('/owner/register', { replace: true });
      setActiveTab('register');
    } else if (!onboardingRequired && pathSegment && pathSegment !== activeTab) {
      setActiveTab(pathSegment);
    }
  }, [pathSegment, onboardingRequired, navigate, activeTab]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const mainEl = document.getElementById('owner-main-content');
    if (mainEl) {
      mainEl.scrollTop = 0;
    }
  }, [activeTab, location.pathname]);

  const changeTab = (tabId: string) => {
    setActiveTab(tabId);
    navigate(`/owner/${tabId}`);
  };
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [initialRoomId, setInitialRoomId] = useState<string | undefined>(undefined);
  const [initialTenantId, setInitialTenantId] = useState<string | undefined>(undefined);
  const [initialContractId, setInitialContractId] = useState<string | undefined>(undefined);
  
  // Authoritative Billing Cycle State
  const [billingCycles, setBillingCycles] = useState<any[]>([]);
  const [selectedBillingCycleId, setSelectedBillingCycleId] = useState<string>('');
  const [selectedCycleCode, setSelectedCycleCode] = useState<string>('');
  const [isCycleModalOpen, setIsCycleModalOpen] = useState(false);
  const [tempYear, setTempYear] = useState(new Date().getFullYear());

  const selectedCycle = selectedCycleCode;

  const handlePrevCycle = () => {
    if (billingCycles.length === 0) return;
    const idx = billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode);
    if (idx < billingCycles.length - 1) {
      const prev = billingCycles[idx + 1];
      setSelectedBillingCycleId(prev.id);
      setSelectedCycleCode(prev.cycleCode);
    }
  };

  const handleNextCycle = () => {
    if (billingCycles.length === 0) return;
    const idx = billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode);
    if (idx > 0) {
      const next = billingCycles[idx - 1];
      setSelectedBillingCycleId(next.id);
      setSelectedCycleCode(next.cycleCode);
    }
  };

  const getCycleLabel = (cycle: string) => {
    if (!cycle) return '';
    const parts = cycle.split('-');
    if (parts.length < 2) return cycle;
    const year = parts[0];
    const month = parts[1];
    const mIndex = parseInt(month, 10) - 1;
    const thaiMonthNames = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    if (mIndex >= 0 && mIndex < 12) {
      return `${thaiMonthNames[mIndex]} ${parseInt(year, 10) + 543}`;
    }
    return cycle;
  };

  // Centralized state
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [repairs, setRepairs] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // Header Search State & Safe Calculation
  const [headerSearchQuery, setHeaderSearchQuery] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  const headerSearchResults = React.useMemo(() => {
    const query = headerSearchQuery.trim().toLowerCase();
    if (!query) return [];

    // Search safely by tenant name, room number, or tenant phone
    const matchedTenants = (tenants || []).filter(t => {
      if (!t) return false;
      const name = (t.name || '').toLowerCase();
      const roomNumber = (t.roomNumber || '').toLowerCase();
      const phone = t.phone || '';
      return name.includes(query) || roomNumber.includes(query) || phone.includes(query);
    });

    const matchedRooms = (rooms || []).filter(r => {
      if (!r) return false;
      const roomNumber = (r.roomNumber || '').toLowerCase();
      return roomNumber.includes(query) &&
        !matchedTenants.some(t => (t.roomId && t.roomId === r.id) || (t.roomNumber && t.roomNumber === r.roomNumber));
    });

    return [
      ...matchedTenants.map(t => ({
        type: 'tenant' as const,
        id: t.id,
        tenantId: t.id,
        roomId: t.roomId,
        title: t.name || `ผู้เช่า ${t.id}`,
        subtitle: `ห้อง ${t.roomNumber || '-'}`,
        phone: t.phone || ''
      })),
      ...matchedRooms.map(r => {
        const occupant = (tenants || []).find(t => (t.roomId && t.roomId === r.id) || (t.roomNumber && t.roomNumber === r.roomNumber));
        return {
          type: occupant ? ('tenant' as const) : ('room' as const),
          id: occupant ? occupant.id : r.id,
          tenantId: occupant?.id,
          roomId: r.id,
          title: `ห้อง ${r.roomNumber || '-'}`,
          subtitle: occupant ? (occupant.name || 'ผู้เช่า') : 'ห้องว่าง',
          phone: occupant?.phone || ''
        };
      })
    ].slice(0, 6);
  }, [headerSearchQuery, tenants, rooms]);

  const handleSelectHeaderSearchResult = (result: typeof headerSearchResults[0]) => {
    if (!result) return;
    if (result.tenantId) {
      setInitialTenantId(result.tenantId);
      setActiveTab('tenants');
    } else if (result.roomId) {
      setInitialRoomId(result.roomId);
      setActiveTab('rooms');
    }
    setHeaderSearchQuery('');
    setIsSearchDropdownOpen(false);
  };

  // Badge Alerts logic for Sidebar and Menu
  const currentCycleBills = (bills || []).filter(b => b.cycleId === selectedCycle);
  const occupiedRooms = (rooms || []).filter(r => r.status === 'occupied');
  const hasUnissuedMeters = occupiedRooms.length > 0 && occupiedRooms.some(r => {
    const b = currentCycleBills.find(bill => bill.roomId === r.id);
    return !b || b.status === 'draft';
  });
  const hasPendingSlips = currentCycleBills.some(b => b.status === 'checking');
  const hasPendingMaintenance = (repairs || []).some(r =>
    ['submitted', 'accepted', 'more_info', 'scheduled', 'pending'].includes(r.status)
  );

  // Unviewed tenants state for badge
  const [seenTenantIds, setSeenTenantIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_tenants_${selectedCycle}`);
      return saved ? JSON.parse(saved) : (tenants || []).map(t => t.id);
    } catch {
      return (tenants || []).map(t => t.id);
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_tenants_${selectedCycle}`);
      if (saved) {
        setSeenTenantIds(JSON.parse(saved));
      } else {
        setSeenTenantIds((tenants || []).map(t => t.id));
      }
    } catch {}
  }, [selectedCycle, tenants]);

  const hasUnviewedTenants = (tenants || []).some(t => !seenTenantIds.includes(t.id));

  // Unviewed contracts state for badge
  const [seenContractIds, setSeenContractIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_contracts_${selectedCycle}`);
      return saved ? JSON.parse(saved) : (contracts || []).map(c => c.id);
    } catch {
      return (contracts || []).map(c => c.id);
    }
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`HorPlus_seen_contracts_${selectedCycle}`);
      if (saved) {
        setSeenContractIds(JSON.parse(saved));
      } else {
        setSeenContractIds((contracts || []).map(c => c.id));
      }
    } catch {}
  }, [selectedCycle, contracts]);

  const hasUnviewedContracts = (contracts || []).some(c => !seenContractIds.includes(c.id));

  // Pending contract submissions badge state (0 default when no pending submissions exist)
  // Pending contract submissions badge state (0 default until authoritative backend pending contract endpoint exists)
  const [pendingSubmissionsCount, setPendingSubmissionsCount] = useState<number>(0);

  useEffect(() => {
    setPendingSubmissionsCount(0);
  }, []);

  // Settings completeness status (suppressed until authoritative API settings completeness contract exists)
  const isSettingsIncomplete = false;

  const handleTabChange = (tabId: string) => {
    if (tabId === 'tenants') {
      const allTIds = (tenants || []).map(t => t.id);
      setSeenTenantIds(allTIds);
      localStorage.setItem(`HorPlus_seen_tenants_${selectedCycle}`, JSON.stringify(allTIds));
    } else if (tabId === 'contracts') {
      const allCIds = (contracts || []).map(c => c.id);
      setSeenContractIds(allCIds);
      localStorage.setItem(`HorPlus_seen_contracts_${selectedCycle}`, JSON.stringify(allCIds));
    }
    changeTab(tabId);
    setIsSidebarOpen(false);
  };

  // Notification Bell State (PostgreSQL persistent)
  const [staffNotices, setStaffNotices] = useState<any[]>([]);
  const [staffUnreadCount, setStaffUnreadCount] = useState<number>(0);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const fetchStaffNotifications = async () => {
    if (activeTab === 'register' || onboardingRequired) return;
    const reqHeaders: Record<string, string> = {};
    const savedId = localStorage.getItem('selected_dormitory_id');
    if (savedId) reqHeaders['x-dormitory-id'] = savedId;
    try {
      const res = await fetch('/api/v1/notifications', { headers: reqHeaders, credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStaffNotices(data.notifications || []);
        setStaffUnreadCount(data.unreadCount || 0);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchStaffNotifications();
  }, [activeTab]);

  const hasUnreadNotifications = staffUnreadCount > 0;

  const handleOpenNotifications = () => {
    const nextState = !isNotificationOpen;
    setIsNotificationOpen(nextState);
    if (nextState) {
      fetchStaffNotifications();
    }
  };

  const handleMarkStaffNoticeAsRead = async (id: string) => {
    const reqHeaders: Record<string, string> = {};
    const savedId = localStorage.getItem('selected_dormitory_id');
    if (savedId) reqHeaders['x-dormitory-id'] = savedId;
    try {
      const res = await fetch(`/api/v1/notifications/${id}/read`, { method: 'POST', headers: reqHeaders, credentials: 'include' });
      if (res.ok) {
        setStaffNotices(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
        setStaffUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (e) {}
  };

  const handleMarkAllStaffNoticesAsRead = async () => {
    const reqHeaders: Record<string, string> = {};
    const savedId = localStorage.getItem('selected_dormitory_id');
    if (savedId) reqHeaders['x-dormitory-id'] = savedId;
    try {
      const res = await fetch('/api/v1/notifications/read-all', { method: 'POST', headers: reqHeaders, credentials: 'include' });
      if (res.ok) {
        setStaffNotices(prev => prev.map(n => ({ ...n, isRead: true })));
        setStaffUnreadCount(0);
      }
    } catch (e) {}
  };

  const handleDeleteNotification = async (id: string | number) => {
    const noticeId = String(id);
    const reqHeaders: Record<string, string> = {};
    const savedId = localStorage.getItem('selected_dormitory_id');
    if (savedId) reqHeaders['x-dormitory-id'] = savedId;
    try {
      const res = await fetch(`/api/v1/notifications/${noticeId}/dismiss`, { method: 'POST', headers: reqHeaders, credentials: 'include' });
      if (res.ok) {
        setStaffNotices(prev => prev.filter(n => n.id !== noticeId));
        setStaffUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (e) {
      console.error('[OwnerWorkspace] Error dismissing notification:', e);
    }
  };

  // Load centralized data
  const refreshAllData = async () => {
    if (activeTab === 'register' || onboardingRequired) return;
    let isApiConnected = false;
    const reqHeaders: Record<string, string> = {};
    const savedId = localStorage.getItem('selected_dormitory_id');
    if (savedId) {
      reqHeaders['x-dormitory-id'] = savedId;
    }

    try {
      const loadedRooms = await fetchAllPaginated('/api/v1/properties/rooms', { headers: reqHeaders, credentials: 'include' });
      isApiConnected = true;
      setRooms(loadedRooms);
    } catch {
      setRooms([]);
    }

    try {
      const loadedBuildings = await fetchAllPaginated('/api/v1/properties/buildings', { headers: reqHeaders, credentials: 'include' });
      setBuildings(loadedBuildings);
    } catch {
      setBuildings([]);
    }

    if (isApiConnected) {
      try {
        const [loadedTenants, loadedBills, loadedContracts, loadedRepairs, loadedAnnouncements, cycleResult] = await Promise.all([
          fetchAllPaginated('/api/v1/tenants', { headers: reqHeaders, credentials: 'include' }),
          fetchAllPaginated('/api/v1/bills', { headers: reqHeaders, credentials: 'include' }),
          fetchAllPaginated('/api/v1/contracts', { headers: reqHeaders, credentials: 'include' }),
          fetchAllPaginated('/api/v1/maintenance', { headers: reqHeaders, credentials: 'include' }),
          fetchAllPaginated('/api/v1/announcements', { headers: reqHeaders, credentials: 'include' }),
          fetchAllPaginatedWithMeta('/api/v1/billing-cycles', { headers: reqHeaders, credentials: 'include' }),
        ]);
        setTenants(loadedTenants);
        setBills(loadedBills);
        setContracts(loadedContracts);
        setRepairs(loadedRepairs);
        setAnnouncements(loadedAnnouncements);
        setAuditLogs([]);

        const loadedCycles = cycleResult.data || [];
        setBillingCycles(loadedCycles);

        // Authoritatively initialize selectedBillingCycleId and selectedCycleCode from server resolver
        if (cycleResult.operationalBillingCycleId && cycleResult.operationalCycleCode) {
          setSelectedBillingCycleId(cycleResult.operationalBillingCycleId);
          setSelectedCycleCode(cycleResult.operationalCycleCode);
        } else if (loadedCycles.length > 0) {
          setSelectedBillingCycleId(loadedCycles[0].id);
          setSelectedCycleCode(loadedCycles[0].cycleCode);
        }
      } catch {
        setTenants([]);
        setBills([]);
        setContracts([]);
        setRepairs([]);
        setAnnouncements([]);
        setAuditLogs([]);
        setBillingCycles([]);
      }
    } else {
      setTenants([]);
      setBills([]);
      setContracts([]);
      setRepairs([]);
      setAnnouncements([]);
      setAuditLogs([]);
      setBillingCycles([]);
    }
  };

  useEffect(() => {
    refreshAllData();

    // Listen to localStorage changes to sync in real-time if multiple tabs/frames are open
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key && e.key.includes('HorPlus_')) {
        refreshAllData();
      }
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleAddLog = (action: string, details: string, type: string, id: string) => {
    
    setAuditLogs([]);
  };

  // State saving handlers
  const handleSaveRooms = (newRooms: Room[]) => {
    
    setRooms(newRooms);
  };

  const handleSaveBuildings = (newBuildings: Building[]) => {
    setBuildings(newBuildings);
  };

  const handleSaveTenants = (newTenants: Tenant[]) => {
    
    setTenants(newTenants);
  };

  const handleSaveBills = (newBills: Bill[]) => {
    
    setBills(newBills);
  };

  const handleSaveContracts = (newContracts: Contract[]) => {
    
    setContracts(newContracts);
  };

  const handleSaveRepairs = (newRepairs: any[]) => {
    
    setRepairs(newRepairs);
  };

  const handleSaveAnnouncements = (newAnnouncements: Announcement[]) => {
    
    setAnnouncements(newAnnouncements);
  };

  // Sidebar Menu Items with role boundaries
  const menuItems = [
    { id: 'register', label: 'ลงทะเบียน', icon: FileSpreadsheet, roles: ['owner', 'manager'] },
    { id: 'dashboard', label: 'หน้าหลัก', icon: LayoutDashboard, roles: ['owner', 'manager', 'staff'] },
    { id: 'meters', label: 'จดมิเตอร์', icon: Gauge, roles: ['owner', 'manager', 'staff'] },
    { id: 'payments', label: 'การชำระเงิน', icon: FileCheck2, roles: ['owner', 'manager'] },
    { id: 'rooms', label: 'ห้องพัก', icon: BuildingIcon, roles: ['owner', 'manager'] },
    { id: 'tenants', label: 'ผู้เช่า', icon: Users, roles: ['owner', 'manager'] },
    { id: 'contracts', label: 'สัญญาเช่า', icon: FileText, roles: ['owner', 'manager'] },
    { id: 'maintenance', label: 'งานแจ้งซ่อม', icon: Wrench, roles: ['owner', 'manager', 'staff'] },
    { id: 'announcements', label: 'ประชาสัมพันธ์', icon: Megaphone, roles: ['owner', 'manager'] },
    { id: 'reports', label: 'รายงานสถิติ', icon: BarChart4, roles: ['owner', 'manager'] },
    { id: 'users', label: 'จัดการผู้ใช้งาน', icon: ShieldCheck, roles: ['owner'] },
    { id: 'subscription', label: 'Subscription / แพ็กเกจ', icon: CreditCard, roles: ['owner'] },
    { id: 'settings', label: 'ตั้งค่าระบบ', icon: Settings, roles: ['owner'] }
  ];

  // Dynamic Active Dormitory Context Resolution
  const authCtx = React.useContext(AuthContext) || {};
  const memberships: any[] = authCtx.memberships || authCtx.user?.memberships || [];
  
  // Resolve selected dormitory ID dynamically from authorized memberships
  const savedDormId = sessionStorage.getItem('active_dormitory_selected_for_session') || localStorage.getItem('selected_dormitory_id');
  const activeMemberships = memberships.filter((m: any) => !m.status || String(m.status).toLowerCase() === 'active');
  
  const validDormId = activeMemberships.find((m: any) => m.dormitoryId === savedDormId)?.dormitoryId 
    || activeMemberships[0]?.dormitoryId 
    || authCtx.dormitoryId;

  // Ensure invalid placeholder defaults are cleared
  const activeDormitoryId = (validDormId && validDormId !== 'dorm-1' && validDormId !== 'dorm-001')
    ? validDormId
    : (activeMemberships[0]?.dormitoryId || validDormId);

  useEffect(() => {
    if (activeDormitoryId && activeDormitoryId !== 'dorm-1' && activeDormitoryId !== 'dorm-001') {
      localStorage.setItem('selected_dormitory_id', activeDormitoryId);
    }
  }, [activeDormitoryId]);

  // Find membership for active dormitory
  const activeMembership = activeMemberships.find((m: any) => m.dormitoryId === activeDormitoryId) || activeMemberships[0];

  // Authoritative Role Normalization (Fail-Closed: returns null if unmapped)
  const rawRole = activeMembership?.roleCode || (typeof activeMembership?.role === 'object' ? activeMembership?.role?.code : activeMembership?.role) || authCtx.user?.roleCode || (typeof authCtx.user?.role === 'object' ? authCtx.user?.role?.code : authCtx.user?.role) || user?.roleId || user?.role || (authCtx.userType === 'owner' ? 'OWNER' : undefined) || 'OWNER';
  const userRole = normalizeRole(rawRole);

  // Fail-closed menu filtering: empty list if role is unmapped/unresolved
  let allowedMenuItems = userRole ? menuItems.filter(item => item.roles.includes(userRole)) : [];
  if (!onboardingRequired) {
    allowedMenuItems = allowedMenuItems.filter(item => item.id !== 'register');
  }

  // Determine current component to render
  const [meterReadings, setMeterReadings] = useState<any[]>([]);

  useEffect(() => {
    if (selectedBillingCycleId) {
      const reqHeaders: Record<string, string> = {};
      const savedId = localStorage.getItem('selected_dormitory_id');
      if (savedId) reqHeaders['x-dormitory-id'] = savedId;
      fetch(`/api/v1/meters/readings?billingCycleId=${selectedBillingCycleId}&pageSize=200`, { headers: reqHeaders, credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(data => setMeterReadings(data?.data || []))
        .catch(() => setMeterReadings([]));
    } else {
      setMeterReadings([]);
    }
  }, [selectedBillingCycleId]);

  const renderSubView = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <OwnerDashboard
            rooms={rooms}
            bills={bills}
            maintenance={repairs}
            contracts={contracts}
            tenants={tenants}
            activeUser={user}
            selectedCycle={selectedCycleCode}
            selectedBillingCycle={billingCycles.find(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode)}
            meterReadings={meterReadings}
            setSelectedCycle={(c: string) => setSelectedCycleCode(c)}
            onAddLog={handleAddLog}
            onNavigate={(tab, param) => {
              if (param) setInitialRoomId(param);
              changeTab(tab);
            }}
          />
        );
      case 'register':
        return (
          <OwnerRegister
            onAddLog={handleAddLog}
            onNavigate={(tab) => changeTab(tab)}
          />
        );
      case 'dormitories/new':
        return (
          <OwnerRegister
            mode="add_dorm"
            onAddLog={handleAddLog}
            onNavigate={(tab) => changeTab(tab)}
          />
        );
      case 'rooms':
        return (
          <OwnerRooms
            rooms={rooms}
            tenants={tenants}
            contracts={contracts}
            bills={bills}
            buildings={buildings}
            onSaveRooms={handleSaveRooms}
            onSaveBuildings={handleSaveBuildings}
            onAddLog={handleAddLog}
            onNavigate={(tab) => changeTab(tab)}
            initialRoomId={initialRoomId}
            onClearInitialRoomId={() => setInitialRoomId(undefined)}
          />
        );
      case 'tenants':
        return (
          <OwnerTenants
            tenants={tenants}
            rooms={rooms}
            bills={bills}
            contracts={contracts}
            selectedCycle={selectedCycleCode}
            onSaveTenants={handleSaveTenants}
            onSaveRooms={handleSaveRooms}
            onSaveContracts={handleSaveContracts}
            onSaveBills={handleSaveBills}
            onAddLog={handleAddLog}
            initialTenantId={initialTenantId}
            onClearInitialTenantId={() => setInitialTenantId(undefined)}
            onBackToMeters={() => changeTab('meters')}
            onViewContract={(contractId, tenantId) => {
              setInitialContractId(contractId);
              if (tenantId) {
                setInitialTenantId(tenantId);
              }
              changeTab('contracts');
            }}
          />
        );
      case 'contracts':
        return (
          <OwnerContracts
            contracts={contracts}
            tenants={tenants}
            rooms={rooms}
            bills={bills}
            selectedCycle={selectedCycleCode}
            onSaveContracts={handleSaveContracts}
            onSaveTenants={handleSaveTenants}
            onSaveRooms={handleSaveRooms}
            onSaveBills={handleSaveBills}
            onAddLog={handleAddLog}
            initialContractId={initialContractId}
            onClearInitialContractId={() => setInitialContractId(undefined)}
            onBackToTenants={(tenantId) => {
              if (tenantId) {
                setInitialTenantId(tenantId);
              }
              changeTab('tenants');
            }}
          />
        );
      case 'meters':
        return (
          <OwnerMeters
            rooms={rooms}
            bills={bills}
            tenants={tenants}
            contracts={contracts}
            onSaveBills={handleSaveBills}
            onSelectTenant={(tId) => {
              setInitialTenantId(tId);
              changeTab('tenants');
            }}
            onAddLog={handleAddLog}
            onNavigate={(tab) => changeTab(tab)}
            selectedCycle={selectedCycleCode}
            selectedBillingCycleId={selectedBillingCycleId || billingCycles.find(c => c.cycleCode === selectedCycleCode)?.id}
            selectedCycleCode={selectedCycleCode}
            onRefetchData={refreshAllData}
          />
        );
      case 'payments':
        return <PaymentsOwnerView bills={bills} rooms={rooms} dormitoryId={activeDormitoryId} onUpdateBills={refreshAllData} />;

      case 'maintenance':
        return (
          <OwnerMaintenance
            repairs={repairs}
            rooms={rooms}
            tenants={tenants}
            onSaveRepairs={handleSaveRepairs}
            onAddLog={handleAddLog}
          />
        );
      case 'announcements':
        return (
          <OwnerAnnouncements
            announcements={announcements}
            onSaveAnnouncements={handleSaveAnnouncements}
            onAddLog={handleAddLog}
            currentUser={user}
            rooms={rooms}
            buildings={buildings}
          />
        );
      case 'reports':
        return (
          <OwnerReports
            rooms={rooms}
            bills={bills}
            buildings={buildings}
            tenants={tenants}
            contracts={contracts}
            selectedBillingCycleId={selectedBillingCycleId}
            selectedCycleCode={selectedCycleCode}
            selectedCycle={selectedCycleCode}
            onNavigate={(tab, param) => {
              setActiveTab(tab);
              if (param) setInitialRoomId(param);
            }}
          />
        );
      case 'users':
        return <OwnerUsers onAddLog={handleAddLog} />;
      case 'subscription':
        return <SubscriptionPage dormitoryId={validDormId} />;
      case 'settings':
        return (
          <OwnerSettings
            onAddLog={handleAddLog}
            onRefreshData={refreshAllData}
            selectedCycle={selectedCycle}
            onCycleChange={(c: string) => setSelectedCycleCode(c)}
          />
        );
      default:
        return <div className="p-8 text-center text-gray-400">อยู่ระหว่างปรับปรุง</div>;
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex relative">
      {/* Mobile Sidebar Overlay Drawer */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-[100] flex lg:hidden">
          {/* Backdrop overlay */}
          <div 
            className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity duration-300"
            onClick={() => setIsSidebarOpen(false)}
          />
          
          {/* Drawer container */}
          <aside className="relative flex w-64 max-w-[280px] h-full flex-col justify-between bg-white p-4 text-slate-600 border-r border-slate-100 animate-in slide-in-from-left duration-200">
            <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-4">
              {/* Logo block with Close button */}
              <div className="flex items-center justify-between px-2 py-1">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#2b64f6] text-white flex items-center justify-center font-extrabold shadow-md shadow-blue-500/10 shrink-0">
                    <BuildingIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h1 className="text-sm font-extrabold text-slate-900 tracking-tight leading-none">HorPlus</h1>
                    <span className="text-[10px] text-slate-400 font-bold block mt-1 leading-none">ระบบจัดการที่พักครบวงจร</span>
                  </div>
                </div>
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-50 transition-colors"
                  aria-label="ปิดเมนู"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider px-2">MAIN MENU</div>

              {/* Navigation links */}
              <nav className="flex-1 space-y-1 p-3 overflow-y-auto custom-scrollbar-thin">
                {allowedMenuItems.map((item) => {
                  const isDisabled = onboardingRequired && item.id !== 'register';
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  const hasItemBadge = (
                    (item.id === 'meters' && hasUnissuedMeters) ||
                    (item.id === 'payments' && hasPendingSlips) ||
                    (item.id === 'tenants' && hasUnviewedTenants) ||
                    (item.id === 'contracts' && (hasUnviewedContracts || pendingSubmissionsCount > 0)) ||
                    (item.id === 'maintenance' && hasPendingMaintenance) ||
                    (item.id === 'settings' && isSettingsIncomplete)
                  );
                  return (
                    <button
                      key={item.id}
                      data-testid={`nav-item-${item.id}`}
                      onClick={() => { if (!isDisabled) handleTabChange(item.id) }}
                      title={isDisabled ? 'กรุณาลงทะเบียนหอพักให้เสร็จก่อนใช้งานเมนูนี้' : ''}
                      disabled={isDisabled}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                        isActive 
                          ? 'bg-[#2b64f6] text-white shadow-md shadow-blue-500/20' 
                          : isDisabled
                            ? 'text-slate-300 cursor-not-allowed opacity-60'
                            : 'hover:bg-slate-50 hover:text-slate-900 text-slate-500'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span>{item.label}</span>
                      </div>
                      {hasItemBadge && !isDisabled && (
                        <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            {/* User Account context with Logout */}
            <div className="pt-4 border-t border-slate-100 shrink-0">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider px-2 mb-2">ACCOUNT</div>
              <div className="flex items-center gap-3 px-1 mb-4">
                <UserAvatar user={user} className="w-10 h-10 rounded-full border-2 border-blue-100" />
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-slate-900 truncate leading-tight">{user.name}</p>
                  <span className="text-[10px] text-slate-500 font-bold block mt-1 leading-none">{user.roleName}</span>
                </div>
              </div>

              <button
                onClick={onLogout}
                className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                ออกจากระบบ
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar Navigation */}
      <aside className="hidden lg:flex w-64 h-full max-h-screen bg-white text-slate-600 border-r border-slate-150/40 shrink-0 flex-col justify-between p-4 z-10 shadow-xs">
        <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-4">
          {/* Logo block */}
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-9 h-9 rounded-xl bg-[#2b64f6] text-white flex items-center justify-center font-extrabold shadow-md shadow-blue-500/15 shrink-0">
              <BuildingIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-extrabold text-slate-900 tracking-tight leading-none">HorPlus</h1>
              <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider block mt-1 leading-none">ระบบจัดการที่พักครบวงจร</span>
            </div>
          </div>

          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider px-2 pt-2">MAIN MENU</div>

          {/* Navigation links */}
          <nav className="space-y-1">
            {allowedMenuItems.map((item) => {
              const isDisabled = onboardingRequired && item.id !== 'register';
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const hasItemBadge = (
                (item.id === 'meters' && hasUnissuedMeters) ||
                (item.id === 'payments' && hasPendingSlips) ||
                (item.id === 'tenants' && hasUnviewedTenants) ||
                (item.id === 'contracts' && (hasUnviewedContracts || pendingSubmissionsCount > 0)) ||
                (item.id === 'maintenance' && hasPendingMaintenance) ||
                (item.id === 'settings' && isSettingsIncomplete)
              );
              return (
                <button
                  key={item.id}
                  data-testid={`nav-item-${item.id}`}
                  onClick={() => { if (!isDisabled) handleTabChange(item.id) }}
                  title={isDisabled ? 'กรุณาลงทะเบียนหอพักให้เสร็จก่อนใช้งานเมนูนี้' : ''}
                  disabled={isDisabled}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    isActive 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20' 
                      : isDisabled
                        ? 'text-slate-300 cursor-not-allowed opacity-60'
                        : 'hover:bg-slate-50 hover:text-slate-900 text-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{item.label}</span>
                  </div>
                  {hasItemBadge && !isDisabled && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Account context with Logout */}
        <div className="pt-4 border-t border-slate-100 shrink-0">
          <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider px-2 mb-2">ACCOUNT</div>
          <div className="flex items-center gap-3 px-1 mb-4">
            <UserAvatar user={user} className="w-10 h-10 rounded-full border-2 border-blue-100" />
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-slate-900 truncate leading-tight">{user.name}</p>
              <span className="text-[10px] text-slate-500 font-bold block mt-1 leading-none">{user.roleName}</span>
            </div>
          </div>

          <button
            onClick={onLogout}
            className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Pilot Disclosure Banner */}
        <div className="bg-amber-500/10 border-b border-amber-200/50 px-4 py-1.5 text-center text-[11px] font-medium text-amber-900 flex items-center justify-center gap-2 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>
            <strong>ระบบทดลองใช้งาน HorPlus Pilot</strong> — เซิร์ฟเวอร์นี้ต้องมีผู้ดูแลเปิด Docker Desktop หลัง Windows Restart | SlipOK Live ยังไม่เปิดใช้งาน
          </span>
        </div>

        {/* Top bar header */}
        <header className="bg-white border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between px-3.5 sm:px-6 py-2.5 sm:py-3 shrink-0 z-30 gap-2.5 sm:gap-3">
          {/* Left Block: Hamburger & Logo */}
          <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0 shrink-0">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
              {/* Mobile/Tablet Hamburger Menu Toggle */}
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-1.5 -ml-1 text-slate-500 hover:bg-slate-50 hover:text-slate-800 rounded-xl transition-colors shrink-0 cursor-pointer"
                aria-label="เปิดเมนู"
              >
                <Menu className="w-5 h-5" />
              </button>
              
              {/* HorPlus Logo block */}
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="min-w-0">
                  <h1 className="text-xs sm:text-sm font-black text-slate-800 tracking-tight leading-tight flex items-center gap-1 min-w-0">
                    <span className="shrink-0 font-extrabold text-blue-600">HorPlus</span>
                    <span className="text-[8px] sm:text-[9px] font-black bg-blue-50 text-blue-600 border border-blue-100 px-1 py-0.5 rounded-md uppercase truncate max-w-[85px] sm:max-w-none shrink-0">
                      {menuItems.find(m => m.id === activeTab)?.label}
                    </span>
                  </h1>
                  <span className="text-[9px] text-slate-400 font-bold hidden xs:block mt-0.5 leading-none truncate">
                    ระบบจัดการหอพักครบวงจร
                  </span>
                </div>
              </div>
            </div>

            {/* Mobile Actions Right Side on XS screen (< sm) */}
            <div className="flex items-center gap-1.5 sm:hidden relative shrink-0">

              <div className="relative">
                <button
                  onClick={() => setIsSearchDropdownOpen(!isSearchDropdownOpen)}
                  className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                  title="ค้นหา"
                >
                  <Search className="w-4 h-4" />
                </button>

                {isSearchDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsSearchDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 bg-white p-2.5 rounded-2xl border border-slate-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                      <div className="relative mb-2">
                        <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          autoFocus
                          value={headerSearchQuery}
                          onChange={(e) => setHeaderSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && headerSearchResults.length > 0) {
                              handleSelectHeaderSearchResult(headerSearchResults[0]);
                            }
                          }}
                          placeholder="ค้นหาชื่อผู้เช่า / เลขห้อง..."
                          className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200/80 rounded-xl w-full focus:bg-white focus:border-blue-500 transition-all outline-none text-slate-700 font-medium"
                        />
                      </div>
                      <div className="max-h-60 overflow-y-auto space-y-1">
                        {headerSearchResults.map((res) => (
                          <button
                            key={`xs-${res.type}-${res.id}`}
                            onClick={() => handleSelectHeaderSearchResult(res)}
                            className="w-full text-left p-2 hover:bg-blue-50/70 rounded-xl transition-colors flex items-center justify-between group cursor-pointer"
                          >
                            <div className="min-w-0 pr-2">
                              <p className="text-xs font-black text-slate-800 group-hover:text-blue-600 truncate">
                                {res.title}
                              </p>
                              <p className="text-[10px] text-slate-400 font-medium truncate">
                                {res.subtitle} {res.phone ? `• ${res.phone}` : ''}
                              </p>
                            </div>
                            <span className="text-[9px] font-black text-blue-600 bg-blue-50 group-hover:bg-blue-100 px-2 py-0.5 rounded-lg shrink-0">
                              ดูข้อมูล
                            </span>
                          </button>
                        ))}
                        {headerSearchQuery.trim().length > 0 && headerSearchResults.length === 0 && (
                          <div className="p-3 text-center text-xs text-slate-400 font-medium">
                            ไม่พบข้อมูล
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button 
                  onClick={handleOpenNotifications}
                  data-testid="button-staff-notification-bell"
                  aria-label="การแจ้งเตือนพนักงาน"
                  className="p-1.5 text-slate-400 hover:text-slate-800 rounded-xl relative hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <Bell className="w-4 h-4" />
                  {hasUnreadNotifications && (
                    <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                  )}
                </button>
              </div>

              <button 
                onClick={() => setActiveTab(userRole === 'owner' ? 'settings' : 'dashboard')}
                className="focus:outline-none hover:opacity-80 transition-opacity cursor-pointer flex items-center shrink-0"
                title={userRole === 'owner' ? "ตั้งค่าระบบ" : "หน้าหลัก"}
              >
                <UserAvatar user={user} className="w-7 h-7 rounded-full border border-slate-100" />
              </button>
            </div>
          </div>

          {/* Center Block: Month Selector Switcher Tab bar */}
          <div className="relative flex items-center justify-center w-full sm:w-auto shrink-0 z-20">
            <div className="flex items-center justify-between bg-slate-100/80 p-1 rounded-2xl border border-slate-200/50 w-full sm:w-auto sm:min-w-[260px] gap-1">
              <button 
                onClick={handlePrevCycle}
                disabled={billingCycles.length === 0 || billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode) >= billingCycles.length - 1}
                className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer ${
                  billingCycles.length === 0 || billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode) >= billingCycles.length - 1 ? 'opacity-25 cursor-not-allowed' : ''
                }`}
                aria-label="ก่อนหน้า"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              
              <button 
                onClick={() => {
                  setIsCycleModalOpen(!isCycleModalOpen);
                }}
                className={`flex items-center justify-center gap-1.5 px-2.5 py-1 rounded-xl font-extrabold text-xs text-slate-700 transition-all cursor-pointer flex-1 sm:flex-initial ${isCycleModalOpen ? 'bg-white shadow-xs' : 'hover:bg-white/80'}`}
                title="คลิกเพื่อเลือกงวดประจำเดือน"
                data-testid="selected-cycle-display-button"
                data-cycle-id={selectedBillingCycleId}
                data-cycle-code={selectedCycleCode}
              >
                <CalendarIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="truncate" data-testid="selected-cycle-label">{selectedCycleCode ? `ประจำเดือน ${getCycleLabel(selectedCycleCode)}` : 'ยังไม่ได้ตั้งค่ารอบคำนวณ'}</span>
              </button>

              <button 
                onClick={handleNextCycle}
                disabled={billingCycles.length === 0 || billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode) <= 0}
                className={`p-1.5 hover:bg-white text-slate-500 hover:text-slate-900 rounded-xl transition-all cursor-pointer ${
                  billingCycles.length === 0 || billingCycles.findIndex(c => c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode) <= 0 ? 'opacity-25 cursor-not-allowed' : ''
                }`}
                aria-label="ถัดไป"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Dynamic Billing Cycle Selector Dropdown */}
            {isCycleModalOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40 cursor-default" 
                  onClick={() => setIsCycleModalOpen(false)} 
                />
                
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white p-5 rounded-3xl w-[calc(100vw-2rem)] max-w-sm border border-slate-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xs font-black text-slate-800">เลือกงวดประจำเดือน</h3>
                    <button 
                      onClick={() => setIsCycleModalOpen(false)}
                      className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      ปิด
                    </button>
                  </div>

                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {billingCycles.map((c) => {
                      const isSelected = c.id === selectedBillingCycleId || c.cycleCode === selectedCycleCode;
                      return (
                        <button
                          key={c.id || c.cycleCode}
                          data-testid={`cycle-option-${c.cycleCode}`}
                          data-cycle-id={c.id}
                          data-cycle-code={c.cycleCode}
                          onClick={() => {
                            setSelectedBillingCycleId(c.id);
                            setSelectedCycleCode(c.cycleCode);
                            setIsCycleModalOpen(false);
                          }}
                          className={`w-full py-2 px-3 text-left text-xs font-bold rounded-xl transition-all flex items-center justify-between ${
                            isSelected 
                              ? 'bg-blue-600 text-white shadow-sm' 
                              : 'bg-slate-50 hover:bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span>ประจำเดือน {getCycleLabel(c.cycleCode)}</span>
                          <span className="text-[10px] opacity-75">{c.status === 'closed' ? 'ปิดรอบแล้ว' : 'เปิดรอบชำระ'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right Block: Desktop & Tablet Action Bar (>= sm) */}
          <div className="hidden sm:flex items-center gap-2 shrink-0">
            {/* LINE Push Quota Badge (Compact) */}

            {/* Search Icon Button (like mobile view, opens popup dropdown) */}
            <div className="relative">
              <button
                onClick={() => setIsSearchDropdownOpen(!isSearchDropdownOpen)}
                className="p-2 text-slate-400 hover:text-slate-800 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                title="ค้นหาผู้เช่า / เลขห้อง"
              >
                <Search className="w-4 h-4" />
              </button>

              {isSearchDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsSearchDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-white p-3 rounded-2xl border border-slate-100 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="relative mb-2.5">
                      <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        value={headerSearchQuery}
                        onChange={(e) => setHeaderSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && headerSearchResults.length > 0) {
                            handleSelectHeaderSearchResult(headerSearchResults[0]);
                          }
                        }}
                        placeholder="ค้นหาชื่อผู้เช่า / เลขห้อง..."
                        className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200/80 rounded-xl w-full focus:bg-white focus:border-blue-500 transition-all outline-none text-slate-700 font-medium"
                      />
                    </div>
                    <div className="max-h-64 overflow-y-auto space-y-1">
                      {headerSearchResults.map((res) => (
                        <button
                          key={`sm-${res.type}-${res.id}`}
                          onClick={() => handleSelectHeaderSearchResult(res)}
                          className="w-full text-left p-2.5 hover:bg-blue-50/70 rounded-xl transition-colors flex items-center justify-between group cursor-pointer"
                        >
                          <div className="min-w-0 pr-2">
                            <p className="text-xs font-black text-slate-800 group-hover:text-blue-600 truncate">
                              {res.title}
                            </p>
                            <p className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
                              {res.subtitle} {res.phone ? `• ${res.phone}` : ''}
                            </p>
                          </div>
                          <span className="text-[9px] font-black text-blue-600 bg-blue-50 group-hover:bg-blue-100 px-2 py-0.5 rounded-lg shrink-0">
                            ดูข้อมูล
                          </span>
                        </button>
                      ))}
                      {headerSearchQuery.trim().length > 0 && headerSearchResults.length === 0 && (
                        <div className="p-4 text-center text-xs text-slate-400 font-medium">
                          ไม่พบข้อมูลผู้เช่าหรือห้องพัก
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Notification Bell */}
            <div className="relative">
              <button 
                onClick={handleOpenNotifications}
                data-testid="button-staff-notification-bell"
                aria-label="การแจ้งเตือนพนักงาน"
                className="p-2 text-slate-400 hover:text-slate-800 rounded-xl relative hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {hasUnreadNotifications && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                )}
              </button>

              {isNotificationOpen && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setIsNotificationOpen(false)} />
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl border border-slate-100 shadow-xl z-[70] p-4 animate-in fade-in slide-in-from-top-2 duration-150">
                    <div className="flex justify-between items-center pb-2.5 border-b border-slate-100 mb-3">
                      <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5 text-blue-600" />
                        การแจ้งเตือน
                      </h4>
                      <button 
                        onClick={() => setIsNotificationOpen(false)}
                        className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
                      >
                        ปิด
                      </button>
                    </div>

                    <div className="text-[10px] font-medium text-amber-800 bg-amber-50 p-2 rounded-xl border border-amber-200 flex items-center justify-between mb-2">
                      <span>💡 <strong>คำแนะนำ:</strong> ปัดซ้ายที่รายการแจ้งเตือนเพื่อลบข้อความ</span>
                    </div>

                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {staffNotices.map((notif) => (
                        <div key={notif.id} data-testid={`staff-notice-item-${notif.id}`}>
                          <SlidableNotificationItem
                            notif={{
                              id: notif.id,
                              title: notif.title,
                              description: notif.body,
                              time: new Date(notif.createdAt).toLocaleDateString('th-TH'),
                              tag: notif.category || 'แจ้งเตือน',
                              tagColor: 'bg-blue-100 text-blue-800 border-blue-200',
                            }}
                            onDelete={handleDeleteNotification}
                          />
                          {!notif.isRead && (
                            <div className="flex justify-end pt-1 pr-1">
                              <button
                                type="button"
                                data-testid={`button-staff-notice-read-${notif.id}`}
                                onClick={() => handleMarkStaffNoticeAsRead(notif.id)}
                                className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[9px] font-extrabold transition-all cursor-pointer"
                              >
                                อ่านแล้ว
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {staffNotices.length === 0 && (
                        <div className="text-center py-10 text-slate-400 text-xs font-medium">
                          ไม่มีข้อความแจ้งเตือนใหม่
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="h-5 w-px bg-slate-100 my-auto" />
            
            {/* User Profile Avatar */}
            <button
              onClick={() => setActiveTab(userRole === 'owner' ? 'settings' : 'dashboard')}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity cursor-pointer focus:outline-none text-left"
              title={userRole === 'owner' ? "ตั้งค่าระบบ" : "หน้าหลัก"}
            >
              <UserAvatar user={user} className="w-7.5 h-7.5 rounded-full border border-slate-100" />
              <div className="hidden xl:block leading-none text-left">
                <p className="text-xs font-bold text-slate-800">{user.name}</p>
                <span className="text-[9px] text-slate-400 font-bold">{user.roleName}</span>
              </div>
            </button>
          </div>
        </header>

        {/* Dynamic page container */}
        <main id="owner-main-content" className="flex-1 overflow-y-auto bg-slate-50/70 p-4 md:p-6 pb-24 md:pb-6">
          {renderSubView()}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Responsive & Role-based) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-100 z-40 py-2 pb-safe px-4 shadow-[0_-4px_12px_rgba(0,0,0,0.03)]">
        <div className="flex justify-around items-center">
          {(() => {
            const maxItems = 5;
            const showMore = allowedMenuItems.length > maxItems;
            let itemsToRender = allowedMenuItems;
            if (showMore) {
              const selectedIds = ['dashboard', 'meters', 'payments', 'rooms'];
              itemsToRender = selectedIds
                .map(id => allowedMenuItems.find(item => item.id === id))
                .filter((item): item is typeof allowedMenuItems[number] => !!item);
            }

            return (
              <>
                {itemsToRender.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
                        isActive ? 'text-[#2b64f6] font-extrabold scale-105' : 'text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-[2px]'}`} />
                      <span className="text-[9px] font-bold tracking-tight">{item.label}</span>
                    </button>
                  );
                })}
                {showMore && (
                  <button
                    onClick={() => setIsSidebarOpen(true)}
                    className="flex flex-col items-center gap-1 py-1 px-3 rounded-xl text-slate-400 hover:text-slate-600"
                  >
                    <Menu className="w-5 h-5 stroke-[2px]" />
                    <span className="text-[9px] font-bold tracking-tight">เมนูทั้งหมด</span>
                  </button>
                )}
              </>
            );
          })()}
        </div>
      </div>

    </div>
  );
};

