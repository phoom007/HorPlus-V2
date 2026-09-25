/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — SubView: Maintenance & Repairs (แจ้งซ่อมบำรุง)
 */

import React from 'react';
import {
  ChevronLeft,
  Plus,
  X,
  Folder,
  Camera,
  Wrench,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { MaintenanceRequest as RepairRequest } from '../../../types';
import { StatusBadge } from '../../../components/GlobalComponents';
import { formatToBeDate } from '../tenantHelpers';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantRepairsViewProps {
  tenantRepairs: RepairRequest[];
  hasRoom?: boolean;
  onStartRegister?: () => void;
  repairTab: 'mine' | 'history';
  setRepairTab: (tab: 'mine' | 'history') => void;
  isNewRepairOpen: boolean;
  setIsNewRepairOpen: (open: boolean) => void;
  repairTitle: string;
  setRepairTitle: (t: string) => void;
  repairDesc: string;
  setRepairDesc: (d: string) => void;
  repairImage: string | null;
  repairImageName: string | null;
  repairFileInputRef: React.RefObject<HTMLInputElement | null>;
  handleRepairFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRepairRemoveFile: () => void;
  handleCreateRepair: (e: React.FormEvent) => void;
  isSubmittingRepair?: boolean;
  onCancelRepair?: (requestId: string) => void;
  isCancellingRepairId?: string | null;
  onBack: () => void;
  onZoomImage: (url: string) => void;
}

export const TenantRepairsView: React.FC<TenantRepairsViewProps> = ({
  tenantRepairs,
  hasRoom = true,
  onStartRegister,
  repairTab,
  setRepairTab,
  isNewRepairOpen,
  setIsNewRepairOpen,
  repairTitle,
  setRepairTitle,
  repairDesc,
  setRepairDesc,
  repairImage,
  repairImageName,
  repairFileInputRef,
  handleRepairFileChange,
  handleRepairRemoveFile,
  handleCreateRepair,
  isSubmittingRepair = false,
  onCancelRepair,
  isCancellingRepairId = null,
  onBack,
  onZoomImage,
}) => {
  const isFinishedStatus = (status: string) =>
    ['completed', 'resolved', 'closed', 'cancelled'].includes(status);
  const activeRepairs = tenantRepairs.filter((r) => !isFinishedStatus(r.status));
  const historyRepairs = tenantRepairs.filter((r) => isFinishedStatus(r.status));

  return (
    <div className="flex flex-col h-full bg-slate-50 relative">
      {/* SubView Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">แจ้งซ่อมบำรุง</h3>
        <div className="w-7 flex justify-end shrink-0">
          {hasRoom && (
            <button
              onClick={() => setIsNewRepairOpen(true)}
              className="p-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-full transition-colors cursor-pointer"
              aria-label="แจ้งซ่อมใหม่"
            >
              <Plus className="w-4.5 h-4.5 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {!hasRoom ? (
        <div className="py-16 text-center flex-1 flex items-center justify-center" data-testid="unregistered-repairs-locked">
          <p className="text-slate-400 font-semibold text-xs">ยังไม่มีรายการแจ้งซ่อมในระบบ</p>
        </div>
      ) : (
        <>
          {/* Tabs: รายการของฉัน / ประวัติการแจ้ง */}
          <div className="flex border-b border-gray-100 bg-white sticky top-[45px] z-20 shrink-0">
            <button
              type="button"
              onClick={() => setRepairTab('mine')}
              className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors cursor-pointer ${
                repairTab === 'mine'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              รายการของฉัน ({activeRepairs.length})
            </button>
            <button
              type="button"
              onClick={() => setRepairTab('history')}
              className={`flex-1 py-2.5 text-center text-[10px] font-black transition-colors cursor-pointer ${
                repairTab === 'history'
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              ประวัติการแจ้ง ({historyRepairs.length})
            </button>
          </div>

          <div className="p-4 space-y-3 pb-24 overflow-y-auto">
            {repairTab === 'mine' ? (
              activeRepairs.length > 0 ? (
                activeRepairs.map((rep) => (
                  <div
                    key={rep.id}
                    className="p-4 bg-white border border-slate-100 rounded-2xl space-y-2.5 shadow-2xs"
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-extrabold text-slate-800 text-xs leading-snug">
                        {rep.title}
                      </span>
                      <StatusBadge status={rep.status} type="maintenance" />
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">{rep.description}</p>
                    {rep.imageBefore && (
                      <div className="mt-2 space-y-1">
                        <span className="text-[9px] text-slate-400 font-semibold">รูปภาพปัญหา:</span>
                        <div>
                          <img
                            src={rep.imageBefore}
                            alt="Repair site"
                            onClick={() => onZoomImage(rep.imageBefore!)}
                            className="w-14 h-14 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-slate-150 transition-all shadow-2xs hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                    )}
                    {rep.imageAfter && (
                      <div className="mt-2 space-y-1 pt-1.5 border-t border-slate-100">
                        <span className="text-[9px] text-emerald-700 font-bold flex items-center gap-1">
                          <Wrench className="w-3 h-3 text-emerald-600" /> รูปผลงานซ่อม / อะไหล่จากช่าง:
                        </span>
                        <div>
                          <img
                            src={rep.imageAfter}
                            alt="Technician work proof"
                            onClick={() => onZoomImage(rep.imageAfter!)}
                            className="w-16 h-16 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-emerald-300 transition-all shadow-2xs hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      </div>
                    )}
                    {rep.note && (
                      <div className="mt-1.5 p-2 bg-slate-50 rounded-xl border border-slate-100 text-[10px] text-slate-600 space-y-0.5">
                        <span className="font-bold text-slate-700">บันทึกจากช่าง:</span>
                        <p className="leading-relaxed text-slate-600">{rep.note}</p>
                      </div>
                    )}
                    <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[8px] text-slate-400">
                      <span>วันที่แจ้ง: {formatToBeDate(rep.createdAt)}</span>
                      <div className="flex items-center gap-2">
                        {rep.cost ? (
                          <span className="text-emerald-600 font-bold">
                            ฿{Number(rep.cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                          </span>
                        ) : null}
                        {rep.assignedStaff && (
                          <span className="text-indigo-600 font-bold">
                            ช่าง: ช่าง{rep.assignedStaff}
                          </span>
                        )}
                      </div>
                    </div>
                    {['submitted', 'pending', 'acknowledged'].includes(rep.status) && onCancelRepair && (
                      <div className="pt-2 border-t border-slate-100 flex justify-end">
                        <button
                          type="button"
                          onClick={() => onCancelRepair(rep.id)}
                          disabled={isCancellingRepairId === rep.id}
                          data-testid={`cancel-repair-btn-${rep.id}`}
                          className="px-3 py-1.5 text-[10px] font-bold text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isCancellingRepairId === rep.id ? 'กำลังยกเลิก...' : 'ยกเลิกการแจ้งซ่อม'}
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4 py-12">
                  <button
                    type="button"
                    onClick={() => setIsNewRepairOpen(true)}
                    className="flex flex-col items-center justify-center gap-3.5 cursor-pointer group focus:outline-none transition-transform active:scale-95"
                  >
                    <div className="relative p-5 bg-slate-100/90 rounded-full text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors shadow-2xs">
                      <Folder className="w-10 h-10 stroke-[1.5]" />
                      <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs border-2 border-white">
                        <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-slate-800 font-black text-xs sm:text-sm group-hover:text-indigo-600 transition-colors">
                        ไม่มีรายการแจ้งซ่อมบำรุง
                      </h4>
                      <p className="text-[10px] sm:text-xs text-slate-400 font-medium">
                        แตะที่นี่เพื่อเพิ่มรายการแจ้งซ่อมใหม่
                      </p>
                    </div>
                  </button>
                </div>
              )
            ) : historyRepairs.length > 0 ? (
              historyRepairs.map((rep) => (
                <div
                  key={rep.id}
                  className="p-4 bg-white border border-slate-100 rounded-2xl space-y-2.5 shadow-2xs"
                >
                  <div className="flex justify-between items-start">
                    <span className="font-bold text-slate-700 text-xs leading-snug">{rep.title}</span>
                    <StatusBadge status={rep.status} type="maintenance" />
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{rep.description}</p>
                  {rep.imageBefore && (
                    <div className="mt-2 space-y-1">
                      <span className="text-[8px] text-slate-400 font-semibold">รูปภาพปัญหา:</span>
                      <div>
                        <img
                          src={rep.imageBefore}
                          alt="Repair site"
                          onClick={() => onZoomImage(rep.imageBefore!)}
                          className="w-14 h-14 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-slate-150 transition-all shadow-2xs hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  )}
                  {rep.imageAfter && (
                    <div className="mt-2 space-y-1 pt-1.5 border-t border-slate-100">
                      <span className="text-[9px] text-emerald-700 font-bold flex items-center gap-1">
                        <Wrench className="w-3 h-3 text-emerald-600" /> รูปผลงานซ่อม / อะไหล่จากช่าง:
                      </span>
                      <div>
                        <img
                          src={rep.imageAfter}
                          alt="Technician work proof"
                          onClick={() => onZoomImage(rep.imageAfter!)}
                          className="w-16 h-16 rounded-xl object-cover cursor-pointer hover:opacity-90 border border-emerald-300 transition-all shadow-2xs hover:scale-105"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    </div>
                  )}
                  {rep.note && (
                    <div className="mt-1.5 p-2 bg-slate-50 rounded-xl border border-slate-100 text-[10px] text-slate-600 space-y-0.5">
                      <span className="font-bold text-slate-700">บันทึกจากช่าง:</span>
                      <p className="leading-relaxed text-slate-600">{rep.note}</p>
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100 flex justify-between items-center text-[8px] text-slate-300">
                    <span>แล้วเสร็จเมื่อ: {formatToBeDate(rep.updatedAt)}</span>
                    <div className="flex items-center gap-2">
                      {rep.cost ? (
                        <span className="text-emerald-600 font-bold">
                          ค่าใช้จ่าย: ฿{Number(rep.cost).toLocaleString('th-TH', { minimumFractionDigits: 2 })}
                        </span>
                      ) : null}
                      {rep.assignedStaff && (
                        <span className="text-indigo-500 font-bold">
                          ช่าง: ช่าง{rep.assignedStaff}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center py-16 text-slate-400 font-semibold text-xs">
                ไม่มีประวัติเรื่องแจ้งซ่อมย้อนหลัง
              </p>
            )}
          </div>

          {/* Bottom Sticky Action Button */}
          <div className="p-4 bg-white/95 backdrop-blur-md border-t border-gray-100 fixed bottom-0 left-0 right-0 z-20 max-w-md mx-auto">
            <button
              onClick={() => setIsNewRepairOpen(true)}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
            >
              + แจ้งซ่อมบำรุงใหม่
            </button>
          </div>
        </>
      )}

      {/* Slide-Up Drawer Form for New Request using TenantBottomSheet */}
      <TenantBottomSheet
        isOpen={isNewRepairOpen}
        onClose={() => setIsNewRepairOpen(false)}
        title="รายละเอียดแจ้งซ่อม"
        maxHeightClass="max-h-[90vh]"
      >
        <form onSubmit={handleCreateRepair} className="space-y-4 text-left">
          <div className="space-y-1.5">
            <label className="block font-bold text-slate-700 text-[10px]">
              หัวข้อปัญหา *
            </label>
            <input
              type="text"
              required
              value={repairTitle}
              onChange={(e) => setRepairTitle(e.target.value)}
              placeholder="เช่น แอร์ไม่เย็น, น้ำรั่ว, ไฟดับ"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-slate-800 font-bold focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-bold text-slate-700 text-[10px]">
              รายละเอียดเพิ่มเติม
            </label>
            <textarea
              value={repairDesc}
              onChange={(e) => setRepairDesc(e.target.value)}
              placeholder="อธิบายจุดที่เกิดปัญหาเพิ่มเติม..."
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-slate-50 focus:bg-white text-slate-800 h-24 resize-none focus:border-indigo-500 focus:outline-none transition-all placeholder:text-slate-400"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block font-bold text-slate-700 text-[10px]">
              แนบรูปถ่ายสถานที่หรือปัญหา (ไม่บังคับ)
            </label>

            <input
              type="file"
              ref={repairFileInputRef}
              onChange={handleRepairFileChange}
              accept="image/*"
              className="hidden"
            />

            {repairImage ? (
              <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <img
                    src={repairImage}
                    alt="Preview"
                    className="w-12 h-12 rounded-lg object-cover bg-slate-100 border border-slate-200 shrink-0"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0">
                    <p className="text-slate-800 font-bold truncate text-[10px]">
                      {repairImageName || 'image.jpg'}
                    </p>
                    <p className="text-amber-600 font-semibold text-[8px]">
                      เลือกไฟล์แล้ว — พร้อมส่ง
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRepairRemoveFile}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95 shrink-0"
                >
                  ล้างรูปภาพ
                </button>
              </div>
            ) : (
              <div
                onClick={() => repairFileInputRef.current?.click()}
                className="border border-dashed border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/5 transition-all rounded-xl p-4 text-center flex flex-col items-center justify-center cursor-pointer gap-1.5 bg-slate-50"
              >
                <div className="p-1.5 bg-slate-100 rounded-full text-slate-500">
                  <Camera className="w-4 h-4 stroke-[2]" />
                </div>
                <p className="text-slate-500 text-[10px] font-bold">กดเพื่ออัปโหลดรูปภาพ</p>
                <p className="text-slate-400 text-[8px] font-medium">จำกัดขนาดไฟล์สูงสุด 5MB</p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmittingRepair}
            className="w-full py-3 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {isSubmittingRepair ? 'กำลังส่งเรื่อง...' : 'ส่งเรื่องแจ้งซ่อม'}
          </button>
        </form>
      </TenantBottomSheet>
    </div>
  );
};
