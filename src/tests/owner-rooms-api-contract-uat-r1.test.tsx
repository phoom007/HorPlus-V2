// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryClient';
import {
  AuthoritativeRoomDto,
  normalizeAuthoritativeRoom,
  normalizeAuthoritativeRooms,
  parseSafeNumeric,
} from '../lib/roomNormalizer';
import { OwnerRooms } from '../pages/owner/rooms';
import { ApiPropertyAdapter } from '../data/adapters/api';
import * as HttpClientModule from '../data/httpClient';
import { Room, Building, Tenant } from '../types';

describe('Owner Rooms — UAT-R1 Runtime API Contract & Normalization Suite', () => {
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

  const sampleAuthoritativeDto: AuthoritativeRoomDto = {
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
    images: [],
    amenities: ['wifi', 'aircon'],
    notes: null,
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };

  describe('1. Authoritative Room DTO -> Canonical Room Projection', () => {
    it('normalizes currentEffectiveValues to canonical flat Room properties without NaN', () => {
      const room = normalizeAuthoritativeRoom(sampleAuthoritativeDto);

      // Price & Deposit assertions
      expect(room.monthlyRent).toBe(4500);
      expect(room.termRent).toBe(18000);
      expect(room.dailyRent).toBe(500);
      expect(room.depositAmount).toBe(9000);
      expect(room.maxOccupants).toBe(2);

      // Explicit NaN safety verification
      expect(Number.isNaN(room.monthlyRent)).toBe(false);
      expect(Number.isNaN(room.depositAmount)).toBe(false);
      expect(Number.isNaN(room.termRent)).toBe(false);
      expect(Number.isNaN(room.dailyRent)).toBe(false);
      expect(Number.isNaN(room.maxOccupants)).toBe(false);

      // Meter readings numeric normalization
      expect(room.initialWaterMeter).toBe(100);
      expect(room.initialElectricMeter).toBe(1200);
      expect(Number.isNaN(room.initialWaterMeter)).toBe(false);
      expect(Number.isNaN(room.initialElectricMeter)).toBe(false);

      // Structural identity
      expect(room.id).toBe('rm-a111');
      expect(room.roomNumber).toBe('A111');
      expect(room.buildingId).toBe('bld-001');
      expect(room.floor).toBe(1);
      expect(room.status).toBe('vacant');
      expect(room.version).toBe(1);
    });

    it('handles legacy flat DTOs gracefully as a fallback', () => {
      const legacyDto = {
        id: 'rm-legacy-1',
        buildingId: 'bld-001',
        roomNumber: '101',
        floor: 1,
        status: 'vacant',
        monthlyRent: 4000,
        termRent: 16000,
        dailyRent: 450,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 50,
        initialElectricMeter: 500,
        version: 2,
      };

      const room = normalizeAuthoritativeRoom(legacyDto);

      expect(room.monthlyRent).toBe(4000);
      expect(room.termRent).toBe(16000);
      expect(room.dailyRent).toBe(450);
      expect(room.depositAmount).toBe(8000);
      expect(room.initialWaterMeter).toBe(50);
      expect(room.initialElectricMeter).toBe(500);
      expect(Number.isNaN(room.monthlyRent)).toBe(false);
    });

    it('maps batch authoritative array via normalizeAuthoritativeRooms', () => {
      const dtoArray = [
        sampleAuthoritativeDto,
        {
          ...sampleAuthoritativeDto,
          id: 'rm-a112',
          roomNumber: 'A112',
          currentEffectiveValues: {
            monthlyRent: 5200,
            termRent: 20800,
            dailyRent: 600,
            depositAmount: 10400,
            maximumOccupants: 3,
          },
        },
      ];

      const rooms = normalizeAuthoritativeRooms(dtoArray);

      expect(rooms).toHaveLength(2);
      expect(rooms[0].monthlyRent).toBe(4500);
      expect(rooms[1].monthlyRent).toBe(5200);
      expect(rooms[1].depositAmount).toBe(10400);
      expect(rooms[1].maxOccupants).toBe(3);
    });
  });

  describe('2. Safe Numeric Parser (parseSafeNumeric)', () => {
    it('returns valid numbers and falls back safely without producing NaN', () => {
      expect(parseSafeNumeric(4500)).toBe(4500);
      expect(parseSafeNumeric('4500')).toBe(4500);
      expect(parseSafeNumeric('4500.50')).toBe(4500.5);
      expect(parseSafeNumeric(null, 0)).toBe(0);
      expect(parseSafeNumeric(undefined, 0)).toBe(0);
      expect(parseSafeNumeric('', 0)).toBe(0);
      expect(parseSafeNumeric('invalid-number', 99)).toBe(99);
      expect(Number.isNaN(parseSafeNumeric('invalid', 0))).toBe(false);
    });
  });

  describe('3. API Adapter Room Normalization Integration', () => {
    it('normalizes authoritative DTO returned from httpRequest in ApiPropertyAdapter.getAuthoritativeRooms', async () => {
      const mockRawResponse = {
        data: [sampleAuthoritativeDto],
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
        expect(Number.isNaN(room.monthlyRent)).toBe(false);
      }
    });

    it('normalizes authoritative DTO returned from httpRequest in ApiPropertyAdapter.createRoom', async () => {
      const mockCreatedResponse = {
        data: sampleAuthoritativeDto,
      };

      vi.spyOn(HttpClientModule, 'httpRequest').mockResolvedValue(mockCreatedResponse);

      const adapter = new ApiPropertyAdapter();
      const result = await adapter.createRoom({
        buildingId: 'bld-001',
        roomNumber: 'A111',
        monthlyRent: 4500,
        depositAmount: 9000,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.monthlyRent).toBe(4500);
        expect(result.data.depositAmount).toBe(9000);
        expect(Number.isNaN(result.data.monthlyRent)).toBe(false);
      }
    });
  });

  describe('4. Occupancy Presentation Invariant (No Contradiction)', () => {
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

    it('proves occupied room with authoritative currentTenantId renders tenant name and tenant info button', () => {
      const occupiedDto: AuthoritativeRoomDto = {
        ...sampleAuthoritativeDto,
        status: 'occupied',
        currentTenantId: 'tenant-somchai',
        currentContractId: 'contract-001',
      };

      const canonicalRoom = normalizeAuthoritativeRoom(occupiedDto);

      render(
        <OwnerRooms
          rooms={[canonicalRoom]}
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

      // Tenant name must be displayed (NOT "ไม่มีผู้เช่าลงทะเบียน")
      expect(screen.getByText('สมชาย ใจดี')).toBeDefined();
      expect(screen.queryByText('ไม่มีผู้เช่าลงทะเบียน')).toBeNull();

      // Action button must show "ข้อมูลผู้เช่า" (NOT "เพิ่มผู้เช่า")
      expect(screen.getByText('ข้อมูลผู้เช่า')).toBeDefined();
      expect(screen.queryByText('เพิ่มผู้เช่า')).toBeNull();

      // Price must NOT show NaN
      expect(screen.getAllByText(/4,500/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/NaN/)).toBeNull();
    });

    it('proves vacant room consistently renders vacant badge, no tenant, and add tenant button', () => {
      const vacantRoom = normalizeAuthoritativeRoom(sampleAuthoritativeDto);

      render(
        <OwnerRooms
          rooms={[vacantRoom]}
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

      // Tenant block says "ไม่มีผู้เช่าลงทะเบียน"
      expect(screen.getAllByText('ไม่มีผู้เช่าลงทะเบียน').length).toBeGreaterThan(0);

      // Action button shows "เพิ่มผู้เช่า"
      expect(screen.getByText('เพิ่มผู้เช่า')).toBeDefined();
      expect(screen.queryByText('ข้อมูลผู้เช่า')).toBeNull();

      // Price is valid number, never NaN
      expect(screen.getAllByText(/4,500/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/NaN/)).toBeNull();
    });
  });
});
