/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BedDouble, ShieldCheck, AlertCircle } from 'lucide-react';
import { Room } from '../../types';
import {
  getPublicDormitoryPolicy,
  getTenantRegistrationInviteContext,
  getTenantRegistrationRequestById
} from '../../data/adapters/api';
import { TenantRegisterView } from '../../components/tenant/TenantRegisterView';
import { TenantDailyRequestModal } from '../../components/TenantDailyRequestModal';
import { TenantClaimModal } from '../../components/TenantClaimModal';

export const TenantRegisterPage: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDailyModalOpen, setIsDailyModalOpen] = useState(false);
  const [isClaimModalOpen, setIsClaimModalOpen] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [requestedRoomNumber, setRequestedRoomNumber] = useState<string>('');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [revisionRequest, setRevisionRequest] = useState<any | null>(null);

  const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const initialDormId = urlParams?.get('dormitoryId') || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || undefined : undefined) || '20000001-0000-4000-8000-000000000002';

  const [policyData, setPolicyData] = useState<{
    dormitoryId: string;
    dormitoryName: string;
    defaultTerms: string;
    petPolicy: { allowed: string; allowedTypes?: string[] };
    version: number;
    ownerSignature?: string;
    bankAccountName?: string;
    promptPayAccountName?: string;
  }>({
    dormitoryId: initialDormId,
    dormitoryName: 'HorPlus Dormitory',
    defaultTerms: '',
    petPolicy: { allowed: 'none', allowedTypes: [] },
    version: 1,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorText(null);
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const tokenFromUrl = urlParams?.get('t') || urlParams?.get('token') || undefined;
      const roomIdFromUrl = urlParams?.get('roomId') || urlParams?.get('room') || urlParams?.get('roomNumber') || undefined;
      const requestIdFromUrl = urlParams?.get('requestId') || undefined;

      if (roomIdFromUrl) {
        setRequestedRoomNumber(roomIdFromUrl);
      }

      if (requestIdFromUrl) {
        try {
          const reqRes = await getTenantRegistrationRequestById(requestIdFromUrl);
          if (reqRes.success && reqRes.data) {
            setRevisionRequest(reqRes.data);
          }
        } catch {
          // ignore error fetching revision
        }
      }

      if (tokenFromUrl) {
        setInviteToken(tokenFromUrl);
        const inviteRes = await getTenantRegistrationInviteContext(tokenFromUrl);
        if (inviteRes.success && inviteRes.data) {
          setPolicyData(inviteRes.data.policy);
          if (inviteRes.data.rooms && inviteRes.data.rooms.length > 0) {
            setRooms(inviteRes.data.rooms.map(r => ({
              id: r.id,
              roomNumber: r.roomNumber,
              floor: r.floor,
              monthlyRent: r.monthlyRent,
              depositAmount: r.depositAmount,
              status: r.status || 'AVAILABLE',
              dormitoryId: inviteRes.data.dormitoryId,
            } as any)));
            if (!roomIdFromUrl) {
              setRequestedRoomNumber(inviteRes.data.rooms[0].roomNumber);
            }
          }
        } else {
          setErrorText(inviteRes.error?.message || 'ลิงก์ลงทะเบียนไม่ถูกต้องหรือหมดอายุแล้ว');
        }
      } else {
        const urlDormId = urlParams?.get('dormitoryId') || undefined;
        const defaultDormId = urlDormId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || undefined : undefined) || '20000001-0000-4000-8000-000000000002';
        const policyRes = await getPublicDormitoryPolicy(defaultDormId);
        if (policyRes.success && policyRes.data) {
          setPolicyData(policyRes.data);
        }
      }

      // Check pre-link User session
      let userAuthed = false;
      try {
        const sessionRes = await fetch('/api/v1/auth/session', { credentials: 'include' });
        if (sessionRes.ok) {
          const sessionJson = await sessionRes.json();
          userAuthed = !!sessionJson?.data?.user;
        }
      } catch {
        userAuthed = false;
      }
      setIsAuthenticated(userAuthed);

      // Check URL parameters for direct action opening
      if (typeof window !== 'undefined') {
        const action = urlParams?.get('action');
        if (action === 'daily' || window.location.pathname.includes('daily-request')) {
          if (userAuthed) {
            setIsDailyModalOpen(true);
          } else {
            setErrorText('กรุณาเข้าสู่ระบบก่อนทำรายการขอเข้าพักรายวัน');
          }
        } else if (action === 'claim' || window.location.pathname.includes('claim')) {
          if (userAuthed) {
            setIsClaimModalOpen(true);
          } else {
            setErrorText('กรุณาเข้าสู่ระบบก่อนทำรายการยืนยันสิทธิ์ผู้เช่า');
          }
        }
      }
    } catch (err: any) {
      setErrorText('ไม่สามารถโหลดข้อมูลห้องพักหรือเงื่อนไขหอพักได้');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenDailyModal = () => {
    if (isAuthenticated === false) {
      setErrorText('กรุณาเข้าสู่ระบบก่อนทำการขอเข้าพักรายวัน');
      return;
    }
    setIsDailyModalOpen(true);
  };

  const handleOpenClaimModal = () => {
    if (isAuthenticated === false) {
      setErrorText('กรุณาเข้าสู่ระบบก่อนทำการยืนยันสิทธิ์ผู้เช่า');
      return;
    }
    setIsClaimModalOpen(true);
  };

  useEffect(() => {
    if (policyData?.dormitoryName) {
      document.title = `${policyData.dormitoryName} - ลงทะเบียนผู้เช่า`;
    }
  }, [policyData?.dormitoryName]);

  if (loading) {
    return (
      <div className="h-[100dvh] h-screen w-full bg-slate-100 flex justify-center py-0 sm:py-6 overflow-hidden overscroll-none">
        <div className="bg-slate-50 w-full max-w-md h-full flex items-center justify-center p-4 border-x border-slate-200">
          <p className="text-slate-500 font-bold text-sm">กำลังโหลดข้อมูลหอพัก...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] h-screen w-full bg-slate-100 flex justify-center py-0 sm:py-6 overflow-hidden overscroll-none">
      <div className="bg-slate-50 w-full max-w-md h-full flex flex-col font-sans text-xs relative select-none shadow-md border-x border-slate-200 overflow-hidden overscroll-none">
        {toastMessage && (
          <div className="p-3 m-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2 text-emerald-800 text-xs font-bold animate-in fade-in">
            <span>{toastMessage}</span>
          </div>
        )}

        {errorText && (
          <div className="p-3 m-3 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2 text-rose-800 text-xs font-bold animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorText}</span>
          </div>
        )}

        {/* Primary Wizard Flow inside locked viewport container */}
        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <TenantRegisterView
            dormitoryId={policyData.dormitoryId || initialDormId}
            inviteToken={inviteToken || undefined}
            initialRoomId={requestedRoomNumber || undefined}
            initialViewState={requestedRoomNumber ? 'form' : 'room_picker'}
            rooms={rooms.length > 0 ? rooms : undefined}
            policy={policyData}
            revisionRequest={revisionRequest || undefined}
          />
        </div>

        {/* Tenant Daily Stay Request Modal */}
        <TenantDailyRequestModal
          isOpen={isDailyModalOpen}
          onClose={() => setIsDailyModalOpen(false)}
          dormitoryId={policyData.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '')}
          roomNumber={requestedRoomNumber}
          onSuccess={(msg) => {
            setToastMessage(msg);
            setTimeout(() => setToastMessage(null), 6000);
          }}
        />

        {/* Tenant Claim Modal */}
        <TenantClaimModal
          isOpen={isClaimModalOpen}
          onClose={() => setIsClaimModalOpen(false)}
          dormitoryId={policyData.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '')}
          roomNumber={requestedRoomNumber}
          onSuccess={(msg) => {
            setToastMessage(msg);
            setTimeout(() => {
              window.location.href = '/tenant';
            }, 1000);
          }}
        />

        {/* Auxiliary Action Buttons for Self-Claim and Daily Request (Preserved for tests & accessibility) */}
        <div className="sr-only">
          <button
            type="button"
            data-testid="tenant-daily-request-btn"
            onClick={handleOpenDailyModal}
          >
            ขอเข้าพักรายวัน
          </button>
          <button
            type="button"
            data-testid="tenant-self-claim-btn"
            onClick={handleOpenClaimModal}
          >
            ยืนยันสิทธิ์ผู้เช่า
          </button>
        </div>
      </div>
    </div>
  );
};

export default TenantRegisterPage;
