/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Building2,
  Building,
  Users,
  FileText,
  Gauge,
  FileSpreadsheet,
  FileCheck2,
  Wrench,
  Megaphone,
  BarChart4,
  ShieldCheck,
  Smartphone,
  ArrowRight,
  CheckCircle2
} from 'lucide-react';
import { PublicHeader } from '../../components/public/PublicHeader';
import { PublicFooter } from '../../components/public/PublicFooter';

export const FeaturesPage: React.FC = () => {
  const featureCategories = [
    {
      id: 'rooms',
      icon: Building,
      title: '1. ระบบผังห้องพักและอาคาร',
      desc: 'ควบคุมผังหอพักแบบเห็นภาพ แยกอาคาร ชั้น และเลขห้องพักได้อย่างชัดเจน',
      bullets: [
        'แสดงสถานะห้องพักแบบ Real-time (ห้องว่าง, มีผู้เช่า, ห้องจอง, กำลังซ่อม)',
        'รองรับการเพิ่ม หลายอาคาร และกำหนดประเภทห้องพัก',
        'ตั้งค่าราคาค่าเช่า ค่าน้ำ ค่าไฟ และค่าบริการส่วนกลางรายห้อง'
      ]
    },
    {
      id: 'tenants',
      icon: Users,
      title: '2. ระบบทะเบียนผู้เช่า',
      desc: 'จัดเก็บทะเบียนประวัติผู้เช่าและเอกสารสำคัญในระบบดิจิทัล',
      bullets: [
        'บันทึกชื่อ เบอร์โทร อีเมล เลขบัตรประชาชน และรูปถ่ายผู้เช่า',
        'ระบุผู้เช่าหลักและผู้เช่าร่วมในแต่ละห้อง',
        'ระบบเชิญผู้เช่าเข้าสู่ Tenant Portal ผ่านลิงก์สิทธิ์ด่วน'
      ]
    },
    {
      id: 'contracts',
      icon: FileText,
      title: '3. สัญญาเช่าและเงินประกัน',
      desc: 'ร่าง ออกสัญญาเช่า และติดตามเงินประกันความเสียหายอย่างเป็นระบบ',
      bullets: [
        'กำหนดระยะเวลาสัญญา (3 เดือน, 6 เดือน, 1 ปี หรือกำหนดเอง)',
        'ระบบคำนวณเงินประกัน ค่าเช่าล่วงหน้า และเงื่อนไขการคืนเงิน',
        'การแจ้งเตือนสัญญากำลังจะหมดอายุล่วงหน้า'
      ]
    },
    {
      id: 'meters',
      icon: Gauge,
      title: '4. จดมิเตอร์น้ำและไฟฟ้า',
      desc: 'บันทึกเลขหน่วยมิเตอร์ด้วยอินเทอร์เฟซที่สะดวกบนสมาร์ตโฟน',
      bullets: [
        'รองรับพนักงานช่างเดินจดเลขมิเตอร์แยกรายห้อง',
        'คำนวณยูนิตที่ใช้เปรียบเทียบกับเดือนก่อนหน้าอัตโนมัติ',
        'ระบบแจ้งเตือนกรณีหน่วยมิเตอร์ผิดปกติผิดปกติเกินมาตรฐาน'
      ]
    },
    {
      id: 'billing',
      icon: FileSpreadsheet,
      title: '5. ระบบออกบิลและใบแจ้งหนี้',
      desc: 'ประมวลผลคำนวณบิลประจำเดือนอย่างรวดเร็วและแม่นยำ',
      bullets: [
        'รวมค่าเช่า ค่าน้ำ ค่าไฟ ค่าส่วนกลาง ค่าอินเทอร์เน็ต และค่าปรับล่าช้า',
        'กำหนดวันตัดรอบบิลและกำหนดชำระเงิน',
        'ส่งใบแจ้งหนี้ตรงไปยัง Tenant Mobile Portal'
      ]
    },

    {
      id: 'maintenance',
      icon: Wrench,
      title: '8. ระบบแจ้งซ่อมแซม',
      desc: 'ช่องทางรับเรื่องซ่อมแซมในห้องพักแบบสองทาง (Two-way Work Order)',
      bullets: [
        'ผู้เช่าส่งเรื่องแจ้งซ่อมพร้อมแนบรูปภาพปัญหา',
        'ช่างรับงานและอัปเดตสถานะ (กำลังซ่อม / ซ่อมเสร็จสิ้น)',
        'ผู้เช่าประเมินคะแนนความพึงพอใจงานซ่อม'
      ]
    },
    {
      id: 'announcements',
      icon: Megaphone,
      title: '9. บอร์ดประกาศประชาสัมพันธ์',
      desc: 'สื่อสารข่าวสาร คำเตือน และแจ้งเตือนสำคัญถึงผู้เช่าทุกคน',
      bullets: [
        'ปักหมุดประกาศสำคัญไว้บนหน้าแรกของผู้เช่า',
        'แนบภาพประกอบ และระบุประเภทข่าวสาร',
        'เลือกส่งประกาศเฉพาะอาคารหรือทุกอาคารในหอพัก'
      ]
    },
    {
      id: 'reports',
      icon: BarChart4,
      title: '10. รายงานสถิติและงบการเงิน',
      desc: 'วิเคราะห์ผลประกอบการหอพักด้วยกราฟิกและตารางสรุป',
      bullets: [
        'สรุปรายรับ ค่าเช่า ค่าน้ำ ค่าไฟ ค้างจ่าย และยอดรับจริง',
        'สถิติอัตราการครองห้อง (Occupancy Rate)',
        'ส่งออกข้อมูลสรุปย่อเพื่อวิเคราะห์เพิ่มเติม'
      ]
    },
    {
      id: 'users',
      icon: ShieldCheck,
      title: '11. ผู้ใช้งานและสิทธิ์เข้าถึง (RBAC)',
      desc: 'กระจายงานให้พนักงานอย่างปลอดภัยด้วยระบบ Role-based Permission',
      bullets: [
        'กำหนดบทบาท: เจ้าของหอ (Owner), ผู้จัดการ (Manager), การเงิน (Finance), ช่าง/แม่บ้าน (Staff)',
        'จำกัดการเข้าถึงเมนูและการลบข้อมูลสำคัญ',
        'บันทึก Audit Logs ประวัติการทำงานในระบบ'
      ]
    },
    {
      id: 'tenant-portal',
      icon: Smartphone,
      title: '12. Tenant Mobile Portal',
      desc: 'เว็บบอร์ดสมาร์ตโฟนสำหรับผู้เช่า ใช้งานง่าย ไม่ต้องโหลดแอป',
      bullets: [
        'เช็กใบแจ้งหนี้ ค่าน้ำ ค่าไฟ และสแกน QR Code โอนเงิน',
        'แนบสลิปโอนเงิน และดูใบเสร็จรับเงิน',
        'ดูข้อมูลสัญญา แจ้งซ่อมแซม และอ่านประกาศหอพัก'
      ]
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans text-slate-800 overflow-x-hidden">
      <PublicHeader />

      {/* Header Banner */}
      <section className="bg-slate-900 text-white py-14 sm:py-20 border-b border-slate-800 relative overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-4 relative z-10">
          <motion.span
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xs font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-3.5 py-1.5 rounded-full inline-block"
          >
            HORPLUS FEATURES
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-3xl sm:text-5xl font-black tracking-tight"
          >
            ฟีเจอร์การทำงานของ HorPlus
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed font-medium"
          >
            สำรวจความสามารถของระบบจัดการหอพักยุคใหม่ ที่สร้างขึ้นเพื่อตอบสนองการบริหารหอพักอย่างเต็มประสิทธิภาพ
          </motion.p>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {featureCategories.map((cat, idx) => {
              const Icon = cat.icon;
              return (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 35 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.5, delay: (idx % 3) * 0.1 }}
                  whileHover={{ y: -6, transition: { duration: 0.2 } }}
                  className="bg-slate-50/80 border border-slate-200/90 rounded-3xl p-6 flex flex-col justify-between hover:border-indigo-400 hover:bg-white hover:shadow-xl hover:shadow-indigo-500/5 transition-all group"
                >
                  <div className="space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-md shadow-indigo-600/20 group-hover:scale-110 transition-transform">
                      <Icon className="w-6 h-6" />
                    </div>

                    <div className="space-y-1">
                      <h3 className="text-base font-black text-slate-900">{cat.title}</h3>
                      <p className="text-xs text-slate-500 font-medium leading-relaxed">{cat.desc}</p>
                    </div>

                    <ul className="space-y-2 pt-3 border-t border-slate-200/60">
                      {cat.bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-slate-700 leading-tight font-medium">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6 }}
            className="mt-16 bg-gradient-to-r from-indigo-900 via-slate-900 to-indigo-950 rounded-3xl p-8 sm:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl border border-indigo-500/30"
          >
            <div className="space-y-2 text-center md:text-left">
              <h3 className="text-2xl font-black">พร้อมทดลองฟีเจอร์จริงทั้งหมดหรือยัง?</h3>
              <p className="text-xs sm:text-sm text-slate-300 font-medium">
                ลงทะเบียนทดลองใช้งานฟรี 30 วัน หรือเข้าชมระบบสาธิตได้ทันที
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
              <Link
                to="/owner/register"
                className="px-7 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-xl shadow-md text-center transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                เริ่มลงทะเบียนฟรี
              </Link>
              <Link
                to="/demo"
                className="px-6 py-3.5 bg-white/10 hover:bg-white/20 text-white border border-white/20 font-extrabold text-xs rounded-xl text-center transition-all cursor-pointer hover:scale-105 active:scale-95"
              >
                ทดลองระบบ Demo
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
};
