/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  FileCheck2,
  Check,
  X,
  Printer,
  Calendar,
  DollarSign,
  AlertCircle,
  Eye,
  CreditCard,
  Building,
  Search,
  User,
  ChevronLeft,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  Send,
  CheckCircle2,
  RotateCw,
  Users,
  BellRing,
  MessageSquare,
  LayoutGrid,
  List,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  StatusBadge,
  formatBaht,
  formatBahtDash,
  formatThaiDate,
  Modal,
  PrintView
} from '../../components/GlobalComponents';
import { Bill, Tenant, Room, Receipt, formatItemDescription, BillItem } from '../../types';
import { generateMockSlipImage, getDormitory, getDormitoryRatesForCycle } from '../../data/mockData';
import { LineNotificationModal, LineIcon } from '../../components/LineNotificationModal';
import { calculateBillLateFee, getBillEffectiveItems, getEffectiveBillTotal, getBillOverdueDays } from '../../utils/lateFeeUtils';

interface OwnerPaymentsProps {
  bills: Bill[];
  tenants: Tenant[];
  rooms: Room[];
  onSaveBills: (bills: Bill[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  selectedCycle: string;
}

export const OwnerPayments: React.FC<OwnerPaymentsProps> = ({
  bills,
  tenants,
  rooms,
  onSaveBills,
  onAddLog,
  selectedCycle
}) => {
  const [activeTab, setActiveTab] = useState<'paid' | 'checking' | 'cash' | 'rejected'>(() => {
    const saved = localStorage.getItem('payments_active_tab');
    if (saved === 'cash' || saved === 'checking' || saved === 'paid' || saved === 'rejected') {
      return saved;
    }
    return 'cash';
  });

  useEffect(() => {
    const saved = localStorage.getItem('payments_active_tab');
    if (saved === 'cash' || saved === 'checking' || saved === 'paid' || saved === 'rejected') {
      setActiveTab(saved as any);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('payments_active_tab', activeTab);
  }, [activeTab]);

  const [displayMode, setDisplayMode] = useState<'grid' | 'table'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const currentDorm = getDormitory();

  const getBillTotalAmount = (b: Bill): number => {
    return getEffectiveBillTotal(b, currentDorm);
  };

  // Rejection state
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้');
  const [rejectNote, setRejectNote] = useState('');

  // Cash state
  const [isCashOpen, setIsCashOpen] = useState(false);
  const [cashBillId, setCashBillId] = useState('');
  const [cashReceivedDate, setCashReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashReceivedBy, setCashReceivedBy] = useState('ดวงใจ นวลแก้ว');

  // New Cash tab state
  const [selectedCashBill, setSelectedCashBill] = useState<Bill | null>(null);
  const [cashSearchQuery, setCashSearchQuery] = useState('');

  // Synchronized ref for latest bills to support concurrent async updates
  const billsRef = useRef<Bill[]>(bills);
  useEffect(() => {
    billsRef.current = bills;
  }, [bills]);

  // Pending cash payment countdown state (Map of billId -> remaining seconds, supports multiple rooms simultaneously)
  const [pendingCashMap, setPendingCashMap] = useState<Record<string, number>>({});
  const cashTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Pending approve slip countdown state (Map of billId -> remaining seconds, supports multiple rooms simultaneously)
  const [pendingApproveMap, setPendingApproveMap] = useState<Record<string, number>>({});
  const approveTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      Object.keys(cashTimersRef.current).forEach(id => {
        clearInterval(cashTimersRef.current[id]);
      });
      Object.keys(approveTimersRef.current).forEach(id => {
        clearInterval(approveTimersRef.current[id]);
      });
    };
  }, []);

  // Target tenant ID to scroll to when opening LINE modal
  const [targetScrollTenantId, setTargetScrollTenantId] = useState<string | null>(null);

  // Receipt modal state
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [viewingReceipt, setViewingReceipt] = useState<Receipt | null>(null);

  // Cash success toast notification state
  const [cashSuccessToast, setCashSuccessToast] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  useEffect(() => {
    if (cashSuccessToast) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setCashSuccessToast(null);
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [cashSuccessToast]);

  // Big slip viewer modal
  const [viewingSlipImage, setViewingSlipImage] = useState<string | null>(null);

  /* =========================================================================
   * SaaS LINE / Messaging API Notification State & Logic (For AI & Devs)
   * =========================================================================
   * lineNotifyMap tracks LINE notification history per tenant per cycle:
   * Key: `${cycleId}_${tenantId}`
   * Value: { status: 'sent' | 'resent', sentAt: string }
   * ========================================================================= */
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [lineSearchQuery, setLineSearchQuery] = useState('');
  const [lineFilterTab, setLineFilterTab] = useState<'all' | 'unsent' | 'sent' | 'unpaid'>('unsent');
  const [selectedTenantIdsForLine, setSelectedTenantIdsForLine] = useState<string[]>([]);
  const [isSendingLine, setIsSendingLine] = useState(false);
  const [lineToastSuccess, setLineToastSuccess] = useState<string | null>(null);
  const [expandedBillIds, setExpandedBillIds] = useState<string[]>([]);
  const hasInitializedLineSelection = useRef(false);

  const toggleBillExpand = (billId: string) => {
    setExpandedBillIds(prev =>
      prev.includes(billId) ? prev.filter(id => id !== billId) : [...prev, billId]
    );
  };

  // Auto scroll to target room card when opening LINE modal
  useEffect(() => {
    if (isLineModalOpen && targetScrollTenantId) {
      const timer = setTimeout(() => {
        const el = document.getElementById(`line-tenant-${targetScrollTenantId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isLineModalOpen, targetScrollTenantId]);

  // Persistent line notify statuses map
  const [lineNotifyMap, setLineNotifyMap] = useState<{ [key: string]: { status: 'sent' | 'resent'; sentAt: string } }>(() => {
    try {
      const saved = localStorage.getItem('HorPlus_line_notify_map');
      if (saved) return JSON.parse(saved);
    } catch { }
    return {
      [`2026-07_tenant-1`]: { status: 'sent', sentAt: '14 ก.ค. 2569 - 10:30 น.' },
      [`2026-07_tenant-2`]: { status: 'sent', sentAt: '14 ก.ค. 2569 - 10:32 น.' },
    };
  });

  useEffect(() => {
    localStorage.setItem('HorPlus_line_notify_map', JSON.stringify(lineNotifyMap));
  }, [lineNotifyMap]);

  const getWaterUnits = (bill: Bill) => {
    const item = bill.items.find(i => i.category === 'water');
    if (!item) return 0;
    const match = item.description.match(/(\d+)\s*หน่วย/);
    return match ? parseInt(match[1]) : 12; // default 12
  };

  const getElecUnits = (bill: Bill) => {
    const item = bill.items.find(i => i.category === 'electricity');
    if (!item) return 0;
    const match = item.description.match(/(\d+)\s*หน่วย/);
    return match ? parseInt(match[1]) : 85; // default 85
  };

  const handleConfirmCashPayment = (bill: Bill, overdueAmount: number) => {
    const currentBills = billsRef.current;
    const effectiveItems = getBillEffectiveItems(bill, currentDorm);
    const billTotal = getEffectiveBillTotal(bill, currentDorm);

    // 1. Mark this bill as paid with effective items and total amount
    const updated = currentBills.map(b => b.id === bill.id ? {
      ...b,
      items: effectiveItems,
      totalAmount: billTotal,
      status: 'paid' as const,
      paymentMethod: 'cash' as const,
      paidAt: new Date().toISOString()
    } : b);

    // 2. Clear other overdue bills for the same tenant too
    const clearedOverdue = updated.map(b => (b.tenantId === bill.tenantId && b.status === 'overdue') ? {
      ...b,
      items: getBillEffectiveItems(b, currentDorm),
      totalAmount: getEffectiveBillTotal(b, currentDorm),
      status: 'paid' as const,
      paymentMethod: 'cash' as const,
      paidAt: new Date().toISOString()
    } : b);

    billsRef.current = clearedOverdue;
    onSaveBills(clearedOverdue);
    onAddLog('รับชำระด้วยเงินสด', `รับชำระเงินสดจำนวน ${formatBaht(billTotal + overdueAmount)} จากห้อง ${getRoomNum(bill.roomId)} ณ เคาน์เตอร์ (หักล้างยอดค้างสะสมเรียบร้อย)`, 'Bill', bill.id);

    // Instead of opening receipt modal, show toast + fade notification
    const roomNum = getRoomNum(bill.roomId);
    const amountStr = formatBaht(billTotal + overdueAmount);
    setCashSuccessToast(`บันทึกการรับเงินสด ห้อง ${roomNum} (${amountStr}) เรียบร้อยแล้ว`);
    setSelectedCashBill(prev => (prev?.id === bill.id ? null : prev));

    setTimeout(() => {
      setCashSuccessToast(null);
    }, 3500);
  };

  const startCashPaymentWithCountdown = (bill: Bill, overdueAmount: number = 0) => {
    // If a timer already exists for this bill, clear it before restarting
    if (cashTimersRef.current[bill.id]) {
      clearInterval(cashTimersRef.current[bill.id]);
      delete cashTimersRef.current[bill.id];
    }

    setPendingCashMap(prev => ({ ...prev, [bill.id]: 5 }));

    let currentCount = 5;
    const timer = setInterval(() => {
      currentCount -= 1;
      if (currentCount <= 0) {
        if (cashTimersRef.current[bill.id]) {
          clearInterval(cashTimersRef.current[bill.id]);
          delete cashTimersRef.current[bill.id];
        }
        setPendingCashMap(prev => {
          const next = { ...prev };
          delete next[bill.id];
          return next;
        });
        handleConfirmCashPayment(bill, overdueAmount);
      } else {
        setPendingCashMap(prev => ({ ...prev, [bill.id]: currentCount }));
      }
    }, 1000);

    cashTimersRef.current[bill.id] = timer;
  };

  const cancelPendingCashPayment = (billId: string) => {
    if (cashTimersRef.current[billId]) {
      clearInterval(cashTimersRef.current[billId]);
      delete cashTimersRef.current[billId];
    }
    setPendingCashMap(prev => {
      const next = { ...prev };
      delete next[billId];
      return next;
    });
  };

  const startApproveWithCountdown = (bill: Bill) => {
    if (approveTimersRef.current[bill.id]) {
      clearInterval(approveTimersRef.current[bill.id]);
      delete approveTimersRef.current[bill.id];
    }

    setPendingApproveMap(prev => ({ ...prev, [bill.id]: 5 }));

    let currentCount = 5;
    const timer = setInterval(() => {
      currentCount -= 1;
      if (currentCount <= 0) {
        if (approveTimersRef.current[bill.id]) {
          clearInterval(approveTimersRef.current[bill.id]);
          delete approveTimersRef.current[bill.id];
        }
        setPendingApproveMap(prev => {
          const next = { ...prev };
          delete next[bill.id];
          return next;
        });
        handleApproveSlip(bill);
      } else {
        setPendingApproveMap(prev => ({ ...prev, [bill.id]: currentCount }));
      }
    }, 1000);

    approveTimersRef.current[bill.id] = timer;
  };

  const cancelPendingApprove = (billId: string) => {
    if (approveTimersRef.current[billId]) {
      clearInterval(approveTimersRef.current[billId]);
      delete approveTimersRef.current[billId];
    }
    setPendingApproveMap(prev => {
      const next = { ...prev };
      delete next[billId];
      return next;
    });
  };

  const handleOpenLineModalForTenant = (tenantId: string) => {
    setSelectedTenantIdsForLine([tenantId]);
    setTargetScrollTenantId(tenantId);
    setLineFilterTab('all');
    setIsLineModalOpen(true);
  };

  const formatCycleThaiShort = (cycleStr: string) => {
    if (!cycleStr) return '';
    const parts = cycleStr.split('-');
    if (parts.length === 2) {
      const yearCE = parseInt(parts[0], 10);
      const yearBE = yearCE + 543;
      const shortBE = yearBE.toString().slice(-2);
      const monthIdx = parseInt(parts[1], 10) - 1;
      const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
      if (monthIdx >= 0 && monthIdx < 12) {
        return `${months[monthIdx]} ${shortBE}`;
      }
    }
    return cycleStr;
  };

  const getTenantName = (tId: string) => tenants.find(t => t.id === tId)?.name || 'ผู้เช่า';
  const getRoomNum = (rId: string) => rooms.find(r => r.id === rId)?.roomNumber || 'ไม่ระบุ';

  const filterByQuery = (billList: Bill[]) => {
    if (!searchQuery?.trim()) return billList;
    const q = (searchQuery || '').toLowerCase().trim();
    return billList.filter(b => {
      const roomNum = (getRoomNum(b.roomId) || '').toLowerCase();
      const tenantName = (getTenantName(b.tenantId) || '').toLowerCase();
      return roomNum.includes(q) || tenantName.includes(q);
    });
  };

  // Filters based on tabs and selectedCycle (Sorted descending latest first)
  const sortedCycleBills = [...bills]
    .filter(b => b.cycleId === selectedCycle)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const checkingBills = sortedCycleBills.filter(b => b.status === 'checking');
  const paidBills = sortedCycleBills.filter(b => b.status === 'paid');
  const rejectedBills = sortedCycleBills.filter(b => b.status === 'rejected');
  const cashPendingBills = [...sortedCycleBills]
    .filter(b => b.status === 'pending' || b.status === 'overdue' || b.status === 'rejected')
    .sort((a, b) => {
      const roomA = getRoomNum(a.roomId);
      const roomB = getRoomNum(b.roomId);
      return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
    });

  const handleApproveSlip = (bill: Bill) => {
    const currentBills = billsRef.current;
    const effectiveItems = getBillEffectiveItems(bill, currentDorm);
    const billTotal = getEffectiveBillTotal(bill, currentDorm);

    const updated = currentBills.map(b => b.id === bill.id ? {
      ...b,
      items: effectiveItems,
      totalAmount: billTotal,
      status: 'paid' as const,
      paymentMethod: 'promptpay' as const,
      paidAt: new Date().toISOString()
    } : b);

    billsRef.current = updated;
    onSaveBills(updated);
    onAddLog('อนุมัติสลิปโอนเงิน', `ยืนยันตรวจความถูกต้องสลิปและปรับปรุงสถานะห้อง ${getRoomNum(bill.roomId)} ชำระแล้ว`, 'Bill', bill.id);
    setSelectedBill(prev => (prev?.id === bill.id ? null : prev));

    const roomNum = getRoomNum(bill.roomId);
    setCashSuccessToast(`อนุมัติสลิปโอนเงิน ห้อง ${roomNum} เรียบร้อยแล้ว`);
    setTimeout(() => {
      setCashSuccessToast(null);
    }, 3500);
  };

  const handleRejectSlip = () => {
    if (!selectedBill) return;

    const currentBills = billsRef.current;
    const reasonText = rejectReason === 'อื่นๆ' ? rejectNote : rejectReason;

    const updated = currentBills.map(b => b.id === selectedBill.id ? {
      ...b,
      status: 'rejected' as const,
      rejectReason: reasonText
    } : b);

    billsRef.current = updated;
    onSaveBills(updated);
    onAddLog('ปฏิเสธสลิปโอนเงิน', `ปฏิเสธสลิปเนื่องจาก: ${reasonText} ห้อง ${getRoomNum(selectedBill.roomId)}`, 'Bill', selectedBill.id);
    const roomNum = getRoomNum(selectedBill.roomId);
    setIsRejectOpen(false);
    setSelectedBill(null);

    setCashSuccessToast(`ปฏิเสธสลิปโอนเงิน ห้อง ${roomNum} เรียบร้อยแล้ว`);
    setTimeout(() => {
      setCashSuccessToast(null);
    }, 3500);
  };

  const handleRecordCash = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashBillId) return;

    const targetBill = bills.find(b => b.id === cashBillId);
    if (!targetBill) return;

    const updated = bills.map(b => b.id === cashBillId ? {
      ...b,
      status: 'paid' as const,
      paymentMethod: 'cash' as const,
      paidAt: new Date(cashReceivedDate).toISOString()
    } : b);

    onSaveBills(updated);
    onAddLog('รับชำระด้วยเงินสด', `นิติหอรับชำระเงินสดจำนวน ${formatBaht(targetBill.totalAmount)} จากห้อง ${getRoomNum(targetBill.roomId)}`, 'Bill', cashBillId);

    // Generate simulated Receipt object for view
    const newReceipt: Receipt = {
      id: `rcpt-${Date.now()}`,
      receiptNumber: `RCPT-${selectedCycle.replace('-', '')}-${getRoomNum(targetBill.roomId)}`,
      billId: targetBill.id,
      paymentId: `pay-${Date.now()}`,
      paymentMethod: 'cash',
      totalAmount: targetBill.totalAmount,
      paidAt: cashReceivedDate,
      receiverName: cashReceivedBy,
      createdAt: new Date().toISOString()
    };

    setViewingReceipt(newReceipt);
    setIsCashOpen(false);
    setIsReceiptOpen(true);
  };

  const handleOpenReceipt = (bill: Bill) => {
    const rcpt: Receipt = {
      id: `rcpt-${bill.id}`,
      receiptNumber: `RCPT-${bill.cycleId.replace('-', '')}-${getRoomNum(bill.roomId)}`,
      billId: bill.id,
      paymentId: `pay-${bill.id}`,
      paymentMethod: bill.paymentMethod || 'promptpay',
      totalAmount: bill.totalAmount,
      paidAt: bill.paidAt || new Date().toISOString(),
      receiverName: 'ฝ่ายการเงิน หอพัก HorPlus',
      createdAt: new Date().toISOString()
    };
    setViewingReceipt(rcpt);
    setIsReceiptOpen(true);
  };

  /* =========================================================================
   * LINE Notification Handler Functions
   * ========================================================================= */
  const handleOpenLineModal = () => {
    setTargetScrollTenantId(null);
    const unsentTenantIds = sortedCycleBills
      .filter(b => b.status !== 'paid' && !lineNotifyMap[`${selectedCycle}_${b.tenantId}`])
      .map(b => b.tenantId);

    if (unsentTenantIds.length > 0) {
      setSelectedTenantIdsForLine(unsentTenantIds);
      setLineFilterTab('unsent');
    } else {
      setSelectedTenantIdsForLine([]);
      setLineFilterTab('all');
    }
    setIsLineModalOpen(true);
  };

  const handleSendLineNotifications = () => {
    if (selectedTenantIdsForLine.length === 0) return;

    setIsSendingLine(true);

    setTimeout(() => {
      const nowStr = `${new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} - ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.`;

      const newMap = { ...lineNotifyMap };
      let newSentCount = 0;
      let resentCount = 0;

      // Automatically update status for rooms with 'draft' (ยังไม่ออกบิล) status to 'pending' (รอชำระเงิน)
      // DO NOT touch rooms with 'paid' (ชำระแล้ว) status
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
        const room = rooms.find(r => r.id === tenant?.roomId || r.roomNumber === tenant?.roomNumber);
        const existingBillIdx = updatedBills.findIndex(
          b => b.cycleId === selectedCycle && (b.tenantId === tenantId || (room && b.roomId === room.id))
        );

        if (existingBillIdx >= 0) {
          const existingBill = updatedBills[existingBillIdx];
          // Only update if bill status is 'draft' (ยังไม่ออกบิล). Never alter 'paid' bills!
          if (existingBill.status === 'draft') {
            updatedBills[existingBillIdx] = {
              ...existingBill,
              status: 'pending',
              updatedAt: new Date().toISOString()
            };
            billsModified = true;
          }
        } else if (tenant && room) {
          // If no bill record exists yet for this room in selectedCycle, construct one with status = 'pending'
          const newBillId = `bill-${selectedCycle}-${room.id}`;
          const roomRent = room.monthlyRent || 3500;
          const dorm = getDormitory();
          const rates = getDormitoryRatesForCycle(dorm, selectedCycle);

          const items: BillItem[] = [
            { id: `rent-${newBillId}`, description: `ค่าเช่าห้อง ${room.roomNumber}`, amount: roomRent, category: 'rent' }
          ];

          if (rates.parkingFeeMode !== 'free') {
            let parkingFeeAmt = 0;
            let parkingDesc = 'ค่าที่จอดรถ';

            if (rates.parkingFeeMode === 'vehicle') {
              if (tenant.vehicle && tenant.vehicle.type && tenant.vehicle.type !== 'none') {
                parkingFeeAmt = rates.parkingFee || room.parkingFee || 100;
                const vType = tenant.vehicle.type === 'car' ? 'รถยนต์' : tenant.vehicle.type === 'motorcycle' ? 'รถจักรยานยนต์' : 'ยานพาหนะ';
                parkingDesc = `ค่าที่จอดรถ${vType}${tenant.vehicle.licensePlate ? ` (${tenant.vehicle.licensePlate})` : ''}`;
              }
            } else {
              parkingFeeAmt = rates.parkingFee || room.parkingFee || 100;
            }

            if (parkingFeeAmt > 0) {
              items.push({
                id: `parking-${newBillId}`,
                description: parkingDesc,
                amount: parkingFeeAmt,
                category: 'parking'
              });
            }
          }

          const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

          const newBill: Bill = {
            id: newBillId,
            billNumber: `BILL-${selectedCycle.replace('-', '')}-${room.roomNumber}`,
            cycleId: selectedCycle,
            roomId: room.id,
            tenantId: tenant.id,
            items,
            totalAmount,
            dueDate: `${selectedCycle}-05`,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newBill);
          billsModified = true;
        }
      });

      if (billsModified) {
        onSaveBills(updatedBills);
      }

      setLineNotifyMap(newMap);
      setIsSendingLine(false);

      const count = selectedTenantIdsForLine.length;
      const msg = `ส่งแจ้งเตือนผ่าน LINE สำเร็จแล้ว (${count} ห้อง - ส่งใหม่ ${newSentCount} / ส่งซ้ำ ${resentCount})`;
      setLineToastSuccess(msg);

      // Unselect sent items so the counter resets (Requirement 7)
      setSelectedTenantIdsForLine([]);

      onAddLog(
        'ส่งแจ้งเตือนผ่าน LINE',
        `ส่งข้อความแจ้งเตือนบิลยอดชำระประจำงวด ${selectedCycle} ผ่าน LINE ให้แก่ ${count} รายการเรียบร้อยแล้ว`,
        'Bill',
        selectedCycle
      );

      setTimeout(() => {
        setLineToastSuccess(null);
      }, 4000);
    }, 800);
  };

  return (
    <div className="space-y-6">
      {/* Floating Cash Payment Success Toast Portal (Mobile: Centered above bottom nav, White bg, Smooth Fade) */}
      {cashSuccessToast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{cashSuccessToast}</span>
        </div>
      )}

      {/* Filter Tabs & Quick Action Row */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs space-y-4 shrink-0">
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full lg:w-auto flex-1 max-w-3xl">
            <button
              type="button"
              onClick={() => { setActiveTab('paid'); setSelectedBill(null); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeTab === 'paid'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="truncate">ชำระแล้ว ({paidBills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('checking'); setSelectedBill(null); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeTab === 'checking'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Clock className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <span className="truncate">รอตรวจสลิป ({checkingBills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('cash'); setSelectedBill(null); setSelectedCashBill(null); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeTab === 'cash'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="truncate">ยังไม่ชำระ ({cashPendingBills.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('rejected'); setSelectedBill(null); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeTab === 'rejected'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="truncate">สลิปผิดพลาด ({rejectedBills.length})</span>
            </button>
          </div>

          {(() => {
            const unsentCount = sortedCycleBills.filter(b => b.status !== 'paid' && !lineNotifyMap[`${selectedCycle}_${b.tenantId}`]).length;
            const hasUnsentLineBills = unsentCount > 0;

            return (
              <button
                onClick={handleOpenLineModal}
                className="px-4 sm:px-5 py-2.5 sm:py-3 bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer w-full lg:w-auto shrink-0 whitespace-nowrap relative"
              >
                <LineIcon className="w-4 h-4 shrink-0" />
                <span className="whitespace-nowrap">แจ้งเตือนผ่าน LINE</span>
                {hasUnsentLineBills && (
                  <span className="w-3 h-3 bg-rose-500 rounded-full border-2 border-white absolute -top-1 -right-1 animate-pulse shadow-xs" />
                )}
              </button>
            );
          })()}
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="relative w-full">
            <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-slate-50/50 text-slate-800 font-semibold"
            />
          </div>
        </div>
      </div>

      {/* =========================================================================
       * TAB 1: ชำระแล้ว (Paid Tab - Card Grid Only)
       * ========================================================================= */}
      {activeTab === 'paid' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filterByQuery(paidBills).map(b => {
              const tenantName = getTenantName(b.tenantId);
              const roomNum = getRoomNum(b.roomId);
              const slipUrl = b.slipImage || generateMockSlipImage(tenantName, b.totalAmount, roomNum, b.paidAt ? formatThaiDate(b.paidAt) : '14 ก.ค. 2569');

              return (
                <div key={b.id} className="bg-white rounded-3xl border border-emerald-100 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ชำระผ่านแล้ว
                    </span>
                  </div>

                  <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {tenantName}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50">
                      <span>ช่องทาง: <strong className="text-slate-700">{b.paymentMethod === 'cash' ? 'เงินสด' : 'แนปสลิป'}</strong></span>
                      <span>{b.paidAt ? formatThaiDate(b.paidAt) : 'ชำระแล้ว'}</span>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <span className="text-xs text-slate-400 font-bold">ยอดชำระสำเร็จ</span>
                    <span className="text-lg font-black text-emerald-600">{formatBaht(b.totalAmount)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setViewingSlipImage(slipUrl)}
                      className="py-2.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200/60"
                    >
                      <Eye className="w-4 h-4 text-indigo-600" />
                      ดูสลิป
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenReceipt(b)}
                      className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                    >
                      <Printer className="w-4 h-4" />
                      ใบเสร็จรับเงิน
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {filterByQuery(paidBills).length === 0 && (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
              ไม่พบบิลที่ชำระแล้วตามเงื่อนไขค้นหา
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
       * TAB 2: รอตรวจสลิป (Checking Slips Tab)
       * ========================================================================= */}
      {activeTab === 'checking' && (
        displayMode === 'grid' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filterByQuery(checkingBills).map(b => {
                const tenantName = getTenantName(b.tenantId);
                const roomNum = getRoomNum(b.roomId);
                const slipUrl = b.slipImage || generateMockSlipImage(tenantName, b.totalAmount, roomNum, '14 ก.ค. 2569 - 09:15 น.');

                return (
                  <div key={b.id} className="bg-white rounded-3xl border border-amber-200 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                      <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 font-extrabold rounded-full text-[11px] flex items-center gap-1 animate-pulse">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        รอตรวจสลิป
                      </span>
                    </div>

                    <div className="text-xs">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {tenantName}
                      </p>
                    </div>

                    <div
                      onClick={() => setViewingSlipImage(slipUrl)}
                      className="relative bg-slate-50 border border-slate-200 rounded-2xl h-36 flex items-center justify-center p-2 cursor-pointer hover:border-indigo-400 transition-all group overflow-hidden"
                    >
                      <img
                        src={slipUrl}
                        alt="สลิปโอนเงิน"
                        className="max-h-full max-w-full object-contain rounded-xl group-hover:scale-105 transition-transform"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold rounded-2xl">
                        <Eye className="w-4 h-4" />
                        ดูรายละเอียด
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-400 font-bold">ยอดรอตรวจสอบ</span>
                      <span className="text-lg font-black text-indigo-600">{formatBaht(b.totalAmount)}</span>
                    </div>

                    {pendingApproveMap[b.id] !== undefined ? (
                      <div className="bg-amber-50 border border-amber-300 p-2.5 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs animate-in fade-in">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          <span>กำลังอนุมัติ ({pendingApproveMap[b.id]}s)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelPendingApprove(b.id)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer shrink-0 flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" />
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBill(b);
                            setIsRejectOpen(true);
                          }}
                          className="py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer border border-rose-200/60"
                        >
                          <X className="w-4 h-4 text-rose-600" />
                          ปฏิเสธ
                        </button>
                        <button
                          type="button"
                          onClick={() => startApproveWithCountdown(b)}
                          className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          ยอมรับ
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {filterByQuery(checkingBills).length === 0 && (
              <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
                ไม่มีสลิปรอนุมัติในขณะนี้
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">
            <div className={`md:col-span-5 lg:col-span-4 bg-white p-4 rounded-3xl border border-gray-100 shadow-xs h-[550px] overflow-y-auto ${selectedBill ? 'hidden md:block' : 'block'}`}>
              <h4 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                <FileCheck2 className="w-4 h-4 text-indigo-600 animate-pulse" />
                ใบคำขอรอตรวจสอบยอด
              </h4>

              <div className="space-y-2">
                {filterByQuery(checkingBills).map(b => (
                  <div
                    key={b.id}
                    onClick={() => setSelectedBill(b)}
                    className={`p-3 rounded-2xl border cursor-pointer transition-all flex justify-between items-center gap-2 ${selectedBill?.id === b.id ? 'bg-indigo-50 border-indigo-150' : 'hover:bg-slate-50 border-gray-100'
                      }`}
                  >
                    <div>
                      <h5 className="font-extrabold text-xs text-slate-800">{getRoomNum(b.roomId)}</h5>
                      <p className="text-[10px] text-gray-400 mt-1">{getTenantName(b.tenantId)}</p>
                    </div>
                    <span className="font-bold text-indigo-600 text-xs">{formatBaht(b.totalAmount)}</span>
                  </div>
                ))}
                {filterByQuery(checkingBills).length === 0 && (
                  <p className="text-center py-12 text-xs text-gray-400">ไม่มีสลิปรอนุมัติในขณะนี้</p>
                )}
              </div>
            </div>

            {selectedBill && (
              <div className="block md:hidden bg-white p-5 rounded-3xl border border-gray-100 shadow-xs space-y-4">
                <div className="flex justify-between items-center">
                  <h4 className="text-xs font-extrabold text-slate-800">ตรวจสอบยอด {getRoomNum(selectedBill.roomId)}</h4>
                  <button
                    onClick={() => setSelectedBill(null)}
                    className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1.5 rounded-xl cursor-pointer"
                  >
                    ย้อนกลับ
                  </button>
                </div>

                <div
                  className="bg-slate-50 border border-gray-200 rounded-2xl flex items-center justify-center p-3 relative h-[320px] overflow-hidden cursor-pointer"
                  onClick={() => { if (selectedBill.slipImage) setViewingSlipImage(selectedBill.slipImage); }}
                >
                  {selectedBill.slipImage ? (
                    <img
                      src={selectedBill.slipImage}
                      alt="หลักฐานการชำระเงิน"
                      className="max-h-full max-w-full object-contain rounded-xl hover:scale-102 transition-all"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="bg-white w-full max-w-[180px] p-4 rounded-xl shadow-xs border border-emerald-100 text-[9px] text-center space-y-2 font-mono text-slate-600">
                      <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                      <p className="font-extrabold text-slate-900 leading-none">ทำรายการสำเร็จ</p>
                      <p className="text-[7px] text-gray-400">14 ก.ค. 2569</p>
                      <hr className="border-dashed border-gray-100" />
                      <div className="text-left space-y-1">
                        <p><span className="text-gray-400">ผู้โอน:</span> คุณ{getTenantName(selectedBill.tenantId)}</p>
                        <p><span className="text-gray-400">ผู้รับ:</span> หอพัก HorPlus</p>
                        <p><span className="text-gray-400">ยอดเงิน:</span> <span className="font-bold text-slate-900">{formatBaht(selectedBill.totalAmount)}</span></p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-1">
                  <p><span className="text-gray-400">ห้อง:</span> <span className="font-extrabold text-slate-800">{getRoomNum(selectedBill.roomId)}</span></p>
                  <p><span className="text-gray-400">ผู้เช่า:</span> <span className="font-semibold text-slate-700">{getTenantName(selectedBill.tenantId)}</span></p>
                  <p><span className="text-gray-400">ยอดบิล:</span> <span className="font-bold text-indigo-600">{formatBaht(selectedBill.totalAmount)}</span></p>
                </div>

                {pendingApproveMap[selectedBill.id] !== undefined ? (
                  <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs animate-in fade-in">
                    <div className="flex items-center gap-1.5 text-xs font-bold">
                      <RotateCw className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
                      <span>กำลังอนุมัติ ({pendingApproveMap[selectedBill.id]}s)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancelPendingApprove(selectedBill.id)}
                      className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer shrink-0 flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      ยกเลิก
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2.5 pt-2">
                    <button
                      onClick={() => setIsRejectOpen(true)}
                      className="flex-1 py-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      ปฏิเสธ
                    </button>
                    <button
                      onClick={() => startApproveWithCountdown(selectedBill)}
                      className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      ยอมรับ
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-7 lg:col-span-8 hidden md:block">
              {selectedBill ? (
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs h-[550px] flex flex-col justify-between">
                  <div className="grid md:grid-cols-2 gap-6 h-[400px]">
                    <div className="space-y-3 flex flex-col justify-between">
                      <span className="text-[10px] text-gray-400 font-bold uppercase">รูปภาพหลักฐานการโอน</span>
                      <div
                        className="flex-1 bg-slate-50 border border-gray-200 rounded-3xl flex flex-col items-center justify-center p-4 relative overflow-hidden cursor-pointer"
                        onClick={() => { if (selectedBill.slipImage) setViewingSlipImage(selectedBill.slipImage); }}
                      >
                        {selectedBill.slipImage ? (
                          <img
                            src={selectedBill.slipImage}
                            alt="หลักฐานการชำระเงิน"
                            className="max-h-full max-w-full object-contain rounded-2xl hover:scale-105 transition-all duration-200"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="bg-white w-full max-w-[200px] p-4 rounded-2xl shadow-sm border border-emerald-100 text-[10px] text-center space-y-2 font-mono text-slate-600">
                            <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-1">
                              <Check className="w-4 h-4" />
                            </div>
                            <p className="font-extrabold text-slate-900 leading-none">ทำรายการสำเร็จ</p>
                            <p className="text-[8px] text-gray-400">14 ก.ค. 2569 - 08:34</p>
                            <hr className="border-dashed border-gray-100" />
                            <div className="text-left space-y-1">
                              <p><span className="text-gray-400">ผู้โอน:</span> คุณ{getTenantName(selectedBill.tenantId)}</p>
                              <p><span className="text-gray-400">ผู้รับ:</span> หอพัก HorPlus</p>
                              <p><span className="text-gray-400">ยอดเงิน:</span> <span className="font-bold text-slate-900">{formatBaht(selectedBill.totalAmount)}</span></p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-4 flex flex-col justify-between py-2">
                      <div className="space-y-4">
                        <span className="text-[10px] text-gray-400 font-bold uppercase">รายละเอียดใบแจ้งยอด</span>
                        <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs space-y-2">
                          <p><span className="text-gray-400">ห้อง:</span> <span className="font-extrabold text-slate-800">{getRoomNum(selectedBill.roomId)}</span></p>
                          <p><span className="text-gray-400">บิลเลขที่:</span> <span className="font-semibold text-slate-800">{selectedBill.billNumber}</span></p>
                          <p><span className="text-gray-400">ยอดที่ต้องจ่าย:</span> <span className="font-bold text-indigo-600">{formatBaht(selectedBill.totalAmount)}</span></p>
                          <p><span className="text-gray-400">วันครบชำระ:</span> <span className="text-slate-600">{selectedBill.dueDate}</span></p>
                        </div>
                      </div>

                      <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-2xl text-[11px] text-blue-900 leading-relaxed">
                        * สามารถคลิกที่รูปภาพสลิปหลักฐานเพื่อเปิดดูขนาดเต็มได้เพื่อตรวจเช็คความถูกต้องของรหัสสลิป
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100 flex gap-3 justify-end items-center shrink-0">
                    {pendingApproveMap[selectedBill.id] !== undefined ? (
                      <div className="bg-amber-50 border border-amber-300 px-4 py-2 rounded-xl flex items-center gap-3 text-amber-900 shadow-2xs animate-in fade-in">
                        <div className="flex items-center gap-1.5 text-xs font-bold">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          <span>กำลังอนุมัติ ({pendingApproveMap[selectedBill.id]}s)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelPendingApprove(selectedBill.id)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" />
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setIsRejectOpen(true)}
                          className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                          ปฏิเสธหลักฐาน
                        </button>
                        <button
                          onClick={() => startApproveWithCountdown(selectedBill)}
                          className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl flex items-center gap-1 shadow-sm transition-all cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          อนุมัติผ่านยอด
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-slate-50 border border-dashed border-gray-200 rounded-3xl h-[550px] flex flex-col justify-center items-center p-6 text-center text-gray-400">
                  <FileCheck2 className="w-10 h-10 text-gray-300 mb-2" />
                  <h4 className="text-xs font-bold text-slate-700">ไม่มีบิลเป้าหมายถูกเลือก</h4>
                  <p className="text-[10px] text-gray-400 mt-0.5">กรุณาเลือกบิลรอรับชำระด้านซ้าย เพื่อตรวจสอบสลิปและโอนยอด</p>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* =========================================================================
       * TAB 3: ยังไม่ชำระ (Pending / Cash Tab)
       * ========================================================================= */}
      {activeTab === 'cash' && (
        displayMode === 'grid' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filterByQuery(cashPendingBills).map(b => {
                const tenantName = getTenantName(b.tenantId);
                const roomNum = getRoomNum(b.roomId);
                const isOverdue = b.status === 'overdue' || new Date(b.dueDate) < new Date();
                const overdueDays = getBillOverdueDays(b);
                const waterUnits = getWaterUnits(b);
                const elecUnits = getElecUnits(b);

                return (
                  <div key={b.id} className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                      <span className={`px-3 py-1 border font-extrabold rounded-full text-[11px] flex items-center gap-1 ${isOverdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                        <AlertCircle className="w-3.5 h-3.5" />
                        {isOverdue ? `เกิน ${overdueDays > 0 ? `${overdueDays} วัน` : 'กำหนด'}` : 'ยังไม่ชำระ'}
                      </span>
                    </div>

                    <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {tenantName}
                      </p>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-slate-400" />
                        กำหนดชำระ: <span className="font-bold text-slate-700">{formatThaiDate(b.dueDate)}</span>
                      </p>
                    </div>

                    <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-100 pt-2">
                      {(() => {
                        const isExpanded = expandedBillIds.includes(b.id);
                        const roomObj = rooms.find(r => r.id === b.roomId);
                        const isTerm = roomObj?.rentCycle === 'term';

                        const baseItems = b.items && b.items.length > 0 ? b.items : [
                          { id: `rent-${b.id}`, description: isTerm ? 'ค่าเช่ารายเทอม (จ่ายแล้ว)' : 'ค่าเช่ารายเดือน', amount: isTerm ? 0 : (roomObj?.monthlyRent || 0), category: 'rent' as const },
                          { id: `elec-${b.id}`, description: `ค่าไฟ (${elecUnits} หน่วย)`, amount: elecUnits * 8, category: 'electricity' as const },
                          { id: `water-${b.id}`, description: `ค่าน้ำ (${waterUnits} หน่วย)`, amount: waterUnits * 18, category: 'water' as const },
                        ];

                        const rawItems = getBillEffectiveItems({ ...b, items: baseItems }, currentDorm);

                        const topItems = rawItems.slice(0, 3);
                        const extraItems = rawItems.slice(3);

                        return (
                          <div className="space-y-1">
                            {topItems.map((it, idx) => {
                              const isFine = it.category === 'fine' || it.description.includes('ค่าปรับ');
                              return (
                                <div key={idx} className="flex justify-between items-center">
                                  <span className={`truncate pr-1 ${isFine ? 'text-rose-600 font-bold' : 'text-slate-500 font-medium'}`}>
                                    {formatItemDescription(it.description)}:
                                  </span>
                                  <span className={`shrink-0 ${isFine ? 'text-rose-600 font-extrabold' : 'font-semibold text-slate-700'}`}>
                                    {formatBahtDash(it.amount)}
                                  </span>
                                </div>
                              );
                            })}

                            {!isExpanded ? (
                              <button
                                type="button"
                                onClick={() => toggleBillExpand(b.id)}
                                className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mt-1 cursor-pointer select-none"
                              >
                                <span>ดูรายละเอียด {extraItems.length > 0 ? `(+${extraItems.length})` : ''}</span>
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            ) : (
                              <>
                                {extraItems.map((it, idx) => {
                                  const isFine = it.category === 'fine' || it.description.includes('ค่าปรับ');
                                  return (
                                    <div key={idx + 3} className="flex justify-between items-center">
                                      <span className={`truncate pr-1 ${isFine ? 'text-rose-600 font-bold' : 'text-slate-500 font-medium'}`}>
                                        {formatItemDescription(it.description)}:
                                      </span>
                                      <span className={`shrink-0 ${isFine ? 'text-rose-600 font-extrabold' : 'font-semibold text-slate-700'}`}>
                                        {formatBahtDash(it.amount)}
                                      </span>
                                    </div>
                                  );
                                })}
                                <button
                                  type="button"
                                  onClick={() => toggleBillExpand(b.id)}
                                  className="text-[10px] font-extrabold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 mt-1 cursor-pointer select-none"
                                >
                                  <span>ซ่อนรายละเอียด</span>
                                  <ChevronUp className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-400 font-bold">ยอดที่ต้องชำระ</span>
                      <span className="text-lg font-black text-slate-900">{formatBaht(getBillTotalAmount(b))}</span>
                    </div>

                    {pendingCashMap[b.id] !== undefined ? (
                      <div className="bg-amber-50 border border-amber-300 p-2.5 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          <span>บันทึกเงินสด ({pendingCashMap[b.id]}s)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelPendingCashPayment(b.id)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer shrink-0 flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" />
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenLineModalForTenant(b.tenantId)}
                          className="py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                        >
                          <LineIcon className="w-3.5 h-3.5" />
                          เตือน LINE
                        </button>
                        <button
                          type="button"
                          onClick={() => startCashPaymentWithCountdown(b, 0)}
                          className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                        >
                          <DollarSign className="w-4 h-4" />
                          รับเงินสด
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {filterByQuery(cashPendingBills).length === 0 && (
              <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
                ไม่พบห้องพักค้างชำระในขณะนี้
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">
            <div className={`md:col-span-5 lg:col-span-4 bg-white p-4 rounded-3xl border border-gray-100 shadow-xs h-[580px] flex flex-col ${selectedCashBill ? 'hidden md:flex' : 'flex'}`}>
              <div className="relative mb-3 shrink-0">
                <Search className="absolute left-3 top-2.5 text-slate-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="ค้นหาเลขห้อง หรือชื่อผู้เช่า..."
                  value={cashSearchQuery}
                  onChange={(e) => setCashSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold shadow-2xs"
                />
              </div>

              <h4 className="text-xs font-bold text-slate-400 px-1 py-1 shrink-0 uppercase tracking-wider">
                ห้องพักทั้งหมด ({filterByQuery(cashPendingBills).length})
              </h4>

              <div className="space-y-2 overflow-y-auto flex-1 pr-1 mt-1">
                {filterByQuery(cashPendingBills).map(b => {
                  const overdueAmount = bills
                    .filter(ob => ob.tenantId === b.tenantId && ob.id !== b.id && ob.status === 'overdue')
                    .reduce((sum, ob) => sum + ob.totalAmount, 0);
                  const isItemOverdue = b.status === 'overdue' || new Date(b.dueDate) < new Date();
                  const itemOverdueDays = getBillOverdueDays(b);

                  return (
                    <div
                      key={b.id}
                      onClick={() => setSelectedCashBill(b)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all flex justify-between items-center gap-2 ${selectedCashBill?.id === b.id ? 'bg-indigo-50 border-indigo-200' : 'hover:bg-slate-50 border-gray-100 bg-white'
                        }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                        </span>
                        <div>
                          <h5 className="font-extrabold text-xs text-slate-800">{getRoomNum(b.roomId)}</h5>
                          <p className="text-[10px] text-gray-400 mt-0.5">{getTenantName(b.tenantId)}</p>
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <span className="font-bold text-slate-800 text-xs block">{formatBaht(getBillTotalAmount(b))}</span>
                        <div className="flex gap-1 justify-end flex-wrap">
                          <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-md leading-none ${isItemOverdue ? 'text-rose-600 bg-rose-50 border border-rose-100' : 'text-indigo-600 bg-indigo-50 border border-indigo-100'
                            }`}>
                            {isItemOverdue ? `เกิน ${itemOverdueDays > 0 ? `${itemOverdueDays} วัน` : 'กำหนด'}` : 'ยังไม่ชำระ'}
                          </span>
                          {overdueAmount > 0 && (
                            <span className="inline-block text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-md leading-none">
                              ค้างสะสม {formatBaht(overdueAmount)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={`md:col-span-7 lg:col-span-8 ${selectedCashBill ? 'block' : 'hidden md:block'}`}>
              {selectedCashBill ? (
                (() => {
                  const overdueAmount = bills
                    .filter(ob => ob.tenantId === selectedCashBill.tenantId && ob.id !== selectedCashBill.id && ob.status === 'overdue')
                    .reduce((sum, ob) => sum + ob.totalAmount, 0);

                  const wUnits = getWaterUnits(selectedCashBill);
                  const waterCurr = 214 + parseInt(getRoomNum(selectedCashBill.roomId).replace(/\D/g, '') || '0') * 2 + wUnits;
                  const waterPrev = waterCurr - wUnits;

                  const eUnits = getElecUnits(selectedCashBill);
                  const elecCurr = 1245 + parseInt(getRoomNum(selectedCashBill.roomId).replace(/\D/g, '') || '0') * 5 + eUnits;
                  const elecPrev = elecCurr - eUnits;

                  const isSelOverdue = selectedCashBill.status === 'overdue' || new Date(selectedCashBill.dueDate) < new Date();
                  const selOverdueDays = getBillOverdueDays(selectedCashBill);

                  return (
                    <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs h-[580px] flex flex-col justify-between">
                      <div className="overflow-y-auto space-y-4 max-h-[460px] pr-1">
                        <button
                          onClick={() => setSelectedCashBill(null)}
                          className="md:hidden mb-4 inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-bold text-xs"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          กลับไปหน้าเลือกห้อง
                        </button>

                        <div className="flex justify-between items-start">
                          <div>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">รายละเอียดใบแจ้งยอด</p>
                            <h4 className="text-lg font-black text-slate-800 tracking-tight mt-0.5">{getRoomNum(selectedCashBill.roomId)}</h4>
                          </div>
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${isSelOverdue ? 'text-rose-600 bg-rose-50 border border-rose-100' : 'text-indigo-600 bg-indigo-50 border border-indigo-100'
                            }`}>
                            {isSelOverdue ? `เกิน ${selOverdueDays > 0 ? `${selOverdueDays} วัน` : 'กำหนด'}` : 'ยังไม่ชำระรอบนี้'}
                          </span>
                        </div>

                        <div className="border-t border-b border-dashed border-gray-100 py-3 flex justify-between items-center text-xs font-semibold">
                          <span className="text-slate-400 font-bold">ผู้เช่าพัก</span>
                          <span className="text-slate-800 font-bold">{getTenantName(selectedCashBill.tenantId)}</span>
                        </div>

                        <div className="space-y-4 pt-1">
                          {getBillEffectiveItems(selectedCashBill, currentDorm).map((it, idx) => {
                            const isFine = it.category === 'fine' || it.description.includes('ค่าปรับ');
                            if (it.category === 'electricity') {
                              return (
                                <div key={idx} className="flex justify-between items-start text-xs font-semibold">
                                  <div className="space-y-0.5">
                                    <p className="text-slate-700">ค่าไฟฟ้า (มิเตอร์ {elecPrev} - {elecCurr})</p>
                                    <p className="text-[10px] text-slate-400 font-bold">{eUnits} หน่วย x 8฿</p>
                                  </div>
                                  <span className="text-slate-800 font-bold text-sm">{formatBahtDash(it.amount)}</span>
                                </div>
                              );
                            }
                            if (it.category === 'water') {
                              return (
                                <div key={idx} className="flex justify-between items-start text-xs font-semibold">
                                  <div className="space-y-0.5">
                                    <p className="text-slate-700">ค่าน้ำประปา (มิเตอร์ {waterPrev} - {waterCurr})</p>
                                    <p className="text-[10px] text-slate-400 font-bold">{wUnits} หน่วย x 18฿</p>
                                  </div>
                                  <span className="text-slate-800 font-bold text-sm">{formatBahtDash(it.amount)}</span>
                                </div>
                              );
                            }
                            if (it.category === 'rent') {
                              return (
                                <div key={idx} className="flex justify-between items-start text-xs font-semibold">
                                  <p className="text-slate-700">ค่าเช่ารายเดือน</p>
                                  <span className="text-slate-800 font-bold text-sm">{formatBahtDash(it.amount)}</span>
                                </div>
                              );
                            }
                            return (
                              <div key={idx} className="flex justify-between items-start text-xs font-semibold">
                                <p className={isFine ? 'text-rose-600 font-bold' : 'text-slate-700'}>{formatItemDescription(it.description)}</p>
                                <span className={`text-sm ${isFine ? 'text-rose-600 font-extrabold' : 'text-slate-800 font-bold'}`}>{formatBahtDash(it.amount)}</span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="border-t border-dashed border-slate-200 pt-3 space-y-2 text-xs font-semibold">
                          <div className="flex justify-between items-center">
                            <span className="text-slate-400 font-bold">ยอดชำระประจำเดือนนี้</span>
                            <span className="text-slate-800 font-bold">{formatBaht(getEffectiveBillTotal(selectedCashBill, currentDorm))}</span>
                          </div>
                          {overdueAmount > 0 && (
                            <div className="flex justify-between items-center">
                              <span className="text-rose-600 font-bold">⚠️ ค่าค้างชำระสะสม (ยกยอดมา)</span>
                              <span className="text-rose-600 font-bold">{formatBaht(overdueAmount)}</span>
                            </div>
                          )}
                        </div>

                        <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
                          <span className="text-xs font-extrabold text-slate-800">ยอดชำระรวมสุทธิทั้งหมด</span>
                          <span className="text-base font-black text-emerald-600">
                            {formatBaht(getEffectiveBillTotal(selectedCashBill, currentDorm) + overdueAmount)}
                          </span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-gray-100 shrink-0">
                        {pendingCashMap[selectedCashBill.id] !== undefined ? (
                          <div className="w-full py-2.5 bg-amber-50 border border-amber-300 px-3 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs">
                            <div className="flex items-center gap-2 text-xs font-bold">
                              <RotateCw className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
                              <span>กำลังบันทึกการรับเงินสด ({pendingCashMap[selectedCashBill.id]}s)...</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => cancelPendingCashPayment(selectedCashBill.id)}
                              className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-1 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => startCashPaymentWithCountdown(selectedCashBill, overdueAmount)}
                            className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-extrabold text-xs rounded-2xl flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                            บันทึกการจ่ายเงินสด
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-xs h-[580px] flex flex-col justify-center items-center text-center">
                  <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                    <FileText className="w-8 h-8" />
                  </div>
                  <h4 className="font-extrabold text-slate-700 text-sm">ไม่ได้เลือกห้อง</h4>
                  <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed font-semibold">
                    คลิกเลือกห้องด้านซ้ายเพื่อดูรายละเอียดใบเสร็จและทำรายการชำระเงิน
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* =========================================================================
       * TAB 4: สลิปผิดพลาด (Rejected Tab)
       * ========================================================================= */}
      {activeTab === 'rejected' && (
        displayMode === 'grid' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {filterByQuery(rejectedBills).map(b => {
                const tenantName = getTenantName(b.tenantId);
                const roomNum = getRoomNum(b.roomId);
                const slipUrl = b.slipImage || generateMockSlipImage(tenantName, b.totalAmount, roomNum, '12 ก.ค. 2569 - 16:40 น.');

                return (
                  <div key={b.id} className="bg-white rounded-3xl border border-rose-200/90 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                      <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                        <XCircle className="w-3.5 h-3.5 text-rose-600" />
                        สลิปผิดพลาด
                      </span>
                    </div>

                    <div className="text-xs">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {tenantName}
                      </p>
                    </div>

                    <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-2xl text-xs text-rose-800 space-y-1">
                      <p className="font-extrabold text-[11px] flex items-center gap-1 text-rose-900">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        เหตุผลที่ปฏิเสธ:
                      </p>
                      <p className="text-[11px] font-medium leading-tight">{b.rejectReason || 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้'}</p>
                    </div>

                    <div
                      onClick={() => setViewingSlipImage(slipUrl)}
                      className="relative bg-slate-50 border border-slate-200 rounded-2xl h-28 flex items-center justify-center p-2 cursor-pointer hover:border-rose-400 transition-all group overflow-hidden"
                    >
                      <img
                        src={slipUrl}
                        alt="สลิปปฏิเสธ"
                        className="max-h-full max-w-full object-contain rounded-xl group-hover:scale-105 transition-transform"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold rounded-2xl">
                        <Eye className="w-4 h-4" />
                        คลิกดูสลิปที่แนบ
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                      <span className="text-xs text-slate-400 font-bold">ยอดค้างชำระ</span>
                      <span className="text-lg font-black text-rose-600">{formatBaht(b.totalAmount)}</span>
                    </div>

                    {pendingCashMap[b.id] !== undefined ? (
                      <div className="bg-amber-50 border border-amber-300 p-2.5 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs animate-in fade-in">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          <span>บันทึกเงินสด ({pendingCashMap[b.id]}s)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelPendingCashPayment(b.id)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer shrink-0 flex items-center gap-0.5"
                        >
                          <X className="w-3 h-3" />
                          ยกเลิก
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleOpenLineModalForTenant(b.tenantId)}
                          className="py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                        >
                          <LineIcon className="w-3.5 h-3.5" />
                          ให้แนบใหม่
                        </button>
                        <button
                          type="button"
                          onClick={() => startCashPaymentWithCountdown(b, 0)}
                          className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                        >
                          <DollarSign className="w-4 h-4" />
                          รับเงินสด
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {filterByQuery(rejectedBills).length === 0 && (
              <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
                ไม่มีสลิปผิดพลาดในขณะนี้
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-gray-100 rounded-3xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs font-semibold">
                <thead className="bg-slate-50 text-slate-400 font-bold uppercase border-b border-gray-100">
                  <tr>
                    <th className="p-4">ห้อง</th>
                    <th className="p-4">ผู้จ่าย</th>
                    <th className="p-4">ยอดบิล</th>
                    <th className="p-4">เหตุผลการปฏิเสธ</th>
                    <th className="p-4 text-center">สลิปที่แนบ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filterByQuery(rejectedBills).map(b => (
                    <tr key={b.id}>
                      <td className="p-4 font-bold text-slate-800">{getRoomNum(b.roomId)}</td>
                      <td className="p-4 text-slate-600">{getTenantName(b.tenantId)}</td>
                      <td className="p-4 font-bold text-rose-600">{formatBaht(b.totalAmount)}</td>
                      <td className="p-4 text-rose-700 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                          {b.rejectReason}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        {(() => {
                          const imgUrl = b.slipImage || generateMockSlipImage(getTenantName(b.tenantId), b.totalAmount, getRoomNum(b.roomId), '12 ก.ค. 2569 - 16:40 น.');
                          return (
                            <div className="flex items-center justify-center gap-2">
                              <img
                                src={imgUrl}
                                alt="สลิปปฏิเสธ"
                                className="w-8 h-12 object-cover rounded-md border border-slate-200 cursor-pointer hover:scale-110 transition-transform shadow-2xs"
                                onClick={() => setViewingSlipImage(imgUrl)}
                                referrerPolicy="no-referrer"
                              />
                              <button
                                type="button"
                                onClick={() => setViewingSlipImage(imgUrl)}
                                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                เปิดดูสลิป
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}

      {/* Rejection input prompt modal */}
      <Modal isOpen={isRejectOpen} onClose={() => setIsRejectOpen(false)} title="ระบุเหตุผลการปฏิเสธสลิป">
        <div className="space-y-4">
          <div className="space-y-1 text-xs">
            <label className="block font-bold text-slate-700">เหตุผลประกอบ *</label>
            <select
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-700 font-semibold"
            >
              <option value="ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้">ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้</option>
              <option value="สลิปเลือนรางหรืออัพภาพอ่านไม่ชัด">สลิปเลือนรางหรืออัพภาพอ่านไม่ชัด</option>
              <option value="แสกนสลิปซ้ำซ้อนจากรอบเดือนก่อน">แสกนสลิปซ้ำซ้อนจากรอบเดือนก่อน</option>
              <option value="บัญชีธนาคารปลายทางไม่ตรง">บัญชีธนาคารปลายทางไม่ตรง</option>
              <option value="อื่นๆ">อื่นๆ (กรุณาระบุหมายเหตุด้านล่าง)</option>
            </select>
          </div>

          {rejectReason === 'อื่นๆ' && (
            <div className="space-y-1 text-xs animate-in slide-in-from-top-1">
              <label className="block font-bold text-slate-700">หมายเหตุถึงผู้เช่า *</label>
              <textarea
                required
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="อธิบายรายละเอียดการปฏิเสธเพื่อให้ผู้เช่าอัพโหลดสลิปที่ถูกต้องใหม่..."
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white h-16 text-slate-800 resize-none"
              />
            </div>
          )}

          <div className="pt-4 border-t border-gray-100 flex gap-2 justify-end">
            <button
              onClick={() => setIsRejectOpen(false)}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleRejectSlip}
              className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
            >
              ปฏิเสธและส่งคืนบิล
            </button>
          </div>
        </div>
      </Modal>

      {/* Cash receipt recording modal */}
      <Modal isOpen={isCashOpen} onClose={() => setIsCashOpen(false)} title="บันทึกจ่ายด้วยเงินสด ณ เคาน์เตอร์">
        <form onSubmit={handleRecordCash} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">เลือกบิลค้างชำระเป้าหมาย *</label>
            <select
              required
              value={cashBillId}
              onChange={(e) => setCashBillId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white font-semibold text-slate-700"
            >
              <option value="">-- เลือกห้องพักที่มีบิลค้างชำระ --</option>
              {cashPendingBills.map(b => (
                <option key={b.id} value={b.id}>
                  ห้อง {getRoomNum(b.roomId)} &bull; ยอด: {formatBaht(b.totalAmount)} (รอบ {b.cycleId})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block font-bold text-slate-700">วันที่รับเงินสด *</label>
              <input
                type="date"
                required
                value={cashReceivedDate}
                onChange={(e) => setCashReceivedDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800"
              />
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-700">ผู้รับเงินสดสำนักงาน *</label>
              <input
                type="text"
                required
                value={cashReceivedBy}
                onChange={(e) => setCashReceivedBy(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setIsCashOpen(false)}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs"
            >
              บันทึกจ่ายเงินสด
            </button>
          </div>
        </form>
      </Modal>

      {/* Printable receipt modal */}
      <Modal isOpen={isReceiptOpen} onClose={() => setIsReceiptOpen(false)} title="ใบเสร็จรับเงินประจำเดือนเสมือน" size="lg">
        {viewingReceipt && (
          <PrintView title="พิมพ์ใบเสร็จ">
            <div className="space-y-6 text-xs text-slate-800 font-sans max-w-xl mx-auto leading-relaxed">
              <div className="flex justify-between items-start border-b border-gray-200 pb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-600 text-white rounded-xl shrink-0">
                    <Building className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 leading-none">หอพักฮอร์สมาร์ท (HorPlus)</h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">โทร. 081-234-5678</p>
                  </div>
                </div>
                <div className="text-right">
                  <h4 className="font-extrabold text-slate-950 uppercase leading-none">ใบเสร็จรับเงิน</h4>
                  <p className="text-[10px] text-gray-400 mt-1">เลขที่: {viewingReceipt.receiptNumber}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-[11px]">
                <div>
                  <span className="text-gray-400">ชำระจากห้องพัก:</span>
                  <p className="font-bold text-slate-800 mt-0.5">ห้อง {getRoomNum(bills.find(b => b.id === viewingReceipt.billId)?.roomId || '')}</p>
                </div>
                <div>
                  <span className="text-gray-400">ผู้ชำระเงิน:</span>
                  <p className="font-bold text-slate-800 mt-0.5">{getTenantName(bills.find(b => b.id === viewingReceipt.billId)?.tenantId || '')}</p>
                </div>
              </div>

              {/* Items Table inside Receipt */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden mt-4">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-slate-50 text-slate-400 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">รายการ</th>
                      <th className="p-3 text-right">จำนวนเงิน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bills.find(b => b.id === viewingReceipt.billId)?.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="p-3 text-slate-700 font-medium">{formatItemDescription(it.description)}</td>
                        <td className="p-3 text-right font-bold text-slate-800">{formatBahtDash(it.amount)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/50 font-extrabold">
                      <td className="p-3 text-right text-slate-900">รวมชำระสุทธิ:</td>
                      <td className="p-3 text-right text-indigo-700">{formatBaht(viewingReceipt.totalAmount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-6 text-[10px] text-gray-400 border-t border-dashed border-gray-200">
                <p>ช่องทางรับชำระ: {viewingReceipt.paymentMethod === 'cash' ? 'เงินสดสำนักงาน' : 'แสกน PromptPay QR'}</p>
                <p className="text-right">ผู้รับเงิน / พนักงาน: {viewingReceipt.receiverName}</p>
              </div>

            </div>
          </PrintView>
        )}
      </Modal>

      {/* LINE Notification Modal */}
      <LineNotificationModal
        isOpen={isLineModalOpen}
        onClose={() => {
          setIsLineModalOpen(false);
          setTargetScrollTenantId(null);
        }}
        bills={bills}
        tenants={tenants}
        rooms={rooms}
        selectedCycle={selectedCycle}
        onSaveBills={onSaveBills}
        onAddLog={onAddLog}
        targetScrollTenantId={targetScrollTenantId}
        onShowToast={(msg) => setCashSuccessToast(msg)}
      />

      {/* Slip Viewer overlay */}
      {viewingSlipImage && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setViewingSlipImage(null)}
        >
          <div
            className="relative"
            onClick={e => e.stopPropagation()}
          >
            {/* Elegant close button positioned outside the top-right of the image itself */}
            <button
              type="button"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setViewingSlipImage(null)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img
              src={viewingSlipImage}
              alt="หลักฐานขนาดเต็ม"
              className="max-w-[90vw] md:max-w-lg max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-3xl shadow-2xl border border-white/10 select-none cursor-zoom-out transition-transform duration-300 hover:scale-[1.01]"
              onClick={() => setViewingSlipImage(null)}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

    </div>
  );
};
