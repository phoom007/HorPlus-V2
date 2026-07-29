/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Building2,
  Zap,
  ShieldCheck,
  FileText,
  Users,
  Gauge,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Smartphone,
  ChevronDown,
  Wrench,
  BarChart3,
  Building,
  CreditCard,
  UserCheck,
  HelpCircle,
  Gift,
  Check
} from 'lucide-react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeFaq, setActiveFaq] = useState<number | null>(0);

  const faqs = [
    {
      q: 'HorPlus สามารถทดลองใช้งานฟรีได้อย่างไร?',
      a: 'เจ้าของหอพักสามารถลงทะเบียนและเริ่มใช้งานได้ฟรีทันที 30 วัน โดยไม่ต้องกรอกข้อมูลบัตรเครดิต หากใส่โค้ดส่วนลด HORPLUS ในขั้นตอนการเลือกแพ็กเกจ จะได้รับระยะเวลาทดลองเพิ่มอีก 60 วัน รวมเป็น 90 วันเต็ม'
    },
    {
      q: 'มีข้อจำกัดจำนวนห้องพักในแต่ละแพ็กเกจหรือไม่?',
      a: 'แพ็กเกจเริ่มต้นที่ Free (รองรับ 10 ห้อง), Micro 189 บาท/เดือน (25 ห้อง), Small 529 บาท/เดือน (50 ห้อง), Medium 999 บาท/เดือน (100 ห้อง), Large 1,799 บาท/เดือน (200 ห้อง) และ Enterprise 2,999 บาท/เดือน สำหรับหอพักขนาดใหญ่ไม่จำกัดจำนวนห้อง'
    },
    {
      q: 'ผู้เช่าสามารถเข้าใช้งานผ่านอุปกรณ์ใดได้บ้าง?',
      a: 'ผู้เช่าสามารถเข้าใช้งานผ่าน Tenant Mobile Portal ได้จากเว็บบราวเซอร์บนสมาร์ตโฟน (iOS และ Android) โดยไม่ต้องดาวน์โหลดแอปพลิเคชัน สามารถดูบิล แนบสลิป แจ้งซ่อม และเช็กสัญญาได้ทันที'
    },
    {
      q: 'ระบบรองรับการสร้างบัญชีผู้ใช้งานหลายระดับสิทธิ์หรือไม่?',
      a: 'รองรับอย่างสมบูรณ์แบบ ทั้งระดับเจ้าของระบบ (Owner), ผู้จัดการหอพัก (Manager), เจ้าหน้าที่การเงิน (Finance) และช่าง/แม่บ้าน (Staff) เพื่อจำกัดการเข้าถึงข้อมูลตามหน้าที่อย่างปลอดภัย'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800 overflow-x-hidden">
      <PublicHeader />

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-b from-indigo-950 via-slate-900 to-slate-950 text-white pt-12 pb-20 lg:pt-20 lg:pb-28">
        {/* Subtle background blur circles */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-1/3 right-10 w-[400px] h-[400px] bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-[350px] h-[350px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto space-y-6">
            {/* Tag Badge */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-400/30 text-indigo-300 text-xs font-extrabold shadow-inner backdrop-blur-md"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
              <span>HorPlus — แพลตฟอร์มจัดการหอพักยุคใหม่</span>
              <span className="bg-indigo-500 text-white text-[9px] px-1.5 py-0.2 rounded-full font-black">PROTOTYPE DEMO</span>
            </motion.div>

            {/* Main Title */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-tight text-white"
            >
              จัดการหอพักง่ายขึ้น <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-300 via-sky-300 to-teal-200">
                ออกบิล ตรวจสลิป จดมิเตอร์
              </span> ครบในที่เดียว
            </motion.h1>

            {/* Description */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-sm sm:text-base lg:text-lg text-slate-300 font-medium leading-relaxed max-w-2xl mx-auto"
            >
              ลดเวลาทำงานของเจ้าของและนิติบุคคลด้วยระบบบริหารจัดการหอพักอัตโนมัติ เชื่อมโยงทุกฝั่ง ทั้งเจ้าของ ผู้จัดการ ช่าง และผู้เช่าได้อย่างราบรื่น
            </motion.p>

            {/* CTA Action Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3"
            >
              <Link
                to="/owner/register"
                className="w-full sm:w-auto px-7 py-3.5 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white font-black text-sm rounded-2xl shadow-xl shadow-indigo-500/25 flex items-center justify-center gap-2 transition-all hover:scale-[1.03] cursor-pointer active:scale-95"
              >
                <span>เริ่มใช้งานสำหรับเจ้าของหอพัก</span>
                <ArrowRight className="w-4 h-4" />
              </Link>

              <Link
                to="/auth/owner"
                className="w-full sm:w-auto px-6 py-3.5 bg-slate-800/90 hover:bg-slate-800 text-slate-100 font-extrabold text-sm rounded-2xl border border-slate-700/80 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md hover:border-slate-600"
              >
                <Building className="w-4 h-4 text-indigo-400" />
                <span>เข้าสู่ระบบเจ้าของหอ</span>
              </Link>

              <Link
                to="/demo"
                className="w-full sm:w-auto px-6 py-3.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 font-extrabold text-sm rounded-2xl border border-emerald-800/80 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md"
              >
                <UserCheck className="w-4 h-4 text-emerald-400" />
                <span>ผู้เช่าเข้าสู่ระบบ</span>
              </Link>

              <Link
                to="/demo"
                className="w-full sm:w-auto px-5 py-3.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-extrabold text-sm rounded-2xl border border-amber-500/40 flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-amber-400" />
                <span>ทดลองระบบ Demo</span>
              </Link>
            </motion.div>

            {/* Trust points */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="pt-6 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400 font-semibold"
            >
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>ทดลองใช้ฟรี 30 วัน</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>ใช้โค้ด HORPLUS รวมทดลอง 90 วัน</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>ไม่ต้องกรอกบัตรเครดิต</span>
              </div>
            </motion.div>
          </div>

          {/* Product Preview Cards Grid */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.7 }}
            className="mt-14 max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {[
              {
                icon: Gauge,
                color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
                title: 'จดมิเตอร์น้ำไฟรวดเร็ว',
                desc: 'ระบบเดินจดมิเตอร์สำหรับพนักงานช่าง รองรับการป้อนค่ามิเตอร์เดือนล่าสุด พร้อมคำนวณส่วนต่างยูนิตอัตโนมัติ'
              },
              {
                icon: FileSpreadsheet,
                color: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
                title: 'คำนวณและออกบิลอัตโนมัติ',
                desc: 'สร้างใบแจ้งหนี้ประจำเดือน คำนวณค่าน้ำ ค่าไฟ ค่าเช่า และค่าส่วนกลางอย่างแม่นยำ พร้อมส่งบิลตรงถึงผู้เช่า'
              },
              {
                icon: Smartphone,
                color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                title: 'Tenant Mobile Portal',
                desc: 'ผู้เช่าดูรายการบิล สแกน QR โอนเงิน แนบหลักฐานสลิป ดูใบเสร็จรับเงิน และส่งคำขอแจ้งซ่อมผ่านมือถือ'
              }
            ].map((card, idx) => (
              <motion.div
                key={idx}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="bg-slate-800/80 border border-slate-700/70 p-6 rounded-3xl space-y-3 backdrop-blur-md shadow-xl hover:shadow-indigo-500/10 hover:border-indigo-500/50 transition-all"
              >
                <div className={`w-11 h-11 rounded-2xl ${card.color} border flex items-center justify-center font-bold`}>
                  <card.icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-extrabold text-white">{card.title}</h3>
                <p className="text-xs text-slate-300 leading-relaxed font-medium">
                  {card.desc}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Highlights & Features Overview */}
      <section className="py-20 bg-white border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-2xl mx-auto mb-14 space-y-3"
          >
            <h2 className="text-xs font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-3.5 py-1.5 rounded-full w-fit mx-auto border border-indigo-100">
              ฟังก์ชันการใช้งานครอบคลุม
            </h2>
            <h3 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
              ครบทุกความต้องการในการบริหารหอพัก
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              ออกแบบมาโดยเฉพาะเพื่อตอบโจทย์ผู้ประกอบการหอพัก อพาร์ตเมนต์ และคอนโดมิเนียมในประเทศไทย
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                icon: Building,
                bg: 'bg-indigo-600',
                title: 'จัดการอาคารและผังห้อง',
                desc: 'ดูสถานะห้องพักว่าง ห้องมีผู้เช่า ห้องจอง และห้องแจ้งซ่อม ได้อย่างชัดเจนจากแผนผังอาคาร'
              },
              {
                icon: Users,
                bg: 'bg-sky-600',
                title: 'ทะเบียนผู้เช่าและสัญญา',
                desc: 'จัดเก็บข้อมูลผู้เช่า เอกสารบัตร สัญญาเช่า เงินประกัน และวันสิ้นสุดสัญญา พร้อมการแจ้งเตือนสัญญาล่วงหน้า'
              },
              {
                icon: CreditCard,
                bg: 'bg-emerald-600',
                title: 'ตรวจสอบสลิปและใบเสร็จ',
                desc: 'นิติตรวจสอบการชำระเงิน สลิปโอนเงิน และกดยืนยันออกใบเสร็จรับเงินให้อย่างรวดเร็ว'
              },
              {
                icon: Wrench,
                bg: 'bg-amber-600',
                title: 'ระบบแจ้งซ่อมและประเมิน',
                desc: 'ผู้เช่าแจ้งเรื่องซ่อมแซมพร้อมแนบรูปภาพ พนักงานอัปเดตสถานะงาน และผู้เช่ากดประเมินความพึงพอใจ'
              }
            ].map((feat, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                whileHover={{ y: -6, transition: { duration: 0.2 } }}
                className="p-6 bg-slate-50/80 border border-slate-200/90 rounded-3xl space-y-3.5 hover:border-indigo-400 hover:bg-white transition-all hover:shadow-xl hover:shadow-indigo-500/5 group"
              >
                <div className={`w-11 h-11 rounded-2xl ${feat.bg} text-white flex items-center justify-center font-bold shadow-md shadow-indigo-500/10 group-hover:scale-110 transition-transform`}>
                  <feat.icon className="w-5.5 h-5.5" />
                </div>
                <h4 className="text-base font-black text-slate-900">{feat.title}</h4>
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  {feat.desc}
                </p>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="mt-12 text-center"
          >
            <Link
              to="/features"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs rounded-2xl shadow-lg transition-all hover:scale-105 cursor-pointer active:scale-95"
            >
              <span>ดูรายละเอียดฟีเจอร์ทั้งหมด</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Target User Roles */}
      <section className="py-20 bg-slate-100/70 border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-2xl mx-auto mb-14 space-y-2"
          >
            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
              ออกแบบมาเพื่อทุกบทบาทในหอพัก
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 font-medium">
              ยืดหยุ่นด้วยระบบกำหนดสิทธิ์เข้าใช้งานตามหน้าที่ของบุคลากรแต่ละท่าน
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {[
              {
                num: '1',
                color: 'bg-indigo-100 text-indigo-700',
                role: 'เจ้าของระบบ (Owner)',
                desc: 'เห็นสถิติรายรับรายจ่าย ควบคุมงบการเงิน ตั้งค่าหอพัก อนุมัติสิทธิ์พนักงาน และดูแลสัญญาทั้งหมด'
              },
              {
                num: '2',
                color: 'bg-purple-100 text-purple-700',
                role: 'ผู้จัดการหอพัก (Manager)',
                desc: 'จัดการสัญญา ทะเบียนผู้เช่า ออกบิล ตรวจรับชำระเงิน ประสานงานซ่อมแซม และดูแลความเรียบร้อย'
              },
              {
                num: '3',
                color: 'bg-amber-100 text-amber-700',
                role: 'พนักงานช่าง/แม่บ้าน (Staff)',
                desc: 'เดินจดมิเตอร์น้ำไฟบันทึกเข้าสู่ระบบ ดูรายการแจ้งซ่อมประจำวัน และอัปเดตสถานะซ่อมแซม'
              },
              {
                num: '4',
                color: 'bg-emerald-100 text-emerald-700',
                role: 'ผู้เช่าห้องพัก (Tenant)',
                desc: 'เช็กบิลประจำเดือน สแกนจ่าย โอนแนบสลิป รับใบเสร็จ ดูสัญญา และส่งคำขอแจ้งซ่อมในห้อง'
              }
            ].map((r, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 35 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                whileHover={{ y: -5, transition: { duration: 0.2 } }}
                className="bg-white p-6 rounded-3xl border border-slate-200/90 shadow-xs space-y-3 hover:shadow-md hover:border-indigo-300 transition-all"
              >
                <div className={`w-9 h-9 rounded-xl ${r.color} flex items-center justify-center font-black text-xs`}>
                  {r.num}
                </div>
                <h4 className="text-base font-black text-slate-900">{r.role}</h4>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  {r.desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Teaser */}
      <section className="py-20 bg-white border-b border-slate-200/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.6 }}
            className="flex flex-col md:flex-row items-center justify-between gap-8 bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 text-white p-8 sm:p-12 rounded-3xl shadow-2xl relative overflow-hidden border border-indigo-500/30"
          >
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

            <div className="space-y-4 max-w-xl relative z-10">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-400/30">
                <Gift className="w-3.5 h-3.5 text-amber-400" />
                <span>โปรโมชันพิเศษต้อนรับสมาชิกใหม่</span>
              </div>
              <h3 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
                ทดลองใช้ฟรี 30 วัน <br />
                <span className="text-amber-300">
                  ใส่โค้ด HORPLUS <br />
                  รวมทดลอง 90 วันเต็ม
                </span>
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-medium">
                เลือกแพ็กเกจที่เหมาะสมกับจำนวนห้องพักของคุณ เริ่มต้นเพียง 189 บาท/เดือน ราคารวม VAT ไม่มีค่าธรรมเนียมแอบแฝง
              </p>
            </div>

            <div className="shrink-0 flex flex-col gap-3 relative z-10 w-full md:w-auto">
              <Link
                to="/pricing"
                className="px-7 py-3.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-sm rounded-2xl shadow-xl text-center transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                ดูราคาและเปรียบเทียบแพ็กเกจ
              </Link>
              <Link
                to="/owner/register"
                className="px-7 py-3.5 bg-white/10 hover:bg-white/20 text-white border border-white/25 font-extrabold text-sm rounded-2xl text-center transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                ลงทะเบียนเริ่มทดลองทันที
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 bg-slate-50 border-b border-slate-200/80">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12 space-y-2"
          >
            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 tracking-tight">
              คำถามที่พบบ่อย (FAQ)
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 font-medium">
              ข้อสงสัยยอดนิยมเกี่ยวกับการทดลองใช้งานระบบ HorPlus
            </p>
          </motion.div>

          <div className="space-y-3.5">
            {faqs.map((faq, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: idx * 0.08 }}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs transition-all hover:border-indigo-300"
              >
                <button
                  onClick={() => setActiveFaq(activeFaq === idx ? null : idx)}
                  className="w-full p-4.5 text-left font-bold text-xs sm:text-sm text-slate-900 flex items-center justify-between gap-3 cursor-pointer"
                >
                  <span>{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${
                      activeFaq === idx ? 'rotate-180 text-indigo-600' : ''
                    }`}
                  />
                </button>
                {activeFaq === idx && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    transition={{ duration: 0.3 }}
                    className="px-4.5 pb-4 pt-1 text-xs text-slate-600 leading-relaxed border-t border-slate-100 bg-slate-50/50 font-medium"
                  >
                    {faq.a}
                  </motion.div>
                )}
              </motion.div>
            ))}
          </div>

          <div className="mt-8 text-center">
            <Link to="/help" className="text-xs font-extrabold text-indigo-600 hover:underline inline-flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4" />
              <span>ไปยังศูนย์ช่วยเหลือเพื่อดูคำถามทั้งหมด</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-900 text-white relative overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6 relative z-10">
          <motion.h2
            initial={{ opacity: 0, y: 25 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-2xl sm:text-4xl font-black tracking-tight"
          >
            พร้อมเปลี่ยนการบริหารจัดการหอพักของคุณให้ง่ายขึ้นหรือยัง?
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-xs sm:text-sm text-indigo-100 max-w-xl mx-auto leading-relaxed font-medium"
          >
            เริ่มต้นใช้งานระบบ HorPlus วันนี้ ทดลองระบบจริงได้ครบทุกขั้นตอนโดยไม่ต้องเชื่อมต่อบัตรเครดิต
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2"
          >
            <Link
              to="/owner/register"
              className="px-8 py-3.5 bg-white text-indigo-700 hover:bg-indigo-50 font-black text-sm rounded-2xl shadow-xl transition-all cursor-pointer hover:scale-105 active:scale-95 flex items-center gap-2"
            >
              <span>เริ่มลงทะเบียนเจ้าของหอพัก</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/demo"
              className="px-6 py-3.5 bg-indigo-700/80 hover:bg-indigo-700 text-white border border-indigo-500/80 font-extrabold text-sm rounded-2xl transition-all cursor-pointer hover:scale-105 active:scale-95"
            >
              เข้าสู่ Prototype Demo Portal
            </Link>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
