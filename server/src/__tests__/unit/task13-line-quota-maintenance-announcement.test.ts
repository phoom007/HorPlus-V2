import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinePushUsageService } from '../../services/line-push-usage.service.js';
import { AnnouncementService, AnnouncementRecipientResolver } from '../../services/announcement.service.js';
import { InMemoryAnnouncementRepository } from '../../db/repositories/announcement.repository.js';
import { InMemoryTenantRepository } from '../../db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../../db/repositories/room.repository.js';
import { InMemoryBuildingRepository } from '../../db/repositories/building.repository.js';
import { MaintenanceService } from '../../services/maintenance.service.js';
import { InMemoryMaintenanceRepository } from '../../db/repositories/maintenance.repository.js';
import { InMemoryMembershipRepository } from '../../db/repositories/membership.repository.js';
import { NotificationService } from '../../services/notification.service.js';
import { InMemoryNotificationRepository } from '../../db/repositories/notification.repository.js';
import { createMaintenanceRouter } from '../../routes/maintenance.routes.js';
import { createAnnouncementRouter } from '../../routes/announcement.routes.js';
import express from 'express';
import request from 'supertest';
import { AppError } from '../../types/index.js';

describe('TASK-013: LINE Quota, Maintenance Role Scoping & Announcement Quota Guard', () => {
  const testDormId = '11111111-1111-1111-1111-111111111111';
  const otherDormId = '99999999-9999-9999-9999-999999999999';

  describe('AC-1: LINE Quota Entitlement & Monthly Reset', () => {
    let mockPrisma: any;
    let quotaService: LinePushUsageService;

    beforeEach(() => {
      mockPrisma = {
        $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn(),
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({
            timezone: 'Asia/Bangkok',
          }),
        },
        dormitorySubscription: {
          findUnique: vi.fn().mockResolvedValue({
            status: 'ACTIVE',
            plan: { messageQuotaMonthly: 30 },
          }),
        },
        linePushUsage: {
          findUnique: vi.fn().mockResolvedValue({
            successCount: 10,
            reservedCount: 0,
          }),
        },
      };
      quotaService = new LinePushUsageService(mockPrisma);
    });

    it('derives periodKey in Asia/Bangkok timezone formatted as YYYY-MM', () => {
      const key = quotaService.getCurrentPeriodKey('Asia/Bangkok');
      expect(key).toMatch(/^\d{4}-\d{2}$/);
    });

    it('entitles Free plan to 30 messages/month and Paid plan to 300 messages/month', async () => {
      // Free plan
      mockPrisma.dormitorySubscription.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        plan: { messageQuotaMonthly: 30 },
      });
      const freeLimit = await quotaService.getQuotaLimit(testDormId);
      expect(freeLimit).toBe(30);

      // Paid plan
      mockPrisma.dormitorySubscription.findUnique.mockResolvedValueOnce({
        status: 'ACTIVE',
        plan: { messageQuotaMonthly: 300 },
      });
      const paidLimit = await quotaService.getQuotaLimit(testDormId);
      expect(paidLimit).toBe(300);

      // Fallback when no active subscription exists
      mockPrisma.dormitorySubscription.findUnique.mockResolvedValueOnce(null);
      const fallbackLimit = await quotaService.getQuotaLimit(testDormId);
      expect(fallbackLimit).toBe(30);
    });

    it('releases quota reservation without deducting quota on failed push delivery', async () => {
      const attemptId = 'att-123';
      const accessGrantId = 'grant-123';

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ id: attemptId, dormitory_id: testDormId, period_key: '2026-09', status: 'RESERVED' }])
        .mockResolvedValueOnce([{ id: 'usage-1', reserved_count: 1, success_count: 5 }]);

      mockPrisma.linePushDeliveryAttempt = { update: vi.fn().mockResolvedValue({}) };
      mockPrisma.dormitoryAccessGrant = { update: vi.fn().mockResolvedValue({}) };

      const result = await quotaService.finalizeDeliveryAttempt(attemptId, testDormId, accessGrantId, {
        outcome: 'DEFINITIVE_FAILURE',
        errorCode: 'BLOCKED_BY_USER',
      });

      expect(result.pushed).toBe(false);
      expect(result.deliveryStatus).toBe('failed');
      // Decrements reserved_count, does not increment success_count
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('AC-2 & AC-3: Announcement Publishing Quota Guard & Warning Notification', () => {
    let mockPrisma: any;
    let quotaService: LinePushUsageService;
    let mockNotificationService: any;

    beforeEach(() => {
      mockPrisma = {
        $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn(),
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({
            timezone: 'Asia/Bangkok',
          }),
        },
        dormitorySubscription: {
          findUnique: vi.fn().mockResolvedValue({
            status: 'ACTIVE',
            plan: { messageQuotaMonthly: 30 },
          }),
        },
      };
      mockNotificationService = {
        createInAppNotification: vi.fn().mockResolvedValue({}),
      };
      quotaService = new LinePushUsageService(mockPrisma);
    });

    it('rejects with canonical LINE_MESSAGE_QUOTA_INSUFFICIENT (HTTP 400) when available quota is insufficient', async () => {
      // 28 used out of 30, remaining = 2
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'usage-1', success_count: 28, reserved_count: 0 },
      ]);

      await expect(
        quotaService.consumeQuota(testDormId, 5, {
          notificationService: mockNotificationService,
        })
      ).rejects.toThrowError(AppError);

      try {
        mockPrisma.$queryRaw.mockResolvedValueOnce([
          { id: 'usage-1', success_count: 28, reserved_count: 0 },
        ]);
        await quotaService.consumeQuota(testDormId, 5);
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.code || err.errorCode).toBe('LINE_MESSAGE_QUOTA_INSUFFICIENT');
        expect(err.message).toContain('จำนวนโควตาข้อความ LINE ไม่เพียงพอ');
      }
    });

    it('successfully consumes quota when available quota is sufficient', async () => {
      // 10 used out of 30, remaining = 20; consuming 5 leaves 15
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'usage-1', success_count: 10, reserved_count: 0 },
      ]);

      const result = await quotaService.consumeQuota(testDormId, 5, {
        notificationService: mockNotificationService,
      });

      expect(result.remaining).toBe(15);
      expect(result.quotaLimit).toBe(30);
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('triggers in-app warning notification when remaining quota drops to or below threshold', async () => {
      // 24 used out of 30, remaining = 6; consuming 2 leaves 4 (threshold <= 5 on Free)
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { id: 'usage-1', success_count: 24, reserved_count: 0 },
      ]);

      const result = await quotaService.consumeQuota(testDormId, 2, {
        notificationService: mockNotificationService,
      });

      expect(result.remaining).toBe(4);
      expect(mockNotificationService.createInAppNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dormitoryId: testDormId,
          targetType: 'staff',
          category: 'LINE_QUOTA_WARNING',
          title: expect.stringContaining('จำนวนการส่งข้อความ LINE ใกล้หมด'),
        })
      );
    });
  });

  describe('AC-2 & AC-5: Announcement Service Audience Isolation & Route Integration', () => {
    let announcementService: AnnouncementService;
    let announcementRepo: InMemoryAnnouncementRepository;
    let tenantRepo: InMemoryTenantRepository;
    let contractRepo: InMemoryContractRepository;
    let roomRepo: InMemoryRoomRepository;
    let buildingRepo: InMemoryBuildingRepository;
    let mockQuotaService: any;
    let app: express.Express;

    beforeEach(async () => {
      announcementRepo = new InMemoryAnnouncementRepository();
      tenantRepo = new InMemoryTenantRepository();
      contractRepo = new InMemoryContractRepository();
      roomRepo = new InMemoryRoomRepository();
      buildingRepo = new InMemoryBuildingRepository();

      // Seed building, rooms, tenants, contracts
      await buildingRepo.create(testDormId, { id: 'bld-A', name: 'อาคาร A', code: 'A' } as any);
      await buildingRepo.create(testDormId, { id: 'bld-B', name: 'อาคาร B', code: 'B' } as any);

      await roomRepo.create(testDormId, { id: 'room-101', buildingId: 'bld-A', roomNumber: '101', normalizedRoomNumber: '101', floor: 1 } as any);
      await roomRepo.create(testDormId, { id: 'room-201', buildingId: 'bld-B', roomNumber: '201', normalizedRoomNumber: '201', floor: 2 } as any);

      await tenantRepo.create(testDormId, { id: 'tenant-1', firstName: 'สมชาย', lastName: 'ใจดี' } as any);
      await tenantRepo.create(testDormId, { id: 'tenant-2', firstName: 'สมศรี', lastName: 'มั่งมี' } as any);

      await contractRepo.create(testDormId, { id: 'c-1', tenantId: 'tenant-1', roomId: 'room-101', status: 'active' } as any);
      await contractRepo.create(testDormId, { id: 'c-2', tenantId: 'tenant-2', roomId: 'room-201', status: 'active' } as any);

      const resolver = new AnnouncementRecipientResolver(tenantRepo, contractRepo, roomRepo, buildingRepo);
      const notificationService = new NotificationService(new InMemoryNotificationRepository());

      mockQuotaService = {
        consumeQuota: vi.fn().mockResolvedValue({ remaining: 25, quotaLimit: 30, periodKey: '2026-09' }),
        getQuotaStatus: vi.fn().mockResolvedValue({ remaining: 25, quotaLimit: 30, periodKey: '2026-09' }),
      };

      announcementService = new AnnouncementService(announcementRepo, resolver, notificationService, mockQuotaService);

      app = express();
      app.use(express.json());
      // Middleware simulating authenticated owner session
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: 'owner-user-1',
          sessionId: 'sess-owner',
          roleCode: 'OWNER',
          dormitoryId: testDormId,
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'OWNER',
          permissions: ['*'],
        };
        next();
      });
      app.use('/api/v1/announcements', createAnnouncementRouter(announcementService));
    });

    it('isolates targeted announcements to eligible tenants only', async () => {
      // Announcement 1: Targeted only to Building A (tenant-1)
      const ann1 = await announcementService.createDraft({
        dormitoryId: testDormId,
        title: 'ซ่อมบำรุงตึก A',
        content: 'งดจ่ายน้ำชั่วคราวตึก A',
        audiences: [{ targetType: 'building', buildingId: 'bld-A' }],
        status: 'draft',
      });
      await announcementService.publishAnnouncement({ dormitoryId: testDormId, announcementId: ann1.id });

      // Announcement 2: Targeted only to Room 201 in Building B (tenant-2)
      const ann2 = await announcementService.createDraft({
        dormitoryId: testDormId,
        title: 'ตรวจสอบแอร์ห้อง 201',
        content: 'ช่างจะเข้าบ่ายสอง',
        audiences: [{ targetType: 'room', roomId: 'room-201' }],
        status: 'draft',
      });
      await announcementService.publishAnnouncement({ dormitoryId: testDormId, announcementId: ann2.id });

      // Tenant 1 should only see ann1
      const tenant1List = await announcementService.getTenantAnnouncements(testDormId, 'tenant-1');
      expect(tenant1List.map((a: any) => a.id)).toContain(ann1.id);
      expect(tenant1List.map((a: any) => a.id)).not.toContain(ann2.id);

      // Tenant 2 should only see ann2
      const tenant2List = await announcementService.getTenantAnnouncements(testDormId, 'tenant-2');
      expect(tenant2List.map((a: any) => a.id)).toContain(ann2.id);
      expect(tenant2List.map((a: any) => a.id)).not.toContain(ann1.id);
    });

    it('POST /api/v1/announcements/:id/publish rejects with HTTP 400 and canonical LINE_MESSAGE_QUOTA_INSUFFICIENT code', async () => {
      const draft = await announcementService.createDraft({
        dormitoryId: testDormId,
        title: 'ประกาศฉุกเฉิน',
        content: 'ทดสอบโควตาหมด',
        status: 'draft',
        audiences: [{ targetType: 'all_tenants' }],
      });

      mockQuotaService.consumeQuota.mockRejectedValueOnce(
        new AppError('จำนวนโควตาข้อความ LINE ไม่เพียงพอ', 400, 'LINE_MESSAGE_QUOTA_INSUFFICIENT')
      );

      const res = await request(app)
        .post(`/api/v1/announcements/${draft.id}/publish`)
        .send({ sendLinePush: true });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LINE_MESSAGE_QUOTA_INSUFFICIENT');
    });
  });

  describe('AC-4: Maintenance Assignment Scoping & Permissions', () => {
    let maintenanceService: MaintenanceService;
    let maintenanceRepo: InMemoryMaintenanceRepository;
    let membershipRepo: InMemoryMembershipRepository;
    let app: express.Express;

    const staffMemberId = 'mem-staff-001';
    const staffUserId = 'usr-staff-001';
    const otherStaffMemberId = 'mem-staff-002';

    let assignedReqId: string;
    let unassignedReqId: string;
    let crossDormReqId: string;

    beforeEach(async () => {
      maintenanceRepo = new InMemoryMaintenanceRepository();
      membershipRepo = new InMemoryMembershipRepository();

      (membershipRepo as any).members.clear();
      (membershipRepo as any).members.set(staffMemberId, {
        id: staffMemberId,
        userId: staffUserId,
        dormitoryId: testDormId,
        roleId: 'role-staff',
        roleCode: 'STAFF',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      maintenanceService = new MaintenanceService(
        maintenanceRepo,
        new InMemoryRoomRepository(),
        new InMemoryTenantRepository(),
        membershipRepo,
        new NotificationService(new InMemoryNotificationRepository())
      );

      // Create assigned request for staffMemberId
      const req1 = await maintenanceRepo.createRequest({
        dormitoryId: testDormId,
        tenantId: 't-1',
        roomId: 'r-1',
        category: 'plumbing',
        title: 'ก๊อกน้ำรั่ว ห้อง 101',
        description: 'น้ำซึม',
        status: 'assigned',
        assignedStaff: staffMemberId,
      });
      await maintenanceRepo.createAssignment({
        dormitoryId: testDormId,
        maintenanceRequestId: req1.id,
        assignedMemberId: staffMemberId,
        assignedByUserId: 'usr-owner-001',
      });
      assignedReqId = req1.id;

      // Create unassigned / assigned to other staff request
      const req2 = await maintenanceRepo.createRequest({
        dormitoryId: testDormId,
        tenantId: 't-2',
        roomId: 'r-2',
        category: 'electrical',
        title: 'ไฟไม่ติด ห้อง 202',
        description: 'สวิตช์เสีย',
        status: 'submitted',
      });
      unassignedReqId = req2.id;

      // Create cross-dormitory request
      const req3 = await maintenanceRepo.createRequest({
        dormitoryId: otherDormId,
        tenantId: 't-3',
        roomId: 'r-3',
        category: 'other',
        title: 'งานหอพักอื่น',
        description: 'งานนอกหอ',
        status: 'assigned',
        assignedStaff: staffMemberId,
      });
      crossDormReqId = req3.id;

      app = express();
      app.use(express.json());
    });

    it('Staff (Tech) can only see requests assigned to them on GET /api/v1/maintenance-requests', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: staffUserId,
          sessionId: 'sess-staff',
          roleCode: 'STAFF',
          dormitoryId: testDormId,
          memberships: [
            { id: staffMemberId, dormitoryId: testDormId, roleCode: 'STAFF' },
          ],
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'STAFF',
          permissions: ['maintenance:read', 'maintenance:view', 'maintenance:write'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      const res = await request(app).get('/api/v1/maintenance-requests');
      expect(res.status).toBe(200);
      const items = res.body.data || res.body.items;
      expect(items.length).toBe(1);
      expect(items[0].id).toBe(assignedReqId);
      expect(items.some((i: any) => i.id === unassignedReqId)).toBe(false);
    });

    it('Staff (Tech) can update status and close their assigned request', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: staffUserId,
          sessionId: 'sess-staff',
          roleCode: 'STAFF',
          dormitoryId: testDormId,
          memberships: [
            { id: staffMemberId, dormitoryId: testDormId, roleCode: 'STAFF' },
          ],
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'STAFF',
          permissions: ['maintenance:read', 'maintenance:write'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      // 1. Update status to in_progress
      const patchRes = await request(app)
        .patch(`/api/v1/maintenance-requests/${assignedReqId}/status`)
        .send({ status: 'in_progress', note: 'กำลังเปลี่ยนอะไหล่ก๊อก' });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe('in_progress');

      // 2. Tech closes assigned request (PO decision in Task 01)
      const closeRes = await request(app)
        .post(`/api/v1/maintenance-requests/${assignedReqId}/close`)
        .send({ note: 'เปลี่ยนเสร็จสิ้น ใช้งานได้ปกติ' });
      expect(closeRes.status).toBe(200);
      expect(closeRes.body.status).toBe('closed');
    });

    it('Staff (Tech) updating unassigned request is rejected with HTTP 403 Forbidden', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: staffUserId,
          sessionId: 'sess-staff',
          roleCode: 'STAFF',
          dormitoryId: testDormId,
          memberships: [
            { id: staffMemberId, dormitoryId: testDormId, roleCode: 'STAFF' },
          ],
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'STAFF',
          permissions: ['maintenance:read', 'maintenance:write'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      const res = await request(app)
        .patch(`/api/v1/maintenance-requests/${unassignedReqId}/status`)
        .send({ status: 'in_progress' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Staff (Tech) accessing cross-dormitory request is rejected with HTTP 403 Forbidden', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: staffUserId,
          sessionId: 'sess-staff',
          roleCode: 'STAFF',
          dormitoryId: testDormId,
          memberships: [
            { id: staffMemberId, dormitoryId: testDormId, roleCode: 'STAFF' },
          ],
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'STAFF',
          permissions: ['maintenance:read', 'maintenance:write'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      const res = await request(app).get(`/api/v1/maintenance-requests/${crossDormReqId}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Staff (Tech) cannot assign technicians (HTTP 403 Forbidden)', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: staffUserId,
          sessionId: 'sess-staff',
          roleCode: 'STAFF',
          dormitoryId: testDormId,
          memberships: [
            { id: staffMemberId, dormitoryId: testDormId, roleCode: 'STAFF' },
          ],
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'STAFF',
          permissions: ['maintenance:read', 'maintenance:write'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      const res = await request(app)
        .post(`/api/v1/maintenance-requests/${unassignedReqId}/assign`)
        .send({ assignedMemberId: otherStaffMemberId });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('Owner and Manager can view all requests and assign technicians', async () => {
      app.use((req, _res, next) => {
        (req as any).auth = {
          userId: 'usr-owner-001',
          sessionId: 'sess-owner',
          roleCode: 'OWNER',
          dormitoryId: testDormId,
        };
        (req as any).dormitoryContext = {
          dormitoryId: testDormId,
          roleCode: 'OWNER',
          permissions: ['*'],
        };
        next();
      });
      app.use('/api/v1/maintenance-requests', createMaintenanceRouter(maintenanceService));

      // Owner can see both assigned and unassigned requests
      const listRes = await request(app).get('/api/v1/maintenance-requests');
      expect(listRes.status).toBe(200);
      const items = listRes.body.data || listRes.body.items;
      expect(items.length).toBe(2);

      // Owner can assign technician
      const assignRes = await request(app)
        .post(`/api/v1/maintenance-requests/${unassignedReqId}/assign`)
        .send({ assignedMemberId: staffMemberId });
      expect(assignRes.status).toBe(200);
      expect(assignRes.body.request.status).toBe('assigned');
    });
  });
});
