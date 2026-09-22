// @vitest-environment happy-dom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Ticket 02: Claim Input Sanitization Test Suite
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { sanitizeClaimInput } from '../utils/claim-sanitizer';
import { TenantClaimModal } from '../components/TenantClaimModal';
import * as httpClient from '../data/httpClient';

vi.mock('../data/httpClient', () => ({
  httpRequest: vi.fn(),
}));

describe('Ticket 02: Claim Input Sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(httpClient.httpRequest).mockResolvedValue({
      data: {
        hasCandidate: true,
        maskedName: 'สม*** ใจ***',
        maskedPhone: '081-***-78',
        roomNumber: '101',
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('sanitizeClaimInput unit tests', () => {
    it('should return empty string for "Phoom -"', () => {
      expect(sanitizeClaimInput('Phoom -')).toBe('');
    });

    it('should return empty string for "ยังไม่ได้ลงทะเบียน"', () => {
      expect(sanitizeClaimInput('ยังไม่ได้ลงทะเบียน')).toBe('');
    });

    it('should return empty string for "-" and " -"', () => {
      expect(sanitizeClaimInput('-')).toBe('');
      expect(sanitizeClaimInput(' -')).toBe('');
    });

    it('should return empty string for "Somchai -"', () => {
      expect(sanitizeClaimInput('Somchai -')).toBe('');
    });

    it('should return valid phone number "0812345678" as-is', () => {
      expect(sanitizeClaimInput('0812345678')).toBe('0812345678');
    });

    it('should return valid Thai name "สมชาย ใจดี" as-is', () => {
      expect(sanitizeClaimInput('สมชาย ใจดี')).toBe('สมชาย ใจดี');
    });

    it('should return empty string for empty string, undefined, and null', () => {
      expect(sanitizeClaimInput('')).toBe('');
      expect(sanitizeClaimInput(undefined)).toBe('');
      expect(sanitizeClaimInput(null as any)).toBe('');
    });

    it('should handle whitespace and extra dashes correctly', () => {
      expect(sanitizeClaimInput('   ')).toBe('');
      expect(sanitizeClaimInput(' - ')).toBe('');
      expect(sanitizeClaimInput('Phoom - ')).toBe('');
      expect(sanitizeClaimInput('081-234-5678')).toBe('081-234-5678');
    });
  });

  describe('TenantClaimModal initialClaimInput sanitization', () => {
    it('should initialize input with empty string when initialClaimInput is "Phoom -"', async () => {
      render(
        React.createElement(TenantClaimModal, {
          isOpen: true,
          onClose: vi.fn(),
          dormitoryId: 'dorm-1',
          roomNumber: '101',
          initialClaimInput: 'Phoom -',
          onSuccess: vi.fn(),
        })
      );

      const input = await screen.findByPlaceholderText(/เช่น นายสมชาย ใจดี/);
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('should initialize input with empty string when initialClaimInput is "ยังไม่ได้ลงทะเบียน"', async () => {
      render(
        React.createElement(TenantClaimModal, {
          isOpen: true,
          onClose: vi.fn(),
          dormitoryId: 'dorm-1',
          roomNumber: '101',
          initialClaimInput: 'ยังไม่ได้ลงทะเบียน',
          onSuccess: vi.fn(),
        })
      );

      const input = await screen.findByPlaceholderText(/เช่น นายสมชาย ใจดี/);
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('should initialize input with empty string when initialClaimInput is "-"', async () => {
      render(
        React.createElement(TenantClaimModal, {
          isOpen: true,
          onClose: vi.fn(),
          dormitoryId: 'dorm-1',
          roomNumber: '101',
          initialClaimInput: '-',
          onSuccess: vi.fn(),
        })
      );

      const input = await screen.findByPlaceholderText(/เช่น นายสมชาย ใจดี/);
      expect((input as HTMLInputElement).value).toBe('');
    });

    it('should initialize input with valid value when initialClaimInput is "0812345678"', async () => {
      render(
        React.createElement(TenantClaimModal, {
          isOpen: true,
          onClose: vi.fn(),
          dormitoryId: 'dorm-1',
          roomNumber: '101',
          initialClaimInput: '0812345678',
          onSuccess: vi.fn(),
        })
      );

      const input = await screen.findByPlaceholderText(/เช่น นายสมชาย ใจดี/);
      expect((input as HTMLInputElement).value).toBe('0812345678');
    });

    it('should initialize input with valid value when initialClaimInput is "สมชาย ใจดี"', async () => {
      render(
        React.createElement(TenantClaimModal, {
          isOpen: true,
          onClose: vi.fn(),
          dormitoryId: 'dorm-1',
          roomNumber: '101',
          initialClaimInput: 'สมชาย ใจดี',
          onSuccess: vi.fn(),
        })
      );

      const input = await screen.findByPlaceholderText(/เช่น นายสมชาย ใจดี/);
      expect((input as HTMLInputElement).value).toBe('สมชาย ใจดี');
    });
  });
});
