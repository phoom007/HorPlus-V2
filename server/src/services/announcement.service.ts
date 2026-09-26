import {
  IAnnouncementRepository,
  PrismaAnnouncementRepository,
  InMemoryAnnouncementRepository,
  AnnouncementEntity,
  AnnouncementAudienceEntity,
  AnnouncementRecipientEntity,
  AnnouncementStatus,
  AnnouncementPriority,
  AnnouncementTargetType,
  AnnouncementDeliveryStatus,
  AnnouncementFilterQuery
} from '../db/repositories/announcement.repository.js';
import { ITenantRepository, InMemoryTenantRepository, PrismaTenantRepository } from '../db/repositories/tenant.repository.js';
import { IContractRepository, InMemoryContractRepository, PrismaContractRepository } from '../db/repositories/contract.repository.js';
import { IRoomRepository, InMemoryRoomRepository, PrismaRoomRepository } from '../db/repositories/room.repository.js';
import { IBuildingRepository, InMemoryBuildingRepository, PrismaBuildingRepository } from '../db/repositories/building.repository.js';
import { parseRoomIdentifier } from '../utils/normalization.js';
import { NotificationService } from './notification.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { LinePushUsageService } from './line-push-usage.service.js';
import { lineOaService, buildTenantAnnouncementFlexMessage } from './line-oa.service.js';

export interface CreateAnnouncementInput {
  dormitoryId: string;
  title: string;
  summary?: string;
  content: string;
  priority?: AnnouncementPriority;
  isPinned?: boolean;
  publishDate?: Date | string;
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
  sendLinePush?: boolean;
}

export interface ScheduleAnnouncementInput {
  dormitoryId: string;
  announcementId: string;
  scheduledAt: Date;
  scheduledByUserId?: string;
}

export class AnnouncementRecipientResolver {
  private tenantRepo: ITenantRepository;
  private contractRepo: IContractRepository;
  private roomRepo: IRoomRepository;
  private buildingRepo: IBuildingRepository;

  constructor(
    tenantRepo?: ITenantRepository,
    contractRepo?: IContractRepository,
    roomRepo?: IRoomRepository,
    buildingRepo?: IBuildingRepository
  ) {
    if (tenantRepo && contractRepo && roomRepo && buildingRepo) {
      this.tenantRepo = tenantRepo;
      this.contractRepo = contractRepo;
      this.roomRepo = roomRepo;
      this.buildingRepo = buildingRepo;
    } else {
      let prisma: any = null;
      try {
        prisma = getPrismaClient();
      } catch {
        // Fallback to in-memory if Prisma cannot be initialized
      }
      this.tenantRepo = tenantRepo || (prisma ? new PrismaTenantRepository(prisma) : new InMemoryTenantRepository());
      this.contractRepo = contractRepo || (prisma ? new PrismaContractRepository(prisma) : new InMemoryContractRepository());
      this.roomRepo = roomRepo || (prisma ? new PrismaRoomRepository(prisma) : new InMemoryRoomRepository());
      this.buildingRepo = buildingRepo || (prisma ? new PrismaBuildingRepository(prisma) : new InMemoryBuildingRepository());
    }
  }

  public async resolveRecipients(dormitoryId: string, audiences: AnnouncementAudienceEntity[]) {
    // Find all active tenants in dormitory
    const activeTenantsRes = await this.tenantRepo.findAll(dormitoryId, { status: 'active', pageSize: 1000 } as any);
    const allTenantsList: any[] = (activeTenantsRes as any).items || (Array.isArray(activeTenantsRes) ? activeTenantsRes : []);
    const activeTenants: any[] = allTenantsList.filter((t: any) => t.status === 'active');

    const activeContracts = await this.contractRepo.findAll(dormitoryId, { status: 'active', pageSize: 1000 } as any);
    const tenantRoomsMap = new Map<string, Set<string>>();
    const addTenantRoom = (tId: string, rId: string) => {
      if (!tenantRoomsMap.has(tId)) {
        tenantRoomsMap.set(tId, new Set());
      }
      tenantRoomsMap.get(tId)!.add(rId);
    };

    const contractList = (activeContracts as any).items || (Array.isArray(activeContracts) ? activeContracts : []);
    for (const c of contractList) {
      if (c.tenantId && c.roomId) {
        addTenantRoom(c.tenantId, c.roomId);
      }
    }

    for (const st of ['expiring_soon', 'waiting_extension', 'approved_scheduled']) {
      try {
        const extraContracts = await this.contractRepo.findAll(dormitoryId, { status: st, pageSize: 1000 } as any);
        const extraList = (extraContracts as any).items || (Array.isArray(extraContracts) ? extraContracts : []);
        for (const c of extraList) {
          if (c.tenantId && c.roomId) {
            addTenantRoom(c.tenantId, c.roomId);
          }
        }
      } catch {}
    }

    for (const t of activeTenants) {
      if (t.roomId) {
        addTenantRoom(t.id, t.roomId);
      }
    }

    let prisma: any = null;
    try { prisma = getPrismaClient(); } catch {}
    const isUuid = /^[0-9a-fA-F-]{36}$/.test(dormitoryId);
    if (prisma && isUuid) {
      try {
        const occupancies = await prisma.occupancy.findMany({
          where: { dormitoryId, status: 'ACTIVE' },
          select: { tenantId: true, roomId: true },
        });
        for (const occ of occupancies) {
          if (occ.tenantId && occ.roomId) {
            addTenantRoom(occ.tenantId, occ.roomId);
          }
        }
      } catch {}
    }

    const roomsRes = await this.roomRepo.findAll(dormitoryId, { pageSize: 1000 } as any);
    const rooms = (roomsRes as any).items || (Array.isArray(roomsRes) ? roomsRes : []);
    const roomMap = new Map<string, any>(rooms.map((r: any) => [r.id, r]));

    const buildingsRes = await this.buildingRepo.findAll(dormitoryId);
    const buildings: any[] = (buildingsRes as any).items || (Array.isArray(buildingsRes) ? buildingsRes : []);

    let targetTenantIds = new Set<string>();

    for (const aud of audiences) {
      if (aud.targetType === 'all_tenants' || (aud.targetType as string) === 'all') {
        activeTenants.forEach((t: any) => targetTenantIds.add(t.id));
      } else if (aud.targetType === 'building' && aud.buildingId) {
        for (const t of activeTenants) {
          const tRooms = tenantRoomsMap.get(t.id);
          if (tRooms) {
            for (const rId of tRooms) {
              const room: any = roomMap.get(rId);
              if (room && room.buildingId === aud.buildingId) {
                targetTenantIds.add(t.id);
                break;
              }
            }
          }
        }
      } else if (aud.targetType === 'floor' && aud.buildingId && aud.floor) {
        for (const t of activeTenants) {
          const tRooms = tenantRoomsMap.get(t.id);
          if (tRooms) {
            for (const rId of tRooms) {
              const room: any = roomMap.get(rId);
              if (room && room.buildingId === aud.buildingId) {
                const b = buildings.find((bld: any) => bld.id === aud.buildingId);
                const bConfig = b ? { code: b.code, numberingPattern: b.numberingPattern, floorCount: b.floorCount } : { code: null, numberingPattern: null, floorCount: 1 };
                const parsed = parseRoomIdentifier(bConfig as any, room.roomNumber);
                if (aud.floor !== undefined) {
                  if (parsed.isValid && String(parsed.derivedFloor) === String(aud.floor)) {
                    targetTenantIds.add(t.id);
                    break;
                  }
                }
              }
            }
          }
        }
      } else if (aud.targetType === 'room' && aud.roomId) {
        for (const t of activeTenants) {
          const tRooms = tenantRoomsMap.get(t.id);
          if (tRooms && tRooms.has(aud.roomId)) {
            targetTenantIds.add(t.id);
          }
        }
      } else if (aud.targetType === 'tenant' && aud.tenantId) {
        if (activeTenants.some((t: any) => t.id === aud.tenantId)) {
          targetTenantIds.add(aud.tenantId);
        }
      }
    }

    const resolved = [];
    for (const tenantId of targetTenantIds) {
      const tenant = activeTenants.find((t: any) => t.id === tenantId);
      if (!tenant) continue;

      const tRooms = tenantRoomsMap.get(tenantId);
      const firstRoomId = tRooms && tRooms.size > 0 ? tRooms.values().next().value : null;
      const room: any = firstRoomId ? roomMap.get(firstRoomId) : null;

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
    private announcementRepo: IAnnouncementRepository = new PrismaAnnouncementRepository(),
    private recipientResolver: AnnouncementRecipientResolver = new AnnouncementRecipientResolver(),
    private notificationService: NotificationService = new NotificationService(),
    private quotaService: LinePushUsageService = new LinePushUsageService(getPrismaClient()),
    private tenantRepo?: ITenantRepository
  ) {
    if (!this.tenantRepo) {
      let prisma: any = null;
      try { prisma = getPrismaClient(); } catch {}
      this.tenantRepo = prisma ? new PrismaTenantRepository(prisma) : new InMemoryTenantRepository();
    }
  }

  public setQuotaService(quotaService: LinePushUsageService) {
    this.quotaService = quotaService;
  }

  public getRepository(): IAnnouncementRepository {
    return this.announcementRepo;
  }

  // --- Staff Operations ---
  public async createDraft(input: CreateAnnouncementInput & { type?: string; targetType?: string; targetBuildingId?: string; customTarget?: string; targetRooms?: string; attachmentUrl?: string; linkUrl?: string; author?: string; status?: AnnouncementStatus }): Promise<AnnouncementEntity> {
    const announcement = await this.announcementRepo.createAnnouncement({
      dormitoryId: input.dormitoryId,
      title: input.title,
      summary: input.summary,
      content: input.content,
      type: input.type || 'general',
      targetType: input.targetType || (input.audiences && input.audiences.length > 0 ? input.audiences[0].targetType : 'all'),
      targetBuildingId: input.targetBuildingId || null,
      customTarget: input.customTarget || null,
      targetRooms: input.targetRooms || null,
      attachmentUrl: input.attachmentUrl || null,
      linkUrl: input.linkUrl || null,
      author: input.author || null,
      priority: input.priority || 'normal',
      isPinned: input.isPinned || false,
      createdByUserId: input.createdByUserId,
      status: input.status || 'draft'
    });

    if (input.audiences && input.audiences.length > 0) {
      await this.announcementRepo.setAudiences(input.dormitoryId, announcement.id, input.audiences.map(a => ({ ...a, dormitoryId: input.dormitoryId, announcementId: announcement.id })));
    } else {
      await this.announcementRepo.setAudiences(input.dormitoryId, announcement.id, [{ targetType: 'all_tenants', dormitoryId: input.dormitoryId, announcementId: announcement.id }]);
    }

    return announcement;
  }

  public async updateAnnouncement(dormitoryId: string, id: string, updates: Partial<CreateAnnouncementInput> & { type?: string; customTarget?: string; targetRooms?: string; attachmentUrl?: string; linkUrl?: string; author?: string }): Promise<AnnouncementEntity | null> {
    const existing = await this.announcementRepo.findById(dormitoryId, id);
    if (!existing) return null;

    if (existing.status === 'archived') {
      throw new Error(`CANNOT_MODIFY_ANNOUNCEMENT: Cannot modify announcement in ${existing.status} state`);
    }

    const updated = await this.announcementRepo.updateAnnouncement(dormitoryId, id, {
      title: updates.title,
      summary: updates.summary,
      content: updates.content,
      type: updates.type,
      customTarget: updates.customTarget,
      targetRooms: updates.targetRooms,
      attachmentUrl: updates.attachmentUrl,
      linkUrl: updates.linkUrl,
      author: updates.author,
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

    let quotaWarning: string | undefined = undefined;
    let flexMessage: any = null;

    if (input.sendLinePush && resolved.length > 0) {
      const prisma = getPrismaClient();
      const dorm = await prisma.dormitory.findUnique({
        where: { id: dormitoryId },
        select: { name: true },
      }).catch(() => null);
      const dormitoryName = dorm?.name || 'หอพัก';
      flexMessage = buildTenantAnnouncementFlexMessage(
        dormitoryName,
        announcement.title,
        announcement.summary || announcement.content.slice(0, 150),
        announcement.priority,
        now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
      );
    }

    // Process recipient records and individual LINE notifications
    const recipientsData: { tenantId: string; deliveryStatus: AnnouncementDeliveryStatus }[] = [];
    for (const r of resolved) {
      let deliveryStatus: AnnouncementDeliveryStatus = 'in_app_only';
      if (input.sendLinePush && flexMessage) {
        try {
          const sendRes = await lineOaService.sendTenantLineNotification({
            dormitoryId,
            tenantId: r.tenantId,
            eventType: 'ANNOUNCEMENT',
            eventId: `announcement-published:${announcement.id}:${r.tenantId}`,
            flexMessage,
          });
          if (sendRes.sent) {
            deliveryStatus = 'line_sent';
          } else if (sendRes.reason === 'QUOTA_EXHAUSTED' || sendRes.warningMessage) {
            quotaWarning = sendRes.warningMessage || 'จำนวนการส่งข้อความเดือนนี้หมดแล้ว';
          }
        } catch (err: any) {
          console.warn(`[AnnouncementService] LINE notification error for tenant ${r.tenantId}:`, err?.message || err);
        }
      }
      recipientsData.push({
        tenantId: r.tenantId,
        deliveryStatus,
      });
    }

    if (recipientsData.length > 0) {
      await this.announcementRepo.setRecipients(dormitoryId, announcementId, recipientsData.map(r => ({ ...r, dormitoryId, announcementId })));
    }

    // Create In-App Notifications for ALL target tenants
    for (const r of resolved) {
      await this.notificationService.createInAppNotification({
        dormitoryId,
        targetType: 'tenant',
        targetTenantId: r.tenantId,
        category: 'ANNOUNCEMENT_PUBLISHED',
        title: announcement.title,
        body: announcement.summary || announcement.content.slice(0, 100),
        metadata: { announcementId: announcement.id, priority: announcement.priority },
        sourceOutboxId: `announcement:${announcement.id}:${r.tenantId}`
      });
    }

    const result = { ...updated! };
    if (quotaWarning) {
      result.warning = quotaWarning;
    }
    return result;
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
    // 1. Verify tenant exists and is active (REQUIREMENTS-LOCK §8:156)
    let tenant: any = null;
    if (this.tenantRepo) {
      tenant = await this.tenantRepo.findById(tenantId, dormitoryId);
    }
    if (!tenant) {
      const isIdUuid = /^[0-9a-fA-F-]{36}$/.test(dormitoryId) && /^[0-9a-fA-F-]{36}$/.test(tenantId);
      if (isIdUuid) {
        try {
          const prisma = getPrismaClient();
          tenant = await prisma.tenant.findFirst({ where: { id: tenantId, dormitoryId } });
        } catch {}
      }
    }
    if (!tenant || tenant.status !== 'active') {
      return [];
    }

    // 2. Get all published announcements for dormitory
    const all = await this.announcementRepo.findAll(dormitoryId, { status: 'published' });

    // 3. Filter announcements eligible for this tenant
    const eligibleIds: string[] = [];
    for (const ann of all.items) {
      const annAudiences = await this.announcementRepo.getAudiences(dormitoryId, ann.id);
      if (annAudiences && annAudiences.length > 0) {
        if (annAudiences.some(a => a.targetType === 'all_tenants' || (a.targetType as string) === 'all')) {
          eligibleIds.push(ann.id);
          continue;
        }
        const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, annAudiences);
        if (resolved.some(r => r.tenantId === tenantId)) {
          eligibleIds.push(ann.id);
        }
        continue;
      }

      if (ann.targetRooms || ann.targetType === 'rooms') {
        const roomNumbers = (ann.targetRooms || '').split(',').map((r: string) => r.trim()).filter(Boolean);
        if (roomNumbers.length > 0) {
          const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, [{ targetType: 'all_tenants' } as any]);
          const tenantEntry = resolved.find(r => r.tenantId === tenantId);
          if (tenantEntry && roomNumbers.includes(tenantEntry.roomNumber)) {
            eligibleIds.push(ann.id);
            continue;
          }
        }
      }

      if (!ann.targetType || ann.targetType === 'all' || ann.targetType === 'all_tenants') {
        eligibleIds.push(ann.id);
      }
    }

    if (eligibleIds.length === 0) {
      return [];
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
    // 1. Verify tenant exists and is active (REQUIREMENTS-LOCK §8:156)
    let tenant: any = null;
    if (this.tenantRepo) {
      tenant = await this.tenantRepo.findById(tenantId, dormitoryId);
    }
    if (!tenant) {
      const isIdUuid = /^[0-9a-fA-F-]{36}$/.test(dormitoryId) && /^[0-9a-fA-F-]{36}$/.test(tenantId);
      if (isIdUuid) {
        try {
          const prisma = getPrismaClient();
          tenant = await prisma.tenant.findFirst({ where: { id: tenantId, dormitoryId } });
        } catch {}
      }
    }
    if (!tenant || tenant.status !== 'active') {
      return null;
    }

    const ann = await this.announcementRepo.findById(dormitoryId, announcementId);
    if (!ann || ann.status !== 'published') return null;

    // Check eligibility
    const annAudiences = await this.announcementRepo.getAudiences(dormitoryId, ann.id);
    if (annAudiences && annAudiences.length > 0) {
      const isAll = annAudiences.some(a => a.targetType === 'all_tenants' || (a.targetType as string) === 'all');
      if (!isAll) {
        const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, annAudiences);
        if (!resolved.some(r => r.tenantId === tenantId)) {
          return null;
        }
      }
    } else if (ann.targetRooms || ann.targetType === 'rooms') {
      const roomNumbers = (ann.targetRooms || '').split(',').map((r: string) => r.trim()).filter(Boolean);
      if (roomNumbers.length > 0) {
        const resolved = await this.recipientResolver.resolveRecipients(dormitoryId, [{ targetType: 'all_tenants' } as any]);
        const tenantEntry = resolved.find(r => r.tenantId === tenantId);
        if (!tenantEntry || !roomNumbers.includes(tenantEntry.roomNumber)) {
          return null;
        }
      }
    }

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
