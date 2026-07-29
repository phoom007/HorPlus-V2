/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';
import { ShieldCheck } from 'lucide-react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800">
      <PublicHeader />

      <section className="bg-slate-900 text-white py-12 border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-4 text-center space-y-2">
          <h1 className="text-3xl font-black">นโยบายความเป็นส่วนตัว (Privacy Policy)</h1>
          <p className="text-xs text-slate-400">ฉบับตัวอย่างสำหรับระบบทดลองสาธิต HorPlus Demo</p>
        </div>
      </section>

      <section className="py-12 bg-white flex-1">
        <div className="max-w-3xl mx-auto px-4 space-y-6 text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
          <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-start gap-3 text-indigo-950 text-xs">
            <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <p>
              <strong>ข้อแจ้งเตือนความเป็นส่วนตัว:</strong> ระบบสาธิตนี้ทำงานบนเบราว์เซอร์ของคุณโดยตรง ไม่มีการส่งข้อมูลส่วนบุคคลหรือข้อมูลจำลองไปยังเซิร์ฟเวอร์ประมวลผลภายนอก
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-base font-extrabold text-slate-900">1. ประเภทข้อมูลที่ระบบจัดเก็บ</h3>
            <p>
              ระบบสาธิตทำการจัดเก็บเฉพาะค่าการตั้งค่าชั่วคราว ข้อมูลทดลอง Onboarding และสถานะเซสชันจำลองบนหน่วยความจำ LocalStorage ของเบราว์เซอร์ที่คุณกำลังใช้งานเท่านั้น
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">2. การใช้คุกกี้และเทคโนโลยีการจัดเก็บ</h2>
            <p>
              เราใช้ LocalStorage เพื่อรักษาการทำงานของสภาวะสิทธิผู้เข้าใช้งาน (Demo Session) เพื่อให้คุณสามารถทดลองรีเฟรชหน้าเว็บ หรือทดลองย้อนกลับหน้าเว็บได้โดยไม่สูญเสียสถานะ
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">3. การคุ้มครองข้อมูลส่วนบุคคล (PDPA)</h2>
            <p>
              เนื่องจากเป็นระบบสาธิต จึงขอแนะนำให้ผู้ทดสอบไม่ใช้ข้อมูลส่วนบุคคลจริง เช่น เลขบัตรประชาชนจริง หรือเลขบัญชีธนาคารจริง ในการป้อนข้อมูลทดสอบ
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-extrabold text-slate-900">4. การลบและรีเซ็ตข้อมูล</h2>
            <p>
              คุณสามารถล้างข้อมูลจำลองทั้งหมดได้ตลอดเวลาด้วยการกดปุ่ม "รีเซ็ต Demo" ในหน้า Demo Portal หรือล้างคุกกี้/แคชในเบราว์เซอร์ของคุณ
            </p>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
