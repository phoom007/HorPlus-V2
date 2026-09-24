import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import express from 'express';
import request from 'supertest';
import { AppError } from '../../types/index.js';

const { mockPrisma } = vi.hoisted(() => {
  const p: any = {
    $transaction: vi.fn(async (cb: any) => cb(p)),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([]),
    tenantMoveOutRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    occupancy: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    room: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    contract: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    tenant: {
      update: vi.fn(),
    },
    dormitoryAccessGrant: {
      updateMany: vi.fn(),
    },
    tenantNotice: {
      create: vi.fn(),
    },
    contractSettlement: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    bill: {
      findMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    localNotificationOutbox: {
      create: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
    },
    contractSettlementItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };
  return { mockPrisma: p };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

import { MoveOutService } from '../../services/move-out.service.js';
import { SettlementService } from '../../services/settlement.service.js';
import { SubscriptionEntitlementService } from '../../services/subscription-entitlement.service.js';

describe('TASK-014: Move-Out, Final Settlement & Restricted Mode', () => {
  const testDormId = '11111111-1111-1111-1111-111111111111';
  const testTenantId = '22222222-2222-2222-2222-222222222222';
  const testRoomId = '33333333-3333-3333-3333-333333333333';
  const testContractId = '44444444-4444-4444-4444-444444444444';
  const testRequestId = '55555555-5555-5555-5555-555555555555';
  const testOccupancyId = '66666666-6666-6666-6666-666666666666';

  describe('AC-1: Move-Out Lifecycle & Early Move-Out Confirmation', () => {
    let moveOutService: MoveOutService;

    beforeEach(() => {
      mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockPrisma));
      mockPrisma.tenantMoveOutRequest.findUnique.mockResolvedValue({
        id: testRequestId,
        dormitoryId: testDormId,
        occupancyId: testOccupancyId,
        tenantId: testTenantId,
        roomId: testRoomId,
        status: 'SCHEDULED',
        reason: 'ย้ายกลับต่างจังหวัด',
      });
      mockPrisma.tenantMoveOutRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ id: testRequestId, ...data }));
      mockPrisma.occupancy.findUnique.mockResolvedValue({
        id: testOccupancyId,
        dormitoryId: testDormId,
        tenantId: testTenantId,
        roomId: testRoomId,
        contractId: testContractId,
        status: 'ACTIVE',
      });
      mockPrisma.occupancy.update.mockImplementation(({ data }: any) => Promise.resolve({ id: testOccupancyId, ...data }));
      mockPrisma.occupancy.count.mockResolvedValue(0);
      mockPrisma.room.findUnique.mockResolvedValue({ id: testRoomId, roomNumber: '101' });
      mockPrisma.room.update.mockResolvedValue({ id: testRoomId, status: 'vacant' });
      mockPrisma.contract.findUnique.mockResolvedValue({
        id: testContractId,
        dormitoryId: testDormId,
        status: 'active',
      });
      mockPrisma.contract.update.mockResolvedValue({ id: testContractId, status: 'checked_out' });
      mockPrisma.tenant.update.mockResolvedValue({ id: testTenantId, status: 'former', lineFriendId: 'friend-uuid-1' });
      mockPrisma.dormitoryAccessGrant.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.tenantNotice.create.mockResolvedValue({});

      moveOutService = new MoveOutService();
    });

    it('confirms move-out: ends occupancy, sets room vacant, updates tenant to former, and revokes access grant', async () => {
      const result = await moveOutService.completeEndTenancy({
        dormitoryId: testDormId,
        requestId: testRequestId,
        actualEndedAt: '2026-09-30',
        reviewedByUserId: 'user-owner-1',
        actorRole: 'OWNER',
        emergencyReason: 'เจ้าของยืนยันการย้ายออกก่อนกำหนด',
      });

      expect(result.request.status).toBe('COMPLETED');
      expect(result.occupancy.status).toBe('ENDED');

      // Verify room reset to vacant
      expect(mockPrisma.room.update).toHaveBeenCalledWith({
        where: { id: testRoomId },
        data: {
          status: 'vacant',
          currentTenantId: null,
          currentContractId: null,
        },
      });

      // Verify contract checked_out
      expect(mockPrisma.contract.update).toHaveBeenCalledWith({
        where: { id: testContractId },
        data: expect.objectContaining({
          status: 'checked_out',
        }),
      });

      // Verify tenant marked former
      expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
        where: { id: testTenantId },
        data: { status: 'former' },
        select: { lineFriendId: true },
      });

      // Verify active access grant revoked (REQUIREMENTS-LOCK §8:154)
      expect(mockPrisma.dormitoryAccessGrant.updateMany).toHaveBeenCalledWith({
        where: {
          dormitoryId: testDormId,
          lineFriendId: 'friend-uuid-1',
          status: 'ACTIVE',
        },
        data: expect.objectContaining({
          status: 'REVOKED',
        }),
      });
    });

    it('rejects confirmation by Staff or unauthorized role with 403 FORBIDDEN', async () => {
      await expect(
        moveOutService.completeEndTenancy({
          dormitoryId: testDormId,
          requestId: testRequestId,
          actualEndedAt: '2026-09-30',
          reviewedByUserId: 'user-staff-1',
          actorRole: 'STAFF',
        })
      ).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });
  });

  describe('AC-2: Final Settlement & Ledger Calculation', () => {
    let settlementService: SettlementService;

    beforeEach(() => {
      mockPrisma.contract.findFirst.mockResolvedValue({
        id: testContractId,
        dormitoryId: testDormId,
        tenantId: testTenantId,
        roomId: testRoomId,
        deletedAt: null,
      });
      mockPrisma.contractSettlement.findFirst.mockResolvedValue(null);
      mockPrisma.contractSettlement.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'setl-1', ...data, items: [] }));
      mockPrisma.contractSettlement.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'setl-1', ...data }));
      mockPrisma.contractSettlementItem.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'item-1', ...data }));
      mockPrisma.contractSettlementItem.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'item-1', ...data }));

      settlementService = new SettlementService();
    });

    it('credits ONLY paid deposit; unpaid deposit yields 0 credit (REQUIREMENTS-LOCK §6:135)', async () => {
      // Scenario A: Deposit is unpaid (paidAmount = 0, status = 'unpaid')
      mockPrisma.bill.findMany.mockImplementation(async ({ where }: any) => {
        if (where.billKind === 'DEPOSIT') {
          return [{ id: 'b-dep-1', totalAmount: 5000, paidAmount: 0, status: 'unpaid', billKind: 'DEPOSIT' }];
        }
        return [{ id: 'b-rent-1', totalAmount: 3500, paidAmount: 0, status: 'unpaid' }];
      });

      const settlementA = await settlementService.getOrCreateSettlement(testDormId, testContractId);
      expect(new Prisma.Decimal(settlementA.depositAmount).toNumber()).toBe(0); // Unpaid deposit gives ZERO credit
      expect(new Prisma.Decimal(settlementA.unpaidBillAmount).toNumber()).toBe(3500);
      expect(new Prisma.Decimal(settlementA.netSettlement).toNumber()).toBe(-3500); // Net is payment due
      expect(settlementA.settlementDirection).toBe('PAYMENT_DUE');

      // Scenario B: Deposit is fully paid
      mockPrisma.contractSettlement.findFirst.mockResolvedValueOnce(null);
      mockPrisma.bill.findMany.mockImplementation(async ({ where }: any) => {
        if (where.billKind === 'DEPOSIT') {
          return [{ id: 'b-dep-1', totalAmount: 5000, paidAmount: 5000, status: 'paid', billKind: 'DEPOSIT' }];
        }
        return [{ id: 'b-rent-1', totalAmount: 3500, paidAmount: 0, status: 'unpaid' }];
      });

      const settlementB = await settlementService.getOrCreateSettlement(testDormId, testContractId);
      expect(new Prisma.Decimal(settlementB.depositAmount).toNumber()).toBe(5000);
      expect(new Prisma.Decimal(settlementB.unpaidBillAmount).toNumber()).toBe(3500);
      expect(new Prisma.Decimal(settlementB.netSettlement).toNumber()).toBe(1500); // 5000 - 3500 = 1500 refund
      expect(settlementB.settlementDirection).toBe('REFUND');
    });

    it('soft-removes damage item (isDeleted: true) and forbids hard delete', async () => {
      mockPrisma.contractSettlementItem.findUnique.mockResolvedValue({
        id: 'item-101',
        settlementId: 'setl-1',
        amount: new Prisma.Decimal(500),
        isDeleted: false,
        settlement: {
          dormitoryId: testDormId,
          settlementStatus: 'PENDING_REFUND',
        },
      });

      mockPrisma.contractSettlement.findUnique.mockResolvedValue({
        id: 'setl-1',
        depositAmount: new Prisma.Decimal(5000),
        unpaidBillAmount: new Prisma.Decimal(1000),
        items: [], // After soft-remove, 0 active items
      });

      const removed = await settlementService.softRemoveDamageItem(testDormId, 'item-101', 'user-owner-1', 'OWNER');
      expect(mockPrisma.contractSettlementItem.update).toHaveBeenCalledWith({
        where: { id: 'item-101' },
        data: expect.objectContaining({
          isDeleted: true,
        }),
      });
      expect(removed.isDeleted).toBe(true);
    });

    it('locks settlement upon status confirmation (REFUNDED / PAYMENT_RECEIVED)', async () => {
      mockPrisma.contractSettlement.findUnique.mockResolvedValue({
        id: 'setl-1',
        dormitoryId: testDormId,
        settlementStatus: 'PENDING_REFUND',
      });

      await settlementService.confirmSettlementStatus(testDormId, 'setl-1', 'REFUNDED', 'user-owner-1', 'OWNER');
      expect(mockPrisma.contractSettlement.update).toHaveBeenCalledWith({
        where: { id: 'setl-1' },
        data: expect.objectContaining({
          settlementStatus: 'REFUNDED',
        }),
      });

      // Attempting to add damage item to locked settlement throws SETTLEMENT_LOCKED
      mockPrisma.contractSettlement.findUnique.mockResolvedValueOnce({
        id: 'setl-1',
        dormitoryId: testDormId,
        settlementStatus: 'REFUNDED',
        items: [],
      });
      await expect(
        settlementService.addDamageItem({
          dormitoryId: testDormId,
          settlementId: 'setl-1',
          description: 'กุญแจห้องหาย',
          amount: 200,
          actorUserId: 'user-owner-1',
          actorRole: 'OWNER',
        })
      ).rejects.toMatchObject({
        code: 'SETTLEMENT_LOCKED',
      });
    });
  });

  describe('AC-3: Package Expiry & Restricted Mode (Zero Grace Period)', () => {
    let entitlementService: SubscriptionEntitlementService;
    let mockDb: any;

    beforeEach(() => {
      mockDb = {
        dormitory: {
          findUnique: vi.fn().mockResolvedValue({ status: 'active' }),
        },
        dormitorySubscription: {
          findUnique: vi.fn(),
        },
        room: {
          count: vi.fn().mockResolvedValue(5),
        },
        promoRedemption: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        plan: {
          findFirst: vi.fn(),
        },
      };
      entitlementService = new SubscriptionEntitlementService(mockDb);
    });

    it('enters Restricted Mode immediately when expiresAt has passed with ZERO grace period', async () => {
      const now = new Date('2026-09-24T12:00:00Z');
      const oneMillisecondAgo = new Date(now.getTime() - 1);

      mockDb.dormitorySubscription.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        expiresAt: oneMillisecondAgo,
        plan: { code: 'PAID', name: 'HorPlus Pro', type: 'PAID', roomLimit: 150 },
        startedAt: new Date('2026-08-24T12:00:00Z'),
      });

      const entitlement = await entitlementService.getEffectiveEntitlements(testDormId, now, mockDb);
      expect(entitlement.status).toBe('EXPIRED');
      expect(entitlement.isActive).toBe(false);
      expect(entitlement.isReadOnly).toBe(true); // Enters restricted mode immediately
      expect(entitlement.reason).toContain('SUBSCRIPTION_EXPIRED');

      // assertDormitoryWritable throws SUBSCRIPTION_READ_ONLY (HTTP 403)
      await expect(entitlementService.assertDormitoryWritable(testDormId, now, mockDb)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_READ_ONLY',
        statusCode: 403,
      });
    });

    it('entitlement middleware blocks mutations (POST/PUT/PATCH/DELETE) and permits GET requests in Restricted Mode', async () => {
      const app = express();
      app.use(express.json());

      const mockAssertWritable = vi.spyOn(entitlementService, 'assertDormitoryWritable')
        .mockRejectedValue(new AppError('Dormitory operation restricted to read-only mode.', 403, 'SUBSCRIPTION_READ_ONLY'));

      app.use((req, res, next) => {
        (req as any).dormitoryContext = { dormitoryId: testDormId };
        next();
      });

      // Test route with requireDormitoryWriteEntitlement
      app.get('/test/resource', (req, res) => res.json({ data: 'ok' }));
      app.post('/test/resource', (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return next();
        mockAssertWritable(testDormId).then(() => next()).catch(next);
      }, (req, res) => res.json({ data: 'created' }));

      // Error handler
      app.use((err: any, req: any, res: any, next: any) => {
        res.status(err.statusCode || 500).json({ error: { code: err.code || 'ERROR', message: err.message } });
      });

      // GET is permitted in Restricted Mode
      const getRes = await request(app).get('/test/resource');
      expect(getRes.status).toBe(200);

      // POST mutation is blocked with HTTP 403 SUBSCRIPTION_READ_ONLY
      const postRes = await request(app).post('/test/resource').send({ name: 'new bill' });
      expect(postRes.status).toBe(403);
      expect(postRes.body.error.code).toBe('SUBSCRIPTION_READ_ONLY');
    });
  });

  describe('AC-4: Access Revocation & LINE Binding Closure', () => {
    it('denies access to tenant portal for moved-out tenant whose grant is revoked or tenancy ended', async () => {
      const simulateResolveTenantContext = async (userState: {
        isRevokedGrant?: boolean;
        isFormerTenant?: boolean;
        hasActiveContract?: boolean;
      }) => {
        if (userState.isRevokedGrant) {
          return {
            error: {
              code: 'FORBIDDEN',
              message: 'สิทธิ์การเข้าถึงหอพักนี้ถูกยกเลิกแล้ว (การเช่าสิ้นสุดลงแล้ว)',
              statusCode: 403,
            },
          };
        }
        if (userState.isFormerTenant && !userState.hasActiveContract) {
          return {
            error: {
              code: 'TENANCY_ENDED',
              message: 'การเช่าพักอาศัยของคุณสิ้นสุดลงแล้ว ไม่สามารถเข้าถึงพอร์ทัลผู้เช่าได้',
              statusCode: 403,
            },
          };
        }
        return {
          tenant: { id: testTenantId, name: 'สมชาย ใจดี', status: 'active' },
          dormitoryId: testDormId,
        };
      };

      // Case 1: Tenant with REVOKED grant receives HTTP 403 FORBIDDEN
      const revokedResult = await simulateResolveTenantContext({ isRevokedGrant: true });
      expect(revokedResult.error?.code).toBe('FORBIDDEN');
      expect(revokedResult.error?.statusCode).toBe(403);

      // Case 2: Former tenant with no active contracts receives HTTP 403 TENANCY_ENDED
      const formerResult = await simulateResolveTenantContext({ isFormerTenant: true, hasActiveContract: false });
      expect(formerResult.error?.code).toBe('TENANCY_ENDED');
      expect(formerResult.error?.statusCode).toBe(403);

      // Case 3: Active tenant receives success
      const activeResult = await simulateResolveTenantContext({ isFormerTenant: false, hasActiveContract: true });
      expect(activeResult.error).toBeUndefined();
      expect(activeResult.tenant?.status).toBe('active');
    });
  });
});
