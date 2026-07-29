export interface DormitoryMemberEntity {
  id: string;
  userId: string;
  dormitoryId: string;
  dormitoryName?: string;
  roleId: string;
  roleCode?: string;
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
      status: 'active',
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
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
      roleCode: data.roleCode || 'OWNER',
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
