/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import {
  Wrench,
  Plus,
  Calendar,
  User,
  DollarSign,
  CheckCircle,
  Clock,
  ArrowRight,
  AlertCircle,
  X,
  Trash2,
  Layers,
  Upload
} from 'lucide-react';
import {
  StatusBadge,
  Modal,
  formatBaht
} from '../../components/GlobalComponents';
import { MaintenanceRequest as RepairRequest, Room, Tenant } from '../../types';
import { convertImageToWebP } from '../../utils/imageUtils';

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
  tenants: Tenant[];
  onSaveRepairs: (repairs: RepairRequest[]) => void;
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
}

export const OwnerMaintenance: React.FC<OwnerMaintenanceProps> = ({
  repairs,
  rooms,
  tenants,
  onSaveRepairs,
  onAddLog
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

  const handleCreateRepair = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;

    const newId = `rep-${Date.now()}`;
    const newRepair: RepairRequest = {
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
    setIsCreateOpen(false);
    onAddLog?.('สร้างบันทึกแจ้งซ่อมใหม่', `สร้างแจ้งเรื่อง "${title}" สำหรับห้อง ${roomId ? getRoomNum(roomId) : 'ส่วนกลาง'}`, 'RepairRequest', newId);

    // Reset Form
    setTitle('');
    setDescription('');
    setImageBefore('');
    setRoomId('');
    setPriority('medium');
    setIsRoomDropdownOpen(false);
  };
  
  const executeDeleteRepair = (repairId: string) => {
    const target = repairs.find(r => r.id === repairId);
    if (!target) return;

    // Delete completely from the array (since it's only called on completed status as per instructions)
    const updated = repairs.filter(r => r.id !== repairId);
    onAddLog?.('ลบรายการแจ้งซ่อม', `ลบรายการแจ้งซ่อม "${target.title}"`, 'RepairRequest', repairId);

    onSaveRepairs(updated);
    setSelectedRepair(null);
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

  const handleUpdateStatus = (repairId: string, nextStatus: 'submitted' | 'inprogress' | 'completed') => {
    const updated = repairs.map(r => {
      if (r.id === repairId) {
        return {
          ...r,
          status: nextStatus,
          assignedStaff: nextStatus === 'submitted' ? '' : (assignedStaff || r.assignedStaff),
          cost: nextStatus === 'submitted' ? 0 : (cost || r.cost),
          note: nextStatus === 'submitted' ? '' : (note || r.note),
          imageAfter: ownerImage || r.imageAfter,
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
    setSelectedRepair(null);
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
    <div className="space-y-6">
      
      {/* Filter Tabs & Quick Action Row */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs flex flex-col lg:flex-row justify-between items-center gap-4 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full lg:w-auto lg:min-w-[700px]">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
              activeTab === 'all'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Layers className="w-4 h-4 text-indigo-500" />
            <span className="truncate">ทั้งหมด ({repairs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
              activeTab === 'pending'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Clock className="w-4 h-4 animate-pulse text-indigo-500" />
            <span className="truncate">แจ้งซ่อม ({pendingRepairs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inprogress')}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
              activeTab === 'inprogress'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <Wrench className="w-4 h-4 text-indigo-500" />
            <span className="truncate">กำลังซ่อม ({inProgressRepairs.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('completed')}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
              activeTab === 'completed'
                ? 'bg-white text-indigo-600 shadow-2xs'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <span className="truncate">งานสำเร็จ ({completedRepairs.length})</span>
          </button>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer w-full md:w-auto justify-center"
        >
          <Plus className="w-4 h-4" />
          สร้างเรื่องแจ้งซ่อมฉุกเฉิน
        </button>
      </div>

      {/* Interactive Kanban Grid */}
      <div className="grid gap-6 h-[580px] grid-cols-1 md:grid-cols-3">
        
        {/* Column 1: Pending */}
        {(activeTab === 'all' || activeTab === 'pending') ? (
          <div
            onDragOver={(e) => handleDragOver(e, 'pending')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'pending')}
            className={`rounded-3xl p-4 flex flex-col h-full shadow-3xs transition-all duration-200 border ${
              isDraggingOverCol === 'pending'
                ? 'bg-indigo-50/40 border-indigo-400 scale-[1.01] ring-2 ring-indigo-100'
                : 'bg-slate-50 border-slate-100'
            }`}
          >
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h4 className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-600 animate-pulse" />
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
                    onClick={() => {
                      setSelectedRepair(rep);
                      setAssignedStaff(rep.assignedStaff || '');
                      setCost(rep.cost || 0);
                      setNote(rep.note || '');
                    }}
                    className={cardStyle.className}
                  >
                    <div className="flex justify-between items-start pointer-events-none">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md ${
                        rep.priority === 'high' ? 'bg-rose-50 text-rose-700 border border-rose-100' :
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
        ) : (
          <div className="hidden md:block" />
        )}
 
        {/* Column 2: In Progress */}
        {(activeTab === 'all' || activeTab === 'inprogress') ? (
          <div
            onDragOver={(e) => handleDragOver(e, 'inprogress')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'inprogress')}
            className={`rounded-3xl p-4 flex flex-col h-full shadow-3xs transition-all duration-200 border ${
              isDraggingOverCol === 'inprogress'
                ? 'bg-indigo-100/50 border-indigo-500 scale-[1.01] ring-2 ring-indigo-200'
                : 'bg-indigo-50/20 border-indigo-100/50'
            }`}
          >
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h4 className="text-xs font-extrabold text-indigo-900 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-indigo-600" />
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
                    onClick={() => {
                      setSelectedRepair(rep);
                      setAssignedStaff(rep.assignedStaff || '');
                      setCost(rep.cost || 0);
                      setNote(rep.note || '');
                    }}
                    className={cardStyle.className}
                  >
                    <div className="flex justify-between items-start pointer-events-none">
                      <span className="text-[10px] text-indigo-700 font-bold">ช่าง: {rep.assignedStaff || 'รอมอบหมาย'}</span>
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
        ) : (
          <div className="hidden md:block" />
        )}

        {/* Column 3: Completed */}
        {(activeTab === 'all' || activeTab === 'completed') ? (
          <div
            onDragOver={(e) => handleDragOver(e, 'completed')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'completed')}
            className={`rounded-3xl p-4 flex flex-col h-full shadow-3xs transition-all duration-200 border ${
              isDraggingOverCol === 'completed'
                ? 'bg-emerald-100/30 border-emerald-500 scale-[1.01] ring-2 ring-emerald-200'
                : 'bg-emerald-50/10 border-emerald-100/30'
            }`}
          >
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h4 className="text-xs font-extrabold text-emerald-800 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600 animate-pulse" />
                งานสำเร็จ ({completedRepairs.length})
              </h4>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 p-1.5">
              {completedRepairs.map(rep => (
                <div
                  key={rep.id}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, rep.id)}
                  onClick={() => {
                    setSelectedRepair(rep);
                    setAssignedStaff(rep.assignedStaff || '');
                    setCost(rep.cost || 0);
                    setNote(rep.note || '');
                  }}
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
        ) : (
          <div className="hidden md:block" />
        )}

      </div>

      {/* Direct Add Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => { setIsCreateOpen(false); setIsRoomDropdownOpen(false); }} title="บันทึกรายการซ่อมบำรุง">
        <form onSubmit={handleCreateRepair} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">เรื่องที่แจ้งซ่อมแซม *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น ท่อน้ำห้องน้ำชั้น 2 ซึมรั่วซึม"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-semibold"
            />
          </div>

          <div className="space-y-1 relative font-sans">
            <label className="block font-bold text-slate-700">ห้องพักที่เกิดเหตุ</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsRoomDropdownOpen(!isRoomDropdownOpen)}
                className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl bg-white text-slate-700 font-semibold text-xs text-left outline-none focus:border-indigo-500 cursor-pointer flex items-center justify-between shadow-2xs"
              >
                <span>{roomId ? `ห้อง ${getRoomNum(roomId)}` : 'ส่วนกลาง'}</span>
                <span className="text-gray-400">▼</span>
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
                      {Array.from(new Set(rooms.map(r => r.buildingId).filter((id): id is string => !!id))).map((bldId: string) => {
                        const bldName = bldId === 'bld-a' ? 'อาคาร A (วิวเขา)' : bldId === 'bld-b' ? 'อาคาร B' : `อาคาร ${bldId.replace('bld-', '').toUpperCase()}`;
                        const bldRooms = rooms.filter(r => r.buildingId === bldId);
                        const floors = Array.from(new Set(bldRooms.map(r => r.derivedFloor))).sort((a, b) => (b === null ? -1 : a === null ? 1 : Number(a) - Number(b)));

                        return (
                          <div key={bldId} className="space-y-1.5 border-b border-slate-200 pb-2.5 last:border-0 last:pb-0">
                            <span className="text-[10px] font-black text-indigo-600 block">{bldName}</span>

                            {floors.map(fl => {
                              const floorRooms = bldRooms.filter(r => r.derivedFloor === fl).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
                              return (
                                <div key={fl} className="flex items-start gap-2">
                                  <span className="text-[9px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                                    {fl ? `ชั้น ${fl}` : <span className="text-red-500">Error</span>}
                                  </span>
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
                                          className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                            isSelected 
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

          <div className="space-y-1">
            <label className="block font-bold text-slate-700">คำอธิบายอาการชำรุดอย่างละเอียด *</label>
            <textarea
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="กรุณาระบุลักษณะอาการ ความกว้างเสียหาย หรือจุดสังเกตเพื่อช่วยช่างเตรียมอุปกรณ์..."
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 h-24 resize-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block font-bold text-slate-700">แนบรูปภาพจุดที่ชำรุด (ไม่บังคับ)</label>
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-2xl p-3 transition-all relative min-h-[120px]">
              {imageBefore ? (
                <div className="relative overflow-hidden w-full max-h-52 flex items-center justify-center rounded-xl z-30">
                  <img src={imageBefore} alt="รูปจุดชำรุด" className="w-full max-h-48 object-contain rounded-xl" />
                  <button
                    type="button"
                    onClick={() => setImageBefore('')}
                    className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 z-40"
                  >
                    ล้างรูปภาพ
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-1.5 text-gray-400 py-3 relative z-10 pointer-events-none">
                  <Upload className="w-8 h-8 text-indigo-400 mx-auto" />
                  <p className="text-xs font-bold text-slate-700">ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด</p>
                  <p className="text-[10px] text-gray-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</p>
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

          <div className="pt-4 border-t border-gray-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setIsCreateOpen(false); setIsRoomDropdownOpen(false); }}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs"
            >
              สร้างประวัติเรื่องแจ้งซ่อม
            </button>
          </div>
        </form>
      </Modal>

      {/* Repair Detail and Status Upgrader Modal */}
      <Modal isOpen={!!selectedRepair} onClose={() => { setSelectedRepair(null); }} title="สถานะงานซ่อม">
        {selectedRepair && (
          <div className="space-y-5 text-xs text-slate-800">
            <div className="flex justify-between items-start border-b border-slate-200 pb-3">
              <div>
                <h4 className="font-extrabold text-sm text-slate-900 leading-tight">{selectedRepair.title}</h4>
                <div className="flex items-center gap-2 mt-1.5 font-sans">
                  <span className="inline-flex items-center justify-center px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-600 font-extrabold rounded-lg text-[10px] select-none cursor-default leading-none">
                    {getRoomNum(selectedRepair.roomId || '')}
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold">
                    วันที่แจ้ง: {formatThaiShortDate(selectedRepair.createdAt)}
                  </span>
                </div>
              </div>
              <StatusBadge status={selectedRepair.status} type="maintenance" />
            </div>

            <div className="space-y-2">
              <p className="font-bold text-slate-700">รายละเอียดแจ้ง:</p>
              <div className="p-3 bg-slate-50 border border-gray-100 rounded-xl text-[11px] text-slate-600 whitespace-pre-wrap leading-relaxed">
                {selectedRepair.description}
              </div>
            </div>

            {selectedRepair.imageBefore && (
              <div className="space-y-2">
                <p className="font-bold text-slate-700">รูปภาพที่ผู้เช่าแนบมา:</p>
                <div className="relative group max-w-[280px]">
                  <img
                    src={selectedRepair.imageBefore}
                    alt="หลักฐานปัญหาการซ่อม"
                    onClick={() => setZoomedImg(selectedRepair.imageBefore || null)}
                    className="rounded-2xl border border-slate-200 object-cover max-h-48 w-full cursor-zoom-in hover:opacity-95 transition-all shadow-2xs"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute bottom-2 right-2 px-2.5 py-1 bg-black/60 rounded-lg text-[9px] text-white font-bold backdrop-blur-2xs pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity">
                    คลิกเพื่อขยายรูปภาพ 🔍
                  </div>
                </div>
              </div>
            )}

            {/* Input Form for transitions */}
            {selectedRepair.status !== 'completed' && selectedRepair.status !== 'cancelled' && (
              <div className="space-y-3 p-4 border border-indigo-100 rounded-2xl bg-indigo-50/10">
                <h5 className="font-bold text-indigo-950">ฟอร์มบันทึกความคืบหน้างานซ่อม:</h5>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-gray-400">ช่างผู้รับผิดชอบงาน</label>
                    <input
                      type="text"
                      value={assignedStaff}
                      onChange={(e) => setAssignedStaff(e.target.value)}
                      placeholder="เช่น นายช่างสมยศ"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-xs font-semibold"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-gray-400">ค่าอะไหล่วัสดุรวม (บาท)</label>
                    <input
                      type="number"
                      value={cost || ''}
                      onChange={(e) => setCost(Number(e.target.value))}
                      placeholder="0.00"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-xs font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="block text-[10px] font-bold text-gray-400">บันทึกช่วยจำช่างเสริม</label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="รายละเอียดอะไหล่ที่เปลี่ยน หรือสาเหตุปัญหา..."
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold text-gray-400">แนบรูปภาพผลการซ่อม / ใบเสร็จ / อะไหล่ (ฝั่งเจ้าของ/ช่าง)</label>
                  {ownerImage ? (
                    <div className="relative overflow-hidden w-full max-h-56 flex items-center justify-center p-1 group">
                      <img src={ownerImage} alt="รูปผลงานซ่อม" className="w-full max-h-52 object-contain rounded-xl" />
                      <button
                        type="button"
                        onClick={() => setOwnerImage('')}
                        className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 z-40"
                      >
                        ล้างรูปภาพ
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-2xl p-5 hover:bg-indigo-50/10 transition-all">
                      <div className="text-center space-y-1 text-gray-400 py-2 pointer-events-none">
                        <Upload className="w-6 h-6 text-indigo-400 mx-auto" />
                        <p className="text-[11px] font-bold text-slate-700">ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด</p>
                        <p className="text-[9px] text-gray-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</p>
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
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl space-y-3">
                <p><span className="text-gray-400">ช่างที่ดำเนินการ:</span> <span className="font-bold text-slate-800">{selectedRepair.assignedStaff || 'ไม่ระบุ'}</span></p>
                <p><span className="text-gray-400">ค่าใช้จ่ายสุทธิ:</span> <span className="font-bold text-emerald-600">{formatBaht(selectedRepair.cost || 0)}</span></p>
                {selectedRepair.note && <p><span className="text-gray-400">หมายเหตุช่าง:</span> <span className="text-slate-600 font-medium">{selectedRepair.note}</span></p>}
                {(selectedRepair.imageAfter || ownerImage) && (
                  <div className="space-y-1 pt-1 border-t border-slate-200">
                    <p className="font-bold text-slate-700 text-[11px]">รูปภาพหลักฐานผลการซ่อม (แนบโดยเจ้าของ/ช่าง):</p>
                    <img
                      src={selectedRepair.imageAfter || ownerImage}
                      alt="รูปผลงานซ่อมเสร็จ"
                      onClick={() => setZoomedImg(selectedRepair.imageAfter || ownerImage)}
                      className="rounded-xl border border-slate-200 object-cover max-h-36 w-auto cursor-zoom-in hover:opacity-95 transition-all shadow-2xs"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Actions for current status */}
            <div className="pt-4 border-t border-slate-200 flex flex-row gap-3 justify-between items-center shrink-0 font-sans w-full">
              {selectedRepair.status === 'completed' ? (
                <button
                  type="button"
                  onClick={() => executeDeleteRepair(selectedRepair.id)}
                  className="px-4 py-2.5 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  ลบ
                </button>
              ) : (
                <div />
              )}

              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => setSelectedRepair(null)}
                  className="px-4 py-2.5 border border-gray-200 bg-gray-50 text-gray-500 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  ปิดหน้าต่าง
                </button>
                
                {isPending(selectedRepair.status) && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(selectedRepair.id, 'inprogress')}
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    เริ่มดำเนินการ
                  </button>
                )}

                {isInProgress(selectedRepair.status) && (
                  <button
                    type="button"
                    onClick={() => handleUpdateStatus(selectedRepair.id, 'completed')}
                    className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs cursor-pointer"
                  >
                    ซ่อมแซมเสร็จสิ้น
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
      
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
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading 
              ? 'opacity-0 translate-y-3 pointer-events-none' 
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          <CheckCircle className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

    </div>
  );
};
