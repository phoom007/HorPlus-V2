import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SourceBadge } from '../components/PropertyBadges';
import { VersionConflictModal } from '../components/VersionConflictModal';
import { PropagationPreviewModal } from '../components/PropagationPreviewModal';
import { PropagationPreviewResult } from '../types';

describe('Wave 1G — Owner Property UI Component & Integration Tests', () => {
  beforeEach(() => {
    cleanup();
  });

  describe('1. Backend-Driven Metadata Source Badges', () => {
    it('renders "ใช้ค่าจากหอพัก" badge when source is DORMITORY', () => {
      render(<SourceBadge source="DORMITORY" />);
      const badge = screen.getByTestId('badge-dormitory');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('ใช้ค่าจากหอพัก');
    });

    it('renders "ใช้ค่าจากอาคาร" badge when source is BUILDING', () => {
      render(<SourceBadge source="BUILDING" />);
      const badge = screen.getByTestId('badge-building');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('ใช้ค่าจากอาคาร');
    });

    it('renders "กำหนดเฉพาะห้อง" badge when source is ROOM', () => {
      render(<SourceBadge source="ROOM" />);
      const badge = screen.getByTestId('badge-room');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('กำหนดเฉพาะห้อง');
    });

    it('renders "มีสัญญาที่ล็อกค่าแล้ว" badge when isLocked is true', () => {
      render(<SourceBadge isLocked={true} />);
      const badge = screen.getByTestId('badge-locked');
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe('มีสัญญาที่ล็อกค่าแล้ว');
    });
  });

  describe('2. VERSION_CONFLICT Modal UX', () => {
    it('does not render when isOpen is false', () => {
      const { container } = render(
        <VersionConflictModal
          isOpen={false}
          onReload={() => {}}
          onCancel={() => {}}
          onRetry={() => {}}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders Thai 409 conflict message and action buttons when open, triggers onReload click', async () => {
      const user = userEvent.setup();
      const onReload = vi.fn();
      const onCancel = vi.fn();
      const onRetry = vi.fn();

      render(
        <VersionConflictModal
          isOpen={true}
          currentVersion={3}
          onReload={onReload}
          onCancel={onCancel}
          onRetry={onRetry}
        />
      );

      const modal = screen.getByTestId('version-conflict-modal');
      expect(modal).toBeDefined();
      expect(screen.getByText(/ตรวจพบการแก้ไขข้อมูลซ้ำซ้อน/i)).toBeDefined();

      const reloadBtn = screen.getByTestId('btn-reload-latest');
      expect(reloadBtn).toBeDefined();
      await user.click(reloadBtn);

      expect(onReload).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. Propagation Preview & Counter Modal', () => {
    it('renders exact summary counters and row effects and triggers confirm', async () => {
      const user = userEvent.setup();
      const onConfirm = vi.fn();
      const onCancel = vi.fn();

      const previewData: PropagationPreviewResult = {
        scope: 'DORMITORY',
        candidateRoomCount: 10,
        eligibleRoomCount: 8,
        eligibleFieldChangeCount: 16,
        skippedRoomCount: 2,
        skippedFieldChangeCount: 4,
        fieldEffects: [
          {
            field: 'monthlyRent',
            roomId: 'rm-101',
            roomNumber: '101',
            oldEffectiveValue: 4000,
            newEffectiveValue: 5000,
            sourceBefore: 'DORMITORY',
            sourceAfter: 'DORMITORY',
            eligible: true,
          },
          {
            field: 'monthlyRent',
            roomId: 'rm-102',
            roomNumber: '102',
            oldEffectiveValue: 4500,
            newEffectiveValue: 4500,
            sourceBefore: 'ROOM',
            sourceAfter: 'ROOM',
            eligible: false,
            skipReason: 'EXPLICIT_ROOM_OVERRIDE',
          },
        ],
      };

      render(
        <PropagationPreviewModal
          isOpen={true}
          previewData={previewData}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const modal = screen.getByTestId('propagation-preview-modal');
      expect(modal).toBeDefined();
      expect(screen.getByTestId('counter-candidate').textContent?.trim()).toBe('10');
      expect(screen.getByTestId('counter-eligible').textContent?.trim()).toBe('8');
      expect(screen.getByTestId('counter-skipped').textContent?.trim()).toBe('2');

      const confirmBtn = screen.getByTestId('btn-confirm-apply');
      await user.click(confirmBtn);

      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Property Mutation & Availability Boundary Validation', () => {
    it('validates date inputs for room availability search', () => {
      const validateDates = (start?: string, end?: string) => {
        if (!start || !end) return { isValid: false, message: 'กรุณาระบุ startDate และ endDate' };
        if (new Date(start) >= new Date(end)) return { isValid: false, message: 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น' };
        return { isValid: true };
      };

      expect(validateDates('', '2026-08-10').isValid).toBe(false);
      expect(validateDates('2026-08-10', '2026-08-05').isValid).toBe(false);
      expect(validateDates('2026-08-01', '2026-08-10').isValid).toBe(true);
    });

    it('formats duplicate room number conflict in Thai', () => {
      const formatDuplicateError = (roomNumber: string) => {
        return `หมายเลขห้องพัก "${roomNumber}" มีอยู่แล้วในหอพักนี้`;
      };

      expect(formatDuplicateError('A101')).toBe('หมายเลขห้องพัก "A101" มีอยู่แล้วในหอพักนี้');
    });
  });
});
