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
  Calendar,
  Building as BuildingIcon
} from 'lucide-react';
import {
  formatBaht,
  Modal,
  ConfirmDialog,
  OwnerDateInput
} from '../../components/GlobalComponents';
import { getDataProvider } from '../../data/dataProvider';
import { Room, Building, RoomStatus, Tenant, Contract, Bill, BLOCKING_CONTRACT_STATUSES } from '../../types';
import { SourceBadge } from '../../components/PropertyBadges';
import { VersionConflictModal } from '../../components/VersionConflictModal';

interface OwnerRoomsProps {
  rooms: Room[];
  tenants?: Tenant[];
  contracts?: Contract[];
  bills?: Bill[];
  buildings: Building[];
  onSaveRooms: (rooms: Room[]) => void;
  onSaveBuildings?: (buildings: Building[]) => void;
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
  rooms = [],
  tenants = [],
  contracts = [],
  bills = [],
  buildings = [],
  onSaveRooms,
  onSaveBuildings,
  onAddLog,
  onNavigate,
  initialRoomId,
  onClearInitialRoomId
}) => {
  const DataProvider = getDataProvider();
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'floor'>('grid');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Version Conflict Modal State
  const [versionConflictState, setVersionConflictState] = useState<{
    isOpen: boolean;
    entityName: string;
    currentVersion: number;
    onRetry?: () => void;
  } | null>(null);

  // Availability UI State (Requirement 7)
  const [availBuildingId, setAvailBuildingId] = useState<string>('all');
  const [availStartDate, setAvailStartDate] = useState<string>('2026-09-01');
  const [availEndDate, setAvailEndDate] = useState<string>('2026-10-01');
  const [availResult, setAvailResult] = useState<{ available: Room[]; total: number } | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [availSearching, setAvailSearching] = useState<boolean>(false);

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

  // Building UI State
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);
  const [buildingName, setBuildingName] = useState('');
  const [buildingCode, setBuildingCode] = useState('');
  const [buildingFloorsCount, setBuildingFloorCount] = useState<number>(1);
  const [buildingDescription, setBuildingNotes] = useState('');
  const [bldOverrideMonthlyRent, setBldOverrideMonthlyRent] = useState<number>(0);
  const [bldOverrideDepositAmount, setBldOverrideDepositAmount] = useState<number>(0);
  const [deleteBuildingConfirmData, setDeleteBuildingConfirmData] = useState<{ id: string; name: string } | null>(null);

  // Fetch Authoritative Data on Mount
  const fetchAuthoritativeData = async () => {
    try {
      if (DataProvider.properties) {
        const roomsRes = await DataProvider.properties.getAuthoritativeRooms();
        if (roomsRes.success && roomsRes.data) {
          const rawData = roomsRes.data as any;
          const fetchedItems = Array.isArray(rawData) ? rawData : (rawData.items || rawData.data || []);
          if (fetchedItems.length > 0) {
            onSaveRooms(fetchedItems);
          }
        }
        const bldRes = await DataProvider.properties.getAuthoritativeBuildings();
        if (bldRes.success && bldRes.data && onSaveBuildings) {
          const rawBld = bldRes.data as any;
          const fetchedBld = Array.isArray(rawBld) ? rawBld : (rawBld.data || rawBld.items || []);
          onSaveBuildings(fetchedBld);
        }
      }
    } catch (err) {
      // Fall back silently to props data
    }
  };

  useEffect(() => {
    fetchAuthoritativeData();
  }, []);

  const handleOpenBuildingModal = (bld: Building | null = null) => {
    setErrorText(null);
    if (bld) {
      setEditingBuilding(bld);
      setBuildingName(bld.name);
      setBuildingCode((bld as any).code || '');
      setBuildingFloorCount(bld.floorsCount || 1);
      setBuildingNotes(bld.description || '');
      setBldOverrideMonthlyRent((bld as any).rawOverrides?.monthlyRent || 0);
      setBldOverrideDepositAmount((bld as any).rawOverrides?.depositAmount || 0);
    } else {
      setEditingBuilding(null);
      setBuildingName('');
      setBuildingCode('');
      setBuildingFloorCount(1);
      setBuildingNotes('');
      setBldOverrideMonthlyRent(0);
      setBldOverrideDepositAmount(0);
    }
    setIsBuildingModalOpen(true);
  };

  const handleSaveBuilding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buildingName.trim()) {
      setErrorText('กรุณากรอกชื่ออาคาร');
      return;
    }

    try {
      if (editingBuilding && DataProvider.properties) {
        const identityChanges = {
          name: buildingName.trim(),
          code: buildingCode.trim() || undefined,
          floorCount: buildingFloorsCount,
          description: buildingDescription
        };
        const currentVer = editingBuilding.version || 1;
        const res = await DataProvider.properties.updateBuildingIdentity(editingBuilding.id, identityChanges, currentVer);

        if (!res.success) {
          if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
            setVersionConflictState({
              isOpen: true,
              entityName: `อาคาร ${buildingName}`,
              currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1,
              onRetry: () => handleSaveBuilding(e)
            });
            return;
          }
          throw new Error(res.error?.message || 'Failed to update building identity');
        }
        onAddLog('แก้ไขอาคาร', `แก้ไขอาคาร ${buildingName}`, 'Building', editingBuilding.id);
      } else {
        const res = await DataProvider.dormitories.addBuilding({
          name: buildingName,
          floorsCount: buildingFloorsCount,
          description: buildingDescription,
          status: 'active'
        } as any);
        if (!res.success) throw new Error(res.error?.message || 'Failed to create building');
        onAddLog('เพิ่มอาคาร', `เพิ่มอาคาร ${buildingName}`, 'Building', res.data?.id || 'unknown');
      }

      await fetchAuthoritativeData();
      setIsBuildingModalOpen(false);
      setToastMessage(`บันทึกอาคาร "${buildingName}" เรียบร้อยแล้ว`);
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการบันทึกอาคาร');
    }
  };

  const executeDeleteBuilding = async () => {
    if (!deleteBuildingConfirmData) return;
    try {
      const currentVer = deleteBuildingConfirmData.version || 1;
      let res: any;
      if (DataProvider.properties) {
        res = await DataProvider.properties.archiveBuilding(deleteBuildingConfirmData.id, currentVer);
      } else {
        res = await DataProvider.dormitories.deleteBuilding(deleteBuildingConfirmData.id);
      }
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: `อาคาร ${deleteBuildingConfirmData.name}`,
            currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1
          });
          setDeleteBuildingConfirmData(null);
          return;
        }
        throw new Error(res.error?.message || 'Failed to delete building');
      }
      onAddLog('ลบอาคาร', `ลบอาคาร ${deleteBuildingConfirmData.name}`, 'Building', deleteBuildingConfirmData.id);

      await fetchAuthoritativeData();
      setDeleteBuildingConfirmData(null);
      setToastMessage(`ลบอาคาร "${deleteBuildingConfirmData.name}" เรียบร้อยแล้ว`);
    } catch (err: any) {
      setDeleteBuildingConfirmData(null);
      alert(err.message || 'เกิดข้อผิดพลาดในการลบอาคาร');
    }
  };

  const handleSaveBuildingOverride = async (buildingId: string, overrideChanges: Record<string, any>) => {
    if (!DataProvider.properties) return;
    const bld = buildings.find(b => b.id === buildingId);
    const currentVer = bld?.version || 1;
    try {
      const res = await DataProvider.properties.setBuildingDefaults(buildingId, overrideChanges, currentVer);
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: `อาคาร ${bld?.name || ''}`,
            currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1,
            onRetry: () => handleSaveBuildingOverride(buildingId, overrideChanges)
          });
          return;
        }
        throw new Error(res.error?.message || 'Failed to update building overrides');
      }
      onAddLog('แก้ไขค่าเริ่มต้นอาคาร', `แก้ไขค่าเริ่มต้นอาคาร ${bld?.name || ''}`, 'Building', buildingId);
      await fetchAuthoritativeData();
      setToastMessage(`บันทึกค่าเริ่มต้นอาคารเรียบร้อยแล้ว`);
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการตั้งค่าเริ่มต้นอาคาร');
    }
  };

  const handleClearBuildingOverride = async (buildingId: string, field: string) => {
    if (!DataProvider.properties) return;
    const bld = buildings.find(b => b.id === buildingId);
    const currentVer = bld?.version || 1;
    try {
      const res = await DataProvider.properties.clearBuildingOverride(buildingId, field, currentVer);
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: `อาคาร ${bld?.name || ''}`,
            currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1,
            onRetry: () => handleClearBuildingOverride(buildingId, field)
          });
          return;
        }
        throw new Error(res.error?.message || 'Failed to clear building override');
      }
      onAddLog('ล้างค่า Override อาคาร', `ล้างค่า ${field} ของอาคาร ${bld?.name || ''}`, 'Building', buildingId);
      await fetchAuthoritativeData();
      setToastMessage(`ล้างค่า Override อาคารเรียบร้อยแล้ว`);
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการล้างค่า Override อาคาร');
    }
  };

  useEffect(() => {
    if (toastMessage) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => setIsToastFading(true), 2900);
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

  const handleOpenModal = (room: Room | null = null) => {
    setErrorText(null);
    if (room) {
      setEditingRoom(room);
      setRoomNumber(room.roomNumber);
      setBuildingId(room.buildingId || '');
      setFloor(room.derivedFloor || 1);
      const eff = (room as any).currentEffectiveValues || {};
      setMonthlyRent(eff.monthlyRent ?? room.monthlyRent ?? 4500);
      setTermRent(room.termRent || ((eff.monthlyRent ?? room.monthlyRent ?? 4500) * 4));
      setDailyRent(room.dailyRent || 500);
      setRentCycle(room.rentCycle || 'monthly');
      setDepositAmount(eff.depositAmount ?? room.depositAmount ?? 9000);
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
      if (room) handleOpenModal(room);
      onClearInitialRoomId?.();
    }
  }, [initialRoomId, rooms]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!roomNumber.trim()) {
      setErrorText('กรุณากรอกเลขห้องพัก');
      return;
    }

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

    let errorMessage = 'เกิดข้อผิดพลาดในการบันทึกห้อง';
    try {
      if (editingRoom && DataProvider.properties) {
        let currentVer = (editingRoom as any).version || 1;
        const identityChanges = {
          roomNumber: roomNumber.trim(),
          buildingId: buildingId || undefined,
          floor: Number(floor) || 1,
          roomType: (editingRoom as any).roomType || 'standard',
          rentCycle,
          status: roomStatus,
          maximumOccupants: Number(maxOccupants),
          notes
        };

        const overrideChanges = {
          monthlyRent: Number(monthlyRent),
          depositAmount: Number(depositAmount)
        };

        // 1. Update identity fields via updateRoomIdentity
        const identityRes = await DataProvider.properties.updateRoomIdentity(editingRoom.id, identityChanges, currentVer);
        if (!identityRes.success) {
          if (identityRes.error?.code === 'CONFLICT' || (identityRes.error as any)?.statusCode === 409) {
            setVersionConflictState({
              isOpen: true,
              entityName: `ห้อง ${roomNumber}`,
              currentVersion: (identityRes.error?.details as any)?.currentVersion || currentVer + 1,
              onRetry: () => handleSave(e)
            });
            return;
          }
          if (identityRes.error?.code === 'ROOM_LIMIT_EXCEEDED') throw new Error(identityRes.error.message || 'จำนวนห้องพักเกินโควต้าแพ็กเกจ');
          throw new Error(identityRes.error?.message || errorMessage);
        }

        if ((identityRes.data as any)?.version) {
          currentVer = (identityRes.data as any).version;
        } else {
          currentVer += 1;
        }

        // 2. Update default overrides via setRoomDefaults
        const overrideRes = await DataProvider.properties.setRoomDefaults(editingRoom.id, overrideChanges, currentVer);
        if (!overrideRes.success) {
          if (overrideRes.error?.code === 'CONFLICT' || (overrideRes.error as any)?.statusCode === 409) {
            setVersionConflictState({
              isOpen: true,
              entityName: `ห้อง ${roomNumber}`,
              currentVersion: (overrideRes.error?.details as any)?.currentVersion || currentVer + 1,
              onRetry: () => handleSave(e)
            });
            return;
          }
          throw new Error(overrideRes.error?.message || errorMessage);
        }

        onAddLog('แก้ไขห้องพัก', `แก้ไขรายละเอียดห้อง ${roomNumber}`, 'Room', editingRoom.id);
      } else {
        const payload = {
          roomNumber: roomNumber.trim(),
          buildingId: buildingId || undefined,
          floor: Number(floor) || 1,
          monthlyRent: String(monthlyRent),
          termRent: termRent ? String(termRent) : undefined,
          dailyRent: dailyRent ? String(dailyRent) : undefined,
          rentCycle,
          depositAmount: String(depositAmount),
          depositStatus,
          maximumOccupants: Number(maxOccupants),
          status: roomStatus,
          initialWaterReading: String(initialWaterMeter || 0),
          initialElectricityReading: String(initialElectricMeter || 0),
          notes
        };
        const res = await DataProvider.rooms.addRoom(payload as any);
        if (!res.success) {
          if (res.error?.code === 'ROOM_LIMIT_EXCEEDED') throw new Error(res.error.message || 'จำนวนห้องพักเกินโควต้าแพ็กเกจ');
          throw new Error(res.error?.message || errorMessage);
        }
        onAddLog('เพิ่มห้องพักใหม่', `สร้างเลขห้อง ${roomNumber} ใหม่ในระบบ`, 'Room', res.data?.id || 'unknown');
      }

      await fetchAuthoritativeData();

      const savedRoomNumber = roomNumber.trim();
      setIsModalOpen(false);
      setToastMessage(`เลขห้อง "${savedRoomNumber}" นี้ได้รับการบันทึกในระบบแล้ว`);
    } catch (err: any) {
      setErrorText(err.message || errorMessage);
    }
  };

  const handleClearRoomOverride = async (field: string) => {
    if (!editingRoom || !DataProvider.properties) return;
    try {
      const currentVer = editingRoom.version || 1;
      const res = await DataProvider.properties.clearRoomOverride(editingRoom.id, field, currentVer);
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: `ห้อง ${editingRoom.roomNumber}`,
            currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1
          });
          return;
        }
        throw new Error(res.error?.message || 'Failed to clear override');
      }
      onAddLog('ล้างค่าเฉพาะห้อง', `ล้างค่า override สนาม ${field} ของห้อง ${editingRoom.roomNumber}`, 'Room', editingRoom.id);
      await fetchAuthoritativeData();
      setIsModalOpen(false);
      setToastMessage(`ล้างค่า override สนาม "${field}" เรียบร้อยแล้ว`);
    } catch (err: any) {
      setErrorText(err.message || 'เกิดข้อผิดพลาดในการล้างค่า');
    }
  };

  const handleDeleteFromModal = (roomId: string, roomNum: string) => {
    const targetRoom = rooms.find(r => r.id === roomId || r.roomNumber === roomNum);
    if (!targetRoom) return;

    const infoList: string[] = [];
    if (targetRoom.currentTenantId) {
      const tenant = tenants.find(t => t.id === targetRoom.currentTenantId);
      infoList.push(`ผู้เช่าปัจจุบัน: ${tenant ? tenant.name : targetRoom.currentTenantId}`);
    }
    if (contracts && contracts.length > 0) {
      const activeContracts = contracts.filter(
        c => (c.roomId === targetRoom.id || c.roomId === targetRoom.roomNumber) &&
             BLOCKING_CONTRACT_STATUSES.includes(c.status)
      );
      if (activeContracts.length > 0) {
        infoList.push(`มีสัญญาเช่าในระบบ ${activeContracts.length} ฉบับ`);
      }
    }
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

  const executeDeleteRoom = async () => {
    if (!deleteConfirmData) return;
    const { roomId, roomNum } = deleteConfirmData;
    try {
      const targetRoom = rooms.find(r => r.id === roomId);
      const currentVer = targetRoom?.version || 1;
      let res: any;
      if (DataProvider.properties) {
        res = await DataProvider.properties.archiveRoom(roomId, currentVer);
      } else {
        res = await DataProvider.rooms.deleteRoom(roomId);
      }
      if (!res.success) {
        if (res.error?.code === 'CONFLICT' || (res.error as any)?.statusCode === 409) {
          setVersionConflictState({
            isOpen: true,
            entityName: `ห้อง ${roomNum}`,
            currentVersion: (res.error?.details as any)?.currentVersion || currentVer + 1
          });
          setDeleteConfirmData(null);
          return;
        }
        throw new Error(res.error?.message || 'Failed to delete room');
      }

      onAddLog('ลบห้องพัก', `ลบห้องเลขที่ ${roomNum} ออกจากระบบถาวร`, 'Room', roomId);

      await fetchAuthoritativeData();

      setIsModalOpen(false);
      setEditingRoom(null);
      setDeleteConfirmData(null);
      setToastMessage(`ลบห้องพัก "${roomNum}" ออกจากระบบเรียบร้อยแล้ว`);
    } catch (err: any) {
      alert(err.message || 'เกิดข้อผิดพลาดในการลบห้อง');
    }
  };

  // Availability Search Handler (Requirement 7)
  const handleQueryAvailability = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAvailError(null);
    setAvailResult(null);

    if (!availStartDate || !availEndDate) {
      setAvailError('กรุณาเลือกวันเริ่มและวันสิ้นสุดให้ถูกต้อง');
      return;
    }
    if (availStartDate > availEndDate) {
      setAvailError('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
      return;
    }

    setAvailSearching(true);
    try {
      if (DataProvider.properties) {
        const res = await DataProvider.properties.queryAvailability({
          startDate: availStartDate,
          endDate: availEndDate,
          buildingId: availBuildingId === 'all' ? undefined : availBuildingId
        });
        if (res.success && res.data) {
          const availRooms = Array.isArray(res.data) ? res.data : [];
          setAvailResult({
            available: availRooms,
            total: rooms.length
          });
        } else {
          setAvailError(res.error?.message || 'ไม่สามารถค้นหาห้องว่างได้');
        }
      }
    } catch (err: any) {
      setAvailError(err.message || 'เกิดข้อผิดพลาดในการค้นหาห้องว่าง');
    } finally {
      setAvailSearching(false);
    }
  };

  // Filter Logic
  const safeBuildings = Array.isArray(buildings) ? buildings : [];
  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const safeTenants = Array.isArray(tenants) ? tenants : [];
  const filteredRooms = safeRooms.filter(r => {
    const matchBuilding = selectedBuilding === 'all' || r.buildingId === selectedBuilding;
    const matchStatus = selectedStatus === 'all' || r.status === selectedStatus;
    const matchSearch = (r?.roomNumber || '').toLowerCase().includes((searchQuery || '').toLowerCase());
    return matchBuilding && matchStatus && matchSearch;
  });

  return (
    <div className="space-y-6 relative">
      {/* Toast Notification */}
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

      {/* Requirement 7: Date-Based Room Availability Search UI */}
      <div className="bg-gradient-to-r from-indigo-900 via-indigo-800 to-slate-900 p-5 rounded-3xl text-white shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black uppercase tracking-wider text-indigo-200 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-400" />
            ค้นหาห้องว่างตามช่วงเวลาสัญญา (Availability Search)
          </h3>
        </div>
        <form onSubmit={handleQueryAvailability} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-bold text-indigo-200 mb-1">เลือกอาคาร</label>
            <select
              aria-label="เลือกอาคารสำหรับค้นหาห้องว่าง"
              value={availBuildingId}
              onChange={(e) => setAvailBuildingId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-indigo-700 bg-indigo-950/80 rounded-xl text-white font-bold focus:outline-none"
            >
              <option value="all">อาคารทั้งหมด</option>
              {(Array.isArray(buildings) ? buildings : []).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-indigo-200 mb-1">วันเริ่มต้นสัญญา *</label>
            <OwnerDateInput
              data-testid="input-avail-start-date"
              value={availStartDate}
              onChange={(iso) => setAvailStartDate(iso)}
              className="border-indigo-700 bg-indigo-950/80 text-white"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-indigo-200 mb-1">วันสิ้นสุดสัญญา *</label>
            <OwnerDateInput
              data-testid="input-avail-end-date"
              value={availEndDate}
              onChange={(iso) => setAvailEndDate(iso)}
              className="border-indigo-700 bg-indigo-950/80 text-white"
            />
          </div>
          <div>
            <button
              type="submit"
              data-testid="btn-search-availability"
              disabled={availSearching}
              className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Search className="w-4 h-4" />
              <span>{availSearching ? 'กำลังค้นหา...' : 'ค้นหาห้องว่าง'}</span>
            </button>
          </div>
        </form>

        {availError && (
          <div className="p-2.5 bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs rounded-xl flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{availError}</span>
          </div>
        )}

        {availResult && (
          <div className="p-3 bg-indigo-950/90 border border-indigo-700/60 rounded-2xl space-y-2 text-xs">
            <div className="flex justify-between items-center font-bold">
              <span className="text-emerald-400">
                พบห้องว่าง {availResult.available.length} ห้อง (จากทั้งหมด {availResult.total} ห้อง) ช่วง {availStartDate} ถึง {availEndDate}
              </span>
              {availResult.available.length > 0 && (
                <button
                  onClick={() => setAvailResult(null)}
                  className="text-[10px] text-indigo-300 hover:text-white underline cursor-pointer"
                >
                  ล้างผลการค้นหา
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {availResult.available.map(r => (
                <span key={r.id} className="px-2.5 py-1 bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 rounded-lg text-xs font-black">
                  ห้อง {r.roomNumber} (฿{formatBaht(r.currentEffectiveValues?.monthlyRent ?? r.monthlyRent)})
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

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
          <div className="grid grid-cols-2 sm:flex sm:items-center gap-2.5 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 bg-white rounded-lg text-xs font-semibold text-slate-700 min-w-0">
              <Filter className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <select
                aria-label="กรองตามอาคาร"
                value={selectedBuilding}
                onChange={(e) => setSelectedBuilding(e.target.value)}
                className="bg-transparent focus:outline-none w-full cursor-pointer text-slate-700 font-semibold"
              >
                <option value="all">อาคารทั้งหมด</option>
                {(Array.isArray(buildings) ? buildings : []).map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
                <option value="unspecified">ไม่ระบุอาคาร</option>
              </select>
            </div>

            <select
              aria-label="กรองตามสถานะห้องพัก"
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

          <div className="flex items-center justify-between sm:justify-start gap-3 w-full sm:w-auto">
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

            <button
              data-testid="btn-edit-building"
              onClick={() => {
                const safeBldList = Array.isArray(buildings) ? buildings : [];
                const targetBld = selectedBuilding !== 'all' ? safeBldList.find(b => b.id === selectedBuilding) || safeBldList[0] : safeBldList[0];
                handleOpenBuildingModal(targetBld || null);
              }}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <Edit2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>ตั้งค่าอาคาร (Building)</span>
            </button>

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
            const bldName = safeBuildings.find(b => b.id === room.buildingId)?.name || 'ไม่ระบุอาคาร';
            const currentTenant = safeTenants.find(t => t.id === room.currentTenantId);
            const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;

            const eff = room.currentEffectiveValues || {};
            const rentVal = eff.monthlyRent ?? room.monthlyRent;
            const depositVal = eff.depositAmount ?? room.depositAmount;
            const rentSource = room.currentFieldSources?.monthlyRent;

            return (
              <div
                key={room.id}
                data-testid="room-card"
                className={`rounded-3xl border shadow-2xs hover:shadow-md transition-all duration-300 overflow-hidden flex flex-col justify-between ${statusCfg.bg} ${statusCfg.border}`}
              >
                <div className="p-5 space-y-3.5">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="text-xl font-black text-slate-900 tracking-tight">{room.roomNumber}</h4>
                      <p className="text-[11px] text-gray-500 font-semibold mt-0.5">
                        {bldName} &bull; {room.derivedFloor ? `ชั้น ${room.derivedFloor}` : <span className="text-red-500">[Error]</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-black border shadow-2xs ${statusCfg.badgeBg} ${statusCfg.badgeText} ${statusCfg.border}`}>
                        {statusCfg.label}
                      </span>

                      {room.snapshotLocked && (
                        <SourceBadge isLocked={true} />
                      )}
                      <SourceBadge source={rentSource} />
                    </div>
                  </div>

                  <div className="bg-white/90 backdrop-blur-xs p-3.5 rounded-2xl border border-gray-100 shadow-2xs space-y-3 text-xs">
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

                    <div className="space-y-1.5">
                      <p className="text-[10px] font-black uppercase text-indigo-700 tracking-wider">อัตราค่าเช่าพัก (Effective)</p>
                      <div className="flex justify-between items-center text-slate-700">
                        <span className="text-gray-500 font-medium">รายเดือน:</span>
                        <span className="font-extrabold text-slate-900">{formatBaht(rentVal)} / เดือน</span>
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

                  <div className="flex items-center justify-between text-xs px-1 pt-0.5">
                    <span className="text-gray-600 font-bold">ค่าประกัน:</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-slate-900">{formatBaht(depositVal)}</span>
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
                  const bldName = safeBuildings.find(b => b.id === room.buildingId)?.name || 'ไม่ระบุ';
                  const currentTenant = safeTenants.find(t => t.id === room.currentTenantId);
                  const statusCfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.vacant;
                  const eff = room.currentEffectiveValues || {};

                  return (
                    <tr key={room.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="p-4 font-black text-slate-900 text-sm">{room.roomNumber}</td>
                      <td className="p-4 text-gray-600 font-semibold">
                        {bldName} {room.derivedFloor ? `(ชั้น ${room.derivedFloor})` : <span className="text-red-500">([Error])</span>}
                      </td>
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
                        <div className="font-extrabold text-slate-900">{formatBaht(eff.monthlyRent ?? room.monthlyRent)} / เดือน</div>
                      </td>
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{formatBaht(eff.depositAmount ?? room.depositAmount)}</div>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 text-xs font-black rounded-xl border ${statusCfg.badgeBg} ${statusCfg.badgeText} ${statusCfg.border}`}>
                          {statusCfg.label}
                        </span>
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

      {/* Floor Map Mode */}
      {viewMode === 'floor' && (
        <div className="space-y-6">
          {safeBuildings.map((bld) => {
            const floors = Array.from(new Set(rooms.filter(r => r.buildingId === bld.id).map(r => r.derivedFloor))).sort((a, b) => (b === null ? -1 : a === null ? 1 : Number(b) - Number(a)));
            return (
              <div key={bld.id} className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <h3 className="text-base font-black text-slate-900">{bld.name}</h3>
                </div>

                <div className="space-y-4">
                  {floors.map((fl) => {
                    const floorRooms = rooms.filter(r => r.buildingId === bld.id && r.derivedFloor === fl);
                    if (floorRooms.length === 0) return null;

                    return (
                      <div key={fl} className="flex flex-col sm:flex-row gap-4 items-start sm:items-center py-3 border-b border-dashed border-gray-100">
                        <div className="w-16 shrink-0 text-xs font-black text-indigo-600 bg-indigo-50 border border-indigo-100 py-2 px-3 rounded-xl text-center">
                          {fl ? `ชั้น ${fl}` : <span className="text-red-500 font-semibold text-[10px]">Error</span>}
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
                                    {formatBaht(room.currentEffectiveValues?.monthlyRent ?? room.monthlyRent)}/ด.
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
                  name="roomNumber"
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

            <div className="space-y-3 pt-2 border-t border-gray-100 bg-slate-50/80 p-3.5 rounded-2xl border">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black text-indigo-900">อัตราค่าเช่าพัก (Room Overrides)</label>
                {editingRoom && editingRoom.rawOverrides?.monthlyRent !== undefined && (
                  <button
                    type="button"
                    onClick={() => handleClearRoomOverride('monthlyRent')}
                    className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                  >
                    ล้าง Override ค่าเช่า
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-[11px] font-bold text-slate-700">รายเดือน (บาท/เดือน)</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={monthlyRent}
                    onChange={(e) => setMonthlyRent(e.target.value === '' ? 0 : Number(e.target.value))}
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
                    onChange={(e) => setTermRent(e.target.value === '' ? 0 : Number(e.target.value))}
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
                    onChange={(e) => setDailyRent(e.target.value === '' ? 0 : Number(e.target.value))}
                    placeholder="เช่น 500"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700">เงินประกัน / มัดจำ (บาท) *</label>
                  {editingRoom && editingRoom.rawOverrides?.depositAmount !== undefined && (
                    <button
                      type="button"
                      onClick={() => handleClearRoomOverride('depositAmount')}
                      className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                    >
                      ล้าง Override
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  required
                  min={0}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value === '' ? 0 : Number(e.target.value))}
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

      {/* Building Editor & Defaults Override Modal */}
      <Modal isOpen={isBuildingModalOpen} onClose={() => setIsBuildingModalOpen(false)} title={editingBuilding ? `แก้ไขอาคาร ${buildingName}` : 'เพิ่มอาคารใหม่'}>
        <form onSubmit={handleSaveBuilding} className="space-y-4">
          <div className="max-h-[60vh] overflow-y-auto px-1.5 pb-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">ชื่ออาคาร *</label>
                <input
                  type="text"
                  name="buildingName"
                  required
                  value={buildingName}
                  onChange={(e) => setBuildingName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                  data-testid="input-building-name"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">รหัสอาคาร (Code)</label>
                <input
                  type="text"
                  name="buildingCode"
                  value={buildingCode}
                  onChange={(e) => setBuildingCode(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                  data-testid="input-building-code"
                />
              </div>
            </div>

            {editingBuilding && (
              <div className="space-y-3 pt-3 border-t border-gray-100 bg-slate-50 p-3.5 rounded-2xl border">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-black text-indigo-900">ค่าเริ่มต้นเฉพาะอาคาร (Building Overrides)</label>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="block text-[11px] font-bold text-slate-700">ค่าเช่าเริ่มต้น (บาท)</label>
                      <button
                        type="button"
                        data-testid="btn-clear-building-override"
                        onClick={() => handleClearBuildingOverride(editingBuilding.id, 'monthlyRent')}
                        className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        ล้าง
                      </button>
                    </div>
                    <input
                      type="number"
                      value={bldOverrideMonthlyRent}
                      onChange={(e) => setBldOverrideMonthlyRent(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                      data-testid="input-building-override-monthly-rent"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="block text-[11px] font-bold text-slate-700">เงินประกัน (บาท)</label>
                      <button
                        type="button"
                        data-testid="btn-clear-building-override-deposit"
                        onClick={() => handleClearBuildingOverride(editingBuilding.id, 'depositAmount')}
                        className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        ล้าง
                      </button>
                    </div>
                    <input
                      type="number"
                      value={bldOverrideDepositAmount}
                      onChange={(e) => setBldOverrideDepositAmount(Number(e.target.value))}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white font-bold"
                      data-testid="input-building-override-deposit"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    data-testid="btn-save-building-override"
                    onClick={() => handleSaveBuildingOverride(editingBuilding.id, {
                      monthlyRent: Number(bldOverrideMonthlyRent),
                      depositAmount: Number(bldOverrideDepositAmount)
                    })}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer"
                  >
                    บันทึก Override อาคาร
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-white border-t border-gray-100 flex items-center justify-between">
            {editingBuilding && (
              <button
                type="button"
                data-testid="btn-delete-building"
                onClick={() => {
                  setDeleteBuildingConfirmData(editingBuilding);
                  setIsBuildingModalOpen(false);
                }}
                className="px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs font-bold cursor-pointer"
              >
                ลบอาคาร
              </button>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsBuildingModalOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-white text-slate-600 rounded-xl text-xs font-bold"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                data-testid="btn-save-building"
                className="px-5 py-2 bg-indigo-600 text-white font-extrabold text-xs rounded-xl"
              >
                บันทึกอาคาร
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Requirement 4: VersionConflictModal Integration */}
      {versionConflictState && (
        <VersionConflictModal
          isOpen={versionConflictState.isOpen}
          entityName={versionConflictState.entityName}
          staleVersion={versionConflictState.currentVersion - 1}
          latestVersion={versionConflictState.currentVersion}
          onReload={async () => {
            await fetchAuthoritativeData();
            setVersionConflictState(null);
          }}
          onCancel={() => setVersionConflictState(null)}
          onRetry={versionConflictState.onRetry}
        />
      )}

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
