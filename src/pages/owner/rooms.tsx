/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Grid,
  List,
  Layers,
  Filter,
  Plus,
  Edit2,
  Trash2,
  Search,
  AlertCircle,
  User as UserIcon,
  UserPlus,
  CheckCircle2,
  Clock,
  Wrench,
  Ban,
  Phone,
  CreditCard,
  Calendar,
  FileText,
  Check,
  MessageCircle,
  QrCode,
  Info,
  Copy,
  Coins,
  ShieldCheck,
  DoorOpen
} from 'lucide-react';
import {
  formatBaht,
  Modal,
  ConfirmDialog
} from '../../components/GlobalComponents';
import { VersionConflictModal } from '../../components/VersionConflictModal';
import { getDataProvider } from '../../data/dataProvider';
import { CreateRoomPayload, UpdateRoomChanges } from '../../data/contracts';
import { getOwnerRoomMutationErrorMessage } from '../../lib/roomErrorMapper';
import { getGridRentRates, getListRentRates, getDepositForCycle } from '../../lib/roomRentalSummary';
import { RoomMutationImpact } from '../../lib/roomMutationCache';
import { Room, Building, RoomStatus, Tenant, Contract, Bill, BLOCKING_CONTRACT_STATUSES } from '../../types';

interface OwnerRoomsProps {
  rooms: Room[];
  tenants?: Tenant[];
  contracts?: Contract[];
  bills?: Bill[];
  buildings: Building[];
  onSaveRooms: (rooms: Room[], impact?: RoomMutationImpact) => void;
  onSaveTenants?: (tenants: Tenant[]) => void;
  onSaveContracts?: (contracts: Contract[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onNavigate: (tab: string, param?: string) => void;
  initialRoomId?: string;
  onClearInitialRoomId?: () => void;
}

const ROOM_STATUS_CONFIG: Record<string, {
  label: string;
  subLabel: string;
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  activeBtnBg: string;
}> = {
  vacant: {
    label: 'ว่าง',
    subLabel: 'ห้องว่าง',
    bg: 'bg-emerald-50/70 hover:bg-emerald-100/70',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    activeBtnBg: 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
  },
  occupied: {
    label: 'มีผู้เช่า',
    subLabel: 'มีผู้เช่า',
    bg: 'bg-indigo-50/70 hover:bg-indigo-100/70',
    border: 'border-indigo-200',
    text: 'text-indigo-900',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    activeBtnBg: 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
  },
  maintenance: {
    label: 'ปิดปรับปรุง',
    subLabel: 'ปิดปรับปรุง',
    bg: 'bg-rose-50/70 hover:bg-rose-100/70',
    border: 'border-rose-200',
    text: 'text-rose-900',
    badgeBg: 'bg-rose-100',
    badgeText: 'text-rose-800',
    activeBtnBg: 'bg-rose-600 text-white border-rose-600 shadow-xs'
  }
};

export const OwnerRooms: React.FC<OwnerRoomsProps> = ({
  rooms,
  tenants = [],
  contracts = [],
  bills = [],
  buildings,
  onSaveRooms,
  onSaveTenants,
  onSaveContracts,
  onAddLog,
  onNavigate,
  initialRoomId,
  onClearInitialRoomId
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'floor'>('grid');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Create / Edit modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deleteConfirmData, setDeleteConfirmData] = useState<{ roomId: string; roomNum: string; message: string } | null>(null);


  // Quick Add Tenant Modal state
  const [isAddTenantModalOpen, setIsAddTenantModalOpen] = useState(false);
  const [selectedRoomForTenant, setSelectedRoomForTenant] = useState<Room | null>(null);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantPhone, setNewTenantPhone] = useState('');
  const [newTenantIdCard, setNewTenantIdCard] = useState('');
  const [newTenantStartDate, setNewTenantStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTenantDuration, setNewTenantDuration] = useState(6);
  const [newTenantRent, setNewTenantRent] = useState(4500);
  const [newTenantDeposit, setNewTenantDeposit] = useState(9000);
  const [newTenantDepositStatus, setNewTenantDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [newTenantNotes, setNewTenantNotes] = useState('');
  const [addTenantError, setAddTenantError] = useState<string | null>(null);

  // Form Fields
  const [roomNumber, setRoomNumber] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [floor, setFloor] = useState(1);
  const [monthlyRent, setMonthlyRent] = useState<number | ''>(4500);
  const [termRent, setTermRent] = useState<number | ''>(18000);
  const [dailyRent, setDailyRent] = useState<number | ''>(500);
  const [rentCycle, setRentCycle] = useState<'term' | 'monthly' | 'daily'>('monthly');
  const [termDeposit, setTermDeposit] = useState<number | ''>(9000);
  const [monthlyDeposit, setMonthlyDeposit] = useState<number | ''>(9000);
  const [dailyDeposit, setDailyDeposit] = useState<number | ''>(1000);
  const [maxOccupants, setMaxOccupants] = useState(2);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('vacant');
  const [initialWaterMeter, setInitialWaterMeter] = useState(100);
  const [initialElectricMeter, setInitialElectricMeter] = useState(1200);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);
  const [versionConflictState, setVersionConflictState] = useState<{
    isOpen: boolean;
    entityName: string;
    currentVersion?: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (toastMessage) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setToastMessage(null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toastMessage]);

  // Handle open modal
  const handleOpenModal = (room: Room | null = null) => {
    setErrorText(null);
    if (room) {
      setEditingRoom(room);
      setRoomNumber(room.roomNumber);
      setBuildingId(room.buildingId || '');
      setFloor(room.floor);
      setMonthlyRent(room.monthlyRent || 0);
      setTermRent(room.termRent || (room.monthlyRent ? room.monthlyRent * 4 : 18000));
      setDailyRent(room.dailyRent || 500);
      setRentCycle(room.rentCycle || 'monthly');
      setTermDeposit(room.termDeposit ?? room.depositAmount ?? 9000);
      setMonthlyDeposit(room.monthlyDeposit ?? room.depositAmount ?? 9000);
      setDailyDeposit(room.dailyDeposit ?? (room.dailyRent ? Number(room.dailyRent) * 2 : 1000));
      setMaxOccupants(room.maxOccupants || 2);
      setRoomStatus(room.status || 'vacant');
      setInitialWaterMeter(room.initialWaterMeter || 100);
      setInitialElectricMeter(room.initialElectricMeter || 1200);
    } else {
      setEditingRoom(null);
      setRoomNumber('');
      setBuildingId(buildings[0]?.id || '');
      setFloor(1);
      setMonthlyRent(4500);
      setTermRent(18000);
      setDailyRent(500);
      setRentCycle('monthly');
      setTermDeposit(9000);
      setMonthlyDeposit(9000);
      setDailyDeposit(1000);
      setMaxOccupants(2);
      setRoomStatus('vacant');
      setInitialWaterMeter(100);
      setInitialElectricMeter(1200);
    }
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (initialRoomId) {
      const room = rooms.find(r => r.id === initialRoomId);
      if (room) {
        handleOpenModal(room);
      }
      onClearInitialRoomId?.();
    }
  }, [initialRoomId, rooms]);

  const isFormModified = React.useMemo(() => {
    if (!editingRoom) {
      return roomNumber.trim().length > 0;
    }
    const origMonthlyRent = editingRoom.monthlyRent || 0;
    const origTermRent = editingRoom.termRent || (editingRoom.monthlyRent ? editingRoom.monthlyRent * 4 : 18000);
    const origDailyRent = editingRoom.dailyRent || 500;
    const origTermDeposit = editingRoom.termDeposit ?? editingRoom.depositAmount ?? 0;
    const origMonthlyDeposit = editingRoom.monthlyDeposit ?? editingRoom.depositAmount ?? 0;
    const origDailyDeposit = editingRoom.dailyDeposit ?? 0;
    const origMaxOccupants = editingRoom.maxOccupants || 2;
    const origStatus = editingRoom.status || 'vacant';

    const curMonthly = monthlyRent === '' ? 0 : Number(monthlyRent);
    const curTerm = termRent === '' ? (curMonthly * 4) : Number(termRent);
    const curDaily = dailyRent === '' ? 500 : Number(dailyRent);
    const curTermDeposit = termDeposit === '' ? 0 : Number(termDeposit);
    const curMonthlyDeposit = monthlyDeposit === '' ? 0 : Number(monthlyDeposit);
    const curDailyDeposit = dailyDeposit === '' ? 0 : Number(dailyDeposit);

    const hasChanged =
      roomNumber.trim() !== editingRoom.roomNumber ||
      curMonthly !== origMonthlyRent ||
      curTerm !== origTermRent ||
      curDaily !== origDailyRent ||
      curTermDeposit !== origTermDeposit ||
      curMonthlyDeposit !== origMonthlyDeposit ||
      curDailyDeposit !== origDailyDeposit ||
      Number(maxOccupants) !== origMaxOccupants ||
      roomStatus !== origStatus;

    return hasChanged;
  }, [
    editingRoom,
    roomNumber,
    monthlyRent,
    termRent,
    dailyRent,
    termDeposit,
    monthlyDeposit,
    dailyDeposit,
    maxOccupants,
    roomStatus
  ]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!roomNumber.trim()) {
      const err = 'กรุณากรอกเลขห้องพัก';
      setErrorText(err);
      const formEl = document.getElementById('room-edit-form');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Check duplicate room number
    const isDuplicate = rooms.some(r => (r?.roomNumber || '').toLowerCase() === roomNumber.trim().toLowerCase() && r.id !== editingRoom?.id);
    if (isDuplicate) {
      const err = `เลขห้อง "${roomNumber}" นี้ได้รับการบันทึกในระบบแล้ว`;
      setErrorText(err);
      const formEl = document.getElementById('room-edit-form');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (monthlyRent <= 0) {
      const err = 'กรุณากรอกค่าเช่ารายเดือนให้ถูกต้อง';
      setErrorText(err);
      const formEl = document.getElementById('room-edit-form');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // Validation: ปิดปรับปรุง ต้องไม่มีผู้เช่า/ว่าง เท่านั้นถึงจะบันทึกข้อมูลได้
    if (roomStatus === 'maintenance' && editingRoom?.currentTenantId) {
      const tenant = tenants.find(t => t.id === editingRoom.currentTenantId);
      const err = `ไม่สามารถเปลี่ยนสถานะเป็น "ปิดปรับปรุง" ได้ เนื่องจากห้องพักนี้มีผู้เช่าอยู่ (${tenant ? tenant.name : 'มีผู้เช่าผูกอยู่'}) ต้องเป็นห้องว่างเท่านั้น`;
      setErrorText(err);
      const formEl = document.getElementById('room-edit-form');
      if (formEl) formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const digitsOnly = roomNumber.replace(/\D/g, '');
    const calculatedFloor = Number(floor) || (digitsOnly ? (parseInt(digitsOnly.charAt(0)) || 1) : 1);

    // Calculate effective status based on operational vs maintenance
    let effectiveStatus: RoomStatus = roomStatus;
    if (roomStatus === 'maintenance') {
      effectiveStatus = 'maintenance';
    } else if (editingRoom?.currentTenantId) {
      effectiveStatus = 'occupied';
    } else {
      effectiveStatus = 'vacant';
    }

    setIsSubmitting(true);
    const dataProvider = getDataProvider();
    const propertyApi = dataProvider.properties;

    if (!propertyApi) {
      setErrorText('ระบบไม่สามารถเชื่อมต่อบริการจัดการห้องพักหลักได้ (PropertyDataSource unavailable)');
      setIsSubmitting(false);
      return;
    }

    try {
      if (editingRoom) {
        // Update Room via authoritative backend API
        const expectedVersion = editingRoom.version || 1;
        const changes: UpdateRoomChanges = {
          roomNumber: roomNumber.trim(),
          buildingId: buildingId || editingRoom.buildingId || undefined,
          floor: calculatedFloor,
          status: effectiveStatus,
          rentCycle,
          monthlyRent: monthlyRent === '' ? null : String(monthlyRent),
          termRent: termRent === '' ? null : String(termRent),
          dailyRent: dailyRent === '' ? null : String(dailyRent),
          termDeposit: termDeposit === '' ? null : String(termDeposit),
          monthlyDeposit: monthlyDeposit === '' ? null : String(monthlyDeposit),
          dailyDeposit: dailyDeposit === '' ? null : String(dailyDeposit),
          depositAmount: monthlyDeposit === '' ? null : String(monthlyDeposit),
          maximumOccupants: Number(maxOccupants) || 2,
          initialWaterReading: String(initialWaterMeter || 0),
          initialElectricityReading: String(initialElectricMeter || 0),
        };

        const roomNumberChanged = roomNumber.trim() !== editingRoom.roomNumber;
        const res = await propertyApi.updateRoom(editingRoom.id, changes, expectedVersion);

        if (!res.success) {
          if (res.error?.code === 'CONFLICT') {
            const details = res.error.details as { currentVersion?: number; error?: { currentVersion?: number } } | undefined;
            const serverVersion = details?.currentVersion ?? details?.error?.currentVersion;
            setVersionConflictState({
              isOpen: true,
              entityName: `ห้อง ${editingRoom.roomNumber}`,
              currentVersion: serverVersion,
            });
          } else {
            setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูลห้องพัก');
          }
          setIsSubmitting(false);
          return;
        }

        onAddLog('แก้ไขห้องพัก', `แก้ไขรายละเอียดห้อง ${roomNumber}`, 'Room', editingRoom.id);
        onSaveRooms(rooms, { kind: 'update', roomNumberChanged });
        setIsModalOpen(false);
        setToastMessage(`เลขห้อง "${roomNumber.trim()}" นี้ได้รับการบันทึกในระบบแล้ว`);
        setTimeout(() => setToastMessage(null), 3500);
      } else {
        // Create Room via authoritative backend API
        const effectiveBuildingId = buildingId || (buildings && buildings[0]?.id ? buildings[0].id : '');
        if (!effectiveBuildingId) {
          setErrorText('ไม่พบข้อมูลอาคารในหอพักนี้ กรุณาสร้างอาคารก่อนเพิ่มห้องพัก');
          setIsSubmitting(false);
          return;
        }

        const payload: CreateRoomPayload = {
          buildingId: effectiveBuildingId,
          roomNumber: roomNumber.trim(),
          floor: calculatedFloor,
          roomType: 'standard',
          status: effectiveStatus,
          rentCycle,
          monthlyRent: monthlyRent === '' ? null : String(monthlyRent),
          termRent: termRent === '' ? null : String(termRent),
          dailyRent: dailyRent === '' ? null : String(dailyRent),
          termDeposit: termDeposit === '' ? null : String(termDeposit),
          monthlyDeposit: monthlyDeposit === '' ? null : String(monthlyDeposit),
          dailyDeposit: dailyDeposit === '' ? null : String(dailyDeposit),
          depositAmount: monthlyDeposit === '' ? null : String(monthlyDeposit),
          maximumOccupants: Number(maxOccupants) || 2,
          initialWaterReading: String(initialWaterMeter || 0),
          initialElectricityReading: String(initialElectricMeter || 0),
        };

        const res = await propertyApi.createRoom(payload);

        if (!res.success) {
          setErrorText(res.error?.message || 'เกิดข้อผิดพลาดในการสร้างห้องพัก');
          setIsSubmitting(false);
          return;
        }

        const createdRoom = res.data;
        onAddLog('เพิ่มห้องพักใหม่', `สร้างเลขห้อง ${roomNumber} ใหม่ในระบบ`, 'Room', createdRoom?.id || '');
        onSaveRooms(rooms, { kind: 'create' });
        setIsModalOpen(false);
        setToastMessage(`เลขห้อง "${roomNumber.trim()}" นี้ได้รับการบันทึกในระบบแล้ว`);
        setTimeout(() => setToastMessage(null), 3500);
      }
    } catch (err: unknown) {
      setErrorText((err as Error)?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFromModal = (roomId: string, roomNum: string) => {
    const targetRoom = rooms.find(r => r.id === roomId || r.roomNumber === roomNum);
    if (!targetRoom) return;

    const infoList: string[] = [];

    // Check 1: Tenant assigned
    if (targetRoom.currentTenantId) {
      const tenant = tenants.find(t => t.id === targetRoom.currentTenantId);
      infoList.push(`ผู้เช่าปัจจุบัน: ${tenant ? tenant.name : targetRoom.currentTenantId}`);
    }

    // Check 2: Active or blocking contracts
    if (contracts && contracts.length > 0) {
      const activeContracts = contracts.filter(
        c => (c.roomId === targetRoom.id || c.roomId === targetRoom.roomNumber) &&
          BLOCKING_CONTRACT_STATUSES.includes(c.status)
      );
      if (activeContracts.length > 0) {
        infoList.push(`มีสัญญาเช่าในระบบ ${activeContracts.length} ฉบับ`);
      }
    }

    // Check 3: Associated bills
    if (bills && bills.length > 0) {
      const roomBills = bills.filter(b => b.roomId === targetRoom.id || b.roomNumber === targetRoom.roomNumber);
      if (roomBills.length > 0) {
        infoList.push(`มีประวัติใบแจ้งชำระ/บิลในระบบ ${roomBills.length} รายการ`);
      }
    }

    let confirmPrompt = `คุณแน่ใจหรือไม่ว่าต้องการจัดเก็บห้องพัก ${roomNum} ออกจากระบบ? (ห้องพักที่ถูกจัดเก็บจะไม่แสดงในรายการห้องว่าง)`;
    if (infoList.length > 0) {
      confirmPrompt = `คำเตือน: ห้องพัก ${roomNum} มีข้อมูลผูกอยู่ในระบบ:\n\n• ` + infoList.join('\n• ') + `\n\nคุณยังคงต้องการยืนยันจัดเก็บห้องพัก ${roomNum} ออกจากระบบหรือไม่?`;
    }

    setDeleteConfirmData({
      roomId: targetRoom.id,
      roomNum,
      message: confirmPrompt
    });
  };

  const executeDeleteRoom = async () => {
    if (!deleteConfirmData) return;
    const { roomId, roomNum } = deleteConfirmData;
    const targetRoom = rooms.find(r => r.id === roomId || r.roomNumber === roomNum);
    const expectedVersion = targetRoom?.version || 1;
    setIsSubmitting(true);

    const dataProvider = getDataProvider();
    const propertyApi = dataProvider.properties;

    if (!propertyApi) {
      setToastMessage('ระบบไม่สามารถเชื่อมต่อบริการจัดการห้องพักหลักได้ (PropertyDataSource unavailable)');
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await propertyApi.archiveRoom(roomId, expectedVersion);

      if (!res.success) {
        if (res.error?.code === 'CONFLICT') {
          const details = res.error.details as { currentVersion?: number; error?: { currentVersion?: number } } | undefined;
          const serverVersion = details?.currentVersion ?? details?.error?.currentVersion;
          setVersionConflictState({
            isOpen: true,
            entityName: `ห้อง ${roomNum}`,
            currentVersion: serverVersion,
          });
        } else if ((res.error?.details as { code?: string } | undefined)?.code === 'ROOM_HAS_ACTIVE_TENANT' || res.error?.message?.includes('ผู้เช่า')) {
          setToastMessage(res.error?.message || 'ไม่สามารถยกเลิกห้องที่มีผู้เช่าอยู่ได้');
        } else {
          setToastMessage(res.error?.message || 'เกิดข้อผิดพลาดในการจัดเก็บห้องพัก');
        }
        setIsSubmitting(false);
        return;
      }

      onSaveRooms(rooms, { kind: 'archive' });
      onAddLog('จัดเก็บห้องพัก', `จัดเก็บห้องเลขที่ ${roomNum} (Archive)`, 'Room', roomId);
      setIsModalOpen(false);
      setEditingRoom(null);
      setDeleteConfirmData(null);
      setToastMessage(`จัดเก็บห้องพัก "${roomNum}" เรียบร้อยแล้ว`);
      setTimeout(() => {
        setToastMessage(null);
      }, 3500);
    } catch (err: unknown) {
      setToastMessage((err as Error)?.message || 'เกิดข้อผิดพลาดในการจัดเก็บห้องพัก');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRoomStatus = async (roomId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetRoom = rooms.find(r => r.id === roomId);
    if (!targetRoom) return;

    // Rule: ถ้ามีผู้เช่าอยู่ให้เปิดค้างไว้
    if (targetRoom.currentTenantId) {
      const tenant = tenants.find(t => t.id === targetRoom.currentTenantId);
      setToastMessage(`ห้อง ${targetRoom.roomNumber} มีผู้เช่าพักอยู่ (${tenant ? tenant.name : 'มีผู้เช่า'}) - ระบบเปิดใช้งานค้างไว้`);
      return;
    }

    // Rule: ถ้าห้องนั้น ว่างให้ปิดได้ = ปิดปรับปรุง / เปิดใช้งาน
    const nextStatus: RoomStatus = targetRoom.status === 'maintenance' ? 'vacant' : 'maintenance';
    const expectedVersion = targetRoom.version || 1;

    const dataProvider = getDataProvider();
    const propertyApi = dataProvider.properties;

    if (!propertyApi) {
      setToastMessage('ระบบไม่สามารถเชื่อมต่อบริการจัดการห้องพักหลักได้ (PropertyDataSource unavailable)');
      return;
    }

    try {
      const res = await propertyApi.updateRoom(targetRoom.id, { status: nextStatus }, expectedVersion);

      if (!res.success) {
        if (res.error?.code === 'CONFLICT') {
          const details = res.error.details as { currentVersion?: number; error?: { currentVersion?: number } } | undefined;
          const serverVersion = details?.currentVersion ?? details?.error?.currentVersion;
          setVersionConflictState({
            isOpen: true,
            entityName: `ห้อง ${targetRoom.roomNumber}`,
            currentVersion: serverVersion,
          });
        } else {
          setToastMessage(res.error?.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะห้อง');
        }
        return;
      }

      onSaveRooms(rooms, { kind: 'status' });
      onAddLog(
        'เปลี่ยนสถานะห้องพัก',
        `เปลี่ยนสถานะห้อง ${targetRoom.roomNumber} เป็น "${nextStatus === 'maintenance' ? 'ปิดปรับปรุง' : 'เปิดใช้งาน'}"`,
        'Room',
        roomId
      );
      setToastMessage(`ห้อง ${targetRoom.roomNumber}: เปลี่ยนเป็น "${nextStatus === 'maintenance' ? 'ปิดปรับปรุง' : 'เปิดใช้งาน'}" เรียบร้อยแล้ว`);
    } catch (err: unknown) {
      setToastMessage((err as Error)?.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะห้อง');
    }
  };

  // Open Quick Add Tenant modal or Navigate to Tenant Profile
  const handleTenantAction = (room: Room, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (room.currentTenantId) {
      // Room has tenant -> Navigate to tenant detail in tenants tab
      onNavigate('tenants', room.currentTenantId);
    } else {
      // Room is vacant or maintenance -> Open quick add tenant modal
      setSelectedRoomForTenant(room);
      setNewTenantName('');
      setNewTenantPhone('');
      setNewTenantIdCard('');
      setNewTenantStartDate(new Date().toISOString().split('T')[0]);
      setNewTenantDuration(6);
      setNewTenantRent(room.monthlyRent || 4500);
      setNewTenantDeposit(room.depositAmount || 9000);
      setNewTenantDepositStatus('paid');
      setNewTenantNotes('');
      setAddTenantError(null);
      setIsAddTenantModalOpen(true);
    }
  };

  const handleSaveNewTenant = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoomForTenant) return;
    setAddTenantError(null);

    if (!newTenantName.trim()) {
      setAddTenantError('กรุณากรอกชื่อ-นามสกุลของผู้เช่า');
      return;
    }

    if (!newTenantPhone.trim()) {
      setAddTenantError('กรุณากรอกเบอร์โทรศัพท์ของผู้เช่า');
      return;
    }

    const timestamp = Date.now();
    const newTenantId = `tenant-${timestamp}`;
    const newContractId = `contract-${timestamp}`;

    // Calculate contract end date
    const start = new Date(newTenantStartDate);
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(newTenantDuration));
    const calculatedEndDate = end.toISOString().split('T')[0];

    const newTenant: Tenant = {
      id: newTenantId,
      name: newTenantName.trim(),
      phone: newTenantPhone.trim(),
      email: '',
      citizenId: newTenantIdCard.trim() || '',
      coOccupants: [],
      emergencyContact: {
        name: '',
        relationship: '',
        phone: ''
      },
      vehicle: {
        type: 'none',
        licensePlate: ''
      },
      pet: {
        hasPet: false
      },
      rentalHistory: [selectedRoomForTenant.id],
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newContract: Contract = {
      id: newContractId,
      contractNumber: `CTR-${Date.now().toString().slice(-6)}`,
      tenantId: newTenantId,
      roomId: selectedRoomForTenant.id,
      startDate: newTenantStartDate,
      endDate: calculatedEndDate,
      durationMonths: Number(newTenantDuration),
      rentAmount: Number(newTenantRent),
      depositAmount: Number(newTenantDeposit),
      depositStatus: newTenantDepositStatus,
      depositType: 'refundable',
      status: 'active',
      terms: 'สัญญาเช่าห้องพักมาตรฐาน',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 1. Update room status to occupied
    const updatedRooms = rooms.map(r => r.id === selectedRoomForTenant.id ? {
      ...r,
      status: 'occupied' as RoomStatus,
      currentTenantId: newTenantId,
      depositStatus: newTenantDepositStatus,
      updatedAt: new Date().toISOString()
    } : r);
    onSaveRooms(updatedRooms, { kind: 'refresh' });

    // 2. Save tenant
    if (onSaveTenants) {
      onSaveTenants([...tenants, newTenant]);
    }

    // 3. Save contract
    if (onSaveContracts) {
      onSaveContracts([...contracts, newContract]);
    }

    onAddLog(
      'เพิ่มผู้เช่าใหม่',
      `เพิ่มผู้เช่า ${newTenant.name} เข้าห้องพัก ${selectedRoomForTenant.roomNumber} (สัญญา ${newTenantDuration} เดือน)`,
      'Tenant',
      newTenantId
    );

    setIsAddTenantModalOpen(false);
    setSelectedRoomForTenant(null);
    setToastMessage(`เพิ่มผู้เช่า "${newTenant.name}" เข้าห้องพัก ${selectedRoomForTenant.roomNumber} เรียบร้อยแล้ว`);
  };

  // Filter Logic (Search by Room Number, Tenant Name, and Phone)
  const filteredRooms = rooms.filter(r => {
    const matchBuilding = selectedBuilding === 'all' || r.buildingId === selectedBuilding;
    const matchStatus = selectedStatus === 'all' || r.status === selectedStatus;
    const query = (searchQuery || '').toLowerCase().trim();
    if (!query) {
      return matchBuilding && matchStatus;
    }
    const currentTenant = r.currentTenantId ? tenants.find(t => t.id === r.currentTenantId) : null;
    const matchRoomNumber = (r?.roomNumber || '').toLowerCase().includes(query);
    const matchTenantName = currentTenant ? (currentTenant.name || '').toLowerCase().includes(query) : false;
    const matchTenantPhone = currentTenant ? (currentTenant.phone || '').includes(query) : false;
    const matchSearch = matchRoomNumber || matchTenantName || matchTenantPhone;
    return matchBuilding && matchStatus && matchSearch;
  });

  return (
    <div className="space-y-6 relative">
      {/* Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {toastMessage && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Search and Filters Header */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-xs flex flex-col md:flex-row gap-4 justify-between items-stretch md:items-center">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหาเลขห้องพัก หรือชื่อผู้เช่า..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-slate-50 text-slate-800 font-medium"
          />
        </div>

        {/* Filters and View Toggles */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 w-full sm:w-auto">
          {/* Building & Status Filters */}
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
            {/* Building Filter */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-slate-700 min-w-0">
              <Filter className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <select
                value={selectedBuilding}
                onChange={(e) => setSelectedBuilding(e.target.value)}
                className="bg-transparent focus:outline-none w-full cursor-pointer text-slate-700 font-semibold"
              >
                <option value="all">อาคารทั้งหมด</option>
                {buildings.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
                <option value="unspecified">ไม่ระบุอาคาร</option>
              </select>
            </div>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-gray-200 bg-white rounded-lg focus:outline-none font-semibold text-slate-700 cursor-pointer min-w-0"
            >
              <option value="all">ทุกสถานะห้องพัก</option>
              <option value="vacant">ว่าง</option>
              <option value="occupied">มีผู้เช่า</option>
              <option value="maintenance">ปิดปรับปรุง</option>
            </select>
          </div>

          {/* View Switchers & Add Room Button (Order: floor -> grid -> list) */}
          <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">
            {/* View Switchers */}
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 shrink-0">
              <button
                onClick={() => setViewMode('floor')}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'floor' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-400 hover:text-slate-600'}`}
                title="แผนผังแยกชั้น (Floor Map)"
              >
                <Layers className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'grid' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-400 hover:text-slate-600'}`}
                title="ตารางการ์ด (Grid)"
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'list' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-400 hover:text-slate-600'}`}
                title="รายการตาราง (List)"
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            {/* Add New Room */}
            <button
              onClick={() => handleOpenModal()}
              className="flex-1 sm:flex-none px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              เพิ่มห้องพัก
            </button>
          </div>
        </div>
      </div>

      {/* Grid Mode */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filteredRooms.map((room) => {
            const bldName = buildings.find(b => b.id === room.buildingId)?.name || 'ไม่ระบุอาคาร';
            const currentTenant = tenants.find(t => t.id === room.currentTenantId);
            const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;

            return (
              <div
                key={room.id}
                className={`rounded-3xl border shadow-2xs hover:shadow-md transition-all duration-300 overflow-hidden flex flex-col justify-between ${statusCfg.bg} ${statusCfg.border}`}
              >
                <div className="p-5 space-y-3.5">
                  {/* Top Row: Room number & Status badge */}
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <h4 className="text-xl font-black text-slate-900 tracking-tight">{room.roomNumber}</h4>
                      <p className="text-[11px] text-gray-500 font-semibold mt-0.5">{bldName} &bull; ชั้น {room.floor}</p>
                    </div>

                    {/* Status Badge (View-only) */}
                    <div
                      className={`px-2.5 py-1 rounded-full text-xs font-black border shadow-2xs select-none cursor-default ${room.status === 'occupied'
                          ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                          : room.status === 'vacant'
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-rose-100 text-rose-800 border-rose-200'
                        }`}
                      title={`สถานะห้อง: ${statusCfg.label}`}
                    >
                      {statusCfg.label}
                    </div>
                  </div>

                  {/* Combined Tenant & Rates Container */}
                  <div className="bg-white/90 backdrop-blur-xs p-3.5 rounded-2xl border border-gray-100 shadow-2xs space-y-3 text-xs">
                    {/* Tenant Info */}
                    <div className="flex items-center gap-2.5 pb-2.5 border-b border-gray-100">
                      <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <UserIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] text-gray-400 font-extrabold uppercase leading-none">ผู้เช่าปัจจุบัน</p>
                        {currentTenant ? (
                          <p className="font-extrabold text-slate-900 truncate mt-0.5">{currentTenant.name}</p>
                        ) : (
                          <p className="text-gray-400 font-medium italic mt-0.5">ไม่มีผู้เช่าลงทะเบียน</p>
                        )}
                      </div>
                    </div>

                    {/* Rates Breakdown */}
                    {(() => {
                      const gridRates = getGridRentRates(room);
                      return (
                        <div className="space-y-1.5">
                          <p className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">
                            {gridRates.isOccupied ? 'อัตราค่าเช่าตามสัญญา' : 'อัตราค่าเช่าพัก'}
                          </p>
                          {gridRates.rates.map((rate) => (
                            <div key={rate.cycle} className="flex justify-between items-center text-slate-700">
                              <span className="text-gray-500 font-medium">{rate.label}:</span>
                              <span className="font-extrabold text-slate-900">
                                {formatBaht(rate.amount)} / {rate.cycle === 'term' ? 'เทอม' : (rate.cycle === 'daily' ? 'วัน' : 'เดือน')}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Deposit Amount & Status */}
                  <div className="flex items-center justify-between text-xs px-1 pt-0.5">
                    <span className="text-gray-600 font-bold">ค่าประกัน:</span>
                    {room.status === 'vacant' || !room.currentTenantId ? (
                      <span className="text-gray-400 font-medium italic">ไม่มีผู้เช่าลงทะเบียน</span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-slate-900">{formatBaht(room.depositAmount)}</span>
                        {room.depositStatus === 'paid' && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md border border-emerald-200">
                            จ่ายแล้ว
                          </span>
                        )}
                        {room.depositStatus === 'unpaid' && (
                          <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black rounded-md border border-rose-200">
                            ยังไม่จ่าย
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Footer Actions: Edit and Add Tenant side-by-side */}
                <div className="bg-white/95 px-4 py-2.5 border-t border-gray-100 flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenModal(room)}
                    className="flex-1 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 border border-gray-200 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    title="แก้ไขรายละเอียดห้องพัก"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>แก้ไข</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleTenantAction(room, e)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs ${room.currentTenantId
                        ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600'
                      }`}
                    title={room.currentTenantId ? 'ดูข้อมูลผู้เช่าในหน้ารายชื่อ' : 'เพิ่มผู้เช่าเข้าห้องพักนี้'}
                  >
                    {room.currentTenantId ? (
                      <>
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>ข้อมูลผู้เช่า</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>เพิ่มผู้เช่า</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {filteredRooms.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400 bg-white rounded-3xl border border-gray-100">
              ไม่พบห้องพักที่ตรงกับเงื่อนไขการค้นหา
            </div>
          )}
        </div>
      )}

      {/* List Mode */}
      {viewMode === 'list' && (
        <div className="bg-white border border-gray-100 shadow-2xs rounded-3xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left border-collapse text-xs whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase tracking-wider border-b border-gray-100">
                <tr>
                  <th className="p-4 whitespace-nowrap">เลขห้อง</th>
                  <th className="p-4 whitespace-nowrap">อาคาร/ชั้น</th>
                  <th className="p-4 whitespace-nowrap">ผู้เช่าปัจจุบัน</th>
                  <th className="p-4 whitespace-nowrap">อัตราค่าเช่า</th>
                  <th className="p-4 whitespace-nowrap">ค่าประกัน</th>
                  <th className="p-4 whitespace-nowrap">สถานะห้อง</th>
                  <th className="p-4 whitespace-nowrap text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRooms.map((room) => {
                  const bldName = buildings.find(b => b.id === room.buildingId)?.name || 'ไม่ระบุ';
                  const currentTenant = tenants.find(t => t.id === room.currentTenantId);
                  const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;

                  return (
                    <tr key={room.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 font-black text-slate-900 text-sm whitespace-nowrap">{room.roomNumber}</td>
                      <td className="p-4 text-gray-600 font-semibold whitespace-nowrap">{bldName} (ชั้น {room.floor})</td>
                      <td className="p-4 font-bold text-slate-800 whitespace-nowrap">
                        {currentTenant ? (
                          <div className="flex items-center gap-1.5 text-indigo-700 whitespace-nowrap">
                            <UserIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{currentTenant.name}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 font-normal italic">-</span>
                        )}
                      </td>
                      <td className="p-4 space-y-0.5 whitespace-nowrap">
                        {(() => {
                          const { primaryRate, secondaryRates } = getListRentRates(room);
                          const unitSuffix = primaryRate.cycle === 'term' ? 'เทอม' : (primaryRate.cycle === 'daily' ? 'วัน' : 'เดือน');
                          return (
                            <>
                              <div className="font-extrabold text-slate-900 whitespace-nowrap">
                                {formatBaht(primaryRate.amount)} / {unitSuffix}
                              </div>
                              {secondaryRates.map((sec) => (
                                <div key={sec.cycle} className="text-[10px] text-gray-500 whitespace-nowrap">
                                  {formatBaht(sec.amount)} / {sec.cycle === 'term' ? 'เทอม' : (sec.cycle === 'daily' ? 'วัน' : 'เดือน')}
                                </div>
                              ))}
                            </>
                          );
                        })()}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        {room.status === 'vacant' || !room.currentTenantId ? (
                          <span className="text-gray-400 font-medium italic">ไม่มีผู้เช่าลงทะเบียน</span>
                        ) : (
                          <>
                            <div className="font-bold text-slate-800 whitespace-nowrap">{formatBaht(room.depositAmount)}</div>
                            {room.depositStatus === 'paid' && (
                              <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 inline-block mt-0.5 whitespace-nowrap">จ่ายแล้ว</span>
                            )}
                            {room.depositStatus === 'unpaid' && (
                              <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 inline-block mt-0.5 whitespace-nowrap">ยังไม่จ่าย</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-4 whitespace-nowrap">
                        {/* Status minimal badge (View-only) */}
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold select-none border shadow-2xs cursor-default whitespace-nowrap ${room.status === 'occupied'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : room.status === 'vacant'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          title={`สถานะห้อง: ${statusCfg.label}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${room.status === 'occupied'
                                ? 'bg-indigo-500'
                                : room.status === 'vacant'
                                  ? 'bg-emerald-500'
                                  : 'bg-rose-500'
                              }`}
                          />
                          <span>{statusCfg.label}</span>
                        </div>
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenModal(room)}
                            className="px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 border border-gray-200 rounded-xl inline-flex items-center gap-1 transition-all cursor-pointer"
                            title="แก้ไขรายละเอียดห้องพัก"
                          >
                            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                            <span>แก้ไข</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleTenantAction(room, e)}
                            className={`px-2.5 py-1.5 text-xs font-bold rounded-xl inline-flex items-center gap-1 transition-all cursor-pointer shadow-2xs ${room.currentTenantId
                                ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-600'
                              }`}
                            title={room.currentTenantId ? 'ดูข้อมูลผู้เช่า' : 'เพิ่มผู้เช่าเข้าห้องพัก'}
                          >
                            {room.currentTenantId ? (
                              <>
                                <UserIcon className="w-3.5 h-3.5" />
                                <span>ผู้เช่า</span>
                              </>
                            ) : (
                              <>
                                <Plus className="w-3.5 h-3.5" />
                                <span>เพิ่มผู้เช่า</span>
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floor Map Mode (Requirement 8) */}
      {viewMode === 'floor' && (
        <div className="space-y-6">
          {buildings.map((bld) => {
            const floorsCount = bld.floorsCount || Math.max(...filteredRooms.filter(r => r.buildingId === bld.id).map(r => r.floor || 1), 1);
            const floors = Array.from({ length: floorsCount }, (_, i) => floorsCount - i);
            return (
              <div key={bld.id} className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="text-base font-black text-slate-900">{bld.name}</h3>
                </div>

                <div className="space-y-4">
                  {floors.map((fl) => {
                    const floorRooms = filteredRooms.filter(r => r.buildingId === bld.id && r.floor === fl);
                    if (floorRooms.length === 0) return null; // Skip floors that have no rooms

                    return (
                      <div key={fl} className="flex flex-col sm:flex-row gap-2.5 sm:gap-4 items-start sm:items-center py-3 border-b border-dashed border-gray-100 last:border-b-0">
                        <div className="w-fit sm:w-16 shrink-0 text-xs font-black text-indigo-600 bg-indigo-50 border border-indigo-100 py-1.5 sm:py-2 px-3 rounded-xl text-center shadow-3xs">
                          ชั้น {fl}
                        </div>

                        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-2.5 flex-1 w-full">
                          {floorRooms.map((room) => {
                            const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;
                            const currentTenant = tenants.find(t => t.id === room.currentTenantId);

                            if (room.status === 'occupied') {
                              return (
                                <div
                                  key={room.id}
                                  onClick={() => {
                                    if (room.currentTenantId) {
                                      onNavigate('tenants', room.currentTenantId);
                                    }
                                  }}
                                  title={currentTenant ? `คลิกเพื่อดูข้อมูลผู้เช่าคุณ ${currentTenant.name}` : `ดูข้อมูลห้อง ${room.roomNumber}`}
                                  className={`p-2.5 sm:p-3 w-full sm:w-auto sm:min-w-[150px] rounded-2xl border text-center cursor-pointer transition-all hover:scale-105 select-none flex flex-col justify-between items-center shadow-2xs group ${statusCfg.bg} ${statusCfg.border} ${statusCfg.text}`}
                                >
                                  <div className="flex items-center justify-between w-full gap-1 mb-1">
                                    <span className="font-black text-xs sm:text-sm tracking-tight">{room.roomNumber}</span>
                                    <span className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${statusCfg.badgeBg} ${statusCfg.badgeText}`}>
                                      {statusCfg.label}
                                    </span>
                                  </div>
                                  <div className="text-[10px] sm:text-[11px] font-extrabold opacity-90 my-0.5 truncate">
                                    {formatBaht(room.monthlyRent)}/ด.
                                  </div>
                                  {currentTenant && (
                                    <div className="text-[9px] sm:text-[10px] font-bold truncate max-w-full sm:max-w-[135px] opacity-90 flex items-center gap-1 mt-1 bg-white/70 group-hover:bg-white px-1.5 sm:px-2 py-0.5 rounded-lg w-full justify-center text-indigo-900 border border-indigo-100/60 shadow-3xs transition-colors">
                                      <UserIcon className="w-3 h-3 shrink-0 text-indigo-600" />
                                      <span className="truncate">{currentTenant.name}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            }

                            if (room.status === 'maintenance') {
                              return (
                                <div
                                  key={room.id}
                                  onClick={() => handleOpenModal(room)}
                                  title={`คลิกเพื่อแก้ไขห้องพัก ${room.roomNumber}`}
                                  className={`p-2.5 sm:p-3 w-full sm:w-auto sm:min-w-[150px] rounded-2xl border text-center cursor-pointer transition-all hover:scale-105 select-none flex flex-col justify-between items-center shadow-2xs group ${statusCfg.bg} ${statusCfg.border} ${statusCfg.text}`}
                                >
                                  <div className="flex items-center justify-between w-full gap-1 mb-1">
                                    <span className="font-black text-xs sm:text-sm tracking-tight">{room.roomNumber}</span>
                                    <span className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${statusCfg.badgeBg} ${statusCfg.badgeText}`}>
                                      {statusCfg.label}
                                    </span>
                                  </div>
                                  <div className="text-[10px] sm:text-[11px] font-extrabold opacity-90 my-0.5 truncate">
                                    {formatBaht(room.monthlyRent)}/ด.
                                  </div>
                                  <div className="text-[9px] sm:text-[10px] font-bold truncate max-w-full sm:max-w-[135px] opacity-90 flex items-center gap-1 mt-1 bg-white/70 group-hover:bg-white px-1.5 sm:px-2 py-0.5 rounded-lg w-full justify-center text-rose-800 border border-rose-100/60 shadow-3xs transition-colors">
                                    <Edit2 className="w-3 h-3 shrink-0 text-rose-600" />
                                    <span>แก้ไข</span>
                                  </div>
                                </div>
                              );
                            }

                            // Vacant room
                            return (
                              <div
                                key={room.id}
                                className={`p-2.5 sm:p-3 w-full sm:w-auto sm:min-w-[150px] rounded-2xl border text-center select-none flex flex-col justify-between items-center shadow-2xs ${statusCfg.bg} ${statusCfg.border} ${statusCfg.text}`}
                              >
                                <div className="flex items-center justify-between w-full gap-1 mb-1">
                                  <span className="font-black text-xs sm:text-sm tracking-tight">{room.roomNumber}</span>
                                  <span className={`text-[8px] sm:text-[9px] font-black px-1.5 py-0.5 rounded-md shrink-0 ${statusCfg.badgeBg} ${statusCfg.badgeText}`}>
                                    {statusCfg.label}
                                  </span>
                                </div>
                                <div className="text-[10px] sm:text-[11px] font-extrabold opacity-90 my-0.5 text-emerald-800 truncate">
                                  {formatBaht(room.monthlyRent)}/ด.
                                </div>
                                <div className="flex items-center gap-1 w-full mt-1.5 pt-1.5 border-t border-emerald-200/60">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenModal(room);
                                    }}
                                    title={`แก้ไขห้องพัก ${room.roomNumber}`}
                                    className="flex-1 py-1 px-1 bg-white/90 hover:bg-white text-slate-700 hover:text-indigo-700 text-[9px] sm:text-[10px] font-black rounded-lg border border-emerald-200/80 shadow-3xs flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95"
                                  >
                                    <Edit2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-slate-600" />
                                    <span>แก้ไข</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleTenantAction(room, e);
                                    }}
                                    title={`เพิ่มผู้เช่าเข้าห้อง ${room.roomNumber}`}
                                    className="flex-1 py-1 px-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] sm:text-[10px] font-black rounded-lg shadow-3xs flex items-center justify-center gap-1 transition-all cursor-pointer active:scale-95"
                                  >
                                    <UserPlus className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                                    <span>เพิ่ม</span>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Room Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100/80 shadow-3xs">
              <DoorOpen className="w-5 h-5" />
            </div>
            <span className="font-extrabold text-slate-900">
              {editingRoom ? `แก้ไขห้องพัก ${roomNumber}` : 'เพิ่มห้องพักใหม่'}
            </span>
          </div>
        }
        footer={
          <div className="w-full space-y-2.5">
            {errorText && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 shadow-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span className="font-bold leading-tight">{errorText}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              {editingRoom ? (
                <button
                  type="button"
                  data-testid="btn-delete-room"
                  onClick={() => handleDeleteFromModal(editingRoom.id, editingRoom.roomNumber)}
                  className="px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="จัดเก็บห้องพัก"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>จัดเก็บห้องพัก</span>
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold cursor-pointer transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  form="room-edit-form"
                  data-testid="btn-save-room"
                  disabled={!isFormModified || isSubmitting}
                  className={`px-5 py-2 font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 ${isFormModified && !isSubmitting
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer active:scale-95'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                    }`}
                  title={!isFormModified && editingRoom ? 'ไม่มีการเปลี่ยนแปลงข้อมูล' : undefined}
                >
                  <Check className="w-4 h-4" />
                  <span>{isSubmitting ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</span>
                </button>
              </div>
            </div>
          </div>
        }
      >
        <form id="room-edit-form" onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">เลขที่ห้องพัก *</label>
              <input
                type="text"
                required
                value={roomNumber}
                onChange={(e) => {
                  setErrorText(null);
                  setRoomNumber(e.target.value);
                }}
                disabled={!!editingRoom}
                placeholder="เช่น A101"
                className={`w-full px-3 py-2 text-xs border rounded-xl font-bold transition-colors ${errorText && (errorText.includes('เลขห้อง') || errorText.includes('เลขที่ห้อง'))
                    ? 'border-rose-500 bg-rose-50/40 text-rose-900 focus:border-rose-600 ring-2 ring-rose-100'
                    : editingRoom
                      ? 'bg-slate-100 text-slate-500 border-gray-200 cursor-not-allowed select-none'
                      : 'bg-white text-slate-800 border-gray-200 focus:border-indigo-600'
                  }`}
                title={editingRoom ? 'ไม่สามารถแก้ไขเลขที่ห้องพักได้' : undefined}
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">จำนวนผู้เข้าพักสูงสุด</label>
              <input
                type="number"
                min={1}
                value={maxOccupants}
                onChange={(e) => setMaxOccupants(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 font-bold"
              />
            </div>
          </div>

          {/* Rental Rates Breakdown (รายเทอม -> รายเดือน -> รายวัน) */}
          <div className="space-y-3 pt-2 border-t border-gray-100 bg-slate-50/80 p-3.5 rounded-2xl border">
            <div className="flex items-center gap-2">
              <div className="p-1 bg-indigo-100 text-indigo-700 rounded-lg">
                <Coins className="w-3.5 h-3.5" />
              </div>
              <label className="block text-xs font-black text-indigo-950">อัตราค่าเช่าพักตามรูปแบบต่างๆ</label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700">รายเทอม</label>
                <input
                  type="number"
                  min={0}
                  value={termRent}
                  onChange={(e) => setTermRent(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 18000"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700">รายเดือน *</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={monthlyRent}
                  onChange={(e) => setMonthlyRent(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 4500"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700">รายวัน</label>
                <input
                  type="number"
                  min={0}
                  value={dailyRent}
                  onChange={(e) => setDailyRent(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 500"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                />
              </div>
            </div>
          </div>

          {/* Deposit Defaults by Cycle (เงินประกันตามรอบเช่า) */}
          <div className="space-y-2 bg-slate-50/80 p-3.5 rounded-2xl border border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-1 bg-emerald-100 text-emerald-700 rounded-lg">
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <label className="block text-xs font-black text-slate-900">เงินประกันตามรอบเช่า (บาท)</label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">รายเทอม</label>
                <input
                  type="number"
                  min={0}
                  value={termDeposit}
                  onChange={(e) => setTermDeposit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 9000"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold text-slate-800 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">รายเดือน</label>
                <input
                  type="number"
                  min={0}
                  value={monthlyDeposit}
                  onChange={(e) => setMonthlyDeposit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 9000"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold text-slate-800 focus:border-indigo-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1">รายวัน</label>
                <input
                  type="number"
                  min={0}
                  value={dailyDeposit}
                  onChange={(e) => setDailyDeposit(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 1000"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold text-slate-800 focus:border-indigo-600 focus:outline-none"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 font-medium mt-1">
              กำหนดเงินประกันเริ่มต้นแยกตามแต่ละรอบการเช่า (ใช้เป็นค่าเริ่มต้นเมื่อทำสัญญาใหม่)
            </p>
          </div>

          {/* Room Status Selector - อยู่ด้านล่าง อัตราค่าประกัน */}
          <div className="space-y-1 pt-1">
            <label className="block text-xs font-bold text-slate-700">สถานะห้องพัก *</label>
            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <button
                type="button"
                onClick={() => {
                  setErrorText(null);
                  setRoomStatus(editingRoom?.currentTenantId ? 'occupied' : 'vacant');
                }}
                className={`py-2 px-3 text-xs font-extrabold rounded-xl border transition-all cursor-pointer text-center truncate ${roomStatus !== 'maintenance'
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-gray-200'
                  }`}
              >
                เปิดใช้งาน
              </button>
              <button
                type="button"
                onClick={() => {
                  if (editingRoom?.currentTenantId) {
                    const tenant = tenants.find(t => t.id === editingRoom.currentTenantId);
                    const err = `ไม่สามารถเลือก "ปิดปรับปรุง" ได้ เนื่องจากห้องนี้มีผู้เช่าพักอยู่ (${tenant ? tenant.name : 'มีผู้เช่า'}) ต้องเป็นห้องว่างเท่านั้น`;
                    setErrorText(err);
                    return;
                  }
                  setErrorText(null);
                  setRoomStatus('maintenance');
                }}
                className={`py-2 px-3 text-xs font-extrabold rounded-xl border transition-all cursor-pointer text-center truncate ${roomStatus === 'maintenance'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : editingRoom?.currentTenantId
                      ? 'bg-slate-50 text-slate-400 border-slate-200 cursor-not-allowed opacity-75'
                      : 'bg-white hover:bg-slate-50 text-slate-700 border-gray-200'
                  }`}
                title={editingRoom?.currentTenantId ? 'ห้องนี้มีผู้เช่าอยู่ ต้องเป็นห้องว่างเท่านั้นถึงจะปิดปรับปรุงได้' : undefined}
              >
                ปิดปรับปรุง
              </button>
            </div>
            {editingRoom?.currentTenantId && (
              <p className="text-[11px] text-amber-600 font-semibold mt-1">
                ⚠️ ห้องนี้มีผู้เช่าพักอยู่
              </p>
            )}
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirmData}
        onClose={() => setDeleteConfirmData(null)}
        onConfirm={executeDeleteRoom}
        title={`ยืนยันการจัดเก็บห้องพัก ${deleteConfirmData?.roomNum || ''}`}
        message={deleteConfirmData?.message || ''}
        confirmText="จัดเก็บห้องพัก"
        cancelText="ยกเลิก"
        type="danger"
      />

      {/* Quick Add Tenant Modal (Blank / Reserved for Main Project Integration) */}
      <Modal
        isOpen={isAddTenantModalOpen}
        onClose={() => setIsAddTenantModalOpen(false)}
        title={`เพิ่มผู้เช่าเข้าห้องพัก ${selectedRoomForTenant?.roomNumber || ''}`}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsAddTenantModalOpen(false)}
              className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              ปิด
            </button>
          </div>
        }
      >
        <div className="py-12 px-4 text-center">
          {/* Reserved empty space for main project integration */}
        </div>
      </Modal>

      {versionConflictState && (
        <VersionConflictModal
          isOpen={versionConflictState.isOpen}
          entityName={versionConflictState.entityName}
          currentVersion={versionConflictState.currentVersion}
          latestVersion={versionConflictState.currentVersion}
          onReload={() => {
            onSaveRooms(rooms, { kind: 'refresh' });
            setVersionConflictState(null);
            setIsModalOpen(false);
            setEditingRoom(null);
          }}
          onCancel={() => setVersionConflictState(null)}
        />
      )}

    </div>
  );
};
