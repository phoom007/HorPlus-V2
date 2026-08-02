import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';


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
      id: crypto.randomUUID(),
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

export class PrismaUserRepository implements IUserRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapToEntity(model: any): UserEntity {
    return {
      id: model.id,
      googleSubject: model.googleSubject,
      email: model.email,
      emailNormalized: model.emailNormalized,
      name: model.name,
      avatarUrl: model.avatarUrl,
      phone: model.phone,
      status: model.status as any,
      lastLoginAt: model.lastLoginAt,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      deletedAt: model.deletedAt,
    };
  }

  public async findByGoogleSubject(googleSubject: string): Promise<UserEntity | null> {
    const user = await this.prisma.user.findUnique({
      where: { googleSubject },
    });
    return user && user.deletedAt === null ? this.mapToEntity(user) : null;
  }

  public async findByEmailNormalized(email: string): Promise<UserEntity | null> {
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized: email.toLowerCase().trim() },
    });
    return user && user.deletedAt === null ? this.mapToEntity(user) : null;
  }

  public async findById(id: string): Promise<UserEntity | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    return user && user.deletedAt === null ? this.mapToEntity(user) : null;
  }

  public async upsertFromGoogle(data: CreateUserData): Promise<UserEntity> {
    const emailNormalized = data.email.toLowerCase().trim();
    
    let existing = await this.findByGoogleSubject(data.googleSubject);
    
    if (!existing) {
      existing = await this.findByEmailNormalized(emailNormalized);
    }

    if (existing) {
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          googleSubject: data.googleSubject,
          name: data.name || existing.name,
          avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : existing.avatarUrl,
          lastLoginAt: new Date(),
        },
      });
      return this.mapToEntity(updated);
    }

    const created = await this.prisma.user.create({
      data: {
        googleSubject: data.googleSubject,
        email: data.email,
        emailNormalized,
        name: data.name,
        avatarUrl: data.avatarUrl,
        phone: data.phone,
        status: 'active',
        lastLoginAt: new Date(),
      },
    });
    return this.mapToEntity(created);
  }

  public async updateStatus(id: string, status: 'active' | 'suspended' | 'deleted'): Promise<UserEntity | null> {
    try {
      const updated = await this.prisma.user.update({
        where: { id },
        data: {
          status,
          deletedAt: status === 'deleted' ? new Date() : null,
        },
      });
      return this.mapToEntity(updated);
    } catch {
      return null;
    }
  }

  public async updateLastLogin(id: string): Promise<void> {
    try {
      await this.prisma.user.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      });
    } catch {}
  }
}

