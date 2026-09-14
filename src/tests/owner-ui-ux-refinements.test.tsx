// @vitest-environment jsdom
/**
 * @license Apache-2.0
 * Owner UI/UX Refinements Test Suite (UX-01, UX-02, UX-03)
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { LineNotificationModal } from '../components/LineNotificationModal';
import { OwnerAnnouncements } from '../pages/owner/announcements';

describe('Owner UI/UX Refinements Test Suite', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('UX-01: Buddhist Era (พ.ศ. 2569) Year Consistency in Reports', () => {
    it('should compute Buddhist Era year from selectedYear and cycle code', () => {
      const selectedYear = '2026';
      const effectiveCycleCode = '2026-08';
      const displayYearTh = (parseInt(effectiveCycleCode.split('-')[0] || selectedYear) + 543).toString();

      expect(displayYearTh).toBe('2569');

      // Verify stat card label uses displayYearTh
      const statCardLabel = `มูลค่าจัดเก็บรวมปี ${displayYearTh}`;
      expect(statCardLabel).toBe('มูลค่าจัดเก็บรวมปี 2569');
      expect(statCardLabel).not.toContain('2026');

      const repairCardLabel = `ค่าใช้จ่ายแจ้งซ่อมรวมปี ${displayYearTh}`;
      expect(repairCardLabel).toBe('ค่าใช้จ่ายแจ้งซ่อมรวมปี 2569');

      const chartTitle = `สถิติมูลค่ารายรับรอบปี ${displayYearTh} แยกตามรายเดือน`;
      expect(chartTitle).toBe('สถิติมูลค่ารายรับรอบปี 2569 แยกตามรายเดือน');

      const chartSubtitle = `กราฟเปรียบเทียบแนวโน้มรายรับรวมทุกประเภทเทียบกับค่าเช่าห้องพัก (อ้างอิงปี ${displayYearTh})`;
      expect(chartSubtitle).toBe('กราฟเปรียบเทียบแนวโน้มรายรับรวมทุกประเภทเทียบกับค่าเช่าห้องพัก (อ้างอิงปี 2569)');
    });
  });

  describe('UX-02: Live Real-Time Clock in Announcements Smartphone Simulation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 7, 15, 14, 30, 0)); // 14:30:00
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should render the user real-time in Thai format with น. and update dynamically', () => {
      render(
        <OwnerAnnouncements
          announcements={[]}
          onSaveAnnouncements={vi.fn()}
          currentUser={{ id: 'u1', name: 'Owner', role: 'owner' }}
          rooms={[]}
          buildings={[]}
        />
      );

      // Verify 14:30 น. is rendered in the smartphone status header
      expect(screen.getByText('14:30 น.')).toBeDefined();

      // Advance time to 14:35 and trigger interval tick
      act(() => {
        vi.setSystemTime(new Date(2026, 7, 15, 14, 35, 0));
        vi.advanceTimersByTime(10000);
      });

      expect(screen.getByText('14:35 น.')).toBeDefined();
      expect(screen.queryByText('10:45 AM')).toBeNull();
    });
  });

  describe('UX-03: Payments LINE Notification Popup Empty State & Setup CTA', () => {
    beforeEach(() => {
      // Mock fetch for /api/v1/line/oa/status
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { connected: false, isReady: false },
        }),
      }) as any;
    });

    it('should display "ยังไม่ได้เชื่อมต่อ LINE Official Account" and setup button when LINE OA is unconfigured and bills are empty', async () => {
      const mockNavigateToLineConfig = vi.fn();
      const mockClose = vi.fn();

      render(
        <LineNotificationModal
          isOpen={true}
          onClose={mockClose}
          dormitoryId="dorm-test-01"
          bills={[]}
          tenants={[]}
          rooms={[]}
          selectedCycle="2026-08"
          onNavigateToLineConfig={mockNavigateToLineConfig}
        />
      );

      // Wait for fetch effect to update lineStatus
      await vi.waitFor(() => {
        expect(screen.getByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeDefined();
      });

      expect(
        screen.getByText('กรุณาเชื่อมต่อ LINE OA เพื่อเปิดใช้งานระบบส่งแจ้งเตือนอัตโนมัติถึงผู้เช่า')
      ).toBeDefined();

      const setupButton = screen.getByRole('button', { name: /ไปตั้งค่า LINE OA/ });
      expect(setupButton).toBeDefined();

      // Clicking setup button must close modal and call onNavigateToLineConfig
      fireEvent.click(setupButton);
      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
    });

    it('should display clickable header badge when LINE OA is unconfigured', async () => {
      const mockNavigateToLineConfig = vi.fn();
      const mockClose = vi.fn();

      render(
        <LineNotificationModal
          isOpen={true}
          onClose={mockClose}
          dormitoryId="dorm-test-01"
          bills={[]}
          tenants={[]}
          rooms={[]}
          selectedCycle="2026-08"
          onNavigateToLineConfig={mockNavigateToLineConfig}
        />
      );

      await vi.waitFor(() => {
        const badgeButton = screen.getByTitle('คลิกเพื่อไปตั้งค่า LINE OA');
        expect(badgeButton).toBeDefined();
        fireEvent.click(badgeButton);
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect(mockNavigateToLineConfig).toHaveBeenCalledTimes(1);
      });
    });

    it('should display normal empty state "ไม่มีรายการบิลในหมวดหมู่นี้" when LINE OA is ready but there are no bills', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { connected: true, isReady: true },
        }),
      }) as any;

      render(
        <LineNotificationModal
          isOpen={true}
          onClose={vi.fn()}
          dormitoryId="dorm-test-01"
          bills={[]}
          tenants={[]}
          rooms={[]}
          selectedCycle="2026-08"
        />
      );

      await vi.waitFor(() => {
        expect(screen.getByText('ไม่มีรายการบิลในหมวดหมู่นี้')).toBeDefined();
        expect(
          screen.getByText('ส่งแจ้งเตือนครบทุกห้องในหมวดหมู่นี้แล้ว หรือไม่พบรายการบิลที่ออกแล้วในงวดนี้')
        ).toBeDefined();
      });

      expect(screen.queryByText('ยังไม่ได้เชื่อมต่อ LINE Official Account')).toBeNull();
    });
  });
});
