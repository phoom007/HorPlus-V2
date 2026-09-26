import {
  IMaintenanceRepository,
  PrismaMaintenanceRepository,
  InMemoryMaintenanceRepository,
  MaintenanceRequestEntity,
  MaintenanceCategory,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceFilterQuery
} from '../db/repositories/maintenance.repository.js';
import { IMembershipRepository, PrismaMembershipRepository, InMemoryMembershipRepository } from '../db/repositories/membership.repository.js';
import { IRoomRepository, PrismaRoomRepository, InMemoryRoomRepository } from '../db/repositories/room.repository.js';
import { ITenantRepository, PrismaTenantRepository, InMemoryTenantRepository } from '../db/repositories/tenant.repository.js';
import { NotificationService } from './notification.service.js';
import { getPrismaClient } from '../db/prisma.js';
import { lineOaService, buildTenantMaintenanceCompletedFlexMessage } from './line-oa.service.js';

export interface CreateMaintenanceInput {
  dormitoryId: string;
  tenantId: string;
  contractId?: string;
  roomId: string;
  category: MaintenanceCategory;
  title: string;
  description: string;
  priority?: MaintenancePriority;
  preferredDate?: string;
  preferredTimeRange?: string;
  submittedByTenantId?: string;
  createdByUserId?: string;
  imageBefore?: string;
}

export interface AssignMaintenanceInput {
  dormitoryId: string;
  requestId: string;
  assignedMemberId: string;
  assignedByUserId: string;
}

export interface UpdateMaintenanceStatusInput {
  dormitoryId: string;
  requestId: string;
  status: MaintenanceStatus;
  note?: string;
  actorType: 'owner' | 'manager' | 'staff' | 'tech' | 'tenant';
  actorUserId?: string;
  actorTenantId?: string;
  actorRoleCode?: string;
  reopenReason?: string;
  cancellationReason?: string;
}

export class MaintenanceService {
  constructor(
    private maintenanceRepo: IMaintenanceRepository = new PrismaMaintenanceRepository(),
    private roomRepo: IRoomRepository = new PrismaRoomRepository(getPrismaClient()),
    private tenantRepo: ITenantRepository = new PrismaTenantRepository(getPrismaClient()),
    private membershipRepo: IMembershipRepository = new PrismaMembershipRepository(getPrismaClient()),
    private notificationService: NotificationService = new NotificationService()
  ) {}

  public getRepository(): IMaintenanceRepository {
    return this.maintenanceRepo;
  }

  public setRepository(repo: IMaintenanceRepository): void {
    this.maintenanceRepo = repo;
  }

  public getMembershipRepository(): IMembershipRepository {
    return this.membershipRepo;
  }

  public setMembershipRepository(repo: IMembershipRepository): void {
    this.membershipRepo = repo;
  }

  // State Machine transition rules
  private validateStatusTransition(current: MaintenanceStatus, next: MaintenanceStatus, actorType: string, roleCode?: string) {
    if (current === 'cancelled' && actorType !== 'owner' && actorType !== 'manager') {
      throw new Error('MAINTENANCE_REQUEST_CANCELLED: Cancelled maintenance requests cannot be updated');
    }
    if (current === 'closed' && (next as any) !== 'in_progress' && (next as any) !== 'inprogress' && actorType !== 'owner' && actorType !== 'manager') {
      throw new Error('MAINTENANCE_REQUEST_ALREADY_CLOSED: Closed maintenance requests can only be reopened to in_progress');
    }

    if (actorType === 'tenant') {
      if (next === 'cancelled') {
        if (current !== 'submitted' && current !== 'acknowledged' && (current as string) !== 'pending') {
          throw new Error('BAD_REQUEST: สามารถยกเลิกได้เฉพาะก่อนที่ช่างจะเริ่มดำเนินงานซ่อม');
        }
      } else {
        throw new Error('FORBIDDEN: ผู้เช่าสามารถดำเนินการได้เฉพาะการยกเลิกคำขอแจ้งซ่อมเท่านั้น');
      }
      return;
    }

    // State transition verification

    const allowedMap: Record<string, string[]> = {
      submitted: ['acknowledged', 'assigned', 'in_progress', 'inprogress', 'resolved', 'completed', 'closed', 'cancelled'],
      acknowledged: ['assigned', 'in_progress', 'inprogress', 'resolved', 'completed', 'closed', 'cancelled'],
      assigned: ['in_progress', 'inprogress', 'waiting_parts', 'resolved', 'completed', 'closed', 'cancelled'],
      in_progress: ['waiting_parts', 'resolved', 'completed', 'closed', 'cancelled'],
      inprogress: ['waiting_parts', 'resolved', 'completed', 'closed', 'cancelled'],
      waiting_parts: ['in_progress', 'inprogress', 'resolved', 'completed', 'closed', 'cancelled'],
      resolved: ['closed', 'in_progress', 'inprogress'],
      completed: ['closed', 'in_progress', 'inprogress'],
      closed: ['in_progress', 'inprogress'],
      cancelled: []
    };

    const allowed = allowedMap[current] || [];
    if (!allowed.includes(next)) {
      throw new Error(`INVALID_MAINTENANCE_STATUS_TRANSITION: Cannot transition maintenance request from ${current} to ${next}`);
    }
  }

  // --- Tenant Operations ---
  public async createRequestByTenant(input: CreateMaintenanceInput): Promise<MaintenanceRequestEntity> {
    const request = await this.maintenanceRepo.createRequest({
      dormitoryId: input.dormitoryId,
      tenantId: input.tenantId,
      contractId: input.contractId,
      roomId: input.roomId,
      category: input.category,
      title: input.title,
      description: input.description,
      priority: input.priority || 'normal',
      preferredDate: input.preferredDate,
      preferredTimeRange: input.preferredTimeRange,
      submittedByTenantId: input.tenantId,
      imageBefore: input.imageBefore,
      status: 'submitted'
    });

    // Record initial status history & update log
    await this.maintenanceRepo.recordStatusHistory({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: request.id,
      fromStatus: 'submitted',
      toStatus: 'submitted',
      changedByActorType: 'tenant',
      changedByTenantId: input.tenantId
    });

    await this.maintenanceRepo.createUpdate({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: request.id,
      actorType: 'tenant',
      actorTenantId: input.tenantId,
      statusSnapshot: 'submitted',
      message: 'ผู้เช่าสร้างรายการแจ้งซ่อม',
      visibility: 'tenant_visible'
    });

    // Create In-App Notification for Owner/Manager staff
    const room = await this.roomRepo.findById(input.roomId, input.dormitoryId);
    await this.notificationService.createInAppNotification({
      dormitoryId: input.dormitoryId,
      targetType: 'staff',
      category: 'MAINTENANCE_SUBMITTED',
      title: 'รายการแจ้งซ่อมใหม่',
      body: `มีการแจ้งซ่อมใหม่ #${request.requestNumber} [${request.title}] จากห้อง ${room?.roomNumber || input.roomId}`,
      metadata: { requestId: request.id, requestNumber: request.requestNumber, roomId: input.roomId, tenantId: input.tenantId }
    });

    return request;
  }

  public async getTenantRequests(dormitoryId: string, tenantId: string): Promise<MaintenanceRequestEntity[]> {
    return this.maintenanceRepo.findByTenantId(dormitoryId, tenantId);
  }

  public async getTenantRequestById(dormitoryId: string, tenantId: string, requestId: string) {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) return null;
    if (req.tenantId && req.tenantId !== tenantId) {
      throw new Error('FORBIDDEN: คุณไม่มีสิทธิ์เข้าถึงรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    }

    const updates = await this.maintenanceRepo.getUpdates(dormitoryId, requestId, true);
    const comments = await this.maintenanceRepo.getComments(dormitoryId, requestId, true);
    const attachments = await this.maintenanceRepo.getAttachments(dormitoryId, requestId);
    const history = await this.maintenanceRepo.getStatusHistory(dormitoryId, requestId);

    return { request: req, updates, comments, attachments, history };
  }

  public async cancelByTenant(dormitoryId: string, tenantId: string, requestId: string, reason?: string) {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) {
      throw new Error('RESOURCE_NOT_FOUND: ไม่พบรายการแจ้งซ่อมนี้');
    }
    if (req.tenantId && req.tenantId !== tenantId) {
      throw new Error('FORBIDDEN: คุณไม่มีสิทธิ์ยกเลิกรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    }

    this.validateStatusTransition(req.status, 'cancelled', 'tenant');

    const updated = await this.maintenanceRepo.updateRequest(dormitoryId, requestId, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledByActorId: tenantId,
      cancellationReason: reason || 'ยกเลิกโดยผู้เช่า'
    });

    await this.maintenanceRepo.recordStatusHistory({
      dormitoryId,
      maintenanceRequestId: requestId,
      fromStatus: req.status,
      toStatus: 'cancelled',
      reason: reason || 'ยกเลิกโดยผู้เช่า',
      changedByActorType: 'tenant',
      changedByTenantId: tenantId
    });

    await this.maintenanceRepo.createUpdate({
      dormitoryId,
      maintenanceRequestId: requestId,
      actorType: 'tenant',
      actorTenantId: tenantId,
      statusSnapshot: 'cancelled',
      message: `ยกเลิกรายการแจ้งซ่อม: ${reason || 'ยกเลิกโดยผู้เช่า'}`,
      visibility: 'tenant_visible'
    });

    return updated;
  }

  // --- Staff Operations ---
  public async getStaffRequests(dormitoryId: string, filters: MaintenanceFilterQuery) {
    return this.maintenanceRepo.findAll(dormitoryId, filters);
  }

  public async getStaffRequestById(dormitoryId: string, requestId: string) {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) return null;

    const assignment = await this.maintenanceRepo.getActiveAssignment(dormitoryId, requestId);
    const updates = await this.maintenanceRepo.getUpdates(dormitoryId, requestId, false);
    const comments = await this.maintenanceRepo.getComments(dormitoryId, requestId, false);
    const attachments = await this.maintenanceRepo.getAttachments(dormitoryId, requestId);
    const history = await this.maintenanceRepo.getStatusHistory(dormitoryId, requestId);
    const cost = await this.maintenanceRepo.getCost(dormitoryId, requestId);

    return { request: req, assignment, updates, comments, attachments, history, cost };
  }

  public async acknowledgeRequest(dormitoryId: string, requestId: string, userId: string): Promise<MaintenanceRequestEntity> {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) throw new Error('RESOURCE_NOT_FOUND: Maintenance request not found');

    this.validateStatusTransition(req.status, 'acknowledged', 'owner');

    const updated = await this.maintenanceRepo.updateRequest(dormitoryId, requestId, {
      status: 'acknowledged',
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId
    });

    await this.maintenanceRepo.recordStatusHistory({
      dormitoryId,
      maintenanceRequestId: requestId,
      fromStatus: req.status,
      toStatus: 'acknowledged',
      changedByActorType: 'owner',
      changedByUserId: userId
    });

    await this.maintenanceRepo.createUpdate({
      dormitoryId,
      maintenanceRequestId: requestId,
      actorType: 'owner',
      actorUserId: userId,
      statusSnapshot: 'acknowledged',
      message: 'เจ้าหน้าที่รับเรื่องเรียบร้อยแล้ว',
      visibility: 'tenant_visible'
    });

    return updated!;
  }

  public async assignTechnician(input: AssignMaintenanceInput) {
    const req = await this.maintenanceRepo.findById(input.dormitoryId, input.requestId);
    if (!req) throw new Error('RESOURCE_NOT_FOUND: Maintenance request not found');

    if (req.status !== 'assigned') {
      this.validateStatusTransition(req.status, 'assigned', 'owner');
    }

    // Verify assigned member
    const member = await this.membershipRepo.findById(input.assignedMemberId);
    if (!member || member.dormitoryId !== input.dormitoryId) {
      throw new Error('INVALID_MEMBER: Assigned member does not belong to this dormitory');
    }

    // Create assignment record
    const assignment = await this.maintenanceRepo.createAssignment({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: input.requestId,
      assignedMemberId: input.assignedMemberId,
      assignedByUserId: input.assignedByUserId,
      assignedAt: new Date()
    });

    // Update request status to assigned
    const updated = await this.maintenanceRepo.updateRequest(input.dormitoryId, input.requestId, {
      status: 'assigned'
    });

    await this.maintenanceRepo.recordStatusHistory({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: input.requestId,
      fromStatus: req.status,
      toStatus: 'assigned',
      changedByActorType: 'owner',
      changedByUserId: input.assignedByUserId
    });

    const room = req.roomId ? await this.roomRepo.findById(req.roomId, input.dormitoryId) : null;

    await this.maintenanceRepo.createUpdate({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: input.requestId,
      actorType: 'owner',
      actorUserId: input.assignedByUserId,
      statusSnapshot: 'assigned',
      message: `มอบหมายงานให้ช่าง/เจ้าหน้าที่เรียบร้อยแล้ว`,
      visibility: 'tenant_visible'
    });

    // Create In-App Notification for Technician
    await this.notificationService.createInAppNotification({
      dormitoryId: input.dormitoryId,
      targetType: 'staff',
      targetUserId: member.userId,
      category: 'MAINTENANCE_ASSIGNED',
      title: 'ได้รับมอบหมายงานแจ้งซ่อม',
      body: `คุณได้รับมอบหมายงานแจ้งซ่อม #${req.requestNumber} [${req.title}] ห้อง ${room?.roomNumber || 'ส่วนกลาง'}`,
      metadata: { requestId: req.id, requestNumber: req.requestNumber }
    });



    return { request: updated, assignment };
  }

  public async updateStatus(input: UpdateMaintenanceStatusInput): Promise<MaintenanceRequestEntity> {
    const req = await this.maintenanceRepo.findById(input.dormitoryId, input.requestId);
    if (!req) throw new Error('RESOURCE_NOT_FOUND: Maintenance request not found');

    this.validateStatusTransition(req.status, input.status, input.actorType, input.actorRoleCode);

    const now = new Date();
    const updates: Partial<MaintenanceRequestEntity> = {
      status: input.status
    };

    if (input.status === 'resolved' || (input.status as any) === 'completed') {
      updates.resolvedAt = now;
      if (input.actorUserId) updates.resolvedByUserId = input.actorUserId;
    } else if (input.status === 'closed') {
      updates.closedAt = now;
      if (input.actorUserId) updates.closedByUserId = input.actorUserId;
    } else if (input.status === 'cancelled') {
      updates.cancelledAt = now;
      updates.cancelledByActorId = input.actorUserId || input.actorTenantId;
      updates.cancellationReason = input.cancellationReason || input.note || 'ยกเลิกโดยเจ้าหน้าที่';
    }

    const updated = await this.maintenanceRepo.updateRequest(input.dormitoryId, input.requestId, updates);

    await this.maintenanceRepo.recordStatusHistory({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: input.requestId,
      fromStatus: req.status,
      toStatus: input.status,
      reason: input.reopenReason || input.cancellationReason || input.note,
      changedByActorType: input.actorType,
      changedByUserId: input.actorUserId,
      changedByTenantId: input.actorTenantId
    });

    await this.maintenanceRepo.createUpdate({
      dormitoryId: input.dormitoryId,
      maintenanceRequestId: input.requestId,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      actorTenantId: input.actorTenantId,
      statusSnapshot: input.status,
      message: input.note || `อัปเดตสถานะเป็น ${
        input.status === 'in_progress' || (input.status as string) === 'inprogress' ? 'กำลังซ่อมแซม'
        : input.status === 'waiting_parts' ? 'รออะไหล่'
        : input.status === 'resolved' || (input.status as string) === 'completed' ? 'ดำเนินการเสร็จสิ้น'
        : input.status === 'closed' ? 'ปิดงาน'
        : input.status === 'cancelled' ? 'ยกเลิก'
        : 'รอดำเนินการ'
      }`,
      visibility: 'tenant_visible'
    });

    // Create In-App Notification for Tenant
    if (req.tenantId) {
      const statusMapTh: Record<string, string> = {
        pending: 'รอดำเนินการ',
        in_progress: 'กำลังซ่อมแซม',
        inprogress: 'กำลังซ่อมแซม',
        waiting_parts: 'รออะไหล่',
        resolved: 'ดำเนินการเสร็จสิ้น',
        completed: 'ดำเนินการเสร็จสิ้น',
        closed: 'ปิดงาน',
        cancelled: 'ยกเลิก',
        reopened: 'เปิดงานอีกครั้ง',
      };
      const translatedStatus = statusMapTh[input.status] || input.status;
      const room = req.roomId ? await this.roomRepo.findById(req.roomId, input.dormitoryId) : null;
      await this.notificationService.createInAppNotification({
        dormitoryId: input.dormitoryId,
        targetType: 'tenant',
        targetTenantId: req.tenantId,
        category: 'MAINTENANCE_STATUS_UPDATED',
        title: 'อัปเดตสถานะการแจ้งซ่อม',
        body: `รายการแจ้งซ่อม [${req.title}] เปลี่ยนสถานะเป็น ${translatedStatus}`,
        metadata: { requestId: req.id, requestNumber: req.requestNumber }
      });
    }

    // Send LINE Push Notification if status is resolved or completed (PO Decision A1)
    if (req.tenantId && (input.status === 'resolved' || (input.status as any) === 'completed')) {
      try {
        const room = req.roomId ? await this.roomRepo.findById(req.roomId, input.dormitoryId) : null;
        const roomNumber = room?.roomNumber || (room as any)?.number || (req as any).roomNumber || '-';
        const prisma = getPrismaClient();
        const dorm = await prisma.dormitory.findUnique({
          where: { id: input.dormitoryId },
          select: { name: true },
        }).catch(() => null);
        const dormitoryName = dorm?.name || 'หอพัก';
        const flexMessage = buildTenantMaintenanceCompletedFlexMessage(
          dormitoryName,
          roomNumber,
          req.title,
          req.category || 'ทั่วไป',
          now.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }),
          input.note
        );

        await lineOaService.sendTenantLineNotification({
          dormitoryId: input.dormitoryId,
          tenantId: req.tenantId,
          eventType: 'MAINTENANCE',
          eventId: `maintenance-completed:${req.id}:${input.status}`,
          flexMessage,
        });
      } catch (err: any) {
        console.warn('[MaintenanceService] LINE notification error:', err?.message || err);
      }
    }

    return updated!;
  }

  public async addComment(dormitoryId: string, requestId: string, input: {
    senderType: 'tenant' | 'staff';
    senderUserId?: string;
    senderTenantId?: string;
    senderName: string;
    message: string;
    visibility?: 'tenant_visible' | 'internal';
  }) {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) throw new Error('RESOURCE_NOT_FOUND: Maintenance request not found');

    if (input.senderType === 'tenant' && input.senderTenantId && req.tenantId && req.tenantId !== input.senderTenantId) {
      throw new Error('FORBIDDEN: คุณไม่มีสิทธิ์แสดงความคิดเห็นในรายการแจ้งซ่อมของผู้เช่าท่านอื่น');
    }

    return this.maintenanceRepo.createComment({
      dormitoryId,
      maintenanceRequestId: requestId,
      senderType: input.senderType,
      senderUserId: input.senderUserId,
      senderTenantId: input.senderTenantId,
      senderName: input.senderName,
      message: input.message,
      visibility: input.visibility || 'tenant_visible'
    });
  }

  public async getCost(dormitoryId: string, requestId: string) {
    return this.maintenanceRepo.getCost(dormitoryId, requestId);
  }

  public async updateCost(dormitoryId: string, requestId: string, data: { laborCost?: string; materialCost?: string; otherCost?: string; note?: string; recordedByUserId?: string }) {
    const req = await this.maintenanceRepo.findById(dormitoryId, requestId);
    if (!req) throw new Error('RESOURCE_NOT_FOUND: Maintenance request not found');

    return this.maintenanceRepo.upsertCost(dormitoryId, requestId, data);
  }
}
