/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  ChevronRight,
  ExternalLink,
  X,
  MessageSquare,
  Send,
  Sparkles,
  Smartphone,
  Search,
  AlertCircle
} from 'lucide-react';
import { LineLogo as LineIcon } from '../../components/LineLogo';
import { consumeLineQuota } from '../../utils/lineQuota';
import { Task009ApiAdapter, LineFriend } from '../../data/adapters/task009';

export const adaptLineFriend = (f: LineFriend): LineOAFriend => ({
  id: f.id,
  name: f.displayName || 'เพื่อนใน LINE',
  lineDisplayName: f.displayName || 'user',
  avatarColor: 'bg-emerald-500',
  status: f.friendStatus === 'FOLLOWING' ? 'เพื่อนใน LINE' : (f.friendStatus || 'ติดตามแล้ว'),
  phone: undefined,
});

export interface LineOAFriend {
  id: string;
  name: string;
  lineDisplayName: string;
  avatarColor: string;
  suggestedRole?: 'owner' | 'manager' | 'staff';
  status: string;
  phone?: string;
}

export const isStaffRoleStatus = (status: string): boolean => {
  return ['เจ้าของหอพัก', 'ผู้จัดการ', 'ช่าง/แม่บ้าน'].includes(status);
};

export const normalizeLocalBearerUrl = (url: string, currentOrigin?: string): string => {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const originStr = currentOrigin || (typeof window !== 'undefined' ? window.location.origin : '');
    if (originStr) {
      const originUrl = new URL(originStr);
      if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
        return `${originUrl.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    }
    return url;
  } catch {
    return url;
  }
};

export const getFriendCategory = (status: string): 'ผู้เช่า' | 'ผู้ดูแล' => {
  if (isStaffRoleStatus(status)) {
    return 'ผู้ดูแล';
  }
  return 'ผู้เช่า'; // 'ห้อง A101', 'เลิกเช่า', 'รอลงทะเบียน'
};

export const MOCK_LINE_OA_FRIENDS: LineOAFriend[] = [
  {
    id: 'line-friend-1',
    name: 'สมชาย ใจดี',
    lineDisplayName: 'somchai_a101',
    avatarColor: 'bg-sky-500',
    suggestedRole: 'staff',
    status: 'ห้อง A101',
    phone: '081-111-2233'
  },
  {
    id: 'line-friend-2',
    name: 'นิติ สุขสมบูรณ์',
    lineDisplayName: 'niti_owner',
    avatarColor: 'bg-purple-500',
    suggestedRole: 'owner',
    status: 'เจ้าของหอพัก',
    phone: '085-999-8877'
  },
  {
    id: 'line-friend-3',
    name: 'อนันต์ ช่างไฟ',
    lineDisplayName: 'anan_tech',
    avatarColor: 'bg-amber-500',
    suggestedRole: 'staff',
    status: 'ช่าง/แม่บ้าน',
    phone: '082-345-6789'
  },
  {
    id: 'line-friend-4',
    name: 'สมศักดิ์ มีสุข',
    lineDisplayName: 'somsak_m',
    avatarColor: 'bg-emerald-500',
    suggestedRole: 'manager',
    status: 'ผู้จัดการ',
    phone: '081-234-5678'
  },
  {
    id: 'line-friend-5',
    name: 'วรัญญา มีทรัพย์',
    lineDisplayName: 'waranya_ex',
    avatarColor: 'bg-rose-500',
    status: 'เลิกเช่า',
    phone: '089-777-6655'
  },
  {
    id: 'line-friend-6',
    name: 'กิตติพงษ์ ยอดเยี่ยม',
    lineDisplayName: 'kitti_reg',
    avatarColor: 'bg-blue-500',
    status: 'รอลงทะเบียน'
  },
  {
    id: 'line-friend-7',
    name: 'วิภาวรรณ ใจดี',
    lineDisplayName: 'wipawan_clean',
    avatarColor: 'bg-amber-600',
    suggestedRole: 'staff',
    status: 'ช่าง/แม่บ้าน',
    phone: '086-555-1234'
  },
  {
    id: 'line-friend-8',
    name: 'ภัทรพล สว่างศรี',
    lineDisplayName: 'pat_service24',
    avatarColor: 'bg-teal-500',
    suggestedRole: 'staff',
    status: 'ช่าง/แม่บ้าน',
    phone: '089-876-5432'
  }
];

interface AccessToken {
  id: string; // UUID/token
  role: 'owner' | 'manager' | 'staff';
  createdAt: string;
  status: 'active' | 'deleted';
  lastUsedAt?: string;
  lineUser?: {
    id: string;
    name: string;
    lineDisplayName: string;
    avatarColor?: string;
    phone?: string;
    sentAt: string;
  };
}

interface OwnerUsersProps {
  onAddLog: (action: string, details: string, type: string, id: string) => void;
  dormitoryId?: string;
}

const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
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
  onAddLog,
  dormitoryId
}) => {
  const activeDormitoryId =
    dormitoryId ||
    (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('active_dormitory_selected_for_session') : null) ||
    (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') : null) ||
    '';

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

  const [lineFriends, setLineFriends] = useState<LineOAFriend[]>([]);
  const [createdTokensMap, setCreatedTokensMap] = useState<Record<string, string>>({});

  const fetchStaffAndGrants = async () => {
    if (!activeDormitoryId) return;
    try {
      const res = await Task009ApiAdapter.getStaff(activeDormitoryId);
      if (res.success && res.data) {
        const grants = res.data.accessGrants || [];
        const mappedTokens: AccessToken[] = grants.map((g) => {
          const roleNormalized = (g.roleCode?.toLowerCase() || 'staff') as 'owner' | 'manager' | 'staff';
          return {
            id: g.id,
            role: roleNormalized,
            createdAt: g.createdAt || new Date().toISOString(),
            status: g.status === 'ACTIVE' ? 'active' : 'deleted',
            lastUsedAt: undefined,
            lineUser: g.lineFriendId ? {
              id: g.lineFriendId,
              name: g.displayName,
              lineDisplayName: g.displayName,
              sentAt: g.createdAt || new Date().toISOString()
            } : undefined
          };
        });
        setAccessTokens(mappedTokens);
      }
    } catch (err) {
      console.error('[OwnerUsers] Failed to fetch staff grants:', err);
    }
  };

  const fetchLineFriends = async () => {
    if (!activeDormitoryId) return;
    try {
      const res = await Task009ApiAdapter.getLineFriends(activeDormitoryId);
      if (res.success && res.data) {
        const adapted = res.data.map(adaptLineFriend);
        setLineFriends(adapted);
      }
    } catch (err) {
      console.error('[OwnerUsers] Failed to fetch LINE friends:', err);
    }
  };

  useEffect(() => {
    if (activeDormitoryId) {
      fetchStaffAndGrants();
      fetchLineFriends();
    }
  }, [activeDormitoryId]);

  useEffect(() => {
    localStorage.setItem('juristic_access_tokens', JSON.stringify(accessTokens));
  }, [accessTokens]);

  const [tokenRole, setTokenRole] = useState<'owner' | 'manager' | 'staff'>('staff');
  const [selectedLineFriendId, setSelectedLineFriendId] = useState<string>('');

  // LINE Friend Picker Modal States
  const [isFriendPickerOpen, setIsFriendPickerOpen] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendFilterStatus, setFriendFilterStatus] = useState('ทั้งหมด');

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'ห้อง A101':
        return 'bg-sky-50 text-sky-700 border-sky-200';
      case 'เจ้าของหอพัก':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'ผู้จัดการ':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'ช่าง/แม่บ้าน':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'เลิกเช่า':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'รอลงทะเบียน':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      default:
        return 'bg-slate-50 text-slate-600 border-slate-200';
    }
  };

  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState<{ id: string; roleName: string; step: 1 | 2 } | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [justSentToLine, setJustSentToLine] = useState(false);

  // Table drag-to-scroll (คลิกซ้ายค้าง เลื่อนตารางเฉพาะแนวนอน ไม่รบกวนการเลื่อนแนวตั้ง)
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const isTableDraggingRef = useRef(false);
  const tableStartXRef = useRef(0);
  const tableStartYRef = useRef(0);
  const tableScrollLeftRef = useRef(0);
  const hasTableDraggedRef = useRef(false);
  const [isTableDragging, setIsTableDragging] = useState(false);

  const handleTableMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !tableContainerRef.current) return;
    const target = e.target as HTMLElement;
    if (target.closest('button[data-no-drag]') || target.closest('button')) return;

    isTableDraggingRef.current = true;
    hasTableDraggedRef.current = false;
    tableStartXRef.current = e.pageX;
    tableStartYRef.current = e.pageY;
    tableScrollLeftRef.current = tableContainerRef.current.scrollLeft;
  };

  const handleTableMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTableDraggingRef.current || !tableContainerRef.current) return;
    const diffX = e.pageX - tableStartXRef.current;
    const diffY = e.pageY - tableStartYRef.current;

    // ถ้าผู้ใช้กำลังเลื่อนเมาส์ในแนวตั้ง ให้ยกเลิกการลากแนวนอนทันที เพื่อไม่ให้ตารางเลื่อนซ้าย-ขวาไปด้วย
    if (Math.abs(diffY) > Math.abs(diffX)) {
      isTableDraggingRef.current = false;
      setIsTableDragging(false);
      return;
    }

    // ต้องเลื่อนแนวนอนชัดเจน จึงจะเริ่มเลื่อนตาราง
    if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      hasTableDraggedRef.current = true;
      setIsTableDragging(true);
      tableContainerRef.current.scrollLeft = tableScrollLeftRef.current - (diffX * 1.2);
    }
  };

  const handleTableMouseUpOrLeave = () => {
    isTableDraggingRef.current = false;
    setIsTableDragging(false);
  };
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
      }, 2800);
      const removeTimer = setTimeout(() => {
        setToast(prev => ({ ...prev, visible: false }));
        setIsToastFading(false);
      }, 3400);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toast.visible]);
  const itemsPerPage = 4;

  const totalPages = Math.ceil(accessTokens.length / itemsPerPage);

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [accessTokens.length, totalPages, currentPage]);

  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = accessTokens.slice(indexOfFirstItem, indexOfLastItem);


  const getAccessLink = (tokenId: string) => {
    if (createdTokensMap[tokenId]) {
      return normalizeLocalBearerUrl(createdTokensMap[tokenId]);
    }
    return '';
  };

  const effectiveFriends = lineFriends.length > 0 ? lineFriends : (activeDormitoryId ? [] : MOCK_LINE_OA_FRIENDS);
  const selectedFriend = effectiveFriends.find(f => f.id === selectedLineFriendId);

  const filteredFriends = effectiveFriends.filter((f) => {
    const q = friendSearchQuery.trim().toLowerCase();
    const name = (f.name || '').toLowerCase();
    const lineDisplay = (f.lineDisplayName || '').toLowerCase();
    const status = (f.status || '').toLowerCase();
    const phone = f.phone || '';

    const matchesSearch =
      q === '' ||
      name.includes(q) ||
      lineDisplay.includes(q) ||
      status.includes(q) ||
      (f.status !== 'รอลงทะเบียน' && phone.includes(q));

    const friendCategory = getFriendCategory(f.status);
    const matchesCategory =
      friendFilterStatus === 'ทั้งหมด' || friendCategory === friendFilterStatus;

    return matchesSearch && matchesCategory;
  });

  const handleCreateTokenLink = async () => {
    if (isCreating) return;
    setIsCreating(true);

    const roleUpper = tokenRole.toUpperCase() as 'OWNER' | 'MANAGER' | 'STAFF';
    const roleThai = tokenRole === 'owner' ? 'เจ้าของหอพัก' : tokenRole === 'manager' ? 'ผู้จัดการ' : 'ช่าง/แม่บ้าน';
    const friendId = selectedFriend ? selectedFriend.id : '';

    if (activeDormitoryId) {
      try {
        const res = await Task009ApiAdapter.createAccessGrant(
          activeDormitoryId,
          friendId,
          roleUpper
        );

        if (res.success && res.data) {
          const grant = res.data.grant;
          const bearerUrl = res.data.bearerUrl;
          if (grant?.id && bearerUrl) {
            setCreatedTokensMap(prev => ({ ...prev, [grant.id]: bearerUrl }));
          }

          if (selectedFriend) {
            consumeLineQuota(new Date().toISOString().slice(0, 7), 1);
            onAddLog(
              'ส่งลิงก์สิทธิ์ผ่าน LINE',
              `สร้างและส่งลิงก์เข้าใช้งานระดับ ${roleThai} ไปยัง LINE ของ ${selectedFriend.name} (@${selectedFriend.lineDisplayName}) สำเร็จ`,
              'LineNotification',
              grant?.id || ''
            );
            setToast({
              message: 'ส่งลิงก์ไปยัง LINE เรียบร้อยแล้ว',
              visible: true,
              type: 'success'
            });
            setJustSentToLine(true);
            setTimeout(() => {
              setJustSentToLine(false);
              setSelectedLineFriendId('');
            }, 1600);
          } else {
            // Auto-copy newly created link to clipboard
            const finalBearerUrl = normalizeLocalBearerUrl(bearerUrl);
            if (grant?.id && finalBearerUrl) {
              setCreatedTokensMap(prev => ({ ...prev, [grant.id]: finalBearerUrl }));
            }
            if (finalBearerUrl) {
              try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(finalBearerUrl).catch(() => {});
                }
              } catch (e) {}
            }
            if (grant?.id) {
              setCopiedTokenId(grant.id);
              setTimeout(() => setCopiedTokenId(null), 2000);
            }

            onAddLog(
              'สร้างลิงก์สิทธิ์นิติบุคคลด่วน',
              `สร้างลิงก์เข้าใช้ระบบด่วนสำหรับระดับสิทธิ์ ${roleThai} (Token: ${grant?.id})`,
              'TokenAccess',
              grant?.id || ''
            );
            setToast({
              message: 'สร้างและคัดลอกลิงก์เรียบร้อยแล้ว',
              visible: true,
              type: 'success'
            });
            setSelectedLineFriendId('');
          }

          await fetchStaffAndGrants();
          setCurrentPage(1);
        } else {
          setToast({
            message: res.error?.message || 'เกิดข้อผิดพลาดในการสร้างสิทธิ์',
            visible: true,
            type: 'error'
          });
        }
      } catch (err: any) {
        setToast({
          message: err.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์',
          visible: true,
          type: 'error'
        });
      } finally {
        setIsCreating(false);
      }
      return;
    }

    // Local / Offline fallback (e.g. without activeDormitoryId):
    setTimeout(() => {
      const newTokenId = generateUUID();
      const now = new Date().toISOString();
      const linkUrl = `${window.location.origin}/staff-access#${newTokenId}`;
      setCreatedTokensMap(prev => ({ ...prev, [newTokenId]: linkUrl }));

      const newToken: AccessToken = {
        id: newTokenId,
        role: tokenRole,
        createdAt: now,
        status: 'active',
        lineUser: selectedFriend ? {
          id: selectedFriend.id,
          name: selectedFriend.name,
          lineDisplayName: selectedFriend.lineDisplayName,
          avatarColor: selectedFriend.avatarColor,
          phone: selectedFriend.status !== 'รอลงทะเบียน' ? selectedFriend.phone : undefined,
          sentAt: now
        } : undefined
      };

      const isStaffUser = selectedFriend ? isStaffRoleStatus(selectedFriend.status) : false;
      const existingToken = isStaffUser
        ? accessTokens.find(t => t.lineUser?.id === selectedFriend?.id)
        : undefined;

      const remainingTokens = existingToken
        ? accessTokens.filter(t => t.lineUser?.id !== selectedFriend?.id)
        : accessTokens;

      const updated = [newToken, ...remainingTokens];
      setAccessTokens(updated);
      setCurrentPage(1);

      if (selectedFriend) {
        consumeLineQuota(new Date().toISOString().slice(0, 7), 1);
        if (existingToken) {
          onAddLog(
            'อัปเดตสิทธิ์ผู้ดูแลผ่าน LINE',
            `ยกเลิกลิงก์/สิทธิ์เดิม และสร้างลิงก์ระดับ ${roleThai} ส่งไปยัง LINE ของ ${selectedFriend.name} (@${selectedFriend.lineDisplayName}) สำเร็จ`,
            'LineNotification',
            newTokenId
          );
          setToast({
            message: 'อัปเดตลิงก์ใหม่ไปยัง LINE เรียบร้อยแล้ว (แทนที่สิทธิ์เดิม)',
            visible: true,
            type: 'success'
          });
        } else {
          onAddLog(
            'ส่งลิงก์สิทธิ์ผ่าน LINE',
            `สร้างและส่งลิงก์เข้าใช้งานระดับ ${roleThai} ไปยัง LINE ของ ${selectedFriend.name} (@${selectedFriend.lineDisplayName}) ผ่าน LINE Messaging API สำเร็จ`,
            'LineNotification',
            newTokenId
          );
          setToast({
            message: 'ส่งลิงก์ไปยัง LINE เรียบร้อยแล้ว',
            visible: true,
            type: 'success'
          });
        }
      } else {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(linkUrl).catch(() => {});
        }
        setCopiedTokenId(newTokenId);
        setTimeout(() => setCopiedTokenId(null), 2000);

        onAddLog(
          'สร้างลิงก์สิทธิ์นิติบุคคลด่วน',
          `สร้างลิงก์เข้าใช้ระบบด่วน SaaS สำหรับระดับสิทธิ์ ${roleThai} (Token: ${newTokenId})`,
          'TokenAccess',
          newTokenId
        );
        setToast({
          message: 'สร้างและคัดลอกลิงก์เรียบร้อยแล้ว',
          visible: true,
          type: 'success'
        });
      }

      setIsCreating(false);

      if (selectedFriend) {
        setJustSentToLine(true);
        setTimeout(() => {
          setJustSentToLine(false);
          setSelectedLineFriendId('');
        }, 1600);
      } else {
        setSelectedLineFriendId('');
      }
    }, 600);
  };

  const handleRevokeToken = (id: string, roleName: string) => {
    setRevokeConfirm({ id, roleName, step: 1 });
  };

  const handleNextRevokeStep = async () => {
    if (!revokeConfirm) return;
    if (revokeConfirm.step === 1) {
      setRevokeConfirm({ ...revokeConfirm, step: 2 });
    } else {
      if (activeDormitoryId) {
        try {
          await Task009ApiAdapter.revokeAccessGrant(activeDormitoryId, revokeConfirm.id);
          await fetchStaffAndGrants();
        } catch (err) {
          console.error('[OwnerUsers] Revoke failed:', err);
        }
      } else {
        const updated = accessTokens.filter(t => t.id !== revokeConfirm.id);
        setAccessTokens(updated);
      }
      onAddLog(
        'เพิกถอนลิงก์สิทธิ์นิติบุคคล',
        `ระงับการเข้าใช้งานลิงก์เข้าถึงด่วนของบทบาท ${revokeConfirm.roleName} (Token: ${revokeConfirm.id}) ถาวร`,
        'TokenAccess',
        revokeConfirm.id
      );
      setRevokeConfirm(null);
    }
  };

  const handleCopyLink = async (tokenId: string) => {
    let link = createdTokensMap[tokenId] ? normalizeLocalBearerUrl(createdTokensMap[tokenId]) : '';

    if (activeDormitoryId && !link) {
      try {
        const res = await Task009ApiAdapter.getCopyLink(activeDormitoryId, tokenId);
        if (res.success && res.data?.bearerUrl) {
          link = normalizeLocalBearerUrl(res.data.bearerUrl);
          setCreatedTokensMap(prev => ({ ...prev, [tokenId]: link }));
        } else {
          setToast({
            message: res.error?.message || 'ไม่สามารถดึงลิงก์เข้าใช้งานได้ (อาจถูกเพิกถอนไปแล้ว)',
            visible: true,
            type: 'error'
          });
          return;
        }
      } catch (err: any) {
        console.error('[OwnerUsers] Failed to get copy link:', err);
        setToast({
          message: err?.message || 'เกิดข้อผิดพลาดในการดึงลิงก์เข้าใช้งาน',
          visible: true,
          type: 'error'
        });
        return;
      }
    }

    if (!link) {
      link = `${window.location.origin}/staff-access#${tokenId}`;
    }

    const finalLink = normalizeLocalBearerUrl(link);
    const doCopy = () => {
      setCopiedTokenId(tokenId);
      setTimeout(() => setCopiedTokenId(null), 2000);
      setToast({
        message: 'คัดลอกลิงก์เข้าใช้งานเรียบร้อยแล้ว',
        visible: true,
        type: 'success'
      });
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(finalLink).then(doCopy).catch(() => {
        const el = document.createElement('textarea');
        el.value = finalLink;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        doCopy();
      });
    } else {
      const el = document.createElement('textarea');
      el.value = finalLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      doCopy();
    }
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

            {/* ช่องเลือกเพื่อนใน LINE เพื่อจำลองการส่งข้อความ */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-slate-700 flex items-center gap-1.5">
                  <LineIcon className="w-3.5 h-3.5" />
                  <span>เลือกรายชื่อเพื่อนใน LINE</span>
                </label>
              </div>

              {!selectedFriend ? (
                <button
                  type="button"
                  onClick={() => {
                    setFriendSearchQuery('');
                    setFriendFilterStatus('ทั้งหมด');
                    setIsFriendPickerOpen(true);
                  }}
                  className="w-full px-3 py-2.5 bg-slate-50 hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-xl flex items-center justify-between gap-2 text-left transition-all cursor-pointer group shadow-2xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <LineIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700 group-hover:text-emerald-800 truncate">
                        แตะเพื่อเลือกรายชื่อเพื่อนใน LINE
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        — ลิงก์เข้าโดยตรง ไม่ผ่านไลน์ —
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </button>
              ) : (
                <div className="p-3 bg-emerald-50/80 border border-emerald-200/90 rounded-2xl space-y-2.5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-full ${selectedFriend.avatarColor} text-white font-extrabold text-xs flex items-center justify-center shrink-0 shadow-2xs`}>
                        {selectedFriend.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-black text-slate-900 truncate">{selectedFriend.name}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-white border border-emerald-200 text-emerald-800 font-bold">
                            @{selectedFriend.lineDisplayName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`text-[9px] font-bold px-2 py-0.2 rounded-full border ${getStatusBadgeClass(selectedFriend.status)}`}>
                            {selectedFriend.status}
                          </span>
                          {selectedFriend.status !== 'รอลงทะเบียน' && selectedFriend.phone && (
                            <span className="text-[9px] text-slate-500 font-medium">
                              • {selectedFriend.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setFriendSearchQuery('');
                          setFriendFilterStatus('ทั้งหมด');
                          setIsFriendPickerOpen(true);
                        }}
                        className="px-2.5 py-1 text-[10px] font-bold text-emerald-700 hover:text-emerald-800 bg-white hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors cursor-pointer"
                      >
                        เปลี่ยน
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLineFriendId('')}
                        className="p-1 text-slate-400 hover:text-rose-600 hover:bg-white rounded-lg transition-colors cursor-pointer"
                        title="ยกเลิกการเลือก (เปลี่ยนเป็นลิงก์ทั่วไป)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleCreateTokenLink}
              disabled={isCreating || justSentToLine}
              style={{
                backgroundColor: (selectedFriend || justSentToLine) ? '#06C755' : undefined,
                color: '#ffffff'
              }}
              className={`w-full py-2.5 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#06C755]/50 ${(selectedFriend || justSentToLine)
                  ? 'bg-[#06C755] hover:bg-[#05b34c] active:bg-[#04a044] text-white disabled:bg-[#06C755] disabled:text-white shadow-emerald-200'
                  : 'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white disabled:bg-indigo-600 disabled:text-white shadow-indigo-200'
                } ${isCreating
                  ? 'opacity-95 cursor-wait'
                  : justSentToLine
                    ? 'cursor-default'
                    : 'cursor-pointer active:scale-98'
                }`}
            >
              {isCreating ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span className="text-white font-black">{selectedFriend ? 'กำลังส่งข้อความ LINE...' : 'กำลังสร้างลิงก์...'}</span>
                </>
              ) : justSentToLine ? (
                <>
                  <Check className="w-4 h-4 text-white stroke-[3]" />
                  <span className="text-white font-black">ส่งลิงก์ไปยัง LINE เรียบร้อยแล้ว!</span>
                </>
              ) : selectedFriend ? (
                <>
                  <LineIcon className="w-4 h-4 text-white shrink-0" />
                  <span className="text-white font-black">สร้างและส่งลิงก์ไปยัง LINE</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 text-white shrink-0" />
                  <span className="text-white font-black">สร้างลิงก์เข้าใช้ระบบ</span>
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
            <div
              ref={tableContainerRef}
              onMouseDown={handleTableMouseDown}
              onMouseMove={handleTableMouseMove}
              onMouseUp={handleTableMouseUpOrLeave}
              onMouseLeave={handleTableMouseUpOrLeave}
              onWheel={(e) => {
                // ถ้าเป็นการเลื่อนเมาส์ในแนวตั้ง ให้ระบบเลื่อนหน้าจอตามปกติ ไม่ให้ตารางขยับซ้ายขวา
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaX) < 1) {
                  return;
                }
              }}
              className={`overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0 select-none pb-2 overscroll-x-contain ${isTableDragging ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              style={{ WebkitOverflowScrolling: 'touch' }}
            >
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
                          <div className="space-y-1.5">
                            <span className={`px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg border text-[10px] font-extrabold inline-flex items-center gap-1 ${t.role === 'owner' ? 'bg-indigo-50 border-indigo-100 text-indigo-700' :
                                t.role === 'manager' ? 'bg-emerald-50 border-emerald-100 text-emerald-700' :
                                  'bg-amber-50 border-amber-100 text-amber-700'
                              }`}>
                              {t.role === 'owner' && <Users2 className="w-3 h-3" />}
                              {t.role === 'manager' && <Briefcase className="w-3 h-3" />}
                              {t.role === 'staff' && <Wrench className="w-3 h-3" />}
                              {roleLabel}
                            </span>
                            {t.lineUser ? (
                              <div
                                className="flex items-center gap-1.5 text-[10px] text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-md font-bold w-fit"
                              >
                                <LineIcon className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[110px]">{t.lineUser.name}</span>
                                <span className="text-[9px] text-emerald-600 font-normal">(@{t.lineUser.lineDisplayName})</span>
                              </div>
                            ) : (
                              <div className="text-[9px] text-slate-400 font-medium px-0.5">
                                ลิงก์ทั่วไป (คัดลอกส่งเอง)
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-1.5 sm:px-2 font-mono text-[10px] whitespace-nowrap">
                          <div className="flex items-center gap-1.5 w-fit">
                            <button
                              type="button"
                              data-no-drag="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasTableDraggedRef.current) return;
                                if (!isDeleted) handleCopyLink(t.id);
                              }}
                              className={`text-[9px] rounded-lg px-2 py-1.5 w-[84px] sm:w-[96px] font-mono select-none truncate transition-all border-0 outline-none ring-0 shadow-none text-left ${isDeleted
                                  ? 'bg-rose-50 text-rose-500 italic font-sans cursor-default'
                                  : 'bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-700 font-semibold cursor-pointer'
                                }`}
                              title={isDeleted ? undefined : 'คลิกเพื่อคัดลอกลิงก์เข้าใช้งาน'}
                            >
                              <span className="truncate block font-mono">
                                {isDeleted ? '❌ ปิดแล้ว' : 'คัดลอกลิงก์'}
                              </span>
                            </button>
                            {!isDeleted && (
                              <button
                                type="button"
                                data-no-drag="true"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (hasTableDraggedRef.current) return;
                                  handleCopyLink(t.id);
                                }}
                                className="p-1 sm:p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border-0 outline-none ring-0 rounded-lg transition-all cursor-pointer shrink-0"
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
                              data-no-drag="true"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasTableDraggedRef.current) return;
                                handleRevokeToken(t.id, roleLabel);
                              }}
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
                      className={`min-w-[28px] h-7 flex items-center justify-center text-xs font-extrabold rounded-lg transition-all border cursor-pointer ${currentPage === p
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
                <span>หน้าหลัก, จดมิเตอร์, การชำระเงิน, ห้องพัก, ผู้เช่า, งานแจ้งซ่อม, ประชาสัมพันธ์, รายงานสถิติ, สิทธิ์และพนักงาน, ต่ออายุ, ตั้งค่า</span>
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
                <span>หน้าหลัก, จดมิเตอร์, การชำระเงิน, ห้องพัก, ผู้เช่า, งานแจ้งซ่อม, ประชาสัมพันธ์, รายงานสถิติ, ต่ออายุ</span>
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
                <span>หน้าหลัก, จดมิเตอร์, งานแจ้งซ่อม, ต่ออายุ</span>
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
              <div className={`p-3 rounded-2xl shrink-0 ${revokeConfirm.step === 1 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'
                }`}>
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${revokeConfirm.step === 1 ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
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
                className={`flex-1 py-2.5 text-white text-xs font-extrabold rounded-xl transition-all cursor-pointer shadow-sm ${revokeConfirm.step === 1
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-rose-600 hover:bg-rose-700'
                  }`}
              >
                {revokeConfirm.step === 1 ? 'ถัดไป' : 'ยืนยันและระงับสิทธิ์ถาวร'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Modal Popup: เลือกรายชื่อเพื่อนใน LINE */}
      {isFriendPickerOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden scale-in-95 duration-200 animate-in">

            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-emerald-50/70 to-slate-50 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-[#06C755] text-white flex items-center justify-center shrink-0 shadow-sm">
                  <LineIcon className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-black text-slate-900 truncate">
                    เลือกรายชื่อเพื่อนใน LINE
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium truncate">
                    เลือกบัญชีผู้รับเพื่อจำลองการส่งลิงก์เข้าใช้งานหอพัก
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsFriendPickerOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Status Filter Tabs */}
            <div className="p-3 sm:p-4 border-b border-slate-100 space-y-3 bg-white shrink-0">

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={friendSearchQuery}
                  onChange={(e) => setFriendSearchQuery(e.target.value)}
                  placeholder="ค้นหาชื่อ, LINE ID (@...), เบอร์ หรือสถานะ..."
                  className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-slate-50 focus:bg-white transition-all"
                />
                {friendSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setFriendSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filter Chips */}
              <div className="flex items-center gap-1.5">
                {(['ทั้งหมด', 'ผู้เช่า', 'ผู้ดูแล'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setFriendFilterStatus(st)}
                    className={`px-3 py-1.5 rounded-xl font-extrabold text-xs transition-all cursor-pointer ${friendFilterStatus === st
                        ? 'bg-emerald-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

            </div>

            {/* List of Friends */}
            <div className="p-3 sm:p-4 overflow-y-auto space-y-2 flex-1 divide-y divide-slate-100/80">

              {/* Option to clear selection / standard direct link */}
              <button
                type="button"
                onClick={() => {
                  setSelectedLineFriendId('');
                  setIsFriendPickerOpen(false);
                }}
                className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between gap-3 transition-all cursor-pointer ${!selectedLineFriendId
                    ? 'bg-indigo-50/60 border-indigo-200 shadow-2xs'
                    : 'bg-slate-50/60 hover:bg-slate-100 border-slate-200/80'
                  }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-200">
                    <LinkIcon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-slate-900 truncate">
                      — ลิงก์เข้าโดยตรง ไม่ผ่านไลน์ —
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium">
                      สร้างลิงก์สำหรับคัดลอกส่งเองโดยตรง (ไม่ส่งข้อความผ่าน LINE)
                    </p>
                  </div>
                </div>
                {!selectedLineFriendId && (
                  <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>

              {/* Filtered friends list */}
              {effectiveFriends.length === 0 ? (
                <div className="py-10 px-4 text-center space-y-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 my-2">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100">
                    <LineIcon className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-black text-slate-800">ยังไม่มีผู้ติดตามใน LINE OA ของหอพัก</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed max-w-xs mx-auto">
                      กรุณาให้ทีมงานหรือผู้เช่าเพิ่มเพื่อนผ่าน LINE OA ของหอพักก่อน จากนั้นระบบจะแสดงรายชื่อที่นี่โดยอัตโนมัติ
                    </p>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedLineFriendId('');
                        setIsFriendPickerOpen(false);
                      }}
                      className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-extrabold transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                      ใช้ลิงก์เข้าโดยตรง (ไม่ผ่านไลน์)
                    </button>
                  </div>
                </div>
              ) : filteredFriends.length === 0 ? (
                <div className="py-8 text-center space-y-2">
                  <p className="text-xs font-bold text-slate-500">ไม่พบรายชื่อเพื่อนที่ตรงกับเงื่อนไข</p>
                  <p className="text-[11px] text-slate-400">ลองเปลี่ยนคำค้นหาหรือตัวกรองหมวดหมู่</p>
                </div>
              ) : (
                filteredFriends.map((f) => {
                  const isSelected = selectedLineFriendId === f.id;

                  return (
                    <div
                      key={f.id}
                      onClick={() => {
                        setSelectedLineFriendId(f.id);
                        if (f.suggestedRole) {
                          setTokenRole(f.suggestedRole);
                        }
                        setIsFriendPickerOpen(false);
                      }}
                      className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all cursor-pointer mt-1.5 ${isSelected
                          ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-400 shadow-xs'
                          : 'bg-white hover:bg-slate-50 border-slate-150 hover:border-emerald-200'
                        }`}
                    >
                      {/* Left: Avatar / Profile */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-10 h-10 rounded-full ${f.avatarColor} text-white font-black text-sm flex items-center justify-center shrink-0 shadow-2xs ring-2 ring-white`}>
                          {f.name.charAt(0)}
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-black text-slate-900 truncate">
                              {f.name}
                            </span>
                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded-md border border-slate-200">
                              @{f.lineDisplayName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap text-[10px]">
                            <span className={`px-2 py-0.2 rounded-md font-extrabold border ${getStatusBadgeClass(f.status)}`}>
                              {f.status}
                            </span>
                            {f.status !== 'รอลงทะเบียน' && f.phone && (
                              <span className="text-slate-400 font-medium">
                                • {f.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Select indicator */}
                      <div className="shrink-0">
                        {isSelected ? (
                          <span className="w-7 h-7 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-2xs">
                            <Check className="w-4 h-4" />
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 text-[10px] font-bold text-slate-600 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 rounded-lg border border-slate-200 transition-colors">
                            เลือก
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500 font-medium">
                ทั้งหมด {effectiveFriends.length} รายชื่อ
              </span>
              <button
                type="button"
                onClick={() => setIsFriendPickerOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                ปิดหน้าต่าง
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Floating Toast Notification with Smooth Fade */}
      {toast.visible && (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 sm:bottom-8 sm:right-8 sm:left-auto sm:translate-x-0 z-[9999] px-4.5 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold transition-all duration-500 ease-in-out ${isToastFading
              ? 'opacity-0 translate-y-3 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-bottom-3 duration-300'
            } ${toast.type === 'error'
              ? 'bg-rose-50/95 border-rose-200 text-rose-800'
              : 'bg-white border-slate-200/90 text-slate-800'
            }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4.5 h-4.5 text-rose-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

    </div>
  );
};
