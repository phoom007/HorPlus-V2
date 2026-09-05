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

describe('TENANT PHASE 2 Step 4 — Registration Domain Correction & Specification Verification', () => {
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

  const mockRoomsMatrix = [
    {
      id: 'room-vacant-1',
      roomNumber: '101',
      floor: 1,
      monthlyRent: 4000,
      depositAmount: 5000,
      status: 'vacant',
      selectable: true,
      selectionType: 'vacant',
      badgeLabel: 'ห้องว่าง',
      isVacant: true,
      isUnboundClaimable: false,
    },
    {
      id: 'room-claimable-2',
      roomNumber: '102',
      floor: 1,
      monthlyRent: 4500,
      depositAmount: 5500,
      status: 'occupied',
      selectable: true,
      selectionType: 'claimable',
      badgeLabel: 'ยังไม่ผูก LINE (ยืนยันสิทธิ์)',
      isVacant: false,
      isUnboundClaimable: true,
      candidate: {
        maskedName: 'สม***',
        maskedPhone: '081-***-7890',
      },
    },
    {
      id: 'room-bound-3',
      roomNumber: '103',
      floor: 1,
      monthlyRent: 5000,
      depositAmount: 6000,
      status: 'occupied',
      selectable: false,
      selectionType: 'bound',
      badgeLabel: 'มีผู้เช่าแล้ว (ผูก LINE แล้ว)',
      isVacant: false,
      isUnboundClaimable: false,
    },
    {
      id: 'room-maint-4',
      roomNumber: '104',
      floor: 1,
      monthlyRent: 4200,
      depositAmount: 5000,
      status: 'maintenance',
      selectable: false,
      selectionType: 'maintenance',
      badgeLabel: 'ปิดปรับปรุง',
      isVacant: false,
      isUnboundClaimable: false,
    },
  ];

  const mockPolicy = {
    dormitoryId: 'dorm-001',
    dormitoryName: 'HorPlus Residence Phase 2 Step 4',
    defaultTerms: '1. ห้ามสูบบุหรี่\n2. ค่าเช่าชำระวันที่ 5',
    petPolicy: { allowed: 'conditional', allowedTypes: ['cat', 'dog'] },
    version: 1,
  };

  describe('1. Room Selection Matrix (Rule 3)', () => {
    it('renders single unified dropdown where vacant & claimable are selectable, and bound/maintenance are disabled', () => {
      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      const selectEl = screen.getByTestId('tenant-registration-room-select') as HTMLSelectElement;
      expect(selectEl).toBeDefined();

      const options = Array.from(selectEl.options);
      expect(options.length).toBe(4);

      // Room 101 - Vacant (selectable)
      expect(options[0].value).toBe('room-vacant-1');
      expect(options[0].disabled).toBe(false);
      expect(options[0].textContent).toContain('ห้อง 101 - ห้องว่าง');

      // Room 102 - Claimable (selectable)
      expect(options[1].value).toBe('room-claimable-2');
      expect(options[1].disabled).toBe(false);
      expect(options[1].textContent).toContain('ห้อง 102 - ยังไม่ผูก LINE (ยืนยันสิทธิ์)');

      // Room 103 - Bound (disabled)
      expect(options[2].value).toBe('room-bound-3');
      expect(options[2].disabled).toBe(true);
      expect(options[2].textContent).toContain('ห้อง 103 - มีผู้เช่าแล้ว (ผูก LINE แล้ว) (ไม่สามารถเลือกได้)');

      // Room 104 - Maintenance (disabled)
      expect(options[3].value).toBe('room-maint-4');
      expect(options[3].disabled).toBe(true);
      expect(options[3].textContent).toContain('ห้อง 104 - ปิดปรับปรุง (ไม่สามารถเลือกได้)');
    });
  });

  describe('2. Single-Field Claim Verification & Scoped Lockout Key', () => {
    it('locks financial terms strictly to owner snapshot upon successful claim verification', async () => {
      const verifyClaimSpy = vi.spyOn(apiAdapter, 'verifyTenantClaim').mockResolvedValueOnce({
        success: true,
        data: {
          verified: true,
          tenantId: 'tenant-unlinked-001',
          displayName: 'นายสมชาย ผู้เช่าเดิม',
          firstName: 'สมชาย',
          lastName: 'ผู้เช่าเดิม',
          phone: '0812345678',
          citizenId: '1-1002-00345-67-8',
          lockedFinancials: {
            monthlyRent: 4500,
            depositAmount: 5500,
            durationMonths: 12,
            rentalType: 'monthly',
          },
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          initialRoomId="room-claimable-2"
        />
      );

      // Claim identity box is rendered
      expect(screen.getAllByText('กรุณาตรวจสอบและยืนยัน').length).toBeGreaterThanOrEqual(1);
      const claimInput = screen.getByTestId('tenant-claim-input');
      const verifyBtn = screen.getByTestId('tenant-claim-verify-btn');

      fireEvent.change(claimInput, { target: { value: '0812345678' } });
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(verifyClaimSpy).toHaveBeenCalledWith({
          dormitoryId: 'dorm-001',
          inviteToken: undefined,
          roomId: 'room-claimable-2',
          claimInput: '0812345678',
        });
      });

      // Verifies locked financials notification is rendered
      await waitFor(() => {
        expect(screen.getByText(/ยืนยันตัวตนสำเร็จ ข้อมูลสัญญาและค่าเช่าถูกล็อก/)).toBeDefined();
      });
    });

    it('surfaces claim lockout error if verification attempts exceeded 5 times', async () => {
      vi.spyOn(apiAdapter, 'verifyTenantClaim').mockResolvedValueOnce({
        success: false,
        error: {
          code: 'CLAIM_VERIFICATION_LOCKED',
          message: 'คุณระบุข้อมูลไม่ถูกต้องเกิน 5 ครั้ง บัญชีของคุณถูกระงับการยืนยันสิทธิ์สำหรับห้องนี้ชั่วคราวเป็นเวลา 5 นาที (300 วินาที)',
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          initialRoomId="room-claimable-2"
        />
      );

      const claimInput = screen.getByTestId('tenant-claim-input');
      const verifyBtn = screen.getByTestId('tenant-claim-verify-btn');

      fireEvent.change(claimInput, { target: { value: 'ผิดทุกอย่าง' } });
      fireEvent.click(verifyBtn);

      await waitFor(() => {
        expect(screen.getByText(/คุณระบุข้อมูลไม่ถูกต้องเกิน 5 ครั้ง/)).toBeDefined();
      });
    });
  });

  describe('3. Strict Two-Phase Public Registration & Tenant Confirmation', () => {
    it('renders awaiting_tenant_confirmation banner, badge, and final signature CTA calling confirmApprovedRegistration', async () => {
      setupCanvasMock();

      const mockAwaitingConfirmationRequest = {
        id: 'req-confirm-001',
        status: 'awaiting_tenant_confirmation',
        dormitoryId: 'dorm-001',
        acceptanceSnapshot: {
          requestedRoomId: 'room-vacant-1',
          fullName: 'สมหญิง จริงใจ',
          phone: '0899887766',
          citizenId: '1-2345-67890-12-3',
          rentalPlan: 'monthly',
          proposedRent: 4000,
          proposedDeposit: 5000,
          durationMonths: 12,
          approvedTerms: {
            rentAmount: 4000,
            depositAmount: 5000,
            durationMonths: 12,
            rentalType: 'monthly',
            startDate: '2026-10-01',
            endDate: '2027-09-30',
            dueDay: 5,
          },
        },
      };

      const confirmSpy = vi.spyOn(apiAdapter, 'confirmApprovedRegistration').mockResolvedValueOnce({
        success: true,
        data: {
          requestId: 'req-confirm-001',
          tenant: {
            id: 'tenant-new-001',
            name: 'สมหญิง จริงใจ',
            status: 'active',
          },
          contract: {
            id: 'contract-new-001',
            status: 'active',
            rentAmount: 4000,
            depositAmount: 5000,
          },
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          revisionRequest={mockAwaitingConfirmationRequest}
        />
      );

      // 1. Check canonical badge and banner
      expect(screen.getAllByText('กรุณาตรวจสอบและยืนยัน').length).toBeGreaterThan(0);
      expect(screen.getByText(/เจ้าของหอพักอนุมัติคำขอของคุณแล้ว \(กรุณาตรวจสอบและยืนยัน\)/)).toBeDefined();

      // 2. Check CTA label
      const submitBtn = screen.getByTestId('tenant-registration-submit-btn');
      expect(submitBtn.textContent).toContain('ลงนามและยืนยันสัญญาเช่า (เปิดใช้งานห้องพัก)');

      // 3. Draw on signature canvas & check terms
      const canvas = document.querySelector('canvas')!;
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
      fireEvent.mouseUp(canvas);

      const termsCheckbox = screen.getByTestId('tenant-agree-terms-checkbox');
      fireEvent.click(termsCheckbox);

      // 4. Click Submit
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(confirmSpy).toHaveBeenCalledWith('req-confirm-001', {
          signatureBase64: 'data:image/png;base64,MOCK_CANVAS_SIG',
          dormitoryId: 'dorm-001',
        });
      });

      // 5. Completion screen displays active status: 'ใช้งานได้แล้ว'
      await waitFor(() => {
        expect(screen.getByText(/สถานะ: ใช้งานได้แล้ว/)).toBeDefined();
        expect(screen.getByText(/ยืนยันสัญญาเช่าและเปิดใช้งานห้องพักเรียบร้อยแล้ว/)).toBeDefined();
      });
    });
  });

  describe('4. Dedicated DailyStay Workflow Isolation', () => {
    it('switches immediately into dedicated DailyStay flow when DAILY is selected, hiding steps 4-7 and contract rows', async () => {
      setupCanvasMock();

      const dailySpy = vi.spyOn(apiAdapter, 'submitDailyStayRequest').mockResolvedValueOnce({
        success: true,
        data: {
          id: 'stay-001',
          status: 'PENDING_APPROVAL',
          roomNumber: '101',
          applicantFullName: 'นาย สมปอง ท่องเที่ยว',
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Fill Tenant Info (Step 2)
      const nameInput = screen.getByPlaceholderText('เช่น สมชาย ใจดี');
      const phoneInput = screen.getByPlaceholderText('081-234-5678');
      fireEvent.change(nameInput, { target: { value: 'สมปอง ท่องเที่ยว' } });
      fireEvent.change(phoneInput, { target: { value: '0851122334' } });

      // In Step 3, switch to 'รายวัน'
      const dailyRentBtn = screen.getByText('รายวัน');
      fireEvent.click(dailyRentBtn);

      // 1. Navigation header adjusts to 3 steps
      expect(document.body.textContent).toContain('/3:');

      // 2. Dedicated DailyStay card appears
      expect(screen.getByText(/การเข้าพักรายวัน \(DailyStay Workflow\)/)).toBeDefined();
      expect(screen.getByText('วันเริ่มเข้าพัก (Check-in) *')).toBeDefined();
      expect(screen.getByText('วันสิ้นสุดการเข้าพัก (Check-out) *')).toBeDefined();

      // 3. Steps 4, 5, 6, 7 are NOT rendered
      expect(screen.queryByText('ผู้ติดต่อฉุกเฉิน & ผู้พักอาศัยร่วม')).toBeNull();
      expect(screen.queryByText('ยานพาหนะ & การขออนุญาตเลี้ยงสัตว์เลี้ยง')).toBeNull();
      expect(screen.queryByText('หนังสือสัญญาเช่าห้องพักอาศัย')).toBeNull();

      // 4. Draw signature in Daily Stay card & check terms
      const canvas = document.querySelector('canvas')!;
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
      fireEvent.mouseUp(canvas);

      const termsCheckbox = screen.getByTestId('tenant-agree-terms-checkbox');
      fireEvent.click(termsCheckbox);

      // 5. Submit Daily Stay button
      const dailySubmitBtn = screen.getByTestId('submit-daily-stay-btn');
      expect(dailySubmitBtn.textContent).toContain('ส่งคำขอเข้าพักรายวัน (รอเจ้าของหอพักอนุมัติ)');
      fireEvent.click(dailySubmitBtn);

      await waitFor(() => {
        expect(dailySpy).toHaveBeenCalledWith(
          expect.objectContaining({
            dormitoryId: 'dorm-001',
            roomId: 'room-vacant-1',
            applicantFullName: 'นาย สมปอง ท่องเที่ยว',
          })
        );
      });

      // 6. Success screen shows canonical daily pending status
      await waitFor(() => {
        expect(screen.getByText(/สถานะ: รออนุมัติคำขอเข้าพักรายวัน/)).toBeDefined();
        expect(screen.getByText(/ส่งคำขอเข้าพักรายวันเรียบร้อยแล้ว/)).toBeDefined();
      });
    });
  });

  describe('5. Canonical Status Badges Coverage', () => {
    it('verifies canonical badge "รออนุมัติคำขอผู้เช่า" upon standard submission', async () => {
      setupCanvasMock();

      vi.spyOn(apiAdapter, 'submitTenantRegistrationRequest').mockResolvedValueOnce({
        success: true,
        data: {
          id: 'req-001',
          status: 'pending_owner_approval',
        },
      });

      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
        />
      );

      // Fill personal info
      fireEvent.change(screen.getByPlaceholderText('เช่น สมชาย ใจดี'), { target: { value: 'สมศักดิ์ มั่นคง' } });
      fireEvent.change(screen.getByPlaceholderText('081-234-5678'), { target: { value: '0812345678' } });
      fireEvent.change(screen.getByPlaceholderText('1-2345-67890-12-3'), { target: { value: '1234567890123' } });

      // Draw signature & check terms
      const canvas = document.querySelector('canvas')!;
      fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
      fireEvent.mouseMove(canvas, { clientX: 20, clientY: 20 });
      fireEvent.mouseUp(canvas);

      fireEvent.click(screen.getByTestId('tenant-agree-terms-checkbox'));
      fireEvent.click(screen.getByTestId('tenant-registration-submit-btn'));

      await waitFor(() => {
        expect(screen.getByText(/สถานะ: รออนุมัติคำขอผู้เช่า/)).toBeDefined();
      });
    });

    it('verifies canonical badge "กรุณาตรวจสอบอีกครั้ง" on revision requested', () => {
      render(
        <TenantRegisterView
          rooms={mockRoomsMatrix}
          policy={mockPolicy}
          dormitoryId="dorm-001"
          revisionRequest={{
            id: 'req-rev-01',
            status: 'revision_requested',
            rejectedReason: 'กรุณาแนบรูปถ่ายบัตรประชาชนใหม่อีกครั้ง รูปเดิมเบลอ',
          }}
        />
      );

      expect(screen.getAllByText('กรุณาตรวจสอบอีกครั้ง').length).toBeGreaterThan(0);
      expect(screen.getByText(/กรุณาแนบรูปถ่ายบัตรประชาชนใหม่อีกครั้ง รูปเดิมเบลอ/)).toBeDefined();
    });
  });
});
