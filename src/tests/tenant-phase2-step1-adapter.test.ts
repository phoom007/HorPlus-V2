/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Tenant Phase 2 Step 1: Types & Adapter Extensions Test Suite
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TenantLifecycleStage,
  EmergencyContactInput,
  VehicleInput,
  TenantStayHistoryItem,
  PetItem
} from '../types';
import { ApiTenantAdapter } from '../data/adapters/api';
import { DemoTenantAdapter } from '../data/adapters/demo';
import * as httpClientModule from '../data/httpClient';
import { HttpClientError } from '../data/httpClient';

if (typeof localStorage === 'undefined') {
  const storage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage[key] || null,
    setItem: (key: string, val: string) => { storage[key] = String(val); },
    removeItem: (key: string) => { delete storage[key]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  };
}

vi.mock('../data/httpClient', async (importOriginal) => {
  const actual = await importOriginal<typeof httpClientModule>();
  return {
    ...actual,
    httpRequest: vi.fn(),
  };
});

describe('Tenant Phase 2 Step 1 — Types & Adapter Extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Type System Conformance', () => {
    it('should correctly support all 6 TenantLifecycleStage values', () => {
      const stages: TenantLifecycleStage[] = [
        'OWNER_CREATED',
        'WAITING_LINE_BIND',
        'TENANT_FILLING_DATA',
        'WAITING_OWNER_APPROVAL',
        'WAITING_SIGNATURE',
        'REGISTERED',
      ];
      expect(stages).toHaveLength(6);
      expect(stages).toContain('OWNER_CREATED');
      expect(stages).toContain('WAITING_LINE_BIND');
      expect(stages).toContain('TENANT_FILLING_DATA');
      expect(stages).toContain('WAITING_OWNER_APPROVAL');
      expect(stages).toContain('WAITING_SIGNATURE');
      expect(stages).toContain('REGISTERED');
    });

    it('should correctly shape EmergencyContactInput', () => {
      const contact: EmergencyContactInput = {
        name: 'สมศรี สมใจ',
        phone: '0812345678',
        relationship: 'มารดา',
        isPrimary: true,
      };
      expect(contact.name).toBe('สมศรี สมใจ');
      expect(contact.phone).toBe('0812345678');
      expect(contact.relationship).toBe('มารดา');
      expect(contact.isPrimary).toBe(true);
    });

    it('should correctly shape VehicleInput', () => {
      const vehicle: VehicleInput = {
        type: 'car',
        licensePlate: '1กข 1234',
        brand: 'Toyota',
        model: 'Yaris',
        color: 'ขาว',
        province: 'กรุงเทพมหานคร',
      };
      expect(vehicle.type).toBe('car');
      expect(vehicle.licensePlate).toBe('1กข 1234');
      expect(vehicle.brand).toBe('Toyota');
      expect(vehicle.province).toBe('กรุงเทพมหานคร');
    });

    it('should correctly shape TenantStayHistoryItem', () => {
      const historyItem: TenantStayHistoryItem = {
        id: 'occ-001',
        roomId: 'room-101',
        roomNumber: '101',
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-08-31T00:00:00.000Z',
        status: 'ENDED',
        endedReason: 'ย้ายออกตามกำหนดสัญญา',
        rentalType: 'monthly',
      };
      expect(historyItem.id).toBe('occ-001');
      expect(historyItem.roomId).toBe('room-101');
      expect(historyItem.status).toBe('ENDED');
      expect(historyItem.rentalType).toBe('monthly');
    });
  });

  describe('2. ApiTenantAdapter Methods', () => {
    let adapter: ApiTenantAdapter;

    beforeEach(() => {
      adapter = new ApiTenantAdapter();
    });

    it('addEmergencyContact sends POST to /tenants/:id/emergency-contacts and returns success', async () => {
      const mockResult = {
        id: 'ec-1',
        name: 'สมชาย ผู้ติดต่อ',
        phone: '0899999999',
        relationship: 'บิดา',
        isPrimary: true,
      };
      vi.mocked(httpClientModule.httpRequest).mockResolvedValueOnce(mockResult);

      const payload: EmergencyContactInput = {
        name: 'สมชาย ผู้ติดต่อ',
        phone: '0899999999',
        relationship: 'บิดา',
        isPrimary: true,
      };

      const result = await adapter.addEmergencyContact('t-100', payload);

      expect(httpClientModule.httpRequest).toHaveBeenCalledWith(
        'POST',
        '/tenants/t-100/emergency-contacts',
        payload
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });

    it('addEmergencyContact handles HttpClientError gracefully', async () => {
      const httpErr = new HttpClientError({
        code: 'VALIDATION_ERROR',
        message: 'ข้อมูลผู้ติดต่อฉุกเฉินไม่ถูกต้อง',
      });
      vi.mocked(httpClientModule.httpRequest).mockRejectedValueOnce(httpErr);

      const result = await adapter.addEmergencyContact('t-100', {
        name: '',
        phone: '123',
        relationship: '',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('addVehicle sends POST to /tenants/:id/vehicles and returns success', async () => {
      const mockResult = {
        id: 'veh-1',
        type: 'motorcycle',
        licensePlate: '9กก 9999',
        brand: 'Honda',
      };
      vi.mocked(httpClientModule.httpRequest).mockResolvedValueOnce(mockResult);

      const payload: VehicleInput = {
        type: 'motorcycle',
        licensePlate: '9กก 9999',
        brand: 'Honda',
      };

      const result = await adapter.addVehicle('t-100', payload);

      expect(httpClientModule.httpRequest).toHaveBeenCalledWith(
        'POST',
        '/tenants/t-100/vehicles',
        payload
      );
      expect(result).toEqual({ success: true, data: mockResult });
    });

    it('addVehicle handles HttpClientError gracefully', async () => {
      const httpErr = new HttpClientError({
        code: 'VALIDATION_ERROR',
        message: 'ทะเบียนรถจำเป็นต้องระบุ',
      });
      vi.mocked(httpClientModule.httpRequest).mockRejectedValueOnce(httpErr);

      const result = await adapter.addVehicle('t-100', {
        type: 'car',
        licensePlate: '',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    it('getIdentityDocumentUrl constructs URL with encoded tenant ID', () => {
      const url = adapter.getIdentityDocumentUrl('tenant/001');
      expect(url).toContain('/tenants/tenant%2F001/identity-document');
    });

    it('updatePetInfo contract method is removed from ApiTenantAdapter (closed unvalidated bypass)', () => {
      expect((adapter as any).updatePetInfo).toBeUndefined();
    });
  });

  describe('3. DemoTenantAdapter Implementation', () => {
    let demoAdapter: DemoTenantAdapter;

    beforeEach(() => {
      demoAdapter = new DemoTenantAdapter();
    });

    it('implements getIdentityDocumentUrl returning valid endpoint string', () => {
      const url = demoAdapter.getIdentityDocumentUrl('demo-tenant-1');
      expect(url).toBe('/api/v1/tenants/demo-tenant-1/identity-document');
    });

    it('implements addEmergencyContact on mock repository', async () => {
      const contact: EmergencyContactInput = {
        name: 'ทดสอบ ผู้ติดต่อ',
        phone: '0800000000',
        relationship: 'เพื่อน',
      };
      const result = await demoAdapter.addEmergencyContact('non-existent', contact);
      // Fails gracefully if tenant not found in demo repository
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('implements addVehicle on mock repository', async () => {
      const vehicle: VehicleInput = {
        type: 'car',
        licensePlate: 'กข 1',
      };
      const result = await demoAdapter.addVehicle('non-existent', vehicle);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('updatePetInfo contract method is removed from DemoTenantAdapter (closed unvalidated bypass)', () => {
      expect((demoAdapter as any).updatePetInfo).toBeUndefined();
    });
  });
});
