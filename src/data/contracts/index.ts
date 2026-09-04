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
  AuditLog
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

export interface TenantDataSource {
  getAll(): Promise<Tenant[]>;
  getById(id: string): Promise<Tenant | null>;
  getByRoomId(roomId: string): Promise<Tenant | null>;
  addTenant(tenantData: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Tenant>>;
  updateTenant(tenant: Tenant, actorUserId?: string): Promise<DataResult<Tenant>>;
  addCoOccupant(tenantId: string, coOccupant: { name: string; phone?: string; relationship?: string }): Promise<DataResult<any>>;
  updateCoOccupant(tenantId: string, coOccupantId: string, coOccupant: { name?: string; phone?: string; relationship?: string }): Promise<DataResult<any>>;
  removeCoOccupant(tenantId: string, coOccupantId: string): Promise<DataResult<boolean>>;
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
