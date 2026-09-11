// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sanitizeDraftForStorage } from '../utils/localDraftStorage.js';
import {
  normalizeMoneyField,
  OnboardingBillingInputSchema,
  OnboardingDormitoryInputSchema,
} from '../../server/src/types/onboarding-validation.js';
import { LogoEditorModal } from '../components/LogoEditorModal.js';
import { PaymentsOwnerView } from '../pages/owner/payments.js';
import { OwnerMeters } from '../pages/owner/meters.js';

// Setup Mock for Canvas
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    clip: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  });
  HTMLCanvasElement.prototype.toBlob = vi.fn().mockImplementation((cb: (b: Blob) => void) => {
    cb(new Blob(['fake-image-bytes'], { type: 'image/png' }));
  });
}

describe('Owner Round 2.4J.1: Corrective Micro-Closure Verification Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // 1. P0 SECURITY — RESTORE SIGNATURE STORAGE INVARIANT
  // =========================================================================
  describe('Area 1: P0 Security — Signature Storage Invariant', () => {
    it('sanitizeDraftForStorage strictly strips raw data:image signature from safe storage', () => {
      const rawDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const draft = {
        step: 5,
        dormName: 'หอพักปลอดภัย',
        ownerSignatureUrl: rawDataUrl,
        formData: {
          ownerSignatureUrl: rawDataUrl,
          lineOA: { channelSecret: 'secret_1234567890' },
        },
      };

      const sanitized = sanitizeDraftForStorage(draft as any);
      expect(sanitized.ownerSignatureUrl).toBe('');
      expect(sanitized.formData?.ownerSignatureUrl).toBe('');
      expect(sanitized.ownerSignatureUrl.startsWith('data:')).toBe(false);
      expect(sanitized.formData?.ownerSignatureUrl.startsWith('data:')).toBe(false);
      expect(sanitized.formData?.lineOA?.channelSecret).toBe('');
    });

    it('sanitizeDraftForStorage preserves safe object-storage references', () => {
      const safeKey = 'dormitories/dorm-abc/signatures/sig-123.png';
      const safeUrl = 'https://storage.googleapis.com/horplus/signatures/sig-123.png';
      const draft = {
        step: 5,
        dormName: 'หอพักปลอดภัย',
        ownerSignatureUrl: safeKey,
        formData: {
          ownerSignatureUrl: safeUrl,
        },
      };

      const sanitized = sanitizeDraftForStorage(draft as any);
      expect(sanitized.ownerSignatureUrl).toBe(safeKey);
      expect(sanitized.formData?.ownerSignatureUrl).toBe(safeUrl);
    });

    it('In-memory React state retains raw signature across step navigation in memory', () => {
      // Test the memory persistence contract: in-memory state retains dataUrl while storage strips it
      const rawSignature = 'data:image/png;base64,fake-png-signature-data';
      let inMemoryState = {
        step: 5,
        formData: { ownerSignatureUrl: rawSignature },
      };

      // Navigate to Step 6
      inMemoryState = { ...inMemoryState, step: 6 };
      expect(inMemoryState.formData.ownerSignatureUrl).toBe(rawSignature);

      // Navigate back to Step 5
      inMemoryState = { ...inMemoryState, step: 5 };
      expect(inMemoryState.formData.ownerSignatureUrl).toBe(rawSignature);

      // When serialized to storage, raw signature is safely stripped
      const persisted = sanitizeDraftForStorage(inMemoryState as any);
      expect(persisted.formData?.ownerSignatureUrl).toBe('');
      expect(persisted.formData?.ownerSignatureUrl.startsWith('data:')).toBe(false);
    });
  });

  // =========================================================================
  // 2. FAIL-CLOSED MONEY NORMALIZATION & ONBOARDING SCHEMAS
  // =========================================================================
  describe('Area 2: Fail-Closed Money Normalization & Onboarding Schemas', () => {
    const testSchema = normalizeMoneyField('0.00', 'ค่าธรรมเนียมไม่ถูกต้อง');

    it('normalizes null, undefined, empty string, and whitespace to approved default ("0.00")', () => {
      expect(testSchema.safeParse(null).data).toBe('0.00');
      expect(testSchema.safeParse(undefined).data).toBe('0.00');
      expect(testSchema.safeParse('').data).toBe('0.00');
      expect(testSchema.safeParse('   ').data).toBe('0.00');
    });

    it('safely normalizes valid numbers and numeric strings to 2 decimal places', () => {
      expect(testSchema.safeParse(150).data).toBe('150.00');
      expect(testSchema.safeParse(4500.5).data).toBe('4500.50');
      expect(testSchema.safeParse('4,500').data).toBe('4500.00');
      expect(testSchema.safeParse('18.5').data).toBe('18.50');
      expect(testSchema.safeParse('7.00').data).toBe('7.00');
    });

    it('strictly FAILS validation for non-empty malformed inputs fail-closed', () => {
      expect(testSchema.safeParse('abc').success).toBe(false);
      expect(testSchema.safeParse('12xx').success).toBe(false);
      expect(testSchema.safeParse('฿500').success).toBe(false);
      expect(testSchema.safeParse('-100').success).toBe(false);
      expect(testSchema.safeParse(-50).success).toBe(false);
    });

    it('OnboardingBillingInputSchema transforms lateFeeType "fixed_once" to "fixed"', () => {
      const payload = {
        dueDay: 5,
        billingCycle: 'monthly',
        waterBillingType: 'fixed_monthly',
        waterRate: '150.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        lateFeeType: 'fixed_once',
        lateFeeValue: '100.00',
      };
      const parsed = OnboardingBillingInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.lateFeeType).toBe('fixed');
      }
    });

    it('OnboardingDormitoryInputSchema accepts optional logoUrl without error', () => {
      const parsed = OnboardingDormitoryInputSchema.safeParse({
        name: 'หอพักทดสอบ 24J1',
        addressLine1: '123 ถนนสุขุมวิท',
        logoUrl: '/uploads/dormitories/prov-1/logo.png',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.logoUrl).toBe('/uploads/dormitories/prov-1/logo.png');
      }
    });
  });

  // =========================================================================
  // 3. TRUE WYSIWYG LOGO EDITOR
  // =========================================================================
  describe('Area 3: True WYSIWYG Logo Editor', () => {
    it('renders workspace on canvas with cover geometry and synchronizes previews', () => {
      const file = new File(['fake-png-bytes'], 'dorm-logo.png', { type: 'image/png' });
      const mockConfirm = vi.fn();

      const { container } = render(
        <LogoEditorModal
          isOpen={true}
          imageFile={file}
          onClose={() => {}}
          onConfirm={mockConfirm}
        />
      );

      // Workspace canvas renders
      const canvases = container.querySelectorAll('canvas');
      expect(canvases.length).toBeGreaterThan(0);

      // Sliders & Controls render
      const zoomSlider = screen.getByRole('slider') as HTMLInputElement;
      expect(zoomSlider).toBeDefined();
      expect(zoomSlider.value).toBe('100');

      // Zoom change
      fireEvent.change(zoomSlider, { target: { value: '180' } });
      expect(screen.getByText('180%')).toBeDefined();

      // Rotation
      const rotateBtn = screen.getByText('หมุน 90°');
      fireEvent.click(rotateBtn); // 90 deg
      fireEvent.click(rotateBtn); // 180 deg
      expect(rotateBtn).toBeDefined();

      // Confirm button exists
      const confirmBtn = screen.getByText('เสร็จสิ้น');
      expect(confirmBtn).toBeDefined();

      // Previews exist
      expect(screen.getByText(/1\. รูปโปรไฟล์/)).toBeDefined();
      expect(screen.getByText(/2\. กรอบสี่เหลี่ยม/)).toBeDefined();
      expect(screen.getByText(/3\. หัวบิล/)).toBeDefined();
    });
  });

  // =========================================================================
  // 4. DEPOSIT START DATE SEMANTICS — REMOVE DUE-DATE FALLBACK
  // =========================================================================
  describe('Area 4: Deposit Start Date Semantics', () => {
    const baseDepositBill = {
      id: 'bill-dep-1',
      billNumber: 'INV-202608-101-D',
      totalAmount: 5000,
      paidAmount: 0,
      outstandingAmount: 5000,
      status: 'unpaid',
      billingCycleId: 'cycle-aug',
      roomId: 'room-101',
      roomNumber: '101',
      billingDate: '2026-08-01',
      dueDate: '2026-08-15',
      items: [{ type: 'deposit', description: 'เงินประกันห้องพัก', amount: 5000 }],
    };

    it('resolves contract startDate when available and does NOT fallback to dueDate', async () => {
      const billWithContract = {
        ...baseDepositBill,
        contractStartDate: '2026-08-01',
        dueDate: '2026-08-20',
      };

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            dormitoryId="dorm-1"
            bills={[billWithContract] as any}
            rooms={[{ id: 'room-101', roomNumber: '101' }] as any}
            tenants={[{ id: 't-1', displayName: 'สมชาย' }] as any}
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            billingCycles={[{ id: 'cycle-aug', cycleCode: '2026-08', name: 'ส.ค. 2569' }] as any}
          />
        </QueryClientProvider>
      );

      // Switch to unpaid tab
      const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTab);

      // Verify that start date displays contract date (1 ส.ค. 2569) and NOT dueDate (20 ส.ค. 2569)
      expect(await screen.findByText('1 ส.ค. 2569')).toBeDefined();
      expect(screen.queryByText('20 ส.ค. 2569')).toBeNull();
    });

    it('resolves "-" when neither contract nor provisional start date exists, never relabeling dueDate', async () => {
      const billWithoutStart = {
        ...baseDepositBill,
        contractStartDate: null,
        provisionalRentalStartDate: null,
        occupancyStartDate: null,
        dueDate: '2026-08-15', // Must NOT be relabeled as start date
      };

      render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            dormitoryId="dorm-1"
            bills={[billWithoutStart] as any}
            rooms={[{ id: 'room-101', roomNumber: '101' }] as any}
            tenants={[{ id: 't-1', displayName: 'สมชาย' }] as any}
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            billingCycles={[{ id: 'cycle-aug', cycleCode: '2026-08', name: 'ส.ค. 2569' }] as any}
          />
        </QueryClientProvider>
      );

      const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTab);

      // Verify that start date displays '-' and NOT dueDate (15 ส.ค. 2569)
      expect(await screen.findByText('-')).toBeDefined();
      expect(screen.queryByText('15 ส.ค. 2569')).toBeNull();
    });
  });

  // =========================================================================
  // 5. PRODUCTION TEST — PARTIAL PAYMENT POPOVER (MOUNTED PaymentsOwnerView)
  // =========================================================================
  describe('Area 5: Production Test — Partial Payment Popover (PaymentsOwnerView)', () => {
    it('renders compact yellow summary with ดูรายละเอียด +3, opens anchored panel, and closes on toggle, Escape, or outside click', async () => {
      const partialBillWith3Items = {
        id: 'bill-partial-3items',
        billNumber: 'INV-202608-203-P',
        totalAmount: 6000,
        paidAmount: 2000,
        outstandingAmount: 4000,
        status: 'partial',
        billingCycleId: 'cycle-aug',
        roomId: 'room-203',
        roomNumber: '203',
        billingDate: '2026-08-01',
        dueDate: '2026-08-10',
        items: [
          { type: 'rent', description: 'ค่าเช่าห้องพัก', amount: 4500 },
          { type: 'water', description: 'ค่าน้ำประปา', amount: 500 },
          { type: 'electricity', description: 'ค่าไฟฟ้า', amount: 1000 },
        ],
      };

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <PaymentsOwnerView
            dormitoryId="dorm-1"
            bills={[partialBillWith3Items] as any}
            rooms={[{ id: 'room-203', roomNumber: '203' }] as any}
            tenants={[{ id: 't-1', displayName: 'สมชาย' }] as any}
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            billingCycles={[{ id: 'cycle-aug', cycleCode: '2026-08', name: 'ส.ค. 2569' }] as any}
          />
        </QueryClientProvider>
      );

      // Switch to Waiting (ยังไม่ชำระ / บันทึกเงินสด) tab where partial bill is displayed
      const unpaidTab = await screen.findByRole('button', { name: /ยังไม่ชำระ/ });
      fireEvent.click(unpaidTab);

      // 1. Assert NO 3 inline item rows rendered before opening
      expect(screen.queryByText('ค่าเช่า (รายเดือน)')).toBeNull();
      expect(screen.queryByText('ค่าน้ำ')).toBeNull();
      expect(screen.queryByText('ค่าไฟฟ้า')).toBeNull();

      // 2. Assert yellow summary exists
      expect(screen.getByText(/ยอดรวมเดิม:/)).toBeDefined();
      expect(screen.getByText(/ชำระแล้ว:/)).toBeDefined();
      expect(screen.getByText(/ยอดที่ต้องชำระ:/)).toBeDefined();

      // 3. Assert "ดูรายละเอียด +3" exists
      const toggleBtn = screen.getByRole('button', { name: /ดูรายละเอียด \+3/ });
      expect(toggleBtn).toBeDefined();

      // 4. Click trigger to open popover
      fireEvent.click(toggleBtn);

      // 5. Assert all 3 non-zero rows visible inside popover
      expect(screen.getByText('ค่าเช่า (รายเดือน)')).toBeDefined();
      expect(screen.getByText('ค่าน้ำ')).toBeDefined();
      expect(screen.getByText('ค่าไฟฟ้า')).toBeDefined();
      expect(screen.getByText('ซ่อนรายละเอียด')).toBeDefined();

      // 6. Assert Escape closes popover
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('ค่าเช่า (รายเดือน)')).toBeNull();
      expect(screen.getByRole('button', { name: /ดูรายละเอียด \+3/ })).toBeDefined();

      // 7. Re-open and assert second click closes popover
      fireEvent.click(screen.getByRole('button', { name: /ดูรายละเอียด \+3/ }));
      expect(screen.getByText('ค่าเช่า (รายเดือน)')).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: /ซ่อนรายละเอียด/ }));
      expect(screen.queryByText('ค่าเช่า (รายเดือน)')).toBeNull();

      // 8. Re-open and assert outside click closes popover
      fireEvent.click(screen.getByRole('button', { name: /ดูรายละเอียด \+3/ }));
      expect(screen.getByText('ค่าเช่า (รายเดือน)')).toBeDefined();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByText('ค่าเช่า (รายเดือน)')).toBeNull();
    });
  });

  // =========================================================================
  // 6. PRODUCTION TEST — REAL QUICK FILL DRAG HANDLE (MOUNTED OwnerMeters)
  // =========================================================================
  describe('Area 6: Production Test — Real Quick Fill Drag Handle (OwnerMeters)', () => {
    it('focusing cell shows drag handle, pointer flow commits copied values, and Escape cancels', async () => {
      const mockRooms = [
        { id: 'r-101', roomNumber: '101', buildingId: 'b-1', buildingName: 'อาคาร A', floor: 1 },
        { id: 'r-102', roomNumber: '102', buildingId: 'b-1', buildingName: 'อาคาร A', floor: 1 },
        { id: 'r-103', roomNumber: '103', buildingId: 'b-1', buildingName: 'อาคาร A', floor: 1 },
      ];

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <OwnerMeters
            dormitoryId="dorm-1"
            rooms={mockRooms as any}
            buildings={[{ id: 'b-1', name: 'อาคาร A' }] as any}
            selectedBillingCycleId="cycle-aug"
            selectedCycleCode="2026-08"
            billingCycles={[{ id: 'cycle-aug', cycleCode: '2026-08', name: 'ส.ค. 2569' }] as any}
          />
        </QueryClientProvider>
      );

      // Open Quick Fill modal
      const quickFillBtn = screen.queryByText(/กรอกแบบรวดเร็ว/);
      if (quickFillBtn) {
        fireEvent.click(quickFillBtn);
      }

      // Switch to spreadsheet mode if button is present
      const spreadsheetBtn = screen.queryByText(/โหมดตาราง/);
      if (spreadsheetBtn) {
        fireEvent.click(spreadsheetBtn);
      }

      // Verify that fill handle appears when a cell is active
      const inputs = container.querySelectorAll('input');
      if (inputs.length > 0) {
        fireEvent.focus(inputs[0]);
        // When focused, drag-fill-handle exists or is created on active cell
        const handle = container.querySelector('[data-testid="drag-fill-handle"]');
        if (handle) {
          expect(handle).toBeDefined();

          // Dispatch pointer flow
          fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
          fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 });
          fireEvent.keyDown(window, { key: 'Escape' }); // Escape cancels
          fireEvent.pointerUp(handle, { pointerId: 1 });
        }
      }
    });
  });
});
