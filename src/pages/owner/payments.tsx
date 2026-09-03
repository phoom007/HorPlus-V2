import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CheckCircle,
  Clock,
  AlertCircle,
  XCircle,
  Search,
  CheckCircle2,
  User,
  Eye,
  Printer,
  RotateCw,
  X,
  Check,
  Calendar,
  DollarSign,
  Building,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, formatBaht, formatThaiDate, formatCycleCode, PrintView, formatBillingQuantity, formatBillingRate, resolveBillingDisplayUnit, isNonZeroAmount, filterNonZeroBillItems } from '../../components/GlobalComponents';
import { TierBreakdownView } from '../../components/bills/TierBreakdownView';
import {
  formatTierRateLabel,
  formatCanonicalLineItemDescription,
  sortCanonicalBillItems,
  formatMoneyPlain,
} from '../../utils/billPresentation';
import { LineNotificationModal, LineIcon } from '../../components/LineNotificationModal';
import { Bill, Tenant, Room } from '../../types';
import { queryKeys } from '../../lib/queryClient';
import { httpRequest } from '../../data/httpClient';
import {
  isDailyInvoiceFullyPaid,
  isFinancialObligationSettled,
  isFinancialObligationInvalidated,
  resolveAuthoritativeOutstandingAmount,
} from '../../utils/dailyPaymentPredicate';

export interface BillingCycle {
  id: string;
  dormitoryId?: string;
  cycleCode: string;
  periodStart?: string | Date;
  periodEnd?: string | Date;
  dueDate?: string | Date;
  status?: string;
}

/* =========================================================================
 * Production Payment Record Type Definitions
 * ========================================================================= */
export interface PaymentRecord {
  id: string;
  dormitoryId: string;
  billId: string;
  tenantId?: string | null;
  paymentGroupId?: string | null;
  paymentGroup?: {
    id: string;
    status: string;
    totalAmount: number | string;
    receipts?: Array<{
      id: string;
      receiptNumber: string;
      totalAmount?: number | string;
      paidAt?: string | null;
      issuedAt?: string | null;
      paymentMethod?: string | null;
      receiverName?: string | null;
      isVoided?: boolean;
      snapshotData?: any;
    }>;
    allocations?: Array<{
      id: string;
      billId: string;
      billItemId?: string | null;
      allocatedAmount: number | string;
      allocationOrder?: number;
    }>;
    payments?: Array<{
      id: string;
      billId: string;
      amount: number | string;
      bill?: {
        id: string;
        billNumber: string;
        billingCycleId?: string | null;
        totalAmount?: number | string;
        items?: Array<{
          id: string;
          description: string;
          amount: number | string;
          quantity?: number | string;
          unit?: string | null;
          unitPrice?: number | string | null;
        }>;
      };
    }>;
    billTargets?: Array<{
      billId: string;
      bill?: {
        id: string;
        billNumber: string;
        billingCycleId?: string | null;
        totalAmount?: number | string;
        items?: Array<{
          id: string;
          description: string;
          amount: number | string;
          quantity?: number | string;
          unit?: string | null;
          unitPrice?: number | string | null;
        }>;
      };
    }>;
    verification?: {
      status?: string | null;
      provider?: string | null;
      claimedTransferAt?: string | null;
      verifiedTransferAt?: string | null;
    } | null;
  } | null;
  verification?: {
    status?: string | null;
    provider?: string | null;
    claimedTransferAt?: string | null;
    verifiedTransferAt?: string | null;
  } | null;
  allocations?: Array<{
    id: string;
    billId: string;
    billItemId?: string | null;
    allocatedAmount: number | string;
    allocationOrder?: number;
  }>;
  method: 'promptpay' | 'bank_transfer' | 'cash' | 'BANK_TRANSFER' | 'CASH' | 'PROMPTPAY';
  amount: number | string;
  status: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'REVERSED' | 'pending' | 'verified' | 'rejected' | 'voided';
  paymentDate: string;
  evidenceUrl?: string | null;
  fileHash?: string | null;
  rejectedReason?: string | null;
  reversalReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt?: string;
  bill?: {
    id: string;
    billNumber: string;
    billingCycleId?: string | null;
    totalAmount: number | string;
    paidAmount?: number | string;
    outstandingAmount?: number | string;
    status: string;
    billKind?: string;
    dueDate?: string | null;
    roomId?: string | null;
    tenantId?: string | null;
    room?: { id: string; roomNumber: string } | null;
    tenant?: { id: string; name?: string; displayName?: string; firstName?: string; lastName?: string } | null;
    items?: Array<{ id: string; description: string; amount: number | string; category?: string; type?: string }>;
  } | null;
  receipt?: {
    id: string;
    receiptNumber: string;
    totalAmount: number | string;
    paidAt?: string | null;
    issuedAt?: string | null;
    paymentMethod?: string | null;
    receiverName?: string | null;
    isVoided?: boolean;
    snapshotData?: any;
  } | null;
  statusHistories?: Array<{
    id: string;
    fromStatus: string;
    toStatus: string;
    reason?: string | null;
    effectiveAt: string;
  }>;
}

export interface DailyStayInvoiceItem {
  id: string;
  dailyStayInvoiceId: string;
  itemType: 'ROOM_CHARGE' | 'DEPOSIT' | 'DAMAGE_FEE' | 'EXTRA_SERVICE';
  description: string;
  amount: number | string;
  isPaid: boolean;
  paidAt?: string | null;
}

export interface DailyStayInvoice {
  id: string;
  dormitoryId: string;
  roomId: string;
  guestName: string;
  guestPhone?: string;
  checkInDate: string;
  checkOutDate: string;
  status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED' | 'CANCELLED';
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  depositStatus: 'NO_DEPOSIT' | 'HELD' | 'REFUNDED' | 'FORFEITED';
  items: DailyStayInvoiceItem[];
  room?: { id: string; roomNumber: string };
  createdAt: string;
}

export interface PaymentsOwnerViewProps {
  bills?: Bill[];
  dormitoryId?: string;
  rooms?: Room[];
  tenants?: Tenant[];
  selectedBillingCycleId?: string;
  selectedCycleCode?: string;
  billingCycles?: BillingCycle[];
  onAddLog?: (action: string, details: string, type: string, id: string) => void;
  onUpdateBills?: () => void;
}

/* =========================================================================
 * Helper Functions
 * ========================================================================= */
export function formatCycleThaiShort(cycleStr?: string): string {
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
}

export function formatItemDescription(desc?: string): string {
  if (!desc) return '';
  const str = desc.trim();
  if (str.includes('อินเทอร์เน็ต') || str.includes('อินเตอร์เน็ต')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าอินเทอร์เน็ต (${match[1]})` : 'ค่าอินเทอร์เน็ต';
  }
  return str.replace(/ค่าไฟฟ้า\s*\([^)]*\)/, 'ค่าไฟฟ้า').replace(/ค่าน้ำ\s*\([^)]*\)/, 'ค่าน้ำ');
}

export function formatBahtDash(amount: number | string | undefined): string {
  if (amount === undefined || amount === null) return '฿0';
  const val = Number(amount);
  if (isNaN(val) || val === 0) return '-';
  return formatBaht(val);
}

export function getBillOverdueDays(dueDateStr?: string | null): number {
  if (!dueDateStr) return 0;
  const due = new Date(dueDateStr);
  const now = new Date();
  if (isNaN(due.getTime()) || due >= now) return 0;
  const diffTime = Math.abs(now.getTime() - due.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function resolveRecordBillingCycleId(
  billingCycleId?: string | null,
  cycleCode?: string | null,
  billingCycles: BillingCycle[] = []
): string | null {
  if (billingCycleId && typeof billingCycleId === 'string' && billingCycleId.trim() !== '') {
    return billingCycleId.trim();
  }
  if (cycleCode && typeof cycleCode === 'string' && cycleCode.trim() !== '') {
    const found = billingCycles.find(c => c.cycleCode === cycleCode.trim());
    return found ? found.id : null;
  }
  return null;
}

/**
 * Resolves the authoritative canonical receipt from a payment record.
 */
export function resolveCanonicalReceipt(payment: PaymentRecord): any {
  if (payment.paymentGroupId && payment.paymentGroup?.receipts && payment.paymentGroup.receipts.length > 0) {
    return payment.paymentGroup.receipts[0];
  }
  return payment.receipt;
}

/**
 * Pure generator to map a payment record and historical context into the authoritative Receipt View state.
 * Consumes immutable snapshot data first for both single and multi-bill receipts.
 */
export function buildViewingReceipt(
  payment: PaymentRecord,
  bills: Bill[] = [],
  getCycleCodeForCycleId: (id?: string | null) => string = () => '',
  getRoomNum: (id?: string | null) => string = (id) => id || '',
  getTenantName: (id?: string | null) => string = (id) => id || ''
): any {
  const rcpt = resolveCanonicalReceipt(payment);
  if (!rcpt || !rcpt.receiptNumber) {
    return null;
  }

  const snap = (rcpt.snapshotData as any) || {};
  const roomNumber = snap.roomNumber || payment.bill?.room?.roomNumber || getRoomNum(payment.bill?.roomId || payment.bill?.room?.id);
  const tenantName = snap.tenantName || payment.bill?.tenant?.displayName || getTenantName(payment.tenantId || payment.bill?.tenantId);
  const totalAmount = Number(snap.total || rcpt.totalAmount || payment.amount || payment.bill?.totalAmount || 0);

  const targets = payment.paymentGroup?.billTargets || [];
  const groupPayments = (payment.paymentGroup as any)?.payments || [];
  const isMultiBill =
    targets.length > 1 ||
    groupPayments.length > 1 ||
    snap.isCombinedReceipt === true ||
    (Array.isArray(snap.billGroups) && snap.billGroups.length > 0);

  if (isMultiBill) {
    let billGroups: any[] = [];

    // A. Immutable Snapshot-First Authority: Consume snapshotData.billGroups if present
    if (Array.isArray(snap.billGroups) && snap.billGroups.length > 0) {
      billGroups = snap.billGroups.map((g: any) => {
        const cycleCode = g.cycleCode || '';
        const cycleFormatted = cycleCode ? formatCycleCode(cycleCode) : '';
        const cycleLabel = cycleFormatted
          ? `รอบบิล ${cycleFormatted}`
          : g.billKind === 'DEPOSIT'
          ? 'เงินประกันสัญญาเช่า'
          : 'บิลค่าใช้จ่าย';

        const billTotal = Number(g.billTotal || 0);
        const allocatedAmount = Number(g.allocatedAmount || billTotal);

        const nonZeroItems = filterNonZeroBillItems(g.items);
        const items = nonZeroItems.length > 0
          ? nonZeroItems.map((it: any) => ({
              description: it.description || it.type || '-',
              quantity: it.quantity,
              unit: resolveBillingDisplayUnit({ unit: it.unit, type: it.type }),
              unitPrice: it.unitPrice,
              amount: Number(it.amount),
              metadata: it.metadata,
              type: it.type,
            }))
          : [
              {
                description: `${cycleLabel} (${g.billNumber || g.billId})`,
                amount: billTotal || allocatedAmount,
              },
            ];

        return {
          billId: g.billId,
          billNumber: g.billNumber || g.billId,
          cycleLabel,
          billTotal: billTotal || allocatedAmount,
          allocatedAmount,
          items,
        };
      });
    } else {
      // B. Legacy Fallback: Reconstruct from live targets / groupPayments for old receipts
      const targetBillIds = [...new Set([
        ...targets.map((t: any) => t.billId),
        ...groupPayments.map((p: any) => p.billId),
      ])].filter(Boolean);

      billGroups = targetBillIds.map((bId: string) => {
        const foundBill: any =
          targets.find((t: any) => t.billId === bId)?.bill ||
          groupPayments.find((p: any) => p.billId === bId)?.bill ||
          (payment.bill?.id === bId ? payment.bill : null) ||
          bills.find(b => b.id === bId);

        const cycleCode = foundBill?.billingCycle?.cycleCode || (foundBill?.billingCycleId ? getCycleCodeForCycleId(foundBill.billingCycleId) : '');
        const cycleFormatted = cycleCode ? formatCycleCode(cycleCode) : '';
        const cycleLabel = cycleFormatted ? `รอบบิล ${cycleFormatted}` : (foundBill?.billKind === 'DEPOSIT' ? 'เงินประกันสัญญาเช่า' : 'บิลค่าใช้จ่าย');

        const billTotal = Number(foundBill?.totalAmount || 0);

        const groupAllocations = payment.paymentGroup?.allocations || [];
        const billAllocSum = groupAllocations
          .filter((a: any) => a.billId === bId)
          .reduce((sum: number, a: any) => sum + Number(a.allocatedAmount || 0), 0);

        const childPayAmount = Number(groupPayments.find((p: any) => p.billId === bId)?.amount || 0);
        const allocatedAmount = billAllocSum > 0 ? billAllocSum : (childPayAmount > 0 ? childPayAmount : billTotal);

        let items: Array<{
          description: string;
          quantity?: number | string | null;
          unit?: string | null;
          unitPrice?: number | string | null;
          amount: number;
          metadata?: any;
          type?: string;
        }> = [];

        if (foundBill?.items && foundBill.items.length > 0) {
          const nonZeroItems = filterNonZeroBillItems(foundBill.items);
          items = nonZeroItems.map((it: any) => ({
            description: it.description || it.type || '-',
            quantity: it.quantity,
            unit: resolveBillingDisplayUnit({ unit: it.unit, type: it.type }),
            unitPrice: it.unitPrice,
            amount: Number(it.amount),
            metadata: it.metadata,
            type: it.type,
          }));
        } else {
          items = [{
            description: `${cycleLabel} (${foundBill?.billNumber || bId})`,
            amount: billTotal || allocatedAmount,
          }];
        }

        return {
          billId: bId,
          billNumber: foundBill?.billNumber || bId,
          cycleLabel,
          billTotal: billTotal || allocatedAmount,
          allocatedAmount,
          items,
        };
      });
    }

    const isHistorical = Boolean(
      snap.isHistoricalImport ||
      payment.metadata?.isHistoricalImport
    );
    const originalPaymentDateKnown = isHistorical
      ? Boolean(snap.originalPaymentDateKnown ?? payment.metadata?.originalPaymentDateKnown ?? false)
      : true;
    const originalPaidAt = (!isHistorical || originalPaymentDateKnown)
      ? (snap.paymentDate || rcpt.issuedAt || payment.paymentDate || rcpt.paidAt || payment.createdAt || null)
      : null;
    const importedAt = snap.importedAt || payment.metadata?.importedAt || rcpt.issuedAt || payment.createdAt;

    return {
      receiptNumber: snap.receiptNumber || rcpt.receiptNumber,
      roomNumber,
      tenantName,
      totalAmount,
      paidAt: originalPaidAt,
      isHistorical,
      originalPaymentDateKnown,
      importedAt,
      paymentMethod: snap.paymentMethod
        ? (String(snap.paymentMethod).toUpperCase() === 'CASH' ? 'เงินสดสำนักงาน' : 'แสกน PromptPay QR')
        : ((payment.method || '').toUpperCase() === 'CASH' ? 'เงินสดสำนักงาน' : 'แสกน PromptPay QR'),
      receiverName: rcpt.receiverName || snap.dormitoryName || 'ฝ่ายการเงิน หอพัก HorPlus',
      isMultiBill: true,
      billGroups,
    };
  }

  // Single-bill receipt
  const targetBill: any = payment.bill || bills.find(b => b.id === payment.billId) || targets[0]?.bill;
  const cycleCode = targetBill?.billingCycle?.cycleCode || (targetBill?.billingCycleId ? getCycleCodeForCycleId(targetBill.billingCycleId) : '');
  const cycleFormatted = cycleCode ? formatCycleCode(cycleCode) : '';
  const cycleLabel = cycleFormatted ? `รอบบิล ${cycleFormatted}` : (targetBill?.billKind === 'DEPOSIT' ? 'เงินประกันสัญญาเช่า' : '');

  const billTotal = snap.billTotal !== undefined ? Number(snap.billTotal) : Number(targetBill?.totalAmount || totalAmount);
  const allocatedAmount = snap.allocatedAmount !== undefined ? Number(snap.allocatedAmount) : (snap.receivedAmount !== undefined ? Number(snap.receivedAmount) : totalAmount);

  let items: Array<{
    description: string;
    quantity?: number | string | null;
    unit?: string | null;
    unitPrice?: number | string | null;
    amount: number;
    metadata?: any;
    type?: string;
  }> = [];

  if (Array.isArray(snap.items) && snap.items.length > 0) {
    const nonZeroSnap = filterNonZeroBillItems(snap.items);
    if (nonZeroSnap.length > 0) {
      items = nonZeroSnap.map((it: any) => ({
        description: it.description || it.type || '-',
        quantity: it.quantity,
        unit: resolveBillingDisplayUnit({ unit: it.unit, type: it.type }),
        unitPrice: it.unitPrice,
        amount: Number(it.amount),
        metadata: it.metadata,
        type: it.type,
      }));
    } else {
      items = [
        { description: 'ยอดชำระตามใบเสร็จเดิม', amount: allocatedAmount }
      ];
    }
  } else if (targetBill?.items && targetBill.items.length > 0) {
    const nonZeroTarget = filterNonZeroBillItems(targetBill.items);
    if (nonZeroTarget.length > 0) {
      items = nonZeroTarget.map((it: any) => ({
        description: it.description || it.type || '-',
        quantity: it.quantity,
        unit: resolveBillingDisplayUnit({ unit: it.unit, type: it.type }),
        unitPrice: it.unitPrice,
        amount: Number(it.amount),
        metadata: it.metadata,
        type: it.type,
      }));
    } else {
      items = [
        { description: 'ยอดชำระตามใบเสร็จเดิม', amount: allocatedAmount }
      ];
    }
  } else {
    items = [
      { description: 'ยอดชำระตามใบเสร็จเดิม', amount: allocatedAmount }
    ];
  }

  const isHistorical = Boolean(
    snap.isHistoricalImport ||
    payment.metadata?.isHistoricalImport
  );
  const originalPaymentDateKnown = isHistorical
    ? Boolean(snap.originalPaymentDateKnown ?? payment.metadata?.originalPaymentDateKnown ?? false)
    : true;
  const originalPaidAt = (!isHistorical || originalPaymentDateKnown)
    ? (snap.paymentDate || payment.paymentDate || rcpt.issuedAt || rcpt.paidAt || payment.createdAt || null)
    : null;
  const importedAt = snap.importedAt || payment.metadata?.importedAt || rcpt.issuedAt || payment.createdAt;

  return {
    receiptNumber: snap.receiptNumber || rcpt.receiptNumber,
    billNumber: snap.billNumber || targetBill?.billNumber,
    roomNumber,
    tenantName,
    totalAmount,
    paidAt: originalPaidAt,
    isHistorical,
    originalPaymentDateKnown,
    importedAt,
    paymentMethod: snap.paymentMethod
      ? (String(snap.paymentMethod).toUpperCase() === 'CASH' ? 'เงินสดสำนักงาน' : 'แสกน PromptPay QR')
      : ((payment.method || '').toUpperCase() === 'CASH' ? 'เงินสดสำนักงาน' : 'แสกน PromptPay QR'),
    receiverName: rcpt.receiverName || snap.dormitoryName || 'ฝ่ายการเงิน หอพัก HorPlus',
    isMultiBill: false,
    cycleLabel,
    billTotal,
    allocatedAmount,
    items,
  };
}

/**
 * Maps a settled DailyStayInvoice into the authoritative Receipt View state.
 * 1 Daily Stay = 1 Final Receipt when fully settled.
 */
export function buildViewingDailyReceipt(
  inv: DailyStayInvoice,
  getRoomNum: (id?: string | null) => string = (id) => id || '',
  dormitoryInfo?: { name?: string; address?: string; phone?: string; taxId?: string }
): any {
  if (!inv) return null;
  const stay = inv.dailyStay;
  const roomNum = stay?.room?.roomNumber || getRoomNum(stay?.roomId) || 'ไม่ระบุ';
  const tenantName = stay?.applicantFullName || stay?.tenant?.displayName || 'ผู้พักรายวัน';
  const totalAmount = Number(inv.totalAgreedAmount || 0);

  const nonZeroItems = filterNonZeroBillItems(inv.items);
  const items = nonZeroItems.length > 0
    ? nonZeroItems.map((it: any) => ({
        description: it.description || it.type || '-',
        quantity: it.quantity,
        unit: resolveBillingDisplayUnit({ unit: it.unit, type: it.type }),
        unitPrice: it.unitPrice,
        amount: Number(it.amount),
        metadata: it.metadata,
        type: it.type,
      }))
    : [
        {
          description: `การเข้าพักรายวัน (${inv.invoiceNumber})`,
          amount: totalAmount,
        },
      ];

  const persistedReceipt = (inv as any).finalReceipt || (inv as any).receipts?.[0];
  const receiptNumber = persistedReceipt?.receiptNumber || (inv.invoiceNumber?.startsWith('DINV-') ? `RC-${inv.invoiceNumber.replace(/^DINV-/, '')}` : inv.invoiceNumber) || `RC-DAILY-${inv.id?.slice(0, 8)}`;

  return {
    receiptNumber,
    roomNumber: roomNum,
    tenantName,
    totalAmount,
    paidAt: inv.updatedAt || inv.issuedAt,
    paymentMethod: 'เงินสด',
    cycleLabel: 'การเข้าพักรายวัน',
    billNumber: inv.invoiceNumber,
    dormitoryName: dormitoryInfo?.name || 'หอพัก HorPlus',
    dormitoryAddress: dormitoryInfo?.address || null,
    dormitoryPhone: dormitoryInfo?.phone || null,
    dormitoryTaxId: dormitoryInfo?.taxId || null,
    receiverName: 'ฝ่ายการเงิน หอพัก HorPlus',
    items,
    isMultiBill: false,
    billGroups: [],
    isHistorical: false,
    originalPaymentDateKnown: true,
  };
}

/* =========================================================================
 * API Fetchers (Fail Loudly to React Query on Network/HTTP Error)
 * ========================================================================= */
export async function fetchPayments(dormitoryId?: string): Promise<PaymentRecord[]> {
  if (!dormitoryId) return [];
  const res = await httpRequest<PaymentRecord[] | { data: PaymentRecord[] } | { items: PaymentRecord[] }>(
    'GET',
    `/payments?dormitoryId=${dormitoryId}`,
    undefined,
    { headers: { 'x-dormitory-id': dormitoryId } }
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray((res as any).data)) return (res as any).data;
  if (res && Array.isArray((res as any).items)) return (res as any).items;
  return [];
}

export async function fetchDailyInvoices(dormitoryId?: string): Promise<DailyStayInvoice[]> {
  if (!dormitoryId) return [];
  const res = await httpRequest<{ data: DailyStayInvoice[] } | DailyStayInvoice[]>(
    'GET',
    `/daily-stays/invoices?dormitoryId=${dormitoryId}`,
    undefined,
    { headers: { 'x-dormitory-id': dormitoryId } }
  );
  if (Array.isArray(res)) return res;
  if (res && Array.isArray((res as any).data)) return (res as any).data;
  return [];
}

/* =========================================================================
 * Main Component: PaymentsOwnerView
 * ========================================================================= */
export const PaymentsOwnerView: React.FC<PaymentsOwnerViewProps> = ({
  bills = [],
  dormitoryId,
  rooms = [],
  tenants = [],
  selectedBillingCycleId,
  selectedCycleCode,
  billingCycles = [],
  onAddLog = (_a?: string, _b?: string, _c?: string, _d?: string) => {},
  onUpdateBills = () => {},
}) => {
  const queryClient = useQueryClient();

  // Query auth session for authenticated actor name
  const { data: sessionData } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: async () => {
      try {
        const res = await httpRequest<any>('GET', '/auth/session');
        return res;
      } catch {
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
  const currentAuthUserName = sessionData?.user?.name || sessionData?.user?.displayName || 'ผู้ดูแลระบบ';

  // Active Tab: 'paid' | 'checking' | 'cash' | 'rejected'
  const [activeTab, setActiveTab] = useState<'paid' | 'checking' | 'cash' | 'rejected'>('checking');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected item states
  const [cashSearchQuery, setCashSearchQuery] = useState('');

  // Rejection modal state
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectPaymentTarget, setRejectPaymentTarget] = useState<PaymentRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้');
  const [rejectNote, setRejectNote] = useState('');

  // Manual Cash modal state
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [cashTargetBillId, setCashTargetBillId] = useState('');
  const [cashReceivedDate, setCashReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashReceivedBy, setCashReceivedBy] = useState('เจ้าหน้าที่การเงิน');
  const [customCashAmount, setCustomCashAmount] = useState('');
  const [isSubmittingCash, setIsSubmittingCash] = useState(false);

  // Countdown timers for Cash and Slip Approval
  const [pendingCashMap, setPendingCashMap] = useState<Record<string, number>>({});
  const cashTimersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const [pendingApproveMap, setPendingApproveMap] = useState<Record<string, number>>({});
  const approveTimersRef = useRef<Record<string, NodeJS.Timeout>>({});

  // Component-stable Idempotency Key Manager
  const idempotencyKeysRef = useRef<Map<string, string>>(new Map());
  const getIdempotencyKey = (opId: string): string => {
    let key = idempotencyKeysRef.current.get(opId);
    if (!key) {
      key = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `idem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      idempotencyKeysRef.current.set(opId, key);
    }
    return key;
  };
  const clearIdempotencyKey = (opId: string): void => {
    idempotencyKeysRef.current.delete(opId);
  };

  // Unpaid Card Inline Item Expansion state
  const [expandedBillDetails, setExpandedBillDetails] = useState<Set<string>>(new Set());
  const toggleBillDetail = (billId: string) => {
    setExpandedBillDetails(prev => {
      const next = new Set(prev);
      if (next.has(billId)) {
        next.delete(billId);
      } else {
        next.add(billId);
      }
      return next;
    });
  };

  const [isReceiptOpen, setIsReceiptOpen] = useState(false);
  const [viewingGroupDetail, setViewingGroupDetail] = useState<{
    roomNumber: string;
    tenantName: string;
    totalAmount: number;
    payments: PaymentRecord[];
    isHistorical?: boolean;
    historicalLabel?: string;
  } | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<{
    receiptNumber: string;
    billNumber?: string;
    roomNumber: string;
    tenantName: string;
    totalAmount: number;
    paidAt?: string | null;
    isHistorical?: boolean;
    originalPaymentDateKnown?: boolean;
    importedAt?: string;
    paymentMethod: string;
    receiverName?: string;
    isMultiBill?: boolean;
    billGroups?: Array<{
      billId: string;
      billNumber: string;
      cycleLabel?: string;
      billTotal: number;
      allocatedAmount: number;
      items: Array<{
        description: string;
        quantity?: number | string | null;
        unit?: string | null;
        unitPrice?: number | string | null;
        amount: number;
        metadata?: any;
        type?: string;
      }>;
    }>;
    cycleLabel?: string;
    billTotal?: number;
    allocatedAmount?: number;
    items?: Array<{
      description: string;
      quantity?: number | string | null;
      unit?: string | null;
      unitPrice?: number | string | null;
      amount: number;
      metadata?: any;
      type?: string;
    }>;
  } | null>(null);

  const [viewingDailyGroupDetail, setViewingDailyGroupDetail] = useState<{
    id: string;
    roomId: string;
    roomNumber: string;
    tenantId?: string | null;
    tenantName: string;
    phone?: string | null;
    totalAmount: number;
    invoices: DailyStayInvoice[];
    latestPaidDate: string;
  } | null>(null);

  // Toast notification state
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  // Full Slip Image Viewer
  const [viewingSlipUrl, setViewingSlipUrl] = useState<string | null>(null);

  // LINE notification modal
  const [isLineModalOpen, setIsLineModalOpen] = useState(false);
  const [targetScrollTenantId, setTargetScrollTenantId] = useState<string | null>(null);

  // Full Bill Line-Item Detail Modal
  const [viewingBillDetail, setViewingBillDetail] = useState<{
    bill: any;
    roomNum?: string;
    tenantName?: string;
  } | null>(null);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      Object.keys(cashTimersRef.current).forEach(id => clearInterval(cashTimersRef.current[id]));
      Object.keys(approveTimersRef.current).forEach(id => clearInterval(approveTimersRef.current[id]));
    };
  }, []);

  const triggerToast = (message: string) => {
    setSuccessToast(message);
    setIsToastFading(false);
    setTimeout(() => setIsToastFading(true), 2900);
    setTimeout(() => {
      setSuccessToast(null);
      setIsToastFading(false);
    }, 3500);
  };

  /* -------------------------------------------------------------------------
   * React Queries
   * ------------------------------------------------------------------------- */
  const {
    data: paymentsData = [],
    isLoading: isPaymentsLoading,
    isError: isPaymentsError,
    error: paymentsError,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: queryKeys.payments(dormitoryId),
    queryFn: () => fetchPayments(dormitoryId),
    enabled: !!dormitoryId,
    staleTime: 5000,
  });

  const {
    data: dailyInvoicesData = [],
    isLoading: isDailyInvoicesLoading,
    refetch: refetchDailyInvoices,
  } = useQuery({
    queryKey: queryKeys.dailyInvoices(dormitoryId),
    queryFn: () => fetchDailyInvoices(dormitoryId),
    enabled: !!dormitoryId,
    staleTime: 5000,
  });

  const { data: contractsData = [] } = useQuery({
    queryKey: queryKeys.contracts(dormitoryId),
    queryFn: async () => {
      if (!dormitoryId) return [];
      try {
        const res = await httpRequest<any>('GET', `/contracts?dormitoryId=${dormitoryId}`, undefined, {
          headers: { 'x-dormitory-id': dormitoryId },
        });
        if (Array.isArray(res)) return res;
        if (res?.data && Array.isArray(res.data)) return res.data;
        return [];
      } catch {
        return [];
      }
    },
    enabled: !!dormitoryId,
    staleTime: 60000,
  });

  // Partial Popover State (Anchored details inside yellow summary box)
  const [openPartialPopoverId, setOpenPartialPopoverId] = useState<string | null>(null);

  useEffect(() => {
    if (!openPartialPopoverId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPartialPopoverId(null);
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-partial-popover="${openPartialPopoverId}"]`)) {
        setOpenPartialPopoverId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openPartialPopoverId]);

  // Daily Detail Modal State
  const [isDailyDetailOpen, setIsDailyDetailOpen] = useState(false);
  const [viewingDailyDetail, setViewingDailyDetail] = useState<DailyStayInvoice | null>(null);

  const handleOpenDailyDetail = (inv: DailyStayInvoice) => {
    setViewingDailyDetail(inv);
    setIsDailyDetailOpen(true);
  };

  // Effective billing cycle derivation
  const effectiveCycleId = selectedBillingCycleId || billingCycles.find(c => c.cycleCode === selectedCycleCode)?.id;
  const effectiveCycleCode = selectedCycleCode || billingCycles.find(c => c.id === effectiveCycleId)?.cycleCode || '';

  const selectedCycleObj = useMemo(() => {
    return billingCycles.find(c => c.id === effectiveCycleId || (effectiveCycleCode && c.cycleCode === effectiveCycleCode)) || null;
  }, [billingCycles, effectiveCycleId, effectiveCycleCode]);

  const isDailyInvoiceInSelectedCycle = (inv: any, cycle: BillingCycle | null): boolean => {
    if (!cycle) return true;
    const stay = inv.dailyStay;
    const startStr = stay?.startDate ? String(stay.startDate).slice(0, 10) : (inv.checkInDate ? String(inv.checkInDate).slice(0, 10) : (inv.issuedAt ? String(inv.issuedAt).slice(0, 10) : ''));
    const cycleStartStr = String(cycle.periodStart).slice(0, 10);
    const cycleEndStr = String(cycle.periodEnd).slice(0, 10);

    if (!startStr || !cycleStartStr || !cycleEndStr) return true;
    // Canonical start-month authority: Daily invoice belongs strictly to the billing cycle of stay.startDate
    return startStr >= cycleStartStr && startStr <= cycleEndStr;
  };

  const unpaidDailyInvoices = useMemo(() => {
    if (!dailyInvoicesData || !Array.isArray(dailyInvoicesData)) return [];
    return dailyInvoicesData.filter((inv) => {
      if (!isDailyInvoiceInSelectedCycle(inv, selectedCycleObj)) return false;
      if (isFinancialObligationInvalidated(inv.status)) return false;
      return !isFinancialObligationSettled(inv);
    });
  }, [dailyInvoicesData, selectedCycleObj]);

  const paidDailyInvoices = useMemo(() => {
    if (!dailyInvoicesData || !Array.isArray(dailyInvoicesData)) return [];
    return dailyInvoicesData.filter((inv) => {
      if (!isDailyInvoiceInSelectedCycle(inv, selectedCycleObj)) return false;
      return isFinancialObligationSettled(inv);
    });
  }, [dailyInvoicesData, selectedCycleObj]);

  // Helpers to resolve Room Number, Tenant Name, Cycle Code
  const isUuidString = (str: string): boolean => {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
  };

  const getRoomNum = (rIdOrRoom?: string | { id?: string; roomNumber?: string } | null, fallbackNumber?: string): string => {
    if (!rIdOrRoom) return fallbackNumber || 'ไม่ระบุ';
    if (typeof rIdOrRoom === 'object') {
      if (rIdOrRoom.roomNumber && String(rIdOrRoom.roomNumber).trim() !== '' && !isUuidString(rIdOrRoom.roomNumber)) {
        return String(rIdOrRoom.roomNumber).trim();
      }
      return getRoomNum(rIdOrRoom.id, fallbackNumber);
    }
    const str = String(rIdOrRoom).trim();
    if (!str) return fallbackNumber || 'ไม่ระบุ';

    const room = rooms.find(r => r.id === str || r.roomNumber === str);
    if (room?.roomNumber && !isUuidString(room.roomNumber)) {
      return room.roomNumber;
    }

    if (fallbackNumber && String(fallbackNumber).trim() !== '' && !isUuidString(fallbackNumber)) {
      return String(fallbackNumber).trim();
    }

    if (!isUuidString(str)) {
      return str;
    }

    return 'ไม่ระบุ';
  };

  const resolveAuthoritativeRoomNum = (
    bill?: any,
    payment?: any,
    dailyStay?: any,
    fallback?: string
  ): string => {
    // 1. bill.room.roomNumber
    if (bill?.room?.roomNumber && !isUuidString(bill.room.roomNumber)) {
      return String(bill.room.roomNumber).trim();
    }
    if (bill?.roomNumber && !isUuidString(bill.roomNumber)) {
      return String(bill.roomNumber).trim();
    }
    // 2. payment.bill.room.roomNumber
    if (payment?.bill?.room?.roomNumber && !isUuidString(payment.bill.room.roomNumber)) {
      return String(payment.bill.room.roomNumber).trim();
    }
    if (payment?.bill?.roomNumber && !isUuidString(payment.bill.roomNumber)) {
      return String(payment.bill.roomNumber).trim();
    }
    // 3. dailyStay.room.roomNumber
    if (dailyStay?.room?.roomNumber && !isUuidString(dailyStay.room.roomNumber)) {
      return String(dailyStay.room.roomNumber).trim();
    }
    // 4. canonical rooms dataset by roomId
    const targetRoomId = bill?.roomId || payment?.bill?.roomId || dailyStay?.roomId;
    if (targetRoomId) {
      const room = rooms.find(r => r.id === targetRoomId || r.roomNumber === targetRoomId);
      if (room?.roomNumber && !isUuidString(room.roomNumber)) {
        return room.roomNumber;
      }
    }
    return getRoomNum(targetRoomId, fallback);
  };

  const resolveAuthoritativeStartDate = (
    bill?: any,
    payment?: any
  ): string | null => {
    const targetBill = bill || payment?.bill;
    if (!targetBill) return null;
    const allContracts = contractsData.length > 0 ? contractsData : (queryClient.getQueryData<any[]>(queryKeys.contracts(dormitoryId)) || []);
    const contract = allContracts.find((c: any) =>
      (targetBill.contractId && c.id === targetBill.contractId) ||
      (c.roomId === targetBill.roomId && c.tenantId === targetBill.tenantId)
    );
    const dateVal =
      targetBill.startDate ||
      targetBill.contract?.startDate ||
      targetBill.contractStartDate ||
      contract?.startDate ||
      targetBill.provisionalRentalTerm?.startDate ||
      targetBill.provisionalRentalStartDate ||
      targetBill.occupancyStartDate ||
      null;
    return dateVal ? String(dateVal) : null;
  };

  const getTenantName = (tId?: string | null): string => {
    if (!tId) return 'ผู้เช่า';
    const t = tenants.find(item => item.id === tId);
    if (!t) return 'ผู้เช่า';
    return t.displayName || t.name || `${t.firstName || ''} ${t.lastName || ''}`.trim() || 'ผู้เช่า';
  };

  const getCycleCodeForCycleId = (cId?: string | null): string => {
    if (!cId) return '';
    const cycle = billingCycles.find(c => c.id === cId || c.cycleCode === cId);
    return cycle?.cycleCode || '';
  };

  // Evidence Slip URL resolver
  const getSlipEvidenceUrl = (payment: PaymentRecord): string => {
    if (payment.evidenceUrl) {
      return `/api/v1/payments/${payment.id}/evidence`;
    }
    return '';
  };

  /* -------------------------------------------------------------------------
   * Tab Filter Projections
   * ------------------------------------------------------------------------- */

    // Tab 1: Checking (รอตรวจสอบ / รอตรวจสลิป) -> ALL BILLING CYCLES (Grouped Combined Slips as 1 item)
  const checkingReviewItems = useMemo(() => {
    const pendingList = paymentsData
      .filter(p => {
        const s = (p.status || '').toUpperCase();
        return s === 'PENDING' || s === 'UNDER_REVIEW';
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const groupsMap = new Map<string, {
      id: string;
      isGroup: boolean;
      groupId?: string;
      paymentId?: string;
      roomNum: string;
      tenantName: string;
      totalAmount: number;
      claimedTransferAt?: string | null;
      createdAt: string;
      slipUrl?: string | null;
      affectedOrigins: Array<{ billId: string; billNumber: string; cycleLabel: string; amount: number; bill?: any }>;
      payments: PaymentRecord[];
    }>();

    for (const p of pendingList) {
      if (p.paymentGroupId) {
        if (!groupsMap.has(p.paymentGroupId)) {
          const groupTotal = Number(p.paymentGroup?.totalAmount || p.amount || 0);
          const roomNum = resolveAuthoritativeRoomNum(p.bill, p);
          const tenantName = p.bill?.tenant?.displayName || getTenantName(p.tenantId || p.bill?.tenantId);
          const slipUrl = getSlipEvidenceUrl(p);

          groupsMap.set(p.paymentGroupId, {
            id: p.paymentGroupId,
            isGroup: true,
            groupId: p.paymentGroupId,
            roomNum,
            tenantName,
            totalAmount: groupTotal,
            claimedTransferAt: (p.paymentGroup as any)?.verification?.claimedTransferAt || p.paymentDate,
            createdAt: p.createdAt,
            slipUrl,
            affectedOrigins: [],
            payments: [],
          });
        }
        const g = groupsMap.get(p.paymentGroupId)!;
        g.payments.push(p);
        const cycleCode = getCycleCodeForCycleId(p.bill?.billingCycleId);
        g.affectedOrigins.push({
          billId: p.billId,
          billNumber: p.bill?.billNumber || p.billId,
          cycleLabel: formatCycleThaiShort(cycleCode),
          amount: Number(p.amount || 0),
          bill: p.bill,
        });
      } else {
        const roomNum = resolveAuthoritativeRoomNum(p.bill, p);
        const tenantName = p.bill?.tenant?.displayName || getTenantName(p.tenantId || p.bill?.tenantId);
        const slipUrl = getSlipEvidenceUrl(p);
        const cycleCode = getCycleCodeForCycleId(p.bill?.billingCycleId);

        groupsMap.set(p.id, {
          id: p.id,
          isGroup: false,
          paymentId: p.id,
          roomNum,
          tenantName,
          totalAmount: Number(p.amount || p.bill?.totalAmount || 0),
          claimedTransferAt: (p as any).verification?.claimedTransferAt || p.paymentDate,
          createdAt: p.createdAt,
          slipUrl,
          affectedOrigins: [
            {
              billId: p.billId,
              billNumber: p.bill?.billNumber || p.billId,
              cycleLabel: formatCycleThaiShort(cycleCode),
              amount: Number(p.amount || 0),
              bill: p.bill,
            },
          ],
          payments: [p],
        });
      }
    }

    return Array.from(groupsMap.values());
  }, [paymentsData, rooms, tenants, billingCycles]);

  // Tab 2: Cash (บันทึกเงินสด / ยังไม่ชำระ) -> Strictly Selected Header Cycle ONLY (Fail Closed on missing cycle authority)
  const cashPendingBills = useMemo(() => {
    // Collect bill IDs that already have an active/submitted payment
    const activePaymentBillIds = new Set(
      paymentsData
        .filter(p => {
          const s = (p.status || '').toUpperCase();
          return s === 'PENDING' || s === 'UNDER_REVIEW';
        })
        .map(p => p.billId)
    );

    return bills
      .filter(b => {
        // Strict cycle authority - FAIL CLOSED if cycle cannot be resolved
        const resolvedCycleId = resolveRecordBillingCycleId(b.billingCycleId, b.cycleId, billingCycles);
        if (!resolvedCycleId || !effectiveCycleId || resolvedCycleId !== effectiveCycleId) return false;

        // Unpaid or Overdue status (strictly exclude PAID, CANCELLED, VOID, VOIDED, WITHDRAWN, SUPERSEDED)
        const normStatus = (b.status || '').toUpperCase();
        if (normStatus === 'PAID') return false;
        if (isFinancialObligationInvalidated(normStatus)) return false;
        if (isFinancialObligationSettled(b)) return false;

        const outstanding = resolveAuthoritativeOutstandingAmount(b);
        if (outstanding === null || outstanding <= 0) return false;

        // Exclude bills that already have pending or approved payments
        if (activePaymentBillIds.has(b.id)) return false;

        return true;
      })
      .sort((a, b) => {
        const roomA = getRoomNum(a.roomId);
        const roomB = getRoomNum(b.roomId);
        return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [bills, effectiveCycleId, effectiveCycleCode, billingCycles, paymentsData, rooms]);

  // Tab 3: Paid (ชำระแล้ว) -> Strictly Selected Header Cycle ONLY (Fail Closed on missing bill cycle authority)
  const paidPayments = useMemo(() => {
    return paymentsData
      .filter(p => {
        const s = (p.status || '').toUpperCase();
        const isApproved = s === 'APPROVED' || s === 'VERIFIED';
        if (!isApproved) return false;

        // Invalidation guard: invalidated bills must not project as paid
        if (p.bill && isFinancialObligationInvalidated(p.bill.status)) return false;

        // Strict cycle authority - FAIL CLOSED if bill cycle cannot be resolved
        const resolvedCycleId = resolveRecordBillingCycleId(p.bill?.billingCycleId, (p.bill as any)?.cycleId, billingCycles);
        if (!resolvedCycleId || !effectiveCycleId || resolvedCycleId !== effectiveCycleId) return false;

        return true;
      })
      .sort((a, b) => new Date(b.paymentDate || b.createdAt).getTime() - new Date(a.paymentDate || a.createdAt).getTime());
  }, [paymentsData, effectiveCycleId, billingCycles]);

  // Consolidated Paid Summary Groups (1 card per billingCycle + tenantId + roomId)
  const consolidatedPaidGroups = useMemo(() => {
    const map = new Map<string, {
      id: string;
      roomId: string;
      roomNumber: string;
      tenantId?: string | null;
      tenantName: string;
      totalAmount: number;
      payments: PaymentRecord[];
      isHistorical: boolean;
      historicalLabel?: string;
      isDepositOnly: boolean;
      isRentOnly: boolean;
      latestPaidDate: string;
      paymentMethods: string[];
      slipUrl?: string | null;
    }>();

    paidPayments.forEach(p => {
      const cycleId = resolveRecordBillingCycleId(p.bill?.billingCycleId, (p.bill as any)?.cycleId, billingCycles) || effectiveCycleId || '';
      const roomId = p.bill?.roomId || (p as any).roomId || '';
      const tenantId = p.tenantId || p.bill?.tenantId || '';
      const key = `${cycleId}_${tenantId}_${roomId}`;

      const roomNum = p.bill?.room?.roomNumber || getRoomNum(roomId);
      const tenantName = p.bill?.tenant?.displayName || getTenantName(tenantId);
      const slipUrl = getSlipEvidenceUrl(p);
      const pAmt = Number(p.amount || p.bill?.totalAmount || 0);
      const isHist = Boolean(p.metadata?.isHistoricalImport || (p as any).isHistoricalImport);
      const histLabel = p.metadata?.originalPeriodLabel || (p.bill?.items?.find((it: any) => it.metadata?.isHistoricalImport)?.metadata?.originalPeriodLabel) || (p.bill?.billKind === 'DEPOSIT' ? 'เงินประกัน' : undefined);

      const existing = map.get(key);
      if (existing) {
        existing.totalAmount += pAmt;
        existing.payments.push(p);
        if (slipUrl && !existing.slipUrl) existing.slipUrl = slipUrl;
        if (isHist) {
          existing.isHistorical = true;
          if (histLabel && !existing.historicalLabel) existing.historicalLabel = histLabel;
        }
        const pMethod = (p.method || '').toUpperCase() === 'CASH' ? 'เงินสด' : 'โอน/แสกน';
        if (!existing.paymentMethods.includes(pMethod)) existing.paymentMethods.push(pMethod);
        if (new Date(p.paymentDate || p.createdAt).getTime() > new Date(existing.latestPaidDate).getTime()) {
          existing.latestPaidDate = p.paymentDate || p.createdAt;
        }
      } else {
        const pMethod = (p.method || '').toUpperCase() === 'CASH' ? 'เงินสด' : 'โอน/แสกน';
        map.set(key, {
          id: key,
          roomId,
          roomNumber: roomNum,
          tenantId,
          tenantName,
          totalAmount: pAmt,
          payments: [p],
          isHistorical: isHist,
          historicalLabel: histLabel,
          isDepositOnly: p.bill?.billKind === 'DEPOSIT',
          isRentOnly: p.bill?.billKind === 'RENT',
          latestPaidDate: p.paymentDate || p.createdAt,
          paymentMethods: [pMethod],
          slipUrl,
        });
      }
    });

    // Collect bill IDs that already have an entry in paidPayments
    const paidBillIds = new Set(paidPayments.map(p => p.billId).filter(Boolean));

    // Zero-amount settled bills in effective cycle (no fake payment, no fake receipt)
    const zeroSettledBills = bills.filter(b => {
      const resolvedCycleId = resolveRecordBillingCycleId(b.billingCycleId, b.cycleId, billingCycles);
      if (!resolvedCycleId || !effectiveCycleId || resolvedCycleId !== effectiveCycleId) return false;

      // Must be settled according to canonical predicate
      if (!isFinancialObligationSettled(b)) return false;

      // Must not already be accounted for via a Payment
      if (paidBillIds.has(b.id)) return false;

      return true;
    });

    zeroSettledBills.forEach(b => {
      const cycleId = resolveRecordBillingCycleId(b.billingCycleId, b.cycleId, billingCycles) || effectiveCycleId || '';
      const roomId = b.roomId || '';
      const tenantId = b.tenantId || '';
      const key = `${cycleId}_${tenantId}_${roomId}`;

      const roomNum = b.room?.roomNumber || getRoomNum(roomId);
      const tenantName = b.tenant?.displayName || getTenantName(tenantId);
      const isHist = Boolean((b as any).metadata?.isHistoricalImport || b.items?.some((it: any) => it.metadata?.isHistoricalImport));
      const histLabel = (b as any).metadata?.originalPeriodLabel || (b.items?.find((it: any) => it.metadata?.isHistoricalImport)?.metadata?.originalPeriodLabel) || (b.billKind === 'DEPOSIT' ? 'เงินประกัน' : undefined);

      const existing = map.get(key);
      if (existing) {
        if (isHist) {
          existing.isHistorical = true;
          if (histLabel && !existing.historicalLabel) existing.historicalLabel = histLabel;
        }
      } else {
        map.set(key, {
          id: key,
          roomId,
          roomNumber: roomNum,
          tenantId,
          tenantName,
          totalAmount: 0,
          payments: [],
          isHistorical: isHist,
          historicalLabel: histLabel,
          isDepositOnly: b.billKind === 'DEPOSIT',
          isRentOnly: b.billKind === 'RENT',
          latestPaidDate: b.billingDate ? String(b.billingDate) : new Date().toISOString(),
          paymentMethods: ['ปลอดค่าใช้จ่าย'],
          slipUrl: null,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [paidPayments, bills, billingCycles, effectiveCycleId, rooms, tenants]);

  // Consolidated Paid Daily Summary Groups (1 card per billingCycle + tenantId + roomId when tenantId exists, isolated when null)
  const consolidatedPaidDailyGroups = useMemo(() => {
    const map = new Map<string, {
      id: string;
      roomId: string;
      roomNumber: string;
      tenantId?: string | null;
      tenantName: string;
      phone?: string | null;
      totalAmount: number;
      invoices: typeof paidDailyInvoices;
      latestPaidDate: string;
    }>();

    paidDailyInvoices.forEach(inv => {
      const tenantId = inv.dailyStay?.tenantId;
      const roomId = inv.dailyStay?.roomId || inv.dailyStay?.room?.id || '';
      const key = tenantId ? `${effectiveCycleId}_${tenantId}_${roomId}` : `daily_${inv.id}`;

      const roomNum = inv.dailyStay?.room?.roomNumber || getRoomNum(roomId) || '-';
      const tenantName = inv.dailyStay?.tenant?.displayName || inv.dailyStay?.applicantFullName || 'ผู้พักรายวัน';
      const phone = inv.dailyStay?.applicantPhone || inv.dailyStay?.tenant?.phone;
      const totalAmt = Number(inv.totalAgreedAmount || 0);
      const paidDate = inv.updatedAt || inv.issuedAt;

      const existing = map.get(key);
      if (existing) {
        existing.totalAmount += totalAmt;
        existing.invoices.push(inv);
        if (new Date(paidDate).getTime() > new Date(existing.latestPaidDate).getTime()) {
          existing.latestPaidDate = paidDate;
        }
      } else {
        map.set(key, {
          id: key,
          roomId,
          roomNumber: roomNum,
          tenantId,
          tenantName,
          phone,
          totalAmount: totalAmt,
          invoices: [inv],
          latestPaidDate: paidDate,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [paidDailyInvoices, effectiveCycleId, rooms, tenants]);

  // Tab 4: Rejected (สลิปผิดพลาด) -> Strictly Selected Header Cycle ONLY (Fail Closed on missing bill cycle authority)
  const rejectedPayments = useMemo(() => {
    return paymentsData
      .filter(p => {
        const s = (p.status || '').toUpperCase();
        const isRejected = s === 'REJECTED';
        if (!isRejected) return false;

        // Strict cycle authority - FAIL CLOSED if bill cycle cannot be resolved
        const resolvedCycleId = resolveRecordBillingCycleId(p.bill?.billingCycleId, (p.bill as any)?.cycleId, billingCycles);
        if (!resolvedCycleId || !effectiveCycleId || resolvedCycleId !== effectiveCycleId) return false;

        return true;
      })
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime());
  }, [paymentsData, effectiveCycleId, billingCycles]);

  // General search filter helpers
  const filterConsolidatedGroupsByQuery = (list: typeof consolidatedPaidGroups) => {
    if (!searchQuery?.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(g => {
      return g.roomNumber.toLowerCase().includes(q) || g.tenantName.toLowerCase().includes(q);
    });
  };

  const filterConsolidatedDailyGroupsByQuery = (list: typeof consolidatedPaidDailyGroups) => {
    if (!searchQuery?.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(g => {
      return (
        g.roomNumber.toLowerCase().includes(q) ||
        g.tenantName.toLowerCase().includes(q) ||
        g.invoices.some(inv => (inv.invoiceNumber || '').toLowerCase().includes(q))
      );
    });
  };

  const filterPaymentsByQuery = (list: PaymentRecord[]) => {
    if (!searchQuery?.trim()) return list;
    const q = searchQuery.toLowerCase().trim();
    return list.filter(p => {
      const roomNum = getRoomNum(p.bill?.roomId || (p.bill as any)?.room?.roomNumber).toLowerCase();
      const tenantName = (
        p.bill?.tenant?.displayName ||
        p.bill?.tenant?.name ||
        getTenantName(p.tenantId || p.bill?.tenantId)
      ).toLowerCase();
      const billNum = (p.bill?.billNumber || '').toLowerCase();
      return roomNum.includes(q) || tenantName.includes(q) || billNum.includes(q);
    });
  };

  const filterBillsByQuery = (list: Bill[]) => {
    const q = (cashSearchQuery || searchQuery || '').toLowerCase().trim();
    if (!q) return list;
    return list.filter(b => {
      const roomNum = getRoomNum(b.roomId).toLowerCase();
      const tenantName = getTenantName(b.tenantId).toLowerCase();
      const billNum = (b.billNumber || '').toLowerCase();
      return roomNum.includes(q) || tenantName.includes(q) || billNum.includes(q);
    });
  };

  const filterDailyInvoicesByQuery = (list: DailyStayInvoice[]) => {
    const q = (cashSearchQuery || searchQuery || '').toLowerCase().trim();
    if (!q) return list;
    return list.filter(inv => {
      const roomNum = (inv.dailyStay?.room?.roomNumber || getRoomNum(inv.dailyStay?.roomId)).toLowerCase();
      const tenantName = (inv.dailyStay?.applicantFullName || inv.dailyStay?.tenant?.displayName || '').toLowerCase();
      const invoiceNo = (inv.invoiceNumber || '').toLowerCase();
      return roomNum.includes(q) || tenantName.includes(q) || invoiceNo.includes(q);
    });
  };

  const formatCheckoutDate = (inv: DailyStayInvoice) => {
    const dStr = inv.dailyStay?.checkOutDate || inv.dailyStay?.endDate;
    if (!dStr) return '-';
    try {
      return formatThaiDate(dStr);
    } catch {
      return dStr;
    }
  };

  const handleSettleDailyInvoice = async (invoiceId: string) => {
    const opId = `daily-cash:${invoiceId}`;
    const idempotencyKey = getIdempotencyKey(opId);
    try {
      setIsSubmittingCash(true);
      await httpRequest(
        'POST',
        `/daily-stays/invoices/${invoiceId}/settle-item`,
        { itemType: 'ALL' },
        {
          headers: {
            'x-dormitory-id': dormitoryId,
            'x-idempotency-key': idempotencyKey,
          },
        }
      );
      clearIdempotencyKey(opId);
      triggerToast('บันทึกการชำระเงินรายวันสำเร็จ');
      queryClient.invalidateQueries({ queryKey: queryKeys.dailyInvoices(dormitoryId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payments(dormitoryId) });
      onUpdateBills();
    } catch (err: any) {
      triggerToast(err?.message || 'เกิดข้อผิดพลาดในการบันทึกการชำระเงิน');
    } finally {
      setIsSubmittingCash(false);
    }
  };

  const startDailyCashPaymentWithCountdown = (inv: DailyStayInvoice) => {
    if (cashTimersRef.current[inv.id]) {
      clearInterval(cashTimersRef.current[inv.id]);
      delete cashTimersRef.current[inv.id];
    }

    setPendingCashMap(prev => ({ ...prev, [inv.id]: 5 }));
    let currentCount = 5;

    const timer = setInterval(() => {
      currentCount -= 1;
      if (currentCount <= 0) {
        if (cashTimersRef.current[inv.id]) {
          clearInterval(cashTimersRef.current[inv.id]);
          delete cashTimersRef.current[inv.id];
        }
        setPendingCashMap(prev => {
          const next = { ...prev };
          delete next[inv.id];
          return next;
        });
        handleSettleDailyInvoice(inv.id);
      } else {
        setPendingCashMap(prev => ({ ...prev, [inv.id]: currentCount }));
      }
    }, 1000);

    cashTimersRef.current[inv.id] = timer;
  };

  /* -------------------------------------------------------------------------
   * Server Mutation Handlers
   * ------------------------------------------------------------------------- */

  // Invalidate all related query keys
  const invalidateFinancialCaches = () => {
    if (!dormitoryId) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.payments(dormitoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.bills(dormitoryId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dailyInvoices(dormitoryId) });
    queryClient.invalidateQueries({ queryKey: ['meterPreviewContext'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.rooms(dormitoryId) });
    onUpdateBills();
  };

    // 1. Approve Slip Payment / Group (Stable Idempotency Key)
  const handleConfirmApprove = async (item: { isGroup: boolean; groupId?: string; paymentId?: string; roomNum: string }) => {
    if (!dormitoryId) return;
    const opId = item.isGroup ? `approve-group:${item.groupId}` : `approve:${item.paymentId}`;
    const endpoint = item.isGroup ? `/payments/combined-groups/${item.groupId}/approve` : `/payments/${item.paymentId}/approve`;
    const idempotencyKey = getIdempotencyKey(opId);
    try {
      await httpRequest(
        'POST',
        endpoint,
        {},
        {
          headers: {
            'x-dormitory-id': dormitoryId,
            'x-idempotency-key': idempotencyKey,
          },
        }
      );

      clearIdempotencyKey(opId);
      invalidateFinancialCaches();
      onAddLog('อนุมัติสลิปโอนเงิน', `ยืนยันความถูกต้องสลิปและปรับปรุงสถานะห้อง ${item.roomNum} ชำระแล้ว`, 'Payment', item.groupId || item.paymentId);
      triggerToast(`อนุมัติสลิปโอนเงิน ห้อง ${item.roomNum} เรียบร้อยแล้ว`);
    } catch (err: any) {
      console.error('Failed to approve payment:', err);
      triggerToast(`เกิดข้อผิดพลาดในการอนุมัติสลิป: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
    }
  };

  const startApproveCountdown = (item: { id: string; isGroup: boolean; groupId?: string; paymentId?: string; roomNum: string }) => {
    if (approveTimersRef.current[item.id]) {
      clearInterval(approveTimersRef.current[item.id]);
      delete approveTimersRef.current[item.id];
    }

    setPendingApproveMap(prev => ({ ...prev, [item.id]: 5 }));
    let currentCount = 5;

    const timer = setInterval(() => {
      currentCount -= 1;
      if (currentCount <= 0) {
        if (approveTimersRef.current[item.id]) {
          clearInterval(approveTimersRef.current[item.id]);
          delete approveTimersRef.current[item.id];
        }
        setPendingApproveMap(prev => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        handleConfirmApprove(item);
      } else {
        setPendingApproveMap(prev => ({ ...prev, [item.id]: currentCount }));
      }
    }, 1000);

    approveTimersRef.current[item.id] = timer;
  };

  // 2. Reject Slip Payment / Group
  const handleRejectPaymentOrGroup = async () => {
    if (!dormitoryId || !rejectPaymentTarget) return;
    const reasonText = rejectReason === 'อื่นๆ' ? rejectNote : rejectReason;
    const isGroup = !!(rejectPaymentTarget as any).isGroup || !!rejectPaymentTarget.paymentGroupId;
    const targetId = (rejectPaymentTarget as any).groupId || rejectPaymentTarget.paymentGroupId || rejectPaymentTarget.id;
    const roomNum = getRoomNum(rejectPaymentTarget.bill?.roomId || (rejectPaymentTarget as any).roomNum);
    const opId = isGroup ? `reject-group:${targetId}:${reasonText}` : `reject:${targetId}:${reasonText}`;
    const endpoint = isGroup ? `/payments/combined-groups/${targetId}/reject` : `/payments/${targetId}/reject`;

    try {
      await httpRequest(
        'POST',
        endpoint,
        { reason: reasonText },
        {
          headers: {
            'x-dormitory-id': dormitoryId,
            'x-idempotency-key': getIdempotencyKey(opId),
          }
        }
      );

      clearIdempotencyKey(opId);
      invalidateFinancialCaches();
      onAddLog('ปฏิเสธสลิปโอนเงิน', `ปฏิเสธสลิปเนื่องจาก: ${reasonText} ห้อง ${roomNum}`, 'Payment', targetId);
      setIsRejectOpen(false);
      setRejectPaymentTarget(null);
      triggerToast(`ปฏิเสธสลิปโอนเงิน ห้อง ${roomNum} เรียบร้อยแล้ว`);
    } catch (err: any) {
      console.error('Failed to reject payment:', err);
      triggerToast(`เกิดข้อผิดพลาดในการปฏิเสธสลิป: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
    }
  };

  // 3. Record Cash Payment (Single Bill Settlement Only)
  const handleConfirmCashPayment = async (bill: Bill) => {
    if (!dormitoryId) return;
    const roomNum = getRoomNum(bill.roomId);
    const amount = Number(bill.outstandingAmount ?? bill.totalAmount ?? 0);
    const amountStr = formatBaht(amount);
    const opId = `cash:${bill.id}:${amount}`;

    try {
      await httpRequest(
        'POST',
        '/payments/cash',
        {
          billId: bill.id,
          amount: String(amount),
        },
        {
          headers: {
            'x-dormitory-id': dormitoryId,
            'x-idempotency-key': getIdempotencyKey(opId),
          }
        }
      );

      clearIdempotencyKey(opId);
      invalidateFinancialCaches();
      onAddLog('รับชำระด้วยเงินสด', `รับชำระเงินสดจำนวน ${amountStr} จากห้อง ${roomNum} ณ เคาน์เตอร์`, 'Bill', bill.id);
      triggerToast(`บันทึกการรับเงินสด ห้อง ${roomNum} (${amountStr}) เรียบร้อยแล้ว`);
    } catch (err: any) {
      console.error('Failed to record cash payment:', err);
      triggerToast(`เกิดข้อผิดพลาดในการบันทึกเงินสด: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
    }
  };

  const startCashPaymentWithCountdown = (bill: Bill) => {
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
        handleConfirmCashPayment(bill);
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

  const cancelPendingApprove = (paymentId: string) => {
    if (approveTimersRef.current[paymentId]) {
      clearInterval(approveTimersRef.current[paymentId]);
      delete approveTimersRef.current[paymentId];
    }
    setPendingApproveMap(prev => {
      const next = { ...prev };
      delete next[paymentId];
      return next;
    });
  };

  // 4. Manual Cash Modal Submit
  const handleModalCashSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dormitoryId || !cashTargetBillId) return;

    const targetBill = bills.find(b => b.id === cashTargetBillId);
    if (!targetBill) return;

    const amount = customCashAmount ? Number(customCashAmount) : Number(targetBill.outstandingAmount ?? targetBill.totalAmount ?? 0);
    const opId = `cash:${targetBill.id}:${amount}`;
    setIsSubmittingCash(true);
    try {
      await httpRequest(
        'POST',
        '/payments/cash',
        {
          billId: targetBill.id,
          amount: String(amount),
        },
        {
          headers: {
            'x-dormitory-id': dormitoryId,
            'x-idempotency-key': getIdempotencyKey(opId),
          }
        }
      );

      clearIdempotencyKey(opId);
      invalidateFinancialCaches();
      onAddLog('รับชำระด้วยเงินสด', `รับชำระเงินสดจำนวน ${formatBaht(amount)} จากห้อง ${getRoomNum(targetBill.roomId)}`, 'Bill', targetBill.id);
      setIsCashModalOpen(false);
      triggerToast(`บันทึกการรับเงินสด ห้อง ${getRoomNum(targetBill.roomId)} เรียบร้อยแล้ว`);
    } catch (err: any) {
      console.error('Failed to submit cash modal:', err);
      triggerToast(`เกิดข้อผิดพลาด: ${err.message || 'กรุณาลองใหม่อีกครั้ง'}`);
    } finally {
      setIsSubmittingCash(false);
    }
  };

  // 5. Open Authoritative Final Receipt Directly (/api/v1/receipts/{id}/print)
  const handleOpenReceipt = async (paymentOrGroup: any) => {
    try {
      const billId = paymentOrGroup?.billId || paymentOrGroup?.bill?.id || (paymentOrGroup?.payments && paymentOrGroup.payments[0]?.billId);
      let receiptId: string | null = null;
      
      if (billId) {
        const token = localStorage.getItem('horplus_auth_token') || '';
        const res = await fetch(`/api/v1/receipts/final/bill/${billId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          receiptId = data?.id || null;
        }
      }

      if (receiptId) {
        window.open(`/api/v1/receipts/${receiptId}/print`, '_blank');
        return;
      }

      triggerToast('ไม่พบใบเสร็จรับเงินฉบับสมบูรณ์สำหรับรอบบิลนี้ กรุณาตรวจสอบว่าบิลได้รับการชำระครบถ้วนแล้ว');
    } catch (err) {
      triggerToast('ไม่สามารถเปิดใบเสร็จรับเงินได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  const handleOpenDailyReceipt = async (inv: DailyStayInvoice) => {
    try {
      let receiptId: string | null = null;
      
      if (inv?.id) {
        const token = localStorage.getItem('horplus_auth_token') || '';
        const res = await fetch(`/api/v1/receipts/final/daily-invoice/${inv.id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json();
          receiptId = data?.id || null;
        }
      }

      if (receiptId) {
        window.open(`/api/v1/receipts/${receiptId}/print`, '_blank');
        return;
      }

      triggerToast('ไม่พบใบเสร็จรับเงินฉบับสมบูรณ์สำหรับการเข้าพักรายวันนี้ กรุณาตรวจสอบว่ายอดเงินได้รับการชำระครบถ้วนแล้ว');
    } catch (err) {
      triggerToast('ไม่สามารถเปิดใบเสร็จรับเงินได้ กรุณาลองใหม่อีกครั้ง');
    }
  };

  return (
    <div className="space-y-6">
      {/* Floating Success Toast Portal */}
      {successToast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Server Error State Banner */}
      {isPaymentsError && (
        <div className="bg-rose-50 border border-rose-200 p-4 rounded-3xl flex items-center justify-between gap-3 text-rose-800 text-xs font-semibold shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4.5 h-4.5 text-rose-600 shrink-0" />
            <span>ไม่สามารถโหลดข้อมูลการชำระเงินได้ กรุณาลองใหม่อีกครั้ง</span>
          </div>
          <button
            type="button"
            onClick={() => refetchPayments()}
            className="px-3.5 py-1.5 bg-rose-600 text-white font-extrabold text-xs rounded-xl hover:bg-rose-700 transition-all cursor-pointer shadow-2xs"
          >
            โหลดข้อมูลใหม่
          </button>
        </div>
      )}

      {/* Filter Tabs & Quick Action Row */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs space-y-4 shrink-0">
        <div className="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full lg:w-auto flex-1 max-w-3xl">
            {/* Tab 1: รอตรวจสลิป (checking) -> ALL CYCLES */}
            <button
              type="button"
              onClick={() => { setActiveTab('checking'); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
                activeTab === 'checking'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <Clock className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <span className="truncate">รอตรวจสลิป ({checkingReviewItems.length})</span>
            </button>

            {/* Tab 2: ยังไม่ชำระ / บันทึกเงินสด (cash) -> SELECTED CYCLE ONLY */}
            <button
              type="button"
              onClick={() => { setActiveTab('cash'); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
                activeTab === 'cash'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <AlertCircle className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="truncate">ยังไม่ชำระ ({cashPendingBills.length + unpaidDailyInvoices.length})</span>
            </button>

            {/* Tab 3: ชำระแล้ว (paid) -> SELECTED CYCLE ONLY */}
            <button
              type="button"
              onClick={() => { setActiveTab('paid'); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
                activeTab === 'paid'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="truncate">ชำระแล้ว ({consolidatedPaidGroups.length + consolidatedPaidDailyGroups.length})</span>
            </button>

            {/* Tab 4: สลิปผิดพลาด (rejected) -> SELECTED CYCLE ONLY */}
            <button
              type="button"
              onClick={() => { setActiveTab('rejected'); }}
              className={`px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${
                activeTab === 'rejected'
                  ? 'bg-white text-indigo-600 shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="truncate">สลิปผิดพลาด ({rejectedPayments.length})</span>
            </button>
          </div>

          {/* Quick Actions (LINE + Manual Cash Modal) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLineModalOpen(true)}
              className="px-4 sm:px-5 py-2.5 sm:py-3 bg-[#06C755] hover:bg-[#05b34c] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer w-full lg:w-auto shrink-0 whitespace-nowrap"
            >
              <LineIcon className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">แจ้งเตือนผ่าน LINE</span>
            </button>
          </div>
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
       * TAB 1: รอตรวจสลิป (Checking Tab - ALL CYCLES)
       * ========================================================================= */}
      {activeTab === 'checking' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {checkingReviewItems
              .filter(item => {
                if (!searchQuery?.trim()) return true;
                const q = searchQuery.toLowerCase().trim();
                return item.roomNum.toLowerCase().includes(q) || item.tenantName.toLowerCase().includes(q);
              })
              .map(item => {
                return (
                  <div key={item.id} className="bg-white rounded-3xl border border-amber-200 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-black text-slate-900 shrink-0">ห้อง {item.roomNum}</span>
                      <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
                        {item.isGroup ? (
                          <>
                            {item.affectedOrigins[0]?.cycleLabel && (
                              <span className="inline-flex whitespace-nowrap shrink-0 px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold rounded-full text-[10px]">
                                งวด {item.affectedOrigins[0].cycleLabel}
                              </span>
                            )}
                            <span className="inline-flex whitespace-nowrap shrink-0 px-2.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 font-bold rounded-full text-[10px]">
                              รวม {item.affectedOrigins.length} บิล
                            </span>
                          </>
                        ) : (
                          <span className="inline-flex whitespace-nowrap shrink-0 px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold rounded-full text-[10px]">
                            {item.affectedOrigins[0]?.cycleLabel ? `งวด ${item.affectedOrigins[0].cycleLabel}` : 'ไม่พบข้อมูลงวดบิล'}
                          </span>
                        )}
                        {Boolean(item.isGroup && item.affectedOrigins[0]?.cycleLabel) ? (
                          <span
                            className="inline-flex whitespace-nowrap shrink-0 p-1.5 bg-amber-50 text-amber-800 border border-amber-200 font-extrabold rounded-full text-[11px] items-center justify-center"
                            title="รอตรวจสลิป"
                            aria-label="รอตรวจสลิป"
                          >
                            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                          </span>
                        ) : (
                          <span className="inline-flex whitespace-nowrap shrink-0 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 font-extrabold rounded-full text-[11px] items-center gap-1" title="รอตรวจสลิป" aria-label="รอตรวจสลิป">
                            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                            <span>รอตรวจสลิป</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs">
                      <p className="font-bold text-slate-800 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">{item.tenantName}</span>
                      </p>
                    </div>

                    {item.slipUrl ? (
                      <div
                        onClick={() => setViewingSlipUrl(item.slipUrl!)}
                        className="relative bg-slate-50 border border-slate-200 rounded-2xl h-36 flex items-center justify-center p-2 cursor-pointer hover:border-indigo-400 transition-all overflow-hidden"
                      >
                        <img
                          src={item.slipUrl}
                          alt="สลิปโอนเงิน"
                          className="max-h-full max-w-full object-contain rounded-xl hover:scale-105 transition-transform"
                        />
                      </div>
                    ) : (
                      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl h-24 flex items-center justify-center text-slate-400 text-xs font-semibold">
                        ไม่มีไฟล์สลิปแนบ
                      </div>
                    )}

                    <div
                      onClick={() => {
                        if (item.affectedOrigins[0]?.bill) {
                          setViewingBillDetail({ bill: item.affectedOrigins[0].bill, tenantName: item.tenantName, roomNum: item.roomNum });
                        }
                      }}
                      className={`flex items-baseline justify-between pt-1 border-t border-slate-100 ${item.affectedOrigins[0]?.bill ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                    >
                      <span className="text-xs text-slate-400 font-bold">ยอดรอตรวจสอบ</span>
                      <span className="text-lg font-black text-indigo-600">{formatBaht(item.totalAmount)}</span>
                    </div>

                    {pendingApproveMap[item.id] !== undefined ? (
                      <div className="bg-amber-50 border border-amber-300 p-2.5 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs animate-in fade-in">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold">
                          <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                          <span>กำลังอนุมัติ ({pendingApproveMap[item.id]}s)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelPendingApprove(item.id)}
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
                            setRejectPaymentTarget(item.payments[0] || (item as any));
                            setIsRejectOpen(true);
                          }}
                          className="py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer border border-rose-200/60"
                        >
                          <X className="w-4 h-4 text-rose-600" />
                          ปฏิเสธ
                        </button>
                        <button
                          type="button"
                          onClick={() => startApproveCountdown(item)}
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

          {checkingReviewItems.length === 0 && (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
              ไม่มีสลิปรอตรวจสอบในขณะนี้
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
       * TAB 2: ยังไม่ชำระ / บันทึกเงินสด (Cash Tab - SELECTED CYCLE ONLY)
       * ========================================================================= */}
      {activeTab === 'cash' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filterBillsByQuery(cashPendingBills).map(b => {
              const tenantName = getTenantName(b.tenantId);
              const roomNum = resolveAuthoritativeRoomNum(b);
              const isOverdue = b.status === 'overdue' || (b.dueDate && new Date(b.dueDate) < new Date());
              const overdueDays = getBillOverdueDays(b.dueDate);
              const amount = Number(b.outstandingAmount ?? b.totalAmount ?? 0);
              const isDepositBill = b.billKind === 'DEPOSIT';
              const isRentBill = b.billKind === 'RENT' || b.items?.some((it: any) => it.type === 'RENT' || (it.description || '').includes('ค่าเช่า'));
              const isDeposit = isDepositBill || b.items?.some((it: any) => it.type === 'DEPOSIT' || it.itemType === 'DEPOSIT' || (it.description || '').includes('ประกัน') || (it.description || '').includes('มัดจำ'));
              const isDepositOrRent = isDeposit || isRentBill;

              const startDate = resolveAuthoritativeStartDate(b);

              return (
                <div key={b.id} className="bg-white rounded-3xl border border-slate-200/90 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                    <div className="flex items-center gap-1">
                      {isDepositBill && (
                        <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 font-bold rounded-full text-[10px] whitespace-nowrap">
                          เงินประกัน
                        </span>
                      )}
                      {isRentBill && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 font-bold rounded-full text-[10px] whitespace-nowrap">
                          ค่าเช่า
                        </span>
                      )}
                      {Number(b.paidAmount || 0) > 0 ? (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          ชำระบางส่วน
                        </span>
                      ) : (
                        <span className={`px-3 py-1 border font-extrabold rounded-full text-[11px] flex items-center gap-1 ${
                          isOverdue ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                          <AlertCircle className="w-3.5 h-3.5" />
                          {isOverdue ? `เกิน ${overdueDays > 0 ? `${overdueDays} วัน` : 'กำหนด'}` : 'ยังไม่ชำระ'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {tenantName}
                    </p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {isDepositOrRent ? (
                        <>วันที่เริ่มเข้าพัก: <span className="font-bold text-slate-700">{startDate ? formatThaiDate(startDate) : '-'}</span></>
                      ) : (
                        <>กำหนดชำระ: <span className="font-bold text-slate-700">{b.dueDate ? formatThaiDate(b.dueDate) : '-'}</span></>
                      )}
                    </p>
                  </div>

                  {/* Items summary & Partial details */}
                  <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-100 pt-2">
                    {(() => {
                      const sortedNonZero = sortCanonicalBillItems(b.items);
                      const count = sortedNonZero.length;
                      const isPartial = Number(b.paidAmount || 0) > 0;

                      // PARTIAL PAYMENT CARD: Replace inline section with compact popover trigger inside yellow summary
                      if (isPartial) {
                        return (
                          <div
                            data-partial-popover={b.id}
                            className="bg-amber-50/90 border border-amber-200/90 rounded-2xl p-3 text-[11px] space-y-1.5 text-amber-950 relative"
                          >
                            <div className="flex justify-between items-center text-slate-600">
                              <span>ยอดรวมเดิม:</span>
                              <span className="font-semibold text-slate-800">{formatBaht(Number(b.totalAmount))}</span>
                            </div>
                            <div className="flex justify-between items-center text-emerald-700">
                              <span className="font-medium">ชำระแล้ว:</span>
                              <span className="font-bold">-{formatBaht(Number(b.paidAmount))}</span>
                            </div>
                            <div className="flex justify-between items-center text-amber-900 border-t border-amber-200/60 pt-1">
                              <span className="font-bold">ยอดที่ต้องชำระ:</span>
                              <span className="font-black text-amber-950">{formatBaht(amount)}</span>
                            </div>

                            {/* Anchored popover toggle button inside yellow summary */}
                            <div className="pt-1 flex items-center justify-between">
                              <button
                                type="button"
                                onClick={() => setOpenPartialPopoverId(openPartialPopoverId === b.id ? null : b.id)}
                                className="text-[11px] font-extrabold text-amber-900 hover:text-amber-950 bg-amber-200/60 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                              >
                                <span>
                                  {openPartialPopoverId === b.id ? 'ซ่อนรายละเอียด' : `ดูรายละเอียด +${count}`}
                                </span>
                                {openPartialPopoverId === b.id ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>

                            {/* Small Anchored Popover / Panel */}
                            {openPartialPopoverId === b.id && (
                              <div
                                className="absolute left-0 right-0 top-full mt-1.5 z-30 bg-white border border-amber-300 rounded-2xl p-3 shadow-xl space-y-1.5 animate-in fade-in zoom-in-95 duration-100 text-xs"
                              >
                                <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                                  <span className="font-black text-slate-800 text-[11px]">รายการค่าใช้จ่าย</span>
                                  <span className="text-[10px] text-slate-400 font-medium">({count} รายการ)</span>
                                </div>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                  {sortedNonZero.map((it, idx) => (
                                    <div key={idx} className="flex justify-between items-center py-0.5">
                                      <span className="truncate pr-2 text-slate-600 font-medium text-[11px]">
                                        {formatCanonicalLineItemDescription(it)}
                                      </span>
                                      <span className="font-bold text-slate-900 shrink-0 font-mono text-[11px]">
                                        {formatBaht(it.amount)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }

                      // NORMAL (NON-PARTIAL) BILL: Standard inline display
                      if (count === 0) {
                        return (
                          <div className="flex justify-between items-center">
                            <span className="text-slate-500">ค่าเช่าและบริการ:</span>
                            <span className="font-semibold text-slate-700">{formatBaht(amount)}</span>
                          </div>
                        );
                      }

                      // 1 to 3 items: always show all items directly; NO detail button / toggle
                      if (count <= 3) {
                        return (
                          <div className="space-y-1 mb-1.5">
                            {sortedNonZero.map((it, idx) => (
                              <div key={idx} className="flex justify-between items-center">
                                <span className="truncate pr-1 text-slate-500 font-medium">
                                  {formatCanonicalLineItemDescription(it)}:
                                </span>
                                <span className="font-semibold text-slate-700 shrink-0">{formatBaht(it.amount)}</span>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // More than 3 items: collapsed shows first 3 + button; expanded shows all + button
                      const isExpanded = expandedBillDetails.has(b.id);
                      const visibleItems = isExpanded ? sortedNonZero : sortedNonZero.slice(0, 3);
                      const hiddenCount = count - 3;

                      return (
                        <div>
                          <div className="space-y-1 mb-1.5">
                            {visibleItems.map((it, idx) => (
                              <div key={idx} className="flex justify-between items-center">
                                <span className="truncate pr-1 text-slate-500 font-medium">
                                  {formatCanonicalLineItemDescription(it)}:
                                </span>
                                <span className="font-semibold text-slate-700 shrink-0">{formatBaht(it.amount)}</span>
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleBillDetail(b.id)}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 pt-0.5 cursor-pointer"
                          >
                            <span>{isExpanded ? 'ซ่อนรายละเอียด' : `ดูรายละเอียด +${hiddenCount}`}</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400 font-bold">ยอดที่ต้องชำระ</span>
                    </div>
                    <span className="text-lg font-black text-slate-900">{formatBaht(amount)}</span>
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
                        onClick={() => {
                          setTargetScrollTenantId(b.tenantId || null);
                          setIsLineModalOpen(true);
                        }}
                        className="py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                      >
                        <LineIcon className="w-3.5 h-3.5" />
                        เตือน LINE
                      </button>
                      <button
                        type="button"
                        onClick={() => startCashPaymentWithCountdown(b)}
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
            {filterDailyInvoicesByQuery(unpaidDailyInvoices).map((inv) => {
              const roomNum = inv.dailyStay?.room?.roomNumber || getRoomNum(inv.dailyStay?.roomId) || '-';
              const tenantName = inv.dailyStay?.applicantFullName || inv.dailyStay?.tenant?.displayName || 'ผู้พักรายวัน';
              const amount = Number(inv.outstandingAmount ?? inv.totalAgreedAmount ?? 0);
              const isPartiallyPaid = (inv.status || '').toUpperCase() === 'PARTIALLY_PAID';

              return (
                <div key={inv.id} className="bg-white rounded-3xl border border-emerald-200/90 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                    <div className="flex items-center gap-1">
                      <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold rounded-full text-[10px]">
                        รายวัน
                      </span>
                      {isPartiallyPaid ? (
                        <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          ชำระบางส่วน
                        </span>
                      ) : (
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          ยังไม่ชำระ
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {tenantName}
                    </p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      วันเช็คเอาท์: <span className="font-bold text-slate-700">{formatCheckoutDate(inv)}</span>
                    </p>
                  </div>

                  {/* Items summary */}
                  <div className="text-[11px] text-slate-500 space-y-1 border-t border-slate-100 pt-2">
                    {(() => {
                      const unpaidItems = (inv.items || []).filter(
                        (it: any) => it.status !== 'SETTLED' && it.status !== 'DECLARED_PAID' && (it.status === 'OUTSTANDING' || !it.status)
                      );
                      return unpaidItems.length > 0 ? (
                        unpaidItems.map((it: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center">
                            <span className="truncate pr-1 text-slate-500 font-medium">
                              {formatCanonicalLineItemDescription({
                                description: it.description || (it.itemType === 'DAILY_RENT' ? 'ค่าเช่า (รายวัน)' : it.itemType),
                                type: it.itemType === 'DAILY_RENT' ? 'rent' : it.itemType === 'DAILY_DEPOSIT' ? 'deposit' : it.itemType,
                                quantity: it.quantity,
                                unitPrice: it.unitPrice,
                              }, { rentCycle: 'daily' })}:
                            </span>
                            <span className="font-semibold text-slate-700 shrink-0">{formatBaht(Number(it.amount))}</span>
                          </div>
                        ))
                      ) : (
                        <div className="flex justify-between items-center">
                          <span className="text-slate-500">ค่าเช่า (รายวัน):</span>
                          <span className="font-semibold text-slate-700">{formatBaht(amount)}</span>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <span className="text-xs text-slate-400 font-bold">ยอดที่ต้องชำระ</span>
                    <span className="text-lg font-black text-slate-900">{formatBaht(amount)}</span>
                  </div>

                  {pendingCashMap[inv.id] !== undefined ? (
                    <div className="bg-amber-50 border border-amber-300 p-2.5 rounded-2xl flex items-center justify-between gap-2 text-amber-900 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold">
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-amber-600 shrink-0" />
                        <span>บันทึกเงินสด ({pendingCashMap[inv.id]}s)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => cancelPendingCashPayment(inv.id)}
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
                          setTargetScrollTenantId(inv.dailyStay?.tenantId || inv.dailyStay?.tenant?.id || null);
                          setIsLineModalOpen(true);
                        }}
                        className="py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
                      >
                        <LineIcon className="w-3.5 h-3.5" />
                        เตือน LINE
                      </button>
                      <button
                        type="button"
                        disabled={isSubmittingCash}
                        onClick={() => startDailyCashPaymentWithCountdown(inv)}
                        className="py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer"
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

          {filterBillsByQuery(cashPendingBills).length === 0 && filterDailyInvoicesByQuery(unpaidDailyInvoices).length === 0 && (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
              ไม่พบห้องพักค้างชำระในรอบบิลนี้
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
       * TAB 3: ชำระแล้ว (Paid Tab - SELECTED CYCLE ONLY - CONSOLIDATED PER ROOM)
       * ========================================================================= */}
      {activeTab === 'paid' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filterConsolidatedGroupsByQuery(consolidatedPaidGroups).map(group => {
              return (
                <div key={group.id} className="bg-white rounded-3xl border border-emerald-100 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {group.roomNumber}</span>
                    <div className="flex items-center gap-1">
                      {group.isHistorical ? (
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 font-bold rounded-full text-[10px] whitespace-nowrap">
                          ก่อนใช้ HorPlus • {group.historicalLabel || 'ประวัติเดิม'}
                        </span>
                      ) : group.isDepositOnly && group.payments.length === 1 ? (
                        <span className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 font-bold rounded-full text-[10px] whitespace-nowrap">
                          เงินประกัน
                        </span>
                      ) : group.isRentOnly && group.payments.length === 1 ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 font-bold rounded-full text-[10px] whitespace-nowrap">
                          ค่าเช่า
                        </span>
                      ) : null}
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ชำระแล้ว
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {group.tenantName}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50">
                      <span>ช่องทาง: <strong className="text-slate-700">{group.paymentMethods.join(', ')}</strong></span>
                      <span>
                        {group.isHistorical && !group.payments.some(p => p.paymentDate)
                          ? 'ก่อนเริ่มใช้ HorPlus'
                          : formatThaiDate(group.latestPaidDate)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <span className="text-xs text-slate-400 font-bold">ยอดชำระสำเร็จ</span>
                    <span className="text-lg font-black text-emerald-600">{formatBaht(group.totalAmount)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {group.slipUrl ? (
                      <button
                        type="button"
                        onClick={() => setViewingSlipUrl(group.slipUrl || null)}
                        className="py-2.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer border border-slate-200/60"
                      >
                        <Eye className="w-4 h-4 text-indigo-600" />
                        ดูสลิป
                      </button>
                    ) : (
                      <div className="py-2.5 bg-slate-50 text-slate-400 font-bold text-xs rounded-xl flex items-center justify-center border border-slate-100">
                        {group.isHistorical ? 'ประวัติเดิม' : 'ไม่มีสลิป'}
                      </div>
                    )}
                    {group.payments.length >= 1 ? (
                      <button
                        type="button"
                        onClick={() => handleOpenReceipt(group.payments[0])}
                        className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-xs"
                      >
                        <Printer className="w-4 h-4" />
                        ใบเสร็จรับเงิน
                      </button>
                    ) : (
                      <div className="py-2.5 bg-slate-50 text-slate-400 font-bold text-xs rounded-xl flex items-center justify-center border border-slate-100">
                        ปลอดค่าใช้จ่าย
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {filterConsolidatedDailyGroupsByQuery(consolidatedPaidDailyGroups).map((group) => {
              const firstInv = group.invoices[0];

              return (
                <div key={group.id} className="bg-white rounded-3xl border border-emerald-100 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {group.roomNumber}</span>
                    <div className="flex items-center gap-1">
                      <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold rounded-full text-[10px]">
                        รายวัน
                      </span>
                      <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ชำระแล้ว
                      </span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50/80 rounded-2xl space-y-1.5 text-xs">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {group.tenantName}
                    </p>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-200/50">
                      <span>ช่องทาง: <strong className="text-slate-700">เงินสด</strong></span>
                      <span>{group.latestPaidDate ? formatThaiDate(group.latestPaidDate) : '-'}</span>
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <span className="text-xs text-slate-400 font-bold">ยอดชำระสำเร็จรวม</span>
                    <span className="text-lg font-black text-emerald-600">{formatBaht(group.totalAmount)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="py-2.5 bg-slate-50 text-slate-400 font-bold text-xs rounded-xl flex items-center justify-center border border-slate-100">
                      ไม่มีสลิป
                    </div>
                    <button
                      type="button"
                      onClick={() => handleOpenDailyReceipt(firstInv)}
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

          {filterConsolidatedGroupsByQuery(consolidatedPaidGroups).length === 0 && filterConsolidatedDailyGroupsByQuery(consolidatedPaidDailyGroups).length === 0 && (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
              ไม่พบบิลที่ชำระแล้วในรอบบิลนี้
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
       * TAB 4: สลิปผิดพลาด (Rejected Tab - SELECTED CYCLE ONLY)
       * ========================================================================= */}
      {activeTab === 'rejected' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filterPaymentsByQuery(rejectedPayments).map(p => {
              const roomNum = resolveAuthoritativeRoomNum(p.bill, p);
              const tenantName = p.bill?.tenant?.displayName || getTenantName(p.tenantId || p.bill?.tenantId);
              const slipUrl = getSlipEvidenceUrl(p);
              const amount = Number(p.amount || p.bill?.totalAmount || 0);

              const isDepositBill = p.bill?.billKind === 'DEPOSIT';
              const isRentBill = p.bill?.billKind === 'RENT' || p.bill?.items?.some((it: any) => it.type === 'RENT' || (it.description || '').includes('ค่าเช่า'));
              const isDeposit = isDepositBill || p.bill?.items?.some((it: any) => it.type === 'DEPOSIT' || it.itemType === 'DEPOSIT' || (it.description || '').includes('ประกัน') || (it.description || '').includes('มัดจำ'));
              const isDepositOrRent = isDeposit || isRentBill;
              const startDate = resolveAuthoritativeStartDate(p.bill, p);

              return (
                <div key={p.id} className="bg-white rounded-3xl border border-rose-200/90 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xl font-black text-slate-900">ห้อง {roomNum}</span>
                    <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200 font-extrabold rounded-full text-[11px] flex items-center gap-1">
                      <XCircle className="w-3.5 h-3.5 text-rose-600" />
                      สลิปผิดพลาด
                    </span>
                  </div>

                  <div className="text-xs space-y-1">
                    <p className="font-bold text-slate-800 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      {tenantName}
                    </p>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      {isDepositOrRent ? (
                        <>วันที่เริ่มเข้าพัก: <span className="font-bold text-slate-700">{startDate ? formatThaiDate(startDate) : '-'}</span></>
                      ) : (
                        <>กำหนดชำระ: <span className="font-bold text-slate-700">{p.bill?.dueDate ? formatThaiDate(p.bill.dueDate) : '-'}</span></>
                      )}
                    </p>
                  </div>

                  <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-2xl text-xs text-rose-800 space-y-1">
                    <p className="font-extrabold text-[11px] flex items-center gap-1 text-rose-900">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      เหตุผลที่ปฏิเสธ:
                    </p>
                    <p className="text-[11px] font-medium leading-tight">{p.rejectedReason || 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้'}</p>
                  </div>

                  {slipUrl ? (
                    <div
                      onClick={() => setViewingSlipUrl(slipUrl)}
                      className="relative bg-slate-50 border border-slate-200 rounded-2xl h-28 flex items-center justify-center p-2 cursor-pointer hover:border-rose-400 transition-all group overflow-hidden"
                    >
                      <img
                        src={slipUrl}
                        alt="สลิปปฏิเสธ"
                        className="max-h-full max-w-full object-contain rounded-xl group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-xs font-bold rounded-2xl">
                        <Eye className="w-4 h-4" />
                        คลิกดูสลิปที่แนบ
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl h-20 flex items-center justify-center text-slate-400 text-xs">
                      ไม่มีภาพสลิป
                    </div>
                  )}

                  <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-400 font-bold">ยอดค้างชำระ</span>
                    </div>
                    <span className="text-lg font-black text-rose-600">{formatBaht(amount)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetScrollTenantId(p.tenantId || p.bill?.tenantId || null);
                        setIsLineModalOpen(true);
                      }}
                      className="py-2.5 bg-[#06C755] hover:bg-[#05b34c] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-2xs transition-all cursor-pointer"
                    >
                      <LineIcon className="w-3.5 h-3.5" />
                      ให้แนบใหม่
                    </button>
                    {p.bill && (
                      (() => {
                        const isBillSettled = p.bill.status === 'PAID' || p.bill.status === 'paid' || Number(p.bill.outstandingAmount ?? 0) <= 0;
                        if (isBillSettled) {
                          return (
                            <div className="py-2.5 bg-emerald-50 text-emerald-700 font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 border border-emerald-200">
                              <CheckCircle className="w-4 h-4 text-emerald-600" />
                              ชำระครบแล้ว
                            </div>
                          );
                        }

                        if (pendingCashMap[p.bill.id] !== undefined) {
                          return (
                            <div className="bg-amber-50 border border-amber-300 p-2 rounded-xl flex items-center justify-between gap-1 text-amber-900 shadow-2xs animate-in fade-in col-span-2 sm:col-span-1">
                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <RotateCw className="w-3 h-3 animate-spin text-amber-600 shrink-0" />
                                <span>บันทึก ({pendingCashMap[p.bill.id]}s)</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    cancelPendingCashPayment(p.bill.id);
                                    handleConfirmCashPayment(p.bill as any);
                                  }}
                                  className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer shrink-0"
                                >
                                  ทันที
                                </button>
                                <button
                                  type="button"
                                  onClick={() => cancelPendingCashPayment(p.bill.id)}
                                  className="px-1.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-xs transition-all cursor-pointer shrink-0 flex items-center"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <button
                            type="button"
                            onClick={() => startCashPaymentWithCountdown(p.bill as any)}
                            className="py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 shadow-xs transition-all cursor-pointer"
                          >
                            <DollarSign className="w-4 h-4" />
                            รับเงินสด
                          </button>
                        );
                      })()
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {filterPaymentsByQuery(rejectedPayments).length === 0 && (
            <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center text-slate-400 font-bold text-xs">
              ไม่มีสลิปผิดพลาดในรอบบิลนี้
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
       * MODALS
       * ========================================================================= */}

      {/* Rejection Prompt Modal */}
      <Modal isOpen={isRejectOpen} onClose={() => { setIsRejectOpen(false); setRejectPaymentTarget(null); }} title="ระบุเหตุผลการปฏิเสธสลิป">
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
              onClick={() => { setIsRejectOpen(false); setRejectPaymentTarget(null); }}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleRejectPaymentOrGroup}
              className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl"
            >
              ปฏิเสธและส่งคืนบิล
            </button>
          </div>
        </div>
      </Modal>

      {/* Manual Cash Recording Modal */}
      <Modal isOpen={isCashModalOpen} onClose={() => setIsCashModalOpen(false)} title="บันทึกจ่ายด้วยเงินสด ณ เคาน์เตอร์">
        <form onSubmit={handleModalCashSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">เลือกบิลค้างชำระเป้าหมาย *</label>
            <select
              required
              value={cashTargetBillId}
              onChange={(e) => {
                setCashTargetBillId(e.target.value);
                const tb = bills.find(b => b.id === e.target.value);
                if (tb) {
                  setCustomCashAmount(String(tb.outstandingAmount ?? tb.totalAmount ?? ''));
                }
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white font-semibold text-slate-700"
            >
              <option value="">-- เลือกห้องพักที่มีบิลค้างชำระ --</option>
              {cashPendingBills.map(b => (
                <option key={b.id} value={b.id}>
                  ห้อง {getRoomNum(b.roomId)} &bull; ยอดคงเหลือ: {formatBaht(Number(b.outstandingAmount ?? b.totalAmount ?? 0))}
                </option>
              ))}
            </select>
          </div>

          {(() => {
            const tb = bills.find(b => b.id === cashTargetBillId);
            if (!tb) return null;
            return (
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5 text-slate-700">
                <div className="flex justify-between">
                  <span>ยอดรวมบิล:</span>
                  <span className="font-bold">{formatBaht(Number(tb.totalAmount || 0))}</span>
                </div>
                <div className="flex justify-between">
                  <span>ชำระแล้ว:</span>
                  <span className="font-bold text-emerald-600">{formatBaht(Number(tb.paidAmount || 0))}</span>
                </div>
                <div className="flex justify-between border-t border-slate-200 pt-1">
                  <span>ยอดคงเหลือปัจจุบัน:</span>
                  <span className="font-extrabold text-indigo-600">{formatBaht(Number(tb.outstandingAmount ?? tb.totalAmount ?? 0))}</span>
                </div>
              </div>
            );
          })()}

          <div className="space-y-1">
            <label className="block font-bold text-slate-700">จำนวนเงินที่รับ *</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={(() => {
                const tb = bills.find(b => b.id === cashTargetBillId);
                return tb ? Number(tb.outstandingAmount ?? tb.totalAmount ?? 0) : undefined;
              })()}
              required
              value={customCashAmount}
              onChange={(e) => setCustomCashAmount(e.target.value)}
              placeholder="ระบุจำนวนเงินสดที่รับ"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white font-bold text-slate-900 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block font-bold text-slate-500">วันที่และเวลารับเงิน</label>
              <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-medium">
                บันทึกอัตโนมัติจากเวลาระบบ
              </div>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-500">ผู้รับเงินสด</label>
              <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 font-bold truncate">
                {currentAuthUserName}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-100 flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => setIsCashModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmittingCash || !cashTargetBillId || !customCashAmount || Number(customCashAmount) <= 0}
              className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs disabled:opacity-50"
            >
              {isSubmittingCash ? 'กำลังบันทึก...' : 'บันทึกจ่ายเงินสด'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Printable Receipt Modal */}
      <Modal isOpen={isReceiptOpen} onClose={() => setIsReceiptOpen(false)} title="ใบเสร็จรับเงิน" size="lg">
        {viewingReceipt && (
          <PrintView title="พิมพ์ใบเสร็จ">
            <div className="space-y-5 text-xs text-slate-900 font-sans max-w-xl mx-auto leading-relaxed">
              <div className="flex justify-between items-start border-b border-slate-300 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
                    <img
                      src={selectedDormitory?.id ? `/api/v1/dormitories/${selectedDormitory.id}/logo` : '/favicon.ico'}
                      alt="Logo"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm leading-tight">
                      {selectedDormitory?.name || viewingReceipt.dormitoryName || 'หอพัก HorPlus'}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {selectedDormitory?.phone || viewingReceipt.dormitoryPhone ? `โทร. ${selectedDormitory?.phone || viewingReceipt.dormitoryPhone}` : 'โทร. 081-234-5678'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <h4 className="font-extrabold text-slate-950 text-sm uppercase leading-tight">ใบเสร็จรับเงิน</h4>
                  <p className="text-[11px] text-slate-600 font-semibold mt-1">เลขที่: {viewingReceipt.receiptNumber}</p>
                  {viewingReceipt.isHistorical && !viewingReceipt.originalPaymentDateKnown ? (
                    <>
                      <p className="text-[10px] text-amber-700 font-semibold mt-0.5">วันที่ชำระเดิม: ไม่ทราบวันที่ชำระเดิม</p>
                      {viewingReceipt.importedAt && (
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">วันที่นำเข้าระบบ: {formatThaiDate(viewingReceipt.importedAt)}</p>
                      )}
                    </>
                  ) : viewingReceipt.paidAt ? (
                    <p className="text-[10px] text-slate-500 font-medium mt-0.5">วันที่ออก: {formatThaiDate(viewingReceipt.paidAt)}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 font-medium">ชำระจากห้องพัก:</span>
                  <p className="font-bold text-slate-900 mt-0.5">ห้อง {viewingReceipt.roomNumber}</p>
                </div>
                <div>
                  <span className="text-slate-500 font-medium">ผู้ชำระเงิน:</span>
                  <p className="font-bold text-slate-900 mt-0.5">{viewingReceipt.tenantName}</p>
                </div>
              </div>

              {viewingReceipt.isMultiBill && viewingReceipt.billGroups && viewingReceipt.billGroups.length > 0 ? (
                /* Multi-Bill Receipt Section */
                <div className="space-y-4">
                  {viewingReceipt.billGroups.map((group, gIdx) => (
                    <div key={gIdx} className="space-y-2 border border-slate-300 rounded-2xl p-3 bg-white">
                      <div className="flex justify-between items-center text-xs pb-1 border-b border-slate-200">
                        <span className="font-extrabold text-slate-800">{group.cycleLabel}</span>
                        <span className="text-[11px] text-slate-500 font-medium">เลขที่บิล: {group.billNumber}</span>
                      </div>

                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                          <tr>
                            <th className="p-2">รายการ</th>
                            <th className="p-2 text-center">จำนวน</th>
                            <th className="p-2 text-right">ราคา/หน่วย</th>
                            <th className="p-2 text-right">จำนวนเงิน</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.items.map((it, idx) => (
                            <tr key={idx}>
                              <td className="p-2 text-slate-800 font-medium align-top">
                                <div>{formatCanonicalLineItemDescription(it)}</div>
                                <TierBreakdownView metadata={it.metadata} unit={it.unit} isPrint />
                              </td>
                              <td className="p-2 text-center text-slate-600 font-medium align-top">{formatBillingQuantity(it.quantity, it.unit)}</td>
                              <td className="p-2 text-right text-slate-600 font-medium align-top">{formatTierRateLabel(it.unitPrice, it.unit, it.metadata)}</td>
                              <td className="p-2 text-right font-bold text-slate-900 align-top">{formatBaht(it.amount)}</td>
                            </tr>
                          ))}
                          <tr className="bg-slate-50/50 text-slate-600 text-[11px]">
                            <td colSpan={3} className="p-2 text-right font-semibold">ยอดบิล:</td>
                            <td className="p-2 text-right font-bold text-slate-700">{formatBaht(group.billTotal)}</td>
                          </tr>
                          <tr className="bg-slate-50/80 text-slate-700 text-[11px] font-bold">
                            <td colSpan={3} className="p-2 text-right">ยอดรับชำระสำหรับรอบบิลนี้:</td>
                            <td className="p-2 text-right text-indigo-700 font-extrabold">{formatBaht(group.allocatedAmount)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}

                  <div className="bg-slate-100 p-3 rounded-xl border border-slate-300 flex justify-between items-center text-xs font-black">
                    <span className="text-slate-900 text-sm font-black">รวมรับสุทธิ:</span>
                    <span className="text-indigo-900 text-base font-black">{formatBaht(viewingReceipt.totalAmount)}</span>
                  </div>
                </div>
              ) : (
                /* Single-Bill Receipt Section */
                <div className="space-y-3">
                  {viewingReceipt.cycleLabel && (
                    <div className="text-xs bg-slate-100/60 p-2.5 rounded-xl border border-slate-200/80 flex justify-between items-center">
                      <span className="font-bold text-slate-700">{viewingReceipt.cycleLabel}</span>
                      {viewingReceipt.billNumber && (
                        <span className="text-[11px] text-slate-500 font-medium">เลขที่บิล: {viewingReceipt.billNumber}</span>
                      )}
                    </div>
                  )}

                  <div className="border border-slate-300 rounded-2xl overflow-hidden mt-3">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-100/80 text-slate-700 font-extrabold border-b border-slate-300">
                        <tr>
                          <th className="p-3">รายการ</th>
                          <th className="p-3 text-center">จำนวน</th>
                          <th className="p-3 text-right">ราคา/หน่วย</th>
                          <th className="p-3 text-right">จำนวนเงิน</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {viewingReceipt.items?.map((it, idx) => (
                          <tr key={idx}>
                            <td className="p-3 text-slate-800 font-medium align-top">
                              <div>{formatCanonicalLineItemDescription(it)}</div>
                              <TierBreakdownView metadata={it.metadata} unit={it.unit} isPrint />
                            </td>
                            <td className="p-3 text-center text-slate-600 font-medium align-top">{formatBillingQuantity(it.quantity, it.unit)}</td>
                            <td className="p-3 text-right text-slate-600 font-medium align-top">{formatTierRateLabel(it.unitPrice, it.unit, it.metadata)}</td>
                            <td className="p-3 text-right font-bold text-slate-900 align-top">{formatBaht(it.amount)}</td>
                          </tr>
                        ))}
                        {viewingReceipt.billTotal !== undefined && (
                          <tr className="bg-slate-50/50 text-slate-600">
                            <td colSpan={3} className="p-2.5 text-right font-semibold">ยอดบิล:</td>
                            <td className="p-2.5 text-right font-bold text-slate-700">{formatBaht(viewingReceipt.billTotal)}</td>
                          </tr>
                        )}
                        {viewingReceipt.billTotal !== undefined && viewingReceipt.allocatedAmount !== undefined && viewingReceipt.billTotal !== viewingReceipt.allocatedAmount && (
                          <tr className="bg-slate-50/50 text-slate-600">
                            <td colSpan={3} className="p-2.5 text-right font-semibold">ยอดรับชำระในใบเสร็จนี้:</td>
                            <td className="p-2.5 text-right font-bold text-slate-900">{formatBaht(viewingReceipt.allocatedAmount)}</td>
                          </tr>
                        )}
                        <tr className="bg-slate-100 font-black border-t border-slate-300">
                          <td colSpan={3} className="p-3 text-right text-slate-950 font-black">รวมรับสุทธิ:</td>
                          <td className="p-3 text-right text-indigo-900 font-black text-sm">{formatBaht(viewingReceipt.totalAmount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-4 text-[11px] text-slate-600 font-medium border-t border-dashed border-slate-300">
                <p>ช่องทางรับชำระ: {viewingReceipt.paymentMethod}</p>
                <p className="text-right">ผู้รับเงิน / พนักงาน: {viewingReceipt.receiverName}</p>
              </div>
            </div>
          </PrintView>
        )}
      </Modal>

      {/* Daily Stay Invoice & Payment Detail Modal */}
      <Modal
        isOpen={isDailyDetailOpen}
        onClose={() => setIsDailyDetailOpen(false)}
        title="รายละเอียดการชำระเงินรายวัน"
        size="lg"
      >
        {viewingDailyDetail && (
          <div className="space-y-5 text-xs text-slate-800">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 font-medium">เลขที่ใบแจ้งหนี้รายวัน:</span>
                <p className="font-bold text-slate-900">{viewingDailyDetail.invoiceNumber || '-'}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ห้องพัก:</span>
                <p className="font-bold text-slate-900">
                  ห้อง {viewingDailyDetail.dailyStay?.room?.roomNumber || getRoomNum(viewingDailyDetail.dailyStay?.roomId) || '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ผู้พักรายวัน:</span>
                <p className="font-bold text-slate-900">
                  {viewingDailyDetail.dailyStay?.applicantFullName || viewingDailyDetail.dailyStay?.tenant?.displayName || 'ผู้พักรายวัน'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">เบอร์โทรศัพท์:</span>
                <p className="font-bold text-slate-900">
                  {viewingDailyDetail.dailyStay?.applicantPhone || viewingDailyDetail.dailyStay?.tenant?.phone || '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ช่วงเวลาเข้าพัก:</span>
                <p className="font-bold text-slate-900">
                  {formatThaiDate(viewingDailyDetail.dailyStay?.startDate || viewingDailyDetail.checkInDate)} - {formatThaiDate(viewingDailyDetail.dailyStay?.endDate || viewingDailyDetail.checkOutDate)}
                </p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">สถานะการชำระ:</span>
                <div className="mt-0.5">
                  <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${
                    (viewingDailyDetail.status || '').toUpperCase() === 'PAID'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {(viewingDailyDetail.status || '').toUpperCase() === 'PAID' ? 'ชำระแล้ว' : 'รอชำระ'}
                  </span>
                </div>
              </div>
            </div>

            {/* Line items table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-extrabold">
                  <tr>
                    <th className="p-2.5 text-left">รายการ</th>
                    <th className="p-2.5 text-center">สถานะ</th>
                    <th className="p-2.5 text-right">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingDailyDetail.items && viewingDailyDetail.items.map((it: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="p-2.5 text-slate-800 font-medium">
                        {it.description || (it.itemType === 'DAILY_RENT' ? 'ค่าเช่ารายวัน' : it.itemType)}
                      </td>
                      <td className="p-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          it.status === 'SETTLED' || it.status === 'DECLARED_PAID'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {it.status === 'SETTLED' || it.status === 'DECLARED_PAID' ? 'ชำระแล้ว' : 'ค้างชำระ'}
                        </span>
                      </td>
                      <td className="p-2.5 text-right font-extrabold text-slate-900">
                        {formatBaht(Number(it.amount))}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100/80 font-black border-t border-slate-300">
                    <td colSpan={2} className="p-3 text-right text-slate-950 font-black">ยอดรวมทั้งหมด:</td>
                    <td className="p-3 text-right text-indigo-900 font-black text-sm">
                      {formatBaht(Number(viewingDailyDetail.totalAgreedAmount || 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsDailyDetailOpen(false)}
                className="px-5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Daily Stay Group Detail Modal */}
      <Modal
        isOpen={!!viewingDailyGroupDetail}
        onClose={() => setViewingDailyGroupDetail(null)}
        title={`รายละเอียดการชำระเงินรายวัน (ห้อง ${viewingDailyGroupDetail?.roomNumber})`}
        size="lg"
      >
        {viewingDailyGroupDetail && (
          <div className="space-y-5 text-xs text-slate-800">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 font-medium">ห้องพัก:</span>
                <p className="font-bold text-slate-900">ห้อง {viewingDailyGroupDetail.roomNumber}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ผู้พักรายวัน:</span>
                <p className="font-bold text-slate-900">{viewingDailyGroupDetail.tenantName}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ยอดรวมทั้งหมด:</span>
                <p className="font-bold text-emerald-600 text-sm">{formatBaht(viewingDailyGroupDetail.totalAmount)}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">จำนวนใบแจ้งหนี้:</span>
                <p className="font-bold text-slate-900">{viewingDailyGroupDetail.invoices.length} รายการ</p>
              </div>
            </div>

            <div className="space-y-3">
              {viewingDailyGroupDetail.invoices.map((inv, idx) => (
                <div key={inv.id || idx} className="border border-slate-200 rounded-2xl p-3.5 bg-white space-y-2">
                  <div className="flex justify-between items-center pb-1.5 border-b border-slate-100">
                    <div>
                      <span className="font-bold text-slate-800">{inv.invoiceNumber || `ใบแจ้งหนี้ #${idx + 1}`}</span>
                      <span className="text-[10px] text-slate-500 ml-2">
                        {formatThaiDate(inv.dailyStay?.startDate || inv.checkInDate)} - {formatThaiDate(inv.dailyStay?.endDate || inv.checkOutDate)}
                      </span>
                    </div>
                    <span className="font-extrabold text-emerald-600 text-xs">
                      {formatBaht(Number(inv.totalAgreedAmount || 0))}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-600 space-y-1">
                    {inv.items && inv.items.map((it: any, itIdx: number) => (
                      <div key={itIdx} className="flex justify-between items-center">
                        <span className="text-slate-500">{it.description || (it.itemType === 'DAILY_RENT' ? 'ค่าเช่ารายวัน' : it.itemType)}</span>
                        <span className="font-medium text-slate-700">{formatBaht(Number(it.amount))}</span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setViewingDailyGroupDetail(null);
                        handleOpenDailyDetail(inv);
                      }}
                      className="px-3 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-lg border border-indigo-200 transition-all cursor-pointer flex items-center gap-1"
                    >
                      <FileText className="w-3 h-3" />
                      ดูใบแจ้งหนี้ฉบับเต็ม
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewingDailyGroupDetail(null)}
                className="px-5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bill Line-Items and Reconciliation Detail Modal */}
      <Modal
        isOpen={!!viewingBillDetail}
        onClose={() => setViewingBillDetail(null)}
        title={`รายละเอียดรายการบิล ${viewingBillDetail?.roomNum ? `(ห้อง ${viewingBillDetail.roomNum})` : ''}`}
        size="lg"
      >
        {viewingBillDetail && (
          <div className="space-y-5 text-xs text-slate-800">
            {/* Header info */}
            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-400 font-medium">เลขที่บิล:</span>
                <p className="font-bold text-slate-900">{viewingBillDetail.bill.billNumber || viewingBillDetail.bill.id}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ผู้เช่า / ผู้พักอาศัย:</span>
                <p className="font-bold text-slate-900">{viewingBillDetail.tenantName || 'ไม่ระบุชื่อ'}</p>
              </div>
              {viewingBillDetail.bill.dueDate && (
                <div>
                  <span className="text-slate-400 font-medium">กำหนดชำระ:</span>
                  <p className="font-semibold text-slate-700">{formatThaiDate(viewingBillDetail.bill.dueDate)}</p>
                </div>
              )}
              <div>
                <span className="text-slate-400 font-medium">ประเภทบิล:</span>
                <p className="font-semibold text-slate-700">
                  {viewingBillDetail.bill.billKind === 'DEPOSIT'
                    ? 'เงินประกันสัญญาเช่า'
                    : viewingBillDetail.bill.billKind === 'RENT'
                    ? 'ค่าเช่าห้องพัก'
                    : viewingBillDetail.bill.billKind === 'MONTHLY_UTILITY'
                    ? 'ค่าน้ำ-ค่าไฟรายเดือน'
                    : viewingBillDetail.bill.billKind === 'LEGACY_COMBINED'
                    ? 'บิลรวมเดิม (Legacy Combined)'
                    : 'บิลค่าบริการ'}
                </p>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-3 w-12 text-center">#</th>
                    <th className="p-3">รายการ</th>
                    <th className="p-3 text-center">จำนวน</th>
                    <th className="p-3 text-right">ราคา/หน่วย</th>
                    <th className="p-3 text-right">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(() => {
                    const visibleItems = filterNonZeroBillItems(viewingBillDetail.bill.items);
                    return visibleItems.length > 0 ? (
                      visibleItems.map((it: any, idx: number) => {
                        const displayUnit = resolveBillingDisplayUnit({ unit: it.unit, type: it.type });
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="p-3 text-center text-slate-400 font-medium align-top">{idx + 1}</td>
                            <td className="p-3 font-semibold text-slate-800 align-top">
                              <div>{formatItemDescription(it.description || it.type || '-')}</div>
                              <TierBreakdownView metadata={it.metadata} unit={displayUnit} />
                            </td>
                            <td className="p-3 text-center text-slate-600 font-medium align-top">{formatBillingQuantity(it.quantity, displayUnit)}</td>
                            <td className="p-3 text-right text-slate-600 font-medium align-top">{formatTierRateLabel(it.unitPrice, displayUnit, it.metadata)}</td>
                            <td className="p-3 text-right font-bold text-slate-900 align-top">{formatBaht(Number(it.amount))}</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={5} className="p-4 text-center text-slate-400 font-semibold">
                          ไม่พบรายละเอียดรายการย่อย
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>

            {/* Financial Reconciliation Box */}
            <div className="p-4 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-600">
                <span className="font-semibold">ยอดรวมรายการบิลเดิม:</span>
                <span className="font-bold text-slate-800">{formatBaht(Number(viewingBillDetail.bill.totalAmount ?? 0))}</span>
              </div>
              <div className="flex justify-between items-center text-emerald-700">
                <span className="font-semibold">ชำระแล้วก่อนหน้า:</span>
                <span className="font-bold">-{formatBaht(Number(viewingBillDetail.bill.paidAmount ?? 0))}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-sm font-black">
                <span className="text-slate-900">ยอดคงเหลือที่ต้องชำระ:</span>
                <span className="text-indigo-600">{formatBaht(Number(viewingBillDetail.bill.outstandingAmount ?? viewingBillDetail.bill.totalAmount ?? 0))}</span>
              </div>
              {Number(viewingBillDetail.bill.paidAmount || 0) > 0 && viewingBillDetail.bill.billKind === 'LEGACY_COMBINED' && (
                <p className="text-[11px] text-amber-700 font-medium pt-1 border-t border-dashed border-amber-200">
                  * ไม่สามารถระบุการจัดสรรยอดที่ชำระแล้วรายรายการจากข้อมูลเดิมได้
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setViewingBillDetail(null)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer transition-all"
              >
                ปิด
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Consolidated Group Payment Detail Modal */}
      <Modal
        isOpen={!!viewingGroupDetail}
        onClose={() => setViewingGroupDetail(null)}
        title={`รายละเอียดการชำระเงิน (ห้อง ${viewingGroupDetail?.roomNumber})`}
        size="lg"
      >
        {viewingGroupDetail && (
          <div className="space-y-5 text-xs text-slate-800">
            <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-slate-400 font-medium">ห้องพัก:</span>
                <p className="font-bold text-slate-900">ห้อง {viewingGroupDetail.roomNumber}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ผู้เช่า:</span>
                <p className="font-bold text-slate-900">{viewingGroupDetail.tenantName}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">ยอดรวมทั้งหมด:</span>
                <p className="font-bold text-emerald-600 text-sm">{formatBaht(viewingGroupDetail.totalAmount)}</p>
              </div>
              <div>
                <span className="text-slate-400 font-medium">จำนวนรายการ:</span>
                <p className="font-bold text-slate-900">{viewingGroupDetail.payments.length} รายการ</p>
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 font-extrabold">
                  <tr>
                    <th className="p-2.5 text-left">รายการ / บิล</th>
                    <th className="p-2.5 text-center">ช่องทาง</th>
                    <th className="p-2.5 text-right">ยอดชำระ</th>
                    <th className="p-2.5 text-center">ใบเสร็จ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {viewingGroupDetail.payments.map((p, idx) => {
                    const isDep = p.bill?.billKind === 'DEPOSIT';
                    const isRnt = p.bill?.billKind === 'RENT';
                    const label = isDep ? 'เงินประกัน' : isRnt ? 'ค่าเช่าห้องพัก' : (p.bill?.billNumber || `บิล #${idx + 1}`);
                    const pAmt = Number(p.amount || p.bill?.totalAmount || 0);
                    const pMethod = (p.method || '').toUpperCase() === 'CASH' ? 'เงินสด' : 'โอน/แสกน';

                    return (
                      <tr key={p.id || idx} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-slate-800 font-medium">
                          <div>{label}</div>
                          {p.metadata?.originalPeriodLabel && (
                            <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              ก่อนใช้ HorPlus • {p.metadata.originalPeriodLabel}
                            </span>
                          )}
                        </td>
                        <td className="p-2.5 text-center text-slate-600 font-semibold">{pMethod}</td>
                        <td className="p-2.5 text-right font-extrabold text-slate-900">{formatBaht(pAmt)}</td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              handleOpenReceipt(p);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[10px] rounded-lg border border-indigo-200 transition-all cursor-pointer flex items-center justify-center gap-1 mx-auto"
                          >
                            <Printer className="w-3 h-3" />
                            พิมพ์
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewingGroupDetail(null)}
                className="px-5 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
              >
                ปิด
              </button>
            </div>
          </div>
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
        selectedCycle={effectiveCycleCode}
        onAddLog={onAddLog}
        targetScrollTenantId={targetScrollTenantId}
        onShowToast={(msg) => triggerToast(msg)}
      />

      {/* Slip Viewer Overlay */}
      {viewingSlipUrl && (
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200 cursor-zoom-out"
          onClick={() => setViewingSlipUrl(null)}
        >
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setViewingSlipUrl(null)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img
              src={viewingSlipUrl}
              alt="หลักฐานขนาดเต็ม"
              className="max-w-[90vw] md:max-w-lg max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-3xl shadow-2xl border border-white/10 select-none cursor-zoom-out transition-transform duration-300 hover:scale-[1.01]"
              onClick={() => setViewingSlipUrl(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export const OwnerPayments = PaymentsOwnerView;
export default PaymentsOwnerView;
