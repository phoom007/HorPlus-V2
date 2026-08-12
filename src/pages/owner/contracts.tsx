/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  FileText,
  Search,
  Plus,
  PenTool,
  Printer,
  Calendar,
  Layers,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Undo2,
  Settings2,
  Upload,
  User,
  CreditCard,
  CheckCircle2,
  MapPin,
  Flame,
  FileCheck2,
  Trash2,
  Check,
  XCircle,
  Edit3,
  Clock,
  MessageSquare,
  ShieldAlert,
  Phone,
  Mail,
  FileCheck,
  X
} from 'lucide-react';
import {
  StatusBadge,
  SignaturePad,
  formatBaht,
  formatThaiDate,
  PrintView,
  Modal,
  ThaiDatePicker,
  CurrencyInput
} from '../../components/GlobalComponents';
import { Contract, Tenant, Room, Bill, BillItem, BLOCKING_CONTRACT_STATUSES } from '../../types';
import { getDataProvider } from '../../data/dataProvider';

export interface PendingContractSubmission {
  id: string;
  tenantName: string;
  phone: string;
  email: string;
  citizenId: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  requestedRoomNumber: string;
  requestedRoomId?: string;
  startDate: string;
  endDate?: string;
  stayDate: string;
  durationMonths: number;
  rentAmount: number;
  depositAmount: number;
  depositStatus: 'unpaid' | 'paid' | 'returned';
  depositType?: 'refundable' | 'deduct_rent';
  terms: string;
  tenantSignature: string;
  submittedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  editNoticeToTenant?: string;
}

export const getDormitory = (): any => null;

export const getPendingContractSubmissions = (): PendingContractSubmission[] => {
  return [];
};

export const savePendingContractSubmissions = (_subs: PendingContractSubmission[]) => {
  // PostgreSQL tenant_registration_requests is authoritative
};

interface OwnerContractsProps {
  contracts: Contract[];
  tenants: Tenant[];
  rooms: Room[];
  bills?: Bill[];
  selectedCycle?: string;
  onSaveContracts: (contracts: Contract[]) => void;
  onSaveTenants?: (tenants: Tenant[]) => void;
  onSaveRooms: (rooms: Room[]) => void;
  onSaveBills?: (bills: Bill[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  initialContractId?: string;
  onClearInitialContractId?: () => void;
  onBackToTenants?: (tenantId?: string) => void;
}

export const OwnerContracts: React.FC<OwnerContractsProps> = ({
  contracts,
  tenants,
  rooms,
  bills = [],
  selectedCycle,
  onSaveContracts,
  onSaveTenants,
  onSaveRooms,
  onSaveBills,
  onAddLog,
  initialContractId,
  onClearInitialContractId,
  onBackToTenants
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [cycleFilter, setCycleFilter] = useState<'cycle' | 'all'>('all');
  const DataProvider = getDataProvider();
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [snapshotData, setSnapshotData] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);

  React.useEffect(() => {
    if (selectedContract && DataProvider.properties) {
      DataProvider.properties.getContractSnapshot(selectedContract.id).then(res => {
        if (res.success && res.data) {
          setSnapshotData(res.data);
        } else {
          setSnapshotData(null);
        }
      }).catch(() => setSnapshotData(null));
    } else {
      setSnapshotData(null);
    }
  }, [selectedContract?.id]);

  // Pending Contract Approvals State
  const [pendingSubmissions, setPendingSubmissions] = useState<PendingContractSubmission[]>(getPendingContractSubmissions);
  const [isPendingListOpen, setIsPendingListOpen] = useState(false);
  const [selectedPending, setSelectedPending] = useState<PendingContractSubmission | null>(null);

  // Editable fields for Pending Submission approval review
  const [pendingRent, setPendingRent] = useState<number>(0);
  const [pendingDeposit, setPendingDeposit] = useState<number>(0);
  const [pendingStartDate, setPendingStartDate] = useState<string>('');
  const [pendingEndDate, setPendingEndDate] = useState<string>('');
  const [pendingDuration, setPendingDuration] = useState<number>(6);
  const [pendingDepositStatus, setPendingDepositStatus] = useState<'paid' | 'unpaid' | 'returned'>('paid');
  const [pendingDepositType, setPendingDepositType] = useState<'refundable' | 'deduct_rent'>('refundable');
  const [pendingTerms, setPendingTerms] = useState<string>('');

  // Rejection modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Edit Notice modal state
  const [isEditNoticeModalOpen, setIsEditNoticeModalOpen] = useState(false);
  const [editNotice, setEditNotice] = useState('');

  // Toast notification
  const [pendingToast, setPendingToast] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  React.useEffect(() => {
    if (pendingToast) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setPendingToast(null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [pendingToast]);

  React.useEffect(() => {
    if (selectedPending) {
      setPendingRent(selectedPending.rentAmount);
      setPendingDeposit(selectedPending.depositAmount);
      setPendingStartDate(selectedPending.startDate);
      setPendingDuration(selectedPending.durationMonths);
      setPendingEndDate(selectedPending.endDate || calculateEndDate(selectedPending.startDate, selectedPending.durationMonths));
      setPendingDepositStatus(selectedPending.depositStatus);
      setPendingDepositType(selectedPending.depositType || 'refundable');
      setPendingTerms(selectedPending.terms);
      setEditNotice('');
    }
  }, [selectedPending]);

  const activePendingCount = pendingSubmissions.filter(p => p.status === 'pending').length;
  const dorm: any = null;

  const handleApprovePendingSubmission = async (noticeMsg?: string) => {
    if (!selectedPending) return;

    try {
      setIsSaving(true);
      const res = await (getDataProvider().tenantRegistrations as any).approveRequest(selectedPending.id, {
        createContract: true,
        startDate: pendingStartDate || selectedPending.startDate,
        endDate: pendingEndDate || calculateEndDate(pendingStartDate || selectedPending.startDate, pendingDuration || selectedPending.durationMonths),
        durationMonths: pendingDuration || selectedPending.durationMonths,
        rentAmount: pendingRent || selectedPending.rentAmount,
        depositAmount: pendingDeposit || selectedPending.depositAmount,
        advancePaymentAmount: 0,
        terms: pendingTerms || selectedPending.terms
      });
      setIsSaving(false);
      if (res.success) {
        setIsPendingDetailOpen(false);
        setSelectedPending(null);
        if (onSaveContracts) {
          const updatedContracts = await getDataProvider().contracts.getAll();
          onSaveContracts(updatedContracts);
        }
        if (onSaveTenants) {
          const updatedTenants = await getDataProvider().tenants.getAll();
          onSaveTenants(updatedTenants);
        }
      } else {
        setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการอนุมัติคำขอ');
      }
    } catch (err: any) {
      setIsSaving(false);
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการอนุมัติคำขอ');
    }
  };

  const handleRejectPendingSubmission = async (reason: string) => {
    if (!selectedPending) return;

    try {
      setIsSaving(true);
      const res = await (getDataProvider().tenantRegistrations as any).rejectRequest(selectedPending.id, reason);
      setIsSaving(false);
      if (res.success) {
        setIsPendingDetailOpen(false);
        setSelectedPending(null);
      } else {
        setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการปฏิเสธคำขอ');
      }
    } catch (err: any) {
      setIsSaving(false);
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการปฏิเสธคำขอ');
    }
  };

  // Navigation & Back state
  const [isFromTenantDoc, setIsFromTenantDoc] = useState(false);
  const [navigatedTenantId, setNavigatedTenantId] = useState<string | undefined>(undefined);

  // Termination Modal State
  const [isTerminateOpen, setIsTerminateOpen] = useState(false);
  const [terminateReason, setTerminateReason] = useState<'normal' | 'early' | 'urgent'>('normal');
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [damageFee, setDamageFee] = useState('0');
  const [additionalNote, setAdditionalNote] = useState('');
  const [isSuccessAnimating, setIsSuccessAnimating] = useState(false);

  // Renewal Modal State
  const [isRenewModalOpen, setIsRenewModalOpen] = useState(false);
  const [renewContractTarget, setRenewContractTarget] = useState<Contract | null>(null);
  const [renewUnit, setRenewUnit] = useState<'month' | 'day'>('month');
  const [renewMonths, setRenewMonths] = useState<number>(6);
  const [renewDays, setRenewDays] = useState<number>(30);
  const [renewEndDate, setRenewEndDate] = useState<string>('');
  const [renewRentAmount, setRenewRentAmount] = useState<number>(0);

  // Auto select contract on mount if initialContractId provided
  React.useEffect(() => {
    if (initialContractId) {
      const contract = contracts.find(c => c.id === initialContractId);
      if (contract) {
        setSelectedContract(contract);
        setIsCreating(false);
        setIsFromTenantDoc(true);
        setNavigatedTenantId(contract.tenantId);
      }
      if (onClearInitialContractId) {
        onClearInitialContractId();
      }
    }
  }, [initialContractId, contracts, onClearInitialContractId]);

  // Creator state
  const [selectedTenantId, setSelectedTenantId] = useState<string>(tenants[0]?.id || '');
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0]?.id || '');
  const [startDate, setStartDate] = useState('2026-07-14');
  const [stayDate, setStayDate] = useState('2026-07-20');
  const [durationMonths, setDurationMonths] = useState(6);
  const [tenantSig, setTenantSig] = useState<string | undefined>(
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><path d="M10,20 Q30,10 50,25 T90,15" stroke="black" stroke-width="2" fill="none"/></svg>'
  );
  const [errorText, setErrorText] = useState<string | null>(null);

  // Derive selected tenant object
  const selectedTenant = tenants.find(t => t.id === selectedTenantId) || tenants[0];
  const tenantName = selectedTenant ? selectedTenant.name : '';
  const tenantPhone = selectedTenant ? selectedTenant.phone : '';

  // Selected room details helper
  const selectedRoom = rooms.find(r => r.id === selectedRoomId) || rooms[0];

  const handleSelectTenant = (tId: string) => {
    setSelectedTenantId(tId);
    const tenantObj = tenants.find(t => t.id === tId);
    if (tenantObj) {
      const tenantRoom = rooms.find(r => r.currentTenantId === tenantObj.id);
      if (tenantRoom) {
        setSelectedRoomId(tenantRoom.id);
      } else {
        const vacantRoom = rooms.find(r => r.status === 'vacant');
        if (vacantRoom) {
          setSelectedRoomId(vacantRoom.id);
        }
      }
    }
  };

  const handleSmartFill = () => {
    const candidateTenant = tenants.find(t => t.status === 'active') || tenants[0];
    if (candidateTenant) {
      handleSelectTenant(candidateTenant.id);
      setStartDate('2026-07-14');
      setStayDate('2026-07-20');
      setDurationMonths(6);
      onAddLog('ดึงข้อมูลอัจฉริยะ (Smart Fill)', `ดึงข้อมูลคุณ ${candidateTenant.name} เข้าสู่สัญญาอัตโนมัติ`, 'Contract', candidateTenant.id);
    } else {
      setErrorText('ไม่พบข้อมูลผู้เช่าในระบบเพื่อดึงข้อมูล');
    }
  };

  const calculateEndDate = (start: string, duration: number) => {
    if (!start) return '-';
    const date = new Date(start);
    date.setMonth(date.getMonth() + duration);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  };

  const handleSaveContract = () => {
    setErrorText(null);
    if (!selectedTenant) {
      setErrorText('กรุณาเลือกผู้เช่าจากระบบ');
      return;
    }
    if (!selectedRoomId || !selectedRoom) {
      setErrorText('กรุณาเลือกห้องพักสำหรับสัญญาเช่า');
      return;
    }
    if (!tenantSig) {
      setErrorText('กรุณาลงลายมือชื่อผู้เช่าเพื่อรับรองสัญญา');
      return;
    }

    const calculatedEnd = calculateEndDate(startDate, durationMonths);
    if (startDate > calculatedEnd) {
      setErrorText('วันที่เริ่มต้นสัญญาต้องไม่เกินวันสิ้นสุดสัญญา');
      return;
    }

    // Overlap Check (Task 4)
    const overlapContract = contracts.find(c => {
      if (!BLOCKING_CONTRACT_STATUSES.includes(c.status)) return false;
      const sameTenant = c.tenantId === selectedTenant.id;
      const sameRoom = c.roomId === selectedRoom.id || c.roomId === selectedRoom.roomNumber;
      if (!sameTenant && !sameRoom) return false;

      const existingStart = c.startDate;
      const existingEnd = c.endDate;
      if (!existingStart || !existingEnd) return false;

      return (startDate <= existingEnd) && (calculatedEnd >= existingStart);
    });

    if (overlapContract) {
      const roomObj = rooms.find(r => r.id === overlapContract.roomId || r.roomNumber === overlapContract.roomId);
      const tenantObj = tenants.find(t => t.id === overlapContract.tenantId);
      setErrorText(
        `ไม่สามารถบันทึกสัญญาเช่าได้ เนื่องจากมีสัญญาเช่าซ้อนทับช่วงเวลา (สัญญาเลขที่ ${overlapContract.contractNumber} ` +
        `ของ ${tenantObj?.name || 'ผู้เช่า'} ห้อง ${roomObj?.roomNumber || overlapContract.roomId} ` +
        `ช่วง ${formatThaiDate(overlapContract.startDate)} - ${formatThaiDate(overlapContract.endDate)})`
      );
      return;
    }

    const newId = `ct-${Date.now()}`;
    const newContract: Contract = {
      id: newId,
      contractNumber: `CNT-2026-${1000 + contracts.length}`,
      tenantId: selectedTenant.id,
      roomId: selectedRoom.id,
      startDate,
      endDate: calculatedEnd,
      durationMonths,
      rentAmount: selectedRoom.monthlyRent,
      depositAmount: selectedRoom.monthlyRent * 2,
      depositStatus: 'unpaid',
      terms: '1. ผู้เช่าตกลงชำระค่าเช่าภายในวันที่ 5 ของทุกเดือน หากช้าปรับวันละ 100 บาท\n2. ห้ามเลี้ยงสัตว์เลี้ยงชนิดที่ส่งเสียงดังหรือก่อให้เกิดกลิ่นรบกวนอาคาร\n3. เงินประกันความเสียหายจะได้รับคืนเต็มจำนวนภายใน 15 วันนับจากวันที่ย้ายออกโดยไม่มีสิ่งของชำรุด',
      tenantSignature: tenantSig,
      ownerSignature: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><path d="M10,25 Q40,5 60,30 T90,20" stroke="blue" stroke-width="2" fill="none"/></svg>',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update Room currentTenantId and status to occupied
    if (selectedRoom.status === 'vacant' || selectedRoom.currentTenantId !== selectedTenant.id) {
      const updatedRooms = rooms.map(r => r.id === selectedRoom.id ? {
        ...r,
        status: 'occupied' as const,
        currentTenantId: selectedTenant.id,
        updatedAt: new Date().toISOString()
      } : r);
      onSaveRooms(updatedRooms);
    }

    // Update Tenant status to active
    if (onSaveTenants) {
      const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
        ...t,
        status: 'active' as const,
        rentalHistory: t.rentalHistory?.includes(selectedRoom.id) ? t.rentalHistory : [...(t.rentalHistory || []), selectedRoom.id],
        updatedAt: new Date().toISOString()
      } : t);
      onSaveTenants(updatedTenants);
    }

    onSaveContracts([...contracts, newContract]);
    setSelectedContract(newContract);
    setIsCreating(false);
    onAddLog('ทำสัญญาเช่าฉบับใหม่', `บันทึกสัญญาเช่าใหม่ ${newContract.contractNumber} (${selectedTenant.name} - ห้อง ${selectedRoom.roomNumber}) เรียบร้อย`, 'Contract', newId);
  };

  const isContractActiveInCycle = (c: Contract, cycleId?: string) => {
    if (!cycleId) return true;
    const parts = cycleId.split('-');
    if (parts.length < 2) return true;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const cycleStart = `${cycleId}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const cycleEnd = `${cycleId}-${lastDay < 10 ? '0' + lastDay : lastDay}`;

    // Overlap check
    if (c.startDate && c.endDate) {
      if (c.startDate <= cycleEnd && c.endDate >= cycleStart) return true;
    }
    // Check if bill exists for cycle and room/tenant
    if (bills && bills.some(b => b.cycleId === cycleId && (b.roomId === c.roomId || b.tenantId === c.tenantId))) {
      return true;
    }
    return false;
  };

  const getTenantName = (tId: string, contract?: Contract) => {
    const resolveName = (t: any) => {
      if (!t) return null;
      return t.name || t.displayName || `${t.firstName || ''} ${t.lastName || ''}`.trim() || null;
    };

    if (contract && cycleFilter === 'cycle' && selectedCycle && bills && bills.length > 0) {
      const cycleBill = bills.find(b => b.cycleId === selectedCycle && (b.roomId === contract.roomId || b.tenantId === contract.tenantId));
      if (cycleBill && cycleBill.tenantId) {
        const cycleTenant = tenants.find(t => t.id === cycleBill.tenantId);
        const resolved = resolveName(cycleTenant);
        if (resolved) return resolved;
      }
    }
    const found = tenants.find(t => t.id === tId);
    return resolveName(found) || 'ไม่พบข้อมูลผู้เช่า';
  };

  const getRoomNum = (rId: string) => rooms.find(r => r.id === rId)?.roomNumber || '-';

  const getStayDurationText = (startDateStr: string) => {
    if (!startDateStr) return 'ไม่พบข้อมูลวันเข้าพัก';
    try {
      const start = new Date(startDateStr);
      const now = new Date();
      if (isNaN(start.getTime())) return 'ไม่พบข้อมูลวันเข้าพัก';

      let years = now.getFullYear() - start.getFullYear();
      let months = now.getMonth() - start.getMonth();
      let days = now.getDate() - start.getDate();

      if (days < 0) {
        months -= 1;
        const prevMonthLastDay = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
        days += prevMonthLastDay;
      }
      if (months < 0) {
        years -= 1;
        months += 12;
      }

      const parts = [];
      if (years > 0) parts.push(`${years} ปี`);
      if (months > 0) parts.push(`${months} เดือน`);
      if (days > 0 || parts.length === 0) parts.push(`${days} วัน`);

      return parts.join(' ');
    } catch (e) {
      return 'ไม่พบข้อมูลระยะเวลา';
    }
  };

  const handleConfirmTerminate = () => {
    if (!selectedContract) return;

    const targetTenantId = selectedContract.tenantId;
    const targetTenant = tenants.find(t => t.id === targetTenantId);
    const tenantName = targetTenant ? targetTenant.name : getTenantName(targetTenantId);
    const room = rooms.find(r => r.id === selectedContract.roomId || r.currentTenantId === targetTenantId);
    const roomNumber = room ? room.roomNumber : getRoomNum(selectedContract.roomId);
    const parsedDamageFee = Number(damageFee) || 0;

    // 1. Update room status to vacant and clear currentTenantId
    const updatedRooms = rooms.map(r => (r.id === selectedContract.roomId || r.currentTenantId === targetTenantId) ? {
      ...r,
      status: 'vacant' as const,
      currentTenantId: undefined,
      updatedAt: new Date().toISOString()
    } : r);

    // 2. Set tenant status to inactive (DO NOT delete history)
    const updatedTenants = tenants.map(t => t.id === targetTenantId ? {
      ...t,
      status: 'inactive' as const,
      updatedAt: new Date().toISOString()
    } : t);

    // 3. Update contract status to 'expired'
    const updatedContracts = contracts.map(c => {
      if (c.id === selectedContract.id || (c.tenantId === targetTenantId && (c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out' || c.status === 'pending_signature'))) {
        return {
          ...c,
          status: 'expired' as const,
          updatedAt: new Date().toISOString(),
          terms: `${c.terms || ''}\n[ระบบนิติ] เลิกเช่าคืนห้องพักเมื่อ ${new Date().toLocaleDateString('th-TH')} / หักค่าเสียหาย: ${parsedDamageFee} บาท / คืนเงินประกัน: ${refundDeposit ? 'ใช่' : 'ไม่'}${additionalNote ? ` / หมายเหตุ: ${additionalNote}` : ''}`
        };
      }
      return c;
    });

    // 4. Update or generate final bill for tenant
    let updatedBills = [...bills];
    const existingUnpaidBillIndex = updatedBills.findIndex(
      b => b.tenantId === targetTenantId && b.status !== 'paid' && b.status !== 'cancelled'
    );

    if (existingUnpaidBillIndex >= 0) {
      const existingBill = updatedBills[existingUnpaidBillIndex];
      const otherItems = existingBill.items.filter(item => item.category !== 'fine');
      if (parsedDamageFee > 0) {
        otherItems.push({
          id: `item-damage-${Date.now()}`,
          description: 'หักค่าปรับ / ค่าเสียหายอื่น ๆ (แจ้งเลิกเช่า)',
          amount: parsedDamageFee,
          category: 'fine'
        });
      }
      const newTotal = otherItems.reduce((sum, item) => sum + item.amount, 0);

      updatedBills[existingUnpaidBillIndex] = {
        ...existingBill,
        items: otherItems,
        totalAmount: newTotal,
        status: 'pending',
        updatedAt: new Date().toISOString()
      };
    } else {
      const finalBillItems: BillItem[] = [
        {
          id: `item-rent-${Date.now()}`,
          description: `ค่าเช่าห้องพักงวดสุดท้าย (ห้อง ${roomNumber || ''})`,
          amount: room ? room.monthlyRent : selectedContract.rentAmount || 0,
          category: 'rent'
        }
      ];
      if (parsedDamageFee > 0) {
        finalBillItems.push({
          id: `item-damage-${Date.now()}`,
          description: 'หักค่าปรับ / ค่าเสียหายอื่น ๆ (แจ้งเลิกเช่า)',
          amount: parsedDamageFee,
          category: 'fine'
        });
      }
      const totalBillAmount = finalBillItems.reduce((sum, item) => sum + item.amount, 0);
      const currentCycle = selectedCycle || new Date().toISOString().slice(0, 7);

      const newFinalBill: Bill = {
        id: `bill-final-${targetTenantId}-${Date.now()}`,
        billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
        cycleId: currentCycle,
        roomId: room ? room.id : selectedContract.roomId,
        tenantId: targetTenantId,
        items: finalBillItems,
        totalAmount: totalBillAmount,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      updatedBills.push(newFinalBill);
    }

    // 5. Save
    onSaveRooms(updatedRooms);
    if (onSaveTenants) onSaveTenants(updatedTenants);
    onSaveContracts(updatedContracts);
    if (onSaveBills) onSaveBills(updatedBills);

    // Update current selectedContract state
    setSelectedContract({
      ...selectedContract,
      status: 'expired'
    });

    // 6. Add action log
    const detailLog = `ผู้เช่า ${tenantName} เลิกเช่าคืนห้องพัก (ห้อง ${roomNumber}) - สถานะห้อง: ว่าง, สัญญา: หมดอายุ, เงินประกันคืน: ${refundDeposit ? 'คืนเงินประกัน' : 'ไม่คืน'}, หักค่าเสียหาย: ${parsedDamageFee} บาท`;
    onAddLog('เลิกเช่าคืนห้อง', detailLog, 'Tenant', targetTenantId);

    // 7. Close modal & show toast notification
    setIsSuccessAnimating(false);
    setIsTerminateOpen(false);
    setPendingToast(`ยกเลิกสัญญาและคืนห้องพัก ${roomNumber} เรียบร้อยแล้ว`);
  };

  const calculateAutoRent = (unit: 'month' | 'day', _count: number, contract: Contract | null) => {
    if (!contract) return 0;
    const room = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
    const monthlyRate = room?.monthlyRent || contract.rentAmount || 4000;
    const dailyRate = room?.dailyRent || (monthlyRate ? Math.round(monthlyRate / 30) : 500);

    if (unit === 'month') {
      return monthlyRate;
    } else {
      return dailyRate;
    }
  };

  const handleOpenRenewModal = (contract: Contract) => {
    setRenewContractTarget(contract);
    setRenewUnit('month');
    setRenewMonths(6);
    setRenewDays(30);
    const baseDate = new Date(contract.endDate);
    if (isNaN(baseDate.getTime())) {
      baseDate.setTime(Date.now());
    }
    baseDate.setMonth(baseDate.getMonth() + 6);
    setRenewEndDate(baseDate.toISOString().split('T')[0]);
    setRenewRentAmount(calculateAutoRent('month', 6, contract));
    setIsRenewModalOpen(true);
  };

  const handleRenewUnitChange = (unit: 'month' | 'day') => {
    setRenewUnit(unit);
    if (renewContractTarget) {
      const baseDate = new Date(renewContractTarget.endDate);
      if (isNaN(baseDate.getTime())) {
        baseDate.setTime(Date.now());
      }
      const count = unit === 'month' ? renewMonths : renewDays;
      if (unit === 'month') {
        baseDate.setMonth(baseDate.getMonth() + renewMonths);
      } else {
        baseDate.setDate(baseDate.getDate() + renewDays);
      }
      setRenewEndDate(baseDate.toISOString().split('T')[0]);
      setRenewRentAmount(calculateAutoRent(unit, count, renewContractTarget));
    }
  };

  const handleRenewValueChange = (val: number) => {
    if (renewUnit === 'month') {
      setRenewMonths(val);
    } else {
      setRenewDays(val);
    }
    if (renewContractTarget) {
      const baseDate = new Date(renewContractTarget.endDate);
      if (isNaN(baseDate.getTime())) {
        baseDate.setTime(Date.now());
      }
      if (renewUnit === 'month') {
        baseDate.setMonth(baseDate.getMonth() + val);
      } else {
        baseDate.setDate(baseDate.getDate() + val);
      }
      setRenewEndDate(baseDate.toISOString().split('T')[0]);
      setRenewRentAmount(calculateAutoRent(renewUnit, val, renewContractTarget));
    }
  };

  const handleExecuteRenewal = () => {
    if (!renewContractTarget) return;

    const finalRent = renewRentAmount > 0 ? renewRentAmount : renewContractTarget.rentAmount;
    const addedMonths = renewUnit === 'month' ? renewMonths : Math.max(1, Math.round(renewDays / 30));

    const updatedContracts = contracts.map(c => {
      if (c.id === renewContractTarget.id) {
        return {
          ...c,
          status: 'active' as const,
          durationMonths: c.durationMonths + addedMonths,
          endDate: renewEndDate,
          rentAmount: finalRent,
          updatedAt: new Date().toISOString()
        };
      }
      return c;
    });

    onSaveContracts(updatedContracts);

    const updatedContractObj: Contract = {
      ...renewContractTarget,
      status: 'active' as const,
      durationMonths: renewContractTarget.durationMonths + addedMonths,
      endDate: renewEndDate,
      rentAmount: finalRent,
      updatedAt: new Date().toISOString()
    };

    setSelectedContract(updatedContractObj);

    const durationText = renewUnit === 'month' ? `${renewMonths} เดือน` : `${renewDays} วัน`;

    onAddLog(
      'ต่ออายุสัญญาเช่า',
      `ต่ออายุสัญญาเช่าห้องพักหมายเลข ${getRoomNum(renewContractTarget.roomId)} เพิ่มอีก ${durationText} (สิ้นสุดวันที่ ${formatThaiDate(renewEndDate)})`,
      'Contract',
      renewContractTarget.id
    );

    setIsRenewModalOpen(false);
    setPendingToast(`ต่ออายุสัญญาเช่าห้อง ${getRoomNum(renewContractTarget.roomId)} เรียบร้อยแล้ว`);
    setRenewContractTarget(null);
  };

  const getContractSortPriority = (c: Contract): number => {
    if (c.status === 'active') {
      if (c.endDate) {
        const end = new Date(c.endDate).getTime();
        const now = new Date().getTime();
        const diffDays = (end - now) / (1000 * 3600 * 24);
        if (diffDays <= 14) {
          return 2; // ใกล้หมดสัญญา
        }
      }
      return 1; // ใช้งานอยู่
    }
    if (c.status === 'expiring_soon') return 2; // ใกล้หมดสัญญา
    if (c.status === 'terminated') return 3; // ยกเลิกก่อนกำหนด
    if (c.status === 'expired') return 4; // หมดสัญญา
    return 5;
  };

  const filteredContracts = contracts.filter(c => {
    if (cycleFilter === 'cycle' && selectedCycle) {
      if (!isContractActiveInCycle(c, selectedCycle)) return false;
    }
    const tName = (getTenantName(c.tenantId, c) || '').toLowerCase();
    const rNum = (getRoomNum(c.roomId) || '').toLowerCase();
    const cNum = (c?.contractNumber || '').toLowerCase();
    const query = (searchQuery || '').toLowerCase();
    const matchSearch = tName.includes(query) ||
                        rNum.includes(query) ||
                        cNum.includes(query);
    return matchSearch;
  }).sort((a, b) => {
    const pA = getContractSortPriority(a);
    const pB = getContractSortPriority(b);
    if (pA !== pB) return pA - pB;
    return a.id.localeCompare(b.id);
  });

  // Single Page Contract Creator (Screenshot 2)
  if (isCreating) {
    return (
      <div className="space-y-6">
        
        {/* Sub Header Navigation Bar */}
        <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-xs flex flex-col sm:flex-row gap-4 justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsCreating(false)}
              className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl transition-all"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 leading-none">ออกสัญญาเช่าห้องพัก</h3>
              <p className="text-[10px] text-slate-400 mt-1 leading-none">กรอกข้อมูล เลือกห้องพัก และตรวจสอบสัญญาในหน้าเดียว</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 border border-slate-150 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition-colors"
            >
              กลับ
            </button>
            <button className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors">
              <Settings2 className="w-4 h-4" />
              ตั้งค่าสัญญา
            </button>
          </div>
        </div>

        {errorText && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span className="font-semibold">{errorText}</span>
          </div>
        )}

        {/* 2-Column Responsive Layout Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          
          {/* Left Column (3/5 width) */}
          <div className="lg:col-span-3 space-y-6">
            
            {/* Card 1: Attachments (เอกสารแนบ) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-900">เอกสารแนบ</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Profile Pic Card */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2">
                  <span className="text-[10px] font-bold text-slate-500">รูปผู้เช่า</span>
                  <div className="w-14 h-14 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center overflow-hidden border-2 border-white shadow-sm">
                    <User className="w-6 h-6" />
                  </div>
                  <button className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[9px] font-bold text-slate-600 inline-flex items-center gap-1 shadow-2xs">
                    <Upload className="w-3 h-3" /> อัปโหลดใหม่
                  </button>
                </div>

                {/* ID Card Card */}
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col items-center justify-center text-center space-y-2 col-span-2">
                  <span className="text-[10px] font-bold text-slate-500">บัตร ปชช. *</span>
                  
                  {/* CSS ID Card mockup */}
                  <div className="w-full max-w-[200px] h-20 bg-blue-50/80 border border-blue-200 rounded-xl p-2.5 relative flex gap-2 overflow-hidden shadow-2xs">
                    <div className="absolute right-1.5 top-1.5 w-6 h-3.5 bg-red-500 rounded-2xs opacity-40" />
                    <div className="w-10 h-12 bg-slate-200 rounded-md shrink-0 flex items-center justify-center">
                      <User className="w-4 h-4 text-slate-400" />
                    </div>
                    <div className="space-y-1 text-left min-w-0 flex-1">
                      <div className="w-16 h-2 bg-blue-600 rounded-2xs" />
                      <div className="w-12 h-1.5 bg-slate-300 rounded-2xs" />
                      <div className="w-20 h-1.5 bg-slate-300 rounded-2xs" />
                      <div className="w-14 h-1.5 bg-slate-300 rounded-2xs" />
                    </div>
                  </div>

                  <button className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[9px] font-bold text-slate-600 inline-flex items-center gap-1 shadow-2xs">
                    <Upload className="w-3 h-3" /> อัปเดตเอกสารบัตร
                  </button>
                </div>

              </div>
            </div>

            {/* Card 2: Contract Info (ข้อมูลตามสัญญา) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-900">ข้อมูลตามสัญญา</h4>
                <button
                  type="button"
                  onClick={handleSmartFill}
                  className="px-2.5 py-1.5 bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-bold rounded-xl flex items-center gap-1 hover:bg-blue-100 transition-all cursor-pointer"
                >
                  <PenTool className="w-3 h-3" />
                  ดึงข้อมูลอัตโนมัติ (Smart Fill)
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">ผู้เช่าในระบบ *</label>
                  <select
                    value={selectedTenantId}
                    onChange={(e) => handleSelectTenant(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-white text-xs font-semibold text-slate-800 focus:border-blue-500 outline-none"
                  >
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.phone}) {t.status === 'active' ? '• มีห้องพักแล้ว' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">เบอร์โทรศัพท์ผู้เช่า</label>
                  <input
                    type="text"
                    readOnly
                    value={tenantPhone}
                    placeholder="080-000-0000"
                    className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-slate-100 text-xs font-semibold text-slate-600 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">วันเริ่มเข้าพัก</label>
                  <input
                    type="date"
                    value={stayDate}
                    onChange={(e) => setStayDate(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-slate-50/50 text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">หมายเลขห้องพัก</label>
                  <input
                    type="text"
                    disabled
                    value={`ห้อง ${selectedRoom.roomNumber}`}
                    className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-slate-100 text-xs font-semibold text-slate-500 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">วันที่เริ่มต้นสัญญา</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-slate-50/50 text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 block">ระยะเวลาสัญญา</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={durationMonths}
                      onChange={(e) => setDurationMonths(Number(e.target.value))}
                      className="w-full px-3.5 py-2 border border-slate-150 rounded-xl bg-slate-50/50 text-xs font-semibold text-slate-800 focus:bg-white focus:border-blue-500 outline-none pr-12"
                    />
                    <span className="absolute right-3.5 top-2.5 text-[10px] font-bold text-slate-400">เดือน</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 3: Room Selection (เลือกห้องพัก *) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-900">เลือกห้องพัก *</h4>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 max-h-52 overflow-y-auto pr-1">
                {rooms.map((room) => {
                  const isSelected = selectedRoomId === room.id;
                  const isAssignedToThisTenant = room.currentTenantId === selectedTenant?.id;
                  const isVacant = room.status === 'vacant';
                  const isSelectable = isVacant || isAssignedToThisTenant;

                  return (
                    <button
                      key={room.id}
                      type="button"
                      disabled={!isSelectable}
                      onClick={() => isSelectable && setSelectedRoomId(room.id)}
                      className={`p-3 rounded-2xl text-left border transition-all flex flex-col justify-between ${
                        isSelected 
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-600/10 cursor-pointer' 
                          : isSelectable
                            ? 'bg-slate-50/50 border-slate-150/60 text-slate-800 hover:border-slate-300 cursor-pointer'
                            : 'bg-slate-100/60 border-slate-200/50 text-slate-400 cursor-not-allowed opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="text-xs font-extrabold">ห้อง {room.roomNumber}</span>
                        {!isSelectable && (
                          <span className="text-[9px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-md">มีผู้เช่าอื่น</span>
                        )}
                      </div>
                      <span className={`text-[10px] block mt-1.5 font-bold ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
                        {formatBaht(room.monthlyRent).split('.')[0]} บ./ด.
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card 4: Database Computed metrics (ข้อมูลระบบฐานข้อมูล) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5">
              <h4 className="text-xs font-bold text-slate-900">ข้อมูลระบบฐานข้อมูล</h4>
              
              <div className="divide-y divide-slate-100 text-xs font-semibold">
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">วันที่ทำสัญญา (อัตโนมัติ)</span>
                  <span className="text-slate-800">{formatThaiDate(startDate)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">เริ่มเข้าพัก (ลิงก์ตามเทมเพลต)</span>
                  <span className="text-slate-800">{formatThaiDate(stayDate)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">สิ้นสุดสัญญา (คำนวณอัตโนมัติ)</span>
                  <span className="text-emerald-600 font-extrabold">{formatThaiDate(calculateEndDate(startDate, durationMonths))}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">ค่าเช่า / เดือน</span>
                  <span className="text-slate-800 font-bold">{formatBaht(selectedRoom.monthlyRent)}</span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-slate-400">เงินประกันสัญญา</span>
                  <span className="text-slate-800 font-bold">{formatBaht(selectedRoom.depositAmount)}</span>
                </div>
                <div className="flex justify-between py-2 pt-2.5 text-blue-600 font-extrabold">
                  <span>ค่าเช่าล่วงหน้า (และยอดรวมมัดจำวันทำสัญญา)</span>
                  <span className="text-sm">{formatBaht(selectedRoom.monthlyRent * 2)}</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column (2/5 width) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* PDF Preview Card */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <div className="p-1.5 bg-red-50 text-red-500 rounded-lg shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 leading-none">ตัวอย่าง PDF ที่จะออกให้ผู้เช่า</h4>
                  <span className="text-[8px] text-slate-400 mt-0.5 block">แบบร่างสัญญาเช่าระบบพินัยกรรมดิจิทัล</span>
                </div>
              </div>

              {/* Virtual PDF Document View */}
              <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl text-[10px] text-slate-700 leading-relaxed font-serif min-h-[300px] shadow-2xs space-y-4 select-none">
                <div className="text-center font-bold text-slate-900 text-xs">หนังสือสัญญาเช่าห้องพักอาศัย</div>
                
                <p>
                  ทำขึ้น ณ โครงการหอพัก HorPlus วันที่ 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{formatThaiDate(startDate)}</span>
                  ระหว่างนิตินายทะเบียน กับ
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{tenantName}</span>
                  เบอร์ติดต่อโทร 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{tenantPhone}</span>
                </p>

                <p>
                  โดยคู่สัญญาทั้งสองฝ่ายได้ตกลงเข้าเช่า 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">ห้อง {selectedRoom.roomNumber}</span>
                  ซึ่งมีอัตราค่าบริการเช่าเดือนละ 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{formatBaht(selectedRoom.monthlyRent).split('.')[0]} บาท</span>
                </p>

                <p>
                  สัญญาเช่าฉบับนี้กำหนดระยะเวลาเช่าทั้งสิ้น 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{durationMonths} เดือน</span>
                  เริ่มเข้าพำนักนับตั้งแต่วันที่ 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{formatThaiDate(stayDate)}</span>
                  คู่สัญญาได้รับเงินมัดจำประกันสัญญา 
                  <span className="bg-blue-50 text-blue-600 border border-blue-100 font-bold px-1.5 py-0.5 rounded-md font-sans mx-1">{formatBaht(selectedRoom.depositAmount).split('.')[0]} บาท</span>
                  และค่าเช่าล่วงหน้าเสร็จสิ้นเรียบร้อย
                </p>

                <div className="pt-4 flex justify-between gap-4 text-center font-sans">
                  <div className="flex-1">
                    <span className="text-[8px] text-slate-400 block mb-1">ลงชื่อ ผู้เช่า</span>
                    {tenantSig ? (
                      <img src={tenantSig} alt="sig" className="h-8 mx-auto object-contain border border-slate-100 bg-white p-0.5 rounded-sm" />
                    ) : (
                      <div className="h-8 border border-dashed border-slate-200" />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-[8px] text-slate-400 block mb-1">ลงชื่อ ผู้ให้เช่า</span>
                    <div className="h-8 flex items-center justify-center text-blue-600 font-semibold italic text-xs">HorPlus Inc.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Signature Pad Card (ลายมือชื่อผู้เช่า) */}
            <div className="bg-white p-5 rounded-3xl border border-slate-100 shadow-xs space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-900">ลายมือชื่อผู้เช่า</h4>
                <button
                  type="button"
                  onClick={() => setTenantSig(undefined)}
                  className="text-[10px] font-bold text-red-500 hover:text-red-700"
                >
                  ล้างลายเซ็น
                </button>
              </div>

              <div className="border border-slate-150 rounded-2xl overflow-hidden bg-slate-50 relative">
                <SignaturePad
                  onSave={(url) => setTenantSig(url)}
                  placeholder="วาดเซ็นลายมือชื่อผู้เช่าที่นี่ด้วยเมาส์หรือนิ้วสัมผัส"
                />
              </div>
              {tenantSig ? (
                <p className="text-[10px] text-emerald-600 font-bold text-right flex items-center justify-end gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> ลายเซ็นผ่านการตรวจสอบระบบ
                </p>
              ) : (
                <p className="text-[10px] text-rose-500 font-bold text-right">&bull; ต้องการการลงนามผู้เช่า</p>
              )}
            </div>

            {/* Main Submit Button */}
            <button
              onClick={handleSaveContract}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 hover:shadow-lg transition-all"
            >
              <FileCheck2 className="w-4 h-4" />
              ยืนยันข้อมูลและบันทึกสัญญา
            </button>

          </div>

        </div>

      </div>
    );
  }

  // Contract Master-Detail splits list (Default layout)
  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-3 gap-6">
      
      {/* Left List Pane */}
      <div className={`lg:col-span-1 bg-white p-5 rounded-3xl border border-slate-100 shadow-xs flex flex-col h-[700px] ${
        selectedContract ? 'hidden lg:flex' : 'flex'
      }`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider">สัญญาทั้งหมด ({filteredContracts.length})</h3>
          <button 
            type="button"
            onClick={() => {
              const target = pendingSubmissions.find(p => p.status === 'pending') || pendingSubmissions[0];
              if (target) {
                setSelectedPending(target);
              } else {
                setIsPendingListOpen(true);
              }
            }} 
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] rounded-xl flex items-center gap-1.5 transition-all shadow-xs cursor-pointer relative"
          >
            <FileCheck2 className="w-3.5 h-3.5" />
            <span>รออนุมัติสัญญาเช่า</span>
            {activePendingCount > 0 && (
              <>
                <span className="px-1.5 py-0.2 bg-white text-indigo-700 rounded-full text-[9px] font-black shadow-2xs">
                  {activePendingCount}
                </span>
                <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse absolute -top-1 -right-1 border-2 border-white shadow-2xs" />
              </>
            )}
          </button>
        </div>



        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-2.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="ค้นหาผู้เช่า, เลขสัญญา, เลขห้อง..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-slate-100 rounded-xl bg-slate-50 text-slate-800 font-medium outline-none"
          />
        </div>

        {/* Scroll List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 pr-1 space-y-1.5">
          {filteredContracts.map((con) => (
            <div
              key={con.id}
              onClick={() => setSelectedContract(con)}
              className={`p-3.5 rounded-2xl cursor-pointer transition-all flex flex-col gap-2.5 border ${
                selectedContract?.id === con.id 
                  ? 'bg-blue-50/70 border-blue-150/40' 
                  : 'hover:bg-slate-50 border-transparent'
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="font-extrabold text-slate-800 text-xs leading-none">คุณ{getTenantName(con.tenantId, con)}</span>
                <StatusBadge status={con.status} type="contract" />
              </div>
              <div className="flex justify-between text-[10px] text-slate-400 leading-none">
                <span>สัญญา: {con.contractNumber}</span>
                <span className="font-extrabold text-blue-600">ห้อง {getRoomNum(con.roomId)}</span>
              </div>
            </div>
          ))}
          {filteredContracts.length === 0 && (
            <div className="text-center py-12 text-xs text-slate-400 font-medium">
              ไม่พบประวัติสัญญาเช่า
            </div>
          )}
        </div>
      </div>

      {/* Right Print Preview Pane */}
      <div className={`lg:col-span-2 min-w-0 w-full ${selectedContract ? 'block' : 'hidden lg:block'}`}>
        {selectedContract ? (
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-xs h-[700px] flex flex-col justify-between overflow-y-auto">
            <PrintView
              title="พิมพ์สัญญาเช่า"
              headerLeft={
                (isFromTenantDoc && onBackToTenants) ? (
                  <button
                    onClick={() => {
                      setIsFromTenantDoc(false);
                      onBackToTenants(navigatedTenantId || selectedContract?.tenantId);
                    }}
                    className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[10.5px] rounded-xl flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>ย้อนกลับ</span>
                  </button>
                ) : (
                  <button
                    onClick={() => setSelectedContract(null)}
                    className="lg:hidden px-3 py-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 font-extrabold text-[10.5px] rounded-xl flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>ย้อนกลับ</span>
                  </button>
                )
              }
            >
              <div className="space-y-6 text-xs text-slate-800 font-sans max-w-2xl mx-auto leading-relaxed">
                <div className="text-center space-y-1 pb-4 border-b border-slate-100">
                  <h3 className="text-base font-extrabold text-slate-950 uppercase tracking-wide">หนังสือสัญญาเช่าที่พักอาศัย</h3>
                  <p className="text-slate-400 font-medium text-[10px]">สัญญาเลขที่: {selectedContract.contractNumber}</p>
                </div>

                <div className="space-y-4">
                  <p>
                    สัญญาฉบับนี้ทำขึ้น ณ <span className="font-extrabold text-slate-900">อาคารหอพัก {dorm?.name || 'HorPlus'} ({dorm?.address || 'ที่อยู่หอพัก'})</span> เมื่อวันที่ <span className="font-semibold">{formatThaiDate(selectedContract.createdAt.split('T')[0])}</span> ระหว่าง
                    <span className="font-extrabold text-slate-900"> นิติบุคคล {dorm?.name || 'HorPlus'} (ผู้ให้เช่า)</span> ฝ่ายหนึ่ง กับ
                    <span className="font-extrabold text-slate-900"> คุณ{getTenantName(selectedContract.tenantId, selectedContract)} (ผู้เช่า)</span> อีกฝ่ายหนึ่ง โดยมีใจความดังเงื่อนไขต่อไปนี้:
                  </p>

                  {/* Requirement 6: Separate ContractSnapshot vs Current Room/Default Values */}
                  <div className="bg-slate-50 p-4 border border-slate-200 rounded-2xl space-y-3" data-testid="snapshot-comparison">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        เปรียบเทียบค่าในสัญญาล็อก (Contract Snapshot) กับค่าห้องปัจจุบัน (Current Room Defaults)
                      </span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-bold">
                        Snapshot Locked
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      {/* Left: Locked Contract Snapshot Values */}
                      <div className="bg-white p-3 rounded-xl border border-emerald-200 space-y-1.5" data-testid="locked-snapshot-section">
                        <div className="font-bold text-emerald-800 text-[11px] flex items-center gap-1">
                          🔒 ค่าที่ล็อกไว้ในสัญญา (Locked Snapshot)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          ล็อกเมื่อ: {snapshotData?.lockedAt ? formatThaiDate(snapshotData.lockedAt.split('T')[0]) : formatThaiDate(selectedContract.startDate)}
                        </div>
                        <div className="space-y-1 pt-1">
                          <div className="flex justify-between">
                            <span className="text-slate-500">ค่าเช่าล็อก:</span>
                            <span className="font-extrabold text-slate-900" data-testid="locked-rent-value">{formatBaht(snapshotData?.rentAmount ?? selectedContract.rentAmount)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">เงินประกันล็อก:</span>
                            <span className="font-extrabold text-slate-900" data-testid="locked-deposit-value">{formatBaht(snapshotData?.depositAmount ?? selectedContract.depositAmount)}</span>
                          </div>
                          {snapshotData?.waterUnitRate !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">ค่าน้ำล็อก:</span>
                              <span className="font-bold text-slate-800">{snapshotData.waterUnitRate} บาท/หน่วย</span>
                            </div>
                          )}
                          {snapshotData?.electricUnitRate !== undefined && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">ค่าไฟล็อก:</span>
                              <span className="font-bold text-slate-800">{snapshotData.electricUnitRate} บาท/หน่วย</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Current Room Effective Values */}
                      <div className="bg-white p-3 rounded-xl border border-indigo-200 space-y-1.5" data-testid="current-defaults-section">
                        <div className="font-bold text-indigo-800 text-[11px] flex items-center gap-1">
                          🏠 ค่าห้องปัจจุบัน (Current Room Defaults)
                        </div>
                        <div className="text-[10px] text-slate-400">
                          อัปเดตล่าสุด: ปัจจุบัน
                        </div>
                        <div className="space-y-1 pt-1">
                          {(() => {
                            const room = rooms.find(r => r.id === selectedContract.roomId || r.roomNumber === selectedContract.roomId);
                            const eff = room?.currentEffectiveValues || {};
                            return (
                              <>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">ค่าเช่าปัจจุบัน:</span>
                                  <span className="font-extrabold text-slate-900" data-testid="current-rent-value">{formatBaht(eff.monthlyRent ?? room?.monthlyRent ?? selectedContract.rentAmount)}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-500">เงินประกันปัจจุบัน:</span>
                                  <span className="font-extrabold text-slate-900" data-testid="current-deposit-value">{formatBaht(eff.depositAmount ?? room?.depositAmount ?? selectedContract.depositAmount)}</span>
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-slate-500 italic pt-1">
                      * หมายเหตุ: การเปลี่ยนอัตราค่าเช่าหรือค่าบริการของห้องพักในภายหลัง จะ **ไม่มีผล** ต่อค่าในสัญญาเช่าฉบับที่ล็อกไว้นี้
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="font-bold text-slate-950">ข้อตกลงและระเบียบโครงการเพิ่มเติม:</p>
                    <p className="whitespace-pre-line text-slate-500 pl-2 leading-relaxed">{selectedContract.terms}</p>
                  </div>
                </div>

                {/* Signatures visual block */}
                <div className="grid grid-cols-2 gap-12 pt-10 border-t border-dashed border-slate-200 text-center">
                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ ผู้เช่าห้องพัก</p>
                    {selectedContract.tenantSignature ? (
                      <img src={selectedContract.tenantSignature} alt="ลายเซ็นผู้เช่า" className="h-10 mx-auto border border-slate-100 rounded-lg p-1 bg-slate-50/50 object-contain" />
                    ) : (
                      <div className="h-10 border border-dashed border-slate-200 rounded-lg" />
                    )}
                    <p className="font-extrabold text-slate-800">(คุณ{getTenantName(selectedContract.tenantId, selectedContract)})</p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ นิติหอพัก / ผู้เช่าร่วม</p>
                    {(selectedContract.ownerSignature || dorm?.ownerSignature) ? (
                      <img src={selectedContract.ownerSignature || dorm?.ownerSignature} alt="ลายเซ็นผู้ให้เช่า" className="h-10 mx-auto border border-slate-100 rounded-lg p-1 bg-slate-50/50 object-contain" />
                    ) : (
                      <div className="h-10 border border-dashed border-slate-200 rounded-lg" />
                    )}
                    <p className="font-extrabold text-slate-800">({dorm?.promptPayName || dorm?.name || 'กรรมการนิติบุคคล HorPlus'})</p>
                  </div>
                </div>

              </div>
            </PrintView>

            {/* Action buttons section */}
            <div className="mt-6 pt-5 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex flex-col items-start text-left">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">การจัดการสัญญารายเทอม / รายเดือน</span>
                <span className="text-xs text-slate-700 font-extrabold mt-1">
                  รูปแบบการเช่า: {rooms.find(r => r.id === selectedContract.roomId)?.rentCycle === 'term' ? 'รายเทอม (ไม่เกิน 6 เดือน)' : 'รายเดือนปกติ'}
                </span>
              </div>
              <div className="flex gap-2 w-full sm:w-auto">
                {selectedContract.status === 'active' ? (
                  <>
                    <button
                      onClick={() => {
                        setTerminateReason('normal');
                        setRefundDeposit(true);
                        setDamageFee('0');
                        setAdditionalNote('');
                        setIsTerminateOpen(true);
                      }}
                      className="flex-1 sm:flex-none px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      เลิกเช่า
                    </button>
                    <button
                      onClick={() => handleOpenRenewModal(selectedContract)}
                      className="flex-1 sm:flex-none px-4 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-600 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer animate-pulse hover:animate-none"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      ต่ออายุสัญญา
                    </button>
                  </>
                ) : (
                  <div className="text-xs font-bold text-rose-500 bg-rose-50 border border-rose-150 px-4 py-2 rounded-xl flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    สัญญานี้สิ้นสุดแล้ว
                  </div>
                )}
              </div>
            </div>

          </div>
        ) : (
          <div className="bg-slate-50 border border-dashed border-slate-200 rounded-3xl h-[700px] flex flex-col justify-center items-center p-6 text-center text-slate-400">
            <FileText className="w-12 h-12 text-slate-300 mb-3" />
            <h4 className="text-sm font-bold text-slate-700">ไม่มีหนังสือสัญญาเช่าถูกเลือกในขณะนี้</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs font-medium">กรุณาเลือกสัญญาฝั่งซ้ายมือเพื่อแสดงหนังสือพินัยกรรมสัญญาฉบับดิจิทัลฉบับเต็ม</p>
          </div>
        )}
      </div>

    </div>

    {/* Flexible Renewal Modal */}
    <Modal
      isOpen={isRenewModalOpen}
      onClose={() => {
        setIsRenewModalOpen(false);
        setRenewContractTarget(null);
      }}
      title="ต่ออายุสัญญาเช่า"
    >
      {renewContractTarget && (
        <div className="space-y-4 text-xs text-slate-800">
          {/* Target Contract Summary Banner */}
          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <span className="text-[10px] text-indigo-500 font-bold uppercase block">ข้อมูลผู้เช่าและห้องพัก</span>
              <p className="font-extrabold text-slate-900 text-sm">
                คุณ{getTenantName(renewContractTarget.tenantId)}
              </p>
              <p className="text-[11px] font-bold text-indigo-700">
                ห้อง {getRoomNum(renewContractTarget.roomId)} &bull; สัญญาเลขที่ {renewContractTarget.contractNumber}
              </p>
            </div>
            <div className="text-right shrink-0">
              <span className="text-[10px] text-slate-400 block font-bold">วันสิ้นสุดเดิม</span>
              <span className="font-extrabold text-slate-700 text-xs">
                {formatThaiDate(renewContractTarget.endDate)}
              </span>
            </div>
          </div>

          {/* Unit Switcher Tabs */}
          <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => handleRenewUnitChange('month')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                renewUnit === 'month' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              📅 ต่อเป็นรายเดือน
            </button>
            <button
              type="button"
              onClick={() => handleRenewUnitChange('day')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                renewUnit === 'day' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              ⏱️ ต่อเป็นรายวัน
            </button>
          </div>

          {/* Preset Selectors & Custom Input */}
          {renewUnit === 'month' ? (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  ระยะเวลาที่ต้องการต่ออายุ (เดือน)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[1, 4, 5, 6].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleRenewValueChange(m)}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        renewMonths === m
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      +{m} เดือน
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    จำนวนเดือน (กำหนดเอง)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={renewMonths}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      handleRenewValueChange(val);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div>
                  <ThaiDatePicker
                    label="วันสิ้นสุดสัญญาใหม่"
                    value={renewEndDate}
                    onChange={(val) => setRenewEndDate(val)}
                    required
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-800">
                  ระยะเวลาที่ต้องการต่ออายุ (วัน)
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[1, 2, 3, 7].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleRenewValueChange(d)}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        renewDays === d
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      +{d} วัน
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-800 mb-1">
                    จำนวนวัน (กำหนดเอง)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={renewDays}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 1;
                      handleRenewValueChange(val);
                    }}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
                  />
                </div>
                <div>
                  <ThaiDatePicker
                    label="วันสิ้นสุดสัญญาใหม่"
                    value={renewEndDate}
                    onChange={(val) => setRenewEndDate(val)}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {/* Rent Amount */}
          <div>
            <CurrencyInput
              label={renewUnit === 'month' ? "ค่าเช่ารายเดือน (บาท)" : "ค่าเช่ารายวัน (บาท)"}
              value={renewRentAmount}
              onChange={(val) => setRenewRentAmount(val)}
              required
            />
            {renewRentAmount > 0 && (
              <p className="mt-1 text-[11px] font-bold text-slate-500 text-right">
                ยอดรวมตลอดสัญญาประมาณ{' '}
                <span className="text-indigo-600 font-extrabold">
                  {(renewRentAmount * (renewUnit === 'month' ? renewMonths : renewDays)).toLocaleString()}
                </span>{' '}
                บาท ({renewUnit === 'month' ? `${renewMonths} เดือน` : `${renewDays} วัน`})
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setIsRenewModalOpen(false);
                setRenewContractTarget(null);
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleExecuteRenewal}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl transition-all shadow-md shadow-emerald-600/10 flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              ยืนยันการต่ออายุสัญญา
            </button>
          </div>
        </div>
      )}
    </Modal>

    {/* Termination Modal */}
    {isTerminateOpen && selectedContract && (
      <Modal
        isOpen={isTerminateOpen}
        onClose={() => {
          if (!isSuccessAnimating) {
            setIsTerminateOpen(false);
          }
        }}
        title="ยืนยันการเลิกเช่าคืนห้องพัก"
      >
        <div className="space-y-4 font-sans text-xs">
          {isSuccessAnimating ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className="py-12 px-6 bg-gradient-to-br from-emerald-500 to-teal-700 text-white rounded-3xl flex flex-col items-center justify-center text-center space-y-4 shadow-xl border border-emerald-400/30 overflow-hidden relative"
            >
              <div className="relative z-10 flex items-center justify-center">
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
                  className="w-20 h-20 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center shadow-inner border border-white/40"
                >
                  <CheckCircle2 className="w-12 h-12 text-white drop-shadow-md" />
                </motion.div>
              </div>
              <div className="space-y-2">
                <motion.h3
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.3 }}
                  className="font-extrabold text-2xl text-white tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                >
                  ทำเรื่องเลิกเช่าสำเร็จ!
                </motion.h3>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7, duration: 0.3 }}
                  className="text-sm text-emerald-100 max-w-sm leading-relaxed font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                >
                  ระบบทำการคืนห้องพักห้อง {getRoomNum(selectedContract.roomId)} และอัปเดตสถานะสัญญาเรียบร้อยแล้ว
                </motion.p>
              </div>
            </motion.div>
          ) : (
            <>
              <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-4 space-y-3">
                <h4 className="font-bold text-amber-800 text-xs flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  รายละเอียดผู้เช่าและการเข้าพัก
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-800">
                  <div>
                    <p className="text-gray-400 text-[10px] font-bold">ชื่อผู้เช่า:</p>
                    <p className="font-extrabold text-xs mt-0.5">{getTenantName(selectedContract.tenantId)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] font-bold">เบอร์โทรศัพท์ติดต่อ:</p>
                    <p className="font-extrabold text-xs mt-0.5">
                      {tenants.find(t => t.id === selectedContract.tenantId)?.phone || 'ไม่ระบุ'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาของสัญญา / วันที่เข้าพัก:</p>
                    <p className="font-extrabold text-xs mt-0.5">
                      {formatThaiDate(selectedContract.startDate)} ถึง {formatThaiDate(selectedContract.endDate)} (รวม {selectedContract.durationMonths} เดือน)
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาที่อยู่อาศัยมาแล้ว (จนถึงปัจจุบัน):</p>
                    <p className="font-extrabold text-xs text-indigo-700 mt-0.5">
                      {getStayDurationText(selectedContract.startDate)}
                    </p>
                  </div>
                </div>
              </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1.5">
                  <div
                    onClick={() => setRefundDeposit(!refundDeposit)}
                    className="p-3 bg-slate-50 border border-gray-200 hover:border-gray-300 rounded-2xl space-y-2 cursor-pointer transition-all select-none"
                  >
                    <label className="block text-[11px] font-bold text-slate-700 cursor-pointer">การจัดการเงินมัดจำค่าประกัน</label>
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="checkbox"
                        checked={refundDeposit}
                        onChange={() => {}} // Controlled by container click
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 pointer-events-none"
                      />
                      <span className="text-xs text-slate-700 font-semibold">คืนเงินมัดจำแก่ผู้เช่า</span>
                    </div>
                    <p className="text-[10px] text-gray-400 leading-normal pointer-events-none">
                      ยอดเงินประกันดั้งเดิม: <span className="font-bold text-slate-700">
                        {(() => {
                          const rm = rooms.find(r => r.id === selectedContract.roomId);
                          return rm ? formatBaht(rm.depositAmount) : formatBaht(selectedContract.depositAmount);
                        })()}
                      </span>
                    </p>
                  </div>

                  <div className="p-3 bg-slate-50 border border-gray-200 rounded-2xl space-y-2">
                    <label className="block text-[11px] font-bold text-slate-700" htmlFor="damageFeeInput">หักค่าปรับ / ค่าเสียหายอื่น ๆ (บาท)</label>
                    <input
                      id="damageFeeInput"
                      type="number"
                      min="0"
                      value={damageFee}
                      onChange={(e) => setDamageFee(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
                      placeholder="เช่น 500"
                    />
                    <p className="text-[10px] text-gray-400 leading-normal">หากมีของเสียหาย หรือค่าน้ำค่าไฟตกค้าง สามารถกรอกเพื่อบันทึกประวัติได้</p>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-700" htmlFor="addNoteInput">หมายเหตุบันทึกเพิ่มเติม (ถ้ามี)</label>
                  <textarea
                    id="addNoteInput"
                    value={additionalNote}
                    onChange={(e) => setAdditionalNote(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 h-16 resize-none"
                    placeholder="ระบุรายละเอียดการย้ายออก หรืออื่นๆ..."
                  />
                </div>

                <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsTerminateOpen(false)}
                  className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTerminate}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl cursor-pointer shadow-sm transition-all"
                >
                  ยืนยันการเลิกเช่าคืนห้องพัก
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>
    )}

    {/* Modal: Pending Approvals List */}
    {isPendingListOpen && (
      <Modal
        isOpen={isPendingListOpen}
        onClose={() => setIsPendingListOpen(false)}
        title="สัญญาเช่าที่รออนุมัติ"
        size="lg"
      >
        <div className="space-y-4 font-sans text-xs">

          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {pendingSubmissions.filter((s) => s.status === 'pending').length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                <p className="font-extrabold text-slate-700 text-xs">ไม่มีสัญญาเช่าที่รออนุมัติในขณะนี้</p>
                <p className="text-[11px] text-slate-400 font-medium mt-0.5">อนุมัติแล้ว/ดำเนินการเรียบร้อยแล้ว</p>
              </div>
            ) : (
              pendingSubmissions
                .filter((sub) => sub.status === 'pending')
                .map((sub) => (
                  <div
                    key={sub.id}
                    className="p-4 rounded-2xl border transition-all flex flex-col gap-3 bg-white border-amber-200 shadow-2xs hover:border-amber-400"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="space-y-1 min-w-0 flex-1">
                        <span className="font-black text-slate-800 text-sm block">คุณ{sub.tenantName}</span>
                        <p className="text-gray-500 text-[11px] flex flex-wrap items-center gap-x-2 gap-y-0.5 leading-relaxed">
                          <span className="whitespace-nowrap">เบอร์โทร: <strong className="text-slate-700 font-bold">{sub.phone}</strong></span>
                          <span className="text-slate-300 hidden sm:inline">&bull;</span>
                          <span className="whitespace-nowrap">บัตรประชาชน: <strong className="text-slate-700 font-bold">{sub.citizenId}</strong></span>
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="px-3 py-1 bg-amber-100 text-amber-800 border border-amber-300/80 rounded-xl text-xs font-extrabold whitespace-nowrap shadow-2xs inline-block">
                          รออนุมัติ
                        </span>
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-100">
                      <div>
                        <span className="font-black text-indigo-600 text-sm block">ห้อง {sub.requestedRoomNumber}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-700 font-extrabold block">{formatBaht(sub.rentAmount)} / เดือน</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50/80 p-3 rounded-xl text-[11px] border border-slate-100">
                      <div className="min-w-0 sm:col-span-1">
                        <span className="text-gray-400 block font-bold text-[10px]">วันเริ่ม - สิ้นสุด:</span>
                        <span className="font-extrabold text-slate-800 block text-[11px] leading-tight">
                          {formatThaiDate(sub.startDate)} - {formatThaiDate(sub.endDate || calculateEndDate(sub.startDate, sub.durationMonths))}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-gray-400 block font-bold text-[10px]">ระยะเวลา:</span>
                        <span className="font-extrabold text-slate-800 block">{sub.durationMonths} เดือน</span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-gray-400 block font-bold text-[10px]">เงินมัดจำ:</span>
                        <span className="font-extrabold text-emerald-700 block">
                          {formatBaht(sub.depositAmount)}{' '}
                          <span className={`text-[9.5px] px-1.5 py-0.2 rounded font-black ml-1 inline-block ${sub.depositStatus === 'unpaid' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                            {sub.depositStatus === 'unpaid' ? 'ยังไม่จ่าย' : 'จ่ายแล้ว'}
                          </span>
                        </span>
                        <span className="text-[10px] text-gray-500 block font-medium mt-0.5">
                          ({sub.depositType === 'deduct_rent' ? 'ไปหักกับค่าเช่า' : 'คืนหลังเลิกเช่า'})
                        </span>
                      </div>
                    </div>

                    {sub.rejectionReason && (
                      <div className="p-2.5 bg-rose-100/60 text-rose-900 rounded-xl text-[11px] font-medium border border-rose-200/50">
                        <strong className="font-bold">เหตุผลที่ปฏิเสธ:</strong> {sub.rejectionReason}
                      </div>
                    )}

                    {sub.editNoticeToTenant && (
                      <div className="p-2.5 bg-indigo-100/60 text-indigo-900 rounded-xl text-[11px] font-medium border border-indigo-200/50">
                        <strong className="font-bold">แจ้งเตือนการแก้ไขถึงผู้เช่า:</strong> {sub.editNoticeToTenant}
                      </div>
                    )}

                <div className="pt-2 border-t border-slate-100 flex justify-end gap-2 items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPending(sub);
                      setIsPendingListOpen(false);
                    }}
                    className="relative px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-sm shadow-indigo-500/20 overflow-visible"
                  >
                    {/* Red Notification Dot on Top Right */}
                    <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 z-10">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 ring-1 ring-white shadow-2xs"></span>
                    </span>
                    <span>ตรวจสอบข้อมูลและจัดการ</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
          </div>
        </div>
      </Modal>
    )}

    {/* Modal: Detailed Pending Approval Review */}
    {selectedPending && (
      <Modal
        isOpen={!!selectedPending}
        onClose={() => setSelectedPending(null)}
        title={`คุณ${selectedPending.tenantName} (ห้อง ${selectedPending.requestedRoomNumber})`}
        size="lg"
        footer={
          <div className="flex justify-between items-center gap-2 w-full">
            <button
              type="button"
              onClick={() => {
                setSelectedPending(null);
                setIsPendingListOpen(true);
              }}
              className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> 
            </button>

            {selectedPending.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(true)}
                  className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                >
                  <XCircle className="w-4 h-4" />
                  ปฏิเสธ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const isEdited = pendingRent !== selectedPending.rentAmount ||
                      pendingDeposit !== selectedPending.depositAmount ||
                      pendingStartDate !== selectedPending.startDate ||
                      pendingEndDate !== (selectedPending.endDate || calculateEndDate(selectedPending.startDate, selectedPending.durationMonths)) ||
                      pendingDuration !== selectedPending.durationMonths ||
                      pendingDepositStatus !== (selectedPending.depositStatus || 'paid') ||
                      pendingDepositType !== (selectedPending.depositType || 'refundable') ||
                      pendingTerms !== selectedPending.terms;

                    if (isEdited) {
                      setIsEditNoticeModalOpen(true);
                    } else {
                      handleApprovePendingSubmission();
                    }
                  }}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  ยอมรับ
                </button>
              </div>
            )}
          </div>
        }
      >
        <div className="space-y-4 font-sans text-xs">
          {/* Status Header */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-2xl">
            <div>
              <span className="text-gray-400 text-[10px] block font-bold">สถานะ</span>
              <div className="flex items-center gap-2 mt-0.5">
                {selectedPending.status === 'pending' && (
                  <span className="px-2.5 py-1 bg-amber-100 text-amber-800 font-extrabold rounded-lg text-xs flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> รออนุมัติ
                  </span>
                )}
                {selectedPending.status === 'approved' && (
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold rounded-lg text-xs flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> ยอมรับและอนุมัติสัญญาเช่าแล้ว
                  </span>
                )}
                {selectedPending.status === 'rejected' && (
                  <span className="px-2.5 py-1 bg-rose-100 text-rose-800 font-extrabold rounded-lg text-xs flex items-center gap-1">
                    <XCircle className="w-3.5 h-3.5" /> ปฏิเสธสัญญาเช่าฉบับนี้
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-gray-400 block font-bold">ส่งเมื่อวันที่</span>
              <span className="font-bold text-slate-700">{formatThaiDate(selectedPending.submittedAt)}</span>
            </div>
          </div>

          {/* Tenant Info Section */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3 shadow-2xs">
            <h4 className="font-black text-slate-900 text-xs flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <User className="w-4 h-4 text-indigo-600" />
              ข้อมูลประวัติผู้เช่าที่กรอกเข้ามา
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-gray-400 text-[10px] font-bold block">ชื่อ-นามสกุล:</span>
                <span className="font-black text-slate-800 text-xs">{selectedPending.tenantName}</span>
              </div>
              <div>
                <span className="text-gray-400 text-[10px] font-bold block">เลขประจำตัวประชาชน:</span>
                <span className="font-bold text-slate-800 text-xs">{selectedPending.citizenId}</span>
              </div>
              <div>
                <span className="text-gray-400 text-[10px] font-bold block">เบอร์โทรศัพท์มือถือ:</span>
                <span className="font-bold text-slate-800 text-xs">{selectedPending.phone}</span>
              </div>
              <div>
                <span className="text-gray-400 text-[10px] font-bold block">อีเมล:</span>
                <span className="font-bold text-slate-800 text-xs">{selectedPending.email}</span>
              </div>
              <div className="sm:col-span-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="text-gray-400 text-[10px] font-bold block">บุคคลติดต่อกรณีฉุกเฉิน:</span>
                <span className="font-bold text-slate-800 text-xs">
                  {selectedPending.emergencyContactName} (เบอร์โทร: {selectedPending.emergencyContactPhone})
                </span>
              </div>
            </div>
          </div>

          {/* Room & Rent Details with Edit capability by Owner */}
          <div className="p-4 bg-indigo-50/40 border border-indigo-200 rounded-2xl space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-indigo-100">
              <h4 className="font-black text-indigo-950 text-xs flex items-center gap-1.5">
                <Edit3 className="w-4 h-4 text-indigo-600" />
                เงื่อนไขสัญญาเช่า
              </h4>
              <span className="text-[10px] text-indigo-600 font-bold bg-white px-2 py-0.5 rounded-lg border border-indigo-200">
                ห้อง {selectedPending.requestedRoomNumber}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <ThaiDatePicker
                  label="วันเริ่มต้นสัญญาเช่า"
                  value={pendingStartDate}
                  onChange={(val) => {
                    setPendingStartDate(val);
                    setPendingEndDate(calculateEndDate(val, pendingDuration));
                  }}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">ระยะเวลาสัญญา (เดือน)</label>
                <input
                  type="number"
                  min="1"
                  max="36"
                  value={pendingDuration}
                  onChange={(e) => {
                    const dur = Number(e.target.value);
                    setPendingDuration(dur);
                    setPendingEndDate(calculateEndDate(pendingStartDate, dur));
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-600"
                />
              </div>
              <div>
                <ThaiDatePicker
                  label="วันสิ้นสุดสัญญาเช่า"
                  value={pendingEndDate}
                  onChange={(val) => setPendingEndDate(val)}
                  required
                />
              </div>
              <div>
                <CurrencyInput
                  label="อัตราค่าเช่ารายเดือน (บาท) "
                  value={pendingRent}
                  onChange={(val) => setPendingRent(val)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <CurrencyInput
                  label="เงินมัดจำ / ประกัน (บาท)"
                  value={pendingDeposit}
                  onChange={(val) => setPendingDeposit(val)}
                  required
                />
              </div>

              {/* Deposit Payment Status & Refund Type Controls */}
              <div className="sm:col-span-2 space-y-2.5 p-3.5 bg-white border border-slate-200/90 rounded-2xl shadow-2xs">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
                    ค่ามัดจำ / ประกัน
                  </span>
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100">
                    ปรับสถานะได้เอง
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {/* Payment Status */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold text-slate-700">
                      สถานะชำระค่ามัดจำ *
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPendingDepositStatus('paid')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          pendingDepositStatus === 'paid'
                            ? 'bg-emerald-600 border-emerald-600 text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>จ่ายแล้ว</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDepositStatus('unpaid')}
                        className={`py-2 px-2.5 rounded-xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          pendingDepositStatus === 'unpaid'
                            ? 'bg-rose-600 border-rose-600 text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>ยังไม่จ่าย</span>
                      </button>
                    </div>
                  </div>

                  {/* Deposit Type */}
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-extrabold text-slate-700">
                      รูปแบบเงินมัดจำ / ประกัน *
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPendingDepositType('refundable')}
                        className={`py-2 px-2 rounded-xl border text-[11px] font-extrabold flex items-center justify-center text-center transition-all cursor-pointer ${
                          pendingDepositType === 'refundable'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span>คืนหลังเลิกเช่า</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDepositType('deduct_rent')}
                        className={`py-2 px-2 rounded-xl border text-[11px] font-extrabold flex items-center justify-center text-center transition-all cursor-pointer ${
                          pendingDepositType === 'deduct_rent'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span>ไปหักกับค่าเช่า</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Taller Agreement Terms Textarea */}
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-xs font-bold text-slate-800">
                  ข้อตกลงและเงื่อนไขเพิ่มเติมในสัญญา
                </label>
                <textarea
                  value={pendingTerms}
                  onChange={(e) => setPendingTerms(e.target.value)}
                  rows={6}
                  className="w-full p-3 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-800 min-h-[140px] sm:min-h-[160px] leading-relaxed resize-y focus:outline-none focus:border-indigo-600"
                  placeholder="ระบุข้อตกลงและระเบียบสัญญาเช่าเพิ่มเติม..."
                />
              </div>
            </div>

            {/* Is Edited Indicator Notice */}
            {(pendingRent !== selectedPending.rentAmount ||
              pendingDeposit !== selectedPending.depositAmount ||
              pendingStartDate !== selectedPending.startDate ||
              pendingEndDate !== (selectedPending.endDate || calculateEndDate(selectedPending.startDate, selectedPending.durationMonths)) ||
              pendingDuration !== selectedPending.durationMonths ||
              pendingDepositStatus !== (selectedPending.depositStatus || 'paid') ||
              pendingDepositType !== (selectedPending.depositType || 'refundable') ||
              pendingTerms !== selectedPending.terms) && (
              <div className="p-3 bg-amber-100/80 text-amber-950 border border-amber-300 rounded-xl text-[11px] font-bold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>มีการแก้ไขข้อมูลสัญญาจากเดิม เมื่อกดยอมรับ ระบบจะให้คุณระบุข้อความแจ้งเตือนการแก้ไขไปยังผู้เช่า</span>
              </div>
            )}
          </div>

          {/* Signature & Digital Consent View */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl space-y-3">
            <h4 className="font-black text-slate-900 text-xs flex items-center gap-1.5 pb-2 border-b border-slate-100">
              <FileCheck className="w-4 h-4 text-slate-700" />
              คุณ{selectedPending.tenantName}
            </h4>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs text-center w-full">
                <span className="text-[10px] text-gray-400 block font-bold mb-2">ลายเซนต์ดิจิทัลผู้เช่า</span>
                {selectedPending.tenantSignature ? (
                  <img
                    src={selectedPending.tenantSignature}
                    alt="ลายเซนต์ผู้เช่า"
                    className="h-24 w-full object-contain mx-auto"
                  />
                ) : (
                  <div className="py-6 text-slate-400 text-xs font-semibold italic">ไม่มีรูปภาพลายเซ็น</div>
                )}
              </div>
            </div>
          </div>

          {/* Reason/Notice info if non-pending */}
          {selectedPending.rejectionReason && (
            <div className="p-3 bg-rose-100 text-rose-900 rounded-xl border border-rose-200 font-bold text-xs">
              ❌ เหตุผลที่ปฏิเสธสัญญา: {selectedPending.rejectionReason}
            </div>
          )}
          {selectedPending.editNoticeToTenant && (
            <div className="p-3 bg-indigo-100 text-indigo-900 rounded-xl border border-indigo-200 font-bold text-xs">
              💬 ข้อความแจ้งเตือนผู้เช่ากรณีแก้ไขสัญญา: {selectedPending.editNoticeToTenant}
            </div>
          )}
        </div>
      </Modal>
    )}

    {/* Modal: Rejection Reason Dialog */}
    {isRejectModalOpen && selectedPending && (
      <Modal
        isOpen={isRejectModalOpen}
        onClose={() => setIsRejectModalOpen(false)}
        title={`คุณ${selectedPending.tenantName}`}
      >
        <div className="space-y-4 font-sans text-xs">
          <p className="text-slate-600 font-medium">
            กรุณาระบุเหตุผล เพื่อให้ผู้เช่ารับทราบและแก้ไขข้อมูลหรือนำส่งเอกสารเข้ามาใหม่:
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="เช่น เอกสารบัตรประชาชนไม่ชัดเจน หรือ ข้อมูลผู้ติดต่อฉุกเฉินไม่ครบถ้วน..."
            className="w-full px-3 py-2.5 border border-slate-200 rounded-2xl bg-slate-50 text-slate-800 text-xs font-medium h-28 focus:bg-white focus:outline-none focus:border-rose-500 resize-none"
          />
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsRejectModalOpen(false)}
              className="px-4 py-2 border border-slate-200 bg-white text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleRejectPendingSubmission}
              disabled={!rejectReason.trim()}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <XCircle className="w-4 h-4" /> ยืนยันปฏิเสธสัญญา
            </button>
          </div>
        </div>
      </Modal>
    )}

    {/* Modal: Edit Notice to Tenant Dialog */}
    {isEditNoticeModalOpen && selectedPending && (
      <Modal
        isOpen={isEditNoticeModalOpen}
        onClose={() => setIsEditNoticeModalOpen(false)}
        title="ข้อความแจ้งผู้เช่ากรณีมีการแก้ไขรายละเอียดสัญญา"
      >
        <div className="space-y-4 font-sans text-xs">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 font-medium leading-relaxed">
            ระบบตรวจพบว่าคุณมีการปรับเปลี่ยนข้อมูลสัญญา (ค่าเช่า/มัดจำ/ระยะเวลา/วันเริ่มสัญญา/เงื่อนไข) โปรดระบุข้อความแจ้งเตือนถึงคุณ{selectedPending.tenantName}:
          </div>
          <textarea
            value={editNotice}
            onChange={(e) => setEditNotice(e.target.value)}
            placeholder="เช่น เจ้าของหอพักได้ปรับเปลี่ยนวันเริ่มต้นสัญญาจากเดิมเป็นวันที่ 01/08/2026 ตามที่ได้ตกลงกันไว้..."
            className="w-full px-3 py-2.5 border border-slate-200 rounded-2xl bg-slate-50 text-slate-800 text-xs font-medium h-24 focus:bg-white focus:outline-none focus:border-emerald-500 resize-none"
          />
          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditNoticeModalOpen(false)}
              className="px-4 py-2 border border-slate-200 bg-white text-slate-700 font-semibold rounded-xl text-xs hover:bg-slate-50 transition-all cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => handleApprovePendingSubmission(editNotice.trim())}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold rounded-xl text-xs transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" /> ยืนยันยอมรับและส่งแจ้งเตือน
            </button>
          </div>
        </div>
      </Modal>
    )}

    {/* Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
    {pendingToast && (
      <div 
        className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-50 bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
          isToastFading 
            ? 'opacity-0 translate-y-3 pointer-events-none' 
            : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
        }`}
      >
        <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
        <span>{pendingToast}</span>
      </div>
    )}
    </div>
  );
};
