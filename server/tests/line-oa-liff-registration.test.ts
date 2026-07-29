import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LineIntegrationService } from '../src/services/line-integration.service.js';
import { LineWebhookService } from '../src/services/line-webhook.service.js';
import { StaffRoleAssignmentService } from '../src/services/staff-role-assignment.service.js';
import { TenantRegistrationService } from '../src/services/tenant-registration.service.js';
import { LineQuotaService } from '../src/services/line-quota.service.js';
import { LiffSessionService } from '../src/services/liff-session.service.js';
import {
  MockLineAccessTokenProvider,
  MockLineMessagingProvider,
  MockLiffIdentityVerifier
} from '../src/services/line-provider.interface.js';

describe('TASK 015 — LINE OA Connection, LIFF Role Access & Tenant Registration', () => {
  let mockRepo: any;
  let mockQuotaService: any;
  let mockTokenProvider: MockLineAccessTokenProvider;
  let mockMessagingProvider: MockLineMessagingProvider;
  let mockLiffVerifier: MockLiffIdentityVerifier;

  let integrationService: LineIntegrationService;
  let webhookService: LineWebhookService;
  let staffService: StaffRoleAssignmentService;
  let registrationService: TenantRegistrationService;
  let quotaService: LineQuotaService;
  let liffService: LiffSessionService;

  const dormId = 'dorm-test-001';

  beforeEach(() => {
    mockTokenProvider = new MockLineAccessTokenProvider();
    mockMessagingProvider = new MockLineMessagingProvider();
    mockLiffVerifier = new MockLiffIdentityVerifier();

    const storedIntegration = {
      id: 'integ-111',
      dormitoryId: dormId,
      messagingChannelId: '200111222',
      channelSecretEncrypted: 'secret_123',
      lineLoginChannelId: '200333444',
      liffId: '200333444-liff',
      liffEndpointUrl: 'https://liff.line.me/200333444-liff',
      botUserId: 'U_bot_test',
      botDisplayName: 'หอพัก HorPlus OA Test',
      botPictureUrl: 'https://example.com/bot.png',
      webhookPublicKey: 'wh_test_key_123',
      webhookKeyHash: 'hash_123',
      status: 'connected',
      connectedAt: new Date(),
      lastConnectionCheckAt: new Date(),
      lastWebhookReceivedAt: new Date()
    };

    const storedFollower = {
      id: 'fol-001',
      dormitoryId: dormId,
      lineOaIntegrationId: 'integ-111',
      lineIdentityId: 'ident-001',
      friendStatus: 'following',
      followedAt: new Date(),
      identity: {
        id: 'ident-001',
        lineUserId: 'U_user_001',
        displayName: 'สมชาย ใจดี',
        pictureUrl: 'https://example.com/avatar.png'
      }
    };

    const storedRoleAssignment = {
      id: 'role-001',
      dormitoryId: dormId,
      lineIdentityId: 'ident-001',
      dormitoryMemberId: 'mem-001',
      roleCode: 'MANAGER',
      status: 'active',
      assignedAt: new Date()
    };

    const storedRegistration = {
      id: 'req-001',
      dormitoryId: dormId,
      lineIdentityId: 'ident-001',
      requestedRoomId: 'room-101',
      firstName: 'อนันต์',
      lastName: 'สุขสวัสดิ์',
      phone: '0812345678',
      note: 'ขอย้ายเข้าต้นเดือน',
      status: 'pending_owner_approval',
      submittedAt: new Date(),
      identity: storedFollower.identity,
      follower: storedFollower,
      version: 1
    };

    mockRepo = {
      getIntegrationByDormitory: vi.fn().mockResolvedValue(storedIntegration),
      getIntegrationByPublicKey: vi.fn().mockResolvedValue(storedIntegration),
      upsertIntegration: vi.fn().mockResolvedValue(storedIntegration),
      updateIntegrationStatus: vi.fn().mockResolvedValue(storedIntegration),
      updateLastWebhookTimestamp: vi.fn().mockResolvedValue(storedIntegration),
      disconnectIntegration: vi.fn().mockResolvedValue({ id: 'integ-111', status: 'disconnected' }),

      upsertLineIdentity: vi.fn().mockResolvedValue(storedFollower.identity),
      findIdentityByLineUserId: vi.fn().mockResolvedValue(storedFollower.identity),
      upsertFollower: vi.fn().mockResolvedValue(storedFollower),
      getFollowers: vi.fn().mockResolvedValue([storedFollower]),
      getFollowerById: vi.fn().mockResolvedValue(storedFollower),

      hasProcessedWebhookEvent: vi.fn().mockResolvedValue(false),
      recordWebhookEvent: vi.fn().mockResolvedValue({ id: 'evt-1' }),
      recordWebhookAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),

      getRoleAssignment: vi.fn().mockResolvedValue(null),
      listRoleAssignments: vi.fn().mockResolvedValue([]),
      listRoleAssignmentsForIdentity: vi.fn().mockResolvedValue([]),
      listTenantBindingsForIdentity: vi.fn().mockResolvedValue([]),
      upsertRoleAssignment: vi.fn().mockImplementation(async (params: any) => ({
        ...storedRoleAssignment,
        roleCode: params.roleCode
      })),
      revokeRoleAssignment: vi.fn().mockResolvedValue({ id: 'role-001', status: 'revoked' }),

      findRegistrationById: vi.fn().mockResolvedValue(storedRegistration),
      getPendingRegistrationForIdentity: vi.fn().mockResolvedValue(storedRegistration),
      listRegistrationRequests: vi.fn().mockResolvedValue([storedRegistration]),
      createOrUpdateRegistrationDraft: vi.fn().mockResolvedValue(storedRegistration),
      approveRegistrationRequest: vi.fn().mockResolvedValue({ ...storedRegistration, status: 'approved' }),
      rejectRegistrationRequest: vi.fn().mockResolvedValue({ ...storedRegistration, status: 'rejected' }),

      getTenantBindingForIdentity: vi.fn().mockResolvedValue(null),
      createTenantBinding: vi.fn().mockResolvedValue({ id: 'bind-001', status: 'active' }),

      getOrCreateCurrentQuotaCycle: vi.fn().mockResolvedValue({
        id: 'cycle-001',
        dormitoryId: dormId,
        year: 2026,
        month: 7,
        quotaLimit: 300,
        successfulSendCount: 10,
        reservedCount: 0,
        periodStart: new Date(),
        periodEnd: new Date()
      }),
      incrementQuotaUsage: vi.fn().mockResolvedValue({ successfulSendCount: 11 }),
      createOutboxAndDelivery: vi.fn().mockResolvedValue({
        outbox: { id: 'out-1' },
        delivery: { id: 'del-1' }
      }),
      markDeliverySuccess: vi.fn().mockResolvedValue({ id: 'del-1', status: 'sent' }),
      markDeliveryFailed: vi.fn().mockResolvedValue({ id: 'del-1', status: 'failed' }),
      listDeliveries: vi.fn().mockResolvedValue([])
    };

    mockQuotaService = new LineQuotaService(mockRepo);

    integrationService = new LineIntegrationService(mockRepo, mockTokenProvider, mockMessagingProvider, mockLiffVerifier);
    webhookService = new LineWebhookService(mockRepo, mockMessagingProvider, mockTokenProvider);
    staffService = new StaffRoleAssignmentService(mockRepo, mockQuotaService, mockMessagingProvider, mockTokenProvider);
    registrationService = new TenantRegistrationService(mockRepo, mockQuotaService, mockMessagingProvider, mockTokenProvider);
    liffService = new LiffSessionService(mockRepo, mockLiffVerifier);
  });

  describe('1. LineIntegrationService', () => {
    it('should retrieve masked integration settings', async () => {
      const settings = await integrationService.getIntegrationSettings(dormId);
      expect(settings.connected).toBe(true);
      expect(settings.messagingChannelId).toBe('200111222');
      expect(settings.channelSecretMasked).toContain('••••');
      expect(settings.webhookUrl).toContain('wh_test_key_123');
    });

    it('should test connection successfully', async () => {
      const result = await integrationService.testConnection(dormId);
      expect(result.success).toBe(true);
      expect(result.botDisplayName).toBe('หอพัก HorPlus OA');
    });

    it('should bind owner LINE account idempotently', async () => {
      const bound = await integrationService.bindOwnerLineAccount({
        dormitoryId: dormId,
        userId: 'user-owner',
        memberId: 'mem-owner',
        liffIdToken: 'owner_liff_id_token'
      });
      expect(bound.success).toBe(true);
      expect(bound.roleCode).toBe('OWNER');
    });
  });

  describe('2. LineWebhookService', () => {
    it('should process follow event and send welcome reply without deducting quota', async () => {
      const payload = {
        events: [
          {
            type: 'follow',
            webhookEventId: 'evt_follow_999',
            replyToken: 'reply_token_999',
            source: { userId: 'U_new_follower' }
          }
        ]
      };

      const result = await webhookService.processWebhook({
        webhookPublicKey: 'wh_test_key_123',
        signature: 'mock_sig_valid',
        body: JSON.stringify(payload)
      });

      expect(result.status).toBe(200);
      expect(mockRepo.recordWebhookAudit).toHaveBeenCalled();
      expect(mockRepo.createOutboxAndDelivery).toHaveBeenCalled();
    });

    it('should reject invalid webhook signature', async () => {
      const result = await webhookService.processWebhook({
        webhookPublicKey: 'wh_test_key_123',
        signature: 'invalid_signature_test',
        body: JSON.stringify({ events: [] })
      });

      expect(result.status).toBe(401);
    });
  });

  describe('3. StaffRoleAssignmentService', () => {
    it('should assign MANAGER role and send LINE notification deducting 1 quota unit', async () => {
      const res = await staffService.assignRole({
        dormitoryId: dormId,
        followerId: 'fol-001',
        roleCode: 'MANAGER',
        sendLineNotification: true,
        assignedByUserId: 'user-owner'
      });

      expect(res.success).toBe(true);
      expect(res.roleCode).toBe('MANAGER');
      expect(res.notificationSent).toBe(true);
      expect(mockRepo.incrementQuotaUsage).toHaveBeenCalled();
    });

    it('should assign TECH role without notification when checkbox is false', async () => {
      const res = await staffService.assignRole({
        dormitoryId: dormId,
        followerId: 'fol-001',
        roleCode: 'TECH',
        sendLineNotification: false,
        assignedByUserId: 'user-owner'
      });

      expect(res.success).toBe(true);
      expect(res.roleCode).toBe('TECH');
      expect(res.notificationSent).toBe(false);
      expect(mockRepo.incrementQuotaUsage).not.toHaveBeenCalled();
    });

    it('should throw error for invalid role code', async () => {
      await expect(
        staffService.assignRole({
          dormitoryId: dormId,
          followerId: 'fol-001',
          roleCode: 'FINANCE' as any,
          sendLineNotification: false
        })
      ).rejects.toThrow('INVALID_ROLE_CODE');
    });
  });

  describe('4. TenantRegistrationService & Approval', () => {
    it('should submit tenant registration request without sending LINE notification', async () => {
      const res = await registrationService.submitRegistration({
        dormitoryId: dormId,
        lineIdentityId: 'ident-001',
        requestedRoomId: 'room-101',
        firstName: 'อนันต์',
        lastName: 'สุขสวัสดิ์',
        phone: '0812345678',
        note: 'ขอเข้าพักต้นเดือน'
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('pending_owner_approval');
      expect(mockRepo.incrementQuotaUsage).not.toHaveBeenCalled();
    });
  });

  describe('5. LineQuotaService', () => {
    it('should report correct monthly quota status (300/month limit)', async () => {
      const status = await mockQuotaService.getQuotaStatus(dormId);
      expect(status.limit).toBe(300);
      expect(status.used).toBe(10);
      expect(status.remaining).toBe(290);
    });
  });

  describe('6. LiffSessionService', () => {
    it('should exchange idToken and determine target route', async () => {
      const { session, targetRoute } = await liffService.exchangeIdToken({
        dormitoryId: dormId,
        idToken: 'tenant_id_token'
      });

      expect(session.sessionId).toContain('linesess_');
      expect(targetRoute).toBe('/tenant/register');
    });
  });
});
