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
  CheckCircle2,
  Clock,
  Wrench,
  Ban
} from 'lucide-react';
import {
  formatBaht,
  Modal,
  ConfirmDialog
} from '../../components/GlobalComponents';
import { Room, Building, RoomStatus, Tenant, Contract, Bill, BLOCKING_CONTRACT_STATUSES } from '../../types';

interface OwnerRoomsProps {
  rooms: Room[];
  tenants?: Tenant[];
  contracts?: Contract[];
  bills?: Bill[];
  buildings: Building[];
  onSaveRooms: (rooms: Room[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onNavigate: (tab: string, param?: string) => void;
  initialRoomId?: string;
  onClearInitialRoomId?: () => void;
}

const ROOM_STATUS_CONFIG: Record<string, {
  label: string;
  bg: string;
  border: string;
  text: string;
  badgeBg: string;
  badgeText: string;
  activeBtnBg: string;
}> = {
  vacant: {
    label: 'ว่าง',
    bg: 'bg-emerald-50/70 hover:bg-emerald-100/70',
    border: 'border-emerald-200',
    text: 'text-emerald-900',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-800',
    activeBtnBg: 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
  },
  occupied: {
    label: 'มีผู้เช่า',
    bg: 'bg-indigo-50/70 hover:bg-indigo-100/70',
    border: 'border-indigo-200',
    text: 'text-indigo-900',
    badgeBg: 'bg-indigo-100',
    badgeText: 'text-indigo-800',
    activeBtnBg: 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
  },
  maintenance: {
    label: 'ปิดปรับปรุง',
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

  // Form Fields
  const [roomNumber, setRoomNumber] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [floor, setFloor] = useState(1);
  const [monthlyRent, setMonthlyRent] = useState(4500);
  const [termRent, setTermRent] = useState(18000);
  const [dailyRent, setDailyRent] = useState(500);
  const [rentCycle, setRentCycle] = useState<'term' | 'monthly' | 'daily'>('monthly');
  const [depositAmount, setDepositAmount] = useState(9000);
  const [depositStatus, setDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [maxOccupants, setMaxOccupants] = useState(2);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>('vacant');
  const [initialWaterMeter, setInitialWaterMeter] = useState(100);
  const [initialElectricMeter, setInitialElectricMeter] = useState(1200);
  const [notes, setNotes] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

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
      setDepositAmount(room.depositAmount || 0);
      setDepositStatus(room.depositStatus || (room.status === 'occupied' ? 'paid' : 'unpaid'));
      setMaxOccupants(room.maxOccupants || 2);
      setRoomStatus(room.status || 'vacant');
      setInitialWaterMeter(room.initialWaterMeter || 100);
      setInitialElectricMeter(room.initialElectricMeter || 1200);
      setNotes(room.notes || '');
    } else {
      setEditingRoom(null);
      setRoomNumber('');
      setBuildingId(buildings[0]?.id || '');
      setFloor(1);
      setMonthlyRent(4500);
      setTermRent(18000);
      setDailyRent(500);
      setRentCycle('monthly');
      setDepositAmount(9000);
      setDepositStatus('unpaid');
      setMaxOccupants(2);
      setRoomStatus('vacant');
      setInitialWaterMeter(100);
      setInitialElectricMeter(1200);
      setNotes('');
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

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!roomNumber.trim()) {
      setErrorText('กรุณากรอกเลขห้องพัก');
      return;
    }

    // Check duplicate room number
    const isDuplicate = rooms.some(r => (r?.roomNumber || '').toLowerCase() === roomNumber.trim().toLowerCase() && r.id !== editingRoom?.id);
    if (isDuplicate) {
      setErrorText(`เลขห้อง "${roomNumber}" นี้ได้รับการบันทึกในระบบแล้ว`);
      return;
    }

    if (monthlyRent <= 0) {
      setErrorText('กรุณากรอกค่าเช่ารายเดือนให้ถูกต้อง');
      return;
    }

    if (editingRoom) {
      // Validate status transitions for occupied / vacant rooms
      if (editingRoom.currentTenantId && roomStatus !== 'occupied') {
        const tenant = tenants.find(t => t.id === editingRoom.currentTenantId);
        setErrorText(`ห้องนี้มีผู้เช่า (${tenant ? tenant.name : 'ผูกผู้เช่าอยู่'}) กรุณาทำเรื่องเลิกเช่าผ่านระบบผู้เช่า/สัญญาเช่า`);
        return;
      }
      if (!editingRoom.currentTenantId && roomStatus === 'occupied') {
        setErrorText('ไม่สามารถเปลี่ยนสถานะเป็น "มีผู้เช่า" โดยตรงได้ กรุณาจัดสรรผู้เช่าผ่านระบบผู้เช่าหรือทำสัญญาเช่า');
        return;
      }
    }

    const digitsOnly = roomNumber.replace(/\D/g, '');
    const calculatedFloor = Number(floor) || (digitsOnly ? (parseInt(digitsOnly.charAt(0)) || 1) : 1);

    let updatedRooms = [...rooms];
    if (editingRoom) {
      // Update
      updatedRooms = rooms.map(r => r.id === editingRoom.id ? {
        ...r,
        roomNumber: roomNumber.trim(),
        buildingId: buildingId || r.buildingId,
        floor: calculatedFloor,
        monthlyRent: Number(monthlyRent),
        termRent: Number(termRent) || undefined,
        dailyRent: Number(dailyRent) || undefined,
        rentCycle,
        depositAmount: Number(depositAmount),
        depositStatus,
        maxOccupants: Number(maxOccupants),
        status: roomStatus,
        initialWaterMeter: Number(initialWaterMeter) || r.initialWaterMeter || 0,
        initialElectricMeter: Number(initialElectricMeter) || r.initialElectricMeter || 0,
        notes,
        updatedAt: new Date().toISOString()
      } : r);

      onAddLog('แก้ไขห้องพัก', `แก้ไขรายละเอียดห้อง ${roomNumber}`, 'Room', editingRoom.id);
    } else {
      // Create
      const newId = `room-${Date.now()}`;
      const newRoom: Room = {
        id: newId,
        roomNumber: roomNumber.trim(),
        buildingId: buildingId || undefined,
        floor: calculatedFloor,
        monthlyRent: Number(monthlyRent),
        termRent: Number(termRent) || undefined,
        dailyRent: Number(dailyRent) || undefined,
        rentCycle,
        depositAmount: Number(depositAmount),
        depositStatus,
        maxOccupants: Number(maxOccupants),
        initialWaterMeter: Number(initialWaterMeter) || 0,
        initialElectricMeter: Number(initialElectricMeter) || 0,
        status: roomStatus,
        notes,
        images: ['https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=400'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      updatedRooms.push(newRoom);
      onAddLog('เพิ่มห้องพักใหม่', `สร้างเลขห้อง ${roomNumber} ใหม่ในระบบ`, 'Room', newId);
    }

    const savedRoomNumber = roomNumber.trim();
    onSaveRooms(updatedRooms);
    setIsModalOpen(false);
    setToastMessage(`เลขห้อง "${savedRoomNumber}" นี้ได้รับการบันทึกในระบบแล้ว`);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
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

    let confirmPrompt = `คุณแน่ใจหรือไม่ว่าต้องการลบห้องพัก ${roomNum} ออกจากระบบอย่างถาวร?`;
    if (infoList.length > 0) {
      confirmPrompt = `คำเตือน: ห้องพัก ${roomNum} มีข้อมูลผูกอยู่ในระบบ:\n\n• ` + infoList.join('\n• ') + `\n\nคุณยังคงต้องการยืนยันลบห้องพัก ${roomNum} ออกจากระบบถาวรหรือไม่?`;
    }

    setDeleteConfirmData({
      roomId: targetRoom.id,
      roomNum,
      message: confirmPrompt
    });
  };

  const executeDeleteRoom = () => {
    if (!deleteConfirmData) return;
    const { roomId, roomNum } = deleteConfirmData;
    const updated = rooms.filter(r => r.id !== roomId && r.roomNumber !== roomNum);
    onSaveRooms(updated);
    onAddLog('ลบห้องพัก', `ลบห้องเลขที่ ${roomNum} ออกจากระบบถาวร`, 'Room', roomId);
    setIsModalOpen(false);
    setEditingRoom(null);
    setDeleteConfirmData(null);
    setToastMessage(`ลบห้องพัก "${roomNum}" ออกจากระบบเรียบร้อยแล้ว`);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  const handleQuickStatusChange = (roomId: string, newStatus: RoomStatus, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetRoom = rooms.find(r => r.id === roomId);
    if (!targetRoom) return;

    if (targetRoom.currentTenantId) {
      const tenant = tenants.find(t => t.id === targetRoom.currentTenantId);
      if (newStatus !== 'occupied') {
        alert(`ไม่สามารถเปลี่ยนสถานะห้องเป็น "${ROOM_STATUS_CONFIG[newStatus]?.label}" ได้ เนื่องจากห้องพักนี้มีผู้เช่าอยู่ (${tenant ? tenant.name : 'มีประวัติผู้เช่า'})\n\nกรุณาใช้ระบบเลิกเช่าคืนห้องพักในหน้าสัญญาหรือผู้เช่าเพื่อคืนห้องพัก`);
        return;
      }
    } else {
      if (newStatus === 'occupied') {
        alert('ไม่สามารถเปลี่ยนสถานะเป็น "มีผู้เช่า" โดยตรงได้\n\nกรุณาจัดสรรผู้เช่าผ่านระบบลงทะเบียนผู้เช่าหรือสร้างสัญญาเช่าเพื่อผูกผู้เช่าเข้ากับห้องพัก');
        return;
      }
    }

    const updated = rooms.map(r => r.id === roomId ? {
      ...r,
      status: newStatus,
      depositStatus: newStatus === 'occupied' ? (r.depositStatus || 'paid') : r.depositStatus,
      updatedAt: new Date().toISOString()
    } : r);
    onSaveRooms(updated);
    onAddLog('เปลี่ยนสถานะห้องพัก', `เปลี่ยนสถานะห้อง ${targetRoom.roomNumber} เป็น ${ROOM_STATUS_CONFIG[newStatus]?.label}`, 'Room', roomId);
  };

  // Filter Logic
  const filteredRooms = rooms.filter(r => {
    const matchBuilding = selectedBuilding === 'all' || r.buildingId === selectedBuilding;
    const matchStatus = selectedStatus === 'all' || r.status === selectedStatus;
    const matchSearch = (r?.roomNumber || '').toLowerCase().includes((searchQuery || '').toLowerCase());
    return matchBuilding && matchStatus && matchSearch;
  });

  return (
    <div className="space-y-6 relative">
      {/* Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {toastMessage && (
        <div 
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading 
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
            placeholder="ค้นหาเลขห้องพัก..."
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

            {/* Status Filter strictly 4 options */}
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

          {/* View Switchers & Add Room Button */}
          <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">
            {/* View Switchers */}
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 shrink-0">
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
              <button
                onClick={() => setViewMode('floor')}
                className={`p-1.5 rounded-md transition-all cursor-pointer ${viewMode === 'floor' ? 'bg-white shadow-xs text-indigo-600' : 'text-gray-400 hover:text-slate-600'}`}
                title="แผนผังแยกชั้น (Floor Map)"
              >
                <Layers className="w-4 h-4" />
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
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xl font-black text-slate-900 tracking-tight">{room.roomNumber}</h4>
                      <p className="text-[11px] text-gray-500 font-semibold mt-0.5">{bldName} &bull; ชั้น {room.floor}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-xs font-black border shadow-2xs ${statusCfg.badgeBg} ${statusCfg.badgeText} ${statusCfg.border}`}>
                      {statusCfg.label}
                    </span>
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
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">อัตราค่าเช่าพัก</p>
                      <div className="flex justify-between items-center text-slate-700">
                        <span className="text-gray-500 font-medium">รายเดือน:</span>
                        <span className="font-extrabold text-slate-900">{formatBaht(room.monthlyRent)} / เดือน</span>
                      </div>
                      {room.termRent && (
                        <div className="flex justify-between items-center text-slate-700">
                          <span className="text-gray-500 font-medium">รายเทอม:</span>
                          <span className="font-extrabold text-slate-900">{formatBaht(room.termRent)} / เทอม</span>
                        </div>
                      )}
                      {room.dailyRent && (
                        <div className="flex justify-between items-center text-slate-700">
                          <span className="text-gray-500 font-medium">รายวัน:</span>
                          <span className="font-extrabold text-slate-900">{formatBaht(room.dailyRent)} / วัน</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Deposit Amount & Status */}
                  <div className="flex items-center justify-between text-xs px-1 pt-0.5">
                    <span className="text-gray-600 font-bold">ค่าประกัน:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-slate-900">{formatBaht(room.depositAmount)}</span>
                      {room.depositStatus === 'paid' ? (
                        <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md border border-emerald-200">
                          จ่ายแล้ว
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 text-[10px] font-black rounded-md border border-rose-200">
                          ยังไม่จ่าย
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="bg-white/90 px-5 py-3 border-t border-gray-100/80 flex justify-end shrink-0">
                  <button
                    onClick={() => handleOpenModal(room)}
                    className="w-full py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                    title="แก้ไขรายละเอียดห้องพัก"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>แก้ไข</span>
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
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 text-slate-500 font-extrabold uppercase tracking-wider border-b border-gray-100">
                <tr>
                  <th className="p-4">เลขห้อง</th>
                  <th className="p-4">อาคาร/ชั้น</th>
                  <th className="p-4">ผู้เช่าปัจจุบัน</th>
                  <th className="p-4">อัตราค่าเช่า</th>
                  <th className="p-4">เงินมัดจำ</th>
                  <th className="p-4">สถานะห้อง</th>
                  <th className="p-4 text-right">แก้ไข</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRooms.map((room) => {
                  const bldName = buildings.find(b => b.id === room.buildingId)?.name || 'ไม่ระบุ';
                  const currentTenant = tenants.find(t => t.id === room.currentTenantId);
                  const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;

                  return (
                    <tr key={room.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 font-black text-slate-900 text-sm">{room.roomNumber}</td>
                      <td className="p-4 text-gray-600 font-semibold">{bldName} (ชั้น {room.floor})</td>
                      <td className="p-4 font-bold text-slate-800">
                        {currentTenant ? (
                          <div className="flex items-center gap-1.5 text-indigo-700">
                            <UserIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{currentTenant.name}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 font-normal italic">-</span>
                        )}
                      </td>
                      <td className="p-4 space-y-0.5">
                        <div className="font-extrabold text-slate-900">{formatBaht(room.monthlyRent)} / เดือน</div>
                        {room.termRent && <div className="text-[10px] text-gray-500">{formatBaht(room.termRent)} / เทอม</div>}
                        {room.dailyRent && <div className="text-[10px] text-gray-500">{formatBaht(room.dailyRent)} / วัน</div>}
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{formatBaht(room.depositAmount)}</div>
                        {room.depositStatus === 'paid' ? (
                          <span className="text-[10px] font-black text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 inline-block mt-0.5">จ่ายแล้ว</span>
                        ) : (
                          <span className="text-[10px] font-black text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 inline-block mt-0.5">ยังไม่จ่าย</span>
                        )}
                      </td>
                      <td className="p-4">
                        <select
                          value={room.status}
                          onChange={(e) => handleQuickStatusChange(room.id, e.target.value as RoomStatus)}
                          className={`px-2.5 py-1 text-xs font-black rounded-xl border cursor-pointer focus:outline-none ${statusCfg.badgeBg} ${statusCfg.badgeText} ${statusCfg.border}`}
                        >
                          <option value="vacant">ว่าง</option>
                          <option value="occupied">มีผู้เช่า</option>
                          <option value="maintenance">ปิดปรับปรุง</option>
                        </select>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={() => handleOpenModal(room)}
                          className="px-2.5 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 border border-indigo-200 rounded-xl inline-flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>แก้ไข</span>
                        </button>
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
            const floors = Array.from({ length: bld.floorsCount }, (_, i) => bld.floorsCount - i);
            return (
              <div key={bld.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="text-base font-black text-slate-900">{bld.name}</h3>
                </div>
                
                <div className="space-y-4">
                  {floors.map((fl) => {
                    const floorRooms = rooms.filter(r => r.buildingId === bld.id && r.floor === fl);
                    if (floorRooms.length === 0) return null; // Skip floors that have no rooms

                    return (
                      <div key={fl} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center py-3 border-b border-dashed border-gray-100">
                        <div className="w-16 shrink-0 text-xs font-black text-indigo-600 bg-indigo-50 border border-indigo-100 py-2 px-3 rounded-xl text-center">
                          ชั้น {fl}
                        </div>
                        
                        <div className="flex flex-wrap gap-2.5 flex-1">
                          {floorRooms.map((room) => {
                            const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;
                            const currentTenant = tenants.find(t => t.id === room.currentTenantId);

                            return (
                              <div
                                key={room.id}
                                onClick={() => handleOpenModal(room)}
                                className={`p-3 min-w-[135px] rounded-2xl border text-center cursor-pointer transition-all hover:scale-105 select-none flex flex-col justify-between items-center shadow-2xs ${statusCfg.bg} ${statusCfg.border} ${statusCfg.text}`}
                              >
                                <div className="flex items-center justify-between w-full gap-1 mb-1">
                                  <span className="font-black text-sm tracking-tight">{room.roomNumber}</span>
                                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md ${statusCfg.badgeBg} ${statusCfg.badgeText}`}>
                                    {statusCfg.label}
                                  </span>
                                </div>
                                {currentTenant && (
                                  <div className="text-[11px] font-extrabold opacity-90 my-0.5">
                                    {formatBaht(room.monthlyRent)}/ด.
                                  </div>
                                )}
                                {currentTenant && (
                                  <div className="text-[10px] font-bold truncate max-w-[115px] opacity-80 flex items-center gap-1 mt-1 bg-white/60 px-1.5 py-0.5 rounded-lg w-full justify-center">
                                    <UserIcon className="w-3 h-3 shrink-0" />
                                    <span className="truncate">{currentTenant.name}</span>
                                  </div>
                                )}
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
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingRoom ? `แก้ไขห้องพัก ${roomNumber}` : 'เพิ่มห้องพักใหม่'}>
        <form onSubmit={handleSave} className="space-y-4">
          
          <div className="max-h-[60vh] overflow-y-auto px-1.5 pb-4 space-y-4">
            {errorText && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                <span className="font-medium">{errorText}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">เลขที่ห้องพัก *</label>
                <input
                  type="text"
                  required
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder="เช่น A101"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:border-indigo-600 bg-white font-bold"
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

            {/* Room Status Selector - 1 row on PC (Requirement 3) */}
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700">สถานะห้องพัก *</label>
              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                {(['vacant', 'occupied', 'maintenance'] as RoomStatus[]).map((st) => {
                  const cfg = ROOM_STATUS_CONFIG[st];
                  const isActive = roomStatus === st;
                  return (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setRoomStatus(st)}
                      className={`py-2 px-1.5 text-xs font-extrabold rounded-xl border transition-all cursor-pointer text-center truncate ${
                        isActive ? cfg.activeBtnBg : 'bg-white hover:bg-slate-50 text-slate-700 border-gray-200'
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Rental Rates Breakdown (Requirement 1) */}
            <div className="space-y-3 pt-2 border-t border-gray-100 bg-slate-50/80 p-3.5 rounded-2xl border">
              <label className="block text-xs font-black text-indigo-900">อัตราค่าเช่าพักตามรูปแบบต่างๆ</label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-700">รายเดือน (บาท/เดือน)</label>
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
                  <label className="block text-[11px] font-bold text-slate-700">รายเทอม (บาท/เทอม)</label>
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
                  <label className="block text-[11px] font-bold text-slate-700">รายวัน (บาท/วัน)</label>
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

            {/* Deposit Amount & Status (Requirement 3) */}
            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">เงินประกัน / มัดจำ (บาท) *</label>
                <input
                  type="number"
                  required
                  min={0}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="เช่น 5000"
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">สถานะค่าประกัน *</label>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => setDepositStatus('paid')}
                    className={`py-1.5 px-2 text-xs font-extrabold rounded-xl border transition-all cursor-pointer text-center ${
                      depositStatus === 'paid'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                        : 'bg-white hover:bg-slate-50 text-slate-600 border-gray-200'
                    }`}
                  >
                    ✓ จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositStatus('unpaid')}
                    className={`py-1.5 px-2 text-xs font-extrabold rounded-xl border transition-all cursor-pointer text-center ${
                      depositStatus === 'unpaid'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-2xs'
                        : 'bg-white hover:bg-slate-50 text-slate-600 border-gray-200'
                    }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1 pt-1">
              <label className="block text-xs font-bold text-slate-700">หมายเหตุภายใน</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="หมายเหตุเพิ่มเติมสำหรับผู้ดูแล..."
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white h-16 resize-none"
              />
            </div>

          </div>

          {/* Submit Footer */}
          <div className="sticky bottom-0 -mx-6 -mb-6 p-4 bg-white border-t border-gray-100 flex items-center justify-between z-20 rounded-b-3xl shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
            <div>
              {editingRoom && (
                <button
                  type="button"
                  onClick={() => handleDeleteFromModal(editingRoom.id, editingRoom.roomNumber)}
                  className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ลบห้องพัก</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-bold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer"
              >
                บันทึกข้อมูล
              </button>
            </div>
          </div>

        </form>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteConfirmData}
        onClose={() => setDeleteConfirmData(null)}
        onConfirm={executeDeleteRoom}
        title={`ยืนยันการลบห้องพัก ${deleteConfirmData?.roomNum || ''}`}
        message={deleteConfirmData?.message || ''}
        confirmText="ลบห้องพักถาวร"
        cancelText="ยกเลิก"
        type="danger"
      />

    </div>
  );
};
