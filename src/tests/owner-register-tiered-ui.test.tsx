// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { OwnerRegister, mapRegisterUtilityMode } from '../pages/owner/register';
import { onboardingClient } from '../data/onboardingClient';
import * as localDraftStorage from '../utils/localDraftStorage';
import {
  WATER_TIER_PRESET,
  ELECTRICITY_TIER_PRESET,
  CanonicalTierRecord,
  normalizeToCanonicalDecimal,
  normalizeCanonicalTiers,
} from '../components/settings/TieredRateEditor';

describe('OWNER R3.9-D.2.1: Register Tier Canonicalization, Draft Round-Trip & Inactive Config Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mocksignature');
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    } as any);

    vi.spyOn(onboardingClient, 'prepare').mockResolvedValue({
      success: true,
      data: { provisionalDormitoryId: 'prov-mock-123' },
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
      data: { intentId: 'intent-mock-123', dormitoryId: 'prov-mock-123' },
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

  const fillStep1 = () => {
    fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
      target: { value: 'หอพักทดสอบ D2' },
    });
    fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
      target: { value: '123/45 ถนนทดสอบ' },
    });
    fireEvent.click(screen.getByText('ถัดไป'));
  };

  const fillStep2 = async () => {
    await waitFor(() => {
      expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined();
    });
    fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });
    fireEvent.click(screen.getByText('ถัดไป'));
  };

  const advanceThroughSteps = async () => {
    // Step 4: Deposits & Bank
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());
    fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กสิกรไทย (KBank)' } });
    await waitFor(() => {
      const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
      expect(accInput.disabled).toBe(false);
    });
    fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '1234567890' } });
    fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'นาย สมศักดิ์ วงศ์สว่าง' } });
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 5: Rules & Pets
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());
    fireEvent.click(screen.getByText('+ เลือกทั้งหมด 10 ข้อ'));
    // Save signature
    fireEvent.click(screen.getByText('บันทึก'));
    await waitFor(() => expect(screen.getByText('บันทึกลายเซ็นเรียบร้อยแล้ว!')).toBeDefined());
    fireEvent.click(screen.getByText('ถัดไป'));

    // Step 6: LINE OA
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined());
    fireEvent.click(screen.getByText('ตั้งค่าภายหลัง'));

    // Step 7: Plan & Finalize
    await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 7: เลือกแพ็กเกจและยืนยันการเปิดใช้งาน')).toBeDefined());
    fireEvent.click(screen.getByText('HorPlus FREE'));
    fireEvent.click(screen.getByText('ยืนยันสร้างหอพัก'));

    // In Terms Modal: select referral source & accept terms
    await waitFor(() => expect(screen.getByText('เงื่อนไข & ช่องทางที่รู้จัก')).toBeDefined());
    fireEvent.click(screen.getByText('Facebook / โซเชียล'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('ยอมรับเงื่อนไข'));
  };

  describe('1. Mode Mapping Authority (mapRegisterUtilityMode)', () => {
    it('Maps Register modes to canonical backend utility types', () => {
      expect(mapRegisterUtilityMode('unit')).toBe('per_unit');
      expect(mapRegisterUtilityMode('person')).toBe('per_person');
      expect(mapRegisterUtilityMode('room')).toBe('flat_rate');
      expect(mapRegisterUtilityMode('tiered')).toBe('tiered');
      expect(mapRegisterUtilityMode('unknown')).toBe('flat_rate');
    });
  });

  describe('2. Canonical Tier Decimal Safety & Normalizers', () => {
    it('Deterministic string decimal normalization works without floating point drift', () => {
      expect(normalizeToCanonicalDecimal('3')).toBe('3.00');
      expect(normalizeToCanonicalDecimal('3.4')).toBe('3.40');
      expect(normalizeToCanonicalDecimal('3.40')).toBe('3.40');
      expect(normalizeToCanonicalDecimal('0')).toBe('0.00');
      expect(normalizeToCanonicalDecimal('10')).toBe('10.00');
      expect(normalizeToCanonicalDecimal('10.0')).toBe('10.00');
      expect(normalizeToCanonicalDecimal('10.00')).toBe('10.00');
    });

    it('normalizeCanonicalTiers converts raw valid tiers to exact 2-decimal canonical records', () => {
      const raw = [
        { upTo: '10', rate: '3.4' },
        { upTo: '20', rate: '4.25' },
        { upTo: null, rate: '5' },
      ];
      const result = normalizeCanonicalTiers(raw);
      expect(result).toEqual([
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);
    });
  });

  describe('3. Step 3 Tiered Selection, Inactive Scalar, & Review Enforcement', () => {
    it('Selecting Water Tiered renders TieredRateEditor with disabled scalar input and blocks advancing until reviewed', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      const waterSelect = screen.getByTestId('select-register-water-mode') as HTMLSelectElement;
      expect(waterSelect.value).toBe('person');

      fireEvent.change(waterSelect, { target: { value: 'tiered' } });

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      const waterRateInput = screen.getByTestId('input-register-water-rate') as HTMLInputElement;
      expect(waterRateInput.disabled).toBe(true);
      expect(waterRateInput.value).toBe('คิดตามขั้นบันได');

      expect(screen.getByTestId('input-tier-rate-water-0')).toBeDefined();
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');

      fireEvent.click(screen.getByText('ถัดไป'));

      expect(screen.getByText('กรุณาตรวจสอบและบันทึกอัตราค่าน้ำแบบขั้นบันได')).toBeDefined();
      expect(screen.queryByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeNull();

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined();
      });
    });

    it('Editing any Tier field after review resets reviewed state and blocks advancing until saved again', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '19.50' } });

      expect(screen.queryByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeNull();

      fireEvent.click(screen.getByText('ถัดไป'));
      expect(screen.getByText('กรุณาตรวจสอบและบันทึกอัตราค่าน้ำแบบขั้นบันได')).toBeDefined();

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      fireEvent.click(screen.getByText('ถัดไป'));
      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined();
      });
    });
  });

  describe('4. Finalize Payload Authority & Canonical Formatting Proof', () => {
    it('Water raw entry (10 / 3.4, 20 / 4.25, ∞ / 5) normalizes to canonical 2-decimal strings in finalize payload', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-new-123' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      // Water: raw strings (10 / 3.4, 20 / 4.25, ∞ / 5)
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());

      fireEvent.change(screen.getByTestId('input-tier-upto-water-0'), { target: { value: '10' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.4' } });
      fireEvent.change(screen.getByTestId('input-tier-upto-water-1'), { target: { value: '20' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      // Electricity: raw strings (50 / 7, 150 / 8, ∞ / 9)
      fireEvent.change(screen.getByTestId('select-register-electric-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-electricity')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-tier-upto-electricity-0'), { target: { value: '50' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-0'), { target: { value: '7' } });
      fireEvent.change(screen.getByTestId('input-tier-upto-electricity-1'), { target: { value: '150' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-1'), { target: { value: '8' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-electricity-2'), { target: { value: '9' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-electricity'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าไฟฟ้าแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      fireEvent.click(screen.getByText('ถัดไป'));

      await advanceThroughSteps();

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload.billing.waterBillingType).toBe('tiered');
      expect(capturedPayload.billing.waterTierRates).toEqual([
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);

      expect(capturedPayload.billing.electricityBillingType).toBe('tiered');
      expect(capturedPayload.billing.electricityTierRates).toEqual([
        { upTo: '50.00', rate: '7.00' },
        { upTo: '150.00', rate: '8.00' },
        { upTo: null, rate: '9.00' },
      ]);

      // Locked First-Meter Rule: NO meter readings in Register rooms
      expect(capturedPayload.rooms[0].initialWaterReading).toBeUndefined();
      expect(capturedPayload.rooms[0].initialElectricityReading).toBeUndefined();
    });

    it('Reviewed inactive Tier config is preserved when switching active mode to unit', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-inactive-proof' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      // Set scalar rate to 25
      fireEvent.change(screen.getByTestId('input-register-water-rate'), { target: { value: '25' } });

      // Switch to Tiered and review custom tiers
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined());

      // Switch active mode back to 'unit'
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'unit' } });

      fireEvent.click(screen.getByText('ถัดไป'));

      await advanceThroughSteps();

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload.billing.waterBillingType).toBe('per_unit');
      expect(capturedPayload.billing.waterRate).toBe('25');
      expect(capturedPayload.billing.waterTierRates).toEqual([
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);
    });

    it('Never-reviewed sample preset does NOT leak into backend authority when utility is non-tiered', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-unreviewed' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      await advanceThroughSteps();

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload.billing.waterBillingType).toBe('per_person');
      expect(capturedPayload.billing.waterTierRates).toBeNull();
      expect(capturedPayload.billing.electricityBillingType).toBe('per_unit');
      expect(capturedPayload.billing.electricityTierRates).toBeNull();
    });
  });

  describe('5. Real Reviewed Draft Round-Trip & Restoration Lifecycle', () => {
    it('Real reviewed draft auto-saves, survives unmount/remount, and restores reviewed visual confirmation', async () => {
      let savedDraftState: any = null;
      vi.spyOn(localDraftStorage, 'saveRegistrationDraft').mockImplementation(async (_userId, _mode, draft) => {
        savedDraftState = draft;
      });

      const { unmount } = render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());

      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      // Wait for debounced draft save to capture the reviewed state
      await waitFor(() => {
        expect(savedDraftState).not.toBeNull();
        expect(savedDraftState.formData.utilities.waterBillingMode).toBe('tiered');
        expect(savedDraftState.formData.utilities.waterTierReviewed).toBe(true);
        expect(savedDraftState.formData.utilities.waterTierRates).toEqual([
          { upTo: '10.00', rate: '3.40' },
          { upTo: '20.00', rate: '4.25' },
          { upTo: null, rate: '5.00' },
        ]);
      });

      // Unmount component
      unmount();

      // Mock getRegistrationDraft with the captured draft
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue(savedDraftState);

      // Render Register again (Simulate F5 reload)
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Verify Step 3 is restored
      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });

      // Verify Water mode is tiered
      const waterSelect = screen.getByTestId('select-register-water-mode') as HTMLSelectElement;
      expect(waterSelect.value).toBe('tiered');

      // Verify custom tiers are restored
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');

      // Verify reviewed confirmation message is VISIBLE without owner reconstruction
      expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();

      // Post-restore edit invalidates review
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.50' } });

      // Confirmation message disappears immediately
      expect(screen.queryByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeNull();

      // Advancing is blocked
      fireEvent.click(screen.getByText('ถัดไป'));
      expect(screen.getByText('กรุณาตรวจสอบและบันทึกอัตราค่าน้ำแบบขั้นบันได')).toBeDefined();

      // Press save review again
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));
      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      // Now advancing is allowed
      fireEvent.click(screen.getByText('ถัดไป'));
      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined();
      });
    });

    it('Electricity reviewed draft is independently restored with reviewed status', async () => {
      const elecDraft = {
        currentStep: 3,
        formData: {
          dormName: 'หอพักไฟฟ้าขั้นบันได',
          dormAddress: '456 ถนนสายไฟ',
          province: 'กรุงเทพมหานคร',
          dormType: 'หอพักนักเรียน/นักศึกษา',
          genderType: 'รวม',
          buildings: [
            {
              id: 'b-1',
              name: 'อาคาร A',
              totalFloors: 2,
              roomsPerFloor: 2,
              hasElevator: false,
              mode: 'auto',
              customRooms: [],
              securityDeposit: 0,
              rentRates: { monthly: 4500, maxOccupants: 2 },
            },
          ],
          utilities: {
            waterBillingMode: 'unit',
            waterRate: 18,
            electricBillingMode: 'tiered',
            electricRate: 0,
            electricityTierRates: [
              { upTo: '50.00', rate: '7.00' },
              { upTo: '150.00', rate: '8.00' },
              { upTo: null, rate: '9.00' },
            ],
            electricityTierReviewed: true,
          },
        },
      };

      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue(elecDraft as any);

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });

      const elecSelect = screen.getByTestId('select-register-electric-mode') as HTMLSelectElement;
      expect(elecSelect.value).toBe('tiered');
      expect((screen.getByTestId('input-tier-rate-electricity-0') as HTMLInputElement).value).toBe('7.00');
      expect((screen.getByTestId('input-tier-rate-electricity-1') as HTMLInputElement).value).toBe('8.00');
      expect((screen.getByTestId('input-tier-rate-electricity-2') as HTMLInputElement).value).toBe('9.00');
      expect(screen.getByText(/บันทึกการตรวจสอบค่าไฟฟ้าแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
    });

    it('Old drafts without tier fields hydrate safely with scalar modes preserved and tiers unreviewed', async () => {
      const oldDraft = {
        currentStep: 1,
        formData: {
          dormName: 'หอพักเก่า',
          dormAddress: 'ที่อยู่เก่า',
          province: 'กรุงเทพมหานคร',
          dormType: 'หอพักนักเรียน/นักศึกษา',
          genderType: 'รวม',
          buildings: [],
          utilities: {
            waterBillingMode: 'person',
            waterRate: 18,
            electricBillingMode: 'unit',
            electricRate: 7,
          },
        },
      };

      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue(oldDraft as any);

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      await waitFor(() => {
        expect((screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท') as HTMLInputElement).value).toBe('หอพักเก่า');
      });
    });
  });
});
