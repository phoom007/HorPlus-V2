import crypto from 'crypto';

export interface IdempotencyRecordEntity {
  id: string;
  userId: string;
  operation: string;
  idempotencyKey: string;
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  responseStatus?: number | null;
  responseBody?: any;
  resourceType?: string | null;
  resourceId?: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IIdempotencyRepository {
  find(userId: string, operation: string, idempotencyKey: string): Promise<IdempotencyRecordEntity | null>;
  lock(userId: string, operation: string, idempotencyKey: string, requestHash: string, ttlSeconds?: number): Promise<IdempotencyRecordEntity>;
  complete(id: string, responseStatus: number, responseBody: any, resourceType?: string, resourceId?: string): Promise<IdempotencyRecordEntity>;
  fail(id: string, responseStatus?: number, responseBody?: any): Promise<void>;
}

export class InMemoryIdempotencyRepository implements IIdempotencyRepository {
  private records: Map<string, IdempotencyRecordEntity> = new Map();

  private getKey(userId: string, operation: string, idempotencyKey: string): string {
    return `${userId}:${operation}:${idempotencyKey}`;
  }

  public async find(userId: string, operation: string, idempotencyKey: string): Promise<IdempotencyRecordEntity | null> {
    const key = this.getKey(userId, operation, idempotencyKey);
    const rec = this.records.get(key);
    if (!rec) return null;
    if (rec.expiresAt < new Date()) {
      this.records.delete(key);
      return null;
    }
    return rec;
  }

  public async lock(userId: string, operation: string, idempotencyKey: string, requestHash: string, ttlSeconds = 86400): Promise<IdempotencyRecordEntity> {
    const key = this.getKey(userId, operation, idempotencyKey);
    const existing = await this.find(userId, operation, idempotencyKey);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const record: IdempotencyRecordEntity = {
      id: `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      userId,
      operation,
      idempotencyKey,
      requestHash,
      status: 'processing',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    this.records.set(key, record);
    return record;
  }

  public async complete(id: string, responseStatus: number, responseBody: any, resourceType?: string, resourceId?: string): Promise<IdempotencyRecordEntity> {
    for (const [key, rec] of this.records.entries()) {
      if (rec.id === id) {
        rec.status = 'completed';
        rec.responseStatus = responseStatus;
        rec.responseBody = responseBody;
        rec.resourceType = resourceType || null;
        rec.resourceId = resourceId || null;
        rec.updatedAt = new Date();
        this.records.set(key, rec);
        return rec;
      }
    }
    throw new Error('IDEMPOTENCY_RECORD_NOT_FOUND');
  }

  public async fail(id: string, responseStatus?: number, responseBody?: any): Promise<void> {
    for (const [key, rec] of this.records.entries()) {
      if (rec.id === id) {
        rec.status = 'failed';
        rec.responseStatus = responseStatus || 500;
        rec.responseBody = responseBody || null;
        rec.updatedAt = new Date();
        this.records.set(key, rec);
        return;
      }
    }
  }

  public static hashPayload(payload: any): string {
    const jsonStr = JSON.stringify(payload || {});
    return crypto.createHash('sha256').update(jsonStr).digest('hex');
  }
}
