/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Key,
  Link as LinkIcon,
  Copy,
  Check,
  ShieldAlert,
  Clock,
  Briefcase,
  Users2,
  Wrench,
  XCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface AccessToken {
  id: string; // UUID/token
  role: 'owner' | 'manager' | 'staff';
  createdAt: string;
  status: 'active' | 'deleted';
}

interface OwnerUsersProps {
  onAddLog: (action: string, details: string, type: string, id: string) => void;
}

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const formatThaiDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }) + ' น.';
  } catch (e) {
    return dateStr;
  }
};

export const OwnerUsers: React.FC<OwnerUsersProps> = ({
  onAddLog
}) => {
  const [accessTokens, setAccessTokens] = useState<AccessToken[]>(() => {
    const stored = localStorage.getItem('juristic_access_tokens');
    if (!stored) return [];
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return parsed.filter((t: AccessToken) => t && t.status !== 'deleted');
      }
    } catch (e) {
      console.error(e);
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('juristic_access_tokens', JSON.stringify(accessTokens));
  }, [accessTokens]);

  const [tokenRole, setTokenRole] = useState<'owner' | 'manager' | 'staff'>('staff');
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{ id: string; roleName: string; step: 1 | 2 } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean; type: 'success' | 'error' }>({
    message: '',
    visible: false,
    type: 'success'
  });
  const [isToastFading, setIsToastFading] = useState(false);

  useEffect(() => {
    if (toast.visible) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setToast(prev => ({ ...prev, visible: false }));
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toast.visible]);
  const itemsPerPage = 2;

  const totalPages = Math.ceil(accessTokens.length / itemsPerPage);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [accessTokens.length, totalPages, currentPage]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = accessTokens.slice(indexOfFirstItem, indexOfLastItem);

  const handleCreateTokenLink = () => {
    if (isCreating) return;
    setIsCreating(true);

    // Simulated short delay (600ms) for professional click prevention and feedback feel
    setTimeout(() => {
      const newTokenId = generateUUID();
      const newToken: AccessToken = {
        id: newTokenId,
        role: tokenRole,
        createdAt: new Date().toISOString(),
        status: 'active'
      };

      const updated = [newToken, ...accessTokens];
      setAccessTokens(updated);
      setCurrentPage(1);

      const roleThai = tokenRole === 'owner' ? 'เจ้าของหอพัก' : tokenRole === 'manager' ? 'ผู้จัดการ' : 'ช่าง/แม่บ้าน';
      onAddLog(
        'สร้างลิงก์สิทธิ์นิติบุคคลด่วน',
        `สร้างลิงก์เข้าใช้ระบบด่วน SaaS สำหรับระดับสิทธิ์ ${roleThai} (Token: ${newTokenId})`,
        'TokenAccess',
        newTokenId
      );

      // Trigger success toast
      setToast({
        message: `สร้างลิงก์เข้าใช้งานระดับ ${roleThai} เรียบร้อยแล้ว!`,
        visible: true,
        type: 'success'
      });

      setIsCreating(false);
    }, 600);
  };

  const handleRevokeToken = (id: string, roleName: string) => {
    setRevokeConfirm({ id, roleName, step: 1 });
  };

  const handleNextRevokeStep = () => {
    if (!revokeConfirm) return;
    if (revokeConfirm.step === 1) {
      setRevokeConfirm({ ...revokeConfirm, step: 2 });
    } else {
      const updated = accessTokens.filter(t => t.id !== revokeConfirm.id);
      setAccessTokens(updated);
      onAddLog(
        'เพิกถอนลิงก์สิทธิ์นิติบุคคล', 
        `ระงับการเข้าใช้งานลิงก์เข้าถึงด่วนของบทบาท ${revokeConfirm.roleName} (Token: ${revokeConfirm.id}) ถาวร`, 
        'TokenAccess', 
        revokeConfirm.id
      );
      setRevokeConfirm(null);
    }
  };

  const getAccessLink = (tokenId: string) => {
    const origin = window.location.origin + window.location.pathname;
    return `${origin}?token=${tokenId}`;
  };

  const handleCopyLink = (tokenId: string) => {
    const link = getAccessLink(tokenId);
    navigator.clipboard.writeText(link).then(() => {
      setCopiedTokenId(tokenId);
      setTimeout(() => setCopiedTokenId(null), 2000);
    }).catch(() => {
      // Fallback
      const el = document.createElement('textarea');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedTokenId(tokenId);
      setTimeout(() => setCopiedTokenId(null), 2000);
    });
  };

  return (
    <div className="space-y-6 w-full min-w-0">
      
      {/* Main Layout (Creator & Created Links) */}
      <div className="grid lg:grid-cols-12 gap-6 items-start w-full min-w-0">
        
        {/* Left Column: Generator */}
        <div className="lg:col-span-4 space-y-6 w-full min-w-0">
          
          {/* Creator panel */}
          <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-3xs space-y-5">
            <div>
              <h4 className="text-xs font-extrabold text-slate-950 flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-indigo-600 shrink-0" />
                สร้างลิงก์เข้าใช้งาน
              </h4>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-700">เลือกตำแหน่งงานสำหรับทีมงาน *</label>
              <select
                value={tokenRole}
                onChange={(e) => setTokenRole(e.target.value as any)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-slate-50 text-slate-800 font-extrabold text-xs cursor-pointer focus:bg-white focus:border-indigo-500 focus:outline-none transition-all"
              >
                <option value="owner">เจ้าของหอพัก (ดูแลได้ครบทุกอย่าง)</option>
                <option value="manager">ผู้จัดการ (ดูแลคนพัก สัญญา และออกบิล)</option>
                <option value="staff">ช่าง / แม่บ้าน (จดมิเตอร์น้ำไฟ และบันทึกงานซ่อม)</option>
              </select>
            </div>

            <button
              onClick={handleCreateTokenLink}
              disabled={isCreating}
              className={`w-full py-2.5 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all ${
                isCreating 
                  ? 'bg-indigo-400 cursor-not-allowed opacity-80' 
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 cursor-pointer'
              }`}
            >
              {isCreating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  กำลังสร้างลิงก์...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  สร้างลิงก์เข้าใช้ระบบ
                </>
              )}
            </button>
          </div>

        </div>

        {/* Right Column: History and Table of Links */}
        <div className="lg:col-span-8 bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-3xs space-y-4 w-full min-w-0 overflow-hidden">
          <div>
            <h4 className="text-xs font-extrabold text-slate-950 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
              ลิงก์เข้าใช้งาน
            </h4>
          </div>

          {accessTokens.length === 0 ? (
            <div className="p-8 sm:p-12 border border-dashed border-slate-200 bg-slate-50/50 rounded-2xl text-center space-y-2">
              <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-500">ยังไม่มีการสร้างลิงก์เข้าใช้งานในระบบ</p>
              <p className="text-[10px] text-gray-400">เลือกตำแหน่งของพนักงานจากเมนูด้านซ้ายเพื่อเริ่มสร้างลิงก์แรก</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className="w-full text-left border-collapse min-w-[600px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-1.5 sm:px-2">ตำแหน่งงาน</th>
                    <th className="py-3 px-1.5 sm:px-2">ลิงก์ทางลัดเข้าใช้งาน</th>
                    <th className="py-3 px-1.5 sm:px-2">วันที่สร้าง</th>
                    <th className="py-3 px-1.5 sm:px-2">ใช้งานล่าสุด</th>
                    <th className="py-3 px-1.5 sm:px-2 text-center">สถานะ</th>
                    <th className="py-3 px-1.5 sm:px-2 text-center">ลบ</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-slate-50">
                  {currentItems.map((t) => {
                    const roleLabel = t.role === 'owner' ? 'เจ้าของหอพัก' : t.role === 'manager' ? 'ผู้จัดการ' : 'ช่าง/แม่บ้าน';
                    const isDeleted = t.status === 'deleted';
                    const linkUrl = getAccessLink(t.id);

                    return (
                      <tr key={t.id} className={`hover:bg-slate-50/30 transition-colors ${isDeleted ? 'opacity-60 bg-slate-50/10' : ''}`}>
                        <td className="py-3 px-1.5 sm:px-2 font-bold whitespace-nowrap">
                          <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-[10px] font-extrabold inline-flex items-center gap-1 ${
                            t.role === 'owner' ? 'bg-indigo-50 border-indigo-100 text-indigo-700' :
                            t.role === 'manager' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' :
                            'bg-amber-50 border-amber-100 text-amber-700'
                          }`}>
                            {t.role === 'owner' && <Users2 className="w-3 h-3" />}
                            {t.role === 'manager' && <Briefcase className="w-3 h-3" />}
                            {t.role === 'staff' && <Wrench className="w-3 h-3" />}
                            {roleLabel}
                          </span>
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 font-mono text-[10px]">
                          <div className="flex items-center gap-1.5 min-w-[150px] max-w-[280px] w-full">
                            <input
                              type="text"
                              readOnly
                              value={isDeleted ? '❌ ลิงก์นี้ถูกปิดและระงับการเข้าใช้ถาวรแล้ว' : linkUrl}
                              className={`text-[9px] border rounded-lg px-2 py-0.5 sm:px-2.5 sm:py-1 w-full font-mono select-all ${
                                isDeleted
                                  ? 'bg-rose-50/50 border-rose-100 text-rose-500 italic font-sans'
                                  : 'bg-slate-50 border-slate-150 text-slate-600 font-semibold'
                              }`}
                            />
                            {!isDeleted && (
                              <button
                                onClick={() => handleCopyLink(t.id)}
                                className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-lg transition-all cursor-pointer shrink-0"
                                title="คัดลอกลิงก์"
                              >
                                {copiedTokenId === t.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 text-slate-400 text-[10px] whitespace-nowrap">
                          {formatThaiDate(t.createdAt)}
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 text-slate-400 text-[10px] whitespace-nowrap font-medium">
                          {t.lastUsedAt ? (
                            <span className="text-indigo-600 font-bold">{formatThaiDate(t.lastUsedAt)}</span>
                          ) : (
                            <span className="text-gray-300 italic">ยังไม่เคยเข้าใช้งาน</span>
                          )}
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 text-center whitespace-nowrap">
                          {isDeleted ? (
                            <span className="inline-flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 bg-rose-50 border border-rose-100 text-rose-600 rounded-md">
                              <XCircle className="w-2.5 h-2.5" />
                              ปิดลิงก์แล้ว
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[9px] font-extrabold px-2 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-md">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              ใช้งานได้
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 text-center whitespace-nowrap">
                          {!isDeleted ? (
                            <button
                              onClick={() => handleRevokeToken(t.id, roleLabel)}
                              className="p-1.5 text-rose-600 hover:bg-rose-50 border border-rose-100 hover:border-rose-200 rounded-xl transition-all cursor-pointer shadow-3xs inline-flex items-center justify-center hover:scale-105 active:scale-95"
                              title="ยกเลิกลิงก์และเพิกถอนสิทธิ์"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-gray-400 italic">ปิดแล้ว</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {accessTokens.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 pt-4 mt-2">
              <span className="text-[10px] sm:text-xs font-medium text-slate-500">
                แสดงผล {(currentPage - 1) * itemsPerPage + 1} - {Math.min(currentPage * itemsPerPage, accessTokens.length)} จากทั้งหมด {accessTokens.length} รายการ
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-100 rounded-lg transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-slate-200 disabled:hover:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
                  const isNear = Math.abs(p - currentPage) <= 1;
                  const isFirstOrLast = p === 1 || p === totalPages;
                  if (!isNear && !isFirstOrLast) {
                    if (p === 2 && currentPage > 3) {
                      return <span key="ellipsis-1" className="text-slate-400 text-xs px-1">...</span>;
                    }
                    if (p === totalPages - 1 && currentPage < totalPages - 2) {
                      return <span key="ellipsis-2" className="text-slate-400 text-xs px-1">...</span>;
                    }
                    return null;
                  }

                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCurrentPage(p)}
                      className={`min-w-[28px] h-7 flex items-center justify-center text-xs font-extrabold rounded-lg transition-all border cursor-pointer ${
                        currentPage === p
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                          : 'bg-white border-slate-200 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 hover:border-indigo-100'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}

                <button
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-100 rounded-lg transition-all disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:border-slate-200 disabled:hover:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Horizontal Access Policies */}
      <div className="bg-white p-4 sm:p-6 rounded-3xl border border-gray-100 shadow-3xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Key className="w-3.5 h-3.5" />
          </div>
          <h4 className="text-xs font-extrabold text-slate-900">ขอบเขตสิทธิ์การใช้งานของแต่ละตำแหน่ง</h4>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1">
          {/* Owner Policy */}
          <div className="bg-indigo-50/20 p-4 rounded-2xl border border-indigo-100/50 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-black">
                1
              </div>
              <h5 className="font-extrabold text-xs text-indigo-950">
                เจ้าของหอพัก
              </h5>
            </div>
            <ul className="space-y-1 text-[10px] text-slate-600 leading-relaxed list-none">
              <li className="flex items-center gap-1">
                <span className="text-indigo-500 font-bold shrink-0">✓</span>
                <span>เข้าถึงได้ทุกหน้าต่าง (11 หน้าต่างหลัก)</span>
              </li>
              <li className="flex items-start gap-1 text-[9px] text-slate-500 bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/30 mt-1">
                <span>หน้าหลัก, จดมิเตอร์, การชำระเงิน, ห้องพัก, ผู้เช่า, สัญญาเช่า, งานแจ้งซ่อม, ประชาสัมพันธ์, รายงานสถิติ, สิทธิ์และพนักงาน, ตั้งค่า</span>
              </li>
            </ul>
          </div>

          {/* Manager Policy */}
          <div className="bg-emerald-50/20 p-4 rounded-2xl border border-emerald-100/50 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-black">
                2
              </div>
              <h5 className="font-extrabold text-xs text-emerald-950">
                ผู้จัดการหอพัก
              </h5>
            </div>
            <ul className="space-y-1 text-[10px] text-slate-600 leading-relaxed list-none">
              <li className="flex items-center gap-1">
                <span className="text-emerald-500 font-bold shrink-0">✓</span>
                <span>เข้าถึงได้ 9 หน้าต่างหลัก</span>
              </li>
              <li className="flex items-start gap-1 text-[9px] text-slate-500 bg-emerald-50/50 p-2 rounded-lg border border-emerald-100/30 mt-1">
                <span>หน้าหลัก, จดมิเตอร์, การชำระเงิน, ห้องพัก, ผู้เช่า, สัญญาเช่า, งานแจ้งซ่อม, ประชาสัมพันธ์, รายงานสถิติ</span>
              </li>
            </ul>
          </div>

          {/* Staff Policy */}
          <div className="bg-amber-50/20 p-4 rounded-2xl border border-amber-100/50 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-amber-500 text-white flex items-center justify-center text-[10px] font-black">
                3
              </div>
              <h5 className="font-extrabold text-xs text-amber-950">
                ช่าง / แม่บ้าน
              </h5>
            </div>
            <ul className="space-y-1 text-[10px] text-slate-600 leading-relaxed list-none">
              <li className="flex items-center gap-1">
                <span className="text-amber-500 font-bold shrink-0">✓</span>
                <span>เข้าถึงได้ 3 หน้าต่างหลัก</span>
              </li>
              <li className="flex items-start gap-1 text-[9px] text-slate-500 bg-amber-50/50 p-2 rounded-lg border border-amber-100/30 mt-1">
                <span>หน้าหลัก, จดมิเตอร์, งานแจ้งซ่อม</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Custom Revoke Confirmation Modal */}
      {revokeConfirm && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-100 p-6 max-w-md w-full shadow-2xl space-y-6 scale-in-95 duration-200 animate-in">
            
            {/* Header Icon & Title */}
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-2xl shrink-0 ${
                revokeConfirm.step === 1 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'
              }`}>
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                  revokeConfirm.step === 1 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
                }`}>
                  {revokeConfirm.step === 1 ? 'ขั้นตอนที่ 1 / 2: ยืนยันปิดลิงก์' : 'ขั้นตอนที่ 2 / 2: ปิดลิงก์ถาวร'}
                </span>
                <h3 className="text-base font-extrabold text-slate-900 mt-2 leading-snug">
                  {revokeConfirm.step === 1 ? 'คุณแน่ใจหรือไม่ที่จะระงับสิทธิ์?' : '🚨 คำเตือนความปลอดภัย!'}
                </h3>
              </div>
            </div>

            {/* Description Text */}
            <div className="text-xs text-slate-500 leading-relaxed space-y-2.5">
              {revokeConfirm.step === 1 ? (
                <p>
                  คุณกำลังจะระงับและปิดสิทธิ์เข้าใช้งานลิงก์ <strong className="text-slate-900 font-bold">บทบาท {revokeConfirm.roleName}</strong> ลิงก์ดังกล่าวจะใช้ล็อกอินหรือเข้าถึงระบบไม่ได้อีกต่อไป
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="font-extrabold text-rose-600 bg-rose-50/50 p-3 rounded-xl border border-rose-100/60">
                    *เมื่อยืนยันแล้ว พนักงานทุกคนที่ใช้ลิงก์นี้อยู่จะหลุดออกจากระบบและเข้าใช้งานหอพักไม่ได้ทันที*
                  </p>
                  <p>
                    หากคุณยืนยัน โปรดคลิกปุ่ม <strong>"ยืนยันและระงับสิทธิ์ถาวร"</strong> ด้านล่างเพื่อดำเนินการ
                  </p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRevokeConfirm(null)}
                className="flex-1 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 text-xs font-extrabold rounded-xl transition-all cursor-pointer border border-slate-200"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleNextRevokeStep}
                className={`flex-1 py-2.5 text-white text-xs font-extrabold rounded-xl transition-all cursor-pointer shadow-sm ${
                  revokeConfirm.step === 1 
                    ? 'bg-amber-600 hover:bg-amber-700' 
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {revokeConfirm.step === 1 ? 'ถัดไป (ตรวจสอบระบบ)' : 'ยืนยันและระงับสิทธิ์ถาวร'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Floating Success Toast Notification with Smooth Fade */}
      {toast.visible && (
        <div 
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${
            isToastFading 
              ? 'opacity-0 translate-y-3 pointer-events-none' 
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
          }`}
        >
          <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
};
