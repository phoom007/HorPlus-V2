import {
  InMemoryAnnouncementRepository,
  AnnouncementEntity,
  AnnouncementAudienceEntity,
  AnnouncementRecipientEntity,
  AnnouncementStatus,
  AnnouncementPriority,
  AnnouncementTargetType,
  AnnouncementFilterQuery
} from '../db/repositories/announcement.repository.js';
import { InMemoryTenantRepository } from '../db/repositories/tenant.repository.js';
import { InMemoryContractRepository } from '../db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../db/repositories/room.repository.js';
import { InMemoryBuildingRepository } from '../db/repositories/building.repository.js';
import { parseRoomIdentifier } from '../utils/normalization.js';
import { NotificationService } from './notification.service.js';

export interface CreateAnnouncementInput {
  dormitoryId: string;
  title: string;
  summary?: string;
  content: string;
  priority?: AnnouncementPriority;
  isPinned?: boolean;
  createdByUserId?: string;
  audiences: {
    targetType: AnnouncementTargetType;
    buildingId?: string;
    floor?: string;
    roomId?: string;
    tenantId?: string;
  }[];
}

export interface AnnouncementPreviewResult {
  announcementId: string;
  totalRecipients: number;
  inAppRecipients: number;
  eligibleTenants: { tenantId: string; name: string; roomNumber: string }[];
}

export interface PublishAnnouncementInput {
  dormitoryId: string;
  announcementId: string;
  publishedByUserId?: string;
}

export interface ScheduleAnnouncementInput {
  dormitoryId: string;
  announcementId: string;
  scheduledAt: Date;
  scheduledByUserId?: string;
}

export class AnnouncementRecipientResolver {
  constructor(
    private tenantRepo: InMemoryTenantRepository = new InMemoryTenantRepository(),
    private contractRepo: InMemoryContractRepository = new InMemoryContractRepository(),
    private roomRepo: InMemoryRoomRepository = new InMemoryRoomRepository(),
    private buildingRepo: InMemoryBuildingRepository = new InMemoryBuildingRepository()
  ) {}

  public async resolveRecipients(dormitoryId: string, audiences: AnnouncementAudienceEntity[]) {
    // Find all active tenants in dormitory
    const activeTenantsRes = await this.tenantRepo.findAll(dormitoryId);
    const activeTenants = activeTenantsRes.items || activeTenantsRes;

    const activeContracts = await this.contractRepo.findAll(dormitoryId, { status: 'active' });
    const tenantRoomMap = new Map();
    const contractList = activeContracts.items || activeContracts;
    for (const c of contractList) {
      tenantRoomMap.set(c.tenantId, c.roomId);
    }

    const roomsRes = await this.roomRepo.findAll(dormitoryId);
    const rooms = roomsRes.items || roomsRes;
    const roomMap = new Map(rooms.map((r: any) => [r.id, r]));

    const buildingsRes = await this.buildingRepo.findAll(dormitoryId);
    const buildings = buildingsRes.items || buildingsRes;

    let targetTenantIds = new Set<string>();

    for (const aud of audiences) {
      if (aud.targetType === 'all_tenants') {
        activeTenants.forEach(t => targetTenantIds.add(t.id));
      } else if (aud.targetType === 'building' && aud.buildingId) {
        for (const t of activeTenants) {
          const roomId = tenantRoomMap.get(t.id);
          const room = roomId ? roomMap.get(roomId) : null;
          if (room && room.buildingId === aud.buildingId) {
            targetTenantIds.add(t.id);
          }
        }
      } else if (aud.targetType === 'floor' && aud.buildingId && aud.floor) {
        for (const t of activeTenants) {
          const roomId = tenantRoomMap.get(t.id);
          const room = roomId ? roomMap.get(roomId) : null;
          if (room && room.buildingId === aud.buildingId) {
            const b = buildings.find((bld: any) => bld.id === aud.buildingId);
            const bConfig = b ? { code: b.code, numberingPattern: b.numberingPattern, floorCount: b.floorCount } : { code: null, numberingPattern: null, floorCount: 1 };
            const parsed = parseRoomIdentifier(bConfig as any, room.roomNumber);
            if (aud.floor !== undefined) {
              if (parsed.isValid && String(parsed.derivedFloor) === String(aud.floor)) {
                targetTenantIds.add(t.id);
              }
            }
          }
        }
      } else if (aud.targetType === 'room' && aud.roomId) {
        for (const t of activeTenants) {
          const roomId = tenantRoomMap.get(t.id);
          if (roomId === aud.roomId) {
            targetTenantIds.add(t.id);
          }
        }
      } else if (aud.targetType === 'tenant' && aud.tenantId) {
        if (activeTenants.some(t => t.id === aud.tenantId)) {
          targetTenantIds.add(aud.tenantId);
        }
      }
    }

    const resolved = [];
    for (const tenantId of targetTenantIds) {
      const tenant = activeTenants.find(t => t.id === tenantId);
      if (!tenant) continue;

      const roomId = tenantRoomMap.get(tenantId);
      const room = roomId ? roomMap.get(roomId) : null;

      resolved.push({
        tenantId,
        tenant,
        roomNumber: room?.roomNumber || '-'
      });
    }

    return resolved;
  }
}

export class AnnouncementService {
  constructor(
    private announcementRepo: InMemoryAnnouncementRepository = new InMemoryAnnouncementRepository(),
    private recipientResolver: AnnouncementRecipientResolver = new AnnouncementRecipientResolver(),
    private notificationService: NotificationService = new NotificationService()
  ) {}

  public getRepository(): InMemoryAnnouncementRepository {
    return this.announcementRepo;
  }

  // --- Staff Operations ---
  public async createDraft(input: CreateAnnouncementInput): Promise<AnnouncementEntity> {
    const announcement = await this.announcementRepo.createAnnouncement({
      dormitoryId: input.dormitoryId,
      title: input.title,
      summary: input.summary,
      content: input.content,
      priority: input.priority || 'normal',
      isPinned: input.isPinned || false,
      createdByUserId: input.createdByUserId,
      status: 'draft'
    });

    if (input.audiences && input.audiences.length > 0) {
      await this.announcementRepo.setAudiences(input.dormitoryId, announcement.id, input.audiences.map(a => ({ ...a, dormitoryId: input.dormitoryId, announcementId: announcement.id })));
    } else {
      await this.announcementRepo.setAudiences(input.dormitoryId, announcement.id, [{ targetType: 'all_tenants', dormitoryId: input.dormitoryId, announcementId: announcement.id }]);
    }

    return announcement;
  }

  public async updateAnnouncement(dormitoryId: string, id: string, updates: Partial<CreateAnnouncementInput>): Promise<AnnouncementEntity | null> {
    const existing = await this.announcementRepo.findById(dormitoryId, id);
    if (!existing) return null;

    if (existing.status === 'published' || existing.status === 'archived') {
      throw new Error(`CANNOT_MODIFY_ANNOUNCEMENT: Cannot modify announcement in ${existing.status} state`);
    }

    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, id, {
      title: updates.title,
      summary: updates.summary,
      content: updates.content,
      priority: updates.priority,
      isPinned: updates.isPinned,
      updatedByUserId: updates.createdByUserId
    });

    if (updates.audiences) {
      await this.announcementRepo.setAudiences(dormitoryId, id, updates.audiences.map(a => ({ ...a, dormitoryId, announcementId: id })));
    }

    return updated;
  }

  public async previewRecipients(dormitoryId: string, announcementId: string): Promise<AnnouncementPreviewResult> {
    const announcement = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!announcement) throw new Error('RESOURCE_NOT_FOUND: Announcement not found');

    const audiences = await this.announcementRepo.getAudiences(dormitoryId, announcementId);
    const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, audiences);

    const totalRecipients = resolved.length;

    return {
      announcementId,
      totalRecipients,
      inAppRecipients: totalRecipients,
      eligibleTenants: resolved.map(r => ({
        tenantId: r.tenantId,
        name: `${r.tenant.firstName} ${r.tenant.lastName}`.trim(),
        roomNumber: r.roomNumber
      }))
    };
  }

  public async publishAnnouncement(input: PublishAnnouncementInput): Promise<AnnouncementEntity> {
    const { dormitoryId, announcementId, publishedByUserId } = input;
    const announcement = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!announcement) throw new Error('RESOURCE_NOT_FOUND: Announcement not found');

    if (announcement.status === 'published') {
      throw new Error('ANNOUNCEMENT_ALREADY_PUBLISHED: Announcement is already published');
    }

    const audiences = await this.announcementRepo.getAudiences(dormitoryId, announcementId);
    const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, audiences);

    const now = new Date();
    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, announcementId, {
      status: 'published',
      publishedAt: now,
      updatedByUserId: publishedByUserId
    });

    // Create Recipient Records
    const recipientsData = resolved.map(r => ({
      tenantId: r.tenantId,
      deliveryStatus: 'in_app_only' as const
    }));
    await this.announcementRepo.setRecipients(dormitoryId, announcementId, recipientsData.map(r => ({ ...r, dormitoryId, announcementId })));

    // Create In-App Notifications for ALL target tenants
    for (const r of resolved) {
      await this.notificationService.createInAppNotification({
        dormitoryId,
        targetType: 'tenant',
        targetTenantId: r.tenantId,
        category: 'ANNOUNCEMENT_PUBLISHED',
        title: announcement.title,
        body: announcement.summary || announcement.content.slice(0, 100),
        metadata: { announcementId: announcement.id, priority: announcement.priority }
      });
    }



    return updated!;
  }

  public async scheduleAnnouncement(input: ScheduleAnnouncementInput): Promise<AnnouncementEntity> {
    const { dormitoryId, announcementId, scheduledAt, scheduledByUserId } = input;
    const announcement = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!announcement) throw new Error('RESOURCE_NOT_FOUND: Announcement not found');

    if (scheduledAt <= new Date()) {
      throw new Error('INVALID_SCHEDULE_TIME: Scheduled time must be in the future');
    }

    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, announcementId, {
      status: 'scheduled',
      scheduledAt,
      updatedByUserId: scheduledByUserId
    });

    return updated!;
  }

  public async cancelSchedule(dormitoryId: string, announcementId: string): Promise<AnnouncementEntity> {
    const announcement = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!announcement) throw new Error('RESOURCE_NOT_FOUND: Announcement not found');

    if (announcement.status !== 'scheduled') {
      throw new Error('ANNOUNCEMENT_NOT_SCHEDULED: Announcement is not in scheduled state');
    }

    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, announcementId, {
      status: 'draft',
      scheduledAt: null
    });

    return updated!;
  }

  public async archiveAnnouncement(dormitoryId: string, announcementId: string): Promise<AnnouncementEntity> {
    const announcement = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!announcement) throw new Error('RESOURCE_NOT_FOUND: Announcement not found');

    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, announcementId, {
      status: 'archived',
      archivedAt: new Date()
    });

    return updated!;
  }

  // Scheduled Dispatcher (for CRON or manual test invocation)
  public async dispatchScheduledAnnouncements(now: Date = new Date()): Promise<number> {
    const scheduled = await this.announcementRepo.findScheduledForDispatch(now);
    let count = 0;

    for (const ann of scheduled) {
      try {
        await this.publishAnnouncement({
          dormitoryId: ann.dormitoryId,
          announcementId: ann.id
        });
        count++;
      } catch (err: any) {
        // ignore or log
      }
    }

    return count;
  }

  // --- Tenant Operations ---
  public async getTenantAnnouncements(dormitoryId: string, tenantId: string) {
    const audiences = await this.announcementRepo.getAudiences(dormitoryId, '');

    // Get all published announcements for dormitory
    const all = await this.announcementRepo.findAll(dormitoryId, { status: 'published' });

    // Filter announcements eligible for this tenant
    const eligibleIds = [];
    for (const ann of all.items) {
      const annAudiences = await this.announcementRepo.getAudiences(dormitoryId, ann.id);
      const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, annAudiences);
      if (resolved.some(r => r.tenantId === tenantId)) {
        eligibleIds.push(ann.id);
      }
    }

    const announcements = await this.announcementRepo.findPublishedForTenant(dormitoryId, tenantId, eligibleIds);

    // Attach read receipt status
    const result = [];
    for (const a of announcements) {
      const rec = await this.announcementRepo.getRecipientForTenant(dormitoryId, a.id, tenantId);
      result.push({
        ...a,
        isRead: !!rec?.readAt,
        readAt: rec?.readAt || null
      });
    }

    return result;
  }

  public async getTenantAnnouncementById(dormitoryId: string, tenantId: string, announcementId: string) {
    const ann = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!ann || ann.status !== 'published') return null;

    const rec = await this.announcementRepo.getRecipientForTenant(dormitoryId, announcementId, tenantId);

    // Auto mark read
    if (!rec?.readAt) {
      await this.announcementRepo.recordReadReceipt(dormitoryId, announcementId, tenantId);
    }

    return {
      ...ann,
      isRead: true,
      readAt: rec?.readAt || new Date()
    };
  }

  public async markAsReadByTenant(dormitoryId: string, announcementId: string, tenantId: string) {
    return this.announcementRepo.recordReadReceipt(dormitoryId, announcementId, tenantId);
  }

  public async markAllAsReadByTenant(dormitoryId: string, tenantId: string) {
    const list = await this.getTenantAnnouncements(dormitoryId, tenantId);
    let count = 0;
    for (const a of list) {
      if (!a.isRead) {
        await this.announcementRepo.recordReadReceipt(dormitoryId, a.id, tenantId);
        count++;
      }
    }
    return count;
  }
}
