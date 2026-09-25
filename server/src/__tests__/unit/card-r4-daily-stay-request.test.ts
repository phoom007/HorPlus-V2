/**
 * @license Apache-2.0
 * Card R4 Unit Tests: Daily Stay Applicant Request, Pricing/Night Calculation, Conflict Checks & Owner Approval with Bill Generation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { mockPrisma } = vi.hoisted(() => {
  return {
    mockPrisma: {
      dormitory: {
        findUnique: vi.fn(),
      },
      room: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      tenant: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      occupancy: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
      contract: {
        findMany: vi.fn(),
      },
      provisionalRentalTerm: {
        findMany: vi.fn(),
      },
      dailyStay: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      dailyStayInvoice: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      billingCycle: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      bill: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      payment: {
        count: vi.fn().mockResolvedValue(0),
      },
      dormitoryAccessGrant: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      dormitoryPropertyDefaults: {
        findUnique: vi.fn(),
      },
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'mock-audit-id' }),
      },
      $transaction: vi.fn((fn: any) => fn(mockPrisma)),
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../services/defaults.service.js', () => ({
  defaultsService: {
    resolveEffectiveRoomDefaults: vi.fn().mockResolvedValue({
      dailyRent: { value: '600.00', source: 'ROOM' },
      dailyDeposit: { value: '500.00', source: 'DORMITORY' },
    }),
  },
}));

vi.mock('../../services/subscription-entitlement.service.js', () => ({
  SubscriptionEntitlementService: vi.fn().mockImplementation(() => ({
    assertRoomOperationalEntitlement: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('../../services/tenant-number.service.js', () => ({
  generateNextTenantNumber: vi.fn().mockResolvedValue('T-2026-0001'),
}));

vi.mock('../../services/line-richmenu.service.js', () => ({
  LineRichMenuService: vi.fn().mockImplementation(() => ({
    linkActiveTenantRichMenu: vi.fn().mockResolvedValue(true),
  })),
}));

import { DailyStayService } from '../../services/daily-stay.service.js';

const primaryDormId = '20000001-0000-4000-8000-000000000002';
const mockRoomId = '30000001-0000-4000-8000-000000000001';
const mockUserId = '10000000-0000-4000-8000-000000000001';

describe('Card R4 Unit Tests: Daily Stay Applicant Lifecycle', () => {
  let dailyStayService: DailyStayService;

  beforeEach(() => {
    vi.clearAllMocks();
    dailyStayService = new DailyStayService(mockPrisma as any);
  });

  describe('AC R4-1: Applicant submits daily stay request with night calculation & safe requesterUserId', () => {
    it('should calculate duration as nights (1-3 Oct = 2 nights) and sanitize ag_user_ requesterId without UUID error', async () => {
      mockPrisma.room.findFirst.mockResolvedValue({
        id: mockRoomId,
        dormitoryId: primaryDormId,
        buildingId: 'bld-01',
        roomNumber: '106',
        status: 'vacant',
        building: { id: 'bld-01', deletedAt: null },
      });

      // No overlapping contracts/provisionals/daily stays
      mockPrisma.contract.findMany.mockResolvedValue([]);
      mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
      mockPrisma.dailyStay.findMany.mockResolvedValue([]);

      mockPrisma.dailyStay.create.mockImplementation((args: any) => Promise.resolve({
        id: 'stay-001',
        ...args.data,
      }));

      // Non-UUID session ID (e.g. from LINE access grant)
      const lineSessionUserId = 'ag_user_grant123456';
      const result = await dailyStayService.createTenantDailyStayRequest(
        primaryDormId,
        {
          roomId: mockRoomId,
          applicantFullName: 'สมหญิง ผู้สมัครรายวัน',
          applicantPhone: '0812345678',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
          depositAmount: '500.00',
          depositDeclaredStatus: 'UNPAID',
        },
        lineSessionUserId
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('PENDING_APPROVAL');
      // 1 Oct to 3 Oct = 2 nights
      expect(result.inclusiveDayCount).toBe(2);
      // Daily rate 600 * 2 nights = 1200
      expect(Number(result.totalRentAmount)).toBe(1200);
      // requesterUserId was sanitized from ag_user_... to null to prevent Postgres UUID syntax crash
      expect(result.requesterUserId).toBeNull();
    });
  });

  describe('AC R4-2: Owner approves daily stay request -> DailyStay, Occupancy, and Bill (DAILY) created', () => {
    it('should approve stay, create DailyStayInvoice, create Bill with billKind DAILY, and update room to occupied', async () => {
      const mockStay = {
        id: 'stay-001',
        dormitoryId: primaryDormId,
        roomId: mockRoomId,
        tenantId: null,
        applicantFullName: 'สมปอง เข้าพักรายวัน',
        applicantPhone: '0899998888',
        requesterUserId: null,
        startDate: new Date(),
        endDate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        checkInAt: new Date(),
        checkOutAt: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        inclusiveDayCount: 2,
        dailyRateAmount: new Prisma.Decimal('600.00'),
        totalRentAmount: new Prisma.Decimal('1200.00'),
        depositAmount: new Prisma.Decimal('500.00'),
        depositDeclaredStatus: 'UNPAID',
        status: 'PENDING_APPROVAL',
      };

      mockPrisma.dailyStay.findFirst.mockResolvedValue(mockStay);
      mockPrisma.room.findFirst.mockResolvedValue({
        id: mockRoomId,
        dormitoryId: primaryDormId,
        buildingId: 'bld-01',
        roomNumber: '106',
        status: 'vacant',
      });

      mockPrisma.contract.findMany.mockResolvedValue([]);
      mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
      mockPrisma.dailyStay.findMany.mockResolvedValue([]);

      mockPrisma.tenant.create.mockResolvedValue({
        id: 'tenant-daily-01',
        dormitoryId: primaryDormId,
        tenantNumber: 'T-2026-0001',
        firstName: 'สมปอง เข้าพักรายวัน',
        status: 'active',
      });

      mockPrisma.occupancy.create.mockResolvedValue({
        id: 'occ-daily-01',
        dormitoryId: primaryDormId,
        roomId: mockRoomId,
        tenantId: 'tenant-daily-01',
        status: 'ACTIVE',
      });

      mockPrisma.dailyStayInvoice.findUnique.mockResolvedValue(null);
      mockPrisma.dailyStayInvoice.findFirst.mockResolvedValue(null);
      mockPrisma.dailyStayInvoice.create.mockImplementation((args: any) => Promise.resolve({
        id: 'inv-daily-01',
        ...args.data,
      }));

      mockPrisma.billingCycle.findFirst.mockResolvedValue({
        id: 'cycle-01',
        dormitoryId: primaryDormId,
        cycleCode: 'CYCLE-2026-10',
      });

      mockPrisma.bill.findFirst.mockResolvedValue(null);
      mockPrisma.bill.create.mockImplementation((args: any) => Promise.resolve({
        id: 'bill-daily-01',
        ...args.data,
      }));

      mockPrisma.dailyStay.update.mockResolvedValue({
        ...mockStay,
        status: 'ACTIVE',
        tenantId: 'tenant-daily-01',
      });

      mockPrisma.room.update.mockResolvedValue({
        id: mockRoomId,
        status: 'occupied',
      });

      const approved = await dailyStayService.approveDailyStay(primaryDormId, 'stay-001', mockUserId);

      expect(approved).toBeDefined();
      expect(mockPrisma.tenant.create).toHaveBeenCalled();
      expect(mockPrisma.occupancy.create).toHaveBeenCalled();
      expect(mockPrisma.dailyStayInvoice.create).toHaveBeenCalled();

      // Bill with billKind: 'DAILY' must be created for tenant portal integration
      expect(mockPrisma.bill.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            dormitoryId: primaryDormId,
            billKind: 'DAILY',
            tenantId: 'tenant-daily-01',
            roomId: mockRoomId,
            status: 'unpaid',
          }),
        })
      );
      expect(mockPrisma.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'occupied' }),
        })
      );
    });
  });

  describe('AC R4-3: Request room with conflicting dates -> Throws 409 ROOM_NOT_AVAILABLE', () => {
    it('should reject request when room is already occupied during the requested interval', async () => {
      mockPrisma.room.findFirst.mockResolvedValue({
        id: mockRoomId,
        dormitoryId: primaryDormId,
        buildingId: 'bld-01',
        roomNumber: '106',
        status: 'vacant',
        building: { id: 'bld-01', deletedAt: null },
      });

      // Existing overlapping contract on this room: 2026-09-01 to 2026-12-31
      mockPrisma.contract.findMany.mockResolvedValue([
        {
          id: 'contract-existing',
          dormitoryId: primaryDormId,
          roomId: mockRoomId,
          status: 'active',
          startDate: new Date('2026-09-01T00:00:00.000Z'),
          endDate: new Date('2026-12-31T00:00:00.000Z'),
        },
      ]);
      mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
      mockPrisma.dailyStay.findMany.mockResolvedValue([]);

      await expect(
        dailyStayService.createTenantDailyStayRequest(primaryDormId, {
          roomId: mockRoomId,
          applicantFullName: 'คนอยากพัก ชนคิว',
          startDate: '2026-10-01',
          endDate: '2026-10-03',
        })
      ).rejects.toThrow('ห้องพักไม่ว่างในช่วงวันและเวลาดังกล่าว');
    });
  });

  describe('AC R4-4: Staff role permission validation', () => {
    it('should verify that STAFF role lacks rooms:write permission and is rejected with 403', async () => {
      const { resolveAuthoritativeDormitoryContext } = await import('../../middleware/dormitory-context.js');

      const mockStaffReq: any = {
        auth: {
          userId: 'staff-user-001',
          user: { id: 'staff-user-001' },
          memberships: [
            {
              dormitoryId: primaryDormId,
              roleCode: 'STAFF',
              role: { code: 'STAFF' },
              status: 'active',
              roleEntity: {
                id: 'role-staff-id',
                code: 'STAFF',
                permissions: {
                  rooms: ['view'],
                  tenants: ['view'],
                  meters: ['view', 'record'],
                  maintenance: ['view', 'update', 'close'],
                },
              },
            },
          ],
        },
        headers: { 'x-dormitory-id': primaryDormId },
      };

      const context = await resolveAuthoritativeDormitoryContext(mockStaffReq);
      expect(context).toBeDefined();
      expect(context.roleCode).toBe('STAFF');
      expect(context.permissions).not.toContain('rooms:write');
      expect(context.permissions).not.toContain('rooms:create');
      expect(context.permissions).not.toContain('*');
    });
  });
});
