/**
 * @license Apache-2.0
 * Onboarding & Dormitory Provisioning UUID Guard Unit Tests (ORS-01)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DormitoryProvisioningService } from '../../services/dormitory-provisioning.service.js';
import { OnboardingService } from '../../services/onboarding.service.js';
import { sanitizeActorUserIdToUuid } from '../../services/idempotency.service.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Onboarding Provisioning UUID Guard & Non-UUID User Handling (ORS-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('DormitoryProvisioningService.prepareProvisionalDormitory', () => {
    it('sanitizes non-UUID Google user ID to valid UUID in Prisma queries', async () => {
      const googleUserId = 'google-oauth2|103984719284729182374';
      const expectedUuid = sanitizeActorUserIdToUuid(googleUserId);
      expect(UUID_REGEX.test(expectedUuid)).toBe(true);

      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        dormitory: {
          count: vi.fn().mockResolvedValue(0),
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'd0000001-0000-4000-8000-000000000001',
            name: 'หอพักใหม่',
            createdByUserId: expectedUuid,
            status: 'setup_pending',
          }),
        },
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'draft-1' }),
          upsert: vi.fn().mockResolvedValue({ id: 'draft-1' }),
        },
        role: {
          findFirst: vi.fn().mockResolvedValue({ id: 'role-owner-1', code: 'OWNER' }),
        },
        dormitoryMember: {
          create: vi.fn().mockResolvedValue({ id: 'member-1' }),
          upsert: vi.fn().mockResolvedValue({ id: 'member-1' }),
        },
        dormitoryPropertyDefaults: {
          create: vi.fn().mockResolvedValue({ id: 'defaults-1' }),
        },
        dormitoryLineConfig: {
          create: vi.fn().mockResolvedValue({ id: 'line-config-1' }),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      } as any;

      const service = new DormitoryProvisioningService(mockPrisma);
      const result = await service.prepareProvisionalDormitory(googleUserId, { name: 'หอพักทดสอบ' });

      expect(result.provisionalDormitoryId).toBe('d0000001-0000-4000-8000-000000000001');

      // Verify that tx.dormitory.count received the sanitized UUID, NOT the raw google-oauth string!
      expect(mockTx.dormitory.count).toHaveBeenCalledWith({
        where: {
          createdByUserId: expectedUuid,
          status: { in: ['active', 'setup_pending'] },
        },
      });

      // Verify that tx.onboardingDraft.findUnique received the sanitized UUID
      expect(mockTx.onboardingDraft.findUnique).toHaveBeenCalledWith({
        where: { userId: expectedUuid },
      });

      // Verify dormitory.create received sanitized UUID
      expect(mockTx.dormitory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdByUserId: expectedUuid,
          }),
        })
      );
    });

    it('strips ag_user_ prefix and passes standard UUID to Prisma', async () => {
      const grantUuid = 'e985b8c9-7756-4299-88c9-3a85b9e0231b';
      const syntheticUserId = `ag_user_${grantUuid}`;

      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        dormitory: {
          count: vi.fn().mockResolvedValue(1),
          findUnique: vi.fn().mockResolvedValue({
            id: 'd0000002-0000-4000-8000-000000000002',
            status: 'setup_pending',
            lineConfig: null,
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue({
            provisionalDormitoryId: 'd0000002-0000-4000-8000-000000000002',
            finalizedAt: null,
          }),
        },
      };

      const mockPrisma = {
        $transaction: vi.fn().mockImplementation(async (cb) => cb(mockTx)),
      } as any;

      const service = new DormitoryProvisioningService(mockPrisma);
      const result = await service.prepareProvisionalDormitory(syntheticUserId, { name: 'อัปเดตชื่อหอพัก' });

      expect(result.provisionalDormitoryId).toBe('d0000002-0000-4000-8000-000000000002');
      expect(mockTx.dormitory.count).toHaveBeenCalledWith({
        where: {
          createdByUserId: grantUuid,
          status: { in: ['active', 'setup_pending'] },
        },
      });
    });
  });

  describe('OnboardingService UUID Sanitization', () => {
    it('sanitizes rawUserId in getStatus, getDraft, saveDraft, deleteDraft', async () => {
      const rawUser = 'non-uuid-user-12345';
      const expectedUuid = sanitizeActorUserIdToUuid(rawUser);
      expect(UUID_REGEX.test(expectedUuid)).toBe(true);

      const mockPrisma = {
        dormitoryMember: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        onboardingDraft: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ id: 'draft-upsert' }),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        dormitory: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        dormitorySubscription: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      } as any;

      const service = new OnboardingService(mockPrisma);

      // 1. getStatus
      await service.getStatus(rawUser);
      expect(mockPrisma.dormitoryMember.findMany).toHaveBeenCalledWith({
        where: { userId: expectedUuid, status: 'active' },
        include: { dormitory: true },
      });
      expect(mockPrisma.dormitory.findMany).toHaveBeenCalledWith({
        where: {
          createdByUserId: expectedUuid,
          status: { in: ['active', 'setup_pending'] },
        },
      });

      // 2. getDraft
      await service.getDraft(rawUser);
      expect(mockPrisma.onboardingDraft.findUnique).toHaveBeenCalledWith({
        where: { userId: expectedUuid },
      });

      // 3. saveDraft
      await service.saveDraft(rawUser, 'step-1', { foo: 'bar' });
      expect(mockPrisma.onboardingDraft.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: expectedUuid },
          create: expect.objectContaining({ userId: expectedUuid }),
        })
      );

      // 4. deleteDraft
      await service.deleteDraft(rawUser);
      expect(mockPrisma.onboardingDraft.deleteMany).toHaveBeenCalledWith({
        where: { userId: expectedUuid },
      });
    });
  });
});
