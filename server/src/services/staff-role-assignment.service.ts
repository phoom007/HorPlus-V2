import crypto from 'crypto';
import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import { lineQuotaService, LineQuotaService } from './line-quota.service.js';
import {
  LineMessagingProvider,
  MockLineMessagingProvider,
  LineAccessTokenProvider,
  MockLineAccessTokenProvider
} from './line-provider.interface.js';
import { auditService } from './audit.service.js';

export class StaffRoleAssignmentService {
  constructor(
    private repo: LineRepository = lineRepository,
    private quotaService: LineQuotaService = lineQuotaService,
    private messagingProvider: LineMessagingProvider = new MockLineMessagingProvider(),
    private tokenProvider: LineAccessTokenProvider = new MockLineAccessTokenProvider()
  ) {}

  private decryptSecret(encrypted: string): string {
    try {
      // ...
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('12345678901234567890123456789012'), Buffer.from('1234567890123456'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encrypted;
    }
  }

  async listFollowers(dormitoryId: string, params?: { friendStatus?: string; search?: string }) {
    const followers = await this.repo.getFollowers(dormitoryId);
    const assignments = await this.repo.listRoleAssignments(dormitoryId);
    const assignmentMap = new Map(assignments.map((a: any) => [a.lineIdentityId, a]));

    return followers.map(f => {
      const currentRole = assignmentMap.get(f.lineIdentityId);
      return {
        id: f.id,
        lineIdentityId: f.lineIdentityId,
        displayName: f.identity.displayName,
        pictureUrl: f.identity.pictureUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${f.lineIdentityId}`,
        friendStatus: f.friendStatus,
        followedAt: f.followedAt,
        roleCode: currentRole ? (<any>currentRole).roleCode : undefined,
        status: currentRole ? (<any>currentRole).status : 'unassigned',
        roleAssignmentId: currentRole ? (<any>currentRole).id : undefined
      };
    });
  }

  async assignRole(params: {
    dormitoryId: string;
    followerId: string;
    roleCode: string; // OWNER, MANAGER, TECH
    sendLineNotification?: boolean;
    assignedByUserId?: string;
    memberId?: string;
  }) {
    // Lock allowed roles
    if (!['OWNER', 'MANAGER', 'TECH'].includes(params.roleCode)) {
      throw new Error('INVALID_ROLE_CODE: Allowed roles are OWNER, MANAGER, TECH.');
    }

    const follower = await this.repo.getFollowerById(params.followerId);
    if (!follower || follower.dormitoryId !== params.dormitoryId) {
      throw new Error('FOLLOWER_NOT_FOUND');
    }

    const memberId = params.memberId || params.assignedByUserId || follower.lineIdentityId;

    // 1. Database Transaction — Assign Role
    const assignment = await this.repo.upsertRoleAssignment({
      dormitoryId: params.dormitoryId,
      lineIdentityId: follower.lineIdentityId,
      dormitoryMemberId: memberId,
      roleCode: params.roleCode,
      assignedByUserId: params.assignedByUserId
    });

    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.assignedByUserId,
      actorRole: 'OWNER',
      action: 'STAFF_ROLE_ASSIGNED',
      targetType: 'line_role_assignment',
      targetId: assignment.id,
      summary: `มอบสิทธิ์ ${params.roleCode} ให้ ${follower.identity.displayName}`
    });

    let notificationSent = false;
    let notificationError = null;

    // 2. Notification Dispatch (If single checkbox checked)
    if (params.sendLineNotification) {
      const quotaAvailable = await this.quotaService.reserveQuota(params.dormitoryId);
      if (!quotaAvailable) {
        notificationError = 'QUOTA_EXHAUSTED: Message limit reached for this month.';
      } else {
        const integration = await this.repo.getIntegrationByDormitory(params.dormitoryId);
        if (integration) {
          const liffUrl = `${integration.liffEndpointUrl || 'https://liff.line.me/' + (integration.liffId || 'mock-liff')}`;
          let text = '';
          if (params.roleCode === 'MANAGER') {
            text = `คุณได้รับสิทธิ์ผู้จัดการ\n\nคุณสามารถเปิดระบบจัดการหอพักตามขอบเขตที่เจ้าของกำหนด\n\n[ เปิดระบบ ]\n${liffUrl}`;
          } else if (params.roleCode === 'TECH') {
            text = `คุณได้รับสิทธิ์ช่าง / แม่บ้าน\n\nคุณสามารถเปิดดูงาน จดมิเตอร์ และงานแจ้งซ่อมที่ได้รับมอบหมาย\n\n[ เปิดระบบ ]\n${liffUrl}`;
          } else {
            text = `คุณได้รับสิทธิ์เจ้าของหอพัก\n\nคุณสามารถเปิดระบบจัดการหอพักแบบเต็มรูปแบบ\n\n[ เปิดระบบ ]\n${liffUrl}`;
          }

          const { outbox, delivery } = await this.repo.createOutboxAndDelivery({
            dormitoryId: params.dormitoryId,
            lineOaIntegrationId: integration.id,
            recipientLineIdentityId: follower.lineIdentityId,
            messageCategory: 'role_assignment_notification',
            deliveryType: 'direct_notification',
            payload: { text, roleCode: params.roleCode },
            idempotencyKey: `role_notif_${assignment.id}_${Date.now()}`
          });

          try {
            const token = await this.tokenProvider.getAccessToken(integration.id, integration.messagingChannelId, this.decryptSecret(integration.channelSecretEncrypted));
            const sendRes = await this.messagingProvider.sendDirectNotification({
              accessToken: token.accessToken,
              recipientLineUserId: follower.identity.lineUserId,
              messages: [{ type: 'text', text }]
            });

            if (sendRes.success) {
              await this.repo.markDeliverySuccess(delivery.id, { providerMessageId: sendRes.providerMessageId });
              await this.quotaService.consumeQuotaOnSuccess(params.dormitoryId);
              notificationSent = true;
            } else {
              await this.repo.markDeliveryFailed(delivery.id, { code: sendRes.errorCode || 'SEND_FAILED', message: sendRes.errorMessage || 'Failed' });
              notificationError = sendRes.errorMessage;
            }
          } catch (err: any) {
            await this.repo.markDeliveryFailed(delivery.id, { code: 'DISPATCH_ERROR', message: err.message });
            notificationError = err.message;
          }
        }
      }
    }

    return {
      success: true,
      assignmentId: assignment.id,
      roleCode: assignment.roleCode,
      displayName: follower.identity.displayName,
      notificationSent,
      notificationError
    };
  }

  async revokeRole(params: {
    dormitoryId: string;
    assignmentId: string;
    revokedByUserId: string;
    reason?: string;
  }) {
    const revoked = await this.repo.revokeRoleAssignment(params.assignmentId, params.revokedByUserId);
    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.revokedByUserId,
      actorRole: 'OWNER',
      action: 'STAFF_ROLE_REVOKED',
      targetType: 'line_role_assignment',
      targetId: params.assignmentId,
      summary: 'ยกเลิกสิทธิ์พนักงาน'
    });
    return { success: true, revokedId: revoked.id };
  }
}

export const staffRoleAssignmentService = new StaffRoleAssignmentService();
