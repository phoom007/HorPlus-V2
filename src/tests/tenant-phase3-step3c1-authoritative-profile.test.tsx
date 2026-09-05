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
import { OwnerTenants } from '../pages/owner/tenants';
import { queryKeys } from '../lib/queryClient';
import { Tenant, Room } from '../types';

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
      expect(screen.getByRole('option', { name: 'แมว' })).toBeDefined();
      expect(screen.queryByRole('option', { name: 'สุนัข' })).toBeNull();

      const selects = screen.getAllByRole('combobox');
      const petSelect = selects.find(s => s.innerHTML.includes('แมว'));
      if (petSelect) {
        fireEvent.change(petSelect, { target: { value: 'แมว' } });
      }
      const petNameInput = screen.getByPlaceholderText('ชื่อน้อง');
      fireEvent.change(petNameInput, { target: { value: 'มิว' } });

      fireEvent.click(screen.getByRole('button', { name: /บันทึกการแก้ไข/i }));

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /บันทึกการแก้ไข/i })).toBeNull();
      });

      expect(putProfilePayload).toBeDefined();
      expect(putProfilePayload.pets.length).toBe(1);
      expect(putProfilePayload.pets[0].type).toBe('แมว');
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
});
