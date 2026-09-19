/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — SubView: Invoice (ใบแจ้งหนี้)
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Building as BuildingIcon,
  FileText,
  Coins,
  Check
} from 'lucide-react';
import { Bill, filterNonZeroBillItems } from '../../../types';
import { TierBreakdownView } from '../../../components/bills/TierBreakdownView';
import {
  formatToBeDate,
  formatToBeFullDate,
  formatThaiCycle,
  formatItemDescription,
  formatTenantBillItemLabel,
  getTenantBillItemAmount,
  getCanonicalBillKindLabel
} from '../tenantHelpers';
import { sortCanonicalBillItems } from '../../../utils/billPresentation';
import { formatBaht } from '../../../components/GlobalComponents';

export interface TenantInvoiceViewProps {
  dormitoryName?: string;
  buildingName?: string;
  roomNumber?: string;
  activeUnpaidBill: Bill | null;
  tenantBills: Bill[];
  selectedBillId?: string | null;
  invoiceTab: 'current' | 'history';
  setInvoiceTab: (tab: 'current' | 'history') => void;
  onBack: () => void;
  onGoToPayment: (selectedBillIds?: string[]) => void;
}

export const TenantInvoiceView: React.FC<TenantInvoiceViewProps> = ({
  dormitoryName,
  buildingName,
  roomNumber,
  activeUnpaidBill,
  tenantBills,
  selectedBillId = null,
  invoiceTab,
  setInvoiceTab,
  onBack,
  onGoToPayment,
}) => {
  const [expandedHistoryBillIds, setExpandedHistoryBillIds] = useState<string[]>(() => {
    if (selectedBillId && invoiceTab === 'history') {
      return [selectedBillId];
    }
    return [];
  });

  // Auto-expand selectedBillId in history tab when passed
  useEffect(() => {
    if (selectedBillId && invoiceTab === 'history') {
      setExpandedHistoryBillIds((prev) =>
        prev.includes(selectedBillId) ? prev : [...prev, selectedBillId]
      );
    }
  }, [selectedBillId, invoiceTab]);

  const toggleHistoryBillExpanded = (id: string) => {
    setExpandedHistoryBillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Compute unpaid bills list
  const unpaidBills = useMemo(() => {
    const list = tenantBills.filter((b) => b.status !== 'paid' && b.status !== 'PAID');
    if (list.length === 0 && activeUnpaidBill && activeUnpaidBill.status !== 'paid' && activeUnpaidBill.status !== 'PAID') {
      return [activeUnpaidBill];
    }
    return list;
  }, [tenantBills, activeUnpaidBill]);

  // Selected bill IDs for payment (circular checkboxes)
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>(() => {
    if (selectedBillId && unpaidBills.some((b) => b.id === selectedBillId)) {
      return [selectedBillId];
    }
    return unpaidBills.map((b) => b.id);
  });

  // Synchronize when unpaidBills or selectedBillId changes
  useEffect(() => {
    if (selectedBillId && unpaidBills.some((b) => b.id === selectedBillId)) {
      setSelectedBillIds([selectedBillId]);
    } else if (unpaidBills.length > 0 && selectedBillIds.length === 0) {
      setSelectedBillIds(unpaidBills.map((b) => b.id));
    }
  }, [selectedBillId, unpaidBills]);

  const toggleBillSelection = (id: string) => {
    setSelectedBillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedBills = useMemo(() => {
    return unpaidBills.filter((b) => selectedBillIds.includes(b.id));
  }, [unpaidBills, selectedBillIds]);

  const combinedTotal = useMemo(() => {
    return selectedBills.reduce((sum, b) => sum + Number(b.totalAmount || 0), 0);
  }, [selectedBills]);

  const paidBills = useMemo(() => {
    return tenantBills.filter((b) => b.status === 'paid' || b.status === 'PAID');
  }, [tenantBills]);
  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Subview Header with Flushed Attached Tabs */}
      <div className="bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
            aria-label="ย้อนกลับ"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">ใบแจ้งหนี้</h3>
          <div className="w-7 flex justify-end shrink-0">
            <Calendar className="w-5 h-5 text-slate-400" />
          </div>
        </div>

        {/* Invoice Tabs directly flushed to header */}
        <div className="flex border-t border-gray-100 bg-white">
          <button
            type="button"
            onClick={() => {
              setInvoiceTab('current');
              setExpandedHistoryBillId(null);
            }}
            className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors cursor-pointer ${invoiceTab === 'current'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            เดือนปัจจุบัน
          </button>
          <button
            type="button"
            onClick={() => setInvoiceTab('history')}
            className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors cursor-pointer ${invoiceTab === 'history'
              ? 'border-b-2 border-indigo-600 text-indigo-600'
              : 'text-slate-400 hover:text-slate-600'
              }`}
          >
            ประวัติบิลอื่นๆ
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="p-4 space-y-4 pb-24 overflow-y-auto flex-1">
        {invoiceTab === 'current' ? (
          unpaidBills.length > 0 ? (
            <div className="space-y-4">
              {unpaidBills.map((bill) => {
                const isSelected = selectedBillIds.includes(bill.id);
                return (
                  <div
                    key={bill.id}
                    data-testid={`current-unpaid-bill-${bill.id}`}
                    onClick={() => toggleBillSelection(bill.id)}
                    className={`bg-white rounded-3xl p-5 border transition-all cursor-pointer relative shadow-xs ${isSelected
                      ? 'border-indigo-300 ring-2 ring-indigo-500/20'
                      : 'border-slate-100 hover:border-slate-200'
                      }`}
                  >
                    {/* Bill Card Heading with Circular Checkbox */}
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {/* Circular Checkbox */}
                        <div
                          data-testid={`checkbox-bill-${bill.id}`}
                          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all ${isSelected
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'border-2 border-slate-300 bg-white hover:border-indigo-400'
                            }`}
                        >
                          {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold mb-1">
                            <span>{dormitoryName || 'หอพัก'}</span>
                            <span>•</span>
                            <span className="text-slate-700">ห้อง {roomNumber || '-'}</span>
                          </div>
                          <span className="text-[9px] text-slate-400 font-bold block">
                            ค่าใช้จ่ายเดือน {formatToBeFullDate(bill.createdAt)}
                          </span>
                          <h2 className="text-xl font-black text-slate-900 mt-1 leading-none">
                            ฿ {Number(bill.totalAmount).toLocaleString('th-TH', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </h2>
                          <span className="text-[9px] text-slate-400 block mt-2">
                            กำหนดชำระ: {formatToBeDate(bill.dueDate)}
                          </span>
                        </div>
                      </div>

                      <span className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-orange-50 text-orange-600 shrink-0">
                        รอชำระ
                      </span>
                    </div>

                    {/* Collapsible item details */}
                    <div
                      className="border-t border-slate-100 pt-4 mt-3 space-y-2.5 text-[10px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {sortCanonicalBillItems<BillItem>(bill.items).map((item) => (
                        <div key={item.id || item.description} className="text-slate-600">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-slate-600">{formatTenantBillItemLabel(item)}</span>
                            <span className="font-extrabold text-slate-800 shrink-0">
                              ฿ {getTenantBillItemAmount(item).toLocaleString('th-TH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </span>
                          </div>
                          <TierBreakdownView metadata={item.metadata} unit={item.unit} />
                        </div>
                      ))}

                      <div className="border-t border-slate-100 pt-3 flex justify-between items-center text-[11px] font-black text-indigo-600">
                        <span>ยอดรวม</span>
                        <span>
                          ฿ {Number(bill.totalAmount).toLocaleString('th-TH', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 space-y-3 bg-white border border-slate-100 rounded-3xl p-5 shadow-xs">
              <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-slate-500 font-bold text-xs">ยอดค้างชำระของท่านเป็นศูนย์เรียบร้อย</p>
              <p className="text-[9px] text-slate-400">ไม่มีบิลรอเรียกเก็บในรอบเดือนนี้</p>
            </div>
          )
        ) : (
          /* History Tab: Accordion List (PO Image 3: "ประวัติบิลอื่นๆ ปรับเป็น รายการแบบขยาย ไม่เอาแบบกล่อง") */
          <div className="space-y-3">
            {paidBills.length > 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {paidBills.map((b) => {
                  const isExpanded = expandedHistoryBillIds.includes(b.id);
                  const receipt =
                    (b as any).receipt ||
                    (b.payments || []).find((p: any) => p.status === 'APPROVED' || p.status === 'approved')?.receipt;
                  const cycleTitle = `รอบบิล ${formatThaiCycle(
                    b.cycleId || (b as any).billingCycleId || b.billNumber,
                    (b as any).billingDate || b.createdAt
                  )}`;
                  const billKindTitle = getCanonicalBillKindLabel(b);

                  return (
                    <div key={b.id} data-testid={`history-bill-${b.id}`} className="transition-all">
                      <button
                        type="button"
                        onClick={() => toggleHistoryBillExpanded(b.id)}
                        className="w-full p-4 flex justify-between items-center text-left hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <h5 className="font-extrabold text-slate-800 text-xs truncate">
                              {cycleTitle} • {billKindTitle}
                            </h5>
                            <span className="px-2 py-0.5 rounded-full text-[8px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200/60 shrink-0">
                              ชำระแล้ว
                            </span>
                          </div>
                          <p className="text-[9px] text-slate-400 mt-1">
                            ยอดสุทธิ {formatBaht(b.totalAmount)}
                            {b.billNumber ? ` • เลขที่ ${b.billNumber}` : ''}
                          </p>
                        </div>
                        <div className="p-1 text-slate-400 shrink-0">
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-indigo-600" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-2.5 bg-slate-50/50 animate-in fade-in duration-150">
                          <div className="space-y-2 pt-2 text-[10px]">
                            {sortCanonicalBillItems<BillItem>(b.items).map((item) => (
                              <div key={item.id || item.description} className="text-slate-600">
                                <div className="flex justify-between items-center">
                                  <span className="font-medium text-slate-600">{formatTenantBillItemLabel(item)}</span>
                                  <span className="font-extrabold text-slate-800 shrink-0">
                                    ฿{' '}
                                    {getTenantBillItemAmount(item).toLocaleString('th-TH', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </span>
                                </div>
                                <TierBreakdownView metadata={item.metadata} unit={item.unit} />
                              </div>
                            ))}

                            <div className="border-t border-slate-200 pt-2 flex justify-between items-center text-[10px] font-black text-slate-800">
                              <span>ยอดรวมทั้งสิ้น</span>
                              <span className="text-emerald-700 font-extrabold text-xs">
                                {formatBaht(b.totalAmount)}
                              </span>
                            </div>
                          </div>

                          {receipt && (
                            <div className="pt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  window.open(`/api/v1/receipts/${receipt.id}/html`, '_blank')
                                }
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[9px] rounded-lg transition-colors cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <FileText className="w-3.5 h-3.5" />
                                <span>ดูใบเสร็จรับเงิน ({receipt.receiptNumber || 'PDF'})</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-12 text-slate-400 font-semibold text-xs">
                ไม่มีประวัติการชำระเงินย้อนหลัง
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom Sticky Action Bar (PO Image 2: full-width sticky bottom bar with money icon) */}
      {invoiceTab === 'current' && unpaidBills.length > 0 && (
        <div className="sticky bottom-0 p-4 bg-white/95 backdrop-blur-md border-t border-slate-100 mt-auto z-20 shadow-lg">
          <div className="flex justify-between items-center mb-2 px-1 text-xs">
            <span className="font-extrabold text-slate-600">
              ยอดรวมที่เลือกชำระ ({selectedBills.length} รายการ)
            </span>
            <span className="font-black text-indigo-600 text-sm">
              ฿ {combinedTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <button
            type="button"
            data-testid="btn-invoice-pay"
            disabled={selectedBills.length === 0}
            onClick={() => onGoToPayment(selectedBillIds)}
            className={`w-full py-3.5 font-black text-xs rounded-2xl flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer ${selectedBills.length === 0
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-[0.99]'
              }`}
          >
            <Coins className="w-4 h-4" />
            <span>แจ้งชำระเงิน</span>
          </button>
        </div>
      )}
    </div>
  );
};
