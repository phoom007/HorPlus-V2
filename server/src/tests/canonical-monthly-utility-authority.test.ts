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

  // Decision B3 Semantics: Zero People Count (peopleCount = 0)
  it('B3-1: peopleCount = 0 with commonFeeMode = per_room charges fixed common fee (100.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        commonFeeMode: 'per_room',
        commonFee: '100.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.commonFee).toBe('100.00');
  });

  it('B3-2: peopleCount = 0 with commonFeeMode = per_person charges 0.00 common fee', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        commonFeeMode: 'per_person',
        commonFee: '100.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.commonFee).toBe('0.00');
  });

  it('B3-3: peopleCount = 0 with waterBillingType = fixed charges fixed water fee (150.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        waterBillingType: 'fixed',
        waterRate: '150.00',
      },
      peopleCount: 0,
      waterReading: null,
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterAmount).toBe('150.00');
  });

  it('B3-4: peopleCount = 0 with waterBillingType = per_person charges 0.00 water fee', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        waterBillingType: 'per_person',
        waterRate: '150.00',
      },
      peopleCount: 0,
      waterReading: null,
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterAmount).toBe('0.00');
  });

  it('B3-5: peopleCount = 0 with waterBillingType = per_unit charges usage units (10 units * 18 = 180.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        waterBillingType: 'per_unit',
        waterRate: '18.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '100', currentReading: '110' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.waterAmount).toBe('180.00');
  });

  it('B3-6: peopleCount = 0 with electricityBillingType = fixed charges fixed electric fee (300.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        electricityBillingType: 'fixed',
        electricityRate: '300.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: null,
    });
    expect(res.electricityAmount).toBe('300.00');
  });

  it('B3-7: peopleCount = 0 with electricityBillingType = per_person charges 0.00 electric fee', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        electricityBillingType: 'per_person',
        electricityRate: '300.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: null,
    });
    expect(res.electricityAmount).toBe('0.00');
  });

  it('B3-8: peopleCount = 0 with electricityBillingType = per_unit charges usage units (60 units * 7 = 420.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '500', currentReading: '560' },
    });
    expect(res.electricityAmount).toBe('420.00');
  });

  it('B3-9: peopleCount = 0 with parkingFeeMode = per_room charges fixed parking fee (100.00)', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        parkingFeeMode: 'per_room',
        parkingFee: '100.00',
      },
      peopleCount: 0,
      waterReading: { previousReading: '0', currentReading: '0' },
      electricReading: { previousReading: '0', currentReading: '0' },
    });
    expect(res.parkingFee).toBe('100.00');
  });

  it('B3-10: peopleCount = 0 with parkingFeeMode = per_vehicle (2 vehicles @ 100), otherFees, and manualOutstanding applies all independent charges', () => {
    const res = calculateCanonicalMonthlyUtility({
      rateSnapshot: {
        ...baseRates,
        waterBillingType: 'per_person',
        waterRate: '150.00',
        electricityBillingType: 'per_person',
        electricityRate: '300.00',
        commonFeeMode: 'per_room',
        commonFee: '200.00',
        internetFeeMode: 'per_room',
        internetFee: '150.00',
        parkingFeeMode: 'per_vehicle',
        parkingFee: '100.00',
      },
      peopleCount: 0,
      parkingQuantity: '2.00',
      otherFees: [{ description: 'คีย์การ์ด', amount: '100.00' }],
      manualOutstanding: '50.00',
      waterReading: null,
      electricReading: null,
    });

    expect(res.waterAmount).toBe('0.00');
    expect(res.electricityAmount).toBe('0.00');
    expect(res.commonFee).toBe('200.00');
    expect(res.internetFee).toBe('150.00');
    expect(res.parkingFee).toBe('200.00');
    expect(res.manualOutstandingAmount).toBe('50.00');
    expect(res.otherFees).toEqual([{ description: 'คีย์การ์ด', amount: '100.00' }]);
    expect(res.monthlyUtilityTotal).toBe('700.00'); // 200 + 150 + 200 + 100 + 50 = 700.00
  });

  describe('LOCAL-07 Canonical Late Fee Authority (Decision 2)', () => {
    it('LF-1: returns zero late fee when asOfDate is on or before dueDate', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          ...baseRates,
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-08-05',
        asOfDate: '2026-08-05',
      });

      expect(res.lateFeeAmount).toBe('0.00');
      expect(res.items.some(i => i.type === 'late_fee')).toBe(false);
      expect(res.monthlyUtilityTotal).toBe('1250.00');
    });

    it('LF-2: calculates daily late fee correctly after 2-day silent grace (Aug 8 is 1st chargeable day -> 50.00, Aug 10 is 3rd chargeable day -> 150.00)', () => {
      const resAug8 = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          ...baseRates,
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-08-05',
        asOfDate: '2026-08-08',
      });

      expect(resAug8.lateFeeAmount).toBe('50.00');
      const lateItemAug8 = resAug8.items.find(i => i.type === 'late_fee');
      expect(lateItemAug8).toBeDefined();
      expect(lateItemAug8?.amount).toBe('50.00');
      expect(lateItemAug8?.description).toBe('ค่าปรับล่าช้า (1 วัน)');
      expect(lateItemAug8?.quantity).toBe('1');
      expect(lateItemAug8?.unitPrice).toBe('50.00');
      expect(resAug8.monthlyUtilityTotal).toBe('1300.00'); // 1250.00 + 50.00

      const resAug10 = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          ...baseRates,
          lateFeeType: 'daily',
          lateFeeValue: '50.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-08-05',
        asOfDate: '2026-08-10',
      });

      expect(resAug10.lateFeeAmount).toBe('150.00');
      const lateItemAug10 = resAug10.items.find(i => i.type === 'late_fee');
      expect(lateItemAug10).toBeDefined();
      expect(lateItemAug10?.amount).toBe('150.00');
      expect(lateItemAug10?.description).toBe('ค่าปรับล่าช้า (3 วัน)');
      expect(lateItemAug10?.quantity).toBe('3');
      expect(lateItemAug10?.unitPrice).toBe('50.00');
      expect(resAug10.monthlyUtilityTotal).toBe('1400.00'); // 1250.00 + 150.00
    });

    it('LF-3: calculates fixed late fee correctly when overdue', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          ...baseRates,
          lateFeeType: 'fixed',
          lateFeeValue: '100.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-08-05',
        asOfDate: '2026-08-10',
      });

      expect(res.lateFeeAmount).toBe('100.00');
      const lateItem = res.items.find(i => i.type === 'late_fee');
      expect(lateItem).toBeDefined();
      expect(lateItem?.amount).toBe('100.00');
      expect(lateItem?.description).toBe('ค่าปรับล่าช้า');
      expect(res.monthlyUtilityTotal).toBe('1350.00'); // 1250.00 + 100.00
    });

    it('LF-4: returns zero late fee when lateFeeType is none', () => {
      const res = calculateCanonicalMonthlyUtility({
        rateSnapshot: {
          ...baseRates,
          lateFeeType: 'none',
          lateFeeValue: '50.00',
        },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-08-05',
        asOfDate: '2026-08-15',
      });

      expect(res.lateFeeAmount).toBe('0.00');
      expect(res.items.some(i => i.type === 'late_fee')).toBe(false);
      expect(res.monthlyUtilityTotal).toBe('1250.00');
    });

    it('LF-5: respects fixed 2-day silent grace before imposing penalty (chargeable days = days past due - 2)', () => {
      // dueDate = 2026-09-05, rate = 50.00/day, fixed 2-day silent grace
      const testCases = [
        { asOf: '2026-09-04', expDays: 0, expFee: '0.00' },
        { asOf: '2026-09-05', expDays: 0, expFee: '0.00' },
        { asOf: '2026-09-06', expDays: 0, expFee: '0.00' }, // Grace day 1
        { asOf: '2026-09-07', expDays: 0, expFee: '0.00' }, // Grace day 2
        { asOf: '2026-09-08', expDays: 1, expFee: '50.00' }, // 1st chargeable day
        { asOf: '2026-09-09', expDays: 2, expFee: '100.00' }, // 2nd chargeable day
        { asOf: '2026-09-10', expDays: 3, expFee: '150.00' }, // 3rd chargeable day
      ];

      for (const tc of testCases) {
        const res = calculateCanonicalMonthlyUtility({
          rateSnapshot: {
            ...baseRates,
            lateFeeType: 'daily',
            lateFeeValue: '50.00',
          },
          waterReading: { previousReading: '100', currentReading: '110' },
          electricReading: { previousReading: '500', currentReading: '560' },
          dueDate: '2026-09-05',
          asOfDate: tc.asOf,
        });

        expect(res.lateFeeAmount).toBe(tc.expFee);
        if (tc.expDays > 0) {
          expect(res.items.find(i => i.type === 'late_fee')?.description).toBe(`ค่าปรับล่าช้า (${tc.expDays} วัน)`);
        } else {
          expect(res.items.some(i => i.type === 'late_fee')).toBe(false);
        }
      }
    });

    it('LF-6: fixed mode charges lateFeeValue once on first chargeable overdue day (Sep 8 for Sep 5 due)', () => {
      const sep7 = calculateCanonicalMonthlyUtility({
        rateSnapshot: { ...baseRates, lateFeeType: 'fixed', lateFeeValue: '100.00' },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-09-05',
        asOfDate: '2026-09-07',
      });
      expect(sep7.lateFeeAmount).toBe('0.00');

      const sep8 = calculateCanonicalMonthlyUtility({
        rateSnapshot: { ...baseRates, lateFeeType: 'fixed', lateFeeValue: '100.00' },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-09-05',
        asOfDate: '2026-09-08',
      });
      expect(sep8.lateFeeAmount).toBe('100.00');
      expect(sep8.items.find(i => i.type === 'late_fee')?.description).toBe('ค่าปรับล่าช้า');

      const sep9 = calculateCanonicalMonthlyUtility({
        rateSnapshot: { ...baseRates, lateFeeType: 'fixed', lateFeeValue: '100.00' },
        waterReading: { previousReading: '100', currentReading: '110' },
        electricReading: { previousReading: '500', currentReading: '560' },
        dueDate: '2026-09-05',
        asOfDate: '2026-09-09',
      });
      expect(sep9.lateFeeAmount).toBe('100.00'); // Still 100 once
    });
  });

  describe('Strict Genuine Legacy Bill Classification Suite (LEG1–LEG4)', () => {
    function classifyBillComponent(bill: {
      billKind?: string;
      items?: Array<{ type?: string; itemType?: string; description?: string; amount?: string }>;
      billingSource?: string;
    }) {
      const rawKind = (bill.billKind || '').toString().trim().toUpperCase();
      const billingSource = bill.billingSource || 'CONTRACT';

      let billType = 'monthly_utility';
      let label = 'บิลรายเดือน';

      if (rawKind === 'RENT' || rawKind === 'MONTHLY_RENT' || rawKind === 'TERM_RENT' || rawKind === 'RENTAL') {
        billType = 'rent';
        label = billingSource === 'PROVISIONAL_TERM' || rawKind === 'TERM_RENT' ? 'ค่าเช่า (เทอม)' : 'ค่าเช่า (เดือน)';
      } else if (rawKind === 'DEPOSIT' || rawKind === 'SECURITY_DEPOSIT') {
        billType = 'deposit';
        label = 'ค่าประกัน';
      } else if (rawKind === 'LEGACY_COMBINED') {
        billType = 'legacy_combined';
        label = 'บิลรายเดือน (รวมค่าเช่า)';
      } else {
        billType = 'monthly_utility';
        label = 'บิลรายเดือน';
      }

      return { billType, label };
    }

    it('LEG1: billKind LEGACY_COMBINED -> legacy_combined with label "บิลรายเดือน (รวมค่าเช่า)"', () => {
      const result = classifyBillComponent({
        billKind: 'LEGACY_COMBINED',
        items: [
          { type: 'RENT', description: 'ค่าเช่าห้องพัก', amount: '4800.00' },
          { type: 'WATER', description: 'ค่าน้ำประปา', amount: '180.00' },
        ],
      });

      expect(result.billType).toBe('legacy_combined');
      expect(result.label).toBe('บิลรายเดือน (รวมค่าเช่า)');
    });

    it('LEG2: modern RENT and MONTHLY_UTILITY -> separate components', () => {
      const rentComp = classifyBillComponent({
        billKind: 'RENT',
        items: [{ type: 'RENT', description: 'ค่าเช่าห้องพัก', amount: '4800.00' }],
      });
      const utilityComp = classifyBillComponent({
        billKind: 'MONTHLY_UTILITY',
        items: [
          { type: 'WATER', description: 'ค่าน้ำประปา', amount: '180.00' },
          { type: 'ELECTRICITY', description: 'ค่าไฟฟ้า', amount: '420.00' },
        ],
      });

      expect(rentComp.billType).toBe('rent');
      expect(rentComp.label).toBe('ค่าเช่า (เดือน)');
      expect(utilityComp.billType).toBe('monthly_utility');
      expect(utilityComp.label).toBe('บิลรายเดือน');
    });

    it('LEG3: non-legacy bill containing both rent and utility items MUST NOT become legacy_combined', () => {
      const nonLegacyMixedBill = classifyBillComponent({
        billKind: 'MONTHLY_UTILITY',
        items: [
          { type: 'RENT', description: 'ค่าเช่าห้องพัก', amount: '4800.00' },
          { type: 'WATER', description: 'ค่าน้ำประปา', amount: '180.00' },
        ],
      });

      expect(nonLegacyMixedBill.billType).toBe('monthly_utility');
      expect(nonLegacyMixedBill.label).toBe('บิลรายเดือน');
      expect(nonLegacyMixedBill.label).not.toContain('รวมค่าเช่า');
    });

    it('LEG4: unapproved or unknown rawKind falls back to monthly_utility and NEVER combines without genuine LEGACY_COMBINED', () => {
      const unknownKindBill = classifyBillComponent({
        billKind: 'UNKNOWN_CUSTOM_KIND',
        items: [
          { type: 'RENT', description: 'ค่าเช่า', amount: '4800.00' },
          { type: 'ELECTRICITY', description: 'ค่าไฟ', amount: '350.00' },
        ],
      });

      expect(unknownKindBill.billType).toBe('monthly_utility');
      expect(unknownKindBill.label).toBe('บิลรายเดือน');
      expect(unknownKindBill.label).not.toContain('รวมค่าเช่า');
    });
  });
});
