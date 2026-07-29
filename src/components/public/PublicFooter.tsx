/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
  ExternalLink
} from 'lucide-react';

export const PublicFooter: React.FC = () => {
  return (
    <footer className="bg-slate-900 text-slate-300 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand Info */}
          <div className="lg:col-span-2 space-y-4">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-sky-400 p-2 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <span className="text-xl font-black text-white tracking-tight">HorPlus</span>
                <span className="ml-2 text-[10px] font-black bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-md">
                  Demo Release
                </span>
              </div>
            </Link>

            <p className="text-xs text-slate-400 leading-relaxed max-w-sm">
              แพลตฟอร์มบริหารจัดการหอพักและอพาร์ตเมนต์ครบวงจร เชื่อมโยงเจ้าของหอ พนักงาน และผู้เช่า ไว้ในระบบเดียว ช่วยออกบิล ตรวจสลิป จดมิเตอร์ และจัดการสัญญาเช่าได้อย่างมีประสิทธิภาพ
            </p>

            <div className="p-3 bg-slate-800/80 border border-slate-700/60 rounded-2xl text-[11px] text-slate-400 space-y-1 max-w-sm">
              <div className="flex items-center gap-1.5 font-bold text-amber-400">
                <Sparkles className="w-3.5 h-3.5" />
                <span>หมายเหตุระบบสาธิต</span>
              </div>
              <p>
                เว็บไซต์นี้เป็นระบบจำลองแบบ Interactive Prototype สำหรับการทดลองใช้งาน ไม่มีการจัดเก็บข้อมูลส่วนบุคคลบนเซิร์ฟเวอร์ภายนอก
              </p>
            </div>
          </div>

          {/* Nav Links Column 1 */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase text-white tracking-wider">ระบบงานหลัก</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/features" className="hover:text-white transition-colors">ผังห้องและอาคาร</Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-white transition-colors">คีย์มิเตอร์น้ำและไฟฟ้า</Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-white transition-colors">ออกบิลและใบแจ้งหนี้</Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-white transition-colors">ตรวจสลิปโอนเงินอัตโนมัติ</Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-white transition-colors">สัญญาเช่าและเงินประกัน</Link>
              </li>
              <li>
                <Link to="/features" className="hover:text-white transition-colors">Tenant Mobile Portal</Link>
              </li>
            </ul>
          </div>

          {/* Nav Links Column 2 */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase text-white tracking-wider">ข้อเสนอและราคา</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/pricing" className="hover:text-white transition-colors">แพ็กเกจค่าบริการ</Link>
              </li>
              <li>
                <Link to="/owner/register" className="hover:text-white transition-colors text-indigo-400 font-bold">ลงทะเบียนฟรี 30 วัน</Link>
              </li>
              <li>
                <Link to="/how-it-works" className="hover:text-white transition-colors">ขั้นตอนการเริ่มต้นใช้งาน</Link>
              </li>
              <li>
                <Link to="/help" className="hover:text-white transition-colors">ศูนย์ช่วยเหลือและคำถามบ่อย</Link>
              </li>
              <li>
                <Link to="/demo" className="hover:text-white transition-colors text-amber-400 font-bold">เข้าชม Prototype Demo</Link>
              </li>
            </ul>
          </div>

          {/* Column 3 - Terms & Privacy */}
          <div className="space-y-3">
            <h4 className="text-xs font-black uppercase text-white tracking-wider">ข้อกำหนดและนโยบาย</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/terms" className="hover:text-white transition-colors">เงื่อนไขการให้บริการ (Terms)</Link>
              </li>
              <li>
                <Link to="/privacy" className="hover:text-white transition-colors">นโยบายความเป็นส่วนตัว (Privacy)</Link>
              </li>
              <li>
                <a href="#contact" className="hover:text-white transition-colors">ติดต่อทีมงาน HorPlus</a>
              </li>
            </ul>

            <div className="pt-2 text-[11px] text-slate-500 space-y-1">
              <div className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>support@horplus.demo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>02-123-4567 (เวลาทำการ)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {new Date().getFullYear()} HorPlus-Version 2. All rights reserved. Interactive Prototype.</p>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-slate-400">Terms</Link>
            <Link to="/privacy" className="hover:text-slate-400">Privacy</Link>
            <Link to="/demo" className="text-indigo-400 hover:text-indigo-300 font-bold">Demo Portal</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};
