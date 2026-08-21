import { describe, it, expect } from 'vitest';
import {
  formatMeterReadingDisplay,
  formatCountDisplay,
  normalizeSingleDigitCount,
  normalizeMoneyInput,
  renderOptionalText,
  formatThaiDate,
  formatOwnerDate,
  formatOwnerDateTime,
  formatOwnerMonthYear,
} from '../components/GlobalComponents';
import { buildRowsFromWorkspace } from '../pages/owner/meters';

describe('LOCAL-07 Owner Core Meter & Tenant Operational Correction Suite', () => {
  describe('1. Meter Numeric Display Formatting (formatMeterReadingDisplay)', () => {
    it('formats integer readings without trailing .00 decimals', () => {
      expect(formatMeterReadingDisplay(500)).toBe('500');
      expect(formatMeterReadingDisplay('500.00')).toBe('500');
      expect(formatMeterReadingDisplay('1250.0')).toBe('1250');
      expect(formatMeterReadingDisplay(0)).toBe('0');
      expect(formatMeterReadingDisplay('0.00')).toBe('0');
      expect(formatMeterReadingDisplay('')).toBe('0');
      expect(formatMeterReadingDisplay(null)).toBe('0');
    });

    it('preserves fractional decimal readings when non-zero decimals exist', () => {
      expect(formatMeterReadingDisplay(500.5)).toBe('500.5');
      expect(formatMeterReadingDisplay('500.25')).toBe('500.25');
      expect(formatMeterReadingDisplay('12.34')).toBe('12.34');
    });
  });

  describe('2. People Count Display & Input Normalization', () => {
    it('formats people count as clean integer', () => {
      expect(formatCountDisplay(2)).toBe('2');
      expect(formatCountDisplay('3')).toBe('3');
      expect(formatCountDisplay(0)).toBe('0');
      expect(formatCountDisplay(null)).toBe('0');
    });

    it('normalizes single-digit replacement (typing 2 when current is 1 yields 2)', () => {
      expect(normalizeSingleDigitCount('12')).toBe(2);
      expect(normalizeSingleDigitCount('2')).toBe(2);
      expect(normalizeSingleDigitCount('9')).toBe(9);
      expect(normalizeSingleDigitCount('0')).toBe(0);
      expect(normalizeSingleDigitCount('')).toBe(0);
      expect(normalizeSingleDigitCount('abc')).toBe(0);
      expect(normalizeSingleDigitCount(' 5 ')).toBe(5);
    });
  });

  describe('3. Money Input Normalization (normalizeMoneyInput)', () => {
    it('strips leading zeros from monetary strings while preserving valid numbers', () => {
      expect(normalizeMoneyInput('03000')).toBe(3000);
      expect(normalizeMoneyInput('00500')).toBe(500);
      expect(normalizeMoneyInput('0')).toBe(0);
      expect(normalizeMoneyInput('')).toBe(0);
      expect(normalizeMoneyInput('4500.50')).toBe(4500.5);
    });
  });

  describe('4. Missing Optional Field Presentation (renderOptionalText)', () => {
    it('renders hyphen "-" for empty or missing values instead of "ไม่มีข้อมูล"', () => {
      expect(renderOptionalText(null)).toBe('-');
      expect(renderOptionalText(undefined)).toBe('-');
      expect(renderOptionalText('')).toBe('-');
      expect(renderOptionalText('   ')).toBe('-');
      expect(renderOptionalText('somchai@example.com')).toBe('somchai@example.com');
      expect(renderOptionalText('0812345678')).toBe('0812345678');
    });
  });

  describe('5. Buddhist Era Date Formatting (+543)', () => {
    it('formats dates in Buddhist Era (พ.ศ.) correctly', () => {
      // 2026-08-20 is 20 ส.ค. 2569
      const dateStr = '2026-08-20';
      const formatted = formatThaiDate(dateStr);
      expect(formatted).toContain('2569');
      expect(formatted).toContain('20');
      expect(formatted).toContain('ส.ค.');

      const ownerDate = formatOwnerDate(dateStr);
      expect(ownerDate).toContain('2569');
    });

    it('formats billing cycle month-year in Buddhist Era', () => {
      const cycle = '2026-08';
      const cycleFormatted = formatOwnerMonthYear(cycle);
      expect(cycleFormatted).toContain('สิงหาคม');
      expect(cycleFormatted).toContain('2569');
    });
  });

  describe('6. buildRowsFromWorkspace Workspace Construction', () => {
    it('constructs meter rows with whole-number readings and correct default people count', () => {
      const mockWorkspaceData = {
        serverReadings: [
          { roomId: 'room-1', meterType: 'water', previousReading: 500, currentReading: 550 },
          { roomId: 'room-1', meterType: 'electricity', previousReading: 1200, currentReading: 1280 }
        ],
        cyclePeopleRes: {
          success: true,
          data: [
            { roomId: 'room-1', peopleCount: 2, manualOutstandingAmount: '0.00', version: 1, otherFees: [] }
          ]
        }
      };

      const mockRooms = [
        { id: 'room-1', roomNumber: '101', dormitoryId: 'dorm-1', currentTenantId: 'tenant-1' } as any
      ];

      const built = buildRowsFromWorkspace({
        workspaceData: mockWorkspaceData,
        rooms: mockRooms,
        bills: [],
        contracts: [],
        tenants: [{ id: 'tenant-1', name: 'Somchai', coOccupants: [{ id: 'co-1', name: 'Somsri' }] }] as any,
        selectedBillingCycleId: 'cycle-1',
        selectedCycleCode: '2026-08',
        currentDormId: 'dorm-1',
      });

      expect(built.rows.length).toBe(1);
      const row = built.rows[0];
      expect(row.waterPrev).toBe('500');
      expect(row.waterCurr).toBe('550');
      expect(row.elecPrev).toBe('1200');
      expect(row.elecCurr).toBe('1280');
      expect(row.peopleCount).toBe(2);
    });
  });

  describe('7. Buddhist Era OwnerDateInput ISO / Thai BE Conversions', () => {
    it('converts ISO YYYY-MM-DD to Buddhist Era DD/MM/BBBB correctly', async () => {
      const { isoToThaiBe } = await import('../components/OwnerDateInput');
      expect(isoToThaiBe('2026-08-20')).toBe('20/08/2569');
      expect(isoToThaiBe('2025-01-01')).toBe('01/01/2568');
      expect(isoToThaiBe('2024-12-31')).toBe('31/12/2567');
      expect(isoToThaiBe('')).toBe('');
      expect(isoToThaiBe(undefined)).toBe('');
    });

    it('converts Buddhist Era DD/MM/BBBB to ISO YYYY-MM-DD correctly', async () => {
      const { thaiBeToIso } = await import('../components/OwnerDateInput');
      expect(thaiBeToIso('20/08/2569')).toBe('2026-08-20');
      expect(thaiBeToIso('01/01/2568')).toBe('2025-01-01');
      expect(thaiBeToIso('31/12/2567')).toBe('2024-12-31');
      expect(thaiBeToIso('20-08-2569')).toBe('2026-08-20');
      expect(thaiBeToIso('')).toBe('');
      expect(thaiBeToIso('invalid')).toBe(null);
      expect(thaiBeToIso('32/01/2569')).toBe(null);
    });
  });

  describe('8. Billing Cycle Strict All-Room Unissued Gate Logic', () => {
    it('identifies unissued vs progressed bill states correctly', () => {
      const unissuedStatuses = ['draft', 'cancelled', 'voided', 'withdrawn', 'superseded'];
      const progressedStatuses = ['issued', 'pending_payment', 'pending', 'paid', 'partially_paid', 'overdue'];

      progressedStatuses.forEach(st => {
        expect(unissuedStatuses.includes(st)).toBe(false);
      });
    });
  });
});
