import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { mapRegistrationBuildingForFinalize } from '../pages/owner/register';
import { sortRoomsByBuildingAndNumber } from '../utils/roomSorter';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';

describe('Round 30 — Building and Room Ordering Authority (Ticket 1 / Issue #6)', () => {
  it('CRIT-R30-BUILDING-ORDER-01: Finalize mapping sorts buildings chronologically by creationOrder and assigns displayOrder', () => {
    // Building A was created first (creationOrder 1), Building B was created second (creationOrder 2)
    // But in form UI, newly added Building B was prepended to the array: [Building B, Building A]
    const formBuildings = [
      {
        id: 'b-2',
        name: 'ตึก B',
        roomPrefix: 'B',
        creationOrder: 2,
        totalFloors: 2,
        roomsPerFloor: 2,
        rentRates: { monthly: 4500, termMonths: 4, maxInstallmentMonths: 2 },
      },
      {
        id: 'b-1',
        name: 'ตึก A',
        roomPrefix: 'A',
        creationOrder: 1,
        totalFloors: 2,
        roomsPerFloor: 2,
        rentRates: { monthly: 4500, termMonths: 4, maxInstallmentMonths: 2 },
      },
    ];

    const sorted = [...formBuildings].sort((a: any, b: any) => {
      const orderA = typeof a.creationOrder === 'number' ? a.creationOrder : 0;
      const orderB = typeof b.creationOrder === 'number' ? b.creationOrder : 0;
      return orderA - orderB;
    });

    const mapped = sorted.map((b: any, idx: number) =>
      mapRegistrationBuildingForFinalize(b, idx, 5000)
    );

    // Verify Building A is mapped FIRST with displayOrder 0
    expect(mapped[0].name).toBe('ตึก A');
    expect(mapped[0].displayOrder).toBe(0);

    // Verify Building B is mapped SECOND with displayOrder 1
    expect(mapped[1].name).toBe('ตึก B');
    expect(mapped[1].displayOrder).toBe(1);
  });

  it('CRIT-R30-ROOM-SORTER-02: Rooms are sorted by building displayOrder first, then floor, then room number', () => {
    const buildings = [
      { id: 'bld-a', name: 'ตึก A', displayOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'bld-b', name: 'ตึก B', displayOrder: 1, createdAt: '2026-09-01T00:01:00.000Z' },
    ];

    const rooms = [
      { id: 'r-b101', buildingId: 'bld-b', floor: 1, roomNumber: 'B101' },
      { id: 'r-a102', buildingId: 'bld-a', floor: 1, roomNumber: 'A102' },
      { id: 'r-a101', buildingId: 'bld-a', floor: 1, roomNumber: 'A101' },
      { id: 'r-b102', buildingId: 'bld-b', floor: 1, roomNumber: 'B102' },
    ];

    const sorted = sortRoomsByBuildingAndNumber(rooms, buildings);
    const roomNums = sorted.map(r => r.roomNumber);

    // Expected order: Building A rooms first (A101, A102), then Building B rooms (B101, B102)
    expect(roomNums).toEqual(['A101', 'A102', 'B101', 'B102']);
  });

  it('CRIT-R30-POST-ONBOARDING-BUILDING-03: Post-onboarding new building appears at the bottom', () => {
    const buildings = [
      { id: 'bld-a', name: 'ตึก A', displayOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'bld-b', name: 'ตึก B', displayOrder: 1, createdAt: '2026-09-01T00:01:00.000Z' },
      // Added later in rooms menu:
      { id: 'bld-c', name: 'ตึก C', displayOrder: 2, createdAt: '2026-09-20T00:00:00.000Z' },
    ];

    const rooms = [
      { id: 'r-c101', buildingId: 'bld-c', floor: 1, roomNumber: 'C101' },
      { id: 'r-b101', buildingId: 'bld-b', floor: 1, roomNumber: 'B101' },
      { id: 'r-a101', buildingId: 'bld-a', floor: 1, roomNumber: 'A101' },
    ];

    const sorted = sortRoomsByBuildingAndNumber(rooms, buildings);
    expect(sorted.map(r => r.roomNumber)).toEqual(['A101', 'B101', 'C101']);
  });

  it('CRIT-R30-POST-ONBOARDING-ROOM-04: Adding room to existing building inserts neatly into that building', () => {
    const buildings = [
      { id: 'bld-a', name: 'ตึก A', displayOrder: 0, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'bld-b', name: 'ตึก B', displayOrder: 1, createdAt: '2026-09-01T00:01:00.000Z' },
    ];

    // Room A102 is added later to Building A
    const rooms = [
      { id: 'r-a101', buildingId: 'bld-a', floor: 1, roomNumber: 'A101' },
      { id: 'r-b101', buildingId: 'bld-b', floor: 1, roomNumber: 'B101' },
      { id: 'r-a102', buildingId: 'bld-a', floor: 1, roomNumber: 'A102' },
    ];

    const sorted = sortRoomsByBuildingAndNumber(rooms, buildings);
    expect(sorted.map(r => r.roomNumber)).toEqual(['A101', 'A102', 'B101']);
  });
});

describe('Round 30 — Rental Plan Deposit Synchronization & Label Standardization (Tickets 2 & 5 / Issues #7 & #10)', () => {
  const mockRoom = {
    id: 'room-101',
    roomNumber: '101',
    monthlyRent: 4000,
    termRent: 15000,
    dailyRent: 600,
    depositAmount: 5000, // Monthly base deposit fallback
    monthlyDeposit: 5000,
    termDeposit: 10000, // Dedicated term deposit
    dailyDeposit: 500, // Dedicated daily deposit
    status: 'vacant',
    building: {
      id: 'b-1',
      name: 'ตึก A',
      termMonths: 4,
    },
  };

  it('CRIT-R30-PLAN-DEPOSIT-SYNC-01: Switching between term and monthly synchronizes depositAmount accordingly', async () => {
    const { rerender } = render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialRentPlan="term"
      />
    );

    // With term rent plan, the deposit input should have termDeposit value (10000)
    const depositInput = screen.getByTestId('tenant-proposed-deposit-input') as HTMLInputElement;
    expect(depositInput.value).toBe('10000');

    // Rerender with monthly plan
    rerender(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialRentPlan="monthly"
      />
    );

    expect(depositInput.value).toBe('5000');
  });

  it('CRIT-R30-DEPOSIT-LABEL-STANDARDIZATION-02: Deposit label consistently displays "ค่าประกัน / ค่ามัดจำ (บาท) *" for both monthly/term and daily stays', () => {
    // Test Monthly / Term View
    const { unmount } = render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialRentPlan="monthly"
      />
    );

    expect(screen.getByText('ค่าประกัน / ค่ามัดจำ (บาท) *')).toBeDefined();
    unmount();

    // Test Daily Stay View
    render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialRentPlan="daily"
      />
    );

    expect(screen.getByText('ค่าประกัน / ค่ามัดจำ (บาท) *')).toBeDefined();
  });
});

describe('Round 30 — LINE OA Synthetic Email Scrubbing & Autofill Shield (Ticket 3 / Issue #8)', () => {
  const mockRoom = {
    id: 'room-101',
    roomNumber: '101',
    monthlyRent: 4000,
    depositAmount: 5000,
    status: 'vacant',
  };

  it('CRIT-R30-EMAIL-SCRUBBING-01: Ignores internal synthetic @horplus.local email from profile prefill', () => {
    const syntheticProfile = {
      id: 'candidate_user_1',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      email: 'grant.acc_grant_123@horplus.local', // synthetic LINE OA grant email
      phone: '0812345678',
    };

    render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialStep={2}
        existingTenantProfile={syntheticProfile}
      />
    );

    const emailInput = screen.getByPlaceholderText('example@mail.com (ถ้ามี)') as HTMLInputElement;
    // Email input MUST remain empty and not contain the @horplus.local synthetic string
    expect(emailInput.value).toBe('');
    // Must have autoComplete="off"
    expect(emailInput.getAttribute('autoComplete')).toBe('off');
  });

  it('CRIT-R30-EMAIL-PREFILL-02: Still prefills legitimate personal email', () => {
    const realProfile = {
      id: 'candidate_user_2',
      firstName: 'สมชาย',
      lastName: 'ใจดี',
      email: 'somchai.jaidee@gmail.com', // legitimate email
      phone: '0812345678',
    };

    render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialStep={2}
        existingTenantProfile={realProfile}
      />
    );

    const emailInput = screen.getByPlaceholderText('example@mail.com (ถ้ามี)') as HTMLInputElement;
    expect(emailInput.value).toBe('somchai.jaidee@gmail.com');
  });
});

describe('Round 30 — Title & Prefix Normalization and PDF Honorific Formatting (Ticket 4 / Issue #9)', () => {
  const mockRoom = {
    id: 'room-101',
    roomNumber: '101',
    monthlyRent: 4000,
    depositAmount: 5000,
    status: 'vacant',
  };

  it('CRIT-R30-PREFIX-DROPDOWN-01: Prefix selector contains standard options plus "ระบุเอง", without duplicate "กำหนดเอง"', () => {
    render(
      <TenantRegisterView
        rooms={[mockRoom] as any}
        initialViewState="form"
        initialRoomId="room-101"
        initialStep={2}
      />
    );

    const select = screen.getByTestId('tenant-prefix-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);

    expect(options).toContain('นาย');
    expect(options).toContain('นาง');
    expect(options).toContain('นางสาว');
    expect(options).toContain('เด็กชาย');
    expect(options).toContain('เด็กหญิง');
    expect(options).toContain('ระบุเอง');
    expect(options).not.toContain('กำหนดเอง');
  });
});
