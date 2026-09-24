/**
 * Card S5: Secure Tenant Claim Lifecycle & Data Sanitization Unit Tests
 * @license Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrismaState } = vi.hoisted(() => {
  const state: any = {
    room: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    dormitoryAccessGrant: {
      findUnique: vi.fn(),
    },
    dormitoryMember: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    role: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    contract: {
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    provisionalRentalTerm: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    occupancy: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    bill: {
      updateMany: vi.fn(),
    },
    tenantRegistrationIntent: {
      updateMany: vi.fn(),
    },
    dormitoryLineFriend: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn().mockImplementation(async (callback: any) => {
      return callback(state);
    }),
  };
  return { mockPrismaState: state };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrismaState,
}));

vi.mock('../../services/signature-storage.service.js', () => ({
  SignatureStorageService: vi.fn().mockImplementation(() => ({
    saveTenantSignature: vi.fn().mockResolvedValue({
      objectKey: 'sig-mock-key',
      sha256: 'mock-sha',
      mimeType: 'image/png',
      byteSize: 100,
    }),
  })),
}));

import {
  TenantRegistrationService,
  generateClaimVerificationToken,
  verifyClaimVerificationToken,
} from '../../services/tenant-registration.service.js';
import { maskThaiCandidateName } from '../../utils/thai-identity.util.js';

describe('Card S5: Tenant Claim Security & Lifecycle', () => {
  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';
  const mockRoomId = '30000001-0000-4000-8000-000000000101';
  const mockTenantId = '40000001-0000-4000-8000-000000000001';

  const mockRoom = {
    id: mockRoomId,
    dormitoryId: mockDormitoryId,
    roomNumber: '101',
    floor: 1,
    status: 'vacant',
    monthlyRent: '3500',
    depositAmount: '7000',
    currentTenantId: null,
    currentContractId: null,
    deletedAt: null,
  };

  const mockUnlinkedTenant = {
    id: mockTenantId,
    dormitoryId: mockDormitoryId,
    displayName: 'สมชาย ใจดี',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    phone: '0891234567',
    nationalIdMasked: '1-1004-xxxxx-12-3',
    status: 'active',
    lineFriendId: null,
    linkedUserId: null,
    deletedAt: null,
    contracts: [],
    provisionalRentalTerms: [
      {
        id: 'prov-001',
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        tenantId: mockTenantId,
        unitRentAmount: 3500,
        depositAmount: 7000,
        durationMonths: 12,
        rentalType: 'MONTHLY',
        status: 'ACTIVE',
        startDate: '2026-09-01',
        endDate: '2027-08-31',
        deletedAt: null,
      },
    ],
    emergencyContacts: [{ name: 'สมศรี ใจดี', phone: '0897654321', relationship: 'มารดา' }],
    vehicles: [{ type: 'car', licensePlate: 'กข 1234', brand: 'Toyota' }],
    coOccupants: [{ name: 'สมหญิง ใจดี', phone: '0891112222' }],
    petInfo: { hasPet: true, type: 'แมว', name: 'ส้ม', count: 1 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaState.room.findFirst.mockResolvedValue(mockRoom);
    mockPrismaState.tenant.findFirst.mockResolvedValue(mockUnlinkedTenant);
    mockPrismaState.role.findFirst.mockResolvedValue({ id: 'role-01', code: 'TENANT' });
    mockPrismaState.contract.findFirst.mockResolvedValue(null);
    mockPrismaState.contract.count.mockResolvedValue(0);
    mockPrismaState.contract.create.mockResolvedValue({ id: 'ctr-01' });
    mockPrismaState.provisionalRentalTerm.findFirst.mockResolvedValue(mockUnlinkedTenant.provisionalRentalTerms[0]);
    mockPrismaState.provisionalRentalTerm.update.mockResolvedValue({});
    mockPrismaState.occupancy.findFirst.mockResolvedValue(null);
    mockPrismaState.bill.updateMany.mockResolvedValue({ count: 0 });
    mockPrismaState.room.update.mockResolvedValue(mockRoom);
    mockPrismaState.dormitoryLineFriend.findUnique.mockResolvedValue(null);
  });

  describe('Thai Candidate Name Masking (Decision A2)', () => {
    it('masks Thai full name with two characters + *** for each word', () => {
      expect(maskThaiCandidateName('สมชาย ใจดี')).toBe('สม*** ใจ***');
      expect(maskThaiCandidateName('สมชาย')).toBe('สม***');
      expect(maskThaiCandidateName('ก ข')).toBe('ก*** ข***');
      expect(maskThaiCandidateName('')).toBe('');
    });
  });

  describe('S5-3: Verification input length and mismatch rejection', () => {
    it('rejects input with length < 2 characters with Thai error', async () => {
      const service = new TenantRegistrationService();
      await expect(
        service.verifyTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          claimInput: 'ส',
          actorId: 'test-actor-1',
        })
      ).rejects.toThrow('กรุณากรอกชื่อ-นามสกุล หรือเบอร์โทรศัพท์อย่างน้อย 2 ตัวอักษร');

      await expect(
        service.verifyTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          claimInput: ' ',
          actorId: 'test-actor-1',
        })
      ).rejects.toThrow('กรุณากรอกชื่อ-นามสกุล หรือเบอร์โทรศัพท์อย่างน้อย 2 ตัวอักษร');
    });
  });

  describe('S5-6: Data Minimization in verifyTenantClaim', () => {
    it('returns ONLY safe masked data and NEVER leaks phone, citizenId, emergencyContact, vehicles, coOccupants, pet', async () => {
      const service = new TenantRegistrationService();
      // Match by exact phone
      const result = await service.verifyTenantClaim({
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        claimInput: '0891234567',
        actorId: 'test-actor-2',
      });

      expect(result.verified).toBe(true);
      expect(result.tenantId).toBe(mockTenantId);
      expect(result.maskedName).toBe('สม*** ใจ***');
      expect(result.displayName).toBe('สม*** ใจ***');
      expect(result.room).toEqual({
        id: mockRoomId,
        roomNumber: '101',
        floor: 1,
      });
      expect(result.claimVerificationToken).toBeDefined();

      // STRICT PRIVACY ASSERTIONS: NO PII LEAKAGE
      expect((result as any).phone).toBeUndefined();
      expect((result as any).firstName).toBeUndefined();
      expect((result as any).lastName).toBeUndefined();
      expect((result as any).citizenId).toBeUndefined();
      expect((result as any).emergencyContact).toBeUndefined();
      expect((result as any).vehicles).toBeUndefined();
      expect((result as any).coOccupants).toBeUndefined();
      expect((result as any).pet).toBeUndefined();
    });

    it('matches by name similarity >= 0.90 (Decision A1)', async () => {
      const service = new TenantRegistrationService();
      // "สมชาย ใจดี" input matching stored "สมชาย ใจดี"
      const result = await service.verifyTenantClaim({
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        claimInput: 'สมชาย ใจดี',
        actorId: 'test-actor-3',
      });

      expect(result.verified).toBe(true);
      expect(result.maskedName).toBe('สม*** ใจ***');
    });

    it('rejects claim when neither phone nor name matches >= 0.90', async () => {
      const service = new TenantRegistrationService();
      await expect(
        service.verifyTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          claimInput: 'คนอื่น ไม่ตรง',
          actorId: 'test-actor-4',
        })
      ).rejects.toThrow('ข้อมูลชื่อ-นามสกุล หรือ เบอร์โทรศัพท์ไม่ตรงกับข้อมูลในระบบ');
    });
  });

  describe('S5-5: Claim Verification Token Enforcement in completeTenantClaim', () => {
    const service = new TenantRegistrationService();

    it('rejects completeTenantClaim when claimVerificationToken is missing or empty', async () => {
      await expect(
        service.completeTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          tenantId: mockTenantId,
          signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          claimVerificationToken: '',
        })
      ).rejects.toThrow('ต้องระบุรหัสยืนยันการรับสิทธิ์ (claimVerificationToken)');
    });

    it('rejects completeTenantClaim when token signature or payload mismatch', async () => {
      const invalidToken = 'fake.token.value';
      await expect(
        service.completeTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          tenantId: mockTenantId,
          signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          claimVerificationToken: invalidToken,
        })
      ).rejects.toThrow();
    });

    it('rejects completeTenantClaim when token matches different roomId', async () => {
      const otherRoomToken = generateClaimVerificationToken({
        dormitoryId: mockDormitoryId,
        roomId: '30000001-0000-4000-8000-000000000999',
        tenantId: mockTenantId,
      });

      await expect(
        service.completeTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          tenantId: mockTenantId,
          signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          claimVerificationToken: otherRoomToken,
        })
      ).rejects.toThrow('รหัสยืนยันการรับสิทธิ์ไม่ตรงกับข้อมูลห้องพักหรือผู้เช่า');
    });
  });

  describe('S5-4: Rejection of Already-Claimed Tenant (409 Conflict)', () => {
    it('throws 409 TENANT_ALREADY_CLAIMED if tenant already has lineFriendId or linkedUserId', async () => {
      const validToken = generateClaimVerificationToken({
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        tenantId: mockTenantId,
      });

      const alreadyClaimedTenant = {
        ...mockUnlinkedTenant,
        lineFriendId: 'line-friend-already-claimed',
        occupancies: [{ roomId: mockRoomId, status: 'ACTIVE' }],
      };

      mockPrismaState.tenant.findFirst.mockResolvedValue(alreadyClaimedTenant);

      const service = new TenantRegistrationService();
      await expect(
        service.completeTenantClaim({
          dormitoryId: mockDormitoryId,
          roomId: mockRoomId,
          tenantId: mockTenantId,
          signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          claimVerificationToken: validToken,
        })
      ).rejects.toThrow('ผู้เช่าท่านนี้ได้รับการผูกสิทธิ์บัญชีหรือ LINE เรียบร้อยแล้ว');
    });
  });

  describe('UUID Safety: Non-UUID LINE Session actorUserId handling', () => {
    it('does NOT write non-UUID ag_user_... to linkedUserId and resolves lineFriendId from grant', async () => {
      const validToken = generateClaimVerificationToken({
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        tenantId: mockTenantId,
      });

      const mockGrant = {
        id: '22222222-3333-4444-5555-666666666666',
        lineFriendId: 'line-friend-from-grant-01',
      };

      let updatedTenantData: any = null;
      let createdMemberData: any = null;

      mockPrismaState.tenant.findFirst.mockResolvedValue({
        ...mockUnlinkedTenant,
        occupancies: [{ roomId: mockRoomId, status: 'ACTIVE' }],
      });
      mockPrismaState.tenant.update.mockImplementation(({ data }: any) => {
        updatedTenantData = data;
        return { ...mockUnlinkedTenant, ...data };
      });
      mockPrismaState.dormitoryAccessGrant.findUnique.mockResolvedValue(mockGrant);
      mockPrismaState.dormitoryMember.findFirst.mockResolvedValue(null);
      mockPrismaState.dormitoryMember.create.mockImplementation(({ data }: any) => {
        createdMemberData = data;
        return data;
      });

      const service = new TenantRegistrationService();
      const result = await service.completeTenantClaim({
        dormitoryId: mockDormitoryId,
        roomId: mockRoomId,
        tenantId: mockTenantId,
        signatureBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        claimVerificationToken: validToken,
        actorUserId: 'ag_user_22222222-3333-4444-5555-666666666666',
      });

      expect(result.success).toBe(true);
      // linkedUserId MUST NOT be set to non-UUID ag_user_...
      expect(updatedTenantData.linkedUserId).toBeUndefined();
      // lineFriendId MUST be resolved and linked from grant
      expect(updatedTenantData.lineFriendId).toBe('line-friend-from-grant-01');
      // DormitoryMember MUST NOT be created for non-UUID actor
      expect(createdMemberData).toBeNull();
    });
  });
});
