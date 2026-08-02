import crypto from 'crypto';
import { addDecimals, formatDecimal } from '../../utils/decimal-math.util.js';
const uuidv4 = () => crypto.randomUUID();

export type MaintenanceCategory =
  | 'electricity'
  | 'water'
  | 'plumbing'
  | 'air_conditioner'
  | 'appliance'
  | 'furniture'
  | 'door_lock'
  | 'internet'
  | 'cleaning'
  | 'pest'
  | 'other';

export type MaintenancePriority = 'low' | 'normal' | 'high' | 'urgent';

export type MaintenanceStatus =
  | 'submitted'
  | 'acknowledged'
  | 'assigned'
  | 'in_progress'
  | 'waiting_parts'
  | 'resolved'
  | 'closed'
  | 'cancelled';

export interface MaintenanceRequestEntity {
  id: string;
  dormitoryId: string;
  requestNumber: string;
  tenantId: string;
  contractId?: string | null;
  roomId: string;
  category: MaintenanceCategory;
  title: string;
  description: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  preferredDate?: string | null;
  preferredTimeRange?: string | null;
  submittedByTenantId?: string | null;
  createdByUserId?: string | null;
  acknowledgedAt?: Date | null;
  acknowledgedByUserId?: string | null;
  resolvedAt?: Date | null;
  resolvedByUserId?: string | null;
  closedAt?: Date | null;
  closedByUserId?: string | null;
  cancelledAt?: Date | null;
  cancelledByActorId?: string | null;
  cancellationReason?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface MaintenanceAssignmentEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  assignedMemberId: string;
  assignedLineIdentityId?: string | null;
  status: 'assigned' | 'accepted' | 'completed' | 'revoked';
  assignedByUserId: string;
  assignedAt: Date;
  acceptedAt?: Date | null;
  completedAt?: Date | null;
  revokedAt?: Date | null;
  revokedByUserId?: string | null;
  revocationReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface MaintenanceUpdateEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  actorType: 'owner' | 'manager' | 'tech' | 'tenant';
  actorUserId?: string | null;
  actorMemberId?: string | null;
  actorTenantId?: string | null;
  statusSnapshot: MaintenanceStatus;
  message: string;
  visibility: 'tenant_visible' | 'internal';
  createdAt: Date;
  updatedAt: Date;
}

export interface MaintenanceCommentEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  senderType: 'tenant' | 'staff';
  senderUserId?: string | null;
  senderTenantId?: string | null;
  senderName: string;
  message: string;
  visibility: 'tenant_visible' | 'internal';
  createdAt: Date;
}

export interface MaintenanceAttachmentEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  maintenanceUpdateId?: string | null;
  storageProvider: string;
  objectKey: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sha256?: string | null;
  uploadedByActorType: 'tenant' | 'staff';
  uploadedByUserId?: string | null;
  uploadedByTenantId?: string | null;
  status: 'active' | 'deleted';
  createdAt: Date;
  deletedAt?: Date | null;
}

export interface MaintenanceStatusHistoryEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  fromStatus: MaintenanceStatus;
  toStatus: MaintenanceStatus;
  reason?: string | null;
  changedByActorType: 'owner' | 'manager' | 'tech' | 'tenant';
  changedByUserId?: string | null;
  changedByTenantId?: string | null;
  createdAt: Date;
}

export interface MaintenanceCostEntity {
  id: string;
  dormitoryId: string;
  maintenanceRequestId: string;
  laborCost: string;
  materialCost: string;
  otherCost: string;
  totalCost: string;
  note?: string | null;
  recordedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface MaintenanceFilterQuery {
  status?: MaintenanceStatus;
  priority?: MaintenancePriority;
  category?: MaintenanceCategory;
  buildingId?: string;
  roomId?: string;
  assignedMemberId?: string;
  tenantId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
}

export class InMemoryMaintenanceRepository {
  private requests: MaintenanceRequestEntity[] = [];
  private assignments: MaintenanceAssignmentEntity[] = [];
  private updates: MaintenanceUpdateEntity[] = [];
  private comments: MaintenanceCommentEntity[] = [];
  private attachments: MaintenanceAttachmentEntity[] = [];
  private history: MaintenanceStatusHistoryEntity[] = [];
  private costs: MaintenanceCostEntity[] = [];

  public async createRequest(data: Omit<MaintenanceRequestEntity, 'id' | 'requestNumber' | 'status' | 'version' | 'createdAt' | 'updatedAt'> & { status?: MaintenanceStatus }): Promise<MaintenanceRequestEntity> {
    const now = new Date();
    const count = this.requests.length + 1;
    const requestNumber = `MNT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(count).padStart(5, '0')}`;

    const request: MaintenanceRequestEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      requestNumber,
      tenantId: data.tenantId,
      contractId: data.contractId || null,
      roomId: data.roomId,
      category: data.category,
      title: data.title,
      description: data.description,
      priority: data.priority || 'normal',
      status: data.status || 'submitted',
      preferredDate: data.preferredDate || null,
      preferredTimeRange: data.preferredTimeRange || null,
      submittedByTenantId: data.submittedByTenantId || null,
      createdByUserId: data.createdByUserId || null,
      version: 1,
      createdAt: now,
      updatedAt: now
    };

    this.requests.push(request);
    return request;
  }

  public async findById(dormitoryId: string, id: string): Promise<MaintenanceRequestEntity | null> {
    return this.requests.find(r => r.dormitoryId === dormitoryId && r.id === id && !r.deletedAt) || null;
  }

  public async findByTenantId(dormitoryId: string, tenantId: string): Promise<MaintenanceRequestEntity[]> {
    return this.requests.filter(r => r.dormitoryId === dormitoryId && r.tenantId === tenantId && !r.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async findAll(dormitoryId: string, filters: MaintenanceFilterQuery = {}): Promise<{ items: MaintenanceRequestEntity[]; total: number }> {
    let result = this.requests.filter(r => r.dormitoryId === dormitoryId && !r.deletedAt);

    if (filters.status) {
      result = result.filter(r => r.status === filters.status);
    }
    if (filters.priority) {
      result = result.filter(r => r.priority === filters.priority);
    }
    if (filters.category) {
      result = result.filter(r => r.category === filters.category);
    }
    if (filters.roomId) {
      result = result.filter(r => r.roomId === filters.roomId);
    }
    if (filters.tenantId) {
      result = result.filter(r => r.tenantId === filters.tenantId);
    }
    if (filters.assignedMemberId) {
      const assignedReqIds = new Set(
        this.assignments.filter(a => a.dormitoryId === dormitoryId && a.assignedMemberId === filters.assignedMemberId && a.status !== 'revoked')
          .map(a => a.maintenanceRequestId)
      );
      result = result.filter(r => assignedReqIds.has(r.id));
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(r => r.requestNumber.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
    }

    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = result.length;
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 20;
    const startIndex = (page - 1) * pageSize;
    const paginated = result.slice(startIndex, startIndex + pageSize);

    return { items: paginated, total };
  }

  public async updateRequest(dormitoryId: string, id: string, updates: Partial<MaintenanceRequestEntity>): Promise<MaintenanceRequestEntity | null> {
    const index = this.requests.findIndex(r => r.dormitoryId === dormitoryId && r.id === id);
    if (index === -1) return null;

    const existing = this.requests[index];
    const updated: MaintenanceRequestEntity = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date()
    };

    this.requests[index] = updated;
    return updated;
  }

  public async createAssignment(data: Omit<MaintenanceAssignmentEntity, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'version'>): Promise<MaintenanceAssignmentEntity> {
    const now = new Date();
    const assignment: MaintenanceAssignmentEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      maintenanceRequestId: data.maintenanceRequestId,
      assignedMemberId: data.assignedMemberId,
      assignedLineIdentityId: data.assignedLineIdentityId || null,
      status: 'assigned',
      assignedByUserId: data.assignedByUserId,
      assignedAt: data.assignedAt || now,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    this.assignments.push(assignment);
    return assignment;
  }

  public async getAssignments(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity[]> {
    return this.assignments.filter(a => a.dormitoryId === dormitoryId && a.maintenanceRequestId === requestId);
  }

  public async getActiveAssignment(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity | null> {
    return this.assignments.find(a => a.dormitoryId === dormitoryId && a.maintenanceRequestId === requestId && a.status !== 'revoked') || null;
  }

  public async createUpdate(data: Omit<MaintenanceUpdateEntity, 'id' | 'createdAt' | 'updatedAt'>): Promise<MaintenanceUpdateEntity> {
    const now = new Date();
    const update: MaintenanceUpdateEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      maintenanceRequestId: data.maintenanceRequestId,
      actorType: data.actorType,
      actorUserId: data.actorUserId || null,
      actorMemberId: data.actorMemberId || null,
      actorTenantId: data.actorTenantId || null,
      statusSnapshot: data.statusSnapshot,
      message: data.message,
      visibility: data.visibility || 'tenant_visible',
      createdAt: now,
      updatedAt: now
    };

    this.updates.push(update);
    return update;
  }

  public async getUpdates(dormitoryId: string, requestId: string, isTenant: boolean = false): Promise<MaintenanceUpdateEntity[]> {
    return this.updates.filter(u =>
      u.dormitoryId === dormitoryId &&
      u.maintenanceRequestId === requestId &&
      (!isTenant || u.visibility === 'tenant_visible')
    ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async createComment(data: Omit<MaintenanceCommentEntity, 'id' | 'createdAt'>): Promise<MaintenanceCommentEntity> {
    const comment: MaintenanceCommentEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      maintenanceRequestId: data.maintenanceRequestId,
      senderType: data.senderType,
      senderUserId: data.senderUserId || null,
      senderTenantId: data.senderTenantId || null,
      senderName: data.senderName,
      message: data.message,
      visibility: data.visibility || 'tenant_visible',
      createdAt: new Date()
    };

    this.comments.push(comment);
    return comment;
  }

  public async getComments(dormitoryId: string, requestId: string, isTenant: boolean = false): Promise<MaintenanceCommentEntity[]> {
    return this.comments.filter(c =>
      c.dormitoryId === dormitoryId &&
      c.maintenanceRequestId === requestId &&
      (!isTenant || c.visibility === 'tenant_visible')
    ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async createAttachment(data: Omit<MaintenanceAttachmentEntity, 'id' | 'status' | 'createdAt'>): Promise<MaintenanceAttachmentEntity> {
    const attachment: MaintenanceAttachmentEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      maintenanceRequestId: data.maintenanceRequestId,
      maintenanceUpdateId: data.maintenanceUpdateId || null,
      storageProvider: data.storageProvider,
      objectKey: data.objectKey,
      originalFileName: data.originalFileName,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      sha256: data.sha256 || null,
      uploadedByActorType: data.uploadedByActorType,
      uploadedByUserId: data.uploadedByUserId || null,
      uploadedByTenantId: data.uploadedByTenantId || null,
      status: 'active',
      createdAt: new Date()
    };

    this.attachments.push(attachment);
    return attachment;
  }

  public async getAttachments(dormitoryId: string, requestId: string): Promise<MaintenanceAttachmentEntity[]> {
    return this.attachments.filter(a => a.dormitoryId === dormitoryId && a.maintenanceRequestId === requestId && a.status === 'active');
  }

  public async recordStatusHistory(data: Omit<MaintenanceStatusHistoryEntity, 'id' | 'createdAt'>): Promise<MaintenanceStatusHistoryEntity> {
    const entry: MaintenanceStatusHistoryEntity = {
      id: uuidv4(),
      dormitoryId: data.dormitoryId,
      maintenanceRequestId: data.maintenanceRequestId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      reason: data.reason || null,
      changedByActorType: data.changedByActorType,
      changedByUserId: data.changedByUserId || null,
      changedByTenantId: data.changedByTenantId || null,
      createdAt: new Date()
    };

    this.history.push(entry);
    return entry;
  }

  public async getStatusHistory(dormitoryId: string, requestId: string): Promise<MaintenanceStatusHistoryEntity[]> {
    return this.history.filter(h => h.dormitoryId === dormitoryId && h.maintenanceRequestId === requestId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  public async upsertCost(dormitoryId: string, requestId: string, data: { laborCost?: string; materialCost?: string; otherCost?: string; note?: string; recordedByUserId?: string }): Promise<MaintenanceCostEntity> {
    const existingIndex = this.costs.findIndex(c => c.dormitoryId === dormitoryId && c.maintenanceRequestId === requestId);
    const labor = data.laborCost !== undefined ? data.laborCost : (existingIndex !== -1 ? this.costs[existingIndex].laborCost : '0.00');
    const material = data.materialCost !== undefined ? data.materialCost : (existingIndex !== -1 ? this.costs[existingIndex].materialCost : '0.00');
    const other = data.otherCost !== undefined ? data.otherCost : (existingIndex !== -1 ? this.costs[existingIndex].otherCost : '0.00');

    const total = formatDecimal(addDecimals(labor, material, other));
    const now = new Date();

    if (existingIndex !== -1) {
      const existing = this.costs[existingIndex];
      const updated: MaintenanceCostEntity = {
        ...existing,
        laborCost: labor,
        materialCost: material,
        otherCost: other,
        totalCost: total,
        note: data.note !== undefined ? data.note : existing.note,
        recordedByUserId: data.recordedByUserId || existing.recordedByUserId,
        updatedAt: now,
        version: existing.version + 1
      };
      this.costs[existingIndex] = updated;
      return updated;
    }

    const newCost: MaintenanceCostEntity = {
      id: uuidv4(),
      dormitoryId,
      maintenanceRequestId: requestId,
      laborCost: labor,
      materialCost: material,
      otherCost: other,
      totalCost: total,
      note: data.note || null,
      recordedByUserId: data.recordedByUserId || null,
      createdAt: now,
      updatedAt: now,
      version: 1
    };

    this.costs.push(newCost);
    return newCost;
  }

  public async getCost(dormitoryId: string, requestId: string): Promise<MaintenanceCostEntity | null> {
    return this.costs.find(c => c.dormitoryId === dormitoryId && c.maintenanceRequestId === requestId) || null;
  }
}
