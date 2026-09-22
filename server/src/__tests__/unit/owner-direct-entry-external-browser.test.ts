/**
 * Unit tests for Ticket 04: Owner LINE OA Direct Entry via External Browser
 * Tests:
 * 1. buildOwnerDirectEntryFlexMessage generates URL with openExternalBrowser=1
 * 2. line-oa.service.ts constructs directEntryUrl pointing to external browser URL with openExternalBrowser=1
 * 3. auth.routes.ts /api/v1/auth/line-direct-entry handles openExternalBrowser=1, sets cookies, and redirects to /owner/home
 *
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  LineOaService,
  buildOwnerDirectEntryFlexMessage,
} from '../../services/line-oa.service.js';
import {
  LineRichMenuService,
  createDirectEntryTicket,
} from '../../services/line-richmenu.service.js';
import { MockLinePlatformAdapter } from '../../services/line-platform-adapter.js';
import { encryptText } from '../../utils/crypto-encryption.js';
import { createAuthRouter } from '../../routes/auth.routes.js';

process.env.DATABASE_URL = 'postgresql://horplus_app:mock_password@127.0.0.1:5432/mock_db';

const { mockPrismaSession } = vi.hoisted(() => {
  return {
    mockPrismaSession: {
      create: vi.fn().mockResolvedValue({
        id: 'session-uuid-1',
        status: 'active',
      }),
    },
  };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => ({
    session: mockPrismaSession,
  }),
}));

describe('Ticket 04: Owner LINE OA Direct Entry via External Browser Suite', () => {
  describe('buildOwnerDirectEntryFlexMessage', () => {
    it('ensures openExternalBrowser=1 is present in the button URI when URL has existing query params', () => {
      const flex = buildOwnerDirectEntryFlexMessage(
        'หอพักสุขสบายแกรนด์',
        'https://app.horplus.com/api/v1/auth/line-direct-entry?ticket=ticket_test123'
      );

      const buttonAction = (flex as any).contents.footer.contents[0].action;
      expect(buttonAction.type).toBe('uri');
      expect(buttonAction.label).toBe('เปิด Dashboard จัดการหอพัก');
      expect(buttonAction.uri).toContain('openExternalBrowser=1');
      expect(buttonAction.uri).toBe(
        'https://app.horplus.com/api/v1/auth/line-direct-entry?ticket=ticket_test123&openExternalBrowser=1'
      );
    });

    it('ensures openExternalBrowser=1 is appended with ? when URL has no query params', () => {
      const flex = buildOwnerDirectEntryFlexMessage(
        'หอพักสุขสบายแกรนด์',
        'https://app.horplus.com/owner/home'
      );

      const buttonAction = (flex as any).contents.footer.contents[0].action;
      expect(buttonAction.uri).toBe('https://app.horplus.com/owner/home?openExternalBrowser=1');
    });

    it('does not duplicate openExternalBrowser=1 if it is already present in the URL', () => {
      const flex = buildOwnerDirectEntryFlexMessage(
        'หอพักสุขสบายแกรนด์',
        'https://app.horplus.com/api/v1/auth/line-direct-entry?ticket=ticket_test123&openExternalBrowser=1'
      );

      const buttonAction = (flex as any).contents.footer.contents[0].action;
      const count = (buttonAction.uri.match(/openExternalBrowser=1/g) || []).length;
      expect(count).toBe(1);
      expect(buttonAction.uri).toBe(
        'https://app.horplus.com/api/v1/auth/line-direct-entry?ticket=ticket_test123&openExternalBrowser=1'
      );
    });
  });

  describe('LINE OA Webhook postback action=manage_dormitory', () => {
    let mockAdapter: MockLinePlatformAdapter;
    let mockPrisma: any;
    let lineOaService: LineOaService;

    beforeEach(() => {
      mockAdapter = new MockLinePlatformAdapter();
      mockPrisma = {
        $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([{ config_id: 'cfg-1', dormitory_id: 'dorm-001' }]),
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
          findFirst: vi.fn().mockResolvedValue({
            id: 'grant-owner-1',
            dormitoryId: 'dorm-001',
            roleCode: 'OWNER',
            status: 'ACTIVE',
          }),
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
      };

      lineOaService = new LineOaService(mockPrisma, mockAdapter);
      vi.spyOn(lineOaService, 'resolveAccessToken').mockResolvedValue('mock-access-token');
    });

    it('constructs directEntryUrl with openExternalBrowser=1 pointing to /api/v1/auth/line-direct-entry', async () => {
      const webhookPayload = {
        events: [
          {
            type: 'postback',
            replyToken: 'reply-token-manage-ext',
            source: { userId: 'U_OWNER_999' },
            postback: { data: 'action=manage_dormitory' },
          },
        ],
      };

      const bodyBuffer = Buffer.from(JSON.stringify(webhookPayload));
      vi.spyOn(await import('../../utils/crypto-encryption.js'), 'verifyLineSignature').mockReturnValue(true);

      const result = await lineOaService.processWebhookEvent('mock-raw-key', bodyBuffer, 'mock-sig');
      expect(result.processedCount).toBe(1);

      expect(mockAdapter.replyCalls.length).toBe(1);
      const replyCall = mockAdapter.replyCalls[0];
      const buttonUri = replyCall.messages[0].contents.footer.contents[0].action.uri;

      // Must point to /api/v1/auth/line-direct-entry with ticket and openExternalBrowser=1
      expect(buttonUri).toContain('/api/v1/auth/line-direct-entry');
      expect(buttonUri).toContain('ticket=ticket_');
      expect(buttonUri).toContain('openExternalBrowser=1');
    });
  });

  describe('GET /api/v1/auth/line-direct-entry route with openExternalBrowser=1', () => {
    let app: express.Express;
    let mockAuthService: any;

    beforeEach(() => {
      vi.clearAllMocks();

      mockAuthService = {
        getSessionTokenService: () => ({
          encryptToken: vi.fn().mockReturnValue('encrypted-mock-session-token'),
        }),
        getCsrfService: () => ({
          generateCsrfToken: vi.fn().mockReturnValue('mock-csrf-token'),
        }),
        authenticateGoogle: vi.fn(),
        validateSession: vi.fn(),
        requireAuth: () => (req: any, res: any, next: any) => next(),
      };

      app = express();
      app.use(express.json());
      app.use('/api/v1/auth', createAuthRouter(mockAuthService));
    });

    it('successfully consumes ticket with openExternalBrowser=1, sets session cookies and redirects to /owner/home', async () => {
      const ticket = createDirectEntryTicket({
        dormitoryId: 'dorm-001',
        lineUserId: 'U_OWNER_999',
        roleCode: 'OWNER',
        userId: 'user-owner-uuid',
      });

      const res = await request(app)
        .get(`/api/v1/auth/line-direct-entry?ticket=${ticket}&openExternalBrowser=1`)
        .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
        .set('X-Forwarded-Proto', 'https')
        .set('Host', 'app.horplus.com');

      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/owner/home');

      // Check cookies
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
      expect(cookieStr).toContain('horplus_session=');
      expect(cookieStr).toContain('horplus_csrf=');
      expect(cookieStr).toContain('active_dormitory_id=dorm-001');
    });

    it('returns 400 Bad Request when ticket is missing even if openExternalBrowser=1 is provided', async () => {
      const res = await request(app).get('/api/v1/auth/line-direct-entry?openExternalBrowser=1');
      expect(res.status).toBe(400);
      expect(res.text).toContain('ไม่พบรหัสเข้าสู่ระบบ');
    });

    it('returns 401 when ticket is invalid or already consumed', async () => {
      const res = await request(app).get('/api/v1/auth/line-direct-entry?ticket=invalid-ticket&openExternalBrowser=1');
      expect(res.status).toBe(401);
      expect(res.text).toContain('ลิงก์เข้าสู่ระบบหมดอายุแล้ว');
    });
  });
});
