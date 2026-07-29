export interface RolePermissions {
  [module: string]: string[];
}

export interface RoleEntity {
  id: string;
  dormitoryId?: string | null;
  code: 'OWNER' | 'MANAGER' | 'FINANCE' | 'STAFF' | 'TECH' | string;
  name: string;
  permissions: RolePermissions;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRoleRepository {
  findById(id: string): Promise<RoleEntity | null>;
  findByCode(code: string, dormitoryId?: string): Promise<RoleEntity | null>;
  findByDormitoryAndCode(dormitoryId: string, code: string): Promise<RoleEntity | null>;
  createSystemRole(dormitoryId: string, code: string, name: string, permissions: RolePermissions): Promise<RoleEntity>;
  getSystemRoles(): Promise<RoleEntity[]>;
}

export class InMemoryRoleRepository implements IRoleRepository {
  private roles: Map<string, RoleEntity> = new Map();

  constructor() {
    this.seedSystemRoles();
  }

  private seedSystemRoles(): void {
    const systemRoles: RoleEntity[] = [
      {
        id: 'role-owner',
        dormitoryId: null,
        code: 'OWNER',
        name: 'เจ้าของหอพัก',
        permissions: { '*': ['*'] },
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'role-manager',
        dormitoryId: null,
        code: 'MANAGER',
        name: 'ผู้จัดการ',
        permissions: {
          rooms: ['view', 'create', 'update'],
          tenants: ['view', 'create', 'update'],
          contracts: ['view', 'create', 'update'],
          bills: ['view', 'generate'],
          maintenance: ['view', 'update'],
        },
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'role-finance',
        dormitoryId: null,
        code: 'FINANCE',
        name: 'การเงิน',
        permissions: {
          bills: ['view', 'generate', 'update'],
          payments: ['view', 'approve', 'reject'],
          receipts: ['view'],
        },
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'role-staff',
        dormitoryId: null,
        code: 'STAFF',
        name: 'พนักงานทั่วไป',
        permissions: {
          rooms: ['view'],
          tenants: ['view'],
          meters: ['view', 'record'],
          maintenance: ['view', 'update'],
        },
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'role-tech',
        dormitoryId: null,
        code: 'TECH',
        name: 'ช่างเทคนิค',
        permissions: {
          maintenance: ['view', 'update'],
          meters: ['view', 'record'],
        },
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    for (const r of systemRoles) {
      this.roles.set(r.id, r);
    }
  }

  public async findById(id: string): Promise<RoleEntity | null> {
    return this.roles.get(id) || null;
  }

  public async findByCode(code: string, dormitoryId?: string): Promise<RoleEntity | null> {
    for (const role of this.roles.values()) {
      if (role.code === code) {
        if (role.isSystem || role.dormitoryId === dormitoryId) {
          return role;
        }
      }
    }
    return null;
  }

  public async findByDormitoryAndCode(dormitoryId: string, code: string): Promise<RoleEntity | null> {
    return this.findByCode(code, dormitoryId);
  }

  public async createSystemRole(dormitoryId: string, code: string, name: string, permissions: RolePermissions): Promise<RoleEntity> {
    const existing = await this.findByCode(code, dormitoryId);
    if (existing) return existing;

    const now = new Date();
    const role: RoleEntity = {
      id: `role-${code.toLowerCase()}-${dormitoryId}`,
      dormitoryId,
      code,
      name,
      permissions,
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(role.id, role);
    return role;
  }

  public async getSystemRoles(): Promise<RoleEntity[]> {
    return Array.from(this.roles.values()).filter((r) => r.isSystem);
  }
}
