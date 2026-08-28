import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveRoomOperationalStatusForCycle } from '../../services/meter.service.js';

describe('OWNER ROOMS R3.2 — Effective Room Operational Status Resolver', () => {
  const dormitoryId = 'dorm-001';
  const roomId = 'room-101';

  const cycles = [
    { id: 'cycle-2026-06', dormitoryId, cycleCode: '2026-06', periodStart: new Date('2026-06-01T00:00:00Z') },
    { id: 'cycle-2026-07', dormitoryId, cycleCode: '2026-07', periodStart: new Date('2026-07-01T00:00:00Z') },
    { id: 'cycle-2026-08', dormitoryId, cycleCode: '2026-08', periodStart: new Date('2026-08-01T00:00:00Z') },
    { id: 'cycle-2026-09', dormitoryId, cycleCode: '2026-09', periodStart: new Date('2026-09-01T00:00:00Z') },
    { id: 'cycle-2026-10', dormitoryId, cycleCode: '2026-10', periodStart: new Date('2026-10-01T00:00:00Z') },
    { id: 'cycle-2026-11', dormitoryId, cycleCode: '2026-11', periodStart: new Date('2026-11-01T00:00:00Z') },
  ];

  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      billingCycle: {
        findFirst: vi.fn(({ where }) => {
          return Promise.resolve(cycles.find(c => c.id === where.id && c.dormitoryId === where.dormitoryId) || null);
        }),
      },
      roomOperationalStatusChange: {
        findFirst: vi.fn(),
      },
    };
  });

  it('1. Resolves exact status when effective cycle matches target cycle (2026-08 MAINTENANCE)', async () => {
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-1',
      dormitoryId,
      roomId,
      effectiveBillingCycleId: 'cycle-2026-08',
      status: 'maintenance',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-08'),
    });

    const res = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-08', mockPrisma);
    expect(res.status).toBe('maintenance');
    expect(res.sourceCycleId).toBe('cycle-2026-08');
  });

  it('2. Inherits status forward to future cycle without manual copying (2026-09 inherits 2026-08 MAINTENANCE)', async () => {
    mockPrisma.roomOperationalStatusChange.findFirst.mockImplementationOnce(() => {
      return Promise.resolve({
        id: 'sc-1',
        dormitoryId,
        roomId,
        effectiveBillingCycleId: 'cycle-2026-08',
        status: 'maintenance',
        effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-08'),
      });
    });

    const res = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-09', mockPrisma);
    expect(res.status).toBe('maintenance');
    expect(res.sourceCycleId).toBe('cycle-2026-08');
  });

  it('3. Respects subsequent status changes (2026-08 MAINTENANCE, 2026-10 VACANT)', async () => {
    // For 2026-09 target -> resolves 2026-08 maintenance
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-1',
      dormitoryId,
      roomId,
      effectiveBillingCycleId: 'cycle-2026-08',
      status: 'maintenance',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-08'),
    });
    const res09 = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-09', mockPrisma);
    expect(res09.status).toBe('maintenance');

    // For 2026-10 target -> resolves 2026-10 vacant
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-2',
      dormitoryId,
      roomId,
      effectiveBillingCycleId: 'cycle-2026-10',
      status: 'vacant',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-10'),
    });
    const res10 = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-10', mockPrisma);
    expect(res10.status).toBe('vacant');
    expect(res10.sourceCycleId).toBe('cycle-2026-10');

    // For 2026-11 target -> resolves 2026-10 vacant (inherited)
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-2',
      dormitoryId,
      roomId,
      effectiveBillingCycleId: 'cycle-2026-10',
      status: 'vacant',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-10'),
    });
    const res11 = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-11', mockPrisma);
    expect(res11.status).toBe('vacant');
    expect(res11.sourceCycleId).toBe('cycle-2026-10');
  });

  it('4. Historical cycle prior to earliest baseline returns UNKNOWN (no fabricated status)', async () => {
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce(null);

    const res = await resolveRoomOperationalStatusForCycle(dormitoryId, roomId, 'cycle-2026-06', mockPrisma);
    expect(res.status).toBe('UNKNOWN');
    expect(res.sourceCycleId).toBeNull();
  });

  it('5. Room 206 seeded at July 2026 resolves maintenance in 2026-07 and inherits maintenance into August 2026', async () => {
    // In July 2026 (target cycle):
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-206-jul',
      dormitoryId,
      roomId: 'room-206',
      effectiveBillingCycleId: 'cycle-2026-07',
      status: 'maintenance',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-07'),
    });
    const resJul = await resolveRoomOperationalStatusForCycle(dormitoryId, 'room-206', 'cycle-2026-07', mockPrisma);
    expect(resJul.status).toBe('maintenance');
    expect(resJul.sourceCycleId).toBe('cycle-2026-07');

    // In August 2026 (target cycle): inherits July 2026 maintenance
    mockPrisma.roomOperationalStatusChange.findFirst.mockResolvedValueOnce({
      id: 'sc-206-jul',
      dormitoryId,
      roomId: 'room-206',
      effectiveBillingCycleId: 'cycle-2026-07',
      status: 'maintenance',
      effectiveBillingCycle: cycles.find(c => c.id === 'cycle-2026-07'),
    });
    const resAug = await resolveRoomOperationalStatusForCycle(dormitoryId, 'room-206', 'cycle-2026-08', mockPrisma);
    expect(resAug.status).toBe('maintenance');
    expect(resAug.sourceCycleId).toBe('cycle-2026-07');
  });
});
