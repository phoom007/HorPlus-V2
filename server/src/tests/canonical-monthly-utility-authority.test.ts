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

  it('20. Section 5 & 6: No-reading non-meter preview case (water fixed 200, elec per_person 150*2=300, common 100 -> total 600.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '200.00',
        electricityBillingType: 'per_person',
        electricityRate: '150.00',
        commonFeeMode: 'per_room',
        commonFee: '100.00',
        internetFeeMode: 'none',
        internetFee: '0.00',
        parkingFeeMode: 'none',
        parkingFee: '0.00',
      },
      waterReading: null,
      electricReading: null,
      peopleCount: 2,
    });

    expect(res.waterAmount).toBe('200.00');
    expect(res.electricityAmount).toBe('300.00');
    expect(res.commonFee).toBe('100.00');
    expect(res.monthlyUtilityTotal).toBe('600.00');
  });

  it('21. Section 6: Both FIXED case with ZERO meter readings', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '150.00',
        electricityBillingType: 'fixed',
        electricityRate: '350.00',
        commonFeeMode: 'per_room',
        commonFee: '50.00',
      },
      waterReading: null,
      electricReading: null,
    });

    expect(res.waterAmount).toBe('150.00');
    expect(res.electricityAmount).toBe('350.00');
    expect(res.commonFee).toBe('50.00');
    expect(res.monthlyUtilityTotal).toBe('550.00');
  });

  it('22. Section 7: Both PER_PERSON case with ZERO meter readings', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'per_person',
        waterRate: '100.00',
        electricityBillingType: 'per_person',
        electricityRate: '200.00',
        commonFeeMode: 'per_person',
        commonFee: '50.00',
      },
      waterReading: null,
      electricReading: null,
      peopleCount: 3,
    });

    expect(res.waterAmount).toBe('300.00');
    expect(res.electricityAmount).toBe('600.00');
    expect(res.commonFee).toBe('150.00');
    expect(res.monthlyUtilityTotal).toBe('1050.00');
  });

  it('23. Section 8: Common / Internet / Parking only without meter readings', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '0.00',
        electricityBillingType: 'fixed',
        electricityRate: '0.00',
        commonFeeMode: 'per_room',
        commonFee: '200.00',
        internetFeeMode: 'per_room',
        internetFee: '150.00',
        parkingFeeMode: 'per_room',
        parkingFee: '300.00',
      },
      waterReading: null,
      electricReading: null,
    });

    expect(res.waterAmount).toBe('0.00');
    expect(res.electricityAmount).toBe('0.00');
    expect(res.commonFee).toBe('200.00');
    expect(res.internetFee).toBe('150.00');
    expect(res.parkingFee).toBe('300.00');
    expect(res.monthlyUtilityTotal).toBe('650.00');
  });

  it('24. Section 9: Mixed Mode: Water FIXED (no reading) + Electricity PER_UNIT (with valid reading)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '200.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
      },
      waterReading: null,
      electricReading: { previousReading: '100', currentReading: '150' },
    });

    expect(res.waterAmount).toBe('200.00');
    expect(res.electricityUsage).toBe('50.00');
    expect(res.electricityAmount).toBe('400.00'); // 50 * 8 = 400.00
    expect(res.monthlyUtilityTotal).toBe('600.00');
  });

  it('25. Section 10: Mixed Mode Missing Baseline: Water FIXED + Electricity PER_UNIT (missing reading) throws fail-closed error', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '200.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
        },
        waterReading: null,
        electricReading: null,
      });
    }).toThrow(/MISSING_ELECTRICITY_METER_READING/);
  });

  it('26. Section 11: Mode Transition per_unit -> per_person works without new meter readings', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'per_person',
        waterRate: '120.00',
        electricityBillingType: 'per_person',
        electricityRate: '250.00',
      },
      waterReading: null,
      electricReading: null,
      peopleCount: 2,
    });

    expect(res.waterAmount).toBe('240.00');
    expect(res.electricityAmount).toBe('500.00');
    expect(res.monthlyUtilityTotal).toBe('740.00');
  });

  it('27. Section 11: Mode Transition per_unit -> fixed works without new meter readings', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'fixed',
        waterRate: '200.00',
        electricityBillingType: 'fixed',
        electricityRate: '400.00',
      },
      waterReading: null,
      electricReading: null,
    });

    expect(res.waterAmount).toBe('200.00');
    expect(res.electricityAmount).toBe('400.00');
    expect(res.monthlyUtilityTotal).toBe('600.00');
  });

  it('28. Section 11: Mode Transition per_person -> per_unit requires valid readings', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'per_unit',
          waterRate: '20.00',
          electricityBillingType: 'per_unit',
          electricityRate: '8.00',
        },
        waterReading: null,
        electricReading: null,
      });
    }).toThrow(/MISSING_WATER_METER_READING/);
  });

  it('29. Section 12 Matrix: Valid zero utility (100->100, 500->500, fees 0) succeeds with 0.00 and is NOT INVALID', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        commonFeeMode: 'per_room',
        commonFee: '0.00',
        internetFeeMode: 'none',
        internetFee: '0.00',
        parkingFeeMode: 'none',
        parkingFee: '0.00',
      },
      waterReading: { previousReading: '100', currentReading: '100' },
      electricReading: { previousReading: '500', currentReading: '500' },
    });

    expect(res.waterUsage).toBe('0.00');
    expect(res.waterAmount).toBe('0.00');
    expect(res.electricityUsage).toBe('0.00');
    expect(res.electricityAmount).toBe('0.00');
    expect(res.monthlyUtilityTotal).toBe('0.00');
    expect(res.isValid).toBe(true);
  });

  it('30. Section 12 Matrix: Missing electric per_unit reading throws MISSING_ELECTRICITY_METER_READING', () => {
    expect(() => {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'per_unit',
          waterRate: '18.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: null,
      });
    }).toThrow(/MISSING_ELECTRICITY_METER_READING/);
  });

  it('31. Section 12 Matrix: Malformed meter readings ("abc", "12.7", "-1", "100000") throw INVALID_METER_READING', () => {
    // 31.1 non-numeric string
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: 'abc', currentReading: '100' },
        electricReading: { previousReading: '500', currentReading: '550' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('INVALID_METER_READING');
    }

    // 31.2 decimal string where integer required
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: '12.7', currentReading: '100' },
        electricReading: { previousReading: '500', currentReading: '550' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('INVALID_METER_READING');
    }

    // 31.3 negative reading
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: '-1', currentReading: '100' },
        electricReading: { previousReading: '500', currentReading: '550' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('INVALID_METER_READING');
    }

    // 31.4 number > 99999
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: '100000', currentReading: '100' },
        electricReading: { previousReading: '500', currentReading: '550' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('INVALID_METER_READING');
    }
  });

  it('32. Section 12 Matrix: Lower meter reading without rollover throws INVALID_METER_READING_LOWER', () => {
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: baseRates,
        waterReading: { previousReading: '500', currentReading: '400' },
        electricReading: { previousReading: '500', currentReading: '550' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('INVALID_METER_READING_LOWER');
    }
  });

  it('33. Rollover readings remain valid: 99990 -> 20 (30 units) and 9990 -> 20 (30 units)', () => {
    const res5 = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '99990', currentReading: '20' },
      electricReading: { previousReading: '500', currentReading: '550' },
    });
    expect(res5.waterUsage).toBe('30.00');

    const res4 = calculateCanonicalMonthlyUtility({
      rateSnapshot: baseRates,
      waterReading: { previousReading: '9990', currentReading: '20' },
      electricReading: { previousReading: '500', currentReading: '550' },
    });
    expect(res4.waterUsage).toBe('30.00');
  });

  it('34. Section 12 Matrix: Mixed fixed + missing per_unit fails closed for overall utility', () => {
    try {
      calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          waterBillingType: 'fixed',
          waterRate: '200.00',
          electricityBillingType: 'per_unit',
          electricityRate: '7.00',
        },
        waterReading: null,
        electricReading: { previousReading: '', currentReading: '50' },
      });
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.code).toBe('MISSING_ELECTRICITY_METER_READING');
    }
  });
});
