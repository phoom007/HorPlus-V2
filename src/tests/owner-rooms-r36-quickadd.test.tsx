// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Owner Rooms R3.6a — Quick Add Live Financial Preview, Rendered Normalization, Production Error Shape & Cache Invalidation
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { QuickAddTenantModal, normalizeNumericString } from '../components/QuickAddTenantModal';
import { invalidateQuickAddTenantCaches } from '../lib/quickAddCache';
import { queryKeys } from '../lib/queryClient';
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

describe('HORPLUS R3.6a — Quick Add Live Financial Preview, Input Normalization, Error Transport & Cache Invalidation', () => {
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

  describe('Part H — Real Rendered Numeric Input Normalization Proof in UI', () => {
    it('normalizes leading zeros on blur and submits clean numeric payload in TERM mode', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();
      let capturedPayload: any = null;

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, _url, payload) => {
        capturedPayload = payload;
        return { success: true, data: { id: 'term-new-id' } };
      });

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
        expect(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeInTheDocument();
      });

      // Fill Name
      fireEvent.change(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'นายทดสอบ เทอม' } });

      // Find rent input and enter 01000
      const rentInput = ui.getByDisplayValue('19200') as HTMLInputElement;
      fireEvent.change(rentInput, { target: { value: '01000' } });
      fireEvent.blur(rentInput);
      expect(rentInput.value).toBe('1000');

      // Find deposit input and enter 01000
      const depInput = ui.getByDisplayValue('4800') as HTMLInputElement;
      fireEvent.change(depInput, { target: { value: '01000' } });
      fireEvent.blur(depInput);
      expect(depInput.value).toBe('1000');

      // Submit form
      const form = ui.getByTestId('quick-add-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalled();
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.unitRentAmount).toBe('1000.00');
      expect(capturedPayload.totalRentAmount).toBe('1000.00');
      expect(capturedPayload.depositAmount).toBe('1000.00');

      httpSpy.mockRestore();
    });

    it('normalizes leading zeros on blur and preserves decimal precision in MONTHLY mode', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();
      let capturedPayload: any = null;

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, _url, payload) => {
        capturedPayload = payload;
        return { success: true, data: { id: 'monthly-new-id' } };
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

      // Fill Name
      fireEvent.change(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'นายทดสอบ รายเดือน' } });

      // Find rent input and enter 001000.50
      const rentInputs = ui.getAllByDisplayValue('4800') as HTMLInputElement[];
      const rentInput = rentInputs[0];
      fireEvent.change(rentInput, { target: { value: '001000.50' } });
      fireEvent.blur(rentInput);
      expect(rentInput.value).toBe('1000.50');

      // Find deposit input and enter 01000
      const depInput = ui.getByDisplayValue('4800') as HTMLInputElement;
      fireEvent.change(depInput, { target: { value: '01000' } });
      fireEvent.blur(depInput);
      expect(depInput.value).toBe('1000');

      // Submit form
      const form = ui.getByTestId('quick-add-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalled();
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.unitRentAmount).toBe('1000.50');
      expect(capturedPayload.depositAmount).toBe('1000.00');

      httpSpy.mockRestore();
    });

    it('normalizes leading zeros on blur in DAILY mode', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();
      let capturedPayload: any = null;

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (_method, _url, payload) => {
        capturedPayload = payload;
        return { success: true, data: { id: 'daily-new-id' } };
      });

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

      await waitFor(() => {
        expect(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeInTheDocument();
      });

      // Fill Name
      fireEvent.change(ui.getByPlaceholderText('เช่น นายสมชาย ใจดี'), { target: { value: 'นายทดสอบ รายวัน' } });

      // Find daily rate input (500) and enter 01000
      const rateInput = ui.getByDisplayValue('500') as HTMLInputElement;
      fireEvent.change(rateInput, { target: { value: '01000' } });
      fireEvent.blur(rateInput);
      expect(rateInput.value).toBe('1000');

      // Find daily deposit input (300) and enter 01000
      const depInput = ui.getByDisplayValue('300') as HTMLInputElement;
      fireEvent.change(depInput, { target: { value: '01000' } });
      fireEvent.blur(depInput);
      expect(depInput.value).toBe('1000');

      // Submit form
      const form = ui.getByTestId('quick-add-form');
      fireEvent.submit(form);

      await waitFor(() => {
        expect(handleSuccess).toHaveBeenCalled();
      });

      expect(capturedPayload).not.toBeNull();
      expect(capturedPayload.dailyRateAmount).toBe('1000.00');
      expect(capturedPayload.depositAmount).toBe('1000.00');

      httpSpy.mockRestore();
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

  describe('Part D & G — Real Production Error Shape Transport & Actionable Domain Error Presentation', () => {
    it('correctly maps production-shaped CONFLICT + details.error.code to actionable Thai message without modal close', async () => {
      const handleClose = vi.fn();
      const handleSuccess = vi.fn();

      // Production httpClient error shape for HTTP 409
      const productionError = {
        domainError: {
          code: 'CONFLICT',
          message: 'ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า',
          details: {
            success: false,
            error: {
              code: 'DEPOSIT_BILLING_CYCLE_NOT_FOUND',
              message: 'ไม่พบรอบบิลที่ตรงกับวันเริ่มสัญญา กรุณาสร้างรอบบิลก่อนยืนยันการเช่า',
            },
          },
        },
      };

      const httpSpy = vi.spyOn(httpClient, 'httpRequest').mockRejectedValue(productionError);

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

  describe('Part B & E — Observable Success Lifecycle & Result Object', () => {
    it('closes modal and triggers success callback with result object on successful Quick Add', async () => {
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
        expect(handleSuccess).toHaveBeenCalledWith(
          'เพิ่มผู้เช่ารายเดือน (101) เรียบร้อยแล้ว',
          { rentalType: 'MONTHLY', roomId: 'room-101-uuid' }
        );
      });
      expect(handleClose).toHaveBeenCalled();

      httpSpy.mockRestore();
    });
  });

  describe('Part A & C — Dedicated Quick Add Cache Invalidation Coordinator', () => {
    it('invalidates rooms, tenants, bills, and preview-context without touching unrelated caches on TERM Quick Add', () => {
      const queryClient = new QueryClient();
      const dormId = 'dorm-001-uuid';

      // Preseed caches
      queryClient.setQueryData(queryKeys.rooms(dormId), [{ id: 'r-1' }]);
      queryClient.setQueryData(queryKeys.tenants(dormId), [{ id: 't-1' }]);
      queryClient.setQueryData(queryKeys.bills(dormId), [{ id: 'b-1' }]);
      queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, 'cycle-1'), { rooms: [] });
      queryClient.setQueryData(queryKeys.contracts(dormId), [{ id: 'c-1' }]);
      queryClient.setQueryData(queryKeys.dailyInvoices(dormId), [{ id: 'd-1' }]);
      queryClient.setQueryData(queryKeys.payments(dormId), [{ id: 'p-1' }]);

      // Execute TERM cache invalidation
      invalidateQuickAddTenantCaches(queryClient, dormId, { rentalType: 'TERM' });

      // Assert invalidated queries
      expect(queryClient.getQueryState(queryKeys.rooms(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.tenants(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.bills(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.meterPreviewContext(dormId, 'cycle-1'))?.isInvalidated).toBe(true);

      // Assert non-invalidated queries for TERM
      expect(queryClient.getQueryState(queryKeys.contracts(dormId))?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(queryKeys.dailyInvoices(dormId))?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(queryKeys.payments(dormId))?.isInvalidated).toBe(false);
    });

    it('invalidates traditional contracts query on MONTHLY Quick Add', () => {
      const queryClient = new QueryClient();
      const dormId = 'dorm-001-uuid';

      // Preseed caches
      queryClient.setQueryData(queryKeys.rooms(dormId), [{ id: 'r-1' }]);
      queryClient.setQueryData(queryKeys.tenants(dormId), [{ id: 't-1' }]);
      queryClient.setQueryData(queryKeys.bills(dormId), [{ id: 'b-1' }]);
      queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, 'cycle-1'), { rooms: [] });
      queryClient.setQueryData(queryKeys.contracts(dormId), [{ id: 'c-1' }]);

      // Execute MONTHLY cache invalidation
      invalidateQuickAddTenantCaches(queryClient, dormId, { rentalType: 'MONTHLY' });

      expect(queryClient.getQueryState(queryKeys.rooms(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.tenants(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.bills(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.meterPreviewContext(dormId, 'cycle-1'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.contracts(dormId))?.isInvalidated).toBe(true);
    });

    it('invalidates daily invoices and payments queries on DAILY Quick Add', () => {
      const queryClient = new QueryClient();
      const dormId = 'dorm-001-uuid';

      // Preseed caches
      queryClient.setQueryData(queryKeys.rooms(dormId), [{ id: 'r-1' }]);
      queryClient.setQueryData(queryKeys.tenants(dormId), [{ id: 't-1' }]);
      queryClient.setQueryData(queryKeys.bills(dormId), [{ id: 'b-1' }]);
      queryClient.setQueryData(queryKeys.meterPreviewContext(dormId, 'cycle-1'), { rooms: [] });
      queryClient.setQueryData(queryKeys.dailyInvoices(dormId), [{ id: 'd-1' }]);
      queryClient.setQueryData(queryKeys.payments(dormId), [{ id: 'p-1' }]);

      // Execute DAILY cache invalidation
      invalidateQuickAddTenantCaches(queryClient, dormId, { rentalType: 'DAILY' });

      expect(queryClient.getQueryState(queryKeys.rooms(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.tenants(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.bills(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.meterPreviewContext(dormId, 'cycle-1'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.dailyInvoices(dormId))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.payments(dormId))?.isInvalidated).toBe(true);
    });
  });
});
