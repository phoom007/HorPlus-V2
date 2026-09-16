// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OwnerSettings } from '../pages/owner/settings';
import * as paymentService from '../services/payment-settings.service';
import * as dormitoryService from '../services/dormitory.service';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

describe('Seam 4: Owner Settings Page Persistence & Dropdown Stability', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
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
      bankCode: 'SCB',
      bankAccountName: 'หอพักเพชรไพลิน',
      maskedBankAccountNumber: '123-4-56789-0',
      hasBankAccount: true,
      bankQrCode: 'data:image/png;base64,existing_qr_data',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    vi.spyOn(dormitoryService, 'getDormitoryProfile').mockResolvedValue({
      id: 'dorm-01',
      name: 'หอพักเพชรไพลิน',
      code: 'DORM01',
      type: 'apartment',
      addressLine1: '99/1 ซอย 5 ถนนสุขุมวิท',
      phone: '0812345678',
      email: 'owner@example.com',
      taxId: '0105551234567',
      logoUrl: '/api/v1/dormitories/dorm-01/logo',
      hasLogo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  it('correctly matches and selects canonical bank code SCB and keeps account fields interactive', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerSettings dormitoryId="dorm-01" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(paymentService.getPaymentSettings).toHaveBeenCalledWith('dorm-01');
    });

    // Switch to Bank Transfer tab
    const bankTabBtn = await screen.findByText('โอนผ่านบัญชีธนาคาร');
    fireEvent.click(bankTabBtn);

    // Find the select element for bank
    const bankSelect = await waitFor(() => {
      const el = document.querySelector('select');
      expect(el).not.toBeNull();
      return el as HTMLSelectElement;
    });
    expect(bankSelect).toBeDefined();

    // Verify bank code value matches SCB, NOT empty string
    await waitFor(() => {
      expect(bankSelect.value).toBe('SCB');
    });

    // Verify account number input is enabled
    const accNumInput = screen.getByPlaceholderText('XXX-X-XXXXX-X') as HTMLInputElement;
    expect(accNumInput).not.toBeNull();
    expect(accNumInput.disabled).toBe(false);

    // Verify account name input is enabled
    const accNameInput = screen.getByPlaceholderText('ชื่อบัญชีธนาคารผู้รับเงิน') as HTMLInputElement;
    expect(accNameInput).not.toBeNull();
    expect(accNameInput.disabled).toBe(false);
  });

  it('persists address changes to authoritative updateDormitoryProfile without mockData collision', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OwnerSettings dormitoryId="dorm-01" />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(dormitoryService.getDormitoryProfile).toHaveBeenCalledWith('dorm-01');
    });

    const addressTextarea = await waitFor(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(addressTextarea).not.toBeNull();

    // Type a new address and blur
    const newAddress = '111/222 ถนนพหลโยธิน แขวงลาดยาว เขตจตุจักร กรุงเทพฯ 10900';
    fireEvent.change(addressTextarea, { target: { value: newAddress } });
    fireEvent.blur(addressTextarea, { target: { value: newAddress } });

    await waitFor(() => {
      expect(dormitoryService.updateDormitoryProfile).toHaveBeenCalledWith('dorm-01', {
        addressLine1: newAddress,
      });
    });
  });
});
