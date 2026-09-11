// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  PaymentsOwnerView,
  formatCycleThaiShort,
  fetchPayments,
  fetchDailyInvoices,
  resolveRecordBillingCycleId,
} from '../pages/owner/payments';
import { resolveRoomTenantAction } from '../pages/owner/rooms';
import * as httpClient from '../data/httpClient';

describe('R3.7a Owner Payments Financial Strictness & Canonical Authority', () => {
  let queryClient: QueryClient;
  const mockDormitoryId = '20000001-0000-4000-8000-000000000002';
  const mockCycleAugId = 'cycle-aug-2026';
  const mockCycleJulyId = 'cycle-july-2026';

  const mockBillingCycles = [
    { id: 'cycle-june-2026', cycleCode: '2026-06' },
    { id: 'cycle-july-2026', cycleCode: '2026-07' },
    { id: 'cycle-aug-2026', cycleCode: '2026-08' },
  ];

  const mockRooms = [
    { id: 'room-101', roomNumber: '101', floor: 1, status: 'occupied', monthlyRent: 4500 },
    { id: 'room-201', roomNumber: '201', floor: 2, status: 'occupied', monthlyRent: 4800 },
    { id: 'room-202', roomNumber: '202', floor: 2, status: 'occupied', monthlyRent: 4800 },
    { id: 'room-304', roomNumber: '304', floor: 3, status: 'vacant', monthlyRent: 5000 },
  ];

  const mockTenants = [
    { id: 'tenant-101', name: 'สมชาย สบายดี', displayName: 'สมชาย สบายดี', roomId: 'room-101' },
    { id: 'tenant-201', name: 'มานี มีแชร์', displayName: 'มานี มีแชร์', roomId: 'room-201' },
    { id: 'tenant-202', name: 'ปิติ ชูใจ', displayName: 'ปิติ ชูใจ', roomId: 'room-202' },
  ];

  const mockBills = [
    {
      id: 'bill-101-aug',
      dormitoryId: mockDormitoryId,
      billingCycleId: mockCycleAugId,
      cycleId: '2026-08',
      roomId: 'room-101',
      tenantId: 'tenant-101',
      billNumber: 'INV-202608-101',
      billKind: 'MONTHLY_UTILITY',
      totalAmount: 1268,
      outstandingAmount: 1268,
      status: 'unpaid' as const,
      dueDate: '2026-09-05',
      items: [
        { id: 'item-1', description: 'ค่าน้ำ (11 หน่วย @ ฿18)', amount: 198, category: 'water' as const },
        { id: 'item-2', description: 'ค่าไฟฟ้า (60 หน่วย @ ฿7)', amount: 420, category: 'electricity' as const },
      ],
      createdAt: '2026-08-25T10:00:00Z',
    },
    {
      id: 'bill-201-aug',
      dormitoryId: mockDormitoryId,
      billingCycleId: mockCycleAugId,
      cycleId: '2026-08',
      roomId: 'room-201',
      tenantId: 'tenant-201',
      billNumber: 'INV-202608-201-R',
      billKind: 'RENT',
      totalAmount: 4800,
      outstandingAmount: 4800,
      status: 'unpaid' as const,
      dueDate: '2026-09-05',
      items: [{ id: 'item-3', description: 'ค่าเช่าห้องพัก 201', amount: 4800, category: 'rent' as const }],
      createdAt: '2026-08-25T10:00:00Z',
    },
    {
      id: 'bill-202-dep-aug',
      dormitoryId: mockDormitoryId,
      billingCycleId: mockCycleAugId,
      cycleId: '2026-08',
      roomId: 'room-202',
      tenantId: 'tenant-202',
      billNumber: 'INV-202608-202-D',
      billKind: 'DEPOSIT',
      totalAmount: 4800,
      outstandingAmount: 0,
      status: 'paid' as const,
      dueDate: '2026-09-05',
      items: [{ id: 'item-4', description: 'เงินประกันสัญญาเช่า 202', amount: 4800, category: 'deposit' as const }],
      createdAt: '2026-08-25T10:00:00Z',
    },
    {
      id: 'bill-orphan-no-cycle',
      dormitoryId: mockDormitoryId,
      billingCycleId: undefined,
      cycleId: undefined,
      roomId: 'room-101',
      tenantId: 'tenant-101',
      billNumber: 'INV-ORPHAN-001',
      billKind: 'MONTHLY_UTILITY',
      totalAmount: 999,
      outstandingAmount: 999,
      status: 'unpaid' as const,
      dueDate: '2026-09-05',
      items: [{ id: 'item-5', description: 'ค่าบริการเบ็ดเตล็ด', amount: 999, category: 'other' as const }],
      createdAt: '2026-08-25T10:00:00Z',
    },
  ];

  const mockPayments = [
    {
      id: 'pay-pending-july',
      dormitoryId: mockDormitoryId,
      billId: 'bill-july-pending',
      tenantId: 'tenant-101',
      method: 'promptpay' as const,
      amount: 4500,
      status: 'PENDING' as const,
      paymentDate: '2026-07-28T14:30:00Z',
      evidenceUrl: 'https://example.com/slip-july.jpg',
      createdAt: '2026-07-28T14:30:00Z',
      bill: {
        id: 'bill-july-pending',
        billNumber: 'INV-202607-101',
        billingCycleId: mockCycleJulyId,
        totalAmount: 4500,
        status: 'pending',
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenant: { id: 'tenant-101', displayName: 'สมชาย สบายดี' },
      },
    },
    {
      id: 'pay-pending-orphan-cycle',
      dormitoryId: mockDormitoryId,
      billId: 'bill-orphan-pending',
      tenantId: 'tenant-101',
      method: 'promptpay' as const,
      amount: 1500,
      status: 'PENDING' as const,
      paymentDate: '2026-08-28T14:30:00Z',
      evidenceUrl: 'https://example.com/slip-orphan.jpg',
      createdAt: '2026-08-28T14:30:00Z',
      bill: {
        id: 'bill-orphan-pending',
        billNumber: 'INV-ORPHAN-PENDING',
        billingCycleId: null,
        totalAmount: 1500,
        status: 'pending',
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenant: { id: 'tenant-101', displayName: 'สมชาย สบายดี' },
      },
    },
    {
      id: 'pay-approved-aug-202',
      dormitoryId: mockDormitoryId,
      billId: 'bill-202-dep-aug',
      tenantId: 'tenant-202',
      method: 'promptpay' as const,
      amount: 4800,
      status: 'APPROVED' as const,
      paymentDate: '2026-08-25T10:00:00Z',
      createdAt: '2026-08-25T10:00:00Z',
      bill: {
        id: 'bill-202-dep-aug',
        billNumber: 'INV-202608-202-D',
        billingCycleId: mockCycleAugId,
        totalAmount: 4800,
        status: 'paid',
        billKind: 'DEPOSIT',
        roomId: 'room-202',
        tenantId: 'tenant-202',
        tenant: { id: 'tenant-202', displayName: 'ปิติ ชูใจ' },
      },
      receipt: {
        id: 'rcpt-202',
        receiptNumber: 'RCP-202608-202-D',
        totalAmount: 4800,
        issuedAt: '2026-08-25T10:05:00Z',
        paymentMethod: 'แสกน PromptPay QR',
        receiverName: 'ฝ่ายการเงิน หอพัก HorPlus',
      },
    },
    {
      id: 'pay-approved-no-receipt',
      dormitoryId: mockDormitoryId,
      billId: 'bill-aug-no-rcpt',
      tenantId: 'tenant-101',
      method: 'promptpay' as const,
      amount: 1268,
      status: 'APPROVED' as const,
      paymentDate: '2026-08-25T10:00:00Z',
      createdAt: '2026-08-25T10:00:00Z',
      bill: {
        id: 'bill-aug-no-rcpt',
        billNumber: 'INV-202608-NO-RCPT',
        billingCycleId: mockCycleAugId,
        totalAmount: 1268,
        status: 'paid',
        roomId: 'room-101',
        tenantId: 'tenant-101',
        tenant: { id: 'tenant-101', displayName: 'สมชาย สบายดี' },
      },
      receipt: null,
    },
    {
      id: 'pay-rejected-aug-201',
      dormitoryId: mockDormitoryId,
      billId: 'bill-201-aug',
      tenantId: 'tenant-201',
      method: 'promptpay' as const,
      amount: 4800,
      status: 'REJECTED' as const,
      rejectedReason: 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้',
      paymentDate: '2026-08-26T11:00:00Z',
      createdAt: '2026-08-26T11:00:00Z',
      bill: {
        id: 'bill-201-aug',
        billNumber: 'INV-202608-201-R',
        billingCycleId: mockCycleAugId,
        totalAmount: 4800,
        status: 'unpaid',
        roomId: 'room-201',
        tenantId: 'tenant-201',
        tenant: { id: 'tenant-201', displayName: 'มานี มีแชร์' },
      },
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, url) => {
      if (url.includes('/payments?')) {
        return mockPayments as any;
      }
      if (url.includes('/daily-stays/invoices')) {
        return { data: [] } as any;
      }
      return {} as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Tab 1 (Checking) displays pending submissions across ALL cycles and shows warning for unresolvable cycle', async () => {
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

    await waitFor(() => {
      expect(screen.getAllByText('ห้อง 101').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/ก.ค. 69/)).toBeInTheDocument();
      expect(screen.getByText('ไม่พบข้อมูลงวดบิล')).toBeInTheDocument();
      expect(screen.getAllByText('สมชาย สบายดี').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('2. Tab 2 (Cash) strictly filters to selected Header cycle and FAILS CLOSED for orphan bills without cycle', async () => {
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

    // Switch to Cash tab
    const cashTabBtn = screen.getByRole('button', { name: /ยังไม่ชำระ/ });
    fireEvent.click(cashTabBtn);

    await waitFor(() => {
      // Room 101 August utility bill is shown
      expect(screen.getByText('ห้อง 101')).toBeInTheDocument();
      expect(screen.getByText(/1,268/)).toBeInTheDocument();
      // Orphan bill without billingCycleId MUST FAIL CLOSED (not shown in Cash tab)
      expect(screen.queryByText(/INV-ORPHAN-001/)).not.toBeInTheDocument();
    });
  });

  it('3. Tab 3 (Paid) displays selected Header cycle approved payments and enforces CANONICAL receipt only', async () => {
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

    // Switch to Paid tab
    const paidTabBtn = screen.getByRole('button', { name: /ชำระแล้ว/ });
    fireEvent.click(paidTabBtn);

    await waitFor(() => {
      expect(screen.getByText('ห้อง 202')).toBeInTheDocument();
      expect(screen.getByText('เงินประกัน')).toBeInTheDocument();
      expect(screen.getByText(/4,800/)).toBeInTheDocument();
    });

    // Click "ใบเสร็จรับเงิน" button on card with canonical receipt
    const receiptBtns = screen.getAllByRole('button', { name: /ใบเสร็จรับเงิน/ });
    fireEvent.click(receiptBtns[0]);

    // Verify receipt modal opens with canonical server receipt number
    await waitFor(() => {
      expect(screen.getByText(/RCP-202608-202-D/)).toBeInTheDocument();
      expect(screen.getAllByText(/ปิติ ชูใจ/).length).toBeGreaterThanOrEqual(1);
    });

    // Click receipt button for approved payment that has NO server receipt
    fireEvent.click(receiptBtns[1]);

    // Must show safe warning and NOT open fabricated receipt
    await waitFor(() => {
      expect(screen.getByText('ไม่พบข้อมูลใบเสร็จรับเงิน กรุณาโหลดข้อมูลใหม่')).toBeInTheDocument();
      expect(screen.queryByText(/RCPT-/)).not.toBeInTheDocument();
    });
  });

  it('4. Tab 4 (Rejected) strictly filters to selected Header cycle with rejection reason', async () => {
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

    // Switch to Rejected tab
    const rejectedTabBtn = screen.getByRole('button', { name: /สลิปผิดพลาด/ });
    fireEvent.click(rejectedTabBtn);

    await waitFor(() => {
      expect(screen.getByText('ห้อง 201')).toBeInTheDocument();
      expect(screen.getByText('ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้')).toBeInTheDocument();
      expect(screen.getByText(/4,800/)).toBeInTheDocument();
    });
  });

  it('5. Financial fetchers throw directly to React Query on network failure', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockRejectedValue(new Error('Network connectivity lost'));

    // Directly verify fetcher throws
    await expect(fetchPayments(mockDormitoryId)).rejects.toThrow('Network connectivity lost');
    await expect(fetchDailyInvoices(mockDormitoryId)).rejects.toThrow('Network connectivity lost');
  });

  it('6. resolveRecordBillingCycleId helper resolves cycle IDs accurately and fails closed on null/invalid', () => {
    expect(resolveRecordBillingCycleId(mockCycleAugId, undefined, mockBillingCycles as any)).toBe(mockCycleAugId);
    expect(resolveRecordBillingCycleId(undefined, '2026-08', mockBillingCycles as any)).toBe(mockCycleAugId);
    expect(resolveRecordBillingCycleId(undefined, '2099-99', mockBillingCycles as any)).toBeNull();
    expect(resolveRecordBillingCycleId(null, null, mockBillingCycles as any)).toBeNull();
    expect(resolveRecordBillingCycleId('', '', mockBillingCycles as any)).toBeNull();
  });

  it('7. Room 304 Quick Add eligibility is ENABLED for vacant room with valid operational authority', () => {
    const room304 = {
      id: 'room-304',
      roomNumber: '304',
      status: 'vacant' as const,
      monthlyRent: 5000,
      currentOperationalActions: {
        canSetMaintenance: true,
        maintenanceBlockReason: null,
      },
    };

    const presentation = {
      state: 'VACANT_NO_AGREEMENT' as const,
      occupancy: null,
      lifecycle: null,
    };

    const action = resolveRoomTenantAction(room304 as any, presentation as any);
    expect(action).toEqual({ kind: 'QUICK_ADD_CURRENT' });
  });

  it('8. Room tenant action returns canonical disabled reason for maintenance, reserved, occupied, and missing authority', () => {
    const maintenanceRoom = {
      id: 'm-1',
      roomNumber: '206',
      status: 'maintenance' as const,
      monthlyRent: 4000,
      currentOperationalActions: { canSetMaintenance: false, maintenanceBlockReason: null },
    };
    const reservedRoom = {
      id: 'r-1',
      roomNumber: '205',
      status: 'reserved' as const,
      monthlyRent: 4000,
      currentOperationalActions: { canSetMaintenance: false, maintenanceBlockReason: 'ACTIVE_RESERVATION' },
    };
    const occupiedRoom = {
      id: 'o-1',
      roomNumber: '101',
      status: 'occupied' as const,
      monthlyRent: 4000,
      currentOperationalActions: { canSetMaintenance: false, maintenanceBlockReason: 'ACTIVE_OCCUPANCY' },
    };
    const missingAuthorityRoom = {
      id: 'x-1',
      roomNumber: '999',
      status: 'vacant' as const,
      monthlyRent: 4000,
      currentOperationalActions: null,
    };
    const missingRentRoom = {
      id: 'p-1',
      roomNumber: '998',
      status: 'vacant' as const,
      monthlyRent: null,
      termRent: null,
      dailyRent: null,
      currentOperationalActions: { canSetMaintenance: true, maintenanceBlockReason: null },
    };

    const presentation = { state: 'VACANT_NO_AGREEMENT' as const, occupancy: null, lifecycle: null };

    expect(resolveRoomTenantAction(maintenanceRoom as any, presentation as any)).toEqual({
      kind: 'DISABLED',
      reason: 'ปิดปรับปรุง',
    });

    expect(resolveRoomTenantAction(reservedRoom as any, presentation as any)).toEqual({
      kind: 'DISABLED',
      reason: 'มีการจองล่วงหน้า',
    });

    expect(resolveRoomTenantAction(occupiedRoom as any, presentation as any)).toEqual({
      kind: 'DISABLED',
      reason: 'ปัจจุบันมีผู้เช่า',
    });

    expect(resolveRoomTenantAction(missingAuthorityRoom as any, presentation as any)).toEqual({
      kind: 'DISABLED',
      reason: 'ไม่สามารถตรวจสอบสถานะห้องได้ กรุณาโหลดข้อมูลใหม่',
    });

    expect(resolveRoomTenantAction(missingRentRoom as any, presentation as any)).toEqual({
      kind: 'DISABLED',
      reason: 'ข้อมูลค่าเช่าของห้องไม่ครบ',
    });
  });
});
