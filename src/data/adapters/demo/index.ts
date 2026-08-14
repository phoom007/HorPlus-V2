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

  StaffRoleDataSource,
  TenantRegistrationDataSource,
  DataResult
} from '../../contracts';

import {
  dormitoryRepository,
  roomRepository,
  tenantRepository,
  contractRepository,
  meterRepository,
  billingRepository,
  
  
  maintenanceRepository,
  announcementRepository,
  notificationRepository,
  auditRepository
} from '../../../demo/repositories';

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

export class DemoDormitoryAdapter implements DormitoryDataSource {
  async getAll(): Promise<Dormitory[]> {
    return dormitoryRepository.getAll();
  }

  async getById(id: string): Promise<Dormitory | null> {
    return dormitoryRepository.getById(id) || null;
  }

  async update(dormitory: Dormitory): Promise<DataResult<Dormitory>> {
    dormitoryRepository.saveCurrent(dormitory);
    return { success: true, data: dormitory };
  }

  async getBuildings(): Promise<Building[]> {
    return dormitoryRepository.getBuildings();
  }

  async addBuilding(buildingData: Omit<Building, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataResult<Building>> {
    const building: Building = {
      ...buildingData,
      id: `bld-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    dormitoryRepository.addBuilding(building);
    return { success: true, data: building };
  }

  async updateBuilding(building: Building): Promise<DataResult<Building>> {
    dormitoryRepository.updateBuilding?.(building);
    return { success: true, data: building };
  }

  async deleteBuilding(buildingId: string): Promise<DataResult<boolean>> {
    dormitoryRepository.deleteBuilding?.(buildingId);
    return { success: true, data: true };
  }
}

export class DemoRoomAdapter implements RoomDataSource {
  async getAll(): Promise<Room[]> {
    return roomRepository.getAll();
  }

  async getById(id: string): Promise<Room | null> {
    return roomRepository.getById(id) || null;
  }

  async getByNumber(roomNumber: string): Promise<Room | null> {
    return roomRepository.getByNumber(roomNumber) || null;
  }

  async addRoom(roomData: Omit<Room, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Room>> {
    const res = roomRepository.addRoom(roomData, actorUserId);
    if (res.success && res.room) {
      return { success: true, data: res.room };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'เพิ่มห้องพักไม่สำเร็จ' } };
  }

  async updateRoom(room: Room, actorUserId?: string): Promise<DataResult<Room>> {
    const res = roomRepository.updateRoom(room, actorUserId);
    if (res.success && res.room) {
      return { success: true, data: res.room };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'แก้ไขห้องพักไม่สำเร็จ' } };
  }

  async updateStatus(roomId: string, status: Room['status'], currentTenantId?: string, actorUserId?: string): Promise<DataResult<Room>> {
    const ok = roomRepository.updateStatus(roomId, status, currentTenantId, actorUserId);
    if (ok) {
      const room = roomRepository.getById(roomId);
      if (room) return { success: true, data: room };
    }
    return { success: false, error: { code: 'VALIDATION_ERROR', message: 'อัปเดตสถานะห้องพักไม่สำเร็จ' } };
  }

  async deleteRoom(roomId: string, actorUserId?: string): Promise<DataResult<boolean>> {
    const res = roomRepository.deleteRoom(roomId, actorUserId);
    if (res.success) {
      return { success: true, data: true };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'ลบห้องพักไม่สำเร็จ' } };
  }
}

export class DemoTenantAdapter implements TenantDataSource {
  async getAll(): Promise<Tenant[]> {
    return tenantRepository.getAll();
  }

  async getById(id: string): Promise<Tenant | null> {
    return tenantRepository.getById(id) || null;
  }

  async getByRoomId(roomId: string): Promise<Tenant | null> {
    const contracts = contractRepository.getByRoomId(roomId);
    const activeContract = contracts.find(c => c.status === 'active');
    if (!activeContract) return null;
    return tenantRepository.getById(activeContract.tenantId) || null;
  }

  async addTenant(tenantData: Omit<Tenant, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Tenant>> {
    const res = tenantRepository.addTenant(tenantData, actorUserId);
    if (res.success && res.tenant) {
      return { success: true, data: res.tenant };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'เพิ่มผู้เช่าไม่สำเร็จ' } };
  }

  async updateTenant(tenant: Tenant, actorUserId?: string): Promise<DataResult<Tenant>> {
    const res = tenantRepository.updateTenant(tenant, actorUserId);
    if (res.success && res.tenant) {
      return { success: true, data: res.tenant };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'แก้ไขข้อมูลผู้เช่าไม่สำเร็จ' } };
  }

  async addCoOccupant(tenantId: string, coOccupant: { name: string; phone?: string; relationship?: string }): Promise<DataResult<any>> {
    const tenant = tenantRepository.getById(tenantId);
    if (!tenant) return { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบผู้เช่า' } };
    const newCo = { id: `co-${Date.now()}`, name: coOccupant.name, phone: coOccupant.phone || '', relationship: coOccupant.relationship };
    tenant.coOccupants = tenant.coOccupants || [];
    tenant.coOccupants.push(newCo);
    return { success: true, data: newCo };
  }

  async updateCoOccupant(tenantId: string, coOccupantId: string, coOccupant: { name?: string; phone?: string; relationship?: string }): Promise<DataResult<any>> {
    const tenant = tenantRepository.getById(tenantId);
    if (!tenant) return { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบผู้เช่า' } };
    const target = tenant.coOccupants?.find((c) => c.id === coOccupantId);
    if (!target) return { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบผู้พักร่วม' } };
    if (coOccupant.name) target.name = coOccupant.name;
    if (coOccupant.phone) target.phone = coOccupant.phone;
    if (coOccupant.relationship) target.relationship = coOccupant.relationship;
    return { success: true, data: target };
  }

  async removeCoOccupant(tenantId: string, coOccupantId: string): Promise<DataResult<boolean>> {
    const tenant = tenantRepository.getById(tenantId);
    if (!tenant) return { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'ไม่พบผู้เช่า' } };
    if (tenant.coOccupants) {
      tenant.coOccupants = tenant.coOccupants.filter((c) => c.id !== coOccupantId);
    }
    return { success: true, data: true };
  }
}

export class DemoContractAdapter implements ContractDataSource {
  async getAll(): Promise<Contract[]> {
    return contractRepository.getAll();
  }

  async getById(id: string): Promise<Contract | null> {
    return contractRepository.getById(id) || null;
  }

  async getByTenantId(tenantId: string): Promise<Contract[]> {
    return contractRepository.getAll().filter(c => c.tenantId === tenantId);
  }

  async getByRoomId(roomId: string): Promise<Contract[]> {
    return contractRepository.getByRoomId(roomId);
  }

  async checkOverlap(roomId: string, startDate: string, endDate: string, excludeContractId?: string): Promise<boolean> {
    return contractRepository.checkOverlap(roomId, startDate, endDate, excludeContractId);
  }

  async addContract(contractData: Omit<Contract, 'id' | 'createdAt' | 'updatedAt'>, actorUserId?: string): Promise<DataResult<Contract>> {
    const res = contractRepository.addContract(contractData, actorUserId);
    if (res.success && res.contract) {
      return { success: true, data: res.contract };
    }
    return { success: false, message: res.message, error: { code: 'CONTRACT_OVERLAP', message: res.message || 'สร้างสัญญาเช่าไม่สำเร็จ' } };
  }
}

export class DemoMeterAdapter implements MeterDataSource {
  async getByCycle(cycleId: string): Promise<MeterReading[]> {
    return meterRepository.getByCycle(cycleId);
  }

  async getByRoomAndCycle(roomId: string, cycleId: string): Promise<MeterReading | null> {
    return meterRepository.getByRoomAndCycle(roomId, cycleId) || null;
  }

  async saveMeterRecord(record: Omit<MeterReading, 'id' | 'recordedAt'>, actorUserId?: string): Promise<DataResult<MeterReading>> {
    const res = meterRepository.recordReading(record, actorUserId);
    if (res.success && res.reading) {
      return { success: true, data: res.reading };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'บันทึกมิเตอร์ไม่สำเร็จ' } };
  }

  async saveBulkMeterRecords(records: Array<Omit<MeterReading, 'id' | 'recordedAt'>>, actorUserId?: string): Promise<DataResult<MeterReading[]>> {
    const saved: MeterReading[] = [];
    for (const rec of records) {
      const res = meterRepository.recordReading(rec, actorUserId);
      if (res.success && res.reading) saved.push(res.reading);
    }
    return { success: true, data: saved };
  }

  async getCyclePeopleCount(cycleId: string, roomId?: string): Promise<DataResult<any[]>> {
    return { success: true, data: [] };
  }

  async updateCyclePeopleCount(cycleId: string, roomId: string, peopleCount: number): Promise<DataResult<any>> {
    return { success: true, data: { cycleId, roomId, peopleCount } };
  }
}

export class DemoBillingAdapter implements BillingDataSource {
  async getAll(): Promise<Bill[]> {
    return billingRepository.getAll();
  }

  async getById(id: string): Promise<Bill | null> {
    return billingRepository.getById(id) || null;
  }

  async getByTenantId(tenantId: string): Promise<Bill[]> {
    return billingRepository.getByTenantId(tenantId);
  }

  async getByRoomId(roomId: string): Promise<Bill[]> {
    return billingRepository.getAll().filter(b => b.roomId === roomId);
  }

  async getByCycle(cycleId: string): Promise<Bill[]> {
    return billingRepository.getByCycle(cycleId);
  }

  async generateBillForRoom(roomId: string, cycleId: string, actorUserId?: string): Promise<DataResult<Bill>> {
    const res = billingRepository.generateBillForRoom(roomId, cycleId, actorUserId);
    if (res.success && res.bill) {
      return { success: true, data: res.bill };
    }
    return {
      success: false,
      message: res.message,
      error: { code: 'DUPLICATE_BILL', message: res.message || 'ไม่สามารถออกใบแจ้งหนี้ได้' }
    };
  }

  async generateBulkBills(cycleId: string, actorUserId?: string): Promise<DataResult<Bill[]>> {
    const rooms = roomRepository.getAll().filter(r => r.status === 'occupied');
    const created: Bill[] = [];
    for (const r of rooms) {
      const res = billingRepository.generateBillForRoom(r.id, cycleId, actorUserId);
      if (res.success && res.bill) created.push(res.bill);
    }
    return { success: true, data: created };
  }

  async updateBillStatus(billId: string, status: Bill['status'], actorUserId?: string): Promise<DataResult<Bill>> {
    const res = billingRepository.updateBillStatus(billId, status, actorUserId);
    if (res.success) {
      const updatedBill = billingRepository.getById(billId);
      if (updatedBill) return { success: true, data: updatedBill };
    }
    return {
      success: false,
      message: res.message,
      error: { code: 'RESOURCE_NOT_FOUND', message: res.message || 'ไม่พบใบแจ้งหนี้ที่ระบุ' }
    };
  }
}

export class DemoPaymentAdapter implements PaymentDataSource {}



export class DemoMaintenanceAdapter implements MaintenanceDataSource {
  async getAll(): Promise<MaintenanceRequest[]> {
    return maintenanceRepository.getAll();
  }

  async getById(id: string): Promise<MaintenanceRequest | null> {
    return maintenanceRepository.getById(id) || null;
  }

  async getByTenantId(tenantId: string): Promise<MaintenanceRequest[]> {
    return maintenanceRepository.getByTenantId(tenantId);
  }

  async createRequest(data: Omit<MaintenanceRequest, 'id' | 'createdAt' | 'updatedAt' | 'updates'>, actorUserId?: string): Promise<DataResult<MaintenanceRequest>> {
    const res = maintenanceRepository.createRequest(data, actorUserId);
    if (res.success && res.request) {
      return { success: true, data: res.request };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'สร้างรายการแจ้งซ่อมไม่สำเร็จ' } };
  }

  async updateStatus(requestId: string, status: MaintenanceRequest['status'], note?: string, actorUserId?: string): Promise<DataResult<MaintenanceRequest>> {
    const res = maintenanceRepository.updateStatus(requestId, status, note || '', actorUserId);
    if (res.success) {
      const updated = maintenanceRepository.getById(requestId);
      if (updated) return { success: true, data: updated };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'อัปเดตสถานะการแจ้งซ่อมไม่สำเร็จ' } };
  }
}

export class DemoAnnouncementAdapter implements AnnouncementDataSource {
  async getAll(): Promise<Announcement[]> {
    return announcementRepository.getAll();
  }

  async getById(id: string): Promise<Announcement | null> {
    return announcementRepository.getById(id) || null;
  }

  async createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt'>, actorUserId?: string): Promise<DataResult<Announcement>> {
    const res = announcementRepository.createAnnouncement(data, actorUserId);
    if (res.success && res.announcement) {
      return { success: true, data: res.announcement };
    }
    return { success: false, message: res.message, error: { code: 'VALIDATION_ERROR', message: res.message || 'สร้างประกาศไม่สำเร็จ' } };
  }
}

export class DemoNotificationAdapter implements NotificationDataSource {
  async getByUser(userId: string): Promise<Notification[]> {
    return notificationRepository.getByUserId(userId);
  }

  async markAsRead(notificationId: string): Promise<DataResult<boolean>> {
    notificationRepository.markAsRead(notificationId);
    return { success: true, data: true };
  }

  async addNotification(userId: string, title: string, message: string, type: Notification['type'], relatedEntityId?: string): Promise<DataResult<Notification>> {
    const notif = notificationRepository.addNotification(userId, title, message, type, relatedEntityId);
    return { success: true, data: notif };
  }
}

export class DemoAuditAdapter implements AuditDataSource {
  async getAll(): Promise<AuditLog[]> {
    return auditRepository.getAll();
  }

  async addLog(userId: string, action: string, details: string, entityType: string, entityId: string): Promise<DataResult<AuditLog>> {
    auditRepository.addLog(userId, action, details, entityType, entityId);
    const logs = auditRepository.getAll();
    const created = logs[0] || {
      id: `audit-${Date.now()}`,
      userId,
      userName: 'ผู้ใช้งาน',
      userRole: 'เจ้าของระบบ',
      action,
      details,
      entityType,
      entityId,
      timestamp: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    return { success: true, data: created };
  }
}



export class DemoStaffRoleAdapter implements StaffRoleDataSource {
  async getFollowers(): Promise<DataResult<any[]>> {
    return {
      success: true,
      data: [
        {
          id: 'fol-001',
          lineIdentityId: 'ident-001',
          displayName: 'สมชาย ใจดี',
          pictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=somchai',
          friendStatus: 'following',
          followedAt: new Date().toISOString(),
          roleCode: null,
          roleStatus: 'unassigned'
        },
        {
          id: 'fol-002',
          lineIdentityId: 'ident-002',
          displayName: 'วิภาวี สุขใจ',
          pictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wipawee',
          friendStatus: 'following',
          followedAt: new Date().toISOString(),
          roleCode: 'MANAGER',
          roleStatus: 'active'
        }
      ]
    };
  }

  async assignRole(params: any): Promise<DataResult<any>> {
    return {
      success: true,
      data: {
        success: true,
        assignmentId: `role-assign-${Date.now()}`,
        roleCode: params.roleCode,
        displayName: 'สมชาย ใจดี',

        notificationError: null
      }
    };
  }

  async revokeRole(): Promise<DataResult<any>> {
    return { success: true, data: { success: true } };
  }
}

export class DemoTenantRegistrationAdapter implements TenantRegistrationDataSource {
  async getAvailableRooms(): Promise<DataResult<any[]>> {
    return {
      success: true,
      data: [
        { roomId: 'room-101', roomNumber: '101', displayLabel: '101' },
        { roomId: 'room-102', roomNumber: '102', displayLabel: '102' },
        { roomId: 'room-201', roomNumber: '201', displayLabel: '201' }
      ]
    };
  }

  async submitRegistration(): Promise<DataResult<any>> {
    return {
      success: true,
      data: {
        success: true,
        requestId: `req-${Date.now()}`,
        status: 'pending_owner_approval',
        message: 'ส่งคำขอลงทะเบียนเรียบร้อยแล้ว ขณะนี้กำลังรอเจ้าของหอพักตรวจสอบ'
      }
    };
  }

  async getRegistrationStatus(): Promise<DataResult<any>> {
    return {
      success: true,
      data: {
        hasBinding: false,
        binding: null,
        pendingRequest: null
      }
    };
  }

  async listRequests(): Promise<DataResult<any[]>> {
    return {
      success: true,
      data: [
        {
          id: 'req-001',
          lineIdentityId: 'ident-tenant-01',
          displayName: 'อนันต์ สุขสวัสดิ์',
          pictureUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=anan',
          requestedRoomId: 'room-101',
          firstName: 'อนันต์',
          lastName: 'สุขสวัสดิ์',
          phone: '0812345678',
          note: 'ขอย้ายเข้าต้นเดือนหน้าครับ',
          status: 'pending_owner_approval',
          submittedAt: new Date().toISOString(),
          suggestedTenantId: 'tenant-101',
          suggestedContractId: 'contract-101',
          version: 1
        }
      ]
    };
  }

  async approveRequest(params: any): Promise<DataResult<any>> {
    return {
      success: true,
      data: {
        success: true,
        requestId: params.requestId,
        status: 'approved',
        hasPendingPayment: true,

        notificationError: null
      }
    };
  }

  async rejectRequest(requestId: string): Promise<DataResult<any>> {
    return {
      success: true,
      data: { success: true, requestId, status: 'rejected' }
    };
  }

  async updateRequestRoom(requestId: string, requestedRoomId: string): Promise<DataResult<any>> {
    return {
      success: true,
      data: { success: true, id: requestId, requestedRoomId }
    };
  }
}

export class DemoDataProvider implements HorPlusDataProvider {
  public dormitories = new DemoDormitoryAdapter();
  public rooms = new DemoRoomAdapter();
  public tenants = new DemoTenantAdapter();
  public contracts = new DemoContractAdapter();
  public meters = new DemoMeterAdapter();
  public billing = new DemoBillingAdapter();
  public maintenance = new DemoMaintenanceAdapter();
  public announcements = new DemoAnnouncementAdapter();
  public notifications = new DemoNotificationAdapter();
  public audit = new DemoAuditAdapter();

  public staffRoles = new DemoStaffRoleAdapter();
  public tenantRegistrations = new DemoTenantRegistrationAdapter();
}
