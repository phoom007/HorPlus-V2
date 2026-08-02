/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Check,
  Gift,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Building,
  HelpCircle
} from 'lucide-react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';
import { saveOnboardingDraft } from '../../demo/demoSession';

export const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoError, setPromoError] = useState('');

  const plans = [
    {
      id: 'free',
      name: 'Free Plan',
      price: '0',
      period: 'ตลอดการใช้งาน',
      limit: 'รองรับสูงสุด 10 ห้อง',
      desc: 'เหมาะสำหรับบ้านเช่าหรือหอพักขนาดเล็กเริ่มต้น',
      popular: false,
      features: [
        'สูงสุด 10 ห้องพัก',
        'จัดการผังห้องและสัญญาเช่า',
        'จดมิเตอร์และออกบิลประจำเดือน',
        'Tenant Mobile Portal'
      ]
    },
    {
      id: 'paid',
      name: 'Paid Plan',
      price: '189',
      period: 'บาท / 1 เดือน (รวม VAT)',
      limit: 'รองรับสูงสุด 150 ห้อง',
      desc: 'เหมาะสำหรับหอพักและอพาร์ตเมนต์ทุกขนาด',
      popular: true,
      unconfirmedNotice: 'ระยะเวลา 3, 6, 12, 24 เดือน (ราคาอยู่ระหว่างการยืนยันรายละเอียดจาก Product Owner)',
      features: [
        'สูงสุด 150 ห้องพัก',
        'ครบทุกฟีเจอร์ใน Free Plan',
        'ระบบตรวจสลิปโอนเงิน PromptPay',
        'ระบบสถิติและรายงานงบการเงิน',
        'ผู้ใช้งานพนักงานและระบบแจ้งซ่อม',
        'การสนับสนุนช่วยเหลือจากทีมงาน'
      ]
    }
  ];

  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    setPromoError('');
    if ((promoCode || '').trim().toUpperCase() === 'HORPLUS') {
      setPromoApplied(true);
      saveOnboardingDraft({ promoCode: 'HORPLUS', isPromoApplied: true });
    } else {
      setPromoError('รหัสส่วนลดไม่ถูกต้อง (ลองใช้โค้ด HORPLUS)');
    }
  };

  const handleSelectPlan = (planId: string) => {
    saveOnboardingDraft({ selectedPlan: planId });
    navigate('/owner/register');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800 overflow-x-hidden">
      <PublicHeader />

      {/* Header Banner */}
      <section className="bg-slate-900 text-white py-14 sm:py-20 border-b border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-1/3 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4 relative z-10">
          <motion.span
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xs font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3.5 py-1.5 rounded-full inline-block"
          >
            TRANSPARENT PRICING
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black tracking-tight"
          >
            อัตราค่าบริการและแพ็กเกจ
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed font-medium"
          >
            ไม่มีค่าแรกเข้า ราคารวมภาษีมูลค่าเพิ่ม (VAT) แล้ว ทดลองใช้งานฟรี 30 วันแรกทุกแพ็กเกจ
          </motion.p>

          {/* Promo Box */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="pt-4 max-w-md mx-auto"
          >
            <form onSubmit={handleApplyPromo} className="bg-slate-800 border border-slate-700 p-2 rounded-2xl flex gap-2 shadow-lg">
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="ใส่โค้ดส่วนลด (เช่น HORPLUS)"
                className="bg-slate-900 border border-slate-700 text-white placeholder-slate-500 text-xs px-3.5 py-2.5 rounded-xl flex-1 focus:outline-hidden focus:border-indigo-500 uppercase font-mono font-bold"
              />
              <button
                type="submit"
                className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs rounded-xl cursor-pointer shadow-xs transition-all hover:scale-105 active:scale-95"
              >
                ใช้โค้ด
              </button>
            </form>

            {promoApplied && (
              <div className="mt-2.5 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-400 text-xs font-bold flex items-center justify-center gap-1.5 animate-in fade-in">
                <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>เปิดใช้งานโค้ด HORPLUS สำเร็จ! ขยายระยะเวลาทดลองเพิ่ม 60 วัน (รวม 90 วันเต็ม)</span>
              </div>
            )}

            {promoError && (
              <p className="mt-2 text-xs text-rose-400 font-bold">{promoError}</p>
            )}
          </motion.div>
        </div>
      </section>

      {/* Pricing Cards Grid */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {plans.map((p, idx) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: (idx % 3) * 0.1 }}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className={`relative bg-slate-50 border rounded-3xl p-6 sm:p-8 flex flex-col justify-between transition-all hover:shadow-xl ${
                  p.popular
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-gradient-to-b from-indigo-50/50 to-white'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {p.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-indigo-600 text-white font-extrabold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
                    แพ็กเกจยอดนิยมที่สุด
                  </div>
                )}

                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-black text-slate-900">{p.name}</h3>
                    <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">{p.desc}</p>
                  </div>

                  <div className="border-y border-slate-200/80 py-4">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl sm:text-4xl font-black text-slate-900">{p.price}</span>
                      <span className="text-xs font-extrabold text-slate-500">{p.period}</span>
                    </div>
                    <div className="mt-2 inline-block px-2.5 py-1 bg-indigo-100 text-indigo-800 text-[11px] font-bold rounded-lg">
                      ขนาดหอพัก: {p.limit}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">ฟังก์ชันการใช้งาน:</p>
                    <ul className="space-y-2.5 text-xs text-slate-700 font-medium">
                      {p.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="pt-8">
                  <button
                    onClick={() => handleSelectPlan(p.id)}
                    className={`w-full py-3.5 rounded-2xl font-black text-xs transition-all shadow-md cursor-pointer flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 ${
                      p.popular
                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
                        : 'bg-slate-900 hover:bg-slate-800 text-white'
                    }`}
                  >
                    <span>เลือกแพ็กเกจนี้</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  <p className="text-[10px] text-center text-slate-400 mt-2 font-medium">
                    {promoApplied ? 'ทดลองฟรี 90 วันแรกด้วยโค้ด HORPLUS' : 'ทดลองใช้ฟรี 30 วันแรก ไม่ต้องใช้บัตร'}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-16 bg-slate-100 border border-slate-200 p-6 sm:p-8 rounded-3xl text-xs text-slate-600 space-y-3"
          >
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-600" />
              <span>เงื่อนไขและข้อกำหนดแพ็กเกจ</span>
            </h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 list-disc list-inside font-medium">
              <li>ทุกราคาเป็นราคารวมภาษีมูลค่าเพิ่ม (VAT 7%) เรียบร้อยแล้ว</li>
              <li>การสมัครและชำระค่าบริการเป็นแบบแยกรายหอพัก (Subscription Per Dormitory)</li>
              <li>หากจำนวนห้องเกินสิทธิ์ของแพ็กเกจ สามารถอัปเกรดแพ็กเกจได้ตลอดเวลาโดยคิดเงินตามสัดส่วน</li>
              <li>โค้ดส่วนลด HORPLUS สามารถรับสิทธิ์ทดลองขยายเวลาเป็น 90 วันเต็มได้ 1 ครั้งต่อหอพัก</li>
            </ul>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
