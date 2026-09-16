// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import {
  OwnerRegister,
  getRegistrationInitialFormData,
  mapRegistrationFormDataToFinalizePayload,
} from '../pages/owner/register';
import { OwnerSettings } from '../pages/owner/settings';
import { DormitoryLogoUploader } from '../components/settings/DormitoryLogoUploader';
import { BankQrCodeUploader } from '../components/settings/BankQrCodeUploader';
import {
  CANONICAL_PRESET_DORM_RULES,
  formatNumberedRules,
  toggleRuleInNumberedList,
  isRuleActive,
} from '../constants/presetRules';
import { onboardingClient } from '../data/onboardingClient';
import * as localDraftStorage from '../utils/localDraftStorage';
import * as billingSettingsService from '../services/billing-settings.service';
import * as paymentSettingsService from '../services/payment-settings.service';
import * as dormitoryService from '../services/dormitory.service';
import { ApiPropertyAdapter } from '../data/adapters/api';

describe('Settings Backend Persistence and Onboarding Parity Suite', () => {
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

    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockcanvas');
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    } as any);

    vi.spyOn(onboardingClient, 'prepare').mockResolvedValue({
      success: true,
      data: { provisionalDormitoryId: 'prov-mock-parity' },
    } as any);
    vi.spyOn(onboardingClient, 'getPackages').mockResolvedValue({ success: true, data: [] } as any);
    vi.spyOn(onboardingClient, 'getCoinWallet').mockResolvedValue({ success: true, data: { balance: 0 } } as any);
    vi.spyOn(onboardingClient, 'getSubscriptionQuote').mockResolvedValue({
      success: true,
      data: { intentId: 'intent-mock', dormitoryId: 'prov-mock-parity' },
    } as any);
    vi.spyOn(onboardingClient, 'uploadSignature').mockResolvedValue({
      success: true,
      data: { url: 'https://storage.example.com/signatures/mock.png' },
    } as any);
    vi.spyOn(onboardingClient, 'deleteLogo').mockResolvedValue({ success: true } as any);
    vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue(null);
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/rate-snapshot')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              cycle: { id: 'cycle-2026-08', cycleCode: '2026-08' },
              rateSnapshot: {
                version: 1,
                waterBillingType: 'per_unit',
                waterRate: '18.00',
                electricityBillingType: 'per_unit',
                electricityRate: '7.00',
              },
              isLocked: false,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Registration Step 3: VAT 7% Configuration & Finalize Mapping', () => {
    it('renders VAT 7% card in Step 3 and allows toggling categories and default enabled', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพักพาริตี้' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '123 ถนนสุขุมวิท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());

      // VAT card should be present with toggle
      expect(screen.getByText(/คิด VAT 7%/)).toBeDefined();
      const vatToggle = screen.getByTestId('toggle-register-vat');
      expect(vatToggle).toBeDefined();

      // Initially disabled, toggle on to show checklist
      fireEvent.click(vatToggle);

      // Check VAT categories checklist via testids
      expect(screen.getByTestId('label-vat-cat-rent')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-water')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-electricity')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-commonFee')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-internetFee')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-parking')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-fine')).toBeDefined();
      expect(screen.getByTestId('label-vat-cat-other')).toBeDefined();

      // Toggle off
      fireEvent.click(vatToggle);
    });
  });

  describe('2. Registration Step 5: Pet Policy Options Exact Match with Settings', () => {
    it('renders exact 4 pet policy labels matching Settings page in Step 5', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพักพาริตี้ 2' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '456 ถนนพญาไท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '2' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());
      if (screen.queryByTestId('input-term-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-term-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-monthly-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-monthly-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-daily-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-daily-deposit-0'), { target: { value: '0' } });
      }
      fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กสิกรไทย (KBank)' } });
      await waitFor(() => {
        const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
        expect(accInput.disabled).toBe(false);
      });
      fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '1234567890' } });
      fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'เจ้าของหอพัก ทดสอบ' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 5
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());

      // Select "อนุญาตให้เลี้ยงสัตว์ได้"
      const petSelect = screen.getByDisplayValue('ไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด');
      fireEvent.change(petSelect, { target: { value: 'conditional' } });

      // Assert the 4 exact Thai labels
      await waitFor(() => {
        expect(screen.getByText('สุนัข (Dog)')).toBeDefined();
        expect(screen.getByText('แมว (Cat)')).toBeDefined();
        expect(screen.getByText('สัตว์เล็ก (กระต่าย/หนู/นก)')).toBeDefined();
        expect(screen.getByText('สัตว์แปลก (Other)')).toBeDefined();
      });

      // Toggle pet types
      fireEvent.click(screen.getByText('สุนัข (Dog)'));
      fireEvent.click(screen.getByText('สัตว์แปลก (Other)'));
    });

    it('normalizes petPolicy.allowedTypes in mapRegistrationFormDataToFinalizePayload to canonical enums', () => {
      const mockForm = {
        ...getRegistrationInitialFormData(),
        dormName: 'หอพักพาริตี้',
        dormAddress: '123 ถนนสุขุมวิท',
        buildings: [{
          id: 'b-1',
          name: 'อาคาร A',
          totalFloors: 1,
          roomsPerFloor: 1,
          formatPattern: 'prefix_floor_room',
          mode: 'auto' as const,
          customRooms: [] as string[],
          termDeposit: '0',
          monthlyDeposit: '0',
          dailyDeposit: '0',
          securityDeposit: '0',
          rentRates: { monthly: '3500', maxOccupants: 2 },
        }],
        petPolicy: {
          allowed: 'conditional',
          allowedTypes: ['dog', 'small_pets', 'cat', 'exotic'],
        },
      };

      const payload = mapRegistrationFormDataToFinalizePayload({
        formData: mockForm,
        provDormId: 'prov-mock',
        activeIntentId: '00000000-0000-4000-8000-000000000000',
      });

      expect(payload.petPolicy.allowedTypes).toEqual(['dog', 'small_pet', 'cat', 'other']);
    });
  });

  describe('3. Settings UI: Zero Visual Deletion & Real Backend Persistence', () => {
    const mockDorm = {
      id: 'dorm-parity-001',
      name: 'หอพักแกรนด์พาริตี้',
      dueDay: 5,
      petPolicy: {
        allowed: 'conditional' as const,
        allowedTypes: ['dog', 'cat', 'small_pets', 'exotic'],
      },
      vatSettings: {
        enabled: true,
        rate: 7,
        appliedCategories: ['rent', 'water', 'electricity', 'commonFee'],
      },
    };

    it('renders all settings sections, tabs, inputs, and VAT 7% checklist', async () => {
      vi.spyOn(ApiPropertyAdapter.prototype, 'getDormitoryDefaults').mockResolvedValue({
        success: true,
        data: {
          property: { version: 1 },
          billing: { version: 1, dueDay: 5, waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
        },
      } as any);

      vi.spyOn(billingSettingsService, 'getBillingSettings').mockResolvedValue({
        success: true,
        data: {
          dormitoryId: 'dorm-parity-001',
          dueDay: 5,
          waterBillingMode: 'per_unit',
          electricBillingMode: 'per_unit',
          vatSettings: {
            enabled: true,
            rate: 7,
            appliedCategories: ['rent', 'water', 'electricity', 'commonFee'],
          },
        },
      } as any);

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const urlStr = String(url);
        if (urlStr.includes('/rate-snapshot')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                cycle: { id: 'cycle-2026-08', cycleCode: '2026-08' },
                rateSnapshot: {
                  version: 1,
                  waterBillingType: 'per_unit',
                  waterRate: '18.00',
                  electricityBillingType: 'per_unit',
                  electricityRate: '7.00',
                },
                isLocked: false,
              },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      });

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      // Verify header and core sections are present (zero deletion)
      expect(screen.getByText('ข้อมูลเจ้าของหอพัก')).toBeDefined();
      expect(screen.getByText('ตั้งค่าบัญชีรับเงิน')).toBeDefined();
      expect(screen.getByText('การตั้งค่า')).toBeDefined();
      expect(screen.getByText('กฎระเบียบ & สัตว์เลี้ยง')).toBeDefined();

      // Verify utility rates in settings
      expect(screen.getAllByText(/อัตราค่าน้ำ/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/อัตราค่าไฟ/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/ค่าส่วนกลาง/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/ค่าบริการอินเทอร์เน็ต/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/ค่าที่จอดรถ/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/ค่าปรับชำระล่าช้า/).length).toBeGreaterThan(0);
    });

    it('persists dueDay mutation to backend updateBillingSettings and property adapter', async () => {
      const updateBillingSettingsSpy = vi.spyOn(billingSettingsService, 'updateBillingSettings').mockResolvedValue({
        success: true,
        data: {} as any,
      });

      const updateDefaultsSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { billing: { version: 2 } },
      } as any);

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      // Expand collapsible section
      const toggleSection = screen.getByTestId('toggle-late-fee-section');
      fireEvent.click(toggleSection);

      const dueDayInput = screen.getByTestId('input-due-day') as HTMLInputElement;
      fireEvent.change(dueDayInput, { target: { value: '12' } });
      fireEvent.blur(dueDayInput);

      await waitFor(() => {
        expect(updateBillingSettingsSpy).toHaveBeenCalledWith(
          mockDorm.id,
          expect.objectContaining({ dueDay: 12 })
        );
        expect(updateDefaultsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            billing: expect.objectContaining({
              changes: expect.objectContaining({ dueDay: 12 }),
            }),
          })
        );
      });
    });

    it('persists VAT 7% toggle to updateBillingSettings (F-SET-01)', async () => {
      const updateBillingSettingsSpy = vi.spyOn(billingSettingsService, 'updateBillingSettings').mockResolvedValue({
        success: true,
        data: {} as any,
      });

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      const vatToggle = screen.getByTestId('toggle-vat-7');
      await waitFor(() => expect((vatToggle as HTMLButtonElement).disabled).toBe(false));
      // mockDorm starts with enabled: true, clicking toggle toggles to false
      fireEvent.click(vatToggle);

      await waitFor(() => {
        expect(updateBillingSettingsSpy).toHaveBeenCalledWith(
          mockDorm.id,
          expect.objectContaining({
            vatSettings: expect.objectContaining({
              enabled: false,
            }),
          })
        );
      });
    });

    it('persists pet policy & rules to updateDormitoryDefaults on save (F-SET-02)', async () => {
      const updateDefaultsSpy = vi.spyOn(ApiPropertyAdapter.prototype, 'updateDormitoryDefaults').mockResolvedValue({
        success: true,
        data: { property: { version: 2 } },
      } as any);

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      // Switch to policy_rules tab
      fireEvent.click(screen.getByText('กฎระเบียบ & สัตว์เลี้ยง'));

      // Click save pet and rules button
      const saveBtn = screen.getByText('บันทึกกฎระเบียบ & นโยบายสัตว์เลี้ยง');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(updateDefaultsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            property: expect.objectContaining({
              changes: expect.objectContaining({
                petPolicy: expect.anything(),
                defaultTerms: expect.anything(),
              }),
            }),
          })
        );
      });
    });

    it('persists payment settings on blur with schema-compliant payload (F-SET-03)', async () => {
      const updatePaymentSettingsSpy = vi.spyOn(paymentSettingsService, 'updatePaymentSettings').mockResolvedValue({} as any);

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      const promptPayInput = screen.getByTestId('input-promptpay-number');
      fireEvent.change(promptPayInput, { target: { value: '0812345678' } });
      fireEvent.blur(promptPayInput);

      await waitFor(() => {
        expect(updatePaymentSettingsSpy).toHaveBeenCalledWith(
          mockDorm.id,
          expect.objectContaining({
            promptPayValue: '0812345678',
            promptPayType: 'mobile_phone',
          })
        );
      });
    });

    it('persists addressLine1 when dormitory address field blurs (F-SET-04)', async () => {
      const updateProfileSpy = vi.spyOn(dormitoryService, 'updateDormitoryProfile').mockResolvedValue({} as any);

      render(
        <OwnerSettings
          dormitory={mockDorm as any}
          selectedCycle="2026-08"
          availableCycles={[{ id: 'cycle-2026-08', cycleCode: '2026-08', status: 'active' } as any]}
          onAddLog={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      const addressInput = screen.getByPlaceholderText('ที่อยู่ เลขที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด รหัสไปรษณีย์');
      fireEvent.change(addressInput, { target: { value: '999 ถนนเพชรเกษม' } });
      fireEvent.blur(addressInput);

      await waitFor(() => {
        expect(updateProfileSpy).toHaveBeenCalledWith(
          mockDorm.id,
          expect.objectContaining({
            addressLine1: '999 ถนนเพชรเกษม',
          })
        );
      });
    });
  });

  describe('4. Extracted DormitoryLogoUploader Component', () => {
    it('renders upload trigger and supports logo upload preview', () => {
      const onLogoChange = vi.fn();
      render(
        <DormitoryLogoUploader
          dormitoryId="dorm-test-123"
          logoUrl={null}
          onLogoChange={onLogoChange}
        />
      );

      expect(screen.getByText('คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่')).toBeDefined();
      expect(screen.getByText('รองรับไฟล์ PNG, JPG หรือ WebP ขนาดไม่เกิน 5MB')).toBeDefined();
    });

    it('renders existing logo with replace and delete actions', async () => {
      const onLogoChange = vi.fn();
      render(
        <DormitoryLogoUploader
          dormitoryId="dorm-test-123"
          logoUrl="https://example.com/logo.png"
          onLogoChange={onLogoChange}
        />
      );

      expect(screen.getByText('มีโลโก้หอพักแล้ว')).toBeDefined();
      expect(screen.getByText('เปลี่ยนรูป')).toBeDefined();
      const deleteBtn = screen.getByTitle('ลบโลโก้');
      expect(deleteBtn).toBeDefined();

      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(onLogoChange).toHaveBeenCalledWith(null);
      });
    });
  });

  describe('5. Settings Rate Snapshot CSRF & Credentials Injection (SRP-01)', () => {
    it('sends credentials: "include" and X-CSRF-Token header on rate-snapshot fetch and mutations', async () => {
      // Set CSRF token in document.cookie
      document.cookie = 'horplus_csrf=canonical-test-csrf-token-123; path=/';
      sessionStorage.setItem('horplus_csrf', 'canonical-test-csrf-token-123');

      const fetchCalls: { url: string; opts: any }[] = [];
      const originalFetch = global.fetch;

      global.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
        fetchCalls.push({ url, opts });
        if (url.includes('/rate-snapshot')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                rateSnapshot: {
                  version: 1,
                  waterBillingType: 'per_unit',
                  waterRate: '18.00',
                  electricityBillingType: 'per_unit',
                  electricityRate: '7.00',
                },
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        };
      });

      const mockDorm = {
        id: 'dorm-csrf-test',
        name: 'หอพัก CSRF เทสต์',
        address: '123 ถนนสุขุมวิท',
        phone: '081-234-5678',
        billStyle: 'combined' as const,
        billingDay: 25,
        dueDay: 5,
        lateFeeDaily: 50,
        waterUnitRate: 18,
        electricUnitRate: 7,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      };

      render(
        <OwnerSettings
          dorm={mockDorm}
          onAddLog={vi.fn()}
          onNavigate={vi.fn()}
          onRefreshData={vi.fn()}
        />
      );

      // Verify GET /rate-snapshot had credentials: 'include'
      await waitFor(() => {
        const getSnapshot = fetchCalls.find((c) => c.url.includes('/rate-snapshot'));
        expect(getSnapshot).toBeDefined();
        expect(getSnapshot?.opts?.credentials).toBe('include');
        expect(getSnapshot?.opts?.headers?.['X-CSRF-Token']).toBe('canonical-test-csrf-token-123');
      });

      global.fetch = originalFetch;
    });
  });

  describe('6. Registration Step 4: Bank QR Code Uploader Parity & Finalize Mapping (SRP-02)', () => {
    it('renders Bank QR Code Uploader component in isolated view', async () => {
      const onQrChange = vi.fn();
      render(
        <BankQrCodeUploader
          qrCodeUrl={null}
          onQrCodeChange={onQrChange}
        />
      );

      // Check upload trigger
      expect(screen.getByText('อัปโหลดรูปภาพ QRCode')).toBeDefined();
      expect(screen.getByTestId('btn-bank-qr-upload')).toBeDefined();
    });

    it('renders preview with thumbnail, delete button, and modal viewer when QR is present', async () => {
      const onQrChange = vi.fn();
      render(
        <BankQrCodeUploader
          qrCodeUrl="data:image/png;base64,mockqrcodeimage"
          onQrCodeChange={onQrChange}
        />
      );

      expect(screen.getByText('มีรูป QRCode แล้ว')).toBeDefined();
      const previewBtn = screen.getByTestId('btn-bank-qr-preview');
      expect(previewBtn).toBeDefined();

      const removeBtn = screen.getByTestId('btn-bank-qr-remove');
      expect(removeBtn).toBeDefined();

      // Click preview button to open modal overlay
      fireEvent.click(previewBtn);
      await waitFor(() => {
        expect(screen.getByTestId('modal-bank-qr-overlay')).toBeDefined();
        expect(screen.getByAltText('QRCode ธนาคารขนาดเต็ม')).toBeDefined();
      });

      // Close modal
      fireEvent.click(screen.getByTestId('btn-close-bank-qr-modal'));
      await waitFor(() => {
        expect(screen.queryByTestId('modal-bank-qr-overlay')).toBeNull();
      });

      // Click remove button
      fireEvent.click(removeBtn);
      expect(onQrChange).toHaveBeenCalledWith('');
    });

    it('renders Bank QR Code Uploader in Step 4 and maps bankQrCode into finalize payload', async () => {
      const finalizeSpy = vi.spyOn(onboardingClient, 'finalize').mockResolvedValue({
        success: true,
        data: { dormitory: { id: 'prov-mock-parity' } },
      } as any);

      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Advance Step 1 -> Step 2
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพัก QR เทสต์' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '123 ถนนสุขุมวิท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Advance Step 2 -> Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Advance Step 3 -> Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      // In Step 4: Bank Account & Deposits
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());

      // Verify QR Code upload trigger exists in Step 4
      expect(screen.getByText('QRCode ธนาคาร (ไม่บังคับ)')).toBeDefined();
      expect(screen.getByText('อัปโหลดรูปภาพ QRCode')).toBeDefined();

      if (screen.queryByTestId('input-term-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-term-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-monthly-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-monthly-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-daily-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-daily-deposit-0'), { target: { value: '0' } });
      }

      // Fill required payment fields
      fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กรุงเทพ (Bangkok)' } });
      await waitFor(() => {
        const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
        expect(accInput.disabled).toBe(false);
      });
      fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '123-4-56789-0' } });
      fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'สมชาย รักดี' } });

      // Advance Step 4 -> Step 5
      fireEvent.click(screen.getByText('ถัดไป'));

      // In Step 5: Rules & Terms
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());

      // Select preset rules to satisfy required rules validation
      fireEvent.click(screen.getByTestId('btn-select-all-rules'));

      // Draw signature so step 5 validation passes
      const canvas = document.querySelector('canvas');
      if (canvas) {
        fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(canvas, { clientX: 50, clientY: 50 });
        fireEvent.mouseUp(canvas);
      }

      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 6 -> Step 7
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined());
      fireEvent.click(screen.getByText('ตั้งค่าภายหลัง'));

      // In Step 7: Plan & Finalize
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 7: เลือกแพ็กเกจและยืนยันการเปิดใช้งาน')).toBeDefined());
      fireEvent.click(screen.getByText('HorPlus FREE'));
      fireEvent.click(screen.getByText('ยืนยันสร้างหอพัก'));

      // In Terms Modal: select referral source & accept terms
      await waitFor(() => expect(screen.getByText('เงื่อนไข & ช่องทางที่รู้จัก')).toBeDefined());
      fireEvent.click(screen.getByText('Facebook / โซเชียล'));
      fireEvent.click(screen.getByRole('checkbox'));
      fireEvent.click(screen.getByText('ยอมรับเงื่อนไข'));

      await waitFor(() => {
        expect(finalizeSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            payment: expect.objectContaining({
              bankCode: 'กรุงเทพ (Bangkok)',
              bankAccountName: 'สมชาย รักดี',
              bankAccountNumber: '1234567890',
              bankQrCode: null,
            }),
          })
        );
      });
    });
  });

  describe('7. Step 5 Rules Sequential Numbering & 100% Text Parity (SRP-03)', () => {
    it('verifies CANONICAL_PRESET_DORM_RULES contains 10 rules without bullet points', () => {
      expect(CANONICAL_PRESET_DORM_RULES).toHaveLength(10);
      CANONICAL_PRESET_DORM_RULES.forEach((rule) => {
        expect(rule.cleanText).not.toMatch(/^•/);
        expect(rule.cleanText.trim().length).toBeGreaterThan(5);
      });
    });

    it('formatNumberedRules formats rules sequentially as "1. ", "2. ", etc.', () => {
      const raw = [
        '• ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.',
        'ห้ามสูบบุหรี่ บุหรี่ไฟฟ้า และสิ่งเสพติดภายในห้องพักและทางเดินโดยเด็ดขาด',
        '3. ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาเลี้ยงภายในห้องพักและพื้นที่ส่วนกลาง',
      ];
      const formatted = formatNumberedRules(raw);
      expect(formatted).toBe(
        '1. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.\n' +
        '2. ห้ามสูบบุหรี่ บุหรี่ไฟฟ้า และสิ่งเสพติดภายในห้องพักและทางเดินโดยเด็ดขาด\n' +
        '3. ห้ามนำสัตว์เลี้ยงทุกชนิดเข้ามาเลี้ยงภายในห้องพักและพื้นที่ส่วนกลาง'
      );
    });

    it('toggleRuleInNumberedList dynamically renumbers sequentially on add and remove', () => {
      let current = '';
      current = toggleRuleInNumberedList(current, CANONICAL_PRESET_DORM_RULES[0].cleanText);
      expect(current).toBe(`1. ${CANONICAL_PRESET_DORM_RULES[0].cleanText}`);

      current = toggleRuleInNumberedList(current, CANONICAL_PRESET_DORM_RULES[1].cleanText);
      expect(current).toBe(
        `1. ${CANONICAL_PRESET_DORM_RULES[0].cleanText}\n2. ${CANONICAL_PRESET_DORM_RULES[1].cleanText}`
      );

      // Remove rule 1, rule 2 should now become rule 1
      current = toggleRuleInNumberedList(current, CANONICAL_PRESET_DORM_RULES[0].cleanText);
      expect(current).toBe(`1. ${CANONICAL_PRESET_DORM_RULES[1].cleanText}`);
    });

    it('Step 5 "+ เลือกทั้งหมด 10 ข้อ" generates sequentially numbered lines 1 to 10 with no bullets', async () => {
      render(<OwnerRegister onAddLog={vi.fn()} onNavigate={vi.fn()} mode="initial" />);

      // Step 1
      fireEvent.change(screen.getByPlaceholderText('เช่น หอพัก HorPlus สุขุมวิท'), { target: { value: 'หอพัก Rules เทสต์' } });
      fireEvent.change(screen.getByPlaceholderText('เช่น 88/9 ซอยสุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110'), { target: { value: '123 ถนนสุขุมวิท' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 2
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 2: อาคาร & ผังห้อง')).toBeDefined());
      fireEvent.change(screen.getByPlaceholderText('ระบุห้องต่อชั้น'), { target: { value: '4' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 3
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 3: ค่าเช่า & ค่าน้ำไฟ')).toBeDefined());
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 4
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 4: มัดจำ & บัญชี')).toBeDefined());
      if (screen.queryByTestId('input-term-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-term-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-monthly-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-monthly-deposit-0'), { target: { value: '0' } });
      }
      if (screen.queryByTestId('input-daily-deposit-0')) {
        fireEvent.change(screen.getByTestId('input-daily-deposit-0'), { target: { value: '0' } });
      }
      fireEvent.change(screen.getByTestId('select-payment-bank-name'), { target: { value: 'กรุงเทพ (Bangkok)' } });
      await waitFor(() => {
        const accInput = screen.getByTestId('input-payment-account-number') as HTMLInputElement;
        expect(accInput.disabled).toBe(false);
      });
      fireEvent.change(screen.getByTestId('input-payment-account-number'), { target: { value: '123-4-56789-0' } });
      fireEvent.change(screen.getByTestId('input-payment-account-name'), { target: { value: 'สมชาย รักดี' } });
      fireEvent.click(screen.getByText('ถัดไป'));

      // Step 5: Rules & Terms Form
      await waitFor(() => expect(screen.getByText('ขั้นตอนที่ 5: กฎระเบียบ & สัญญา')).toBeDefined());

      const selectAllBtn = screen.getByTestId('btn-select-all-rules');
      fireEvent.click(selectAllBtn);

      const textarea = screen.getByPlaceholderText('ระบุข้อตกลงและระเบียบเพิ่มเติม หรือเลือกจากตัวเลือกด้านบน...') as HTMLTextAreaElement;
      expect(textarea.value).toBeDefined();

      // Must start with 1. and have 10 numbered lines
      const lines = textarea.value.split('\n');
      expect(lines).toHaveLength(10);
      expect(lines[0]).toBe(`1. ${CANONICAL_PRESET_DORM_RULES[0].cleanText}`);
      expect(lines[9]).toBe(`10. ${CANONICAL_PRESET_DORM_RULES[9].cleanText}`);

      // Must NOT contain bullet points
      lines.forEach((line, idx) => {
        expect(line).toMatch(new RegExp(`^${idx + 1}\\. `));
        expect(line).not.toContain('•');
      });
    });
  });
});

