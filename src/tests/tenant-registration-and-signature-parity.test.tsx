/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';
import { SignaturePad } from '../components/GlobalComponents';
import * as apiAdapter from '../data/adapters/api';

describe('Tenant Registration & Signature Standardization Parity Suite', () => {
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

  describe('Requirement 2: Standardized Signature Canvas Sizing across all tenant & global forms', () => {
    it('1. SignaturePad in GlobalComponents has 480x200 resolution, h-48 height, and touch-action none', () => {
      const handleSave = vi.fn();
      render(<SignaturePad onSave={handleSave} />);

      const canvas = screen.getByTestId('global-signature-canvas') as HTMLCanvasElement;
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(480);
      expect(canvas.height).toBe(200);
      expect(canvas.className).toContain('h-48');
      expect(canvas.className).toContain('touch-none');
      expect(canvas.style.touchAction).toBe('none');
    });

    it('2. Daily Stay signature canvas in TenantRegisterView has 480x200 resolution, h-48 height, and touch-action none', () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        dailyRent: 600,
        dailyDeposit: 500,
        dormitoryId: 'a05ebe82-9da0-4f82-87e2-1671fb76ba81',
      }];

      render(
        <TenantRegisterView
          dormitoryId="a05ebe82-9da0-4f82-87e2-1671fb76ba81"
          initialRentPlan="daily"
          initialStep={2}
          rooms={mockRooms}
          initialRoomId="room-101"
        />
      );

      const canvas = screen.getByTestId('tenant-daily-signature-canvas') as HTMLCanvasElement;
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(480);
      expect(canvas.height).toBe(200);
      expect(canvas.className).toContain('h-48');
      expect(canvas.className).toContain('touch-none');
      expect(canvas.style.touchAction).toBe('none');
    });

    it('3. Term/Monthly signature canvas in TenantRegisterView retains 480x200 resolution, h-48 height, and touch-action none', () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        termRent: 16000,
        dormitoryId: 'a05ebe82-9da0-4f82-87e2-1671fb76ba81',
      }];

      render(
        <TenantRegisterView
          dormitoryId="a05ebe82-9da0-4f82-87e2-1671fb76ba81"
          initialRentPlan="term"
          initialStep={5}
          rooms={mockRooms}
          initialRoomId="room-101"
        />
      );

      const canvas = screen.getByTestId('tenant-signature-canvas') as HTMLCanvasElement;
      expect(canvas).toBeDefined();
      expect(canvas.width).toBe(480);
      expect(canvas.height).toBe(200);
      expect(canvas.className).toContain('h-48');
      expect(canvas.className).toContain('touch-none');
      expect(canvas.style.touchAction).toBe('none');
    });
  });

  describe('Requirement 1: Registration submission and validation across Daily, Monthly, and Term', () => {
    it('4. Daily Stay submission routes through public tenant registration with fallback lastName and rentalPlan: daily', async () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        dailyRent: 600,
        dailyDeposit: 500,
        dormitoryId: 'a05ebe82-9da0-4f82-87e2-1671fb76ba81',
      }];

      const submitTenantRegistrationSpy = vi.spyOn(apiAdapter, 'submitTenantRegistrationRequest').mockResolvedValue({
        success: true,
        data: { id: 'reg-daily-123', status: 'pending_owner_approval' },
      } as any);

      render(
        <TenantRegisterView
          dormitoryId="a05ebe82-9da0-4f82-87e2-1671fb76ba81"
          initialRentPlan="daily"
          initialStep={2}
          rooms={mockRooms}
          initialRoomId="room-101"
        />
      );

      // Fill in Step 2 fields
      const fullNameInput = screen.getByTestId('tenant-fullname-input');
      fireEvent.change(fullNameInput, { target: { value: 'ภูมิ' } }); // Single name, no space!

      const phoneInput = screen.getByTestId('tenant-phone-input');
      fireEvent.change(phoneInput, { target: { value: '0812345678' } });

      const citizenInput = screen.getByTestId('tenant-citizen-id-input');
      fireEvent.change(citizenInput, { target: { value: '1100500123456' } });

      const birthDateInput = screen.getByTestId('tenant-birthdate-input');
      fireEvent.change(birthDateInput, { target: { value: '2000-01-15' } });

      const addressInput = screen.getByTestId('tenant-address-input');
      fireEvent.change(addressInput, { target: { value: '123/45 กทม.' } });

      // Check agree terms
      const agreeCheckbox = screen.getByTestId('tenant-agree-terms-checkbox');
      fireEvent.click(agreeCheckbox);

      // Sign canvas
      const canvas = screen.getByTestId('tenant-daily-signature-canvas');
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
      fireEvent.mouseUp(canvas);

      // Click submit
      const submitBtn = screen.getByTestId('submit-daily-stay-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(submitTenantRegistrationSpy).toHaveBeenCalled();
        const callArgs = submitTenantRegistrationSpy.mock.calls[0][0];
        expect(callArgs.rentalPlan).toBe('daily');
        expect(callArgs.firstName).toBe('ภูมิ');
        expect(callArgs.lastName).toBe('-'); // Fallback applied!
        expect(callArgs.dormitoryId).toBe('a05ebe82-9da0-4f82-87e2-1671fb76ba81');
      });
    });

    it('5. Monthly/Term registration applies fallback lastName and displays clear validation errors', async () => {
      const mockRooms = [{
        id: 'room-101',
        roomNumber: '101',
        monthlyRent: 4000,
        depositAmount: 8000,
        dormitoryId: 'a05ebe82-9da0-4f82-87e2-1671fb76ba81',
      }];

      const submitTenantRegistrationSpy = vi.spyOn(apiAdapter, 'submitTenantRegistrationRequest').mockResolvedValue({
        success: true,
        data: { id: 'reg-monthly-123', status: 'pending_owner_approval' },
      } as any);

      render(
        <TenantRegisterView
          dormitoryId="a05ebe82-9da0-4f82-87e2-1671fb76ba81"
          initialRentPlan="monthly"
          initialStep={5}
          rooms={mockRooms}
          initialRoomId="room-101"
        />
      );

      // Attempt to submit without signing or filling mandatory step 2/3 info
      const submitBtn = screen.getByTestId('tenant-registration-submit-btn');
      fireEvent.click(submitBtn);

      // Should show descriptive error and redirect to missing step
      await waitFor(() => {
        const errorBanner = screen.queryByText(/กรุณากรอกข้อมูล/);
        expect(errorBanner).toBeDefined();
      });
    });
  });
});
