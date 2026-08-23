import { describe, it, expect } from 'vitest';
import { calculateCanonicalMonthlyUtility, CanonicalMonthlyUtilityInput } from '../utils/monthly-utility-calculator.util.js';
import { calculateMeterRowPreview, RateSnapshotContext, TransientRowDraft, RoomPreviewContext } from '../utils/meter-billing-calculator.util.js';

describe('LOCAL-07 Shared Canonical Monthly Utility Calculation Authority', () => {
  const baseRates: RateSnapshotContext = {
    waterBillingType: 'per_unit',
    waterRate: '18.00',
    electricityBillingType: 'per_unit',
    electricityRate: '7.00',
    commonFeeMode: 'per_room',
    commonFee: '200.00',
    internetFeeMode: 'per_room',
    internetFee: '150.00',
    parkingFeeMode: 'per_room',
    parkingFee: '300.00',
  };

  it('1. preview and issue call same shared function/core with identical output structure', () => {
    const input: CanonicalMonthlyUtilityInput = {
      rateSnapshot: baseRates,
      waterReading: { previousReading: '100', currentReading: '110' },
      electricReading: { previousReading: '500', currentReading: '560' },
      peopleCount: 1,
      parkingQuantity: '1.00',
      manualOutstanding: '0.00',
      otherFees: [],
    };

    const directResult = calculateCanonicalMonthlyUtility(input);
    const rowPreview = calculateMeterRowPreview(
      { roomId: 'r1', billingSource: 'CONTRACT', rentAmount: '4500.00' },
      baseRates,
      { waterPrev: '100', waterCurr: '110', elecPrev: '500', elecCurr: '560', peopleCount: 1 }
    );

    expect(directResult.monthlyUtilityTotal).toBe('1250.00');
    expect(rowPreview.totalAmount).toBe('1250.00');
    expect(rowPreview.waterAmount).toBe(directResult.waterAmount);
    expect(rowPreview.elecAmount).toBe(directResult.electricityAmount);
    expect(rowPreview.commonAmount).toBe(directResult.commonFee);
    expect(rowPreview.internetAmount).toBe(directResult.internetFee);
    expect(rowPreview.parkingAmount).toBe(directResult.parkingFee);
  });

  it('2. identical water amount (10 units * 18 = 180.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '100', currentReading: '110' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterUsage).toBe('10.00');
    expect(res.waterAmount).toBe('180.00');
  });

  it('3. identical electric amount (60 units * 7 = 420.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '500', currentReading: '560' },
    });
    expect(res.electricityUsage).toBe('60.00');
    expect(res.electricityAmount).toBe('420.00');
  });

  it('4. identical common amount (fixed 200.00 vs per_person 2 * 200 = 400.00)', () => {
    const fixedRes = calculateCanonicalMonthlyUtility({
      rateSnapshot: { ...baseRates, commonFeeMode: 'per_room', commonFee: '200.00' },
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(fixedRes.commonFee).toBe('200.00');

    const personRes = calculateCanonicalMonthlyUtility({
      rateSnapshot: { ...baseRates, commonFeeMode: 'per_person', commonFee: '200.00' },
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
      peopleCount: 2,
    });
    expect(personRes.commonFee).toBe('400.00');
  });

  it('5. identical internet amount (fixed 150.00 vs per_person 2 * 150 = 300.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: { ...baseRates, internetFeeMode: 'per_person', internetFee: '150.00' },
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
      peopleCount: 2,
    });
    expect(res.internetFee).toBe('300.00');
  });

  it('6. identical parking amount (fixed 300.00 vs per_vehicle 3 * 300 = 900.00)', () => {
    const vehicleRes = calculateCanonicalMonthlyUtility({
      rateSnapshot: { ...baseRates, parkingFeeMode: 'per_vehicle', parkingFee: '300.00' },
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
      parkingQuantity: '3.00',
    });
    expect(vehicleRes.parkingFee).toBe('900.00');
  });

  it('7. identical other fees addition', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
      otherFees: [
        { description: 'คีย์การ์ด', amount: '100.00' },
        { description: 'ทำความสะอาด', amount: '250.00' },
      ],
    });
    expect(res.otherFees).toEqual([
      { description: 'คีย์การ์ด', amount: '100.00' },
      { description: 'ทำความสะอาด', amount: '250.00' },
    ]);
    expect(res.monthlyUtilityTotal).toBe('1000.00'); // 200 + 150 + 300 + 100 + 250 = 1000.00
  });

  it('8. identical manual outstanding / overdue amount addition', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
      manualOutstanding: '500.00',
    });
    expect(res.manualOutstandingAmount).toBe('500.00');
    expect(res.monthlyUtilityTotal).toBe('1150.00'); // 200 + 150 + 300 + 500 = 1150.00
  });

  it('9. identical total aggregation: Water(180) + Elec(420) + Common(200) + Internet(150) + Parking(300) = 1250.00', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '100', currentReading: '110' },
      electricReading: { previousReading: '500', currentReading: '560' },
    });
    expect(res.monthlyUtilityTotal).toBe('1250.00');
  });

  it('10. different-rate parity: N-1 prev 560, N curr 600, rate 9.00 -> 40 * 9 = 360.00', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: { ...baseRates, electricityRate: '9.00' },
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '560', currentReading: '600' },
    });
    expect(res.electricityUsage).toBe('40.00');
    expect(res.electricityAmount).toBe('360.00');
  });

  it('11. 5-digit rollover parity: 99990 -> 20 = 30 units', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '99990', currentReading: '20' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterUsage).toBe('30.00');
    expect(res.waterAmount).toBe('540.00'); // 30 * 18 = 540.00
  });

  it('12. 4-digit rollover parity: 9990 -> 20 = 30 units', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '9990', currentReading: '20' },
    });
    expect(res.electricityUsage).toBe('30.00');
    expect(res.electricityAmount).toBe('210.00'); // 30 * 7 = 210.00
  });

  it('13. lower-reading invalid parity: 500 -> 400 throws INVALID_METER_READING_LOWER', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: '500', currentReading: '400' },
        electricReading: { previousReading: '0', currentReading: '0' },
      });
    }).toThrow(/ต้องไม่น้อยกว่า/);
  });

  it('14. invalid mode parity: unknown mode throws INVALID_BILLING_MODE', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: { ...baseRates, waterBillingType: 'tiered_unknown' as any },
        waterReading: { previousReading: '0', currentReading: '0' },
        electricReading: { previousReading: '0', currentReading: '0' },
      });
    }).toThrow(/INVALID_BILLING_MODE/);
  });

  it('15. missing baseline parity: per_unit with rate > 0 and missing readings throws MISSING_WATER_METER_READING', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: null,
        electricReading: { previousReading: '0', currentReading: '0' },
      });
    }).toThrow(/MISSING_WATER_METER_READING/);
  });

  it('16. explicit zero reading: 0 -> 0 produces 0 usage and 0.00 amount without error', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterUsage).toBe('0.00');
    expect(res.waterAmount).toBe('0.00');
    expect(res.electricityUsage).toBe('0.00');
    expect(res.electricityAmount).toBe('0.00');
  });

  it('17. no Rent or Deposit embedded in Monthly Utility output', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '100', currentReading: '110' },
      electricReading: { previousReading: '500', currentReading: '560' },
    });
    expect((res as any).rentAmount).toBeUndefined();
    expect((res as any).depositAmount).toBeUndefined();
    expect(res.items.some((i) => i.type === 'rent' || i.type === 'deposit')).toBe(false);
  });

  it('18. Room 104 exact canonical amount: 0 water + 0 elec + 200 common + 150 internet + 300 parking = 650.00', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '138', currentReading: '138' },
      electricReading: { previousReading: '720', currentReading: '720' },
    });
    expect(res.waterAmount).toBe('0.00');
    expect(res.electricityAmount).toBe('0.00');
    expect(res.commonFee).toBe('200.00');
    expect(res.internetFee).toBe('150.00');
    expect(res.parkingFee).toBe('300.00');
    expect(res.monthlyUtilityTotal).toBe('650.00');
  });

  it('19. no duplicate PREVIEW after issue: verified by parity contract', () => {
    const previewRes = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '138', currentReading: '138' },
      electricReading: { previousReading: '720', currentReading: '720' },
    });
    expect(previewRes.monthlyUtilityTotal).toBe('650.00');
    expect(previewRes.items).toHaveLength(5); // water (0.00), elec (0.00), common (200.00), internet (150.00), parking (300.00)
  });
});
