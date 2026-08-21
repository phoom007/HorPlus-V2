import { describe, it, expect } from 'vitest';
import { calculateInstallmentSchedule } from '../utils/installment-calculator.util.js';

describe('calculateInstallmentSchedule (Backend)', () => {
  it('should split 12,000 into 3 equal installments of 4,000.00', () => {
    const schedule = calculateInstallmentSchedule(12000, 3);
    expect(schedule).toHaveLength(3);
    expect(schedule[0]).toEqual({ installmentNo: 1, amount: 4000, amountSatang: 400000, formattedAmount: '4000.00' });
    expect(schedule[1]).toEqual({ installmentNo: 2, amount: 4000, amountSatang: 400000, formattedAmount: '4000.00' });
    expect(schedule[2]).toEqual({ installmentNo: 3, amount: 4000, amountSatang: 400000, formattedAmount: '4000.00' });

    const sumSatang = schedule.reduce((sum, item) => sum + item.amountSatang, 0);
    expect(sumSatang).toBe(1200000);
  });

  it('should split 10,000 into 3 installments with remainder absorbed by the last installment', () => {
    const schedule = calculateInstallmentSchedule(10000, 3);
    expect(schedule).toHaveLength(3);
    expect(schedule[0].formattedAmount).toBe('3333.33');
    expect(schedule[1].formattedAmount).toBe('3333.33');
    expect(schedule[2].formattedAmount).toBe('3333.34');

    const sumSatang = schedule.reduce((sum, item) => sum + item.amountSatang, 0);
    expect(sumSatang).toBe(1000000);
  });

  it('handles 1 installment or single payment properly', () => {
    const schedule = calculateInstallmentSchedule(15000, 1);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].formattedAmount).toBe('15000.00');
    expect(schedule[0].amountSatang).toBe(1500000);
  });

  it('handles empty or zero rent safely', () => {
    const schedule = calculateInstallmentSchedule(0, 3);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].formattedAmount).toBe('0.00');
  });
});
