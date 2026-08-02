import { getPrismaClient } from '../prisma.js';
// Lazy reference: prisma is only resolved when methods are called, not at module load
function prisma() { return getPrismaClient(); }

import crypto from 'crypto';

export class LineRepository {
  private inMemoryIntegrations = new Map<string, any>();
  private inMemoryIdentities = new Map<string, any>();
  private inMemoryFollowers = new Map<string, any>();
  private inMemoryRoleAssignments = new Map<string, any>();
  private inMemoryRegistrations = new Map<string, any>();
  private inMemoryTenantBindings = new Map<string, any>();
  private inMemoryQuotaCycles = new Map<string, any>();
  private inMemoryDeliveries = new Map<string, any>();
  private inMemoryPreferences = new Map<string, any>();

  // Helper check if model delegate exists on prisma
  private hasModel(modelName: string): boolean {
    return !!(prisma() as any) && typeof (prisma() as any)[modelName] !== 'undefined' && (prisma() as any)[modelName] !== null;
  }

  // --- INTEGRATION ---
  async getIntegrationByDormitory(dormitoryId: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('lineOaIntegration')) {
      return (prisma() as any).lineOaIntegration.findFirst({
        where: { dormitoryId, status: { not: 'disconnected' } },
        orderBy: { createdAt: 'desc' }
      });
    }
    return Array.from(this.inMemoryIntegrations.values()).find(
      i => i.dormitoryId === dormitoryId && i.status !== 'disconnected'
    ) || null;
  }

  async getIntegrationByPublicKey(webhookPublicKey: string) {
    if (this.hasModel('lineOaIntegration')) {
      return (prisma() as any).lineOaIntegration.findUnique({
        where: { webhookPublicKey }
      });
    }
    return Array.from(this.inMemoryIntegrations.values()).find(
      i => i.webhookPublicKey === webhookPublicKey
    ) || null;
  }

  async upsertIntegration(data: any) {
    const existing = await this.getIntegrationByDormitory(data.dormitoryId);
    const webhookPublicKey = data.webhookPublicKey || existing?.webhookPublicKey || `wh_${crypto.randomBytes(32).toString('base64url')}`;
    const webhookKeyHash = data.webhookKeyHash || crypto.createHash('sha256').update(webhookPublicKey).digest('hex');

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.dormitoryId);
    if (isUuid && this.hasModel('lineOaIntegration')) {
      if (existing) {
        return (prisma() as any).lineOaIntegration.update({
          where: { id: existing.id },
          data: {
            messagingChannelId: data.messagingChannelId || data.channelId,
            channelSecretEncrypted: data.channelSecretEncrypted,
            status: data.status || 'connected',
            connectedAt: data.connectedAt || new Date(),
            lastConnectionCheckAt: data.lastConnectionCheckAt || new Date()
          }
        });
      }
      return (prisma() as any).lineOaIntegration.create({
        data: {
          dormitoryId: data.dormitoryId,
          messagingChannelId: data.messagingChannelId || data.channelId,
          channelSecretEncrypted: data.channelSecretEncrypted,
          webhookPublicKey,
          webhookKeyHash,
          status: data.status || 'connected',
          connectedAt: data.connectedAt || new Date()
        }
      });
    }

    const item = {
      id: existing?.id || `integration_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      messagingChannelId: data.messagingChannelId || data.channelId,
      channelSecretEncrypted: data.channelSecretEncrypted,
      webhookPublicKey,
      webhookKeyHash,
      status: data.status || 'connected',
      connectedAt: data.connectedAt || new Date(),
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date()
    };
    this.inMemoryIntegrations.set(item.id, item);
    return item;
  }

  async getFollowerByIdentity(dormitoryId: string, lineIdentityId: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('lineFollower')) {
      return (prisma() as any).lineFollower.findFirst({
        where: { dormitoryId, lineIdentityId },
        include: { identity: true }
      });
    }
    const follower = Array.from(this.inMemoryFollowers.values()).find(
      f => f.dormitoryId === dormitoryId && f.lineIdentityId === lineIdentityId
    );
    if (!follower) return null;
    let identity = await this.findIdentityById(lineIdentityId);
    if (!identity) {
      identity = { id: lineIdentityId, lineUserId: `user_${lineIdentityId}`, displayName: 'Tenant User' };
    }
    return { ...follower, identity };
  }

  async findIdentityById(id: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
    if (isUuid && this.hasModel('lineIdentity')) {
      return (prisma() as any).lineIdentity.findUnique({ where: { id } });
    }
    return Array.from(this.inMemoryIdentities.values()).find(i => i.id === id) || null;
  }

  async upsertFollower(data: any) {
    const friendStatus = data.friendStatus || 'following';
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.dormitoryId);
    if (isUuid && this.hasModel('lineFollower')) {
      const existing = await (prisma() as any).lineFollower.findUnique({
        where: { dormitory_line_identity_unique: { dormitoryId: data.dormitoryId, lineIdentityId: data.lineIdentityId } }
      });
      if (existing) {
        return (prisma() as any).lineFollower.update({
          where: { id: existing.id },
          data: { friendStatus, followedAt: friendStatus === 'following' ? new Date() : existing.followedAt },
          include: { identity: true }
        });
      }
      return (prisma() as any).lineFollower.create({
        data: { dormitoryId: data.dormitoryId, lineOaIntegrationId: data.lineOaIntegrationId || 'opt', lineIdentityId: data.lineIdentityId, friendStatus, followedAt: new Date() },
        include: { identity: true }
      });
    }

    const existing = Array.from(this.inMemoryFollowers.values()).find(
      f => f.dormitoryId === data.dormitoryId && f.lineIdentityId === data.lineIdentityId
    );
    const item = {
      id: existing?.id || `follower_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      lineOaIntegrationId: data.lineOaIntegrationId || 'opt',
      lineIdentityId: data.lineIdentityId,
      friendStatus,
      followedAt: existing?.followedAt || new Date(),
      createdAt: existing?.createdAt || new Date(),
      updatedAt: new Date()
    };
    this.inMemoryFollowers.set(item.id, item);
    const identity = await this.findIdentityById(data.lineIdentityId) || { id: data.lineIdentityId, lineUserId: `user_${data.lineIdentityId}`, displayName: 'User' };
    return { ...item, identity };
  }

  // --- TENANT LINE BINDING ---
  async getTenantBindingForTenant(dormitoryId: string, tenantId: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('tenantLineBinding')) {
      return (prisma() as any).tenantLineBinding.findFirst({
        where: { dormitoryId, tenantId, status: 'active' },
        include: { identity: true }
      });
    }
    const binding = Array.from(this.inMemoryTenantBindings.values()).find(
      b => b.dormitoryId === dormitoryId && b.tenantId === tenantId && b.status === 'active'
    );
    if (!binding) return null;
    const identity = await this.findIdentityById(binding.lineIdentityId);
    return { ...binding, identity };
  }

  async listTenantBindingsForDormitory(dormitoryId: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('tenantLineBinding')) {
      return (prisma() as any).tenantLineBinding.findMany({
        where: { dormitoryId, status: 'active' },
        include: { identity: true }
      });
    }
    return Array.from(this.inMemoryTenantBindings.values()).filter(
      b => b.dormitoryId === dormitoryId && b.status === 'active'
    );
  }

  async upsertTenantBinding(data: any) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.dormitoryId);
    if (isUuid && this.hasModel('tenantLineBinding')) {
      return (prisma() as any).tenantLineBinding.create({
        data: {
          dormitoryId: data.dormitoryId,
          tenantId: data.tenantId,
          contractId: data.contractId || 'contract_opt',
          roomId: data.roomId || 'room_opt',
          lineIdentityId: data.lineIdentityId,
          status: data.status || 'active',
          approvedAt: new Date()
        }
      });
    }
    const item = {
      id: `binding_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      tenantId: data.tenantId,
      contractId: data.contractId || 'contract_opt',
      roomId: data.roomId || 'room_opt',
      lineIdentityId: data.lineIdentityId,
      status: data.status || 'active',
      approvedAt: new Date(),
      createdAt: new Date()
    };
    this.inMemoryTenantBindings.set(item.id, item);
    return item;
  }

  // --- QUOTA CYCLE ---
  async getOrCreateCurrentQuotaCycle(dormitoryId: string, year: number, month: number, quotaLimit = 300) {
    const cycleMonth = `${year}-${String(month).padStart(2, '0')}`;
    let cycle = await this.getQuotaCycle(dormitoryId, cycleMonth);
    if (!cycle) {
      cycle = await this.createQuotaCycle({
        dormitoryId,
        cycleMonth,
        allocatedLimit: quotaLimit,
        usedCount: 0,
        paidPackageName: 'FREE'
      });
    }
    return {
      id: cycle.id,
      dormitoryId: cycle.dormitoryId,
      year,
      month,
      quotaLimit: cycle.allocatedLimit,
      successfulSendCount: cycle.usedCount,
      periodStart: new Date(year, month - 1, 1),
      periodEnd: new Date(year, month, 0)
    };
  }
  async getQuotaCycle(dormitoryId: string, cycleMonth: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('lineMessageQuotaCycle')) {
      return (prisma() as any).lineMessageQuotaCycle.findFirst({
        where: { dormitoryId, cycleMonth }
      });
    }
    const list = Array.from(this.inMemoryQuotaCycles.values()).filter(
      q => q.dormitoryId === dormitoryId && q.cycleMonth === cycleMonth
    );
    return list[list.length - 1] || null;
  }

  async getCurrentQuotaCycle(dormitoryId: string) {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let cycle = await this.getQuotaCycle(dormitoryId, month);
    if (!cycle) {
      cycle = await this.createQuotaCycle({
        dormitoryId,
        cycleMonth: month,
        allocatedLimit: 300,
        usedCount: 0,
        paidPackageName: 'FREE'
      });
    }
    return cycle;
  }

  async createQuotaCycle(data: any) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.dormitoryId);
    if (isUuid && this.hasModel('lineMessageQuotaCycle')) {
      return (prisma() as any).lineMessageQuotaCycle.create({
        data: {
          dormitoryId: data.dormitoryId,
          cycleMonth: data.cycleMonth,
          allocatedLimit: data.allocatedLimit || 300,
          usedCount: data.usedCount || 0,
          paidPackageName: data.paidPackageName || 'FREE'
        }
      });
    }

    const item = {
      id: `cycle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      cycleMonth: data.cycleMonth,
      allocatedLimit: data.allocatedLimit ?? 300,
      usedCount: data.usedCount ?? 0,
      paidPackageName: data.paidPackageName || 'FREE',
      createdAt: new Date()
    };
    this.inMemoryQuotaCycles.set(item.id, item);
    return item;
  }

  async incrementQuotaUsage(cycleId: string, count = 1) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cycleId);
    if (isUuid && this.hasModel('lineMessageQuotaCycle')) {
      return (prisma() as any).lineMessageQuotaCycle.update({
        where: { id: cycleId },
        data: { successfulSendCount: { increment: count } }
      });
    }
    const cycle = this.inMemoryQuotaCycles.get(cycleId) || Array.from(this.inMemoryQuotaCycles.values()).find(c => c.id === cycleId);
    if (cycle) {
      cycle.usedCount = (cycle.usedCount || 0) + count;
      this.inMemoryQuotaCycles.set(cycle.id, cycle);
    }
    return cycle;
  }

  async consumeQuotaUnit(dormitoryId: string, count = 1) {
    const cycle = await this.getCurrentQuotaCycle(dormitoryId);
    const newUsed = (cycle.usedCount || 0) + count;
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cycle.id);

    if (isUuid && this.hasModel('lineMessageQuotaCycle')) {
      return (prisma() as any).lineMessageQuotaCycle.update({
        where: { id: cycle.id },
        data: { successfulSendCount: newUsed }
      });
    }

    cycle.usedCount = newUsed;
    this.inMemoryQuotaCycles.set(cycle.id, cycle);
    return cycle;
  }

  // --- NOTIFICATION PREFERENCES ---
  async getNotificationPreferences(dormitoryId: string) {
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('lineNotificationPreference')) {
      return (prisma() as any).lineNotificationPreference.findUnique({
        where: { dormitoryId }
      });
    }
    return this.inMemoryPreferences.get(dormitoryId) || null;
  }

  async upsertNotificationPreferences(data: any) {
    const dormitoryId = data.dormitoryId;
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dormitoryId);
    if (isUuid && this.hasModel('lineNotificationPreference')) {
      return (prisma() as any).lineNotificationPreference.upsert({
        where: { dormitoryId },
        update: data,
        create: data
      });
    }
    const existing = this.inMemoryPreferences.get(dormitoryId) || { dormitoryId };
    const updated = { ...existing, ...data };
    this.inMemoryPreferences.set(dormitoryId, updated);
    return updated;
  }

  // --- ROLE ASSIGNMENTS ---
  async listRoleAssignments(dormitoryId: string) {
    if (this.hasModel('lineRoleAssignment')) {
      return (prisma() as any).lineRoleAssignment.findMany({
        where: { dormitoryId, status: 'active' },
        include: { identity: true }
      });
    }
    return Array.from(this.inMemoryRoleAssignments.values()).filter(
      r => r.dormitoryId === dormitoryId && r.status === 'active'
    );
  }

  async listRoleAssignmentsForIdentity(lineIdentityId: string) {
    if (this.hasModel('lineRoleAssignment')) {
      return (prisma() as any).lineRoleAssignment.findMany({
        where: { lineIdentityId, status: 'active' },
        include: { identity: true }
      });
    }
    return Array.from(this.inMemoryRoleAssignments.values()).filter(
      r => r.lineIdentityId === lineIdentityId && r.status === 'active'
    );
  }

  async listTenantBindingsForIdentity(lineIdentityId: string) {
    if (this.hasModel('tenantLineBinding')) {
      return (prisma() as any).tenantLineBinding.findMany({
        where: { lineIdentityId, status: 'active' },
        include: { identity: true }
      });
    }
    return Array.from(this.inMemoryTenantBindings.values()).filter(
      b => b.lineIdentityId === lineIdentityId && b.status === 'active'
    );
  }

  async getPendingRegistrationForIdentity(lineIdentityId: string) {
    const isUuid = typeof lineIdentityId === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(lineIdentityId);
    if (isUuid && this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.findFirst({
        where: {
          lineIdentityId,
          status: { in: ['pending_owner_approval', 'correction_required'] }
        }
      });
    }
    return Array.from(this.inMemoryRegistrations.values()).find(
      r => r.lineIdentityId === lineIdentityId && (r.status === 'pending' || r.status === 'pending_owner_approval' || r.status === 'correction_required')
    ) || null;
  }

  async getTenantBindingForIdentity(lineIdentityId: string) {
    return Array.from(this.inMemoryTenantBindings.values()).find(
      b => b.lineIdentityId === lineIdentityId && b.status === 'active'
    ) || null;
  }

  async getFollowers(dormitoryId: string) {
    return Array.from(this.inMemoryFollowers.values()).filter(
      f => f.dormitoryId === dormitoryId && f.friendStatus === 'following'
    );
  }

  async getFollowerById(id: string) {
    return this.inMemoryFollowers.get(id) || Array.from(this.inMemoryFollowers.values()).find(f => f.id === id) || null;
  }

  async upsertRoleAssignment(data: any) {
    const item = {
      id: `role_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      dormitoryId: data.dormitoryId,
      lineIdentityId: data.lineIdentityId,
      roleCode: data.roleCode,
      assignedByUserId: data.assignedByUserId,
      status: data.status || 'active',
      createdAt: new Date()
    };
    this.inMemoryRoleAssignments.set(item.id, item);
    return item;
  }

  async revokeRoleAssignment(dormitoryId: string, roleAssignmentId: string) {
    const item = this.inMemoryRoleAssignments.get(roleAssignmentId);
    if (item && item.dormitoryId === dormitoryId) {
      item.status = 'revoked';
      this.inMemoryRoleAssignments.set(item.id, item);
    }
    return item;
  }

  async createOutboxAndDelivery(data: any) {
    const item = {
      id: `del_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...data,
      status: 'pending',
      createdAt: new Date()
    };
    this.inMemoryDeliveries.set(item.id, item);
    return item;
  }

  async markDeliverySuccess(id: string, metadata?: any) {
    const item = this.inMemoryDeliveries.get(id);
    if (item) {
      item.status = 'sent';
      item.sentAt = new Date();
      if (metadata) item.metadata = metadata;
    }
    return item;
  }

  async markDeliveryFailed(id: string, error?: any) {
    const item = this.inMemoryDeliveries.get(id);
    if (item) {
      item.status = 'failed';
      item.failedAt = new Date();
      item.errorReason = error?.message || String(error);
    }
    return item;
  }

  async createOrUpdateRegistrationDraft(data: any) {
    const isUuid = typeof data.dormitoryId === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(data.dormitoryId);
    if (isUuid && this.hasModel('tenantRegistrationRequest')) {
      const existing = await this.getPendingRegistrationForIdentity(data.lineIdentityId);
      if (existing) {
        return (prisma() as any).tenantRegistrationRequest.update({
          where: { id: existing.id },
          data: {
            dormitoryId: data.dormitoryId,
            requestedRoomId: data.requestedRoomId,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone,
            note: data.note || null,
            status: 'pending_owner_approval',
            version: { increment: 1 },
            submittedAt: new Date()
          }
        });
      }
      return (prisma() as any).tenantRegistrationRequest.create({
        data: {
          dormitoryId: data.dormitoryId,
          lineIdentityId: data.lineIdentityId,
          lineFollowerId: data.lineFollowerId || null,
          requestedRoomId: data.requestedRoomId,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone,
          note: data.note || null,
          status: 'pending_owner_approval',
          submittedAt: new Date()
        }
      });
    }

    const existing = await this.getPendingRegistrationForIdentity(data.lineIdentityId);
    const item = {
      id: existing?.id || `reg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      status: 'pending_owner_approval',
      ...existing,
      ...data,
      updatedAt: new Date()
    };
    this.inMemoryRegistrations.set(item.id, item);
    return item;
  }

  async listRegistrationRequests(dormitoryId: string) {
    if (this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.findMany({
        where: { dormitoryId },
        include: { identity: true, follower: true },
        orderBy: { createdAt: 'desc' }
      });
    }
    return Array.from(this.inMemoryRegistrations.values()).filter(
      r => r.dormitoryId === dormitoryId
    );
  }

  async findRegistrationById(id: string) {
    const isUuid = typeof id === 'string' && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
    if (isUuid && this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.findUnique({
        where: { id },
        include: { identity: true }
      });
    }
    return this.inMemoryRegistrations.get(id) || Array.from(this.inMemoryRegistrations.values()).find(r => r.id === id) || null;
  }

  async createTenantBinding(data: any) {
    return this.upsertTenantBinding(data);
  }

  async requestCorrectionRegistrationRequest(id: string, reviewedByUserId: string, reason: string) {
    if (this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'correction_required',
          reviewedByUserId,
          rejectedReason: reason,
          reviewedAt: new Date()
        }
      });
    }
    const reg = await this.findRegistrationById(id);
    if (reg) {
      reg.status = 'correction_required';
      reg.reviewedByUserId = reviewedByUserId;
      reg.rejectedReason = reason;
      reg.reviewedAt = new Date();
    }
    return reg;
  }

  async approveRegistrationRequest(id: string, approvedByUserId: string) {
    if (this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'approved',
          reviewedByUserId: approvedByUserId,
          reviewedAt: new Date()
        }
      });
    }
    const reg = await this.findRegistrationById(id);
    if (reg) {
      reg.status = 'approved';
      reg.approvedByUserId = approvedByUserId;
      reg.approvedAt = new Date();
    }
    return reg;
  }

  async rejectRegistrationRequest(id: string, rejectedByUserId: string, reason?: string) {
    if (this.hasModel('tenantRegistrationRequest')) {
      return (prisma() as any).tenantRegistrationRequest.update({
        where: { id },
        data: {
          status: 'rejected',
          reviewedByUserId: rejectedByUserId,
          rejectedReason: reason,
          reviewedAt: new Date()
        }
      });
    }
    const reg = await this.findRegistrationById(id);
    if (reg) {
      reg.status = 'rejected';
      reg.rejectedByUserId = rejectedByUserId;
      reg.rejectedReason = reason;
      reg.reviewedAt = new Date();
    }
    return reg;
  }
  async updateIntegrationStatus(id: string, status: string) {
    if (this.hasModel('lineOaIntegration')) {
      return (prisma() as any).lineOaIntegration.update({ where: { id }, data: { status } });
    }
    const item = this.inMemoryIntegrations.get(id);
    if (item) {
      item.status = status;
      this.inMemoryIntegrations.set(id, item);
    }
    return item;
  }

  async disconnectIntegration(id: string) {
    return this.updateIntegrationStatus(id, 'disconnected');
  }

  async upsertLineIdentity(lineUserId: string, profile: any) {
    if (this.hasModel('lineIdentity')) {
      return (prisma() as any).lineIdentity.upsert({
        where: { lineUserId },
        update: { displayName: profile.displayName, pictureUrl: profile.pictureUrl },
        create: { lineUserId, displayName: profile.displayName, pictureUrl: profile.pictureUrl }
      });
    }
    let identity = Array.from(this.inMemoryIdentities.values()).find(i => i.lineUserId === lineUserId);
    if (identity) {
      identity.displayName = profile.displayName;
      identity.pictureUrl = profile.pictureUrl;
    } else {
      identity = {
        id: `id_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        lineUserId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        createdAt: new Date()
      };
      this.inMemoryIdentities.set(identity.id, identity);
    }
    return identity;
  }

  async recordWebhookAudit(data: any) {
    // Dummy stub
    return data;
  }

  async updateLastWebhookTimestamp(integrationId: string, timestamp: Date) {
    // Dummy stub
    return true;
  }

  async hasProcessedWebhookEvent(eventId: string) {
    // Dummy stub
    return false;
  }

  async recordWebhookEvent(data: any) {
    // Dummy stub
    return data;
  }
  
  async listDeliveries(dormitoryId: string, limit: number = 100) {
    return Array.from(this.inMemoryDeliveries.values()).filter(d => d.dormitoryId === dormitoryId).slice(0, limit);
  }
}

export const lineRepository = new LineRepository();
