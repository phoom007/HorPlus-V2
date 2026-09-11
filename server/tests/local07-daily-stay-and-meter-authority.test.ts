/**
 * LOCAL-07 Daily Stay & Integer-Only Meter Authority Test Suite
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { resolveDailyTimestampsAndPricing, calculateInclusiveDays } from '../src/services/daily-stay.service.js';
import { SaveMeterWorkspaceRowSchema } from '../src/schemas/billing-meter.schemas.js';
import { parseMeterIntegerReading, calculateMeterUsageUnits } from '../src/utils/meter-billing-calculator.util.js';

describe('LOCAL-07: Daily Stay Pricing & Integer-Only Meter Authority', () => {
  describe('1. Daily Rental-Day Formula & Datetime Boundaries', () => {
    it('15 -> 15 no times: checkInAt = 15 00:00 BKK, checkOutAt = 16 00:00 BKK, rent = 1 day', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-15', '2026-08-15');
      expect(res.inclusiveDayCount).toBe(1);
      expect(res.checkInAt.toISOString()).toBe('2026-08-14T17:00:00.000Z'); // 00:00 BKK is 17:00 UTC prev day
      expect(res.checkOutAt.toISOString()).toBe('2026-08-15T17:00:00.000Z'); // 16 Aug 00:00 BKK is 15 Aug 17:00 UTC
    });

    it('15 -> 16 no times: rent = 1 day', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-15', '2026-08-16');
      expect(res.inclusiveDayCount).toBe(1);
      expect(res.checkInAt.toISOString()).toBe('2026-08-14T17:00:00.000Z');
      expect(res.checkOutAt.toISOString()).toBe('2026-08-15T17:00:00.000Z'); // 16 Aug 00:00 BKK
    });

    it('15 -> 18 no times: checkOutAt = 18 00:00 BKK, rent = 3 days', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-15', '2026-08-18');
      expect(res.inclusiveDayCount).toBe(3);
      expect(res.checkInAt.toISOString()).toBe('2026-08-14T17:00:00.000Z');
      expect(res.checkOutAt.toISOString()).toBe('2026-08-17T17:00:00.000Z'); // 18 Aug 00:00 BKK
    });

    it('15 14:00 -> 15 18:00: valid, rent = 1 day', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-15', '2026-08-15', '14:00', '18:00');
      expect(res.inclusiveDayCount).toBe(1);
      expect(res.checkInAt.toISOString()).toBe('2026-08-15T07:00:00.000Z'); // 14:00 BKK
      expect(res.checkOutAt.toISOString()).toBe('2026-08-15T11:00:00.000Z'); // 18:00 BKK
    });

    it('15 18:00 -> 15 14:00: throws INVALID_DATE_RANGE', () => {
      expect(() => {
        resolveDailyTimestampsAndPricing('2026-08-15', '2026-08-15', '18:00', '14:00');
      }).toThrow('วันและเวลาเช็คเอาท์ต้องมากกว่าวันและเวลาเช็คอิน');
    });

    it('calculateInclusiveDays matches resolveDailyTimestampsAndPricing for exact daily formula', () => {
      expect(calculateInclusiveDays('2026-09-15', '2026-09-15')).toBe(1);
      expect(calculateInclusiveDays('2026-09-15', '2026-09-16')).toBe(1);
      expect(calculateInclusiveDays('2026-09-15', '2026-09-18')).toBe(3);
    });
  });

  describe('2. Integer-Only Meter Reading Validation & Rollover Authority', () => {
    it('strictly accepts valid integers 0..99999 (max 5 digits)', () => {
      expect(parseMeterIntegerReading(0).isValid).toBe(true);
      expect(parseMeterIntegerReading(0).value).toBe(0);

      expect(parseMeterIntegerReading('0').isValid).toBe(true);
      expect(parseMeterIntegerReading('0').value).toBe(0);

      expect(parseMeterIntegerReading('500').isValid).toBe(true);
      expect(parseMeterIntegerReading('500').value).toBe(500);

      expect(parseMeterIntegerReading('0500').isValid).toBe(true);
      expect(parseMeterIntegerReading('0500').value).toBe(500);

      expect(parseMeterIntegerReading(99999).isValid).toBe(true);
      expect(parseMeterIntegerReading('99999').value).toBe(99999);
    });

    it('strictly rejects decimals (12.5, 100.00, 1.50, 9999.50)', () => {
      expect(parseMeterIntegerReading('12.5').isValid).toBe(false);
      expect(parseMeterIntegerReading('100.00').isValid).toBe(false);
      expect(parseMeterIntegerReading('1.50').isValid).toBe(false);
      expect(parseMeterIntegerReading('9999.50').isValid).toBe(false);
      expect(parseMeterIntegerReading(12.5).isValid).toBe(false);
      expect(parseMeterIntegerReading(9999.5).isValid).toBe(false);
    });

    it('SaveMeterWorkspaceRowSchema strictly rejects decimals on meter fields', () => {
      const valid = SaveMeterWorkspaceRowSchema.safeParse({
        roomId: '11111111-1111-1111-1111-111111111111',
        waterPrev: '100',
        waterCurr: '150',
        elecPrev: '0',
        elecCurr: '500',
      });
      expect(valid.success).toBe(true);

      const invalidDec1 = SaveMeterWorkspaceRowSchema.safeParse({
        roomId: '11111111-1111-1111-1111-111111111111',
        waterPrev: '12.5',
      });
      expect(invalidDec1.success).toBe(false);

      const invalidDec2 = SaveMeterWorkspaceRowSchema.safeParse({
        roomId: '11111111-1111-1111-1111-111111111111',
        waterCurr: '100.00',
      });
      expect(invalidDec2.success).toBe(false);

      const invalidDec3 = SaveMeterWorkspaceRowSchema.safeParse({
        roomId: '11111111-1111-1111-1111-111111111111',
        elecPrev: '1.50',
      });
      expect(invalidDec3.success).toBe(false);

      const invalidDec4 = SaveMeterWorkspaceRowSchema.safeParse({
        roomId: '11111111-1111-1111-1111-111111111111',
        elecCurr: '9999.50',
      });
      expect(invalidDec4.success).toBe(false);
    });

    it('calculates 9999 -> 1 usage = 2 and 99999 -> 5 usage = 6', () => {
      const usage4 = calculateMeterUsageUnits(9999, 1);
      expect(usage4.isValid).toBe(true);
      expect(usage4.isRollover).toBe(true);
      expect(usage4.usageUnits).toBe(2);

      const usage5 = calculateMeterUsageUnits(99999, 5);
      expect(usage5.isValid).toBe(true);
      expect(usage5.isRollover).toBe(true);
      expect(usage5.usageUnits).toBe(6);
    });

    it('rejects lower reading outside rollover window (500 -> 400)', () => {
      const usage = calculateMeterUsageUnits(500, 400);
      expect(usage.isValid).toBe(false);
      expect(usage.usageUnits).toBe(0);
      expect(usage.errorMessage).toContain('ต้องไม่น้อยกว่าค่ามิเตอร์เดิม');
    });
  });

  describe('3. Daily Stay Explicit vs Omitted Checkout Times and Cycle Assignment', () => {
    it('explicit checkout at 00:00 (2026-08-20 00:00 to 2026-08-23 00:00): checkOutAt is exactly 2026-08-23 00:00 BKK', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-20', '2026-08-23', '00:00', '00:00');
      expect(res.checkInAt.toISOString()).toBe('2026-08-19T17:00:00.000Z'); // 20 Aug 00:00 BKK
      expect(res.checkOutAt.toISOString()).toBe('2026-08-22T17:00:00.000Z'); // 23 Aug 00:00 BKK
      expect(res.inclusiveDayCount).toBe(3);
    });

    it('omitted checkout time (2026-08-20 to 2026-08-23): checkOutAt defaults to 2026-08-23 00:00 BKK', () => {
      const res = resolveDailyTimestampsAndPricing('2026-08-20', '2026-08-23');
      expect(res.checkInAt.toISOString()).toBe('2026-08-19T17:00:00.000Z'); // 20 Aug 00:00 BKK
      expect(res.checkOutAt.toISOString()).toBe('2026-08-22T17:00:00.000Z'); // 23 Aug 00:00 BKK
      expect(res.inclusiveDayCount).toBe(3);
    });
  });
});
