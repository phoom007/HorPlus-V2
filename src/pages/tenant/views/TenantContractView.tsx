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
  Clock
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
  onOpenDocModal,
  handleDownloadDoc,
  onUploadIdCard,
  onBack,
}) => {
  const [isRenewalSheetOpen, setIsRenewalSheetOpen] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
          const effectiveStartDate =
            requestedStartDate || (con.endDate ? String(con.endDate).split('T')[0] : '');
          const calculatedEndDate = calculateContractEndDate(
            effectiveStartDate,
            requestedDurationMonths
          );

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
                        ห้อง {tenantRoom?.roomNumber || 'A-005'}
                      </p>
                    </div>
                  </div>

                  {/* Top-Right Contract Renewal Action Button (PO Image 4) */}
                  {isPendingRenewal ? (
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-xl text-[9px] font-extrabold flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 text-amber-600" />
                      รออนุมัติต่อสัญญา
                    </span>
                  ) : (
                    <button
                      type="button"
                      data-testid="btn-open-renewal-sheet"
                      onClick={() => setIsRenewalSheetOpen(true)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-[10px] font-extrabold transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Calendar className="w-3.5 h-3.5" />
                      ส่งคำขอต่อสัญญา
                    </button>
                  )}
                </div>

                {/* Details grid list */}
                <div className="border-t border-slate-100 pt-4 space-y-3 text-[10px] leading-none text-slate-600">
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

                <div className="pt-3 border-t border-slate-100">
                  {con.status === 'approved_scheduled' ? (
                    <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200/50 rounded-full text-[9px] font-bold">
                      อนุมัติแล้ว — รอวันเริ่มสัญญา • เริ่มวันที่ {formatToBeFullDate(con.startDate)}
                    </span>
                  ) : con.status === 'cancelled' ? (
                    <span className="px-3 py-1 bg-rose-50 text-rose-700 border border-rose-200/50 rounded-full text-[9px] font-bold">
                      สถานะ: สัญญายกเลิก
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/50 rounded-full text-[9px] font-bold">
                      สถานะ: กำลังพักอาศัย / สัญญาปัจจุบัน
                    </span>
                  )}
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
                        content: `=== เอกสารสัญญาเช่าห้องพัก (ฉบับจริง) ===\nเลขที่สัญญา: ${con.contractNumber || 'CTR'}\nผู้เช่า: คุณ ${tenant.name}\nห้องพัก: ${tenantRoom?.roomNumber || 'ไม่ระบุ'}\nระยะเวลาสัญญา: ${formatToBeFullDate(con.startDate)} ถึง ${formatToBeFullDate(con.endDate)}\nอัตราค่าเช่า: ${(con.monthlyRent || (con as any).rentAmount || 0).toLocaleString('th-TH')} บาท/เดือน\nเงินประกัน: ${(con.depositAmount || 0).toLocaleString('th-TH')} บาท\n\n* ท่านสามารถเปิดดูเอกสาร PDF ฉบับจริง หรือดาวน์โหลดไฟล์สัญญาเช่าทางการได้ที่ปุ่มด้านล่าง`,
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
                        content: `=== สำเนาบัตรประจำตัวประชาชนผู้เช่า ===\nชื่อ-นามสกุล: ${tenant.name}\nเลขประจำตัวประชาชน: ${tenant.citizenId}\nเบอร์โทรศัพท์: ${tenant.phone}\nอีเมล: ${tenant.email}\nสถานะ: รับรองสำเนาถูกต้องสำหรับใช้ในการทำสัญญาเช่าพักอาศัยห้อง ${tenantRoom?.roomNumber || 'ไม่ระบุ'} เท่านั้น\n\n* ท่านสามารถเปิดดูเอกสารหรือรูปภาพบัตรประชาชนฉบับจริงได้ที่ปุ่มด้านล่าง`,
                        badge: hasIdPhoto ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[8px] font-bold bg-emerald-50 text-emerald-600 border border-emerald-200 shrink-0">
                            อัปโหลดแล้ว
                          </span>
                        ) : (
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
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          วันที่ต้องการเริ่มสัญญาใหม่
                        </label>
                        <input
                          id="renewalStartDateInput"
                          type="date"
                          value={effectiveStartDate}
                          onChange={(e) => setRequestedStartDate(e.target.value)}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 mb-1">
                          ระยะเวลาต่อสัญญา (เดือน)
                        </label>
                        <select
                          id="renewalDurationInput"
                          value={requestedDurationMonths}
                          onChange={(e) => setRequestedDurationMonths(Number(e.target.value))}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-medium text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                        >
                          {[1, 2, 3, 4, 5, 6].map((m) => {
                            const isTerm = tenantRoom?.termMonths ? m === Number(tenantRoom.termMonths) : m === 5;
                            return (
                              <option key={m} value={m}>
                                {m} เดือน{isTerm ? ' (1 เทอม)' : ''}
                              </option>
                            );
                          })}
                          <option value={12}>12 เดือน (1 ปี)</option>
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
