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
} from '../components/settings/TieredRateEditor';

describe('OWNER R3.9-D.2: Owner Register Tiered Utility UI & Onboarding Payload Suite', () => {
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

  describe('1. Mode Mapping Authority (mapRegisterUtilityMode)', () => {
    it('Maps Register modes to canonical backend utility types', () => {
      expect(mapRegisterUtilityMode('unit')).toBe('per_unit');
      expect(mapRegisterUtilityMode('person')).toBe('per_person');
      expect(mapRegisterUtilityMode('room')).toBe('flat_rate');
      expect(mapRegisterUtilityMode('tiered')).toBe('tiered');
      expect(mapRegisterUtilityMode('unknown')).toBe('flat_rate');
    });
  });

  describe('2. Step 3 Tiered Selection, Inactive Scalar, & Review Enforcement', () => {
    it('Selecting Water Tiered renders TieredRateEditor with disabled scalar input and blocks advancing until reviewed', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      // Step 3: Rates & Utilities
      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });

      // Fill building monthly rent
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      // Default water mode is 'person'
      const waterSelect = screen.getByTestId('select-register-water-mode') as HTMLSelectElement;
      expect(waterSelect.value).toBe('person');

      // Change Water mode to 'tiered'
      fireEvent.change(waterSelect, { target: { value: 'tiered' } });

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      // Scalar input must be disabled and display "คิดตามขั้นบันได"
      const waterRateInput = screen.getByTestId('input-register-water-rate') as HTMLInputElement;
      expect(waterRateInput.disabled).toBe(true);
      expect(waterRateInput.value).toBe('คิดตามขั้นบันได');

      // TieredRateEditor must be rendered with preset (18.00 / 20.00 / 22.00)
      expect(screen.getByTestId('input-tier-rate-water-0')).toBeDefined();
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('18.00');

      // Attempting to advance to Step 4 without reviewing must be blocked
      fireEvent.click(screen.getByText('ถัดไป'));

      expect(screen.getByText('กรุณาตรวจสอบและบันทึกอัตราค่าน้ำแบบขั้นบันได')).toBeDefined();
      expect(screen.queryByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeNull();

      // Click Save in TieredRateEditor
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      // Now advancing to Step 4 succeeds!
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

      // Switch to Tiered & Save
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });

      await waitFor(() => {
        expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined();
      });

      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });

      // Edit Tier 0 rate
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '19.50' } });

      // Review message disappears & Step 3 blocked again
      expect(screen.queryByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeNull();

      fireEvent.click(screen.getByText('ถัดไป'));
      expect(screen.getByText('กรุณาตรวจสอบและบันทึกอัตราค่าน้ำแบบขั้นบันได')).toBeDefined();

      // Click Save again
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

  describe('3. Inactive Configuration & Mode Switching Retention', () => {
    it('Reviewed Tier configuration is preserved when switching to scalar and back', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());

      // 1. Enter custom scalar rate (e.g. 25.00) while in person mode
      fireEvent.change(screen.getByTestId('input-register-water-rate'), { target: { value: '25' } });

      // 2. Switch to Tiered
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });

      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());

      // 3. Edit custom tiers (3.40 / 4.25 / 5.00) and save
      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined());

      // 4. Switch away to 'unit' mode
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'unit' } });

      // Previous scalar rate is preserved
      expect((screen.getByTestId('input-register-water-rate') as HTMLInputElement).value).toBe('25');

      // 5. Switch back to 'tiered' mode
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });

      // Custom tiers (3.40 / 4.25 / 5.00) and reviewed status are restored!
      expect((screen.getByTestId('input-tier-rate-water-0') as HTMLInputElement).value).toBe('3.40');
      expect((screen.getByTestId('input-tier-rate-water-1') as HTMLInputElement).value).toBe('4.25');
      expect((screen.getByTestId('input-tier-rate-water-2') as HTMLInputElement).value).toBe('5.00');
      expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
    });
  });

  describe('4. Draft Compatibility & Round-Trip Persistence', () => {
    it('Old drafts without tier fields hydrate safely with default tier presets and unreviewed state', async () => {
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

  describe('5. Onboarding Finalize Payload (Active Tiered & Inactive Tiered)', () => {
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

    it('Finalize payload sends active Tiered utility configurations with canonical tier arrays and NO meter readings', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-new-123' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      // Step 3: Rates & Utilities
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });

      // Water: Tiered (3.40 / 4.25 / 5.00)
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());

      fireEvent.change(screen.getByTestId('input-tier-rate-water-0'), { target: { value: '3.40' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-1'), { target: { value: '4.25' } });
      fireEvent.change(screen.getByTestId('input-tier-rate-water-2'), { target: { value: '5.00' } });
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      // Electricity: Tiered (7.00 / 8.00 / 9.00)
      fireEvent.change(screen.getByTestId('select-register-electric-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-electricity')).toBeDefined());
      fireEvent.click(screen.getByTestId('btn-save-tiers-electricity'));

      await waitFor(() => {
        expect(screen.getByText(/บันทึกการตรวจสอบค่าไฟฟ้าแบบขั้นบันไดเรียบร้อย/)).toBeDefined();
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      await advanceThroughSteps();

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      // Verify billing payload
      expect(capturedPayload.billing.waterBillingType).toBe('tiered');
      expect(capturedPayload.billing.waterTierRates).toEqual([
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ]);
      expect(capturedPayload.billing.electricityBillingType).toBe('tiered');
      expect(capturedPayload.billing.electricityTierRates).toEqual(ELECTRICITY_TIER_PRESET);

      // Verify NO meter readings were added to payload
      expect(capturedPayload.rooms[0].initialWaterReading).toBeUndefined();
      expect(capturedPayload.rooms[0].initialElectricityReading).toBeUndefined();
    });

    it('Untouched/unreviewed tier preset is NOT sent when utility mode is non-tiered', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-new-456' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      // Step 3: Keep water as 'person' and electricity as 'unit' (never reviewed tiers)
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

    it('Water and Electricity modes operate completely independently in final payload', async () => {
      let capturedPayload: any = null;
      vi.spyOn(onboardingClient, 'finalize').mockImplementation(async (payload) => {
        capturedPayload = payload;
        return { success: true, data: { dormitory: { id: 'dorm-new-789' } } } as any;
      });

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      fillStep1();
      await fillStep2();

      // Step 3: Water Tiered, Electricity Unit
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '4500' } });
      fireEvent.change(screen.getByTestId('select-register-water-mode'), { target: { value: 'tiered' } });
      await waitFor(() => expect(screen.getByTestId('btn-save-tiers-water')).toBeDefined());
      fireEvent.click(screen.getByTestId('btn-save-tiers-water'));

      await waitFor(() => expect(screen.getByText(/บันทึกการตรวจสอบค่าน้ำแบบขั้นบันไดเรียบร้อย/)).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      await advanceThroughSteps();

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload.billing.waterBillingType).toBe('tiered');
      expect(capturedPayload.billing.waterTierRates).toEqual(WATER_TIER_PRESET);
      expect(capturedPayload.billing.electricityBillingType).toBe('per_unit');
      expect(capturedPayload.billing.electricityTierRates).toBeNull();
    });
  });
});
