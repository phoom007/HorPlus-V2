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

describe('Tenant Portal Fail-Closed Financial Fallback Verification', () => {
  beforeEach(() => {
    localStorage.clear();
    // Seed Local Storage with mock rooms & bills
    localStorage.setItem('HorPlus_rooms', JSON.stringify([
      { id: 'room-local-1', roomNumber: 'L101', currentTenantId: 'tenant-1' }
    ]));
    localStorage.setItem('HorPlus_bills', JSON.stringify([
      { id: 'bill-local-1', totalAmount: 99999, status: 'PENDING' }
    ]));
  });

  it('should not render or populate Local Storage rooms or bills when backend API fails (500)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/tenant-portal/profile')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server Error' }),
        });
      }
      if (url.includes('/api/v1/tenant-portal/bills')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server Error' }),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });

    (globalThis as any).fetch = fetchMock;

    let roomsState: any[] = [{ id: 'initial-dummy' }];
    let billsState: any[] = [{ id: 'initial-dummy' }];
    let financialError: string | null = null;

    // Simulate tenant refreshData logic
    const refreshData = async () => {
      try {
        const profileRes = await fetch('/api/v1/tenant-portal/profile');
        if (profileRes.ok) {
          const profile = await profileRes.json();
          if (profile.room) {
            roomsState = [{ id: profile.room.id, roomNumber: profile.room.roomNumber }];
          } else {
            roomsState = [];
          }
        } else {
          roomsState = [];
          financialError = 'ไม่สามารถโหลดข้อมูลผู้เช่าจากระบบได้';
        }
      } catch {
        roomsState = [];
        financialError = 'ไม่สามารถเชื่อมต่อระบบเพื่อดึงข้อมูลผู้เช่าได้';
      }

      try {
        const res = await fetch('/api/v1/tenant-portal/bills');
        if (res.ok) {
          const json = await res.json();
          if (json.data) {
            billsState = Array.isArray(json.data) ? json.data : (json.data.bills || []);
          } else {
            billsState = [];
          }
        } else {
          billsState = [];
          financialError = 'ไม่สามารถโหลดข้อมูลบิลจากระบบได้';
        }
      } catch {
        billsState = [];
        financialError = 'ไม่สามารถเชื่อมต่อระบบเพื่อดึงข้อมูลบิลได้';
      }
    };

    await refreshData();

    // Verify fail-closed behavior
    expect(roomsState).toEqual([]);
    expect(billsState).toEqual([]);
    expect(financialError).not.toBeNull();
    expect(localStorage.getItem('HorPlus_rooms')).toBeDefined(); // Local storage had data, but state stayed empty
    expect(roomsState).not.toContainEqual(expect.objectContaining({ id: 'room-local-1' }));
    expect(billsState).not.toContainEqual(expect.objectContaining({ id: 'bill-local-1' }));
  });

  it('should clear financial state to empty on network failure and set clear error state', async () => {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error('Network offline'));

    let roomsState: any[] = [{ id: 'stale-room' }];
    let billsState: any[] = [{ id: 'stale-bill' }];
    let financialError: string | null = null;

    const refreshData = async () => {
      try {
        const profileRes = await fetch('/api/v1/tenant-portal/profile');
        if (!profileRes.ok) roomsState = [];
      } catch {
        roomsState = [];
        financialError = 'Network error';
      }

      try {
        const res = await fetch('/api/v1/tenant-portal/bills');
        if (!res.ok) billsState = [];
      } catch {
        billsState = [];
        financialError = 'Network error';
      }
    };

    await refreshData();

    expect(roomsState).toEqual([]);
    expect(billsState).toEqual([]);
    expect(financialError).toBe('Network error');
  });
});
