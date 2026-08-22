import { describe, it, expect } from 'vitest';
import { calculateInstallmentSchedule } from '../utils/installmentCalculator';

describe('calculateInstallmentSchedule (Frontend)', () => {
  it('should split 12,000 into 3 equal installments of 4,000.00', () => {
    const schedule = calculateInstallmentSchedule(12000, 3);
    expect(schedule).toHaveLength(3);
    expect(schedule[0]).toEqual({ installmentNo: 1, amount: 4000, amountSatang: 400000, formattedAmount: '4,000.00' });
    expect(schedule[1]).toEqual({ installmentNo: 2, amount: 4000, amountSatang: 400000, formattedAmount: '4,000.00' });
    expect(schedule[2]).toEqual({ installmentNo: 3, amount: 4000, amountSatang: 400000, formattedAmount: '4,000.00' });
    
    const sumSatang = schedule.reduce((sum, item) => sum + item.amountSatang, 0);
    expect(sumSatang).toBe(1200000);
  });

  it('should split 10,000 into 3 installments with remainder absorbed by the last installment', () => {
    const schedule = calculateInstallmentSchedule(10000, 3);
    expect(schedule).toHaveLength(3);
    expect(schedule[0].amount).toBe(3333.33);
    expect(schedule[1].amount).toBe(3333.33);
    expect(schedule[2].amount).toBe(3333.34);

    const sumSatang = schedule.reduce((sum, item) => sum + item.amountSatang, 0);
    expect(sumSatang).toBe(1000000);
    const sumAmount = Number((schedule.reduce((sum, item) => sum + item.amount, 0)).toFixed(2));
    expect(sumAmount).toBe(10000.00);
  });

  it('handles 1 installment or single payment properly', () => {
    const schedule = calculateInstallmentSchedule(15000, 1);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amount).toBe(15000);
    expect(schedule[0].amountSatang).toBe(1500000);
  });

  it('handles empty or zero rent safely', () => {
    const schedule = calculateInstallmentSchedule(0, 3);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].amount).toBe(0);
  });
});

describe('calculateMonthEndDate (Frontend Canonical Rule: add calendar months minus 1 day)', () => {
  // Canonical month end calculation utility
  const calculateMonthEndDate = (start: string, months: number): string => {
    if (!start || months < 1) return '';
    const [y, m, d] = start.split('-').map(Number);
    let targetYear = y;
    let targetMonth = m - 1 + months;
    targetYear += Math.floor(targetMonth / 12);
    targetMonth = targetMonth % 12;

    const maxDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = Math.min(d, maxDay);

    const anniversary = new Date(Date.UTC(targetYear, targetMonth, targetDay));
    anniversary.setUTCDate(anniversary.getUTCDate() - 1);
    return anniversary.toISOString().slice(0, 10);
  };

  it('correctly derives 2026-08-31 for start 2026-05-01 with 4 calendar months', () => {
    expect(calculateMonthEndDate('2026-05-01', 4)).toBe('2026-08-31');
  });

  it('correctly derives 2026-12-22 for start 2026-08-23 with 4 calendar months', () => {
    expect(calculateMonthEndDate('2026-08-23', 4)).toBe('2026-12-22');
  });
});
