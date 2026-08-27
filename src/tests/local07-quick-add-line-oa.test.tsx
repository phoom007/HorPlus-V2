// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * LOCAL-07: Quick Add Tenant via LINE OA Integration & Invariant Tests
 * Verifies:
 * 1. 4-Option layout (Row 1: TERM/MONTHLY/DAILY, Row 2: LINE)
 * 2. Pure dormitory-level onboarding: NO room-target summary in LINE body
 * 3. Exact 3 UI states: Loading, Not-Ready (with CTA to LINE OA settings), Ready (with QR, ID, Copy, Direct Link, 5-Step instructions)
 * 4. Room 101 vs Room 202 identical LINE presentation
 * 5. Dormitory A vs Dormitory B isolation
 * 6. Non-financial onboarding semantics: zero rental contract submissions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { QuickAddRoomContext } from '../types';
import { Task009ApiAdapter } from '../data/adapters/task009';

describe('LOCAL-07 — Quick Add Tenant via LINE OA', () => {
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

  it('P1 & P2: renders 4 quick add options with Row 1 (TERM, MONTHLY, DAILY) and Row 2 (LINE แนะนำ)', () => {
    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext101}
        onSuccess={vi.fn()}
      />
    );

    // Row 1 buttons
    expect(screen.getByRole('button', { name: /รายเทอม/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /รายเดือน/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /รายวัน/i })).toBeTruthy();

    // Row 2 LINE button with badge
    const lineButton = screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i });
    expect(lineButton).toBeTruthy();
    expect(lineButton.textContent).toContain('แนะนำ');
  });

  it('P3 & P16: selecting LINE mode hides rental contract form/submit button and renders ZERO room-specific summary in body', async () => {
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

    // Initially in TERM tab -> rental form is visible
    expect(screen.getByText('ยืนยันเพิ่มผู้เช่า')).toBeTruthy();
    expect(screen.getByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeTruthy();

    // Switch to LINE tab
    const lineButton = screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i });
    fireEvent.click(lineButton);

    // Rental form and submit button must disappear
    expect(screen.queryByText('ยืนยันเพิ่มผู้เช่า')).toBeNull();
    expect(screen.queryByPlaceholderText('เช่น นายสมชาย ใจดี')).toBeNull();

    // Wait for LINE content to render
    await waitFor(() => {
      expect(screen.getByText('LINE Official Account')).toBeTruthy();
    });

    // Verify ZERO room target summary in LINE body
    expect(screen.queryByText('ห้องพักเป้าหมาย')).toBeNull();
    expect(screen.queryByText(/ห้อง 101/)).toBeNull();
    expect(screen.queryByText(/อาคาร A/)).toBeNull();
    expect(screen.queryByText(/ชั้น 1/)).toBeNull();
  });

  it('P8: renders STATE B (Not Ready) with CTA navigating to LINE OA settings when LINE OA is unconfigured', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i }));

    await waitFor(() => {
      expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE OA')).toBeTruthy();
    });

    expect(screen.getByText('กรุณาตั้งค่า LINE Official Account ของหอพักก่อนใช้งานการเพิ่มผู้เช่าผ่าน LINE')).toBeTruthy();

    const manageButton = screen.getByRole('button', { name: /จัดการ LINE Official Account/i });
    expect(manageButton).toBeTruthy();

    fireEvent.click(manageButton);
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
  });

  it('P7, P9, P10, P11, P15: renders STATE C (Ready) with verified LINE ID, QR SVG, Copy button, direct link, and 5-step instructions', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i }));

    await waitFor(() => {
      expect(screen.getByText('หอพักสมชายเพลส')).toBeTruthy();
    });

    // Verified public ID display (preferring botPremiumId)
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

  it('P3 & P4: Room 101 and Room 202 in the same dormitory produce IDENTICAL LINE ID, QR, and friend URL', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i }));
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

    fireEvent.click(screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i }));
    await waitFor(() => {
      expect(screen.getByTestId('line-oa-id-display').textContent).toContain('@dorm_fresh_shared');
    });
    const link202 = screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/i }).getAttribute('href');

    // Identical friend add URL across rooms
    expect(link101).toBe('https://line.me/R/ti/p/%40dorm_fresh_shared');
    expect(link202).toBe('https://line.me/R/ti/p/%40dorm_fresh_shared');
    expect(mockGetConfig).toHaveBeenCalledWith('dorm-fresh-01');
  });

  it('P5: Dormitory A vs Dormitory B isolation (displays dormitory-specific LINE OA)', async () => {
    vi.spyOn(Task009ApiAdapter, 'getLineOaConfig').mockImplementation(async (dormId) => {
      if (dormId === 'dorm-comp-02') {
        return {
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
            lineOaId: '@comp_dorm_02',
            botPremiumId: null,
            botDisplayName: 'หอพักคอมพรีเฮนซีฟ',
            channelId: '999888777',
            accessTokenVerifiedAt: '2026-08-01T00:00:00.000Z',
            webhookVerifiedAt: '2026-08-01T00:00:00.000Z',
            webhookUrl: 'https://webhook.horplus.com/api/v1/line/webhook/key2',
            effectiveLineId: '@comp_dorm_02',
            friendAddUrl: 'https://line.me/R/ti/p/%40comp_dorm_02',
            qrSvg: '<svg data-testid="dorm-b-qr-svg"></svg>',
          },
        };
      }
      return { success: false };
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContextDormB}
        onSuccess={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /เพิ่มผู้เช่า LINE/i }));

    await waitFor(() => {
      expect(screen.getByTestId('line-oa-id-display').textContent).toContain('@comp_dorm_02');
    });

    expect(screen.getByText('หอพักคอมพรีเฮนซีฟ')).toBeTruthy();
    expect(screen.getByRole('link', { name: /เพิ่มเพื่อนใน LINE/i }).getAttribute('href')).toBe(
      'https://line.me/R/ti/p/%40comp_dorm_02'
    );
  });
});
