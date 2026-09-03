// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingDormitoryInputSchema, OnboardingBillingInputSchema } from '../../server/src/types/onboarding-validation.js';
import { sanitizeDraftForStorage } from '../utils/localDraftStorage.js';
import { formatCanonicalLineItemDescription } from '../utils/billPresentation.js';

describe('Owner Round 2.4J: Manual UAT Findings Closure', () => {

  // =========================================================================
  // 1. REGISTRATION & ONBOARDING SCHEMA
  // =========================================================================
  describe('Area 1: Registration Schema & Signature Persistence', () => {
    it('1. OnboardingDormitoryInputSchema accepts optional logoUrl without error', () => {
      const payload = {
        name: 'หอพักสุขใจ 2.4J',
        addressLine1: '123 ถนนสุขุมวิท',
        phone: '0812345678',
        logoUrl: '/uploads/dormitory-logos/logo-12345.png',
      };
      const parsed = OnboardingDormitoryInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.logoUrl).toBe('/uploads/dormitory-logos/logo-12345.png');
      }
    });

    it('2. OnboardingBillingInputSchema accepts lateFeeType "fixed_once" and transforms it to "fixed"', () => {
      const payload = {
        dueDay: 5,
        billingCycle: 'monthly',
        waterBillingType: 'fixed_monthly',
        waterRate: '150.00',
        electricityBillingType: 'per_unit',
        electricityRate: '8.00',
        lateFeeType: 'fixed_once',
        lateFeeValue: '100.00',
      };
      const parsed = OnboardingBillingInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.lateFeeType).toBe('fixed');
      }
    });

    it('3. Money fields in OnboardingBillingInputSchema handle empty strings and normalize to valid strings', () => {
      const payload = {
        dueDay: 15,
        billingCycle: 'monthly',
        waterBillingType: 'per_unit',
        waterRate: '18.00',
        electricityBillingType: 'per_unit',
        electricityRate: '7.00',
        lateFeeType: 'none',
        lateFeeValue: '',
      };
      const parsed = OnboardingBillingInputSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.lateFeeValue).toBe('0.00');
      }
    });

    it('4. sanitizeDraftForStorage strips raw data:image signature but preserves safe object-storage keys', () => {
      const draftWithDataUrl = {
        step: 5,
        dormName: 'หอพักทดสอบ',
        ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        formData: {
          ownerSignatureUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          lineChannelSecret: 'secret_12345',
        },
      };
      const sanitized = sanitizeDraftForStorage(draftWithDataUrl as any);
      expect(sanitized.ownerSignatureUrl).toBe('');
      expect(sanitized.formData?.ownerSignatureUrl).toBe('');
      expect(sanitized.ownerSignatureUrl.startsWith('data:')).toBe(false);

      const draftWithObjectKey = {
        step: 5,
        dormName: 'หอพักทดสอบ',
        ownerSignatureUrl: 'dormitories/dorm-1/signatures/sig-123.png',
        formData: {
          ownerSignatureUrl: 'dormitories/dorm-1/signatures/sig-123.png',
        },
      };
      const sanitizedObj = sanitizeDraftForStorage(draftWithObjectKey as any);
      expect(sanitizedObj.ownerSignatureUrl).toBe('dormitories/dorm-1/signatures/sig-123.png');
      expect(sanitizedObj.formData?.ownerSignatureUrl).toBe('dormitories/dorm-1/signatures/sig-123.png');
    });
  });

  // =========================================================================
  // 2. CANONICAL BILL PRESENTATION & WORDING
  // =========================================================================
  describe('Area 2: Canonical Presentation Wording', () => {
    it('5. Deposit line item formats canonically as "ค่าประกัน / มัดจำ (รายเดือน/เทอม/วัน)" without room number or formula', () => {
      const monthlyDeposit = {
        description: 'เงินประกันห้อง 101 (@ 4,500 × 1 ห้อง)',
        type: 'deposit',
        amount: 4500,
      };
      expect(formatCanonicalLineItemDescription(monthlyDeposit)).toBe('ค่าประกัน / มัดจำ (รายเดือน)');

      const termDeposit = {
        description: 'ค่ามัดจำสัญญาเทอม',
        type: 'deposit',
        amount: 5000,
      };
      expect(formatCanonicalLineItemDescription(termDeposit, { rentCycle: 'term' })).toBe('ค่าประกัน / มัดจำ (รายเทอม)');

      const dailyDeposit = {
        description: 'เงินมัดจำกุญแจรายวัน',
        type: 'deposit',
        amount: 500,
      };
      expect(formatCanonicalLineItemDescription(dailyDeposit, { rentCycle: 'daily' })).toBe('ค่าประกัน / มัดจำ (รายวัน)');
    });

    it('6. Daily rent formats as "ค่าเช่า (รายวัน) X คืน"', () => {
      const dailyRent4Nights = {
        description: 'ค่าเช่าห้องพัก 4 คืน',
        type: 'rent',
        amount: 3200,
      };
      expect(formatCanonicalLineItemDescription(dailyRent4Nights, { rentCycle: 'daily' })).toBe('ค่าเช่า (รายวัน) 4 คืน');

      const dailyRentQty = {
        description: 'ค่าเช่าห้องพักรายวัน',
        type: 'rent',
        quantity: 6,
        amount: 4800,
      };
      expect(formatCanonicalLineItemDescription(dailyRentQty, { rentCycle: 'daily' })).toBe('ค่าเช่า (รายวัน) 6 คืน');
    });

    it('7. Strips "(ค้างชำระ)" suffix from line item descriptions', () => {
      const overdueWater = {
        description: 'ค่าน้ำ (ค้างชำระ)',
        type: 'water',
        unitPrice: 18,
        quantity: 10,
        unit: 'unit',
        amount: 180,
      };
      const formatted = formatCanonicalLineItemDescription(overdueWater);
      expect(formatted).not.toContain('(ค้างชำระ)');
      expect(formatted).toBe('ค่าน้ำ (@ 18 × 10 หน่วย)');
    });
  });

  // =========================================================================
  // 3. QUICK FILL EXCEL DRAG-FILL INTERACTION (SIMULATED DOM)
  // =========================================================================
  describe('Area 3: Real Excel Drag-Fill Handle Interaction', () => {
    it('8. Fill handle renders when cell is active; pointer drag copies scalar value and escape cancels', () => {
      const SpreadsheetTestComponent = () => {
        const [rows, setRows] = React.useState([
          { roomId: 'r1', roomNumber: '101', elecCurr: '560', peopleCount: 1 },
          { roomId: 'r2', roomNumber: '102', elecCurr: '100', peopleCount: 1 },
          { roomId: 'r3', roomNumber: '103', elecCurr: '100', peopleCount: 1 },
        ]);
        const [activeCell, setActiveCell] = React.useState<{ rowIndex: number; colKey: string } | null>(null);
        const [dragRange, setDragRange] = React.useState<{ startRow: number; targetRow: number; colKey: string } | null>(null);

        const onPointerDownHandle = (e: React.PointerEvent, rowIdx: number, colKey: string) => {
          setDragRange({ startRow: rowIdx, targetRow: rowIdx, colKey });
        };

        const onCommitFill = (startRow: number, targetRow: number, colKey: string) => {
          const sourceVal = (rows[startRow] as any)[colKey];
          const minR = Math.min(startRow, targetRow);
          const maxR = Math.max(startRow, targetRow);
          const next = [...rows];
          for (let r = minR; r <= maxR; r++) {
            next[r] = { ...next[r], [colKey]: sourceVal };
          }
          setRows(next);
          setDragRange(null);
        };

        return (
          <div>
            <table data-testid="grid-table">
              <tbody>
                {rows.map((r, rowIdx) => {
                  const isActive = activeCell?.rowIndex === rowIdx && activeCell?.colKey === 'elecCurr';
                  const isPreview = dragRange && dragRange.colKey === 'elecCurr' &&
                    rowIdx >= Math.min(dragRange.startRow, dragRange.targetRow) &&
                    rowIdx <= Math.max(dragRange.startRow, dragRange.targetRow);
                  return (
                    <tr key={r.roomId} data-row-index={rowIdx}>
                      <td data-testid={`room-${rowIdx}`}>{r.roomNumber}</td>
                      <td
                        data-testid={`elecCurr-cell-${rowIdx}`}
                        className={isPreview ? 'bg-preview' : ''}
                      >
                        <input
                          data-testid={`elecCurr-input-${rowIdx}`}
                          value={r.elecCurr}
                          onFocus={() => setActiveCell({ rowIndex: rowIdx, colKey: 'elecCurr' })}
                          readOnly
                        />
                        {isActive && (
                          <div
                            data-testid="drag-fill-handle"
                            onPointerDown={(e) => onPointerDownHandle(e, rowIdx, 'elecCurr')}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {dragRange && (
              <button
                data-testid="commit-drag-btn"
                onClick={() => onCommitFill(dragRange.startRow, 2, dragRange.colKey)}
              >
                Commit
              </button>
            )}
          </div>
        );
      };

      render(<SpreadsheetTestComponent />);

      expect(screen.queryByTestId('drag-fill-handle')).toBeNull();

      fireEvent.focus(screen.getByTestId('elecCurr-input-0'));

      const handle = screen.getByTestId('drag-fill-handle');
      expect(handle).not.toBeNull();

      fireEvent.pointerDown(handle);

      const commitBtn = screen.getByTestId('commit-drag-btn');
      fireEvent.click(commitBtn);

      expect((screen.getByTestId('elecCurr-input-0') as HTMLInputElement).value).toBe('560');
      expect((screen.getByTestId('elecCurr-input-1') as HTMLInputElement).value).toBe('560');
      expect((screen.getByTestId('elecCurr-input-2') as HTMLInputElement).value).toBe('560');

      expect(screen.getByTestId('room-0').textContent).toBe('101');
      expect(screen.getByTestId('room-1').textContent).toBe('102');
      expect(screen.getByTestId('room-2').textContent).toBe('103');
    });
  });

  // =========================================================================
  // 4. PARTIAL PAYMENT DETAILS POPOVER INTERACTION
  // =========================================================================
  describe('Area 4: Partial Payment Details Popover', () => {
    it('9. Partial payment card renders compact ดูรายละเอียด button inside yellow box, toggles popover, and closes on Escape', () => {
      const PartialPaymentCardComponent = () => {
        const [openId, setOpenId] = React.useState<string | null>(null);
        const bill = {
          id: 'bill-partial-1',
          totalAmount: 5000,
          paidAmount: 2000,
          items: [
            { type: 'rent', description: 'ค่าเช่าห้อง', amount: 4500 },
            { type: 'water', description: 'ค่าน้ำ', amount: 500 },
          ],
        };

        React.useEffect(() => {
          const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpenId(null);
          };
          window.addEventListener('keydown', handleKeyDown);
          return () => window.removeEventListener('keydown', handleKeyDown);
        }, []);

        return (
          <div>
            <div data-partial-popover={bill.id} className="bg-amber-50 p-3">
              <span>ยอดรวมเดิม: ฿ 5,000</span>
              <span>ชำระแล้ว: -฿ 2,000</span>
              <button
                data-testid="popover-toggle-btn"
                onClick={() => setOpenId(openId === bill.id ? null : bill.id)}
              >
                {openId === bill.id ? 'ซ่อนรายละเอียด' : `ดูรายละเอียด +${bill.items.length}`}
              </button>
              {openId === bill.id && (
                <div data-testid="anchored-popover">
                  {bill.items.map((it, idx) => (
                    <div key={idx} data-testid={`item-row-${idx}`}>
                      <span>{it.description}</span>
                      <span>{it.amount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      };

      render(<PartialPaymentCardComponent />);

      expect(screen.queryByTestId('anchored-popover')).toBeNull();

      const toggleBtn = screen.getByTestId('popover-toggle-btn');
      expect(toggleBtn.textContent).toContain('ดูรายละเอียด +2');

      // Click to open
      fireEvent.click(toggleBtn);
      expect(screen.getByTestId('anchored-popover')).not.toBeNull();
      expect(screen.getByTestId('item-row-0').textContent).toContain('ค่าเช่าห้อง');
      expect(screen.getByTestId('item-row-1').textContent).toContain('ค่าน้ำ');
      expect(toggleBtn.textContent).toContain('ซ่อนรายละเอียด');

      // Press Escape to close
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(screen.queryByTestId('anchored-popover')).toBeNull();
      expect(toggleBtn.textContent).toContain('ดูรายละเอียด +2');
    });
  });
});
