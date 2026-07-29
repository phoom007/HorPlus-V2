/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Building2,
  Menu,
  X,
  UserCheck,
  Building,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  ChevronRight
} from 'lucide-react';
import { DemoDisclosureBanner } from './DemoDisclosureBanner';

export const PublicHeader: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { label: 'หน้าแรก', path: '/' },
    { label: 'ฟีเจอร์', path: '/features' },
    { label: 'ราคาแพ็กเกจ', path: '/pricing' },
    { label: 'วิธีเริ่มใช้งาน', path: '/how-it-works' },
    { label: 'ช่วยเหลือ', path: '/help' },
  ];

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs transition-all">
      <DemoDisclosureBanner compact />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-sky-400 p-2 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-all">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-extrabold tracking-tight text-slate-900">HorPlus</span>
                <span className="text-[10px] font-black bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-md">V2</span>
              </div>
              <p className="text-[10px] font-medium text-slate-500 leading-none">ระบบบริหารจัดการหอพักยุคใหม่</p>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                  isActive(link.path)
                    ? 'text-indigo-600 bg-indigo-50/80'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right Action Buttons */}
          <div className="hidden lg:flex items-center gap-2.5">
            <Link
              to="/demo"
              className="px-3 py-2 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all cursor-pointer border border-transparent hover:border-emerald-200/60"
            >
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>ผู้เช่าเข้าสู่ระบบ</span>
            </Link>

            <Link
              to="/auth/owner"
              className="px-3.5 py-2 text-slate-700 hover:text-indigo-700 hover:bg-indigo-50 font-extrabold text-xs rounded-xl flex items-center gap-1.5 transition-all border border-slate-200/80 hover:border-indigo-200 cursor-pointer shadow-2xs"
            >
              <Building className="w-4 h-4 text-indigo-600" />
              <span>เข้าสู่ระบบเจ้าของหอ</span>
            </Link>

            <Link
              to="/owner/register"
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-md shadow-indigo-600/20 flex items-center gap-1.5 transition-all cursor-pointer hover:gap-2"
            >
              <span>สมัครเริ่มใช้งาน</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>

            <Link
              to="/demo"
              className="px-2.5 py-2 text-amber-700 bg-amber-50 hover:bg-amber-100/80 border border-amber-200 font-extrabold text-xs rounded-xl flex items-center gap-1 transition-all cursor-pointer"
              title="ศูนย์ทดลองระบบ Demo Portal"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Demo</span>
            </Link>
          </div>

          {/* Mobile menu button */}
          <div className="flex md:hidden items-center gap-2">
            <Link
              to="/demo"
              className="px-2.5 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 font-bold text-[11px] rounded-lg flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3 text-amber-600" />
              <span>Demo</span>
            </Link>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-slate-600 hover:text-slate-900 rounded-xl hover:bg-slate-100 cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200/80 bg-white px-4 pt-3 pb-6 space-y-3 shadow-lg animate-in slide-in-from-top duration-200">
          <div className="flex flex-col space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between ${
                  isActive(link.path)
                    ? 'text-indigo-600 bg-indigo-50 font-extrabold'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <span>{link.label}</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </Link>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
            <Link
              to="/owner/register"
              onClick={() => setMobileMenuOpen(false)}
              className="w-full py-3 bg-indigo-600 text-white font-extrabold text-xs rounded-xl text-center shadow-md flex items-center justify-center gap-2"
            >
              <span>เริ่มใช้งานสำหรับเจ้าของหอพัก</span>
              <ArrowRight className="w-4 h-4" />
            </Link>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Link
                to="/auth/owner"
                onClick={() => setMobileMenuOpen(false)}
                className="py-2.5 bg-slate-100 border border-slate-200 text-slate-800 font-extrabold text-[11px] rounded-xl text-center flex items-center justify-center gap-1.5"
              >
                <Building className="w-3.5 h-3.5 text-indigo-600" />
                <span>เข้าสู่ระบบเจ้าของ</span>
              </Link>

              <Link
                to="/demo"
                onClick={() => setMobileMenuOpen(false)}
                className="py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 font-extrabold text-[11px] rounded-xl text-center flex items-center justify-center gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>ผู้เช่าเข้าสู่ระบบ</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
