// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * OWNER R3.8e — Frontend Payments Receipt Modal Authority & Immutability Tests
 *
 * Covers Section G:
 * CASE 1 — Group Receipt: resolves payment.paymentGroup.receipts[0] when child payment.receipt is null
 * CASE 2 — Legacy Receipt without snapshot items: displays 'ยอดชำระตามใบเสร็จเดิม' and never leaks live bill items
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PaymentsOwnerView } from '../pages/owner/payments';
import * as httpClient from '../data/httpClient';

describe('OWNER R3.8e Frontend Receipt Resolution & Immutability', () => {
  let queryClient: QueryClient;
  const mockDormitoryId = '20000001-0000-4000-8000-000000000001';
  const mockCycleJulyId = 'cycle-july-2026';

  const mockBillingCycles = [
    { id: mockCycleJulyId, cycleCode: '2026-07', name: 'รอบ ก.ค. 2569' },
  ];

  const mockRooms = [
    { id: 'room-302', roomNumber: '302', floor: 3, status: 'occupied', monthlyRent: 4000 },
  ];

  const mockTenants = [
    { id: 'tenant-302', name: 'สมศรี ทดสอบ', displayName: 'สมศรี ทดสอบ', roomId: 'room-302' },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('CASE 1 — Group Receipt: Resolves payment.paymentGroup.receipts[0] and renders snapshot items', async () => {
    const mockBillJuly = {
      id: 'bill-302-july',
      dormitoryId: mockDormitoryId,
      billingCycleId: mockCycleJulyId,
      cycleId: '2026-07',
      roomId: 'room-302',
      tenantId: 'tenant-302',
      billNumber: 'INV-202607-302',
      billKind: 'MONTHLY_UTILITY',
      totalAmount: 4000,
      paidAmount: 4000,
      outstandingAmount: 0,
      status: 'paid' as const,
      dueDate: '2026-08-05',
      items: [{ id: 'it-1', description: 'ค่าเช่าห้องพัก 302', amount: 4000, category: 'rent' as const }],
      createdAt: '2026-07-25T10:00:00Z',
    };

    const mockGroupReceipt = {
      id: 'rcpt-grp-001',
      receiptNumber: 'RCP-GRP-202608-001',
      totalAmount: 6500,
      issuedAt: '2026-08-28T14:35:00Z',
      snapshotData: {
        receiptNumber: 'RCP-GRP-202608-001',
        billNumber: 'INV-202607-302',
        roomNumber: '302',
        tenantName: 'สมศรี ทดสอบ',
        total: 6500,
        paymentMethod: 'PROMPTPAY',
        paymentDate: '2026-08-28T14:30:00Z',
        items: [
          { description: 'ค่าเช่า ก.ค. 2569 (ห้อง 302)', amount: 4000 },
          { description: 'ค่าเช่า ส.ค. 2569 (ห้อง 302)', amount: 2500 },
        ],
      },
    };

    const mockPayments = [
      {
        id: 'pay-child-302-july',
        dormitoryId: mockDormitoryId,
        billId: 'bill-302-july',
        tenantId: 'tenant-302',
        paymentGroupId: 'group-302-combined',
        method: 'promptpay',
        amount: 4000,
        status: 'verified',
        paymentDate: '2026-08-28T14:30:00Z',
        createdAt: '2026-08-28T14:30:00Z',
        receipt: null, // Child payment has NO direct receipt
        paymentGroup: {
          id: 'group-302-combined',
          totalAmount: 6500,
          status: 'APPROVED',
          receipts: [mockGroupReceipt], // Canonical Group Receipt!
        },
        bill: mockBillJuly,
      },
    ];

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, url) => {
      if (url?.includes('/payments')) {
        return mockPayments;
      }
      if (url?.includes('/daily-stay/invoices')) {
        return [];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId={mockDormitoryId}
          selectedBillingCycleId={mockCycleJulyId}
          selectedCycleCode="2026-07"
          billingCycles={mockBillingCycles}
          rooms={mockRooms as any}
          tenants={mockTenants as any}
          bills={[mockBillJuly as any]}
        />
      </QueryClientProvider>
    );

    // Switch to Paid tab
    const paidTabBtn = screen.getByRole('button', { name: /ชำระแล้ว/ });
    fireEvent.click(paidTabBtn);

    // Wait for the payment record to appear
    await waitFor(() => {
      expect(screen.getByText('ห้อง 302')).toBeInTheDocument();
    });

    // Find and click the 'ใบเสร็จรับเงิน' button
    const receiptBtns = screen.getAllByRole('button', { name: /ใบเสร็จรับเงิน/ });
    fireEvent.click(receiptBtns[0]);

    // Verify modal is open and displays Canonical Group Receipt data
    await waitFor(() => {
      expect(screen.getByText('เลขที่: RCP-GRP-202608-001')).toBeInTheDocument();
    });

    // Verify snapshot items and absence of error toast
    expect(screen.getByText('ค่าเช่า ก.ค. 2569 (ห้อง 302)')).toBeInTheDocument();
    expect(screen.getByText('ค่าเช่า ส.ค. 2569 (ห้อง 302)')).toBeInTheDocument();
    expect(screen.queryByText('ไม่พบข้อมูลใบเสร็จรับเงิน')).not.toBeInTheDocument();
  });

  it('CASE 2 — Legacy Receipt: Uses immutable fallback "ยอดชำระตามใบเสร็จเดิม" and never renders current live Bill items', async () => {
    const mockLiveBill = {
      id: 'bill-302-live',
      dormitoryId: mockDormitoryId,
      billingCycleId: mockCycleJulyId,
      cycleId: '2026-07',
      roomId: 'room-302',
      tenantId: 'tenant-302',
      billNumber: 'INV-202607-302',
      billKind: 'MONTHLY_UTILITY',
      totalAmount: 4000,
      paidAmount: 4000,
      outstandingAmount: 0,
      status: 'paid' as const,
      dueDate: '2026-08-05',
      items: [
        // Live items that MUST NOT leak into legacy receipt modal
        { id: 'mut-1', description: 'ค่าล้างแอร์ประจำปี (รายการใหม่หลังออกใบเสร็จ)', amount: 800, category: 'other' as const },
        { id: 'mut-2', description: 'ค่าปรับรบกวนเวลาพักผ่อน (รายการสด)', amount: 500, category: 'other' as const },
      ],
      createdAt: '2026-07-25T10:00:00Z',
    };

    const mockLegacyReceipt = {
      id: 'rcpt-legacy-001',
      receiptNumber: 'RCP-LEGACY-001',
      totalAmount: 4000,
      issuedAt: '2026-07-28T14:35:00Z',
      snapshotData: {
        receiptNumber: 'RCP-LEGACY-001',
        billNumber: 'INV-202607-302',
        roomNumber: '302',
        tenantName: 'สมศรี ทดสอบ',
        total: 4000,
        items: [], // Missing/empty snapshot items
      },
    };

    const mockPayments = [
      {
        id: 'pay-legacy-302',
        dormitoryId: mockDormitoryId,
        billId: 'bill-302-live',
        tenantId: 'tenant-302',
        paymentGroupId: null,
        method: 'cash',
        amount: 4000,
        status: 'verified',
        paymentDate: '2026-07-28T14:30:00Z',
        createdAt: '2026-07-28T14:30:00Z',
        receipt: mockLegacyReceipt,
        bill: mockLiveBill,
      },
    ];

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, url) => {
      if (url?.includes('/payments')) {
        return mockPayments;
      }
      if (url?.includes('/daily-stay/invoices')) {
        return [];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId={mockDormitoryId}
          selectedBillingCycleId={mockCycleJulyId}
          selectedCycleCode="2026-07"
          billingCycles={mockBillingCycles}
          rooms={mockRooms as any}
          tenants={mockTenants as any}
          bills={[mockLiveBill as any]}
        />
      </QueryClientProvider>
    );

    const paidTabBtn = screen.getByRole('button', { name: /ชำระแล้ว/ });
    fireEvent.click(paidTabBtn);

    await waitFor(() => {
      expect(screen.getByText('ห้อง 302')).toBeInTheDocument();
    });

    const receiptBtns = screen.getAllByRole('button', { name: /ใบเสร็จรับเงิน/ });
    fireEvent.click(receiptBtns[0]);

    await waitFor(() => {
      expect(screen.getByText('เลขที่: RCP-LEGACY-001')).toBeInTheDocument();
    });

    // Verify fallback message is rendered
    expect(screen.getByText('ยอดชำระตามใบเสร็จเดิม')).toBeInTheDocument();

    // Verify LIVE bill items are STRICTLY NOT leaked into the modal
    expect(screen.queryByText(/ค่าล้างแอร์ประจำปี/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ค่าปรับรบกวนเวลาพักผ่อน/)).not.toBeInTheDocument();
  });
});
