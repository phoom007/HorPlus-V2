/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';
import { ShieldAlert } from 'lucide-react';

export const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800">
      <PublicHeader />

      <section className="bg-slate-900 text-white py-12 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 text-center space-y-2">
          <h1 className="text-3xl font-black">เงื่อนไขการให้บริการ (Terms of Service)</h1>
          <p className="text-xs text-slate-400">ฉบับตัวอย่างสำหรับระบบทดลองสาธิต HorPlus Demo</p>
        </div>
      </section>

      <section className="py-12 bg-white flex-1">
        <div className="max-w-3xl mx-auto px-4 space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-amber-900 text-xs">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <p>
              <strong>ข้อแจ้งเตือนสำคัญ:</strong> เอกสารฉบับนี้เป็นเพียงร่างตัวอย่างเพื่อประกอบการทดลองระบบสาธิต (Interactive Prototype Demo) เท่านั้น ไม่ถือเป็นเอกสารสัญญาทางกฎหมายฉบับจริง
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-extrabold text-slate-900">1. การยอมรับข้อตกลง</h3>
            <p>
              การเข้าใช้บริการระบบสาธิต HorPlus ถือว่าผู้ใช้งานได้อ่าน เข้าใจ และตกลงที่จะปฏิบัติตามข้อกำหนดและเงื่อนไขการใช้งานระบบจำลองนี้
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">2. ขอบเขตบริการระบบสาธิต</h2>
            <p>
              ระบบนี้มีวัตถุประสงค์เพื่อการนำเสนอภาพรวมฟังก์ชันการทำงานของระบบบริหารจัดการหอพัก ข้อมูลทั้งหมดในระบบเป็นข้อมูลจำลอง ไม่มีการเชื่อมต่อธุรกรรมทางการเงินจริง และไม่มีการบันทึกข้อมูลบัตรเครดิต
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">3. สิทธิ์การใช้งานและการจัดเก็บข้อมูล</h2>
            <p>
              ข้อมูลที่ป้อนในระบบสาธิตจัดเก็บไว้บน LocalStorage ในอุปกรณ์ของผู้ใช้เอง ผู้ใช้สามารถล้างข้อมูลทั้งหมดได้โดยกดปุ่ม "รีเซ็ต Demo"
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">4. ข้อจำกัดความรับผิด</h2>
            <p>
              ทีมงานผู้พัฒนาระบบ HorPlus ไม่รับผิดชอบต่อความเสียหายใดๆ ที่เกิดขึ้นจากการนำระบบสาธิตไปใช้งานผิดวัตถุประสงค์นอกเหนือการทดสอบ
            </p>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
