// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';

describe('Round 2.4K.2A: QuickAddTenantModal Daily Payment Authority', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes('/billing-cycles')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            data: [
              {
                id: 'cycle-1',
                cycleCode: '2026-08',
                name: 'สิงหาคม 2569',
                status: 'open',
                periodStart: '2026-08-01',
                periodEnd: '2026-08-31',
              },
            ],
          }),
          text: async () => JSON.stringify({ success: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderModal = () => {
    const context = {
      roomId: 'room-101',
      roomNumber: '101',
      dormitoryId: 'dorm-1',
      suggestedCycleId: 'cycle-1',
    };

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    const result = render(
      <QueryClientProvider client={queryClient}>
        <QuickAddTenantModal
          isOpen={true}
          onClose={onClose}
          onSuccess={onSuccess}
          context={context}
        />
      </QueryClientProvider>
    );

    return { ...result, onSuccess, onClose };
  };

  it('1. Switches to Daily tab and verifies payment method defaults to empty', async () => {
    renderModal();

    const dailyTabBtn = screen.getByRole('button', { name: /รายวัน/ });
    fireEvent.click(dailyTabBtn);

    expect(screen.queryByText(/วิธีชำระเงินประกัน/)).toBeNull();
  });

  it('2. When deposit > 0 and status is PAID, shows CASH and BANK_TRANSFER buttons defaulting to unselected', async () => {
    renderModal();

    const dailyTabBtn = screen.getByRole('button', { name: /รายวัน/ });
    fireEvent.click(dailyTabBtn);

    const depositLabel = screen.getByText('เงินประกัน/มัดจำ (บาท)');
    const depositInput = depositLabel.parentElement!.querySelector('input')!;
    fireEvent.change(depositInput, { target: { value: '500' } });

    const paidToggleBtn = screen.getByRole('button', { name: 'ชำระแล้ว' });
    fireEvent.click(paidToggleBtn);

    expect(screen.getAllByText(/วิธีชำระเงินประกัน/)[0]).toBeDefined();
    const cashBtn = screen.getByRole('button', { name: 'เงินสด' });
    const transferBtn = screen.getByRole('button', { name: 'โอนเงิน' });
    expect(cashBtn).toBeDefined();
    expect(transferBtn).toBeDefined();

    expect(screen.getByText('* กรุณาระบุวิธีชำระเงินประกัน (เงินสด หรือ โอนเงิน)')).toBeDefined();
    expect(cashBtn.className).not.toContain('bg-indigo-600 text-white');
    expect(transferBtn.className).not.toContain('bg-indigo-600 text-white');
  });

  it('3. Selecting CASH / BANK_TRANSFER updates selection and hides warning', async () => {
    renderModal();

    const dailyTabBtn = screen.getByRole('button', { name: /รายวัน/ });
    fireEvent.click(dailyTabBtn);

    const depositLabel = screen.getByText('เงินประกัน/มัดจำ (บาท)');
    const depositInput = depositLabel.parentElement!.querySelector('input')!;
    fireEvent.change(depositInput, { target: { value: '500' } });

    const paidToggleBtn = screen.getByRole('button', { name: 'ชำระแล้ว' });
    fireEvent.click(paidToggleBtn);

    const cashBtn = screen.getByRole('button', { name: 'เงินสด' });
    fireEvent.click(cashBtn);

    expect(cashBtn.className).toContain('bg-indigo-600 text-white');
    expect(screen.queryByText('* กรุณาระบุวิธีชำระเงินประกัน (เงินสด หรือ โอนเงิน)')).toBeNull();

    const transferBtn = screen.getByRole('button', { name: 'โอนเงิน' });
    fireEvent.click(transferBtn);
    expect(transferBtn.className).toContain('bg-indigo-600 text-white');
    expect(cashBtn.className).not.toContain('bg-indigo-600 text-white');
  });

  it('4. Toggling back to UNPAID resets payment method selection', async () => {
    renderModal();

    const dailyTabBtn = screen.getByRole('button', { name: /รายวัน/ });
    fireEvent.click(dailyTabBtn);

    const depositLabel = screen.getByText('เงินประกัน/มัดจำ (บาท)');
    const depositInput = depositLabel.parentElement!.querySelector('input')!;
    fireEvent.change(depositInput, { target: { value: '500' } });

    const paidToggleBtn = screen.getByRole('button', { name: 'ชำระแล้ว' });
    fireEvent.click(paidToggleBtn);

    const cashBtn = screen.getByRole('button', { name: 'เงินสด' });
    fireEvent.click(cashBtn);
    expect(cashBtn.className).toContain('bg-indigo-600 text-white');

    const unpaidToggleBtn = screen.getByRole('button', { name: 'รอชำระ' });
    fireEvent.click(unpaidToggleBtn);

    expect(screen.queryByText(/วิธีชำระเงินประกัน/)).toBeNull();

    fireEvent.click(paidToggleBtn);
    expect(screen.getByText('* กรุณาระบุวิธีชำระเงินประกัน (เงินสด หรือ โอนเงิน)')).toBeDefined();
    const cashBtnNew = screen.getByRole('button', { name: 'เงินสด' });
    expect(cashBtnNew.className).not.toContain('bg-indigo-600 text-white');
  });
});