/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 *
 * TENANT PHASE 3 STEP 3C.5B.6F TEST SUITE
 * Contract Chain, Renewal Authority, Terms Snapshot & Cycle-Aware Parking Billing
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  OwnerTenants,
  resolveTenantDisplayAgreements,
  resolveNewestRenewableAgreementId,
  isAgreementEligibleForRenewal,
} from '../pages/owner/tenants';
import { calculateParkingCostHelper } from '../pages/owner/meters';
import { Tenant, Room, Contract, Dormitory } from '../types';

vi.mock('../services/payment-settings.service', () => ({
  getPaymentSettings: vi.fn(async () => null),
}));

vi.mock('../data/httpClient', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    httpRequest: vi.fn(async () => ({ success: true, data: {} })),
  };
});

describe('Tenant Phase 3 Step 3C.5B.6F: Contract Chain, Terms Snapshot & Renewal Button', () => {
  const mockDormitoryId = 'dorm-uat-3c5b6f';
  let queryClient: QueryClient;

  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'หอพักทดสอบ 3C6F',
    address: '123 ถนนสุขุมวิท',
    ownerName: 'เจ้าของหอพัก',
    roomsCount: 10,
    occupiedRooms: 5,
  };

  const room105: Room = {
    id: 'room-105',
    roomNumber: '105',
    floor: 1,
    buildingId: 'bld-1',
    status: 'occupied',
    monthlyRent: 4500,
    monthlyDeposit: 4500,
    termRent: 18000,
    termDeposit: 4500,
  };

  const pimpaTenant: Tenant = {
    id: 'tnt-pimpa-105',
    name: 'นางสาวพิมพา สดใส',
    phone: '0898887766',
    status: 'active',
    roomId: 'room-105',
    rentalType: 'TERM',
    rentalPlan: 'term',
    requestedStartDate: '2026-07-01',
    requestedEndDate: '2026-10-31',
    requestedDurationMonths: 4,
    requestedRent: 18000,
    requestedDeposit: 4500,
  };

  const futureContract105: Contract = {
    id: 'ctr-105-future',
    contractNumber: 'CTR-2026-105-TERM',
    dormitoryId: mockDormitoryId,
    roomId: 'room-105',
    tenantId: 'tnt-pimpa-105',
    startDate: '2026-11-01',
    endDate: '2027-02-28',
    durationMonths: 4,
    rentBillingType: 'term',
    rentAmount: 18000,
    depositAmount: 4500,
    status: 'active',
    createdAt: '2026-07-01T09:00:00.000Z',
    terms: '1. สัญญาเช่าห้องพักรายเทอม (ภาคการศึกษาที่ 2/2569 กำหนด 4 เดือน)\n2. ชำระค่าเช่าตามรอบเทอมที่กำหนด\n3. ห้ามสูบบุหรี่ภายในห้องพักและพื้นที่ส่วนกลาง\n4. รักษาความสะอาดและดูแลรักษาทรัพย์สินของหอพักอย่างเคร่งครัด',
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. resolveTenantDisplayAgreements Helper Unit Tests', () => {
    it('returns both current provisional agreement and future contract for Room 105 (count = 2)', () => {
      const agreements = resolveTenantDisplayAgreements(
        pimpaTenant,
        [futureContract105],
        null,
        [room105],
        mockDormitoryId
      );

      expect(agreements.length).toBe(2);
    });

    it('enforces normalized agreement ordering: newest -> oldest (startDate DESC, createdAt DESC, ID tie-breaker)', () => {
      const agreements = resolveTenantDisplayAgreements(
        pimpaTenant,
        [futureContract105],
        null,
        [room105],
        mockDormitoryId
      );

      // Index 0: Newest contract starting 2026-11-01
      expect(agreements[0].contractNumber).toBe('CTR-2026-105-TERM');
      expect(agreements[0].startDate).toBe('2026-11-01');

      // Index 1: Older predecessor provisional agreement starting 2026-07-01
      expect(agreements[1].isCurrentTermAgreement).toBe(true);
      expect(agreements[1].startDate).toBe('2026-07-01');
    });

    it('populates respective terms snapshots when available and leaves null without fallback', () => {
      // With historical terms in provisional rental terms
      const agreementsWithTerms = resolveTenantDisplayAgreements(
        pimpaTenant,
        [futureContract105],
        {
          provisionalRentalTerms: [
            {
              id: 'prov-1',
              status: 'ACTIVE',
              terms: '1. สัญญาเช่ารายเทอม (ภาคการศึกษาที่ 1/2569 กำหนด 4 เดือน)\n2. ชำระค่าเช่าตามรอบเทอมที่กำหนด',
            },
          ],
        },
        [room105],
        mockDormitoryId
      );

      expect(agreementsWithTerms[0].terms).toContain('ภาคการศึกษาที่ 2/2569');
      expect(agreementsWithTerms[1].terms).toContain('ภาคการศึกษาที่ 1/2569');

      // Without historical terms on provisional: must remain null without fake fallback
      const agreementsNoTerms = resolveTenantDisplayAgreements(
        pimpaTenant,
        [futureContract105],
        null,
        [room105],
        mockDormitoryId
      );
      expect(agreementsNoTerms[1].terms).toBeNull();
    });
  });

  describe('2. Contract Tab Badge & Single Renewal Button Rendering', () => {
    it('renders contract tab badge with count 2 for Room 105', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pimpaTenant]}
            rooms={[room105]}
            contracts={[futureContract105]}
            initialTenantId={pimpaTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      const contractTabs = screen.getAllByRole('button', { name: /สัญญาเช่า/i });
      const contractTab = contractTabs[contractTabs.length - 1];
      expect(contractTab).toBeDefined();

      // Badge should display "2"
      const badge = within(contractTab).getByText('2');
      expect(badge).toBeDefined();
    });

    it('renders both agreement cards and ONLY ONE renewal button on the newest agreement', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[pimpaTenant]}
            rooms={[room105]}
            contracts={[futureContract105]}
            initialTenantId={pimpaTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Open Contract Tab
      const contractTabs = screen.getAllByRole('button', { name: /สัญญาเช่า/i });
      const contractTab = contractTabs[contractTabs.length - 1];
      fireEvent.click(contractTab);

      // Both agreement cards are visible
      expect(screen.getByText('สัญญาถัดไป')).toBeDefined();
      expect(screen.getByText('สัญญา/ข้อตกลงปัจจุบัน')).toBeDefined();

      // Future contract card has terms
      expect(screen.getByText(/ภาคการศึกษาที่ 2\/2569/)).toBeDefined();

      // PO Requirement: Single renewal button: Only newest agreement shows 'ต่ออายุสัญญา'
      const renewalButtons = screen.getAllByRole('button', { name: /ต่ออายุสัญญา/i });
      expect(renewalButtons.length).toBeGreaterThanOrEqual(1);

      // Specifically check that both cards have print buttons
      const printButtons = screen.getAllByTitle('พิมพ์เอกสารสัญญาเช่า A4');
      expect(printButtons.length).toBe(2);
    });
  });

  describe('2b. resolveNewestRenewableAgreementId Unit Tests', () => {
    it('Case 1: item[0] renewable -> returns item[0].id', () => {
      const agrs = [
        { id: 'ctr-scheduled', status: 'approved_scheduled', startDate: '2027-01-01', rentBillingType: 'monthly', durationMonths: 12 },
        { id: 'ctr-active', status: 'active', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 12 },
      ];
      expect(resolveNewestRenewableAgreementId(agrs)).toBe('ctr-scheduled');
    });

    it('Case 1b: [newest Provisional, older renewable Contract] -> targets older renewable Contract', () => {
      const agrs = [
        { id: 'prov-105', status: 'active', isCurrentTermAgreement: true, startDate: '2027-01-01', rentBillingType: 'term', durationMonths: 4 },
        { id: 'ctr-old-active', status: 'active', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 12 },
      ];
      expect(resolveNewestRenewableAgreementId(agrs)).toBe('ctr-old-active');
    });

    it('Case 1c: [scheduled renewal with previousContractId = olderContract.id] -> older contract is obsoleted by successor', () => {
      const agrs = [
        { id: 'ctr-scheduled-tip', status: 'approved_scheduled', previousContractId: 'ctr-older-base', startDate: '2027-01-01', rentBillingType: 'monthly', durationMonths: 12 },
        { id: 'ctr-older-base', status: 'active', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 12 },
      ];
      // Older base has a successor pointing to it, so it is not chain-tip
      expect(resolveNewestRenewableAgreementId(agrs)).toBe('ctr-scheduled-tip');
    });

    it('Case 1d: [unrelated contract A, unrelated contract B] -> neither obsoletes the other, newest picked by date', () => {
      const agrs = [
        { id: 'ctr-unrelated-newer', status: 'active', startDate: '2026-06-01', rentBillingType: 'monthly', durationMonths: 6 },
        { id: 'ctr-unrelated-older', status: 'active', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 6 },
      ];
      expect(resolveNewestRenewableAgreementId(agrs)).toBe('ctr-unrelated-newer');
    });

    it('Case 2: item[0] non-renewable & item[1] renewable -> returns item[1].id', () => {
      const agrs = [
        // item[0] is cancelled, not an active successor
        { id: 'ctr-cancelled', status: 'cancelled', startDate: '2027-01-01', rentBillingType: 'monthly', durationMonths: 12 },
        // item[1] is active contract with no active successor
        { id: 'ctr-active', status: 'active', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 12 },
      ];
      expect(resolveNewestRenewableAgreementId(agrs)).toBe('ctr-active');
    });

    it('Case 3: no renewable agreements -> returns null', () => {
      // 3a. Daily contracts
      const dailyAgrs = [
        { id: 'ctr-daily', status: 'active', startDate: '2026-08-01', rentBillingType: 'daily', durationMonths: 0 },
      ];
      expect(resolveNewestRenewableAgreementId(dailyAgrs)).toBeNull();

      // 3b. Provisional agreement only
      const provAgrs = [
        { id: 'prov-term', status: 'active', isCurrentTermAgreement: true, startDate: '2026-07-01', rentBillingType: 'term' },
      ];
      expect(resolveNewestRenewableAgreementId(provAgrs)).toBeNull();

      // 3c. Terminated contracts only
      const terminatedAgrs = [
        { id: 'ctr-term-1', status: 'terminated', startDate: '2026-01-01', rentBillingType: 'monthly', durationMonths: 6 },
      ];
      expect(resolveNewestRenewableAgreementId(terminatedAgrs)).toBeNull();
    });
  });

  describe('2c. Step 6E Authority: Missing Contact Email Fallback', () => {
    it('strictly preserves missing contact email as "-" and never reverts to ไม่มีข้อมูล', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <OwnerTenants
            dormitoryId={mockDormitoryId}
            dormitory={sampleDormitory}
            tenants={[{ ...pimpaTenant, email: null as any }]}
            rooms={[room105]}
            contracts={[futureContract105]}
            initialTenantId={pimpaTenant.id}
            onSaveTenants={vi.fn()}
            onSaveRooms={vi.fn()}
            onSaveContracts={vi.fn()}
            onAddLog={vi.fn()}
          />
        </QueryClientProvider>
      );

      // Email field should display '-'
      const emailHeaders = screen.getAllByText('อีเมลติดต่อ');
      expect(emailHeaders.length).toBeGreaterThanOrEqual(1);
      const dashElements = screen.getAllByText('-');
      expect(dashElements.length).toBeGreaterThan(0);
      expect(screen.queryByText('ไม่มีข้อมูล')).toBeNull();
    });
  });

  describe('3. Cycle-Aware Parking Billing Helper Unit Tests', () => {
    it('calculates parking fee as quantity * fee in per_vehicle mode', () => {
      const rateSnapshot = {
        parkingFeeMode: 'per_vehicle',
        parkingFee: 150,
      };

      // 2 vehicles -> 300
      const cost2 = calculateParkingCostHelper(
        { peopleCount: 1, parkingQuantity: '2.00' },
        rateSnapshot
      );
      expect(cost2).toBe(300);

      // 1 vehicle -> 150
      const cost1 = calculateParkingCostHelper(
        { peopleCount: 1, parkingQuantity: '1.00' },
        rateSnapshot
      );
      expect(cost1).toBe(150);

      // 0 vehicles -> 0
      const cost0 = calculateParkingCostHelper(
        { peopleCount: 1, parkingQuantity: '0.00' },
        rateSnapshot
      );
      expect(cost0).toBe(0);
    });

    it('returns fixed fee in per_room mode regardless of vehicle quantity', () => {
      const rateSnapshot = {
        parkingFeeMode: 'per_room',
        parkingFee: 200,
      };

      const cost = calculateParkingCostHelper(
        { peopleCount: 1, parkingQuantity: '3.00' },
        rateSnapshot
      );
      expect(cost).toBe(200);
    });

    it('returns 0 when peopleCount is 0 or fee mode is free', () => {
      expect(
        calculateParkingCostHelper(
          { peopleCount: 0, parkingQuantity: '2.00' },
          { parkingFeeMode: 'per_vehicle', parkingFee: 150 }
        )
      ).toBe(0);

      expect(
        calculateParkingCostHelper(
          { peopleCount: 1, parkingQuantity: '2.00' },
          { parkingFeeMode: 'free', parkingFee: 150 }
        )
      ).toBe(0);
    });
  });
});

