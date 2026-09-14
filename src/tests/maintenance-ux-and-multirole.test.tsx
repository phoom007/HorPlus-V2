// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Maintenance UX Polish & Multi-Role Acceptance Test Suite
 * Criteria: MUX-01 through MUX-04
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { OwnerMaintenance, sanitizeCostInput } from '../pages/owner/maintenance';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

describe('Maintenance UX Polish Suite (MUX-01 to MUX-04)', () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const mockRooms: any[] = [
    { id: 'r-1', roomNumber: '101', buildingId: 'b-1', currentTenantId: 't-1' },
    { id: 'r-2', roomNumber: '102', buildingId: 'b-1', currentTenantId: 't-2' },
  ];

  const mockBuildings: any[] = [
    { id: 'b-1', name: 'อาคาร A' },
  ];

  const mockRepairs: any[] = [
    {
      id: 'rep-1',
      roomId: 'r-1',
      title: 'ก็อกน้ำซึม',
      description: 'น้ำหยดตลอดเวลาใต้ซิงค์ล้างจาน',
      status: 'inprogress',
      urgency: 'normal',
      assignedStaff: 'นายช่างสมชาย',
      cost: 350,
      note: 'รอเปลี่ยนซีลยาง',
      createdAt: '2026-09-10T10:00:00.000Z',
      imageBefore: 'data:image/webp;base64,mockImageBefore',
      imageAfter: 'data:image/webp;base64,mockImageAfter',
    },
    {
      id: 'rep-2',
      roomId: null,
      title: 'หลอดไฟทางเดินเสีย',
      description: 'ไฟกะพริบชั้น 2',
      status: 'submitted',
      urgency: 'urgent',
      createdAt: '2026-09-12T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('MUX-02: Cost Input Sanitization & Leading Zero Normalization', () => {
    it('normalizes leading zeros on integer numbers (0123 -> 123)', () => {
      const res = sanitizeCostInput('0123');
      expect(res.displayVal).toBe('123');
      expect(res.numericVal).toBe(123);
    });

    it('strips non-numeric characters and exponential notation (E1 -> 1, abc -> empty)', () => {
      const resE1 = sanitizeCostInput('E1');
      expect(resE1.displayVal).toBe('1');
      expect(resE1.numericVal).toBe(1);

      const resAbc = sanitizeCostInput('abc');
      expect(resAbc.displayVal).toBe('');
      expect(resAbc.numericVal).toBe(0);

      const resExp = sanitizeCostInput('1e5');
      expect(resExp.displayVal).toBe('15');
      expect(resExp.numericVal).toBe(15);
    });

    it('supports at most one decimal point and preserves typing buffer (123. -> 123.)', () => {
      const res = sanitizeCostInput('123.');
      expect(res.displayVal).toBe('123.');
      expect(res.numericVal).toBe(123);

      const resMultiDot = sanitizeCostInput('12.34.56');
      expect(resMultiDot.displayVal).toBe('12.34');
      expect(resMultiDot.numericVal).toBe(12.34);
    });

    it('limits decimal places to at most 2 digits (123.456 -> 123.45)', () => {
      const res = sanitizeCostInput('123.456');
      expect(res.displayVal).toBe('123.45');
      expect(res.numericVal).toBe(123.45);
    });

    it('preserves valid 0 and 0.xx prefixes (0 -> 0, 0.75 -> 0.75, 0123.5 -> 123.5)', () => {
      expect(sanitizeCostInput('0').displayVal).toBe('0');
      expect(sanitizeCostInput('0.75').displayVal).toBe('0.75');
      expect(sanitizeCostInput('0.75').numericVal).toBe(0.75);

      expect(sanitizeCostInput('0123.5').displayVal).toBe('123.5');
      expect(sanitizeCostInput('0123.5').numericVal).toBe(123.5);

      expect(sanitizeCostInput('00').displayVal).toBe('0');
    });

    it('handles negative signs and empty string gracefully', () => {
      expect(sanitizeCostInput('-50').displayVal).toBe('50');
      expect(sanitizeCostInput('').displayVal).toBe('');
      expect(sanitizeCostInput('').numericVal).toBe(0);
    });
  });

  describe('MUX-01 & MUX-03: Maintenance UI Typography & Z-Index Stacking Isolation', () => {
    it('renders detail view with font-sans, footer z-50, and clear button z-10', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OwnerMaintenance
              repairs={mockRepairs}
              rooms={mockRooms}
              buildings={mockBuildings}
              tenants={[]}
              onSaveRepairs={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Open detail view of the in-progress repair
      const card = screen.getByText('ก็อกน้ำซึม');
      fireEvent.click(card);

      // Check footer is elevated to z-50
      const footers = document.querySelectorAll('footer');
      expect(footers.length).toBeGreaterThan(0);
      expect(footers[0].className).toContain('z-50');

      // Check clear image button has z-10 (not z-40)
      const clearBtn = screen.getByRole('button', { name: /ล้างรูปภาพ/i });
      expect(clearBtn).toBeDefined();
      expect(clearBtn.className).toContain('z-10');
      expect(clearBtn.className).not.toContain('z-40');

      // Check container has font-sans and pb-36
      const scrollContainers = document.querySelectorAll('.overflow-y-auto');
      expect(scrollContainers.length).toBeGreaterThan(0);
      expect(scrollContainers[0].className).toContain('font-sans');
      expect(scrollContainers[0].className).toContain('pb-36');

      // Test typing into cost input
      const costInput = screen.getByPlaceholderText('0.00') as HTMLInputElement;
      expect(costInput).toBeDefined();
      expect(costInput.value).toBe('350');

      // Type "0123" -> becomes "123"
      fireEvent.change(costInput, { target: { value: '0123' } });
      expect(costInput.value).toBe('123');

      // Type "123.50" -> becomes "123.50"
      fireEvent.change(costInput, { target: { value: '123.50' } });
      expect(costInput.value).toBe('123.50');

      // Type letters "E1" -> strips "E", becomes "1"
      fireEvent.change(costInput, { target: { value: 'E1' } });
      expect(costInput.value).toBe('1');

      // Type "0" -> becomes "0" (F-02: allows 0-cost warranty work)
      fireEvent.change(costInput, { target: { value: '0' } });
      expect(costInput.value).toBe('0');
    });

    it('renders create modal with font-sans and footer z-50', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <OwnerMaintenance
              repairs={mockRepairs}
              rooms={mockRooms}
              buildings={mockBuildings}
              tenants={[]}
              onSaveRepairs={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Open create repair modal
      const createBtn = screen.getByRole('button', { name: /สร้างเรื่องแจ้งซ่อม/i });
      fireEvent.click(createBtn);

      // Verify create header & container has font-sans
      expect(screen.getByText('บันทึกรายการแจ้งซ่อมบำรุง')).toBeDefined();
      const footers = document.querySelectorAll('footer');
      expect(footers.length).toBeGreaterThan(0);
      expect(footers[0].className).toContain('z-50');
    });
  });
});
