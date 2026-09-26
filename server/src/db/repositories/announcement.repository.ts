import { v4 as uuidv4 } from 'uuid';
import { getPrismaClient } from '../prisma.js';

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
  type?: string | null;
  targetType?: string | null;
  targetBuildingId?: string | null;
  customTarget?: string | null;
  targetRooms?: string | null;
  attachmentUrl?: string | null;
  linkUrl?: string | null;
  author?: string | null;
  status: AnnouncementStatus;
  priority: AnnouncementPriority;
  isPinned: boolean;
  publishDate?: Date | string | null;
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

export interface IAnnouncementRepository {
  createAnnouncement(data: any): Promise<AnnouncementEntity>;
  findById(dormitoryId: string, id: string): Promise<AnnouncementEntity | null>;
  findAll(dormitoryId: string, filters?: AnnouncementFilterQuery): Promise<{ items: AnnouncementEntity[]; total: number }>;
  updateAnnouncement(dormitoryId: string, id: string, updates: Partial<AnnouncementEntity>): Promise<AnnouncementEntity | null>;
  deleteAnnouncement(dormitoryId: string, id: string): Promise<boolean>;
  setAudiences(dormitoryId: string, announcementId: string, audiences: any[]): Promise<AnnouncementAudienceEntity[]>;
  getAudiences(dormitoryId: string, announcementId: string): Promise<AnnouncementAudienceEntity[]>;
  setRecipients(dormitoryId: string, announcementId: string, recipients: any[]): Promise<AnnouncementRecipientEntity[]>;
  getRecipients(dormitoryId: string, announcementId: string): Promise<AnnouncementRecipientEntity[]>;
  getRecipientForTenant(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementRecipientEntity | null>;
  recordReadReceipt(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementReadReceiptEntity>;
  getReadReceipts(dormitoryId: string, announcementId: string): Promise<AnnouncementReadReceiptEntity[]>;
  findScheduledForDispatch(now?: Date): Promise<AnnouncementEntity[]>;
  findPublishedForTenant(dormitoryId: string, tenantId: string, eligibleAnnouncementIds: string[]): Promise<AnnouncementEntity[]>;
}

function mapPrismaToAnnouncementEntity(row: any): AnnouncementEntity {
  return {
    id: row.id,
    dormitoryId: row.dormitoryId,
    title: row.title,
    summary: row.summary,
    content: row.content,
    type: row.type || 'general',
    targetType: row.targetType || 'all',
    targetBuildingId: row.targetBuildingId,
    customTarget: row.customTarget,
    targetRooms: row.targetRooms,
    attachmentUrl: row.attachmentUrl,
    linkUrl: row.linkUrl,
    author: row.author,
    status: row.status as AnnouncementStatus,
    priority: (row.priority || 'normal') as AnnouncementPriority,
    isPinned: Boolean(row.isPinned),
    publishDate: row.publishDate ? (typeof row.publishDate === 'string' ? row.publishDate.split('T')[0] : row.publishDate.toISOString().split('T')[0]) : (row.createdAt ? (typeof row.createdAt === 'string' ? row.createdAt.split('T')[0] : row.createdAt.toISOString().split('T')[0]) : new Date().toISOString().split('T')[0]),
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    createdByUserId: row.createdByUserId,
    version: row.version,
    createdAt: row.createdAt ? (typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()) : new Date().toISOString(),
    updatedAt: row.updatedAt ? (typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString()) : new Date().toISOString(),
    deletedAt: row.deletedAt
  };
}

export class PrismaAnnouncementRepository implements IAnnouncementRepository {
  private fallbackMemory = new InMemoryAnnouncementRepository();

  private get prisma() {
    return getPrismaClient();
  }

  public async createAnnouncement(data: Omit<AnnouncementEntity, 'id' | 'version' | 'createdAt' | 'updatedAt'> & { id?: string; status?: AnnouncementStatus; isPinned?: boolean }): Promise<AnnouncementEntity> {
    const now = new Date();

    // Finding F-2: Atomic Single-Pin Enforcement
    if (data.isPinned) {
      await this.prisma.announcement.updateMany({
        where: { dormitoryId: data.dormitoryId },
        data: { isPinned: false }
      });
    }

    const cleanActorId = data.createdByUserId ? data.createdByUserId.replace(/^ag_user_|^ag_/, '') : null;
    const isPureUuid = cleanActorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanActorId);
    const validCreatedByUserId = isPureUuid ? cleanActorId : null;

    const created = await this.prisma.announcement.create({
      data: {
        id: data.id || undefined,
        dormitoryId: data.dormitoryId,
        title: data.title,
        summary: data.summary || (data.content.length > 50 ? data.content.substring(0, 50) + '...' : data.content),
        content: data.content,
        type: data.type || 'general',
        targetType: data.targetType || 'all',
        targetBuildingId: data.targetBuildingId || null,
        customTarget: data.customTarget || null,
        targetRooms: data.targetRooms || null,
        attachmentUrl: data.attachmentUrl || null,
        linkUrl: data.linkUrl || null,
        author: data.author || null,
        status: data.status || 'published',
        priority: data.priority || 'normal',
        isPinned: data.isPinned || false,
        publishDate: data.publishDate ? new Date(data.publishDate) : now,
        publishedAt: (data.status === 'published' || !data.status) ? now : null,
        createdByUserId: validCreatedByUserId,
      }
    });

    return mapPrismaToAnnouncementEntity(created);
  }

  public async findById(dormitoryId: string, id: string): Promise<AnnouncementEntity | null> {
    const found = await this.prisma.announcement.findFirst({
      where: {
        id,
        dormitoryId,
        deletedAt: null
      }
    });
    return found ? mapPrismaToAnnouncementEntity(found) : null;
  }

  public async findAll(dormitoryId: string, filters: AnnouncementFilterQuery = {}): Promise<{ items: AnnouncementEntity[]; total: number }> {
    const where: any = {
      dormitoryId,
      deletedAt: null
    };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.priority) {
      where.priority = filters.priority;
    }
    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } }
      ];
    }

    const total = await this.prisma.announcement.count({ where });
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const items = await this.prisma.announcement.findMany({
      where,
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' }
      ],
      skip,
      take: pageSize
    });

    return { items: items.map(mapPrismaToAnnouncementEntity), total };
  }

  public async updateAnnouncement(dormitoryId: string, id: string, updates: Partial<AnnouncementEntity>): Promise<AnnouncementEntity | null> {
    // Finding F-2: Atomic Single-Pin Enforcement on update
    if (updates.isPinned) {
      await this.prisma.announcement.updateMany({
        where: { dormitoryId, id: { not: id } },
        data: { isPinned: false }
      });
    }

    const dataToUpdate: any = {
      updatedAt: new Date()
    };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'id' && key !== 'dormitoryId' && key !== 'updatedByUserId') {
        dataToUpdate[key] = value;
      }
    }

    if (updates.publishDate) {
      dataToUpdate.publishDate = new Date(updates.publishDate);
    }

    const updated = await this.prisma.announcement.update({
      where: { id },
      data: dataToUpdate
    });

    return mapPrismaToAnnouncementEntity(updated);
  }

  public async deleteAnnouncement(dormitoryId: string, id: string): Promise<boolean> {
    try {
      await this.prisma.announcement.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
      return true;
    } catch {
      return false;
    }
  }

  public async setAudiences(dormitoryId: string, announcementId: string, audiencesData: Omit<AnnouncementAudienceEntity, 'id' | 'createdAt'>[]): Promise<AnnouncementAudienceEntity[]> {
    await this.prisma.announcementAudience.deleteMany({
      where: { announcementId, dormitoryId }
    });

    if (audiencesData && audiencesData.length > 0) {
      await this.prisma.announcementAudience.createMany({
        data: audiencesData.map(a => ({
          dormitoryId,
          announcementId,
          targetType: a.targetType,
          buildingId: a.buildingId || null,
          floor: a.floor || null,
          roomId: a.roomId || null,
          tenantId: a.tenantId || null
        }))
      });
    }

    return this.getAudiences(dormitoryId, announcementId);
  }

  public async getAudiences(dormitoryId: string, announcementId: string): Promise<AnnouncementAudienceEntity[]> {
    const list = await this.prisma.announcementAudience.findMany({
      where: { dormitoryId, announcementId }
    });
    return list.map((a: any) => ({
      id: a.id,
      dormitoryId: a.dormitoryId,
      announcementId: a.announcementId,
      targetType: a.targetType as AnnouncementTargetType,
      buildingId: a.buildingId,
      floor: a.floor,
      roomId: a.roomId,
      tenantId: a.tenantId,
      createdAt: a.createdAt
    }));
  }

  public async setRecipients(dormitoryId: string, announcementId: string, recipientsData: any[]): Promise<AnnouncementRecipientEntity[]> {
    return this.fallbackMemory.setRecipients(dormitoryId, announcementId, recipientsData);
  }

  public async getRecipients(dormitoryId: string, announcementId: string): Promise<AnnouncementRecipientEntity[]> {
    return this.fallbackMemory.getRecipients(dormitoryId, announcementId);
  }

  public async getRecipientForTenant(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementRecipientEntity | null> {
    try {
      const noticeKey = `announcement:${announcementId}:${tenantId}`;
      const notice = await this.prisma.tenantNotice.findUnique({
        where: { sourceOutboxId: noticeKey },
      });
      if (notice) {
        return {
          id: notice.id,
          dormitoryId,
          announcementId,
          tenantId,
          deliveryStatus: 'in_app_only',
          readAt: notice.isRead ? (notice.readAt || notice.updatedAt) : null,
          createdAt: notice.createdAt,
          updatedAt: notice.updatedAt,
        };
      }
      return this.fallbackMemory.getRecipientForTenant(dormitoryId, announcementId, tenantId);
    } catch {
      return this.fallbackMemory.getRecipientForTenant(dormitoryId, announcementId, tenantId);
    }
  }

  public async recordReadReceipt(dormitoryId: string, announcementId: string, tenantId: string): Promise<AnnouncementReadReceiptEntity> {
    const now = new Date();
    try {
      const noticeKey = `announcement:${announcementId}:${tenantId}`;
      const notice = await this.prisma.tenantNotice.upsert({
        where: { sourceOutboxId: noticeKey },
        update: {
          isRead: true,
          readAt: now,
          updatedAt: now,
        },
        create: {
          dormitoryId,
          tenantId,
          title: 'ประกาศ',
          message: 'อ่านประกาศแล้ว',
          type: 'ANNOUNCEMENT_READ',
          isRead: true,
          readAt: now,
          sourceOutboxId: noticeKey,
        },
      });
      try {
        await this.fallbackMemory.recordReadReceipt(dormitoryId, announcementId, tenantId);
      } catch {}
      return {
        id: notice.id,
        dormitoryId,
        announcementId,
        tenantId,
        readAt: now,
      };
    } catch {
      return this.fallbackMemory.recordReadReceipt(dormitoryId, announcementId, tenantId);
    }
  }

  public async getReadReceipts(dormitoryId: string, announcementId: string): Promise<AnnouncementReadReceiptEntity[]> {
    try {
      const notices = await this.prisma.tenantNotice.findMany({
        where: {
          dormitoryId,
          sourceOutboxId: { startsWith: `announcement:${announcementId}:` },
          isRead: true,
        },
      });
      if (notices.length > 0) {
        return notices.map((n) => ({
          id: n.id,
          dormitoryId,
          announcementId,
          tenantId: n.tenantId,
          readAt: n.readAt || n.updatedAt,
        }));
      }
      return this.fallbackMemory.getReadReceipts(dormitoryId, announcementId);
    } catch {
      return this.fallbackMemory.getReadReceipts(dormitoryId, announcementId);
    }
  }

  public async findScheduledForDispatch(now: Date = new Date()): Promise<AnnouncementEntity[]> {
    return this.fallbackMemory.findScheduledForDispatch(now);
  }

  public async findPublishedForTenant(dormitoryId: string, tenantId: string, eligibleAnnouncementIds: string[]): Promise<AnnouncementEntity[]> {
    const where: any = {
      dormitoryId,
      status: 'published',
      deletedAt: null
    };
    if (eligibleAnnouncementIds.length > 0) {
      where.id = { in: eligibleAnnouncementIds };
    }
    const items = await this.prisma.announcement.findMany({
      where,
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' }
      ]
    });
    return items.map(mapPrismaToAnnouncementEntity);
  }
}

