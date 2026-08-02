/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import {
  Megaphone,
  Plus,
  Trash2,
  Calendar,
  Users,
  Pin,
  Eye,
  CheckCircle2,
  AlertCircle,
  Building as BuildingIcon,
  Plug,
  Droplet,
  Info,
  Upload,
  Link,
  ChevronRight,
  AlertTriangle,
  Zap,
  Wrench,
  CreditCard,
  Shield,
  Smartphone,
  DoorOpen
} from 'lucide-react';
import {
  Modal,
  formatThaiDate
} from '../../components/GlobalComponents';
import { Announcement, User, Building, Room } from '../../types';
import { convertImageToWebP, UPLOAD_DROPZONE_TEXT } from '../../utils/imageUtils';

interface OwnerAnnouncementsProps {
  announcements: Announcement[];
  onSaveAnnouncements: (announcements: Announcement[]) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  currentUser: User;
  rooms?: Room[];
  buildings?: Building[];
}

// Helper function to compress images using HTML5 Canvas to prevent localStorage quota issues
const compressImage = (dataUrl: string, maxWidth = 800, maxHeight = 800, quality = 0.6): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};

export const OwnerAnnouncements: React.FC<OwnerAnnouncementsProps> = ({
  announcements,
  onSaveAnnouncements,
  onAddLog,
  currentUser,
  rooms = [],
  buildings = []
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  
  // Custom categories / types
  const [annType, setAnnType] = useState<Announcement['type']>('general');
  
  // Target Selection - generalized to any string (all, bld-a, bld-b, custom)
  const [targetSelect, setTargetSelect] = useState<string>('all');
  const [customTargetText, setCustomTargetText] = useState('');

  // Image Upload Selection
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  
  const [errorText, setErrorText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [simulatedView, setSimulatedView] = useState<string>('all');
  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.type && !file.type.startsWith('image/')) {
        setErrorText('กรุณาอัปโหลดเฉพาะไฟล์ประเภทรูปภาพเท่านั้น');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorText('ขนาดไฟล์รูปภาพเกินกำหนด (สูงสุด 10MB)');
        return;
      }
      try {
        const webpUrl = await convertImageToWebP(file);
        setAttachmentUrl(webpUrl);
        setErrorText(null);
      } catch (err) {
        setErrorText('ไม่สามารถแปลงไฟล์รูปภาพได้ กรุณาลองใหม่อีกครั้ง');
      }
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type && !file.type.startsWith('image/')) {
        setErrorText('กรุณาอัปโหลดเฉพาะไฟล์ประเภทรูปภาพเท่านั้น');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorText('ขนาดไฟล์รูปภาพเกินกำหนด (สูงสุด 10MB)');
        return;
      }
      try {
        const webpUrl = await convertImageToWebP(file);
        setAttachmentUrl(webpUrl);
        setErrorText(null);
      } catch (err) {
        setErrorText('ไม่สามารถแปลงไฟล์รูปภาพได้ กรุณาลองใหม่อีกครั้ง');
      }
    }
  };

  const toggleRoomInCustomTarget = (roomNum: string) => {
    const currentTokens = customTargetText
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
    
    if (currentTokens.includes(roomNum)) {
      const updated = currentTokens.filter(t => t !== roomNum);
      setCustomTargetText(updated.join(', '));
    } else {
      const updated = [...currentTokens, roomNum];
      setCustomTargetText(updated.join(', '));
    }
  };

  const handleStartEdit = (ann: Announcement) => {
    setEditingAnnouncement(ann);
    setTitle(ann.title);
    setContent(ann.content);
    setAnnType(ann.type);
    
    if (ann.targetType === 'all') {
      setTargetSelect('all');
      setCustomTargetText('');
    } else if (ann.targetType === 'building' || ann.targetBuildingId) {
      const bldId = ann.targetBuildingId || (buildings.find(b => b.name === ann.customTarget || b.id === ann.customTarget || 
        (b.id === 'bld-a' && ann.customTarget === 'อาคาร A') ||
        (b.id === 'bld-b' && ann.customTarget === 'อาคาร B')
      )?.id);
      if (bldId) {
        setTargetSelect(bldId);
        setCustomTargetText('');
      } else {
        setTargetSelect('custom');
        setCustomTargetText(ann.customTarget || '');
      }
    } else {
      setTargetSelect('custom');
      setCustomTargetText(ann.customTarget || '');
    }
    
    setAttachmentUrl(ann.attachmentUrl || '');
    setLinkUrl(ann.linkUrl || '');
    setIsAddOpen(true);
  };

  const handleCloseModal = () => {
    setIsAddOpen(false);
    setEditingAnnouncement(null);
    setTitle('');
    setContent('');
    setAnnType('general');
    setTargetSelect('all');
    setCustomTargetText('');
    setAttachmentUrl('');
    setLinkUrl('');
    setErrorText(null);
  };

  const handleSaveAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    if (!title.trim() || !content.trim()) {
      setErrorText('กรุณากรอกหัวข้อและรายละเอียดประชาสัมพันธ์');
      return;
    }

    // Determine final target building text
    let finalTarget = 'ทุกอาคาร';
    if (targetSelect === 'all') {
      finalTarget = 'ทุกอาคาร';
    } else if (targetSelect === 'custom') {
      finalTarget = customTargetText.trim() || 'ทุกอาคาร';
    } else {
      const matchedBld = buildings.find(b => b.id === targetSelect);
      finalTarget = matchedBld ? matchedBld.name : 'ทุกอาคาร';
    }

    // Determine final author correctly based on currentUser
    const finalAuthor = currentUser.roleName 
      ? `${currentUser.name} (${currentUser.roleName})` 
      : currentUser.name;

    if (editingAnnouncement) {
      // Edit mode
      const updatedAnn: Announcement = {
        ...editingAnnouncement,
        title: title.trim(),
        summary: content.trim().substring(0, 50) + (content.trim().length > 50 ? '...' : ''),
        content: content.trim(),
        type: annType,
        targetType: targetSelect === 'all' ? 'all' : (targetSelect === 'custom' ? 'rooms' : 'building'),
        targetBuildingId: (targetSelect !== 'all' && targetSelect !== 'custom') ? targetSelect : undefined,
        targetRooms: targetSelect === 'custom' ? customTargetText.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        customTarget: finalTarget,
        attachmentUrl: attachmentUrl.trim() || undefined,
        linkUrl: linkUrl.trim() || undefined,
        author: finalAuthor
      };

      const updated = announcements.map(a => a.id === editingAnnouncement.id ? updatedAnn : a);
      onSaveAnnouncements(updated);
      
      onAddLog(
        'แก้ไขประกาศข่าวสาร',
        `แก้ไขประกาศเรื่อง "${title}"`,
        'Announcement',
        editingAnnouncement.id
      );
    } else {
      // Create mode
      const newId = `ann-${Date.now()}`;
      
      // Automatically pinned: set all others to unpinned
      const unpinnedAnnouncements = announcements.map(a => ({ ...a, isPinned: false }));

      const newAnnouncement: Announcement = {
        id: newId,
        title: title.trim(),
        summary: content.trim().substring(0, 50) + (content.trim().length > 50 ? '...' : ''),
        content: content.trim(),
        type: annType,
        targetType: targetSelect === 'all' ? 'all' : (targetSelect === 'custom' ? 'rooms' : 'building'),
        targetBuildingId: (targetSelect !== 'all' && targetSelect !== 'custom') ? targetSelect : undefined,
        targetRooms: targetSelect === 'custom' ? customTargetText.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        publishDate: new Date().toISOString().split('T')[0],
        isPinned: true, // Automatically pinned every time a new one is added!
        isUrgent: false,
        author: finalAuthor,
        customTarget: finalTarget,
        attachmentUrl: attachmentUrl.trim() || undefined,
        linkUrl: linkUrl.trim() || undefined,
        createdAt: new Date().toISOString()
      };

      const updated = [newAnnouncement, ...unpinnedAnnouncements];
      onSaveAnnouncements(updated);
      
      onAddLog(
        'สร้างประกาศข่าวสารใหม่',
        `ประกาศเรื่อง "${title}" ส่งไปยังเป้าหมาย ${finalTarget} โดย ${finalAuthor}`,
        'Announcement',
        newId
      );

      // Reset page to 1 so they see the new pinned item at the top
      setCurrentPage(1);
    }

    handleCloseModal();
  };

  const handleDeleteAnnouncement = (id: string, heading: string) => {
    const updated = announcements.filter(a => a.id !== id);
    onSaveAnnouncements(updated);
    onAddLog('ลบประกาศประชาสัมพันธ์', `นำประกาศเรื่อง "${heading}" ออกจากบอร์ดผู้เช่า`, 'Announcement', id);
    
    // Adjust current page if needed
    const nextTotalPages = Math.ceil(updated.length / 2);
    if (currentPage > nextTotalPages) {
      setCurrentPage(Math.max(1, nextTotalPages));
    }
  };

  const handleTogglePin = (id: string) => {
    const updated = announcements.map(a => {
      if (a.id === id) {
        const nextPinned = !a.isPinned;
        return { ...a, isPinned: nextPinned };
      }
      return a;
    });

    const target = updated.find(a => a.id === id);
    if (target && target.isPinned) {
      // Pinning this one: unpin all other items
      const finalUpdated = updated.map(a => a.id === id ? a : { ...a, isPinned: false });
      onSaveAnnouncements(finalUpdated);
      setSelectedLiveId(id);
    } else {
      onSaveAnnouncements(updated);
      if (selectedLiveId === id) {
        setSelectedLiveId(null);
      }
    }
  };

  // Helper to get Announcement details matching the screenshot card header badge
  const getBadgeDetails = (ann: Announcement) => {
    let bg = 'bg-indigo-50 text-indigo-700 border-indigo-100';
    let label = 'ทั่วไป';
    let icon = <Megaphone className="w-3.5 h-3.5 text-indigo-500" />;

    if (ann.type === 'electric_off') {
      bg = 'bg-violet-50 text-violet-700 border-violet-100';
      label = 'บำรุงรักษาระบบไฟฟ้า';
      icon = <Zap className="w-3.5 h-3.5 text-violet-500" />;
    } else if (ann.type === 'water_off') {
      bg = 'bg-rose-50 text-rose-700 border-rose-100';
      label = 'บำรุงรักษาระบบประปา';
      icon = <Droplet className="w-3.5 h-3.5 text-rose-500" />;
    } else if (ann.type === 'maintenance') {
      bg = 'bg-emerald-50 text-emerald-700 border-emerald-100';
      label = 'งานซ่อมบำรุง';
      icon = <Wrench className="w-3.5 h-3.5 text-emerald-500" />;
    } else if (ann.type === 'payment') {
      bg = 'bg-amber-50 text-amber-700 border-amber-100';
      label = 'แจ้งชำระเงินค่าเช่ารายเดือน';
      icon = <CreditCard className="w-3.5 h-3.5 text-amber-500" />;
    } else if (ann.type === 'safety') {
      bg = 'bg-slate-50 text-slate-700 border-slate-100';
      label = 'ระเบียบหอพัก';
      icon = <Shield className="w-3.5 h-3.5 text-slate-500" />;
    }

    return { bg, label, icon };
  };

  return (
    <div className="space-y-6">
      
      {/* Main Grid: Left is Announcements, Right is Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left column: Announcements List (2 columns wide) with main card container (มีกรอบหลัก) */}
        <div className="lg:col-span-2 bg-white border border-slate-100 rounded-[28px] p-6 shadow-2xs space-y-5 flex flex-col min-h-[580px]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-indigo-500 shrink-0" />
              <span>ประชาสัมพันธ์ ({announcements.length})</span>
            </h3>
            <button
              onClick={() => {
                setEditingAnnouncement(null);
                setTitle('');
                setContent('');
                setAnnType('general');
                setTargetSelect('all');
                setCustomTargetText('');
                setAttachmentUrl('');
                setLinkUrl('');
                setIsAddOpen(true);
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              <span>เขียนประกาศ</span>
            </button>
          </div>

          {announcements.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {(() => {
                const itemsPerPage = 2;
                const totalPages = Math.ceil(announcements.length / itemsPerPage);
                const activePage = Math.min(currentPage, Math.max(1, totalPages));
                const paginatedAnnouncements = announcements.slice((activePage - 1) * itemsPerPage, activePage * itemsPerPage);

                return paginatedAnnouncements.map((ann) => {
                  const { bg: badgeBg, label: badgeLabel, icon: badgeIcon } = getBadgeDetails(ann);
                  const authorName = ann.author || 'นิติบุคคล';
                  const authorInitial = authorName.includes('(') ? authorName.split(' ')[0].substring(0, 2) : authorName.substring(0, 2);
                  const authorBg = authorName.includes('ช่าง') ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white';

                  return (
                    <div
                      key={ann.id}
                      onClick={() => handleStartEdit(ann)}
                      className="bg-white rounded-[28px] border border-slate-100 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between overflow-hidden relative group cursor-pointer hover:border-indigo-400 animate-in fade-in-50 duration-200 h-[450px]"
                    >
                      {/* Action Menu (Float in top corner) */}
                      <div className="absolute top-3 right-3 z-10 flex gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePin(ann.id);
                          }}
                          className={`p-1.5 bg-white/95 backdrop-blur-xs hover:bg-white text-slate-500 rounded-full shadow-2xs border border-slate-100 transition-all cursor-pointer ${
                            ann.isPinned ? 'text-indigo-600 bg-indigo-50/95 border-indigo-100' : ''
                          }`}
                          title={ann.isPinned ? 'ยกเลิกการปักหมุด' : 'ปักหมุดประกาศนี้'}
                        >
                          <Pin className={`w-3.5 h-3.5 ${ann.isPinned ? 'fill-indigo-600' : ''}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnouncement(ann.id, ann.title);
                          }}
                          className="p-1.5 bg-white/95 backdrop-blur-xs hover:bg-rose-50 text-slate-500 hover:text-rose-600 rounded-full shadow-2xs border border-slate-100 transition-all cursor-pointer"
                          title="ลบประกาศ"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Visual Content (Image or beautiful placeholder vector) */}
                      <div>
                        {ann.attachmentUrl ? (
                          <div className="w-full h-44 bg-slate-50 flex items-center justify-center border-b border-slate-50 relative overflow-hidden">
                            <img
                              src={ann.attachmentUrl}
                              alt={ann.title}
                              className="w-full h-full object-contain"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          // Display elegant vector background placeholders
                          <div className={`w-full h-44 border-b border-slate-50 flex items-center justify-center relative overflow-hidden ${
                            ann.type === 'electric_off' ? 'bg-violet-50/50' : ann.type === 'water_off' || ann.type === 'maintenance' ? 'bg-sky-50/40' : 'bg-slate-50/60'
                          }`}>
                            {ann.type === 'electric_off' && (
                              <Plug className="w-16 h-16 text-violet-100/90 -rotate-12" />
                            )}
                            {(ann.type === 'water_off' || ann.type === 'maintenance') && (
                              <Droplet className="w-16 h-16 text-sky-150/90" />
                            )}
                            {ann.type !== 'electric_off' && ann.type !== 'water_off' && ann.type !== 'maintenance' && (
                              <Megaphone className="w-16 h-16 text-indigo-50/90 rotate-12" />
                            )}
                          </div>
                        )}

                        {/* Content Pad */}
                        <div className="p-5 pb-2 space-y-3">
                          {/* Header badges */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {ann.isPinned && (
                              <span className="inline-flex items-center gap-1 text-[9px] bg-violet-600 text-white font-black px-2.5 py-1 rounded-lg shadow-3xs">
                                <Pin className="w-2.5 h-2.5 fill-white" />
                                ปักหมุด
                              </span>
                            )}
                            <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2.5 py-1 rounded-lg border ${badgeBg}`}>
                              {badgeIcon}
                              <span>{badgeLabel}</span>
                            </span>
                          </div>

                          {/* Target group */}
                          <div className="flex">
                            <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100/80 text-slate-600 font-extrabold px-2.5 py-1 rounded-lg border border-slate-150">
                              <BuildingIcon className="w-3 h-3 text-slate-500" />
                              <span>{ann.customTarget || 'ทุกอาคาร'}</span>
                            </span>
                          </div>

                          {/* Title & Content */}
                          <div className="space-y-1.5">
                            <h4 className="font-extrabold text-slate-900 text-sm tracking-tight leading-snug line-clamp-2">
                              {ann.title}
                            </h4>
                            <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-3">
                              {ann.content}
                            </p>
                          </div>

                          {/* Detail Link if exists */}
                          {ann.linkUrl && (
                            <div className="pt-1">
                              <a
                                href={ann.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-black text-indigo-600 hover:underline bg-indigo-50 px-2 py-1 rounded-lg"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Link className="w-3 h-3 text-indigo-600" />
                                <span>เปิดดูลิงก์รายละเอียดเพิ่มเติม</span>
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="p-5 pt-0">
                        <div className="border-t border-slate-50/80 pt-3.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shadow-3xs ${authorBg}`}>
                              {authorInitial}
                            </div>
                            <span className="text-[11px] font-bold text-slate-600">
                              โดย {ann.author?.includes('(') ? ann.author.split('(')[1].replace(')', '') : (currentUser?.roleName || 'ผู้จัดการหอพัก')}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold text-slate-400">
                            {ann.publishDate ? formatThaiDate(ann.publishDate) : formatThaiDate(ann.createdAt.split('T')[0])}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-gray-400 rounded-3xl">
              <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-700">ไม่มีประกาศประชาสัมพันธ์บนบอร์ดข่าวสารขณะนี้</h4>
              <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">กดเขียนประกาศฉบับใหม่ เพื่อเผยแพร่ข่าวแจ้งผู้เช่าอาศัย</p>
            </div>
          )}

          {/* Pagination Controls */}
          {announcements.length > 2 && (
            <div className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-slate-100 shadow-3xs mt-auto">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                className={`px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  currentPage === 1 
                    ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400' 
                    : 'bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <span>←</span> ย้อนกลับ
              </button>
              
              <span className="text-[10px] font-black text-slate-500">
                หน้า {currentPage} จาก {Math.ceil(announcements.length / 2)}
              </span>

              <button
                disabled={currentPage === Math.ceil(announcements.length / 2)}
                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(announcements.length / 2), prev + 1))}
                className={`px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  currentPage === Math.ceil(announcements.length / 2)
                    ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400' 
                    : 'bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                ถัดไป <span>→</span>
              </button>
            </div>
          )}
        </div>

        {/* Right column: live mock tenant smartphone simulation */}
        <div className="lg:col-span-1">
          <div className="bg-slate-950 p-2.5 rounded-[42px] border-2 border-slate-800 shadow-xl max-w-xs mx-auto sticky top-4">
            <div className="bg-slate-50 rounded-[32px] p-4 min-h-[500px] text-xs font-sans relative flex flex-col justify-between overflow-hidden">
              
              {/* Smartphone status header with Sleek Punch-hole notch */}
              <div className="relative">
                {/* Punch-hole camera notch */}
                <div className="absolute left-1/2 -translate-x-1/2 -top-1 w-14 h-3.5 bg-black rounded-b-xl z-20 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-slate-900 rounded-full border border-slate-800"></div>
                </div>

                <div className="flex justify-between items-center text-[9px] font-black text-slate-400 mb-4 px-1.5 pt-0.5">
                  <span>HorSmart App</span>
                  <span className="opacity-0">Camera Notch</span>
                  <span>10:45 AM</span>
                </div>

                {/* Header title mimicking screenshot exactly */}
                <div className="flex items-center gap-1.5 mb-3 px-1 border-b border-slate-100 pb-2">
                  <Megaphone className="w-4 h-4 text-indigo-600 animate-pulse shrink-0" />
                  <h4 className="font-extrabold text-[12px] text-slate-900">ประชาสัมพันธ์ ({announcements.length})</h4>
                </div>

                {/* Simulated notification card */}
                {(() => {
                  const liveAnn = announcements.find(a => a.id === selectedLiveId) || announcements.find(a => a.isPinned) || announcements[0];
                  
                  if (!liveAnn) {
                    return (
                      <div className="text-center py-12 text-[10px] text-gray-400 font-semibold">
                        ไม่มีประกาศแจ้งเตือน
                      </div>
                    );
                  }

                  // Check if liveAnn is visible for simulatedView
                  let isVisible = true;
                  let viewFriendlyName = 'ทั้งหมด (ดูทั้งหมด)';
                  
                  if (simulatedView !== 'all') {
                    if (simulatedView.startsWith('bld-')) {
                      const bldId = simulatedView.replace('bld-', '');
                      const bldObj = buildings.find(b => b.id === bldId);
                      viewFriendlyName = `ผู้เช่า ตึก ${bldObj ? (bldObj.name?.replace('อาคาร ', '') || bldObj.id) : bldId}`;
                      
                      if (liveAnn.targetType === 'building') {
                        isVisible = liveAnn.targetBuildingId === bldId || (liveAnn.customTarget && (
                          liveAnn.customTarget.includes(bldId) || 
                          (bldId === 'bld-a' && liveAnn.customTarget.includes('อาคาร A')) || 
                          (bldId === 'bld-b' && liveAnn.customTarget.includes('อาคาร B'))
                        ));
                      } else if (liveAnn.targetType === 'rooms') {
                        // Check if any room in this building is in liveAnn.targetRooms or customTarget
                        const bldRooms = rooms.filter(r => r.buildingId === bldId).map(r => (r?.roomNumber || '').trim().toUpperCase());
                        if (liveAnn.targetRooms) {
                          isVisible = liveAnn.targetRooms.some(rNum => bldRooms.includes((rNum || '').trim().toUpperCase()));
                        } else if (liveAnn.customTarget) {
                          const cleanCustom = (liveAnn.customTarget || '').toUpperCase();
                          const tokens = cleanCustom.split(/[,\s]+/).map(t => (t || '').trim().replace(/^ห้อง\s*/, ''));
                          isVisible = tokens.some(rNum => bldRooms.includes(rNum)) || bldRooms.some(rNum => cleanCustom.includes(rNum));
                        } else {
                          isVisible = false;
                        }
                      }
                    } else if (simulatedView.startsWith('room-')) {
                      const rNum = simulatedView.replace('room-', '');
                      viewFriendlyName = `ผู้เช่า ห้อง ${rNum}`;
                      const roomObj = rooms.find(r => r.roomNumber === rNum);
                      
                      if (liveAnn.targetType === 'building') {
                        isVisible = liveAnn.targetBuildingId === roomObj?.buildingId || (liveAnn.customTarget && roomObj?.buildingId && (
                          liveAnn.customTarget.includes(roomObj.buildingId) ||
                          (roomObj.buildingId === 'bld-a' && liveAnn.customTarget.includes('อาคาร A')) ||
                          (roomObj.buildingId === 'bld-b' && liveAnn.customTarget.includes('อาคาร B'))
                        ));
                      } else if (liveAnn.targetType === 'rooms') {
                        const cleanRoom = (rNum || '').trim().toUpperCase();
                        if (liveAnn.targetRooms && liveAnn.targetRooms.some(r => (r || '').trim().toUpperCase() === cleanRoom)) {
                          isVisible = true;
                        } else if (liveAnn.customTarget) {
                          const cleanCustom = (liveAnn.customTarget || '').toUpperCase();
                          const tokens = cleanCustom.split(/[,\s]+/).map(t => t.trim().replace(/^ห้อง\s*/, ''));
                          isVisible = tokens.includes(cleanRoom) || tokens.some(t => t === cleanRoom) || cleanCustom.includes(cleanRoom);
                        } else {
                          isVisible = false;
                        }
                      }
                    }
                  }

                  const { bg: badgeBg, label: badgeLabel, icon: badgeIcon } = getBadgeDetails(liveAnn);
                  const authorName = liveAnn.author || 'นิติบุคคล';
                  const authorInitial = authorName.includes('(') ? authorName.split(' ')[0].substring(0, 2) : authorName.substring(0, 2);

                  return (
                    <div className="space-y-4 animate-in fade-in duration-300">
                      {/* Simulated View Dropdown */}
                      <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60 shadow-3xs">
                        <label className="text-[8px] font-black text-slate-500 block mb-1">จำลองมุมมองผู้เช่าตามเป้าหมาย:</label>
                        <select
                          value={simulatedView}
                          onChange={(e) => setSimulatedView(e.target.value)}
                          className="w-full text-[9px] bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 font-extrabold px-1.5 py-1 rounded-md focus:outline-none cursor-pointer"
                        >
                          <option value="all">👁️ ทั้งหมด (ดูทุกประกาศ)</option>
                          {(buildings || []).map(bld => (
                            <option key={bld.id} value={`bld-${bld.id}`}>🏢 ผู้เช่า ตึก {bld.name?.replace('อาคาร ', '') || bld.id}</option>
                          ))}
                          {(rooms || []).slice(0, 10).map(room => (
                            <option key={room.id} value={`room-${room.roomNumber}`}>🔑 ผู้เช่า ห้อง {room.roomNumber}</option>
                          ))}
                        </select>
                      </div>

                      {/* Announcement visible state or hidden alert card */}
                      {!isVisible ? (
                        <div className="bg-amber-50/80 border border-amber-200 rounded-[24px] p-4 text-center space-y-2 shadow-2xs animate-in fade-in-50 duration-200">
                          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto animate-bounce" />
                          <div className="space-y-1">
                            <h5 className="font-extrabold text-[10px] text-amber-900 leading-tight">ผู้เช่ากลุ่มนี้จะไม่เห็นประกาศนี้</h5>
                            <p className="text-[8px] text-amber-700 leading-normal">
                              เนื่องจากประกาศเรื่องนี้จำกัดเป้าหมายเฉพาะ <strong>"{liveAnn.customTarget}"</strong> แต่คุณกำลังจำลองมุมมองของ <strong>"{viewFriendlyName}"</strong>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSimulatedView('all')}
                            className="mt-1 text-[8px] font-black text-indigo-600 bg-white border border-indigo-150 px-2 py-1 rounded-md hover:bg-indigo-50"
                          >
                            รีเซ็ตเป็นมุมมองทั้งหมด
                          </button>
                        </div>
                      ) : (
                        <div className="bg-white border border-slate-150 rounded-[24px] overflow-hidden shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between animate-in fade-in-50 duration-200">
                          <div>
                            {liveAnn.attachmentUrl && (
                              <div className="w-full h-32 bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-100">
                                <img 
                                  src={liveAnn.attachmentUrl} 
                                  alt={liveAnn.title} 
                                  className="w-full h-full object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            )}
                            <div className="p-3.5 space-y-2.5">
                              {/* Header Badges row */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {liveAnn.isPinned && (
                                  <span className="inline-flex items-center gap-1 text-[8px] bg-violet-600 text-white font-black px-2 py-0.5 rounded-md">
                                    <Pin className="w-2 h-2 fill-white text-white rotate-45" />
                                    ปักหมุด
                                  </span>
                                )}
                                <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-2 py-0.5 rounded-md border ${badgeBg}`}>
                                  {React.cloneElement(badgeIcon as React.ReactElement, { className: 'w-2 h-2 text-current' })}
                                  <span>{badgeLabel}</span>
                                </span>
                              </div>

                              {/* Target custom list pill styled exactly like screenshot */}
                              <div className="flex">
                                <div className="inline-flex items-center gap-1.5 text-[9px] bg-slate-50 border border-slate-200 text-slate-700 font-extrabold px-3 py-1 rounded-xl">
                                  <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span>
                                    {liveAnn.targetType === 'all' && 'ทุกอาคาร'}
                                    {liveAnn.targetType === 'building' && `ตึก ${buildings.find(b => b.id === liveAnn.targetBuildingId)?.name?.replace('อาคาร ', '') || liveAnn.customTarget || 'ทุกอาคาร'}`}
                                    {liveAnn.targetType === 'rooms' && (liveAnn.targetRooms ? liveAnn.targetRooms.join(', ') : liveAnn.customTarget)}
                                  </span>
                                </div>
                              </div>

                              {/* Title and Content */}
                              <div className="space-y-1">
                                <h5 className="font-extrabold text-slate-900 text-[11px] tracking-tight leading-snug">{liveAnn.title}</h5>
                                <p className="text-[9px] text-slate-500 leading-relaxed whitespace-pre-line line-clamp-4">{liveAnn.content}</p>
                              </div>

                              {/* Detail link */}
                              {liveAnn.linkUrl && (
                                <div className="pt-0.5">
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded-md">
                                    <span>🔗 เปิดรายละเอียดเพิ่มเติม</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Footer block styled with the user initial circle avatar */}
                          <div className="p-3.5 pt-0">
                            <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between text-[8px] text-slate-400">
                              <div className="flex items-center gap-1.5">
                                <div className="w-5 h-5 bg-violet-600 text-white rounded-full flex items-center justify-center font-black text-[7px] shrink-0 uppercase">
                                  {authorInitial}
                                </div>
                                <span className="font-extrabold text-slate-700">
                                  โดย {liveAnn.author?.includes('(') ? liveAnn.author.split('(')[1].replace(')', '') : (currentUser?.roleName || 'ผู้จัดการหอพัก')}
                                </span>
                              </div>
                              <span className="font-bold text-slate-400">{liveAnn.publishDate ? formatThaiDate(liveAnn.publishDate) : ''}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Home Indicator */}
              <div className="w-24 h-1 bg-slate-300 rounded-full mx-auto mt-4 shrink-0" />

            </div>
          </div>
        </div>

      </div>

      {/* Create / Edit Modal Form */}
      <Modal isOpen={isAddOpen} onClose={handleCloseModal} title={editingAnnouncement ? "แก้ไขประกาศประชาสัมพันธ์" : "จัดทำบันทึกประกาศสาธารณะโครงการ"}>
        <form onSubmit={handleSaveAnnouncement} className="space-y-4 text-xs">
          
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">หัวข้อเรื่องประชาสัมพันธ์ *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="เช่น แจ้งงดบริการลิฟต์โดยสาร ตึก A เพื่อตรวจสอบความปลอดภัยประจำปี"
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="block font-bold text-slate-700">หมวดหมู่ประกาศ</label>
              <div className="relative">
                <select
                  value={annType}
                  onChange={(e) => setAnnType(e.target.value as any)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-700 font-semibold text-xs outline-none focus:border-indigo-500"
                >
                  <option value="general" className="py-1 font-normal text-xs text-slate-700 bg-white">ทั่วไป</option>
                  <option value="electric_off" className="py-1 font-normal text-xs text-slate-700 bg-white">บำรุงรักษาระบบไฟฟ้า</option>
                  <option value="water_off" className="py-1 font-normal text-xs text-slate-700 bg-white">บำรุงรักษาระบบประปา</option>
                  <option value="maintenance" className="py-1 font-normal text-xs text-slate-700 bg-white">งานซ่อมบำรุง</option>
                  <option value="payment" className="py-1 font-normal text-xs text-slate-700 bg-white">แจ้งชำระเงินค่าเช่ารายเดือน</option>
                  <option value="safety" className="py-1 font-normal text-xs text-slate-700 bg-white">ระเบียบหอพัก</option>
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  {annType === 'general' && <Megaphone className="w-4 h-4 text-indigo-500" />}
                  {annType === 'electric_off' && <Zap className="w-4 h-4 text-violet-500" />}
                  {annType === 'water_off' && <Droplet className="w-4 h-4 text-rose-500" />}
                  {annType === 'maintenance' && <Wrench className="w-4 h-4 text-emerald-500" />}
                  {annType === 'payment' && <CreditCard className="w-4 h-4 text-amber-500" />}
                  {annType === 'safety' && <Shield className="w-4 h-4 text-slate-500" />}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-700">กลุ่มเป้าหมายผู้พักอาศัย</label>
              <div className="relative">
                <select
                  value={targetSelect}
                  onChange={(e) => setTargetSelect(e.target.value as any)}
                  className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-700 font-semibold text-xs outline-none focus:border-indigo-500"
                >
                  <option value="all" className="py-1 font-normal text-xs text-slate-700 bg-white">ทุกตึกอาคาร (ทุกผู้พักอาศัย)</option>
                  {(buildings || []).map((bld) => (
                    <option key={bld.id} value={bld.id} className="py-1 font-normal text-xs text-slate-700 bg-white">
                      {bld.name}
                    </option>
                  ))}
                  <option value="custom" className="py-1 font-normal text-xs text-slate-700 bg-white">กำหนดเลขห้อง / ระบุเอง...</option>
                </select>
                <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <BuildingIcon className="w-4 h-4 text-slate-500" />
                </div>
              </div>
            </div>
          </div>

          {targetSelect === 'custom' && (
            <div className="space-y-3 p-3.5 bg-slate-50 border border-slate-100 rounded-2xl animate-in fade-in-50 duration-200">
              <div className="space-y-1">
                <label className="block font-bold text-slate-700">ระบุกลุ่มเป้าหมายหรือระบุเลขห้อง</label>
                <input
                  type="text"
                  required
                  value={customTargetText}
                  onChange={(e) => setCustomTargetText(e.target.value)}
                  placeholder="เช่น ห้อง A101, B202 หรือ ชั้น 3 ทั้งหมด"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-3xs"
                />
              </div>

              {rooms && rooms.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold text-slate-500">จิ้มเลือกเลขห้องจริงๆ เพื่อระบุ (รองรับมือถือ/เลื่อนดูได้):</span>
                    <button
                      type="button"
                      onClick={() => setCustomTargetText('')}
                      className="text-[10px] font-black text-rose-600 hover:underline cursor-pointer"
                    >
                      ล้างทั้งหมด
                    </button>
                  </div>

                  <div className="max-h-[160px] overflow-y-auto space-y-3 pr-1 text-left scrollbar-thin">
                    {Array.from(new Set(rooms.map(r => r.buildingId).filter(Boolean))).map(bldId => {
                      const bldName = (buildings || []).find(b => b.id === bldId)?.name || `อาคาร ${bldId?.replace('bld-', '').toUpperCase()}`;
                      const bldRooms = rooms.filter(r => r.buildingId === bldId);
                      const floors = Array.from(new Set(bldRooms.map(r => r.derivedFloor))).sort((a, b) => (b === null ? -1 : a === null ? 1 : a - b));

                      return (
                        <div key={bldId} className="space-y-1.5 border-b border-slate-200 pb-2.5 last:border-0 last:pb-0">
                          <span className="text-[10px] font-black text-indigo-600 block">{bldName}</span>

                          {floors.map(fl => {
                            const floorRooms = bldRooms.filter(r => r.derivedFloor === fl).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber));
                            return (
                              <div key={fl} className="flex items-start gap-2">
                                <span className="text-[9px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                                  {fl ? `ชั้น ${fl}` : <span className="text-red-500">Error</span>}
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {floorRooms.map(room => {
                                    const isSelected = customTargetText.split(',').map(t => t.trim()).includes(room.roomNumber);
                                    return (
                                      <button
                                        key={room.id}
                                        type="button"
                                        onClick={() => toggleRoomInCustomTarget(room.roomNumber)}
                                        className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                                          isSelected 
                                            ? 'bg-indigo-600 text-white shadow-2xs scale-95 font-extrabold' 
                                            : 'bg-white text-slate-700 border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/20'
                                        }`}
                                      >
                                        {room.roomNumber}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* รายละเอียดประชาสัมพันธ์ * is now placed immediately below สัญลักษณ์ / หมวดหมู่ประกาศ & กลุ่มเป้าหมายผู้พักอาศัย as requested */}
          <div className="space-y-1">
            <label className="block font-bold text-slate-700">รายละเอียดประชาสัมพันธ์ *</label>
            <textarea
              required
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="ระบุกำหนดวัน เวลาเปิด/ปิดซ่อม หรือแนวปฏิบัติเพิ่มเติมเพื่อให้ผู้เช่าเตรียมรับมือ..."
              className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 h-28 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          {/* Direct Beautiful Drag-and-Drop Image Uploader */}
          {attachmentUrl ? (
            <div className="relative border border-slate-150 rounded-2xl overflow-hidden h-44 bg-slate-50 animate-in zoom-in-95 mt-2 flex items-center justify-center">
              <img
                src={attachmentUrl}
                alt="Preview"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
              <button
                type="button"
                onClick={() => setAttachmentUrl('')}
                className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md active:scale-95"
              >
                ล้างรูปภาพ
              </button>
            </div>
          ) : (
            <>
              <div 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-7 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 shadow-2xs ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]' 
                    : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50/80'
                }`}
              >
                <Upload className={`w-8 h-8 transition-transform ${isDragging ? 'text-indigo-600 animate-bounce' : 'text-slate-400'}`} />
                <span className="font-extrabold text-[11px] text-slate-700">
                  {isDragging ? 'วางไฟล์รูปภาพของคุณตรงนี้เลย!' : 'ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด'}
                </span>
                <span className="text-[9px] text-slate-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</span>
              </div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                onClick={(e) => e.stopPropagation()}
                accept="image/*"
                className="hidden"
              />
            </>
          )}

          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-1">
              <label className="block font-bold text-slate-700">แนบลิงก์รายละเอียดเพิ่มเติม (ถ้ามี)</label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https:// ..."
                className="w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-slate-800 font-semibold outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          {errorText && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span className="font-semibold">{errorText}</span>
            </div>
          )}

          <div className="sticky bottom-0 -mx-6 -mb-6 p-4 mt-6 bg-white border-t border-gray-100 flex gap-2 justify-end z-30 shadow-[0_-6px_16px_rgba(0,0,0,0.06)]">
            <button
              type="button"
              onClick={handleCloseModal}
              className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-xs cursor-pointer"
            >
              ประชาสัมพันธ์
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
};
