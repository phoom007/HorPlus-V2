import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  lineOaService,
  buildTenantInvoiceFlexMessage,
  clearLineQuotaCache,
  clearProcessedNotificationEvents,
} from '../../services/line-oa.service.js';
import { subscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';
import { encryptText } from '../../utils/crypto-encryption.js';
import { BillingService } from '../../services/billing.service.js';
import express from 'express';
import request from 'supertest';
import { createBillingRouter } from '../../routes/billing.routes.js';

const { mockPrisma } = vi.hoisted(() => {
  const p: any = {
    $transaction: vi.fn(async (cb: any) => cb(p)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    dormitory: { findUnique: vi.fn() },
    dormitorySubscription: { findUnique: vi.fn() },
    linePushUsage: { findUnique: vi.fn() },
    dormitoryLineConfig: { findUnique: vi.fn() },
    tenant: { findUnique: vi.fn() },
    bill: { findMany: vi.fn() },
  };
  return { mockPrisma: p };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
  prisma: mockPrisma,
}));

describe('Card L4 — Manual Owner Bill LINE Push Notifications (PO-5, PO Decision 2026-09-26, OQ-11, OQ-12, REQ §3)', () => {
  let billingService: BillingService;

  const mockDormitoryId = '20000001-0000-4000-8000-000000000003';
  const mockTenantTC = 'tenant-tc-103';
  const mockTenantTX = 'tenant-tx-nobind';
  const mockBillingCycleId = 'cycle-2026-09';

  beforeEach(() => {
    vi.clearAllMocks();
    clearLineQuotaCache();
    clearProcessedNotificationEvents();

    Object.assign(mockPrisma, {
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({
          id: mockDormitoryId,
          name: 'The RICH Manor',
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
          id: 'usage-l4',
          dormitoryId: mockDormitoryId,
          periodKey: '2026-09',
          successCount: 15,
          reservedCount: 0,
        }),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: mockDormitoryId,
          lineOaId: '@rich_manor',
          channelId: '1234567890',
          channelSecretEncrypted: 'enc_secret',
          channelAccessTokenEncrypted: 'enc_token',
          isConnected: true,
          notifyPaymentReceived: true,
          notifyTenantApproved: true,
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
          return Promise.resolve({
            id: mockTenantTC,
            dormitoryId: mockDormitoryId,
            lineFriend: {
              id: 'friend-tc',
              lineUserIdEncrypted: encryptText('U_LINE_TENANT_TC'),
              friendStatus: 'FOLLOWING',
            },
          });
        }),
      },
      bill: {
        findMany: vi.fn().mockImplementation(({ where }: any) => {
          const tenantIds: string[] = where?.tenantId?.in || [];
          const bills: any[] = [];
          if (tenantIds.includes(mockTenantTC)) {
            bills.push({
              id: 'bill-tc-1',
              billNumber: 'B-202609-103-01',
              billKind: 'MONTHLY_UTILITY',
              dormitoryId: mockDormitoryId,
              tenantId: mockTenantTC,
              roomId: 'room-103',
              billingCycleId: mockBillingCycleId,
              totalAmount: '4500.00',
              outstandingAmount: '4500.00',
              dueDate: new Date('2026-10-05'),
              status: 'issued',
              room: { id: 'room-103', roomNumber: '103' },
            });
          }
          if (tenantIds.includes(mockTenantTX)) {
            bills.push({
              id: 'bill-tx-1',
              billNumber: 'B-202609-204-01',
              billKind: 'MONTHLY_UTILITY',
              dormitoryId: mockDormitoryId,
              tenantId: mockTenantTX,
              roomId: 'room-204',
              billingCycleId: mockBillingCycleId,
              totalAmount: '3800.00',
              outstandingAmount: '3800.00',
              dueDate: new Date('2026-10-05'),
              status: 'issued',
              room: { id: 'room-204', roomNumber: '204' },
            });
          }
          return Promise.resolve(bills);
        }),
      },
    });

    vi.spyOn(subscriptionEntitlementService, 'assertDormitoryWritable').mockResolvedValue(undefined);

    billingService = new BillingService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
  });

  describe('AC L4-1: Owner Manual Bill LINE Notification to Bound Tenant (TC)', () => {
    it('dispatches LINE Flex message for unpaid bill to bound tenant and increments sentCount', async () => {
      // Mock lineOaService call
      vi.spyOn(lineOaService, 'sendTenantLineNotification').mockResolvedValueOnce({
        sent: true,
        messageId: 'msg-l4-test-123',
      });

      const result = await billingService.sendManualBillLineNotifications({
        dormitoryId: mockDormitoryId,
        cycleId: mockBillingCycleId,
        tenantIds: [mockTenantTC],
      });

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(1);
      expect(result.unboundCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.results[0]).toMatchObject({
        tenantId: mockTenantTC,
        roomNumber: '103',
        status: 'SENT',
      });
      expect(lineOaService.sendTenantLineNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          dormitoryId: mockDormitoryId,
          tenantId: mockTenantTC,
          eventType: 'INVOICE',
          flexMessage: expect.objectContaining({
            type: 'flex',
            altText: expect.stringContaining('ห้อง 103'),
          }),
        })
      );
    });

    it('aggregates multiple unpaid bills for a tenant into one Flex message', async () => {
      // Setup mock to return 2 bills for TC (rent + utility)
      mockPrisma.bill.findMany.mockResolvedValueOnce([
        {
          id: 'bill-tc-rent',
          billNumber: 'B-RENT-103',
          billKind: 'RENT',
          dormitoryId: mockDormitoryId,
          tenantId: mockTenantTC,
          roomId: 'room-103',
          billingCycleId: mockBillingCycleId,
          totalAmount: '4000.00',
          outstandingAmount: '4000.00',
          dueDate: new Date('2026-10-05'),
          status: 'issued',
          room: { id: 'room-103', roomNumber: '103' },
        },
        {
          id: 'bill-tc-util',
          billNumber: 'B-UTIL-103',
          billKind: 'UTILITY',
          dormitoryId: mockDormitoryId,
          tenantId: mockTenantTC,
          roomId: 'room-103',
          billingCycleId: mockBillingCycleId,
          totalAmount: '850.00',
          outstandingAmount: '850.00',
          dueDate: new Date('2026-10-05'),
          status: 'issued',
          room: { id: 'room-103', roomNumber: '103' },
        },
      ]);

      const sendSpy = vi.spyOn(lineOaService, 'sendTenantLineNotification').mockResolvedValueOnce({
        sent: true,
        messageId: 'msg-l4-multi-123',
      });

      const result = await billingService.sendManualBillLineNotifications({
        dormitoryId: mockDormitoryId,
        cycleId: mockBillingCycleId,
        tenantIds: [mockTenantTC],
      });

      expect(result.sentCount).toBe(1);
      expect(result.results[0].billCount).toBe(2);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          flexMessage: expect.objectContaining({
            altText: expect.stringContaining('ห้อง 103'),
          }),
        })
      );
    });
  });

  describe('AC L4-2: Unbound Tenant (TX) Handling', () => {
    it('safely skips LINE push for tenant without LINE binding (TX) without deducting quota or throwing error', async () => {
      vi.spyOn(lineOaService, 'sendTenantLineNotification').mockResolvedValueOnce({
        sent: false,
        reason: 'NO_LINE_BINDING',
      });

      const result = await billingService.sendManualBillLineNotifications({
        dormitoryId: mockDormitoryId,
        cycleId: mockBillingCycleId,
        tenantIds: [mockTenantTX],
      });

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(0);
      expect(result.unboundCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.results[0]).toMatchObject({
        tenantId: mockTenantTX,
        status: 'NO_LINE_BINDING',
        message: 'ผู้เช่ายังไม่ได้ผูก LINE',
      });
    });
  });

  describe('AC L4-3: Staff Permission Enforcement (REQ §3 line 92)', () => {
    it('rejects Staff caller with HTTP 403 Forbidden', async () => {
      const mockAuthService = {
        verifyCsrf: vi.fn().mockReturnValue(true),
      };

      const mockBillingService = {
        sendManualBillLineNotifications: vi.fn(),
      };

      const app = express();
      app.use(express.json());

      // Staff session middleware (lacks billing:write)
      app.use((req: any, _res: any, next: any) => {
        req.auth = {
          userId: 'staff-user-id',
          role: 'STAFF',
          dormitoryId: mockDormitoryId,
          sessionId: 'test-session',
          permissions: ['rooms:view', 'tenants:view', 'maintenance:view'], // NO billing:write
          memberships: [
            {
              dormitoryId: mockDormitoryId,
              role: 'STAFF',
              permissions: ['rooms:view', 'tenants:view', 'maintenance:view'],
            },
          ],
        };
        req.cookies = { horplus_csrf: 'valid-csrf' };
        req.dormitoryContext = { dormitoryId: mockDormitoryId };
        next();
      });

      app.use('/api/v1/bills', createBillingRouter(mockAuthService as any, mockBillingService as any));

      const res = await request(app)
        .post('/api/v1/bills/send-line-notifications')
        .set('x-csrf-token', 'valid-csrf')
        .set('x-dormitory-id', mockDormitoryId)
        .send({
          cycleId: mockBillingCycleId,
          tenantIds: [mockTenantTC],
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBeDefined();
      expect(mockBillingService.sendManualBillLineNotifications).not.toHaveBeenCalled();
    });

    it('permits Owner caller with HTTP 200', async () => {
      const mockAuthService = {
        verifyCsrf: vi.fn().mockReturnValue(true),
      };

      const mockBillingService = {
        sendManualBillLineNotifications: vi.fn().mockResolvedValue({
          success: true,
          sentCount: 1,
          unboundCount: 0,
          failedCount: 0,
          results: [{ tenantId: mockTenantTC, status: 'SENT' }],
        }),
      };

      const app = express();
      app.use(express.json());

      // Owner session middleware (has billing:write)
      app.use((req: any, _res: any, next: any) => {
        req.auth = {
          userId: 'owner-user-id',
          role: 'OWNER',
          dormitoryId: mockDormitoryId,
          sessionId: 'test-session',
          permissions: ['*'],
          memberships: [
            {
              dormitoryId: mockDormitoryId,
              role: 'OWNER',
              permissions: ['*'],
            },
          ],
        };
        req.cookies = { horplus_csrf: 'valid-csrf' };
        req.dormitoryContext = {
          dormitoryId: mockDormitoryId,
          roleCode: 'OWNER',
          permissions: ['*'],
        };
        next();
      });

      app.use('/api/v1/bills', createBillingRouter(mockAuthService as any, mockBillingService as any));

      const res = await request(app)
        .post('/api/v1/bills/send-line-notifications')
        .set('x-csrf-token', 'valid-csrf')
        .set('x-dormitory-id', mockDormitoryId)
        .send({
          cycleId: mockBillingCycleId,
          tenantIds: [mockTenantTC],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.sentCount).toBe(1);
      expect(mockBillingService.sendManualBillLineNotifications).toHaveBeenCalled();
    });
  });

  describe('AC L4-4: Quota Exhausted Non-throwing Handling (PO Decision OQ-11)', () => {
    it('returns QUOTA_EXHAUSTED with warning message when quota is 0, without throwing error', async () => {
      vi.spyOn(lineOaService, 'sendTenantLineNotification').mockResolvedValueOnce({
        sent: false,
        reason: 'QUOTA_EXHAUSTED',
        warningMessage: 'จำนวนการส่งข้อความเดือนนี้หมดแล้ว',
      });

      const result = await billingService.sendManualBillLineNotifications({
        dormitoryId: mockDormitoryId,
        cycleId: mockBillingCycleId,
        tenantIds: [mockTenantTC],
      });

      expect(result.success).toBe(true);
      expect(result.sentCount).toBe(0);
      expect(result.failedCount).toBe(1);
      expect(result.warning).toBe('จำนวนการส่งข้อความเดือนนี้หมดแล้ว');
      expect(result.results[0]).toMatchObject({
        tenantId: mockTenantTC,
        status: 'QUOTA_EXHAUSTED',
        message: 'จำนวนการส่งข้อความเดือนนี้หมดแล้ว',
      });
    });
  });
});
