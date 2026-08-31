// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  TieredRateEditor,
  formatUpToDisplay,
  formatRateDisplay,
  normalizeDisplayUpTo,
  normalizeDisplayRate,
  validateCanonicalTiers,
  WATER_TIER_PRESET,
  ELECTRICITY_TIER_PRESET,
  CanonicalTierRecord,
} from '../components/settings/TieredRateEditor';
import {
  OwnerRegister,
  mapRegistrationBuildingForFinalize,
  mapRegisterUtilityMode,
} from '../pages/owner/register';
import {
  formatBuildingDisplayName,
  formatRoomLocation,
} from '../lib/roomRentalSummary';
import { onboardingClient } from '../data/onboardingClient';
import * as localDraftStorage from '../utils/localDraftStorage';

describe('OWNER FINAL UAT CORRECTIONS — Comprehensive Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockautocapturedsignature');
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

  describe('1. Tier Display Value Normalization (Section 40)', () => {
    it('formats canonical string to friendly display without unnecessary .00', () => {
      // upTo formatting
      expect(formatUpToDisplay('10.00')).toBe('10');
      expect(formatUpToDisplay('20.00')).toBe('20');
      expect(formatUpToDisplay(null)).toBe('');
      expect(formatUpToDisplay(undefined)).toBe('');

      // rate formatting
      expect(formatRateDisplay('3.00')).toBe('3');
      expect(formatRateDisplay('7.00')).toBe('7');
      expect(formatRateDisplay('3.40')).toBe('3.40');
      expect(formatRateDisplay('4.25')).toBe('4.25');
      expect(formatRateDisplay('0.00')).toBe('0');
    });

    it('normalizes display values on blur removing unnecessary leading zeroes', () => {
      expect(normalizeDisplayUpTo('03')).toBe('3');
      expect(normalizeDisplayUpTo('0010')).toBe('10');
      expect(normalizeDisplayUpTo('15')).toBe('15');

      expect(normalizeDisplayRate('03')).toBe('3');
      expect(normalizeDisplayRate('03.40')).toBe('3.40');
      expect(normalizeDisplayRate('07')).toBe('7');
      expect(normalizeDisplayRate('4.25')).toBe('4.25');
    });

    it('rejects non-integer boundaries and malformed rates in validation', () => {
      const valid: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '3.40' },
        { upTo: '20.00', rate: '4.25' },
        { upTo: null, rate: '5.00' },
      ];
      expect(validateCanonicalTiers(valid)).toBe(true);

      const fractionalBoundary: CanonicalTierRecord[] = [
        { upTo: '10.50', rate: '3.40' },
        { upTo: null, rate: '5.00' },
      ];
      expect(validateCanonicalTiers(fractionalBoundary)).toBe(false);

      const invalidRate: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '1e2' },
        { upTo: null, rate: '5.00' },
      ];
      expect(validateCanonicalTiers(invalidRate)).toBe(false);

      const negativeRate: CanonicalTierRecord[] = [
        { upTo: '10.00', rate: '-3.00' },
        { upTo: null, rate: '5.00' },
      ];
      expect(validateCanonicalTiers(negativeRate)).toBe(false);
    });
  });

  describe('2. Shared Tier Editor UI & Responsive Structure (Section 41)', () => {
    it('renders non-wrapping table headers, buttons, and overflow-x-auto container', () => {
      const handleChange = vi.fn();
      const handleSave = vi.fn();
      render(
        <TieredRateEditor
          utilityType="water"
          tiers={WATER_TIER_PRESET}
          onChange={handleChange}
          onSave={handleSave}
        />
      );

      const table = screen.getByRole('table');
      expect(table.className).toContain('min-w-[340px]');

      const headers = screen.getAllByRole('columnheader');
      headers.forEach((th) => {
        expect(th.className).toContain('whitespace-nowrap');
      });

      const resetBtn = screen.getByTestId('btn-reset-preset-water');
      expect(resetBtn.className).toContain('whitespace-nowrap');

      const addBtn = screen.getByTestId('btn-add-tier-water');
      expect(addBtn.className).toContain('whitespace-nowrap');

      const saveBtn = screen.getByTestId('btn-save-tiers-water');
      expect(saveBtn.className).toContain('whitespace-nowrap');
    });

    it('omits manual Save button when onSave prop is omitted (Register mode)', () => {
      const handleChange = vi.fn();
      render(
        <TieredRateEditor
          utilityType="water"
          tiers={WATER_TIER_PRESET}
          onChange={handleChange}
        />
      );

      expect(screen.queryByTestId('btn-save-tiers-water')).toBeNull();
      expect(screen.getByTestId('btn-add-tier-water')).toBeDefined();
    });
  });

  describe('3. Register Step 2 — Building Name Authority (Sections 48, 49, 50)', () => {
    it('derives room numbers from single building name for English B and Thai สมบูรณ์', () => {
      // 1. Building B + prefix_floor_room
      const bldB = {
        name: 'B',
        totalFloors: 2,
        roomsPerFloor: 2,
        formatPattern: 'prefix_floor_room',
        mode: 'auto' as const,
      };
      const mappedB = mapRegistrationBuildingForFinalize(bldB, 0, 5000);
      expect(mappedB.name).toBe('B');
      expect(mappedB.code).toBe('B');
      expect(formatBuildingDisplayName(mappedB.name)).toBe('อาคาร B');

      // 2. Building สมบูรณ์ + prefix_floor_room
      const bldThai = {
        name: 'สมบูรณ์',
        totalFloors: 2,
        roomsPerFloor: 2,
        formatPattern: 'prefix_floor_room',
        mode: 'auto' as const,
      };
      const mappedThai = mapRegistrationBuildingForFinalize(bldThai, 0, 5000);
      expect(mappedThai.name).toBe('สมบูรณ์');
      expect(mappedThai.code).toBe('สมบูรณ์');
      expect(formatBuildingDisplayName(mappedThai.name)).toBe('อาคาร สมบูรณ์');
      expect(formatRoomLocation(mappedThai, 1)).toBe('อาคาร สมบูรณ์ • ชั้น 1');
    });

    it('supports no-prefix format (floor_room) while retaining building linkage', () => {
      const bldThaiNoPfx = {
        name: 'สมบูรณ์',
        totalFloors: 2,
        roomsPerFloor: 2,
        formatPattern: 'floor_room',
        mode: 'auto' as const,
      };
      const mapped = mapRegistrationBuildingForFinalize(bldThaiNoPfx, 0, 5000);
      expect(mapped.name).toBe('สมบูรณ์');
      expect(formatBuildingDisplayName(mapped.name)).toBe('อาคาร สมบูรณ์');
      expect(formatRoomLocation(mapped, 2)).toBe('อาคาร สมบูรณ์ • ชั้น 2');
    });
  });

  describe('4. Register Step 4 — Three Building-Level Deposit Modes (Sections 45, 46)', () => {
    it('mapRegistrationBuildingForFinalize extracts distinct termDeposit, monthlyDeposit, dailyDeposit', () => {
      const bldA = {
        id: 'b-1',
        name: 'A',
        totalFloors: 1,
        roomsPerFloor: 2,
        termDeposit: 5000,
        monthlyDeposit: 3000,
        dailyDeposit: 500,
      };

      const bldB = {
        id: 'b-2',
        name: 'B',
        totalFloors: 1,
        roomsPerFloor: 2,
        termDeposit: 8000,
        monthlyDeposit: 4000,
        dailyDeposit: 800,
      };

      const mappedA = mapRegistrationBuildingForFinalize(bldA, 0, 0);
      const mappedB = mapRegistrationBuildingForFinalize(bldB, 1, 0);

      expect(mappedA.termDeposit).toBe(5000);
      expect(mappedA.monthlyDeposit).toBe(3000);
      expect(mappedA.dailyDeposit).toBe(500);

      expect(mappedB.termDeposit).toBe(8000);
      expect(mappedB.monthlyDeposit).toBe(4000);
      expect(mappedB.dailyDeposit).toBe(800);
    });

    it('safely restores old one-deposit draft into three distinct deposit modes', () => {
      const legacyBld = {
        id: 'b-legacy',
        name: 'Old Building',
        securityDeposit: 4500,
      };

      const mapped = mapRegistrationBuildingForFinalize(legacyBld, 0, 0);
      expect(mapped.termDeposit).toBe(4500);
      expect(mapped.monthlyDeposit).toBe(4500);
      expect(mapped.dailyDeposit).toBe(4500);
      expect(mapped.securityDeposit).toBe(4500);
    });
  });

  describe('5. Step 5 — Signature Auto-Capture & No Save Button (Section 47)', () => {
    it('Step 5 signature panel has NO visible manual Save button', async () => {
      render(<OwnerRegister />);

      // Fill Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
        target: { value: 'หอพักทดสอบ ลายเซ็น' },
      });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
        target: { value: '123/45 ถนนทดสอบ' },
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Fill Step 2
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Fill Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.change(screen.getByTestId('input-building-monthly-rent-0'), { target: { value: '3500' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Fill Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());
      fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กสิกรไทย (KBank)' } });
      await waitFor(() => {
        const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
        expect(accInput.disabled).toBe(false);
      });
      fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '1234567890' } });
      fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'นาย สมศักดิ์ วงศ์สว่าง' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 5
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());

      // Assert that NO manual "บันทึก" button exists in the signature panel
      const saveButtons = screen.queryAllByRole('button', { name: /บันทึก/i });
      expect(saveButtons).toHaveLength(0);

      // Verify "ล้างลายเซ็น" exists
      expect(screen.getByText('ล้างลายเซ็น')).toBeDefined();
    });
  });

  describe('6. Dorm-Wide Room Number Uniqueness & Label Authority (Round 1.1)', () => {
    it('blocks Step 2 when two buildings generate duplicate room numbers (e.g. 101 vs 101 in floor_room format)', async () => {
      render(<OwnerRegister />);

      // Fill Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
        target: { value: 'หอพักทดสอบ ห้องซ้ำ' },
      });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
        target: { value: '123/45 ถนนทดสอบ' },
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2: Configure Building 1
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      const nameInput1 = screen.getByPlaceholderText('เช่น สมบูรณ์, อาคาร A');
      fireEvent.change(nameInput1, { target: { value: 'A' } });
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });

      // Add Building 2
      fireEvent.click(screen.getByText('เพิ่มอาคารใหม่'));

      // Configure all buildings with roomsPerFloor = 2 and floor_room format
      const nameInputs = screen.getAllByPlaceholderText('เช่น สมบูรณ์, อาคาร A');
      fireEvent.change(nameInputs[0], { target: { value: 'สมบูรณ์' } });

      const roomsPerFloorInputs = screen.getAllByPlaceholderText('ระบุห้องต่อชั้น');
      roomsPerFloorInputs.forEach((inp) => fireEvent.change(inp, { target: { value: '2' } }));

      const formatSelects = screen.getAllByRole('combobox');
      formatSelects.forEach((sel) => fireEvent.change(sel, { target: { value: 'floor_room' } }));

      // Attempt to advance to Step 3
      fireEvent.click(screen.getByText('ถัดไป'));

      // Must be blocked with clear duplicate error message
      await waitFor(() => {
        expect(screen.getByText(/เลขห้อง "101" ซ้ำกับอาคารอื่น/)).toBeDefined();
      });

      // Assert we remain on Step 2
      expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined();
    });

    it('allows different room numbers across buildings using building-name prefix (A101 vs สมบูรณ์101)', async () => {
      render(<OwnerRegister />);

      // Fill Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
        target: { value: 'หอพักทดสอบ คำนำหน้าตึก' },
      });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
        target: { value: '123/45 ถนนทดสอบ' },
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2: Building 1 (A101, A102)
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      const nameInputsInitial = screen.getAllByPlaceholderText('เช่น สมบูรณ์, อาคาร A');
      fireEvent.change(nameInputsInitial[0], { target: { value: 'A' } });
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });

      // Add Building 2 (สมบูรณ์101, สมบูรณ์102)
      fireEvent.click(screen.getByText('เพิ่มอาคารใหม่'));
      const updatedNameInputs = screen.getAllByPlaceholderText('เช่น สมบูรณ์, อาคาร A');
      fireEvent.change(updatedNameInputs[0], { target: { value: 'สมบูรณ์' } });
      const roomsPerFloorInputs = screen.getAllByPlaceholderText('ระบุห้องต่อชั้น');
      roomsPerFloorInputs.forEach((inp) => fireEvent.change(inp, { target: { value: '2' } }));

      // Click Next -> No duplicates -> Advances to Step 3
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined();
      });
    });

    it('blocks manual room duplicates across buildings and case-normalized duplicates (A101 vs a101)', async () => {
      render(<OwnerRegister />);

      // Fill Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
        target: { value: 'หอพักทดสอบ Manual Duplicate' },
      });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
        target: { value: '123/45 ถนนทดสอบ' },
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2: Building 1 in Manual mode
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.click(screen.getByText('เขียนเลขห้องเอง'));

      // Add room "A101" to Building 1
      const manualInput1 = screen.getByPlaceholderText('เช่น A101, A102, A1/1, 101, 102');
      fireEvent.change(manualInput1, { target: { value: 'A101' } });
      fireEvent.click(screen.getByText('+ เพิ่มเลขห้อง'));

      // Add Building 2
      fireEvent.click(screen.getByText('เพิ่มอาคารใหม่'));

      // Switch Building 2 (now at index 0) to manual mode
      const manualModeButtons = screen.getAllByText('เขียนเลขห้องเอง');
      fireEvent.click(manualModeButtons[0]);

      // Add room "a101" (lowercase) to Building 2
      await waitFor(() => {
        const manualInputs = screen.getAllByPlaceholderText('เช่น A101, A102, A1/1, 101, 102');
        expect(manualInputs.length).toBeGreaterThanOrEqual(1);
      });
      const manualInputs = screen.getAllByPlaceholderText('เช่น A101, A102, A1/1, 101, 102');
      fireEvent.change(manualInputs[0], { target: { value: 'a101' } });
      const addRoomButtons = screen.getAllByText('+ เพิ่มเลขห้อง');
      fireEvent.click(addRoomButtons[0]);

      // Attempt to advance -> Must be blocked because canonical normalization treats A101 == a101
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => {
        expect(screen.getByText(/ซ้ำกับอาคารอื่น/)).toBeDefined();
      });
      expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined();
    });

    it('verifies manual room mode uses "ชื่ออาคาร" label without "ชื่อ/รหัสอาคาร"', async () => {
      render(<OwnerRegister />);

      // Advance to Step 2
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), {
        target: { value: 'หอพักทดสอบ ป้ายชื่อ' },
      });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), {
        target: { value: '123/45 ถนนทดสอบ' },
      });
      fireEvent.click(screen.getByText('ถัดไป'));

      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.click(screen.getByText('เขียนเลขห้องเอง'));

      // Assert label is "ชื่ออาคาร" and NOT "ชื่อ/รหัสอาคาร"
      expect(screen.getByText('ชื่ออาคาร')).toBeDefined();
      expect(screen.queryByText('ชื่อ/รหัสอาคาร')).toBeNull();
    });
  });
});
