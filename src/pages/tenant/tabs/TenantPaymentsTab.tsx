/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Tab 3: Payments (ประวัติและสถานะการชำระเงิน)
 * 100% Thai Language badges & grouped sections (บิลค้างชำระ vs ประวัติการชำระเงินแล้ว).
 */

import React from 'react';
import { FileText, ChevronLeft, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { Bill } from '../../../types';
import { formatBaht } from '../../../components/GlobalComponents';
import { formatThaiCycle, getCanonicalBillKindLabel, formatPaymentDateTime } from '../tenantHelpers';

export interface TenantPaymentsTabProps {
  dormitoryName?: string;
  buildingName?: string;
  roomNumber?: string;
  tenantBills: Bill[];
  onOpenInvoice: (billId?: string) => void;
  onOpenPayment: (billId?: string) => void;
  onBack?: () => void;
}

const renderBillStatusBadge = (status: string) => {
  const norm = (status || '').toLowerCase();
  switch (norm) {
    case 'paid':
    case 'settled':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
          ชำระแล้ว
        </span>
      );
    case 'partially_paid':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
          ชำระบางส่วน
        </span>
      );
    case 'unpaid':
    case 'pending':
    case 'issued':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
          รอชำระ
        </span>
      );
    case 'overdue':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-rose-50 text-rose-700 border border-rose-200">
          เกินกำหนด
        </span>
      );
    case 'checking':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-200 animate-pulse">
          รอตรวจสอบสลิป
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-red-50 text-red-700 border border-red-200">
          ปฏิเสธสลิป
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">
          ยกเลิกแล้ว
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold bg-slate-100 text-slate-600 border border-slate-200">
          {status}
        </span>
      );
  }
};

export const TenantPaymentsTab: React.FC<TenantPaymentsTabProps> = ({
  dormitoryName,
  buildingName,
  roomNumber,
  tenantBills,
  hasRoom = Boolean(roomNumber) || (tenantBills && tenantBills.length > 0),
  onOpenInvoice,
  onOpenPayment,
  onBack,
}) => {
  const unpaidBills = tenantBills.filter(
    (b) => !['paid', 'PAID', 'settled', 'SETTLED', 'cancelled', 'CANCELLED'].includes(b.status)
  );
  const paidBills = tenantBills.filter(
    (b) => ['paid', 'PAID', 'settled', 'SETTLED'].includes(b.status)
  );

  if (!hasRoom) {
    return (
      <div className="pb-20 animate-in fade-in duration-200 flex flex-col h-full bg-slate-50">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
          {onBack ? (
            <button
              onClick={onBack}
              className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
              aria-label="ย้อนกลับ"
            >
              <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
            </button>
          ) : (
            <div className="w-7" />
          )}
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">บิลและการชำระเงิน</h3>
          <div className="w-7 flex justify-end shrink-0">
            <FileText className="w-5 h-5 text-indigo-500" />
          </div>
        </div>

        <div className="py-24 text-center flex-1 flex items-center justify-center">
          <p className="text-slate-400 font-semibold text-xs">ยังไม่มีบิลค่าน้ำค่าไฟหรือค่าเช่าให้ตรวจสอบ</p>
        </div>
      </div>
    );
  }

  const renderBillCard = (b: Bill) => {
    const paymentsList = b.payments || (b as any).Payment || [];
    const rejectedPay = paymentsList.find((p: any) => p.status === 'REJECTED');
    const approvedPay = paymentsList.find((p: any) => p.status === 'APPROVED' && p.receipt);
    const isPaid = b.status === 'PAID' || b.status === 'paid' || b.status === 'settled' || b.status === 'SETTLED';
    const hasUnderReviewPayment = paymentsList.some((p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking');
    const isChecking = b.status === 'checking' || hasUnderReviewPayment;
    const isRejected = !isChecking && (b.status === 'rejected' || Boolean(rejectedPay));
    const effectiveStatus = isChecking ? 'checking' : (isRejected ? 'rejected' : b.status);

    const billKindTitle = getCanonicalBillKindLabel(b);
    const paidTimestamp = b.paidAt || approvedPay?.paymentDate || approvedPay?.reviewedAt || paymentsList.find((p: any) => p.status === 'APPROVED' || p.status === 'approved')?.paymentDate || paymentsList[0]?.paymentDate;
    const formattedPaidTime = isPaid && paidTimestamp ? formatPaymentDateTime(paidTimestamp) : null;

    return (
      <div
        key={b.id}
        data-testid={`bill-card-${b.id}`}
        className="bg-white border border-slate-100 rounded-2xl p-4 shadow-3xs hover:border-indigo-200 transition-all space-y-3"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-400">
                {b.invoiceNumber || (b as any).billNumber || `BILL-${b.id.slice(0, 6)}`}
              </span>
              {renderBillStatusBadge(effectiveStatus)}
            </div>
            <h5 className="font-extrabold text-sm text-slate-800 mt-1">
              {billKindTitle}
            </h5>
            <p className="text-[10px] text-slate-500 font-medium">
              รอบบิล: {formatThaiCycle(b.cycleMonth, b.cycleYear)}
            </p>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-bold text-slate-400 block">
              {Number(b.outstandingAmount ?? b.totalAmount) < Number(b.totalAmount) ? 'ยอดค้างชำระ' : 'ยอดรวม'}
            </span>
            <span className="font-black text-sm text-indigo-700">
              {formatBaht(b.outstandingAmount ?? b.totalAmount)}
            </span>
            {Number(b.outstandingAmount ?? b.totalAmount) < Number(b.totalAmount) && (
              <span className="text-[9px] text-slate-400 line-through block">
                {formatBaht(b.totalAmount)}
              </span>
            )}
          </div>
        </div>

        {/* Due Date or Paid Date */}
        <div className="flex items-center justify-between text-[10px] pt-2 border-t border-slate-50">
          {isPaid && formattedPaidTime ? (
            <span className="text-emerald-700 font-bold">
              ชำระเมื่อ {formattedPaidTime}
            </span>
          ) : (
            <span className="text-slate-500 font-medium">
              กำหนดชำระ:{' '}
              <strong className="text-slate-700 font-extrabold">
                {b.dueDate ? new Date(b.dueDate).toLocaleDateString('th-TH') : '-'}
              </strong>
            </span>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`btn-view-invoice-${b.id}`}
              onClick={() => onOpenInvoice(b.id)}
              className="text-[10px] font-bold text-slate-600 hover:text-indigo-600 underline cursor-pointer"
            >
              ดูใบแจ้งหนี้
            </button>

            {!isPaid && (
              isChecking ? (
                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-extrabold text-[10px] rounded-lg border border-indigo-200">
                  รอตรวจสอบ
                </span>
              ) : isRejected ? (
                <button
                  type="button"
                  data-testid={`btn-pay-bill-${b.id}`}
                  onClick={() => onOpenPayment(b.id)}
                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-[10px] rounded-lg shadow-3xs cursor-pointer transition-all active:scale-95"
                >
                  ส่งสลิปใหม่
                </button>
              ) : (
                <button
                  type="button"
                  data-testid={`btn-pay-bill-${b.id}`}
                  onClick={() => onOpenPayment(b.id)}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] rounded-lg shadow-3xs cursor-pointer transition-all active:scale-95"
                >
                  ชำระเงิน
                </button>
              )
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="pb-20 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        {onBack ? (
          <button
            onClick={onBack}
            className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
            aria-label="ย้อนกลับ"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
        ) : (
          <div className="w-7" />
        )}
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">บิลและการชำระเงิน</h3>
        <div className="w-7 flex justify-end shrink-0">
          <FileText className="w-5 h-5 text-indigo-500" />
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Section 1: บิลค้างชำระ (Unpaid Bills) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
              บิลค้างชำระ ({unpaidBills.length})
            </h4>
          </div>

          <div className="space-y-3">
            {unpaidBills.map((b) => renderBillCard(b))}

            {unpaidBills.length === 0 && (
              <p className="text-center py-6 text-slate-400 font-semibold text-xs bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
                ยังไม่มีรายการบิลค้างชำระ
              </p>
            )}
          </div>
        </div>

        {/* Section 2: ประวัติการชำระเงินแล้ว (Paid Payment History) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
              ประวัติการชำระเงินแล้ว ({paidBills.length})
            </h4>
          </div>

          <div className="space-y-3">
            {paidBills.map((b) => renderBillCard(b))}

            {paidBills.length === 0 && (
              <p className="text-center py-6 text-slate-400 font-semibold text-xs bg-slate-50/60 rounded-2xl border border-dashed border-slate-200">
                ยังไม่มีประวัติบิลที่ชำระเงินแล้ว
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
