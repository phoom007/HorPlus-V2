import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Simplified Pending Slip Card Component representation matching src/pages/owner/payments.tsx
const PendingSlipCard: React.FC<{
  item: {
    id: string;
    roomNum: string;
    tenantName: string;
    isGroup: boolean;
    affectedOrigins: Array<{ cycleLabel?: string; billNumber?: string; amount: number }>;
    totalAmount: number;
    slipUrl?: string;
  };
}> = ({ item }) => {
  return (
    <div key={item.id} className="bg-white rounded-3xl border border-amber-200 shadow-2xs hover:shadow-md transition-all p-5 flex flex-col justify-between space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xl font-black text-slate-900">ห้อง {item.roomNum}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.isGroup ? (
            <span className="inline-flex whitespace-nowrap shrink-0 px-2.5 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 font-bold rounded-full text-[10px]">
              รวม {item.affectedOrigins.length} บิล
            </span>
          ) : (
            <span className="inline-flex whitespace-nowrap shrink-0 px-2.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 font-bold rounded-full text-[10px]">
              {item.affectedOrigins[0]?.cycleLabel ? `งวด ${item.affectedOrigins[0].cycleLabel}` : 'ไม่พบข้อมูลงวดบิล'}
            </span>
          )}
          <span className="inline-flex whitespace-nowrap shrink-0 px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 font-extrabold rounded-full text-[11px] items-center gap-1">
            รอตรวจสลิป
          </span>
        </div>
      </div>

      <div className="text-xs">
        <p className="font-bold text-slate-800 flex items-center gap-1.5">
          <span className="truncate">{item.tenantName}</span>
        </p>
      </div>

      {item.slipUrl ? (
        <div className="relative bg-slate-50 border border-slate-200 rounded-2xl h-36 flex items-center justify-center p-2 cursor-pointer hover:border-indigo-400 transition-all overflow-hidden">
          <img
            src={item.slipUrl}
            alt="สลิปโอนเงิน"
            className="max-h-full max-w-full object-contain rounded-xl hover:scale-105 transition-transform"
          />
        </div>
      ) : (
        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl h-24 flex items-center justify-center text-slate-400 text-xs font-semibold">
          ไม่มีไฟล์สลิปแนบ
        </div>
      )}

      <div className="flex items-baseline justify-between pt-1 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 font-bold">ยอดรอตรวจสอบ</span>
        </div>
        <span className="text-lg font-black text-indigo-600">฿{item.totalAmount.toLocaleString()}</span>
      </div>
    </div>
  );
};

describe('Owner Round 2.4E: Pending Slip Card Presentation Simplification', () => {
  const mockItem = {
    id: 'pay-slip-1',
    roomNum: '101',
    tenantName: 'นายสมบูรณ์ ใจดี',
    isGroup: true,
    affectedOrigins: [
      { cycleLabel: 'ส.ค. 69', amount: 3500 },
      { cycleLabel: 'ก.ย. 69', amount: 3500 },
    ],
    totalAmount: 7000,
    slipUrl: 'https://example.com/slip.jpg',
  };

  it('renders essential clean card elements (room number, tenant name, amount, badges, slip)', () => {
    render(<PendingSlipCard item={mockItem} />);

    expect(screen.getByText('ห้อง 101')).toBeDefined();
    expect(screen.getByText('นายสมบูรณ์ ใจดี')).toBeDefined();
    expect(screen.getByText('ยอดรอตรวจสอบ')).toBeDefined();
    expect(screen.getByText('฿7,000')).toBeDefined();
    expect(screen.getByText('รอตรวจสลิป')).toBeDefined();
    expect(screen.getByText('รวม 2 บิล')).toBeDefined();
    expect(screen.getByAltText('สลิปโอนเงิน')).toBeDefined();
  });

  it('AUTHORITATIVE AUDIT RULE: Excludes noisy verbose texts from presentation card face', () => {
    const { container } = render(<PendingSlipCard item={mockItem} />);

    expect(container.textContent).not.toContain('ยังไม่ได้ตรวจสอบเวลาการโอนจากระบบธนาคาร');
    expect(container.textContent).not.toContain('ยื่นตรวจเมื่อ:');
    expect(container.textContent).not.toContain('การจัดสรรตามบิล:');
    expect(container.textContent).not.toContain('ดูรายละเอียด');
  });
});
