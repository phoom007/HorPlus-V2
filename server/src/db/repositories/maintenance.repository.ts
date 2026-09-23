import crypto from 'crypto';
import { addDecimals, formatDecimal } from '../../utils/decimal-math.util.js';
import { getPrismaClient } from '../prisma.js';
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
  tenantId?: string | null;
  contractId?: string | null;
  roomId?: string | null;
  category: MaintenanceCategory;
  title: string;
  description: string;
  priority: MaintenancePriority;
  urgency?: 'low' | 'medium' | 'high' | 'emergency';
  status: MaintenanceStatus;
  assignedStaff?: string | null;
  cost?: number | string | null;
  note?: string | null;
  imageBefore?: string | null;
  imageAfter?: string | null;
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
  actorType: 'owner' | 'manager' | 'staff' | 'tech' | 'tenant';
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
  changedByActorType: 'owner' | 'manager' | 'staff' | 'tech' | 'tenant';
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
      imageBefore: data.imageBefore || null,
      imageAfter: data.imageAfter || null,
      assignedStaff: data.assignedStaff || null,
      note: data.note || null,
      cost: data.cost ? Number(data.cost) : 0,
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

  public async findAnywhere(id: string): Promise<MaintenanceRequestEntity | null> {
    return this.requests.find(r => r.id === id && !r.deletedAt) || null;
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
      result = result.filter(r => assignedReqIds.has(r.id) || r.assignedStaff === filters.assignedMemberId);
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

  public getAssignedRequestIds(dormitoryId: string, memberId: string): string[] {
    return this.assignments
      .filter(a => a.dormitoryId === dormitoryId && a.assignedMemberId === memberId && a.status !== 'revoked')
      .map(a => a.maintenanceRequestId);
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

export interface IMaintenanceRepository {
  createRequest(data: any): Promise<MaintenanceRequestEntity>;
  findById(dormitoryId: string, id: string): Promise<MaintenanceRequestEntity | null>;
  findAnywhere?(id: string): Promise<MaintenanceRequestEntity | null>;
  findByTenantId(dormitoryId: string, tenantId: string): Promise<MaintenanceRequestEntity[]>;
  findAll(dormitoryId: string, filters?: MaintenanceFilterQuery): Promise<{ items: MaintenanceRequestEntity[]; total: number }>;
  updateRequest(dormitoryId: string, id: string, updates: Partial<MaintenanceRequestEntity>): Promise<MaintenanceRequestEntity | null>;
  deleteRequest(dormitoryId: string, id: string): Promise<boolean>;
  createAssignment(data: any): Promise<MaintenanceAssignmentEntity>;
  getAssignments(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity[]>;
  getActiveAssignment(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity | null>;
  createUpdate(data: any): Promise<MaintenanceUpdateEntity>;
  getUpdates(dormitoryId: string, requestId: string, isTenant?: boolean): Promise<MaintenanceUpdateEntity[]>;
  createComment(data: any): Promise<MaintenanceCommentEntity>;
  getComments(dormitoryId: string, requestId: string, isTenant?: boolean): Promise<MaintenanceCommentEntity[]>;
  createAttachment(data: any): Promise<MaintenanceAttachmentEntity>;
  getAttachments(dormitoryId: string, requestId: string): Promise<MaintenanceAttachmentEntity[]>;
  recordStatusHistory(data: any): Promise<MaintenanceStatusHistoryEntity>;
  getStatusHistory(dormitoryId: string, requestId: string): Promise<MaintenanceStatusHistoryEntity[]>;
  upsertCost(dormitoryId: string, requestId: string, data: any): Promise<MaintenanceCostEntity>;
  getCost(dormitoryId: string, requestId: string): Promise<MaintenanceCostEntity | null>;
}

function mapPrismaToEntity(row: any): MaintenanceRequestEntity {
  return {
    id: row.id,
    dormitoryId: row.dormitoryId,
    requestNumber: row.requestNumber,
    tenantId: row.tenantId,
    contractId: row.contractId,
    roomId: row.roomId,
    category: row.category as MaintenanceCategory,
    title: row.title,
    description: row.description,
    priority: row.priority as MaintenancePriority,
    urgency: (row.priority === 'urgent' || row.priority === 'high' ? 'high' : row.priority === 'emergency' ? 'emergency' : row.priority === 'low' ? 'low' : 'medium') as any,
    status: row.status as MaintenanceStatus,
    assignedStaff: row.assignedStaff,
    cost: row.cost ? Number(row.cost) : 0,
    note: row.note,
    imageBefore: row.imageBefore,
    imageAfter: row.imageAfter,
    preferredDate: row.preferredDate ? row.preferredDate.toISOString().split('T')[0] : null,
    preferredTimeRange: row.preferredTimeRange,
    createdByUserId: row.createdByUserId,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

const isUuid = (str?: string | null) => !!str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

export class PrismaMaintenanceRepository implements IMaintenanceRepository {
  private fallbackMemory = new InMemoryMaintenanceRepository();

  private get prisma() {
    return getPrismaClient();
  }

  public async createRequest(data: Omit<MaintenanceRequestEntity, 'id' | 'requestNumber' | 'status' | 'version' | 'createdAt' | 'updatedAt'> & { status?: MaintenanceStatus }): Promise<MaintenanceRequestEntity> {
    const now = new Date();
    const count = await this.prisma.maintenanceRequest.count({
      where: { dormitoryId: data.dormitoryId }
    });
    const requestNumber = `MNT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(count + 1).padStart(5, '0')}`;

    const created = await this.prisma.maintenanceRequest.create({
      data: {
        dormitoryId: data.dormitoryId,
        requestNumber,
        tenantId: isUuid(data.tenantId) ? data.tenantId : null,
        contractId: isUuid(data.contractId) ? data.contractId : null,
        roomId: isUuid(data.roomId) ? data.roomId : null,
        category: data.category || 'other',
        title: data.title,
        description: data.description,
        priority: data.priority || 'normal',
        status: data.status || 'submitted',
        assignedStaff: data.assignedStaff || null,
        cost: data.cost !== undefined && data.cost !== null ? Number(data.cost) : 0,
        note: data.note || null,
        imageBefore: data.imageBefore || null,
        imageAfter: data.imageAfter || null,
        preferredDate: data.preferredDate ? new Date(data.preferredDate) : null,
        preferredTimeRange: data.preferredTimeRange || null,
        createdByUserId: isUuid(data.createdByUserId) ? data.createdByUserId : null,
      }
    });

    return mapPrismaToEntity(created);
  }

  public async findById(dormitoryId: string, id: string): Promise<MaintenanceRequestEntity | null> {
    const found = await this.prisma.maintenanceRequest.findFirst({
      where: {
        id,
        dormitoryId,
        deletedAt: null
      }
    });
    return found ? mapPrismaToEntity(found) : null;
  }

  public async findAnywhere(id: string): Promise<MaintenanceRequestEntity | null> {
    const found = await this.prisma.maintenanceRequest.findFirst({
      where: { id, deletedAt: null }
    });
    return found ? mapPrismaToEntity(found) : this.fallbackMemory.findAnywhere(id);
  }

  public async findByTenantId(dormitoryId: string, tenantId: string): Promise<MaintenanceRequestEntity[]> {
    const found = await this.prisma.maintenanceRequest.findMany({
      where: {
        dormitoryId,
        tenantId,
        deletedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });
    return found.map(mapPrismaToEntity);
  }

  public async findAll(dormitoryId: string, filters: MaintenanceFilterQuery = {}): Promise<{ items: MaintenanceRequestEntity[]; total: number }> {
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
    if (filters.category) {
      where.category = filters.category;
    }
    if (filters.roomId) {
      where.roomId = filters.roomId;
    }
    if (filters.tenantId) {
      where.tenantId = filters.tenantId;
    }
    if (filters.assignedMemberId) {
      const assignedReqIds = this.fallbackMemory.getAssignedRequestIds(dormitoryId, filters.assignedMemberId);
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { assignedStaff: filters.assignedMemberId },
            { id: { in: assignedReqIds } }
          ]
        }
      ];
    }
    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { requestNumber: { contains: q, mode: 'insensitive' } }
      ];
    }

    const total = await this.prisma.maintenanceRequest.count({ where });
    const page = filters.page || 1;
    const pageSize = filters.pageSize || 50;
    const skip = (page - 1) * pageSize;

    const items = await this.prisma.maintenanceRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize
    });

    return { items: items.map(mapPrismaToEntity), total };
  }

  public async updateRequest(dormitoryId: string, id: string, updates: Partial<MaintenanceRequestEntity>): Promise<MaintenanceRequestEntity | null> {
    const validFields = [
      'requestNumber', 'tenantId', 'contractId', 'roomId', 'category', 'title',
      'description', 'priority', 'status', 'assignedStaff', 'cost', 'note',
      'imageBefore', 'imageAfter', 'preferredDate', 'preferredTimeRange',
      'createdByUserId', 'resolvedAt', 'closedAt', 'cancelledAt', 'cancellationReason',
      'version', 'deletedAt'
    ];

    const dataToUpdate: any = {
      updatedAt: new Date()
    };

    for (const key of validFields) {
      if (key in updates) {
        dataToUpdate[key] = (updates as any)[key];
      }
    }

    if ('createdByUserId' in updates) {
      dataToUpdate.createdByUserId = isUuid(updates.createdByUserId) ? updates.createdByUserId : null;
    }
    if ('tenantId' in updates) {
      dataToUpdate.tenantId = isUuid(updates.tenantId) ? updates.tenantId : null;
    }
    if ('contractId' in updates) {
      dataToUpdate.contractId = isUuid(updates.contractId) ? updates.contractId : null;
    }
    if ('roomId' in updates) {
      dataToUpdate.roomId = isUuid(updates.roomId) ? updates.roomId : null;
    }

    if (updates.preferredDate) {
      dataToUpdate.preferredDate = new Date(updates.preferredDate);
    }
    if (updates.cost !== undefined) {
      dataToUpdate.cost = Number(updates.cost);
    }

    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data: dataToUpdate
    });

    return mapPrismaToEntity(updated);
  }

  public async deleteRequest(dormitoryId: string, id: string): Promise<boolean> {
    try {
      await this.prisma.maintenanceRequest.update({
        where: { id },
        data: { deletedAt: new Date() }
      });
      return true;
    } catch {
      return false;
    }
  }

  // Auxiliary methods delegate to fallback memory / sub-entities
  public async createAssignment(data: any): Promise<MaintenanceAssignmentEntity> {
    return this.fallbackMemory.createAssignment(data);
  }
  public async getAssignments(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity[]> {
    return this.fallbackMemory.getAssignments(dormitoryId, requestId);
  }
  public async getActiveAssignment(dormitoryId: string, requestId: string): Promise<MaintenanceAssignmentEntity | null> {
    return this.fallbackMemory.getActiveAssignment(dormitoryId, requestId);
  }
  public async createUpdate(data: any): Promise<MaintenanceUpdateEntity> {
    return this.fallbackMemory.createUpdate(data);
  }
  public async getUpdates(dormitoryId: string, requestId: string, isTenant?: boolean): Promise<MaintenanceUpdateEntity[]> {
    return this.fallbackMemory.getUpdates(dormitoryId, requestId, isTenant);
  }
  public async createComment(data: any): Promise<MaintenanceCommentEntity> {
    return this.fallbackMemory.createComment(data);
  }
  public async getComments(dormitoryId: string, requestId: string, isTenant?: boolean): Promise<MaintenanceCommentEntity[]> {
    return this.fallbackMemory.getComments(dormitoryId, requestId, isTenant);
  }
  public async createAttachment(data: any): Promise<MaintenanceAttachmentEntity> {
    return this.fallbackMemory.createAttachment(data);
  }
  public async getAttachments(dormitoryId: string, requestId: string): Promise<MaintenanceAttachmentEntity[]> {
    return this.fallbackMemory.getAttachments(dormitoryId, requestId);
  }
  public async recordStatusHistory(data: any): Promise<MaintenanceStatusHistoryEntity> {
    return this.fallbackMemory.recordStatusHistory(data);
  }
  public async getStatusHistory(dormitoryId: string, requestId: string): Promise<MaintenanceStatusHistoryEntity[]> {
    return this.fallbackMemory.getStatusHistory(dormitoryId, requestId);
  }
  public async upsertCost(dormitoryId: string, requestId: string, data: any): Promise<MaintenanceCostEntity> {
    if (data.totalCost || data.laborCost || data.materialCost || data.otherCost) {
      const total = Number(data.totalCost || data.laborCost || 0);
      await this.prisma.maintenanceRequest.update({
        where: { id: requestId },
        data: { cost: total, note: data.note || undefined }
      }).catch(() => {});
    }
    return this.fallbackMemory.upsertCost(dormitoryId, requestId, data);
  }
  public async getCost(dormitoryId: string, requestId: string): Promise<MaintenanceCostEntity | null> {
    const item = await this.prisma.maintenanceRequest.findUnique({ where: { id: requestId } });
    if (item && item.cost) {
      const costStr = String(item.cost);
      return {
        id: uuidv4(),
        dormitoryId,
        maintenanceRequestId: requestId,
        laborCost: costStr,
        materialCost: '0.00',
        otherCost: '0.00',
        totalCost: costStr,
        note: item.note,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        version: 1
      };
    }
    return this.fallbackMemory.getCost(dormitoryId, requestId);
  }
}

