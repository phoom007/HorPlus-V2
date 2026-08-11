import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Users,
  CheckCircle2,
  X,
  Check,
  RotateCw,
  Send
} from 'lucide-react';
import { Modal, formatBaht } from './GlobalComponents';
import { Bill, Tenant, Room, Contract } from '../types';

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

export function formatCycleThaiShort(cycle: string) {
  if (!cycle) return '';
  const [y, m] = cycle.split('-');
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] || m} ${parseInt(y, 10) + 543}`;
}

import { tempMeterRowsCache, MeterRowState } from '../pages/owner/meters';

export const LineIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="24" height="24" rx="6" fill="#06C755" />
    <path d="M12 4C7.58 4 4 7.02 4 10.75c0 3.33 2.76 6.13 6.5 6.67.28.06.67.19.77.43.08.2.05.52.03.73-.04.29-.19 1.15-.22 1.4-.04.39.18.6.51.38 2.58-1.72 5.17-3.55 6.5-5.36.77-1.05 1.25-2.22 1.25-3.5C20 7.02 16.42 4 12 4z" fill="#FFFFFF" />
  </svg>
);

const getRoomForTenant = (
  tenantId: string,
  tenant: Tenant | undefined,
  rooms: Room[],
  contracts: Contract[] = [],
  bills: Bill[] = []
): Room | undefined => {
  if (!tenantId) return undefined;
  let room = rooms.find(r => r.currentTenantId === tenantId);
  if (room) return room;

  if ((tenant as any)?.roomId) {
    room = rooms.find(r => r.id === (tenant as any).roomId || r.roomNumber === (tenant as any).roomId);
    if (room) return room;
  }

  if (contracts && contracts.length > 0) {
    const contract = contracts.find(c => c.tenantId === tenantId);
    if (contract?.roomId) {
      room = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
      if (room) return room;
    }
  }

  const bill = bills.find(b => b.tenantId === tenantId && b.roomId);
  if (bill?.roomId) {
    room = rooms.find(r => r.id === bill.roomId || r.roomNumber === bill.roomId);
    if (room) return room;
  }

  if (tenant?.rentalHistory && tenant.rentalHistory.length > 0) {
    const hist = tenant.rentalHistory[0];
    room = rooms.find(r => r.id === hist || r.roomNumber === hist);
    if (room) return room;
  }

  return undefined;
};

interface LineNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  bills: Bill[];
  tenants: Tenant[];
  rooms: Room[];
  contracts?: Contract[];
  selectedCycle: string;
  onSaveBills?: (bills: Bill[]) => void;
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
  targetScrollTenantId?: string | null;
  onShowToast?: (msg: string) => void;
}

export const LineNotificationModal: React.FC<LineNotificationModalProps> = ({
  isOpen,
  onClose,
  bills,
  tenants,
  rooms,
  contracts = [],
  selectedCycle,
  onSaveBills,
  onAddLog,
  targetScrollTenantId,
  onShowToast
}) => {
  const [lineFilterTab, setLineFilterTab] = useState<'all' | 'unsent' | 'sent' | 'unpaid'>('unsent');
  const [selectedTenantIdsForLine, setSelectedTenantIdsForLine] = useState<string[]>([]);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const [lineToastSuccess, setLineToastSuccess] = useState<string | null>(null);

  // Persistent line notify statuses map
  const [lineNotifyMap, setLineNotifyMap] = useState<{ [key: string]: { status: 'sent' | 'resent'; sentAt: string } }>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_line_notify_map');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      [`2026-07_tenant-1`]: { status: 'sent', sentAt: '14 ก.ค. 2569 - 10:30 น.' },
      [`2026-07_tenant-2`]: { status: 'sent', sentAt: '14 ก.ค. 2569 - 10:32 น.' },
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem('HorPlus_line_notify_map', JSON.stringify(lineNotifyMap));
    } catch (e) {
      console.error(e);
    }
  }, [lineNotifyMap]);

  const contractsList = contracts && contracts.length > 0 ? contracts : [];

  // Compute cycle bills sorted by room number (only unpaid bills for occupied rooms with real active tenants)
  const cycleBillsMap = new Map<string, Bill>();

  const activeRooms = [...rooms].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' })
  );

  activeRooms.forEach(room => {
    // Determine active tenant for this room in selectedCycle
    const [cy, cm] = selectedCycle.split('-').map(Number);
    const cycleVal = cy * 12 + (cm - 1);

    const activeContract = contractsList.find(c => {
      if (c.roomId !== room.id && c.roomId !== room.roomNumber) return false;
      if (c.status === 'terminated') return false;
      const [sy, sm] = c.startDate.split('-').map(Number);
      const [ey, em] = c.endDate.split('-').map(Number);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);
      return cycleVal >= startVal && cycleVal <= endVal;
    });

    let activeTenant: Tenant | undefined = undefined;
    if (activeContract) {
      activeTenant = tenants.find(t => t.id === activeContract.tenantId && t.status !== 'inactive');
    }
    if (!activeTenant && room.currentTenantId) {
      activeTenant = tenants.find(t => t.id === room.currentTenantId && t.status !== 'inactive');
    }
    if (!activeTenant) {
      activeTenant = tenants.find(t => {
        if (t.status === 'inactive') return false;
        if ((t as any).roomId === room.id || (t as any).roomId === room.roomNumber) return true;
        if (t.rentalHistory && t.rentalHistory.length > 0 && (t.rentalHistory[0] === room.id || t.rentalHistory[0] === room.roomNumber)) return true;
        return false;
      });
    }

    if (!activeTenant) return; // No active real tenant in this room

    // Check if an existing bill exists for this room / active tenant in selectedCycle
    const existingBill = bills.find(
      b => b.cycleId === selectedCycle && (b.tenantId === activeTenant!.id || b.roomId === room.id)
    );

    if (existingBill) {
      // Exclude paid bills (Requirement #2: แสดงสถานะ ไม่เท่ากับ 'ชำระแล้ว')
      if (existingBill.status !== 'paid') {
        cycleBillsMap.set(activeTenant.id, {
          ...existingBill,
          roomId: room.id,
          tenantId: activeTenant.id
        });
      }
    } else {
      // Check if there is any paid bill for this room in selectedCycle
      const hasPaidBill = bills.some(
        b => b.cycleId === selectedCycle && (b.roomId === room.id || b.tenantId === activeTenant!.id) && b.status === 'paid'
      );

      if (!hasPaidBill) {
        let totalAmt = room.monthlyRent || (room as any).baseRentPrice || 0;
        if (tempMeterRowsCache[selectedCycle]) {
          const cachedRow = tempMeterRowsCache[selectedCycle].find(cr => cr.roomId === room.id);
          if (cachedRow) {
            const rates = getDormitoryRatesForCycle(getDormitory(), selectedCycle);
            const waterCost = (cachedRow.waterCurr - cachedRow.waterPrev) * (rates.waterUnitRate || 18);
            const elecCost = (cachedRow.elecCurr - cachedRow.elecPrev) * (rates.electricUnitRate || 7);
            const roomRent = (room.rentCycle === 'term') ? 0 : (room.monthlyRent || 0);
            const otherTotal = (cachedRow.otherFees || []).reduce((s, f) => s + f.amount, 0);
            const calc = roomRent + Math.max(0, waterCost) + Math.max(0, elecCost) + (cachedRow.overdueAmount || 0) + otherTotal;
            if (calc > 0) totalAmt = calc;
          }
        }

        cycleBillsMap.set(activeTenant.id, {
          id: `draft-bill-${room.id}-${selectedCycle}`,
          billNumber: `BILL-${selectedCycle.replace('-', '')}-${room.roomNumber}`,
          cycleId: selectedCycle,
          roomId: room.id,
          tenantId: activeTenant.id,
          items: [
            {
              id: `rent-${room.id}`,
              description: `ค่าเช่าห้องพัก ${room.roomNumber}`,
              amount: room.monthlyRent || (room as any).baseRentPrice || 0,
              category: 'rent'
            }
          ],
          totalAmount: totalAmt,
          dueDate: `${selectedCycle}-30`,
          status: 'draft',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    }
  });

  const sortedCycleBills = Array.from(cycleBillsMap.values()).sort((a, b) => {
    const tenantA = tenants.find(t => t.id === a.tenantId);
    const tenantB = tenants.find(t => t.id === b.tenantId);
    const roomA = getRoomForTenant(a.tenantId, tenantA, rooms, contracts, bills)?.roomNumber || '';
    const roomB = getRoomForTenant(b.tenantId, tenantB, rooms, contracts, bills)?.roomNumber || '';
    return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
  });

  // Reset and preselect when modal opens
  useEffect(() => {
    if (isOpen) {
      if (targetScrollTenantId) {
        setSelectedTenantIdsForLine([targetScrollTenantId]);
        setLineFilterTab('all');
      } else {
        const unsentTenantIds = sortedCycleBills
          .filter(b => b.status !== 'paid' && !lineNotifyMap[`${selectedCycle}_${b.tenantId}`])
          .map(b => b.tenantId);

        if (unsentTenantIds.length > 0) {
          setSelectedTenantIdsForLine(unsentTenantIds);
          setLineFilterTab('unsent');
        } else {
          const allTenantIds = sortedCycleBills.map(b => b.tenantId);
          setSelectedTenantIdsForLine(allTenantIds);
          setLineFilterTab('all');
        }
      }
    }
  }, [isOpen, selectedCycle, targetScrollTenantId]);

  // Auto scroll to target room card when opening LINE modal
  useEffect(() => {
    if (isOpen && targetScrollTenantId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`line-tenant-${targetScrollTenantId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, targetScrollTenantId]);

  const handleSendLineNotifications = () => {
    if (selectedTenantIdsForLine.length === 0) return;

    setIsSendingLine(true);

    setTimeout(() => {
      const nowStr = `${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} - ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

      const newMap = { ...lineNotifyMap };
      let newSentCount = 0;
      let resentCount = 0;

      const updatedBills = [...bills];
      let billsModified = false;

      selectedTenantIdsForLine.forEach(tenantId => {
        const key = `${selectedCycle}_${tenantId}`;
        const existing = newMap[key];
        if (existing) {
          newMap[key] = { status: 'resent', sentAt: nowStr };
          resentCount++;
        } else {
          newMap[key] = { status: 'sent', sentAt: nowStr };
          newSentCount++;
        }

        const tenant = tenants.find(t => t.id === tenantId);
        const room = getRoomForTenant(tenantId, tenant, rooms, contracts, bills);
        const existingBillIdx = updatedBills.findIndex(
          b => b.cycleId === selectedCycle && (b.tenantId === tenantId || (room && (b.roomId === room.id || b.roomId === room.roomNumber)))
        );

        if (existingBillIdx >= 0) {
          const existingBill = updatedBills[existingBillIdx];
          if (existingBill.status !== 'paid') {
            updatedBills[existingBillIdx] = {
              ...existingBill,
              status: 'pending',
              roomId: existingBill.roomId || room?.id || '',
              tenantId: existingBill.tenantId || tenantId,
              updatedAt: new Date().toISOString()
            };
            billsModified = true;
          }
        } else if (room) {
          let totalAmt = room.monthlyRent || (room as any).baseRentPrice || 0;
          if (tempMeterRowsCache[selectedCycle]) {
            const cachedRow = tempMeterRowsCache[selectedCycle].find(cr => cr.roomId === room.id || cr.roomNumber === room.roomNumber);
            if (cachedRow) {
              const rates = getDormitoryRatesForCycle(getDormitory(), selectedCycle);
              const waterCost = (cachedRow.waterCurr - cachedRow.waterPrev) * (rates.waterUnitRate || 18);
              const elecCost = (cachedRow.elecCurr - cachedRow.elecPrev) * (rates.electricUnitRate || 7);
              const roomRent = (room.rentCycle === 'term') ? 0 : (room.monthlyRent || 0);
              const otherTotal = (cachedRow.otherFees || []).reduce((s, f) => s + f.amount, 0);
              const calc = roomRent + Math.max(0, waterCost) + Math.max(0, elecCost) + (cachedRow.overdueAmount || 0) + otherTotal;
              if (calc > 0) totalAmt = calc;
            }
          }

          const newBill: Bill = {
            id: `b-${room.id}-${selectedCycle}`,
            billNumber: `BILL-${selectedCycle.replace('-', '')}-${room.roomNumber}`,
            cycleId: selectedCycle,
            roomId: room.id,
            tenantId: tenantId,
            items: [
              {
                id: `b-${room.id}-rent`,
                description: `ค่าเช่าห้องพัก ${room.roomNumber}`,
                amount: room.monthlyRent || (room as any).baseRentPrice || 0,
                category: 'rent'
              }
            ],
            totalAmount: totalAmt,
            dueDate: `${selectedCycle}-30`,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newBill);
          billsModified = true;
        }

        if (room) {
          if (!tempMeterRowsCache[selectedCycle]) {
            const cacheKey = `meters_state_${selectedCycle}`;
            tempMeterRowsCache[selectedCycle] = getStored<MeterRowState[]>(cacheKey, []) || [];
          }
          if (tempMeterRowsCache[selectedCycle] && tempMeterRowsCache[selectedCycle].length > 0) {
            tempMeterRowsCache[selectedCycle] = tempMeterRowsCache[selectedCycle].map(r => {
              if ((r.roomId === room.id || r.roomId === room.roomNumber || r.roomNumber === room.roomNumber) && r.billStatus !== 'paid') {
                return {
                  ...r,
                  billStatus: 'pending',
                  isPaid: false
                };
              }
              return r;
            });
            setStored(`meters_state_${selectedCycle}`, tempMeterRowsCache[selectedCycle]);
          }
        }
      });

      if (billsModified && onSaveBills) {
        onSaveBills(updatedBills);
      }


      setLineNotifyMap(newMap);
      setIsSendingLine(false);

      const count = selectedTenantIdsForLine.length;
      const msg = `ส่งแจ้งเตือนผ่าน LINE เรียบร้อยแล้ว (${count} ห้อง)`;
      
      if (onShowToast) {
        onShowToast(msg);
      } else {
        setLineToastSuccess(msg);
      }

      setSelectedTenantIdsForLine([]);

      onAddLog?.(
        'ส่งแจ้งเตือนผ่าน LINE',
        `ส่งข้อความแจ้งเตือนบิลยอดชำระประจำงวด ${selectedCycle} ผ่าน LINE ให้แก่ ${count} รายการเรียบร้อยแล้ว`,
        'Bill',
        selectedCycle
      );

      // Close modal immediately so floating toast shows up on active view
      onClose();
    }, 400);
  };

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={
        <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full pr-8 gap-2 sm:gap-4">
          <div className="flex items-center gap-3">
            <LineIcon className="w-5 h-5 shrink-0" />
            <span className="font-extrabold text-slate-900 text-sm sm:text-base tracking-tight whitespace-nowrap">
              แจ้งเตือนผ่าน LINE
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0 pl-8 sm:pl-0 sm:ml-auto">
            <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200/80 font-bold text-xs rounded-full flex items-center gap-1 shadow-2xs">
              <Calendar className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              {formatCycleThaiShort(selectedCycle)}
            </span>
            <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-bold text-xs rounded-full flex items-center gap-1 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              พร้อมใช้งาน
            </span>
          </div>
        </div>
      } 
      size="lg"
    >
      <div className="flex flex-col max-h-[75vh] font-sans text-xs -m-1 p-1">
        
        {/* Short Toast Notification */}
        {lineToastSuccess && (
          <div className="p-3 mb-2.5 bg-emerald-600 text-white font-extrabold rounded-2xl flex items-center justify-between shadow-lg animate-in fade-in slide-in-from-top-2 duration-300 shrink-0 border border-emerald-500">
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-white animate-bounce" />
              <span>{lineToastSuccess}</span>
            </div>
            <button onClick={() => setLineToastSuccess(null)} className="text-white/80 hover:text-white cursor-pointer p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Filter Tabs & Select All Toolbar */}
        <div className="space-y-2 pb-2 shrink-0">
          <div className="flex justify-end">
            <div className="inline-flex bg-slate-100 p-1 rounded-2xl gap-1 max-w-full overflow-x-auto">
              <button
                type="button"
                onClick={() => setLineFilterTab('all')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                  lineFilterTab === 'all' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
                }`}
              >
                ทั้งหมด ({sortedCycleBills.length})
              </button>
              <button
                type="button"
                onClick={() => setLineFilterTab('unsent')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                  lineFilterTab === 'unsent' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
                }`}
              >
                ยังไม่ได้ส่ง ({sortedCycleBills.filter(b => b.status !== 'paid' && !lineNotifyMap[`${selectedCycle}_${b.tenantId}`]).length})
              </button>
              <button
                type="button"
                onClick={() => setLineFilterTab('sent')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                  lineFilterTab === 'sent' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
                }`}
              >
                ส่งแล้ว ({sortedCycleBills.filter(b => lineNotifyMap[`${selectedCycle}_${b.tenantId}`]).length})
              </button>
            </div>
          </div>

          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              onClick={() => {
                const modalFilteredBills = sortedCycleBills.filter(b => {
                  const isSent = !!lineNotifyMap[`${selectedCycle}_${b.tenantId}`];
                  if (lineFilterTab === 'unsent') return b.status !== 'paid' && !isSent;
                  if (lineFilterTab === 'sent') return isSent;
                  return true;
                });
                const targetTenantIds = modalFilteredBills.map(b => b.tenantId);
                const allSelected = targetTenantIds.every(id => selectedTenantIdsForLine.includes(id));

                if (allSelected) {
                  setSelectedTenantIdsForLine(prev => prev.filter(id => !targetTenantIds.includes(id)));
                } else {
                  setSelectedTenantIdsForLine(prev => Array.from(new Set([...prev, ...targetTenantIds])));
                }
              }}
              className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
            >
              <Users className="w-3.5 h-3.5 text-slate-500" />
              {(() => {
                const modalFilteredBills = sortedCycleBills.filter(b => {
                  const isSent = !!lineNotifyMap[`${selectedCycle}_${b.tenantId}`];
                  if (lineFilterTab === 'unsent') return b.status !== 'paid' && !isSent;
                  if (lineFilterTab === 'sent') return isSent;
                  return true;
                });
                const isAllSelected = modalFilteredBills.length > 0 && modalFilteredBills.every(b => selectedTenantIdsForLine.includes(b.tenantId));
                return isAllSelected ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด';
              })()}
            </button>
          </div>
        </div>

        {/* Tenant List */}
        <div className="flex-1 min-h-[140px] max-h-[220px] sm:max-h-[340px] overflow-y-auto space-y-2 pr-1 border border-slate-100 rounded-2xl p-2 bg-slate-50/50">
          {(() => {
            const modalFilteredBills = sortedCycleBills.filter(b => {
              const isSent = !!lineNotifyMap[`${selectedCycle}_${b.tenantId}`];
              if (lineFilterTab === 'unsent') return b.status !== 'paid' && !isSent;
              if (lineFilterTab === 'sent') return isSent;
              if (lineFilterTab === 'unpaid') return b.status === 'pending' || b.status === 'overdue';
              return true;
            });

            if (modalFilteredBills.length === 0) {
              return (
                <div className="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2 my-2 animate-in fade-in duration-300">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto opacity-70" />
                  <p className="font-bold text-slate-700 text-xs">ไม่มีรายการบิลในหมวดหมู่นี้</p>
                  <p className="text-[11px] text-slate-400">ส่งแจ้งเตือนครบทุกห้องในหมวดหมู่นี้แล้ว หรือไม่พบรายการที่ตรงกับเงื่อนไข</p>
                </div>
              );
            }

            return modalFilteredBills.map(bill => {
              const tenant = tenants.find(t => t.id === bill.tenantId);
              const room = getRoomForTenant(bill.tenantId, tenant, rooms, contracts, bills);
              const isChecked = selectedTenantIdsForLine.includes(bill.tenantId);
              const isTargetScrolled = targetScrollTenantId === bill.tenantId;
              const lineRecord = lineNotifyMap[`${selectedCycle}_${bill.tenantId}`];

              return (
                <div
                  id={`line-tenant-${bill.tenantId}`}
                  key={bill.id}
                  onClick={() => {
                    if (isChecked) {
                      setSelectedTenantIdsForLine(selectedTenantIdsForLine.filter(id => id !== bill.tenantId));
                    } else {
                      setSelectedTenantIdsForLine([...selectedTenantIdsForLine, bill.tenantId]);
                    }
                  }}
                  className={`p-2.5 sm:p-3 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-2 sm:gap-3 animate-in fade-in ${
                    isTargetScrolled ? 'ring-2 ring-emerald-500 border-emerald-400' : ''
                  } ${
                    isChecked
                      ? 'bg-emerald-50/80 border-emerald-300 shadow-2xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all shrink-0 ${
                      isChecked ? 'bg-[#06C755] border-[#06C755] text-white' : 'border-slate-300 bg-white'
                    }`}>
                      {isChecked && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>

                    {/* Avatar / Profile */}
                    <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-emerald-100 text-emerald-800 font-extrabold flex items-center justify-center border border-emerald-200 overflow-hidden shrink-0">
                      {tenant?.idCardPhotoMock ? (
                        <img src={tenant.idCardPhotoMock} alt={tenant.name} className="w-full h-full object-cover" />
                      ) : (
                        <span>{tenant?.name.substring(0, 2) || 'ผช'}</span>
                      )}
                    </div>

                    {/* Details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-extrabold text-slate-900 text-xs shrink-0">ห้อง {room?.roomNumber}</span>
                        <span className="text-slate-600 font-semibold text-xs truncate">&bull; {tenant?.name || 'ผู้เช่า'}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-semibold truncate">
                        ยอดบิล: <span className="font-extrabold text-slate-800">{formatBaht(bill.totalAmount)}</span>
                      </p>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="shrink-0 text-right">
                    {lineRecord?.status === 'sent' && (
                      <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-amber-50 text-amber-800 border border-amber-300 font-bold rounded-xl text-[10px] inline-flex items-center gap-1 shadow-2xs whitespace-nowrap">
                        <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-600 shrink-0" />
                        <span>รอชำระ (ส่งแล้ว)</span>
                      </span>
                    )}
                    {lineRecord?.status === 'resent' && (
                      <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-amber-100 text-amber-900 border border-amber-300 font-bold rounded-xl text-[10px] inline-flex items-center gap-1 shadow-2xs whitespace-nowrap">
                        <RotateCw className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-700 shrink-0" />
                        <span>รอชำระ (ส่งซ้ำแล้ว)</span>
                      </span>
                    )}
                    {!lineRecord && (
                      <span className="px-2 py-0.5 sm:px-2.5 sm:py-1 bg-gray-50 text-gray-700 border border-gray-200 font-bold rounded-xl text-[10px] inline-block whitespace-nowrap">
                        ยังไม่ได้ส่ง
                      </span>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* Action Footer */}
        <div className="pt-3 mt-2 border-t border-slate-100 shrink-0 sticky bottom-0 bg-white z-20 flex flex-row items-center justify-between gap-1.5 sm:gap-3 min-w-0">
          <span className="text-xs font-bold text-slate-600 shrink-0">
            เลือกแล้ว: <span className="text-[#06C755] font-black text-xs sm:text-sm">{selectedTenantIdsForLine.length}</span> ห้อง
          </span>

          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 sm:px-3.5 py-2 sm:py-2.5 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer transition-all shrink-0"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={selectedTenantIdsForLine.length === 0 || isSendingLine}
              onClick={handleSendLineNotifications}
              className="px-2.5 sm:px-4 py-2 sm:py-2.5 bg-[#06C755] hover:bg-[#05b34c] disabled:opacity-50 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 sm:gap-1.5 shadow-2xs transition-all cursor-pointer min-w-0"
            >
              {isSendingLine ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate text-[11px] sm:text-xs">กำลังส่ง...</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-[11px] sm:text-xs">ส่งแจ้งเตือน ({selectedTenantIdsForLine.length})</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </Modal>
  );
};
