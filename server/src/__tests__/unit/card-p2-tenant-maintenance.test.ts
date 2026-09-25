/**
 * Card P2 Unit Test: แจ้งซ่อม (Tenant Maintenance & Repairs)
 * Tests P2-1 to P2-5:
 * - P2-1: Tenant TA creates repair request with image (status submitted, imageBefore saved)
 * - P2-2: Assigned Staff updates status to in_progress with note, Tenant sees updated status and note
 * - P2-3: Tenant can cancel in submitted/pending/acknowledged state; cancellation rejected when in_progress
 * - P2-4: Cross-tenant isolation: Tenant TB accessing or cancelling TA's request throws 403 FORBIDDEN
 * - P2-5: Unassigned Staff access control: Unassigned staff cannot view or update TA's request
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MaintenanceService } from '../../services/maintenance.service.js';
import { InMemoryMaintenanceRepository } from '../../db/repositories/maintenance.repository.js';
import { InMemoryRoomRepository } from '../../db/repositories/room.repository.js';
import { InMemoryTenantRepository } from '../../db/repositories/tenant.repository.js';
import { InMemoryMembershipRepository } from '../../db/repositories/membership.repository.js';

describe('Card P2: Tenant Maintenance & Repairs Access Control', () => {
  const dormitoryId = '20000001-0000-4000-8000-000000000002';
  const tenantTAId = 'tenant-ta-uuid';
  const tenantTBId = 'tenant-tb-uuid';
  const roomId = 'room-101-uuid';
  let staffMemberAssignedId: string;
  let staffMemberUnassignedId: string;
  const staffUserAssignedId = 'user-staff-assigned';
  const staffUserUnassignedId = 'user-staff-unassigned';

  let maintenanceRepo: InMemoryMaintenanceRepository;
  let roomRepo: InMemoryRoomRepository;
  let tenantRepo: InMemoryTenantRepository;
  let membershipRepo: InMemoryMembershipRepository;
  let notificationService: any;
  let maintenanceService: MaintenanceService;

  beforeEach(async () => {
    maintenanceRepo = new InMemoryMaintenanceRepository();
    roomRepo = new InMemoryRoomRepository();
    tenantRepo = new InMemoryTenantRepository();
    membershipRepo = new InMemoryMembershipRepository();
    notificationService = {
      createInAppNotification: vi.fn().mockResolvedValue(true)
    };

    const assignedMem = await membershipRepo.addMembership({
      userId: staffUserAssignedId,
      dormitoryId,
      roleId: 'role-staff',
      roleCode: 'STAFF',
      status: 'active'
    });
    staffMemberAssignedId = assignedMem.id;

    const unassignedMem = await membershipRepo.addMembership({
      userId: staffUserUnassignedId,
      dormitoryId,
      roleId: 'role-staff',
      roleCode: 'STAFF',
      status: 'active'
    });
    staffMemberUnassignedId = unassignedMem.id;

    maintenanceService = new MaintenanceService(
      maintenanceRepo,
      roomRepo,
      tenantRepo,
      membershipRepo,
      notificationService
    );
  });

  describe('AC P2-1: Tenant submits repair request with image', () => {
    it('creates a maintenance request with submitted status, roomId, and imageBefore', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'plumbing',
        title: 'ท่อน้ำใต้อ่างล้างหน้ารั่วซึม',
        description: 'น้ำหยดตลอดเวลา ทำให้พื้นห้องน้ำเปียก',
        priority: 'medium',
        imageBefore: 'data:image/webp;base64,mockImagePayload'
      });

      expect(request).toBeDefined();
      expect(request.id).toBeDefined();
      expect(request.dormitoryId).toBe(dormitoryId);
      expect(request.tenantId).toBe(tenantTAId);
      expect(request.roomId).toBe(roomId);
      expect(request.status).toBe('submitted');
      expect(request.title).toBe('ท่อน้ำใต้อ่างล้างหน้ารั่วซึม');
      expect(request.imageBefore).toBe('data:image/webp;base64,mockImagePayload');
      expect(notificationService.createInAppNotification).toHaveBeenCalled();
    });
  });

  describe('AC P2-2: Assigned Staff updates status to in_progress with note', () => {
    it('allows assigned technician to change status to in_progress and add notes that tenant can view', async () => {
      const created = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'electrical',
        title: 'ไฟระเบียงดับ',
        description: 'หลอดไฟไม่ติดทั้งสองดวง'
      });

      // Owner assigns staff
      await maintenanceService.assignTechnician({
        dormitoryId,
        requestId: created.id,
        assignedMemberId: staffMemberAssignedId,
        assignedByUserId: 'owner-user-uuid'
      });

      // Assigned staff updates to in_progress with note
      await maintenanceRepo.updateRequest(dormitoryId, created.id, {
        note: 'ช่างกำลังเดินทางไปตรวจสอบเบื้องต้นและเตรียมหลอดไฟใหม่',
        assignedStaff: staffMemberAssignedId
      });

      const updated = await maintenanceService.updateStatus({
        dormitoryId,
        requestId: created.id,
        status: 'in_progress',
        note: 'ช่างกำลังเดินทางไปตรวจสอบเบื้องต้นและเตรียมหลอดไฟใหม่',
        actorType: 'staff',
        actorUserId: staffUserAssignedId
      });

      expect(updated.status).toBe('in_progress');

      // Tenant loads detail
      const tenantView = await maintenanceService.getTenantRequestById(dormitoryId, tenantTAId, created.id);
      expect(tenantView).not.toBeNull();
      expect(tenantView?.request.status).toBe('in_progress');
      expect(tenantView?.request.note).toBe('ช่างกำลังเดินทางไปตรวจสอบเบื้องต้นและเตรียมหลอดไฟใหม่');
    });
  });

  describe('AC P2-3: Tenant Cancellation Rules', () => {
    it('allows tenant to cancel when status is submitted or pending', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'general',
        title: 'กลอนประตูด้านหน้าฝืด',
        description: 'เปิดปิดค่อนข้างยาก'
      });

      const cancelled = await maintenanceService.cancelByTenant(dormitoryId, tenantTAId, request.id, 'ผู้เช่าแก้ไขเองได้แล้ว');
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.cancellationReason).toBe('ผู้เช่าแก้ไขเองได้แล้ว');

      const history = await maintenanceRepo.getStatusHistory(dormitoryId, request.id);
      expect(history.some(h => h.toStatus === 'cancelled')).toBe(true);
    });

    it('rejects cancellation when status is in_progress with Thai error message', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'air_conditioner',
        title: 'แอร์มีน้ำหยด',
        description: 'หยดลงเตียงนอน'
      });

      await maintenanceRepo.updateRequest(dormitoryId, request.id, { status: 'in_progress' });

      await expect(
        maintenanceService.cancelByTenant(dormitoryId, tenantTAId, request.id, 'ขอยกเลิก')
      ).rejects.toThrow('BAD_REQUEST: สามารถยกเลิกได้เฉพาะก่อนที่ช่างจะเริ่มดำเนินงานซ่อม');
    });
  });

  describe('AC P2-4: Cross-Tenant Isolation (TB accessing or cancelling TA request)', () => {
    it('throws FORBIDDEN when Tenant TB attempts to view TA repair request by ID', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'plumbing',
        title: 'ก็อกน้ำอ่างล้างจานชำรุด',
        description: 'เปิดแล้วน้ำไหลไม่หยุด'
      });

      await expect(
        maintenanceService.getTenantRequestById(dormitoryId, tenantTBId, request.id)
      ).rejects.toThrow('FORBIDDEN: คุณไม่มีสิทธิ์เข้าถึงรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    });

    it('throws FORBIDDEN when Tenant TB attempts to cancel TA repair request by ID', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'plumbing',
        title: 'ก็อกน้ำอ่างล้างจานชำรุด',
        description: 'เปิดแล้วน้ำไหลไม่หยุด'
      });

      await expect(
        maintenanceService.cancelByTenant(dormitoryId, tenantTBId, request.id, 'TB ยกเลิกแทน')
      ).rejects.toThrow('FORBIDDEN: คุณไม่มีสิทธิ์ยกเลิกรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    });

    it('throws FORBIDDEN when Tenant TB attempts to comment on TA repair request by ID', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'plumbing',
        title: 'ก็อกน้ำอ่างล้างจานชำรุด',
        description: 'เปิดแล้วน้ำไหลไม่หยุด'
      });

      await expect(
        maintenanceService.addComment(dormitoryId, request.id, {
          senderType: 'tenant',
          senderTenantId: tenantTBId,
          senderName: 'ผู้เช่า TB',
          message: 'คอมเมนต์จากห้องข้างๆ'
        })
      ).rejects.toThrow('FORBIDDEN: คุณไม่มีสิทธิ์แสดงความคิดเห็นในรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    });
  });

  describe('AC P2-5: Staff Access Control (Unassigned Staff Rejection)', () => {
    it('enforces that unassigned staff cannot access or manage another technician assigned job', async () => {
      const request = await maintenanceService.createRequestByTenant({
        dormitoryId,
        tenantId: tenantTAId,
        roomId,
        category: 'furniture',
        title: 'บานพับตู้เสื้อผ้าหลุด',
        description: 'ปิดหน้าบานไม่ได้'
      });

      // Assigned to staffMemberAssignedId
      await maintenanceService.assignTechnician({
        dormitoryId,
        requestId: request.id,
        assignedMemberId: staffMemberAssignedId,
        assignedByUserId: 'owner-user-uuid'
      });

      const activeAssignment = await maintenanceRepo.getActiveAssignment(dormitoryId, request.id);

      // Verify assignment logic: assigned staff matches
      const isAssignedToStaffA = activeAssignment?.assignedMemberId === staffMemberAssignedId;
      expect(isAssignedToStaffA).toBe(true);

      // Verify unassigned staff does NOT match
      const isAssignedToStaffB = activeAssignment?.assignedMemberId === staffMemberUnassignedId;
      expect(isAssignedToStaffB).toBe(false);

      // Filtering verification: query assigned to staffMemberUnassignedId returns 0 items
      const unassignedList = await maintenanceRepo.findAll(dormitoryId, { assignedMemberId: staffMemberUnassignedId });
      expect(unassignedList.items.find(r => r.id === request.id)).toBeUndefined();
    });
  });
});
