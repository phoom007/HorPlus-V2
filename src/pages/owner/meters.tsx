/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  CheckCircle2
} from 'lucide-react';
import { Room, Bill, BillItem, Tenant, Contract, BillStatus, calculateRoomRentForCycle } from '../../types';
import { formatBaht, Modal } from '../../components/GlobalComponents';

import { LineNotificationModal } from '../../components/LineNotificationModal';

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

export function getDormitoryRatesForCycle(_dorm?: any, _cycle?: string) {
  return {
    waterUnitRate: 18,
    electricUnitRate: 7,
    waterBillingMode: 'unit',
    electricBillingMode: 'unit',
    commonFee: 200,
    commonFeeMode: 'room',
    internetFee: 0,
    internetFeeMode: 'room',
    parkingFee: 100,
    parkingFeeMode: 'room'
  };
}

export function getDormitory() {
  return {};
}


interface OwnerMetersProps {
  rooms: Room[];
  bills: Bill[];
  tenants: Tenant[];
  contracts: Contract[];
  onSaveBills: (bills: Bill[]) => void;
  onSelectTenant: (tenantId: string) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  onNavigate: (tab: string) => void;
  selectedCycle?: string;
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
}

// Module-level temporary memory cache to survive tab navigation without page reload
export let tempMeterRowsCache: { [cycle: string]: MeterRowState[] } = {};

export const OwnerMeters: React.FC<OwnerMetersProps> = ({
  rooms,
  bills,
  tenants,
  contracts,
  onSaveBills,
  onSelectTenant,
  onAddLog,
  onNavigate,
  selectedCycle = '2026-07'
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

  const isFirstCycle = selectedCycle === '2026-01';
  const isWaterUnit = (cycleRates.waterBillingMode || 'unit') === 'unit';
  const isElecUnit = (cycleRates.electricBillingMode || 'unit') === 'unit';

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const getCycleNewReadings = (roomId: string, cycleId: string): { waterCurr: number, elecCurr: number } => {
    const roomObj = rooms.find(r => r.id === roomId);
    const initialWater = roomObj ? roomObj.initialWaterMeter : 0;
    const initialElec = roomObj ? roomObj.initialElectricMeter : 0;

    if (cycleId < '2026-01') {
      return { waterCurr: initialWater, elecCurr: initialElec };
    }

    // 1. Check cache first
    const cacheKey = `meters_state_${cycleId}`;
    const cached = getStored<MeterRowState[] | null>(cacheKey, null);
    if (cached) {
      const matched = cached.find(c => c.roomId === roomId);
      if (matched) {
        return { waterCurr: matched.waterCurr, elecCurr: matched.elecCurr };
      }
    }

    // 2. Check if there is an existing bill for this cycle
    const bill = bills.find(b => b.cycleId === cycleId && b.roomId === roomId);
    
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

    if (bill) {
      const billRates = getDormitoryRatesForCycle(dorm, cycleId);
      const waterItem = bill.items.find(item => item.category === 'water');
      if (waterItem) {
        const match = waterItem.description.match(/\((\d+)\s*หน่วย\)/);
        if (match) {
          waterCurr = waterPrev + Number(match[1]);
        } else {
          const mode = billRates.waterBillingMode || 'unit';
          if (mode === 'unit') {
            const rate = billRates.waterUnitRate || 18;
            waterCurr = waterPrev + Math.round(waterItem.amount / rate);
          } else {
            waterCurr = waterPrev;
          }
        }
      }

      const elecItem = bill.items.find(item => item.category === 'electricity');
      if (elecItem) {
        const match = elecItem.description.match(/\((\d+)\s*หน่วย\)/);
        if (match) {
          elecCurr = elecPrev + Number(match[1]);
        } else {
          const mode = billRates.electricBillingMode || 'unit';
          if (mode === 'unit') {
            const rate = billRates.electricUnitRate || 7;
            elecCurr = elecPrev + Math.round(elecItem.amount / rate);
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
      const [sy, sm] = c.startDate.split('-').map(Number);
      const [ey, em] = c.endDate.split('-').map(Number);
      const cycleVal = cy * 12 + (cm - 1);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);
      return cycleVal >= startVal && cycleVal <= endVal;
    });

    const tenantId = activeContract ? activeContract.tenantId : rooms.find(r => r.id === roomId)?.currentTenantId;
    return tenants.find(t => t.id === tenantId);
  };

  const getPrevCycleNewReadings = (roomId: string) => {
    const [cy, cm] = selectedCycle.split('-').map(Number);
    let prevYear = cy;
    let prevMonth = cm - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const targetPrevCycleId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    return getCycleNewReadings(roomId, targetPrevCycleId);
  };

  const getPrevCyclePeopleCount = (roomId: string, prevCycleId: string): number => {
    // 1. Primary priority: Check tenant in current cycle and calculate 1 (main) + co-occupants
    const currentTenant = getTenantForRoomAndCycle(roomId, selectedCycle);
    if (currentTenant) {
      return 1 + (currentTenant.coOccupants?.length || 0);
    }

    // 2. Check previous cycle tenant
    const prevTenant = getTenantForRoomAndCycle(roomId, prevCycleId);
    if (prevTenant) {
      return 1 + (prevTenant.coOccupants?.length || 0);
    }

    // 3. Check cache
    const cacheKey = `meters_state_${prevCycleId}`;
    const cached = getStored<MeterRowState[] | null>(cacheKey, null);
    if (cached) {
      const matched = cached.find(c => c.roomId === roomId);
      if (matched && matched.peopleCount !== undefined) {
        return matched.peopleCount;
      }
    }

    // 4. Check previous bill
    const bill = bills.find(b => b.cycleId === prevCycleId && b.roomId === roomId);
    if (bill) {
      for (const item of bill.items) {
        const match = item.description.match(/\((\d+)\s*คน\)/);
        if (match) {
          return Number(match[1]);
        }
      }
    }

    return 1; // Default to 1 if not found
  };

  const showPullButton = loadedCycle === selectedCycle && meterRows.some(row => {
    const prevData = getPrevCycleNewReadings(row.roomId);
    const [cy, cm] = selectedCycle.split('-').map(Number);
    let prevYear = cy;
    let prevMonth = cm - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const targetPrevCycleId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    const prevPeople = getPrevCyclePeopleCount(row.roomId, targetPrevCycleId);

    if (prevData) {
      const waterMismatch = isWaterUnit && row.waterPrev !== prevData.waterCurr;
      const elecMismatch = isElecUnit && row.elecPrev !== prevData.elecCurr;
      const peopleMismatch = row.peopleCount !== prevPeople;
      return waterMismatch || elecMismatch || peopleMismatch;
    }
    return false;
  });

  const handlePullPreviousData = () => {
    const [cy, cm] = selectedCycle.split('-').map(Number);
    let prevYear = cy;
    let prevMonth = cm - 1;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear -= 1;
    }
    const targetPrevCycleId = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const newFlashing: { [key: string]: boolean } = {};

    const updatedRows = meterRows.map(row => {
      const prevData = getPrevCycleNewReadings(row.roomId);
      const prevPeople = getPrevCyclePeopleCount(row.roomId, targetPrevCycleId);
      if (prevData) {
        const nextRow = { ...row };
        if (isWaterUnit) {
          nextRow.waterPrev = prevData.waterCurr;
          newFlashing[`${row.roomId}-waterPrev`] = true;
        }
        if (isElecUnit) {
          nextRow.elecPrev = prevData.elecCurr;
          newFlashing[`${row.roomId}-elecPrev`] = true;
        }
        nextRow.peopleCount = prevPeople;
        newFlashing[`${row.roomId}-peopleCount`] = true;
        return nextRow;
      }
      return row;
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

    showToast(`ดึงข้อมูลจากงวดก่อนหน้าเรียบร้อย`);
  };

  const getTemplateFormatString = () => {
    const sampleRoom = meterRows[0]?.roomNumber || "A101";
    const sampleElec = meterRows[0]?.elecPrev || 500;
    const sampleWater = meterRows[0]?.waterPrev || 500;
    const samplePeople = meterRows[0]?.peopleCount || 1;
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
    const sortedRows = [...meterRows].sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
    
    return sortedRows.map(row => {
      const parts = [row.roomNumber];
      if (isElecUnit) {
        parts.push(`ไฟ ${row.elecPrev}`);
      }
      if (isWaterUnit) {
        parts.push(`น้ำ ${row.waterPrev}`);
      }
      parts.push(`${row.peopleCount} คน`);
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
    const rate = Number(cycleRates.waterUnitRate) || 18;
    const wCurr = Number(row.waterCurr) || 0;
    const wPrev = Number(row.waterPrev) || 0;
    const units = row.isReplaced ? wCurr : Math.max(0, wCurr - wPrev);
    
    if (mode === 'unit') {
      return units * rate;
    } else if (mode === 'person') {
      return (Number(row.peopleCount) || 1) * rate;
    } else { // 'room'
      return rate;
    }
  };

  const getElectricCost = (row: MeterRowState) => {
    const mode = cycleRates.electricBillingMode || 'unit';
    const rate = Number(cycleRates.electricUnitRate) || 7;
    const eCurr = Number(row.elecCurr) || 0;
    const ePrev = Number(row.elecPrev) || 0;
    const units = row.isReplaced ? eCurr : Math.max(0, eCurr - ePrev);
    
    if (mode === 'unit') {
      return units * rate;
    } else if (mode === 'person') {
      return (Number(row.peopleCount) || 1) * rate;
    } else { // 'room'
      return rate;
    }
  };

  const getCommonFeeCost = (row: MeterRowState) => {
    if (row.peopleCount === 0) return 0;
    const mode = cycleRates.commonFeeMode || 'room';
    const fee = cycleRates.commonFee !== undefined ? cycleRates.commonFee : 200;
    
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
    const fee = cycleRates.parkingFee !== undefined ? cycleRates.parkingFee : 100;
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

  useEffect(() => {
    const cacheKey = `meters_state_${selectedCycle}`;
    const cached = getStored<MeterRowState[] | null>(cacheKey, null);
    
    // Reference all real rooms in /owner/rooms sorted by roomNumber
    const activeRooms = [...rooms].sort((a, b) => 
      a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
    );

    const rows: MeterRowState[] = activeRooms.map(r => {
      const cycleTenant = getTenantForRoomAndCycle(r.id, selectedCycle);
      const existingBill = bills.find(b => b.cycleId === selectedCycle && (b.roomId === r.id || b.roomId === r.roomNumber || (b.tenantId && cycleTenant && b.tenantId === cycleTenant.id)));
      const cachedRow = cached?.find(c => c.roomId === r.id);
      
      const prevCycleData = getPrevCycleNewReadings(r.id);
      const rawWaterBaseline = r.initialWaterMeter ?? (r as any).initialWaterReading ?? 0;
      const rawElecBaseline = r.initialElectricMeter ?? (r as any).initialElectricityReading ?? 0;

      const rawWaterPrev = cachedRow?.waterPrev ?? (prevCycleData ? prevCycleData.waterCurr : rawWaterBaseline);
      const parsedWaterPrev = typeof rawWaterPrev === 'number' ? rawWaterPrev : Number(rawWaterPrev);
      const waterPrev = isNaN(parsedWaterPrev) ? 0 : Math.round(parsedWaterPrev);

      const rawElecPrev = cachedRow?.elecPrev ?? (prevCycleData ? prevCycleData.elecCurr : rawElecBaseline);
      const parsedElecPrev = typeof rawElecPrev === 'number' ? rawElecPrev : Number(rawElecPrev);
      const elecPrev = isNaN(parsedElecPrev) ? 0 : Math.round(parsedElecPrev);
      
      // Match existing bill structures if present
      let waterCurr = waterPrev;
      if (cachedRow) {
        waterCurr = cachedRow.waterCurr;
      } else if (existingBill) {
        const waterItem = existingBill.items.find(item => item.category === 'water');
        if (waterItem) {
          const mode = cycleRates.waterBillingMode || 'unit';
          if (mode === 'unit') {
            const match = waterItem.description.match(/\((\d+)\s*หน่วย\)/);
            const waterUnits = match ? Number(match[1]) : Math.round(waterItem.amount / (cycleRates.waterUnitRate || 18));
            waterCurr = waterPrev + waterUnits;
          } else {
            waterCurr = waterPrev;
          }
        }
      }

      let elecCurr = elecPrev;
      if (cachedRow) {
        elecCurr = cachedRow.elecCurr;
      } else if (existingBill) {
        const elecItem = existingBill.items.find(item => item.category === 'electricity');
        if (elecItem) {
          const mode = cycleRates.electricBillingMode || 'unit';
          if (mode === 'unit') {
            const match = elecItem.description.match(/\((\d+)\s*หน่วย\)/);
            const elecUnits = match ? Number(match[1]) : Math.round(elecItem.amount / (cycleRates.electricUnitRate || 7));
            elecCurr = elecPrev + elecUnits;
          } else {
            elecCurr = elecPrev;
          }
        }
      }

      const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 1;
      const peopleCount = cachedRow?.peopleCount ?? tenantDefaultPeople;
      const overdueAmount = cachedRow?.overdueAmount ?? 0;
      
      const billStatus: BillStatus = existingBill 
        ? existingBill.status 
        : (cachedRow?.billStatus ?? (cachedRow?.isPaid ? 'paid' : 'draft'));
      const isPaid = billStatus === 'paid';
      
      const otherFees: { description: string; amount: number }[] = [];
      if (cachedRow?.otherFees) {
        otherFees.push(...cachedRow.otherFees);
      } else if (existingBill) {
        existingBill.items.forEach(item => {
          const isRent = item.category === 'rent' || item.description.startsWith('ค่าเช่า');
          const isWater = item.category === 'water' || item.description.startsWith('ค่าน้ำ');
          const isElec = item.category === 'electricity' || item.description.startsWith('ค่าไฟ');
          const isCommon = item.description.startsWith('ค่าบริการส่วนกลาง') || item.id.includes('-common');
          const isInternet = item.description.startsWith('ค่าบริการอินเทอร์เน็ต') || item.id.includes('-internet');
          const isOverdue = item.description === 'ยอดค้างชำระสะสม' || item.id.includes('-overdue');
          if (!isRent && !isWater && !isElec && !isCommon && !isInternet && !isOverdue) {
            otherFees.push({ description: item.description, amount: item.amount });
          }
        });
      }

      return {
        roomId: r.id,
        roomNumber: r.roomNumber,
        waterPrev,
        waterCurr: Math.round(waterCurr),
        elecPrev,
        elecCurr: Math.round(elecCurr),
        isReplaced: cachedRow?.isReplaced ?? false,
        peopleCount,
        overdueAmount,
        isPaid,
        billStatus,
        editWaterPrev: false,
        editElecPrev: false,
        otherFees
      };
    });
      
    setAllowEditAllElecPrev(false);
    setAllowEditAllWaterPrev(false);
    originalRowsRef.current = JSON.parse(JSON.stringify(rows));

    if (tempMeterRowsCache[selectedCycle]) {
      const syncedCache = tempMeterRowsCache[selectedCycle].map(cachedR => {
        const roomTenant = getTenantForRoomAndCycle(cachedR.roomId, selectedCycle);
        const freshBill = bills.find(b => b.cycleId === selectedCycle && (b.roomId === cachedR.roomId || b.roomId === cachedR.roomNumber || (b.tenantId && roomTenant && b.tenantId === roomTenant.id)));
        if (freshBill) {
          return {
            ...cachedR,
            billStatus: freshBill.status,
            isPaid: freshBill.status === 'paid'
          };
        }
        return cachedR;
      });
      tempMeterRowsCache[selectedCycle] = syncedCache;
      setMeterRows(syncedCache);
    } else {
      setMeterRows(rows);
    }
    setLoadedCycle(selectedCycle);
  }, [selectedCycle, rooms, bills, tenants, contracts]);

  // Synchronize state changes to temporary module cache to survive tab navigation
  useEffect(() => {
    if (meterRows && meterRows.length > 0 && loadedCycle === selectedCycle) {
      tempMeterRowsCache[selectedCycle] = meterRows;
    }
  }, [meterRows, selectedCycle, loadedCycle]);

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
          if (field === 'peopleCount') {
            cleaned = cleaned.charAt(0) || '0';
          }

          const numVal = Number(cleaned) || 0;
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

  const handleTogglePaid = (roomId: string) => {
    setMeterRows(prev => prev.map(row => {
      if (row.roomId === roomId) {
        if (row.billStatus === 'paid') {
          return row;
        }
        const nextStatus: BillStatus = row.billStatus === 'draft' ? 'pending' : 'draft';
        return {
          ...row,
          billStatus: nextStatus,
          isPaid: false
        };
      }
      return row;
    }));
  };

  const handleIssueAllBills = () => {
    const hasPendingRooms = meterRows.some(row => row.billStatus === 'pending');
    if (!hasPendingRooms) {
      setWasIssueAllPressed(true);
    } else {
      setWasIssueAllPressed(false);
    }

    const newFlashing: { [key: string]: boolean } = {};

    let updatedCount = 0;
    const updatedRows = meterRows.map(row => {
      if (hasPendingRooms) {
        // Rollback all pending to draft
        if (row.billStatus === 'pending') {
          newFlashing[`${row.roomId}-status`] = true;
          updatedCount++;
          return {
            ...row,
            billStatus: 'draft' as BillStatus
          };
        }
      } else {
        // Issue all draft to pending
        if (row.billStatus === 'draft') {
          newFlashing[`${row.roomId}-status`] = true;
          updatedCount++;
          return {
            ...row,
            billStatus: 'pending' as BillStatus
          };
        }
      }
      return row;
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
  };

  const handleSaveMeters = () => {
    if (isSaving) return;

    // Validate any half-filled other fees fields
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

    setIsSaving(true);

    // Simulate saving delay of 1000ms to show loading feedback and prevent duplicate clicks
    setTimeout(() => {
      // Collect any typed but unsaved other fees from inputs before saving
      let updatedMeterRows = [...meterRows];
      let hasUnsavedFees = false;

      updatedMeterRows = updatedMeterRows.map(row => {
        const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement;
        const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement;
        if (descEl && amtEl) {
          const desc = descEl.value.trim();
          const amt = Number(amtEl.value);
          if (desc && amt > 0) {
            hasUnsavedFees = true;
            descEl.value = '';
            amtEl.value = '';
            return {
              ...row,
              otherFees: [...(row.otherFees || []), { description: desc, amount: amt }]
            };
          }
        }
        return row;
      });

      if (hasUnsavedFees) {
        setMeterRows(updatedMeterRows);
      }

      let hasError = false;
      let errorRooms: string[] = [];
      let firstErrorRoomId: string | null = null;
      updatedMeterRows.forEach(row => {
        if (!row.isReplaced) {
          const isWaterErr = isWaterUnit && row.waterPrev > row.waterCurr;
          const isElecErr = isElecUnit && row.elecPrev > row.elecCurr;
          if (isWaterErr || isElecErr) {
            hasError = true;
            errorRooms.push(row.roomNumber);
            if (!firstErrorRoomId) {
              firstErrorRoomId = row.roomId;
            }
          }
        }
      });

      if (hasError) {
        alert(`ข้อผิดพลาด: ห้อง [${errorRooms.join(', ')}] มีเลขมิเตอร์เก่า มากกว่า เลขมิเตอร์ใหม่ ไม่สามารถบันทึกข้อมูลได้ กรุณาตรวจสอบหรือปรับปรุงให้ถูกต้อง`);
        if (firstErrorRoomId) {
          const element = document.getElementById(`room-row-${firstErrorRoomId}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('bg-rose-50');
            setTimeout(() => {
              element.classList.remove('bg-rose-50');
            }, 3000);
          }
        }
        setIsSaving(false);
        return;
      }

      // Save to Cache
      const cacheKey = `meters_state_${selectedCycle}`;
      setStored(cacheKey, updatedMeterRows);

      // Save/Update Bills State in Parent
      const updatedBills = [...bills];

      updatedMeterRows.forEach(row => {
        const room = rooms.find(r => r.id === row.roomId);
        if (!room) return;
        const billId = `bill-${selectedCycle}-${row.roomId}`;
        const existingBill = bills.find(b => b.id === billId);
        const cycleTenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
        const tenantId = cycleTenant?.id || room.currentTenantId || existingBill?.tenantId;
        if (!tenantId) return;

        // If main bill was ALREADY paid, preserve existing paid bill as-is without generating supplementary bills.
        const isMainBillPaid = existingBill && existingBill.status === 'paid';

        if (isMainBillPaid) {
          // Do not generate additional supplementary bills for paid bills
          return;
        } else {
          // Standard bill generation/update for unpaid/new bills
          const waterUnits = row.isReplaced ? row.waterCurr : Math.max(0, row.waterCurr - row.waterPrev);
          const elecUnits = row.isReplaced ? row.elecCurr : Math.max(0, row.elecCurr - row.elecPrev);

          const waterCost = getWaterCost(row);
          const elecCost = getElectricCost(row);
          const commonCost = getCommonFeeCost(row);
          const internetCost = getInternetCost(row);
          const rentCalc = calculateRoomRentForCycle(room, selectedCycle);
          const roomRent = rentCalc.amount;
          const overdue = row.overdueAmount || 0;

          const items: BillItem[] = [];

          items.push({ id: `b-${row.roomId}-rent`, description: rentCalc.description, amount: roomRent, category: 'rent' });

          items.push(
            { 
              id: `b-${row.roomId}-water`, 
              description: cycleRates.waterBillingMode === 'unit' 
                ? `ค่าน้ำ (${waterUnits} หน่วย)` 
                : cycleRates.waterBillingMode === 'person' 
                  ? `ค่าน้ำ (${row.peopleCount} คน)` 
                  : `ค่าน้ำ`, 
              amount: waterCost, 
              category: 'water' 
            },
            { 
              id: `b-${row.roomId}-elec`, 
              description: cycleRates.electricBillingMode === 'unit' 
                ? `ค่าไฟ (${elecUnits} หน่วย)` 
                : cycleRates.electricBillingMode === 'person' 
                  ? `ค่าไฟ (${row.peopleCount} คน)` 
                  : `ค่าไฟ`, 
              amount: elecCost, 
              category: 'electricity' 
            }
          );

          if (commonCost > 0) {
            items.push({ 
              id: `b-${row.roomId}-common`, 
              description: cycleRates.commonFeeMode === 'person' 
                ? `ค่าส่วนกลาง (${row.peopleCount} คน)` 
                : `ค่าส่วนกลาง`, 
              amount: commonCost, 
              category: 'other' 
            });
          }

          if (internetCost > 0) {
            items.push({
              id: `b-${row.roomId}-internet`,
              description: cycleRates.internetFeeMode === 'person'
                ? `ค่าอินเทอร์เน็ต (${row.peopleCount} คน)`
                : `ค่าอินเทอร์เน็ต`,
              amount: internetCost,
              category: 'other'
            });
          }

          const parkingCost = getParkingCost(row);
          if (parkingCost > 0) {
            const tenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
            let parkingDesc = 'ค่าที่จอดรถ';
            if (cycleRates.parkingFeeMode === 'vehicle' && tenant?.vehicle?.licensePlate) {
              const vType = tenant.vehicle.type === 'car' ? 'รถยนต์' : tenant.vehicle.type === 'motorcycle' ? 'รถจักรยานยนต์' : 'ยานพาหนะ';
              parkingDesc = `ค่าที่จอดรถ${vType} (${tenant.vehicle.licensePlate})`;
            } else if (cycleRates.parkingFeeMode === 'vehicle') {
              const vType = tenant?.vehicle?.type === 'car' ? 'รถยนต์' : tenant?.vehicle?.type === 'motorcycle' ? 'รถจักรยานยนต์' : 'ยานพาหนะ';
              parkingDesc = `ค่าที่จอดรถ${vType}`;
            }
            items.push({
              id: `b-${row.roomId}-parking`,
              description: parkingDesc,
              amount: parkingCost,
              category: 'parking'
            });
          }

          if (overdue > 0) {
            items.push({
              id: `b-${row.roomId}-overdue`,
              description: 'ยอดค้างชำระสะสม',
              amount: overdue,
              category: 'other'
            });
          }

          if (row.otherFees && row.otherFees.length > 0) {
            row.otherFees.forEach((fee, idx) => {
              items.push({
                id: `b-${row.roomId}-custom-${idx}`,
                description: fee.description,
                amount: fee.amount,
                category: 'other'
              });
            });
          }

          const otherFeesTotal = (row.otherFees || []).reduce((sum, item) => sum + item.amount, 0);
          const totalAmount = roomRent + waterCost + elecCost + commonCost + internetCost + parkingCost + overdue + otherFeesTotal;
          const existingBillIdx = updatedBills.findIndex(b => b.id === billId);

          const newBill: Bill = {
            id: billId,
            billNumber: `BILL-${selectedCycle.replace('-', '')}-${row.roomNumber}`,
            cycleId: selectedCycle,
            roomId: row.roomId,
            tenantId,
            items,
            totalAmount,
            dueDate: `${selectedCycle}-30`,
            status: row.billStatus || 'draft',
            createdAt: existingBill?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          if (existingBillIdx >= 0) {
            updatedBills[existingBillIdx] = newBill;
          } else {
            updatedBills.push(newBill);
          }
        }
      });

      onSaveBills(updatedBills);
      onAddLog('บันทึกเลขอ่านมิเตอร์น้ำ/ไฟฟ้า', `บันทึกมิเตอร์และปรับปรุงยอดบิลรอบบิล ${selectedCycle} สำเร็จ`, 'UtilityRate', selectedCycle);

      // Force update of state and internal reference so checkIsDirty returns false immediately after save
      setMeterRows(updatedMeterRows);
      originalRowsRef.current = JSON.parse(JSON.stringify(updatedMeterRows));
      tempMeterRowsCache[selectedCycle] = updatedMeterRows;

      setSaveSuccess(true);
      if (wasIssueAllPressed) {
        setIsLineModalOpen(true);
        setWasIssueAllPressed(false);
      } else {
        showToast('บันทึกข้อมูลสำเร็จ');
      }
      setIsSaving(false);
      setTimeout(() => {
        setSaveSuccess(false);
      }, 4000);
    }, 1000);
  };

  const autofillMeters = () => {
    setMeterRows(prev => prev.map(row => {
      const cycleTenant = getTenantForRoomAndCycle(row.roomId, selectedCycle);
      const tenantDefaultPeople = cycleTenant ? (1 + (cycleTenant.coOccupants?.length || 0)) : 1;
      return {
        ...row,
        waterCurr: row.waterPrev + Math.floor(Math.random() * 12) + 4,
        elecCurr: row.elecPrev + Math.floor(Math.random() * 180) + 70,
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
          <span>{toastMessage || "บันทึกข้อมูลสำเร็จ"}</span>
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
          
          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
            {showPullButton && (
              <button
                type="button"
                onClick={handlePullPreviousData}
                className="flex-1 sm:flex-initial px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                ดึงข้อมูลก่อนหน้า
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsQuickFillOpen(true);
                setTemplateUsed(false);
                setTimeout(() => {
                  quickFillInputRef.current?.focus();
                }, 100);
              }}
              className={`${
                showPullButton ? 'flex-1 sm:flex-initial' : 'w-full sm:w-auto'
              } px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-indigo-600/10`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
              กรอกแบบรวดเร็ว
            </button>
          </div>
        </div>

        <div className="overflow-x-auto relative" ref={tableContainerRef}>
          <table onKeyDown={handleTableKeyDown} className="w-full text-left border-collapse text-xs min-w-[1050px]">
            <thead className="bg-slate-50 text-slate-400 font-bold uppercase border-b border-gray-100">
              <tr className="whitespace-nowrap">
                <th className="p-4 sticky left-0 bg-slate-50 z-20 min-w-[80px] shadow-[2px_0_5px_rgba(0,0,0,0.02)]">ห้อง</th>
                {isElecUnit && (
                  <th className="p-4 text-center">
                    <div className="text-slate-500 mb-1">มิเตอร์ไฟเก่า</div>
                    <div className="flex justify-center">
                      {isFirstCycle ? (
                        <button
                          type="button"
                          disabled
                          className="px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight bg-indigo-50 border border-indigo-200 text-indigo-600 opacity-85 cursor-not-allowed flex items-center justify-center gap-1 leading-none select-none"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
                          เปิดแก้ไข
                        </button>
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
                    <div className="text-slate-500 mb-1">มิเตอร์น้ำเก่า</div>
                    <div className="flex justify-center">
                      {isFirstCycle ? (
                        <button
                          type="button"
                          disabled
                          className="px-2 py-0.5 rounded-lg text-[10px] font-black tracking-tight bg-indigo-50 border border-indigo-200 text-indigo-600 opacity-85 cursor-not-allowed flex items-center justify-center gap-1 leading-none select-none"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
                          เปิดแก้ไข
                        </button>
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
                    {meterRows.some(row => row.billStatus === 'pending') ? (
                      <button
                        type="button"
                        onClick={handleIssueAllBills}
                        className="px-2.5 py-1 rounded-xl text-[10px] font-black tracking-tight bg-rose-600 hover:bg-rose-700 text-white transition-all cursor-pointer flex items-center justify-center gap-1 leading-none whitespace-nowrap shadow-md hover:scale-[1.02] active:scale-98"
                      >
                        <X className="w-3 h-3 text-white shrink-0" />
                        ยกเลิกออกบิล
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleIssueAllBills}
                        className="px-2.5 py-1 rounded-xl text-[10px] font-black tracking-tight bg-emerald-600 hover:bg-emerald-700 text-white transition-all cursor-pointer flex items-center justify-center gap-1 leading-none whitespace-nowrap shadow-md hover:scale-[1.02] active:scale-98"
                      >
                        <Sparkles className="w-3 h-3 text-white shrink-0 animate-pulse" />
                        ออกบิลทั้งหมด
                      </button>
                    )}
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

                const canEditElecPrev = isFirstCycle || row.editElecPrev || allowEditAllElecPrev;
                const canEditWaterPrev = isFirstCycle || row.editWaterPrev || allowEditAllWaterPrev;

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
                            value={row.elecCurr}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              handleNumberChange(row.roomId, 'elecCurr', Number(val) || 0);
                            }}
                            onPaste={(e) => handlePaste(row.roomId, 'elecCurr', e)}
                            data-row={idx}
                            data-col="elecCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 ${
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
                            value={row.waterCurr}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              handleNumberChange(row.roomId, 'waterCurr', Number(val) || 0);
                            }}
                            onPaste={(e) => handlePaste(row.roomId, 'waterCurr', e)}
                            data-row={idx}
                            data-col="waterCurr"
                            className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 ${
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

                    {/* People Count Input (Only allows 0-9 and replaces latest character) */}
                    <td className="p-4 text-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]"
                        value={row.peopleCount}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.length === 0) {
                            handleNumberChange(row.roomId, 'peopleCount', 0);
                          } else {
                            const lastChar = val.charAt(val.length - 1);
                            if (/[0-9]/.test(lastChar)) {
                              handleNumberChange(row.roomId, 'peopleCount', Number(lastChar));
                            }
                          }
                        }}
                        onPaste={(e) => handlePaste(row.roomId, 'peopleCount', e)}
                        data-row={idx}
                        data-col="peopleCount"
                        className={`w-14 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 ${
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
                          value={row.overdueAmount}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            handleNumberChange(row.roomId, 'overdueAmount', Number(val) || 0);
                          }}
                          onPaste={(e) => handlePaste(row.roomId, 'overdueAmount', e)}
                          data-row={idx}
                          data-col="overdueAmount"
                          className={`w-20 px-2 py-1 text-xs border rounded-lg bg-white text-slate-800 text-center font-bold focus:outline-indigo-500 transition-all duration-300 ${
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
                        {(row.otherFees || []).map((fee, idx) => (
                          <div key={idx} className="flex items-center justify-between gap-1 bg-slate-50 border border-slate-100 rounded-lg px-2 py-0.5 text-[10px] text-slate-600 font-bold">
                            <span className="truncate max-w-[80px]" title={fee.description}>{fee.description}</span>
                            <div className="flex items-center gap-1 shrink-0">
                              <span className="text-indigo-600">{fee.amount} ฿</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setMeterRows(prev => prev.map(r => {
                                    if (r.roomId === row.roomId) {
                                      return {
                                        ...r,
                                        otherFees: (r.otherFees || []).filter((_, fIdx) => fIdx !== idx)
                                      };
                                    }
                                    return r;
                                  }));
                                }}
                                className="text-rose-500 hover:text-rose-700 p-0.5 cursor-pointer"
                                title="ลบ"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        ))}

                        {/* Form to add a new other fee inline */}
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            type="text"
                            placeholder="ชื่อรายการ"
                            id={`fee-desc-${row.roomId}`}
                            className="w-16 px-1.5 py-1 text-[10px] border border-gray-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-indigo-500"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement;
                                const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement;
                                if (descEl && amtEl) {
                                  const desc = descEl.value.trim();
                                  const amt = Number(amtEl.value);
                                  if (desc && amt > 0) {
                                    setMeterRows(prev => prev.map(r => {
                                      if (r.roomId === row.roomId) {
                                        return {
                                          ...r,
                                          otherFees: [...(r.otherFees || []), { description: desc, amount: amt }]
                                        };
                                      }
                                      return r;
                                    }));
                                    descEl.value = '';
                                    amtEl.value = '';
                                  }
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
                                const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement;
                                const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement;
                                if (descEl && amtEl) {
                                  const desc = descEl.value.trim();
                                  const amt = Number(amtEl.value);
                                  if (desc && amt > 0) {
                                    setMeterRows(prev => prev.map(r => {
                                      if (r.roomId === row.roomId) {
                                        return {
                                          ...r,
                                          otherFees: [...(r.otherFees || []), { description: desc, amount: amt }]
                                        };
                                      }
                                      return r;
                                    }));
                                    descEl.value = '';
                                    amtEl.value = '';
                                  }
                                }
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const descEl = document.getElementById(`fee-desc-${row.roomId}`) as HTMLInputElement;
                              const amtEl = document.getElementById(`fee-amt-${row.roomId}`) as HTMLInputElement;
                              if (descEl && amtEl) {
                                const desc = descEl.value.trim();
                                const amt = Number(amtEl.value);
                                if (desc && amt > 0) {
                                  setMeterRows(prev => prev.map(r => {
                                    if (r.roomId === row.roomId) {
                                      return {
                                        ...r,
                                        otherFees: [...(r.otherFees || []), { description: desc, amount: amt }]
                                      };
                                    }
                                    return r;
                                  }));
                                  descEl.value = '';
                                  amtEl.value = '';
                                }
                              }
                            }}
                            className="p-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-lg transition-all cursor-pointer flex items-center justify-center shrink-0 border border-indigo-100/50"
                            title="เพิ่มรายการ"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Total Amount Output */}
                    <td className="p-4 text-right text-indigo-600 font-extrabold text-sm whitespace-nowrap">
                      {formatBaht(calculatedTotal)}
                    </td>

                    {/* Status Toggle Switch: text stacked vertically above the switch button */}
                    <td className={`p-4 text-center transition-all duration-300 ${
                      flashingCells[`${row.roomId}-status`]
                        ? 'animate-vibrant-flash rounded-lg shadow-md z-10'
                        : ''
                    }`}>
                      <div className="flex flex-col items-center justify-center gap-1.5 min-w-[75px]">
                        <span className={`text-[11px] font-extrabold leading-none ${
                          row.billStatus === 'paid'
                            ? 'text-emerald-600'
                            : row.billStatus === 'draft'
                            ? 'text-slate-500'
                            : 'text-amber-500'
                        }`}>
                          {row.billStatus === 'paid'
                            ? 'ชำระแล้ว'
                            : row.billStatus === 'draft'
                            ? 'ยังไม่ออกบิล'
                            : 'รอชำระเงิน'}
                        </span>
                        <button
                          type="button"
                          disabled={row.billStatus === 'paid'}
                          onClick={() => handleTogglePaid(row.roomId)}
                          className={`relative inline-flex h-5 w-9 shrink-0 ${
                            row.billStatus === 'paid' ? 'cursor-not-allowed' : 'cursor-pointer'
                          } rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                            row.billStatus === 'paid'
                              ? 'bg-emerald-500'
                              : row.billStatus === 'draft'
                              ? 'bg-slate-300'
                              : 'bg-amber-400'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                              row.billStatus === 'draft' ? 'translate-x-0' : 'translate-x-4'
                            }`}
                          />
                        </button>
                      </div>
                    </td>

                    {/* Tenant Clickable Link */}
                    <td className="p-4">
                      {tenant ? (
                        <button
                          type="button"
                          onClick={() => onSelectTenant(tenant.id)}
                          className="inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 hover:underline transition-all cursor-pointer font-bold"
                        >
                          <User className="w-3.5 h-3.5" />
                          <span className="truncate max-w-[100px]">{tenant.name}</span>
                          <ArrowRight className="w-3 h-3 opacity-60" />
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
    </div>
  );
};
