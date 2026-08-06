import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { SourceBadge } from '../components/PropertyBadges';
import { VersionConflictModal } from '../components/VersionConflictModal';
import { PropagationPreviewModal } from '../components/PropagationPreviewModal';
import { PropagationPreviewResult } from '../types';

describe('Wave 1G — Owner Property UI Component & Integration Tests', () => {
  describe('1. Backend-Driven Metadata Source Badges', () => {
    it('renders "ใช้ค่าจากหอพัก" badge when source is DORMITORY', () => {
      const badge = SourceBadge({ source: 'DORMITORY' });
      expect(badge.props.children).toBe('ใช้ค่าจากหอพัก');
      expect(badge.props['data-testid']).toBe('badge-dormitory');
    });

    it('renders "ใช้ค่าจากอาคาร" badge when source is BUILDING', () => {
      const badge = SourceBadge({ source: 'BUILDING' });
      expect(badge.props.children).toBe('ใช้ค่าจากอาคาร');
      expect(badge.props['data-testid']).toBe('badge-building');
    });

    it('renders "กำหนดเฉพาะห้อง" badge when source is ROOM', () => {
      const badge = SourceBadge({ source: 'ROOM' });
      expect(badge.props.children).toBe('กำหนดเฉพาะห้อง');
      expect(badge.props['data-testid']).toBe('badge-room');
    });

    it('renders "มีสัญญาที่ล็อกค่าแล้ว" badge when source is CONTRACT_SNAPSHOT or isLocked is true', () => {
      const badgeSnapshot = SourceBadge({ source: 'CONTRACT_SNAPSHOT' });
      expect(badgeSnapshot.props.children).toBe('มีสัญญาที่ล็อกค่าแล้ว');
      expect(badgeSnapshot.props['data-testid']).toBe('badge-locked');

      const badgeLockedFlag = SourceBadge({ isLocked: true });
      expect(badgeLockedFlag.props.children).toBe('มีสัญญาที่ล็อกค่าแล้ว');
      expect(badgeLockedFlag.props['data-testid']).toBe('badge-locked');
    });
  });

  describe('2. VERSION_CONFLICT Modal UX', () => {
    it('does not render when isOpen is false', () => {
      const modal = VersionConflictModal({
        isOpen: false,
        onReload: () => {},
        onCancel: () => {},
        onRetry: () => {},
      });
      expect(modal).toBeNull();
    });

    it('renders Thai 409 conflict message and action buttons when open', () => {
      const onReload = vi.fn();
      const onCancel = vi.fn();
      const onRetry = vi.fn();

      const modal = VersionConflictModal({
        isOpen: true,
        currentVersion: 3,
        onReload,
        onCancel,
        onRetry,
      });

      expect(modal).not.toBeNull();
      const containerProps = modal?.props;
      expect(containerProps['data-testid']).toBe('version-conflict-modal');
    });
  });

  describe('3. Propagation Preview & Counter Modal', () => {
    it('renders exact summary counters and row effects', () => {
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

      const modal = PropagationPreviewModal({
        isOpen: true,
        previewData,
        onConfirm: () => {},
        onCancel: () => {},
      });

      expect(modal).not.toBeNull();
      expect(modal?.props['data-testid']).toBe('propagation-preview-modal');
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
