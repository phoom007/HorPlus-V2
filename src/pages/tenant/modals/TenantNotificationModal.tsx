/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Modals: Notification Center (ศูนย์การแจ้งเตือน)
 * Refactored to Mobile Bottom Sheet with drag-to-dismiss and no 'X' button.
 */

import React from 'react';
import { Bell, CreditCard, Wrench, Megaphone } from 'lucide-react';
import { Bill, MaintenanceRequest as RepairRequest, Announcement } from '../../../types';
import { formatThaiDate } from '../../../components/GlobalComponents';
import { formatThaiCycle, getAuthorRoleName } from '../tenantHelpers';
import { TenantBottomSheet } from '../components/TenantBottomSheet';

export interface TenantNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalNotificationsCount: number;
  unreadBills: Bill[];
  activeRepairs: RepairRequest[];
  urgentAnnouncements: Announcement[];
  notices: any[];
  onSelectBillPayment: () => void;
  onSelectRepairTrack: () => void;
  onSelectAnnouncement: () => void;
  handleMarkNoticeAsRead: (id: string) => void;
  onAcknowledgeAlert?: (id: string) => void;
  acknowledgedAlertIds?: string[];
}

const formatNoticeMessage = (msg: string): string => {
  if (!msg) return '';
  let clean = msg.replace(/รายการแจ้งซ่อม\s+#[A-Za-z0-9-_]+\s+/g, 'รายการแจ้งซ่อม ');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+(?:in_progress|inprogress)/gi, 'เปลี่ยนสถานะเป็น กำลังซ่อมแซม');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+pending/gi, 'เปลี่ยนสถานะเป็น รอดำเนินการ');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+waiting_parts/gi, 'เปลี่ยนสถานะเป็น รออะไหล่');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+(?:resolved|completed)/gi, 'เปลี่ยนสถานะเป็น ดำเนินการเสร็จสิ้น');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+closed/gi, 'เปลี่ยนสถานะเป็น ปิดงาน');
  clean = clean.replace(/เปลี่ยนสถานะเป็น\s+cancelled/gi, 'เปลี่ยนสถานะเป็น ยกเลิก');
  return clean;
};

const getRepairStatusLabel = (status: string): string => {
  switch (status) {
    case 'in_progress':
    case 'inprogress':
      return 'กำลังซ่อมแซม';
    case 'waiting_parts':
      return 'รออะไหล่';
    case 'resolved':
    case 'completed':
      return 'ดำเนินการเสร็จสิ้น';
    case 'closed':
      return 'ปิดงาน';
    case 'cancelled':
      return 'ยกเลิก';
    default:
      return 'รอดำเนินการ';
  }
};

export const TenantNotificationModal: React.FC<TenantNotificationModalProps> = ({
  isOpen,
  onClose,
  totalNotificationsCount,
  unreadBills,
  activeRepairs,
  urgentAnnouncements,
  notices,
  onSelectBillPayment,
  onSelectRepairTrack,
  onSelectAnnouncement,
  handleMarkNoticeAsRead,
  onAcknowledgeAlert,
  acknowledgedAlertIds = [],
}) => {
  const totalListItems = unreadBills.length + activeRepairs.length + urgentAnnouncements.length + notices.length;
  const modalTitle = totalNotificationsCount > 0
    ? `การแจ้งเตือนทั้งหมด (${totalNotificationsCount})`
    : 'การแจ้งเตือนทั้งหมด';

  return (
    <TenantBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      maxHeightClass="max-h-[85vh]"
    >
      <div className="space-y-4 font-sans text-xs">

        <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
          {/* Unpaid Bills */}
          {unreadBills.map((b) => {
            const isAck = acknowledgedAlertIds.includes(`bill-${b.id}`);
            return (
              <div
                key={b.id}
                className={`p-3 rounded-2xl flex items-center justify-between gap-3 border transition-all ${
                  isAck
                    ? 'bg-slate-50 border-slate-200/70 opacity-75'
                    : 'bg-amber-50/70 border-amber-200/60 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold ${
                    isAck ? 'bg-slate-200 text-slate-600' : 'bg-amber-100 text-amber-700'
                  }`}>
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h5 className={`font-extrabold text-[11px] truncate ${isAck ? 'text-slate-700' : 'text-amber-900'}`}>
                        มียอดค้างชำระ {formatThaiCycle(b.cycleId)}
                      </h5>
                      {isAck && (
                        <span className="text-[8px] font-bold px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded">เปิดดูแล้ว</span>
                      )}
                    </div>
                    <p className={`text-[9px] ${isAck ? 'text-slate-500' : 'text-amber-700'}`}>
                      จำนวน ฿{Number(b.totalAmount).toLocaleString('th-TH')} บาท
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`btn-notif-action-bill-${b.id}`}
                  onClick={() => {
                    onAcknowledgeAlert?.(`bill-${b.id}`);
                    onClose();
                    onSelectBillPayment();
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer ${
                    isAck
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      : 'bg-amber-600 hover:bg-amber-700 text-white'
                  }`}
                >
                  ชำระเงิน
                </button>
              </div>
            );
          })}

          {/* Active Repairs */}
          {activeRepairs.map((r) => {
            const isAck = acknowledgedAlertIds.includes(`repair-${r.id}`);
            return (
              <div
                key={r.id}
                className={`p-3 rounded-2xl flex items-center justify-between gap-3 border transition-all ${
                  isAck
                    ? 'bg-slate-50 border-slate-200/70 opacity-75'
                    : 'bg-indigo-50/70 border-indigo-200/60 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold ${
                    isAck ? 'bg-slate-200 text-slate-600' : 'bg-indigo-100 text-indigo-700'
                  }`}>
                    <Wrench className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h5 className={`font-extrabold text-[11px] truncate ${isAck ? 'text-slate-700' : 'text-indigo-900'}`}>
                        แจ้งซ่อม: {r.title}
                      </h5>
                      {isAck && (
                        <span className="text-[8px] font-bold px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded">เปิดดูแล้ว</span>
                      )}
                    </div>
                    <p className={`text-[9px] ${isAck ? 'text-slate-500' : 'text-indigo-700'}`}>
                      สถานะ: {getRepairStatusLabel(r.status)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`btn-notif-action-repair-${r.id}`}
                  onClick={() => {
                    onAcknowledgeAlert?.(`repair-${r.id}`);
                    onClose();
                    onSelectRepairTrack();
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer ${
                    isAck
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  }`}
                >
                  ติดตาม
                </button>
              </div>
            );
          })}

          {/* Urgent Announcements */}
          {urgentAnnouncements.map((a) => {
            const isAck = acknowledgedAlertIds.includes(`announcement-${a.id}`);
            return (
              <div
                key={a.id}
                className={`p-3 rounded-2xl flex items-center justify-between gap-3 border transition-all ${
                  isAck
                    ? 'bg-slate-50 border-slate-200/70 opacity-75'
                    : 'bg-violet-50/70 border-violet-200/60 shadow-2xs'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold ${
                    isAck ? 'bg-slate-200 text-slate-600' : 'bg-violet-100 text-violet-700'
                  }`}>
                    <Megaphone className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h5 className={`font-extrabold text-[11px] truncate ${isAck ? 'text-slate-700' : 'text-violet-900'}`}>
                        {a.title}
                      </h5>
                      {isAck && (
                        <span className="text-[8px] font-bold px-1.5 py-0.2 bg-slate-200 text-slate-600 rounded">เปิดดูแล้ว</span>
                      )}
                    </div>
                    <p className={`text-[9px] ${isAck ? 'text-slate-500' : 'text-violet-700'}`}>
                      โดย {getAuthorRoleName(a.author)} &bull;{' '}
                      {formatThaiDate(a.publishDate || a.createdAt.split('T')[0])}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`btn-notif-action-announcement-${a.id}`}
                  onClick={() => {
                    onAcknowledgeAlert?.(`announcement-${a.id}`);
                    onClose();
                    onSelectAnnouncement();
                  }}
                  className={`px-2.5 py-1.5 rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer ${
                    isAck
                      ? 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                      : 'bg-violet-600 hover:bg-violet-700 text-white'
                  }`}
                >
                  ดูประกาศ
                </button>
              </div>
            );
          })}

          {/* Persistent In-App Notices */}
          {notices.map((n) => (
            <div
              key={n.id}
              data-testid={`tenant-notice-item-${n.id}`}
              className={`p-3 border rounded-2xl flex items-center justify-between gap-3 ${n.isRead
                ? 'bg-slate-50 border-slate-200/80 text-slate-600'
                : 'bg-blue-50/80 border-blue-200 text-blue-900 font-semibold'
                }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold ${n.isRead ? 'bg-slate-200 text-slate-600' : 'bg-blue-100 text-blue-700'
                    }`}
                >
                  <Bell className="w-4 h-4" />
                </div>
                <div className="space-y-0.5 min-w-0">
                  <h5 className="font-extrabold text-[11px] truncate">{n.title}</h5>
                  <p className="text-[10px] leading-relaxed line-clamp-2">{formatNoticeMessage(n.message)}</p>
                  <span className="text-[9px] opacity-75">{formatThaiDate(n.createdAt)}</span>
                </div>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  data-testid={`button-tenant-notice-read-${n.id}`}
                  onClick={() => handleMarkNoticeAsRead(n.id)}
                  className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[9px] font-extrabold transition-all shrink-0 cursor-pointer"
                >
                  อ่านแล้ว
                </button>
              )}
            </div>
          ))}

          {totalListItems === 0 && (
            <p className="text-center py-8 text-slate-400 font-medium">
              ไม่มีรายการแจ้งเตือนใหม่ในขณะนี้
            </p>
          )}
        </div>

        <div className="pt-2 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-extrabold transition-all cursor-pointer"
          >
            ปิด
          </button>
        </div>
      </div>
    </TenantBottomSheet>
  );
};
