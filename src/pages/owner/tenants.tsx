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
  formatThaiDate
} from '../../components/GlobalComponents';
import { Tenant, Room, CoOccupant, EmergencyContact, Contract, Bill, BillItem, BLOCKING_CONTRACT_STATUSES } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
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
  onBackToMeters,
  onViewContract
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [cameFromMeters, setCameFromMeters] = useState(false);

  // Auto select tenant on mount if initialTenantId provided
  React.useEffect(() => {
    if (initialTenantId) {
      const tenant = tenants.find(t => t.id === initialTenantId);
      if (tenant) {
        setSelectedTenant(tenant);
        setProfileTab('info');
      }
      if (onClearInitialTenantId) {
        onClearInitialTenantId();
      }
    }
  }, [initialTenantId, tenants, onClearInitialTenantId]);

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
    
    // Auto select first vacant room
    const firstVacant = rooms.find(r => r.status === 'vacant');
    setSelectedRoomId(firstVacant ? firstVacant.id : '');
    setIsAddOpen(true);
  };

  const handleAddCoOccupant = () => {
    if (coName && coPhone) {
      const newCo: CoOccupant = {
        id: `co-${Date.now()}`,
        name: coName.trim(),
        phone: coPhone.trim()
      };
      setCoOccupants([...coOccupants, newCo]);
      setCoName('');
      setCoPhone('');
      setCoCitizen('');
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

    setTimeout(() => {
      const tenantId = selectedTenant.id;
      const tenantName = selectedTenant.name;
      const room = rooms.find(r => r.currentTenantId === tenantId);
      const roomNumber = room ? room.roomNumber : '';
      const parsedDamageFee = Number(damageFee) || 0;

      // 1. Update room status to vacant and clear currentTenantId
      const updatedRooms = rooms.map(r => r.currentTenantId === tenantId ? {
        ...r,
        status: 'vacant' as const,
        currentTenantId: undefined,
        updatedAt: new Date().toISOString()
      } : r);

      // 2. Set tenant status to inactive (DO NOT delete history)
      const updatedTenants = tenants.map(t => t.id === tenantId ? {
        ...t,
        status: 'inactive' as const,
        updatedAt: new Date().toISOString()
      } : t);

      // 3. Update contract status to 'expired'
      const updatedContracts = contracts.map(c => {
        if (c.tenantId === tenantId && (c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out' || c.status === 'pending_signature')) {
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
        b => b.tenantId === tenantId && b.status !== 'paid' && b.status !== 'cancelled'
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
            amount: room ? room.monthlyRent : 0,
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
          id: `bill-final-${tenantId}-${Date.now()}`,
          billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
          cycleId: currentCycle,
          roomId: room ? room.id : '',
          tenantId: tenantId,
          items: finalBillItems,
          totalAmount: totalBillAmount,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        updatedBills.push(newFinalBill);
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
      const detailLog = `ผู้เช่า ${tenantName} เลิกเช่าคืนห้องพัก (ห้อง ${roomNumber}) - สถานะห้อง: ว่าง, สัญญา: หมดอายุ, เงินประกันคืน: ${refundDeposit ? 'คืนเงินประกัน' : 'ไม่คืน'}, หักค่าเสียหาย: ${parsedDamageFee} บาท`;
      onAddLog('เลิกเช่าคืนห้อง', detailLog, 'Tenant', tenantId);

      // 7. Close modals and clear selection
      setIsSuccessAnimating(false);
      setIsTerminateOpen(false);
      setSelectedTenant(null);
    }, 1200);
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
            return { ...c, roomId: newRoom.id, updatedAt: new Date().toISOString(), terms: `${c.terms || ''}\n[ระบบนิติ] ย้ายห้องพักจากห้อง ${oldRoom.roomNumber} ไปยังห้อง ${newRoom.roomNumber} เมื่อ ${new Date().toLocaleDateString('th-TH')}${additionalNote ? ` / หมายเหตุ: ${additionalNote}` : ''}` };
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

  const handleSaveEditTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !citizenId.trim()) {
      setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
      return;
    }

    if (selectedTenant) {
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
        vehicle: {
          type: vehicleType,
          licensePlate: vehiclePlate.trim(),
          brand: vehicleBrand.trim()
        },
        pet: {
          hasPet,
          type: hasPet ? petType.trim() : undefined,
          name: hasPet ? petName.trim() : undefined
        },
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

  // Filter tenants by search query and billing cycle
  const filteredTenants = tenants.filter(t => {
    if (!isTenantInCycle(t)) return false;

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
    return currentRoom ? currentRoom.roomNumber : 'ไม่ระบุห้อง';
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      
      {/* Left column: List of tenants */}
      <div className={`lg:col-span-1 bg-white p-5 rounded-3xl border border-gray-100 shadow-xs flex flex-col h-[700px] ${
        selectedTenant ? 'hidden lg:flex' : 'flex'
      }`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-base font-extrabold text-slate-900">ทะเบียนผู้เช่า ({filteredTenants.length})</h3>
          <button
            onClick={handleOpenAddWizard}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-xs shrink-0"
            title="จดทะเบียนผู้เช่าและย้ายเข้า"
          >
            <Plus className="w-4 h-4" />
          </button>
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
                  <span>กลับไปยังหน้าบันทึก "จดมิเตอร์"</span>
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
                          <span className="break-all truncate" title={selectedTenant.email}>{selectedTenant.email || 'ไม่มีข้อมูล'}</span>
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
                          <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact.name}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-400 font-medium text-[10px]">ความสัมพันธ์:</span>
                          <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact.relationship}</p>
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="text-gray-400 font-medium text-[10px]">เบอร์โทรติดต่อ:</span>
                          <p className="font-extrabold text-indigo-600 text-[11px] sm:text-xs break-all">{formatPhone(selectedTenant.emergencyContact.phone)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Vehicles and Pets */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Vehicle */}
                      <div className="p-4 border border-gray-100 rounded-2xl text-xs space-y-3.5">
                        <h4 className="font-black text-slate-800 flex items-center gap-1.5 border-b border-gray-100 pb-2">
                          <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                          ข้อมูลยานพาหนะ
                        </h4>
                        {selectedTenant.vehicle.type !== 'none' ? (
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
                        {selectedTenant.pet.hasPet ? (
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
                          selectedTenant.idCardPhotoMock && 
                          selectedTenant.idCardPhotoMock.trim() !== '' && 
                          selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
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
                                Unverified
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
                      <h4 className="text-xs font-bold text-slate-800">ผู้พักอาศัยร่วมประสงค์ขอแจ้งบันทึก ({selectedTenant.coOccupants.length} คน)</h4>
                       {selectedTenant.coOccupants.map((co, index) => (
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
                      {selectedTenant.coOccupants.length === 0 && (
                        <p className="text-center py-12 text-xs text-gray-400">พักอาศัยเพียงท่านเดียว (ไม่มีประวัติแจ้งผู้พักร่วม)</p>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

            <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 shrink-0">
              <span>จดบันทึกเข้าระบบเมื่อ: {selectedTenant.createdAt.split('T')[0]}</span>
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

            {selectedTenant.idCardPhotoMock && selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64' ? (
              <div className="w-full max-w-[420px] bg-slate-50 border border-gray-200 rounded-2xl overflow-hidden p-2 relative shadow-md">
                <img src={selectedTenant.idCardPhotoMock} alt="เอกสารประจำตัวผู้เช่า" className="w-full h-auto max-h-[280px] object-contain rounded-lg mx-auto" />
                <div className="absolute top-4 right-4 bg-emerald-600 text-white text-[9px] font-bold px-2 py-1 rounded-md shadow">
                  เอกสารจริงจากระบบ
                </div>
              </div>
            ) : (
              <div className="w-full max-w-[420px] p-8 border-2 border-dashed border-gray-200 rounded-2xl bg-slate-50 flex flex-col items-center justify-center text-center space-y-3">
                <FileText className="w-12 h-12 text-slate-400" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-700">ยังไม่ได้อัปโหลดไฟล์ภาพบัตรประชาชน</p>
                  <p className="text-[10px] text-gray-400">คุณสามารถแก้ไขข้อมูลผู้เช่าเพื่อทำการอัปโหลดไฟล์สำเนาจริงได้</p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 pt-2 w-full">
              <button 
                onClick={() => {
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
                            ? `<img src="${photoUrl}" class="card-img" alt="สำเนาบัตรประชาชน" />` 
                            : `<div class="no-img">( ไม่ได้แนบไฟล์ภาพถ่ายสำเนาบัตรประชาชน )</div>`}
                        </div>

                        <div class="section-title">ข้อมูลส่วนตัวผู้เช่า</div>
                        <table class="info-grid">
                          <tr><td class="label">ชื่อ-นามสกุล:</td><td class="value">${selectedTenant.name}</td></tr>
                          <tr><td class="label">เลขประจำตัวประชาชน:</td><td class="value">${selectedTenant.citizenId || '-'}</td></tr>
                          <tr><td class="label">เบอร์โทรศัพท์:</td><td class="value">${selectedTenant.phone}</td></tr>
                          <tr><td class="label">อีเมล:</td><td class="value">${selectedTenant.email || '-'}</td></tr>
                          <tr><td class="label">ผู้ติดต่อฉุกเฉิน:</td><td class="value">${selectedTenant.emergencyContact?.name || '-'} (${selectedTenant.emergencyContact?.relationship || '-'}) เบอร์: ${selectedTenant.emergencyContact?.phone || '-'}</td></tr>
                        </table>

                        <div class="footer-note">เอกสารนี้พิมพ์จากระบบบริหารจัดการหอพัก เมื่อ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} น.</div>
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

      {/* Add Tenant Notice Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="จดทะเบียนผู้เช่าและย้ายเข้า" size="md">
        <div className="space-y-5 text-center py-2">
          {/* Green LINE Icon Badge */}
          <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 rounded-3xl flex items-center justify-center mx-auto text-emerald-600 shadow-xs">
            <QrCode className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <h3 className="text-base font-black text-slate-900">
              ให้ผู้เช่าสมัครและลงทะเบียนผ่าน LINE หอพัก
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto font-medium">
              ระบบถูกออกแบบให้ผู้เช่าเป็นผู้ลงทะเบียนและย้ายเข้าด้วยตนเองผ่าน <span className="font-bold text-emerald-600">LINE Official Account</span> ของหอพัก เพื่อความถูกต้องของข้อมูล การแนบเอกสารยืนยันตัวตน และทำสัญญาเช่าออนไลน์ได้ทันที
            </p>
          </div>

          {/* Quick Steps Box */}
          <div className="bg-slate-50 border border-slate-200/70 rounded-2xl p-4 text-left space-y-2.5">
            <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              ขั้นตอนการลงทะเบียนสำหรับผู้เช่าใหม่
            </h4>
            <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside pl-1 font-medium">
              <li>แอดไลน์หอพัก หรือสแกน <span className="font-bold text-slate-800">QR Code หอพัก</span></li>
              <li>เลือกเมนู <span className="font-bold text-slate-800">"ลงทะเบียนผู้เช่า / ทำสัญญาเช่า"</span></li>
              <li>กรอกข้อมูล แนบรูปบัตรประชาชน เลือกห้องพัก และทำสัญญาเช่าด้วยตนเอง</li>
            </ol>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              เข้าใจแล้ว
            </button>
          </div>

          {copySuccessToast && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-xl animate-fade-in">
              {copySuccessToast}
            </div>
          )}
        </div>
      </Modal>

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
                    {(() => {
                      const dormObj = getDormitory();
                      let pPolicy = dormObj?.petPolicy;
                      if (!pPolicy) {
                        try {
                          const saved = localStorage.getItem('registered_dorm_profile');
                          if (saved) pPolicy = JSON.parse(saved).petPolicy;
                        } catch {}
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
                    const dormObj = getDormitory();
                    let pPolicy = dormObj?.petPolicy;
                    if (!pPolicy) {
                      try {
                        const saved = localStorage.getItem('registered_dorm_profile');
                        if (saved) pPolicy = JSON.parse(saved).petPolicy;
                      } catch {}
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
                          if (activeCon) {
                            return `${formatThaiDate(activeCon.startDate)} ถึง ${formatThaiDate(activeCon.endDate)} (รวม ${activeCon.durationMonths} เดือน)`;
                          }
                          return `เริ่มเข้าพักเมื่อ: ${formatThaiDate(selectedTenant.createdAt.split('T')[0])}`;
                        })()}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาที่อยู่อาศัยมาแล้ว (จนถึงปัจจุบัน):</p>
                      <p className="font-extrabold text-xs text-indigo-700 mt-0.5">
                        {(() => {
                          const tContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);
                          const activeCon = tContracts.find(c => c.status === 'active' || c.status === 'expiring_soon') || tContracts[0];
                          const start = activeCon ? activeCon.startDate : selectedTenant.createdAt.split('T')[0];
                          return getStayDurationText(start);
                        })()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Move-Out Request Details & Actual End Date Confirmation */}
                {(() => {
                  const stored = typeof window !== 'undefined' ? localStorage.getItem(`tenant_moveout_request_${selectedTenant.id}`) : null;
                  const reqInfo = stored ? JSON.parse(stored) : null;

                  return (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-2xl space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-900">คำขอแจ้งย้ายออกของผู้เช่า (ถ้ามี)</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">
                          {reqInfo ? 'มีคำขอรอยืนยัน' : 'ไม่มีคำขอแจ้งย้ายออก'}
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
                        <input
                          id="actualEndDateInput"
                          type="date"
                          value={additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0]}
                          onChange={(e) => setAdditionalNote(`วันที่สิ้นสุดจริง: ${e.target.value}`)}
                          className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
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
                    <input
                      type="date"
                      value={additionalNote?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0]}
                      onChange={(e) => setAdditionalNote(`วันที่ย้าย: ${e.target.value}`)}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-xl bg-white text-slate-900 font-semibold"
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
                citizenId.trim() !== selectedTenant.citizenId ||
                emergencyName.trim() !== selectedTenant.emergencyContact.name ||
                emergencyRelation.trim() !== selectedTenant.emergencyContact.relationship ||
                emergencyPhone.trim() !== selectedTenant.emergencyContact.phone ||
                vehicleType !== selectedTenant.vehicle.type ||
                vehiclePlate.trim() !== (selectedTenant.vehicle.licensePlate || '') ||
                vehicleBrand.trim() !== (selectedTenant.vehicle.brand || '') ||
                hasPet !== selectedTenant.pet.hasPet ||
                (hasPet && petType.trim() !== (selectedTenant.pet.type || '')) ||
                (hasPet && petName.trim() !== (selectedTenant.pet.name || '')) ||
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

    </div>
  );
};
