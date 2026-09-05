/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dormitory,
  Building,
  Room,
  RoomStatus,
  Tenant,
  Contract,
  MeterReading,
  Bill,
  MaintenanceRequest,
  Announcement,
  Notification,
  AuditLog,
  EmergencyContactInput,
  VehicleInput,
  PetItem
} from '../../types';

// Domain Error Types
export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'DORMITORY_ACCESS_DENIED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'CONTRACT_OVERLAP'
  | 'ROOM_LIMIT_EXCEEDED'
  | 'DUPLICATE_BILL'
  | 'DUPLICATE_SLIP'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'GROUP_ALLOCATION_RECONCILIATION_FAILED'
  | 'GROUP_REJECTION_REQUIRED'
  | 'REPLACEMENT_CONFIRMATION_REQUIRED'
  | 'SETTLEMENT_LOCKED'
  | 'PENDING_REGISTRATION_LOCK'
  | 'POLICY_VERSION_MISMATCH'
  | 'INTERNAL_ERROR'
  | (string & {});

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  details?: Record<string, any>;
}

export interface DataResult<T> {
  success: boolean;
  data?: T;
  error?: DomainError;
  message?: string;
}

// DataSource Interfaces

export interface DormitoryDataSource {
  getAll(): Promise<Dormitory[]>;
  getById(id: string): Promise<Dormitory | null>;
  update(dormitory: Dormitory, actorUserId?: string): Promise<DataResult<Dormitory>>;
  getBuildings(): Promise<Building[]>;
  addBuilding(building: Omit<Building, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Building>>;
  updateBuilding(building: Building, actorUserId?: string): Promise<DataResult<Building>>;
  deleteBuilding(buildingId: string, actorUserId?: string): Promise<DataResult<boolean>>;
}

export interface RoomDataSource {
  getAll(): Promise<Room[]>;
  getById(id: string): Promise<Room | null>;
  getByNumber(roomNumber: string): Promise<Room | null>;
  addRoom(roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Room>>;
  updateRoom(room: Room, actorUserId?: string): Promise<DataResult<Room>>;
  updateStatus(roomId: string, status: Room['status'], currentTenantId?: string, actorUserId?: string): Promise<DataResult<Room>>;
  deleteRoom(roomId: string, actorUserId?: string): Promise<DataResult<boolean>>;
}

export interface TenantOccupancyRecord {
  id: string;
  dormitoryId: string;
  roomId: string;
  tenantId: string;
  contractId?: string | null;
  startedAt: string | Date;
  endedAt?: string | Date | null;
  status: string;
  endedReason?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: Room | null;
  contract?: Contract | null;
}

export interface TenantDailyStayRecord {
  id: string;
  dormitoryId: string;
  roomId: string;
  tenantId?: string | null;
  occupancyId?: string | null;
  requestSource?: string;
  applicantFullName?: string | null;
  applicantPhone?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  checkInAt?: string | Date | null;
  checkOutAt?: string | Date | null;
  inclusiveDayCount: number;
  dailyRateAmount: string | number;
  totalRentAmount: string | number;
  depositAmount: string | number;
  depositDeclaredStatus?: string;
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  room?: Room | null;
  invoice?: any;
}

export interface TenantSettlementRecord {
  id: string;
  dormitoryId: string;
  tenantId: string;
  contractId: string;
  roomId: string;
  depositAmount: string | number;
  unpaidBillAmount: string | number;
  damageChargeTotal: string | number;
  netSettlement: string | number;
  settlementDirection: string;
  settlementStatus: string;
  confirmedAt?: string | Date | null;
  confirmedByUserId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  items?: any[];
  room?: Room | null;
  contract?: Contract | null;
}

export interface TenantProfileDetails {
  tenant: Tenant | any;
  coOccupants: any[];
  coOccupantHistory?: any[];
  emergencyContacts: any[];
  vehicles: any[];
  contracts: any[];
  occupancies: TenantOccupancyRecord[];
  dailyStays: TenantDailyStayRecord[];
  bills: any[];
  settlements: TenantSettlementRecord[];
}

export interface UpdateTenantProfilePayload {
  displayName: string;
  phone: string;
  email?: string | null;
  nationalId?: string | null;
  version: number;
  emergencyContact?: {
    id?: string | null;
    name: string;
    phone: string;
    relationship: string;
    isPrimary?: boolean;
  } | null;
  vehicles?: Array<{
    id?: string | null;
    type: 'car' | 'motorcycle' | 'none' | 'other';
    licensePlate: string;
    brand?: string | null;
    model?: string | null;
    color?: string | null;
    province?: string | null;
  }>;
  pets?: Array<{
    id?: string | null;
    type: string;
    customType?: string | null;
    name?: string | null;
  }>;
}

export interface TenantDataSource {
  getAll(): Promise<Tenant[]>;
  getById(id: string): Promise<Tenant | null>;
  getByRoomId(roomId: string): Promise<Tenant | null>;
  addTenant(tenantData: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Tenant>>;
  updateTenant(tenant: Tenant, actorUserId?: string): Promise<DataResult<Tenant>>;
  addCoOccupant(tenantId: string, coOccupant: { name: string; phone?: string; relationship?: string }): Promise<DataResult<any>>;
  updateCoOccupant(tenantId: string, coOccupantId: string, coOccupant: { name?: string; phone?: string; relationship?: string }): Promise<DataResult<any>>;
  removeCoOccupant(tenantId: string, coOccupantId: string): Promise<DataResult<boolean>>;
  addEmergencyContact(tenantId: string, contact: EmergencyContactInput): Promise<DataResult<any>>;
  updateEmergencyContact(tenantId: string, contactId: string, contact: Partial<EmergencyContactInput>): Promise<DataResult<any>>;
  deleteEmergencyContact(tenantId: string, contactId: string): Promise<DataResult<boolean>>;
  addVehicle(tenantId: string, vehicle: VehicleInput): Promise<DataResult<any>>;
  updateVehicle(tenantId: string, vehicleId: string, vehicle: Partial<VehicleInput>): Promise<DataResult<any>>;
  deleteVehicle(tenantId: string, vehicleId: string): Promise<DataResult<boolean>>;
  getIdentityDocumentUrl(tenantId: string, dormitoryId?: string): string;
  uploadIdentityDocument(tenantId: string, file: File | Blob): Promise<DataResult<any>>;
  getTenantProfile(id: string): Promise<DataResult<TenantProfileDetails>>;
  updateTenantProfile(tenantId: string, payload: UpdateTenantProfilePayload): Promise<DataResult<TenantProfileDetails | any>>;
}

export interface ContractDataSource {
  getAll(): Promise<Contract[]>;
  getById(id: string): Promise<Contract | null>;
  getByTenantId(tenantId: string): Promise<Contract[]>;
  getByRoomId(roomId: string): Promise<Contract[]>;
  checkOverlap(roomId: string, startDate: string, endDate: string, excludeContractId?: string): Promise<boolean>;
  addContract(contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Contract>>;
}

export interface MeterDataSource {
  getByCycle(cycleId: string): Promise<MeterReading[]>;
  getByRoomAndCycle(roomId: string, cycleId: string): Promise<MeterReading | null>;
  saveMeterRecord(record: Omit<MeterReading, 'id' | 'recordedAt'>, actorUserId?: string): Promise<DataResult<MeterReading>>;
  saveBulkMeterRecords(records: Array<Omit<MeterReading, 'id' | 'recordedAt'>>, actorUserId?: string): Promise<DataResult<MeterReading[]>>;
  getCyclePeopleCount(cycleId: string, roomId?: string): Promise<DataResult<any[]>>;
  updateCyclePeopleCount(cycleId: string, roomId: string, peopleCount: number): Promise<DataResult<any>>;
  saveBulkWorkspace?(billingCycleId: string, rows: any[]): Promise<DataResult<{ savedCount: number }>>;
  toggleRoomBillSwitch?(billingCycleId: string, roomId: string, action: 'issue' | 'cancel', dirtyRow?: any, cancellationReason?: string): Promise<DataResult<any>>;
  pullPreviousWorkspace?(billingCycleId: string): Promise<DataResult<{
    hasPreviousCycle: boolean;
    previousCycleId?: string;
    previousCycleCode?: string;
    rooms: Array<{
      roomId: string;
      previousWaterCurrentReading: string | null;
      previousElectricityCurrentReading: string | null;
      previousCyclePeopleCount: number | null;
      currentHouseholdPeopleCount: number;
    }>;
  }>>;
}

export interface BillingDataSource {
  getAll(): Promise<Bill[]>;
  getById(id: string): Promise<Bill | null>;
  getByTenantId(tenantId: string): Promise<Bill[]>;
  getByRoomId(roomId: string): Promise<Bill[]>;
  getByCycle(cycleId: string): Promise<Bill[]>;
  generateBillForRoom(roomId: string, cycleId: string, actorUserId?: string): Promise<DataResult<Bill>>;
  generateBulkBills(cycleId: string, roomIds?: string[], dirtyRows?: any[]): Promise<DataResult<any>>;
  updateBillStatus(billId: string, status: Bill['status'], actorUserId?: string): Promise<DataResult<Bill>>;
}

export interface PaymentDataSource {}



export interface MaintenanceDataSource {
  getAll(): Promise<MaintenanceRequest[]>;
  getById(id: string): Promise<MaintenanceRequest | null>;
  getByTenantId(tenantId: string): Promise<MaintenanceRequest[]>;
  createRequest(data: Omit<MaintenanceRequest, 'id' | 'createdAt' | 'updatedAt' | 'updates'>, actorUserId?: string): Promise<DataResult<MaintenanceRequest>>;
  updateStatus(requestId: string, status: MaintenanceRequest['status'], note?: string, actorUserId?: string): Promise<DataResult<MaintenanceRequest>>;
}

export interface AnnouncementDataSource {
  getAll(): Promise<Announcement[]>;
  getById(id: string): Promise<Announcement | null>;
  createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt'>, actorUserId?: string): Promise<DataResult<Announcement>>;
}

export interface NotificationDataSource {
  getByUser(userId: string): Promise<Notification[]>;
  markAsRead(notificationId: string): Promise<DataResult<boolean>>;
  addNotification(userId: string, title: string, message: string, type: Notification['type'], relatedEntityId?: string): Promise<DataResult<Notification>>;
}

export interface AuditDataSource {
  getAll(): Promise<AuditLog[]>;
  addLog(userId: string, action: string, details: string, entityType: string, entityId: string): Promise<DataResult<AuditLog>>;
}

export interface StaffRoleDataSource {
  getFollowers(params?: { friendStatus?: string; search?: string }): Promise<DataResult<any[]>>;
  assignRole(params: { followerId: string; roleCode: 'OWNER' | 'MANAGER' | 'STAFF' }): Promise<DataResult<any>>;
  revokeRole(assignmentId: string, reason?: string): Promise<DataResult<any>>;
}

export interface TenantRegistrationDataSource {
  getAvailableRooms(): Promise<DataResult<any[]>>;
  submitRegistration(params: { requestedRoomId: string; firstName: string; lastName: string; phone: string; note?: string }): Promise<DataResult<any>>;
  getRegistrationStatus(): Promise<DataResult<any>>;
  listRequests(): Promise<DataResult<any[]>>;
  approveRequest(params: { requestId: string; tenantId: string; contractId: string }): Promise<DataResult<any>>;
  rejectRequest(requestId: string, reason: string): Promise<DataResult<any>>;
  updateRequestRoom?(requestId: string, requestedRoomId: string): Promise<DataResult<any>>;
  confirmRegistrationSignature?(requestId: string, signatureBase64: string): Promise<DataResult<any>>;
}

export interface CreateRoomPayload {
  buildingId: string;
  roomNumber: string;
  floor?: number;
  roomType?: string;
  status?: RoomStatus;
  rentCycle?: 'monthly' | 'term' | 'daily';
  monthlyRent?: string | number | null;
  termRent?: string | number | null;
  dailyRent?: string | number | null;
  termDeposit?: string | number | null;
  monthlyDeposit?: string | number | null;
  dailyDeposit?: string | number | null;
  depositAmount?: string | number | null;
  depositInheritsBuildingDefault?: boolean;
  parkingFee?: string | number | null;
  maximumOccupants?: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  amenities?: string[];
  images?: string[];
  notes?: string | null;
}

export interface UpdateRoomChanges {
  roomNumber?: string;
  buildingId?: string;
  floor?: number;
  roomType?: string;
  status?: RoomStatus;
  rentCycle?: 'monthly' | 'term' | 'daily';
  monthlyRent?: string | number | null;
  termRent?: string | number | null;
  dailyRent?: string | number | null;
  termDeposit?: string | number | null;
  monthlyDeposit?: string | number | null;
  dailyDeposit?: string | number | null;
  depositAmount?: string | number | null;
  depositInheritsBuildingDefault?: boolean;
  parkingFee?: string | number | null;
  maximumOccupants?: number;
  waterMeterNumber?: string | null;
  electricityMeterNumber?: string | null;
  initialWaterReading?: string | number | null;
  initialElectricityReading?: string | number | null;
  amenities?: string[];
  images?: string[];
  notes?: string | null;
}

export type RoomMutationResult = Room & {
  effectiveRoomStatusCycleId?: string | null;
};

export interface PropertyDataSource {
  getAuthoritativeRooms(params?: Record<string, any>): Promise<DataResult<{ items: Room[]; pagination: any }>>;
  getAuthoritativeRoom(id: string): Promise<DataResult<Room>>;
  createRoom(payload: CreateRoomPayload): Promise<DataResult<RoomMutationResult>>;
  updateRoom(roomId: string, changes: UpdateRoomChanges, expectedVersion: number): Promise<DataResult<RoomMutationResult>>;
  getAuthoritativeBuildings(): Promise<DataResult<Building[]>>;
  getAuthoritativeBuilding(id: string): Promise<DataResult<Building>>;
  getDormitoryDefaults(): Promise<DataResult<{ property: any; billing: any }>>;
  updateDormitoryDefaults(payload: {
    property?: { changes: Record<string, any>; expectedVersion: number };
    billing?: { changes: Record<string, any>; expectedVersion: number };
  }): Promise<DataResult<any>>;
  setBuildingDefaults(buildingId: string, changes: Record<string, any>, expectedVersion: number): Promise<DataResult<Building>>;
  updateBuildingIdentity(buildingId: string, changes: { name?: string; code?: string; floorCount?: number; description?: string; displayOrder?: number; numberingPattern?: string }, expectedVersion: number): Promise<DataResult<Building>>;
  archiveBuilding(buildingId: string, expectedVersion: number): Promise<DataResult<boolean>>;
  clearBuildingOverride(buildingId: string, field: string, expectedVersion: number): Promise<DataResult<Building>>;
  setRoomDefaults(roomId: string, changes: Record<string, any>, expectedVersion: number): Promise<DataResult<Room>>;
  updateRoomIdentity(roomId: string, changes: { roomNumber?: string; buildingId?: string; floor?: number; roomType?: string; rentCycle?: string; status?: string; maximumOccupants?: number; notes?: string }, expectedVersion: number): Promise<DataResult<Room>>;
  archiveRoom(roomId: string, expectedVersion: number): Promise<DataResult<boolean>>;
  clearRoomOverride(roomId: string, field: string, expectedVersion: number): Promise<DataResult<Room>>;
  previewPropagation(payload: { scope: 'DORMITORY' | 'BUILDING'; scopeId?: string; changes: { property?: Record<string, any>; billing?: Record<string, any>; [key: string]: any } }): Promise<DataResult<any>>;
  applyPropagation(payload: { scope: 'DORMITORY' | 'BUILDING'; scopeId?: string; changes: { property?: Record<string, any>; billing?: Record<string, any>; [key: string]: any }; expectedVersions?: { property?: number; billing?: number }; expectedVersion?: number; idempotencyKey: string }): Promise<DataResult<any>>;
  queryAvailability(params: { startDate: string; endDate: string; buildingId?: string }): Promise<DataResult<Room[]>>;
  getContractSnapshot(contractId: string): Promise<DataResult<any>>;
  createContract(payload: any): Promise<DataResult<Contract>>;
  activateContract(contractId: string, payload?: { ownerSignature?: string; tenantSignature?: string }): Promise<DataResult<Contract>>;
}

export interface OccupancyDataSource {
  getSummary(): Promise<DataResult<any>>;
  getFloorPlan(buildingId?: string): Promise<DataResult<any>>;
  moveOut(occupancyId: string, moveOutDate: string): Promise<DataResult<any>>;
  transferRoom(occupancyId: string, targetRoomId: string, transferDate: string): Promise<DataResult<any>>;
}

export interface HorPlusDataProvider {
  dormitories: DormitoryDataSource;
  dormitory?: DormitoryDataSource;
  rooms: RoomDataSource;
  tenants: TenantDataSource;
  contracts: ContractDataSource;
  meters: MeterDataSource;
  billing: BillingDataSource;
  maintenance: MaintenanceDataSource;
  announcements: AnnouncementDataSource;
  notifications: NotificationDataSource;
  audit: AuditDataSource;
  properties?: PropertyDataSource;

  staffRoles?: StaffRoleDataSource;
  tenantRegistrations?: TenantRegistrationDataSource;
  occupancies?: OccupancyDataSource;
}
