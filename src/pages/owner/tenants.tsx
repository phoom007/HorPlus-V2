/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  Search,
  User,
  Plus,
  Phone,
  Mail,
  Users,
  Car,
  Heart,
  FileText,
  Clock,
  ArrowLeft,
  X,
  AlertCircle,
  Download,
  Printer,
  Dog,
  Check,
  Copy,
  QrCode,
  CheckCircle2,
  XCircle,
  UserCheck,
  UserX,
  Edit2,
  Edit3,
  RotateCcw,
  RotateCw,
  Trash2,
  Calendar,
  CreditCard,
  PenTool,
  ShieldCheck,
  Eye,
  FileCheck,
  FileSpreadsheet,
  UserPlus,
  UserMinus,
  History,
  Upload,
  LogOut,
  ShieldAlert,
  AlertTriangle,
  Receipt,
  Coins
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineLogo as LineIcon } from '../../components/LineLogo';
import { QuickAddTenantModal, QuickAddSuccessResult } from '../../components/QuickAddTenantModal';
import { httpRequest } from '../../data/httpClient';
import { approveTenantRegistrationRequest, rejectTenantRegistrationRequest } from '../../data/adapters/api';
import {
  StatusBadge,
  Modal,
  Stepper,
  formatBaht,
  formatThaiDate,
  ThaiDatePicker,
  CurrencyInput,
  PrintView,
  SignaturePad
} from '../../components/GlobalComponents';
import { Tenant, Room, CoOccupant, CoOccupantHistoryItem, EmergencyContact, Contract, Bill, BillItem, BLOCKING_CONTRACT_STATUSES, PetItem, VehicleItem, TenantReturnContext, Dormitory, QuickAddRoomContext } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
import { convertImageToWebP, UPLOAD_DROPZONE_TEXT } from '../../utils/imageUtils';

export const getTrulyVacantRooms = (
  rooms: Room[] = [],
  contracts: Contract[] = [],
  tenants: Tenant[] = [],
  occupancies?: Array<{ roomId: string; status?: string }>
): Room[] => {
  return rooms.filter(room => {
    // 1. Room level check:
    // - Room status must be 'vacant'
    // - Must not have currentTenantId
    if (room.status !== 'vacant') return false;
    if (room.currentTenantId) return false;

    // 2. Active Occupancy check:
    // - No tenant currently active in this room
    const hasActiveTenant = tenants.some(
      t => (t.roomId === room.id || (t as any).currentRoomId === room.id) && t.status === 'active'
    );
    if (hasActiveTenant) return false;

    if (occupancies && occupancies.length > 0) {
      const hasActiveOccupancy = occupancies.some(
        o => o.roomId === room.id && (!o.status || o.status === 'ACTIVE' || o.status === 'active')
      );
      if (hasActiveOccupancy) return false;
    }

    // 3. Reservation / Booking / Blocking contract check:
    // - No active or scheduled or reserved contracts for this room
    const blockingStatuses = [
      ...BLOCKING_CONTRACT_STATUSES,
      'active', 'ACTIVE',
      'scheduled', 'SCHEDULED',
      'approved_scheduled', 'APPROVED_SCHEDULED',
      'pending_signature', 'PENDING_SIGNATURE',
      'waiting_extension', 'WAITING_EXTENSION',
      'checking_out', 'CHECKING_OUT',
      'reserved', 'RESERVED',
      'draft', 'DRAFT'
    ];
    const hasBlockingContract = contracts.some(c => {
      if (c.roomId !== room.id) return false;
      return blockingStatuses.includes(c.status);
    });
    if (hasBlockingContract) return false;

    return true;
  });
};

export const getRentalTypeLabel = (tenant: Tenant, contracts: Contract[] = []): string | null => {
  const rawType = tenant.rentalType || contracts.find(c => c.tenantId === tenant.id)?.rentalType;
  if (!rawType) return null;
  const upper = String(rawType).toUpperCase();
  if (upper === 'MONTHLY') return 'รายเดือน';
  if (upper === 'TERM') return 'รายเทอม';
  if (upper === 'DAILY') return 'รายวัน';
  return null;
};

export const isTenantLineBound = (tenant: Tenant): boolean => {
  return !!(tenant.lineFriendId || (tenant as any).lineUserId || (tenant as any).isLineRegistered);
};

interface OwnerTenantsProps {
  tenants: Tenant[];
  rooms: Room[];
  bills?: Bill[];
  contracts?: Contract[];
  selectedCycle?: string;
  onSaveTenants: (tenants: Tenant[]) => void;
  onSaveRooms: (rooms: Room[]) => void;
  onSaveContracts?: (contracts: Contract[]) => void;
  onSaveBills?: (bills: Bill[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  initialTenantId?: string;
  onClearInitialTenantId?: () => void;
  onBackToMeters?: () => void;
  onBackToRooms?: (roomId?: string) => void;
  tenantOriginTab?: 'rooms' | 'meters' | string;
  onViewContract?: (contractId: string, tenantId?: string) => void;
  returnContext?: TenantReturnContext | null;
  onReturnToSource?: (context: TenantReturnContext) => void;
  onDismissReturnContext?: () => void;
  cameFromMeters?: boolean;
  dormitory?: Dormitory | null;
}

const CAR_BRANDS = ["Toyota", "Honda", "Isuzu", "Mazda", "Nissan", "Mitsubishi", "Ford", "Benz", "BMW", "Audi", "MG", "BYD", "Suzuki", "อื่นๆ"];
const MOTO_BRANDS = ["Honda", "Yamaha", "Vespa", "Suzuki", "GPX", "Kawasaki", "Ducati", "อื่นๆ"];
const STANDARD_PET_OPTIONS = ["สุนัข", "แมว", "นก", "ปลา", "กระต่าย", "หนูแฮมสเตอร์"];
const PET_OPTIONS = ["สุนัข", "แมว", "นก", "ปลา", "กระต่าย", "หนูแฮมสเตอร์", "อื่นๆ"];
const CO_OCCUPANT_RELATION_OPTIONS = ["แฟน", "เพื่อน", "ผู้ปกครอง", "พี่น้อง / ญาติ", "คู่สมรส", "อื่นๆ"];

export const OwnerTenants: React.FC<OwnerTenantsProps> = ({
  tenants,
  rooms,
  bills = [],
  contracts = [],
  selectedCycle,
  onSaveTenants,
  onSaveRooms,
  onSaveContracts,
  onSaveBills,
  onAddLog,
  initialTenantId,
  onClearInitialTenantId,
  onBackToMeters,
  onBackToRooms,
  tenantOriginTab,
  onViewContract,
  returnContext,
  onReturnToSource,
  onDismissReturnContext,
  cameFromMeters: cameFromMetersProp,
  dormitory
}) => {
  const [dorm, setDorm] = useState<Partial<Dormitory>>(() => {
    if (dormitory) return dormitory;
    try {
      const saved = localStorage.getItem('registered_dorm_profile');
      if (saved) return JSON.parse(saved);
    } catch { }
    return {};
  });

  React.useEffect(() => {
    let isMounted = true;
    if (dormitory) {
      setDorm(dormitory);
      return;
    }
    const loadDorm = async () => {
      try {
        const dormId = localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session') || '';
        if (dormId) {
          const fetched = await getDataProvider().dormitories.getById(dormId);
          if (isMounted && fetched) {
            setDorm(prev => ({ ...prev, ...fetched }));
          }
        }
      } catch (err) {
        // Authority-safe fallback to registered_dorm_profile or existing state
      }
    };
    loadDorm();
    return () => { isMounted = false; };
  }, [dormitory]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<'pending' | 'active' | 'inactive'>('active');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [cameFromMeters, setCameFromMeters] = useState(Boolean(cameFromMetersProp));
  const [originTab, setOriginTab] = useState<'rooms' | 'meters' | string | null>(tenantOriginTab || returnContext?.source || (cameFromMetersProp ? 'meters' : null));

  React.useEffect(() => {
    if (returnContext?.source) {
      setOriginTab(returnContext.source);
    } else if (cameFromMetersProp) {
      setOriginTab('meters');
      setCameFromMeters(true);
    } else if (tenantOriginTab) {
      setOriginTab(tenantOriginTab);
    } else {
      setOriginTab(null);
    }
  }, [tenantOriginTab, returnContext, cameFromMetersProp]);

  // Auto select tenant on mount if initialTenantId or returnContext.tenantId provided
  React.useEffect(() => {
    const targetId = initialTenantId || returnContext?.tenantId;
    if (targetId) {
      const tenant = tenants.find(t => t.id === targetId);
      if (tenant) {
        setSelectedTenant(tenant);
        setProfileTab('info');
        if (tenant.status === 'pending') {
          setActiveStatusTab('pending');
        } else if (tenant.status === 'inactive') {
          setActiveStatusTab('inactive');
        } else {
          setActiveStatusTab('active');
        }
      }
      if (initialTenantId && onClearInitialTenantId) {
        onClearInitialTenantId();
      }
    }
  }, [initialTenantId, returnContext, tenants, onClearInitialTenantId]);

  const [profileTab, setProfileTab] = useState<'info' | 'contract' | 'history'>('info');
  const [isIdCardOpen, setIsIdCardOpen] = useState(false);
  const idCardInputRef = useRef<HTMLInputElement>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [idCardPhoto, setIdCardPhoto] = useState('');
  const [docTab, setDocTab] = useState<'uploaded' | 'simulated'>('uploaded');

  // Contract tab modals and interaction states
  const [selectedContractForPrint, setSelectedContractForPrint] = useState<Contract | null>(null);
  const [isPrintContractModalOpen, setIsPrintContractModalOpen] = useState(false);

  const [selectedContractForEdit, setSelectedContractForEdit] = useState<Contract | null>(null);
  const [isEditContractModalOpen, setIsEditContractModalOpen] = useState(false);
  const [editContractStartDate, setEditContractStartDate] = useState('');
  const [editContractEndDate, setEditContractEndDate] = useState('');
  const [editContractDuration, setEditContractDuration] = useState(6);
  const [editContractRent, setEditContractRent] = useState(0);
  const [editContractDeposit, setEditContractDeposit] = useState(0);
  const [editContractDepositStatus, setEditContractDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [editContractDepositType, setEditContractDepositType] = useState<'refundable' | 'deduct_rent'>('refundable');
  const [editContractAdvancePayment, setEditContractAdvancePayment] = useState(0);
  const [editContractTerms, setEditContractTerms] = useState('');

  // Renew contract states
  const [selectedContractForRenew, setSelectedContractForRenew] = useState<Contract | null>(null);
  const [isRenewContractModalOpen, setIsRenewContractModalOpen] = useState(false);
  const [renewContractUnit, setRenewContractUnit] = useState<'month' | 'day'>('month');
  const [renewContractMonths, setRenewContractMonths] = useState(6);
  const [renewContractDays, setRenewContractDays] = useState(0);
  const [renewContractStartDate, setRenewContractStartDate] = useState('');
  const [renewContractEndDate, setRenewContractEndDate] = useState('');
  const [renewContractRentAmount, setRenewContractRentAmount] = useState(0);
  const [renewContractDepositAmount, setRenewContractDepositAmount] = useState(0);
  const [renewContractDepositOption, setRenewContractDepositOption] = useState<'rollover' | 'custom'>('rollover');
  const [renewContractNote, setRenewContractNote] = useState('');

  // Pending Review Sub Tab: 'all' | 'expired' | 'new_tenant'
  const [pendingSubTab, setPendingSubTab] = useState<'all' | 'expired' | 'new_tenant'>('all');
  const [selectedContractForReview, setSelectedContractForReview] = useState<Contract | null>(null);

  // Create new contract states
  const [isCreateContractModalOpen, setIsCreateContractModalOpen] = useState(false);
  const [createContractRoomId, setCreateContractRoomId] = useState('');
  const [createContractStartDate, setCreateContractStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [createContractStayDate, setCreateContractStayDate] = useState(new Date().toISOString().split('T')[0]);
  const [createContractEndDate, setCreateContractEndDate] = useState('');
  const [createContractDuration, setCreateContractDuration] = useState(6);
  const [createContractRent, setCreateContractRent] = useState(4000);
  const [createContractDeposit, setCreateContractDeposit] = useState(8000);
  const [createContractDepositStatus, setCreateContractDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [createContractDepositType, setCreateContractDepositType] = useState<'refundable' | 'deduct_rent'>('refundable');
  const [createContractAdvancePayment, setCreateContractAdvancePayment] = useState(0);
  const [createContractTerms, setCreateContractTerms] = useState(
    `1. ผู้เช่าต้องชำระค่าเช่าห้องพักภายในวันที่ 5 ของทุกเดือน หากล่าช้ามีค่าปรับวันละ 100 บาท\n2. เงินประกันความเสียหายจะคืนให้เมื่อสิ้นสุดสัญญาเช่าและหักลบค่าเสียหาย/ค่าน้ำ-ไฟแล้ว\n3. ห้ามส่งเสียงดังรบกวนผู้พักอาศัยห้องอื่นหลังเวลา 22:00 น.\n4. ห้ามเลี้ยงสัตว์เลี้ยงชนิดที่ส่งเสียงดังหรือทำสิ่งผิดกฎหมายในอาคารหอพัก`
  );
  const [createContractTenantSig, setCreateContractTenantSig] = useState<string | undefined>(
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><path d="M10,20 Q30,10 50,25 T90,15" stroke="black" stroke-width="2" fill="none"/></svg>'
  );
  const [contractToast, setContractToast] = useState<string | null>(null);

  // Lease termination states
  const [isTerminateOpen, setIsTerminateOpen] = useState(false);
  const [isSuccessAnimating, setIsSuccessAnimating] = useState(false);
  const [terminateReason, setTerminateReason] = useState<'early' | 'normal' | 'prepare_vacant'>('normal');
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [damageFee, setDamageFee] = useState<string>('0');
  const [additionalNote, setAdditionalNote] = useState<string>('');
  const [deductionItems, setDeductionItems] = useState<Array<{ id: string; title: string; amount: number | string }>>([]);
  const [refundMethod, setRefundMethod] = useState<'promptpay' | 'bank_transfer' | 'cash'>('promptpay');
  const [refundAccountInfo, setRefundAccountInfo] = useState<string>('');

  // Pending tenant approve / reject states
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [approveRoomId, setApproveRoomId] = useState('');
  const [approveStartDate, setApproveStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [approveDeposit, setApproveDeposit] = useState<string>('');
  const [approveRent, setApproveRent] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');

  // Multi-step form state for adding new tenant
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copySuccessToast, setCopySuccessToast] = useState<string | null>(null);

  // Quick Add Tenant Modal states (TERM / MONTHLY / DAILY)
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [selectedQuickAddContext, setSelectedQuickAddContext] = useState<QuickAddRoomContext | null>(null);
  const [quickAddLoading, setQuickAddLoading] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [coOccupants, setCoOccupants] = useState<CoOccupant[]>([]);
  const [coName, setCoName] = useState('');
  const [coPhone, setCoPhone] = useState('');
  const [coRelationship, setCoRelationship] = useState('แฟน');
  const [coCustomRelationship, setCoCustomRelationship] = useState('');

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [vehicleType, setVehicleType] = useState<'car' | 'motorcycle' | 'none'>('none');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehiclesList, setVehiclesList] = useState<VehicleItem[]>([]);

  const [hasPet, setHasPet] = useState(false);
  const [petType, setPetType] = useState('');
  const [customPetType, setCustomPetType] = useState('');
  const [petName, setPetName] = useState('');
  const [petsList, setPetsList] = useState<PetItem[]>([]);

  const handleAddPet = () => {
    setPetsList(prev => [...prev, { id: Date.now().toString(), type: '', customType: '', name: '' }]);
  };

  const handleRemovePet = (index: number) => {
    setPetsList(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length > 0 ? updated : [{ id: Date.now().toString(), type: '', customType: '', name: '' }];
    });
  };

  const handlePetChange = (index: number, field: keyof PetItem, value: string) => {
    setPetsList(prev => prev.map((p, i) => {
      if (i !== index) return p;
      if (field === 'type') {
        return {
          ...p,
          type: value,
          customType: value === 'อื่นๆ' ? (p.customType || '') : ''
        };
      }
      return { ...p, [field]: value };
    }));
  };

  const handleAddVehicle = () => {
    setVehiclesList(prev => [...prev, { id: Date.now().toString(), type: 'motorcycle', licensePlate: '', brand: '' }]);
  };

  const handleRemoveVehicle = (index: number) => {
    setVehiclesList(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length > 0 ? updated : [{ id: Date.now().toString(), type: 'none', licensePlate: '', brand: '' }];
    });
  };

  const handleVehicleChange = (index: number, field: keyof VehicleItem, value: string) => {
    setVehiclesList(prev => prev.map((v, i) => {
      if (i === index) {
        if (field === 'type' && value === 'none') {
          return { ...v, type: 'none', licensePlate: '', brand: '' };
        }
        return { ...v, [field]: value };
      }
      return v;
    }));
  };

  const [selectedRoomId, setSelectedRoomId] = useState('');

  // States for direct add / remove co-occupant in History tab
  const [isAddCoModalOpen, setIsAddCoModalOpen] = useState(false);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [newCoRelationship, setNewCoRelationship] = useState('แฟน');
  const [newCoCustomRelationship, setNewCoCustomRelationship] = useState('');

  const [coToDelete, setCoToDelete] = useState<CoOccupant | null>(null);
  const [isDeleteCoModalOpen, setIsDeleteCoModalOpen] = useState(false);
  const [deleteCoReason, setDeleteCoReason] = useState('');

  const getEffectiveCoOccupantHistory = (tenant: Tenant): CoOccupantHistoryItem[] => {
    const historyList = tenant.coOccupantHistory || [];
    if (historyList.length > 0) {
      return [...historyList].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    // If no history records stored, generate initial records from current coOccupants
    const derived: CoOccupantHistoryItem[] = (tenant.coOccupants || []).map((co, idx) => ({
      id: `coh-derived-${co.id || idx}`,
      coOccupantId: co.id,
      name: co.name,
      phone: co.phone,
      citizenId: co.citizenId,
      action: 'added',
      timestamp: co.addedAt || tenant.createdAt,
      note: 'ลงทะเบียนเข้าพักพร้อมผู้เช่าหลัก'
    }));

    return derived.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const handleAddNewCoOccupant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTenant) return;
    if (!newCoName.trim() || !newCoPhone.trim()) return;

    const nowIso = new Date().toISOString();
    const finalRel = newCoRelationship === 'อื่นๆ' ? (newCoCustomRelationship.trim() || 'อื่นๆ') : newCoRelationship;

    const newCo: CoOccupant = {
      id: `co-${Date.now()}`,
      name: newCoName.trim(),
      phone: newCoPhone.trim(),
      relationship: finalRel,
      addedAt: nowIso
    };

    const newHistoryItem: CoOccupantHistoryItem = {
      id: `coh-${Date.now()}`,
      coOccupantId: newCo.id,
      name: newCo.name,
      phone: newCo.phone,
      relationship: finalRel,
      action: 'added',
      timestamp: nowIso,
      note: finalRel ? `สถานะ: ${finalRel}` : 'เพิ่มเข้าพักโดยผู้ดูแลหอพัก'
    };

    const currentHistory = selectedTenant.coOccupantHistory && selectedTenant.coOccupantHistory.length > 0
      ? selectedTenant.coOccupantHistory
      : getEffectiveCoOccupantHistory(selectedTenant);

    const updatedTenant: Tenant = {
      ...selectedTenant,
      coOccupants: [...(selectedTenant.coOccupants || []), newCo],
      coOccupantHistory: [newHistoryItem, ...currentHistory],
      updatedAt: nowIso
    };

    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? updatedTenant : t);
    onSaveTenants(updatedTenants);
    setSelectedTenant(updatedTenant);
    onAddLog('เพิ่มผู้พักร่วม', `เพิ่มคุณ ${newCo.name} (${formatPhone(newCo.phone)}) สถานะ: ${finalRel} เป็นผู้พักร่วมของคุณ ${selectedTenant.name}`, 'Tenant', selectedTenant.id);

    setNewCoName('');
    setNewCoPhone('');
    setNewCoRelationship('แฟน');
    setNewCoCustomRelationship('');
    setIsAddCoModalOpen(false);
  };

  const handleConfirmRemoveCoOccupant = () => {
    if (!selectedTenant || !coToDelete) return;
    const nowIso = new Date().toISOString();

    const removeHistoryItem: CoOccupantHistoryItem = {
      id: `coh-${Date.now()}`,
      coOccupantId: coToDelete.id,
      name: coToDelete.name,
      phone: coToDelete.phone,
      citizenId: coToDelete.citizenId,
      action: 'removed',
      timestamp: nowIso,
      note: deleteCoReason.trim() || 'แจ้งย้ายออกจากห้องพัก'
    };

    const currentHistory = selectedTenant.coOccupantHistory && selectedTenant.coOccupantHistory.length > 0
      ? selectedTenant.coOccupantHistory
      : getEffectiveCoOccupantHistory(selectedTenant);

    const updatedCoOccupants = (selectedTenant.coOccupants || []).filter(c => c.id !== coToDelete.id);
    const updatedTenant: Tenant = {
      ...selectedTenant,
      coOccupants: updatedCoOccupants,
      coOccupantHistory: [removeHistoryItem, ...currentHistory],
      updatedAt: nowIso
    };

    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? updatedTenant : t);
    onSaveTenants(updatedTenants);
    setSelectedTenant(updatedTenant);
    onAddLog('นำผู้พักร่วมออก', `นำคุณ ${coToDelete.name} ออกจากห้องพักของคุณ ${selectedTenant.name}`, 'Tenant', selectedTenant.id);

    setIsDeleteCoModalOpen(false);
    setCoToDelete(null);
    setDeleteCoReason('');
  };

  const buildRoomContext = async (targetRoom: Room): Promise<QuickAddRoomContext> => {
    const dormId = dormitory?.id || 'demo-dorm';
    try {
      const res = await httpRequest<{ data: QuickAddRoomContext }>(
        'GET',
        `/api/v1/properties/rooms/${targetRoom.id}/quick-add-context`,
        undefined,
        { headers: dormId ? { 'x-dormitory-id': dormId } : {} }
      );
      if (res.data && res.data.effective) {
        return res.data;
      }
    } catch {
      // Fallback below
    }

    return {
      roomId: targetRoom.id,
      dormitoryId: dormId,
      roomNumber: targetRoom.roomNumber,
      buildingId: targetRoom.buildingId || undefined,
      effective: {
        monthlyRent: targetRoom.monthlyRent || 0,
        monthlyDeposit: targetRoom.monthlyDeposit ?? targetRoom.depositAmount ?? 0,
        termRent: targetRoom.termRent ?? ((targetRoom.monthlyRent || 0) * 4),
        termDeposit: targetRoom.termDeposit ?? targetRoom.depositAmount ?? 0,
        termMonths: 4,
        dailyRate: targetRoom.dailyRent ?? 500,
        dailyDeposit: targetRoom.dailyDeposit ?? 500,
      },
      building: {
        id: targetRoom.buildingId || 'bld-1',
        name: 'อาคารหลัก',
        termMonths: 4,
        maxInstallments: 1,
      },
      roomType: 'ห้องมาตรฐาน',
      floor: targetRoom.floor,
    };
  };

  // Handle open Quick Add Tenant modal
  const handleOpenAddWizard = async () => {
    setErrorText(null);
    const vacantRooms = getTrulyVacantRooms(rooms, contracts || [], tenants);
    if (vacantRooms.length === 0) {
      alert('ไม่มีห้องว่างที่พร้อมให้เช่าในขณะนี้ (ทุกห้องมีผู้เช่าหรือมีสัญญาจองแล้ว)');
      return;
    }

    const firstVacant = vacantRooms[0];
    setQuickAddLoading(true);
    try {
      const ctx = await buildRoomContext(firstVacant);
      setSelectedQuickAddContext(ctx);
      setQuickAddModalOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleSelectQuickAddRoom = async (roomId: string) => {
    const targetRoom = rooms.find(r => r.id === roomId);
    if (!targetRoom) return;
    const ctx = await buildRoomContext(targetRoom);
    setSelectedQuickAddContext(ctx);
  };

  const handleQuickAddSuccess = (message: string, result?: QuickAddSuccessResult) => {
    const targetRoomId = result?.roomId || selectedQuickAddContext?.roomId;
    const targetRoom = rooms.find(r => r.id === targetRoomId);
    const newTenantId = result?.tenantId || `tenant-${Date.now()}`;
    const newTenantName = result?.fullName || 'ผู้เช่าใหม่';
    const newTenantPhone = result?.phone || '';
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];

    const newTenant: Tenant = {
      id: newTenantId,
      name: newTenantName,
      phone: newTenantPhone,
      email: '',
      citizenId: '',
      roomId: targetRoomId,
      status: 'active',
      lifecycleStage: 'OWNER_CREATED',
      rentalType: result?.rentalType,
      lineFriendId: null,
      joinDate: todayStr,
      depositPaid: true,
      coOccupants: [],
      vehicles: [],
      pets: [],
      emergencyContacts: [],
      rentalHistory: targetRoom ? [
        {
          roomId: targetRoom.id,
          roomNumber: targetRoom.roomNumber,
          startDate: todayStr,
          depositAmount: targetRoom.depositAmount || 0,
          monthlyRent: targetRoom.monthlyRent || 0,
        }
      ] : []
    };

    // Update room occupancy
    const updatedRooms = rooms.map(r => {
      if (r.id === targetRoomId) {
        return {
          ...r,
          status: 'occupied' as const,
          currentTenantId: newTenant.id,
        };
      }
      return r;
    });

    // Create contract record
    if (targetRoom) {
      const newContract: Contract = {
        id: `contract-${Date.now()}`,
        tenantId: newTenant.id,
        roomId: targetRoom.id,
        roomNumber: targetRoom.roomNumber,
        startDate: todayStr,
        status: 'active',
        rentAmount: targetRoom.monthlyRent || 0,
        depositAmount: targetRoom.depositAmount || 0,
        rentalType: result?.rentalType === 'DAILY' ? 'daily' : (result?.rentalType === 'TERM' ? 'term' : 'monthly'),
        createdAt: nowIso,
      };
      if (onSaveContracts && contracts) {
        onSaveContracts([newContract, ...contracts]);
      }
    }

    const updatedTenants = [newTenant, ...tenants];
    onSaveTenants(updatedTenants);
    onSaveRooms(updatedRooms);

    onAddLog(
      'เพิ่มผู้เช่าด่วน',
      `เพิ่มผู้เช่าคุณ ${newTenant.name} เข้าห้อง ${targetRoom?.roomNumber || ''} (${result?.rentalType || 'MONTHLY'})`,
      'Tenant',
      newTenant.id
    );

    setActiveStatusTab('active');
    setSelectedTenant(newTenant);
    setSelectedContractForReview(null);
    setQuickAddModalOpen(false);
    setSelectedQuickAddContext(null);
  };

  const handleAddCoOccupant = () => {
    if (coName.trim() && coPhone.trim()) {
      const finalRel = coRelationship === 'อื่นๆ' ? (coCustomRelationship.trim() || 'อื่นๆ') : coRelationship;
      const newCo: CoOccupant = {
        id: `co-${Date.now()}`,
        name: coName.trim(),
        phone: coPhone.trim(),
        relationship: finalRel,
        addedAt: new Date().toISOString()
      };
      setCoOccupants([...coOccupants, newCo]);
      setCoName('');
      setCoPhone('');
      setCoRelationship('แฟน');
      setCoCustomRelationship('');
    }
  };

  const handleRemoveCoOccupant = (id: string) => {
    setCoOccupants(coOccupants.filter(c => c.id !== id));
  };

  const handleNextStep = () => {
    setErrorText(null);
    if (currentStep === 0) {
      // Validate step 0
      if (!name.trim() || !phone.trim() || !citizenId.trim()) {
        setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
        return;
      }
      setCurrentStep(1);
    } else if (currentStep === 1) {
      // Validate emergency
      if (!emergencyName.trim() || !emergencyPhone.trim()) {
        setErrorText('กรุณากรอกผู้ติดต่อฉุกเฉินอย่างน้อย 1 ท่าน');
        return;
      }
      setCurrentStep(2);
    }
  };

  const handleSaveTenant = () => {
    setErrorText(null);
    if (!selectedRoomId) {
      setErrorText('กรุณาเลือกห้องพักสำหรับจัดสรรผู้เช่า');
      return;
    }

    const newTenantId = `tenant-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const formattedCoOccupants = coOccupants.map(c => ({
      ...c,
      addedAt: c.addedAt || nowIso
    }));
    const initialCoHistory: CoOccupantHistoryItem[] = formattedCoOccupants.map(c => ({
      id: `coh-${Date.now()}-${c.id}`,
      coOccupantId: c.id,
      name: c.name,
      phone: c.phone,
      citizenId: c.citizenId,
      action: 'added',
      timestamp: c.addedAt || nowIso,
      note: 'ลงทะเบียนเข้าพักพร้อมผู้เช่าหลัก'
    }));

    const newTenant: Tenant = {
      id: newTenantId,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      citizenId: citizenId.trim(),
      coOccupants: formattedCoOccupants,
      coOccupantHistory: initialCoHistory,
      emergencyContact: {
        name: emergencyName.trim(),
        relationship: emergencyRelation.trim(),
        phone: emergencyPhone.trim()
      },
      vehicle: {
        type: vehicleType,
        licensePlate: vehiclePlate.trim(),
        brand: vehicleBrand.trim()
      },
      pet: {
        hasPet,
        type: hasPet ? (petType === 'อื่นๆ' ? (customPetType.trim() || 'อื่นๆ') : petType) : undefined,
        name: hasPet ? petName : undefined
      },
      rentalHistory: [selectedRoomId],
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Update Room Status & CurrentTenantId
    const updatedRooms = rooms.map(r => r.id === selectedRoomId ? {
      ...r,
      status: 'occupied' as const,
      currentTenantId: newTenantId
    } : r);

    const updatedTenants = [...tenants, newTenant];

    onSaveRooms(updatedRooms);
    onSaveTenants(updatedTenants);

    onAddLog('จดทะเบียนผู้เช่าใหม่', `ย้ายผู้เช่า ${name} เข้าพักห้อง ${rooms.find(r => r.id === selectedRoomId)?.roomNumber}`, 'Tenant', newTenantId);

    setIsAddOpen(false);
  };

  const handleDeleteTenant = (tenantId: string, tenantName: string) => {
    const blockingReasons: string[] = [];

    // Check 1: Tenant assigned to room
    const assignedRoom = rooms.find(r => r.currentTenantId === tenantId);
    if (assignedRoom) {
      blockingReasons.push(`ผู้เช่ายังพักอยู่อาคาร ${assignedRoom.roomNumber}`);
    }

    // Check 2: Active or blocking contract
    const activeContracts = contracts.filter(
      c => c.tenantId === tenantId && BLOCKING_CONTRACT_STATUSES.includes(c.status)
    );
    if (activeContracts.length > 0) {
      blockingReasons.push(`มีสัญญาเช่าที่ยังมีผลบังคับใช้ ${activeContracts.length} ฉบับ`);
    }

    // Check 3: Outstanding bills
    const tenantBills = bills.filter(b => b.tenantId === tenantId);
    if (tenantBills.length > 0) {
      blockingReasons.push(`มีประวัติใบแจ้งชำระเงิน/บิลในระบบ ${tenantBills.length} รายการ`);
    }

    if (blockingReasons.length > 0) {
      alert(`ไม่สามารถถอนผู้เช่า "${tenantName}" ออกจากระบบถาวรได้ เนื่องจากยังมีข้อมูลผูกอยู่:\n\n• ` + blockingReasons.join('\n• ') + '\n\nกรุณาใช้ระบบเลิกเช่าคืนห้องพักแทนการลบออกถาวร');
      return;
    }

    if (window.confirm(`คุณต้องการถอนผู้เช่า "${tenantName}" ออกจากระบบถาวร?`)) {
      // clear tenant room mapping if any
      const updatedRooms = rooms.map(r => r.currentTenantId === tenantId ? {
        ...r,
        status: 'vacant' as const,
        currentTenantId: undefined
      } : r);

      const updatedTenants = tenants.filter(t => t.id !== tenantId);

      onSaveRooms(updatedRooms);
      onSaveTenants(updatedTenants);
      onAddLog('ลบผู้เช่า', `ถอนผู้เช่า ${tenantName} ออกจากประวัติระบบ`, 'Tenant', tenantId);
      setSelectedTenant(null);
    }
  };

  const getStayDurationText = (startDateStr: string) => {
    try {
      const start = new Date(startDateStr);
      const today = new Date();
      if (isNaN(start.getTime())) return 'ไม่ทราบวันที่เข้าพัก';
      const diffTime = Math.abs(today.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 30) {
        return `${diffDays} วัน`;
      }
      const months = Math.floor(diffDays / 30);
      const remainingDays = diffDays % 30;
      if (remainingDays === 0) {
        return `${months} เดือน`;
      }
      return `${months} เดือน ${remainingDays} วัน`;
    } catch (e) {
      return 'ไม่พบข้อมูลระยะเวลา';
    }
  };

  const handleOpenTerminate = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setTerminateReason('normal');
    setRefundDeposit(true);
    setDamageFee('0');
    setAdditionalNote('');
    setRefundMethod('promptpay');
    setRefundAccountInfo(tenant.phone || '');
    setDeductionItems([]);
    setIsSuccessAnimating(false);
    setIsTerminateOpen(true);
  };

  const handleConfirmTerminate = () => {
    if (!selectedTenant) return;

    setIsSuccessAnimating(true);

    setTimeout(() => {
      const tenantId = selectedTenant.id;
      const tenantName = selectedTenant.name;
      const room = rooms.find(r => r.currentTenantId === tenantId);
      const roomNumber = room ? room.roomNumber : '';

      // Deposit amount from contract or room
      const tenantContracts = (contracts || []).filter(c => c.tenantId === tenantId);
      const activeContract = tenantContracts.find(c => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out') || tenantContracts[0];
      const origDeposit = activeContract?.depositAmount ?? room?.depositAmount ?? 0;

      // Filter valid deductions
      const validDeductions = deductionItems.filter(item => (Number(item.amount) || 0) > 0 || (item.title && item.title.trim() !== ''));
      const totalDeductions = validDeductions.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

      // Financial outcome
      const netRefundAmount = refundDeposit ? Math.max(0, origDeposit - totalDeductions) : 0;
      const netExcessToPay = refundDeposit ? Math.max(0, totalDeductions - origDeposit) : totalDeductions;

      const deductionsSummaryText = validDeductions.length > 0
        ? validDeductions.map(d => `${d.title || 'ค่าใช้จ่าย'}: ${Number(d.amount) || 0} บาท`).join(', ')
        : 'ไม่มีรายการหัก';

      // 1. Update room status to vacant and clear currentTenantId
      const updatedRooms = rooms.map(r => r.currentTenantId === tenantId ? {
        ...r,
        status: 'vacant' as const,
        currentTenantId: undefined,
        updatedAt: new Date().toISOString()
      } : r);

      // 2. Set tenant status to inactive (preserve rentalHistory)
      const updatedTenants = tenants.map(t => {
        if (t.id === tenantId) {
          const currentHist = t.rentalHistory || [];
          const newHist = room && !currentHist.includes(room.id) ? [...currentHist, room.id] : currentHist;
          return {
            ...t,
            status: 'inactive' as const,
            rentalHistory: newHist,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      // 3. Update contract status to 'expired' and record audit trail in terms
      const settlementRecord = `[ระบบนิติ] เลิกเช่าคืนห้องพักเมื่อ ${new Date().toLocaleDateString('th-TH')}` +
        ` | เงินประกันตามสัญญา: ${origDeposit.toLocaleString()} บาท` +
        ` | การจัดการเงินประกัน: ${refundDeposit ? 'คืนเงินประกัน (นำมาหักลดค่าใช้จ่าย)' : 'ไม่คืนเงินประกัน (ยึดเงินประกัน)'}` +
        ` | รายการค่าใช้จ่ายที่หัก: ${deductionsSummaryText}` +
        ` | รวมค่าใช้จ่ายที่หัก: ${totalDeductions.toLocaleString()} บาท` +
        (refundDeposit
          ? (origDeposit >= totalDeductions
            ? ` | เงินประกันคืนผู้เช่าสุทธิ: ${netRefundAmount.toLocaleString()} บาท (${refundAccountInfo ? `${refundMethod}: ${refundAccountInfo}` : refundMethod})`
            : ` | เงินประกันช่วยลดค่าใช้จ่ายแล้ว มียอดต้องชำระเพิ่ม: ${netExcessToPay.toLocaleString()} บาท`)
          : ` | ผู้เช่าต้องชำระค่าใช้จ่ายทั้งหมด: ${netExcessToPay.toLocaleString()} บาท`) +
        (additionalNote ? ` | หมายเหตุ: ${additionalNote}` : '');

      const updatedContracts = contracts.map(c => {
        if (c.tenantId === tenantId && (c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out' || c.status === 'pending_signature' || c.status === 'expired' || c.status === 'waiting_extension')) {
          return {
            ...c,
            status: 'expired' as const,
            updatedAt: new Date().toISOString(),
            terms: `${c.terms || ''}\n${settlementRecord}`
          };
        }
        return c;
      });

      // 4. Update or generate bills
      let updatedBills = [...bills];
      const deductionBillItems: BillItem[] = validDeductions.map((item, idx) => ({
        id: `item-deduct-${Date.now()}-${idx}`,
        description: item.title || 'ค่าใช้จ่ายก่อนย้ายออก',
        amount: Number(item.amount) || 0,
        category: 'fine'
      }));

      const currentCycle = selectedCycle || new Date().toISOString().slice(0, 7);

      if (refundDeposit) {
        if (netExcessToPay > 0) {
          // Deposit covered partially, remaining excess billed to tenant
          const billItems: BillItem[] = [
            ...deductionBillItems,
            {
              id: `item-deposit-credit-${Date.now()}`,
              description: `หักชำระจากเงินประกันสัญญา (-${origDeposit.toLocaleString()} บาท)`,
              amount: -origDeposit,
              category: 'other'
            }
          ];
          const newFinalBill: Bill = {
            id: `bill-final-${tenantId}-${Date.now()}`,
            billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: billItems,
            totalAmount: netExcessToPay,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newFinalBill);
        } else if (validDeductions.length > 0) {
          // Deposit covered all deductions completely -> generate settled 0-balance bill for accounting records
          const settledBillItems: BillItem[] = [
            ...deductionBillItems,
            {
              id: `item-deposit-credit-${Date.now()}`,
              description: `หักชำระจากเงินประกันสัญญาครบถ้วน (-${totalDeductions.toLocaleString()} บาท)`,
              amount: -totalDeductions,
              category: 'other'
            }
          ];
          const settledBill: Bill = {
            id: `bill-settled-${tenantId}-${Date.now()}`,
            billNumber: `REC-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: settledBillItems,
            totalAmount: 0,
            dueDate: new Date().toISOString().split('T')[0],
            status: 'paid',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(settledBill);
        }
      } else {
        // Did not refund deposit: tenant must pay all deductions if any
        if (validDeductions.length > 0) {
          const newFinalBill: Bill = {
            id: `bill-final-${tenantId}-${Date.now()}`,
            billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: deductionBillItems,
            totalAmount: totalDeductions,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newFinalBill);
        }
      }

      // 5. Save and trigger callbacks
      onSaveRooms(updatedRooms);
      onSaveTenants(updatedTenants);
      if (onSaveContracts) {
        onSaveContracts(updatedContracts);
      }
      if (onSaveBills) {
        onSaveBills(updatedBills);
      }

      // 6. Add action log
      const detailLog = `ผู้เช่า ${tenantName} เลิกเช่าคืนห้องพัก (ห้อง ${roomNumber}) - สถานะห้อง: ว่าง, สัญญา: หมดอายุ, เงินประกัน: ${origDeposit.toLocaleString()} บาท, การจัดการเงินประกัน: ${refundDeposit ? 'คืนเงินประกัน (หักลดค่าใช้จ่าย)' : 'ไม่คืนเงินประกัน (ยึด)'}, รายการหัก: ${deductionsSummaryText}, รวมหัก: ${totalDeductions.toLocaleString()} บาท, ${refundDeposit ? (origDeposit >= totalDeductions ? `คืนเงินประกัน ${netRefundAmount.toLocaleString()} บาท` : `จ่ายเพิ่ม ${netExcessToPay.toLocaleString()} บาท`) : `จ่ายเต็ม ${netExcessToPay.toLocaleString()} บาท`}`;
      onAddLog('เลิกเช่าคืนห้อง', detailLog, 'Tenant', tenantId);

      // 7. Close modals and switch directly to inactive tab with this tenant selected
      setIsSuccessAnimating(false);
      setIsTerminateOpen(false);

      const terminatedTenant = updatedTenants.find(t => t.id === tenantId);
      setActiveStatusTab('inactive');
      if (terminatedTenant) {
        setSelectedTenant(terminatedTenant);
      }
    }, 1200);
  };

  const handleOpenEditModal = (tenant: Tenant) => {
    setErrorText(null);
    setName(tenant.name);
    setPhone(tenant.phone);
    setEmail(tenant.email || '');
    setCitizenId(tenant.citizenId);
    setEmergencyName(tenant.emergencyContact.name);
    setEmergencyRelation(tenant.emergencyContact.relationship);
    setEmergencyPhone(tenant.emergencyContact.phone);

    // Multi vehicles initialization
    const initialVehicles: VehicleItem[] = tenant.vehicles && tenant.vehicles.length > 0
      ? tenant.vehicles.map(v => ({ ...v, id: v.id || Math.random().toString() }))
      : (tenant.vehicle && tenant.vehicle.type !== 'none'
        ? [{ id: '1', type: tenant.vehicle.type, licensePlate: tenant.vehicle.licensePlate || '', brand: tenant.vehicle.brand || '' }]
        : [{ id: '1', type: 'none', licensePlate: '', brand: '' }]);
    setVehiclesList(initialVehicles);
    setVehicleType(tenant.vehicle.type);
    setVehiclePlate(tenant.vehicle.licensePlate || '');
    setVehicleBrand(tenant.vehicle.brand || '');

    // Multi pets initialization
    const initialPets: PetItem[] = tenant.pets && tenant.pets.length > 0
      ? tenant.pets.map(p => {
        const isStd = STANDARD_PET_OPTIONS.includes(p.type);
        return {
          id: p.id || Math.random().toString(),
          type: isStd ? p.type : (p.type ? 'อื่นๆ' : ''),
          customType: p.customType || (isStd ? '' : p.type),
          name: p.name || ''
        };
      })
      : (tenant.pet?.hasPet
        ? [{
          id: '1',
          type: STANDARD_PET_OPTIONS.includes(tenant.pet.type || '') ? (tenant.pet.type || '') : (tenant.pet.type ? 'อื่นๆ' : ''),
          customType: STANDARD_PET_OPTIONS.includes(tenant.pet.type || '') ? '' : (tenant.pet.type || ''),
          name: tenant.pet.name || ''
        }]
        : [{ id: '1', type: '', customType: '', name: '' }]);
    setPetsList(initialPets);
    setHasPet(tenant.pet.hasPet || (tenant.pets && tenant.pets.length > 0) || false);
    const isPrimaryStd = STANDARD_PET_OPTIONS.includes(tenant.pet.type || '');
    setPetType(isPrimaryStd ? (tenant.pet.type || '') : (tenant.pet.type ? 'อื่นๆ' : ''));
    setCustomPetType(isPrimaryStd ? '' : (tenant.pet.type || ''));
    setPetName(tenant.pet.name || '');

    setIdCardPhoto(tenant.idCardPhotoMock || '');
    setIsEditOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const webpUrl = await convertImageToWebP(file);
        setIdCardPhoto(webpUrl);
      } catch (err) {
        console.error('Failed to convert ID card image to WebP', err);
      }
    }
  };

  const handleDirectIdCardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedTenant) {
      try {
        const webpUrl = await convertImageToWebP(file);
        const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
          ...t,
          idCardPhotoMock: webpUrl,
          updatedAt: new Date().toISOString()
        } : t);
        onSaveTenants(updatedTenants);
        const updated = updatedTenants.find(t => t.id === selectedTenant.id);
        if (updated) setSelectedTenant(updated);
        onAddLog('อัปโหลดสำเนาบัตรประชาชน', `อัปโหลดเอกสารสำเนาบัตรประชาชนของผู้เช่า ${selectedTenant.name}`, 'Tenant', selectedTenant.id);
        setCopySuccessToast('อัปโหลดสำเนาบัตรประจำตัวประชาชนเรียบร้อยแล้ว');
        setTimeout(() => setCopySuccessToast(null), 3000);
      } catch (err) {
        console.error('Failed to upload ID card', err);
      }
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDirectIdCardDelete = () => {
    if (selectedTenant) {
      const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
        ...t,
        idCardPhotoMock: undefined,
        updatedAt: new Date().toISOString()
      } : t);
      onSaveTenants(updatedTenants);
      const updated = updatedTenants.find(t => t.id === selectedTenant.id);
      if (updated) setSelectedTenant(updated);
      onAddLog('ลบสำเนาบัตรประชาชน', `ลบเอกสารสำเนาบัตรประชาชนของผู้เช่า ${selectedTenant.name}`, 'Tenant', selectedTenant.id);
    }
  };

  const handlePrintIdCard = () => {
    if (!selectedTenant) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const hasPhoto = selectedTenant.idCardPhotoMock && selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64';
    const photoUrl = hasPhoto ? selectedTenant.idCardPhotoMock : '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>สำเนาบัตรประจำตัวประชาชน - ${selectedTenant.name}</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; line-height: 1.5; background: #ffffff; }
          .container { max-width: 650px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 16px; padding: 28px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; }
          .title { font-size: 20px; font-weight: 800; color: #0f172a; }
          .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; font-weight: 600; }
          .card-frame { border: 2px dashed #94a3b8; border-radius: 12px; padding: 16px; text-align: center; background: #f8fafc; margin-bottom: 24px; min-height: 220px; flex-direction: column; display: flex; align-items: center; justify-content: center; }
          .card-img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .no-img { padding: 40px; color: #64748b; font-size: 14px; font-weight: bold; }
          .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; border-left: 4px solid #3b82f6; padding-left: 8px; }
          .info-grid { width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px; }
          .info-grid td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
          .label { font-weight: 700; color: #475569; width: 38%; }
          .value { color: #0f172a; font-weight: 600; }
          .footer-note { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          @media print {
            body { padding: 0; background: none; }
            .container { border: none; box-shadow: none; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="title">เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า</div>
            <div class="subtitle">ระบบบริหารจัดการหอพัก HorPlus</div>
          </div>
          
          <div class="card-frame">
            ${hasPhoto
        ? '<img src="' + photoUrl + '" class="card-img" alt="สำเนาบัตรประชาชน" />'
        : '<div class="no-img">( ไม่ได้แนบไฟล์ภาพถ่ายสำเนาบัตรประชาชน )</div>'}
          </div>

          <div class="section-title">ข้อมูลส่วนตัวผู้เช่า</div>
          <table class="info-grid">
            <tr><td class="label">ชื่อ-นามสกุล:</td><td class="value">' + (selectedTenant.name || '-') + '</td></tr>
            <tr><td class="label">เลขประจำตัวประชาชน:</td><td class="value">' + (selectedTenant.citizenId || '-') + '</td></tr>
            <tr><td class="label">เบอร์โทรศัพท์:</td><td class="value">' + (selectedTenant.phone || '-') + '</td></tr>
            <tr><td class="label">อีเมล:</td><td class="value">' + (selectedTenant.email || '-') + '</td></tr>
            <tr><td class="label">ผู้ติดต่อฉุกเฉิน:</td><td class="value">' + (selectedTenant.emergencyContact?.name || '-') + ' (' + (selectedTenant.emergencyContact?.relationship || '-') + ') เบอร์: ' + (selectedTenant.emergencyContact?.phone || '-') + '</td></tr>
          </table>

          <div class="footer-note">เอกสารนี้พิมพ์จากระบบบริหารจัดการหอพัก เมื่อ ' + new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' น.</div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSaveEditTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !citizenId.trim()) {
      setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
      return;
    }

    if (selectedTenant) {
      const validPets = hasPet ? petsList
        .map(p => {
          const finalType = p.type === 'อื่นๆ' ? (p.customType?.trim() || 'อื่นๆ') : p.type;
          return {
            id: p.id,
            type: finalType,
            customType: p.customType,
            name: p.name
          };
        })
        .filter(p => (p.type && p.type.trim() !== '') || (p.name && p.name.trim() !== ''))
        : [];
      const primaryPet = validPets.length > 0 ? { hasPet: true, type: validPets[0].type, name: validPets[0].name } : { hasPet: false };

      const validVehicles = vehiclesList.filter(v => v.type !== 'none');
      const primaryVehicle = validVehicles.length > 0
        ? { type: validVehicles[0].type, licensePlate: validVehicles[0].licensePlate || '', brand: validVehicles[0].brand || '' }
        : { type: 'none' as const, licensePlate: '', brand: '' };

      const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
        ...t,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        citizenId: citizenId.trim(),
        idCardPhotoMock: idCardPhoto || undefined,
        emergencyContact: {
          name: emergencyName.trim(),
          relationship: emergencyRelation.trim(),
          phone: emergencyPhone.trim()
        },
        vehicle: primaryVehicle,
        vehicles: validVehicles,
        pet: primaryPet,
        pets: validPets,
        updatedAt: new Date().toISOString()
      } : t);

      onSaveTenants(updatedTenants);
      // Update selectedTenant state to reflect changes instantly
      const updatedItem = updatedTenants.find(t => t.id === selectedTenant.id);
      if (updatedItem) {
        setSelectedTenant(updatedItem);
      }
      setIsEditOpen(false);
      onAddLog('แก้ไขทะเบียนผู้เช่า', `แก้ไขข้อมูลผู้เช่าคุณ ${name.trim()}`, 'Tenant', selectedTenant.id);
    }
  };

  const handleOpenApprove = (tenant: Tenant) => {
    // Find if tenant is already tied to a room or find available rooms
    const existingRoom = rooms.find(r => r.currentTenantId === tenant.id);
    const vacantRoom = rooms.find(r => r.status === 'vacant');
    const targetRoom = existingRoom || vacantRoom || rooms[0];

    setApproveRoomId(targetRoom ? targetRoom.id : '');
    setApproveStartDate(new Date().toISOString().split('T')[0]);
    setApproveDeposit(targetRoom ? String(targetRoom.deposit || targetRoom.price * 2 || 0) : '0');
    setApproveRent(targetRoom ? String(targetRoom.price || 0) : '0');
    setIsApproveOpen(true);
  };

  const handleConfirmApprove = async () => {
    if (!selectedTenant) return;

    const chosenRoom = rooms.find(r => r.id === approveRoomId);
    const roomNum = chosenRoom ? chosenRoom.roomNumber : '';

    const reqId = (selectedTenant as any).registrationRequestId || (selectedTenant as any).requestId;
    if (reqId) {
      try {
        await approveTenantRegistrationRequest(reqId, {
          startDate: approveStartDate,
          endDate: calculateContractEndDate(approveStartDate, 12),
          durationMonths: 12,
          rentAmount: Number(approveRent) || 0,
          depositAmount: Number(approveDeposit) || 0,
          advancePaymentAmount: Number(approveRent) || 0,
        });
      } catch (err) {
        console.error('Failed to approve registration request via API:', err);
      }
    }

    // 1. Update tenant status to active and update rentalHistory
    const updatedTenants = tenants.map(t => {
      if (t.id === selectedTenant.id) {
        const existingHistory = t.rentalHistory || [];
        const newHistory = roomNum && !existingHistory.includes(roomNum)
          ? [...existingHistory, roomNum]
          : existingHistory;
        return {
          ...t,
          status: 'active' as const,
          rentalHistory: newHistory,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });

    // 2. Update room occupied status and currentTenantId
    let updatedRooms = [...rooms];
    if (chosenRoom) {
      updatedRooms = rooms.map(r => {
        if (r.id === chosenRoom.id) {
          return {
            ...r,
            status: 'occupied' as const,
            currentTenantId: selectedTenant.id,
            deposit: Number(approveDeposit) || r.deposit,
            price: Number(approveRent) || r.price,
            updatedAt: new Date().toISOString()
          };
        }
        // If tenant was previously attached to another room, free that room
        if (r.currentTenantId === selectedTenant.id && r.id !== chosenRoom.id) {
          return {
            ...r,
            status: 'vacant' as const,
            currentTenantId: null,
            updatedAt: new Date().toISOString()
          };
        }
        return r;
      });
      onSaveRooms(updatedRooms);
    }

    // 3. Update or create contract
    if (onSaveContracts) {
      const existingContract = contracts.find(c => c.tenantId === selectedTenant.id);
      if (existingContract) {
        const updatedContracts = contracts.map(c => c.id === existingContract.id ? {
          ...c,
          status: 'active' as const,
          roomId: chosenRoom ? chosenRoom.id : c.roomId,
          startDate: approveStartDate || c.startDate,
          rentAmount: Number(approveRent) || c.rentAmount,
          depositAmount: Number(approveDeposit) || c.depositAmount,
          updatedAt: new Date().toISOString()
        } : c);
        onSaveContracts(updatedContracts);
      } else if (chosenRoom) {
        const newContract: Contract = {
          id: `ct-${Date.now()}`,
          contractNumber: `CT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNum}`,
          tenantId: selectedTenant.id,
          roomId: chosenRoom.id,
          startDate: approveStartDate,
          endDate: new Date(new Date(approveStartDate).setFullYear(new Date(approveStartDate).getFullYear() + 1)).toISOString().split('T')[0],
          durationMonths: 12,
          rentAmount: Number(approveRent) || chosenRoom.price,
          depositAmount: Number(approveDeposit) || chosenRoom.deposit || chosenRoom.price * 2,
          depositStatus: 'paid',
          depositType: 'refundable',
          advancePaymentAmount: Number(approveRent) || chosenRoom.price,
          status: 'active',
          terms: 'สัญญาเช่าห้องพักมาตรฐาน',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        onSaveContracts([...contracts, newContract]);
      }
    }

    onSaveTenants(updatedTenants);
    const updatedSelected = updatedTenants.find(t => t.id === selectedTenant.id) || null;
    setSelectedTenant(updatedSelected);
    setIsApproveOpen(false);
    setActiveStatusTab('active');
    setCopySuccessToast(`อนุมัติผู้เช่า ${selectedTenant.name} เข้าพักห้อง ${roomNum || 'เรียบร้อย'} แล้ว`);
    onAddLog('อนุมัติผู้เช่า', `อนุมัติคำขอเช่าคุณ ${selectedTenant.name} เข้าห้องพัก ${roomNum}`, 'Tenant', selectedTenant.id);
  };

  const handleOpenReject = (tenant: Tenant) => {
    setRejectReason('ข้อมูลเอกสารไม่ครบถ้วน');
    setIsRejectOpen(true);
  };

  const handleConfirmReject = async () => {
    if (!selectedTenant) return;

    const reqId = (selectedTenant as any).registrationRequestId || (selectedTenant as any).requestId;
    if (reqId) {
      try {
        await rejectTenantRegistrationRequest(reqId, rejectReason);
      } catch (err) {
        console.error('Failed to reject registration request via API:', err);
      }
    }

    // Option B: Non-terminal revision requested (กรุณาตรวจสอบอีกครั้ง)
    const updatedTenants = tenants.map(t => {
      if (t.id === selectedTenant.id) {
        return {
          ...t,
          status: 'revision_requested' as any,
          rejectedReason: rejectReason,
          updatedAt: new Date().toISOString()
        };
      }
      return t;
    });

    // If tenant was linked to a room, detach
    const updatedRooms = rooms.map(r => {
      if (r.currentTenantId === selectedTenant.id) {
        return {
          ...r,
          status: 'vacant' as const,
          currentTenantId: null,
          updatedAt: new Date().toISOString()
        };
      }
      return r;
    });

    onSaveTenants(updatedTenants);
    onSaveRooms(updatedRooms);
    setIsRejectOpen(false);
    setSelectedTenant(null);
    setCopySuccessToast(`ส่งกลับคำขอให้ผู้เช่าแก้ไขข้อมูลเรียบร้อยแล้ว (กรุณาตรวจสอบอีกครั้ง)`);
    onAddLog('ส่งกลับคำขอเช่าเพื่อแก้ไข', `ส่งกลับคำขอคุณ ${selectedTenant.name} (เหตุผล: ${rejectReason})`, 'Tenant', selectedTenant.id);
  };

  const calculateContractEndDate = (start: string, duration: number) => {
    if (!start) return '';
    const d = new Date(start);
    if (isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + Number(duration));
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };

  const calculateRenewEndDate = (baseDateStr: string, unit: 'month' | 'day', count: number) => {
    if (!baseDateStr) return '';
    const d = new Date(baseDateStr);
    if (isNaN(d.getTime())) return '';
    if (unit === 'month') {
      d.setMonth(d.getMonth() + Number(count));
    } else {
      d.setDate(d.getDate() + Number(count));
    }
    return d.toISOString().split('T')[0];
  };

  const handleOpenPrintContract = (contract: Contract) => {
    const conTenant = tenants.find(t => t.id === contract.tenantId) || selectedTenant;
    const conRoom = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
    const tenantName = conTenant ? conTenant.name : 'ผู้เช่า';
    const tenantPhone = conTenant?.phone || '-';
    const tenantCitizenId = conTenant?.citizenId || '-';
    const roomNum = conRoom ? conRoom.roomNumber : contract.roomId;
    const roomFloor = conRoom?.floor ? ` (ชั้น ${conRoom.floor})` : '';
    const createdDate = contract.createdAt ? contract.createdAt.split('T')[0] : contract.startDate;
    const dormName = dorm.name || 'HorPlus';
    const dormAddress = dorm.address || 'ที่อยู่หอพัก';
    const dormOwner = dorm.ownerName || 'ผู้จัดการหอพัก';
    const tenantSig = contract.tenantSignature
      ? `<img src="${contract.tenantSignature}" style="height: 44px; max-width: 140px; object-fit: contain;" alt="ลายเซ็นผู้เช่า" />`
      : '<div style="height: 44px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 11px; border-bottom: 1px dashed #cbd5e1;">( ลายมือชื่อผู้เช่า )</div>';
    const ownerSig = (contract.ownerSignature || dorm.ownerSignature)
      ? `<img src="${contract.ownerSignature || dorm.ownerSignature}" style="height: 44px; max-width: 140px; object-fit: contain;" alt="ลายเซ็นผู้ให้เช่า" />`
      : '<div style="height: 44px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 11px; border-bottom: 1px dashed #cbd5e1;">( ลายมือชื่อผู้ให้เช่า )</div>';

    try {
      const printWindow = window.open('', '_blank', 'width=850,height=950');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html lang="th">
          <head>
            <meta charset="UTF-8">
            <title>สัญญาเช่าห้องพักเลขที่ ${contract.contractNumber} - ห้อง ${roomNum}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=Prompt:wght@400;500;600;700&display=swap" rel="stylesheet">
            <style>
              @page {
                size: A4;
                margin: 15mm;
              }
              * {
                box-sizing: border-box;
              }
              body {
                font-family: 'Sarabun', 'Prompt', system-ui, -apple-system, sans-serif;
                font-size: 14px;
                line-height: 1.7;
                color: #0f172a;
                background-color: #ffffff;
                margin: 0;
                padding: 24px;
              }
              .contract-container {
                max-width: 760px;
                margin: 0 auto;
                background: #ffffff;
              }
              .header-box {
                text-align: center;
                margin-bottom: 24px;
                padding-bottom: 16px;
                border-bottom: 2px solid #0f172a;
              }
              .title {
                font-size: 20px;
                font-weight: 800;
                color: #0f172a;
                margin: 0 0 6px 0;
                letter-spacing: 0.5px;
              }
              .contract-no {
                font-size: 13px;
                font-weight: 600;
                color: #475569;
              }
              .content-section {
                margin-bottom: 18px;
                text-align: justify;
                text-justify: inter-word;
              }
              .highlight-box {
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 12px;
                padding: 16px 20px;
                margin: 18px 0;
              }
              .highlight-box ul {
                margin: 0;
                padding-left: 20px;
              }
              .highlight-box li {
                margin-bottom: 8px;
              }
              .highlight-box li:last-child {
                margin-bottom: 0;
              }
              .terms-box {
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 14px 18px;
                margin-top: 8px;
                white-space: pre-line;
                color: #334155;
                font-size: 13px;
              }
              .signatures-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 32px;
                margin-top: 36px;
                padding-top: 24px;
                border-top: 1px dashed #cbd5e1;
                page-break-inside: avoid;
              }
              .signature-block {
                text-align: center;
              }
              .signature-label {
                font-size: 12px;
                font-weight: 600;
                color: #64748b;
                margin-bottom: 12px;
              }
              .signature-space {
                min-height: 48px;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-bottom: 8px;
              }
              .signer-name {
                font-weight: 700;
                font-size: 13px;
                color: #0f172a;
              }
              .no-print-bar {
                margin-bottom: 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                background-color: #f1f5f9;
                padding: 12px 18px;
                border-radius: 12px;
                border: 1px solid #cbd5e1;
              }
              .print-btn {
                padding: 9px 22px;
                background-color: #0f172a;
                color: #ffffff;
                border: none;
                border-radius: 10px;
                font-weight: 700;
                font-size: 13px;
                cursor: pointer;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                font-family: inherit;
              }
              .print-btn:hover {
                background-color: #334155;
              }
              @media print {
                body {
                  padding: 0;
                  background: none;
                }
                .no-print-bar {
                  display: none !important;
                }
                .contract-container {
                  max-width: 100%;
                }
              }
            </style>
          </head>
          <body>
            <div class="no-print-bar">
              <div style="font-weight: 700; color: #1e293b; font-size: 14px;">
                📄 หนังสือสัญญาเช่าเลขที่: ${contract.contractNumber} (ห้อง ${roomNum})
              </div>
              <button class="print-btn" onclick="window.print()">
                🖨️ พิมพ์เอกสารสัญญา
              </button>
            </div>

            <div class="contract-container">
              <div class="header-box">
                <h1 class="title">หนังสือสัญญาเช่าที่พักอาศัย</h1>
                <div class="contract-no">สัญญาเลขที่: ${contract.contractNumber} &bull; อาคารหอพัก ${dormName}</div>
              </div>

              <div class="content-section">
                <p>
                  สัญญาฉบับนี้ทำขึ้น ณ <strong>อาคารหอพัก ${dormName}</strong> ตั้งอยู่เลขที่ ${dormAddress} เมื่อวันที่ <strong>${formatThaiDate(createdDate)}</strong> ระหว่าง
                  <strong>นิติบุคคล ${dormName} (ผู้ให้เช่า)</strong> โดย <strong>${dormOwner}</strong> ฝ่ายหนึ่ง กับ
                  <strong>คุณ${tenantName}</strong> (เลขประจำตัวประชาชน: <strong>${tenantCitizenId}</strong>, เบอร์โทรศัพท์: <strong>${tenantPhone}</strong>) ซึ่งต่อไปนี้ในสัญญาจะเรียกว่า "ผู้เช่า" อีกฝ่ายหนึ่ง
                </p>
                <p>
                  ทั้งสองฝ่ายตกลงยินยอมทำสัญญาเช่าห้องพัก โดยมีข้อกำหนดและเงื่อนไขตามรายละเอียดดังต่อไปนี้:
                </p>
              </div>

              <div class="highlight-box">
                <ul>
                  <li><strong>ห้องพักที่ตกลงเช่า:</strong> ผู้เช่าตกลงเช่าห้องพักหมายเลข <strong>ห้อง ${roomNum}${roomFloor}</strong> ของอาคาร ${dormName}</li>
                  <li><strong>ระยะเวลาสัญญาเช่า:</strong> กำหนดเวลาเช่าอาศัย <strong>${contract.durationMonths} เดือน</strong> เริ่มต้นตั้งแต่วันที่ <strong>${formatThaiDate(contract.startDate)}</strong> ถึงวันที่ <strong>${formatThaiDate(contract.endDate)}</strong></li>
                  <li><strong>อัตราค่าบริการเช่าห้องพัก:</strong> อัตราเดือนละ <strong>${formatBaht(contract.rentAmount)}</strong> โดยผู้เช่าตกลงชำระค่าเช่าล่วงหน้าตามกำหนดของทุกเดือน</li>
                  <li><strong>เงินประกันความเสียหายแรกเข้า:</strong> ผู้เช่าได้วางเงินประกันความเสียหายไว้จำนวน <strong>${formatBaht(contract.depositAmount)}</strong> (${contract.depositType === 'deduct_rent' ? 'นำไปหักชำระกับค่าเช่างวดสุดท้าย' : 'คืนให้เต็มจำนวนเมื่อสิ้นสุดสัญญาโดยไม่มีสิ่งของชำรุดเสียหาย'})</li>
                  ${contract.advancePaymentAmount ? `<li><strong>เงินชำระล่วงหน้า:</strong> ชำระค่าเช่าล่วงหน้าจำนวน <strong>${formatBaht(contract.advancePaymentAmount)}</strong></li>` : ''}
                </ul>
              </div>

              <div class="content-section">
                <strong>ข้อตกลงและระเบียบการอยู่อาศัย:</strong>
                <div class="terms-box">${contract.terms || '1. ผู้เช่าตกลงชำระค่าเช่าและค่าสาธารณูปโภคตามกำหนดเวลา\n2. รักษาความสงบเรียบร้อยและไม่สร้างความเดือดร้อนรำคาญแก่ผู้อื่น\n3. ปฏิบัติตามระเบียบข้อบังคับของหอพักอย่างเคร่งครัด'}</div>
              </div>

              <div class="content-section" style="margin-top: 14px;">
                <p>
                  สัญญานี้ทำขึ้นเป็นสองฉบับมีข้อความถูกต้องตรงกัน คู่สัญญาทั้งสองฝ่ายได้อ่านและเข้าใจข้อความโดยละเอียดแล้ว จึงได้ลงลายมือชื่อไว้เป็นหลักฐานสำคัญต่อหน้าพยาน
                </p>
              </div>

              <div class="signatures-grid">
                <div class="signature-block">
                  <div class="signature-label">ลงชื่อ ผู้เช่าห้องพัก</div>
                  <div class="signature-space">${tenantSig}</div>
                  <div class="signer-name">(คุณ${tenantName})</div>
                </div>

                <div class="signature-block">
                  <div class="signature-label">ลงชื่อ นิติหอพัก / ผู้ให้เช่า</div>
                  <div class="signature-space">${ownerSig}</div>
                  <div class="signer-name">(${dormOwner})</div>
                </div>
              </div>
            </div>

            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 400);
              };
            </script>
          </body>
          </html>
        `);
        printWindow.document.close();
        return;
      }
    } catch (err) {
      console.error('Error opening print window:', err);
    }

    // Fallback if popup blocked
    setSelectedContractForPrint(contract);
    setIsPrintContractModalOpen(true);
  };

  const handleOpenEditContract = (contract: Contract) => {
    setSelectedContractForEdit(contract);
    setEditContractStartDate(contract.startDate || '');
    setEditContractEndDate(contract.endDate || '');
    setEditContractDuration(contract.durationMonths || 6);
    setEditContractRent(contract.rentAmount || 0);
    setEditContractDeposit(contract.depositAmount || 0);
    setEditContractDepositStatus(contract.depositStatus || 'paid');
    setEditContractDepositType(contract.depositType || 'refundable');
    setEditContractAdvancePayment(contract.advancePaymentAmount || 0);
    setEditContractTerms(contract.terms || '');
    setIsEditContractModalOpen(true);
  };

  const handleSaveEditContract = () => {
    if (!selectedContractForEdit || !onSaveContracts) return;
    const updated = (contracts || []).map(c => c.id === selectedContractForEdit.id ? {
      ...c,
      startDate: editContractStartDate,
      endDate: editContractEndDate,
      durationMonths: editContractDuration,
      rentAmount: editContractRent,
      depositAmount: editContractDeposit,
      depositStatus: editContractDepositStatus,
      depositType: editContractDepositType,
      advancePaymentAmount: editContractAdvancePayment,
      terms: editContractTerms,
      updatedAt: new Date().toISOString()
    } : c);
    onSaveContracts(updated);
    onAddLog('แก้ไขสัญญาเช่า', `แก้ไขรายละเอียดสัญญาเลขที่ ${selectedContractForEdit.contractNumber} สำเร็จ`, 'Contract', selectedContractForEdit.id);
    setIsEditContractModalOpen(false);
    setSelectedContractForEdit(null);
    setContractToast(`แก้ไขสัญญาเช่าเลขที่ ${selectedContractForEdit.contractNumber} เรียบร้อยแล้ว`);
    setTimeout(() => setContractToast(null), 3000);
  };

  const handleOpenRenewContract = (contract: Contract, tenant?: Tenant) => {
    setSelectedContractForRenew(contract);
    const targetTenant = tenant || tenants.find(t => t.id === contract.tenantId) || selectedTenant;
    if (targetTenant) {
      setSelectedTenant(targetTenant);
    }

    const currentEnd = contract.endDate || contract.startDate || new Date().toISOString().split('T')[0];
    const nextStart = new Date(currentEnd);
    nextStart.setDate(nextStart.getDate() + 1);
    const nextStartStr = nextStart.toISOString().split('T')[0];

    const defaultDuration = 6;
    setRenewContractUnit('month');
    setRenewContractMonths(defaultDuration);
    setRenewContractDays(0);
    setRenewContractStartDate(nextStartStr);
    setRenewContractEndDate(calculateContractEndDate(nextStartStr, defaultDuration));
    setRenewContractRentAmount(contract.rentAmount || 0);
    setRenewContractDepositAmount(contract.depositAmount || 0);
    setRenewContractDepositOption('rollover');
    setRenewContractNote(
      contract.status === 'waiting_extension'
        ? 'อนุมัติคำขอต่ออายุสัญญาเช่า 6 เดือน ตามความประสงค์ของผู้เช่า'
        : 'อนุมัติต่ออายุสัญญาเช่าฉบับใหม่'
    );
    setIsRenewContractModalOpen(true);
  };

  const handleExecuteRenewContract = () => {
    if (!selectedContractForRenew || !onSaveContracts) return;

    const finalStartDate = renewContractStartDate || new Date().toISOString().split('T')[0];
    const finalEndDate = renewContractEndDate || calculateContractEndDate(finalStartDate, renewContractMonths || 6);

    const nextDuration = renewContractUnit === 'month'
      ? (renewContractMonths > 0 ? renewContractMonths : 6)
      : (renewContractDays > 0 ? Math.max(1, Math.round(renewContractDays / 30)) : 1);

    const finalRent = renewContractRentAmount > 0
      ? renewContractRentAmount
      : (selectedContractForRenew.rentAmount || 0);

    const finalDeposit = renewContractDepositOption === 'rollover'
      ? (selectedContractForRenew.depositAmount || 0)
      : (renewContractDepositAmount || 0);

    const targetRoom = rooms.find(r => r.id === selectedContractForRenew.roomId);
    const targetTenant = tenants.find(t => t.id === selectedContractForRenew.tenantId) || selectedTenant;
    const roomNum = targetRoom ? targetRoom.roomNumber : '';

    // Create new renewed contract
    const newContractId = `ct-renew-${Date.now()}`;
    const newContract: Contract = {
      id: newContractId,
      contractNumber: `CNT-2026-${1000 + (contracts?.length || 0) + 1}`,
      tenantId: selectedContractForRenew.tenantId,
      roomId: selectedContractForRenew.roomId,
      startDate: finalStartDate,
      endDate: finalEndDate,
      durationMonths: nextDuration,
      rentAmount: finalRent,
      depositAmount: finalDeposit,
      depositStatus: selectedContractForRenew.depositStatus || 'paid',
      depositType: selectedContractForRenew.depositType || 'refundable',
      advancePaymentAmount: 0,
      terms: `${selectedContractForRenew.terms || ''}\n[อนุมัติต่ออายุสัญญา: ${renewContractNote || 'อนุมัติการต่อสัญญา'}]`,
      tenantSignature: selectedContractForRenew.tenantSignature,
      ownerSignature: selectedContractForRenew.ownerSignature || dorm.ownerSignature,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Mark previous contract as expired
    const updatedContracts = (contracts || []).map(c => c.id === selectedContractForRenew.id ? {
      ...c,
      status: 'expired' as const,
      updatedAt: new Date().toISOString()
    } : c);

    onSaveContracts([...updatedContracts, newContract]);

    // Ensure tenant is active and room is occupied
    if (targetTenant && targetTenant.status !== 'active') {
      const updatedTenants = tenants.map(t => t.id === targetTenant.id ? { ...t, status: 'active' as const } : t);
      onSaveTenants(updatedTenants);
    }

    onAddLog('อนุมัติคำขอต่อสัญญา', `อนุมัติคำขอต่ออายุสัญญาห้อง ${roomNum} (${targetTenant?.name || ''}) เลขที่ ${newContract.contractNumber} สิ้นสุด ${finalEndDate}`, 'Contract', newContractId);
    setIsRenewContractModalOpen(false);
    setSelectedContractForRenew(null);
    setCopySuccessToast(`อนุมัติคำขอต่ออายุสัญญาเช่าห้อง ${roomNum} สำเร็จ (เลขที่ ${newContract.contractNumber})`);
    setTimeout(() => setCopySuccessToast(null), 3500);
  };

  const handleOpenCreateContract = (tenant: Tenant) => {
    const tenantRoom = rooms.find(r => r.currentTenantId === tenant.id || (tenant.rentalHistory && tenant.rentalHistory.includes(r.id)));
    const targetRoom = tenantRoom || rooms.find(r => r.status === 'vacant') || rooms[0];
    const initialStart = new Date().toISOString().split('T')[0];
    const initialDuration = 6;
    const calculatedEnd = calculateContractEndDate(initialStart, initialDuration);

    setCreateContractRoomId(targetRoom ? targetRoom.id : '');
    setCreateContractStartDate(initialStart);
    setCreateContractStayDate(initialStart);
    setCreateContractDuration(initialDuration);
    setCreateContractEndDate(calculatedEnd);
    setCreateContractRent(targetRoom ? targetRoom.monthlyRent : 4000);
    setCreateContractDeposit(targetRoom ? (targetRoom.monthlyRent * 2) : 8000);
    setCreateContractDepositStatus('paid');
    setCreateContractDepositType('refundable');
    setCreateContractAdvancePayment(0);
    setIsCreateContractModalOpen(true);
  };

  const handleSaveNewContract = () => {
    if (!selectedTenant || !onSaveContracts) return;
    const targetRoom = rooms.find(r => r.id === createContractRoomId);
    if (!targetRoom) return;

    const newContractId = `ct-${Date.now()}`;
    const newContract: Contract = {
      id: newContractId,
      contractNumber: `CNT-2026-${1000 + (contracts?.length || 0) + 1}`,
      tenantId: selectedTenant.id,
      roomId: targetRoom.id,
      startDate: createContractStartDate,
      endDate: createContractEndDate || calculateContractEndDate(createContractStartDate, createContractDuration),
      durationMonths: createContractDuration,
      rentAmount: createContractRent,
      depositAmount: createContractDeposit,
      depositStatus: createContractDepositStatus,
      depositType: createContractDepositType,
      advancePaymentAmount: createContractAdvancePayment,
      terms: createContractTerms,
      tenantSignature: createContractTenantSig,
      ownerSignature: dorm.ownerSignature || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><path d="M10,25 Q40,5 60,30 T90,20" stroke="blue" stroke-width="2" fill="none"/></svg>',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update room with tenant
    const updatedRooms = rooms.map(r => r.id === targetRoom.id ? {
      ...r,
      status: 'occupied' as const,
      currentTenantId: selectedTenant.id,
      updatedAt: new Date().toISOString()
    } : r);
    onSaveRooms(updatedRooms);

    // Update tenant with room
    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
      ...t,
      status: 'active' as const,
      roomId: targetRoom.id,
      roomNumber: targetRoom.roomNumber,
      updatedAt: new Date().toISOString()
    } : t);
    onSaveTenants(updatedTenants);

    onSaveContracts([...(contracts || []), newContract]);
    onAddLog('จัดทำสัญญาเช่าใหม่', `สร้างสัญญาเช่า ${newContract.contractNumber} สำหรับคุณ ${selectedTenant.name} (ห้อง ${targetRoom.roomNumber})`, 'Contract', newContractId);

    setIsCreateContractModalOpen(false);
    setContractToast(`จัดทำสัญญาเช่าใหม่ ${newContract.contractNumber} เรียบร้อยแล้ว`);
    setTimeout(() => setContractToast(null), 3000);
  };

  const formatPhoneInput = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) return '';
    const parts = [];
    if (clean.startsWith('02')) {
      if (clean.length > 0) parts.push(clean.slice(0, 2));
      if (clean.length > 2) parts.push(clean.slice(2, 5));
      if (clean.length > 5) parts.push(clean.slice(5, 9));
    } else {
      if (clean.length > 0) parts.push(clean.slice(0, 3));
      if (clean.length > 3) parts.push(clean.slice(3, 6));
      if (clean.length > 6) parts.push(clean.slice(6, 10));
    }
    return parts.join('-');
  };

  const formatCitizenIdInput = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) return '';
    const parts = [];
    if (clean.length > 0) parts.push(clean.slice(0, 1));
    if (clean.length > 1) parts.push(clean.slice(1, 5));
    if (clean.length > 5) parts.push(clean.slice(5, 10));
    if (clean.length > 10) parts.push(clean.slice(10, 12));
    if (clean.length > 12) parts.push(clean.slice(12, 13));
    return parts.join('-');
  };

  const formatPhone = (val: string) => {
    if (!val) return '';
    return formatPhoneInput(val);
  };

  const formatCitizenId = (val: string) => {
    if (!val) return '';
    return formatCitizenIdInput(val);
  };

  const getLatestCycle = () => {
    if (!bills || bills.length === 0) return '2026-07';
    const cycles = bills.map(b => b.cycleId);
    return cycles.reduce((max, c) => c > max ? c : max, '2026-01');
  };

  const getRecent2Cycles = () => {
    if (!bills || bills.length === 0) return ['2026-07', '2026-06'];
    // Filter cycles where at least 1 room has a bill created (status is not 'unbilled' / 'draft')
    const activeCyclesWithBills = Array.from(
      new Set(
        bills
          .filter(b => (b.status as string) !== 'unbilled')
          .map(b => b.cycleId)
      )
    ).sort().reverse();

    if (activeCyclesWithBills.length === 0) {
      return Array.from(new Set(bills.map(b => b.cycleId))).sort().reverse().slice(0, 2);
    }

    return activeCyclesWithBills.slice(0, 2);
  };

  const isLatestCycle = !selectedCycle || selectedCycle === getLatestCycle();
  const isRecent2Cycles = !selectedCycle || getRecent2Cycles().includes(selectedCycle);

  const isTenantInCycle = (tenant: Tenant) => {
    if (!selectedCycle) return true;

    // 1. Check if there is a bill in this cycle for this tenant
    const hasBill = bills?.some(b => b.tenantId === tenant.id && b.cycleId === selectedCycle);
    if (hasBill) return true;

    // 2. Check if there is a contract active during this cycle
    const tenantContracts = contracts?.filter(c => c.tenantId === tenant.id);
    const hasContract = tenantContracts?.some(c => {
      const [cy, cm] = selectedCycle.split('-').map(Number);
      const [sy, sm] = c.startDate.split('-').map(Number);
      const [ey, em] = c.endDate.split('-').map(Number);

      const cycleVal = cy * 12 + (cm - 1);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);

      return cycleVal >= startVal && cycleVal <= endVal;
    });
    if (hasContract) return true;

    // 3. Fallback: If they are active now, and this is the latest cycle, they are in!
    const isCurrentResident = rooms?.some(r => r.currentTenantId === tenant.id);
    if (isCurrentResident && tenant.status === 'active' && isLatestCycle) {
      return true;
    }

    return false;
  };

  // Helper to categorize each tenant into: pending, active, inactive
  const getTenantCategory = (t: Tenant): 'pending' | 'active' | 'inactive' => {
    if (t.status === 'inactive') return 'inactive';

    // Quick Add tenants start with OWNER_CREATED or WAITING_LINE_BIND and must be in active
    if (t.lifecycleStage === 'OWNER_CREATED' || t.lifecycleStage === 'WAITING_LINE_BIND') {
      return 'active';
    }

    if (t.status === 'pending' || (t.status as any) === 'revision_requested' || (t as any).lifecycleStage === 'WAITING_OWNER_APPROVAL') {
      return 'pending';
    }

    // If status is active but has no current room assigned or waiting contract
    const isCurrentlyInRoom = rooms.some(r => r.currentTenantId === t.id);
    const tenantContracts = contracts.filter(c => c.tenantId === t.id);
    const isPendingContract = tenantContracts.some(c => c.status === 'pending_signature' || c.status === 'draft');

    if (isPendingContract && !isCurrentlyInRoom) {
      return 'pending';
    }

    if (!isCurrentlyInRoom && (!t.rentalHistory || t.rentalHistory.length === 0)) {
      return 'pending';
    }

    return 'active';
  };

  const pendingTenants = tenants.filter(t => getTenantCategory(t) === 'pending');
  const activeTenants = tenants.filter(t => getTenantCategory(t) === 'active');
  const inactiveTenants = tenants.filter(t => getTenantCategory(t) === 'inactive');

  // Expired / Expiring contracts needing owner review / decision (เลิกเช่า หรือ อนุมัติคำขอ)
  const expiredContractEntries = React.useMemo(() => {
    if (!contracts || contracts.length === 0) return [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const entries: {
      contract: Contract;
      tenant: Tenant;
      room?: Room;
      statusType: 'expired' | 'waiting_extension' | 'expiring_soon' | 'checking_out';
      statusLabel: string;
      daysRemaining?: number;
      reason?: string;
    }[] = [];

    contracts.forEach(contract => {
      const tenant = tenants.find(t => t.id === contract.tenantId);
      if (!tenant) return;

      const isCurrentlyInRoom = rooms.some(r => r.currentTenantId === tenant.id);
      // Skip if already inactive and not currently in any room
      if (contract.status === 'terminated' || (tenant.status === 'inactive' && !isCurrentlyInRoom)) {
        return;
      }

      const room = rooms.find(r => r.id === contract.roomId || r.currentTenantId === tenant.id);

      let statusType: 'expired' | 'waiting_extension' | 'expiring_soon' | 'checking_out' | null = null;
      let statusLabel = '';
      let daysRemaining = 0;

      if (contract.endDate) {
        const endDate = new Date(contract.endDate);
        const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const diffTime = endDay.getTime() - curDay.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        daysRemaining = diffDays;
      }

      if (contract.status === 'expired') {
        statusType = 'expired';
        statusLabel = 'หมดอายุ';
      } else if (contract.status === 'waiting_extension') {
        statusType = 'waiting_extension';
        statusLabel = 'ยื่นคำขอต่อสัญญา';
      } else if (contract.status === 'checking_out') {
        statusType = 'checking_out';
        statusLabel = 'แจ้งความประสงค์เลิกเช่า';
      } else if (contract.status === 'expiring_soon') {
        statusType = 'expiring_soon';
        statusLabel = daysRemaining > 0 ? `เหลือ ${daysRemaining} วัน` : 'หมดอายุ';
      } else if (contract.status === 'active' && contract.endDate) {
        if (contract.endDate < todayStr || daysRemaining <= 0) {
          statusType = 'expired';
          statusLabel = 'หมดอายุ';
        } else if (daysRemaining <= 30) {
          statusType = 'expiring_soon';
          statusLabel = `เหลือ ${daysRemaining} วัน`;
        }
      }

      if (statusType) {
        entries.push({
          contract,
          tenant,
          room,
          statusType,
          statusLabel,
          daysRemaining,
          reason: contract.status === 'waiting_extension'
            ? 'ผู้เช่ายื่นคำขอต่อสัญญาเช่า 6 เดือน'
            : contract.status === 'checking_out'
              ? 'ผู้เช่าแจ้งความประสงค์จะย้ายออก'
              : (statusType === 'expired' || daysRemaining <= 0)
                ? 'สัญญาครบกำหนดระยะเวลาการเช่าแล้ว'
                : `สัญญาเช่าจะหมดอายุในอีก ${daysRemaining} วัน`
        });
      }
    });

    return entries;
  }, [contracts, tenants, rooms]);

  const pendingTotalCount = pendingTenants.length + expiredContractEntries.length;

  const getRoomNumber = (tenantId: string) => {
    // 1. Check if there is a bill in the selectedCycle for this tenant
    if (selectedCycle && bills) {
      const cycleBill = bills.find(b => b.tenantId === tenantId && b.cycleId === selectedCycle);
      if (cycleBill) {
        const r = rooms.find(room => room.id === cycleBill.roomId);
        if (r) return r.roomNumber;
      }
    }
    // 2. Check if there is a contract active in the selectedCycle for this tenant
    if (selectedCycle && contracts) {
      const cycleContracts = contracts.filter(c => c.tenantId === tenantId);
      const activeContract = cycleContracts.find(c => {
        const [cy, cm] = selectedCycle.split('-').map(Number);
        const [sy, sm] = c.startDate.split('-').map(Number);
        const [ey, em] = c.endDate.split('-').map(Number);

        const cycleVal = cy * 12 + (cm - 1);
        const startVal = sy * 12 + (sm - 1);
        const endVal = ey * 12 + (em - 1);

        return cycleVal >= startVal && cycleVal <= endVal;
      });
      if (activeContract) {
        const r = rooms.find(room => room.id === activeContract.roomId);
        if (r) return r.roomNumber;
      }
    }
    // 3. Fallback to current room
    const currentRoom = rooms.find(r => r.currentTenantId === tenantId);
    if (currentRoom) return currentRoom.roomNumber;

    // 4. Fallback to rentalHistory or applied room (e.g. for pending applicants)
    const t = tenants.find(item => item.id === tenantId);
    if (t && t.rentalHistory && t.rentalHistory.length > 0) {
      const r = rooms.find(room => room.id === t.rentalHistory[0]);
      if (r) return r.roomNumber;
    }

    return 'ไม่ระบุห้อง';
  };

  const filteredExpiredContracts = React.useMemo(() => {
    const q = (searchQuery || '').toLowerCase().trim();
    return expiredContractEntries.filter(entry => {
      if (!q) return true;
      const tName = (entry.tenant.name || '').toLowerCase();
      const tPhone = entry.tenant.phone || '';
      const rNum = (entry.room?.roomNumber || getRoomNumber(entry.tenant.id)).toLowerCase();
      const cNum = (entry.contract.contractNumber || '').toLowerCase();
      return tName.includes(q) || tPhone.includes(q) || rNum.includes(q) || cNum.includes(q);
    });
  }, [expiredContractEntries, searchQuery, getRoomNumber]);

  // Filter tenants by active tab, search query and billing cycle
  const filteredTenants = tenants.filter(t => {
    if (getTenantCategory(t) !== activeStatusTab) return false;

    if (activeStatusTab === 'active' && !isTenantInCycle(t)) return false;

    const name = (t?.name || '').toLowerCase();
    const phone = t?.phone || '';
    const email = (t?.email || '').toLowerCase();
    const roomNum = getRoomNumber(t.id).toLowerCase();
    const q = (searchQuery || '').toLowerCase();

    return (
      name.includes(q) ||
      phone.includes(searchQuery || '') ||
      email.includes(q) ||
      roomNum.includes(q)
    );
  });

  return (
    <div className="space-y-6">

      {/* Filter Tabs & Quick Action Row (Matching Payment UI Box) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs space-y-4 shrink-0">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full sm:w-auto flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => { setActiveStatusTab('pending'); setSelectedTenant(null); setSelectedContractForReview(null); setProfileTab('contract'); setOriginTab(null); setCameFromMeters(false); }}
              className={`col-span-2 sm:col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'pending'
                  ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Clock className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <span className="whitespace-nowrap">รอตรวจสอบ ({pendingTotalCount})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveStatusTab('active'); setSelectedTenant(null); setSelectedContractForReview(null); setOriginTab(null); setCameFromMeters(false); }}
              className={`col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'active'
                  ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="whitespace-nowrap">พักอาศัย ({activeTenants.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveStatusTab('inactive'); setSelectedTenant(null); setSelectedContractForReview(null); setOriginTab(null); setCameFromMeters(false); }}
              className={`col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'inactive'
                  ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="whitespace-nowrap">เลิกเช่าแล้ว ({inactiveTenants.length})</span>
            </button>
          </div>

          <button
            onClick={handleOpenAddWizard}
            className="px-4 sm:px-5 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer shrink-0 whitespace-nowrap"
            title="จดทะเบียนผู้เช่าและย้ายเข้า"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">เพิ่มผู้เช่าใหม่</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-slate-50/50 text-slate-800 font-semibold"
            />
          </div>
        </div>
      </div>

      {/* Main Grid: Left List & Right Detail Profile */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">

        {/* Left column: List of tenants */}
        <div className={`md:col-span-5 lg:col-span-4 bg-white p-4 sm:p-5 rounded-3xl border border-gray-100 shadow-xs flex flex-col h-[700px] ${selectedTenant ? 'hidden md:flex' : 'flex'
          }`}>
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              {activeStatusTab === 'pending' && <Clock className="w-4 h-4 text-amber-500" />}
              {activeStatusTab === 'active' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              {activeStatusTab === 'inactive' && <XCircle className="w-4 h-4 text-rose-500" />}
              <h3 className="text-base font-extrabold text-slate-900">
                {activeStatusTab === 'pending' && 'รายการรอตรวจสอบ'}
                {activeStatusTab === 'active' && 'ผู้เช่าที่พักอาศัยอยู่'}
                {activeStatusTab === 'inactive' && 'ผู้เช่าที่เลิกเช่าแล้ว'}
                {' '}({activeStatusTab === 'pending' ? (filteredExpiredContracts.length + filteredTenants.length) : filteredTenants.length})
              </h3>
            </div>
            <span className="text-[11px] font-bold text-slate-400">
              {activeStatusTab === 'active' ? 'กำลังเช่า' : activeStatusTab === 'pending' ? 'รอการตัดสินใจ' : 'ย้ายออกแล้ว'}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 pr-1">
            {/* 1. In 'pending' tab: Render Pending Applicants ("รอตรวจสอบ") first */}
            {activeStatusTab === 'pending' && pendingSubTab !== 'expired' && filteredTenants.map((tenant) => {
              const roomNum = getRoomNumber(tenant.id);
              const isSelected = selectedTenant?.id === tenant.id && !selectedContractForReview;

              return (
                <div
                  key={tenant.id}
                  onClick={() => {
                    setSelectedTenant(tenant);
                    setSelectedContractForReview(null);
                    setProfileTab('contract');
                    setOriginTab(null);
                    setCameFromMeters(false);
                  }}
                  className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 border ${isSelected ? 'bg-amber-50/70 border-amber-200 shadow-2xs' : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-3xs'
                    }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex gap-2.5 items-center min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs bg-amber-100 text-amber-700">
                        {tenant.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{tenant.name}</h4>
                          {roomNum && roomNum !== 'ไม่ระบุห้อง' && (
                            <span className="bg-amber-100/90 text-amber-800 font-extrabold text-[10px] px-1.5 py-0.5 rounded-md leading-none border border-amber-200">
                              ห้อง {roomNum}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(tenant.phone)}</p>
                      </div>
                    </div>

                    <span className={`border font-extrabold text-[10px] px-2 py-0.5 rounded-lg shrink-0 flex items-center gap-1 ${
                      (tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : (tenant as any).status === 'revision_requested'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                    }`}>
                      {(tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Clock className={`w-3 h-3 ${(tenant as any).status === 'revision_requested' ? 'text-rose-600' : 'text-amber-600'}`} />
                      )}
                      <span>
                        {(tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation'
                          ? 'กรุณาตรวจสอบและยืนยัน'
                          : (tenant as any).status === 'revision_requested'
                          ? 'กรุณาตรวจสอบอีกครั้ง'
                          : 'รออนุมัติคำขอผู้เช่า'}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 2. In 'pending' tab: Render Expired Contracts ("หมดอายุ") second */}
            {activeStatusTab === 'pending' && pendingSubTab !== 'new_tenant' && (
              <>
                {filteredExpiredContracts.map((entry) => {
                  const roomNum = entry.room?.roomNumber || getRoomNumber(entry.tenant.id);
                  const isSelected = selectedTenant?.id === entry.tenant.id && selectedContractForReview?.id === entry.contract.id;

                  return (
                    <div
                      key={`expired-ct-${entry.contract.id}`}
                      onClick={() => {
                        setSelectedTenant(entry.tenant);
                        setSelectedContractForReview(entry.contract);
                        setProfileTab('contract');
                        setOriginTab(null);
                        setCameFromMeters(false);
                      }}
                      className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 border ${isSelected
                          ? (entry.statusType === 'expiring_soon' || entry.statusType === 'waiting_extension'
                            ? 'bg-amber-50/70 border-amber-200 shadow-2xs'
                            : 'bg-rose-50/70 border-rose-200 shadow-2xs')
                          : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-3xs'
                        }`}
                    >
                      {/* Top Row: Tenant & Room */}
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex gap-2.5 items-center min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs ${entry.statusType === 'waiting_extension' || entry.statusType === 'expiring_soon'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-rose-100 text-rose-700'
                            }`}>
                            {entry.tenant.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{entry.tenant.name}</h4>
                              <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-1.5 py-0.5 rounded-md leading-none">
                                ห้อง {roomNum}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(entry.tenant.phone)}</p>
                          </div>
                        </div>

                        {/* Status Badge & Expiration date underneath */}
                        <div className="flex flex-col items-end shrink-0 gap-1">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg shrink-0 flex items-center gap-1 border ${entry.statusType === 'waiting_extension' || entry.statusType === 'expiring_soon'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>{entry.statusLabel}</span>
                          </span>
                          <span className={`text-[10px] font-bold whitespace-nowrap ${entry.statusType === 'expiring_soon' ? 'text-amber-700' : 'text-rose-600'
                            }`}>
                            หมดสัญญา: {formatThaiDate(entry.contract.endDate)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* 3. In other tabs ('active' or 'inactive'): Render regular tenants */}
            {activeStatusTab !== 'pending' && filteredTenants.map((tenant) => {
              const category = getTenantCategory(tenant);
              const roomNum = getRoomNumber(tenant.id);
              const isSelected = selectedTenant?.id === tenant.id && !selectedContractForReview;

              return (
                <div
                  key={tenant.id}
                  onClick={() => {
                    setSelectedTenant(tenant);
                    setSelectedContractForReview(null);
                    setProfileTab('info');
                    setOriginTab(null);
                    setCameFromMeters(false);
                  }}
                  className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-1.5 ${isSelected ? 'bg-indigo-50/70 border border-indigo-150/40 shadow-2xs' : 'hover:bg-slate-50 border border-transparent'
                    }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex gap-3 items-center min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${category === 'inactive' ? 'bg-slate-100 text-slate-500' :
                          'bg-indigo-50 text-indigo-700'
                        }`}>
                        {tenant.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{tenant.name}</h4>
                          {category === 'active' && !isTenantLineBound(tenant) && (
                            <span
                              data-testid="badge-unbound-line"
                              className="bg-amber-50 border border-amber-200 text-amber-700 font-extrabold text-[9px] px-1.5 py-0.5 rounded-md shrink-0 flex items-center gap-1"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              <span>ยังไม่ผูก LINE</span>
                            </span>
                          )}
                          {category === 'active' && getRentalTypeLabel(tenant, contracts) && (
                            <span
                              data-testid="badge-rental-type"
                              className="bg-slate-100 border border-slate-200 text-slate-600 font-bold text-[9px] px-1.5 py-0.5 rounded-md shrink-0"
                            >
                              {getRentalTypeLabel(tenant, contracts)}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(tenant.phone)}</p>
                      </div>
                    </div>

                    {category === 'inactive' ? (
                      <span className="bg-slate-100 border border-slate-200 text-slate-600 font-extrabold text-[10px] px-2 py-1 rounded-lg shrink-0 flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-rose-500" />
                        <span>เลิกเช่าแล้ว</span>
                      </span>
                    ) : (
                      <span
                        data-testid="badge-room-number"
                        className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-2 py-1 rounded-lg shrink-0"
                      >
                        ห้อง {roomNum}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {activeStatusTab === 'pending' ? (
              filteredExpiredContracts.length === 0 && filteredTenants.length === 0 && (
                <div className="text-center py-16 text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                  <Clock className="w-8 h-8 text-gray-300" />
                  <span>ไม่มีรายการที่ต้องตรวจสอบในขณะนี้</span>
                </div>
              )
            ) : (
              filteredTenants.length === 0 && (
                <div className="text-center py-16 text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                  <Users className="w-8 h-8 text-gray-300" />
                  <span>ไม่พบข้อมูลผู้เช่าในหมวดหมู่นี้</span>
                </div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Tenant detailed profile tab panel */}
        <div className={`md:col-span-7 lg:col-span-8 min-w-0 w-full ${selectedTenant ? 'block' : 'hidden md:block'}`}>
          {selectedTenant ? (
            <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-xs h-[700px] flex flex-col justify-between w-full min-w-0 overflow-hidden">
              <div>
                {/* Context-Aware Back Button */}
                {originTab === 'rooms' ? (
                  <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-gray-100">
                    <button
                      type="button"
                      onClick={() => {
                        setOriginTab(null);
                        const targetRoom = rooms.find(r => r.currentTenantId === selectedTenant.id || r.id === (selectedTenant as any).roomId);
                        if (returnContext && onReturnToSource) {
                          onReturnToSource(returnContext);
                        } else if (onBackToRooms) {
                          onBackToRooms(targetRoom?.id);
                        }
                      }}
                      className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/90 px-3.5 py-1.5 rounded-xl font-extrabold text-xs transition-all border border-indigo-200/80 cursor-pointer shadow-3xs group active:scale-95"
                    >
                      <ArrowLeft className="w-4 h-4 text-indigo-600 group-hover:-translate-x-0.5 transition-transform" />
                      <span>
                        กลับไปยัง {getRoomNumber(selectedTenant.id) && getRoomNumber(selectedTenant.id) !== '-' ? `(ห้อง ${getRoomNumber(selectedTenant.id)})` : ''}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (onDismissReturnContext) onDismissReturnContext();
                        setSelectedTenant(null);
                      }}
                      className="md:hidden inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 text-xs font-bold px-2 py-1"
                    >
                      <span>ดูรายชื่อผู้เช่า</span>
                    </button>
                  </div>
                ) : cameFromMeters || originTab === 'meters' ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOriginTab(null);
                      setCameFromMeters(false);
                      setSelectedTenant(null);
                      if (returnContext && onReturnToSource) {
                        onReturnToSource(returnContext);
                      } else if (onBackToMeters) {
                        onBackToMeters();
                      }
                    }}
                    className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/90 px-3.5 py-1.5 rounded-xl font-extrabold text-xs mb-4 transition-all border border-indigo-200/80 cursor-pointer shadow-3xs group w-fit active:scale-95"
                  >
                    <ArrowLeft className="w-4 h-4 text-indigo-600 group-hover:-translate-x-0.5 transition-transform" />
                    <span>กลับไปยังหน้าบันทึก "จดมิเตอร์"</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (onDismissReturnContext) onDismissReturnContext();
                      setSelectedTenant(null);
                    }}
                    className="md:hidden flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-extrabold text-xs mb-4 transition-all pb-2 border-b border-gray-100 w-full cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>กลับไปยังรายชื่อผู้เช่า</span>
                  </button>
                )}

                {/* Header */}
                {(() => {
                  const tenantReviewContract = selectedContractForReview || (contracts || []).find(c =>
                    c.tenantId === selectedTenant.id && (c.status === 'expired' || c.status === 'waiting_extension' || c.status === 'expiring_soon' || c.status === 'checking_out')
                  );
                  const isExpiredContractReview = !!tenantReviewContract && (
                    activeStatusTab === 'pending' ||
                    selectedContractForReview?.id === tenantReviewContract.id ||
                    tenantReviewContract.status === 'expired' ||
                    tenantReviewContract.status === 'waiting_extension'
                  );

                  return (
                    <>
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-5">
                        <div className="flex gap-3.5 items-center">
                          <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-extrabold text-base sm:text-lg shadow-sm border shrink-0 ${isExpiredContractReview
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : getTenantCategory(selectedTenant) === 'pending'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : getTenantCategory(selectedTenant) === 'inactive'
                                  ? 'bg-slate-100 text-slate-600 border-slate-200'
                                  : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                            }`}>
                            {selectedTenant.name.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight">{selectedTenant.name}</h2>
                              {isExpiredContractReview && (
                                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${tenantReviewContract.status === 'waiting_extension' || (tenantReviewContract.endDate && (() => {
                                    const today = new Date();
                                    const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                    const endDay = new Date(new Date(tenantReviewContract.endDate).getFullYear(), new Date(tenantReviewContract.endDate).getMonth(), new Date(tenantReviewContract.endDate).getDate());
                                    return Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24)) > 0;
                                  })())
                                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                                    : 'bg-rose-100 text-rose-800 border-rose-200'
                                  }`}>
                                  <AlertCircle className="w-3 h-3" />
                                  {tenantReviewContract.status === 'waiting_extension'
                                    ? 'คำขอ'
                                    : (() => {
                                      if (tenantReviewContract.endDate) {
                                        const today = new Date();
                                        const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                        const endDay = new Date(new Date(tenantReviewContract.endDate).getFullYear(), new Date(tenantReviewContract.endDate).getMonth(), new Date(tenantReviewContract.endDate).getDate());
                                        const diffDays = Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24));
                                        if (diffDays > 0) return `เหลือ ${diffDays} วัน`;
                                      }
                                      return 'หมดอายุ';
                                    })()}
                                </span>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'pending' && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                                  (selectedTenant as any).status === 'revision_requested'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}>
                                  <Clock className={`w-3 h-3 ${(selectedTenant as any).status === 'revision_requested' ? 'text-rose-600' : 'text-amber-600'}`} />
                                  {(selectedTenant as any).status === 'revision_requested' ? 'กรุณาตรวจสอบอีกครั้ง' : 'รออนุมัติคำขอผู้เช่า'}
                                </span>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'inactive' && (
                                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <XCircle className="w-3 h-3 text-rose-500" />
                                  เลิกเช่าแล้ว
                                </span>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'active' && (
                                <>
                                  {!isTenantLineBound(selectedTenant) ? (
                                    <span
                                      data-testid="header-badge-unbound-line"
                                      className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                      ยังไม่ผูก LINE
                                    </span>
                                  ) : (
                                    <span
                                      data-testid="header-badge-bound-line"
                                      className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                                    >
                                      <LineIcon className="w-3 h-3 text-[#06C755]" />
                                      ผูก LINE แล้ว
                                    </span>
                                  )}
                                  {getRentalTypeLabel(selectedTenant, contracts) && (
                                    <span
                                      data-testid="header-badge-rental-type"
                                      className="bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    >
                                      {getRentalTypeLabel(selectedTenant, contracts)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">เลขบัตรประชาชน: {formatCitizenId(selectedTenant.citizenId)}</p>
                            <p className="text-[11px] sm:text-xs text-indigo-600 font-extrabold mt-0.5">
                              {isExpiredContractReview
                                ? `ห้อง ${getRoomNumber(selectedTenant.id)} (เลิกเช่า หรือ ต่อสัญญา)`
                                : getTenantCategory(selectedTenant) === 'pending'
                                  ? 'สถานะ: รอทำสัญญาและส่งมอบห้อง'
                                  : getTenantCategory(selectedTenant) === 'inactive'
                                    ? 'สถานะ: สิ้นสุดสัญญาเช่าแล้ว'
                                    : `ห้องพักปัจจุบัน: ห้อง ${getRoomNumber(selectedTenant.id)}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap justify-end">
                          {activeStatusTab === 'active' && !isExpiredContractReview && (
                            <button
                              onClick={() => handleOpenEditModal(selectedTenant)}
                              className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-all cursor-pointer shrink-0"
                            >
                              แก้ไขข้อมูล
                            </button>
                          )}

                          {isExpiredContractReview ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenRenewContract(tenantReviewContract, selectedTenant)}
                                className="px-3.5 py-1.5 bg-transparent hover:bg-amber-50 active:scale-95 text-amber-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-amber-400 shadow-3xs"
                                title="ต่ออายุสัญญาเช่า"
                              >
                                <RotateCw className="w-3.5 h-3.5 text-amber-600" />
                                <span>ต่อสัญญา</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenTerminate(selectedTenant)}
                                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                                title="ทำเรื่องเลิกเช่า คืนห้องพัก และจัดการเงินประกัน"
                              >
                                <LogOut className="w-3.5 h-3.5 text-white" />
                                <span>เลิกเช่า</span>
                              </button>
                            </>
                          ) : getTenantCategory(selectedTenant) === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenReject(selectedTenant)}
                                className="px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                title="ปฏิเสธคำขอเช่า"
                              >
                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>ปฏิเสธคำขอ</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenApprove(selectedTenant)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                                title="อนุมัติคำขอเช่า"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                <span>อนุมัติคำขอ</span>
                              </button>
                            </>
                          ) : getTenantCategory(selectedTenant) === 'active' ? (
                            <button
                              type="button"
                              onClick={() => handleOpenTerminate(selectedTenant)}
                              className="px-3 py-1.5 font-bold text-xs rounded-xl transition-all shrink-0 border bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                              title="ทำเรื่องเลิกเช่าคืนห้องพัก"
                            >
                              <LogOut className="w-3.5 h-3.5 text-rose-600" />
                              <span>เลิกเช่า</span>
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Tabs Selector */}
                <div className="mt-4 border-b border-gray-100">
                  {(() => {
                    const hasIdCard = !!(
                      selectedTenant.idCardPhotoMock &&
                      selectedTenant.idCardPhotoMock.trim() !== '' &&
                      selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
                    );

                    return (
                      <div className="grid grid-cols-3 gap-1 text-xs">
                        <button
                          onClick={() => setProfileTab('info')}
                          className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'info'
                              ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                              : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          <User className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate sm:hidden">ข้อมูลส่วนตัว</span>
                          <span className="hidden sm:inline">ข้อมูลส่วนตัวและเพิ่มเติม</span>
                          {!hasIdCard && (
                            <span
                              className="w-4 h-4 rounded-full bg-amber-500 text-white font-black text-[10px] flex items-center justify-center shrink-0 shadow-2xs"
                              title="ยังไม่ได้อัปโหลดสำเนาบัตรประจำตัวประชาชน"
                            >
                              !
                            </span>
                          )}
                        </button>

                        <button
                          onClick={() => setProfileTab('contract')}
                          className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'contract'
                              ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                              : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">สัญญาเช่า</span>
                          {(() => {
                            const count = (contracts || []).filter(c => c.tenantId === selectedTenant.id).length;
                            return count > 0 ? (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold shrink-0 ${profileTab === 'contract' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                {count}
                              </span>
                            ) : null;
                          })()}
                        </button>

                        <button
                          onClick={() => setProfileTab('history')}
                          className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'history'
                              ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                              : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate sm:hidden">ผู้พักร่วม</span>
                          <span className="hidden sm:inline">ประวัติผู้พักร่วม</span>
                          {(() => {
                            const count = (selectedTenant.coOccupants || []).length;
                            return count > 0 ? (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold shrink-0 ${profileTab === 'history' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                {count}
                              </span>
                            ) : null;
                          })()}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Content Panel */}
                <div className="py-6 overflow-y-auto max-h-[420px] pr-1">

                  {profileTab === 'info' && (
                    <div className="space-y-5">
                      {/* General Contact */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                        <div className="flex flex-col gap-1 text-left">
                          <span className="text-gray-400 font-bold text-[10px] uppercase tracking-wider">เบอร์โทรศัพท์มือถือ</span>
                          <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm">
                            <Phone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="break-all">{formatPhone(selectedTenant.phone)}</span>
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 text-left min-w-0">
                          <span className="text-gray-400 font-bold text-[10px] uppercase tracking-wider">อีเมลติดต่อ</span>
                          <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                            <Mail className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="break-all truncate" title={selectedTenant.email}>{selectedTenant.email || 'ไม่มีข้อมูล'}</span>
                          </p>
                        </div>
                      </div>

                      {/* Emergency Contact */}
                      <div className="pt-4 border-t border-gray-100 space-y-2.5">
                        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                          ข้อมูลผู้ติดต่อกรณีฉุกเฉิน
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">ชื่อผู้ติดต่อ:</span>
                            <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact?.name || '-'}</p>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">ความสัมพันธ์:</span>
                            <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact?.relationship || '-'}</p>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">เบอร์โทรติดต่อ:</span>
                            <p className="font-extrabold text-indigo-600 text-[11px] sm:text-xs break-all">{formatPhone(selectedTenant.emergencyContact?.phone) || '-'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Vehicles and Pets */}
                      <div className="pt-4 border-t border-gray-100">
                        {(() => {
                          const allVehicles: VehicleItem[] = selectedTenant.vehicles && selectedTenant.vehicles.length > 0
                            ? selectedTenant.vehicles.filter(v => v.type !== 'none')
                            : (selectedTenant.vehicle && selectedTenant.vehicle.type !== 'none' ? [selectedTenant.vehicle] : []);

                          const allPets: PetItem[] = selectedTenant.pets && selectedTenant.pets.length > 0
                            ? selectedTenant.pets.filter(p => (p.type && p.type.trim() !== '') || (p.name && p.name.trim() !== ''))
                            : (selectedTenant.pet && selectedTenant.pet.hasPet ? [selectedTenant.pet] : []);

                          const maxRows = Math.max(allVehicles.length, allPets.length, 1);

                          const renderVehicleItem = (veh: VehicleItem, vIdx: number) => (
                            <div key={veh.id || vIdx} className="space-y-1 text-[11px]">
                              {allVehicles.length > 1 && (
                                <div className="text-[10px] font-bold text-emerald-800 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  คันที่ {vIdx + 1}: {veh.type === 'car' ? 'รถยนต์' : 'จักรยานยนต์'}
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ประเภท:</span>
                                  <span className="font-bold text-slate-700">{veh.type === 'car' ? 'รถยนต์' : 'จักรยานยนต์'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ทะเบียน:</span>
                                  <span className="font-extrabold text-slate-800">{veh.licensePlate || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ยี่ห้อ / รุ่น:</span>
                                  <span className="font-medium text-slate-600">{veh.brand || '-'}</span>
                                </div>
                              </div>
                            </div>
                          );

                          const renderPetItem = (petItem: PetItem, pIdx: number) => (
                            <div key={petItem.id || pIdx} className="space-y-1 text-[11px]">
                              {allPets.length > 1 && (
                                <div className="text-[10px] font-bold text-rose-800 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                  สัตว์เลี้ยงตัวที่ {pIdx + 1}
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ประเภทสัตว์:</span>
                                  <span className="font-bold text-slate-700">
                                    {((petItem.type === 'อื่นๆ' || petItem.type === 'Other' || !petItem.type) && petItem.customType?.trim())
                                      ? petItem.customType.trim()
                                      : (petItem.type || petItem.customType || '-')}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ชื่อสัตว์เลี้ยง:</span>
                                  <span className="font-extrabold text-slate-800">{petItem.name || '-'}</span>
                                </div>
                              </div>
                            </div>
                          );

                          return (
                            <>
                              {/* DESKTOP & TABLET VIEW: Perfectly Synchronized Rows */}
                              <div className="hidden md:block space-y-2.5">
                                <div className="grid grid-cols-2 gap-6">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                                      ข้อมูลยานพาหนะ
                                    </span>
                                    {allVehicles.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                                        {allVehicles.length} คัน
                                      </span>
                                    )}
                                  </h4>
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Heart className="w-4 h-4 text-rose-600 shrink-0" />
                                      การขอเลี้ยงสัตว์เลี้ยง
                                    </span>
                                    {allPets.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full border border-rose-100">
                                        {allPets.length} ตัว
                                      </span>
                                    )}
                                  </h4>
                                </div>

                                <div className="space-y-2.5">
                                  {Array.from({ length: maxRows }).map((_, idx) => {
                                    const veh = allVehicles[idx];
                                    const pet = allPets[idx];

                                    return (
                                      <div
                                        key={idx}
                                        className={`grid grid-cols-2 gap-6 items-start ${idx > 0 ? 'pt-2.5 border-t border-gray-100' : ''}`}
                                      >
                                        {/* Left Vehicle */}
                                        {veh ? (
                                          renderVehicleItem(veh, idx)
                                        ) : idx === 0 && allVehicles.length === 0 ? (
                                          <p className="text-gray-400 text-[11px] italic">ไม่มีประวัติครอบครองยานพาหนะ</p>
                                        ) : (
                                          <div />
                                        )}

                                        {/* Right Pet */}
                                        {pet ? (
                                          renderPetItem(pet, idx)
                                        ) : idx === 0 && allPets.length === 0 ? (
                                          <p className="text-gray-400 text-[11px] italic">ไม่ได้ขอเลี้ยงสัตว์เลี้ยงภายในห้องพัก</p>
                                        ) : (
                                          <div />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* MOBILE VIEW: Clean Stacked Sections */}
                              <div className="block md:hidden space-y-4">
                                {/* Vehicle Section */}
                                <div className="space-y-2.5">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                                      ข้อมูลยานพาหนะ
                                    </span>
                                    {allVehicles.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                                        {allVehicles.length} คัน
                                      </span>
                                    )}
                                  </h4>
                                  {allVehicles.length > 0 ? (
                                    <div className="space-y-2 divide-y divide-gray-100">
                                      {allVehicles.map((veh, vIdx) => (
                                        <div key={veh.id || vIdx} className={vIdx > 0 ? 'pt-2' : ''}>
                                          {renderVehicleItem(veh, vIdx)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-gray-400 text-[11px] italic">ไม่มีประวัติครอบครองยานพาหนะ</p>
                                  )}
                                </div>

                                {/* Pet Section */}
                                <div className="space-y-2.5 pt-3 border-t border-gray-100">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Heart className="w-4 h-4 text-rose-600 shrink-0" />
                                      การขอเลี้ยงสัตว์เลี้ยง
                                    </span>
                                    {allPets.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full border border-rose-100">
                                        {allPets.length} ตัว
                                      </span>
                                    )}
                                  </h4>
                                  {allPets.length > 0 ? (
                                    <div className="space-y-2 divide-y divide-gray-100">
                                      {allPets.map((pet, pIdx) => (
                                        <div key={pet.id || pIdx} className={pIdx > 0 ? 'pt-2' : ''}>
                                          {renderPetItem(pet, pIdx)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-gray-400 text-[11px] italic">ไม่ได้ขอเลี้ยงสัตว์เลี้ยงภายในห้องพัก</p>
                                  )}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Important Document History */}
                      <div className="pt-4 border-t border-gray-100 text-xs space-y-3">
                        <h4 className="font-bold text-slate-800">ประวัติเอกสารสำคัญ</h4>
                        {(() => {
                          const hasIdCard = !!(
                            selectedTenant.idCardPhotoMock &&
                            selectedTenant.idCardPhotoMock.trim() !== '' &&
                            selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
                          );
                          return (
                            <div
                              onClick={() => {
                                if (hasIdCard) {
                                  setIsIdCardOpen(true);
                                } else {
                                  idCardInputRef.current?.click();
                                }
                              }}
                              className={`p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all group ${hasIdCard
                                  ? 'bg-slate-50/80 hover:bg-indigo-50/50 border border-transparent'
                                  : 'bg-amber-50/30 border border-amber-200/70 hover:bg-amber-50/60'
                                }`}
                              title={hasIdCard ? "คลิกเพื่อเปิดดูภาพสำเนาบัตรประชาชน" : "คลิกเพื่อเลือกไฟล์และอัปโหลดทันที"}
                            >
                              <input
                                ref={idCardInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleDirectIdCardUpload}
                                className="hidden"
                              />
                              <div className="flex gap-2.5 items-center min-w-0">
                                <FileText className={`w-4 h-4 ${hasIdCard ? 'text-indigo-600' : 'text-amber-500'} group-hover:scale-110 transition-transform shrink-0`} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-bold text-slate-800 text-[11px] group-hover:text-indigo-900 transition-colors">สำเนาบัตรประจำตัวประชาชน</p>
                                    {!hasIdCard && (
                                      <span
                                        className="w-3.5 h-3.5 rounded-full bg-amber-500 text-white font-black text-[9px] flex items-center justify-center shrink-0 shadow-2xs"
                                        title="ยังไม่ได้อัปโหลดสำเนาบัตรประจำตัวประชาชน"
                                      >
                                        !
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[9px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-1">
                                    <span>สถานะ: {hasIdCard ? 'ตรวจสอบและผ่านการรับรองแล้ว' : 'ยังไม่ได้อัปโหลดเอกสาร'}</span>
                                    <span className="text-[8px] text-indigo-600 underline font-bold group-hover:text-indigo-700">
                                      {hasIdCard ? '(คลิกเพื่อเปิดดูภาพ)' : '(คลิกเพื่ออัปโหลด)'}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              {hasIdCard ? (
                                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md shrink-0">
                                  อัปโหลดแล้ว
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 text-white font-black text-[7px] flex items-center justify-center shrink-0">
                                    !
                                  </span>
                                  <span>ยังไม่อัปโหลด</span>
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Lease Contracts */}
                        {(() => {
                          const tenantContracts = contracts || [];
                          const matchedContracts = tenantContracts.filter(c => c.tenantId === selectedTenant.id);
                          if (matchedContracts.length === 0) {
                            return (
                              <div className="p-3 bg-slate-50/50 rounded-xl text-center text-gray-400 text-[11px] italic">
                                ยังไม่มีหนังสือสัญญาเช่าในระบบ
                              </div>
                            );
                          }
                          return matchedContracts.map((con) => {
                            const rm = rooms.find(r => r.id === con.roomId);
                            const rmNum = rm ? rm.roomNumber : 'ไม่ระบุห้อง';
                            return (
                              <div
                                key={con.id}
                                onClick={() => {
                                  handleOpenPrintContract(con);
                                }}
                                className="p-3 bg-slate-50/80 hover:bg-indigo-50/50 rounded-xl flex items-center justify-between cursor-pointer transition-all group mt-2"
                                title="คลิกเพื่อเปิดดูรายละเอียดและพิมพ์สัญญาเช่า"
                              >
                                <div className="flex gap-2.5 items-center min-w-0">
                                  <FileText className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-bold text-slate-800 text-[11px] group-hover:text-indigo-900 transition-colors">
                                      หนังสือสัญญาเช่าเลขที่ {con.contractNumber}
                                    </p>
                                    <p className="text-[9px] text-gray-400 mt-0.5">
                                      ห้องพัก {rmNum} &bull; สัญญาเริ่มต้น: {formatThaiDate(con.startDate)} - {formatThaiDate(con.endDate)}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPrintContract(con);
                                  }}
                                  className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-0.5 group-hover:bg-indigo-100 transition-colors cursor-pointer"
                                >
                                  เปิดดูสัญญา &rarr;
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>

                    </div>
                  )}



                  {/* Contract Tab */}
                  {profileTab === 'contract' && (
                    <div className="space-y-4">
                      {/* Matched Contracts */}
                      {(() => {
                        const tenantContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);

                        if (tenantContracts.length === 0) {
                          return (
                            <div className="text-center py-12 bg-slate-50/70 rounded-2xl p-6 space-y-2">
                              <div className="w-10 h-10 bg-white rounded-xl border border-gray-100 flex items-center justify-center mx-auto text-gray-400">
                                <FileText className="w-5 h-5 text-indigo-400" />
                              </div>
                              <p className="font-bold text-slate-700 text-xs">ยังไม่มีประวัติสัญญาเช่าสำหรับผู้เช่ารายนี้</p>
                              <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                                สัญญาเช่าจะแสดงขึ้นเมื่อมีการทำสัญญาเช่าห้องพักสำหรับผู้เช่ารายนี้
                              </p>
                            </div>
                          );
                        }

                        // Sort active first, then newest
                        const sortedContracts = [...tenantContracts].sort((a, b) => {
                          if (a.status === 'active' && b.status !== 'active') return -1;
                          if (b.status === 'active' && a.status !== 'active') return 1;
                          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                        });

                        return (
                          <div className="divide-y divide-gray-100">
                            {sortedContracts.map((contract, index) => {
                              const matchedRoom = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
                              const roomDisplay = matchedRoom ? `ห้อง ${matchedRoom.roomNumber} (ชั้น ${matchedRoom.floor})` : `ห้อง ${contract.roomId}`;

                              const getExpiringLabel = () => {
                                if (contract.endDate) {
                                  const today = new Date();
                                  const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                  const endDay = new Date(new Date(contract.endDate).getFullYear(), new Date(contract.endDate).getMonth(), new Date(contract.endDate).getDate());
                                  const diffDays = Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24));
                                  return diffDays > 0 ? `เหลือ ${diffDays} วัน` : 'หมดอายุแล้ว';
                                }
                                return 'ใกล้หมดอายุ';
                              };

                              const statusMap: Record<string, { label: string; bg: string; text: string; border: string }> = {
                                active: { label: 'กำลังใช้งาน', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
                                expiring_soon: { label: getExpiringLabel(), bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
                                expired: { label: 'หมดอายุแล้ว', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
                                terminated: { label: 'เลิกสัญญาแล้ว', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
                              };
                              const statusInfo = statusMap[contract.status] || statusMap.active;

                              return (
                                <div
                                  key={contract.id}
                                  className={`space-y-3.5 ${index > 0 ? 'pt-5' : ''}`}
                                >
                                  {/* Contract Header */}
                                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-slate-900 text-sm">
                                          สัญญาเลขที่: {contract.contractNumber}
                                        </span>
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                                          {statusInfo.label}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-gray-500 font-medium">
                                        {roomDisplay} &bull; ทำสัญญาเมื่อ {formatThaiDate(contract.createdAt)}
                                      </p>
                                    </div>

                                    {/* Contract Actions Bar */}
                                    <div className="flex items-center gap-2 self-end sm:self-auto">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenPrintContract(contract)}
                                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                                        title="พิมพ์เอกสารสัญญาเช่า A4"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                        <span>พิมพ์สัญญา</span>
                                      </button>
                                      {activeStatusTab === 'active' && contract.status === 'active' && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenRenewContract(contract)}
                                          className="px-3 py-1.5 bg-transparent hover:bg-amber-50 active:scale-95 text-amber-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-amber-400 shadow-3xs"
                                          title="ต่ออายุสัญญาเช่า"
                                        >
                                          <RotateCw className="w-3.5 h-3.5 text-amber-600" />
                                          <span>ต่อสัญญา</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Contract Details - Flat Clean Layout without nested cards */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs py-1">
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">ระยะเวลาสัญญา</span>
                                      <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                        {formatThaiDate(contract.startDate)} - {formatThaiDate(contract.endDate)}
                                      </p>
                                      <p className="text-[11px] text-indigo-600 font-semibold">
                                        ระยะเวลา: {contract.durationMonths} เดือน
                                      </p>
                                    </div>

                                    <div className="space-y-1">
                                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">อัตราค่าเช่า & เงินประกัน</span>
                                      <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                        ค่าเช่า {formatBaht(contract.rentAmount)} / เดือน
                                      </p>
                                      <p className="text-[11px] text-slate-600 font-semibold flex items-center gap-1.5">
                                        <span>เงินประกัน {formatBaht(contract.depositAmount)}</span>
                                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${contract.depositStatus === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                          {contract.depositStatus === 'paid' ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
                                        </span>
                                      </p>
                                    </div>
                                  </div>

                                  {/* Terms snippet */}
                                  {contract.terms && (
                                    <div className="pt-2 text-xs">
                                      <p className="font-bold text-slate-700 text-[11px] mb-1">ข้อกำหนดสำคัญในสัญญา:</p>
                                      <p className="text-gray-600 text-[11px] leading-relaxed whitespace-pre-line bg-slate-50/70 p-3 rounded-xl">
                                        {contract.terms}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {profileTab === 'history' && (
                    <div className="space-y-6">
                      {(() => {
                        const isTenantInactive = activeStatusTab === 'inactive' || getTenantCategory(selectedTenant) === 'inactive';

                        return (
                          <>
                            {/* Active Co-occupants Section */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-800">
                                    {isTenantInactive ? 'ข้อมูลผู้พักร่วม' : 'ผู้พักร่วมปัจจุบัน'}
                                  </h4>
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                                    {(selectedTenant.coOccupants || []).length} คน
                                  </span>
                                </div>
                                {!isTenantInactive && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewCoName('');
                                      setNewCoPhone('');
                                      setNewCoRelationship('แฟน');
                                      setNewCoCustomRelationship('');
                                      setIsAddCoModalOpen(true);
                                    }}
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow-sm"
                                  >
                                    <UserPlus className="w-3.5 h-3.5" />
                                    <span>เพิ่มผู้พักร่วม</span>
                                  </button>
                                )}
                              </div>

                              {/* List of active co-occupants */}
                              {(selectedTenant.coOccupants || []).length > 0 ? (
                                <div className="space-y-2.5">
                                  {(selectedTenant.coOccupants || []).map((co, index) => (
                                    <div
                                      key={co.id || index}
                                      className="p-3.5 bg-white border border-gray-150 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs hover:border-indigo-200 transition-all"
                                    >
                                      <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className="font-bold text-slate-800 text-xs truncate">
                                            {co.name}
                                          </p>
                                          <span className="text-[9px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                                            คนที่ {index + 1}
                                          </span>
                                          {co.relationship && (
                                            <span className="text-[9px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                                              {co.relationship}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                          <span className="flex items-center gap-1">
                                            <Phone className="w-3 h-3 text-indigo-500 shrink-0" />
                                            <span>{formatPhone(co.phone)}</span>
                                          </span>
                                          {co.citizenId && (
                                            <span className="flex items-center gap-1 text-[10px] text-gray-400">
                                              <CreditCard className="w-3 h-3 text-slate-400 shrink-0" />
                                              <span>เลขบัตร: {co.citizenId}</span>
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-400 flex items-center gap-1 pt-0.5">
                                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                                          <span>วันที่บันทึกเข้าพัก: <strong className="text-slate-600 font-bold">{formatThaiDate(co.addedAt || selectedTenant.createdAt, true)}</strong></span>
                                        </div>
                                      </div>

                                      {!isTenantInactive && (
                                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCoToDelete(co);
                                              setDeleteCoReason('');
                                              setIsDeleteCoModalOpen(true);
                                            }}
                                            className="px-2.5 py-1 text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                                            title="นำผู้พักร่วมออกจากห้องพัก"
                                          >
                                            <UserMinus className="w-3 h-3" />
                                            <span>นำออก</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="p-4 bg-slate-50 border border-dashed border-gray-200 rounded-2xl text-center space-y-2">
                                  <p className="text-xs text-gray-500 font-medium">
                                    {isTenantInactive
                                      ? 'ไม่มีประวัติผู้พักร่วมที่บันทึกไว้ในสัญญา'
                                      : 'พักอาศัยเพียงท่านเดียว (ไม่มีผู้พักร่วมในปัจจุบัน)'}
                                  </p>
                                  {!isTenantInactive && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewCoName('');
                                        setNewCoPhone('');
                                        setNewCoRelationship('แฟน');
                                        setNewCoCustomRelationship('');
                                        setIsAddCoModalOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 cursor-pointer transition-all"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>บันทึกแจ้งผู้พักร่วม</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}

                      {/* History Timeline Section */}
                      <div className="space-y-3 pt-4 border-t border-gray-100">
                        {(() => {
                          const historyList = getEffectiveCoOccupantHistory(selectedTenant);

                          return (
                            <>
                              <div className="flex items-center justify-between">
                                <div>
                                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <History className="w-3.5 h-3.5 text-indigo-600" />
                                    ประวัติการเพิ่มและลบผู้พักร่วมย้อนหลัง
                                  </h4>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    บันทึกประวัติวันเดือนปีและเวลาเมื่อมีการเพิ่มหรือนำผู้พักร่วมออก
                                  </p>
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                                  {historyList.length} รายการ
                                </span>
                              </div>

                              {historyList.length > 0 ? (
                                <div className="divide-y divide-gray-100">
                                  {historyList.map((item, idx) => {
                                    const isAdded = item.action === 'added';
                                    const isOld = idx > 0;
                                    return (
                                      <div
                                        key={item.id || idx}
                                        className={`py-2.5 flex items-start justify-between gap-2 text-xs ${idx > 0 ? 'pt-2.5' : 'pt-1'
                                          }`}
                                      >
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span
                                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isOld
                                                  ? 'bg-slate-100 text-slate-600'
                                                  : isAdded
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                                    : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                                                }`}
                                            >
                                              {isAdded ? (
                                                <>
                                                  <UserPlus className={`w-3 h-3 ${isOld ? 'text-slate-500' : 'text-emerald-600'}`} />
                                                  <span>เพิ่มเข้าพัก</span>
                                                </>
                                              ) : (
                                                <>
                                                  <UserMinus className={`w-3 h-3 ${isOld ? 'text-slate-500' : 'text-rose-600'}`} />
                                                  <span>ลบออก / ย้ายออก</span>
                                                </>
                                              )}
                                            </span>
                                            <span className={`font-bold text-xs ${isOld ? 'text-slate-700' : isAdded ? 'text-slate-900' : 'text-slate-800'}`}>
                                              {item.name}
                                            </span>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                                            <span>เบอร์โทร: <strong className={isOld ? 'text-slate-600' : 'text-slate-700'}>{formatPhone(item.phone)}</strong></span>
                                            {item.citizenId && (
                                              <span className="text-[10px] text-gray-400">
                                                เลขบัตร: {item.citizenId}
                                              </span>
                                            )}
                                          </div>

                                          {item.note && (
                                            <p className={`text-[10px] italic ${isOld ? 'text-slate-400' : 'text-slate-500'}`}>
                                              หมายเหตุ: {item.note}
                                            </p>
                                          )}
                                        </div>

                                        {/* Date and Time */}
                                        <div className="text-right shrink-0">
                                          <span
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${isOld
                                                ? 'text-slate-500 bg-slate-50'
                                                : isAdded
                                                  ? 'bg-emerald-50 text-emerald-800'
                                                  : 'bg-rose-50 text-rose-800'
                                              }`}
                                          >
                                            <Clock className={`w-3 h-3 ${isOld ? 'text-slate-400' : 'opacity-70'}`} />
                                            <span>{formatThaiDate(item.timestamp, true)}</span>
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-center py-6 text-xs text-gray-400 italic">
                                  ยังไม่มีประวัติการบันทึกหรือเปลี่ยนแปลงผู้พักร่วม
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 shrink-0">
                <span>จดบันทึกเข้าระบบเมื่อ: {selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : (selectedTenant.joinDate || '-')}</span>
                <span>รหัสบันทึก: {selectedTenant.id}</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-dashed border-gray-200 rounded-3xl h-[700px] flex flex-col justify-center items-center p-6 text-center text-gray-400">
              <User className="w-12 h-12 text-gray-300 mb-3" />
              <h4 className="text-sm font-bold text-slate-700">ไม่มีผู้เช่าถูกเลือกในขณะนี้</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">กรุณาเลือกชื่อผู้เช่าในเมนูด้านซ้าย เพื่อตรวจสอบประวัติรายบุคคล</p>
            </div>
          )}
        </div>
      </div>

      {/* Thai National ID Card Viewer Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isIdCardOpen}
          onClose={() => setIsIdCardOpen(false)}
          title="เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า"
          size="md"
        >
          <div className="flex flex-col items-center justify-center p-1 sm:p-4 space-y-4">

            {(() => {
              const hasPhoto = !!(
                selectedTenant.idCardPhotoMock &&
                selectedTenant.idCardPhotoMock.trim() !== '' &&
                selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
              );

              return (
                <>
                  {hasPhoto ? (
                    <div className="w-full max-w-[420px] bg-slate-50 border border-gray-200 rounded-2xl overflow-hidden p-2 relative shadow-md group">
                      <img
                        src={selectedTenant.idCardPhotoMock}
                        alt="เอกสารประจำตัวผู้เช่า"
                        className="w-full h-auto max-h-[280px] object-contain rounded-lg mx-auto bg-white"
                      />
                      <div className="absolute top-4 right-4 bg-emerald-600 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>เอกสารจริงจากระบบ</span>
                      </div>

                      {/* Direct change / delete buttons */}
                      <div className="mt-2.5 pt-2 border-t border-gray-200 flex items-center justify-between px-1">
                        <label className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer transition-colors">
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>เปลี่ยนรูปภาพ</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleDirectIdCardUpload}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleDirectIdCardDelete}
                          className="text-[11px] font-bold text-rose-500 hover:text-rose-700 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>ลบรูปภาพ</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full max-w-[420px] p-8 border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-3xl bg-slate-50/60 hover:bg-indigo-50/20 transition-all flex flex-col items-center justify-center text-center space-y-3 relative group cursor-pointer">
                      <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center group-hover:scale-105 transition-transform">
                        <FileText className="w-7 h-7 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs sm:text-sm font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">ยังไม่ได้อัปโหลดไฟล์ภาพบัตรประชาชน</p>
                        <p className="text-[10px] text-gray-400">คุณสามารถแก้ไขข้อมูลผู้เช่า หรือคลิกที่นี่เพื่อทำการอัปโหลดไฟล์สำเนาจริงได้</p>
                        <p className="text-[9px] text-indigo-500 font-bold mt-1">คลิกหรือลากไฟล์มาวางเพื่ออัปโหลดทันที (PNG, JPG, WEBP)</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleDirectIdCardUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-2 w-full">
                    {/* Only show Print button when an image exists */}
                    {hasPhoto && (
                      <button
                        onClick={handlePrintIdCard}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>พิมพ์เอกสาร</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsIdCardOpen(false)}
                      className={`py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer text-center ${hasPhoto ? 'flex-1' : 'w-full'}`}
                    >
                      เสร็จสิ้น
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* Canonical Quick Add Tenant Modal (TERM / MONTHLY / DAILY) */}
      {quickAddModalOpen && selectedQuickAddContext && (
        <QuickAddTenantModal
          isOpen={quickAddModalOpen}
          onClose={() => {
            setQuickAddModalOpen(false);
            setSelectedQuickAddContext(null);
          }}
          context={selectedQuickAddContext}
          availableRooms={getTrulyVacantRooms(rooms, contracts || [], tenants)}
          onSelectRoom={handleSelectQuickAddRoom}
          hideLineTab={true}
          defaultTab="MONTHLY"
          onSuccess={handleQuickAddSuccess}
        />
      )}

      {false && (
        <div>

          {/* Step 0: General Info */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">ชื่อ-นามสกุล *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="เช่น นายนพดล มั่งมี"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">เลขประจำตัวประชาชน *</label>
                  <input
                    type="text"
                    required
                    maxLength={17}
                    value={formatCitizenIdInput(citizenId)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 13);
                      setCitizenId(clean);
                    }}
                    placeholder="เลข 13 หลัก"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์มือถือ *</label>
                  <input
                    type="tel"
                    required
                    maxLength={12}
                    value={formatPhoneInput(phone)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setPhone(clean);
                    }}
                    placeholder="เช่น 089-xxx-xxxx"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">อีเมลติดต่อ</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="เช่น user@gmail.com"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Co-occupants, Pets, Vehicles */}
          {currentStep === 1 && (
            <div className="space-y-6">

              {/* Emergency */}
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800">ผู้ติดต่อกรณีฉุกเฉิน *</h4>
                <div className="space-y-3">
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="ชื่อผู้ติดต่อ"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="ความสัมพันธ์"
                      value={emergencyRelation}
                      onChange={(e) => setEmergencyRelation(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                    <input
                      type="tel"
                      required
                      maxLength={12}
                      value={formatPhoneInput(emergencyPhone)}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setEmergencyPhone(clean);
                      }}
                      placeholder="เบอร์โทรศัพท์"
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Co-occupants builder */}
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800">เพิ่มรายชื่อผู้พักร่วมอาศัยด้วย</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    placeholder="ชื่อ - นามสกุล"
                    value={coName}
                    onChange={(e) => setCoName(e.target.value)}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium"
                  />
                  <input
                    type="tel"
                    placeholder="เบอร์โทรศัพท์"
                    maxLength={12}
                    value={formatPhoneInput(coPhone)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setCoPhone(clean);
                    }}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium"
                  />
                  <select
                    value={coRelationship}
                    onChange={(e) => {
                      setCoRelationship(e.target.value);
                      if (e.target.value !== 'อื่นๆ') setCoCustomRelationship('');
                    }}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium cursor-pointer"
                  >
                    {CO_OCCUPANT_RELATION_OPTIONS.map((rel) => (
                      <option key={rel} value={rel}>{rel}</option>
                    ))}
                  </select>
                </div>
                {coRelationship === 'อื่นๆ' && (
                  <div className="animate-in fade-in slide-in-from-top-1">
                    <input
                      type="text"
                      placeholder="ระบุสถานะความสัมพันธ์ เช่น ผู้ดูแล, เพื่อนร่วมงาน"
                      value={coCustomRelationship}
                      onChange={(e) => setCoCustomRelationship(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-indigo-200 bg-indigo-50/40 rounded-xl font-medium focus:outline-none focus:border-indigo-600"
                    />
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddCoOccupant}
                    disabled={!coName.trim() || !coPhone.trim() || (coRelationship === 'อื่นๆ' && !coCustomRelationship.trim())}
                    className={`px-3 py-1.5 font-bold text-[10px] rounded-lg transition-all ${coName.trim() && coPhone.trim() && (coRelationship !== 'อื่นๆ' || coCustomRelationship.trim())
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                        : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    เพิ่มผู้ร่วมตึก
                  </button>
                </div>
                {coOccupants.length > 0 && (
                  <div className="space-y-1.5 pt-2 max-h-24 overflow-y-auto">
                    {coOccupants.map((c) => (
                      <div key={c.id} className="flex justify-between items-center bg-white p-2 border border-gray-100 rounded-xl text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800">{c.name}</span>
                          <span className="text-gray-500">({formatPhone(c.phone)})</span>
                          {c.relationship && (
                            <span className="text-[9px] text-purple-700 bg-purple-50 px-1.5 py-0.2 border border-purple-100 rounded font-medium">
                              {c.relationship}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={() => handleRemoveCoOccupant(c.id)} className="text-rose-500 font-bold hover:text-rose-700 cursor-pointer">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pets / Vehicles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-semibold text-slate-700">ขออนุญาตนำสัตว์เลี้ยงเข้าพัก</label>
                    {(() => {
                      let pPolicy = dorm?.petPolicy;
                      if (!pPolicy) {
                        try {
                          const saved = localStorage.getItem('registered_dorm_profile');
                          if (saved) pPolicy = JSON.parse(saved).petPolicy;
                        } catch { }
                      }
                      const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                      return isAllowed ? (
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md">
                          อนุญาตตามเงื่อนไข
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                          ไม่อนุญาตให้เลี้ยง
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    let pPolicy = dorm?.petPolicy;
                    if (!pPolicy) {
                      try {
                        const saved = localStorage.getItem('registered_dorm_profile');
                        if (saved) pPolicy = JSON.parse(saved).petPolicy;
                      } catch { }
                    }
                    const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                    if (!isAllowed) {
                      return (
                        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 mt-1">
                          <Dog className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-amber-900">ไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด</p>
                            <p className="text-[10px] text-amber-700 mt-0.5">ตามตั้งค่าระเบียบหอพักที่ลงทะเบียนไว้</p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={hasPet}
                            onChange={(e) => setHasPet(e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs text-slate-600">มีสัตว์เลี้ยงประสงค์นำเข้า</span>
                        </div>
                        {hasPet && (
                          <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={petType}
                                onChange={(e) => {
                                  setPetType(e.target.value);
                                  if (e.target.value !== 'อื่นๆ') setCustomPetType('');
                                }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                              >
                                <option value="">-- เลือกประเภทสัตว์เลี้ยง --</option>
                                {PET_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="ชื่อน้อง"
                                value={petName}
                                onChange={(e) => setPetName(e.target.value)}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                              />
                            </div>
                            {petType === 'อื่นๆ' && (
                              <div className="animate-in fade-in slide-in-from-top-1 space-y-1">
                                <label className="block text-[10px] font-bold text-indigo-700">ระบุประเภทสัตว์เลี้ยง *</label>
                                <input
                                  type="text"
                                  placeholder="ระบุประเภท เช่น เต่า, เม่นแคระ, กิ้งก่า, ชูการ์ไกลเดอร์"
                                  value={customPetType}
                                  onChange={(e) => setCustomPetType(e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs text-slate-800 font-medium placeholder:text-gray-400 focus:outline-indigo-500 shadow-2xs"
                                  autoFocus
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">ยานพาหนะครอบครอง</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => {
                      setVehicleType(e.target.value as any);
                      setVehicleBrand(''); // Reset brand when changing vehicle type
                    }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-700"
                  >
                    <option value="none">ไม่มีพาหนะ</option>
                    <option value="motorcycle">รถจักรยานยนต์</option>
                    <option value="car">รถยนต์ส่วนบุคคล</option>
                  </select>
                  {vehicleType !== 'none' && (
                    <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                      <input
                        type="text"
                        placeholder="เลขทะเบียน"
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                      />
                      <select
                        value={vehicleBrand}
                        onChange={(e) => setVehicleBrand(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                      >
                        <option value="">-- เลือกยี่ห้อ --</option>
                        {vehicleType === 'car' && CAR_BRANDS.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                        {vehicleType === 'motorcycle' && MOTO_BRANDS.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                        {vehicleBrand && !(vehicleType === 'car' ? CAR_BRANDS : MOTO_BRANDS).includes(vehicleBrand) && (
                          <option value={vehicleBrand}>{vehicleBrand}</option>
                        )}
                      </select>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Step 2: Room Assignation */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">กรุณาเลือกห้องเช่าที่จะเข้าพัก (แสดงเฉพาะห้องว่าง) *</label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-700 font-bold"
              >
                <option value="">-- กรุณาเลือกห้องเช่า --</option>
                {rooms.filter(r => r.status === 'vacant').map(r => (
                  <option key={r.id} value={r.id}>ห้อง {r.roomNumber} (ค่าเช่า: {formatBaht(r.monthlyRent)})</option>
                ))}
              </select>

              {selectedRoomId && (
                <div className="p-4 bg-emerald-50 border border-emerald-150 rounded-2xl text-xs text-emerald-950 space-y-1 animate-in zoom-in-95">
                  <p className="font-bold">สรุปภาระการจ่ายเงินแรกเข้า:</p>
                  <p>&bull; ประกันความเสียหายห้องพัก: {formatBaht(rooms.find(r => r.id === selectedRoomId)?.depositAmount || 0)}</p>
                  <p>&bull; ค่าเช่าห้องล่วงหน้า 1 เดือน: {formatBaht(rooms.find(r => r.id === selectedRoomId)?.monthlyRent || 0)}</p>
                  <p className="font-extrabold text-indigo-700 mt-2">ยอดรวมจ่ายเงินมัดจำแรกเข้า: {formatBaht((rooms.find(r => r.id === selectedRoomId)?.depositAmount || 0) + (rooms.find(r => r.id === selectedRoomId)?.monthlyRent || 0))}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="pt-4 border-t border-gray-100 flex justify-between">
            <button
              type="button"
              disabled={currentStep === 0}
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium disabled:opacity-40"
            >
              ย้อนกลับ
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 rounded-xl text-xs font-medium"
              >
                ยกเลิก
              </button>
              {currentStep < 2 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl"
                >
                  ขั้นตอนถัดไป
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveTenant}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl"
                >
                  ยืนยันจดทะเบียนย้ายเข้า
                </button>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Lease Termination Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isTerminateOpen}
          onClose={() => !isSuccessAnimating && setIsTerminateOpen(false)}
          title={
            <div className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-rose-600" />
              <span>ทำเรื่องเลิกเช่าคืนห้องพัก - ห้อง {getRoomNumber(selectedTenant.id)}</span>
            </div>
          }
          size="xl"
          transparentBg={isSuccessAnimating}
          hideHeader={isSuccessAnimating}
          footer={!isSuccessAnimating ? (
            <div className="flex items-center justify-between w-full">
              <div className="text-[11px] text-gray-500 hidden sm:block">
                ตรวจสอบรายการค่าใช้จ่ายและการหักเงินประกันก่อนกดยืนยัน
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsTerminateOpen(false)}
                  className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer transition-all"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTerminate}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl cursor-pointer shadow-sm transition-all flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ยืนยันการเลิกเช่าคืนห้องพัก</span>
                </button>
              </div>
            </div>
          ) : undefined}
        >
          <div className={`space-y-4 text-xs ${isSuccessAnimating ? 'text-white' : 'text-slate-700'}`}>
            {isSuccessAnimating ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-12 px-4 space-y-5 text-center min-h-[350px]"
              >
                <div className="relative">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.2, 1] }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/50"
                  >
                    <motion.svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={4.5}
                      stroke="currentColor"
                      className="w-12 h-12 text-white"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.4, delay: 0.3, ease: "easeInOut" }}
                    >
                      <motion.path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </motion.svg>
                  </motion.div>
                  <motion.div
                    className="absolute -inset-4 bg-emerald-500/30 rounded-full -z-10"
                    animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
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
                    ระบบทำการคืนห้องพักห้อง {getRoomNumber(selectedTenant.id)} และอัปเดตสถานะสัญญาเรียบร้อยแล้ว
                  </motion.p>
                </div>
              </motion.div>
            ) : (
              <>
                {(() => {
                  const tContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);
                  const activeCon = tContracts.find(c => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out') || tContracts[0];
                  const rm = rooms.find(r => r.currentTenantId === selectedTenant.id || r.id === activeCon?.roomId);
                  const origDeposit = activeCon?.depositAmount ?? rm?.depositAmount ?? 0;
                  const totalDeductions = deductionItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
                  const netRefund = refundDeposit ? Math.max(0, origDeposit - totalDeductions) : 0;
                  const netExcess = refundDeposit ? Math.max(0, totalDeductions - origDeposit) : totalDeductions;

                  const PRESET_DEDUCTIONS = [
                    { title: 'ค่าทำความสะอาดห้องพัก', amount: 500 },
                    { title: 'ค่าน้ำประปาค้างชำระ', amount: 150 },
                    { title: 'ค่าไฟฟ้าค้างชำระ', amount: 450 },
                    { title: 'ค่าล้างเครื่องปรับอากาศ', amount: 500 },
                    { title: 'ค่าซ่อมแซม/ทาสีผนัง', amount: 600 },
                    { title: 'ค่ากุญแจ/คีย์การ์ดสูญหาย', amount: 300 }
                  ];

                  const handleAddPreset = (preset: { title: string; amount: number }) => {
                    setDeductionItems(prev => [
                      ...prev,
                      {
                        id: `deduct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        title: preset.title,
                        amount: preset.amount
                      }
                    ]);
                  };

                  const handleAddCustom = () => {
                    setDeductionItems(prev => [
                      ...prev,
                      {
                        id: `deduct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        title: '',
                        amount: ''
                      }
                    ]);
                  };

                  const handleUpdateItem = (id: string, field: 'title' | 'amount', val: string | number) => {
                    setDeductionItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
                  };

                  const handleRemoveItem = (id: string) => {
                    setDeductionItems(prev => prev.filter(it => it.id !== id));
                  };

                  return (
                    <div className="space-y-4">
                      {/* Section 1: Tenant & Stay Details */}
                      <div className="space-y-2.5 pb-4 border-b border-gray-100">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>ข้อมูลผู้เช่าและสัญญาห้อง {getRoomNumber(selectedTenant.id)}</span>
                          </h4>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80">
                            เงินประกันในสัญญา: {formatBaht(origDeposit)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-slate-800 pt-0.5">
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">ชื่อผู้เช่า:</p>
                            <p className="font-extrabold text-xs mt-0.5 truncate">{selectedTenant.name}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">เบอร์โทรศัพท์:</p>
                            <p className="font-extrabold text-xs mt-0.5">{formatPhone(selectedTenant.phone)}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">วันที่เริ่มเข้าพัก:</p>
                            <p className="font-extrabold text-xs mt-0.5">
                              {activeCon ? formatThaiDate(activeCon.startDate) : (selectedTenant.createdAt ? formatThaiDate(selectedTenant.createdAt.split('T')[0]) : (selectedTenant.joinDate ? formatThaiDate(selectedTenant.joinDate) : '-'))}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาที่อยู่อาศัย:</p>
                            <p className="font-extrabold text-xs text-indigo-700 mt-0.5">
                              {getStayDurationText(activeCon ? activeCon.startDate : (selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : (selectedTenant.joinDate || '')))}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Deposit Refund Choice (การจัดการเงินประกัน - ย้ายขึ้นมาแทนที่) */}
                      <div className="space-y-3 pb-5 border-b border-gray-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Coins className="w-4 h-4 text-indigo-600" />
                            <span className="font-bold text-slate-800 text-xs sm:text-sm">การจัดการเงินประกัน</span>
                          </div>
                          <span className="text-xs font-extrabold text-slate-800">
                            เงินประกัน: {formatBaht(origDeposit)}
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {/* Option 1: Refund Deposit (deduct from deposit) */}
                          <div
                            onClick={() => setRefundDeposit(true)}
                            className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${refundDeposit
                                ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                              }`}
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${refundDeposit ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                    <ShieldCheck className="w-4 h-4" />
                                  </div>
                                  <span className="font-bold text-xs text-slate-900">
                                    คืนเงินประกัน (นำมาหักลดค่าใช้จ่าย)
                                  </span>
                                </div>
                                <input
                                  type="radio"
                                  name="refundDepositOption"
                                  checked={refundDeposit}
                                  onChange={() => setRefundDeposit(true)}
                                  className="text-emerald-600 focus:ring-emerald-500 w-4 h-4 pointer-events-none"
                                />
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed pl-9">
                                นำเงินประกัน ({formatBaht(origDeposit)}) มาหักลดค่าใช้จ่าย หากเงินประกันเหลือ ผู้เช่าจะได้รับเงินคืนหลังเลิกเช่า หากค่าใช้จ่ายเกิน ผู้เช่าจ่ายเฉพาะส่วนต่าง
                              </p>
                            </div>
                          </div>

                          {/* Option 2: Forfeit Deposit */}
                          <div
                            onClick={() => setRefundDeposit(false)}
                            className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${!refundDeposit
                                ? 'border-rose-500 bg-rose-50/40 shadow-xs'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                              }`}
                          >
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${!refundDeposit ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500'
                                    }`}>
                                    <ShieldAlert className="w-4 h-4" />
                                  </div>
                                  <span className="font-bold text-xs text-slate-900">
                                    ไม่คืนเงินประกัน (ยึดเงินประกัน)
                                  </span>
                                </div>
                                <input
                                  type="radio"
                                  name="refundDepositOption"
                                  checked={!refundDeposit}
                                  onChange={() => setRefundDeposit(false)}
                                  className="text-rose-600 focus:ring-rose-500 w-4 h-4 pointer-events-none"
                                />
                              </div>
                              <p className="text-[11px] text-gray-500 leading-relaxed pl-9">
                                ยึดเงินประกันทั้งหมดตามเงื่อนไข ผู้เช่าจะไม่ได้รับเงินประกันคืน และต้องชำระค่าใช้จ่ายที่เกิดขึ้นแยกต่างหากเต็มจำนวน
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* If refunding and net refund is positive, prompt for bank/account info */}
                        {refundDeposit && origDeposit > totalDeductions && (
                          <div className="p-3 bg-slate-50 border border-gray-200 rounded-xl space-y-2.5 mt-2">
                            <span className="text-[11px] font-bold text-slate-700 block">
                              ช่องทางคืนเงินประกันให้ผู้เช่า (ยอดคืน: {formatBaht(origDeposit - totalDeductions)}):
                            </span>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setRefundMethod('promptpay')}
                                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${refundMethod === 'promptpay'
                                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                                      : 'bg-white border-gray-200 text-gray-600'
                                    }`}
                                >
                                  พร้อมเพย์
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRefundMethod('bank_transfer')}
                                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${refundMethod === 'bank_transfer'
                                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                                      : 'bg-white border-gray-200 text-gray-600'
                                    }`}
                                >
                                  โอนธนาคาร
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRefundMethod('cash')}
                                  className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-bold border transition-all cursor-pointer ${refundMethod === 'cash'
                                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                                      : 'bg-white border-gray-200 text-gray-600'
                                    }`}
                                >
                                  เงินสด
                                </button>
                              </div>
                              <input
                                type="text"
                                value={refundAccountInfo}
                                onChange={(e) => setRefundAccountInfo(e.target.value)}
                                placeholder={
                                  refundMethod === 'promptpay'
                                    ? 'เบอร์พร้อมเพย์ หรือเลขบัตร ปชช.'
                                    : refundMethod === 'bank_transfer'
                                      ? 'ระบุชื่อธนาคาร และเลขที่บัญชี'
                                      : 'หมายเหตุการจ่ายเงินสด (ถ้ามี)'
                                }
                                className="px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-slate-800"
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section 3: Itemized Deductions (รายการค่าใช้จ่าย / ค่าเสียหายที่ต้องหักก่อนออก) */}
                      <div className="space-y-3 pb-5 border-b border-gray-100">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Receipt className="w-4 h-4 text-indigo-600" />
                            <span className="font-bold text-slate-800 text-xs sm:text-sm">
                              รายการค่าใช้จ่าย / ค่าเสียหายที่ต้องหักก่อนออก
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {deductionItems.length} รายการ
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddCustom}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>เพิ่มรายการ</span>
                          </button>
                        </div>

                        {/* Quick Presets Chips */}
                        <div className="space-y-1.5 pt-0.5">
                          <span className="text-[10px] text-gray-400 font-semibold block">เลือกเพิ่มรายการด่วน:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {PRESET_DEDUCTIONS.map((preset, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleAddPreset(preset)}
                                className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-gray-200 hover:border-gray-300 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                              >
                                <Plus className="w-3 h-3 text-gray-400" />
                                <span>{preset.title} ({formatBaht(preset.amount)})</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Deductions List */}
                        <div className="space-y-2 pt-1">
                          {deductionItems.length === 0 ? (
                            <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl text-gray-400 space-y-1">
                              <p className="font-medium text-xs">ยังไม่มีรายการค่าใช้จ่ายหรือค่าเสียหาย</p>
                              <p className="text-[10px] text-gray-400">คลิกที่รายการด่วนด้านบน หรือกดปุ่ม "เพิ่มรายการ" เพื่อระบุค่าใช้จ่าย</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {deductionItems.map((item, idx) => (
                                <div key={item.id} className="flex items-center gap-2 p-2.5 bg-slate-50 border border-gray-100 rounded-xl">
                                  <span className="text-[10px] font-bold text-gray-400 w-4 text-center shrink-0">
                                    {idx + 1}
                                  </span>
                                  <input
                                    type="text"
                                    value={item.title}
                                    onChange={(e) => handleUpdateItem(item.id, 'title', e.target.value)}
                                    placeholder="ชื่อรายการ เช่น ค่าทำความสะอาดห้องน้ำ, รอยเจาะผนัง"
                                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium text-slate-800 min-w-0"
                                  />
                                  <div className="flex items-center gap-1 w-32 sm:w-36 shrink-0">
                                    <input
                                      type="number"
                                      min="0"
                                      value={item.amount}
                                      onChange={(e) => handleUpdateItem(item.id, 'amount', e.target.value)}
                                      placeholder="0"
                                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right font-bold text-slate-800"
                                    />
                                    <span className="text-[11px] text-gray-500 font-medium shrink-0">บาท</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0"
                                    title="ลบรายการนี้"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {deductionItems.length > 0 && (
                            <div className="flex justify-between items-center px-3 py-2 bg-indigo-50/50 rounded-xl border border-indigo-100 font-bold text-xs">
                              <span className="text-slate-700">ยอดรวมค่าใช้จ่ายที่ต้องหักทั้งหมด:</span>
                              <span className="text-rose-600 text-sm font-extrabold">{formatBaht(totalDeductions)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Section 4: Live Real-time Settlement Summary (สรุปการคำนวณการเงิน) */}
                      <div className="bg-slate-50 border border-gray-200 rounded-2xl p-4 space-y-3">
                        <span className="font-bold text-slate-800 text-xs uppercase tracking-wider block">
                          สรุปยอดการเงินก่อนยืนยันเลิกเช่า
                        </span>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between items-center text-slate-600">
                            <span>เงินประกันสัญญา:</span>
                            <span className="font-bold text-slate-800">+{formatBaht(origDeposit)}</span>
                          </div>
                          <div className="flex justify-between items-center text-slate-600">
                            <span>ยอดรวมค่าใช้จ่ายที่ต้องหัก ({deductionItems.length} รายการ):</span>
                            <span className="font-bold text-rose-600">
                              {totalDeductions > 0 ? `-${formatBaht(totalDeductions)}` : '0 บาท'}
                            </span>
                          </div>
                        </div>

                        {/* Result Highlight Box */}
                        {refundDeposit ? (
                          origDeposit >= totalDeductions ? (
                            <div className="p-3.5 bg-emerald-500/10 border border-emerald-300 rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-emerald-950 text-xs sm:text-sm">
                                    ผู้เช่าจะได้รับเงินคืนหลังเลิกเช่า
                                  </p>
                                  <p className="text-[11px] text-emerald-700 font-medium">
                                    เงินประกันหักค่าใช้จ่ายครบถ้วนแล้ว มียอดเงินประกันคงเหลือคืนให้ผู้เช่า
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-black text-emerald-700 text-base sm:text-xl block">
                                  +{formatBaht(origDeposit - totalDeductions)}
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold">ยอดโอนคืนสุทธิ</span>
                              </div>
                            </div>
                          ) : (
                            <div className="p-3.5 bg-amber-500/10 border border-amber-300 rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-amber-950 text-xs sm:text-sm">
                                    เงินประกันช่วยลดค่าใช้จ่ายแล้ว (ผู้เช่าต้องชำระเพิ่ม)
                                  </p>
                                  <p className="text-[11px] text-amber-700 font-medium">
                                    นำเงินประกัน {formatBaht(origDeposit)} มาหักลดค่าใช้จ่ายจนหมด ผู้เช่าต้องชำระส่วนเกินเพิ่ม
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-black text-amber-800 text-base sm:text-xl block">
                                  {formatBaht(totalDeductions - origDeposit)}
                                </span>
                                <span className="text-[10px] text-amber-600 font-semibold">ออกบิลเรียกเก็บ</span>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="p-3.5 bg-rose-500/10 border border-rose-300 rounded-xl flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                              <div>
                                <p className="font-extrabold text-rose-950 text-xs sm:text-sm">
                                  ยึดเงินประกันทั้งหมด (ไม่คืนเงินประกัน)
                                </p>
                                <p className="text-[11px] text-rose-700 font-medium">
                                  ผู้เช่าไม่ได้รับเงินประกันคืน และต้องชำระยอดค่าใช้จ่ายทั้งหมด
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-rose-700 text-base sm:text-xl block">
                                {formatBaht(totalDeductions)}
                              </span>
                              <span className="text-[10px] text-rose-600 font-semibold">ยอดต้องชำระ</span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Section 5: Additional Notes */}
                      <div className="space-y-1">
                        <label className="block text-[11px] font-bold text-slate-700" htmlFor="addNoteInput">
                          หมายเหตุบันทึกเพิ่มเติม (ถ้ามี)
                        </label>
                        <textarea
                          id="addNoteInput"
                          value={additionalNote}
                          onChange={(e) => setAdditionalNote(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 h-16 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="ระบุสภาพห้องพัก, วันที่ส่งมอบกุญแจ, หรือข้อตกลงเพิ่มเติม..."
                        />
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Edit Tenant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title={`แก้ไขข้อมูลผู้เช่า - ห้อง ${getRoomNumber(selectedTenant.id)}`}
          size="lg"
        >
          <form onSubmit={handleSaveEditTenant} className="space-y-4">
            {errorText && (
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold border border-rose-100">
                {errorText}
              </div>
            )}

            <div className="max-h-[480px] overflow-y-auto pr-1 space-y-4 pb-2">
              {/* Personal Info */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-600" />
                  ข้อมูลผู้เช่าหลัก
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">ชื่อ-นามสกุล *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">บัตรประจำตัวประชาชน *</label>
                    <input
                      type="text"
                      required
                      maxLength={17}
                      value={formatCitizenIdInput(citizenId)}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 13);
                        setCitizenId(clean);
                      }}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">เบอร์โทรศัพท์ติดต่อ *</label>
                    <input
                      type="tel"
                      required
                      maxLength={12}
                      value={formatPhoneInput(phone)}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setPhone(clean);
                      }}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">อีเมลติดต่อ (ถ้ามี)</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  ผู้ติดต่อกรณีฉุกเฉิน
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">ชื่อผู้ติดต่อ *</label>
                    <input
                      type="text"
                      required
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-700">ความสัมพันธ์</label>
                      <input
                        type="text"
                        value={emergencyRelation}
                        onChange={(e) => setEmergencyRelation(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-700">เบอร์โทรศัพท์ *</label>
                      <input
                        type="tel"
                        required
                        maxLength={12}
                        value={formatPhoneInput(emergencyPhone)}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setEmergencyPhone(clean);
                        }}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pets / Vehicles */}
              <div className="pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Pet Section */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-slate-700">ขอเลี้ยงสัตว์เลี้ยง</label>
                    {(() => {
                      let pPolicy = dorm?.petPolicy;
                      if (!pPolicy) {
                        try {
                          const saved = localStorage.getItem('registered_dorm_profile');
                          if (saved) pPolicy = JSON.parse(saved).petPolicy;
                        } catch { }
                      }
                      const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                      return isAllowed ? (
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md">
                          อนุญาตตามเงื่อนไข
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                          ไม่อนุญาตให้เลี้ยง
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    let pPolicy = dorm?.petPolicy;
                    if (!pPolicy) {
                      try {
                        const saved = localStorage.getItem('registered_dorm_profile');
                        if (saved) pPolicy = JSON.parse(saved).petPolicy;
                      } catch { }
                    }
                    const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                    if (!isAllowed) {
                      return (
                        <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 mt-1">
                          <Dog className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs font-bold text-amber-900">ไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด</p>
                            <p className="text-[10px] text-amber-700 mt-0.5">ตามตั้งค่าระเบียบหอพักที่ลงทะเบียนไว้</p>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="hasPetEdit"
                            checked={hasPet}
                            onChange={(e) => {
                              setHasPet(e.target.checked);
                              if (e.target.checked && petsList.length === 0) {
                                setPetsList([{ id: '1', type: '', name: '' }]);
                              }
                            }}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label htmlFor="hasPetEdit" className="text-xs font-bold text-slate-700 cursor-pointer">ประสงค์เลี้ยงสัตว์</label>
                        </div>
                        {hasPet && (
                          <div className="space-y-2 pt-1 animate-in slide-in-from-top-1">
                            {petsList.map((petItem, idx) => (
                              <div key={petItem.id || idx} className="p-2.5 bg-slate-50/80 rounded-xl space-y-2 relative border border-slate-200/80">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                    สัตว์เลี้ยงตัวที่ {idx + 1}
                                  </span>
                                  {petsList.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePet(idx)}
                                      className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
                                      title="ลบรายการนี้"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={petItem.type || ''}
                                    onChange={(e) => handlePetChange(idx, 'type', e.target.value)}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                                  >
                                    <option value="">-- ประเภท --</option>
                                    {PET_OPTIONS.map(opt => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                  <input
                                    type="text"
                                    placeholder="ชื่อน้อง"
                                    value={petItem.name || ''}
                                    onChange={(e) => handlePetChange(idx, 'name', e.target.value)}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                                  />
                                </div>
                                {petItem.type === 'อื่นๆ' && (
                                  <div className="animate-in fade-in slide-in-from-top-1 space-y-1">
                                    <label className="block text-[10px] font-bold text-indigo-700">ระบุประเภทสัตว์เลี้ยง *</label>
                                    <input
                                      type="text"
                                      placeholder="ระบุประเภท เช่น เต่า, เม่นแคระ, กิ้งก่า, ชูการ์ไกลเดอร์"
                                      value={petItem.customType || ''}
                                      onChange={(e) => handlePetChange(idx, 'customType', e.target.value)}
                                      className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs text-slate-800 font-medium placeholder:text-gray-400 focus:outline-indigo-500 shadow-2xs"
                                      autoFocus
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={handleAddPet}
                              className="w-full py-1.5 border border-dashed border-rose-300 hover:border-rose-500 bg-rose-50/50 hover:bg-rose-50 text-rose-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>เพิ่มสัตว์เลี้ยงอีก 1 รายการ</span>
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Vehicle Section */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-slate-700">ยานพาหนะครอบครอง</label>
                  </div>
                  <div className="space-y-2">
                    {vehiclesList.map((vehItem, idx) => (
                      <div key={vehItem.id || idx} className="p-2.5 bg-slate-50/80 rounded-xl space-y-2 relative border border-slate-200/80">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            คันที่ {idx + 1}
                          </span>
                          {vehiclesList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveVehicle(idx)}
                              className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
                              title="ลบรายการนี้"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <select
                          value={vehItem.type}
                          onChange={(e) => handleVehicleChange(idx, 'type', e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-700 font-bold"
                        >
                          <option value="none">ไม่มีพาหนะ</option>
                          <option value="motorcycle">รถจักรยานยนต์</option>
                          <option value="car">รถยนต์ส่วนบุคคล</option>
                        </select>
                        {vehItem.type !== 'none' && (
                          <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-1">
                            <input
                              type="text"
                              placeholder="เลขทะเบียน"
                              value={vehItem.licensePlate || ''}
                              onChange={(e) => handleVehicleChange(idx, 'licensePlate', e.target.value)}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                            />
                            <select
                              value={vehItem.brand || ''}
                              onChange={(e) => handleVehicleChange(idx, 'brand', e.target.value)}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                            >
                              <option value="">-- ยี่ห้อ --</option>
                              {vehItem.type === 'car' && CAR_BRANDS.map(b => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                              {vehItem.type === 'motorcycle' && MOTO_BRANDS.map(b => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                              {vehItem.brand && !(vehItem.type === 'car' ? CAR_BRANDS : MOTO_BRANDS).includes(vehItem.brand) && (
                                <option value={vehItem.brand}>{vehItem.brand}</option>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddVehicle}
                      className="w-full py-1.5 border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>เพิ่มยานพาหนะอีก 1 คัน</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* File Attachment / Document Upload */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    อัปโหลดรูปเอกสารประจำตัว (สำเนาบัตรประชาชน)
                  </label>
                  {idCardPhoto && (
                    <button
                      type="button"
                      onClick={() => setIdCardPhoto('')}
                      className="text-xs text-rose-500 hover:text-rose-700 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบรูปภาพ</span>
                    </button>
                  )}
                </div>

                {idCardPhoto ? (
                  <div className="relative border border-slate-200 rounded-2xl p-2.5 bg-slate-50 space-y-2">
                    <div className="w-full flex items-center justify-center bg-white rounded-xl border border-slate-200/80 p-2 overflow-hidden shadow-2xs">
                      <img
                        src={idCardPhoto}
                        alt="เอกสารประจำตัว"
                        className="w-full h-auto max-h-[380px] object-contain rounded-lg"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1 px-1">
                      <label className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs">
                        <Upload className="w-3.5 h-3.5 text-indigo-600" />
                        <span>เปลี่ยนรูปภาพ</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-2xl p-6 hover:bg-indigo-50/10 transition-all relative cursor-pointer">
                    <div className="text-center space-y-1.5 text-gray-400 pointer-events-none">
                      <FileText className="w-9 h-9 text-indigo-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">คลิกเพื่ออัปโหลด หรือลากไฟล์มาวาง</p>
                      <p className="text-[10px] text-gray-400">รองรับไฟล์ PNG, JPG, WEBP</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Modal Buttons */}
            {(() => {
              const origPets = selectedTenant?.pets && selectedTenant.pets.length > 0
                ? selectedTenant.pets
                : (selectedTenant?.pet?.hasPet ? [{ type: selectedTenant.pet.type || '', name: selectedTenant.pet.name || '' }] : []);
              const currentPets = hasPet ? petsList.filter(p => (p.type && p.type.trim() !== '') || (p.name && p.name.trim() !== '')) : [];
              const petsChanged = JSON.stringify(origPets.map(p => ({ type: p.type || '', name: p.name || '' }))) !==
                JSON.stringify(currentPets.map(p => ({ type: p.type || '', name: p.name || '' })));

              const origVehicles = selectedTenant?.vehicles && selectedTenant.vehicles.length > 0
                ? selectedTenant.vehicles.filter(v => v.type !== 'none')
                : (selectedTenant?.vehicle && selectedTenant.vehicle.type !== 'none' ? [selectedTenant.vehicle] : []);
              const currentVehicles = vehiclesList.filter(v => v.type !== 'none');
              const vehiclesChanged = JSON.stringify(origVehicles.map(v => ({ type: v.type, plate: v.licensePlate || '', brand: v.brand || '' }))) !==
                JSON.stringify(currentVehicles.map(v => ({ type: v.type, plate: v.licensePlate || '', brand: v.brand || '' })));

              const isFormChanged = selectedTenant ? (
                name.trim() !== selectedTenant.name ||
                phone.trim() !== selectedTenant.phone ||
                email.trim() !== (selectedTenant.email || '') ||
                citizenId.trim() !== selectedTenant.citizenId ||
                emergencyName.trim() !== selectedTenant.emergencyContact.name ||
                emergencyRelation.trim() !== selectedTenant.emergencyContact.relationship ||
                emergencyPhone.trim() !== selectedTenant.emergencyContact.phone ||
                petsChanged ||
                vehiclesChanged ||
                idCardPhoto !== (selectedTenant.idCardPhotoMock || '')
              ) : false;

              return (
                <div className="sticky bottom-0 -mx-6 -mb-6 p-5 bg-white border-t border-gray-100 flex justify-end gap-2 z-20 rounded-b-3xl shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
                  <button
                    type="button"
                    onClick={() => setIsEditOpen(false)}
                    className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={!isFormChanged}
                    className={`px-5 py-2 font-bold text-xs rounded-xl shadow-sm transition-all ${isFormChanged
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer animate-in fade-in duration-200'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                  >
                    บันทึกการแก้ไข
                  </button>
                </div>
              );
            })()}
          </form>
        </Modal>
      )}

      {/* Approve Tenant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isApproveOpen}
          onClose={() => setIsApproveOpen(false)}
          title="ยืนยันอนุมัติและรับผู้เช่าเข้าพัก"
          size="md"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base shrink-0">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-emerald-950">อนุมัติคุณ {selectedTenant.name}</h4>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  เบอร์โทร: {formatPhone(selectedTenant.phone)} • บัตรประชาชน: {formatCitizenId(selectedTenant.citizenId)}
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เลือกห้องพักที่ต้องการจัดสรร <span className="text-rose-500">*</span>
                </label>
                <select
                  value={approveRoomId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setApproveRoomId(rId);
                    const rm = rooms.find(r => r.id === rId);
                    if (rm) {
                      setApproveRent(String(rm.price || 0));
                      setApproveDeposit(String(rm.deposit || rm.price * 2 || 0));
                    }
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                >
                  <option value="">-- เลือกห้องพัก --</option>
                  {rooms.map(r => (
                    <option key={r.id} value={r.id}>
                      ห้อง {r.roomNumber} ({r.status === 'vacant' ? 'ห้องว่าง' : (selectedTenant && r.currentTenantId === selectedTenant.id) ? 'ระบุไว้แล้ว' : `มีผู้เช่า (${r.status})`}) - ฿{(r.price ?? 0).toLocaleString()}/ด.
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    วันที่เริ่มสัญญา / เข้าพัก
                  </label>
                  <input
                    type="date"
                    value={approveStartDate}
                    onChange={(e) => setApproveStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    ค่าเช่าต่อเดือน (บาท)
                  </label>
                  <input
                    type="number"
                    value={approveRent}
                    onChange={(e) => setApproveRent(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                    placeholder="เช่น 4500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  เงินประกันห้อง (บาท)
                </label>
                <input
                  type="number"
                  value={approveDeposit}
                  onChange={(e) => setApproveDeposit(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                  placeholder="เช่น 9000"
                />
              </div>
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsApproveOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmApprove}
                disabled={!approveRoomId}
                className={`px-5 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${approveRoomId
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>ยืนยันยอมรับและเข้าพัก</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Tenant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isRejectOpen}
          onClose={() => setIsRejectOpen(false)}
          title="ยืนยันการปฏิเสธคำขอเช่า"
          size="sm"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-rose-50/80 border border-rose-200/80 rounded-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-base shrink-0">
                <XCircle className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-rose-950">ปฏิเสธคำขอคุณ {selectedTenant.name}</h4>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  เบอร์โทร: {formatPhone(selectedTenant.phone)}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                เหตุผลในการปฏิเสธคำขอ
              </label>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold mb-2"
              >
                <option value="ข้อมูลเอกสารไม่ครบถ้วน">ข้อมูลเอกสารไม่ครบถ้วน</option>
                <option value="ห้องพักประเภทที่ต้องการเต็มแล้ว">ห้องพักประเภทที่ต้องการเต็มแล้ว</option>
                <option value="ไม่ผ่านเกณฑ์การพิจารณาเบื้องต้น">ไม่ผ่านเกณฑ์การพิจารณาเบื้องต้น</option>
                <option value="ผู้เช่ายกเลิกความประสงค์">ผู้เช่ายกเลิกความประสงค์</option>
                <option value="อื่นๆ">อื่นๆ</option>
              </select>

              {rejectReason === 'อื่นๆ' && (
                <input
                  type="text"
                  placeholder="ระบุเหตุผลเพิ่มเติม..."
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                />
              )}
            </div>

            <p className="text-[11px] text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
              สถานะของผู้เช่าจะถูกเปลี่ยนเป็น "เลิกเช่า/ยกเลิก" และระบบจะบันทึกประวัติการปฏิเสธไว้ในระบบ
            </p>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsRejectOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmReject}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <XCircle className="w-4 h-4" />
                <span>ยืนยันปฏิเสธ</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Print Contract Preview */}
      {isPrintContractModalOpen && selectedContractForPrint && (
        <Modal
          isOpen={isPrintContractModalOpen}
          onClose={() => {
            setIsPrintContractModalOpen(false);
            setSelectedContractForPrint(null);
          }}
          title={`พิมพ์สัญญาเช่าเลขที่ ${selectedContractForPrint.contractNumber}`}
          size="lg"
        >
          <div className="space-y-4">
            <PrintView title="หนังสือสัญญาเช่าห้องพัก">
              {(() => {
                const conTenant = tenants.find(t => t.id === selectedContractForPrint.tenantId) || selectedTenant;
                const conRoom = rooms.find(r => r.id === selectedContractForPrint.roomId || r.roomNumber === selectedContractForPrint.roomId);
                const tenantName = conTenant ? conTenant.name : 'ผู้เช่า';
                const roomNum = conRoom ? conRoom.roomNumber : selectedContractForPrint.roomId;
                const createdDate = selectedContractForPrint.createdAt ? selectedContractForPrint.createdAt.split('T')[0] : selectedContractForPrint.startDate;

                return (
                  <div className="space-y-6 text-xs text-slate-800 font-sans max-w-2xl mx-auto leading-relaxed bg-white p-4 sm:p-6 rounded-2xl">
                    <div className="text-center space-y-1 pb-4 border-b border-slate-100">
                      <h3 className="text-base font-extrabold text-slate-950 uppercase tracking-wide">หนังสือสัญญาเช่าที่พักอาศัย</h3>
                      <p className="text-slate-400 font-medium text-[10px]">สัญญาเลขที่: {selectedContractForPrint.contractNumber}</p>
                    </div>

                    <div className="space-y-4">
                      <p>
                        สัญญาฉบับนี้ทำขึ้น ณ <span className="font-extrabold text-slate-900">อาคารหอพัก {dorm.name || 'HorPlus'} ({dorm.address || 'ที่อยู่หอพัก'})</span> เมื่อวันที่ <span className="font-semibold">{formatThaiDate(createdDate)}</span> ระหว่าง
                        <span className="font-extrabold text-slate-900"> นิติบุคคล {dorm.name || 'HorPlus'} (ผู้ให้เช่า)</span> ฝ่ายหนึ่ง กับ
                        <span className="font-extrabold text-slate-900"> คุณ{tenantName} (ผู้เช่า)</span> อีกฝ่ายหนึ่ง โดยมีใจความดังเงื่อนไขต่อไปนี้:
                      </p>

                      <div className="bg-slate-50 p-4 border border-slate-100 rounded-2xl space-y-2.5">
                        <p>&bull; <span className="font-bold">ห้องพักตกลงเช่า:</span> ผู้เช่าตกลงเช่าห้องพักหมายเลข <span className="font-extrabold text-indigo-600">ห้อง {roomNum}</span> ของอาคาร</p>
                        <p>&bull; <span className="font-bold">ระยะเวลาสัญญาเช่า:</span> กำหนดเช่าอาศัย <span className="font-bold">{selectedContractForPrint.durationMonths} เดือน</span> เริ่มต้นตั้งแต่วันที่ <span className="font-bold">{formatThaiDate(selectedContractForPrint.startDate)}</span> ถึง วันที่ <span className="font-bold">{formatThaiDate(selectedContractForPrint.endDate)}</span></p>
                        <p>&bull; <span className="font-bold">ค่าเช่าและเงินประกัน:</span> อัตราค่าบริการเช่าเดือนละ <span className="font-bold text-slate-900">{formatBaht(selectedContractForPrint.rentAmount)}</span> พร้อมกับระบุเงินประกันความเสียหายแรกเข้าจำนวน <span className="font-bold">{formatBaht(selectedContractForPrint.depositAmount)}</span> ({selectedContractForPrint.depositType === 'deduct_rent' ? 'ไปหักกับค่าเช่า' : 'คืนเมื่อสิ้นสุดสัญญา'})</p>
                        {selectedContractForPrint.advancePaymentAmount ? (
                          <p>&bull; <span className="font-bold">ค่าเช่าล่วงหน้า:</span> ชำระล่วงหน้าจำนวน <span className="font-bold">{formatBaht(selectedContractForPrint.advancePaymentAmount)}</span></p>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        <p className="font-bold text-slate-950">ข้อตกลงและระเบียบโครงการเพิ่มเติม:</p>
                        <p className="whitespace-pre-line text-slate-500 pl-2 leading-relaxed bg-slate-50/50 p-3 rounded-xl border border-slate-100">{selectedContractForPrint.terms || 'ปฏิบัติตามระเบียบหอพักมาตรฐาน'}</p>
                      </div>
                    </div>

                    {/* Signatures */}
                    <div className="grid grid-cols-2 gap-8 pt-8 border-t border-dashed border-slate-200 text-center">
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ ผู้เช่าห้องพัก</p>
                        {selectedContractForPrint.tenantSignature ? (
                          <img src={selectedContractForPrint.tenantSignature} alt="ลายเซ็นผู้เช่า" className="h-10 mx-auto border border-slate-100 rounded-lg p-1 bg-slate-50/50 object-contain" />
                        ) : (
                          <div className="h-10 border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-300">ลายมือชื่อ</div>
                        )}
                        <p className="font-extrabold text-slate-800 text-xs">(คุณ{tenantName})</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ นิติหอพัก / ผู้ให้เช่า</p>
                        {(selectedContractForPrint.ownerSignature || dorm.ownerSignature) ? (
                          <img src={selectedContractForPrint.ownerSignature || dorm.ownerSignature} alt="ลายเซ็นผู้ให้เช่า" className="h-10 mx-auto border border-slate-100 rounded-lg p-1 bg-slate-50/50 object-contain" />
                        ) : (
                          <div className="h-10 border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-300">ลายมือชื่อผู้ให้เช่า</div>
                        )}
                        <p className="font-extrabold text-slate-800 text-xs">({dorm.ownerName || 'ผู้จัดการหอพัก'})</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </PrintView>
          </div>
        </Modal>
      )}

      {/* Modal: Edit Contract */}
      {isEditContractModalOpen && selectedContractForEdit && (
        <Modal
          isOpen={isEditContractModalOpen}
          onClose={() => {
            setIsEditContractModalOpen(false);
            setSelectedContractForEdit(null);
          }}
          title={`แก้ไขข้อความสัญญาเลขที่ ${selectedContractForEdit.contractNumber}`}
          size="md"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เริ่มต้นสัญญา *</label>
                <ThaiDatePicker
                  value={editContractStartDate}
                  onChange={(val) => {
                    setEditContractStartDate(val);
                    setEditContractEndDate(calculateContractEndDate(val, editContractDuration));
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ระยะเวลาสัญญา (เดือน)</label>
                <input
                  type="number"
                  min={1}
                  value={editContractDuration}
                  onChange={(e) => {
                    const dur = Number(e.target.value) || 1;
                    setEditContractDuration(dur);
                    setEditContractEndDate(calculateContractEndDate(editContractStartDate, dur));
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่สิ้นสุดสัญญา</label>
                <ThaiDatePicker
                  value={editContractEndDate}
                  onChange={(val) => setEditContractEndDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">อัตราค่าเช่า (บาท/เดือน) *</label>
                <CurrencyInput
                  value={editContractRent}
                  onChange={(val) => setEditContractRent(val)}
                  placeholder="เช่น 4000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">เงินประกัน / มัดจำ (บาท) *</label>
                <CurrencyInput
                  value={editContractDeposit}
                  onChange={(val) => setEditContractDeposit(val)}
                  placeholder="เช่น 8000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">สถานะเงินประกัน</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditContractDepositStatus('paid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositStatus === 'paid'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditContractDepositStatus('unpaid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositStatus === 'unpaid'
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">เงื่อนไขเงินประกัน</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditContractDepositType('refundable')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositType === 'refundable'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  คืนเมื่อสิ้นสุดสัญญา
                </button>
                <button
                  type="button"
                  onClick={() => setEditContractDepositType('deduct_rent')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositType === 'deduct_rent'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  ไปหักกับค่าเช่า
                </button>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">ข้อตกลงและระเบียบเพิ่มเติม</label>
              <textarea
                value={editContractTerms}
                onChange={(e) => setEditContractTerms(e.target.value)}
                rows={4}
                className="w-full p-3 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-indigo-600"
                placeholder="ระบุข้อตกลงและระเบียบสัญญาเช่าเพิ่มเติม..."
              />
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsEditContractModalOpen(false);
                  setSelectedContractForEdit(null);
                }}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveEditContract}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกการแก้ไขสัญญา</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Renew Contract */}
      {isRenewContractModalOpen && selectedContractForRenew && (
        <Modal
          isOpen={isRenewContractModalOpen}
          onClose={() => {
            setIsRenewContractModalOpen(false);
            setSelectedContractForRenew(null);
          }}
          title={`ต่ออายุสัญญาเช่า (เลขที่ ${selectedContractForRenew.contractNumber})`}
          size="md"
        >
          {/* ว่างเปล่าสำหรับเตรียมพัฒนาต่อ */}
          <div className="min-h-[240px] flex items-center justify-center p-6 text-slate-300">
          </div>
        </Modal>
      )}

      {/* Modal: Create New Contract */}
      {isCreateContractModalOpen && (
        <Modal
          isOpen={isCreateContractModalOpen}
          onClose={() => setIsCreateContractModalOpen(false)}
          title={`จัดทำสัญญาเช่าใหม่ - คุณ${selectedTenant?.name || 'ผู้เช่า'}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">ห้องพักที่เช่า *</label>
                <select
                  value={createContractRoomId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setCreateContractRoomId(rId);
                    const rm = rooms.find(r => r.id === rId);
                    if (rm) {
                      setCreateContractRent(rm.price || 4000);
                      setCreateContractDeposit(rm.deposit || rm.price * 2 || 8000);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-600"
                >
                  <option value="">-- เลือกห้องพัก --</option>
                  {rooms.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      ห้อง {rm.roomNumber} (ชั้น {rm.floor}) - {formatBaht(rm.price)}/ด.
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ระยะเวลาสัญญา (เดือน)</label>
                <div className="flex gap-1.5">
                  {[3, 6, 12].map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => {
                        setCreateContractDuration(dur);
                        setCreateContractEndDate(calculateContractEndDate(createContractStartDate, dur));
                      }}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDuration === dur
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                      {dur} เดือน
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เริ่มต้นสัญญา *</label>
                <ThaiDatePicker
                  value={createContractStartDate}
                  onChange={(val) => {
                    setCreateContractStartDate(val);
                    setCreateContractEndDate(calculateContractEndDate(val, createContractDuration));
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่สิ้นสุดสัญญา</label>
                <ThaiDatePicker
                  value={createContractEndDate}
                  onChange={(val) => setCreateContractEndDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เข้าพักจริง</label>
                <ThaiDatePicker
                  value={createContractStayDate}
                  onChange={(val) => setCreateContractStayDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">อัตราค่าเช่า (บาท/เดือน) *</label>
                <CurrencyInput
                  value={createContractRent}
                  onChange={(val) => setCreateContractRent(val)}
                  placeholder="เช่น 4000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">เงินประกัน / มัดจำ (บาท) *</label>
                <CurrencyInput
                  value={createContractDeposit}
                  onChange={(val) => setCreateContractDeposit(val)}
                  placeholder="เช่น 8000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">สถานะเงินประกัน</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateContractDepositStatus('paid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositStatus === 'paid'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateContractDepositStatus('unpaid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositStatus === 'unpaid'
                        ? 'bg-rose-50 border-rose-300 text-rose-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">เงื่อนไขเงินประกัน</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreateContractDepositType('refundable')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositType === 'refundable'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  คืนเมื่อสิ้นสุดสัญญา
                </button>
                <button
                  type="button"
                  onClick={() => setCreateContractDepositType('deduct_rent')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositType === 'deduct_rent'
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  ไปหักกับค่าเช่า
                </button>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">ข้อตกลงและระเบียบในสัญญา</label>
              <textarea
                value={createContractTerms}
                onChange={(e) => setCreateContractTerms(e.target.value)}
                rows={4}
                className="w-full p-3 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-indigo-600"
                placeholder="ระบุข้อตกลงและระเบียบสัญญาเช่า..."
              />
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsCreateContractModalOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveNewContract}
                disabled={!createContractRoomId}
                className={`px-5 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${createContractRoomId
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกและสร้างสัญญาเช่า</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Co-Occupant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isAddCoModalOpen}
          onClose={() => setIsAddCoModalOpen(false)}
          title={`เพิ่มผู้พักร่วม - คุณ${selectedTenant.name}`}
        >
          <form onSubmit={handleAddNewCoOccupant} className="space-y-4 text-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-slate-700 font-bold text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>ระเบียบการแจ้งผู้พักร่วม (คิดอัตรา บาท/คน)</span>
              </div>

              <div className="space-y-1.5">
                {/* DO / ถูกต้อง */}
                <div className="p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <div className="space-y-0.5 text-[11px] leading-snug">
                    <p className="font-bold text-emerald-950">
                      แจ้งและลงทะเบียนตามจริง
                    </p>
                    <p className="text-[10px] text-emerald-800 font-medium leading-relaxed">
                      เพื่อให้ระบบคำนวณค่าน้ำและค่าสาธารณูปโภคส่วนกลางได้ถูกต้องตามจำนวนคนจริง
                    </p>
                  </div>
                </div>

                {/* DONT / ผิดระเบียบ */}
                <div className="p-2.5 bg-rose-50/90 border border-rose-200 rounded-xl flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <X className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <div className="space-y-0.5 text-[11px] leading-snug">
                    <p className="font-bold text-rose-950">
                      ห้ามปกปิดหรือไม่แจ้งเข้าพัก
                    </p>
                    <p className="text-[10px] text-rose-800 font-medium leading-relaxed">
                      หากตรวจพบถือว่ามีเจตนาทุจริต/โกง มีโทษปรับและผิดสัญญาเช่าทันที
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                ชื่อ - นามสกุล ผู้พักร่วม <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="เช่น สมชาย ใจดี"
                value={newCoName}
                onChange={(e) => setNewCoName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                เบอร์โทรศัพท์มือถือ <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                placeholder="เช่น 081-234-5678"
                value={newCoPhone}
                onChange={(e) => setNewCoPhone(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                สถานะ (ความสัมพันธ์) <span className="text-rose-500">*</span>
              </label>
              <select
                value={newCoRelationship}
                onChange={(e) => {
                  setNewCoRelationship(e.target.value);
                  if (e.target.value !== 'อื่นๆ') {
                    setNewCoCustomRelationship('');
                  }
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600 cursor-pointer"
              >
                {CO_OCCUPANT_RELATION_OPTIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
            </div>

            {newCoRelationship === 'อื่นๆ' && (
              <div className="animate-in fade-in slide-in-from-top-1 space-y-1.5 pt-0.5">
                <label className="block font-bold text-indigo-700 text-[11px]">
                  ระบุสถานะความสัมพันธ์ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ผู้ช่วยงาน, เพื่อนร่วมงาน, ผู้ดูแล"
                  value={newCoCustomRelationship}
                  onChange={(e) => setNewCoCustomRelationship(e.target.value)}
                  className="w-full px-3 py-2 border border-indigo-200 bg-indigo-50/40 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
                  autoFocus
                />
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 -mx-6 -mb-6 p-4 bg-slate-50 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsAddCoModalOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={!newCoName.trim() || !newCoPhone.trim() || (newCoRelationship === 'อื่นๆ' && !newCoCustomRelationship.trim())}
                className={`px-5 py-2 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 ${newCoName.trim() && newCoPhone.trim() && (newCoRelationship !== 'อื่นๆ' || newCoCustomRelationship.trim())
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกเพิ่มผู้พักร่วม</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Co-Occupant Confirmation Modal */}
      {selectedTenant && coToDelete && (
        <Modal
          isOpen={isDeleteCoModalOpen}
          onClose={() => {
            setIsDeleteCoModalOpen(false);
            setCoToDelete(null);
          }}
          title="ยืนยันการนำผู้พักร่วมออก"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div className="text-rose-900">
                <p className="font-bold">คุณกำลังจะนำคุณ {coToDelete.name} ออกจากห้องพัก</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  ระบบจะบันทึกประวัติการนำออกพร้อมวันเดือนปีและเวลา ({formatThaiDate(new Date().toISOString(), true)}) ไว้ในไทม์ไลน์
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                เหตุผลหรือบันทึกเพิ่มเติม (ถ้ามี)
              </label>
              <input
                type="text"
                placeholder="เช่น แจ้งย้ายออก, สิ้นสุดการพักอาศัยร่วม"
                value={deleteCoReason}
                onChange={(e) => setDeleteCoReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-rose-600"
              />
            </div>

            <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 -mx-6 -mb-6 p-4 bg-slate-50 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteCoModalOpen(false);
                  setCoToDelete(null);
                }}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveCoOccupant}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <UserMinus className="w-4 h-4" />
                <span>ยืนยันการนำออกและบันทึกประวัติ</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Floating Contract Toast */}
      {contractToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{contractToast}</span>
        </div>
      )}

    </div>
  );
};
