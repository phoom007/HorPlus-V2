/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HelpCircle,
  Search,
  BookOpen,
  Building,
  Users,
  FileText,
  Gauge,
  FileSpreadsheet,
  FileCheck2,
  Phone,
  Mail,
  ChevronRight
} from 'lucide-react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';

export const HelpPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');

  const helpArticles = [
    {
      category: 'วิธีเริ่มใช้งาน',
      icon: BookOpen,
      title: 'เริ่มต้นลงทะเบียนและสร้างหอพักใหม่',
      content: 'เข้าใช้งานผ่านหน้า Onboarding wizard กรอกชื่อหอพัก จำนวนอาคาร และกำหนดค่าค่าน้ำไฟตั้งต้นเพื่อเข้าสู่ระบบ'
    },
    {
      category: 'การจัดการผังห้อง',
      icon: Building,
      title: 'วิธีเพิ่มและแก้ไขข้อมูลห้องพัก',
      content: 'ไปที่เมนู ห้องพัก กดเพิ่มห้องใหม่ กำหนดอาคาร ชั้น เลขห้อง และราคาค่าเช่าประจำห้อง'
    },
    {
      category: 'ทะเบียนผู้เช่า',
      icon: Users,
      title: 'วิธีเพิ่มผู้เช่าและจัดเก็บเอกสารสัญญา',
      content: 'เข้าเมนู ผู้เช่า บันทึกชื่อ เบอร์โทร และผูกเข้ากับห้องพัก พร้อมกำหนดสัญญาเช่าและเงินประกัน'
    },
    {
      category: 'สัญญาเช่า',
      icon: FileText,
      title: 'วิธีทำสัญญาเช่าและติดตามวันหมดอายุ',
      content: 'สร้างสัญญาเช่าระบุวันที่เริ่มและสิ้นสุดสัญญา ระบบจะทำการแจ้งเตือนเมื่อสัญญาเหลือน้อยกว่า 30 วัน'
    },
    {
      category: 'การคีย์มิเตอร์',
      icon: Gauge,
      title: 'วิธีบันทึกหน่วยมิเตอร์น้ำและไฟฟ้า',
      content: 'สลับบทบาทเป็นพนักงานช่าง ไปที่เมนู จดมิเตอร์ คีย์เลขหน่วยล่าสุด ระบบคำนวณยูนิตอัตโนมัติ'
    },
    {
      category: 'การออกบิล',
      icon: FileSpreadsheet,
      title: 'วิธีคำนวณและส่งใบแจ้งหนี้ประจำเดือน',
      content: 'ไปที่เมนู ออกบิล ตรวจสอบรายการ ค่าน้ำ ค่าไฟ ค่าเช่า และกดส่งใบแจ้งหนี้ไปยัง Tenant Mobile Portal'
    },
    {
      category: 'การชำระเงิน',
      icon: FileCheck2,
      title: 'วิธีตรวจสอบสลิปโอนเงินและอนุมัติใบเสร็จ',
      content: 'ไปที่เมนู การชำระเงิน ตรวจสอบภาพสลิป PromptPay ที่ผู้เช่าแนบส่งมา และกดอนุมัติเพื่อออกใบเสร็จ'
    },
    {
      category: 'Tenant Invitation',
      icon: Users,
      title: 'วิธีส่งลิงก์เชิญผู้เช่าเข้าสู่ระบบ',
      content: 'ในเมนูผู้เช่า กดคัดลอกลิงก์สิทธิ์เชิญเพื่อส่งให้ผู้เช่าทาง LINE หรือ SMS เพื่อให้ผู้เช่ายืนยันตัวตน'
    }
  ];

  const filteredArticles = helpArticles.filter(
    a => (a.title || '').toLowerCase().includes((searchQuery || '').toLowerCase()) ||
         (a.category || '').toLowerCase().includes((searchQuery || '').toLowerCase()) ||
         (a.content || '').toLowerCase().includes((searchQuery || '').toLowerCase())
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800">
      <PublicHeader />

      <section className="bg-slate-900 text-white py-12 sm:py-16 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4">
          <span className="text-xs font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3 py-1 rounded-full">
            HELP CENTER
          </span>
          <h1 className="text-3xl sm:text-5xl font-black tracking-tight">
            ศูนย์ช่วยเหลือและแนะนำการใช้งาน
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed font-medium">
            ค้นหาคำตอบ คู่มือขั้นตอนการทำงาน และคำแนะนำการใช้งานระบบ HorPlus
          </p>

          <div className="max-w-md mx-auto pt-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาบทความช่วยเหลือ (เช่น จดมิเตอร์, ออกบิล, เพิ่มผู้เช่า)..."
                className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-400 text-xs pl-10 pr-4 py-3 rounded-2xl focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {filteredArticles.map((art, idx) => {
              const Icon = art.icon;
              return (
                <div
                  key={idx}
                  className="bg-slate-50 border border-slate-200 rounded-3xl p-6 flex flex-col justify-between hover:border-indigo-300 transition-all hover:shadow-md"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-2xl font-bold">
                        <Icon className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-md">
                        {art.category}
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-slate-900 leading-snug">{art.title}</h3>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed">{art.content}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-3xl p-8 max-w-3xl mx-auto text-center space-y-4">
            <h3 className="text-base font-extrabold text-slate-900">ต้องการความช่วยเหลือเพิ่มเติม?</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              หากมีคำถามเกี่ยวกับการใช้งาน หรือต้องการการสนับสนุนเชิงเทคนิคจากทีมงาน HorPlus สามารถติดต่อเราได้ตามช่องทางด้านล่าง
            </p>
            <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-slate-700 pt-2">
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-2xs">
                <Phone className="w-4 h-4 text-indigo-600" />
                <span>02-123-4567 (จันทร์-ศุกร์ 09:00 - 18:00)</span>
              </div>
              <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-2xs">
                <Mail className="w-4 h-4 text-indigo-600" />
                <span>support@horplus.demo</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
