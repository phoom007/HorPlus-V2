// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import {
  AuthoritativeRoomDto,
  normalizeAuthoritativeRoom,
  normalizeAuthoritativeRooms,
  parseRequiredFiniteNumber,
  parseOptionalFiniteNumber,
} from '../lib/roomNormalizer';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import * as HttpClientModule from '../data/httpClient';
import { Room, Building, Tenant } from '../types';

describe('Owner Rooms — UAT-R1.1 Financial Data Integrity & Contract Suite', () => {
  let testQueryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60_000,
          retry: false,
        },
      },
    });
  });

  const validAuthoritativeDto: AuthoritativeRoomDto = {
    id: 'rm-a111',
    dormitoryId: 'dorm-001',
    buildingId: 'bld-001',
    buildingName: 'อาคาร A',
    roomNumber: 'A111',
    normalizedRoomNumber: 'A111',
    status: 'vacant',
    floor: 1,
    rentCycle: 'monthly',
    version: 1,
    rawOverrides: {
      monthlyRent: null,
      termRent: null,
      dailyRent: null,
      depositAmount: null,
      maximumOccupants: null,
    },
    currentEffectiveValues: {
      monthlyRent: 4500,
      termRent: 18000,
      dailyRent: 500,
      depositAmount: 9000,
      maximumOccupants: 2,
    },
    initialWaterReading: '100.00',
    initialElectricityReading: '1200.00',
    waterMeterNumber: 'W-A111',
    electricityMeterNumber: 'E-A111',
    currentTenantId: null,
    currentContractId: null,
    depositStatus: null,
    images: [],
    amenities: ['wifi', 'aircon'],
    notes: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };

  describe('1. Normalizer Financial Truth & Strict Required Numeric Contract', () => {
    it('Case 1: normalizes valid authoritative values correctly', () => {
      const room = normalizeAuthoritativeRoom(validAuthoritativeDto);

      expect(room.monthlyRent).toBe(4500);
      expect(room.termRent).toBe(18000);
      expect(room.dailyRent).toBe(500);
      expect(room.depositAmount).toBe(9000);
      expect(room.maxOccupants).toBe(2);
      expect(room.initialWaterMeter).toBe(100);
      expect(room.initialElectricMeter).toBe(1200);

      expect(Number.isNaN(room.monthlyRent)).toBe(false);
      expect(Number.isNaN(room.depositAmount)).toBe(false);
      expect(Number.isNaN(room.maxOccupants)).toBe(false);
    });

    it('Case 2: fails closed (throws Error) when required monthlyRent is malformed (not silently 0)', () => {
      const malformedDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        currentEffectiveValues: {
          ...validAuthoritativeDto.currentEffectiveValues!,
          monthlyRent: 'garbage',
        },
      };

      expect(() => normalizeAuthoritativeRoom(malformedDto)).toThrow('[ROOM_TRANSPORT_INVALID] Invalid monthlyRent');
    });

    it('Case 3: fails closed (throws Error) when required monthlyRent is missing across effective and fallback', () => {
      const missingMonthlyDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        currentEffectiveValues: {
          ...validAuthoritativeDto.currentEffectiveValues!,
          monthlyRent: null,
        },
        monthlyRent: null,
      };

      expect(() => normalizeAuthoritativeRoom(missingMonthlyDto)).toThrow('[ROOM_TRANSPORT_INVALID] Missing required monthlyRent');
    });

    it('Case 4: preserves depositStatus=undefined on occupied room without fabricating paid', () => {
      const occupiedDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        currentContractId: 'contract-001',
        depositStatus: undefined,
      };

      const room = normalizeAuthoritativeRoom(occupiedDto);

      expect(room.status).toBe('occupied');
      expect(room.currentTenantId).toBe('tenant-somchai');
      // Must NOT be inferred as 'paid' or 'unpaid'
      expect(room.depositStatus).toBeUndefined();
    });

    it('Case 5: respects explicit authoritative depositStatus="paid" and depositStatus="unpaid"', () => {
      const paidDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        depositStatus: 'paid',
      };
      const unpaidDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        depositStatus: 'unpaid',
      };

      const paidRoom = normalizeAuthoritativeRoom(paidDto);
      const unpaidRoom = normalizeAuthoritativeRoom(unpaidDto);

      expect(paidRoom.depositStatus).toBe('paid');
      expect(unpaidRoom.depositStatus).toBe('unpaid');
    });

    it('validates strict helper functions parseRequiredFiniteNumber & parseOptionalFiniteNumber', () => {
      expect(parseRequiredFiniteNumber(4500, 'monthlyRent')).toBe(4500);
      expect(parseRequiredFiniteNumber('4500', 'monthlyRent')).toBe(4500);
      expect(parseRequiredFiniteNumber(0, 'monthlyRent')).toBe(0);
      expect(parseRequiredFiniteNumber('0', 'monthlyRent')).toBe(0);

      expect(() => parseRequiredFiniteNumber(null, 'monthlyRent')).toThrow(/Missing required monthlyRent/);
      expect(() => parseRequiredFiniteNumber(undefined, 'monthlyRent')).toThrow(/Missing required monthlyRent/);
      expect(() => parseRequiredFiniteNumber('', 'monthlyRent')).toThrow(/Missing required monthlyRent/);
      expect(() => parseRequiredFiniteNumber('abc', 'monthlyRent')).toThrow(/Invalid monthlyRent/);
      expect(() => parseRequiredFiniteNumber(NaN, 'monthlyRent')).toThrow(/Invalid monthlyRent/);
      expect(() => parseRequiredFiniteNumber(Infinity, 'monthlyRent')).toThrow(/Invalid monthlyRent/);

      expect(parseOptionalFiniteNumber(18000, 'termRent')).toBe(18000);
      expect(parseOptionalFiniteNumber('18000', 'termRent')).toBe(18000);
      expect(parseOptionalFiniteNumber(null, 'termRent')).toBeUndefined();
      expect(parseOptionalFiniteNumber(undefined, 'termRent')).toBeUndefined();
      expect(parseOptionalFiniteNumber('', 'termRent')).toBeUndefined();
      expect(() => parseOptionalFiniteNumber('garbage', 'termRent')).toThrow(/Invalid termRent/);
    });
  });

  describe('2. Owner Rooms Financial Presentation (Unknown Deposit Status)', () => {
    const mockBuildings: Building[] = [
      { id: 'bld-001', name: 'อาคาร A', floorsCount: 2, version: 1, createdAt: '2026-08-01', updatedAt: '2026-08-01' },
    ];

    const mockTenants: Tenant[] = [
      {
        id: 'tenant-somchai',
        name: 'สมชาย ใจดี',
        phone: '0812345678',
        email: 'somchai@example.com',
        citizenId: '1234567890123',
        coOccupants: [],
        emergencyContact: { name: 'สมศรี', phone: '0898765432', relationship: 'มารดา' },
        vehicle: { type: 'none', licensePlate: '' },
        pet: { hasPet: false },
        rentalHistory: ['rm-a111'],
        status: 'active',
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      },
    ];

    it('renders occupied room with unknown depositStatus showing deposit amount but NO "จ่ายแล้ว" or "ยังไม่จ่าย" badge', () => {
      const occupiedUnknownDepositDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        depositStatus: undefined,
      };

      const room = normalizeAuthoritativeRoom(occupiedUnknownDepositDto);
      expect(room.depositStatus).toBeUndefined();

      render(
        <OwnerRooms
          rooms={[room]}
          buildings={mockBuildings}
          tenants={mockTenants}
          onSaveRooms={() => {}}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      // Switch to Grid view
      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      gridBtn.click();

      // Tenant name must be displayed
      expect(screen.getByText('สมชาย ใจดี')).toBeDefined();

      // Deposit amount must be displayed
      expect(screen.getAllByText(/9,000/).length).toBeGreaterThan(0);

      // Deposit status badges must NOT be rendered when status is unknown/undefined
      expect(screen.queryByText('จ่ายแล้ว')).toBeNull();
      expect(screen.queryByText('ยังไม่จ่าย')).toBeNull();
    });

    it('renders occupied room with explicit depositStatus="paid" showing "จ่ายแล้ว" badge', () => {
      const occupiedPaidDto: AuthoritativeRoomDto = {
        ...validAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        depositStatus: 'paid',
      };

      const room = normalizeAuthoritativeRoom(occupiedPaidDto);

      render(
        <OwnerRooms
          rooms={[room]}
          buildings={mockBuildings}
          tenants={mockTenants}
          onSaveRooms={() => {}}
          onAddLog={() => {}}
          onNavigate={() => {}}
        />
      );

      const gridBtn = screen.getByTitle('ตารางการ์ด (Grid)');
      gridBtn.click();

      expect(screen.getByText('จ่ายแล้ว')).toBeDefined();
      expect(screen.queryByText('ยังไม่จ่าย')).toBeNull();
    });
  });

  describe('3. API Adapter Integration', () => {
    it('normalizes authoritative DTO returned from httpRequest in ApiPropertyAdapter.getAuthoritativeRooms', async () => {
      const mockRawResponse = {
        data: [validAuthoritativeDto],
        pagination: { total: 1, page: 1, pageSize: 50 },
      };

      vi.spyOn(HttpClientModule, 'httpRequest').mockResolvedValue(mockRawResponse);

      const adapter = new ApiPropertyAdapter();
      const result = await adapter.getAuthoritativeRooms();

      expect(result.success).toBe(true);
      if (result.success) {
        const room = result.data.items[0];
        expect(room.monthlyRent).toBe(4500);
        expect(room.depositAmount).toBe(9000);
        expect(room.depositStatus).toBeUndefined();
      }
    });
  });
});
