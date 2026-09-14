// @vitest-environment jsdom
/**
 * Frontend TDD Suite: Manager Role LINE OA Setup & Tenant Documents (MLD-01 to MLD-05)
 * @license Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import { Task009ApiAdapter } from '../data/adapters/task009';
import { getDataProvider } from '../data/dataProvider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OwnerWorkspace } from '../pages/owner';
import { AuthContext } from '../router/guards';

// Mock Task009ApiAdapter
vi.mock('../data/adapters/task009', () => ({
  Task009ApiAdapter: {
    getLineOaConfig: vi.fn(),
  },
  resolveLineFriendAddUrl: vi.fn((id) => id ? `https://line.me/R/ti/p/${id}` : null),
}));

describe('Frontend TDD: Manager Role LINE OA & Tenant Document Enablement', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  const mockContext = {
    dormitoryId: 'dorm-mgr-test-01',
    roomId: 'room-101',
    roomNumber: '101',
    buildingId: 'bld-1',
    buildingName: 'Building A',
    baseRent: 4500,
    securityDeposit: 9000,
  };

  const mockAvailableRooms = [
    {
      id: 'room-101',
      number: '101',
      roomNumber: '101',
      buildingId: 'bld-1',
      building: 'Building A',
      status: 'vacant',
      floor: 1,
      price: 4500,
      monthlyRent: 4500,
    },
  ];

  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = {};
    const storageMock = {
      getItem: vi.fn((k: string) => mockStorage[k] || null),
      setItem: vi.fn((k: string, v: string) => { mockStorage[k] = String(v); }),
      removeItem: vi.fn((k: string) => { delete mockStorage[k]; }),
      clear: vi.fn(() => { mockStorage = {}; }),
      key: vi.fn(() => null),
      length: 0,
    };
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
    window.scrollTo = vi.fn();
  });

  it('MLD-02: renders unconfigured LINE OA prompt and clicking "ตั้งค่า LINE OA" navigates to line-oa', async () => {
    vi.mocked(Task009ApiAdapter.getLineOaConfig).mockResolvedValue({
      success: true,
      data: {
        connected: false,
        isReady: false,
        lineOaId: null,
        channelId: null,
      } as any,
    });

    const mockNavigate = vi.fn();
    const mockNavigateToLineConfig = vi.fn();

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext}
        availableRooms={mockAvailableRooms as any}
        buildings={[]}
        onSelectRoom={vi.fn()}
        defaultTab="LINE"
        onNavigate={mockNavigate}
        onNavigateToLineConfig={mockNavigateToLineConfig}
      />
    );

    // Wait for unconfigured screen
    expect(await screen.findByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();

    const configBtn = screen.getByRole('button', { name: /ตั้งค่า LINE OA/i });
    expect(configBtn).toBeDefined();

    fireEvent.click(configBtn);

    // Should call navigation callback
    expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
  });

  it('MLD-02: falls back to onNavigate("line-oa") when onNavigateToLineConfig is omitted', async () => {
    vi.mocked(Task009ApiAdapter.getLineOaConfig).mockResolvedValue({
      success: true,
      data: {
        connected: false,
        isReady: false,
      } as any,
    });

    const mockNavigate = vi.fn();

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext}
        availableRooms={mockAvailableRooms as any}
        buildings={[]}
        onSelectRoom={vi.fn()}
        defaultTab="LINE"
        onNavigate={mockNavigate}
      />
    );

    expect(await screen.findByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();

    const configBtn = screen.getByRole('button', { name: /ตั้งค่า LINE OA/i });
    fireEvent.click(configBtn);

    expect(mockNavigate).toHaveBeenCalledWith('line-oa');
  });

  it('MLD-02: renders connected QR and LINE ID without error when LINE OA is ready', async () => {
    vi.mocked(Task009ApiAdapter.getLineOaConfig).mockResolvedValue({
      success: true,
      data: {
        connected: true,
        isReady: true,
        credentialsVerified: true,
        lineOaId: 'horplus_dorm',
        botDisplayName: 'หอพักสุขใจ',
        effectiveLineId: '@horplus_dorm',
        friendAddUrl: 'https://line.me/R/ti/p/@horplus_dorm',
        qrSvg: '<svg data-testid="mock-qr"></svg>',
      } as any,
    });

    render(
      <QuickAddTenantModal
        isOpen={true}
        onClose={vi.fn()}
        context={mockContext}
        availableRooms={mockAvailableRooms as any}
        buildings={[]}
        onSelectRoom={vi.fn()}
        defaultTab="LINE"
      />
    );

    expect(await screen.findByText('@horplus_dorm')).toBeDefined();
    expect(screen.getByText('หอพักสุขใจ')).toBeDefined();
    expect(screen.queryByText('ไม่สามารถโหลดข้อมูล LINE OA ได้')).toBeNull();
  });

  it('MLD-05: getIdentityDocumentUrl includes dormitoryId query parameter', () => {
    const dataProvider = getDataProvider();
    const url = dataProvider.tenants.getIdentityDocumentUrl('tenant-123', 'dorm-456');
    expect(url).toContain('/tenants/tenant-123/identity-document');
    expect(url).toContain('dormitoryId=dorm-456');
  });

  it('MLD-01: OwnerWorkspace allows manager to access line-oa view directly', async () => {
    vi.mocked(Task009ApiAdapter.getLineOaConfig).mockResolvedValue({
      success: true,
      data: {
        connected: false,
        isReady: false,
        credentialsVerified: false,
        lineOaId: null,
        channelId: null,
      } as any,
    });

    global.fetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({
        success: true,
        data: [],
      }),
    }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const managerUser: any = {
      id: 'mgr-uuid-1',
      name: 'ผู้จัดการทดสอบ',
      roleId: 'role-manager',
      roleName: 'ผู้จัดการ',
      email: 'mgr@horplus.local',
      memberships: [
        {
          id: 'mem-1',
          dormitoryId: 'dorm-mgr-test-01',
          roleCode: 'MANAGER',
          status: 'ACTIVE',
          dormitory: { id: 'dorm-mgr-test-01', name: 'หอพักสุขใจ' },
        },
      ],
    };

    const authValue = {
      user: managerUser,
      userType: 'staff',
      memberships: managerUser.memberships,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter initialEntries={['/owner/line-oa']}>
            <OwnerWorkspace user={managerUser} onLogout={vi.fn()} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );

    // Verify LINE OA page rendered for manager
    expect(await screen.findByText('ตั้งค่า LINE Official Account (LINE OA)')).toBeDefined();
  });
});
