/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Tenant Domain Safe API DTO Mappers (TENANT PHASE 3 STEP 3B.1)
 *
 * Enforces explicit field whitelisting for all browser-facing API responses.
 * Strictly prevents recursive and nested leakage of:
 * - nationalIdEncrypted
 * - idCardObjectKey
 * - idCardUploadedByUserId
 */

export interface SafeCoOccupantApiDTO {
  id: string;
  tenantId: string;
  dormitoryId?: string;
  contractId: string | null;
  name: string;
  phone: string | null;
  relationship: string | null;
  nationalIdMasked: string | null;
  dateOfBirth: string | Date | null;
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}

export interface SafeEmergencyContactApiDTO {
  id: string;
  tenantId: string;
  dormitoryId?: string;
  name: string;
  phone: string;
  relationship: string;
  isPrimary: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface SafeVehicleApiDTO {
  id: string;
  tenantId: string;
  dormitoryId?: string;
  type: string;
  licensePlate: string;
  province?: string | null;
  brand?: string | null;
  model?: string | null;
  color?: string | null;
  notes?: string | null;
  status?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  deletedAt?: string | Date | null;
}

export interface SafeTenantApiDTO {
  id: string;
  dormitoryId: string;
  tenantNumber: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  name: string;
  phone: string;
  email: string | null;
  nationalIdMasked: string | null;
  dateOfBirth: string | Date | null;
  gender: string | null;
  address: string | null;
  status: string;
  photoUrl: string | null;
  petInfo?: any;
  notes: string | null;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt?: string | Date | null;
  lineFriendId?: string | null;

  // Safe Document Presentation Metadata (strictly NO internal object keys or uploaded-by ids)
  hasIdentityDocument: boolean;
  idCardUploadedAt?: string | Date | null;
  idCardMimeType?: string | null;
  idCardByteSize?: number | null;
  idCardSha256?: string | null;

  // Nested relations (when loaded)
  coOccupants?: SafeCoOccupantApiDTO[];
  vehicles?: SafeVehicleApiDTO[];
  emergencyContacts?: SafeEmergencyContactApiDTO[];
  contracts?: SafeContractApiDTO[];
}

export interface SafeRoomSummaryApiDTO {
  id: string;
  roomNumber: string;
  buildingId: string | null;
  floor: number | null;
  roomType: string | null;
  status: string | null;
}

export interface SafeContractApiDTO {
  id: string;
  contractNumber: string;
  tenantId: string;
  dormitoryId: string;
  roomId: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  durationMonths: number;
  rentBillingType: string;
  rentAmount: number | string;
  depositAmount: number | string;
  advancePaymentAmount: number | string;
  terms?: string | null;
  previousContractId?: string | null;
  signedByOwnerAt?: string | Date | null;
  signedByTenantAt?: string | Date | null;
  activatedAt?: string | Date | null;
  terminatedAt?: string | Date | null;
  terminationEffectiveDate?: string | Date | null;
  terminationReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: SafeRoomSummaryApiDTO | null;
}

export interface SafeOccupancyApiDTO {
  id: string;
  tenantId: string;
  dormitoryId: string;
  roomId: string;
  contractId: string | null;
  status: string;
  startedAt: string | Date;
  endedAt: string | Date | null;
  endedReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: SafeRoomSummaryApiDTO | null;
  contract?: {
    id: string;
    contractNumber: string;
    status: string;
  } | null;
}

export interface SafeDailyStayInvoiceSummaryApiDTO {
  id: string;
  invoiceNumber: string;
  totalRentAmount: number | string;
  depositAmount: number | string;
  totalAgreedAmount: number | string;
  outstandingAmount: number | string;
  depositDeclaredStatus: string;
  status: string;
  issuedAt?: string | Date | null;
}

export interface SafeDailyStayApiDTO {
  id: string;
  tenantId: string | null;
  dormitoryId: string;
  roomId: string;
  occupancyId?: string | null;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  checkInAt?: string | Date | null;
  checkOutAt?: string | Date | null;
  inclusiveDayCount: number;
  dailyRateAmount: number | string;
  totalRentAmount: number | string;
  depositAmount: number | string;
  depositDeclaredStatus: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: SafeRoomSummaryApiDTO | null;
  invoice?: SafeDailyStayInvoiceSummaryApiDTO | null;
}

export interface SafeBillItemApiDTO {
  id: string;
  billId: string;
  type: string;
  name: string;
  amount: number | string;
  quantity?: number | null;
  unitPrice?: number | string | null;
}

export interface SafePaymentSummaryApiDTO {
  id: string;
  amount: number | string;
  status: string;
  method: string;
  paymentDate?: string | Date | null;
}

export interface SafeReceiptSummaryApiDTO {
  id: string;
  receiptNumber: string;
  receiptKind: string;
  isVoided: boolean;
  issuedAt: string | Date;
}

export interface SafeBillApiDTO {
  id: string;
  dormitoryId: string;
  tenantId: string | null;
  roomId: string;
  contractId: string | null;
  billingCycleId: string;
  billNumber: string;
  billKind: string;
  billingDate: string | Date;
  dueDate: string | Date;
  status: string;
  subtotal: number | string;
  discountAmount: number | string;
  fineAmount: number | string;
  totalAmount: number | string;
  paidAmount: number | string;
  outstandingAmount: number | string;
  paidAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: SafeRoomSummaryApiDTO | null;
  items?: SafeBillItemApiDTO[];
  payments?: SafePaymentSummaryApiDTO[];
  receipts?: SafeReceiptSummaryApiDTO[];
}

export interface SafeSettlementItemApiDTO {
  id: string;
  settlementId: string;
  description: string;
  amount: number | string;
  evidenceUrl?: string | null;
}

export interface SafeSettlementApiDTO {
  id: string;
  tenantId: string;
  dormitoryId: string;
  contractId: string;
  roomId: string;
  depositAmount: number | string;
  unpaidBillAmount: number | string;
  damageChargeTotal: number | string;
  netSettlement: number | string;
  settlementDirection: string;
  settlementStatus: string;
  confirmedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  items?: SafeSettlementItemApiDTO[];
  room?: SafeRoomSummaryApiDTO | null;
  contract?: {
    id: string;
    contractNumber: string;
    status: string;
  } | null;
}

export interface SafeTenantDetailsApiDTO {
  tenant: SafeTenantApiDTO | null;
  coOccupants: SafeCoOccupantApiDTO[];
  coOccupantHistory: SafeCoOccupantApiDTO[];
  emergencyContacts: SafeEmergencyContactApiDTO[];
  vehicles: SafeVehicleApiDTO[];
  contracts: SafeContractApiDTO[];
  occupancies: SafeOccupancyApiDTO[];
  dailyStays: SafeDailyStayApiDTO[];
  bills: SafeBillApiDTO[];
  settlements: SafeSettlementApiDTO[];
}

/**
 * Maps any co-occupant entity or record to an explicit SafeCoOccupantApiDTO.
 * Strictly omits nationalIdEncrypted.
 */
export function toCoOccupantApiDTO(raw: any): SafeCoOccupantApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: raw.id,
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    contractId: raw.contractId ?? null,
    name: raw.name || '',
    phone: raw.phone ?? null,
    relationship: raw.relationship ?? null,
    nationalIdMasked: raw.nationalIdMasked ?? null,
    dateOfBirth: raw.dateOfBirth ?? null,
    status: raw.status || 'active',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    deletedAt: raw.deletedAt ?? null,
  };
}

/**
 * Maps any emergency contact entity or record to an explicit SafeEmergencyContactApiDTO.
 */
export function toEmergencyContactApiDTO(raw: any): SafeEmergencyContactApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: raw.id,
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    name: raw.name || '',
    phone: raw.phone || '',
    relationship: raw.relationship || raw.relation || '',
    isPrimary: Boolean(raw.isPrimary),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Maps any vehicle entity or record to an explicit SafeVehicleApiDTO.
 */
export function toVehicleApiDTO(raw: any): SafeVehicleApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: raw.id,
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    type: raw.type || 'car',
    licensePlate: raw.licensePlate || '',
    province: raw.province ?? null,
    brand: raw.brand ?? null,
    model: raw.model ?? null,
    color: raw.color ?? null,
    notes: raw.notes ?? null,
    status: raw.status || 'active',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    deletedAt: raw.deletedAt ?? null,
  };
}

/**
 * Maps any Tenant entity or record to an explicit SafeTenantApiDTO.
 * Strictly whitelists browser-facing attributes and eliminates internal storage keys,
 * encrypted sensitive fields, and upload actor IDs.
 */
export function toTenantApiDTO(raw: any): SafeTenantApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  const displayName = raw.displayName || raw.name || `${raw.firstName || ''} ${raw.lastName || ''}`.trim();
  const name = raw.name || displayName;

  const dto: SafeTenantApiDTO = {
    id: raw.id,
    dormitoryId: raw.dormitoryId,
    tenantNumber: raw.tenantNumber || '',
    firstName: raw.firstName || '',
    lastName: raw.lastName ?? null,
    displayName,
    name,
    phone: raw.phone || '',
    email: raw.email ?? null,
    nationalIdMasked: raw.nationalIdMasked ?? null,
    dateOfBirth: raw.dateOfBirth ?? null,
    gender: raw.gender ?? null,
    address: raw.address ?? null,
    status: raw.status || 'active',
    photoUrl: raw.photoUrl ?? null,
    petInfo: raw.petInfo ?? undefined,
    notes: raw.notes ?? null,
    version: typeof raw.version === 'number' ? raw.version : 1,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    deletedAt: raw.deletedAt ?? null,
    lineFriendId: raw.lineFriendId ?? null,

    hasIdentityDocument: Boolean(raw.idCardObjectKey || raw.hasIdentityDocument),
    idCardUploadedAt: raw.idCardUploadedAt ?? null,
    idCardMimeType: raw.idCardMimeType ?? null,
    idCardByteSize: raw.idCardByteSize ?? null,
    idCardSha256: raw.idCardSha256 ?? null,
  };

  if (Array.isArray(raw.coOccupants)) {
    dto.coOccupants = raw.coOccupants.map(toCoOccupantApiDTO).filter(Boolean) as SafeCoOccupantApiDTO[];
  }
  if (Array.isArray(raw.vehicles)) {
    dto.vehicles = raw.vehicles.map(toVehicleApiDTO).filter(Boolean) as SafeVehicleApiDTO[];
  }
  if (Array.isArray(raw.emergencyContacts)) {
    dto.emergencyContacts = raw.emergencyContacts.map(toEmergencyContactApiDTO).filter(Boolean) as SafeEmergencyContactApiDTO[];
  }
  if (Array.isArray(raw.contracts)) {
    dto.contracts = raw.contracts.map(toContractApiDTO).filter(Boolean) as SafeContractApiDTO[];
  }

  return dto;
}

/**
 * Maps room entity to safe presentation summary.
 */
export function toRoomSummaryApiDTO(raw: any): SafeRoomSummaryApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id,
    roomNumber: raw.roomNumber || '',
    buildingId: raw.buildingId ?? null,
    floor: raw.floor !== undefined && raw.floor !== null ? Number(raw.floor) : null,
    roomType: raw.roomType ?? null,
    status: raw.status ?? null,
  };
}

/**
 * Maps contract entity to safe browser DTO.
 * Strictly eliminates internal audit user IDs, raw signature blobs, and internal snapshots.
 */
export function toContractApiDTO(raw: any): SafeContractApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  const toAmount = (val: any) =>
    val !== undefined ? (typeof val === 'object' && val !== null && 'toNumber' in val ? val.toNumber() : val) : 0;

  return {
    id: raw.id,
    contractNumber: raw.contractNumber || '',
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    roomId: raw.roomId,
    status: raw.status || 'draft',
    startDate: raw.startDate,
    endDate: raw.endDate,
    durationMonths: typeof raw.durationMonths === 'number' ? raw.durationMonths : 1,
    rentBillingType: raw.rentBillingType || 'monthly',
    rentAmount: toAmount(raw.rentAmount),
    depositAmount: toAmount(raw.depositAmount),
    advancePaymentAmount: toAmount(raw.advancePaymentAmount),
    terms: raw.terms ?? null,
    previousContractId: raw.previousContractId ?? null,
    signedByOwnerAt: raw.signedByOwnerAt ?? null,
    signedByTenantAt: raw.signedByTenantAt ?? null,
    activatedAt: raw.activatedAt ?? null,
    terminatedAt: raw.terminatedAt ?? null,
    terminationEffectiveDate: raw.terminationEffectiveDate ?? null,
    terminationReason: raw.terminationReason ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    room: toRoomSummaryApiDTO(raw.room),
  };
}

/**
 * Maps occupancy entity to safe browser DTO.
 * Strictly eliminates endedByUserId and registration internals.
 */
export function toOccupancyApiDTO(raw: any): SafeOccupancyApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id,
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    roomId: raw.roomId,
    contractId: raw.contractId ?? null,
    status: raw.status || 'ACTIVE',
    startedAt: raw.startedAt,
    endedAt: raw.endedAt ?? null,
    endedReason: raw.endedReason ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    room: toRoomSummaryApiDTO(raw.room),
    contract: raw.contract
      ? {
          id: raw.contract.id,
          contractNumber: raw.contract.contractNumber || '',
          status: raw.contract.status || '',
        }
      : null,
  };
}

/**
 * Maps daily stay entity to safe browser DTO.
 * Strictly separates from contracts and omits operator actor IDs.
 */
export function toDailyStayApiDTO(raw: any): SafeDailyStayApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  const toAmount = (val: any) =>
    val !== undefined ? (typeof val === 'object' && val !== null && 'toNumber' in val ? val.toNumber() : val) : 0;

  return {
    id: raw.id,
    tenantId: raw.tenantId ?? null,
    dormitoryId: raw.dormitoryId,
    roomId: raw.roomId,
    occupancyId: raw.occupancyId ?? null,
    status: raw.status || 'PENDING_APPROVAL',
    startDate: raw.startDate,
    endDate: raw.endDate,
    checkInAt: raw.checkInAt ?? null,
    checkOutAt: raw.checkOutAt ?? null,
    inclusiveDayCount: typeof raw.inclusiveDayCount === 'number' ? raw.inclusiveDayCount : 1,
    dailyRateAmount: toAmount(raw.dailyRateAmount),
    totalRentAmount: toAmount(raw.totalRentAmount),
    depositAmount: toAmount(raw.depositAmount),
    depositDeclaredStatus: raw.depositDeclaredStatus || 'UNPAID',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    room: toRoomSummaryApiDTO(raw.room),
    invoice: raw.invoice
      ? {
          id: raw.invoice.id,
          invoiceNumber: raw.invoice.invoiceNumber || '',
          totalRentAmount: toAmount(raw.invoice.totalRentAmount),
          depositAmount: toAmount(raw.invoice.depositAmount),
          totalAgreedAmount: toAmount(raw.invoice.totalAgreedAmount ?? raw.invoice.totalAmount),
          outstandingAmount: toAmount(raw.invoice.outstandingAmount),
          depositDeclaredStatus: raw.invoice.depositDeclaredStatus || 'UNPAID',
          status: raw.invoice.status || 'ISSUED',
          issuedAt: raw.invoice.issuedAt ?? null,
        }
      : null,
  };
}

/**
 * Maps bill entity to safe browser DTO.
 * Strictly eliminates provider secrets, internal slip object keys, and reviewer IDs.
 */
export function toBillApiDTO(raw: any): SafeBillApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  const toAmount = (val: any) =>
    val !== undefined ? (typeof val === 'object' && val !== null && 'toNumber' in val ? val.toNumber() : val) : 0;

  return {
    id: raw.id,
    dormitoryId: raw.dormitoryId,
    tenantId: raw.tenantId ?? null,
    roomId: raw.roomId,
    contractId: raw.contractId ?? null,
    billingCycleId: raw.billingCycleId,
    billNumber: raw.billNumber || '',
    billKind: raw.billKind || 'MONTHLY_UTILITY',
    billingDate: raw.billingDate,
    dueDate: raw.dueDate,
    status: raw.status || 'draft',
    subtotal: toAmount(raw.subtotal),
    discountAmount: toAmount(raw.discountAmount),
    fineAmount: toAmount(raw.fineAmount),
    totalAmount: toAmount(raw.totalAmount),
    paidAmount: toAmount(raw.paidAmount),
    outstandingAmount: toAmount(raw.outstandingAmount),
    paidAt: raw.paidAt ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    room: toRoomSummaryApiDTO(raw.room),
    items: Array.isArray(raw.items)
      ? raw.items.map((item: any) => ({
          id: item.id,
          billId: item.billId || raw.id,
          type: item.type || item.itemType || 'other',
          name: item.name || item.description || '',
          amount: toAmount(item.amount),
          quantity: item.quantity !== undefined && item.quantity !== null ? Number(item.quantity) : null,
          unitPrice: item.unitPrice !== undefined && item.unitPrice !== null ? toAmount(item.unitPrice) : null,
        }))
      : [],
    payments: Array.isArray(raw.Payment || raw.payments)
      ? (raw.Payment || raw.payments).map((p: any) => ({
          id: p.id,
          amount: toAmount(p.amount),
          status: p.status || 'PENDING',
          method: p.method || p.paymentMethod || 'CASH',
          paymentDate: p.paymentDate ?? p.paidAt ?? null,
        }))
      : [],
    receipts: Array.isArray(raw.Receipt || raw.receipts)
      ? (raw.Receipt || raw.receipts).map((r: any) => ({
          id: r.id,
          receiptNumber: r.receiptNumber || '',
          receiptKind: r.receiptKind || 'EVENT',
          isVoided: typeof r.isVoided === 'boolean' ? r.isVoided : false,
          issuedAt: r.issuedAt ?? r.createdAt ?? new Date(),
        }))
      : [],
  };
}

/**
 * Maps contract settlement entity to safe browser DTO.
 * Strictly eliminates payment/bank accounts and provider secrets.
 */
export function toSettlementApiDTO(raw: any): SafeSettlementApiDTO | null {
  if (!raw || typeof raw !== 'object') return null;

  const toAmount = (val: any) =>
    val !== undefined ? (typeof val === 'object' && val !== null && 'toNumber' in val ? val.toNumber() : val) : 0;

  return {
    id: raw.id,
    tenantId: raw.tenantId,
    dormitoryId: raw.dormitoryId,
    contractId: raw.contractId,
    roomId: raw.roomId,
    depositAmount: toAmount(raw.depositAmount),
    unpaidBillAmount: toAmount(raw.unpaidBillAmount),
    damageChargeTotal: toAmount(raw.damageChargeTotal),
    netSettlement: toAmount(raw.netSettlement),
    settlementDirection: raw.settlementDirection || 'REFUND',
    settlementStatus: raw.settlementStatus || 'PENDING_REFUND',
    confirmedAt: raw.confirmedAt ?? null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    room: toRoomSummaryApiDTO(raw.room),
    contract: raw.contract
      ? {
          id: raw.contract.id,
          contractNumber: raw.contract.contractNumber || '',
          status: raw.contract.status || '',
        }
      : null,
    items: Array.isArray(raw.items)
      ? raw.items
          .filter((item: any) => !item.isDeleted)
          .map((item: any) => ({
            id: item.id,
            settlementId: item.settlementId || raw.id,
            description: item.description || '',
            amount: toAmount(item.amount),
            evidenceUrl: item.evidenceUrl ?? null,
          }))
      : [],
  };
}

/**
 * Maps tenant details aggregation to an explicit SafeTenantDetailsApiDTO.
 */
export function toTenantDetailsApiDTO(details: any): SafeTenantDetailsApiDTO | null {
  if (!details || typeof details !== 'object') return null;

  return {
    tenant: toTenantApiDTO(details.tenant),
    coOccupants: Array.isArray(details.coOccupants)
      ? (details.coOccupants.map(toCoOccupantApiDTO).filter(Boolean) as SafeCoOccupantApiDTO[])
      : [],
    coOccupantHistory: Array.isArray(details.coOccupantHistory)
      ? (details.coOccupantHistory.map(toCoOccupantApiDTO).filter(Boolean) as SafeCoOccupantApiDTO[])
      : [],
    emergencyContacts: Array.isArray(details.emergencyContacts)
      ? (details.emergencyContacts.map(toEmergencyContactApiDTO).filter(Boolean) as SafeEmergencyContactApiDTO[])
      : [],
    vehicles: Array.isArray(details.vehicles)
      ? (details.vehicles.map(toVehicleApiDTO).filter(Boolean) as SafeVehicleApiDTO[])
      : [],
    contracts: Array.isArray(details.contracts)
      ? (details.contracts.map(toContractApiDTO).filter(Boolean) as SafeContractApiDTO[])
      : [],
    occupancies: Array.isArray(details.occupancies)
      ? (details.occupancies.map(toOccupancyApiDTO).filter(Boolean) as SafeOccupancyApiDTO[])
      : [],
    dailyStays: Array.isArray(details.dailyStays)
      ? (details.dailyStays.map(toDailyStayApiDTO).filter(Boolean) as SafeDailyStayApiDTO[])
      : [],
    bills: Array.isArray(details.bills)
      ? (details.bills.map(toBillApiDTO).filter(Boolean) as SafeBillApiDTO[])
      : [],
    settlements: Array.isArray(details.settlements)
      ? (details.settlements.map(toSettlementApiDTO).filter(Boolean) as SafeSettlementApiDTO[])
      : [],
  };
}
