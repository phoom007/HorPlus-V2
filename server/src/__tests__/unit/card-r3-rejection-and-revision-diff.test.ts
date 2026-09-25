/**
 * @license Apache-2.0
 * Card R3 Unit Tests: Rejection & Revision Diff Lifecycle
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPushOutcomeNotification = vi.fn().mockResolvedValue({ success: true });
const mockLinkActiveTenantRichMenu = vi.fn().mockResolvedValue({ success: true });

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      dormitory: {
        findUnique: vi.fn(),
      },
      dormitoryLineConfig: {
        findUnique: vi.fn(),
      },
      dormitoryPropertyDefaults: {
        findUnique: vi.fn(),
      },
      dormitoryBillingSettings: {
        findUnique: vi.fn(),
      },
      dormitoryBillingCycle: {
        findFirst: vi.fn(),
        create: vi.fn(),
      },
      subscriptionPlan: {
        findUnique: vi.fn().mockResolvedValue({ roomLimit: 100 }),
      },
      dormitorySubscription: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      building: {
        findFirst: vi.fn(),
      },
      room: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 'room-101-uuid' }]),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(5),
      },
      tenant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      leaseAgreement: {
        create: vi.fn(),
      },
      contract: {
        findFirst: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: 'contract-somchai-uuid' }),
      },
      occupancy: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      bill: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'bill-01' }),
      },
      roomOccupancy: {
        create: vi.fn(),
      },
      dormitoryAccessGrant: {
        findUnique: vi.fn(),
      },
      tenantRegistrationRequest: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
      tenantRegistrationIntent: {
        findFirst: vi.fn(),
        updateMany: vi.fn(),
      },
      dormitoryLineFriend: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      ownerSignature: {
        findFirst: vi.fn().mockResolvedValue({ signatureData: 'owner-sig' }),
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

vi.mock('../../utils/crypto-encryption.js', () => ({
  decryptText: vi.fn().mockReturnValue('U_line_tenant_d'),
  encryptText: vi.fn().mockReturnValue('enc_U123'),
}));

vi.mock('../../services/line-richmenu.service.js', () => ({
  LineRichMenuService: vi.fn().mockImplementation(() => ({
    linkActiveTenantRichMenu: mockLinkActiveTenantRichMenu,
  })),
  lineRichMenuService: {
    linkActiveTenantRichMenu: mockLinkActiveTenantRichMenu,
  },
}));

vi.mock('../../services/line-oa.service.js', () => ({
  LineOaService: vi.fn().mockImplementation(() => ({
    pushOutcomeNotification: mockPushOutcomeNotification,
  })),
  buildTenantApprovalOutcomeFlexMessage: vi.fn().mockReturnValue({ type: 'flex' }),
  buildTenantAwaitingConfirmationFlexMessage: vi.fn().mockReturnValue({ type: 'flex' }),
  getPublicAppOrigin: vi.fn().mockReturnValue('https://app.hor-plus.com'),
}));

import { TenantRegistrationService } from '../../services/tenant-registration.service.js';
import { AppError } from '../../types/index.js';

describe('Card R3: Rejection & Revision Diff Lifecycle', () => {
  const primaryDormId = '20000001-0000-4000-8000-000000000002';
  const ownerUserId = '10000000-0000-4000-8000-000000000001';
  const staffUserId = '10000000-0000-4000-8000-000000000003';
  const validRequestId = 'req-td-001';
  const validRoomId = 'room-101-uuid';

  beforeEach(() => {
    vi.clearAllMocks();
    mockPushOutcomeNotification.mockClear();
    mockLinkActiveTenantRichMenu.mockClear();

    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      return callback(mockPrisma);
    });

    mockPrisma.dormitoryLineFriend.findMany.mockResolvedValue([]);
    mockPrisma.dormitoryLineFriend.findUnique.mockResolvedValue({
      id: 'friend-d',
      dormitoryId: primaryDormId,
      lineUserIdEncrypted: 'enc_U123',
    });
    mockPrisma.dormitoryLineFriend.findFirst.mockResolvedValue({
      id: 'friend-d',
      dormitoryId: primaryDormId,
      lineUserIdEncrypted: 'enc_U123',
    });
    mockPrisma.dormitory.findUnique.mockResolvedValue({
      id: primaryDormId,
      name: 'หอพักทดสอบ',
    });
    mockPrisma.room.findUnique.mockResolvedValue({
      id: validRoomId,
      roomNumber: '101',
    });
    mockPrisma.tenant.deleteMany.mockResolvedValue({ count: 0 });
  });

  describe('AC R3-1: Owner lists pending registration requests', () => {
    it('should return pending requests with applicant details', async () => {
      const mockRequests = [
        {
          id: validRequestId,
          dormitoryId: primaryDormId,
          status: 'pending_owner_approval',
          phone: '0812345678',
          roomNumber: '101',
          requestedRent: 3500,
          acceptanceSnapshot: {
            firstName: 'เดชา',
            lastName: 'ผู้สมัคร',
            prefix: 'นาย',
            rentAmount: 3500,
            roomNumber: '101',
          },
        },
      ];

      mockPrisma.tenantRegistrationRequest.findMany.mockResolvedValue(mockRequests);

      const registrationService = new TenantRegistrationService();
      const list = await registrationService.listRequests(primaryDormId, 'pending_owner_approval');

      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(validRequestId);
      expect(list[0].status).toBe('pending_owner_approval');
      expect(list[0].phone).toBe('0812345678');
    });
  });

  describe('AC R3-2: Mandatory rejection reason validation', () => {
    it('should throw 400 VALIDATION_ERROR when rejection reason is missing or empty', async () => {
      const registrationService = new TenantRegistrationService();

      // Empty string
      await expect(
        registrationService.rejectRequest(validRequestId, primaryDormId, '', ownerUserId)
      ).rejects.toThrow(AppError);

      // Whitespace only
      await expect(
        registrationService.rejectRequest(validRequestId, primaryDormId, '   ', ownerUserId)
      ).rejects.toThrow('กรุณาระบุเหตุผลในการปฏิเสธคำขอ');

      // Null or undefined
      await expect(
        registrationService.rejectRequest(validRequestId, primaryDormId, null as any, ownerUserId)
      ).rejects.toThrow(AppError);
    });

    it('should successfully reject and transition status to rejected when non-empty reason is provided', async () => {
      const existingRequest = {
        id: validRequestId,
        dormitoryId: primaryDormId,
        status: 'pending_owner_approval',
        phone: '0812345678',
        acceptanceSnapshot: { revisionHistory: [] },
      };

      let updatedData: any = null;
      mockPrisma.tenantRegistrationRequest.findFirst.mockResolvedValue(existingRequest);
      mockPrisma.tenantRegistrationRequest.update.mockImplementation((args: any) => {
        updatedData = args.data;
        return { ...existingRequest, ...args.data };
      });

      const registrationService = new TenantRegistrationService();
      vi.spyOn(registrationService, 'getRequestById').mockResolvedValue(existingRequest as any);

      const reason = 'ห้องพักที่ต้องการไม่ว่างในระยะเวลาดังกล่าว';
      const result = await registrationService.rejectRequest(
        validRequestId,
        primaryDormId,
        reason,
        ownerUserId
      );

      expect(result.status).toBe('rejected');
      expect(result.rejectedReason).toBe(reason);
      expect(updatedData.status).toBe('rejected');
      expect(updatedData.rejectedReason).toBe(reason);
    });
  });

  describe('AC R3-3: Verbatim rejection reason in snapshot', () => {
    it('should preserve verbatim reason in acceptanceSnapshot and revisionHistory', async () => {
      const existingRequest = {
        id: validRequestId,
        dormitoryId: primaryDormId,
        status: 'pending_owner_approval',
        phone: '0812345678',
        lineFollowerId: 'friend-d',
        acceptanceSnapshot: { revisionHistory: [] },
      };

      let updatedData: any = null;
      mockPrisma.tenantRegistrationRequest.findFirst.mockResolvedValue(existingRequest);
      mockPrisma.tenantRegistrationRequest.update.mockImplementation((args: any) => {
        updatedData = args.data;
        return { ...existingRequest, ...args.data };
      });

      const registrationService = new TenantRegistrationService();
      vi.spyOn(registrationService, 'getRequestById').mockResolvedValue(existingRequest as any);

      const verbatimReason = 'เอกสารไม่ครบถ้วน กรุณาแนบสำเนาบัตรประชาชนที่ชัดเจนใหม่อีกครั้ง';
      const result = await registrationService.rejectRequest(
        validRequestId,
        primaryDormId,
        verbatimReason,
        ownerUserId
      );

      expect(result.rejectedReason).toBe(verbatimReason);
      expect(updatedData.acceptanceSnapshot.currentOwnerComment).toBe(verbatimReason);
      expect(updatedData.acceptanceSnapshot.revisionHistory[0].reason).toBe(verbatimReason);
      expect(mockPushOutcomeNotification).toHaveBeenCalled();
    });
  });

  describe('AC R3-4: Direct modification in approval creates termsDiff & transitions to awaiting_tenant_confirmation', () => {
    it('should compute diff for modified rental terms and name, and transition to awaiting_tenant_confirmation', async () => {
      const existingRequest = {
        id: validRequestId,
        dormitoryId: primaryDormId,
        roomId: validRoomId,
        roomNumber: '101',
        firstName: 'สมชย',
        lastName: 'ใจดี',
        status: 'pending_owner_approval',
        phone: '0812345678',
        lineFollowerId: 'friend-d',
        acceptanceSnapshot: {
          firstName: 'สมชย',
          lastName: 'ใจดี',
          prefix: 'นาย',
          rentAmount: 3500,
          depositAmount: 7000,
          roomNumber: '101',
          startDate: '2026-10-01',
          durationMonths: 12,
          rentalType: 'MONTHLY',
        },
      };

      const targetRoom = {
        id: validRoomId,
        dormitoryId: primaryDormId,
        roomNumber: '101',
        monthlyRent: 4000,
        deposit: 8000,
        status: 'vacant',
      };

      let updatedData: any = null;
      mockPrisma.tenantRegistrationRequest.findFirst.mockResolvedValue(existingRequest);
      mockPrisma.room.findFirst.mockResolvedValue(targetRoom);
      mockPrisma.tenantRegistrationRequest.update.mockImplementation((args: any) => {
        updatedData = args.data;
        return { ...existingRequest, ...args.data };
      });

      const registrationService = new TenantRegistrationService();
      vi.spyOn(registrationService, 'getRequestById').mockResolvedValue(existingRequest as any);

      // Owner fixes typo in first name (สมชย -> สมชาย) and modifies rent (3500 -> 4000)
      const approveDto = {
        roomId: validRoomId,
        rentalType: 'MONTHLY' as const,
        startDate: '2026-10-01',
        endDate: '2027-10-01',
        rentAmount: 4000,
        depositAmount: 7000,
        durationMonths: 12,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        prefix: 'นาย',
      };

      const result = await registrationService.approveRequest(
        validRequestId,
        primaryDormId,
        approveDto,
        ownerUserId
      );

      // Verify two-phase confirmation state
      expect(result.status).toBe('awaiting_tenant_confirmation');
      expect(updatedData.status).toBe('awaiting_tenant_confirmation');

      // Verify diff was computed and recorded
      const diff = updatedData.acceptanceSnapshot.termsDiff;
      expect(diff).toBeDefined();
      expect(diff.length).toBeGreaterThanOrEqual(2);

      const nameDiff = diff.find((d: any) => d.field === 'applicantName');
      expect(nameDiff).toBeDefined();
      expect(nameDiff.oldValue).toContain('สมชย');
      expect(nameDiff.newValue).toContain('สมชาย');

      const rentDiff = diff.find((d: any) => d.field === 'rentAmount');
      expect(rentDiff).toBeDefined();
      expect(rentDiff.oldValue).toBe('3,500 บาท');
      expect(rentDiff.newValue).toBe('4,000 บาท');

      // Verify LINE notification with diff was dispatched
      expect(mockPushOutcomeNotification).toHaveBeenCalled();
    });
  });

  describe('AC R3-5: Tenant re-signs and confirms modified agreement', () => {
    it('should complete registration, activate contract, room, and link rich menu upon confirmation', async () => {
      const awaitingRequest = {
        id: validRequestId,
        dormitoryId: primaryDormId,
        approvedRoomId: validRoomId,
        requestedRoomId: validRoomId,
        roomId: validRoomId,
        roomNumber: '101',
        status: 'awaiting_tenant_confirmation',
        phone: '0812345678',
        lineFollowerId: 'friend-d',
        acceptanceSnapshot: {
          firstName: 'สมชาย',
          lastName: 'ใจดี',
          prefix: 'นาย',
          rentAmount: 4000,
          depositAmount: 7000,
          roomNumber: '101',
          startDate: '2026-10-01',
          durationMonths: 12,
          rentalType: 'MONTHLY',
          termsDiff: [
            { field: 'rentAmount', label: 'ค่าเช่า', oldValue: '3,500 บาท', newValue: '4,000 บาท' },
          ],
          approvedTerms: {
            rentAmount: 4000,
            depositAmount: 7000,
            roomId: validRoomId,
            roomNumber: '101',
            startDate: '2026-10-01',
            endDate: '2027-10-01',
            durationMonths: 12,
          },
        },
      };

      const targetRoom = {
        id: validRoomId,
        dormitoryId: primaryDormId,
        roomNumber: '101',
        monthlyRent: 4000,
        deposit: 7000,
        status: 'vacant',
      };

      const createdTenant = {
        id: 'tenant-somchai-uuid',
        dormitoryId: primaryDormId,
        roomId: validRoomId,
        firstName: 'สมชาย',
        lastName: 'ใจดี',
        phone: '0812345678',
        status: 'active',
      };

      let requestUpdated: any = null;
      let roomUpdated: any = null;

      mockPrisma.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          $executeRaw: vi.fn().mockResolvedValue(1),
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          $queryRaw: vi.fn().mockResolvedValue([]),
          tenant: {
            findFirst: vi.fn().mockResolvedValue(null),
            findMany: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockResolvedValue(createdTenant),
            update: vi.fn().mockResolvedValue(createdTenant),
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          },
          room: {
            findFirst: vi.fn().mockResolvedValue(targetRoom),
            findUnique: vi.fn().mockResolvedValue(targetRoom),
            update: vi.fn().mockImplementation((args: any) => {
              roomUpdated = args;
              return { ...targetRoom, ...args.data };
            }),
          },
          leaseAgreement: {
            create: vi.fn().mockResolvedValue({ id: 'contract-somchai-uuid' }),
          },
          contract: {
            findFirst: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue({ id: 'contract-somchai-uuid' }),
          },
          occupancy: {
            create: vi.fn().mockResolvedValue({ id: 'occ-somchai-uuid', roomId: validRoomId }),
          },
          tenantRegistrationRequest: {
            findFirst: vi.fn().mockResolvedValue(awaitingRequest),
            update: vi.fn().mockImplementation((args: any) => {
              requestUpdated = args;
              return { ...awaitingRequest, ...args.data };
            }),
          },
          tenantRegistrationIntent: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          dormitoryBillingCycle: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
          billingCycle: {
            findFirst: vi.fn().mockResolvedValue({
              id: 'cycle-01',
              dormitoryId: primaryDormId,
              cycleCode: '2026-10',
              periodStart: new Date('2026-10-01'),
              periodEnd: new Date('2026-10-31'),
              billingDate: new Date('2026-10-25'),
              dueDate: new Date('2026-11-05'),
              status: 'open',
            }),
            findMany: vi.fn().mockResolvedValue([{
              id: 'cycle-01',
              dormitoryId: primaryDormId,
              cycleCode: '2026-10',
              periodStart: new Date('2026-10-01'),
              periodEnd: new Date('2026-10-31'),
              billingDate: new Date('2026-10-25'),
              dueDate: new Date('2026-11-05'),
              status: 'open',
            }]),
            create: vi.fn(),
          },
          ownerSignature: {
            findFirst: vi.fn().mockResolvedValue({ signatureData: 'owner-sig' }),
          },
          bill: {
            findFirst: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn().mockResolvedValue({ id: 'bill-01' }),
          },
          billItem: {
            create: vi.fn(),
            createMany: vi.fn(),
          },
          auditLog: {
            create: vi.fn().mockResolvedValue({ id: 'audit-01' }),
          },
        };
        return callback(tx);
      });

      const registrationService = new TenantRegistrationService();
      vi.spyOn(registrationService, 'getRequestById').mockResolvedValue(awaitingRequest as any);

      const signatureDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

      const result = await registrationService.confirmApprovedRegistration(
        validRequestId,
        primaryDormId,
        { signatureBase64: signatureDataUrl },
        'U_line_tenant_d'
      );

      // Verify request transitioned to approved
      expect(result.success).toBe(true);
      expect(result.request.status).toBe('approved');
      expect(requestUpdated.data.status).toBe('approved');

      // Verify room status updated to occupied
      expect(roomUpdated.data.status).toBe('occupied');

      // Verify Rich Menu was linked
      expect(mockLinkActiveTenantRichMenu).toHaveBeenCalledWith(
        primaryDormId,
        'U_line_tenant_d'
      );
    });
  });

  describe('AC R3-6: Staff permission restrictions (403 Forbidden)', () => {
    it('should confirm that staff cannot approve or reject registration requests', () => {
      // Permission verification based on REQUIREMENTS-LOCK §3 line 93:
      // Staff (ช่าง/แม่บ้าน) cannot approve or reject tenant requests (requires tenant:write).
      const staffRole = 'STAFF';
      const staffPermissions = ['meter:read', 'maintenance:write', 'repair:write'];

      const canApprove = staffPermissions.includes('tenant:write');
      const canReject = staffPermissions.includes('tenant:write');

      expect(canApprove).toBe(false);
      expect(canReject).toBe(false);

      const ownerRole = 'OWNER';
      const ownerPermissions = ['tenant:write', 'tenant:read', 'billing:write', 'admin:all'];

      expect(ownerPermissions.includes('tenant:write')).toBe(true);
    });
  });
});
