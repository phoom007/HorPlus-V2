/**
 * @license Apache-2.0
 * Idempotency UUID Guard & Synthetic User Handling Unit Tests (OSA-01)
 */

import { describe, it, expect, vi } from 'vitest';
import { sanitizeActorUserIdToUuid, IdempotencyService } from '../../services/idempotency.service.js';

describe('Idempotency UUID Guard (OSA-01)', () => {
  describe('sanitizeActorUserIdToUuid', () => {
    it('returns empty UUID fallback when input is empty or null', () => {
      expect(sanitizeActorUserIdToUuid('')).toBe('00000000-0000-0000-0000-000000000000');
      expect(sanitizeActorUserIdToUuid(null as any)).toBe('00000000-0000-0000-0000-000000000000');
    });

    it('preserves valid standard UUID as-is', () => {
      const validUuid = '20000002-0000-4000-8000-000000000002';
      expect(sanitizeActorUserIdToUuid(validUuid)).toBe(validUuid);
    });

    it('strips "ag_user_" prefix and returns clean valid UUID', () => {
      const grantUuid = '41fe9480-a0c1-43be-a5c0-6d8fe0dec3c4';
      const syntheticUserId = `ag_user_${grantUuid}`;
      expect(sanitizeActorUserIdToUuid(syntheticUserId)).toBe(grantUuid);
    });

    it('strips "ag_" prefix and returns clean valid UUID', () => {
      const grantUuid = '07fca976-5176-4fa5-bde8-726dee49551e';
      const syntheticSub = `ag_${grantUuid}`;
      expect(sanitizeActorUserIdToUuid(syntheticSub)).toBe(grantUuid);
    });

    it('deterministically maps arbitrary non-UUID string into a valid UUID format', () => {
      const arbitrary = 'some-external-mock-user-12345';
      const result1 = sanitizeActorUserIdToUuid(arbitrary);
      const result2 = sanitizeActorUserIdToUuid(arbitrary);

      expect(result1).toBe(result2);
      expect(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result1)).toBe(true);
    });
  });

  describe('IdempotencyService.runWithIdempotency', () => {
    it('passes sanitized UUID to Prisma queries without P2023 error', async () => {
      const grantUuid = '41fe9480-a0c1-43be-a5c0-6d8fe0dec3c4';
      const syntheticUserId = `ag_user_${grantUuid}`;

      const mockPrisma = {
        idempotencyKey: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'idemp-1' }),
          update: vi.fn().mockResolvedValue({ id: 'idemp-1' }),
        }
      } as any;

      const service = new IdempotencyService(mockPrisma);
      const testFn = vi.fn().mockResolvedValue({ success: true, paymentId: 'pay-123' });

      const result = await service.runWithIdempotency({
        actorUserId: syntheticUserId,
        operation: 'recordCash',
        idempotencyKey: 'test-key-1',
        payload: { billId: 'bill-1', amount: '500' },
        fn: testFn
      });

      expect(result).toEqual({ success: true, paymentId: 'pay-123' });
      expect(testFn).toHaveBeenCalledTimes(1);

      // Verify Prisma findUnique was called with grantUuid (NOT ag_user_...)
      expect(mockPrisma.idempotencyKey.findUnique).toHaveBeenCalledWith({
        where: {
          user_operation_idempotency_unique: {
            userId: grantUuid,
            operation: 'recordCash',
            idempotencyKey: 'test-key-1'
          }
        }
      });

      // Verify Prisma create was called with grantUuid
      expect(mockPrisma.idempotencyKey.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: grantUuid,
            operation: 'recordCash',
            idempotencyKey: 'test-key-1'
          })
        })
      );
    });
  });
});
