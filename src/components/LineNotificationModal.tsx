import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Users,
  CheckCircle2,
  X,
  Check,
  RotateCw,
  Send,
  Settings,
  AlertCircle
} from 'lucide-react';
import { Modal, formatBaht, formatThaiDate } from './GlobalComponents';
import { Bill, Tenant, Room, Contract } from '../types';
import { getCsrfTokenFromCookie } from '../data/httpClient';

export function formatCycleThaiShort(cycle: string) {
  if (!cycle) return '';
  const [y, m] = cycle.split('-');
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const idx = parseInt(m, 10) - 1;
  return `${months[idx] || m} ${parseInt(y, 10) + 543}`;
}

import { LineLogo } from './LineLogo';

export const LineIcon: React.FC<{ className?: string }> = ({ className = "w-5 h-5" }) => (
  <LineLogo className={className} />
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
  dormitoryId?: string;
  bills: Bill[];
  tenants: Tenant[];
  rooms: Room[];
  contracts?: Contract[];
  selectedCycle: string;
  onSaveBills?: (bills: Bill[]) => void;
  onAddLog?: (action: string, details: string, module: string, targetId?: string) => void;
  targetScrollTenantId?: string | null;
  onShowToast?: (msg: string) => void;
  onNavigateToLineConfig?: () => void;
  userRole?: string | null;
}

export const LineNotificationModal: React.FC<LineNotificationModalProps> = ({
  isOpen,
  onClose,
  dormitoryId,
  bills = [],
  tenants = [],
  rooms = [],
  contracts = [],
  selectedCycle,
  onAddLog,
  targetScrollTenantId,
  onShowToast,
  onNavigateToLineConfig,
  userRole,
}) => {
  const [lineFilterTab, setLineFilterTab] = useState<'all' | 'unsent' | 'sent' | 'unpaid'>('unsent');
  const [selectedTenantIdsForLine, setSelectedTenantIdsForLine] = useState<string[]>([]);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const [lineToastSuccess, setLineToastSuccess] = useState<string | null>(null);
  const [lineStatus, setLineStatus] = useState<{ connected: boolean; isReady: boolean } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dormId = dormitoryId || (typeof window !== 'undefined' ? (localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session')) : '') || '';
    if (!dormId) return;

    fetch(`/api/v1/dormitories/${dormId}/line-oa`, {
      headers: { 'Content-Type': 'application/json' },
    })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        if (json?.data || json?.config) {
          const data = json.data || json.config;
          setLineStatus({
            connected: Boolean(data.connected),
            isReady: Boolean(data.isReady)
          });
        } else {
          setLineStatus({ connected: false, isReady: false });
        }
      })
      .catch(() => setLineStatus({ connected: false, isReady: false }));
  }, [isOpen, dormitoryId]);

  // In-session delivery notification status map (server-authoritative; no fake localstorage financial state)
  const [lineNotifyMap, setLineNotifyMap] = useState<{ [key: string]: { status: 'sent' | 'resent'; sentAt: string } }>({});

  // Compute cycle bills from ONLY real persisted issued bills for selectedCycle (excluding draft or cancelled)
  const cycleBillsMap = new Map<string, Bill>();

  let realIssuedBills = (bills || []).filter(b => {
    const billCycleCode = (b as any).billingCycle?.cycleCode || (b as any).cycleCode;
    const isCycleMatch = !selectedCycle ||
      b.cycleId === selectedCycle ||
      (b as any).billingCycleId === selectedCycle ||
      billCycleCode === selectedCycle;
    return isCycleMatch && b.status !== 'draft' && b.status !== 'cancelled';
  });

  if (realIssuedBills.length === 0) {
    realIssuedBills = (bills || []).filter(b => b.status !== 'draft' && b.status !== 'cancelled' && b.status !== 'paid');
  }

  realIssuedBills.forEach(bill => {
    // Only unpaid / pending / overdue / checking / paid bills that actually exist
    if (bill.status !== 'paid') {
      const tid = bill.tenantId || '';
      if (tid) {
        cycleBillsMap.set(tid, bill);
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

  const handleSendLineNotifications = async () => {
    if (selectedTenantIdsForLine.length === 0 || isSendingLine) return;

    if (userRole === 'staff') {
      const staffMsg = 'พนักงานทั่วไปไม่มีสิทธิ์ส่งแจ้งเตือนบิลผ่าน LINE';
      if (onShowToast) onShowToast(staffMsg);
      else setLineToastSuccess(staffMsg);
      return;
    }

    setIsSendingLine(true);

    try {
      const dormId = dormitoryId || (typeof window !== 'undefined' ? (localStorage.getItem('selected_dormitory_id') || sessionStorage.getItem('active_dormitory_selected_for_session')) : '') || '';
      const csrf = getCsrfTokenFromCookie();

      const response = await fetch('/api/v1/bills/send-line-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(dormId ? { 'X-Dormitory-Id': dormId } : {}),
        },
        body: JSON.stringify({
          cycleId: selectedCycle,
          tenantIds: selectedTenantIdsForLine,
        }),
      });

      const json = await response.json().catch(() => null);

      if (response.ok && json?.data) {
        const { sentCount = 0, unboundCount = 0, warning, results = [] } = json.data;
        const nowStr = formatThaiDate(new Date().toISOString(), true);

        const newMap = { ...lineNotifyMap };
        results.forEach((r: any) => {
          if (r.status === 'SENT') {
            const key = `${selectedCycle}_${r.tenantId}`;
            newMap[key] = {
              status: newMap[key] ? 'resent' : 'sent',
              sentAt: nowStr,
            };
          }
        });
        setLineNotifyMap(newMap);

        let msg = '';
        if (sentCount > 0 && unboundCount === 0) {
          msg = `ส่งแจ้งเตือนผ่าน LINE เรียบร้อยแล้ว (${sentCount} ห้อง)`;
        } else if (sentCount > 0 && unboundCount > 0) {
          msg = `ส่งแจ้งเตือนผ่าน LINE สำเร็จ ${sentCount} ห้อง (ไม่ได้ส่ง ${unboundCount} ห้องเนื่องจากยังไม่ผูก LINE)`;
        } else if (sentCount === 0 && unboundCount > 0) {
          msg = `ไม่ได้ส่งแจ้งเตือน เนื่องจากผู้เช่าที่เลือก (${unboundCount} ห้อง) ยังไม่ได้ผูกบัญชี LINE`;
        } else if (sentCount === 0 && warning) {
          msg = warning;
        } else {
          msg = `ดำเนินการเรียบร้อยแล้ว`;
        }

        if (warning && sentCount > 0) {
          msg += ` (${warning})`;
        }

        if (onShowToast) {
          onShowToast(msg);
        } else {
          setLineToastSuccess(msg);
        }

        setSelectedTenantIdsForLine([]);

        onAddLog?.(
          'ส่งแจ้งเตือนผ่าน LINE',
          `ส่งข้อความแจ้งเตือนบิลยอดชำระประจำงวด ${selectedCycle} ผ่าน LINE: สำเร็จ ${sentCount} ห้อง, ไม่ผูก LINE ${unboundCount} ห้อง`,
          'Bill',
          selectedCycle
        );

        onClose();
      } else {
        const errorMsg = json?.error?.message || (response.status === 403 ? 'เจ้าหน้าที่ไม่มีสิทธิ์ส่งแจ้งเตือนบิลผ่าน LINE' : 'เกิดข้อผิดพลาดในการส่งแจ้งเตือนผ่าน LINE');
        if (onShowToast) {
          onShowToast(errorMsg);
        } else {
          setLineToastSuccess(errorMsg);
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
      if (onShowToast) {
        onShowToast(errMsg);
      } else {
        setLineToastSuccess(errMsg);
      }
    } finally {
      setIsSendingLine(false);
    }
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
            {lineStatus?.isReady ? (
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/80 font-bold text-xs rounded-full flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                พร้อมใช้งาน
              </span>
            ) : onNavigateToLineConfig ? (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigateToLineConfig();
                }}
                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100/80 text-amber-800 border border-amber-200/80 font-bold text-xs rounded-full flex items-center gap-1 shadow-2xs cursor-pointer transition-colors"
                title="คลิกเพื่อไปตั้งค่า LINE OA"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                ยังไม่พร้อมใช้งาน
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200/80 font-bold text-xs rounded-full flex items-center gap-1 shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                ยังไม่พร้อมใช้งาน
              </span>
            )}
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
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${lineFilterTab === 'all' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
                  }`}
              >
                ทั้งหมด ({sortedCycleBills.length})
              </button>
              <button
                type="button"
                onClick={() => setLineFilterTab('unsent')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${lineFilterTab === 'unsent' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
                  }`}
              >
                ยังไม่ได้ส่ง ({sortedCycleBills.filter(b => b.status !== 'paid' && !lineNotifyMap[`${selectedCycle}_${b.tenantId}`]).length})
              </button>
              <button
                type="button"
                onClick={() => setLineFilterTab('sent')}
                className={`px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-[12px] sm:text-xs font-black transition-all cursor-pointer whitespace-nowrap ${lineFilterTab === 'sent' ? 'bg-white text-[#06C755] shadow-2xs' : 'text-slate-600 hover:text-slate-900 font-extrabold'
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

            if (!lineStatus?.isReady) {
              return (
                <div className="py-10 px-4 text-center bg-amber-50/70 rounded-2xl border border-dashed border-amber-300/80 space-y-3 my-2 animate-in fade-in duration-300">
                  <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center mx-auto shadow-2xs">
                    <AlertCircle className="w-6 h-6 shrink-0" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-extrabold text-amber-900 text-sm">ยังไม่ได้เชื่อมต่อ LINE Official Account</p>
                    <p className="text-[11px] text-amber-700/90 max-w-sm mx-auto">
                      กรุณาเชื่อมต่อ LINE OA เพื่อเปิดใช้งานระบบส่งแจ้งเตือนอัตโนมัติถึงผู้เช่า
                    </p>
                  </div>
                  {onNavigateToLineConfig && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onNavigateToLineConfig();
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl shadow-xs hover:shadow-sm transition-all cursor-pointer active:scale-95"
                      >
                        <Settings className="w-4 h-4 shrink-0" />
                        <span>ไปตั้งค่า LINE OA</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            }

            if (modalFilteredBills.length === 0) {
              return (
                <div className="py-12 px-4 text-center bg-white rounded-2xl border border-dashed border-slate-200 space-y-2 my-2 animate-in fade-in duration-300">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto opacity-70" />
                  <p className="font-bold text-slate-700 text-xs">ไม่มีรายการบิลในหมวดหมู่นี้</p>
                  <p className="text-[11px] text-slate-400">ส่งแจ้งเตือนครบทุกห้องในหมวดหมู่นี้แล้ว หรือไม่พบรายการบิลที่ออกแล้วในงวดนี้</p>
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
                  className={`p-2.5 sm:p-3 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-2 sm:gap-3 animate-in fade-in ${isTargetScrolled ? 'ring-2 ring-emerald-500 border-emerald-400' : ''
                    } ${isChecked
                      ? 'bg-emerald-50/80 border-emerald-300 shadow-2xs'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all shrink-0 ${isChecked ? 'bg-[#06C755] border-[#06C755] text-white' : 'border-slate-300 bg-white'
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

        {/* Staff Permission Warning */}
        {userRole === 'staff' && (
          <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl flex items-center gap-2 font-bold shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>เจ้าหน้าที่ไม่มีสิทธิ์ส่งแจ้งเตือนบิลผ่าน LINE (สิทธิ์เฉพาะเจ้าของหอพักและผู้จัดการ)</span>
          </div>
        )}

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
              disabled={selectedTenantIdsForLine.length === 0 || isSendingLine || userRole === 'staff'}
              title={userRole === 'staff' ? 'เจ้าหน้าที่ไม่มีสิทธิ์ส่งแจ้งเตือนบิลผ่าน LINE (เฉพาะเจ้าของหรือผู้จัดการ)' : undefined}
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
                  <LineLogo className="w-3.5 h-3.5 shrink-0 rounded-xs" />
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
