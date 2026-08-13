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
    const rawData = await httpRequest<any>('GET', '/tenants');
    return Array.isArray(rawData) ? rawData : (rawData?.data || []);
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
      const nameParts = (tenantData.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || tenantData.name || 'ผู้เช่า';
      const lastName = nameParts.slice(1).join(' ') || undefined;
      const cleanEmail = tenantData.email && tenantData.email.trim() !== '' ? tenantData.email.trim() : undefined;
      const cleanNationalId = (tenantData.citizenId || (tenantData as any).nationalId || '').replace(/\D/g, '');

      const payload = {
        ...tenantData,
        firstName,
        lastName,
        email: cleanEmail,
        nationalId: cleanNationalId.length === 13 ? cleanNationalId : undefined,
      };

      const data = await httpRequest<Tenant>('POST', '/tenants', payload);
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
      const nameParts = (tenant.name || '').trim().split(/\s+/);
      const firstName = nameParts[0] || tenant.name || 'ผู้เช่า';
      const lastName = nameParts.slice(1).join(' ') || undefined;
      const cleanEmail = tenant.email && tenant.email.trim() !== '' ? tenant.email.trim() : undefined;
      const cleanNationalId = (tenant.citizenId || (tenant as any).nationalId || '').replace(/\D/g, '');

      const payload = {
        ...tenant,
        firstName,
        lastName,
        email: cleanEmail,
        nationalId: cleanNationalId.length === 13 ? cleanNationalId : undefined,
      };

      const data = await httpRequest<Tenant>('PUT', `/tenants/${tenant.id}`, payload);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async delete(id: string): Promise<DataResult<boolean>> {
    try {
      await httpRequest<any>('DELETE', `/tenants/${id}`);
      return { success: true, data: true };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async addCoOccupant(tenantId: string, coOccupant: { name: string; phone?: string; relationship?: string }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/tenants/${tenantId}/co-occupants`, coOccupant);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async updateCoOccupant(tenantId: string, coOccupantId: string, coOccupant: { name?: string; phone?: string; relationship?: string }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('PUT', `/tenants/${tenantId}/co-occupants/${coOccupantId}`, coOccupant);
      return { success: true, data };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async removeCoOccupant(tenantId: string, coOccupantId: string): Promise<DataResult<boolean>> {
    try {
      await httpRequest<any>('DELETE', `/tenants/${tenantId}/co-occupants/${coOccupantId}`);
      return { success: true, data: true };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }
}

export async function getTenantRegistrationRequests(): Promise<DataResult<any[]>> {
  try {
    const rawData = await httpRequest<any>('GET', '/tenant-registrations');
    const data = Array.isArray(rawData) ? rawData : (rawData?.data || []);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function submitTenantRegistrationRequest(payload: {
  dormitoryId?: string;
  requestedRoomId: string;
  firstName: string;
  lastName: string;
  phone: string;
  note?: string;
}): Promise<DataResult<any>> {
  try {
    const activeDormId = payload.dormitoryId || localStorage.getItem('selected_dormitory_id') || undefined;
    const bodyPayload = { ...payload, dormitoryId: activeDormId };
    const data = await httpRequest<any>('POST', '/tenant-registrations', bodyPayload);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export interface ApproveRegistrationPayload {
  startDate: string;
  endDate: string;
  durationMonths: number;
  rentAmount: string | number;
  depositAmount: string | number;
  advancePaymentAmount: string | number;
  terms?: string;
  confirmReplacement?: boolean;
}

export async function approveTenantRegistrationRequest(id: string, payload: ApproveRegistrationPayload): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/tenant-registrations/${id}/approve`, payload);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function getReplacementWarning(id: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('GET', `/tenant-registrations/${id}/replacement-warning`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function getRenewalEligibility(contractId: string, tenantId: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('GET', `/contract-renewals/eligibility?contractId=${contractId}&tenantId=${tenantId}`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function submitRenewalRequest(payload: { contractId: string; tenantId: string; requestedStartDate: string; requestedDurationMonths: number }): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/contract-renewals/request`, payload);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function getRenewalRequests(status?: string): Promise<DataResult<any>> {
  try {
    const query = status ? `?status=${status}` : '';
    const data = await httpRequest<any>('GET', `/contract-renewals/requests${query}`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function approveRenewalRequest(requestId: string, payload?: any): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/contract-renewals/requests/${requestId}/approve`, payload || {});
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function rejectRenewalRequest(requestId: string, reason?: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/contract-renewals/requests/${requestId}/reject`, { reason });
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function getContractSettlement(contractId: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('GET', `/settlements/${contractId}`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function addDamageChargeItem(settlementId: string, payload: { description: string; amount: number; evidenceUrl?: string }): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/settlements/${settlementId}/damage-items`, payload);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function editDamageChargeItem(itemId: string, payload: { description?: string; amount?: number; evidenceUrl?: string }): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('PUT', `/settlements/damage-items/${itemId}`, payload);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function softRemoveDamageChargeItem(itemId: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('DELETE', `/settlements/damage-items/${itemId}`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function confirmSettlement(settlementId: string, status: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/settlements/${settlementId}/confirm`, { status });
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function getTenantNotices(): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('GET', `/tenant-portal/notices`);
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function rejectTenantRegistrationRequest(id: string, reason?: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('POST', `/tenant-registrations/${id}/reject`, { reason });
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
  }
}

export async function updateTenantRegistrationRoom(id: string, requestedRoomId: string): Promise<DataResult<any>> {
  try {
    const data = await httpRequest<any>('PATCH', `/tenant-registrations/${id}`, { requestedRoomId });
    return { success: true, data };
  } catch (err: any) {
    return {
      success: false,
      error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
    };
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
      const payload = {
        ...contractData,
        rentAmount: String(contractData.rentAmount ?? '0'),
        depositAmount: String(contractData.depositAmount ?? '0'),
        advancePaymentAmount: String((contractData as any).advancePaymentAmount ?? '0'),
      };
      const data = await httpRequest<Contract>('POST', '/contracts', payload, {
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

  async activateContract(contractId: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/contracts/${contractId}/activate`);
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
    try {
      const res = await httpRequest<{ data: any[] }>('GET', `/meters/readings?billingCycleId=${cycleId}&pageSize=200`);
      return (res.data || []).map((r: any) => ({
        id: r.id,
        cycleId: r.billingCycleId,
        roomId: r.roomId,
        roomNumber: r.room?.roomNumber || r.roomId,
        waterReading: Number(r.meterType === 'water' ? r.currentReading : 0),
        electricityReading: Number(r.meterType === 'electricity' ? r.currentReading : 0),
        recordedAt: r.readAt || r.createdAt,
        ...r
      }));
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return [];
      throw err;
    }
  }

  async getByRoomAndCycle(roomId: string, cycleId: string): Promise<MeterReading | null> {
    try {
      const res = await httpRequest<{ data: any[] }>('GET', `/meters/readings?billingCycleId=${cycleId}&roomId=${roomId}`);
      const items = res.data || [];
      return items.length > 0 ? items[0] : null;
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async saveMeterRecord(record: Omit<MeterReading, 'id' | 'recordedAt'>): Promise<DataResult<MeterReading>> {
    try {
      const data = await httpRequest<MeterReading>('POST', '/meters/readings/bulk', {
        billingCycleId: (record as any).cycleId || (record as any).billingCycleId,
        readings: [
          {
            roomId: record.roomId,
            meterType: 'water',
            previousReading: String((record as any).waterPrev ?? 0),
            currentReading: String((record as any).waterCurr ?? (record as any).waterReading ?? 0)
          },
          {
            roomId: record.roomId,
            meterType: 'electricity',
            previousReading: String((record as any).elecPrev ?? 0),
            currentReading: String((record as any).elecCurr ?? (record as any).electricityReading ?? 0)
          }
        ]
      });
      return { success: true, data: data as any };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async saveBulkMeterRecords(records: Array<Omit<MeterReading, 'id' | 'recordedAt'>>, billingCycleId?: string): Promise<DataResult<MeterReading[]>> {
    try {
      const cycleId = billingCycleId || (records[0] as any)?.cycleId || (records[0] as any)?.billingCycleId;
      const formattedReadings = records.flatMap((r: any) => {
        const items = [];
        if (r.waterReading !== undefined || r.waterCurr !== undefined) {
          items.push({
            roomId: r.roomId,
            meterType: 'water',
            previousReading: String(r.waterPrev ?? 0),
            currentReading: String(r.waterCurr ?? r.waterReading ?? 0)
          });
        }
        if (r.electricityReading !== undefined || r.elecCurr !== undefined) {
          items.push({
            roomId: r.roomId,
            meterType: 'electricity',
            previousReading: String(r.elecPrev ?? 0),
            currentReading: String(r.elecCurr ?? r.electricityReading ?? 0)
          });
        }
        return items;
      });

      const data = await httpRequest<MeterReading[]>('POST', '/meters/readings/bulk', {
        billingCycleId: cycleId,
        readings: formattedReadings
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

export class ApiBillingAdapter implements BillingDataSource {
  async getAll(): Promise<Bill[]> {
    const res = await httpRequest<{ data: Bill[] }>('GET', '/bills');
    return res.data || (res as any);
  }

  async getById(id: string): Promise<Bill | null> {
    try {
      const res = await httpRequest<{ data: Bill }>('GET', `/bills/${id}`);
      return res.data || (res as any);
    } catch (err: any) {
      if (err instanceof HttpClientError && err.domainError.code === 'RESOURCE_NOT_FOUND') return null;
      throw err;
    }
  }

  async getByTenantId(tenantId: string): Promise<Bill[]> {
    const res = await httpRequest<{ data: Bill[] }>('GET', `/bills?tenantId=${tenantId}`);
    return res.data || (res as any);
  }

  async getByRoomId(roomId: string): Promise<Bill[]> {
    const res = await httpRequest<{ data: Bill[] }>('GET', `/bills?roomId=${roomId}`);
    return res.data || (res as any);
  }

  async getByCycle(cycleId: string): Promise<Bill[]> {
    const res = await httpRequest<{ data: Bill[] }>('GET', `/bills?billingCycleId=${cycleId}`);
    return res.data || (res as any);
  }

  async generateBillForRoom(roomId: string, cycleId: string): Promise<DataResult<Bill>> {
    try {
      const res = await httpRequest<{ data: { bill: Bill } }>('POST', '/bills/generate', {
        billingCycleId: cycleId,
        roomId
      }, {
        idempotencyKey: `gen_bill_${roomId}_${cycleId}`
      });
      return { success: true, data: res.data.bill };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message }
      };
    }
  }

  async generateBulkBills(cycleId: string, actorUserIdOrRoomIds?: any): Promise<DataResult<any>> {
    try {
      const roomIds = Array.isArray(actorUserIdOrRoomIds) ? actorUserIdOrRoomIds : undefined;
      const res = await httpRequest<any>('POST', '/bills/generate/bulk', {
        billingCycleId: cycleId,
        roomIds
      }, {
        idempotencyKey: `gen_bulk_bills_${cycleId}`
      });
      return { success: true, data: res.data || res };
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
      const res = await httpRequest<any>('GET', '/tenant-registrations');
      const list = Array.isArray(res) ? res : (res.data || []);
      return { success: true, data: list };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async approveRequest(params: { requestId: string; tenantId?: string; contractId?: string; payload?: any }): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/tenant-registrations/${params.requestId}/approve`, params.payload || params);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async rejectRequest(requestId: string, reason: string): Promise<DataResult<any>> {
    try {
      const data = await httpRequest<any>('POST', `/tenant-registrations/${requestId}/reject`, { reason });
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
      const response = await httpRequest<any>('GET', '/properties/dormitory/defaults');
      const defaults = response?.data || response;
      return { success: true, data: defaults };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async updateDormitoryDefaults(payload: {
    property?: { changes: Record<string, any>; expectedVersion: number };
    billing?: { changes: Record<string, any>; expectedVersion: number };
  }): Promise<DataResult<any>> {
    try {
      const canonicalPropertyMap: Record<string, string> = {
        monthlyRent: 'defaultMonthlyRent',
        defaultMonthlyRent: 'defaultMonthlyRent',
        termRent: 'defaultTermRent',
        defaultTermRent: 'defaultTermRent',
        dailyRent: 'defaultDailyRent',
        defaultDailyRent: 'defaultDailyRent',
        depositAmount: 'defaultDeposit',
        deposit: 'defaultDeposit',
        defaultDeposit: 'defaultDeposit',
        advancePaymentAmount: 'defaultAdvancePayment',
        advancePayment: 'defaultAdvancePayment',
        defaultAdvancePayment: 'defaultAdvancePayment',
        parkingFee: 'defaultParkingFee',
        defaultParkingFee: 'defaultParkingFee',
        maximumOccupants: 'defaultMaxOccupants',
        maxOccupants: 'defaultMaxOccupants',
        defaultMaxOccupants: 'defaultMaxOccupants',
        roomType: 'defaultRoomType',
        defaultRoomType: 'defaultRoomType',
        terms: 'defaultTerms',
        defaultTerms: 'defaultTerms',
      };

      const canonicalBillingMap: Record<string, string> = {
        waterUnitRate: 'waterRate',
        waterRate: 'waterRate',
        electricUnitRate: 'electricityRate',
        electricRate: 'electricityRate',
        electricityRate: 'electricityRate',
        waterBillingMode: 'waterBillingType',
        waterBillingType: 'waterBillingType',
        electricBillingMode: 'electricityBillingType',
        electricBillingType: 'electricityBillingType',
        electricityBillingType: 'electricityBillingType',
        commonFee: 'commonFee',
        internetFee: 'internetFee',
        rentBillingType: 'rentBillingType',
        billingDay: 'billingDay',
        dueDay: 'dueDay',
        lateFeeType: 'lateFeeType',
        lateFeeValue: 'lateFeeValue',
      };

      const cleanPayload: any = {};
      if (payload.property) {
        const cleanChanges: Record<string, any> = {};
        for (const [k, v] of Object.entries(payload.property.changes)) {
          cleanChanges[canonicalPropertyMap[k] || k] = v;
        }
        cleanPayload.property = {
          changes: cleanChanges,
          expectedVersion: payload.property.expectedVersion,
        };
      }
      if (payload.billing) {
        const cleanChanges: Record<string, any> = {};
        for (const [k, v] of Object.entries(payload.billing.changes)) {
          cleanChanges[canonicalBillingMap[k] || k] = v;
        }
        cleanPayload.billing = {
          changes: cleanChanges,
          expectedVersion: payload.billing.expectedVersion,
        };
      }

      const response = await httpRequest<any>('PUT', '/properties/dormitory/defaults', cleanPayload);
      const result = response?.data || response;
      return { success: true, data: result };
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

  async previewPropagation(payload: any): Promise<DataResult<any>> {
    try {
      const canonicalPropertyMap: Record<string, string> = {
        monthlyRent: 'defaultMonthlyRent',
        termRent: 'defaultTermRent',
        dailyRent: 'defaultDailyRent',
        depositAmount: 'defaultDeposit',
        deposit: 'defaultDeposit',
        advancePaymentAmount: 'defaultAdvancePayment',
        advancePayment: 'defaultAdvancePayment',
        parkingFee: 'defaultParkingFee',
        maximumOccupants: 'defaultMaxOccupants',
        maxOccupants: 'defaultMaxOccupants',
        roomType: 'defaultRoomType',
        terms: 'defaultTerms',
      };

      const canonicalBillingMap: Record<string, string> = {
        waterUnitRate: 'waterRate',
        electricUnitRate: 'electricityRate',
        waterBillingMode: 'waterBillingType',
        electricBillingMode: 'electricityBillingType',
      };

      const cleanPayload: any = { scope: payload.scope };
      if (payload.scopeId) cleanPayload.scopeId = payload.scopeId;

      if (payload.scope === 'DORMITORY') {
        const changesObj: any = {};
        if (payload.changes?.property) {
          changesObj.property = {};
          for (const [k, v] of Object.entries(payload.changes.property)) {
            changesObj.property[canonicalPropertyMap[k] || k] = v;
          }
        }
        if (payload.changes?.billing) {
          changesObj.billing = {};
          for (const [k, v] of Object.entries(payload.changes.billing)) {
            changesObj.billing[canonicalBillingMap[k] || k] = v;
          }
        }
        cleanPayload.changes = changesObj;
      } else {
        cleanPayload.changes = payload.changes;
      }

      const response = await httpRequest<any>('POST', '/properties/defaults/preview', cleanPayload);
      const preview = response?.data || response;
      return { success: true, data: preview };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async applyPropagation(payload: any): Promise<DataResult<any>> {
    try {
      const canonicalPropertyMap: Record<string, string> = {
        monthlyRent: 'defaultMonthlyRent',
        termRent: 'defaultTermRent',
        dailyRent: 'defaultDailyRent',
        depositAmount: 'defaultDeposit',
        deposit: 'defaultDeposit',
        advancePaymentAmount: 'defaultAdvancePayment',
        advancePayment: 'defaultAdvancePayment',
        parkingFee: 'defaultParkingFee',
        maximumOccupants: 'defaultMaxOccupants',
        maxOccupants: 'defaultMaxOccupants',
        roomType: 'defaultRoomType',
        terms: 'defaultTerms',
      };

      const canonicalBillingMap: Record<string, string> = {
        waterUnitRate: 'waterRate',
        electricUnitRate: 'electricityRate',
        waterBillingMode: 'waterBillingType',
        electricBillingMode: 'electricityBillingType',
      };

      const cleanPayload: any = { scope: payload.scope, idempotencyKey: payload.idempotencyKey };
      if (payload.scopeId) cleanPayload.scopeId = payload.scopeId;
      if (payload.expectedVersions) cleanPayload.expectedVersions = payload.expectedVersions;
      if (payload.expectedVersion) cleanPayload.expectedVersion = payload.expectedVersion;

      if (payload.scope === 'DORMITORY') {
        const changesObj: any = {};
        if (payload.changes?.property) {
          changesObj.property = {};
          for (const [k, v] of Object.entries(payload.changes.property)) {
            changesObj.property[canonicalPropertyMap[k] || k] = v;
          }
        }
        if (payload.changes?.billing) {
          changesObj.billing = {};
          for (const [k, v] of Object.entries(payload.changes.billing)) {
            changesObj.billing[canonicalBillingMap[k] || k] = v;
          }
        }
        cleanPayload.changes = changesObj;
      } else {
        cleanPayload.changes = payload.changes;
      }

      const data = await httpRequest<any>('POST', '/properties/defaults/apply', cleanPayload);
      return { success: true, data };
    } catch (err: any) {
      return { success: false, error: err instanceof HttpClientError ? err.domainError : { code: 'INTERNAL_ERROR', message: err.message } };
    }
  }

  async queryAvailability(params: { startDate: string; endDate: string; buildingId?: string }): Promise<DataResult<Room[]>> {
    try {
      const cleanParams: Record<string, string> = {
        startDate: params.startDate,
        endDate: params.endDate
      };
      if (params.buildingId && params.buildingId !== 'undefined' && params.buildingId !== 'all') {
        cleanParams.buildingId = params.buildingId;
      }
      const queryStr = '?' + new URLSearchParams(cleanParams).toString();
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
