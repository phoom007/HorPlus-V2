/**
 * @license Apache-2.0
 * Round 2 Phase A: Daily Stay Day Count & Zero Rent Authority Test Suite
 */
import { describe, it, expect } from 'vitest';
import { getCatalogRates, RateItem } from '../lib/roomRentalSummary';
import { Room } from '../types';

describe('Round 2 Phase A: Daily Stay Day Count & Zero Rent Authority', () => {
  describe('1. Daily Stay Night Count Semantics', () => {
    const calculateInclusiveDays = (start: string, end: string): number => {
      if (!start || !end) return 1;
      const [sy, sm, sd] = start.split('-').map(Number);
      const [ey, em, ed] = end.split('-').map(Number);
      const startUtc = Date.UTC(sy, sm - 1, sd);
      const endUtc = Date.UTC(ey, em - 1, ed);
      if (endUtc < startUtc) return 1;
      return Math.max(1, Math.round((endUtc - startUtc) / (24 * 3600 * 1000)));
    };

    it('01/09 -> 02/09 produces exactly 1 billable stay day (night count)', () => {
      expect(calculateInclusiveDays('2026-09-01', '2026-09-02')).toBe(1);
    });

    it('01/09 -> 03/09 produces exactly 2 billable stay days', () => {
      expect(calculateInclusiveDays('2026-09-01', '2026-09-03')).toBe(2);
    });

    it('01/09 -> 01/09 same-day stay produces minimum 1 day', () => {
      expect(calculateInclusiveDays('2026-09-01', '2026-09-01')).toBe(1);
    });
  });

  describe('2. Room Rental Catalog Rate Authority: 0 means NOT offered to tenant catalog', () => {
    it('room with monthly 600, term 0, daily 0 offers ONLY monthly to catalog', () => {
      const room: Room = {
        id: 'r-1',
        roomNumber: '101',
        buildingId: 'b-1',
        floor: 1,
        monthlyRent: 600,
        termRent: 0,
        dailyRent: 0,
        rentCycle: 'monthly',
        status: 'vacant',
      } as any;

      const rates = getCatalogRates(room);
      expect(rates.length).toBe(1);
      expect(rates[0].cycle).toBe('monthly');
      expect(rates[0].amount).toBe(600);
    });

    it('room with monthly 0, term 15000, daily 0 offers ONLY term to catalog', () => {
      const room: Room = {
        id: 'r-2',
        roomNumber: '102',
        buildingId: 'b-1',
        floor: 1,
        monthlyRent: 0,
        termRent: 15000,
        dailyRent: 0,
        rentCycle: 'term',
        status: 'vacant',
      } as any;

      const rates = getCatalogRates(room);
      expect(rates.length).toBe(1);
      expect(rates[0].cycle).toBe('term');
      expect(rates[0].amount).toBe(15000);
    });

    it('room with all rates positive offers all three cycles', () => {
      const room: Room = {
        id: 'r-3',
        roomNumber: '103',
        buildingId: 'b-1',
        floor: 1,
        monthlyRent: 4500,
        termRent: 18000,
        dailyRent: 500,
        rentCycle: 'monthly',
        status: 'vacant',
      } as any;

      const rates = getCatalogRates(room);
      expect(rates.length).toBe(3);
      const cycles = rates.map((r: RateItem) => r.cycle);
      expect(cycles).toContain('monthly');
      expect(cycles).toContain('term');
      expect(cycles).toContain('daily');
    });
  });
});
