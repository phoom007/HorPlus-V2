/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  TrendingUp,
  Save,
  AlertTriangle,
  RotateCw,
  Search,
  CheckCircle,
  Sparkles,
  User,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Plus,
  X,
  Zap,
  RefreshCw,
  Loader2,
  Send,
  Calendar,
  Users,
  CheckCircle2,
  FileText
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys, STALE_TIMES } from '../../lib/queryClient';
import { meterDraftStore } from '../../lib/meterDraftStore';
import { calculateMeterRowPreview, RoomPreviewContext } from '../../utils/meterBillingCalculator';
import { Room, Building, QuickAddRoomContext, Bill, BillItem, Tenant, Contract, BillStatus, calculateRoomRentForCycle } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
import { httpRequest } from '../../data/httpClient';
import { formatBaht, Modal } from '../../components/GlobalComponents';

import { LineNotificationModal } from '../../components/LineNotificationModal';
import { QuickAddTenantModal } from '../../components/QuickAddTenantModal';
import {
  serializeMeterWorkspaceDirtyRow,
  serializeMeterWorkspaceDirtyRows,
} from '../../utils/meter-serializer';

export function getStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function setStored<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

export function getDormitoryRatesForCycle(dorm?: any, cycle?: string) {
  if (dorm && dorm.cycleSettings && cycle && dorm.cycleSettings[cycle]) {
    return dorm.cycleSettings[cycle];
  }
  return {
    waterUnitRate: 0,
    electricUnitRate: 0,
    waterBillingMode: 'unit',
    electricBillingMode: 'unit',
    commonFee: 0,
    commonFeeMode: 'room',
    internetFee: 0,
    internetFeeMode: 'room',
    parkingFee: 0,
    parkingFeeMode: 'room',
    lateFeeDaily: 0,
    lateFeeType: 'per_day'
  };
}

export function getDormitory() {
  return {};
}


interface OwnerMetersProps {
  rooms: Room[];
  buildings?: Building[];
  dormitoryId?: string;
  bills: Bill[];
  tenants: Tenant[];
  contracts: Contract[];
  onSaveBills: (bills: Bill[]) => void;
  onSelectTenant: (tenantId: string) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onNavigate?: (tab: string) => void;
  selectedBillingCycleId: string;
  selectedCycleCode: string;
  selectedCycle?: string;
  onRefetchData?: () => void;
}

export interface MeterRowState {
  roomId: string;
  roomNumber: string;
  waterPrev: number;
  waterCurr: number;
  elecPrev: number;
  elecCurr: number;
  isReplaced: boolean;
  peopleCount: number;
  overdueAmount: number;
  isPaid: boolean;
  billStatus: BillStatus;
  editWaterPrev?: boolean;
  editElecPrev?: boolean;
  otherFees?: { description: string; amount: number }[];
  snapshotVersion?: number;
}

// Module-level temporary memory cache to survive tab navigation without page reload
export let tempMeterRowsCache: { [cycle: string]: MeterRowState[] } = {};

export const OwnerMeters: React.FC<OwnerMetersProps> = ({
  rooms,
  buildings = [],
  dormitoryId = '',
  bills,
  tenants,
  contracts,
  onSaveBills,
  onSelectTenant,
  onAddLog,
  onNavigate,
  selectedBillingCycleId,
  selectedCycleCode,
  selectedCycle = selectedCycleCode,
  onRefetchData
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [meterRows, setMeterRows] = useState<MeterRowState[]>([]);
  const [loadedCycle, setLoadedCycle] = useState<string>('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  useEffect(() => {
    if (saveSuccess || toastMessage) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setSaveSuccess(false);
        setToastMessage(null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [saveSuccess, toastMessage]);
  const [isQuickFillOpen, setIsQuickFillOpen] = useState(false);
  const [quickFillText, setQuickFillText] = useState('');
  const [templateUsed, setTemplateUsed] = useState(false);
  const [isFirstCycle, setIsFirstCycle] = useState(false);
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [selectedQuickAddContext, setSelectedQuickAddContext] = useState<QuickAddRoomContext | null>(null);
  const [quickAddLoadingRoomId, setQuickAddLoadingRoomId] = useState<string | null>(null);
  const [operationalCycleAuthorityLoaded, setOperationalCycleAuthorityLoaded] = useState(false);
  const [operationalCycleCode, setOperationalCycleCode] = useState<string | null>(null);
  const [allowEditAllElecPrev, setAllowEditAllElecPrev] = useState(false);
  const [allowEditAllWaterPrev, setAllowEditAllWaterPrev] = useState(false);
  const [flashingCells, setFlashingCells] = useState<{ [key: string]: boolean }>({});
  const [issuedRoomsFromHeader, setIssuedRoomsFromHeader] = useState<string[]>([]);
  const [wasIssueAllPressed, setWasIssueAllPressed] = useState(false);
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [selectedTenantIdsForLine, setSelectedTenantIdsForLine] = useState<string[]>([]);
  const [lineToastSuccess, setLineToastSuccess] = useState<string | null>(null);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const originalRowsRef = React.useRef<MeterRowState[]>([]);
  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const quickFillInputRef = React.useRef<HTMLTextAreaElement>(null);
  const dorm = getDormitory();
  const cycleRates = getDormitoryRatesForCycle(dorm, selectedCycle);

  const isCurrentOperationalCycle = Boolean(
    operationalCycleAuthorityLoaded &&
    operationalCycleCode &&
    (selectedCycle === operationalCycleCode || selectedCycleCode === operationalCycleCode)
  );
  const isWaterUnit = (cycleRates.waterBillingMode || 'unit') === 'unit';
  const isElecUnit = (cycleRates.electricBillingMode || 'unit') === 'unit';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const queryClient = useQueryClient();
  const currentDormId = dormitoryId || localStorage.getItem('horplus_current_dormitory_id') || localStorage.getItem('selected_dormitory_id') || '';

  // Server Preview Context Query (Bounded Aggregate Read)
  const previewContextQuery = useQuery({
    queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId),
    queryFn: async () => {
      if (!selectedBillingCycleId || !currentDormId) return null;
      const res = await httpRequest<{ success: boolean; data: any }>(
        'GET',
        `/api/v1/meters/workspace/preview-context?billingCycleId=${selectedBillingCycleId}`,
        undefined,
        { headers: { 'x-dormitory-id': currentDormId } }
      );
      return res.data;
    },
    enabled: !!selectedBillingCycleId && !!currentDormId,
    staleTime: STALE_TIMES.PREVIEW_CONTEXT,
  });

  const previewContext = previewContextQuery.data;

  const handleAddOtherFee = async (roomId: string, desc: string, amtStr: string) => {
    const cleanDesc = desc.trim();
    if (!cleanDesc) return;
    if (!/^\d+(\.\d{1,2})?$/.test(amtStr) || Number(amtStr) <= 0) {
      showToast('กรุณาระบุจำนวนเงินเป็นตัวเลขที่ถูกต้อง');
      return;
    }
    const amt = Number(amtStr);
    const targetRow = meterRows.find(r => r.roomId === roomId);
    if (!targetRow) return;

    const prevFees = targetRow.otherFees || [];
    const nextFees = [...prevFees, { description: cleanDesc, amount: amt }];
    const expectedVersion = targetRow.snapshotVersion ?? 0;

    // Optimistic update
    setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r));

    try {
      await httpRequest('POST', '/api/v1/meters/workspace/bulk', {
        billingCycleId: selectedBillingCycleId,
        rows: [{
          roomId,
          otherFees: nextFees.map(f => ({ description: f.description, amount: f.amount.toFixed(2) })),
          expectedVersion,
        }],
      }, { headers: currentDormId ? { 'x-dormitory-id': currentDormId } : {} });

      queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
    } catch (err: any) {
      // Rollback
      setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: prevFees } : r));
      const isStale = err?.status === 409 || err?.domainError?.code === 'STALE_VERSION' || err?.message?.includes('STALE_VERSION') || err?.message?.includes('เปลี่ยนแปลงโดยผู้ใช้อื่น');
      if (isStale) {
        showToast('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น ระบบกำลังโหลดข้อมูลล่าสุด');
        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
      } else {
        showToast(err.message || 'ไม่สามารถบันทึกค่าใช้จ่ายเพิ่มเติมได้');
      }
    }
  };

  const handleRemoveOtherFee = async (roomId: string, feeIdx: number) => {
    const targetRow = meterRows.find(r => r.roomId === roomId);
    if (!targetRow) return;

    const prevFees = targetRow.otherFees || [];
    const nextFees = prevFees.filter((_, idx) => idx !== feeIdx);
    const expectedVersion = targetRow.snapshotVersion ?? 0;

    // Optimistic update
    setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: nextFees } : r));

    try {
      await httpRequest('POST', '/api/v1/meters/workspace/bulk', {
        billingCycleId: selectedBillingCycleId,
        rows: [{
          roomId,
          otherFees: nextFees.map(f => ({ description: f.description, amount: f.amount.toFixed(2) })),
          expectedVersion,
        }],
      }, { headers: currentDormId ? { 'x-dormitory-id': currentDormId } : {} });

      queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
    } catch (err: any) {
      // Rollback
      setMeterRows(prev => prev.map(r => r.roomId === roomId ? { ...r, otherFees: prevFees } : r));
      const isStale = err?.status === 409 || err?.domainError?.code === 'STALE_VERSION' || err?.message?.includes('STALE_VERSION') || err?.message?.includes('เปลี่ยนแปลงโดยผู้ใช้อื่น');
      if (isStale) {
        showToast('ข้อมูลมิเตอร์ของห้องนี้ถูกเปลี่ยนแปลงโดยผู้ใช้อื่น ระบบกำลังโหลดข้อมูลล่าสุด');
        queryClient.invalidateQueries({ queryKey: queryKeys.meterWorkspace(currentDormId, selectedBillingCycleId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.meterPreviewContext(currentDormId, selectedBillingCycleId) });
      } else {
        showToast(err.message || 'ไม่สามารถลบค่าใช้จ่ายเพิ่มเติมได้');
      }
    }
  };

  const getCycleNewReadings = (roomId: string, cycleId: string): { waterCurr: number, elecCurr: number } => {
    const roomObj = rooms.find(r => r.id === roomId);
    const initialWater = roomObj ? (Number(roomObj.initialWaterMeter ?? (roomObj as any).initialWaterReading) || 0) : 0;
    const initialElec = roomObj ? (Number(roomObj.initialElectricMeter ?? (roomObj as any).initialElectricityReading) || 0) : 0;

    if (cycleId < '2026-01') {
      return { waterCurr: initialWater, elecCurr: initialElec };
    }

    // Check if there is an existing bill for this cycle
    const compactCycle = cycleId.replace('-', '');
    const bill = bills.find(b => {
      const matchRoom = b.roomId === roomId || (b as any).roomNumber === roomId;
      if (!matchRoom) return false;
      return Boolean(
        b.cycleId === cycleId ||
        (b as any).billingCycleId === cycleId ||
        (b as any).cycleCode === cycleId ||
        (b.billNumber && (b.billNumber.includes(cycleId) || b.billNumber.includes(compactCycle))) ||
        (b.billingDate && String(b.billingDate).startsWith(cycleId))
      );
    });
    
    // Get previous cycle's new readings
    const [cy, cm] = cycleId.split('-').map(Number);
    let prevYear = cy;
    let prevMonth = cm - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const prevCycleId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const prevData = getCycleNewReadings(roomId, prevCycleId);
    const waterPrev = prevData.waterCurr;
    const elecPrev = prevData.elecCurr;

    // Calculate this cycle's new readings from previous readings (no manufactured readings)
    let waterCurr = waterPrev;
    let elecCurr = elecPrev;

    if (bill && Array.isArray(bill.items)) {
      const billRates = getDormitoryRatesForCycle(dorm, cycleId);
      const waterItem = bill.items.find(item => item.category === 'water' || (item as any).type === 'water');
      if (waterItem) {
        const match = waterItem.description?.match(/\((\d+)\s*หน่วย\)/);
        if (match) {
          waterCurr = waterPrev + Number(match[1]);
        } else {
          const mode = billRates.waterBillingMode || 'unit';
          if (mode === 'unit') {
            const rate = billRates.waterUnitRate || 0;
            waterCurr = rate > 0 ? waterPrev + Math.round(Number(waterItem.amount) / rate) : waterPrev;
          } else {
            waterCurr = waterPrev;
          }
        }
      }

      const elecItem = bill.items.find(item => item.category === 'electricity' || (item as any).type === 'electricity');
      if (elecItem) {
        const match = elecItem.description?.match(/\((\d+)\s*หน่วย\)/);
        if (match) {
          elecCurr = elecPrev + Number(match[1]);
        } else {
          const mode = billRates.electricBillingMode || 'unit';
          if (mode === 'unit') {
            const rate = billRates.electricUnitRate || 0;
            elecCurr = rate > 0 ? elecPrev + Math.round(Number(elecItem.amount) / rate) : elecPrev;
          } else {
            elecCurr = elecPrev;
          }
        }
      }
    }

    return { waterCurr: Math.round(waterCurr), elecCurr: Math.round(elecCurr) };
  };

  const getTenantForRoomAndCycle = (roomId: string, cycle: string) => {
    // Find contract active during this cycle for this room
    const activeContract = (contracts || []).find(c => {
      if (c.roomId !== roomId) return false;
      const [cy, cm] = cycle.split('-').map(Number);
      const startValStr = typeof c.startDate === 'string' ? c.startDate : new Date(c.startDate).toISOString().slice(0, 10);
      const endValStr = typeof c.endDate === 'string' ? c.endDate : new Date(c.endDate).toISOString().slice(0, 10);
      const [sy, sm] = startValStr.split('-').map(Number);
      const [ey, em] = endValStr.split('-').map(Number);
      const cycleVal = cy * 12 + (cm - 1);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);
      return cycleVal >= startVal && cycleVal <= endVal;
    });

    const tenantId = activeContract ? activeContract.tenantId : rooms.find(r => r.id === roomId)?.currentTenantId;
    return tenants.find(t => t.id === tenantId);
  };

  const isCycleLoaded = Boolean(loadedCycle && (loadedCycle === selectedCycle || loadedCycle === selectedBillingCycleId || loadedCycle === selectedCycleCode));

  const showPullButton = !isFirstCycle && isCycleLoaded;

  const handlePullPreviousData = async () => {
    if (!selectedBillingCycleId) {
      showToast('ยังไม่ได้ตั้งค่ารอบคำนวณ');
      return;
    }

    setIsSaving(true);
    try {
      const pullRes = await getDataProvider().meters.pullPreviousWorkspace?.(selectedBillingCycleId);
      setIsSaving(false);

      if (!pullRes || !pullRes.success || !pullRes.data) {
        showToast(pullRes?.error?.message || 'ไม่สามารถดึงข้อมูลจากงวดก่อนหน้าได้');
        return;
      }

      const pullData = pullRes.data;
      const roomMap = new Map((pullData.rooms || []).map((r: any) => [r.roomId, r]));

      const newFlashing: { [key: string]: boolean } = {};
      const peopleChanges: Array<{ roomNumber: string; prev: number; curr: number }> = [];

      const updatedRows = meterRows.map((row) => {
        const pRoom: any = roomMap.get(row.roomId);
        const nextRow = { ...row };

        if (pRoom) {
          if (isWaterUnit && pRoom.previousWaterCurrentReading !== null && pRoom.previousWaterCurrentReading !== undefined) {
            const nextWaterPrev = Number(pRoom.previousWaterCurrentReading);
            if (row.waterPrev !== nextWaterPrev) {
              nextRow.waterPrev = nextWaterPrev;
              newFlashing[`${row.roomId}-waterPrev`] = true;
            }
          }

          if (isElecUnit && pRoom.previousElectricityCurrentReading !== null && pRoom.previousElectricityCurrentReading !== undefined) {
            const nextElecPrev = Number(pRoom.previousElectricityCurrentReading);
            if (row.elecPrev !== nextElecPrev) {
              nextRow.elecPrev = nextElecPrev;
              newFlashing[`${row.roomId}-elecPrev`] = true;
            }
          }

          const currHousehold = pRoom.currentHouseholdPeopleCount ?? 0;
          if (row.peopleCount !== currHousehold) {
            nextRow.peopleCount = currHousehold;
            newFlashing[`${row.roomId}-peopleCount`] = true;
          }

          // Compare previousCyclePeopleCount vs currentHouseholdPeopleCount for toast (Section 5)
          if (pRoom.previousCyclePeopleCount !== null && pRoom.previousCyclePeopleCount !== undefined) {
            if (pRoom.previousCyclePeopleCount !== currHousehold) {
              peopleChanges.push({
                roomNumber: row.roomNumber,
                prev: pRoom.previousCyclePeopleCount,
                curr: currHousehold,
              });
            }
          }
        }

        return nextRow;
      });

      setMeterRows(updatedRows);

      if (Object.keys(newFlashing).length > 0) {
        setFlashingCells((prev) => ({ ...prev, ...newFlashing }));
        setTimeout(() => {
          setFlashingCells((prev) => {
            const next = { ...prev };
            Object.keys(newFlashing).forEach((k) => {
              delete next[k];
            });
            return next;
          });
        }, 1500);
      }

      // Concise toast notification comparing previous cycle vs current household (Section 5)
      if (peopleChanges.length === 0) {
        showToast('ดึงข้อมูลก่อนหน้าเรียบร้อย');
      } else if (peopleChanges.length === 1) {
        const c = peopleChanges[0];
        showToast(`${c.roomNumber}: ผู้พัก ${c.prev} → ${c.curr} คน`);
      } else {
        showToast(`ดึงข้อมูลแล้ว • ผู้พักเปลี่ยน ${peopleChanges.length} ห้อง (ใช้จำนวนปัจจุบัน)`);
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(err.message || 'เกิดข้อผิดพลาดในการดึงข้อมูลก่อนหน้า');
    }
  };

  const getTemplateFormatString = () => {
    const sampleRoom = meterRows[0]?.roomNumber || "A101";
    const sampleElec = meterRows[0]?.elecPrev || 500;
    const sampleWater = meterRows[0]?.waterPrev || 500;
    const samplePeople = meterRows[0]?.peopleCount ?? 0;
    const sampleOverdue = meterRows[0]?.overdueAmount || 50;

    if (isElecUnit && isWaterUnit) {
      return `${sampleRoom} : ไฟ ${sampleElec} : น้ำ ${sampleWater} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else if (isElecUnit && !isWaterUnit) {
      return `${sampleRoom} : ไฟ ${sampleElec} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else if (!isElecUnit && isWaterUnit) {
      return `${sampleRoom} : น้ำ ${sampleWater} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    } else {
      return `${sampleRoom} : ${samplePeople} คน : ค้าง ${sampleOverdue}`;
    }
  };

  const generateTemplateText = () => {
    const sortedRows = [...meterRows].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' }));
    
    return sortedRows.map(row => {
      const parts = [row.roomNumber];
      if (isElecUnit) {
        parts.push(`ไฟ ${row.elecPrev}`);
      }
      if (isWaterUnit) {
        parts.push(`น้ำ ${row.waterPrev}`);
      }
      const roomCtx = previewContext?.rooms?.find(r => r.roomId === row.roomId);
      const householdCount = roomCtx?.currentHouseholdPeopleCount !== undefined ? roomCtx.currentHouseholdPeopleCount : row.peopleCount;
      parts.push(`${householdCount} คน`);
      if (row.overdueAmount > 0) {
        parts.push(`ค้าง ${row.overdueAmount}`);
      } else {
        parts.push(`ค้าง `);
      }
      return parts.join(' : ');
    }).join('\n');
  };

  const parseQuickFillText = (text: string) => {
    const lines = text.split('\n');
    
    const matchedCount = meterRows.filter(row => {
      return lines.some(line => {
        const firstPart = line.split(':')[0]?.trim();
        return firstPart && row?.roomNumber && firstPart.toLowerCase() === row.roomNumber.toLowerCase();
      });
    }).length;

    const newFlashing: { [key: string]: boolean } = {};

    const updatedRows = meterRows.map(row => {
      const matchedLine = lines.find(line => {
        const firstPart = line.split(':')[0]?.trim();
        return firstPart && row?.roomNumber && firstPart.toLowerCase() === row.roomNumber.toLowerCase();
      });

      if (!matchedLine) return row;

      const parts = matchedLine.split(':').map(p => p.trim());
      
      let waterCurr = row.waterCurr;
      let elecCurr = row.elecCurr;
      let peopleCount = row.peopleCount;
      let overdueAmount = row.overdueAmount;

      parts.forEach(part => {
        if (part.includes('ไฟ')) {
          const match = part.match(/\d+/);
          if (match) elecCurr = Number(match[0]);
        }
        if (part.includes('น้ำ')) {
          const match = part.match(/\d+/);
          if (match) waterCurr = Number(match[0]);
        }
        if (part.includes('คน')) {
          const match = part.match(/\d+/);
          if (match) peopleCount = Number(match[0]);
        }
        if (part.includes('ค้าง') || part.includes('ค้างชำระ')) {
          const match = part.match(/\d+/);
          if (match) overdueAmount = Number(match[0]);
        }
      });

      if (waterCurr !== row.waterCurr) newFlashing[`${row.roomId}-waterCurr`] = true;
      if (elecCurr !== row.elecCurr) newFlashing[`${row.roomId}-elecCurr`] = true;
      if (peopleCount !== row.peopleCount) newFlashing[`${row.roomId}-peopleCount`] = true;
      if (overdueAmount !== row.overdueAmount) newFlashing[`${row.roomId}-overdueAmount`] = true;

      return {
        ...row,
        waterCurr,
        elecCurr,
        peopleCount,
        overdueAmount
      };
    });

    setMeterRows(updatedRows);

    if (Object.keys(newFlashing).length > 0) {
      setFlashingCells(prev => ({ ...prev, ...newFlashing }));
      setTimeout(() => {
        setFlashingCells(prev => {
          const next = { ...prev };
          Object.keys(newFlashing).forEach(k => {
            delete next[k];
          });
          return next;
        });
      }, 1500);
    }

    return matchedCount;
  };

  // DEVELOPER NOTE / บันทึกผู้พัฒนา:
  // สำหรับระบบ SaaS ในอนาคต หากหอพักตั้งค่ารูปแบบค่าน้ำประปา หรือค่าไฟฟ้า เป็น "ไม่ใช่ บาท/หน่วย" 
  // (เช่น เป็นรูปแบบ 'person' หรือ 'room' ซึ่งเป็นระบบเหมาจ่ายรายคนหรือรายห้อง)
  // ระบบจะไม่จำเป็นต้องใช้เลขอ่านมิเตอร์ ดังนั้นในตารางจะซ่อนช่องกรอกมิเตอร์เก่าและมิเตอร์ใหม่ไปโดยอัตโนมัติ
  // เพื่อความสะอาดของหน้าจอและความสอดคล้องตามการตั้งค่าบริการจริงของแต่ละหอพัก

  const scrollTable = (direction: 'left' | 'right') => {
    if (tableContainerRef.current) {
      const scrollAmount = 250;
      tableContainerRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const getWaterCost = (row: MeterRowState) => {
    const mode = cycleRates.waterBillingMode || 'unit';
    const rateVal = cycleRates.waterUnitRate;
    const rate = rateVal !== undefined && rateVal !== null && Number.isFinite(Number(rateVal)) ? Number(rateVal) : 0;
    const wCurr = Number(row.waterCurr) || 0;
    const wPrev = Number(row.waterPrev) || 0;
    const units = row.isReplaced ? wCurr : Math.max(0, wCurr - wPrev);
    
    if (mode === 'unit') {
      return units * rate;
    } else if (mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else { // 'room'
      return rate;
    }
  };

  const getElectricCost = (row: MeterRowState) => {
    const mode = cycleRates.electricBillingMode || 'unit';
    const rateVal = cycleRates.electricUnitRate;
    const rate = rateVal !== undefined && rateVal !== null && Number.isFinite(Number(rateVal)) ? Number(rateVal) : 0;
    const eCurr = Number(row.elecCurr) || 0;
    const ePrev = Number(row.elecPrev) || 0;
    const units = row.isReplaced ? eCurr : Math.max(0, eCurr - ePrev);
    
    if (mode === 'unit') {
      return units * rate;
    } else if (mode === 'person') {
      return (Number(row.peopleCount) || 0) * rate;
    } else { // 'room'
      return rate;
    }
  };

  const getCommonFeeCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = cycleRates.commonFeeMode || 'room';
    const fee = cycleRates.commonFee !== undefined ? cycleRates.commonFee : 0;
    
    if (mode === 'person') {
      return (row.peopleCount || 0) * fee;
    } else { // 'room'
      return fee;
    }
  };

  const getInternetCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = cycleRates.internetFeeMode || 'room';
    const fee = cycleRates.internetFee !== undefined ? cycleRates.internetFee : 0;
    if (fee <= 0) return 0;
    
    if (mode === 'person') {
      return (row.peopleCount || 0) * fee;
    } else { // 'room'
      return fee;
    }
  };

  const getParkingCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = cycleRates.parkingFeeMode || 'room';
    if (mode === 'free') return 0;
    const fee = cycleRates.parkingFee !== undefined ? cycleRates.parkingFee : 0;
    if (fee <= 0) return 0;

    if (mode === 'vehicle') {
      const tenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
      if (tenant && tenant.vehicle && tenant.vehicle.type && tenant.vehicle.type !== 'none') {
        return fee;
      }
      return 0;
    } else { // 'room'
      return fee;
    }
  };

  // Initialize meter rows based on rooms list, stored states, and bills
  useEffect(() => {
    try {
      const shouldScroll = localStorage.getItem('scroll_to_meter_status');
      if (shouldScroll === 'true') {
        localStorage.removeItem('scroll_to_meter_status');
        const doScroll = () => {
          // Keep page at very top
          window.scrollTo({ top: 0, behavior: 'smooth' });
          const mainContent = document.getElementById('owner-main-content') || document.querySelector('main');
          if (mainContent) {
            mainContent.scrollTop = 0;
          }

          const container = tableContainerRef.current;
          const statusHeader = document.getElementById('status-column-header');
          if (container) {
            if (statusHeader) {
              const containerWidth = container.clientWidth;
              const headerLeft = statusHeader.offsetLeft;
              const headerWidth = statusHeader.offsetWidth;
              const targetLeft = Math.max(0, headerLeft + (headerWidth / 2) - (containerWidth / 2));
              container.scrollTo({ left: targetLeft, behavior: 'smooth' });
            } else {
              const containerWidth = container.clientWidth;
              const scrollWidth = container.scrollWidth;
              const targetLeft = Math.max(0, scrollWidth - containerWidth);
              container.scrollTo({ left: targetLeft, behavior: 'smooth' });
            }
          }
        };
        doScroll();
        requestAnimationFrame(doScroll);
        setTimeout(doScroll, 50);
        setTimeout(doScroll, 150);
        setTimeout(doScroll, 350);
      }
    } catch (e) {
      console.error(e);
    }
  }, [selectedCycle]);

  const fetchAuthoritativeReadings = async (cycleId: string) => {
    if (!cycleId) return;
    try {
      const [serverReadings, cyclePeopleRes, cyclesRes] = await Promise.all([
        getDataProvider().meters.getByCycle(cycleId),
        getDataProvider().meters.getCyclePeopleCount(cycleId),
        httpRequest<{ data: any[]; firstBillingCycleId?: string }>('GET', '/billing-cycles').catch(() => null)
      ]);

      if (cyclesRes) {
        const isFirst = cyclesRes.firstBillingCycleId === cycleId ||
          cyclesRes.data?.find((c: any) => (c.id === cycleId || c.cycleCode === selectedCycleCode || c.cycleCode === selectedCycle))?.isFirstCycle;
        setIsFirstCycle(Boolean(isFirst));
        if ((cyclesRes as any).operationalCycleCode) {
          setOperationalCycleCode((cyclesRes as any).operationalCycleCode);
          setOperationalCycleAuthorityLoaded(true);
        } else if (cyclesRes.data && Array.isArray(cyclesRes.data)) {
          const op = cyclesRes.data.find((c: any) => c.status === 'draft' || c.status === 'open' || c.isCurrent);
          if (op?.cycleCode) {
            setOperationalCycleCode(op.cycleCode);
            setOperationalCycleAuthorityLoaded(true);
          } else {
            setOperationalCycleAuthorityLoaded(false);
          }
        } else {
          setOperationalCycleAuthorityLoaded(false);
        }
      } else {
        setOperationalCycleAuthorityLoaded(false);
        setOperationalCycleCode(null);
      }
      
      const readingsByRoom: { [roomId: string]: { waterPrev?: number; waterCurr?: number; elecPrev?: number; elecCurr?: number } } = {};
      (serverReadings || []).forEach((r: any) => {
        if (!readingsByRoom[r.roomId]) {
          readingsByRoom[r.roomId] = {};
        }
        if (r.meterType === 'water') {
          readingsByRoom[r.roomId].waterPrev = Number(r.previousReading ?? 0);
          readingsByRoom[r.roomId].waterCurr = Number(r.currentReading ?? 0);
        } else if (r.meterType === 'electricity') {
          readingsByRoom[r.roomId].elecPrev = Number(r.previousReading ?? 0);
          readingsByRoom[r.roomId].elecCurr = Number(r.currentReading ?? 0);
        }
      });

      const snapshots = (cyclePeopleRes && cyclePeopleRes.success && Array.isArray(cyclePeopleRes.data)) ? cyclePeopleRes.data : [];
      const snapshotMap: { [roomId: string]: { peopleCount?: number; manualOutstandingAmount?: number; otherFees?: any[]; version?: number } } = {};
      snapshots.forEach((s: any) => {
        if (s.roomId) {
          snapshotMap[s.roomId] = {
            peopleCount: s.peopleCount !== undefined ? Number(s.peopleCount) : undefined,
            manualOutstandingAmount: s.manualOutstandingAmount ? Number(s.manualOutstandingAmount) : 0,
            otherFees: Array.isArray(s.otherFees) ? s.otherFees.map((f: any) => ({ description: f.description, amount: Number(f.amount) })) : [],
            version: typeof s.version === 'number' ? s.version : 0,
          };
        }
      });

      const activeRooms = [...rooms].sort((a, b) => 
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
      );

      const rows: MeterRowState[] = activeRooms.map(r => {
        const roomReadings = readingsByRoom[r.id] || {};
        const cycleTenant = getTenantForRoomAndCycle(r.id, selectedCycleCode || selectedCycle);
        
        const rawWaterBaseline = Number(r.initialWaterMeter ?? (r as any).initialWaterReading) || 0;
        const rawElecBaseline = Number(r.initialElectricMeter ?? (r as any).initialElectricityReading) || 0;

        const waterPrev = roomReadings.waterPrev ?? rawWaterBaseline;
        const waterCurr = roomReadings.waterCurr ?? waterPrev;

        const elecPrev = roomReadings.elecPrev ?? rawElecBaseline;
        const elecCurr = roomReadings.elecCurr ?? elecPrev;

        const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 0;
        const snap = snapshotMap[r.id];
        const rowPeople = snap?.peopleCount !== undefined ? snap.peopleCount : tenantDefaultPeople;
        
        const existingBill = (bills || []).find(b => 
          (b.cycleId === cycleId || b.cycleId === selectedCycleCode || (b as any).billingCycleId === cycleId) && 
          (b.roomId === r.id || b.roomId === r.roomNumber) &&
          b.status !== 'cancelled' && b.status !== 'void'
        );
        const billStatus: BillStatus = existingBill ? existingBill.status : 'draft';
        const isPaid = billStatus === 'paid';

        return {
          roomId: r.id,
          roomNumber: r.roomNumber,
          waterPrev: Math.round(waterPrev),
          waterCurr: Math.round(waterCurr),
          elecPrev: Math.round(elecPrev),
          elecCurr: Math.round(elecCurr),
          isReplaced: false,
          peopleCount: rowPeople,
          overdueAmount: snap?.manualOutstandingAmount || 0,
          isPaid,
          billStatus,
          editWaterPrev: false,
          editElecPrev: false,
          otherFees: snap?.otherFees || [],
          snapshotVersion: snap?.version || 0,
        };
      });

      originalRowsRef.current = JSON.parse(JSON.stringify(rows));

      const localDraft = currentDormId && cycleId ? meterDraftStore.getDraft(currentDormId, cycleId) : null;
      if (localDraft) {
        const merged = rows.map(serverRow => {
          const draftRow = localDraft.find(d => d.roomId === serverRow.roomId);
          if (draftRow) {
            return {
              ...serverRow,
              waterCurr: draftRow.waterCurr,
              elecCurr: draftRow.elecCurr,
              peopleCount: draftRow.peopleCount,
              isReplaced: draftRow.isReplaced,
              otherFees: draftRow.otherFees,
              snapshotVersion: serverRow.snapshotVersion,
            };
          }
          return serverRow;
        });
        setMeterRows(merged);
      } else {
        setMeterRows(rows);
      }

      setLoadedCycle(cycleId);
    } catch (err) {
      console.error("Failed to load meter readings:", err);
    }
  };

  useEffect(() => {
    if (selectedBillingCycleId) {
      fetchAuthoritativeReadings(selectedBillingCycleId);
    } else {
      setMeterRows([]);
    }
  }, [selectedBillingCycleId, rooms, bills]);

  // Synchronize state changes to isolated in-memory draft store
  useEffect(() => {
    if (meterRows && meterRows.length > 0 && isCycleLoaded && currentDormId && selectedBillingCycleId) {
      meterDraftStore.setDraft(currentDormId, selectedBillingCycleId, meterRows);
    }
  }, [meterRows, selectedBillingCycleId, isCycleLoaded, currentDormId]);

  const handleNumberChange = (roomId: string, field: 'waterCurr' | 'elecCurr' | 'peopleCount' | 'overdueAmount' | 'waterPrev' | 'elecPrev', value: number) => {
    setMeterRows(prev => prev.map(row => {
      if (row.roomId === roomId) {
        return {
          ...row,
          [field]: value
        };
      }
      return row;
    }));
  };

  const getRowEditableFields = (row: MeterRowState) => {
    const fields: ('elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount' | 'overdueAmount')[] = [];
    if (isElecUnit) {
      if (isFirstCycle || row.editElecPrev || allowEditAllElecPrev) {
        fields.push('elecPrev');
      }
      fields.push('elecCurr');
    }
    if (isWaterUnit) {
      if (isFirstCycle || row.editWaterPrev || allowEditAllWaterPrev) {
        fields.push('waterPrev');
      }
      fields.push('waterCurr');
    }
    fields.push('peopleCount');
    fields.push('overdueAmount');
    return fields;
  };

  const handlePaste = (
    startRoomId: string,
    startField: 'elecPrev' | 'elecCurr' | 'waterPrev' | 'waterCurr' | 'peopleCount' | 'overdueAmount',
    e: React.ClipboardEvent<HTMLInputElement>
  ) => {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData.includes('\t') && !pasteData.includes('\n')) {
      return;
    }
    e.preventDefault();

    let lines = pasteData.split(/\r?\n/).map(line => line.split('\t'));
    if (lines.length > 1 && lines[lines.length - 1].length === 1 && lines[lines.length - 1][0] === '') {
      lines = lines.slice(0, -1);
    }
    if (lines.length === 1 && lines[0].length === 1 && lines[0][0] === '') {
      return;
    }

    const startRowIdx = filteredRows.findIndex(r => r.roomId === startRoomId);
    if (startRowIdx === -1) return;

    setMeterRows(prev => {
      const updated = [...prev];
      const newFlashing: { [key: string]: boolean } = {};

      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const targetFilteredRowIdx = startRowIdx + lineIdx;
        if (targetFilteredRowIdx >= filteredRows.length) break;

        const targetFilteredRow = filteredRows[targetFilteredRowIdx];
        const masterIdx = updated.findIndex(r => r.roomId === targetFilteredRow.roomId);
        if (masterIdx === -1) continue;

        const row = { ...updated[masterIdx] };
        const editableFields = getRowEditableFields(row);

        let fieldStartIdx = editableFields.indexOf(startField);
        if (fieldStartIdx === -1) {
          fieldStartIdx = 0;
        }

        const cells = lines[lineIdx];
        for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
          const fieldIdx = fieldStartIdx + cellIdx;
          if (fieldIdx >= editableFields.length) break;

          const field = editableFields[fieldIdx];
          const rawVal = cells[cellIdx].trim();

          let cleaned = rawVal.replace(/[^0-9]/g, '');
          const numVal = field === 'peopleCount' ? Math.max(0, Number(cleaned) || 0) : (Number(cleaned) || 0);
          if (row[field] !== numVal) {
            row[field] = numVal;
            newFlashing[`${row.roomId}-${field}`] = true;
          }
        }

        updated[masterIdx] = row;
      }

      if (Object.keys(newFlashing).length > 0) {
        setFlashingCells(prev => ({ ...prev, ...newFlashing }));
        setTimeout(() => {
          setFlashingCells(prev => {
            const next = { ...prev };
            Object.keys(newFlashing).forEach(k => {
              delete next[k];
            });
            return next;
          });
        }, 1500);
      }

      return updated;
    });
  };

  const handleToggleEditAllElec = () => {
    const nextVal = !allowEditAllElecPrev;
    setAllowEditAllElecPrev(nextVal);
    setMeterRows(prev => prev.map(row => ({ ...row, editElecPrev: nextVal })));
  };

  const handleToggleEditAllWater = () => {
    const nextVal = !allowEditAllWaterPrev;
    setAllowEditAllWaterPrev(nextVal);
    setMeterRows(prev => prev.map(row => ({ ...row, editWaterPrev: nextVal })));
  };

  const checkIsDirty = () => {
    if (!originalRowsRef.current || originalRowsRef.current.length === 0) return false;
    if (meterRows.length !== originalRowsRef.current.length) return true;
    for (let i = 0; i < meterRows.length; i++) {
      const cur = meterRows[i];
      const orig = originalRowsRef.current.find(o => o.roomId === cur.roomId);
      if (!orig) return true;
      
      const curOtherFeesStr = JSON.stringify(cur.otherFees || []);
      const origOtherFeesStr = JSON.stringify(orig.otherFees || []);

      if (
        cur.waterPrev !== orig.waterPrev ||
        cur.waterCurr !== orig.waterCurr ||
        cur.elecPrev !== orig.elecPrev ||
        cur.elecCurr !== orig.elecCurr ||
        cur.peopleCount !== orig.peopleCount ||
        cur.overdueAmount !== orig.overdueAmount ||
        cur.isPaid !== orig.isPaid ||
        cur.billStatus !== orig.billStatus ||
        cur.isReplaced !== orig.isReplaced ||
        curOtherFeesStr !== origOtherFeesStr
      ) {
        return true;
      }
    }
    return false;
  };

  const isDirty = checkIsDirty();

  // Global Enter Key handler to save meters when isDirty is true
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && isDirty && !isSaving) {
        const active = document.activeElement;
        if (active) {
          const id = active.id || '';
          if (
            id.startsWith('fee-desc-') ||
            id.startsWith('fee-amt-') ||
            id.startsWith('quick-fill-') ||
            active.tagName === 'TEXTAREA'
          ) {
            return;
          }
        }
        e.preventDefault();
        handleSaveMeters();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isDirty, isSaving, meterRows, bills, selectedCycle]);

  useEffect(() => {
    if (isLineModalOpen) {
      const cycleBills = bills.filter(b => b.cycleId === selectedCycle);
      const tenantIds = Array.from(new Set(cycleBills.map(b => b.tenantId).filter(Boolean)));
      setSelectedTenantIdsForLine(tenantIds);
    }
  }, [isLineModalOpen, bills, selectedCycle]);

  const handleTableKeyDown = (e: React.KeyboardEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement;
    const isGridInput = target.tagName === 'INPUT' && target.hasAttribute('data-row');
    if (!isGridInput) return;

    if (e.key === 'Enter') {
      if (isDirty && !isSaving) {
        e.preventDefault();
        handleSaveMeters();
      }
      return;
    }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      const rowIndex = Number(target.getAttribute('data-row'));
      const colName = target.getAttribute('data-col') || '';
      const tbody = target.closest('tbody');
      if (!tbody) return;

      const colOrder = ['elecPrev', 'elecCurr', 'waterPrev', 'waterCurr', 'peopleCount', 'overdueAmount'];
      const colIdx = colOrder.indexOf(colName);

      let targetRowIndex = rowIndex;
      let targetColName = colName;

      if (e.key === 'ArrowUp') {
        if (rowIndex > 0) {
          targetRowIndex = rowIndex - 1;
        }
      } else if (e.key === 'ArrowDown') {
        if (rowIndex < filteredRows.length - 1) {
          targetRowIndex = rowIndex + 1;
        }
      } else if (e.key === 'ArrowLeft') {
        let prevColIdx = colIdx - 1;
        while (prevColIdx >= 0) {
          const checkColName = colOrder[prevColIdx];
          const selector = `input[data-row="${rowIndex}"][data-col="${checkColName}"]`;
          const el = tbody.querySelector(selector) as HTMLInputElement | null;
          if (el && !el.readOnly && !el.disabled) {
            targetColName = checkColName;
            break;
          }
          prevColIdx--;
        }
      } else if (e.key === 'ArrowRight') {
        let nextColIdx = colIdx + 1;
        while (nextColIdx < colOrder.length) {
          const checkColName = colOrder[nextColIdx];
          const selector = `input[data-row="${rowIndex}"][data-col="${checkColName}"]`;
          const el = tbody.querySelector(selector) as HTMLInputElement | null;
          if (el && !el.readOnly && !el.disabled) {
            targetColName = checkColName;
            break;
          }
          nextColIdx++;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const selector = `input[data-row="${targetRowIndex}"][data-col="${colName}"]`;
        let el = tbody.querySelector(selector) as HTMLInputElement | null;
        if (el && !el.readOnly && !el.disabled) {
          el.focus();
          el.select();
        } else {
          const allInRow = Array.from(tbody.querySelectorAll(`input[data-row="${targetRowIndex}"]`)) as HTMLInputElement[];
          if (allInRow.length > 0) {
            let closestEl: HTMLInputElement | null = null;
            let minDiff = Infinity;
            allInRow.forEach(input => {
              if (input.readOnly || input.disabled) return;
              const cName = input.getAttribute('data-col');
              if (cName) {
                const cIdx = colOrder.indexOf(cName);
                const diff = Math.abs(cIdx - colIdx);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestEl = input;
                }
              }
            });
            if (closestEl) {
              (closestEl as HTMLInputElement).focus();
              (closestEl as HTMLInputElement).select();
            }
          }
        }
      } else {
        const selector = `input[data-row="${rowIndex}"][data-col="${targetColName}"]`;
        const el = tbody.querySelector(selector) as HTMLInputElement | null;
        if (el && !el.readOnly && !el.disabled) {
          el.focus();
          el.select();
        }
      }
    }
  };

  const handleCheckboxChange = (roomId: string) => {
    setMeterRows(prev => prev.map(row => {
      if (row.roomId === roomId) {
        const isReplaced = !row.isReplaced;
        return {
          ...row,
          isReplaced,
          waterCurr: isReplaced ? 0 : row.waterPrev,
          elecCurr: isReplaced ? 0 : row.elecPrev
        };
      }
      return row;
    }));
  };

  const handleToggleStatusSwitch = async (row: MeterRowState) => {
    if (row.isPaid || row.billStatus === 'paid') {
      showToast('บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');
      return;
    }
    const isCurrentlyIssued = row.billStatus !== 'draft' && row.billStatus !== 'cancelled';
    const targetAction = isCurrentlyIssued ? 'cancel' : 'issue';

    let dirtyRowData: any = undefined;
    if (targetAction === 'issue') {
      const orig = (originalRowsRef.current || []).find(o => o.roomId === row.roomId);
      const dirtyObj: any = { roomId: row.roomId };
      let hasChanges = false;

      if (!orig || row.waterCurr !== orig.waterCurr) { dirtyObj.waterCurr = row.waterCurr; hasChanges = true; }
      if (!orig || (isFirstCycle && row.waterPrev !== orig.waterPrev)) { dirtyObj.waterPrev = row.waterPrev; hasChanges = true; }
      if (!orig || row.elecCurr !== orig.elecCurr) { dirtyObj.elecCurr = row.elecCurr; hasChanges = true; }
      if (!orig || (isFirstCycle && row.elecPrev !== orig.elecPrev)) { dirtyObj.elecPrev = row.elecPrev; hasChanges = true; }
      if (!orig || row.peopleCount !== orig.peopleCount) { dirtyObj.peopleCount = row.peopleCount; hasChanges = true; }
      if (!orig || row.overdueAmount !== orig.overdueAmount) { dirtyObj.manualOutstandingAmount = row.overdueAmount; hasChanges = true; }
      if (!orig || JSON.stringify(row.otherFees || []) !== JSON.stringify(orig.otherFees || [])) { dirtyObj.otherFees = row.otherFees; hasChanges = true; }
      if (!orig || row.isReplaced !== orig.isReplaced) { dirtyObj.isReplaced = row.isReplaced; hasChanges = true; }

      if (hasChanges) {
        dirtyRowData = serializeMeterWorkspaceDirtyRow(dirtyObj);
      }
    }

    setIsSaving(true);
    try {
      const res = await getDataProvider().meters.toggleRoomBillSwitch?.(
        selectedBillingCycleId,
        row.roomId,
        targetAction,
        dirtyRowData,
        targetAction === 'cancel' ? 'OWNER_METER_SWITCH_OFF' : undefined
      );
      setIsSaving(false);
      if (res && res.success) {
        showToast(targetAction === 'issue' ? `ออกบิลห้อง ${row.roomNumber} เรียบร้อยแล้ว` : `ยกเลิกบิลห้อง ${row.roomNumber} เรียบร้อยแล้ว`);
        fetchAuthoritativeReadings(selectedBillingCycleId);
        onRefetchData?.();
      } else {
        showToast(res?.error?.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(err.message || 'เกิดข้อผิดพลาดในการเปลี่ยนสถานะบิล');
    }
  };

  const handleIssueAllBills = async () => {
    if (!selectedBillingCycleId) {
      showToast('ยังไม่ได้ตั้งค่ารอบคำนวณ');
      return;
    }
    setIsSaving(true);
    try {
      // Collect dirty rows using dirty-field semantics (only actually changed fields)
      const rawDirtyRows = meterRows.filter(r => {
        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        if (!orig) return true;
        return (
          r.waterCurr !== orig.waterCurr ||
          (isFirstCycle && r.waterPrev !== orig.waterPrev) ||
          r.elecCurr !== orig.elecCurr ||
          (isFirstCycle && r.elecPrev !== orig.elecPrev) ||
          r.peopleCount !== orig.peopleCount ||
          r.overdueAmount !== orig.overdueAmount ||
          JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || []) ||
          r.isReplaced !== orig.isReplaced
        );
      }).map(r => {
        const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
        const dirtyObj: any = { roomId: r.roomId };
        if (!orig || r.waterCurr !== orig.waterCurr) dirtyObj.waterCurr = r.waterCurr;
        if (!orig || (isFirstCycle && r.waterPrev !== orig.waterPrev)) dirtyObj.waterPrev = r.waterPrev;
        if (!orig || r.elecCurr !== orig.elecCurr) dirtyObj.elecCurr = r.elecCurr;
        if (!orig || (isFirstCycle && r.elecPrev !== orig.elecPrev)) dirtyObj.elecPrev = r.elecPrev;
        if (!orig || r.peopleCount !== orig.peopleCount) dirtyObj.peopleCount = r.peopleCount;
        if (!orig || r.overdueAmount !== orig.overdueAmount) dirtyObj.manualOutstandingAmount = r.overdueAmount;
        if (!orig || JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) dirtyObj.otherFees = r.otherFees;
        if (!orig || r.isReplaced !== orig.isReplaced) dirtyObj.isReplaced = r.isReplaced;
        return dirtyObj;
      });

      const dirtyRows = serializeMeterWorkspaceDirtyRows(rawDirtyRows);

      // ONE HTTP COMMAND to generate bulk bills with dirty rows atomically
      const res = await getDataProvider().billing.generateBulkBills(
        selectedBillingCycleId,
        undefined,
        dirtyRows.length > 0 ? dirtyRows : undefined
      );
      setIsSaving(false);
      if (res && res.success) {
        showToast('ออกบิลสำหรับรอบบันทึกเรียบร้อยแล้ว');
        if (onSaveBills) {
          const freshBills = await getDataProvider().billing.getByCycle(selectedBillingCycleId);
          onSaveBills(freshBills);
        }

        // Open LINE modal with ONLY newly generated bills
        const generatedList = (res.data as any)?.generated || [];
        const generatedTenantIds = generatedList.map((g: any) => {
          const cycleTenant = getTenantForRoomAndCycle(g.roomId, selectedCycleCode || selectedCycle);
          return cycleTenant?.id;
        }).filter(Boolean);

        if (generatedTenantIds.length > 0) {
          setSelectedTenantIdsForLine(generatedTenantIds);
          setIsLineModalOpen(true);
        }

        fetchAuthoritativeReadings(selectedBillingCycleId);
        onRefetchData?.();
      } else {
        showToast(res?.error?.message || 'เกิดข้อผิดพลาดในการออกบิล');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(err.message || 'เกิดข้อผิดพลาดในการออกบิล');
    }
  };

  const handleSaveMeters = async () => {
    if (isSaving) return;
    if (!selectedBillingCycleId) {
      showToast('ยังไม่ได้ตั้งค่ารอบคำนวณ');
      return;
    }

    // Lower reading check
    let lowerReadingError = false;
    for (const row of meterRows) {
      if (!row.isReplaced) {
        if ((isWaterUnit && row.waterCurr < row.waterPrev) || (isElecUnit && row.elecCurr < row.elecPrev)) {
          lowerReadingError = true;
          break;
        }
      }
    }
    if (lowerReadingError) {
      showToast('เลขอ่านมิเตอร์ใหม่ต้องไม่น้อยกว่าเลขอ่านครั้งก่อน');
      return;
    }

    // Validate other fees fields
    let validationFailed = false;
    for (const row of meterRows) {
      const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement | null;
      const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement | null;
      if (descEl && amtEl) {
        const desc = descEl.value.trim();
        const amtVal = amtEl.value.trim();
        if ((desc !== '' && amtVal === '') || (desc === '' && amtVal !== '')) {
          alert(`กรุณากรอกข้อมูล "ชื่อรายการ" และ "จำนวนเงิน (บาท)" ของ "ค่าใช้จ่ายอื่นๆ" ให้ครบถ้วนสำหรับห้อง ${row.roomNumber}`);
          if (desc === '') {
            descEl.focus();
          } else {
            amtEl.focus();
          }
          validationFailed = true;
          break;
        }
      }
    }
    if (validationFailed) {
      return;
    }

    // Extract dirty fields only
    const rawDirtyRows = meterRows.filter(r => {
      const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
      if (!orig) return true;
      return (
        r.waterCurr !== orig.waterCurr ||
        (isFirstCycle && r.waterPrev !== orig.waterPrev) ||
        r.elecCurr !== orig.elecCurr ||
        (isFirstCycle && r.elecPrev !== orig.elecPrev) ||
        r.peopleCount !== orig.peopleCount ||
        r.overdueAmount !== orig.overdueAmount ||
        JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || []) ||
        r.isReplaced !== orig.isReplaced
      );
    }).map(r => {
      const orig = (originalRowsRef.current || []).find(o => o.roomId === r.roomId);
      const dirtyObj: any = { roomId: r.roomId };
      if (!orig || r.waterCurr !== orig.waterCurr) dirtyObj.waterCurr = r.waterCurr;
      if (!orig || (isFirstCycle && r.waterPrev !== orig.waterPrev)) dirtyObj.waterPrev = r.waterPrev;
      if (!orig || r.elecCurr !== orig.elecCurr) dirtyObj.elecCurr = r.elecCurr;
      if (!orig || (isFirstCycle && r.elecPrev !== orig.elecPrev)) dirtyObj.elecPrev = r.elecPrev;
      if (!orig || r.peopleCount !== orig.peopleCount) dirtyObj.peopleCount = r.peopleCount;
      if (!orig || r.overdueAmount !== orig.overdueAmount) dirtyObj.manualOutstandingAmount = r.overdueAmount;
      if (!orig || JSON.stringify(r.otherFees || []) !== JSON.stringify(orig.otherFees || [])) dirtyObj.otherFees = r.otherFees;
      if (!orig || r.isReplaced !== orig.isReplaced) dirtyObj.isReplaced = r.isReplaced;
      return dirtyObj;
    });

    const dirtyRows = serializeMeterWorkspaceDirtyRows(rawDirtyRows);

    if (dirtyRows.length === 0) {
      showToast('บันทึกข้อมูลเรียบร้อยแล้ว (ไม่มีข้อมูลเปลี่ยนแปลง)');
      return;
    }

    setIsSaving(true);
    try {
      const res = await getDataProvider().meters.saveBulkWorkspace?.(selectedBillingCycleId, dirtyRows);
      setIsSaving(false);
      if (res && res.success) {
        originalRowsRef.current = JSON.parse(JSON.stringify(meterRows));
        delete tempMeterRowsCache[selectedBillingCycleId];
        showToast('บันทึกข้อมูลค่ามิเตอร์เรียบร้อยแล้ว');
        fetchAuthoritativeReadings(selectedBillingCycleId);
        onRefetchData?.();
      } else {
        showToast(res?.error?.message || 'เกิดข้อผิดพลาดในการบันทึกค่ามิเตอร์');
      }
    } catch (err: any) {
      setIsSaving(false);
      showToast(err.message || 'เกิดข้อผิดพลาดในการบันทึกค่ามิเตอร์');
    }
  };

  const autofillMeters = () => {
    setMeterRows(prev => prev.map(row => {
      const cycleTenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
      const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 0;
      return {
        ...row,
        waterCurr: row.waterPrev,
        elecCurr: row.elecPrev,
        peopleCount: tenantDefaultPeople,
        overdueAmount: 0
      };
    }));
  };

  const filteredRows = meterRows.filter(row => 
    (row?.roomNumber || '').toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  return (
    <div className="space-y-6">
      {!selectedBillingCycleId && (
        <div data-testid="missing-cycle-banner" className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-4 py-3 rounded-2xl flex items-center gap-2">
          <span>ยังไม่ได้ตั้งค่ารอบคำนวณ</span>
        </div>
      )}
      {/* Floating Toast Notification (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {(saveSuccess || toastMessage) && (
        <div 
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading 
              ? 'opacity-0 translate-y-3 pointer-events-none' 
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          <CheckCircle className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span className="whitespace-pre-line">{toastMessage || "บันทึกข้อมูลสำเร็จ"}</span>
        </div>
      )}

      {/* Recording table with validations */}
      <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-xs">
        <div className="p-4 bg-slate-50/50 border-b border-gray-100 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-2.5 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="ค้นหาเลขห้อง..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-1.5 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800"
              />
            </div>
            
            {/* Scroll table helper buttons */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0">
              <button
                type="button"
                onClick={() => scrollTable('left')}
                className="p-1 hover:bg-white text-slate-600 rounded-lg transition-all cursor-pointer shadow-2xs"
                title="เลื่อนไปซ้าย"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-[10px] font-black text-slate-500 px-1.5 select-none whitespace-nowrap">เลื่อนดูตาราง</span>
              <button
                type="button"
                onClick={() => scrollTable('right')}
                className="p-1 hover:bg-white text-slate-600 rounded-lg transition-all cursor-pointer shadow-2xs"
                title="เลื่อนไปขวา"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          {/* Action buttons (Option A2 Layout) */}
          <div className="w-full sm:w-auto">
            {/* Desktop layout: Single row with order [ ดึงข้อมูลก่อนหน้า ] [ ออกบิลทุกห้อง ] [ กรอกแบบรวดเร็ว ] */}
            <div className="hidden sm:flex items-center gap-2 justify-end">
              {showPullButton && (
                <button
                  type="button"
                  onClick={handlePullPreviousData}
                  className="px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  ดึงข้อมูลก่อนหน้า
                </button>
              )}
              <button
                type="button"
                disabled={isSaving || !selectedBillingCycleId}
                onClick={handleIssueAllBills}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-600/10 whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" />
                ออกบิลทุกห้อง
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsQuickFillOpen(true);
                  setTemplateUsed(false);
                  setTimeout(() => {
                    quickFillInputRef.current?.focus();
                  }, 100);
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md whitespace-nowrap shrink-0"
              >
                <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                กรอกแบบรวดเร็ว
              </button>
            </div>

            {/* Mobile layout: Row 1 full-width [ ดึงข้อมูลก่อนหน้า ], Row 2 2-column [ ออกบิลทุกห้อง ][ กรอกแบบรวดเร็ว ] */}
            <div className="flex sm:hidden flex-col gap-2 w-full">
              {showPullButton && (
                <button
                  type="button"
                  onClick={handlePullPreviousData}
                  className="w-full px-3 py-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  ดึงข้อมูลก่อนหน้า
                </button>
              )}
              <div className="grid grid-cols-2 gap-2 w-full">
                <button
                  type="button"
                  disabled={isSaving || !selectedBillingCycleId}
                  onClick={handleIssueAllBills}
                  className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-emerald-600/10"
                >
                  <FileText className="w-3.5 h-3.5" />
                  ออกบิลทุกห้อง
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsQuickFillOpen(true);
                    setTemplateUsed(false);
                    setTimeout(() => {
                      quickFillInputRef.current?.focus();
                    }, 100);
                  }}
                  className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
                  กรอกแบบรวดเร็ว
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto relative" ref={tableContainerRef}>
          <table onKeyDown={handleTableKeyDown} className="w-full text-left border-collapse text-xs min-w-[1050px]">
            <thead className="bg-slate-50 text-slate-400 font-bold uppercase border-b border-gray-100">
              <tr className="whitespace-nowrap">
                <th className="p-4 sticky left-0 bg-slate-50 z-20 min-w-[80px] shadow-[2px_0_5px_rgba(0,0,0,0.02)]">ห้อง</th>
                {isElecUnit && (
                  <th className="p-4 text-center">
                    <div className="text-slate-500 mb-1">มิเตอร์ไฟเดิม</div>
                    <div className="flex justify-center">
                      {isFirstCycle ? (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight bg-indigo-50 border border-indigo-200 text-indigo-600 select-none">
                          เปิดแก้ไข
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleToggleEditAllElec}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight transition-all cursor-pointer border flex items-center justify-center gap-1 leading-none ${
                            allowEditAllElecPrev
                              ? 'bg-indigo-50 border-indigo-250 text-indigo-600 hover:bg-indigo-100'
                              : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${allowEditAllElecPrev ? 'bg-indigo-600' : 'bg-slate-300'}`}></span>
                          {allowEditAllElecPrev ? 'เปิดแก้ไข' : 'ปิดแก้ไข'}
                        </button>
                      )}
                    </div>
                  </th>
                )}
                {isElecUnit && <th className="p-4 text-center">มิเตอร์ไฟใหม่</th>}
                {isWaterUnit && (
                  <th className="p-4 text-center">
                    <div className="text-slate-500 mb-1">มิเตอร์น้ำเดิม</div>
                    <div className="flex justify-center">
                      {isFirstCycle ? (
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight bg-indigo-50 border border-indigo-200 text-indigo-600 select-none">
                          เปิดแก้ไข
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={handleToggleEditAllWater}
                          className={`px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight transition-all cursor-pointer border flex items-center justify-center gap-1 leading-none ${
                            allowEditAllWaterPrev
                              ? 'bg-indigo-50 border-indigo-250 text-indigo-600 hover:bg-indigo-100'
                              : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${allowEditAllWaterPrev ? 'bg-indigo-600' : 'bg-slate-300'}`}></span>
                          {allowEditAllWaterPrev ? 'เปิดแก้ไข' : 'ปิดแก้ไข'}
                        </button>
                      )}
                    </div>
                  </th>
                )}
                {isWaterUnit && <th className="p-4 text-center">มิเตอร์น้ำใหม่</th>}
                <th className="p-4 text-center">จำนวนคน</th>
                <th className="p-4 text-center">ค้างชำระ</th>
                <th className="p-4">ค่าใช้จ่ายอื่นๆ</th>
                <th className="p-4 text-right">ยอดรวม</th>
                <th id="status-column-header" className="p-4 text-center min-w-[105px]">
                  <div className="text-slate-500 mb-1">สถานะ</div>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      disabled={isSaving || !selectedBillingCycleId}
                      onClick={handleIssueAllBills}
                      className="px-2.5 py-1 rounded-xl text-[10px] font-black tracking-tight bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white transition-all cursor-pointer flex items-center justify-center gap-1 leading-none whitespace-nowrap shadow-md hover:scale-[1.02] active:scale-98"
                    >
                      <FileText className="w-3 h-3 text-white shrink-0" />
                      ออกบิลทุกห้อง
                    </button>
                  </div>
                </th>
                <th className="p-4">ผู้เช่า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 font-semibold">
              {filteredRows.map((row, idx) => {
                const waterUnits = row.isReplaced ? row.waterCurr : (row.waterCurr - row.waterPrev);
                const elecUnits = row.isReplaced ? row.elecCurr : (row.elecCurr - row.elecPrev);

                const waterCost = getWaterCost(row);
                const elecCost = getElectricCost(row);
                const commonCost = getCommonFeeCost(row);
                const internetCost = getInternetCost(row);
                const parkingCost = getParkingCost(row);
                const room = rooms.find(r => r.id === row.roomId);
                const roomRent = (room?.rentCycle === 'term') ? 0 : (room?.monthlyRent || 0);
                const otherFeesTotal = (row.otherFees || []).reduce((sum, item) => sum + item.amount, 0);
                
                const calculatedTotal = roomRent + waterCost + elecCost + commonCost + internetCost + parkingCost + (row.overdueAmount || 0) + otherFeesTotal;

                const tenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);

                const isRowLocked = row.billStatus !== 'draft' && row.billStatus !== 'cancelled';
                const canEditElecPrev = !isRowLocked && (isFirstCycle || row.editElecPrev || allowEditAllElecPrev);
                const canEditWaterPrev = !isRowLocked && (isFirstCycle || row.editWaterPrev || allowEditAllWaterPrev);

                return (
                  <tr key={row.roomId} id={`room-row-${row.roomId}`} className="hover:bg-slate-50/50 transition-colors">
                    {/* Sticky Room Column (Show only room number like A101) */}
                    <td className="p-4 sticky left-0 bg-white z-10 font-extrabold text-slate-800 text-sm shadow-[2px_0_5px_rgba(0,0,0,0.04)]">
                      {row.roomNumber}
                    </td>
                    
                    {/* Elec Prev with conditional edit */}
                    {isElecUnit && (
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center min-w-[80px]">
                          {canEditElecPrev ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={row.elecPrev}
                              onChange={(e) => {
                                const cleaned = e.target.value.replace(/[^0-9]/g, '');
                                handleNumberChange(row.roomId, 'elecPrev', Number(cleaned) || 0);
                              }}
                              onPaste={(e) => handlePaste(row.roomId, 'elecPrev', e)}
                              data-row={idx}
                              data-col="elecPrev"
                              className={`w-16 px-1.5 py-0.5 text-xs border rounded bg-white text-slate-800 text-center font-bold transition-all duration-300 ${
                                flashingCells[`${row.roomId}-elecPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-indigo-300'
                              }`}
                            />
                          ) : (
                            <input
                              type="text"
                              readOnly
                              value={row.elecPrev}
                              className={`w-16 px-1.5 py-0.5 text-xs border rounded text-center font-bold outline-none pointer-events-none transition-all duration-300 ${
                                flashingCells[`${row.roomId}-elecPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-transparent bg-transparent text-slate-500'
                              }`}
                            />
                          )}
                        </div>
                      </td>
                    )}
                    
                    {/* Elec Curr Input */}
                    {isElecUnit && (
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={isRowLocked}
                            value={row.elecCurr}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              handleNumberChange(row.roomId, 'elecCurr', Number(val) || 0);
                            }}
                            onPaste={(e) => handlePaste(row.roomId, 'elecCurr', e)}
                            data-row={idx}
                            data-col="elecCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                              flashingCells[`${row.roomId}-elecCurr`]
                                ? 'animate-vibrant-flash shadow-md z-10'
                                : elecUnits < 0
                                ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                                : 'border-gray-200'
                            }`}
                          />
                        </div>
                      </td>
                    )}

                    {/* Water Prev with conditional edit */}
                    {isWaterUnit && (
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center min-w-[80px]">
                          {canEditWaterPrev ? (
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={row.waterPrev}
                              onChange={(e) => {
                                const cleaned = e.target.value.replace(/[^0-9]/g, '');
                                handleNumberChange(row.roomId, 'waterPrev', Number(cleaned) || 0);
                              }}
                              onPaste={(e) => handlePaste(row.roomId, 'waterPrev', e)}
                              data-row={idx}
                              data-col="waterPrev"
                              className={`w-16 px-1.5 py-0.5 text-xs border rounded bg-white text-slate-800 text-center font-bold transition-all duration-300 ${
                                flashingCells[`${row.roomId}-waterPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-indigo-300'
                              }`}
                            />
                          ) : (
                            <input
                              type="text"
                              readOnly
                              value={row.waterPrev}
                              className={`w-16 px-1.5 py-0.5 text-xs border rounded text-center font-bold outline-none pointer-events-none transition-all duration-300 ${
                                flashingCells[`${row.roomId}-waterPrev`]
                                  ? 'animate-vibrant-flash shadow-md z-10'
                                  : 'border-transparent bg-transparent text-slate-500'
                              }`}
                            />
                          )}
                        </div>
                      </td>
                    )}
                    
                    {/* Water Curr Input */}
                    {isWaterUnit && (
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            disabled={isRowLocked}
                            value={row.waterCurr}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              handleNumberChange(row.roomId, 'waterCurr', Number(val) || 0);
                            }}
                            onPaste={(e) => handlePaste(row.roomId, 'waterCurr', e)}
                            data-row={idx}
                            data-col="waterCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                              flashingCells[`${row.roomId}-waterCurr`]
                                ? 'animate-vibrant-flash shadow-md z-10'
                                : waterUnits < 0
                                ? 'border-rose-300 ring-2 ring-rose-100 bg-rose-50'
                                : 'border-gray-200'
                            }`}
                          />
                        </div>
                      </td>
                    )}

                    {/* People Count Input */}
                    <td className="p-4 text-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        disabled={isRowLocked}
                        value={row.peopleCount}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9]/g, '');
                          handleNumberChange(row.roomId, 'peopleCount', val === '' ? 0 : Math.max(0, Number(val)));
                        }}
                        onPaste={(e) => handlePaste(row.roomId, 'peopleCount', e)}
                        data-row={idx}
                        data-col="peopleCount"
                        className={`w-14 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                          flashingCells[`${row.roomId}-peopleCount`]
                            ? 'animate-vibrant-flash shadow-md z-10'
                            : 'border-gray-200'
                        }`}
                      />
                    </td>

                    {/* Overdue Amount Input */}
                    <td className="p-4 text-center">
                      <div className="flex items-center justify-center">
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          disabled={isRowLocked}
                          value={row.overdueAmount}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            handleNumberChange(row.roomId, 'overdueAmount', Number(val) || 0);
                          }}
                          onPaste={(e) => handlePaste(row.roomId, 'overdueAmount', e)}
                          data-row={idx}
                          data-col="overdueAmount"
                          className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 disabled:bg-slate-50 disabled:text-slate-500 disabled:border-transparent ${
                            flashingCells[`${row.roomId}-overdueAmount`]
                              ? 'animate-vibrant-flash shadow-md z-10'
                              : 'border-gray-200'
                          }`}
                        />
                      </div>
                    </td>

                    {/* Custom Other Fees Column */}
                    <td className="p-4">
                      <div className="flex flex-col gap-1.5 min-w-[150px]">
                        {/* List of existing other fees */}
                        {(row.otherFees || []).map((fee, feeIdx) => (
                          <div key={feeIdx} className="flex items-center justify-between gap-1 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 text-[10px] text-slate-600 font-bold">
                            <span className="truncate max-w-[80px]" title={fee.description}>{fee.description}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-indigo-600">{fee.amount} ฿</span>
                              {!isRowLocked && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOtherFee(row.roomId, feeIdx)}
                                  className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
                                  title="ลบและบันทึกทันที"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}

                        {/* Form to add a new other fee inline */}
                        {!isRowLocked && (
                          <div className="flex items-center gap-1 mt-1">
                            <input
                              type="text"
                              placeholder="ชื่อรายการ"
                              id={`fee-desc-${row.roomId}`}
                              className="w-16 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-indigo-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement | null;
                                  const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement | null;
                                  if (descEl && amtEl) {
                                    handleAddOtherFee(row.roomId, descEl.value, amtEl.value);
                                    descEl.value = '';
                                    amtEl.value = '';
                                  }
                                }
                              }}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="บาท"
                              id={`fee-amt-${row.roomId}`}
                              className="w-12 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 text-center font-medium focus:outline-indigo-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement | null;
                                  const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement | null;
                                  if (descEl && amtEl) {
                                    handleAddOtherFee(row.roomId, descEl.value, amtEl.value);
                                    descEl.value = '';
                                    amtEl.value = '';
                                  }
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement | null;
                                const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement | null;
                                if (descEl && amtEl) {
                                  handleAddOtherFee(row.roomId, descEl.value, amtEl.value);
                                  descEl.value = '';
                                  amtEl.value = '';
                                }
                              }}
                              className="p-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 border border-indigo-100/50"
                              title="เพิ่มรายการและบันทึกทันที"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Total Amount Output */}
                    <td className="p-4 text-right text-indigo-600 font-extrabold text-sm whitespace-nowrap">
                      {(() => {
                        const roomCtx = previewContext?.rooms?.find((r: any) => r.roomId === row.roomId);
                        const preview = calculateMeterRowPreview(roomCtx, previewContext?.rateSnapshot, {
                          waterCurr: row.waterCurr,
                          waterPrev: row.waterPrev,
                          elecCurr: row.elecCurr,
                          elecPrev: row.elecPrev,
                          peopleCount: row.peopleCount,
                          overdueAmount: row.overdueAmount,
                          otherFees: row.otherFees || [],
                        });
                        return `${preview.formattedTotal} ฿`;
                      })()}
                    </td>

                    {/* Status Switch with real server authority */}
                    <td className={`p-4 text-center transition-all duration-300 ${
                      flashingCells[`${row.roomId}-status`]
                        ? 'animate-vibrant-flash rounded-lg shadow-md z-10'
                        : ''
                    }`}>
                      <div className="flex flex-col items-center justify-center gap-1 min-w-[85px]">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={row.billStatus !== 'draft' && row.billStatus !== 'cancelled'}
                          disabled={isSaving || row.isPaid || row.billStatus === 'paid' || !selectedBillingCycleId}
                          onClick={() => handleToggleStatusSwitch(row)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                            row.billStatus === 'paid'
                              ? 'bg-emerald-600'
                              : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                              ? 'bg-amber-500'
                              : 'bg-slate-300'
                          }`}
                          title={
                            row.billStatus === 'paid'
                              ? 'ชำระแล้ว (ล็อค)'
                              : row.billStatus !== 'draft' && row.billStatus !== 'cancelled'
                              ? 'คลิกเพื่อยกเลิกบิล'
                              : 'คลิกเพื่อออกบิล'
                          }
                        >
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                              row.billStatus !== 'draft' && row.billStatus !== 'cancelled' ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                        <span className={`text-[10px] font-extrabold leading-none ${
                          row.billStatus === 'paid'
                            ? 'text-emerald-700'
                            : row.billStatus === 'draft' || row.billStatus === 'cancelled'
                            ? 'text-slate-500'
                            : 'text-amber-700'
                        }`}>
                          {row.billStatus === 'paid'
                            ? 'ชำระแล้ว'
                            : row.billStatus === 'draft' || row.billStatus === 'cancelled'
                            ? 'ยังไม่ออกบิล'
                            : 'รอชำระเงิน'}
                        </span>
                      </div>
                    </td>

                    {/* Tenant Clickable Link */}
                    <td className="p-4 whitespace-nowrap">
                      {tenant ? (
                        <button
                          type="button"
                          onClick={() => onSelectTenant(tenant.id)}
                          className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold whitespace-nowrap"
                        >
                          <User className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate max-w-[100px]">{tenant.name}</span>
                          <ArrowRight className="w-3 h-3 opacity-60 shrink-0" />
                        </button>
                      ) : (isCurrentOperationalCycle && (room || row.roomId)) ? (
                        <button
                          type="button"
                          disabled={quickAddLoadingRoomId === (room?.id || row.roomId)}
                          onClick={async () => {
                            const targetRoomId = room?.id || row.roomId;
                            try {
                              setQuickAddLoadingRoomId(targetRoomId);
                              const dormId = dormitoryId || localStorage.getItem('horplus_current_dormitory_id') || localStorage.getItem('selected_dormitory_id') || '';
                              const res = await httpRequest<{ data: QuickAddRoomContext }>(
                                'GET',
                                `/api/v1/properties/rooms/${targetRoomId}/quick-add-context`,
                                undefined,
                                { headers: dormId ? { 'x-dormitory-id': dormId } : {} }
                              );

                              if (!res.data || !res.data.effective) {
                                throw new Error('ไม่สามารถโหลดข้อมูลสิทธิ์และค่าเช่าห้องพักได้');
                              }

                              setSelectedQuickAddContext(res.data);
                              setQuickAddModalOpen(true);
                            } catch (err: any) {
                              showToast(err.message || 'ไม่สามารถโหลดข้อมูลห้องพักได้ กรุณาลองใหม่อีกครั้ง');
                            } finally {
                              setQuickAddLoadingRoomId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-200 transition-all cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap shrink-0"
                        >
                          {quickAddLoadingRoomId === (room?.id || row.roomId) ? (
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          ) : (
                            <Plus className="w-3 h-3 shrink-0" />
                          )}
                          <span className="whitespace-nowrap">เพิ่มผู้เช่า</span>
                        </button>
                      ) : (
                        <span className="text-gray-400">ไม่มีข้อมูล</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6 + (isElecUnit ? 2 : 0) + (isWaterUnit ? 2 : 0)} className="p-8 text-center text-gray-400">
                    ไม่พบข้อมูลห้องพักพักอาศัยที่ต้องการ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Floating Save Button - ONLY shown when changes exist (isDirty is true), always visible without scrolling */}
        {isDirty && (
          <div className="fixed bottom-[84px] md:bottom-8 left-1/2 -translate-x-1/2 md:translate-x-0 md:left-auto md:right-8 w-[calc(100%-32px)] md:w-auto z-50 flex items-center justify-center animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="relative w-full md:w-auto group">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveMeters}
                className={`relative w-full md:w-auto px-8 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white font-black text-xs md:text-sm rounded-2xl flex items-center justify-center gap-2.5 shadow-2xl transition-all select-none border border-indigo-400/40 ${
                  isSaving
                    ? 'opacity-85 cursor-not-allowed'
                    : 'hover:from-indigo-550 hover:to-blue-550 hover:scale-[1.03] active:scale-95 cursor-pointer'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin shrink-0" />
                    <span className="tracking-wide">กำลังบันทึก...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 md:w-5 md:h-5 animate-bounce shrink-0" />
                    <span className="tracking-wide">บันทึกข้อมูล</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick Fill Modal / กล่องข้อความกรอกข้อมูลด่วน */}
      {isQuickFillOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4 z-[9999] animate-in fade-in duration-200">
          <div className="bg-white border border-gray-100 rounded-[32px] shadow-2xl w-full max-w-xl p-6 md:p-8 relative flex flex-col gap-6 animate-in zoom-in-95 duration-200">
            
            {/* Header */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="bg-emerald-500 text-white rounded-full flex items-center justify-center w-11 h-11 shadow-md shadow-emerald-500/20">
                  <Zap className="w-5 h-5 fill-white text-emerald-300" />
                </div>
                <div>
                  <h4 className="text-base font-extrabold text-slate-900 leading-tight">กรอกแบบรวดเร็ว</h4>
                  <p className="text-[11px] text-gray-400 font-bold mt-0.5 leading-none">วางข้อมูลหลายห้อง ระบบจะใส่ลงตารางให้</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsQuickFillOpen(false)}
                className="text-rose-500 bg-rose-50 hover:bg-rose-100 border border-rose-100 rounded-full p-2 cursor-pointer flex items-center justify-center transition-all shadow-sm"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template Section & Textarea Container with stable, non-jittery height */}
            <div className="flex flex-col gap-4 h-[320px] justify-between shrink-0">
              {/* Template Section: only show if text is <= 1 line */}
              {quickFillText.split('\n').filter(l => l.trim()).length <= 1 && (
                <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 flex flex-col gap-2 shrink-0 h-[112px] justify-center">
                  <span className="text-xs font-black text-slate-800 leading-none text-left">รูปแบบ</span>
                  <div className="bg-white border border-gray-200 rounded-xl p-3 font-mono text-xs text-slate-600 flex items-center justify-start text-left shadow-2xs leading-relaxed whitespace-nowrap overflow-x-auto select-all no-scrollbar">
                    {getTemplateFormatString()}
                  </div>
                  <span className="text-[10px] text-gray-400 font-bold leading-none mt-0.5 text-left">ถ้าไม่มีค้าง ไม่ต้องใส่ช่องสุดท้าย</span>
                </div>
              )}

              {/* Input Text Area - Single, Persistent to preserve focus */}
              <div 
                className="flex flex-col gap-1 w-full shrink-0 transition-all duration-300"
                style={{
                  height: quickFillText.split('\n').filter(l => l.trim()).length <= 1 ? '192px' : '320px'
                }}
              >
                <textarea
                  ref={quickFillInputRef}
                  value={quickFillText}
                  onChange={(e) => setQuickFillText(e.target.value)}
                  wrap="off"
                  placeholder="วางข้อมูลหลายห้องที่นี่ . . ."
                  className="w-full h-full p-4 border border-gray-200 rounded-2xl bg-white text-slate-800 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 resize-none transition-all placeholder:text-gray-300 shadow-2xs overflow-x-auto whitespace-pre"
                />
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-between gap-2.5 mt-2 flex-nowrap">
              {templateUsed ? (
                <button
                  type="button"
                  disabled
                  className="border border-gray-200 bg-gray-50 text-gray-400 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-black flex items-center gap-1 cursor-not-allowed select-none whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-gray-300 shrink-0" />
                  ใช้แม่แบบแล้ว
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const txt = generateTemplateText();
                    setQuickFillText(txt);
                    setTemplateUsed(true);
                    setTimeout(() => {
                      quickFillInputRef.current?.focus();
                    }, 50);
                  }}
                  className="border border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-black transition-all flex items-center gap-1 cursor-pointer shadow-2xs active:scale-98 whitespace-nowrap shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 shrink-0" />
                  ใช้แม่แบบ
                </button>
              )}

              <div className="flex items-center gap-1.5 flex-nowrap shrink-0">
                <button
                  type="button"
                  onClick={() => setIsQuickFillOpen(false)}
                  className="border border-gray-200 hover:bg-gray-50 text-slate-600 px-2.5 sm:px-4 py-2.5 rounded-xl text-[10px] sm:text-xs font-bold transition-all cursor-pointer active:scale-98 whitespace-nowrap shrink-0"
                >
                  ยกเลิก
                </button>

                {quickFillText.trim() === '' ? (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const text = await navigator.clipboard.readText();
                        if (text) {
                          setQuickFillText(text);
                          showToast("วางข้อมูลจากคลิปบอร์ดแล้ว!");
                        } else {
                          showToast("คลิปบอร์ดว่างเปล่า หรือกรุณากดวาง (Ctrl+V)");
                        }
                        setTimeout(() => {
                          quickFillInputRef.current?.focus();
                        }, 50);
                      } catch (e) {
                        showToast("กรุณากดวาง (Ctrl+V) ข้อความด้วยตนเอง");
                        setTimeout(() => {
                          quickFillInputRef.current?.focus();
                        }, 50);
                      }
                    }}
                    className="bg-slate-950 hover:bg-slate-900 text-white font-bold text-[10px] sm:text-xs px-3 sm:px-5 py-2.5 rounded-xl transition-all shadow-md shadow-slate-950/10 cursor-pointer active:scale-98 flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    วางข้อความที่คัดลอก
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const count = parseQuickFillText(quickFillText);
                      if (count > 0) {
                        showToast(`กรอกข้อมูลด่วนสำเร็จ! อัปเดตข้อมูล ${count} ห้อง`);
                      } else {
                        showToast("ไม่พบข้อมูลห้องพักที่ตรงกัน กรุณาตรวจสอบรูปแบบ");
                      }
                      setIsQuickFillOpen(false);
                    }}
                    className="bg-slate-950 hover:bg-slate-900 text-white font-bold text-[10px] sm:text-xs px-3 sm:px-5 py-2.5 rounded-xl transition-all shadow-md shadow-slate-950/10 cursor-pointer active:scale-98 flex items-center gap-1 whitespace-nowrap shrink-0"
                  >
                    ต่อไป
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* LINE Notification Modal Popup */}
      <LineNotificationModal
        isOpen={isLineModalOpen}
        onClose={() => {
          setIsLineModalOpen(false);
          if (tempMeterRowsCache[selectedCycle]) {
            setMeterRows([...tempMeterRowsCache[selectedCycle]]);
          }
        }}
        bills={bills}
        tenants={tenants}
        rooms={rooms}
        contracts={contracts}
        selectedCycle={selectedCycle}
        onSaveBills={onSaveBills}
        onAddLog={onAddLog}
        onShowToast={showToast}
      />

      {/* Quick Add Tenant Modal (3 Types: TERM, MONTHLY, DAILY) */}
      <QuickAddTenantModal
        isOpen={quickAddModalOpen}
        onClose={() => {
          setQuickAddModalOpen(false);
          setSelectedQuickAddContext(null);
        }}
        context={selectedQuickAddContext}
        onSuccess={(msg) => {
          showToast(msg);
          onRefetchData?.();
        }}
      />
    </div>
  );
};
