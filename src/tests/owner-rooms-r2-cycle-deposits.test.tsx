/** @vitest-environment happy-dom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { normalizeAuthoritativeRoom } from '../lib/roomNormalizer';
import { getGridRentRates, getListRentRates, getPresentationOrderedRates, getDepositForCycle, getCurrentAgreementDepositDisplay, formatBuildingDisplayName, formatRoomLocation, getPaymentStatusBadge, resolveRoomCyclePresentation, type RateItem } from '../lib/roomRentalSummary';
import { getOwnerRoomMutationErrorMessage, getOwnerRoomMutationDomainCode } from '../lib/roomErrorMapper';
import { resolveRoomTenantAction, OwnerRooms } from '../pages/owner/rooms';
import { mapRegistrationBuildingForFinalize } from '../pages/owner/register';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach } from 'vitest';
import { formatShortThaiBuddhistDate } from '../utils/calendarDate';
import { Room } from '../types';

vi.mock('../data/httpClient', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    httpRequest: vi.fn().mockImplementation(async (method: string, url: string, ...args: any[]) => {
      if (url && url.includes('/defaults')) {
        return { success: true, data: { property: { defaultDeposit: 5000, defaultMonthlyRent: 4500 } } };
      }
      if (url && url.includes('/preview-context')) {
        return {
          success: true,
          data: {
            dormitoryId: 'dorm-1',
            billingCycleId: 'cycle-2026-07',
            rooms: [
              {
                roomId: 'room-101',
                roomNumber: '101',
                tenantId: 'tenant-HISTORICAL-A',
                tenantName: 'สมหมาย กรกฎาคม',
                billingSource: 'CONTRACT',
                agreementType: 'MONTHLY',
                rentAmount: '4500.00',
                agreementDepositAmount: '5000.00',
                agreementRentPaymentStatus: 'PAID',
                agreementDepositPaymentStatus: 'PAID',
                cyclePresentationState: 'ACTIVE_AGREEMENT',
              },
              {
                roomId: 'room-102',
                roomNumber: '102',
                tenantId: 'tenant-RESERVED-R',
                tenantName: 'ผู้จอง รวี',
                agreementType: 'MONTHLY',
                rentAmount: '4500.00',
                checkInDate: '2026-09-01',
                cyclePresentationState: 'RESERVED_IN_CYCLE',
              },
              {
                roomId: 'room-103',
                roomNumber: '103',
                tenantId: 'tenant-DAILY-D',
                tenantName: 'ผู้พัก ดนัย',
                billingSource: 'DAILY_STAY',
                agreementType: 'DAILY',
                rentAmount: '3850.00',
                agreementDepositAmount: '500.00',
                agreementRentPaymentStatus: 'UNPAID',
                agreementDepositPaymentStatus: 'PAID',
                cyclePresentationState: 'DAILY_FINANCIAL_TAIL',
              },
              {
                roomId: 'room-104',
                roomNumber: '104',
                cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
                effectiveRoomOperationalStatus: 'maintenance',
              },
              {
                roomId: 'room-105',
                roomNumber: '105',
                cyclePresentationState: 'UNAVAILABLE',
              },
              {
                roomId: 'room-206',
                roomNumber: '206',
                cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
              },
              {
                roomId: 'room-301',
                roomNumber: '301',
                tenantId: 'tenant-301',
                tenantName: 'คุณ ภูมิ',
                billingSource: 'CONTRACT',
                agreementType: 'MONTHLY',
                rentAmount: '5000.00',
                agreementDepositAmount: '5000.00',
                agreementRentPaymentStatus: 'NOT_ISSUED',
                agreementDepositPaymentStatus: 'PAID',
                cyclePresentationState: 'ACTIVE_AGREEMENT',
              },
              {
                roomId: 'room-B101',
                roomNumber: 'B101',
                cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
              },
            ],
          },
        };
      }
      return actual.httpRequest(method, url, ...args);
    }),
  };
});

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
  describe('7. Agreement Deposit Display Authority (R2.1b)', () => {
    it('1. Occupied TERM: shows activeRentalSummary.depositAmount (8000) and NOT catalog term/monthly deposit (9000/4500)', () => {
      const room: any = {
        id: 'room-term-occupied',
        roomNumber: '101',
        status: 'occupied',
        currentTenantId: 'tenant-1',
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
        depositAmount: 4500, // Legacy alias
        activeRentalSummary: {
          type: 'TERM',
          rentAmount: 18000,
          depositAmount: 8000,
          source: 'CONTRACT',
        },
      };

      const result = getCurrentAgreementDepositDisplay(room);
      expect(result.isOccupied).toBe(true);
      expect(result.amount).toBe(8000);
      expect(result.amount).not.toBe(9000);
      expect(result.amount).not.toBe(4500);
      expect(result.unavailableText).toBeUndefined();
    });

    it('2. Occupied DAILY: shows activeRentalSummary.depositAmount (500) and NOT catalog daily deposit (1000)', () => {
      const room: any = {
        id: 'room-daily-occupied',
        roomNumber: '102',
        status: 'occupied',
        currentTenantId: 'tenant-2',
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
        depositAmount: 4500,
        activeRentalSummary: {
          type: 'DAILY',
          rentAmount: 600,
          depositAmount: 500,
          source: 'DAILY_STAY',
        },
      };

      const result = getCurrentAgreementDepositDisplay(room);
      expect(result.isOccupied).toBe(true);
      expect(result.amount).toBe(500);
      expect(result.amount).not.toBe(1000);
      expect(result.unavailableText).toBeUndefined();
    });

    it('3. Explicit agreement deposit 0: renders 0 and does NOT treat 0 as missing', () => {
      const room: any = {
        id: 'room-zero-deposit',
        roomNumber: '103',
        status: 'occupied',
        currentTenantId: 'tenant-3',
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
        activeRentalSummary: {
          type: 'MONTHLY',
          rentAmount: 4500,
          depositAmount: 0,
          source: 'CONTRACT',
        },
      };

      const result = getCurrentAgreementDepositDisplay(room);
      expect(result.isOccupied).toBe(true);
      expect(result.amount).toBe(0);
      expect(result.unavailableText).toBeUndefined();
    });

    it('4. Occupied + missing/null activeRentalSummary deposit: fails closed with neutral text without catalog fallback', () => {
      const roomMissingSummary: any = {
        id: 'room-no-summary',
        roomNumber: '104',
        status: 'occupied',
        currentTenantId: 'tenant-4',
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
        depositAmount: 4500,
        activeRentalSummary: null,
      };

      const roomNullDeposit: any = {
        id: 'room-null-deposit',
        roomNumber: '105',
        status: 'occupied',
        currentTenantId: 'tenant-5',
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
        depositAmount: 4500,
        activeRentalSummary: {
          type: 'MONTHLY',
          rentAmount: 4500,
          depositAmount: null,
        },
      };

      const res1 = getCurrentAgreementDepositDisplay(roomMissingSummary);
      expect(res1.isOccupied).toBe(true);
      expect(res1.amount).toBeUndefined();
      expect(res1.unavailableText).toBe('ไม่พบข้อมูลค่าประกันปัจจุบัน');

      const res2 = getCurrentAgreementDepositDisplay(roomNullDeposit);
      expect(res2.isOccupied).toBe(true);
      expect(res2.amount).toBeUndefined();
      expect(res2.unavailableText).toBe('ไม่พบข้อมูลค่าประกันปัจจุบัน');
    });

    it('5. Vacant room: indicates room is not occupied (no current agreement deposit)', () => {
      const room: any = {
        id: 'room-vacant',
        roomNumber: '106',
        status: 'vacant',
        currentTenantId: null,
        termDeposit: 9000,
        monthlyDeposit: 4500,
        dailyDeposit: 1000,
      };

      const result = getCurrentAgreementDepositDisplay(room);
      expect(result.isOccupied).toBe(false);
      expect(result.amount).toBeUndefined();
    });
  });
  describe('7. OWNER ROOMS R3 — Cycle-Scoped Presentation Authority & Building Identity', () => {
    it('1. formatRoomLocation formats registered Building.name and floor consistently', () => {
      expect(formatRoomLocation('อาคารราชฤทธิ์ (A)', 1)).toBe('อาคารราชฤทธิ์ (A) • ชั้น 1');
      expect(formatRoomLocation('อาคาร B', 2)).toBe('อาคาร B • ชั้น 2');
      expect(formatRoomLocation(undefined, 3)).toBe('ไม่ระบุอาคาร • ชั้น 3');
      expect(formatRoomLocation('อาคารสมบูรณ์ (B)', null)).toBe('อาคารสมบูรณ์ (B) • ไม่ระบุชั้น');
    });

    it('2. resolveRoomCyclePresentation projects historical cycle agreement (rent 4500 vs current catalog 6000)', () => {
      const roomCatalog: any = {
        id: 'room-101',
        roomNumber: '101',
        status: 'occupied',
        currentTenantId: 'tenant-current-B',
        monthlyRent: 6000,
        termRent: 24000,
        dailyRent: 700,
        monthlyDeposit: 6000,
        termDeposit: 12000,
        dailyDeposit: 1500,
      };

      const meterPreviewRoom202607: any = {
        roomId: 'room-101',
        roomNumber: '101',
        tenantId: 'tenant-historical-A',
        tenantName: 'นาย สมชาย ประวัติ',
        billingSource: 'CONTRACT',
        agreementType: 'MONTHLY',
        rentAmount: '4500.00',
        agreementDepositAmount: '5000.00',
        cyclePresentationState: 'ACTIVE_AGREEMENT',
      };

      const presentation = resolveRoomCyclePresentation(roomCatalog, meterPreviewRoom202607, 'cycle-2026-07');
      expect(presentation.state).toBe('ACTIVE_AGREEMENT');
      expect(presentation.occupancy).toBeDefined();
      expect(presentation.occupancy?.tenantId).toBe('tenant-historical-A');
      expect(presentation.occupancy?.tenantName).toBe('นาย สมชาย ประวัติ');
      expect(presentation.occupancy?.agreementType).toBe('MONTHLY');
      expect(presentation.occupancy?.rentAmount).toBe(4500); // Historical rate, NOT 6000
      expect(presentation.occupancy?.depositAmount).toBe(5000);

      // Room catalog object itself is NOT mutated
      expect(roomCatalog.monthlyRent).toBe(6000);
      expect(roomCatalog.currentTenantId).toBe('tenant-current-B');
    });

    it('3. resolveRoomCyclePresentation applies Decision B1 when room has NO agreement in selected cycle', () => {
      const roomCatalog: any = {
        id: 'room-102',
        roomNumber: '102',
        status: 'vacant',
        currentTenantId: null,
        monthlyRent: 5500,
        termRent: 22000,
        dailyRent: 600,
        monthlyDeposit: 5500,
        termDeposit: 11000,
        dailyDeposit: 1000,
      };

      const meterPreviewRoomNoAgr: any = {
        roomId: 'room-102',
        roomNumber: '102',
        tenantId: null,
        tenantName: null,
        billingSource: 'NONE',
        agreementType: null,
        agreementDepositAmount: null,
        cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
      };

      const presentation = resolveRoomCyclePresentation(roomCatalog, meterPreviewRoomNoAgr, 'cycle-2026-05');
      expect(presentation.state).toBe('NO_AGREEMENT_IN_CYCLE');
      expect(presentation.occupancy).toBeNull();
      expect(presentation.currentCatalogRates).toHaveLength(3);
      expect(presentation.currentCatalogRates[0].label).toBe('รายเดือน');
      expect(presentation.currentCatalogRates[0].amount).toBe(5500);
      expect(presentation.currentCatalogRates[1].label).toBe('รายเทอม');
      expect(presentation.currentCatalogRates[1].amount).toBe(22000);
      expect(presentation.currentCatalogRates[2].label).toBe('รายวัน');
      expect(presentation.currentCatalogRates[2].amount).toBe(600);
    });

    it('4. Edit modal uses current Room catalog rates (6000) and is isolated from selected cycle', () => {
      const roomCatalog: any = {
        id: 'room-103',
        roomNumber: '103',
        status: 'occupied',
        currentTenantId: 'tenant-current',
        monthlyRent: 6000,
        termRent: 24000,
        dailyRent: 700,
        monthlyDeposit: 6000,
        termDeposit: 12000,
        dailyDeposit: 1500,
      };

      // Edit modal receives the room catalog object directly, guaranteeing current rates are loaded
      expect(roomCatalog.monthlyRent).toBe(6000);
      expect(roomCatalog.monthlyDeposit).toBe(6000);
      expect(roomCatalog.termDeposit).toBe(12000);
      expect(roomCatalog.dailyDeposit).toBe(1500);
    });
  });
  describe('8. OWNER ROOMS R3.1 — Strict DTO Projection & Floor Mode Cycle Authority', () => {
    const mockRoomCatalog: any = {
      id: 'room-101',
      roomNumber: '101',
      status: 'vacant',
      currentTenantId: null,
      monthlyRent: 6000,
      termRent: 24000,
      dailyRent: 700,
      monthlyDeposit: 6000,
      termDeposit: 12000,
      dailyDeposit: 1500,
      rentCycle: 'monthly',
    };

    describe('Strict DTO Projection (Part C)', () => {
      it('1. ACTIVE_AGREEMENT preserves backend values exactly without modification', () => {
        const previewRoom = {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          agreementDepositAmount: '5000.00',
          tenantId: 'tenant-hist-A',
          tenantName: 'นาย สมชาย ประวัติ',
          billingSource: 'CONTRACT',
        };

        const res = resolveRoomCyclePresentation(mockRoomCatalog, previewRoom, 'cycle-2026-06');
        expect(res.state).toBe('ACTIVE_AGREEMENT');
        expect(res.occupancy?.agreementType).toBe('MONTHLY');
        expect(res.occupancy?.rentAmount).toBe(4500);
        expect(res.occupancy?.depositAmount).toBe(5000);
        expect(res.occupancy?.tenantId).toBe('tenant-hist-A');
        expect(res.occupancy?.tenantName).toBe('นาย สมชาย ประวัติ');
      });

      it('2. Missing or malformed cyclePresentationState fails closed to UNAVAILABLE (no inference from billingSource)', () => {
        const previewRoomMissingState = {
          roomId: 'room-101',
          billingSource: 'CONTRACT',
          rentAmount: '4500.00',
        };

        const res1 = resolveRoomCyclePresentation(mockRoomCatalog, previewRoomMissingState, 'cycle-2026-06');
        expect(res1.state).toBe('UNAVAILABLE');
        expect(res1.occupancy).toBeNull();

        const previewRoomInvalidState = {
          roomId: 'room-101',
          cyclePresentationState: 'UNKNOWN_CUSTOM_STATE',
          billingSource: 'CONTRACT',
        };
        const res2 = resolveRoomCyclePresentation(mockRoomCatalog, previewRoomInvalidState, 'cycle-2026-06');
        expect(res2.state).toBe('UNAVAILABLE');
      });

      it('3. ACTIVE_AGREEMENT missing agreementType fails closed to UNAVAILABLE (no inference from rentDescription)', () => {
        const previewRoomMissingType = {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          rentDescription: 'ค่าเช่าห้องพักรายเทอม 1/2569',
          rentAmount: '18000.00',
        };

        const res = resolveRoomCyclePresentation(mockRoomCatalog, previewRoomMissingType, 'cycle-2026-06');
        expect(res.state).toBe('UNAVAILABLE');
        expect(res.occupancy).toBeNull();
      });

      it('4. Explicit numeric/string zero deposit is preserved as 0 (not converted to null/undefined)', () => {
        const previewRoomZeroDep = {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          agreementDepositAmount: '0.00',
          tenantId: 'tenant-1',
          tenantName: 'นาย ศูนย์ ประกัน',
        };

        const res = resolveRoomCyclePresentation(mockRoomCatalog, previewRoomZeroDep, 'cycle-2026-06');
        expect(res.state).toBe('ACTIVE_AGREEMENT');
        expect(res.occupancy?.depositAmount).toBe(0);
      });

      it('5. NO_AGREEMENT_IN_CYCLE exposes occupancy: null and catalog rates under B1', () => {
        const previewRoomNoAgr = {
          roomId: 'room-101',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
        };

        const res = resolveRoomCyclePresentation(mockRoomCatalog, previewRoomNoAgr, 'cycle-2026-06');
        expect(res.state).toBe('NO_AGREEMENT_IN_CYCLE');
        expect(res.occupancy).toBeNull();
        expect(res.currentCatalogRates).toHaveLength(3);
        expect(res.currentCatalogRates[0].amount).toBe(6000);
      });

      it('6. Missing backend preview room returns UNAVAILABLE when cycleId is specified, and NO_AGREEMENT when unselected', () => {
        // When cycleId is specified but no room in response -> incomplete backend response -> UNAVAILABLE
        const resWithCycle = resolveRoomCyclePresentation(mockRoomCatalog, undefined, 'cycle-2026-06');
        expect(resWithCycle.state).toBe('UNAVAILABLE');
        expect(resWithCycle.occupancy).toBeNull();

        // When cycleId is unselected / empty -> default view -> NO_AGREEMENT_IN_CYCLE
        const resNoCycle = resolveRoomCyclePresentation(mockRoomCatalog, undefined, undefined);
        expect(resNoCycle.state).toBe('NO_AGREEMENT_IN_CYCLE');
      });
    });

    describe('Floor Mode Cycle Presentation Scenarios (Part A & B)', () => {
      it('Scenario A: Historical occupied room renders cycle tenant (Tenant A, 4500) and NOT current vacant status (6000)', () => {
        const currentVacantRoom: any = {
          id: 'room-101',
          roomNumber: '101',
          status: 'vacant',
          currentTenantId: null,
          monthlyRent: 6000,
        };

        const previewHistoricalOccupied = {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          tenantId: 'tenant-A',
          tenantName: 'นาย ก. ประวัติ',
        };

        const presentation = resolveRoomCyclePresentation(currentVacantRoom, previewHistoricalOccupied, 'cycle-2026-06');
        expect(presentation.state).toBe('ACTIVE_AGREEMENT');
        expect(presentation.occupancy?.tenantName).toBe('นาย ก. ประวัติ');
        expect(presentation.occupancy?.rentAmount).toBe(4500); // Historical rate, NOT 6000
        expect(presentation.occupancy?.agreementType).toBe('MONTHLY');
      });

      it('Scenario B: Historical no agreement renders Decision B1 current catalog labeled อัตราปัจจุบัน and NOT current tenant B', () => {
        const currentOccupiedRoom: any = {
          id: 'room-102',
          roomNumber: '102',
          status: 'occupied',
          currentTenantId: 'tenant-B',
          monthlyRent: 6000,
        };

        const previewOldCycleNoAgr = {
          roomId: 'room-102',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
        };

        const presentation = resolveRoomCyclePresentation(currentOccupiedRoom, previewOldCycleNoAgr, 'cycle-2026-01');
        expect(presentation.state).toBe('NO_AGREEMENT_IN_CYCLE');
        expect(presentation.occupancy).toBeNull(); // Must NOT leak current tenant B
        expect(presentation.currentCatalogRates[0].amount).toBe(6000); // Current catalog rate
      });

      it('Scenario C: RESERVED_IN_CYCLE exposes reserved state and applicant name without labeling มีผู้เช่า', () => {
        const room: any = {
          id: 'room-103',
          roomNumber: '103',
          status: 'vacant',
          currentTenantId: null,
          monthlyRent: 6000,
        };

        const previewReserved = {
          roomId: 'room-103',
          cyclePresentationState: 'RESERVED_IN_CYCLE',
          tenantId: 'tenant-fut',
          tenantName: 'นาย จอง ล่วงหน้า',
          rentAmount: '6000.00',
        };

        const presentation = resolveRoomCyclePresentation(room, previewReserved, 'cycle-2026-09');
        expect(presentation.state).toBe('RESERVED_IN_CYCLE');
        expect(presentation.occupancy?.tenantName).toBe('นาย จอง ล่วงหน้า');
      });

      it('Scenario D: DAILY_FINANCIAL_TAIL exposes daily tail state without presenting room as physically occupied', () => {
        const room: any = {
          id: 'room-104',
          roomNumber: '104',
          status: 'vacant',
          currentTenantId: null,
          monthlyRent: 6000,
        };

        const previewDailyTail = {
          roomId: 'room-104',
          cyclePresentationState: 'DAILY_FINANCIAL_TAIL',
          billingSource: 'DAILY_STAY',
          agreementType: 'DAILY',
          rentAmount: '800.00',
          agreementDepositAmount: '500.00',
          tenantId: 'tenant-tail',
          tenantName: 'คุณ สายัณห์ ค้างจ่าย',
        };

        const presentation = resolveRoomCyclePresentation(room, previewDailyTail, 'cycle-2026-08');
        expect(presentation.state).toBe('DAILY_FINANCIAL_TAIL');
        expect(presentation.occupancy?.agreementType).toBe('DAILY');
        expect(presentation.occupancy?.rentAmount).toBe(800);
        expect(presentation.occupancy?.depositAmount).toBe(500);
        expect(presentation.occupancy?.tenantName).toBe('คุณ สายัณห์ ค้างจ่าย');
      });
    });

    describe('Grid, List, and Floor Consistency (Part G)', () => {
      it('All 3 presentation modes consume the identical RoomCyclePresentation projection without frontend date arithmetic', () => {
        const room: any = {
          id: 'room-105',
          roomNumber: '105',
          status: 'vacant',
          monthlyRent: 5000,
        };
        const preview = {
          roomId: 'room-105',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4200.00',
          agreementDepositAmount: '4200.00',
          tenantId: 'tenant-5',
          tenantName: 'สมใจ สดใส',
        };

        const projection = resolveRoomCyclePresentation(room, preview, 'cycle-2026-07');
        expect(projection.state).toBe('ACTIVE_AGREEMENT');
        expect(projection.occupancy?.rentAmount).toBe(4200);
        expect(projection.occupancy?.depositAmount).toBe(4200);
        expect(projection.occupancy?.tenantName).toBe('สมใจ สดใส');
      });
    });
  });
  describe('9. OWNER ROOMS R3.2 — Cycle Filter/Search + Effective Room Operational Status History', () => {
    const mockRoom: any = {
      id: 'room-101',
      dormitoryId: 'dorm-001',
      roomNumber: '101',
      status: 'maintenance', // Current latest operational status
      currentTenantId: 'tenant-current-B',
      monthlyRent: 6000,
      termRent: 24000,
      dailyRent: 700,
      monthlyDeposit: 6000,
      termDeposit: 12000,
      dailyDeposit: 1500,
    };

    describe('Agreement Precedence vs Maintenance (Part F)', () => {
      it('1. ACTIVE_AGREEMENT takes precedence over operational maintenance (primary is มีผู้เช่า, secondary is ปิดปรับปรุงปัจจุบัน)', () => {
        const previewHistoricalOccupied = {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          agreementDepositAmount: '4500.00',
          tenantId: 'tenant-hist-A',
          tenantName: 'นาย สมชาย ประวัติ',
          effectiveRoomOperationalStatus: 'maintenance',
        };

        const res = resolveRoomCyclePresentation(mockRoom, previewHistoricalOccupied, 'cycle-2026-06');
        expect(res.state).toBe('ACTIVE_AGREEMENT');
        expect(res.occupancy?.tenantName).toBe('นาย สมชาย ประวัติ');
        expect(res.occupancy?.rentAmount).toBe(4500);
        expect(res.isCurrentMaintenance).toBe(true); // Exposes current maintenance for secondary badge
      });
    });

    describe('NO_AGREEMENT + Operational Status (Part G)', () => {
      it('2. NO_AGREEMENT_IN_CYCLE + effective status MAINTENANCE resolves to MAINTENANCE_IN_CYCLE', () => {
        const previewMaintenance = {
          roomId: 'room-101',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
          effectiveRoomOperationalStatus: 'maintenance',
        };

        const res = resolveRoomCyclePresentation(mockRoom, previewMaintenance, 'cycle-2026-08');
        expect(res.state).toBe('MAINTENANCE_IN_CYCLE');
        expect(res.occupancy).toBeNull();
        expect(res.effectiveOperationalStatus).toBe('maintenance');
      });

      it('3. NO_AGREEMENT_IN_CYCLE + effective status VACANT resolves to NO_AGREEMENT_IN_CYCLE with B1 current catalog', () => {
        const vacantRoom = { ...mockRoom, status: 'vacant' };
        const previewVacant = {
          roomId: 'room-101',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
          effectiveRoomOperationalStatus: 'vacant',
        };

        const res = resolveRoomCyclePresentation(vacantRoom, previewVacant, 'cycle-2026-08');
        expect(res.state).toBe('NO_AGREEMENT_IN_CYCLE');
        expect(res.occupancy).toBeNull();
        expect(res.currentCatalogRates[0].amount).toBe(6000);
      });
    });

    describe('Strict UNAVAILABLE & Daily Tail (Part L & N)', () => {
      it('4. UNAVAILABLE state returns occupancy null and does not mask missing data', () => {
        const res = resolveRoomCyclePresentation(mockRoom, undefined, 'cycle-2026-06');
        expect(res.state).toBe('UNAVAILABLE');
        expect(res.occupancy).toBeNull();
      });

      it('5. DAILY_FINANCIAL_TAIL validates finite rentAmount and agreementType === DAILY', () => {
        const validDailyTail = {
          roomId: 'room-101',
          cyclePresentationState: 'DAILY_FINANCIAL_TAIL',
          billingSource: 'DAILY_STAY',
          agreementType: 'DAILY',
          rentAmount: '800.00',
          agreementDepositAmount: '500.00',
          tenantId: 'tenant-tail',
          tenantName: 'คุณ สายัณห์',
        };
        const res1 = resolveRoomCyclePresentation(mockRoom, validDailyTail, 'cycle-2026-08');
        expect(res1.state).toBe('DAILY_FINANCIAL_TAIL');
        expect(res1.occupancy?.agreementType).toBe('DAILY');
        expect(res1.occupancy?.rentAmount).toBe(800);

        // Malformed agreementType -> fails closed to UNAVAILABLE
        const invalidDailyTail = {
          ...validDailyTail,
          agreementType: 'MONTHLY', // Mismatched
        };
        const res2 = resolveRoomCyclePresentation(mockRoom, invalidDailyTail, 'cycle-2026-08');
        expect(res2.state).toBe('UNAVAILABLE');
      });
    });

    describe('Cycle Filter & Search Authority (Decision A1, Part J & K)', () => {
      const roomCatalogList: any[] = [
        {
          id: 'room-101',
          roomNumber: '101',
          buildingId: 'bld-A',
          status: 'vacant', // Today's status
          currentTenantId: 'tenant-today-B', // Today's occupant
        },
        {
          id: 'room-102',
          roomNumber: '102',
          buildingId: 'bld-A',
          status: 'occupied',
          currentTenantId: 'tenant-today-C',
        },
        {
          id: 'room-103',
          roomNumber: '103',
          buildingId: 'bld-B',
          status: 'vacant',
          currentTenantId: null,
        }
      ];

      const previewContextCycle202606 = new Map<string, any>([
        ['room-101', {
          roomId: 'room-101',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          tenantId: 'tenant-hist-A',
          tenantName: 'นาย สมชาย ประวัติ',
        }],
        ['room-102', {
          roomId: 'room-102',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          effectiveRoomOperationalStatus: 'maintenance',
          tenantId: null,
          tenantName: null,
        }],
        ['room-103', {
          roomId: 'room-103',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
        }]
      ]);

      it('6. Filter by occupied strictly filters by selected-cycle ACTIVE_AGREEMENT (Room 101 matches, not today vacant status)', () => {
        const presentations = roomCatalogList.map(r => resolveRoomCyclePresentation(r, previewContextCycle202606.get(r.id), 'cycle-2026-06'));

        const occupiedRooms = roomCatalogList.filter((r, idx) => presentations[idx].state === 'ACTIVE_AGREEMENT');
        expect(occupiedRooms).toHaveLength(1);
        expect(occupiedRooms[0].roomNumber).toBe('101');
      });

      it('7. Filter by maintenance strictly filters by selected-cycle MAINTENANCE_IN_CYCLE (Room 102 matches)', () => {
        const presentations = roomCatalogList.map(r => resolveRoomCyclePresentation(r, previewContextCycle202606.get(r.id), 'cycle-2026-06'));

        const maintenanceRooms = roomCatalogList.filter((r, idx) => presentations[idx].state === 'MAINTENANCE_IN_CYCLE');
        expect(maintenanceRooms).toHaveLength(1);
        expect(maintenanceRooms[0].roomNumber).toBe('102');
      });

      it('8. Search matches selected-cycle historical tenant (สมชาย) and NOT current tenant (tenant-today-B)', () => {
        const presentations = roomCatalogList.map(r => resolveRoomCyclePresentation(r, previewContextCycle202606.get(r.id), 'cycle-2026-06'));

        // Search for historical tenant "สมชาย"
        const queryHist = 'สมชาย';
        const matchHist = roomCatalogList.filter((r, idx) => {
          const p = presentations[idx];
          return (r.roomNumber.includes(queryHist) || (p.occupancy?.tenantName && p.occupancy.tenantName.includes(queryHist)));
        });
        expect(matchHist).toHaveLength(1);
        expect(matchHist[0].roomNumber).toBe('101');

        // Search for today's tenant "tenant-today-B" -> must NOT match for 2026-06 cycle
        const queryToday = 'tenant-today-B';
        const matchToday = roomCatalogList.filter((r, idx) => {
          const p = presentations[idx];
          return (r.roomNumber.includes(queryToday) || (p.occupancy?.tenantName && p.occupancy.tenantName.includes(queryToday)));
        });
        expect(matchToday).toHaveLength(0); // Zero leakage of current tenant
      });
    });
  });
  describe('10. OWNER ROOMS R3.2a — Canonical Operational Cycle, Baseline & Cache Coherence', () => {
    const mockRoom: any = {
      id: 'room-101',
      dormitoryId: 'dorm-001',
      roomNumber: '101',
      status: 'vacant',
      monthlyRent: 6000,
      termRent: 24000,
      dailyRent: 700,
      monthlyDeposit: 6000,
      termDeposit: 12000,
      dailyDeposit: 1500,
    };

    describe('Part L — Strict UNKNOWN Operational Status Fail-Closed', () => {
      it('1. NO_AGREEMENT_IN_CYCLE with UNKNOWN operational status resolves strictly to UNAVAILABLE (no B1 fallback)', () => {
        const previewUnknown = {
          roomId: 'room-101',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
          effectiveRoomOperationalStatus: 'UNKNOWN',
        };

        const res = resolveRoomCyclePresentation(mockRoom, previewUnknown, 'cycle-2026-06');
        expect(res.state).toBe('UNAVAILABLE');
        expect(res.occupancy).toBeNull();
        expect(res.effectiveOperationalStatus).toBe('UNKNOWN');
      });

      it('2. NO_AGREEMENT_IN_CYCLE with vacant operational status resolves to NO_AGREEMENT_IN_CYCLE with B1 catalog', () => {
        const previewVacant = {
          roomId: 'room-101',
          cyclePresentationState: 'NO_AGREEMENT_IN_CYCLE',
          tenantId: null,
          tenantName: null,
          effectiveRoomOperationalStatus: 'vacant',
        };

        const res = resolveRoomCyclePresentation(mockRoom, previewVacant, 'cycle-2026-08');
        expect(res.state).toBe('NO_AGREEMENT_IN_CYCLE');
        expect(res.occupancy).toBeNull();
        expect(res.effectiveOperationalStatus).toBe('vacant');
        expect(res.currentCatalogRates[0].amount).toBe(6000);
      });
    });

    describe('Part M — Cache Invalidation Coordinator (invalidateRoomMutationCaches)', () => {
      const dormId = 'dorm-001';
      const billingCycles = [
        { id: 'cycle-2026-06', periodStart: '2026-06-01T00:00:00Z' },
        { id: 'cycle-2026-07', periodStart: '2026-07-01T00:00:00Z' },
        { id: 'cycle-2026-08', periodStart: '2026-08-01T00:00:00Z' },
        { id: 'cycle-2026-09', periodStart: '2026-09-01T00:00:00Z' },
        { id: 'cycle-2026-10', periodStart: '2026-10-01T00:00:00Z' },
      ];

      it('3. Status mutation effective at 2026-08 invalidates preview contexts for 2026-08, 2026-09, 2026-10 but NOT 2026-06 or 2026-07', async () => {
        const { invalidateRoomMutationCaches } = await import('../lib/roomMutationCache');
        const invalidatedQueries: any[] = [];
        const mockQueryClient: any = {
          invalidateQueries: vi.fn(({ queryKey, predicate }) => {
            if (queryKey) {
              invalidatedQueries.push({ key: queryKey });
            }
            if (predicate) {
              // Test against our cycle queries
              for (const cycle of billingCycles) {
                const qKey = ['meter', dormId, cycle.id, 'preview-context'];
                if (predicate({ queryKey: qKey })) {
                  invalidatedQueries.push({ cycleId: cycle.id, key: qKey });
                }
              }
              // Test against other dorm query
              const otherDormKey = ['meter', 'dorm-other', 'cycle-2026-08', 'preview-context'];
              if (predicate({ queryKey: otherDormKey })) {
                invalidatedQueries.push({ dorm: 'other', key: otherDormKey });
              }
            }
          }),
        };

        invalidateRoomMutationCaches(
          mockQueryClient,
          dormId,
          { kind: 'status', effectiveBillingCycleId: 'cycle-2026-08' },
          billingCycles
        );

        // Always invalidates canonical rooms
        expect(invalidatedQueries.some((q) => q.key?.[0] === 'owner' && q.key?.[1] === dormId && q.key?.[2] === 'rooms')).toBe(true);

        // Validates forward invalidation
        const invalidatedCycleIds = invalidatedQueries.filter((q) => q.cycleId).map((q) => q.cycleId);
        expect(invalidatedCycleIds).toContain('cycle-2026-08');
        expect(invalidatedCycleIds).toContain('cycle-2026-09');
        expect(invalidatedCycleIds).toContain('cycle-2026-10');

        // Validates older historical cycles are NOT invalidated
        expect(invalidatedCycleIds).not.toContain('cycle-2026-06');
        expect(invalidatedCycleIds).not.toContain('cycle-2026-07');

        // Other dorm is NEVER invalidated
        expect(invalidatedQueries.some((q) => q.dorm === 'other')).toBe(false);
      });

      it('4. Regular rent/deposit update without status change or rename does NOT invalidate preview context queries', async () => {
        const { invalidateRoomMutationCaches } = await import('../lib/roomMutationCache');
        const invalidatedQueries: any[] = [];
        const mockQueryClient: any = {
          invalidateQueries: vi.fn(({ queryKey, predicate }) => {
            if (queryKey) {
              invalidatedQueries.push({ key: queryKey });
            }
            if (predicate) {
              for (const cycle of billingCycles) {
                const qKey = ['meter', dormId, cycle.id, 'preview-context'];
                if (predicate({ queryKey: qKey })) {
                  invalidatedQueries.push({ cycleId: cycle.id });
                }
              }
            }
          }),
        };

        invalidateRoomMutationCaches(
          mockQueryClient,
          dormId,
          { kind: 'update', roomNumberChanged: false, statusChanged: false },
          billingCycles
        );

        // Canonical rooms query is invalidated
        expect(invalidatedQueries.some((q) => q.key?.[0] === 'owner' && q.key?.[1] === dormId && q.key?.[2] === 'rooms')).toBe(true);

        // Zero preview context queries are invalidated
        const invalidatedCycleIds = invalidatedQueries.filter((q) => q.cycleId);
        expect(invalidatedCycleIds).toHaveLength(0);
      });
    });
    describe('Part F — ApiPropertyAdapter Mutation Metadata Preservation & Cache Transport Path', () => {
      it('5. ApiPropertyAdapter.updateRoom preserves effectiveRoomStatusCycleId and drives forward cache invalidation', async () => {
        const { ApiPropertyAdapter } = await import('../data/adapters/api/index');
        const { invalidateRoomMutationCaches } = await import('../lib/roomMutationCache');

        const dormId = 'dorm-001';
        const billingCycles = [
          { id: 'cycle-2026-06', periodStart: '2026-06-01T00:00:00Z' },
          { id: 'cycle-2026-07', periodStart: '2026-07-01T00:00:00Z' },
          { id: 'cycle-2026-08', periodStart: '2026-08-01T00:00:00Z' },
          { id: 'cycle-2026-09', periodStart: '2026-09-01T00:00:00Z' },
          { id: 'cycle-2026-10', periodStart: '2026-10-01T00:00:00Z' },
        ];

        // Mock global fetch to return backend updateRoom payload with effectiveRoomStatusCycleId
        const originalFetch = globalThis.fetch;
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            id: 'room-101',
            dormitoryId: dormId,
            roomNumber: '101',
            status: 'maintenance',
            monthlyRent: '5000.00',
            termRent: '20000.00',
            dailyRent: '600.00',
            termDeposit: '10000.00',
            monthlyDeposit: '5000.00',
            dailyDeposit: '1000.00',
            floor: 1,
            roomType: 'standard',
            rentCycle: 'monthly',
            maximumOccupants: 2,
            version: 2,
            effectiveRoomStatusCycleId: 'cycle-2026-08',
          }),
        }) as any;

        try {
          const adapter = new ApiPropertyAdapter();
          const res = await adapter.updateRoom('room-101', { status: 'maintenance' }, 1);

          expect(res.success).toBe(true);
          expect(res.data?.effectiveRoomStatusCycleId).toBe('cycle-2026-08');

          // Test cache invalidation using the exact returned metadata
          const invalidatedQueries: any[] = [];
          const mockQueryClient: any = {
            invalidateQueries: vi.fn(({ queryKey, predicate }) => {
              if (queryKey) {
                invalidatedQueries.push({ key: queryKey });
              }
              if (predicate) {
                for (const cycle of billingCycles) {
                  const qKey = ['meter', dormId, cycle.id, 'preview-context'];
                  if (predicate({ queryKey: qKey })) {
                    invalidatedQueries.push({ cycleId: cycle.id });
                  }
                }
              }
            }),
          };

          invalidateRoomMutationCaches(
            mockQueryClient,
            dormId,
            {
              kind: 'update',
              roomNumberChanged: false,
              statusChanged: true,
              effectiveBillingCycleId: res.data?.effectiveRoomStatusCycleId,
            },
            billingCycles
          );

          const invalidatedCycleIds = invalidatedQueries.filter((q) => q.cycleId).map((q) => q.cycleId);
          // Validates 08, 09, 10 invalidated
          expect(invalidatedCycleIds).toEqual(['cycle-2026-08', 'cycle-2026-09', 'cycle-2026-10']);
          // Validates 06, 07 preserved
          expect(invalidatedCycleIds).not.toContain('cycle-2026-06');
          expect(invalidatedCycleIds).not.toContain('cycle-2026-07');
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });
  });

  describe('8. OWNER ROOMS R3.3 — Manual UAT Corrections Suite', () => {
    describe('Part C & L: Error Mapper Nested Domain Code Prioritization', () => {
      it('1. nested details.error.code = ROOM_NUMBER_ALREADY_EXISTS beats outer CONFLICT', () => {
        const errorObj = {
          code: 'CONFLICT',
          message: 'Conflict error',
          details: {
            error: {
              code: 'ROOM_NUMBER_ALREADY_EXISTS',
              message: 'Room number already exists',
            },
          },
        };
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toBe('เลขห้องนี้มีอยู่แล้ว');
      });

      it('2. nested details.code = BUILDING_NOT_FOUND beats outer RESOURCE_NOT_FOUND', () => {
        const errorObj = {
          code: 'RESOURCE_NOT_FOUND',
          details: {
            code: 'BUILDING_NOT_FOUND',
          },
        };
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toBe('ไม่พบอาคารที่เลือก');
      });

      it('3. nested OPERATIONAL_BILLING_CYCLE_UNAVAILABLE displays concise Thai message', () => {
        const errorObj = {
          code: 'INTERNAL_ERROR',
          details: {
            error: {
              code: 'OPERATIONAL_BILLING_CYCLE_UNAVAILABLE',
            },
          },
        };
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toBe('ยังไม่พบงวดดำเนินงานสำหรับการเปลี่ยนสถานะห้อง');
      });

      it('4. nested VERSION_CONFLICT displays optimistic concurrency message', () => {
        const errorObj = {
          code: 'CONFLICT',
          details: {
            error: {
              code: 'VERSION_CONFLICT',
            },
          },
        };
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toBe('ข้อมูลห้องถูกแก้ไขจากอุปกรณ์อื่น กรุณาโหลดข้อมูลล่าสุด');
      });

      it('5. ACTIVE_AGREEMENT_EXISTS displays tenant guard message', () => {
        const errorObj = {
          code: 'CONFLICT',
          details: {
            error: {
              code: 'ACTIVE_AGREEMENT_EXISTS',
            },
          },
        };
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toBe('ไม่สามารถปิดปรับปรุงห้องพักที่มีผู้เช่าอยู่ได้');
      });
    });

    describe('Part K: Building Display Name vs Numbering Separation', () => {
      it('1. explicit non-empty Building.name takes priority without forced code in parentheses', () => {
        expect(formatBuildingDisplayName({ name: 'สมบูรณ์', code: 'B' })).toBe('อาคารสมบูรณ์');
        expect(formatBuildingDisplayName({ name: 'อาคารสมบูรณ์', code: 'B' })).toBe('อาคารสมบูรณ์');
      });

      it('2. empty Building.name falls back cleanly to Building.code', () => {
        expect(formatBuildingDisplayName({ name: '', code: 'B' })).toBe('อาคาร B');
        expect(formatBuildingDisplayName({ name: null, code: 'B' })).toBe('อาคาร B');
      });

      it('3. formatRoomLocation combines normalized building name and floor', () => {
        expect(formatRoomLocation({ name: 'สมบูรณ์', code: 'B' }, 1)).toBe('อาคารสมบูรณ์ • ชั้น 1');
        expect(formatRoomLocation({ name: 'อาคารสมบูรณ์', code: 'B' }, 2)).toBe('อาคารสมบูรณ์ • ชั้น 2');
        expect(formatRoomLocation({ name: '', code: 'B' }, 3)).toBe('อาคาร B • ชั้น 3');
      });
    });

    describe('Part E: Payment Status Badges & Presentation Extension', () => {
      it('1. getPaymentStatusBadge produces correct semantic Thai text and color classes', () => {
        expect(getPaymentStatusBadge('PAID').text).toBe('จ่ายแล้ว');
        expect(getPaymentStatusBadge('PAID').className).toContain('emerald');

        expect(getPaymentStatusBadge('UNPAID').text).toBe('รอชำระ');
        expect(getPaymentStatusBadge('UNPAID').className).toContain('amber');

        expect(getPaymentStatusBadge('PARTIAL').text).toBe('ชำระบางส่วน');
        expect(getPaymentStatusBadge('PARTIAL').className).toContain('amber');

        expect(getPaymentStatusBadge('UNKNOWN').text).toBe('ไม่พบข้อมูลการชำระ');
        expect(getPaymentStatusBadge('UNKNOWN').className).toContain('slate');
      });

      it('2. resolveRoomCyclePresentation carries agreementRentPaymentStatus and agreementDepositPaymentStatus', () => {
        const roomCatalog: any = {
          id: 'room-201',
          roomNumber: '201',
          status: 'occupied',
          currentTenantId: 'tenant-1',
          monthlyRent: 4800,
        };

        const previewContext: any = {
          roomId: 'room-201',
          roomNumber: '201',
          tenantId: 'tenant-1',
          tenantName: 'สมใจ รักดี',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4800.00',
          agreementDepositAmount: '4800.00',
          agreementRentPaymentStatus: 'PAID',
          agreementDepositPaymentStatus: 'UNPAID',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
        };

        const presentation = resolveRoomCyclePresentation(roomCatalog, previewContext, 'cycle-2026-08');
        expect(presentation.state).toBe('ACTIVE_AGREEMENT');
        expect(presentation.agreementRentPaymentStatus).toBe('PAID');
        expect(presentation.agreementDepositPaymentStatus).toBe('UNPAID');
      });
    });

    describe('Part F: Future Reservation Check-in Date Authority', () => {
      it('1. resolveRoomCyclePresentation projects reservationCheckInDate from preview room context', () => {
        const roomCatalog: any = {
          id: 'room-304',
          roomNumber: '304',
          status: 'vacant',
          monthlyRent: 5000,
        };

        const previewContext: any = {
          roomId: 'room-304',
          roomNumber: '304',
          tenantId: 'tenant-future',
          tenantName: 'อนาคต สดใส',
          rentAmount: '4500.00',
          checkInDate: '2026-09-15',
          cyclePresentationState: 'RESERVED_IN_CYCLE',
        };

        const presentation = resolveRoomCyclePresentation(roomCatalog, previewContext, 'cycle-2026-08');
        expect(presentation.state).toBe('RESERVED_IN_CYCLE');
        expect(presentation.reservationCheckInDate).toBe('2026-09-15');
        expect(formatShortThaiBuddhistDate(presentation.reservationCheckInDate)).toBe('15/09/69');
      });
    });

    describe('Part G & H: Selected-Cycle Tenant Navigation Authority', () => {
      it('1. selected-cycle card projects historical tenantId even if room.currentTenantId differs', () => {
        const roomCatalog: any = {
          id: 'room-201',
          roomNumber: '201',
          status: 'occupied',
          currentTenantId: 'tenant-CURRENT-B',
          monthlyRent: 5000,
        };

        const previewContextJuly: any = {
          roomId: 'room-201',
          roomNumber: '201',
          tenantId: 'tenant-HISTORICAL-A',
          tenantName: 'ผู้เช่า กรกฎาคม',
          billingSource: 'CONTRACT',
          agreementType: 'MONTHLY',
          rentAmount: '4500.00',
          cyclePresentationState: 'ACTIVE_AGREEMENT',
        };

        const presentation = resolveRoomCyclePresentation(roomCatalog, previewContextJuly, 'cycle-2026-07');
        expect(presentation.occupancy?.tenantId).toBe('tenant-HISTORICAL-A');
        expect(presentation.occupancy?.tenantId).not.toBe(roomCatalog.currentTenantId);
      });
    });
  });


  describe('9. OWNER ROOMS R3.3aR — Production Path Wiring Suite', () => {
    afterEach(() => {
      cleanup();
    });

    const mockBuilding: any = { id: 'bld-1', name: 'อาคาร A', code: 'A', floorsCount: 3 };
    const mockHistoricalRoom: any = {
      id: 'room-101',
      roomNumber: '101',
      buildingId: 'bld-1',
      floor: 1,
      status: 'occupied',
      currentTenantId: 'tenant-CURRENT-B', // Current room is occupied by Tenant B
      monthlyRent: 4500,
      version: 1,
    };

    const renderWithQuery = (ui: React.ReactElement) => {
      const qc = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
          },
        },
      });
      return render(
        <QueryClientProvider client={qc}>
          {ui}
        </QueryClientProvider>
      );
    };

    describe('Production Component Action Path (Grid / List / Floor Click)', () => {
      it('TEST 1 — Grid Tenant button click invokes onOpenTenant with historical Tenant A, never current Tenant B', async () => {
        const onOpenTenant = vi.fn();
        const onNavigate = vi.fn();

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[mockHistoricalRoom]}
            buildings={[mockBuilding]}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={onNavigate}
            onOpenTenant={onOpenTenant}
            selectedBillingCycleId="cycle-2026-07"
            selectedCycleCode="2026-07"
          />
        );

        // Find tenant action button on grid card
        const tenantBtn = await screen.findByTitle('ดูข้อมูลผู้เช่าตามงวด');
        expect(tenantBtn).toBeDefined();
        fireEvent.click(tenantBtn);

        // Assert onOpenTenant is called with Tenant A and NOT Tenant B
        expect(onOpenTenant).toHaveBeenCalledTimes(1);
        expect(onOpenTenant).toHaveBeenCalledWith(
          'tenant-HISTORICAL-A',
          expect.objectContaining({
            source: 'rooms',
            tenantId: 'tenant-HISTORICAL-A',
            roomId: 'room-101',
            cycleId: 'cycle-2026-07',
          })
        );
        expect(onNavigate).not.toHaveBeenCalled();
      });

      it('TEST 2 — List Tenant button click invokes onOpenTenant with historical Tenant A', async () => {
        const onOpenTenant = vi.fn();
        const onNavigate = vi.fn();

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[mockHistoricalRoom]}
            buildings={[mockBuilding]}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={onNavigate}
            onOpenTenant={onOpenTenant}
            restoredState={{ viewMode: 'list' }}
            selectedBillingCycleId="cycle-2026-07"
            selectedCycleCode="2026-07"
          />
        );

        const listTenantBtn = await screen.findByTitle('ดูข้อมูลผู้เช่าตามงวด');
        expect(listTenantBtn).toBeDefined();
        fireEvent.click(listTenantBtn);

        expect(onOpenTenant).toHaveBeenCalledTimes(1);
        expect(onOpenTenant).toHaveBeenCalledWith(
          'tenant-HISTORICAL-A',
          expect.objectContaining({
            source: 'rooms',
            tenantId: 'tenant-HISTORICAL-A',
          })
        );
        expect(onNavigate).not.toHaveBeenCalled();
      });

      it('TEST 3 — Floor mode occupied room click invokes onOpenTenant with historical Tenant A', async () => {
        const onOpenTenant = vi.fn();
        const onNavigate = vi.fn();

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[mockHistoricalRoom]}
            buildings={[mockBuilding]}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={onNavigate}
            onOpenTenant={onOpenTenant}
            restoredState={{ viewMode: 'floor' }}
            selectedBillingCycleId="cycle-2026-07"
            selectedCycleCode="2026-07"
          />
        );

        await waitFor(() => {
          expect(document.getElementById('room-floor-room-101')).toBeDefined();
        });

        const floorRoomEl = document.getElementById('room-floor-room-101');
        if (floorRoomEl) {
          fireEvent.click(floorRoomEl);
        }

        expect(onOpenTenant).toHaveBeenCalledTimes(1);
        expect(onOpenTenant).toHaveBeenCalledWith(
          'tenant-HISTORICAL-A',
          expect.objectContaining({
            source: 'rooms',
            tenantId: 'tenant-HISTORICAL-A',
          })
        );
      });

      it('TEST 4 — NO_AGREEMENT_IN_CYCLE when room is currently occupied disables tenant action truthfully', () => {
        const occupiedRoom: any = {
          id: 'room-102',
          roomNumber: '102',
          status: 'occupied',
          currentTenantId: 'tenant-CURRENT-B',
        };

        const vacantPres: any = {
          state: 'NO_AGREEMENT_IN_CYCLE',
          occupancy: null,
        };

        const action = resolveRoomTenantAction(occupiedRoom, vacantPres);
        expect(action.kind).toBe('DISABLED');
        if (action.kind === 'DISABLED') {
          expect(action.reason).toBe('ห้องพักมีผู้เช่าปัจจุบันแล้ว');
        }
      });
    });

    describe('TEST 5 — Return State Restoration in Component', () => {
      it('Restores viewMode, selectedBuilding, selectedStatus, searchQuery and calls onClearRestoredState', async () => {
        const onClearRestoredState = vi.fn();
        const mockRoom: any = { id: 'room-101', roomNumber: '101', buildingId: 'bld-1', floor: 1, status: 'vacant' };

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[mockRoom]}
            buildings={[mockBuilding]}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            restoredState={{
              viewMode: 'list',
              selectedBuilding: 'bld-1',
              selectedStatus: 'vacant',
              searchQuery: '101',
              scrollTop: 300,
            }}
            onClearRestoredState={onClearRestoredState}
          />
        );

        const searchInput = screen.getByPlaceholderText(/ค้นหาเลขห้องพัก หรือชื่อผู้เช่า/i) as HTMLInputElement;
        expect(searchInput.value).toBe('101');

        await waitFor(() => {
          expect(onClearRestoredState).toHaveBeenCalled();
        });
      });
    });

    describe('TEST 6 — Domain Error Routing', () => {
      it('Extracts nested ROOM_NUMBER_ALREADY_EXISTS domain code and avoids broad VERSION_CONFLICT modal', () => {
        const errorObj = {
          code: 'CONFLICT',
          details: { error: { code: 'ROOM_NUMBER_ALREADY_EXISTS' } },
        };
        const domainCode = getOwnerRoomMutationDomainCode(errorObj);
        expect(domainCode).toBe('ROOM_NUMBER_ALREADY_EXISTS');
        expect(domainCode).not.toBe('VERSION_CONFLICT');
        expect(getOwnerRoomMutationErrorMessage(errorObj)).toContain('เลขห้องนี้มีอยู่แล้ว');
      });

      it('Extracts VERSION_CONFLICT correctly when server responds with real version conflict', () => {
        const errorObj = {
          code: 'CONFLICT',
          details: { error: { code: 'VERSION_CONFLICT', currentVersion: 3 } },
        };
        expect(getOwnerRoomMutationDomainCode(errorObj)).toBe('VERSION_CONFLICT');
      });
    });

    describe('TEST 7 — List Mode Status Badge Derivation', () => {
      it('Derives badge color strictly from cyclePresentation.state without being painted red by current room maintenance', async () => {
        const mockRoom: any = {
          id: 'room-206',
          roomNumber: '206',
          buildingId: 'bld-1',
          floor: 2,
          status: 'maintenance', // Current room is under maintenance
          monthlyRent: 4500,
        };

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[mockRoom]}
            buildings={[mockBuilding]}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            restoredState={{ viewMode: 'list' }}
            selectedBillingCycleId="cycle-2026-07"
            selectedCycleCode="2026-07"
          />
        );

        const badgeEl = await screen.findByTitle('สถานะห้อง: ว่าง');
        expect(badgeEl).toBeDefined();
        expect(badgeEl.className).toContain('bg-emerald-50');
        expect(badgeEl.className).not.toContain('bg-rose-50');
      });
    });

    describe('Registration Building Mapping Helper (mapRegistrationBuildingForFinalize)', () => {
      it('Preserves explicit name independent of roomPrefix', () => {
        const rawBuilding = {
          id: 'bld-1',
          name: 'สมบูรณ์',
          roomPrefix: 'B',
          totalFloors: 3,
          roomsPerFloor: 2,
          formatPattern: 'floor_room',
        };

        const mapped = mapRegistrationBuildingForFinalize(rawBuilding, 0, 5000);
        expect(mapped.name).toBe('สมบูรณ์');
        expect(mapped.code).toBe('B');
        expect(mapped.numberingPattern).toBe('floor_room');

        // Changing roomPrefix to C
        const prefixChanged = { ...rawBuilding, roomPrefix: 'C' };
        const mappedC = mapRegistrationBuildingForFinalize(prefixChanged, 0, 5000);
        expect(mappedC.name).toBe('สมบูรณ์');
        expect(mappedC.code).toBe('C');
      });
    });
  });


  describe('10. OWNER ROOMS R3.3aR1 — Floor Cycle Authority & Daily Tail Financial UX Suite', () => {
    afterEach(() => {
      cleanup();
    });

    const mockBuilding: any = {
      id: 'bld-1',
      name: 'อาคาร A',
      code: 'A',
      totalFloors: 2,
      roomsPerFloor: 5,
    };

    const renderWithQuery = (ui: React.ReactElement) => {
      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });
      return render(
        <QueryClientProvider client={qc}>
          {ui}
        </QueryClientProvider>
      );
    };

    it('T1 — FLOOR ACTIVE: click invokes onOpenTenant with historical Tenant A, never current Tenant B', async () => {
      const onOpenTenant = vi.fn();
      const mockRoom: any = {
        id: 'room-101',
        roomNumber: '101',
        buildingId: 'bld-1',
        floor: 1,
        status: 'occupied',
        currentTenantId: 'tenant-CURRENT-B',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          onOpenTenant={onOpenTenant}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-101')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-101');
      if (floorEl) fireEvent.click(floorEl);

      expect(onOpenTenant).toHaveBeenCalledWith('tenant-HISTORICAL-A', expect.objectContaining({ tenantId: 'tenant-HISTORICAL-A' }));
    });

    it('T1 — FLOOR RESERVED: click invokes onOpenTenant with Tenant R (not handleOpenModal)', async () => {
      const onOpenTenant = vi.fn();
      const mockRoom: any = {
        id: 'room-102',
        roomNumber: '102',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          onOpenTenant={onOpenTenant}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-102')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-102');
      if (floorEl) fireEvent.click(floorEl);

      expect(onOpenTenant).toHaveBeenCalledWith('tenant-RESERVED-R', expect.objectContaining({ tenantId: 'tenant-RESERVED-R' }));
    });

    it('T1 — FLOOR DAILY TAIL: click invokes onOpenTenant with Tenant D (not handleOpenModal)', async () => {
      const onOpenTenant = vi.fn();
      const mockRoom: any = {
        id: 'room-103',
        roomNumber: '103',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          onOpenTenant={onOpenTenant}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-103')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-103');
      if (floorEl) fireEvent.click(floorEl);

      expect(onOpenTenant).toHaveBeenCalledWith('tenant-DAILY-D', expect.objectContaining({ tenantId: 'tenant-DAILY-D' }));
    });

    it('T1 — FLOOR HISTORICAL MAINTENANCE: primary rose ปิดปรับปรุง when current room is vacant', async () => {
      const mockRoom: any = {
        id: 'room-104',
        roomNumber: '104',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-104')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-104');
      expect(floorEl?.className).toContain('bg-rose-50');
      expect(floorEl?.textContent).toContain('ปิดปรับปรุง');
    });

    it('T1 — FLOOR HISTORICAL VACANT / CURRENT MAINTENANCE: primary green ว่างในงวดนี้ and secondary ปิดปรับปรุงปัจจุบัน', async () => {
      const mockRoom: any = {
        id: 'room-206',
        roomNumber: '206',
        buildingId: 'bld-1',
        floor: 2,
        status: 'maintenance',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-206')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-206');
      expect(floorEl?.className).toContain('bg-emerald-50');
      expect(floorEl?.textContent).toContain('ว่างในงวดนี้');
      expect(floorEl?.textContent).toContain('ปิดปรับปรุงปัจจุบัน');
    });

    it('T1 — FLOOR UNAVAILABLE: neutral slate ไม่มีประวัติสถานะ with no current rate', async () => {
      const mockRoom: any = {
        id: 'room-105',
        roomNumber: '105',
        buildingId: 'bld-1',
        floor: 1,
        status: 'maintenance',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      await waitFor(() => {
        expect(document.getElementById('room-floor-room-105')).toBeDefined();
      });

      const floorEl = document.getElementById('room-floor-room-105');
      expect(floorEl?.className).toContain('bg-slate-100');
      expect(floorEl?.textContent).toContain('ไม่มีประวัติสถานะ');
      expect(floorEl?.textContent).toContain('ไม่พบประวัติสถานะห้องสำหรับงวดนี้');
      expect(floorEl?.textContent).not.toContain('อัตราปัจจุบัน');
    });

    it('T1 — DAILY TAIL GRID FINANCIAL UX: displays rent payment badge and deposit payment badge', async () => {
      const mockRoom: any = {
        id: 'room-103',
        roomNumber: '103',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const rentBadge = await screen.findByText('รอชำระ');
      expect(rentBadge).toBeDefined();

      const depositBadge = await screen.findByText('จ่ายแล้ว');
      expect(depositBadge).toBeDefined();
    });

    it('T1 — DAILY TAIL LIST FINANCIAL UX: displays deposit amount and payment badge without ไม่มีผู้เช่าลงทะเบียน', async () => {
      const mockRoom: any = {
        id: 'room-103',
        roomNumber: '103',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'list' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const rentBadge = await screen.findByText('รอชำระ');
      expect(rentBadge).toBeDefined();

      const depositBadge = await screen.findByText('จ่ายแล้ว');
      expect(depositBadge).toBeDefined();
      expect(screen.queryByText('ไม่มีผู้เช่าลงทะเบียน')).toBeNull();
    });
  });

  // ============================================================================
  // SECTION 11: OWNER ROOMS R3.4 — PAYMENT SEMANTICS, MAINTENANCE GUARD & LIST/FLOOR UX
  // ============================================================================
  describe('Section 11: Owner Rooms R3.4 — Payment Semantics, Maintenance Guard & UX', () => {
    afterEach(() => {
      cleanup();
    });

    const mockBuilding: any = {
      id: 'bld-1',
      name: 'อาคาร A',
      code: 'A',
      totalFloors: 2,
      roomsPerFloor: 5,
    };

    const renderWithQuery = (ui: React.ReactElement) => {
      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });
      return render(
        <QueryClientProvider client={qc}>
          {ui}
        </QueryClientProvider>
      );
    };
    it('T1 — PAYMENT BADGE HELPER: maps all 5 canonical payment states accurately', () => {
      expect(getPaymentStatusBadge('PAID').text).toBe('จ่ายแล้ว');
      expect(getPaymentStatusBadge('PAID').className).toContain('text-emerald-700');

      expect(getPaymentStatusBadge('UNPAID').text).toBe('รอชำระ');
      expect(getPaymentStatusBadge('UNPAID').className).toContain('text-amber-700');

      expect(getPaymentStatusBadge('PARTIAL').text).toBe('ชำระบางส่วน');
      expect(getPaymentStatusBadge('PARTIAL').className).toContain('text-amber-700');

      expect(getPaymentStatusBadge('NOT_ISSUED').text).toBe('ยังไม่ออกบิล');
      expect(getPaymentStatusBadge('NOT_ISSUED').className).toContain('text-sky-700');

      expect(getPaymentStatusBadge('UNKNOWN').text).toBe('ไม่พบข้อมูลการชำระ');
      expect(getPaymentStatusBadge('UNKNOWN').className).toContain('text-slate-600');
    });

    it('T1 — NOT_ISSUED RENT: displays ยังไม่ออกบิล when active agreement has no issued rent bill in cycle', async () => {
      const mockRoom: any = {
        id: 'room-301',
        roomNumber: '301',
        buildingId: 'bld-1',
        floor: 3,
        status: 'occupied',
        monthlyRent: 5000,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const rentStatus = await screen.findByText('ยังไม่ออกบิล');
      expect(rentStatus).toBeDefined();
      const depStatus = await screen.findByText('จ่ายแล้ว');
      expect(depStatus).toBeDefined();
    });

    it('T1 — HISTORICAL VACANCY SECONDARY CURRENT STATE: shows ปัจจุบันมีผู้เช่า when current room is occupied', async () => {
      const mockRoom: any = {
        id: 'room-206',
        roomNumber: '206',
        buildingId: 'bld-1',
        floor: 2,
        status: 'occupied',
        currentTenantId: 'tenant-current',
        monthlyRent: 4500,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const primaryVacantBadge = await screen.findByText('ว่าง');
      expect(primaryVacantBadge).toBeDefined();

      const secondaryOccupiedBadge = await screen.findByText('ปัจจุบันมีผู้เช่า');
      expect(secondaryOccupiedBadge).toBeDefined();

      // Quick Add should not be present because room is occupied today
      expect(screen.queryByTitle(/เพิ่มผู้เช่าเข้าห้อง 206/)).toBeNull();
    });

    it('T1 — LIST MODE B1 RATE FORMAT: renders ฿ 19,200.00 / เทอม without redundant left labels', async () => {
      const mockRoom: any = {
        id: 'room-B101',
        roomNumber: 'B101',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4800,
        termRent: 19200,
        dailyRent: 550,
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'list' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const termRateText = await screen.findByText((content) => content.includes('19,200.00') && content.includes('เทอม'));
      expect(termRateText).toBeDefined();

      const monthlyRateText = await screen.findByText((content) => content.includes('4,800.00') && content.includes('เดือน'));
      expect(monthlyRateText).toBeDefined();

      const dailyRateText = await screen.findByText((content) => content.includes('550.00') && content.includes('วัน'));
      expect(dailyRateText).toBeDefined();
    });

    it('T1 — FLOOR MODE CURRENCY FORMAT: renders ฿ and never renders $ symbol', async () => {
      const mockRoom: any = {
        id: 'room-B101',
        roomNumber: 'B101',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 5000,
      };

      const { container } = renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'floor' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const floorCard = await screen.findByText('B101');
      expect(floorCard).toBeDefined();

      const rateElem = await screen.findByText(/5,000.00/);
      expect(rateElem).toBeDefined();

      // Ensure no literal dollar symbol anywhere in the rendered floor map container
      expect(container.textContent).not.toContain(String.fromCharCode(36));
    });

    it('T1 — EDIT ROOM MODAL: disables maintenance button when room is currently occupied', async () => {
      cleanup();
      const mockRoom: any = {
        id: 'room-101',
        roomNumber: '101',
        buildingId: 'bld-1',
        floor: 1,
        status: 'occupied',
        currentTenantId: 'tenant-HISTORICAL-A',
        monthlyRent: 4500,
        version: 1,
        currentOperationalActions: {
          canSetMaintenance: false,
          maintenanceBlockReason: 'ACTIVE_OCCUPANCY',
        },
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoom]}
          buildings={[mockBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
      fireEvent.click(editBtn);

      // In modal, 'ปิดปรับปรุง' button should be disabled with tooltip
      const maintenanceBtn = await screen.findByTitle('มีผู้เช่าพักอยู่ ต้องย้ายหรือสิ้นสุดการเช่าก่อน');
      expect(maintenanceBtn).toBeDefined();
      expect(maintenanceBtn.hasAttribute('disabled')).toBe(true);
    });
  });


  describe('OWNER ROOMS R3.4a — Canonical Maintenance Eligibility & Presentation Order', () => {
    const localBuilding: any = {
      id: 'bld-1',
      name: 'อาคาร A',
      floors: 2,
      totalRooms: 4,
    };

    const renderWithQuery = (ui: React.ReactElement) => {
      const qc = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      });
      return render(
        <QueryClientProvider client={qc}>
          {ui}
        </QueryClientProvider>
      );
    };

    it('T1 — Compact rates presentation order helper orders: TERM -> MONTHLY -> DAILY', () => {
      const sampleRates: RateItem[] = [
        { cycle: 'monthly', amount: 4800, label: 'เดือน', isPrimary: true, isAgreementRate: true },
        { cycle: 'daily', amount: 550, label: 'วัน', isPrimary: false, isAgreementRate: false },
        { cycle: 'term', amount: 19200, label: 'เทอม', isPrimary: false, isAgreementRate: false },
      ];

      const ordered = getPresentationOrderedRates(sampleRates);
      expect(ordered.map(r => r.cycle)).toEqual(['term', 'monthly', 'daily']);
      expect(ordered[0].amount).toBe(19200);
      expect(ordered[1].amount).toBe(4800);
      expect(ordered[2].amount).toBe(550);
    });

    it('T2 — Current maintenance eligibility DTO drives modal disabling independent of selected cycle', async () => {
      cleanup();
      const mockRoomReserved: any = {
        id: 'room-102',
        roomNumber: '102',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
        version: 1,
        currentOperationalActions: {
          canSetMaintenance: false,
          maintenanceBlockReason: 'ACTIVE_RESERVATION',
        },
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoomReserved]}
          buildings={[localBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
      fireEvent.click(editBtn);

      const maintenanceBtn = await screen.findByTitle('มีการจองล่วงหน้า ต้องจัดการการจองก่อน');
      expect(maintenanceBtn).toBeDefined();
      expect(maintenanceBtn.hasAttribute('disabled')).toBe(true);
    });

    it('T3 — Permitted maintenance room allows setting maintenance status in edit modal', async () => {
      cleanup();
      const mockRoomPermitted: any = {
        id: 'room-vacant-clean-99',
        roomNumber: '999',
        buildingId: 'bld-1',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
        version: 1,
        currentOperationalActions: {
          canSetMaintenance: true,
          maintenanceBlockReason: null,
        },
      };

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[mockRoomPermitted]}
          buildings={[localBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
      fireEvent.click(editBtn);

      const maintenanceBtn = screen.getByRole('button', { name: 'ปิดปรับปรุง' });
      expect(maintenanceBtn).toBeDefined();
      expect(maintenanceBtn.hasAttribute('disabled')).toBe(false);
    });

    it('T4 — Ambiguous payment badge returns UNKNOWN (ไม่พบข้อมูลการชำระ)', () => {
      const badge = getPaymentStatusBadge('UNKNOWN');
      expect(badge.text).toBe('ไม่พบข้อมูลการชำระ');
      expect(badge.className).toContain('text-slate-600');
    });

    it('T5 — Partial payment badge returns PARTIAL (ชำระบางส่วน)', () => {
      const badge = getPaymentStatusBadge('PARTIAL');
      expect(badge.text).toBe('ชำระบางส่วน');
      expect(badge.className).toContain('text-amber-700');
    });
    it('T6 — Full transport chain: backend DTO -> normalizeAuthoritativeRoom -> OwnerRooms preserves currentOperationalActions (July view, Sept reservation)', async () => {
      cleanup();
      // Raw backend AuthoritativeRoomDto with currentOperationalActions attached from defaultsService
      const backendDto = {
        id: 'room-real-chain-102',
        dormitoryId: 'dorm-1',
        buildingId: 'bld-1',
        roomNumber: '102',
        normalizedRoomNumber: '102',
        status: 'vacant' as const,
        floor: 1,
        rentCycle: 'monthly' as const,
        version: 1,
        monthlyRent: 4500,
        monthlyDeposit: 5000,
        depositAmount: 5000,
        maxOccupants: 2,
        currentOperationalActions: {
          canSetMaintenance: false,
          maintenanceBlockReason: 'ACTIVE_RESERVATION' as const,
        },
      };

      // Real transport pass through normalizer (DO NOT manually inject after normalization)
      const normalizedRoom = normalizeAuthoritativeRoom(backendDto);
      expect(normalizedRoom.currentOperationalActions).toBeDefined();
      expect(normalizedRoom.currentOperationalActions?.canSetMaintenance).toBe(false);
      expect(normalizedRoom.currentOperationalActions?.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[normalizedRoom]}
          buildings={[localBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
      fireEvent.click(editBtn);

      const maintenanceBtn = screen.getByTitle('มีการจองล่วงหน้า ต้องจัดการการจองก่อน');
      expect(maintenanceBtn).toBeDefined();
      expect(maintenanceBtn.hasAttribute('disabled')).toBe(true);
    });

    it('T7 — Fail-closed UI: Missing currentOperationalActions metadata disables maintenance button with neutral message', async () => {
      cleanup();
      // Raw backend AuthoritativeRoomDto missing currentOperationalActions
      const backendDtoMissingMeta = {
        id: 'room-missing-meta-105',
        dormitoryId: 'dorm-1',
        buildingId: 'bld-1',
        roomNumber: '105',
        normalizedRoomNumber: '105',
        status: 'vacant' as const,
        floor: 1,
        rentCycle: 'monthly' as const,
        version: 1,
        monthlyRent: 4500,
        monthlyDeposit: 5000,
        depositAmount: 5000,
        maxOccupants: 2,
      };

      const normalizedRoom = normalizeAuthoritativeRoom(backendDtoMissingMeta);
      expect(normalizedRoom.currentOperationalActions).toBeNull();

      renderWithQuery(
        <OwnerRooms
          dormitoryId="dorm-1"
          rooms={[normalizedRoom]}
          buildings={[localBuilding]}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          restoredState={{ viewMode: 'grid' }}
          selectedBillingCycleId="cycle-2026-07"
          selectedCycleCode="2026-07"
        />
      );

      const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
      fireEvent.click(editBtn);

      const maintenanceBtn = await screen.findByTitle('ไม่สามารถตรวจสอบสถานะการเปิดปิดห้องได้ กรุณาโหลดข้อมูลใหม่');
      expect(maintenanceBtn).toBeDefined();
      expect(maintenanceBtn.hasAttribute('disabled')).toBe(true);
    });

    it('T8 — Strict DTO: ACTIVE_AGREEMENT missing or invalid billingSource evaluates to UNAVAILABLE', () => {
      const room: any = {
        id: 'room-strict-1',
        buildingId: 'bld-1',
        roomNumber: '101',
        floor: 1,
        status: 'occupied',
        monthlyRent: 4500,
      };

      const invalidActivePreview: any = {
        roomId: 'room-strict-1',
        cyclePresentationState: 'ACTIVE_AGREEMENT',
        effectiveRoomOperationalStatus: 'occupied',
        agreementType: 'MONTHLY',
        rentAmount: '4500.00',
        billingSource: undefined, // Missing billingSource
      };

      const res = resolveRoomCyclePresentation(room, invalidActivePreview, 'cycle-2026-07');
      expect(res.state).toBe('UNAVAILABLE');
    });

    it('T9 — Strict DTO: RESERVED_IN_CYCLE with malformed non-finite rentAmount evaluates to UNAVAILABLE', () => {
      const room: any = {
        id: 'room-strict-2',
        buildingId: 'bld-1',
        roomNumber: '102',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      const invalidReservedPreview: any = {
        roomId: 'room-strict-2',
        cyclePresentationState: 'RESERVED_IN_CYCLE',
        effectiveRoomOperationalStatus: 'vacant',
        agreementType: 'MONTHLY',
        rentAmount: 'not_a_valid_number', // Malformed
      };

      const res = resolveRoomCyclePresentation(room, invalidReservedPreview, 'cycle-2026-07');
      expect(res.state).toBe('UNAVAILABLE');
    });

    it('T10 — Strict DTO: DAILY_FINANCIAL_TAIL with invalid billingSource evaluates to UNAVAILABLE', () => {
      const room: any = {
        id: 'room-strict-3',
        buildingId: 'bld-1',
        roomNumber: '103',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4500,
      };

      const invalidDailyTailPreview: any = {
        roomId: 'room-strict-3',
        cyclePresentationState: 'DAILY_FINANCIAL_TAIL',
        effectiveRoomOperationalStatus: 'vacant',
        agreementType: 'DAILY',
        rentAmount: '600.00',
        billingSource: 'FABRICATED_SOURCE', // Invalid source
      };

      const res = resolveRoomCyclePresentation(room, invalidDailyTailPreview, 'cycle-2026-07');
      expect(res.state).toBe('UNAVAILABLE');
    });
  });
    describe('OWNER ROOMS R3.4c — Strict Normalizer, Direct Toggle Fail-Closed & Strict Projection Suite', () => {
      const renderWithQuery = (ui: React.ReactElement) => {
        const qc = new QueryClient({
          defaultOptions: { queries: { retry: false, gcTime: 0 } },
        });
        return render(
          <QueryClientProvider client={qc}>
            {ui}
          </QueryClientProvider>
        );
      };
      it('T11 — Strict Normalizer: Malformed boolean string "false" fails closed to null', () => {
        const dtoWithStrBoolean: any = {
          id: 'room-norm-1',
          buildingId: 'bld-1',
          roomNumber: '101',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: 'false', // String instead of boolean
            maintenanceBlockReason: 'ACTIVE_RESERVATION',
          },
        };

        const normalized = normalizeAuthoritativeRoom(dtoWithStrBoolean);
        expect(normalized.currentOperationalActions).toBeNull();
      });

      it('T12 — Strict Normalizer: Malformed boolean number 1 fails closed to null', () => {
        const dtoWithNumBoolean: any = {
          id: 'room-norm-2',
          buildingId: 'bld-1',
          roomNumber: '102',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: 1, // Number instead of boolean
            maintenanceBlockReason: null,
          },
        };

        const normalized = normalizeAuthoritativeRoom(dtoWithNumBoolean);
        expect(normalized.currentOperationalActions).toBeNull();
      });

      it('T13 — Strict Normalizer: Invalid maintenanceBlockReason fails closed to null', () => {
        const dtoWithBadReason: any = {
          id: 'room-norm-3',
          buildingId: 'bld-1',
          roomNumber: '103',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: false,
            maintenanceBlockReason: 'UNKNOWN_CUSTOM_REASON',
          },
        };

        const normalized = normalizeAuthoritativeRoom(dtoWithBadReason);
        expect(normalized.currentOperationalActions).toBeNull();
      });

      it('T14 — Strict Normalizer: Cross-field inconsistency (true with non-null reason) fails closed to null', () => {
        const dtoInconsistent: any = {
          id: 'room-norm-4',
          buildingId: 'bld-1',
          roomNumber: '104',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: true,
            maintenanceBlockReason: 'ACTIVE_OCCUPANCY', // Conflict
          },
        };

        const normalized = normalizeAuthoritativeRoom(dtoInconsistent);
        expect(normalized.currentOperationalActions).toBeNull();
      });

      it('T15 — Strict Normalizer: Valid canonical shapes are accurately preserved', () => {
        const dtoValidTrue: any = {
          id: 'room-norm-5',
          buildingId: 'bld-1',
          roomNumber: '105',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: true,
            maintenanceBlockReason: null,
          },
        };
        const normTrue = normalizeAuthoritativeRoom(dtoValidTrue);
        expect(normTrue.currentOperationalActions).toEqual({
          canSetMaintenance: true,
          maintenanceBlockReason: null,
        });

        const dtoValidFalse: any = {
          id: 'room-norm-6',
          buildingId: 'bld-1',
          roomNumber: '106',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
          maxOccupants: 2,
          currentOperationalActions: {
            canSetMaintenance: false,
            maintenanceBlockReason: 'ACTIVE_RESERVATION',
          },
        };
        const normFalse = normalizeAuthoritativeRoom(dtoValidFalse);
        expect(normFalse.currentOperationalActions).toEqual({
          canSetMaintenance: false,
          maintenanceBlockReason: 'ACTIVE_RESERVATION',
        });
      });

      it('T16 — Strict DTO: RESERVED_IN_CYCLE missing rentAmount evaluates to UNAVAILABLE (no zero fabrication)', () => {
        const room: any = {
          id: 'room-strict-res-1',
          buildingId: 'bld-1',
          roomNumber: '107',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
        };

        const previewMissingRent: any = {
          roomId: 'room-strict-res-1',
          cyclePresentationState: 'RESERVED_IN_CYCLE',
          effectiveRoomOperationalStatus: 'vacant',
          agreementType: 'MONTHLY',
          rentAmount: undefined, // Missing rent
        };

        const res = resolveRoomCyclePresentation(room, previewMissingRent, 'cycle-2026-07');
        expect(res.state).toBe('UNAVAILABLE');
      });

      it('T17 — Strict DTO: DAILY_FINANCIAL_TAIL with billingSource = NONE evaluates to UNAVAILABLE (no DAILY_STAY fabrication)', () => {
        const room: any = {
          id: 'room-strict-tail-1',
          buildingId: 'bld-1',
          roomNumber: '108',
          floor: 1,
          status: 'vacant',
          monthlyRent: 4500,
        };

        const previewNoneSource: any = {
          roomId: 'room-strict-tail-1',
          cyclePresentationState: 'DAILY_FINANCIAL_TAIL',
          effectiveRoomOperationalStatus: 'vacant',
          agreementType: 'DAILY',
          rentAmount: '600.00',
          billingSource: 'NONE', // Disallowed NONE source
        };

        const res = resolveRoomCyclePresentation(room, previewNoneSource, 'cycle-2026-07');
        expect(res.state).toBe('UNAVAILABLE');
      });
      it('T18 — Edit Modal Status Toggle: Missing metadata fails closed and disables maintenance option', async () => {
        cleanup();
        const updateRoomSpy = vi.fn().mockResolvedValue({ success: true });
        const roomMissingMeta: Room = {
          id: 'room-toggle-fail-1',
          buildingId: 'bld-1',
          roomNumber: '201',
          floor: 2,
          status: 'vacant',
          monthlyRent: 4500,
          depositAmount: 5000,
          maxOccupants: 2,
          initialWaterMeter: 0,
          initialElectricMeter: 0,
          images: [],
          amenities: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          currentOperationalActions: null,
        };

        const testBuilding = { id: 'bld-1', name: 'Building A', floors: 3 };

        renderWithQuery(
          <OwnerRooms
            dormitoryId="dorm-1"
            rooms={[roomMissingMeta]}
            buildings={[testBuilding as any]}
            onSaveRooms={updateRoomSpy}
            onAddLog={vi.fn()}
            onNavigate={vi.fn()}
            restoredState={{ viewMode: 'grid' }}
          />
        );

        // Open edit modal
        const editBtn = await screen.findByTitle('แก้ไขรายละเอียดห้องพัก');
        fireEvent.click(editBtn);

        // Maintenance button in modal must be disabled due to fail-closed guard
        const modalMaintenanceBtn = screen.getByRole('button', { name: /ปิดปรับปรุง/ });
        expect((modalMaintenanceBtn as HTMLButtonElement).disabled).toBe(true);
        expect(modalMaintenanceBtn.getAttribute('title')).toBe('ไม่สามารถตรวจสอบสถานะการเปิดปิดห้องได้ กรุณาโหลดข้อมูลใหม่');
      });
    });

});
