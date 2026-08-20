/**
 * Owner Staff & Access Grant Management (Task-009 Final Product Model)
 * @license Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Plus,
  Trash2,
  Link as LinkIcon,
  Copy,
  Clock,
  Users2,
  ShieldAlert,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { Task009ApiAdapter, StaffMember, LineFriend, SlotUsage } from '../../data/adapters/task009';

interface OwnerUsersProps {
  onAddLog: (action: string, details: string, type: string, id: string) => void;
}

export const OwnerUsers: React.FC<OwnerUsersProps> = ({ onAddLog }) => {
  const [permanentOwners, setPermanentOwners] = useState<StaffMember[]>([]);
  const [accessGrants, setAccessGrants] = useState<StaffMember[]>([]);
  const [lineFriends, setLineFriends] = useState<LineFriend[]>([]);
  const [slotUsage, setSlotUsage] = useState<SlotUsage>({
    googleOwnersCount: 1,
    activeGrantsCount: 0,
    totalUsedSlots: 1,
    maxSlots: 10
  });

  const [selectedFriendId, setSelectedFriendId] = useState<string>('');
  const [grantRole, setGrantRole] = useState<'OWNER' | 'MANAGER' | 'STAFF'>('MANAGER');
  const [isCreating, setIsCreating] = useState(false);
  const [createdGrantResult, setCreatedGrantResult] = useState<{
    bearerUrl: string;
    grant: any;
  } | null>(null);

  const [copiedGrantId, setCopiedGrantId] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{ id: string; name: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean; type: 'success' | 'error' }>({
    message: '',
    visible: false,
    type: 'success'
  });

  const getDormId = (): string => {
    return (
      localStorage.getItem('selected_dormitory_id') ||
      sessionStorage.getItem('active_dormitory_selected_for_session') ||
      ''
    );
  };

  // Fetch Staff and LINE Friends from backend
  const fetchStaffData = async () => {
    const dormId = getDormId();
    if (!dormId) return;

    const resStaff = await Task009ApiAdapter.getStaff(dormId);
    if (resStaff.success && resStaff.data) {
      setPermanentOwners(resStaff.data.permanentOwners || []);
      setAccessGrants(resStaff.data.accessGrants || []);
      setSlotUsage(
        resStaff.data.slotUsage || {
          googleOwnersCount: 1,
          activeGrantsCount: 0,
          totalUsedSlots: 1,
          maxSlots: 10
        }
      );
    }

    const resFriends = await Task009ApiAdapter.getLineFriends(dormId);
    if (resFriends.success && resFriends.data) {
      setLineFriends(resFriends.data || []);
      if (resFriends.data.length > 0 && !selectedFriendId) {
        setSelectedFriendId(resFriends.data[0].id);
      }
    }
  };

  useEffect(() => {
    fetchStaffData();
  }, []);

  const handleCreateGrant = async () => {
    if (isCreating) return;
    const dormId = getDormId();
    if (!dormId) {
      setToast({ message: 'กรุณาเลือกหอพักก่อนดำเนินการ', visible: true, type: 'error' });
      return;
    }

    const targetFriendId = selectedFriendId || lineFriends[0]?.id;
    if (!targetFriendId) {
      setToast({ message: 'กรุณาเลือก LINE Friend ที่ต้องการมอบสิทธิ์', visible: true, type: 'error' });
      return;
    }

    setIsCreating(true);
    const res = await Task009ApiAdapter.createAccessGrant(dormId, targetFriendId, grantRole);
    setIsCreating(false);

    if (res.success && res.data) {
      setCreatedGrantResult(res.data);
      setToast({
        message: `สร้างสิทธิ์เข้าใช้งานระดับ ${grantRole} สำเร็จ!`,
        visible: true,
        type: 'success'
      });
      onAddLog(
        'สร้าง Access Grant สิทธิ์ด่วน',
        `สร้างสิทธิ์ Access Grant สำหรับ LINE Friend (Role: ${grantRole})`,
        'AccessGrant',
        res.data.grant?.id || ''
      );
      fetchStaffData();
    } else {
      const errCode = res.error?.code;
      const errMsg =
        res.error?.message ||
        (errCode === 'STAFF_LIMIT_EXCEEDED'
          ? 'จำนวนสิทธิ์เกินโควตาสูงสุด 10 สิทธิ์ต่อหอพัก'
          : errCode === 'ACTIVE_GRANT_EXISTS'
          ? 'LINE Friend ท่านนี้มีสิทธิ์ Access Grant ที่ใช้งานอยู่แล้ว'
          : 'ไม่สามารถสร้างสิทธิ์ access grant ได้');
      setToast({ message: errMsg, visible: true, type: 'error' });
    }
  };

  const handleRoleChange = async (grantId: string, newRole: 'OWNER' | 'MANAGER' | 'STAFF') => {
    const dormId = getDormId();
    if (!dormId) return;

    const res = await Task009ApiAdapter.updateAccessGrantRole(dormId, grantId, newRole);
    if (res.success) {
      setToast({ message: `อัปเดตสิทธิ์เป็น ${newRole} เรียบร้อยแล้ว`, visible: true, type: 'success' });
      onAddLog('อัปเดตระดับสิทธิ์ Access Grant', `เปลี่ยนสิทธิ์เป็น ${newRole}`, 'AccessGrant', grantId);
      fetchStaffData();
    } else {
      setToast({ message: res.error?.message || 'ไม่สามารถอัปเดตสิทธิ์ได้', visible: true, type: 'error' });
    }
  };

  const handleRevokeGrant = async (grantId: string) => {
    const dormId = getDormId();
    if (!dormId) return;

    const res = await Task009ApiAdapter.revokeAccessGrant(dormId, grantId);
    setRevokeConfirm(null);

    if (res.success) {
      setToast({
        message: 'เพิกถอนสิทธิ์เข้าใช้งานเรียบร้อยแล้ว (คืนโควตา 1 สิทธิ์)',
        visible: true,
        type: 'success'
      });
      onAddLog('เพิกถอน Access Grant', `เพิกถอน Access Grant (ID: ${grantId}) ถาวร`, 'AccessGrant', grantId);
      fetchStaffData();
    } else {
      setToast({ message: res.error?.message || 'ไม่สามารถเพิกถอนสิทธิ์ได้', visible: true, type: 'error' });
    }
  };

  const handleGetCopyLink = async (grantId: string) => {
    const dormId = getDormId();
    if (!dormId) return;

    const res = await Task009ApiAdapter.getCopyLink(dormId, grantId);
    if (res.success && res.data?.bearerUrl) {
      navigator.clipboard.writeText(res.data.bearerUrl).then(() => {
        setCopiedGrantId(grantId);
        setToast({ message: 'คัดลอกลิงก์สิทธิ์เรียบร้อยแล้ว', visible: true, type: 'success' });
        setTimeout(() => setCopiedGrantId(null), 2000);
      });
    } else {
      setToast({ message: res.error?.message || 'ไม่สามารถคัดลอกลิงก์สิทธิ์ได้', visible: true, type: 'error' });
    }
  };

  const handleRetryDelivery = async (grantId: string) => {
    const dormId = getDormId();
    if (!dormId) return;

    const res = await Task009ApiAdapter.retryDelivery(dormId, grantId);
    if (res.success) {
      setToast({ message: 'ส่งข้อความ Flex แจ้งเตือนสิทธิ์ซ้ำเรียบร้อยแล้ว', visible: true, type: 'success' });
      fetchStaffData();
    } else {
      setToast({ message: res.error?.message || 'ไม่สามารถส่งข้อความซ้ำได้', visible: true, type: 'error' });
    }
  };

  const renderDeliveryBadge = (grant: StaffMember) => {
    const statusVal = grant.lastDeliveryStatus || 'sent';
    switch (statusVal) {
      case 'sent':
      case 'ACCEPTED':
        return <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-extrabold">ส่งสำเร็จ</span>;
      case 'failed':
      case 'DEFINITIVE_FAILURE':
        return <span className="px-2 py-0.5 bg-rose-100 text-rose-800 rounded text-[10px] font-extrabold">ส่งล้มเหลว</span>;
      case 'quota_exhausted':
        return <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[10px] font-extrabold">โควตาเต็ม</span>;
      case 'retry_pending':
      case 'RETRYABLE_UNKNOWN':
        return <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-[10px] font-extrabold">รอส่งซ้ำ</span>;
      default:
        return <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-extrabold">พร้อมใช้งาน</span>;
    }
  };

  const dormId = getDormId();
  if (!dormId) {
    return (
      <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-3xs text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
        <h3 className="text-base font-extrabold text-slate-900">ยังไม่ได้เลือกหอพัก</h3>
        <p className="text-xs text-slate-500">กรุณาเลือกหอพักจากเมนูด้านบนเพื่อเริ่มจัดการทีมงานและสิทธิ์ Access Grant</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Toast Notification */}
      {toast.visible && (
        <div
          data-testid="toast-message"
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-2xl shadow-2xl text-xs font-extrabold border transition-all animate-in fade-in duration-200 ${
            toast.type === 'success'
              ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
              : 'bg-rose-950 text-rose-300 border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <span>{toast.message}</span>
            <button onClick={() => setToast({ ...toast, visible: false })} className="ml-2 hover:opacity-70">
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Top Banner: Account Slot Usage Meter */}
      <div
        data-testid="slot-usage-meter"
        className="bg-slate-900 border border-slate-800 p-4 sm:p-5 rounded-3xl text-white shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users2 className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-extrabold text-white">จัดการทีมงาน & สิทธิ์การเข้าถึง (Staff Access Grants)</h3>
          </div>
          <p className="text-xs text-slate-400">
            จำกัดสูงสุดไม่เกิน {slotUsage.maxSlots} สิทธิ์ต่อหอพัก (นับรวมเจ้าของหลักและ Access Grants ที่มีผลใช้งานอยู่)
          </p>
        </div>

        <div className="flex items-center gap-3 bg-slate-800/80 border border-slate-700/50 px-4 py-2 rounded-2xl shrink-0">
          <div className="text-right">
            <div className="text-[10px] uppercase font-extrabold tracking-wider text-slate-400">จำนวนสิทธิ์ที่ใช้</div>
            <div className="text-sm font-black text-indigo-400">
              {slotUsage.totalUsedSlots} / {slotUsage.maxSlots} สิทธิ์
            </div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-extrabold text-xs">
            {Math.round((slotUsage.totalUsedSlots / slotUsage.maxSlots) * 100)}%
          </div>
        </div>
      </div>

      {/* Permanent Google Owner Section */}
      <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-3xs space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-extrabold text-slate-950 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            เจ้าของระบบหลัก (Permanent Google Owner)
          </h4>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-lg text-[10px] font-extrabold">
            ไม่สามารถเพิกถอนได้
          </span>
        </div>

        {permanentOwners.length === 0 ? (
          <div data-testid="permanent-owner-row" className="p-4 bg-slate-50 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold">
                PO
              </div>
              <div>
                <div className="font-extrabold text-slate-900">เจ้าของหลัก (Google Account)</div>
                <div className="text-[10px] text-slate-400 font-mono">Google Authenticated Principal</div>
              </div>
            </div>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[10px]">
              เจ้าของหลัก
            </span>
          </div>
        ) : (
          permanentOwners.map((po) => (
            <div
              key={po.id}
              data-testid="permanent-owner-row"
              className="p-4 bg-slate-50/80 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-700 border border-slate-100"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-black">
                  {po.displayName.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                    {po.displayName}
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-extrabold">
                      {po.label || 'เจ้าของหลัก'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">{po.email || 'Google Authenticated Principal'}</div>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block">สิทธิ์ระบบ</span>
                <span className="text-xs font-black text-slate-900">OWNER</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Access Grants & LINE Friends Main Grid */}
      <div className="grid lg:grid-cols-12 gap-6 items-start w-full min-w-0">

        {/* Left Column: Create Bearer Access Grant */}
        <div className="lg:col-span-4 space-y-6 w-full min-w-0">
          <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-3xs space-y-4">
            <h4 className="text-xs font-extrabold text-slate-950 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-indigo-600 shrink-0" />
              สร้างสิทธิ์ Access Grant สำหรับ LINE Friend
            </h4>

            {/* Select LINE Friend */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-700">เลือก LINE Friend จากไดเรกทอรี *</label>
              {lineFriends.length === 0 ? (
                <div className="p-3 bg-amber-50 border border-amber-200/60 rounded-xl text-[11px] text-amber-800 space-y-1">
                  <p className="font-bold">ยังไม่พบเพื่อนใน LINE OA Directory</p>
                  <p className="text-[10px] text-amber-700 leading-normal">
                    ผู้ใช้ใหม่ที่เพิ่มเพื่อนใน LINE OA จะปรากฏอัตโนมัติเมื่อส่งข้อความ/ติดตาม
                  </p>
                </div>
              ) : (
                <select
                  data-testid="line-friend-select"
                  value={selectedFriendId}
                  onChange={(e) => setSelectedFriendId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-slate-50 text-slate-800 font-extrabold text-xs focus:bg-white focus:border-indigo-500 focus:outline-none transition-all cursor-pointer"
                >
                  {lineFriends.map((lf) => (
                    <option key={lf.id} value={lf.id}>
                      {lf.displayName} ({lf.friendStatus})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Select Role */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold text-slate-700">ระดับสิทธิ์ในการเข้าถึง (Role) *</label>
              <select
                data-testid="grant-role-select"
                value={grantRole}
                onChange={(e) => setGrantRole(e.target.value as any)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl bg-slate-50 text-slate-800 font-extrabold text-xs focus:bg-white focus:border-indigo-500 focus:outline-none transition-all cursor-pointer"
              >
                <option value="OWNER">OWNER (เจ้าของร่วม - ดูแลได้ทุกอย่าง)</option>
                <option value="MANAGER">MANAGER (ผู้จัดการ - ดูแลคนพัก สัญญา บิล)</option>
                <option value="STAFF">STAFF (พนักงานทั่วไป - แม่บ้าน / ช่าง)</option>
              </select>
            </div>

            <button
              data-testid="create-grant-button"
              onClick={handleCreateGrant}
              disabled={isCreating || slotUsage.totalUsedSlots >= slotUsage.maxSlots || lineFriends.length === 0}
              className={`w-full py-2.5 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all ${
                isCreating || slotUsage.totalUsedSlots >= slotUsage.maxSlots || lineFriends.length === 0
                  ? 'bg-indigo-300 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 cursor-pointer'
              }`}
            >
              {isCreating ? (
                <>กำลังสร้างสิทธิ์...</>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  สร้างสิทธิ์ Access Grant
                </>
              )}
            </button>
          </div>

          {/* Flex Message Payload Result Box */}
          {createdGrantResult && (
            <div className="bg-emerald-900 border border-emerald-800 p-4 rounded-3xl text-white space-y-3 shadow-lg animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold text-emerald-400 uppercase tracking-wider">
                  สร้างสิทธิ์ & Flex Message สำเร็จ
                </span>
                <button onClick={() => setCreatedGrantResult(null)} className="text-emerald-400 hover:text-white text-xs cursor-pointer">
                  ✕
                </button>
              </div>

              <div className="bg-emerald-950/60 p-3 rounded-2xl border border-emerald-800/50 space-y-2 text-xs font-mono break-all">
                <div className="text-slate-300 text-[10px]">Bearer Link:</div>
                <div className="text-emerald-300 font-bold text-[11px]">{createdGrantResult.bearerUrl}</div>
              </div>

              <button
                data-testid="copy-created-grant-link-button"
                onClick={() => {
                  navigator.clipboard.writeText(createdGrantResult.bearerUrl).then(() => {
                    setCopiedGrantId('new-grant');
                    setTimeout(() => setCopiedGrantId(null), 2000);
                  });
                }}
                className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedGrantId === 'new-grant' ? 'คัดลอกลิงก์เรียบร้อย!' : 'คัดลอกลิงก์สิทธิ์ Access Grant'}
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Active Access Grants List */}
        <div className="lg:col-span-8 bg-white p-5 rounded-3xl border border-gray-100 shadow-3xs space-y-4 w-full min-w-0">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-extrabold text-slate-950 flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600 shrink-0" />
              รายการ Access Grants ที่มีผลใช้งาน ({accessGrants.length})
            </h4>
            <button
              onClick={fetchStaffData}
              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" /> รีเฟรช
            </button>
          </div>

          {accessGrants.length === 0 ? (
            <div className="p-8 border border-dashed border-slate-200 bg-slate-50/50 rounded-2xl text-center space-y-2">
              <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-bold text-slate-500">ยังไม่มีการสร้าง Access Grant เพิ่มเติม</p>
              <p className="text-[10px] text-gray-400">เลือกเพื่อนจาก LINE Friend Directory ทางด้านซ้ายเพื่อมอบสิทธิ์ใช้งาน</p>
            </div>
          ) : (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse min-w-[650px]">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="py-3 px-2">LINE Profile</th>
                    <th className="py-3 px-2">ระดับสิทธิ์ (Role)</th>
                    <th className="py-3 px-2">Token Prefix</th>
                    <th className="py-3 px-2 text-center">การจัดส่ง Flex</th>
                    <th className="py-3 px-2 text-center">จัดการสิทธิ์</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-slate-50 font-bold">
                  {accessGrants.map((grant) => (
                    <tr key={grant.id} data-testid={`access-grant-row-${grant.id}`} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2.5">
                          {grant.pictureUrl ? (
                            <img src={grant.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover border border-slate-200" />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-extrabold text-[10px]">
                              LINE
                            </div>
                          )}
                          <span className="font-extrabold text-slate-900">{grant.displayName}</span>
                        </div>
                      </td>

                      <td className="py-3 px-2">
                        <select
                          data-testid={`role-change-select-${grant.id}`}
                          value={grant.roleCode}
                          onChange={(e) => handleRoleChange(grant.id, e.target.value as any)}
                          className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-black text-slate-800 cursor-pointer"
                        >
                          <option value="OWNER">OWNER</option>
                          <option value="MANAGER">MANAGER</option>
                          <option value="STAFF">STAFF</option>
                        </select>
                      </td>

                      <td className="py-3 px-2 font-mono text-[11px] text-slate-500">
                        {grant.tokenPrefix || '••••••••'}
                      </td>

                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {renderDeliveryBadge(grant)}
                          <button
                            data-testid={`retry-delivery-button-${grant.id}`}
                            onClick={() => handleRetryDelivery(grant.id)}
                            className="p-1 text-indigo-600 hover:bg-indigo-50 rounded transition-colors cursor-pointer"
                            title="ส่งข้อความ Flex ซ้ำ"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            data-testid={`copy-link-button-${grant.id}`}
                            onClick={() => handleGetCopyLink(grant.id)}
                            className="p-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="คัดลอกลิงก์สิทธิ์"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            data-testid={`revoke-grant-button-${grant.id}`}
                            onClick={() => setRevokeConfirm({ id: grant.id, name: grant.displayName })}
                            className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="เพิกถอนสิทธิ์ถาวร"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal: Confirm Revocation */}
      {revokeConfirm && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150">
          <div className="bg-white p-6 rounded-3xl max-w-sm w-full space-y-4 border border-slate-100 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center text-rose-600 mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="text-center space-y-1">
              <h4 className="text-sm font-extrabold text-slate-900">ยืนยันการเพิกถอนสิทธิ์ Access Grant</h4>
              <p className="text-xs text-slate-500">
                เพิกถอนสิทธิ์การเข้าใช้งานของ <strong className="text-slate-900">{revokeConfirm.name}</strong> ถาวร (ทุก session ที่เปิดอยู่จะถูกตัดสิทธิ์ทันที)
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setRevokeConfirm(null)}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                data-testid="confirm-revoke-button"
                onClick={() => handleRevokeGrant(revokeConfirm.id)}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs rounded-xl cursor-pointer"
              >
                เพิกถอนทันที
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
