import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isRetryableDatabaseError, withDatabaseRetry } from '../db/db-retry.js';
import { Prisma } from '@prisma/client';

describe('Database Startup Retry & Resilient Preflight Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isRetryableDatabaseError', () => {
    it('identifies transient Prisma connection error codes as retryable', () => {
      expect(isRetryableDatabaseError({ code: 'P1001', message: "Can't reach database server" })).toBe(true);
      expect(isRetryableDatabaseError({ code: 'P1002', message: 'Database server reached but timed out' })).toBe(true);
      expect(isRetryableDatabaseError({ code: 'P1008', message: 'Operations timed out' })).toBe(true);
      expect(isRetryableDatabaseError({ code: 'P1017', message: 'Server has closed the connection' })).toBe(true);
    });

    it('identifies system network connection errors as retryable', () => {
      expect(isRetryableDatabaseError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toBe(true);
      expect(isRetryableDatabaseError({ code: 'ECONNRESET', message: 'read ECONNRESET' })).toBe(true);
      expect(isRetryableDatabaseError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' })).toBe(true);
      expect(isRetryableDatabaseError({ cause: { code: 'ECONNREFUSED' }, message: 'Error' })).toBe(true);
    });

    it('identifies transient error message signatures as retryable', () => {
      expect(isRetryableDatabaseError(new Error('connection terminated unexpectedly'))).toBe(true);
      expect(isRetryableDatabaseError(new Error('server has closed the connection'))).toBe(true);
      expect(isRetryableDatabaseError(new Error('socket hang up'))).toBe(true);
    });

    it('rejects authentication failures (P1000) as non-retryable', () => {
      expect(isRetryableDatabaseError({ code: 'P1000', message: 'Authentication failed against database server' })).toBe(false);
    });

    it('rejects Prisma query and constraint violations (P2xxx) as non-retryable', () => {
      expect(isRetryableDatabaseError({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
      expect(isRetryableDatabaseError({ code: 'P2025', message: 'Record to update not found' })).toBe(false);
      expect(isRetryableDatabaseError({ code: 'P2003', message: 'Foreign key constraint failed' })).toBe(false);
    });

    it('rejects general business and validation errors as non-retryable', () => {
      expect(isRetryableDatabaseError(new Error('Validation failed: Invalid room status'))).toBe(false);
      expect(isRetryableDatabaseError(null)).toBe(false);
      expect(isRetryableDatabaseError(undefined)).toBe(false);
    });
  });

  describe('withDatabaseRetry', () => {
    it('succeeds on first attempt if no error occurs', async () => {
      const op = vi.fn().mockResolvedValue('ok');

      const result = await withDatabaseRetry(op, {
        maxAttempts: 3,
        delaysMs: [10, 10],
        operationName: 'test-success',
      });

      expect(result).toBe('ok');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries on transient failure and succeeds on subsequent attempt', async () => {
      const transientErr = new Prisma.PrismaClientKnownRequestError('Server has closed the connection', {
        code: 'P1017',
        clientVersion: '5.22.0',
      });

      const op = vi
        .fn()
        .mockRejectedValueOnce(transientErr)
        .mockRejectedValueOnce(transientErr)
        .mockResolvedValueOnce('recovered');

      const result = await withDatabaseRetry(op, {
        maxAttempts: 5,
        delaysMs: [10, 10, 10, 10],
        operationName: 'test-retry-recover',
      });

      expect(result).toBe('recovered');
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('fails closed when retry attempts are exhausted', async () => {
      const p1017Err = new Prisma.PrismaClientKnownRequestError('Server has closed the connection', {
        code: 'P1017',
        clientVersion: '5.22.0',
      });

      const op = vi.fn().mockRejectedValue(p1017Err);

      await expect(
        withDatabaseRetry(op, {
          maxAttempts: 3,
          delaysMs: [10, 10],
          operationName: 'test-exhaustion',
        })
      ).rejects.toThrow('Server has closed the connection');

      expect(op).toHaveBeenCalledTimes(3);
    });

    it('fails immediately without retrying when non-retryable error occurs', async () => {
      const nonRetryableErr = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
      });

      const op = vi.fn().mockRejectedValue(nonRetryableErr);

      await expect(
        withDatabaseRetry(op, {
          maxAttempts: 5,
          delaysMs: [10, 10, 10, 10],
          operationName: 'test-non-retryable',
        })
      ).rejects.toThrow('Unique constraint failed');

      expect(op).toHaveBeenCalledTimes(1);
    });

    it('retries transient network drops during operational baseline simulation', async () => {
      let callCount = 0;
      const simulateBaseline = async () => {
        callCount++;
        if (callCount < 2) {
          const err: any = new Error('connect ECONNREFUSED 127.0.0.1:5455');
          err.code = 'ECONNREFUSED';
          throw err;
        }
        return { processedDormitories: 2, processedRooms: 22, createdBaselines: 0 };
      };

      const result = await withDatabaseRetry(simulateBaseline, {
        maxAttempts: 5,
        delaysMs: [10, 10, 10, 10],
        operationName: 'baseline-simulation',
      });

      expect(result.processedRooms).toBe(22);
      expect(callCount).toBe(2);
    });
  });
});
