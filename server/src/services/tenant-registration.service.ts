import { prisma } from '../db/prisma.js';
import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import { lineQuotaService, LineQuotaService } from './line-quota.service.js';
import {
  LineMessagingProvider,
  MockLineMessagingProvider,
  LineAccessTokenProvider,
  MockLineAccessTokenProvider
} from './line-provider.interface.js';
import { auditService } from './audit.service.js';

export class TenantRegistrationService {
  constructor(
    private repo: LineRepository = lineRepository,
    private quotaService: LineQuotaService = lineQuotaService,
    private messagingProvider: LineMessagingProvider = new MockLineMessagingProvider(),
    private tokenProvider: LineAccessTokenProvider = new MockLineAccessTokenProvider()
  ) {}

  private decryptSecret(encrypted: string): string {
    try {
      const crypto = require('crypto');
      const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from('12345678901234567890123456789012'), Buffer.from('1234567890123456'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encrypted;
    }
  }

  async getAvailableRoomsForRegistration(dormitoryId: string) {
    const rooms = await prisma.room.findMany({
      where: { dormitoryId, status: { not: 'archived' } },
      include: { building: true },
      orderBy: [{ buildingId: 'asc' }, { number: 'asc' }]
    });

    // Check for duplicate room numbers across buildings
    const numberCounts = new Map<string, number>();
    for (const r of rooms) {
      numberCounts.set(r.number, (numberCounts.get(r.number) || 0) + 1);
    }

    return rooms.map(r => {
      const isDuplicateNumber = (numberCounts.get(r.number) || 0) > 1;
      const buildingName = r.building?.name || 'อาคารหลัก';
      const displayLabel = isDuplicateNumber ? `${r.number} — ${buildingName}` : r.number;

      return {
        roomId: r.id,
        roomNumber: r.number,
        displayLabel
      };
    });
  }

  async submitRegistration(params: {
    dormitoryId: string;
    lineIdentityId: string;
    lineFollowerId?: string;
    requestedRoomId: string;
    firstName: string;
    lastName: string;
    phone: string;
    note?: string;
  }) {
    const request = await this.repo.createOrUpdateRegistrationDraft(params);
    // NO automatic LINE message sent after submit!
    return {
      success: true,
      requestId: request.id,
      status: request.status,
      message: 'ส่งคำขอลงทะเบียนเรียบร้อยแล้ว ขณะนี้กำลังรอเจ้าของหอพักตรวจสอบ'
    };
  }

  async getRegistrationStatusForIdentity(dormitoryId: string, lineIdentityId: string) {
    const pending = await this.repo.getPendingRegistrationForIdentity(dormitoryId, lineIdentityId);
    const binding = await this.repo.getTenantBindingForIdentity(dormitoryId, lineIdentityId);

    return {
      hasBinding: !!binding && binding.status === 'active',
      binding,
      pendingRequest: pending
    };
  }

  async listRequestsForOwner(dormitoryId: string, status?: string) {
    const requests = await this.repo.listRegistrationRequests(dormitoryId, status);
    const tenants = await prisma.tenant.findMany({ where: { dormitoryId, status: 'active' } });
    const contracts = await prisma.contract.findMany({ where: { dormitoryId, status: { in: ['active', 'signed'] } }, include: { room: true } });

    return requests.map(req => {
      // Find suggested tenant match by name/phone
      const suggestedTenant = tenants.find(t => t.phone === req.phone || (t.firstName === req.firstName && t.lastName === req.lastName));
      const suggestedContract = contracts.find(c => c.roomId === req.requestedRoomId || (suggestedTenant && c.tenantId === suggestedTenant.id));

      return {
        id: req.id,
        lineIdentityId: req.lineIdentityId,
        displayName: req.identity?.displayName,
        pictureUrl: req.identity?.pictureUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${req.lineIdentityId}`,
        requestedRoomId: req.requestedRoomId,
        firstName: req.firstName,
        lastName: req.lastName,
        phone: req.phone,
        note: req.note,
        status: req.status,
        submittedAt: req.submittedAt || req.createdAt,
        suggestedTenantId: suggestedTenant?.id || null,
        suggestedContractId: suggestedContract?.id || null,
        version: req.version
      };
    });
  }

  async approveRegistration(params: {
    dormitoryId: string;
    requestId: string;
    tenantId: string;
    contractId: string;
    sendLineNotification?: boolean;
    reviewedByUserId: string;
  }) {
    const req = await this.repo.findRegistrationById(params.requestId);
    if (!req || req.dormitoryId !== params.dormitoryId) {
      throw new Error('REGISTRATION_REQUEST_NOT_FOUND');
    }

    const contract = await prisma.contract.findUnique({
      where: { id: params.contractId },
      include: { room: true }
    });

    if (!contract || contract.dormitoryId !== params.dormitoryId) {
      throw new Error('CONTRACT_NOT_FOUND');
    }

    if (contract.tenantId !== params.tenantId) {
      throw new Error('CONTRACT_TENANT_MISMATCH: Selected contract does not belong to selected tenant.');
    }

    const roomId = contract.roomId;

    // 1. Transaction — Create Binding & Approve Request
    await this.repo.createTenantBinding({
      dormitoryId: params.dormitoryId,
      lineIdentityId: req.lineIdentityId,
      tenantId: params.tenantId,
      contractId: params.contractId,
      roomId,
      approvedByUserId: params.reviewedByUserId
    });

    await this.repo.approveRegistrationRequest({
      requestId: req.id,
      reviewedByUserId: params.reviewedByUserId,
      approvedTenantId: params.tenantId,
      approvedContractId: params.contractId,
      approvedRoomId: roomId
    });

    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.reviewedByUserId,
      actorRole: 'OWNER',
      action: 'TENANT_REGISTRATION_APPROVED',
      targetType: 'tenant_registration_request',
      targetId: req.id,
      summary: `อนุมัติการลงทะเบียนผู้เช่า ${req.firstName} ${req.lastName}`
    });

    // Check if room has pending payment
    const unpaidBills = await prisma.bill.findMany({
      where: {
        dormitoryId: params.dormitoryId,
        roomId,
        status: { in: ['unpaid', 'partially_paid', 'overdue'] }
      }
    });
    const hasPendingPayment = unpaidBills.length > 0;

    let notificationSent = false;
    let notificationError = null;

    // 2. Conditional Notification Dispatch (If single checkbox checked)
    if (params.sendLineNotification) {
      const quotaAvailable = await this.quotaService.reserveQuota(params.dormitoryId);
      if (!quotaAvailable) {
        notificationError = 'QUOTA_EXHAUSTED: Message limit reached for this month.';
      } else {
        const integration = await this.repo.getIntegrationByDormitory(params.dormitoryId);
        if (integration) {
          const liffUrl = `${integration.liffEndpointUrl || 'https://liff.line.me/' + (integration.liffId || 'mock-liff')}`;
          let text = '';
          if (hasPendingPayment) {
            text = `ลงทะเบียนสำเร็จ\n\nขณะนี้ห้องของคุณมีรายการรอชำระ กรุณาเปิดระบบเพื่อตรวจสอบรายละเอียด\n\n[ เปิดระบบผู้เช่า ]\n${liffUrl}`;
          } else {
            text = `ลงทะเบียนสำเร็จ\n\nคุณสามารถเปิดระบบผู้เช่าได้แล้ว\n\n[ เปิดระบบผู้เช่า ]\n${liffUrl}`;
          }

          const { delivery } = await this.repo.createOutboxAndDelivery({
            dormitoryId: params.dormitoryId,
            lineOaIntegrationId: integration.id,
            recipientLineIdentityId: req.lineIdentityId,
            messageCategory: 'tenant_approval_notification',
            deliveryType: 'direct_notification',
            payload: { text, hasPendingPayment },
            idempotencyKey: `approval_notif_${req.id}_${Date.now()}`
          });

          try {
            const token = await this.tokenProvider.getAccessToken(integration.id, integration.messagingChannelId, this.decryptSecret(integration.channelSecretEncrypted));
            const sendRes = await this.messagingProvider.sendDirectNotification({
              accessToken: token.accessToken,
              recipientLineUserId: req.identity.lineUserId,
              messages: [{ type: 'text', text }]
            });

            if (sendRes.success) {
              await this.repo.markDeliverySuccess(delivery.id, sendRes.providerMessageId, true);
              await this.quotaService.consumeQuotaOnSuccess(params.dormitoryId);
              notificationSent = true;
            } else {
              await this.repo.markDeliveryFailed(delivery.id, sendRes.errorCode || 'SEND_FAILED', sendRes.errorMessage || 'Failed');
              notificationError = sendRes.errorMessage;
            }
          } catch (err: any) {
            await this.repo.markDeliveryFailed(delivery.id, 'DISPATCH_ERROR', err.message);
            notificationError = err.message;
          }
        }
      }
    }

    return {
      success: true,
      requestId: req.id,
      status: 'approved',
      hasPendingPayment,
      notificationSent,
      notificationError
    };
  }

  async rejectRegistration(params: {
    dormitoryId: string;
    requestId: string;
    reviewedByUserId: string;
    rejectedReason: string;
  }) {
    const rejected = await this.repo.rejectRegistrationRequest(params.requestId, params.reviewedByUserId, params.rejectedReason);
    await auditService.record({
      dormitoryId: params.dormitoryId,
      actorUserId: params.reviewedByUserId,
      actorRole: 'OWNER',
      action: 'TENANT_REGISTRATION_REJECTED',
      targetType: 'tenant_registration_request',
      targetId: params.requestId,
      summary: `ปฏิเสธคำขอลงทะเบียนผู้เช่า (${params.rejectedReason})`
    });

    return { success: true, requestId: rejected.id, status: 'rejected' };
  }
}

export const tenantRegistrationService = new TenantRegistrationService();
