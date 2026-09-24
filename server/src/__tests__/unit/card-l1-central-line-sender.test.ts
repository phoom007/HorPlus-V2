import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LineOaService,
  clearLineQuotaCache,
  clearProcessedNotificationEvents,
} from '../../services/line-oa.service.js';
import { SYSTEM_PLANS_SEED } from '../../db/repositories/plan.repository.js';
import { createLineOaRoutes } from '../../routes/line-oa.routes.js';

describe('Card L1 — Central LINE Sender & Quota Management (PO-6, REQ §9)', () => {
  let mockPrisma: any;
  let mockLineAdapter: any;
  let lineOaService: LineOaService;

  beforeEach(() => {
    vi.clearAllMocks();
    clearLineQuotaCache();
    clearProcessedNotificationEvents();

    mockPrisma = {
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({ id: 'dorm-1', name: 'Manor Residence', timezone: 'Asia/Bangkok' }),
      },
      dormitorySubscription: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: 'dorm-1',
          plan: { code: 'FREE', messageQuotaMonthly: 30 },
        }),
      },
      linePushUsage: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'usage-1',
          dormitoryId: 'dorm-1',
          periodKey: '2026-09',
          successCount: 5,
          reservedCount: 0,
        }),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: 'dorm-1',
          lineOaId: '@manor_residence',
          channelId: '1234567890',
          channelSecretEncrypted: 'enc_secret',
          channelAccessTokenEncrypted: 'enc_token',
          isConnected: true,
          accessTokenVerifiedAt: new Date(),
          webhookEndpointSetAt: new Date(),
          webhookTestSucceededAt: new Date(),
          webhookActive: true,
          notifyPaymentReceived: true,
          notifyTenantApproved: true,
        }),
        update: vi.fn(),
      },
      tenant: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'tenant-1',
          dormitoryId: 'dorm-1',
          lineFriend: {
            id: 'friend-1',
            lineUserIdEncrypted: 'enc_U1234567890',
            friendStatus: 'FOLLOWING',
          },
        }),
      },
      dormitoryAccessGrant: {
        findUnique: vi.fn(),
      },
    };

    mockLineAdapter = {
      getQuota: vi.fn().mockResolvedValue({ type: 'limited', value: 500 }),
      getQuotaConsumption: vi.fn().mockResolvedValue({ totalUsage: 5 }),
      pushMessage: vi.fn().mockResolvedValue({ outcome: 'ACCEPTED', messageId: 'msg-line-001' }),
      getRichMenuList: vi.fn().mockResolvedValue([]),
    };

    lineOaService = new LineOaService(mockPrisma, mockLineAdapter);
    vi.spyOn(lineOaService as any, 'resolveAccessToken').mockResolvedValue('mock-access-token');
  });

  describe('AC L1-1: Canonical Thai Label and Quota Calculation', () => {
    it('returns "จำนวนการส่งข้อความ" as quota label and calculates remaining quota accurately', async () => {
      // Mock Free plan: 30 total, 5 used
      const config = await lineOaService.getDormitoryLineConfig('dorm-1');

      expect(config.quotaLabel).toBe('จำนวนการส่งข้อความ');
      expect(config.monthlyQuota).toBe(30);
      expect(config.usedQuota).toBe(5);
      expect(config.remainingQuota).toBe(25);
      expect(config.isQuotaExhausted).toBe(false);
      expect(config.isQuotaWarning).toBe(false);
      expect(config.quotaWarningMessage).toBeNull();
    });

    it('identifies Paid plan with default 300 quota', async () => {
      mockPrisma.dormitorySubscription.findUnique.mockResolvedValue({
        dormitoryId: 'dorm-1',
        plan: { code: 'PAID', messageQuotaMonthly: 300 },
      });
      mockPrisma.linePushUsage.findUnique.mockResolvedValue({
        successCount: 40,
        reservedCount: 0,
      });
      mockLineAdapter.getQuotaConsumption.mockResolvedValue({ totalUsage: 40 });

      const config = await lineOaService.getDormitoryLineConfig('dorm-1');
      expect(config.monthlyQuota).toBe(300);
      expect(config.usedQuota).toBe(40);
      expect(config.remainingQuota).toBe(260);
    });

    it('sets isQuotaWarning = true when remainingQuota <= 5 (PO Decision A2)', async () => {
      mockPrisma.linePushUsage.findUnique.mockResolvedValue({
        successCount: 26,
        reservedCount: 0,
      });
      mockLineAdapter.getQuotaConsumption.mockResolvedValue({ totalUsage: 26 });

      const config = await lineOaService.getDormitoryLineConfig('dorm-1');
      expect(config.remainingQuota).toBe(4);
      expect(config.isQuotaWarning).toBe(true);
      expect(config.isQuotaExhausted).toBe(false);
      expect(config.quotaWarningMessage).toContain('จำนวนการส่งข้อความใกล้หมดแล้ว (เหลือ ≤ 5 ข้อความ)');
    });

    it('sets isQuotaExhausted = true with canonical message when remainingQuota === 0 (PO Decision A1)', async () => {
      mockPrisma.linePushUsage.findUnique.mockResolvedValue({
        successCount: 30,
        reservedCount: 0,
      });
      mockLineAdapter.getQuotaConsumption.mockResolvedValue({ totalUsage: 30 });

      const config = await lineOaService.getDormitoryLineConfig('dorm-1');
      expect(config.remainingQuota).toBe(0);
      expect(config.isQuotaExhausted).toBe(true);
      expect(config.isQuotaWarning).toBe(false);
      expect(config.quotaWarningMessage).toBe('จำนวนการส่งข้อความเดือนนี้หมดแล้ว');
    });
  });

  describe('AC L1-2: Instant Refresh on Page Open & 15-min Cache during Regular Operations', () => {
    it('uses 15-minute cache on regular requests without forceRefresh', async () => {
      // First call: calls LINE adapter
      await lineOaService.getDormitoryLineConfig('dorm-1', undefined, { forceRefresh: false });
      expect(mockLineAdapter.getQuotaConsumption).toHaveBeenCalledTimes(1);

      // Second call within 15 minutes: served from cache
      await lineOaService.getDormitoryLineConfig('dorm-1', undefined, { forceRefresh: false });
      expect(mockLineAdapter.getQuotaConsumption).toHaveBeenCalledTimes(1);
    });

    it('forces immediate refresh from LINE API when forceRefresh is true (opening settings page)', async () => {
      // First call (e.g. cached)
      await lineOaService.getDormitoryLineConfig('dorm-1', undefined, { forceRefresh: false });
      expect(mockLineAdapter.getQuotaConsumption).toHaveBeenCalledTimes(1);

      // Second call with forceRefresh: true (PO Decision A3)
      await lineOaService.getDormitoryLineConfig('dorm-1', undefined, { forceRefresh: true });
      expect(mockLineAdapter.getQuotaConsumption).toHaveBeenCalledTimes(2);
    });
  });

  describe('AC L1-3: Quota Exhaustion, Failed Send, and Duplicate Prevention', () => {
    it('when quota exhausted: does not send LINE message, logs QUOTA_EXHAUSTED, and does not throw (PO Decision A1)', async () => {
      mockPrisma.linePushUsage.findUnique.mockResolvedValue({
        successCount: 30,
        reservedCount: 0,
      });
      mockLineAdapter.getQuotaConsumption.mockResolvedValue({ totalUsage: 30 });

      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: 'dorm-1',
        lineUserId: 'U_TEST_USER_001',
        eventType: 'INVOICE',
        textMessage: 'บิลค่าเช่าประจำเดือน',
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('QUOTA_EXHAUSTED');
      expect(result.warningMessage).toBe('จำนวนการส่งข้อความเดือนนี้หมดแล้ว');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });

    it('when send fails: does not deduct/increment quota (REQ §9 line 166)', async () => {
      mockLineAdapter.pushMessage.mockResolvedValueOnce({
        outcome: 'DEFINITIVE_FAILURE',
        errorCode: 'INVALID_RECIPIENT',
      });

      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: 'dorm-1',
        lineUserId: 'U_TEST_USER_001',
        eventType: 'GENERAL',
        textMessage: 'ทดสอบส่ง',
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('PUSH_FAILED');

      // Verify that success_count was NOT updated with + 1
      const updateCalls = mockPrisma.$executeRaw.mock.calls;
      const successIncrementCall = updateCalls.find((c: any) =>
        String(c[0]).includes('"success_count" = "line_push_usage"."success_count" + 1')
      );
      expect(successIncrementCall).toBeUndefined();
    });

    it('when duplicate eventId sent: idempotency guard prevents resending', async () => {
      const payload = {
        dormitoryId: 'dorm-1',
        lineUserId: 'U_TEST_USER_001',
        eventId: 'event-invoice-inv-101',
        eventType: 'INVOICE' as const,
        textMessage: 'บิลประจำเดือน',
      };

      // First dispatch
      const firstResult = await lineOaService.sendTenantLineNotification(payload);
      expect(firstResult.sent).toBe(true);
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);

      // Second dispatch with same eventId
      const secondResult = await lineOaService.sendTenantLineNotification(payload);
      expect(secondResult.sent).toBe(false);
      expect(secondResult.reason).toBe('DUPLICATE_EVENT');
      // Push adapter was NOT called a second time
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);
    });

    it('when tenant has no LINE binding: skips sending without deducting quota or throwing', async () => {
      mockPrisma.tenant.findUnique.mockResolvedValueOnce({
        id: 'tenant-no-line',
        dormitoryId: 'dorm-1',
        lineFriend: null,
      });

      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: 'dorm-1',
        tenantId: 'tenant-no-line',
        eventType: 'INVOICE',
        textMessage: 'แจ้งบิล',
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('NO_LINE_BINDING');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('AC L1-4: Default Package Quota in System Seeds', () => {
    it('verifies Free plan = 30 and Paid plan = 300 per REQ §9 line 162', () => {
      const freePlan = SYSTEM_PLANS_SEED.find((p) => p.code === 'FREE');
      const paidPlan = SYSTEM_PLANS_SEED.find((p) => p.code === 'PAID');

      expect(freePlan).toBeDefined();
      expect(freePlan?.messageQuotaMonthly).toBe(30);

      expect(paidPlan).toBeDefined();
      expect(paidPlan?.messageQuotaMonthly).toBe(300);
    });
  });

  describe('AC L1-5: Staff Access Prohibition (403 Forbidden)', () => {
    it('strictly forbids STAFF (ช่าง/แม่บ้าน) from accessing LINE OA config routes (REQ §3 line 95)', async () => {
      const fakeAuthService: any = {
        requireAuth: () => (req: any, _res: any, next: any) => {
          req.auth = {
            userId: 'staff-user-1',
            roleCode: 'STAFF',
            role: 'STAFF',
            dormitoryId: 'dorm-1',
          };
          req.dormitoryContext = {
            dormitoryId: 'dorm-1',
            roleCode: 'STAFF',
            role: 'STAFF',
          };
          next();
        },
      };

      const routes = createLineOaRoutes(mockPrisma, fakeAuthService, mockLineAdapter);
      const req: any = {
        method: 'GET',
        url: '/dormitories/dorm-1/line-oa/config',
        params: { dormId: 'dorm-1' },
        query: {},
        headers: {},
        auth: { userId: 'staff-user-1', roleCode: 'STAFF', role: 'STAFF', dormitoryId: 'dorm-1' },
        dormitoryContext: { dormitoryId: 'dorm-1', roleCode: 'STAFF', role: 'STAFF' },
      };

      let statusReceived = 0;
      let jsonReceived: any = null;
      const res: any = {
        status: (s: number) => {
          statusReceived = s;
          return res;
        },
        json: (j: any) => {
          jsonReceived = j;
          return res;
        },
      };
      const next = vi.fn();

      // Find the handler or run through router layers
      const getLayer = (routes.protectedRouter.stack as any[]).find(
        (l) => l.route && l.route.path && l.route.path.includes('/dormitories/:dormId/line-oa/config')
      );

      expect(getLayer).toBeDefined();
      const stack = getLayer.route.stack;

      // Execute route stack sequentially
      for (const handler of stack) {
        if (statusReceived !== 0) break;
        await new Promise<void>((resolve) => {
          handler.handle(req, res, () => {
            resolve();
          });
          if (statusReceived !== 0) resolve();
        });
      }

      expect(statusReceived).toBe(403);
      expect(jsonReceived?.error?.code).toBe('FORBIDDEN');
    });
  });
});
