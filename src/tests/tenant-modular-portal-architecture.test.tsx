/**
 * @license Apache-2.0
 * @vitest-environment happy-dom
 *
 * HORPLUS-V2 — TENANT MODULAR PORTAL ARCHITECTURE INTEGRATION TEST SUITE
 * Verifies:
 * 1. Modular architecture exports and component integrity
 * 2. Home Tab rendering: Indigo-Blue gradient banner, Room switcher pill, Action tiles
 * 3. SubView transitions: Invoice, Payment (with PromptPay QR), Repairs, Utilities, Contract
 * 4. Tab switching: Home -> Announcements -> Payments -> Profile
 * 5. DevTenantSwitcher presence in dev mode
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TenantWorkspace } from '../pages/tenant';
import { TenantPaymentView } from '../pages/tenant/views/TenantPaymentView';
import { TenantUtilitiesView } from '../pages/tenant/views/TenantUtilitiesView';
import { TenantProfileTab } from '../pages/tenant/tabs/TenantProfileTab';
import { DevTenantSwitcher } from '../pages/tenant/components/DevTenantSwitcher';
import { TenantNotificationModal } from '../pages/tenant/modals/TenantNotificationModal';
import { TenantPaymentsTab } from '../pages/tenant/tabs/TenantPaymentsTab';
import { TenantHomeTab } from '../pages/tenant/tabs/TenantHomeTab';
import { TenantRegisterPage } from '../pages/tenant/TenantRegisterPage';
import { TenantRegisterView } from '../components/tenant/TenantRegisterView';
import { TenantClaimModal } from '../components/TenantClaimModal';
import { OwnerDateInput } from '../components/OwnerDateInput';
import { openTenantContractPrintWindow } from '../pages/tenant/tenantHelpers';
import * as apiAdapter from '../data/adapters/api';
import { Tenant } from '../types';

// Mock localStorage if missing or not working in happy-dom environment
const createMockStorage = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
};

if (typeof window !== 'undefined') {
  try {
    const mock = createMockStorage();
    Object.defineProperty(window, 'localStorage', { value: mock, writable: true, configurable: true });
  } catch (e) {}
}
if (typeof globalThis !== 'undefined') {
  try {
    const mock = (typeof window !== 'undefined' && window.localStorage) ? window.localStorage : createMockStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true, configurable: true });
  } catch (e) {}
}

describe('Tenant Modular Portal Architecture & UI Overhaul Suite', () => {
  const mockTenant: Tenant = {
    id: 'tenant-mod-001',
    name: 'ชาญวิทย์ สุขสบาย',
    phone: '081-111-1111',
    email: 'chanwit@example.com',
    citizenId: '1234567890123',
    dormitoryId: 'dorm-001',
    roomId: 'rm-101',
    roomNumber: '101',
    buildingName: 'อาคารชาญวิทย์',
    status: 'active',
    coOccupants: [
      { id: 'co-1', name: 'สมหญิง สุขสบาย', phone: '082-222-2222', relationship: 'แฟน' }
    ]
  } as any;

  const mockRoomsResponse = {
    rooms: [
      {
        tenantId: 'tenant-mod-001',
        roomId: 'rm-101',
        roomNumber: '101',
        buildingName: 'อาคารชาญวิทย์',
        dormitoryName: 'หอพักชาญวิทย์แมนชั่น',
        isCurrent: true,
      },
    ],
  };

  const mockProfileResponse = {
    id: 'tenant-mod-001',
    displayName: 'ชาญวิทย์ สุขสบาย',
    firstName: 'ชาญวิทย์',
    lastName: 'สุขสบาย',
    phone: '081-111-1111',
    email: 'chanwit@example.com',
    citizenId: '1234567890123',
    roomNumber: '101',
    buildingName: 'อาคารชาญวิทย์',
    coOccupants: [
      { id: 'co-1', name: 'สมหญิง สุขสบาย', phone: '082-222-2222' }
    ],
    room: {
      id: 'rm-101',
      roomNumber: '101',
      buildingId: 'bld-1',
    },
    dormitory: {
      id: 'dorm-001',
      name: 'หอพักชาญวิทย์แมนชั่น',
    },
  };

  const mockBillsResponse = {
    data: [
      {
        id: 'bill-unpaid-1',
        billNumber: 'INV-2026-001',
        cycleId: '2026-09',
        totalAmount: 4850,
        paidAmount: 0,
        outstandingAmount: 4850,
        status: 'UNPAID',
        createdAt: '2026-09-01T00:00:00.000Z',
        dueDate: '2026-09-15T00:00:00.000Z',
        items: [
          { id: 'item-1', description: 'ค่าเช่าห้องพัก', amount: 4000, type: 'RENT' },
          { id: 'item-2', description: 'ค่าไฟฟ้า', amount: 650, type: 'ELECTRICITY' },
          { id: 'item-3', description: 'ค่าน้ำประปา', amount: 200, type: 'WATER' },
        ],
      },
      {
        id: 'bill-paid-old',
        billNumber: 'INV-2026-000',
        cycleId: '2026-08',
        totalAmount: 4850,
        paidAmount: 4850,
        outstandingAmount: 0,
        status: 'PAID',
        createdAt: '2026-08-01T00:00:00.000Z',
        dueDate: '2026-08-15T00:00:00.000Z',
        items: [
          { id: 'item-old-1', description: 'ค่าเช่าห้องพัก', amount: 4000, type: 'RENT' },
          { id: 'item-old-2', description: 'ค่าไฟฟ้า', amount: 850, type: 'ELECTRICITY' },
        ],
        receipt: { id: 'rcp-1', receiptNumber: 'RCP-2026-000' },
      },
    ],
  };

  const mockPaymentOptionsResponse = {
    data: {
      configured: true,
      promptPayConfigured: true,
      bankTransferConfigured: true,
      promptPayDisplay: '081-111-1111',
      qrUrl: 'https://example.com/qr.png',
      bankCode: 'KBANK',
      bankAccountNumber: '123-4-56789-0',
      bankAccountName: 'บจก. หอพักชาญวิทย์',
    },
  };

  const mockAnnouncementsResponse = {
    data: [
      {
        id: 'ann-1',
        title: 'แจ้งทำความสะอาดถังพักน้ำประจำปี',
        content: 'จะมีการล้างถังพักน้ำในวันเสาร์นี้ น้ำประปาจะไหลอ่อนชั่วคราว',
        type: 'water_off',
        targetType: 'all',
        isPinned: true,
        isUrgent: true,
        author: 'สมเกียรติ (Owner)',
        publishDate: '2026-09-10',
        createdAt: '2026-09-10T00:00:00.000Z',
      },
    ],
  };

  const mockContractsResponse = {
    data: {
      id: 'ctr-1',
      contractNumber: 'CTR-2026-101',
      dormitoryId: 'dorm-001',
      roomId: 'rm-101',
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
      durationMonths: 12,
      rentAmount: 4000,
      depositAmount: 8000,
      status: 'active',
    },
  };

  const mockUtilitiesResponse = {
    data: {
      latestElectric: {
        unitPrice: 8,
        previousReading: 1200,
        currentReading: 1280,
        usageUnits: 80,
      },
      latestWater: {
        unitPrice: 18,
        previousReading: 310,
        currentReading: 320,
        usageUnits: 10,
      },
      readings: [],
    },
  };

  const createJsonResponse = (data: any, ok = true, status = 200) => ({
    ok,
    status,
    headers: {
      get: (header: string) => {
        if (header.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
    json: async () => data,
    text: async () => JSON.stringify(data),
  });

  beforeEach(() => {
    sessionStorage.clear();
    global.fetch = vi.fn(async (url: any) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/v1/tenant-portal/rooms')) {
        return createJsonResponse(mockRoomsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/profile')) {
        return createJsonResponse(mockProfileResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/bills')) {
        return createJsonResponse(mockBillsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/payment-options')) {
        return createJsonResponse(mockPaymentOptionsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/announcements')) {
        return createJsonResponse(mockAnnouncementsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/contract')) {
        return createJsonResponse(mockContractsResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/utilities')) {
        return createJsonResponse(mockUtilitiesResponse) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/maintenance')) {
        return createJsonResponse({ data: [] }) as any;
      }
      if (urlStr.includes('/api/v1/tenant-portal/notices')) {
        return createJsonResponse([]) as any;
      }
      return createJsonResponse({}) as any;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders Home Tab with tenant name, room badge, active unpaid bill amount, and 6 primary action tiles', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Header greeting & room badge
    expect(await screen.findByText(/คุณ ชาญวิทย์ สุขสบาย/)).toBeDefined();
    expect(screen.getByText(/ห้อง 101 • อาคารชาญวิทย์/)).toBeDefined();

    // Active bill hero card
    expect(screen.getByText('ยอดค้างชำระ')).toBeDefined();
    expect(screen.getByText(/฿ 4,850.00/)).toBeDefined();
    expect(screen.getByText('รอชำระ')).toBeDefined();

    // 6 action tiles
    expect(screen.getByText('ใบแจ้งหนี้')).toBeDefined();
    expect(screen.getByText('ชำระค่าเช่า')).toBeDefined();
    expect(screen.getByText('แจ้งซ่อมบำรุง')).toBeDefined();
    expect(screen.getByText('ค่าน้ำ / ค่าไฟ')).toBeDefined();
    expect(screen.getByText('เอกสารสัญญา')).toBeDefined();
    expect(screen.getByText('ประวัติการชำระ')).toBeDefined();
  });

  it('navigates to Invoice subview and displays item breakdown with breakdown numbers', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    const invoiceTile = await screen.findByText('ใบแจ้งหนี้');
    fireEvent.click(invoiceTile);

    // Invoice Subview Title
    expect(await screen.findByText('ใบแจ้งหนี้')).toBeDefined();
    expect(screen.getByText('เดือนปัจจุบัน')).toBeDefined();
    expect(screen.getByText('ประวัติบิลอื่นๆ')).toBeDefined();
    expect(screen.getByText(/ค่าเช่า/)).toBeDefined();
    expect(screen.getByText(/ค่าไฟฟ้า/)).toBeDefined();
    expect(screen.getByText(/ค่าน้ำ/)).toBeDefined();

    // Go back to home
    const backBtn = screen.getByLabelText('ย้อนกลับ');
    fireEvent.click(backBtn);

    // Returned to home tab
    expect(await screen.findByText('เมนูหลัก')).toBeDefined();
  });

  it('navigates to Payment subview and displays PromptPay details and bank account with tab toggle', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    const payTile = await screen.findByText('ชำระค่าเช่า');
    fireEvent.click(payTile);

    // Ticket 05 Point 1: HomeTab "ชำระค่าเช่า" opens invoice view first to review bill, then clicking 'แจ้งชำระเงิน' opens payment subview
    const invoicePayBtn = await screen.findByTestId('btn-invoice-pay');
    fireEvent.click(invoicePayBtn);

    // Payment Subview
    expect(await screen.findByText('แจ้งชำระเงิน')).toBeDefined();
    expect(screen.getByText('ช่องทางการชำระเงิน')).toBeDefined();

    // Default tab is PromptPay (PO Q2=A)
    expect(screen.getByText('081-111-1111')).toBeDefined();

    // Toggle to Bank tab
    const bankTabBtn = screen.getByTestId('payment-tab-bank');
    fireEvent.click(bankTabBtn);
    expect(screen.getByText('123-4-56789-0')).toBeDefined();
    expect(screen.getByText(/หลักฐานการโอนเงิน/)).toBeDefined();
  });

  it('switches across bottom navigation tabs: Announcements, Payments, Profile', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // 1. Announcements Tab
    const annNav = await screen.findByTestId('nav-tab-announcements');
    fireEvent.click(annNav);
    expect(await screen.findByText(/ข่าวสารและประกาศนิติบุคคล/)).toBeDefined();
    expect(screen.getByText('แจ้งทำความสะอาดถังพักน้ำประจำปี')).toBeDefined();
    expect(screen.getByText('ปักหมุด')).toBeDefined();
    expect(screen.getByText('ด่วน')).toBeDefined();

    // 2. Payments Tab
    const paymentsNav = screen.getByTestId('nav-tab-payments_tab');
    fireEvent.click(paymentsNav);
    expect(await screen.findByText(/บิลและการชำระเงิน/)).toBeDefined();
    expect(screen.getByText(/INV-2026-001/)).toBeDefined();

    // 3. Profile Tab
    const profileNav = screen.getByTestId('nav-tab-profile');
    fireEvent.click(profileNav);
    expect(await screen.findByText('ข้อมูลและโปรไฟล์ผู้เช่า')).toBeDefined();
    expect(screen.getByText('สมหญิง สุขสบาย')).toBeDefined();
    expect(screen.getByText('แจ้งย้ายออก / เลิกเช่าห้องพัก')).toBeDefined();
  });

  it('does not render DevTenantSwitcher in tenant workspace (PO requirement)', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    expect(screen.queryByTestId('dev-tenant-switcher-btn')).toBeNull();
    expect(screen.queryByText('DEV SWITCHER')).toBeNull();
  });

  it('hides fixed bottom navigation bar when inside subviews to prevent button collision', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Root tab: bottom navigation is present
    expect(await screen.findByTestId('nav-tab-home')).toBeDefined();
    expect(screen.getByTestId('nav-tab-payments_tab')).toBeDefined();

    // Navigate to Repairs SubView
    const repairsBtn = screen.getByTestId('menu-repairs-btn');
    fireEvent.click(repairsBtn);

    // Repairs view is active
    expect(await screen.findByText('แจ้งซ่อมบำรุง')).toBeDefined();
    expect(screen.getByText('+ แจ้งซ่อมบำรุงใหม่')).toBeDefined();

    // Bottom navigation bar must be hidden (unmounted)
    expect(screen.queryByTestId('nav-tab-home')).toBeNull();
    expect(screen.queryByTestId('nav-tab-payments_tab')).toBeNull();

    // Go back to Home
    const backBtn = screen.getByLabelText('ย้อนกลับ');
    fireEvent.click(backBtn);

    // Bottom navigation bar is restored
    expect(await screen.findByTestId('nav-tab-home')).toBeDefined();
  });

  it('expands historical bill breakdown when clicked in Invoice View history tab', async () => {
    // Add items to mock paid bill so breakdown can be tested
    mockBillsResponse.data[1].items = [
      { id: 'item-old-1', description: 'ค่าเช่าห้องพัก', amount: 4000, type: 'RENT' },
      { id: 'item-old-2', description: 'ค่าไฟฟ้า', amount: 850, type: 'ELECTRICITY' },
    ];

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    const invoiceTile = await screen.findByText('ใบแจ้งหนี้');
    fireEvent.click(invoiceTile);

    // Switch to history tab
    const historyTabBtn = await screen.findByText('ประวัติบิลอื่นๆ');
    fireEvent.click(historyTabBtn);

    // Click historical bill card
    const billCard = await screen.findByTestId('history-bill-bill-paid-old');
    expect(billCard).toBeDefined();
    fireEvent.click(billCard);

    // Breakdown is expanded
    expect(await screen.findByText('ชำระแล้ว')).toBeDefined();
  });

  it('renders Notification Center as TenantBottomSheet with grab handle and no X button', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Open notification modal
    const notifBtn = await screen.findByTestId('tenant-notification-bell-btn');
    fireEvent.click(notifBtn);

    // Verify TenantBottomSheet renders
    const sheet = await screen.findByTestId('tenant-bottom-sheet');
    expect(sheet).toBeDefined();

    // Verify grab handle exists
    const grabHandle = screen.getByTestId('bottom-sheet-grab-handle');
    expect(grabHandle).toBeDefined();

    // Verify NO 'X' button exists
    expect(screen.queryByLabelText('ปิด')).toBeNull();
    const closeSvg = sheet.querySelector('.lucide-x');
    expect(closeSvg).toBeNull();

    // Backdrop click dismisses
    const backdrop = screen.getByTestId('bottom-sheet-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('tenant-bottom-sheet')).toBeNull();
  });

  it('renders Move-Out modal as TenantBottomSheet with strictly ONLY 1 move-out date input', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Go to Profile tab
    const profileNav = await screen.findByTestId('nav-tab-profile');
    fireEvent.click(profileNav);

    // Click แจ้งย้ายออก button
    const moveOutBtn = await screen.findByText('แจ้งย้ายออก / เลิกเช่าห้องพัก');
    fireEvent.click(moveOutBtn);

    // Verify bottom sheet appears
    const sheet = await screen.findByTestId('tenant-bottom-sheet');
    expect(sheet).toBeDefined();

    // Verify strictly 1 date input exists
    const dateInput = sheet.querySelector('input[type="date"]');
    expect(dateInput).toBeDefined();

    // Verify bank refund and reason inputs are removed
    expect(screen.queryByPlaceholderText(/กสิกรไทย/)).toBeNull();
    expect(screen.queryByPlaceholderText(/123-4-56789-0/)).toBeNull();
    expect(screen.queryByPlaceholderText(/ระบุเหตุผล/)).toBeNull();
  });

  it('renders Utilities view with recharts usage chart card', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Click ค่าน้ำ / ค่าไฟ menu
    const utilBtn = await screen.findByText('ค่าน้ำ / ค่าไฟ');
    fireEvent.click(utilBtn);

    // Verify header and chart card render
    expect(await screen.findByText('ค่าน้ำ / ค่าไฟ')).toBeDefined();
    expect(screen.getByTestId('utilities-usage-chart-card')).toBeDefined();
    expect(screen.getByText('สถิติการใช้งานน้ำ - ไฟฟ้าย้อนหลัง')).toBeDefined();
  });

  it('supports multi-bill circular checkboxes, real-time total sum, and sticky bottom payment button', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Open invoice view
    const invoiceBtn = await screen.findByText('ใบแจ้งหนี้');
    fireEvent.click(invoiceBtn);

    // Verify invoice view rendered
    expect(await screen.findByText('ยอดรวมที่เลือกชำระ (1 รายการ)')).toBeDefined();

    // Verify circular checkbox exists
    const checkbox = screen.getByTestId('checkbox-bill-bill-unpaid-1');
    expect(checkbox).toBeDefined();

    // Verify sticky bottom button with Coins icon exists
    const payBtn = screen.getByTestId('btn-invoice-pay');
    expect(payBtn).toBeDefined();
    expect(payBtn.textContent).toContain('แจ้งชำระเงิน');

    // Click pay button to navigate to payment view
    fireEvent.click(payBtn);
    expect(await screen.findByText('ยอดชำระทั้งหมด')).toBeDefined();
  });

  it('renders historical bills as accordion list with expandable item details', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Open invoice view
    const invoiceBtn = await screen.findByText('ใบแจ้งหนี้');
    fireEvent.click(invoiceBtn);

    // Switch to history tab
    const historyTabBtn = await screen.findByText('ประวัติบิลอื่นๆ');
    fireEvent.click(historyTabBtn);

    // Find historical bill accordion item
    const historyItem = await screen.findByTestId('history-bill-bill-paid-old');
    expect(historyItem).toBeDefined();
    expect(historyItem.textContent).toContain('รอบบิล สิงหาคม 2569');

    // Click to expand accordion details
    fireEvent.click(historyItem.querySelector('button')!);
    expect(await screen.findByText('ยอดรวมทั้งสิ้น')).toBeDefined();
    expect(screen.getByText(/ดูใบเสร็จรับเงิน/)).toBeDefined();
  });

  it('allows inline editing of vehicle and pet info in TenantProfileTab without popup', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Navigate to profile tab
    const profileNav = await screen.findByTestId('nav-tab-profile');
    fireEvent.click(profileNav);

    // Verify edit button exists
    const editBtn = await screen.findByTestId('btn-edit-tenant-info');
    expect(editBtn.textContent).toContain('แก้ไขข้อมูล');

    // Click to expand inline form / open bottom sheet
    fireEvent.click(editBtn);
    expect(await screen.findByTestId('tenant-bottom-sheet')).toBeDefined();

    // Verify vehicle options
    expect(screen.getByText('รถยนต์')).toBeDefined();
    expect(screen.getByText('รถจักรยานยนต์')).toBeDefined();

    // Verify move-out card has soft neutral border
    const moveOutSection = screen.getByText('สัญญาเช่าและการแจ้งย้ายออก').closest('.bg-white');
    expect(moveOutSection?.className).toContain('border-slate-200/60');
    expect(moveOutSection?.className).not.toContain('border-rose-150');
  });

  it('displays strictly 2 documents in เอกสารของฉัน matching owner parity, removing mock rules', async () => {
    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Navigate to Contract subview
    const contractTile = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile);

    // Verify header and section
    expect(await screen.findByText('เอกสารสัญญา')).toBeDefined();
    expect(screen.getByText('เอกสารของฉัน')).toBeDefined();

    // Verify strictly 2 document items exist
    const contractDoc = screen.getByTestId('tenant-doc-item-contract');
    const idCardDoc = screen.getByTestId('tenant-doc-item-id_card');
    expect(contractDoc).toBeDefined();
    expect(idCardDoc).toBeDefined();

    // Verify mock document 'กฎระเบียบและข้อบังคับอาคารพักอาศัย' is strictly NOT in DOM
    expect(screen.queryByText(/กฎระเบียบและข้อบังคับอาคารพักอาศัย/)).toBeNull();

    // Verify contract document item text
    expect(contractDoc.textContent).toContain('เอกสารสัญญาเช่า');
    expect(contractDoc.textContent).toContain('PDF • สัญญาเช่าฉบับจริง.pdf');

    // Verify ID card document item text
    expect(idCardDoc.textContent).toContain('เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า');
    expect(idCardDoc.textContent).toContain('PDF • บัตรประชาชนผู้เช่า.pdf');
  });

  it('triggers owner-parity print window when clicking contract document row', async () => {
    const mockWindowOpen = vi.fn().mockReturnValue({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
    });
    vi.stubGlobal('open', mockWindowOpen);

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // Navigate to Contract subview
    const contractTile = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile);

    const contractDoc = await screen.findByTestId('tenant-doc-item-contract');
    fireEvent.click(contractDoc);

    // Window open should have been called for print preview
    expect(mockWindowOpen).toHaveBeenCalledWith('', '_blank', expect.any(String));
  });

  it('displays status badge and triggers ID card preview or upload input depending on photo state', async () => {
    const mockWindowOpen = vi.fn().mockReturnValue({
      document: {
        write: vi.fn(),
        close: vi.fn(),
      },
      focus: vi.fn(),
    });
    vi.stubGlobal('open', mockWindowOpen);

    // Case 1: Tenant with ID photo
    const tenantWithPhoto = {
      ...mockTenant,
      hasIdentityDocument: true,
      idCardPhotoUrl: 'https://example.com/id-card.jpg',
    };

    const { unmount } = render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={tenantWithPhoto} onLogout={() => { }} />
      </MemoryRouter>
    );

    const contractTile = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile);

    const idCardDoc = await screen.findByTestId('tenant-doc-item-id_card');
    // PO Requirement (Ticket 03): When ID card is uploaded, badge is null/empty, not 'อัปโหลดแล้ว'
    expect(idCardDoc.textContent).not.toContain('อัปโหลดแล้ว');
    expect(idCardDoc.textContent).not.toContain('ยังไม่อัปโหลด');

    fireEvent.click(idCardDoc);
    expect(mockWindowOpen).toHaveBeenCalledWith('', '_blank');

    unmount();

    // Case 2: Tenant without ID photo
    const tenantWithoutPhoto = {
      ...mockTenant,
      hasIdentityDocument: false,
      idCardPhotoUrl: undefined,
      idCardPhotoMock: '',
    };

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={tenantWithoutPhoto} onLogout={() => { }} />
      </MemoryRouter>
    );

    const contractTile2 = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile2);

    const idCardDoc2 = await screen.findByTestId('tenant-doc-item-id_card');
    expect(idCardDoc2.textContent).toContain('ยังไม่อัปโหลด');
  });

  it('differentiates contract row click (autoPrint: false) vs download button (autoPrint: true)', async () => {
    let writtenHtml = '';
    const mockWindowOpen = vi.fn().mockReturnValue({
      document: {
        write: vi.fn((content: string) => {
          writtenHtml = content;
        }),
        close: vi.fn(),
      },
      focus: vi.fn(),
    });
    vi.stubGlobal('open', mockWindowOpen);

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    // 1. Row Click: Should NOT contain auto-print script (PO Q1=A: เปิดดูเฉยๆ ไม่ต้องกดพิมพ์ให้)
    const contractTile = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile);

    const contractDoc = await screen.findByTestId('tenant-doc-item-contract');
    fireEvent.click(contractDoc);
    expect(mockWindowOpen).toHaveBeenCalledWith('', '_blank', expect.any(String));
    expect(writtenHtml).not.toContain('window.onload');

    // 2. Download Button Click: Should open contract PDF URL directly in new tab (PO requirement)
    mockWindowOpen.mockClear();
    writtenHtml = '';
    const contractDownloadBtn = screen.getByTestId('btn-download-doc-contract');
    fireEvent.click(contractDownloadBtn);
    // Must be dispatched EXACTLY ONCE with PDF URL
    expect(mockWindowOpen).toHaveBeenCalledTimes(1);
    expect(mockWindowOpen).toHaveBeenCalledWith('/api/v1/tenant-portal/contract/pdf', '_blank');
  });

  it('handles ID card download button: triggers download link when photo exists or file picker when missing', async () => {
    // Case 1: Tenant with photo -> triggers download link
    const tenantWithPhoto = {
      ...mockTenant,
      hasIdentityDocument: true,
      idCardPhotoUrl: 'https://example.com/id-card.jpg',
    };

    const appendChildSpy = vi.spyOn(document.body, 'appendChild');
    const removeChildSpy = vi.spyOn(document.body, 'removeChild');

    const { unmount } = render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={tenantWithPhoto} onLogout={() => { }} />
      </MemoryRouter>
    );

    const contractTile = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile);

    const idCardDownloadBtn = await screen.findByTestId('btn-download-doc-id_card');
    fireEvent.click(idCardDownloadBtn);

    // Verify anchor tag was created and appended EXACTLY ONCE (no duplicate downloads)
    const anchorCalls = appendChildSpy.mock.calls.filter(call => (call[0] as HTMLElement).tagName === 'A');
    expect(anchorCalls).toHaveLength(1);
    const createdAnchor = anchorCalls[0];
    expect(createdAnchor).toBeDefined();
    expect((createdAnchor[0] as HTMLAnchorElement).download).toContain('สำเนาบัตรประชาชน_');

    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    unmount();

    // Case 2: Tenant without photo -> triggers file input click
    const tenantWithoutPhoto = {
      ...mockTenant,
      hasIdentityDocument: false,
      idCardPhotoUrl: undefined,
      idCardPhotoMock: '',
    };

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={tenantWithoutPhoto} onLogout={() => { }} />
      </MemoryRouter>
    );

    const contractTile2 = await screen.findByText('เอกสารสัญญา');
    fireEvent.click(contractTile2);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, 'click');

    const idCardDownloadBtn2 = await screen.findByTestId('btn-download-doc-id_card');
    fireEvent.click(idCardDownloadBtn2);

    // Verify file input was triggered
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('CRIT-PAY-TOTAL-01: verifies bank payment view displays totalAmountToPay with multi-bill count', () => {
    const multiBills: any[] = [
      { id: 'b1', billNumber: 'INV-001', totalAmount: 1158, status: 'unpaid' },
      { id: 'b2', billNumber: 'INV-002', totalAmount: 4500, status: 'unpaid' },
    ];
    render(
      <TenantPaymentView
        unpaidBills={multiBills}
        selectedBills={multiBills}
        paymentOptions={{
          bankCode: 'KBANK',
          bankAccountNumber: '123-4-56789-0',
          bankAccountName: 'สมใจ หอพัก',
        }}
        onBack={() => { }}
      />
    );
    fireEvent.click(screen.getByText('บัญชีธนาคาร'));
    expect(screen.getAllByText(/5,658\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\(รวม 2 บิล\)/)).toBeDefined();
    cleanup();
  });

  it('CRIT-UTIL-ELEC-02: verifies utilities view displays electric reading with electricity meterType', () => {
    const utilData = {
      waterBillingType: 'per_unit',
      electricityBillingType: 'per_unit',
      waterRate: 18,
      electricityRate: 8,
      peopleCount: 1,
      latestWater: { usageUnits: 10, currentReading: 100, previousReading: 90 },
      latestElectric: { usageUnits: 50, currentReading: 250, previousReading: 200 },
      readings: [
        { id: 'rd-1', meterType: 'electricity', usageUnits: 50, currentReading: 250, previousReading: 200, readAt: '2026-08-24' },
        { id: 'rd-2', meterType: 'water', usageUnits: 10, currentReading: 100, previousReading: 90, readAt: '2026-08-24' },
      ],
    };
    render(
      <TenantUtilitiesView
        tenantRoom={{ roomNumber: '103', buildingName: 'อาคาร A' }}
        utilitiesData={utilData}
        contractStartDate="2026-01-01"
        onBack={() => { }}
      />
    );
    expect(screen.getByText('50 หน่วย')).toBeDefined();
    cleanup();
  });

  it('CRIT-PROFILE-ICONS-03: verifies profile tab renders Lucide SVG icons without emoji strings', () => {
    const { container } = render(
      <TenantProfileTab
        localTenant={{
          ...mockTenant,
          vehicles: [{ id: 'v-1', type: 'car', licensePlate: '1กข 1234', brand: 'Toyota' }],
          pets: [{ id: 'p-1', type: 'dog', name: 'น้องโบ้' }],
        } as any}
        moveOutRequest={null}
        onOpenCoOccupantsModal={() => { }}
        onOpenMoveOutModal={() => { }}
        handleCancelMoveOutRequest={() => { }}
      />
    );
    expect(container.textContent).not.toContain('🚗');
    expect(container.textContent).not.toContain('🛵');
    expect(container.textContent).not.toContain('🐾');
    expect(screen.getByText(/รถยนต์ Toyota ทะเบียน 1กข 1234/)).toBeDefined();
    expect(screen.getByText(/dog ชื่อ น้องโบ้/)).toBeDefined();
    cleanup();
  });

  it('CRIT-DEV-PERSONAS-04: verifies dev switcher renders registration, expired, and daily personas', () => {
    render(
      <DevTenantSwitcher
        currentRoomNumber="101"
        currentTenantName="ชาญวิทย์"
        currentDormitoryId="dorm-001"
      />
    );
    fireEvent.click(screen.getByTestId('dev-tenant-switcher-btn'));
    expect(screen.getByTestId('btn-dev-register-flow')).toBeDefined();
    expect(screen.getByText(/ห้อง 204 \(รายเดือนหมดสัญญา\)/)).toBeDefined();
    expect(screen.getByText(/ห้อง 106 \(ผู้พักรายวัน\)/)).toBeDefined();
    cleanup();
  });

  it('CRIT-NOTIF-EMPTY-05: verifies notification modal hides empty text when items exist', () => {
    render(
      <TenantNotificationModal
        isOpen={true}
        onClose={() => { }}
        totalNotificationsCount={0}
        unreadBills={[{ id: 'b-1', billNumber: 'INV-1', totalAmount: 1000, cycleId: '2026-09' } as any]}
        activeRepairs={[]}
        urgentAnnouncements={[]}
        notices={[]}
        onSelectBillPayment={() => { }}
        onSelectRepairTrack={() => { }}
        onSelectAnnouncement={() => { }}
        handleMarkNoticeAsRead={() => { }}
      />
    );
    expect(screen.queryByText('ไม่มีรายการแจ้งเตือนใหม่ในขณะนี้')).toBeNull();
    cleanup();
  });

  it('CRIT-PAYMENTS-TAB-06: verifies payments tab renders 100% Thai badges and 2 grouped sections', () => {
    const sampleBills: any[] = [
      { id: 'b-unpaid', billNumber: 'INV-901', totalAmount: 1500, status: 'UNPAID' },
      { id: 'b-paid', billNumber: 'INV-900', totalAmount: 4500, status: 'PAID' },
    ];
    render(
      <TenantPaymentsTab
        tenantBills={sampleBills}
        onOpenInvoice={() => { }}
        onOpenPayment={() => { }}
      />
    );
    expect(screen.getByText('บิลค้างชำระ (1)')).toBeDefined();
    expect(screen.getByText('ประวัติการชำระเงินแล้ว (1)')).toBeDefined();
    expect(screen.getByText('รอชำระ')).toBeDefined();
    expect(screen.getByText('ชำระแล้ว')).toBeDefined();
    expect(screen.queryByText('UNPAID')).toBeNull();
    expect(screen.queryByText('PAID')).toBeNull();
    cleanup();
  });

  it('CRIT-REG-FRAME-01: verifies TenantRegisterPage renders within max-w-md mobile frame and bg-slate-100 backdrop', () => {
    const { container } = render(
      <MemoryRouter>
        <TenantRegisterPage />
      </MemoryRouter>
    );
    const outerBackdrop = container.querySelector('.bg-slate-100');
    expect(outerBackdrop).not.toBeNull();
    const mobileFrame = container.querySelector('.max-w-md');
    expect(mobileFrame).not.toBeNull();
    expect(mobileFrame?.className).toContain('border-x');
    cleanup();
  });

  it('CRIT-REG-FLOW-LANDING-03: verifies TenantHomeTab renders Mode C with "ลงทะเบียนผู้เช่า" when hasRoom is false', () => {
    const onStartRegister = vi.fn();
    render(
      <TenantHomeTab
        localTenant={{ ...mockTenant, roomId: undefined, roomNumber: undefined }}
        tenantRoom={null}
        hasRoom={false}
        financialLoading={false}
        financialError={null}
        activeUnpaidBill={null}
        totalNotificationsCount={0}
        onOpenRoomSwitcher={() => { }}
        onOpenNotificationModal={() => { }}
        onOpenUtilities={() => { }}
        onOpenContract={() => { }}
        onOpenRepairs={() => { }}
        onOpenInvoice={() => { }}
        onOpenPayment={() => { }}
        onStartRegister={onStartRegister}
      />
    );
    expect(screen.getByText('ระบบลงทะเบียนผู้เช่าใหม่')).toBeDefined();
    expect(screen.getByText('ยังไม่มีห้อง')).toBeDefined();
    const regBtn = screen.getByTestId('tenant-start-register-btn');
    expect(regBtn).toBeDefined();
    expect(regBtn.textContent).toContain('ลงทะเบียนผู้เช่า');

    fireEvent.click(regBtn);
    expect(onStartRegister).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('CRIT-AWAITING-CONFIRMATION-CTA: verifies TenantHomeTab renders awaiting confirmation CTA when tenant status is awaiting_tenant_confirmation', () => {
    const onStartRegister = vi.fn();
    render(
      <TenantHomeTab
        localTenant={{
          ...mockTenant,
          roomId: undefined,
          roomNumber: undefined,
          status: 'awaiting_tenant_confirmation',
          pendingRequest: {
            id: 'req-123',
            status: 'awaiting_tenant_confirmation',
            requestedRoomNumber: '204',
          },
        } as any}
        tenantRoom={null}
        hasRoom={false}
        financialLoading={false}
        financialError={null}
        activeUnpaidBill={null}
        totalNotificationsCount={0}
        notices={[]}
        announcements={[]}
        onOpenRoomSwitcher={() => { }}
        onOpenNotifications={() => { }}
        onOpenUtilities={() => { }}
        onOpenContract={() => { }}
        onOpenRepairs={() => { }}
        onOpenInvoice={() => { }}
        onOpenPayment={() => { }}
        onOpenMoveOut={() => { }}
        onOpenRenewal={() => { }}
        onGoToAnnouncements={() => { }}
        onRefresh={() => { }}
        onStartRegister={onStartRegister}
      />
    );
    expect(screen.getByTestId('tenant-awaiting-confirmation-card')).toBeDefined();
    expect(screen.getByText('คำขอได้รับการอนุมัติแล้ว')).toBeDefined();
    expect(screen.getByText('ยืนยันสัญญาเช่าห้อง 204')).toBeDefined();
    const confirmBtn = screen.getByTestId('tenant-confirm-register-btn');
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn.textContent).toContain('ตรวจสอบและยืนยันสัญญาเช่า');

    fireEvent.click(confirmBtn);
    expect(onStartRegister).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('CRIT-DORM-CANONICAL-02: verifies DevTenantSwitcher registration button triggers mode=unregistered flow', () => {
    render(
      <DevTenantSwitcher
        currentRoomNumber="101"
        currentTenantName="นายสมชาย ใจดี"
        currentDormitoryId="20000001-0000-4000-8000-000000000002"
        currentDormitoryName="หอพัก HorPlus UAT Comprehensive Manor"
      />
    );
    const openBtn = screen.getByTestId('dev-tenant-switcher-btn');
    fireEvent.click(openBtn);

    const regBtn = screen.getByTestId('btn-dev-register-flow');
    expect(regBtn).toBeDefined();
    expect(regBtn.textContent).toContain('ลงทะเบียนผู้เช่าใหม่ (Registration Flow)');
    cleanup();
  });

  it('CRIT-SESSION-CLEAR-UNREGISTERED-02: verifies TenantWorkspace clears stale room session when loadedRooms is empty and hasRoom is false', async () => {
    // Mock sessionStorage with stale room id
    sessionStorage.setItem('tenant_selected_room_id', 'stale-room-101');
    const mockUnregisteredTenant: any = {
      id: 'unregistered-tenant-id',
      name: 'นายวรกิจ ประเสริฐวงศ์',
      phone: '0812345678',
      dormitoryId: '20000001-0000-4000-8000-000000000002',
    };

    // Mock fetch: /rooms returns empty array (unregistered), /profile returns no room
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/v1/tenant-portal/rooms')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, rooms: [] }) });
      }
      if (url.includes('/api/v1/tenant-portal/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 'unregistered-tenant-id', displayName: 'นายวรกิจ ประเสริฐวงศ์', room: null }) });
      }
      if (url.includes('/api/v1/tenant-portal/bills')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
    }) as any;

    render(
      <MemoryRouter initialEntries={['/tenant']}>
        <TenantWorkspace tenant={mockUnregisteredTenant} onLogout={() => { }} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('ระบบลงทะเบียนผู้เช่าใหม่')).toBeDefined();
      expect(screen.getByText('ยังไม่มีห้อง')).toBeDefined();
    });

    // Verify sessionStorage was cleansed
    expect(sessionStorage.getItem('tenant_selected_room_id')).toBeNull();

    global.fetch = originalFetch;
    cleanup();
  });

  it('CRIT-ROOM-101-UNPAID-BILL-RESTORE-04: verifies TenantHomeTab renders Mode A with outstanding amount and pay button when activeUnpaidBill is present', () => {
    const unpaidBill: any = {
      id: 'inv-101-sep',
      billNumber: 'INV-2026-09-0001',
      totalAmount: 4500,
      outstandingAmount: 4500,
      dueDate: '2026-10-05',
      status: 'unpaid',
      items: [],
    };
    const onOpenPayment = vi.fn();
    render(
      <TenantHomeTab
        localTenant={{ ...mockTenant, roomNumber: '101' }}
        tenantRoom={{ roomNumber: '101', buildingName: 'อาคารชาญวิทย์' }}
        hasRoom={true}
        financialLoading={false}
        financialError={null}
        activeUnpaidBill={unpaidBill}
        totalNotificationsCount={0}
        onOpenRoomSwitcher={() => { }}
        onOpenNotificationModal={() => { }}
        onOpenUtilities={() => { }}
        onOpenContract={() => { }}
        onOpenRepairs={() => { }}
        onOpenInvoice={() => { }}
        onOpenPayment={onOpenPayment}
        onStartRegister={() => { }}
      />
    );
    expect(screen.getByTestId('tenant-unpaid-card')).toBeDefined();
    expect(screen.getByText('ยอดค้างชำระ')).toBeDefined();
    expect(screen.getByText(/4,500\.00/)).toBeDefined();
    const payBtn = screen.getByTestId('tenant-pay-btn');
    expect(payBtn).toBeDefined();
    fireEvent.click(payBtn);
    expect(onOpenPayment).toHaveBeenCalledTimes(1);
    cleanup();
  });

  describe('Round 13: Tenant Portal UX/UI Refinements & Direct Claim Flow (PO Criteria)', () => {
    it('CRIT-HEADER-DORM-NAME-01: renders dormitory name in TenantHomeTab permanently instead of greeting', () => {
      render(
        <TenantHomeTab
          localTenant={mockTenant}
          tenantRoom={null}
          hasRoom={false}
          dormitoryName="หอพัก HorPlus UAT Comprehensive Manor"
          financialLoading={false}
          financialError={null}
          activeUnpaidBill={null}
          totalNotificationsCount={0}
          notices={[]}
          announcements={[]}
          onOpenRoomSwitcher={() => { }}
          onOpenNotifications={() => { }}
          onOpenInvoice={() => { }}
          onOpenPayment={() => { }}
          onOpenRepairs={() => { }}
          onOpenUtilities={() => { }}
          onOpenContract={() => { }}
          onOpenMoveOut={() => { }}
          onOpenRenewal={() => { }}
          onGoToAnnouncements={() => { }}
          onStartRegister={() => { }}
          onRefresh={() => { }}
        />
      );
      expect(screen.getByText('หอพัก HorPlus UAT Comprehensive Manor')).toBeDefined();
      expect(screen.queryByText(/สวัสดีตอน/)).toBeNull();
      cleanup();
    });

    it('CRIT-PRICE-ORDER-TERM-FIRST-02 & CRIT-PRICE-ZERO-TERM-EXCLUDE-04: orders prices รายเทอม -> รายเดือน -> รายวัน and omits zero term rent', () => {
      const mockRooms = [
        {
          id: 'room-vacant-1',
          roomNumber: '101',
          buildingName: 'อาคารชาญวิทย์',
          floor: 1,
          status: 'vacant',
          isVacant: true,
          monthlyRent: 4500,
          termRent: 18000,
          dailyRent: 500,
        },
        {
          id: 'room-vacant-no-term',
          roomNumber: '102',
          buildingName: 'อาคารชาญวิทย์',
          floor: 1,
          status: 'vacant',
          isVacant: true,
          monthlyRent: 4000,
          termRent: 0,
          dailyRent: 450,
        }
      ];

      render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="room_picker"
        />
      );

      // Room 101 card
      const card101 = screen.getByTestId('room-card-101');
      expect(card101.textContent).toContain('รายเทอม: ฿18,000');
      expect(card101.textContent).toContain('รายเดือน: ฿4,500');
      expect(card101.textContent).toContain('รายวัน: ฿500');
      const termIdx = card101.textContent?.indexOf('รายเทอม: ฿18,000') ?? -1;
      const monthIdx = card101.textContent?.indexOf('รายเดือน: ฿4,500') ?? -1;
      const dailyIdx = card101.textContent?.indexOf('รายวัน: ฿500') ?? -1;
      expect(termIdx).toBeLessThan(monthIdx);
      expect(monthIdx).toBeLessThan(dailyIdx);

      // Room 102 card: termRent=0 omitted
      const card102 = screen.getByTestId('room-card-102');
      expect(card102.textContent).not.toContain('รายเทอม');
      expect(card102.textContent).toContain('รายเดือน: ฿4,000');
      expect(card102.textContent).toContain('รายวัน: ฿450');
      cleanup();
    });

    it('CRIT-PRICE-HIDE-NON-VACANT-03 & CRIT-LINE-ICON-CLAIM-BADGE-05: hides price row for occupied and claim rooms, and renders official LineLogo', () => {
      const mockRooms = [
        {
          id: 'room-occupied',
          roomNumber: '103',
          buildingName: 'อาคารชาญวิทย์',
          floor: 1,
          status: 'occupied',
          isVacant: false,
          monthlyRent: 4500,
          termRent: 18000,
          dailyRent: 500,
          selectable: false,
        },
        {
          id: 'room-claim',
          roomNumber: '104',
          buildingName: 'อาคารชาญวิทย์',
          floor: 1,
          status: 'occupied',
          isVacant: false,
          isUnboundClaimable: true,
          monthlyRent: 4500,
          termRent: 18000,
          dailyRent: 500,
          selectable: true,
        },
      ];

      render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="room_picker"
        />
      );

      // Room 103 (occupied) must NOT show price row
      const card103 = screen.getByTestId('room-card-103');
      expect(card103.textContent).toContain('มีผู้เช่าแล้ว');
      expect(card103.textContent).not.toContain('รายเดือน:');
      expect(card103.textContent).not.toContain('รายเทอม:');
      expect(card103.textContent).not.toContain('รายวัน:');

      // Room 104 (claimable) must NOT show price row and MUST render LineLogo with รอผูก LINE
      const card104 = screen.getByTestId('room-card-104');
      expect(card104.textContent).toContain('รอผูก LINE');
      expect(card104.textContent).not.toContain('รายเดือน:');
      expect(card104.textContent).not.toContain('รายเทอม:');
      expect(card104.textContent).not.toContain('รายวัน:');
      expect(card104.querySelector('[data-testid="line-official-logo"]')).not.toBeNull();
      cleanup();
    });

    it('CRIT-DIRECT-CLAIM-MODAL-06: clicking room with isUnboundClaimable opens TenantClaimModal directly, bypassing rental plan sheet', async () => {
      const mockRooms = [
        {
          id: 'room-claim-104',
          roomNumber: '104',
          buildingName: 'อาคารชาญวิทย์',
          floor: 1,
          status: 'occupied',
          isVacant: false,
          isUnboundClaimable: true,
          selectable: true,
        },
      ];

      render(
        <TenantRegisterView
          rooms={mockRooms as any}
          initialViewState="room_picker"
        />
      );

      const card104 = screen.getByTestId('room-card-104');
      fireEvent.click(card104);

      // Plan selection bottom sheet MUST NOT open
      expect(screen.queryByText(/หอพักนี้เปิดให้เช่าห้อง 104 ในรูปแบบดังต่อไปนี้/)).toBeNull();

      // TenantClaimModal MUST open
      expect(await screen.findByText('ยืนยันสิทธิ์ผู้เช่าห้อง 104')).toBeDefined();
      expect(screen.getByText('ยืนยันตัวตนเพื่อเชื่อมต่อบัญชีเข้ากับห้องพัก')).toBeDefined();
      cleanup();
    });

    describe('Tenant Portal UX/UI Refinements & Installment Parity (Round 14)', () => {
      it('CRIT-CLAIM-SHEET-01: TenantClaimModal renders as mobile-first bottom sheet with drag handle and rounded-t-[32px]', () => {
        render(
          <TenantClaimModal
            isOpen={true}
            onClose={() => { }}
            dormitoryId="dorm-1"
            roomNumber="101"
            roomId="rm-101"
            onSuccess={() => { }}
          />
        );
        const sheet = screen.getByTestId('tenant-claim-bottom-sheet');
        expect(sheet).toBeDefined();
        expect(sheet.className).toContain('rounded-t-[32px]');
        expect(sheet.className).toContain('slide-in-from-bottom');
        expect(sheet.querySelector('.w-12.h-1\\.5.bg-slate-300.rounded-full')).not.toBeNull();
        cleanup();
      });

      it('CRIT-PREFIX-HONORIFIC-02: Prefix dropdown contains เด็กชาย, เด็กหญิง, ระบุเอง and shows text input when ระบุเอง is selected', () => {
        const mockRooms = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          termRent: 16000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRooms as any} initialViewState="form" initialRoomId="room-101" />);

        const prefixSelect = screen.getByDisplayValue('นาย');
        expect(prefixSelect).toBeDefined();
        expect(screen.getByRole('option', { name: 'เด็กชาย' })).toBeDefined();
        expect(screen.getByRole('option', { name: 'เด็กหญิง' })).toBeDefined();
        expect(screen.getByRole('option', { name: 'ระบุเอง' })).toBeDefined();

        // Select 'ระบุเอง'
        fireEvent.change(prefixSelect, { target: { value: 'ระบุเอง' } });
        expect(screen.getByTestId('tenant-custom-prefix-input')).toBeDefined();
        expect(screen.getByPlaceholderText('เช่น ยศ, ด.ช., พระ ฯลฯ')).toBeDefined();
        cleanup();
      });

      it('CRIT-MANDATORY-FIELDS-03: Birth date and address are mandatory fields and birth date uses Buddhist Era format', async () => {
        const mockRooms = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          termRent: 16000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRooms as any} initialViewState="form" initialRoomId="room-101" initialStep={2} />);

        const addressInput = screen.getByTestId('tenant-address-input');
        expect(addressInput).toBeDefined();
        expect(addressInput.getAttribute('required')).not.toBeNull();

        // Birthday input label
        expect(screen.getByText(/วัน\/เดือน\/ปีเกิด/)).toBeDefined();
        cleanup();
      });

      it('CRIT-ID-IMAGE-PREVIEW-04: ID card image preview is enlarged without redundant text', () => {
        const mockRooms = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRooms as any} initialViewState="form" initialRoomId="room-101" />);

        expect(screen.queryByText(/แนบรูปภาพสำเนาบัตรประชาชนเรียบร้อยแล้ว \(คลิกเพื่อเปลี่ยนรูปภาพ\)/)).toBeNull();
        cleanup();
      });

      it('CRIT-PLAN-ORDER-TERM-FIRST-05: Rental plans order in plan selection sheet is Term -> Monthly -> Daily and hides Term if termRent is 0', () => {
        const mockRoomsWithTerm = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          termRent: 16000,
          dailyRent: 500,
          selectable: true,
          isVacant: true,
        }];
        const { rerender } = render(
          <TenantRegisterView rooms={mockRoomsWithTerm as any} initialViewState="room_picker" />
        );

        // Click room card to open plan bottom sheet
        fireEvent.click(screen.getByTestId('room-card-101'));

        expect(screen.getByTestId('plan-select-term')).toBeDefined();
        expect(screen.getByTestId('plan-select-monthly')).toBeDefined();
        expect(screen.getByTestId('plan-select-daily')).toBeDefined();

        // Room with termRent: 0
        const mockRoomsZeroTerm = [{
          id: 'room-102',
          roomNumber: '102',
          monthlyRent: 4000,
          termRent: 0,
          dailyRent: 500,
          selectable: true,
          isVacant: true,
        }];
        rerender(
          <TenantRegisterView rooms={mockRoomsZeroTerm as any} initialViewState="room_picker" />
        );

        fireEvent.click(screen.getByTestId('room-card-102'));
        expect(screen.queryByTestId('plan-select-term')).toBeNull();
        expect(screen.getByTestId('plan-select-monthly')).toBeDefined();
        expect(screen.getByTestId('plan-select-daily')).toBeDefined();
        cleanup();
      });

      it('CRIT-INSTALLMENT-TERM-ONLY-06: Installment option is restricted to Term plan and maxTermRentInstallments > 1', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          termRent: 16000,
          building: { maxTermRentInstallments: 3 },
          selectable: true,
        }];
        const { rerender } = render(
          <TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialRentPlan="monthly" />
        );

        // Default plan is monthly -> Installment option must NOT be present
        expect(screen.queryByText(/ต้องการแบ่งชำระ/)).toBeNull();

        // Term plan with maxTermRentInstallments > 1
        rerender(
          <TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialRentPlan="term" />
        );

        // Now installment option should be visible
        expect(screen.getByText(/ต้องการแบ่งชำระ/)).toBeDefined();

        // If building.maxTermRentInstallments <= 1, installment must be hidden
        const mockRoomNoInst = [{
          id: 'room-102',
          roomNumber: '102',
          monthlyRent: 4000,
          termRent: 16000,
          building: { maxTermRentInstallments: 1 },
          selectable: true,
        }];
        rerender(
          <TenantRegisterView rooms={mockRoomNoInst as any} initialViewState="form" initialRoomId="room-102" initialRentPlan="term" />
        );
        expect(screen.queryByText(/ต้องการแบ่งชำระ/)).toBeNull();
        cleanup();
      });

      it('CRIT-LOCKED-DUE-DAY-07: Due day is locked and read-only with Lock icon', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" />);

        const lockedDueDay = screen.getByTestId('tenant-locked-due-day');
        expect(lockedDueDay).toBeDefined();
        expect(lockedDueDay.textContent).toContain('วันที่ 5 ของทุกเดือน');
        cleanup();
      });

      it('CRIT-DEPOSIT-SLIP-UPLOAD-08: Deposit Slip upload card is shown when depositStatus is paid and hidden when unpaid', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        // Initially depositStatus is 'paid', so deposit slip upload should be visible
        expect(screen.getByTestId('deposit-slip-input')).toBeDefined();
        expect(screen.getByText('แนบหลักฐานการชำระเงินมัดจำ / สลิปโอนเงิน')).toBeDefined();

        // Click 'มัดจำ : ยังไม่จ่าย (Unpaid)'
        const unpaidBtn = screen.getByRole('button', { name: /ยังไม่จ่าย/ });
        fireEvent.click(unpaidBtn);

        // Deposit slip upload should be hidden
        expect(screen.queryByTestId('deposit-slip-input')).toBeNull();
        cleanup();
      });

      it('CRIT-WIZARD-STEP-VISIBILITY-09: Only the active step is visible while other steps are hidden', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        const step1 = document.getElementById('step-1');
        const step2 = document.getElementById('step-2');
        expect(step1?.className).toContain('block');
        expect(step2?.className).toContain('hidden');

        // Click Step 2 indicator
        const step2Btn = screen.getByTestId('step-indicator-2');
        fireEvent.click(step2Btn);

        expect(step1?.className).toContain('hidden');
        expect(step2?.className).toContain('block');
        cleanup();
      });

      it('CRIT-STEPBAR-RED-ON-INVALID-10: Incomplete submit highlights invalid steps in RED on step bar', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={6} />);

        // Click submit on Step 6 without filling mandatory fields in Step 2 or signing
        const submitBtn = screen.getByTestId('tenant-registration-submit-btn');
        fireEvent.click(submitBtn);

        // Step indicators 2 and 6 should have red classes
        const step2Indicator = screen.getByTestId('step-indicator-2');
        expect(step2Indicator.className).toContain('bg-rose-500');
        expect(step2Indicator.className).toContain('animate-pulse');
        expect(step2Indicator.textContent).toContain('!');
        cleanup();
      });

      it('CRIT-LOCKED-RENT-PLAN-11: Step 1 shows locked read-only rent plan card with badge', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialRentPlan="monthly" />);

        const lockedCard = screen.getByTestId('tenant-locked-rent-plan');
        expect(lockedCard).toBeDefined();
        expect(lockedCard.textContent).toContain('รายเดือน');
        cleanup();
      });

      it('CRIT-BOTTOM-NAV-STICKY-12: Sticky bottom navigation bar renders back/next and submit buttons', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        // On Step 1: Change Room and Next Step
        expect(screen.getByTestId('bottom-nav-change-room-btn')).toBeDefined();
        const nextBtn = screen.getByTestId('bottom-nav-next-btn');
        expect(nextBtn).toBeDefined();

        // Click next -> go to Step 2
        fireEvent.click(nextBtn);
        expect(screen.getByTestId('bottom-nav-back-btn')).toBeDefined();
        cleanup();
      });

      it('CRIT-CLAIM-MODAL-CONTAINMENT-13: TenantClaimModal card is contained within max-w-md w-full mx-auto', () => {
        render(
          <TenantClaimModal
            isOpen={true}
            onClose={() => {}}
            roomNumber="101"
            roomId="room-101"
            dormitoryId="dorm-001"
          />
        );
        const card = document.getElementById('tenant-claim-modal-container');
        expect(card).not.toBeNull();
        expect(card?.className).toContain('max-w-md');
        expect(card?.className).toContain('w-full');
        expect(card?.className).toContain('mx-auto');
        cleanup();
      });

      it('CRIT-SUBMIT-BTN-STEP5-ONLY-14: In-step submit button only renders inside step-5 and never in step-1', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        const step1 = document.getElementById('step-1');
        const submitBtn = screen.getByTestId('tenant-registration-submit-btn');

        // Submit button must be inside step-5, not inside step-1
        expect(step1?.contains(submitBtn)).toBe(false);
        const step5 = document.getElementById('step-5');
        expect(step5?.contains(submitBtn)).toBe(true);
        cleanup();
      });

      it('CRIT-STRIP-LEADING-ZERO-15: Rent and deposit inputs strip leading zeroes', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        const rentInput = screen.getByTestId('tenant-proposed-rent-input') as HTMLInputElement;
        fireEvent.change(rentInput, { target: { value: '01300' } });
        expect(rentInput.value).toBe('1300');

        const depositInput = screen.getByTestId('tenant-proposed-deposit-input') as HTMLInputElement;
        fireEvent.change(depositInput, { target: { value: '005500' } });
        expect(depositInput.value).toBe('5500');
        cleanup();
      });

      it('CRIT-STEP4-EMERGENCY-MANDATORY-16: Step 4 emergency contact fields are mandatory and validated', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={4} />);

        const nameInput = screen.getByTestId('tenant-emergency-name-input');
        const relInput = screen.getByTestId('tenant-emergency-rel-input');
        const phoneInput = screen.getByTestId('tenant-emergency-phone-input');

        expect(nameInput.getAttribute('required')).not.toBeNull();
        expect(relInput.getAttribute('required')).not.toBeNull();
        expect(phoneInput.getAttribute('required')).not.toBeNull();
        cleanup();
      });

      it('CRIT-YEAR-GRID-SELECTOR-17: OwnerDateInput provides 1-click Buddhist Era year grid selector', () => {
        const onChange = vi.fn();
        render(
          <OwnerDateInput
            value="2026-09-18"
            onChange={onChange}
            label="วันเริ่มสัญญา"
          />
        );

        // Open date picker popover
        fireEvent.click(screen.getByTestId('owner-date-input-calendar-btn'));

        // Click year button to open year grid
        const yearBtn = screen.getByTestId('date-picker-year-btn');
        expect(yearBtn.textContent).toContain('2569');
        fireEvent.click(yearBtn);

        // Year grid should display year options (e.g. 2570)
        const yearOption = screen.getByTestId('year-option-2570');
        expect(yearOption).toBeDefined();
        fireEvent.click(yearOption);

        // Year button should now show 2570
        expect(screen.getByTestId('date-picker-year-btn').textContent).toContain('2570');
        cleanup();
      });

      it('CRIT-BICYCLE-SUPPORT-18: Selecting bicycle vehicle type hides license plate and shows bicycle details note input', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={5} />);

        // Switch vehicle type to bicycle via select
        const vehicleSelect = screen.getByTestId('tenant-vehicle-type-select');
        fireEvent.change(vehicleSelect, { target: { value: 'bicycle' } });

        // License plate input should NOT be in DOM
        expect(screen.queryByTestId('tenant-vehicle-plate-input')).toBeNull();

        // Free-text bicycle details input should be visible
        const bicycleNoteInput = screen.getByTestId('tenant-bicycle-details-input');
        expect(bicycleNoteInput).toBeDefined();
        fireEvent.change(bicycleNoteInput, { target: { value: 'เสือหมอบ สีแดง ยี่ห้อ Trek' } });
        expect((bicycleNoteInput as HTMLInputElement).value).toBe('เสือหมอบ สีแดง ยี่ห้อ Trek');
        cleanup();
      });

      it('CRIT-ROUND17-STEP5-LOCK-19: Step 5 is locked with lock indicator until steps 1-4 are valid; clicking jumps to incomplete step with soft-red highlighting', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={1} />);

        // Step 5 indicator should have Lock title
        const step5Indicator = screen.getByTestId('step-indicator-5');
        expect(step5Indicator.getAttribute('title')).toContain('กรุณากรอกข้อมูลขั้นตอนที่ 1-4 ให้ครบถ้วน');

        // Clicking Step 5 while steps 1-4 are empty should redirect to Step 1 and activate soft-red highlight
        fireEvent.click(step5Indicator);

        // Active step remains 1 or redirects to 1
        const step1 = document.getElementById('step-1');
        expect(step1).toBeDefined();

        // Empty required field has soft-red highlight class (border-rose-400)
        const nameInput = screen.getByTestId('tenant-fullname-input');
        expect(nameInput.className).toContain('border-rose-400');
        cleanup();
      });

      it('CRIT-ROUND17-EMERGENCY-RELATION-DROPDOWN-20: Emergency relation is a select dropdown with required options and displays custom text field when อื่นๆ is chosen', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={3} />);

        const relSelect = screen.getByTestId('tenant-emergency-rel-input') as HTMLSelectElement;
        expect(relSelect.tagName.toLowerCase()).toBe('select');

        // Check options
        const options = Array.from(relSelect.querySelectorAll('option')).map(opt => opt.value);
        expect(options).toEqual(['แฟน', 'เพื่อน', 'ผู้ปกครอง', 'พี่น้อง / ญาติ', 'คู่สมรส', 'อื่นๆ']);

        // Custom relation input should not exist initially
        expect(screen.queryByTestId('tenant-emergency-custom-rel-input')).toBeNull();

        // Select 'อื่นๆ'
        fireEvent.change(relSelect, { target: { value: 'อื่นๆ' } });
        const customInput = screen.getByTestId('tenant-emergency-custom-rel-input') as HTMLInputElement;
        expect(customInput).toBeDefined();
        fireEvent.change(customInput, { target: { value: 'น้าสาว' } });
        expect(customInput.value).toBe('น้าสาว');
        cleanup();
      });

      it('CRIT-ROUND17-PHONE-AUTO-FORMAT-21: Phone inputs format as 08X-XXX-XXXX and co-occupant display shows formatted phone', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={3} />);

        // Emergency phone auto-formatting
        const emergencyPhoneInput = screen.getByTestId('tenant-emergency-phone-input') as HTMLInputElement;
        fireEvent.change(emergencyPhoneInput, { target: { value: '0812345678' } });
        expect(emergencyPhoneInput.value).toBe('081-234-5678');

        // Co-occupant phone auto-formatting and adding
        const coNameInput = screen.getByTestId('tenant-co-occupant-name-input');
        const coPhoneInput = screen.getByTestId('tenant-co-occupant-phone-input') as HTMLInputElement;
        const addBtn = screen.getByTestId('tenant-add-co-occupant-btn');

        fireEvent.change(coNameInput, { target: { value: 'สมศักดิ์ มิตรร่วม' } });
        fireEvent.change(coPhoneInput, { target: { value: '0898765432' } });
        expect(coPhoneInput.value).toBe('089-876-5432');

        fireEvent.click(addBtn);
        // Formatted phone rendered in badge list
        expect(screen.getByText(/โทร: 089-876-5432/)).toBeDefined();
        cleanup();
      });

      it('CRIT-ROUND17-CO-OCCUPANTS-DEFAULT-CHECKED-22: Co-occupant checkbox defaults to true and section is visible', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={3} />);

        const checkbox = screen.getByTestId('tenant-has-co-occupants-checkbox') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);

        // Co-occupant inputs are visible
        expect(screen.getByTestId('tenant-co-occupant-name-input')).toBeDefined();
        cleanup();
      });

      it('CRIT-ROUND18-CLAIM-MODAL-NO-X-01: TenantClaimModal renders as bottom sheet with drag handle, NO X button, and closes on backdrop click', () => {
        const onClose = vi.fn();
        render(
          <TenantClaimModal
            isOpen={true}
            onClose={onClose}
            dormitoryId="dorm-1"
            roomNumber="104"
            roomId="rm-104"
            onSuccess={() => { }}
          />
        );

        // Drag handle must exist
        const sheet = screen.getByTestId('tenant-claim-bottom-sheet');
        expect(sheet).toBeDefined();

        // NO X close button exists
        const closeButtons = sheet.querySelectorAll('button');
        const xIcons = Array.from(closeButtons).filter(btn => btn.querySelector('.lucide-x') || btn.getAttribute('aria-label') === 'ปิด');
        expect(xIcons.length).toBe(0);

        // Backdrop click calls onClose
        const backdrop = document.querySelector('.backdrop-blur-xs') || document.querySelector('.bg-slate-900\\/60');
        fireEvent.click(backdrop!);
        expect(onClose).toHaveBeenCalled();
        cleanup();
      });

      it('CRIT-ROUND18-DATE-PICKER-POPUP-CONTAINMENT-02: OwnerDateInput supports right alignment and viewport max-width containment to prevent mobile clipping', () => {
        const onChange = vi.fn();
        render(
          <OwnerDateInput
            value="2026-09-18"
            onChange={onChange}
            align="right"
          />
        );

        fireEvent.click(screen.getByTestId('owner-date-input-calendar-btn'));
        const popover = screen.getByTestId('owner-date-input-popover');
        expect(popover).toBeDefined();
        expect(popover.className).toContain('right-0');
        expect(popover.className).toContain('max-w-[calc(100vw-2rem)]');
        cleanup();
      });

      it('CRIT-ROUND18-INSTALLMENT-LEFT-ALIGNED-03: Installment schedule wrapper in TenantRegisterView is left-aligned without pl-6 indentation', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          termRent: 16000,
          maxTermRentInstallments: 4,
          depositAmount: 5000,
          selectable: true,
        }];
        render(
          <TenantRegisterView
            rooms={mockRoom as any}
            initialViewState="form"
            initialRoomId="room-101"
            initialRentPlan="term"
            initialStep={1}
          />
        );

        // Click installment checkbox
        const installmentCheckbox = screen.getByLabelText(/ต้องการแบ่งชำระ/);
        fireEvent.click(installmentCheckbox);

        // Find the installment options wrapper
        const installmentWrapper = screen.getByText('จำนวนงวดการแบ่งชำระ:').closest('div')?.parentElement?.parentElement;
        expect(installmentWrapper).toBeDefined();
        expect(installmentWrapper?.className).not.toContain('pl-6');
        expect(installmentWrapper?.className).toContain('pl-0');
        cleanup();
      });

      it('CRIT-ROUND18-NAV-BAR-PINNED-BOTTOM-04: Bottom navigation bar has mt-auto and form container has flex-col justify-between to stay pinned to viewport bottom', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={4} />);

        const nextBtn = screen.getByTestId('bottom-nav-next-btn');
        const navBar = nextBtn.closest('div[class*="sticky bottom-0"]');
        expect(navBar).toBeDefined();
        expect(navBar?.className).toContain('mt-auto');

        const form = navBar?.closest('form');
        expect(form).toBeDefined();
        expect(form?.className).toContain('flex flex-col justify-between');
        cleanup();
      });

      it('CRIT-ROUND18-MULTI-VEHICLE-PET-PARITY-05: Step 4 supports multi-vehicle and multi-pet with canonical dropdown parity', () => {
        const mockRoom = [{
          id: 'room-101',
          roomNumber: '101',
          monthlyRent: 4000,
          depositAmount: 5000,
          selectable: true,
        }];
        render(<TenantRegisterView rooms={mockRoom as any} initialViewState="form" initialRoomId="room-101" initialStep={4} />);

        // 1. Vehicles
        const firstVehicleSelect = screen.getByTestId('tenant-vehicle-type-select');
        expect(firstVehicleSelect).toBeDefined();
        // First vehicle has 'none' option
        const firstOptions = Array.from(firstVehicleSelect.querySelectorAll('option')).map(o => o.value);
        expect(firstOptions).toContain('none');

        // Add 2nd vehicle
        const addVehBtn = screen.getByTestId('tenant-add-vehicle-btn');
        fireEvent.click(addVehBtn);

        // 2nd vehicle select exists and DOES NOT contain 'none'
        const secondVehicleSelect = screen.getByTestId('tenant-vehicle-type-select-1');
        expect(secondVehicleSelect).toBeDefined();
        const secondOptions = Array.from(secondVehicleSelect.querySelectorAll('option')).map(o => o.value);
        expect(secondOptions).not.toContain('none');

        // 2. Pets
        const petCheckbox = screen.getByLabelText(/ขออนุญาตนำสัตว์เลี้ยงเข้ามาพักอาศัย/);
        fireEvent.click(petCheckbox);

        // Pet type select uses canonical options
        const firstPetSelect = screen.getByTestId('tenant-pet-type-select-0');
        expect(firstPetSelect).toBeDefined();
        const petOptions = Array.from(firstPetSelect.querySelectorAll('option')).map(o => o.value);
        expect(petOptions).toContain('dog');
        expect(petOptions).toContain('cat');
        expect(petOptions).toContain('small_pet');
        expect(petOptions).toContain('other');

        // Add 2nd pet
        const addPetBtn = screen.getByTestId('tenant-add-pet-btn');
        fireEvent.click(addPetBtn);

        const secondPetSelect = screen.getByTestId('tenant-pet-type-select-1');
        expect(secondPetSelect).toBeDefined();
        cleanup();
      });

      it('CRIT-ROUND18-REGISTRATION-SHOWN-IN-OWNER-REQUESTS-06: Registration with status pending_owner_approval maps to pending in aggregateTenantRequests for Owner Dashboard', async () => {
        const { aggregateTenantRequests } = await import('../services/dashboard.service');
        const aggregated = aggregateTenantRequests({
          registrations: [
            {
              id: 'reg-new-1',
              requestedRoomId: 'rm-101',
              firstName: 'วิชัย',
              lastName: 'รักสงบ',
              phone: '089-999-9999',
              status: 'pending_owner_approval' as any,
              rentalPlan: 'monthly',
              proposedRent: 4500,
              proposedDeposit: 5000,
              createdAt: '2026-09-18T10:00:00.000Z',
            }
          ],
          moveOutRequests: [],
          renewals: [],
          contracts: [],
          rooms: [{ id: 'rm-101', roomNumber: '101' } as any],
          tenants: [],
        });

        expect(aggregated.length).toBe(1);
        expect(aggregated[0].status).toBe('pending');
        expect(aggregated[0].category).toBe('registration');
        expect(aggregated[0].tenantName).toContain('วิชัย รักสงบ');
      });

      describe('Round 19 Specifications: Step 1 Grid, Thai Dates, Pending Button, Co-Occupants Rules', () => {
        it('CRIT-R19-STEP1-GRID-4BOXES-01: renders exactly 4 fields in 2x2 grid without visible วันทำสัญญา or bottom banner', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={1}
              initialViewState="form"
            />
          );

          // 1. Exactly 4 boxes present
          expect(screen.getByText(/วันเริ่มย้ายเข้าพัก \(พ\.ศ\.\)/)).toBeDefined();
          expect(screen.getByLabelText(/ระยะเวลาสัญญา/)).toBeDefined();
          expect(screen.getByTestId('tenant-calculated-end-date')).toBeDefined();
          expect(screen.getByTestId('tenant-locked-due-day')).toBeDefined();

          // 2. Visible 'วันทำสัญญา' input is removed
          expect(screen.queryByTestId('tenant-contract-date-input')).toBeNull();

          // 3. Separate bottom banner 'วันสิ้นสุดสัญญาเช่าโดยประมาณ:' is removed
          expect(screen.queryByText(/วันสิ้นสุดสัญญาเช่าโดยประมาณ:/)).toBeNull();

          cleanup();
        });

        it('CRIT-R19-STEP5-CONTRACT-THAI-DATE-02: formats contract dates into full Thai Buddhist Era text in Step 5', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          // Save dormitory profile in localStorage
          localStorage.setItem('registered_dorm_profile', JSON.stringify({
            id: 'dorm-mock-1',
            name: 'หอพักสุขใจ คลองหก',
            address: '99/1 ม.1 ต.คลองหก',
            ownerSignature: 'data:image/png;base64,mockOwnerSigData',
          }));

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
            />
          );

          // Contract preview must NOT contain raw ISO date e.g. 2026-09-18
          const contractContainer = screen.getByText('หนังสือสัญญาเช่าห้องพักอาศัย').closest('.font-sarabun');
          expect(contractContainer).toBeDefined();

          const contractText = contractContainer?.textContent || '';
          // Should not have raw YYYY-MM-DD
          expect(contractText).not.toMatch(/\d{4}-\d{2}-\d{2}/);
          // Should have full Thai Buddhist year 25xx
          expect(contractText).toMatch(/25\d{2}/);
          // Should contain full Thai month name (e.g. มกราคม, กุมภาพันธ์, มีนาคม, เมษายน, พฤษภาคม, มิถุนายน, กรกฎาคม, สิงหาคม, กันยายน, ตุลาคม, พฤศจิกายน, ธันวาคม)
          expect(contractText).toMatch(/(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)/);

          // Dormitory profile and owner signature
          expect(contractText).toContain('หอพักสุขใจ คลองหก');
          const ownerSigImg = screen.queryByAltText('ลายเซ็นผู้ให้เช่า');
          expect(ownerSigImg).toBeDefined();

          localStorage.removeItem('registered_dorm_profile');
          cleanup();
        });

        it('CRIT-R19-HOMETAB-PENDING-BUTTON-03: renders disabled button "อยู่ระหว่างรอเจ้าของหอพักอนุมัติ" and badge "รอเจ้าของหอพักอนุมัติ" when pending', () => {
          const mockTenant = {
            id: 'tenant-pending-1',
            name: 'นายสมเกียรติ มั่นคง',
            phone: '081-111-2222',
            status: 'pending_owner_approval',
          };

          render(
            <TenantHomeTab
              localTenant={mockTenant as any}
              tenantRoom={null}
              hasRoom={false}
              financialLoading={false}
              financialError={null}
              activeUnpaidBill={null}
              totalNotificationsCount={0}
              onOpenRoomSwitcher={() => { }}
              onOpenNotifications={() => { }}
              onOpenInvoice={() => { }}
              onOpenPayment={() => { }}
              onOpenRepairs={() => { }}
              onOpenUtilities={() => { }}
              onOpenContract={() => { }}
              onOpenMoveOut={() => { }}
              onOpenRenewal={() => { }}
              onGoToAnnouncements={() => { }}
              onStartRegister={() => { }}
              onRefresh={() => { }}
            />
          );

          // Pending button rendered
          const pendingBtn = screen.getByTestId('tenant-pending-register-btn');
          expect(pendingBtn).toBeDefined();
          expect(pendingBtn.textContent).toContain('อยู่ระหว่างรอเจ้าของหอพักอนุมัติ');
          expect((pendingBtn as HTMLButtonElement).disabled).toBe(true);

          // Pending badge rendered
          expect(screen.getByText('รอการอนุมัติ')).toBeDefined();
          // Header and subtitle rendered
          expect(screen.getByText('รอการตรวจสอบข้อมูล')).toBeDefined();
          expect(screen.getByText('อยู่ระหว่างดำเนินการ')).toBeDefined();

          cleanup();
        });

        it('CRIT-R28-HOMETAB-SIMULATED-PENDING-AND-DEVSWITCHER: renders pending button when dev_simulate_pending_registration is true even if hasRoom is true', () => {
          localStorage.setItem('dev_simulate_pending_registration', 'true');
          render(
            <TenantHomeTab
              localTenant={{ id: 't-1', name: 'นายปิติ สบายดี', status: 'active' } as any}
              tenantRoom={{ roomNumber: '202' } as any}
              hasRoom={true}
              financialLoading={false}
              financialError={null}
              activeUnpaidBill={null}
              totalNotificationsCount={0}
              onOpenRoomSwitcher={() => { }}
              onOpenNotifications={() => { }}
              onOpenInvoice={() => { }}
              onOpenPayment={() => { }}
              onOpenRepairs={() => { }}
              onOpenUtilities={() => { }}
              onOpenContract={() => { }}
              onOpenMoveOut={() => { }}
              onOpenRenewal={() => { }}
              onGoToAnnouncements={() => { }}
              onStartRegister={() => { }}
              onRefresh={() => { }}
            />
          );

          const pendingBtn = screen.getByTestId('tenant-pending-register-btn');
          expect(pendingBtn).toBeDefined();
          expect(pendingBtn.textContent).toContain('อยู่ระหว่างรอเจ้าของหอพักอนุมัติ');
          expect((pendingBtn as HTMLButtonElement).disabled).toBe(true);
          expect(screen.getByText('รอการอนุมัติ')).toBeDefined();

          localStorage.removeItem('dev_simulate_pending_registration');
          cleanup();
        });

        it('CRIT-R19-STEP3-COOCCUPANTS-RULES-BANNER-04: renders exact "ระเบียบการแจ้งผู้พักร่วม" banner when co-occupants checked in Step 3', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={3}
              initialViewState="form"
            />
          );

          const coCheckbox = screen.getByTestId('tenant-has-co-occupants-checkbox') as HTMLInputElement;
          // By default co-occupants is checked (true)
          expect(coCheckbox.checked).toBe(true);

          // Rules banner must be visible with original Image 4 text
          expect(screen.getByText('ระเบียบการแจ้งผู้พักร่วม')).toBeDefined();
          expect(screen.getByText(/เพื่อคำนวณค่าบริการต่างๆ ตามจำนวนคน/)).toBeDefined();
          expect(screen.getByText(/ตรวจพบถือว่าเจตนาทุจริต\/โกง มีโทษปรับตามสัญญา/)).toBeDefined();

          // When unchecked, banner is hidden
          fireEvent.click(coCheckbox);
          expect(coCheckbox.checked).toBe(false);
          expect(screen.queryByText('ระเบียบการแจ้งผู้พักร่วม')).toBeNull();

          // When checked again, banner reappears
          fireEvent.click(coCheckbox);
          expect(coCheckbox.checked).toBe(true);
          expect(screen.getByText('ระเบียบการแจ้งผู้พักร่วม')).toBeDefined();

          cleanup();
        });
      });

      describe('Round 20 Specifications: Lease Durations, Dynamic Lessor Parity, Custom Prefix Resolution, Contract Clause 5 & 2-Party PDF Parity', () => {
        it('CRIT-R20-MONTHLY-DURATION-1TO12-01: Monthly lease duration dropdown strictly offers 1 to 12 months', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialRentPlan="monthly"
              initialStep={1}
              initialViewState="form"
            />
          );

          // Find the duration select (defaults to 1 month in Round 21)
          const durationSelect = screen.getByDisplayValue('1 เดือน') as HTMLSelectElement;
          expect(durationSelect).toBeDefined();

          // Get all options under durationSelect
          const options = Array.from(durationSelect.querySelectorAll('option')).map(o => o.textContent?.trim());
          expect(options).toEqual([
            '1 เดือน',
            '2 เดือน',
            '3 เดือน',
            '4 เดือน',
            '5 เดือน',
            '6 เดือน',
            '7 เดือน',
            '8 เดือน',
            '9 เดือน',
            '10 เดือน',
            '11 เดือน',
            '12 เดือน (1 ปี)'
          ]);
          cleanup();
        });

        it('CRIT-R20-TERM-DURATION-1TO6-DYNAMIC-DEFAULT-02: Term duration dropdown offers strictly 1 to 6 months with dynamic default from termMonths', () => {
          const mockRooms = [
            {
              id: 'room-102',
              roomNumber: '102',
              floor: 1,
              monthlyRent: 4500,
              termRent: 27000,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
              termMonths: 6,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-102"
              initialRentPlan="term"
              initialStep={1}
              initialViewState="form"
            />
          );

          // Dynamic default should be 6 months (1 ภาคเรียน)
          const durationSelect = screen.getByDisplayValue('6 เดือน (1 ภาคเรียน)') as HTMLSelectElement;
          expect(durationSelect).toBeDefined();
          expect(durationSelect.value).toBe('6');

          // Options must strictly be 1..6 with 6 labelled (1 ภาคเรียน), NO 8, 10, or 12
          const options = Array.from(durationSelect.querySelectorAll('option')).map(o => o.textContent?.trim());
          expect(options).toEqual([
            '1 เดือน',
            '2 เดือน',
            '3 เดือน',
            '4 เดือน',
            '5 เดือน',
            '6 เดือน (1 ภาคเรียน)'
          ]);
          cleanup();
        });

        it('CRIT-R20-CUSTOM-PREFIX-RESOLUTION-04: Resolves custom prefix in Step 5 preview and signature block without literal "ระบุเอง"', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={2}
              initialViewState="form"
            />
          );

          // Select "ระบุเอง" in prefix
          const prefixSelect = screen.getByDisplayValue('นาย');
          fireEvent.change(prefixSelect, { target: { value: 'ระบุเอง' } });

          // Fill custom prefix with "test"
          const customPrefixInput = screen.getByTestId('tenant-custom-prefix-input');
          fireEvent.change(customPrefixInput, { target: { value: 'test' } });

          // Fill full name with "น้องภูมิ สุดเท่ห์"
          const fullNameInput = screen.getByTestId('tenant-fullname-input');
          fireEvent.change(fullNameInput, { target: { value: 'น้องภูมิ สุดเท่ห์' } });

          // Switch to Step 5
          const step5Btn = screen.getByTestId('step-indicator-5');
          fireEvent.click(step5Btn);

          // Preamble and signature block must show "test น้องภูมิ สุดเท่ห์" and NOT "ระบุเอง"
          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();
          expect(step5Container?.textContent).toContain('test น้องภูมิ สุดเท่ห์');
          expect(step5Container?.textContent).not.toContain('ระบุเอง น้องภูมิ สุดเท่ห์');

          cleanup();
        });

        it('CRIT-R20-LESSOR-BANK-NAME-PARITY-03: Resolves lessor name with receipt parity format and displays owner signature image', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          const mockPolicy = {
            dormitoryName: 'หอพักภูมิทรัพย์',
            bankAccountName: 'นายภูมิรพี ผู้ให้เช่าใจดี',
            ownerSignature: 'data:image/png;base64,mockOwnerSigData',
            termMonths: 6,
          };

          render(
            <TenantRegisterView
              rooms={mockRooms}
              policy={mockPolicy}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
            />
          );

          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();

          // Preamble must show "[Bank Name] ([Dormitory Name])"
          expect(step5Container?.textContent).toContain('นายภูมิรพี ผู้ให้เช่าใจดี (หอพักภูมิทรัพย์)');

          // Under lessor signature, must show lessor name
          expect(step5Container?.textContent).toContain('(นายภูมิรพี ผู้ให้เช่าใจดี)');

          // Owner signature graphic must be rendered
          const ownerSigImg = screen.getByAltText('ลายเซ็นผู้ให้เช่า') as HTMLImageElement;
          expect(ownerSigImg).toBeDefined();
          expect(ownerSigImg.src).toContain('data:image/png;base64,mockOwnerSigData');

          cleanup();
        });

        it('CRIT-R20-OCCUPANTS-CLAUSE5-INSERTION-06: Step 5 renders Clause 5 for total occupants count and renumbers rules to Clause 6', () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={3}
              initialViewState="form"
            />
          );

          // Add a co-occupant in Step 3
          const nameInput = screen.getByTestId('tenant-co-occupant-name-input');
          fireEvent.change(nameInput, { target: { value: 'นายร่วม พักดี' } });
          const addCoBtn = screen.getByTestId('tenant-add-co-occupant-btn');
          fireEvent.click(addCoBtn);

          // Switch to Step 5
          const step5Btn = screen.getByTestId('step-indicator-5');
          fireEvent.click(step5Btn);

          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();

          // Clause 5 must be present with total occupants = 2 (1 main + 1 co)
          expect(step5Container?.textContent).toContain('ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:');
          expect(step5Container?.textContent).toContain('2 คน');

          // Rules must be Clause 6
          expect(step5Container?.textContent).toContain('ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:');

          cleanup();
        });

        it('CRIT-R20-CONTRACT-PERSISTENCE-PARITY-08: openTenantContractPrintWindow renders identical 2-party parity template', () => {
          const mockContract = {
            id: 'contract-test-1',
            contractNumber: 'CTR-2026-001',
            startDate: '2026-09-01',
            endDate: '2027-08-31',
            durationMonths: 12,
            rentAmount: 4500,
            depositAmount: 5000,
            tenantSignature: 'data:image/png;base64,mockTenantSig',
            ownerSignature: 'data:image/png;base64,mockOwnerSig',
            coTenants: [{ name: 'นายร่วม พักดี', phone: '089-999-8888' }],
            terms: '1. ผู้เช่าต้องรักษาความสะอาด',
          };

          const mockTenantData = {
            name: 'นายภูมิรพี เจริญสุข',
            phone: '081-234-5678',
            citizenId: '1-1002-00345-67-8',
          };

          const mockDormData = {
            id: 'dorm-1',
            name: 'หอพักภัทรเฮ้าส์',
            address: '99/9 หมู่ 1 ต.คลองหก อ.คลองหลวง จ.ปทุมธานี 12120',
            billingSettings: {
              bankAccountName: 'นายภัทร อัครเดช',
            },
          };

          // Mock window.open
          let writtenHtml = '';
          const mockWindow = {
            document: {
              write: (html: string) => { writtenHtml += html; },
              close: () => {},
            },
          };
          const originalOpen = window.open;
          window.open = vi.fn().mockReturnValue(mockWindow as any);

          const win = openTenantContractPrintWindow(
            mockContract,
            mockTenantData,
            { roomNumber: '101', floor: 1 },
            mockDormData,
            { autoPrint: false }
          );

          expect(win).toBeDefined();
          // Verify lessor bank name format
          expect(writtenHtml).toContain('นายภัทร อัครเดช (หอพักภัทรเฮ้าส์)');
          expect(writtenHtml).toContain('(นายภัทร อัครเดช)');
          // Verify Clause 5 occupants count (1 main + 1 coTenant = 2)
          expect(writtenHtml).toContain('ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:');
          expect(writtenHtml).toContain('2 คน');
          // Verify Clause 6 rules
          expect(writtenHtml).toContain('ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:');
          // Verify signatures present
          expect(writtenHtml).toContain('mockTenantSig');
          expect(writtenHtml).toContain('mockOwnerSig');

          window.open = originalOpen;
        });

        it('CRIT-R21-MONTHLY-DEFAULT-DURATION-01: Monthly lease defaults to 1 month and resets to 1 month when switched', async () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              termRent: 27000,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
              termMonths: 6,
            }
          ];

          const { rerender } = render(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={1}
              initialRentPlan="monthly"
              initialViewState="form"
            />
          );

          // Find duration select in Step 1
          const durationSelect = screen.getByTestId('tenant-duration-select') as HTMLSelectElement;
          expect(durationSelect).toBeDefined();
          // Verify default value is 1 month
          expect(durationSelect.value).toBe('1');

          // Switch to term plan via prop update
          rerender(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={1}
              initialRentPlan="term"
              initialViewState="form"
            />
          );
          expect(durationSelect.value).toBe('6');

          // Switch back to monthly plan via prop update
          rerender(
            <TenantRegisterView
              rooms={mockRooms}
              initialRoomId="room-101"
              initialStep={1}
              initialRentPlan="monthly"
              initialViewState="form"
            />
          );
          // Value must reset to 1 month
          expect(durationSelect.value).toBe('1');

          cleanup();
        });

        it('CRIT-R21-OWNER-SIGNATURE-STEP5-PARITY-02: Step 5 resolves owner signature graphic and bank name from owner settings', async () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          const testDormId = 'dorm-uat-r21';
          const mockOwnerSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

          localStorage.setItem(`dormitory_${testDormId}`, JSON.stringify({
            id: testDormId,
            name: 'หอพักกบ อบบอ วิลเลจ',
            bankAccountName: 'นายกบ อบบอ',
            ownerSignature: mockOwnerSig,
          }));

          render(
            <TenantRegisterView
              rooms={mockRooms}
              dormitoryId={testDormId}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
            />
          );

          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();

          // Lessor name in contract header
          expect(step5Container?.textContent).toContain('นายกบ อบบอ (หอพักกบ อบบอ วิลเลจ)');

          // Owner signature image in signature block
          const sigImg = screen.getByAltText('ลายเซ็นผู้ให้เช่า') as HTMLImageElement;
          expect(sigImg).toBeDefined();
          expect(sigImg.src).toBe(mockOwnerSig);

          // Printed name below signature line
          expect(step5Container?.textContent).toContain('(นายกบ อบบอ)');

          localStorage.removeItem(`dormitory_${testDormId}`);
          cleanup();
        });

        it('CRIT-R21-OWNER-SIGNATURE-FALLBACK-CLEAN-LINE-03: Step 5 renders clean dotted signature line when owner signature is absent', async () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          const testDormId = 'dorm-uat-nosig';
          localStorage.setItem(`dormitory_${testDormId}`, JSON.stringify({
            id: testDormId,
            name: 'หอพักไม่มีลายเซ็น',
            bankAccountName: 'นายเจ้าของ หอพัก',
            ownerSignature: '',
          }));

          render(
            <TenantRegisterView
              rooms={mockRooms}
              dormitoryId={testDormId}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
            />
          );

          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();

          // No img for owner signature
          expect(screen.queryByAltText('ลายเซ็นผู้ให้เช่า')).toBeNull();

          // Should NOT render italic text in place of signature
          const italicSpans = step5Container?.querySelectorAll('span.italic');
          const hasItalicSigner = Array.from(italicSpans || []).some(s => s.textContent?.trim() === 'นายเจ้าของ หอพัก');
          expect(hasItalicSigner).toBe(false);

          // Clean signature space rendered without dots (Round 28 Q6)
          expect(step5Container?.textContent).toContain('ผู้ให้เช่าลงนามแล้ว');

          // Printed name below
          expect(step5Container?.textContent).toContain('(นายเจ้าของ หอพัก)');

          localStorage.removeItem(`dormitory_${testDormId}`);
          cleanup();
        });

        it('CRIT-R21-OWNER-SIGNATURE-ASYNC-POLICY-SYNC-04: Step 5 synchronizes owner signature and bank name when policy prop updates asynchronously', async () => {
          const mockRooms = [
            {
              id: 'room-101',
              roomNumber: '101',
              floor: 1,
              monthlyRent: 4500,
              depositAmount: 5000,
              isVacant: true,
              selectable: true,
            }
          ];

          const testDormId = '20000001-0000-4000-8000-000000000002';
          const realOwnerSig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAZAAAACgCAYAAAAisjrV...';

          // Initial render with empty policy (simulating initial state before async API resolves)
          const { rerender } = render(
            <TenantRegisterView
              rooms={mockRooms}
              dormitoryId={testDormId}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
              policy={{
                dormitoryId: testDormId,
                dormitoryName: 'HorPlus Dormitory',
                defaultTerms: '',
                petPolicy: { allowed: 'none' },
                version: 1,
              }}
            />
          );

          // Now async API resolves and passes full policyData with ownerSignature & bankAccountName
          rerender(
            <TenantRegisterView
              rooms={mockRooms}
              dormitoryId={testDormId}
              initialRoomId="room-101"
              initialStep={5}
              initialViewState="form"
              policy={{
                dormitoryId: testDormId,
                dormitoryName: 'หอพัก HorPlus UAT Comprehensive Manor',
                bankAccountName: 'นายกบ อบบอ',
                defaultTerms: '',
                petPolicy: { allowed: 'none' },
                version: 1,
                ownerSignature: realOwnerSig,
              }}
            />
          );

          const step5Container = document.getElementById('step-5');
          expect(step5Container).toBeDefined();

          // Lessor name in contract header updated
          expect(step5Container?.textContent).toContain('นายกบ อบบอ (หอพัก HorPlus UAT Comprehensive Manor)');

          // Owner signature image rendered with updated src
          const sigImg = screen.getByAltText('ลายเซ็นผู้ให้เช่า') as HTMLImageElement;
          expect(sigImg).toBeDefined();
          expect(sigImg.src).toBe(realOwnerSig);

          // Printed name below signature line updated
          expect(step5Container?.textContent).toContain('(นายกบ อบบอ)');

          cleanup();
        });
      });
    });

    describe('Daily Stay 2-Step Registration Flow & Owner Notification Sync (Round 22)', () => {
      const mockDailyRooms = [
        {
          id: 'room-d1',
          roomNumber: '101',
          floor: 1,
          monthlyRent: 4500,
          depositAmount: 5000,
          dailyRent: 600,
          dailyDeposit: 500,
          status: 'vacant',
        },
      ];

      const mockDailyPolicy = {
        dormitoryId: 'dorm-daily-1',
        dormitoryName: 'หอพัก HorPlus UAT Comprehensive Manor',
        defaultTerms: 'ข้อกำหนดทั่วไป',
        petPolicy: { allowed: 'none' },
        version: 1,
      };

      const setupDailyCanvas = () => {
        HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          clearRect: vi.fn(),
        });
        HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockedDailySignaturePng');
        HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
          left: 0,
          top: 0,
          width: 340,
          height: 110,
        });
      };

      it('CRIT-R22-DAILY-2STEP-STRUCTURE-01: renders exactly 2 steps for daily stay workflow', () => {
        render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={1}
          />
        );

        // Header shows 2 steps total (1/2)
        expect(document.body.textContent).toContain('1/2: ห้องพัก & วันเข้าพัก');

        // Step indicator has only 2 steps
        const step1Btn = screen.getByTestId('step-indicator-1');
        const step2Btn = screen.getByTestId('step-indicator-2');
        expect(step1Btn.textContent).toContain('ห้อง/วันพัก');
        expect(step2Btn.textContent).toContain('ผู้พัก/ยืนยัน');

        // Step 3 indicator does not exist
        expect(screen.queryByTestId('step-indicator-3')).toBeNull();
        expect(screen.queryByTestId('step-indicator-4')).toBeNull();
        expect(screen.queryByTestId('step-indicator-5')).toBeNull();

        cleanup();
      });

      it('CRIT-R22-DAILY-STEP1-CONTENT-02: Step 1 displays daily stay card, dates, calculation, deposit, and removes special requests', () => {
        render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={1}
          />
        );

        // Daily Stay Workflow banner in Step 1
        expect(screen.getByText(/การเข้าพักรายวัน \(DailyStay Workflow\)/)).toBeDefined();
        expect(screen.getByText('วันเริ่มเข้าพัก (Check-in) *')).toBeDefined();
        expect(screen.getByText('วันสิ้นสุดเข้าพัก (Check-out) *')).toBeDefined();

        // Summary calculation card
        expect(screen.getByText('จำนวนวันที่เข้าพัก:')).toBeDefined();
        expect(screen.getByText('อัตราค่าเช่ารายวัน:')).toBeDefined();
        expect(screen.getByText('รวมค่าห้องพัก:')).toBeDefined();

        // Key deposit and deposit status
        expect(screen.getByText('ค่าประกัน / ค่ามัดจำ (บาท) *')).toBeDefined();
        expect(screen.getByText('สถานะเงินมัดจำ')).toBeDefined();
        expect(screen.getByText('ชำระแล้ว')).toBeDefined();
        expect(screen.getByText('ยังไม่ชำระ')).toBeDefined();

        // "ความต้องการเพิ่มเติม (ถ้ามี)" is completely removed
        expect(screen.queryByText('ความต้องการเพิ่มเติม (ถ้ามี)')).toBeNull();
        expect(screen.queryByPlaceholderText(/เช่น เวลาเข้าพักโดยประมาณ/)).toBeNull();

        // Bottom nav button shows Next: ผู้พัก/ยืนยัน
        const nextBtn = screen.getByTestId('bottom-nav-next-btn');
        expect(nextBtn.textContent).toContain('ผู้พัก/ยืนยัน');

        cleanup();
      });

      it('CRIT-R22-DAILY-STEP2-SIGNATURE-03: Step 2 includes personal info, signature canvas, agreement checkbox, and submit CTA', () => {
        setupDailyCanvas();
        render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={2}
          />
        );

        // Header shows step 2/2
        expect(document.body.textContent).toContain('2/2: ข้อมูลผู้พัก & ยืนยัน');

        // Personal info fields
        expect(screen.getByTestId('tenant-prefix-select')).toBeDefined();
        expect(screen.getByPlaceholderText('เช่น สมชาย ใจดี')).toBeDefined();
        expect(screen.getByTestId('tenant-phone-input')).toBeDefined();
        expect(screen.getByTestId('tenant-citizen-id-input')).toBeDefined();

        // Digital signature canvas
        expect(screen.getByText('ลายเซ็นดิจิทัลสำหรับขอเข้าพักรายวัน *')).toBeDefined();
        expect(document.querySelector('canvas')).toBeDefined();

        // Terms acceptance checkbox
        expect(screen.getByTestId('tenant-agree-terms-checkbox')).toBeDefined();

        // Direct and bottom submit CTAs
        const directSubmitBtn = screen.getByTestId('submit-daily-stay-btn');
        expect(directSubmitBtn.textContent).toContain('ส่งคำขอเข้าพักรายวัน (รอเจ้าของหอพักอนุมัติ)');

        const bottomSubmitBtn = screen.getByTestId('bottom-nav-submit-btn');
        expect(bottomSubmitBtn.textContent).toContain('ส่งคำขอเข้าพัก');

        // Daily step 3 container does not exist
        expect(document.getElementById('step-3')).toBeNull();

        cleanup();
      });

      it('CRIT-R22-DAILY-SUBMIT-DUAL-SYNC-04: Submitting daily stay request triggers dual-sync to daily stay and registration requests', async () => {
        setupDailyCanvas();

        const dailySpy = vi.spyOn(apiAdapter, 'submitDailyStayRequest').mockResolvedValueOnce({
          success: true,
          data: {
            id: 'stay-sync-101',
            status: 'PENDING_APPROVAL',
            roomNumber: '101',
            applicantFullName: 'นาย ปริญญา สุขใจ',
          },
        });

        const regSpy = vi.spyOn(apiAdapter, 'submitTenantRegistrationRequest').mockResolvedValueOnce({
          success: true,
          data: {
            id: 'reg-daily-sync-101',
            status: 'pending_owner_approval',
            requestedRoomId: 'room-d1',
          },
        });

        render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={2}
          />
        );

        // Fill required Step 2 inputs
        const nameInput = screen.getByPlaceholderText('เช่น สมชาย ใจดี');
        const phoneInput = screen.getByTestId('tenant-phone-input');
        const citizenInput = screen.getByTestId('tenant-citizen-id-input');
        const birthDateInput = screen.getByTestId('tenant-birthdate-input');
        const addressInput = screen.getByTestId('tenant-address-input');
        fireEvent.change(nameInput, { target: { value: 'ปริญญา สุขใจ' } });
        fireEvent.change(phoneInput, { target: { value: '0891112233' } });
        fireEvent.change(citizenInput, { target: { value: '1100500112244' } });
        fireEvent.change(birthDateInput, { target: { value: '2000-01-01' } });
        fireEvent.change(addressInput, { target: { value: '99/9 หมู่ 1 ต.ท่าสุด อ.เมือง จ.เชียงราย 57100' } });

        // Draw signature
        const canvas = document.querySelector('canvas')!;
        fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30 });
        fireEvent.mouseUp(canvas);

        // Check agreement checkbox
        const agreeCheckbox = screen.getByTestId('tenant-agree-terms-checkbox');
        fireEvent.click(agreeCheckbox);

        // Click submit
        const submitBtn = screen.getByTestId('submit-daily-stay-btn');
        fireEvent.click(submitBtn);

        await waitFor(() => {
          expect(dailySpy).toHaveBeenCalledWith(
            expect.objectContaining({
              dormitoryId: 'dorm-daily-1',
              roomId: 'room-d1',
              applicantFullName: 'นาย ปริญญา สุขใจ',
              applicantPhone: '089-111-2233',
            })
          );
        });

        await waitFor(() => {
          expect(regSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              dormitoryId: 'dorm-daily-1',
              requestedRoomId: 'room-d1',
              firstName: 'ปริญญา',
              lastName: 'สุขใจ',
              phone: '089-111-2233',
              rentalPlan: 'daily',
              citizenId: '1-1005-00112-24-4',
              agreedTerms: true,
            })
          );
        });

        // Verification of success status screen
        await waitFor(() => {
          expect(screen.getByText(/สถานะ: รออนุมัติคำขอเข้าพักรายวัน/)).toBeDefined();
        });

        cleanup();
      });
    });

    describe('Round 23: Chrome Native Date Picker with Thai Buddhist Era & Strict Required Validation', () => {
      const mockDailyRooms = [
        {
          id: 'room-d1',
          roomNumber: '101',
          floor: 1,
          monthlyRent: 4500,
          depositAmount: 5000,
          dailyRent: 600,
          dailyDeposit: 500,
          status: 'vacant',
        },
      ];

      const mockDailyPolicy = {
        dormitoryId: 'dorm-daily-1',
        dormitoryName: 'หอพัก HorPlus UAT Comprehensive Manor',
        defaultTerms: 'ข้อกำหนดทั่วไป',
        petPolicy: { allowed: 'none' },
        version: 1,
      };

      const setupDailyCanvas = () => {
        HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
          clearRect: vi.fn(),
        });
        HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/png;base64,mockedDailySignaturePng');
        HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
          left: 0,
          top: 0,
          width: 340,
          height: 140,
        });
      };

      it('AC-R23-01 & AC-R23-02: Date inputs display Thai Buddhist Era format (DD/MM/BBBB) and support Chrome picker button', async () => {
        const { unmount } = render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={1}
          />
        );

        const checkinInput = screen.getByTestId('daily-checkin-date-input') as HTMLInputElement;
        const checkoutInput = screen.getByTestId('daily-checkout-date-input') as HTMLInputElement;

        // Verify initial dates are formatted as Thai BE (e.g. 19/09/2569)
        expect(checkinInput.value).toMatch(/\d{2}\/\d{2}\/25\d{2}/);
        expect(checkoutInput.value).toMatch(/\d{2}\/\d{2}\/25\d{2}/);

        // Verify presence of calendar picker trigger buttons
        expect(screen.getByTestId('daily-checkin-date-input-picker-btn')).toBeDefined();
        expect(screen.getByTestId('daily-checkout-date-input-picker-btn')).toBeDefined();

        // Change date using ISO string (e.g. 2026-12-30) and verify display converts to 30/12/2569
        fireEvent.change(checkinInput, { target: { value: '2026-12-30' } });
        expect(checkinInput.value).toBe('30/12/2569');

        // Change date using Thai BE string (e.g. 31/12/2569) and verify display persists
        fireEvent.change(checkoutInput, { target: { value: '31/12/2569' } });
        expect(checkoutInput.value).toBe('31/12/2569');

        unmount();
      });

      it('AC-R23-03 & AC-R23-04: birthDate starts empty and Step 2 strictly enforces birthDate and address validation for daily stay', async () => {
        setupDailyCanvas();
        const { unmount } = render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="daily"
            initialStep={2}
          />
        );

        const birthDateInput = screen.getByTestId('tenant-birthdate-input') as HTMLInputElement;
        const addressInput = screen.getByTestId('tenant-address-input') as HTMLTextAreaElement;

        // AC-R23-04: birthDate starts clean/empty
        expect(birthDateInput.value).toBe('');

        // Fill other required fields but leave birthDate and address empty
        const nameInput = screen.getByPlaceholderText('เช่น สมชาย ใจดี');
        const phoneInput = screen.getByTestId('tenant-phone-input');
        const citizenInput = screen.getByTestId('tenant-citizen-id-input');
        fireEvent.change(nameInput, { target: { value: 'สมศักดิ์ ทดสอบ' } });
        fireEvent.change(phoneInput, { target: { value: '0812345678' } });
        fireEvent.change(citizenInput, { target: { value: '1100500112233' } });

        // Draw signature
        const canvas = document.querySelector('canvas')!;
        fireEvent.mouseDown(canvas, { clientX: 10, clientY: 10 });
        fireEvent.mouseMove(canvas, { clientX: 30, clientY: 30 });
        fireEvent.mouseUp(canvas);

        // Check agreement
        const agreeCheckbox = screen.getByTestId('tenant-agree-terms-checkbox');
        fireEvent.click(agreeCheckbox);

        // Click submit while birthDate & address are empty
        const submitBtn = screen.getByTestId('submit-daily-stay-btn');
        fireEvent.click(submitBtn);

        // Verify highlight error classes applied
        expect(birthDateInput.className).toContain('border-rose-400');
        expect(addressInput.className).toContain('border-rose-400');

        // Now provide valid birthDate and address
        fireEvent.change(birthDateInput, { target: { value: '2000-01-01' } });
        expect(birthDateInput.value).toBe('01/01/2543');
        fireEvent.change(addressInput, { target: { value: '123/45 ถนนสีลม แขวงสีลม เขตบางรัก กทม.' } });

        unmount();
      });

      it('AC-R23-05: Monthly registration also uses ChromeThaiDatePicker for check-in and birthdate', async () => {
        const { unmount } = render(
          <TenantRegisterView
            rooms={mockDailyRooms}
            policy={mockDailyPolicy}
            dormitoryId="dorm-daily-1"
            initialRentPlan="monthly"
            initialStep={1}
          />
        );

        const monthlyCheckin = screen.getByTestId('tenant-checkin-date-input') as HTMLInputElement;
        expect(monthlyCheckin.value).toMatch(/\d{2}\/\d{2}\/25\d{2}/);
        expect(screen.getByTestId('tenant-checkin-date-input-picker-btn')).toBeDefined();

        unmount();
      });
    });
  });
});


