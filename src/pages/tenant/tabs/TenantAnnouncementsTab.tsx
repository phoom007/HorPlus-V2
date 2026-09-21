/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Tab 2: Announcements (ข่าวสารและประกาศ)
 */

import React from 'react';
import {
  Megaphone,
  ChevronLeft,
  Zap,
  Droplet,
  Wrench,
  CreditCard,
  Shield,
  Pin,
  AlertCircle,
  Building as BuildingIcon
} from 'lucide-react';
import { Announcement } from '../../../types';
import { formatThaiDate } from '../../../components/GlobalComponents';
import { getAuthorRoleName } from '../tenantHelpers';

export interface TenantAnnouncementsTabProps {
  announcements: Announcement[];
  hasRoom?: boolean;
  onZoomImage: (url: string) => void;
  onBack?: () => void;
}

export const TenantAnnouncementsTab: React.FC<TenantAnnouncementsTabProps> = ({
  announcements,
  hasRoom = true,
  onZoomImage,
  onBack,
}) => {
  const filteredAnnouncements = announcements || [];

  if (hasRoom === false) {
    return (
      <div className="pb-20 animate-in fade-in duration-200 flex flex-col h-full bg-slate-50">
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
              aria-label="ย้อนกลับ"
            >
              <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
            </button>
          ) : (
            <div className="w-7" />
          )}
          <h3 className="text-xs font-black text-slate-900 text-center flex-1">ประกาศและข่าวสาร</h3>
          <div className="w-7 flex justify-end shrink-0">
            <Megaphone className="w-5 h-5 text-indigo-500" />
          </div>
        </div>

        <div className="py-24 text-center flex-1 flex items-center justify-center">
          <p className="text-slate-400 font-semibold text-xs">ไม่มีประกาศแจ้งเตือนในขณะนี้</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-20 animate-in fade-in duration-200">
      {/* Subview Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200/50 sticky top-0 z-30 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1 hover:bg-slate-100 text-slate-700 rounded-xl transition-all cursor-pointer"
          aria-label="ย้อนกลับ"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>
        <h3 className="text-xs font-black text-slate-900 text-center flex-1">ประกาศและข่าวสาร</h3>
        <div className="w-7 flex justify-end shrink-0">
          <Megaphone className="w-5 h-5 text-slate-400" />
        </div>
      </div>

      <div className="p-4 space-y-4">
        <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
          ข่าวสารและประกาศนิติบุคคล ({filteredAnnouncements.length})
        </h4>

      <div className="grid grid-cols-1 gap-4">
        {filteredAnnouncements.map((ann) => {
          const authorRole = getAuthorRoleName(ann.author);
          const authorInitial = authorRole.substring(0, 2);
          const authorBg = authorRole.includes('ช่าง')
            ? 'bg-emerald-500 text-white'
            : 'bg-violet-600 text-white';

          let badgeBg = 'bg-indigo-50 text-indigo-700 border-indigo-100';
          let badgeLabel = 'ทั่วไป';
          let badgeIcon = <Megaphone className="w-3 h-3 text-indigo-500" />;

          if (ann.type === 'electric_off') {
            badgeBg = 'bg-violet-50 text-violet-700 border-violet-100';
            badgeLabel = 'บำรุงรักษาระบบไฟฟ้า';
            badgeIcon = <Zap className="w-3 h-3 text-violet-500" />;
          } else if (ann.type === 'water_off') {
            badgeBg = 'bg-rose-50 text-rose-700 border-rose-100';
            badgeLabel = 'บำรุงรักษาระบบประปา';
            badgeIcon = <Droplet className="w-3 h-3 text-rose-500" />;
          } else if (ann.type === 'maintenance') {
            badgeBg = 'bg-emerald-50 text-emerald-700 border-emerald-100';
            badgeLabel = 'งานซ่อมบำรุง';
            badgeIcon = <Wrench className="w-3 h-3 text-emerald-500" />;
          } else if (ann.type === 'payment') {
            badgeBg = 'bg-amber-50 text-amber-700 border-amber-100';
            badgeLabel = 'แจ้งชำระเงินค่าเช่ารายเดือน';
            badgeIcon = <CreditCard className="w-3 h-3 text-amber-500" />;
          } else if (ann.type === 'safety') {
            badgeBg = 'bg-slate-50 text-slate-700 border-slate-100';
            badgeLabel = 'ระเบียบหอพัก';
            badgeIcon = <Shield className="w-3 h-3 text-slate-500" />;
          }

          return (
            <div
              key={ann.id}
              className="bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
            >
              <div>
                {ann.attachmentUrl && (
                  <img
                    src={ann.attachmentUrl}
                    alt={ann.title}
                    className="w-full h-40 object-cover border-b border-slate-50 cursor-zoom-in hover:brightness-95 transition-all"
                    referrerPolicy="no-referrer"
                    onClick={() => onZoomImage(ann.attachmentUrl!)}
                  />
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {ann.isPinned && (
                      <span className="inline-flex items-center gap-0.5 text-[8px] bg-violet-600 text-white font-black px-2 py-0.5 rounded-md">
                        <Pin className="w-2 h-2 fill-white text-white" />
                        ปักหมุด
                      </span>
                    )}
                    {ann.isUrgent && (
                      <span className="inline-flex items-center gap-0.5 text-[8px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-md">
                        <AlertCircle className="w-2 h-2" />
                        ด่วน
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-0.5 text-[8px] font-bold px-2 py-0.5 rounded-md border ${badgeBg}`}
                    >
                      {badgeIcon}
                      <span>{badgeLabel}</span>
                    </span>
                  </div>

                  <div className="flex">
                    <span className="inline-flex items-center gap-1 text-[9px] bg-slate-100 text-slate-600 font-extrabold px-2 py-0.5 rounded-md border border-slate-100">
                      <BuildingIcon className="w-3 h-3 text-slate-500" />
                      <span>{ann.customTarget || 'ทุกอาคาร'}</span>
                    </span>
                  </div>

                  <h5 className="font-extrabold text-slate-900 text-xs tracking-tight">
                    {ann.title}
                  </h5>
                  <p className="text-[10px] text-slate-500 leading-relaxed whitespace-pre-line">
                    {ann.content}
                  </p>

                  {ann.linkUrl && (
                    <div className="pt-1">
                      <a
                        href={ann.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[9px] font-extrabold text-indigo-600 hover:underline bg-indigo-50/50 px-2 py-1 rounded-lg"
                      >
                        <span>🔗 เปิดรายละเอียดเพิ่มเติม</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 pt-0">
                <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between text-[8px] text-slate-400">
                  <div className="flex items-center gap-1">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-black ${authorBg}`}
                    >
                      {authorInitial}
                    </div>
                    <span className="font-bold text-slate-500">โดย {authorRole}</span>
                  </div>
                  <span className="font-bold">
                    {formatThaiDate(ann.publishDate || ann.createdAt.split('T')[0])}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {filteredAnnouncements.length === 0 && (
          <p className="text-center py-16 text-slate-400 font-semibold text-xs">
            ไม่มีประกาศแจ้งเตือนในขณะนี้
          </p>
        )}
      </div>
    </div>
  </div>
  );
};
