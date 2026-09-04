// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HORPLUS-V2 — TENANT PHASE 1 FOUNDATION VERIFICATION TEST SUITE
 * Verifies:
 * 1. Zero mockData import in src/pages/owner/tenants.tsx
 * 2. Canonical LineLogo imported as LineIcon alias (no duplicate SVG component)
 * 3. Contract object does not declare non-canonical stayDate
 * 4. TypeScript model exports: VehicleItem, PetItem, CoOccupantHistoryItem, TenantProfileViewModel, TenantReturnContext
 * 5. advancePaymentAmount supports string | number
 * 6. CoOccupant supports addedAt?: string
 * 7. Context-aware back navigation:
 *    - rooms source -> onReturnToSource called with room context
 *    - meters source -> onReturnToSource called with meters context
 *    - legacy rooms -> onBackToRooms called
 *    - legacy meters -> onBackToMeters called
 *    - dismiss return context on close
 * 8. Authority-safe dataProvider methods: getDataProvider().tenants and getDataProvider().dormitories / dormitory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import { OwnerTenants } from '../pages/owner/tenants';
import {
  Tenant,
  Room,
  Contract,
  Bill,
  VehicleItem,
  PetItem,
  CoOccupantHistoryItem,
  TenantProfileViewModel,
  TenantReturnContext,
  CoOccupant
} from '../types';
import { getDataProvider } from '../data/dataProvider';

const sampleTenant: Tenant = {
  id: 'tenant-test-101',
  name: 'สมชาย ใจดี',
  phone: '0812345678',
  email: 'somchai@example.com',
  citizenId: '1234567890123',
  coOccupants: [
    {
      id: 'co-1',
      name: 'สมหญิง ใจดี',
      phone: '0898765432',
      relationship: 'แฟน',
      addedAt: '2026-08-01T00:00:00.000Z'
    }
  ],
  emergencyContact: {
    name: 'สมศักดิ์ ใจดี',
    relationship: 'บิดา',
    phone: '0811112222'
  },
  vehicle: {
    type: 'car',
    licensePlate: 'กข 1234',
    brand: 'Toyota'
  },
  pet: {
    hasPet: false
  },
  rentalHistory: ['room-101'],
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

const sampleRoom: Room = {
  id: 'room-101',
  roomNumber: '101',
  floor: 1,
  monthlyRent: 4500,
  depositAmount: 9000,
  maxOccupants: 2,
  initialWaterMeter: 10,
  initialElectricMeter: 100,
  images: [],
  status: 'occupied',
  currentTenantId: 'tenant-test-101',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

const sampleContract: Contract = {
  id: 'ct-101',
  contractNumber: 'CNT-2026-1001',
  tenantId: 'tenant-test-101',
  roomId: 'room-101',
  startDate: '2026-08-01',
  endDate: '2027-01-31',
  durationMonths: 6,
  rentAmount: 4500,
  depositAmount: 9000,
  advancePaymentAmount: '4500',
  terms: 'ข้อกำหนดและเงื่อนไขการเช่า',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
};

describe('HORPLUS-V2 — Tenant Phase 1 Foundation Verification', () => {
  describe('Static Source & Architecture Invariants', () => {
    const tenantsFilePath = path.resolve(__dirname, '../pages/owner/tenants.tsx');
    const tenantsContent = fs.readFileSync(tenantsFilePath, 'utf8');

    it('MUST NOT import from mockData in src/pages/owner/tenants.tsx', () => {
      expect(tenantsContent).not.toMatch(/from\s+['"][^'"]*mockData[^'"]*['"]/);
    });

    it('MUST import canonical LineLogo aliased as LineIcon', () => {
      expect(tenantsContent).toMatch(/import\s*\{\s*LineLogo\s+as\s+LineIcon\s*\}\s*from\s+['"]\.\.\/\.\.\/components\/LineLogo['"]/);
    });

    it('MUST NOT construct Contract with non-canonical stayDate property', () => {
      expect(tenantsContent).not.toMatch(/stayDate\s*:\s*createContractStayDate/);
    });
  });

  describe('TypeScript Models & Compatibility Types', () => {
    it('MUST export VehicleItem, PetItem, CoOccupantHistoryItem, TenantProfileViewModel, TenantReturnContext', () => {
      const vItem: VehicleItem = {
        id: 'v-1',
        type: 'car',
        licensePlate: '1กก 9999',
        brand: 'Honda'
      };
      expect(vItem.type).toBe('car');

      const pItem: PetItem = {
        id: 'p-1',
        type: 'สุนัข',
        name: 'มอม'
      };
      expect(pItem.name).toBe('มอม');

      const hItem: CoOccupantHistoryItem = {
        id: 'coh-1',
        name: 'สมหญิง',
        phone: '0898765432',
        action: 'added',
        timestamp: '2026-08-01T00:00:00.000Z'
      };
      expect(hItem.action).toBe('added');

      const vm: TenantProfileViewModel = {
        ...sampleTenant,
        vehicles: [vItem],
        pets: [pItem],
        coOccupantHistory: [hItem]
      };
      expect(vm.vehicles?.length).toBe(1);
      expect(vm.pets?.length).toBe(1);
      expect(vm.coOccupantHistory?.length).toBe(1);

      const rContext: TenantReturnContext = {
        source: 'rooms',
        tenantId: 'tenant-test-101',
        roomId: 'room-101'
      };
      expect(rContext.source).toBe('rooms');
    });

    it('MUST allow advancePaymentAmount as string or number on Contract', () => {
      const contractStringAdvance: Contract = {
        ...sampleContract,
        advancePaymentAmount: '5000.00'
      };
      expect(contractStringAdvance.advancePaymentAmount).toBe('5000.00');

      const contractNumberAdvance: Contract = {
        ...sampleContract,
        advancePaymentAmount: 5000
      };
      expect(contractNumberAdvance.advancePaymentAmount).toBe(5000);
    });

    it('MUST allow addedAt on CoOccupant', () => {
      const co: CoOccupant = {
        id: 'co-test',
        name: 'ผู้พักร่วม',
        phone: '0800000000',
        addedAt: '2026-08-01T10:00:00.000Z'
      };
      expect(co.addedAt).toBe('2026-08-01T10:00:00.000Z');
    });
  });

  describe('Data Provider Method Alignment', () => {
    it('MUST provide getDataProvider().tenants', () => {
      const provider = getDataProvider();
      expect(provider.tenants).toBeDefined();
      expect(typeof provider.tenants.getAll).toBe('function');
    });

    it('MUST provide getDataProvider().dormitories and alias getDataProvider().dormitory', () => {
      const provider = getDataProvider();
      expect(provider.dormitories).toBeDefined();
      expect(typeof provider.dormitories.getAll).toBe('function');
      expect(provider.dormitory).toBe(provider.dormitories);
    });
  });

  describe('Navigation Flow & Return Context', () => {
    beforeEach(() => {
      if (typeof localStorage === 'undefined') {
        const store: Record<string, string> = {};
        (globalThis as any).localStorage = {
          getItem: (key: string) => store[key] || null,
          setItem: (key: string, value: string) => { store[key] = String(value); },
          removeItem: (key: string) => { delete store[key]; },
          clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        };
      }
    });

    afterEach(() => {
      cleanup();
    });

    it('navigates back to Rooms via onReturnToSource when returnContext source is rooms', () => {
      const onReturnToSource = vi.fn();
      const returnContext: TenantReturnContext = {
        source: 'rooms',
        tenantId: 'tenant-test-101',
        roomId: 'room-101',
        viewMode: 'grid'
      };

      render(
        <OwnerTenants
          tenants={[sampleTenant]}
          rooms={[sampleRoom]}
          contracts={[sampleContract]}
          returnContext={returnContext}
          onReturnToSource={onReturnToSource}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
        />
      );

      // Find the room back button
      const backButton = screen.getByRole('button', { name: /กลับไปยัง/i });
      expect(backButton).toBeDefined();
      expect(backButton.textContent).toContain('(ห้อง 101)');

      fireEvent.click(backButton);
      expect(onReturnToSource).toHaveBeenCalledTimes(1);
      expect(onReturnToSource).toHaveBeenCalledWith(returnContext);
    });

    it('navigates back to Meters via onReturnToSource when returnContext source is meters', () => {
      const onReturnToSource = vi.fn();
      const returnContext: TenantReturnContext = {
        source: 'meters',
        tenantId: 'tenant-test-101',
        roomId: 'room-101',
        cycleId: 'cycle-2026-08'
      };

      render(
        <OwnerTenants
          tenants={[sampleTenant]}
          rooms={[sampleRoom]}
          contracts={[sampleContract]}
          returnContext={returnContext}
          onReturnToSource={onReturnToSource}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
        />
      );

      // Find the meters back button
      const backButton = screen.getByRole('button', { name: /กลับไปยังหน้าบันทึก "จดมิเตอร์"/i });
      expect(backButton).toBeDefined();

      fireEvent.click(backButton);
      expect(onReturnToSource).toHaveBeenCalledTimes(1);
      expect(onReturnToSource).toHaveBeenCalledWith(returnContext);
    });

    it('supports legacy tenantOriginTab="rooms" and calls onBackToRooms', () => {
      const onBackToRooms = vi.fn();

      render(
        <OwnerTenants
          tenants={[sampleTenant]}
          rooms={[sampleRoom]}
          contracts={[sampleContract]}
          initialTenantId="tenant-test-101"
          tenantOriginTab="rooms"
          onBackToRooms={onBackToRooms}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
        />
      );

      const backButton = screen.getByRole('button', { name: /กลับไปยัง/i });
      expect(backButton).toBeDefined();

      fireEvent.click(backButton);
      expect(onBackToRooms).toHaveBeenCalledWith('room-101');
    });

    it('supports legacy cameFromMeters and calls onBackToMeters', () => {
      const onBackToMeters = vi.fn();

      render(
        <OwnerTenants
          tenants={[sampleTenant]}
          rooms={[sampleRoom]}
          contracts={[sampleContract]}
          initialTenantId="tenant-test-101"
          cameFromMeters={true}
          onBackToMeters={onBackToMeters}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
        />
      );

      const backButton = screen.getByRole('button', { name: /กลับไปยังหน้าบันทึก "จดมิเตอร์"/i });
      expect(backButton).toBeDefined();

      fireEvent.click(backButton);
      expect(onBackToMeters).toHaveBeenCalledTimes(1);
    });

    it('calls onDismissReturnContext when dismissing tenant view via close button', () => {
      const onDismissReturnContext = vi.fn();
      const returnContext: TenantReturnContext = {
        source: 'rooms',
        tenantId: 'tenant-test-101',
        roomId: 'room-101'
      };

      render(
        <OwnerTenants
          tenants={[sampleTenant]}
          rooms={[sampleRoom]}
          contracts={[sampleContract]}
          returnContext={returnContext}
          onDismissReturnContext={onDismissReturnContext}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onAddLog={vi.fn()}
        />
      );

      const dismissButton = screen.getByRole('button', { name: /ดูรายชื่อผู้เช่า/i });
      expect(dismissButton).toBeDefined();

      fireEvent.click(dismissButton);
      expect(onDismissReturnContext).toHaveBeenCalledTimes(1);
    });
  });
});
