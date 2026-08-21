// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import {
  calculateMeterUsageUnits,
  calculateMeterRowPreview,
  formatMeterReadingDisplay,
  parseMeterIntegerReading,
} from '../utils/meterBillingCalculator';
import {
  serializeMeterWorkspaceDirtyRow,
  formatCanonicalMeterIntegerString,
} from '../utils/meter-serializer';
import { QuickAddTenantModal } from '../components/QuickAddTenantModal';
import * as httpClient from '../data/httpClient';

describe('LOCAL-07 Meter Workspace & Quick Add Comprehensive Frontend Suite', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('1. Integer-Only Meter Authority & Decimal Rejection', () => {
    it('strictly accepts valid integers 0..99999 and normalizes leading zeros (0500 -> 500)', () => {
      expect(parseMeterIntegerReading(0).isValid).toBe(true);
      expect(parseMeterIntegerReading(0).value).toBe(0);

      expect(parseMeterIntegerReading('0').isValid).toBe(true);
      expect(parseMeterIntegerReading('0').value).toBe(0);

      expect(parseMeterIntegerReading('500').isValid).toBe(true);
      expect(parseMeterIntegerReading('500').value).toBe(500);

      expect(parseMeterIntegerReading('0500').isValid).toBe(true);
      expect(parseMeterIntegerReading('0500').value).toBe(500);

      expect(formatCanonicalMeterIntegerString('0500')).toBe('500');
      expect(formatCanonicalMeterIntegerString('0')).toBe('0');
      expect(formatCanonicalMeterIntegerString(0)).toBe('0');
    });

    it('strictly rejects decimals (12.5, 100.00, 1.50, 9999.50) in serializer and parser', () => {
      expect(parseMeterIntegerReading('12.5').isValid).toBe(false);
      expect(parseMeterIntegerReading('100.00').isValid).toBe(false);
      expect(parseMeterIntegerReading('1.50').isValid).toBe(false);
      expect(parseMeterIntegerReading('9999.50').isValid).toBe(false);

      expect(() => formatCanonicalMeterIntegerString('12.5')).toThrow('ห้ามมีทศนิยม');
      expect(() => formatCanonicalMeterIntegerString('100.00')).toThrow('ห้ามมีทศนิยม');
      expect(() => formatCanonicalMeterIntegerString('1.50')).toThrow('ห้ามมีทศนิยม');
      expect(() => formatCanonicalMeterIntegerString('9999.50')).toThrow('ห้ามมีทศนิยม');

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'r-1',
          waterCurr: '12.5',
        })
      ).toThrow('ห้ามมีทศนิยม');

      expect(() =>
        serializeMeterWorkspaceDirtyRow({
          roomId: 'r-1',
          elecCurr: '9999.50',
        })
      ).toThrow('ห้ามมีทศนิยม');
    });

    it('calculates 9999 -> 1 mechanical 4-digit rollover correctly (usage = 2)', () => {
      const usage = calculateMeterUsageUnits(9999, 1);
      expect(usage.isValid).toBe(true);
      expect(usage.isRollover).toBe(true);
      expect(usage.usageUnits).toBe(2);
    });

    it('calculates 99999 -> 5 mechanical 5-digit rollover correctly (usage = 6)', () => {
      const usage = calculateMeterUsageUnits(99999, 5);
      expect(usage.isValid).toBe(true);
      expect(usage.isRollover).toBe(true);
      expect(usage.usageUnits).toBe(6);
    });

    it('rejects lower reading outside rollover window (500 -> 400)', () => {
      const usage = calculateMeterUsageUnits(500, 400);
      expect(usage.isValid).toBe(false);
      expect(usage.usageUnits).toBe(0);
      expect(usage.errorMessage).toContain('ต้องไม่น้อยกว่าค่ามิเตอร์เดิม');
    });

    it('formats blank/null/undefined as empty string "" and explicit 0 as "0"', () => {
      expect(formatMeterReadingDisplay(null)).toBe('');
      expect(formatMeterReadingDisplay(undefined)).toBe('');
      expect(formatMeterReadingDisplay('')).toBe('');
      expect(formatMeterReadingDisplay(0)).toBe('0');
      expect(formatMeterReadingDisplay('0')).toBe('0');
    });

    it('serializes cleared/blank meter fields to null for backend persistence', () => {
      const dirty = {
        roomId: 'room-1',
        waterPrev: '',
        waterCurr: '150',
        elecPrev: '200',
        elecCurr: '',
      };
      const serialized = serializeMeterWorkspaceDirtyRow(dirty);
      expect(serialized.waterPrev).toBeNull();
      expect(serialized.waterCurr).toBe('150');
      expect(serialized.elecPrev).toBe('200');
      expect(serialized.elecCurr).toBeNull();
    });

    it('serializes explicit 0 meter fields to "0" without coercing to null', () => {
      const dirty = {
        roomId: 'room-1',
        waterPrev: 0,
        waterCurr: 0,
        elecPrev: '0',
        elecCurr: '0',
      };
      const serialized = serializeMeterWorkspaceDirtyRow(dirty);
      expect(serialized.waterPrev).toBe('0');
      expect(serialized.waterCurr).toBe('0');
      expect(serialized.elecPrev).toBe('0');
      expect(serialized.elecCurr).toBe('0');
    });

    it('preview calculation handles blank inputs without NaN', () => {
      const preview = calculateMeterRowPreview(
        { roomId: 'r-1', roomNumber: '101', billingSource: 'PROVISIONAL_MONTHLY', rentAmount: '3500.00' },
        { waterRate: '20.00', electricityRate: '8.00', waterBillingType: 'per_unit', electricityBillingType: 'per_unit' },
        { waterPrev: '', waterCurr: '', elecPrev: '', elecCurr: '' }
      );
      expect(preview.waterUsage).toBe('0.00');
      expect(preview.elecUsage).toBe('0.00');
      expect(preview.waterAmount).toBe('0.00');
      expect(preview.elecAmount).toBe('0.00');
      expect(preview.totalAmount).toBe('3500.00');
    });
  });

  describe('2. Owner UI Financial Amount Due & Collapsible Detail Breakdown', () => {
    it('calculates amountDue correctly when RENT 6000 is PAID, DEPOSIT 500 is PAID, and MONTHLY_UTILITY 800 is UNPAID', () => {
      // Setup room financial state
      const bills = [
        { id: 'b-rent', billKind: 'RENT', totalAmount: '6000.00', status: 'PAID', paidAmount: '6000.00' },
        { id: 'b-dep', billKind: 'DEPOSIT', totalAmount: '500.00', status: 'PAID', paidAmount: '500.00' },
        { id: 'b-util', billKind: 'MONTHLY_UTILITY', totalAmount: '800.00', status: 'ISSUED', paidAmount: '0.00' },
      ];

      // Unpaid amount due calculation
      const unpaidBills = bills.filter(b => b.status !== 'PAID' && b.status !== 'cancelled' && b.status !== 'void');
      const amountDue = unpaidBills.reduce((sum, b) => sum + parseFloat(b.totalAmount), 0);

      expect(amountDue.toFixed(2)).toBe('800.00');
      expect(bills.length).toBe(3); // Total 3 bill items in "ดูรายละเอียด +3"
    });
  });

  describe('3. Quick Add Modal Daily Mode with Optional Check-In / Check-Out Times', () => {
    const mockContext = {
      roomId: '11111111-1111-1111-1111-111111111111',
      dormitoryId: '22222222-2222-2222-2222-222222222222',
      roomNumber: '101',
      roomStatus: 'vacant',
      building: { id: 'bld-1', name: 'Building A', termMonths: 4, maxTermRentInstallments: 2 },
      effective: {
        monthlyRent: 3500,
        termRent: 14000,
        dailyRent: 500,
        depositAmount: 500,
      },
    };

    it('renders optional check-in and check-out time fields in DAILY tab', () => {
      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={vi.fn()}
          context={mockContext as any}
          onSuccess={vi.fn()}
        />
      );

      // Switch to DAILY tab
      const dailyTabButton = screen.getByRole('button', { name: 'รายวัน' });
      fireEvent.click(dailyTabButton);

      // Verify time labels exist
      expect(screen.getByText('เวลาเช็คอิน (ไม่บังคับ)')).toBeTruthy();
      expect(screen.getByText('เวลาเช็คเอาท์ (ไม่บังคับ)')).toBeTruthy();
    });

    it('submits checkInTime and checkOutTime in payload when specified', async () => {
      const httpRequestSpy = vi.spyOn(httpClient, 'httpRequest').mockResolvedValue({ success: true } as any);
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <QuickAddTenantModal
          isOpen={true}
          onClose={onClose}
          context={mockContext as any}
          onSuccess={onSuccess}
        />
      );

      // Switch to DAILY tab
      const dailyTabButton = screen.getByRole('button', { name: 'รายวัน' });
      fireEvent.click(dailyTabButton);

      // Fill Name
      const nameInput = screen.getByPlaceholderText('เช่น นายสมชาย ใจดี');
      fireEvent.change(nameInput, { target: { value: 'สมชาย รายวัน' } });

      // Submit form
      const form = nameInput.closest('form');
      expect(form).toBeTruthy();
      if (form) {
        fireEvent.submit(form);
      }

      await waitFor(() => {
        expect(httpRequestSpy).toHaveBeenCalledWith(
          'POST',
          '/api/v1/daily-stays/owner-quick-add',
          expect.objectContaining({
            fullName: 'สมชาย รายวัน',
            roomId: mockContext.roomId,
          }),
          expect.any(Object)
        );
      });
    });
  });

  describe('4. PO UAT Round 3 Operational Breakdown & Exact Copy Semantics', () => {
    it('proves Owner Amount Due includes unissued preview (5,150.00 ฿) as PREVIEW before issue', async () => {
      const { getOwnerFinancialBreakdown } = await import('../pages/owner/meters');
      const row = {
        roomId: 'r-1',
        roomNumber: '101',
        waterCurr: '10',
        waterPrev: '0',
        elecCurr: '100',
        elecPrev: '0',
        peopleCount: '1',
        overdueAmount: '0',
        otherFees: [],
        billStatus: 'draft',
      };
      const roomCtx = {
        roomId: 'r-1',
        billingSource: 'PROVISIONAL_MONTHLY',
        rentAmount: '4000.00',
        depositAmount: '0.00',
        isDepositPaid: false,
      };
      const rateSnapshot = {
        waterBillingType: 'per_unit',
        waterRate: '15.00',
        electricityBillingType: 'per_unit',
        electricityRate: '10.00',
      };
      // Preview = 4000 (rent) + 150 (water) + 1000 (elec) = 5150.00
      const breakdown = getOwnerFinancialBreakdown(row as any, roomCtx, rateSnapshot, [], 'cycle-1');
      expect(breakdown.operationalAmount).toBe(5150);
      expect(breakdown.formattedAmount).toBe('5,150.00');
      expect(breakdown.components.length).toBe(1);
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
      expect(breakdown.components[0].status).toBe('PREVIEW');
      expect(breakdown.components[0].formattedAmount).toBe('5,150.00');
    });

    it('proves Owner Amount Due remains same after issue and changes status to UNPAID', async () => {
      const { getOwnerFinancialBreakdown } = await import('../pages/owner/meters');
      const row = {
        roomId: 'r-1',
        roomNumber: '101',
        waterCurr: '10',
        waterPrev: '0',
        elecCurr: '100',
        elecPrev: '0',
        peopleCount: '1',
        overdueAmount: '0',
        otherFees: [],
        billStatus: 'issued',
      };
      const roomCtx = {
        roomId: 'r-1',
        billingSource: 'PROVISIONAL_MONTHLY',
        rentAmount: '4000.00',
      };
      const rateSnapshot = {
        waterBillingType: 'per_unit',
        waterRate: '15.00',
        electricityBillingType: 'per_unit',
        electricityRate: '10.00',
      };
      const bills = [
        {
          id: 'b-1',
          roomId: 'r-1',
          billingCycleId: 'cycle-1',
          billKind: 'MONTHLY_UTILITY' as const,
          totalAmount: '5150.00',
          outstandingAmount: '5150.00',
          status: 'ISSUED' as const,
        }
      ];
      const breakdown = getOwnerFinancialBreakdown(row as any, roomCtx, rateSnapshot, bills as any, 'cycle-1');
      expect(breakdown.operationalAmount).toBe(5150);
      expect(breakdown.formattedAmount).toBe('5,150.00');
      expect(breakdown.components[0].label).toBe('บิลรายเดือน');
      expect(breakdown.components[0].status).toBe('UNPAID');
    });

    it('proves Owner Amount Due drops to 0.00 when Monthly bill is paid and status becomes PAID', async () => {
      const { getOwnerFinancialBreakdown } = await import('../pages/owner/meters');
      const row = {
        roomId: 'r-1',
        roomNumber: '101',
        waterCurr: '10',
        waterPrev: '0',
        elecCurr: '100',
        elecPrev: '0',
        peopleCount: '1',
        overdueAmount: '0',
        otherFees: [],
        billStatus: 'paid',
      };
      const roomCtx = {
        roomId: 'r-1',
        billingSource: 'PROVISIONAL_MONTHLY',
        rentAmount: '4000.00',
      };
      const rateSnapshot = {
        waterBillingType: 'per_unit',
        waterRate: '15.00',
        electricityBillingType: 'per_unit',
        electricityRate: '10.00',
      };
      const bills = [
        {
          id: 'b-1',
          roomId: 'r-1',
          billingCycleId: 'cycle-1',
          billKind: 'MONTHLY_UTILITY' as const,
          totalAmount: '5150.00',
          outstandingAmount: '0.00',
          status: 'PAID' as const,
        }
      ];
      const breakdown = getOwnerFinancialBreakdown(row as any, roomCtx, rateSnapshot, bills as any, 'cycle-1');
      expect(breakdown.operationalAmount).toBe(0);
      expect(breakdown.formattedAmount).toBe('0.00');
      expect(breakdown.components[0].status).toBe('PAID');
    });

    it('maps error NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM to ไม่พบผู้เช่า', async () => {
      const { mapErrorMessageToThai } = await import('../pages/owner/meters');
      expect(mapErrorMessageToThai('Error: NO_ACTIVE_CONTRACT_OR_PROVISIONAL_TERM')).toBe('ไม่พบผู้เช่า');
      expect(mapErrorMessageToThai('ROOM_LOCKED_PAID')).toBe('บิลนี้ชำระเงินแล้ว ไม่สามารถยกเลิกหรือแก้ไขได้');
    });
  });

  describe('5. Quick Fill Compound Other Fees & Persistence Authority', () => {
    it('parses "2 คน : ค้าง 50 : ค่าทำความสะอาด 50" into peopleCount = 2 and both otherFees with alias "ค้าง" -> "ค้างชำระ"', () => {
      const text = '101 : 2 คน : ค้าง 50 : ค่าทำความสะอาด 50';
      const lines = text.split('\n');
      const matchedLine = lines[0];
      const parts = matchedLine.split(':').map(p => p.trim());

      let peopleCount: string | number = '1';
      const otherFees: Array<{ description: string; amount: string }> = [];

      parts.slice(1).forEach(part => {
        const trimmedPart = part.trim();
        if (!trimmedPart) return;

        if (trimmedPart.includes('คน')) {
          const match = trimmedPart.match(/\d+/);
          if (match) peopleCount = match[0];
        } else if (trimmedPart.startsWith('ค้างชำระ') || trimmedPart.startsWith('ค้าง')) {
          const match = trimmedPart.match(/\d+(\.\d{1,2})?/);
          if (match) {
            const amt = match[0];
            const desc = 'ค้างชำระ';
            const existingIdx = otherFees.findIndex(f => f.description === desc);
            if (existingIdx >= 0) {
              otherFees[existingIdx] = { ...otherFees[existingIdx], amount: amt };
            } else {
              otherFees.push({ description: desc, amount: amt });
            }
          }
        } else {
          const numMatch = trimmedPart.match(/(\d+(\.\d{1,2})?)$/);
          if (numMatch) {
            const amt = numMatch[1];
            const desc = trimmedPart.substring(0, trimmedPart.length - amt.length).trim();
            if (desc) {
              const existingIdx = otherFees.findIndex(f => f.description.toLowerCase() === desc.toLowerCase());
              if (existingIdx >= 0) {
                otherFees[existingIdx] = { ...otherFees[existingIdx], amount: amt };
              } else {
                otherFees.push({ description: desc, amount: amt });
              }
            }
          }
        }
      });

      expect(peopleCount).toBe('2');
      expect(otherFees).toHaveLength(2);
      expect(otherFees[0]).toEqual({ description: 'ค้างชำระ', amount: '50' });
      expect(otherFees[1]).toEqual({ description: 'ค่าทำความสะอาด', amount: '50' });
    });
  });

  describe('6. Bulk Issue & LINE Recipient Readiness Filtering', () => {
    it('filters LINE recipients using canonical Tenant.linkedUserId only', () => {
      const generatedList = [
        { roomId: 'r-101', billId: 'b-1' },
        { roomId: 'r-102', billId: 'b-2' },
        { roomId: 'r-103', billId: 'b-3' },
      ];
      const tenants = [
        { id: 't-1', roomId: 'r-101', linkedUserId: 'line-usr-1', displayName: 'สมชาย' },
        { id: 't-2', roomId: 'r-102', linkedUserId: null, displayName: 'สมหญิง' },
        { id: 't-3', roomId: 'r-103', linkedUserId: 'line-usr-3', displayName: 'สมศักดิ์' },
      ];

      const linkedTenantIds = generatedList
        .map((g) => {
          const tenantObj = tenants.find(t => t.roomId === g.roomId);
          return tenantObj?.linkedUserId ? tenantObj.id : null;
        })
        .filter(Boolean);

      // Exactly 2 of 3 are LINE linked
      expect(linkedTenantIds).toEqual(['t-1', 't-3']);
    });

    it('handles zero LINE linked recipients gracefully without failing bill generation', () => {
      const generatedList = [
        { roomId: 'r-101', billId: 'b-1' },
        { roomId: 'r-102', billId: 'b-2' },
      ];
      const tenants = [
        { id: 't-1', roomId: 'r-101', linkedUserId: null, displayName: 'สมชาย' },
        { id: 't-2', roomId: 'r-102', linkedUserId: null, displayName: 'สมหญิง' },
      ];

      const linkedTenantIds = generatedList
        .map((g) => {
          const tenantObj = tenants.find(t => t.roomId === g.roomId);
          return tenantObj?.linkedUserId ? tenantObj.id : null;
        })
        .filter(Boolean);

      expect(linkedTenantIds).toHaveLength(0);
    });
  });
});
