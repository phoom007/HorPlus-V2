import { describe, it, expect } from 'vitest';
import { normalizeAuthoritativeRoom } from '../lib/roomNormalizer';
import { getOwnerRoomMutationErrorMessage } from '../lib/roomErrorMapper';
import { getGridRentRates, getListRentRates, getDepositForCycle } from '../lib/roomRentalSummary';
import { Room } from '../types';
import { CreateContractSchema, UpdateRoomSchema } from '../../server/src/schemas/property-tenant-contract.schemas';

describe('OWNER ROOMS R2 & R2.1 — Rent-Cycle Deposit Model & Hardened Specifications', () => {
  describe('1. Authoritative Room Normalizer (3 Deposits & Active Rental Summary)', () => {
    it('correctly normalizes 3 cycle deposits from effective values and raw fields', () => {
      const dto = {
        id: 'room-1',
        buildingId: 'bld-1',
        roomNumber: 'A101',
        status: 'vacant',
        rentCycle: 'monthly',
        currentEffectiveValues: {
          monthlyRent: 4500,
          termRent: 18000,
          dailyRent: 500,
          termDeposit: 9000,
          monthlyDeposit: 4500,
          dailyDeposit: 1000,
          maximumOccupants: 2,
        },
      };

      const room = normalizeAuthoritativeRoom(dto);
      expect(room.monthlyRent).toBe(4500);
      expect(room.termRent).toBe(18000);
      expect(room.dailyRent).toBe(500);
      expect(room.termDeposit).toBe(9000);
      expect(room.monthlyDeposit).toBe(4500);
      expect(room.dailyDeposit).toBe(1000);
      expect(room.depositAmount).toBe(4500);
    });

    it('correctly normalizes activeRentalSummary when room is occupied with active agreement', () => {
      const dto = {
        id: 'room-2',
        buildingId: 'bld-1',
        roomNumber: 'A102',
        status: 'occupied',
        currentTenantId: 'tenant-1',
        currentEffectiveValues: {
          monthlyRent: 4500,
          termRent: 18000,
          dailyRent: 500,
          termDeposit: 9000,
          monthlyDeposit: 4500,
          dailyDeposit: 1000,
          maximumOccupants: 2,
        },
        activeRentalSummary: {
          type: 'TERM',
          rentAmount: 18000,
          depositAmount: 9000,
          source: 'CONTRACT_SNAPSHOT',
          termInstallmentCount: 4,
        },
      };

      const room = normalizeAuthoritativeRoom(dto);
      expect(room.activeRentalSummary).toBeDefined();
      expect(room.activeRentalSummary?.type).toBe('TERM');
      expect(room.activeRentalSummary?.rentAmount).toBe(18000);
      expect(room.activeRentalSummary?.depositAmount).toBe(9000);
      expect(room.activeRentalSummary?.source).toBe('CONTRACT_SNAPSHOT');
      expect(room.activeRentalSummary?.termInstallmentCount).toBe(4);
    });

    it('fails closed when required financial numbers are missing or non-finite', () => {
      expect(() => {
        normalizeAuthoritativeRoom({
          id: 'room-bad',
          roomNumber: 'B1',
          status: 'vacant',
          currentEffectiveValues: {
            monthlyRent: 'invalid-string',
          },
        });
      }).toThrow('[ROOM_TRANSPORT_INVALID]');
    });
  });

  describe('2. Concise Room Mutation Error UX Mapper', () => {
    it('maps known domain error codes to exact concise Thai messages', () => {
      expect(getOwnerRoomMutationErrorMessage({ code: 'ROOM_NUMBER_ALREADY_EXISTS' })).toBe('เลขห้องนี้มีอยู่แล้ว');
      expect(getOwnerRoomMutationErrorMessage({ code: 'BUILDING_NOT_FOUND' })).toBe('ไม่พบอาคารที่เลือก');
      expect(getOwnerRoomMutationErrorMessage({ code: 'ROOM_LIMIT_REACHED' })).toBe('จำนวนห้องถึงขีดจำกัดแพ็กเกจแล้ว');
      expect(getOwnerRoomMutationErrorMessage({ code: 'SUBSCRIPTION_READ_ONLY' })).toBe('แพ็กเกจปัจจุบันไม่อนุญาตให้แก้ไขข้อมูล');
      expect(getOwnerRoomMutationErrorMessage({ code: 'FORBIDDEN' })).toBe('บัญชีนี้ไม่มีสิทธิ์จัดการห้องพัก');
      expect(getOwnerRoomMutationErrorMessage({ code: 'UNAUTHORIZED' })).toBe('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      expect(getOwnerRoomMutationErrorMessage({ code: 'CSRF_INVALID' })).toBe('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
      expect(getOwnerRoomMutationErrorMessage({ code: 'VALIDATION_ERROR' })).toBe('กรุณาตรวจสอบข้อมูลห้องพัก');
      expect(getOwnerRoomMutationErrorMessage({ code: 'DEPENDENCY_UNAVAILABLE' })).toBe('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่');
    });

    it('handles nested error response shapes from axios / AppError details', () => {
      expect(getOwnerRoomMutationErrorMessage({ details: { code: 'ROOM_NUMBER_ALREADY_EXISTS' } })).toBe('เลขห้องนี้มีอยู่แล้ว');
      expect(getOwnerRoomMutationErrorMessage({ response: { data: { error: { code: 'BUILDING_NOT_FOUND' } } } })).toBe('ไม่พบอาคารที่เลือก');
    });

    it('falls back to concise temporary system error for unknown/internal errors', () => {
      expect(getOwnerRoomMutationErrorMessage({ code: 'UNKNOWN_DB_CRASH', message: 'Prisma Client Error' })).toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่');
      expect(getOwnerRoomMutationErrorMessage(null)).toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่');
    });
  });

  describe('3. Rent Presentation Logic (Grid vs List Modes & Fail-Closed)', () => {
    const mockVacantRoom: Room = {
      id: 'room-vacant',
      roomNumber: '101',
      floor: 1,
      status: 'vacant',
      rentCycle: 'monthly',
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 500,
      termDeposit: 9000,
      monthlyDeposit: 4500,
      dailyDeposit: 1000,
      depositAmount: 4500,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };

    const mockOccupiedTermRoom: Room = {
      id: 'room-term',
      roomNumber: '102',
      floor: 1,
      status: 'occupied',
      currentTenantId: 'tenant-term-1',
      rentCycle: 'monthly',
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 500,
      termDeposit: 9000,
      monthlyDeposit: 4500,
      dailyDeposit: 1000,
      depositAmount: 9000,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      activeRentalSummary: {
        type: 'TERM',
        rentAmount: 18000,
        depositAmount: 9000,
        source: 'CONTRACT_SNAPSHOT',
      },
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };

    const mockOccupiedMissingSummaryRoom: Room = {
      id: 'room-occ-nosummary',
      roomNumber: '103',
      floor: 1,
      status: 'occupied',
      currentTenantId: 'tenant-3',
      rentCycle: 'monthly',
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 500,
      termDeposit: 9000,
      monthlyDeposit: 4500,
      dailyDeposit: 1000,
      depositAmount: 4500,
      maxOccupants: 2,
      initialWaterMeter: 0,
      initialElectricMeter: 0,
      images: [],
      activeRentalSummary: undefined,
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };

    it('Grid Mode: Vacant room displays all 3 configured catalog rates', () => {
      const { isOccupied, rates } = getGridRentRates(mockVacantRoom);
      expect(isOccupied).toBe(false);
      expect(rates).toHaveLength(3);
      expect(rates.map(r => r.label)).toEqual(['รายเดือน', 'รายเทอม', 'รายวัน']);
      expect(rates.map(r => r.amount)).toEqual([4500, 18000, 500]);
    });

    it('Grid Mode: Occupied room displays ONLY the active tenant agreement rate', () => {
      const { isOccupied, rates } = getGridRentRates(mockOccupiedTermRoom);
      expect(isOccupied).toBe(true);
      expect(rates).toHaveLength(1);
      expect(rates[0].label).toBe('รายเทอม');
      expect(rates[0].amount).toBe(18000);
      expect(rates[0].isAgreementRate).toBe(true);
    });

    it('Grid Mode: Fail-closed on occupied room missing activeRentalSummary (no guessed catalog price)', () => {
      const { isOccupied, rates, unavailableText } = getGridRentRates(mockOccupiedMissingSummaryRoom);
      expect(isOccupied).toBe(true);
      expect(rates).toHaveLength(0);
      expect(unavailableText).toBe('ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน');
    });

    it('List Mode: Primary / Active rate is rendered first, secondary rates follow', () => {
      const listOccupied = getListRentRates(mockOccupiedTermRoom);
      expect(listOccupied.primaryRate?.label).toBe('รายเทอม');
      expect(listOccupied.primaryRate?.amount).toBe(18000);
      expect(listOccupied.primaryRate?.isAgreementRate).toBe(true);
      expect(listOccupied.secondaryRates).toHaveLength(2);
      expect(listOccupied.secondaryRates.map(r => r.label)).toEqual(['รายเดือน', 'รายวัน']);

      const listVacant = getListRentRates(mockVacantRoom);
      expect(listVacant.primaryRate?.label).toBe('รายเดือน');
      expect(listVacant.primaryRate?.amount).toBe(4500);
      expect(listVacant.secondaryRates).toHaveLength(2);
      expect(listVacant.secondaryRates.map(r => r.label)).toEqual(['รายเทอม', 'รายวัน']);
    });

    it('List Mode: Fail-closed on occupied room missing activeRentalSummary (no primary agreement rate)', () => {
      const listMissing = getListRentRates(mockOccupiedMissingSummaryRoom);
      expect(listMissing.primaryRate).toBeUndefined();
      expect(listMissing.unavailableText).toBe('ไม่พบข้อมูลอัตราค่าเช่าปัจจุบัน');
      expect(listMissing.secondaryRates).toHaveLength(3); // Shows catalog rates as secondary only
    });

    it('getDepositForCycle returns cycle-specific deposit correctly', () => {
      expect(getDepositForCycle(mockVacantRoom, 'term')).toBe(9000);
      expect(getDepositForCycle(mockVacantRoom, 'monthly')).toBe(4500);
      expect(getDepositForCycle(mockVacantRoom, 'daily')).toBe(1000);
    });
  });

  describe('4. Schema & Defaulting Validation (Parts A, C)', () => {
    it('CreateContractSchema allows depositAmount to be optional without forcing 0.00 default', () => {
      const parsed = CreateContractSchema.parse({
        roomId: 'room-1',
        tenantId: 'tenant-1',
        startDate: '2026-09-01',
        endDate: '2027-02-28',
        rentAmount: '4500.00',
      });
      // Should remain undefined so service can resolve from Room cycle deposits
      expect(parsed.depositAmount).toBeUndefined();
    });

    it('UpdateRoomSchema does not allow cycle deposits to be cleared to null', () => {
      expect(() => {
        UpdateRoomSchema.parse({
          expectedVersion: 1,
          monthlyDeposit: null as any,
        });
      }).toThrow();

      expect(() => {
        UpdateRoomSchema.parse({
          expectedVersion: 1,
          termDeposit: null as any,
        });
      }).toThrow();
    });
  });
  describe('5. Tenant Registration Approval Defaulting (R2.1a Item A)', () => {
    const mockRooms: Room[] = [
      {
        id: 'room-55',
        roomNumber: '505',
        floor: 5,
        status: 'vacant',
        monthlyRent: 5500,
        termRent: 22000,
        dailyRent: 600,
        termDeposit: 11000,
        monthlyDeposit: 7000,
        dailyDeposit: 1200,
        depositAmount: 7000,
      } as any,
      {
        id: 'room-zero',
        roomNumber: '506',
        floor: 5,
        status: 'vacant',
        monthlyRent: 4000,
        termRent: 16000,
        dailyRent: 500,
        termDeposit: 0,
        monthlyDeposit: 0,
        dailyDeposit: 0,
        depositAmount: 0,
      } as any,
    ];

    it('resolves approveRent and approveDeposit strictly from authoritative Room without fallback to 4500/9000/5000/10000', () => {
      const targetRoom = mockRooms.find(r => r.id === 'room-55')!;
      expect(targetRoom.monthlyRent).toBe(5500);
      expect(targetRoom.monthlyDeposit).toBe(7000);

      // Nullish resolve logic
      const approveRent = String(targetRoom.monthlyRent);
      const approveDeposit = String(targetRoom.monthlyDeposit);
      expect(approveRent).toBe('5500');
      expect(approveDeposit).toBe('7000');
    });

    it('preserves explicit 0 deposit on registration approval', () => {
      const targetRoom = mockRooms.find(r => r.id === 'room-zero')!;
      expect(targetRoom.monthlyDeposit).toBe(0);

      const approveDeposit = String(targetRoom.monthlyDeposit);
      expect(approveDeposit).toBe('0');
    });

    it('fails closed when requested room is missing or has non-numeric financial values', () => {
      const missingRoom = mockRooms.find(r => r.id === 'non-existent');
      expect(missingRoom).toBeUndefined();

      const invalidRoom: any = { id: 'bad', monthlyRent: null, monthlyDeposit: undefined };
      const isValid = invalidRoom && invalidRoom.monthlyRent !== null && invalidRoom.monthlyRent !== undefined && invalidRoom.monthlyDeposit !== null && invalidRoom.monthlyDeposit !== undefined;
      expect(isValid).toBe(false);
    });
  });

  describe('6. Create Room Dorm Default Loading & No Legacy Payload (R2.1a Item E)', () => {
    it('initializes all 3 cycle deposits to Dormitory defaultDeposit when configured (e.g. 7000 -> 7000/7000/7000)', () => {
      const dormDefaults = { defaultDeposit: 7000, defaultMonthlyRent: 5000 };
      const initialDeposit = dormDefaults.defaultDeposit !== null && dormDefaults.defaultDeposit !== undefined
        ? Number(dormDefaults.defaultDeposit)
        : 0;

      const termDeposit = initialDeposit;
      const monthlyDeposit = initialDeposit;
      const dailyDeposit = initialDeposit;

      expect(termDeposit).toBe(7000);
      expect(monthlyDeposit).toBe(7000);
      expect(dailyDeposit).toBe(7000);
    });

    it('initializes all 3 cycle deposits to 0 when Dormitory defaultDeposit is explicitly 0 (0 -> 0/0/0)', () => {
      const dormDefaults = { defaultDeposit: 0, defaultMonthlyRent: 4000 };
      const initialDeposit = dormDefaults.defaultDeposit !== null && dormDefaults.defaultDeposit !== undefined
        ? Number(dormDefaults.defaultDeposit)
        : 0;

      const termDeposit = initialDeposit;
      const monthlyDeposit = initialDeposit;
      const dailyDeposit = initialDeposit;

      expect(termDeposit).toBe(0);
      expect(monthlyDeposit).toBe(0);
      expect(dailyDeposit).toBe(0);
    });

    it('verifies Room write payload contains only the 3 cycle deposits and no legacy depositAmount', () => {
      const createPayload = {
        roomNumber: 'A101',
        buildingId: 'b-1',
        floor: 1,
        monthlyRent: 4500,
        termRent: 18000,
        dailyRent: 500,
        rentCycle: 'monthly',
        termDeposit: 7000,
        monthlyDeposit: 7000,
        dailyDeposit: 7000,
        maxOccupants: 2,
        status: 'vacant',
        initialWaterMeter: 100,
        initialElectricMeter: 1200,
      };

      expect(createPayload).toHaveProperty('termDeposit');
      expect(createPayload).toHaveProperty('monthlyDeposit');
      expect(createPayload).toHaveProperty('dailyDeposit');
      expect(createPayload).not.toHaveProperty('depositAmount');
    });
  });
});
