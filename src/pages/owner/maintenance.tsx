/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Wrench,
  Plus,
  Calendar,
  User,
  DollarSign,
  CheckCircle,
  Clock,
  ArrowRight,
  ArrowLeft,
  ChevronLeft,
  AlertCircle,
  X,
  Trash2,
  Layers,
  Upload
} from 'lucide-react';
import {
  StatusBadge,
  formatBaht
} from '../../components/GlobalComponents';
import { MaintenanceRequest as RepairRequest, Room, Tenant, Building } from '../../types';
import { convertImageToWebP } from '../../utils/imageUtils';
import { getDataProvider } from '../../data/dataProvider';

const formatThaiShortDate = (isoString?: string): string => {
  if (!isoString) return '-';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return '-';

  const months = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  const day = date.getDate();
  const month = months[date.getMonth()];
  const yearBE = date.getFullYear() + 543; // Buddhist Era
  const shortYear = String(yearBE).slice(-2);

  return `${day} ${month} ${shortYear}`;
};

const getElapsedDays = (isoString?: string): number => {
  if (!isoString) return 0;
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return 0;

  const now = new Date();
  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
};

const getCardStyle = (createdAt?: string) => {
  const days = getElapsedDays(createdAt);
  const baseClasses = "p-4 rounded-2xl border shadow-3xs cursor-grab active:cursor-grabbing hover:shadow-sm active:opacity-95 transition-all space-y-3";

  if (days <= 1) {
    return {
      className: `${baseClasses} bg-white border-gray-100 hover:border-indigo-400`,
      daysText: days === 0 ? 'วันนี้' : 'เมื่อวาน',
      daysColor: 'text-slate-500 bg-slate-50 border-slate-100'
    };
  } else if (days <= 3) {
    return {
      className: `${baseClasses} bg-amber-50/40 border-amber-200 hover:border-amber-400`,
      daysText: `ผ่านมา ${days} วัน`,
      daysColor: 'text-amber-700 bg-amber-50 border-amber-200/60'
    };
  } else {
    return {
      className: `${baseClasses} bg-rose-50/40 border-rose-200 hover:border-rose-400`,
      daysText: `ผ่านมา ${days} วัน`,
      daysColor: 'text-rose-700 bg-rose-50 border-rose-200/60 font-extrabold animate-pulse'
    };
  }
};

interface OwnerMaintenanceProps {
  repairs: RepairRequest[];
  rooms: Room[];
  buildings?: Building[];
  tenants: Tenant[];
  onSaveRepairs: (repairs: RepairRequest[]) => void;
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
  onNavigate?: (tab: string, param?: string) => void;
  onDetailViewChange?: (isOpen: boolean) => void;
}

export const OwnerMaintenance: React.FC<OwnerMaintenanceProps> = ({
  repairs,
  rooms,
  buildings = [],
  tenants,
  onSaveRepairs,
  onAddLog,
  onNavigate,
  onDetailViewChange
}) => {
  const [selectedRepair, setSelectedRepair] = useState<RepairRequest | null>(null);
  const [zoomedImg, setZoomedImg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'inprogress' | 'completed'>('all');

  // Create state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageBefore, setImageBefore] = useState('');
  const [roomId, setRoomId] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [isRoomDropdownOpen, setIsRoomDropdownOpen] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);

  useEffect(() => {
    onDetailViewChange?.(!!selectedRepair || isCreateOpen);
    return () => {
      onDetailViewChange?.(false);
    };
  }, [selectedRepair, isCreateOpen, onDetailViewChange]);

  const handleCloseCreate = () => {
    onDetailViewChange?.(false);
    setIsCreateOpen(false);
    setIsRoomDropdownOpen(false);
  };

  const handleCloseDetail = () => {
    onDetailViewChange?.(false);
    setSelectedRepair(null);
  };

  const handleOpenCreate = () => {
    onDetailViewChange?.(true);
    setIsCreateOpen(true);
  };

  const handleOpenDetail = (rep: RepairRequest) => {
    onDetailViewChange?.(true);
    setSelectedRepair(rep);
    setAssignedStaff(rep.assignedStaff || '');
    setCost(rep.cost || 0);
    setNote(rep.note || '');
  };

  // Update State inside Detail View
  const [assignedStaff, setAssignedStaff] = useState('');
  const [cost, setCost] = useState(0);
  const [note, setNote] = useState('');
  const [ownerImage, setOwnerImage] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  React.useEffect(() => {
    if (selectedRepair) {
      setAssignedStaff(selectedRepair.assignedStaff || '');
      setCost(selectedRepair.cost || 0);
      setNote(selectedRepair.note || '');
      setOwnerImage(selectedRepair.imageAfter || '');
    }
  }, [selectedRepair]);

  React.useEffect(() => {
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

  const getRoomNum = (rId: string) => rooms.find(r => r.id === rId)?.roomNumber || 'ส่วนกลาง';

  const getRoomDisplayLabel = (rId: string) => {
    if (!rId) return 'ส่วนกลาง';
    const r = rooms.find(room => room.id === rId);
    if (!r) return 'ส่วนกลาง';
    const b = buildings.find(bld => bld.id.toLowerCase() === (r.buildingId || '').toLowerCase());
    const bldShortName = b ? b.name.replace(/^อาคาร\s*/, '') : '';
    return bldShortName ? `ห้อง ${r.roomNumber} • ${bldShortName}` : `ห้อง ${r.roomNumber}`;
  };

  const getDetailBreadcrumbLabel = (repair: RepairRequest) => {
    let prefix = 'แจ้งซ่อม';
    if (activeTab === 'inprogress' || (activeTab === 'all' && (repair.status === 'inprogress' || repair.status === 'waiting_parts'))) {
      prefix = 'กำลังซ่อม';
    } else if (activeTab === 'completed' || (activeTab === 'all' && repair.status === 'completed')) {
      prefix = 'งานสำเร็จ';
    } else {
      prefix = 'แจ้งซ่อม';
    }
    const room = getRoomNum(repair.roomId || '');
    return `${prefix} ${room}`;
  };

  const handleCreateRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    let createdItem: RepairRequest | null = null;
    try {
      const dataProvider = getDataProvider();
      const res = await dataProvider.maintenance.createRequest({
        roomId: roomId || undefined,
        tenantId: roomId ? rooms.find(r => r.id === roomId)?.currentTenantId : undefined,
        title: title.trim(),
        description: description.trim(),
        imageBefore: imageBefore || undefined,
        urgency: priority as any,
        status: 'submitted',
      });
      if (res.success && res.data) {
        createdItem = res.data;
      }
    } catch (err) {
      console.error('Failed to create maintenance request on server:', err);
    }

    const newId = createdItem?.id || `rep-${Date.now()}`;
    const newRepair: RepairRequest = createdItem || {
      id: newId,
      roomId: roomId || undefined,
      tenantId: roomId ? rooms.find(r => r.id === roomId)?.currentTenantId : undefined,
      title: title.trim(),
      description: description.trim(),
      imageBefore: imageBefore || undefined,
      urgency: priority as any,
      status: 'submitted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    onSaveRepairs([newRepair, ...repairs]);
    handleCloseCreate();
    onAddLog?.('สร้างบันทึกแจ้งซ่อมใหม่', `สร้างแจ้งเรื่อง "${title}" สำหรับห้อง ${roomId ? getRoomNum(roomId) : 'ส่วนกลาง'}`, 'RepairRequest', newId);

    // Reset Form
    setTitle('');
    setDescription('');
    setImageBefore('');
    setRoomId('');
    setPriority('medium');
    setToastMessage('สร้างเรื่องแจ้งซ่อมเรียบร้อยแล้ว');
  };

  const executeDeleteRepair = async (repairId: string) => {
    const target = repairs.find(r => r.id === repairId);
    if (!target) return;

    try {
      const dataProvider = getDataProvider();
      await dataProvider.maintenance.deleteRequest?.(repairId);
    } catch (err) {
      console.error('Failed to delete maintenance request on server:', err);
    }

    // Delete completely from the array (since it's only called on completed status as per instructions)
    const updated = repairs.filter(r => r.id !== repairId);
    onAddLog?.('ลบรายการแจ้งซ่อม', `ลบรายการแจ้งซ่อม "${target.title}"`, 'RepairRequest', repairId);

    onSaveRepairs(updated);
    handleCloseDetail();
    setToastMessage(`ลบรายการ "${target.title}" เรียบร้อยแล้ว`);
  };

  const [isDraggingOverCol, setIsDraggingOverCol] = useState<'pending' | 'inprogress' | 'completed' | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, col: 'pending' | 'inprogress' | 'completed') => {
    e.preventDefault();
    setIsDraggingOverCol(col);
  };

  const handleDragLeave = () => {
    setIsDraggingOverCol(null);
  };

  const handleDrop = (e: React.DragEvent, targetCol: 'pending' | 'inprogress' | 'completed') => {
    e.preventDefault();
    setIsDraggingOverCol(null);
    const repairId = e.dataTransfer.getData('text/plain');
    if (!repairId) return;

    let nextStatus: 'submitted' | 'inprogress' | 'completed' = 'submitted';
    if (targetCol === 'inprogress') {
      nextStatus = 'inprogress';
    } else if (targetCol === 'completed') {
      nextStatus = 'completed';
    }

    const repair = repairs.find(r => r.id === repairId);
    if (repair && repair.status !== nextStatus) {
      handleUpdateStatus(repairId, nextStatus);
    }
  };

  const handleUpdateStatus = async (repairId: string, nextStatus: 'submitted' | 'inprogress' | 'completed') => {
    const nextStaff = nextStatus === 'submitted' ? '' : (assignedStaff || selectedRepair?.assignedStaff || '');
    const nextCost = nextStatus === 'submitted' ? 0 : (cost || selectedRepair?.cost || 0);
    const nextNote = nextStatus === 'submitted' ? '' : (note || selectedRepair?.note || '');
    const nextImage = ownerImage || selectedRepair?.imageAfter || '';

    try {
      const dataProvider = getDataProvider();
      await dataProvider.maintenance.updateStatus(
        repairId,
        nextStatus,
        nextNote,
        undefined,
        {
          assignedStaff: nextStaff,
          cost: nextCost,
          imageAfter: nextImage
        }
      );
    } catch (err) {
      console.error('Failed to update maintenance status on server:', err);
    }

    const updated = repairs.map(r => {
      if (r.id === repairId) {
        return {
          ...r,
          status: nextStatus,
          assignedStaff: nextStaff,
          cost: nextCost,
          note: nextNote,
          imageAfter: nextImage,
          updatedAt: new Date().toISOString()
        };
      }
      return r;
    });

    onSaveRepairs(updated);

    // audit
    const actionText = nextStatus === 'submitted' ? 'ย้อนกลับเป็นแจ้งซ่อมใหม่' : nextStatus === 'inprogress' ? 'เริ่มดำเนินงานซ่อม' : 'ปิดงานแจ้งซ่อม';
    const target = repairs.find(r => r.id === repairId);
    onAddLog?.(actionText, `ปรับปรุงสถานะงานซ่อม "${target?.title}" เป็น ${nextStatus}`, 'RepairRequest', repairId);

    // Reset inputs
    setAssignedStaff('');
    setCost(0);
    setNote('');
    setOwnerImage('');
    handleCloseDetail();
  };

  // Group repairs by status for columns
  const isPending = (status: string) => ['submitted', 'accepted', 'more_info', 'scheduled', 'pending'].includes(status);
  const isInProgress = (status: string) => ['inprogress', 'waiting_parts', 'in_progress'].includes(status);
  const isCompleted = (status: string) => status === 'completed';

  const pendingRepairs = repairs
    .filter(r => isPending(r.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const inProgressRepairs = repairs
    .filter(r => isInProgress(r.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const completedRepairs = repairs
    .filter(r => isCompleted(r.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      {isCreateOpen ? (
        <div className="h-full w-full flex flex-col bg-slate-50 animate-in fade-in duration-200">
          {/* Top Header: Seamlessly flush with top bar */}
          <header className="shrink-0 bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between shadow-xs z-20 -mt-[1px]">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 font-sans">
              {/* 1. กลับ */}
              <button
                type="button"
                onClick={handleCloseCreate}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 -ml-2 rounded-xl text-slate-700 hover:text-indigo-600 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer font-extrabold text-xs sm:text-sm shrink-0 group"
                title="ย้อนกลับ"
              >
                <span>กลับ</span>
              </button>

              <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 stroke-[2.5]" />

              {/* 2. สร้างเรื่องแจ้งซ่อม (ไม่เกิดอะไรขึ้นเมื่อกด) */}
              <span className="px-1.5 sm:px-2 py-1.5 text-slate-800 font-extrabold text-xs sm:text-sm shrink-0 select-none">
                สร้างเรื่องแจ้งซ่อม
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCloseCreate}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                title="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Body content: Scrollable with centered max-w-3xl container */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-6 pb-28">
            <div className="max-w-3xl mx-auto space-y-5 text-xs text-slate-800 pb-12">
              <form id="create-repair-form" onSubmit={handleCreateRepair} className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-5">
                <div className="border-b border-slate-100 pb-4">
                  <h4 className="font-black text-base sm:text-lg text-slate-900 leading-tight">
                    บันทึกรายการแจ้งซ่อมบำรุง
                  </h4>
                  <p className="text-slate-500 font-medium font-sans text-xs mt-0.5">
                    ระบุอาการชำรุดและห้องพักที่ต้องการให้เข้าซ่อมบำรุง
                  </p>
                </div>

                {/* Title */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 text-xs sm:text-sm">
                    เรื่องที่แจ้งซ่อมแซม <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="เช่น ท่อน้ำห้องน้ำชั้น 2 ซึมรั่วซึม, แอร์ไม่เย็น, หลอดไฟทางเดินเสีย"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-semibold text-xs sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                {/* Room selector */}
                <div className="space-y-1.5 relative font-sans">
                  <label className="block font-bold text-slate-700 text-xs sm:text-sm">ห้องพักที่เกิดเหตุ</label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsRoomDropdownOpen(!isRoomDropdownOpen)}
                      className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-700 font-semibold text-xs sm:text-sm text-left outline-none focus:border-indigo-500 cursor-pointer flex items-center justify-between shadow-2xs hover:border-slate-300 transition-all"
                    >
                      <span>{roomId ? getRoomDisplayLabel(roomId) : 'ส่วนกลาง'}</span>
                      <span className="text-slate-400 text-xs">▼</span>
                    </button>
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <Layers className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>

                  {isRoomDropdownOpen && (
                    <div className="absolute z-50 left-0 right-0 mt-1.5 p-3.5 bg-slate-50 border border-slate-200 rounded-2xl shadow-lg animate-in fade-in-50 duration-200 max-h-[220px] overflow-y-auto scrollbar-thin">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between pb-1.5 border-b border-slate-200">
                          <span className="text-[10px] font-extrabold text-slate-500">จิ้มเลือกเลขห้องเพื่อระบุ (เลือกได้ 1 ห้อง):</span>
                          <button
                            type="button"
                            onClick={() => {
                              setRoomId('');
                              setIsRoomDropdownOpen(false);
                            }}
                            className="text-[10px] font-black text-rose-600 hover:underline cursor-pointer"
                          >
                            ส่วนกลาง
                          </button>
                        </div>

                        {rooms && rooms.length > 0 ? (
                          <div className="space-y-3 pt-1 text-left">
                            {Array.from(new Set(rooms.map(r => r.buildingId).filter((id): id is string => !!id))).sort((idA, idB) => {
                              const sortedBuildingsList = [...buildings].sort((a, b) => {
                                const orderA = a.displayOrder ?? 0;
                                const orderB = b.displayOrder ?? 0;
                                if (orderA !== orderB) return orderA - orderB;
                                const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                                const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                                return dateA - dateB;
                              });
                              const idxA = sortedBuildingsList.findIndex(b => b.id.toLowerCase() === idA.toLowerCase());
                              const idxB = sortedBuildingsList.findIndex(b => b.id.toLowerCase() === idB.toLowerCase());
                              return (idxA !== -1 ? idxA : 999) - (idxB !== -1 ? idxB : 999);
                            }).map((bldId: string) => {
                              const b = buildings.find(bld => bld.id.toLowerCase() === bldId.toLowerCase());
                              const bldName = b ? b.name : (bldId === 'bld-a' ? 'อาคาร A (วิวเขา)' : bldId === 'bld-b' ? 'อาคาร B' : `อาคาร ${bldId.replace('bld-', '').toUpperCase()}`);
                              const bldRooms = rooms.filter(r => r.buildingId === bldId);
                              const floors = Array.from(new Set(bldRooms.map(r => r.floor))).sort((a, b) => Number(a) - Number(b));

                              return (
                                <div key={bldId} className="space-y-1.5 border-b border-slate-200 pb-2.5 last:border-0 last:pb-0">
                                  <span className="text-[10px] font-black text-indigo-600 block">{bldName}</span>

                                  {floors.map(fl => {
                                    const floorRooms = bldRooms.filter(r => r.floor === fl).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
                                    return (
                                      <div key={fl} className="flex items-start gap-2">
                                        <span className="text-[9px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded shrink-0 mt-0.5">ชั้น {fl}</span>
                                        <div className="flex flex-wrap gap-1">
                                          {floorRooms.map(room => {
                                            const isSelected = roomId === room.id;
                                            return (
                                              <button
                                                key={room.id}
                                                type="button"
                                                onClick={() => {
                                                  setRoomId(room.id);
                                                  setIsRoomDropdownOpen(false);
                                                }}
                                                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isSelected
                                                    ? 'bg-indigo-600 text-white shadow-2xs scale-95 font-extrabold'
                                                    : 'bg-white text-slate-700 border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/20'
                                                  }`}
                                              >
                                                {room.roomNumber}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[10px] text-gray-400 font-bold text-center py-4">ไม่พบห้องพักที่กำหนด</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 text-xs sm:text-sm">
                    คำอธิบายอาการชำรุดอย่างละเอียด <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="กรุณาระบุลักษณะอาการ ความกว้างเสียหาย หรือจุดสังเกตเพื่อช่วยช่างเตรียมอุปกรณ์..."
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 text-xs sm:text-sm h-28 resize-none outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                {/* Image attachment */}
                <div className="space-y-1.5">
                  <label className="block font-bold text-slate-700 text-xs sm:text-sm">แนบรูปภาพจุดที่ชำรุด (ไม่บังคับ)</label>
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-4 transition-all relative min-h-[140px] bg-slate-50/60">
                    {imageBefore ? (
                      <div className="relative overflow-hidden w-full max-h-64 flex items-center justify-center rounded-xl z-30">
                        <img src={imageBefore} alt="รูปจุดชำรุด" className="w-full max-h-60 object-contain rounded-xl" />
                        <button
                          type="button"
                          onClick={() => setImageBefore('')}
                          className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 z-40"
                        >
                          ล้างรูปภาพ
                        </button>
                      </div>
                    ) : (
                      <div className="text-center space-y-1.5 text-slate-400 py-4 relative z-10 pointer-events-none">
                        <Upload className="w-8 h-8 text-indigo-400 mx-auto" />
                        <p className="text-xs font-bold text-slate-700">ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด</p>
                        <p className="text-[10px] text-slate-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</p>
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const webp = await convertImageToWebP(file);
                            setImageBefore(webp);
                          } catch (err) {
                            console.error('Failed to convert image to WebP', err);
                          }
                        }
                      }}
                      className={`absolute inset-0 w-full h-full opacity-0 cursor-pointer ${imageBefore ? 'z-0' : 'z-20'}`}
                    />
                  </div>
                </div>
              </form>
            </div>
          </div>

          {/* Bottom Action Bar: Flush and locked to bottom of viewport */}
          <footer className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white border-t border-slate-200 px-4 sm:px-6 py-3.5 shadow-md">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 font-sans w-full">
              <button
                type="button"
                onClick={handleCloseCreate}
                className="px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs sm:text-sm active:scale-95 shadow-3xs"
              >
                <ArrowLeft className="w-4 h-4" />
                ย้อนกลับ
              </button>

              <button
                type="submit"
                form="create-repair-form"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs sm:text-sm shadow-md"
              >
                <span>สร้างประวัติเรื่องแจ้งซ่อม</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </footer>
        </div>
      ) : !selectedRepair ? (
        <div className="space-y-6">

          {/* Filter Tabs & Quick Action Row */}
          <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 shrink-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full md:w-auto flex-1 max-w-3xl">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 w-full text-center outline-none focus:outline-none focus:ring-0 select-none ${activeTab === 'all'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="truncate">ทั้งหมด ({repairs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('pending')}
                className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 w-full text-center outline-none focus:outline-none focus:ring-0 select-none ${activeTab === 'pending'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <Clock className="w-4 h-4 text-indigo-500 shrink-0" />
                <span className="truncate">แจ้งซ่อม ({pendingRepairs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('inprogress')}
                className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 w-full text-center outline-none focus:outline-none focus:ring-0 select-none ${activeTab === 'inprogress'
                    ? 'bg-white text-amber-600 shadow-xs'
                    : 'text-slate-500 hover:text-amber-600'
                  }`}
              >
                <Wrench className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="truncate">กำลังซ่อม ({inProgressRepairs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('completed')}
                className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-colors duration-150 cursor-pointer flex items-center justify-center gap-1.5 w-full text-center outline-none focus:outline-none focus:ring-0 select-none ${activeTab === 'completed'
                    ? 'bg-white text-emerald-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                  }`}
              >
                <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                <span className="truncate">งานสำเร็จ ({completedRepairs.length})</span>
              </button>
            </div>

            <button
              onClick={handleOpenCreate}
              className="px-4 sm:px-5 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>สร้างเรื่องแจ้งซ่อมฉุกเฉิน</span>
            </button>
          </div>

          {/* Interactive Kanban Grid */}
          <div className={`grid gap-4 md:gap-6 min-h-[580px] ${activeTab === 'all' ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1'}`}>

            {/* Column 1: Pending */}
            {(activeTab === 'all' || activeTab === 'pending') && (
              <div
                onDragOver={(e) => handleDragOver(e, 'pending')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'pending')}
                className={`rounded-3xl p-4 flex flex-col h-full ${isDraggingOverCol === 'pending'
                    ? 'bg-indigo-50/40 border border-indigo-400 scale-[1.01] ring-2 ring-indigo-100 transition-colors duration-150'
                    : 'bg-slate-50 border border-slate-100'
                  }`}
              >
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-indigo-600" />
                    แจ้งซ่อม ({pendingRepairs.length})
                  </h4>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 p-1.5">
                  {pendingRepairs.map(rep => {
                    const cardStyle = getCardStyle(rep.createdAt);
                    return (
                      <div
                        key={rep.id}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, rep.id)}
                        onClick={() => handleOpenDetail(rep)}
                        className={cardStyle.className}
                      >
                        <div className="flex justify-between items-start pointer-events-none">
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${rep.priority === 'high' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
                              rep.priority === 'medium' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                'bg-slate-50 text-slate-700 border border-slate-100'
                            }`}>
                            {rep.priority === 'high' ? 'ด่วนที่สุด' : rep.priority === 'medium' ? 'ปานกลาง' : 'ทั่วไป'}
                          </span>
                          <span className="text-[10px] text-gray-400 font-bold">ห้อง {getRoomNum(rep.roomId || '')}</span>
                        </div>
                        <h5 className="font-bold text-slate-800 text-xs leading-snug pointer-events-none">{rep.title}</h5>
                        <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed pointer-events-none">{rep.description}</p>

                        {/* Elapsed days indicator */}
                        <div className="flex justify-between items-center pt-2 pointer-events-none">
                          <span className="text-[9px] text-slate-400 font-medium">วันที่แจ้ง: {formatThaiShortDate(rep.createdAt)}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-extrabold ${cardStyle.daysColor}`}>
                            {cardStyle.daysText}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {pendingRepairs.length === 0 && (
                    <p className="text-center py-12 text-[10px] text-gray-400 font-semibold">ไม่มีเรื่องค้างแจ้ง</p>
                  )}
                </div>
              </div>
            )}

            {/* Column 2: In Progress */}
            {(activeTab === 'all' || activeTab === 'inprogress') && (
              <div
                onDragOver={(e) => handleDragOver(e, 'inprogress')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'inprogress')}
                className={`rounded-3xl p-4 flex flex-col h-full ${isDraggingOverCol === 'inprogress'
                    ? 'bg-amber-100/50 border border-amber-500 scale-[1.01] ring-2 ring-amber-200 transition-colors duration-150'
                    : 'bg-amber-50/25 border border-amber-100/50'
                  }`}
              >
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h4 className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                    <Wrench className="w-4 h-4 text-amber-500" />
                    กำลังซ่อม ({inProgressRepairs.length})
                  </h4>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 p-1.5">
                  {inProgressRepairs.map(rep => {
                    const cardStyle = getCardStyle(rep.createdAt);
                    return (
                      <div
                        key={rep.id}
                        draggable={true}
                        onDragStart={(e) => handleDragStart(e, rep.id)}
                        onClick={() => handleOpenDetail(rep)}
                        className={cardStyle.className}
                      >
                        <div className="flex justify-between items-start pointer-events-none">
                          <span className="text-[10px] text-amber-800 font-bold">ช่าง: {rep.assignedStaff || 'รอมอบหมาย'}</span>
                          <span className="text-[10px] text-gray-400 font-bold">ห้อง {getRoomNum(rep.roomId || '')}</span>
                        </div>
                        <h5 className="font-bold text-slate-800 text-xs leading-snug pointer-events-none">{rep.title}</h5>
                        <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed pointer-events-none">{rep.description}</p>

                        {/* Elapsed days indicator */}
                        <div className="flex justify-between items-center pt-2 pointer-events-none">
                          <span className="text-[9px] text-slate-400 font-medium">วันที่แจ้ง: {formatThaiShortDate(rep.createdAt)}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md border font-extrabold ${cardStyle.daysColor}`}>
                            {cardStyle.daysText}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {inProgressRepairs.length === 0 && (
                    <p className="text-center py-12 text-[10px] text-gray-400 font-semibold">ไม่มีรายการซ่อมระหว่างทาง</p>
                  )}
                </div>
              </div>
            )}

            {/* Column 3: Completed */}
            {(activeTab === 'all' || activeTab === 'completed') && (
              <div
                onDragOver={(e) => handleDragOver(e, 'completed')}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, 'completed')}
                className={`rounded-3xl p-4 flex flex-col h-full ${isDraggingOverCol === 'completed'
                    ? 'bg-emerald-100/30 border border-emerald-500 scale-[1.01] ring-2 ring-emerald-200 transition-colors duration-150'
                    : 'bg-emerald-50/10 border border-emerald-100/30'
                  }`}
              >
                <div className="flex justify-between items-center mb-4 shrink-0">
                  <h4 className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600" />
                    งานสำเร็จ ({completedRepairs.length})
                  </h4>
                </div>

                <div className="flex-1 overflow-y-auto space-y-3 p-1.5">
                  {completedRepairs.map(rep => (
                    <div
                      key={rep.id}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, rep.id)}
                      onClick={() => handleOpenDetail(rep)}
                      className="bg-white p-4 rounded-2xl border border-gray-100 opacity-90 cursor-grab active:cursor-grabbing hover:border-emerald-400 hover:shadow-sm active:opacity-95 transition-all space-y-3"
                    >
                      <div className="flex justify-between items-start pointer-events-none">
                        <StatusBadge status={rep.status} type="maintenance" />
                        <span className="text-[10px] text-emerald-700 font-bold">{formatBaht(rep.cost || 0)}</span>
                      </div>
                      <h5 className="font-bold text-slate-700 text-xs line-through leading-snug pointer-events-none">{rep.title}</h5>
                      <div className="flex justify-between items-center text-[9px] text-gray-400 mt-1 font-semibold pointer-events-none">
                        <span>ห้อง {getRoomNum(rep.roomId || '')}</span>
                        <span>ปิดงาน: {formatThaiShortDate(rep.updatedAt)}</span>
                      </div>
                    </div>
                  ))}
                  {completedRepairs.length === 0 && (
                    <p className="text-center py-12 text-[10px] text-gray-400 font-semibold">ไม่มีประวัติงานเสร็จ</p>
                  )}
                </div>
              </div>
            )}

          </div>

        </div>
      ) : (
        <div className="h-full w-full flex flex-col bg-slate-50 animate-in fade-in duration-200">
          {/* Top Header: Seamlessly flush with top bar */}
          <header className="shrink-0 bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between shadow-xs z-20 -mt-[1px]">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 font-sans">
              {/* 1. กลับ */}
              <button
                type="button"
                onClick={handleCloseDetail}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 -ml-2 rounded-xl text-slate-700 hover:text-indigo-600 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer font-extrabold text-xs sm:text-sm shrink-0 group"
                title="ย้อนกลับ"
              >
                <span>กลับ</span>
              </button>

              <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 stroke-[2.5]" />

              {/* 2. แท็บที่กด + เลขห้อง เช่น แจ้งซ่อม A101 / กำลังซ่อม A102 / งานสำเร็จ A103 (ไม่เกิดอะไรขึ้นเมื่อกด) */}
              <span className="px-1.5 sm:px-2 py-1.5 text-slate-800 font-extrabold text-xs sm:text-sm shrink-0 select-none">
                {getDetailBreadcrumbLabel(selectedRepair)}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCloseDetail}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                title="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Body content: Scrollable with centered max-w-3xl container */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-6 pb-28">
            <div className="max-w-3xl mx-auto space-y-5 text-xs text-slate-800 pb-12">
              {/* Overview Card */}
              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                  <div className="space-y-1 min-w-0 flex-1">
                    <h4 className="font-black text-base sm:text-lg text-slate-900 leading-tight break-words">
                      {selectedRepair.title}
                    </h4>
                    <p className="text-slate-500 font-medium font-sans text-xs">
                      วันที่แจ้ง: <span className="font-bold text-slate-700">{formatThaiShortDate(selectedRepair.createdAt)}</span>
                    </p>
                  </div>
                  <div className="shrink-0">
                    <StatusBadge status={selectedRepair.status} type="maintenance" />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <p className="font-bold text-slate-700 text-xs sm:text-sm">รายละเอียดแจ้ง:</p>
                  <div className="p-3.5 sm:p-4 bg-slate-50 border border-slate-200/60 rounded-xl text-xs sm:text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {selectedRepair.description}
                  </div>
                </div>

                {/* Tenant attached photo */}
                {selectedRepair.imageBefore && (
                  <div className="space-y-2 pt-2">
                    <p className="font-bold text-slate-700 text-xs sm:text-sm">รูปภาพที่ผู้เช่าแนบมา:</p>
                    <div
                      onClick={() => setZoomedImg(selectedRepair.imageBefore || null)}
                      className="relative group inline-block rounded-2xl overflow-hidden border border-slate-200 cursor-zoom-in shadow-2xs max-w-full bg-slate-50"
                    >
                      <img
                        src={selectedRepair.imageBefore}
                        alt="หลักฐานปัญหาการซ่อม"
                        className="block rounded-2xl object-contain max-h-60 sm:max-h-64 w-auto max-w-full hover:scale-[1.01] transition-transform"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 flex items-end justify-center p-2.5 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                        <span className="px-2.5 py-1 bg-black/75 rounded-lg text-[10px] text-white font-bold backdrop-blur-xs shadow-xs flex items-center gap-1">
                          คลิกเพื่อขยายรูปภาพ 🔍
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress & Technician Form (when in progress or submitted) */}
              {selectedRepair.status !== 'completed' && selectedRepair.status !== 'cancelled' && (
                <div className="bg-white p-5 sm:p-6 rounded-2xl border border-indigo-100 shadow-2xs space-y-4">
                  <div className="flex items-center gap-2 border-b border-indigo-50 pb-3">
                    <Wrench className="w-4 h-4 text-indigo-600" />
                    <h5 className="font-extrabold text-sm sm:text-base text-indigo-950">ฟอร์มบันทึกความคืบหน้างานซ่อม:</h5>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-600">ช่างผู้รับผิดชอบงาน</label>
                      <input
                        type="text"
                        value={assignedStaff}
                        onChange={(e) => setAssignedStaff(e.target.value)}
                        placeholder="เช่น นายช่างสมยศ"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-slate-600">ค่าอะไหล่วัสดุรวม (บาท)</label>
                      <input
                        type="number"
                        value={cost || ''}
                        onChange={(e) => setCost(Number(e.target.value))}
                        placeholder="0.00"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs sm:text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-bold text-slate-600">บันทึกช่วยจำช่างเสริม</label>
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="รายละเอียดอะไหล่ที่เปลี่ยน หรือสาเหตุปัญหา..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs sm:text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-600">แนบรูปภาพผลการซ่อม / ใบเสร็จ / อะไหล่</label>
                    {ownerImage ? (
                      <div className="relative overflow-hidden w-full max-h-72 flex items-center justify-center p-2 rounded-2xl bg-slate-50 border border-slate-200 group">
                        <img src={ownerImage} alt="รูปผลงานซ่อม" className="max-h-64 object-contain rounded-xl" />
                        <button
                          type="button"
                          onClick={() => setOwnerImage('')}
                          className="absolute top-4 right-4 bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 z-40"
                        >
                          ล้างรูปภาพ
                        </button>
                      </div>
                    ) : (
                      <div className="relative flex flex-col items-center justify-center border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-2xl p-6 hover:bg-indigo-50/10 transition-all bg-slate-50/50">
                        <div className="text-center space-y-1 text-slate-400 py-3 pointer-events-none">
                          <Upload className="w-8 h-8 text-indigo-400 mx-auto mb-1" />
                          <p className="text-xs sm:text-sm font-bold text-slate-700">ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด</p>
                          <p className="text-[10px] sm:text-xs text-slate-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</p>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              try {
                                const webp = await convertImageToWebP(file);
                                setOwnerImage(webp);
                              } catch (err) {
                                console.error('Failed to convert image to WebP', err);
                              }
                            }
                          }}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* History Details */}
              {(selectedRepair.status === 'completed' || selectedRepair.status === 'cancelled') && (
                <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
                  <h5 className="font-extrabold text-sm sm:text-base text-slate-900 border-b border-slate-100 pb-3">ประวัติการดำเนินการ</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                    <p><span className="text-slate-400">ช่างที่ดำเนินการ:</span> <span className="font-bold text-slate-800">{selectedRepair.assignedStaff || 'ไม่ระบุ'}</span></p>
                    <p><span className="text-slate-400">ค่าใช้จ่ายสุทธิ:</span> <span className="font-bold text-emerald-600">{formatBaht(selectedRepair.cost || 0)}</span></p>
                  </div>
                  {selectedRepair.note && (
                    <p className="text-xs sm:text-sm"><span className="text-slate-400">หมายเหตุช่าง:</span> <span className="text-slate-700 font-medium">{selectedRepair.note}</span></p>
                  )}
                  {(selectedRepair.imageAfter || ownerImage) && (
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <p className="font-bold text-slate-700 text-xs sm:text-sm">รูปภาพหลักฐานผลการซ่อม (แนบโดยเจ้าของ/ช่าง):</p>
                      <div
                        onClick={() => setZoomedImg(selectedRepair.imageAfter || ownerImage)}
                        className="relative group inline-block rounded-2xl overflow-hidden border border-slate-200 cursor-zoom-in shadow-2xs max-w-full bg-slate-50"
                      >
                        <img
                          src={selectedRepair.imageAfter || ownerImage}
                          alt="รูปผลงานซ่อมเสร็จ"
                          className="block rounded-2xl object-contain max-h-60 sm:max-h-64 w-auto max-w-full hover:scale-[1.01] transition-transform"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute inset-0 flex items-end justify-center p-2.5 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <span className="px-2.5 py-1 bg-black/75 rounded-lg text-[10px] text-white font-bold backdrop-blur-xs shadow-xs flex items-center gap-1">
                            คลิกเพื่อขยายรูปภาพ 🔍
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Bar: Flush and locked to bottom of viewport */}
          <footer className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white border-t border-slate-200 px-4 sm:px-6 py-3.5 shadow-md">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 font-sans w-full">
              {selectedRepair.status === 'completed' ? (
                <button
                  type="button"
                  onClick={() => executeDeleteRepair(selectedRepair.id)}
                  className="px-4 py-2.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs sm:text-sm active:scale-95"
                >
                  <Trash2 className="w-4 h-4" />
                  ลบประวัติงานซ่อม
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCloseDetail}
                  className="px-4 py-2.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4" />
                  ย้อนกลับ
                </button>
              )}

              <div className="flex items-center gap-2.5">
                {selectedRepair.status === 'completed' && (
                  <button
                    type="button"
                    onClick={handleCloseDetail}
                    className="px-4 py-2.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition-all active:scale-95"
                  >
                    ปิดหน้าต่าง
                  </button>
                )}

                {isPending(selectedRepair.status) && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(selectedRepair.id, 'inprogress')}
                    className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl text-xs sm:text-sm cursor-pointer shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <span>เริ่มดำเนินการ</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}

                {isInProgress(selectedRepair.status) && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(selectedRepair.id, 'completed')}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold rounded-xl text-xs sm:text-sm cursor-pointer shadow-xs transition-all active:scale-95 flex items-center gap-1.5"
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>ซ่อมแซมเสร็จสิ้น</span>
                  </button>
                )}
              </div>
            </div>
          </footer>
        </div>
      )}

      {/* Zoomed Image Lightbox Popup */}
      {zoomedImg && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-[9999] flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setZoomedImg(null)}
        >
          <div
            className="relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Elegant close button positioned outside the top-right of the image itself */}
            <button
              type="button"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setZoomedImg(null)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img
              src={zoomedImg}
              alt="Zoomed Detail"
              className="max-w-[90vw] md:max-w-4xl max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-3xl shadow-2xl"
              onClick={() => setZoomedImg(null)}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

      {/* Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {toastMessage && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <CheckCircle className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

    </>
  );
};
