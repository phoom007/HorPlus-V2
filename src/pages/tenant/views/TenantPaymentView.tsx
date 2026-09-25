/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — SubView: Payment (แจ้งชำระเงิน + สลิป)
 * Features segmented toggle [พร้อมเพย์ | บัญชีธนาคาร], real bankQrCode, circular bank avatar, and soft neutral styling.
 */

import React, { useState } from 'react';
import {
  DollarSign,
  ChevronLeft,
  AlertCircle,
  Upload,
  Copy,
  Check,
  QrCode,
  CreditCard,
  Building as BuildingIcon,
  X
} from 'lucide-react';
import { Bill } from '../../../types';
import { formatToBeDate, getBankBadgeInfo, formatThaiCycle } from '../tenantHelpers';
import { BankAvatar } from '../components/BankAvatar';
import { ThaiQrLogo } from '../../../components/common/ThaiQrLogo';

export interface TenantPaymentViewProps {
  dormitoryName?: string;
  buildingName?: string;
  roomNumber?: string;
  activeUnpaidBill: Bill | null;
  selectedBills?: Bill[];
  paymentOptions: {
    configured?: boolean;
    promptPayConfigured?: boolean;
    bankTransferConfigured?: boolean;
    promptPayType?: string | null;
    promptPayDisplay?: string | null;
    promptPayAccountName?: string | null;
    qrUrl?: string | null;
    bankCode?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
    bankQrCode?: string | null;
    targetAmount?: string;
  } | null;
  slipFile: File | null;
  setSlipFile: (file: File | null) => void;
  isSubmittingSlip: boolean;
  onSubmitPaymentSlip: () => void;
  onBack: () => void;
  onShowToast: (type: 'success' | 'error', title: string, message: string) => void;
}

export const TenantPaymentView: React.FC<TenantPaymentViewProps> = ({
  dormitoryName,
  buildingName,
  roomNumber,
  activeUnpaidBill,
  selectedBills,
  paymentOptions,
  slipFile,
  setSlipFile,
  isSubmittingSlip,
  onSubmitPaymentSlip,
  onBack,
  onShowToast,
}) => {
  // PO Requirement Q2=A: Default tab is 'promptpay' for immediate scanning with amount preset
  const [selectedPaymentTab, setSelectedPaymentTab] = useState<'promptpay' | 'bank'>('promptpay');
  const [copiedPromptPay, setCopiedPromptPay] = useState(false);
  const [copiedBankAcc, setCopiedBankAcc] = useState(false);

  const effectiveBills = (selectedBills && selectedBills.length > 0)
    ? selectedBills
    : (activeUnpaidBill ? [activeUnpaidBill] : []);

  const totalAmountToPay = effectiveBills.reduce(
    (acc, b) => acc + Number(b.outstandingAmount ?? b.totalAmount ?? 0),
    0
  );

  const handleCopy = (text: string, type: 'promptpay' | 'bank') => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      if (type === 'promptpay') {
        setCopiedPromptPay(true);
        setTimeout(() => setCopiedPromptPay(false), 2000);
      } else {
        setCopiedBankAcc(true);
        setTimeout(() => setCopiedBankAcc(false), 2000);
      }
      onShowToast('success', 'คัดลอกแล้ว', text);
    }
  };

  const rejectedPay = (effectiveBills[0]?.payments || (effectiveBills[0] as any)?.Payment || []).find(
    (p: any) => p.status === 'REJECTED'
  ) || (activeUnpaidBill ? (activeUnpaidBill.payments || (activeUnpaidBill as any).Payment || []).find((p: any) => p.status === 'REJECTED') : null);

  const bankBadge = getBankBadgeInfo(paymentOptions?.bankCode || '');

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      {/* Subview Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">แจ้งชำระเงิน</h3>
        <div className="w-7 flex justify-end shrink-0">
          <DollarSign className="w-5 h-5 text-slate-400" />
        </div>
      </div>
      <div className="p-4 space-y-4 pb-28 overflow-y-auto">
        {/* Bill Total Amount Card */}
        {effectiveBills.length > 0 ? (
          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-2 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 font-bold">
              <span>{dormitoryName || 'หอพัก'}</span>
              <span>•</span>
              <span className="text-slate-700">ห้อง {roomNumber || '-'}</span>
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              ยอดชำระทั้งหมด {effectiveBills.length > 1 ? `(${effectiveBills.length} รายการ)` : ''}
            </p>
            <h2 className="text-3xl font-black text-indigo-600 tracking-tight">
              ฿ {totalAmountToPay.toLocaleString('th-TH', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </h2>
            {effectiveBills.length === 1 ? (
              <p className="text-[9px] text-slate-400 font-medium">
                กำหนดชำระภายใน {formatToBeDate(effectiveBills[0].dueDate)}
              </p>
            ) : (
              <div className="pt-1 flex flex-wrap justify-center gap-1.5">
                {effectiveBills.map((b) => (
                  <span
                    key={b.id}
                    className="px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-slate-100 text-slate-600"
                  >
                    {formatThaiCycle(b.cycleId || (b as any).billNumber, (b as any).createdAt)}: ฿{Number(b.totalAmount).toLocaleString('th-TH')}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-2 text-center">
            <p className="text-[10px] text-slate-500 font-bold">ยอดชำระทั้งหมด</p>
            <h2 className="text-3xl font-black text-emerald-600 tracking-tight">฿ 0.00</h2>
            <p className="text-[9px] text-slate-400 font-medium">ไม่มีบิลค้างชำระในระบบ</p>
          </div>
        )}

        {/* Payment Methods Card with Segmented Toggle (PO Q2=A) */}
        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-4 text-center">
          <div className="flex items-center justify-between">
            <h3 className="font-extrabold text-slate-800 text-xs text-left">ช่องทางการชำระเงิน</h3>
            <span className="px-2 py-0.5 rounded-full text-[8px] font-bold bg-indigo-50 text-indigo-700">
              เลือกวิธีชำระ
            </span>
          </div>

          {/* Segmented Toggle Control */}
          <div className="grid grid-cols-2 p-1 bg-slate-100/80 rounded-2xl gap-1">
            <button
              type="button"
              data-testid="payment-tab-promptpay"
              onClick={() => setSelectedPaymentTab('promptpay')}
              className={`py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${selectedPaymentTab === 'promptpay'
                ? 'bg-white text-indigo-600 shadow-xs ring-1 ring-slate-200/50'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>พร้อมเพย์</span>
            </button>
            <button
              type="button"
              data-testid="payment-tab-bank"
              onClick={() => setSelectedPaymentTab('bank')}
              className={`py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${selectedPaymentTab === 'bank'
                ? 'bg-white text-indigo-600 shadow-xs ring-1 ring-slate-200/50'
                : 'text-slate-500 hover:text-slate-800'
                }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>บัญชีธนาคาร</span>
            </button>
          </div>

          {/* Tab 1: PromptPay View */}
          {selectedPaymentTab === 'promptpay' && (
            <div className="space-y-3 pt-1 animate-in fade-in duration-200">
              {(paymentOptions?.promptPayConfigured || paymentOptions?.configured) &&
                (paymentOptions?.qrUrl || paymentOptions?.promptPayDisplay) ? (
                <>
                  <div className="flex items-center justify-center py-1">
                    <ThaiQrLogo className="h-8 sm:h-9 w-auto max-w-[150px] object-contain mx-auto drop-shadow-2xs" />
                  </div>

                  {paymentOptions?.qrUrl ? (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/70 inline-block shadow-2xs">
                      <img
                        src={paymentOptions.qrUrl}
                        alt="PromptPay QR Code"
                        className="w-48 h-48 mx-auto rounded-xl shadow-xs object-contain"
                      />
                    </div>
                  ) : (
                    <div className="p-8 bg-slate-50 rounded-2xl border border-slate-200/70 text-slate-400 text-xs">
                      ไม่มีภาพ QR Code พร้อมเพย์
                    </div>
                  )}

                  {paymentOptions?.promptPayDisplay && (
                    <div className="inline-flex items-center gap-2 bg-indigo-50/70 border border-indigo-100 rounded-xl px-3.5 py-2 text-[10px]">
                      <span className="text-slate-600 font-bold">PromptPay:</span>
                      <span className="font-black text-indigo-700 text-xs">
                        {paymentOptions.promptPayDisplay}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(paymentOptions.promptPayDisplay || '', 'promptpay')}
                        className="p-1 hover:bg-white rounded-md text-slate-500 hover:text-indigo-600 transition-colors cursor-pointer"
                        title="คัดลอกหมายเลขพร้อมเพย์"
                      >
                        {copiedPromptPay ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )}

                  {paymentOptions?.promptPayAccountName && (
                    <div className="text-center">
                      <p className="text-[11px] text-slate-600 font-medium">
                        ชื่อผู้รับ: <span className="font-bold text-slate-800">{paymentOptions.promptPayAccountName}</span>
                      </p>
                    </div>
                  )}

                  {effectiveBills.length > 0 && (
                    <p className="text-[9px] text-slate-400 font-medium">
                      สแกน QR Code ด้วยแอปธนาคารใดก็ได้ เพื่อชำระยอด ฿{' '}
                      {totalAmountToPay.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-slate-400 py-6">
                  หอพักนี้ยังไม่ได้ตั้งค่าพร้อมเพย์ โปรดเลือกแท็บบัญชีธนาคาร
                </p>
              )}
            </div>
          )}

          {/* Tab 2: Bank Transfer View */}
          {selectedPaymentTab === 'bank' && (
            <div className="space-y-3.5 pt-1 text-center animate-in fade-in duration-200">
              {/* Owner's uploaded bank QR Code if available */}
              {paymentOptions?.bankQrCode ? (
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/70 inline-block shadow-2xs">
                  <p className="text-[10px] text-slate-500 font-bold mb-2">QR Code ธนาคารของหอพัก</p>
                  <img
                    src={paymentOptions.bankQrCode}
                    alt="Bank QR Code"
                    className="w-48 h-48 mx-auto rounded-xl shadow-xs object-contain"
                  />
                </div>
              ) : null}

              {/* Bank Account Details Card with Circular Avatar */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-3 text-left shadow-2xs">
                <div className="flex items-center gap-3 min-w-0">
                  <BankAvatar bankCodeOrName={paymentOptions?.bankCode || ''} size="md" />
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-800 tracking-tight">
                      {paymentOptions?.bankAccountNumber || 'ไม่ระบุเลขที่บัญชี'}
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                      {bankBadge.name} &bull; {paymentOptions?.bankAccountName || 'เจ้าของหอพัก'}
                    </p>
                  </div>
                </div>
                {paymentOptions?.bankAccountNumber && (
                  <button
                    type="button"
                    onClick={() => handleCopy(paymentOptions.bankAccountNumber || '', 'bank')}
                    className="p-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 hover:text-indigo-600 rounded-xl transition-all shrink-0 cursor-pointer shadow-2xs"
                    title="คัดลอกเลขที่บัญชี"
                  >
                    {copiedBankAcc ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {effectiveBills.length > 0 && (
                <p className="text-[9px] text-slate-400 font-medium">
                  โอนเข้าบัญชีธนาคารข้างต้น ยอด{effectiveBills.length > 1 ? 'รวม ' : ' '}฿{' '}
                  {totalAmountToPay.toLocaleString('th-TH', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  {effectiveBills.length > 1 ? ` (รวม ${effectiveBills.length} บิล)` : ''}{' '}
                  และแนบสลิปด้านล่าง
                </p>
              )}
            </div>
          )}
        </div>

        {/* Upload Slip Section */}
        <div className="bg-white rounded-3xl p-5 border border-slate-100 shadow-xs space-y-3 text-left">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-slate-800 flex items-center gap-1.5">
              <Upload className="w-3.5 h-3.5 text-indigo-500" />
              หลักฐานการโอนเงิน (สลิป) *
            </span>
            <span className="text-[9px] text-slate-400">JPG, PNG, WebP, HEIC &le; 5MB (ไม่รับ PDF)</span>
          </div>

          <label className="border border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/5 transition-all rounded-2xl p-4 text-center flex flex-col items-center justify-center cursor-pointer gap-2 bg-slate-50/50 block">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  const selected = e.target.files[0];
                  if (selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')) {
                    if (onShowToast) {
                      onShowToast('error', 'ไม่รองรับไฟล์ PDF', 'ระบบไม่รองรับไฟล์ PDF สำหรับสลิปชำระเงิน กรุณาแนบไฟล์รูปภาพ (JPEG, PNG, WebP, HEIC) เท่านั้น');
                    }
                    e.target.value = '';
                    return;
                  }
                  if (selected.size > 5 * 1024 * 1024) {
                    if (onShowToast) {
                      onShowToast('error', 'ขนาดไฟล์เกินกำหนด', 'ขนาดไฟล์สลิปต้องไม่เกิน 5MB กรุณาเลือกไฟล์รูปภาพใหม่');
                    }
                    e.target.value = '';
                    return;
                  }
                  setSlipFile(selected);
                }
              }}
            />
            {slipFile ? (
              <div className="flex items-center justify-between w-full px-1">
                <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs truncate">
                  <Check className="w-4 h-4 shrink-0" />
                  <span className="truncate max-w-[140px] sm:max-w-[200px]">{slipFile.name}</span>
                  <span className="text-[9px] text-slate-400 font-normal shrink-0">
                    ({(slipFile.size / 1024).toFixed(0)} KB)
                  </span>
                </div>
                <button
                  type="button"
                  data-testid="cancel-slip-button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSlipFile(null);
                  }}
                  className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                  ยกเลิกส่งรูป
                </button>
              </div>
            ) : (
              <>
                <div className="p-2 bg-white rounded-full text-slate-500 shadow-xs">
                  <Upload className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-slate-700 text-xs font-bold">แตะเพื่อเลือกรูปสลิปโอนเงิน</p>
                  <p className="text-slate-400 text-[9px] mt-0.5">หรือถ่ายภาพจากกล้องมือถือ</p>
                </div>
              </>
            )}
          </label>

          {rejectedPay && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-1">
              <div className="flex items-center gap-1.5 text-rose-800 text-[10px] font-bold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>สลิปก่อนหน้านี้ถูกปฏิเสธ</span>
              </div>
              <p className="text-[9px] text-rose-700 pl-5">
                {rejectedPay.rejectionReason || 'โปรดตรวจสอบยอดเงิน หรืออัปโหลดสลิปที่ถูกต้องอีกครั้ง'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Button */}
      <div className="p-4 bg-white/95 backdrop-blur-md border-t border-slate-100 fixed bottom-0 left-0 right-0 max-w-md mx-auto z-40">
        <button
          type="button"
          disabled={effectiveBills.length === 0 || !slipFile || isSubmittingSlip}
          onClick={onSubmitPaymentSlip}
          className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-xs rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
        >
          {isSubmittingSlip ? (
            <span>กำลังส่งหลักฐาน...</span>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              <span>ส่งหลักฐานการชำระเงิน</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
