// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * LINE OA Setup & Step 6 Parity Test Suite (LOA-01, LOA-02, LOA-03)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { LineQuotaBadge } from '../components/LineQuotaBadge';
import { LineNotificationModal } from '../components/LineNotificationModal';
import { OwnerLineOaPage } from '../pages/owner/line-oa';
import { OwnerRegister } from '../pages/owner/register';
import * as localDraftStorage from '../utils/localDraftStorage';
import { Task009ApiAdapter } from '../data/adapters/task009';

describe('LINE OA Setup & Step 6 Parity Suite (LOA-01 to LOA-03)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('LOA-01: Quick Add Tenant Modal LINE OA Setup Navigation Parity', () => {
    it('clicking "ตั้งค่า LINE OA" in QuickAddTenantModal closes the modal and invokes onNavigateToLineConfig', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          webhookEndpointSet: false,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: false,
          hasAccessToken: false,
          lineOaId: null,
          channelId: null,
          accessTokenVerifiedAt: null,
          webhookVerifiedAt: null,
          webhookUrl: null,
        },
      });

      const mockClose = vi.fn();
      const mockNavigateToLineConfig = vi.fn();

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={mockClose}
          context={{ roomId: 'r1', roomNumber: '204', floor: 2, buildingName: 'อาคารชาญวิทย์' } as any}
          onSuccess={vi.fn()}
          onNavigateToLineConfig={mockNavigateToLineConfig}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      expect(
        screen.getByText('กรุณาตั้งค่า LINE OA ของหอพักก่อนใช้งานการเพิ่มผู้เช่าผ่าน LINE')
      ).toBeDefined();

      const setupButton = screen.getByRole('button', { name: /ตั้งค่า LINE OA/i });
      expect(setupButton).toBeDefined();

      fireEvent.click(setupButton);
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe('LOA-02: Step 6 Alignment for Unconfigured / Not-Ready State in OwnerLineOaPage', () => {
    beforeEach(() => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          webhookEndpointSet: false,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: false,
          hasAccessToken: false,
          lineOaId: null,
          channelId: null,
          botDisplayName: null,
          botPictureUrl: null,
          accessTokenVerifiedAt: null,
          webhookVerifiedAt: null,
          webhookUrl: null,
          monthlyQuota: 30,
          usedQuota: 0,
          remainingQuota: 30,
        } as any,
      });
    });

    it('renders Step 6 styling, inputs, webhook placeholder, and action button while hiding advanced management sections', async () => {
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      // Status pill
      expect(screen.getAllByText('ยังไม่ได้ตรวจสอบ').length).toBeGreaterThanOrEqual(1);

      // Step 6 Inputs
      expect(screen.getByPlaceholderText('เช่น 1657889900')).toBeDefined();
      expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();

      // Webhook row (LOA-06, LOA-07)
      expect(
        screen.getByPlaceholderText('จะแสดงขึ้นหลังกดทดสอบสถานะผ่าน')
      ).toBeDefined();
      expect(screen.getByText('* กรุณากรอก Channel ID และ Channel Secret แล้วกดทดสอบตรวจสถานะ')).toBeDefined();

      // Test button
      const testButton = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      expect(testButton).toBeDefined();

      // Advanced sections MUST NOT be shown in unconfigured state
      expect(screen.queryByText('หมุนเวียนคีย์ (Rotate Key)')).toBeNull();
      expect(screen.queryByText('กำหนดการแจ้งเตือนอัตโนมัติผ่าน LINE (Event Preferences)')).toBeNull();
      expect(screen.queryByText('ยกเลิกเชื่อมต่อ')).toBeNull();
    });

    it('triggers Task009ApiAdapter.updateLineOaConfig and testWebhookEndpoint upon clicking test button', async () => {
      const mockUpdate = vi.spyOn(Task009ApiAdapter, 'updateLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          webhookEndpointSet: true,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: true,
          hasAccessToken: true,
          lineOaId: '@horplus_bot',
          channelId: '1657123456',
          botDisplayName: 'HorPlus Assistant',
          botPictureUrl: null,
          webhookUrl: 'https://api.horplus.com/line/webhook/dorm-test-01',
          monthlyQuota: 30,
          usedQuota: 0,
          remainingQuota: 30,
        } as any,
      });

      const mockTestWebhook = vi.spyOn(Task009ApiAdapter, 'testWebhookEndpoint').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: true,
          credentialsVerified: true,
          webhookEndpointSet: true,
          webhookTestSucceeded: true,
          webhookActive: true,
          hasChannelSecret: true,
          hasAccessToken: true,
          lineOaId: '@horplus_bot',
          channelId: '1657123456',
          botDisplayName: 'HorPlus Assistant',
          botPictureUrl: null,
          webhookUrl: 'https://api.horplus.com/line/webhook/dorm-test-01',
          monthlyQuota: 30,
          usedQuota: 0,
          remainingQuota: 30,
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('เช่น 1657889900')).toBeDefined();
      });

      fireEvent.change(screen.getByPlaceholderText('เช่น 1657889900'), {
        target: { value: '1657123456' },
      });
      fireEvent.change(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...'), {
        target: { value: 'secret123456789012345678901234' },
      });

      const testBtn = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith('dorm-test-01', {
          channelId: '1657123456',
          channelSecret: 'secret123456789012345678901234',
        });
        expect(mockTestWebhook).toHaveBeenCalledWith('dorm-test-01');
      });
    });
  });

  describe('LOA-03: Connected & Ready View Transition in OwnerLineOaPage', () => {
    beforeEach(() => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: true,
          credentialsVerified: true,
          webhookEndpointSet: true,
          webhookTestSucceeded: true,
          webhookActive: true,
          hasChannelSecret: true,
          hasAccessToken: true,
          lineOaId: '@horplus_active',
          channelId: '1657889900',
          botDisplayName: 'HorPlus Demo Dorm',
          botPictureUrl: null,
          accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
          webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
          webhookUrl: 'https://api.horplus.com/line/webhook/dorm-test-01',
          notifyRepairRequest: true,
          notifyRepairCompleted: true,
          notifyPaymentReceived: true,
          notifyTenantRegister: true,
          notifyTenantApproved: true,
          monthlyQuota: 30,
          usedQuota: 5,
          remainingQuota: 25,
        } as any,
      });
    });

    it('renders the advanced management view with quota, rotate key, event preferences, and disconnect', async () => {
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('พร้อมใช้งาน (READY)')).toBeDefined();
      });

      expect(screen.getByText('เชื่อมต่อและทดสอบ Webhook สมบูรณ์แล้ว')).toBeDefined();
      expect(screen.getByText('โควตาเดือนนี้:')).toBeDefined();
      expect(screen.getByText('25/30')).toBeDefined();

      // Advanced controls are now visible
      expect(screen.getByText('แก้ไขข้อมูลเชื่อมต่อ')).toBeDefined();
      expect(screen.getByText('ยกเลิกเชื่อมต่อ')).toBeDefined();
      expect(screen.getByText('หมุนเวียนคีย์ (Rotate Key)')).toBeDefined();
      expect(screen.getByText('กำหนดการแจ้งเตือนอัตโนมัติผ่าน LINE (Event Preferences)')).toBeDefined();
      expect(screen.getByText('คำขอแจ้งซ่อมใหม่')).toBeDefined();
      expect(screen.getByText('ได้รับยอดชำระเงิน')).toBeDefined();
    });

    it('clicking "แก้ไขข้อมูลเชื่อมต่อ" reveals the Step 6 credentials form with a cancel button', async () => {
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('แก้ไขข้อมูลเชื่อมต่อ')).toBeDefined();
      });

      fireEvent.click(screen.getByText('แก้ไขข้อมูลเชื่อมต่อ'));

      // Step 6 form appears
      expect(screen.getByPlaceholderText('เช่น 1657889900')).toBeDefined();
      expect(screen.getByText('ยกเลิกการแก้ไข')).toBeDefined();

      // Clicking cancel returns to management view
      fireEvent.click(screen.getByText('ยกเลิกการแก้ไข'));
      expect(screen.getByText('แก้ไขข้อมูลเชื่อมต่อ')).toBeDefined();
      expect(screen.queryByText('ยกเลิกการแก้ไข')).toBeNull();
    });
  });

  describe('LOA-04: Responsive 3-Device Modal Header', () => {
    it('integrates unified close button and hides chevron when isModal=true', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: null,
          lineOaId: null,
          webhookUrl: null,
        } as any,
      });

      const mockClose = vi.fn();
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" isModal={true} onClose={mockClose} />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      // No redundant back arrow button in modal view
      expect(screen.queryByTitle('ย้อนกลับ')).toBeNull();

      // Close button is in header
      const closeBtn = screen.getByTitle('ปิดหน้าต่าง');
      expect(closeBtn).toBeDefined();

      fireEvent.click(closeBtn);
      expect(mockClose).toHaveBeenCalledTimes(1);

      // Help button is present
      expect(screen.getByTitle('ดูวิธีตั้งค่า LINE OA')).toBeDefined();
    });
  });

  describe('LOA-05 & LOA-07: De-cluttered Layout & Concise Copywriting', () => {
    it('renders clean form without heavy nested emerald container and uses concise labels', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: null,
          lineOaId: null,
          webhookUrl: null,
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      // Concise labels without "(ไม่บังคับ - สามารถตั้งค่าภายหลังได้)"
      expect(screen.getByText('LINE Channel ID')).toBeDefined();
      expect(screen.getByText('LINE Channel Secret')).toBeDefined();
      expect(screen.queryByText(/ไม่บังคับ - สามารถตั้งค่าภายหลังได้/i)).toBeNull();

      // Concise Webhook label
      expect(screen.getByText('LINE Webhook URL')).toBeDefined();
      expect(screen.getByPlaceholderText('จะแสดงขึ้นหลังกดทดสอบสถานะผ่าน')).toBeDefined();
    });
  });

  describe('LOA-06: Immediate Webhook URL Presentation on Verification', () => {
    it('immediately populates and enables Webhook URL upon successful test connection', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: null,
          lineOaId: null,
          webhookUrl: null,
        } as any,
      });

      // Simulate successful verification where backend provides full webhook URL
      vi.spyOn(Task009ApiAdapter, 'updateLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          webhookEndpointSet: true,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: true,
          hasAccessToken: true,
          lineOaId: '@rich_bot',
          channelId: '2010923779',
          botDisplayName: 'แจ้งบิล TheRICH',
          botPictureUrl: null,
          webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/sec_wh_key',
          monthlyQuota: 30,
          usedQuota: 0,
          remainingQuota: 30,
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'testWebhookEndpoint').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          webhookEndpointSet: true,
          webhookTestSucceeded: false,
          webhookActive: false,
          hasChannelSecret: true,
          hasAccessToken: true,
          lineOaId: '@rich_bot',
          channelId: '2010923779',
          botDisplayName: 'แจ้งบิล TheRICH',
          botPictureUrl: null,
          webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/sec_wh_key',
          monthlyQuota: 30,
          usedQuota: 0,
          remainingQuota: 30,
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      // Enter channel credentials
      fireEvent.change(screen.getByPlaceholderText('เช่น 1657889900'), {
        target: { value: '2010923779' },
      });
      fireEvent.change(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...'), {
        target: { value: 'secret1234567890' },
      });

      // Click test button
      const testBtn = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      fireEvent.click(testBtn);

      // Webhook URL should immediately be visible in input
      await waitFor(() => {
        const webhookInput = screen.getByDisplayValue('https://webhook.horplus.com/api/v1/line/webhook/sec_wh_key') as HTMLInputElement;
        expect(webhookInput).toBeDefined();
      });

      // Concise success status message
      expect(
        screen.getAllByText('คัดลอก Webhook URL เพื่อนำไปเชื่อมต่อให้พร้อมใช้งาน').length
      ).toBeGreaterThanOrEqual(1);

      // Copy button is enabled
      const copyBtn = screen.getByTitle('คัดลอก Webhook URL');
      expect(copyBtn).toBeDefined();
      expect(copyBtn.hasAttribute('disabled')).toBe(false);
    });

    it('uses fallback webhook URL when backend returns null in dev environment', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: null,
          lineOaId: null,
          webhookUrl: null,
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'updateLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: null, // simulated local dev environment
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'testWebhookEndpoint').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          webhookUrl: null,
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      fireEvent.change(screen.getByPlaceholderText('เช่น 1657889900'), {
        target: { value: '2010923779' },
      });
      fireEvent.change(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...'), {
        target: { value: 'secret1234567890' },
      });

      const testBtn = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        const webhookInput = screen.getByDisplayValue(/api\/v1\/line\/webhook\/dorm-test-01/) as HTMLInputElement;
        expect(webhookInput).toBeDefined();
      });
    });
  });

  describe('LOA-08: Plaintext Secret Display & Value Retention (OwnerLineOaPage)', () => {
    it('renders channel secret as text by default, toggles visibility with eye icon, and retains typed value after test', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: null,
          hasChannelSecret: false,
          webhookUrl: null,
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'updateLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'testWebhookEndpoint').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...') as HTMLInputElement;
      expect(secretInput.type).toBe('text'); // Plaintext by default per PO Request 1 & Q1=ก

      // Type secret
      fireEvent.change(secretInput, { target: { value: 'my_channel_secret_999' } });
      expect(secretInput.value).toBe('my_channel_secret_999');

      // Toggle to masked (status icon Eye -> EyeOff)
      const toggleBtn = screen.getByLabelText('กำลังแสดงรหัส (คลิกเพื่อซ่อน)');
      fireEvent.click(toggleBtn);
      expect(secretInput.value).toBe('•'.repeat('my_channel_secret_999'.length));

      // Toggle back to text
      const showBtn = screen.getByLabelText('กำลังซ่อนรหัส (คลิกเพื่อแสดง)');
      fireEvent.click(showBtn);
      expect(secretInput.value).toBe('my_channel_secret_999');

      // Click test button
      const testBtn = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      fireEvent.click(testBtn);

      // Secret must persist and NOT be cleared
      await waitFor(() => {
        expect(secretInput.value).toBe('my_channel_secret_999');
      });
    });

    it('shows saved placeholder when secret is stored in database and input is empty', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          channelId: '2010923779',
          hasChannelSecret: true,
          webhookUrl: null,
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        const input = screen.getByPlaceholderText('(บันทึกไว้แล้ว - กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน)');
        expect(input).toBeDefined();
      });
    });
  });

  describe('LOA-09: Strict Webhook Readiness Verification (LineQuotaBadge & LineNotificationModal)', () => {
    it('LineQuotaBadge displays "รอเชื่อมต่อ Webhook" and never claims "พร้อมใช้งาน" when connected but webhook unverified', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            connected: true,
            isReady: false, // Strict: Webhook NOT ready
            credentialsVerified: true,
            monthlyQuota: 30,
            remainingQuota: 30,
            usedQuota: 0,
          },
        }),
      } as any);

      render(<LineQuotaBadge dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('รอเชื่อมต่อ Webhook')).toBeDefined();
        expect(screen.queryByText('พร้อมใช้งาน')).toBeNull();
      });
    });

    it('LineNotificationModal displays "ยังไม่พร้อมใช้งาน" when connected but webhook unverified', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            connected: true,
            isReady: false, // Strict: Webhook NOT ready
            credentialsVerified: true,
          },
        }),
      } as any);

      render(
        <LineNotificationModal
          isOpen={true}
          onClose={vi.fn()}
          selectedCycle="2026-03"
          bills={[]}
          tenants={[]}
          rooms={[]}
          contracts={[]}
          dormitoryId="dorm-test-01"
          onNavigateToLineConfig={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('ยังไม่พร้อมใช้งาน')).toBeDefined();
        expect(screen.queryByText('พร้อมใช้งาน')).toBeNull();
      });
    });
  });

  describe('LOA-10: Edit LINE OA Action Button in Quota Modal Header (LineQuotaBadge)', () => {
    it('renders edit LINE OA button next to close button and invokes onNavigateToLineConfig when clicked', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            connected: true,
            isReady: true,
            credentialsVerified: true,
            monthlyQuota: 30,
            remainingQuota: 28,
            usedQuota: 2,
          },
        }),
      } as any);

      const onNavigateToLineConfig = vi.fn();

      render(
        <LineQuotaBadge
          dormitoryId="dorm-test-01"
          onNavigateToLineConfig={onNavigateToLineConfig}
        />
      );

      // Wait for badge to be ready
      await waitFor(() => {
        expect(screen.getByText('28/30')).toBeDefined();
      });

      // Click pill to open modal
      fireEvent.click(screen.getByTestId('header-line-status-pill'));

      // Modal is open; verify edit button in header banner near X button
      await waitFor(() => {
        const editBtn = screen.getByTitle('แก้ไข LINE OA');
        expect(editBtn).toBeDefined();
        expect(screen.getByText('แก้ไข LINE OA')).toBeDefined();

        // Click edit button
        fireEvent.click(editBtn);
      });

      expect(onNavigateToLineConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe('LOA-11: Direct Setup Navigation on Webhook Pending / Unready (LineQuotaBadge)', () => {
    it('directly invokes onNavigateToLineConfig when clicking pill in pending webhook state, bypassing internal quota modal', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            connected: true,
            isReady: false, // Webhook pending
            credentialsVerified: true,
            monthlyQuota: 30,
            remainingQuota: 30,
            usedQuota: 0,
          },
        }),
      } as any);

      const onNavigateToLineConfig = vi.fn();

      render(
        <LineQuotaBadge
          dormitoryId="dorm-test-01"
          onNavigateToLineConfig={onNavigateToLineConfig}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('รอเชื่อมต่อ Webhook')).toBeDefined();
      });

      const pill = screen.getByTestId('header-line-status-pill');
      fireEvent.click(pill);

      // Must call onNavigateToLineConfig directly
      expect(onNavigateToLineConfig).toHaveBeenCalledTimes(1);

      // Internal modal must NOT open
      expect(screen.queryByText('แก้ไข LINE OA')).toBeNull();
      expect(screen.queryByText('โควตาข้อความ LINE ประจำเดือน')).toBeNull();
    });

    it('directly invokes onNavigateToLineConfig when clicking pill in unconfigured state', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            connected: false,
            isReady: false,
            credentialsVerified: false,
          },
        }),
      } as any);

      const onNavigateToLineConfig = vi.fn();

      render(
        <LineQuotaBadge
          dormitoryId="dorm-test-01"
          onNavigateToLineConfig={onNavigateToLineConfig}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('ยังไม่พร้อมใช้งาน')).toBeDefined();
      });

      const pill = screen.getByTestId('header-line-status-pill');
      fireEvent.click(pill);

      expect(onNavigateToLineConfig).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('แก้ไข LINE OA')).toBeNull();
    });
  });

  describe('LOA-12: Eye Icon Status Indicator & Last-Character Preview (OwnerLineOaPage)', () => {
    beforeEach(() => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          channelId: null,
          hasChannelSecret: false,
          webhookUrl: null,
        } as any,
      });
    });

    it('displays Eye icon when viewing plaintext and EyeOff icon when masked', async () => {
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();
      });

      // Initially open/viewing plaintext -> displays Eye icon (aria-label: กำลังแสดงรหัส (คลิกเพื่อซ่อน))
      const eyeBtn = screen.getByLabelText('กำลังแสดงรหัส (คลิกเพื่อซ่อน)');
      expect(eyeBtn).toBeDefined();
      expect(eyeBtn.querySelector('.lucide-eye')).toBeDefined();

      // Click to mask
      fireEvent.click(eyeBtn);

      // Now masked -> displays EyeOff icon (aria-label: กำลังซ่อนรหัส (คลิกเพื่อแสดง))
      const eyeOffBtn = screen.getByLabelText('กำลังซ่อนรหัส (คลิกเพื่อแสดง)');
      expect(eyeOffBtn).toBeDefined();
      expect(eyeOffBtn.querySelector('.lucide-eye-off')).toBeDefined();
    });

    it('previews last character for 800ms before turning into bullet without bullet contamination', async () => {
      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();
      });

      vi.useFakeTimers();

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...') as HTMLInputElement;

      // Switch to masked mode first
      const toggleBtn = screen.getByLabelText('กำลังแสดงรหัส (คลิกเพื่อซ่อน)');
      fireEvent.click(toggleBtn);

      // 1. User types 'a' into masked input
      fireEvent.change(secretInput, { target: { value: 'a' } });
      expect(secretInput.value).toBe('a');

      // Advance 800ms
      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(secretInput.value).toBe('•');

      // 2. User types 'b' (inputVal becomes '•b')
      fireEvent.change(secretInput, { target: { value: '•b' } });
      expect(secretInput.value).toBe('•b');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(secretInput.value).toBe('••');

      // 3. User types 'c' (inputVal becomes '••c')
      fireEvent.change(secretInput, { target: { value: '••c' } });
      expect(secretInput.value).toBe('••c');

      act(() => {
        vi.advanceTimersByTime(800);
      });
      expect(secretInput.value).toBe('•••');

      // 4. Toggle visibility to plaintext: should show exact raw secret 'abc' without bullets!
      const showBtn = screen.getByLabelText('กำลังซ่อนรหัส (คลิกเพื่อแสดง)');
      fireEvent.click(showBtn);
      expect(secretInput.value).toBe('abc');

      vi.useRealTimers();
    });
  });

  describe('LOA-13: First-Click Auto-Open of LINE Developers Console Messaging API URL on Webhook Copy (OwnerLineOaPage)', () => {
    beforeEach(() => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });
    });

    it('copies Webhook URL and opens Messaging API tab after 2 seconds on first click, then behaves as normal copy on subsequent clicks', async () => {
      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null as any);
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('เช่น 1657889900')).toBeDefined();
      });

      const copyBtn = screen.getByRole('button', { name: /^คัดลอก$/i });
      expect(copyBtn).toBeDefined();

      vi.useFakeTimers();
      try {
        // 1. First Click: copies URL immediately and shows copied state, but window.open is NOT called yet
        fireEvent.click(copyBtn);
        expect(mockWriteText).toHaveBeenCalledWith('https://example.com/api/v1/line/webhook/dorm-test-01');
        expect(mockOpen).toHaveBeenCalledTimes(0);
        expect(screen.getByText('คัดลอกแล้ว!')).toBeDefined();

        // Advance 2 seconds (2000ms): window.open is called with Messaging API URL
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(mockOpen).toHaveBeenCalledWith(
          'https://developers.line.biz/console/channel/2010923779/messaging-api',
          '_blank',
          'noopener,noreferrer'
        );

        // 2. Second Click: copies URL normally, window.open is NOT called again even after 2 seconds
        fireEvent.click(copyBtn);
        expect(mockWriteText).toHaveBeenCalledTimes(2);
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockOpen).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not call window.open when channelId is empty', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: null, // No channel ID
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null as any);
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^คัดลอก$/i })).toBeDefined();
      });

      const copyBtn = screen.getByRole('button', { name: /^คัดลอก$/i });
      fireEvent.click(copyBtn);

      expect(mockWriteText).toHaveBeenCalledWith('https://example.com/api/v1/line/webhook/dorm-test-01');
      expect(mockOpen).not.toHaveBeenCalled();
    });
  });

  describe('LOA-14: Interactive Styled Link for LINE Developers Console > Messaging API (OwnerLineOaPage)', () => {
    it('renders an interactive link with underline and external link icon when channelId is present', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i })).toBeDefined();
      });

      const link = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(link.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.className).toContain('underline');
    });

    it('renders fallback root console link when channelId is empty', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: null,
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const link = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(link.getAttribute('href')).toBe('https://developers.line.biz/console/');
    });
  });

  describe('LOA-15: Step 6 Registration Parity in register.tsx', () => {
    it('copies Webhook URL and opens Messaging API tab after 2 seconds on first click when channelId is present, and renders interactive link', async () => {
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: true,
            channelId: '2010923779',
            webhookUrl: 'https://api.horplus.com/line/webhook/test-reg',
          },
        } as any,
      });

      const mockOpen = vi.spyOn(window, 'open').mockImplementation(() => null as any);
      const mockWriteText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined();
      });

      // Link check
      const link = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(link.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');

      // Copy button check
      const copyBtn = screen.getByRole('button', { name: /^คัดลอก$/i });

      vi.useFakeTimers();
      try {
        fireEvent.click(copyBtn);

        expect(mockWriteText).toHaveBeenCalledWith('https://api.horplus.com/line/webhook/test-reg');
        expect(mockOpen).toHaveBeenCalledTimes(0);
        expect(screen.getByText('คัดลอกแล้ว!')).toBeDefined();

        // Advance 2000ms
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockOpen).toHaveBeenCalledTimes(1);
        expect(mockOpen).toHaveBeenCalledWith(
          'https://developers.line.biz/console/channel/2010923779/messaging-api',
          '_blank',
          'noopener,noreferrer'
        );

        // Subsequent click
        fireEvent.click(copyBtn);
        expect(mockWriteText).toHaveBeenCalledTimes(2);
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockOpen).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('LOA-16 & LOA-17: Connection-Gated Console Link & Webhook Helper Copywriting', () => {
    it('OwnerLineOaPage: renders console link as plain text when connected is false, and as interactive link with new copywriting when connected is true', async () => {
      // 1. When connected is false, even with channelId present, link is plain text
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      const { unmount } = render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const fallbackLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(fallbackLink.getAttribute('href')).toBe('https://developers.line.biz/console/');
      unmount();

      // 2. When connected is true, renders interactive link with new copywriting "นำ Webhook URL ไปใส่และเปิด Use Webhook ใน"
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText(/นำ Webhook URL ไปใส่และเปิด Use Webhook ใน/i)).toBeDefined();
      });

      const link = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(link.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
    });

    it('OwnerRegister: renders console link to root console when isConnected is false, and to channel when isConnected is true', async () => {
      // 1. When isConnected is false
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: false,
            channelId: '2010923779',
            webhookUrl: '',
          },
        } as any,
      });

      const { unmount } = render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const fallbackLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(fallbackLink.getAttribute('href')).toBe('https://developers.line.biz/console/');
      unmount();

      // 2. When isConnected is true
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: true,
            channelId: '2010923779',
            webhookUrl: 'https://api.horplus.com/line/webhook/test-reg',
          },
        } as any,
      });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i })).toBeDefined();
      });

      const link = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(link.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
      expect(screen.getByText(/นำ Webhook URL ไปใส่และเปิด Use Webhook ใน/i)).toBeDefined();
    });
  });

  describe('LOA-18: Password Visibility Toggle & Last-Character Preview in Step 6 (OwnerRegister)', () => {
    it('supports Eye/EyeOff toggle and previews last character for 800ms before masking in Step 6', async () => {
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: false,
            channelId: '',
            channelSecret: '',
            webhookUrl: '',
          },
        } as any,
      });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined();
      });

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...') as HTMLInputElement;

      // 1. Initially showSecret is true (plaintext mode like LOA-08)
      expect(screen.getByLabelText('กำลังแสดงรหัส (คลิกเพื่อซ่อน)')).toBeDefined();

      // Toggle to masked mode
      const toggleBtn = screen.getByLabelText('กำลังแสดงรหัส (คลิกเพื่อซ่อน)');
      fireEvent.click(toggleBtn);
      expect(screen.getByLabelText('กำลังซ่อนรหัส (คลิกเพื่อแสดง)')).toBeDefined();

      vi.useFakeTimers();
      try {
        // 2. Type 'x' into masked input
        fireEvent.change(secretInput, { target: { value: 'x' } });
        expect(secretInput.value).toBe('x');

        // Advance 800ms
        act(() => {
          vi.advanceTimersByTime(800);
        });
        expect(secretInput.value).toBe('•');

        // 3. Type 'y' -> input becomes '•y'
        fireEvent.change(secretInput, { target: { value: '•y' } });
        expect(secretInput.value).toBe('•y');

        act(() => {
          vi.advanceTimersByTime(800);
        });
        expect(secretInput.value).toBe('••');

        // 4. Toggle back to show: reveals raw secret 'xy'
        const showBtn = screen.getByLabelText('กำลังซ่อนรหัส (คลิกเพื่อแสดง)');
        fireEvent.click(showBtn);
        expect(secretInput.value).toBe('xy');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('LOA-19: Immediate Credential Invalidation on Input Change in OwnerLineOaPage', () => {
    it('immediately clears connected state and hides Webhook URL when user edits Channel ID', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          botDisplayName: 'HorPlus Bot',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('HorPlus Bot')).toBeDefined();
      });

      // Webhook input is populated
      const webhookInput = screen.getByDisplayValue('https://example.com/api/v1/line/webhook/dorm-test-01') as HTMLInputElement;
      expect(webhookInput).toBeDefined();

      // Copy button is enabled
      const copyBtn = screen.getByRole('button', { name: /^คัดลอก$/i });
      expect(copyBtn.hasAttribute('disabled')).toBe(false);

      // User types into Channel ID input
      const channelIdInput = screen.getByPlaceholderText('เช่น 1657889900');
      fireEvent.change(channelIdInput, { target: { value: '9999999999' } });

      // Immediate invalidation:
      // 1. Bot profile card resets to unverified
      expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      expect(screen.getAllByText('ยังไม่ได้ตรวจสอบ').length).toBeGreaterThanOrEqual(1);

      // 2. Webhook URL input becomes empty
      expect(webhookInput.value).toBe('');

      // 3. Copy button becomes disabled
      expect(copyBtn.hasAttribute('disabled')).toBe(true);

      // 4. Helper text prompts user to test credentials again
      expect(screen.getByText('* กรุณากรอก Channel ID และ Channel Secret แล้วกดทดสอบตรวจสถานะ')).toBeDefined();
    });

    it('immediately clears connected state and hides Webhook URL when user edits Channel Secret', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          botDisplayName: 'HorPlus Bot',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('HorPlus Bot')).toBeDefined();
      });

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...');
      fireEvent.change(secretInput, { target: { value: 'new-secret-123' } });

      // Immediate invalidation:
      expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      const webhookInput = screen.getByPlaceholderText('จะแสดงขึ้นหลังกดทดสอบสถานะผ่าน') as HTMLInputElement;
      expect(webhookInput.value).toBe('');
      const copyBtn = screen.getByRole('button', { name: /^คัดลอก$/i });
      expect(copyBtn.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('LOA-20: Fallback Console Link Destination', () => {
    it('OwnerLineOaPage: links to root console when unverified, and to channel Messaging API when connected', async () => {
      // Unverified/disconnected -> root console
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: true,
          channelId: '',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      const { unmount } = render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const rootLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(rootLink.getAttribute('href')).toBe('https://developers.line.biz/console/');
      expect(rootLink.getAttribute('target')).toBe('_blank');
      unmount();

      // Connected with channelId -> specific messaging-api console
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://example.com/api/v1/line/webhook/dorm-test-01',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const channelLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(channelLink.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
    });

    it('OwnerRegister: links to root console when unverified, and to channel Messaging API when connected', async () => {
      // Unverified -> root console
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: false,
            channelId: '',
            webhookUrl: '',
          },
        } as any,
      });

      const { unmount } = render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('LINE Developers Console > Messaging API')).toBeDefined();
      });

      const rootLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(rootLink.getAttribute('href')).toBe('https://developers.line.biz/console/');
      unmount();

      // Connected -> channel messaging-api console
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: true,
            channelId: '2010923779',
            webhookUrl: 'https://api.horplus.com/line/webhook/test-reg',
          },
        } as any,
      });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i })).toBeDefined();
      });

      const channelLink = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(channelLink.getAttribute('href')).toBe('https://developers.line.biz/console/channel/2010923779/messaging-api');
    });
  });

  describe('LOA-21: Step 6 LINE OA Setup Help Button & Modal (OwnerRegister)', () => {
    it('renders "ดูวิธีตั้งค่า LINE OA" button next to "ตั้งค่าภายหลัง" and opens 5-step modal on click', async () => {
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          dormName: 'หอพักทดสอบสุขสบาย',
          buildings: [],
          lineOA: {
            isConnected: false,
            channelId: '',
            channelSecret: '',
            webhookUrl: '',
          },
        } as any,
      });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByText('ขั้นตอนที่ 6: เชื่อมต่อ LINE OA')).toBeDefined();
      });

      // Both buttons are present in the header
      const helpBtn = screen.getByRole('button', { name: /ดูวิธีตั้งค่า LINE OA/i });
      const laterBtn = screen.getByRole('button', { name: /ตั้งค่าภายหลัง/i });
      expect(helpBtn).toBeDefined();
      expect(laterBtn).toBeDefined();

      // Modal is not visible initially
      expect(screen.queryByText('วิธีตั้งค่า LINE Official Account')).toBeNull();

      // Click "ดูวิธีตั้งค่า LINE OA" button
      fireEvent.click(helpBtn);

      // 5-step modal is now visible
      expect(screen.getByText('วิธีตั้งค่า LINE Official Account')).toBeDefined();
      expect(screen.getByText(/1\. เข้าสู่/i)).toBeDefined();
      expect(screen.getByText(/2\. สร้าง Channel ประเภท/i)).toBeDefined();
      expect(screen.getByText(/3\. ในแท็บ/i)).toBeDefined();
      expect(screen.getByText(/4\. ในแท็บ/i)).toBeDefined();
      expect(screen.getByText(/5\. ใน LINE Official Account Manager ให้ปิดฟังก์ชัน/i)).toBeDefined();

      // Click close button
      const closeBtn = screen.getByRole('button', { name: /เข้าใจแล้ว ปิดหน้าต่าง/i });
      fireEvent.click(closeBtn);

      // Modal is closed
      expect(screen.queryByText('วิธีตั้งค่า LINE Official Account')).toBeNull();
    });
  });

  describe('LOA-22: Channel Secret Masked Copy Block & Copy Button Removal', () => {
    it('OwnerLineOaPage: blocks copy/cut when masked, permits when open, and copy button is removed from UI', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          channelId: '2010923779',
          channelSecret: '',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();
      });

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...');
      const eyeBtn = screen.getByRole('button', { name: /กำลังแสดงรหัส/i });

      // Verify copy button is NOT rendered in UI
      expect(screen.queryByRole('button', { name: /คัดลอก Channel Secret/i })).toBeNull();
      expect(screen.queryByTitle(/คัดลอก Channel Secret/i)).toBeNull();

      // Type secret
      fireEvent.change(secretInput, { target: { value: 'super-secret-key-123' } });

      // When open (default), copy event is not prevented
      const openCopyEvent = new Event('copy', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(openCopyEvent);
      expect(openCopyEvent.defaultPrevented).toBe(false);

      // Toggle to masked
      fireEvent.click(eyeBtn);

      // When masked, copy event is prevented (cannot copy bullets)
      const maskedCopyEvent = new Event('copy', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(maskedCopyEvent);
      expect(maskedCopyEvent.defaultPrevented).toBe(true);

      const maskedCutEvent = new Event('cut', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(maskedCutEvent);
      expect(maskedCutEvent.defaultPrevented).toBe(true);
    });

    it('OwnerRegister: blocks copy/cut when masked, permits when open, and copy button is removed from UI', async () => {
      vi.spyOn(localDraftStorage, 'getRegistrationDraft').mockResolvedValue({
        currentStep: 6,
        formData: {
          lineOA: {
            isConnected: false,
            channelId: '2010923779',
            channelSecret: 'reg-secret-456',
            webhookUrl: '',
          },
        } as any,
      });

      render(<OwnerRegister mode="initial" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();
      });

      const secretInput = screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...');
      const eyeBtn = screen.getByRole('button', { name: /กำลังแสดงรหัส/i });

      // Verify copy button is NOT rendered in UI
      expect(screen.queryByRole('button', { name: /คัดลอก Channel Secret/i })).toBeNull();
      expect(screen.queryByTitle(/คัดลอก Channel Secret/i)).toBeNull();

      // User enters channel secret
      fireEvent.change(secretInput, { target: { value: 'reg-secret-456' } });

      // When open (default), copy event is not prevented
      const openCopyEvent = new Event('copy', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(openCopyEvent);
      expect(openCopyEvent.defaultPrevented).toBe(false);

      // Toggle to masked
      fireEvent.click(eyeBtn);

      // When masked, copy event is prevented
      const maskedCopyEvent = new Event('copy', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(maskedCopyEvent);
      expect(maskedCopyEvent.defaultPrevented).toBe(true);

      const maskedCutEvent = new Event('cut', { bubbles: true, cancelable: true });
      secretInput.dispatchEvent(maskedCutEvent);
      expect(maskedCutEvent.defaultPrevented).toBe(true);
    });
  });

  describe('LOA-23: Webhook URL Label & Console Link Parity with Step 6', () => {
    it('OwnerLineOaPage: renders console link in label pointing to root console when unverified, and to channel when verified', async () => {
      vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: false,
          isReady: false,
          credentialsVerified: false,
          channelId: null,
          hasChannelSecret: false,
          webhookUrl: null,
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'updateLineOaConfig').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          hasChannelSecret: true,
          webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/sec_test_key',
        } as any,
      });

      vi.spyOn(Task009ApiAdapter, 'testWebhookEndpoint').mockResolvedValue({
        success: true,
        data: {
          connected: true,
          isReady: false,
          credentialsVerified: true,
          channelId: '2010923779',
          webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/sec_test_key',
        } as any,
      });

      render(<OwnerLineOaPage dormitoryId="dorm-test-01" />);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...')).toBeDefined();
      });

      // 1. Unverified State: link is present in label above input and points to root console
      const consoleLinkUnverified = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(consoleLinkUnverified).toBeDefined();
      expect(consoleLinkUnverified.getAttribute('href')).toBe('https://developers.line.biz/console/');
      expect(consoleLinkUnverified.getAttribute('target')).toBe('_blank');

      // Helper text below input warns to fill credentials and test
      expect(
        screen.getByText('* กรุณากรอก Channel ID และ Channel Secret แล้วกดทดสอบตรวจสถานะ')
      ).toBeDefined();

      // Enter channel credentials
      fireEvent.change(screen.getByPlaceholderText('เช่น 1657889900'), {
        target: { value: '2010923779' },
      });
      fireEvent.change(screen.getByPlaceholderText('e4d8f9c2a1b3c4d5e6f7...'), {
        target: { value: 'secret1234567890' },
      });

      const testBtn = screen.getByRole('button', { name: /ทดสอบตรวจสถานะ LINE OA/i });
      fireEvent.click(testBtn);

      await waitFor(() => {
        expect(
          screen.getByDisplayValue('https://webhook.horplus.com/api/v1/line/webhook/sec_test_key')
        ).toBeDefined();
      });

      // 3. Verified State: link in label now points directly to channel messaging-api
      const consoleLinkVerified = screen.getByRole('link', { name: /LINE Developers Console > Messaging API/i });
      expect(consoleLinkVerified.getAttribute('href')).toBe(
        'https://developers.line.biz/console/channel/2010923779/messaging-api'
      );

      // Helper text below input changes to concise success instruction
      expect(
        screen.getAllByText('คัดลอก Webhook URL เพื่อนำไปเชื่อมต่อให้พร้อมใช้งาน').length
      ).toBeGreaterThanOrEqual(1);
    });
  });
});
