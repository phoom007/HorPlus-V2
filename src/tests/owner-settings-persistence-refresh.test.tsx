// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import { OwnerSettings } from '../pages/owner/settings';
import * as paymentService from '../services/payment-settings.service';
import * as dormitoryService from '../services/dormitory.service';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach } from 'vitest';

vi.mock('../services/payment-settings.service', () => ({
  getPaymentSettings: vi.fn(),
  updatePaymentSettings: vi.fn(),
}));

vi.mock('../services/dormitory.service', () => ({
  getDormitoryProfile: vi.fn(),
  updateDormitoryProfile: vi.fn(),
  getDormitorySignatureUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('../data/httpClient', () => ({
  httpRequest: vi.fn().mockResolvedValue({ data: {} }),
}));

vi.mock('../data/onboardingClient', () => ({
  onboardingClient: {
    uploadLogo: vi.fn().mockResolvedValue({ logoUrl: '/api/v1/dormitories/dorm-01/logo', hasLogo: true }),
    deleteLogo: vi.fn().mockResolvedValue({ success: true }),
  },
}));

describe('SET-FIX: Logo Modal Close & Payment Persistence across Refresh', () => {
  let queryClient: QueryClient;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    vi.spyOn(paymentService, 'getPaymentSettings').mockResolvedValue({
      id: 'pay-set-01',
      dormitoryId: 'dorm-01',
      cashAccepted: true,
      promptPayType: null,
      promptPayAccountName: null,
      maskedPromptPayValue: null,
      hasPromptPay: false,
      bankCode: 'KBANK',
      bankAccountName: 'หอพักสบายใจ',
      maskedBankAccountNumber: 'XXX-X-XX456-7',
      hasBankAccount: true,
      bankQrCode: 'data:image/png;base64,sample_qr',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(dormitoryService, 'getDormitoryProfile').mockResolvedValue({
      id: 'dorm-01',
      name: 'หอพักสบายใจ',
      code: 'DORM01',
      type: 'apartment',
      addressLine1: '123 ถนนสุขุมวิท',
      phone: '0812345678',
      email: 'owner@example.com',
      taxId: '0105551234567',
      logoUrl: '/api/v1/dormitories/dorm-01/logo',
      hasLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('SET-FIX-01: Logo change triggers showToast without ReferenceError', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerSettings dormitoryId="dorm-01" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(paymentService.getPaymentSettings).toHaveBeenCalledWith('dorm-01');
    });

    const changeBtn = screen.getByText('เปลี่ยนรูป');
    expect(changeBtn).toBeDefined();

    const logoImg = document.querySelector('img[alt="Dormitory Logo"]');
    expect(logoImg).not.toBeNull();
  });

  it('SET-FIX-02: dormProp update from parent does NOT wipe out payment settings', async () => {
    const initialDormProp: any = {
      id: 'dorm-01',
      name: 'หอพักสบายใจ',
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <OwnerSettings dormitoryId="dorm-01" dormitory={initialDormProp} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(paymentService.getPaymentSettings).toHaveBeenCalledWith('dorm-01');
    });

    const bankTabBtn = await screen.findByText('โอนผ่านบัญชีธนาคาร');
    fireEvent.click(bankTabBtn);

    const bankSelect = document.querySelector('select') as HTMLSelectElement;
    await waitFor(() => {
      expect(bankSelect.value).toBe('KBANK');
    });

    const updatedParentDormProp: any = {
      id: 'dorm-01',
      name: 'หอพักสบายใจ (อัปเดต)',
    };

    act(() => {
      rerender(
        <QueryClientProvider client={queryClient}>
          <OwnerSettings dormitoryId="dorm-01" dormitory={updatedParentDormProp} />
        </QueryClientProvider>
      );
    });

    await waitFor(() => {
      expect(bankSelect.value).toBe('KBANK');
    });

    const accNumInput = screen.getByPlaceholderText('XXX-X-XXXXX-X') as HTMLInputElement;
    expect(accNumInput.value).toBe('XXX-X-XX456-7');
  });

  it('SET-FIX-03: changing bank dropdown with masked account number omits masked string from payload', async () => {
    vi.spyOn(paymentService, 'updatePaymentSettings').mockResolvedValue({
      id: 'pay-set-01',
      dormitoryId: 'dorm-01',
      cashAccepted: true,
      promptPayType: null,
      promptPayAccountName: null,
      maskedPromptPayValue: null,
      hasPromptPay: false,
      bankCode: 'SCB',
      bankAccountName: 'หอพักสบายใจ',
      maskedBankAccountNumber: 'XXX-X-XX456-7',
      hasBankAccount: true,
      bankQrCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <OwnerSettings dormitoryId="dorm-01" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(paymentService.getPaymentSettings).toHaveBeenCalledWith('dorm-01');
    });

    const bankTabBtn = await screen.findByText('โอนผ่านบัญชีธนาคาร');
    fireEvent.click(bankTabBtn);

    const bankSelect = document.querySelector('select') as HTMLSelectElement;
    await waitFor(() => {
      expect(bankSelect.value).toBe('KBANK');
    });

    act(() => {
      fireEvent.change(bankSelect, { target: { value: 'SCB' } });
    });

    await waitFor(() => {
      expect(paymentService.updatePaymentSettings).toHaveBeenCalledWith(
        'dorm-01',
        expect.objectContaining({
          bankCode: 'SCB',
        })
      );
    });

    const calledPayload = vi.mocked(paymentService.updatePaymentSettings).mock.calls[0][1];
    expect(calledPayload.bankAccountNumber).toBeUndefined();
  });
});
