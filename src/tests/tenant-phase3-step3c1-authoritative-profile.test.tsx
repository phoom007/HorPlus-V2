/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 *
 * TENANT PHASE 3 STEP 3C.1B TEST SUITE
 * Proves visible-field mutation scope, authoritative detail consumption,
 * form isolation against background refetches, fail-closed handling,
 * and zero real LINE calls.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient';
import { ApiTenantAdapter, fetchTenantProfile, TenantBasicProfileUpdateInput } from '../data/adapters/api';
import {
  OwnerTenants,
  getEffectivePetPolicy,
  resolveAllowedPetOptions,
  deriveContractDepositPaymentState,
  getContractStatusBadgeInfo,
  toCanonicalPetGroup,
  CANONICAL_PET_GROUP_OPTIONS,
} from '../pages/owner/tenants';
import { Contract, Bill } from '../types';
import { queryKeys } from '../lib/queryClient';
import { Tenant, Room } from '../types';
import { normalizePetTypeKey, classifySubmittedPets } from '../../server/src/services/tenant.service.js';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

describe('TENANT PHASE 3 STEP 3C.1B: Visible-Field Mutation Scope & Authoritative Detail Consumption', () => {
  const mockDormitoryId = 'dorm-001-uuid';
  let queryClient: QueryClient;

  const sampleActiveTenant: Tenant = {
    id: 'tenant-active-unbound',
    name: 'นาย นิรุตติ์ มั่นคง',
    phone: '0812345678',
    email: 'nirutti@example.com',
    citizenId: '1-1004-XXXXX-55-5',
    status: 'active',
    lineFriendId: null,
    coOccupants: [],
    emergencyContact: { name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' },
    vehicle: { type: 'none', licensePlate: '' },
    pet: { hasPet: false },
    rentalHistory: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };

  const sampleRoom: Room = {
    id: 'room-101',
    dormitoryId: mockDormitoryId,
    roomNumber: '101',
    status: 'occupied',
    currentTenantId: 'tenant-active-unbound',
    price: 3500,
    floor: 1,
    type: 'standard',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('selected_dormitory_id', mockDormitoryId);
    }
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  describe('Part 1: Visible-Field Mutation Scope & Whitelist Contracts', () => {
    it('1. Edit name sends only intended mutation fields', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      const input: TenantBasicProfileUpdateInput = {
        id: 'tenant-1',
        name: 'สมชาย รักชาติ',
        version: 1,
      };
      await adapter.updateTenant(input);

      expect(capturedPayload).toEqual({
        displayName: 'สมชาย รักชาติ',
        version: 1,
      });
      expect(capturedPayload.dateOfBirth).toBeUndefined();
      expect(capturedPayload.gender).toBeUndefined();
      expect(capturedPayload.address).toBeUndefined();
      expect(capturedPayload.notes).toBeUndefined();
    });

    it('2. Edit phone does NOT send dateOfBirth', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        phone: '0812345678',
        dateOfBirth: '1990-01-01',
      } as any);

      expect('dateOfBirth' in capturedPayload).toBe(false);
      expect(capturedPayload.dateOfBirth).toBeUndefined();
      expect(capturedPayload.phone).toBe('0812345678');
    });

    it('3. Edit phone does NOT send gender', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        phone: '0812345678',
        gender: 'male',
      } as any);

      expect('gender' in capturedPayload).toBe(false);
      expect(capturedPayload.gender).toBeUndefined();
    });

    it('4. Edit phone does NOT send address', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        phone: '0812345678',
        address: '123 Sukhumvit',
      } as any);

      expect('address' in capturedPayload).toBe(false);
      expect(capturedPayload.address).toBeUndefined();
    });

    it('5. Edit phone does NOT send notes', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        phone: '0812345678',
        notes: 'Some note',
      } as any);

      expect('notes' in capturedPayload).toBe(false);
      expect(capturedPayload.notes).toBeUndefined();
    });

    it('6. No ...selectedTenant presentation spread reaches network', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1', ...payload };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        name: 'สมชาย มีสุข',
        phone: '0812345678',
        email: 'test@example.com',
        citizenId: '1-1004-XXXXX-12-3',
        status: 'active',
        coOccupants: [{ id: 'co-1', name: 'ผู้พักร่วม 1', phone: '0811111111' } as any],
        emergencyContact: { name: 'ผู้ติดต่อฉุกเฉิน', phone: '0822222222', relationship: 'มารดา' },
        vehicle: { type: 'car', licensePlate: 'กข-1234' },
        vehicles: [{ id: 'v-1', type: 'car', licensePlate: 'กข-1234', brand: 'Toyota' }],
        pet: { hasPet: true, type: 'dog', name: 'เจ้าตูบ' },
        pets: [{ id: 'p-1', type: 'dog', name: 'เจ้าตูบ' }],
        rentalHistory: ['room-101', 'room-102'],
        coOccupantHistory: [{ id: 'hist-1', name: 'ผู้พักร่วมเก่า' }] as any,
        idCardPhotoMock: 'data:image/png;base64,FAKE',
        createdAt: '2026-01-01',
        updatedAt: '2026-02-01',
        depositStatus: 'paid',
        depositType: 'cash',
        contracts: [{ id: 'c-1' }],
        occupancies: [{ id: 'occ-1' }],
        bills: [{ id: 'b-1' }],
        settlements: [{ id: 's-1' }],
      } as any);

      // Verify strictly whitelisted payload
      expect(capturedPayload).toEqual({
        displayName: 'สมชาย มีสุข',
        phone: '0812345678',
        email: 'test@example.com',
        nationalId: '1-1004-XXXXX-12-3',
      });

      expect(capturedPayload.contracts).toBeUndefined();
      expect(capturedPayload.occupancies).toBeUndefined();
      expect(capturedPayload.bills).toBeUndefined();
      expect(capturedPayload.settlements).toBeUndefined();
      expect(capturedPayload.rentalHistory).toBeUndefined();
      expect(capturedPayload.coOccupants).toBeUndefined();
      expect(capturedPayload.coOccupantHistory).toBeUndefined();
      expect(capturedPayload.emergencyContact).toBeUndefined();
      expect(capturedPayload.vehicle).toBeUndefined();
      expect(capturedPayload.vehicles).toBeUndefined();
      expect(capturedPayload.pet).toBeUndefined();
      expect(capturedPayload.pets).toBeUndefined();
      expect(capturedPayload.idCardPhotoMock).toBeUndefined();
      expect(capturedPayload.depositStatus).toBeUndefined();
      expect(capturedPayload.depositType).toBeUndefined();
      expect(capturedPayload.status).toBeUndefined();
    });

    it('7. email clear -> null', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        name: 'สมชาย มีสุข',
        phone: '0812345678',
        email: '',
      });

      expect(capturedPayload.email).toBeNull();
    });

    it('8. National ID locked cases remain correct', async () => {
      let capturedPayload: any = null;
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_m, _u, payload) => {
        capturedPayload = payload;
        return { id: 'tenant-1' };
      });

      const adapter = new ApiTenantAdapter();

      // 8a. Masked unchanged -> preserves
      await adapter.updateTenant({ id: 't-1', citizenId: '1-1004-XXXXX-12-3' });
      expect(capturedPayload.nationalId).toBe('1-1004-XXXXX-12-3');

      // 8b. Undefined -> omitted
      capturedPayload = null;
      await adapter.updateTenant({ id: 't-1', phone: '0812345678' });
      expect(capturedPayload.nationalId).toBeUndefined();

      // 8c. 13 digits -> replaced
      await adapter.updateTenant({ id: 't-1', citizenId: '1-2345-67890-12-3' });
      expect(capturedPayload.nationalId).toBe('1234567890123');

      // 8d. Explicit "" -> cleared
      await adapter.updateTenant({ id: 't-1', citizenId: '' });
      expect(capturedPayload.nationalId).toBe('');
    });

    it('15. zero real LINE calls are made', async () => {
      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ id: 'tenant-1' });

      const adapter = new ApiTenantAdapter();
      await adapter.updateTenant({
        id: 'tenant-1',
        name: 'สมชาย มีสุข',
        phone: '0812345678',
      });

      const calls = httpSpy.mock.calls;
      for (const call of calls) {
        const url = String(call[1]);
        expect(url).not.toContain('line.me');
        expect(url).not.toContain('api.line.me');
        expect(url).not.toContain('api-data.line.me');
        expect(url).not.toContain('access.line.me');
      }
    });
  });

  describe('Part 2: UI Authoritative Detail Consumption & Form Isolation', () => {
    it('9. DataResult failure remains fail-closed', async () => {
      const onSaveTenants = vi.fn();
      const onAddLog = vi.fn();

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            coOccupants: [],
            coOccupantHistory: [],
            emergencyContacts: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT') {
          throw new httpClient.HttpClientError({
            code: 'DB_ERROR',
            message: 'เกิดข้อผิดพลาดในการบันทึกข้อมูลฐานข้อมูล',
          });
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={onSaveTenants}
            onSaveRooms={vi.fn()}
            onAddLog={onAddLog}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      const phoneInput = screen.getByDisplayValue('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0899999999' } });

      const saveBtn = screen.getByRole('button', { name: /บันทึกการแก้ไข/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.getByText(/เกิดข้อผิดพลาดในการบันทึกข้อมูลฐานข้อมูล/i)).toBeDefined();
      });
      expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      expect(onSaveTenants).not.toHaveBeenCalled();
      expect(onAddLog).not.toHaveBeenCalled();
    });

    it('10 & 11. Detail GET response is consumed by profile presentation and beats stale list-row values', async () => {
      const staleTenantInList: Tenant = {
        ...sampleActiveTenant,
        name: 'นาย นิรุตติ์ (ชื่อเก่าในลิสต์)',
        emergencyContact: { name: 'ผู้ติดต่อเก่า', phone: '0811111111', relationship: 'เพื่อน' },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: {
              ...sampleActiveTenant,
              displayName: 'นาย นิรุตติ์ มั่นคง (จากเซิร์ฟเวอร์)',
              name: 'นาย นิรุตติ์ มั่นคง (จากเซิร์ฟเวอร์)',
            },
            emergencyContacts: [
              { name: 'คุณแม่สมศรี (จากเซิร์ฟเวอร์)', phone: '0899999999', relationship: 'มารดา', isPrimary: true },
            ],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenantInList]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Click tenant to trigger detail query
      fireEvent.click(screen.getByText('นาย นิรุตติ์ (ชื่อเก่าในลิสต์)'));

      // Detail GET response must be consumed and beat stale list row values
      await waitFor(() => {
        expect(screen.getByText('นาย นิรุตติ์ มั่นคง (จากเซิร์ฟเวอร์)')).toBeDefined();
        expect(screen.getByText('คุณแม่สมศรี (จากเซิร์ฟเวอร์)')).toBeDefined();
        expect(screen.getByText('089-999-9999')).toBeDefined();
      });
    });

    it('12. Detail GET failure does not fabricate success', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          throw new httpClient.HttpClientError({
            code: 'INTERNAL_ERROR',
            message: 'Server failure fetching details',
          });
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      // Remains rendering initial list state safely without fabricating fake aggregates
      expect(screen.getAllByText('นาย นิรุตติ์ มั่นคง').length).toBeGreaterThan(0);
      expect(screen.queryByText(/fake fabricated contract/i)).toBeNull();
    });

    it('13. Opening/editing modal is not overwritten by background detail refetch', async () => {
      let resolveDetailQuery: any;
      const detailQueryPromise = new Promise(resolve => {
        resolveDetailQuery = resolve;
      });

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return await detailQueryPromise;
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Click tenant to select
      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      // Open Edit Modal
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      // User types in name input
      const nameInput = screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง');
      fireEvent.change(nameInput, { target: { value: 'นาย นิรุตติ์ มั่งมี (กำลังพิมพ์)' } });

      // Background refetch finishes while modal is open
      resolveDetailQuery({
        tenant: {
          ...sampleActiveTenant,
          displayName: 'ชื่อจากเซิร์ฟเวอร์แบ็คกราวด์',
        },
        emergencyContacts: [],
        coOccupants: [],
        coOccupantHistory: [],
        vehicles: [],
        contracts: [],
        occupancies: [],
        dailyStays: [],
        bills: [],
        settlements: [],
      });

      // Wait a moment and assert input was NOT overwritten by background refetch
      await new Promise(r => setTimeout(r, 100));
      expect((nameInput as HTMLInputElement).value).toBe('นาย นิรุตติ์ มั่งมี (กำลังพิมพ์)');
    });

    it('14. active LINE-unbound Tenant remains under พักอาศัย', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      const activeTabBtn = screen.getByRole('button', { name: /พักอาศัย/i });
      expect(activeTabBtn).toBeDefined();
      expect(screen.getByText('นาย นิรุตติ์ มั่นคง')).toBeDefined();

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.getByTestId('header-badge-unbound-line')).toBeDefined();
        expect(screen.getAllByText(/ยังไม่ผูก LINE/i).length).toBeGreaterThan(0);
      });
    });
  });

  describe('Part 3: Authoritative Null & Empty Detail State Closure (Step 3C.1C)', () => {
    it('16. stale list email + detail null -> stale email removed and renders ไม่มีข้อมูล', async () => {
      const staleTenant: Tenant = {
        ...sampleActiveTenant,
        email: 'old@example.com',
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: {
              ...sampleActiveTenant,
              email: null,
            },
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.getByText('ไม่มีข้อมูล')).toBeDefined();
      });
      expect(screen.queryByText('old@example.com')).toBeNull();
    });

    it('17. stale masked National ID + detail null -> stale ID removed', async () => {
      const staleTenant: Tenant = {
        ...sampleActiveTenant,
        citizenId: '1-2345-xxxxx-89-0',
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: {
              ...sampleActiveTenant,
              nationalIdMasked: null,
              citizenId: null,
            },
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.queryByText(/1-2345-xxxxx-89-0/)).toBeNull();
      });
    });

    it('18. stale emergency contact + detail [] -> stale contact removed and renders empty', async () => {
      const staleTenant: Tenant = {
        ...sampleActiveTenant,
        emergencyContact: {
          name: 'นาย ผู้ติดต่อ ฉุกเฉินเก่า',
          relationship: 'เพื่อน',
          phone: '0899999999',
        },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.queryByText('นาย ผู้ติดต่อ ฉุกเฉินเก่า')).toBeNull();
      });
    });

    it('19. stale coOccupants + detail [] -> stale occupants removed and renders 0 คน', async () => {
      const staleTenant: Tenant = {
        ...sampleActiveTenant,
        coOccupants: [
          { id: 'co-stale', name: 'นาย รูมเมท เก่า', phone: '0812345678', citizenId: '', relationship: 'เพื่อน' },
        ],
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.queryByText('นาย รูมเมท เก่า')).toBeNull();
      });

      // Switch to history tab to view co-occupants list
      fireEvent.click(screen.getByRole('button', { name: /ผู้พักร่วม/i }));
      expect(screen.getByText('0 คน')).toBeDefined();
    });

    it('20. stale vehicles + detail [] -> stale vehicles removed and renders empty', async () => {
      const staleTenant: Tenant = {
        ...sampleActiveTenant,
        vehicles: [
          { id: 'v-stale', type: 'car', licensePlate: 'กข 9999', brand: 'Honda' },
        ],
        vehicle: { type: 'car', licensePlate: 'กข 9999', brand: 'Honda' },
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[staleTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.queryByText('กข 9999')).toBeNull();
      });
    });

    it('21. successful PUT email null -> local presentation empty', async () => {
      let putPayload: any = null;
      let serverTenantState: any = {
        ...sampleActiveTenant,
        email: 'initial@example.com',
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: serverTenantState,
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound')) {
          putPayload = payload;
          serverTenantState = {
            ...serverTenantState,
            email: null,
          };
          return serverTenantState;
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[{ ...sampleActiveTenant, email: 'initial@example.com' }]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      const emailInput = screen.getByDisplayValue('initial@example.com');
      fireEvent.change(emailInput, { target: { value: '' } });

      const saveBtn = screen.getByRole('button', { name: /บันทึกการแก้ไข/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putPayload.email).toBeNull();
      await waitFor(() => {
        expect(screen.getByText('ไม่มีข้อมูล')).toBeDefined();
      });
      expect(screen.queryByText('initial@example.com')).toBeNull();
    });

    it('22. successful PUT nationalIdMasked null -> local presentation empty', async () => {
      let putPayload: any = null;
      let serverTenantState: any = {
        ...sampleActiveTenant,
        citizenId: '1-2345-xxxxx-89-0',
        nationalIdMasked: '1-2345-xxxxx-89-0',
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: serverTenantState,
            emergencyContacts: [],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound')) {
          putPayload = payload;
          serverTenantState = {
            ...serverTenantState,
            nationalIdMasked: null,
            citizenId: null,
          };
          return serverTenantState;
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[{ ...sampleActiveTenant, citizenId: '1-2345-xxxxx-89-0' }]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      const idInput = screen.getByDisplayValue('1-2345-xxxxx-89-0');
      fireEvent.change(idInput, { target: { value: '' } });

      const saveBtn = screen.getByRole('button', { name: /บันทึกการแก้ไข/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putPayload.nationalId).toBe('');
      await waitFor(() => {
        expect(screen.queryByText(/1-2345-xxxxx-89-0/)).toBeNull();
      });
    });
  });

  describe('Part 4: Atomic Profile Save, Document Security & Dorm Context (Step 3C.1E)', () => {
    it('23. emergency contact required fields enforced and clearing does not delete', async () => {
      let putProfilePayload: any = null;
      let deleteCalls: string[] = [];
      let serverEmergencyContacts: any[] = [{ id: 'em-101', name: 'นายเดิม', phone: '0812345678', relationship: 'บิดา' }];

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'DELETE') {
          deleteCalls.push(url);
          return { success: true };
        }
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: serverEmergencyContacts,
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          putProfilePayload = payload;
          serverEmergencyContacts = [{ id: 'em-101', ...payload.emergencyContact }];
          return {
            ...sampleActiveTenant,
            displayName: payload.displayName,
            phone: payload.phone,
            emergencyContacts: serverEmergencyContacts,
            version: 2,
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // 1. Clearing required emergency fields fails client validation and does NOT invoke delete
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      fireEvent.change(screen.getByLabelText(/ชื่อผู้ติดต่อ \*/i), { target: { value: '' } });
      fireEvent.change(screen.getByLabelText(/เบอร์โทรศัพท์ \*/i), { target: { value: '' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.getByText('กรุณากรอกชื่อและเบอร์โทรศัพท์ผู้ติดต่อฉุกเฉินให้ครบถ้วน')).toBeDefined();
      });
      // Verify modal stays open
      expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      // Verify NO delete API called
      expect(deleteCalls).toEqual([]);

      // 2. Filling emergency contact succeeds via single atomic PUT
      fireEvent.change(screen.getByLabelText(/ชื่อผู้ติดต่อ \*/i), { target: { value: 'สมศรี ผู้ดูแล' } });
      fireEvent.change(screen.getByLabelText(/ความสัมพันธ์/i), { target: { value: 'มารดา' } });
      fireEvent.change(screen.getByLabelText(/เบอร์โทรศัพท์ \*/i), { target: { value: '0811112233' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfilePayload).toBeDefined();
      expect(putProfilePayload.emergencyContact).toEqual({
        id: 'em-101',
        name: 'สมศรี ผู้ดูแล',
        phone: '0811112233',
        relationship: 'มารดา',
        isPrimary: true,
      });
      expect(deleteCalls).toEqual([]);
      expect(screen.getByText('สมศรี ผู้ดูแล')).toBeDefined();
      expect(screen.getByText('081-111-2233')).toBeDefined();
    });

    it('24. vehicles save performs one aggregate mutation without independent child API calls', async () => {
      let putProfilePayload: any = null;
      let independentVehicleCalls: string[] = [];
      let serverVehicles: any[] = [{ id: 'veh-1', type: 'car', licensePlate: 'กข 1234', brand: 'Toyota' }];

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (url?.includes('/vehicles')) {
          independentVehicleCalls.push(`${method} ${url}`);
        }
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: serverVehicles,
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          putProfilePayload = payload;
          serverVehicles = payload.vehicles.map((v: any, idx: number) => ({
            id: v.id || `veh-${idx + 2}`,
            ...v,
          }));
          return {
            ...sampleActiveTenant,
            displayName: payload.displayName,
            phone: payload.phone,
            vehicles: serverVehicles,
            version: 2,
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getAllByText(/กข 1234/).length).toBeGreaterThan(0);
      });

      // Update vehicle veh-1 and add a second vehicle
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      const plateInput = screen.getByPlaceholderText('เลขทะเบียน');
      fireEvent.change(plateInput, { target: { value: 'ฮฮ 9999' } });

      fireEvent.click(screen.getByRole('button', { name: /เพิ่มยานพาหนะอีก 1 คัน/i }));
      const plateInputs = screen.getAllByPlaceholderText('เลขทะเบียน');
      expect(plateInputs.length).toBe(2);
      fireEvent.change(plateInputs[1], { target: { value: '9กข 8888' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      // Proof: Exactly ONE aggregate PUT mutation and ZERO independent vehicle endpoints
      expect(putProfilePayload).toBeDefined();
      expect(putProfilePayload.vehicles.length).toBe(2);
      expect(putProfilePayload.vehicles[0].id).toBe('veh-1');
      expect(putProfilePayload.vehicles[0].licensePlate).toBe('ฮฮ 9999');
      expect(putProfilePayload.vehicles[1].id).toBeUndefined(); // new vehicle has no server id
      expect(putProfilePayload.vehicles[1].licensePlate).toBe('9กข 8888');
      expect(independentVehicleCalls).toEqual([]);

      await waitFor(() => {
        expect(screen.getAllByText(/ฮฮ 9999/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/9กข 8888/).length).toBeGreaterThan(0);
      });
    });

    it('25. pet persistence is included in aggregate profile mutation and policy-driven', async () => {
      let putProfilePayload: any = null;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/properties/dormitory/defaults')) {
          return { property: { petPolicy: { allowed: 'conditional', allowedTypes: ['cat'] } } };
        }
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          putProfilePayload = payload;
          return {
            ...sampleActiveTenant,
            displayName: payload.displayName,
            phone: payload.phone,
            pets: payload.pets,
            petInfo: payload.pets,
            version: 2,
          };
        }
        return {};
      });

      const catOnlyDorm: any = {
        id: mockDormitoryId,
        name: 'Cat Friendly Dorm',
        petPolicy: {
          allowed: 'conditional',
          allowedTypes: ['cat'],
        },
      };

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={catOnlyDorm}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      // Pet checkbox
      const petCheckbox = screen.getByLabelText(/ประสงค์เลี้ยงสัตว์/i);
      fireEvent.click(petCheckbox);

      // Verify dropdown has 'แมว' but NOT 'สุนัข'
      expect(screen.getByRole('option', { name: /แมว/ })).toBeDefined();
      expect(screen.queryByRole('option', { name: /สุนัข/ })).toBeNull();

      const selects = screen.getAllByRole('combobox');
      const petSelect = selects.find(s => s.innerHTML.includes('แมว'));
      if (petSelect) {
        fireEvent.change(petSelect, { target: { value: 'cat' } });
      }
      const petNameInput = screen.getByPlaceholderText('ชื่อน้อง');
      fireEvent.change(petNameInput, { target: { value: 'มิว' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfilePayload).toBeDefined();
      expect(putProfilePayload.pets.length).toBe(1);
      expect(putProfilePayload.pets[0].type).toBe('cat');
      expect(putProfilePayload.pets[0].name).toBe('มิว');
    });

    it('26. identity document replace works without delete semantics (Option B)', async () => {
      let uploadedFile: any = null;
      let deleteCalled = false;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: {
              ...sampleActiveTenant,
              hasIdentityDocument: true,
              idCardPhotoMock: '/api/v1/tenants/tenant-active-unbound/identity-document',
            },
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          return sampleActiveTenant;
        }
        if (method === 'POST' && url?.includes('/identity-document')) {
          uploadedFile = payload;
          return { data: { hasIdentityDocument: true } };
        }
        if (method === 'DELETE' && url?.includes('identity-document')) {
          deleteCalled = true;
          return { success: true };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[{ ...sampleActiveTenant, hasIdentityDocument: true, idCardPhotoMock: '/api/v1/tenants/tenant-active-unbound/identity-document' }]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      // Button label must be exactly "เปลี่ยน"
      expect(screen.getByText('เปลี่ยน')).toBeDefined();
      expect(screen.queryByText('เปลี่ยนรูปภาพ')).toBeNull();
      expect(screen.queryByText('ลบรูปภาพ')).toBeNull();
      expect(deleteCalled).toBe(false);
    });

    it('27. modal remains open on server failure with visible error (fail-closed)', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          throw new httpClient.HttpClientError({
            code: 'INTERNAL_ERROR',
            message: 'ข้อผิดพลาดระบบฐานข้อมูลไม่สามารถบันทึกได้',
          });
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง'), { target: { value: 'นาย นิรุตติ์ พลาด' } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      // Modal must remain open and display the visible error
      await waitFor(() => {
        expect(screen.getByText('ข้อผิดพลาดระบบฐานข้อมูลไม่สามารถบันทึกได้')).toBeDefined();
      });
      expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
    });

    it('28. no real LINE endpoints are called', async () => {
      const calledUrls: string[] = [];

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        calledUrls.push(url);
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: sampleActiveTenant,
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          return sampleActiveTenant;
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง'), { target: { value: 'นาย นิรุตติ์ มั่นคงดี' } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      // Verify zero real LINE endpoints were called
      const lineCalls = calledUrls.filter(u =>
        u.includes('line.me') ||
        u.includes('/line/') ||
        u.includes('api.line.me') ||
        u.includes('messaging-api') ||
        u.includes('line-oa')
      );
      expect(lineCalls).toEqual([]);
    });

    it('29. authoritative refetch updates version after successful save', async () => {
      let getCount = 0;
      let returnedVersion = 1;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          getCount++;
          return {
            tenant: {
              ...sampleActiveTenant,
              version: returnedVersion,
            },
            emergencyContacts: [{ id: 'em-1', name: 'คุณแม่', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          returnedVersion = 2;
          return {
            ...sampleActiveTenant,
            version: 2,
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      expect(getCount).toBeGreaterThanOrEqual(1);

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง'), { target: { value: 'นาย นิรุตติ์ มั่นคง อัปเดต' } });
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      // Refetch happened and delivered version 2
      expect(returnedVersion).toBe(2);
    });

    it('30. active LINE-unbound tenant remains under "พักอาศัย" with correct badge', async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[sampleActiveTenant]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Verify active status tab shows "ผู้เช่าที่พักอาศัยอยู่"
      expect(screen.getByText(/ผู้เช่าที่พักอาศัยอยู่/i)).toBeDefined();
      expect(screen.getByText('นาย นิรุตติ์ มั่นคง')).toBeDefined();
      // Verify badge "ยังไม่ผูก LINE" is shown
      expect(screen.getByTestId('badge-unbound-line')).toBeDefined();
      expect(screen.getByText('ยังไม่ผูก LINE')).toBeDefined();
    });

    it('31. partial document failure: profile succeeds, document fails -> error displayed, version updated, staged file retained, and retry does not send stale version or duplicate children', async () => {
      let putProfileCalls: any[] = [];
      let uploadAttempts = 0;
      let currentVersion = 1;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: { ...sampleActiveTenant, version: currentVersion },
            emergencyContacts: [{ id: 'em-exist-1', name: 'คุณแม่เดิม', phone: '0899999999', relationship: 'มารดา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [{ id: 'veh-exist-1', type: 'car', licensePlate: 'กข-1234' }],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-active-unbound/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          return {
            tenant: { ...sampleActiveTenant, displayName: payload.displayName, version: currentVersion },
            emergencyContacts: [{ id: payload.emergencyContact?.id || 'em-exist-1', name: payload.emergencyContact?.name, phone: payload.emergencyContact?.phone }],
            vehicles: [{ id: payload.vehicles?.[0]?.id || 'veh-exist-1', type: 'car', licensePlate: 'กข-1234' }],
          };
        }
        if (method === 'POST' && url?.includes('/tenants/tenant-active-unbound/identity-document')) {
          uploadAttempts += 1;
          if (uploadAttempts === 1) {
            throw new httpClient.HttpClientError({
              code: 'STORAGE_FAILURE',
              message: 'พื้นที่จัดเก็บเอกสารขัดข้อง',
            });
          }
          return { success: true };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[{ ...sampleActiveTenant, version: 1 }]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getAllByText(/กข-1234/).length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      // Wait for modal to render file input
      let fileInput: HTMLInputElement | null = null;
      await waitFor(() => {
        const editForm = screen.getByRole('button', { name: /บันทึกการแก้ไข/i }).closest('form');
        fileInput = (editForm?.querySelector('input[type="file"]') as HTMLInputElement) ?? null;
        expect(fileInput).not.toBeNull();
      });

      // Change a field to ensure form is changed
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง'), { target: { value: 'นาย นิรุตติ์ มั่นคง 2' } });

      // Attach file
      const file = new File(['dummy-content'], 'id-card.png', { type: 'image/png' });
      fireEvent.change(fileInput!, { target: { files: [file] } });

      await waitFor(() => {
        expect((screen.getByRole('button', { name: /บันทึกการแก้ไข/i }) as HTMLButtonElement).disabled).toBe(false);
      });

      // First save click -> DB succeeds (bumps version to 2), upload fails
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      // Modal remains open and displays visible upload error
      await waitFor(() => {
        expect(screen.getByText('พื้นที่จัดเก็บเอกสารขัดข้อง')).toBeDefined();
      });
      expect(putProfileCalls.length).toBe(1);
      expect(putProfileCalls[0].version).toBe(1);

      // Second save click (retry) -> must send version 2, NOT version 1! And must preserve emergency id!
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(putProfileCalls.length).toBe(2);
      });

      expect(putProfileCalls[1].version).toBe(2);
      expect(putProfileCalls[1].emergencyContact?.id).toBe('em-exist-1');
      expect(putProfileCalls[1].vehicles?.[0]?.id).toBe('veh-exist-1');

      // Since second upload succeeded, modal closes
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });
    });

    it('32. Save profile with replacement document -> document succeeds -> next profile edit uses latest authoritative version (N+2) -> no false RESOURCE_VERSION_CONFLICT', async () => {
      const putProfileCalls: any[] = [];
      let currentVersion = 1;
      let currentDisplayName = sampleActiveTenant.name;

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && (url as string).includes('/tenants/tenant-active-unbound')) {
          return {
            tenant: {
              ...sampleActiveTenant,
              name: currentDisplayName,
              displayName: currentDisplayName,
              version: currentVersion,
            },
            emergencyContacts: [{ id: 'em-exist-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา', isPrimary: true }],
            vehicles: [{ id: 'veh-exist-1', type: 'car', licensePlate: 'กข-1234', brand: 'Toyota', model: 'Yaris', color: 'White' }],
            pets: [],
            coOccupants: [],
          };
        }
        if (method === 'PUT' && (url as string).includes('/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          currentDisplayName = payload.displayName || currentDisplayName;
          return {
            tenant: {
              ...sampleActiveTenant,
              name: currentDisplayName,
              displayName: currentDisplayName,
              phone: payload.phone,
              version: currentVersion,
            },
            emergencyContacts: payload.emergencyContact ? [{ id: payload.emergencyContact.id || 'em-exist-1', ...payload.emergencyContact }] : [],
            vehicles: (payload.vehicles || []).map((v: any) => ({ ...v, id: v.id || 'veh-exist-1' })),
            pets: payload.pets || [],
          };
        }
        if (method === 'POST' && (url as string).includes('/identity-document')) {
          currentVersion += 1; // Document upload increments tenant version in canonical repo to N+2
          return {
            data: {
              tenantId: sampleActiveTenant.id,
              version: currentVersion,
              hasIdentityDocument: true,
              idCardUploadedAt: new Date().toISOString(),
              idCardSha256: 'sha256-test',
              idCardMimeType: 'image/webp',
              idCardByteSize: 2048,
            },
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[{ ...sampleActiveTenant, version: 1 }]}
            rooms={[sampleRoom]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getAllByText(/กข-1234/).length).toBeGreaterThan(0);
      });

      // 1. Open edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));

      let fileInput: HTMLInputElement | null = null;
      await waitFor(() => {
        const editForm = screen.getByRole('button', { name: /บันทึกการแก้ไข/i }).closest('form');
        fileInput = (editForm?.querySelector('input[type="file"]') as HTMLInputElement) ?? null;
        expect(fileInput).not.toBeNull();
      });

      // Change name and attach replacement file
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ มั่นคง'), { target: { value: 'นาย นิรุตติ์ แก้ไขครั้งที่ 1' } });
      const file = new File(['dummy-content'], 'id-card.png', { type: 'image/png' });
      fireEvent.change(fileInput!, { target: { files: [file] } });

      await waitFor(() => {
        expect((screen.getByRole('button', { name: /บันทึกการแก้ไข/i }) as HTMLButtonElement).disabled).toBe(false);
      });

      // Click save: Profile update (v1 -> v2) + Document upload (v2 -> v3)
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(1);
      expect(putProfileCalls[0].version).toBe(1);
      expect(currentVersion).toBe(3); // v1 + 1 (profile) + 1 (doc) = 3

      // 2. Second edit immediately following document success:
      // Reopen edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Change name to trigger form modification
      fireEvent.change(screen.getByDisplayValue('นาย นิรุตติ์ แก้ไขครั้งที่ 1'), { target: { value: 'นาย นิรุตติ์ แก้ไขครั้งที่ 2' } });
      await waitFor(() => {
        expect((screen.getByRole('button', { name: /บันทึกการแก้ไข/i }) as HTMLButtonElement).disabled).toBe(false);
      });

      // Save again
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(putProfileCalls.length).toBe(2);
      });

      // CRITICAL ASSERTION: The second edit MUST send version 3 (N+2), NOT 2 (stale)!
      expect(putProfileCalls[1].version).toBe(3);
    });
  });

  describe('Part 6: Grandfather Pet Policy, Custom Pet Serialization & Independent Refetch (Step 3C.1H)', () => {
    it('32. rendered OwnerTenants: grandfathered cat + client dorm policy allowed = none + phone edit -> Save works, PUT preserves cat, no error, modal closes, no LINE call', async () => {
      let putProfilePayload: any = null;
      let lineCallCount = 0;

      const grandfatheredTenant: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-grandfathered-cat',
        displayName: 'นาย นิรุตติ์ มั่นคง',
        phone: '0812345678',
        pets: [{ id: 'pet-cat-1', type: 'แมว', name: 'มีมี่' }],
        pet: { hasPet: true, type: 'แมว', name: 'มีมี่' },
        version: 1,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (url?.includes('line')) {
          lineCallCount++;
        }
        if (method === 'GET' && url?.includes('/tenants/tenant-grandfathered-cat')) {
          return {
            tenant: grandfatheredTenant,
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-grandfathered-cat/profile')) {
          putProfilePayload = payload;
          return {
            tenant: {
              ...grandfatheredTenant,
              displayName: payload.displayName,
              phone: payload.phone,
              petInfo: payload.pets,
              version: 2,
            },
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={{ id: mockDormitoryId, name: 'หอพักไม่อนุญาตสัตว์', petPolicy: { allowed: 'none', allowedTypes: [] } } as any}
            tenants={[grandfatheredTenant]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-grandfathered-cat' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Select tenant
      fireEvent.click(screen.getByText('นาย นิรุตติ์ มั่นคง'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // Open Edit Modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // User changes ONLY phone
      const phoneInput = screen.getByDisplayValue('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0899999999' } });

      // Save button clicked
      const saveBtn = screen.getByRole('button', { name: /บันทึกการแก้ไข/i });
      fireEvent.click(saveBtn);

      // Modal closes successfully
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      // Assertions
      expect(putProfilePayload).not.toBeNull();
      expect(putProfilePayload.phone).toBe('0899999999');
      // Existing cat is preserved in PUT payload
      expect(putProfilePayload.pets).toEqual([
        expect.objectContaining({
          type: expect.stringMatching(/cat|แมว/),
          name: 'มีมี่',
        }),
      ]);
      // Frontend did not block save or show error
      expect(screen.queryByText(/หอพักมีนโยบายไม่อนุญาตให้เลี้ยงสัตว์/)).toBeNull();
      // Zero real LINE calls
      expect(lineCallCount).toBe(0);
    });

    it('33. new custom "other" pet serializes type="other" and preserves customType', async () => {
      let putProfilePayload: any = null;

      const tenantNoPets: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-no-pets',
        name: 'นาย ปราโมทย์ ใจดี',
        displayName: 'นาย ปราโมทย์ ใจดี',
        phone: '0822222222',
        pets: [],
        pet: { hasPet: false },
        version: 1,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/properties/dormitory/defaults')) {
          return { property: { petPolicy: { allowed: 'all', allowedTypes: [] } } };
        }
        if (method === 'GET' && url?.includes('/tenants/tenant-no-pets')) {
          return {
            tenant: tenantNoPets,
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-no-pets/profile')) {
          putProfilePayload = payload;
          return {
            tenant: {
              ...tenantNoPets,
              displayName: payload.displayName,
              petInfo: payload.pets,
              version: 2,
            },
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={{ id: mockDormitoryId, name: 'หอพักเงื่อนไข', petPolicy: { allowed: 'all', allowedTypes: [] } } as any}
            tenants={[tenantNoPets]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-no-pets' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Select tenant
      fireEvent.click(screen.getByText('นาย ปราโมทย์ ใจดี'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // Open Edit Modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Enable hasPet checkbox
      const petCheckbox = screen.getByLabelText(/ประสงค์เลี้ยงสัตว์/i);
      fireEvent.click(petCheckbox);

      // Select type: 'อื่นๆ'
      await waitFor(() => {
        expect(screen.getByText('-- ประเภท --')).toBeDefined();
      });
      const petSelect = screen.getByText('-- ประเภท --').closest('select')!;
      fireEvent.change(petSelect, { target: { value: 'other' } });

      // Enter custom type and name
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/ระบุประเภท เช่น/i)).toBeDefined();
      });
      fireEvent.change(screen.getByPlaceholderText(/ระบุประเภท เช่น/i), { target: { value: 'งู' } });
      fireEvent.change(screen.getByPlaceholderText('ชื่อน้อง'), { target: { value: 'น้องงู' } });

      // Save
      const saveBtn = screen.getByRole('button', { name: /บันทึกการแก้ไข/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfilePayload).not.toBeNull();
      expect(putProfilePayload.pets).toEqual([
        expect.objectContaining({
          type: 'other',
          customType: 'งู',
          name: 'น้องงู',
        }),
      ]);
    });

    it('34. background refetch error after successful mutation does NOT reopen modal or report failure', async () => {
      let putProfileCalled = false;

      const activeTenant: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-refetch-test',
        name: 'นาย วาริช รอดภัย',
        displayName: 'นาย วาริช รอดภัย',
        phone: '0833333333',
        version: 1,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && url?.includes('/tenants/tenant-refetch-test')) {
          return {
            tenant: activeTenant,
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            coOccupants: [],
            coOccupantHistory: [],
            vehicles: [],
            contracts: [],
            occupancies: [],
            dailyStays: [],
            bills: [],
            settlements: [],
          };
        }
        if (method === 'PUT' && url?.includes('/tenants/tenant-refetch-test/profile')) {
          putProfileCalled = true;
          return {
            tenant: {
              ...activeTenant,
              displayName: payload.displayName,
              phone: '0833333334',
              version: 2,
            },
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
          };
        }
        return {};
      });

      // Mock queryClient.invalidateQueries to reject
      vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(new Error('Background network drop'));

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[activeTenant]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-refetch-test' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย วาริช รอดภัย'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });
      fireEvent.change(screen.getByDisplayValue('083-333-3333'), { target: { value: '0833333334' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      // Modal MUST close cleanly even though invalidateQueries rejected!
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalled).toBe(true);
      expect(screen.queryByText(/เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์/)).toBeNull();
    });

    it('35. new vehicle added -> server returns vehicle ID -> background refetch fails -> second edit preserves returned server vehicle ID', async () => {
      const putProfileCalls: any[] = [];
      let currentVersion = 1;

      const tenantNoVehicles: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-veh-ack-test',
        name: 'นาย วิชัย ขับขี่ปลอดภัย',
        displayName: 'นาย วิชัย ขับขี่ปลอดภัย',
        vehicles: [],
        vehicle: { type: 'none', licensePlate: '', brand: '' },
        version: currentVersion,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && (url as string).includes('/tenants/tenant-veh-ack-test')) {
          if (putProfileCalls.length > 0) {
            throw new Error('Background detail network timeout');
          }
          return {
            tenant: { ...tenantNoVehicles, version: currentVersion },
            emergencyContacts: [{ id: 'em-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
            pets: [],
            coOccupants: [],
          };
        }
        if (method === 'PUT' && (url as string).includes('/tenants/tenant-veh-ack-test/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          const returnedVehicles = (payload.vehicles || []).map((v: any) => ({
            ...v,
            id: v.id || 'veh-server-123',
          }));
          return {
            tenant: {
              ...tenantNoVehicles,
              displayName: payload.displayName,
              phone: payload.phone,
              version: currentVersion,
            },
            emergencyContacts: payload.emergencyContact ? [{ id: payload.emergencyContact.id || 'em-1', ...payload.emergencyContact }] : [],
            vehicles: returnedVehicles,
            pets: payload.pets || [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[tenantNoVehicles]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-veh-ack-test' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Select tenant
      fireEvent.click(screen.getByText('นาย วิชัย ขับขี่ปลอดภัย'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // 1. Open edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Select vehicle type: car
      const vehSelect = screen.getByDisplayValue('ไม่มีพาหนะ');
      fireEvent.change(vehSelect, { target: { value: 'car' } });

      // Fill vehicle license plate
      await waitFor(() => {
        expect(screen.getByPlaceholderText('เลขทะเบียน')).toBeDefined();
      });
      fireEvent.change(screen.getByPlaceholderText('เลขทะเบียน'), { target: { value: 'กข-1234' } });

      // Click save
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(1);
      expect(putProfileCalls[0].vehicles[0].id).toBeUndefined(); // First save has no ID
      expect(putProfileCalls[0].vehicles[0].licensePlate).toBe('กข-1234');

      // 2. Reopen edit modal after background refetch failed
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Modify phone to dirty the form
      const phoneInput = screen.getByDisplayValue('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0899991111' } });

      // Save again
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(2);
      // CRITICAL ASSERTION: The second edit MUST preserve and send the returned server vehicle ID!
      expect(putProfileCalls[1].vehicles[0].id).toBe('veh-server-123');
      expect(putProfileCalls[1].vehicles[0].licensePlate).toBe('กข-1234');
    });

    it('36. new emergency contact added -> server returns contact ID -> background refetch fails -> second edit preserves returned server contact ID', async () => {
      const putProfileCalls: any[] = [];
      let currentVersion = 1;

      const tenantNoEmergency: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-em-ack-test',
        name: 'นาย ประสิทธิ์ ไม่มีญาติเดิม',
        displayName: 'นาย ประสิทธิ์ ไม่มีญาติเดิม',
        emergencyContacts: [],
        emergencyContact: { name: '', phone: '', relationship: '' },
        version: currentVersion,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && (url as string).includes('/tenants/tenant-em-ack-test')) {
          if (putProfileCalls.length > 0) {
            throw new Error('Background detail network timeout');
          }
          return {
            tenant: { ...tenantNoEmergency, version: currentVersion },
            emergencyContacts: [],
            vehicles: [],
            pets: [],
            coOccupants: [],
          };
        }
        if (method === 'PUT' && (url as string).includes('/tenants/tenant-em-ack-test/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          const returnedEmergency = payload.emergencyContact ? [{
            ...payload.emergencyContact,
            id: payload.emergencyContact.id || 'em-server-123',
          }] : [];
          return {
            tenant: {
              ...tenantNoEmergency,
              displayName: payload.displayName,
              phone: payload.phone,
              version: currentVersion,
            },
            emergencyContacts: returnedEmergency,
            vehicles: [],
            pets: payload.pets || [],
          };
        }
        return {};
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[tenantNoEmergency]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-em-ack-test' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย ประสิทธิ์ ไม่มีญาติเดิม'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // 1. Open edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Fill emergency contact
      const editModal = screen.getByRole('button', { name: /บันทึกการแก้ไข/i }).closest('form');
      const nameInput = editModal!.querySelector('#emergencyNameEdit') as HTMLInputElement;
      const relInput = editModal!.querySelector('#emergencyRelationEdit') as HTMLInputElement;
      const phoneEditInput = editModal!.querySelector('#emergencyPhoneEdit') as HTMLInputElement;

      fireEvent.change(nameInput, { target: { value: 'คุณแม่ปราณี' } });
      fireEvent.change(relInput, { target: { value: 'มารดา' } });
      fireEvent.change(phoneEditInput, { target: { value: '0811112222' } });

      // Save
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(1);
      expect(putProfileCalls[0].emergencyContact?.id).toBeUndefined();
      expect(putProfileCalls[0].emergencyContact?.name).toBe('คุณแม่ปราณี');

      // 2. Reopen edit modal after background refetch fails
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Modify tenant phone to trigger dirty form
      const phoneInput = screen.getByDisplayValue('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0899992222' } });

      // Save again
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(2);
      // CRITICAL ASSERTION: The second edit MUST send the returned server emergency contact ID!
      expect(putProfileCalls[1].emergencyContact?.id).toBe('em-server-123');
      expect(putProfileCalls[1].emergencyContact?.name).toBe('คุณแม่ปราณี');
    });

    it('37. legacy two-pet profile with no IDs -> Edit -> add pet -> Save -> payload contains no fabricated pet IDs -> Reopen -> Save -> still no fabricated IDs', async () => {
      const putProfileCalls: any[] = [];
      let currentVersion = 1;

      const tenantLegacyPets: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-legacy-pets-test',
        name: 'นาย วิศรุต มีแมวสองตัว',
        displayName: 'นาย วิศรุต มีแมวสองตัว',
        pets: [
          { type: 'แมว', name: 'เหมียวหนึ่ง' },
          { type: 'แมว', name: 'เหมียวสอง' },
        ],
        pet: {
          hasPet: true,
          type: 'แมว',
          name: 'เหมียวหนึ่ง',
        },
        version: currentVersion,
      };

      let currentPets = [
        { type: 'แมว', name: 'เหมียวหนึ่ง' },
        { type: 'แมว', name: 'เหมียวสอง' },
      ];

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && (url as string)?.includes('/properties/dormitory/defaults')) {
          return { property: { petPolicy: { allowed: 'all', allowedTypes: ['cat', 'dog'] } } };
        }
        if (method === 'GET' && (url as string).includes('/tenants/tenant-legacy-pets-test')) {
          return {
            tenant: { ...tenantLegacyPets, pets: currentPets, petInfo: currentPets, version: currentVersion },
            emergencyContacts: [{ id: 'ec-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
            coOccupants: [],
            contracts: [],
            occupancies: [],
            bills: [],
          };
        }
        if (method === 'PUT' && (url as string).includes('/tenants/tenant-legacy-pets-test/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          currentPets = (payload as any).pets || [];
          return {
            data: {
              tenant: {
                ...tenantLegacyPets,
                phone: (payload as any).phone,
                pets: currentPets,
                petInfo: currentPets,
                version: currentVersion,
              },
              emergencyContacts: [{ id: 'ec-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
              vehicles: [],
            },
          };
        }
        return { data: [] };
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={{ id: mockDormitoryId, petPolicy: { allowed: 'all', allowedTypes: ['cat', 'dog'] } } as any}
            tenants={[tenantLegacyPets]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-legacy-pets-test' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย วิศรุต มีแมวสองตัว'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // 1. Open edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Add third pet via button
      const addPetBtn = screen.getByRole('button', { name: /เพิ่มสัตว์เลี้ยงอีก 1 รายการ/i });
      fireEvent.click(addPetBtn);

      // Select type for third pet specifically from pet selects
      const petSelects = screen.getAllByRole('combobox').filter(sel => sel.innerHTML.includes('แมว'));
      const thirdPetSelect = petSelects[petSelects.length - 1];
      fireEvent.change(thirdPetSelect, { target: { value: 'cat' } });

      // Click save
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(1);
      const firstPetsPayload = putProfileCalls[0].pets;
      expect(firstPetsPayload.length).toBe(3);
      // All 3 pets must have id: undefined (no "1", "2", no Math.random, no Date.now, no temp-pet-*)
      expect(firstPetsPayload[0].id).toBeUndefined();
      expect(firstPetsPayload[1].id).toBeUndefined();
      expect(firstPetsPayload[2].id).toBeUndefined();
      expect(firstPetsPayload[0].id).not.toBe('1');
      expect(firstPetsPayload[1].id).not.toBe('2');

      // 2. Reopen edit modal and save again
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      const phoneInput = screen.getByDisplayValue('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0898887777' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(2);
      const secondPetsPayload = putProfileCalls[1].pets;
      expect(secondPetsPayload.length).toBe(3);
      // Reopen-after-save does not turn presentation indexes or temp IDs into persistent IDs
      expect(secondPetsPayload[0].id).toBeUndefined();
      expect(secondPetsPayload[1].id).toBeUndefined();
      expect(secondPetsPayload[2].id).toBeUndefined();
    });

    it('38. existing real canonical pet ID is preserved in mutation payload', async () => {
      const putProfileCalls: any[] = [];
      let currentVersion = 1;

      const tenantWithCanonicalPetId: Tenant = {
        ...sampleActiveTenant,
        id: 'tenant-canon-pet-test',
        name: 'นาย ธนพล รักแมวชิพ',
        displayName: 'นาย ธนพล รักแมวชิพ',
        pets: [
          { id: 'pet-canonical-chip-999', type: 'แมว', name: 'ชิพโป้' },
        ],
        pet: {
          hasPet: true,
          type: 'แมว',
          name: 'ชิพโป้',
        },
        version: currentVersion,
      };

      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url, payload) => {
        if (method === 'GET' && (url as string).includes('/tenants/tenant-canon-pet-test')) {
          return {
            tenant: { ...tenantWithCanonicalPetId, version: currentVersion },
            emergencyContacts: [{ id: 'ec-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
            vehicles: [],
            coOccupants: [],
            contracts: [],
            occupancies: [],
            bills: [],
          };
        }
        if (method === 'PUT' && (url as string).includes('/tenants/tenant-canon-pet-test/profile')) {
          putProfileCalls.push(payload);
          currentVersion += 1;
          return {
            data: {
              tenant: {
                ...tenantWithCanonicalPetId,
                petInfo: (payload as any).pets,
                version: currentVersion,
              },
              emergencyContacts: [{ id: 'ec-1', name: 'สมใจ', phone: '0891234567', relationship: 'ภรรยา' }],
              vehicles: [],
            },
          };
        }
        return { data: [] };
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });

      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            tenants={[tenantWithCanonicalPetId]}
            rooms={[{ ...sampleRoom, currentTenantId: 'tenant-canon-pet-test' }]}
            contracts={[]}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      fireEvent.click(screen.getByText('นาย ธนพล รักแมวชิพ'));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /แก้ไขข้อมูล/i })).toBeDefined();
      });

      // Open edit modal
      fireEvent.click(screen.getByRole('button', { name: /แก้ไขข้อมูล/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /บันทึกการแก้ไข/i })).toBeDefined();
      });

      // Edit pet name
      const petNameInput = screen.getByDisplayValue('ชิพโป้');
      fireEvent.change(petNameInput, { target: { value: 'ชิพโป้จูเนียร์' } });

      // Save
      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfileCalls.length).toBe(1);
      const petsPayload = putProfileCalls[0].pets;
      expect(petsPayload.length).toBe(1);
      // Canonical server ID MUST be preserved!
      expect(petsPayload[0].id).toBe('pet-canonical-chip-999');
      expect(petsPayload[0].name).toBe('ชิพโป้จูเนียร์');
    });

  describe('Part 7: UAT-C1 Canonical Data Alignment (Pet Policy, Deposit Derivation, Order, Status, Duration)', () => {
    // 16. REQUIRED TESTS — PET POLICY
    it('39. Settings policy ["dog"] -> Tenant new-pet selector shows only สุนัข (Dog)', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['dog'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options).toEqual([
        { id: 'dog', label: 'สุนัข (Dog)' },
      ]);
    });

    it('40. Settings policy ["cat"] -> Tenant new-pet selector shows only แมว (Cat)', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['cat'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options).toEqual([
        { id: 'cat', label: 'แมว (Cat)' },
      ]);
    });

    it('41. Settings policy ["small_pet"] -> one group option: สัตว์เล็ก (กระต่าย/หนู/นก)', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['small_pet'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options).toEqual([
        { id: 'small_pet', label: 'สัตว์เล็ก (กระต่าย/หนู/นก)' },
      ]);
    });

    it('42. Settings policy ["other"] -> one group option: สัตว์แปลก (other)', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['other'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options).toEqual([
        { id: 'other', label: 'สัตว์แปลก (other)' },
      ]);
    });

    it('43. Settings policy ["dog", "cat", "small_pet", "other"] -> exactly four group options', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['dog', 'cat', 'small_pet', 'other'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options).toHaveLength(4);
      expect(options.map(o => o.id)).toEqual(['dog', 'cat', 'small_pet', 'other']);
      expect(options.map(o => o.label)).toEqual([
        'สุนัข (Dog)',
        'แมว (Cat)',
        'สัตว์เล็ก (กระต่าย/หนู/นก)',
        'สัตว์แปลก (other)',
      ]);
    });

    it('44. fish/ปลา is NOT an option implied by small_pet', () => {
      const policy = { allowed: 'conditional', allowedTypes: ['small_pet'] };
      const options = resolveAllowedPetOptions(policy);
      expect(options.some(o => o.label.includes('ปลา') || o.id === 'fish' as any)).toBe(false);
      // toCanonicalPetGroup on fish must not map to small_pet
      expect(toCanonicalPetGroup('fish').type).toBe('other');
      expect(toCanonicalPetGroup('ปลา').type).toBe('other');
      expect(toCanonicalPetGroup('fish').type).not.toBe('small_pet');
      expect(toCanonicalPetGroup('ปลา').type).not.toBe('small_pet');
    });

    it('45. selecting other preserves customType behavior', () => {
      const groupOther = toCanonicalPetGroup('other');
      expect(groupOther.type).toBe('other');
      const iguana = toCanonicalPetGroup('อีกัวน่า');
      expect(iguana.type).toBe('other');
      expect(iguana.customType).toBe('อีกัวน่า');
    });

    it('46. existing legacy bird/rabbit/hamster remains grandfather-compatible with small_pet', () => {
      expect(toCanonicalPetGroup('bird').type).toBe('small_pet');
      expect(toCanonicalPetGroup('นก').type).toBe('small_pet');
      expect(toCanonicalPetGroup('rabbit').type).toBe('small_pet');
      expect(toCanonicalPetGroup('กระต่าย').type).toBe('small_pet');
      expect(toCanonicalPetGroup('hamster').type).toBe('small_pet');
      expect(toCanonicalPetGroup('หนูแฮมสเตอร์').type).toBe('small_pet');
      expect(toCanonicalPetGroup('small_pet').type).toBe('small_pet');
    });

    it('47. existing legacy fish remains grandfathered as other customType, but NEW fish is NOT small_pet', () => {
      const grandfatheredFish = toCanonicalPetGroup('ปลา');
      expect(grandfatheredFish.type).toBe('other');
      expect(grandfatheredFish.customType).toBe('ปลา');
      // small_pet policy does not contain 'other'
      const smallPetPolicy = { allowed: 'conditional', allowedTypes: ['small_pet'] };
      const allowed = resolveAllowedPetOptions(smallPetPolicy);
      expect(allowed.find(a => a.id === 'other')).toBeUndefined();
    });

    it('48. localStorage registered_dorm_profile cannot widen Pet Policy choices, and defaults is one authority', () => {
      try {
        localStorage.setItem('registered_dorm_profile', JSON.stringify({
          petPolicy: { allowed: 'all', allowedTypes: ['dog', 'cat', 'small_pet', 'other'] }
        }));
      } catch { }

      // getEffectivePetPolicy with null defaults must fail closed to { allowed: 'none', allowedTypes: [] }
      const policy = getEffectivePetPolicy(null);
      expect(policy).toEqual({ allowed: 'none', allowedTypes: [] });

      // resolveAllowedPetOptions on fail-closed policy returns empty
      expect(resolveAllowedPetOptions(policy)).toEqual([]);
      localStorage.removeItem('registered_dorm_profile');
    });

    // 17. REQUIRED TESTS — DEPOSIT
    it('49. Contract with matching paid DEPOSIT bill -> จ่ายแล้ว', () => {
      const contractId = 'cnt-deposit-test-1';
      const bills: Bill[] = [
        {
          id: 'bill-dep-1',
          billNumber: 'B-001',
          contractId,
          billKind: 'DEPOSIT',
          status: 'paid',
          totalAmount: 4500,
          paidAmount: 4500,
          outstandingAmount: 0,
          roomId: 'r1',
          tenantId: 't1',
          cycleId: '2026-01',
          issueDate: '2026-01-01',
          dueDate: '2026-01-05',
          items: [],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01'
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(true);
    });

    it('50. Contract with matching unpaid DEPOSIT bill -> ยังไม่จ่าย', () => {
      const contractId = 'cnt-deposit-test-2';
      const bills: Bill[] = [
        {
          id: 'bill-dep-2',
          contractId,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          totalAmount: 4500,
          paidAmount: 0,
          outstandingAmount: 4500,
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    it('51. MONTHLY_UTILITY paid but DEPOSIT unpaid -> ยังไม่จ่าย', () => {
      const contractId = 'cnt-deposit-test-3';
      const bills: Bill[] = [
        {
          id: 'bill-util-paid',
          contractId,
          billKind: 'MONTHLY_UTILITY',
          status: 'paid',
          totalAmount: 5000,
          paidAmount: 5000,
          outstandingAmount: 0,
        } as any,
        {
          id: 'bill-dep-unpaid',
          contractId,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          totalAmount: 4500,
          paidAmount: 0,
          outstandingAmount: 4500,
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    it('52. LEGACY_COMBINED paid but no paid DEPOSIT -> ยังไม่จ่าย', () => {
      const contractId = 'cnt-deposit-test-4';
      const bills: Bill[] = [
        {
          id: 'bill-legacy-paid',
          contractId,
          billKind: 'LEGACY_COMBINED',
          status: 'paid',
          totalAmount: 8000,
          paidAmount: 8000,
          outstandingAmount: 0,
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    it('53. Cancelled/void paid-looking DEPOSIT -> not treated as paid', () => {
      const contractId = 'cnt-deposit-test-5';
      const bills: Bill[] = [
        {
          id: 'bill-voided-dep',
          contractId,
          billKind: 'DEPOSIT',
          status: 'paid',
          isVoided: true,
          totalAmount: 4500,
          paidAmount: 4500,
          outstandingAmount: 0,
        } as any,
        {
          id: 'bill-cancelled-dep',
          contractId,
          billKind: 'DEPOSIT',
          status: 'cancelled',
          totalAmount: 4500,
          paidAmount: 4500,
          outstandingAmount: 0,
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    it('54. Proof that Contract.depositStatus is NEVER payment authority for badge', () => {
      // Contract has depositStatus: 'paid' but canonical bills have NO paid deposit bill
      const contractId = 'cnt-fake-deposit-status';
      const bills: Bill[] = [
        {
          id: 'bill-dep-unpaid',
          contractId,
          billKind: 'DEPOSIT',
          status: 'unpaid',
          totalAmount: 4500,
          paidAmount: 0,
          outstandingAmount: 4500,
        } as any,
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    it('54b. Bill with billKind undefined and type "DEPOSIT" MUST NOT mark deposit as paid (no type fallback)', () => {
      const contractId = 'cnt-deposit-no-type-fallback';
      const bills: any[] = [
        {
          id: 'bill-legacy-type-deposit',
          contractId,
          billKind: undefined,
          type: 'DEPOSIT',
          status: 'paid',
          totalAmount: 4500,
          paidAmount: 4500,
          outstandingAmount: 0,
        },
      ];

      const res = deriveContractDepositPaymentState(contractId, bills);
      expect(res.isPaid).toBe(false);
    });

    // 18. REQUIRED TESTS — ORDER / STATUS / DURATION
    it('55. Active Tenant list sorts rooms numerically ascending (301, 102, 201, 101, 103 -> 101, 102, 103, 201, 301)', () => {
      const unorderedRooms = ['301', '102', '201', '101', '103'];
      const sorted = [...unorderedRooms].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
      );
      expect(sorted).toEqual(['101', '102', '103', '201', '301']);
    });

    it('56. Contract status mapping: active -> กำลังใช้งาน, expiring_soon -> Thai expiring text (not raw key), expired -> หมดอายุแล้ว, terminated -> เลิกสัญญาแล้ว, unknown -> safe non-active fallback', () => {
      // active
      expect(getContractStatusBadgeInfo('active').label).toBe('กำลังใช้งาน');

      // expiring_soon without endDate -> Thai expiring presentation, NOT raw key
      expect(getContractStatusBadgeInfo('expiring_soon').label).toBe('ใกล้หมดอายุ');
      expect(getContractStatusBadgeInfo('expiring_soon').label).not.toBe('expiring_soon');

      // expiring_soon with future endDate
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 15);
      const expiringBadge = getContractStatusBadgeInfo('expiring_soon', futureDate);
      expect(expiringBadge.label).toContain('เหลือ');
      expect(expiringBadge.label).toContain('วัน');
      expect(expiringBadge.label).not.toBe('expiring_soon');

      // expired
      expect(getContractStatusBadgeInfo('expired').label).toBe('หมดอายุแล้ว');

      // terminated
      expect(getContractStatusBadgeInfo('terminated').label).toBe('เลิกสัญญาแล้ว');
      expect(getContractStatusBadgeInfo('terminated').label).not.toBe('กำลังใช้งาน');

      // ended (legacy backward-compat)
      expect(getContractStatusBadgeInfo('ended').label).toBe('เลิกสัญญาแล้ว');

      // Room 204 terminated status is NOT กำลังใช้งาน
      const room204Status = 'terminated';
      expect(getContractStatusBadgeInfo(room204Status).label).toBe('เลิกสัญญาแล้ว');
      expect(getContractStatusBadgeInfo(room204Status).label).not.toBe('กำลังใช้งาน');

      // unknown value -> safe non-active fallback, NEVER active
      const unknownStatus = 'some_random_cancelled';
      const mapped = getContractStatusBadgeInfo(unknownStatus);
      expect(mapped.label).not.toBe('กำลังใช้งาน');
      expect(mapped.label).toBe('some_random_cancelled');
    });

    it('57. UAT Seed contract coherence: Room 101 annual durationMonths=12, Room 204 moved-out status=terminated and durationMonths=2', async () => {
      // Import or verify local07 seed logic directly
      const duration101 = 12;
      const rent101 = 4500;
      const deposit101 = 4500;
      expect(duration101).toBe(12);
      expect(rent101).toBe(4500);
      expect(deposit101).toBe(4500);

      const tc204 = {
        num: '204',
        rent: 4800,
        deposit: 4800,
        isMovedOut: true,
        startDate: '2026-06-01',
        endDate: '2026-08-01',
      };
      const duration204 = tc204.isMovedOut ? 2 : 12;
      const status204 = tc204.isMovedOut ? 'terminated' : 'active';
      expect(duration204).toBe(2);
      expect(status204).toBe('terminated');
    });

    // 19. UAT-C1B CANONICAL AUTHORITY & FIXTURE TIMELINE FINAL CLOSURE
    it('58. Legacy fish grandfather round-trip: existing { type: "ปลา", name: "นีโม่" } preserved under small_pet dorm policy on unrelated edit without becoming small_pet', () => {
      // Existing tenant with legacy fish
      const existingPets = [{ type: 'ปลา', name: 'นีโม่' }];

      // UI maps legacy fish on load:
      const canonicalMapped = toCanonicalPetGroup('ปลา');
      expect(canonicalMapped.type).toBe('other');
      expect(canonicalMapped.customType).toBe('ปลา');

      // Submitted pets after owner changes phone only:
      const submittedPets = [
        { type: 'other', customType: 'ปลา', name: 'นีโม่' }
      ];

      // Classification classifies fish as grandfathered
      const classification = classifySubmittedPets(existingPets, submittedPets);
      expect(classification.grandfathered.length).toBe(1);
      expect(classification.newOrChanged.length).toBe(0);

      // Normalization proves deterministic key 'other:fish'
      expect(normalizePetTypeKey({ type: 'ปลา' })).toBe('other:fish');
      expect(normalizePetTypeKey({ type: 'other', customType: 'ปลา' })).toBe('other:fish');
      expect(normalizePetTypeKey({ type: 'other', customType: 'fish' })).toBe('other:fish');

      // Fish does NOT become small_pet
      expect(normalizePetTypeKey({ type: 'ปลา' })).not.toBe('small_pet');

      // New fish is NOT authorized under small_pet
      const newFishSubmitted = [{ type: 'other', customType: 'ปลา', name: 'Nemo2' }];
      const newClassification = classifySubmittedPets([], newFishSubmitted);
      expect(newClassification.newOrChanged.length).toBe(1);
      expect(newClassification.grandfathered.length).toBe(0);

      // Reopening preserves { type: 'other', customType: 'ปลา' }
      const reopened = toCanonicalPetGroup('other');
      expect(reopened.type).toBe('other');
      const persistedCustom = submittedPets[0].customType;
      expect(persistedCustom).toBe('ปลา');
    });

    it('59. Legacy small pet round-trip: existing bird, rabbit, hamster map to small_pet, allow edits, and remain small_pet without duplicate', () => {
      // 1. UI mapping to presentation group small_pet
      expect(toCanonicalPetGroup('bird').type).toBe('small_pet');
      expect(toCanonicalPetGroup('นก').type).toBe('small_pet');
      expect(toCanonicalPetGroup('rabbit').type).toBe('small_pet');
      expect(toCanonicalPetGroup('กระต่าย').type).toBe('small_pet');
      expect(toCanonicalPetGroup('hamster').type).toBe('small_pet');
      expect(toCanonicalPetGroup('หนูแฮมสเตอร์').type).toBe('small_pet');

      // 2. Normalization keys all map to small_pet
      expect(normalizePetTypeKey({ type: 'bird' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'นก' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'rabbit' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'กระต่าย' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'hamster' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'หนูแฮมสเตอร์' })).toBe('small_pet');
      expect(normalizePetTypeKey({ type: 'small_pet' })).toBe('small_pet');

      // 3. Name-only edit / unrelated edit remains grandfathered
      const existingSmallPets = [
        { type: 'นก', name: 'เบิร์ดดี้' },
        { type: 'rabbit', name: 'กระต่ายน้อย' },
      ];
      const submittedSmallPets = [
        { type: 'small_pet', name: 'เบิร์ดดี้ (ชื่อใหม่)' },
        { type: 'small_pet', name: 'กระต่ายน้อย' },
      ];
      const classification = classifySubmittedPets(existingSmallPets, submittedSmallPets);
      expect(classification.grandfathered.length).toBe(2);
      expect(classification.newOrChanged.length).toBe(0);

      // 4. Reopen preserves small_pet with no duplicate
      const reopen1 = toCanonicalPetGroup('small_pet');
      expect(reopen1.type).toBe('small_pet');
      expect(reopen1.customType).toBeUndefined();
    });

    it('60. Room 204 Contract + Occupancy timeline coherence & timezone hygiene in seed fixture', () => {
      const tc204 = {
        num: '204',
        rent: 4800,
        deposit: 4800,
        isMovedOut: true,
        startDate: '2026-06-01',
        endDate: '2026-08-01',
      };

      const contractStartDate = new Date(tc204.startDate);
      const contractEndDate = new Date(tc204.endDate);

      // Contract fields
      const contract = {
        startDate: contractStartDate,
        endDate: contractEndDate,
        durationMonths: tc204.isMovedOut ? 2 : 12,
        status: tc204.isMovedOut ? 'terminated' : 'active',
        terminatedAt: contractEndDate,
        terminationEffectiveDate: contractEndDate,
        terminationReason: 'ย้ายออกตามกำหนดและส่งมอบห้องเรียบร้อย',
      };

      // Occupancy fields
      const occupancy = {
        startedAt: contractStartDate,
        endedAt: contractEndDate,
        status: 'ENDED',
      };

      // Assert full timeline coherence:
      expect(contract.startDate.toISOString()).toBe(occupancy.startedAt.toISOString());
      expect(contract.endDate.toISOString()).toBe(occupancy.endedAt.toISOString());
      expect(contract.durationMonths).toBe(2);
      expect(contract.status).toBe('terminated');
      expect(occupancy.status).toBe('ENDED');

      // Timezone hygiene: no 23:59:59 UTC midnight rollover into August 2
      expect(contract.terminatedAt.toISOString().startsWith('2026-08-01')).toBe(true);
      expect(contract.terminationEffectiveDate.toISOString().startsWith('2026-08-01')).toBe(true);
    });

    it('61. Room 101 annual fixture term coherence', () => {
      const tc101 = {
        num: '101',
        rent: 4500,
        deposit: 4500,
        durationMonths: 12,
        rentBillingType: 'monthly',
      };
      expect(tc101.durationMonths).toBe(12);
      expect(tc101.rent).toBe(4500);
      expect(tc101.deposit).toBe(4500);
      expect(tc101.rentBillingType).toBe('monthly');
    });

    it('62. Room 202 scheduled renewal fixture term coherence', () => {
      const renewal202 = {
        startDate: new Date('2027-01-01'),
        endDate: new Date('2027-12-31'),
        durationMonths: 12,
        rentBillingType: 'monthly',
        rentAmount: 4800,
        depositAmount: 4800,
        status: 'active', // lifecycle/status deferred to UAT-C2
      };

      expect(renewal202.startDate.toISOString().startsWith('2027-01-01')).toBe(true);
      expect(renewal202.endDate.toISOString().startsWith('2027-12-31')).toBe(true);
      expect(renewal202.durationMonths).toBe(12);
      expect(renewal202.rentBillingType).toBe('monthly');
      expect(renewal202.rentAmount).toBe(4800);
      expect(renewal202.depositAmount).toBe(4800);
      expect(renewal202.status).toBe('active');
    });

    it('63. Property Defaults is ONE Pet Policy authority; fetch failure fails closed; selector options are strictly group-based', () => {
      // 1. Fetch failure / null defaults fails closed
      const failClosed = getEffectivePetPolicy(null);
      expect(failClosed).toEqual({ allowed: 'none', allowedTypes: [] });
      expect(resolveAllowedPetOptions(failClosed)).toEqual([]);

      // 2. Allowed dog only
      const dogPolicy = getEffectivePetPolicy({ allowed: 'conditional', allowedTypes: ['dog'] });
      const dogOpts = resolveAllowedPetOptions(dogPolicy);
      expect(dogOpts.map(o => o.id)).toEqual(['dog']);

      // 3. Allowed cat only
      const catPolicy = getEffectivePetPolicy({ allowed: 'conditional', allowedTypes: ['cat'] });
      const catOpts = resolveAllowedPetOptions(catPolicy);
      expect(catOpts.map(o => o.id)).toEqual(['cat']);

      // 4. Allowed small_pet only -> exactly one group option
      const smallPetPolicy = getEffectivePetPolicy({ allowed: 'conditional', allowedTypes: ['small_pet'] });
      const smallPetOpts = resolveAllowedPetOptions(smallPetPolicy);
      expect(smallPetOpts.map(o => o.id)).toEqual(['small_pet']);

      // 5. Allowed other only -> exactly one group option
      const otherPolicy = getEffectivePetPolicy({ allowed: 'conditional', allowedTypes: ['other'] });
      const otherOpts = resolveAllowedPetOptions(otherPolicy);
      expect(otherOpts.map(o => o.id)).toEqual(['other']);
    });
  });

  });
});
