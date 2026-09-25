/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — SubView: Contract & Documents (เอกสารสัญญา)
 */

import React, { useState } from 'react';
import {
  ChevronLeft,
  FileText,
  Calendar,
  CheckCircle2,
  Download,
  AlertCircle,
  Clock,
  XCircle
} from 'lucide-react';
import { Contract, Tenant } from '../../../types';
import {
  formatToBeDate,
  formatToBeFullDate,
  getContractDurationMonths,
  calculateContractEndDate,
  openTenantContractPrintWindow,
  openTenantIdCardPrintWindow
} from '../tenantHelpers';
import { TenantBottomSheet } from '../components/TenantBottomSheet';
import { OwnerDateInput } from '../../../components/OwnerDateInput';
import { sanitizeContractTerms } from '../../../utils/contract-terms-sanitizer';

export interface TenantContractViewProps {
  tenantContracts: Contract[];
  tenant: Tenant;
  tenantRoom: any;
  dormitory?: any;
  renewalEligibility: any;
  requestedStartDate: string;
  setRequestedStartDate: (d: string) => void;
  requestedDurationMonths: number;
  setRequestedDurationMonths: (m: number) => void;
  isSubmittingRenewal: boolean;
  handleSubmitRenewal: () => void;
  unpaidBalance?: number;
  onCancelRenewal?: () => Promise<void> | void;
  isCancellingRenewal?: boolean;
  hasRoom?: boolean;
  onOpenDocModal: (doc: any) => void;
  handleDownloadDoc: (title: string, fileName: string, content: string, docType?: string, docId?: string) => void;
  onUploadIdCard?: (file: File) => void;
  onBack: () => void;
}

export const TenantContractView: React.FC<TenantContractViewProps> = ({
  tenantContracts,
  tenant,
  tenantRoom,
  dormitory,
  renewalEligibility,
  requestedStartDate,
  setRequestedStartDate,
  requestedDurationMonths,
  setRequestedDurationMonths,
  isSubmittingRenewal,
  handleSubmitRenewal,
  unpaidBalance = 0,
  onCancelRenewal,
  isCancellingRenewal = false,
  hasRoom = Boolean(tenantRoom || tenantContracts.length > 0),
  onOpenDocModal,
  handleDownloadDoc,
  onUploadIdCard,
  onBack,
}) => {
  if (!hasRoom || (!tenantRoom && tenantContracts.length === 0)) {
    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
          <button
            onClick={onBack}
            className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
            aria-label="ย้อนกลับ"
          >
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">เอกสารสัญญา</h3>
          <div className="w-7 flex justify-end shrink-0">
            <FileText className="w-5 h-5 text-indigo-500" />
          </div>
        </div>

        <div className="py-24 text-center flex-1 flex items-center justify-center">
          <p className="text-slate-400 font-semibold text-xs">ยังไม่มีเอกสารสัญญาในระบบ</p>
        </div>
      </div>
    );
  }
  const [isRenewalSheetOpen, setIsRenewalSheetOpen] = useState(false);
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const initialRenewalPlan = tenantContracts.some(
    (c) => c.rentBillingType === 'term' || (c as any).rentalType === 'TERM' || (tenant as any)?.rentalType === 'TERM'
  ) ? 'term' : 'monthly';
  const [renewalRentPlan, setRenewalRentPlan] = useState<'term' | 'monthly'>(initialRenewalPlan);

  const isPendingRenewal =
    renewalEligibility?.reasonCode === 'RENEWAL_REQUEST_ALREADY_PENDING' ||
    renewalEligibility?.pendingRequest ||
    renewalEligibility?.activeRenewalRequest;

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Subview Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">เอกสารสัญญา</h3>
        <div className="w-7 flex justify-end shrink-0">
          <FileText className="w-5 h-5 text-indigo-500" />
        </div>
      </div>

      <div className="p-4 space-y-4 pb-20 overflow-y-auto">
        {tenantContracts.map((con) => {
          const minRenewalDate = con.endDate
            ? (() => {
                const d = new Date(con.endDate);
                d.setDate(d.getDate() + 1);
                return d.toISOString().split('T')[0];
              })()
            : '';
          const effectiveStartDate =
            requestedStartDate && (!minRenewalDate || requestedStartDate >= minRenewalDate)
              ? requestedStartDate
              : minRenewalDate || (con.endDate ? String(con.endDate).split('T')[0] : '');
          const calculatedEndDate = calculateContractEndDate(
            effectiveStartDate,
            requestedDurationMonths
          );

          const effectiveTermMonths = Number(
            tenantRoom?.building?.termMonths ??
            tenantRoom?.termMonths ??
            dormitory?.termMonths ??
            (con.rentBillingType === 'term' ? con.durationMonths : null) ??
            6
          );
          const monthlyRent = Number(
            tenantRoom?.monthlyRent ||
            tenantRoom?.building?.monthlyRent ||
            con.monthlyRent ||
            con.rentAmount ||
            0
          );
          const termRent = Number(
            tenantRoom?.termRent ||
            tenantRoom?.building?.termRent ||
            (con as any).termRent ||
            (con.rentBillingType === 'term' ? con.rentAmount : 0) ||
            (monthlyRent * effectiveTermMonths) ||
            0
          );
          const totalRent = renewalRentPlan === 'monthly'
            ? monthlyRent * requestedDurationMonths
            : (requestedDurationMonths === effectiveTermMonths
                ? termRent
                : Math.round((termRent / (effectiveTermMonths || 1)) * requestedDurationMonths));

          return (
            <div key={con.id} className="space-y-4">
              {/* Main Contract Spec Card */}
              <div className="bg-white p-5 border border-slate-100 rounded-3xl space-y-4 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl shrink-0">
                      <FileText className="w-5 h-5 stroke-[2.2]" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-900 text-xs truncate">สัญญาเช่าห้อง</h4>
                      <p className="text-[9px] text-slate-400 mt-0.5 truncate">
                        ห้อง {con.roomNumber || tenantRoom?.roomNumber || '-'} • {con.contractNumber}
                      </p>
                    </div>
                  </div>

                  {/* Top-Right Contract Renewal Action Button (PO Image 4) */}
                  {isPendingRenewal ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-[9px] font-extrabold flex items-center gap-1">
                        <Clock className="w-3 h-3 text-amber-600" />
                        รออนุมัติต่อสัญญา
                      </span>
                      <button
                        type="button"
                        data-testid="btn-open-cancel-sheet"
                        onClick={() => setIsCancelConfirmOpen(true)}
                        className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 border border-rose-200 rounded-xl text-[9px] font-extrabold transition-all shadow-xs cursor-pointer flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" />
                        ยกเลิกคำขอ
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="btn-open-renewal-sheet"
                      onClick={() => {
                        const isTermCon = con.rentBillingType === 'term' || (con as any).rentalType === 'TERM' || (tenant as any)?.rentalType === 'TERM';
                        const plan = isTermCon ? 'term' : 'monthly';
                        setRenewalRentPlan(plan);
                        const effTerm = Number(
                          tenantRoom?.building?.termMonths ??
                          tenantRoom?.termMonths ??
                          dormitory?.termMonths ??
                          (con.rentBillingType === 'term' ? con.durationMonths : null) ??
                          6
                        );
                        setRequestedDurationMonths(plan === 'term' ? effTerm : 1);
                        if (minRenewalDate) {
                          setRequestedStartDate(minRenewalDate);
                        }
                        setIsRenewalSheetOpen(true);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-[10px] font-extrabold transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      ส่งคำขอต่อสัญญา
                    </button>
                  )}
                </div>

                {!isPendingRenewal && renewalEligibility?.latestRejectedRequest && (
                  <div
                    data-testid="renewal-rejected-banner"
                    className="p-3 bg-rose-50 border border-rose-200/80 rounded-2xl flex items-start gap-2.5 text-rose-800"
                  >
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 text-[10px] leading-relaxed">
                      <p className="font-extrabold text-rose-900">คำขอต่อสัญญาล่าสุดไม่ผ่านการอนุมัติ</p>
                      {renewalEligibility.latestRejectedRequest.rejectionReason && (
                        <p className="text-rose-700 font-semibold" data-testid="renewal-rejected-reason">
                          เหตุผล: {renewalEligibility.latestRejectedRequest.rejectionReason}
                        </p>
                      )}
                      <p className="text-rose-600/90 text-[9px]">คุณสามารถกดปุ่ม &quot;ส่งคำขอต่อสัญญา&quot; เพื่อยื่นคำขอใหม่ได้ทันที</p>
                    </div>
                  </div>
                )}

                {/* Details grid list */}
                <div className="border-t border-slate-100 pt-4 space-y-3 text-[10px] leading-none text-slate-600">
                  <div className="flex justify-between items-center">
                    <span>เลขที่สัญญา</span>
                    <span className="font-extrabold text-slate-800" data-testid="contract-number">
                      {con.contractNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>วันที่เริ่มสัญญา</span>
                    <span className="font-extrabold text-slate-800">
                      {formatToBeFullDate(con.startDate)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>วันที่สิ้นสุดสัญญา</span>
                    <span className="font-extrabold text-slate-800">
                      {formatToBeFullDate(con.endDate)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>ระยะเวลา</span>
                    <span className="font-extrabold text-slate-800">
                      {getContractDurationMonths(con.startDate, con.endDate)} เดือน
                    </span>
                  </div>
                </div>

                {/* Expired Contract Banner (Card C4 / PO-12 / OQ-27) */}
                {(con.status === 'expired' || (con.endDate && new Date(con.endDate).getTime() < new Date().getTime())) && (
                  <div
                    data-testid="tenant-contract-expired-view-banner"
                    className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl flex items-start gap-2.5 text-amber-800"
                  >
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 text-[10px] leading-relaxed">
                      <p className="font-extrabold text-amber-900">สัญญาเช่าสิ้นสุดแล้ว</p>
                      <p className="text-amber-800">
                        สัญญาเช่าฉบับนี้สิ้นสุดลงแล้วเมื่อ {formatToBeFullDate(con.endDate)} คุณยังคงสามารถเข้าใช้งานพอร์ทัล ดูบิล ชำระเงิน หรือแจ้งย้ายออกได้ตามปกติ
                      </p>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100">
                  {con.status === 'approved_scheduled' ? (
                    <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200/50 rounded-full text-[9px] font-bold">
                      อนุมัติแล้ว — รอวันเริ่มสัญญา • เริ่มวันที่ {formatToBeFullDate(con.startDate)}
                    </span>
                  ) : con.status === 'cancelled' ? (
                    <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200/50 rounded-full text-[9px] font-bold">
                      สถานะ: สัญญายกเลิก
                    </span>
                  ) : con.status === 'expired' || (con.endDate && new Date(con.endDate).getTime() < new Date().getTime()) ? (
                    <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200/50 rounded-full text-[9px] font-bold" data-testid="tenant-contract-expired-badge">
                      สถานะ: สัญญาหมดอายุแล้ว
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-full text-[9px] font-bold">
                      สถานะ: กำลังพักอาศัย / สัญญาปัจจุบัน
                    </span>
                  )}
                </div>
              </div>

              {/* Official Thai Contract Agreement Preview */}
              <div className="bg-white p-5 border border-slate-100 rounded-3xl space-y-4 shadow-xs font-sarabun text-xs leading-relaxed text-slate-800">
                <div className="text-center space-y-1 pb-3 border-b border-slate-100">
                  <h3 className="font-bold text-sm text-slate-900 tracking-tight">
                    หนังสือสัญญาเช่าห้องพักอาศัย
                  </h3>
                  <p className="text-[10px] text-slate-500 italic">
                    ทำที่: {dormitory?.name || 'HorPlus Residence'} ({dormitory?.address || 'อาคารพักอาศัยส่วนบุคคล'})
                  </p>
                  <p className="text-[10px] font-bold text-slate-700">
                    วันที่ทำสัญญา: {formatToBeFullDate(con.startDate)}
                  </p>
                </div>

                <div className="space-y-3 text-justify">
                  <p>
                    <span className="font-bold">สัญญาฉบับนี้ทำขึ้นระหว่าง</span> <span className="font-bold text-indigo-900">{dormitory?.ownerName || dormitory?.name || 'ผู้ให้เช่า'}</span> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <span className="font-bold text-indigo-900">{tenant.displayName || ((tenant as any).prefix && !tenant.name.startsWith((tenant as any).prefix) ? `${(tenant as any).prefix} ${tenant.name}` : (tenant.name?.startsWith('คุณ') || /^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)/i.test(tenant.name) ? tenant.name : `คุณ ${tenant.name}`))}</span> ถือบัตรประชาชนเลขที่ <span className="font-bold text-indigo-900">{tenant.citizenId || '-'}</span> เบอร์โทรศัพท์ <span className="font-bold text-indigo-900">{tenant.phone || '-'}</span> ("ผู้เช่า") อีกฝ่ายหนึ่ง โดยมีข้อตกลงสำคัญดังต่อไปนี้:
                  </p>

                  <div className="space-y-2 text-slate-700">
                    <p>
                      <span className="font-bold text-slate-900">ข้อ 1. ทรัพย์สินที่เช่า:</span> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <span className="font-bold text-indigo-900">ห้อง {con.roomNumber || tenantRoom?.roomNumber || '-'}</span> ของอาคาร <span className="font-bold text-indigo-900">{dormitory?.name || 'หอพัก'}</span> พร้อมอุปกรณ์ เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า และสิ่งอำนวยความสะดวกในสภาพเรียบร้อยสมบูรณ์
                    </p>

                    <p>
                      <span className="font-bold text-slate-900">ข้อ 2. อัตราค่าเช่า เงินประกัน และการคืนเงิน:</span> ผู้เช่าตกลงชำระค่าเช่าในอัตรา <span className="font-bold text-indigo-900">฿ {Number(con.monthlyRent || (con as any).rentAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาทต่อ{con.terms?.includes('เทอม') ? 'เทอม' : (con as any).rentPlan === 'daily' ? 'วัน' : 'เดือน'}</span> กำหนดชำระตามรอบบิลที่หอพักกำหนด พร้อมวางเงินประกันความเสียหายจำนวน <span className="font-bold text-indigo-900">฿ {Number(con.depositAmount || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span> โดยเงินประกันนี้จะได้รับคืนเมื่อสิ้นสุดสัญญาเช่า หลังจากหักค่าใช้จ่ายค้างชำระ หนี้สิน หรือค่าความเสียหายต่อทรัพย์สิน (ถ้ามี) ตามระเบียบและเงื่อนไขที่หอพักกำหนด
                    </p>

                    <p>
                      <span className="font-bold text-slate-900">ข้อ 3. ระยะเวลาการเช่า:</span> สัญญานี้มีกำหนดระยะเวลา <span className="font-bold text-indigo-900">{getContractDurationMonths(con.startDate, con.endDate)} {(con as any).rentPlan === 'daily' ? 'วัน' : 'เดือน'}</span> โดยเริ่มต้นตั้งแต่วันที่ <span className="font-bold text-indigo-900">{formatToBeFullDate(con.startDate)}</span> ถึงวันที่ <span className="font-bold text-indigo-900">{formatToBeFullDate(con.endDate)}</span>
                    </p>

                    <p>
                      <span className="font-bold text-slate-900">ข้อ 4. ยานพาหนะ สัตว์เลี้ยง และการใช้พื้นที่ส่วนกลาง:</span> ผู้เช่าตกลงปฏิบัติตามระเบียบการจอดยานพาหนะ การนำสัตว์เลี้ยงเข้าพัก (หากหอพักอนุญาต) และการใช้พื้นที่ส่วนกลาง โดยต้องบันทึกข้อมูลยานพาหนะและสัตว์เลี้ยงลงในระบบของหอพักให้ถูกต้องตรงตามความเป็นจริง
                    </p>

                    <p>
                      <span className="font-bold text-slate-900">ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:</span> ผู้เช่าตกลงแจ้งข้อมูลผู้พักอาศัยในห้องพักตามความเป็นจริง โดยในวันทำสัญญามีผู้เช่าหลักและผู้พักอาศัยร่วม รวมทั้งสิ้น <span className="font-bold text-indigo-900">{con.occupantCount || (1 + (tenant.coOccupants?.length || 0))} คน</span> หากมีการเปลี่ยนแปลงหรือมีผู้พักอาศัยร่วมเพิ่มเติมในภายหลัง ผู้เช่าจะต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าและบันทึกข้อมูลลงในระบบตามระเบียบของหอพัก
                    </p>

                    <div className="pt-2 border-t border-slate-100 space-y-1">
                      <p className="font-bold text-slate-900">
                        ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:
                      </p>
                      <div className="whitespace-pre-line text-slate-600 text-[11px] leading-relaxed">
                        {sanitizeContractTerms(dormitory?.rules || con.terms) || 'ปฏิบัติตามกฎระเบียบของหอพักอย่างเคร่งครัด รักษาความสะอาด และห้ามก่อความเดือดร้อนรำคาญต่อผู้อื่น'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Digital Signature Block */}
                <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4 text-center font-sarabun">
                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500 font-bold">ลงชื่อ (ผู้ให้เช่า)</p>
                    <div className="h-12 flex items-center justify-center overflow-hidden">
                      {((con as any)?.ownerSignature || dormitory?.ownerSignature) ? (
                        <img
                          src={(con as any)?.ownerSignature || dormitory?.ownerSignature}
                          alt="ลายเซ็นผู้ให้เช่า"
                          className="h-10 object-contain mx-auto"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400 select-none">ผู้ให้เช่าลงนามแล้ว</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-800 font-bold">({dormitory?.ownerName || dormitory?.name || 'ผู้ให้เช่า'})</p>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[10px] text-slate-500 font-bold">ลงชื่อ (ผู้เช่า)</p>
                    <div className="h-12 flex items-center justify-center overflow-hidden">
                      {((con as any)?.tenantSignature || (tenant as any)?.signatureUrl || (tenant as any)?.signatureMock) ? (
                        <img
                          src={(con as any)?.tenantSignature || (tenant as any)?.signatureUrl || (tenant as any)?.signatureMock}
                          alt="ลายเซ็นผู้เช่า"
                          className="h-10 object-contain mx-auto"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-500 font-medium">ลงนามดิจิทัลแล้ว</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-800 font-bold">
                      ({tenant.name})
                    </p>
                  </div>
                </div>
              </div>

              {/* Action downloadable attachments section (PO Image 2 & 3: Direct Print/PDF opening) */}
              <div className="space-y-3.5">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] font-black text-slate-900">เอกสารของฉัน</h4>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && onUploadIdCard) {
                        onUploadIdCard(file);
                      }
                    }}
                  />
                </div>

                <div className="space-y-2.5">
                  {(() => {
                    const hasIdPhoto = Boolean(
                      (tenant as any).hasIdentityDocument ||
                      (tenant.idCardPhotoMock && tenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64' && tenant.idCardPhotoMock.trim() !== '') ||
                      (tenant as any).idCardPhotoUrl ||
                      (tenant as any).photoUrl
                    );
                    const idPhotoUrl = (tenant as any).idCardPhotoUrl || (tenant.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64' ? tenant.idCardPhotoMock : null) || (tenant as any).photoUrl;

                    const documents = [
                      {
                        title: `เอกสารสัญญาเช่า (เลขที่ ${con.contractNumber || 'CTR'})`,
                        subtitle: 'PDF • สัญญาเช่าฉบับจริง.pdf',
                        category: 'สัญญาเช่า',
                        docType: 'contract',
                        docId: con.id,
                        pdfUrl: '/api/v1/tenant-portal/contract/pdf',
                        fileName: `สัญญาเช่า_${con.contractNumber || 'CTR'}.pdf`,
                        content: `=== เอกสารสัญญาเช่าห้องพัก (ฉบับจริง) ===\nเลขที่สัญญา: ${con.contractNumber || 'CTR'}\nผู้เช่า: ${tenant.displayName || ((tenant as any).prefix && !tenant.name.startsWith((tenant as any).prefix) ? `${(tenant as any).prefix} ${tenant.name}` : (tenant.name?.startsWith('คุณ') || /^(นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.)/i.test(tenant.name) ? tenant.name : `คุณ ${tenant.name}`))}\nห้องพัก: ${tenantRoom?.roomNumber || 'ไม่ระบุ'}\nระยะเวลาสัญญา: ${formatToBeFullDate(con.startDate)} ถึง ${formatToBeFullDate(con.endDate)}\nอัตราค่าเช่า: ${(con.monthlyRent || (con as any).rentAmount || 0).toLocaleString('th-TH')} บาท/เดือน\nเงินประกัน: ${(con.depositAmount || 0).toLocaleString('th-TH')} บาท\n\n* ท่านสามารถเปิดดูเอกสาร PDF ฉบับจริง หรือดาวน์โหลดไฟล์สัญญาเช่าทางการได้ที่ปุ่มด้านล่าง`,
                        badge: null,
                        onClick: () => openTenantContractPrintWindow(con, tenant, tenantRoom, dormitory, { autoPrint: false }),
                        onDownload: () => {
                          handleDownloadDoc(
                            `เอกสารสัญญาเช่า (เลขที่ ${con.contractNumber || 'CTR'})`,
                            `สัญญาเช่า_${con.contractNumber || 'CTR'}.pdf`,
                            '',
                            'contract',
                            con.id
                          );
                        },
                      },
                      {
                        title: 'เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า',
                        subtitle: 'PDF • บัตรประชาชนผู้เช่า.pdf',
                        category: 'เอกสารประจำตัว',
                        docType: 'id_card',
                        docId: tenant.id,
                        pdfUrl: '/api/v1/tenant-portal/id-card',
                        fileName: `สำเนาบัตรประชาชน_${tenant.name}.pdf`,
                        content: `=== สำเนาบัตรประจำตัวประชาชนผู้เช่า ===\nชื่อ-นามสกุล: ${tenant.name}\nเลขประจำตัวประชาชน: ${tenant.citizenId}\nเบอร์โทรศัพท์: ${tenant.phone}\nอีเมล: ${tenant.email}\nห้องพัก: ${tenantRoom?.roomNumber || 'ไม่ระบุ'}\n\n* ท่านสามารถเปิดดูเอกสารหรือรูปภาพบัตรประชาชนฉบับจริงได้ที่ปุ่มด้านล่าง`,
                        badge: hasIdPhoto ? null : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-bold bg-amber-50 text-amber-600 border border-amber-200 shrink-0">
                            ยังไม่อัปโหลด
                          </span>
                        ),
                        onClick: () => {
                          if (hasIdPhoto) {
                            openTenantIdCardPrintWindow(tenant, idPhotoUrl, { autoPrint: false });
                          } else {
                            fileInputRef.current?.click();
                          }
                        },
                        onDownload: () => {
                          if (hasIdPhoto) {
                            handleDownloadDoc(
                              'เอกสารสำเนาบัตรประจำตัวประชาชนผู้เช่า',
                              `สำเนาบัตรประชาชน_${tenant.name || 'ผู้เช่า'}.jpg`,
                              '',
                              'id_card',
                              tenant.id
                            );
                          } else {
                            // PO Q2=A (with C): if not uploaded, open file picker
                            fileInputRef.current?.click();
                          }
                        },
                      }
                    ];

                    return documents.map((doc, idx) => (
                      <div
                        key={idx}
                        data-testid={`tenant-doc-item-${doc.docType}`}
                        className="bg-white p-3.5 border border-slate-100 rounded-2xl flex justify-between items-center shadow-2xs hover:border-indigo-200 transition-all cursor-pointer group"
                        onClick={doc.onClick}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-500 font-extrabold text-[10px] flex items-center justify-center shrink-0 border border-rose-100 group-hover:scale-105 transition-transform">
                            PDF
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <h5 className="font-extrabold text-slate-800 text-[10px] truncate group-hover:text-indigo-600 transition-colors">
                                {doc.title}
                              </h5>
                              {doc.badge}
                            </div>
                            <p className="text-[8px] text-slate-400 truncate">{doc.subtitle}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          data-testid={`btn-download-doc-${doc.docType}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            doc.onDownload();
                          }}
                          className="p-2 bg-slate-50 hover:bg-indigo-600 border border-slate-100 hover:border-indigo-600 text-slate-500 hover:text-white rounded-xl transition-all shrink-0 cursor-pointer"
                          aria-label="ดาวน์โหลด"
                          title="ดาวน์โหลดเอกสาร"
                        >
                          <Download className="w-4 h-4 stroke-[2]" />
                        </button>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* BottomSheet: Contract Renewal Modal (PO Image 4) */}
              <TenantBottomSheet
                isOpen={isRenewalSheetOpen}
                onClose={() => setIsRenewalSheetOpen(false)}
                title="คำขอต่ออายุสัญญาเช่า"
                maxHeightClass="max-h-[85vh]"
              >
                <div className="space-y-4 font-sans text-xs pb-4">
                  <div className="flex items-center gap-3 p-3 bg-emerald-50/70 border border-emerald-100 rounded-2xl">
                    <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <h5 className="font-extrabold text-emerald-900 text-[11px]">
                        ต่อสัญญาเช่าห้อง {tenantRoom?.roomNumber || 'A-005'}
                      </h5>
                      <p className="text-[9px] text-emerald-700">
                        สัญญาเดิมสิ้นสุด: {formatToBeFullDate(con.endDate)}
                      </p>
                    </div>
                  </div>

                  {isPendingRenewal ? (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between text-xs">
                      <span className="font-bold text-amber-900">สถานะคำขอ:</span>
                      <span
                        id="renewalStatusBadge"
                        className="px-3 py-1 bg-amber-100 text-amber-800 font-extrabold rounded-full border border-amber-300"
                      >
                        รออนุมัติ
                      </span>
                    </div>
                  ) : renewalEligibility &&
                    (renewalEligibility.eligible === false || renewalEligibility.isEligible === false) ? (
                    <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl space-y-1 text-xs">
                      <p className="font-bold text-rose-900">ไม่สามารถต่อสัญญาได้</p>
                      <p className="text-rose-700 font-medium">
                        {renewalEligibility.message ||
                          renewalEligibility.blockingReason ||
                          'มีคำขอเช่าห้องนี้รอการอนุมัติอยู่'}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      {/* Plan Toggle (รายเทอม / รายเดือน) */}
                      <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (renewalRentPlan !== 'term') {
                              setRenewalRentPlan('term');
                              setRequestedDurationMonths(effectiveTermMonths);
                            }
                          }}
                          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            renewalRentPlan === 'term'
                              ? 'bg-white text-emerald-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          รายเทอม
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (renewalRentPlan !== 'monthly') {
                              setRenewalRentPlan('monthly');
                              setRequestedDurationMonths(1);
                            }
                          }}
                          className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                            renewalRentPlan === 'monthly'
                              ? 'bg-white text-emerald-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          รายเดือน
                        </button>
                      </div>

                      {unpaidBalance > 0 && (
                        <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-800 text-[10px] font-bold">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>ค้างชำระ ฿{unpaidBalance.toLocaleString('th-TH')} (กรุณาชำระก่อน)</span>
                        </div>
                      )}

                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 font-medium">อัตราค่าเช่าตามประกาศหอพัก:</span>
                        <span className="font-extrabold text-slate-800">
                          {renewalRentPlan === 'term'
                            ? `฿${termRent.toLocaleString('th-TH')} /เทอม`
                            : `฿${monthlyRent.toLocaleString('th-TH')} /เดือน`}
                        </span>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          วันที่ต้องการเริ่มสัญญาใหม่ (พ.ศ.)
                        </label>
                        <OwnerDateInput
                          id="renewalStartDateInput"
                          value={effectiveStartDate}
                          min={minRenewalDate}
                          onChange={(iso) => setRequestedStartDate(iso)}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          {renewalRentPlan === 'term' ? 'ระยะเวลาตามเทอม (เดือน)' : 'ระยะเวลาต่อสัญญา (เดือน)'}
                        </label>
                        <select
                          id="renewalDurationInput"
                          value={requestedDurationMonths}
                          onChange={(e) => setRequestedDurationMonths(Number(e.target.value))}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                        >
                          {renewalRentPlan === 'term' ? (
                            [1, 2, 3, 4, 5, 6].map((m) => (
                              <option key={m} value={m}>
                                {m} เดือน{m === effectiveTermMonths ? ' (1 เทอม)' : ''}
                              </option>
                            ))
                          ) : (
                            Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                              <option key={m} value={m}>
                                {m} เดือน{m === 12 ? ' (1 ปี)' : ''}
                              </option>
                            ))
                          )}
                        </select>
                      </div>

                      {/* Read-Only Auto-Calculated New End Date (PO Image 4) */}
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          วันสิ้นสุดสัญญาเช่า
                        </label>
                        <div className="relative">
                          <input
                            id="renewalEndDateReadOnly"
                            type="text"
                            readOnly
                            value={calculatedEndDate ? `${formatToBeFullDate(calculatedEndDate)}` : '-'}
                            className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs cursor-not-allowed select-none"
                          />
                        </div>
                        <p className="text-[8.5px] text-slate-400 mt-1">
                          * คำนวณอัตโนมัติตามวันที่เริ่มสัญญาใหม่และระยะเวลาที่เลือก
                        </p>
                      </div>

                      {/* Compact Live Total Rent Calculation Summary */}
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 font-medium">สรุปค่าเช่า:</span>
                          <span className="font-extrabold text-emerald-900" data-testid="tenant-renew-total-summary">
                            {renewalRentPlan === 'monthly'
                              ? `ยอดรวมค่าเช่า: ฿${totalRent.toLocaleString('th-TH')} (${requestedDurationMonths} เดือน × ฿${monthlyRent.toLocaleString('th-TH')})`
                              : `ยอดรวมค่าเช่า: ฿${totalRent.toLocaleString('th-TH')} ${requestedDurationMonths === effectiveTermMonths ? '(1 เทอม)' : `(สัดส่วน ${requestedDurationMonths}/${effectiveTermMonths} เทอม)`}`}
                          </span>
                        </div>
                      </div>

                      <button
                        id="submitRenewalRequestBtn"
                        type="button"
                        disabled={isSubmittingRenewal}
                        onClick={async () => {
                          await handleSubmitRenewal();
                          setIsRenewalSheetOpen(false);
                        }}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {isSubmittingRenewal ? 'กำลังส่งคำขอ...' : 'ส่งคำขอต่อสัญญา'}
                      </button>
                    </div>
                  )}
                </div>
              </TenantBottomSheet>

              {/* Cancellation Confirmation Bottom Sheet */}
              <TenantBottomSheet
                isOpen={isCancelConfirmOpen}
                onClose={() => setIsCancelConfirmOpen(false)}
                title="ยืนยันการยกเลิกคำขอต่อสัญญา"
                maxHeightClass="max-h-[80vh]"
              >
                <div className="space-y-4 font-sans text-xs pb-4">
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="font-extrabold text-amber-900 text-xs">คุณต้องการยกเลิกคำขอต่อสัญญาใช่หรือไม่?</h5>
                      <p className="text-[11px] text-amber-700 leading-relaxed">
                        การยกเลิกคำขอต่อสัญญาสำหรับห้อง {tenantRoom?.roomNumber || con.roomNumber || ''} จะทำให้คำขอที่ส่งไปถูกยกเลิกทันที และคุณสามารถส่งคำขอใหม่ได้ในภายหลัง
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCancelConfirmOpen(false)}
                      className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 rounded-xl font-bold text-xs transition-all cursor-pointer"
                    >
                      ย้อนกลับ
                    </button>
                    <button
                      type="button"
                      data-testid="btn-confirm-cancel-renewal"
                      disabled={isCancellingRenewal}
                      onClick={async () => {
                        if (onCancelRenewal) {
                          await onCancelRenewal();
                        }
                        setIsCancelConfirmOpen(false);
                      }}
                      className="flex-1 py-3 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white rounded-xl font-extrabold text-xs transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isCancellingRenewal ? (
                        <span>กำลังยกเลิก...</span>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4" />
                          <span>ยืนยันยกเลิกคำขอ</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </TenantBottomSheet>
            </div>
          );
        })}

        {tenantContracts.length === 0 && (
          <p className="text-center py-12 text-slate-400">ไม่พบข้อมูลทะเบียนเอกสารสัญญาจดทะเบียน</p>
        )}
      </div>
    </div>
  );
};
