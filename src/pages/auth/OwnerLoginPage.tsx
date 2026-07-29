/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  Building,
  ShieldCheck,
  UserCheck,
  Sparkles,
  ArrowLeft,
  Settings,
  Wrench,
  DollarSign,
  UserPlus,
  Lock,
  X,
  Plus,
  CheckCircle2,
  MapPin,
  Home,
  ChevronRight,
  User,
  Users
} from 'lucide-react';
import { setOwnerDemoSession } from '../../demo/demoSession';
import { initialUsers, getDormitories, saveDormitory } from '../../data/mockData';
import { User as UserType, Dormitory } from '../../types';
import { DemoDisclosureBanner } from '../../components/public/DemoDisclosureBanner';

interface OwnerLoginPageProps {
  onLoginSuccess: (user: UserType) => void;
}

export const OwnerLoginPage: React.FC<OwnerLoginPageProps> = ({ onLoginSuccess }) => {
  const navigate = useNavigate();
  const [showPicker, setShowPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dormitories' | 'staff'>('dormitories');

  // Load all dormitories created for this account (max 10)
  const dormitories = getDormitories();
  const maxDorms = 10;
  const isQuotaFull = dormitories.length >= maxDorms;

  // Filter seed users by role
  const ownerUser = initialUsers.find(u => u.roleId === 'role-owner') || initialUsers[0];
  const managerUser = initialUsers.find(u => u.roleId === 'role-manager') || {
    id: 'user-manager-01',
    name: 'คุณดวงใจ (ผู้จัดการนิติ)',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150',
    roleId: 'role-manager',
    roleName: 'ผู้จัดการ',
    email: 'duangjai.m@HorPlus.com',
    description: 'ดูแลผู้เช่าและออกบิล',
    createdAt: new Date().toISOString()
  };
  const financeUser = {
    id: 'user-finance-01',
    name: 'คุณนารี (การเงิน)',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150',
    roleId: 'role-finance',
    roleName: 'การเงิน',
    email: 'naree.f@HorPlus.com',
    description: 'ตรวจสลิปและใบเสร็จ',
    createdAt: new Date().toISOString()
  };
  const staffUser = initialUsers.find(u => u.roleId === 'role-staff') || {
    id: 'user-staff-01',
    name: 'คุณสมชาย (ช่าง/แม่บ้าน)',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150',
    roleId: 'role-staff',
    roleName: 'เจ้าหน้าที่หอ',
    email: 'somchai.s@HorPlus.com',
    description: 'จดมิเตอร์และงานซ่อม',
    createdAt: new Date().toISOString()
  };

  const handleSelectDormitory = (dorm: Dormitory) => {
    setIsLoading(true);
    saveDormitory(dorm);
    setTimeout(() => {
      setOwnerDemoSession(ownerUser);
      onLoginSuccess(ownerUser);
      setIsLoading(false);
      navigate('/owner/dashboard');
    }, 300);
  };

  const handleSelectAccount = (selectedUser: UserType) => {
    setIsLoading(true);
    setTimeout(() => {
      setOwnerDemoSession(selectedUser);
      onLoginSuccess(selectedUser);
      setIsLoading(false);
      navigate('/owner/dashboard');
    }, 300);
  };

  const handleNewOwnerOnboarding = () => {
    if (isQuotaFull) return;
    navigate('/owner/register');
  };

  // Dormitory profile avatars array
  const dormAvatars = [
    'https://images.unsplash.com/photo-1555854877-bab0e564b8d5?w=300',
    'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=300',
    'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=300',
    'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=300',
    'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=300'
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      <DemoDisclosureBanner />

      <div className="p-4 flex items-center justify-between max-w-7xl mx-auto w-full">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-indigo-600 font-bold bg-white px-3.5 py-2 rounded-xl border border-slate-200 shadow-2xs hover:shadow-xs transition-all"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>กลับสู่หน้าหลัก</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 hidden sm:inline">โควตาบัญชีนี้:</span>
          <span className="text-xs font-black bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-2.5 py-1 rounded-full">
            {dormitories.length} / {maxDorms} หอพัก
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200/90 p-6 sm:p-10 rounded-3xl max-w-md w-full space-y-8 shadow-xl relative overflow-hidden">
          {/* Subtle ambient light gradient */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Logo & Header */}
          <div className="text-center space-y-3 relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-400 p-3.5 text-white flex items-center justify-center mx-auto shadow-lg shadow-indigo-500/25">
              <Building2 className="w-9 h-9" />
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">เข้าสู่ระบบเจ้าของหอพัก</h2>
              <p className="text-xs text-slate-500 font-medium">
                เลือกหรือสร้างหอพักเพื่อเริ่มต้นจัดการระบบ HorPlus
              </p>
            </div>
          </div>

          {/* Google Sign In Button */}
          <div className="space-y-3 relative">
            <button
              onClick={() => setShowPicker(true)}
              className="w-full py-3.5 px-4 bg-white hover:bg-slate-50 text-slate-800 font-extrabold text-xs rounded-2xl border-2 border-slate-200 hover:border-indigo-400 shadow-xs hover:shadow-md flex items-center justify-center gap-3 transition-all cursor-pointer hover:scale-[1.01]"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>เข้าสู่ระบบด้วย Google (เลือก/เพิ่มหอพัก)</span>
            </button>


          </div>

          <div className="pt-2 text-center text-[10px] text-slate-400 space-y-1">
            <p>ระบบจำลองการจัดการหลายหอพัก (Multi-Dormitory Manager)</p>
            <div className="flex justify-center gap-3 font-semibold text-slate-500">
              <Link to="/terms" className="hover:underline">Terms of Service</Link>
              <span>•</span>
              <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Light-Themed Multi-Dormitory Profile Manager Modal */}
      {showPicker && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-in fade-in">
          <div className="bg-white border border-slate-200/90 rounded-3xl max-w-2xl w-full p-5 sm:p-8 space-y-6 shadow-2xl relative text-slate-800 max-h-[92vh] flex flex-col">
            {/* Close Button */}
            <button
              onClick={() => setShowPicker(false)}
              className="absolute top-5 right-5 p-2 text-slate-400 hover:text-slate-700 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Title & Google Account Info */}
            <div className="space-y-3 pr-8">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold shrink-0">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 leading-tight">เลือกหอพัก</h3>
                  <p className="text-xs text-slate-500 font-medium">
                    เลือกหอพักเพื่อเข้าสู่ระบบจัดการ
                  </p>
                </div>
              </div>

              {/* Logged-in Google Profile Bar & Quota */}
              <div className="p-2.5 sm:p-3 bg-slate-50 border border-slate-200/80 rounded-2xl flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100"
                    alt="Google User"
                    className="w-7 h-7 rounded-full object-cover border border-slate-300 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="font-extrabold text-slate-800 text-xs block truncate">นายสมศักดิ์ รักดี</span>
                    <span className="text-[10px] text-slate-400 block truncate">phoomgamertv@gmail.com</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-extrabold text-indigo-700 bg-indigo-50 border border-indigo-200/80 px-2.5 py-0.5 rounded-full">
                    {dormitories.length} / {maxDorms} หอพัก
                  </span>
                </div>
              </div>
            </div>

            {/* Section Header */}
            <div className="flex items-center gap-2 border-b border-slate-200 text-xs font-extrabold text-slate-800 pb-2">
            </div>

            {/* Multi-Dormitory Profile Cards */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-3 scrollbar-thin">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {dormitories.map((dorm, index) => {
                  const avatarUrl = dormAvatars[index % dormAvatars.length];
                  return (
                    <div
                      key={dorm.id}
                      onClick={() => handleSelectDormitory(dorm)}
                      className="bg-white hover:bg-slate-50/90 border border-slate-200 hover:border-indigo-400 rounded-2xl p-3.5 transition-all duration-200 cursor-pointer shadow-2xs hover:shadow-md group relative flex flex-col justify-between space-y-3"
                    >
                      {/* Profile Header Frame */}
                      <div className="flex items-start gap-3">
                        {/* Profile Image Frame with status ring */}
                        <div className="relative shrink-0">
                          <div className="w-12 h-12 rounded-xl overflow-hidden border border-indigo-100 shadow-2xs group-hover:scale-105 transition-transform bg-slate-100">
                            <img src={avatarUrl} alt={dorm.name} className="w-full h-full object-cover" />
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full" title="เปิดใช้งานอยู่" />
                        </div>

                        {/* Dormitory Info */}
                        <div className="min-w-0 flex-1">
                          <h4 className="text-xs font-black text-slate-900 group-hover:text-indigo-600 transition-colors truncate">
                            {dorm.name}
                          </h4>

                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span className="truncate">{dorm.address || 'เชียงใหม่'}</span>
                          </p>

                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2 py-0.5 rounded-md">
                              16 ห้อง
                            </span>
                            <span className="text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-md">
                              Active
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Card Footer Button Action */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] font-bold">
                        <span className="text-slate-400 text-[10px]">สิทธิ์: Owner</span>
                        <span className="text-indigo-600 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1">
                          <span>เข้าจัดการ</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Add Dormitory Card if quota remains */}
                {!isQuotaFull && (
                  <div
                    onClick={handleNewOwnerOnboarding}
                    className="bg-indigo-50/30 hover:bg-indigo-50/60 border-2 border-dashed border-indigo-200 hover:border-indigo-400 rounded-2xl p-3.5 transition-all duration-200 cursor-pointer flex flex-col items-center justify-center text-center space-y-1.5 min-h-[120px] group"
                  >
                    <div className="w-9 h-9 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-xs group-hover:scale-110 transition-transform">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-indigo-950">เพิ่มหอพักใหม่</h4>
                      <p className="text-[10px] text-indigo-600 font-medium">
                        โควตาคงเหลือ {maxDorms - dormitories.length} แห่ง
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Quota reached indicator */}
              {isQuotaFull && (
                <div className="p-2.5 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800 flex items-center gap-2 font-medium">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>สร้างหอพักครบโควตา {maxDorms} แห่งแล้ว</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

