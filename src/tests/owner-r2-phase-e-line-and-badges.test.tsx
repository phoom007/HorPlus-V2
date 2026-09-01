/**
 * @vitest-environment jsdom
 * @license Apache-2.0
 * Round 2 Phase E: LINE Logo Unification & Grid Status Badge Nowrap Test Suite
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineLogo } from '../components/LineLogo';
import { getPaymentStatusBadge } from '../lib/roomRentalSummary';

describe('Round 2 Phase E: LINE Logo Unification & Grid Status Badge Nowrap', () => {
  describe('1. LineLogo Component Unification', () => {
    it('renders Wikimedia-compliant vector LINE official logo', () => {
      render(<LineLogo className="w-6 h-6" />);
      const logo = screen.getByTestId('line-official-logo');
      expect(logo).toBeDefined();
      expect(logo.getAttribute('viewBox')).toBe('0 0 40 40');
      expect(logo.innerHTML).toContain('#06C755');
    });
  });

  describe('2. Grid Status Badge Nowrap Guarantees', () => {
    it('all getPaymentStatusBadge variants include whitespace-nowrap and shrink-0', () => {
      const statuses = ['PAID', 'UNPAID', 'PARTIAL', 'PARTIALLY_PAID', 'NOT_ISSUED', 'UNKNOWN'] as const;

      for (const st of statuses) {
        const badge = getPaymentStatusBadge(st);
        expect(badge.className).toContain('whitespace-nowrap');
        expect(badge.className).toContain('shrink-0');
      }
    });

    it('produces correct semantic Thai text without truncation or wrapping risks', () => {
      expect(getPaymentStatusBadge('PAID').text).toBe('ชำระแล้ว');
      expect(getPaymentStatusBadge('UNPAID').text).toBe('รอชำระ');
      expect(getPaymentStatusBadge('PARTIAL').text).toBe('ชำระบางส่วน');
      expect(getPaymentStatusBadge('NOT_ISSUED').text).toBe('ยังไม่ออกบิล');
      expect(getPaymentStatusBadge('UNKNOWN').text).toBe('ไม่พบข้อมูลการชำระ');
    });
  });
});
