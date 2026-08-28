import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeterService } from '../../services/meter.service.js';
import * as prismaModule from '../../db/prisma.js';

vi.mock('../../db/prisma.js', () => {
  const mockPrisma = {
    room: { findMany: vi.fn() },
    contract: { findMany: vi.fn() },
    provisionalRentalTerm: { findMany: vi.fn() },
    dailyStay: { findMany: vi.fn() },
    householdMember: { groupBy: vi.fn() },
    tenantVehicle: { findMany: vi.fn() },
    tenantCoOccupant: { findMany: vi.fn() },
    bill: { findMany: vi.fn() },
    meterReading: { findMany: vi.fn() },
    roomBillingCycleSnapshot: { findMany: vi.fn() },
    meterWorkspaceRoomSnapshot: { findMany: vi.fn() },
  };
  return {
    getPrismaClient: () => mockPrisma,
    prisma: mockPrisma,
  };
});

describe('OWNER ROOMS R3 — Meter Service Preview Context DTO & State Authority', () => {
  const dormitoryId = 'dorm-test-1';
  const billingCycleId = 'cycle-2026-08';
  let meterService: MeterService;
  let mockCycleRepo: any;
  let mockMeterRepo: any;
  let mockRoomRepo: any;
  let mockPrisma: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = (prismaModule as any).getPrismaClient();

    mockCycleRepo = {
      findById: vi.fn().mockResolvedValue({
        id: billingCycleId,
        dormitoryId,
        cycleCode: '2026-08',
        periodStart: new Date('2026-08-01T00:00:00.000Z'),
        periodEnd: new Date('2026-08-31T23:59:59.999Z'),
        status: 'OPEN',
      }),
      findRateSnapshot: vi.fn().mockResolvedValue({
        waterRate: '18.00',
        electricityRate: '7.00',
        waterBillingType: 'per_unit',
        electricityBillingType: 'per_unit',
        parkingFee: '300.00',
        parkingFeeMode: 'per_room',
        commonFee: '200.00',
        garbageFee: '50.00',
      }),
    };

    mockMeterRepo = {};
    mockRoomRepo = {
      findAll: vi.fn().mockResolvedValue({ items: [] }),
    };

    mockPrisma.householdMember.groupBy.mockResolvedValue([]);
    mockPrisma.tenantVehicle.findMany.mockResolvedValue([]);
    mockPrisma.tenantCoOccupant.findMany.mockResolvedValue([]);
    mockPrisma.bill.findMany.mockResolvedValue([]);
    mockPrisma.meterReading.findMany.mockResolvedValue([]);
    mockPrisma.roomBillingCycleSnapshot.findMany.mockResolvedValue([]);
    mockPrisma.meterWorkspaceRoomSnapshot.findMany.mockResolvedValue([]);

    meterService = new MeterService(mockMeterRepo, mockCycleRepo, mockRoomRepo);
  });

  it('1. MONTHLY Contract in selected cycle resolves agreementType = MONTHLY, rent, and authoritative deposit', async () => {
    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-101', roomNumber: '101', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([
      {
        id: 'ctr-101',
        roomId: 'room-101',
        dormitoryId,
        tenantId: 'tenant-1',
        rentBillingType: 'monthly',
        rentAmount: '4500.00',
        depositAmount: '5000.00',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.999Z'),
        status: 'active',
        tenant: { displayName: 'นาย สมชาย สบายดี', linkedUserId: null },
        snapshot: { resolvedDeposit: '5000.00' },
      },
    ]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r101 = result.rooms[0];
    expect(r101.roomId).toBe('room-101');
    expect(r101.cyclePresentationState).toBe('ACTIVE_AGREEMENT');
    expect(r101.agreementType).toBe('MONTHLY');
    expect(r101.rentAmount).toBe('4500.00');
    expect(r101.agreementDepositAmount).toBe('5000.00');
    expect(r101.tenantName).toBe('นาย สมชาย สบายดี');
  });

  it('2. TERM Contract in selected cycle resolves agreementType = TERM', async () => {
    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-102', roomNumber: '102', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([
      {
        id: 'ctr-102',
        roomId: 'room-102',
        dormitoryId,
        tenantId: 'tenant-2',
        rentBillingType: 'term',
        rentAmount: '18000.00',
        depositAmount: '18000.00',
        startDate: new Date('2026-06-01T00:00:00.000Z'),
        endDate: new Date('2026-11-30T23:59:59.999Z'),
        status: 'active',
        tenant: { displayName: 'นางสาว สมหญิง มิ่งเมือง', linkedUserId: null },
        snapshot: null,
      },
    ]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r102 = result.rooms[0];
    expect(r102.cyclePresentationState).toBe('ACTIVE_AGREEMENT');
    expect(r102.agreementType).toBe('TERM');
    expect(r102.agreementDepositAmount).toBe('18000.00');
  });

  it('3. DAILY Stay currently active in selected cycle resolves agreementType = DAILY and daily agreement deposit', async () => {
    const now = new Date();
    const start = new Date(now.getTime() - 86400000);
    const end = new Date(now.getTime() + 86400000);

    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-103', roomNumber: '103', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([
      {
        id: 'daily-103',
        roomId: 'room-103',
        dormitoryId,
        tenantId: 'tenant-daily-1',
        applicantFullName: 'คุณ วิชัย พักชั่วคราว',
        totalRentAmount: '1200.00',
        depositAmount: '1000.00',
        depositDeclaredStatus: 'UNPAID',
        startDate: start,
        endDate: end,
        inclusiveDayCount: 2,
        status: 'ACTIVE',
        invoice: { items: [{ itemType: 'DEPOSIT', amount: '1000.00', status: 'UNPAID' }] },
      },
    ]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r103 = result.rooms[0];
    expect(r103.cyclePresentationState).toBe('ACTIVE_AGREEMENT');
    expect(r103.agreementType).toBe('DAILY');
    expect(r103.agreementDepositAmount).toBe('1000.00');
    expect(r103.tenantName).toBe('คุณ วิชัย พักชั่วคราว');
  });

  it('4. Future reservation in selected cycle resolves state = RESERVED_IN_CYCLE', async () => {
    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-104', roomNumber: '104', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([
      {
        id: 'prov-104',
        roomId: 'room-104',
        dormitoryId,
        tenantId: 'tenant-fut',
        rentalType: 'MONTHLY',
        unitRentAmount: '5000.00',
        depositAmount: '5000.00',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-02-28T23:59:59.999Z'),
        status: 'RESERVED',
        tenant: { displayName: 'นาย อนาคต สดใส', linkedUserId: null },
      },
    ]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r104 = result.rooms[0];
    expect(r104.cyclePresentationState).toBe('RESERVED_IN_CYCLE');
    expect(r104.billingSource).toBe('NONE');
    expect(r104.tenantName).toBe('นาย อนาคต สดใส');
  });

  it('5. Room with NO agreement in selected cycle resolves state = NO_AGREEMENT_IN_CYCLE', async () => {
    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-105', roomNumber: '105', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r105 = result.rooms[0];
    expect(r105.cyclePresentationState).toBe('NO_AGREEMENT_IN_CYCLE');
    expect(r105.agreementType).toBeNull();
    expect(r105.agreementDepositAmount).toBeNull();
    expect(r105.tenantId).toBeNull();
    expect(r105.billingSource).toBe('NONE');
  });

  it('6. Checked-out Daily Stay with unpaid invoice in cycle resolves state = DAILY_FINANCIAL_TAIL', async () => {
    mockRoomRepo.findAll.mockResolvedValue({
      items: [{ id: 'room-106', roomNumber: '106', dormitoryId }],
    });
    mockPrisma.contract.findMany.mockResolvedValue([]);
    mockPrisma.provisionalRentalTerm.findMany.mockResolvedValue([]);
    mockPrisma.dailyStay.findMany.mockResolvedValue([
      {
        id: 'daily-106',
        roomId: 'room-106',
        dormitoryId,
        tenantId: 'tenant-tail',
        applicantFullName: 'คุณ สายัณห์ พักแล้วค้างจ่าย',
        totalRentAmount: '800.00',
        depositAmount: '500.00',
        startDate: new Date('2026-08-02T00:00:00.000Z'),
        endDate: new Date('2026-08-04T23:59:59.999Z'),
        inclusiveDayCount: 2,
        status: 'CHECKED_OUT',
        invoice: {
          status: 'UNPAID',
          items: [{ itemType: 'RENT', amount: '800.00', status: 'UNPAID' }],
        },
      },
    ]);

    const result = await meterService.getMeterBillingPreviewContext(dormitoryId, billingCycleId);
    expect(result.rooms).toHaveLength(1);
    const r106 = result.rooms[0];
    expect(r106.cyclePresentationState).toBe('DAILY_FINANCIAL_TAIL');
    expect(r106.dailyTenantName).toBe('คุณ สายัณห์ พักแล้วค้างจ่าย');
    expect(r106.agreementType).toBe('DAILY');
    expect(r106.agreementDepositAmount).toBe('500.00');
  });
});
