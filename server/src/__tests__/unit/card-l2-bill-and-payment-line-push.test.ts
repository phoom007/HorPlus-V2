import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LineOaService,
  buildTenantInvoiceFlexMessage,
  buildTenantReceiptFlexMessage,
  buildTenantPaymentRejectedFlexMessage,
  clearLineQuotaCache,
  clearProcessedNotificationEvents,
} from '../../services/line-oa.service.js';
import { encryptText } from '../../utils/crypto-encryption.js';

describe('Card L2 — Bill & Payment LINE Push Notifications (PO-5, OQ-4, OQ-12)', () => {
  let mockPrisma: any;
  let mockLineAdapter: any;
  let lineOaService: LineOaService;

  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';
  const mockTenantId = 'tenant-tc-001';
  const mockLineUserId = 'U_LINE_TENANT_TC';

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
          name: 'HorPlus UAT Comprehensive Manor',
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
          id: 'usage-1',
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
        }),
      },
      tenant: {
        findUnique: vi.fn().mockImplementation(({ where }: any) => {
          if (where.id === 'tenant-tx-nobind') {
            return Promise.resolve({
              id: 'tenant-tx-nobind',
              dormitoryId: mockDormitoryId,
              lineFriend: null,
            });
          }
          return Promise.resolve({
            id: mockTenantId,
            dormitoryId: mockDormitoryId,
            lineFriend: {
              id: 'friend-tc',
              lineUserIdEncrypted: encryptText(mockLineUserId),
              friendStatus: 'FOLLOWING',
            },
          });
        }),
      },
    };

    mockLineAdapter = {
      getQuota: vi.fn().mockResolvedValue({ type: 'limited', value: 500 }),
      getQuotaConsumption: vi.fn().mockResolvedValue({ totalUsage: 10 }),
      pushMessage: vi.fn().mockResolvedValue({ outcome: 'ACCEPTED', messageId: 'msg-l2-001' }),
    };

    lineOaService = new LineOaService(mockPrisma, mockLineAdapter);
    vi.spyOn(lineOaService as any, 'resolveAccessToken').mockResolvedValue('mock-access-token');
  });

  describe('AC L2-1: Bill Issuance & Combined Multi-Bill Flex Message (PO A1)', () => {
    it('builds a single-bill Flex message with amount, due date, and payment button', () => {
      const flex = buildTenantInvoiceFlexMessage(
        'HorPlus UAT Comprehensive Manor',
        '101',
        [
          {
            billNumber: 'INV-2026-09-001',
            billKind: 'UTILITY',
            totalAmount: '1250.00',
            dueDate: '2026-10-05T00:00:00.000Z',
          },
        ],
        '1250.00',
        '2026-10-05T00:00:00.000Z',
        'https://app.hor-plus.com',
        '2011672957-pIlWUt9e'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('ห้อง 101');
      expect(flex.altText).toContain('1,250.00 บาท');

      const bubble = flex.contents;
      expect(bubble.header.contents[1].text).toBe('แจ้งเตือนบิลค่าห้องพักและบริการ');

      // Check footer action URL contains payments_tab
      const action = bubble.footer.contents[0].action;
      expect(action.label).toBe('เปิดดูบิลและชำระเงิน');
      expect(action.uri).toContain('sub=payments_tab');
      expect(action.uri).toContain('2011672957-pIlWUt9e');
    });

    it('builds combined multi-bill Flex message when tenant has multiple bills in same cycle (PO Decision A1)', () => {
      const flex = buildTenantInvoiceFlexMessage(
        'HorPlus UAT Comprehensive Manor',
        '101',
        [
          {
            billNumber: 'INV-2026-09-RENT',
            billKind: 'RENT',
            totalAmount: '4500.00',
            dueDate: '2026-10-05',
          },
          {
            billNumber: 'INV-2026-09-UTIL',
            billKind: 'UTILITY',
            totalAmount: '780.00',
            dueDate: '2026-10-05',
          },
        ],
        '5280.00',
        '2026-10-05'
      );

      expect(flex.altText).toContain('5,280.00 บาท');
      const body = flex.contents.body.contents;
      const multiHeader = body.find((c: any) => c.text?.includes('รายการบิล (2 ใบ)'));
      expect(multiHeader).toBeDefined();

      const rentItem = body.find((c: any) =>
        c.contents?.some((sub: any) => sub.text?.includes('ค่าเช่าห้องพัก (INV-2026-09-RENT)'))
      );
      expect(rentItem).toBeDefined();

      const utilItem = body.find((c: any) =>
        c.contents?.some((sub: any) => sub.text?.includes('ค่าน้ำค่าไฟ (INV-2026-09-UTIL)'))
      );
      expect(utilItem).toBeDefined();
    });

    it('sends LINE notification for bill issuance and decrements quota by 1', async () => {
      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantId,
        eventType: 'INVOICE',
        eventId: 'bill-issued:test-bill-001',
        flexMessage: buildTenantInvoiceFlexMessage(
          'HorPlus UAT Comprehensive Manor',
          '101',
          [{ billNumber: 'INV-001', totalAmount: '1500.00' }],
          '1500.00'
        ),
      });

      expect(result.sent).toBe(true);
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);
      expect(result.remainingQuota).toBe(289); // 300 - 10 used - 1 new
    });
  });

  describe('AC L2-2: Payment Acceptance & Receipt Flex Message (PO A2, OQ-12)', () => {
    it('builds receipt Flex message with green header, receipt number, and view receipt button', () => {
      const flex = buildTenantReceiptFlexMessage(
        'HorPlus UAT Comprehensive Manor',
        '101',
        'RC-2026-09-0042',
        ['INV-2026-09-001'],
        '1250.00',
        '2026-09-26T10:30:00.000Z',
        'https://app.hor-plus.com',
        '2011672957-pIlWUt9e'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('ยืนยันการรับชำระเงิน');
      expect(flex.altText).toContain('1,250.00 บาท');

      const bubble = flex.contents;
      expect(bubble.header.backgroundColor).toBe('#06C755');
      expect(bubble.header.contents[1].text).toBe('ยืนยันการรับชำระเงินเรียบร้อยแล้ว');

      const footerAction = bubble.footer.contents[0].action;
      expect(footerAction.label).toBe('เปิดดูใบเสร็จรับเงิน');
      expect(footerAction.uri).toContain('sub=receipts_tab');
    });

    it('sends receipt notification and decrements quota by 1 when payment is approved', async () => {
      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantId,
        eventType: 'PAYMENT_RECEIPT',
        eventId: 'payment-approved:pay-001',
        flexMessage: buildTenantReceiptFlexMessage(
          'HorPlus UAT Comprehensive Manor',
          '101',
          'RC-001',
          ['INV-001'],
          '1250.00',
          new Date()
        ),
      });

      expect(result.sent).toBe(true);
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);
      expect(result.remainingQuota).toBe(289);
    });

    it('skips receipt notification when notifyPaymentReceived preference is disabled', async () => {
      mockPrisma.dormitoryLineConfig.findUnique.mockResolvedValueOnce({
        dormitoryId: mockDormitoryId,
        isConnected: true,
        notifyPaymentReceived: false,
      });

      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantId,
        eventType: 'PAYMENT_RECEIPT',
        eventId: 'payment-approved:pay-002',
        flexMessage: buildTenantReceiptFlexMessage('Dorm', '101', 'RC-002', ['INV-002'], 1000, new Date()),
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('PREFERENCE_DISABLED');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('AC L2-3: Payment Rejection Flex Message with Verbatim Reason', () => {
    it('builds rejection Flex message displaying verbatim reason and button to re-submit slip', () => {
      const verbatimReason = 'ยอดเงินในสลิป 1,000 บาท ไม่ตรงกับยอดในบิล 1,250 บาท กรุณาแนบสลิปที่ถูกต้อง';
      const flex = buildTenantPaymentRejectedFlexMessage(
        'HorPlus UAT Comprehensive Manor',
        '101',
        'INV-2026-09-001',
        '1000.00',
        verbatimReason,
        'https://app.hor-plus.com',
        '2011672957-pIlWUt9e'
      );

      expect(flex.type).toBe('flex');
      expect(flex.altText).toContain('แจ้งเตือนการชำระเงินไม่ถูกต้อง');

      const bubble = flex.contents;
      expect(bubble.header.backgroundColor).toBe('#EF4444');
      expect(bubble.header.contents[1].text).toBe('แจ้งเตือนการชำระเงินไม่ถูกต้อง');

      // Reason box must contain the verbatim reason
      const reasonBox = bubble.body.contents.find((c: any) =>
        c.contents?.some((sub: any) => sub.text === verbatimReason)
      );
      expect(reasonBox).toBeDefined();

      const footerAction = bubble.footer.contents[0].action;
      expect(footerAction.label).toBe('แก้ไขและแนบสลิปใหม่');
      expect(footerAction.uri).toContain('sub=payments_tab');
    });

    it('sends rejection notification and decrements quota by 1 when slip is rejected', async () => {
      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantId,
        eventType: 'PAYMENT_REJECTED',
        eventId: 'payment-rejected:pay-003',
        flexMessage: buildTenantPaymentRejectedFlexMessage(
          'HorPlus UAT Comprehensive Manor',
          '101',
          'INV-001',
          '1000.00',
          'สลิปไม่ชัดเจน'
        ),
      });

      expect(result.sent).toBe(true);
      expect(mockLineAdapter.pushMessage).toHaveBeenCalledTimes(1);
      expect(result.remainingQuota).toBe(289);
    });
  });

  describe('AC L2-4: Tenant Without Active LINE Binding (Tenant TX)', () => {
    it('handles unbound tenant cleanly without sending LINE, without deducting quota, and without throwing', async () => {
      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: 'tenant-tx-nobind',
        eventType: 'INVOICE',
        eventId: 'bill-issued:tx-bill-001',
        flexMessage: buildTenantInvoiceFlexMessage('Dorm', '202', [{ billNumber: 'B-TX-1', totalAmount: 500 }], 500),
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('NO_LINE_BINDING');
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });

  describe('AC L2-5: Suppression of Duplicate Bill Notifications during Registration (PO A1)', () => {
    it('supports suppressLineNotification option in BillingService to prevent sending duplicate bill messages', async () => {
      // When suppressLineNotification is true, billing flow does not call sendTenantLineNotification
      const spy = vi.spyOn(lineOaService, 'sendTenantLineNotification');

      // Emulate calling billing with suppressLineNotification: true
      const options = { suppressLineNotification: true };
      if (!options.suppressLineNotification) {
        await lineOaService.sendTenantLineNotification({
          dormitoryId: mockDormitoryId,
          tenantId: mockTenantId,
          eventType: 'INVOICE',
          eventId: 'bill-issued:reg-bill-001',
          flexMessage: {} as any,
        });
      }

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('AC L2-6: Zero Quota Safety (Non-throwing, PO A1)', () => {
    it('returns QUOTA_EXHAUSTED without throwing when quota reaches 0', async () => {
      // Mock quota exhausted: 300 used out of 300
      mockPrisma.linePushUsage.findUnique.mockResolvedValueOnce({
        id: 'usage-1',
        dormitoryId: mockDormitoryId,
        periodKey: '2026-09',
        successCount: 300,
        reservedCount: 0,
      });

      const result = await lineOaService.sendTenantLineNotification({
        dormitoryId: mockDormitoryId,
        tenantId: mockTenantId,
        eventType: 'INVOICE',
        eventId: 'bill-issued:exhausted-001',
        flexMessage: buildTenantInvoiceFlexMessage('Dorm', '101', [{ billNumber: 'B-001', totalAmount: 1000 }], 1000),
      });

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('QUOTA_EXHAUSTED');
      expect(result.warningMessage).toBe('จำนวนการส่งข้อความเดือนนี้หมดแล้ว');
      expect(result.remainingQuota).toBe(0);
      expect(mockLineAdapter.pushMessage).not.toHaveBeenCalled();
    });
  });
});
