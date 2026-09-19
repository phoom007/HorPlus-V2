/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  Search,
  User,
  Plus,
  Phone,
  Mail,
  Users,
  Car,
  Heart,
  FileText,
  Clock,
  ArrowLeft,
  ChevronLeft,
  X,
  AlertCircle,
  Download,
  Printer,
  Dog,
  Check,
  Copy,
  QrCode,
  CheckCircle2,
  XCircle,
  UserCheck,
  UserX,
  Edit2,
  Edit3,
  RotateCcw,
  RotateCw,
  Trash2,
  Calendar,
  CreditCard,
  PenTool,
  ShieldCheck,
  Eye,
  FileCheck,
  FileSpreadsheet,
  UserPlus,
  UserMinus,
  History,
  Upload,
  LogOut,
  ShieldAlert,
  AlertTriangle,
  Receipt,
  Coins,
  Paperclip,
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { LineLogo as LineIcon } from '../../components/LineLogo';
import { QuickAddTenantModal, QuickAddSuccessResult } from '../../components/QuickAddTenantModal';
import { TenantRejectSheet } from '../../components/TenantRejectSheet';
import { httpRequest } from '../../data/httpClient';
import { approveTenantRegistrationRequest, rejectTenantRegistrationRequest, terminateContract, fetchTenantProfile, TenantBasicProfileUpdateInput } from '../../data/adapters/api';
import { UpdateTenantProfilePayload } from '../../data/contracts';
import { useQuery, QueryClientContext } from '@tanstack/react-query';
import { queryKeys, STALE_TIMES } from '../../lib/queryClient';
import {
  StatusBadge,
  Modal,
  Stepper,
  formatBaht,
  formatThaiDate,
  ThaiDatePicker,
  CurrencyInput,
  PrintView,
  SignaturePad,
  OwnerDateInput,
  isoToThaiBe
} from '../../components/GlobalComponents';
import { Tenant, Room, CoOccupant, CoOccupantHistoryItem, EmergencyContact, Contract, Bill, BillItem, BLOCKING_CONTRACT_STATUSES, PetItem, VehicleItem, TenantReturnContext, Dormitory, QuickAddRoomContext } from '../../types';
import { getDataProvider } from '../../data/dataProvider';
import { convertImageToWebP, UPLOAD_DROPZONE_TEXT } from '../../utils/imageUtils';
import { formatOwnerRoomOptionLabel } from '../../utils/room-label.util';
import { resolveLandlordSignerName } from '../../utils/landlord-signer.util';
import { getPaymentSettings, PaymentSettingsDTO } from '../../services/payment-settings.service';
import { sortRoomsByBuildingAndNumber } from '../../utils/roomSorter';
import { openTenantContractPrintWindow } from '../tenant/tenantHelpers';

export function useAuthenticatedBlobUrl(url: string | null | undefined, dormitoryId?: string): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(() => {
    if (!url) return null;
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return null;
  });

  React.useEffect(() => {
    if (!url) {
      setBlobUrl(null);
      return;
    }

    if (url.startsWith('data:') || url.startsWith('blob:')) {
      setBlobUrl(url);
      return;
    }

    let isMounted = true;
    let createdUrl: string | null = null;

    const fetchBlob = async () => {
      try {
        const headers: Record<string, string> = {};
        if (dormitoryId) {
          headers['X-Dormitory-Id'] = dormitoryId;
        }
        const res = await fetch(url, {
          credentials: 'include',
          headers,
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch blob from ${url}, status: ${res.status}`);
        }
        const blob = await res.blob();
        if (isMounted) {
          if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            createdUrl = URL.createObjectURL(blob);
            setBlobUrl(createdUrl);
          } else {
            setBlobUrl(url);
          }
        }
      } catch {
        if (isMounted) {
          setBlobUrl(url);
        }
      }
    };

    fetchBlob();

    return () => {
      isMounted = false;
      if (createdUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [url, dormitoryId]);

  return blobUrl;
}

export const AuthenticatedSignatureImage: React.FC<{
  url: string | null | undefined;
  alt: string;
  className?: string;
  dormitoryId?: string;
  testId?: string;
}> = ({ url, alt, className, dormitoryId, testId }) => {
  const blobUrl = useAuthenticatedBlobUrl(url, dormitoryId);
  const [hasError, setHasError] = useState(false);

  React.useEffect(() => {
    setHasError(false);
  }, [url]);

  if (!url || hasError) {
    return (
      <div className="h-10" data-testid={testId ? `${testId}-unsigned` : undefined} />
    );
  }

  if (!blobUrl) {
    return (
      <div className="h-10 flex items-center justify-center text-slate-300 text-xs animate-pulse">
        กำลังโหลดลายมือชื่อ...
      </div>
    );
  }

  return (
    <img
      src={blobUrl}
      alt={alt}
      className={className || "h-10 mx-auto object-contain"}
      onError={() => setHasError(true)}
      data-testid={testId}
    />
  );
};

export const InlineIdDocumentPreview: React.FC<{
  url: string | null | undefined;
  filename?: string;
  mimeType?: string;
  byteSize?: number;
  dormitoryId?: string;
}> = ({ url, filename, mimeType, byteSize, dormitoryId }) => {
  const blobUrl = useAuthenticatedBlobUrl(url, dormitoryId);
  const isPdf = Boolean(
    (mimeType && mimeType.includes('pdf')) ||
    (filename && filename.toLowerCase().endsWith('.pdf')) ||
    (url && url.toLowerCase().includes('.pdf'))
  );

  if (!url) return null;

  return (
    <div className="rounded-xl border border-indigo-200/80 overflow-hidden bg-slate-50 space-y-0" data-testid="inline-id-document-container">
      <div className="flex items-center justify-between px-3 py-2 bg-indigo-50/70 border-b border-indigo-100 text-xs text-slate-700 font-medium">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
          <span className="truncate font-bold text-slate-800 text-[11px]">{filename || (isPdf ? 'สำเนาบัตรประชาชน.pdf' : 'สำเนาบัตรประชาชน')}</span>
        </div>
        <span className="text-[10px] text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200 font-bold shrink-0">
          {isPdf ? 'PDF' : 'รูปภาพ'} {byteSize ? `• ${Math.round(byteSize / 1024)} KB` : ''}
        </span>
      </div>

      <div className="p-3 bg-white flex items-center justify-center min-h-[140px]">
        {!blobUrl ? (
          <div className="text-xs text-slate-400 py-6 animate-pulse">กำลังโหลดเอกสารสำเนาบัตรประชาชน...</div>
        ) : isPdf ? (
          <iframe
            src={blobUrl}
            title={filename || 'สำเนาบัตรประชาชน'}
            className="w-full h-72 border-0 rounded-lg shadow-2xs"
            data-testid="inline-id-pdf-iframe"
          />
        ) : (
          <img
            src={blobUrl}
            alt={filename || 'สำเนาบัตรประชาชน'}
            className="max-h-64 max-w-full rounded-lg object-contain border border-slate-100 shadow-2xs mx-auto"
            data-testid="inline-id-image-preview"
          />
        )}
      </div>
    </div>
  );
};

export const getTrulyVacantRooms = (
  rooms: Room[] = [],
  contracts: Contract[] = [],
  tenants: Tenant[] = [],
  occupancies?: Array<{ roomId: string; status?: string }>
): Room[] => {
  return rooms.filter(room => {
    // 1. Room level check:
    // - Room status must be 'vacant'
    // - Must not have currentTenantId
    if (room.status !== 'vacant') return false;
    if (room.currentTenantId) return false;

    // Attached active daily stay or provisional term guard
    if ((room as any).dailyStays?.some((ds: any) => ds.status === 'ACTIVE' || ds.status === 'active')) return false;
    if ((room as any).provisionalRentalTerms?.some((pt: any) => pt.status === 'ACTIVE' || pt.status === 'active')) return false;

    // 2. Active Occupancy & Resident check:
    // - No tenant currently active in this room (Monthly, Term, Daily)
    const hasActiveTenant = tenants.some(
      t => (t.roomId === room.id || (t as any).currentRoomId === room.id || (t as any).roomNumber === room.roomNumber) && t.status === 'active'
    );
    if (hasActiveTenant) return false;

    if (occupancies && occupancies.length > 0) {
      const hasActiveOccupancy = occupancies.some(
        o => o.roomId === room.id && (!o.status || o.status === 'ACTIVE' || o.status === 'active')
      );
      if (hasActiveOccupancy) return false;
    }

    // 3. Reservation / Booking / Blocking contract check:
    // - No active or scheduled or reserved contracts for this room
    const blockingStatuses = [
      ...BLOCKING_CONTRACT_STATUSES,
      'active', 'ACTIVE',
      'scheduled', 'SCHEDULED',
      'approved_scheduled', 'APPROVED_SCHEDULED',
      'pending_signature', 'PENDING_SIGNATURE',
      'waiting_extension', 'WAITING_EXTENSION',
      'checking_out', 'CHECKING_OUT',
      'reserved', 'RESERVED',
      'draft', 'DRAFT'
    ];
    const hasBlockingContract = contracts.some(c => {
      if (c.roomId !== room.id) return false;
      return blockingStatuses.includes(c.status);
    });
    if (hasBlockingContract) return false;

    return true;
  }).sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true }));
};

export const getRentalTypeLabel = (tenant: Tenant, contracts: Contract[] = []): string | null => {
  const rawType = tenant.rentalType || tenant.rentalPlan || contracts.find(c => c.tenantId === tenant.id)?.rentBillingType || contracts.find(c => c.tenantId === tenant.id)?.rentalType;
  if (!rawType) return null;
  const upper = String(rawType).toUpperCase();
  if (upper === 'MONTHLY') return 'รายเดือน';
  if (upper === 'TERM') return 'รายเทอม';
  if (upper === 'DAILY') return 'รายวัน';
  return null;
};

export const getRentalTypeBadge = (tenant: Tenant, contracts: Contract[] = []): { label: string; className: string } | null => {
  const rawType = tenant.rentalType || tenant.rentalPlan || contracts.find(c => c.tenantId === tenant.id)?.rentBillingType || contracts.find(c => c.tenantId === tenant.id)?.rentalType;
  if (!rawType) return null;
  const upper = String(rawType).toUpperCase();
  if (upper === 'MONTHLY' || upper === 'รายเดือน') {
    return { label: 'รายเดือน', className: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  if (upper === 'TERM' || upper === 'รายเทอม') {
    return { label: 'รายเทอม', className: 'bg-purple-50 text-purple-700 border-purple-200' };
  }
  if (upper === 'DAILY' || upper === 'รายวัน') {
    return { label: 'รายวัน', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  return { label: rawType, className: 'bg-slate-100 text-slate-700 border-slate-200' };
};

export const formatPendingDuration = (tenant: Tenant): string | null => {
  const upperType = String(tenant.rentalType || tenant.rentalPlan || '').toUpperCase();
  const formatDate = (d?: string | null) => {
    if (!d) return '';
    try {
      const parts = String(d).split('T')[0].split('-');
      if (parts.length === 3) {
        const y = Number(parts[0]);
        const beYear = y > 2400 ? y : y + 543;
        return `${String(parts[2]).padStart(2, '0')}/${String(parts[1]).padStart(2, '0')}/${beYear}`;
      }
      return d;
    } catch {
      return d;
    }
  };

  const startStr = formatDate(tenant.requestedStartDate);
  const endStr = formatDate(tenant.requestedEndDate);
  const dateRange = startStr && endStr ? ` (${startStr} - ${endStr})` : (startStr ? ` (เริ่ม ${startStr})` : '');

  if (upperType === 'DAILY') {
    const days = tenant.requestedDays || (tenant.requestedStartDate && tenant.requestedEndDate ? Math.max(1, Math.round((new Date(tenant.requestedEndDate).getTime() - new Date(tenant.requestedStartDate).getTime()) / (24 * 3600 * 1000))) : 1);
    const dailyRate = tenant.requestedDailyRate || (tenant.requestedDays && tenant.requestedRent ? Math.round(Number(tenant.requestedRent) / tenant.requestedDays) : tenant.requestedRent);
    const rentPart = dailyRate ? ` • ค่าเช่า ฿ ${Number(dailyRate).toLocaleString()}/วัน` : (tenant.requestedRent ? ` • ค่าเช่า ฿ ${Number(tenant.requestedRent).toLocaleString()}` : '');
    return `${days} วัน •${dateRange}${rentPart}`;
  }
  if (upperType === 'TERM') {
    const months = tenant.requestedDurationMonths || 4;
    const rentPart = tenant.requestedRent ? ` • ค่าเช่า ฿ ${Number(tenant.requestedRent).toLocaleString()}/เทอม` : '';
    return `${months} เดือน •${dateRange}${rentPart}`;
  }
  const months = tenant.requestedDurationMonths || 12;
  const rentPart = tenant.requestedRent ? ` • ค่าเช่า ฿ ${Number(tenant.requestedRent).toLocaleString()}/เดือน` : '';
  return `${months} เดือน •${dateRange}${rentPart}`;
};

export const isDailyTenant = (tenant: Tenant, contracts: Contract[] = []): boolean => {
  if (!tenant) return false;
  const rawType = String(tenant.rentalType || tenant.rentalPlan || '').toUpperCase();
  if (rawType === 'DAILY') return true;
  const contract = contracts.find(c => c.tenantId === tenant.id);
  if (contract && (String(contract.rentBillingType).toUpperCase() === 'DAILY' || String((contract as any).rentalType).toUpperCase() === 'DAILY')) return true;
  if ((tenant as any).dailyStays && (tenant as any).dailyStays.length > 0 && (!contracts || contracts.length === 0)) return true;
  if (tenant.name && tenant.name.includes('รายวัน') && (!contracts || contracts.length === 0)) return true;
  return false;
};

export const isTenantLineBound = (tenant: Tenant): boolean => {
  return !!(tenant.lineFriendId || (tenant as any).lineUserId || (tenant as any).isLineRegistered);
};

interface OwnerTenantsProps {
  tenants: Tenant[];
  rooms: Room[];
  bills?: Bill[];
  contracts?: Contract[];
  selectedCycle?: string;
  onSaveTenants: (tenants: Tenant[]) => void;
  onSaveRooms: (rooms: Room[]) => void;
  onSaveContracts?: (contracts: Contract[]) => void;
  onSaveBills?: (bills: Bill[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  initialTenantId?: string;
  onClearInitialTenantId?: () => void;
  onBackToMeters?: () => void;
  onBackToRooms?: (roomId?: string) => void;
  tenantOriginTab?: 'rooms' | 'meters' | string;
  onViewContract?: (contractId: string, tenantId?: string) => void;
  returnContext?: TenantReturnContext | null;
  onReturnToSource?: (context: TenantReturnContext) => void;
  onDismissReturnContext?: () => void;
  cameFromMeters?: boolean;
  dormitory?: Dormitory | null;
  dormitoryId?: string;
  buildings?: Array<{ id: string; name: string }>;
  onNavigateToLineConfig?: () => void;
}

const CAR_BRANDS = ["Toyota", "Honda", "Isuzu", "Mazda", "Nissan", "Mitsubishi", "Ford", "Benz", "BMW", "Audi", "MG", "BYD", "Suzuki", "อื่นๆ"];
const MOTO_BRANDS = ["Honda", "Yamaha", "Vespa", "Suzuki", "GPX", "Kawasaki", "Ducati", "อื่นๆ"];
const STANDARD_PET_OPTIONS = ["สุนัข", "แมว", "นก", "ปลา", "กระต่าย", "หนูแฮมสเตอร์"];
const PET_OPTIONS = ["สุนัข", "แมว", "นก", "ปลา", "กระต่าย", "หนูแฮมสเตอร์", "อื่นๆ"];
const CO_OCCUPANT_RELATION_OPTIONS = ["แฟน", "เพื่อน", "ผู้ปกครอง", "พี่น้อง / ญาติ", "คู่สมรส", "อื่นๆ"];

export interface CanonicalPetGroupOption {
  id: 'dog' | 'cat' | 'small_pet' | 'other';
  label: string;
}

export const CANONICAL_PET_GROUP_OPTIONS: readonly CanonicalPetGroupOption[] = [
  { id: 'dog', label: 'สุนัข (Dog)' },
  { id: 'cat', label: 'แมว (Cat)' },
  { id: 'small_pet', label: 'สัตว์เล็ก (กระต่าย/หนู/นก)' },
  { id: 'other', label: 'สัตว์แปลก (other)' },
] as const;

export const toCanonicalPetGroup = (t?: string): { type: 'dog' | 'cat' | 'small_pet' | 'other' | ''; customType?: string } => {
  const raw = (t || '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return { type: '' };
  if (lower === 'dog' || lower === 'สุนัข' || lower === 'หมา') return { type: 'dog' };
  if (lower === 'cat' || lower === 'แมว') return { type: 'cat' };
  if (lower === 'small_pet' || lower === 'small-pet' || lower === 'small_pets' || lower === 'สัตว์เล็ก') return { type: 'small_pet' };
  if (lower === 'bird' || lower === 'นก' || lower === 'rabbit' || lower === 'กระต่าย' || lower === 'hamster' || lower === 'หนู' || lower === 'หนูแฮมสเตอร์') {
    return { type: 'small_pet' };
  }
  if (lower === 'fish' || lower === 'ปลา') {
    return { type: 'other', customType: raw };
  }
  if (lower === 'other' || lower === 'others' || lower === 'อื่นๆ' || lower === 'สัตว์แปลก') {
    return { type: 'other' };
  }
  return { type: 'other', customType: raw };
};

export function getEffectivePetPolicy(
  propertyDefaultsPolicy?:
    | { allowed: string; allowedTypes?: string[] }
    | null
): { allowed: string; allowedTypes?: string[] } {
  if (propertyDefaultsPolicy?.allowed) {
    return propertyDefaultsPolicy;
  }

  return {
    allowed: 'none',
    allowedTypes: [],
  };
}

export function resolveAllowedPetOptions(
  petPolicy?: { allowed: string; allowedTypes?: string[] } | null
): CanonicalPetGroupOption[] {
  if (!petPolicy || petPolicy.allowed === 'none') return [];
  if (petPolicy.allowed === 'all') {
    return [...CANONICAL_PET_GROUP_OPTIONS];
  }
  if (!petPolicy.allowedTypes || petPolicy.allowedTypes.length === 0) {
    return [];
  }
  const allowedIds = new Set<string>();
  for (const t of petPolicy.allowedTypes) {
    const lower = (t || '').trim().toLowerCase();
    if (lower === 'dog' || lower === 'สุนัข' || lower === 'หมา') allowedIds.add('dog');
    else if (lower === 'cat' || lower === 'แมว') allowedIds.add('cat');
    else if (lower === 'small_pet' || lower === 'small-pet' || lower === 'small_pets' || lower === 'สัตว์เล็ก') allowedIds.add('small_pet');
    else if (lower === 'other' || lower === 'others' || lower === 'อื่นๆ' || lower === 'สัตว์แปลก') allowedIds.add('other');
  }
  return CANONICAL_PET_GROUP_OPTIONS.filter(opt => allowedIds.has(opt.id));
}

export function deriveContractDepositPaymentState(
  contractId: string,
  billsList: any[]
): { isPaid: boolean; depositBill?: any } {
  if (!contractId || !Array.isArray(billsList) || billsList.length === 0) {
    return { isPaid: false };
  }

  const depositBills = billsList.filter((b: any) => {
    if (!b || typeof b !== 'object') return false;
    const kind = String(b.billKind || '').toUpperCase();
    if (kind !== 'DEPOSIT') return false;
    if (b.contractId !== contractId) return false;

    const st = String(b.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'canceled' || st === 'void' || b.isVoided) {
      return false;
    }
    return true;
  });

  if (depositBills.length === 0) {
    return { isPaid: false };
  }

  for (const bill of depositBills) {
    const st = String(bill.status || '').toLowerCase();
    if (st === 'paid') {
      return { isPaid: true, depositBill: bill };
    }

    const total = Number(bill.totalAmount ?? bill.amount ?? 0);
    const outstanding = Number(bill.outstandingAmount ?? 0);
    const paid = Number(bill.paidAmount ?? 0);

    if (total > 0 && outstanding <= 0 && paid >= total) {
      return { isPaid: true, depositBill: bill };
    }
  }

  return { isPaid: false, depositBill: depositBills[0] };
}

export function getDepositFinancialState(
  contractId?: string,
  billsList: any[] = [],
  nominalDeposit: number = 0
): {
  isPaid: boolean;
  actualPaidDeposit: number;
  nominalDeposit: number;
  depositBill?: any;
} {
  if (!contractId || !Array.isArray(billsList) || billsList.length === 0) {
    return {
      isPaid: false,
      actualPaidDeposit: 0,
      nominalDeposit,
    };
  }

  const depositBills = billsList.filter((b: any) => {
    if (!b || typeof b !== 'object') return false;
    const kind = String(b.billKind || '').toUpperCase();
    if (kind !== 'DEPOSIT') return false;
    if (b.contractId !== contractId) return false;

    const st = String(b.status || '').toLowerCase();
    if (st === 'cancelled' || st === 'canceled' || st === 'void' || b.isVoided) {
      return false;
    }
    return true;
  });

  let totalPaid = 0;
  for (const bill of depositBills) {
    const st = String(bill.status || '').toLowerCase();
    const total = Number(bill.totalAmount ?? bill.amount ?? 0);
    const paid = Number(bill.paidAmount ?? (st === 'paid' ? total : 0));
    totalPaid += paid;
  }

  return {
    isPaid: totalPaid > 0,
    actualPaidDeposit: totalPaid,
    nominalDeposit,
    depositBill: depositBills[0],
  };
}

export function getContractStatusBadgeInfo(
  status: string,
  endDate?: string | Date | null
): { label: string; bg: string; text: string; border: string } {
  const getExpiringLabel = () => {
    if (endDate) {
      const today = new Date();
      const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endD = new Date(endDate);
      const endDay = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate());
      const diffDays = Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? `เหลือ ${diffDays} วัน` : 'หมดอายุแล้ว';
    }
    return 'ใกล้หมดอายุ';
  };

  const statusMap: Record<string, { label: string; bg: string; text: string; border: string }> = {
    active: { label: 'กำลังใช้งาน', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    expiring_soon: { label: getExpiringLabel(), bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    expired: { label: 'หมดอายุแล้ว', bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200' },
    ended: { label: 'เลิกสัญญาแล้ว', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
    terminated: { label: 'เลิกสัญญาแล้ว', bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  };

  const defaultFallbackStatus = {
    label: status || 'ไม่ระบุสถานะ',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
  };

  return statusMap[status] || defaultFallbackStatus;
}

export function resolveTenantDisplayAgreements(
  selectedTenant: any,
  contracts: any[] = [],
  tenantDetailsData: any = null,
  rooms: any[] = [],
  effectiveDormId: string = ''
): any[] {
  if (!selectedTenant) return [];
  const tenantContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id && !c.deletedAt);
  const provTermsList = tenantDetailsData?.provisionalRentalTerms || [];
  const activeProvTerm = provTermsList.find((p: any) => p.status === 'ACTIVE' || p.status === 'active');
  const isTermResident = (selectedTenant.rentalType === 'TERM' || selectedTenant.rentalPlan === 'term' || Boolean(activeProvTerm));
  const hasCurrentProvAgreement = Boolean(activeProvTerm) || (
    isTermResident &&
    tenantContracts.length > 0 &&
    tenantContracts.every(c => new Date(c.startDate).getTime() > new Date('2026-09-30').getTime())
  );

  const displayAgreements: any[] = [];
  if (hasCurrentProvAgreement && selectedTenant.status === 'active') {
    const targetRoom = rooms.find(r => r.id === (activeProvTerm?.roomId || selectedTenant.roomId) || r.roomNumber === (activeProvTerm?.roomId || selectedTenant.roomId));
    const provTerms = activeProvTerm?.terms || null;
    const currentTermAgreement: any = {
      id: activeProvTerm?.id || 'PROV-TERM-CURRENT-105',
      isCurrentTermAgreement: true,
      contractNumber: 'สัญญา/ข้อตกลงปัจจุบัน (ภาค 1/2569)',
      dormitoryId: effectiveDormId,
      roomId: activeProvTerm?.roomId || selectedTenant.roomId || (targetRoom ? targetRoom.id : '105'),
      tenantId: selectedTenant.id,
      startDate: activeProvTerm?.startDate || selectedTenant.requestedStartDate || '2026-07-01',
      endDate: activeProvTerm?.endDate || selectedTenant.requestedEndDate || '2026-10-31',
      durationMonths: activeProvTerm?.durationMonths || selectedTenant.requestedDurationMonths || 4,
      rentBillingType: 'term',
      rentalType: 'TERM',
      rentalPlan: 'term',
      rentAmount: activeProvTerm?.totalRentAmount || selectedTenant.requestedRent || 18000,
      depositAmount: activeProvTerm?.depositAmount || selectedTenant.requestedDeposit || 4500,
      tenantSignature: tenantContracts[0]?.tenantSignature || null,
      ownerSignature: tenantContracts[0]?.ownerSignature || null,
      status: 'active',
      createdAt: activeProvTerm?.createdAt || '2026-07-01T09:00:00.000Z',
      terms: provTerms,
    };
    displayAgreements.push(currentTermAgreement);
  }

  displayAgreements.push(...tenantContracts);

  // Normalized agreement ordering: newest → oldest (startDate DESC, createdAt DESC, ID tie-breaker)
  displayAgreements.sort((a, b) => {
    const aStart = a.startDate ? new Date(a.startDate).getTime() : 0;
    const bStart = b.startDate ? new Date(b.startDate).getTime() : 0;
    if (aStart !== bStart) return bStart - aStart; // newest first

    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (aCreated !== bCreated) return bCreated - aCreated; // newest first

    return String(b.id || '').localeCompare(String(a.id || ''));
  });

  return displayAgreements;
}

/**
 * Evaluates whether an agreement is canonically eligible for contract renewal.
 * Invariant Rules:
 * 1. Never on Daily stays
 * 2. Never on non-renewable provisional agreements
 * 3. Never on obsolete predecessors (contracts already renewed or superseded by newer contract)
 * 4. Contract must be in valid active/scheduled renewal status
 */
/**
 * Canonical predicate: Is an agreement a renewable contract candidate?
 * Requirements:
 * 1. Must be a CONTRACT (agreementType === 'CONTRACT', never provisional, never daily stay)
 * 2. Rental type Monthly or Term
 * 3. Status must be in canonical backend renewal eligibility
 * 4. Not cancelled, terminated, ended, or archived
 */
export function isCanonicalRenewableContract(agr: any): boolean {
  if (!agr || !agr.id) return false;
  // Never on provisional
  if (agr.isCurrentTermAgreement || agr.agreementType === 'PROVISIONAL' || agr.isProvisional || String(agr.id).startsWith('PROV-')) {
    return false;
  }
  // Must be contract
  if (agr.agreementType && agr.agreementType !== 'CONTRACT') {
    return false;
  }
  if (agr.isDailyStay || String(agr.id).startsWith('DAILY-')) {
    return false;
  }
  // Never on Daily
  const isDaily = agr.rentBillingType === 'daily' ||
    agr.durationMonths === 0 ||
    agr.rentalPlan === 'daily' ||
    agr.rentalType === 'DAILY';
  if (isDaily) {
    return false;
  }
  // Allowed statuses: active, approved_scheduled, expiring_soon, waiting_extension, pending_signature
  const allowedStatuses = ['active', 'approved_scheduled', 'expiring_soon', 'waiting_extension', 'pending_signature'];
  const status = (agr.status || '').toLowerCase();
  if (!allowedStatuses.includes(status)) {
    return false;
  }
  return true;
}

/**
 * Canonical chain-tip predicate:
 * Determined strictly from the real previousContractId successor chain.
 * Dates are for display ordering only.
 * A contract is NOT the chain tip if another active/valid contract exists whose previousContractId equals agr.id.
 */
export function isContractChainTip(agr: any, allAgreements: any[] = []): boolean {
  if (!isCanonicalRenewableContract(agr)) return false;

  const hasSuccessor = allAgreements.some((other) => {
    if (!other || other.id === agr.id || other.deletedAt) return false;
    const st = (other.status || '').toLowerCase();
    if (['cancelled', 'terminated', 'ended', 'archived'].includes(st)) return false;
    // Strict chain successor check:
    return other.previousContractId === agr.id;
  });

  return !hasSuccessor;
}

export function isAgreementEligibleForRenewal(agr: any, allAgreements: any[] = []): boolean {
  return isContractChainTip(agr, allAgreements);
}

/**
 * Returns the single newest renewable agreement ID from the newest→oldest list,
 * or null if no agreement is eligible.
 * Display ordering sorts newest -> oldest by date, but chain tip is determined strictly by previousContractId.
 */
export function resolveNewestRenewableAgreementId(displayAgreements: any[] = []): string | null {
  const renewableCandidates = displayAgreements
    .filter(isCanonicalRenewableContract)
    .filter((agr) => isContractChainTip(agr, displayAgreements))
    .sort((a, b) => {
      const timeB = b.startDate ? new Date(b.startDate).getTime() : 0;
      const timeA = a.startDate ? new Date(a.startDate).getTime() : 0;
      return timeB - timeA;
    });

  return renewableCandidates[0]?.id ?? null;
}


interface TenantDetailsFetcherProps {
  dormitoryId: string;
  tenantId: string | null;
  onDataLoaded: (data: any) => void;
}

const AuthoritativeTenantDetailsFetcher: React.FC<TenantDetailsFetcherProps> = ({
  dormitoryId,
  tenantId,
  onDataLoaded,
}) => {
  const query = useQuery({
    queryKey: ['owner', dormitoryId, 'tenants', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetchTenantProfile(tenantId);
      if (!res.success) {
        throw new Error(res.error?.message || 'Failed to fetch tenant details');
      }
      return res.data;
    },
    enabled: Boolean(tenantId && dormitoryId),
    staleTime: STALE_TIMES.TENANTS,
  });

  React.useEffect(() => {
    if (query.data) {
      onDataLoaded(query.data);
    }
  }, [query.data, onDataLoaded]);

  return null;
};

export const OwnerTenants: React.FC<OwnerTenantsProps> = ({
  dormitoryId,
  tenants,
  rooms,
  bills = [],
  contracts = [],
  selectedCycle,
  onSaveTenants,
  onSaveRooms,
  onSaveContracts,
  onSaveBills,
  onAddLog,
  initialTenantId,
  onClearInitialTenantId,
  onBackToMeters,
  onBackToRooms,
  tenantOriginTab,
  onViewContract,
  returnContext,
  onReturnToSource,
  onDismissReturnContext,
  cameFromMeters: cameFromMetersProp,
  dormitory,
  buildings: propBuildings = [],
  onNavigateToLineConfig,
}) => {
  const queryClient = React.useContext(QueryClientContext) || null;
  const effectiveDormId =
    dormitoryId ||
    dormitory?.id ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') : null) ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('active_dormitory_selected_for_session') : null) ||
    '';
  const [tenantDetailsData, setTenantDetailsData] = useState<any | null>(null);
  const [paymentSettings, setPaymentSettings] = useState<PaymentSettingsDTO | null>(null);
  const [fetchedBuildings, setFetchedBuildings] = useState<Array<{ id: string; name: string }>>([]);

  React.useEffect(() => {
    if (!effectiveDormId) return;
    getPaymentSettings(effectiveDormId)
      .then(setPaymentSettings)
      .catch((err) => console.warn('Failed to load payment settings for landlord signature:', err));
  }, [effectiveDormId]);

  React.useEffect(() => {
    if (propBuildings && propBuildings.length > 0) return;
    if (!effectiveDormId) return;
    getDataProvider().properties.getBuildings?.()
      .then((res: any) => {
        if (res?.data && Array.isArray(res.data)) {
          setFetchedBuildings(res.data);
        }
      })
      .catch(() => { });
  }, [effectiveDormId, propBuildings]);

  const localBuildings = (propBuildings && propBuildings.length > 0) ? propBuildings : fetchedBuildings;

  const [propertyDefaultsPolicy, setPropertyDefaultsPolicy] = useState<{ allowed: string; allowedTypes?: string[] } | null | undefined>(undefined);

  const [dorm, setDorm] = useState<Partial<Dormitory>>(() => {
    if (dormitory) return dormitory;
    return {};
  });

  React.useEffect(() => {
    let isMounted = true;
    const fetchDefaults = async () => {
      try {
        const dataProvider = getDataProvider();
        const res = await dataProvider.properties.getDormitoryDefaults();
        if (isMounted) {
          if (res?.success && res?.data?.property?.petPolicy) {
            setPropertyDefaultsPolicy(res.data.property.petPolicy);
          } else {
            setPropertyDefaultsPolicy({ allowed: 'none', allowedTypes: [] });
          }
        }
      } catch {
        if (isMounted) {
          setPropertyDefaultsPolicy({ allowed: 'none', allowedTypes: [] });
        }
      }
    };
    fetchDefaults();
    return () => { isMounted = false; };
  }, [effectiveDormId]);

  React.useEffect(() => {
    let isMounted = true;
    if (dormitory) {
      setDorm(dormitory);
      return;
    }
    const loadDorm = async () => {
      try {
        const dormId = effectiveDormId;
        if (dormId) {
          const fetched = await getDataProvider().dormitories.getById(dormId);
          if (isMounted && fetched) {
            setDorm(prev => ({ ...prev, ...fetched }));
          }
        }
      } catch (err) {
        // Authority-safe fallback to existing state
      }
    };
    loadDorm();
    return () => { isMounted = false; };
  }, [dormitory, effectiveDormId]);

  const initialTargetTenantId = initialTenantId || returnContext?.tenantId;
  const initialFoundTenant = initialTargetTenantId ? (tenants.find(t => t.id === initialTargetTenantId) || null) : null;
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStatusTab, setActiveStatusTab] = useState<'pending' | 'active' | 'inactive'>(() => {
    if (initialFoundTenant?.status === 'pending') return 'pending';
    if (initialFoundTenant?.status === 'inactive') return 'inactive';
    return 'active';
  });
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(initialFoundTenant);

  const [cameFromMeters, setCameFromMeters] = useState(Boolean(cameFromMetersProp));
  const [originTab, setOriginTab] = useState<'rooms' | 'meters' | string | null>(tenantOriginTab || returnContext?.source || (cameFromMetersProp ? 'meters' : null));

  React.useEffect(() => {
    if (returnContext?.source) {
      setOriginTab(returnContext.source);
    } else if (cameFromMetersProp) {
      setOriginTab('meters');
      setCameFromMeters(true);
    } else if (tenantOriginTab) {
      setOriginTab(tenantOriginTab);
    } else {
      setOriginTab(null);
    }
  }, [tenantOriginTab, returnContext, cameFromMetersProp]);

  // Auto select tenant on mount if initialTenantId or returnContext.tenantId provided
  React.useEffect(() => {
    const targetId = initialTenantId || returnContext?.tenantId;
    if (targetId) {
      const tenant = tenants.find(t => t.id === targetId);
      if (tenant) {
        setSelectedTenant(tenant);
        setProfileTab('info');
        if (tenant.status === 'pending') {
          setActiveStatusTab('pending');
        } else if (tenant.status === 'inactive') {
          setActiveStatusTab('inactive');
        } else {
          setActiveStatusTab('active');
        }
        if (initialTenantId && onClearInitialTenantId) {
          onClearInitialTenantId();
        }
      }
    }
  }, [initialTenantId, returnContext, tenants, onClearInitialTenantId]);

  const [profileTab, setProfileTab] = useState<'info' | 'contract' | 'history'>('info');

  // Daily tenants do not have a contract tab; automatically redirect to info tab
  React.useEffect(() => {
    if (selectedTenant && isDailyTenant(selectedTenant, contracts) && profileTab === 'contract') {
      setProfileTab('info');
    }
  }, [selectedTenant, contracts, profileTab]);
  const [isIdCardOpen, setIsIdCardOpen] = useState(false);
  const idCardInputRef = useRef<HTMLInputElement>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [idCardPhoto, setIdCardPhoto] = useState('');
  const [pendingIdCardFile, setPendingIdCardFile] = useState<File | null>(null);
  const [docTab, setDocTab] = useState<'uploaded' | 'simulated'>('uploaded');

  // Synchronize authoritative tenant details into selectedTenant, ensuring background refetches never overwrite unsaved form state
  React.useEffect(() => {
    if (tenantDetailsData?.tenant && selectedTenant && !isEditOpen) {
      const serverTenant = tenantDetailsData.tenant;
      if (serverTenant.id === selectedTenant.id) {
        setSelectedTenant(prev => {
          if (!prev || prev.id !== serverTenant.id) return prev;
          const emergencyContacts = tenantDetailsData.emergencyContacts;
          const coOccupants = tenantDetailsData.coOccupants;
          const coOccupantHistory = tenantDetailsData.coOccupantHistory;
          const vehicles = tenantDetailsData.vehicles;

          const serverPets = serverTenant.pets ?? (Array.isArray(serverTenant.petInfo) ? serverTenant.petInfo : []);
          const serverPet = serverTenant.pet ?? {
            hasPet: serverPets.length > 0,
            type: serverPets[0]?.type || '',
            name: serverPets[0]?.name || '',
          };

          const hasIdDoc = Boolean(serverTenant.hasIdentityDocument);
          const docUrl = hasIdDoc
            ? (serverTenant.idCardPhotoMock || (effectiveDormId ? getDataProvider().tenants.getIdentityDocumentUrl(serverTenant.id, effectiveDormId) : undefined))
            : undefined;

          return {
            ...prev,
            ...serverTenant,
            name: serverTenant.name || serverTenant.displayName || prev.name,
            phone: serverTenant.phone || prev.phone,
            email: serverTenant.email ?? '',
            citizenId: serverTenant.nationalIdMasked ?? serverTenant.citizenId ?? '',
            lineFriendId: serverTenant.lineFriendId ?? null,
            emergencyContact: (emergencyContacts && emergencyContacts.length > 0)
              ? {
                name: emergencyContacts[0].name || '',
                relationship: emergencyContacts[0].relationship || '',
                phone: emergencyContacts[0].phone || '',
              }
              : (serverTenant.emergencyContact && serverTenant.emergencyContact.name)
                ? serverTenant.emergencyContact
                : {
                  name: '',
                  relationship: '',
                  phone: '',
                },
            coOccupants: coOccupants ?? serverTenant.coOccupants ?? [],
            coOccupantHistory: coOccupantHistory ?? serverTenant.coOccupantHistory ?? [],
            vehicles: vehicles ?? serverTenant.vehicles ?? [],
            vehicle: (vehicles && vehicles.length > 0)
              ? vehicles[0]
              : ((serverTenant.vehicles && serverTenant.vehicles.length > 0)
                ? serverTenant.vehicles[0]
                : { type: 'none' as const, licensePlate: '', brand: '' }),
            pets: serverPets,
            pet: serverPet,
            hasIdentityDocument: hasIdDoc,
            idCardPhotoMock: docUrl,
          };
        });
      }
    }
  }, [tenantDetailsData, isEditOpen]);

  // Contract tab modals and interaction states
  const [selectedContractForPrint, setSelectedContractForPrint] = useState<Contract | null>(null);
  const [isPrintContractModalOpen, setIsPrintContractModalOpen] = useState(false);

  const [selectedContractForEdit, setSelectedContractForEdit] = useState<Contract | null>(null);
  const [isEditContractModalOpen, setIsEditContractModalOpen] = useState(false);
  const [editContractStartDate, setEditContractStartDate] = useState('');
  const [editContractEndDate, setEditContractEndDate] = useState('');
  const [editContractDuration, setEditContractDuration] = useState(6);
  const [editContractRent, setEditContractRent] = useState(0);
  const [editContractDeposit, setEditContractDeposit] = useState(0);
  const [editContractDepositStatus, setEditContractDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [editContractDepositType, setEditContractDepositType] = useState<'refundable' | 'deduct_rent'>('refundable');
  const [editContractAdvancePayment, setEditContractAdvancePayment] = useState(0);
  const [editContractTerms, setEditContractTerms] = useState('');

  // Renew contract states
  const [selectedContractForRenew, setSelectedContractForRenew] = useState<Contract | null>(null);
  const [isRenewContractModalOpen, setIsRenewContractModalOpen] = useState(false);
  const [renewContractUnit, setRenewContractUnit] = useState<'month' | 'day'>('month');
  const [renewContractMonths, setRenewContractMonths] = useState(6);
  const [renewContractDays, setRenewContractDays] = useState(0);
  const [renewContractStartDate, setRenewContractStartDate] = useState('');
  const [renewContractEndDate, setRenewContractEndDate] = useState('');
  const [renewContractRentAmount, setRenewContractRentAmount] = useState(0);
  const [renewContractDepositAmount, setRenewContractDepositAmount] = useState(0);
  const [renewContractDepositOption, setRenewContractDepositOption] = useState<'rollover' | 'custom'>('rollover');
  const [renewContractNote, setRenewContractNote] = useState('');

  // Pending Review Sub Tab: 'all' | 'expired' | 'new_tenant'
  const [pendingSubTab, setPendingSubTab] = useState<'all' | 'expired' | 'new_tenant'>('all');
  const [selectedContractForReview, setSelectedContractForReview] = useState<Contract | null>(null);

  // Create new contract states
  const [isCreateContractModalOpen, setIsCreateContractModalOpen] = useState(false);
  const [createContractRoomId, setCreateContractRoomId] = useState('');
  const [createContractStartDate, setCreateContractStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [createContractStayDate, setCreateContractStayDate] = useState(new Date().toISOString().split('T')[0]);
  const [createContractEndDate, setCreateContractEndDate] = useState('');
  const [createContractDuration, setCreateContractDuration] = useState(6);
  const [createContractRent, setCreateContractRent] = useState(4000);
  const [createContractDeposit, setCreateContractDeposit] = useState(8000);
  const [createContractDepositStatus, setCreateContractDepositStatus] = useState<'paid' | 'unpaid'>('paid');
  const [createContractDepositType, setCreateContractDepositType] = useState<'refundable' | 'deduct_rent'>('refundable');
  const [createContractAdvancePayment, setCreateContractAdvancePayment] = useState(0);
  const [createContractTerms, setCreateContractTerms] = useState(
    `1. ผู้เช่าต้องชำระค่าเช่าห้องพักภายในวันที่ 5 ของทุกเดือน หากล่าช้ามีค่าปรับวันละ 100 บาท\n2. เงินประกันความเสียหายจะคืนให้เมื่อสิ้นสุดสัญญาเช่าและหักลบค่าเสียหาย/ค่าน้ำ-ไฟแล้ว\n3. ห้ามส่งเสียงดังรบกวนผู้พักอาศัยห้องอื่นหลังเวลา 22:00 น.\n4. ห้ามเลี้ยงสัตว์เลี้ยงชนิดที่ส่งเสียงดังหรือทำสิ่งผิดกฎหมายในอาคารหอพัก`
  );
  const [createContractTenantSig, setCreateContractTenantSig] = useState<string | undefined>(undefined);
  const [contractToast, setContractToast] = useState<string | null>(null);

  // Lease termination states
  const [isTerminateOpen, setIsTerminateOpen] = useState(false);
  const [isSuccessAnimating, setIsSuccessAnimating] = useState(false);
  const [terminateReason, setTerminateReason] = useState<'early' | 'normal' | 'prepare_vacant'>('normal');
  const [refundDeposit, setRefundDeposit] = useState(true);
  const [damageFee, setDamageFee] = useState<string>('0');
  const [deductionItems, setDeductionItems] = useState<Array<{ id: string; title: string; amount: number | string }>>([]);

  // Pending tenant approve / reject states
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [approveRoomId, setApproveRoomId] = useState('');
  const [approveRentalType, setApproveRentalType] = useState<'MONTHLY' | 'TERM' | 'DAILY'>('MONTHLY');
  const [approveStartDate, setApproveStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [approveEndDate, setApproveEndDate] = useState<string>('');
  const [approveDurationMonths, setApproveDurationMonths] = useState<number>(12);
  const [approveDays, setApproveDays] = useState<number>(1);
  const [approveDailyRate, setApproveDailyRate] = useState<string>('0');
  const [approveDeposit, setApproveDeposit] = useState<string>('');
  const [approveRent, setApproveRent] = useState<string>('');
  const [approveDepositDeclaredStatus, setApproveDepositDeclaredStatus] = useState<'UNPAID' | 'PAID'>('UNPAID');
  const [approveIdCardFile, setApproveIdCardFile] = useState<File | null>(null);
  const [approveIdCardPreview, setApproveIdCardPreview] = useState<string | null>(null);
  const [approveIdCardError, setApproveIdCardError] = useState<string | null>(null);
  const [approveAttachments, setApproveAttachments] = useState<any[]>([]);
  const [isReplacingIdDoc, setIsReplacingIdDoc] = useState(false);
  const [ownerAttachmentName, setOwnerAttachmentName] = useState<string>('');
  const [ownerAttachmentFile, setOwnerAttachmentFile] = useState<File | null>(null);
  const [previewAttachmentUrl, setPreviewAttachmentUrl] = useState<string | null>(null);
  const [previewAttachmentTitle, setPreviewAttachmentTitle] = useState<string>('');
  const [rejectReason, setRejectReason] = useState('');

  // Daily stay extension modal states
  const [isDailyExtendOpen, setIsDailyExtendOpen] = useState(false);
  const [dailyExtendTenant, setDailyExtendTenant] = useState<Tenant | null>(null);
  const [dailyExtendCurrentCheckOut, setDailyExtendCurrentCheckOut] = useState<string>('');
  const [dailyExtendNewCheckOut, setDailyExtendNewCheckOut] = useState<string>('');
  const [dailyExtendDays, setDailyExtendDays] = useState<number>(1);
  const [dailyExtendRate, setDailyExtendRate] = useState<number>(550);
  const [dailyExtendTotal, setDailyExtendTotal] = useState<number>(550);

  // Multi-step form state for adding new tenant
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copySuccessToast, setCopySuccessToast] = useState<string | null>(null);
  const [tenantActionToast, setTenantActionToast] = useState<string | null>(null);
  const [isTenantActionToastFading, setIsTenantActionToastFading] = useState(false);

  React.useEffect(() => {
    if (tenantActionToast) {
      setIsTenantActionToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsTenantActionToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setTenantActionToast(null);
        setIsTenantActionToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [tenantActionToast]);

  React.useEffect(() => {
    if (!copySuccessToast) return;
    const timer = setTimeout(() => {
      setCopySuccessToast(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [copySuccessToast]);

  const eligibleRoomsForApproval = React.useMemo(() => {
    if (!selectedTenant) return rooms;
    const reqStart = approveStartDate ? new Date(approveStartDate).getTime() : 0;
    const reqEnd = approveEndDate
      ? new Date(approveEndDate).getTime()
      : (reqStart + (approveRentalType === 'DAILY' ? approveDays * 24 * 60 * 60 * 1000 : approveDurationMonths * 30 * 24 * 60 * 60 * 1000));

    return rooms.filter(r => {
      // 1. Filter out maintenance rooms
      if (r.status === 'maintenance') return false;

      // 2. Filter out rooms occupied by active tenants with conflicting dates
      const hasConflictingContract = (contracts || []).some(c => {
        if (c.roomId !== r.id && c.roomId !== r.roomNumber) return false;
        if (c.status !== 'active' && c.status !== 'expiring_soon' && c.status !== 'waiting_extension') return false;
        if (c.tenantId === selectedTenant.id) return false;
        const cStart = new Date(c.startDate).getTime();
        const cEnd = new Date(c.endDate).getTime();
        if (isNaN(cStart) || isNaN(cEnd)) return true;
        return reqStart < cEnd && reqEnd > cStart;
      });
      if (hasConflictingContract) return false;

      const hasActiveTenant = tenants.some(t => {
        if (t.id === selectedTenant.id) return false;
        if (t.roomId !== r.id && t.roomId !== r.roomNumber) return false;
        return t.status === 'active';
      });
      if (hasActiveTenant) return false;

      return true;
    });
  }, [rooms, contracts, tenants, selectedTenant, approveStartDate, approveEndDate, approveRentalType, approveDays, approveDurationMonths]);

  const approvalRoomOptions = React.useMemo(() => {
    const list = [...eligibleRoomsForApproval];
    if (approveRoomId && !list.some(r => r.id === approveRoomId)) {
      const selected = rooms.find(r => r.id === approveRoomId);
      if (selected) list.push(selected);
    }
    return list.sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true }));
  }, [eligibleRoomsForApproval, approveRoomId, rooms]);

  // Quick Add Tenant Modal states (TERM / MONTHLY / DAILY)
  const [quickAddModalOpen, setQuickAddModalOpen] = useState(false);
  const [selectedQuickAddContext, setSelectedQuickAddContext] = useState<QuickAddRoomContext | null>(null);
  const [quickAddLoading, setQuickAddLoading] = useState(false);

  // Form Fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [coOccupants, setCoOccupants] = useState<CoOccupant[]>([]);
  const [coName, setCoName] = useState('');
  const [coPhone, setCoPhone] = useState('');
  const [coRelationship, setCoRelationship] = useState('แฟน');
  const [coCustomRelationship, setCoCustomRelationship] = useState('');

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [vehicleType, setVehicleType] = useState<'car' | 'motorcycle' | 'bicycle' | 'none'>('none');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehiclesList, setVehiclesList] = useState<VehicleItem[]>([]);

  const [hasPet, setHasPet] = useState(false);
  const [petType, setPetType] = useState('');
  const [customPetType, setCustomPetType] = useState('');
  const [petName, setPetName] = useState('');
  const [petsList, setPetsList] = useState<PetItem[]>([]);

  const handleAddPet = () => {
    setPetsList(prev => [...prev, { id: `temp-pet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: '', customType: '', name: '' }]);
  };

  const handleRemovePet = (index: number) => {
    setPetsList(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length > 0 ? updated : [{ id: `temp-pet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: '', customType: '', name: '' }];
    });
  };

  const handlePetChange = (index: number, field: keyof PetItem, value: string) => {
    setPetsList(prev => prev.map((p, i) => {
      if (i === index) {
        if (field === 'type' && value !== 'อื่นๆ') {
          return { ...p, type: value, customType: '' };
        }
        return { ...p, [field]: value };
      }
      return p;
    }));
  };

  const handleAddVehicle = () => {
    setVehiclesList(prev => [...prev, { id: Date.now().toString(), type: 'motorcycle', licensePlate: '', brand: '' }]);
  };

  const handleRemoveVehicle = (index: number) => {
    setVehiclesList(prev => {
      const updated = prev.filter((_, i) => i !== index);
      return updated.length > 0 ? updated : [{ id: Date.now().toString(), type: 'none', licensePlate: '', brand: '' }];
    });
  };

  const handleVehicleChange = (index: number, field: keyof VehicleItem, value: string) => {
    setVehiclesList(prev => prev.map((v, i) => {
      if (i === index) {
        if (field === 'type' && value === 'none') {
          return { ...v, type: 'none', licensePlate: '', brand: '' };
        }
        if (field === 'type' && value === 'bicycle') {
          return { ...v, type: 'bicycle', licensePlate: '-' };
        }
        return { ...v, [field]: value };
      }
      return v;
    }));
  };

  const [selectedRoomId, setSelectedRoomId] = useState('');

  // States for direct add / remove co-occupant in History tab
  const [isAddCoModalOpen, setIsAddCoModalOpen] = useState(false);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [newCoRelationship, setNewCoRelationship] = useState('แฟน');
  const [newCoCustomRelationship, setNewCoCustomRelationship] = useState('');

  const [coToDelete, setCoToDelete] = useState<CoOccupant | null>(null);
  const [isDeleteCoModalOpen, setIsDeleteCoModalOpen] = useState(false);
  const [deleteCoReason, setDeleteCoReason] = useState('');

  const getEffectiveCoOccupantHistory = (tenant: Tenant): CoOccupantHistoryItem[] => {
    const historyList = tenant.coOccupantHistory || [];
    if (historyList.length > 0) {
      return [...historyList].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }

    // If no history records stored, generate initial records from current coOccupants
    const derived: CoOccupantHistoryItem[] = (tenant.coOccupants || []).map((co, idx) => ({
      id: `coh-derived-${co.id || idx}`,
      coOccupantId: co.id,
      name: co.name,
      phone: co.phone,
      citizenId: co.citizenId,
      action: 'added',
      timestamp: co.addedAt || tenant.createdAt,
      note: 'ลงทะเบียนเข้าพักพร้อมผู้เช่าหลัก'
    }));

    return derived.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const handleAddNewCoOccupant = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedTenant) return;
    if (!newCoName.trim() || !newCoPhone.trim()) return;

    const nowIso = new Date().toISOString();
    const finalRel = newCoRelationship === 'อื่นๆ' ? (newCoCustomRelationship.trim() || 'อื่นๆ') : newCoRelationship;

    const newCo: CoOccupant = {
      id: `co-tmp-${Date.now()}`,
      name: newCoName.trim(),
      phone: newCoPhone.trim(),
      relationship: finalRel,
      addedAt: nowIso
    };

    const newHistoryItem: CoOccupantHistoryItem = {
      id: `coh-${Date.now()}`,
      coOccupantId: newCo.id,
      name: newCo.name,
      phone: newCo.phone,
      relationship: finalRel,
      action: 'added',
      timestamp: nowIso,
      note: finalRel ? `สถานะ: ${finalRel}` : 'เพิ่มเข้าพักโดยผู้ดูแลหอพัก'
    };

    const currentHistory = selectedTenant.coOccupantHistory && selectedTenant.coOccupantHistory.length > 0
      ? selectedTenant.coOccupantHistory
      : getEffectiveCoOccupantHistory(selectedTenant);

    const updatedTenant: Tenant = {
      ...selectedTenant,
      coOccupants: [...(selectedTenant.coOccupants || []), newCo],
      coOccupantHistory: [newHistoryItem, ...currentHistory],
      updatedAt: nowIso
    };

    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? updatedTenant : t);
    onSaveTenants(updatedTenants);
    setSelectedTenant(updatedTenant);
    onAddLog('เพิ่มผู้พักร่วม', `เพิ่มคุณ ${newCo.name} (${formatPhone(newCo.phone)}) สถานะ: ${finalRel} เป็นผู้พักร่วมของคุณ ${selectedTenant.name}`, 'Tenant', selectedTenant.id);

    setNewCoName('');
    setNewCoPhone('');
    setNewCoRelationship('แฟน');
    setNewCoCustomRelationship('');
    setIsAddCoModalOpen(false);
    setTenantActionToast('เพิ่มผู้พักร่วมเรียบร้อยแล้ว');
  };

  const handleConfirmRemoveCoOccupant = () => {
    if (!selectedTenant || !coToDelete) return;
    const nowIso = new Date().toISOString();

    const removeHistoryItem: CoOccupantHistoryItem = {
      id: `coh-${Date.now()}`,
      coOccupantId: coToDelete.id,
      name: coToDelete.name,
      phone: coToDelete.phone,
      citizenId: coToDelete.citizenId,
      action: 'removed',
      timestamp: nowIso,
      note: deleteCoReason.trim() || 'แจ้งย้ายออกจากห้องพัก'
    };

    const currentHistory = selectedTenant.coOccupantHistory && selectedTenant.coOccupantHistory.length > 0
      ? selectedTenant.coOccupantHistory
      : getEffectiveCoOccupantHistory(selectedTenant);

    const updatedCoOccupants = (selectedTenant.coOccupants || []).filter(c => c.id !== coToDelete.id);
    const updatedTenant: Tenant = {
      ...selectedTenant,
      coOccupants: updatedCoOccupants,
      coOccupantHistory: [removeHistoryItem, ...currentHistory],
      updatedAt: nowIso
    };

    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? updatedTenant : t);
    onSaveTenants(updatedTenants);
    setSelectedTenant(updatedTenant);
    onAddLog('นำผู้พักร่วมออก', `นำคุณ ${coToDelete.name} ออกจากห้องพักของคุณ ${selectedTenant.name}`, 'Tenant', selectedTenant.id);

    setIsDeleteCoModalOpen(false);
    setCoToDelete(null);
    setDeleteCoReason('');
    setTenantActionToast('นำผู้พักร่วมออกเรียบร้อยแล้ว');
  };

  const buildRoomContext = async (targetRoom: Room): Promise<QuickAddRoomContext> => {
    const dormId = dormitory?.id || 'demo-dorm';
    try {
      const res = await httpRequest<{ data: QuickAddRoomContext }>(
        'GET',
        `/api/v1/properties/rooms/${targetRoom.id}/quick-add-context`,
        undefined,
        { headers: dormId ? { 'x-dormitory-id': dormId } : {} }
      );
      if (res.data && res.data.effective) {
        return res.data;
      }
    } catch {
      // Fallback below
    }

    return {
      roomId: targetRoom.id,
      dormitoryId: dormId,
      roomNumber: targetRoom.roomNumber,
      buildingId: targetRoom.buildingId || undefined,
      effective: {
        monthlyRent: targetRoom.monthlyRent || 0,
        monthlyDeposit: targetRoom.monthlyDeposit ?? targetRoom.depositAmount ?? 0,
        termRent: targetRoom.termRent ?? ((targetRoom.monthlyRent || 0) * 4),
        termDeposit: targetRoom.termDeposit ?? targetRoom.depositAmount ?? 0,
        termMonths: 4,
        dailyRate: targetRoom.dailyRent ?? 500,
        dailyDeposit: targetRoom.dailyDeposit ?? 500,
      },
      building: {
        id: targetRoom.buildingId || 'bld-1',
        name: 'อาคารหลัก',
        termMonths: 4,
        maxInstallments: 1,
      },
      roomType: 'ห้องมาตรฐาน',
      floor: targetRoom.floor,
    };
  };

  // Handle open Quick Add Tenant modal
  const handleOpenAddWizard = async () => {
    setErrorText(null);
    const vacantRooms = getTrulyVacantRooms(rooms, contracts || [], tenants);
    if (vacantRooms.length === 0) {
      alert('ไม่มีห้องว่างที่พร้อมให้เช่าในขณะนี้ (ทุกห้องมีผู้เช่าหรือมีสัญญาจองแล้ว)');
      return;
    }

    const firstVacant = vacantRooms[0];
    setQuickAddLoading(true);
    try {
      const ctx = await buildRoomContext(firstVacant);
      setSelectedQuickAddContext(ctx);
      setQuickAddModalOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setQuickAddLoading(false);
    }
  };

  const handleSelectQuickAddRoom = async (roomId: string) => {
    const targetRoom = rooms.find(r => r.id === roomId);
    if (!targetRoom) return;
    const ctx = await buildRoomContext(targetRoom);
    setSelectedQuickAddContext(ctx);
  };

  const handleQuickAddSuccess = (message: string, result?: QuickAddSuccessResult) => {
    const targetRoomId = result?.roomId || selectedQuickAddContext?.roomId;
    const targetRoom = rooms.find(r => r.id === targetRoomId);
    const newTenantId = result?.tenantId || `tenant-${Date.now()}`;
    const newTenantName = result?.fullName || 'ผู้เช่าใหม่';
    const newTenantPhone = result?.phone || '';
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.split('T')[0];

    const newTenant: Tenant = {
      id: newTenantId,
      name: newTenantName,
      phone: newTenantPhone,
      email: '',
      citizenId: '',
      roomId: targetRoomId,
      status: 'active',
      lifecycleStage: 'OWNER_CREATED',
      rentalType: result?.rentalType,
      lineFriendId: null,
      joinDate: todayStr,
      depositPaid: true,
      coOccupants: [],
      vehicles: [],
      pets: [],
      emergencyContacts: [],
      rentalHistory: targetRoom ? [
        {
          roomId: targetRoom.id,
          roomNumber: targetRoom.roomNumber,
          startDate: todayStr,
          depositAmount: targetRoom.depositAmount || 0,
          monthlyRent: targetRoom.monthlyRent || 0,
        }
      ] : []
    };

    // Update room occupancy
    const updatedRooms = rooms.map(r => {
      if (r.id === targetRoomId) {
        return {
          ...r,
          status: 'occupied' as const,
          currentTenantId: newTenant.id,
        };
      }
      return r;
    });

    // Create contract record
    if (targetRoom) {
      const newContract: Contract = {
        id: `contract-${Date.now()}`,
        tenantId: newTenant.id,
        roomId: targetRoom.id,
        roomNumber: targetRoom.roomNumber,
        startDate: todayStr,
        status: 'active',
        rentAmount: targetRoom.monthlyRent || 0,
        depositAmount: targetRoom.depositAmount || 0,
        rentalType: result?.rentalType === 'DAILY' ? 'daily' : (result?.rentalType === 'TERM' ? 'term' : 'monthly'),
        createdAt: nowIso,
      };
      if (onSaveContracts && contracts) {
        onSaveContracts([newContract, ...contracts]);
      }
    }

    const updatedTenants = [newTenant, ...tenants];
    onSaveTenants(updatedTenants);
    onSaveRooms(updatedRooms);

    onAddLog(
      'เพิ่มผู้เช่าด่วน',
      `เพิ่มผู้เช่าคุณ ${newTenant.name} เข้าห้อง ${targetRoom?.roomNumber || ''} (${result?.rentalType || 'MONTHLY'})`,
      'Tenant',
      newTenant.id
    );

    setActiveStatusTab('active');
    setSelectedTenant(newTenant);
    setSelectedContractForReview(null);
    setQuickAddModalOpen(false);
    setSelectedQuickAddContext(null);
    setTenantActionToast('เพิ่มผู้เช่าเรียบร้อยแล้ว');
  };

  const handleAddCoOccupant = () => {
    if (coName.trim() && coPhone.trim()) {
      const finalRel = coRelationship === 'อื่นๆ' ? (coCustomRelationship.trim() || 'อื่นๆ') : coRelationship;
      const newCo: CoOccupant = {
        id: `co-tmp-${Date.now()}`,
        name: coName.trim(),
        phone: coPhone.trim(),
        relationship: finalRel,
        addedAt: new Date().toISOString()
      };
      setCoOccupants([...coOccupants, newCo]);
      setCoName('');
      setCoPhone('');
      setCoRelationship('แฟน');
      setCoCustomRelationship('');
    }
  };

  const handleRemoveCoOccupant = (id: string) => {
    setCoOccupants(coOccupants.filter(c => c.id !== id));
  };

  const handleNextStep = () => {
    setErrorText(null);
    if (currentStep === 0) {
      // Validate step 0
      if (!name.trim() || !phone.trim() || !citizenId.trim()) {
        setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
        return;
      }
      setCurrentStep(1);
    } else if (currentStep === 1) {
      // Validate emergency
      if (!emergencyName.trim() || !emergencyPhone.trim()) {
        setErrorText('กรุณากรอกผู้ติดต่อฉุกเฉินอย่างน้อย 1 ท่าน');
        return;
      }
      setCurrentStep(2);
    }
  };

  const handleSaveTenant = () => {
    setErrorText(null);
    if (!selectedRoomId) {
      setErrorText('กรุณาเลือกห้องพักสำหรับจัดสรรผู้เช่า');
      return;
    }

    const newTenantId = `tenant-${Date.now()}`;
    const nowIso = new Date().toISOString();
    const formattedCoOccupants = coOccupants.map(c => ({
      ...c,
      addedAt: c.addedAt || nowIso
    }));
    const initialCoHistory: CoOccupantHistoryItem[] = formattedCoOccupants.map(c => ({
      id: `coh-${Date.now()}-${c.id}`,
      coOccupantId: c.id,
      name: c.name,
      phone: c.phone,
      citizenId: c.citizenId,
      action: 'added',
      timestamp: c.addedAt || nowIso,
      note: 'ลงทะเบียนเข้าพักพร้อมผู้เช่าหลัก'
    }));

    const newTenant: Tenant = {
      id: newTenantId,
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      citizenId: citizenId.trim(),
      coOccupants: formattedCoOccupants,
      coOccupantHistory: initialCoHistory,
      emergencyContact: {
        name: emergencyName.trim(),
        relationship: emergencyRelation.trim(),
        phone: emergencyPhone.trim()
      },
      vehicle: {
        type: vehicleType,
        licensePlate: vehicleType === 'bicycle' ? (vehiclePlate.trim() || '-') : vehiclePlate.trim(),
        brand: vehicleBrand.trim()
      },
      pet: {
        hasPet,
        type: hasPet ? (petType === 'อื่นๆ' ? (customPetType.trim() || 'อื่นๆ') : petType) : undefined,
        name: hasPet ? petName : undefined
      },
      rentalHistory: [selectedRoomId],
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    // Update Room Status & CurrentTenantId
    const updatedRooms = rooms.map(r => r.id === selectedRoomId ? {
      ...r,
      status: 'occupied' as const,
      currentTenantId: newTenantId
    } : r);

    const updatedTenants = [...tenants, newTenant];

    onSaveRooms(updatedRooms);
    onSaveTenants(updatedTenants);

    onAddLog('จดทะเบียนผู้เช่าใหม่', `ย้ายผู้เช่า ${name} เข้าพักห้อง ${rooms.find(r => r.id === selectedRoomId)?.roomNumber}`, 'Tenant', newTenantId);

    setIsAddOpen(false);
  };

  const handleDeleteTenant = (tenantId: string, tenantName: string) => {
    const blockingReasons: string[] = [];

    // Check 1: Tenant assigned to room
    const assignedRoom = rooms.find(r => r.currentTenantId === tenantId);
    if (assignedRoom) {
      blockingReasons.push(`ผู้เช่ายังพักอยู่อาคาร ${assignedRoom.roomNumber}`);
    }

    // Check 2: Active or blocking contract
    const activeContracts = contracts.filter(
      c => c.tenantId === tenantId && BLOCKING_CONTRACT_STATUSES.includes(c.status)
    );
    if (activeContracts.length > 0) {
      blockingReasons.push(`มีสัญญาเช่าที่ยังมีผลบังคับใช้ ${activeContracts.length} ฉบับ`);
    }

    // Check 3: Outstanding bills
    const tenantBills = bills.filter(b => b.tenantId === tenantId);
    if (tenantBills.length > 0) {
      blockingReasons.push(`มีประวัติใบแจ้งชำระเงิน/บิลในระบบ ${tenantBills.length} รายการ`);
    }

    if (blockingReasons.length > 0) {
      alert(`ไม่สามารถถอนผู้เช่า "${tenantName}" ออกจากระบบถาวรได้ เนื่องจากยังมีข้อมูลผูกอยู่:\n\n• ` + blockingReasons.join('\n• ') + '\n\nกรุณาใช้ระบบเลิกเช่าคืนห้องพักแทนการลบออกถาวร');
      return;
    }

    if (window.confirm(`คุณต้องการถอนผู้เช่า "${tenantName}" ออกจากระบบถาวร?`)) {
      // clear tenant room mapping if any
      const updatedRooms = rooms.map(r => r.currentTenantId === tenantId ? {
        ...r,
        status: 'vacant' as const,
        currentTenantId: undefined
      } : r);

      const updatedTenants = tenants.filter(t => t.id !== tenantId);

      onSaveRooms(updatedRooms);
      onSaveTenants(updatedTenants);
      onAddLog('ลบผู้เช่า', `ถอนผู้เช่า ${tenantName} ออกจากประวัติระบบ`, 'Tenant', tenantId);
      setSelectedTenant(null);
    }
  };

  const getStayDurationText = (startDateStr: string) => {
    try {
      const start = new Date(startDateStr);
      const today = new Date();
      if (isNaN(start.getTime())) return 'ไม่ทราบวันที่เข้าพัก';
      const diffTime = Math.abs(today.getTime() - start.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 30) {
        return `${diffDays} วัน`;
      }
      const months = Math.floor(diffDays / 30);
      const remainingDays = diffDays % 30;
      if (remainingDays === 0) {
        return `${months} เดือน`;
      }
      return `${months} เดือน ${remainingDays} วัน`;
    } catch (e) {
      return 'ไม่พบข้อมูลระยะเวลา';
    }
  };

  const handleOpenTerminate = (tenant: Tenant) => {
    setSelectedTenant(tenant);
    setTerminateReason('normal');
    setRefundDeposit(true);
    setDamageFee('0');
    setDeductionItems([]);
    setIsSuccessAnimating(false);
    setIsTerminateOpen(true);
  };

  const handleConfirmTerminate = () => {
    if (!selectedTenant) return;

    setIsSuccessAnimating(true);

    setTimeout(async () => {
      const tenantId = selectedTenant.id;
      const tenantName = selectedTenant.name;
      const room = rooms.find(r => r.currentTenantId === tenantId);
      const roomNumber = room ? room.roomNumber : '';

      // Deposit amount from contract or room
      const tenantContracts = (contracts || []).filter(c => c.tenantId === tenantId);
      const activeContract = tenantContracts.find(c => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out') || tenantContracts[0];
      const origDeposit = activeContract?.depositAmount ?? room?.depositAmount ?? 0;
      const depFinancial = getDepositFinancialState(activeContract?.id, bills, origDeposit);
      const actualPaidDeposit = depFinancial.actualPaidDeposit;
      const hasPaidDeposit = depFinancial.isPaid && actualPaidDeposit > 0;

      // Filter valid deductions
      const validDeductions = deductionItems.filter(item => (Number(item.amount) || 0) > 0 || (item.title && item.title.trim() !== ''));
      const totalDeductions = validDeductions.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

      // Financial outcome (D5 & D6 Authority: only actual money received can be refunded or offset)
      const effectiveDeposit = (hasPaidDeposit && refundDeposit) ? actualPaidDeposit : 0;
      const netRefundAmount = (hasPaidDeposit && refundDeposit) ? Math.max(0, actualPaidDeposit - totalDeductions) : 0;
      const netExcessToPay = totalDeductions > effectiveDeposit ? (totalDeductions - effectiveDeposit) : 0;

      const deductionsSummaryText = validDeductions.length > 0
        ? validDeductions.map(d => `${d.title || 'ค่าใช้จ่าย'}: ${Number(d.amount) || 0} บาท`).join(', ')
        : 'ไม่มีรายการหัก';

      // 1. Update room status to vacant and clear currentTenantId & currentContractId
      const updatedRooms = rooms.map(r =>
        (r.currentTenantId === tenantId || (selectedTenant.roomId && r.id === selectedTenant.roomId) || (room && r.id === room.id))
          ? {
            ...r,
            status: 'vacant' as const,
            currentTenantId: undefined,
            currentContractId: undefined,
            updatedAt: new Date().toISOString()
          }
          : r
      );

      // 2. Set tenant status to inactive (preserve rentalHistory)
      const updatedTenants = tenants.map(t => {
        if (t.id === tenantId) {
          const currentHist = t.rentalHistory || [];
          const newHist = room && !currentHist.includes(room.id) ? [...currentHist, room.id] : currentHist;
          return {
            ...t,
            status: 'inactive' as const,
            rentalHistory: newHist,
            updatedAt: new Date().toISOString()
          };
        }
        return t;
      });

      // 3. Update contract status to 'terminated' and record audit trail in terms
      const settlementRecord = `[ระบบนิติ] เลิกเช่าคืนห้องพักเมื่อ ${new Date().toLocaleDateString('th-TH')}` +
        ` | เงินประกันตามสัญญา: ${origDeposit.toLocaleString()} บาท (ชำระจริง: ${actualPaidDeposit.toLocaleString()} บาท)` +
        ` | การจัดการเงินประกัน: ${!hasPaidDeposit ? 'ไม่มีเงินประกันที่ชำระแล้ว' : (refundDeposit ? 'คืนเงินประกัน (นำมาหักลดค่าใช้จ่าย)' : 'ไม่คืนเงินประกัน (ยึดเงินประกัน)')}` +
        ` | รายการค่าใช้จ่ายที่หัก: ${deductionsSummaryText}` +
        ` | รวมค่าใช้จ่ายที่หัก: ${totalDeductions.toLocaleString()} บาท` +
        (!hasPaidDeposit
          ? ` | ผู้เช่าต้องชำระค่าใช้จ่ายทั้งหมด: ${totalDeductions.toLocaleString()} บาท`
          : (refundDeposit
            ? (actualPaidDeposit >= totalDeductions
              ? ` | เงินประกันคืนผู้เช่าสุทธิ: ${netRefundAmount.toLocaleString()} บาท`
              : ` | เงินประกันช่วยลดค่าใช้จ่ายแล้ว มียอดต้องชำระเพิ่ม: ${netExcessToPay.toLocaleString()} บาท`)
            : ` | ผู้เช่าต้องชำระค่าใช้จ่ายทั้งหมด: ${totalDeductions.toLocaleString()} บาท`));

      const updatedContracts = contracts.map(c => {
        if (c.tenantId === tenantId && (c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out' || c.status === 'pending_signature' || c.status === 'expired' || c.status === 'waiting_extension')) {
          return {
            ...c,
            status: 'terminated' as any,
            terminationEffectiveDate: new Date().toISOString().slice(0, 10),
            terminatedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            terms: `${c.terms || ''}\n${settlementRecord}`,
            depositRefundAmount: netRefundAmount.toFixed(2),
            deductionAmount: totalDeductions.toFixed(2),
            settlementSummary: {
              depositRefundAmount: netRefundAmount.toFixed(2),
              deductionAmount: totalDeductions.toFixed(2),
              settlementNote: settlementRecord,
              terminatedAt: new Date().toISOString(),
            }
          };
        }
        return c;
      });

      // Terminate via API if activeContract exists and has backend UUID
      const activeContractId = activeContract?.id;
      if (activeContractId && !activeContractId.startsWith('ct-') && activeContractId.length >= 20) {
        try {
          await terminateContract(activeContractId, {
            terminationEffectiveDate: new Date().toISOString().slice(0, 10),
            terminationReason: `เลิกสัญญา: ${deductionsSummaryText}`,
            depositRefundAmount: netRefundAmount.toFixed(2),
            deductionAmount: totalDeductions.toFixed(2),
            settlementNote: settlementRecord,
            nextRoomStatus: 'vacant',
          });
        } catch (err) {
          console.warn('Failed to terminate contract via API:', err);
        }
      }

      // Direct tenant update on backend to ensure status is marked 'former' and room vacated
      if (tenantId && !tenantId.startsWith('t-') && tenantId.length >= 20) {
        try {
          await httpRequest('PUT', `/tenants/${tenantId}`, { status: 'former' });
        } catch (tErr) {
          console.warn('Failed to update tenant status to former directly:', tErr);
        }
      }

      if (queryClient && effectiveDormId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.contracts(effectiveDormId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.rooms(effectiveDormId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.bills(effectiveDormId) }),
          queryClient.invalidateQueries({ queryKey: ['meter', effectiveDormId] }),
        ]);
      }

      // 4. Update or generate bills
      let updatedBills = [...bills];
      const deductionBillItems: BillItem[] = validDeductions.map((item, idx) => ({
        id: `item-deduct-${Date.now()}-${idx}`,
        description: item.title || 'ค่าใช้จ่ายก่อนย้ายออก',
        amount: Number(item.amount) || 0,
        category: 'other',
        type: 'other_fee'
      }));

      const currentCycle = selectedCycle || new Date().toISOString().slice(0, 7);

      if (hasPaidDeposit && refundDeposit) {
        if (netExcessToPay > 0) {
          // Deposit covered partially, remaining excess billed to tenant
          const billItems: BillItem[] = [
            ...deductionBillItems,
            {
              id: `item-deposit-credit-${Date.now()}`,
              description: `หักชำระจากเงินประกันสัญญา (-${actualPaidDeposit.toLocaleString()} บาท)`,
              amount: -actualPaidDeposit,
              category: 'other'
            }
          ];
          const newFinalBill: Bill = {
            id: `bill-final-${tenantId}-${Date.now()}`,
            billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: billItems,
            totalAmount: netExcessToPay,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newFinalBill);
        } else if (validDeductions.length > 0) {
          // Deposit covered all deductions completely -> generate settled 0-balance bill for accounting records
          const settledBillItems: BillItem[] = [
            ...deductionBillItems,
            {
              id: `item-deposit-credit-${Date.now()}`,
              description: `หักชำระจากเงินประกันสัญญาครบถ้วน (-${totalDeductions.toLocaleString()} บาท)`,
              amount: -totalDeductions,
              category: 'other'
            }
          ];
          const settledBill: Bill = {
            id: `bill-settled-${tenantId}-${Date.now()}`,
            billNumber: `REC-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: settledBillItems,
            totalAmount: 0,
            dueDate: new Date().toISOString().split('T')[0],
            status: 'paid',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(settledBill);
        }
      } else {
        // No paid deposit or deposit forfeited: tenant must pay all deductions if any
        if (validDeductions.length > 0) {
          const newFinalBill: Bill = {
            id: `bill-final-${tenantId}-${Date.now()}`,
            billNumber: `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNumber || 'OUT'}`,
            cycleId: currentCycle,
            roomId: room ? room.id : '',
            tenantId: tenantId,
            items: deductionBillItems,
            totalAmount: totalDeductions,
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          updatedBills.push(newFinalBill);
        }
      }

      // 5. Save and trigger callbacks
      onSaveRooms(updatedRooms);
      onSaveTenants(updatedTenants);
      if (onSaveContracts) {
        onSaveContracts(updatedContracts);
      }
      if (onSaveBills) {
        onSaveBills(updatedBills);
      }

      // 6. Add action log
      const detailLog = `ผู้เช่า ${tenantName} เลิกเช่าคืนห้องพัก (ห้อง ${roomNumber}) - สถานะห้อง: ว่าง, สัญญา: หมดอายุ, เงินประกันสัญญา: ${origDeposit.toLocaleString()} บาท (ชำระจริง: ${actualPaidDeposit.toLocaleString()} บาท), การจัดการเงินประกัน: ${!hasPaidDeposit ? 'ไม่มีเงินประกันที่ชำระแล้ว' : (refundDeposit ? 'คืนเงินประกัน (หักลดค่าใช้จ่าย)' : 'ไม่คืนเงินประกัน (ยึด)')}, รายการหัก: ${deductionsSummaryText}, รวมหัก: ${totalDeductions.toLocaleString()} บาท, ${!hasPaidDeposit ? `จ่ายเต็ม ${totalDeductions.toLocaleString()} บาท` : (refundDeposit ? (actualPaidDeposit >= totalDeductions ? `คืนเงินประกัน ${netRefundAmount.toLocaleString()} บาท` : `จ่ายเพิ่ม ${netExcessToPay.toLocaleString()} บาท`) : `จ่ายเต็ม ${totalDeductions.toLocaleString()} บาท`)}`;
      onAddLog('เลิกเช่าคืนห้อง', detailLog, 'Tenant', tenantId);

      // 7. Close modals and switch directly to inactive tab with this tenant selected
      setIsSuccessAnimating(false);
      setIsTerminateOpen(false);

      const terminatedTenant = updatedTenants.find(t => t.id === tenantId);
      setActiveStatusTab('inactive');
      if (terminatedTenant) {
        setSelectedTenant(terminatedTenant);
      }
    }, 1200);
  };

  const handleOpenEditModal = (tenant: Tenant) => {
    setErrorText(null);
    setName(tenant.name);
    setPhone(tenant.phone);
    setEmail(tenant.email || '');
    setCitizenId(tenant.citizenId ?? (tenant as any).nationalIdMasked ?? '');

    const detailData = (tenantDetailsData?.tenant?.id === tenant.id) ? tenantDetailsData : null;
    const contact = (tenant as any).emergencyContacts?.[0] || detailData?.emergencyContacts?.[0] || tenant.emergencyContact;
    setEmergencyName(contact?.name || '');
    setEmergencyRelation(contact?.relationship || '');
    setEmergencyPhone(contact?.phone || '');

    // Multi vehicles initialization
    const sourceVehicles = (tenant.vehicles && tenant.vehicles.length > 0)
      ? tenant.vehicles
      : (detailData?.vehicles && detailData.vehicles.length > 0 ? detailData.vehicles : null);
    const initialVehicles: VehicleItem[] = sourceVehicles
      ? sourceVehicles.map((v: any) => ({ ...v, id: v.id || Math.random().toString() }))
      : (tenant.vehicle && tenant.vehicle.type !== 'none'
        ? [{ id: (tenant.vehicle as any).id || '1', type: tenant.vehicle.type, licensePlate: tenant.vehicle.licensePlate || '', brand: tenant.vehicle.brand || '' }]
        : [{ id: '1', type: 'none', licensePlate: '', brand: '' }]);
    setVehiclesList(initialVehicles);
    setVehicleType(tenant.vehicle?.type || 'none');
    setVehiclePlate(tenant.vehicle?.licensePlate || '');
    setVehicleBrand(tenant.vehicle?.brand || '');

    // Canonical Pet Groups initialization
    const initialPets: PetItem[] = tenant.pets && tenant.pets.length > 0
      ? tenant.pets.map(p => {
        const canonical = toCanonicalPetGroup(p.type);
        const resolvedCustomType = p.customType || canonical.customType || (canonical.type === 'other' && p.type !== 'other' && p.type !== 'อื่นๆ' ? p.type : undefined);
        return {
          id: p.id || undefined,
          type: canonical.type,
          customType: resolvedCustomType,
          name: p.name || ''
        };
      })
      : (tenant.pet?.hasPet
        ? (() => {
          const canonical = toCanonicalPetGroup(tenant.pet?.type || '');
          const resolvedCustomType = canonical.customType || (canonical.type === 'other' && tenant.pet?.type !== 'other' && tenant.pet?.type !== 'อื่นๆ' ? tenant.pet?.type : undefined);
          return [{
            id: undefined,
            type: canonical.type,
            customType: resolvedCustomType,
            name: tenant.pet?.name || ''
          }];
        })()
        : [{ id: `temp-pet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: '', customType: '', name: '' }]);
    setPetsList(initialPets);
    setHasPet(tenant.pet?.hasPet || (tenant.pets && tenant.pets.length > 0) || false);
    const primaryCanonical = toCanonicalPetGroup(tenant.pet?.type || '');
    setPetType(primaryCanonical.type);
    setCustomPetType(primaryCanonical.customType || (primaryCanonical.type === 'other' && tenant.pet?.type !== 'other' && tenant.pet?.type !== 'อื่นๆ' ? (tenant.pet?.type || '') : ''));
    setPetName(tenant.pet?.name || '');

    setIdCardPhoto(tenant.idCardPhotoMock || '');
    setPendingIdCardFile(null);
    setIsEditOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setPendingIdCardFile(file);
        const webpUrl = await convertImageToWebP(file);
        setIdCardPhoto(webpUrl);
      } catch (err) {
        console.error('Failed to convert ID card image to WebP', err);
      }
    }
  };

  const handleDirectIdCardUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedTenant) {
      try {
        const dataProvider = getDataProvider();
        const uploadRes = await dataProvider.tenants.uploadIdentityDocument(selectedTenant.id, file);
        if (!uploadRes.success) {
          setErrorText(uploadRes.error?.message || 'ไม่สามารถอัปโหลดสำเนาบัตรประชาชนได้');
          return;
        }
        if (queryClient && effectiveDormId) {
          await queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) });
          await queryClient.invalidateQueries({ queryKey: ['owner', effectiveDormId, 'tenants', selectedTenant.id] });
        }
        const docUrl = dataProvider.tenants.getIdentityDocumentUrl(selectedTenant.id, effectiveDormId);
        const updatedTenant: Tenant = {
          ...selectedTenant,
          version: uploadRes.data?.version !== undefined ? uploadRes.data.version : (selectedTenant.version ?? 1) + 1,
          hasIdentityDocument: true,
          idCardPhotoMock: docUrl,
          updatedAt: new Date().toISOString()
        };
        setSelectedTenant(updatedTenant);
        if (onSaveTenants) {
          onSaveTenants(tenants.map(t => t.id === selectedTenant.id ? updatedTenant : t));
        }
        onAddLog('อัปโหลดสำเนาบัตรประชาชน', `อัปโหลดเอกสารสำเนาบัตรประชาชนของผู้เช่า ${selectedTenant.name}`, 'Tenant', selectedTenant.id);
        setCopySuccessToast('อัปโหลดสำเนาบัตรประจำตัวประชาชนเรียบร้อยแล้ว');
        setTimeout(() => setCopySuccessToast(null), 3000);
      } catch (err) {
        console.error('Failed to upload ID card', err);
      }
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  const handlePrintIdCard = () => {
    if (!selectedTenant) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const hasPhoto = selectedTenant.idCardPhotoMock && selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64';
    const photoUrl = hasPhoto ? selectedTenant.idCardPhotoMock : '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="th">
      <head>
        <meta charset="UTF-8">
        <title>สำเนาบัตรประจำตัวประชาชน - ${selectedTenant.name}</title>
        <style>
          body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; line-height: 1.5; background: #ffffff; }
          .container { max-width: 650px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 16px; padding: 28px; background: #ffffff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { text-align: center; margin-bottom: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; }
          .title { font-size: 20px; font-weight: 800; color: #0f172a; }
          .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; font-weight: 600; }
          .card-frame { border: 2px dashed #94a3b8; border-radius: 12px; padding: 16px; text-align: center; background: #f8fafc; margin-bottom: 24px; min-height: 220px; flex-direction: column; display: flex; align-items: center; justify-content: center; }
          .card-img { max-width: 100%; max-height: 320px; object-fit: contain; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .no-img { padding: 40px; color: #64748b; font-size: 14px; font-weight: bold; }
          .section-title { font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 10px; border-left: 4px solid #3b82f6; padding-left: 8px; }
          .info-grid { width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px; }
          .info-grid td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }
          .label { font-weight: 700; color: #475569; width: 38%; }
          .value { color: #0f172a; font-weight: 600; }
          .footer-note { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
          @media print {
            body { padding: 0; background: none; }
            .container { border: none; box-shadow: none; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="title">เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า</div>
            <div class="subtitle">ระบบบริหารจัดการหอพัก HorPlus</div>
          </div>
          
          <div class="card-frame">
            ${hasPhoto
        ? '<img src="' + photoUrl + '" class="card-img" alt="สำเนาบัตรประชาชน" />'
        : '<div class="no-img">( ไม่ได้แนบไฟล์ภาพถ่ายสำเนาบัตรประชาชน )</div>'}
          </div>

          <div class="section-title">ข้อมูลส่วนตัวผู้เช่า</div>
          <table class="info-grid">
            <tr><td class="label">ชื่อ-นามสกุล:</td><td class="value">${selectedTenant.name || (selectedTenant as any).displayName || '-'}</td></tr>
            <tr><td class="label">เลขประจำตัวประชาชน:</td><td class="value">${selectedTenant.citizenId || (selectedTenant as any).nationalIdMasked || (selectedTenant as any).nationalId || '-'}</td></tr>
            <tr><td class="label">เบอร์โทรศัพท์:</td><td class="value">${selectedTenant.phone || '-'}</td></tr>
            <tr><td class="label">อีเมล:</td><td class="value">${selectedTenant.email || '-'}</td></tr>
            <tr><td class="label">ผู้ติดต่อฉุกเฉิน:</td><td class="value">${selectedTenant.emergencyContact?.name ? `${selectedTenant.emergencyContact.name} (${selectedTenant.emergencyContact.relationship || '-'}) เบอร์: ${selectedTenant.emergencyContact.phone || '-'}` : '-'}</td></tr>
          </table>

          <div class="footer-note">เอกสารนี้พิมพ์จากระบบบริหารจัดการหอพัก เมื่อ ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} น.</div>
        </div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 400);
          };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleSaveEditTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!name.trim() || !phone.trim()) {
      setErrorText('กรุณากรอกข้อมูลที่จำเป็น (*) ให้ครบถ้วน');
      return;
    }

    if (!selectedTenant) return;

    // Validate emergency contact: required name & phone
    const trimmedEmergencyName = emergencyName.trim();
    const trimmedEmergencyPhone = emergencyPhone.trim();
    if (!trimmedEmergencyName || !trimmedEmergencyPhone) {
      setErrorText('กรุณากรอกชื่อและเบอร์โทรศัพท์ผู้ติดต่อฉุกเฉินให้ครบถ้วน');
      return;
    }

    // Validate vehicles: license plate required if vehicle type is selected (except bicycle)
    for (const veh of vehiclesList) {
      if (veh.type !== 'none' && veh.type !== 'bicycle' && !veh.licensePlate?.trim()) {
        setErrorText('กรุณาระบุเลขทะเบียนสำหรับยานพาหนะที่เลือก');
        return;
      }
    }

    try {
      const dataProvider = getDataProvider();

      const existingEmergency = tenantDetailsData?.emergencyContacts?.[0] || (selectedTenant as any).emergencyContacts?.[0];
      const eRel = emergencyRelation.trim() || 'ผู้ติดต่อฉุกเฉิน';

      // Reconcile vehicles
      const serverVehicles = (tenantDetailsData?.vehicles || (selectedTenant as any).vehicles || []).filter((v: any) => v.id && v.type !== 'none');
      const serverVehIdSet = new Set(serverVehicles.map((v: any) => v.id));
      const activeFormVehicles = vehiclesList.filter(v => v.type !== 'none' && (v.type === 'bicycle' || v.licensePlate?.trim()));

      const payloadVehicles = activeFormVehicles.map(v => ({
        id: (v.id && serverVehIdSet.has(v.id)) ? v.id : undefined,
        type: (v.type === 'motorcycle' || v.type === 'car' || v.type === 'bicycle' || v.type === 'none' || v.type === 'other') ? v.type : ('other' as const),
        licensePlate: v.type === 'bicycle' ? (v.licensePlate?.trim() || '-') : v.licensePlate.trim(),
        brand: v.brand?.trim() || undefined,
      }));

      // Reconcile pets
      const authoritativeExistingPets: any[] = (
        tenantDetailsData?.tenant?.pets ||
        (Array.isArray(tenantDetailsData?.tenant?.petInfo) ? tenantDetailsData.tenant.petInfo : null) ||
        (selectedTenant as any)?.pets ||
        (Array.isArray((selectedTenant as any)?.petInfo) ? (selectedTenant as any).petInfo : null) ||
        []
      );
      const canonicalPetIds = new Set(
        authoritativeExistingPets
          .map((p: any) => p?.id)
          .filter((id): id is string => Boolean(id) && typeof id === 'string' && !id.startsWith('temp-'))
      );

      const activePets = hasPet
        ? petsList
          .map(p => {
            const isOther = p.type === 'อื่นๆ' || p.type === 'other' || p.type === 'others';
            return {
              id: (p.id && canonicalPetIds.has(p.id)) ? p.id : undefined,
              type: isOther ? 'other' : (p.type?.trim() || ''),
              customType: isOther ? (p.customType?.trim() || undefined) : undefined,
              name: p.name?.trim() || undefined,
            };
          })
          .filter(p => p.type || p.customType || p.name)
        : [];

      // 1. One atomic database mutation
      const aggregatePayload: UpdateTenantProfilePayload = {
        displayName: name.trim(),
        phone: phone.trim(),
        email: email.trim() ? email.trim() : null,
        nationalId: citizenId.trim(),
        version: (selectedTenant as any).version,
        emergencyContact: {
          id: existingEmergency?.id,
          name: trimmedEmergencyName,
          phone: trimmedEmergencyPhone,
          relationship: eRel,
          isPrimary: true,
        },
        vehicles: payloadVehicles,
        pets: activePets,
      };

      const result = await dataProvider.tenants.updateTenantProfile(selectedTenant.id, aggregatePayload);
      if (!result.success || !result.data) {
        setErrorText(result.error?.message || 'ไม่สามารถบันทึกข้อมูลผู้เช่าได้');
        return; // Fail visibly: Preserve modal/input state, do NOT close modal, do NOT mutate local tenant array!
      }

      let authoritativeVersion = (result.data?.tenant?.version ?? result.data?.version ?? selectedTenant.version);

      // 2. Identity Document Replace (Option B: replace/upload only, NO DELETE API)
      if (pendingIdCardFile) {
        const uploadRes = await dataProvider.tenants.uploadIdentityDocument(selectedTenant.id, pendingIdCardFile);
        if (!uploadRes.success) {
          // Refetch authoritative DB data after partial external storage failure
          if (queryClient && effectiveDormId) {
            await queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) });
            await queryClient.invalidateQueries({ queryKey: ['owner', effectiveDormId, 'tenants', selectedTenant.id] });
          }
          const updatedVersion = result.data?.tenant?.version ?? result.data?.version;
          const returnedTenant = result.data?.tenant || result.data;
          if (result.data?.vehicles && result.data.vehicles.length > 0) {
            setVehiclesList(prev => prev.map((v, i) => ({
              ...v,
              id: result.data.vehicles[i]?.id || v.id,
            })));
          }
          setSelectedTenant(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              ...(returnedTenant ? returnedTenant : {}),
              version: updatedVersion !== undefined ? updatedVersion : prev.version,
              emergencyContact: result.data?.emergencyContacts?.[0] || prev.emergencyContact,
              emergencyContacts: result.data?.emergencyContacts || (prev as any).emergencyContacts,
              vehicles: result.data?.vehicles || prev.vehicles,
            };
          });
          setErrorText(uploadRes.error?.message || 'ไม่สามารถอัปโหลดเอกสารสำเนาบัตรประชาชนได้');
          return;
        }

        if (uploadRes.data?.version !== undefined) {
          authoritativeVersion = uploadRes.data.version;
        }
      }

      // 3. Success! Authoritative Refresh:
      const savedTenant = result.data?.tenant || result.data;
      const authoritativeEmergencyContacts = result.data?.emergencyContacts ?? [];
      const authoritativeVehicles = result.data?.vehicles ?? [];

      const normalizedSavedTenant: Tenant = {
        ...selectedTenant,
        ...savedTenant,
        version: authoritativeVersion,
        name: savedTenant.name || savedTenant.displayName || name.trim(),
        phone: savedTenant.phone || phone.trim(),
        email: savedTenant.email ?? '',
        citizenId: savedTenant.nationalIdMasked ?? (savedTenant as any).citizenId ?? '',
        emergencyContacts: authoritativeEmergencyContacts,
        emergencyContact: authoritativeEmergencyContacts[0]
          ? {
            id: authoritativeEmergencyContacts[0].id,
            name: authoritativeEmergencyContacts[0].name || '',
            phone: authoritativeEmergencyContacts[0].phone || '',
            relationship: authoritativeEmergencyContacts[0].relationship || '',
            isPrimary: true,
          }
          : { name: '', phone: '', relationship: '' },
        vehicles: authoritativeVehicles,
        vehicle: authoritativeVehicles[0]
          ? {
            id: authoritativeVehicles[0].id,
            type: authoritativeVehicles[0].type || 'none',
            licensePlate: authoritativeVehicles[0].licensePlate || '',
            brand: authoritativeVehicles[0].brand || '',
          }
          : { type: 'none', licensePlate: '', brand: '' },
        pets: activePets,
        pet: {
          hasPet: activePets.length > 0,
          type: activePets[0]?.type || '',
          name: activePets[0]?.name || '',
        },
        hasIdentityDocument: pendingIdCardFile ? true : Boolean((selectedTenant as any).hasIdentityDocument),
        idCardPhotoMock: pendingIdCardFile
          ? dataProvider.tenants.getIdentityDocumentUrl(selectedTenant.id, effectiveDormId)
          : selectedTenant.idCardPhotoMock,
      };

      // Synchronize UI presentation state with authoritative server response immediately
      setSelectedTenant(normalizedSavedTenant);

      if (tenantDetailsData && tenantDetailsData.tenant?.id === selectedTenant.id) {
        setTenantDetailsData((prev: any) => prev ? {
          ...prev,
          tenant: { ...prev.tenant, ...savedTenant, version: authoritativeVersion },
          emergencyContacts: authoritativeEmergencyContacts,
          vehicles: authoritativeVehicles,
        } : prev);
      }

      if (onSaveTenants) {
        const syncedTenants = tenants.map(t => t.id === selectedTenant.id ? normalizedSavedTenant : t);
        onSaveTenants(syncedTenants);
      }

      setPendingIdCardFile(null);
      setIsEditOpen(false);
      onAddLog('แก้ไขทะเบียนผู้เช่า', `แก้ไขข้อมูลผู้เช่าคุณ ${name.trim()}`, 'Tenant', selectedTenant.id);
      setTenantActionToast('บันทึกการแก้ไขเรียบร้อยแล้ว');

      // Invalidate React Query caches for tenants list and tenant detail independently without blocking or reverting success
      if (queryClient && effectiveDormId) {
        try {
          await queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) });
          await queryClient.invalidateQueries({ queryKey: ['owner', effectiveDormId, 'tenants', selectedTenant.id] });
        } catch (refetchErr) {
          console.warn('Background refetch failed:', refetchErr);
        }
      }
    } catch (err: any) {
      setErrorText(err?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const handleOpenApprove = (tenant: Tenant) => {
    const rawType = String(tenant.rentalType || tenant.rentalPlan || 'MONTHLY').toUpperCase();
    const rType: 'MONTHLY' | 'TERM' | 'DAILY' = rawType === 'DAILY' ? 'DAILY' : rawType === 'TERM' ? 'TERM' : 'MONTHLY';
    setApproveRentalType(rType);

    // Target Room: Default to requested room if available, else current tenant room, else vacant room
    const reqRoom = rooms.find(r => r.id === tenant.requestedRoomId || r.roomNumber === tenant.requestedRoomId);
    const existingRoom = rooms.find(r => r.currentTenantId === tenant.id);
    const vacantRoom = rooms.find(r => r.status === 'vacant');
    const targetRoom = reqRoom || existingRoom || vacantRoom || rooms[0];

    setApproveRoomId(targetRoom ? targetRoom.id : '');

    const startDate = tenant.requestedStartDate || new Date().toISOString().split('T')[0];
    setApproveStartDate(startDate);

    if (rType === 'DAILY') {
      const days = tenant.requestedDays || (tenant.requestedStartDate && tenant.requestedEndDate ? Math.max(1, Math.round((new Date(tenant.requestedEndDate).getTime() - new Date(tenant.requestedStartDate).getTime()) / (24 * 3600 * 1000))) : 5);
      const rate = tenant.requestedDailyRate || targetRoom?.dailyRent || 550;
      const computedRent = tenant.requestedRent || (Number(rate) * days);
      const computedDeposit = tenant.requestedDeposit !== undefined && tenant.requestedDeposit !== null ? tenant.requestedDeposit : 500;
      setApproveDays(days);
      setApproveDailyRate(String(rate));
      setApproveRent(String(computedRent));
      setApproveDeposit(String(computedDeposit));

      if (tenant.requestedEndDate) {
        setApproveEndDate(tenant.requestedEndDate);
      } else {
        const d = new Date(startDate);
        d.setDate(d.getDate() + days);
        setApproveEndDate(d.toISOString().split('T')[0]);
      }
    } else if (rType === 'TERM') {
      const derivedDuration = tenant.requestedDurationMonths || (
        tenant.requestedStartDate && tenant.requestedEndDate
          ? Math.max(1, Math.round((new Date(tenant.requestedEndDate).getTime() - new Date(tenant.requestedStartDate).getTime()) / (30.4375 * 24 * 3600 * 1000)))
          : (targetRoom?.termDurationMonths || (tenant.rentalPlanDetails as any)?.durationMonths || 4)
      );
      setApproveDurationMonths(derivedDuration);
      const rent = tenant.requestedRent || targetRoom?.termRent || 22000;
      const dep = tenant.requestedDeposit !== undefined && tenant.requestedDeposit !== null ? tenant.requestedDeposit : (targetRoom?.termDeposit || 5500);
      setApproveRent(String(rent));
      setApproveDeposit(String(dep));
      if (tenant.requestedEndDate) {
        setApproveEndDate(tenant.requestedEndDate);
      } else {
        setApproveEndDate(calculateContractEndDate(startDate, derivedDuration));
      }
    } else {
      // MONTHLY
      const duration = tenant.requestedDurationMonths || 12;
      setApproveDurationMonths(duration);
      const rent = tenant.requestedRent || targetRoom?.monthlyRent || targetRoom?.price || 5000;
      const dep = tenant.requestedDeposit !== undefined && tenant.requestedDeposit !== null ? tenant.requestedDeposit : (targetRoom?.deposit || targetRoom?.monthlyDeposit || (Number(rent) * 2));
      setApproveRent(String(rent));
      setApproveDeposit(String(dep));
      if (tenant.requestedEndDate) {
        setApproveEndDate(tenant.requestedEndDate);
      } else {
        setApproveEndDate(calculateContractEndDate(startDate, duration));
      }
    }

    // Attachments
    const rawAtts = tenant.requestedAttachments || tenant.acceptanceSnapshot?.attachments || [];
    setApproveAttachments(rawAtts);
    setApproveDepositDeclaredStatus((tenant as any).depositDeclaredStatus || 'UNPAID');
    setApproveIdCardFile(null);
    setApproveIdCardPreview(null);
    setApproveIdCardError(null);
    setOwnerAttachmentFile(null);
    setOwnerAttachmentName('');

    setIsApproveOpen(true);
  };

  const handleConfirmApprove = async () => {
    if (!selectedTenant) return;

    const chosenRoom = rooms.find(r => r.id === approveRoomId);
    const roomNum = chosenRoom ? chosenRoom.roomNumber : '';

    const reqId = (selectedTenant as any).registrationRequestId || (selectedTenant as any).requestId || (selectedTenant.status === 'pending' ? selectedTenant.id : undefined);
    let effectiveTenantId = selectedTenant.id;
    let effectiveContractId: string | undefined;
    if (reqId) {
      try {
        const payload: any = {
          roomId: approveRoomId,
          rentalType: approveRentalType,
          rentalPlan: approveRentalType.toLowerCase(),
          startDate: approveStartDate,
          endDate: approveEndDate || (approveRentalType === 'DAILY'
            ? calculateContractEndDate(approveStartDate, 1)
            : calculateContractEndDate(approveStartDate, approveDurationMonths)),
          rentAmount: Number(approveRent) || 0,
          depositAmount: Number(approveDeposit) || 0,
          depositDeclaredStatus: approveDepositDeclaredStatus,
          advancePaymentAmount: approveRentalType === 'DAILY' ? 0 : (Number(approveRent) || 0),
          requireTenantConfirmation: false,
        };

        if (approveRentalType === 'DAILY') {
          payload.totalDays = Number(approveDays) || 1;
          payload.dailyRate = Number(approveDailyRate) || Number(approveRent);
        } else {
          payload.durationMonths = Number(approveDurationMonths) || (approveRentalType === 'TERM' ? 4 : 12);
        }

        const approveRes = await approveTenantRegistrationRequest(reqId, payload);
        if (approveRes && !approveRes.success) {
          const errMsg = approveRes.error?.message || 'ไม่สามารถอนุมัติคำขอเช่าได้ กรุณาลองใหม่อีกครั้ง';
          setTenantActionToast(errMsg);
          return;
        }
        if (approveRes?.data?.tenantId) {
          effectiveTenantId = approveRes.data.tenantId;
        } else if (approveRes?.data?.tenant?.id) {
          effectiveTenantId = approveRes.data.tenant.id;
        }
        if (approveRes?.data?.contractId) {
          effectiveContractId = approveRes.data.contractId;
        }
      } catch (err: any) {
        console.error('Failed to approve registration request via API:', err);
        const errMsg = err?.message || 'ไม่สามารถอนุมัติคำขอเช่าได้ กรุณาลองใหม่อีกครั้ง';
        setTenantActionToast(errMsg);
        return;
      }
    }

    // Persist optional owner/approved identity document via document upload API
    const docToUpload = approveIdCardFile || ownerAttachmentFile;
    if (docToUpload && effectiveTenantId) {
      try {
        await dataProvider.tenants.uploadIdentityDocument(effectiveTenantId, docToUpload);
      } catch (uploadErr) {
        console.warn('Failed to upload identity document:', uploadErr);
      }
    }

    // 1. Build approved tenant using effectiveTenantId
    const existingHistory = selectedTenant.rentalHistory || [];
    const newHistory = roomNum && !existingHistory.includes(roomNum)
      ? [...existingHistory, roomNum]
      : existingHistory;

    const approvedTenant: Tenant = {
      ...selectedTenant,
      id: effectiveTenantId,
      status: 'active' as const,
      rentalHistory: newHistory,
      roomId: approveRoomId,
      rentalType: approveRentalType,
      rentalPlan: approveRentalType.toLowerCase(),
      requestedRent: Number(approveRent) || selectedTenant.requestedRent,
      requestedDeposit: Number(approveDeposit) || selectedTenant.requestedDeposit,
      requestedStartDate: approveStartDate,
      requestedEndDate: approveEndDate,
      requestedDays: approveRentalType === 'DAILY' ? approveDays : undefined,
      requestedDailyRate: approveRentalType === 'DAILY' ? Number(approveDailyRate) : undefined,
      requestedDurationMonths: approveRentalType !== 'DAILY' ? approveDurationMonths : undefined,
      updatedAt: new Date().toISOString()
    };

    // Remove old pending registration request from tenants and insert/update with approvedTenant
    const filteredTenants = tenants.filter(t => t.id !== selectedTenant.id && t.id !== reqId && t.id !== effectiveTenantId);
    const updatedTenants = [...filteredTenants, approvedTenant];

    // 2. Update room occupied/reserved status and currentTenantId
    const isFuture = Boolean(approveStartDate && new Date(approveStartDate) > new Date(new Date().toISOString().split('T')[0]));
    let updatedRooms = [...rooms];
    if (chosenRoom) {
      updatedRooms = rooms.map(r => {
        if (r.id === chosenRoom.id) {
          return {
            ...r,
            status: isFuture ? (r.status === 'vacant' ? ('reserved' as const) : r.status) : ('occupied' as const),
            currentTenantId: isFuture ? (r.currentTenantId || null) : effectiveTenantId,
            deposit: Number(approveDeposit) || r.deposit,
            price: Number(approveRent) || r.price,
            updatedAt: new Date().toISOString()
          };
        }
        if (!isFuture && (r.currentTenantId === selectedTenant.id || r.currentTenantId === effectiveTenantId) && r.id !== chosenRoom.id) {
          return {
            ...r,
            status: 'vacant' as const,
            currentTenantId: null,
            updatedAt: new Date().toISOString()
          };
        }
        return r;
      });
      onSaveRooms(updatedRooms);
    }

    // 3. For Term or Monthly, create or update contract; for Daily, do not create contract
    if (onSaveContracts && approveRentalType !== 'DAILY') {
      const existingContract = contracts.find(c => c.tenantId === effectiveTenantId || c.tenantId === selectedTenant.id);
      if (existingContract) {
        const updatedContracts = contracts.map(c => c.id === existingContract.id ? {
          ...c,
          id: effectiveContractId || c.id,
          tenantId: effectiveTenantId,
          status: isFuture ? ('approved_scheduled' as any) : ('active' as const),
          roomId: chosenRoom ? chosenRoom.id : c.roomId,
          startDate: approveStartDate || c.startDate,
          endDate: approveEndDate || c.endDate,
          durationMonths: approveDurationMonths || c.durationMonths,
          rentBillingType: approveRentalType === 'TERM' ? 'term' : 'monthly',
          rentAmount: Number(approveRent) || c.rentAmount,
          depositAmount: Number(approveDeposit) || c.depositAmount,
          updatedAt: new Date().toISOString()
        } : c);
        onSaveContracts(updatedContracts);
      } else if (chosenRoom) {
        const newContract: Contract = {
          id: effectiveContractId || `ct-${Date.now()}`,
          contractNumber: `CT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${roomNum}`,
          tenantId: effectiveTenantId,
          roomId: chosenRoom.id,
          startDate: approveStartDate,
          endDate: approveEndDate || calculateContractEndDate(approveStartDate, approveDurationMonths),
          durationMonths: approveDurationMonths,
          rentBillingType: approveRentalType === 'TERM' ? 'term' : 'monthly',
          rentAmount: Number(approveRent) || chosenRoom.price,
          depositAmount: Number(approveDeposit) || chosenRoom.deposit || chosenRoom.price * 2,
          depositStatus: 'paid',
          depositType: 'refundable',
          advancePaymentAmount: Number(approveRent) || chosenRoom.price,
          status: isFuture ? ('approved_scheduled' as any) : ('active' as const),
          terms: approveRentalType === 'TERM' ? 'สัญญาเช่าห้องพักรายเทอม' : 'สัญญาเช่าห้องพักมาตรฐาน',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        onSaveContracts([...contracts, newContract]);
      }
    }

    onSaveTenants(updatedTenants);
    setSelectedTenant(approvedTenant);
    setIsApproveOpen(false);
    setActiveStatusTab('active');
    setTenantActionToast('อนุมัติคำขอเรียบร้อยแล้ว');
    onAddLog('อนุมัติผู้เช่า', `อนุมัติคำขอเช่าคุณ ${selectedTenant.name} เข้าห้องพัก ${roomNum}`, 'Tenant', effectiveTenantId);

    // TanStack Query cache invalidations
    if (queryClient && effectiveDormId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.contracts(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bills(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: ['meter', effectiveDormId] }),
        queryClient.invalidateQueries({ queryKey: ['owner', effectiveDormId, 'tenants', effectiveTenantId] }),
        queryClient.invalidateQueries({ queryKey: ['owner', effectiveDormId, 'tenants', selectedTenant.id] }),
      ]);
    }
  };

  const handleOpenDailyExtend = (tenant: Tenant) => {
    setDailyExtendTenant(tenant);
    const checkOut = tenant.requestedEndDate || new Date().toISOString().split('T')[0];
    setDailyExtendCurrentCheckOut(checkOut);
    const nextOut = new Date(checkOut);
    nextOut.setDate(nextOut.getDate() + 1);
    setDailyExtendNewCheckOut(nextOut.toISOString().split('T')[0]);
    setDailyExtendDays(1);
    const rate = Number(tenant.requestedDailyRate || 550);
    setDailyExtendRate(rate);
    setDailyExtendTotal(rate);
    setIsDailyExtendOpen(true);
  };

  const handleConfirmDailyExtend = () => {
    if (!dailyExtendTenant) return;
    const updatedTenants = tenants.map(t => {
      if (t.id === dailyExtendTenant.id) {
        return {
          ...t,
          requestedEndDate: dailyExtendNewCheckOut,
          requestedDays: (t.requestedDays || 1) + dailyExtendDays,
          requestedRent: (t.requestedRent || 0) + dailyExtendTotal,
          updatedAt: new Date().toISOString(),
        };
      }
      return t;
    });
    onSaveTenants(updatedTenants);
    if (selectedTenant && selectedTenant.id === dailyExtendTenant.id) {
      setSelectedTenant(prev => prev ? {
        ...prev,
        requestedEndDate: dailyExtendNewCheckOut,
        requestedDays: (prev.requestedDays || 1) + dailyExtendDays,
        requestedRent: (prev.requestedRent || 0) + dailyExtendTotal,
      } : prev);
    }
    setIsDailyExtendOpen(false);
    setDailyExtendTenant(null);
    setCopySuccessToast(`ขยายระยะเวลาเข้าพักรายวันเรียบร้อยแล้ว (ถึงวันที่ ${dailyExtendNewCheckOut})`);
  };

  const handleOpenReject = (tenant: Tenant) => {
    setRejectReason('ข้อมูลเอกสารไม่ครบถ้วน');
    setIsRejectOpen(true);
  };

  const handleConfirmReject = async (reasonOverride?: string) => {
    if (!selectedTenant) return;

    const finalReason = reasonOverride || rejectReason || 'ข้อมูลเอกสารไม่ครบถ้วน';
    const reqId = (selectedTenant as any).registrationRequestId || (selectedTenant as any).requestId || selectedTenant.id;
    if (reqId) {
      try {
        await rejectTenantRegistrationRequest(reqId, finalReason);
      } catch (err) {
        console.error('Failed to reject registration request via API:', err);
      }
    }

    // Remove rejected request from tenants list
    const updatedTenants = tenants.filter(t => t.id !== selectedTenant.id && t.id !== reqId);

    // If tenant was linked to a room, detach
    const updatedRooms = rooms.map(r => {
      if (r.currentTenantId === selectedTenant.id || (reqId && r.currentTenantId === reqId)) {
        return {
          ...r,
          status: 'vacant' as const,
          currentTenantId: null,
          updatedAt: new Date().toISOString()
        };
      }
      return r;
    });

    onSaveTenants(updatedTenants);
    onSaveRooms(updatedRooms);

    if (queryClient && effectiveDormId) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tenants(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rooms(effectiveDormId) }),
        queryClient.invalidateQueries({ queryKey: ['meter', effectiveDormId] }),
      ]);
    }

    setIsRejectOpen(false);
    setSelectedTenant(null);
    setTenantActionToast('ส่งคำขอให้ผู้เช่าแก้ไขแล้ว');
    onAddLog('ส่งกลับคำขอเช่าเพื่อแก้ไข', `ส่งกลับคำขอคุณ ${selectedTenant.name} (เหตุผล: ${rejectReason})`, 'Tenant', selectedTenant.id);
  };

  const calculateContractEndDate = (start: string, duration: number) => {
    if (!start) return '';
    const d = new Date(start);
    if (isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + Number(duration));
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  };

  const calculateRenewEndDate = (baseDateStr: string, unit: 'month' | 'day', count: number) => {
    if (!baseDateStr) return '';
    const d = new Date(baseDateStr);
    if (isNaN(d.getTime())) return '';
    if (unit === 'month') {
      d.setMonth(d.getMonth() + Number(count));
    } else {
      d.setDate(d.getDate() + Number(count));
    }
    return d.toISOString().split('T')[0];
  };

  const handleOpenPrintContract = (contract: Contract) => {
    const conTenant = tenants.find(t => t.id === contract.tenantId) || selectedTenant;
    const conRoom = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
    try {
      const win = openTenantContractPrintWindow(
        contract,
        conTenant,
        conRoom,
        {
          ...dorm,
          paymentSettings,
          billingSettings: paymentSettings,
          bankAccountName: paymentSettings?.bankAccountName,
          promptPayAccountName: paymentSettings?.promptPayAccountName,
          ownerSignature: (contract as any).ownerSignature || (dorm as any).ownerSignature,
        },
        { autoPrint: true }
      );
      if (win) return;
    } catch (err) {
      console.error('Error opening print window:', err);
    }

    // Fallback if popup blocked
    setSelectedContractForPrint(contract);
    setIsPrintContractModalOpen(true);
  };

  const handleOpenEditContract = (contract: Contract) => {
    setSelectedContractForEdit(contract);
    setEditContractStartDate(contract.startDate || '');
    setEditContractEndDate(contract.endDate || '');
    setEditContractDuration(contract.durationMonths || 6);
    setEditContractRent(contract.rentAmount || 0);
    setEditContractDeposit(contract.depositAmount || 0);
    setEditContractDepositStatus(contract.depositStatus || 'paid');
    setEditContractDepositType(contract.depositType || 'refundable');
    setEditContractAdvancePayment(contract.advancePaymentAmount || 0);
    setEditContractTerms(contract.terms || '');
    setIsEditContractModalOpen(true);
  };

  const handleSaveEditContract = () => {
    if (!selectedContractForEdit || !onSaveContracts) return;
    const updated = (contracts || []).map(c => c.id === selectedContractForEdit.id ? {
      ...c,
      startDate: editContractStartDate,
      endDate: editContractEndDate,
      durationMonths: editContractDuration,
      rentAmount: editContractRent,
      depositAmount: editContractDeposit,
      depositStatus: editContractDepositStatus,
      depositType: editContractDepositType,
      advancePaymentAmount: editContractAdvancePayment,
      terms: editContractTerms,
      updatedAt: new Date().toISOString()
    } : c);
    onSaveContracts(updated);
    onAddLog('แก้ไขสัญญาเช่า', `แก้ไขรายละเอียดสัญญาเลขที่ ${selectedContractForEdit.contractNumber} สำเร็จ`, 'Contract', selectedContractForEdit.id);
    setIsEditContractModalOpen(false);
    setSelectedContractForEdit(null);
    setContractToast(`แก้ไขสัญญาเช่าเลขที่ ${selectedContractForEdit.contractNumber} เรียบร้อยแล้ว`);
    setTimeout(() => setContractToast(null), 3000);
  };

  const handleOpenRenewContract = (contract: Contract, tenant?: Tenant) => {
    setSelectedContractForRenew(contract);
    const targetTenant = tenant || tenants.find(t => t.id === contract.tenantId) || selectedTenant;
    if (targetTenant) {
      setSelectedTenant(targetTenant);
    }

    const currentEnd = (contract.endDate ? String(contract.endDate).split('T')[0] : '') || (contract.startDate ? String(contract.startDate).split('T')[0] : '') || new Date().toISOString().split('T')[0];
    let nextStartStr = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(currentEnd)) {
      const [y, m, d] = currentEnd.split('-').map(Number);
      const dt = new Date(y, m - 1, d + 1);
      const ny = dt.getFullYear();
      const nm = String(dt.getMonth() + 1).padStart(2, '0');
      const nd = String(dt.getDate()).padStart(2, '0');
      nextStartStr = `${ny}-${nm}-${nd}`;
    } else {
      const nextStart = new Date(currentEnd);
      nextStart.setDate(nextStart.getDate() + 1);
      nextStartStr = nextStart.toISOString().split('T')[0];
    }

    const isTerm = String(contract.rentBillingType).toLowerCase() === 'term' ||
      String((contract as any).rentalType).toLowerCase() === 'term' ||
      String(targetTenant?.rentalType).toLowerCase() === 'term';

    const defaultDuration = contract.durationMonths || (isTerm ? 4 : 12);
    setRenewContractUnit('month');
    setRenewContractMonths(defaultDuration);
    setRenewContractDays(0);
    setRenewContractStartDate(nextStartStr);
    setRenewContractEndDate(calculateContractEndDate(nextStartStr, defaultDuration));
    setRenewContractRentAmount(contract.rentAmount || 0);
    setRenewContractDepositAmount(contract.depositAmount || 0);
    setRenewContractDepositOption('rollover');
    setRenewContractNote(
      isTerm
        ? `อนุมัติคำขอต่ออายุสัญญาเช่ารายเทอม (${defaultDuration} เดือน)`
        : (contract.status === 'waiting_extension'
          ? `อนุมัติคำขอต่ออายุสัญญาเช่า ${defaultDuration} เดือน ตามความประสงค์ของผู้เช่า`
          : 'อนุมัติต่ออายุสัญญาเช่าฉบับใหม่')
    );
    setIsRenewContractModalOpen(true);
  };

  const handleExecuteRenewContract = () => {
    if (!selectedContractForRenew || !onSaveContracts) return;

    const finalStartDate = renewContractStartDate || new Date().toISOString().split('T')[0];
    const finalEndDate = renewContractEndDate || calculateContractEndDate(finalStartDate, renewContractMonths || 6);

    const nextDuration = renewContractUnit === 'month'
      ? (renewContractMonths > 0 ? renewContractMonths : 6)
      : (renewContractDays > 0 ? Math.max(1, Math.round(renewContractDays / 30)) : 1);

    const finalRent = renewContractRentAmount > 0
      ? renewContractRentAmount
      : (selectedContractForRenew.rentAmount || 0);

    const finalDeposit = renewContractDepositOption === 'rollover'
      ? (selectedContractForRenew.depositAmount || 0)
      : (renewContractDepositAmount || 0);

    const targetRoom = rooms.find(r => r.id === selectedContractForRenew.roomId);
    const targetTenant = tenants.find(t => t.id === selectedContractForRenew.tenantId) || selectedTenant;
    const roomNum = targetRoom ? targetRoom.roomNumber : '';

    // Create new renewed contract
    const newContractId = `ct-renew-${Date.now()}`;
    const newContract: Contract = {
      id: newContractId,
      contractNumber: `CNT-2026-${1000 + (contracts?.length || 0) + 1}`,
      tenantId: selectedContractForRenew.tenantId,
      roomId: selectedContractForRenew.roomId,
      startDate: finalStartDate,
      endDate: finalEndDate,
      durationMonths: nextDuration,
      rentBillingType: selectedContractForRenew.rentBillingType || 'monthly',
      rentAmount: finalRent,
      depositAmount: finalDeposit,
      depositStatus: selectedContractForRenew.depositStatus || 'paid',
      depositType: selectedContractForRenew.depositType || 'refundable',
      advancePaymentAmount: 0,
      terms: `${selectedContractForRenew.terms || ''}\n[อนุมัติต่ออายุสัญญา: ${renewContractNote || 'อนุมัติการต่อสัญญา'}]`,
      tenantSignature: selectedContractForRenew.tenantSignature,
      ownerSignature: selectedContractForRenew.ownerSignature || dorm.ownerSignature,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Mark previous contract as expired
    const updatedContracts = (contracts || []).map(c => c.id === selectedContractForRenew.id ? {
      ...c,
      status: 'expired' as const,
      updatedAt: new Date().toISOString()
    } : c);

    onSaveContracts([...updatedContracts, newContract]);

    // Ensure tenant is active and room is occupied
    if (targetTenant && targetTenant.status !== 'active') {
      const updatedTenants = tenants.map(t => t.id === targetTenant.id ? { ...t, status: 'active' as const } : t);
      onSaveTenants(updatedTenants);
    }

    onAddLog('อนุมัติคำขอต่อสัญญา', `อนุมัติคำขอต่ออายุสัญญาห้อง ${roomNum} (${targetTenant?.name || ''}) เลขที่ ${newContract.contractNumber} สิ้นสุด ${finalEndDate}`, 'Contract', newContractId);
    setIsRenewContractModalOpen(false);
    setSelectedContractForRenew(null);
    setCopySuccessToast(`อนุมัติคำขอต่ออายุสัญญาเช่าห้อง ${roomNum} สำเร็จ (เลขที่ ${newContract.contractNumber})`);
    setTimeout(() => setCopySuccessToast(null), 3500);
  };

  const handleOpenCreateContract = (tenant: Tenant) => {
    const tenantRoom = rooms.find(r => r.currentTenantId === tenant.id || (tenant.rentalHistory && tenant.rentalHistory.includes(r.id)));
    const targetRoom = tenantRoom || rooms.find(r => r.status === 'vacant') || rooms[0];
    const initialStart = new Date().toISOString().split('T')[0];
    const initialDuration = 6;
    const calculatedEnd = calculateContractEndDate(initialStart, initialDuration);

    setCreateContractRoomId(targetRoom ? targetRoom.id : '');
    setCreateContractStartDate(initialStart);
    setCreateContractStayDate(initialStart);
    setCreateContractDuration(initialDuration);
    setCreateContractEndDate(calculatedEnd);
    setCreateContractRent(targetRoom ? targetRoom.monthlyRent : 4000);
    setCreateContractDeposit(targetRoom ? (targetRoom.monthlyRent * 2) : 8000);
    setCreateContractDepositStatus('paid');
    setCreateContractDepositType('refundable');
    setCreateContractAdvancePayment(0);
    setIsCreateContractModalOpen(true);
  };

  const handleSaveNewContract = () => {
    if (!selectedTenant || !onSaveContracts) return;
    const targetRoom = rooms.find(r => r.id === createContractRoomId);
    if (!targetRoom) return;

    const newContractId = `ct-${Date.now()}`;
    const newContract: Contract = {
      id: newContractId,
      contractNumber: `CNT-2026-${1000 + (contracts?.length || 0) + 1}`,
      tenantId: selectedTenant.id,
      roomId: targetRoom.id,
      startDate: createContractStartDate,
      endDate: createContractEndDate || calculateContractEndDate(createContractStartDate, createContractDuration),
      durationMonths: createContractDuration,
      rentAmount: createContractRent,
      depositAmount: createContractDeposit,
      depositStatus: createContractDepositStatus,
      depositType: createContractDepositType,
      advancePaymentAmount: createContractAdvancePayment,
      terms: createContractTerms,
      tenantSignature: createContractTenantSig,
      ownerSignature: dorm.ownerSignature || undefined,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Update room with tenant
    const updatedRooms = rooms.map(r => r.id === targetRoom.id ? {
      ...r,
      status: 'occupied' as const,
      currentTenantId: selectedTenant.id,
      updatedAt: new Date().toISOString()
    } : r);
    onSaveRooms(updatedRooms);

    // Update tenant with room
    const updatedTenants = tenants.map(t => t.id === selectedTenant.id ? {
      ...t,
      status: 'active' as const,
      roomId: targetRoom.id,
      roomNumber: targetRoom.roomNumber,
      updatedAt: new Date().toISOString()
    } : t);
    onSaveTenants(updatedTenants);

    onSaveContracts([...(contracts || []), newContract]);
    onAddLog('จัดทำสัญญาเช่าใหม่', `สร้างสัญญาเช่า ${newContract.contractNumber} สำหรับคุณ ${selectedTenant.name} (ห้อง ${targetRoom.roomNumber})`, 'Contract', newContractId);

    setIsCreateContractModalOpen(false);
    setContractToast(`จัดทำสัญญาเช่าใหม่ ${newContract.contractNumber} เรียบร้อยแล้ว`);
    setTimeout(() => setContractToast(null), 3000);
  };

  const formatPhoneInput = (val: string) => {
    const clean = val.replace(/\D/g, '');
    if (!clean) return '';
    const parts = [];
    if (clean.startsWith('02')) {
      if (clean.length > 0) parts.push(clean.slice(0, 2));
      if (clean.length > 2) parts.push(clean.slice(2, 5));
      if (clean.length > 5) parts.push(clean.slice(5, 9));
    } else {
      if (clean.length > 0) parts.push(clean.slice(0, 3));
      if (clean.length > 3) parts.push(clean.slice(3, 6));
      if (clean.length > 6) parts.push(clean.slice(6, 10));
    }
    return parts.join('-');
  };

  const formatCitizenIdInput = (val: string) => {
    if (!val) return '';
    if (/[xX]/.test(val)) return val;
    const clean = val.replace(/\D/g, '');
    if (!clean) return '';
    const parts = [];
    if (clean.length > 0) parts.push(clean.slice(0, 1));
    if (clean.length > 1) parts.push(clean.slice(1, 5));
    if (clean.length > 5) parts.push(clean.slice(5, 10));
    if (clean.length > 10) parts.push(clean.slice(10, 12));
    if (clean.length > 12) parts.push(clean.slice(12, 13));
    return parts.join('-');
  };

  const formatPhone = (val: string) => {
    if (!val) return '';
    return formatPhoneInput(val);
  };

  const formatCitizenId = (val: string) => {
    if (!val) return '';
    return formatCitizenIdInput(val);
  };

  const getLatestCycle = () => {
    if (!bills || bills.length === 0) return '2026-07';
    const cycles = bills.map(b => b.cycleId);
    return cycles.reduce((max, c) => c > max ? c : max, '2026-01');
  };

  const getRecent2Cycles = () => {
    if (!bills || bills.length === 0) return ['2026-07', '2026-06'];
    // Filter cycles where at least 1 room has a bill created (status is not 'unbilled' / 'draft')
    const activeCyclesWithBills = Array.from(
      new Set(
        bills
          .filter(b => (b.status as string) !== 'unbilled')
          .map(b => b.cycleId)
      )
    ).sort().reverse();

    if (activeCyclesWithBills.length === 0) {
      return Array.from(new Set(bills.map(b => b.cycleId))).sort().reverse().slice(0, 2);
    }

    return activeCyclesWithBills.slice(0, 2);
  };

  const isLatestCycle = !selectedCycle || selectedCycle === getLatestCycle();
  const isRecent2Cycles = !selectedCycle || getRecent2Cycles().includes(selectedCycle);

  const isTenantInCycle = (tenant: Tenant) => {
    if (!selectedCycle) return true;

    // 1. Check if there is a bill in this cycle for this tenant
    const hasBill = bills?.some(b => b.tenantId === tenant.id && b.cycleId === selectedCycle);
    if (hasBill) return true;

    // 2. Check if there is a contract active during this cycle, or scheduled/future contract
    const tenantContracts = contracts?.filter(c => c.tenantId === tenant.id && !c.deletedAt);
    const hasContract = tenantContracts?.some(c => {
      const [cy, cm] = selectedCycle.split('-').map(Number);
      const [sy, sm] = (c.startDate || '').slice(0, 10).split('-').map(Number);
      const [ey, em] = (c.endDate || '').slice(0, 10).split('-').map(Number);

      const cycleVal = cy * 12 + (cm - 1);
      const startVal = sy * 12 + (sm - 1);
      const endVal = ey * 12 + (em - 1);

      // Active during cycle
      if (cycleVal >= startVal && cycleVal <= endVal) return true;

      // Scheduled/future contracts (e.g. approved applicant moving in upcoming cycle)
      if (c.status === 'approved_scheduled' || startVal >= cycleVal) {
        return true;
      }

      return false;
    });
    if (hasContract) return true;

    // 3. Check requested / provisional / stay dates (e.g. Daily stay or Term provisional term)
    const startDate = tenant.requestedStartDate || (tenant as any).startDate;
    const endDate = tenant.requestedEndDate || (tenant as any).endDate;
    if (startDate && endDate) {
      const [cy, cm] = selectedCycle.split('-').map(Number);
      const [sy, sm] = String(startDate).slice(0, 10).split('-').map(Number);
      const [ey, em] = String(endDate).slice(0, 10).split('-').map(Number);
      if (!isNaN(cy) && !isNaN(cm) && !isNaN(sy) && !isNaN(sm) && !isNaN(ey) && !isNaN(em)) {
        const cycleVal = cy * 12 + (cm - 1);
        const startVal = sy * 12 + (sm - 1);
        const endVal = ey * 12 + (em - 1);
        if (cycleVal >= startVal && cycleVal <= endVal) {
          return true;
        }
        if (startVal >= cycleVal) {
          return true;
        }
      }
    }

    // 4. Fallback: If they are active now, and this is the latest cycle, they are in!
    const isCurrentResident = rooms?.some(r => r.currentTenantId === tenant.id);
    if (isCurrentResident && tenant.status === 'active' && isLatestCycle) {
      return true;
    }

    // 5. Check active Term or Daily tenants in recent or upcoming cycles
    const isDailyOrTerm = ((tenant as any).rentalType === 'DAILY' || (tenant as any).rentalPlan === 'daily' || (tenant as any).rentalType === 'TERM' || (tenant as any).rentalPlan === 'term');
    if (isDailyOrTerm && getTenantCategory(tenant) === 'active') {
      return true;
    }

    // 6. Active tenants in current or upcoming operational cycles
    if (getTenantCategory(tenant) === 'active' && tenant.status === 'active') {
      return true;
    }

    return false;
  };

  // Helper to categorize each tenant into: pending, active, inactive
  const getTenantCategory = (t: Tenant): 'pending' | 'active' | 'inactive' | null => {
    const statusLower = typeof t.status === 'string' ? t.status.toLowerCase() : '';
    if (statusLower === 'rejected' || statusLower === 'cancelled') {
      return null;
    }

    if (
      t.status === 'inactive' ||
      (t.status as any) === 'former' ||
      (t.status as any) === 'terminated' ||
      (t.status as any) === 'checked_out' ||
      (t.status as any) === 'ended' ||
      (t.status as any) === 'completed'
    ) return 'inactive';

    // Pending applicants must always appear in pending tab for owner approval
    if (
      t.status === 'pending' ||
      (t.status as any) === 'pending_owner_approval' ||
      (t.status as any) === 'revision_requested' ||
      (t as any).lifecycleStage === 'WAITING_OWNER_APPROVAL'
    ) {
      return 'pending';
    }

    // Daily tenant stay check: if stay has ended or checked out, it is inactive regardless of billing cycle
    const isDaily = t.rentalType === 'DAILY' || (t as any).rentalPlan === 'daily';
    if (isDaily) {
      const stayEnd = t.requestedEndDate || (t as any).endDate;
      if (stayEnd) {
        const todayStr = new Date().toISOString().slice(0, 10);
        const endStr = String(stayEnd).slice(0, 10);
        const isCurrentOccupant = rooms?.some(r => r.currentTenantId === t.id && r.status === 'occupied');
        if (endStr < todayStr && !isCurrentOccupant) {
          return 'inactive';
        }
      }
    }

    // Quick Add tenants start with OWNER_CREATED or WAITING_LINE_BIND and must be in active
    if (t.lifecycleStage === 'OWNER_CREATED' || t.lifecycleStage === 'WAITING_LINE_BIND') {
      return 'active';
    }

    if (t.status === 'active') {
      return 'active';
    }

    return 'active';
  };

  const pendingTenants = tenants.filter(t => getTenantCategory(t) === 'pending');
  const activeTenants = tenants.filter(t => getTenantCategory(t) === 'active');
  const inactiveTenants = tenants.filter(t => getTenantCategory(t) === 'inactive');

  // Expired / Expiring contracts needing owner review / decision (เลิกเช่า หรือ อนุมัติคำขอ)
  const expiredContractEntries = React.useMemo(() => {
    if (!contracts || contracts.length === 0) return [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const entries: {
      contract: Contract;
      tenant: Tenant;
      room?: Room;
      statusType: 'expired' | 'waiting_extension' | 'expiring_soon' | 'checking_out';
      statusLabel: string;
      daysRemaining?: number;
      reason?: string;
    }[] = [];

    contracts.forEach(contract => {
      const tenant = tenants.find(t => t.id === contract.tenantId);
      if (!tenant) return;

      const isCurrentlyInRoom = rooms.some(r => r.currentTenantId === tenant.id);
      // Skip if already inactive and not currently in any room
      if (contract.status === 'terminated' || (tenant.status === 'inactive' && !isCurrentlyInRoom)) {
        return;
      }

      const room = rooms.find(r => r.id === contract.roomId || r.currentTenantId === tenant.id);

      let statusType: 'expired' | 'waiting_extension' | 'expiring_soon' | 'checking_out' | null = null;
      let statusLabel = '';
      let daysRemaining = 0;

      if (contract.endDate) {
        const endDate = new Date(contract.endDate);
        const endDay = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const diffTime = endDay.getTime() - curDay.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        daysRemaining = diffDays;
      }

      if (contract.status === 'expired') {
        statusType = 'expired';
        statusLabel = 'หมดอายุ';
      } else if (contract.status === 'waiting_extension') {
        statusType = 'waiting_extension';
        statusLabel = 'ยื่นคำขอต่อสัญญา';
      } else if (contract.status === 'checking_out') {
        statusType = 'checking_out';
        statusLabel = 'แจ้งความประสงค์เลิกเช่า';
      } else if (contract.status === 'expiring_soon') {
        statusType = 'expiring_soon';
        statusLabel = daysRemaining > 0 ? `เหลือ ${daysRemaining} วัน` : 'หมดอายุ';
      } else if (contract.status === 'active' && contract.endDate) {
        if (contract.endDate < todayStr || daysRemaining <= 0) {
          statusType = 'expired';
          statusLabel = 'หมดอายุ';
        } else if (daysRemaining <= 30) {
          statusType = 'expiring_soon';
          statusLabel = `เหลือ ${daysRemaining} วัน`;
        }
      }

      if (statusType) {
        entries.push({
          contract,
          tenant,
          room,
          statusType,
          statusLabel,
          daysRemaining,
          reason: contract.status === 'waiting_extension'
            ? 'ผู้เช่ายื่นคำขอต่อสัญญาเช่า 6 เดือน'
            : contract.status === 'checking_out'
              ? 'ผู้เช่าแจ้งความประสงค์จะย้ายออก'
              : (statusType === 'expired' || daysRemaining <= 0)
                ? 'สัญญาครบกำหนดระยะเวลาการเช่าแล้ว'
                : `สัญญาเช่าจะหมดอายุในอีก ${daysRemaining} วัน`
        });
      }
    });

    return entries;
  }, [contracts, tenants, rooms]);

  const pendingTotalCount = pendingTenants.length + expiredContractEntries.length;

  const getRoomNumber = (tenantId: string) => {
    // 1. Check if there is a bill in the selectedCycle for this tenant
    if (selectedCycle && bills) {
      const cycleBill = bills.find(b => b.tenantId === tenantId && b.cycleId === selectedCycle);
      if (cycleBill) {
        const r = rooms.find(room => room.id === cycleBill.roomId);
        if (r) return r.roomNumber;
      }
    }
    // 2. Check if there is a contract active in the selectedCycle for this tenant
    if (selectedCycle && contracts) {
      const cycleContracts = contracts.filter(c => c.tenantId === tenantId);
      const activeContract = cycleContracts.find(c => {
        const [cy, cm] = selectedCycle.split('-').map(Number);
        const [sy, sm] = c.startDate.split('-').map(Number);
        const [ey, em] = c.endDate.split('-').map(Number);

        const cycleVal = cy * 12 + (cm - 1);
        const startVal = sy * 12 + (sm - 1);
        const endVal = ey * 12 + (em - 1);

        return cycleVal >= startVal && cycleVal <= endVal;
      });
      if (activeContract) {
        const r = rooms.find(room => room.id === activeContract.roomId);
        if (r) return r.roomNumber;
      }
    }
    // 3. Fallback to current room
    const currentRoom = rooms.find(r => r.currentTenantId === tenantId);
    if (currentRoom) return currentRoom.roomNumber;

    // 3.5 Fallback to any contract for this tenant (e.g. future scheduled contract)
    if (contracts) {
      const anyContract = contracts.find(c => c.tenantId === tenantId && !c.deletedAt);
      if (anyContract) {
        const r = rooms.find(room => room.id === anyContract.roomId);
        if (r) return r.roomNumber;
      }
    }

    // 4. Fallback to rentalHistory or applied room (e.g. for pending applicants)
    const t = tenants.find(item => item.id === tenantId);
    if (t) {
      const appliedRoomId = (t as any).requestedRoomId || (t as any).roomId || (t.rentalHistory && t.rentalHistory.length > 0 ? t.rentalHistory[0] : null);
      if (appliedRoomId) {
        const r = rooms.find(room => room.id === appliedRoomId || room.roomNumber === appliedRoomId);
        if (r) return r.roomNumber;
      }
    }

    return 'ไม่ระบุห้อง';
  };

  const filteredExpiredContracts = React.useMemo(() => {
    const q = (searchQuery || '').toLowerCase().trim();
    return expiredContractEntries.filter(entry => {
      if (!q) return true;
      const tName = (entry.tenant.name || '').toLowerCase();
      const tPhone = entry.tenant.phone || '';
      const rNum = (entry.room?.roomNumber || getRoomNumber(entry.tenant.id)).toLowerCase();
      const cNum = (entry.contract.contractNumber || '').toLowerCase();
      return tName.includes(q) || tPhone.includes(q) || rNum.includes(q) || cNum.includes(q);
    });
  }, [expiredContractEntries, searchQuery, getRoomNumber]);

  // Filter tenants by active tab, search query and billing cycle
  const filteredTenants = tenants.filter(t => {
    if (getTenantCategory(t) !== activeStatusTab) return false;

    const q = (searchQuery || '').toLowerCase().trim();
    if (!q && activeStatusTab === 'active' && !isTenantInCycle(t)) return false;

    const name = (t?.name || '').toLowerCase();
    const phone = t?.phone || '';
    const email = (t?.email || '').toLowerCase();
    const roomNum = getRoomNumber(t.id).toLowerCase();

    return (
      name.includes(q) ||
      phone.includes(searchQuery || '') ||
      email.includes(q) ||
      roomNum.includes(q)
    );
  }).sort((a, b) => {
    if (activeStatusTab === 'active') {
      const roomObjA = rooms.find(r => r.currentTenantId === a.id || r.id === (a as any).roomId);
      const roomObjB = rooms.find(r => r.currentTenantId === b.id || r.id === (b as any).roomId);
      const buildingOrderMap = new Map<string, number>();
      propBuildings.forEach((bld, idx) => {
        if (bld?.id) buildingOrderMap.set(bld.id, idx);
      });
      const bldIdxA = roomObjA?.buildingId && buildingOrderMap.has(roomObjA.buildingId) ? buildingOrderMap.get(roomObjA.buildingId)! : 999999;
      const bldIdxB = roomObjB?.buildingId && buildingOrderMap.has(roomObjB.buildingId) ? buildingOrderMap.get(roomObjB.buildingId)! : 999999;
      if (bldIdxA !== bldIdxB) return bldIdxA - bldIdxB;
      const roomA = getRoomNumber(a.id) || a.roomNumber || '';
      const roomB = getRoomNumber(b.id) || b.roomNumber || '';
      return roomA.localeCompare(roomB, undefined, { numeric: true, sensitivity: 'base' });
    }
    return 0;
  });

  return (
    <div className="space-y-6">
      {queryClient && (
        <AuthoritativeTenantDetailsFetcher
          dormitoryId={effectiveDormId}
          tenantId={selectedTenant?.id || null}
          onDataLoaded={setTenantDetailsData}
        />
      )}

      {/* Filter Tabs & Quick Action Row (Matching Payment UI Box) */}
      <div className="bg-white p-4 rounded-3xl border border-slate-100 shadow-xs space-y-4 shrink-0">
        <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2 bg-slate-50/80 p-1.5 rounded-2xl border border-slate-100 w-full sm:w-auto flex-1 max-w-xl">
            <button
              type="button"
              onClick={() => { setActiveStatusTab('pending'); setSelectedTenant(null); setSelectedContractForReview(null); setProfileTab('contract'); setOriginTab(null); setCameFromMeters(false); if (onDismissReturnContext) onDismissReturnContext(); }}
              className={`col-span-2 sm:col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'pending'
                ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <Clock className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
              <span className="whitespace-nowrap">รอตรวจสอบ ({pendingTotalCount})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveStatusTab('active'); setSelectedTenant(null); setSelectedContractForReview(null); setOriginTab(null); setCameFromMeters(false); if (onDismissReturnContext) onDismissReturnContext(); }}
              className={`col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'active'
                ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="whitespace-nowrap">พักอาศัย ({activeTenants.length})</span>
            </button>
            <button
              type="button"
              onClick={() => { setActiveStatusTab('inactive'); setSelectedTenant(null); setSelectedContractForReview(null); setOriginTab(null); setCameFromMeters(false); if (onDismissReturnContext) onDismissReturnContext(); }}
              className={`col-span-1 px-2.5 sm:px-3 py-2 sm:py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 w-full text-center ${activeStatusTab === 'inactive'
                ? 'bg-white text-indigo-600 shadow-2xs font-extrabold'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <XCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span className="whitespace-nowrap">เลิกเช่าแล้ว ({inactiveTenants.length})</span>
            </button>
          </div>

          <button
            onClick={handleOpenAddWizard}
            className="px-4 sm:px-5 py-2.5 sm:py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer shrink-0 whitespace-nowrap"
            title="จดทะเบียนผู้เช่าและย้ายเข้า"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span className="whitespace-nowrap">เพิ่มผู้เช่าใหม่</span>
          </button>
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

      {/* Main Grid: Left List & Right Detail Profile */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">

        {/* Left column: List of tenants */}
        <div className={`md:col-span-5 lg:col-span-4 bg-white p-4 sm:p-5 rounded-3xl border border-gray-100 shadow-xs flex flex-col h-[700px] ${selectedTenant ? 'hidden md:flex' : 'flex'
          }`}>
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center gap-2">
              {activeStatusTab === 'pending' && <Clock className="w-4 h-4 text-amber-500" />}
              {activeStatusTab === 'active' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              {activeStatusTab === 'inactive' && <XCircle className="w-4 h-4 text-rose-500" />}
              <h3 className="text-base font-extrabold text-slate-900">
                {activeStatusTab === 'pending' && 'รายการรอตรวจสอบ'}
                {activeStatusTab === 'active' && 'ผู้เช่าที่พักอาศัยอยู่'}
                {activeStatusTab === 'inactive' && 'ผู้เช่าที่เลิกเช่าแล้ว'}
                {' '}({activeStatusTab === 'pending' ? (filteredExpiredContracts.length + filteredTenants.length) : filteredTenants.length})
              </h3>
            </div>
            <span className="text-[11px] font-bold text-slate-400">
              {activeStatusTab === 'active' ? 'กำลังเช่า' : activeStatusTab === 'pending' ? 'รอการตัดสินใจ' : 'ย้ายออกแล้ว'}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100 pr-1">
            {/* 1. In 'pending' tab: Render Pending Applicants ("รอตรวจสอบ") first */}
            {activeStatusTab === 'pending' && pendingSubTab !== 'expired' && filteredTenants.map((tenant) => {
              const roomNum = getRoomNumber(tenant.id);
              const isSelected = selectedTenant?.id === tenant.id && !selectedContractForReview;

              return (
                <div
                  key={tenant.id}
                  onClick={() => {
                    setSelectedTenant(tenant);
                    setSelectedContractForReview(null);
                    setProfileTab(isDailyTenant(tenant, contracts) ? 'info' : 'contract');
                    setOriginTab(null);
                    setCameFromMeters(false);
                    if (onDismissReturnContext) onDismissReturnContext();
                  }}
                  className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 border ${isSelected ? 'bg-amber-50/70 border-amber-200 shadow-2xs' : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-3xs'
                    }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex gap-2.5 items-center min-w-0">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs bg-amber-100 text-amber-700">
                        {tenant.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{tenant.name}</h4>
                          {roomNum && roomNum !== 'ไม่ระบุห้อง' && (
                            <span className="bg-amber-100/90 text-amber-800 font-extrabold text-[10px] px-1.5 py-0.5 rounded-md leading-none border border-amber-200">
                              ห้อง {roomNum}
                            </span>
                          )}
                          {(() => {
                            const badge = getRentalTypeBadge(tenant, contracts);
                            if (!badge) return null;
                            return (
                              <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md border leading-none ${badge.className}`}>
                                {badge.label}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(tenant.phone)}</p>
                        {formatPendingDuration(tenant) && (
                          <p className="text-[10px] text-slate-500 font-medium mt-1 leading-tight line-clamp-1">{formatPendingDuration(tenant)}</p>
                        )}
                      </div>
                    </div>

                    <span className={`border font-extrabold text-[10px] px-2 py-0.5 rounded-lg shrink-0 flex items-center gap-1 ${(tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : (tenant as any).status === 'revision_requested'
                        ? 'bg-rose-50 border-rose-200 text-rose-700'
                        : 'bg-amber-50 border-amber-200 text-amber-700'
                      }`}>
                      {(tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Clock className={`w-3 h-3 ${(tenant as any).status === 'revision_requested' ? 'text-rose-600' : 'text-amber-600'}`} />
                      )}
                      <span>
                        {(tenant as any).status === 'awaiting_tenant_confirmation' || (tenant as any).registrationRequestStatus === 'awaiting_tenant_confirmation'
                          ? 'กรุณาตรวจสอบและยืนยัน'
                          : (tenant as any).status === 'revision_requested'
                            ? 'กรุณาตรวจสอบอีกครั้ง'
                            : 'รออนุมัติคำขอผู้เช่า'}
                      </span>
                    </span>
                  </div>
                </div>
              );
            })}

            {/* 2. In 'pending' tab: Render Expired Contracts ("หมดอายุ") second */}
            {activeStatusTab === 'pending' && pendingSubTab !== 'new_tenant' && (
              <>
                {filteredExpiredContracts.map((entry) => {
                  const roomNum = entry.room?.roomNumber || getRoomNumber(entry.tenant.id);
                  const isSelected = selectedTenant?.id === entry.tenant.id && selectedContractForReview?.id === entry.contract.id;

                  return (
                    <div
                      key={`expired-ct-${entry.contract.id}`}
                      onClick={() => {
                        setSelectedTenant(entry.tenant);
                        setSelectedContractForReview(entry.contract);
                        setProfileTab('contract');
                        setOriginTab(null);
                        setCameFromMeters(false);
                      }}
                      className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-2 border ${isSelected
                        ? (entry.statusType === 'expiring_soon' || entry.statusType === 'waiting_extension'
                          ? 'bg-amber-50/70 border-amber-200 shadow-2xs'
                          : 'bg-rose-50/70 border-rose-200 shadow-2xs')
                        : 'bg-white hover:bg-slate-50/90 border-slate-200/80 shadow-3xs'
                        }`}
                    >
                      {/* Top Row: Tenant & Room */}
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex gap-2.5 items-center min-w-0">
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-xs ${entry.statusType === 'waiting_extension' || entry.statusType === 'expiring_soon'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-rose-100 text-rose-700'
                            }`}>
                            {entry.tenant.name.charAt(0)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{entry.tenant.name}</h4>
                              <span className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-1.5 py-0.5 rounded-md leading-none">
                                ห้อง {roomNum}
                              </span>
                            </div>
                            <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(entry.tenant.phone)}</p>
                          </div>
                        </div>

                        {/* Status Badge & Expiration date underneath */}
                        <div className="flex flex-col items-end shrink-0 gap-1">
                          <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg shrink-0 flex items-center gap-1 border ${entry.statusType === 'waiting_extension' || entry.statusType === 'expiring_soon'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                            <AlertCircle className="w-3 h-3 shrink-0" />
                            <span>{entry.statusLabel}</span>
                          </span>
                          <span className={`text-[10px] font-bold whitespace-nowrap ${entry.statusType === 'expiring_soon' ? 'text-amber-700' : 'text-rose-600'
                            }`}>
                            หมดสัญญา: {formatThaiDate(entry.contract.endDate)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* 3. In other tabs ('active' or 'inactive'): Render regular tenants */}
            {activeStatusTab !== 'pending' && filteredTenants.map((tenant) => {
              const category = getTenantCategory(tenant);
              const roomNum = getRoomNumber(tenant.id);
              const isSelected = selectedTenant?.id === tenant.id && !selectedContractForReview;

              return (
                <div
                  key={tenant.id}
                  onClick={() => {
                    setSelectedTenant(tenant);
                    setSelectedContractForReview(null);
                    setProfileTab('info');
                    setOriginTab(null);
                    setCameFromMeters(false);
                    if (onDismissReturnContext) onDismissReturnContext();
                  }}
                  className={`p-3.5 rounded-2xl cursor-pointer transition-all mb-1.5 ${isSelected ? 'bg-indigo-50/70 border border-indigo-150/40 shadow-2xs' : 'hover:bg-slate-50 border border-transparent'
                    }`}
                >
                  <div className="flex justify-between items-center gap-2">
                    <div className="flex gap-3 items-center min-w-0">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 font-bold text-sm ${category === 'inactive' ? 'bg-slate-100 text-slate-500' :
                        'bg-indigo-50 text-indigo-700'
                        }`}>
                        {tenant.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="font-bold text-slate-800 text-xs truncate leading-none">{tenant.name}</h4>
                          {category === 'active' && !isTenantLineBound(tenant) && (
                            <span
                              data-testid="badge-unbound-line"
                              className="bg-amber-50 border border-amber-200 text-amber-700 font-extrabold text-[9px] px-1.5 py-0.5 rounded-md shrink-0 flex items-center gap-1"
                            >
                              <LineIcon className="w-2.5 h-2.5 shrink-0 opacity-60 grayscale" />
                              <span>ยังไม่ผูก LINE</span>
                            </span>
                          )}
                          {category === 'active' && (() => {
                            const badge = getRentalTypeBadge(tenant, contracts);
                            if (!badge) return null;
                            return (
                              <span
                                data-testid="badge-rental-type"
                                className={`border font-bold text-[9px] px-1.5 py-0.5 rounded-md shrink-0 ${badge.className}`}
                              >
                                {badge.label}
                              </span>
                            );
                          })()}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 leading-none">{formatPhone(tenant.phone)}</p>
                      </div>
                    </div>

                    {category === 'inactive' ? (
                      <span className="bg-slate-100 border border-slate-200 text-slate-600 font-extrabold text-[10px] px-2 py-1 rounded-lg shrink-0 flex items-center gap-1">
                        <XCircle className="w-3 h-3 text-rose-500" />
                        <span>เลิกเช่าแล้ว</span>
                      </span>
                    ) : (
                      <span
                        data-testid="badge-room-number"
                        className="bg-indigo-50 border border-indigo-100 text-indigo-700 font-extrabold text-[10px] px-2 py-1 rounded-lg shrink-0"
                      >
                        ห้อง {roomNum}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {activeStatusTab === 'pending' ? (
              filteredExpiredContracts.length === 0 && filteredTenants.length === 0 && (
                <div className="text-center py-16 text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                  <Clock className="w-8 h-8 text-gray-300" />
                  <span>ไม่มีรายการที่ต้องตรวจสอบในขณะนี้</span>
                </div>
              )
            ) : (
              filteredTenants.length === 0 && (
                <div className="text-center py-16 text-xs text-gray-400 flex flex-col items-center justify-center gap-2">
                  <Users className="w-8 h-8 text-gray-300" />
                  <span>ไม่พบข้อมูลผู้เช่าในหมวดหมู่นี้</span>
                </div>
              )
            )}
          </div>
        </div>

        {/* Right Column: Tenant detailed profile tab panel */}
        <div className={`md:col-span-7 lg:col-span-8 min-w-0 w-full ${selectedTenant ? 'block' : 'hidden md:block'}`}>
          {selectedTenant ? (
            <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-xs h-[700px] flex flex-col justify-between w-full min-w-0 overflow-hidden">
              <div>
                {/* Context-Aware Back Button */}
                {(returnContext?.source === 'dashboard' || returnContext?.source === 'home') ? (
                  <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-gray-100">
                    <button
                      type="button"
                      data-testid="back-to-dashboard-btn"
                      onClick={() => {
                        if (returnContext && onReturnToSource) {
                          onReturnToSource(returnContext);
                        } else {
                          setSelectedTenant(null);
                        }
                      }}
                      className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/90 px-3.5 py-1.5 rounded-xl font-extrabold text-xs transition-all border border-indigo-200/80 cursor-pointer shadow-3xs group w-fit active:scale-95"
                    >
                      <ArrowLeft className="w-4 h-4 text-indigo-600 group-hover:-translate-x-0.5 transition-transform" />
                      <span>กลับไปยังหน้าหลัก</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (onDismissReturnContext) onDismissReturnContext();
                        setSelectedTenant(null);
                      }}
                      className="md:hidden inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 text-xs font-bold px-2 py-1"
                    >
                      <span>ดูรายชื่อผู้เช่า</span>
                    </button>
                  </div>
                ) : returnContext?.source === 'rooms' || originTab === 'rooms' ? (
                  <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-gray-100">
                    <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 font-sans">
                      <button
                        type="button"
                        aria-label={`กลับไปยังผังห้องพัก (ห้อง ${getRoomNumber(selectedTenant.id)})`}
                        onClick={() => {
                          const targetRoom = rooms.find(r => r.currentTenantId === selectedTenant.id || r.id === (selectedTenant as any).roomId);
                          setSelectedTenant(null);
                          if (returnContext && onReturnToSource) {
                            onReturnToSource(returnContext);
                          } else if (onBackToRooms) {
                            onBackToRooms(targetRoom?.id);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 -ml-2 rounded-xl text-slate-700 hover:text-indigo-600 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer font-extrabold text-xs sm:text-sm shrink-0 group"
                        title="ย้อนกลับ"
                      >
                        <span className="sr-only">กลับไปยังผังห้องพัก (ห้อง {getRoomNumber(selectedTenant.id)})</span>
                        <span aria-hidden="true">กลับ</span>
                      </button>

                      <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 stroke-[2.5]" />

                      <span className="px-1.5 sm:px-2 py-1.5 text-slate-800 font-extrabold text-xs sm:text-sm shrink-0 select-none">
                        ห้อง {getRoomNumber(selectedTenant.id)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (onDismissReturnContext) onDismissReturnContext();
                        setSelectedTenant(null);
                      }}
                      className="md:hidden inline-flex items-center gap-1 text-slate-500 hover:text-slate-700 text-xs font-bold px-2 py-1"
                    >
                      <span>ดูรายชื่อผู้เช่า</span>
                    </button>
                  </div>
                ) : cameFromMeters || originTab === 'meters' ? (
                  <button
                    type="button"
                    data-testid="back-to-meters-btn"
                    onClick={() => {
                      setOriginTab(null);
                      setCameFromMeters(false);
                      setSelectedTenant(null);
                      if (returnContext && onReturnToSource) {
                        onReturnToSource(returnContext);
                      } else if (onBackToMeters) {
                        onBackToMeters();
                      }
                    }}
                    className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100/90 px-3.5 py-1.5 rounded-xl font-extrabold text-xs mb-4 transition-all border border-indigo-200/80 cursor-pointer shadow-3xs group w-fit active:scale-95"
                  >
                    <ArrowLeft className="w-4 h-4 text-indigo-600 group-hover:-translate-x-0.5 transition-transform" />
                    <span>กลับไปยังหน้าบันทึก "จดมิเตอร์"</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (onDismissReturnContext) onDismissReturnContext();
                      setSelectedTenant(null);
                    }}
                    className="md:hidden flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-extrabold text-xs mb-4 transition-all pb-2 border-b border-gray-100 w-full cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>กลับไปยังรายชื่อผู้เช่า</span>
                  </button>
                )}

                {/* Header */}
                {(() => {
                  const tenantReviewContract = selectedContractForReview || (contracts || []).find(c =>
                    c.tenantId === selectedTenant.id && (c.status === 'expired' || c.status === 'waiting_extension' || c.status === 'expiring_soon' || c.status === 'checking_out')
                  );
                  const isExpiredContractReview = !!tenantReviewContract && (
                    activeStatusTab === 'pending' ||
                    selectedContractForReview?.id === tenantReviewContract.id ||
                    tenantReviewContract.status === 'expired' ||
                    tenantReviewContract.status === 'waiting_extension'
                  );

                  return (
                    <>
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-gray-100 pb-5">
                        <div className="flex gap-3.5 items-center">
                          <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-extrabold text-base sm:text-lg shadow-sm border shrink-0 ${isExpiredContractReview
                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                            : getTenantCategory(selectedTenant) === 'pending'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : getTenantCategory(selectedTenant) === 'inactive'
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                            }`}>
                            {selectedTenant.name.charAt(0)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight">{selectedTenant.name}</h2>
                              {isExpiredContractReview && (
                                <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${tenantReviewContract.status === 'waiting_extension' || (tenantReviewContract.endDate && (() => {
                                  const today = new Date();
                                  const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                  const endDay = new Date(new Date(tenantReviewContract.endDate).getFullYear(), new Date(tenantReviewContract.endDate).getMonth(), new Date(tenantReviewContract.endDate).getDate());
                                  return Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24)) > 0;
                                })())
                                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                                  : 'bg-rose-100 text-rose-800 border-rose-200'
                                  }`}>
                                  <AlertCircle className="w-3 h-3" />
                                  {tenantReviewContract.status === 'waiting_extension'
                                    ? 'คำขอ'
                                    : (() => {
                                      if (tenantReviewContract.endDate) {
                                        const today = new Date();
                                        const curDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
                                        const endDay = new Date(new Date(tenantReviewContract.endDate).getFullYear(), new Date(tenantReviewContract.endDate).getMonth(), new Date(tenantReviewContract.endDate).getDate());
                                        const diffDays = Math.ceil((endDay.getTime() - curDay.getTime()) / (1000 * 60 * 60 * 24));
                                        if (diffDays > 0) return `เหลือ ${diffDays} วัน`;
                                      }
                                      return 'หมดอายุ';
                                    })()}
                                </span>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'pending' && (
                                <>
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${(selectedTenant as any).status === 'revision_requested'
                                    ? 'bg-rose-100 text-rose-800'
                                    : 'bg-amber-100 text-amber-800'
                                    }`}>
                                    <Clock className={`w-3 h-3 ${(selectedTenant as any).status === 'revision_requested' ? 'text-rose-600' : 'text-amber-600'}`} />
                                    {(selectedTenant as any).status === 'revision_requested' ? 'กรุณาตรวจสอบอีกครั้ง' : 'รออนุมัติคำขอผู้เช่า'}
                                  </span>
                                  {(() => {
                                    const badge = getRentalTypeBadge(selectedTenant, contracts);
                                    if (!badge) return null;
                                    return (
                                      <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${badge.className}`}>
                                        {badge.label}
                                      </span>
                                    );
                                  })()}
                                </>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'inactive' && (
                                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <XCircle className="w-3 h-3 text-rose-500" />
                                  เลิกเช่าแล้ว
                                </span>
                              )}
                              {!isExpiredContractReview && getTenantCategory(selectedTenant) === 'active' && (
                                <>
                                  {!isTenantLineBound(selectedTenant) ? (
                                    <span
                                      data-testid="header-badge-unbound-line"
                                      className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                                    >
                                      <LineIcon className="w-3 h-3 shrink-0 opacity-60 grayscale" />
                                      ยังไม่ผูก LINE
                                    </span>
                                  ) : (
                                    <span
                                      data-testid="header-badge-bound-line"
                                      className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"
                                    >
                                      <LineIcon className="w-3 h-3 text-[#06C755]" />
                                      ผูก LINE แล้ว
                                    </span>
                                  )}
                                  {getRentalTypeLabel(selectedTenant, contracts) && (
                                    <span
                                      data-testid="header-badge-rental-type"
                                      className="bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                    >
                                      {getRentalTypeLabel(selectedTenant, contracts)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            <p className="text-[11px] sm:text-xs text-gray-400 mt-0.5">เลขบัตรประชาชน: {formatCitizenId(selectedTenant.citizenId)}</p>
                            <p className="text-[11px] sm:text-xs text-indigo-600 font-extrabold mt-0.5">
                              {isExpiredContractReview
                                ? `ห้อง ${getRoomNumber(selectedTenant.id)} (เลิกเช่า หรือ ต่อสัญญา)`
                                : getTenantCategory(selectedTenant) === 'pending'
                                  ? (formatPendingDuration(selectedTenant) || 'สถานะ: รอทำสัญญาและส่งมอบห้อง')
                                  : getTenantCategory(selectedTenant) === 'inactive'
                                    ? 'สถานะ: สิ้นสุดสัญญาเช่าแล้ว'
                                    : `ห้องพักปัจจุบัน: ห้อง ${getRoomNumber(selectedTenant.id)}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto flex-wrap justify-end">
                          {activeStatusTab === 'active' && !isExpiredContractReview && (
                            <button
                              onClick={() => handleOpenEditModal(selectedTenant)}
                              className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-150 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-all cursor-pointer shrink-0"
                            >
                              แก้ไขข้อมูล
                            </button>
                          )}

                          {isExpiredContractReview ? (
                            <>
                              {isDailyTenant(selectedTenant, contracts) ? (
                                <button
                                  type="button"
                                  onClick={() => handleOpenDailyExtend(selectedTenant)}
                                  className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 active:scale-95 text-emerald-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-emerald-300 shadow-3xs"
                                  title="ขยายระยะเวลาเข้าพักรายวัน"
                                >
                                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>ขยายวันเข้าพัก</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleOpenRenewContract(tenantReviewContract, selectedTenant)}
                                  className="px-3.5 py-1.5 bg-transparent hover:bg-amber-50 active:scale-95 text-amber-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 border border-amber-400 shadow-3xs"
                                  title="ต่ออายุสัญญาเช่า"
                                >
                                  <RotateCw className="w-3.5 h-3.5 text-amber-600" />
                                  <span>ต่ออายุสัญญา</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenTerminate(selectedTenant)}
                                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-extrabold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                                title="ทำเรื่องเลิกเช่า คืนห้องพัก และจัดการเงินประกัน"
                              >
                                <LogOut className="w-3.5 h-3.5 text-white" />
                                <span>เลิกเช่า</span>
                              </button>
                            </>
                          ) : getTenantCategory(selectedTenant) === 'pending' ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenReject(selectedTenant)}
                                className="px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                title="ปฏิเสธคำขอเช่า"
                              >
                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>ปฏิเสธคำขอ</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenApprove(selectedTenant)}
                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
                                title="อนุมัติคำขอเช่า"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                <span>อนุมัติคำขอ</span>
                              </button>
                            </>
                          ) : getTenantCategory(selectedTenant) === 'active' ? (
                            <div className="flex items-center gap-2">
                              {isDailyTenant(selectedTenant, contracts) && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenDailyExtend(selectedTenant)}
                                  className="px-3 py-1.5 font-bold text-xs rounded-xl transition-all shrink-0 border bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-700 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                  title="ขยายระยะเวลาเข้าพักรายวัน"
                                >
                                  <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                                  <span>ขยายวันเข้าพัก</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleOpenTerminate(selectedTenant)}
                                className="px-3 py-1.5 font-bold text-xs rounded-xl transition-all shrink-0 border bg-rose-50 border-rose-200 hover:bg-rose-100 text-rose-700 cursor-pointer flex items-center gap-1.5 shadow-2xs"
                                title="ทำเรื่องเลิกเช่าคืนห้องพัก"
                              >
                                <LogOut className="w-3.5 h-3.5 text-rose-600" />
                                <span>เลิกเช่า</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Tabs Selector */}
                <div className="mt-4 border-b border-gray-100">
                  {(() => {
                    const hasIdCard = !!(
                      selectedTenant.idCardPhotoMock &&
                      selectedTenant.idCardPhotoMock.trim() !== '' &&
                      selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
                    );

                    return (
                      <div className={`grid ${isDailyTenant(selectedTenant, contracts) ? 'grid-cols-2' : 'grid-cols-3'} gap-1 text-xs`}>
                        <button
                          onClick={() => setProfileTab('info')}
                          className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'info'
                            ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                            : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          <User className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate sm:hidden">ข้อมูลส่วนตัว</span>
                          <span className="hidden sm:inline">ข้อมูลส่วนตัวและเพิ่มเติม</span>
                          {!hasIdCard && (
                            <span
                              className="w-4 h-4 rounded-full bg-amber-500 text-white font-black text-[10px] flex items-center justify-center shrink-0 shadow-2xs"
                              title="ยังไม่ได้อัปโหลดสำเนาบัตรประจำตัวประชาชน"
                            >
                              !
                            </span>
                          )}
                        </button>

                        {!isDailyTenant(selectedTenant, contracts) && (
                          <button
                            onClick={() => setProfileTab('contract')}
                            className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'contract'
                              ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                              : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                              }`}
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">สัญญาเช่า</span>
                            {(() => {
                              const agrs = resolveTenantDisplayAgreements(
                                selectedTenant,
                                contracts,
                                tenantDetailsData,
                                rooms,
                                effectiveDormId
                              );
                              const count = agrs.length;
                              return count > 0 ? (
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold shrink-0 ${profileTab === 'contract' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {count}
                                </span>
                              ) : null;
                            })()}
                          </button>
                        )}

                        <button
                          onClick={() => setProfileTab('history')}
                          className={`py-2 px-1 sm:px-3.5 border-b-2 font-bold transition-all flex items-center justify-center gap-1 sm:gap-1.5 text-xs rounded-t-lg cursor-pointer ${profileTab === 'history'
                            ? 'border-indigo-600 text-indigo-600 font-bold bg-indigo-50/50'
                            : 'border-transparent text-gray-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                          <Users className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate sm:hidden">ผู้พักร่วม</span>
                          <span className="hidden sm:inline">ประวัติผู้พักร่วม</span>
                          {(() => {
                            const count = (selectedTenant.coOccupants || []).length;
                            return count > 0 ? (
                              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold shrink-0 ${profileTab === 'history' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                                {count}
                              </span>
                            ) : null;
                          })()}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Content Panel */}
                <div className="py-6 overflow-y-auto max-h-[420px] pr-1">

                  {profileTab === 'info' && (
                    <div className="space-y-5">
                      {/* General Contact */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                        <div className="flex flex-col gap-1 text-left">
                          <span className="text-gray-400 font-bold text-[10px] uppercase tracking-wider">เบอร์โทรศัพท์มือถือ</span>
                          <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm">
                            <Phone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="break-all">{formatPhone(selectedTenant.phone)}</span>
                          </p>
                        </div>
                        <div className="flex flex-col gap-1 text-left min-w-0">
                          <span className="text-gray-400 font-bold text-[10px] uppercase tracking-wider">อีเมลติดต่อ</span>
                          <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
                            <Mail className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                            <span className="break-all truncate" title={selectedTenant.email}>{selectedTenant.email || '-'}</span>
                          </p>
                        </div>
                      </div>

                      {/* Emergency Contact */}
                      <div className="pt-4 border-t border-gray-100 space-y-2.5">
                        <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-indigo-600 shrink-0" />
                          ข้อมูลผู้ติดต่อกรณีฉุกเฉิน
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">ชื่อผู้ติดต่อ:</span>
                            <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact?.name || '-'}</p>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">ความสัมพันธ์:</span>
                            <p className="font-extrabold text-slate-800 text-[11px] sm:text-xs break-all">{selectedTenant.emergencyContact?.relationship || '-'}</p>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-gray-400 font-medium text-[10px]">เบอร์โทรติดต่อ:</span>
                            <p className="font-extrabold text-indigo-600 text-[11px] sm:text-xs break-all">{formatPhone(selectedTenant.emergencyContact?.phone) || '-'}</p>
                          </div>
                        </div>
                      </div>

                      {/* Vehicles and Pets */}
                      <div className="pt-4 border-t border-gray-100">
                        {(() => {
                          const allVehicles: VehicleItem[] = selectedTenant.vehicles && selectedTenant.vehicles.length > 0
                            ? selectedTenant.vehicles.filter(v => v.type !== 'none')
                            : (selectedTenant.vehicle && selectedTenant.vehicle.type !== 'none' ? [selectedTenant.vehicle] : []);

                          const allPets: PetItem[] = selectedTenant.pets && selectedTenant.pets.length > 0
                            ? selectedTenant.pets.filter(p => (p.type && p.type.trim() !== '') || (p.name && p.name.trim() !== ''))
                            : (selectedTenant.pet && selectedTenant.pet.hasPet ? [selectedTenant.pet] : []);

                          const maxRows = Math.max(allVehicles.length, allPets.length, 1);

                          const renderVehicleItem = (veh: VehicleItem, vIdx: number) => (
                            <div key={veh.id || vIdx} className="space-y-1 text-[11px]">
                              {allVehicles.length > 1 && (
                                <div className="text-[10px] font-bold text-emerald-800 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                                  คันที่ {vIdx + 1}: {veh.type === 'car' ? 'รถยนต์' : veh.type === 'bicycle' ? 'รถจักรยาน' : 'จักรยานยนต์'}
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ประเภท:</span>
                                  <span className="font-bold text-slate-700">{veh.type === 'car' ? 'รถยนต์' : veh.type === 'bicycle' ? 'รถจักรยาน' : 'จักรยานยนต์'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ทะเบียน:</span>
                                  <span className="font-extrabold text-slate-800">{veh.licensePlate || '-'}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ยี่ห้อ / รุ่น:</span>
                                  <span className="font-medium text-slate-600">{veh.brand || '-'}</span>
                                </div>
                              </div>
                            </div>
                          );

                          const renderPetItem = (petItem: PetItem, pIdx: number) => (
                            <div key={petItem.id || pIdx} className="space-y-1 text-[11px]">
                              {allPets.length > 1 && (
                                <div className="text-[10px] font-bold text-rose-800 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                  สัตว์เลี้ยงตัวที่ {pIdx + 1}
                                </div>
                              )}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ประเภทสัตว์:</span>
                                  <span className="font-bold text-slate-700">
                                    {((petItem.type === 'อื่นๆ' || petItem.type === 'Other' || !petItem.type) && petItem.customType?.trim())
                                      ? petItem.customType.trim()
                                      : (petItem.type || petItem.customType || '-')}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-gray-400 text-[10px]">ชื่อสัตว์เลี้ยง:</span>
                                  <span className="font-extrabold text-slate-800">{petItem.name || '-'}</span>
                                </div>
                              </div>
                            </div>
                          );

                          return (
                            <>
                              {/* DESKTOP & TABLET VIEW: Perfectly Synchronized Rows */}
                              <div className="hidden md:block space-y-2.5">
                                <div className="grid grid-cols-2 gap-6">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                                      ข้อมูลยานพาหนะ
                                    </span>
                                    {allVehicles.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                                        {allVehicles.length} คัน
                                      </span>
                                    )}
                                  </h4>
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Heart className="w-4 h-4 text-rose-600 shrink-0" />
                                      การขอเลี้ยงสัตว์เลี้ยง
                                    </span>
                                    {allPets.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full border border-rose-100">
                                        {allPets.length} ตัว
                                      </span>
                                    )}
                                  </h4>
                                </div>

                                <div className="space-y-2.5">
                                  {Array.from({ length: maxRows }).map((_, idx) => {
                                    const veh = allVehicles[idx];
                                    const pet = allPets[idx];

                                    return (
                                      <div
                                        key={idx}
                                        className={`grid grid-cols-2 gap-6 items-start ${idx > 0 ? 'pt-2.5 border-t border-gray-100' : ''}`}
                                      >
                                        {/* Left Vehicle */}
                                        {veh ? (
                                          renderVehicleItem(veh, idx)
                                        ) : idx === 0 && allVehicles.length === 0 ? (
                                          <p className="text-gray-400 text-[11px] italic">ไม่มีประวัติครอบครองยานพาหนะ</p>
                                        ) : (
                                          <div />
                                        )}

                                        {/* Right Pet */}
                                        {pet ? (
                                          renderPetItem(pet, idx)
                                        ) : idx === 0 && allPets.length === 0 ? (
                                          <p className="text-gray-400 text-[11px] italic">ไม่ได้ขอเลี้ยงสัตว์เลี้ยงภายในห้องพัก</p>
                                        ) : (
                                          <div />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* MOBILE VIEW: Clean Stacked Sections */}
                              <div className="block md:hidden space-y-4">
                                {/* Vehicle Section */}
                                <div className="space-y-2.5">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Car className="w-4 h-4 text-emerald-600 shrink-0" />
                                      ข้อมูลยานพาหนะ
                                    </span>
                                    {allVehicles.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-100">
                                        {allVehicles.length} คัน
                                      </span>
                                    )}
                                  </h4>
                                  {allVehicles.length > 0 ? (
                                    <div className="space-y-2 divide-y divide-gray-100">
                                      {allVehicles.map((veh, vIdx) => (
                                        <div key={veh.id || vIdx} className={vIdx > 0 ? 'pt-2' : ''}>
                                          {renderVehicleItem(veh, vIdx)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-gray-400 text-[11px] italic">ไม่มีประวัติครอบครองยานพาหนะ</p>
                                  )}
                                </div>

                                {/* Pet Section */}
                                <div className="space-y-2.5 pt-3 border-t border-gray-100">
                                  <h4 className="font-bold text-slate-800 flex items-center justify-between text-xs">
                                    <span className="flex items-center gap-1.5">
                                      <Heart className="w-4 h-4 text-rose-600 shrink-0" />
                                      การขอเลี้ยงสัตว์เลี้ยง
                                    </span>
                                    {allPets.length > 0 && (
                                      <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-50 text-rose-700 rounded-full border border-rose-100">
                                        {allPets.length} ตัว
                                      </span>
                                    )}
                                  </h4>
                                  {allPets.length > 0 ? (
                                    <div className="space-y-2 divide-y divide-gray-100">
                                      {allPets.map((pet, pIdx) => (
                                        <div key={pet.id || pIdx} className={pIdx > 0 ? 'pt-2' : ''}>
                                          {renderPetItem(pet, pIdx)}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-gray-400 text-[11px] italic">ไม่ได้ขอเลี้ยงสัตว์เลี้ยงภายในห้องพัก</p>
                                  )}
                                </div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Important Document History */}
                      <div className="pt-4 border-t border-gray-100 text-xs space-y-3">
                        <h4 className="font-bold text-slate-800">ประวัติเอกสารสำคัญ</h4>
                        {(() => {
                          const hasIdCard = !!(
                            selectedTenant.idCardPhotoMock &&
                            selectedTenant.idCardPhotoMock.trim() !== '' &&
                            selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
                          );
                          return (
                            <div
                              onClick={() => {
                                if (hasIdCard) {
                                  setIsIdCardOpen(true);
                                } else {
                                  idCardInputRef.current?.click();
                                }
                              }}
                              className={`p-3 rounded-xl flex items-center justify-between cursor-pointer transition-all group ${hasIdCard
                                ? 'bg-slate-50/80 hover:bg-indigo-50/50 border border-transparent'
                                : 'bg-amber-50/30 border border-amber-200/70 hover:bg-amber-50/60'
                                }`}
                              title={hasIdCard ? "คลิกเพื่อเปิดดูภาพสำเนาบัตรประชาชน" : "คลิกเพื่อเลือกไฟล์และอัปโหลดทันที"}
                            >
                              <input
                                ref={idCardInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleDirectIdCardUpload}
                                className="hidden"
                              />
                              <div className="flex gap-2.5 items-center min-w-0">
                                <FileText className={`w-4 h-4 ${hasIdCard ? 'text-indigo-600' : 'text-amber-500'} group-hover:scale-110 transition-transform shrink-0`} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-bold text-slate-800 text-[11px] group-hover:text-indigo-900 transition-colors">สำเนาบัตรประจำตัวประชาชน</p>
                                    {!hasIdCard && (
                                      <span
                                        className="w-3.5 h-3.5 rounded-full bg-amber-500 text-white font-black text-[9px] flex items-center justify-center shrink-0 shadow-2xs"
                                        title="ยังไม่ได้อัปโหลดสำเนาบัตรประจำตัวประชาชน"
                                      >
                                        !
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[9px] text-gray-400 mt-0.5 flex flex-wrap items-center gap-1">
                                    <span>สถานะ: {hasIdCard ? 'ตรวจสอบและผ่านการรับรองแล้ว' : 'ยังไม่ได้อัปโหลดเอกสาร'}</span>
                                    <span className="text-[8px] text-indigo-600 underline font-bold group-hover:text-indigo-700">
                                      {hasIdCard ? '(คลิกเพื่อเปิดดูภาพ)' : '(คลิกเพื่ออัปโหลด)'}
                                    </span>
                                  </p>
                                </div>
                              </div>
                              {hasIdCard ? (
                                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md shrink-0">
                                  อัปโหลดแล้ว
                                </span>
                              ) : (
                                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 text-white font-black text-[7px] flex items-center justify-center shrink-0">
                                    !
                                  </span>
                                  <span>ยังไม่อัปโหลด</span>
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Daily Stay Details for Daily Tenants or Lease Contracts for Monthly/Term */}
                        {isDailyTenant(selectedTenant, contracts) ? (
                          <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl space-y-3 mt-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-emerald-600" />
                                <h4 className="font-bold text-slate-800 text-xs">ข้อมูลการเข้าพักรายวัน</h4>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                                พักรายวัน
                              </span>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs pt-1">
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">ห้องพัก:</span>
                                <strong className="text-slate-800 font-bold">ห้อง {getRoomNumber(selectedTenant.id)}</strong>
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">วันที่เข้าพัก:</span>
                                <strong className="text-slate-800 font-bold">{formatThaiDate(selectedTenant.requestedStartDate || (selectedTenant as any).startDate) || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">วันที่เช็คเอาท์:</span>
                                <strong className="text-emerald-700 font-bold">{formatThaiDate(selectedTenant.requestedEndDate || (selectedTenant as any).endDate) || '-'}</strong>
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">จำนวนวันที่พัก:</span>
                                <strong className="text-slate-800 font-bold">{selectedTenant.requestedDays || 1} วัน</strong>
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">อัตราค่าเช่า:</span>
                                <strong className="text-slate-800 font-bold">{formatBaht(selectedTenant.requestedDailyRate || selectedTenant.requestedRent || 550)} / วัน</strong>
                              </div>
                              <div>
                                <span className="text-[10px] text-gray-400 block font-medium">เงินประกัน/มัดจำ:</span>
                                <strong className="text-slate-800 font-bold">{formatBaht(selectedTenant.requestedDeposit || 0)}</strong>
                              </div>
                            </div>

                            {activeStatusTab === 'active' && (
                              <div className="pt-2 flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleOpenDailyExtend(selectedTenant)}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                                >
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span>ขยายวันเข้าพัก</span>
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (() => {
                          const tenantContracts = contracts || [];
                          const matchedContracts = tenantContracts.filter(c => c.tenantId === selectedTenant.id);
                          if (matchedContracts.length === 0) {
                            return (
                              <div className="p-3 bg-slate-50/50 rounded-xl text-center text-gray-400 text-[11px] italic">
                                ยังไม่มีหนังสือสัญญาเช่าในระบบ
                              </div>
                            );
                          }
                          return matchedContracts.map((con) => {
                            const rm = rooms.find(r => r.id === con.roomId);
                            const rmNum = rm ? rm.roomNumber : 'ไม่ระบุห้อง';
                            return (
                              <div
                                key={con.id}
                                onClick={() => {
                                  handleOpenPrintContract(con);
                                }}
                                className="p-3 bg-slate-50/80 hover:bg-indigo-50/50 rounded-xl flex items-center justify-between cursor-pointer transition-all group mt-2"
                                title="คลิกเพื่อเปิดดูรายละเอียดและพิมพ์สัญญาเช่า"
                              >
                                <div className="flex gap-2.5 items-center min-w-0">
                                  <FileText className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform shrink-0" />
                                  <div className="min-w-0">
                                    <p className="font-bold text-slate-800 text-[11px] group-hover:text-indigo-900 transition-colors">
                                      หนังสือสัญญาเช่าเลขที่ {con.contractNumber}
                                    </p>
                                    <p className="text-[9px] text-gray-400 mt-0.5">
                                      ห้องพัก {rmNum} &bull; สัญญาเริ่มต้น: {formatThaiDate(con.startDate)} - {formatThaiDate(con.endDate)}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenPrintContract(con);
                                  }}
                                  className="text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-0.5 group-hover:bg-indigo-100 transition-colors cursor-pointer"
                                >
                                  เปิดดูสัญญา &rarr;
                                </span>
                              </div>
                            );
                          });
                        })()}
                      </div>

                    </div>
                  )}



                  {/* Contract Tab */}
                  {profileTab === 'contract' && (
                    <div className="space-y-4">
                      {/* Matched Contracts */}
                      {(() => {
                        const tenantContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);

                        if (tenantContracts.length === 0) {
                          const isPendingCategory = getTenantCategory(selectedTenant) === 'pending' || selectedTenant.status === 'pending';
                          const rawType = String(selectedTenant.rentalType || selectedTenant.rentalPlan || '').toUpperCase();
                          const isPendingMonthlyOrTerm = isPendingCategory && (rawType === 'MONTHLY' || rawType === 'TERM');

                          if (isPendingMonthlyOrTerm) {
                            const isTerm = rawType === 'TERM';
                            const targetRoom = rooms.find(r => r.id === selectedTenant.requestedRoomId || r.roomNumber === selectedTenant.requestedRoomId || r.id === selectedTenant.roomId);
                            const roomNum = targetRoom ? targetRoom.roomNumber : (selectedTenant.requestedRoomId || 'ยังไม่ระบุห้อง');
                            const startStr = formatThaiDate(selectedTenant.requestedStartDate);
                            const endStr = formatThaiDate(selectedTenant.requestedEndDate);
                            const duration = selectedTenant.requestedDurationMonths || (isTerm ? 4 : 12);
                            const rentVal = selectedTenant.requestedRent || (targetRoom ? (isTerm ? targetRoom.termRent : targetRoom.monthlyRent) : (isTerm ? 22000 : 5000));
                            const depositVal = selectedTenant.requestedDeposit !== undefined && selectedTenant.requestedDeposit !== null
                              ? selectedTenant.requestedDeposit
                              : (targetRoom ? (isTerm ? targetRoom.termDeposit : targetRoom.monthlyDeposit) : (isTerm ? 5500 : 10000));

                            const regId = (selectedTenant as any).registrationRequestId || selectedTenant.id;
                            const rawRegSig = selectedTenant.tenantSignature || (selectedTenant as any).signatureUrl || (selectedTenant as any).tenantSignatureUrl;
                            const regSigUrl = (rawRegSig && (rawRegSig.startsWith('http') || rawRegSig.startsWith('data:') || rawRegSig.startsWith('/api/')))
                              ? rawRegSig
                              : (dormitoryId && regId ? `/api/v1/dormitories/${dormitoryId}/tenant-registrations/${regId}/tenant-signature` : null);

                            const agreedTerms = (selectedTenant as any).defaultTerms || (selectedTenant as any).terms || (selectedTenant as any).acceptanceSnapshot?.defaultTerms || (selectedTenant as any).acceptanceSnapshot?.terms || `1. ผู้เช่าต้องชำระค่าเช่าห้องพักตรงตามกำหนดเวลา\n2. เงินประกันความเสียหายจะคืนให้เมื่อสิ้นสุดสัญญาเช่าและหักลบค่าเสียหายแล้ว\n3. รักษาความสงบเรียบร้อยและปฏิบัติตามระเบียบข้อบังคับของหอพักอย่างเคร่งครัด`;

                            return (
                              <div className="space-y-4">
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                                  <div className="space-y-0.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-extrabold text-slate-900 text-sm">
                                        สัญญาเช่า (คำขอลงทะเบียน)
                                      </span>
                                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-lg border bg-amber-50 text-amber-700 border-amber-200">
                                        รออนุมัติ
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-gray-500 font-medium">
                                      ห้อง {roomNum} &bull; {isTerm ? 'สัญญาเช่ารายเทอม' : 'สัญญาเช่ารายเดือน'}
                                    </p>
                                  </div>
                                </div>

                                {/* Contract Details - Matching Active Contract Flat Clean Layout */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs py-1">
                                  <div className="space-y-1">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">ระยะเวลาสัญญา</span>
                                    <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                      {startStr} - {endStr}
                                    </p>
                                    <p className="text-[11px] text-indigo-600 font-semibold">
                                      ระยะเวลา: {duration} เดือน
                                    </p>
                                  </div>

                                  <div className="space-y-1">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">อัตราค่าเช่า & เงินประกัน</span>
                                    <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                      ค่าเช่า {formatBaht(rentVal)} {isTerm ? '/เทอม' : '/เดือน'}
                                    </p>
                                    <p className="text-[11px] text-slate-600 font-semibold flex items-center gap-1.5">
                                      <span>เงินประกัน {formatBaht(depositVal)}</span>
                                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${(selectedTenant.depositPaymentStatus === 'paid' || (selectedTenant as any).depositDeclaredStatus === 'paid')
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : 'bg-rose-100 text-rose-800'
                                        }`}>
                                        {(selectedTenant.depositPaymentStatus === 'paid' || (selectedTenant as any).depositDeclaredStatus === 'paid') ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}
                                      </span>
                                    </p>
                                  </div>
                                </div>

                                {/* Terms snippet */}
                                {agreedTerms && (
                                  <div className="pt-2 text-xs">
                                    <p className="font-bold text-slate-700 text-[11px] mb-1">ข้อกำหนดสำคัญในสัญญา:</p>
                                    <p className="text-gray-600 text-[11px] leading-relaxed whitespace-pre-line bg-slate-50/70 p-3 rounded-xl">
                                      {agreedTerms}
                                    </p>
                                  </div>
                                )}

                                {/* Tenant Registration Signature */}
                                <div className="pt-4 border-t border-dashed border-slate-200">
                                  <div className="max-w-xs space-y-1.5">
                                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">
                                      ลงชื่อ ผู้เช่าห้องพัก (คำขอลงทะเบียน)
                                    </span>
                                    <div className="h-12 flex items-center justify-start">
                                      <AuthenticatedSignatureImage
                                        url={regSigUrl}
                                        alt="ลายมือชื่อผู้เช่า"
                                        className="max-h-12 max-w-[140px] object-contain"
                                        dormitoryId={dormitoryId}
                                        testId="pending-tenant-signature"
                                      />
                                    </div>
                                    <p className="font-extrabold text-slate-800 text-xs">({selectedTenant.name})</p>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="text-center py-12 bg-slate-50/70 rounded-2xl p-6 space-y-2">
                              <div className="w-10 h-10 bg-white rounded-xl border border-gray-100 flex items-center justify-center mx-auto text-gray-400">
                                <FileText className="w-5 h-5 text-indigo-400" />
                              </div>
                              <p className="font-bold text-slate-700 text-xs">ยังไม่มีประวัติสัญญาเช่าสำหรับผู้เช่ารายนี้</p>
                              <p className="text-[11px] text-gray-400 max-w-sm mx-auto">
                                สัญญาเช่าจะแสดงขึ้นเมื่อมีการทำสัญญาเช่าห้องพักสำหรับผู้เช่ารายนี้
                              </p>
                            </div>
                          );
                        }

                        const displayAgreements = resolveTenantDisplayAgreements(
                          selectedTenant,
                          contracts,
                          tenantDetailsData,
                          rooms,
                          effectiveDormId
                        );

                        const newestRenewableAgreementId = (activeStatusTab === 'active' || selectedTenant?.status === 'active')
                          ? resolveNewestRenewableAgreementId(displayAgreements)
                          : null;

                        return (
                          <div className="divide-y divide-gray-100">
                            {displayAgreements.map((contract, index) => {
                              const isTermContract = contract.rentBillingType === 'term' || (contract as any).rentalType === 'TERM' || (contract as any).rentalPlan === 'term';
                              const matchedRoom = rooms.find(r => r.id === contract.roomId || r.roomNumber === contract.roomId);
                              const roomDisplay = matchedRoom ? `ห้อง ${matchedRoom.roomNumber} (ชั้น ${matchedRoom.floor})` : `ห้อง ${contract.roomId}`;

                              const isFutureAgreement = !contract.isCurrentTermAgreement && (
                                contract.status === 'scheduled' ||
                                contract.status === 'approved_scheduled' ||
                                contract.status === 'SCHEDULED' ||
                                (contract.contractNumber && contract.contractNumber.includes('EXT')) ||
                                (contract.contractNumber && contract.contractNumber.includes('RNW')) ||
                                new Date(contract.startDate).getTime() > new Date('2026-09-30').getTime()
                              );

                              const statusInfo = contract.isCurrentTermAgreement
                                ? { label: 'สัญญา/ข้อตกลงปัจจุบัน', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' }
                                : (isFutureAgreement
                                  ? { label: 'สัญญาถัดไป', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' }
                                  : getContractStatusBadgeInfo(contract.status, contract.endDate));

                              const billsPool = Array.isArray(tenantDetailsData?.bills) && tenantDetailsData.bills.length > 0
                                ? tenantDetailsData.bills
                                : (bills || []);
                              const depositState = (contract.isCurrentTermAgreement || isFutureAgreement)
                                ? { isPaid: true }
                                : deriveContractDepositPaymentState(contract.id, billsPool);

                              const headerTitle = contract.isCurrentTermAgreement
                                ? 'สัญญาเช่ารายเทอม (ปัจจุบัน)'
                                : `สัญญาเลขที่: ${contract.contractNumber}`;

                              const headerSubtitle = contract.isCurrentTermAgreement
                                ? `${roomDisplay} • ภาคการศึกษา/รอบเทอมปัจจุบัน (ทำสัญญาเมื่อ ${formatThaiDate(contract.createdAt)})`
                                : (isFutureAgreement
                                  ? `${roomDisplay} • สัญญาถัดไป เริ่ม ${formatThaiDate(contract.startDate)}`
                                  : `${roomDisplay} • ทำสัญญาเมื่อ ${formatThaiDate(contract.createdAt)}`);

                              const agreementTerms = contract.terms || null;

                              const canRenewThisAgreement = Boolean(
                                newestRenewableAgreementId && contract.id === newestRenewableAgreementId
                              );

                              return (
                                <div
                                  key={contract.id || `agreement-${index}`}
                                  className={`space-y-3.5 ${index > 0 ? 'pt-5' : ''}`}
                                >
                                  {/* Contract Header */}
                                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                                    <div className="space-y-0.5">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-slate-900 text-sm">
                                          {headerTitle}
                                        </span>
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-lg border ${statusInfo.bg} ${statusInfo.text} ${statusInfo.border}`}>
                                          {statusInfo.label}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-gray-500 font-medium">
                                        {headerSubtitle}
                                      </p>
                                    </div>

                                    {/* Contract Actions Bar */}
                                    <div className="flex items-center gap-2 self-end sm:self-auto">
                                      <button
                                        type="button"
                                        onClick={() => handleOpenPrintContract(contract)}
                                        className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                                        title="พิมพ์เอกสารสัญญาเช่า A4"
                                      >
                                        <Printer className="w-3.5 h-3.5" />
                                        <span>พิมพ์สัญญา</span>
                                      </button>
                                      {canRenewThisAgreement && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenRenewContract(contract, selectedTenant)}
                                          className="px-3 py-1.5 bg-transparent hover:bg-amber-50 active:scale-95 text-amber-700 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer border border-amber-400 shadow-3xs"
                                          title="ต่ออายุสัญญาเช่า"
                                        >
                                          <RotateCw className="w-3.5 h-3.5 text-amber-600" />
                                          <span>ต่ออายุสัญญา</span>
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Contract Details - Flat Clean Layout without nested cards */}
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs py-1">
                                    <div className="space-y-1">
                                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">ระยะเวลาสัญญา</span>
                                      <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                        {formatThaiDate(contract.startDate)} - {formatThaiDate(contract.endDate)}
                                      </p>
                                      <p className="text-[11px] text-indigo-600 font-semibold">
                                        ระยะเวลา: {contract.durationMonths} เดือน
                                      </p>
                                    </div>

                                    <div className="space-y-1">
                                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">อัตราค่าเช่า & เงินประกัน</span>
                                      <p className="font-extrabold text-slate-800 text-xs sm:text-sm">
                                        ค่าเช่า {formatBaht(contract.rentAmount)} {isTermContract ? '/เทอม' : '/เดือน'}
                                      </p>
                                      <p className="text-[11px] text-slate-600 font-semibold flex items-center gap-1.5">
                                        <span>เงินประกัน {formatBaht(contract.depositAmount)}</span>
                                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${depositState.isPaid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                                          {isFutureAgreement ? 'ยกยอดเงินประกัน' : (depositState.isPaid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย')}
                                        </span>
                                      </p>
                                    </div>
                                  </div>

                                  {/* Terms snippet */}
                                  {agreementTerms && (
                                    <div className="pt-2 text-xs">
                                      <p className="font-bold text-slate-700 text-[11px] mb-1">ข้อกำหนดสำคัญในสัญญา:</p>
                                      <p className="text-gray-600 text-[11px] leading-relaxed whitespace-pre-line bg-slate-50/70 p-3 rounded-xl">
                                        {agreementTerms}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {profileTab === 'history' && (
                    <div className="space-y-6">
                      {(() => {
                        const isTenantInactive = activeStatusTab === 'inactive' || getTenantCategory(selectedTenant) === 'inactive';

                        return (
                          <>
                            {/* Active Co-occupants Section */}
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-xs font-bold text-slate-800">
                                    {isTenantInactive ? 'ข้อมูลผู้พักร่วม' : 'ผู้พักร่วมปัจจุบัน'}
                                  </h4>
                                  <span className="text-[10px] font-bold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">
                                    {(selectedTenant.coOccupants || []).length} คน
                                  </span>
                                </div>
                                {!isTenantInactive && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewCoName('');
                                      setNewCoPhone('');
                                      setNewCoRelationship('แฟน');
                                      setNewCoCustomRelationship('');
                                      setIsAddCoModalOpen(true);
                                    }}
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 transition-all flex items-center gap-1 cursor-pointer active:scale-95 shadow-sm"
                                  >
                                    <UserPlus className="w-3.5 h-3.5" />
                                    <span>เพิ่มผู้พักร่วม</span>
                                  </button>
                                )}
                              </div>

                              {/* List of active co-occupants */}
                              {(selectedTenant.coOccupants || []).length > 0 ? (
                                <div className="divide-y divide-slate-100">
                                  {(selectedTenant.coOccupants || []).map((co, index) => (
                                    <div
                                      key={co.id || index}
                                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                    >
                                      <div className="space-y-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <p className="font-bold text-slate-800 text-xs truncate">
                                            {co.name}
                                          </p>
                                          <span className="text-[9px] text-indigo-700 font-bold bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                                            คนที่ {index + 1}
                                          </span>
                                          {co.relationship && (
                                            <span className="text-[9px] text-purple-700 font-bold bg-purple-50 px-2 py-0.5 rounded-md border border-purple-100">
                                              {co.relationship}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                                          <span className="flex items-center gap-1">
                                            <Phone className="w-3 h-3 text-indigo-500 shrink-0" />
                                            <span>{formatPhone(co.phone)}</span>
                                          </span>
                                          {co.citizenId && (
                                            <span className="flex items-center gap-1 text-[10px] text-gray-400">
                                              <CreditCard className="w-3 h-3 text-slate-400 shrink-0" />
                                              <span>เลขบัตร: {co.citizenId}</span>
                                            </span>
                                          )}
                                        </div>
                                        <div className="text-[10px] text-slate-400 flex items-center gap-1 pt-0.5">
                                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                                          <span>วันที่บันทึกเข้าพัก: <strong className="text-slate-600 font-bold">{formatThaiDate(co.addedAt || selectedTenant.createdAt, true)}</strong></span>
                                        </div>
                                      </div>

                                      {!isTenantInactive && (
                                        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setCoToDelete(co);
                                              setDeleteCoReason('');
                                              setIsDeleteCoModalOpen(true);
                                            }}
                                            className="px-2.5 py-1 text-rose-600 hover:text-white bg-rose-50 hover:bg-rose-600 border border-rose-200 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-xs active:scale-95"
                                            title="นำผู้พักร่วมออกจากห้องพัก"
                                          >
                                            <UserMinus className="w-3 h-3" />
                                            <span>นำออก</span>
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="p-4 bg-slate-50 border border-dashed border-gray-200 rounded-2xl text-center space-y-2">
                                  <p className="text-xs text-gray-500 font-medium">
                                    {isTenantInactive
                                      ? 'ไม่มีประวัติผู้พักร่วมที่บันทึกไว้ในสัญญา'
                                      : 'พักอาศัยเพียงท่านเดียว (ไม่มีผู้พักร่วมในปัจจุบัน)'}
                                  </p>
                                  {!isTenantInactive && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setNewCoName('');
                                        setNewCoPhone('');
                                        setNewCoRelationship('แฟน');
                                        setNewCoCustomRelationship('');
                                        setIsAddCoModalOpen(true);
                                      }}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl border border-indigo-200 cursor-pointer transition-all"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>บันทึกแจ้งผู้พักร่วม</span>
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}

                      {/* History Timeline Section */}
                      <div className="space-y-3 pt-4 border-t border-gray-100">
                        {(() => {
                          const historyList = getEffectiveCoOccupantHistory(selectedTenant);

                          return (
                            <>
                              <div className="flex items-center justify-between">
                                <div>
                                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                    <History className="w-3.5 h-3.5 text-indigo-600" />
                                    ประวัติการเพิ่มและลบผู้พักร่วมย้อนหลัง
                                  </h4>
                                  <p className="text-[10px] text-gray-400 mt-0.5">
                                    บันทึกประวัติวันเดือนปีและเวลาเมื่อมีการเพิ่มหรือนำผู้พักร่วมออก
                                  </p>
                                </div>
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                                  {historyList.length} รายการ
                                </span>
                              </div>

                              {historyList.length > 0 ? (
                                <div className="divide-y divide-gray-100">
                                  {historyList.map((item, idx) => {
                                    const isAdded = item.action === 'added';
                                    const isOld = idx > 0;
                                    return (
                                      <div
                                        key={item.id || idx}
                                        className={`py-2.5 flex items-start justify-between gap-2 text-xs ${idx > 0 ? 'pt-2.5' : 'pt-1'
                                          }`}
                                      >
                                        <div className="space-y-1 min-w-0">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span
                                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${isOld
                                                ? 'bg-slate-100 text-slate-600'
                                                : isAdded
                                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                                  : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                                                }`}
                                            >
                                              {isAdded ? (
                                                <>
                                                  <UserPlus className={`w-3 h-3 ${isOld ? 'text-slate-500' : 'text-emerald-600'}`} />
                                                  <span>เพิ่มเข้าพัก</span>
                                                </>
                                              ) : (
                                                <>
                                                  <UserMinus className={`w-3 h-3 ${isOld ? 'text-slate-500' : 'text-rose-600'}`} />
                                                  <span>ลบออก / ย้ายออก</span>
                                                </>
                                              )}
                                            </span>
                                            <span className={`font-bold text-xs ${isOld ? 'text-slate-700' : isAdded ? 'text-slate-900' : 'text-slate-800'}`}>
                                              {item.name}
                                            </span>
                                          </div>

                                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                                            <span>เบอร์โทร: <strong className={isOld ? 'text-slate-600' : 'text-slate-700'}>{formatPhone(item.phone)}</strong></span>
                                            {item.citizenId && (
                                              <span className="text-[10px] text-gray-400">
                                                เลขบัตร: {item.citizenId}
                                              </span>
                                            )}
                                          </div>

                                          {item.note && (
                                            <p className={`text-[10px] italic ${isOld ? 'text-slate-400' : 'text-slate-500'}`}>
                                              หมายเหตุ: {item.note}
                                            </p>
                                          )}
                                        </div>

                                        {/* Date and Time */}
                                        <div className="text-right shrink-0">
                                          <span
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${isOld
                                              ? 'text-slate-500 bg-slate-50'
                                              : isAdded
                                                ? 'bg-emerald-50 text-emerald-800'
                                                : 'bg-rose-50 text-rose-800'
                                              }`}
                                          >
                                            <Clock className={`w-3 h-3 ${isOld ? 'text-slate-400' : 'opacity-70'}`} />
                                            <span>{formatThaiDate(item.timestamp, true)}</span>
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <p className="text-center py-6 text-xs text-gray-400 italic">
                                  ยังไม่มีประวัติการบันทึกหรือเปลี่ยนแปลงผู้พักร่วม
                                </p>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                </div>
              </div>

              <div className="pt-4 border-t border-gray-100 flex justify-between items-center text-[10px] text-gray-400 shrink-0">
                <span>จดบันทึกเข้าระบบเมื่อ: {selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : (selectedTenant.joinDate || '-')}</span>
                <span>รหัสบันทึก: {selectedTenant.id}</span>
              </div>
            </div>
          ) : (
            <div className="bg-slate-50 border border-dashed border-gray-200 rounded-3xl h-[700px] flex flex-col justify-center items-center p-6 text-center text-gray-400">
              <User className="w-12 h-12 text-gray-300 mb-3" />
              <h4 className="text-sm font-bold text-slate-700">ไม่มีผู้เช่าถูกเลือกในขณะนี้</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs">กรุณาเลือกชื่อผู้เช่าในเมนูด้านซ้าย เพื่อตรวจสอบประวัติรายบุคคล</p>
            </div>
          )}
        </div>
      </div>

      {/* Thai National ID Card Viewer Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isIdCardOpen}
          onClose={() => setIsIdCardOpen(false)}
          title="เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า"
          size="md"
        >
          <div className="flex flex-col items-center justify-center p-1 sm:p-4 space-y-4">

            {(() => {
              const hasPhoto = !!(
                selectedTenant.idCardPhotoMock &&
                selectedTenant.idCardPhotoMock.trim() !== '' &&
                selectedTenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64'
              );

              return (
                <>
                  {hasPhoto ? (
                    <div className="w-full max-w-[420px] bg-slate-50 border border-gray-200 rounded-2xl overflow-hidden p-2 relative shadow-md group">
                      <img
                        src={selectedTenant.idCardPhotoMock}
                        alt="เอกสารประจำตัวผู้เช่า"
                        className="w-full h-auto max-h-[280px] object-contain rounded-lg mx-auto bg-white"
                      />

                      {/* Direct change button */}
                      <div className="mt-2.5 pt-2 border-t border-gray-200 flex items-center justify-end px-1">
                        <label className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer transition-colors">
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>เปลี่ยน</span>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleDirectIdCardUpload}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full max-w-[420px] p-8 border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-3xl bg-slate-50/60 hover:bg-indigo-50/20 transition-all flex flex-col items-center justify-center text-center space-y-3 relative group cursor-pointer">
                      <div className="w-14 h-14 rounded-2xl bg-white border border-gray-200 shadow-xs flex items-center justify-center group-hover:scale-105 transition-transform">
                        <FileText className="w-7 h-7 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs sm:text-sm font-bold text-slate-700 group-hover:text-indigo-900 transition-colors">ยังไม่ได้อัปโหลดไฟล์ภาพบัตรประชาชน</p>
                        <p className="text-[10px] text-gray-400">คุณสามารถแก้ไขข้อมูลผู้เช่า หรือคลิกที่นี่เพื่อทำการอัปโหลดไฟล์สำเนาจริงได้</p>
                        <p className="text-[9px] text-indigo-500 font-bold mt-1">คลิกหรือลากไฟล์มาวางเพื่ออัปโหลดทันที (PNG, JPG, WEBP)</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleDirectIdCardUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3 pt-2 w-full">
                    {/* Only show Print button when an image exists */}
                    {hasPhoto && (
                      <button
                        onClick={handlePrintIdCard}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer text-center flex items-center justify-center gap-1.5"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>พิมพ์เอกสาร</span>
                      </button>
                    )}
                    <button
                      onClick={() => setIsIdCardOpen(false)}
                      className={`py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer text-center ${hasPhoto ? 'flex-1' : 'w-full'}`}
                    >
                      เสร็จสิ้น
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </Modal>
      )}

      {/* Canonical Quick Add Tenant Modal (TERM / MONTHLY / DAILY) */}
      {quickAddModalOpen && selectedQuickAddContext && (
        <QuickAddTenantModal
          isOpen={quickAddModalOpen}
          onClose={() => {
            setQuickAddModalOpen(false);
            setSelectedQuickAddContext(null);
          }}
          context={selectedQuickAddContext}
          availableRooms={getTrulyVacantRooms(rooms, contracts || [], tenants)}
          buildings={localBuildings}
          onSelectRoom={handleSelectQuickAddRoom}
          hideLineTab={false}
          defaultTab="LINE"
          onSuccess={handleQuickAddSuccess}
          onNavigateToLineConfig={onNavigateToLineConfig}
        />
      )}

      {false && (
        <div>

          {/* Step 0: General Info */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">ชื่อ-นามสกุล *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="เช่น นายนพดล มั่งมี"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">เลขประจำตัวประชาชน *</label>
                  <input
                    type="text"
                    required
                    maxLength={17}
                    value={formatCitizenIdInput(citizenId)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 13);
                      setCitizenId(clean);
                    }}
                    placeholder="เลข 13 หลัก"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">เบอร์โทรศัพท์มือถือ *</label>
                  <input
                    type="tel"
                    required
                    maxLength={12}
                    value={formatPhoneInput(phone)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setPhone(clean);
                    }}
                    placeholder="เช่น 089-xxx-xxxx"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700">อีเมลติดต่อ</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="เช่น user@gmail.com"
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 1: Co-occupants, Pets, Vehicles */}
          {currentStep === 1 && (
            <div className="space-y-6">

              {/* Emergency */}
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800">ผู้ติดต่อกรณีฉุกเฉิน *</h4>
                <div className="space-y-3">
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="ชื่อผู้ติดต่อ"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      placeholder="ความสัมพันธ์"
                      value={emergencyRelation}
                      onChange={(e) => setEmergencyRelation(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                    <input
                      type="tel"
                      required
                      maxLength={12}
                      value={formatPhoneInput(emergencyPhone)}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setEmergencyPhone(clean);
                      }}
                      placeholder="เบอร์โทรศัพท์"
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Co-occupants builder */}
              <div className="p-4 bg-slate-50 border border-gray-200 rounded-2xl space-y-3">
                <h4 className="font-bold text-xs text-slate-800">เพิ่มรายชื่อผู้พักร่วมอาศัยด้วย</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    type="text"
                    placeholder="ชื่อ - นามสกุล"
                    value={coName}
                    onChange={(e) => setCoName(e.target.value)}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium"
                  />
                  <input
                    type="tel"
                    placeholder="เบอร์โทรศัพท์"
                    maxLength={12}
                    value={formatPhoneInput(coPhone)}
                    onChange={(e) => {
                      const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                      setCoPhone(clean);
                    }}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium"
                  />
                  <select
                    value={coRelationship}
                    onChange={(e) => {
                      setCoRelationship(e.target.value);
                      if (e.target.value !== 'อื่นๆ') setCoCustomRelationship('');
                    }}
                    className="px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-indigo-600 font-medium cursor-pointer"
                  >
                    {CO_OCCUPANT_RELATION_OPTIONS.map((rel) => (
                      <option key={rel} value={rel}>{rel}</option>
                    ))}
                  </select>
                </div>
                {coRelationship === 'อื่นๆ' && (
                  <div className="animate-in fade-in slide-in-from-top-1">
                    <input
                      type="text"
                      placeholder="ระบุสถานะความสัมพันธ์ เช่น ผู้ดูแล, เพื่อนร่วมงาน"
                      value={coCustomRelationship}
                      onChange={(e) => setCoCustomRelationship(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-indigo-200 bg-indigo-50/40 rounded-xl font-medium focus:outline-none focus:border-indigo-600"
                    />
                  </div>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddCoOccupant}
                    disabled={!coName.trim() || !coPhone.trim() || (coRelationship === 'อื่นๆ' && !coCustomRelationship.trim())}
                    className={`px-3 py-1.5 font-bold text-[10px] rounded-lg transition-all ${coName.trim() && coPhone.trim() && (coRelationship !== 'อื่นๆ' || coCustomRelationship.trim())
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                  >
                    เพิ่มผู้ร่วมตึก
                  </button>
                </div>
                {coOccupants.length > 0 && (
                  <div className="space-y-1.5 pt-2 max-h-24 overflow-y-auto">
                    {coOccupants.map((c) => (
                      <div key={c.id} className="flex justify-between items-center bg-white p-2 border border-gray-100 rounded-xl text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-800">{c.name}</span>
                          <span className="text-gray-500">({formatPhone(c.phone)})</span>
                          {c.relationship && (
                            <span className="text-[9px] text-purple-700 bg-purple-50 px-1.5 py-0.2 border border-purple-100 rounded font-medium">
                              {c.relationship}
                            </span>
                          )}
                        </div>
                        <button type="button" onClick={() => handleRemoveCoOccupant(c.id)} className="text-rose-500 font-bold hover:text-rose-700 cursor-pointer">&times;</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pets / Vehicles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-semibold text-slate-700">ขออนุญาตนำสัตว์เลี้ยงเข้าพัก</label>
                    {(() => {
                      const pPolicy = getEffectivePetPolicy(propertyDefaultsPolicy);
                      const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                      return isAllowed ? (
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md">
                          อนุญาตตามเงื่อนไข
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                          ไม่อนุญาตให้เลี้ยง
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={hasPet}
                            onChange={(e) => setHasPet(e.target.checked)}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-xs text-slate-600">มีสัตว์เลี้ยงประสงค์นำเข้า</span>
                        </div>
                        {hasPet && (
                          <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={petType}
                                onChange={(e) => {
                                  setPetType(e.target.value);
                                  if (e.target.value !== 'อื่นๆ' && e.target.value !== 'other') setCustomPetType('');
                                }}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                              >
                                <option value="">-- เลือกประเภทสัตว์เลี้ยง --</option>
                                {(() => {
                                  const allowed = resolveAllowedPetOptions(getEffectivePetPolicy(propertyDefaultsPolicy));
                                  const hasSelected = allowed.some(a => a.id === petType);
                                  const options = (!petType || hasSelected)
                                    ? allowed
                                    : [{ id: petType as any, label: CANONICAL_PET_GROUP_OPTIONS.find(c => c.id === petType)?.label || petType }, ...allowed];
                                  return options.map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                  ));
                                })()}
                              </select>
                              <input
                                type="text"
                                placeholder="ชื่อน้อง"
                                value={petName}
                                onChange={(e) => setPetName(e.target.value)}
                                className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                              />
                            </div>
                            {(petType === 'อื่นๆ' || petType === 'other') && (
                              <div className="animate-in fade-in slide-in-from-top-1 space-y-1">
                                <label className="block text-[10px] font-bold text-indigo-700">ระบุประเภทสัตว์เลี้ยง *</label>
                                <input
                                  type="text"
                                  placeholder="ระบุประเภท เช่น เต่า, เม่นแคระ, กิ้งก่า, ชูการ์ไกลเดอร์"
                                  value={customPetType}
                                  onChange={(e) => setCustomPetType(e.target.value)}
                                  className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs text-slate-800 font-medium placeholder:text-gray-400 focus:outline-indigo-500 shadow-2xs"
                                  autoFocus
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                <div className="p-4 border border-gray-200 rounded-2xl space-y-2">
                  <label className="block text-xs font-semibold text-slate-700">ยานพาหนะครอบครอง</label>
                  <select
                    value={vehicleType}
                    onChange={(e) => {
                      setVehicleType(e.target.value as any);
                      setVehicleBrand(''); // Reset brand when changing vehicle type
                    }}
                    className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-700"
                  >
                    <option value="none">ไม่มีพาหนะ</option>
                    <option value="motorcycle">รถจักรยานยนต์</option>
                    <option value="car">รถยนต์ส่วนบุคคล</option>
                    <option value="bicycle">รถจักรยาน</option>
                  </select>
                  {vehicleType === 'bicycle' && (
                    <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                      <input
                        type="text"
                        placeholder="ยี่ห้อ / สี / จุดสังเกตของจักรยาน"
                        value={vehicleBrand}
                        onChange={(e) => setVehicleBrand(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                      />
                    </div>
                  )}
                  {vehicleType !== 'none' && vehicleType !== 'bicycle' && (
                    <div className="flex flex-col gap-2 pt-1 animate-in slide-in-from-top-1">
                      <input
                        type="text"
                        placeholder="เลขทะเบียน"
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                      />
                      <select
                        value={vehicleBrand}
                        onChange={(e) => setVehicleBrand(e.target.value)}
                        className="px-2 py-1 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                      >
                        <option value="">-- เลือกยี่ห้อ --</option>
                        {vehicleType === 'car' && CAR_BRANDS.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                        {vehicleType === 'motorcycle' && MOTO_BRANDS.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                        {vehicleBrand && !(vehicleType === 'car' ? CAR_BRANDS : MOTO_BRANDS).includes(vehicleBrand) && (
                          <option value={vehicleBrand}>{vehicleBrand}</option>
                        )}
                      </select>
                    </div>
                  )}
                </div>
              </div>

            </div>
          )}

          {/* Step 2: Room Assignation */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">กรุณาเลือกห้องเช่าที่จะเข้าพัก (แสดงเฉพาะห้องว่าง) *</label>
              <select
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-700 font-bold"
              >
                <option value="">-- กรุณาเลือกห้องเช่า --</option>
                {[...rooms.filter(r => r.status === 'vacant')]
                  .sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true }))
                  .map(r => (
                    <option key={r.id} value={r.id}>{formatOwnerRoomOptionLabel(r, localBuildings)}</option>
                  ))}
              </select>

              {selectedRoomId && (
                <div className="p-4 bg-emerald-50 border border-emerald-150 rounded-2xl text-xs text-emerald-950 space-y-1 animate-in zoom-in-95">
                  <p className="font-bold">สรุปภาระการจ่ายเงินแรกเข้า:</p>
                  <p>&bull; ประกันความเสียหายห้องพัก: {formatBaht(rooms.find(r => r.id === selectedRoomId)?.depositAmount || 0)}</p>
                  <p>&bull; ค่าเช่าห้องล่วงหน้า 1 เดือน: {formatBaht(rooms.find(r => r.id === selectedRoomId)?.monthlyRent || 0)}</p>
                  <p className="font-extrabold text-indigo-700 mt-2">ยอดรวมจ่ายเงินมัดจำแรกเข้า: {formatBaht((rooms.find(r => r.id === selectedRoomId)?.depositAmount || 0) + (rooms.find(r => r.id === selectedRoomId)?.monthlyRent || 0))}</p>
                </div>
              )}
            </div>
          )}

          {/* Navigation buttons */}
          <div className="pt-4 border-t border-gray-100 flex justify-between">
            <button
              type="button"
              disabled={currentStep === 0}
              onClick={() => setCurrentStep(currentStep - 1)}
              className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-medium disabled:opacity-40"
            >
              ย้อนกลับ
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 rounded-xl text-xs font-medium"
              >
                ยกเลิก
              </button>
              {currentStep < 2 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-xl"
                >
                  ขั้นตอนถัดไป
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveTenant}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs rounded-xl"
                >
                  ยืนยันจดทะเบียนย้ายเข้า
                </button>
              )}
            </div>
          </div>

        </div>
      )}

      {/* Lease Termination Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isTerminateOpen}
          onClose={() => !isSuccessAnimating && setIsTerminateOpen(false)}
          title={
            <div className="flex items-center gap-2">
              <LogOut className="w-5 h-5 text-rose-600" />
              <span>ทำเรื่องเลิกเช่าคืนห้องพัก - ห้อง {getRoomNumber(selectedTenant.id)}</span>
            </div>
          }
          size="xl"
          transparentBg={isSuccessAnimating}
          hideHeader={isSuccessAnimating}
          footer={!isSuccessAnimating ? (
            <div className="flex items-center justify-between w-full">
              <div className="text-[11px] text-gray-500 hidden sm:block">
                ตรวจสอบรายการค่าใช้จ่ายและการหักเงินประกันก่อนกดยืนยัน
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsTerminateOpen(false)}
                  className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer transition-all"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmTerminate}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl cursor-pointer shadow-sm transition-all flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>ยืนยันการเลิกเช่าคืนห้องพัก</span>
                </button>
              </div>
            </div>
          ) : undefined}
        >
          <div className={`space-y-4 text-xs ${isSuccessAnimating ? 'text-white' : 'text-slate-700'}`}>
            {isSuccessAnimating ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center justify-center py-12 px-4 space-y-5 text-center min-h-[350px]"
              >
                <div className="relative">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [0, 1.2, 1] }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl shadow-emerald-500/50"
                  >
                    <motion.svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={4.5}
                      stroke="currentColor"
                      className="w-12 h-12 text-white"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.4, delay: 0.3, ease: "easeInOut" }}
                    >
                      <motion.path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </motion.svg>
                  </motion.div>
                  <motion.div
                    className="absolute -inset-4 bg-emerald-500/30 rounded-full -z-10"
                    animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0, 0.6] }}
                    transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  />
                </div>
                <div className="space-y-2">
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.3 }}
                    className="font-extrabold text-2xl text-white tracking-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                  >
                    ทำเรื่องเลิกเช่าสำเร็จ!
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.7, duration: 0.3 }}
                    className="text-sm text-emerald-100 max-w-sm leading-relaxed font-semibold drop-shadow-[0_1px_4px_rgba(0,0,0,0.3)]"
                  >
                    ระบบทำการคืนห้องพักห้อง {getRoomNumber(selectedTenant.id)} และอัปเดตสถานะสัญญาเรียบร้อยแล้ว
                  </motion.p>
                </div>
              </motion.div>
            ) : (
              <>
                {(() => {
                  const tContracts = (contracts || []).filter(c => c.tenantId === selectedTenant.id);
                  const activeCon = tContracts.find(c => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'checking_out') || tContracts[0];
                  const rm = rooms.find(r => r.currentTenantId === selectedTenant.id || r.id === activeCon?.roomId);
                  const origDeposit = activeCon?.depositAmount ?? rm?.depositAmount ?? 0;
                  const depFinancial = getDepositFinancialState(activeCon?.id, bills, origDeposit);
                  const actualPaidDeposit = depFinancial.actualPaidDeposit;
                  const hasPaidDeposit = depFinancial.isPaid && actualPaidDeposit > 0;
                  const totalDeductions = deductionItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
                  const netRefund = hasPaidDeposit && refundDeposit ? Math.max(0, actualPaidDeposit - totalDeductions) : 0;
                  const netExcess = hasPaidDeposit && refundDeposit ? Math.max(0, totalDeductions - actualPaidDeposit) : totalDeductions;

                  const PRESET_DEDUCTIONS = [
                    { title: 'ค่าทำความสะอาดห้องพัก' },
                    { title: 'ค่าน้ำประปาค้างชำระ' },
                    { title: 'ค่าไฟฟ้าค้างชำระ' },
                    { title: 'ค่าล้างเครื่องปรับอากาศ' },
                    { title: 'ค่าซ่อมแซม/ทาสีผนัง' },
                    { title: 'ค่ากุญแจ/คีย์การ์ดสูญหาย' }
                  ];

                  const handleAddPreset = (preset: { title: string }) => {
                    setDeductionItems(prev => [
                      ...prev,
                      {
                        id: `deduct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        title: preset.title,
                        amount: ''
                      }
                    ]);
                  };

                  const handleAddCustom = () => {
                    setDeductionItems(prev => [
                      ...prev,
                      {
                        id: `deduct-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        title: '',
                        amount: ''
                      }
                    ]);
                  };

                  const handleUpdateItem = (id: string, field: 'title' | 'amount', val: string | number) => {
                    setDeductionItems(prev => prev.map(it => it.id === id ? { ...it, [field]: val } : it));
                  };

                  const handleRemoveItem = (id: string) => {
                    setDeductionItems(prev => prev.filter(it => it.id !== id));
                  };

                  return (
                    <div className="space-y-4">
                      {/* Section 1: Tenant & Stay Details */}
                      <div className="space-y-2.5 pb-4 border-b border-gray-100">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <h4 className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>ข้อมูลผู้เช่าและสัญญาห้อง {getRoomNumber(selectedTenant.id)}</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-slate-800 pt-0.5">
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">ชื่อผู้เช่า:</p>
                            <p className="font-extrabold text-xs mt-0.5 truncate">{selectedTenant.name}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">เบอร์โทรศัพท์:</p>
                            <p className="font-extrabold text-xs mt-0.5">{formatPhone(selectedTenant.phone)}</p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">วันที่เริ่มเข้าพัก:</p>
                            <p className="font-extrabold text-xs mt-0.5">
                              {activeCon ? formatThaiDate(activeCon.startDate) : (selectedTenant.createdAt ? formatThaiDate(selectedTenant.createdAt.split('T')[0]) : (selectedTenant.joinDate ? formatThaiDate(selectedTenant.joinDate) : '-'))}
                            </p>
                          </div>
                          <div>
                            <p className="text-gray-400 text-[10px] font-bold">ระยะเวลาที่อยู่อาศัย:</p>
                            <p className="font-extrabold text-xs text-indigo-700 mt-0.5">
                              {getStayDurationText(activeCon ? activeCon.startDate : (selectedTenant.createdAt ? selectedTenant.createdAt.split('T')[0] : (selectedTenant.joinDate || '')))}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Section 2: Deposit Refund Choice (การจัดการเงินประกัน - ย้ายขึ้นมาแทนที่) */}
                      <div className="space-y-3 pb-5 border-b border-gray-100">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Coins className="w-4 h-4 text-indigo-600" />
                            <span className="font-bold text-slate-800 text-xs sm:text-sm">การจัดการเงินประกัน</span>
                          </div>
                          <span className="text-xs font-extrabold text-slate-800">
                            {hasPaidDeposit ? (
                              <span>เงินประกันที่ชำระแล้ว: <span className="text-indigo-600">{formatBaht(actualPaidDeposit)}</span></span>
                            ) : (
                              <span className="text-slate-500">เงินประกันตามสัญญา: {formatBaht(origDeposit)}</span>
                            )}
                          </span>
                        </div>

                        {!hasPaidDeposit ? (
                          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <p className="font-bold text-xs text-amber-900">
                                ยังไม่มีเงินประกันที่ชำระแล้วให้จัดการ (ยอดชำระแล้ว: 0 บาท)
                              </p>
                              <p className="text-[11px] text-amber-700 leading-relaxed">
                                สัญญาห้องนี้ยังไม่มียอดเงินประกันที่ชำระเข้ามา ({formatBaht(origDeposit)}) จึงไม่สามารถเลือกคืนหรือยึดเงินประกันได้ หากมีค่าใช้จ่ายหรือค่าเสียหายเกิดขึ้น ผู้เช่าจะต้องชำระค่าใช้จ่ายทั้งหมดเต็มจำนวน
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Option 1: Refund Deposit (deduct from deposit) */}
                            <div
                              onClick={() => setRefundDeposit(true)}
                              className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${refundDeposit
                                ? 'border-emerald-500 bg-emerald-50/40 shadow-xs'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                                }`}
                            >
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${refundDeposit ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500'
                                      }`}>
                                      <ShieldCheck className="w-4 h-4" />
                                    </div>
                                    <span className="font-bold text-xs text-slate-900">
                                      คืนเงินประกัน (นำมาหักลดค่าใช้จ่าย)
                                    </span>
                                  </div>
                                  <input
                                    type="radio"
                                    name="refundDepositOption"
                                    checked={refundDeposit}
                                    onChange={() => setRefundDeposit(true)}
                                    className="text-emerald-600 focus:ring-emerald-500 w-4 h-4 pointer-events-none"
                                  />
                                </div>
                                <p className="text-[11px] text-gray-500 leading-relaxed pl-9">
                                  นำเงินประกันที่ชำระแล้ว ({formatBaht(actualPaidDeposit)}) มาหักลดค่าใช้จ่าย หากเงินประกันเหลือ ผู้เช่าจะได้รับเงินคืนหลังเลิกเช่า หากค่าใช้จ่ายเกิน ผู้เช่าจ่ายเฉพาะส่วนต่าง
                                </p>
                              </div>
                            </div>

                            {/* Option 2: Forfeit Deposit */}
                            <div
                              onClick={() => setRefundDeposit(false)}
                              className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${!refundDeposit
                                ? 'border-rose-500 bg-rose-50/40 shadow-xs'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                                }`}
                            >
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${!refundDeposit ? 'bg-rose-500 text-white' : 'bg-gray-100 text-gray-500'
                                      }`}>
                                      <ShieldAlert className="w-4 h-4" />
                                    </div>
                                    <span className="font-bold text-xs text-slate-900">
                                      ไม่คืนเงินประกัน (ยึดเงินประกัน)
                                    </span>
                                  </div>
                                  <input
                                    type="radio"
                                    name="refundDepositOption"
                                    checked={!refundDeposit}
                                    onChange={() => setRefundDeposit(false)}
                                    className="text-rose-600 focus:ring-rose-500 w-4 h-4 pointer-events-none"
                                  />
                                </div>
                                <p className="text-[11px] text-gray-500 leading-relaxed pl-9">
                                  ยึดเงินประกันทั้งหมดตามเงื่อนไข ผู้เช่าจะไม่ได้รับเงินประกันคืน และต้องชำระค่าใช้จ่ายที่เกิดขึ้นแยกต่างหากเต็มจำนวน
                                </p>
                              </div>
                            </div>
                          </div>
                        )}

                      </div>

                      {/* Section 3: Itemized Deductions (รายการค่าใช้จ่าย / ค่าเสียหายที่ต้องหักก่อนออก) */}
                      <div className="space-y-3 pb-5 border-b border-gray-100">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <Receipt className="w-4 h-4 text-indigo-600" />
                            <span className="font-bold text-slate-800 text-xs sm:text-sm">
                              รายการค่าใช้จ่าย / ค่าเสียหายที่ต้องหัก
                            </span>
                            <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                              {deductionItems.length} รายการ
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleAddCustom}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>เพิ่มรายการ</span>
                          </button>
                        </div>

                        {/* Quick Presets Chips */}
                        <div className="space-y-1.5 pt-0.5">
                          <span className="text-[10px] text-gray-400 font-semibold block">เลือกเพิ่มรายการด่วน:</span>
                          <div className="flex flex-wrap gap-1.5">
                            {PRESET_DEDUCTIONS.map((preset, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleAddPreset(preset)}
                                className="px-2.5 py-1 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-gray-200 hover:border-gray-300 rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                              >
                                <Plus className="w-3 h-3 text-gray-400" />
                                <span>{preset.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Deductions List */}
                        <div className="space-y-2 pt-1">
                          {deductionItems.length === 0 ? (
                            <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl text-gray-400 space-y-1">
                              <p className="font-medium text-xs">ยังไม่มีรายการค่าใช้จ่ายหรือค่าเสียหาย</p>
                              <p className="text-[10px] text-gray-400">คลิกที่รายการด่วนด้านบน หรือกดปุ่ม "เพิ่มรายการ" เพื่อระบุค่าใช้จ่าย</p>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {deductionItems.map((item, idx) => (
                                <div key={item.id} className="flex items-center gap-2 p-2.5 bg-slate-50 border border-gray-100 rounded-xl">
                                  <span className="text-[10px] font-bold text-gray-400 w-4 text-center shrink-0">
                                    {idx + 1}
                                  </span>
                                  <input
                                    type="text"
                                    value={item.title}
                                    onChange={(e) => handleUpdateItem(item.id, 'title', e.target.value)}
                                    placeholder="ชื่อรายการ เช่น ค่าทำความสะอาดห้องน้ำ, รอยเจาะผนัง"
                                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium text-slate-800 min-w-0"
                                  />
                                  <div className="flex items-center gap-1 w-32 sm:w-36 shrink-0">
                                    <input
                                      type="number"
                                      min="0"
                                      value={item.amount}
                                      onChange={(e) => handleUpdateItem(item.id, 'amount', e.target.value)}
                                      placeholder="0"
                                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 text-right font-bold text-slate-800"
                                    />
                                    <span className="text-[11px] text-gray-500 font-medium shrink-0">บาท</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveItem(item.id)}
                                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0"
                                    title="ลบรายการนี้"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {deductionItems.length > 0 && (
                            <div className="flex justify-between items-center px-3 py-2 bg-indigo-50/50 rounded-xl border border-indigo-100 font-bold text-xs">
                              <span className="text-slate-700">ยอดรวมค่าใช้จ่ายที่ต้องหักทั้งหมด:</span>
                              <span className="text-rose-600 text-sm font-extrabold">{formatBaht(totalDeductions)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Section 4: Live Real-time Settlement Summary (สรุปการคำนวณการเงิน) */}
                      <div className="bg-slate-50 border border-gray-200 rounded-2xl p-4 space-y-3">
                        <span className="font-bold text-slate-800 text-xs uppercase tracking-wider block">
                          สรุปยอดการเงินก่อนยืนยันเลิกเช่า
                        </span>

                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between items-center text-slate-600">
                            <span>เงินประกันสัญญา:</span>
                            <span className="font-bold text-slate-800">
                              {hasPaidDeposit ? `+${formatBaht(actualPaidDeposit)}` : '0 บาท'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-slate-600">
                            <span>ยอดรวมค่าใช้จ่าย ({deductionItems.length} รายการ):</span>
                            <span className="font-bold text-rose-600">
                              {totalDeductions > 0 ? `-${formatBaht(totalDeductions)}` : '0 บาท'}
                            </span>
                          </div>
                        </div>

                        {/* Result Highlight Box */}
                        {!hasPaidDeposit ? (
                          <div className="p-3.5 bg-rose-500/10 border border-rose-300 rounded-xl flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <Receipt className="w-5 h-5 text-rose-600 shrink-0" />
                              <div>
                                <p className="font-extrabold text-rose-950 text-xs sm:text-sm">
                                  {totalDeductions > 0 ? 'ผู้เช่าต้องชำระค่าใช้จ่ายทั้งหมด' : 'ไม่มีเงินประกันและไม่มีค่าใช้จ่ายค้างชำระ'}
                                </p>
                                <p className="text-[11px] text-rose-700 font-medium">
                                  {totalDeductions > 0
                                    ? 'ไม่มีเงินประกันที่ชำระแล้วนำมาหักลด ผู้เช่าต้องชำระยอดค่าใช้จ่ายเต็มจำนวน'
                                    : 'ไม่มีเงินประกันที่ต้องคืนหรือหัก และไม่มีค่าเสียหายที่ต้องชำระ'}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-rose-700 text-base sm:text-xl block">
                                {formatBaht(totalDeductions)}
                              </span>
                              <span className="text-[10px] text-rose-600 font-semibold">ยอดต้องชำระ</span>
                            </div>
                          </div>
                        ) : refundDeposit ? (
                          actualPaidDeposit >= totalDeductions ? (
                            <div className="p-3.5 bg-emerald-500/10 border border-emerald-300 rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-emerald-950 text-xs sm:text-sm">
                                    ผู้เช่าจะได้รับเงินคืนหลังเลิกเช่า
                                  </p>
                                  <p className="text-[11px] text-emerald-700 font-medium">
                                    เงินประกันหักค่าใช้จ่ายครบถ้วนแล้ว มียอดเงินประกันคงเหลือคืนให้ผู้เช่า
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-black text-emerald-700 text-base sm:text-xl block">
                                  +{formatBaht(actualPaidDeposit - totalDeductions)}
                                </span>
                                <span className="text-[10px] text-emerald-600 font-semibold">ยอดโอนคืนสุทธิ</span>
                              </div>
                            </div>
                          ) : (
                            <div className="p-3.5 bg-amber-500/10 border border-amber-300 rounded-xl flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5">
                                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                                <div>
                                  <p className="font-extrabold text-amber-950 text-xs sm:text-sm">
                                    เงินประกันช่วยลดค่าใช้จ่ายแล้ว (ผู้เช่าต้องชำระเพิ่ม)
                                  </p>
                                  <p className="text-[11px] text-amber-700 font-medium">
                                    นำเงินประกันที่ชำระแล้ว {formatBaht(actualPaidDeposit)} มาหักลดค่าใช้จ่ายจนหมด ผู้เช่าต้องชำระส่วนเกินเพิ่ม
                                  </p>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="font-black text-amber-800 text-base sm:text-xl block">
                                  {formatBaht(totalDeductions - actualPaidDeposit)}
                                </span>
                                <span className="text-[10px] text-amber-600 font-semibold">ออกบิลเรียกเก็บ</span>
                              </div>
                            </div>
                          )
                        ) : (
                          <div className="p-3.5 bg-rose-500/10 border border-rose-300 rounded-xl flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                              <div>
                                <p className="font-extrabold text-rose-950 text-xs sm:text-sm">
                                  ยึดเงินประกันทั้งหมด (ไม่คืนเงินประกัน)
                                </p>
                                <p className="text-[11px] text-rose-700 font-medium">
                                  ผู้เช่าไม่ได้รับเงินประกันคืน และต้องชำระยอดค่าใช้จ่ายทั้งหมด
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="font-black text-rose-700 text-base sm:text-xl block">
                                {formatBaht(totalDeductions)}
                              </span>
                              <span className="text-[10px] text-rose-600 font-semibold">ยอดต้องชำระ</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Edit Tenant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title={`แก้ไขข้อมูลผู้เช่า - ห้อง ${getRoomNumber(selectedTenant.id)}`}
          size="lg"
        >
          <form onSubmit={handleSaveEditTenant} className="space-y-4">
            {errorText && (
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold border border-rose-100">
                {errorText}
              </div>
            )}

            <div className="max-h-[480px] overflow-y-auto pr-1 space-y-4 pb-2">
              {/* Personal Info */}
              <div className="space-y-3">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-indigo-600" />
                  ข้อมูลผู้เช่าหลัก
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">ชื่อ-นามสกุล *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="citizenIdEdit" className="block text-[10px] font-bold text-slate-700">บัตรประจำตัวประชาชน</label>
                    <input
                      id="citizenIdEdit"
                      type="text"
                      maxLength={17}
                      value={formatCitizenIdInput(citizenId)}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (/[xX]/.test(val)) {
                          setCitizenId(val);
                        } else {
                          const clean = val.replace(/\D/g, '').slice(0, 13);
                          setCitizenId(clean);
                        }
                      }}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">เบอร์โทรศัพท์ติดต่อ *</label>
                    <input
                      type="tel"
                      required
                      maxLength={12}
                      value={formatPhoneInput(phone)}
                      onChange={(e) => {
                        const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                        setPhone(clean);
                      }}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[10px] font-bold text-slate-700">อีเมลติดต่อ (ถ้ามี)</label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                </div>
              </div>

              {/* Emergency Contact */}
              <div className="pt-4 border-t border-gray-100 space-y-3">
                <h4 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  ผู้ติดต่อกรณีฉุกเฉิน
                </h4>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="emergencyNameEdit" className="block text-[10px] font-bold text-slate-700">ชื่อผู้ติดต่อ *</label>
                    <input
                      id="emergencyNameEdit"
                      type="text"
                      value={emergencyName}
                      onChange={(e) => setEmergencyName(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="emergencyRelationEdit" className="block text-[10px] font-bold text-slate-700">ความสัมพันธ์</label>
                      <input
                        id="emergencyRelationEdit"
                        type="text"
                        value={emergencyRelation}
                        onChange={(e) => setEmergencyRelation(e.target.value)}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="emergencyPhoneEdit" className="block text-[10px] font-bold text-slate-700">เบอร์โทรศัพท์ *</label>
                      <input
                        id="emergencyPhoneEdit"
                        type="tel"
                        maxLength={12}
                        value={formatPhoneInput(emergencyPhone)}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                          setEmergencyPhone(clean);
                        }}
                        className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl bg-white text-slate-800 focus:outline-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Pets / Vehicles */}
              <div className="pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Pet Section */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-slate-700">ขอเลี้ยงสัตว์เลี้ยง</label>
                    {(() => {
                      const pPolicy = getEffectivePetPolicy(propertyDefaultsPolicy);
                      const isAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;
                      return isAllowed ? (
                        <span className="text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md">
                          อนุญาตตามเงื่อนไข
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-md">
                          ไม่อนุญาตให้เลี้ยง
                        </span>
                      );
                    })()}
                  </div>
                  {(() => {
                    return (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="hasPetEdit"
                            checked={hasPet}
                            onChange={(e) => {
                              setHasPet(e.target.checked);
                              if (e.target.checked && petsList.length === 0) {
                                setPetsList([{ id: `temp-pet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: '', name: '' }]);
                              }
                            }}
                            className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <label htmlFor="hasPetEdit" className="text-xs font-bold text-slate-700 cursor-pointer">ประสงค์เลี้ยงสัตว์</label>
                        </div>
                        {hasPet && (
                          <div className="space-y-2 pt-1 animate-in slide-in-from-top-1">
                            {petsList.map((petItem, idx) => (
                              <div key={petItem.id || idx} className="p-2.5 bg-slate-50/80 rounded-xl space-y-2 relative border border-slate-200/80">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                                    สัตว์เลี้ยงตัวที่ {idx + 1}
                                  </span>
                                  {petsList.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePet(idx)}
                                      className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
                                      title="ลบรายการนี้"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={petItem.type || ''}
                                    onChange={(e) => handlePetChange(idx, 'type', e.target.value)}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                                  >
                                    <option value="">-- ประเภท --</option>
                                    {(() => {
                                      const allowed = resolveAllowedPetOptions(getEffectivePetPolicy(propertyDefaultsPolicy));
                                      const hasSelected = allowed.some(a => a.id === petItem.type);
                                      const options = (!petItem.type || hasSelected)
                                        ? allowed
                                        : [{ id: petItem.type as any, label: CANONICAL_PET_GROUP_OPTIONS.find(c => c.id === petItem.type)?.label || petItem.type }, ...allowed];
                                      return options.map(opt => (
                                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                                      ));
                                    })()}
                                  </select>
                                  <input
                                    type="text"
                                    placeholder="ชื่อน้อง"
                                    value={petItem.name || ''}
                                    onChange={(e) => handlePetChange(idx, 'name', e.target.value)}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                                  />
                                </div>
                                {(petItem.type === 'อื่นๆ' || petItem.type === 'other') && (
                                  <div className="animate-in fade-in slide-in-from-top-1 space-y-1">
                                    <label className="block text-[10px] font-bold text-indigo-700">ระบุประเภทสัตว์เลี้ยง *</label>
                                    <input
                                      type="text"
                                      placeholder="ระบุประเภท เช่น เต่า, เม่นแคระ, กิ้งก่า, ชูการ์ไกลเดอร์"
                                      value={petItem.customType || ''}
                                      onChange={(e) => handlePetChange(idx, 'customType', e.target.value)}
                                      className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-lg text-xs text-slate-800 font-medium placeholder:text-gray-400 focus:outline-indigo-500 shadow-2xs"
                                      autoFocus
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={handleAddPet}
                              className="w-full py-1.5 border border-dashed border-rose-300 hover:border-rose-500 bg-rose-50/50 hover:bg-rose-50 text-rose-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>เพิ่มสัตว์เลี้ยงอีก 1 รายการ</span>
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

                {/* Vehicle Section */}
                <div className="space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="block text-xs font-bold text-slate-700">ยานพาหนะครอบครอง</label>
                  </div>
                  <div className="space-y-2">
                    {vehiclesList.map((vehItem, idx) => (
                      <div key={vehItem.id || idx} className="p-2.5 bg-slate-50/80 rounded-xl space-y-2 relative border border-slate-200/80">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            คันที่ {idx + 1}
                          </span>
                          {vehiclesList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveVehicle(idx)}
                              className="text-rose-500 hover:text-rose-700 p-0.5 rounded cursor-pointer"
                              title="ลบรายการนี้"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <select
                          value={vehItem.type}
                          onChange={(e) => handleVehicleChange(idx, 'type', e.target.value)}
                          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-700 font-bold"
                        >
                          {idx === 0 && <option value="none">ไม่มีพาหนะ</option>}
                          <option value="motorcycle">รถจักรยานยนต์</option>
                          <option value="car">รถยนต์ส่วนบุคคล</option>
                          <option value="bicycle">รถจักรยาน</option>
                        </select>
                        {vehItem.type === 'bicycle' && (
                          <div className="animate-in slide-in-from-top-1">
                            <input
                              type="text"
                              placeholder="ยี่ห้อ / สี / จุดสังเกตของจักรยาน"
                              value={vehItem.brand || ''}
                              onChange={(e) => handleVehicleChange(idx, 'brand', e.target.value)}
                              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                            />
                          </div>
                        )}
                        {vehItem.type !== 'none' && vehItem.type !== 'bicycle' && (
                          <div className="grid grid-cols-2 gap-2 animate-in slide-in-from-top-1">
                            <input
                              type="text"
                              placeholder="เลขทะเบียน"
                              value={vehItem.licensePlate || ''}
                              onChange={(e) => handleVehicleChange(idx, 'licensePlate', e.target.value)}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800"
                            />
                            <select
                              value={vehItem.brand || ''}
                              onChange={(e) => handleVehicleChange(idx, 'brand', e.target.value)}
                              className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-slate-800 font-medium"
                            >
                              <option value="">-- ยี่ห้อ --</option>
                              {vehItem.type === 'car' && CAR_BRANDS.map(b => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                              {vehItem.type === 'motorcycle' && MOTO_BRANDS.map(b => (
                                <option key={b} value={b}>{b}</option>
                              ))}
                              {vehItem.brand && !(vehItem.type === 'car' ? CAR_BRANDS : MOTO_BRANDS).includes(vehItem.brand) && (
                                <option value={vehItem.brand}>{vehItem.brand}</option>
                              )}
                            </select>
                          </div>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddVehicle}
                      className="w-full py-1.5 border border-dashed border-emerald-300 hover:border-emerald-500 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>เพิ่มยานพาหนะอีก 1 คัน</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* File Attachment / Document Upload */}
              <div className="space-y-2 pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    อัปโหลดรูปเอกสารประจำตัว (สำเนาบัตรประชาชน)
                  </label>
                </div>

                {idCardPhoto ? (
                  <div className="relative border border-slate-200 rounded-2xl p-2.5 bg-slate-50 space-y-2">
                    <div className="w-full flex items-center justify-center bg-white rounded-xl border border-slate-200/80 p-2 overflow-hidden shadow-2xs">
                      <img
                        src={idCardPhoto}
                        alt="เอกสารประจำตัว"
                        className="w-full h-auto max-h-[380px] object-contain rounded-lg"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1 px-1">
                      <label className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs">
                        <Upload className="w-3.5 h-3.5 text-indigo-600" />
                        <span>เปลี่ยน</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 hover:border-indigo-400 rounded-2xl p-6 hover:bg-indigo-50/10 transition-all relative cursor-pointer">
                    <div className="text-center space-y-1.5 text-gray-400 pointer-events-none">
                      <FileText className="w-9 h-9 text-indigo-400 mx-auto" />
                      <p className="text-xs font-bold text-slate-700">คลิกเพื่ออัปโหลด หรือลากไฟล์มาวาง</p>
                      <p className="text-[10px] text-gray-400">รองรับไฟล์ PNG, JPG, WEBP</p>
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Modal Buttons */}
            {(() => {
              const origPets = selectedTenant?.pets && selectedTenant.pets.length > 0
                ? selectedTenant.pets
                : (selectedTenant?.pet?.hasPet ? [{ type: selectedTenant.pet.type || '', name: selectedTenant.pet.name || '' }] : []);
              const currentPets = hasPet ? petsList.filter(p => (p.type && p.type.trim() !== '') || (p.name && p.name.trim() !== '')) : [];
              const petsChanged = JSON.stringify(origPets.map(p => ({ type: p.type || '', name: p.name || '' }))) !==
                JSON.stringify(currentPets.map(p => ({ type: p.type || '', name: p.name || '' })));

              const origVehicles = selectedTenant?.vehicles && selectedTenant.vehicles.length > 0
                ? selectedTenant.vehicles.filter(v => v.type !== 'none')
                : (selectedTenant?.vehicle && selectedTenant.vehicle.type !== 'none' ? [selectedTenant.vehicle] : []);
              const currentVehicles = vehiclesList.filter(v => v.type !== 'none');
              const vehiclesChanged = JSON.stringify(origVehicles.map(v => ({ type: v.type, plate: v.licensePlate || '', brand: v.brand || '' }))) !==
                JSON.stringify(currentVehicles.map(v => ({ type: v.type, plate: v.licensePlate || '', brand: v.brand || '' })));

              const origEmergency = (selectedTenant as any)?.emergencyContacts?.[0] || selectedTenant?.emergencyContact;
              const emergencyChanged =
                emergencyName.trim() !== (origEmergency?.name || '') ||
                emergencyRelation.trim() !== (origEmergency?.relationship || '') ||
                emergencyPhone.trim() !== (origEmergency?.phone || '');

              const isFormChanged = selectedTenant ? (
                name.trim() !== selectedTenant.name ||
                phone.trim() !== selectedTenant.phone ||
                email.trim() !== (selectedTenant.email || '') ||
                citizenId.trim() !== (selectedTenant.citizenId ?? '') ||
                emergencyChanged ||
                petsChanged ||
                vehiclesChanged ||
                Boolean(pendingIdCardFile)
              ) : false;

              return (
                <div className="sticky bottom-0 -mx-6 -mb-6 p-5 bg-white border-t border-gray-100 flex justify-end gap-2 z-20 rounded-b-3xl shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
                  <button
                    type="button"
                    onClick={() => setIsEditOpen(false)}
                    className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-50 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="submit"
                    disabled={!isFormChanged}
                    className={`px-5 py-2 font-bold text-xs rounded-xl shadow-sm transition-all ${isFormChanged
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer animate-in fade-in duration-200'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                      }`}
                  >
                    บันทึกการแก้ไข
                  </button>
                </div>
              );
            })()}
          </form>
        </Modal>
      )}

      {/* Approve Tenant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isApproveOpen}
          onClose={() => setIsApproveOpen(false)}
          title="ยืนยันอนุมัติและรับผู้เช่าเข้าพัก"
          size="lg"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-emerald-950">{selectedTenant.name}</h4>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    เบอร์โทร: {formatPhone(selectedTenant.phone)} • บัตรประชาชน: {formatCitizenId(selectedTenant.citizenId)}
                  </p>
                </div>
              </div>
              <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-xl border shrink-0 ${approveRentalType === 'DAILY'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                : approveRentalType === 'TERM'
                  ? 'bg-purple-100 text-purple-800 border-purple-300'
                  : 'bg-blue-100 text-blue-800 border-blue-300'
                }`}>
                {approveRentalType === 'DAILY' ? 'การเข้าพักรายวัน' : approveRentalType === 'TERM' ? 'สัญญาเช่ารายเทอม' : 'สัญญาเช่ารายเดือน'}
              </span>
            </div>

            <div className="space-y-3 pt-1">
              <div>
                <label htmlFor="approve-room-select" className="block text-xs font-bold text-slate-700 mb-1">
                  เลือกห้องพักที่ต้องการจัดสรร <span className="text-rose-500">*</span>
                </label>
                <select
                  id="approve-room-select"
                  value={approveRoomId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setApproveRoomId(rId);
                    const rm = rooms.find(r => r.id === rId);
                    if (rm) {
                      if (approveRentalType === 'DAILY') {
                        const rate = rm.dailyRent || 550;
                        setApproveDailyRate(String(rate));
                        setApproveRent(String(rate * approveDays));
                        setApproveDeposit(String(rm.deposit || 500));
                      } else if (approveRentalType === 'TERM') {
                        setApproveRent(String(rm.termRent || 22000));
                        setApproveDeposit(String(rm.termDeposit || rm.deposit || 5500));
                        setApproveEndDate(calculateContractEndDate(approveStartDate, approveDurationMonths));
                      } else {
                        setApproveRent(String(rm.price || rm.monthlyRent || 5000));
                        setApproveDeposit(String(rm.deposit || rm.monthlyDeposit || (rm.price * 2) || 10000));
                        setApproveEndDate(calculateContractEndDate(approveStartDate, approveDurationMonths));
                      }
                    }
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-semibold"
                >
                  <option value="">-- เลือกห้องพัก --</option>
                  {approvalRoomOptions.map(r => (
                    <option key={r.id} value={r.id}>
                      {formatOwnerRoomOptionLabel(r, localBuildings)}
                    </option>
                  ))}
                </select>
                {(() => {
                  const reqRoom = rooms.find(r => r.id === selectedTenant.requestedRoomId || r.roomNumber === selectedTenant.requestedRoomId);
                  if (!reqRoom) return null;
                  return (
                    <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-indigo-700 bg-indigo-50/70 border border-indigo-150 px-2.5 py-1 rounded-lg">
                      <span className="font-semibold">ห้องที่ผู้เช่าขอ:</span>
                      <strong className="font-bold">ห้อง {reqRoom.roomNumber}</strong>
                    </div>
                  );
                })()}
              </div>

              {/* Type-aware input fields */}
              {approveRentalType === 'DAILY' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่เข้าพัก (Check-in) *
                      </label>
                      <OwnerDateInput
                        value={approveStartDate}
                        onChange={(val) => {
                          setApproveStartDate(val);
                          if (val) {
                            const d = new Date(val);
                            d.setDate(d.getDate() + approveDays);
                            setApproveEndDate(d.toISOString().split('T')[0]);
                          }
                        }}
                        required
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        จำนวนวันที่พัก (วัน) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={approveDays}
                        onChange={(e) => {
                          const days = Math.max(1, Number(e.target.value) || 1);
                          setApproveDays(days);
                          if (approveStartDate) {
                            const d = new Date(approveStartDate);
                            d.setDate(d.getDate() + days);
                            setApproveEndDate(d.toISOString().split('T')[0]);
                          }
                          setApproveRent(String(days * Number(approveDailyRate)));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่ออก (Check-out) *
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[38px] flex items-center">
                        {approveEndDate ? isoToThaiBe(approveEndDate) : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่าต่อวัน (บาท) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveDailyRate}
                        onChange={(e) => {
                          const rate = Number(e.target.value) || 0;
                          setApproveDailyRate(String(rate));
                          setApproveRent(String(rate * approveDays));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 550"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่ารวมทั้งหมด (บาท)
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-extrabold min-h-[38px] flex items-center">
                        {formatBaht(Number(approveDailyRate) * approveDays)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        เงินประกัน / มัดจำ (บาท)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveDeposit}
                        onChange={(e) => setApproveDeposit(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        สถานะเงินประกัน
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('UNPAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'UNPAID'
                            ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ยังไม่ชำระ
                        </button>
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('PAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'PAID'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ชำระแล้ว
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : approveRentalType === 'TERM' ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่เริ่มสัญญา *
                      </label>
                      <OwnerDateInput
                        value={approveStartDate}
                        onChange={(val) => {
                          setApproveStartDate(val);
                          setApproveEndDate(calculateContractEndDate(val, approveDurationMonths));
                        }}
                        required
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ระยะเวลาตามเทอม (เดือน) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={approveDurationMonths}
                        onChange={(e) => {
                          const dur = Math.max(1, Number(e.target.value) || 1);
                          setApproveDurationMonths(dur);
                          setApproveEndDate(calculateContractEndDate(approveStartDate, dur));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่สิ้นสุดสัญญา *
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[38px] flex items-center">
                        {approveEndDate ? isoToThaiBe(approveEndDate) : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่าต่อเทอม (บาท) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveRent}
                        onChange={(e) => setApproveRent(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 22000"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่ารวมทั้งหมด (บาท)
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-extrabold min-h-[38px] flex items-center">
                        {formatBaht(Number(approveRent) || 0)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        เงินประกันห้อง (บาท) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveDeposit}
                        onChange={(e) => setApproveDeposit(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 5500"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        สถานะเงินประกัน
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('UNPAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'UNPAID'
                            ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ยังไม่ชำระ
                        </button>
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('PAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'PAID'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ชำระแล้ว
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่เริ่มสัญญา *
                      </label>
                      <OwnerDateInput
                        value={approveStartDate}
                        onChange={(val) => {
                          setApproveStartDate(val);
                          setApproveEndDate(calculateContractEndDate(val, approveDurationMonths));
                        }}
                        required
                        className="w-full"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ระยะเวลาสัญญา (เดือน) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        value={approveDurationMonths}
                        onChange={(e) => {
                          const dur = Math.max(1, Number(e.target.value) || 1);
                          setApproveDurationMonths(dur);
                          setApproveEndDate(calculateContractEndDate(approveStartDate, dur));
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        วันที่สิ้นสุดสัญญา *
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[38px] flex items-center">
                        {approveEndDate ? isoToThaiBe(approveEndDate) : '-'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่ารายเดือน (บาท) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveRent}
                        onChange={(e) => setApproveRent(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 5000"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ค่าเช่ารวมทั้งหมด (บาท)
                      </label>
                      <div className="px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-extrabold min-h-[38px] flex items-center">
                        {formatBaht((Number(approveRent) || 0) * approveDurationMonths)}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        เงินประกันห้อง (บาท) *
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={approveDeposit}
                        onChange={(e) => setApproveDeposit(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-600 bg-white text-slate-800 font-medium"
                        placeholder="เช่น 10000"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        สถานะเงินประกัน
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('UNPAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'UNPAID'
                            ? 'bg-amber-50 text-amber-800 border-amber-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ยังไม่ชำระ
                        </button>
                        <button
                          type="button"
                          onClick={() => setApproveDepositDeclaredStatus('PAID')}
                          className={`py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${approveDepositDeclaredStatus === 'PAID'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold shadow-xs'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                          ชำระแล้ว
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* ID-Card Document Section (0-1 file, PDF/JPG/PNG/WebP <= 5MB) */}
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <label className="block text-xs font-bold text-slate-800">
                  รูปเอกสารสำเนาบัตรประชาชน (ถ้ามี)
                </label>

                {/* Existing applicant ID document if present */}
                {(() => {
                  const existingDoc = approveAttachments?.find((att: any) =>
                    (att.name && (att.name.includes('บัตรประชาชน') || att.name.includes('citizen') || att.name.includes('id-card') || att.name.includes('id_card'))) ||
                    att.isIdCard
                  ) || ((selectedTenant as any).acceptanceSnapshot?.idCardDocument ? {
                    name: (selectedTenant as any).acceptanceSnapshot.idCardDocument.originalFilename || 'สำเนาบัตรประชาชน.pdf',
                    type: (selectedTenant as any).acceptanceSnapshot.idCardDocument.mimeType || 'application/pdf',
                    size: (selectedTenant as any).acceptanceSnapshot.idCardDocument.byteSize,
                    url: `/api/v1/tenant-registrations/${(selectedTenant as any).registrationRequestId || selectedTenant.id}/identity-document`
                  } : null);

                  const showUploadZone = !existingDoc || isReplacingIdDoc || approveIdCardFile;

                  return (
                    <div className="space-y-2.5">
                      {existingDoc && (
                        <div className="space-y-2">
                          <InlineIdDocumentPreview
                            url={existingDoc.url || `/api/v1/tenant-registrations/${(selectedTenant as any).registrationRequestId || selectedTenant.id}/identity-document`}
                            filename={existingDoc.name || 'สำเนาบัตรประชาชน'}
                            mimeType={existingDoc.type || 'application/pdf'}
                            byteSize={existingDoc.size}
                            dormitoryId={dormitoryId}
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setIsReplacingIdDoc(!isReplacingIdDoc);
                                if (isReplacingIdDoc) {
                                  setApproveIdCardFile(null);
                                  setApproveIdCardPreview(null);
                                  setApproveIdCardError(null);
                                }
                              }}
                              className="px-3 py-1 bg-slate-100 hover:bg-indigo-50 text-slate-700 hover:text-indigo-600 border border-slate-200 hover:border-indigo-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                              <span>{isReplacingIdDoc ? 'ยกเลิกการเปลี่ยน' : 'เปลี่ยน'}</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Owner 0 or 1 ID Document Upload Zone */}
                      {showUploadZone && (
                        <div>
                          {!approveIdCardFile ? (
                            <label className="border-2 border-dashed border-slate-200 hover:border-indigo-400 bg-slate-50/60 hover:bg-indigo-50/30 rounded-2xl p-3.5 flex flex-col items-center justify-center cursor-pointer transition-all group">
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0] || null;
                                  if (f) {
                                    if (f.size > 5 * 1024 * 1024) {
                                      setApproveIdCardError('ขนาดไฟล์ต้องไม่เกิน 5 MB');
                                      e.target.value = '';
                                      return;
                                    }
                                    setApproveIdCardError(null);
                                    setApproveIdCardFile(f);
                                    if (f.type.startsWith('image/')) {
                                      setApproveIdCardPreview(URL.createObjectURL(f));
                                    } else {
                                      setApproveIdCardPreview(null);
                                    }
                                  }
                                }}
                              />
                              <div className="flex items-center gap-2 text-slate-500 group-hover:text-indigo-600">
                                <ImageIcon className="w-4 h-4" />
                                <span className="text-xs font-bold">{existingDoc ? 'แนบเอกสารสำเนาบัตรประชาชนใหม่ (JPG, PNG, WebP, PDF)' : 'แนบเอกสารสำเนาบัตรประชาชน (JPG, PNG, WebP, PDF)'}</span>
                              </div>
                              <span className="text-[10px] text-slate-400 mt-0.5">สูงสุด 1 ไฟล์ ขนาดไม่เกิน 5 MB (ไม่บังคับ)</span>
                            </label>
                          ) : (
                            <div className="flex items-center justify-between p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {approveIdCardPreview ? (
                                  <img
                                    src={approveIdCardPreview}
                                    alt="ID Card Preview"
                                    className="w-10 h-10 object-cover rounded-xl border border-indigo-200 shrink-0"
                                  />
                                ) : (
                                  <FileText className="w-8 h-8 text-indigo-600 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-800 truncate">{approveIdCardFile.name}</p>
                                  <p className="text-[10px] text-slate-500">{(approveIdCardFile.size / 1024).toFixed(0)} KB</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setApproveIdCardFile(null);
                                  setApproveIdCardPreview(null);
                                  setApproveIdCardError(null);
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors shrink-0 cursor-pointer"
                                title="ลบไฟล์"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {approveIdCardError && (
                  <p className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {approveIdCardError}
                  </p>
                )}
              </div>
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsApproveOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-3xs"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                data-testid="reject-from-approve-btn"
                onClick={() => {
                  setIsApproveOpen(false);
                  setIsRejectOpen(true);
                }}
                className="px-4 py-2 border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-3xs"
              >
                <XCircle className="w-4 h-4 text-rose-500" />
                <span>ปฏิเสธคำขอ</span>
              </button>
              <button
                type="button"
                data-testid="confirm-approve-tenant-btn"
                onClick={handleConfirmApprove}
                disabled={!approveRoomId}
                className={`px-5 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${approveRoomId
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>ยืนยันอนุมัติและรับผู้เช่าเข้าพัก</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Daily Stay Extension Modal */}
      {isDailyExtendOpen && dailyExtendTenant && (
        <Modal
          isOpen={isDailyExtendOpen}
          onClose={() => {
            setIsDailyExtendOpen(false);
            setDailyExtendTenant(null);
          }}
          title="ขยายระยะเวลาเข้าพักรายวัน"
          size="md"
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-emerald-50/80 border border-emerald-200/80 rounded-2xl flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base shrink-0">
                <Calendar className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-emerald-950">ขยายวันเข้าพัก: คุณ{dailyExtendTenant.name}</h4>
                <p className="text-[11px] text-emerald-700 mt-0.5">
                  ห้องพัก: {getRoomNumber(dailyExtendTenant.id)} • อัตราค่าห้องรายวัน: {formatBaht(dailyExtendRate)}/วัน
                </p>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">วันเช็คเอาท์ปัจจุบัน:</span>
                <strong className="text-slate-800 font-bold">{formatThaiDate(dailyExtendCurrentCheckOut) || dailyExtendCurrentCheckOut || 'วันนี้'}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">วันเช็คเอาท์ใหม่:</span>
                <strong className="text-emerald-700 font-bold">{formatThaiDate(dailyExtendNewCheckOut) || dailyExtendNewCheckOut}</strong>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  จำนวนวันที่ต้องการขยาย (วัน) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={dailyExtendDays}
                  onChange={(e) => {
                    const days = Math.max(1, Number(e.target.value) || 1);
                    setDailyExtendDays(days);
                    const baseDate = dailyExtendCurrentCheckOut ? new Date(dailyExtendCurrentCheckOut) : new Date();
                    const newDate = new Date(baseDate);
                    newDate.setDate(newDate.getDate() + days);
                    setDailyExtendNewCheckOut(newDate.toISOString().split('T')[0]);
                    setDailyExtendTotal(days * dailyExtendRate);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  อัตราค่าบริการต่อวัน (บาท)
                </label>
                <input
                  type="number"
                  min={0}
                  value={dailyExtendRate}
                  onChange={(e) => {
                    const r = Number(e.target.value) || 0;
                    setDailyExtendRate(r);
                    setDailyExtendTotal(dailyExtendDays * r);
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white font-semibold focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="p-3 bg-indigo-50/50 rounded-2xl border border-indigo-100 flex items-center justify-between text-xs">
              <span className="font-bold text-indigo-900">ค่าบริการเพิ่มเติมทั้งหมด:</span>
              <span className="font-extrabold text-sm text-indigo-700">{formatBaht(dailyExtendTotal)}</span>
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsDailyExtendOpen(false);
                  setDailyExtendTenant(null);
                }}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmDailyExtend}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
              >
                <Calendar className="w-4 h-4" />
                <span>ยืนยันขยายเวลาเข้าพัก</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Preview Attachment Modal */}
      {previewAttachmentUrl && (
        <Modal
          isOpen={!!previewAttachmentUrl}
          onClose={() => setPreviewAttachmentUrl(null)}
          title={previewAttachmentTitle || 'ดูตัวอย่างเอกสารแนบ'}
          size="md"
        >
          <div className="space-y-4">
            <div className="p-3 bg-slate-100 rounded-2xl flex items-center justify-center min-h-[260px] max-h-[460px] overflow-auto">
              <img
                src={previewAttachmentUrl}
                alt={previewAttachmentTitle}
                className="max-w-full max-h-[420px] object-contain rounded-xl shadow-xs"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setPreviewAttachmentUrl(null)}
                className="px-4 py-2 bg-slate-900 text-white font-bold text-xs rounded-xl hover:bg-slate-800 transition-all cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Tenant Modal / Responsive Bottom Sheet */}
      {selectedTenant && (
        <TenantRejectSheet
          isOpen={isRejectOpen}
          onClose={() => {
            setIsRejectOpen(false);
            setIsApproveOpen(true);
          }}
          tenant={{
            name: selectedTenant.name,
            phone: selectedTenant.phone,
            roomNumber: rooms.find(r => r.id === approveRoomId)?.roomNumber || selectedTenant.roomNumber,
          }}
          onConfirm={async (reason) => {
            setRejectReason(reason);
            await handleConfirmReject(reason);
          }}
        />
      )}

      {/* Modal: Print Contract Preview */}
      {isPrintContractModalOpen && selectedContractForPrint && (
        <Modal
          isOpen={isPrintContractModalOpen}
          onClose={() => {
            setIsPrintContractModalOpen(false);
            setSelectedContractForPrint(null);
          }}
          title={`พิมพ์สัญญาเช่าเลขที่ ${selectedContractForPrint.contractNumber}`}
          size="lg"
        >
          <div className="space-y-4">
            <PrintView title="หนังสือสัญญาเช่าห้องพัก">
              {(() => {
                const conTenant = tenants.find(t => t.id === selectedContractForPrint.tenantId) || selectedTenant;
                const conRoom = rooms.find(r => r.id === selectedContractForPrint.roomId || r.roomNumber === selectedContractForPrint.roomId);
                const tenantName = conTenant ? conTenant.name : 'ผู้เช่า';
                const roomNum = conRoom ? conRoom.roomNumber : selectedContractForPrint.roomId;
                const createdDate = selectedContractForPrint.createdAt ? selectedContractForPrint.createdAt.split('T')[0] : selectedContractForPrint.startDate;

                const dormName = dorm?.name || 'หอพัก';
                const dormAddress = [
                  dorm.addressLine1,
                  dorm.subdistrict ? `ต.${dorm.subdistrict}` : '',
                  dorm.district ? `อ.${dorm.district}` : '',
                  dorm.province ? `จ.${dorm.province}` : '',
                ].filter(Boolean).join(' ') || (dorm as any).address || '-';
                const resolvedLandlord = resolveLandlordSignerName(paymentSettings);
                const dormOwner = resolvedLandlord || dorm?.name || 'ผู้ให้เช่า';

                const isTermContract = selectedContractForPrint.rentBillingType === 'term' || (selectedContractForPrint as any).rentalType === 'TERM' || (selectedContractForPrint as any).rentalPlan === 'term';

                return (
                  <div className="space-y-6 text-xs text-slate-800 font-sans max-w-2xl mx-auto leading-relaxed bg-white p-4 sm:p-6 rounded-2xl">
                    <div className="text-center space-y-1 pb-4 border-b border-slate-100">
                      <h3 className="text-base font-extrabold text-slate-950 uppercase tracking-wide">หนังสือสัญญาเช่าที่พักอาศัย</h3>
                      <p className="text-slate-400 font-medium text-[10px]">สัญญาเลขที่: {selectedContractForPrint.contractNumber} &bull; อาคารหอพัก {dormName}</p>
                    </div>

                    <div className="space-y-4">
                      <p>
                        สัญญาฉบับนี้ทำขึ้น ณ <span className="font-extrabold text-slate-900">อาคารหอพัก {dormName} ({dormAddress})</span> เมื่อวันที่ <span className="font-semibold">{formatThaiDate(createdDate)}</span> ระหว่าง
                        <span className="font-extrabold text-slate-900"> นิติบุคคล {dormName} (ผู้ให้เช่า)</span> โดย <span className="font-bold text-slate-900">{dormOwner}</span> ฝ่ายหนึ่ง กับ
                        <span className="font-extrabold text-slate-900"> คุณ{tenantName} (ผู้เช่า)</span> อีกฝ่ายหนึ่ง โดยมีใจความดังเงื่อนไขต่อไปนี้:
                      </p>

                      <div className="bg-slate-50 p-4 border border-slate-100 rounded-2xl space-y-2.5">
                        <p>&bull; <span className="font-bold">ห้องพักตกลงเช่า:</span> ผู้เช่าตกลงเช่าห้องพักหมายเลข <span className="font-extrabold text-indigo-600">ห้อง {roomNum}</span> ของอาคาร</p>
                        <p>&bull; <span className="font-bold">ระยะเวลาสัญญาเช่า:</span> กำหนดเช่าอาศัย <span className="font-bold">{selectedContractForPrint.durationMonths} เดือน</span> เริ่มต้นตั้งแต่วันที่ <span className="font-bold">{formatThaiDate(selectedContractForPrint.startDate)}</span> ถึง วันที่ <span className="font-bold">{formatThaiDate(selectedContractForPrint.endDate)}</span></p>
                        <p>&bull; <span className="font-bold">ค่าเช่าและเงินประกัน:</span> {isTermContract ? 'อัตราค่าบริการเช่าเทอมละ' : 'อัตราค่าบริการเช่าเดือนละ'} <span className="font-bold text-slate-900">{formatBaht(selectedContractForPrint.rentAmount)}</span> พร้อมกับระบุเงินประกันความเสียหายแรกเข้าจำนวน <span className="font-bold">{formatBaht(selectedContractForPrint.depositAmount)}</span> ({selectedContractForPrint.depositType === 'deduct_rent' ? 'ไปหักกับค่าเช่า' : 'คืนเมื่อสิ้นสุดสัญญา'})</p>
                        {Number(selectedContractForPrint.advancePaymentAmount) > 0 ? (
                          <p>&bull; <span className="font-bold">ค่าเช่าล่วงหน้า:</span> ชำระล่วงหน้าจำนวน <span className="font-bold">{formatBaht(selectedContractForPrint.advancePaymentAmount)}</span></p>
                        ) : null}
                      </div>

                      <div className="space-y-1">
                        <p className="font-bold text-slate-950">ข้อตกลงและระเบียบโครงการเพิ่มเติม:</p>
                        <p className="whitespace-pre-line text-slate-500 pl-2 leading-relaxed bg-slate-50/50 p-3 rounded-xl border border-slate-100">{selectedContractForPrint.terms || 'ปฏิบัติตามระเบียบหอพักมาตรฐาน'}</p>
                      </div>
                    </div>

                    {/* Signatures */}
                    <div className="grid grid-cols-2 gap-8 pt-8 border-t border-dashed border-slate-200 text-center">
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ ผู้เช่าห้องพัก</p>
                        {(() => {
                          const tSig = (selectedContractForPrint.tenantSignature && (selectedContractForPrint.tenantSignature.startsWith('http') || selectedContractForPrint.tenantSignature.startsWith('data:') || selectedContractForPrint.tenantSignature.startsWith('/api/')))
                            ? selectedContractForPrint.tenantSignature
                            : (selectedContractForPrint.tenantSignature && dorm?.id ? `/api/v1/dormitories/${dorm.id}/contracts/${selectedContractForPrint.id}/tenant-signature` : null);
                          return (
                            <>
                              {tSig ? (
                                <img
                                  src={tSig}
                                  alt="ลายเซ็นผู้เช่า"
                                  className="h-10 mx-auto object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="h-10" />
                              )}
                            </>
                          );
                        })()}
                        <p className="font-extrabold text-slate-800 text-xs">(คุณ{tenantName})</p>
                      </div>

                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-400 font-bold uppercase">ลงชื่อ นิติหอพัก / ผู้ให้เช่า</p>
                        {(() => {
                          const oSig = (selectedContractForPrint.ownerSignature && (selectedContractForPrint.ownerSignature.startsWith('http') || selectedContractForPrint.ownerSignature.startsWith('data:') || selectedContractForPrint.ownerSignature.startsWith('/api/')))
                            ? selectedContractForPrint.ownerSignature
                            : (dorm?.id ? (selectedContractForPrint.ownerSignature ? `/api/v1/dormitories/${dorm.id}/contracts/${selectedContractForPrint.id}/owner-signature` : `/api/v1/dormitories/${dorm.id}/signature`) : null);
                          return (
                            <>
                              {oSig ? (
                                <img
                                  src={oSig}
                                  alt="ลายเซ็นผู้ให้เช่า"
                                  className="h-10 mx-auto object-contain"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                              ) : (
                                <div className="h-10" />
                              )}
                            </>
                          );
                        })()}
                        <p className="font-extrabold text-slate-800 text-xs">{resolvedLandlord ? `(${resolvedLandlord})` : ''}</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </PrintView>
          </div>
        </Modal>
      )}

      {/* Modal: Edit Contract */}
      {isEditContractModalOpen && selectedContractForEdit && (
        <Modal
          isOpen={isEditContractModalOpen}
          onClose={() => {
            setIsEditContractModalOpen(false);
            setSelectedContractForEdit(null);
          }}
          title={`แก้ไขข้อความสัญญาเลขที่ ${selectedContractForEdit.contractNumber}`}
          size="md"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เริ่มต้นสัญญา *</label>
                <ThaiDatePicker
                  value={editContractStartDate}
                  onChange={(val) => {
                    setEditContractStartDate(val);
                    setEditContractEndDate(calculateContractEndDate(val, editContractDuration));
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ระยะเวลาสัญญา (เดือน)</label>
                <input
                  type="number"
                  min={1}
                  value={editContractDuration}
                  onChange={(e) => {
                    const dur = Number(e.target.value) || 1;
                    setEditContractDuration(dur);
                    setEditContractEndDate(calculateContractEndDate(editContractStartDate, dur));
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-none focus:border-indigo-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่สิ้นสุดสัญญา</label>
                <ThaiDatePicker
                  value={editContractEndDate}
                  onChange={(val) => setEditContractEndDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">อัตราค่าเช่า (บาท/เดือน) *</label>
                <CurrencyInput
                  value={editContractRent}
                  onChange={(val) => setEditContractRent(val)}
                  placeholder="เช่น 4000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">เงินประกัน / มัดจำ (บาท) *</label>
                <CurrencyInput
                  value={editContractDeposit}
                  onChange={(val) => setEditContractDeposit(val)}
                  placeholder="เช่น 8000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">สถานะเงินประกัน</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditContractDepositStatus('paid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositStatus === 'paid'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditContractDepositStatus('unpaid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositStatus === 'unpaid'
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">เงื่อนไขเงินประกัน</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditContractDepositType('refundable')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositType === 'refundable'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  คืนเมื่อสิ้นสุดสัญญา
                </button>
                <button
                  type="button"
                  onClick={() => setEditContractDepositType('deduct_rent')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${editContractDepositType === 'deduct_rent'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  ไปหักกับค่าเช่า
                </button>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">ข้อตกลงและระเบียบเพิ่มเติม</label>
              <textarea
                value={editContractTerms}
                onChange={(e) => setEditContractTerms(e.target.value)}
                rows={4}
                className="w-full p-3 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-indigo-600"
                placeholder="ระบุข้อตกลงและระเบียบสัญญาเช่าเพิ่มเติม..."
              />
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsEditContractModalOpen(false);
                  setSelectedContractForEdit(null);
                }}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveEditContract}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกการแก้ไขสัญญา</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Renew Contract */}
      {isRenewContractModalOpen && selectedContractForRenew && (
        <Modal
          isOpen={isRenewContractModalOpen}
          onClose={() => {
            setIsRenewContractModalOpen(false);
            setSelectedContractForRenew(null);
          }}
          title={`ต่ออายุสัญญาเช่า (${selectedContractForRenew.rentBillingType === 'term' || (selectedContractForRenew as any).rentalType === 'TERM' || selectedTenant?.rentalType === 'TERM' ? 'รายเทอม' : 'รายเดือน'})`}
          size="md"
        >
          {(() => {
            const isDailyContract = selectedContractForRenew.rentBillingType === 'daily' || selectedContractForRenew.durationMonths === 0;

            if (isDailyContract) {
              return (
                <div className="space-y-4 text-xs">
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900">
                    <p className="font-bold">การเข้าพักรายวัน ไม่ต้องทำสัญญาเช่าระยะยาว</p>
                    <p className="text-[11px] text-amber-700 mt-1">
                      การขยายเวลาเข้าพักรายวันสามารถจัดการผ่านระบบเช็คอิน/เช็คเอาท์รายวันได้โดยตรง
                    </p>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRenewContractModalOpen(false);
                        setSelectedContractForRenew(null);
                      }}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-all cursor-pointer"
                    >
                      ปิด
                    </button>
                  </div>
                </div>
              );
            }

            const targetRoomNum = getRoomNumber(selectedContractForRenew.tenantId);
            const isTerm = selectedContractForRenew.rentBillingType === 'term' ||
              (selectedContractForRenew as any).rentalType === 'TERM' ||
              selectedTenant?.rentalType === 'TERM';

            return (
              <div className="space-y-4">
                <div className="bg-slate-50 p-3 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500 font-medium">ห้อง:</span> <strong className="text-slate-800 font-bold">{targetRoomNum}</strong>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="text-slate-500 font-medium">ผู้เช่า:</span> <strong className="text-slate-800 font-bold">{selectedTenant?.name || 'ผู้เช่า'}</strong>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border ${isTerm ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                    {isTerm ? 'สัญญาเช่ารายเทอม' : 'สัญญาเช่ารายเดือน'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">วันที่เริ่มต้นสัญญา *</label>
                    <ThaiDatePicker
                      value={renewContractStartDate}
                      onChange={(val) => {
                        setRenewContractStartDate(val);
                        setRenewContractEndDate(calculateContractEndDate(val, renewContractMonths));
                      }}
                      className="w-full"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      {isTerm ? 'ระยะเวลาตามเทอม (เดือน)' : 'ระยะเวลาสัญญา (เดือน)'} *
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={renewContractMonths}
                      onChange={(e) => {
                        const dur = Number(e.target.value) || 1;
                        setRenewContractMonths(dur);
                        setRenewContractEndDate(calculateContractEndDate(renewContractStartDate, dur));
                      }}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold focus:outline-none focus:border-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">วันที่สิ้นสุดสัญญา (คำนวณอัตโนมัติ)</label>
                    <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold flex items-center h-[38px]">
                      {formatThaiDate(renewContractEndDate) || renewContractEndDate || '-'}
                    </div>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      {isTerm ? 'อัตราค่าเช่า (บาท/เทอม) *' : 'อัตราค่าเช่า (บาท/เดือน) *'}
                    </label>
                    <CurrencyInput
                      value={renewContractRentAmount}
                      onChange={(val) => setRenewContractRentAmount(val)}
                      placeholder="เช่น 4500"
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="p-4 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRenewContractModalOpen(false);
                      setSelectedContractForRenew(null);
                    }}
                    className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={handleExecuteRenewContract}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>ยืนยันต่อสัญญา</span>
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Modal: Create New Contract */}
      {isCreateContractModalOpen && (
        <Modal
          isOpen={isCreateContractModalOpen}
          onClose={() => setIsCreateContractModalOpen(false)}
          title={`จัดทำสัญญาเช่าใหม่ - คุณ${selectedTenant?.name || 'ผู้เช่า'}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-700 font-bold mb-1">ห้องพักที่เช่า *</label>
                <select
                  value={createContractRoomId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setCreateContractRoomId(rId);
                    const rm = rooms.find(r => r.id === rId);
                    if (rm) {
                      setCreateContractRent(rm.price || 4000);
                      setCreateContractDeposit(rm.deposit || rm.price * 2 || 8000);
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-600"
                >
                  <option value="">-- เลือกห้องพัก --</option>
                  {[...rooms]
                    .sort((a, b) => (a.roomNumber || '').localeCompare(b.roomNumber || '', undefined, { numeric: true }))
                    .map((rm) => (
                      <option key={rm.id} value={rm.id}>
                        {formatOwnerRoomOptionLabel(rm, localBuildings)}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">ระยะเวลาสัญญา (เดือน)</label>
                <div className="flex gap-1.5">
                  {[3, 6, 12].map((dur) => (
                    <button
                      key={dur}
                      type="button"
                      onClick={() => {
                        setCreateContractDuration(dur);
                        setCreateContractEndDate(calculateContractEndDate(createContractStartDate, dur));
                      }}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDuration === dur
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                      {dur} เดือน
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เริ่มต้นสัญญา *</label>
                <ThaiDatePicker
                  value={createContractStartDate}
                  onChange={(val) => {
                    setCreateContractStartDate(val);
                    setCreateContractEndDate(calculateContractEndDate(val, createContractDuration));
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่สิ้นสุดสัญญา</label>
                <ThaiDatePicker
                  value={createContractEndDate}
                  onChange={(val) => setCreateContractEndDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">วันที่เข้าพักจริง</label>
                <ThaiDatePicker
                  value={createContractStayDate}
                  onChange={(val) => setCreateContractStayDate(val)}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">อัตราค่าเช่า (บาท/เดือน) *</label>
                <CurrencyInput
                  value={createContractRent}
                  onChange={(val) => setCreateContractRent(val)}
                  placeholder="เช่น 4000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">เงินประกัน / มัดจำ (บาท) *</label>
                <CurrencyInput
                  value={createContractDeposit}
                  onChange={(val) => setCreateContractDeposit(val)}
                  placeholder="เช่น 8000"
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">สถานะเงินประกัน</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateContractDepositStatus('paid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositStatus === 'paid'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    จ่ายแล้ว
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateContractDepositStatus('unpaid')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositStatus === 'unpaid'
                      ? 'bg-rose-50 border-rose-300 text-rose-700'
                      : 'bg-slate-50 border-slate-200 text-slate-600'
                      }`}
                  >
                    ยังไม่จ่าย
                  </button>
                </div>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">เงื่อนไขเงินประกัน</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreateContractDepositType('refundable')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositType === 'refundable'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  คืนเมื่อสิ้นสุดสัญญา
                </button>
                <button
                  type="button"
                  onClick={() => setCreateContractDepositType('deduct_rent')}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer ${createContractDepositType === 'deduct_rent'
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600'
                    }`}
                >
                  ไปหักกับค่าเช่า
                </button>
              </div>
            </div>

            <div className="text-xs">
              <label className="block text-slate-700 font-bold mb-1">ข้อตกลงและระเบียบในสัญญา</label>
              <textarea
                value={createContractTerms}
                onChange={(e) => setCreateContractTerms(e.target.value)}
                rows={4}
                className="w-full p-3 border border-slate-200 rounded-xl bg-white text-xs font-medium text-slate-800 leading-relaxed resize-y focus:outline-none focus:border-indigo-600"
                placeholder="ระบุข้อตกลงและระเบียบสัญญาเช่า..."
              />
            </div>

            <div className="p-5 -mx-6 -mb-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-2 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsCreateContractModalOpen(false)}
                className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSaveNewContract}
                disabled={!createContractRoomId}
                className={`px-5 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm transition-all ${createContractRoomId
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกและสร้างสัญญาเช่า</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add Co-Occupant Modal */}
      {selectedTenant && (
        <Modal
          isOpen={isAddCoModalOpen}
          onClose={() => setIsAddCoModalOpen(false)}
          title={`เพิ่มผู้พักร่วม - คุณ${selectedTenant.name}`}
        >
          <form onSubmit={handleAddNewCoOccupant} className="space-y-4 text-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-slate-700 font-bold text-[11px]">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>ู้พักร่วม (คิดอัตรา บาท/คน)</span>
              </div>

              <div className="space-y-1.5">
                {/* DO / ถูกต้อง */}
                <div className="p-2.5 bg-emerald-50/90 border border-emerald-200 rounded-xl flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <div className="space-y-0.5 text-[11px] leading-snug">
                    <p className="font-bold text-emerald-950">
                      แจ้งและลงทะเบียนตามจริง
                    </p>
                    <p className="text-[10px] text-emerald-800 font-medium leading-relaxed">
                      เพื่อให้ระบบคำนวณค่าน้ำและค่าสาธารณูปโภคส่วนกลางได้ถูกต้องตามจำนวนคนจริง
                    </p>
                  </div>
                </div>

                {/* DONT / ผิดระเบียบ */}
                <div className="p-2.5 bg-rose-50/90 border border-rose-200 rounded-xl flex items-start gap-2.5">
                  <div className="w-4 h-4 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                    <X className="w-2.5 h-2.5 stroke-[3]" />
                  </div>
                  <div className="space-y-0.5 text-[11px] leading-snug">
                    <p className="font-bold text-rose-950">
                      ห้ามปกปิดหรือไม่แจ้งเข้าพัก
                    </p>
                    <p className="text-[10px] text-rose-800 font-medium leading-relaxed">
                      หากตรวจพบถือว่ามีเจตนาทุจริต/โกง มีโทษปรับและผิดสัญญาเช่าทันที
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                ชื่อ - นามสกุล ผู้พักร่วม <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="เช่น สมชาย ใจดี"
                value={newCoName}
                onChange={(e) => setNewCoName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                เบอร์โทรศัพท์มือถือ <span className="text-rose-500">*</span>
              </label>
              <input
                type="tel"
                required
                placeholder="เช่น 081-234-5678"
                maxLength={12}
                value={formatPhoneInput(newCoPhone)}
                onChange={(e) => {
                  const clean = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setNewCoPhone(clean);
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                สถานะ (ความสัมพันธ์) <span className="text-rose-500">*</span>
              </label>
              <select
                value={newCoRelationship}
                onChange={(e) => {
                  setNewCoRelationship(e.target.value);
                  if (e.target.value !== 'อื่นๆ') {
                    setNewCoCustomRelationship('');
                  }
                }}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-indigo-600 cursor-pointer"
              >
                {CO_OCCUPANT_RELATION_OPTIONS.map((rel) => (
                  <option key={rel} value={rel}>
                    {rel}
                  </option>
                ))}
              </select>
            </div>

            {newCoRelationship === 'อื่นๆ' && (
              <div className="animate-in fade-in slide-in-from-top-1 space-y-1.5 pt-0.5">
                <label className="block font-bold text-indigo-700 text-[11px]">
                  ระบุสถานะความสัมพันธ์ <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ผู้ช่วยงาน, เพื่อนร่วมงาน, ผู้ดูแล"
                  value={newCoCustomRelationship}
                  onChange={(e) => setNewCoCustomRelationship(e.target.value)}
                  className="w-full px-3 py-2 border border-indigo-200 bg-indigo-50/40 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:border-indigo-600"
                  autoFocus
                />
              </div>
            )}

            <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 -mx-6 -mb-6 p-4 bg-slate-50 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => setIsAddCoModalOpen(false)}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={!newCoName.trim() || !newCoPhone.trim() || (newCoRelationship === 'อื่นๆ' && !newCoCustomRelationship.trim())}
                className={`px-5 py-2 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 ${newCoName.trim() && newCoPhone.trim() && (newCoRelationship !== 'อื่นๆ' || newCoCustomRelationship.trim())
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>บันทึกเพิ่มผู้พักร่วม</span>
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Co-Occupant Confirmation Modal */}
      {selectedTenant && coToDelete && (
        <Modal
          isOpen={isDeleteCoModalOpen}
          onClose={() => {
            setIsDeleteCoModalOpen(false);
            setCoToDelete(null);
          }}
          title="ยืนยันการนำผู้พักร่วมออก"
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
              <div className="text-rose-900">
                <p className="font-bold">{coToDelete.name} ออกจากห้องพัก</p>
                <p className="text-[11px] text-rose-700 mt-0.5">
                  ระบบจะบันทึกประวัติการนำออก ({formatThaiDate(new Date().toISOString(), true)})
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold text-slate-700">
                เหตุผลหรือบันทึกเพิ่มเติม (ถ้ามี)
              </label>
              <input
                type="text"
                placeholder="เช่น แจ้งย้ายออก, สิ้นสุดการพักอาศัยร่วม"
                value={deleteCoReason}
                onChange={(e) => setDeleteCoReason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs bg-white text-slate-800 font-medium focus:outline-none focus:border-rose-600"
              />
            </div>

            <div className="pt-3 border-t border-gray-100 flex justify-end gap-2 -mx-6 -mb-6 p-4 bg-slate-50 rounded-b-3xl mt-4">
              <button
                type="button"
                onClick={() => {
                  setIsDeleteCoModalOpen(false);
                  setCoToDelete(null);
                }}
                className="px-4 py-2 border border-gray-200 bg-white hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleConfirmRemoveCoOccupant}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
              >
                <UserMinus className="w-4 h-4" />
                <span>ยืนยันการนำออกและบันทึกประวัติ</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Floating Contract Toast */}
      {contractToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-bounce">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{contractToast}</span>
        </div>
      )}

      {/* Canonical White-Fade Tenant Action Toast */}
      {tenantActionToast && (
        <div
          role="status"
          aria-live="polite"
          data-testid="tenant-action-toast"
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isTenantActionToastFading
            ? 'opacity-0 translate-y-3 pointer-events-none'
            : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{tenantActionToast}</span>
        </div>
      )}

      {/* Floating Copy / Info Toast */}
      {copySuccessToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-2"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{copySuccessToast}</span>
        </div>
      )}

    </div>
  );
};
