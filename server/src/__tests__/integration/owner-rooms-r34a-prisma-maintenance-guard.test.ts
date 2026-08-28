import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateMaintenanceEligibilityFromRecords } from '../../utils/occupancy-interval.util.js';

describe('OWNER ROOMS R3.4a — Prisma Boundary Maintenance Guard Authority', () => {
  const now = new Date('2026-08-28T12:00:00Z');

  it('1. DailyStay active interval [start <= now < end] evaluates to ACTIVE_OCCUPANCY', () => {
    const dailyStays = [
      {
        id: 'd-1',
        status: 'ACTIVE',
        startDate: new Date('2026-08-25'),
        endDate: new Date('2026-08-30'),
        checkInAt: new Date('2026-08-25T06:00:00Z'),
        checkOutAt: new Date('2026-08-30T05:00:00Z'),
        actualCheckedOutAt: null,
        deletedAt: null,
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ dailyStays, now });
    expect(result.canSetMaintenance).toBe(false);
    expect(result.maintenanceBlockReason).toBe('ACTIVE_OCCUPANCY');
  });

  it('2. DailyStay future reservation [start > now] evaluates to ACTIVE_RESERVATION', () => {
    const dailyStays = [
      {
        id: 'd-2',
        status: 'RESERVED',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-05'),
        checkInAt: new Date('2026-09-01T06:00:00Z'),
        checkOutAt: new Date('2026-09-05T05:00:00Z'),
        actualCheckedOutAt: null,
        deletedAt: null,
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ dailyStays, now });
    expect(result.canSetMaintenance).toBe(false);
    expect(result.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');
  });

  it('3. DailyStay historical checked out [end <= now] permits maintenance', () => {
    const dailyStays = [
      {
        id: 'd-3',
        status: 'CHECKED_OUT',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-05'),
        actualCheckedOutAt: new Date('2026-08-05T05:00:00Z'),
        deletedAt: null,
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ dailyStays, now });
    expect(result.canSetMaintenance).toBe(true);
    expect(result.maintenanceBlockReason).toBe(null);
  });

  it('4. DailyStay soft-deleted record is excluded and permits maintenance', () => {
    const dailyStays = [
      {
        id: 'd-4',
        status: 'ACTIVE',
        startDate: new Date('2026-08-25'),
        endDate: new Date('2026-08-30'),
        deletedAt: new Date('2026-08-26T00:00:00Z'),
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ dailyStays, now });
    expect(result.canSetMaintenance).toBe(true);
    expect(result.maintenanceBlockReason).toBe(null);
  });

  it('5. Contract active interval evaluates to ACTIVE_OCCUPANCY', () => {
    const contracts = [
      {
        id: 'c-1',
        status: 'active',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        deletedAt: null,
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ contracts, now });
    expect(result.canSetMaintenance).toBe(false);
    expect(result.maintenanceBlockReason).toBe('ACTIVE_OCCUPANCY');
  });

  it('6. Contract future reservation evaluates to ACTIVE_RESERVATION', () => {
    const contracts = [
      {
        id: 'c-2',
        status: 'reserved',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2027-02-28'),
        deletedAt: null,
      },
    ];

    const result = evaluateMaintenanceEligibilityFromRecords({ contracts, now });
    expect(result.canSetMaintenance).toBe(false);
    expect(result.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');
  });

  it('7. Provisional active and future terms evaluate accurately', () => {
    const activeResult = evaluateMaintenanceEligibilityFromRecords({
      provisionals: [{
        id: 'p-1',
        status: 'ACTIVE',
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-31'),
        deletedAt: null,
      }],
      now,
    });
    expect(activeResult.canSetMaintenance).toBe(false);
    expect(activeResult.maintenanceBlockReason).toBe('ACTIVE_OCCUPANCY');

    const futureResult = evaluateMaintenanceEligibilityFromRecords({
      provisionals: [{
        id: 'p-2',
        status: 'RESERVED',
        startDate: new Date('2026-09-15'),
        endDate: new Date('2026-12-31'),
        deletedAt: null,
      }],
      now,
    });
    expect(futureResult.canSetMaintenance).toBe(false);
    expect(futureResult.maintenanceBlockReason).toBe('ACTIVE_RESERVATION');
  });
});
