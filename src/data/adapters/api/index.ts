/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  HorPlusDataProvider,
  DormitoryDataSource,
  RoomDataSource,
  TenantDataSource,
  ContractDataSource,
  MeterDataSource,
  BillingDataSource,
  PaymentDataSource,
  MaintenanceDataSource,
  AnnouncementDataSource,
  NotificationDataSource,
  AuditDataSource,
  PropertyDataSource,

  StaffRoleDataSource,
  TenantRegistrationDataSource,
  OccupancyDataSource,
  DataResult
} from '../../contracts';

import { httpRequest, HttpClientError } from '../../httpClient';

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
} from '../../../types';

export class ApiDormitoryAdapter implements DormitoryDataSource {
  async getAll(): Promise<Dormitory[]> {
    return httpRequest<Dormitory[]>('GET', '/dormitories');
  }

  async getById(id: string): Promise<Dormitory | null> {
    try {
      return await httpRequest<Dormitory>('GET', `/dormitories/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  async update(dormitory: Dormitory): Promise<DataResult<Dormitory>> {
    try {
      const data = await httpRequest<Dormitory>('PUT', `/dormitories/${dormitory.id}`, dormitory, {
        dormitoryId: dormitory.id
      });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async getBuildings(): Promise<Building[]> {
    return httpRequest<Building[]>('GET', '/buildings');
  }

  async addBuilding(buildingData: Omit<Building, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('POST', '/buildings', buildingData);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateBuilding(building: Building): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('PUT', `/buildings/${building.id}`, building);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async deleteBuilding(buildingId: string): Promise<DataResult<boolean>> {
    try {
      await httpRequest('DELETE', `/buildings/${buildingId}`);
      return { success: true, data: true };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiRoomAdapter implements RoomDataSource {
  async getAll(): Promise<Room[]> {
    return httpRequest<Room[]>('GET', '/rooms');
  }

  async getById(id: string): Promise<Room | null> {
    try {
      return await httpRequest<Room>('GET', `/rooms/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByNumber(roomNumber: string): Promise<Room | null> {
    try {
      return await httpRequest<Room>('GET', `/rooms/number/${encodeURIComponent(roomNumber)}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async addRoom(roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('POST', '/rooms', roomData, {
        idempotencyKey: `room_add_${Date.now()}`
      });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateRoom(room: Room): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('PUT', `/rooms/${room.id}`, room);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateStatus(roomId: string, status: Room['status'], currentTenantId?: string): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('PATCH', `/rooms/${roomId}/status`, { status, currentTenantId });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async deleteRoom(roomId: string): Promise<DataResult<boolean>> {
    try {
      await httpRequest('DELETE', `/rooms/${roomId}`);
      return { success: true, data: true };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiTenantAdapter implements TenantDataSource {
  async getAll(): Promise<Tenant[]> {
    return httpRequest<Tenant[]>('GET', '/tenants');
  }

  async getById(id: string): Promise<Tenant | null> {
    try {
      return await httpRequest<Tenant>('GET', `/tenants/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByRoomId(roomId: string): Promise<Tenant | null> {
    try {
      return await httpRequest<Tenant>('GET', `/tenants/room/${roomId}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async addTenant(tenantData: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataResult<Tenant>> {
    try {
      const data = await httpRequest<Tenant>('POST', '/tenants', tenantData);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateTenant(tenant: Tenant): Promise<DataResult<Tenant>> {
    try {
      const data = await httpRequest<Tenant>('PUT', `/tenants/${tenant.id}`, tenant);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiContractAdapter implements ContractDataSource {
  async getAll(): Promise<Contract[]> {
    return httpRequest<Contract[]>('GET', '/contracts');
  }

  async getById(id: string): Promise<Contract | null> {
    try {
      return await httpRequest<Contract>('GET', `/contracts/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByTenantId(tenantId: string): Promise<Contract[]> {
    return httpRequest<Contract[]>('GET', `/contracts/tenant/${tenantId}`);
  }

  async getByRoomId(roomId: string): Promise<Contract[]> {
    return httpRequest<Contract[]>('GET', `/contracts/room/${roomId}`);
  }

  async checkOverlap(roomId: string, startDate: string, endDate: string, excludeContractId?: string): Promise<boolean> {
    const res = await httpRequest<{ isOverlap: boolean }>('POST', '/contracts/check-overlap', {
      roomId,
      startDate,
      endDate,
      excludeContractId
    });
    return res.isOverlap;
  }

  async addContract(contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataResult<Contract>> {
    try {
      const data = await httpRequest<Contract>('POST', '/contracts', contractData, {
        idempotencyKey: `contract_add_${Date.now()}`
      });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiMeterAdapter implements MeterDataSource {
  async getByCycle(cycleId: string): Promise<MeterReading[]> {
    return httpRequest<MeterReading[]>('GET', `/meters/cycle/${cycleId}`);
  }

  async getByRoomAndCycle(roomId: string, cycleId: string): Promise<MeterReading | null> {
    try {
      return await httpRequest<MeterReading>('GET', `/meters/room/${roomId}/cycle/${cycleId}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async saveMeterRecord(record: Omit<MeterReading, 'id' | 'recordedAt'>): Promise<DataResult<MeterReading>> {
    try {
      const data = await httpRequest<MeterReading>('POST', '/meters', record);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async saveBulkMeterRecords(records: Array<Omit<MeterReading, 'id' | 'recordedAt'>>): Promise<DataResult<MeterReading[]>> {
    try {
      const data = await httpRequest<MeterReading[]>('POST', '/meters/bulk', { records });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiBillingAdapter implements BillingDataSource {
  async getAll(): Promise<Bill[]> {
    return httpRequest<Bill[]>('GET', '/bills');
  }

  async getById(id: string): Promise<Bill | null> {
    try {
      return await httpRequest<Bill>('GET', `/bills/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByTenantId(tenantId: string): Promise<Bill[]> {
    return httpRequest<Bill[]>('GET', `/bills/tenant/${tenantId}`);
  }

  async getByRoomId(roomId: string): Promise<Bill[]> {
    return httpRequest<Bill[]>('GET', `/bills/room/${roomId}`);
  }

  async getByCycle(cycleId: string): Promise<Bill[]> {
    return httpRequest<Bill[]>('GET', `/bills/cycle/${cycleId}`);
  }

  async generateBillForRoom(roomId: string, cycleId: string): Promise<DataResult<Bill>> {
    try {
      const data = await httpRequest<Bill>('POST', `/bills/generate/room/${roomId}`, { cycleId }, {
        idempotencyKey: `gen_bill_${roomId}_${cycleId}`
      });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async generateBulkBills(cycleId: string): Promise<DataResult<Bill[]>> {
    try {
      const data = await httpRequest<Bill[]>('POST', '/bills/generate/bulk', { cycleId }, {
        idempotencyKey: `gen_bulk_bills_${cycleId}`
      });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateBillStatus(billId: string, status: Bill['status']): Promise<DataResult<Bill>> {
    try {
      const data = await httpRequest<Bill>('PATCH', `/bills/${billId}/status`, { status });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiPaymentAdapter implements PaymentDataSource {}



export class ApiMaintenanceAdapter implements MaintenanceDataSource {
  async getAll(): Promise<MaintenanceRequest[]> {
    return httpRequest<MaintenanceRequest[]>('GET', '/maintenance');
  }

  async getById(id: string): Promise<MaintenanceRequest | null> {
    try {
      return await httpRequest<MaintenanceRequest>('GET', `/maintenance/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByTenantId(tenantId: string): Promise<MaintenanceRequest[]> {
    return httpRequest<MaintenanceRequest[]>('GET', `/maintenance/tenant/${tenantId}`);
  }

  async createRequest(data: Omit<MaintenanceRequest, 'id' | 'createdAt' | 'updatedAt' | 'updates'>): Promise<DataResult<MaintenanceRequest>> {
    try {
      const res = await httpRequest<MaintenanceRequest>('POST', '/maintenance', data);
      return { success: true, data: res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateStatus(requestId: string, status: MaintenanceRequest['status'], note?: string): Promise<DataResult<MaintenanceRequest>> {
    try {
      const data = await httpRequest<MaintenanceRequest>('PATCH', `/maintenance/${requestId}/status`, { status, note });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiAnnouncementAdapter implements AnnouncementDataSource {
  async getAll(): Promise<Announcement[]> {
    return httpRequest<Announcement[]>('GET', '/announcements');
  }

  async getById(id: string): Promise<Announcement | null> {
    try {
      return await httpRequest<Announcement>('GET', `/announcements/${id}`);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt'>): Promise<DataResult<Announcement>> {
    try {
      const res = await httpRequest<Announcement>('POST', '/announcements', data);
      return { success: true, data: res };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiNotificationAdapter implements NotificationDataSource {
  async getByUser(userId: string): Promise<Notification[]> {
    return httpRequest<Notification[]>('GET', `/notifications/user/${userId}`);
  }

  async markAsRead(notificationId: string): Promise<DataResult<boolean>> {
    try {
      await httpRequest('PATCH', `/notifications/${notificationId}/read`);
      return { success: true, data: true };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async addNotification(userId: string, title: string, message: string, type: Notification['type'], relatedEntityId?: string): Promise<DataResult<Notification>> {
    try {
      const data = await httpRequest<Notification>('POST', '/notifications', { userId, title, message, type, relatedEntityId });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export class ApiAuditAdapter implements AuditDataSource {
  async getAll(): Promise<AuditLog[]> {
    return httpRequest<AuditLog[]>('GET', '/audit');
  }

  async addLog(userId: string, action: string, details: string, entityType: string, entityId: string): Promise<DataResult<AuditLog>> {
    try {
      const data = await httpRequest<AuditLog>('POST', '/audit', { userId, action, details, entityType, entityId });
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}



export class ApiStaffRoleAdapter implements StaffRoleDataSource {
  async getFollowers(params?: { friendStatus?: string; search?: string }): Promise<DataResult<any[]>> {
    try {
      const query = new URLSearchParams();
      if (params?.friendStatus) query.set('friendStatus', params.friendStatus);
      if (params?.search) query.set('search', params.search);
      const url = `/line/followers?${query.toString()}`;
      const data = await httpRequest<any[]>('GET', url);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async assignRole(params: { followerId: string; roleCode: 'OWNER' | 'MANAGER' | 'TECH' }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', '/staff-role-assignments', params);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async revokeRole(assignmentId: string, reason?: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/staff-role-assignments/${assignmentId}/revoke`, { reason });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }
}

export class ApiTenantRegistrationAdapter implements TenantRegistrationDataSource {
  async getAvailableRooms(): Promise<DataResult<any[]>> {
    try {
      const data = await httpRequest<any[]>('GET', '/line/registration/rooms');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async submitRegistration(params: { requestedRoomId: string; firstName: string; lastName: string; phone: string; note?: string }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', '/line/registration/submit', params);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getRegistrationStatus(): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('GET', '/line/registration/status');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async listRequests(): Promise<DataResult<any[]>> {
    try {
      const data = await httpRequest<any[]>('GET', '/tenant-registration-requests');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async approveRequest(params: { requestId: string; tenantId: string; contractId: string }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/tenant-registration-requests/${params.requestId}/approve`, params);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async rejectRequest(requestId: string, reason: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/tenant-registration-requests/${requestId}/reject`, { reason });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }
}

export class ApiOccupancyAdapter implements OccupancyDataSource {
  async getSummary(): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('GET', '/occupancy/summary');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getFloorPlan(buildingId?: string): Promise<DataResult<any>> {
    try {
      const url = buildingId ? `/occupancy/floor-plan?buildingId=${buildingId}` : '/occupancy/floor-plan';
      const data = await httpRequest<any>('GET', url);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async moveOut(occupancyId: string, moveOutDate: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/occupancies/${occupancyId}/move-out`, { moveOutDate });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async transferRoom(occupancyId: string, targetRoomId: string, transferDate: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/occupancies/${occupancyId}/transfer`, { targetRoomId, transferDate });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }
}

export class ApiPropertyAdapter implements PropertyDataSource {
  async getAuthoritativeRooms(params?: Record<string, any>): Promise<DataResult<{ items: Room[]; pagination: any }>> {
    try {
      const queryStr = params ? '?' + new URLSearchParams(params).toString() : '';
      const data = await httpRequest<any>('GET', `/properties/rooms${queryStr}`);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getAuthoritativeRoom(id: string): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('GET', `/properties/rooms/${id}`);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getAuthoritativeBuildings(): Promise<DataResult<Building[]>> {
    try {
      const data = await httpRequest<Building[]>('GET', '/properties/buildings');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getAuthoritativeBuilding(id: string): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('GET', `/properties/buildings/${id}`);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getDormitoryDefaults(): Promise<DataResult<{ property: any; billing: any }>> {
    try {
      const data = await httpRequest<any>('GET', '/properties/dormitory/defaults');
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async updateDormitoryDefaults(payload: {
    property?: { changes: Record<string, any>; expectedVersion: number };
    billing?: { changes: Record<string, any>; expectedVersion: number };
  }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('PUT', '/properties/dormitory/defaults', payload);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async setBuildingDefaults(buildingId: string, changes: Record<string, any>, expectedVersion: number): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('PUT', `/properties/buildings/${buildingId}/defaults`, { ...changes, expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async updateBuildingIdentity(buildingId: string, changes: { name?: string; code?: string; floorCount?: number; description?: string; displayOrder?: number; numberingPattern?: string }, expectedVersion: number): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('PUT', `/properties/buildings/${buildingId}`, { ...changes, expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async archiveBuilding(buildingId: string, expectedVersion: number): Promise<DataResult<boolean>> {
    try {
      await httpRequest<any>('DELETE', `/properties/buildings/${buildingId}`, { expectedVersion });
      return { success: true, data: true };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async clearBuildingOverride(buildingId: string, field: string, expectedVersion: number): Promise<DataResult<Building>> {
    try {
      const data = await httpRequest<Building>('DELETE', `/properties/buildings/${buildingId}/defaults/${field}`, { expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async setRoomDefaults(roomId: string, changes: Record<string, any>, expectedVersion: number): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('PUT', `/properties/rooms/${roomId}/defaults`, { ...changes, expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async updateRoomIdentity(roomId: string, changes: { roomNumber?: string; buildingId?: string; floor?: number; roomType?: string; rentCycle?: string; status?: string; maximumOccupants?: number; notes?: string }, expectedVersion: number): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('PUT', `/properties/rooms/${roomId}`, { ...changes, expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async archiveRoom(roomId: string, expectedVersion: number): Promise<DataResult<boolean>> {
    try {
      await httpRequest<any>('DELETE', `/properties/rooms/${roomId}`, { expectedVersion });
      return { success: true, data: true };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async clearRoomOverride(roomId: string, field: string, expectedVersion: number): Promise<DataResult<Room>> {
    try {
      const data = await httpRequest<Room>('DELETE', `/properties/rooms/${roomId}/defaults/${field}`, { expectedVersion });
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async previewPropagation(payload: { scope: 'DORMITORY' | 'BUILDING'; scopeId?: string; changes: Record<string, any> }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', '/properties/defaults/preview', payload);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async applyPropagation(payload: { scope: 'DORMITORY' | 'BUILDING'; scopeId?: string; changes: Record<string, any>; expectedVersion: number; idempotencyKey: string }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', '/properties/defaults/apply', payload);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async queryAvailability(params: { startDate: string; endDate: string; buildingId?: string }): Promise<DataResult<Room[]>> {
    try {
      const queryStr = '?' + new URLSearchParams(params as any).toString();
      const data = await httpRequest<Room[]>('GET', `/properties/rooms/available${queryStr}`);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async getContractSnapshot(contractId: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('GET', `/properties/contracts/${contractId}/snapshot`);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async createContract(payload: any): Promise<DataResult<Contract>> {
    try {
      const data = await httpRequest<Contract>('POST', '/contracts', payload);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async activateContract(contractId: string, payload?: { ownerSignature?: string; tenantSignature?: string }): Promise<DataResult<Contract>> {
    try {
      const data = await httpRequest<Contract>('POST', `/contracts/${contractId}/activate`, payload || {});
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }
}

export class ApiDataProvider implements HorPlusDataProvider {
  public dormitories = new ApiDormitoryAdapter();
  public rooms = new ApiRoomAdapter();
  public tenants = new ApiTenantAdapter();
  public contracts = new ApiContractAdapter();
  public meters = new ApiMeterAdapter();
  public billing = new ApiBillingAdapter();
  public maintenance = new ApiMaintenanceAdapter();
  public announcements = new ApiAnnouncementAdapter();
  public notifications = new ApiNotificationAdapter();
  public audit = new ApiAuditAdapter();
  public properties = new ApiPropertyAdapter();

  public staffRoles = new ApiStaffRoleAdapter();
  public tenantRegistrations = new ApiTenantRegistrationAdapter();
  public occupancies = new ApiOccupancyAdapter();
}
