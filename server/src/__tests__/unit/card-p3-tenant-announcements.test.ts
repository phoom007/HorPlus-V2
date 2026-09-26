import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { AnnouncementService, AnnouncementRecipientResolver } from '../../services/announcement.service.js';
import {
  InMemoryAnnouncementRepository,
  AnnouncementEntity,
  AnnouncementAudienceEntity
} from '../../db/repositories/announcement.repository.js';
import { InMemoryTenantRepository } from '../../db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../../db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../../db/repositories/room.repository.js';
import { InMemoryBuildingRepository } from '../../db/repositories/building.repository.js';

describe('Card P3: In-App Announcements & Notifications (ประกาศและการแจ้งเตือนในแอป)', () => {
  const DORM_ID = 'dorm-uat-p3';
  const ROOM_101_ID = 'room-101-id';
  const ROOM_102_ID = 'room-102-id';
  const ROOM_201_ID = 'room-201-id';

  const TENANT_TA_ID = 'tenant-ta-id';
  const TENANT_TB_ID = 'tenant-tb-id';
  const TENANT_OTHER_ID = 'tenant-other-id';
  const TENANT_TC_FORMER_ID = 'tenant-tc-former-id';

  let announcementRepo: InMemoryAnnouncementRepository;
  let tenantRepo: InMemoryTenantRepository;
  let contractRepo: InMemoryContractRepository;
  let roomRepo: InMemoryRoomRepository;
  let buildingRepo: InMemoryBuildingRepository;
  let recipientResolver: AnnouncementRecipientResolver;
  let announcementService: AnnouncementService;
  let mockNotificationService: any;
  let mockQuotaService: any;

  beforeEach(() => {
    announcementRepo = new InMemoryAnnouncementRepository();
    tenantRepo = new InMemoryTenantRepository();
    contractRepo = new InMemoryContractRepository();
    roomRepo = new InMemoryRoomRepository();
    buildingRepo = new InMemoryBuildingRepository();

    // 1. Setup rooms
    roomRepo.rooms = [
      { id: ROOM_101_ID, dormitoryId: DORM_ID, roomNumber: '101', floor: 1, status: 'occupied' } as any,
      { id: ROOM_102_ID, dormitoryId: DORM_ID, roomNumber: '102', floor: 1, status: 'occupied' } as any,
      { id: ROOM_201_ID, dormitoryId: DORM_ID, roomNumber: '201', floor: 2, status: 'occupied' } as any,
    ];

    // 2. Setup tenants
    tenantRepo.tenants = new Map([
      [TENANT_TA_ID, { id: TENANT_TA_ID, dormitoryId: DORM_ID, firstName: 'สมชาย', lastName: 'ใจดี (TA)', status: 'active', tenantNumber: 'T-001' } as any],
      [TENANT_TB_ID, { id: TENANT_TB_ID, dormitoryId: DORM_ID, firstName: 'สมหญิง', lastName: 'ผู้เช่าบี (TB)', status: 'active', tenantNumber: 'T-002' } as any],
      [TENANT_OTHER_ID, { id: TENANT_OTHER_ID, dormitoryId: DORM_ID, firstName: 'สมศักดิ์', lastName: 'ห้องอื่น', status: 'active', tenantNumber: 'T-003' } as any],
      [TENANT_TC_FORMER_ID, { id: TENANT_TC_FORMER_ID, dormitoryId: DORM_ID, firstName: 'กิตติ', lastName: 'ย้ายออกแล้ว (TC)', status: 'former', tenantNumber: 'T-004' } as any],
    ]);

    // 3. Setup active contracts
    contractRepo.contracts = [
      { id: 'ctr-ta', dormitoryId: DORM_ID, tenantId: TENANT_TA_ID, roomId: ROOM_101_ID, status: 'active' } as any,
      { id: 'ctr-tb', dormitoryId: DORM_ID, tenantId: TENANT_TB_ID, roomId: ROOM_102_ID, status: 'active' } as any,
      { id: 'ctr-other', dormitoryId: DORM_ID, tenantId: TENANT_OTHER_ID, roomId: ROOM_201_ID, status: 'active' } as any,
    ];

    mockNotificationService = {
      createInAppNotification: vi.fn().mockResolvedValue({ id: 'mock-notif-id' }),
    };

    mockQuotaService = {
      consumeQuota: vi.fn().mockResolvedValue(true),
    };

    recipientResolver = new AnnouncementRecipientResolver(
      tenantRepo,
      contractRepo,
      roomRepo,
      buildingRepo
    );

    announcementService = new AnnouncementService(
      announcementRepo,
      recipientResolver,
      mockNotificationService,
      mockQuotaService,
      tenantRepo
    );
  });

  describe('P3-1: Targeted Room Announcements Delivery', () => {
    it('Owner creates announcement targeting Room 101 and 102 -> TA and TB see it, Other tenant does not', async () => {
      // 1. Owner creates announcement targeting Room 101 & Room 102
      const draft = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'แจ้งซ่อมท่อน้ำชั้น 1 เฉพาะห้อง 101 และ 102',
        content: 'จะมีการเข้าตรวจเช็คระบบน้ำเวลา 10:00 - 12:00 น.',
        summary: 'ตรวจเช็คท่อน้ำห้อง 101, 102',
        type: 'water_off',
        priority: 'high',
        targetType: 'rooms' as any,
        targetRooms: '101, 102' as any,
        audiences: [
          { targetType: 'room', roomId: ROOM_101_ID },
          { targetType: 'room', roomId: ROOM_102_ID },
        ],
      });

      // 2. Publish announcement
      await announcementService.publishAnnouncement({
        dormitoryId: DORM_ID,
        announcementId: draft.id,
        sendLinePush: false,
      });

      // 3. TA (Room 101) checks announcements
      const taList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      expect(taList.some(a => a.id === draft.id)).toBe(true);

      // 4. TB (Room 102) checks announcements
      const tbList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TB_ID);
      expect(tbList.some(a => a.id === draft.id)).toBe(true);

      // 5. Other tenant (Room 201) checks announcements -> MUST NOT see it
      const otherList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_OTHER_ID);
      expect(otherList.some(a => a.id === draft.id)).toBe(false);
    });
  });

  describe('P3-2: Per-Tenant Read Receipt Isolation', () => {
    it('TA reads announcement -> TA isRead becomes true, while TB remains isRead: false', async () => {
      const draft = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'ประกาศทั่วไปประจำเดือน',
        content: 'ข้อมูลประกาศทั่วไป',
        type: 'general',
        audiences: [{ targetType: 'all_tenants' }],
      });

      await announcementService.publishAnnouncement({
        dormitoryId: DORM_ID,
        announcementId: draft.id,
        sendLinePush: false,
      });

      // Initially both TA and TB have isRead: false
      let taList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      let tbList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TB_ID);
      expect(taList.find(a => a.id === draft.id)?.isRead).toBe(false);
      expect(tbList.find(a => a.id === draft.id)?.isRead).toBe(false);

      // TA marks announcement as read
      await announcementService.markAsReadByTenant(DORM_ID, draft.id, TENANT_TA_ID);

      // Re-fetch announcements for both
      taList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      tbList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TB_ID);

      // TA isRead MUST be true
      expect(taList.find(a => a.id === draft.id)?.isRead).toBe(true);
      expect(taList.find(a => a.id === draft.id)?.readAt).toBeTruthy();

      // TB isRead MUST REMAIN false (Strict Per-Tenant Read Status Isolation)
      expect(tbList.find(a => a.id === draft.id)?.isRead).toBe(false);
      expect(tbList.find(a => a.id === draft.id)?.readAt).toBeNull();
    });
  });

  describe('P3-3: "Mark All as Read" & Persistence', () => {
    it('TA clicks "Mark All as Read" -> Unread count drops to 0, stays 0 on subsequent retrieval', async () => {
      // Create 3 announcements
      const ann1 = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'ประกาศ 1',
        content: 'เนื้อหา 1',
        audiences: [{ targetType: 'all_tenants' }],
      });
      const ann2 = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'ประกาศ 2',
        content: 'เนื้อหา 2',
        audiences: [{ targetType: 'all_tenants' }],
      });
      const ann3 = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'ประกาศ 3',
        content: 'เนื้อหา 3',
        audiences: [{ targetType: 'all_tenants' }],
      });

      await announcementService.publishAnnouncement({ dormitoryId: DORM_ID, announcementId: ann1.id });
      await announcementService.publishAnnouncement({ dormitoryId: DORM_ID, announcementId: ann2.id });
      await announcementService.publishAnnouncement({ dormitoryId: DORM_ID, announcementId: ann3.id });

      let listBefore = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      expect(listBefore.filter(a => !a.isRead).length).toBe(3);

      // TA triggers Mark All as Read
      const markedCount = await announcementService.markAllAsReadByTenant(DORM_ID, TENANT_TA_ID);
      expect(markedCount).toBe(3);

      // Re-fetch: Unread count MUST be 0
      const listAfter = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      expect(listAfter.filter(a => !a.isRead).length).toBe(0);
      expect(listAfter.every(a => a.isRead === true)).toBe(true);

      // TB's announcements must still be unread
      const tbList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TB_ID);
      expect(tbList.filter(a => !a.isRead).length).toBe(3);
    });
  });

  describe('P3-4: Moved-out / Former Tenant Isolation', () => {
    it('TC after move-out (status: former) does not see announcements of the dormitory', async () => {
      const draft = await announcementService.createDraft({
        dormitoryId: DORM_ID,
        title: 'ประกาศทั่วไป',
        content: 'เนื้อหาสำหรับผู้เช่าปัจจุบัน',
        audiences: [{ targetType: 'all_tenants' }],
      });
      await announcementService.publishAnnouncement({ dormitoryId: DORM_ID, announcementId: draft.id });

      // Active tenant TA sees it
      const taList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TA_ID);
      expect(taList.length).toBeGreaterThan(0);

      // Former tenant TC (status: 'former') MUST receive empty array [] (REQUIREMENTS-LOCK §8:156)
      const tcList = await announcementService.getTenantAnnouncements(DORM_ID, TENANT_TC_FORMER_ID);
      expect(tcList).toEqual([]);

      // Detail endpoint for former tenant MUST also return null
      const tcDetail = await announcementService.getTenantAnnouncementById(DORM_ID, TENANT_TC_FORMER_ID, draft.id);
      expect(tcDetail).toBeNull();
    });
  });
});
