/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Payments & Invoices UX Enhancements Test Suite
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TenantPaymentsTab } from '../pages/tenant/tabs/TenantPaymentsTab';
import { TenantInvoiceView } from '../pages/tenant/views/TenantInvoiceView';
import { getCanonicalBillKindLabel, formatPaymentDateTime } from '../pages/tenant/tenantHelpers';
import { Bill } from '../types';

describe('Tenant Payments & Invoices UX Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Canonical Bill Kind Helpers', () => {
    it('resolves bill kind labels correctly', () => {
      expect(getCanonicalBillKindLabel({ billKind: 'DEPOSIT' } as any)).toBe('บิลค่าประกัน / มัดจำ');
      expect(getCanonicalBillKindLabel({ billKind: 'RENT' } as any)).toBe('บิลค่าเช่า');
      expect(getCanonicalBillKindLabel({ billKind: 'MONTHLY_UTILITY' } as any)).toBe('บิลรายเดือน');
      expect(getCanonicalBillKindLabel({ billKind: 'LEGACY_COMBINED' } as any)).toBe('บิลรายเดือน');

      // Item description fallback
      expect(getCanonicalBillKindLabel({ items: [{ description: 'เงินประกันห้องพัก' }] } as any)).toBe('บิลค่าประกัน / มัดจำ');
      expect(getCanonicalBillKindLabel({ items: [{ description: 'ค่าเช่าห้องพักรายวัน' }] } as any)).toBe('บิลค่าเช่ารายวัน');
      expect(getCanonicalBillKindLabel({ items: [{ description: 'ค่าเช่าห้องพักประจำเดือน' }] } as any)).toBe('บิลค่าเช่า');
      expect(getCanonicalBillKindLabel({ items: [{ description: 'ค่าน้ำประปา' }, { description: 'ค่าไฟฟ้า' }] } as any)).toBe('บิลรายเดือน');
    });

    it('formats payment date time into Thai Buddhist era string', () => {
      // 2026-09-15T07:30:00.000Z (which is 14:30 in UTC+7)
      const iso = '2026-09-15T07:30:00.000Z';
      const formatted = formatPaymentDateTime(iso);
      expect(formatted).toContain('15');
      expect(formatted).toContain('ก.ย.');
      expect(formatted).toContain('2569');
      expect(formatted).toContain('เวลา');
      expect(formatted).toContain('น.');
    });
  });

  describe('2. TenantPaymentsTab Header & Payment Timestamp', () => {
    const mockPaidBill: Bill = {
      id: 'b-paid-1',
      billNumber: 'INV-2026-08-0006',
      cycleId: '2026-09',
      billingCycleId: '2026-09',
      billKind: 'MONTHLY_UTILITY',
      roomId: 'r-202',
      tenantId: 't-1',
      totalAmount: 6268,
      dueDate: '2026-09-05T00:00:00.000Z',
      status: 'paid' as any,
      paidAt: '2026-09-15T07:30:00.000Z',
      items: [
        { description: 'ค่าน้ำ', amount: 198 },
        { description: 'ค่าไฟ', amount: 420 },
      ],
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-09-15T07:30:00.000Z',
    };

    const mockUnpaidBill: Bill = {
      id: 'b-unpaid-1',
      billNumber: 'INV-2026-09-0001',
      cycleId: '2026-09',
      billingCycleId: '2026-09',
      billKind: 'RENT',
      roomId: 'r-202',
      tenantId: 't-1',
      totalAmount: 4500,
      dueDate: '2026-09-25T00:00:00.000Z',
      status: 'unpaid' as any,
      items: [{ description: 'ค่าเช่าห้อง', amount: 4500 }],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };

    it('renders canonical title "บิลรายเดือน" and "บิลค่าเช่า" with bill number on subtitle', () => {
      const onOpenInvoice = vi.fn();
      render(
        <TenantPaymentsTab
          tenantBills={[mockUnpaidBill, mockPaidBill]}
          onOpenInvoice={onOpenInvoice}
          onOpenPayment={() => {}}
        />
      );

      // Check unpaid bill card title
      expect(screen.getByText(/บิลค่าเช่า \(ยอดรวม ฿ 4,500\)/)).toBeDefined();
      expect(screen.getByText(/เลขที่: INV-2026-09-0001 • รอบประจำเดือน กันยายน 2569/)).toBeDefined();

      // Check paid bill card title
      expect(screen.getByText(/บิลรายเดือน \(ยอดรวม ฿ 6,268\)/)).toBeDefined();
      expect(screen.getByText(/เลขที่: INV-2026-08-0006 • รอบประจำเดือน กันยายน 2569/)).toBeDefined();

      // Check payment timestamp on paid bill
      expect(screen.getByText(/ชำระเมื่อ 15 ก.ย. 2569/)).toBeDefined();

      // Click "รายละเอียด" on paid bill
      const detailBtn = screen.getByTestId('btn-bill-detail-b-paid-1');
      fireEvent.click(detailBtn);
      expect(onOpenInvoice).toHaveBeenCalledWith('b-paid-1');
    });
  });

  describe('3. TenantInvoiceView Multi-Accordion & Auto-Expand', () => {
    const paidBills: Bill[] = [
      {
        id: 'b-hist-1',
        billNumber: 'INV-2026-08-0006',
        cycleId: '2026-09',
        billingCycleId: '2026-09',
        billKind: 'MONTHLY_UTILITY',
        roomId: 'r-202',
        tenantId: 't-1',
        totalAmount: 6268,
        dueDate: '2026-09-05T00:00:00.000Z',
        status: 'paid' as any,
        items: [
          { description: 'ค่าน้ำ', amount: 198 },
          { description: 'ค่าไฟ', amount: 420 },
        ],
        createdAt: '2026-08-25T00:00:00.000Z',
        updatedAt: '2026-09-15T07:30:00.000Z',
      },
      {
        id: 'b-hist-2',
        billNumber: 'INV-202607-101-D',
        cycleId: '2026-07',
        billingCycleId: '2026-07',
        billKind: 'RENT',
        roomId: 'r-202',
        tenantId: 't-1',
        totalAmount: 4500,
        dueDate: '2026-07-05T00:00:00.000Z',
        status: 'paid' as any,
        items: [{ description: 'ค่าเช่าห้อง', amount: 4500 }],
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-07-01T07:30:00.000Z',
      },
    ];

    it('auto-expands selectedBillId when opening in history tab', () => {
      render(
        <TenantInvoiceView
          activeUnpaidBill={null}
          tenantBills={paidBills}
          selectedBillId="b-hist-1"
          invoiceTab="history"
          setInvoiceTab={() => {}}
          onBack={() => {}}
          onGoToPayment={() => {}}
        />
      );

      // b-hist-1 is auto-expanded, showing its items
      expect(screen.getByText(/ค่าน้ำ:/)).toBeDefined();
      expect(screen.getByText(/ค่าไฟฟ้า:/)).toBeDefined();

      // b-hist-2 is collapsed (its item 'ค่าเช่า (รายเดือน):' is not visible)
      expect(screen.queryByText(/ค่าเช่า \(รายเดือน\):/)).toBeNull();
    });

    it('supports multi-accordion: opening a second bill keeps the first bill open', () => {
      render(
        <TenantInvoiceView
          activeUnpaidBill={null}
          tenantBills={paidBills}
          selectedBillId="b-hist-1"
          invoiceTab="history"
          setInvoiceTab={() => {}}
          onBack={() => {}}
          onGoToPayment={() => {}}
        />
      );

      // Initially b-hist-1 is expanded
      expect(screen.getByText(/ค่าน้ำ:/)).toBeDefined();

      // Click on b-hist-2 to expand it as well
      const b2Card = screen.getByTestId('history-bill-b-hist-2');
      const b2Btn = b2Card.querySelector('button')!;
      fireEvent.click(b2Btn);

      // Both b-hist-1 and b-hist-2 are now open simultaneously!
      expect(screen.getByText(/ค่าน้ำ:/)).toBeDefined();
      expect(screen.getByText(/ค่าเช่า \(รายเดือน\):/)).toBeDefined();
    });
  });
});
