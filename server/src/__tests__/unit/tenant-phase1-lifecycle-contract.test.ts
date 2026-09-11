import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContractService } from '../../services/contract.service.js';
import { InMemoryContractRepository } from '../../db/repositories/contract.repository.js';
import { InMemoryRoomRepository } from '../../db/repositories/room.repository.js';
import { InMemoryTenantRepository, PrismaTenantRepository } from '../../db/repositories/tenant.repository.js';
import { isAgreementEligibleForBillingCycle } from '../../utils/calendar-date.util.js';
import { TenantRegistrationService } from '../../services/tenant-registration.service.js';

const { mockPrisma, state } = vi.hoisted(() => {
  const state = {
    updatedOccupancies: [] as any[],
    registrationRequests: new Map<string, any>(),
  };
  const mockPrisma: any = {
    occupancy: {
      updateMany: vi.fn(async ({ where, data }) => {
        state.updatedOccupancies.push({ where, data });
        return { count: 1 };
      }),
    },
    tenantRegistrationRequest: {
      findFirst: vi.fn(async ({ where }) => {
        for (const req of state.registrationRequests.values()) {
          if (where.id && req.id !== where.id) continue;
          if (where.dormitoryId && req.dormitoryId !== where.dormitoryId) continue;
          return req;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where }) => {
        const results: any[] = [];
        for (const req of state.registrationRequests.values()) {
          if (where.dormitoryId && req.dormitoryId !== where.dormitoryId) continue;
          if (where.status?.in && !where.status.in.includes(req.status)) continue;
          results.push(req);
        }
        return results;
      }),
      count: vi.fn(async () => state.registrationRequests.size),
      update: vi.fn(async ({ where, data }) => {
        const existing = state.registrationRequests.get(where.id);
        const updated = { ...existing, ...data };
        state.registrationRequests.set(where.id, updated);
        return updated;
      }),
    },
    tenant: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return { mockPrisma, state };
});

vi.mock('../../db/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
  prisma: mockPrisma,
}));

describe('Tenant Lifecycle Phase 1: Contract Termination, Billing Cycle & Registration', () => {
  const DORM_ID = '11111111-1111-4111-8111-111111111111';
  const ROOM_ID = '22222222-2222-4222-8222-222222222222';
  const TENANT_ID = '33333333-3333-4333-8333-333333333333';
  const CONTRACT_ID = '44444444-4444-4444-8444-444444444444';

  let contractRepo: InMemoryContractRepository;
  let roomRepo: InMemoryRoomRepository;
  let tenantRepo: InMemoryTenantRepository;
  let contractService: ContractService;

  beforeEach(async () => {
    state.updatedOccupancies = [];
    state.registrationRequests.clear();
    contractRepo = new InMemoryContractRepository();
    roomRepo = new InMemoryRoomRepository();
    tenantRepo = new InMemoryTenantRepository();
    contractService = new ContractService(contractRepo, roomRepo, tenantRepo);

    // Seed room
    await roomRepo.create(DORM_ID, {
      id: ROOM_ID,
      buildingId: 'bld-1',
      roomNumber: '101',
      normalizedRoomNumber: '101',
      floor: 1,
      status: 'occupied',
      monthlyRent: '5000.00',
    });
    await roomRepo.update(ROOM_ID, DORM_ID, {
      currentTenantId: TENANT_ID,
      currentContractId: CONTRACT_ID,
    });

    // Seed tenant
    await tenantRepo.create(DORM_ID, {
      id: TENANT_ID,
      tenantNumber: 'T001',
      name: 'สมชาย ผู้เช่าจริง',
      phone: '0812345678',
      status: 'active',
    });

    // Seed contract
    await contractRepo.create(DORM_ID, {
      id: CONTRACT_ID,
      contractNumber: 'CTR-101',
      roomId: ROOM_ID,
      tenantId: TENANT_ID,
      status: 'active',
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2027-07-31T23:59:59.999Z'),
      durationMonths: 12,
      rentAmount: '5000.00',
      depositAmount: '10000.00',
      terms: 'ข้อตกลงเช่า',
    });
  });

  describe('1. Contract Termination Architecture', () => {
    it('1.1 Terminating contract sets contract status to terminated and records termination details', async () => {
      const result = await contractService.terminateContract(CONTRACT_ID, DORM_ID, {
        terminationEffectiveDate: '2026-08-31',
        terminationReason: 'ผู้เช่าย้ายออกก่อนกำหนด',
        depositRefundAmount: '8000.00',
        deductionAmount: '2000.00',
        settlementNote: 'หักค่าทำความสะอาด 2,000 บาท',
        nextRoomStatus: 'vacant',
      });

      expect(result.status).toBe('terminated');
      expect(result.terminationReason).toBe('ผู้เช่าย้ายออกก่อนกำหนด');
      expect(result.terminationEffectiveDate).toBeDefined();

      const contractInDb = await contractRepo.findById(CONTRACT_ID, DORM_ID);
      expect(contractInDb?.status).toBe('terminated');
    });

    it('1.2 Terminating contract updates Occupancy to ENDED in database', async () => {
      await contractService.terminateContract(CONTRACT_ID, DORM_ID, {
        terminationEffectiveDate: '2026-08-31',
        terminationReason: 'คืนห้องพัก',
      });

      expect(mockPrisma.occupancy.updateMany).toHaveBeenCalled();
      expect(state.updatedOccupancies.length).toBeGreaterThan(0);
      const lastUpdate = state.updatedOccupancies[0];
      expect(lastUpdate.data.status).toBe('ENDED');
      expect(lastUpdate.data.endedReason).toBe('คืนห้องพัก');
      expect(lastUpdate.data.endedAt).toBeDefined();
    });

    it('1.3 Terminating contract resets Room status to vacant and clears currentTenantId & currentContractId', async () => {
      await contractService.terminateContract(CONTRACT_ID, DORM_ID, {
        terminationEffectiveDate: '2026-08-31',
        terminationReason: 'คืนห้องพัก',
        nextRoomStatus: 'vacant',
      });

      const updatedRoom = await roomRepo.findById(ROOM_ID, DORM_ID);
      expect(updatedRoom?.status).toBe('vacant');
      expect(updatedRoom?.currentTenantId).toBeNull();
      expect(updatedRoom?.currentContractId).toBeNull();
    });
  });

  describe('2. Half-Open Billing Cycle Eligibility for Terminated Contracts', () => {
    it('2.1 Terminated contract with terminationEffectiveDate 2026-08-31 is eligible for August cycle', () => {
      const isEligible = isAgreementEligibleForBillingCycle({
        agreementStartDate: '2026-08-01',
        agreementEndDate: '2027-07-31',
        cyclePeriodStart: '2026-08-01',
        cyclePeriodEnd: '2026-08-31',
        status: 'terminated',
        terminationEffectiveDate: '2026-08-31',
      });

      expect(isEligible).toBe(true);
    });

    it('2.2 Terminated contract with terminationEffectiveDate 2026-08-31 is NOT eligible for September cycle', () => {
      const isEligible = isAgreementEligibleForBillingCycle({
        agreementStartDate: '2026-08-01',
        agreementEndDate: '2027-07-31',
        cyclePeriodStart: '2026-09-01',
        cyclePeriodEnd: '2026-09-30',
        status: 'terminated',
        terminationEffectiveDate: '2026-08-31',
      });

      expect(isEligible).toBe(false);
    });
  });

  describe('3. Tenant Registration Reject Flow & Repository Filtering', () => {
    let regService: TenantRegistrationService;

    beforeEach(() => {
      regService = new TenantRegistrationService();
    });

    it('3.1 Rejecting a tenant registration request sets status to rejected and stores audit history', async () => {
      const reqId = '55555555-5555-4555-8555-555555555555';
      state.registrationRequests.set(reqId, {
        id: reqId,
        dormitoryId: DORM_ID,
        applicantName: 'สมปอง คำขอทดสอบ',
        phone: '0899999999',
        status: 'pending_owner_approval',
        acceptanceSnapshot: {
          termsSummary: 'สัญญา 12 เดือน',
        },
      });

      const rejectResult = await regService.rejectRequest(reqId, DORM_ID, 'เอกสารบัตรประชาชนไม่ชัดเจน', 'user-owner-1');
      expect(rejectResult.status).toBe('rejected');
      expect(rejectResult.rejectedReason).toBe('เอกสารบัตรประชาชนไม่ชัดเจน');

      const savedReq = state.registrationRequests.get(reqId);
      expect(savedReq.status).toBe('rejected');
      expect(savedReq.acceptanceSnapshot?.revisionHistory).toBeDefined();
      expect(savedReq.acceptanceSnapshot.revisionHistory[0].action).toBe('REJECTED');
      expect(savedReq.acceptanceSnapshot.revisionHistory[0].reason).toBe('เอกสารบัตรประชาชนไม่ชัดเจน');
    });

    it('3.2 PrismaTenantRepository.findAll filters out rejected registration requests', async () => {
      const pendingReqId = '66666666-6666-4666-8666-666666666666';
      const rejectedReqId = '77777777-7777-4777-8777-777777777777';

      state.registrationRequests.set(pendingReqId, {
        id: pendingReqId,
        dormitoryId: DORM_ID,
        applicantName: 'คำขอรออนุมัติ',
        phone: '0811111111',
        status: 'pending_owner_approval',
        approvedTenantId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      state.registrationRequests.set(rejectedReqId, {
        id: rejectedReqId,
        dormitoryId: DORM_ID,
        applicantName: 'คำขอถูกปฏิเสธแล้ว',
        phone: '0822222222',
        status: 'rejected',
        approvedTenantId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      });

      const prismaTenantRepo = new PrismaTenantRepository(mockPrisma);
      const allResult = await prismaTenantRepo.findAll(DORM_ID, { status: 'pending' });

      // Only the pending request should appear; the rejected request MUST NOT appear!
      expect(allResult.items.some(t => t.id === pendingReqId)).toBe(true);
      expect(allResult.items.some(t => t.id === rejectedReqId)).toBe(false);
    });

    it('3.3 InMemoryTenantRepository.findAll excludes status rejected', async () => {
      await tenantRepo.create(DORM_ID, {
        id: 't-rejected',
        tenantNumber: 'T-REJ',
        name: 'นายปฏิเสธ',
        phone: '0800000000',
        status: 'rejected',
      });

      const result = await tenantRepo.findAll(DORM_ID);
      expect(result.items.some(t => t.id === 't-rejected')).toBe(false);
    });
  });
});
