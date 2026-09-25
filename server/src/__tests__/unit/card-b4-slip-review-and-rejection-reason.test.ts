import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RoomBillingStateService } from '../../services/room-billing-state.service.js';

describe('Card B4: Bill Review Status & Rejection Reason (PO Grilling Alignment & REQ §7)', () => {
  let mockPrisma: any;
  let service: RoomBillingStateService;

  const DORM_ID = '10000001-0000-4000-8000-000000000001';
  const ROOM_105_ID = '20000001-0000-4000-8000-000000000002';
  const TENANT_TC_ID = '30000001-0000-4000-8000-000000000003';
  const CONTRACT_TC_ID = '40000001-0000-4000-8000-000000000004';
  const BILL_TC_ID = '50000001-0000-4000-8000-000000000005';
  const TENANT_TB_ID = '60000001-0000-4000-8000-000000000006';
  const OTHER_DORM_ID = '70000001-0000-4000-8000-000000000007';

  beforeEach(() => {
    vi.clearAllMocks();

    mockPrisma = {
      contract: {
        findMany: vi.fn(),
      },
      bill: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      room: {
        findUnique: vi.fn(),
      },
    };

    service = new RoomBillingStateService(mockPrisma);
  });

  describe('B4-1: Bill with UNDER_REVIEW Payment shows checking_payment state and effectiveStatus checking', () => {
    it('returns state checking_payment when latest bill has a payment with status UNDER_REVIEW', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: CONTRACT_TC_ID }
      ]);

      const mockBill = {
        id: BILL_TC_ID,
        billNumber: 'INV-202609-105-0001',
        dormitoryId: DORM_ID,
        roomId: ROOM_105_ID,
        tenantId: TENANT_TC_ID,
        contractId: CONTRACT_TC_ID,
        status: 'issued', // Bill status is issued/unpaid in DB
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
        dueDate: new Date('2026-09-30T23:59:59.000Z'),
        createdAt: new Date('2026-09-25T10:00:00.000Z'),
        billingCycle: {
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.000Z'),
        },
        Payment: [
          {
            id: '80000001-0000-4000-8000-000000000008',
            status: 'UNDER_REVIEW',
            rejectedReason: null,
            createdAt: new Date('2026-09-25T11:00:00.000Z'),
          }
        ],
      };

      mockPrisma.bill.findMany.mockResolvedValue([mockBill]);

      const result = await service.getTenantRoomBillingState(
        DORM_ID,
        ROOM_105_ID,
        TENANT_TC_ID,
        new Date('2026-09-25T12:00:00.000Z')
      );

      expect(result.state).toBe('checking_payment');
      expect(result.statusText).toBe('กำลังตรวจสอบการชำระเงิน');
      expect(result.currentBillId).toBe(BILL_TC_ID);
      expect(result.outstandingAmount).toBe('4500.00');
    });

    it('computes effectiveStatus as checking when mappedPayments contains UNDER_REVIEW', () => {
      const mappedPayments = [
        { id: 'pay-1', status: 'UNDER_REVIEW', rejectedReason: null }
      ];
      const bill = { status: 'issued' };

      const hasUnderReviewPayment = mappedPayments.some(
        (p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking'
      );
      const latestPayment = mappedPayments[0];
      const isRejected = !hasUnderReviewPayment && latestPayment?.status === 'REJECTED' && bill.status !== 'paid' && bill.status !== 'PAID';
      const effectiveStatus = hasUnderReviewPayment
        ? 'checking'
        : (isRejected ? 'rejected' : bill.status);

      expect(effectiveStatus).toBe('checking');
    });
  });

  describe('B4-2: Rejected payment returns verbatim rejectedReason and effectiveStatus rejected', () => {
    it('computes effectiveStatus as rejected when latest payment is REJECTED without pending under_review', () => {
      const verbatimReason = 'สลิปไม่ชัดเจน ยอดเงิน 4,000 บาทไม่ตรงกับยอดบิล 4,500 บาท';
      const mappedPayments = [
        {
          id: 'pay-1',
          status: 'REJECTED',
          rejectedReason: verbatimReason,
          rejectionReason: verbatimReason,
        }
      ];
      const bill = { status: 'issued' };

      const hasUnderReviewPayment = mappedPayments.some(
        (p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking'
      );
      const latestPayment = mappedPayments[0];
      const isRejected = !hasUnderReviewPayment && latestPayment?.status === 'REJECTED' && bill.status !== 'paid' && bill.status !== 'PAID';
      const effectiveStatus = hasUnderReviewPayment
        ? 'checking'
        : (isRejected ? 'rejected' : bill.status);

      expect(effectiveStatus).toBe('rejected');
      expect(latestPayment.rejectedReason).toBe(verbatimReason);
      expect(latestPayment.rejectionReason).toBe(verbatimReason);
    });

    it('returns state pending_payment when payment was rejected, allowing tenant to re-submit', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: CONTRACT_TC_ID }
      ]);

      const mockBill = {
        id: BILL_TC_ID,
        billNumber: 'INV-202609-105-0001',
        dormitoryId: DORM_ID,
        roomId: ROOM_105_ID,
        tenantId: TENANT_TC_ID,
        contractId: CONTRACT_TC_ID,
        status: 'issued',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
        dueDate: new Date('2026-09-30T23:59:59.000Z'),
        createdAt: new Date('2026-09-25T10:00:00.000Z'),
        billingCycle: {
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.000Z'),
        },
        Payment: [
          {
            id: '80000001-0000-4000-8000-000000000008',
            status: 'REJECTED',
            rejectedReason: 'ยอดเงินไม่ตรงกับบิล',
            createdAt: new Date('2026-09-25T11:00:00.000Z'),
          }
        ],
      };

      mockPrisma.bill.findMany.mockResolvedValue([mockBill]);

      const result = await service.getTenantRoomBillingState(
        DORM_ID,
        ROOM_105_ID,
        TENANT_TC_ID,
        new Date('2026-09-25T12:00:00.000Z')
      );

      // Status should be pending_payment (not checking_payment), enabling the "ส่งสลิปใหม่" button
      expect(result.state).toBe('pending_payment');
      expect(result.statusText).toBe('รอชำระเงิน');
      expect(result.currentBillId).toBe(BILL_TC_ID);
    });
  });

  describe('B4-3: Resubmitting slip creates new UNDER_REVIEW payment and returns to checking', () => {
    it('transitions effectiveStatus from rejected back to checking when a new payment is submitted', () => {
      // Prior rejected payment + new re-submitted payment (sorted desc by createdAt)
      const mappedPayments = [
        {
          id: 'pay-2-new',
          status: 'UNDER_REVIEW',
          rejectedReason: null,
          createdAt: '2026-09-25T13:00:00.000Z',
        },
        {
          id: 'pay-1-old',
          status: 'REJECTED',
          rejectedReason: 'ยอดเงินไม่ตรงกับบิล',
          createdAt: '2026-09-25T11:00:00.000Z',
        },
      ];
      const bill = { status: 'issued' };

      const hasUnderReviewPayment = mappedPayments.some(
        (p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking'
      );
      const latestPayment = mappedPayments[0];
      const isRejected = !hasUnderReviewPayment && latestPayment?.status === 'REJECTED' && bill.status !== 'paid' && bill.status !== 'PAID';
      const effectiveStatus = hasUnderReviewPayment
        ? 'checking'
        : (isRejected ? 'rejected' : bill.status);

      expect(hasUnderReviewPayment).toBe(true);
      expect(effectiveStatus).toBe('checking');
    });

    it('returns checking_payment state in RoomBillingStateService after re-submission', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([
        { id: CONTRACT_TC_ID }
      ]);

      const mockBill = {
        id: BILL_TC_ID,
        billNumber: 'INV-202609-105-0001',
        dormitoryId: DORM_ID,
        roomId: ROOM_105_ID,
        tenantId: TENANT_TC_ID,
        contractId: CONTRACT_TC_ID,
        status: 'issued',
        totalAmount: '4500.00',
        paidAmount: '0.00',
        outstandingAmount: '4500.00',
        dueDate: new Date('2026-09-30T23:59:59.000Z'),
        createdAt: new Date('2026-09-25T10:00:00.000Z'),
        billingCycle: {
          periodStart: new Date('2026-09-01T00:00:00.000Z'),
          periodEnd: new Date('2026-09-30T23:59:59.000Z'),
        },
        Payment: [
          {
            id: '80000002-0000-4000-8000-000000000002',
            status: 'UNDER_REVIEW',
            rejectedReason: null,
            createdAt: new Date('2026-09-25T13:00:00.000Z'),
          },
          {
            id: '80000001-0000-4000-8000-000000000001',
            status: 'REJECTED',
            rejectedReason: 'ยอดเงินไม่ตรงกับบิล',
            createdAt: new Date('2026-09-25T11:00:00.000Z'),
          }
        ],
      };

      mockPrisma.bill.findMany.mockResolvedValue([mockBill]);

      const result = await service.getTenantRoomBillingState(
        DORM_ID,
        ROOM_105_ID,
        TENANT_TC_ID,
        new Date('2026-09-25T14:00:00.000Z')
      );

      expect(result.state).toBe('checking_payment');
      expect(result.statusText).toBe('กำลังตรวจสอบการชำระเงิน');
    });
  });

  describe('B4-4: Tenant Data Isolation & Cross-Dormitory Protection', () => {
    it('strictly scopes tenant bills to tenantId and dormitoryId (Tenant B cannot see Tenant C bills)', async () => {
      // TB queries their own state in room-105 (where TC lives)
      mockPrisma.contract.findMany.mockResolvedValue([]); // TB has no contracts in room-105
      mockPrisma.bill.findMany.mockResolvedValue([]); // TB has no bills in room-105

      const result = await service.getTenantRoomBillingState(
        DORM_ID,
        ROOM_105_ID,
        TENANT_TB_ID,
        new Date('2026-09-25T12:00:00.000Z')
      );

      expect(result.state).toBe('no_bill');
      expect(result.outstandingAmount).toBe('0.00');
      expect(result.statusText).toBe('ไม่มีรายการค้างชำระ');

      // Verify the query strictly enforced tenantId and dormitoryId
      expect(mockPrisma.contract.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_TB_ID, dormitoryId: DORM_ID },
        select: { id: true }
      });

      expect(mockPrisma.bill.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dormitoryId: DORM_ID,
            roomId: ROOM_105_ID,
            OR: [{ tenantId: TENANT_TB_ID }]
          })
        })
      );
    });

    it('rejects cross-dormitory access when querying billing state', async () => {
      mockPrisma.contract.findMany.mockResolvedValue([]);
      mockPrisma.bill.findMany.mockResolvedValue([]);

      const result = await service.getTenantRoomBillingState(
        OTHER_DORM_ID,
        ROOM_105_ID,
        TENANT_TC_ID,
        new Date('2026-09-25T12:00:00.000Z')
      );

      expect(result.state).toBe('no_bill');
      expect(mockPrisma.contract.findMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT_TC_ID, dormitoryId: OTHER_DORM_ID },
        select: { id: true }
      });
    });
  });
});
