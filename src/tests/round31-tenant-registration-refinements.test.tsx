/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerDateInput } from '../components/OwnerDateInput';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';
import { TenantApprovalModal } from '../components/TenantApprovalModal';

describe('Round 31: Tenant Registration Refinements Suite (Tickets #12 - #16)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      clearRect: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockedSignature');
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 480,
      height: 200,
    });
  });

  describe('Ticket 1 (#12): Date Input Direct Popover Authority & Keyboard Suppression', () => {
    it('CRIT-R31-DATE-READONLY-01: OwnerDateInput renders with readOnly=true and cursor-pointer to suppress keyboard', () => {
      const handleChange = vi.fn();
      render(
        <OwnerDateInput
          value="2026-08-20"
          onChange={handleChange}
          data-testid="test-date-input"
        />
      );

      const input = screen.getByTestId('test-date-input') as HTMLInputElement;
      expect(input).toBeDefined();
      expect(input.readOnly).toBe(true);
      expect(input.className).toContain('cursor-pointer');
    });

    it('CRIT-R31-DATE-CLICK-POPOVER-02: Clicking directly on the input field opens the calendar popover', () => {
      const handleChange = vi.fn();
      render(
        <OwnerDateInput
          value="2026-08-20"
          onChange={handleChange}
          data-testid="test-date-input"
        />
      );

      // Popover is initially closed
      expect(screen.queryByTestId('owner-date-input-popover')).toBeNull();

      // Click directly on the input box
      const input = screen.getByTestId('test-date-input');
      fireEvent.click(input);

      // Popover is now open
      expect(screen.getByTestId('owner-date-input-popover')).toBeDefined();
    });
  });

  describe('Ticket 2 (#13): Locked Wizard Layout & Overscroll Containment', () => {
    it('CRIT-R31-LOCKED-LAYOUT-01: TenantRegisterView isolates scrollable body between fixed header and locked footer', () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        termRent: 16000,
        depositAmount: 5000,
        selectable: true,
      }];

      const { container } = render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="form"
          initialRoomId="room-101"
          initialStep={1}
        />
      );

      // Independent scroll body exists
      const scrollBody = container.querySelector('#tenant-registration-scroll-body');
      expect(scrollBody).not.toBeNull();
      expect(scrollBody?.className).toContain('overflow-y-auto');
      expect(scrollBody?.className).toContain('overscroll-contain');

      // Next button is present in locked footer outside scroll body
      const nextBtn = screen.getByTestId('bottom-nav-next-btn');
      expect(nextBtn).toBeDefined();
      expect(scrollBody?.contains(nextBtn)).toBe(false);
    });
  });

  describe('Ticket 3 (#14): Pet Permission Quantity Normalization & End-to-End Persistence', () => {
    it('CRIT-R31-NO-PET-COUNT-01: Step 4 eliminates per-item count dropdown and displays 1 item per pet', () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        termRent: 16000,
        depositAmount: 5000,
        selectable: true,
      }];

      render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="form"
          initialRoomId="room-101"
          initialStep={4}
          policy={{ petPolicy: 'conditional' } as any}
        />
      );

      // Enable pet checkbox
      const petCheckbox = screen.getByLabelText(/ขออนุญาตเลี้ยงสัตว์เลี้ยง/i);
      fireEvent.click(petCheckbox);

      // Pet type select and name input are visible
      expect(screen.getByTestId('tenant-pet-type-select-0')).toBeDefined();
      expect(screen.getByPlaceholderText(/น้องส้ม/)).toBeDefined();

      // No dropdown containing "1 ตัว" or count select
      expect(screen.queryByText('1 ตัว')).toBeNull();
      expect(screen.queryByText('2 ตัว')).toBeNull();
    });

    it('CRIT-R31-APPROVAL-MODAL-PET-VEHICLE-02: TenantApprovalModal displays requested vehicles and pets', () => {
      const mockTenantWithPetsAndVehicles = {
        id: 'req-01',
        name: 'สมชาย ใจดี',
        phone: '0812345678',
        citizenId: '1234567890123',
        vehicles: [
          { type: 'car', brand: 'Toyota Corolla', licensePlate: '1กก-1234' },
        ],
        pets: [
          { type: 'cat', name: 'น้องส้ม' },
          { type: 'dog', name: 'เจ้าตูบ' },
        ],
      };

      render(
        <TenantApprovalModal
          isOpen={true}
          onClose={() => {}}
          onApprove={vi.fn()}
          onReject={vi.fn()}
          tenant={mockTenantWithPetsAndVehicles}
          rooms={[{ id: 'r1', roomNumber: '101', status: 'vacant' } as any]}
        />
      );

      expect(screen.getByText('ข้อมูลยานพาหนะ & การขอเลี้ยงสัตว์')).toBeDefined();
      expect(screen.getByText('1กก-1234')).toBeDefined();
      expect(screen.getByText('น้องส้ม')).toBeDefined();
      expect(screen.getByText('เจ้าตูบ')).toBeDefined();
      expect(screen.getByText(/2 ตัว/)).toBeDefined();
    });
  });

  describe('Ticket 4 (#15): High-Fidelity Pointer Capture Signature Pad & Ergonomics', () => {
    it('CRIT-R31-SIGNATURE-CANVAS-01: Canvas has touch-action: none, h-48 height, and receives pointer events', () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        termRent: 16000,
        depositAmount: 5000,
        selectable: true,
      }];

      render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="form"
          initialRoomId="room-101"
          initialStep={5}
        />
      );

      const canvas = screen.getByTestId('tenant-signature-canvas') as HTMLCanvasElement;
      expect(canvas).toBeDefined();
      expect(canvas.className).toContain('h-48');
      expect(canvas.className).toContain('touch-none');
      expect(canvas.style.touchAction).toBe('none');
      expect(canvas.width).toBe(480);
      expect(canvas.height).toBe(200);

      // Simulate pointer down to sign
      fireEvent.pointerDown(canvas, { clientX: 50, clientY: 50, pointerId: 1 });
      fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
      fireEvent.pointerUp(canvas, { clientX: 60, clientY: 60, pointerId: 1 });

      // Clear signature button is visible once signed
      expect(screen.getByText('ล้างลายเซ็น')).toBeDefined();

      // Click clear signature
      fireEvent.click(screen.getByText('ล้างลายเซ็น'));
      expect(screen.getByText('ใช้นิ้วหรือเมาส์วาดลายเซ็นของคุณที่นี่')).toBeDefined();
    });
  });
});
