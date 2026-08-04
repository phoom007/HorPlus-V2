/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  FileText,
  TrendingUp,
  Wrench,
  User,
  Bell,
  Megaphone,
  CreditCard,
  QrCode,
  DollarSign,
  CheckCircle,
  FileCheck2,
  Trash2,
  Camera,
  Sparkles,
  Phone,
  Check,
  AlertCircle,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  Zap,
  Droplet,
  History,
  Download,
  Copy,
  Calendar,
  Info,
  Folder,
  Upload,
  Building as BuildingIcon,
  Pin,
  Plug,
  CheckCircle2,
  Shield,
  UserCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend
} from 'recharts';
import {
  StatusBadge,
  formatBaht,
  formatThaiDate,
  Modal,
  PrintView
} from '../components/GlobalComponents';

import { Tenant, Room, Bill, Contract, MaintenanceRequest as RepairRequest, Announcement, Dormitory, BillItem, Building, formatItemDescription } from '../types';
import { getRooms, getBills, getContracts, getMaintenance, getAnnouncements, getBuildings } from '../data/mockData';

const getBankBadgeInfo = (bankName: string) => {
  const name = bankName || 'กสิกรไทย (KBank)';
  if (name.includes('Krungthai') || name.includes('กรุงไทย')) {
    return { label: 'KTB', bg: 'bg-sky-600 border-sky-500 text-white', name: 'ธนาคารกรุงไทย' };
  }
  if (name.includes('KBank') || name.includes('กสิกรไทย')) {
    return { label: 'KBANK', bg: 'bg-emerald-600 border-emerald-500 text-white', name: 'ธนาคารกสิกรไทย' };
  }
  if (name.includes('Bangkok') || name.includes('กรุงเทพ')) {
    return { label: 'BBL', bg: 'bg-blue-900 border-blue-800 text-white', name: 'ธนาคารกรุงเทพ' };
  }
  if (name.includes('SCB') || name.includes('ไทยพาณิชย์')) {
    return { label: 'SCB', bg: 'bg-purple-800 border-purple-700 text-white', name: 'ธนาคารไทยพาณิชย์' };
  }
  if (name.includes('Krungsri') || name.includes('กรุงศรี')) {
    return { label: 'BAY', bg: 'bg-amber-400 border-amber-300 text-amber-950', name: 'ธนาคารกรุงศรีอยุธยา' };
  }
  if (name.includes('ttb') || name.includes('ทหารไทยธนชาต')) {
    return { label: 'TTB', bg: 'bg-blue-600 border-blue-500 text-white', name: 'ธนาคารทหารไทยธนชาต' };
  }
  if (name.includes('UOB') || name.includes('ยูโอบี')) {
    return { label: 'UOB', bg: 'bg-sky-900 border-sky-800 text-white', name: 'ธนาคารยูโอบี' };
  }
  if (name.includes('CIMB') || name.includes('ซีไอเอ็มบี')) {
    return { label: 'CIMB', bg: 'bg-red-700 border-red-600 text-white', name: 'ธนาคารซีไอเอ็มบี ไทย' };
  }
  if (name.includes('LH Bank') || name.includes('แลนด์ แอนด์ เฮ้าส์')) {
    return { label: 'LHB', bg: 'bg-teal-700 border-teal-600 text-white', name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์' };
  }
  if (name.includes('KKP') || name.includes('เกียรตินาคิน')) {
    return { label: 'KKP', bg: 'bg-violet-700 border-violet-600 text-white', name: 'ธนาคารเกียรตินาคินภัทร' };
  }
  if (name.includes('TISCO') || name.includes('ทิสโก้')) {
    return { label: 'TISCO', bg: 'bg-cyan-700 border-cyan-600 text-white', name: 'ธนาคารทิสโก้' };
  }
  if (name.includes('ICBC') || name.includes('ไอซีบีซี')) {
    return { label: 'ICBC', bg: 'bg-red-800 border-red-700 text-white', name: 'ธนาคารไอซีบีซี (ไทย)' };
  }
  if (name.includes('GSBk') || name.includes('ออมสิน')) {
    return { label: 'GSB', bg: 'bg-pink-500 border-pink-400 text-white', name: 'ธนาคารออมสิน' };
  }
  if (name.includes('BAAC') || name.includes('ธ.ก.ส.')) {
    return { label: 'BAAC', bg: 'bg-green-700 border-green-600 text-white', name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร' };
  }
  if (name.includes('GH Bank') || name.includes('ธอส.')) {
    return { label: 'GHB', bg: 'bg-orange-500 border-orange-400 text-white', name: 'ธนาคารอาคารสงเคราะห์' };
  }
  if (name.includes('IBANK') || name.includes('อิสลาม')) {
    return { label: 'IBANK', bg: 'bg-emerald-800 border-emerald-700 text-white', name: 'ธนาคารอิสลามแห่งประเทศไทย' };
  }
  return { label: 'BANK', bg: 'bg-slate-700 border-slate-600 text-white', name: bankName };
};

const getPromptPayQrUrl = (target: string, amount?: number): string => {
  const cleanTarget = (target || '').replace(/[^0-9]/g, '');
  if (!cleanTarget) return '';
  if (amount && amount > 0) {
    return `https://promptpay.io/${cleanTarget}/${amount}.png`;
  }
  return `https://promptpay.io/${cleanTarget}.png`;
};

// Helper function to compress images using HTML5 Canvas to prevent localStorage quota issues
const compressImage = (dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.6): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

interface TenantWorkspaceProps {
  tenant: Tenant;
  onLogout: () => void;
}

export const TenantWorkspace: React.FC<TenantWorkspaceProps> = ({
  tenant,
  onLogout
}) => {
  if (!tenant) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-slate-500 font-bold mb-4">ไม่พบข้อมูลผู้เช่า หรือเซสชันหมดอายุ</p>
        <button onClick={onLogout} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-md">
          กลับสู่หน้าหลัก
        </button>
      </div>
    );
  }

  const location = useLocation();
  const navigate = useNavigate();

  const pathSeg = location.pathname.split('/')[2] || 'dashboard';

  const mapPathToState = (seg: string) => {
    if (seg === 'announcements') return { tab: 'announcements' as const, sub: null };
    if (seg === 'profile') return { tab: 'profile' as const, sub: null };
    if (seg === 'payments_tab') return { tab: 'payments_tab' as const, sub: null };
    
    if (seg === 'bills' || seg === 'invoice') return { tab: 'home' as const, sub: 'invoice' as const };
    if (seg === 'payments' || seg === 'pay') return { tab: 'home' as const, sub: 'pay' as const };
    if (seg === 'maintenance' || seg === 'repairs') return { tab: 'home' as const, sub: 'repairs' as const };
    if (seg === 'contract') return { tab: 'home' as const, sub: 'contract' as const };
    if (seg === 'utilities') return { tab: 'home' as const, sub: 'utilities' as const };
    if (seg === 'history') return { tab: 'home' as const, sub: 'history' as const };
    if (seg === 'register' || seg === 'registration') return { tab: 'home' as const, sub: 'register' as const };

    return { tab: 'home' as const, sub: null };
  };

  const initialState = mapPathToState(pathSeg);
  const [activeTab, setActiveTab] = useState<'home' | 'announcements' | 'payments_tab' | 'profile'>(initialState.tab);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [subView, setSubView] = useState<null | 'invoice' | 'pay' | 'repairs' | 'utilities' | 'contract' | 'history' | 'register'>(initialState.sub);
  const [demoHasRoom, setDemoHasRoom] = useState<boolean>(true); // Toggle demo state: true = มีห้อง (ยอดค้างชำระ), false = ยังไม่มีห้อง (เตรียมลงทะเบียน)
  const [isToastFading, setIsToastFading] = useState(false);

  useEffect(() => {
    const nextState = mapPathToState(pathSeg);
    setActiveTab(nextState.tab);
    setSubView(nextState.sub);
  }, [pathSeg]);

  // Data layers
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [repairs, setRepairs] = useState<RepairRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  
  // Local tenant state to handle co-occupants editing reactively
  const [localTenant, setLocalTenant] = useState<Tenant>(tenant);
  const [isCoOccupantsModalOpen, setIsCoOccupantsModalOpen] = useState(false);
  const [editCoOccupants, setEditCoOccupants] = useState<any[]>([]);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [coOccupantsError, setCoOccupantsError] = useState('');
  const [deleteConfirmCoId, setDeleteConfirmCoId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; title: string; message: string; visible: boolean } | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isSubmittingSlip, setIsSubmittingSlip] = useState(false);

  // Move-out request state
  const [isMoveOutModalOpen, setIsMoveOutModalOpen] = useState(false);
  const [moveOutDate, setMoveOutDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [moveOutBank, setMoveOutBank] = useState('');
  const [moveOutAccount, setMoveOutAccount] = useState('');
  const [moveOutReason, setMoveOutReason] = useState('');
  const [moveOutRequest, setMoveOutRequest] = useState<any>(() => {
    try {
      const saved = localStorage.getItem(`tenant_moveout_request_${tenant.id}`);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Document viewing / downloading state
  const [selectedDocModal, setSelectedDocModal] = useState<{
    title: string;
    subtitle: string;
    category: string;
    fileName: string;
    content: string;
    docType?: string;
    docId?: string;
  } | null>(null);

  // Notifications modal state
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  const showToast = (type: 'success' | 'error', title: string, message: string) => {
    setToast({ type, title, message, visible: true });
  };

  useEffect(() => {
    if (toast?.visible) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setToast(prev => prev ? { ...prev, visible: false } : null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toast?.visible]);

  const dormInfo: any = {};

  const refreshData = () => {
    setRooms(getRooms());
    setBills(getBills());
    setContracts(getContracts());
    setRepairs(getMaintenance() as any);
    setAnnouncements(getAnnouncements());
    setBuildings(getBuildings());
  };

  useEffect(() => {
    refreshData();
    setLocalTenant(tenant);
  }, [tenant]);

  useEffect(() => {
    const hasAssignedRoom = rooms.some(r => r.currentTenantId === tenant.id);
    setDemoHasRoom(hasAssignedRoom);
  }, [tenant.id, rooms]);

  const handleOpenCoOccupantsModal = () => {
    setEditCoOccupants([...localTenant.coOccupants]);
    setNewCoName('');
    setNewCoPhone('');
    setCoOccupantsError('');
    setDeleteConfirmCoId(null);
    setIsCoOccupantsModalOpen(true);
  };

  const handleAddCoOccupant = () => {
    if (!newCoName.trim()) {
      setCoOccupantsError('กรุณากรอก ชื่อ-นามสกุล');
      return;
    }
    if (!newCoPhone.trim()) {
      setCoOccupantsError('กรุณากรอก เบอร์โทรศัพท์');
      return;
    }
    
    const newCo = {
      id: `co-${Date.now()}`,
      name: newCoName.trim(),
      phone: newCoPhone.trim()
    };

    const updatedList = [...editCoOccupants, newCo];
    setEditCoOccupants(updatedList);
    
    // Save immediately
    const updatedTenant = { ...localTenant, coOccupants: updatedList };
    setLocalTenant(updatedTenant);
    
    // Persist to localStorage
    const allTenants = [];
    const updatedTenantsList = allTenants.map(t => t.id === localTenant.id ? updatedTenant : t);
    console.log(updatedTenantsList);
    
    // Log audit
    

    setNewCoName('');
    setNewCoPhone('');
    setCoOccupantsError('');

    // Toast + Fade
    showToast('success', 'เพิ่มผู้พักร่วมสำเร็จ', `เพิ่มคุณ ${newCo.name} เรียบร้อยแล้ว`);
  };

  const handleConfirmRemoveCoOccupant = (coId: string, coName: string) => {
    const updatedList = editCoOccupants.filter(co => co.id !== coId);
    setEditCoOccupants(updatedList);
    
    // Save immediately
    const updatedTenant = { ...localTenant, coOccupants: updatedList };
    setLocalTenant(updatedTenant);
    
    // Persist to localStorage
    const allTenants = [];
    const updatedTenantsList = allTenants.map(t => t.id === localTenant.id ? updatedTenant : t);
    console.log(updatedTenantsList);
    
    // Log audit
    

    setDeleteConfirmCoId(null);

    // Toast + Fade
    showToast('success', 'ลบผู้พักร่วมสำเร็จ', `ลบคุณ ${coName} เรียบร้อยแล้ว`);
  };

  // Filters for this tenant specifically
  const tenantRoom = rooms.find(r => r.currentTenantId === tenant.id);
  const tenantBills = [...bills]
    .filter(b => b.tenantId === tenant.id && b.status !== 'draft')
    .sort((a, b) => b.cycleId.localeCompare(a.cycleId) || b.createdAt.localeCompare(a.createdAt)); 
 console.log('BILLS RAW IN LOCALSTORAGE:', localStorage.getItem('HorPlus_bills'));
  console.log('bills.length', bills.length, 'tenantBills.length', tenantBills.length, 'tenant.id', tenant.id);
  const tenantRepairs = repairs.filter(r => r.roomId === tenantRoom?.id || r.tenantId === tenant.id);
  const tenantContracts = contracts.filter(c => c.tenantId === tenant.id);
  
  // Filter announcements for this tenant's building or all
  const filteredAnnouncements = announcements.filter(ann => {
    // 1. If target is all, everyone sees it
    if (!ann.targetType || ann.targetType === 'all') {
      return true;
    }
    
    // 2. If target is specific building (e.g. ตึก B)
    if (ann.targetType === 'building') {
      const bldId = ann.targetBuildingId;
      if (bldId) {
        return bldId === tenantRoom?.buildingId;
      }
      // Fallback: search building name in customTarget
      if (ann.customTarget) {
        const bld = buildings.find(b => b.id === tenantRoom?.buildingId);
        if (bld) {
          return ann.customTarget.includes(bld.name) || ann.customTarget.includes(bld.id) ||
            (bld.id === 'bld-a' && ann.customTarget.includes('อาคาร A')) ||
            (bld.id === 'bld-b' && ann.customTarget.includes('อาคาร B'));
        }
      }
      return false;
    }
    
    // 3. If target is specific rooms (custom room numbers selection)
    if (ann.targetType === 'rooms') {
      if (tenantRoom?.roomNumber) {
        const cleanRoom = tenantRoom.roomNumber.trim().toUpperCase();
        
        // Check in targetRooms array first
        if (ann.targetRooms && ann.targetRooms.some(r => (r || '').trim().toUpperCase() === cleanRoom)) {
          return true;
        }
        
        // Fallback: check customTarget text
        if (ann.customTarget) {
          const cleanCustom = (ann.customTarget || '').toUpperCase();
          const tokens = cleanCustom.split(/[,\s]+/).map(t => t.trim().replace(/^ห้อง\s*/, ''));
          
          if (tokens.includes(cleanRoom) || tokens.some(t => t === cleanRoom)) {
            return true;
          }
          
          // Also handle exact substring matching like "ห้อง A101" or "A101" with boundaries
          if (cleanCustom.includes(cleanRoom)) {
            return true;
          }
        }
      }
      return false;
    }
    
    return true; // default fallback
  });

  // Active Unpaid Bill
  const activeUnpaidBill = tenantBills.find(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'rejected');
  const activeUnpaidAmount = activeUnpaidBill ? activeUnpaidBill.totalAmount : 0;

  // Invoice Details sub-view states
  const [invoiceTab, setInvoiceTab] = useState<'current' | 'history'>('current');
  const [expandedInvoice, setExpandedInvoice] = useState<boolean>(true);

  // Repair Request states
  const [repairTab, setRepairTab] = useState<'mine' | 'history'>('mine');
  const [isNewRepairOpen, setIsNewRepairOpen] = useState(false);
  const [repairTitle, setRepairTitle] = useState('');
  const [repairDesc, setRepairDesc] = useState('');
  const [repairSuccess, setRepairSuccess] = useState(false);
  const [repairImage, setRepairImage] = useState<string | null>(null);
  const [repairImageName, setRepairImageName] = useState<string | null>(null);
  const repairFileInputRef = useRef<HTMLInputElement>(null);

  // Helper for Announcement Role Display
  const getAuthorRoleName = (rawAuthor?: string) => {
    if (!rawAuthor) return 'เจ้าของหอพัก';
    if (rawAuthor.includes('(') && rawAuthor.includes(')')) {
      const roleInParen = rawAuthor.split('(')[1].replace(')', '').trim();
      if (roleInParen) return roleInParen;
    }
    if (rawAuthor === 'นิติบุคคล' || rawAuthor === 'ผู้ดูแลระบบ' || rawAuthor === 'ผู้จัดการ' || rawAuthor === 'เจ้าของหอพัก') {
      return 'เจ้าของหอพัก';
    }
    if (rawAuthor === 'ช่าง' || rawAuthor === 'ทีมช่าง') {
      return 'ทีมช่างประจำหอพัก';
    }
    return rawAuthor;
  };

  // Helper for real notification badge count
  const unreadBills = tenantBills.filter(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'rejected');
  const activeRepairs = tenantRepairs.filter(r => r.status === 'in_progress' || r.status === 'pending');
  const urgentAnnouncements = filteredAnnouncements.filter(a => a.isUrgent || a.isPinned);
  const totalNotificationsCount = unreadBills.length + activeRepairs.length + urgentAnnouncements.length;

  // Handler for confirm move-out
  const handleConfirmMoveOut = async () => {
    if (!moveOutDate) {
      showToast('error', 'กรุณาระบุวันที่', 'โปรดเลือกวันที่ประสงค์จะย้ายออก');
      return;
    }
    const newReq = {
      id: `REQ-${Date.now()}`,
      tenantId: tenant.id,
      roomId: tenantRoom?.id || '',
      desiredDate: moveOutDate,
      bankInfo: moveOutBank,
      accountInfo: moveOutAccount,
      reason: moveOutReason,
      createdAt: new Date().toISOString(),
      status: 'pending'
    };

    try {
      await fetch('/api/v1/tenant-move-out-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dormitoryId: tenant.dormitoryId,
          tenantId: tenant.id,
          roomId: tenantRoom?.id || '',
          intendedMoveOutDate: moveOutDate,
          reason: moveOutReason
        })
      });
    } catch (err) {
      // Fallback for offline demo mode
    }

    setMoveOutRequest(newReq);
    try {
      localStorage.setItem(`tenant_moveout_request_${tenant.id}`, JSON.stringify(newReq));
    } catch {}
    setIsMoveOutModalOpen(false);
    showToast('success', 'ส่งคำขอแจ้งย้ายออกเรียบร้อยแล้ว', 'การเช่าจะยังไม่สิ้นสุดจนกว่าเจ้าของหอพักจะดำเนินการยืนยัน');
  };

  // Handler for cancel move-out request
  const handleCancelMoveOutRequest = () => {
    setMoveOutRequest(null);
    try {
      localStorage.removeItem(`tenant_moveout_request_${tenant.id}`);
    } catch {}
    showToast('success', 'ยกเลิกคำร้องแล้ว', 'ยกเลิกคำร้องขอแจ้งเลิกเช่าเรียบร้อยแล้ว');
  };

  // Handler for actual document downloading
  const handleDownloadDoc = (title: string, fileName: string, contentText: string, docType?: string, docId?: string) => {
    try {
      if (docType === 'contract') {
        window.open('/api/v1/tenant-portal/contract/pdf', '_blank');
        showToast('success', 'ดาวน์โหลดสำเร็จ', `กำลังดาวน์โหลดเอกสาร ${title} (PDF)...`);
        return;
      }
      if (docType === 'receipt' && docId) {
        window.open(`/api/v1/tenant-portal/receipts/${docId}/pdf`, '_blank');
        showToast('success', 'ดาวน์โหลดสำเร็จ', `กำลังดาวน์โหลดเอกสาร ${title} (PDF)...`);
        return;
      }

      const blob = new Blob([contentText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('success', 'ดาวน์โหลดสำเร็จ', `ดาวน์โหลดเอกสาร ${title} เรียบร้อยแล้ว`);
    } catch (err) {
      showToast('error', 'ดาวน์โหลดไม่สำเร็จ', 'ไม่สามารถสร้างไฟล์สำหรับดาวน์โหลดได้');
    }
  };

  // Time-based Thai Greeting helper
  const getThaiGreeting = () => {
    const hours = new Date().getHours();
    if (hours >= 5 && hours < 12) return 'สวัสดีตอนเช้า 👋';
    if (hours >= 12 && hours < 17) return 'สวัสดีตอนบ่าย 👋';
    return 'สวัสดีตอนเย็น 👋';
  };

  // Convert Gregorian Date to BE Thai calendar date
  const formatToBeDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) {
        // Safe hardcoded fallbacks matching mockData
        if (dateStr.includes('2026-06')) return '30 มิ.ย. 2569';
        if (dateStr.includes('2026-07')) return '15 ก.ค. 2569';
        return dateStr;
      }
      const thaiMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ];
      const day = d.getDate().toString().padStart(2, '0');
      const month = thaiMonths[d.getMonth()];
      const year = d.getFullYear() + 543;
      return `${day} ${month} ${year}`;
    } catch {
      return dateStr;
    }
  };

  // Full Thai month date conversion (e.g., 02 ก.ค. 2569)
  const formatToBeFullDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const thaiMonths = [
        'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
      ];
      const day = d.getDate().toString().padStart(2, '0');
      const month = thaiMonths[d.getMonth()];
      const year = d.getFullYear() + 543;
      return `${day} ${month} ${year}`;
    } catch {
      return dateStr;
    }
  };

  // Translate cycle standard to Thai format (e.g. "2026-07" to "กรกฎาคม 2569")
  const formatThaiCycle = (cycleId: string) => {
    try {
      const [yearStr, monthStr] = cycleId.split('-');
      const year = parseInt(yearStr, 10) + 543;
      const monthNames = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      const monthIndex = parseInt(monthStr, 10) - 1;
      return `${monthNames[monthIndex]} ${year}`;
    } catch {
      return cycleId;
    }
  };

  // Duration in months calculation helper
  const getContractDurationMonths = (start: string, end: string) => {
    try {
      const s = new Date(start);
      const e = new Date(end);
      if (isNaN(s.getTime()) || isNaN(e.getTime())) return 11;
      const yearsDiff = e.getFullYear() - s.getFullYear();
      const monthsDiff = e.getMonth() - s.getMonth();
      return yearsDiff * 12 + monthsDiff;
    } catch {
      return 11;
    }
  };

  const handleCopyAccount = () => {
    const rawNumber = (dormInfo.bankAccountNumber || '123-4-56789-0').replace(/\s/g, '');
    navigator.clipboard.writeText(rawNumber);
  };

  // Simulated uploader event handlers (Supports Click + Drag & Drop)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      console.log({
        name: file.name,
        size: `${sizeMB} MB`
      });
      

      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        compressImage(rawUrl).then(compressedUrl => {
          
        }).catch(() => {
          
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
      console.log({
        name: file.name,
        size: `${sizeMB} MB`
      });
      

      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        compressImage(rawUrl).then(compressedUrl => {
          
        }).catch(() => {
          
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileSelect = () => {
    if (false) {
      console.log();
    }
  };

  const handleRemoveFile = () => {
    
    
    if (false) {
      // noop
    }
  };

  const handleRepairFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type && !file.type.startsWith('image/')) {
        return;
      }
      setRepairImageName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        compressImage(rawUrl).then(compressedUrl => {
          setRepairImage(compressedUrl);
        }).catch(() => {
          setRepairImage(rawUrl);
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRepairRemoveFile = () => {
    setRepairImage(null);
    setRepairImageName(null);
    if (repairFileInputRef.current) {
      repairFileInputRef.current.value = '';
    }
  };

  // Submit payment evidence
  // Submit new repair request
  const handleCreateRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairTitle.trim() || !tenantRoom) return;
    
    const newId = `rep-${Date.now()}`;
    const newRequest: RepairRequest = {
      id: newId,
      roomId: tenantRoom.id,
      tenantId: tenant.id,
      title: repairTitle.trim(),
      description: repairDesc.trim(),
      imageBefore: repairImage || undefined,
      urgency: 'medium',
      priority: 'medium',
      status: 'submitted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updatedRepairs = [newRequest, ...repairs];
    console.log(updatedRepairs as any);
    

    refreshData();
    setIsNewRepairOpen(false);
    setRepairTitle('');
    setRepairDesc('');
    setRepairImage(null);
    setRepairImageName(null);
    setRepairSuccess(true);
    setTimeout(() => setRepairSuccess(false), 4000);
  };

  // Utility history chart mock data
  const utilitiesData = [
    { name: 'มี.ค.', water: 7, elec: 112 },
    { name: 'เม.ย.', water: 9, elec: 145 },
    { name: 'พ.ค.', water: 8, elec: 130 },
    { name: 'มิ.ย.', water: 10, elec: 154 },
    { name: 'ก.ค.', water: 8, elec: 122 }
  ];

  // Helper to render consistent back-arrow sub-view header matching iOS/Android style
  const renderSubViewHeader = (title: string, rightAction?: React.ReactNode) => (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
      <button 
        onClick={() => setSubView(null)}
        className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all"
        aria-label="ย้อนกลับ"
      >
        <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
      </button>
      <h3 className="text-xs font-black text-slate-900 text-center flex-1">{title}</h3>
      <div className="w-7 flex justify-end shrink-0">
        {rightAction}
      </div>
    </div>
  );

  const getCsrfToken = () => {
    const match = document.cookie.match(/csrf-token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : (window as any).__CSRF_TOKEN || '';
  };

  const handleSubmitPaymentSlip = async () => {
    if (!slipFile || !activeUnpaidBill) return;
    setIsSubmittingSlip(true);
    try {
      const csrf = getCsrfToken();
      const intentRes = await fetch('/api/v1/payments/slip/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          dormitoryId: localTenant.dormitoryId,
          billId: activeUnpaidBill.id,
          fileName: slipFile.name,
          mimeType: slipFile.type || 'image/jpeg',
          fileSize: slipFile.size
        })
      });
      if (!intentRes.ok) {
        const errText = await intentRes.text();
        throw new Error(errText);
      }
      const intent = await intentRes.json();

      const formData = new FormData();
      formData.append('file', slipFile);
      const uploadRes = await fetch(intent.uploadUrl, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: formData
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(errText);
      }

      const submitRes = await fetch('/api/v1/payments/slip/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrf,
          'x-idempotency-key': crypto.randomUUID()
        },
        body: JSON.stringify({
          dormitoryId: localTenant.dormitoryId,
          billId: activeUnpaidBill.id,
          amount: activeUnpaidBill.totalAmount.toString(),
          paymentDate: new Date().toISOString(),
          intentId: intent.intentId
        })
      });
      if (!submitRes.ok) {
        const errText = await submitRes.text();
        throw new Error(errText);
      }

      setSubView(null);
      setSlipFile(null);
      setToast({ type: 'success', title: 'ส่งหลักฐานสำเร็จ', message: 'กำลังรอการตรวจสอบจากเจ้าของหอพัก', visible: true });
      setTimeout(() => setToast(null), 4000);
      refreshData();
    } catch(err: any) {
      let msg = err.message || '';
      if (msg.includes('DUPLICATE_PAYMENT_EVIDENCE')) {
        msg = 'รูปสลิปนี้เคยถูกส่งเข้าระบบแล้ว (ห้ามใช้สลิปซ้ำ)';
      } else if (msg.includes('ACTIVE_REVIEW_EXISTS')) {
        msg = 'มีรายการชำระเงินที่อยู่ระหว่างการตรวจสอบอยู่แล้ว';
      }
      setToast({ type: 'error', title: 'ไม่สามารถส่งหลักฐานได้', message: msg, visible: true });
      setTimeout(() => setToast(null), 4000);
    } finally {
      setIsSubmittingSlip(false);
    }
  };

  return (
    <div className="h-screen w-full bg-slate-100 flex justify-center overflow-hidden">
      
      {/* Main Container */}
      <div className="bg-slate-50 w-full max-w-md h-full flex flex-col font-sans text-xs relative select-none shadow-md border-x border-slate-200">
        
        {/* Main scrollable body area */}
        <div className="flex-1 overflow-y-auto pb-16 bg-slate-50/50">
            
            {/* Status alerts */}
            {false && (
              <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 animate-in zoom-in-95">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-[10px] font-bold leading-tight">แนบหลักฐานสลิปโอนเงินเสร็จสิ้น! ระบบกำลังคอยตรวจสอบการเงินภายใน 24 ชม.</span>
              </div>
            )}

            {repairSuccess && (
              <div className="mx-4 mt-3 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 animate-in zoom-in-95">
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="text-[10px] font-bold leading-tight">ส่งคำขอซ่อมสำเร็จแล้ว! ช่างอาคารจะดำเนินการติดต่อกลับโดยเร็วที่สุด</span>
              </div>
            )}

            {/* MAIN PORTAL ROOT NAVIGATION */}
            {subView === null && (
              <>
                {/* 1. HOME TAB */}
                {activeTab === 'home' && (
                  <div className="space-y-5 pb-4">
                    {/* Visual Indigo-Blue Gradient Banner */}
                    <div className="bg-gradient-to-br from-indigo-500 via-blue-600 to-indigo-700 text-white rounded-b-[32px] pt-7 pb-20 px-5 flex flex-col justify-between relative shadow-sm">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-[9px] uppercase font-bold tracking-wider text-indigo-100 opacity-90">{getThaiGreeting()}</span>
                          <h3 className="text-sm font-black mt-0.5 tracking-tight">คุณ {tenant.name}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-indigo-150 font-semibold flex items-center gap-1">
                              <ClockIcon className="w-3.5 h-3.5 opacity-80" />
                              <span>{demoHasRoom ? `ห้อง ${tenantRoom?.roomNumber || 'A-101'}` : 'ยังไม่มีห้องพัก'}</span>
                            </span>
                          </div>
                        </div>
                        {/* Translucent notification bell badge */}
                        <button 
                          onClick={() => setIsNotificationModalOpen(true)}
                          className="relative p-2 bg-white/10 rounded-full hover:bg-white/20 transition-all text-white shrink-0 cursor-pointer"
                          aria-label="การแจ้งเตือน"
                        >
                          <Bell className="w-4 h-4" />
                          {totalNotificationsCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-rose-500 rounded-full border border-indigo-600 text-[8px] text-white flex items-center justify-center font-black animate-pulse shadow-2xs">
                              {totalNotificationsCount > 99 ? '99+' : totalNotificationsCount}
                            </span>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Floating Overlapping Card (Directly based on room presence: ยอดค้างชำระ [ตามรูป] or ลงทะเบียนผู้เช่า [สำหรับผู้เช่าใหม่]) */}
                    <div className="mt-[-60px] mx-4 bg-white rounded-3xl p-5 border border-slate-200/80 shadow-xl flex flex-col gap-3 relative z-10 transition-all">
                      {demoHasRoom ? (
                        /* Mode 1: ยอดค้างชำระ (ตรงตามรูปที่แนบมาเป๊ะๆ) */
                        <div className="space-y-3 pt-0.5 animate-in fade-in duration-200">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-amber-600 font-extrabold text-xs">
                                <AlertCircle className="w-4 h-4 text-amber-500 stroke-[2.5]" />
                                <span>ยอดค้างชำระ</span>
                              </div>
                              <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none pt-1">
                                ฿ {activeUnpaidBill ? activeUnpaidBill.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '18,368.00'}
                              </h2>
                              <p className="text-[10px] sm:text-xs text-slate-500 font-medium pt-1">
                                กำหนดชำระภายใน: <span className="font-extrabold text-slate-700">{activeUnpaidBill ? formatToBeDate(activeUnpaidBill.dueDate) : '30 ก.ค. 2569'}</span>
                              </p>
                            </div>
                            <span className="px-3 py-1 rounded-full text-[10px] font-black bg-amber-50 border border-amber-200/90 text-amber-800 shrink-0 shadow-2xs">
                              รอชำระ
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSubView('invoice')}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                          >
                            <CreditCard className="w-4 h-4 text-indigo-200" />
                            <span>ชำระเงิน</span>
                          </button>
                        </div>
                      ) : (
                        /* Mode 2: ลงทะเบียนผู้เช่า (สำหรับผู้เช่าที่ยังไม่มีห้อง) */
                        <div className="space-y-3 pt-0.5 animate-in fade-in duration-200">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5 text-indigo-600 font-black text-xs">
                                <Sparkles className="w-4 h-4 text-amber-500 fill-amber-400" />
                                <span>ระบบลงทะเบียนผู้เช่าใหม่</span>
                              </div>
                              <h2 className="text-lg font-black text-slate-900 tracking-tight">
                                ลงทะเบียนผู้เช่า
                              </h2>
                              <p className="text-[9px] text-slate-500 font-medium leading-relaxed">
                                กรอกข้อมูลผู้เช่า เลือกประเภทค่าเช่า มัดจำ ยานพาหนะ สัตว์เลี้ยง และเซ็นสัญญาเช่า
                              </p>
                            </div>
                            <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-indigo-50 border border-indigo-100 text-indigo-700 shrink-0">
                              ยังไม่มีห้อง
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => setSubView('register')}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 px-4 rounded-xl w-full text-center transition-all text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                          >
                            <UserCheck className="w-4 h-4 text-indigo-200" />
                            <span>ลงทะเบียนผู้เช่า</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* เมนูหลัก Grid Section */}
                    <div>
                      <h4 className="text-xs font-black text-slate-900 mb-3 px-5">เมนูหลัก</h4>
                      <div className="grid grid-cols-3 gap-3 px-4">
                        {/* 1. ใบแจ้งหนี้ */}
                        <div 
                          onClick={() => setSubView('invoice')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-purple-50 text-purple-600 p-2 rounded-xl">
                            <FileText className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">ใบแจ้งหนี้</span>
                        </div>

                        {/* 2. ชำระค่าเช่า */}
                        <div 
                          onClick={() => setSubView('invoice')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl">
                            <CreditCard className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">ชำระค่าเช่า</span>
                        </div>

                        {/* 3. แจ้งซ่อมบำรุง */}
                        <div 
                          onClick={() => setSubView('repairs')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-rose-50 text-rose-600 p-2 rounded-xl">
                            <Wrench className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">แจ้งซ่อมบำรุง</span>
                        </div>

                        {/* 4. ค่าน้ำ / ค่าไฟ */}
                        <div 
                          onClick={() => setSubView('utilities')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-blue-50 text-blue-500 p-2 rounded-xl">
                            <Zap className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">ค่าน้ำ / ค่าไฟ</span>
                        </div>

                        {/* 5. เอกสารสัญญา */}
                        <div 
                          onClick={() => setSubView('contract')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-indigo-50 text-indigo-600 p-2 rounded-xl">
                            <FileCheck2 className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">เอกสารสัญญา</span>
                        </div>

                        {/* 6. ประวัติการชำระ */}
                        <div 
                          onClick={() => setSubView('invoice')}
                          className="bg-white rounded-2xl border border-slate-100/80 p-3.5 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-all cursor-pointer shadow-2xs"
                        >
                          <div className="bg-slate-100 text-slate-600 p-2 rounded-xl">
                            <History className="w-4 h-4 stroke-[2.2]" />
                          </div>
                          <span className="text-[9px] font-bold text-slate-700">ประวัติการชำระ</span>
                        </div>
                      </div>
                    </div>

                    {/* Promotional Gradient Banner with Tiny Phone QR SVG */}
                    <div className="mx-4 mt-1 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-2xl p-4 flex justify-between items-center overflow-hidden relative shadow-xs">
                      <div className="space-y-1 z-10 max-w-[170px]">
                        <h4 className="font-extrabold text-[11px] text-white tracking-tight">ดาวน์โหลดแอปผู้เช่าทันที!</h4>
                        <p className="text-[9px] text-blue-100 font-medium">เพื่อติดตามข่าวสารและแจ้งซ่อมได้สะดวกรวดเร็ว</p>
                      </div>
                      <div className="opacity-20 absolute -right-4 -bottom-4 text-white shrink-0">
                        <QrCode className="w-16 h-16 stroke-[1]" />
                      </div>
                    </div>

                    {/* Announcements list section */}
                    <div className="mx-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black text-slate-900">ประกาศล่าสุด</h4>
                        <button
                          onClick={() => setActiveTab('announcements')}
                          className="text-[9px] font-bold text-indigo-600 hover:underline cursor-pointer"
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
                            <div className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-2xs hover:shadow-xs transition-all">
                              {ann.attachmentUrl && (
                                <img 
                                  src={ann.attachmentUrl} 
                                  alt="announcement" 
                                  className="w-full h-32 object-cover border-b border-slate-50 cursor-zoom-in hover:brightness-95 transition-all" 
                                  referrerPolicy="no-referrer"
                                  onClick={() => setZoomedImage(ann.attachmentUrl)}
                                />
                              )}
                              <div className="p-4 space-y-2.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {ann.isPinned && (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] bg-violet-600 text-white font-black px-1.5 py-0.5 rounded-md">
                                      <Pin className="w-2 h-2 fill-white text-white" />
                                      ปักหมุด
                                    </span>
                                  )}
                                  {ann.isUrgent && (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] bg-rose-500 text-white font-black px-1.5 py-0.5 rounded-md">
                                      <AlertCircle className="w-2 h-2" />
                                      ด่วน
                                    </span>
                                  )}
                                  <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded-md border ${badgeBg}`}>
                                    {badgeIcon}
                                    <span>{badgeLabel}</span>
                                  </span>
                                </div>

                                <div className="flex">
                                  <span className="inline-flex items-center gap-1 text-[9px] bg-slate-100 text-slate-600 font-extrabold px-1.5 py-0.5 rounded-md border border-slate-100">
                                    <BuildingIcon className="w-2.5 h-2.5 text-slate-500" />
                                    <span>{ann.customTarget || 'ทุกอาคาร'}</span>
                                  </span>
                                </div>

                                <h5 className="font-extrabold text-slate-900 text-xs tracking-tight line-clamp-1">{ann.title}</h5>
                                <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">{ann.content}</p>
                                
                                {ann.linkUrl && (
                                  <div className="pt-0.5">
                                    <a
                                      href={ann.linkUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600 hover:underline bg-indigo-50 px-2 py-0.5 rounded-md"
                                    >
                                      <span>🔗 เปิดรายละเอียดเพิ่มเติม</span>
                                    </a>
                                  </div>
                                )}
                                
                                <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-[8px] text-slate-400">
                                  <div className="flex items-center gap-1">
                                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black ${authorBg}`}>
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
                        <p className="text-center py-6 text-slate-400 font-medium bg-white border border-slate-100 rounded-2xl shadow-2xs">ไม่มีประกาศแจ้งเตือน</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 2. ANNOUNCEMENTS TAB */}
                {activeTab === 'announcements' && (
                  <div className="p-4 space-y-4">
                    <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">ข่าวสารและประกาศนิติบุคคล ({filteredAnnouncements.length})</h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {filteredAnnouncements.map((ann) => {
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
                          <div key={ann.id} className="bg-white border border-slate-100 rounded-[24px] overflow-hidden shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between">
                            <div>
                              {ann.attachmentUrl && (
                                <img 
                                  src={ann.attachmentUrl} 
                                  alt={ann.title} 
                                  className="w-full h-36 object-cover border-b border-slate-50 cursor-zoom-in hover:brightness-95 transition-all"
                                  referrerPolicy="no-referrer"
                                  onClick={() => setZoomedImage(ann.attachmentUrl)}
                                />
                              )}
                              <div className="p-4 space-y-3">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {ann.isPinned && (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] bg-violet-600 text-white font-black px-2 py-0.5 rounded-md">
                                      <Pin className="w-2 h-2 fill-white text-white" />
                                      ปักหมุด
                                    </span>
                                  )}
                                  {ann.isUrgent && (
                                    <span className="inline-flex items-center gap-0.5 text-[8px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-md">
                                      <AlertCircle className="w-2 h-2" />
                                      ด่วน
                                    </span>
                                  )}
                                  <span className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-2 py-0.5 rounded-md border ${badgeBg}`}>
                                    {badgeIcon}
                                    <span>{badgeLabel}</span>
                                  </span>
                                </div>

                                <div className="flex">
                                  <span className="inline-flex items-center gap-1 text-[9px] bg-slate-100 text-slate-600 font-extrabold px-2 py-0.5 rounded-md border border-slate-100">
                                    <BuildingIcon className="w-3 h-3 text-slate-500" />
                                    <span>{ann.customTarget || 'ทุกอาคาร'}</span>
                                  </span>
                                </div>

                                <h5 className="font-extrabold text-slate-900 text-xs tracking-tight">{ann.title}</h5>
                                <p className="text-[10px] text-slate-500 leading-relaxed whitespace-pre-line">{ann.content}</p>
                                
                                {ann.linkUrl && (
                                  <div className="pt-1">
                                    <a
                                      href={ann.linkUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[9px] font-extrabold text-indigo-600 hover:underline bg-indigo-50/50 px-2 py-1 rounded-lg"
                                    >
                                      <span>🔗 เปิดรายละเอียดเพิ่มเติม</span>
                                    </a>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="p-4 pt-0">
                              <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between text-[8px] text-slate-400">
                                <div className="flex items-center gap-1">
                                  <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black ${authorBg}`}>
                                    {authorInitial}
                                  </div>
                                  <span className="font-bold text-slate-500">โดย {authorRole}</span>
                                </div>
                                <span className="font-bold">{formatThaiDate(ann.publishDate || ann.createdAt.split('T')[0])}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      {filteredAnnouncements.length === 0 && (
                        <p className="text-center py-12 text-slate-400 col-span-full">ยังไม่มีประกาศใดๆ ในระบบ</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. PAYMENTS TAB (BILLS LIST) */}
                {activeTab === 'payments_tab' && (
                  <div className="p-4 space-y-4">
                    <h4 className="text-xs font-black text-slate-900">บิลและสถานะการชำระเงิน</h4>
                    
                    <div className="space-y-3">
                      {tenantBills.map((b) => (
                        <div key={b.id} className="p-4 bg-white border border-slate-100 rounded-2xl flex justify-between items-center gap-3 shadow-2xs">
                          <div>
                            <h5 className="font-black text-slate-800 text-xs">ยอดรวม: {formatBaht(b.totalAmount)}</h5>
                            <p className="text-[9px] text-slate-400 mt-1">รอบประจำเดือน {formatThaiCycle(b.cycleId)}</p>
                            <div className="mt-2.5">
                              <StatusBadge status={b.status} type="bill" />
                            </div>
                          </div>

                          <div className="shrink-0">
                              <button
                                type="button"
                                onClick={() => setSubView('invoice')}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[9px] rounded-lg transition-colors cursor-pointer"
                              >
                                <FileText className="w-3.5 h-3.5 inline mr-1" />
                                รายละเอียด
                              </button>
                          </div>
                        </div>
                      ))}

                      {tenantBills.length === 0 && (
                        <p className="text-center py-12 text-slate-400">ยังไม่มีบิลค่าน้ำไฟหรือค่าเช่าออกให้ตรวจสอบ</p>
                      )}
                    </div>
                  </div>
                )}

                {/* 4. PROFILE TAB */}
                {activeTab === 'profile' && (
                  <div className="p-4 space-y-4">
                    <h4 className="text-xs font-black text-slate-900 font-sans">ข้อมูลและโปรไฟล์ผู้เช่า</h4>
                    
                    {/* User ID card card layout */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl space-y-4 shadow-2xs">
                      <div className="flex gap-3.5 items-center">
                        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-sm">
                          {tenant.name.charAt(0)}
                        </div>
                        <div>
                          <h4 className="font-extrabold text-slate-800 text-xs">{tenant.name}</h4>
                          <p className="text-[9px] text-slate-400 mt-0.5">อีเมล: {tenant.email}</p>
                        </div>
                      </div>

                      <div className="border-t border-slate-100 pt-3 text-[10px] space-y-2 text-slate-600 leading-normal">
                        <p><span className="text-slate-400">เบอร์โทรศัพท์:</span> <span className="font-bold text-slate-800">{tenant.phone}</span></p>
                        <p><span className="text-slate-400">เลขประจำตัวประชาชน:</span> <span className="font-bold text-slate-800">{tenant.citizenId}</span></p>
                        <p><span className="text-slate-400">ยานพาหนะ:</span> <span className="font-bold text-slate-800">
                          {tenant.vehicle.type !== 'none' ? `มี (${tenant.vehicle.type === 'car' ? 'รถยนต์' : 'รถจักรยานยนต์'} ทะเบียน ${tenant.vehicle.licensePlate})` : 'ไม่มี'}
                        </span></p>
                        <p><span className="text-slate-400">สัตว์เลี้ยง:</span> <span className="font-bold text-slate-800">
                          {tenant.pet.hasPet ? `มี (${tenant.pet.type} ชื่อ ${tenant.pet.name})` : 'ไม่มีสัตว์เลี้ยง'}
                        </span></p>
                      </div>
                    </div>

                    {/* Co-occupants section */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl space-y-3 shadow-2xs">
                      <div className="flex justify-between items-center">
                        <h5 className="font-black text-slate-800 text-[11px]">รายชื่อผู้พักอาศัยร่วม ({localTenant.coOccupants.length} ท่าน)</h5>
                        <button
                          type="button"
                          onClick={handleOpenCoOccupantsModal}
                          className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                        >
                          <Wrench className="w-3 h-3" /> แก้ไข / เพิ่ม
                        </button>
                      </div>
                      {localTenant.coOccupants.map((co) => (
                        <div key={co.id} className="p-2.5 bg-slate-50 border border-slate-100 rounded-xl text-[10px] space-y-0.5">
                          <p className="font-bold text-slate-800">{co.name}</p>
                          <p className="text-slate-400">โทร: {co.phone}</p>
                        </div>
                      ))}
                      {localTenant.coOccupants.length === 0 && (
                        <p className="text-center text-[9px] text-slate-400 py-3 font-semibold">ไม่มีผู้พักอาศัยร่วมลงทะเบียน</p>
                      )}
                    </div>

                    {/* Move-out (แจ้งเลิกเช่า) Section */}
                    <div className="bg-white p-4 border border-rose-100/80 rounded-2xl space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <div>
                          <h5 className="font-black text-rose-900 text-[11px]">สัญญาเช่าและการแจ้งย้ายออก</h5>
                          <p className="text-[9px] text-slate-400 mt-0.5">แจ้งความประสงค์เลิกเช่าห้องพักล่วงหน้าตามเงื่อนไขสัญญา</p>
                        </div>
                      </div>

                      {moveOutRequest ? (
                        <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl space-y-2 text-[10px]">
                          <div className="flex items-center justify-between text-amber-900 font-extrabold">
                            <span className="flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                              ส่งคำขอแจ้งย้ายออกแล้ว
                            </span>
                            <span className="text-[8px] bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-md">รอการตรวจสอบ</span>
                          </div>
                          <div className="text-slate-600 space-y-1 text-[9px]">
                            <p><strong>วันที่ประสงค์ย้ายออก:</strong> {formatToBeFullDate(moveOutRequest.desiredDate)}</p>
                            {moveOutRequest.reason && <p><strong>เหตุผล:</strong> {moveOutRequest.reason}</p>}
                            {moveOutRequest.bankInfo && <p><strong>บัญชีรับเงินประกันคืน:</strong> {moveOutRequest.bankInfo} {moveOutRequest.accountInfo}</p>}
                          </div>
                          <div className="pt-1 flex justify-end">
                            <button
                              onClick={handleCancelMoveOutRequest}
                              className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 rounded-lg font-bold text-[9px] transition-all cursor-pointer"
                            >
                              ยกเลิกคำร้องย้ายออก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-[9px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                            การแจ้งเลิกเช่าจะต้องทำล่วงหน้าอย่างน้อย 30 วัน เมื่อได้รับการยืนยันแล้วเจ้าหน้าที่จะเข้าตรวจสอบสภาพห้องเพื่อคำนวณเงินประกันคืน
                          </p>
                          <button
                            type="button"
                            onClick={() => setIsMoveOutModalOpen(true)}
                            className="w-full py-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 text-rose-700 font-extrabold rounded-xl text-[10px] transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <LogOut className="w-3.5 h-3.5 text-rose-600" />
                            <span>แจ้งย้ายออก / เลิกเช่าห้องพัก</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* DETAILED SUB-VIEWS ROUTINGS */}
            {subView !== null && (
              <>
                {/* A. SUBVIEW: ใบแจ้งหนี้ (IMAGE 8) */}
                {subView === 'invoice' && (
                  <div className="flex flex-col h-full bg-slate-50">
                    {renderSubViewHeader('ใบแจ้งหนี้', <Calendar className="w-5 h-5 text-slate-400" />)}
                    
                    {/* Invoice Tabs below header */}
                    <div className="flex border-b border-gray-100 bg-white sticky top-[45px] z-20 shrink-0">
                      <button 
                        onClick={() => setInvoiceTab('current')}
                        className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors ${
                          invoiceTab === 'current' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        เดือนปัจจุบัน
                      </button>
                      <button 
                        onClick={() => setInvoiceTab('history')}
                        className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors ${
                          invoiceTab === 'history' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        ประวัติบิลอื่นๆ
                      </button>
                    </div>

                    <div className="p-4 space-y-4">
                      {invoiceTab === 'current' ? (
                        activeUnpaidBill ? (
                          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-4 relative">
                            {/* Bill Card Heading */}
                            <div className="flex justify-between items-start">
                              <div>
                                <span className="text-[9px] text-slate-400 font-bold block">ค่าใช้จ่ายเดือน {formatToBeFullDate(activeUnpaidBill.createdAt)}</span>
                                <h2 className="text-xl font-black text-slate-900 mt-1 leading-none">
                                  ฿ {activeUnpaidBill.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </h2>
                                <span className="text-[9px] text-slate-400 block mt-2">กำหนดชำระ: {formatToBeDate(activeUnpaidBill.dueDate)}</span>
                              </div>
                              <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-50 text-orange-600 shrink-0">
                                รอชำระ
                              </span>
                            </div>

                            {/* Collapsible item details */}
                            <div className="border-t border-slate-100 pt-4 space-y-2.5 text-[10px]">
                              {activeUnpaidBill.items.map((item) => (
                                <div key={item.id} className="flex justify-between items-center text-slate-600">
                                  <span>{formatItemDescription(item.description)}</span>
                                  <span className="font-extrabold text-slate-800">฿ {item.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                              ))}
                              
                              <div className="border-t border-slate-100 pt-3 flex justify-between items-center text-[11px] font-black text-indigo-600">
                                <span>ยอดรวมทั้งสิ้น</span>
                                <span>฿ {activeUnpaidBill.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-16 space-y-3 bg-white border border-slate-100 rounded-3xl p-5">
                            <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
                            <p className="text-slate-500 font-bold text-xs">ยอดค้างชำระของท่านเป็นศูนย์เรียบร้อย</p>
                            <p className="text-[9px] text-slate-400">ไม่มีบิลรอเรียกเก็บในรอบเดือนนี้</p>
                          </div>
                        )
                      ) : (
                        <div className="space-y-3">
                          {tenantBills.filter(b => b.status === 'paid').map((b) => (
                            <div 
                              key={b.id} 
                              onClick={() => {
                                
                                setSubView('invoice');
                              }}
                              className="bg-white p-4 border border-slate-100 rounded-2xl flex justify-between items-center cursor-pointer hover:bg-slate-50 transition-colors shadow-2xs"
                            >
                              <div>
                                <h5 className="font-extrabold text-slate-800">รอบเดือน {formatThaiCycle(b.cycleId)}</h5>
                                <p className="text-[9px] text-slate-400 mt-0.5">ยอดสุทธิ {formatBaht(b.totalAmount)}</p>
                              </div>
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            </div>
                          ))}
                          {tenantBills.filter(b => b.status === 'paid').length === 0 && (
                            <p className="text-center py-12 text-slate-400">ไม่มีประวัติการชำระเงินย้อนหลัง</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Bottom Sticky Action Button */}
                    {invoiceTab === 'current' && activeUnpaidBill && (
                      <div className="sticky bottom-[56px] p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 mt-auto z-10">
                        <button
                          onClick={() => setSubView('pay')}
                          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors"
                        >
                          แจ้งชำระเงิน
                        </button>
                      </div>
                    )}
                  </div>
                )}

                
                {/* B. SUBVIEW: แจ้งชำระเงิน (IMAGE 9) */}
                {subView === 'pay' && activeUnpaidBill && (
                  <div className="flex flex-col h-full bg-slate-50 relative">
                    {renderSubViewHeader('แจ้งชำระเงิน', <DollarSign className="w-5 h-5 text-slate-400" />)}
                    
                    <div className="p-4 space-y-4 pb-24 overflow-y-auto">
                      <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-4">
                        <div className="text-center">
                          <p className="text-[10px] text-slate-500 font-bold mb-1">ยอดชำระทั้งหมด</p>
                          <h2 className="text-2xl font-black text-indigo-600">
                            ฿ {activeUnpaidBill.totalAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </h2>
                          <p className="text-[9px] text-slate-400 mt-1">
                            ชำระภายใน {formatToBeDate(activeUnpaidBill.dueDate)}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-4">
                        <h3 className="font-extrabold text-slate-800 text-[11px] mb-3">บัญชีโอนเงิน</h3>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                            BBL
                          </div>
                          <div>
                            <p className="text-[10px] font-bold text-slate-800">ธนาคารกรุงเทพ</p>
                            <p className="text-sm font-black text-slate-700">123-4-56789-0</p>
                            <p className="text-[9px] text-slate-500">บจก. หอพักดีเลิศ</p>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h3 className="font-extrabold text-slate-800 text-[11px] px-1">หลักฐานการโอนเงิน (สลิป)</h3>
                        <label className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all rounded-3xl p-6 text-center flex flex-col items-center justify-center cursor-pointer gap-2 bg-white">
                          <div className="p-3 bg-indigo-50 rounded-full text-indigo-500">
                            <Upload className="w-6 h-6 stroke-[2]" />
                          </div>
                          <div>
                            <p className="text-indigo-600 text-xs font-bold">{slipFile ? slipFile.name : 'อัปโหลดรูปสลิปโอนเงิน'}</p>
  <p className="text-slate-400 text-[9px] font-medium mt-0.5">{slipFile ? 'คลิกเพื่อเปลี่ยนไฟล์' : 'รองรับ JPG, PNG ขนาดไม่เกิน 5MB'}</p>
                          </div>
                          <input type="file" className="hidden" accept="image/*" onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              const file = e.target.files[0];
                              setSlipFile(file);
                              setToast({ type: 'success', title: 'อัปโหลดสำเร็จ', message: 'รูปสลิปถูกเตรียมพร้อมส่งแล้ว', visible: true });
                              setTimeout(() => setToast(null), 3000);
                            }
                          }} />
                        </label>
                      </div>
                    </div>

                    <div className="absolute bottom-0 left-0 right-0 p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 z-10">
                      <button
    onClick={handleSubmitPaymentSlip}
    disabled={!slipFile || isSubmittingSlip}
    className={`w-full py-3.5 text-white font-black text-xs rounded-xl shadow-lg transition-all active:scale-95 ${(!slipFile || isSubmittingSlip) ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200'}`}
  >
    {isSubmittingSlip ? 'กำลังส่งข้อมูล...' : 'ส่งหลักฐาน'}
  </button>
                    </div>
                  </div>
                )}

                {/* C. SUBVIEW: แจ้งซ่อมบำรุง (IMAGE 4 & 7) */}
                {subView === 'repairs' && (
                  <div className="flex flex-col h-full bg-slate-50 relative">
                    {renderSubViewHeader(
                      'แจ้งซ่อมบำรุง', 
                      <button 
                        onClick={() => setIsNewRepairOpen(true)}
                        className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors"
                        aria-label="แจ้งซ่อมใหม่"
                      >
                        <Plus className="w-4.5 h-4.5 stroke-[2.5]" />
                      </button>
                    )}

                    {/* Tabs for My Requests and History */}
                    <div className="flex border-b border-gray-100 bg-white sticky top-[45px] z-20 shrink-0">
                      <button 
                        onClick={() => setRepairTab('mine')}
                        className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors ${
                          repairTab === 'mine' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        รายการของฉัน
                      </button>
                      <button 
                        onClick={() => setRepairTab('history')}
                        className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors ${
                          repairTab === 'history' ? 'border-b-2 border-indigo-600 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        ประวัติการแจ้ง
                      </button>
                    </div>

                    <div className="p-4 space-y-3 pb-20">
                      {repairTab === 'mine' ? (
                        /* Current Active repair requests list */
                        tenantRepairs.filter(r => r.status !== 'completed' && r.status !== 'cancelled').length > 0 ? (
                          tenantRepairs.filter(r => r.status !== 'completed' && r.status !== 'cancelled').map((rep) => (
                            <div key={rep.id} className="p-4 bg-white border border-slate-100 rounded-2xl space-y-2.5 shadow-2xs">
                              <div className="flex justify-between items-start">
                                <span className="font-extrabold text-slate-800 text-xs leading-snug">{rep.title}</span>
                                <StatusBadge status={rep.status} type="maintenance" />
                              </div>
                              <p className="text-[10px] text-slate-500 leading-relaxed">{rep.description}</p>
                              {rep.imageBefore && (
                                <div className="mt-2 flex gap-2 items-center">
                                  <img 
                                    src={rep.imageBefore} 
                                    alt="Repair site" 
                                    onClick={() => setZoomedImage(rep.imageBefore!)}
                                    className="w-12 h-12 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-slate-150 transition-all"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}
                              <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[8px] text-slate-300">
                                <span>วันที่แจ้ง: {formatToBeDate(rep.createdAt)}</span>
                                {rep.assignedStaff && <span className="text-indigo-600 font-bold">ช่าง: ช่าง{rep.assignedStaff}</span>}
                              </div>
                            </div>
                          ))
                        ) : (
                          /* Styled Empty Folder State (Image 4) */
                          <div className="text-center py-20 flex flex-col items-center justify-center gap-3">
                            <div className="p-4 bg-slate-100 rounded-full text-slate-400 mb-1">
                              <Folder className="w-8 h-8 stroke-[1.5]" />
                            </div>
                            <span className="text-slate-400 font-extrabold text-[11px]">ไม่มีรายการแจ้งซ่อมบำรุง</span>
                          </div>
                        )
                      ) : (
                        /* History of completed/cancelled repair requests */
                        tenantRepairs.filter(r => r.status === 'completed' || r.status === 'cancelled').length > 0 ? (
                          tenantRepairs.filter(r => r.status === 'completed' || r.status === 'cancelled').map((rep) => (
                            <div key={rep.id} className="p-4 bg-white border border-slate-100 rounded-2xl space-y-2.5 shadow-2xs">
                              <div className="flex justify-between items-start">
                                <span className="font-bold text-slate-700 text-xs leading-snug">{rep.title}</span>
                                <StatusBadge status={rep.status} type="maintenance" />
                              </div>
                              <p className="text-[10px] text-slate-400 leading-relaxed">{rep.description}</p>
                              {rep.imageBefore && (
                                <div className="mt-2 flex gap-2 items-center">
                                  <span className="text-[8px] text-slate-400 font-semibold">รูปแนบ:</span>
                                  <img 
                                    src={rep.imageBefore} 
                                    alt="Repair site" 
                                    onClick={() => setZoomedImage(rep.imageBefore!)}
                                    className="w-12 h-12 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-slate-150 transition-all"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              )}
                              <div className="pt-2 border-t border-slate-100 text-[8px] text-slate-300">
                                <span>แล้วเสร็จเมื่อ: {formatToBeDate(rep.updatedAt)}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <p className="text-center py-12 text-slate-400 font-semibold">ไม่มีประวัติเรื่องแจ้งซ่อมย้อนหลัง</p>
                        )
                      )}
                    </div>

                    {/* Bottom Sticky Action Button (Image 4) */}
                    <div className="p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 sticky bottom-[56px] z-10">
                      <button
                        onClick={() => setIsNewRepairOpen(true)}
                        className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors"
                      >
                        + แจ้งซ่อมบำรุงใหม่
                      </button>
                    </div>

                    {/* Slide-Up Overlay Drawer Form for New Request (Image 7) */}
                    {isNewRepairOpen && (
                      <div className="absolute inset-0 z-50 flex flex-col justify-end">
                        {/* Backdrop overlay */}
                        <div 
                          className="absolute inset-0 bg-slate-900/40 backdrop-blur-2xs"
                          onClick={() => setIsNewRepairOpen(false)}
                        />
                        {/* Popup Card */}
                        <div className="bg-white rounded-t-3xl border-t border-slate-200 p-5 shadow-2xl relative z-10 max-h-[90%] overflow-y-auto space-y-4 animate-in slide-in-from-bottom duration-250">
                          <div className="flex justify-between items-center">
                            <h3 className="font-black text-slate-900 text-xs">รายละเอียดแจ้งซ่อม</h3>
                            <button 
                              onClick={() => setIsNewRepairOpen(false)}
                              className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-700 rounded-full transition-colors"
                            >
                              <X className="w-4 h-4 stroke-[2.5]" />
                            </button>
                          </div>

                          <form onSubmit={handleCreateRepair} className="space-y-4 text-left">
                            <div className="space-y-1.5">
                              <label className="block font-bold text-slate-700 text-[10px]">หัวข้อปัญหา *</label>
                              <input
                                type="text"
                                required
                                value={repairTitle}
                                onChange={(e) => setRepairTitle(e.target.value)}
                                placeholder="เช่น แอร์ไม่เย็น, น้ำรั่ว"
                                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-slate-800 font-bold focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="block font-bold text-slate-700 text-[10px]">รายละเอียดเพิ่มเติม</label>
                              <textarea
                                value={repairDesc}
                                onChange={(e) => setRepairDesc(e.target.value)}
                                placeholder="อธิบายจุดที่เกิดปัญหาเพิ่มเติม..."
                                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-slate-800 h-24 resize-none focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="block font-bold text-slate-700 text-[10px]">แนบรูปถ่ายสถานที่หรือปัญหา (ไม่บังคับ)</label>
                              
                              <input
                                type="file"
                                ref={repairFileInputRef}
                                onChange={handleRepairFileChange}
                                accept="image/*"
                                className="hidden"
                              />

                              {repairImage ? (
                                <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-center justify-between">
                                  <div className="flex items-center gap-3 overflow-hidden">
                                    <img
                                      src={repairImage}
                                      alt="Preview"
                                      className="w-12 h-12 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0"
                                      referrerPolicy="no-referrer"
                                    />
                                    <div className="min-w-0">
                                      <p className="text-slate-800 font-bold truncate text-[10px]">{repairImageName || 'image.jpg'}</p>
                                      <p className="text-indigo-600 font-semibold text-[8px]">อัปโหลดสำเร็จ</p>
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={handleRepairRemoveFile}
                                    className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 shrink-0"
                                  >
                                    ล้างรูปภาพ
                                  </button>
                                </div>
                              ) : (
                                <div
                                  onClick={() => repairFileInputRef.current?.click()}
                                  className="border border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/5 transition-all rounded-xl p-4 text-center flex flex-col items-center justify-center cursor-pointer gap-1.5"
                                >
                                  <div className="p-1.5 bg-slate-100 rounded-full text-slate-500">
                                    <Camera className="w-4 h-4 stroke-[2]" />
                                  </div>
                                  <p className="text-slate-500 text-[10px] font-bold">กดเพื่ออัปโหลดรูปภาพ</p>
                                  <p className="text-slate-350 text-[8px] font-medium">จำกัดขนาดไฟล์สูงสุด 5MB</p>
                                </div>
                              )}
                            </div>

                            <button
                              type="submit"
                              className="w-full py-3 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-xs transition-colors"
                            >
                              ส่งเรื่องแจ้งซ่อม
                            </button>
                          </form>
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* D. SUBVIEW: ค่าน้ำ / ค่าไฟ */}
                {false && (
                  <div className="flex flex-col h-full bg-slate-50">
                    {renderSubViewHeader('ค่าน้ำ / ค่าไฟ')}
                    
                    <div className="p-4 space-y-4">
                      <div>
                        <h4 className="text-xs font-black text-slate-800">วิเคราะห์ปริมาณการใช้</h4>
                        <p className="text-[9px] text-slate-400 mt-1">เปรียบเทียบหน่วยน้ำไฟที่ใช้รายรอบบิลย้อนหลัง</p>
                      </div>

                      {/* Recharts chart representation */}
                      <div className="bg-white p-3 rounded-2xl border border-slate-100 h-52 text-[8px] shadow-2xs">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={utilitiesData}>
                            <XAxis dataKey="name" stroke="#94a3b8" />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="elec" name="ไฟ (หน่วย)" stroke="#f59e0b" strokeWidth={2.5} />
                            <Line type="monotone" dataKey="water" name="น้ำ (หน่วย)" stroke="#0ea5e9" strokeWidth={2.5} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Current meter status reading card */}
                      <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-2xs space-y-3">
                        <h5 className="font-extrabold text-slate-800 text-[10px]">เลขอ่านมิเตอร์ล่าสุด</h5>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-amber-50/50 p-3 rounded-xl border border-amber-100 text-center space-y-1">
                            <span className="text-[8px] text-amber-700 font-bold">มิเตอร์ไฟ</span>
                            <p className="font-black text-amber-900 text-sm">122 หน่วย</p>
                          </div>
                          <div className="bg-sky-50/50 p-3 rounded-xl border border-sky-100 text-center space-y-1">
                            <span className="text-[8px] text-sky-700 font-bold">มิเตอร์น้ำ</span>
                            <p className="font-black text-sky-900 text-sm">8 หน่วย</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* E. SUBVIEW: เอกสารสัญญา (IMAGE 2) */}
                {false && (
                  <div className="flex flex-col h-full bg-slate-50">
                    {renderSubViewHeader('เอกสารสัญญา')}

                    <div className="p-4 space-y-4">
                      {tenantContracts.map((con) => (
                        <div key={con.id} className="space-y-4">
                          
                          {/* Main Contract Spec Card */}
                          <div className="bg-white p-5 border border-slate-100 rounded-3xl space-y-4 shadow-xs">
                            <div className="flex items-center gap-3">
                              <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl">
                                <FileText className="w-5 h-5 stroke-[2.2]" />
                              </div>
                              <div>
                                <h4 className="font-black text-slate-900 text-xs">สัญญาเช่าห้อง</h4>
                                <p className="text-[9px] text-slate-400 mt-0.5">ห้อง {tenantRoom?.roomNumber || 'A-005'}</p>
                              </div>
                            </div>

                            {/* Details grid list */}
                            <div className="border-t border-slate-100 pt-4 space-y-3 text-[10px] leading-none text-slate-600">
                              <div className="flex justify-between items-center">
                                <span>วันที่เริ่มสัญญา</span>
                                <span className="font-extrabold text-slate-800">{formatToBeFullDate(con.startDate)}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>วันที่สิ้นสุดสัญญา</span>
                                <span className="font-extrabold text-slate-800">{formatToBeFullDate(con.endDate)}</span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span>ระยะเวลา</span>
                                <span className="font-extrabold text-slate-800">{getContractDurationMonths(con.startDate, con.endDate)} เดือน</span>
                              </div>
                            </div>

                            <div className="pt-3 border-t border-slate-100">
                              <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-full text-[9px] font-bold">
                                สถานะ: กำลังเช่า
                              </span>
                            </div>
                          </div>

                          {/* Action downloadable attachments section */}
                          <div className="space-y-3.5">
                            <h4 className="text-[10px] font-black text-slate-900 px-1">เอกสารของฉัน</h4>
                            
                            <div className="space-y-2.5">
                              {[
                                {
                                  title: `เอกสารสัญญาเช่า (เลขที่ ${con.contractNumber})`,
                                  subtitle: 'PDF • สัญญาเช่าฉบับสมบูรณ์.pdf',
                                  category: 'สัญญาเช่า',
                                  fileName: `สัญญาเช่า_${con.contractNumber}.txt`,
                                  content: `=== เอกสารสัญญาเช่าห้องพัก ===\nเลขที่สัญญา: ${con.contractNumber}\nผู้เช่า: คุณ ${tenant.name}\nห้องพัก: ${tenantRoom?.roomNumber || 'A-101'}\nระยะเวลาสัญญา: ${formatToBeFullDate(con.startDate)} ถึง ${formatToBeFullDate(con.endDate)}\nอัตราค่าเช่า: ${con.monthlyRent.toLocaleString('th-TH')} บาท/เดือน\nเงินประกัน: ${con.depositAmount.toLocaleString('th-TH')} บาท\nลงนามโดย: ${tenant.name} (ผู้เช่า) และ �;ѡ (ผู้ให้เช่า)\nวันที่ออกเอกสาร: ${formatToBeFullDate(con.startDate)}`
                                },
                                {
                                  title: 'กฎระเบียบและข้อบังคับอาคารพักอาศัย',
                                  subtitle: 'PDF • ระเบียบการพักอาศัย.pdf',
                                  category: 'ข้อบังคับอาคาร',
                                  fileName: 'กฎระเบียบและข้อบังคับอาคาร.txt',
                                  content: `=== กฎระเบียบและข้อบังคับการเข้าพักอาศัย ===\nหอพัก: �;ѡ\n1. ห้ามส่งเสียงดังยามวิกาลหลังเวลา 22:00 น.\n2. การรักษาความสะอาดบริเวณทางเดินส่วนกลาง\n3. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง\n4. การนำสัตว์เลี้ยงเข้าพักต้องได้รับอนุญาตตามเงื่อนไขของหอพักเท่านั้น\n5. ห้ามดัดแปลง ต่อเติม หรือเจาะผนังอาคารโดยไม่ได้รับอนุมัติ`
                                },
                                {
                                  title: 'เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า',
                                  subtitle: 'PDF • บัตรประชาชนผู้เช่า.pdf',
                                  category: 'เอกสารประจำตัว',
                                  fileName: `สำเนาบัตรประชาชน_${tenant.name}.txt`,
                                  content: `=== สำเนาบัตรประจำตัวประชาชนผู้เช่า ===\nชื่อ-นามสกุล: ${tenant.name}\nเลขประจำตัวประชาชน: ${tenant.citizenId}\nเบอร์โทรศัพท์: ${tenant.phone}\nอีเมล: ${tenant.email}\nสถานะ: รับรองสำเนาถูกต้องสำหรับใช้ในการทำสัญญาเช่าพักอาศัยห้อง ${tenantRoom?.roomNumber || 'A-101'} เท่านั้น`
                                }
                              ].map((doc, idx) => (
                                <div 
                                  key={idx}
                                  className="bg-white p-3.5 border border-slate-100 rounded-2xl flex justify-between items-center shadow-2xs hover:border-indigo-200 transition-all cursor-pointer group"
                                  onClick={() => setSelectedDocModal(doc)}
                                >
                                  <div className="flex items-center gap-3 min-w-0 pr-2">
                                    <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-500 font-extrabold text-[10px] flex items-center justify-center shrink-0 border border-rose-100 group-hover:scale-105 transition-transform">
                                      PDF
                                    </div>
                                    <div className="space-y-0.5 min-w-0">
                                      <h5 className="font-extrabold text-slate-800 text-[10px] truncate group-hover:text-indigo-600 transition-colors">{doc.title}</h5>
                                      <p className="text-[8px] text-slate-400 truncate">{doc.subtitle}</p>
                                    </div>
                                  </div>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDownloadDoc(doc.title, doc.fileName, doc.content);
                                    }}
                                    className="p-2 bg-slate-50 hover:bg-indigo-600 border border-slate-100 hover:border-indigo-600 text-slate-500 hover:text-white rounded-xl transition-all shrink-0 cursor-pointer"
                                    aria-label="ดาวน์โหลด"
                                    title="ดาวน์โหลดเอกสาร"
                                  >
                                    <Download className="w-4 h-4 stroke-[2]" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                        </div>
                      ))}

                      {tenantContracts.length === 0 && (
                        <p className="text-center py-12 text-slate-400">ไม่พบข้อมูลทะเบียนเอกสารสัญญาจดทะเบียน</p>
                      )}
                    </div>
                  </div>
                )}

                {/* G. SUBVIEW: ลงทะเบียนผู้เช่า (REGISTER) */}
                {subView === 'register' && (
                  <TenantRegisterView
                    onBack={() => setSubView(null)}
                    onSuccess={(registeredTenant) => {
                      setLocalTenant(registeredTenant);
                      refreshData();
                      setSubView(null);
                      showToast('success', 'ลงทะเบียนผู้เช่าสำเร็จ', `เพิ่มข้อมูลคุณ ${registeredTenant.name} เข้าสู่ระบบเรียบร้อยแล้ว`);
                      setTimeout(() => {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                        const scrollables = document.querySelectorAll('.overflow-y-auto, #tenant-main-scroll-container');
                        scrollables.forEach(el => { el.scrollTop = 0; });
                      }, 50);
                    }}
                  />
                )}
              </>
            )}

          </div>

          {/* Fixed bottom navigation bar */}
          <div className="absolute bottom-0 inset-x-0 bg-white border-t border-slate-100 p-2 flex justify-between items-center z-20 shrink-0 shadow-sm">
            {[
              { id: 'home', label: 'หน้าหลัก', icon: Home },
              { id: 'announcements', label: 'ประกาศ', icon: Bell },
              { id: 'payments_tab', label: 'บิล', icon: FileText },
              { id: 'profile', label: 'โปรไฟล์', icon: User }
            ].map(item => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id && false;
              return (
                <button
                   key={item.id}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    setSubView(null);
                  }}
                  className={`flex-1 py-1 flex flex-col items-center justify-center gap-1 transition-all ${
                    isSelected 
                      ? 'text-indigo-600 font-black scale-105' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Icon className="w-4 h-4 stroke-[2]" />
                  <span className="text-[8px] leading-none font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>

        </div>

      {/* Edit Co-occupants Modal */}
      <Modal 
        isOpen={isCoOccupantsModalOpen} 
        onClose={() => setIsCoOccupantsModalOpen(false)} 
        title="รายชื่อผู้พักอาศัยร่วม"
        size="md"
      >
        <div className="space-y-4">
          
          {/* Current co-occupants list */}
          <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
            {editCoOccupants.map((co, index) => {
              const isConfirming = deleteConfirmCoId === co.id;
              return (
                <div key={co.id || index} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center transition-all duration-200">
                  {isConfirming ? (
                    <div className="flex-1 flex items-center justify-between gap-2 animate-in fade-in duration-250">
                      <span className="text-[10px] font-bold text-rose-600">ยืนยันต้องการลบคุณ {co.name}?</span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmCoId(null)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          onClick={() => handleConfirmRemoveCoOccupant(co.id, co.name)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                        >
                          ยืนยันลบ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs">
                        <p className="font-extrabold text-slate-800">{co.name}</p>
                        <p className="text-slate-500 text-[10px] mt-0.5">โทร: {co.phone}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmCoId(co.id)}
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-all cursor-pointer"
                        title="ลบผู้พักอาศัยร่วม"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {editCoOccupants.length === 0 && (
              <p className="text-center py-6 text-slate-400 text-[10px] font-semibold">ไม่มีผู้พักอาศัยร่วมลงทะเบียน</p>
            )}
          </div>

          {/* Add Form */}
          <div className="p-3.5 border border-indigo-100 bg-indigo-50/5 rounded-2xl space-y-3">
            <h5 className="font-black text-indigo-950 text-xs flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-indigo-600" />
              เพิ่มผู้พักอาศัยร่วมใหม่
            </h5>

            {coOccupantsError && (
              <p className="text-[10px] text-rose-600 font-bold bg-rose-50 border border-rose-100 px-2 py-1 rounded-md">{coOccupantsError}</p>
            )}

            <div className="space-y-2">
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 font-bold">ชื่อ-นามสกุล / ชื่อเล่น *</label>
                <input
                  type="text"
                  value={newCoName}
                  onChange={(e) => setNewCoName(e.target.value)}
                  placeholder="เช่น นายอานนท์ มั่นคง"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1 font-bold">เบอร์โทรศัพท์ *</label>
                <input
                  type="text"
                  value={newCoPhone}
                  onChange={(e) => setNewCoPhone(e.target.value)}
                  placeholder="เช่น 0891234567"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddCoOccupant}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> เพิ่มลงในรายการด้านบน
            </button>
          </div>

          {/* Footer Action buttons */}
          <div className="pt-3 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setIsCoOccupantsModalOpen(false)}
              className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
            >
              เสร็จสิ้น
            </button>
          </div>
        </div>
      </Modal>

      {/* 1. Move Out Request Confirmation Modal */}
      <Modal
        isOpen={isMoveOutModalOpen}
        onClose={() => setIsMoveOutModalOpen(false)}
        title="แจ้งย้ายออก / เลิกเช่าห้องพัก"
      >
        <div className="space-y-4 font-sans text-xs">
          <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl space-y-1.5 text-amber-900">
            <h5 className="font-extrabold text-xs flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              ข้อควราบรู้ก่อนแจ้งย้ายออก
            </h5>
            <ul className="list-disc list-inside text-[10px] space-y-1 text-amber-800 leading-relaxed font-medium pl-1">
              <li>โปรดแจ้งย้ายออก<strong>ล่วงหน้าอย่างน้อย 30 วัน</strong> ตามระเบียบข้อตกลงสัญญาเช่า</li>
              <li>ผู้เช่าต้องชำระค่าน้ำ ค่าไฟ และค่าเช่าค้างชำระทั้งหมดจนถึงวันสิ้นสุดการเช่า</li>
              <li>เจ้าหน้าที่จะนัดหมายตรวจสภาพห้องพัก ข้าวของเครื่องใช้ และคืนเงินประกัน (หลังหักค่าธรรมเนียม/ความเสียหาย) ภายใน 7-14 วัน</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-slate-600 font-bold mb-1">วันที่ประสงค์จะย้ายออก *</label>
              <input 
                type="date"
                value={moveOutDate}
                onChange={(e) => setMoveOutDate(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-slate-600 font-bold mb-1">ธนาคารสำหรับรับเงินประกันคืน</label>
                <input 
                  type="text"
                  placeholder="เช่น กสิกรไทย, ไทยพาณิชย์"
                  value={moveOutBank}
                  onChange={(e) => setMoveOutBank(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] text-slate-600 font-bold mb-1">เลขที่บัญชี / พร้อมเพย์</label>
                <input 
                  type="text"
                  placeholder="เช่น 123-4-56789-0"
                  value={moveOutAccount}
                  onChange={(e) => setMoveOutAccount(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-slate-600 font-bold mb-1">เหตุผลในการย้ายออก (ถ้ามี)</label>
              <textarea 
                rows={2}
                placeholder="ระบุเหตุผลสั้นๆ เช่น ย้ายสถานที่ทำงาน, เรียนจบการศึกษา"
                value={moveOutReason}
                onChange={(e) => setMoveOutReason(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500 resize-none"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setIsMoveOutModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleConfirmMoveOut}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>ยืนยันส่งคำขอแจ้งย้ายออก</span>
            </button>
          </div>
        </div>
      </Modal>

      {/* 2. Document Preview & Viewer Modal */}
      {selectedDocModal && (
        <Modal
          isOpen={Boolean(selectedDocModal)}
          onClose={() => setSelectedDocModal(null)}
          title={selectedDocModal.category}
        >
          <div className="space-y-4 font-sans text-xs">
            <div className="border-b border-slate-100 pb-2">
              <h4 className="font-extrabold text-slate-900 text-sm">{selectedDocModal.title}</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">{selectedDocModal.subtitle}</p>
            </div>

            <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl text-[11px] font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto border border-slate-800 shadow-inner">
              {selectedDocModal.content}
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelectedDocModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
              <button
                type="button"
                onClick={() => handleDownloadDoc(selectedDocModal.title, selectedDocModal.fileName, selectedDocModal.content, selectedDocModal.docType, selectedDocModal.docId)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4 stroke-[2]" />
                <span>ดาวน์โหลดเอกสาร PDF</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 3. Notification Center Modal */}
      <Modal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        title="ศูนย์การแจ้งเตือน"
      >
        <div className="space-y-4 font-sans text-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="font-black text-slate-800 text-xs">การแจ้งเตือนทั้งหมด ({totalNotificationsCount})</span>
            <span className="text-[9px] text-indigo-600 font-extrabold bg-indigo-50 px-2 py-0.5 rounded-md">อัปเดตล่าสุด</span>
          </div>

          <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
            {/* Unpaid Bills */}
            {unreadBills.map(b => (
              <div key={b.id} className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 font-bold">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <h5 className="font-extrabold text-amber-900 text-[11px] truncate">มียอดค้างชำระ {formatThaiCycle(b.cycleId)}</h5>
                    <p className="text-[9px] text-amber-700">จำนวน ฿{b.totalAmount.toLocaleString('th-TH')} บาท &bull; กำหนดชำระภายใน 15 พ.ค.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsNotificationModalOpen(false);
                    setSubView('invoice');
                  }}
                  className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer"
                >
                  ชำระเงิน
                </button>
              </div>
            ))}

            {/* Active Repairs */}
            {activeRepairs.map(r => (
              <div key={r.id} className="p-3 bg-indigo-50/70 border border-indigo-200/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 font-bold">
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <h5 className="font-extrabold text-indigo-900 text-[11px] truncate">แจ้งซ่อม: {r.title}</h5>
                    <p className="text-[9px] text-indigo-700">สถานะ: {r.status === 'in_progress' ? 'กำลังดำเนินการซ่อม' : 'รอดำเนินการ'}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsNotificationModalOpen(false);
                    setSubView('repairs');
                    setRepairTab('history');
                  }}
                  className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer"
                >
                  ติดตาม
                </button>
              </div>
            ))}

            {/* Urgent Announcements */}
            {urgentAnnouncements.map(a => (
              <div key={a.id} className="p-3 bg-violet-50/70 border border-violet-200/60 rounded-2xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0 font-bold">
                    <Megaphone className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <h5 className="font-extrabold text-violet-900 text-[11px] truncate">{a.title}</h5>
                    <p className="text-[9px] text-violet-700">โดย {getAuthorRoleName(a.author)} &bull; {formatThaiDate(a.publishDate || a.createdAt.split('T')[0])}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIsNotificationModalOpen(false);
                    setActiveTab('announcements');
                    setSubView(null);
                  }}
                  className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer"
                >
                  ดูประกาศ
                </button>
              </div>
            ))}

            {totalNotificationsCount === 0 && (
              <p className="text-center py-8 text-slate-400 font-medium">ไม่มีรายการแจ้งเตือนใหม่ในขณะนี้</p>
            )}
          </div>

          <div className="pt-2 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => setIsNotificationModalOpen(false)}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-extrabold transition-all cursor-pointer"
            >
              ปิด
            </button>
          </div>
        </div>
      </Modal>

      {/* Zoomed Image Popup */}
      {zoomedImage && (
        <div 
          className="fixed inset-0 bg-black/85 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setZoomedImage(null)}
        >
          <div 
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Elegant close button positioned outside the top-right of the image itself */}
            <button 
              type="button"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setZoomedImage(null)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img 
              src={zoomedImage} 
              alt="Zoomed announcement" 
              className="max-w-[90vw] md:max-w-4xl max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-2xl shadow-2xl border border-white/10 select-none cursor-zoom-out transition-transform duration-300 hover:scale-[1.01]"
              onClick={() => setZoomedImage(null)}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

      {/* Floating Success Toast Notification with Smooth Fade */}
      {toast && toast.visible && (
        <div 
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading 
              ? 'opacity-0 translate-y-3 pointer-events-none' 
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          <div className={`p-1 rounded-lg ${toast.type === 'success' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            <CheckCircle className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div className="flex-1 min-w-0 pr-1">
            <h4 className="font-extrabold text-slate-800 text-xs leading-tight">{toast.title}</h4>
            {toast.message && <p className="text-[10px] text-slate-500 mt-0.5 leading-normal font-medium">{toast.message}</p>}
          </div>
          <button 
            type="button"
            onClick={() => setToast(prev => prev ? { ...prev, visible: false } : null)} 
            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

    </div>
  );
};

// Clock helper svg icon
const ClockIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

