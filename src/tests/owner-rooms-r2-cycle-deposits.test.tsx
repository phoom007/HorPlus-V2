import { describe, it, expect } from 'vitest';
import { normalizeAuthoritativeRoom } from '../lib/roomNormalizer';
import { getOwnerRoomMutationErrorMessage } from '../lib/roomErrorMapper';
import { getGridRentRates, getListRentRates, getDepositForCycle } from '../lib/roomRentalSummary';
import { Room } from '../types';

describe('OWNER ROOMS R2 — Rent-Cycle Deposit Model & Rent Presentation', () => {
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

    it('falls back to concise temporary system error for unknown/internal errors', () => {
      expect(getOwnerRoomMutationErrorMessage({ code: 'UNKNOWN_DB_CRASH', message: 'Prisma Client Error' })).toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่');
      expect(getOwnerRoomMutationErrorMessage(null)).toBe('ระบบขัดข้องชั่วคราว กรุณาลองใหม่');
    });
  });

  describe('3. Rent Presentation Logic (Grid vs List Modes)', () => {
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

    it('List Mode: Primary / Active rate is rendered first, secondary rates follow', () => {
      const listOccupied = getListRentRates(mockOccupiedTermRoom);
      expect(listOccupied.primaryRate.label).toBe('รายเทอม');
      expect(listOccupied.primaryRate.amount).toBe(18000);
      expect(listOccupied.primaryRate.isAgreementRate).toBe(true);
      expect(listOccupied.secondaryRates).toHaveLength(2);
      expect(listOccupied.secondaryRates.map(r => r.label)).toEqual(['รายเดือน', 'รายวัน']);

      const listVacant = getListRentRates(mockVacantRoom);
      expect(listVacant.primaryRate.label).toBe('รายเดือน');
      expect(listVacant.primaryRate.amount).toBe(4500);
      expect(listVacant.secondaryRates).toHaveLength(2);
      expect(listVacant.secondaryRates.map(r => r.label)).toEqual(['รายเทอม', 'รายวัน']);
    });

    it('getDepositForCycle returns cycle-specific deposit correctly', () => {
      expect(getDepositForCycle(mockVacantRoom, 'term')).toBe(9000);
      expect(getDepositForCycle(mockVacantRoom, 'monthly')).toBe(4500);
      expect(getDepositForCycle(mockVacantRoom, 'daily')).toBe(1000);
    });
  });
});
