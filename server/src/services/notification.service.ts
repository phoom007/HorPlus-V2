import { InMemoryNotificationRepository, InAppNotificationEntity } from '../db/repositories/notification.repository.js';
import { LineRepository, lineRepository } from '../db/repositories/line.repository.js';
import { LineQuotaService } from './line-quota.service.js';
import { LineMessagingProvider, MockLineMessagingProvider } from './line-provider.interface.js';

export interface NotificationPreferenceInput {
  notifyRoleAssignment?: boolean;
  notifyTenantApproval?: boolean;
  notifyBillCreated?: boolean;
  notifyPaymentApproved?: boolean;
  notifyPaymentRejected?: boolean;
  notifyMaintenanceUpdate?: boolean;
  notifyAnnouncement?: boolean;
}

export type EventNotificationCategory =
  | 'ROLE_ASSIGNED'
  | 'TENANT_APPROVED'
  | 'BILL_CREATED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_REJECTED'
  | 'MAINTENANCE_ASSIGNED'
  | 'MAINTENANCE_STATUS_UPDATED'
  | 'ANNOUNCEMENT_PUBLISHED';

export interface EvaluateLineNotificationInput {
  dormitoryId: string;
  category: EventNotificationCategory;
  actionSendLineCheckbox?: boolean;
  actorRoleCode?: string;
  recipientLineIdentityId?: string;
  recipientTenantId?: string;
  templateParams: Record<string, string>;
  idempotencyKey?: string;
}

export interface LineNotificationDecision {
  shouldSendLine: boolean;
  reason: string;
  quotaUsed: number;
  outboxId?: string;
}

export class NotificationService {
  constructor(
    private notificationRepo: InMemoryNotificationRepository = new InMemoryNotificationRepository(),
    private lineRepo: LineRepository = lineRepository,
    private quotaService: LineQuotaService = new LineQuotaService(lineRepo),
    private messagingProvider: LineMessagingProvider = new MockLineMessagingProvider()
  ) {}

  public getNotificationRepository(): InMemoryNotificationRepository {
    return this.notificationRepo;
  }

  // --- In-App Notifications ---
  public async createInAppNotification(data: Omit<InAppNotificationEntity, 'id' | 'isRead' | 'readAt' | 'createdAt'>): Promise<InAppNotificationEntity> {
    return this.notificationRepo.create(data);
  }

  public async getStaffNotifications(dormitoryId: string, userId?: string, roleCode?: string): Promise<InAppNotificationEntity[]> {
    return this.notificationRepo.listForStaff(dormitoryId, userId, roleCode);
  }

  public async getTenantNotifications(dormitoryId: string, tenantId: string): Promise<InAppNotificationEntity[]> {
    return this.notificationRepo.listForTenant(dormitoryId, tenantId);
  }

  public async markAsRead(dormitoryId: string, notificationId: string): Promise<InAppNotificationEntity | null> {
    return this.notificationRepo.markAsRead(dormitoryId, notificationId);
  }

  public async markAllStaffAsRead(dormitoryId: string, userId?: string): Promise<number> {
    return this.notificationRepo.markAllAsReadForStaff(dormitoryId, userId);
  }

  public async markAllTenantAsRead(dormitoryId: string, tenantId: string): Promise<number> {
    return this.notificationRepo.markAllAsReadForTenant(dormitoryId, tenantId);
  }

  public async getStaffUnreadCount(dormitoryId: string, userId?: string): Promise<number> {
    return this.notificationRepo.getUnreadCountForStaff(dormitoryId, userId);
  }

  public async getTenantUnreadCount(dormitoryId: string, tenantId: string): Promise<number> {
    return this.notificationRepo.getUnreadCountForTenant(dormitoryId, tenantId);
  }

  // --- Notification Preferences (Owner Controlled) ---
  public async getPreferences(dormitoryId: string) {
    let pref = await this.lineRepo.getNotificationPreferences(dormitoryId);
    if (!pref) {
      pref = await this.lineRepo.upsertNotificationPreferences({
        dormitoryId,
        notifyRoleAssignment: true,
        notifyTenantApproval: true,
        notifyBillCreated: true,
        notifyPaymentApproved: true,
        notifyPaymentRejected: true,
        notifyMaintenanceUpdate: true,
        notifyAnnouncement: true
      });
    }
    return pref;
  }

  public async updatePreferences(dormitoryId: string, actorRoleCode: string, input: NotificationPreferenceInput) {
    if (actorRoleCode !== 'OWNER') {
      throw new Error('FORBIDDEN: Only OWNER can update notification preferences');
    }

    return this.lineRepo.upsertNotificationPreferences({
      dormitoryId,
      ...input
    });
  }

  // --- Quota Warning ---
  public async checkAndTriggerQuotaLowWarning(dormitoryId: string) {
    const status = await this.quotaService.getQuotaStatus(dormitoryId);
    if (status.remaining <= 50) {
      let bodyText = `ขณะนี้โควตาข้อความ LINE คงเหลือ ${status.remaining} ข้อความ`;
      if (status.remaining === 0) {
        bodyText = `โควตาข้อความ LINE ประจำเดือนนี้หมดแล้ว (${status.used}/${status.limit} ข้อความ)`;
      }

      await this.createInAppNotification({
        dormitoryId,
        targetType: 'staff',
        targetRoleCode: 'OWNER',
        category: 'QUOTA_WARNING',
        title: 'เตือนโควตาข้อความ LINE',
        body: bodyText,
        metadata: { remaining: status.remaining, limit: status.limit, used: status.used }
      });
    }
  }

  // --- Central Line Notification Decision & Delivery Engine ---
  public async evaluateAndSendLineNotification(input: EvaluateLineNotificationInput): Promise<LineNotificationDecision> {
    const { dormitoryId, category, actionSendLineCheckbox, actorRoleCode, recipientLineIdentityId, templateParams, idempotencyKey } = input;

    // 1. If action-level checkbox explicitly false (or undefined for actions requiring it), do NOT send LINE
    if (actionSendLineCheckbox === false) {
      return { shouldSendLine: false, reason: 'Action checkbox sendLineNotification is disabled', quotaUsed: 0 };
    }

    // TECH cannot send LINE notifications on status update
    if (actorRoleCode === 'TECH' && category === 'MAINTENANCE_STATUS_UPDATED') {
      return { shouldSendLine: false, reason: 'TECH role is not permitted to trigger LINE notifications', quotaUsed: 0 };
    }

    // 2. Check Owner System Preferences
    const prefs = await this.getPreferences(dormitoryId);
    const prefEnabled = this.isCategoryEnabledInPreferences(category, prefs);
    if (!prefEnabled) {
      return { shouldSendLine: false, reason: 'Category is disabled in owner notification preferences', quotaUsed: 0 };
    }

    // 3. Check Active LINE Integration
    const integration = await this.lineRepo.getIntegrationByDormitory(dormitoryId);
    if (!integration || integration.status !== 'connected') {
      return { shouldSendLine: false, reason: 'LINE OA Integration is disconnected or not set up', quotaUsed: 0 };
    }

    // 4. Check Recipient LINE Identity & Friend Status
    if (!recipientLineIdentityId) {
      return { shouldSendLine: false, reason: 'Recipient has no linked LINE identity', quotaUsed: 0 };
    }

    const follower = await this.lineRepo.getFollowerByIdentity(dormitoryId, recipientLineIdentityId);
    if (!follower || follower.friendStatus !== 'following') {
      return { shouldSendLine: false, reason: 'Recipient is not an active follower of the LINE OA', quotaUsed: 0 };
    }

    // 5. Check Quota Remaining
    const quotaStatus = await this.quotaService.getQuotaStatus(dormitoryId);
    if (quotaStatus.remaining < 1) {
      await this.checkAndTriggerQuotaLowWarning(dormitoryId);
      return { shouldSendLine: false, reason: 'LINE_MESSAGE_QUOTA_INSUFFICIENT', quotaUsed: 0 };
    }

    // 6. Template Text Generation
    const textMessage = this.generateTextMessage(category, templateParams);

    // 7. Send Message via Provider & Deduct Quota
    try {
      const sendResult = await this.messagingProvider.pushMessage({
        channelSecretEncrypted: integration.channelSecretEncrypted,
        toLineUserId: follower.identity.lineUserId,
        messages: [{ type: 'text', text: textMessage }]
      });

      if (sendResult.success) {
        // Record quota usage
        await this.quotaService.consumeQuota(dormitoryId, recipientLineIdentityId, category, sendResult.messageId || `msg_${Date.now()}`);
        await this.checkAndTriggerQuotaLowWarning(dormitoryId);

        return { shouldSendLine: true, reason: 'Successfully sent LINE notification', quotaUsed: 1 };
      } else {
        return { shouldSendLine: false, reason: `LINE provider delivery failed: ${sendResult.errorMessage}`, quotaUsed: 0 };
      }
    } catch (err: any) {
      return { shouldSendLine: false, reason: `LINE delivery error: ${err.message}`, quotaUsed: 0 };
    }
  }

  private isCategoryEnabledInPreferences(category: EventNotificationCategory, prefs: any): boolean {
    switch (category) {
      case 'ROLE_ASSIGNED': return prefs.notifyRoleAssignment ?? true;
      case 'TENANT_APPROVED': return prefs.notifyTenantApproval ?? true;
      case 'BILL_CREATED': return prefs.notifyBillCreated ?? true;
      case 'PAYMENT_APPROVED': return prefs.notifyPaymentApproved ?? true;
      case 'PAYMENT_REJECTED': return prefs.notifyPaymentRejected ?? true;
      case 'MAINTENANCE_ASSIGNED':
      case 'MAINTENANCE_STATUS_UPDATED': return prefs.notifyMaintenanceUpdate ?? true;
      case 'ANNOUNCEMENT_PUBLISHED': return prefs.notifyAnnouncement ?? true;
      default: return true;
    }
  }

  public generateTextMessage(category: EventNotificationCategory, params: Record<string, string>): string {
    switch (category) {
      case 'ROLE_ASSIGNED':
        return `ยินดีด้วย! คุณได้รับสิทธิ์ใช้งานบทบาท ${params.roleName || params.roleCode || 'เจ้าหน้าที่'} ประจำหอพัก ${params.dormitoryName || ''}`;
      case 'TENANT_APPROVED':
        return `คำขอลงทะเบียนผู้เช่าห้อง ${params.roomNumber || ''} ได้รับการอนุมัติเรียบร้อยแล้ว`;
      case 'BILL_CREATED':
        return `ใบแจ้งหนี้ประจำเดือน ${params.cycleName || ''} ห้อง ${params.roomNumber || ''} ยอดรวม ${params.amount || ''} บาท ออกเรียบร้อยแล้ว`;
      case 'PAYMENT_APPROVED':
        return `การชำระเงินสำหรับใบแจ้งหนี้ห้อง ${params.roomNumber || ''} ยอด ${params.amount || ''} บาท ได้รับการยืนยันแล้ว`;
      case 'PAYMENT_REJECTED':
        return `การชำระเงินสำหรับใบแจ้งหนี้ห้อง ${params.roomNumber || ''} ไม่ผ่านการอนุมัติ สาเหตุ: ${params.reason || 'กรุณาติดต่อเจ้าหน้าที่'}`;
      case 'MAINTENANCE_ASSIGNED':
        return `ได้รับมอบหมายงานแจ้งซ่อม #${params.requestNumber || ''} [${params.title || ''}] ห้อง ${params.roomNumber || ''}`;
      case 'MAINTENANCE_STATUS_UPDATED':
        if (params.status === 'assigned') {
          return `รับเรื่องแจ้งซ่อมแล้ว ขณะนี้เจ้าหน้าที่กำลังเตรียมดำเนินการ [ เปิดดูสถานะ ]`;
        } else if (params.status === 'in_progress') {
          return `กำลังดำเนินการแจ้งซ่อม [ เปิดดูสถานะ ]`;
        } else if (params.status === 'waiting_parts') {
          return `งานแจ้งซ่อมกำลังรออุปกรณ์หรืออะไหล่ [ เปิดดูสถานะ ]`;
        } else if (params.status === 'resolved') {
          return `ดำเนินการแจ้งซ่อมเรียบร้อยแล้ว กรุณาตรวจสอบผลการดำเนินงาน [ เปิดดูงาน ]`;
        } else if (params.status === 'closed') {
          return `งานแจ้งซ่อมถูกปิดเรียบร้อยแล้ว [ เปิดดูประวัติ ]`;
        }
        return `อัปเดตสถานะการแจ้งซ่อม #${params.requestNumber || ''}: ${params.statusLabel || params.status}`;
      case 'ANNOUNCEMENT_PUBLISHED':
        return `📢 ประกาศใหม่จากหอพัก: ${params.title || ''}\n${params.summary || params.content || ''}`;
      default:
        return `แจ้งเตือนจากระบบหอพัก ${params.dormitoryName || ''}`;
    }
  }
}
