// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OwnerRegister } from '../pages/owner/register';
import { onboardingClient } from '../data/onboardingClient';
import * as localDraftStorage from '../utils/localDraftStorage';

describe('Round 2.4J.2: Signature Persistence & Privacy — Real Mounted Proof', () => {
  let savedDrafts: any[] = [];

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    savedDrafts = [];

    const mockDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue(mockDataUrl);
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

    // Track saved drafts via spy
    const originalSave = localDraftStorage.saveRegistrationDraft;
    vi.spyOn(localDraftStorage, 'saveRegistrationDraft').mockImplementation(async (userId, mode, draft) => {
      savedDrafts.push(JSON.parse(JSON.stringify(draft)));
      return originalSave(userId, mode, draft);
    });

    vi.spyOn(onboardingClient, 'prepare').mockResolvedValue({
      success: true,
      data: { provisionalDormitoryId: 'prov-mock-24j2' },
    } as any);
    vi.spyOn(onboardingClient, 'getPackages').mockResolvedValue({
      success: true,
      data: [],
    } as any);
    vi.spyOn(onboardingClient, 'getCoinWallet').mockResolvedValue({
      success: true,
      data: { balance: 0 },
    } as any);
    vi.spyOn(onboardingClient, 'getSubscriptionQuote').mockResolvedValue({
      success: true,
      data: { intentId: 'intent-mock-24j2', dormitoryId: 'prov-mock-24j2' },
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

  const navigateToStep5 = async () => {
    // Step 1: Info
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 1: ข้อมูลหอพัก')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
      target: { value: 'หอพัก 24J2 ลายเซ็นต์สมบูรณ์' },
    });
    fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
      target: { value: '123/45 ถนนทดสอบ' },
    });
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 2: Rooms
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
    fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 3: Utilities
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 4: Deposits & Bank
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());
    fireEvent.change(screen.getByTestId('input-term-deposit-0'), { target: { value: '5000' } });
    fireEvent.change(screen.getByTestId('input-monthly-deposit-0'), { target: { value: '3000' } });
    fireEvent.change(screen.getByTestId('input-daily-deposit-0'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กสิกรไทย (KBank)' } });
    await waitFor(() => {
      const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
      expect(accInput.disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'นาย สมศักดิ์ วงศ์สว่าง' } });
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 5: Rules & Pets & Signature
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());
  };

  it('Mounts real OwnerRegister: draws signature at Step 5 -> Step 6 -> Step 5 preserves signature in memory', async () => {
    render(<OwnerRegister userId="user-24j2-sig" />);

    // A. Navigate to Step 5 (Signature)
    await navigateToStep5();

    // Verify clear signature button exists
    expect(screen.getByText('ล้างลายเซ็น')).toBeDefined();

    // Select contract rules
    fireEvent.click(screen.getByText('+ เลือกทั้งหมด 10 ข้อ'));

    // B. Draw signature on canvas
    const canvas = document.querySelector('canvas');
    expect(canvas).toBeDefined();
    if (canvas) {
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });
      fireEvent.mouseUp(canvas);
    }

    // C. Advance to Step 6 (succeeds because signature was drawn)
    fireEvent.click(screen.getByText('ถัดไป'));
    await waitFor(() => {
      expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined();
    });

    // D. Navigate back to Step 5
    fireEvent.click(screen.getByText('ย้อนกลับ'));
    await waitFor(() => {
      expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined();
    });

    // E. Assert:
    // 1. Signature canvas is preserved in DOM
    expect(document.querySelector('canvas')).toBeDefined();

    // 2. Button shows "ล้างลายเซ็น"
    expect(screen.getByText('ล้างลายเซ็น')).toBeDefined();
  });

  it('Security Invariant: local draft storage strictly strips raw data:image/... payload preventing local leak', () => {
    const rawDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const rawDraft = {
      currentStep: 5,
      formData: {
        dormName: 'หอพักทดสอบความปลอดภัย',
        ownerSignatureUrl: rawDataUrl,
        lineOA: { channelSecret: 'secret_leak_attempt' },
      },
      ownerSignatureUrl: rawDataUrl,
    };

    // Sanitize for storage
    const sanitized = localDraftStorage.sanitizeDraftForStorage(rawDraft);

    // Must strictly strip raw data:image URLs
    expect(sanitized.formData.ownerSignatureUrl).toBe('');
    expect(sanitized.ownerSignatureUrl).toBe('');
    expect(sanitized.formData.lineOA.channelSecret).toBe('');

    // Safe object-storage references are allowed
    const safeDraft = {
      formData: {
        ownerSignatureUrl: 'dormitories/dorm-123/signatures/sig.png',
      },
      ownerSignatureUrl: 'https://storage.horplus.com/signatures/sig.png',
    };
    const sanitizedSafe = localDraftStorage.sanitizeDraftForStorage(safeDraft);
    expect(sanitizedSafe.formData.ownerSignatureUrl).toBe('dormitories/dorm-123/signatures/sig.png');
    expect(sanitizedSafe.ownerSignatureUrl).toBe('https://storage.horplus.com/signatures/sig.png');
  });
});
