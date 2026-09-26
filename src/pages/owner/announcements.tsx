/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
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
  AlertTriangle,
  Zap,
  Wrench,
  CreditCard,
  Shield,
  Smartphone,
  DoorOpen,
  Sparkles,
  Package,
  ChevronLeft,
  X,
  ArrowLeft,
  ArrowRight,
  Loader2
} from 'lucide-react';
import {
  Modal,
  formatThaiDate
} from '../../components/GlobalComponents';
import { Announcement, User, Building, Room } from '../../types';
import { convertImageToWebP, UPLOAD_DROPZONE_TEXT } from '../../utils/imageUtils';
import { sortRoomsByBuildingAndNumber } from '../../utils/roomSorter';
import {
  ANNOUNCEMENT_TEMPLATES,
  AnnouncementTemplate
} from '../../data/contracts/announcementTemplates';
import { getDataProvider } from '../../data/dataProvider';

interface OwnerAnnouncementsProps {
  announcements: Announcement[];
  onSaveAnnouncements: (announcements: Announcement[], options?: { skipInvalidate?: boolean }) => void;
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  currentUser: User;
  rooms?: Room[];
  buildings?: Building[];
  onDetailViewChange?: (isOpen: boolean) => void;
  dormitoryId?: string;
}

const ANNOUNCEMENTS_PER_PAGE = 2;

const getTargetRoomsArray = (targetRooms: any): string[] => {
  if (Array.isArray(targetRooms)) return targetRooms;
  if (typeof targetRooms === 'string') return targetRooms.split(',').map((r: string) => r.trim()).filter(Boolean);
  return [];
};

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

const formatUserRealTime = (): string => {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m} น.`;
};

export const OwnerAnnouncements: React.FC<OwnerAnnouncementsProps> = ({
  announcements,
  onSaveAnnouncements,
  onAddLog,
  currentUser,
  rooms = [],
  buildings = [],
  onDetailViewChange,
  dormitoryId
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [currentClockTime, setCurrentClockTime] = useState<string>(formatUserRealTime);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentClockTime(formatUserRealTime());
    }, 10000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    onDetailViewChange?.(isAddOpen);
    return () => {
      onDetailViewChange?.(false);
    };
  }, [isAddOpen, onDetailViewChange]);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [sendLinePush, setSendLinePush] = useState(true);

  // Custom categories / types
  const [annType, setAnnType] = useState<Announcement['type']>('general');

  // Target Selection - generalized to any string (all, bld-a, bld-b, custom)
  const [targetSelect, setTargetSelect] = useState<string>('all');
  const [customTargetText, setCustomTargetText] = useState('');

  const targetEstimatedCount = useMemo(() => {
    if (targetSelect === 'all') {
      const occupied = (rooms || []).filter(r => r.status === 'occupied').length;
      return occupied > 0 ? occupied : (rooms || []).length || 1;
    }
    if (targetSelect === 'custom') {
      const count = customTargetText.split(',').map(t => t.trim()).filter(Boolean).length;
      return count > 0 ? count : 1;
    }
    const bldOccupied = (rooms || []).filter(r => r.buildingId === targetSelect && r.status === 'occupied').length;
    return bldOccupied > 0 ? bldOccupied : 1;
  }, [targetSelect, customTargetText, rooms]);

  // Image Upload Selection
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');

  const [errorText, setErrorText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [simulatedTarget, setSimulatedTarget] = useState<string>('all');
  const [simulatedRoom, setSimulatedRoom] = useState<string>('');

  const simulatedView = useMemo(() => {
    if (simulatedTarget === 'all') return 'all';
    if (simulatedTarget === 'custom') {
      const rNum = simulatedRoom || (rooms && rooms[0]?.roomNumber) || '';
      return rNum ? `room-${rNum}` : 'all';
    }
    return `bld-${simulatedTarget}`;
  }, [simulatedTarget, simulatedRoom, rooms]);

  const [selectedLiveId, setSelectedLiveId] = useState<string | null>(null);
  const [togglingPinId, setTogglingPinId] = useState<string | null>(null);

  // Sorting: Pinned first, then newest date
  const sortedAnnouncements = useMemo(() => {
    return [...announcements].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const dateA = a.publishDate || a.createdAt || '';
      const dateB = b.publishDate || b.createdAt || '';
      return dateB.localeCompare(dateA);
    });
  }, [announcements]);

  // Pagination: 2 items per page
  const totalPages = Math.max(1, Math.ceil(sortedAnnouncements.length / ANNOUNCEMENTS_PER_PAGE));
  const activePage = Math.min(currentPage, totalPages);
  const paginatedAnnouncements = useMemo(() => {
    return sortedAnnouncements.slice((activePage - 1) * ANNOUNCEMENTS_PER_PAGE, activePage * ANNOUNCEMENTS_PER_PAGE);
  }, [sortedAnnouncements, activePage]);

  // Toast Notification State with Smooth Fade
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<'success' | 'delete' | 'pin' | 'info'>('success');
  const [isToastFading, setIsToastFading] = useState(false);

  const showToast = (message: string, type: 'success' | 'delete' | 'pin' | 'info' = 'success') => {
    setToastMessage(message);
    setToastType(type);
    setIsToastFading(false);
  };

  useEffect(() => {
    if (toastMessage) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2800);
      const removeTimer = setTimeout(() => {
        setToastMessage(null);
        setIsToastFading(false);
      }, 3400);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toastMessage]);

  // Template System State (Ultra-smooth responsive drag + 100% reliable click)
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const templateScrollRef = useRef<HTMLDivElement>(null);
  const isMouseDownRef = useRef(false);
  const startMouseXRef = useRef(0);
  const scrollLeftStartRef = useRef(0);
  const lastMouseXRef = useRef(0);
  const velocityRef = useRef(0);
  const lastTimestampRef = useRef(0);
  const totalMovedDistanceRef = useRef(0);
  const animationFrameIdRef = useRef<number | null>(null);

  const stopMomentum = () => {
    if (animationFrameIdRef.current !== null) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }
  };

  const handleTemplateMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (!templateScrollRef.current) return;

    stopMomentum();
    isMouseDownRef.current = true;
    startMouseXRef.current = e.pageX;
    lastMouseXRef.current = e.pageX;
    scrollLeftStartRef.current = templateScrollRef.current.scrollLeft;
    totalMovedDistanceRef.current = 0;
    lastTimestampRef.current = performance.now();
    velocityRef.current = 0;
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isMouseDownRef.current || !templateScrollRef.current) return;

      const currentX = e.pageX;
      const diff = currentX - startMouseXRef.current;
      totalMovedDistanceRef.current = Math.max(totalMovedDistanceRef.current, Math.abs(diff));

      if (totalMovedDistanceRef.current > 5) {
        templateScrollRef.current.scrollLeft = scrollLeftStartRef.current - diff;
        const now = performance.now();
        const dt = Math.max(1, now - lastTimestampRef.current);
        velocityRef.current = (currentX - lastMouseXRef.current) / dt;
        lastMouseXRef.current = currentX;
        lastTimestampRef.current = now;
      }
    };

    const handleGlobalMouseUp = () => {
      if (!isMouseDownRef.current) return;
      isMouseDownRef.current = false;

      // Small delay before clearing moved distance to let onClick handlers process cleanly
      setTimeout(() => {
        totalMovedDistanceRef.current = 0;
      }, 100);

      // Smooth momentum gliding if user dragged with velocity
      let v = velocityRef.current * 16;
      v = Math.max(-30, Math.min(30, v));

      if (Math.abs(v) > 1 && totalMovedDistanceRef.current > 8 && templateScrollRef.current) {
        const glide = () => {
          if (!templateScrollRef.current || isMouseDownRef.current) return;
          templateScrollRef.current.scrollLeft -= v;
          v *= 0.92;
          if (Math.abs(v) > 0.4) {
            animationFrameIdRef.current = requestAnimationFrame(glide);
          } else {
            animationFrameIdRef.current = null;
          }
        };
        animationFrameIdRef.current = requestAnimationFrame(glide);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      stopMomentum();
    };
  }, []);

  const handleTemplateWheel = (e: React.WheelEvent) => {
    if (!templateScrollRef.current) return;
    stopMomentum();
    // Allow vertical wheel to scroll horizontally smoothly
    if (e.deltaY !== 0 && Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      templateScrollRef.current.scrollLeft += e.deltaY * 0.8;
    }
  };

  const handleApplyTemplate = (tpl: AnnouncementTemplate) => {
    setTitle(tpl.defaultTitle);
    setContent(tpl.defaultContent);
    setAnnType(tpl.category);
    setActiveTemplateId(tpl.id);
    if (tpl.suggestedTarget && tpl.suggestedTarget === 'all') {
      setTargetSelect('all');
      setCustomTargetText('');
    }
  };

  const getTemplateIcon = (iconType: string, isSelected?: boolean) => {
    const iconClass = `w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : ''}`;
    switch (iconType) {
      case 'electric':
        return <Zap className={`${iconClass} ${!isSelected ? 'text-violet-600' : ''}`} />;
      case 'water':
        return <Droplet className={`${iconClass} ${!isSelected ? 'text-rose-500' : ''}`} />;
      case 'maintenance':
        return <Wrench className={`${iconClass} ${!isSelected ? 'text-emerald-600' : ''}`} />;
      case 'payment':
        return <CreditCard className={`${iconClass} ${!isSelected ? 'text-amber-600' : ''}`} />;
      case 'safety':
        return <Shield className={`${iconClass} ${!isSelected ? 'text-slate-700' : ''}`} />;
      case 'parcel':
        return <Package className={`${iconClass} ${!isSelected ? 'text-indigo-600' : ''}`} />;
      case 'calendar':
        return <Calendar className={`${iconClass} ${!isSelected ? 'text-sky-600' : ''}`} />;
      default:
        return <Megaphone className={`${iconClass} ${!isSelected ? 'text-indigo-600' : ''}`} />;
    }
  };

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
    onDetailViewChange?.(true);
    setEditingAnnouncement(ann);
    setTitle(ann.title);
    setContent(ann.content);
    setAnnType(ann.type);
    setActiveTemplateId(null);

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
    setSendLinePush(false);
    setIsAddOpen(true);
  };

  const handleOpenNewAnnouncement = () => {
    onDetailViewChange?.(true);
    setEditingAnnouncement(null);
    setTitle('');
    setContent('');
    setAnnType('general');
    setTargetSelect('all');
    setCustomTargetText('');
    setAttachmentUrl('');
    setLinkUrl('');
    setActiveTemplateId(null);
    setErrorText(null);
    setSendLinePush(true);
    setIsAddOpen(true);
  };

  const handleCloseModal = () => {
    onDetailViewChange?.(false);
    setIsAddOpen(false);
    setEditingAnnouncement(null);
    setTitle('');
    setContent('');
    setAnnType('general');
    setTargetSelect('all');
    setCustomTargetText('');
    setAttachmentUrl('');
    setLinkUrl('');
    setActiveTemplateId(null);
    setErrorText(null);
    setSendLinePush(true);
  };

  const handleSaveAnnouncement = async (e: React.FormEvent) => {
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

      try {
        const dataProvider = getDataProvider();
        await dataProvider.announcements.updateAnnouncement?.(editingAnnouncement.id, updatedAnn, dormitoryId);
      } catch (err) {
        console.error('Failed to update announcement on server:', err);
      }

      const updated = announcements.map(a => a.id === editingAnnouncement.id ? updatedAnn : a);
      onSaveAnnouncements(updated);

      onAddLog(
        'แก้ไขประกาศข่าวสาร',
        `แก้ไขประกาศเรื่อง "${title}"`,
        'Announcement',
        editingAnnouncement.id
      );

      showToast('บันทึกการแก้ไขประกาศแล้ว', 'success');
    } else {
      // Create mode
      // Automatically pinned: set all others to unpinned
      const unpinnedAnnouncements = announcements.map(a => ({ ...a, isPinned: false }));

      let createdAnn: Announcement | null = null;
      try {
        const dataProvider = getDataProvider();
        const res = await dataProvider.announcements.createAnnouncement({
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
          sendLinePush,
        }, undefined, dormitoryId);
        if (res.success && res.data) {
          createdAnn = res.data;
        } else {
          const errMsg = (res?.error as any)?.message || 'เกิดข้อผิดพลาดในการเผยแพร่ประกาศ กรุณาลองใหม่อีกครั้ง';
          showToast(errMsg, 'error');
          return;
        }
      } catch (err: any) {
        console.error('Failed to create announcement on server:', err);
        showToast(err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'error');
        return;
      }

      const newId = createdAnn?.id || `ann-${Date.now()}`;
      const newAnnouncement: Announcement = createdAnn || {
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

      if ((createdAnn as any)?.warning) {
        showToast(`เผยแพร่ประกาศเรียบร้อยแล้ว (${(createdAnn as any).warning})`, 'info');
      } else {
        showToast('เผยแพร่ประกาศเรียบร้อยแล้ว', 'success');
      }

      // Reset page to 1 so they see the new pinned item at the top
      setCurrentPage(1);
    }

    handleCloseModal();
  };

  const handleDeleteAnnouncement = async (id: string, heading: string) => {
    try {
      const dataProvider = getDataProvider();
      await dataProvider.announcements.deleteAnnouncement?.(id, dormitoryId);
    } catch (err) {
      console.error('Failed to delete announcement on server:', err);
    }

    const updated = announcements.filter(a => a.id !== id);
    onSaveAnnouncements(updated);
    onAddLog('ลบประกาศประชาสัมพันธ์', `นำประกาศเรื่อง "${heading}" ออกจากบอร์ดผู้เช่า`, 'Announcement', id);
    showToast('ลบประกาศเรียบร้อยแล้ว', 'delete');

    // Adjust current page if needed
    const nextTotalPages = Math.max(1, Math.ceil(updated.length / ANNOUNCEMENTS_PER_PAGE));
    if (currentPage > nextTotalPages) {
      setCurrentPage(Math.max(1, nextTotalPages));
    }
  };

  const handleTogglePin = async (id: string) => {
    if (togglingPinId) return; // Prevent concurrent clicks / race conditions
    const targetAnn = announcements.find(a => a.id === id);
    if (!targetAnn) return;
    const nextPinned = !targetAnn.isPinned;

    setTogglingPinId(id);

    // Optimistically update local announcements state (atomic single-pin)
    const updated = announcements.map(a => {
      if (a.id === id) {
        return { ...a, isPinned: nextPinned };
      }
      return nextPinned ? { ...a, isPinned: false } : a;
    });

    // 1. Optimistic cache update without triggering immediate refetch query invalidation
    onSaveAnnouncements(updated, { skipInvalidate: true });

    if (nextPinned) {
      setSelectedLiveId(id);
      setCurrentPage(1); // Jump to page 1 so user immediately sees the pinned card at the top
      showToast('ปักหมุดประกาศขึ้นหน้าแรกแล้ว', 'pin');
    } else {
      if (selectedLiveId === id) {
        setSelectedLiveId(null);
      }
      showToast('ยกเลิกการปักหมุดประกาศแล้ว', 'info');
    }

    try {
      const dataProvider = getDataProvider();
      const res = await dataProvider.announcements.updateAnnouncement?.(id, { isPinned: nextPinned });
      if (res && res.success === false) {
        console.error('Failed to toggle pin on server:', res.error);
        onSaveAnnouncements(announcements);
        showToast('ไม่สามารถเปลี่ยนสถานะปักหมุดได้ กรุณาลองใหม่อีกครั้ง', 'delete');
      } else {
        // 2. Safe authoritative query invalidation only AFTER server DB has committed
        onSaveAnnouncements(updated);
      }
    } catch (err) {
      console.error('Failed to toggle pin on server:', err);
      onSaveAnnouncements(announcements);
      showToast('ไม่สามารถเปลี่ยนสถานะปักหมุดได้ กรุณาลองใหม่อีกครั้ง', 'delete');
    } finally {
      setTogglingPinId(null);
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

  // Helper to extract author display role name
  const getAuthorRoleName = (rawAuthor?: string) => {
    if (!rawAuthor) return 'เจ้าของหอพัก';
    if (rawAuthor.includes('เจ้าของ') || rawAuthor === 'เจ้าของหอพัก') {
      return 'เจ้าของหอพัก';
    }
    if (rawAuthor.includes('ช่าง') || rawAuthor === 'ทีมช่าง') {
      return 'ทีมช่างประจำหอพัก';
    }
    if (rawAuthor.includes('(')) {
      return rawAuthor.split('(')[1].replace(')', '');
    }
    return rawAuthor;
  };

  // Helper to check if an announcement is visible to the simulated tenant view
  const isAnnVisibleToSimulatedView = (ann: Announcement, view: string): boolean => {
    if (!view || view === 'all') return true;
    if (!ann.targetType || ann.targetType === 'all') return true;

    if (view.startsWith('bld-')) {
      const bldId = view.replace('bld-', '');
      if (ann.targetType === 'building') {
        if (ann.targetBuildingId) return ann.targetBuildingId === bldId;
        if (ann.customTarget) {
          return ann.customTarget.includes(bldId) ||
            (bldId === 'bld-a' && ann.customTarget.includes('อาคาร A')) ||
            (bldId === 'bld-b' && ann.customTarget.includes('อาคาร B'));
        }
        return false;
      }
      if (ann.targetType === 'rooms') {
        const bldRooms = rooms.filter(r => r.buildingId === bldId).map(r => (r?.roomNumber || '').trim().toUpperCase());
        const roomsArr = getTargetRoomsArray(ann.targetRooms);
        if (roomsArr.length > 0) {
          return roomsArr.some(rNum => bldRooms.includes((rNum || '').trim().toUpperCase()));
        }
        if (ann.customTarget) {
          const cleanCustom = (ann.customTarget || '').toUpperCase();
          const tokens = cleanCustom.split(/[,\s]+/).map(t => (t || '').trim().replace(/^ห้อง\s*/, ''));
          return tokens.some(rNum => bldRooms.includes(rNum)) || bldRooms.some(rNum => cleanCustom.includes(rNum));
        }
        return false;
      }
      return false;
    }

    if (view.startsWith('room-')) {
      const rNum = view.replace('room-', '');
      const cleanRoom = (rNum || '').trim().toUpperCase();
      const roomObj = rooms.find(r => (r.roomNumber || '').trim().toUpperCase() === cleanRoom);

      if (ann.targetType === 'building') {
        if (!roomObj) return false;
        if (ann.targetBuildingId) return ann.targetBuildingId === roomObj.buildingId;
        if (ann.customTarget) {
          return ann.customTarget.includes(roomObj.buildingId) ||
            (roomObj.buildingId === 'bld-a' && ann.customTarget.includes('อาคาร A')) ||
            (roomObj.buildingId === 'bld-b' && ann.customTarget.includes('อาคาร B'));
        }
        return false;
      }

      if (ann.targetType === 'rooms') {
        const roomsArr = getTargetRoomsArray(ann.targetRooms);
        if (roomsArr.some(r => (r || '').trim().toUpperCase() === cleanRoom)) {
          return true;
        }
        if (ann.customTarget) {
          const cleanCustom = (ann.customTarget || '').toUpperCase();
          const tokens = cleanCustom.split(/[,\s]+/).map(t => t.trim().replace(/^ห้อง\s*/, ''));
          return tokens.includes(cleanRoom) || tokens.some(t => t === cleanRoom) || cleanCustom.includes(cleanRoom);
        }
        return false;
      }
      return false;
    }

    return true;
  };

  return (
    <>
      {isAddOpen ? (
        <div className="h-full w-full flex flex-col bg-slate-50 animate-in fade-in duration-200">
          {/* Top Header: Seamlessly flush with top bar */}
          <header className="shrink-0 bg-white border-b border-slate-200/80 px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between shadow-xs z-20 -mt-[1px]">
            <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 font-sans">
              {/* 1. กลับ */}
              <button
                type="button"
                onClick={handleCloseModal}
                className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1.5 -ml-2 rounded-xl text-slate-700 hover:text-indigo-600 hover:bg-slate-100 active:bg-slate-200 transition-colors cursor-pointer font-extrabold text-xs sm:text-sm shrink-0 group"
                title="ย้อนกลับ"
              >
                <span>กลับ</span>
              </button>

              <ChevronLeft className="w-4 h-4 text-slate-400 shrink-0 stroke-[2.5]" />

              {/* 2. ชื่อหัวข้อ */}
              <span className="px-1.5 sm:px-2 py-1.5 text-slate-800 font-extrabold text-xs sm:text-sm shrink-0 select-none">
                {editingAnnouncement ? "แก้ไขประกาศประชาสัมพันธ์" : "สร้างประกาศประชาสัมพันธ์"}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCloseModal}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                title="ปิดหน้าต่าง"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Body content: Scrollable with centered max-w-3xl container */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 sm:px-6 py-6 pb-28">
            <div className="max-w-3xl mx-auto space-y-5 text-xs text-slate-800 pb-12">
              <form id="announcement-form" onSubmit={handleSaveAnnouncement} className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200/80 shadow-2xs space-y-5">
                <div className="border-b border-slate-100 pb-4">
                  <h4 className="font-black text-base sm:text-lg text-slate-900 leading-tight">
                    {editingAnnouncement ? "แก้ไขประกาศประชาสัมพันธ์" : "สร้างประกาศประชาสัมพันธ์"}
                  </h4>
                  <p className="text-slate-500 font-medium font-sans text-xs mt-0.5">
                    กำหนดหัวข้อ เนื้อหาแจ้งเตือน และกลุ่มเป้าหมายผู้พักอาศัยที่ต้องการส่งประกาศ
                  </p>
                </div>

                {/* Horizontal Smooth Scrollable Template Selector without buttons */}
                {!editingAnnouncement && (
                  <div className="space-y-1.5 pt-0.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span className="font-bold text-[11px] text-slate-700">แม่แบบประกาศด่วนยอดนิยม</span>
                        <span className="text-[10px] text-slate-400 font-normal hidden sm:inline">• ปัดหรือลากเพื่อดูเพิ่มเติม</span>
                      </div>
                    </div>

                    {/* Scrollable Container */}
                    <div
                      ref={templateScrollRef}
                      onMouseDown={handleTemplateMouseDown}
                      onWheel={handleTemplateWheel}
                      className="flex items-center gap-2 overflow-x-auto py-1.5 px-0.5 cursor-grab active:cursor-grabbing select-none touch-pan-x overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {ANNOUNCEMENT_TEMPLATES.map((tpl) => {
                        const isSelected = activeTemplateId === tpl.id;
                        return (
                          <button
                            key={tpl.id}
                            type="button"
                            draggable={false}
                            onDragStart={(e) => e.preventDefault()}
                            onClick={() => {
                              if (totalMovedDistanceRef.current > 6) return;
                              handleApplyTemplate(tpl);
                            }}
                            className={`px-3 py-1.5 rounded-xl text-left transition-all shrink-0 flex items-center gap-2 cursor-pointer border ${isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs font-extrabold scale-[0.98]'
                                : 'bg-white hover:bg-indigo-50/60 text-slate-700 border-slate-200 hover:border-indigo-300 shadow-3xs'
                              }`}
                            title={tpl.description}
                          >
                            <div className={`p-1.5 rounded-lg shrink-0 ${isSelected ? 'bg-white/20' : 'bg-slate-100'}`}>
                              {getTemplateIcon(tpl.iconType, isSelected)}
                            </div>
                            <div className="text-left">
                              <span className={`block text-[11px] font-bold whitespace-nowrap leading-tight ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                                {tpl.name}
                              </span>
                              <span className={`block text-[9px] whitespace-nowrap leading-tight mt-0.5 ${isSelected ? 'text-indigo-100' : 'text-slate-400'}`}>
                                {tpl.categoryLabel}
                              </span>
                            </div>
                            {isSelected && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-white shrink-0 ml-1" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block font-bold text-slate-700 text-xs sm:text-sm">
                    หัวข้อเรื่องประชาสัมพันธ์ <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="เช่น แจ้งงดบริการลิฟต์โดยสาร ตึก A เพื่อตรวจสอบความปลอดภัยประจำปี"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-semibold text-xs sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-700 text-xs sm:text-sm">หมวดหมู่ประกาศ</label>
                    <div className="relative">
                      <select
                        value={annType}
                        onChange={(e) => setAnnType(e.target.value as any)}
                        className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-700 font-semibold text-xs sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs"
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
                    <label className="block font-bold text-slate-700 text-xs sm:text-sm">กลุ่มเป้าหมายผู้พักอาศัย</label>
                    <div className="relative">
                      <select
                        value={targetSelect}
                        onChange={(e) => setTargetSelect(e.target.value as any)}
                        className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-700 font-semibold text-xs sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs"
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
                  <div className="space-y-3 p-4 bg-slate-50 border border-slate-200/80 rounded-2xl animate-in fade-in-50 duration-200">
                    <div className="space-y-1">
                      <label className="block font-bold text-slate-700 text-xs">ระบุกลุ่มเป้าหมายหรือระบุเลขห้อง</label>
                      <input
                        type="text"
                        required
                        value={customTargetText}
                        onChange={(e) => setCustomTargetText(e.target.value)}
                        placeholder="เช่น ห้อง A101, B202 หรือ ชั้น 3 ทั้งหมด"
                        className="w-full px-3 py-2 border border-slate-200 rounded-xl bg-white text-slate-800 font-semibold outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-3xs text-xs"
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
                          {(() => {
                            const bldIds = Array.from(new Set(rooms.map(r => r.buildingId).filter(Boolean)));
                            bldIds.sort((a, b) => {
                              const idxA = (buildings || []).findIndex(bld => bld.id === a);
                              const idxB = (buildings || []).findIndex(bld => bld.id === b);
                              if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                              if (idxA !== -1) return -1;
                              if (idxB !== -1) return 1;
                              return 0;
                            });
                            return bldIds.map(bldId => {
                              const bldName = (buildings || []).find(b => b.id === bldId)?.name || `อาคาร ${bldId?.replace('bld-', '').toUpperCase()}`;
                              const bldRooms = rooms.filter(r => r.buildingId === bldId);
                              const floors = Array.from(new Set(bldRooms.map(r => r.floor))).sort((a, b) => a - b);

                              return (
                                <div key={bldId} className="space-y-1.5 border-b border-slate-200 pb-2.5 last:border-0 last:pb-0">
                                  <span className="text-[10px] font-black text-indigo-600 block">{bldName}</span>

                                  {floors.map(fl => {
                                    const floorRooms = bldRooms.filter(r => r.floor === fl).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
                                    return (
                                      <div key={fl} className="flex items-start gap-2">
                                        <span className="text-[9px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded shrink-0 mt-0.5">ชั้น {fl}</span>
                                        <div className="flex flex-wrap gap-1">
                                          {floorRooms.map(room => {
                                            const isSelected = customTargetText.split(',').map(t => t.trim()).includes(room.roomNumber);
                                            return (
                                              <button
                                                key={room.id}
                                                type="button"
                                                onClick={() => toggleRoomInCustomTarget(room.roomNumber)}
                                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${isSelected
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
                            });
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* รายละเอียดประชาสัมพันธ์ * */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block font-bold text-slate-700 text-xs sm:text-sm">
                      รายละเอียดประชาสัมพันธ์ <span className="text-rose-500">*</span>
                    </label>
                  </div>

                  <textarea
                    required
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="ระบุกำหนดวัน เวลาเปิด/ปิดซ่อม หรือแนวปฏิบัติเพิ่มเติมเพื่อให้ผู้เช่าเตรียมรับมือ..."
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 h-44 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 font-normal leading-relaxed text-xs sm:text-sm transition-all shadow-2xs placeholder:text-slate-400"
                  />
                </div>

                {/* Direct Beautiful Drag-and-Drop Image Uploader */}
                {attachmentUrl ? (
                  <div className="relative border border-slate-200 rounded-2xl overflow-hidden h-48 bg-slate-50 animate-in zoom-in-95 mt-2 flex items-center justify-center">
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
                      className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-1.5 shadow-2xs ${isDragging
                          ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01]'
                          : 'border-slate-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-slate-50/80'
                        }`}
                    >
                      <Upload className={`w-8 h-8 transition-transform ${isDragging ? 'text-indigo-600 animate-bounce' : 'text-slate-400'}`} />
                      <span className="font-extrabold text-xs text-slate-700">
                        {isDragging ? 'วางไฟล์รูปภาพของคุณตรงนี้เลย!' : 'ลากไฟล์รูปภาพมาวาง หรือ คลิกเพื่ออัปโหลด'}
                      </span>
                      <span className="text-[10px] text-slate-400">รองรับไฟล์ PNG, JPG, WEBP ขนาดสูงสุด 10MB</span>
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
                    <label className="block font-bold text-slate-700 text-xs sm:text-sm">แนบลิงก์รายละเอียดเพิ่มเติม (ถ้ามี)</label>
                    <input
                      type="url"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="https:// ..."
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl bg-white text-slate-800 font-semibold text-xs sm:text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs placeholder:text-slate-400"
                    />
                  </div>
                </div>

                {!editingAnnouncement && (
                  <div className="p-3.5 bg-slate-50 border border-slate-200/90 rounded-xl space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        data-testid="announcement-send-line-push-checkbox"
                        checked={sendLinePush}
                        onChange={(e) => setSendLinePush(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="font-extrabold text-xs sm:text-sm text-slate-800">
                        ส่งข้อความไปยังไลน์
                      </span>
                    </label>
                    <div className="pl-6.5 text-[11px] text-slate-500 flex items-center justify-between">
                      <span>
                        {sendLinePush
                          ? `จะใช้โควตา LINE ${targetEstimatedCount} ข้อความ (ส่งถึงผู้เช่าที่ผูก LINE)`
                          : 'ไม่ส่งข้อความเตือนทาง LINE (ประกาศและระบบแจ้งเตือนจะยังแสดงในเว็บตามปกติ)'}
                      </span>
                    </div>
                  </div>
                )}

                {errorText && (
                  <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
                    <span className="font-semibold">{errorText}</span>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Bottom Action Bar: Flush and locked to bottom of viewport */}
          <footer className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white border-t border-slate-200 px-4 sm:px-6 py-3.5 shadow-md">
            <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 font-sans w-full">
              <button
                type="button"
                onClick={handleCloseModal}
                className="px-4 py-2.5 border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs sm:text-sm active:scale-95 shadow-3xs"
              >
                <ArrowLeft className="w-4 h-4" />
                ย้อนกลับ
              </button>

              <button
                type="submit"
                form="announcement-form"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-xl flex items-center gap-1.5 font-bold transition-all cursor-pointer text-xs sm:text-sm shadow-md"
              >
                <span>{editingAnnouncement ? 'บันทึกการแก้ไข' : 'ประชาสัมพันธ์'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </footer>
        </div>
      ) : (
        <div className="space-y-6">

          {/* Main Grid: Left is Announcements, Right is Live Preview */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

            {/* Left column: Announcements List (2 columns wide) with main card container (มีกรอบหลัก) */}
            <div className="lg:col-span-2 bg-white border border-slate-100 rounded-[28px] p-6 shadow-2xs space-y-5 flex flex-col min-h-[580px]">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <h3 className="font-extrabold text-sm text-slate-800 flex items-center gap-2">
                  <Megaphone className="w-4 h-4 text-slate-700 shrink-0" />
                  <span>ประชาสัมพันธ์ ({announcements.length})</span>
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenNewAnnouncement}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ประกาศ</span>
                  </button>
                </div>
              </div>

              {announcements.length > 0 ? (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  {paginatedAnnouncements.map((ann) => {
                      const { bg: badgeBg, label: badgeLabel, icon: badgeIcon } = getBadgeDetails(ann);
                      const authorName = ann.author || 'นิติบุคคล';
                      const authorInitial = authorName.includes('(') ? authorName.split(' ')[0].substring(0, 2) : authorName.substring(0, 2);
                      const authorBg = authorName.includes('ช่าง') ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white';

                      return (
                        <div
                          key={ann.id}
                          onClick={() => handleStartEdit(ann)}
                          className="bg-white rounded-[28px] border border-slate-100 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between overflow-hidden relative group cursor-pointer hover:border-slate-300 animate-in fade-in-50 duration-200 min-h-[460px] h-full"
                        >
                          {/* Action Menu (Float in top corner) */}
                          <div
                            className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 transition-opacity ${
                              ann.isPinned ? 'opacity-100' : 'opacity-90 group-hover:opacity-100'
                            }`}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              disabled={togglingPinId === ann.id}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleTogglePin(ann.id);
                              }}
                              className={`w-8 h-8 sm:w-8.5 sm:h-8.5 flex items-center justify-center rounded-xl transition-all cursor-pointer shadow-2xs active:scale-90 ${
                                ann.isPinned
                                  ? 'bg-violet-600 text-white border border-violet-500 shadow-violet-200 hover:bg-violet-700 ring-2 ring-violet-200'
                                  : 'bg-white/95 backdrop-blur-xs hover:bg-violet-50 text-slate-400 hover:text-violet-600 border border-slate-200/90 hover:border-violet-300'
                              } ${togglingPinId === ann.id ? 'opacity-70 cursor-wait' : ''}`}
                              title={ann.isPinned ? 'ยกเลิกการปักหมุด (คลิกเพื่อปลดหมุด)' : 'ปักหมุดประกาศนี้ (แสดงลำดับแรกและส่งขึ้นหน้าหลัก)'}
                              aria-label={ann.isPinned ? 'ยกเลิกการปักหมุด' : 'ปักหมุดประกาศนี้'}
                            >
                              {togglingPinId === ann.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-current" />
                              ) : (
                                <Pin
                                  className={`w-3.5 h-3.5 transition-transform ${
                                    ann.isPinned ? 'fill-white rotate-45 scale-105' : 'hover:scale-110'
                                  }`}
                                />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                handleDeleteAnnouncement(ann.id, ann.title);
                              }}
                              className="w-8 h-8 sm:w-8.5 sm:h-8.5 flex items-center justify-center bg-white/95 backdrop-blur-xs hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-xl shadow-2xs border border-slate-200/90 hover:border-rose-200 transition-all cursor-pointer active:scale-90"
                              title="ลบประกาศ"
                              aria-label="ลบประกาศ"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Visual Content (Image or beautiful placeholder vector) */}
                          <div className="flex-1 flex flex-col">
                            {ann.attachmentUrl ? (
                              <div className="w-full h-44 bg-slate-50 flex items-center justify-center border-b border-slate-50 relative overflow-hidden shrink-0">
                                <img
                                  src={ann.attachmentUrl}
                                  alt={ann.title}
                                  className="w-full h-full object-contain"
                                  referrerPolicy="no-referrer"
                                />
                              </div>
                            ) : (
                              // Display elegant vector background placeholders
                              <div className={`w-full h-44 border-b border-slate-50 flex items-center justify-center relative overflow-hidden shrink-0 ${ann.type === 'electric_off' ? 'bg-violet-50/50' : ann.type === 'water_off' || ann.type === 'maintenance' ? 'bg-sky-50/40' : 'bg-slate-50/60'
                                }`}>
                                {ann.type === 'electric_off' && (
                                  <Plug className="w-16 h-16 text-violet-100/90 -rotate-12" />
                                )}
                                {(ann.type === 'water_off' || ann.type === 'maintenance') && (
                                  <Droplet className="w-16 h-16 text-sky-150/90" />
                                )}
                                {ann.type !== 'electric_off' && ann.type !== 'water_off' && ann.type !== 'maintenance' && (
                                  <Megaphone className="w-16 h-16 text-slate-200 rotate-12" />
                                )}
                              </div>
                            )}

                            {/* Content Pad */}
                            <div className="p-5 pb-3 space-y-3 flex-1 flex flex-col justify-between">
                              <div className="space-y-3">
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
                                  <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100/80 text-slate-600 font-extrabold px-2.5 py-1 rounded-lg border border-slate-200">
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
                              </div>

                              {/* Detail Link if exists */}
                              {ann.linkUrl && (
                                <div className="pt-1">
                                  <a
                                    href={ann.linkUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-700 hover:text-slate-900 hover:underline bg-slate-100 px-2 py-1 rounded-lg border border-slate-200"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Link className="w-3 h-3 text-slate-500" />
                                    <span>เปิดดูลิงก์รายละเอียดเพิ่มเติม</span>
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Card Footer */}
                          <div className="p-5 pt-0 mt-auto shrink-0">
                            <div className="border-t border-slate-100 pt-3.5 flex items-center justify-between">
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
                    })}
                  </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-16 text-center text-gray-400 rounded-3xl">
                  <Megaphone className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <h4 className="text-sm font-bold text-slate-700">ไม่มีประกาศประชาสัมพันธ์บนบอร์ดข่าวสารขณะนี้</h4>
                  <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">กดเขียนประกาศฉบับใหม่ เพื่อเผยแพร่ข่าวแจ้งผู้เช่าอาศัย</p>
                </div>
              )}

              {/* Pagination Controls (2 items per page) */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-slate-100 shadow-3xs mt-auto">
                  <button
                    type="button"
                    disabled={activePage === 1}
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    className={`px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${activePage === 1
                        ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400'
                        : 'bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                      }`}
                  >
                    <span>←</span> ย้อนกลับ
                  </button>

                  <span className="text-[10px] font-black text-slate-500">
                    หน้า {activePage} จาก {totalPages}
                  </span>

                  <button
                    type="button"
                    disabled={activePage === totalPages}
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    className={`px-3 py-1.5 rounded-xl border border-slate-200 text-[10px] font-bold transition-all flex items-center gap-1 cursor-pointer ${activePage === totalPages
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
            <div className="lg:col-span-1 flex flex-col items-center">
              <div className="bg-slate-900 p-1.5 rounded-[32px] border border-slate-800/80 shadow-xl max-w-[320px] w-full mx-auto flex flex-col h-[580px] max-h-[580px] shrink-0">
                <div className="bg-slate-50 rounded-[26px] p-3.5 flex-1 flex flex-col overflow-hidden text-xs font-sans relative min-h-0 h-full">

                  {/* Smartphone status header */}
                  <div className="relative mb-2 shrink-0">
                    {/* Status Bar line with HorPlus and Time */}
                    <div className="flex justify-between items-center text-[9px] font-black text-slate-400 px-1 pt-0.5">
                      <span className="font-extrabold text-slate-600">HorPlus</span>
                      <span className="font-bold text-slate-500">{currentClockTime}</span>
                    </div>
                  </div>

                  {/* Simulated View: Styled to match "กลุ่มเป้าหมายผู้พักอาศัย" */}
                  <div className="bg-white/95 p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs mb-2.5 shrink-0 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block font-bold text-slate-700 text-[10px] leading-tight">
                        กลุ่มเป้าหมายผู้พักอาศัย
                      </label>
                      <span className="text-[8px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md border border-slate-200">
                        จำลองมุมมอง
                      </span>
                    </div>

                    <div className="relative">
                      <select
                        value={simulatedTarget}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSimulatedTarget(val);
                          if (val === 'custom' && !simulatedRoom && rooms && rooms.length > 0) {
                            setSimulatedRoom(rooms[0].roomNumber);
                          }
                        }}
                        className="w-full pl-7 pr-6 py-1.5 border border-slate-200 rounded-xl bg-slate-50 hover:bg-white text-slate-700 font-semibold text-[10px] outline-none focus:border-slate-300 focus:ring-0 transition-all shadow-3xs cursor-pointer appearance-none"
                      >
                        <option value="all" className="py-1 text-xs text-slate-700 bg-white">
                          ทุกตึกอาคาร (ทุกผู้พักอาศัย)
                        </option>
                        {(buildings || []).map((bld) => (
                          <option key={bld.id} value={bld.id} className="py-1 text-xs text-slate-700 bg-white">
                            {bld.name}
                          </option>
                        ))}
                        <option value="custom" className="py-1 text-xs text-slate-700 bg-white">
                          กำหนดเลขห้อง / ระบุเอง...
                        </option>
                      </select>
                      <div className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <BuildingIcon className="w-3.5 h-3.5 text-slate-500" />
                      </div>
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                        <ChevronLeft className="w-3 h-3 text-slate-400 -rotate-90" />
                      </div>
                    </div>

                    {/* Sub-selector when "กำหนดเลขห้อง / ระบุเอง..." is selected, mirroring modal */}
                    {simulatedTarget === 'custom' && (
                      <div className="space-y-1 pt-1.5 border-t border-slate-100 animate-in fade-in-50 duration-200">
                        <label className="block font-bold text-slate-600 text-[8px]">
                          ระบุเลขห้องที่ต้องการจำลองมุมมอง:
                        </label>
                        <div className="relative">
                          <select
                            value={simulatedRoom || (rooms && rooms[0]?.roomNumber) || ''}
                            onChange={(e) => setSimulatedRoom(e.target.value)}
                            className="w-full pl-7 pr-6 py-1 border border-slate-200 rounded-lg bg-white text-slate-800 font-semibold text-[9px] outline-none focus:border-slate-300 focus:ring-0 shadow-3xs cursor-pointer appearance-none"
                          >
                            {sortRoomsByBuildingAndNumber(rooms || [], buildings || []).map((room) => {
                              const bld = (buildings || []).find(b => b.id === room.buildingId);
                              return (
                                <option key={room.id} value={room.roomNumber} className="py-1 text-slate-700">
                                  ห้อง {room.roomNumber} ({bld?.name || 'อาคาร'})
                                </option>
                              );
                            })}
                          </select>
                          <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                            <DoorOpen className="w-3.5 h-3.5 text-slate-500" />
                          </div>
                          <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                            <ChevronLeft className="w-2.5 h-2.5 text-slate-400 -rotate-90" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {(() => {
                    const visibleAnnouncements = announcements
                      .filter(ann => isAnnVisibleToSimulatedView(ann, simulatedView))
                      .sort((a, b) => {
                        if (a.isPinned && !b.isPinned) return -1;
                        if (!a.isPinned && b.isPinned) return 1;
                        const dateA = a.publishDate || a.createdAt || '';
                        const dateB = b.publishDate || b.createdAt || '';
                        return dateB.localeCompare(dateA);
                      });

                    return (
                      <>
                        {/* Header title mimicking tenant portal */}
                        <div className="flex items-center justify-between gap-1.5 mb-2.5 px-1 border-b border-slate-100 pb-2 shrink-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Megaphone className="w-4 h-4 text-slate-700 shrink-0" />
                            <h4 className="font-extrabold text-[12px] text-slate-900 truncate">
                              ประชาสัมพันธ์ ({visibleAnnouncements.length})
                            </h4>
                          </div>
                          {simulatedTarget !== 'all' && (
                            <span className="text-[8px] font-bold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md shrink-0 border border-slate-200">
                              {simulatedTarget === 'custom'
                                ? `ห้อง ${simulatedRoom || (rooms && rooms[0]?.roomNumber) || ''}`
                                : (buildings.find(b => b.id === simulatedTarget)?.name || 'ตามเป้าหมาย')}
                            </span>
                          )}
                        </div>

                        {/* Simulated notification cards list body (Scrollable inside phone screen) */}
                        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 overscroll-contain touch-pan-y">
                          {visibleAnnouncements.length > 0 ? (
                            visibleAnnouncements.map((ann) => {
                              const { bg: badgeBg, label: badgeLabel, icon: badgeIcon } = getBadgeDetails(ann);
                              const authorRole = getAuthorRoleName(ann.author);
                              const authorInitial = authorRole.substring(0, 2);
                              const authorBg = authorRole.includes('ช่าง') ? 'bg-emerald-500 text-white' : 'bg-violet-600 text-white';

                              return (
                                <div
                                  key={ann.id}
                                  onClick={() => setSelectedLiveId(ann.id)}
                                  className="bg-white rounded-[22px] overflow-hidden shadow-xs hover:shadow-sm transition-all flex flex-col justify-between animate-in fade-in-50 duration-200 cursor-pointer"
                                >
                                  <div>
                                    {ann.attachmentUrl && (
                                      <div className="w-full h-32 bg-slate-50 flex items-center justify-center overflow-hidden border-b border-slate-100">
                                        <img
                                          src={ann.attachmentUrl}
                                          alt={ann.title}
                                          className="w-full h-full object-cover"
                                          referrerPolicy="no-referrer"
                                        />
                                      </div>
                                    )}
                                    <div className="p-3.5 space-y-2.5">
                                      {/* Badges row */}
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        {ann.isPinned && (
                                          <span className="inline-flex items-center gap-1 text-[8px] bg-violet-600 text-white font-black px-2 py-0.5 rounded-md shadow-3xs">
                                            <Pin className="w-2 h-2 fill-white text-white rotate-45" />
                                            ปักหมุด
                                          </span>
                                        )}
                                        {ann.isUrgent && (
                                          <span className="inline-flex items-center gap-0.5 text-[8px] bg-rose-500 text-white font-black px-2 py-0.5 rounded-md">
                                            <AlertCircle className="w-2 h-2" />
                                            ด่วน
                                          </span>
                                        )}
                                        <span className={`inline-flex items-center gap-1 text-[8px] font-bold px-2 py-0.5 rounded-md border ${badgeBg}`}>
                                          {React.cloneElement(badgeIcon as React.ReactElement, { className: 'w-2 h-2 text-current' })}
                                          <span>{badgeLabel}</span>
                                        </span>
                                      </div>

                                      {/* Target custom list pill */}
                                      <div className="flex">
                                        <div className="inline-flex items-center gap-1.5 text-[9px] bg-slate-50 border border-slate-200 text-slate-700 font-extrabold px-2.5 py-0.5 rounded-lg">
                                          <Smartphone className="w-3 h-3 text-slate-400 shrink-0" />
                                          <span>
                                            {ann.targetType === 'all' && 'ทุกอาคาร'}
                                            {ann.targetType === 'building' && `ตึก ${buildings.find(b => b.id === ann.targetBuildingId)?.name?.replace('อาคาร ', '') || ann.customTarget || 'ทุกอาคาร'}`}
                                            {ann.targetType === 'rooms' && (getTargetRoomsArray(ann.targetRooms).length > 0 ? getTargetRoomsArray(ann.targetRooms).join(', ') : (ann.customTarget || 'ระบุห้อง'))}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Title and Content */}
                                      <div className="space-y-1">
                                        <h5 className="font-extrabold text-slate-900 text-[11px] tracking-tight leading-snug">{ann.title}</h5>
                                        <p className="text-[9px] text-slate-500 leading-relaxed whitespace-pre-line line-clamp-4">{ann.content}</p>
                                      </div>

                                      {/* Detail link */}
                                      {ann.linkUrl && (
                                        <div className="pt-0.5">
                                          <span className="inline-flex items-center gap-0.5 text-[8px] font-extrabold text-indigo-600 bg-indigo-50/50 px-1.5 py-0.5 rounded-md">
                                            <span>🔗 เปิดรายละเอียดเพิ่มเติม</span>
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Card footer */}
                                  <div className="p-3.5 pt-0">
                                    <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between text-[8px] text-slate-400">
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-5 h-5 rounded-full flex items-center justify-center font-black text-[7px] shrink-0 uppercase ${authorBg}`}>
                                          {authorInitial}
                                        </div>
                                        <span className="font-extrabold text-slate-700">
                                          โดย {authorRole}
                                        </span>
                                      </div>
                                      <span className="font-bold text-slate-400">
                                        {ann.publishDate ? formatThaiDate(ann.publishDate) : (ann.createdAt ? formatThaiDate(ann.createdAt.split('T')[0]) : '')}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="flex-1 flex flex-col items-center justify-center py-12 px-3 text-center my-auto bg-white/70 rounded-[22px] border border-slate-200/80 shadow-3xs space-y-2">
                              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-100">
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                              <div className="space-y-1">
                                <h5 className="font-extrabold text-[10px] text-slate-800 leading-tight">ไม่มีประกาศสำหรับกลุ่มเป้าหมายนี้</h5>
                                <p className="text-[8px] text-slate-500 leading-normal">
                                  ผู้เช่ากลุ่มนี้จะไม่เห็นประกาศใดๆ เนื่องจากไม่มีประกาศที่ส่งถึงกลุ่มนี้
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => setSimulatedTarget('all')}
                                className="mt-1 text-[8px] font-bold text-slate-600 bg-white border border-slate-200 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors shadow-3xs cursor-pointer"
                              >
                                รีเซ็ตเป็นมุมมองทั้งหมด
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}

                  {/* Home Indicator */}
                  <div className="w-24 h-1 bg-slate-300 rounded-full mx-auto mt-2.5 shrink-0" />

                </div>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* Toast Notification with Smooth Fade */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] bg-white/95 backdrop-blur-md text-slate-800 px-4 py-2.5 rounded-full shadow-xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out select-none whitespace-nowrap max-w-[92vw] sm:max-w-none ${isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            }`}
        >
          {toastType === 'success' && (
            <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100/80">
              <CheckCircle2 className="w-3.5 h-3.5" />
            </div>
          )}
          {toastType === 'delete' && (
            <div className="w-6 h-6 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100/80">
              <Trash2 className="w-3.5 h-3.5" />
            </div>
          )}
          {toastType === 'pin' && (
            <div className="w-6 h-6 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100/80">
              <Pin className="w-3.5 h-3.5 fill-indigo-600" />
            </div>
          )}
          {toastType === 'info' && (
            <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200/80">
              <Megaphone className="w-3.5 h-3.5 text-indigo-600" />
            </div>
          )}

          <span className="text-slate-800 font-extrabold text-[12px] leading-none whitespace-nowrap">
            {toastMessage}
          </span>

          <button
            type="button"
            onClick={() => {
              setIsToastFading(true);
              setTimeout(() => setToastMessage(null), 350);
            }}
            className="ml-1 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            title="ปิดการแจ้งเตือน"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );
};
