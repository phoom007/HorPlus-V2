/**
 * Unit tests for LINE Rich Menu, Postback Event Dispatcher, Loading Animation, and Direct Entry
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LineOaService,
  buildOwnerDirectEntryFlexMessage,
  buildOwnerGuideCarouselFlexMessage,
  buildTenantGuideCarouselFlexMessage,
} from '../../services/line-oa.service.js';
import {
  LineRichMenuService,
  createDirectEntryTicket,
  consumeDirectEntryTicket,
} from '../../services/line-richmenu.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { encryptText } from '../../utils/crypto-encryption.js';

describe('LINE Rich Menu & Postback Event Suite (Phase 2)', () => {
  let mockAdapter: MockLinePlatformAdapter;
  let mockPrisma: any;
  let lineOaService: LineOaService;
  let richMenuService: LineRichMenuService;

  beforeEach(() => {
    mockAdapter = new MockLinePlatformAdapter();
    mockPrisma = {
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn(),
      dormitory: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'dorm-001',
          name: 'หอพักสุขสบายแกรนด์',
          createdByUserId: 'user-owner-uuid',
        }),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn().mockResolvedValue({
          dormitoryId: 'dorm-001',
          channelId: 'mock-channel',
          channelSecretEncrypted: encryptText('mock-secret'),
          channelAccessTokenEncrypted: encryptText('mock-token'),
          webhookKeyEncrypted: encryptText('mock-webhook-key'),
          webhookKeyHash: 'mock-webhook-key-hash',
          isConnected: true,
          webhookVerifiedAt: new Date(),
          accessTokenVerifiedAt: new Date(),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      dormitoryAccessGrant: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      dormitoryLineFriend: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: 'friend-uuid-1',
          dormitoryId: 'dorm-001',
          displayName: 'คุณสมชาย เจ้าของหอ',
          friendStatus: 'FOLLOWING',
        }),
        upsert: vi.fn().mockResolvedValue({
          id: 'friend-uuid-1',
          dormitoryId: 'dorm-001',
          displayName: 'คุณสมชาย เจ้าของหอ',
          friendStatus: 'FOLLOWING',
        }),
      },
      lineWebhookEventReceipt: {
        create: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      tenantRegistrationInvite: {
        create: vi.fn().mockResolvedValue({
          id: 'invite-1',
          rawToken: 'raw-invite-token-xyz',
        }),
      },
      dormitorySubscription: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      linePushUsage: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    lineOaService = new LineOaService(mockPrisma, mockAdapter);
    richMenuService = lineOaService.getRichMenuService();
    vi.spyOn(lineOaService, 'resolveAccessToken').mockResolvedValue('mock-access-token');
  });

  describe('Rich Menu Image & Payload Structure', () => {
    it('generates 2500x843 PNG image for Owner 3-button menu', async () => {
      const imgBuffer = await richMenuService.generateOwnerRichMenuImage();
      expect(imgBuffer).toBeInstanceOf(Buffer);
      expect(imgBuffer.length).toBeGreaterThan(1000);
      // PNG magic bytes: 0x89 0x50 0x4E 0x47
      expect(imgBuffer[0]).toBe(0x89);
      expect(imgBuffer[1]).toBe(0x50);
      expect(imgBuffer[2]).toBe(0x4e);
      expect(imgBuffer[3]).toBe(0x47);
    });

    it('generates 2500x843 PNG image for Tenant 2-button menu', async () => {
      const imgBuffer = await richMenuService.generateTenantRichMenuImage();
      expect(imgBuffer).toBeInstanceOf(Buffer);
      expect(imgBuffer.length).toBeGreaterThan(1000);
      expect(imgBuffer[0]).toBe(0x89);
      expect(imgBuffer[1]).toBe(0x50);
      expect(imgBuffer[2]).toBe(0x4e);
      expect(imgBuffer[3]).toBe(0x47);
    });

    it('builds owner payload with 3 postback buttons: manage_dormitory, tenant_register, owner_user_guide', () => {
      const payload = richMenuService.buildOwnerRichMenuPayload('หอพักสุขสบาย');
      expect(payload.size).toEqual({ width: 2500, height: 843 });
      expect(payload.areas.length).toBe(3);
      expect(payload.areas[0].action.data).toBe('action=manage_dormitory');
      expect(payload.areas[1].action.data).toBe('action=tenant_register');
      expect(payload.areas[2].action.data).toBe('action=owner_user_guide');
    });

    it('builds tenant payload with 2 postback buttons: tenant_register, tenant_user_guide', () => {
      const payload = richMenuService.buildTenantRichMenuPayload('หอพักสุขสบาย');
      expect(payload.size).toEqual({ width: 2500, height: 843 });
      expect(payload.areas.length).toBe(2);
      expect(payload.areas[0].action.data).toBe('action=tenant_register');
      expect(payload.areas[1].action.data).toBe('action=tenant_user_guide');
    });
  });

  describe('Direct Entry Ticket Generator & Single-Use Atomic Consumer', () => {
    it('creates a 60-second ticket and allows consuming it once', () => {
      const ticket = createDirectEntryTicket({
        dormitoryId: 'dorm-001',
        lineUserId: 'U1122334455',
        roleCode: 'OWNER',
        grantId: 'grant-uuid-1',
      });

      expect(ticket).toMatch(/^ticket_[a-f0-9]+$/);

      // First consumption: success
      const consumed = consumeDirectEntryTicket(ticket);
      expect(consumed).not.toBeNull();
      expect(consumed?.dormitoryId).toBe('dorm-001');
      expect(consumed?.roleCode).toBe('OWNER');
      expect(consumed?.grantId).toBe('grant-uuid-1');

      // Second consumption: atomic deletion ensures null (single-use)
      const secondConsume = consumeDirectEntryTicket(ticket);
      expect(secondConsume).toBeNull();
    });

    it('rejects expired tickets', () => {
      const ticket = createDirectEntryTicket({
        dormitoryId: 'dorm-001',
        lineUserId: 'U1122334455',
        roleCode: 'OWNER',
      });

      // Advance time beyond 60s
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 65 * 1000);

      const consumed = consumeDirectEntryTicket(ticket);
      expect(consumed).toBeNull();
      vi.restoreAllMocks();
    });
  });

  describe('Postback Webhook Event Processing with Loading Animation', () => {
    it('handles action=manage_dormitory by triggering loading animation and sending direct entry flex message', async () => {
      // Mock resolver returning dormitory
      mockPrisma.$queryRaw.mockResolvedValue([{ config_id: 'cfg-1', dormitory_id: 'dorm-001' }]);

      // Mock existing owner grant
      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValue({
        id: 'grant-owner-1',
        dormitoryId: 'dorm-001',
        roleCode: 'OWNER',
        status: 'ACTIVE',
      });

      const webhookPayload = {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-manage',
            source: { userId: 'U_OWNER_123' },
            postback: { data: 'action=manage_dormitory' },
          },
        ],
      };

      const bodyBuffer = Buffer.from(JSON.stringify(webhookPayload));
      // Mock verifyLineSignature to pass
      vi.spyOn(await import('../../utils/crypto-encryption.js'), 'verifyLineSignature').mockReturnValue(true);

      const result = await lineOaService.processWebhookEvent('mock-raw-key', bodyBuffer, 'mock-sig');
      expect(result.processedCount).toBe(1);

      // Verify Loading Animation API was called immediately
      expect(mockAdapter.loadingAnimationCalls).toEqual([
        { chatId: 'U_OWNER_123', loadingSeconds: 5 },
      ]);

      // Verify direct entry flex message was replied
      expect(mockAdapter.replyCalls.length).toBe(1);
      const replyCall = mockAdapter.replyCalls[0];
      expect(replyCall.replyToken).toBe('reply-token-manage');
      expect(replyCall.messages[0].altText).toContain('เข้าสู่ระบบจัดการหอพัก');
      const directEntryUri = replyCall.messages[0].contents.footer.contents[0].action.uri;
      expect(directEntryUri).toMatch(/(?:line-direct-entry\?ticket=ticket_|liff\.line\.me\/.*ticket=ticket_)/);
    });

    it('handles action=owner_user_guide by displaying loading animation and sending owner guide carousel', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ config_id: 'cfg-1', dormitory_id: 'dorm-001' }]);

      const webhookPayload = {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-owner-guide',
            source: { userId: 'U_OWNER_123' },
            postback: { data: 'action=owner_user_guide' },
          },
        ],
      };

      const bodyBuffer = Buffer.from(JSON.stringify(webhookPayload));
      vi.spyOn(await import('../../utils/crypto-encryption.js'), 'verifyLineSignature').mockReturnValue(true);

      const result = await lineOaService.processWebhookEvent('mock-raw-key', bodyBuffer, 'mock-sig');
      expect(result.processedCount).toBe(1);

      expect(mockAdapter.loadingAnimationCalls).toEqual([
        { chatId: 'U_OWNER_123', loadingSeconds: 5 },
      ]);

      expect(mockAdapter.replyCalls.length).toBe(1);
      const replyCall = mockAdapter.replyCalls[0];
      expect(replyCall.replyToken).toBe('reply-token-owner-guide');
      expect(replyCall.messages[0].altText).toContain('คู่มือการใช้งานสำหรับเจ้าของหอพัก');
      expect(replyCall.messages[0].contents.type).toBe('carousel');
      expect(replyCall.messages[0].contents.contents.length).toBe(5);
    });

    it('handles action=tenant_user_guide by displaying loading animation and sending tenant guide carousel', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ config_id: 'cfg-1', dormitory_id: 'dorm-001' }]);

      const webhookPayload = {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-tenant-guide',
            source: { userId: 'U_TENANT_456' },
            postback: { data: 'action=tenant_user_guide' },
          },
        ],
      };

      const bodyBuffer = Buffer.from(JSON.stringify(webhookPayload));
      vi.spyOn(await import('../../utils/crypto-encryption.js'), 'verifyLineSignature').mockReturnValue(true);

      const result = await lineOaService.processWebhookEvent('mock-raw-key', bodyBuffer, 'mock-sig');
      expect(result.processedCount).toBe(1);

      expect(mockAdapter.loadingAnimationCalls).toEqual([
        { chatId: 'U_TENANT_456', loadingSeconds: 5 },
      ]);

      expect(mockAdapter.replyCalls.length).toBe(1);
      const replyCall = mockAdapter.replyCalls[0];
      expect(replyCall.replyToken).toBe('reply-token-tenant-guide');
      expect(replyCall.messages[0].altText).toContain('คู่มือการใช้งานสำหรับผู้เช่า');
      expect(replyCall.messages[0].contents.type).toBe('carousel');
      expect(replyCall.messages[0].contents.contents.length).toBe(4);
    });
  });

  describe('Phase 3: Interactive Flex Message User Guides via Carousel', () => {
    it('builds owner guide carousel with 5 slides, matching colors and correct CTA URIs', () => {
      const mockOrigin = 'https://app.horplus.test';
      const flex = buildOwnerGuideCarouselFlexMessage('หอพักทดสอบ', mockOrigin);

      expect(flex.type).toBe('flex');
      expect(flex.altText).toBe('คู่มือการใช้งานสำหรับเจ้าของหอพัก - หอพักทดสอบ');
      expect(flex.contents.type).toBe('carousel');

      const slides = flex.contents.contents;
      expect(slides).toHaveLength(5);

      // Slide 1: Rooms
      expect(slides[0].header.backgroundColor).toBe('#4F46E5');
      expect(slides[0].header.contents[1].text).toContain('ตั้งค่าหอพัก & ห้องพัก');
      expect(slides[0].footer.contents[0].action.label).toBe('ดูห้องพักทั้งหมด');
      expect(slides[0].footer.contents[0].action.uri).toMatch(/owner\/rooms/);

      // Slide 2: LINE OA
      expect(slides[1].header.backgroundColor).toBe('#059669');
      expect(slides[1].header.contents[1].text).toContain('เชื่อมต่อ LINE OA');
      expect(slides[1].footer.contents[0].action.label).toBe('ตั้งค่า LINE OA');
      expect(slides[1].footer.contents[0].action.uri).toBe('https://app.horplus.test/owner/line-oa');

      // Slide 3: Tenant Approval
      expect(slides[2].header.backgroundColor).toBe('#0284C7');
      expect(slides[2].header.contents[1].text).toContain('ตรวจสอบ & อนุมัติผู้เช่า');
      expect(slides[2].footer.contents[0].action.label).toBe('ตรวจสอบคำขอเช่า');
      expect(slides[2].footer.contents[0].action.uri).toBe('https://app.horplus.test/owner/home');

      // Slide 4: Meters & Billing
      expect(slides[3].header.backgroundColor).toBe('#D97706');
      expect(slides[3].header.contents[1].text).toContain('มิเตอร์ & การเงิน');
      expect(slides[3].footer.contents[0].action.label).toBe('จัดการบิล & การเงิน');
      expect(slides[3].footer.contents[0].action.uri).toBe('https://app.horplus.test/owner/payments');

      // Slide 5: Reports
      expect(slides[4].header.backgroundColor).toBe('#7C3AED');
      expect(slides[4].header.contents[1].text).toContain('รายงาน & ภาพรวมรายได้');
      expect(slides[4].footer.contents[0].action.label).toBe('ดูรายงานสรุป');
      expect(slides[4].footer.contents[0].action.uri).toBe('https://app.horplus.test/owner/reports');
    });

    it('builds tenant guide carousel with 4 slides, matching colors and correct CTA URIs', () => {
      const mockOrigin = 'https://app.horplus.test';
      const flex = buildTenantGuideCarouselFlexMessage('หอพักทดสอบ', mockOrigin);

      expect(flex.type).toBe('flex');
      expect(flex.altText).toBe('คู่มือการใช้งานสำหรับผู้เช่า - หอพักทดสอบ');
      expect(flex.contents.type).toBe('carousel');

      const slides = flex.contents.contents;
      expect(slides).toHaveLength(4);

      // Slide 1: Register
      expect(slides[0].header.backgroundColor).toBe('#059669');
      expect(slides[0].header.contents[1].text).toContain('ลงทะเบียนเข้าพัก');
      expect(slides[0].footer.contents[0].action.label).toBe('ลงทะเบียนผู้เช่า');
      expect(slides[0].footer.contents[0].action.uri).toMatch(/liff\.line\.me|tenant/);

      // Slide 2: Approved
      expect(slides[1].header.backgroundColor).toBe('#0284C7');
      expect(slides[1].header.contents[1].text).toContain('รับผลการอนุมัติทาง LINE');
      expect(slides[1].footer.contents[0].action.label).toBe('เข้าสู่ระบบผู้เช่า');
      expect(slides[1].footer.contents[0].action.uri).toMatch(/liff\.line\.me|tenant/);

      // Slide 3: Billing
      expect(slides[2].header.backgroundColor).toBe('#4F46E5');
      expect(slides[2].header.contents[1].text).toContain('บิลค่าเช่า & ชำระเงิน');
      expect(slides[2].footer.contents[0].action.label).toBe('ดูบิล & ชำระเงิน');
      expect(slides[2].footer.contents[0].action.uri).toMatch(/tenant/);

      // Slide 4: Repair
      expect(slides[3].header.backgroundColor).toBe('#E11D48');
      expect(slides[3].header.contents[1].text).toContain('แจ้งซ่อม & ติดต่อหอพัก');
      expect(slides[3].footer.contents[0].action.label).toBe('แจ้งซ่อมออนไลน์');
      expect(slides[3].footer.contents[0].action.uri).toMatch(/tenant/);
    });

    it('ensures zero push quota is consumed during user guide carousel deliveries', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ config_id: 'cfg-1', dormitory_id: 'dorm-001' }]);

      const webhookPayload = {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-owner-guide',
            source: { userId: 'U_OWNER_123' },
            postback: { data: 'action=owner_user_guide' },
          },
        ],
      };

      const bodyBuffer = Buffer.from(JSON.stringify(webhookPayload));
      vi.spyOn(await import('../../utils/crypto-encryption.js'), 'verifyLineSignature').mockReturnValue(true);

      await lineOaService.processWebhookEvent('mock-raw-key', bodyBuffer, 'mock-sig');

      // replyMessage called (zero quota)
      expect(mockAdapter.replyCalls.length).toBe(1);
      // pushMessage NEVER called
      expect(mockAdapter.pushCalls.length).toBe(0);
    });
  });

  describe('Silent First-Follower Owner Auto-Claim & Idempotent Guard', () => {
    it('queries followers and silently claims first follower as OWNER when no active owner grant exists', async () => {
      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValue(null); // No active owner grant exists yet
      mockAdapter.mockFollowers = ['U_OWNER_FIRST_FOLLOWER', 'U_OTHER_FOLLOWER'];

      const linkSpy = vi.spyOn(richMenuService, 'linkOwnerRichMenu').mockResolvedValue(true);

      await lineOaService.testWebhookEndpoint('dorm-001');

      // Verified friend was created/persisted for first follower
      expect(mockPrisma.dormitoryLineFriend.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId: 'dorm-001',
            friendStatus: 'FOLLOWING',
          }),
        })
      );

      // Verified OWNER access grant was created
      expect(mockPrisma.dormitoryAccessGrant.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId: 'dorm-001',
            roleCode: 'OWNER',
            status: 'ACTIVE',
          }),
        })
      );

      // Verified 3-button owner rich menu was linked
      expect(linkSpy).toHaveBeenCalledWith('dorm-001', 'U_OWNER_FIRST_FOLLOWER');
    });

    it('strictly skips owner auto-claim if an active OWNER grant already exists (idempotent guard)', async () => {
      mockPrisma.dormitoryAccessGrant.findFirst.mockResolvedValue({
        id: 'existing-grant-id',
        dormitoryId: 'dorm-001',
        roleCode: 'OWNER',
        status: 'ACTIVE',
      });

      const linkSpy = vi.spyOn(richMenuService, 'linkOwnerRichMenu').mockResolvedValue(true);

      await lineOaService.testWebhookEndpoint('dorm-001');

      // Never attempted to create new access grant
      expect(mockPrisma.dormitoryAccessGrant.create).not.toHaveBeenCalled();
      // Never re-linked menu
      expect(linkSpy).not.toHaveBeenCalled();
    });
  });
});

