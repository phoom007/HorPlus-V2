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
  onOpenPayment: () => void;
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

  const renderBillCard = (b: Bill) => {
    const paymentsList = b.payments || (b as any).Payment || [];
    const rejectedPay = paymentsList.find((p: any) => p.status === 'REJECTED');
    const approvedPay = paymentsList.find((p: any) => p.status === 'APPROVED' && p.receipt);
    const isPaid = b.status === 'PAID' || b.status === 'paid' || b.status === 'settled' || b.status === 'SETTLED';
    const billKindTitle = getCanonicalBillKindLabel(b);
    const paidTimestamp = b.paidAt || approvedPay?.paymentDate || approvedPay?.reviewedAt || paymentsList.find((p: any) => p.status === 'APPROVED' || p.status === 'approved')?.paymentDate || paymentsList[0]?.paymentDate;
    const formattedPaidTime = isPaid && paidTimestamp ? formatPaymentDateTime(paidTimestamp) : null;

    return (
      <div
        key={b.id}
        className="p-4 bg-white border border-slate-100 rounded-2xl space-y-3 shadow-2xs"
      >
        <div className="flex justify-between items-start gap-3">
          <div>
            <h5 className="font-black text-slate-800 text-xs">
              {billKindTitle} (ยอดรวม {formatBaht(b.totalAmount)})
            </h5>
            <p className="text-[9px] text-slate-400 mt-0.5">
              เลขที่: {b.billNumber || b.id.slice(0, 8)} • รอบประจำเดือน {formatThaiCycle(b.cycleId || (b as any).billingCycleId || b.billNumber, (b as any).billingDate || b.createdAt)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              {renderBillStatusBadge(b.status)}
              {formattedPaidTime && (
                <span className="text-slate-500 font-bold flex items-center gap-1 text-[9px]">
                  <span>•</span>
                  <span>ชำระเมื่อ {formattedPaidTime}</span>
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 flex flex-col items-end gap-2">
            {isPaid && approvedPay?.receipt ? (
              <div className="flex flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    window.open(`/api/v1/receipts/${approvedPay.receipt.id}/html`, '_blank')
                  }
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>ดูใบเสร็จ ({approvedPay.receipt.receiptNumber})</span>
                </button>
                <button
                  type="button"
                  data-testid={`btn-bill-detail-${b.id}`}
                  onClick={() => onOpenInvoice(b.id)}
                  className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[9px] rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                >
                  <FileText className="w-3 h-3" />
                  <span>รายละเอียด</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid={`btn-bill-detail-${b.id}`}
                onClick={() => onOpenInvoice(b.id)}
                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[9px] rounded-lg transition-colors cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 inline mr-1" />
                รายละเอียด
              </button>
            )}
          </div>
        </div>

        {rejectedPay && !isPaid && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1.5 text-[9px]">
            <div className="flex items-center justify-between text-rose-800 font-bold">
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                ถูกปฏิเสธสลิป: {rejectedPay.rejectedReason || 'สลิปไม่ชัดเจน กรุณาแนบภาพใหม่'}
              </span>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={onOpenPayment}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white font-black text-[9px] rounded-lg transition-colors cursor-pointer shadow-2xs"
              >
                แนบสลิปใหม่ (Resubmit)
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="pb-20 animate-in fade-in duration-200">
      {/* Subview Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">บิลและการชำระเงิน</h3>
        <div className="w-7 flex justify-end shrink-0">
          <FileText className="w-5 h-5 text-slate-400" />
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
              <div className="p-4 bg-emerald-50/50 border border-emerald-100 rounded-2xl text-center">
                <p className="text-[11px] font-bold text-emerald-700">
                  ✓ ไม่มีรายการบิลค้างชำระในขณะนี้
                </p>
              </div>
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

        {tenantBills.length === 0 && (
          <p className="text-center py-12 text-slate-400 font-semibold text-xs">
            ยังไม่มีบิลค่าน้ำไฟหรือค่าเช่าออกให้ตรวจสอบ
          </p>
        )}
      </div>
    </div>
  );
};
