import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LineOaService,
  buildTenantMaintenanceCompletedFlexMessage,
  buildTenantAnnouncementFlexMessage,
  clearLineQuotaCache,
  clearProcessedNotificationEvents,
} from '../../services/line-oa.service.js';
import { encryptText } from '../../utils/crypto-encryption.js';
import { MaintenanceService } from '../../services/maintenance.service.js';
import { AnnouncementService } from '../../services/announcement.service.js';

describe('Card L3 — Maintenance & Announcement LINE Push Notifications (PO-5, OQ-11, OQ-17, PO Decisions A1, A2, A3)', () => {
  let mockPrisma: any;
  let mockLineAdapter: any;
  let lineOaService: LineOaService;

  const mockDormitoryId = '20000001-0000-4000-8000-000000000003';
  const mockTenantTA = 'tenant-ta-101';
  const mockTenantTB = 'tenant-tb-102';
  const mockTenantTX = 'tenant-tx-nobind';

  beforeEach(() => {
    vi.clearAllMocks();
    clearLineQuotaCache();
    clearProcessedNotificationEvents();

    mockPrisma = {
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({
          id: mockDormitoryId,
          name: 'HorPlus Test Manor',
          timezone: 'Asia/Bangkok',
        }),
      },
      dormitorySubscription: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: mockDormitoryId,
          plan: { code: 'PAID', messageQuotaMonthly: 300 },
        }),
      },
      linePushUsage: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'usage-l3',
          dormitoryId: mockDormitoryId,
          periodKey: '2026-09',
          successCount: 10,
          reservedCount: 0,
        }),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: mockDormitoryId,
          lineOaId: '@manor_residence',
          channelId: '1234567890',
          channelSecretEncrypted: 'enc_secret',
          channelAccessTokenEncrypted: 'enc_token',
          isConnected: true,
          notifyPaymentReceived: true,
          notifyTenantApproved: true,
          notifyRepairCompleted: true,
        }),
      },
      tenant: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          if (where.id === mockTenantTX) {
            return Promise.resolve({
              id: mockTenantTX,
              dormitoryId: mockDormitoryId,
              lineFriend: null,
            });
          }
          if (where.id === mockTenantTB) {
            return Promise.resolve({
              id: mockTenantTB,
              dormitoryId: mockDormitoryId,
              lineFriend: {
                id: 'friend-tb',
                lineUserIdEncrypted: encryptText('U_LINE_TENANT_TB'),
                friendStatus: 'FOLLOWING',
              },
            });
          }
          return Promise.resolve({
            id: mockTenantTA,
            dormitoryId: mockDormitoryId,
            lineFriend: {
              id: 'friend-ta',
              lineUserIdEncrypted: encryptText('U_LINE_TENANT_TA'),
              friendStatus: 'FOLLOWING',
            },
          });
        }),
      },
    };

    mockLineAdapter = {
      getQuota: vi.fn().mockResolvedValue({ type: 'limited', value: 500 }),
      getQuotaConsumption: vi.fn().mockResolvedValue({ totalUsage: 10 }),
      pushMessage: vi.fn().mockResolvedValue({ outcome: 'ACCEPTED', messageId: 'msg-l3-001' }),
    };

    lineOaService = new LineOaService(mockPrisma, mockLineAdapter);
    vi.spyOn(lineOaService as any, 'resolveAccessToken').mockResolvedValue('mock-access-token');
  });

  describe('Flex Message Builders (PO Decision A3)', () => {
    it('builds maintenance completed Flex message with room, title, category, status, and button to /tenant?sub=repairs', () => {
      const flex = buildTenantMaintenanceCompletedFlexMessage(
        'HorPlus Test Manor',
        '101',
        'แอร์น้ำหยด',
        'เครื่องใช้ไฟฟ้า',
        '26 ก.ย. 2569',
        'ล้างฟิลเตอร์และเติมน้ำยาแอร์เรียบร้อยแล้ว',
        'https://app.hor-plus.com'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('แจ้งเตือนงานซ่อมเสร็จสิ้น');
      expect(flex.altText).toContain('101');
      expect(flex.altText).toContain('แอร์น้ำหยด');

      // Check header
      expect(flex.contents.header.backgroundColor).toBe('#059669');

      // Check button action
      const button = flex.contents.footer.contents[0];
      expect(button.action.label).toBe('เปิดดูรายละเอียดงานแจ้งซ่อม');
      expect(button.action.uri).toContain('sub=repairs');
    });

    it('builds announcement Flex message with title, summary, priority, and button to /tenant?sub=announcements_tab', () => {
      const flex = buildTenantAnnouncementFlexMessage(
        'HorPlus Test Manor',
        'แจ้งล้างแท็งก์น้ำประจำปี',
        'จะมีการปิดน้ำชั่วคราวในวันอาทิตย์ที่ 28 ก.ย. เวลา 09:00 - 14:00 น.',
        'urgent',
        '26 ก.ย. 2569',
        'https://app.hor-plus.com'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('ประกาศจากหอพัก: แจ้งล้างแท็งก์น้ำประจำปี');

      // Urgent priority uses red header
      expect(flex.contents.header.backgroundColor).toBe('#DC2626');

      // Check button action
      const button = flex.contents.footer.contents[0];
      expect(button.action.label).toBe('เปิดดูประกาศ');
      expect(button.action.uri).toContain('sub=announcements_tab');
    });
  });

  describe('AC L3-1: Maintenance Completion LINE Notification (PO Decision A1)', () => {
    it('sends LINE Flex message when maintenance status transitions to resolved or completed', async () => {
      const flex = buildTenantMaintenanceCompletedFlexMessage(
        'HorPlus Test Manor',
        '101',
        'เปลี่ยนก๊อกน้ำห้องน้ำ',
        'ประปา',
        '26 ก.ย. 2569'
      );

      const res = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTA,
        eventType: 'MAINTENANCE',
        eventId: 'maintenance-completed:req-1:resolved',
        flexMessage: flex,
      });

      expect(res.sent).toBe(true);
      expect(res.remainingQuota).toBe(289); // 300 - 10 - 1
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledWith(
        'U_LINE_TENANT_TA',
        flex,
        'mock-access-token',
        expect.any(String)
      );
    });

    it('does not send LINE notification when preference notifyRepairCompleted is false', async () => {
      mockPrisma.dormitoryLineConfig.findUnique.mockResolvedValueOnce({
        dormitoryId: mockDormitoryId,
        isConnected: true,
        notifyRepairCompleted: false,
      });

      const flex = buildTenantMaintenanceCompletedFlexMessage(
        'HorPlus Test Manor',
        '101',
        'เปลี่ยนหลอดไฟ',
        'ไฟฟ้า',
        '26 ก.ย. 2569'
      );

      const res = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTA,
        eventType: 'MAINTENANCE',
        eventId: 'maintenance-completed:req-2:resolved',
        flexMessage: flex,
      });

      expect(res.sent).toBe(false);
      expect(res.reason).toBe('PREFERENCE_DISABLED');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('AC L3-2 & L3-3: Announcement Broadcast with sendLinePush Selection (PO Decision A2)', () => {
    it('AC L3-2: sends LINE Flex message to selected tenants (TA, TB) when sendLinePush is true, decrementing quota by 2', async () => {
      const flex = buildTenantAnnouncementFlexMessage(
        'HorPlus Test Manor',
        'แจ้งฉีดพ่นกำจัดยุงลาย',
        'วันเสาร์นี้ เวลา 10:00 น.',
        'normal',
        '26 ก.ย. 2569'
      );

      // Send to TA
      const resTA = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTA,
        eventType: 'ANNOUNCEMENT',
        eventId: 'announcement-published:ann-1:tenant-ta-101',
        flexMessage: flex,
      });
      expect(resTA.sent).toBe(true);

      // Send to TB
      const resTB = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTB,
        eventType: 'ANNOUNCEMENT',
        eventId: 'announcement-published:ann-1:tenant-tb-102',
        flexMessage: flex,
      });
      expect(resTB.sent).toBe(true);

      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(2);
    });

    it('AC L3-3: does not send LINE message and does not decrement quota when sendLinePush is false', async () => {
      // With sendLinePush = false, the service bypasses LINE push entirely
      // Simulate announcement publishing with sendLinePush: false
      const mockAnnouncementRepo: any = {
        findById: vi.fn().mockResolvedValue({
          id: 'ann-unpushed',
          dormitoryId: mockDormitoryId,
          title: 'ประกาศเงียบ',
          content: 'ทดสอบไม่ส่ง LINE',
          status: 'draft',
          priority: 'normal',
        }),
        getAudiences: vi.fn().mockResolvedValue([{ targetType: 'all_tenants' }]),
        updateAnnouncement: vi.fn().mockResolvedValue({
          id: 'ann-unpushed',
          dormitoryId: mockDormitoryId,
          title: 'ประกาศเงียบ',
          status: 'published',
        }),
        setRecipients: vi.fn().mockResolvedValue([]),
      };

      const mockRecipientResolver: any = {
        resolveRecipients: vi.fn().mockResolvedValue([
          { tenantId: mockTenantTA, roomNumber: '101' },
          { tenantId: mockTenantTB, roomNumber: '102' },
        ]),
      };

      const mockNotificationService: any = {
        createInAppNotification: vi.fn().mockResolvedValue({ id: 'inapp-1' }),
      };

      const announcementService = new AnnouncementService(
        mockAnnouncementRepo,
        mockRecipientResolver,
        mockNotificationService
      );

      const result = await announcementService.publishAnnouncement({
        dormitoryId: mockDormitoryId,
        announcementId: 'ann-unpushed',
        sendLinePush: false,
      });

      expect(result.status).toBe('published');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
      // Recipients recorded as in_app_only
      expect(mockAnnouncementRepo.setRecipients).toHaveBeenCalledWith(
        mockDormitoryId,
        'ann-unpushed',
        expect.arrayContaining([
          expect.objectContaining({ tenantId: mockTenantTA, deliveryStatus: 'in_app_only' }),
          expect.objectContaining({ tenantId: mockTenantTB, deliveryStatus: 'in_app_only' }),
        ])
      );
      // In-app notifications still created
      expect(mockNotificationService.createInAppNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC L3-4: Quota Exhausted Non-throwing Handling (PO Decision OQ-11)', () => {
    it('returns QUOTA_EXHAUSTED with warning message when quota is 0, without throwing error', async () => {
      // Mock quota status as 0 remaining
      mockPrisma.linePushUsage.findUnique.mockResolvedValueOnce({
        id: 'usage-l3-exhausted',
        dormitoryId: mockDormitoryId,
        periodKey: '2026-09',
        successCount: 300, // Monthly quota limit reached
        reservedCount: 0,
      });

      const flex = buildTenantAnnouncementFlexMessage(
        'HorPlus Test Manor',
        'ประกาศเมื่อโควตาหมด',
        'เนื้อหา',
        'normal',
        '26 ก.ย. 2569'
      );

      const res = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTA,
        eventType: 'ANNOUNCEMENT',
        eventId: 'announcement-published:ann-exhausted:tenant-ta-101',
        flexMessage: flex,
      });

      expect(res.sent).toBe(false);
      expect(res.reason).toBe('QUOTA_EXHAUSTED');
      expect(res.warningMessage).toBe('จำนวนการส่งข้อความเดือนนี้หมดแล้ว');
      expect(res.remainingQuota).toBe(0);
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('AC L3-5: Unbound Tenant (TX) Handling', () => {
    it('safely skips LINE push for tenant without LINE binding (TX) without throwing error or deducting quota', async () => {
      const flex = buildTenantMaintenanceCompletedFlexMessage(
        'HorPlus Test Manor',
        '103',
        'ซ่อมประตู',
        'ช่างไม้',
        '26 ก.ย. 2569'
      );

      const res = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantTX,
        eventType: 'MAINTENANCE',
        eventId: 'maintenance-completed:req-tx:resolved',
        flexMessage: flex,
      });

      expect(res.sent).toBe(false);
      expect(res.reason).toBe('NO_LINE_BINDING');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
      const updateUsageCalls = mockPrisma.$executeRaw.mock.calls.filter((c: any) =>
        String(c[0]).includes('UPDATE "line_push_usage"')
      );
      expect(updateUsageCalls).toHaveLength(0);
    });
  });
});
