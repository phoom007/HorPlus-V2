// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OwnerMeters } from '../pages/owner/meters';
import { meterDraftStore } from '../lib/meterDraftStore';
import { queryKeys } from '../lib/queryClient';
import {
  isMeterBasedUtilityMode,
  calculateMeterRowPreview,
  calculateProgressiveTieredChargeLocal,
  validateCanonicalUtilityTiersLocal,
  RateSnapshotContext,
} from '../utils/meterBillingCalculator';
import { Room, Tenant, Contract } from '../types';

describe('OWNER R3.9-E.1A — Tiered Meter Workspace Suite', () => {
  // =========================================================================
  // 1. MODE CLASSIFICATION TESTS (Section 29)
  // =========================================================================
  describe('Mode Classification: isMeterBasedUtilityMode', () => {
    it('returns true for meter-based modes (per_unit, unit, tiered)', () => {
      expect(isMeterBasedUtilityMode('per_unit')).toBe(true);
      expect(isMeterBasedUtilityMode('unit')).toBe(true);
      expect(isMeterBasedUtilityMode('tiered')).toBe(true);
      expect(isMeterBasedUtilityMode('TIERED')).toBe(true);
      expect(isMeterBasedUtilityMode(' per_unit ')).toBe(true);
    });

    it('returns false for non-meter modes', () => {
      expect(isMeterBasedUtilityMode('per_person')).toBe(false);
      expect(isMeterBasedUtilityMode('person')).toBe(false);
      expect(isMeterBasedUtilityMode('fixed')).toBe(false);
      expect(isMeterBasedUtilityMode('flat_rate')).toBe(false);
      expect(isMeterBasedUtilityMode('room')).toBe(false);
      expect(isMeterBasedUtilityMode('per_room')).toBe(false);
      expect(isMeterBasedUtilityMode('free')).toBe(false);
      expect(isMeterBasedUtilityMode('none')).toBe(false);
      expect(isMeterBasedUtilityMode('')).toBe(false);
      expect(isMeterBasedUtilityMode(null)).toBe(false);
      expect(isMeterBasedUtilityMode(undefined)).toBe(false);
    });
  });

  // =========================================================================
  // 2. INTEGER DOMAIN & TIER VALIDATOR TESTS (Sections 1-7)
  // =========================================================================
  describe('Tier Validator & Integer Domain Authority', () => {
    it('Rejects fractional tier upTo boundaries (10.5, 10.50, 20.25)', () => {
      const frac1 = validateCanonicalUtilityTiersLocal([
        { upTo: '10.5', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(frac1.isValid).toBe(false);
      expect(frac1.errorMessage).toContain('INVALID_TIER_CONFIGURATION');

      const frac2 = validateCanonicalUtilityTiersLocal([
        { upTo: '10.50', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(frac2.isValid).toBe(false);
      expect(frac2.errorMessage).toContain('INVALID_TIER_CONFIGURATION');

      const frac3 = validateCanonicalUtilityTiersLocal([
        { upTo: '20.25', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(frac3.isValid).toBe(false);
      expect(frac3.errorMessage).toContain('INVALID_TIER_CONFIGURATION');
    });

    it('Accepts valid integer upTo representations and normalizes to 2DP ("10", "10.0", "10.00", "20.00", "150.00")', () => {
      const res = validateCanonicalUtilityTiersLocal([
        { upTo: '10', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: '150.0', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ]);
      expect(res.isValid).toBe(true);
      expect(res.tiers[0].upTo).toBe('10.00');
      expect(res.tiers[1].upTo).toBe('20.00');
      expect(res.tiers[2].upTo).toBe('150.00');
      expect(res.tiers[3].upTo).toBeNull();
    });

    it('Rejects non-positive or non-ascending upTo boundaries ("0", "-1")', () => {
      const zeroBound = validateCanonicalUtilityTiersLocal([
        { upTo: '0', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(zeroBound.isValid).toBe(false);

      const negBound = validateCanonicalUtilityTiersLocal([
        { upTo: '-10', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(negBound.isValid).toBe(false);
    });

    it('Progressive helper fails closed on fractional usage ("15.1", "15.99", 15.5, -1, "1e2")', () => {
      const tiers = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ];

      expect(calculateProgressiveTieredChargeLocal({ usageUnits: '15.1', tiers }).isValid).toBe(false);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: '15.99', tiers }).isValid).toBe(false);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: 15.5, tiers }).isValid).toBe(false);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: -1, tiers }).isValid).toBe(false);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: '1e2', tiers }).isValid).toBe(false);
    });

    it('Progressive helper accepts whole integer usage (0, 15, "15", "15.00", 130n)', () => {
      const tiers = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ];

      expect(calculateProgressiveTieredChargeLocal({ usageUnits: 0, tiers }).isValid).toBe(true);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: 15, tiers }).isValid).toBe(true);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: '15', tiers }).isValid).toBe(true);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: '15.00', tiers }).isValid).toBe(true);
      expect(calculateProgressiveTieredChargeLocal({ usageUnits: 130n, tiers }).isValid).toBe(true);
    });
  });

  // =========================================================================
  // 3. PROGRESSIVE CALCULATOR & LOCAL LIVE PREVIEW TESTS
  // =========================================================================
  describe('Progressive Tiered Calculator & Live Preview Parity', () => {
    const waterTiers = [
      { upTo: '10', rate: '3.40' },
      { upTo: '20', rate: '4.25' },
      { upTo: null, rate: '5.00' },
    ];

    const electricityTiers = [
      { upTo: '50', rate: '7.00' },
      { upTo: '150', rate: '8.00' },
      { upTo: null, rate: '9.00' },
    ];

    it('Water: 100 -> 115 = usage 15 = 55.25 THB (10@3.40 + 5@4.25)', () => {
      const prog = calculateProgressiveTieredChargeLocal({
        usageUnits: 15,
        tiers: waterTiers,
      });

      expect(prog.isValid).toBe(true);
      expect(prog.totalAmount).toBe('55.25');
      expect(prog.usageUnits).toBe('15.00');
      expect(prog.tierBreakdown).toEqual([
        {
          lowerExclusive: '0.00',
          upperInclusive: '10.00',
          billedUnits: '10.00',
          rate: '3.40',
          amount: '34.00',
        },
        {
          lowerExclusive: '10.00',
          upperInclusive: '20.00',
          billedUnits: '5.00',
          rate: '4.25',
          amount: '21.25',
        },
      ]);
    });

    it('Electricity: 200 -> 330 = usage 130 = 990.00 THB (50@7.00 + 80@8.00) — NOT 1030.00', () => {
      const prog = calculateProgressiveTieredChargeLocal({
        usageUnits: 130,
        tiers: electricityTiers,
      });

      expect(prog.isValid).toBe(true);
      expect(prog.totalAmount).toBe('990.00');
      expect(prog.usageUnits).toBe('130.00');
      expect(prog.tierBreakdown).toEqual([
        {
          lowerExclusive: '0.00',
          upperInclusive: '50.00',
          billedUnits: '50.00',
          rate: '7.00',
          amount: '350.00',
        },
        {
          lowerExclusive: '50.00',
          upperInclusive: '150.00',
          billedUnits: '80.00',
          rate: '8.00',
          amount: '640.00',
        },
      ]);
    });

    it('Zero usage: 100 -> 100 = usage 0 = 0.00 THB', () => {
      const prog = calculateProgressiveTieredChargeLocal({
        usageUnits: 0,
        tiers: waterTiers,
      });

      expect(prog.isValid).toBe(true);
      expect(prog.totalAmount).toBe('0.00');
      expect(prog.tierBreakdown).toEqual([]);
    });

    it('calculateMeterRowPreview: Missing previous reading returns NOT_READY', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: waterTiers,
        electricityBillingType: 'tiered',
        electricityTierRates: electricityTiers,
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '',
        waterCurr: '115',
        elecPrev: '200',
        elecCurr: '330',
      });

      expect(preview.waterStatus).toBe('NOT_READY');
      expect(preview.waterAmount).toBe('0.00');
      expect(preview.isReady).toBe(false);
    });

    it('calculateMeterRowPreview: Missing current reading returns NOT_READY', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: waterTiers,
        electricityBillingType: 'tiered',
        electricityTierRates: electricityTiers,
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '100',
        waterCurr: '115',
        elecPrev: '200',
        elecCurr: '',
      });

      expect(preview.elecStatus).toBe('NOT_READY');
      expect(preview.elecAmount).toBe('0.00');
      expect(preview.isReady).toBe(false);
    });

    it('calculateMeterRowPreview: Missing/Null tiers returns INVALID (no scalar fallback)', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: null,
        waterRate: '18.00',
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '100',
        waterCurr: '115',
      });

      expect(preview.waterStatus).toBe('INVALID');
      expect(preview.waterAmount).toBe('INVALID');
      expect(preview.isValid).toBe(false);
    });

    it('calculateMeterRowPreview: Invalid tiers structure returns INVALID', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: [
          { upTo: '20', rate: '3.00' },
          { upTo: '10', rate: '4.00' },
          { upTo: null, rate: '5.00' },
        ],
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '100',
        waterCurr: '115',
      });

      expect(preview.waterStatus).toBe('INVALID');
      expect(preview.isValid).toBe(false);
    });

    it('5-digit Rollover with Tiered: 99995 -> 10 = usage 15 = 55.25 THB', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: waterTiers,
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '99995',
        waterCurr: '10',
      });

      expect(preview.waterStatus).toBe('VALID');
      expect(preview.waterUsage).toBe('15.00');
      expect(preview.waterAmount).toBe('55.25');
    });

    it('4-digit Rollover with Tiered: 9990 -> 5 = usage 15 = 55.25 THB', () => {
      const rates: RateSnapshotContext = {
        waterBillingType: 'tiered',
        waterTierRates: waterTiers,
      };

      const preview = calculateMeterRowPreview(undefined, rates, {
        waterPrev: '9990',
        waterCurr: '5',
      });

      expect(preview.waterStatus).toBe('VALID');
      expect(preview.waterUsage).toBe('15.00');
      expect(preview.waterAmount).toBe('55.25');
    });
  });

  // =========================================================================
  // 4. TABLE & LIST MODE WORKSPACE INTEGRATION TESTS (Sections 15-20, 27-28)
  // =========================================================================
  describe('Owner Meter Workspace: Table & List Integration', () => {
    let queryClient: QueryClient;

    const mockRooms: Room[] = [
      {
        id: 'room-101',
        roomNumber: '101',
        buildingId: 'bldg-1',
        floor: 1,
        status: 'occupied',
        monthlyRent: 4000,
        rentCycle: 'monthly',
        depositAmount: 8000,
        maxOccupants: 2,
        initialWaterMeter: 0,
        initialElectricMeter: 0,
        images: [],
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      },
    ];

    const mockTenants: Tenant[] = [
      {
        id: 'tenant-101',
        name: 'นายสมชาย ใจดี',
        phone: '0812345678',
        email: 'somchai@test.com',
        citizenId: '1234567890123',
        coOccupants: [],
        emergencyContact: { name: 'แม่', relationship: 'มารดา', phone: '0899999999' },
        vehicle: { type: 'none', licensePlate: '' },
        pet: { hasPet: false },
        rentalHistory: [],
        status: 'active',
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      },
    ];

    const mockContracts: Contract[] = [
      {
        id: 'contract-101',
        contractNumber: 'CTR-202608-101',
        tenantId: 'tenant-101',
        roomId: 'room-101',
        startDate: '2026-08-01',
        endDate: '2027-07-31',
        durationMonths: 12,
        rentAmount: 4000,
        depositAmount: 8000,
        terms: 'มาตรฐาน',
        status: 'active',
        createdAt: '2026-08-01',
        updatedAt: '2026-08-01',
      },
    ];

    const sampleCycles = [
      {
        id: 'cycle-aug-2026',
        cycleCode: '2026-08',
        name: 'รอบบิล สิงหาคม 2569',
        status: 'draft' as const,
        isCurrent: true,
        isFirstCycle: true,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        billingDate: '2026-08-25',
        dueDate: '2026-09-05',
      },
    ];

    const tieredRateSnapshot = {
      waterBillingType: 'tiered',
      waterRate: '0.00',
      waterTierRates: [
        { upTo: '10', rate: '3.40' },
        { upTo: '20', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ],
      electricityBillingType: 'tiered',
      electricityRate: '0.00',
      electricityTierRates: [
        { upTo: '50', rate: '7.00' },
        { upTo: '150', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ],
      commonFee: '0.00',
      commonFeeMode: 'free',
      internetFee: '0.00',
      internetFeeMode: 'free',
      parkingFee: '0.00',
      parkingFeeMode: 'free',
    };

    const renderWorkspace = (customSnapshot?: any, serverReadings: any[] = [], customRoomCtx?: any) => {
      const dormId = 'dorm-1';
      const cycleId = 'cycle-aug-2026';

      queryClient.setQueryData(queryKeys.billingCycles(dormId), sampleCycles);
      queryClient.setQueryData(queryKeys.meterWorkspace(dormId, cycleId), {
        serverReadings,
        cyclePeopleRes: { success: true, data: [] },
      });
      queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, cycleId), {
        rateSnapshot: customSnapshot || tieredRateSnapshot,
        rooms: [
          customRoomCtx || {
            roomId: 'room-101',
            tenantId: 'tenant-101',
            tenantName: 'นายสมชาย ใจดี',
            billingSource: 'CONTRACT',
            rentAmount: '4000.00',
            currentHouseholdPeopleCount: 1,
            snapshotPeopleCount: 1,
            snapshotVersion: 1,
            isDailyUnpaid: false,
            isFutureReservation: false,
            amountDue: '0.00',
            chargeComponents: [
              {
                type: 'monthly_utility',
                label: 'บิลรายเดือน',
                amount: '0.00',
                status: 'PREVIEW',
                lineItems: [],
              },
            ],
          },
        ],
      });

      return render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            rooms={mockRooms}
            buildings={[{ id: 'bldg-1', dormitoryId: 'dorm-1', name: 'อาคาร 1', totalFloors: 2, roomsPerFloor: 2, createdAt: '2026-08-01' }]}
            tenants={mockTenants}
            contracts={mockContracts}
            dormitoryId="dorm-1"
            selectedBillingCycleId="cycle-aug-2026"
            selectedCycleCode="2026-08"
            selectedCycle="2026-08"
            billingCycles={sampleCycles}
            onSaveBills={vi.fn()}
          />
        </QueryClientProvider>
      );
    };

    beforeEach(() => {
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      });
      try {
        localStorage.clear();
        localStorage.setItem('owner_meter_view_mode', 'table');
      } catch { }
      meterDraftStore.clearAllDrafts();
    });

    afterEach(() => {
      cleanup();
      try {
        localStorage.clear();
        localStorage.setItem('owner_meter_view_mode', 'table');
      } catch { }
      meterDraftStore.clearAllDrafts();
    });

    it('Section 15-17: Table renders blank meter inputs, typing Water 100->115 and Elec 200->330 IMMEDIATELY updates visible amount to 1,045.25 ฿ before Save', async () => {
      renderWorkspace();

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      const elecPrev = document.querySelector('input[data-col="elecPrev"]') as HTMLInputElement;
      const elecCurr = document.querySelector('input[data-col="elecCurr"]') as HTMLInputElement;
      const waterPrev = document.querySelector('input[data-col="waterPrev"]') as HTMLInputElement;
      const waterCurr = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;

      fireEvent.change(elecPrev, { target: { value: '200' } });
      fireEvent.change(elecCurr, { target: { value: '330' } });
      fireEvent.change(waterPrev, { target: { value: '100' } });
      fireEvent.change(waterCurr, { target: { value: '115' } });

      // Live visible total must reflect 55.25 + 990.00 = 1,045.25 ฿
      await waitFor(() => {
        expect(screen.getByText('1,045.25 ฿')).toBeInTheDocument();
      });
    });

    it('Section 18 & 19: List Mode dirty-after-save regression: Server preview 55.25 is overridden by unsaved 100->120 (76.50), then restored on revert', async () => {
      const serverReadings = [
        { id: 'm1', billingCycleId: 'cycle-aug-2026', roomId: 'room-101', meterType: 'water', previousReading: '100', currentReading: '115' },
      ];
      const customRoomCtx = {
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenantName: 'นายสมชาย ใจดี',
        billingSource: 'CONTRACT',
        rentAmount: '4000.00',
        amountDue: '55.25',
        chargeComponents: [
          {
            type: 'monthly_utility',
            label: 'บิลรายเดือน',
            amount: '55.25',
            status: 'PREVIEW',
            lineItems: [
              { type: 'water', description: 'ค่าน้ำประปา', amount: '55.25' },
            ],
          },
        ],
      };

      renderWorkspace(tieredRateSnapshot, serverReadings, customRoomCtx);

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      // Switch to List Mode
      const listModeBtn = screen.getByTestId('view-mode-list-button');
      fireEvent.click(listModeBtn);

      await waitFor(() => {
        expect(screen.getByTestId('meter-list-card-room-101')).toBeInTheDocument();
      });

      // Initially shows clean server preview 55.25
      expect(screen.getAllByText(/55\.25/).length).toBeGreaterThan(0);
      expect(screen.getByText('55.25 ฿')).toBeInTheDocument();

      // Edit water current to 120 (usage 20: 10*3.40 + 10*4.25 = 76.50) without Save
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      fireEvent.change(waterCurrInput, { target: { value: '120' } });

      // List mode card must now show 76.50 instead of stale 55.25
      await waitFor(() => {
        expect(screen.getAllByText(/76\.50/).length).toBeGreaterThan(0);
        expect(screen.getByText('76.50 ฿')).toBeInTheDocument();
      });

      // Revert back to 115
      fireEvent.change(waterCurrInput, { target: { value: '115' } });

      // List mode card must return to server preview 55.25
      await waitFor(() => {
        expect(screen.getAllByText(/55\.25/).length).toBeGreaterThan(0);
        expect(screen.getByText('55.25 ฿')).toBeInTheDocument();
      });
    });

    it('Section 20: Table Mode dirty-after-save regression: Server preview 55.25 overridden by unsaved 100->120 (76.50), restored on revert', async () => {
      const serverReadings = [
        { id: 'm1', billingCycleId: 'cycle-aug-2026', roomId: 'room-101', meterType: 'water', previousReading: '100', currentReading: '115' },
      ];
      const customRoomCtx = {
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenantName: 'นายสมชาย ใจดี',
        billingSource: 'CONTRACT',
        rentAmount: '4000.00',
        amountDue: '55.25',
        chargeComponents: [
          {
            type: 'monthly_utility',
            label: 'บิลรายเดือน',
            amount: '55.25',
            status: 'PREVIEW',
            lineItems: [
              { type: 'water', description: 'ค่าน้ำประปา', amount: '55.25' },
            ],
          },
        ],
      };

      renderWorkspace(tieredRateSnapshot, serverReadings, customRoomCtx);

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      // Initially shows server preview 55.25 ฿
      expect(screen.getByText('55.25 ฿')).toBeInTheDocument();

      // Edit water current to 120
      const waterCurrInput = document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement;
      fireEvent.change(waterCurrInput, { target: { value: '120' } });

      // Table visible total updates to 76.50 ฿
      await waitFor(() => {
        expect(screen.getByText('76.50 ฿')).toBeInTheDocument();
      });

      // Revert back to 115
      fireEvent.change(waterCurrInput, { target: { value: '115' } });

      // Table visible total reverts to 55.25 ฿
      await waitFor(() => {
        expect(screen.getByText('55.25 ฿')).toBeInTheDocument();
      });
    });

    it('Section 10: Issued / Paid Bill is NOT overridden by transient local preview', async () => {
      const customRoomCtx = {
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenantName: 'นายสมชาย ใจดี',
        billingSource: 'CONTRACT',
        rentAmount: '4000.00',
        monthlyUtilityBillStatus: 'paid',
        isPaid: true,
        amountDue: '0.00',
        chargeComponents: [
          {
            type: 'monthly_utility',
            label: 'บิลรายเดือน',
            amount: '55.25',
            status: 'PAID',
            lineItems: [
              { type: 'water', description: 'ค่าน้ำประปา', amount: '55.25' },
            ],
          },
        ],
      };

      renderWorkspace(tieredRateSnapshot, [], customRoomCtx);

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      // Table shows 0.00 ฿ because bill is PAID
      expect(screen.getByText('0.00 ฿')).toBeInTheDocument();
    });

    it('Section 34: Paste grid into Tiered meter fields updates state properly', async () => {
      renderWorkspace();

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      const elecPrev = document.querySelector('input[data-col="elecPrev"]') as HTMLInputElement;
      expect(elecPrev).toBeInTheDocument();

      // Simulate pasting "200\t330\t100\t115"
      const pasteEvent = {
        clipboardData: {
          getData: () => '200\t330\t100\t115',
        },
        preventDefault: vi.fn(),
      };

      fireEvent.paste(elecPrev, pasteEvent);

      await waitFor(() => {
        expect((document.querySelector('input[data-col="elecPrev"]') as HTMLInputElement).value).toBe('200');
        expect((document.querySelector('input[data-col="elecCurr"]') as HTMLInputElement).value).toBe('330');
        expect((document.querySelector('input[data-col="waterPrev"]') as HTMLInputElement).value).toBe('100');
        expect((document.querySelector('input[data-col="waterCurr"]') as HTMLInputElement).value).toBe('115');
      });
    });

    it('Section 28: Non-meter modes (per_person / fixed) do NOT render meter input columns', async () => {
      const fixedRateSnapshot = {
        waterBillingType: 'fixed',
        waterRate: '150.00',
        electricityBillingType: 'per_person',
        electricityRate: '200.00',
        commonFee: '0.00',
        commonFeeMode: 'free',
      };

      renderWorkspace(fixedRateSnapshot);

      await waitFor(() => {
        expect(screen.getByTestId('meter-row-room-101')).toBeInTheDocument();
      });

      expect(screen.queryByText('มิเตอร์ไฟเดิม')).not.toBeInTheDocument();
      expect(screen.queryByText('มิเตอร์ไฟใหม่')).not.toBeInTheDocument();
      expect(screen.queryByText('มิเตอร์น้ำเดิม')).not.toBeInTheDocument();
      expect(screen.queryByText('มิเตอร์น้ำใหม่')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 5. LOCAL CONTRACT CALCULATION VECTORS
  // =========================================================================
  describe('Local Progressive Tiered Calculation Vectors', () => {
    it('exact mathematical match for Tiered calculations matching server vectors', () => {
      const waterTiers = [
        { upTo: '10', rate: '3.40' },
        { upTo: '20', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];

      const electricityTiers = [
        { upTo: '50', rate: '7.00' },
        { upTo: '150', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ];

      // Water: 15 units = 55.25
      const waterRes = calculateProgressiveTieredChargeLocal({
        usageUnits: 15,
        tiers: waterTiers,
      });
      expect(waterRes.totalAmount).toBe('55.25');

      // Electricity: 130 units = 990.00
      const elecRes = calculateProgressiveTieredChargeLocal({
        usageUnits: 130,
        tiers: electricityTiers,
      });
      expect(elecRes.totalAmount).toBe('990.00');

      // Zero usage
      const zeroRes = calculateProgressiveTieredChargeLocal({
        usageUnits: 0,
        tiers: electricityTiers,
      });
      expect(zeroRes.totalAmount).toBe('0.00');
    });
  });
});
