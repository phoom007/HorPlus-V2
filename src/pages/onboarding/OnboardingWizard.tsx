/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Building2,
  Building,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Settings,
  CreditCard,
  Check,
  Gift,
  ShieldCheck,
  Sparkles,
  Edit3,
  HelpCircle,
  FileSpreadsheet,
  AlertCircle
} from 'lucide-react';
import {
  getOnboardingDraft,
  saveOnboardingDraft,
  clearOnboardingDraft,
  setOwnerDemoSession
} from '../../demo/demoSession';
import { addAuditLog, initialUsers } from '../../data/mockData';
import { DemoDisclosureBanner } from '../../components/public/DemoDisclosureBanner';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';

export const OnboardingWizard: React.FC = () => {
  const navigate = useNavigate();
  const { stepName } = useParams<{ stepName?: string }>();

  // Map step url name to step index
  const stepMap: Record<string, number> = {
    dormitory: 1,
    billing: 2,
    payment: 3,
    plan: 4,
    review: 5,
    complete: 6
  };

  const currentStep = stepName ? stepMap[stepName] || 1 : 1;

  // Local state initialized from draft
  const [draft, setDraft] = useState(() => getOnboardingDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [promoInput, setPromoInput] = useState(draft.promoCode);
  const [promoMessage, setPromoMessage] = useState('');

  // Sync draft updates
  const updateDraft = (updates: Partial<typeof draft>) => {
    const updated = saveOnboardingDraft(updates);
    setDraft(updated);
  };

  // Step 1 Validation (Dormitory Info)
  const validateStep1 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!draft.dormitoryName.trim()) {
      errs.dormitoryName = 'กรุณากรอกชื่อหอพัก';
    }
    if (!draft.address.trim()) {
      errs.address = 'กรุณากรอกที่อยู่หอพัก';
    }
    if (!draft.phone.trim()) {
      errs.phone = 'กรุณากรอกเบอร์โทรศัพท์ติดต่อ';
    } else if (!/^[0-9-]{9,12}$/.test(draft.phone.replace(/\s/g, ''))) {
      errs.phone = 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (ตัวอย่าง 0812345678)';
    }
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+\.com|\.[a-z]{2,}$/i.test(draft.email)) {
      errs.email = 'รูปแบบอีเมลไม่ถูกต้อง';
    }
    if (draft.approxRoomCount <= 0) {
      errs.approxRoomCount = 'จำนวนห้องพักต้องมากกว่า 0';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Step 2 Validation (Billing Rates)
  const validateStep2 = (): boolean => {
    const errs: Record<string, string> = {};
    if (draft.waterRate < 0) errs.waterRate = 'ค่าน้ำห้ามติดลบ';
    if (draft.electricRate < 0) errs.electricRate = 'ค่าไฟห้ามติดลบ';
    if (draft.commonFee < 0) errs.commonFee = 'ค่าส่วนกลางห้ามติดลบ';
    if (draft.dueDate < 1 || draft.dueDate > 31) errs.dueDate = 'วันครบกำหนดชำระต้องอยู่ในช่วง 1-31';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // Step 3 Validation (Payment Method)
  const validateStep3 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!draft.cashOnly) {
      if (!draft.promptPayNumber.trim()) {
        errs.promptPayNumber = 'กรุณากรอกเบอร์ PromptPay หรือเลขประจำตัวประชาชน';
      }
      if (!draft.accountName.trim()) {
        errs.accountName = 'กรุณากรอกชื่อบัญชีรับเงิน';
      }
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 1 && !validateStep1()) return;
    if (currentStep === 2 && !validateStep2()) return;
    if (currentStep === 3 && !validateStep3()) return;

    const nextStepNum = currentStep + 1;
    const stepKeys = ['', 'dormitory', 'billing', 'payment', 'plan', 'review', 'complete'];
    if (nextStepNum <= 6) {
      updateDraft({ step: nextStepNum });
      navigate(`/onboarding/${stepKeys[nextStepNum]}`);
    }
  };

  const handleBack = () => {
    const prevStepNum = currentStep - 1;
    const stepKeys = ['', 'dormitory', 'billing', 'payment', 'plan', 'review', 'complete'];
    if (prevStepNum >= 1) {
      navigate(`/onboarding/${stepKeys[prevStepNum]}`);
    } else {
      navigate('/auth/owner');
    }
  };

  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    if ((promoInput || '').trim().toUpperCase() === 'HORPLUS') {
      updateDraft({ promoCode: 'HORPLUS', isPromoApplied: true });
      setPromoMessage('ใช้โค้ด HORPLUS สำเร็จ! ขยายทดลองเพิ่ม 60 วัน (รวม 90 วัน)');
    } else {
      setPromoMessage('รหัสส่วนลดไม่ถูกต้อง');
    }
  };

  const handleCompleteOnboarding = () => {
    // Create new owner demo user
    const newOwner: any = {
      id: `user-owner-${Date.now()}`,
      name: draft.dormitoryName ? `เจ้าของ${draft.dormitoryName}` : 'เจ้าของหอพักใหม่',
      avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150',
      roleId: 'role-owner',
      roleName: 'เจ้าของระบบ',
      email: draft.email || 'owner@horplus.demo',
      description: 'เจ้าของหอพักที่ลงทะเบียนสำเร็จผ่าน Onboarding',
      createdAt: new Date().toISOString()
    };

    // Save session
    setOwnerDemoSession(newOwner);
    addAuditLog(newOwner.id, 'ONBOARDING_COMPLETE', `ลงทะเบียนหอพัก ${draft.dormitoryName} สำเร็จ`, 'DORMITORY', 'dorm-new');

    clearOnboardingDraft();
    navigate('/onboarding/complete');
  };

  const stepsList = [
    { num: 1, key: 'dormitory', label: 'ข้อมูลหอพัก' },
    { num: 2, key: 'billing', label: 'ตั้งค่าค่าน้ำไฟ' },
    { num: 3, key: 'payment', label: 'การรับชำระ' },
    { num: 4, key: 'plan', label: 'แพ็กเกจ' },
    { num: 5, key: 'review', label: 'ตรวจสอบ' }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800">
      <PublicHeader />

      {/* Progress Header Bar */}
      <div className="bg-slate-900 text-white py-6 px-4 border-b border-slate-800">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-black">เริ่มต้นใช้งานเจ้าของหอพัก HorPlus</h1>
              <p className="text-xs text-slate-400">ขั้นตอนการตั้งค่าหอพักฉบับ Onboarding</p>
            </div>
            <span className="text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full">
              ขั้นตอน {currentStep} จาก 5
            </span>
          </div>

          {/* Stepper Pills */}
          {currentStep <= 5 && (
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
              {stepsList.map((s) => (
                <button
                  key={s.num}
                  onClick={() => {
                    if (s.num < currentStep) navigate(`/onboarding/${s.key}`);
                  }}
                  disabled={s.num > currentStep}
                  className={`h-2 rounded-full transition-all ${s.num === currentStep
                      ? 'bg-indigo-500'
                      : s.num < currentStep
                        ? 'bg-emerald-500 cursor-pointer'
                        : 'bg-slate-800'
                    }`}
                  title={`${s.num}. ${s.label}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {/* STEP 1: DORMITORY INFO */}
        {currentStep === 1 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md animate-in fade-in">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-900">ขั้นตอนที่ 1: ข้อมูลหอพักและอาคาร</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">กรอกข้อมูลพื้นฐานของหอพักเพื่อสร้างระบบผังห้องพัก</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-semibold">
              <div className="space-y-1.5 md:col-span-2">
                <label className="text-slate-700 font-bold">ชื่อหอพัก / อาคาร <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={draft.dormitoryName}
                  onChange={(e) => updateDraft({ dormitoryName: e.target.value })}
                  placeholder="เช่น หอพักอมรเกียรติ พรีเมียม"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.dormitoryName && <p className="text-rose-500 font-bold text-[11px]">{errors.dormitoryName}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">ประเภทอาคาร</label>
                <select
                  value={draft.dormitoryType}
                  onChange={(e) => updateDraft({ dormitoryType: e.target.value })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                >
                  <option value="หอพักสตรี/ชายทั่วไป">หอพักสตรี/ชายทั่วไป</option>
                  <option value="อพาร์ตเมนต์">อพาร์ตเมนต์</option>
                  <option value="คอนโดมิเนียมปล่อยเช่า">คอนโดมิเนียมปล่อยเช่า</option>
                  <option value="บ้านเช่า/อาคารพาณิชย์">บ้านเช่า/อาคารพาณิชย์</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">จังหวัด <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={draft.province}
                  onChange={(e) => updateDraft({ province: e.target.value })}
                  placeholder="กรุงเทพมหานคร"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-slate-700 font-bold">ที่อยู่หอพัก <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={draft.address}
                  onChange={(e) => updateDraft({ address: e.target.value })}
                  placeholder="เช่น 123/45 ถนนพหลโยธิน แขวงลาดยาว เขตจตุจักร"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.address && <p className="text-rose-500 font-bold text-[11px]">{errors.address}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">เบอร์โทรศัพท์ติดต่อ <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={draft.phone}
                  onChange={(e) => updateDraft({ phone: e.target.value })}
                  placeholder="0812345678"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.phone && <p className="text-rose-500 font-bold text-[11px]">{errors.phone}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">อีเมลติดต่อ</label>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => updateDraft({ email: e.target.value })}
                  placeholder="owner@mybuilding.com"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.email && <p className="text-rose-500 font-bold text-[11px]">{errors.email}</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">จำนวนอาคาร</label>
                <input
                  type="number"
                  min={1}
                  value={draft.buildingCount}
                  onChange={(e) => updateDraft({ buildingCount: parseInt(e.target.value) || 1 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">ประมาณการจำนวนห้องพักทั้งหมด <span className="text-rose-500">*</span></label>
                <input
                  type="number"
                  min={1}
                  value={draft.approxRoomCount}
                  onChange={(e) => updateDraft({ approxRoomCount: parseInt(e.target.value) || 10 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.approxRoomCount && <p className="text-rose-500 font-bold text-[11px]">{errors.approxRoomCount}</p>}
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                onClick={handleNext}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <span>ถัดไป: ตั้งค่าค่าน้ำไฟ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: BILLING DEFAULTS */}
        {currentStep === 2 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md animate-in fade-in">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-900">ขั้นตอนที่ 2: ตั้งค่าอัตราค่าน้ำ ไฟฟ้า และวันตัดรอบบิล</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">กำหนดค่าน้ำ ค่าไฟ และค่าบริการส่วนกลางสำหรับคำนวณบิลประจำเดือน</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs font-semibold">
              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">อัตราค่าน้ำ (บาท/ยูนิต)</label>
                <input
                  type="number"
                  value={draft.waterRate}
                  onChange={(e) => updateDraft({ waterRate: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">อัตราค่าไฟฟ้า (บาท/ยูนิต)</label>
                <input
                  type="number"
                  value={draft.electricRate}
                  onChange={(e) => updateDraft({ electricRate: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">ค่าส่วนกลางประจำเดือน (บาท)</label>
                <input
                  type="number"
                  value={draft.commonFee}
                  onChange={(e) => updateDraft({ commonFee: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">ค่าปรับชำระล่าช้า (บาท/วัน)</label>
                <input
                  type="number"
                  value={draft.lateFeePerDay}
                  onChange={(e) => updateDraft({ lateFeePerDay: parseFloat(e.target.value) || 0 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">วันที่ออกบิลประจำเดือน (วันที่)</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.billingDate}
                  onChange={(e) => updateDraft({ billingDate: parseInt(e.target.value) || 25 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-700 font-bold">วันครบกำหนดชำระเงิน (วันที่)</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={draft.dueDate}
                  onChange={(e) => updateDraft({ dueDate: parseInt(e.target.value) || 5 })}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500 focus:outline-hidden"
                />
                {errors.dueDate && <p className="text-rose-500 font-bold text-[11px]">{errors.dueDate}</p>}
              </div>
            </div>

            {/* Bill Preview Card */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
              <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
                <span>ตัวอย่างการคำนวณบิลประจำเดือน (ห้องตัวอย่าง)</span>
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600">
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span>ค่าน้ำ (10 ยูนิต):</span>
                  <span className="font-bold text-slate-900 block">{(10 * draft.waterRate).toLocaleString()} THB</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span>ค่าไฟ (150 ยูนิต):</span>
                  <span className="font-bold text-slate-900 block">{(150 * draft.electricRate).toLocaleString()} THB</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span>ค่าส่วนกลาง:</span>
                  <span className="font-bold text-slate-900 block">{draft.commonFee.toLocaleString()} THB</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span>วันที่กำหนดจ่าย:</span>
                  <span className="font-bold text-indigo-600 block">ทุกวันที่ {draft.dueDate} ของเดือน</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                onClick={handleNext}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <span>ถัดไป: บัญชีรับชำระ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PAYMENT INFO */}
        {currentStep === 3 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md animate-in fade-in">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-900">ขั้นตอนที่ 3: ข้อมูลรับชำระเงินและ PromptPay</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">ข้อมูลสำหรับสร้าง QR Code ชำระเงินให้ผู้เช่าใน Tenant Portal</p>
            </div>

            <div className="space-y-4 text-xs font-semibold">
              <label className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={draft.cashOnly}
                  onChange={(e) => updateDraft({ cashOnly: e.target.checked })}
                  className="w-4 h-4 text-indigo-600 rounded-md"
                />
                <span className="font-bold text-slate-900">รับเฉพาะเงินสดใน Demo (ข้ามการตั้งค่า PromptPay)</span>
              </label>

              {!draft.cashOnly && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                  <div className="space-y-1.5">
                    <label className="text-slate-700 font-bold">ประเภท PromptPay</label>
                    <select
                      value={draft.promptPayType}
                      onChange={(e) => updateDraft({ promptPayType: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500"
                    >
                      <option value="mobile">เบอร์โทรศัพท์มือถือ (10 หลัก)</option>
                      <option value="citizenId">เลขประจำตัวผู้เสียภาษี/บัตรประชาชน (13 หลัก)</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-700 font-bold">หมายเลข PromptPay <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={draft.promptPayNumber}
                      onChange={(e) => updateDraft({ promptPayNumber: e.target.value })}
                      placeholder="0812345678"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500"
                    />
                    {errors.promptPayNumber && <p className="text-rose-500 font-bold text-[11px]">{errors.promptPayNumber}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-700 font-bold">ชื่อบัญชีผู้รับเงิน <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      value={draft.accountName}
                      onChange={(e) => updateDraft({ accountName: e.target.value })}
                      placeholder="นายสมศักดิ์ บริหารหอ"
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500"
                    />
                    {errors.accountName && <p className="text-rose-500 font-bold text-[11px]">{errors.accountName}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-slate-700 font-bold">ธนาคารเจ้าของบัญชี</label>
                    <select
                      value={draft.bankName}
                      onChange={(e) => updateDraft({ bankName: e.target.value })}
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-500"
                    >
                      <option value="ธนาคารกสิกรไทย">ธนาคารกสิกรไทย (KBANK)</option>
                      <option value="ธนาคารไทยพาณิชย์">ธนาคารไทยพาณิชย์ (SCB)</option>
                      <option value="ธนาคารกรุงเทพ">ธนาคารกรุงเทพ (BBL)</option>
                      <option value="ธนาคารกรุงไทย">ธนาคารกรุงไทย (KTB)</option>
                      <option value="ธนาคารกรุงศรีอยุธยา">ธนาคารกรุงศรีอยุธยา (BAY)</option>
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-900 font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>หมายเหตุ: ใน Demo Mode สามารถใช้เลขและชื่อบัญชีจำลองได้โดยไม่ต้องกรอกข้อมูลการเงินจริง</span>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                onClick={handleNext}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <span>ถัดไป: เลือกแพ็กเกจ</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: PACKAGE & PROMO */}
        {currentStep === 4 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md animate-in fade-in">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-900">ขั้นตอนที่ 4: เลือกแพ็กเกจการใช้งาน</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">ทดลองใช้ฟรี 30 วันแรกทุกแพ็กเกจ ไม่เรียกเก็บเงินในโหมดสาธิต</p>
            </div>

            {/* Promo Code input */}
            <form onSubmit={handleApplyPromo} className="bg-slate-50 border border-slate-200 p-4 rounded-2xl flex flex-col sm:flex-row gap-2 items-center">
              <span className="text-xs font-bold text-slate-700 whitespace-nowrap">โค้ดส่วนลด Demo:</span>
              <input
                type="text"
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                placeholder="กรอกโค้ด HORPLUS"
                className="bg-white border border-slate-200 text-xs px-3 py-2 rounded-xl flex-1 uppercase font-mono font-bold focus:outline-hidden focus:border-indigo-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white font-bold text-xs rounded-xl cursor-pointer hover:bg-indigo-700"
              >
                ใช้โค้ด
              </button>
            </form>
            {promoMessage && (
              <p className="text-xs font-bold text-emerald-600 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                {promoMessage}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              {[
                { id: 'free', name: 'Free Plan', price: '0 บาท', limit: '10 ห้อง' },
                { id: 'micro', name: 'Micro Plan', price: '189 บาท/เดือน', limit: '25 ห้อง' },
                { id: 'small', name: 'Small Plan', price: '529 บาท/เดือน', limit: '50 ห้อง' },
                { id: 'medium', name: 'Medium Plan', price: '999 บาท/เดือน', limit: '100 ห้อง' },
                { id: 'large', name: 'Large Plan', price: '1,799 บาท/เดือน', limit: '200 ห้อง' },
                { id: 'enterprise', name: 'Enterprise', price: '2,999 บาท/เดือน', limit: 'ไม่จำกัด' }
              ].map((p) => (
                <div
                  key={p.id}
                  onClick={() => updateDraft({ selectedPlan: p.id })}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${draft.selectedPlan === p.id
                      ? 'border-indigo-600 bg-indigo-50/70 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-black text-slate-900">{p.name}</h4>
                    {draft.selectedPlan === p.id && (
                      <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                    )}
                  </div>
                  <p className="font-bold text-indigo-600 text-sm">{p.price}</p>
                  <p className="text-[11px] text-slate-500 mt-1">สูงสุด {p.limit}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                onClick={handleNext}
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer"
              >
                <span>ถัดไป: ตรวจสอบสรุป</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 5: SUMMARY REVIEW */}
        {currentStep === 5 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-10 space-y-8 shadow-md animate-in fade-in">
            <div className="border-b border-slate-100 pb-4">
              <h2 className="text-xl font-black text-slate-900">ขั้นตอนที่ 5: ตรวจสอบข้อมูลก่อนยืนยัน</h2>
              <p className="text-xs text-slate-500 font-medium mt-1">ตรวจสอบข้อมูลหอพักและสิทธิประโยชน์ก่อนเริ่มเปิดใช้งานระบบ</p>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-sm">1. ข้อมูลหอพัก</h4>
                  <button onClick={() => navigate('/onboarding/dormitory')} className="text-indigo-600 font-bold hover:underline flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> แก้ไข
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <p><strong>ชื่อหอพัก:</strong> {draft.dormitoryName || 'ไม่ได้ระบุ'}</p>
                  <p><strong>ประเภท:</strong> {draft.dormitoryType}</p>
                  <p><strong>เบอร์โทร:</strong> {draft.phone || 'ไม่ได้ระบุ'}</p>
                  <p><strong>จังหวัด:</strong> {draft.province}</p>
                  <p><strong>จำนวนห้อง:</strong> {draft.approxRoomCount} ห้อง ({draft.buildingCount} อาคาร)</p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-sm">2. การเงินและค่าน้ำไฟ</h4>
                  <button onClick={() => navigate('/onboarding/billing')} className="text-indigo-600 font-bold hover:underline flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> แก้ไข
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 text-slate-600">
                  <p><strong>ค่าน้ำ:</strong> {draft.waterRate} THB/ยูนิต</p>
                  <p><strong>ค่าไฟ:</strong> {draft.electricRate} THB/ยูนิต</p>
                  <p><strong>ค่าส่วนกลาง:</strong> {draft.commonFee} THB</p>
                  <p><strong>กำหนดชำระ:</strong> ทุกวันที่ {draft.dueDate} ของเดือน</p>
                </div>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-slate-900 text-sm">3. การรับชำระเงิน</h4>
                  <button onClick={() => navigate('/onboarding/payment')} className="text-indigo-600 font-bold hover:underline flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> แก้ไข
                  </button>
                </div>
                <div className="text-slate-600">
                  {draft.cashOnly ? (
                    <p>รับเฉพาะเงินสดใน Demo</p>
                  ) : (
                    <p><strong>PromptPay:</strong> {draft.promptPayNumber} ({draft.accountName} - {draft.bankName})</p>
                  )}
                </div>
              </div>

              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-extrabold text-indigo-950 text-sm">4. แพ็กเกจที่เลือก</h4>
                  <button onClick={() => navigate('/onboarding/plan')} className="text-indigo-600 font-bold hover:underline flex items-center gap-1">
                    <Edit3 className="w-3 h-3" /> แก้ไข
                  </button>
                </div>
                <p className="text-indigo-900 font-bold text-sm">
                  {(draft.selectedPlan || '').toUpperCase()} PLAN
                  {draft.isPromoApplied && <span className="ml-2 text-emerald-600 font-normal text-xs">(ทดลองฟรี 90 วันเต็มด้วยโค้ด HORPLUS)</span>}
                </p>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t border-slate-100">
              <button
                onClick={handleBack}
                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                onClick={handleCompleteOnboarding}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-2xl shadow-xl flex items-center gap-2 cursor-pointer"
              >
                <span>ยืนยันสร้างหอพักและเข้าสู่ Dashboard</span>
                <CheckCircle2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 6: COMPLETE */}
        {currentStep === 6 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-8 sm:p-12 text-center space-y-6 shadow-xl animate-in zoom-in-95 duration-200">
            <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <h2 className="text-2xl font-black text-slate-900">การตั้งค่าหอพักเสร็จสมบูรณ์!</h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                ระบบได้สร้างเรคคอร์ดหอพัก สมาชิกเจ้าของหอพัก และการตั้งค่าเริ่มต้นเรียบร้อยแล้ว คุณสามารถเข้าจัดการหอพักใน Owner Workspace ได้ทันที
              </p>
            </div>

            <div className="pt-4 flex justify-center">
              <Link
                to="/owner/dashboard"
                className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-sm rounded-2xl shadow-xl flex items-center gap-2 cursor-pointer"
              >
                <span>เข้าสู่ Owner Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        )}
      </div>

      <PublicFooter />
    </div>
  );
};
