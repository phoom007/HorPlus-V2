/**
 * Unit tests for LINE Dual Quota Guard, Approval Push Notification, and Loading Animation
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LineOaService,
  buildTenantApprovalOutcomeFlexMessage,
  buildTenantRegistrationFlexMessage,
  clearLineQuotaCache,
} from '../../services/line-oa.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';

describe('LINE Dual Quota Guard & Push Notification Suite', () => {
  let mockAdapter: MockLinePlatformAdapter;
  let mockPrisma: any;
  let lineOaService: LineOaService;

  beforeEach(() => {
    clearLineQuotaCache();
    mockAdapter = new MockLinePlatformAdapter();
    mockPrisma = {
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          isConnected: true,
          notifyTenantApproved: true,
        }),
      },
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({
          timezone: 'Asia/Bangkok',
        }),
      },
      dormitorySubscription: {
        findUnique: vi.fn().mockResolvedValue({
          plan: { messageQuotaMonthly: 30 },
        }),
      },
      linePushUsage: {
        findUnique: vi.fn().mockResolvedValue({
          successCount: 5,
          reservedCount: 0,
        }),
      },
    };

    lineOaService = new LineOaService(mockPrisma, mockAdapter);
    vi.spyOn(lineOaService, 'resolveAccessToken').mockResolvedValue('mock-token-abc');
  });

  describe('Dual Quota Guard in pushOutcomeNotification', () => {
    it('successfully pushes message and updates usage count when quotas are available', async () => {
      mockAdapter.mockQuota = { type: 'limited', value: 500 };
      mockAdapter.mockQuotaConsumption = { totalUsage: 50 };

      const flexMsg = buildTenantApprovalOutcomeFlexMessage('หอพักสุขสบาย', '101', true);
      const success = await lineOaService.pushOutcomeNotification('dorm-1', 'U1234567890', flexMsg);

      expect(success).toBe(true);
      expect(mockAdapter.pushCalls.length).toBe(1);
      expect(mockAdapter.pushCalls[0].toLineUserId).toBe('U1234567890');
      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    });

    it('blocks push message when HorPlus quota is exhausted (Guard 1)', async () => {
      mockPrisma.linePushUsage.findUnique.mockResolvedValue({
        successCount: 30,
        reservedCount: 0,
      });

      const flexMsg = buildTenantApprovalOutcomeFlexMessage('หอพักสุขสบาย', '101', true);
      const success = await lineOaService.pushOutcomeNotification('dorm-1', 'U1234567890', flexMsg);

      expect(success).toBe(false);
      expect(mockAdapter.pushCalls.length).toBe(0);
    });

    it('blocks push message when LINE Platform quota is exhausted (Guard 2)', async () => {
      mockAdapter.mockQuota = { type: 'limited', value: 500 };
      mockAdapter.mockQuotaConsumption = { totalUsage: 500 };

      const flexMsg = buildTenantApprovalOutcomeFlexMessage('หอพักสุขสบาย', '101', true);
      const success = await lineOaService.pushOutcomeNotification('dorm-1', 'U1234567890', flexMsg);

      expect(success).toBe(false);
      expect(mockAdapter.pushCalls.length).toBe(0);
    });

    it('skips push when notifyTenantApproved is disabled in DormitoryLineConfig', async () => {
      mockPrisma.dormitoryLineConfig.findUnique.mockResolvedValue({
        isConnected: true,
        notifyTenantApproved: false,
      });

      const flexMsg = buildTenantApprovalOutcomeFlexMessage('หอพักสุขสบาย', '101', true);
      const success = await lineOaService.pushOutcomeNotification('dorm-1', 'U1234567890', flexMsg);

      expect(success).toBe(false);
      expect(mockAdapter.pushCalls.length).toBe(0);
    });

    it('caches LINE Platform quota and does not call getQuota on every request within TTL', async () => {
      const getQuotaSpy = vi.spyOn(mockAdapter, 'getQuota');
      mockAdapter.mockQuota = { type: 'limited', value: 500 };
      mockAdapter.mockQuotaConsumption = { totalUsage: 10 };

      const dormId = 'dorm-cache-test';
      const status1 = await lineOaService.getLinePlatformQuotaStatus(dormId);
      expect(status1.available).toBe(true);
      expect(status1.remaining).toBe(490);
      expect(getQuotaSpy).toHaveBeenCalledTimes(1);

      // Second call should hit in-memory cache
      const status2 = await lineOaService.getLinePlatformQuotaStatus(dormId);
      expect(status2.available).toBe(true);
      expect(status2.remaining).toBe(490);
      expect(getQuotaSpy).toHaveBeenCalledTimes(1); // Not called again!
    });
  });

  describe('Loading Animation and Flex Message URL', () => {
    it('records loading animation call correctly in mock adapter', async () => {
      const result = await mockAdapter.displayLoadingAnimation('U1234567890', 'mock-token', 5);
      expect(result).toBe(true);
      expect(mockAdapter.loadingAnimationCalls).toEqual([
        { chatId: 'U1234567890', loadingSeconds: 5 }
      ]);
    });

    it('buildTenantRegistrationFlexMessage links directly to the provided registration URL', () => {
      const flex = buildTenantRegistrationFlexMessage('หอพักพูนทรัพย์', 'https://horplus.com/tenant?t=token123');
      expect(flex.type).toBe('flex');
      const action = (flex.contents as any).footer.contents[0].action;
      expect(action.uri).toBe('https://horplus.com/tenant?t=token123');
      expect(action.label).toBe('ลงทะเบียนผู้เช่า');
    });
  });
});
