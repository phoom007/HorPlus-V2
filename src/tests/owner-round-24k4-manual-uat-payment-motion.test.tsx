// @vitest-environment happy-dom
/**
 * @license Apache-2.0
 * OWNER ROUND 2.4K.4: Payment Motion Exit & Rejected Countdown Unified Container Test Suite
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient.js';
import { PaymentsOwnerView } from '../pages/owner/payments.js';

describe('Owner Round 2.4K.4 — Manual UAT Payment Motion & Rejected Countdown (Sections 27 & 30)', () => {
  let queryClient: QueryClient;

  const testBillingCycles = [
    {
      id: 'cycle-sep-2026',
      cycleCode: '2026-09',
      name: 'ก.ย. 2569',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      dueDate: '2026-09-10',
      status: 'ACTIVE',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // 1. REJECTED CASH COUNTDOWN: UNIFIED ACTION ROW (Section 27)
  // =========================================================================
  it('A. Rejected cash countdown replaces whole action row with ONE unified container; [ให้แนบใหม่] is hidden; [ยกเลิก] restores row', async () => {
    const rejectedPayment = {
      id: 'pay-rej-uat-01',
      billId: 'bill-rej-uat-01',
      amount: 5200,
      status: 'REJECTED',
      rejectedReason: 'ยอดโอนไม่ตรงยอดบิล',
      tenantId: 'tenant-001',
      reviewedAt: '2026-09-02T10:00:00Z',
      createdAt: '2026-09-02T09:00:00Z',
      bill: {
        id: 'bill-rej-uat-01',
        billNumber: 'INV-202609-101',
        totalAmount: 5200,
        outstandingAmount: 5200,
        status: 'UNPAID',
        billingCycleId: 'cycle-sep-2026',
        roomId: 'room-101',
        roomNumber: '101',
        tenantId: 'tenant-001',
        tenant: { displayName: 'เกียรติศักดิ์ ชัยชนะ' },
        items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 5200 }],
      },
    };

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/payments')) {
        return [rejectedPayment];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[rejectedPayment.bill] as any}
          rooms={[{ id: 'room-101', roomNumber: '101' }] as any}
          tenants={[{ id: 'tenant-001', displayName: 'เกียรติศักดิ์ ชัยชนะ' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    // 1. Switch to Rejected Tab (สลิปผิดพลาด)
    const rejectedTab = await screen.findByRole('button', { name: /สลิปผิดพลาด/i });
    fireEvent.click(rejectedTab);

    await waitFor(() => {
      expect(screen.getByText('ห้อง 101')).toBeDefined();
    });

    // Both initial action buttons are present before clicking countdown
    const lineResubmitBtn = screen.getByRole('button', { name: /ให้แนบใหม่/i });
    const cashBtn = screen.getByRole('button', { name: /รับเงินสด/i });
    expect(lineResubmitBtn).toBeDefined();
    expect(cashBtn).toBeDefined();

    // 2. Click [ รับเงินสด ] -> Countdown initiates
    fireEvent.click(cashBtn);

    // Unified container appears
    expect(screen.getByText(/บันทึกเงินสด \(5s\)/i)).toBeDefined();
    const cancelBtn = screen.getByRole('button', { name: /ยกเลิก/i });
    expect(cancelBtn).toBeDefined();

    // MANDATORY REQUIREMENT: [ ให้แนบใหม่ ] is completely hidden during active countdown
    expect(screen.queryByRole('button', { name: /ให้แนบใหม่/i })).toBeNull();
    // [ รับเงินสด ] normal trigger button is also replaced
    expect(screen.queryByRole('button', { name: /^รับเงินสด$/i })).toBeNull();

    // 3. Click [ ยกเลิก ] -> Cancels countdown and restores normal row
    fireEvent.click(cancelBtn);

    expect(screen.queryByText(/บันทึกเงินสด \(5s\)/i)).toBeNull();
    expect(screen.getByRole('button', { name: /ให้แนบใหม่/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /รับเงินสด/i })).toBeDefined();
  });

  // =========================================================================
  // 2. HISTORICAL REJECTED CARD NEVER EXITS ON SETTLEMENT (Section 27 & 30)
  // =========================================================================
  it('B. Cash settlement on rejected card settles the underlying bill in place and NEVER triggers card exit animation', async () => {
    const rejectedPayment = {
      id: 'pay-rej-stay-01',
      billId: 'bill-stay-01',
      amount: 4000,
      status: 'REJECTED',
      rejectedReason: 'ยอดไม่ครบ',
      tenantId: 'tenant-002',
      reviewedAt: '2026-09-02T10:00:00Z',
      createdAt: '2026-09-02T09:00:00Z',
      bill: {
        id: 'bill-stay-01',
        billNumber: 'INV-202609-102',
        totalAmount: 4000,
        outstandingAmount: 4000,
        status: 'UNPAID',
        billingCycleId: 'cycle-sep-2026',
        roomId: 'room-102',
        roomNumber: '102',
        tenantId: 'tenant-002',
        tenant: { displayName: 'วันเพ็ญ สดใส' },
        items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4000 }],
      },
    };

    let postCalled = false;
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
      if (method === 'POST' && url.includes('/payments/cash')) {
        postCalled = true;
        return { success: true };
      }
      if (url.includes('/payments')) {
        return [rejectedPayment];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[rejectedPayment.bill] as any}
          rooms={[{ id: 'room-102', roomNumber: '102' }] as any}
          tenants={[{ id: 'tenant-002', displayName: 'วันเพ็ญ สดใส' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const rejectedTab = await screen.findByRole('button', { name: /สลิปผิดพลาด/i });
    fireEvent.click(rejectedTab);

    await screen.findByText('ห้อง 102');

    // Use fake timers strictly around the countdown
    vi.useFakeTimers();

    const cashBtn = screen.getByRole('button', { name: /รับเงินสด/i });
    fireEvent.click(cashBtn);

    // Fast-forward 5 seconds countdown
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Settlement HTTP request was dispatched
    expect(postCalled).toBe(true);

    // The card container MUST NOT have exit animation classes (e.g. opacity-0)
    const cardEl = screen.getByText('ห้อง 102').closest('div.rounded-3xl');
    expect(cardEl).toBeDefined();
    expect(cardEl?.className).not.toContain('opacity-0');

    vi.useRealTimers();
  });

  // =========================================================================
  // 3. CASH TAB: BILL EXIT MOTION ON CASH SETTLEMENT (Section 30)
  // =========================================================================
  it('C. Cash settlement on cash tab bill initiates smooth exit animation class before cache invalidation', async () => {
    const cashBill = {
      id: 'bill-cash-motion-01',
      billNumber: 'INV-202609-201',
      totalAmount: 3500,
      paidAmount: 0,
      outstandingAmount: 3500,
      status: 'UNPAID',
      billingCycleId: 'cycle-sep-2026',
      roomId: 'room-201',
      roomNumber: '201',
      tenantId: 'tenant-003',
      tenant: { displayName: 'ประสิทธิ์ มั่งมี' },
      items: [{ type: 'rent', description: 'ค่าเช่าห้อง', amount: 3500 }],
    };

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method: string, url: string) => {
      if (method === 'POST' && url.includes('/payments/cash')) {
        return { success: true };
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[cashBill] as any}
          rooms={[{ id: 'room-201', roomNumber: '201' }] as any}
          tenants={[{ id: 'tenant-003', displayName: 'ประสิทธิ์ มั่งมี' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    // Switch to Cash tab (ยังไม่ชำระ)
    const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/i });
    fireEvent.click(unpaidTab);

    await screen.findByText('ห้อง 201');

    vi.useFakeTimers();

    // Click [ รับเงินสด ]
    const cashBtn = screen.getByRole('button', { name: /รับเงินสด/i });
    fireEvent.click(cashBtn);

    // Let 5-second countdown expire to trigger handleConfirmCashPayment
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // Flush promise resolution of httpRequest
    await act(async () => {
      await Promise.resolve();
    });

    // Card receives exiting class (opacity-0 -translate-y-2)
    const cardEl = screen.getByText('ห้อง 201').closest('div.rounded-3xl');
    expect(cardEl?.className).toContain('opacity-0');
    expect(cardEl?.className).toContain('-translate-y-2');

    vi.useRealTimers();
  });
});
