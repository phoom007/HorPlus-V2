/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  CheckCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  StatusBadge,
  Modal,
  Stepper,
  formatBaht,
  formatThaiDate,
  formatOwnerDate,
  formatOwnerDateTime,
  renderOptionalText,
  OwnerDateInput
} from '../../components/GlobalComponents';
import { Tenant, Room, CoOccupant, EmergencyContact, Contract, Bill, BillItem, BLOCKING_CONTRACT_STATUSES } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
import {
  getTenantRegistrationRequests,
  approveTenantRegistrationRequest,
  rejectTenantRegistrationRequest,
  updateTenantRegistrationRoom,
} from '../../data/adapters/api';
import { httpRequest } from '../../data/httpClient';
import { DailyStayApprovalModal } from '../../components/DailyStayApprovalModal';
export const getDormitory = (): any => null;
import { convertImageToWebP, UPLOAD_DROPZONE_TEXT } from '../../utils/imageUtils';

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
  cameFromMeters?: boolean;
  onBackToMeters?: () => void;
  onViewContract?: (contractId: string, tenantId?: string) => void;
}

const CAR_BRANDS = ["Toyota", "Honda", "Isuzu", "Mazda", "Nissan", "Mitsubishi", "Ford", "Benz", "BMW", "Audi", "MG", "BYD", "Suzuki", "อื่นๆ"];
const MOTO_BRANDS = ["Honda", "Yamaha", "Vespa", "Suzuki", "GPX", "Kawasaki", "Ducati", "อื่นๆ"];
const PET_OPTIONS = ["สุนัข", "แมว", "นก", "ปลา", "กระต่าย", "หนูแฮมสเตอร์", "อื่นๆ"];

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
  cameFromMeters: propCameFromMeters,
  onBackToMeters,
  onViewContract
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [cameFromMeters, setCameFromMeters] = useState(Boolean(propCameFromMeters));

  React.useEffect(() => {
    if (propCameFromMeters) {
      setCameFromMeters(true);
    }
  }, [propCameFromMeters]);

  // Auto select tenant on mount if initialTenantId provided
  React.useEffect(() => {
    if (!initialTenantId) return;

    const tenant = (tenants || []).find(t => t.id === initialTenantId);
    if (tenant) {
      setSelectedTenant(tenant);
      setProfileTab('info');
      if (propCameFromMeters !== undefined) {
        setCameFromMeters(Boolean(propCameFromMeters));
      } else {
        setCameFromMeters(true);
      }
      onClearInitialTenantId?.();
    }
  }, [initialTenantId, tenants, onClearInitialTenantId, propCameFromMeters]);

  const [profileTab, setProfileTab] = useState<'info' | 'history'>('info');
  const [isIdCardOpen, setIsIdCardOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [idCardPhoto, setIdCardPhoto] = useState('');
  const [docTab, setDocTab] = useState<'uploaded' | 'simulated'>('uploaded');

  // Lease termination states
  const [isTerminateOpen, setIsTerminateOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferTargetRoom, setTransferTargetRoom] = useState('');
  const [isSuccessAnimating, setIsSuccessAnimating] = useState(false);
  const [terminateReason, setTerminateReason] = useState<'early' | 'normal' | 'prepare_vacant'>('normal');
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [damageFee, setDamageFee] = useState<string>('0');
  const [additionalNote, setAdditionalNote] = useState<string>('');

  // Multi-step form state for adding new tenant
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copySuccessToast, setCopySuccessToast] = useState<string | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [coOccupants, setCoOccupants] = useState<CoOccupant[]>([]);
  const [coName, setCoName] = useState('');
  const [coPhone, setCoPhone] = useState('');
  const [coCitizen, setCoCitizen] = useState('');

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [vehicleType, setVehicleType] = useState<'car' | 'motorcycle' | 'none'>('none');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');

  const [hasPet, setHasPet] = useState(false);
  const [petType, setPetType] = useState('');
  const [petName, setPetName] = useState('');

  const [selectedRoomId, setSelectedRoomId] = useState('');

  // Handle open registration wizard
  const handleOpenAddWizard = () => {
    setErrorText(null);
    setCurrentStep(0);
    setName('');
    setPhone('');
    setEmail('');
    setCitizenId('');
    setCoOccupants([]);
    setEmergencyName('');
    setEmergencyRelation('');
    setEmergencyPhone('');
    setVehicleType('none');
    setVehiclePlate('');
    setVehicleBrand('');
    setHasPet(false);
    setPetType('');
    setPetName('');

    setCurrentStep(0);
    setIsAddOpen(true);
  };

  // Registration requests & co-occupants state
  const [regRequests, setRegRequests] = useState<any[]>([]);
  const [dailyRequests, setDailyRequests] = useState<any[]>([]);
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [selectedRegReq, setSelectedRegReq] = useState<any | null>(null);
  const [selectedDailyStayForApproval, setSelectedDailyStayForApproval] = useState<any | null>(null);
  const [isDailyApprovalModalOpen, setIsDailyApprovalModalOpen] = useState(false);

  // Reject modal state
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReasonText, setRejectReasonText] = useState('');

  // Approve modal state
  const [isApproveTermsOpen, setIsApproveTermsOpen] = useState(false);
  const [approveStartDate, setApproveStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [approveEndDate, setApproveEndDate] = useState(new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10));
  const [approveDuration, setApproveDuration] = useState(12);
  const [approveRent, setApproveRent] = useState('4500');
  const [approveDeposit, setApproveDeposit] = useState('9000');
  const [approveAdvance, setApproveAdvance] = useState('4500');

  // Co-occupants modal state for existing tenant
  const [isAddCoModalOpen, setIsAddCoModalOpen] = useState(false);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [newCoRelation, setNewCoRelation] = useState('ผู้ร่วมพัก');

  const resolvedDormId = rooms[0]?.dormitoryId || tenants[0]?.dormitoryId || (typeof window !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || localStorage.getItem('horplus_current_dormitory_id') : '') || '';

  const fetchRegRequests = async () => {
    try {
      // 1. Monthly & Term registration requests
      const res = await getTenantRegistrationRequests();
      if (res.success && res.data) {
        const list = Array.isArray(res.data) ? res.data : (res.data as any).data || [];
        setRegRequests(list);
      }
    } catch {}

    try {
      // 2. Daily stay requests pending approval
      if (resolvedDormId) {
        const dailyRes: any = await httpRequest<any>('GET', '/api/v1/daily-stays?status=PENDING_APPROVAL', undefined, {
          headers: { 'x-dormitory-id': resolvedDormId },
        });
        const dList = Array.isArray(dailyRes?.data) ? dailyRes.data : Array.isArray(dailyRes) ? dailyRes : [];
        setDailyRequests(dList);
      }
    } catch {
      setDailyRequests([]);
    }
  };

  React.useEffect(() => {
    fetchRegRequests();
  }, [resolvedDormId]);

  const [replacementWarningData, setReplacementWarningData] = useState<any>(null);

  const handleApproveRegistration = async (confirmReplacementInput = false) => {
    if (!selectedRegReq) {
      console.error('[handleApproveRegistration] ABORT: selectedRegReq is null!');
      return;
    }
    const confirmReplacement = confirmReplacementInput === true;
    console.log('[handleApproveRegistration] START id:', selectedRegReq.id, 'confirmReplacement:', confirmReplacement);
    try {
      const startDate = approveStartDate && approveStartDate.trim() ? approveStartDate : '2026-11-01';
      const endDate = approveEndDate && approveEndDate.trim() ? approveEndDate : '2027-04-30';
      const durationMonths = approveDuration ? Number(approveDuration) : 6;
      const rentAmount = approveRent && approveRent.trim() ? approveRent : '5000';
      const depositAmount = approveDeposit && approveDeposit.trim() ? approveDeposit : '10000';
      const advancePaymentAmount = approveAdvance && approveAdvance.trim() ? approveAdvance : '5000';

      const res = await approveTenantRegistrationRequest(selectedRegReq.id, {
        startDate,
        endDate,
        durationMonths,
        rentAmount,
        depositAmount,
        advancePaymentAmount,
        confirmReplacement,
      });
      console.log('[handleApproveRegistration] RES:', res);

      if (res.success) {
        setIsApproveTermsOpen(false);
        setReplacementWarningData(null);
        setSelectedRegReq(null);
        await fetchRegRequests();
        const updatedTenants = await getDataProvider().tenants.getAll();
        onSaveTenants(updatedTenants);
      } else {
        const errDetails = (res.error?.details as any)?.error || res.error?.details || res.error;
        const errCode = errDetails?.code || res.error?.code;

        if (errCode === 'REPLACEMENT_CONFIRMATION_REQUIRED' || res.error?.code === 'REPLACEMENT_CONFIRMATION_REQUIRED') {
          setReplacementWarningData({
            activeTenantName: errDetails?.activeTenantName || (res.error as any)?.activeTenantName || 'ผู้เช่าปัจจุบัน',
            activeRoomNumber: errDetails?.activeRoomNumber || (res.error as any)?.activeRoomNumber || 'ไม่ระบุ',
            hasFutureRenewal: errDetails?.hasFutureRenewal || (res.error as any)?.hasFutureRenewal || false,
            futureTenantName: errDetails?.futureTenantName || (res.error as any)?.futureTenantName || null,
            futureStartDate: errDetails?.futureStartDate || (res.error as any)?.futureStartDate || null,
            message: errDetails?.message || res.error?.message,
          });
        }
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการอนุมัติคำขอ');
    }
  };

  // Reassign room modal state for registration request
  const [isReassignModalOpen, setIsReassignModalOpen] = useState(false);
  const [reassignTargetRoomId, setReassignTargetRoomId] = useState('');

  const handleReassignRoom = async () => {
    if (!selectedRegReq || !reassignTargetRoomId) return;
    try {
      const res = await updateTenantRegistrationRoom(selectedRegReq.id, reassignTargetRoomId);
      if (res.success) {
        alert('เปลี่ยนห้องพักในคำขอลงทะเบียนเรียบร้อยแล้ว');
        setIsReassignModalOpen(false);
        setReassignTargetRoomId('');
        setSelectedRegReq(null);
        await fetchRegRequests();
        if (onSaveRooms) {
          const updatedRooms = await getDataProvider().rooms.getAll();
          onSaveRooms(updatedRooms);
        }
      } else {
        alert(res.error?.message || 'ไม่สามารถเปลี่ยนห้องพักได้');
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนห้องพัก');
    }
  };

  const handleRejectRegistration = async () => {
    if (!selectedRegReq) return;
    if (!rejectReasonText.trim()) {
      alert('กรุณาระบุเหตุผลการปฏิเสธคำขอ');
      return;
    }
    try {
      const res = await rejectTenantRegistrationRequest(selectedRegReq.id, rejectReasonText.trim());
      if (res.success) {
        alert('ปฏิเสธคำขอลงทะเบียนเรียบร้อยแล้ว');
        setIsRejectModalOpen(false);
        setRejectReasonText('');
        setSelectedRegReq(null);
        await fetchRegRequests();
      } else {
        alert(res.error?.message || 'ไม่สามารถปฏิเสธคำขอได้');
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการปฏิเสธคำขอ');
    }
  };

  const handleAddCoOccupant = () => {
    if (!coName.trim()) return;
    const newCo: CoOccupant = {
      id: 'temp-' + Date.now(),
      name: coName.trim(),
      phone: coPhone.trim() || undefined,
      relationship: 'ผู้ร่วมพัก',
    };
    setCoOccupants((prev) => [...prev, newCo]);
    setCoName('');
    setCoPhone('');
  };

  const handleRemoveCoOccupant = (id: string) => {
    setCoOccupants((prev) => prev.filter((c) => c.id !== id));
  };

  const handleAddCoOccupantToTenant = async () => {
    if (!selectedTenant || !newCoName.trim()) return;
    try {
      const res = await getDataProvider().tenants.addCoOccupant(selectedTenant.id, {
        name: newCoName.trim(),
        phone: newCoPhone.trim() || undefined,
        relationship: newCoRelation.trim() || 'ผู้ร่วมพัก',
      });
      if (res.success) {
        setNewCoName('');
        setNewCoPhone('');
        setIsAddCoModalOpen(false);
        const updatedTenants = await getDataProvider().tenants.getAll();
        onSaveTenants(updatedTenants);
        const refreshed = updatedTenants.find((t) => t.id === selectedTenant.id);
        if (refreshed) setSelectedTenant(refreshed);
      } else {
        alert(res.error?.message || 'ไม่สามารถเพิ่มผู้พักร่วมได้');
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการเพิ่มผู้พักร่วม');
    }
  };

  const handleRemoveCoOccupantFromTenant = async (tenantId: string, coOccupantId: string) => {
    if (!confirm('คุณแน่ใจหรือไม่ที่จะลบผู้พักร่วมอาศัยท่านนี้?')) return;
    try {
      const res = await getDataProvider().tenants.removeCoOccupant(tenantId, coOccupantId);
      if (res.success) {
        const updatedTenants = await getDataProvider().tenants.getAll();
        onSaveTenants(updatedTenants);
        const refreshed = updatedTenants.find((t) => t.id === selectedTenant.id);
        if (refreshed) setSelectedTenant(refreshed);
      } else {
        alert(res.error?.message || 'ไม่สามารถลบผู้พักร่วมได้');
      }
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการลบผู้พักร่วม');
    }
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

  const handleSaveTenant = async () => {
    setErrorText(null);

    const tenantPayload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      citizenId: citizenId.trim(),
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
        type: hasPet ? petType : undefined,
        name: hasPet ? petName : undefined
      },
      status: 'active' as const
    };

    try {
      const res = await getDataProvider().tenants.addTenant(tenantPayload as any);
      if (res.success && res.data) {
        setIsAddOpen(false);
        const updated = await getDataProvider().tenants.getAll();
        onSaveTenants(updated);
        onAddLog('จดทะเบียนผู้เช่าใหม่', `สร้างประวัติผู้เช่า ${name}`, 'Tenant', res.data.id);
      } else {
        setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการบันทึกผู้เช่า');
      }
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการบันทึกผู้เช่า');
    }
  };

  const handleDeleteTenant = async (tenantId: string, tenantName: string) => {
    if (!window.confirm(`คุณต้องการถอนผู้เช่า "${tenantName}" ออกจากระบบถาวร?`)) return;

    try {
      const res = await (getDataProvider().tenants as any).delete(tenantId);
      if (res.success) {
        const updated = await getDataProvider().tenants.getAll();
        onSaveTenants(updated);
        setSelectedTenant(null);
        onAddLog('ลบผู้เช่า', `ถอนผู้เช่า ${tenantName} ออกจากระบบ`, 'Tenant', tenantId);
      } else {
        alert(res.error?.message || 'ไม่สามารถลบผู้เช่าออกจากระบบได้');
      }
    } catch (err: any) {
      alert(err.message || 'ไม่สามารถลบผู้เช่าออกจากระบบได้');
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

  const handleConfirmTerminate = async () => {
    if (!selectedTenant) return;

    setErrorText(null);
    setIsSuccessAnimating(true);

    const tenantId = selectedTenant.id;
    const room = rooms.find(r => r.currentTenantId === tenantId);

    if (room) {
      try {
        const moveOutDate = additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0];
        const res = await getDataProvider().occupancies!.moveOut(room.id, moveOutDate);
        if (!res.success) {
          setErrorText(res.error?.message || 'Failed to process move-out');
          setIsSuccessAnimating(false);
          return;
        }
      } catch (err: any) {
        setErrorText(err.message || 'Error occurred during move-out');
        setIsSuccessAnimating(false);
        return;
      }
    }

    try {
      const updatedTenants = await getDataProvider().tenants.getAll();
      onSaveTenants(updatedTenants);
      if (onSaveRooms) {
        const updatedRooms = await getDataProvider().rooms.getAll();
        onSaveRooms(updatedRooms);
      }
    } catch {}

    onAddLog('เลิกเช่าคืนห้อง', `ผู้เช่า ${selectedTenant.name} ย้ายออกเรียบร้อยแล้ว`, 'Tenant', tenantId);
    setIsSuccessAnimating(false);
    setIsTerminateOpen(false);
    setSelectedTenant(null);
  };

  const handleConfirmTransfer = async () => {
    if (!selectedTenant || !transferTargetRoom) return;

    setErrorText(null);
    setIsSuccessAnimating(true);

    const tenantId = selectedTenant.id;
    const currentRoom = rooms.find(r => r.currentTenantId === tenantId);

    if (currentRoom) {
      try {
        const transferDate = additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0];
        const res = await getDataProvider().occupancies!.transferRoom(currentRoom.id, transferTargetRoom, transferDate);
        if (!res.success) {
          setErrorText(res.error?.message || 'Failed to process room transfer');
          setIsSuccessAnimating(false);
          return;
        }
      } catch (err: any) {
        setErrorText(err.message || 'Error occurred during room transfer');
        setIsSuccessAnimating(false);
        return;
      }
    }

    setTimeout(() => {
      const tenantId = selectedTenant.id;
      const tenantName = selectedTenant.name;
      const oldRoom = rooms.find(r => r.currentTenantId === tenantId);
      const newRoom = rooms.find(r => r.id === transferTargetRoom);

      if (!oldRoom || !newRoom) {
        setIsSuccessAnimating(false);
        setIsTransferOpen(false);
        return;
      }

      // Update rooms
      const updatedRooms = rooms.map(r => {
        if (r.id === oldRoom.id) {
          return { ...r, status: 'vacant' as const, currentTenantId: undefined, updatedAt: new Date().toISOString() };
        }
        if (r.id === newRoom.id) {
          return { ...r, status: 'occupied' as const, currentTenantId: tenantId, currentContractId: oldRoom.currentContractId, updatedAt: new Date().toISOString() };
        }
        return r;
      });

      // Update contracts
      let updatedContracts = [...(contracts || [])];
      if (oldRoom.currentContractId) {
        updatedContracts = updatedContracts.map(c => {
          if (c.id === oldRoom.currentContractId) {
            return { ...c, roomId: newRoom.id, updatedAt: new Date().toISOString(), terms: `${c.terms || ''}\n[ระบบนิติ] ย้ายห้องพักจากห้อง ${oldRoom.roomNumber} ไปยังห้อง ${newRoom.roomNumber} เมื่อ ${formatThaiDate(new Date().toISOString())}${additionalNote ? ` / หมายเหตุ: ${additionalNote}` : ''}` };
          }
          return c;
        });
      }

      onSaveRooms(updatedRooms);
      if (onSaveContracts) {
        onSaveContracts(updatedContracts);
      }

      const detailLog = `ผู้เช่าย้ายห้องจาก ${oldRoom.roomNumber} ไปยัง ${newRoom.roomNumber}${additionalNote ? ` (หมายเหตุ: ${additionalNote})` : ''}`;
      onAddLog('ย้ายห้องพัก', detailLog, 'Tenant', tenantId);

      setIsSuccessAnimating(false);
      setIsTransferOpen(false);
      setTransferTargetRoom('');
      setAdditionalNote('');
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
    setVehicleType(tenant.vehicle.type);
    setVehiclePlate(tenant.vehicle.licensePlate || '');
    setVehicleBrand(tenant.vehicle.brand || '');
    setHasPet(tenant.pet.hasPet);
    setPetType(tenant.pet.type || '');
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

  const handleSaveEditTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !citizenId.trim()) {
      setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
      return;
    }

    if (selectedTenant) {
      const updatePayload = {
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        citizenId: citizenId.trim(),
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
          type: hasPet ? petType.trim() : undefined,
          name: hasPet ? petName.trim() : undefined
        }
      };

      try {
        const res = await getDataProvider().tenants.updateTenant(selectedTenant.id, updatePayload as any);
        if (res.success) {
          const updatedTenants = await getDataProvider().tenants.getAll();
          onSaveTenants(updatedTenants);
          const updatedItem = updatedTenants.find(t => t.id === selectedTenant.id);
          if (updatedItem) {
            setSelectedTenant(updatedItem);
          }
          setIsEditOpen(false);
          onAddLog('แก้ไขทะเบียนผู้เช่า', `แก้ไขข้อมูลผู้เช่าคุณ ${name.trim()}`, 'Tenant', selectedTenant.id);
        } else {
          setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการบันทึกการแก้ไข');
        }
      } catch (err: any) {
        setErrorText(err.message || 'เกิดข้อผิดพลาดในการบันทึกการแก้ไข');
      }
    }
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
    if (!val) return '-';
    return formatPhoneInput(val);
  };

  const formatCitizenId = (val: string) => {
    if (!val) return '-';
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

  const isRecent2Cycles = !selectedCycle || getRecent2Cycles().includes(selectedCycle);

  // Filter tenants by search query (Master Registry - shows all registered tenants in dormitory)
  const filteredTenants = tenants.filter(t => {
    const name = (t?.name || '').toLowerCase();
    const phone = t?.phone || '';
    const email = (t?.email || '').toLowerCase();
    const q = (searchQuery || '').toLowerCase();

    return (
      name.includes(q) ||
      phone.includes(searchQuery || '') ||
      email.includes(q)
    );
  });

  const getRoomNumber = (tenantId: string) => {
    // 1. Check if there is an active contract for this tenant
    if (contracts && contracts.length > 0) {
      const activeContract = contracts.find(c => c.tenantId === tenantId && (c.status === 'ACTIVE' || c.status === 'active'));
      if (activeContract) {
        const r = rooms.find(room => room.id === activeContract.roomId);
        if (r) return r.roomNumber;
      }
    }
    // 2. Check if there is a room currently assigned to this tenant
    const currentRoom = rooms.find(r => r.currentTenantId === tenantId);
    if (currentRoom) return currentRoom.roomNumber;

    // 3. Check any bill
    if (bills && bills.length > 0) {
      const b = bills.find(b => b.tenantId === tenantId);
      if (b) {
        const r = rooms.find(room => room.id === b.roomId);
        if (r) return r.roomNumber;
      }
    }

    return 'ไม่ระบุห้อง';
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">

      {/* Left column: List of tenants */}
      <div className={`lg:col-span-1 bg-white p-5 rounded-3xl border border-gray-100 shadow-xs flex flex-col h-[700px] ${
        selectedTenant ? 'hidden lg:flex' : 'flex'
      }`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-extrabold text-slate-900">ทะเบียนผู้เช่า ({filteredTenants.length})</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenAddWizard}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shrink-0"
              title="จดทะเบียนผู้เช่าและย้ายเข้า"
            >
              <Plus className="w-4 h-4" />
              <span>เพิ่มผู้เช่า</span>
            </button>
            <button
              onClick={() => {
                fetchRegRequests();
                setIsRegModalOpen(true);
              }}
              className="relative flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shrink-0"
              title="รายการคำขอเช่ารออนุมัติ (รายเทอม, รายเดือน, รายวัน)"
            >
              <Clock className="w-4 h-4" />
              <span>คำขอรออนุมัติ</span>
              {(regRequests.filter(r => r.status === 'pending_owner_approval').length + dailyRequests.filter(r => r.status === 'PENDING_APPROVAL').length) > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-white text-amber-800 rounded-full text-[10px] font-black">
                  {regRequests.filter(r => r.status === 'pending_owner_approval').length + dailyRequests.filter(r => r.status === 'PENDING_APPROVAL').length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-2.5 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์โทร..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800"
          />
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100 pr-1">
          {filteredTenants.map((tenant) => (
            <div
              key={tenant.id}
              onClick={() => {
                setSelectedTenant(tenant);
                setProfileTab('info');
              }}
              className={`p-3.5 rounded-2xl cursor-pointer transition-all flex justify-between items-center gap-2 mb-1.5 ${
                selectedTenant?.id === tenant.id ? 'bg-indigo-50/70 border border-indigo-150/40 shadow-2xs' : 'hover:bg-slate-50 border border-transparent'
              }`}
            >
              <div className="flex gap-3 items-center min-w-0">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 shrink-0 font-bold text-sm">
                  {tenant.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{tenant.name}</h4>
                  <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(tenant.phone)}</p>
                </div>
              </div>
              <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-2 py-1 rounded-lg shrink-0">
                ห้อง {getRoomNumber(tenant.id)}
              </span>
            </div>
          ))}
          {filteredTenants.length === 0 && (
            <div className="text-center py-12 text-xs text-gray-400">
              ไม่พบข้อมูลทะเบียนผู้เช่า
            </div>
          )}
        </div>
      </div>

      {/* Right Column: Tenant detailed profile tab panel */}
      <div className={`lg:col-span-2 min-w-0 w-full ${selectedTenant ? 'block' : 'hidden lg:block'}`}>
        {selectedTenant ? (
          <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-xs h-[700px] flex flex-col justify-between w-full min-w-0 overflow-hidden">
            <div>
              {/* Context-Aware Back Button */}
              {cameFromMeters ? (
                <button
                  data-testid="back-to-meters-btn"
                  onClick={() => {
                    setCameFromMeters(false);
                    setSelectedTenant(null);
                    if (onBackToMeters) {
                      onBackToMeters();
                    }
                  }}
                  className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-extrabold text-xs mb-4 transition-all pb-2 border-b border-gray-100 w-full cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 animate-pulse text-indigo-500" />
                  <span>กลับหน้าจดมิเตอร์</span>
                </button>
              ) : (
                <button
                  onClick={() => setSelectedTenant(null)}
                  className="lg:hidden flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-extrabold text-xs mb-4 transition-all pb-2 border-b border-gray-100 w-full cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>กลับไปยังรายชื่อผู้เช่า</span>
                </button>
              )}

              {/* Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-5">
                <div className="flex gap-3.5 items-center">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center font-extrabold text-base sm:text-lg shadow-sm border border-indigo-100 shrink-0">
                    {selectedTenant.name.charAt(0)}
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight">{selectedTenant.name}</h2>
                    <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">เลขบัตรประชาชน: {formatCitizenId(selectedTenant.citizenId)}</p>
                    <p className="text-[11px] sm:text-xs text-indigo-600 font-extrabold mt-0.5">ห้องพักปัจจุบัน: ห้อง {getRoomNumber(selectedTenant.id)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <button
                    onClick={() => handleOpenEditModal(selectedTenant)}
                    className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-xl transition-all cursor-pointer shrink-0"
                  >
                    แก้ไขข้อมูล
                  </button>
                  <button
                    disabled={!isRecent2Cycles}
                    onClick={() => {
                      setTransferTargetRoom('');
                      setIsTransferOpen(true);
                    }}
                    className={`px-2.5 py-1.5 font-bold text-[10px] rounded-xl transition-all shrink-0 border ${
                      isRecent2Cycles
                        ? 'bg-amber-50 border-amber-100 hover:bg-amber-100 text-amber-700 cursor-pointer'
                        : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                    title={isRecent2Cycles ? 'ย้ายห้องพัก' : 'สามารถทำการย้ายห้องได้เฉพาะ 2 งวดล่าสุดเท่านั้น'}
                  >
                    ย้ายห้อง
                  </button>
                  <button
                    disabled={!isRecent2Cycles}
                    onClick={() => {
                      setTerminateReason('normal');
                      setRefundDeposit(true);
                      setDamageFee('0');
                      setAdditionalNote('');
                      setIsTerminateOpen(true);
                    }}
                    className={`px-2.5 py-1.5 font-bold text-[10px] rounded-xl transition-all shrink-0 border ${
                      isRecent2Cycles
                        ? 'bg-rose-50 border-rose-100 hover:bg-rose-100 text-rose-700 cursor-pointer'
                        : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                    title={isRecent2Cycles ? 'เลิกเช่าห้องพัก' : 'สามารถทำการเลิกเช่าได้เฉพาะ 2 งวดล่าสุดเท่านั้น'}
                  >
                    เลิกเช่า
                  </button>
                </div>
              </div>

              {/* Tabs Selector */}
              <div className="flex border-b border-gray-100 text-xs mt-4 overflow-x-auto scrollbar-none whitespace-nowrap gap-1">
                <button
                  onClick={() => setProfileTab('info')}
                  className={`px-4 py-2 border-b-2 font-bold transition-all shrink-0 ${
                    profileTab === 'info' ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-gray-400 hover:text-slate-600'
                  }`}
                >
                  ข้อมูลส่วนตัวและเพิ่มเติม
                </button>
                <button
                  onClick={() => setProfileTab('history')}
                  className={`px-4 py-2 border-b-2 font-bold transition-all shrink-0 ${
                    profileTab === 'history' ? 'border-indigo-600 text-indigo-600 font-semibold' : 'border-transparent text-gray-400 hover:text-slate-600'
                  }`}
                >
                  ประวัติการเช่าและผู้พักร่วม
                </button>
              </div>

              {/* Content Panel */}
              <div className="py-6 overflow-y-auto max-h-[420px] pr-1">

                {profileTab === 'info' && (
                  <div className="space-y-6">
                    {/* General */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div className="p-3.5 bg-slate-50 border border-gray-100 rounded-2xl flex flex-col gap-1.5 text-left">
                        <span className="text-gray-400 font-medium text-[10px] uppercase tracking-wider">เบอร์โทรศัพท์มือถือ</span>
                        <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm">
                          <Phone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <span className="break-all">{formatPhone(selectedTenant.phone)}</span>
                        </p>
                      </div>
                      <div className="p-3.5 bg-slate-50 border border-gray-100 rounded-2xl flex flex-col gap-1.5 text-left min-w-0">
                        <span className="text-gray-400 font-medium text-[10px] uppercase tracking-wider">อีเมลติดต่อ</span>
                        <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                          <Mail className="w-3.5 h-3.5 text-indigo-600 animate-pulse shrink-0" />
                          <span className="break-all truncate" title={selectedTenant.email}>{renderOptionalText(selectedTenant.email)}</span>
                        </p>
                      </div>
                    </div>

                    {/* Emergency Contact */}
                    <div className="p-4 bg-slate-50 border border-gray-100 rounded-2xl space-y-3.5">
                      <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5 pb-2 border-b border-gray-100">
                        <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                        ข้อมูลผู้ติดต่อกรณีฉุกเฉิน
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-400 font-medium text-[10px]">ชื่อผู้ติดต่อ:</span>
                          <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{renderOptionalText(selectedTenant.emergencyContact?.name)}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-400 font-medium text-[10px]">ความสัมพันธ์:</span>
                          <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{renderOptionalText(selectedTenant.emergencyContact?.relationship)}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-400 font-medium text-[10px]">เบอร์โทรติดต่อ:</span>
                          <p className="font-extrabold text-indigo-600 text-[11px] sm:text-xs break-all">{renderOptionalText(formatPhone(selectedTenant.emergencyContact?.phone))}</p>
                        </div>
                      </div>
                    </div>

                    {/* Co-Occupants Card */}
                    <div className="p-4 bg-slate-50 border border-gray-100 rounded-2xl space-y-3.5">
                      <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                        <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                          ข้อมูลผู้พักร่วมอาศัย (Co-Occupants)
                        </h4>
                        <button
                          type="button"
                          onClick={() => setIsAddCoModalOpen(true)}
                          className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-lg transition-all flex items-center gap-1 shrink-0"
                        >
                          <Plus className="w-3 h-3" /> เพิ่มผู้พักร่วม
                        </button>
                      </div>
                      {selectedTenant.coOccupants && selectedTenant.coOccupants.length > 0 ? (
                        <div className="space-y-2">
                          {selectedTenant.coOccupants.map((co) => (
                            <div key={co.id} className="flex items-center justify-between p-2.5 bg-white border border-gray-100 rounded-xl text-xs">
                              <div>
                                <span className="font-bold text-slate-800">{co.name}</span>
                                {co.relationship && <span className="text-gray-400 text-[10px] ml-2">({co.relationship})</span>}
                                {co.phone && <p className="text-[10px] text-indigo-600 font-semibold">{formatPhone(co.phone)}</p>}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemoveCoOccupantFromTenant(selectedTenant.id, co.id)}
                                className="text-rose-500 hover:text-rose-700 text-[10px] font-bold px-2 py-1 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                              >
                                ลบ
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400 text-[11px] italic">ยังไม่มีข้อมูลผู้พักร่วมอาศัย</p>
                      )}
                    </div>

                    {/* Vehicles and Pets */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Vehicle */}
                      <div className="p-4 border border-gray-100 rounded-2xl text-xs space-y-3.5">
                        <h4 className="font-black text-slate-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                          <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                          ข้อมูลยานพาหนะ
                        </h4>
                        {selectedTenant.vehicle && selectedTenant.vehicle.type !== 'none' ? (
                          <div className="space-y-2.5 text-[11px]">
                            <div className="flex flex-col gap-1">
                              <span className="text-gray-400 font-medium text-[10px]">ประเภทยานพาหนะ:</span>
                              <span className="font-extrabold text-slate-700">{selectedTenant.vehicle.type === 'car' ? 'รถยนต์' : 'จักรยานยนต์'}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-gray-400 font-medium text-[10px]">เลขทะเบียนรถ:</span>
                              <span className="font-black text-slate-800 text-xs">{selectedTenant.vehicle.licensePlate}</span>
                            </div>
                            {selectedTenant.vehicle.brand && (
                              <div className="flex flex-col gap-1">
                                <span className="text-gray-400 font-medium text-[10px]">ยี่ห้อ / รุ่น:</span>
                                <span className="font-extrabold text-slate-600">{selectedTenant.vehicle.brand}</span>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-gray-400 text-[11px] italic">ไม่มีประวัติครอบครองยานพาหนะ</p>
                        )}
                      </div>

                      {/* Pet */}
                      <div className="p-4 border border-gray-100 rounded-2xl text-xs space-y-3.5">
                        <h4 className="font-black text-slate-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                          <Heart className="w-4 h-4 text-rose-600 shrink-0" />
                          การขอเลี้ยงสัตว์เลี้ยง
                        </h4>
                        {selectedTenant.pet && selectedTenant.pet.hasPet ? (
                          <div className="space-y-2.5 text-[11px]">
                            <div className="flex flex-col gap-1">
                              <span className="text-gray-400 font-medium text-[10px]">ประเภทสัตว์:</span>
                              <span className="font-extrabold text-slate-700">{selectedTenant.pet.type}</span>
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-gray-400 font-medium text-[10px]">ชื่อสัตว์เลี้ยง:</span>
                              <span className="font-black text-slate-800 text-xs">{selectedTenant.pet.name}</span>
                            </div>
                          </div>
                        ) : (
                          <p className="text-gray-400 text-[11px] italic">ไม่ได้ขอเลี้ยงสัตว์เลี้ยงภายในห้องพัก</p>
                        )}
                      </div>
                    </div>

                    {/* Important Document History */}
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 text-xs space-y-3">
                      <h4 className="font-black text-slate-800 pb-2 border-b border-gray-100">ประวัติเอกสารสำคัญ</h4>
                      {(() => {
                        const hasIdCard = !!(
                          (selectedTenant.idCardObjectKey && selectedTenant.idCardObjectKey.trim() !== '') ||
                          (selectedTenant.idCardPhotoMock &&
                            selectedTenant.idCardPhotoMock.trim() !== '' &&
                            selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64')
                        );
                        return (
                          <div
                            onClick={() => { setIsIdCardOpen(true); }}
                            className="p-3 bg-slate-50 hover:bg-indigo-50/50 border border-gray-100 hover:border-indigo-150 rounded-xl flex items-center justify-between cursor-pointer transition-all group"
                            title={hasIdCard ? "คลิกเพื่อเปิดดูภาพสำเนาบัตรประชาชน" : "คลิกเพื่ออัปโหลดหรือจัดการเอกสาร"}
                          >
                            <div className="flex gap-2.5 items-center min-w-0">
                              <FileText className={`w-4 h-4 ${hasIdCard ? 'text-indigo-600' : 'text-amber-500'} group-hover:scale-110 transition-transform shrink-0`} />
                              <div className="min-w-0">
                                <p className="font-bold text-slate-800 text-[11px] group-hover:text-indigo-900 transition-colors">สำเนาบัตรประจำตัวประชาชน</p>
                                <p className="text-[9px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-1">
                                  <span>สถานะ: {hasIdCard ? 'ตรวจสอบและผ่านการรับรองแล้ว' : 'ยังไม่ได้อัปโหลดเอกสาร'}</span>
                                  <span className="text-[8px] text-indigo-600 underline font-bold group-hover:text-indigo-700">
                                    {hasIdCard ? '(คลิกเพื่อเปิดดูภาพ)' : '(คลิกเพื่ออัปโหลด)'}
                                  </span>
                                </p>
                              </div>
                            </div>
                            {hasIdCard ? (
                              <span className="text-[9px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
                                อัปโหลดแล้ว
                              </span>
                            ) : (
                              <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-md shrink-0">
                                ยังไม่ได้อัปโหลด
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
                            <div className="p-3 bg-slate-50 border border-gray-100 rounded-xl text-center text-gray-400 text-[11px] italic mt-2">
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
                                if (onViewContract) {
                                  onViewContract(con.id, selectedTenant.id);
                                }
                              }}
                              className="p-3 bg-slate-50 hover:bg-indigo-50/50 border border-gray-100 hover:border-indigo-150 rounded-xl flex items-center justify-between cursor-pointer transition-all group mt-2"
                              title="คลิกเพื่อเปิดดูและย้ายไปยังหน้าสัญญาเช่า"
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
                              <div className="flex items-center gap-1.5 shrink-0">
                                <a
                                  href={`/api/v1/contracts/${con.id}/pdf`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md hover:bg-emerald-100 transition-colors flex items-center gap-1"
                                >
                                  <span>ดาวน์โหลด PDF</span>
                                  <span className="text-[10px]">📥</span>
                                </a>
                                <span className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md flex items-center gap-0.5 group-hover:bg-indigo-100 transition-colors">
                                  เปิดดูสัญญา &rarr;
                                </span>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>

                  </div>
                )}



                {profileTab === 'history' && (
                  <div className="space-y-6">
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-slate-800">ประวัติการเข้าพัก (Occupancy History)</h4>
                      {selectedTenant.rentalHistory && selectedTenant.rentalHistory.length > 0 ? (
                        <div className="space-y-2">
                          {selectedTenant.rentalHistory.map((roomId, idx) => {
                            const pastRoom = rooms.find(r => r.id === roomId);
                            return (
                              <div key={idx} className="p-3 bg-white border border-gray-200 rounded-xl flex items-center justify-between text-xs">
                                <div>
                                  <span className="font-bold text-slate-700">ห้อง {pastRoom ? pastRoom.roomNumber : 'ไม่ทราบหมายเลขห้อง'}</span>
                                </div>
                                <span className="text-[10px] text-gray-400 bg-gray-50 px-2 py-1 rounded">ประวัติการเช่า</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-center py-4 text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-xl bg-slate-50">ไม่มีประวัติการเช่าห้องอื่นเพิ่มเติม</p>
                      )}
                    </div>

                    <div className="space-y-4 pt-4 border-t border-gray-100">
                      <h4 className="text-xs font-bold text-slate-800">ผู้พักอาศัยร่วมประสงค์ขอแจ้งบันทึก ({selectedTenant.coOccupants?.length || 0} คน)</h4>
                       {(selectedTenant.coOccupants || []).map((co, index) => (
                        <div key={co.id} className="p-3.5 bg-slate-50 border border-gray-100 rounded-2xl flex justify-between items-center text-xs gap-3">
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800 truncate">{co.name}</p>
                            <p className="text-[10px] text-gray-400 mt-1">เบอร์โทรศัพท์: {formatPhone(co.phone)}</p>
                          </div>
                          <span className="text-[9px] text-slate-400 font-bold bg-white px-2 py-1 rounded-lg border border-gray-100 shrink-0 whitespace-nowrap">
                            คนที่ {index + 1}
                          </span>
                        </div>
                      ))}
                      {(!selectedTenant.coOccupants || selectedTenant.coOccupants.length === 0) && (
                        <p className="text-center py-12 text-xs text-gray-400">พักอาศัยเพียงท่านเดียว (ไม่มีประวัติแจ้งผู้พักร่วม)</p>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 shrink-0">
              <span>จดบันทึกเข้าระบบเมื่อ: {selectedTenant.createdAt ? String(selectedTenant.createdAt).split('T')[0] : '-'}</span>
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

      {/* Thai National ID Card Viewer Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isIdCardOpen}
          onClose={() => setIsIdCardOpen(false)}
          title="เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า"
          size="md"
        >
          <div className="flex flex-col items-center justify-center p-1 sm:p-4 space-y-4">
            <div className="text-center">
              <p className="text-xs text-slate-500 font-medium">ภาพสำเนาบัตรประจำตัวประชาชนผู้เช่าที่ได้รับการตรวจสอบแล้ว</p>
            </div>

            {(() => {
              const hasRealDoc = !!(selectedTenant.idCardObjectKey && selectedTenant.idCardObjectKey.trim() !== '');
              const hasMockDoc = !!(selectedTenant.idCardPhotoMock && selectedTenant.idCardPhotoMock.trim() !== '' && selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64');
              const docSrc = hasRealDoc ? `/api/v1/tenants/${selectedTenant.id}/identity-document` : hasMockDoc ? selectedTenant.idCardPhotoMock : null;

              if (docSrc) {
                return (
                  <div className="w-full max-w-[420px] bg-slate-50 border border-gray-200 rounded-2xl overflow-hidden p-2 relative shadow-md">
                    <img src={docSrc} alt="เอกสารประจำตัวผู้เช่า" className="w-full h-auto max-h-[280px] object-contain rounded-lg mx-auto" />
                    <div className="absolute top-4 right-4 bg-emerald-600 text-white text-[9px] font-bold px-2 py-1 rounded-md shadow">
                      เอกสารจริงจากระบบ
                    </div>
                  </div>
                );
              }

              return (
                <div className="w-full max-w-[420px] p-8 border-2 border-dashed border-gray-200 rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center space-y-3">
                  <FileText className="w-12 h-12 text-slate-400" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-slate-700">ยังไม่ได้อัปโหลดไฟล์ภาพบัตรประชาชน</p>
                    <p className="text-[10px] text-gray-400">คุณสามารถแก้ไขข้อมูลผู้เช่าเพื่อทำการอัปโหลดไฟล์สำเนาจริงได้</p>
                  </div>
                </div>
              );
            })()}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2 w-full">
              <button
                onClick={() => {
                  const printWindow = window.open('', '_blank');
                  if (!printWindow) return;
                  const hasRealDoc = !!(selectedTenant.idCardObjectKey && selectedTenant.idCardObjectKey.trim() !== '');
                  const hasMockDoc = !!(selectedTenant.idCardPhotoMock && selectedTenant.idCardPhotoMock.trim() !== '' && selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64');
                  const photoUrl = hasRealDoc ? `/api/v1/tenants/${selectedTenant.id}/identity-document` : hasMockDoc ? (selectedTenant.idCardPhotoMock.startsWith('data:') ? selectedTenant.idCardPhotoMock : `data:image/jpeg;base64,${selectedTenant.idCardPhotoMock}`) : '';
                  const hasPhoto = Boolean(photoUrl && photoUrl.trim() !== '');
                  const escapeHtml = (val?: string | null) => {
                    if (!val) return '-';
                    return String(val)
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;')
                      .replace(/'/g, '&#039;');
                  };

                  printWindow.document.write(`
                    <!DOCTYPE html>
                    <html lang="th">
                    <head>
                      <meta charset="UTF-8">
                      <title>สำเนาบัตรประจำตัวประชาชน - ${escapeHtml(selectedTenant.name)}</title>
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
                            ? `<img src="${photoUrl}" class="card-img" alt="สำเนาบัตรประชาชน" />`
                            : `<div class="no-img">( ไม่ได้แนบไฟล์ภาพถ่ายสำเนาบัตรประชาชน )</div>`}
                        </div>

                        <div class="section-title">ข้อมูลส่วนตัวผู้เช่า</div>
                        <table class="info-grid">
                          <tr><td class="label">ชื่อ-นามสกุล:</td><td class="value">${escapeHtml(selectedTenant.name)}</td></tr>
                          <tr><td class="label">เลขประจำตัวประชาชน:</td><td class="value">${escapeHtml(selectedTenant.citizenId || '-')}</td></tr>
                          <tr><td class="label">เบอร์โทรศัพท์:</td><td class="value">${escapeHtml(selectedTenant.phone || '-')}</td></tr>
                          <tr><td class="label">อีเมล:</td><td class="value">${escapeHtml(selectedTenant.email || '-')}</td></tr>
                          <tr><td class="label">ผู้ติดต่อฉุกเฉิน:</td><td class="value">${selectedTenant.emergencyContact?.name ? `${escapeHtml(selectedTenant.emergencyContact.name)} (${escapeHtml(selectedTenant.emergencyContact.relationship || '-')}) เบอร์: ${escapeHtml(selectedTenant.emergencyContact.phone || '-')}` : '-'}</td></tr>
                        </table>

                        <div class="footer-note">เอกสารนี้พิมพ์จากระบบบริหารจัดการหอพัก เมื่อ ${formatThaiDate(new Date().toISOString(), true)}</div>
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
                }}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>พิมพ์เอกสาร</span>
              </button>
              <button
                onClick={() => setIsIdCardOpen(false)}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer text-center"
              >
                เสร็จสิ้น
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Tenant Registration Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="จดทะเบียนผู้เช่าและย้ายเข้า" size="lg">
        <div className="space-y-4">
          <Stepper steps={["ข้อมูลส่วนตัว", "ข้อมูลติดต่อฉุกเฉิน", "เลือกห้องพัก"]} currentStep={currentStep} />

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
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder="ชื่อผู้พักร่วม"
                    value={coName}
                    onChange={(e) => setCoName(e.target.value)}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                  <input
                    type="tel"
                    placeholder="เบอร์โทร"
                    maxLength={12}
                    value={formatPhoneInput(coPhone)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setCoPhone(clean);
                    }}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddCoOccupant}
                    className="px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-bold text-[10px] rounded-lg transition-all"
                  >
                    เพิ่มผู้ร่วมตึก
                  </button>
                </div>
                {coOccupants.length > 0 && (
                  <div className="space-y-1.5 pt-2 max-h-24 overflow-y-auto">
                    {coOccupants.map((c) => (
                      <div key={c.id} className="flex justify-between items-center bg-white p-2 border border-gray-100 rounded-xl text-[10px]">
                        <span>{c.name} ({formatPhone(c.phone)})</span>
                        <button type="button" onClick={() => handleRemoveCoOccupant(c.id)} className="text-rose-500 font-bold">&times;</button>
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
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-md">
                      ยังไม่ได้ตั้งค่านโยบายสัตว์เลี้ยง
                    </span>
                  </div>
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
                            <select
                              value={petType}
                              onChange={(e) => setPetType(e.target.value)}
                              className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                            >
                              <option value="">-- เลือกประเภทสัตว์เลี้ยง --</option>
                              {PET_OPTIONS.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                              {petType && !PET_OPTIONS.includes(petType) && (
                                <option value={petType}>{petType}</option>
                              )}
                            </select>
                            <input
                              type="text"
                              placeholder="ชื่อน้อง"
                              value={petName}
                              onChange={(e) => setPetName(e.target.value)}
                              className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                            />
                          </div>
                        )}
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
      </Modal>

      {/* Lease Termination Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isTerminateOpen}
          onClose={() => !isSuccessAnimating && setIsTerminateOpen(false)}
          title={`ทำเรื่องเลิกเช่าคืนห้องพัก - ห้อง ${getRoomNumber(selectedTenant.id)}`}
          size="lg"
          transparentBg={isSuccessAnimating}
          hideHeader={isSuccessAnimating}
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
                <div className="bg-amber-50/50 border border-amber-200 rounded-2xl p-4 space-y-3">
                  <h4 className="font-bold text-amber-800 text-xs flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    รายละเอียดผู้เช่าและการเข้าพัก
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-800">
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold">ชื่อผู้เช่า:</p>
                      <p className="font-extrabold text-xs mt-0.5">{selectedTenant.name}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold">เบอร์โทรศัพท์ติดต่อ:</p>
                      <p className="font-extrabold text-xs mt-0.5">{selectedTenant.phone}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาของสัญญา / วันที่เข้าพัก:</p>
                      <p className="font-extrabold text-xs mt-0.5">
                        {(() => {
                          const tContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);
                          const activeCon = tContracts.find(c => c.status === 'active' || c.status === 'expiring_soon') || tContracts[0];
                          if (activeCon && activeCon.startDate && activeCon.endDate) {
                            return `${formatThaiDate(activeCon.startDate)} ถึง ${formatThaiDate(activeCon.endDate)} (รวม ${activeCon.durationMonths || 1} เดือน)`;
                          }
                          const cDate = selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : '';
                          return cDate ? `เริ่มเข้าพักเมื่อ: ${formatThaiDate(cDate)}` : '-';
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาที่อยู่อาศัยมาแล้ว (จนถึงปัจจุบัน):</p>
                      <p className="font-extrabold text-xs text-indigo-700 mt-0.5">
                        {(() => {
                          const tContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);
                          const activeCon = tContracts.find(c => c.status === 'active' || c.status === 'expiring_soon') || tContracts[0];
                          const start = activeCon?.startDate || (selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : '');
                          if (!start) return '-';
                          return getStayDurationText(start);
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Move-Out Request Details & Actual End Date Confirmation */}
                {(() => {
                  const reqInfo = null;

                  return (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900">คำขอแจ้งย้ายออกของผู้เช่า (ถ้ามี)</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                          ไม่มีคำขอแจ้งย้ายออก (ระบบย้ายออกโดยตรง)
                        </span>
                      </div>
                      {reqInfo && (
                        <div className="space-y-1 text-slate-700">
                          <p><strong>วันที่ผู้เช่าประสงค์ย้ายออก:</strong> {reqInfo.desiredDate || reqInfo.intendedMoveOutDate}</p>
                          {reqInfo.reason && <p><strong>เหตุผล:</strong> {reqInfo.reason}</p>}
                          {reqInfo.bankInfo && (
                            <p><strong>บัญชีรับคืนเงินมัดจำ (Masked):</strong> {reqInfo.bankInfo} {reqInfo.accountInfo ? reqInfo.accountInfo.slice(0, 3) + '***' + reqInfo.accountInfo.slice(-3) : ''}</p>
                          )}
                        </div>
                      )}

                      <div className="pt-2 border-t border-amber-200/60">
                        <label className="block text-[11px] font-bold text-slate-800 mb-1" htmlFor="actualEndDateInput">
                          วันที่สิ้นสุดการเช่าจริง (Actual Tenancy End Date) *
                        </label>
                        <OwnerDateInput
                          id="actualEndDateInput"
                          value={additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0]}
                          onChange={(iso) => setAdditionalNote(`วันที่สิ้นสุดจริง: ${iso}`)}
                          className="py-1.5"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">
                          * วันที่ย้ายออกจริงแยกต่างหากจากวันที่ผู้เช่าแจ้งประสงค์ ยืนยันแล้วสัญญาและการพักอาศัยจะสิ้นสุดลงทันที
                        </p>
                      </div>
                    </div>
                  );
                })()}

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
                          const rm = rooms.find(r => r.currentTenantId === selectedTenant.id);
                          return rm ? formatBaht(rm.depositAmount) : 'ไม่มีข้อมูลเงินมัดจำ';
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

      {/* Transfer Room Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isTransferOpen}
          onClose={() => !isSuccessAnimating && setIsTransferOpen(false)}
          title={`ย้ายห้องพักผู้เช่า - ห้อง ${getRoomNumber(selectedTenant.id)}`}
          size="md"
        >
          <div className="space-y-4">
            {errorText && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {errorText}
              </div>
            )}
            {isSuccessAnimating ? (
              <div className="py-8 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mb-4 text-amber-600">
                  <CheckCircle className="w-10 h-10" />
                </div>
                <h3 className="text-base font-bold text-slate-800">ดำเนินการย้ายห้องพักสำเร็จ</h3>
                <p className="text-xs text-gray-500 mt-1 text-center max-w-xs">ระบบได้บันทึกการย้ายห้องพักเรียบร้อยแล้ว</p>
              </div>
            ) : (
              <>
                <div className="space-y-3 p-4 bg-amber-50/70 border border-amber-200 rounded-2xl">
                  <h4 className="font-bold text-amber-900 text-xs">ข้อมูลการย้ายห้อง</h4>
                  <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-slate-700">เลือกห้องปลายทาง (แสดงเฉพาะห้องว่าง)</label>
                    <select
                      value={transferTargetRoom}
                      onChange={(e) => setTransferTargetRoom(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl bg-white text-slate-800 font-semibold text-xs"
                    >
                      <option value="">-- กรุณาเลือกห้องว่างปลายทาง --</option>
                      {rooms.filter(r => r.status === 'vacant').map(r => (
                        <option key={r.id} value={r.id}>ห้อง {r.roomNumber} (ค่าเช่า: {formatBaht(r.monthlyRent)})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-amber-200/60">
                    <label className="block text-[11px] font-bold text-slate-700">วันที่ย้ายห้อง</label>
                    <OwnerDateInput
                      value={additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0]}
                      onChange={(iso) => setAdditionalNote(`วันที่ย้าย: ${iso}`)}
                      className="py-1.5"
                    />
                  </div>

                  <div className="space-y-2 pt-2 border-t border-amber-200/60">
                    <label className="block text-[11px] font-bold text-slate-700">หมายเหตุเพิ่มเติม</label>
                    <textarea
                      value={additionalNote}
                      onChange={(e) => setAdditionalNote(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl bg-white text-slate-800 h-16 resize-none"
                      placeholder="เช่น ระบุการย้ายมัดจำ..."
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-100 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIsTransferOpen(false)}
                    className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmTransfer}
                    disabled={!transferTargetRoom}
                    className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl cursor-pointer shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ยืนยันการย้ายห้อง
                  </button>
                </div>
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

            <div className="max-h-[460px] overflow-y-auto pr-1 space-y-4 pb-16">
              {/* Personal Info */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
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
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
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
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
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
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">อีเมลติดต่อ (ถ้ามี)</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
                    />
                  </div>
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800 border-b border-slate-200 pb-1.5 flex items-center gap-1.5">
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
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-[10px] font-bold text-slate-700">ความสัมพันธ์</label>
                      <input
                        type="text"
                        value={emergencyRelation}
                        onChange={(e) => setEmergencyRelation(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
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
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pets / Vehicles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-semibold text-slate-700">ขอเลี้ยงสัตว์เลี้ยง</label>
                    <span className="text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-md">
                      ยังไม่ได้ตั้งค่านโยบายสัตว์เลี้ยง
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="hasPetEdit"
                      checked={hasPet}
                      onChange={(e) => setHasPet(e.target.checked)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label htmlFor="hasPetEdit" className="text-xs text-slate-600 cursor-pointer">ประสงค์เลี้ยงสัตว์</label>
                  </div>
                  {hasPet && (
                    <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                      <select
                        value={petType}
                        onChange={(e) => setPetType(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                      >
                        <option value="">-- เลือกประเภทสัตว์เลี้ยง --</option>
                        {PET_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                        {petType && !PET_OPTIONS.includes(petType) && (
                          <option value={petType}>{petType}</option>
                        )}
                      </select>
                      <input
                        type="text"
                        placeholder="ชื่อน้อง"
                        value={petName}
                        onChange={(e) => setPetName(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">ยานพาหนะครอบครอง</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => {
                      setVehicleType(e.target.value as any);
                      setVehicleBrand(''); // Reset brand when changing type
                    }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-700 font-bold"
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

              {/* File Attachment / Document Upload */}
              <div className="space-y-1.5 pt-2 border-t border-gray-100">
                <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  อัปโหลดรูปเอกสารประจำตัว (สำเนาบัตรประชาชน)
                </label>
                <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-2xl p-4 hover:bg-indigo-50/10 transition-all relative">
                  {idCardPhoto ? (
                    <div className="relative border border-slate-150 rounded-2xl overflow-hidden w-48 h-32 bg-slate-50 flex items-center justify-center mx-auto shadow-sm z-30">
                      <img src={idCardPhoto} alt="เอกสารอัปโหลด" className="w-full h-full object-contain" />
                      <button
                        type="button"
                        onClick={() => setIdCardPhoto('')}
                        className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 z-40"
                      >
                        ล้างรูปภาพ
                      </button>
                    </div>
                  ) : (
                    <div className="text-center space-y-1.5 text-gray-400 py-4 relative z-10 pointer-events-none">
                      <FileText className="w-10 h-10 text-indigo-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด</p>
                      <p className="text-[10px] text-gray-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</p>
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${idCardPhoto ? 'z-0' : 'z-20'}`}
                  />
                </div>
              </div>
            </div>

            {/* Modal Buttons */}
            {(() => {
              const isFormChanged = selectedTenant ? (
                name.trim() !== selectedTenant.name ||
                phone.trim() !== selectedTenant.phone ||
                email.trim() !== (selectedTenant.email || '') ||
                citizenId.trim() !== (selectedTenant.citizenId || '') ||
                emergencyName.trim() !== (selectedTenant.emergencyContact?.name || '') ||
                emergencyRelation.trim() !== (selectedTenant.emergencyContact?.relationship || '') ||
                emergencyPhone.trim() !== (selectedTenant.emergencyContact?.phone || '') ||
                vehicleType !== (selectedTenant.vehicle?.type || 'none') ||
                vehiclePlate.trim() !== (selectedTenant.vehicle?.licensePlate || '') ||
                vehicleBrand.trim() !== (selectedTenant.vehicle?.brand || '') ||
                hasPet !== (selectedTenant.pet?.hasPet || false) ||
                (hasPet && petType.trim() !== (selectedTenant.pet?.type || '')) ||
                (hasPet && petName.trim() !== (selectedTenant.pet?.name || '')) ||
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
                    className={`px-5 py-2 font-bold text-xs rounded-xl shadow-sm transition-all ${
                      isFormChanged
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

      {/* Modal: Add Co-Occupant to Tenant */}
      <Modal
        isOpen={isAddCoModalOpen}
        onClose={() => setIsAddCoModalOpen(false)}
        title="เพิ่มข้อมูลผู้พักร่วมอาศัย"
        maxWidth="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อ-นามสกุล *</label>
            <input
              type="text"
              required
              value={newCoName}
              onChange={(e) => setNewCoName(e.target.value)}
              placeholder="สมหญิง ใจดี"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">เบอร์โทรศัพท์</label>
            <input
              type="tel"
              value={newCoPhone}
              onChange={(e) => setNewCoPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="0891234567"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ความสัมพันธ์</label>
            <input
              type="text"
              value={newCoRelation}
              onChange={(e) => setNewCoRelation(e.target.value)}
              placeholder="เพื่อน / แฟน / พี่น้อง"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setIsAddCoModalOpen(false)}
              className="px-4 py-2 border border-gray-200 text-xs font-bold rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleAddCoOccupantToTenant}
              className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-700"
            >
              บันทึกผู้พักร่วม
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Unified Pending Tenant Approval Requests List */}
      <Modal
        isOpen={isRegModalOpen}
        onClose={() => setIsRegModalOpen(false)}
        title="รายการคำขอเช่าห้องพักรออนุมัติ (Unified Tenant Approval Requests)"
        maxWidth="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex justify-between items-center pb-2 border-b border-gray-100">
            <span className="text-xs text-slate-500">
              คำขอทั้งหมด ({regRequests.length + dailyRequests.length} รายการ: รายเดือน/เทอม {regRequests.length}, รายวัน {dailyRequests.length})
            </span>
            <button
              type="button"
              onClick={fetchRegRequests}
              className="text-[11px] text-indigo-600 font-bold hover:underline"
            >
              รีเฟรชรายการ
            </button>
          </div>

          {(regRequests.length > 0 || dailyRequests.length > 0) ? (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {/* 1. Daily Stay Requests */}
              {dailyRequests.map((dReq) => {
                const reqRoom = rooms.find((r) => r.id === dReq.roomId || r.roomNumber === dReq.room?.roomNumber);

                return (
                  <div
                    key={dReq.id}
                    className="p-4 border rounded-2xl space-y-2 bg-amber-50/40 border-amber-200"
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-900 text-sm">
                            {dReq.applicantFullName || dReq.tenant?.displayName || 'ผู้เข้าพักรายวัน'}
                          </h4>
                          <span className="px-2 py-0.5 text-[10px] font-black rounded-md bg-amber-100 text-amber-800 border border-amber-300">
                            รายวัน
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                            dReq.depositDeclaredStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                          }`}>
                            มัดจำ: {dReq.depositDeclaredStatus === 'PAID' ? 'จ่ายแล้ว (แจ้งไว้)' : 'ยังไม่จ่าย'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          เบอร์โทร: <span className="font-mono font-semibold">{dReq.applicantPhone || dReq.tenant?.phone || '-'}</span>
                        </p>
                        <p className="text-xs text-slate-600">
                          ห้องที่ขอ: <span className="font-bold text-indigo-700">{reqRoom ? `ห้อง ${reqRoom.roomNumber}` : dReq.room?.roomNumber || dReq.roomId}</span>
                        </p>
                        <p className="text-xs text-slate-600">
                          ช่วงวันที่: <span className="font-semibold">{dReq.startDate?.slice(0, 10)} ถึง {dReq.endDate?.slice(0, 10)}</span> ({dReq.inclusiveDayCount} วัน)
                        </p>
                        <div className="flex items-center gap-3 text-xs font-semibold text-slate-600 pt-1 flex-wrap">
                          <span>ค่าเช่ารายวัน: <strong>{formatBaht(Number(dReq.totalRentAmount))}</strong></span>
                          <span>เงินประกัน: <strong>{formatBaht(Number(dReq.depositAmount))}</strong></span>
                          <span>ยอดตามข้อตกลง: <strong className="text-amber-900">{formatBaht(Number(dReq.totalRentAmount) + Number(dReq.depositAmount))}</strong></span>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 text-[10px] font-black rounded-lg uppercase bg-amber-100 text-amber-800 border border-amber-300">
                        รออนุมัติ
                      </span>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t border-amber-200/60">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDailyStayForApproval(dReq);
                          setIsDailyApprovalModalOpen(true);
                        }}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1"
                      >
                        ตรวจสอบ / แก้ไข / อนุมัติ
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* 2. Monthly & Term Registration Requests */}
              {regRequests.map((req) => {
                const reqRoom = rooms.find((r) => r.id === req.requestedRoomId || r.roomNumber === req.requestedRoomId);
                const isOccupied = reqRoom?.status === 'occupied';

                return (
                  <div
                    key={req.id}
                    className={`p-4 border rounded-2xl space-y-2 transition-all ${
                      req.status === 'pending_owner_approval'
                        ? 'bg-blue-50/40 border-blue-200'
                        : req.status === 'approved'
                        ? 'bg-emerald-50/30 border-emerald-200'
                        : 'bg-rose-50/30 border-rose-200'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold text-slate-900 text-sm">
                            {req.firstName} {req.lastName}
                          </h4>
                          <span className="px-2 py-0.5 text-[10px] font-black rounded-md bg-blue-100 text-blue-800 border border-blue-300">
                            รายเดือน / รายเทอม
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          เบอร์โทร: <span className="font-mono font-semibold">{req.phone}</span>
                        </p>
                        <p className="text-xs text-slate-600">
                          ห้องที่ขอ: <span className="font-bold text-indigo-700">{reqRoom ? `ห้อง ${reqRoom.roomNumber}` : req.requestedRoomId}</span>
                        </p>
                        {req.note && <p className="text-xs text-slate-500 italic mt-1">"{req.note}"</p>}
                      </div>
                      <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg uppercase ${
                        req.status === 'pending_owner_approval'
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : req.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : 'bg-rose-100 text-rose-800 border border-rose-300'
                      }`}>
                        {req.status === 'pending_owner_approval' ? 'รออนุมัติ' : req.status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}
                      </span>
                    </div>

                    {req.status === 'pending_owner_approval' && isOccupied && (
                      <p className="text-xs text-rose-700 bg-rose-100/70 p-2 rounded-lg font-bold border border-rose-200">
                        ห้องนี้มีผู้เช่าแล้ว กรุณาเปลี่ยนห้องก่อนอนุมัติ
                      </p>
                    )}

                    {req.status === 'rejected' && req.rejectedReason && (
                      <p className="text-xs text-rose-700 bg-rose-100/50 p-2 rounded-lg font-medium">
                        เหตุผลการปฏิเสธ: {req.rejectedReason}
                      </p>
                    )}

                    {req.status === 'pending_owner_approval' && (
                      <div className="flex justify-end gap-2 pt-2 border-t border-gray-200/60">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRegReq(req);
                            setReassignTargetRoomId(req.requestedRoomId);
                            setIsReassignModalOpen(true);
                          }}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                        >
                          เปลี่ยนห้อง
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRegReq(req);
                            setIsRejectModalOpen(true);
                          }}
                          className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold text-xs rounded-xl"
                        >
                          ปฏิเสธคำขอ
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRegReq(req);
                            if (!approveStartDate) setApproveStartDate('2026-11-01');
                            if (!approveEndDate) setApproveEndDate('2027-04-30');
                            if (!approveRent) setApproveRent('5000');
                            if (!approveDeposit) setApproveDeposit('10000');
                            if (!approveAdvance) setApproveAdvance('5000');
                            setIsApproveTermsOpen(true);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl"
                        >
                          อนุมัติและทำสัญญา
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-xs text-gray-400 py-8 italic">ยังไม่มีคำขอเช่าห้องพักในระบบ</p>
          )}
        </div>
      </Modal>

      {/* Daily Stay Approval Modal (Launched from Unified Approval Workspace) */}
      <DailyStayApprovalModal
        isOpen={isDailyApprovalModalOpen}
        onClose={() => {
          setIsDailyApprovalModalOpen(false);
          setSelectedDailyStayForApproval(null);
        }}
        stay={selectedDailyStayForApproval}
        dormitoryId={resolvedDormId}
        onSuccess={(msg) => {
          fetchRegRequests();
          if (typeof window !== 'undefined') {
            alert(msg);
          }
        }}
      />

      {/* Modal: Reassign Room for Registration Request */}
      <Modal
        isOpen={isReassignModalOpen}
        onClose={() => setIsReassignModalOpen(false)}
        title="เปลี่ยนห้องพักสำหรับคำขอลงทะเบียน"
        maxWidth="max-w-md"
      >
        {selectedRegReq && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-indigo-50 border border-indigo-150 rounded-xl">
              <p className="font-bold text-indigo-900">ผู้สมัคร: {selectedRegReq.firstName} {selectedRegReq.lastName}</p>
              <p className="text-indigo-700 text-[11px]">เบอร์โทร: {selectedRegReq.phone}</p>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">เลือกห้องพักใหม่ *</label>
              <select
                value={reassignTargetRoomId}
                onChange={(e) => setReassignTargetRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl"
              >
                <option value="">-- เลือกห้องพัก --</option>
                {rooms
                  .filter((r) => r.status !== 'occupied')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      ห้อง {r.roomNumber} (ว่าง)
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsReassignModalOpen(false)}
                className="px-4 py-2 border border-gray-200 font-bold rounded-xl"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleReassignRoom}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl"
              >
                บันทึกการเปลี่ยนห้อง
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Approve Terms Confirmation */}
      <Modal
        isOpen={isApproveTermsOpen}
        onClose={() => setIsApproveTermsOpen(false)}
        title="กำหนดข้อตกลงสัญญาและอนุมัติผู้เช่า"
        maxWidth="max-w-md"
        zIndex="z-[600]"
      >
        {selectedRegReq && (
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-indigo-50 border border-indigo-150 rounded-xl">
              <p className="font-bold text-indigo-900">ผู้สมัคร: {selectedRegReq.firstName} {selectedRegReq.lastName}</p>
              <p className="text-indigo-700 text-[11px]">เบอร์โทร: {selectedRegReq.phone}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">วันเริ่มสัญญา *</label>
                <OwnerDateInput
                  required
                  value={approveStartDate}
                  onChange={(iso) => setApproveStartDate(iso)}
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">วันสิ้นสุดสัญญา *</label>
                <OwnerDateInput
                  required
                  value={approveEndDate}
                  onChange={(iso) => setApproveEndDate(iso)}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-bold text-slate-700 mb-1">ค่าเช่า/เดือน *</label>
                <input
                  type="number"
                  value={approveRent}
                  onChange={(e) => setApproveRent(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">เงินประกัน *</label>
                <input
                  type="number"
                  value={approveDeposit}
                  onChange={(e) => setApproveDeposit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">ล่วงหน้า *</label>
                <input
                  type="number"
                  value={approveAdvance}
                  onChange={(e) => setApproveAdvance(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setIsApproveTermsOpen(false)}
                className="px-4 py-2 border border-gray-200 font-bold rounded-xl"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleApproveRegistration(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl"
              >
                ยืนยันการอนุมัติ
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Reject Reason Input */}
      <Modal
        isOpen={isRejectModalOpen}
        onClose={() => setIsRejectModalOpen(false)}
        title="ระบุเหตุผลการปฏิเสธคำขอลงทะเบียน"
        maxWidth="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-slate-700 mb-1">เหตุผลการปฏิเสธ (ภาษาไทย) *</label>
            <textarea
              rows={3}
              required
              value={rejectReasonText}
              onChange={(e) => setRejectReasonText(e.target.value)}
              placeholder="เช่น ห้องพักเต็มแล้ว หรือ ไม่ผ่านเงื่อนไขการตรวจสอบประวัติ"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setIsRejectModalOpen(false)}
              className="px-4 py-2 border border-gray-200 font-bold rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={handleRejectRegistration}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl"
            >
              ยืนยันการปฏิเสธ
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: High-Visibility Destructive Replacement Warning Modal */}
      <Modal
        isOpen={!!replacementWarningData}
        onClose={() => setReplacementWarningData(null)}
        title={replacementWarningData?.hasFutureRenewal ? "⚠️ คำเตือนการยกเลิกสัญญาต่ออายุในอนาคต" : "⚠️ คำเตือนการยุติสัญญาและยกเลิกผู้เช่าเดิม"}
        size="lg"
        zIndex="z-[700]"
      >
        {replacementWarningData && (
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-amber-50 border-2 border-amber-300 text-amber-900 rounded-xl space-y-2">
              <p className="font-bold text-sm text-amber-900 flex items-center gap-2">
                ⚠️ {replacementWarningData.hasFutureRenewal ? 'ห้องพักนี้มีสัญญาต่ออายุในอนาคตที่ได้รับอนุมัติแล้ว' : 'ห้องพักนี้มีผู้เช่าปัจจุบันอยู่แล้ว'}
              </p>
              <p className="leading-relaxed font-semibold whitespace-pre-line">
                {replacementWarningData.hasFutureRenewal ? `ห้องนี้มีสัญญาต่ออายุในอนาคตที่ได้รับอนุมัติแล้ว

การอนุมัติผู้สมัครรายใหม่นี้จะยกเลิกสิทธิ์การต่อสัญญา
ในอนาคตของผู้เช่าเดิม และผู้สมัครรายใหม่จะได้รับสิทธิ์ในห้องนี้แทน

กรุณาตรวจสอบข้อมูลก่อนยืนยัน` : 'ห้องนี้มีผู้เช่าปัจจุบันอยู่ การอนุมัติผู้สมัครรายใหม่นี้จะยุติสัญญาและสิทธิ์การพักอาศัยของผู้เช่าปัจจุบันทันที และระบบจะเริ่มขั้นตอนคำนวณยอดย้ายออก กรุณาตรวจสอบข้อมูลก่อนยืนยัน'}
              </p>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-slate-700">
              <p><span className="font-bold">ห้องพัก:</span> {replacementWarningData.activeRoomNumber}</p>
              {replacementWarningData.hasFutureRenewal && (
                <>
                  {replacementWarningData.futureTenantName && (
                    <p><span className="font-bold">ผู้เช่าสัญญาอนาคต:</span> {replacementWarningData.futureTenantName}</p>
                  )}
                  {replacementWarningData.futureStartDate && (
                    <p><span className="font-bold">วันเริ่มสัญญาอนาคต:</span> {replacementWarningData.futureStartDate}</p>
                  )}
                </>
              )}
              {replacementWarningData.activeTenantName && (
                <p><span className="font-bold">ผู้เช่าปัจจุบัน:</span> {replacementWarningData.activeTenantName}</p>
              )}
              <p><span className="font-bold">ผู้สมัครใหม่:</span> {selectedRegReq?.firstName} {selectedRegReq?.lastName}</p>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setReplacementWarningData(null)}
                className="px-4 py-2 border border-gray-200 font-bold rounded-xl text-slate-600 hover:bg-slate-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => {
                  handleApproveRegistration(true);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-sm"
              >
                ยืนยันยกเลิกผู้เช่าเดิมและอนุมัติผู้เช่าใหม่
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
