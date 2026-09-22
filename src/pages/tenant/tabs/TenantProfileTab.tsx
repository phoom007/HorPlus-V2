/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Tab 4: Profile (ข้อมูลและโปรไฟล์ผู้เช่า)
 */

import React, { useState, useEffect } from 'react';
import { User, ChevronLeft, Wrench, AlertCircle, LogOut, Phone, Shield, Edit3, Plus, Trash2, Car, Bike, PawPrint, UserCheck } from 'lucide-react';
import { Tenant, VehicleItem, PetItem } from '../../../types';
import {
  formatToBeFullDate,
  CAR_BRANDS,
  MOTO_BRANDS,
  CANONICAL_PET_GROUP_OPTIONS,
  getEffectivePetPolicy,
  resolveAllowedPetOptions,
} from '../tenantHelpers';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantProfileTabProps {
  dormitoryName?: string;
  buildingName?: string;
  roomNumber?: string;
  localTenant: Tenant;
  hasRoom?: boolean;
  onStartRegister?: () => void;
  petPolicy?: { allowed: string; allowedTypes?: string[] } | null;
  onOpenCoOccupantsModal: () => void;
  onUpdateProfile?: (updates: { vehicle?: any; pet?: any; vehicles?: any[]; pets?: any[] }) => Promise<void> | void;
  moveOutRequest: any;
  onOpenMoveOutModal: () => void;
  handleCancelMoveOutRequest: () => void;
  onBack?: () => void;
}

export const TenantProfileTab: React.FC<TenantProfileTabProps> = ({
  dormitoryName,
  buildingName,
  roomNumber,
  localTenant,
  hasRoom = Boolean(roomNumber || localTenant?.roomNumber),
  petPolicy,
  onOpenCoOccupantsModal,
  onUpdateProfile,
  moveOutRequest,
  onOpenMoveOutModal,
  handleCancelMoveOutRequest,
  onBack,
}) => {
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
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">ข้อมูลส่วนตัว</h3>
          <div className="w-7 flex justify-end shrink-0">
            <User className="w-5 h-5 text-indigo-500" />
          </div>
        </div>

        <div className="py-24 text-center flex-1 flex items-center justify-center">
          <p className="text-slate-400 font-semibold text-xs">ยังไม่มีข้อมูลในระบบ</p>
        </div>
      </div>
    );
  }

  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editVehicles, setEditVehicles] = useState<VehicleItem[]>([]);
  const [editPets, setEditPets] = useState<PetItem[]>([]);

  // Add Vehicle form fields
  const [newVehType, setNewVehType] = useState<'car' | 'motorcycle'>('car');
  const [newVehPlate, setNewVehPlate] = useState('');
  const [newVehBrand, setNewVehBrand] = useState('');
  const [newVehCustomBrand, setNewVehCustomBrand] = useState('');

  // Add Pet form fields
  const [newPetType, setNewPetType] = useState('');
  const [newPetName, setNewPetName] = useState('');
  const [newPetCustomType, setNewPetCustomType] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const vList: VehicleItem[] = Array.isArray(localTenant?.vehicles) && localTenant.vehicles.length > 0
      ? localTenant.vehicles
      : localTenant?.vehicle?.licensePlate && localTenant.vehicle.type !== 'none'
        ? [localTenant.vehicle]
        : [];
    setEditVehicles(vList);

    const pList: PetItem[] = Array.isArray(localTenant?.pets) && localTenant.pets.length > 0
      ? localTenant.pets
      : localTenant?.pet?.hasPet && localTenant.pet.type
        ? [{ id: 'pet-1', type: localTenant.pet.type, name: localTenant.pet.name || '', customType: (localTenant.pet as any).customType || '' }]
        : [];
    setEditPets(pList);
  }, [localTenant]);

  const handleAddVehicle = () => {
    if (!newVehPlate.trim()) return;
    const brand = newVehBrand === 'อื่นๆ' && newVehCustomBrand ? newVehCustomBrand.trim() : newVehBrand;
    setEditVehicles((prev) => [
      ...prev,
      {
        id: `veh-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        type: newVehType,
        licensePlate: newVehPlate.trim(),
        brand,
      },
    ]);
    setNewVehPlate('');
    setNewVehBrand('');
    setNewVehCustomBrand('');
  };

  const handleRemoveVehicle = (index: number) => {
    setEditVehicles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddPet = () => {
    if (!newPetType) return;
    const finalType =
      (newPetType === 'other' || newPetType === 'อื่นๆ' || newPetType.includes('สัตว์แปลก')) && newPetCustomType
        ? `${newPetType} (${newPetCustomType.trim()})`
        : newPetType;
    setEditPets((prev) => [
      ...prev,
      {
        id: `pet-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        type: finalType.trim(),
        name: newPetName.trim(),
        customType: newPetCustomType.trim(),
      },
    ]);
    setNewPetType('');
    setNewPetName('');
    setNewPetCustomType('');
  };

  const handleRemovePet = (index: number) => {
    setEditPets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      if (onUpdateProfile) {
        await onUpdateProfile({
          vehicles: editVehicles,
          pets: editPets,
          vehicle: editVehicles[0] || { type: 'none', licensePlate: '', brand: '' },
          pet: {
            hasPet: editPets.length > 0,
            pets: editPets,
            type: editPets[0]?.type || '',
            name: editPets[0]?.name || '',
          },
        });
      }
      setIsEditingInfo(false);
    } finally {
      setIsSaving(false);
    }
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
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">โปรไฟล์ผู้เช่า</h3>
        <div className="w-7 flex justify-end shrink-0">
          <User className="w-5 h-5 text-slate-400" />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
          ข้อมูลและโปรไฟล์ผู้เช่า
        </h4>

        {/* User Info Card */}
        <div className="bg-white p-4 border border-slate-100 rounded-3xl space-y-4 shadow-2xs">
          <div className="flex justify-between items-center">
            <div className="flex gap-3.5 items-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-black text-base border border-indigo-100/60 shadow-2xs">
                {(() => {
                  const rawFirst = localTenant?.firstName && localTenant.firstName !== '-' ? localTenant.firstName : '';
                  const initialChar = rawFirst ? rawFirst.charAt(0) : (localTenant?.displayName || localTenant?.name || 'ผ').charAt(0);
                  return initialChar;
                })()}
              </div>
              <div>
                <h4 className="font-black text-slate-800 text-sm">
                  {hasRoom && localTenant?.name && localTenant.name !== 'ยังไม่ได้ลงทะเบียน'
                    ? (localTenant.displayName || (localTenant.prefix && !localTenant.name.startsWith(localTenant.prefix) ? `${localTenant.prefix} ${localTenant.name}` : localTenant.name))
                    : 'ยังไม่ได้ลงทะเบียน'}
                </h4>
                <p className="text-[10px] text-slate-400 mt-0.5">อีเมล: {localTenant?.email || '-'}</p>
              </div>
            </div>
            {hasRoom ? (
              <button
                type="button"
                data-testid="btn-edit-tenant-info"
                onClick={() => setIsEditingInfo(true)}
                className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer shrink-0"
              >
                <Edit3 className="w-3 h-3" />
                <span>แก้ไขข้อมูลยานพาหนะ</span>
              </button>
            ) : (
              <span className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl text-[9px] font-bold shrink-0">
                ยังไม่ได้ลงทะเบียน
              </span>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3 text-[10px] space-y-2 text-slate-600 leading-normal">
            <p>
              <span className="text-slate-400">หอพัก:</span>{' '}
              <span className="font-bold text-indigo-700">
                {dormitoryName || 'หอพักของคุณ'}
              </span>
            </p>
            <p>
              <span className="text-slate-400">ห้องพัก:</span>{' '}
              <span className="font-bold text-indigo-700">
                {hasRoom ? `ห้อง ${roomNumber || '-'} ${buildingName ? `∙ ${buildingName}` : ''}` : 'ยังไม่มีห้องพัก'}
              </span>
            </p>
            <p>
              <span className="text-slate-400">เบอร์โทรศัพท์:</span>{' '}
              <span className="font-bold text-slate-800">{localTenant?.phone || '-'}</span>
            </p>
            {hasRoom && (
              <>
                <p>
                  <span className="text-slate-400">เลขประจำตัวประชาชน:</span>{' '}
                  <span className="font-bold text-slate-800">{localTenant?.citizenId || '-'}</span>
                </p>
                <div>
                  <span className="text-slate-400">ยานพาหนะ:</span>{' '}
                  {editVehicles.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      {editVehicles.map((v, idx) => (
                        <div key={v.id || idx} className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                          {v.type === 'car' ? (
                            <Car className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          ) : (
                            <Bike className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          )}
                          <span>{v.type === 'car' ? 'รถยนต์' : 'รถจักรยานยนต์'} {v.brand ? `${v.brand} ` : ''}ทะเบียน {v.licensePlate}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="font-bold text-slate-800">ไม่มี</span>
                  )}
                </div>
                <div>
                  <span className="text-slate-400">สัตว์เลี้ยง:</span>{' '}
                  {editPets.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      {editPets.map((p, idx) => (
                        <div key={p.id || idx} className="font-bold text-slate-800 flex items-center gap-1.5 text-xs">
                          <PawPrint className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>{p.type || 'สัตว์เลี้ยง'} {p.customType ? `(${p.customType}) ` : ''}{p.name ? `ชื่อ ${p.name}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="font-bold text-slate-800">ไม่มีสัตว์เลี้ยง</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Multi-Vehicle & Multi-Pet Edit BottomSheet */}
        <TenantBottomSheet
          isOpen={isEditingInfo}
          onClose={() => setIsEditingInfo(false)}
          title="แก้ไขข้อมูลยานพาหนะ"
          maxHeightClass="max-h-[85vh]"
        >
          <form
            onSubmit={handleSubmit}
            className="space-y-3 font-sans text-xs pb-4"
          >
            {/* Vehicle Section */}
            <div className="space-y-2.5 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black text-slate-700">
                  ยานพาหนะครอบครอง ({editVehicles.length} คัน)
                </label>
              </div>

              {/* List of current vehicles */}
              <div className="space-y-1.5">
                {editVehicles.map((v, idx) => (
                  <div
                    key={v.id || idx}
                    className="p-2.5 bg-white border border-slate-200/80 rounded-xl flex justify-between items-center text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs shrink-0 flex items-center justify-center">
                        {v.type === 'car' ? <Car className="w-3.5 h-3.5" /> : <Bike className="w-3.5 h-3.5" />}
                      </span>
                      <div>
                        <p className="font-bold text-slate-800">
                          {v.type === 'car' ? 'รถยนต์' : 'รถจักรยานยนต์'} {v.brand ? `∙ ${v.brand}` : ''}
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono">ทะเบียน: {v.licensePlate}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveVehicle(idx)}
                      className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      title="ลบยานพาหนะ"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {editVehicles.length === 0 && (
                  <p className="text-center py-2 text-slate-400 text-[10px] font-semibold bg-white/50 rounded-xl border border-dashed border-slate-200">
                    ยังไม่มีรายการยานพาหนะ
                  </p>
                )}
              </div>

              {/* Add vehicle subsection */}
              <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                <label className="block text-[10px] font-bold text-slate-700">+ เพิ่มยานพาหนะใหม่</label>
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setNewVehType('car');
                      setNewVehBrand('');
                      setNewVehCustomBrand('');
                    }}
                    className={`py-1.5 font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${newVehType === 'car'
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <Car className="w-3.5 h-3.5" />
                    <span>รถยนต์</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewVehType('motorcycle');
                      setNewVehBrand('');
                      setNewVehCustomBrand('');
                    }}
                    className={`py-1.5 font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${newVehType === 'motorcycle'
                        ? 'bg-white text-indigo-700 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                      }`}
                  >
                    <Bike className="w-3.5 h-3.5" />
                    <span>รถจักรยานยนต์</span>
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newVehPlate}
                    onChange={(e) => setNewVehPlate(e.target.value)}
                    placeholder="เลขทะเบียน เช่น 1กข 1234"
                    className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-xl text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <select
                    value={newVehBrand}
                    onChange={(e) => setNewVehBrand(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-xl text-[10px] text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="">-- เลือกยี่ห้อ --</option>
                    {(newVehType === 'car' ? CAR_BRANDS : MOTO_BRANDS).map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
                {newVehBrand === 'อื่นๆ' && (
                  <input
                    type="text"
                    value={newVehCustomBrand}
                    onChange={(e) => setNewVehCustomBrand(e.target.value)}
                    placeholder="ระบุยี่ห้อพาหนะ"
                    className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/30 rounded-xl text-[10px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                )}
                <button
                  type="button"
                  disabled={!newVehPlate.trim()}
                  onClick={handleAddVehicle}
                  className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 font-bold text-[10px] rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer border border-indigo-100"
                >
                  <Plus className="w-3.5 h-3.5" /> + เพิ่มยานพาหนะ
                </button>
              </div>
            </div>

            {/* Pet Section */}
            {(() => {
              const effectivePolicy = getEffectivePetPolicy(petPolicy);
              const isPetAllowed = effectivePolicy.allowed !== 'none' && effectivePolicy.allowed !== 'not_allowed';
              const allowedOptions = resolveAllowedPetOptions(effectivePolicy);

              if (!isPetAllowed) {
                return (
                  <div className="space-y-2 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-black text-slate-700">สัตว์เลี้ยงครอบครอง (0 ตัว)</label>
                      <span className="text-[8px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded-md">
                        ไม่อนุญาตให้เลี้ยง
                      </span>
                    </div>
                    <div className="p-3 bg-rose-50/80 border border-rose-200/70 rounded-xl flex items-center gap-2.5 text-xs text-rose-800">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <div>
                        <p className="font-bold text-[11px] leading-tight">หอพักไม่อนุญาตให้นำสัตว์เลี้ยงเข้าพัก</p>
                        <p className="text-[9px] text-rose-600 mt-0.5 font-medium">
                          ตามระเบียบและข้อกำหนดของหอพัก ไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด
                        </p>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-2.5 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-700">
                      สัตว์เลี้ยงครอบครอง ({editPets.length} ตัว)
                    </label>
                    <span className="text-[8px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                      อนุญาตตามเงื่อนไข
                    </span>
                  </div>

                  {/* List of current pets */}
                  <div className="space-y-1.5">
                    {editPets.map((p, idx) => (
                      <div
                        key={p.id || idx}
                        className="p-2.5 bg-white border border-slate-200/80 rounded-xl flex justify-between items-center text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="p-1.5 bg-amber-50 text-amber-600 rounded-lg text-xs shrink-0 flex items-center justify-center">
                            <PawPrint className="w-3.5 h-3.5" />
                          </span>
                          <div>
                            <p className="font-bold text-slate-800">
                              {p.type} {p.customType ? `(${p.customType})` : ''}
                            </p>
                            <p className="text-[10px] text-slate-500">ชื่อ: {p.name || '-'}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemovePet(idx)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="ลบสัตว์เลี้ยง"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {editPets.length === 0 && (
                      <p className="text-center py-2 text-slate-400 text-[10px] font-semibold bg-white/50 rounded-xl border border-dashed border-slate-200">
                        ยังไม่มีรายการสัตว์เลี้ยง
                      </p>
                    )}
                  </div>

                  {/* Add pet subsection (Harmonized with vehicle form) */}
                  <div className="p-3 bg-white border border-slate-200 rounded-xl space-y-2 shadow-2xs">
                    <label className="block text-[10px] font-bold text-slate-700">+ เพิ่มสัตว์เลี้ยงใหม่</label>
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={newPetType}
                        onChange={(e) => {
                          setNewPetType(e.target.value);
                          if (e.target.value !== 'other' && e.target.value !== 'อื่นๆ') {
                            setNewPetCustomType('');
                          }
                        }}
                        className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-xl text-[10px] text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">-- เลือกประเภท --</option>
                        {(allowedOptions.length > 0 ? allowedOptions : CANONICAL_PET_GROUP_OPTIONS).map(
                          (opt) => (
                            <option key={opt.id} value={opt.label.split(' ')[0]}>
                              {opt.label}
                            </option>
                          )
                        )}
                      </select>
                      <input
                        type="text"
                        value={newPetName}
                        onChange={(e) => setNewPetName(e.target.value)}
                        placeholder="ชื่อน้อง เช่น เจ้าส้ม"
                        className="w-full px-2.5 py-1.5 border border-slate-200 bg-white rounded-xl text-[10px] focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                    {(newPetType === 'other' || newPetType === 'อื่นๆ' || newPetType.includes('สัตว์แปลก')) && (
                      <input
                        type="text"
                        value={newPetCustomType}
                        onChange={(e) => setNewPetCustomType(e.target.value)}
                        placeholder="ระบุประเภท เช่น เต่า, เม่นแคระ, กิ้งก่า"
                        className="w-full px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/40 rounded-xl text-[10px] text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    )}
                    <button
                      type="button"
                      disabled={!newPetType}
                      onClick={handleAddPet}
                      className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-50 text-indigo-700 font-bold text-[10px] rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer border border-indigo-100"
                    >
                      <Plus className="w-3.5 h-3.5" /> + เพิ่มสัตว์เลี้ยง
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditingInfo(false)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-bold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-black transition-all cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
              </button>
            </div>
          </form>
        </TenantBottomSheet>

        {!hasRoom ? (
          <div className="py-16 text-center" data-testid="unregistered-profile-prompt">
            <p className="text-slate-400 font-semibold text-xs">ยังไม่มีข้อมูลในระบบ</p>
          </div>
        ) : (
          <>
            {/* Co-occupants section */}
            <div className="bg-white p-4 border border-slate-100 rounded-3xl space-y-3 shadow-2xs">
              <div className="flex justify-between items-center">
                <h5 className="font-black text-slate-800 text-xs">
                  รายชื่อผู้พักอาศัยร่วม ({(localTenant?.coOccupants || []).length} ท่าน)
                </h5>
                <button
                  type="button"
                  onClick={onOpenCoOccupantsModal}
                  className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-xl text-[9px] font-bold transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 className="w-3 h-3" /> แก้ไขข้อมูล
                </button>
              </div>
              {(localTenant?.coOccupants || []).map((co) => (
                <div
                  key={co.id}
                  className="p-3 bg-slate-50 border border-slate-100 rounded-xl text-[10px] space-y-0.5"
                >
                  <p className="font-bold text-slate-800">{co.name}</p>
                  <p className="text-slate-400">โทร: {co.phone}</p>
                </div>
              ))}
              {(!localTenant?.coOccupants || localTenant.coOccupants.length === 0) && (
                <p className="text-center text-[9px] text-slate-400 py-3 font-semibold">
                  ไม่มีผู้พักอาศัยร่วมลงทะเบียน
                </p>
              )}
            </div>

            {/* Move-out (แจ้งเลิกเช่า) Section (Fixed soft neutral border) */}
            <div className="bg-white p-4 border border-slate-200/60 rounded-3xl space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="font-black text-rose-900 text-xs">สัญญาเช่าและการแจ้งย้ายออก</h5>
                  <p className="text-[9px] text-slate-400 mt-0.5">
                    แจ้งความประสงค์เลิกเช่าห้องพักล่วงหน้าตามเงื่อนไขสัญญา
                  </p>
                </div>
              </div>

              {moveOutRequest ? (
                <div className="p-3.5 bg-amber-50 border border-amber-200/80 rounded-2xl space-y-2 text-[10px]">
                  <div className="flex items-center justify-between text-amber-900 font-extrabold">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      ส่งคำขอแจ้งย้ายออกแล้ว
                    </span>
                    <span className="text-[8px] bg-amber-200/80 text-amber-900 px-2 py-0.5 rounded-md">
                      รอการตรวจสอบ
                    </span>
                  </div>
                  <div className="text-slate-600 space-y-1 text-[9px]">
                    <p>
                      <strong>วันที่ประสงค์ย้ายออก:</strong> {formatToBeFullDate(moveOutRequest.desiredDate)}
                    </p>
                    {moveOutRequest.reason && (
                      <p>
                        <strong>เหตุผล:</strong> {moveOutRequest.reason}
                      </p>
                    )}
                    {moveOutRequest.bankInfo && (
                      <p>
                        <strong>บัญชีรับเงินประกันคืน:</strong> {moveOutRequest.bankInfo}{' '}
                        {moveOutRequest.accountInfo}
                      </p>
                    )}
                  </div>
                  <div className="pt-1 flex justify-end">
                    <button
                      onClick={handleCancelMoveOutRequest}
                      className="px-2.5 py-1 bg-white border border-amber-300 text-amber-900 hover:bg-amber-100 rounded-lg font-bold text-[9px] transition-all cursor-pointer"
                    >
                      ยกเลิกคำร้องย้ายออก
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <p className="text-[9px] text-slate-500 leading-relaxed bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    ท่านสามารถยื่นคำขอแจ้งย้ายออกได้ตามวันที่สะดวก โดยคำขอจะมีผลสมบูรณ์เมื่อเจ้าของหอพักอนุมัติและนัดหมายตรวจสภาพห้องเพื่อสรุปเงินประกันคืน
                  </p>
                  <button
                    type="button"
                    data-testid="button-tenant-moveout"
                    onClick={onOpenMoveOutModal}
                    className="w-full py-3 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-extrabold rounded-2xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-600" />
                    <span>แจ้งย้ายออก / เลิกเช่าห้องพัก</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
