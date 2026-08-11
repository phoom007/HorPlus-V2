import { describe, it, expect, beforeEach, vi } from 'vitest';

if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (i: number) => Object.keys(store)[i] || null,
    get length() { return Object.keys(store).length; },
  };
}
import { getDataMode, setDataMode, getDataProvider, HttpClientError, httpRequest } from '../data/dataProvider';
import { DemoDataProvider } from '../data/adapters/demo';
import { ApiDataProvider } from '../data/adapters/api';
import { seedDatabase } from '../data/mockData';

describe('Data Mode & Adapter Integration Suite', () => {
  beforeEach(() => {
    setDataMode('api');
    vi.restoreAllMocks();
  });

  describe('Data Mode Provider Constraints', () => {
    it('should always return ApiDataProvider to prevent production demo fallback', () => {
      const provider = getDataProvider();
      expect(provider).toBeInstanceOf(ApiDataProvider);
    });

    it('should strictly return api data mode', () => {
      expect(getDataMode()).toBe('api');
      const provider = getDataProvider();
      expect(provider).toBeInstanceOf(ApiDataProvider);
    });

    it('should require explicit instantiation for DemoDataProvider in safe test environments', () => {
      const demoProvider = new DemoDataProvider();
      expect(demoProvider).toBeInstanceOf(DemoDataProvider);
    });
  });

  describe('Demo Data Adapter Operations', () => {
    it('should retrieve dormitories asynchronously', async () => {
      const provider = new DemoDataProvider();
      const dorms = await provider.dormitories.getAll();
      expect(dorms.length).toBeGreaterThan(0);
      expect(dorms[0].id).toBe('dorm-01');
    });

    it('should calculate and generate room bills asynchronously', async () => {
      const provider = new DemoDataProvider();
      const rooms = await provider.rooms.getAll();
      expect(rooms.length).toBeGreaterThan(0);

      const billRes = await provider.billing.generateBillForRoom(rooms[0].id, '2026-07');
      expect(billRes).toBeDefined();
    });
  });

  describe('API Adapter Skeleton & HttpClient Mock Fetch Tests', () => {
    it('should perform GET request successfully and attach headers', async () => {
      const mockRooms = [{ id: 'room-101', roomNumber: '101', status: 'occupied' }];
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockRooms
      });

      setDataMode('api');
      const provider = getDataProvider();
      const rooms = await provider.rooms.getAll();

      expect(rooms).toEqual(mockRooms);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/rooms'),
        expect.objectContaining({
          method: 'GET',
          credentials: 'include'
        })
      );
    });

    it('should attach idempotency key header on POST mutations', async () => {
      const mockRoom = { id: 'room-999', roomNumber: '999', status: 'vacant' };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockRoom
      });

      setDataMode('api');
      const provider = getDataProvider();
      const res = await provider.rooms.addRoom({
        roomNumber: '999',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
        images: []
      });

      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockRoom);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/rooms'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-Idempotency-Key': expect.stringMatching(/^room_add_/)
          })
        })
      );
    });

    it('should parse 422 validation error and return Thai error message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ message: 'เลขห้องพักซ้ำในระบบ' })
      });

      setDataMode('api');
      const provider = getDataProvider();
      const res = await provider.rooms.addRoom({
        roomNumber: '101',
        floor: 1,
        monthlyRent: 4000,
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        status: 'vacant',
        images: []
      });

      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('VALIDATION_ERROR');
      expect(res.error?.message).toBe('เลขห้องพักซ้ำในระบบ');
    });

    it('should map 401 unauthorized status to Thai error message', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({})
      });

      await expect(httpRequest('GET', '/rooms')).rejects.toThrow('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    });

    it('should handle timeout/network errors gracefully without crashing', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

      await expect(httpRequest('GET', '/rooms')).rejects.toThrow('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ REST API ได้');
    });
  });
});
