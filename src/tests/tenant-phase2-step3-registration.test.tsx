/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * @vitest-environment happy-dom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import * as apiAdapter from '../data/adapters/api';
import * as httpClient from '../data/httpClient';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';
import { TenantRegisterPage } from '../pages/tenant/TenantRegisterPage';

describe('TENANT PHASE 2 Step 3 — Registration Flow & Claim Implementation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    if (typeof window !== 'undefined') {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  const mockRooms = [
    {
      id: 'room-101',
      roomNumber: '101',
      floor: 1,
      monthlyRent: 4500,
      depositAmount: 5000,
      status: 'vacant',
      isVacant: true,
      isUnboundClaimable: false,
    },
    {
      id: 'room-102',
      roomNumber: '102',
      floor: 1,
      monthlyRent: 5000,
      depositAmount: 6000,
      status: 'occupied',
      isVacant: false,
      isUnboundClaimable: true, // Owner-created tenant, waiting for claim
      candidateNameMasked: 'สม***',
      candidatePhoneMasked: '081-***-7890',
    },
  ];

  const mockPolicy = {
    dormitoryId: 'dorm-001',
    dormitoryName: 'HorPlus Premier Residence',
    defaultTerms: '1. ห้ามสูบบุหรี่\n2. ค่าเช่าชำระวันที่ 5',
    petPolicy: { allowed: 'conditional', allowedTypes: ['cat', 'dog'] },
    version: 1,
  };

  // Helper to mock canvas getContext and bounding rect
  const setupCanvasMock = () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      clearRect: vi.fn(),
    });
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      width: 340,
      height: 130,
      right: 340,
      bottom: 130,
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,MOCK_CANVAS_SIG');
  };

  describe('1. Canonical Status Badges & Step Labels', () => {
    it('displays canonical status label "ลงทะเบียนผู้เช่า" by default in TenantRegisterView', () => {
      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      expect(screen.getByText('ลงทะเบียนผู้เช่า')).toBeDefined();
      expect(document.body.textContent).toContain('ขั้นตอน 1/7: เลือกห้อง');
    });

    it('displays canonical status label "กรุณาตรวจสอบอีกครั้ง" when revision is requested (Option B)', () => {
      const mockRevisionRequest = {
        id: 'req-revision-001',
        status: 'revision_requested',
        rejectedReason: 'กรุณาอัปโหลดรูปบัตรประชาชนให้ชัดเจนกว่าเดิม',
        acceptanceSnapshot: {
          currentOwnerComment: 'กรุณาอัปโหลดรูปบัตรประชาชนให้ชัดเจนกว่าเดิม',
          fullName: 'สมชาย ผู้สมัคร',
          phone: '0812345678',
        },
      };

      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          revisionRequest={mockRevisionRequest}
        />
      );

      // Verify the canonical badge
      expect(screen.getByText('กรุณาตรวจสอบอีกครั้ง')).toBeDefined();
      // Verify the owner comment banner
      expect(screen.getByText(/คำขอถูกส่งกลับเพื่อแก้ไข/)).toBeDefined();
      expect(screen.getByText(/กรุณาอัปโหลดรูปบัตรประชาชนให้ชัดเจนกว่าเดิม/)).toBeDefined();
    });
  });

  describe('2. Owner-created Tenant Claim Flow (Scenario A)', () => {
    it('requires Single-Field Identity Verification when unbound claimable room is selected', async () => {
      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Select room 102 (claimable)
      const roomSelect = screen.getByTestId('tenant-registration-room-select');
      fireEvent.change(roomSelect, { target: { value: 'room-102' } });

      // Verify verification card appears
      expect(screen.getByText(/ห้องนี้ถูกสร้างโดยเจ้าของหอพักแล้ว/)).toBeDefined();
      expect(screen.getByTestId('tenant-claim-input')).toBeDefined();
      expect(screen.getByTestId('tenant-claim-verify-btn')).toBeDefined();
    });

    it('verifies identity and locks financial terms (read-only) upon valid claim', async () => {
      const verifyClaimSpy = vi.spyOn(apiAdapter, 'verifyTenantClaim').mockResolvedValue({
        success: true,
        data: {
          verified: true,
          tenantId: 'tenant-claim-001',
          displayName: 'นาย สมชาย ใจดี',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
          phone: '0812347890',
          citizenId: '1-1002-00034-56-7',
          room: { id: 'room-102', roomNumber: '102' },
          lockedFinancials: {
            monthlyRent: 5000,
            depositAmount: 6000,
            advancePaymentAmount: 5000,
            durationMonths: 12,
            rentalType: 'monthly',
            depositStatus: 'paid',
            terms: 'เงื่อนไขมาตรฐาน',
          },
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Select claimable room
      const roomSelect = screen.getByTestId('tenant-registration-room-select');
      fireEvent.change(roomSelect, { target: { value: 'room-102' } });

      // Enter claim input (phone or name)
      const claimInput = screen.getByTestId('tenant-claim-input');
      fireEvent.change(claimInput, { target: { value: '0812347890' } });

      // Click verify
      const verifyBtn = screen.getByTestId('tenant-claim-verify-btn');
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(verifyClaimSpy).toHaveBeenCalledWith({
          dormitoryId: 'dorm-001',
          roomId: 'room-102',
          claimInput: '0812347890',
          inviteToken: undefined,
        });
      });

      // Verify success notification and locked financials notification
      await waitFor(() => {
        expect(screen.getByText(/ยืนยันตัวตนสำเร็จ ข้อมูลสัญญาและค่าเช่าถูกล็อกตามที่เจ้าของหอพักกำหนด/)).toBeDefined();
      });

      // Verify Step 3 displays locked banner
      expect(screen.getByText(/ข้อมูลสัญญาและค่าเช่าถูกกำหนดโดยเจ้าของหอพักแล้ว/)).toBeDefined();
    });

    it('submits claim via completeTenantClaim and transitions immediately to REGISTERED', async () => {
      setupCanvasMock();

      vi.spyOn(apiAdapter, 'verifyTenantClaim').mockResolvedValue({
        success: true,
        data: {
          verified: true,
          tenantId: 'tenant-claim-001',
          displayName: 'นาย สมชาย ใจดี',
          firstName: 'สมชาย',
          lastName: 'ใจดี',
          phone: '0812347890',
          citizenId: '1-1002-00034-56-7',
          room: { id: 'room-102', roomNumber: '102' },
          lockedFinancials: {
            monthlyRent: 5000,
            depositAmount: 6000,
            advancePaymentAmount: 5000,
            durationMonths: 12,
            rentalType: 'monthly',
            depositStatus: 'paid',
            terms: 'เงื่อนไขมาตรฐาน',
          },
        },
      });

      const completeClaimSpy = vi.spyOn(apiAdapter, 'completeTenantClaim').mockResolvedValue({
        success: true,
        data: {
          success: true,
          tenant: { id: 'tenant-claim-001', name: 'นาย สมชาย ใจดี', status: 'active', lifecycleStage: 'REGISTERED' },
          contractId: 'contract-001',
          lifecycleStage: 'REGISTERED',
          message: 'ยืนยันสิทธิ์ผู้เช่าและบันทึกสัญญาเรียบร้อยแล้ว',
        },
      });

      const onSuccessMock = vi.fn();

      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          onSuccess={onSuccessMock}
        />
      );

      // Select room 102
      fireEvent.change(screen.getByTestId('tenant-registration-room-select'), { target: { value: 'room-102' } });

      // Verify claim
      fireEvent.change(screen.getByTestId('tenant-claim-input'), { target: { value: 'สมชาย ใจดี' } });
      fireEvent.click(screen.getByTestId('tenant-claim-verify-btn'));

      await waitFor(() => {
        expect(screen.getByText(/ยืนยันตัวตนสำเร็จ/)).toBeDefined();
      });

      // Agree to legal terms
      fireEvent.click(screen.getByTestId('tenant-agree-terms-checkbox'));

      // Simulate signature on canvas
      const canvas = document.querySelector('canvas');
      expect(canvas).not.toBeNull();
      fireEvent.mouseDown(canvas!, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas!, { clientX: 50, clientY: 50 });
      fireEvent.mouseUp(canvas!);

      // Click submit button
      const submitBtn = screen.getByTestId('tenant-registration-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(completeClaimSpy).toHaveBeenCalledWith(expect.objectContaining({
          dormitoryId: 'dorm-001',
          roomId: 'room-102',
          tenantId: 'tenant-claim-001',
          signatureBase64: 'data:image/png;base64,MOCK_CANVAS_SIG',
        }));
      });

      // Verify success screen indicates immediate completion
      await waitFor(() => {
        expect(screen.getByText('ลงทะเบียนและยืนยันสิทธิ์สำเร็จ!')).toBeDefined();
        expect(document.body.textContent).toContain('ลงทะเบียนผู้เช่า');
        expect(document.body.textContent).toContain('ยืนยันสิทธิ์ผู้เช่าและบันทึกสัญญาเรียบร้อยแล้ว');
      });

      expect(onSuccessMock).toHaveBeenCalled();
    });
  });

  describe('3. Public Self-Registration Flow (Vacant Room)', () => {
    it('submits proposed financials and results in pending_owner_approval', async () => {
      setupCanvasMock();

      const submitSpy = vi.spyOn(apiAdapter, 'submitTenantRegistrationRequest').mockResolvedValue({
        success: true,
        data: {
          id: 'req-public-001',
          status: 'pending_owner_approval',
          firstName: 'วิภาวี',
          lastName: 'สุวรรณ',
          phone: '0891234567',
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Fill in tenant profile
      fireEvent.change(screen.getByPlaceholderText('เช่น สมชาย ใจดี'), { target: { value: 'วิภาวี สุวรรณ' } });
      fireEvent.change(screen.getByPlaceholderText('081-234-5678'), { target: { value: '0891234567' } });
      fireEvent.change(screen.getByPlaceholderText('1-2345-67890-12-3'), { target: { value: '1100200345678' } });

      // Agree to terms
      fireEvent.click(screen.getByTestId('tenant-agree-terms-checkbox'));

      // Draw signature
      const canvas = document.querySelector('canvas');
      fireEvent.mouseDown(canvas!, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas!, { clientX: 60, clientY: 60 });
      fireEvent.mouseUp(canvas!);

      // Submit public registration
      const submitBtn = screen.getByTestId('tenant-registration-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({
          dormitoryId: 'dorm-001',
          requestedRoomId: 'room-101',
          firstName: 'วิภาวี',
          lastName: 'สุวรรณ',
          phone: '089-123-4567',
          agreedTerms: true,
          signatureBase64: 'data:image/png;base64,MOCK_CANVAS_SIG',
        }));
      });

      // Verify pending owner approval result
      await waitFor(() => {
        expect(screen.getByText('ส่งคำขอลงทะเบียนเรียบร้อยแล้ว')).toBeDefined();
        expect(document.body.textContent).toContain('รออนุมัติคำขอผู้เช่า');
      });
    });
  });

  describe('4. Option B Revision / Resubmission Flow', () => {
    it('resubmits modified data to resubmitTenantRegistrationRequest and resets to pending approval', async () => {
      setupCanvasMock();

      const mockRevisionRequest = {
        id: 'req-revision-123',
        status: 'revision_requested',
        rejectedReason: 'กรุณาแก้ไขเบอร์โทรศัพท์ให้ถูกต้อง',
        acceptanceSnapshot: {
          currentOwnerComment: 'กรุณาแก้ไขเบอร์โทรศัพท์ให้ถูกต้อง',
          requestedRoomId: 'room-101',
          fullName: 'สมคิด มั่นคง',
          phone: '0810000000',
          citizenId: '1-1002-00034-56-7',
          proposedRent: 4500,
          proposedDeposit: 5000,
          durationMonths: 12,
        },
      };

      const resubmitSpy = vi.spyOn(apiAdapter, 'resubmitTenantRegistrationRequest').mockResolvedValue({
        success: true,
        data: {
          id: 'req-revision-123',
          status: 'pending_owner_approval',
          firstName: 'สมคิด',
          lastName: 'มั่นคง',
          phone: '0819999999',
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          revisionRequest={mockRevisionRequest}
        />
      );

      // Verify pre-population from snapshot
      expect(screen.getByDisplayValue('สมคิด มั่นคง')).toBeDefined();

      // Fix phone
      const phoneInput = screen.getByPlaceholderText('081-234-5678');
      fireEvent.change(phoneInput, { target: { value: '0819999999' } });

      // Agree to terms & sign
      fireEvent.click(screen.getByTestId('tenant-agree-terms-checkbox'));
      const canvas = document.querySelector('canvas');
      fireEvent.mouseDown(canvas!, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas!, { clientX: 70, clientY: 70 });
      fireEvent.mouseUp(canvas!);

      // Submit revision button
      const resubmitBtn = screen.getByTestId('tenant-registration-submit-btn');
      fireEvent.click(resubmitBtn);

      await waitFor(() => {
        expect(resubmitSpy).toHaveBeenCalledWith('req-revision-123', expect.objectContaining({
          dormitoryId: 'dorm-001',
          requestedRoomId: 'room-101',
          phone: '081-999-9999',
        }));
      });

      // Verify status reset to pending approval
      await waitFor(() => {
        expect(screen.getByText('ส่งคำขอลงทะเบียนเรียบร้อยแล้ว')).toBeDefined();
        expect(document.body.textContent).toContain('ส่งข้อมูลที่แก้ไขเรียบร้อยแล้ว กรุณารอเจ้าของหอพักตรวจสอบ');
        expect(document.body.textContent).toContain('รออนุมัติคำขอผู้เช่า');
      });
    });
  });

  describe('5. Daily Stay Rental Path (Option C)', () => {
    it('adapts form and button for daily stay rentals', async () => {
      render(
        <TenantRegisterView
          rooms={mockRooms}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Select Daily rental plan in Step 3
      const dailyPlanBtn = screen.getByRole('button', { name: 'รายวัน' });
      fireEvent.click(dailyPlanBtn);

      // Check daily banner appears
      expect(screen.getByText(/การเข้าพักรายวัน ไม่ต้องทำสัญญาเช่าระยะยาว/)).toBeDefined();

      // Check submit button changes to daily text
      expect(screen.getByRole('button', { name: /ยืนยันคำขอเข้าพักรายวัน/ })).toBeDefined();
    });
  });

  describe('6. TenantRegisterPage Integration', () => {
    it('renders TenantRegisterView wizard as primary view while keeping modal action buttons', async () => {
      vi.spyOn(httpClient, 'httpRequest').mockImplementation(async (method, url) => {
        if (url.includes('public-policy')) {
          return {
            dormitoryId: 'dorm-001',
            dormitoryName: 'HorPlus Dormitory',
            defaultTerms: '',
            petPolicy: { allowed: 'none', allowedTypes: [] },
            version: 1,
          };
        }
        if (url.includes('public-rooms')) {
          return mockRooms;
        }
        return { success: true, data: [] };
      });

      render(<TenantRegisterPage />);

      // Verify quick modal buttons are accessible
      const dailyBtn = await screen.findByTestId('tenant-daily-request-btn');
      expect(dailyBtn).toBeDefined();
      const claimBtn = await screen.findByTestId('tenant-self-claim-btn');
      expect(claimBtn).toBeDefined();

      // Verify the 7-step wizard navigation is rendered
      await waitFor(() => {
        expect(screen.getByText('ลงทะเบียนผู้เช่าใหม่')).toBeDefined();
        expect(screen.getAllByText(/เลือกห้อง/).length).toBeGreaterThan(0);
      });
    });
  });
});
