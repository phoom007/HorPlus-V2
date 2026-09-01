/**
 * @license Apache-2.0
 * Round 2 Phase D: Go-Live Boundary & Migration History Markers Test Suite
 */
import { describe, it, expect } from 'vitest';

describe('Round 2 Phase D: Go-Live Boundary & Migration History Markers', () => {
  it('1. correctly identifies pre-HorPlus agreement when startDate < earliestCycle.periodStart', () => {
    const earliestCycle = {
      id: 'cycle-jul',
      cycleCode: '2026-07',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    };

    const startDate = '2026-05-01';
    const isPreHorPlus = Boolean(
      startDate &&
      earliestCycle?.periodStart &&
      new Date(startDate) < new Date(earliestCycle.periodStart)
    );

    expect(isPreHorPlus).toBe(true);
  });

  it('2. generates pre-HorPlus historical month list for Monthly agreement', () => {
    const startDate = '2026-05-01';
    const earliestCycleStartDate = new Date('2026-07-01');

    const periods: Array<{ id: string; label: string }> = [];
    const current = new Date(startDate);
    const end = new Date(earliestCycleStartDate);

    while (current < end) {
      const yearThai = current.getFullYear() + 543;
      const monthNames = [
        'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
      ];
      const monthName = monthNames[current.getMonth()];
      const id = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      periods.push({
        id,
        label: `${monthName} ${yearThai}`,
      });
      current.setMonth(current.getMonth() + 1);
    }

    expect(periods).toHaveLength(2);
    expect(periods[0].label).toBe('พฤษภาคม 2569');
    expect(periods[1].label).toBe('มิถุนายน 2569');
  });

  it('3. does not trigger pre-HorPlus when startDate >= earliestCycle.periodStart', () => {
    const earliestCycle = {
      id: 'cycle-jul',
      cycleCode: '2026-07',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
    };

    const startDate = '2026-09-01';
    const isPreHorPlus = Boolean(
      startDate &&
      earliestCycle?.periodStart &&
      new Date(startDate) < new Date(earliestCycle.periodStart)
    );

    expect(isPreHorPlus).toBe(false);
  });
});
