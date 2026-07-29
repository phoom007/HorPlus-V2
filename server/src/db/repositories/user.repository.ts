export interface UserEntity {
  id: string;
  googleSubject: string;
  email: string;
  emailNormalized: string;
  name: string;
  avatarUrl?: string | null;
  phone?: string | null;
  status: 'active' | 'suspended' | 'deleted';
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface CreateUserData {
  googleSubject: string;
  email: string;
  name: string;
  avatarUrl?: string;
  phone?: string;
}

export interface IUserRepository {
  findByGoogleSubject(googleSubject: string): Promise<UserEntity | null>;
  findByEmailNormalized(email: string): Promise<UserEntity | null>;
  findById(id: string): Promise<UserEntity | null>;
  upsertFromGoogle(data: CreateUserData): Promise<UserEntity>;
  updateStatus(id: string, status: 'active' | 'suspended' | 'deleted'): Promise<UserEntity | null>;
  updateLastLogin(id: string): Promise<void>;
}

export class InMemoryUserRepository implements IUserRepository {
  private users: Map<string, UserEntity> = new Map();

  public async findByGoogleSubject(googleSubject: string): Promise<UserEntity | null> {
    for (const user of this.users.values()) {
      if (user.googleSubject === googleSubject && user.status !== 'deleted') {
        return user;
      }
    }
    return null;
  }

  public async findByEmailNormalized(email: string): Promise<UserEntity | null> {
    const norm = email.toLowerCase().trim();
    for (const user of this.users.values()) {
      if (user.emailNormalized === norm && user.status !== 'deleted') {
        return user;
      }
    }
    return null;
  }

  public async findById(id: string): Promise<UserEntity | null> {
    const user = this.users.get(id);
    if (!user || user.status === 'deleted') return null;
    return user;
  }

  public async upsertFromGoogle(data: CreateUserData): Promise<UserEntity> {
    const norm = data.email.toLowerCase().trim();
    let existing = await this.findByGoogleSubject(data.googleSubject);
    if (!existing) {
      existing = await this.findByEmailNormalized(norm);
    }

    const now = new Date();
    if (existing) {
      const updated: UserEntity = {
        ...existing,
        googleSubject: data.googleSubject,
        name: data.name || existing.name,
        avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : existing.avatarUrl,
        lastLoginAt: now,
        updatedAt: now,
      };
      this.users.set(updated.id, updated);
      return updated;
    }

    const newUser: UserEntity = {
      id: `usr-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      googleSubject: data.googleSubject,
      email: data.email,
      emailNormalized: norm,
      name: data.name,
      avatarUrl: data.avatarUrl || null,
      phone: data.phone || null,
      status: 'active',
      lastLoginAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    this.users.set(newUser.id, newUser);
    return newUser;
  }

  public async updateStatus(id: string, status: 'active' | 'suspended' | 'deleted'): Promise<UserEntity | null> {
    const user = this.users.get(id);
    if (!user) return null;
    const updated: UserEntity = {
      ...user,
      status,
      updatedAt: new Date(),
      deletedAt: status === 'deleted' ? new Date() : user.deletedAt,
    };
    this.users.set(id, updated);
    return updated;
  }

  public async updateLastLogin(id: string): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.lastLoginAt = new Date();
      user.updatedAt = new Date();
    }
  }
}
