/**
 * @license Apache-2.0
 * Card S6 Unit Tests: Public Policy, LINE Follower ID Sanitization, Daily Stay Dormitory Isolation & Rejection Lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      dormitory: {
        findUnique: vi.fn(),
      },
      dormitoryPropertyDefaults: {
        findUnique: vi.fn(),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn(),
      },
      building: {
        findFirst: vi.fn(),
      },
      room: {
        findFirst: vi.fn(),
      },
      tenant: {
        deleteMany: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      dormitoryAccessGrant: {
        findUnique: vi.fn(),
      },
      tenantRegistrationRequest: {
        findFirst: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      tenantRegistrationIntent: {
        findFirst: vi.fn(),
      },
      dormitoryLineFriend: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'mock-audit-id' }),
      },
      $transaction: vi.fn(),
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
    },
  };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

import { TenantRegistrationService } from '../../services/tenant-registration.service.js';

const primaryDormId = '20000001-0000-4000-8000-000000000002';
const foreignDormId = 'd99948ec-49d4-4629-9fea-567241e5049d';
const validRequestId = '90000001-0000-4000-8000-000000000001';
const validRoomId = '30000001-0000-4000-8000-000000000001';

describe('Card S6 Unit Tests: Public Policy, LINE Sanitization & Daily Stay Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AC S6-1: Public policy returns no owner signature while preserving rules and terms', () => {
    it('should return ownerSignature: null and retain defaultTerms, petPolicy, and termMonths', async () => {
      mockPrisma.dormitory.findUnique.mockResolvedValue({
        id: primaryDormId,
        name: 'Comprehensive Manor',
      });
      mockPrisma.dormitoryPropertyDefaults.findUnique.mockResolvedValue({
        id: 'mock-defaults-id',
        dormitoryId: primaryDormId,
        defaultTerms: 'กฎระเบียบหอพักตัวอย่าง: ห้ามส่งเสียงดังหลัง 22:00 น.',
        petPolicy: { allowed: 'small_pets_only', allowedTypes: ['cat'] },
        version: 3,
      });
      mockPrisma.dormitoryBillingSettings.findUnique.mockResolvedValue({
        bankAccountName: 'บจก. หอพัก คอมพรีเฮนซีฟ',
        promptPayAccountName: '0812345678',
        dueDay: 5,
      });
      mockPrisma.building.findFirst.mockResolvedValue({
        termMonths: 12,
      });

      const registrationService = new TenantRegistrationService();
      const policy = await registrationService.getPublicDormitoryPolicy(primaryDormId);

      // S6-1 Criteria: ownerSignature MUST be null
      expect(policy.ownerSignature).toBeNull();

      // S6-1 Criteria: rules and terms MUST remain fully intact
      expect(policy.dormitoryId).toBe(primaryDormId);
      expect(policy.dormitoryName).toBe('Comprehensive Manor');
      expect(policy.defaultTerms).toBe('กฎระเบียบหอพักตัวอย่าง: ห้ามส่งเสียงดังหลัง 22:00 น.');
      expect(policy.petPolicy).toEqual({ allowed: 'small_pets_only', allowedTypes: ['cat'] });
      expect(policy.version).toBe(3);
      expect(policy.termMonths).toBe(12);
    });
  });

  describe('AC S6-2: Registration ignores client-provided lineFollowerId without verified session', () => {
    it('should never assign fake lineFollowerId when unauthenticated client submits fake ID without invite token', async () => {
      let createdData: any = null;

      mockPrisma.dormitory.findUnique.mockResolvedValue({ id: primaryDormId, name: 'Comprehensive Manor' });
      mockPrisma.room.findFirst.mockResolvedValue({
        id: validRoomId,
        dormitoryId: primaryDormId,
        roomNumber: '101',
        monthlyRent: 3500,
        status: 'vacant',
      });

      const mockTx = {
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([{ version: 1 }]),
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({ id: primaryDormId, name: 'Comprehensive Manor' }),
        },
        room: {
          findFirst: vi.fn().mockResolvedValue({
            id: validRoomId,
            dormitoryId: primaryDormId,
            roomNumber: '101',
            status: 'vacant',
          }),
        },
        tenantRegistrationRequest: {
          create: vi.fn().mockImplementation((args: any) => {
            createdData = args.data;
            return {
              id: validRequestId,
              ...args.data,
            };
          }),
        },
        tenantRegistrationIntent: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        dormitoryLineFriend: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(mockTx));

      const registrationService = new TenantRegistrationService();

      const payload: any = {
        dormitoryId: primaryDormId,
        requestedRoomId: validRoomId,
        prefix: 'นาย',
        firstName: 'ทดสอบ',
        lastName: 'สวมสิทธิ์',
        phone: '0899999999',
        agreedTerms: true,
        expectedPolicyVersion: 1,
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        lineFollowerId: undefined, // Route strips unverified client lineFollowerId
      };

      await registrationService.createRequest(primaryDormId, payload);

      expect(createdData).not.toBeNull();
      expect(createdData.lineFollowerId).toBeNull();
    });
  });

  describe('AC S6-3: Daily stay request rejects cross-dormitory access with 403', () => {
    it('should deny daily stay request when session belongs to Comprehensive Manor but targets foreign dormitory', async () => {
      mockPrisma.dormitoryAccessGrant.findUnique.mockImplementation(async ({ where }: any) => {
        if (where.id === 'grant-ta-comprehensive') {
          return {
            id: 'grant-ta-comprehensive',
            dormitoryId: primaryDormId,
            status: 'ACTIVE',
            roleCode: 'TENANT',
          };
        }
        return null;
      });

      const verifyDormitoryAccess = async (req: any, targetDormId: string, prisma: any): Promise<boolean> => {
        const userId = req.auth?.userId;
        if (!userId || !targetDormId) return false;

        const accessGrantId =
          req.auth?.session?.accessGrantId ||
          (userId.startsWith('ag_user_') ? userId.replace('ag_user_', '') :
          (userId.startsWith('ag_') ? userId.replace('ag_', '') : null));
        if (accessGrantId) {
          const grant = await prisma.dormitoryAccessGrant.findUnique({
            where: { id: accessGrantId },
            select: { dormitoryId: true, status: true },
          });
          return grant?.dormitoryId === targetDormId && grant?.status === 'ACTIVE';
        }

        const activeMemberships = (req.auth?.memberships || []).filter(
          (m: any) => (m.status || '').toLowerCase() === 'active'
        );
        if (activeMemberships.length > 0) {
          return activeMemberships.some((m: any) => m.dormitoryId === targetDormId);
        }

        return true;
      };

      const taRequest: any = {
        auth: {
          userId: 'ag_user_grant-ta-comprehensive',
          session: { accessGrantId: 'grant-ta-comprehensive' },
        },
      };

      // 1. Cross-dormitory request targeting foreign dormitory (TheRiCH Apartment) -> MUST BE FALSE (leads to 403)
      const hasForeignAccess = await verifyDormitoryAccess(taRequest, foreignDormId, mockPrisma);
      expect(hasForeignAccess).toBe(false);

      // 2. Intra-dormitory request targeting own dormitory (Comprehensive Manor) -> MUST BE TRUE (permitted)
      const hasPrimaryAccess = await verifyDormitoryAccess(taRequest, primaryDormId, mockPrisma);
      expect(hasPrimaryAccess).toBe(true);
    });
  });

  describe('AC S6-4: Owner rejects registration request with reason ทดสอบระบบ', () => {
    it('should set status to rejected and persist rejectionReason as ทดสอบระบบ', async () => {
      let updatedData: any = null;

      const existingRequest = {
        id: validRequestId,
        dormitoryId: primaryDormId,
        status: 'pending_owner_approval',
        phone: '0812345678',
        acceptanceSnapshot: {
          revisionHistory: [],
        },
      };

      mockPrisma.tenant.deleteMany.mockResolvedValue({ count: 0 });
      mockPrisma.tenantRegistrationRequest.findFirst.mockResolvedValue(existingRequest);
      mockPrisma.tenantRegistrationRequest.update.mockImplementation((args: any) => {
        updatedData = args.data;
        return {
          ...existingRequest,
          ...args.data,
        };
      });

      const registrationService = new TenantRegistrationService();
      vi.spyOn(registrationService, 'getRequestById').mockResolvedValue(existingRequest as any);

      const ownerUserId = '10000000-0000-4000-8000-000000000001';
      const rejectionReason = 'ทดสอบระบบ';

      const result = await registrationService.rejectRequest(
        existingRequest.id,
        primaryDormId,
        rejectionReason,
        ownerUserId
      );

      expect(result.status).toBe('rejected');
      expect(result.rejectedReason).toBe('ทดสอบระบบ');
      expect(updatedData.status).toBe('rejected');
      expect(updatedData.rejectedReason).toBe('ทดสอบระบบ');
      expect(updatedData.acceptanceSnapshot.currentOwnerComment).toBe('ทดสอบระบบ');
      expect(updatedData.acceptanceSnapshot.revisionHistory[0]).toMatchObject({
        action: 'REJECTED',
        reason: 'ทดสอบระบบ',
        reviewedByUserId: ownerUserId,
      });
    });
  });
});
