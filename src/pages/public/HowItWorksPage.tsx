/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  UserPlus,
  Building,
  Settings,
  Users,
  FileSpreadsheet,
  ArrowRight,
  CheckCircle2,
  Sparkles
} from 'lucide-react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';

export const HowItWorksPage: React.FC = () => {
  const steps = [
    {
      step: '01',
      icon: UserPlus,
      title: 'สมัครบัญชีเจ้าของหอพัก',
      desc: 'เข้าสู่ระบบด้วยบัญชี Google หรือลงทะเบียนใหม่เพื่อเริ่มสร้างองค์กรของคุณ'
    },
    {
      step: '02',
      icon: Building,
      title: 'สร้างข้อมูลหอพักและอาคาร',
      desc: 'กรอกชื่อหอพัก ที่อยู่ จำนวนอาคาร และประมาณการจำนวนห้องพักทั้งหมด'
    },
    {
      step: '03',
      icon: Settings,
      title: 'ตั้งค่าการเงินและอัตราค่าน้ำไฟ',
      desc: 'กำหนดวันที่ออกบิล วันครบกำหนดชำระ อัตราค่าน้ำ ค่าไฟ และเลข PromptPay สำหรับรับโอน'
    },
    {
      step: '04',
      icon: Users,
      title: 'เพิ่มห้องพักและผู้เช่า',
      desc: 'ใส่ข้อมูลผู้เช่า สัญญาเช่า เงินประกัน และส่งลิงก์คำเชิญให้ผู้เช่าเข้าสู่ระบบ'
    },
    {
      step: '05',
      icon: FileSpreadsheet,
      title: 'จดมิเตอร์และเริ่มออกบิล',
      desc: 'พนักงานเดินคีย์เลขมิเตอร์ ระบบประมวลผลบิลอัตโนมัติ ส่งใบแจ้งหนี้ และตรวจอนุมัติสลิปโอนเงิน'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800 overflow-x-hidden">
      <PublicHeader />

      <section className="bg-slate-900 text-white py-14 sm:py-20 border-b border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4 relative z-10">
          <motion.span
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xs font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3.5 py-1.5 rounded-full inline-block"
          >
            EASY STARTUP
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black tracking-tight"
          >
            ขั้นตอนการเริ่มต้นใช้งาน HorPlus
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed font-medium"
          >
            เริ่มต้นตั้งค่าหอพักของคุณได้ใน 5 ขั้นตอนง่ายๆ พร้อมใช้งานจริงทันที
          </motion.p>
        </div>
      </section>

      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                whileHover={{ scale: 1.01, transition: { duration: 0.2 } }}
                className="bg-slate-50 border border-slate-200/90 rounded-3xl p-6 sm:p-8 flex flex-col sm:flex-row items-start gap-6 shadow-2xs hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/5 transition-all group"
              >
                <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-md shadow-indigo-600/20 group-hover:scale-105 transition-transform">
                  {s.step}
                </div>

                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-lg font-black text-slate-900">{s.title}</h3>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                    {s.desc}
                  </p>
                </div>
              </motion.div>
            );
          })}

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="pt-8 text-center space-y-5"
          >
            <h3 className="text-xl font-black text-slate-900">พร้อมที่จะเริ่มการทำงานแล้วหรือยัง?</h3>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/owner/register"
                className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2 hover:scale-105 active:scale-95"
              >
                <span>เริ่มลงทะเบียนเจ้าของหอพัก</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                to="/demo"
                className="px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-extrabold text-xs rounded-xl border border-slate-200 transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                ทดลองระบบ Demo Portal
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
