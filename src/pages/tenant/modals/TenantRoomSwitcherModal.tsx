/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Modals: Room Switcher & Smart Add Room Flow
 * Refactored to Mobile Bottom Sheet with drag-to-dismiss and no 'X' button.
 */

import React from 'react';
import {
  Building as BuildingIcon,
  Plus,
  Check,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { Tenant } from '../../../types';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantRoomSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantRooms: any[];
  currentRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
  onOpenAddRoom: () => void;
}

export const TenantRoomSwitcherModal: React.FC<TenantRoomSwitcherModalProps> = ({
  isOpen,
  onClose,
  tenantRooms,
  currentRoomId,
  onSelectRoom,
  onOpenAddRoom,
}) => {
  return (
    <TenantBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="เลือกห้องพัก"
      maxHeightClass="max-h-[85vh]"
      footer={
        <button
          type="button"
          onClick={() => {
            onClose();
            onOpenAddRoom();
          }}
          className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white rounded-2xl text-xs font-black flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>เช่าห้องพักเพิ่ม</span>
        </button>
      }
    >
      <div className="space-y-2">
        {tenantRooms.length === 0 ? (
          <div className="text-center py-6 text-slate-400 text-xs font-medium">ยังไม่มีห้องพักในระบบ</div>
        ) : (
          tenantRooms.map((r: any) => {
            const isCurrent = r.roomId === currentRoomId;
            return (
              <div
                key={r.roomId}
                onClick={() => onSelectRoom(r.roomId)}
                className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-50/50 shadow-xs ring-1 ring-indigo-400'
                    : 'border-slate-100 hover:border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-black text-xs text-slate-800">ห้อง {r.roomNumber}</span>
                    <span className="text-[10px] text-slate-500 font-bold">
                      • {r.buildingName || 'อาคารหลัก'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-slate-400 font-medium">
                      {r.dormitoryName || ''}
                    </span>
                    <span className="px-1.5 py-0.2 rounded-full text-[8px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      กำลังพักอาศัย
                    </span>
                  </div>
                </div>
                {isCurrent && (
                  <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </TenantBottomSheet>
  );
};

export interface TenantAddRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  localTenant: Tenant;
  availableVacantRooms: any[];
  loadingVacantRooms: boolean;
  selectedVacantRoomId: string;
  setSelectedVacantRoomId: (id: string) => void;
  addRoomStep: 'select' | 'request_approval';
  setAddRoomStep: (step: 'select' | 'request_approval') => void;
  isCheckingRoomClaim: boolean;
  handleCheckAndProceed: () => void;
  vacantAgreedTerms: boolean;
  setVacantAgreedTerms: (agreed: boolean) => void;
  isSubmittingVacantRequest: boolean;
  handleSubmitVacantRoomRequest: () => void;
}

export const TenantAddRoomModal: React.FC<TenantAddRoomModalProps> = ({
  isOpen,
  onClose,
  localTenant,
  availableVacantRooms,
  loadingVacantRooms,
  selectedVacantRoomId,
  setSelectedVacantRoomId,
  addRoomStep,
  setAddRoomStep,
  isCheckingRoomClaim,
  handleCheckAndProceed,
  vacantAgreedTerms,
  setVacantAgreedTerms,
  isSubmittingVacantRequest,
  handleSubmitVacantRoomRequest,
}) => {
  return (
    <TenantBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="เช่าห้องพักเพิ่ม"
      maxHeightClass="max-h-[85vh]"
    >
      <div className="space-y-4">
        {addRoomStep === 'select' ? (
          /* Step 1: เลือกห้องว่างที่ต้องการเช่า */
          <div className="space-y-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-bold text-slate-700 block">เลือกห้องว่างที่ต้องการเช่า *</label>
              {loadingVacantRooms ? (
                <div className="p-3 text-center text-slate-400 font-medium">กำลังโหลดรายการห้องว่าง...</div>
              ) : availableVacantRooms.length === 0 ? (
                <div className="p-3 text-center text-rose-500 font-medium bg-rose-50 rounded-xl">
                  ไม่พบห้องว่างในหอพักขณะนี้
                </div>
              ) : (
                <select
                  value={selectedVacantRoomId}
                  onChange={(e) => setSelectedVacantRoomId(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-800 focus:outline-indigo-500 text-xs bg-white"
                >
                  <option value="">-- กรุณาเลือกห้องว่าง --</option>
                  {availableVacantRooms.map((r: any) => (
                    <option key={r.id} value={r.id}>
                      ห้อง {r.roomNumber} • {r.buildingName || 'อาคารหลัก'}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* ข้อมูลโปรไฟล์ย่อของผู้เช่า */}
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-black flex items-center justify-center text-xs shrink-0">
                  {localTenant.name ? localTenant.name.charAt(0) : 'ผ'}
                </div>
                <div>
                  <div className="font-bold text-slate-800">คุณ{localTenant.name}</div>
                  <div className="text-[11px] text-slate-500 font-medium">{localTenant.phone}</div>
                </div>
              </div>
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-md border border-indigo-100">
                ผู้ขอเช่า
              </span>
            </div>

            <button
              type="button"
              disabled={!selectedVacantRoomId || isCheckingRoomClaim}
              onClick={handleCheckAndProceed}
              className={`w-full py-3 rounded-xl font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 ${
                !selectedVacantRoomId || isCheckingRoomClaim
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white cursor-pointer'
              }`}
            >
              {isCheckingRoomClaim ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>กำลังตรวจสอบสิทธิ์...</span>
                </>
              ) : (
                <span>ตรวจสอบและดำเนินการต่อ</span>
              )}
            </button>
          </div>
        ) : (
          /* Step 2 (Case B): เจ้าของยังไม่เพิ่ม / ข้อมูลไม่ตรงเงื่อนไข -> ตรวจสอบ */
          (() => {
            const targetRoom = availableVacantRooms.find((r: any) => r.id === selectedVacantRoomId);
            return (
              <div className="space-y-4 text-xs">
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 space-y-1">
                  <div className="flex items-center gap-1.5 font-black text-amber-800 text-xs">
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>ตรวจสอบ</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-700">
                    ห้องนี้ยังไม่มีข้อมูลล่วงหน้าจากเจ้าของหอพัก ระบบจะส่งคำขอไปยังเจ้าของหอพักเพื่อตรวจสอบและอนุมัติ (จะมีการแจ้งเตือนผลทาง LINE)
                  </p>
                </div>

                <div className="p-3.5 bg-indigo-50/60 rounded-2xl border border-indigo-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <BuildingIcon className="w-4 h-4 text-indigo-600 shrink-0" />
                    <div>
                      <span className="font-black text-slate-800 block">
                        ห้อง {targetRoom?.roomNumber} • {targetRoom?.buildingName || 'อาคารหลัก'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-medium">
                        อัตราค่าเช่า ฿{Number(targetRoom?.monthlyRent || 0).toLocaleString()} /เดือน (ตามระเบียบหอพัก)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-100 space-y-2 text-[11px] text-slate-600">
                  <div className="font-bold text-slate-800 text-xs">ข้อมูลผู้ขอเช่า (ดึงจากโปรไฟล์ของคุณ):</div>
                  <div className="flex justify-between items-center py-0.5 border-b border-slate-100">
                    <span>ชื่อ-นามสกุล:</span>
                    <span className="font-bold text-slate-800">{localTenant.name}</span>
                  </div>
                  <div className="flex justify-between items-center py-0.5 border-b border-slate-100">
                    <span>เบอร์โทรศัพท์:</span>
                    <span className="font-bold text-slate-800">{localTenant.phone}</span>
                  </div>
                  {localTenant.citizenId && (
                    <div className="flex justify-between items-center py-0.5 border-b border-slate-100">
                      <span>บัตรประชาชน:</span>
                      <span className="font-bold text-slate-800">{localTenant.citizenId}</span>
                    </div>
                  )}
                </div>

                <label className="flex items-start gap-2 text-[10px] text-slate-600 font-medium cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={vacantAgreedTerms}
                    onChange={(e) => setVacantAgreedTerms(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>ข้าพเจ้ายินยอมปฏิบัติตามกฎระเบียบและเงื่อนไขการเช่าพักอาศัยของหอพัก</span>
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setAddRoomStep('select')}
                    className="py-3 px-4 bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 rounded-xl font-bold text-xs transition-all cursor-pointer"
                  >
                    ย้อนกลับ
                  </button>
                  <button
                    type="button"
                    disabled={!vacantAgreedTerms || isSubmittingVacantRequest}
                    onClick={handleSubmitVacantRoomRequest}
                    className={`flex-1 py-3 rounded-xl font-black text-xs shadow-md transition-all flex items-center justify-center gap-2 ${
                      !vacantAgreedTerms || isSubmittingVacantRequest
                        ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white cursor-pointer'
                    }`}
                  >
                    {isSubmittingVacantRequest ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>กำลังส่งคำขอ...</span>
                      </>
                    ) : (
                      <span>ส่งคำขอเช่าห้องพัก</span>
                    )}
                  </button>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </TenantBottomSheet>
  );
};
