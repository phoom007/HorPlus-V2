import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { AppError } from '../types/index.js';

const prisma = new PrismaClient();

export interface RunWithIdempotencyOptions<T> {
  actorUserId: string;
  operation: string;
  idempotencyKey?: string | null;
  payload: any;
  fn: () => Promise<T>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeActorUserIdToUuid(actorUserId: string): string {
  if (!actorUserId || typeof actorUserId !== 'string') {
    return '00000000-0000-0000-0000-000000000000';
  }
  const stripped = actorUserId.replace(/^ag_user_|^ag_/, '').trim();
  if (UUID_REGEX.test(stripped)) {
    return stripped;
  }
  // Deterministic UUID fallback for arbitrary non-UUID string
  const hash = crypto.createHash('sha256').update(actorUserId).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    '8' + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join('-');
}

export class IdempotencyService {
  constructor(private client: PrismaClient = prisma) {}

  /**
   * Generates a deterministic SHA-256 hash of the request payload
   */
  hashPayload(payload: any): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Executes a business mutation with atomic, persistent idempotency
   */
  async runWithIdempotency<T>(options: RunWithIdempotencyOptions<T>): Promise<T> {
    const { actorUserId, operation, idempotencyKey, payload, fn } = options;

    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
      // Without key, directly execute mutation without idempotency cache
      return await fn();
    }

    const safeActorUserId = sanitizeActorUserIdToUuid(actorUserId);
    const requestHash = this.hashPayload(payload);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours retention

    // 1. Atomic claim attempt
    const existing = await this.client.idempotencyKey.findUnique({
      where: {
        user_operation_idempotency_unique: {
          userId: safeActorUserId,
          operation,
          idempotencyKey
        }
      }
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('IDEMPOTENCY_MISMATCH: Idempotency key payload mismatch.', 409, 'IDEMPOTENCY_MISMATCH');
      }

      if (existing.status === 'completed' && existing.responseBody) {
        // Return cached response without executing underlying mutation
        return existing.responseBody as unknown as T;
      }

      if (existing.status === 'processing') {
        throw new AppError('CONCURRENT_REQUEST_IN_PROGRESS: A request with this idempotency key is already processing.', 409, 'CONCURRENT_REQUEST_IN_PROGRESS');
      }

      // If previously failed, allow clean retry by transitioning to processing
      if (existing.status === 'failed') {
        await this.client.idempotencyKey.update({
          where: { id: existing.id },
          data: {
            status: 'processing',
            requestHash,
            updatedAt: new Date()
          }
        });
      }
    } else {
      // Create new processing claim
      await this.client.idempotencyKey.create({
        data: {
          userId: safeActorUserId,
          operation,
          idempotencyKey,
          requestHash,
          status: 'processing',
          expiresAt
        }
      });
    }

    // 2. Execute mutation
    try {
      const result = await fn();

      // Serialize result safely for Prisma JSON field
      const serializedResult = JSON.parse(JSON.stringify(result));

      await this.client.idempotencyKey.update({
        where: {
          user_operation_idempotency_unique: {
            userId: safeActorUserId,
            operation,
            idempotencyKey
          }
        },
        data: {
          status: 'completed',
          responseStatus: 200,
          responseBody: serializedResult
        }
      });

      return result;
    } catch (err: any) {
      await this.client.idempotencyKey.update({
        where: {
          user_operation_idempotency_unique: {
            userId: safeActorUserId,
            operation,
            idempotencyKey
          }
        },
        data: {
          status: 'failed',
          responseStatus: 400,
          responseBody: { error: err.message || 'Operation failed' }
        }
      });

      throw err;
    }
  }
}

export const idempotencyService = new IdempotencyService();
