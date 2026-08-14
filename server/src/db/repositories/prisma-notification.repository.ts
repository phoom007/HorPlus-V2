import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from '../prisma.js';

export interface InAppNotificationEntity {
  id: string;
  dormitoryId: string;
  targetType: 'staff' | 'tenant';
  targetUserId?: string | null;
  targetTenantId?: string | null;
  targetRoleCode?: string | null;
  category: string;
  title: string;
  body: string;
  metadata?: Record<string, any> | null;
  isRead: boolean;
  readAt?: Date | null;
  isDismissed?: boolean;
  dismissedAt?: Date | null;
  createdAt: Date;
}

const isUuid = (val: unknown): val is string => {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
};

export class PrismaNotificationRepository {
  constructor(private client: PrismaClient = getPrismaClient()) {}

  public async createStaffNotice(data: {
    dormitoryId: string;
    userId: string;
    roleCode?: string | null;
    category: string;
    title: string;
    message: string;
    metadata?: any;
    sourceOutboxId?: string | null;
  }) {
    return this.client.staffNotification.create({
      data: {
        dormitoryId: data.dormitoryId,
        userId: data.userId,
        roleCode: data.roleCode || null,
        category: data.category,
        title: data.title,
        message: data.message,
        metadata: data.metadata || null,
        sourceOutboxId: data.sourceOutboxId || null,
      },
    });
  }

  public async createTenantNotice(data: {
    dormitoryId: string;
    tenantId: string;
    userId?: string | null;
    title: string;
    message: string;
    type?: string;
    sourceOutboxId?: string | null;
  }) {
    return this.client.tenantNotice.create({
      data: {
        dormitoryId: data.dormitoryId,
        tenantId: data.tenantId,
        userId: data.userId || null,
        title: data.title,
        message: data.message,
        type: data.type || 'GENERAL',
        sourceOutboxId: data.sourceOutboxId || null,
      },
    });
  }

  public async listForStaff(dormitoryId: string, userId?: string, roleCode?: string): Promise<InAppNotificationEntity[]> {
    if (!isUuid(dormitoryId) || !isUuid(userId)) return [];

    const rows = await this.client.staffNotification.findMany({
      where: {
        dormitoryId,
        userId,
        isDismissed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      dormitoryId: r.dormitoryId,
      targetType: 'staff',
      targetUserId: r.userId,
      targetTenantId: null,
      targetRoleCode: r.roleCode,
      category: r.category,
      title: r.title,
      body: r.message,
      metadata: r.metadata as any,
      isRead: r.isRead,
      readAt: r.readAt,
      isDismissed: r.isDismissed,
      dismissedAt: r.dismissedAt,
      createdAt: r.createdAt,
    }));
  }

  public async listForTenant(dormitoryId: string, tenantId: string): Promise<InAppNotificationEntity[]> {
    if (!isUuid(dormitoryId) || !isUuid(tenantId)) return [];

    const rows = await this.client.tenantNotice.findMany({
      where: {
        dormitoryId,
        tenantId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      dormitoryId: r.dormitoryId,
      targetType: 'tenant',
      targetUserId: r.userId,
      targetTenantId: r.tenantId,
      targetRoleCode: null,
      category: r.type,
      title: r.title,
      body: r.message,
      metadata: null,
      isRead: r.isRead,
      readAt: r.readAt,
      createdAt: r.createdAt,
    }));
  }

  public async markAsRead(dormitoryId: string, id: string, userId?: string, tenantId?: string): Promise<InAppNotificationEntity | null> {
    if (!isUuid(dormitoryId) || !isUuid(id)) return null;
    const now = new Date();

    // Check staff_notices first if userId is provided
    if (isUuid(userId)) {
      const staffNotice = await this.client.staffNotification.findFirst({
        where: { id, dormitoryId, userId },
      });
      if (staffNotice) {
        const updated = await this.client.staffNotification.update({
          where: { id },
          data: { isRead: true, readAt: now },
        });
        return {
          id: updated.id,
          dormitoryId: updated.dormitoryId,
          targetType: 'staff',
          targetUserId: updated.userId,
          targetTenantId: null,
          targetRoleCode: updated.roleCode,
          category: updated.category,
          title: updated.title,
          body: updated.message,
          metadata: updated.metadata as any,
          isRead: updated.isRead,
          readAt: updated.readAt,
          isDismissed: updated.isDismissed,
          dismissedAt: updated.dismissedAt,
          createdAt: updated.createdAt,
        };
      }
    }

    // Check tenant_notices if tenantId is provided or generic match
    if (isUuid(tenantId)) {
      const tenantNotice = await this.client.tenantNotice.findFirst({
        where: { id, dormitoryId, tenantId },
      });
      if (tenantNotice) {
        const updated = await this.client.tenantNotice.update({
          where: { id },
          data: { isRead: true, readAt: now },
        });
        return {
          id: updated.id,
          dormitoryId: updated.dormitoryId,
          targetType: 'tenant',
          targetUserId: updated.userId,
          targetTenantId: updated.tenantId,
          targetRoleCode: null,
          category: updated.type,
          title: updated.title,
          body: updated.message,
          metadata: null,
          isRead: updated.isRead,
          readAt: updated.readAt,
          createdAt: updated.createdAt,
        };
      }
    }

    // Fallback search by dormitoryId + userId/tenantId
    const staffNoticeFallback = await this.client.staffNotification.findFirst({
      where: { id, dormitoryId, ...(isUuid(userId) ? { userId } : {}) },
    });
    if (staffNoticeFallback) {
      const updated = await this.client.staffNotification.update({
        where: { id: staffNoticeFallback.id },
        data: { isRead: true, readAt: now },
      });
      return {
        id: updated.id,
        dormitoryId: updated.dormitoryId,
        targetType: 'staff',
        targetUserId: updated.userId,
        targetTenantId: null,
        targetRoleCode: updated.roleCode,
        category: updated.category,
        title: updated.title,
        body: updated.message,
        metadata: updated.metadata as any,
        isRead: updated.isRead,
        readAt: updated.readAt,
        isDismissed: updated.isDismissed,
        dismissedAt: updated.dismissedAt,
        createdAt: updated.createdAt,
      };
    }

    const tenantNoticeFallback = await this.client.tenantNotice.findFirst({
      where: { id, dormitoryId, ...(isUuid(tenantId) ? { tenantId } : {}) },
    });
    if (tenantNoticeFallback) {
      const updated = await this.client.tenantNotice.update({
        where: { id: tenantNoticeFallback.id },
        data: { isRead: true, readAt: now },
      });
      return {
        id: updated.id,
        dormitoryId: updated.dormitoryId,
        targetType: 'tenant',
        targetUserId: updated.userId,
        targetTenantId: updated.tenantId,
        targetRoleCode: null,
        category: updated.type,
        title: updated.title,
        body: updated.message,
        metadata: null,
        isRead: updated.isRead,
        readAt: updated.readAt,
        createdAt: updated.createdAt,
      };
    }

    return null;
  }

  public async dismissStaffNotice(dormitoryId: string, id: string, userId: string): Promise<boolean> {
    if (!isUuid(dormitoryId) || !isUuid(id) || !isUuid(userId)) return false;
    const notice = await this.client.staffNotification.findFirst({
      where: { id, dormitoryId, userId },
    });
    if (!notice) return false;

    await this.client.staffNotification.update({
      where: { id: notice.id },
      data: { isDismissed: true, dismissedAt: new Date() },
    });
    return true;
  }

  public async markAllAsReadForStaff(dormitoryId: string, userId?: string): Promise<number> {
    if (!isUuid(dormitoryId) || !isUuid(userId)) return 0;
    const now = new Date();
    const result = await this.client.staffNotification.updateMany({
      where: { dormitoryId, userId, isRead: false, isDismissed: false },
      data: { isRead: true, readAt: now },
    });
    return result.count;
  }

  public async markAllAsReadForTenant(dormitoryId: string, tenantId: string): Promise<number> {
    if (!isUuid(dormitoryId) || !isUuid(tenantId)) return 0;
    const now = new Date();
    const result = await this.client.tenantNotice.updateMany({
      where: { dormitoryId, tenantId, isRead: false },
      data: { isRead: true, readAt: now },
    });
    return result.count;
  }

  public async getUnreadCountForStaff(dormitoryId: string, userId?: string): Promise<number> {
    if (!isUuid(dormitoryId) || !isUuid(userId)) return 0;
    return this.client.staffNotification.count({
      where: { dormitoryId, userId, isRead: false, isDismissed: false },
    });
  }

  public async getUnreadCountForTenant(dormitoryId: string, tenantId: string): Promise<number> {
    if (!isUuid(dormitoryId) || !isUuid(tenantId)) return 0;
    return this.client.tenantNotice.count({
      where: { dormitoryId, tenantId, isRead: false },
    });
  }
}
