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
  contracts?: any[];
}

export interface SafeTenantDetailsApiDTO {
  tenant: SafeTenantApiDTO | null;
  coOccupants: SafeCoOccupantApiDTO[];
  coOccupantHistory: SafeCoOccupantApiDTO[];
  emergencyContacts: SafeEmergencyContactApiDTO[];
  vehicles: SafeVehicleApiDTO[];
  contracts: any[];
  occupancies: any[];
  dailyStays: any[];
  bills: any[];
  settlements: any[];
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
    dto.contracts = raw.contracts;
  }

  return dto;
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
    contracts: Array.isArray(details.contracts) ? details.contracts : [],
    occupancies: Array.isArray(details.occupancies) ? details.occupancies : [],
    dailyStays: Array.isArray(details.dailyStays) ? details.dailyStays : [],
    bills: Array.isArray(details.bills) ? details.bills : [],
    settlements: Array.isArray(details.settlements) ? details.settlements : [],
  };
}
