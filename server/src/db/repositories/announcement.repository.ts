import { v4 as uuidv4 } from 'uuid';

export type AnnouncementStatus = 'draft' | 'scheduled' | 'published' | 'archived' | 'cancelled';
export type AnnouncementPriority = 'normal' | 'important' | 'urgent';
export type AnnouncementTargetType = 'all_tenants' | 'building' | 'floor' | 'room' | 'tenant';
export type AnnouncementDeliveryStatus = 'in_app_only' | 'line_queued' | 'line_sent' | 'line_failed' | 'line_skipped';

export interface AnnouncementEntity {
  id: string;
  dormitoryId: string;
  title: string;
  summary?: string | null;
  content: string;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  isPinned: boolean;
  publishedAt?: Date | null;
  scheduledAt?: Date | null;
  expiresAt?: Date | null;
  archivedAt?: Date | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface AnnouncementAudienceEntity {
  id: string;
  dormitoryId: string;
  announcementId: string;
  targetType: AnnouncementTargetType;
  buildingId?: string | null;
  floor?: string | null;
  roomId?: string | null;
  tenantId?: string | null;
  createdAt: Date;
}

export interface AnnouncementRecipientEntity {
  id: string;
  dormitoryId: string;
  announcementId: string;
  tenantId: string;
  deliveryStatus: AnnouncementDeliveryStatus;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AnnouncementReadReceiptEntity {
  id: string;
  dormitoryId: string;
  announcementId: string;
  tenantId: string;
  readAt: Date;
}

export interface AnnouncementFilterQuery {
  status?: AnnouncementStatus;
  priority?: AnnouncementPriority;
  search?: string;
  page?: number;
  pageSize?: number;
}

export class InMemoryAnnouncementRepository {
  private announcements: AnnouncementEntity[] = [];
  private audiences: AnnouncementAudienceEntity[] = [];
  private recipients: AnnouncementRecipientEntity[] = [];
  private readReceipts: AnnouncementReadReceiptEntity[] = [];

  public async createAnnouncement(data: Omit<AnnouncementEntity, 'id' | 'status' | 'isPinned' | 'version' | 'createdAt' | 'updatedAt'> & { status?: AnnouncementStatus; isPinned?: boolean }): Promise<AnnouncementEntity> {
    const now = new Date();
    const announcement: AnnouncementEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      title: data.title,
      summary: data.summary || null,
      content: data.content,
      status: data.status || 'draft',
      priority: data.priority || 'normal',
      isPinned: data.isPinned || false,
      scheduledAt: data.scheduledAt || null,
      publishedAt: data.publishedAt || null,
      expiresAt: data.expiresAt || null,
      archivedAt: data.archivedAt || null,
      createdByUserId: data.createdByUserId || null,
      updatedByUserId: data.updatedByUserId || null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.announcements.push(announcement);
    return announcement;
  }

  public async findById(dormitoryId: string, id: string): Promise<AnnouncementEntity | null> {
    return this.announcements.find(a => a.dormitoryId === dormitoryId && a.id === id && !a.deletedAt) || null;
  }

  public async findAll(dormitoryId: string, filters: AnnouncementFilterQuery = {}): Promise<{ items: AnnouncementEntity[]; total: number }> {
    let result = this.announcements.filter(a => a.dormitoryId === dormitoryId && !a.deletedAt);

    if (filters.status) {
      result = result.filter(a => a.status === filters.status);
    }
    if (filters.priority) {
      result = result.filter(a => a.priority === filters.priority);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(a => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q) || (a.summary && a.summary.toLowerCase().includes(q)));
    }

    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = result.length;
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const startIndex = (page - 1) * pageSize;
    const paginated = result.slice(startIndex, startIndex + pageSize);

    return { items: paginated, total };
  }

  public async updateAnnouncement(dormitoryId: string, id: string, updates: Partial<AnnouncementEntity>): Promise<AnnouncementEntity | null> {
    const index = this.announcements.findIndex(a => a.dormitoryId === dormitoryId && a.id === id);
    if (index === -1) return null;

    const existing = this.announcements[index];
    const updated: AnnouncementEntity = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date()
    };

    this.announcements[index] = updated;
    return updated;
  }

  public async deleteAnnouncement(dormitoryId: string, id: string): Promise<boolean> {
    const index = this.announcements.findIndex(a => a.dormitoryId === dormitoryId && a.id === id);
    if (index === -1) return false;
    this.announcements[index].deletedAt = new Date();
    return true;
  }

  public async setAudiences(dormitoryId: string, announcementId: string, audiencesData: Omit<AnnouncementAudienceEntity, 'id' | 'createdAt'>[]): Promise<AnnouncementAudienceEntity[]> {
    this.audiences = this.audiences.filter(a => !(a.dormitoryId === dormitoryId && a.announcementId === announcementId));

    const created: AnnouncementAudienceEntity[] = [];
    const now = new Date();

    for (const aud of audiencesData) {
      const entry: AnnouncementAudienceEntity = {
        id: uuidv4(),
        dormitoryId,
        announcementId,
        targetType: aud.targetType,
        buildingId: aud.buildingId || null,
        floor: aud.floor || null,
        roomId: aud.roomId || null,
        tenantId: aud.tenantId || null,
        createdAt: now
      };
      this.audiences.push(entry);
      created.push(entry);
    }

    return created;
  }

  public async getAudiences(dormitoryId: string, announcementId: string): Promise<AnnouncementAudienceEntity[]> {
    return this.audiences.filter(a => a.dormitoryId === dormitoryId && a.announcementId === announcementId);
  }

  public async setRecipients(dormitoryId: string, announcementId: string, recipientsData: Omit<AnnouncementRecipientEntity, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<AnnouncementRecipientEntity[]> {
    this.recipients = this.recipients.filter(r => !(r.dormitoryId === dormitoryId && r.announcementId === announcementId));

    const created: AnnouncementRecipientEntity[] = [];
    const now = new Date();

    for (const rec of recipientsData) {
      const entry: AnnouncementRecipientEntity = {
        id: uuidv4(),
        dormitoryId,
        announcementId,
        tenantId: rec.tenantId,
        deliveryStatus: rec.deliveryStatus,
        readAt: rec.readAt || null,
        createdAt: now,
        updatedAt: now
      };
      this.recipients.push(entry);
      created.push(entry);
    }

    return created;
  }

  public async getRecipients(dormitoryId: string, announcementId: string): Promise<AnnouncementRecipientEntity[]> {
    return this.recipients.filter(r => r.dormitoryId === dormitoryId && r.announcementId === announcementId);
  }

  public async getRecipientForTenant(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementRecipientEntity | null> {
    return this.recipients.find(r => r.dormitoryId === dormitoryId && r.announcementId === announcementId && r.tenantId === tenantId) || null;
  }

  public async recordReadReceipt(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementReadReceiptEntity> {
    const existing = this.readReceipts.find(r => r.dormitoryId === dormitoryId && r.announcementId === announcementId && r.tenantId === tenantId);
    if (existing) return existing;

    const now = new Date();
    const receipt: AnnouncementReadReceiptEntity = {
      id: uuidv4(),
      dormitoryId,
      announcementId,
      tenantId,
      readAt: now
    };

    this.readReceipts.push(receipt);

    // Update recipient readAt if exists
    const rec = this.recipients.find(r => r.dormitoryId === dormitoryId && r.announcementId === announcementId && r.tenantId === tenantId);
    if (rec) {
      rec.readAt = now;
      rec.updatedAt = now;
    }

    return receipt;
  }

  public async getReadReceipts(dormitoryId: string, announcementId: string): Promise<AnnouncementReadReceiptEntity[]> {
    return this.readReceipts.filter(r => r.dormitoryId === dormitoryId && r.announcementId === announcementId);
  }

  public async findScheduledForDispatch(now: Date = new Date()): Promise<AnnouncementEntity[]> {
    return this.announcements.filter(a => a.status === 'scheduled' && a.scheduledAt && a.scheduledAt <= now && !a.deletedAt);
  }

  public async findPublishedForTenant(dormitoryId: string, tenantId: string, eligibleAnnouncementIds: string[]): Promise<AnnouncementEntity[]> {
    const set = new Set(eligibleAnnouncementIds);
    return this.announcements.filter(a => a.dormitoryId === dormitoryId && a.status === 'published' && set.has(a.id) && !a.deletedAt)
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        return (b.publishedAt || b.createdAt).getTime() - (a.publishedAt || a.createdAt).getTime();
      });
  }
}
