/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface CycleRates {
  waterUnitRate: number;
  waterBillingMode: 'unit' | 'person' | 'room';
  electricUnitRate: number;
  electricBillingMode: 'unit' | 'person' | 'room';
  commonFee: number;
  commonFeeMode: 'person' | 'room' | 'free';
  internetFee: number;
  internetFeeMode: 'person' | 'room' | 'free';
  parkingFee: number;
  parkingFeeMode: 'room' | 'free' | 'vehicle';
  lateFeeDaily: number;
  lateFeeType: 'per_day' | 'fixed_once' | 'free';
}

export interface Dormitory {
  id: string;
  name: string;
  address: string;
  phone: string;
  taxId?: string;
  promptPayType?: 'phone' | 'citizenId' | 'eWallet'; // DEPRECATED: payment is backend-authoritative
  promptPayNumber?: string; // DEPRECATED: payment is backend-authoritative
  promptPayName?: string; // DEPRECATED: payment is backend-authoritative
  bankName?: string; // DEPRECATED: payment is backend-authoritative
  bankAccountNumber?: string; // DEPRECATED: payment is backend-authoritative
  bankAccountName?: string; // DEPRECATED: payment is backend-authoritative
  billStyle: 'combined' | 'separated'; // E3: Combined bill or separate bills
  billingDay: number; // e.g., 25th of the month
  dueDay: number; // e.g., 5th of the next month
  lateFeeDaily: number; // fine per day
  lateFeeType?: 'per_day' | 'fixed_once' | 'free';
  parkingFee?: number;
  parkingFeeMode?: 'room' | 'free' | 'vehicle';
  waterUnitRate: number;
  electricUnitRate: number;
  waterMinCharge?: number;
  electricMinCharge?: number;
  waterServiceFee?: number;
  electricServiceFee?: number;
  waterBillingMode?: 'unit' | 'person' | 'room';
  electricBillingMode?: 'unit' | 'person' | 'room';
  commonFee?: number;
  commonFeeMode?: 'person' | 'room' | 'free';
  internetFee?: number;
  internetFeeMode?: 'person' | 'room' | 'free';
  ownerName?: string;
  ownerPhone?: string;
  ownerEmail?: string;
  ownerAddress?: string;
  ownerSignature?: string;
  rulesTemplate?: string;
  dormRules?: string;
  terms?: string;
  petPolicy?: {
    allowed: 'none' | 'conditional' | string;
    allowedTypes?: string[];
  };
  cycleSettings?: { [cycleId: string]: Partial<CycleRates> };
  createdAt: string;
  updatedAt: string;
}

export interface Building {
  id: string;
  name: string; // e.g. "อาคาร A", "อาคาร B"
  code?: string;
  floorsCount: number;
  description?: string;
  termMonths?: number;
  maxTermRentInstallments?: number;
  monthlyRent?: number;
  termRent?: number;
  dailyRent?: number;
  depositAmount?: number;
  monthlyDeposit?: number;
  termDeposit?: number;
  dailyDeposit?: number;
  securityDeposit?: number;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuickAddEffectiveRates {
  monthlyRent: number;
  termRent: number | null;
  dailyRent: number | null;
  depositAmount: number;
  monthlyDeposit?: number | null;
  termDeposit?: number | null;
  dailyDeposit?: number | null;
}

export interface QuickAddBuildingContext {
  id: string;
  name: string;
  termMonths?: number | null;
  maxTermRentInstallments?: number | null;
}

export interface QuickAddRoomContext {
  roomId: string;
  dormitoryId: string;
  roomNumber: string;
  buildingId?: string;
  effective: QuickAddEffectiveRates;
  building?: QuickAddBuildingContext | null;
  roomType?: string;
  floor?: number;
  currentCatalogRates?: Array<{ type: string; price: number; unit: string }>;
}

export type RoomStatus = 'vacant' | 'occupied' | 'reserved' | 'maintenance';

export interface CurrentOperationalActions {
  canSetMaintenance: boolean;
  maintenanceBlockReason: 'ACTIVE_OCCUPANCY' | 'ACTIVE_RESERVATION' | null;
}

export interface Room {
  id: string;
  roomNumber: string; // e.g., "101"
  buildingId?: string | null; // Some rooms may not have buildingId (unspecified)
  floor: number;
  derivedFloor?: number;
  monthlyRent: number;
  termRent?: number; // Rent per term (รายเทอม)
  dailyRent?: number; // Rent per day (รายวัน)
  rentCycle?: 'term' | 'monthly' | 'daily';
  termDeposit?: number;
  monthlyDeposit?: number;
  dailyDeposit?: number;
  depositAmount: number;
  depositStatus?: 'paid' | 'unpaid'; // Status of deposit payment (จ่ายแล้ว/ยังไม่จ่าย)
  parkingFee?: number;
  maxOccupants: number;
  initialWaterMeter: number;
  initialElectricMeter: number;
  amenities?: string[];
  status: RoomStatus;
  currentTenantId?: string;
  notes?: string;
  images: string[];
  version?: number;
  activeRentalSummary?: ActiveRentalSummary | null;
  currentOperationalActions?: CurrentOperationalActions | null;
  createdAt: string;
  updatedAt: string;
}

export interface CoOccupant {
  id: string;
  name: string;
  phone: string;
  relationship?: string;
  citizenId?: string;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
}

export interface Vehicle {
  type: 'car' | 'motorcycle' | 'none';
  licensePlate: string;
  brand?: string;
}

export interface Pet {
  hasPet: boolean;
  type?: string;
  name?: string;
}

export interface Tenant {
  id: string;
  name: string;
  phone: string;
  email: string;
  citizenId: string;
  idCardPhotoMock?: string; // base64 or placeholder url
  coOccupants: CoOccupant[];
  emergencyContact: EmergencyContact;
  vehicle: Vehicle;
  pet: Pet;
  rentalHistory: string[]; // Room history IDs
  status: 'active' | 'inactive' | 'pending';
  createdAt: string;
  updatedAt: string;
}

export type ContractStatus = 'draft' | 'pending_signature' | 'active' | 'approved_scheduled' | 'scheduled' | 'SCHEDULED' | 'expiring_soon' | 'expired' | 'terminated' | 'waiting_extension' | 'checking_out';

export interface Contract {
  id: string;
  contractNumber: string;
  tenantId: string;
  roomId: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
  durationMonths: number;
  rentAmount: number;
  depositAmount: number;
  depositStatus?: 'paid' | 'unpaid';
  depositType?: 'refundable' | 'deduct_rent';
  terms: string;
  tenantSignature?: string; // Base64 signature image
  ownerSignature?: string; // Base64 signature image
  tenantIdCardMock?: string;
  previousContractId?: string;
  status: ContractStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRenewalRequest {
  id: string;
  dormitoryId: string;
  tenantId: string;
  contractId: string;
  roomId: string;
  requestedDurationMonths: number;
  requestedStartDate: string;
  requestedEndDate: string;
  status: 'PENDING_OWNER_APPROVAL' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  rejectionReason?: string;
  createdContractId?: string;
  createdAt: string;
  updatedAt: string;
  tenant?: Tenant;
  contract?: Contract;
  room?: Room;
}

export interface DamageChargeItem {
  id: string;
  settlementId: string;
  description: string;
  amount: number;
  evidenceUrl?: string;
  isDeleted?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractSettlement {
  id: string;
  dormitoryId: string;
  tenantId: string;
  contractId: string;
  roomId: string;
  depositAmount: number;
  unpaidBillAmount: number;
  damageChargeTotal: number;
  netSettlement: number;
  settlementDirection: 'REFUND' | 'PAYMENT_DUE' | 'ZERO';
  settlementStatus: 'PENDING_REFUND' | 'REFUNDED' | 'PENDING_PAYMENT' | 'PAYMENT_RECEIVED' | 'CLOSED_ZERO';
  confirmedAt?: string;
  confirmedByUserId?: string;
  createdAt?: string;
  items: DamageChargeItem[];
}

export interface TenantNotice {
  id: string;
  dormitoryId: string;
  tenantId: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
}

export interface ContractRequest {
  id: string;
  tenantId: string;
  roomId: string;
  requestType: 'extension' | 'checkout';
  durationMonths?: number;
  desiredDate: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  adminComment?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeterReading {
  id: string;
  roomId: string;
  cycleId: string; // e.g., "2026-07"
  waterPrevious: number;
  waterCurrent: number;
  waterUnits: number;
  electricPrevious: number;
  electricCurrent: number;
  electricUnits: number;
  readDate: string;
  readerId: string;
  createdAt: string;
}

export type BillStatus = 'draft' | 'pending' | 'checking' | 'paid' | 'overdue' | 'rejected' | 'cancelled';

export interface CanonicalTierBreakdownItem {
  lowerExclusive: string;
  upperInclusive: string | null;
  billedUnits: string;
  rate: string;
  amount: string;
}

export interface CanonicalTieredBillItemMetadata {
  mode?: string;
  usageUnits?: string;
  tierBreakdown?: CanonicalTierBreakdownItem[];
  [key: string]: unknown;
}

export interface BillItem {
  id?: string;
  type?: string;
  code?: string | null;
  description: string;
  quantity?: number | string | null;
  unit?: string | null;
  unitPrice?: number | string | null;
  amount: number | string;
  category?: 'rent' | 'water' | 'electricity' | 'parking' | 'fine' | 'other' | 'discount' | string;
  metadata?: CanonicalTieredBillItemMetadata | null | Record<string, any>;
  displayOrder?: number;
}

export interface Bill {
  id: string;
  billNumber: string;
  cycleId: string; // "YYYY-MM" e.g. "2026-07"
  billingCycleId?: string;
  billKind?: 'MONTHLY_UTILITY' | 'DEPOSIT' | 'RENT' | string;
  outstandingAmount?: number | string;
  paidAmount?: number | string;
  subtotal?: number | string;
  roomId: string;
  tenantId: string;
  items: BillItem[];
  totalAmount: number;
  dueDate: string;
  status: BillStatus;
  waterReadingId?: string;
  electricReadingId?: string;
  rejectReason?: string;
  paymentMethod?: 'promptpay' | 'cash';
  paidAt?: string;
  slipImage?: string;
  Payment?: Array<{
    id?: string;
    status: string;
    amount?: number | string;
    paymentDate?: string | null;
    metadata?: Record<string, any> | null;
  }>;
  createdAt: string;
  updatedAt: string;
}




export type MaintenanceStatus = 'submitted' | 'accepted' | 'more_info' | 'scheduled' | 'inprogress' | 'waiting_parts' | 'completed' | 'cancelled';
export type MaintenanceUrgency = 'low' | 'medium' | 'high' | 'emergency';

export interface MaintenanceUpdate {
  id: string;
  status: MaintenanceStatus;
  note: string;
  updatedBy: string;
  updatedAt: string;
  image?: string;
}

export interface MaintenanceRequest {
  id: string;
  requestNumber?: string;
  tenantId?: string;
  roomId?: string;
  category?: 'electric' | 'plumbing' | 'aircon' | 'lock' | 'internet' | 'furniture' | 'common' | 'other';
  title: string;
  description: string;
  imageBefore?: string; // Base64 or placeholder URL
  imageAfter?: string; // Base64 or placeholder URL
  urgency: MaintenanceUrgency;
  preferredDate?: string;
  preferredTimeSlot?: 'morning' | 'afternoon' | 'any';
  contactPhone?: string;
  allowEntryWhenAbsent?: boolean;
  assignedTechnicianId?: string;
  status: MaintenanceStatus;
  updates?: MaintenanceUpdate[];
  rating?: number; // 1-5 stars
  ratingFeedback?: string;
  createdAt: string;
  updatedAt: string;
  priority?: 'low' | 'medium' | 'high';
  assignedStaff?: string;
  cost?: number;
  note?: string;
}

export interface Announcement {
  id: string;
  title: string;
  summary: string;
  content: string;
  type: 'general' | 'water_off' | 'electric_off' | 'maintenance' | 'payment' | 'safety';
  targetType: 'all' | 'building' | 'floor' | 'rooms';
  targetBuildingId?: string;
  targetFloor?: number;
  targetRooms?: string[]; // list of room ids
  publishDate: string;
  expiryDate?: string;
  isPinned: boolean;
  attachmentUrl?: string;
  linkUrl?: string;
  createdAt: string;
  isUrgent?: boolean;
  author?: string; // 'นิติบุคคล' | 'ช่าง' etc.
  customTarget?: string; // 'อาคาร ก, ข' | 'อาคาร ค' | 'ทุกอาคาร'
}

export interface Notification {
  id: string;
  userId: string; // Can be a Tenant ID or Owner/User ID
  title: string;
  message: string;
  type: 'bill_new' | 'bill_due' | 'bill_overdue' | 'slip_pending' | 'slip_approved' | 'slip_rejected' | 'repair_new' | 'repair_update' | 'contract_expiring' | 'announcement';
  relatedEntityId?: string; // e.g., billId, maintenanceRequestId, contractId
  isRead: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  roleId: string; // ID referencing a Role
  roleName: string; // e.g. "เจ้าของระบบ", "ผู้จัดการ", "การเงิน", "เจ้าหน้าที่หอ", "ช่างซ่อม"
  email: string;
  description: string;
  createdAt: string;
}

export interface Permission {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  approve: boolean;
  reject: boolean;
  export: boolean;
  print: boolean;
  manageSettings: boolean;
  manageUsers: boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: { [module: string]: Permission }; // module -> Permission
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string; // e.g. "สร้างบิล", "อนุมัติสลิป", "ลบห้องพัก"
  details: string;
  entityType: string; // e.g. "Bill", "Tenant", "Room", "Contract"
  entityId: string;
  createdAt: string;
}

export interface UploadedFileMeta {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number; // in bytes
  storageKey: string; // references key in IndexedDB or localStorage
  createdAt: string;
}

export const BLOCKING_CONTRACT_STATUSES: ContractStatus[] = [
  'active',
  'expiring_soon',
  'pending_signature',
  'waiting_extension',
  'checking_out'
];

/**
 * Calculates room rent amount and description for a given billing cycle.
 * Handles 'monthly' vs 'term' (รายเทอม) accurately:
 * - Monthly: Returns monthlyRent and "ค่าเช่ารายเดือน"
 * - Term (รายเทอม):
 *   Determines if cycle is the start month of a term period (e.g. every 4 months from contract startDate).
 *   - Term Start Cycle: Returns termRent and "ค่าเช่ารายเทอม (4 เดือน)"
 *   - Subsequent Cycle within Term: Returns 0 and "ค่าเช่ารายเทอม (ชำระแล้วงวดต้นเทอม)"
 */
export function calculateRoomRentForCycle(
  room: Partial<Room> | undefined | null,
  cycleId: string, // "YYYY-MM" e.g., "2026-07"
  contract?: Partial<Contract> | null
): { amount: number; description: string; isTermStart: boolean } {
  if (!room) {
    return { amount: 0, description: 'ค่าเช่ารายเดือน', isTermStart: false };
  }

  if (room.rentCycle !== 'term') {
    return {
      amount: room.monthlyRent || 0,
      description: 'ค่าเช่ารายเดือน',
      isTermStart: false,
    };
  }

  const termRent = room.termRent || (room.monthlyRent ? room.monthlyRent * 4 : 18000);
  const termLengthMonths = 4; // Standard term length

  // Determine reference start date (from contract or default to 2026-03)
  let startYear = 2026;
  let startMonth = 3;

  if (contract?.startDate) {
    const parts = contract.startDate.split('-');
    if (parts.length >= 2) {
      const y = parseInt(parts[0]);
      const m = parseInt(parts[1]);
      if (!isNaN(y) && !isNaN(m)) {
        startYear = y;
        startMonth = m;
      }
    }
  }

  const [cycleYearStr, cycleMonthStr] = (cycleId || '2026-07').split('-');
  const cycleYear = parseInt(cycleYearStr) || 2026;
  const cycleMonth = parseInt(cycleMonthStr) || 7;

  // Month difference relative to contract start
  const monthDiff = (cycleYear - startYear) * 12 + (cycleMonth - startMonth);

  // Modulo 4 to check if this cycle is term renewal/start month
  const modulo = ((monthDiff % termLengthMonths) + termLengthMonths) % termLengthMonths;
  const isTermStart = modulo === 0;

  if (isTermStart) {
    return {
      amount: termRent,
      description: `ค่าเช่ารายเทอม (${termLengthMonths} เดือน)`,
      isTermStart: true,
    };
  } else {
    return {
      amount: 0,
      description: 'ค่าเช่ารายเทอม (ชำระแล้วงวดต้นเทอม)',
      isTermStart: false,
    };
  }
}

export const formatItemDescription = (desc: string): string => {
  if (!desc) return '';
  let str = desc.trim();

  if (str.includes('จ่ายรายเทอม') || str.includes('รายเทอม')) {
    return 'ค่าเช่ารายเทอม (จ่ายแล้ว)';
  }
  if (str.includes('ค่าเช่า')) {
    return 'ค่าเช่ารายเดือน';
  }

  if (str.includes('ค่าน้ำ')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าน้ำ (${match[1]})` : 'ค่าน้ำ';
  }

  if (str.includes('ค่าไฟ')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าไฟ (${match[1]})` : 'ค่าไฟ';
  }

  if (str.includes('ส่วนกลาง')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าส่วนกลาง (${match[1]})` : 'ค่าส่วนกลาง';
  }

  if (str.includes('อินเทอร์เน็ต') || str.includes('อินเตอร์เน็ต')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าอินเทอร์เน็ต (${match[1]})` : 'ค่าอินเทอร์เน็ต';
  }

  if (str.includes('จอดรถ')) {
    const match = str.match(/\(([^)]+)\)/);
    return match ? `ค่าที่จอดรถ (${match[1]})` : str;
  }

  return str;
};

export function formatBillingUnit(unit?: string | null): string {
  if (!unit) return '';
  const u = String(unit).trim().toLowerCase();
  switch (u) {
    case 'unit':
      return 'หน่วย';
    case 'person':
      return 'คน';
    case 'room':
      return 'ห้อง';
    case 'charge':
      return 'รายการ';
    case 'vehicle':
      return 'คัน';
    case 'month':
      return 'เดือน';
    case 'day':
      return 'วัน';
    case 'installment':
      return 'งวด';
    case 'bill':
      return 'บิล';
    case 'หน่วย':
      return 'หน่วย';
    case 'คน':
      return 'คน';
    case 'ห้อง':
      return 'ห้อง';
    case 'รายการ':
      return 'รายการ';
    case 'คัน':
      return 'คัน';
    case 'เดือน':
      return 'เดือน';
    case 'วัน':
      return 'วัน';
    case 'งวด':
      return 'งวด';
    case 'บิล':
      return 'บิล';
    default:
      return unit.trim();
  }
}

export function formatBillingQuantity(quantity?: number | string | null, unit?: string | null): string {
  if (quantity === undefined || quantity === null || quantity === '') return '-';
  const num = Number(quantity);
  if (isNaN(num)) return '-';
  const formattedNum = num % 1 === 0 ? num.toString() : num.toLocaleString('th-TH', { maximumFractionDigits: 2 });
  const thaiUnit = formatBillingUnit(unit);
  return thaiUnit ? `${formattedNum} ${thaiUnit}` : formattedNum;
}

export function formatBillingRate(unitPrice?: number | string | null, unit?: string | null): string {
  if (unitPrice === undefined || unitPrice === null || unitPrice === '') return '-';
  const val = Number(unitPrice);
  if (isNaN(val)) return '-';
  const formattedVal = val.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const thaiUnit = formatBillingUnit(unit);
  return thaiUnit ? `${formattedVal} บาท/${thaiUnit}` : `${formattedVal} บาท`;
}

/**
 * Resolves the display unit for a BillItem.
 * Precedence:
 * 1. Persisted `unit` (if provided, non-empty, and non-null)
 * 2. Verified deterministic fallback by `type` (only where source proves a single canonical unit)
 * 3. `null` / empty (no guessed unit)
 */
export function resolveBillingDisplayUnit(params: {
  unit?: string | null;
  type?: string | null;
}): string | null {
  if (params.unit && String(params.unit).trim() !== '') {
    const u = String(params.unit).trim().toLowerCase();
    if (u === 'bill') return 'charge';
    return u;
  }

  if (!params.type) return null;

  const normalizedType = String(params.type).trim().toLowerCase();
  switch (normalizedType) {
    case 'water':
      return 'unit';
    case 'electric':
    case 'electricity':
      return 'unit';
    case 'common':
    case 'common_fee':
      return 'room';
    case 'manual_outstanding':
    case 'other_fee':
      return 'charge';
    default:
      // Ambiguous types (rent, deposit, internet, parking, surcharge, late_fee, etc.)
      // do not guess a fallback unit.
      return null;
  }
}

/**
 * Helper to determine if a financial line item has a non-zero amount.
 * Items with exactly 0.00 amount are suppressed from user-facing expense breakdowns.
 */
export function isNonZeroAmount(amount?: number | string | null): boolean {
  if (amount === undefined || amount === null || amount === '') return false;
  const num = Number(amount);
  if (isNaN(num)) return false;
  return num !== 0;
}

/**
 * Filters out zero-amount items from an array of bill items or line items.
 */
export function filterNonZeroBillItems<T extends { amount?: number | string | null }>(items?: T[] | null): T[] {
  if (!items || !Array.isArray(items)) return [];
  return items.filter(it => isNonZeroAmount(it.amount));
}

export interface ActiveRentalSummary {
  type: 'TERM' | 'MONTHLY' | 'DAILY';
  rentAmount: number;
  depositAmount?: number | null;
  source: 'CONTRACT_SNAPSHOT' | 'CONTRACT' | 'PROVISIONAL_TERM' | 'DAILY_STAY' | string;
  termInstallmentCount?: number | null;
}

export type FieldSource = 'DORMITORY' | 'BUILDING' | 'ROOM' | 'CONTRACT_SNAPSHOT';

export interface RoomFieldSources {
  monthlyRent?: FieldSource;
  termRent?: FieldSource;
  dailyRent?: FieldSource;
  termDeposit?: FieldSource;
  monthlyDeposit?: FieldSource;
  dailyDeposit?: FieldSource;
  depositAmount?: FieldSource;
  advancePaymentAmount?: FieldSource;
  parkingFee?: FieldSource;
  waterRate?: FieldSource;
  electricityRate?: FieldSource;
  commonFee?: FieldSource;
  internetFee?: FieldSource;
  waterBillingType?: FieldSource;
  electricityBillingType?: FieldSource;
  rentBillingType?: FieldSource;
  maximumOccupants?: FieldSource;
  roomType?: FieldSource;
  [key: string]: FieldSource | undefined;
}

export interface EffectiveValues {
  monthlyRent: number;
  termRent?: number | null;
  dailyRent?: number | null;
  termDeposit?: number;
  monthlyDeposit?: number;
  dailyDeposit?: number;
  depositAmount: number;
  advancePaymentAmount: number;
  parkingFee: number;
  waterRate: number;
  electricityRate: number;
  commonFee: number;
  internetFee: number;
  waterBillingType: string;
  electricityBillingType: string;
  rentBillingType: string;
  maximumOccupants: number;
  roomType: string;
  [key: string]: any;
}

export interface ContractSnapshotData {
  contractId: string;
  snapshotId: string;
  roomId: string;
  buildingId: string;
  tenantId: string;
  exactRoomNumber: string;
  resolvedRent: string | number;
  resolvedDeposit: string | number;
  resolvedAdvancePayment: string | number;
  resolvedWaterRate: string | number;
  resolvedElectricityRate: string | number;
  resolvedCommonFee: string | number;
  resolvedInternetFee: string | number;
  resolvedParkingFee: string | number;
  waterBillingType: string;
  electricityBillingType: string;
  rentBillingType: string;
  sourceVersions: Record<string, number>;
  snapshotLockedAt: string;
  lockedByUserId?: string | null;
  snapshotData?: any;
}

export interface FieldEffectItem {
  field: string;
  roomId: string;
  roomNumber: string;
  oldEffectiveValue: any;
  newEffectiveValue: any;
  sourceBefore: string;
  sourceAfter: string;
  eligible: boolean;
  skipReason?: string;
}

export interface PropagationPreviewResult {
  scope: 'DORMITORY' | 'BUILDING';
  scopeId?: string | null;
  expectedVersions?: {
    property?: number;
    billing?: number;
  };
  expectedVersion?: number;
  candidateRoomCount: number;
  eligibleRoomCount: number;
  eligibleFieldChangeCount: number;
  skippedRoomCount: number;
  skippedFieldChangeCount: number;
  fieldEffects: FieldEffectItem[];
}
