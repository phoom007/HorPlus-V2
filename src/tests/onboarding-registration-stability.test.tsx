// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OwnerRegister } from '../pages/owner/register';
import { OwnerSettings } from '../pages/owner/settings';
import { BankQrCodeUploader } from '../components/settings/BankQrCodeUploader';
import { sanitizeDraftForStorage } from '../utils/localDraftStorage';
import { onboardingClient } from '../data/onboardingClient';
import * as localDraftStorage from '../utils/localDraftStorage';
import * as billingSettingsService from '../services/billing-settings.service';
import * as paymentSettingsService from '../services/payment-settings.service';
import * as dormitoryService from '../services/dormitory.service';

describe('Onboarding Registration Stability & UI Parity (SPEC-ORS-01)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    const createStorage = () => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] || null,
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { store = {}; },
        get length() { return Object.keys(store).length; },
        key: (i: number) => Object.keys(store)[i] || null,
      };
    };
    if (typeof window !== 'undefined') {
      try { Object.defineProperty(window, 'localStorage', { value: createStorage(), configurable: true, writable: true }); } catch {}
      try { Object.defineProperty(window, 'sessionStorage', { value: createStorage(), configurable: true, writable: true }); } catch {}
    }
    try { sessionStorage.clear(); } catch {}
    try { localStorage.clear(); } catch {}

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockcanvasdata');
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
    } as any);

    vi.spyOn(onboardingClient, 'prepare').mockResolvedValue({
      success: true,
      data: { provisionalDormitoryId: 'prov-mock-ors' },
    } as any);
    vi.spyOn(onboardingClient, 'getPackages').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(onboardingClient, 'getCoinWallet').mockResolvedValue({ success: true, data: { balance: 0 } } as any);
    vi.spyOn(onboardingClient, 'getSubscriptionQuote').mockResolvedValue({
      success: true,
      data: { intentId: 'intent-mock', dormitoryId: 'prov-mock-ors' },
    } as any);
    vi.spyOn(onboardingClient, 'uploadSignature').mockResolvedValue({
      success: true,
      data: { url: 'https://storage.example.com/signatures/mock.png' },
    } as any);
    vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Bank Account Name & QR Code Disabled State Parity in Registration (ORS-04)', () => {
    it('disables bank account number, name, and QR code uploader when bank is unselected', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Step 1 -> Step 2
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพักสเตบิลิตี้' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '123 สุขุมวิท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2 -> Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 3 -> Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());

      const bankSelect = screen.getByTestId('select-payment-bank-name') as HTMLSelectElement;
      expect(bankSelect.value).toBe('');

      // When bankName is empty, both account number and account name MUST be disabled
      const accNumberInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
      const accNameInput = screen.getByTestId('input-payment-account-name') as HTMLInputElement;
      const qrUploadBtn = screen.getByTestId('btn-bank-qr-upload') as HTMLButtonElement;

      expect(accNumberInput.disabled).toBe(true);
      expect(accNumberInput.placeholder).toBe('กรุณาเลือกธนาคารก่อน');

      expect(accNameInput.disabled).toBe(true);
      expect(accNameInput.placeholder).toBe('กรุณาเลือกธนาคารก่อน');

      expect(qrUploadBtn.disabled).toBe(true);
      expect(qrUploadBtn.className).toContain('cursor-not-allowed');
    });

    it('enables all 3 fields when a bank is selected, and retains values if bank is deselected (PO Decision A1)', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Fast forward to Step 4
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพักสเตบิลิตี้' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '123 สุขุมวิท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());

      const bankSelect = screen.getByTestId('select-payment-bank-name');
      fireEvent.change(bankSelect, { target: { value: 'กสิกรไทย (KBank)' } });

      const accNumberInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
      const accNameInput = screen.getByTestId('input-payment-account-name') as HTMLInputElement;
      const qrUploadBtn = screen.getByTestId('btn-bank-qr-upload') as HTMLButtonElement;

      expect(accNumberInput.disabled).toBe(false);
      expect(accNameInput.disabled).toBe(false);
      expect(qrUploadBtn.disabled).toBe(false);

      // Enter values
      fireEvent.change(accNumberInput, { target: { value: '1234567890' } });
      fireEvent.change(accNameInput, { target: { value: 'นายทดสอบ บัญชี' } });

      expect(accNumberInput.value).toBe('123-4-56789-0');
      expect(accNameInput.value).toBe('นายทดสอบ บัญชี');

      // Now deselect bank back to empty string
      fireEvent.change(bankSelect, { target: { value: '' } });

      // Fields should be disabled, BUT values MUST be preserved (not wiped) per PO Decision A1
      expect(accNumberInput.disabled).toBe(true);
      expect(accNameInput.disabled).toBe(true);
      expect(qrUploadBtn.disabled).toBe(true);

      expect(accNumberInput.value).toBe('123-4-56789-0');
      expect(accNameInput.value).toBe('นายทดสอบ บัญชี');
    });
  });

  describe('2. Bank Account Name & QR Code Disabled State in Owner Settings (ORS-04)', () => {
    it('disables bank account name and QR code uploader in Settings when bank is empty, preserving values', async () => {
      const mockDorm = {
        id: 'dorm-settings-mock',
        name: 'หอพักตั้งค่า',
        address: '999 ถนนเพชรเกษม',
        bankName: '',
        bankAccountNumber: '',
        bankAccountName: 'ชื่อเดิมที่เคยกรอก',
        bankQrCode: '',
        promptPayNumber: '',
        promptPayName: '',
      };

      vi.spyOn(dormitoryService, 'getDormitoryProfile').mockResolvedValue({ success: true, data: mockDorm } as any);
      vi.spyOn(dormitoryService, 'getDormitorySignatureUrl').mockResolvedValue('https://storage.example.com/sig.png');
      vi.spyOn(billingSettingsService, 'getBillingSettings').mockResolvedValue({ success: true, data: {} } as any);
      vi.spyOn(paymentSettingsService, 'getPaymentSettings').mockResolvedValue({
        success: true,
        data: {
          bankCode: '',
          bankAccountName: 'ชื่อเดิมที่เคยกรอก',
          bankAccountNumber: '',
          bankQrCode: '',
          promptPayType: 'phone',
          promptPayValue: '',
        },
      } as any);

      render(<OwnerSettings dormitory={mockDorm as any} onAddLog={vi.fn()} />);

      // Switch to payment tab
      const paymentTabBtn = screen.getByText('โอนผ่านบัญชีธนาคาร');
      fireEvent.click(paymentTabBtn);

      const disabledInputs = screen.getAllByPlaceholderText('กรุณาเลือกธนาคารก่อน') as HTMLInputElement[];
      expect(disabledInputs.length).toBeGreaterThanOrEqual(2);
      const bankAccNameInput = disabledInputs.find(i => i.value === 'ชื่อเดิมที่เคยกรอก') || disabledInputs[1];
      expect(bankAccNameInput).toBeDefined();
      expect(bankAccNameInput.disabled).toBe(true);
      expect(bankAccNameInput.value).toBe('ชื่อเดิมที่เคยกรอก');

      const qrUploadBtn = screen.getByTestId('btn-bank-qr-upload') as HTMLButtonElement;
      expect(qrUploadBtn.disabled).toBe(true);
      expect(qrUploadBtn.className).toContain('cursor-not-allowed');
    });
  });

  describe('3. Step 5 Electronic Signature Persistence in Draft Storage (ORS-05)', () => {
    it('preserves data URL signature in sanitizeDraftForStorage without wiping', () => {
      const mockSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAUAAAABeCAYAAACz';
      const draft = {
        currentStep: 5,
        formData: {
          dormName: 'หอพักสุขุมวิท',
          ownerSignatureUrl: mockSignature,
          lineOA: {
            channelId: '123456',
            channelSecret: 'secret-must-be-stripped',
          },
        },
        ownerSignatureUrl: mockSignature,
      };

      const sanitized = sanitizeDraftForStorage(draft);

      // Invariant: channelSecret MUST be stripped
      expect(sanitized.formData.lineOA.channelSecret).toBe('');

      // CRITICAL ORS-05: ownerSignatureUrl MUST NOT be wiped!
      expect(sanitized.formData.ownerSignatureUrl).toBe(mockSignature);
      expect(sanitized.ownerSignatureUrl).toBe(mockSignature);
    });
  });
});
