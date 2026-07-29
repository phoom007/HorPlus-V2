/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield,
  User,
  RotateCw,
  BookOpen,
  ArrowRight,
  Info,
  CheckCircle,
  Building,
  Activity,
  UserCheck,
  Zap,
  Play,
  FileSpreadsheet,
  FileCheck2,
  Gauge,
  Wrench,
  Megaphone,
  CreditCard,
  Building2,
  RefreshCw,
  Layers,
  Sparkles
} from 'lucide-react';
import {
  getUsers,
  getTenants,
  seedDatabase,
  getRooms
} from '../data/mockData';
import { setOwnerDemoSession, setTenantDemoSession } from '../demo/demoSession';
import { ConfirmDialog } from '../components/GlobalComponents';
import { User as UserType, Tenant as TenantType } from '../types';

interface DemoPortalProps {
  onSelectOwner: (user: UserType) => void;
  onSelectTenant: (tenant: TenantType) => void;
  onShowGuide: () => void;
  onResetDatabase: () => void;
}

export const DemoPortal: React.FC<DemoPortalProps> = ({
  onSelectOwner,
  onSelectTenant,
  onShowGuide,
  onResetDatabase
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'scenarios' | 'select' | 'owner_list' | 'tenant_list'>('scenarios');
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  const staffUsers = getUsers();
  const tenants = getTenants();
  const rooms = getRooms();

  const handleReset = () => {
    onResetDatabase();
    setResetMessage('รีเซ็ตข้อมูลและตั้งต้น Seed ใหม่สำเร็จแล้ว!');
    setTimeout(() => {
      setResetMessage(null);
    }, 3000);
  };

  const getRoomNumber = (tenantId: string) => {
    const tenant = tenants.find(t => t.id === tenantId);
    if (!tenant) return '-';
    const room = rooms.find(r => r.id === tenant.rentalHistory[0]);
    return room ? room.roomNumber : '-';
  };

  // Pre-configured Scenario Handlers
  const runScenario = (scenarioId: number) => {
    const ownerUser = staffUsers.find(u => u.roleId === 'role-owner') || staffUsers[0];
    const managerUser = staffUsers.find(u => u.roleId === 'role-manager') || staffUsers[0];
    const financeUser = staffUsers.find(u => u.roleId === 'role-finance') || staffUsers[0];
    const staffUser = staffUsers.find(u => u.roleId === 'role-staff') || staffUsers[0];
    const techUser = staffUsers.find(u => u.roleId === 'role-tech') || staffUsers[0];

    const tenantPending = tenants.find(t => t.id === 'tenant-2') || tenants[0];
    const tenantPaid = tenants.find(t => t.id === 'tenant-1') || tenants[0];
    const tenantExpiring = tenants.find(t => t.id === 'tenant-21') || tenants[0];

    switch (scenarioId) {
      case 1: // New Owner Onboarding / Register
        navigate('/owner/register');
        break;
      case 2: // Existing Owner — Monthly Billing
        setOwnerDemoSession(ownerUser);
        navigate('/owner/billing');
        break;
      case 3: // Manager — Room & Contract
        setOwnerDemoSession(managerUser);
        navigate('/owner/rooms');
        break;
      case 4: // Finance — Payment Review
        setOwnerDemoSession(financeUser);
        navigate('/owner/payments');
        break;
      case 5: // Staff — Meter Entry
        setOwnerDemoSession(staffUser);
        navigate('/owner/meters');
        break;
      case 6: // Tech — Maintenance
        setOwnerDemoSession(techUser);
        navigate('/owner/maintenance');
        break;
      case 7: // Tenant — Pending Bill
        setTenantDemoSession(tenantPending);
        navigate('/tenant/dashboard');
        break;
      case 8: // Tenant — Paid/Receipt
        setTenantDemoSession(tenantPaid);
        navigate('/tenant/dashboard');
        break;
      case 9: // Tenant — Contract Extension
        setTenantDemoSession(tenantExpiring);
        navigate('/tenant/dashboard');
        break;
      case 10: // Tenant — Maintenance Request
        setTenantDemoSession(tenantPaid);
        navigate('/tenant/dashboard');
        break;
      case 11: // Multi-Dormitory Switching
        setOwnerDemoSession(ownerUser);
        navigate('/owner/settings');
        break;
      case 12: // Full Month Cycle
        setOwnerDemoSession(ownerUser);
        navigate('/owner/dashboard');
        break;
      default:
        break;
    }
  };

  const scenariosList = [
    {
      id: 1,
      title: '1. New Owner Onboarding',
      desc: 'ต้อนรับเจ้าของหอพักใหม่ ตั้งชื่อโครงการ จำนวนห้อง และกำหนดค่าน้ำไฟ',
      tag: 'Onboarding Wizard',
      tagColor: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
      icon: Building,
      btnText: 'เปิด Onboarding'
    },
    {
      id: 2,
      title: '2. Existing Owner — Monthly Billing',
      desc: 'เจ้าของหอพักออกบิลประจำเดือน ตรวจสอบสรุปยอด และพิมพ์บิล',
      tag: 'Billing & Invoices',
      tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      icon: FileSpreadsheet,
      btnText: 'เข้าดูหน้าออกบิล'
    },
    {
      id: 3,
      title: '3. Manager — Room & Contract',
      desc: 'ผู้จัดการบริหารห้องพัก สภาพห้อง และทำสัญญาเช่าใหม่',
      tag: 'Rooms & Contracts',
      tagColor: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
      icon: UserCheck,
      btnText: 'จัดการห้องและสัญญา'
    },
    {
      id: 4,
      title: '4. Finance — Payment Review',
      desc: 'ฝ่ายการเงินสแกนตรวจสลิปโอนเงิน อนุมัติยอด และออกใบเสร็จ',
      tag: 'Payments & Receipts',
      tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      icon: FileCheck2,
      btnText: 'ตรวจสอบสลิปการเงิน'
    },
    {
      id: 5,
      title: '5. Staff — Meter Entry',
      desc: 'เจ้าหน้าที่หอกรอกมิเตอร์น้ำและไฟฟ้าประจำเดือนรายห้อง',
      tag: 'Meter Management',
      tagColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      icon: Gauge,
      btnText: 'บันทึกมิเตอร์น้ำไฟ'
    },
    {
      id: 6,
      title: '6. Tech — Maintenance',
      desc: 'ช่างซ่อมแซมรับงาน อัปเดตสถานะการซ่อม และบันทึกค่าใช้จ่าย',
      tag: 'Maintenance & Repairs',
      tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: Wrench,
      btnText: 'รับงานแจ้งซ่อม'
    },
    {
      id: 7,
      title: '7. Tenant — Pending Bill',
      desc: 'ผู้เช่าเปิดบิลค้างชำระ สแกน QR Code และแนบสลิปชำระเงิน',
      tag: 'Tenant Mobile Portal',
      tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: CreditCard,
      btnText: 'จำลองสแนปผู้เช่ามีบิล'
    },
    {
      id: 8,
      title: '8. Tenant — Paid/Receipt',
      desc: 'ผู้เช่าตรวจใบเสร็จรับเงินอิเล็กทรอนิกส์และประวัติการชำระย้อนหลัง',
      tag: 'Tenant Receipts',
      tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      icon: FileCheck2,
      btnText: 'จำลองดูใบเสร็จ'
    },
    {
      id: 9,
      title: '9. Tenant — Contract Extension',
      desc: 'ผู้เช่าส่งคำขอต่อสัญญาเช่าออนไลน์ และติดตามสถานะอนุมัติ',
      tag: 'Contract Renewal',
      tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      icon: Activity,
      btnText: 'ขอต่อสัญญาผู้เช่า'
    },
    {
      id: 10,
      title: '10. Tenant — Maintenance Request',
      desc: 'ผู้เช่าถ่ายรูปและส่งเรื่องแจ้งซ่อมพร้อมระบุเวลาที่สะดวก',
      tag: 'Tenant Repairs',
      tagColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      icon: Wrench,
      btnText: 'ผู้เช่าส่งแจ้งซ่อม'
    },
    {
      id: 11,
      title: '11. Multi-Dormitory Switching',
      desc: 'สลับการทำงานระหว่างหอพักแกรนด์เรสซิเดนซ์ และหอพักวิลล์ บูทีค',
      tag: 'Multi-Dorm Isolation',
      tagColor: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
      icon: Building2,
      btnText: 'สลับหอพักสาธิต'
    },
    {
      id: 12,
      title: '12. Full Month Business Cycle',
      desc: 'ทดสอบวงจรธุรกิจครบวงจร: สร้างห้อง -> สัญญา -> มิเตอร์ -> บิล -> สลิป -> อนุมัติ -> ใบเสร็จ',
      tag: 'End-to-End Business Cycle',
      tagColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40 font-black',
      icon: Layers,
      btnText: 'เริ่ม Full Month Cycle'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col justify-between p-4 sm:p-6 font-sans">
      {/* Top Bar */}
      <div className="max-w-6xl mx-auto w-full flex flex-col sm:flex-row gap-4 justify-between items-center shrink-0 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-teal-400 p-2 text-white flex items-center justify-center shadow-md">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-tight">HorPlus</h1>
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full font-bold">
                Version 2 Demo
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">
              ศูนย์รวมฉากทัศน์สาธิตระบบบริหารจัดการหอพักและห้องเช่า (Demo Scenario Center)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onShowGuide}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
            <span>คู่มือการใช้งาน</span>
          </button>
          <button
            onClick={() => setIsResetConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl transition-colors cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>รีเซ็ต Demo</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto w-full flex-1 py-6 space-y-6">
        {resetMessage && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 rounded-2xl flex items-center gap-3 shadow-lg animate-in fade-in">
            <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-xs font-bold">{resetMessage}</p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'scenarios'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>ฉากทัศน์สาธิต 12 Scenario</span>
          </button>

          <button
            onClick={() => setActiveTab('select')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'select'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Shield className="w-4 h-4 text-indigo-400" />
            <span>สวมบทบาทแบ่งตามส่วนงาน</span>
          </button>

          <button
            onClick={() => setActiveTab('owner_list')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'owner_list'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <UserCheck className="w-4 h-4 text-sky-400" />
            <span>รายชื่อแอดมิน 5 สิทธิ์</span>
          </button>

          <button
            onClick={() => setActiveTab('tenant_list')}
            className={`px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer shrink-0 ${
              activeTab === 'tenant_list'
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <User className="w-4 h-4 text-emerald-400" />
            <span>รายชื่อผู้เช่าสาธิต</span>
          </button>
        </div>

        {/* TAB 1: 12 SCENARIOS */}
        {activeTab === 'scenarios' && (
          <div className="space-y-6">
            <div className="bg-slate-800/80 border border-slate-700/80 p-5 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-xl">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-amber-400" />
                  <h2 className="text-lg font-black text-white">12 Business Workflow Scenarios</h2>
                </div>
                <p className="text-xs text-slate-400 max-w-2xl">
                  เลือกฉากทัศน์สาธิตเพื่อทดลองใช้งานระบบ HorPlus Version 2 ตามกรณีการใช้งานจริงในทางธุรกิจ
                </p>
              </div>

              <button
                onClick={() => runScenario(12)}
                className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-teal-500 hover:from-indigo-500 hover:to-teal-400 text-white font-extrabold text-xs rounded-2xl shadow-lg flex items-center gap-2 cursor-pointer transition-all hover:scale-[1.02] shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>รัน Full Month Business Cycle</span>
              </button>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {scenariosList.map((sc) => {
                const IconComponent = sc.icon;
                return (
                  <div
                    key={sc.id}
                    onClick={() => runScenario(sc.id)}
                    className="bg-slate-800/90 border border-slate-700/70 hover:border-indigo-500/80 p-5 rounded-3xl flex flex-col justify-between hover:scale-[1.01] transition-all cursor-pointer group shadow-lg relative overflow-hidden"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-lg border ${sc.tagColor}`}>
                          {sc.tag}
                        </span>
                        <div className="p-2 rounded-xl bg-slate-900/60 text-indigo-400 group-hover:text-white group-hover:bg-indigo-600 transition-colors">
                          <IconComponent className="w-4 h-4" />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-xs font-extrabold text-white group-hover:text-indigo-300 transition-colors leading-snug">
                          {sc.title}
                        </h3>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {sc.desc}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[11px] font-bold text-indigo-400 group-hover:text-indigo-300">
                      <span>{sc.btnText}</span>
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: SELECT WORKFLOW */}
        {activeTab === 'select' && (
          <div className="grid md:grid-cols-2 gap-6 pt-2">
            <div
              onClick={() => setActiveTab('owner_list')}
              className="bg-slate-800/90 border border-slate-700/80 p-6 rounded-3xl hover:border-indigo-500 shadow-xl cursor-pointer transition-all group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
                  <Shield className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-black text-white group-hover:text-indigo-300">ฝั่งเจ้าของหอพัก / เจ้าหน้าที่แอดมิน</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    บริหารจัดการอาคาร ห้องพัก สัญญาเช่า ออกบิล ตรวจสลิปการเงิน บันทึกมิเตอร์ รับเรื่องแจ้งซ่อม และดูรายงาน
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center text-xs font-extrabold text-indigo-400 gap-1.5">
                <span>เลือกบทบาทแอดมิน 5 สิทธิ์</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>

            <div
              onClick={() => setActiveTab('tenant_list')}
              className="bg-slate-800/90 border border-slate-700/80 p-6 rounded-3xl hover:border-emerald-500 shadow-xl cursor-pointer transition-all group flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                  <User className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-black text-white group-hover:text-emerald-300">ฝั่งผู้เช่า (Tenant Mobile Portal)</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    ดูยอดบิลค่าใช้จ่าย สแกน QR โอนเงิน แนบสลิป ตรวจสอบใบเสร็จ ขอต่ออายุสัญญา และส่งเรื่องแจ้งซ่อม
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center text-xs font-extrabold text-emerald-400 gap-1.5">
                <span>จำลองสวมบทบาทผู้เช่า</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: OWNER LIST */}
        {activeTab === 'owner_list' && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-black text-white">เลือกบัญชีเจ้าของ / เจ้าหน้าที่สาธิต (5 บทบาท)</h2>
              <p className="text-xs text-slate-400">
                ระบบจำลองสิทธิ์ Role-Based Access Control บังคับสิทธิ์จริงทั้งการเข้าถึง เมนู ปุ่ม และการจัดการข้อมูล
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {staffUsers.map((user) => (
                <div
                  key={user.id}
                  onClick={() => onSelectOwner(user)}
                  className="bg-slate-800/90 border border-slate-700/80 hover:border-indigo-500 p-5 rounded-3xl cursor-pointer shadow-lg hover:scale-[1.01] transition-all flex flex-col justify-between group"
                >
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <img src={user.avatar} alt={user.name} className="w-10 h-10 rounded-full border border-slate-600 object-cover" />
                      <div>
                        <h4 className="font-extrabold text-white text-xs group-hover:text-indigo-300">{user.name}</h4>
                        <span className="inline-block bg-indigo-500/20 text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-md mt-0.5 border border-indigo-500/30">
                          {user.roleName}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      {user.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[11px] font-bold text-indigo-400">
                    <span>เข้าสู่ระบบในสิทธิ์นี้</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: TENANT LIST */}
        {activeTab === 'tenant_list' && (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-black text-white">เลือกบัญชีผู้เช่าห้องจำลอง</h2>
              <p className="text-xs text-slate-400">
                ทดสอบเวิร์กโฟลว์ฝั่งผู้เช่า (Mobile Portal) ที่มีเคสบิล สัญญา และแจ้งซ่อมต่างกัน
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(() => {
                const demoTenants = [
                  { tenant: tenants.find(t => t.id === 'tenant-1') || tenants[0], room: 'A101', desc: 'เคสปกติ: มีใบเสร็จรับเงิน ชำระเงินเรียบร้อยแล้ว', badge: 'ห้อง A101', badgeBg: 'bg-emerald-500/20 text-emerald-400' },
                  { tenant: tenants.find(t => t.id === 'tenant-2') || tenants[1], room: 'A102', desc: 'เคสมีบิลค้าง: มีบิลเดือนกรกฎาคมรอการสแกนชำระเงินและแนบสลิป', badge: 'ห้อง A102', badgeBg: 'bg-amber-500/20 text-amber-400' },
                  { tenant: tenants.find(t => t.id === 'tenant-17') || tenants[2], room: 'A105', desc: 'เคสสัญญาหมดอายุ: มีเรื่องขอต่ออายุสัญญาเช่าและแจ้งซ่อม', badge: 'ห้อง A105', badgeBg: 'bg-sky-500/20 text-sky-400' },
                  { tenant: tenants.find(t => t.id === 'tenant-unregistered') || { id: 'tenant-unregistered', name: 'นลินี มั่นคง', rentalHistory: [] } as any, room: 'ใหม่', desc: 'ผู้เช่าใหม่ที่ยังไม่ลงทะเบียนห้องพัก พบบ๊อกซ์ "ลงทะเบียนผู้เช่า" ทันที', badge: 'ยังไม่ลงทะเบียน', badgeBg: 'bg-indigo-500/20 text-indigo-300' },
                ];

                return demoTenants.map(({ tenant, desc, badge, badgeBg }) => {
                  const rNum = getRoomNumber(tenant.id);
                  return (
                    <div
                      key={tenant.id}
                      onClick={() => onSelectTenant(tenant)}
                      className="bg-slate-800/90 border border-slate-700/80 hover:border-emerald-500 p-5 rounded-3xl cursor-pointer shadow-lg hover:scale-[1.01] transition-all flex flex-col justify-between group"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-2xl ${badgeBg} flex items-center justify-center font-black text-xs text-center p-1 leading-tight shrink-0`}>
                            {rNum !== '-' ? rNum : 'ใหม่'}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="font-extrabold text-white text-xs group-hover:text-emerald-300 truncate">{tenant.name}</h4>
                            <span className={`text-[10px] font-bold block mt-0.5 ${rNum === '-' ? 'text-indigo-300' : 'text-emerald-400'}`}>
                              {badge}
                            </span>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 leading-relaxed">
                          {desc}
                        </p>
                      </div>

                      <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-[11px] font-bold text-emerald-400">
                        <span>สวมบทบาทผู้เช่า</span>
                        <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center pt-4 border-t border-slate-800 max-w-6xl mx-auto w-full shrink-0">
        <p className="text-[10px] text-slate-500">
          HorPlus Version 2 &copy; 2026. Non-production client prototype with full LocalStorage persistence.
        </p>
      </div>

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        onClose={() => setIsResetConfirmOpen(false)}
        onConfirm={handleReset}
        title="ยืนยันการรีเซ็ตข้อมูลสาธิต"
        message="การรีเซ็ตจะลบข้อมูลที่สร้างหรือแก้ไขใน Prototype บน Browser นี้ และนำข้อมูลตัวอย่างเริ่มต้นกลับมา"
        confirmText="ยืนยันรีเซ็ตข้อมูล"
        cancelText="ยกเลิก"
        type="danger"
      />
    </div>
  );
};
