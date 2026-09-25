import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockPushOutcome, mockUnlinkRichMenu } = vi.hoisted(() => {
  const prismaObj: any = {
    occupancy: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    tenantMoveOutRequest: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contract: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    room: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dormitory: {
      findUnique: vi.fn(),
    },
    tenant: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dormitoryMember: {
      findMany: vi.fn(),
    },
    staffNotification: {
      create: vi.fn(),
    },
    tenantNotice: {
      create: vi.fn(),
    },
    bill: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    contractSettlement: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractSettlementItem: {
      create: vi.fn(),
    },
    receipt: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    tenantRegistrationRequest: {
      updateMany: vi.fn(),
    },
    dormitoryAccessGrant: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  prismaObj.$transaction = vi.fn(async (cb: any) => cb(prismaObj));
  return {
    mockPrisma: prismaObj,
    mockPushOutcome: vi.fn().mockResolvedValue({ delivered: true }),
    mockUnlinkRichMenu: vi.fn().mockResolvedValue(true),
  };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../../services/line-oa.service.js', () => ({
  lineOaService: {
    pushOutcomeNotification: mockPushOutcome,
  },
  LineOaService: class {
    pushOutcomeNotification = mockPushOutcome;
  },
}));

vi.mock('../../services/line-richmenu.service.js', () => ({
  LineRichMenuService: class {
    unlinkActiveTenantRichMenu = mockUnlinkRichMenu;
  },
}));

import { MoveOutService } from '../../services/move-out.service.js';
import { SettlementService } from '../../services/settlement.service.js';

describe('Card C3 — แจ้งย้ายออก → เจ้าของยืนยัน → ปิดสิทธิ์ (OQ-6, OQ-7, OQ-8, OQ-9)', () => {
  const moveOutService = new MoveOutService();
  const settlementService = new SettlementService();

  const dormId = '20000001-0000-4000-8000-000000000002';
  const tcId = '97d61931-c8ef-4da0-aab7-1f6faae6536b';
  const tbId = '97d61931-c8ef-4da0-aab7-1f6faae6536c';
  const roomId = '30000001-0000-4000-8000-000000000101';
  const occupancyId = '40000001-0000-4000-8000-000000000101';
  const contractId = '50000001-0000-4000-8000-000000000101';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('C3-1 & OQ-6: TC submits move-out request with any date (no 30-day restriction), can cancel and re-submit before Owner confirmation', async () => {
    process.env.STRICT_30_DAY_NOTICE = 'true';
    mockPrisma.occupancy.findFirst.mockResolvedValue({
      id: occupancyId,
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      contractId,
      status: 'ACTIVE',
    });
    mockPrisma.tenantMoveOutRequest.findFirst.mockResolvedValue(null);
    mockPrisma.tenantMoveOutRequest.create.mockResolvedValue({
      id: 'req-c3-1',
      dormitoryId: dormId,
      occupancyId,
      tenantId: tcId,
      roomId,
      intendedMoveOutDate: new Date('2026-09-26'),
      status: 'SCHEDULED',
    });
    mockPrisma.dormitoryMember.findMany.mockResolvedValue([]);

    // Submit tomorrow's date (less than 30 days) — must succeed per OQ-6
    const submitRes = await moveOutService.submitMoveOutRequest({
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      intendedMoveOutDate: '2026-09-26',
      reason: 'ย้ายที่ทำงาน',
    });
    expect(submitRes.request.id).toBe('req-c3-1');
    expect(submitRes.request.status).toBe('SCHEDULED');
    expect(mockPrisma.contract.updateMany).toHaveBeenCalled();

    // Cancel before Owner confirmation — must succeed per OQ-6
    mockPrisma.tenantMoveOutRequest.findUnique.mockResolvedValue({
      id: 'req-c3-1',
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      status: 'SCHEDULED',
    });
    mockPrisma.tenantMoveOutRequest.update.mockResolvedValue({
      id: 'req-c3-1',
      status: 'CANCELLED',
    });

    const cancelRes = await moveOutService.cancelMoveOutRequest('req-c3-1', tcId);
    expect(cancelRes.request.status).toBe('CANCELLED');
  });

  it('C3-2: TB cannot cancel or modify TC move-out request (403 FORBIDDEN)', async () => {
    mockPrisma.tenantMoveOutRequest.findUnique.mockResolvedValue({
      id: 'req-c3-1',
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      status: 'SCHEDULED',
    });

    await expect(moveOutService.cancelMoveOutRequest('req-c3-1', tbId)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('C3-3: Staff cannot confirm move-out (403 FORBIDDEN)', async () => {
    await expect(
      moveOutService.completeEndTenancy({
        dormitoryId: dormId,
        requestId: 'req-c3-1',
        actualEndedAt: '2026-09-30',
        reviewedByUserId: 'staff-user-id',
        actorRole: 'STAFF',
      })
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('C3-4, C3-5, C3-6, C3-7, C3-8, C3-9 (OQ-7, OQ-8, OQ-9): Owner confirmation voids unpaid deposit bills, deducts unpaid normal bills from paid deposit, issues Final Settlement Receipt, pushes LINE summary, unlinks Rich Menu, and revokes grant/session/binding', async () => {
    mockPrisma.tenantMoveOutRequest.findUnique.mockResolvedValue({
      id: 'req-c3-1',
      dormitoryId: dormId,
      occupancyId,
      tenantId: tcId,
      roomId,
      status: 'SCHEDULED',
      reason: 'สิ้นสุดสัญญา',
    });
    mockPrisma.occupancy.findUnique.mockResolvedValue({
      id: occupancyId,
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      contractId,
      status: 'ACTIVE',
    });
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: tcId,
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      lineFriendId: 'lf-tc-1',
      linkedUserId: '11111111-2222-4333-8444-555555555555',
      lineFriend: {
        id: 'lf-tc-1',
        lineUserId: 'U_tc_line_user_001',
      },
    });
    mockPrisma.contract.findUnique.mockResolvedValue({
      id: contractId,
      dormitoryId: dormId,
      tenantId: tcId,
      roomId,
      status: 'active',
    });

    // Mock bills:
    // 1) An unpaid DEPOSIT bill (must be voided per OQ-7)
    // 2) A paid DEPOSIT bill of 9,000 THB
    // 3) An unpaid MONTHLY_UTILITY bill of 1,200 THB (must be deducted from 9,000 deposit and closed as paid per OQ-7)
    mockPrisma.bill.findMany
      .mockResolvedValueOnce([
        { id: 'bill-dep-unpaid', billKind: 'DEPOSIT', status: 'unpaid', totalAmount: 3000, paidAmount: 0 },
      ])
      .mockResolvedValueOnce([
        { id: 'bill-dep-paid', billKind: 'DEPOSIT', status: 'paid', totalAmount: 9000, paidAmount: 9000 },
      ])
      .mockResolvedValueOnce([
        { id: 'bill-util-unpaid', billKind: 'MONTHLY_UTILITY', status: 'unpaid', totalAmount: 1200, paidAmount: 0 },
      ]);

    mockPrisma.contractSettlement.findFirst.mockResolvedValue({
      id: 'settle-c3-1',
      dormitoryId: dormId,
      contractId,
      items: [
        { id: 'item-refund-custom', description: 'ส่วนลดคืนเงินพิเศษ (OQ-9)', amount: -300, isDeleted: false },
      ],
    });
    mockPrisma.contractSettlement.update.mockImplementation(async ({ data }: any) => ({
      id: 'settle-c3-1',
      ...data,
    }));
    mockPrisma.receipt.findFirst.mockResolvedValue(null);
    mockPrisma.receipt.create.mockImplementation(async ({ data }: any) => ({
      id: 'rc-final-1',
      ...data,
    }));
    mockPrisma.occupancy.update.mockResolvedValue({ id: occupancyId, status: 'ENDED' });
    mockPrisma.room.update.mockResolvedValue({ id: roomId, roomNumber: '101', status: 'vacant' });
    mockPrisma.occupancy.count.mockResolvedValue(0);
    mockPrisma.dormitoryAccessGrant.findMany.mockResolvedValue([{ id: 'grant-tc-1' }]);
    mockPrisma.tenantMoveOutRequest.update.mockResolvedValue({
      id: 'req-c3-1',
      status: 'COMPLETED',
    });

    const completeRes = await moveOutService.completeEndTenancy({
      dormitoryId: dormId,
      requestId: 'req-c3-1',
      actualEndedAt: '2026-09-30',
      reviewedByUserId: '22222222-3333-4444-8555-666666666666',
      actorRole: 'OWNER',
    });

    // Verify OQ-7: Unpaid deposit bill voided
    expect(completeRes.voidedDepositBillIds).toContain('bill-dep-unpaid');
    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bill-dep-unpaid' },
        data: expect.objectContaining({ status: 'void' }),
      })
    );

    // Verify OQ-7: Unpaid utility bill deducted from paid deposit and closed as paid
    expect(completeRes.deductedBillIds).toContain('bill-util-unpaid');
    expect(mockPrisma.bill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'bill-util-unpaid' },
        data: expect.objectContaining({ status: 'paid' }),
      })
    );

    // Verify OQ-7 & OQ-9: Settlement net = 9000 - 1200 - (-300) = 8100 REFUND
    expect(Number(completeRes.settlement.netSettlement)).toBe(8100);
    expect(completeRes.settlement.settlementStatus).toBe('REFUNDED');
    expect(completeRes.finalReceipt.receiptKind).toBe('FINAL_SETTLEMENT');

    // Verify OQ-8 & C3-6: LINE notification sent and Rich Menu unlinked
    expect(mockPushOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        dormitoryId: dormId,
        recipientLineUserId: 'U_tc_line_user_001',
        eventKey: 'move_out_completed_final_receipt',
      })
    );
    expect(mockUnlinkRichMenu).toHaveBeenCalledWith(dormitoryIdOrAny(dormId), 'U_tc_line_user_001');

    // Verify C3-5, C3-7, C3-9: Tenant marked former, LINE & linkedUserId cleared, registration archived, grant & session revoked
    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tcId },
      data: {
        status: 'former',
        linkedUserId: null,
        lineFriendId: null,
      },
    });
    expect(mockPrisma.tenantRegistrationRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'moved_out' },
      })
    );
    expect(mockPrisma.dormitoryAccessGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['grant-tc-1'] } },
        data: expect.objectContaining({ status: 'REVOKED' }),
      })
    );
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'revoked',
          revokedReason: 'TENANT_MOVED_OUT',
        }),
      })
    );
  });
});

function dormitoryIdOrAny(id: string) {
  return id;
}
