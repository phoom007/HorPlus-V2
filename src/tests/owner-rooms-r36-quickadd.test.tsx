/**
 * @license Apache-2.0
 * Owner Rooms R3.6 — Quick Add Live Financial Preview, Normalization, Term Default & Actionable Errors
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QuickAddTenantModal, normalizeNumericString } from '../components/QuickAddTenantModal';
import { QuickAddRoomContext } from '../types';
import * as httpClient from '../data/httpClient';

vi.mock('../data/adapters/task009', () => ({
  Task009ApiAdapter: {
    getLineOaConfig: vi.fn().mockResolvedValue({
      success: true,
      data: {
        isReady: false,
        connected: false,
      },
    }),
  },
}));

describe('HORPLUS R3.6 — Quick Add Live Financial Preview, Input Normalization & Actionable Error Tests', () => {
  const mockContext: QuickAddRoomContext = {
    roomId: 'room-101-uuid',
    roomNumber: '101',
    dormitoryId: 'dorm-001-uuid',
    roomType: 'Standard Room',
    floor: 1,
    effective: {
      monthlyRent: 4800,
      termRent: 19200,
      dailyRent: 500,
      monthlyDeposit: 4800,
      termDeposit: 4800,
      dailyDeposit: 300,
      depositAmount: 4800,
    },
    building: {
      id: 'bld-001',
      name: 'Building Alpha',
      termMonths: 4,
      maxTermRentInstallments: 3,
    },
    currentCatalogRates: [
      { type: 'water', price: 18, unit: 'unit' },
      { type: 'electric', price: 7, unit: 'unit' },
    ],
  };

  beforeAll(() => {
    if (typeof window !== 'undefined') {
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      window.URL.revokeObjectURL = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('Part B — Numeric Input Normalization Helper', () => {
    it('normalizes integer inputs with leading zeros', () => {
      expect(normalizeNumericString('01000')).toBe('1000');
      expect(normalizeNumericString('0004800')).toBe('4800');
      expect(normalizeNumericString('000')).toBe('0');
      expect(normalizeNumericString('0')).toBe('0');
      expect(normalizeNumericString('')).toBe('');
      expect(normalizeNumericString(null)).toBe('');
      expect(normalizeNumericString(undefined)).toBe('');
    });

    it('preserves valid decimal representations without stripping precision', () => {
      expect(normalizeNumericString('001000.50')).toBe('1000.50');
      expect(normalizeNumericString('0.75')).toBe('0.75');
      expect(normalizeNumericString('000.25')).toBe('0.25');
      expect(normalizeNumericString('4800.00')).toBe('4800.00');
    });
  });

  describe('Part C & A — TERM Tab: Default Installment = 1 & Live Financial Preview', () => {
    it('defaults term installment count to 1 when opened, but provides building-configured options', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="TERM"
        />
      );

      const ui = within(container);
      await waitFor(() => {
        const select = ui.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('1');
        const options = Array.from(select.options).map((o) => o.value);
        expect(options).toEqual(['1', '2', '3']);
      });
    });

    it('recalculates live financial preview on deposit UNPAID vs PAID without altering contractual total', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="TERM"
        />
      );

      const ui = within(container);
      await waitFor(() => {
        expect(ui.getByRole('combobox')).toBeInTheDocument();
      });

      // Select 2 installments
      const select = ui.getByRole('combobox') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '2' } });

      // Default state is UNPAID:
      expect(ui.getByText('ยอดตามข้อตกลง:')).toBeInTheDocument();
      expect(ui.getAllByText(/24,000/).length).toBeGreaterThanOrEqual(1);
      expect(ui.getByText('ยอดชำระแล้ว:')).toBeInTheDocument();
      expect(ui.getAllByText(/0.00/).length).toBeGreaterThanOrEqual(1);
      expect(ui.getByText('ยอดค้างชำระคงเหลือ:')).toBeInTheDocument();

      // First payment due (Installment 1: 9,600 + Deposit: 4,800 = 14,400)
      expect(ui.getByText('ยอดที่ต้องชำระในงวดแรก:')).toBeInTheDocument();
      expect(ui.getByText(/14,400/)).toBeInTheDocument();

      // Toggle deposit status to PAID ('ชำระแล้ว')
      const paidBtn = ui.getByRole('button', { name: 'ชำระแล้ว' });
      fireEvent.click(paidBtn);

      // Contractual total MUST remain unchanged (฿24,000.00)
      expect(ui.getAllByText(/24,000/).length).toBeGreaterThanOrEqual(1);

      // Amount paid becomes deposit amount (฿4,800.00)
      expect(ui.getAllByText(/4,800/).length).toBeGreaterThanOrEqual(1);

      // Amount outstanding becomes ฿19,200.00 (rent total)
      expect(ui.getAllByText(/19,200/).length).toBeGreaterThanOrEqual(1);

      // First payment due excludes already-paid deposit (Rent Installment 1 = ฿9,600.00)
      expect(ui.getAllByText(/9,600/).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Part A — MONTHLY Tab: Live Financial Preview', () => {
    it('updates live financial preview on UNPAID vs PAID for monthly tenant', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="MONTHLY"
        />
      );

      const ui = within(container);

      // Default: Rent 4800, Deposit 4800, UNPAID -> Total Agreed: 9600, Paid: 0, Outstanding: 9600
      await waitFor(() => {
        expect(ui.getByText('ยอดตามข้อตกลง:')).toBeInTheDocument();
        expect(ui.getAllByText(/9,600/).length).toBeGreaterThanOrEqual(2);
        expect(ui.getAllByText(/0.00/).length).toBeGreaterThanOrEqual(1);
      });

      // Toggle to PAID
      const paidBtn = ui.getByRole('button', { name: 'ชำระแล้ว' });
      fireEvent.click(paidBtn);

      // Contractual Total remains ฿9,600.00
      await waitFor(() => {
        expect(ui.getAllByText(/9,600/).length).toBeGreaterThanOrEqual(1);
        expect(ui.getAllByText(/4,800/).length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('Part A — DAILY Tab: Live Financial Preview', () => {
    it('updates live financial preview on UNPAID vs PAID for daily tenant', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="DAILY"
        />
      );

      const ui = within(container);

      // Default: 1 day @ 500, Deposit 300 -> Total Agreed: 800, Paid: 0, Outstanding: 800
      await waitFor(() => {
        expect(ui.getByText('ยอดตามข้อตกลง:')).toBeInTheDocument();
        expect(ui.getAllByText(/800/).length).toBeGreaterThanOrEqual(2);
        expect(ui.getAllByText(/0.00/).length).toBeGreaterThanOrEqual(1);
      });

      // Toggle to PAID
      const paidBtn = ui.getByRole('button', { name: 'ชำระแล้ว' });
      fireEvent.click(paidBtn);

      // Total agreed remains ฿800.00, Paid is ฿300.00, Outstanding is ฿500.00
      await waitFor(() => {
        expect(ui.getAllByText(/800/).length).toBeGreaterThanOrEqual(1);
        expect(ui.getAllByText(/300/).length).toBeGreaterThanOrEqual(1);
        expect(ui.getAllByText(/500/).length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe('Part D — Actionable Domain Error Presentation', () => {
    it('displays specific Thai domain error message and preserves form values on DEPOSIT_BILLING_CYCLE_NOT_FOUND', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockRejectedValue({
        domainError: {
          code: 'DEPOSIT_BILLING_CYCLE_NOT_FOUND',
          message: 'ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า',
        },
        message: 'ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า',
      });

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="MONTHLY"
        />
      );

      const ui = within(container);

      await waitFor(() => {
        expect(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeInTheDocument();
      });

      const nameInput = ui.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'นายทดสอบ ข้อผิดพลาด' } });

      const form = ui.getByTestId('quick-add-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(ui.getByText('ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า')).toBeInTheDocument();
      });

      expect(ui.queryByText('ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่อีกครั้ง')).not.toBeInTheDocument();
      expect(handleClose).not.toHaveBeenCalled();
      expect((ui.getByPlaceholderText('เช่น นายสมชาย ใจดี') as HTMLInputElement).value).toBe('นายทดสอบ ข้อผิดพลาด');

      const submitBtn = ui.getByRole('button', { name: /ยืนยันเพิ่มผู้เช่า/i });
      expect(submitBtn).not.toBeDisabled();

      httpSpy.mockRestore();
    });
  });

  describe('Part E — Observable Success Lifecycle', () => {
    it('closes modal and triggers success callback on successful Quick Add', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async () => {
        return {
          success: true,
          data: { id: 'monthly-new-id' },
        };
      });

      const { container } = render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={handleClose}
          context={mockContext}
          onSuccess={handleSuccess}
          defaultTab="MONTHLY"
        />
      );

      const ui = within(container);

      await waitFor(() => {
        expect(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeInTheDocument();
      });

      const nameInput = ui.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'นายสมศักดิ์ สำเร็จ' } });

      const form = ui.getByTestId('quick-add-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalledWith('เพิ่มผู้เช่ารายเดือน (101) เรียบร้อยแล้ว');
      });
      expect(handleClose).toHaveBeenCalled();

      httpSpy.mockRestore();
    });
  });
});
