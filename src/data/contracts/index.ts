/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Dormitory,
  Building,
  Room,
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
  | 'INTERNAL_ERROR';

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
}

export interface BillingDataSource {
  getAll(): Promise<Bill[]>;
  getById(id: string): Promise<Bill | null>;
  getByTenantId(tenantId: string): Promise<Bill[]>;
  getByRoomId(roomId: string): Promise<Bill[]>;
  getByCycle(cycleId: string): Promise<Bill[]>;
  generateBillForRoom(roomId: string, cycleId: string, actorUserId?: string): Promise<DataResult<Bill>>;
  generateBulkBills(cycleId: string, actorUserId?: string): Promise<DataResult<Bill[]>>;
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
  assignRole(params: { followerId: string; roleCode: 'OWNER' | 'MANAGER' | 'TECH' }): Promise<DataResult<any>>;
  revokeRole(assignmentId: string, reason?: string): Promise<DataResult<any>>;
}

export interface TenantRegistrationDataSource {
  getAvailableRooms(): Promise<DataResult<any[]>>;
  submitRegistration(params: { requestedRoomId: string; firstName: string; lastName: string; phone: string; note?: string }): Promise<DataResult<any>>;
  getRegistrationStatus(): Promise<DataResult<any>>;
  listRequests(): Promise<DataResult<any[]>>;
  approveRequest(params: { requestId: string; tenantId: string; contractId: string }): Promise<DataResult<any>>;
  rejectRequest(requestId: string, reason: string): Promise<DataResult<any>>;
}

export interface OccupancyDataSource {
  getSummary(): Promise<DataResult<any>>;
  getFloorPlan(buildingId?: string): Promise<DataResult<any>>;
  moveOut(occupancyId: string, moveOutDate: string): Promise<DataResult<any>>;
  transferRoom(occupancyId: string, targetRoomId: string, transferDate: string): Promise<DataResult<any>>;
}

export interface HorPlusDataProvider {
  dormitories: DormitoryDataSource;
  rooms: RoomDataSource;
  tenants: TenantDataSource;
  contracts: ContractDataSource;
  meters: MeterDataSource;
  billing: BillingDataSource;
  maintenance: MaintenanceDataSource;
  announcements: AnnouncementDataSource;
  notifications: NotificationDataSource;
  audit: AuditDataSource;

  staffRoles?: StaffRoleDataSource;
  tenantRegistrations?: TenantRegistrationDataSource;
  occupancies?: OccupancyDataSource;
}
