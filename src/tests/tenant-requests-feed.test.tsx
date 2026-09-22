/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient';
import { OwnerTenants } from '../pages/owner/tenants';
import { Tenant, Room, Contract, Dormitory, Building } from '../types';

vi.mock('../utils/imageUtils', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    convertImageToWebP: vi.fn(async () => 'data:image/webp;base64,mockwebp'),
  };
});

describe('Tenant Requests Section: "คำขอจากผู้เช่า" (Horizontal Feed & Category Filters)', () => {
  const mockDormitoryId = 'dorm-requests-test';
  let queryClient: QueryClient;

  const sampleDormitory: Dormitory = {
    id: mockDormitoryId,
    name: 'TheRiCH Apartment',
    address: '123 สุขุมวิท',
    phone: '0812345678',
    billStyle: 'combined',
    billingDay: 25,
    dueDay: 5,
    lateFeeDaily: 100,
    waterUnitRate: 18,
    electricUnitRate: 8,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as any;

  const sampleBuildings: Building[] = [
    { id: 'bld-1', dormitoryId: mockDormitoryId, name: 'อาคาร A', floorCount: 4, termMonths: 4 } as any,
  ];

  const sampleRooms: Room[] = [
    {
      id: 'room-101',
      dormitoryId: mockDormitoryId,
      buildingId: 'bld-1',
      roomNumber: 'A-101',
      floor: 1,
      monthlyRent: 4500,
      termRent: 17500,
      status: 'occupied',
      currentTenantId: 't-active-1',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    {
      id: 'room-102',
      dormitoryId: mockDormitoryId,
      buildingId: 'bld-1',
      roomNumber: 'A-102',
      floor: 1,
      monthlyRent: 4000,
      termRent: 16000,
      status: 'vacant',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
  ];

  const sampleContracts: Contract[] = [
    {
      id: 'cnt-moveout',
      contractNumber: 'CTR-MO-01',
      roomId: 'room-101',
      tenantId: 't-moveout',
      status: 'checking_out',
      startDate: '2026-01-01',
      endDate: '2026-10-31',
      durationMonths: 10,
      rentAmount: 4500,
      depositAmount: 5000,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    {
      id: 'cnt-extension',
      contractNumber: 'CTR-EXT-01',
      roomId: 'room-101',
      tenantId: 't-extension',
      status: 'waiting_extension',
      startDate: '2026-01-01',
      endDate: '2026-10-31',
      durationMonths: 6,
      rentAmount: 4500,
      depositAmount: 5000,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    {
      id: 'cnt-expired',
      contractNumber: 'CTR-EXP-01',
      roomId: 'room-101',
      tenantId: 't-expired',
      status: 'expired',
      startDate: '2025-01-01',
      endDate: '2026-01-01',
      durationMonths: 12,
      rentAmount: 4500,
      depositAmount: 5000,
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
  ];

  const sampleTenants: Tenant[] = [
    // 1. Pending Registration Applicant
    {
      id: 't-pending-reg',
      name: 'นาย ภพสดนพนน',
      phone: '0865989895',
      status: 'pending',
      requestedRoomId: 'room-102',
      requestedRent: 0,
      requestedStartDate: '2026-10-01',
      coOccupants: [],
      emergencyContact: { name: 'ฉุกเฉิน', phone: '081', relationship: 'ญาติ' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: [],
      createdAt: '2026-09-20T00:00:00Z',
      updatedAt: '2026-09-20T00:00:00Z',
    } as any,
    // 2. Move out tenant
    {
      id: 't-moveout',
      name: 'นาย สมชาย ขอย้าย',
      phone: '0812345678',
      status: 'active',
      roomId: 'room-101',
      coOccupants: [],
      emergencyContact: { name: 'ฉุกเฉิน', phone: '081', relationship: 'ญาติ' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    // 3. Extension tenant
    {
      id: 't-extension',
      name: 'นางสาว สมศรี ขอต่อ',
      phone: '0823456789',
      status: 'active',
      roomId: 'room-101',
      coOccupants: [],
      emergencyContact: { name: 'ฉุกเฉิน', phone: '081', relationship: 'ญาติ' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    // 4. Expired tenant
    {
      id: 't-expired',
      name: 'นาย สมศักดิ์ หมดสัญญา',
      phone: '0834567890',
      status: 'active',
      roomId: 'room-101',
      coOccupants: [],
      emergencyContact: { name: 'ฉุกเฉิน', phone: '081', relationship: 'ญาติ' },
      vehicle: { type: 'none' },
      pet: { hasPet: false },
      rentalHistory: ['room-101'],
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async () => ({}));
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  const renderOwnerTenants = () => {
    return render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={sampleTenants}
          rooms={sampleRooms}
          contracts={sampleContracts}
          bills={[]}
          buildings={sampleBuildings}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onSaveBills={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );
  };

  it('1. Renders "คำขอจากผู้เช่า" section with total count badge and category filter buttons', () => {
    renderOwnerTenants();

    // Section title
    expect(screen.getByText('คำขอจากผู้เช่า')).toBeTruthy();

    // Badge showing total count (4 items: 1 reg + 1 moveout + 1 ext + 1 exp)
    expect(screen.getByText(/4 รายการ/)).toBeTruthy();

    // Filter Buttons by title
    expect(screen.getByTitle(/ทั้งหมด \(4\)/)).toBeTruthy();
    expect(screen.getByTitle(/แจ้งเลิกเช่า \(1\)/)).toBeTruthy();
    expect(screen.getByTitle(/ขอต่อสัญญา \(1\)/)).toBeTruthy();
    expect(screen.getByTitle(/สัญญาหมดอายุ \(1\)/)).toBeTruthy();
    expect(screen.getByTitle(/ขอลงทะเบียน \(1\)/)).toBeTruthy();
  });

  it('2. Renders all 4 request categories with accurate room numbers, building names, and details', () => {
    renderOwnerTenants();

    // Registration Card
    expect(screen.getByText('นาย ภพสดนพนน')).toBeTruthy();
    expect(screen.getByText('ขอลงทะเบียน')).toBeTruthy();
    expect(screen.getByText(/ย้ายเข้า:/)).toBeTruthy();

    // Move out Card
    expect(screen.getAllByText('นาย สมชาย ขอย้าย').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('แจ้งเลิกเช่า')).toBeTruthy();
    expect(screen.getByText(/ขอย้ายออก:/)).toBeTruthy();
    expect(screen.getByText('฿5,000')).toBeTruthy(); // deposit

    // Contract Extension Card
    expect(screen.getAllByText('นางสาว สมศรี ขอต่อ').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('ขอต่อสัญญา')).toBeTruthy();
    expect(screen.getByText(/ต่อสัญญา:/)).toBeTruthy();

    // Contract Expired Card
    expect(screen.getAllByText('นาย สมศักดิ์ หมดสัญญา').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('สัญญาหมดอายุ')).toBeTruthy();
    expect(screen.getByText(/หมดอายุ:/)).toBeTruthy();
  });

  it('3. Filters cards when category buttons are clicked', () => {
    renderOwnerTenants();

    // Click "แจ้งเลิกเช่า" filter
    const moveOutBtn = screen.getByTitle(/แจ้งเลิกเช่า \(1\)/);
    fireEvent.click(moveOutBtn);

    // Should only show move out card in feed
    expect(screen.getByText('แจ้งเลิกเช่า')).toBeTruthy();
    expect(screen.queryByText('ขอลงทะเบียน')).toBeNull();
    expect(screen.queryByText('ขอต่อสัญญา')).toBeNull();
    expect(screen.queryByText('สัญญาหมดอายุ')).toBeNull();

    // Click "ทั้งหมด" filter
    const allBtn = screen.getByTitle(/ทั้งหมด \(4\)/);
    fireEvent.click(allBtn);

    // All should be visible again
    expect(screen.getByText('แจ้งเลิกเช่า')).toBeTruthy();
    expect(screen.getByText('ขอลงทะเบียน')).toBeTruthy();
    expect(screen.getByText('ขอต่อสัญญา')).toBeTruthy();
    expect(screen.getByText('สัญญาหมดอายุ')).toBeTruthy();
  });

  it('4. Clicking a registration card opens the tenant approval modal', () => {
    renderOwnerTenants();

    // Click on the registration card
    const regCard = screen.getByText('นาย ภพสดนพนน').closest('button');
    expect(regCard).toBeTruthy();
    fireEvent.click(regCard!);

    // Should open approve modal
    expect(screen.getAllByText(/ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i).length).toBeGreaterThanOrEqual(1);
  });

  it('5. Clicking a move-out card opens the termination modal', () => {
    renderOwnerTenants();

    const moveOutCard = screen.getByText('แจ้งเลิกเช่า').closest('button');
    expect(moveOutCard).toBeTruthy();
    fireEvent.click(moveOutCard!);

    expect(screen.getAllByText(/ทำเรื่องเลิกเช่าคืนห้องพัก/i).length).toBeGreaterThanOrEqual(1);
  });

  it('6. Clicking a contract extension card opens the contract renewal modal', () => {
    renderOwnerTenants();

    const extCard = screen.getByText('ขอต่อสัญญา').closest('button');
    expect(extCard).toBeTruthy();
    fireEvent.click(extCard!);

    expect(screen.getAllByText(/ต่ออายุสัญญาเช่า/i).length).toBeGreaterThanOrEqual(1);
  });

  it('7. When there are no requests, the "คำขอจากผู้เช่า" section shows empty state placeholder', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerTenants
          dormitoryId={mockDormitoryId}
          dormitory={sampleDormitory}
          tenants={[]}
          rooms={sampleRooms}
          contracts={[]}
          bills={[]}
          buildings={sampleBuildings}
          onSaveTenants={vi.fn()}
          onSaveRooms={vi.fn()}
          onSaveContracts={vi.fn()}
          onSaveBills={vi.fn()}
          onAddLog={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(screen.getByText('คำขอจากผู้เช่า')).toBeTruthy();
    expect(screen.getByText('ไม่มีคำขอจากผู้เช่าในขณะนี้')).toBeTruthy();
    expect(screen.getByText(/0 รายการ/)).toBeTruthy();
  });

  it('8. Dragging the horizontal container (> 5px) suppresses card click', () => {
    renderOwnerTenants();

    const regCard = screen.getByText('นาย ภพสดนพนน').closest('button');
    expect(regCard).toBeTruthy();

    const scrollContainer = regCard!.parentElement!;

    // Simulate drag start
    fireEvent.mouseDown(scrollContainer, { clientX: 100, pageX: 100 });
    // Move more than 5px
    fireEvent.mouseMove(scrollContainer, { clientX: 80, pageX: 80 });
    // Click card
    fireEvent.click(regCard!);

    // Modal should NOT be opened because user was dragging
    expect(screen.queryAllByText(/ยืนยันอนุมัติและรับผู้เช่าเข้าพัก/i)).toHaveLength(0);
  });
});
