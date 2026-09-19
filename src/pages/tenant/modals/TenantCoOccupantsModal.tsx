/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Modals: Co-Occupants (รายชื่อผู้พักอาศัยร่วม)
 * Refactored to Mobile Bottom Sheet with drag-to-dismiss and no 'X' button.
 */

import React from 'react';
import { Plus, Trash2, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantCoOccupantsModalProps {
  isOpen: boolean;
  onClose: () => void;
  editCoOccupants: any[];
  deleteConfirmCoId: string | null;
  setDeleteConfirmCoId: (id: string | null) => void;
  isDeletingCo: boolean;
  handleConfirmRemoveCoOccupant: (id: string, name: string) => void;
  coOccupantsError: string;
  newCoName: string;
  setNewCoName: (name: string) => void;
  newCoPhone: string;
  setNewCoPhone: (phone: string) => void;
  isAddingCo: boolean;
  handleAddCoOccupant: () => void;
}

export const TenantCoOccupantsModal: React.FC<TenantCoOccupantsModalProps> = ({
  isOpen,
  onClose,
  editCoOccupants,
  deleteConfirmCoId,
  setDeleteConfirmCoId,
  isDeletingCo,
  handleConfirmRemoveCoOccupant,
  coOccupantsError,
  newCoName,
  setNewCoName,
  newCoPhone,
  setNewCoPhone,
  isAddingCo,
  handleAddCoOccupant,
}) => {
  return (
    <TenantBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="รายชื่อผู้พักอาศัยร่วม"
      maxHeightClass="max-h-[85vh]"
    >
      <div className="space-y-4">
        {/* Policy Warning Banner (Image 3) */}

        <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>ระเบียบการแจ้งผู้พักร่วม</span>
        </div>
        <div className="space-y-1.5 text-[11px] font-medium">
          <div className="flex items-start gap-2 bg-emerald-50/80 border border-emerald-100 p-2 rounded-xl text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <span><strong className="font-bold">แจ้งตามจริง:</strong> เพื่อคำนวณค่าบริการต่างๆ ตามจำนวนคน</span>
          </div>
          <div className="flex items-start gap-2 bg-rose-50/80 border border-rose-100 p-2 rounded-xl text-rose-800">
            <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
            <span><strong className="font-bold">ห้ามปกปิด:</strong> ตรวจพบถือว่าเจตนาทุจริต/โกง มีโทษปรับตามสัญญา</span>
          </div>
        </div>


        {/* Current co-occupants list */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-600 px-0.5">
            <span>ผู้พักอาศัยร่วมปัจจุบัน</span>
            <span className="text-slate-400 font-normal text-[10px]">({editCoOccupants.length} คน)</span>
          </div>
          <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
            {editCoOccupants.map((co, index) => {
              const isConfirming = deleteConfirmCoId === co.id;
              return (
                <div
                  key={co.id || index}
                  className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center transition-all duration-200"
                >
                  {isConfirming ? (
                    <div className="flex-1 flex items-center justify-between gap-2 animate-in fade-in duration-250">
                      <span className="text-[10px] font-bold text-rose-600">
                        ยืนยันต้องการลบคุณ {co.name}?
                      </span>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmCoId(null)}
                          className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-500 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={isDeletingCo}
                          onClick={() => handleConfirmRemoveCoOccupant(co.id, co.name)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                        >
                          {isDeletingCo ? 'กำลังลบ...' : 'ยืนยันลบ'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-xs">
                        <p className="font-extrabold text-slate-800">{co.name}</p>
                        <p className="text-slate-500 text-[10px] mt-0.5">โทร: {co.phone || '-'}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmCoId(co.id)}
                        className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-lg transition-all cursor-pointer"
                        title="ลบผู้พักอาศัยร่วม"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
            {editCoOccupants.length === 0 && (
              <p className="text-center py-6 text-slate-400 text-[10px] font-semibold bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                ไม่มีผู้พักอาศัยร่วมลงทะเบียน
              </p>
            )}
          </div>
        </div>

        {/* Add Form */}
        <div className="p-3.5 border border-indigo-100 bg-indigo-50/20 rounded-2xl space-y-3">
          <h5 className="font-black text-indigo-950 text-xs flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5 text-indigo-600" />
            เพิ่มผู้พักอาศัยร่วมใหม่
          </h5>

          {coOccupantsError && (
            <p className="text-[10px] text-rose-600 font-bold bg-rose-50 border border-rose-100 px-2 py-1 rounded-md">
              {coOccupantsError}
            </p>
          )}

          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 font-bold">
                ชื่อ-นามสกุล / ชื่อเล่น *
              </label>
              <input
                type="text"
                value={newCoName}
                onChange={(e) => setNewCoName(e.target.value)}
                placeholder="เช่น นายอานนท์ มั่นคง"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 font-bold">
                เบอร์โทรศัพท์
              </label>
              <input
                type="text"
                value={newCoPhone}
                onChange={(e) => setNewCoPhone(e.target.value)}
                placeholder="เช่น 0891234567"
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={isAddingCo}
            onClick={handleAddCoOccupant}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" /> {isAddingCo ? 'กำลังเพิ่ม...' : '+ เพิ่มผู้พักอาศัยร่วม'}
          </button>
        </div>
      </div>
    </TenantBottomSheet>
  );
};
