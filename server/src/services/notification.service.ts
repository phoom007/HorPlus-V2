import { PrismaNotificationRepository, InAppNotificationEntity } from '../db/repositories/prisma-notification.repository.js';
import { InMemoryNotificationRepository } from '../db/repositories/notification.repository.js';

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

export class NotificationService {
  private repo: PrismaNotificationRepository | InMemoryNotificationRepository;

  constructor(
    repository?: PrismaNotificationRepository | InMemoryNotificationRepository
  ) {
    this.repo = repository || new PrismaNotificationRepository();
  }

  public getNotificationRepository() {
    return this.repo;
  }

  // --- In-App Notifications ---
  public async createInAppNotification(data: {
    dormitoryId: string;
    targetType: 'staff' | 'tenant';
    targetUserId?: string | null;
    targetTenantId?: string | null;
    targetRoleCode?: string | null;
    category: string;
    title: string;
    body: string;
    metadata?: Record<string, any> | null;
  }) {
    if (this.repo instanceof PrismaNotificationRepository) {
      if (data.targetType === 'tenant' && data.targetTenantId) {
        return this.repo.createTenantNotice({
          dormitoryId: data.dormitoryId,
          tenantId: data.targetTenantId,
          userId: data.targetUserId || null,
          title: data.title,
          message: data.body,
          type: data.category,
        });
      } else if (data.targetType === 'staff' && data.targetUserId) {
        return this.repo.createStaffNotice({
          dormitoryId: data.dormitoryId,
          userId: data.targetUserId,
          roleCode: data.targetRoleCode || null,
          category: data.category,
          title: data.title,
          message: data.body,
          metadata: data.metadata,
        });
      }
    }
    if (this.repo instanceof InMemoryNotificationRepository) {
      return (this.repo as InMemoryNotificationRepository).create(data as any);
    }
    return null;
  }

  public async getStaffNotifications(dormitoryId: string, userId?: string, roleCode?: string): Promise<InAppNotificationEntity[]> {
    return this.repo.listForStaff(dormitoryId, userId, roleCode);
  }

  public async getTenantNotifications(dormitoryId: string, tenantId: string): Promise<InAppNotificationEntity[]> {
    return this.repo.listForTenant(dormitoryId, tenantId);
  }

  public async markAsRead(dormitoryId: string, notificationId: string, userId?: string, tenantId?: string): Promise<InAppNotificationEntity | null> {
    if (this.repo instanceof PrismaNotificationRepository) {
      return this.repo.markAsRead(dormitoryId, notificationId, userId, tenantId);
    }
    return (this.repo as InMemoryNotificationRepository).markAsRead(dormitoryId, notificationId);
  }

  public async markAllStaffAsRead(dormitoryId: string, userId?: string): Promise<number> {
    return this.repo.markAllAsReadForStaff(dormitoryId, userId);
  }

  public async markAllTenantAsRead(dormitoryId: string, tenantId: string): Promise<number> {
    return this.repo.markAllAsReadForTenant(dormitoryId, tenantId);
  }

  public async getStaffUnreadCount(dormitoryId: string, userId?: string): Promise<number> {
    return this.repo.getUnreadCountForStaff(dormitoryId, userId);
  }

  public async getTenantUnreadCount(dormitoryId: string, tenantId: string): Promise<number> {
    return this.repo.getUnreadCountForTenant(dormitoryId, tenantId);
  }

  // --- Notification Preferences (Owner Controlled, Static Release-1) ---
  public async getPreferences(dormitoryId: string) {
    return {
      notifyRoleAssignment: true,
      notifyTenantApproval: true,
      notifyBillCreated: true,
      notifyPaymentApproved: true,
      notifyPaymentRejected: true,
      notifyMaintenanceUpdate: true,
      notifyAnnouncement: true
    };
  }

  public async updatePreferences(dormitoryId: string, actorRoleCode: string, input: NotificationPreferenceInput) {
    if (actorRoleCode !== 'OWNER') {
      throw new Error('FORBIDDEN: Only OWNER can update notification preferences');
    }
    // Preferences update disabled for Release 1 without LINE
    return input;
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

export const notificationService = new NotificationService();
