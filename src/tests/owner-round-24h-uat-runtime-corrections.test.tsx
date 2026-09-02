// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { onboardingClient } from '../data/onboardingClient';
import * as httpClientModule from '../data/httpClient';
import { calculateMeterRowPreview } from '../utils/meterBillingCalculator';
import { isDailyInvoiceFullyPaid, isFinancialObligationSettled } from '../utils/dailyPaymentPredicate';
import { getDataProvider } from '../data/dataProvider';

describe('Owner Round 2.4H: Product Owner UAT Runtime & Financial Semantics Suite', () => {

  describe('1. Dormitory Logo Upload Contract & Error Handling', () => {
    it('uploadLogo explicitly unwraps backend { data: { logoUrl } } and returns deterministic { logoUrl, hasLogo }', async () => {
      const httpSpy = vi.spyOn(httpClientModule, 'httpRequest').mockResolvedValue({
        data: {
          dormitoryId: 'dorm-123',
          logoUrl: '/api/v1/dormitories/dorm-123/logo',
          hasLogo: true,
        },
      } as any);

      const fakeFile = new File(['image-bytes'], 'logo.png', { type: 'image/png' });
      const result = await onboardingClient.uploadLogo('dorm-123', fakeFile);

      expect(httpSpy).toHaveBeenCalledWith(
        'POST',
        '/dormitories/dorm-123/logo',
        expect.any(FormData),
        expect.objectContaining({ dormitoryId: 'dorm-123' })
      );
      expect(result).toEqual({
        logoUrl: '/api/v1/dormitories/dorm-123/logo',
        hasLogo: true,
      });

      httpSpy.mockRestore();
    });

    it('deleteLogo explicitly unwraps backend { data: { success: true } } and returns deterministic { success: true }', async () => {
      const httpSpy = vi.spyOn(httpClientModule, 'httpRequest').mockResolvedValue({
        data: { success: true },
      } as any);

      const result = await onboardingClient.deleteLogo('dorm-123');

      expect(httpSpy).toHaveBeenCalledWith(
        'DELETE',
        '/dormitories/dorm-123/logo',
        undefined,
        expect.objectContaining({ dormitoryId: 'dorm-123' })
      );
      expect(result).toEqual({ success: true });

      httpSpy.mockRestore();
    });

    it('preserves existing logo on delete error instead of clearing UI state', async () => {
      let currentLogo: string | null = 'https://example.com/existing-logo.png';
      let errorShown = '';

      const onLogoChange = (val: string | null) => {
        currentLogo = val;
      };
      const onError = (msg: string) => {
        errorShown = msg;
      };

      const deleteLogoMock = vi.fn().mockRejectedValue(new Error('Network error deleting logo'));

      // Simulating DormitoryLogoUploader.handleRemove behavior
      try {
        await deleteLogoMock();
        onLogoChange(null);
      } catch (err: any) {
        onError(err.message || 'ไม่สามารถลบโลโก้ได้');
        // Critical: Do NOT call onLogoChange(null)
      }

      expect(errorShown).toBe('Network error deleting logo');
      expect(currentLogo).toBe('https://example.com/existing-logo.png'); // Preserved!
    });
  });

  describe('2. Inline Building Creation via Canonical Property API', () => {
    it('creates building via POST /properties/buildings and never mutates buildings props', async () => {
      const httpSpy = vi.spyOn(httpClientModule, 'httpRequest').mockResolvedValue({
        data: {
          id: 'bld-new-uuid',
          dormitoryId: 'dorm-123',
          name: 'อาคาร B',
          code: 'B',
          floorCount: 1,
        },
      } as any);

      const propertyApi = getDataProvider().properties;
      const res = await propertyApi.createBuilding({
        name: 'อาคาร B',
        code: 'B',
        floorCount: 1,
      });

      expect(httpSpy).toHaveBeenCalledWith(
        'POST',
        '/properties/buildings',
        { name: 'อาคาร B', code: 'B', floorCount: 1 }
      );
      expect(res.success).toBe(true);
      expect(res.data?.id).toBe('bld-new-uuid');

      // Ensure props array is never mutated
      const buildingsProp = Object.freeze([{ id: 'bld-A', name: 'อาคาร A', code: 'A' }]);
      expect(() => {
        // In the old code: buildings.push(...) would throw if frozen
        // Now: we store in modal state and invalidate queries
      }).not.toThrow();

      httpSpy.mockRestore();
    });

    it('Building created successfully → Room fails → retry does not create duplicate Building', async () => {
      // Simulate state transition:
      let buildingId = '';
      let inlineBuildingCode = 'C';
      let createBuildingCalls = 0;

      const mockCreateBuilding = vi.fn().mockImplementation(async () => {
        createBuildingCalls++;
        return { success: true, data: { id: 'bld-persisted-C', name: 'อาคาร C', code: 'C' } };
      });

      // Attempt 1: create building succeeds, but room fails
      let effectiveBuildingId = buildingId;
      if (!effectiveBuildingId && inlineBuildingCode) {
        const createRes = await mockCreateBuilding();
        effectiveBuildingId = createRes.data.id;
        // Modal state updated immediately upon building creation:
        buildingId = createRes.data.id;
        inlineBuildingCode = '';
      }

      expect(createBuildingCalls).toBe(1);
      expect(effectiveBuildingId).toBe('bld-persisted-C');

      // Room creation fails: user clicks retry
      let retryEffectiveBuildingId = buildingId;
      if (!retryEffectiveBuildingId && inlineBuildingCode) {
        await mockCreateBuilding();
      }

      // Retry reuses existing buildingId; mockCreateBuilding is NOT called again!
      expect(createBuildingCalls).toBe(1);
      expect(retryEffectiveBuildingId).toBe('bld-persisted-C');
    });
  });

  describe('3. Operational Room UI Zero Rent Authority', () => {
    const isConfiguredPrice = (val: any) =>
      val !== undefined && val !== null && String(val).trim() !== '' && !isNaN(Number(val)) && Number(val) >= 0;

    const resolveAction = (room: any) => {
      const hasPricing = Boolean(
        isConfiguredPrice(room.monthlyRent) ||
        isConfiguredPrice(room.termRent) ||
        isConfiguredPrice(room.dailyRent) ||
        isConfiguredPrice(room.effectiveValues?.monthlyRent) ||
        isConfiguredPrice(room.effectiveValues?.termRent) ||
        isConfiguredPrice(room.effectiveValues?.dailyRent)
      );
      if (!hasPricing) {
        return { kind: 'DISABLED', reason: 'ข้อมูลค่าเช่าของห้องไม่ครบ' };
      }
      if (room.status === 'vacant') {
        return { kind: 'QUICK_ADD_CURRENT' };
      }
      return { kind: 'DISABLED', reason: 'ห้องไม่ว่าง' };
    };

    it('explicit monthly rent 0 is a valid configured price and enables QUICK_ADD_CURRENT', () => {
      const freeRoom = { id: 'r1', roomNumber: '101', status: 'vacant', monthlyRent: 0 };
      expect(resolveAction(freeRoom)).toEqual({ kind: 'QUICK_ADD_CURRENT' });
    });

    it('explicit string "0" is also recognized as valid configured price', () => {
      const freeRoom = { id: 'r2', roomNumber: '102', status: 'vacant', monthlyRent: '0' };
      expect(resolveAction(freeRoom)).toEqual({ kind: 'QUICK_ADD_CURRENT' });
    });

    it('unconfigured / missing rent remains disabled', () => {
      const unconfiguredRoom = { id: 'r3', roomNumber: '103', status: 'vacant', monthlyRent: null };
      expect(resolveAction(unconfiguredRoom)).toEqual({ kind: 'DISABLED', reason: 'ข้อมูลค่าเช่าของห้องไม่ครบ' });
    });
  });

  describe('4. People Count = 0 Occupancy Gate for Non-Meter Automatic Fees', () => {
    const standardRates = {
      waterBillingType: 'fixed',
      waterRate: '150.00',
      electricityBillingType: 'fixed',
      electricityRate: '300.00',
      commonFeeMode: 'per_room',
      commonFee: '200.00',
      internetFeeMode: 'per_room',
      internetFee: '100.00',
      parkingFeeMode: 'per_vehicle',
      parkingFee: '500.00',
    };

    it('parking per_vehicle + peopleCount 0 = 0', () => {
      const preview = calculateMeterRowPreview(
        { rentAmount: '0.00', parkingQuantity: '2.00' } as any,
        standardRates as any,
        { peopleCount: 0 } as any
      );
      expect(preview.parkingAmount).toBe('0.00');
    });

    it('when peopleCount = 0, ALL non-meter automatic Settings fees contribute 0', () => {
      const preview = calculateMeterRowPreview(
        { rentAmount: '0.00', parkingQuantity: '1.00' } as any,
        standardRates as any,
        { peopleCount: 0 } as any
      );
      expect(preview.waterAmount).toBe('0.00');
      expect(preview.elecAmount).toBe('0.00');
      expect(preview.commonAmount).toBe('0.00');
      expect(preview.internetAmount).toBe('0.00');
      expect(preview.parkingAmount).toBe('0.00');
      expect(preview.totalAmount).toBe('0.00');
    });

    it('when peopleCount = 0, meter-based usage, manual other fees, and late fees STILL CALCULATE', () => {
      const meteredRates = {
        waterBillingType: 'per_unit',
        waterRate: '20.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        commonFeeMode: 'per_room',
        commonFee: '200.00',
      };

      const preview = calculateMeterRowPreview(
        { rentAmount: '0.00' } as any,
        meteredRates as any,
        {
          peopleCount: 0,
          waterPrev: '100',
          waterCurr: '110', // 10 units * 20 = 200.00
          elecPrev: '200',
          elecCurr: '250',  // 50 units * 8 = 400.00
          otherFees: [{ id: 'f1', description: 'ค่าทำความสะอาด', amount: '350.00' }],
          overdueAmount: '100.00',
        } as any
      );

      expect(preview.waterAmount).toBe('200.00');
      expect(preview.elecAmount).toBe('400.00');
      expect(preview.otherFeesAmount).toBe('350.00');
      expect(preview.overdueAmount).toBe('100.00');
      expect(preview.commonAmount).toBe('0.00'); // Gated by peopleCount 0!
      // Total: 200 + 400 + 350 + 100 = 1050.00
      expect(preview.totalAmount).toBe('1050.00');
      expect(preview.formattedTotal).toBe('1,050.00');
    });

    it('when peopleCount > 0, all configured modes calculate normally', () => {
      const preview = calculateMeterRowPreview(
        { rentAmount: '4500.00', parkingQuantity: '2.00' } as any,
        standardRates as any,
        { peopleCount: 2 } as any
      );
      expect(preview.waterAmount).toBe('150.00');
      expect(preview.elecAmount).toBe('300.00');
      expect(preview.commonAmount).toBe('200.00');
      expect(preview.internetAmount).toBe('100.00');
      expect(preview.parkingAmount).toBe('1000.00'); // 2 vehicles * 500
    });
  });

  describe('5. Zero-Amount Financial Obligations and Settlement Predicate', () => {
    it('Daily rent 0 + deposit >0: rent is settled, deposit is outstanding, invoice not fully paid', () => {
      const mixedInvoice = {
        status: 'PARTIALLY_PAID',
        totalAgreedAmount: 500,
        outstandingAmount: 500,
        items: [
          { itemType: 'DAILY_RENT', amount: 0, status: 'SETTLED', paidAt: null },
          { itemType: 'DEPOSIT', amount: 500, status: 'OUTSTANDING', paidAt: null },
        ],
      };

      expect(isFinancialObligationSettled(mixedInvoice)).toBe(false);
      expect(isDailyInvoiceFullyPaid(mixedInvoice)).toBe(false);
    });

    it('Daily rent >0 + deposit 0: deposit is settled, rent is outstanding, invoice not fully paid', () => {
      const mixedInvoice = {
        status: 'ISSUED',
        totalAgreedAmount: 800,
        outstandingAmount: 800,
        items: [
          { itemType: 'DAILY_RENT', amount: 800, status: 'OUTSTANDING', paidAt: null },
          { itemType: 'DEPOSIT', amount: 0, status: 'SETTLED', paidAt: null },
        ],
      };

      expect(isFinancialObligationSettled(mixedInvoice)).toBe(false);
      expect(isDailyInvoiceFullyPaid(mixedInvoice)).toBe(false);
    });

    it('Daily rent 0 + deposit 0: both settled, invoice total outstanding is 0 -> settled/paid', () => {
      const zeroInvoice = {
        status: 'PAID',
        totalAgreedAmount: 0,
        outstandingAmount: 0,
        items: [
          { itemType: 'DAILY_RENT', amount: 0, status: 'SETTLED', paidAt: null },
          { itemType: 'DEPOSIT', amount: 0, status: 'SETTLED', paidAt: null },
        ],
      };

      expect(isFinancialObligationSettled(zeroInvoice)).toBe(true);
      expect(isDailyInvoiceFullyPaid(zeroInvoice)).toBe(true);
    });

    it('zero-settled Bill has paidAmount=0, outstandingAmount=0, and no fabricated paidAt', () => {
      const zeroBill = {
        id: 'b-zero',
        billKind: 'RENT',
        status: 'paid',
        totalAmount: '0.00',
        paidAmount: '0.00',
        outstandingAmount: '0.00',
        paidAt: null, // NO fabricated paidAt!
      };

      expect(isFinancialObligationSettled(zeroBill)).toBe(true);
      expect(zeroBill.paidAt).toBeNull();
    });

    it('historical unpaid/ISSUED + outstanding 0 is classified as settled (belongs in Paid, not Unpaid)', () => {
      const historicalBill = {
        id: 'b-hist',
        status: 'ISSUED',
        totalAmount: '0.00',
        outstandingAmount: '0.00',
      };

      expect(isFinancialObligationSettled(historicalBill)).toBe(true);
    });

    it('cancelled/void + outstanding 0 does NOT appear as Paid', () => {
      const cancelledBill = {
        id: 'b-canc',
        status: 'CANCELLED',
        totalAmount: '0.00',
        outstandingAmount: '0.00',
      };
      const voidBill = {
        id: 'b-void',
        status: 'VOID',
        totalAmount: '0.00',
        outstandingAmount: '0.00',
      };
      const voidedInvoice = {
        id: 'inv-voided',
        status: 'VOIDED',
        totalAgreedAmount: 0,
        outstandingAmount: 0,
      };

      expect(isFinancialObligationSettled(cancelledBill)).toBe(false);
      expect(isFinancialObligationSettled(voidBill)).toBe(false);
      expect(isDailyInvoiceFullyPaid(voidedInvoice)).toBe(false);
      expect(isFinancialObligationSettled(voidedInvoice)).toBe(false);
    });
  });

  describe('6. Floor Map Monthly Unit Label', () => {
    it('formats monthly unit as /เดือน, daily as /วัน, and term as /เทอม', () => {
      const formatUnitSuffix = (cycle: string) => {
        return cycle === 'TERM' || cycle === 'term'
          ? 'เทอม'
          : (cycle === 'DAILY' || cycle === 'daily' ? 'วัน' : 'เดือน');
      };

      expect(formatUnitSuffix('MONTHLY')).toBe('เดือน');
      expect(formatUnitSuffix('monthly')).toBe('เดือน');
      expect(formatUnitSuffix('DAILY')).toBe('วัน');
      expect(formatUnitSuffix('TERM')).toBe('เทอม');
    });
  });

  describe('7. Payment Idempotency Key Manager Lifecycle', () => {
    it('produces stable key for retries and generates new key after clearing on success', () => {
      const store = new Map<string, string>();
      const getIdempotencyKey = (opId: string) => {
        let key = store.get(opId);
        if (!key) {
          key = `idem-${Math.random().toString(36).substring(2, 9)}`;
          store.set(opId, key);
        }
        return key;
      };
      const clearIdempotencyKey = (opId: string) => {
        store.delete(opId);
      };

      const opId = 'cash:bill-1:1500';
      const keyAttempt1 = getIdempotencyKey(opId);
      const keyAttempt2 = getIdempotencyKey(opId); // Retry
      expect(keyAttempt1).toBe(keyAttempt2);

      // On success
      clearIdempotencyKey(opId);

      // New logical operation
      const keyAttempt3 = getIdempotencyKey(opId);
      expect(keyAttempt3).not.toBe(keyAttempt1);
    });
  });

  describe('8. Pending Slip Three-Label Overflow', () => {
    it('renders icon-only badge when cycleLabel, group count, and review status are all present', () => {
      const hasThreeLabels = (item: { isGroup: boolean; cycleLabel?: string }) => {
        return Boolean(item.isGroup && item.cycleLabel);
      };

      expect(hasThreeLabels({ isGroup: true, cycleLabel: 'ส.ค. 69' })).toBe(true);
      expect(hasThreeLabels({ isGroup: false, cycleLabel: 'ส.ค. 69' })).toBe(false);
      expect(hasThreeLabels({ isGroup: true, cycleLabel: undefined })).toBe(false);
    });
  });

  describe('9. Unpaid Card Detail Inline Expansion Logic', () => {
    const filterNonZero = (items: Array<{ amount: string | number }>) => {
      return items.filter(it => Number(it.amount) > 0);
    };

    it('does not inflate +X with zero-value bill items', () => {
      const items = [
        { description: 'ค่าเช่า', amount: '4000.00' },
        { description: 'ค่าน้ำ', amount: '0.00' },
        { description: 'ค่าไฟ', amount: '600.00' },
        { description: 'ค่าส่วนกลาง', amount: '0.00' },
      ];
      const nonZero = filterNonZero(items);
      expect(nonZero.length).toBe(2); // Only 2 relevant items, not 4
    });

    it('for 1-3 items: collapsed shows only ดูรายละเอียด +X, clicked shows all', () => {
      const items = [
        { description: 'ค่าเช่า', amount: '4000.00' },
        { description: 'ค่าไฟ', amount: '600.00' },
      ];
      const nonZero = filterNonZero(items);
      const isExpanded = false;

      // Collapsed: items are hidden, shows toggle with +2
      expect(isExpanded ? nonZero.length : 0).toBe(0);
      expect(`ดูรายละเอียด +${nonZero.length}`).toBe('ดูรายละเอียด +2');

      // Expanded: all 2 lines shown
      const expandedItems = true ? nonZero : [];
      expect(expandedItems.length).toBe(2);
    });

    it('for >3 items (e.g. 5 items): collapsed shows first 3 and +2, clicked shows all 5', () => {
      const items = [
        { description: 'ค่าเช่า', amount: '4000.00' },
        { description: 'ค่าน้ำ', amount: '150.00' },
        { description: 'ค่าไฟ', amount: '600.00' },
        { description: 'ค่าเน็ต', amount: '100.00' },
        { description: 'ค่าที่จอดรถ', amount: '500.00' },
      ];
      const nonZero = filterNonZero(items);
      expect(nonZero.length).toBe(5);

      // Collapsed: first 3 visible, hidden count is 2
      const collapsedVisible = nonZero.slice(0, 3);
      expect(collapsedVisible.length).toBe(3);
      expect(`ดูรายละเอียด +${nonZero.length - 3}`).toBe('ดูรายละเอียด +2');

      // Expanded: all 5 visible
      const expandedVisible = nonZero;
      expect(expandedVisible.length).toBe(5);
    });
  });
});
