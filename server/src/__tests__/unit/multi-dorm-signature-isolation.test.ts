/**
 * @license Apache-2.0
 * Multi-Dormitory Signature Isolation Unit Tests (TDD Slice 1)
 */

import { describe, it, expect, vi } from 'vitest';
import { SignatureStorageService } from '../../services/signature-storage.service.js';

describe('TDD Slice 1: Multi-Dormitory Signature Isolation & Deactivation', () => {
  const dormA = '11111111-1111-4000-8000-111111111111';
  const dormB = '22222222-2222-4000-8000-222222222222';
  const userId = '00000000-0000-4000-8000-000000000001';

  it('RED: deactivates signature specifically for dormA while leaving dormB intact', async () => {
    // In-memory store simulating OwnerSignature records
    const records: Array<{
      id: string;
      dormitoryId: string;
      version: number;
      isCurrent: boolean;
      objectKey: string;
    }> = [
      {
        id: 'sig-a',
        dormitoryId: dormA,
        version: 1,
        isCurrent: true,
        objectKey: 'dormitories/dormA/signatures/v1.png',
      },
      {
        id: 'sig-b',
        dormitoryId: dormB,
        version: 1,
        isCurrent: true,
        objectKey: 'dormitories/dormB/signatures/v1.png',
      },
    ];

    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      ownerSignature: {
        updateMany: vi.fn().mockImplementation(async ({ where, data }: any) => {
          let count = 0;
          for (const r of records) {
            if (r.dormitoryId === where.dormitoryId && (where.isCurrent === undefined || r.isCurrent === where.isCurrent)) {
              r.isCurrent = data.isCurrent;
              count++;
            }
          }
          return { count };
        }),
        findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
          return records.find(r => r.dormitoryId === where.dormitoryId && r.isCurrent === where.isCurrent) || null;
        }),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        return await callback(mockTx);
      }),
    } as any;

    const signatureService = new SignatureStorageService(mockPrisma);

    // Call deactivateDormitorySignature for dormA
    const deactivated = await signatureService.deactivateDormitorySignature(dormA);

    expect(deactivated).toBe(true);
    expect(mockTx.$executeRaw).toHaveBeenCalled();

    // Check dormA: current signature should now be null
    const latestA = await signatureService.getLatestSignatureRecord(dormA);
    expect(latestA).toBeNull();

    // Check dormB: current signature MUST STILL BE INTACT!
    const latestB = await signatureService.getLatestSignatureRecord(dormB);
    expect(latestB).not.toBeNull();
    expect(latestB?.dormitoryId).toBe(dormB);
    expect(latestB?.isCurrent).toBe(true);
  });

  it('returns false when deactivating a dormitory with no active signature', async () => {
    const mockTx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      ownerSignature: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const mockPrisma = {
      $transaction: vi.fn().mockImplementation(async (callback: any) => callback(mockTx)),
    } as any;

    const signatureService = new SignatureStorageService(mockPrisma);
    const result = await signatureService.deactivateDormitorySignature(dormA);

    expect(result).toBe(false);
  });
});
