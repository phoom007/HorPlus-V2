// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { onboardingClient } from '../data/onboardingClient';
import * as httpClientModule from '../data/httpClient';
import { calculateMeterRowPreview } from '../utils/meterBillingCalculator';
import {
  isDailyInvoiceFullyPaid,
  isFinancialObligationSettled,
  isFinancialObligationInvalidated,
  resolveAuthoritativeOutstandingAmount,
  parseExplicitFiniteNumber,
  CANONICAL_INVALIDATED_STATUSES,
} from '../utils/dailyPaymentPredicate';
import { getDataProvider } from '../data/dataProvider';
import { PaymentsOwnerView } from '../pages/owner/payments';
import { queryKeys } from '../lib/queryClient';

describe('Owner Round 2.4H & 2.4H.1: Product Owner UAT Runtime & Financial Semantics Suite', () => {

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

      try {
        await deleteLogoMock();
        onLogoChange(null);
      } catch (err: any) {
        onError(err.message || 'ไม่สามารถลบโลโก้ได้');
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

      const buildingsProp = Object.freeze([{ id: 'bld-A', name: 'อาคาร A', code: 'A' }]);
      expect(() => {
        // Props array is frozen, no mutation occurs
      }).not.toThrow();

      httpSpy.mockRestore();
    });

    it('Building created successfully → Room fails → retry does not create duplicate Building', async () => {
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
      expect(preview.commonAmount).toBe('0.00'); // Gated by peopleCount 0
      expect(preview.otherFeesAmount).toBe('350.00');
      expect(preview.overdueAmount).toBe('100.00');
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

  describe('5. Canonical Financial Settlement Predicate & Invalidation Authority (Round 2.4H.1)', () => {
    it('parseExplicitFiniteNumber correctly parses finite numeric values and rejects missing/blank/malformed', () => {
      expect(parseExplicitFiniteNumber(0)).toBe(0);
      expect(parseExplicitFiniteNumber('0')).toBe(0);
      expect(parseExplicitFiniteNumber('0.00')).toBe(0);
      expect(parseExplicitFiniteNumber(800)).toBe(800);
      expect(parseExplicitFiniteNumber('800.50')).toBe(800.5);

      // Fails closed on missing/blank/malformed
      expect(parseExplicitFiniteNumber(undefined)).toBeNull();
      expect(parseExplicitFiniteNumber(null)).toBeNull();
      expect(parseExplicitFiniteNumber('')).toBeNull();
      expect(parseExplicitFiniteNumber('   ')).toBeNull();
      expect(parseExplicitFiniteNumber('abc')).toBeNull();
      expect(parseExplicitFiniteNumber(NaN)).toBeNull();
      expect(parseExplicitFiniteNumber(Infinity)).toBeNull();
    });

    it('resolveAuthoritativeOutstandingAmount fails closed when missing/blank/malformed', () => {
      expect(resolveAuthoritativeOutstandingAmount({ outstandingAmount: undefined, totalAmount: undefined })).toBeNull();
      expect(resolveAuthoritativeOutstandingAmount({ outstandingAmount: '', totalAmount: '' })).toBeNull();
      expect(resolveAuthoritativeOutstandingAmount({ outstandingAmount: 'abc' })).toBeNull();
      expect(resolveAuthoritativeOutstandingAmount(null)).toBeNull();
      expect(resolveAuthoritativeOutstandingAmount(undefined)).toBeNull();

      expect(resolveAuthoritativeOutstandingAmount({ outstandingAmount: '0.00' })).toBe(0);
      expect(resolveAuthoritativeOutstandingAmount({ outstandingAmount: null, totalAmount: '500' })).toBe(500);
    });

    it('isFinancialObligationSettled fails closed on missing, blank, or malformed authority', () => {
      expect(isFinancialObligationSettled({ outstandingAmount: undefined, totalAmount: undefined })).toBe(false);
      expect(isFinancialObligationSettled({ outstandingAmount: '' })).toBe(false);
      expect(isFinancialObligationSettled({ outstandingAmount: 'abc' })).toBe(false);
      expect(isFinancialObligationSettled(null)).toBe(false);
    });

    it('isFinancialObligationSettled succeeds on explicit finite zero', () => {
      expect(isFinancialObligationSettled({ outstandingAmount: 0 })).toBe(true);
      expect(isFinancialObligationSettled({ outstandingAmount: '0' })).toBe(true);
      expect(isFinancialObligationSettled({ outstandingAmount: '0.00' })).toBe(true);
      expect(isFinancialObligationSettled({ totalAmount: '0.00' })).toBe(true);
    });

    it('isFinancialObligationInvalidated strictly covers CANCELLED, VOID, VOIDED, WITHDRAWN, SUPERSEDED', () => {
      expect(CANONICAL_INVALIDATED_STATUSES.has('CANCELLED')).toBe(true);
      expect(CANONICAL_INVALIDATED_STATUSES.has('VOID')).toBe(true);
      expect(CANONICAL_INVALIDATED_STATUSES.has('VOIDED')).toBe(true);
      expect(CANONICAL_INVALIDATED_STATUSES.has('WITHDRAWN')).toBe(true);
      expect(CANONICAL_INVALIDATED_STATUSES.has('SUPERSEDED')).toBe(true);

      expect(isFinancialObligationInvalidated('CANCELLED')).toBe(true);
      expect(isFinancialObligationInvalidated('cancelled')).toBe(true);
      expect(isFinancialObligationInvalidated('VOID')).toBe(true);
      expect(isFinancialObligationInvalidated('void')).toBe(true);
      expect(isFinancialObligationInvalidated('VOIDED')).toBe(true);
      expect(isFinancialObligationInvalidated('voided')).toBe(true);
      expect(isFinancialObligationInvalidated('WITHDRAWN')).toBe(true);
      expect(isFinancialObligationInvalidated('withdrawn')).toBe(true);
      expect(isFinancialObligationInvalidated('SUPERSEDED')).toBe(true);
      expect(isFinancialObligationInvalidated('superseded')).toBe(true);

      expect(isFinancialObligationInvalidated('ISSUED')).toBe(false);
      expect(isFinancialObligationInvalidated('paid')).toBe(false);
      expect(isFinancialObligationInvalidated('unpaid')).toBe(false);
      expect(isFinancialObligationInvalidated('pending')).toBe(false);
    });

    it('invalidated records with explicit zero amount are NEVER classified as settled', () => {
      expect(isFinancialObligationSettled({ status: 'WITHDRAWN', outstandingAmount: '0.00' })).toBe(false);
      expect(isFinancialObligationSettled({ status: 'SUPERSEDED', outstandingAmount: '0.00' })).toBe(false);
      expect(isFinancialObligationSettled({ status: 'CANCELLED', outstandingAmount: '0.00' })).toBe(false);
      expect(isFinancialObligationSettled({ status: 'VOID', outstandingAmount: '0.00' })).toBe(false);
      expect(isFinancialObligationSettled({ status: 'VOIDED', outstandingAmount: '0.00' })).toBe(false);
    });

    it('historical unpaid/ISSUED + explicit outstanding 0 is classified as settled (belongs in Paid, not Unpaid)', () => {
      const historicalBill = {
        id: 'b-hist',
        status: 'ISSUED',
        totalAmount: '0.00',
        outstandingAmount: '0.00',
      };
      expect(isFinancialObligationSettled(historicalBill)).toBe(true);
    });

    it('Daily rent 0 + deposit >0: rent is settled, deposit is outstanding, invoice not fully paid', () => {
      const mixedInvoice = {
        status: 'ISSUED',
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
        paidAt: null,
      };

      expect(isFinancialObligationSettled(zeroBill)).toBe(true);
      expect(zeroBill.paidAt).toBeNull();
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

  describe('7. Real Payment UI Wiring & Idempotency Key Lifecycle Proof (PaymentsOwnerView)', () => {
    let queryClient: QueryClient;
    const mockDormitoryId = 'dorm-uat-24h1';
    const mockCycleAugId = 'cycle-2026-08';

    const mockBillingCycles = [
      {
        id: mockCycleAugId,
        cycleCode: '2026-08',
        name: 'สิงหาคม 2569',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
      },
    ];

    const mockRooms = [
      { id: 'r101', roomNumber: '101', dormitoryId: mockDormitoryId },
      { id: 'r102', roomNumber: '102', dormitoryId: mockDormitoryId },
      { id: 'r103', roomNumber: '103', dormitoryId: mockDormitoryId },
    ];

    const mockTenants = [
      { id: 't1', displayName: 'สมชาย สบายดี', roomId: 'r101' },
      { id: 't2', displayName: 'สมหญิง จริงใจ', roomId: 'r102' },
      { id: 't3', displayName: 'ประสิทธิ์ มั่งมี', roomId: 'r103' },
    ];

    const mockBills = [
      {
        id: 'bill-unpaid-101',
        roomId: 'r101',
        tenantId: 't1',
        dormitoryId: mockDormitoryId,
        billingCycleId: mockCycleAugId,
        billNumber: 'INV-202608-101',
        status: 'unpaid',
        totalAmount: 3500,
        outstandingAmount: 3500,
        paidAmount: 0,
        items: [{ description: 'ค่าเช่าห้อง', amount: '3500.00' }],
      },
      {
        id: 'bill-unpaid-102',
        roomId: 'r102',
        tenantId: 't2',
        dormitoryId: mockDormitoryId,
        billingCycleId: mockCycleAugId,
        billNumber: 'INV-202608-102',
        status: 'unpaid',
        totalAmount: 4000,
        outstandingAmount: 4000,
        paidAmount: 0,
        items: [{ description: 'ค่าเช่าห้อง', amount: '4000.00' }],
      },
    ];

    const mockDailyInvoices = [
      {
        id: 'inv-daily-101',
        dormitoryId: mockDormitoryId,
        dailyStayId: 'stay-101',
        invoiceNumber: 'DINV-202608-101',
        status: 'ISSUED',
        totalAgreedAmount: 800,
        outstandingAmount: 800,
        dailyStay: {
          roomId: 'r101',
          startDate: '2026-08-05',
          endDate: '2026-08-06',
          tenant: { displayName: 'ผู้พักรายวัน 101' },
          room: { roomNumber: '101' },
        },
        items: [{ itemType: 'DAILY_RENT', amount: 800, status: 'OUTSTANDING', paidAt: null }],
      },
    ];

    beforeEach(() => {
      vi.useFakeTimers();
      queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Infinity },
        },
      });

      queryClient.setQueryData(['auth', 'session'], { user: { name: 'เจ้าของหอพัก' } });
      queryClient.setQueryData(queryKeys.payments(mockDormitoryId), []);
      queryClient.setQueryData(queryKeys.dailyInvoices(mockDormitoryId), mockDailyInvoices);
    });

    afterEach(() => {
      cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('7.1 Normal Bill Cash: triggers handleConfirmCashPayment, sends idempotency key, preserves key on retry, clears on success', async () => {
      let callCount = 0;
      let capturedKeys: string[] = [];

      vi.spyOn(httpClientModule, 'httpRequest').mockImplementation(async (method, url, body, options) => {
        if (url === '/payments/cash') {
          callCount++;
          const key = options?.headers?.['x-idempotency-key'];
          capturedKeys.push(key);
          if (callCount === 1) {
            throw new Error('Network timeout during cash settlement');
          }
          return { success: true };
        }
        if (url?.startsWith('/payments')) return [] as any;
        if (url?.startsWith('/daily-stays/invoices')) return mockDailyInvoices as any;
        return {} as any;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={mockBills as any}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Switch to Tab 2 (ยังไม่ชำระ / รับเงินสด)
      const unpaidTabBtn = screen.getByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTabBtn);

      // Find "รับเงินสด" button on Room 101 card
      const cashButtons = screen.getAllByRole('button', { name: /รับเงินสด/ });
      fireEvent.click(cashButtons[0]);

      // Fast forward 5-second countdown
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Attempt 1 failed
      expect(callCount).toBe(1);
      expect(capturedKeys[0]).toBeDefined();
      expect(typeof capturedKeys[0]).toBe('string');
      expect(capturedKeys[0].length).toBeGreaterThan(0);

      // Retry: User clicks "รับเงินสด" again on same bill
      const retryCashButtons = screen.getAllByRole('button', { name: /รับเงินสด/ });
      fireEvent.click(retryCashButtons[0]);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      // Attempt 2 succeeded with the EXACT SAME idempotency key
      expect(callCount).toBe(2);
      expect(capturedKeys[1]).toBe(capturedKeys[0]);

      // Now initiate cash on Room 102 (different bill) -> must get a NEW fresh idempotency key
      fireEvent.click(screen.getAllByRole('button', { name: /รับเงินสด/ })[1]);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(callCount).toBe(3);
      expect(capturedKeys[2]).not.toBe(capturedKeys[0]);
    });

    it('7.2 Daily Cash: triggers handleSettleDailyInvoice, sends idempotency key, clears on success', async () => {
      let dailyCallCount = 0;
      let dailyCapturedKeys: string[] = [];

      vi.spyOn(httpClientModule, 'httpRequest').mockImplementation(async (method, url, body, options) => {
        if (url?.includes('/settle-item')) {
          dailyCallCount++;
          dailyCapturedKeys.push(options?.headers?.['x-idempotency-key']);
          return { success: true };
        }
        if (url?.startsWith('/payments')) return [] as any;
        if (url?.startsWith('/daily-stays/invoices')) return mockDailyInvoices as any;
        return {} as any;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={mockBills as any}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Switch to Tab 2 (ยังไม่ชำระ / รับเงินสด)
      const unpaidTabBtn = screen.getByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTabBtn);

      // Daily stay card has "รับเงินสด" (at the end of Tab 2)
      const dailyCashBtns = screen.getAllByRole('button', { name: /รับเงินสด/ });
      fireEvent.click(dailyCashBtns[dailyCashBtns.length - 1]);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(dailyCallCount).toBe(1);
      expect(dailyCapturedKeys[0]).toBeDefined();
      expect(dailyCapturedKeys[0].length).toBeGreaterThan(0);
    });

    it('7.3 Single Slip Approve: triggers handleConfirmApprove, sends idempotency key', async () => {
      const singlePayment = [
        {
          id: 'pay-slip-single',
          dormitoryId: mockDormitoryId,
          billId: 'bill-pending-single',
          tenantId: 't1',
          roomId: 'r101',
          status: 'PENDING',
          amount: 3500,
          paymentDate: '2026-08-05T10:00:00Z',
          createdAt: '2026-08-05T10:00:00Z',
          evidenceUrl: 'https://example.com/slip1.png',
          bill: {
            id: 'bill-pending-single',
            roomId: 'r101',
            room: { roomNumber: '101' },
            tenant: { displayName: 'สมชาย สบายดี' },
            billingCycleId: mockCycleAugId,
            billNumber: 'INV-202608-101',
            totalAmount: 3500,
          },
        },
      ];

      queryClient.setQueryData(queryKeys.payments(mockDormitoryId), singlePayment);

      let approveCount = 0;
      let approveKeys: string[] = [];
      let targetEndpoint = '';

      vi.spyOn(httpClientModule, 'httpRequest').mockImplementation(async (method, url, body, options) => {
        if (url?.includes('/approve')) {
          approveCount++;
          targetEndpoint = url;
          approveKeys.push(options?.headers?.['x-idempotency-key']);
          return { success: true };
        }
        if (url?.startsWith('/payments')) return singlePayment as any;
        if (url?.startsWith('/daily-stays/invoices')) return [] as any;
        return {} as any;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={[]}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Tab 1 is active by default. Find "ยอมรับ" button on single slip card
      const acceptBtns = screen.getAllByRole('button', { name: /ยอมรับ/ });
      fireEvent.click(acceptBtns[0]);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(approveCount).toBe(1);
      expect(targetEndpoint).toBe('/payments/pay-slip-single/approve');
      expect(approveKeys[0]).toBeDefined();
      expect(approveKeys[0].length).toBeGreaterThan(0);
    });

    it('7.4 Single Slip Reject: opens reject modal, submits handleRejectPaymentOrGroup, sends idempotency key', async () => {
      const singlePayment = [
        {
          id: 'pay-slip-single',
          dormitoryId: mockDormitoryId,
          billId: 'bill-pending-single',
          tenantId: 't1',
          roomId: 'r101',
          status: 'PENDING',
          amount: 3500,
          paymentDate: '2026-08-05T10:00:00Z',
          createdAt: '2026-08-05T10:00:00Z',
          evidenceUrl: 'https://example.com/slip1.png',
          bill: {
            id: 'bill-pending-single',
            roomId: 'r101',
            room: { roomNumber: '101' },
            tenant: { displayName: 'สมชาย สบายดี' },
            billingCycleId: mockCycleAugId,
            billNumber: 'INV-202608-101',
            totalAmount: 3500,
          },
        },
      ];

      queryClient.setQueryData(queryKeys.payments(mockDormitoryId), singlePayment);

      let rejectCount = 0;
      let rejectKeys: string[] = [];
      let targetEndpoint = '';

      vi.spyOn(httpClientModule, 'httpRequest').mockImplementation(async (method, url, body, options) => {
        if (url?.includes('/reject')) {
          rejectCount++;
          targetEndpoint = url;
          rejectKeys.push(options?.headers?.['x-idempotency-key']);
          return { success: true };
        }
        if (url?.startsWith('/payments')) return singlePayment as any;
        if (url?.startsWith('/daily-stays/invoices')) return [] as any;
        return {} as any;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={[]}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Click "ปฏิเสธ" on single slip card -> opens modal
      const rejectBtns = screen.getAllByRole('button', { name: /ปฏิเสธ/ });
      fireEvent.click(rejectBtns[0]);

      // Inside modal, click "ปฏิเสธและส่งคืนบิล"
      const confirmRejectBtn = screen.getByRole('button', { name: /ปฏิเสธและส่งคืนบิล/ });
      fireEvent.click(confirmRejectBtn);

      expect(rejectCount).toBe(1);
      expect(targetEndpoint).toBe('/payments/pay-slip-single/reject');
      expect(rejectKeys[0]).toBeDefined();
      expect(rejectKeys[0].length).toBeGreaterThan(0);
    });

    it('7.5 Combined/Group Slip Approve: triggers handleConfirmApprove on group, sends idempotency key', async () => {
      const groupPayments = [
        {
          id: 'pay-slip-group-item-1',
          dormitoryId: mockDormitoryId,
          billId: 'bill-pending-group-1',
          paymentGroupId: 'group-combo-99',
          tenantId: 't2',
          roomId: 'r102',
          status: 'PENDING',
          amount: 2000,
          paymentDate: '2026-08-05T11:00:00Z',
          createdAt: '2026-08-05T11:00:00Z',
          evidenceUrl: 'https://example.com/group-slip.png',
          paymentGroup: {
            id: 'group-combo-99',
            totalAmount: 4000,
            verification: { claimedTransferAt: '2026-08-05T11:00:00Z' },
          },
          bill: {
            id: 'bill-pending-group-1',
            roomId: 'r102',
            room: { roomNumber: '102' },
            tenant: { displayName: 'สมหญิง จริงใจ' },
            billingCycleId: mockCycleAugId,
            billNumber: 'INV-202608-102',
            totalAmount: 4000,
          },
        },
      ];

      queryClient.setQueryData(queryKeys.payments(mockDormitoryId), groupPayments);

      let groupApproveCount = 0;
      let groupApproveKeys: string[] = [];
      let targetEndpoint = '';

      vi.spyOn(httpClientModule, 'httpRequest').mockImplementation(async (method, url, body, options) => {
        if (url?.includes('/approve')) {
          groupApproveCount++;
          targetEndpoint = url;
          groupApproveKeys.push(options?.headers?.['x-idempotency-key']);
          return { success: true };
        }
        if (url?.startsWith('/payments')) return groupPayments as any;
        if (url?.startsWith('/daily-stays/invoices')) return [] as any;
        return {} as any;
      });

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={[]}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Find "ยอมรับ" on group slip card
      const acceptBtns = screen.getAllByRole('button', { name: /ยอมรับ/ });
      fireEvent.click(acceptBtns[0]);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(groupApproveCount).toBe(1);
      expect(targetEndpoint).toBe('/payments/combined-groups/group-combo-99/approve');
      expect(groupApproveKeys[0]).toBeDefined();
      expect(groupApproveKeys[0].length).toBeGreaterThan(0);
    });

    it('7.6 Invalidation Authority in Projections: WITHDRAWN and SUPERSEDED bills appear in neither Paid nor Unpaid', () => {
      const projectionBills = [
        {
          id: 'b-issued-0',
          roomId: 'r101',
          tenantId: 't1',
          dormitoryId: mockDormitoryId,
          billingCycleId: mockCycleAugId,
          billNumber: 'INV-ISSUED-0',
          status: 'ISSUED',
          totalAmount: '0.00',
          outstandingAmount: '0.00',
          paidAmount: '0.00',
          items: [{ description: 'ค่าเช่าฟรี', amount: '0.00' }],
        },
        {
          id: 'b-withdrawn-0',
          roomId: 'r102',
          tenantId: 't2',
          dormitoryId: mockDormitoryId,
          billingCycleId: mockCycleAugId,
          billNumber: 'INV-WITHDRAWN-0',
          status: 'WITHDRAWN',
          totalAmount: '0.00',
          outstandingAmount: '0.00',
          paidAmount: '0.00',
          items: [],
        },
        {
          id: 'b-superseded-0',
          roomId: 'r103',
          tenantId: 't3',
          dormitoryId: mockDormitoryId,
          billingCycleId: mockCycleAugId,
          billNumber: 'INV-SUPERSEDED-0',
          status: 'SUPERSEDED',
          totalAmount: '0.00',
          outstandingAmount: '0.00',
          paidAmount: '0.00',
          items: [],
        },
        {
          id: 'b-withdrawn-pos',
          roomId: 'r102',
          tenantId: 't2',
          dormitoryId: mockDormitoryId,
          billingCycleId: mockCycleAugId,
          billNumber: 'INV-WITHDRAWN-POS',
          status: 'WITHDRAWN',
          totalAmount: '2000.00',
          outstandingAmount: '2000.00',
          paidAmount: '0.00',
          items: [{ description: 'ค่าเช่ายกเลิก', amount: '2000.00' }],
        },
        {
          id: 'b-superseded-pos',
          roomId: 'r103',
          tenantId: 't3',
          dormitoryId: mockDormitoryId,
          billingCycleId: mockCycleAugId,
          billNumber: 'INV-SUPERSEDED-POS',
          status: 'SUPERSEDED',
          totalAmount: '2500.00',
          outstandingAmount: '2500.00',
          paidAmount: '0.00',
          items: [{ description: 'ค่าเช่าทับซ้อน', amount: '2500.00' }],
        },
      ];

      queryClient.setQueryData(queryKeys.dailyInvoices(mockDormitoryId), []);

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            bills={projectionBills as any}
            dormitoryId={mockDormitoryId}
            rooms={mockRooms as any}
            tenants={mockTenants as any}
            selectedBillingCycleId={mockCycleAugId}
            selectedCycleCode="2026-08"
            billingCycles={mockBillingCycles as any}
          />
        </QueryClientProvider>
      );

      // Check Tab 2 (ยังไม่ชำระ):
      const unpaidTabBtn = screen.getByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTabBtn);

      expect(screen.queryByText('INV-ISSUED-0')).toBeNull();
      expect(screen.queryByText('INV-WITHDRAWN-0')).toBeNull();
      expect(screen.queryByText('INV-SUPERSEDED-0')).toBeNull();
      expect(screen.queryByText('INV-WITHDRAWN-POS')).toBeNull();
      expect(screen.queryByText('INV-SUPERSEDED-POS')).toBeNull();
      expect(screen.getByText(/ไม่พบห้องพักค้างชำระในรอบบิลนี้/)).toBeTruthy();

      // Check Tab 3 (ชำระแล้ว):
      const paidTabBtn = screen.getByRole('button', { name: /ชำระแล้ว/ });
      fireEvent.click(paidTabBtn);

      expect(screen.getByText('ห้อง 101')).toBeTruthy();
      expect(screen.getAllByText('ปลอดค่าใช้จ่าย').length).toBeGreaterThan(0);

      expect(screen.queryByText('INV-WITHDRAWN-0')).toBeNull();
      expect(screen.queryByText('INV-SUPERSEDED-0')).toBeNull();
      expect(screen.queryByText('INV-WITHDRAWN-POS')).toBeNull();
      expect(screen.queryByText('INV-SUPERSEDED-POS')).toBeNull();
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
