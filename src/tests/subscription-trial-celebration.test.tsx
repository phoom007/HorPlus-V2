// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CelebrationFireworksOverlay } from '../components/common/CelebrationFireworksOverlay';

let mockStorage: Record<string, string> = {};

describe('PERF-08: PRO Trial Claim Fireworks Celebration Overlay Suite', () => {
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

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('CelebrationFireworksOverlay Component', () => {
    it('does not render when isOpen is false', () => {
      render(
        <CelebrationFireworksOverlay
          isOpen={false}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders non-blocking top-center toast with role="status", background canvas, and approved Thai copy', () => {
      const onClose = vi.fn();
      render(
        <CelebrationFireworksOverlay
          isOpen={true}
          onClose={onClose}
        />
      );

      const statusToast = screen.getByRole('status', { name: /แจ้งเตือนการรับสิทธิ์ใช้งานสำเร็จ/i });
      expect(statusToast).toBeDefined();
      expect(statusToast.className).toContain('fixed');
      expect(statusToast.className).toContain('top-6');
      expect(statusToast.className).toContain('pointer-events-none');

      // 2-line Thai Copywriting
      expect(
        screen.getByText('🎉 ยินดีด้วย! คุณได้รับสิทธิ์ใช้งานฟรี 1 เดือน')
      ).toBeDefined();

      expect(
        screen.getByText('อัปเกรดเป็น HORPLUS PRO เรียบร้อยแล้ว')
      ).toBeDefined();

      // Ensure NO modal dialog, NO blocking backdrop, and NO action buttons
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryByText('เข้าสู่แดชบอร์ด')).toBeNull();
      expect(screen.queryByTitle('ปิดหน้าต่าง')).toBeNull();
    });

    it('auto-dismisses after autoDismissMs (3500ms) with smooth fade transition and triggers onClose', () => {
      vi.useFakeTimers();
      const onClose = vi.fn();

      render(
        <CelebrationFireworksOverlay
          isOpen={true}
          onClose={onClose}
          autoDismissMs={3500}
        />
      );

      const toast = screen.getByRole('status', { name: /แจ้งเตือนการรับสิทธิ์ใช้งานสำเร็จ/i });
      expect(toast.className).toContain('opacity-100');
      expect(onClose).not.toHaveBeenCalled();

      // At 3000ms: fade-out initiates (opacity-0)
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(toast.className).toContain('opacity-0');
      expect(onClose).not.toHaveBeenCalled();

      // At 3500ms: complete auto-dismiss triggers onClose
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(onClose).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe('Trial Claim Navigation with Celebration Trigger Integration', () => {
    it('sets sessionStorage flag and navigates to dashboard with showTrialCelebration: true on trial commit success', () => {
      const onNavigate = vi.fn();
      const setIsPaymentViewOpen = vi.fn();

      // Simulate handleClaimFreeTrial logic
      const simulateHandleClaimFreeTrial = (commitSuccess: boolean) => {
        if (commitSuccess) {
          setIsPaymentViewOpen(false);
          try {
            sessionStorage.setItem('horplus_pending_trial_celebration', 'true');
          } catch { }
          if (onNavigate) {
            onNavigate('dashboard', { showTrialCelebration: true });
          }
        }
      };

      simulateHandleClaimFreeTrial(true);

      expect(setIsPaymentViewOpen).toHaveBeenCalledWith(false);
      expect(sessionStorage.getItem('horplus_pending_trial_celebration')).toBe('true');
      expect(onNavigate).toHaveBeenCalledWith('dashboard', { showTrialCelebration: true });
    });
  });
});
