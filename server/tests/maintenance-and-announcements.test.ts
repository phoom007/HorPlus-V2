import { describe, it, expect, beforeEach } from 'vitest';
import { MaintenanceService } from '../src/services/maintenance.service.ts';
import { AnnouncementService, AnnouncementRecipientResolver } from '../src/services/announcement.service.ts';
import { NotificationService } from '../src/services/notification.service.ts';

import { InMemoryMaintenanceRepository } from '../src/db/repositories/maintenance.repository.js';
import { InMemoryAnnouncementRepository } from '../src/db/repositories/announcement.repository.js';
import { InMemoryNotificationRepository } from '../src/db/repositories/notification.repository.js';
import { InMemoryTenantRepository } from '../src/db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../src/db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../src/db/repositories/room.repository.js';
import { InMemoryBuildingRepository } from '../src/db/repositories/building.repository.js';
import { InMemoryMembershipRepository } from '../src/db/repositories/membership.repository.js';

describe('Maintenance, Announcements & Notification Engine', () => {

  let maintenanceRepo: InMemoryMaintenanceRepository;
  let announcementRepo: InMemoryAnnouncementRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let tenantRepo: InMemoryTenantRepository;
  let contractRepo: InMemoryContractRepository;
  let roomRepo: InMemoryRoomRepository;
  let buildingRepo: InMemoryBuildingRepository;
  let membershipRepo: InMemoryMembershipRepository;


  let notificationService: NotificationService;
  let maintenanceService: MaintenanceService;
  let announcementService: AnnouncementService;

  const dormId = 'dorm_test_123';

  beforeEach(async () => {

    maintenanceRepo = new InMemoryMaintenanceRepository();
    announcementRepo = new InMemoryAnnouncementRepository();
    notificationRepo = new InMemoryNotificationRepository();
    tenantRepo = new InMemoryTenantRepository();
    contractRepo = new InMemoryContractRepository();
    roomRepo = new InMemoryRoomRepository();
    buildingRepo = new InMemoryBuildingRepository();
    membershipRepo = new InMemoryMembershipRepository();

    notificationService = new NotificationService(notificationRepo);
    maintenanceService = new MaintenanceService(maintenanceRepo, roomRepo, tenantRepo, membershipRepo, notificationService);

    const resolver = new AnnouncementRecipientResolver(tenantRepo, contractRepo, roomRepo, buildingRepo);
    announcementService = new AnnouncementService(announcementRepo, resolver, notificationService);



    // Setup Building & Room
    const b = await buildingRepo.create(dormId, { name: 'Building A' });
    const r = await roomRepo.create(dormId, { buildingId: b.id, roomNumber: '101', floor: 1, baseRent: 5000 });

    // Setup Tenant & Active Contract
    const t = await tenantRepo.create(dormId, { firstName: 'สมชาย', lastName: 'ใจดี', phone: '0812345678', citizenId: '1234567890123' });
    await contractRepo.create(dormId, { roomId: r.id, tenantId: t.id, startDate: '2026-01-01', endDate: '2026-12-31', monthlyRent: 5000, depositAmount: 10000, status: 'active' });

    // Setup Staff Member
    await membershipRepo.addMembership({ dormitoryId: dormId, userId: 'user_tech_1', roleId: 'role_tech', roleCode: 'TECH', status: 'active' });


  });

  describe('1. Maintenance Service', () => {
    const getTenantAndRoom = async () => {
      const tRes = await tenantRepo.findAll(dormId);
      const rRes = await roomRepo.findAll(dormId);
      return { tenant: tRes.items[0], room: rRes.items[0] };
    };

    it('creates maintenance request by tenant and records updates & notifications', async () => {
      const { tenant, room } = await getTenantAndRoom();

      const request = await maintenanceService.createRequestByTenant({
        dormitoryId: dormId,
        tenantId: tenant.id,
        roomId: room.id,
        category: 'PLUMBING',
        title: 'ก๊อกน้ำรั่ว',
        description: 'น้ำหยดตลอดเวลาที่อ่างล้างหน้า'
      });

      expect(request).toBeDefined();
      expect(request.requestNumber).toMatch(/^MNT-/);
      expect(request.status).toBe('submitted');

      // Check In-App Notification for Staff
      const staffNotifs = await notificationService.getStaffNotifications(dormId);
      expect(staffNotifs.length).toBeGreaterThan(0);
      expect(staffNotifs[0].title).toContain('รายการแจ้งซ่อมใหม่');
    });

    it('enforces status transition state machine rules', async () => {
      const { tenant, room } = await getTenantAndRoom();

      const req = await maintenanceService.createRequestByTenant({
        dormitoryId: dormId,
        tenantId: tenant.id,
        roomId: room.id,
        category: 'ELECTRICAL',
        title: 'ไฟไม่ติด',
        description: 'หลอดไฟห้องนอนดับ'
      });

      // Cannot jump from submitted straight to closed
      await expect(
        maintenanceService.updateStatus({
          dormitoryId: dormId,
          requestId: req.id,
          status: 'closed',
          actorType: 'owner'
        })
      ).rejects.toThrow(/INVALID_MAINTENANCE_STATUS_TRANSITION/);

      // Transition submitted -> acknowledged
      const ack = await maintenanceService.acknowledgeRequest(dormId, req.id, 'user_owner_1');
      expect(ack.status).toBe('acknowledged');

      // Transition acknowledged -> in_progress
      const progress = await maintenanceService.updateStatus({
        dormitoryId: dormId,
        requestId: req.id,
        status: 'in_progress',
        actorType: 'tech',
        actorRoleCode: 'TECH'
      });
      expect(progress.status).toBe('in_progress');

      // Tenant cannot cancel when in_progress
      await expect(
        maintenanceService.cancelByTenant(dormId, tenant.id, req.id)
      ).rejects.toThrow(/FORBIDDEN: Tenants can only cancel maintenance requests before work is in progress/);
    });

    it('prevents TECH role from closing maintenance requests', async () => {
      const { tenant, room } = await getTenantAndRoom();

      const req = await maintenanceService.createRequestByTenant({
        dormitoryId: dormId,
        tenantId: tenant.id,
        roomId: room.id,
        category: 'AIR_CONDITIONING',
        title: 'แอร์ไม่เย็น',
        description: 'แอร์มีแต่ลมร้อน'
      });

      await maintenanceService.acknowledgeRequest(dormId, req.id, 'user_owner');
      await maintenanceService.updateStatus({ dormitoryId: dormId, requestId: req.id, status: 'in_progress', actorType: 'tech', actorRoleCode: 'TECH' });
      await maintenanceService.updateStatus({ dormitoryId: dormId, requestId: req.id, status: 'resolved', actorType: 'tech', actorRoleCode: 'TECH' });

      // TECH attempting to close
      await expect(
        maintenanceService.updateStatus({
          dormitoryId: dormId,
          requestId: req.id,
          status: 'closed',
          actorType: 'tech',
          actorRoleCode: 'TECH'
        })
      ).rejects.toThrow(/FORBIDDEN: TECH role is not permitted to close maintenance requests/);
    });

    it('records costs and comments properly', async () => {
      const { tenant, room } = await getTenantAndRoom();

      const req = await maintenanceService.createRequestByTenant({
        dormitoryId: dormId,
        tenantId: tenant.id,
        roomId: room.id,
        category: 'OTHER',
        title: 'กลอนประตูชำรุด',
        description: 'กลอนล็อกไม่ได้'
      });

      await maintenanceService.addComment(dormId, req.id, {
        senderType: 'tenant',
        senderTenantId: tenant.id,
        senderName: 'สมชาย',
        message: 'สะดวกให้เข้าซ่อมวันเสาร์ครับ'
      });

      const cost = await maintenanceService.updateCost(dormId, req.id, {
        laborCost: '300.00',
        materialCost: '150.00',
        note: 'เปลี่ยนลูกบิดประตูใหม่'
      });

      expect(cost.totalCost).toBe('450.00');

      const detail = await maintenanceService.getStaffRequestById(dormId, req.id);
      expect(detail?.comments.length).toBe(1);
      expect(detail?.cost?.totalCost).toBe('450.00');
    });
  });

  describe('2. Announcement Service', () => {
    it('creates draft, previews recipients, and publishes announcement using LINE quota', async () => {
      const draft = await announcementService.createDraft({
        dormitoryId: dormId,
        title: 'แจ้งปิดปรับปรุงระบบน้ำ',
        content: 'จะมีการปิดน้ำเพื่อซ่อมบำรุงในวันพรุ่งนี้เวลา 09:00 - 12:00 น.',
        audiences: [{ targetType: 'all_tenants' }]
      });

      expect(draft.status).toBe('draft');

      const preview = await announcementService.previewRecipients(dormId, draft.id);
      expect(preview.totalRecipients).toBe(1);

      const published = await announcementService.publishAnnouncement({
        dormitoryId: dormId,
        announcementId: draft.id,
        publishedByUserId: 'user_staff_1'
      });

      expect(published.status).toBe('published');

      // Verify tenant read receipt listing
      const tenantsRes = await tenantRepo.findAll(dormId);
      const tenant = tenantsRes.items[0];
      const tenantAnnouncements = await announcementService.getTenantAnnouncements(dormId, tenant.id);
      expect(tenantAnnouncements.length).toBe(1);
      expect(tenantAnnouncements[0].isRead).toBe(false);

      // Mark read
      await announcementService.markAsReadByTenant(dormId, draft.id, tenant.id);
      const updatedList = await announcementService.getTenantAnnouncements(dormId, tenant.id);
      expect(updatedList[0].isRead).toBe(true);
    });
  });
});
