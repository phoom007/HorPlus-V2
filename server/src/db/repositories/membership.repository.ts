import { PrismaClient } from '@prisma/client';

export interface DormitoryMemberEntity {
  id: string;
  userId: string;
  dormitoryId: string;
  dormitoryName?: string;
  dormitoryStatus?: string;
  roleId: string;
  roleCode?: string;
  rolePermissions?: unknown;
  hasLogo?: boolean;
  logoUrl?: string | null;
  status: 'invited' | 'active' | 'suspended' | 'revoked';
  invitedAt?: Date | null;
  acceptedAt?: Date | null;
  suspendedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMembershipData {
  userId: string;
  dormitoryId: string;
  dormitoryName?: string;
  roleId: string;
  roleCode?: string;
  status?: 'invited' | 'active' | 'suspended' | 'revoked';
}

export interface IMembershipRepository {
  findById(id: string): Promise<DormitoryMemberEntity | null>;
  findByUserId(userId: string): Promise<DormitoryMemberEntity[]>;
  findByUserAndDormitory(userId: string, dormitoryId: string): Promise<DormitoryMemberEntity | null>;
  addMembership(data: CreateMembershipData): Promise<DormitoryMemberEntity>;
  updateStatus(id: string, status: DormitoryMemberEntity['status']): Promise<DormitoryMemberEntity | null>;
}

export class InMemoryMembershipRepository implements IMembershipRepository {
  private members: Map<string, DormitoryMemberEntity> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData(): void {
    // Demo seed memberships for test user
    this.members.set('mem-owner-1', {
      id: 'mem-owner-1',
      userId: 'usr-owner-001',
      dormitoryId: 'dorm-001',
      dormitoryName: 'HorPlus Grand Residence',
      roleId: 'role-owner',
      roleCode: 'OWNER',
      rolePermissions: { '*': ['*'] },
      status: 'active',
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  public async findById(id: string): Promise<DormitoryMemberEntity | null> {
    const mem = this.members.get(id);
    return mem && mem.status !== 'revoked' ? mem : null;
  }

  public async findByUserId(userId: string): Promise<DormitoryMemberEntity[]> {
    const list: DormitoryMemberEntity[] = [];
    for (const m of this.members.values()) {
      if (m.userId === userId && m.status !== 'revoked') {
        list.push(m);
      }
    }
    return list;
  }


  public async findByUserAndDormitory(userId: string, dormitoryId: string): Promise<DormitoryMemberEntity | null> {
    for (const m of this.members.values()) {
      if (m.userId === userId && m.dormitoryId === dormitoryId && m.status !== 'revoked') {
        return m;
      }
    }
    return null;
  }

  public async addMembership(data: CreateMembershipData): Promise<DormitoryMemberEntity> {
    const existing = await this.findByUserAndDormitory(data.userId, data.dormitoryId);
    if (existing) return existing;

    const now = new Date();
    const mem: DormitoryMemberEntity = {
      id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: data.userId,
      dormitoryId: data.dormitoryId,
      dormitoryName: data.dormitoryName || 'HorPlus Dormitory',
      roleId: data.roleId,
      roleCode: data.roleCode,
      rolePermissions: (data as any).rolePermissions,
      status: data.status || 'active',
      acceptedAt: data.status === 'active' ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    this.members.set(mem.id, mem);
    return mem;
  }

  public async updateStatus(id: string, status: DormitoryMemberEntity['status']): Promise<DormitoryMemberEntity | null> {
    const mem = this.members.get(id);
    if (!mem) return null;
    mem.status = status;
    mem.updatedAt = new Date();
    if (status === 'suspended') mem.suspendedAt = new Date();
    return mem;
  }
}

export class PrismaMembershipRepository implements IMembershipRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapToEntity(model: any): DormitoryMemberEntity {
    return {
      id: model.id,
      userId: model.userId,
      dormitoryId: model.dormitoryId,
      dormitoryName: model.dormitory?.name,
      dormitoryStatus: model.dormitory?.status,
      roleId: model.roleId,
      roleCode: model.role?.code,
      rolePermissions: model.role?.permissions,
      hasLogo: Boolean((model.dormitory as any)?.logoObjectKey),
      logoUrl: (model.dormitory as any)?.logoObjectKey ? `/api/v1/dormitories/${model.dormitoryId}/logo` : null,
      status: model.status as any,
      invitedAt: model.invitedAt,
      acceptedAt: model.acceptedAt,
      suspendedAt: model.suspendedAt,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  public async findById(id: string): Promise<DormitoryMemberEntity | null> {
    const membership = await this.prisma.dormitoryMember.findUnique({
      where: { id },
      include: {
        dormitory: true,
        role: true,
      },
    });
    return membership && membership.status !== 'revoked' ? this.mapToEntity(membership) : null;
  }

  public async findByUserId(userId: string): Promise<DormitoryMemberEntity[]> {
    const memberships = await this.prisma.dormitoryMember.findMany({
      where: { userId, status: { not: 'revoked' } },
      include: {
        dormitory: true,
        role: true,
      },
    });
    return memberships.map(m => this.mapToEntity(m));
  }

  public async findByUserAndDormitory(userId: string, dormitoryId: string): Promise<DormitoryMemberEntity | null> {
    const membership = await this.prisma.dormitoryMember.findFirst({
      where: { userId, dormitoryId, status: { not: 'revoked' } },
      include: {
        dormitory: true,
        role: true,
      },
    });
    return membership ? this.mapToEntity(membership) : null;
  }

  public async addMembership(data: CreateMembershipData): Promise<DormitoryMemberEntity> {
    const existing = await this.findByUserAndDormitory(data.userId, data.dormitoryId);
    if (existing) return existing;

    const membership = await this.prisma.dormitoryMember.create({
      data: {
        userId: data.userId,
        dormitoryId: data.dormitoryId,
        roleId: data.roleId,
        status: data.status || 'active',
        acceptedAt: (data.status === undefined || data.status === 'active') ? new Date() : null,
      },
      include: {
        dormitory: true,
        role: true,
      },
    });

    return this.mapToEntity(membership);
  }

  public async updateStatus(id: string, status: DormitoryMemberEntity['status']): Promise<DormitoryMemberEntity | null> {
    try {
      const updated = await this.prisma.dormitoryMember.update({
        where: { id },
        data: {
          status,
          suspendedAt: status === 'suspended' ? new Date() : undefined,
        },
        include: {
          dormitory: true,
          role: true,
        },
      });
      return this.mapToEntity(updated);
    } catch {
      return null;
    }
  }
}

