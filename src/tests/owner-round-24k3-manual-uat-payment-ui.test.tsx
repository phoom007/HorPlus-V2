// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as httpClient from '../data/httpClient.js';
import { PaymentsOwnerView } from '../pages/owner/payments.js';
import { PrintView } from '../components/GlobalComponents.js';

describe('Owner Round 2.4K.3 — Mounted Payment UI & Rejected History Test Suite', () => {
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
  // 1. OUTSTANDING MONTHLY BILL — EXACT PRIMARY ACTIONS
  // =========================================================================
  it('A. Outstanding monthly bill: exact primary actions are [ เตือน LINE ] and [ รับเงินสด ], NO [ ยืนยันโอนเงิน ]', async () => {
    const monthlyBill = {
      id: 'bill-monthly-001',
      billNumber: 'INV-202609-101',
      totalAmount: 5000,
      paidAmount: 0,
      outstandingAmount: 5000,
      status: 'UNPAID',
      billingCycleId: 'cycle-sep-2026',
      roomId: 'room-101',
      roomNumber: '101',
      tenantId: 'tenant-001',
      items: [
        { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500 },
        { type: 'water', description: 'ค่าน้ำประปา', amount: 500 },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[monthlyBill] as any}
          rooms={[{ id: 'room-101', roomNumber: '101' }] as any}
          tenants={[{ id: 'tenant-001', displayName: 'สมชาย มั่นคง' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    // Switch to Waiting (ยังไม่ชำระ) tab
    const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
    fireEvent.click(unpaidTab);

    // Primary action buttons
    expect(screen.getByRole('button', { name: /เตือน LINE/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /รับเงินสด/i })).toBeDefined();
    // Rejection of transfer action on owner card
    expect(screen.queryByRole('button', { name: /ยืนยันโอนเงิน/i })).toBeNull();
  });

  // =========================================================================
  // 2. OUTSTANDING DAILY INVOICE — NO MANUAL TRANSFER CONFIRMATION
  // =========================================================================
  it('B. Outstanding Daily invoice: exact primary actions are [ เตือน LINE ] and [ รับเงินสด ], NO [ ยืนยันโอนเงิน ]', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/daily-stays/invoices')) {
        return [
          {
            id: 'daily-inv-001',
            invoiceNumber: 'DINV-202609-102',
            totalAgreedAmount: 3500,
            outstandingAmount: 3500,
            status: 'ISSUED',
            dormitoryId: 'dorm-test-01',
            dailyStay: {
              id: 'ds-001',
              roomId: 'room-102',
              tenantId: 'tenant-002',
              applicantFullName: 'วิภาดา วงศ์สุข',
              startDate: '2026-09-01',
              endDate: '2026-09-04',
              room: { roomNumber: '102' },
            },
            items: [
              { id: 'it-rent', itemType: 'DAILY_RENT', description: 'ค่าเช่ารายวัน', amount: 3000, status: 'PENDING' },
              { id: 'it-dep', itemType: 'DAILY_DEPOSIT', description: 'เงินมัดจำรายวัน', amount: 500, status: 'PENDING' },
            ],
          },
        ];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[]}
          rooms={[{ id: 'room-102', roomNumber: '102' }] as any}
          tenants={[{ id: 'tenant-002', displayName: 'วิภาดา วงศ์สุข' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
    fireEvent.click(unpaidTab);

    // Wait for Daily Invoice to be displayed
    await waitFor(() => {
      expect(screen.getByText('ห้อง 102')).toBeDefined();
    });

    // Exact primary actions
    expect(screen.getByRole('button', { name: /เตือน LINE/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /รับเงินสด/i })).toBeDefined();
    // Transfer confirmation must NOT be present
    expect(screen.queryByRole('button', { name: /ยืนยันโอนเงิน/i })).toBeNull();
  });

  // =========================================================================
  // 3. BILL LINE ITEMS — NO METHOD BADGES (เงินสด / โอนเงิน)
  // =========================================================================
  it('C. Bill line items do NOT show เงินสด / โอนเงิน method badges', async () => {
    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/daily-stays/invoices')) {
        return [
          {
            id: 'daily-inv-002',
            invoiceNumber: 'DINV-202609-103',
            totalAgreedAmount: 3500,
            outstandingAmount: 3500,
            status: 'ISSUED',
            dormitoryId: 'dorm-test-01',
            dailyStay: {
              id: 'ds-002',
              roomId: 'room-103',
              tenantId: 'tenant-003',
              applicantFullName: 'กิตติศักดิ์ ใจดี',
              startDate: '2026-09-02',
              endDate: '2026-09-05',
              room: { roomNumber: '103' },
            },
            items: [
              { id: 'it-rent', itemType: 'DAILY_RENT', description: 'ค่าเช่า (รายวัน)', amount: 3000, status: 'PENDING' },
              { id: 'it-dep', itemType: 'DAILY_DEPOSIT', description: 'เงินประกันรายวัน', amount: 500, status: 'PENDING' },
            ],
          },
        ];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[]}
          rooms={[{ id: 'room-103', roomNumber: '103' }] as any}
          tenants={[{ id: 'tenant-003', displayName: 'กิตติศักดิ์ ใจดี' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
    fireEvent.click(unpaidTab);

    await waitFor(() => {
      expect(screen.getByText('ห้อง 103')).toBeDefined();
    });

    // Verify NO method badges beside individual line items
    expect(screen.queryByRole('button', { name: /^เงินสด$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^โอนเงิน$/ })).toBeNull();
  });

  // =========================================================================
  // 4 & 5. PARTIAL PAYMENT — DETAIL BUTTON OUTSIDE YELLOW BOX WITH APPROVED STYLING
  // =========================================================================
  it('D & E. Partial payment: yellow box contains ONLY financial summary; ดูรายละเอียด +X is structurally OUTSIDE and matches approved styling', async () => {
    const partialBill = {
      id: 'bill-partial-4items',
      billNumber: 'INV-202609-204-P',
      totalAmount: 10600,
      paidAmount: 3000,
      outstandingAmount: 7600,
      status: 'partial',
      billingCycleId: 'cycle-sep-2026',
      roomId: 'room-204',
      roomNumber: '204',
      tenantId: 'tenant-004',
      items: [
        { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 7000 },
        { type: 'water', description: 'ค่าน้ำประปา', amount: 600 },
        { type: 'electricity', description: 'ค่าไฟฟ้า', amount: 2000 },
        { type: 'common', description: 'ค่าส่วนกลาง', amount: 1000 },
      ],
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[partialBill] as any}
          rooms={[{ id: 'room-204', roomNumber: '204' }] as any}
          tenants={[{ id: 'tenant-004', displayName: 'ประสิทธิ์ ร่ำรวย' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
    fireEvent.click(unpaidTab);

    // 1. Find the yellow financial summary box
    const yellowSummary = screen.getByTestId('partial-summary-bill-partial-4items');
    expect(yellowSummary).toBeDefined();

    // Contains financial summary values
    expect(yellowSummary.textContent).toContain('ยอดรวมเดิม:');
    expect(yellowSummary.textContent).toContain('10,600');
    expect(yellowSummary.textContent).toContain('ชำระแล้ว:');
    expect(yellowSummary.textContent).toContain('3,000');
    expect(yellowSummary.textContent).toContain('ยอดที่ต้องชำระ:');
    expect(yellowSummary.textContent).toContain('7,600');

    // 2. Find the detail toggle button
    const toggleBtn = screen.getByRole('button', { name: /ดูรายละเอียด \+4/i });
    expect(toggleBtn).toBeDefined();

    // Critical structural invariant: toggle button is NOT a descendant of the yellow summary box
    expect(yellowSummary.contains(toggleBtn)).toBe(false);

    // Visual styling matches existing approved detail toggle (indigo text, font-bold)
    expect(toggleBtn.className).toContain('text-indigo-600');
    expect(toggleBtn.className).toContain('font-bold');

    // 3. Click to expand
    fireEvent.click(toggleBtn);

    // Expanded shows canonical details and updates button text
    expect(screen.getByText('ค่าเช่า (รายเดือน):')).toBeDefined();
    expect(screen.getByText('ค่าน้ำ:')).toBeDefined();
    expect(screen.getByText('ค่าไฟฟ้า:')).toBeDefined();
    expect(screen.getByText('ค่าส่วนกลาง:')).toBeDefined();

    const hideBtn = screen.getByRole('button', { name: /ซ่อนรายละเอียด/i });
    expect(hideBtn).toBeDefined();
    expect(yellowSummary.contains(hideBtn)).toBe(false);

    // 4. Click to collapse
    fireEvent.click(hideBtn);
    expect(screen.queryByText('ค่าเช่า (รายเดือน):')).toBeNull();
    expect(screen.getByRole('button', { name: /ดูรายละเอียด \+4/i })).toBeDefined();
  });

  // =========================================================================
  // 6, 7 & 8. REJECTED SLIP TAB — CASH COLLECTION WITH STANDARD (5s) COUNTDOWN, NO ทันที
  // =========================================================================
  it('F, G & H. Rejected slip with outstanding > 0: shows [ รับเงินสด ], triggers standard (5s) countdown banner with NO [ ทันที ] button', async () => {
    const rejectedPayment = {
      id: 'pay-rej-001',
      billId: 'bill-with-rej',
      amount: 4500,
      status: 'REJECTED',
      rejectedReason: 'ยอดเงินโอนไม่ตรงกับยอดแจ้งหนี้',
      tenantId: 'tenant-005',
      reviewedAt: '2026-09-02T10:00:00Z',
      createdAt: '2026-09-02T09:00:00Z',
      bill: {
        id: 'bill-with-rej',
        billNumber: 'INV-202609-301',
        totalAmount: 4500,
        outstandingAmount: 4500,
        status: 'UNPAID',
        billingCycleId: 'cycle-sep-2026',
        roomId: 'room-301',
        roomNumber: '301',
        tenantId: 'tenant-005',
        tenant: { displayName: 'ศิริพร สุขเกษม' },
        items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500 }],
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
          rooms={[{ id: 'room-301', roomNumber: '301' }] as any}
          tenants={[{ id: 'tenant-005', displayName: 'ศิริพร สุขเกษม' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    // Switch to Rejected tab (สลิปผิดพลาด)
    const rejectedTab = await screen.findByRole('button', { name: /สลิปผิดพลาด/i });
    fireEvent.click(rejectedTab);

    // Assert card is displayed
    await waitFor(() => {
      expect(screen.getByText('ห้อง 301')).toBeDefined();
    });
    expect(screen.getByText('ยอดสลิปที่ถูกปฏิเสธ:')).toBeDefined();
    expect(screen.getByText('ยอดค้างชำระ:')).toBeDefined();

    // Outstanding > 0 allows cash collection
    const cashBtn = screen.getByRole('button', { name: /รับเงินสด/i });
    expect(cashBtn).toBeDefined();

    // Click [ รับเงินสด ] to start countdown
    fireEvent.click(cashBtn);

    // Assert countdown banner appears with standard wording
    expect(screen.getByText(/บันทึกเงินสด \(5s\)/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /ยกเลิก/i })).toBeDefined();

    // Critical assertion: NO unapproved [ ทันที ] button exists
    expect(screen.queryByRole('button', { name: /ทันที/i })).toBeNull();
  });

  // =========================================================================
  // 9 & 10. REJECTED SLIP TAB — HISTORICAL AUDIT PERSISTENCE WHEN BILL IS SETTLED
  // =========================================================================
  it('I & J. Rejected slip with Bill outstanding == 0: historical card remains visible, shows ชำระครบแล้ว, and NO [ รับเงินสด ] button', async () => {
    const settledRejectedPayment = {
      id: 'pay-rej-settled',
      billId: 'bill-settled-after-rej',
      amount: 4000, // Historical rejected payment amount
      status: 'REJECTED',
      rejectedReason: 'สลิปไม่ชัดเจน ตรวจสอบไม่ได้',
      tenantId: 'tenant-006',
      reviewedAt: '2026-09-02T11:00:00Z',
      createdAt: '2026-09-02T09:30:00Z',
      bill: {
        id: 'bill-settled-after-rej',
        billNumber: 'INV-202609-401',
        totalAmount: 4000,
        paidAmount: 4000,
        outstandingAmount: 0, // Settled later by another payment (e.g. cash)
        status: 'PAID',
        billingCycleId: 'cycle-sep-2026',
        roomId: 'room-401',
        roomNumber: '401',
        tenantId: 'tenant-006',
        tenant: { displayName: 'มานะ อดทน' },
        items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4000 }],
      },
    };

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/payments')) {
        return [settledRejectedPayment];
      }
      return [];
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[settledRejectedPayment.bill] as any}
          rooms={[{ id: 'room-401', roomNumber: '401' }] as any}
          tenants={[{ id: 'tenant-006', displayName: 'มานะ อดทน' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const rejectedTab = await screen.findByRole('button', { name: /สลิปผิดพลาด/i });
    fireEvent.click(rejectedTab);

    // 1. Rejected card remains visible in historical audit
    await waitFor(() => {
      expect(screen.getByText('ห้อง 401')).toBeDefined();
    });
    expect(screen.getByText('สลิปไม่ชัดเจน ตรวจสอบไม่ได้')).toBeDefined();

    // 2. Historical rejected amount remains visible
    expect(screen.getByText('ยอดสลิปที่ถูกปฏิเสธ:')).toBeDefined();

    // 3. Current obligation presentation shows "ชำระครบแล้ว"
    const settledBadges = screen.getAllByText('ชำระครบแล้ว');
    expect(settledBadges.length).toBeGreaterThanOrEqual(1);

    // 4. Must NOT show [ รับเงินสด ] button because bill is fully settled
    expect(screen.queryByRole('button', { name: /รับเงินสด/i })).toBeNull();
  });

  // =========================================================================
  // 11 & 12. PRINT VIEW & RECEIPT MODAL SIGNATURE SECTION
  // =========================================================================
  it('K. PrintView invokes window.focus() and window.print() synchronously on user click', () => {
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});

    render(
      <PrintView title="พิมพ์ใบเสร็จรับเงิน">
        <div>เนื้อหาใบเสร็จทดสอบ</div>
      </PrintView>
    );

    const printButton = screen.getByRole('button', { name: /พิมพ์ใบเสร็จรับเงิน/i });
    expect(printButton).toBeDefined();

    // Trigger click
    fireEvent.click(printButton);

    // Assert synchronous invocation within click handler
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(printSpy).toHaveBeenCalledTimes(1);

    focusSpy.mockRestore();
    printSpy.mockRestore();
  });

  it('L. Final Receipt button opens authoritative print endpoint /api/v1/receipts/{id}/print', async () => {
    const paidPaymentWithReceipt = {
      id: 'pay-with-receipt',
      billId: 'bill-rc-001',
      amount: 4500,
      status: 'APPROVED',
      paymentMethod: 'CASH',
      paymentDate: '2026-09-02T10:00:00Z',
      tenantId: 'tenant-007',
      dormitoryId: 'dorm-test-01',
      bill: {
        id: 'bill-rc-001',
        billNumber: 'INV-202609-501',
        totalAmount: 4500,
        paidAmount: 4500,
        outstandingAmount: 0,
        status: 'PAID',
        billingCycleId: 'cycle-sep-2026',
        roomId: 'room-501',
        roomNumber: '501',
        tenantId: 'tenant-007',
        tenant: { displayName: 'อภิสิทธิ์ วงศ์วิริยะ' },
        items: [{ type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500 }],
      },
    };

    vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method: string, url: string) => {
      if (url.includes('/payments')) {
        return [paidPaymentWithReceipt];
      }
      return [];
    });

    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/receipts/final/bill/')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'rc-501-authoritative' }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PaymentsOwnerView
          dormitoryId="dorm-test-01"
          bills={[paidPaymentWithReceipt.bill] as any}
          rooms={[{ id: 'room-501', roomNumber: '501' }] as any}
          tenants={[{ id: 'tenant-007', displayName: 'อภิสิทธิ์ วงศ์วิริยะ' }] as any}
          selectedBillingCycleId="cycle-sep-2026"
          selectedCycleCode="2026-09"
          billingCycles={testBillingCycles as any}
        />
      </QueryClientProvider>
    );

    const paidTab = await screen.findByRole('button', { name: /ชำระแล้ว/i });
    fireEvent.click(paidTab);

    // Find and click "ใบเสร็จรับเงิน" button
    await waitFor(() => {
      expect(screen.getByText('ห้อง 501')).toBeDefined();
    });

    const viewReceiptBtn = screen.getByRole('button', { name: /ใบเสร็จรับเงิน/i });
    fireEvent.click(viewReceiptBtn);

    // Assert window.open was invoked with authoritative print URL
    await waitFor(() => {
      expect(windowOpenSpy).toHaveBeenCalledWith('/api/v1/receipts/rc-501-authoritative/print', '_blank');
    });

    windowOpenSpy.mockRestore();
  });
});
