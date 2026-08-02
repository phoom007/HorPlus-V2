import { PrismaClient } from '@prisma/client';

export interface SessionEntity {
  id: string;
  userId: string;
  sessionIdHash: string;
  tokenVersion: number;
  status: 'active' | 'revoked' | 'expired';
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  userAgentHash?: string | null;
  ipMetadata?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionData {
  userId: string;
  sessionIdHash: string;
  expiresAt: Date;
  userAgentHash?: string;
  ipMetadata?: string;
  tokenVersion?: number;
}

export interface ISessionRepository {
  createSession(data: CreateSessionData): Promise<SessionEntity>;
  findBySessionIdHash(hash: string): Promise<SessionEntity | null>;
  revokeSession(id: string, reason?: string): Promise<SessionEntity | null>;
  revokeAllUserSessions(userId: string, reason?: string): Promise<number>;
  updateLastSeen(id: string): Promise<void>;
}

export class InMemorySessionRepository implements ISessionRepository {
  private sessions: Map<string, SessionEntity> = new Map();

  public async createSession(data: CreateSessionData): Promise<SessionEntity> {
    const now = new Date();
    const session: SessionEntity = {
      id: `sid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId: data.userId,
      sessionIdHash: data.sessionIdHash,
      tokenVersion: data.tokenVersion || 1,
      status: 'active',
      expiresAt: data.expiresAt,
      lastSeenAt: now,
      revokedAt: null,
      revokedReason: null,
      userAgentHash: data.userAgentHash || null,
      ipMetadata: data.ipMetadata || null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  public async findBySessionIdHash(hash: string): Promise<SessionEntity | null> {
    for (const session of this.sessions.values()) {
      if (session.sessionIdHash === hash) {
        if (session.expiresAt < new Date() && session.status === 'active') {
          session.status = 'expired';
        }
        return session;
      }
    }
    return null;
  }

  public async revokeSession(id: string, reason = 'LOGOUT'): Promise<SessionEntity | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    const now = new Date();
    session.status = 'revoked';
    session.revokedAt = now;
    session.revokedReason = reason;
    session.updatedAt = now;
    return session;
  }

  public async revokeAllUserSessions(userId: string, reason = 'LOGOUT_ALL'): Promise<number> {
    let count = 0;
    const now = new Date();
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.status === 'active') {
        session.status = 'revoked';
        session.revokedAt = now;
        session.revokedReason = reason;
        session.updatedAt = now;
        count++;
      }
    }
    return count;
  }

  public async updateLastSeen(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      session.lastSeenAt = new Date();
    }
  }
}

export class PrismaSessionRepository implements ISessionRepository {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private mapToEntity(model: any): SessionEntity {
    return {
      id: model.id,
      userId: model.userId,
      sessionIdHash: model.sessionIdHash,
      tokenVersion: model.tokenVersion,
      status: model.status as any,
      expiresAt: model.expiresAt,
      lastSeenAt: model.lastSeenAt,
      revokedAt: model.revokedAt,
      revokedReason: model.revokedReason,
      userAgentHash: model.userAgentHash,
      ipMetadata: model.ipMetadata,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  public async createSession(data: CreateSessionData): Promise<SessionEntity> {
    const session = await this.prisma.session.create({
      data: {
        userId: data.userId,
        sessionIdHash: data.sessionIdHash,
        expiresAt: data.expiresAt,
        userAgentHash: data.userAgentHash,
        ipMetadata: data.ipMetadata,
        tokenVersion: data.tokenVersion || 1,
        status: 'active',
      },
    });
    return this.mapToEntity(session);
  }

  public async findBySessionIdHash(hash: string): Promise<SessionEntity | null> {
    const session = await this.prisma.session.findUnique({
      where: { sessionIdHash: hash },
    });
    
    if (session) {
      if (session.expiresAt < new Date() && session.status === 'active') {
        const updated = await this.prisma.session.update({
          where: { id: session.id },
          data: { status: 'expired' },
        });
        return this.mapToEntity(updated);
      }
      return this.mapToEntity(session);
    }
    
    return null;
  }

  public async revokeSession(id: string, reason = 'LOGOUT'): Promise<SessionEntity | null> {
    try {
      const updated = await this.prisma.session.update({
        where: { id },
        data: {
          status: 'revoked',
          revokedAt: new Date(),
          revokedReason: reason,
        },
      });
      return this.mapToEntity(updated);
    } catch {
      return null;
    }
  }

  public async revokeAllUserSessions(userId: string, reason = 'LOGOUT_ALL'): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: {
        userId,
        status: 'active',
      },
      data: {
        status: 'revoked',
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
    return result.count;
  }

  public async updateLastSeen(id: string): Promise<void> {
    try {
      await this.prisma.session.update({
        where: { id },
        data: { lastSeenAt: new Date() },
      });
    } catch {}
  }
}

