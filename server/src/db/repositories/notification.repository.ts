import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

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
  createdAt: Date;
}

export class InMemoryNotificationRepository {
  private notifications: InAppNotificationEntity[] = [];

  public async create(data: Omit<InAppNotificationEntity, 'id' | 'isRead' | 'readAt' | 'createdAt'>): Promise<InAppNotificationEntity> {
    const notification: InAppNotificationEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      targetType: data.targetType,
      targetUserId: data.targetUserId || null,
      targetTenantId: data.targetTenantId || null,
      targetRoleCode: data.targetRoleCode || null,
      category: data.category,
      title: data.title,
      body: data.body,
      metadata: data.metadata || null,
      isRead: false,
      readAt: null,
      createdAt: new Date()
    };
    this.notifications.push(notification);
    return notification;
  }

  public async listForStaff(dormitoryId: string, userId?: string, roleCode?: string): Promise<InAppNotificationEntity[]> {
    return this.notifications.filter(n =>
      n.dormitoryId === dormitoryId &&
      n.targetType === 'staff' &&
      ((!n.targetUserId || n.targetUserId === userId) || (!n.targetRoleCode || n.targetRoleCode === roleCode))
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async listForTenant(dormitoryId: string, tenantId: string): Promise<InAppNotificationEntity[]> {
    return this.notifications.filter(n =>
      n.dormitoryId === dormitoryId &&
      n.targetType === 'tenant' &&
      n.targetTenantId === tenantId
    ).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async markAsRead(dormitoryId: string, id: string): Promise<InAppNotificationEntity | null> {
    const notif = this.notifications.find(n => n.dormitoryId === dormitoryId && n.id === id);
    if (!notif) return null;
    notif.isRead = true;
    notif.readAt = new Date();
    return notif;
  }

  public async markAllAsReadForStaff(dormitoryId: string, userId?: string): Promise<number> {
    let count = 0;
    for (const notif of this.notifications) {
      if (notif.dormitoryId === dormitoryId && notif.targetType === 'staff' && (!notif.targetUserId || notif.targetUserId === userId) && !notif.isRead) {
        notif.isRead = true;
        notif.readAt = new Date();
        count++;
      }
    }
    return count;
  }

  public async markAllAsReadForTenant(dormitoryId: string, tenantId: string): Promise<number> {
    let count = 0;
    for (const notif of this.notifications) {
      if (notif.dormitoryId === dormitoryId && notif.targetType === 'tenant' && notif.targetTenantId === tenantId && !notif.isRead) {
        notif.isRead = true;
        notif.readAt = new Date();
        count++;
      }
    }
    return count;
  }

  public async getUnreadCountForStaff(dormitoryId: string, userId?: string): Promise<number> {
    return this.notifications.filter(n =>
      n.dormitoryId === dormitoryId &&
      n.targetType === 'staff' &&
      (!n.targetUserId || n.targetUserId === userId) &&
      !n.isRead
    ).length;
  }

  public async getUnreadCountForTenant(dormitoryId: string, tenantId: string): Promise<number> {
    return this.notifications.filter(n =>
      n.dormitoryId === dormitoryId &&
      n.targetType === 'tenant' &&
      n.targetTenantId === tenantId &&
      !n.isRead
    ).length;
  }
}
