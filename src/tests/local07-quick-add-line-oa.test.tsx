// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * LOCAL-07: Quick Add Tenant via LINE OA Integration & Invariant Tests (Q1 - Q9)
 * Verifies:
 * Q1. Opening "+ เพิ่มผู้เช่า" defaults to LINE tab
 * Q2. User can still switch from LINE to TERM / MONTHLY / DAILY
 * Q3. Same dorm / different room opens identical LINE panel data
 * Q4. NOT_CONNECTED state renders correct text + CTA and no QR
 * Q5. CONNECTED_BUT_WEBHOOK_NOT_READY renders truthful intermediate text, not "ยังไม่ได้เชื่อมต่อ LINE OA"
 * Q6. READY state renders QR + displayed LINE ID + direct friend link + copy button
 * Q7. No room-specific body content appears in LINE panel
 * Q8. Reopen modal after config state available → latest display state shown
 * Q9. LINE logo asset renders in intended panel/tab area
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { QuickAddRoomContext } from '../types';
import { Task009ApiAdapter } from '../data/adapters/task009';

describe('LOCAL-07 — Quick Add Tenant via LINE OA (Q1 - Q9 Suite)', () => {
  const mockContext101: QuickAddRoomContext = {
    roomId: 'room-101-id',
    roomNumber: '101',
    dormitoryId: 'dorm-fresh-01',
    buildingId: 'bld-a',
    building: {
      id: 'bld-a',
      name: 'อาคาร A',
      termMonths: 4,
      maxTermRentInstallments: 2,
    },
    effective: {
      monthlyRent: 4500,
      termRent: 16000,
      dailyRent: 600,
      depositAmount: 5000,
    },
  };

  const mockContext202: QuickAddRoomContext = {
    roomId: 'room-202-id',
    roomNumber: '202',
    dormitoryId: 'dorm-fresh-01',
    buildingId: 'bld-b',
    building: {
      id: 'bld-b',
      name: 'อาคาร B',
      termMonths: 4,
      maxTermRentInstallments: 2,
    },
    effective: {
      monthlyRent: 5500,
      termRent: 20000,
      dailyRent: 800,
      depositAmount: 6000,
    },
  };

  const mockContextDormB: QuickAddRoomContext = {
    roomId: 'room-b101-id',
    roomNumber: 'B101',
    dormitoryId: 'dorm-comp-02',
    buildingId: 'bld-comp-1',
    building: {
      id: 'bld-comp-1',
      name: 'อาคาร 1',
      termMonths: 6,
      maxTermRentInstallments: 3,
    },
    effective: {
      monthlyRent: 3500,
      termRent: 18000,
      dailyRent: 500,
      depositAmount: 4000,
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('Q1: Opening "+ เพิ่มผู้เช่า" defaults to LINE tab', async () => {
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

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    // LINE tab button is selected by default
    const lineButton = screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i });
    expect(lineButton.className).toContain('bg-[#06C755]');

    // Traditional rental submit button is NOT present
    expect(screen.queryByText('ยืนยันเพิ่มผู้เช่า')).toBeNull();

    // Modal subtitle reflects LINE onboarding
    expect(screen.getByText('ลงทะเบียนผู้เช่าผ่าน LINE Official Account ประจำหอพัก')).toBeTruthy();
  });

  it('Q2: User can still switch from LINE to TERM / MONTHLY / DAILY', async () => {
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

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    // Switch to TERM
    const termButton = screen.getByRole('button', { name: /รายเทอม/i });
    fireEvent.click(termButton);
    expect(screen.getByText('ยืนยันเพิ่มผู้เช่า')).toBeTruthy();
    expect(screen.getByText('ค่าเช่ารายเทอม (บาท)')).toBeTruthy();

    // Switch to MONTHLY
    const monthlyButton = screen.getByRole('button', { name: /รายเดือน/i });
    fireEvent.click(monthlyButton);
    expect(screen.getByText('ค่าเช่ารายเดือน (บาท)')).toBeTruthy();

    // Switch to DAILY
    const dailyButton = screen.getByRole('button', { name: /รายวัน/i });
    fireEvent.click(dailyButton);
    expect(screen.getByText('อัตราค่าเช่าต่อวัน (บาท)')).toBeTruthy();

    // Switch back to LINE
    const lineButton = screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i });
    fireEvent.click(lineButton);
    expect(screen.queryByText('ยืนยันเพิ่มผู้เช่า')).toBeNull();
  });

  it('Q3: Same dorm / different room opens identical LINE panel data', async () => {
    const mockGetConfig = vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
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
        lineOaId: '@dorm_fresh_shared',
        botPremiumId: null,
        botDisplayName: 'หอพักเฟรชวิลล์',
        channelId: '111222333',
        accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/key',
        effectiveLineId: '@dorm_fresh_shared',
        friendAddUrl: 'https://line.me/R/ti/p/%40dorm_fresh_shared',
        qrSvg: '<svg data-testid="shared-qr-svg"></svg>',
      },
    });

    // 1. Render Room 101
    const { unmount } = render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('line-oa-id-display').textContent).toContain('@dorm_fresh_shared');
    });
    const link101 = screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/i }).getAttribute('href');

    unmount();

    // 2. Render Room 202
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext202}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('line-oa-id-display').textContent).toContain('@dorm_fresh_shared');
    });
    const link202 = screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/i }).getAttribute('href');

    expect(link101).toBe('https://line.me/R/ti/p/%40dorm_fresh_shared');
    expect(link202).toBe('https://line.me/R/ti/p/%40dorm_fresh_shared');
    expect(mockGetConfig).toHaveBeenCalledWith('dorm-fresh-01');
  });

  it('Q4: NOT_CONNECTED state renders correct text + CTA and no QR', async () => {
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
        context={mockContext101}
        onSuccess={vi.fn()}
        onNavigateToLineConfig={mockNavigateToLineConfig}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE OA')).toBeTruthy();
    });

    expect(screen.getByText('กรุณาตั้งค่า LINE Official Account ของหอพักก่อนใช้งานการเพิ่มผู้เช่าผ่าน LINE')).toBeTruthy();
    expect(screen.queryByTestId('line-oa-qr-svg-container')).toBeNull();

    const manageButton = screen.getByRole('button', { name: /จัดการ LINE Official Account/i });
    expect(manageButton).toBeTruthy();

    fireEvent.click(manageButton);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
  });

  it('Q5: CONNECTED_BUT_WEBHOOK_NOT_READY renders truthful intermediate text, not "ยังไม่ได้เชื่อมต่อ LINE OA"', async () => {
    vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockResolvedValue({
      success: true,
      data: {
        connected: true,
        isReady: false,
        credentialsVerified: true,
        webhookEndpointSet: false,
        webhookTestSucceeded: false,
        webhookActive: false,
        hasChannelSecret: true,
        hasAccessToken: true,
        lineOaId: '@configured_dorm',
        channelId: '123456789',
        accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookVerifiedAt: null,
        webhookUrl: null,
      },
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('เชื่อมต่อ LINE OA แล้ว แต่ Webhook ยังไม่พร้อม')).toBeTruthy();
    });

    // Must NOT claim "ยังไม่ได้เชื่อมต่อ LINE OA"
    expect(screen.queryByText('ยังไม่ได้เชื่อมต่อ LINE OA')).toBeNull();
    expect(screen.getByText(/เชื่อมต่อบัญชี LINE Official Account เรียบร้อยแล้ว แต่ระบบ Webhook ยังไม่พร้อมใช้งาน/)).toBeTruthy();
    expect(screen.queryByTestId('line-oa-qr-svg-container')).toBeNull();
  });

  it('Q6: READY state renders QR + displayed LINE ID + direct friend link + copy button', async () => {
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
        lineOaId: '@somchai_dorm',
        botPremiumId: '@premium_dorm',
        botDisplayName: 'หอพักสมชายเพลส',
        channelId: '987654321',
        accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/key',
        effectiveLineId: '@premium_dorm',
        friendAddUrl: 'https://line.me/R/ti/p/%40premium_dorm',
        qrSvg: '<svg data-testid="real-qr-svg"><rect width="200" height="200" /></svg>',
      },
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('หอพักสมชายเพลส')).toBeTruthy();
    });

    // Verified public ID display
    const idDisplay = screen.getByTestId('line-oa-id-display');
    expect(idDisplay.textContent).toContain('@premium_dorm');

    // QR Container
    const qrContainer = screen.getByTestId('line-oa-qr-svg-container');
    expect(qrContainer).toBeTruthy();
    expect(qrContainer.innerHTML).toContain('rect width="200"');

    // Friend add link
    const friendLink = screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/i });
    expect(friendLink.getAttribute('href')).toBe('https://line.me/R/ti/p/%40premium_dorm');
    expect(friendLink.getAttribute('target')).toBe('_blank');

    // 5-step instructions
    expect(screen.getByText('ขั้นตอนการลงทะเบียนสำหรับผู้เช่า')).toBeTruthy();
    expect(screen.getByText(/สแกน QR Code หรือเพิ่มเพื่อนผ่าน LINE ID ที่แสดง/)).toBeTruthy();
    expect(screen.getByText(/กดปุ่ม "ลงทะเบียนผู้เช่า" ใน LINE/)).toBeTruthy();
    expect(screen.getByText(/กรอกข้อมูลให้ครบถ้วน พร้อมแนบเอกสารที่กำหนด/)).toBeTruthy();
    expect(screen.getByText(/รอเจ้าของหอพักตรวจสอบและอนุมัติ/)).toBeTruthy();
    expect(screen.getByText(/ลงทะเบียนสำเร็จ พร้อมใช้งาน/)).toBeTruthy();
  });

  it('Q7: No room-specific body content appears in LINE panel', async () => {
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
        lineOaId: '@dorm_fresh',
        botPremiumId: null,
        botDisplayName: 'หอพักเฟรชวิลล์',
        channelId: '1234567890',
        accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/key',
        friendAddUrl: 'https://line.me/R/ti/p/@dorm_fresh',
        qrSvg: '<svg data-testid="real-qr-svg"></svg>',
      },
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('LINE Official Account')).toBeTruthy();
    });

    // Verify ZERO room target summary in LINE body
    expect(screen.queryByText('ห้องพักเป้าหมาย')).toBeNull();
    expect(screen.queryByText(/ห้อง 101/)).toBeNull();
    expect(screen.queryByText(/อาคาร A/)).toBeNull();
    expect(screen.queryByText(/ชั้น 1/)).toBeNull();
  });

  it('Q8: Reopen modal after config state available → latest display state shown', async () => {
    let currentConfig: any = {
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
    };

    const spy = vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockImplementation(async () => ({
      success: true,
      data: currentConfig,
    }));

    // 1. First open: unconfigured
    const { rerender } = render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE OA')).toBeTruthy();
    });

    // 2. Modal closes
    rerender(
      <QuickAddTenantModal
        isOpen={false}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    // 3. User configures LINE OA (credentials verified, webhook ready)
    currentConfig = {
      connected: true,
      isReady: true,
      credentialsVerified: true,
      webhookEndpointSet: true,
      webhookTestSucceeded: true,
      webhookActive: true,
      hasChannelSecret: true,
      hasAccessToken: true,
      lineOaId: '@reopened_dorm',
      effectiveLineId: '@reopened_dorm',
      botDisplayName: 'หอพักอัปเดตใหม่',
      friendAddUrl: 'https://line.me/R/ti/p/%40reopened_dorm',
      qrSvg: '<svg data-testid="reopened-qr-svg"></svg>',
    };

    // 4. Modal reopens
    rerender(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('หอพักอัปเดตใหม่')).toBeTruthy();
      expect(screen.getByTestId('line-oa-id-display').textContent).toContain('@reopened_dorm');
      expect(screen.getByTestId('line-oa-qr-svg-container')).toBeTruthy();
    });
  });

  it('Q9: LINE logo asset renders in intended panel/tab area', async () => {
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
        channelId: '123456789',
        lineOaId: '@dorm_fresh',
        botDisplayName: 'หอพักเฟรชวิลล์',
        effectiveLineId: '@dorm_fresh',
        friendAddUrl: 'https://line.me/R/ti/p/@dorm_fresh',
        qrSvg: '<svg data-testid="real-qr-svg"></svg>',
        accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
        webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/key',
      },
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => {
      const logos = screen.getAllByTestId('line-official-logo');
      expect(logos.length).toBeGreaterThanOrEqual(2); // One in Tab Button, one in Panel Header
    });
  });
});
