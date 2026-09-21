/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Modals: Move Out Request (แจ้งย้ายออก)
 * Refactored to Mobile Bottom Sheet with strictly 1 input field (วันที่ประสงค์จะย้ายออก).
 */

import React from 'react';
import { AlertCircle, LogOut } from 'lucide-react';
import { TenantBottomSheet } from '../components/TenantBottomSheet';
import { OwnerDateInput } from '../../../components/OwnerDateInput';

export interface TenantMoveOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  moveOutDate: string;
  setMoveOutDate: (date: string) => void;
  moveOutBank?: string;
  setMoveOutBank?: (bank: string) => void;
  moveOutAccount?: string;
  setMoveOutAccount?: (account: string) => void;
  moveOutReason?: string;
  setMoveOutReason?: (reason: string) => void;
  handleConfirmMoveOut: () => void;
}

export const TenantMoveOutModal: React.FC<TenantMoveOutModalProps> = ({
  isOpen,
  onClose,
  moveOutDate,
  setMoveOutDate,
  handleConfirmMoveOut,
}) => {
  return (
    <TenantBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="แจ้งย้ายออก / เลิกเช่าห้องพัก"
      footer={
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition-all cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            data-testid="button-tenant-moveout-confirm"
            onClick={handleConfirmMoveOut}
            disabled={!moveOutDate}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>ยืนยันส่งคำขอแจ้งย้ายออก</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4 font-sans text-xs min-h-[330px] flex flex-col justify-end pb-1">
        <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-2xl space-y-1.5 text-amber-900">
          <h5 className="font-extrabold text-xs flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            ข้อควรรู้ก่อนแจ้งย้ายออก
          </h5>
          <ul className="list-disc list-inside text-[10px] space-y-1 text-amber-800 leading-relaxed font-medium pl-1">
            <li>
              ท่านสามารถระบุวันที่ประสงค์จะย้ายออกได้ตามความสะดวก โดยคำขอจะมีผลสมบูรณ์เมื่อเจ้าของหอพักอนุมัติและนัดหมายตรวจสภาพห้อง
            </li>
            <li>
              ผู้เช่าต้องชำระค่าน้ำ ค่าไฟ และค่าเช่าค้างชำระทั้งหมดจนถึงวันสิ้นสุดการเช่า
            </li>
            <li>
              เจ้าหน้าที่จะนัดหมายตรวจสภาพห้องพัก ข้าวของเครื่องใช้ และตกลงคืนเงินประกันในวันตรวจสภาพห้อง
            </li>
          </ul>
        </div>

        {/* Strictly ONLY Planned Move-Out Date field as confirmed by PO */}
        <div className="space-y-1.5">
          <label className="block text-xs text-slate-700 font-bold mb-1">
            วันที่ประสงค์จะย้ายออก (พ.ศ.) *
          </label>
          <OwnerDateInput
            required
            verticalAlign="top"
            min={new Date().toISOString().split('T')[0]}
            value={moveOutDate}
            onChange={(iso) => setMoveOutDate(iso)}
            data-testid="input-tenant-moveout-date"
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500 shadow-2xs"
          />
          <p className="text-[10px] text-slate-400">
            โปรดเลือกวันที่ที่ท่านวางแผนจะคืนกุญแจและขนย้ายสิ่งของออกจากห้องพัก
          </p>
        </div>
      </div>
    </TenantBottomSheet>
  );
};
