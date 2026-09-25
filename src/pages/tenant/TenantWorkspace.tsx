/**
 * @license Apache-2.0
 * HorPlus Tenant Portal — Main Tenant Workspace Orchestrator
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home,
  FileText,
  User,
  Bell,
  CheckCircle,
  X,
  AlertCircle
} from 'lucide-react';
import {
  Tenant,
  Room,
  Bill,
  Contract,
  MaintenanceRequest as RepairRequest,
  Announcement,
  Building
} from '../../types';
import { httpRequest, getCsrfTokenFromCookie } from '../../data/httpClient';

// Modular Tabs & SubViews
import { TenantHomeTab } from './tabs/TenantHomeTab';
import { TenantAnnouncementsTab } from './tabs/TenantAnnouncementsTab';
import { TenantPaymentsTab } from './tabs/TenantPaymentsTab';
import { TenantProfileTab } from './tabs/TenantProfileTab';
import { TenantInvoiceView } from './views/TenantInvoiceView';
import { TenantPaymentView } from './views/TenantPaymentView';
import { TenantRepairsView } from './views/TenantRepairsView';
import { TenantUtilitiesView } from './views/TenantUtilitiesView';
import { TenantContractView } from './views/TenantContractView';
import { TenantRegisterView } from '../../components/tenant/TenantRegisterView';

// Modular Modals & Switchers
import {
  TenantRoomSwitcherModal,
  TenantAddRoomModal
} from './modals/TenantRoomSwitcherModal';
import { TenantMoveOutModal } from './modals/TenantMoveOutModal';
import { TenantCoOccupantsModal } from './modals/TenantCoOccupantsModal';
import { TenantNotificationModal } from './modals/TenantNotificationModal';
import { TenantDocumentModal } from './modals/TenantDocumentModal';
import { TenantClaimModal } from '../../components/TenantClaimModal';
import { sanitizeClaimInput } from '../../utils/claim-sanitizer';
import { compressImage, openTenantContractPrintWindow, openTenantIdCardPrintWindow } from './tenantHelpers';

export interface TenantWorkspaceProps {
  tenant: Tenant;
  onLogout: () => void;
  initialAddRoomModalOpen?: boolean;
}

export const TenantWorkspace: React.FC<TenantWorkspaceProps> = ({
  tenant,
  onLogout,
  initialAddRoomModalOpen = false,
}) => {
  if (!tenant) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-6 text-center">
        <p className="text-slate-500 font-bold mb-4">ไม่พบข้อมูลผู้เช่า หรือเซสชันหมดอายุ</p>
        <button
          onClick={onLogout}
          className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black shadow-md cursor-pointer"
        >
          กลับสู่หน้าหลัก
        </button>
      </div>
    );
  }

  const location = useLocation();
  const navigate = useNavigate();

  const pathSeg = location.pathname.split('/')[2] || 'dashboard';
  const searchParams = new URLSearchParams(location.search);
  const querySub = searchParams.get('tab') || searchParams.get('sub');

  const mapPathToState = (seg: string) => {
    if (seg === 'announcements' || querySub === 'announcements')
      return { tab: 'announcements' as const, sub: null };
    if (seg === 'profile' || querySub === 'profile')
      return { tab: 'profile' as const, sub: null };
    if (seg === 'payments_tab' || querySub === 'payments_tab')
      return { tab: 'payments_tab' as const, sub: null };

    if (seg === 'bills' || seg === 'invoice' || querySub === 'bills' || querySub === 'invoice')
      return { tab: 'home' as const, sub: 'invoice' as const };
    if (seg === 'payments' || seg === 'pay' || querySub === 'pay' || querySub === 'payment')
      return { tab: 'home' as const, sub: 'payment' as const };
    if (seg === 'maintenance' || seg === 'repairs' || querySub === 'repairs')
      return { tab: 'home' as const, sub: 'repairs' as const };
    if (seg === 'contract' || querySub === 'contract')
      return { tab: 'home' as const, sub: 'contract' as const };
    if (seg === 'utilities' || querySub === 'utilities')
      return { tab: 'home' as const, sub: 'utilities' as const };
    if (seg === 'register' || seg === 'registration' || querySub === 'register') {
      const isPendingOrActive =
        tenant?.hasRoom ||
        tenant?.status === 'active' ||
        tenant?.status === 'pending_owner_approval' ||
        (tenant as any)?.pendingRequest?.status === 'pending_owner_approval' ||
        tenant?.status === 'approved' ||
        (tenant as any)?.pendingRequest?.status === 'approved';

      if (isPendingOrActive) {
        return { tab: 'home' as const, sub: null };
      }
      return { tab: 'home' as const, sub: 'register' as const };
    }

    return { tab: 'home' as const, sub: null };
  };

  const initialState = mapPathToState(pathSeg);
  const [activeTab, setActiveTab] = useState<'home' | 'announcements' | 'payments_tab' | 'profile'>(
    initialState.tab
  );
  const [subView, setSubView] = useState<
    null | 'invoice' | 'payment' | 'pay' | 'repairs' | 'utilities' | 'contract' | 'register'
  >(initialState.sub);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [isToastFading, setIsToastFading] = useState(false);

  useEffect(() => {
    const nextState = mapPathToState(pathSeg);
    setActiveTab(nextState.tab);
    setSubView(nextState.sub);
  }, [pathSeg]);

  // Data layers
  const [rooms, setRooms] = useState<Room[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [financialLoading, setFinancialLoading] = useState<boolean>(true);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [repairs, setRepairs] = useState<RepairRequest[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);

  // Multi-room management states
  const [tenantRooms, setTenantRooms] = useState<any[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(() => {
    return typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem('tenant_selected_room_id')
      : null;
  });
  const [isRoomSwitcherOpen, setIsRoomSwitcherOpen] = useState(false);
  const [isAddRoomModalOpen, setIsAddRoomModalOpen] = useState(initialAddRoomModalOpen);
  const [addRoomStep, setAddRoomStep] = useState<'select' | 'request_approval'>('select');
  const [isCheckingRoomClaim, setIsCheckingRoomClaim] = useState(false);
  const [availableVacantRooms, setAvailableVacantRooms] = useState<any[]>([]);
  const [loadingVacantRooms, setLoadingVacantRooms] = useState(false);
  const [selectedVacantRoomId, setSelectedVacantRoomId] = useState('');
  const [vacantAgreedTerms, setVacantAgreedTerms] = useState(false);
  const [isSubmittingVacantRequest, setIsSubmittingVacantRequest] = useState(false);
  const [claimRoomNumberInput, setClaimRoomNumberInput] = useState('');
  const [isClaimModalActive, setIsClaimModalActive] = useState(false);
  const [utilitiesData, setUtilitiesData] = useState<any>(null);

  // Local tenant state to handle co-occupants editing reactively
  const [localTenant, setLocalTenant] = useState<Tenant>(tenant);
  const [isCoOccupantsModalOpen, setIsCoOccupantsModalOpen] = useState(false);
  const [editCoOccupants, setEditCoOccupants] = useState<any[]>([]);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [coOccupantsError, setCoOccupantsError] = useState('');
  const [deleteConfirmCoId, setDeleteConfirmCoId] = useState<string | null>(null);
  const [isAddingCo, setIsAddingCo] = useState(false);
  const [isDeletingCo, setIsDeletingCo] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    title: string;
    message: string;
    visible: boolean;
  } | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isSubmittingSlip, setIsSubmittingSlip] = useState(false);
  const [isSubmittingRepair, setIsSubmittingRepair] = useState(false);
  const [isCancellingRepairId, setIsCancellingRepairId] = useState<string | null>(null);
  const [paymentOptions, setPaymentOptions] = useState<{
    configured?: boolean;
    promptPayConfigured?: boolean;
    bankTransferConfigured?: boolean;
    promptPayType?: string | null;
    promptPayDisplay?: string | null;
    promptPayAccountName?: string | null;
    qrUrl?: string | null;
    bankCode?: string | null;
    bankAccountName?: string | null;
    bankAccountNumber?: string | null;
    bankQrCode?: string | null;
    targetAmount?: string;
  } | null>(null);

  // Move-out request state
  const [isMoveOutModalOpen, setIsMoveOutModalOpen] = useState(false);
  const [moveOutDate, setMoveOutDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [moveOutBank, setMoveOutBank] = useState('');
  const [moveOutAccount, setMoveOutAccount] = useState('');
  const [moveOutReason, setMoveOutReason] = useState('');
  const [moveOutRequest, setMoveOutRequest] = useState<any>(null);

  // Document viewing / downloading state
  const [dormitoryInfo, setDormitoryInfo] = useState<any>(null);
  const [selectedDocModal, setSelectedDocModal] = useState<{
    title: string;
    subtitle: string;
    category: string;
    fileName: string;
    content: string;
    docType?: string;
    docId?: string;
  } | null>(null);

  // Notifications modal state
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);

  // Renewal & persistent notices state
  const [notices, setNotices] = useState<any[]>([]);
  const [renewalEligibility, setRenewalEligibility] = useState<{
    isEligible: boolean;
    eligibleContract?: any;
    blockingReason?: string;
    activeRenewalRequest?: any;
  } | null>(null);
  const [requestedStartDate, setRequestedStartDate] = useState('');
  const [requestedDurationMonths, setRequestedDurationMonths] = useState(6);
  const [isSubmittingRenewal, setIsSubmittingRenewal] = useState(false);

  // Invoice & Repairs state
  const [invoiceTab, setInvoiceTab] = useState<'current' | 'history'>('current');
  const [selectedInvoiceBillId, setSelectedInvoiceBillId] = useState<string | null>(null);
  const [selectedPaymentBillIds, setSelectedPaymentBillIds] = useState<string[]>([]);
  const [repairTab, setRepairTab] = useState<'mine' | 'history'>('mine');
  const [isNewRepairOpen, setIsNewRepairOpen] = useState(false);
  const [repairTitle, setRepairTitle] = useState('');
  const [repairDesc, setRepairDesc] = useState('');
  const [repairImage, setRepairImage] = useState<string | null>(null);
  const [repairImageName, setRepairImageName] = useState<string | null>(null);
  const [dormitoryPetPolicy, setDormitoryPetPolicy] = useState<any>(null);
  const repairFileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (type: 'success' | 'error', title: string, message: string) => {
    setToast({ type, title, message, visible: true });
  };

  useEffect(() => {
    if (toast?.visible) {
      setIsToastFading(false);
      const fadeTimer = setTimeout(() => {
        setIsToastFading(true);
      }, 2900);
      const removeTimer = setTimeout(() => {
        setToast((prev) => (prev ? { ...prev, visible: false } : null));
        setIsToastFading(false);
      }, 3500);

      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [toast?.visible]);

  const refreshData = async (targetRoomId?: string) => {
    setFinancialLoading(true);
    setFinancialError(null);

    const activeRoomId = targetRoomId || selectedRoomId;
    const reqHeaders: Record<string, string> = {};
    if (activeRoomId) {
      reqHeaders['x-room-id'] = activeRoomId;
    }

    try {
      // 1. Fetch all tenant active rooms
      const roomsRes = await fetch('/api/v1/tenant-portal/rooms', { credentials: 'include', headers: reqHeaders });
      let currentActiveRoomId = activeRoomId;
      if (roomsRes.ok) {
        const roomsJson = await roomsRes.json();
        const loadedRooms = Array.isArray(roomsJson.rooms) ? roomsJson.rooms : [];
        setTenantRooms(loadedRooms);
        if (loadedRooms.length > 0) {
          if (!currentActiveRoomId || !loadedRooms.some((r: any) => r.roomId === currentActiveRoomId)) {
            currentActiveRoomId = loadedRooms[0].roomId;
            setSelectedRoomId(currentActiveRoomId);
            if (typeof sessionStorage !== 'undefined') {
              sessionStorage.setItem('tenant_selected_room_id', currentActiveRoomId);
            }
          }
          reqHeaders['x-room-id'] = currentActiveRoomId;
        } else {
          currentActiveRoomId = '';
          setSelectedRoomId('');
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem('tenant_selected_room_id');
          }
          delete reqHeaders['x-room-id'];
        }
      }
    } catch (err) {
      console.warn('Could not fetch tenant rooms:', err);
    }

    try {
      const profileRes = await fetch('/api/v1/tenant-portal/profile', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (profileRes.ok) {
        const profile = await profileRes.json();
        if (profile) {
          const profileName =
            profile.displayName ||
            `${profile.firstName || ''} ${profile.lastName || ''}`.trim() ||
            'ผู้เช่า';
          setLocalTenant((prev: any) => ({
            ...prev,
            id: profile.id || prev?.id || '',
            name: profileName,
            dormitoryId: profile.dormitory?.id || profile.dormitoryId || prev?.dormitoryId,
            dormitory: profile.dormitory || prev?.dormitory,
            status: profile.status || prev?.status,
            pendingRequest: profile.pendingRequest ?? null,
            registrationRequestStatus: profile.pendingRequest?.status || profile.status || null,
            phone: profile.phone || prev?.phone || '-',
            citizenId: profile.citizenId || profile.nationalIdMasked || prev?.citizenId || '-',
            email: profile.email || prev?.email || '-',
            hasIdentityDocument: profile.hasIdentityDocument ?? prev?.hasIdentityDocument ?? false,
            idCardPhotoMock: profile.idCardPhotoMock || prev?.idCardPhotoMock || null,
            idCardPhotoUrl: profile.idCardPhotoUrl || prev?.idCardPhotoUrl || null,
            emergencyContact: profile.emergencyContact || prev?.emergencyContact || null,
            emergencyContacts: profile.emergencyContacts || prev?.emergencyContacts || [],
            vehicle: profile.vehicle || prev?.vehicle || null,
            vehicles: profile.vehicles || prev?.vehicles || (profile.vehicle ? [profile.vehicle] : []),
            pet: profile.pet || prev?.pet || { hasPet: false, type: '', name: '' },
            pets: profile.pets || prev?.pets || (profile.pet?.hasPet ? [profile.pet] : []),
            coOccupants: profile.coOccupants || prev?.coOccupants || [],
            address: profile.address || prev?.address || '-',
            birthDate: profile.birthDate || prev?.birthDate || undefined,
          }));
          if (profile.dormitory) {
            setDormitoryInfo(profile.dormitory);
            if (profile.dormitory.petPolicy) {
              setDormitoryPetPolicy(profile.dormitory.petPolicy);
            }
          }
          setMoveOutRequest(
            profile.moveOutRequest
              ? {
                  ...profile.moveOutRequest,
                  desiredDate:
                    profile.moveOutRequest.intendedMoveOutDate ||
                    profile.moveOutRequest.desiredDate ||
                    profile.moveOutRequest.moveOutDate,
                  bankInfo: profile.moveOutRequest.refundBankName || profile.moveOutRequest.bankInfo,
                  accountInfo: profile.moveOutRequest.refundAccountNumber
                    ? `${profile.moveOutRequest.refundAccountNumber} (${profile.moveOutRequest.refundAccountName || ''})`
                    : profile.moveOutRequest.accountInfo,
                }
              : null
          );
        }
        if (
          profile.room ||
          profile.hasRoom ||
          profile.status === 'active' ||
          profile.pendingRequest?.status === 'approved' ||
          profile.pendingRequest?.status === 'pending_owner_approval' ||
          profile.status === 'pending_owner_approval'
        ) {
          setSubView((prev) => (prev === 'register' ? null : prev));
          if (profile.room) {
            setRooms([
              {
                id: profile.room.id,
                roomNumber: profile.room.roomNumber,
                buildingId: profile.room.buildingId,
                currentTenantId: profile.id,
              } as any,
            ]);
          }
          if (profile.status === 'active' || profile.hasRoom || profile.pendingRequest?.status === 'approved') {
            try {
              localStorage.removeItem('pending_tenant_registration');
            } catch {}
          }
          // Clean query params (?sub=register, t, token) if present
          if (typeof window !== 'undefined') {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('sub') === 'register' || sp.has('t') || sp.has('token')) {
              navigate('/tenant', { replace: true });
            }
          }
        } else {
          setRooms([]);
          if (!profile.pendingRequest && (profile.status === 'unregistered' || !profile.status)) {
            try {
              localStorage.removeItem('pending_tenant_registration');
            } catch {}
          }
        }
      } else {
        setRooms([]);
        setFinancialError('ไม่สามารถโหลดข้อมูลผู้เช่าจากระบบได้');
        console.error('[TenantPortal] Technical error loading profile status:', profileRes.status);
      }
    } catch (e: any) {
      setRooms([]);
      setFinancialError('ไม่สามารถเชื่อมต่อระบบเพื่อดึงข้อมูลผู้เช่าได้');
      console.error('[TenantPortal] Technical error loading profile:', e?.message || 'Network error');
    }

    setContracts([]);
    setRepairs([]);
    setAnnouncements([]);
    setBuildings([]);

    try {
      const ctrRes = await fetch('/api/v1/tenant-portal/contract', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (ctrRes.ok) {
        const ctrJson = await ctrRes.json();
        if (ctrJson.data) {
          const ctrData = ctrJson.data;
          const activeContract = {
            id: ctrData.id,
            contractNumber: ctrData.contractNumber,
            dormitoryId: ctrData.dormitoryId,
            tenantId: tenant.id,
            roomId: ctrData.roomId || '',
            roomNumber: ctrData.roomNumber,
            startDate: ctrData.startDate,
            endDate: ctrData.endDate,
            durationMonths: ctrData.durationMonths || 6,
            rentBillingType: ctrData.rentBillingType || 'monthly',
            monthlyRent: Number(ctrData.rentAmount || 5000),
            rentAmount: Number(ctrData.rentAmount || 5000),
            depositAmount: Number(ctrData.depositAmount || 10000),
            terms: ctrData.terms || undefined,
            tenantSignature: ctrData.tenantSignature || null,
            ownerSignature: ctrData.ownerSignature || null,
            signedByTenantAt: ctrData.signedByTenantAt || null,
            signedByOwnerAt: ctrData.signedByOwnerAt || null,
            occupantCount: 1 + Number(ctrData.coOccupantsCount || 0),
            status: ctrData.status || 'active',
          };
          setContracts([activeContract as any]);

          httpRequest<any>(
            'GET',
            `/api/v1/contract-renewals/eligibility?contractId=${activeContract.id}`
          )
            .then((res) => {
              const elig = res?.data || res;
              setRenewalEligibility(elig);
              const rawEnd = elig?.eligibleContract?.endDate || elig?.contract?.endDate || activeContract.endDate;
              if (rawEnd) {
                const str = String(rawEnd).split('T')[0];
                const [y, m, d] = str.split('-').map(Number);
                if (y && m && d) {
                  setRequestedStartDate(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().split('T')[0]);
                } else {
                  setRequestedStartDate(str);
                }
              }
            })
            .catch(() => setRenewalEligibility(null));
        }
      }
    } catch (e) {}

    try {
      const res = await fetch('/api/v1/tenant-portal/bills', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          const rawBills = Array.isArray(json.data) ? json.data : json.data.bills || [];
          const formatted = rawBills.map((b: any) => ({
            ...b,
            totalAmount: Number(b.totalAmount),
            paidAmount: Number(b.paidAmount),
            outstandingAmount: Number(b.outstandingAmount),
            items: (b.items || []).map((i: any) => ({ ...i, amount: Number(i.amount) })),
          }));
          setBills(formatted);
        } else {
          setBills([]);
        }
      } else {
        setBills([]);
        setFinancialError('ไม่สามารถโหลดข้อมูลบิลจากระบบได้');
        console.error('[TenantPortal] Technical error loading bills status:', res.status);
      }
    } catch (err: any) {
      setBills([]);
      setFinancialError('ไม่สามารถเชื่อมต่อระบบเพื่อดึงข้อมูลบิลได้');
      console.error('[TenantPortal] Technical error loading bills:', err?.message || 'Network error');
    }

    try {
      const utilRes = await fetch('/api/v1/tenant-portal/utilities', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (utilRes.ok) {
        const utilJson = await utilRes.json();
        if (utilJson.data) {
          setUtilitiesData(utilJson.data);
        }
      }
    } catch (e) {}

    try {
      const repRes = await fetch('/api/v1/tenant-portal/maintenance', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (repRes.ok) {
        const repJson = await repRes.json();
        const loadedRepairs = Array.isArray(repJson.data)
          ? repJson.data
          : Array.isArray(repJson.requests)
            ? repJson.requests
            : Array.isArray(repJson)
              ? repJson
              : [];
        setRepairs(loadedRepairs);
      }
    } catch (e) {}

    try {
      const annRes = await fetch('/api/v1/tenant-portal/announcements', {
        credentials: 'include',
        headers: reqHeaders,
      });
      if (annRes.ok) {
        const annJson = await annRes.json();
        const loadedAnnouncements = Array.isArray(annJson.data)
          ? annJson.data
          : Array.isArray(annJson.announcements)
            ? annJson.announcements
            : Array.isArray(annJson)
              ? annJson
              : [];
        setAnnouncements(loadedAnnouncements);
      }
    } catch (e) {}

    setFinancialLoading(false);
  };

  const loadAvailableVacantRooms = async () => {
    setLoadingVacantRooms(true);
    try {
      const res = await httpRequest<any>('GET', '/api/v1/tenant-portal/available-rooms');
      const list = Array.isArray(res?.data) ? res.data : [];
      setAvailableVacantRooms(list);
    } catch (e) {
      setAvailableVacantRooms([]);
    } finally {
      setLoadingVacantRooms(false);
    }
  };

  useEffect(() => {
    if (initialAddRoomModalOpen) {
      loadAvailableVacantRooms();
    }
  }, [initialAddRoomModalOpen]);

  const handleCheckAndProceed = async () => {
    if (!selectedVacantRoomId) {
      showToast('error', 'กรุณาเลือกห้องพัก', 'กรุณาเลือกห้องว่างที่ต้องการเช่า');
      return;
    }

    const targetRoom = availableVacantRooms.find((r: any) => r.id === selectedVacantRoomId);
    if (!targetRoom) return;

    setIsCheckingRoomClaim(true);
    try {
      const dormId =
        tenantRoom?.dormitoryId ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');

      const tryClaimWithInput = async (input: string): Promise<boolean> => {
        if (!input || input === '-') return false;
        try {
          const res = await httpRequest<any>(
            'POST',
            '/api/v1/tenant-claims/claim',
            {
              dormitoryId: dormId,
              roomId: selectedVacantRoomId,
              roomNumber: targetRoom.roomNumber,
              claimInput: input.trim(),
              allowAdditionalRoom: true,
            },
            {
              headers: dormId ? { 'x-dormitory-id': dormId } : undefined,
            }
          );
          return !!(res?.success || res?.data?.success || res?.data?.id);
        } catch (_err) {
          return false;
        }
      };

      // 1. Attempt smart instant claim (Case A): Match phone first, then name
      let claimSuccess = false;
      if (localTenant.phone && localTenant.phone !== '-') {
        claimSuccess = await tryClaimWithInput(localTenant.phone);
      }
      if (!claimSuccess && localTenant.name && localTenant.name !== '-') {
        claimSuccess = await tryClaimWithInput(localTenant.name);
      }

      if (claimSuccess) {
        showToast('success', 'ยืนยันสิทธิ์ห้องพักสำเร็จ!', 'เพิ่มห้องพักเข้าสู่ระบบแล้ว');
        setIsAddRoomModalOpen(false);
        setAddRoomStep('select');
        setSelectedVacantRoomId('');
        setSelectedRoomId(selectedVacantRoomId);
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('tenant_selected_room_id', selectedVacantRoomId);
        }
        await refreshData(selectedVacantRoomId);
        return;
      }

      // Case B: Not yet pre-added / data does not match -> Go to approval request step
      setAddRoomStep('request_approval');
    } catch (_err) {
      // Fallback to request approval
      setAddRoomStep('request_approval');
    } finally {
      setIsCheckingRoomClaim(false);
    }
  };

  const handleSubmitVacantRoomRequest = async () => {
    if (!selectedVacantRoomId) return;
    setIsSubmittingVacantRequest(true);
    try {
      const nameParts = (localTenant.name || '').trim().split(' ');
      const firstName = nameParts[0] || 'ผู้เช่า';
      const lastName = nameParts.slice(1).join(' ') || '-';

      const canvas = document.createElement('canvas');
      canvas.width = 300;
      canvas.height = 100;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 300, 100);
        ctx.fillStyle = '#1e1b4b';
        ctx.font = 'bold 20px sans-serif';
        ctx.fillText(localTenant.name, 20, 55);
      }
      const signatureBase64 = canvas.toDataURL('image/png');

      const targetRoom = availableVacantRooms.find((r: any) => r.id === selectedVacantRoomId);
      const dormId =
        tenantRoom?.dormitoryId ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');

      // Dynamic policy version resolution (handles multi-version dormitories e.g. version 8):
      let policyVersion = Number(targetRoom?.policyVersion);
      if (!policyVersion || isNaN(policyVersion)) {
        try {
          const policyRes = await httpRequest<any>(
            'GET',
            `/api/v1/tenant-registrations/public-policy?dormitoryId=${dormId}`,
            undefined,
            { headers: dormId ? { 'x-dormitory-id': dormId } : undefined }
          );
          policyVersion = Number(policyRes?.data?.version ?? policyRes?.version ?? 1);
        } catch (_err) {
          policyVersion = 1;
        }
      }

      const payload: any = {
        dormitoryId: dormId || undefined,
        requestedRoomId: selectedVacantRoomId,
        firstName,
        lastName,
        phone: localTenant.phone && localTenant.phone !== '-' ? localTenant.phone : '0812345678',
        citizenId: (localTenant as any).citizenId && (localTenant as any).citizenId !== '-' ? (localTenant as any).citizenId : undefined,
        address: (localTenant as any).address && (localTenant as any).address !== '-' ? (localTenant as any).address : undefined,
        birthDate: (localTenant as any).birthDate || undefined,
        proposedRent: targetRoom?.monthlyRent,
        rentalPlan: 'monthly',
        agreedTerms: true,
        signatureBase64,
        expectedPolicyVersion: policyVersion,
        note: `คำขอเช่าห้องพักเพิ่มจากผู้เช่าปัจจุบัน (คุณ${localTenant.name})`,
      };

      try {
        await httpRequest('POST', '/api/v1/tenant-registrations', payload, {
          headers: dormId ? { 'x-dormitory-id': dormId } : undefined,
        });
      } catch (submitErr: any) {
        // Self-healing retry if policy version mismatch occurs (409)
        const isMismatch =
          submitErr?.domainError?.code === 'POLICY_VERSION_MISMATCH' ||
          submitErr?.message?.includes('กฎระเบียบหรือเงื่อนไข');

        if (isMismatch) {
          try {
            const freshPolicyRes = await httpRequest<any>(
              'GET',
              `/api/v1/tenant-registrations/public-policy?dormitoryId=${dormId}`,
              undefined,
              { headers: dormId ? { 'x-dormitory-id': dormId } : undefined }
            );
            const freshVersion = Number(freshPolicyRes?.data?.version ?? freshPolicyRes?.version ?? 1);
            payload.expectedPolicyVersion = freshVersion;
            await httpRequest('POST', '/api/v1/tenant-registrations', payload, {
              headers: dormId ? { 'x-dormitory-id': dormId } : undefined,
            });
          } catch (retryErr: any) {
            throw retryErr;
          }
        } else {
          throw submitErr;
        }
      }

      showToast(
        'success',
        'ส่งคำขอสำเร็จ',
        'ส่งคำขอเช่าห้องพักเรียบร้อยแล้ว กรุณารอเจ้าของหอพักตรวจสอบและอนุมัติ (จะมีการแจ้งเตือนทาง LINE)'
      );
      setIsAddRoomModalOpen(false);
      setSelectedVacantRoomId('');
      setVacantAgreedTerms(false);
      setAddRoomStep('select');
    } catch (err: any) {
      showToast('error', 'ไม่สามารถส่งคำขอได้', err?.message || 'เกิดข้อผิดพลาดในการส่งคำขอ');
    } finally {
      setIsSubmittingVacantRequest(false);
    }
  };

  useEffect(() => {
    refreshData();
    setLocalTenant(tenant);

    // Fetch persistent notices for tenant
    httpRequest<any>('GET', '/api/v1/tenant-portal/notices')
      .then((res: any) => {
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
        setNotices(list);
      })
      .catch(() => setNotices([]));
  }, [tenant]);

  // Visibilitychange and focus sync (no polling loop, scalable for 10,000 dorms)
  useEffect(() => {
    const isPending = Boolean(
      (localTenant as any)?.status === 'pending_owner_approval' ||
      (localTenant as any)?.pendingRequest?.status === 'pending_owner_approval' ||
      (typeof window !== 'undefined' && window.localStorage?.getItem?.('pending_tenant_registration'))
    );

    if (!isPending) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshData();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [localTenant?.status, (localTenant as any)?.pendingRequest?.status]);

  // Guard against pending registration staying in subView register
  useEffect(() => {
    const isPending =
      localTenant?.status === 'pending_owner_approval' ||
      (localTenant as any)?.pendingRequest?.status === 'pending_owner_approval';
    if (isPending && subView === 'register') {
      setSubView(null);
      if (typeof window !== 'undefined') {
        const sp = new URLSearchParams(window.location.search);
        if (sp.get('sub') === 'register' || sp.has('t') || sp.has('token')) {
          navigate('/tenant', { replace: true });
        }
      }
    }
  }, [localTenant?.status, (localTenant as any)?.pendingRequest?.status, subView, navigate]);

  const handleMarkNoticeAsRead = async (noticeId: string) => {
    try {
      await httpRequest('POST', `/api/v1/tenant-portal/notices/${noticeId}/read`);
      setNotices((prev) =>
        prev.map((n) => (n.id === noticeId ? { ...n, isRead: true } : n))
      );
    } catch (e) {}
  };

  const handleSubmitRenewal = async () => {
    const activeCtr =
      tenantContracts.find(
        (c) => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'expired'
      ) || (tenantContracts.length > 0 ? tenantContracts[0] : null);
    if (!activeCtr) {
      showToast('error', 'ไม่พบข้อมูลสัญญา', 'ไม่พบข้อมูลสัญญาเช่าเดิมสำหรับการต่อสัญญา');
      return;
    }
    const minNextDate = activeCtr.endDate
      ? (() => {
          const str = String(activeCtr.endDate).split('T')[0];
          const [y, m, d] = str.split('-').map(Number);
          return y && m && d
            ? new Date(Date.UTC(y, m - 1, d + 1)).toISOString().split('T')[0]
            : str;
        })()
      : '';
    const effectiveStartDate =
      requestedStartDate && (!minNextDate || requestedStartDate >= minNextDate)
        ? requestedStartDate
        : minNextDate || requestedStartDate;
    if (!effectiveStartDate) return;

    setIsSubmittingRenewal(true);
    try {
      await httpRequest('POST', '/api/v1/contract-renewals/request', {
        dormitoryId: activeCtr.dormitoryId || localTenant?.dormitoryId || tenant.dormitoryId,
        contractId: activeCtr.id,
        requestedStartDate: effectiveStartDate,
        requestedDurationMonths: Number(requestedDurationMonths || 6),
      });
      showToast(
        'success',
        'ส่งคำขอต่อสัญญาสำเร็จ',
        'คำขอต่อสัญญาเช่าของคุณถูกส่งไปยังผู้ดูแลหอพักเรียบร้อยแล้ว'
      );
      const updatedElig: any = await httpRequest(
        'GET',
        `/api/v1/contract-renewals/eligibility?contractId=${activeCtr.id}`
      );
      setRenewalEligibility(updatedElig?.data || updatedElig);
    } catch (err: any) {
      showToast('error', 'ไม่สามารถส่งคำขอได้', err.message || 'เกิดข้อผิดพลาดในการส่งคำขอต่อสัญญา');
    } finally {
      setIsSubmittingRenewal(false);
    }
  };

  const [isCancellingRenewal, setIsCancellingRenewal] = useState(false);
  const handleCancelRenewal = async () => {
    const pendingId =
      renewalEligibility?.pendingRequest?.id ||
      renewalEligibility?.activeRenewalRequest?.id ||
      renewalEligibility?.requestId;
    if (!pendingId) {
      showToast('error', 'ไม่พบคำขอ', 'ไม่พบรหัสคำขอต่อสัญญาที่ต้องการยกเลิก');
      return;
    }
    setIsCancellingRenewal(true);
    try {
      await httpRequest('POST', `/api/v1/contract-renewals/requests/${pendingId}/cancel`, {});
      showToast('success', 'ยกเลิกคำขอสำเร็จ', 'ยกเลิกคำขอต่อสัญญาเรียบร้อยแล้ว');
      const activeCtr =
        tenantContracts.find(
          (c) => c.status === 'active' || c.status === 'expiring_soon' || c.status === 'expired'
        ) || (tenantContracts.length > 0 ? tenantContracts[0] : null);
      if (activeCtr) {
        const updatedElig: any = await httpRequest(
          'GET',
          `/api/v1/contract-renewals/eligibility?contractId=${activeCtr.id}`
        );
        setRenewalEligibility(updatedElig?.data || updatedElig);
      }
    } catch (err: any) {
      showToast('error', 'ไม่สามารถยกเลิกคำขอได้', err.message || 'เกิดข้อผิดพลาดในการยกเลิกคำขอ');
    } finally {
      setIsCancellingRenewal(false);
    }
  };

  const handleOpenCoOccupantsModal = () => {
    setEditCoOccupants([...localTenant.coOccupants]);
    setNewCoName('');
    setNewCoPhone('');
    setCoOccupantsError('');
    setDeleteConfirmCoId(null);
    setIsCoOccupantsModalOpen(true);
  };

  const handleAddCoOccupant = async () => {
    if (!newCoName.trim()) {
      setCoOccupantsError('กรุณากรอกชื่อ-นามสกุล หรือชื่อเล่นของผู้พักร่วม');
      return;
    }
    const cleanPhone = newCoPhone.trim().replace(/[-\s]/g, '');
    if (cleanPhone && !/^0\d{8,9}$/.test(cleanPhone)) {
      setCoOccupantsError('เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก (ขึ้นต้นด้วย 0)');
      return;
    }
    setCoOccupantsError('');
    setIsAddingCo(true);
    try {
      const res = await httpRequest<any>('POST', '/api/v1/tenant-portal/co-occupants', {
        name: newCoName.trim(),
        phone: newCoPhone.trim() || undefined,
      });
      const newCo = res?.data || res;
      setEditCoOccupants((prev) => [...prev, newCo]);
      setLocalTenant((prev) => ({
        ...prev,
        coOccupants: [...(prev.coOccupants || []), newCo],
      }));
      setNewCoName('');
      setNewCoPhone('');
      showToast('success', 'เพิ่มผู้พักร่วมสำเร็จ', `เพิ่มคุณ ${newCo.name} เรียบร้อยแล้ว`);
      refreshData();
    } catch (err: any) {
      const fieldMsg = err?.fieldErrors?.[0]?.message;
      const errMsg = fieldMsg || err?.error?.message || err?.message || 'เกิดข้อผิดพลาดในการเพิ่มผู้พักร่วม';
      setCoOccupantsError(errMsg);
      showToast('error', 'ไม่สามารถเพิ่มผู้พักร่วมได้', errMsg);
    } finally {
      setIsAddingCo(false);
    }
  };

  const handleConfirmRemoveCoOccupant = async (coId: string, coName: string) => {
    setIsDeletingCo(true);
    try {
      await httpRequest<any>('DELETE', `/api/v1/tenant-portal/co-occupants/${coId}`);
      setEditCoOccupants((prev) => prev.filter((c) => c.id !== coId));
      setLocalTenant((prev) => ({
        ...prev,
        coOccupants: (prev.coOccupants || []).filter((c) => c.id !== coId),
      }));
      setDeleteConfirmCoId(null);
      showToast('success', 'ลบผู้พักร่วมสำเร็จ', `นำคุณ ${coName} ออกจากรายการเรียบร้อยแล้ว`);
      refreshData();
    } catch (err: any) {
      showToast('error', 'ไม่สามารถลบผู้พักร่วมได้', err.message || 'เกิดข้อผิดพลาดในการลบผู้พักร่วม');
    } finally {
      setIsDeletingCo(false);
    }
  };

  const handleUpdateProfile = async (updates: { vehicle?: any; vehicles?: any[]; pet?: any; pets?: any[] }) => {
    try {
      const dormId =
        tenantRoom?.dormitoryId ||
        localTenant.dormitoryId ||
        (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');
      const activeRoom = selectedRoomId || tenantRoom?.id || '';
      const csrf = getCsrfTokenFromCookie() || '';
      const res = await fetch('/api/v1/tenant-portal/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(dormId ? { 'x-dormitory-id': dormId } : {}),
          ...(activeRoom ? { 'x-room-id': activeRoom } : {}),
        },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setLocalTenant((prev: any) => ({
            ...prev,
            vehicle: json.data.vehicle !== undefined ? json.data.vehicle : prev.vehicle,
            vehicles: json.data.vehicles !== undefined ? json.data.vehicles : prev.vehicles,
            pet: json.data.pet !== undefined ? json.data.pet : prev.pet,
            pets: json.data.pets !== undefined ? json.data.pets : prev.pets,
          }));
        }
        showToast('success', 'บันทึกข้อมูลสำเร็จ', 'อัปเดตข้อมูลยานพาหนะและสัตว์เลี้ยงเรียบร้อยแล้ว');
      } else {
        const errJson = await res.json().catch(() => ({}));
        showToast('error', 'ไม่สามารถบันทึกได้', errJson?.error?.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
      }
    } catch (err: any) {
      showToast('error', 'ไม่สามารถบันทึกได้', err?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
    }
  };

  // Active room and data models resolution
  const activeTenantRoomOption =
    tenantRooms.find((r) => r.roomId === selectedRoomId) || tenantRooms[0] || null;
  const tenantRoom: any = activeTenantRoomOption
    ? {
        id: activeTenantRoomOption.roomId,
        roomNumber: activeTenantRoomOption.roomNumber,
        buildingId: activeTenantRoomOption.buildingId,
        buildingName: activeTenantRoomOption.buildingName || 'อาคารหลัก',
        termMonths: Number(activeTenantRoomOption.termMonths || 5),
        floor: activeTenantRoomOption.floor,
        monthlyRent: activeTenantRoomOption.monthlyRent,
        dormitoryId: activeTenantRoomOption.dormitoryId,
        dormitoryName: activeTenantRoomOption.dormitoryName,
        currentTenantId: activeTenantRoomOption.tenantId || localTenant.id,
      }
    : rooms.find((r) => r.currentTenantId === tenant.id || r.currentTenantId === localTenant.id) ||
      (rooms.length > 0 && (rooms[0].currentTenantId === tenant.id || rooms[0].currentTenantId === localTenant.id) ? rooms[0] : undefined);

  const hasRoom = !!(tenantRoom?.roomNumber || localTenant?.roomNumber || tenant?.roomNumber || localTenant?.roomId || tenant?.roomId);
  const activeDormitoryName =
    tenantRoom?.dormitoryName ||
    dormitoryInfo?.name ||
    (localTenant as any)?.dormitory?.name ||
    (tenant as any)?.dormitory?.name ||
    'หอพัก HorPlus UAT Comprehensive Manor';

  const effectiveTenantRooms = useMemo(() => {
    if (tenantRooms && tenantRooms.length > 0) return tenantRooms;
    if (tenantRoom?.roomNumber) {
      return [
        {
          roomId: tenantRoom.id || 'current-room',
          roomNumber: tenantRoom.roomNumber,
          buildingName: tenantRoom.buildingName || 'อาคารหลัก',
          dormitoryName: activeDormitoryName,
          tenantId: tenantRoom.currentTenantId,
          monthlyRent: tenantRoom.monthlyRent,
        },
      ];
    }
    return [];
  }, [tenantRooms, tenantRoom, activeDormitoryName]);

  useEffect(() => {
    if (activeDormitoryName && typeof document !== 'undefined') {
      document.title = `${activeDormitoryName} - ระบบผู้เช่า`;
    }
  }, [activeDormitoryName]);
  const activeBuildingName = tenantRoom?.buildingName || 'อาคารหลัก';
  const activeRoomNumber = tenantRoom?.roomNumber || '';
  const activeDormitoryId =
    tenantRoom?.dormitoryId ||
    dormitoryInfo?.id ||
    (localTenant as any)?.dormitory?.id ||
    localTenant?.dormitoryId ||
    (tenant as any)?.dormitory?.id ||
    tenant?.dormitoryId;
  const tenantBills = (Array.isArray(bills) ? [...bills] : [])
    .filter((b) => {
      const status = (b?.status || '').toLowerCase();
      return status !== 'draft' && status !== 'cancelled';
    })
    .sort(
      (a, b) =>
        (b?.cycleId || (b as any)?.billingCycleId || '').localeCompare(
          a?.cycleId || (a as any)?.billingCycleId || ''
        ) || (b?.createdAt || '').localeCompare(a?.createdAt || '')
    );
  const tenantRepairs = (Array.isArray(repairs) ? repairs : []).filter(
    (r) => r?.roomId === tenantRoom?.id || r?.tenantId === tenant?.id || r?.tenantId === localTenant?.id
  );
  const tenantContracts = Array.isArray(contracts) ? contracts : [];

  // Filter announcements for this tenant's building or all
  const filteredAnnouncements = (Array.isArray(announcements) ? announcements : [])
    .filter((ann) => {
      if (!ann.targetType || ann.targetType === 'all') return true;

      if (ann.targetType === 'building') {
        const bldId = ann.targetBuildingId;
        if (bldId) return bldId === tenantRoom?.buildingId;
        if (ann.customTarget) {
          const bld = buildings.find((b) => b.id === tenantRoom?.buildingId);
          if (bld) {
            return (
              ann.customTarget.includes(bld.name) ||
              ann.customTarget.includes(bld.id) ||
              (bld.id === 'bld-a' && ann.customTarget.includes('อาคาร A')) ||
              (bld.id === 'bld-b' && ann.customTarget.includes('อาคาร B'))
            );
          }
        }
        return false;
      }

      if (ann.targetType === 'rooms') {
        if (tenantRoom?.roomNumber) {
          const cleanRoom = tenantRoom.roomNumber.trim().toUpperCase();
          if (
            ann.targetRooms &&
            ann.targetRooms.some((r) => (r || '').trim().toUpperCase() === cleanRoom)
          ) {
            return true;
          }
          if (ann.customTarget) {
            const cleanCustom = (ann.customTarget || '').toUpperCase();
            const tokens = cleanCustom
              .split(/[,\s]+/)
              .map((t) => t.trim().replace(/^ห้อง\s*/, ''));
            if (tokens.includes(cleanRoom) || tokens.some((t) => t === cleanRoom)) return true;
            if (cleanCustom.includes(cleanRoom)) return true;
          }
        }
        return false;
      }

      return true;
    })
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      const dateA = a.publishDate || a.createdAt || '';
      const dateB = b.publishDate || b.createdAt || '';
      return dateB.localeCompare(dateA);
    });

  // Active Unpaid Bills & Total Aggregate Unpaid Amount
  const allUnpaidBills = tenantBills.filter((b) =>
    [
      'unpaid',
      'pending',
      'overdue',
      'rejected',
      'checking',
      'issued',
      'partially_paid',
      'UNPAID',
      'PENDING',
      'OVERDUE',
      'REJECTED',
      'CHECKING',
      'ISSUED',
      'PARTIALLY_PAID',
    ].includes(b.status)
  );
  const activeUnpaidBill =
    allUnpaidBills.find((b) => {
      const pList = b.payments || (b as any).Payment || [];
      return (
        b.status === 'checking' ||
        b.status === 'CHECKING' ||
        pList.some((p: any) => p.status === 'UNDER_REVIEW' || p.status === 'checking')
      );
    }) ||
    allUnpaidBills.find((b) => {
      const pList = b.payments || (b as any).Payment || [];
      return (
        b.status === 'rejected' ||
        b.status === 'REJECTED' ||
        pList.some((p: any) => p.status === 'REJECTED')
      );
    }) ||
    allUnpaidBills[0] ||
    null;
  const totalUnpaidAmount = allUnpaidBills.reduce(
    (sum, b) => sum + Number(b.outstandingAmount ?? b.totalAmount ?? 0),
    0
  );

  useEffect(() => {
    const fetchHeaders: HeadersInit = selectedRoomId ? { 'x-room-id': selectedRoomId } : {};
    if (selectedPaymentBillIds.length > 1) {
      fetch(`/api/v1/tenant-portal/payment-options?billIds=${selectedPaymentBillIds.join(',')}`, {
        credentials: 'include',
        headers: fetchHeaders,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.data) setPaymentOptions(json.data);
        })
        .catch(() => {});
    } else if (selectedPaymentBillIds.length === 1) {
      fetch(`/api/v1/tenant-portal/payment-options/${selectedPaymentBillIds[0]}`, {
        credentials: 'include',
        headers: fetchHeaders,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.data) setPaymentOptions(json.data);
        })
        .catch(() => {});
    } else if (activeUnpaidBill) {
      fetch(`/api/v1/tenant-portal/payment-options/${activeUnpaidBill.id}`, {
        credentials: 'include',
        headers: fetchHeaders,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.data) setPaymentOptions(json.data);
        })
        .catch(() => {});
    }
  }, [activeUnpaidBill?.id, selectedPaymentBillIds, subView, selectedRoomId]);

  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>(() => {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(`tenant_ack_alerts_${tenant?.id || 'default'}`);
        return stored ? JSON.parse(stored) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const handleAcknowledgeAlert = (alertId: string) => {
    setAcknowledgedAlertIds((prev) => {
      if (prev.includes(alertId)) return prev;
      const next = [...prev, alertId];
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(`tenant_ack_alerts_${tenant?.id || 'default'}`, JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  };

  const unreadBills = tenantBills.filter((b) =>
    ['unpaid', 'pending', 'overdue', 'rejected', 'UNPAID', 'PENDING', 'OVERDUE', 'REJECTED'].includes(
      b.status
    )
  );
  const activeRepairs = tenantRepairs.filter(
    (r) => r.status === 'in_progress' || r.status === 'pending'
  );
  const urgentAnnouncements = filteredAnnouncements.filter((a) => a.isUrgent || a.isPinned);
  const unreadNoticesCount = notices.filter((n) => !n.isRead).length;

  const unacknowledgedBills = unreadBills.filter((b) => !acknowledgedAlertIds.includes(`bill-${b.id}`));
  const unacknowledgedRepairs = activeRepairs.filter((r) => !acknowledgedAlertIds.includes(`repair-${r.id}`));
  const unacknowledgedAnnouncements = urgentAnnouncements.filter((a) => !acknowledgedAlertIds.includes(`announcement-${a.id}`));

  const totalNotificationsCount =
    unacknowledgedBills.length + unacknowledgedRepairs.length + unacknowledgedAnnouncements.length + unreadNoticesCount;

  // Move-out handler
  const handleConfirmMoveOut = async () => {
    if (!moveOutDate) {
      showToast('error', 'กรุณาระบุวันที่', 'โปรดเลือกวันที่ประสงค์จะย้ายออก');
      return;
    }

    try {
      const dormId = tenantRoom?.dormitoryId || tenant.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');
      const targetRoomId = tenantRoom?.id || selectedRoomId || '';
      const csrf = getCsrfTokenFromCookie() || '';
      const response = await fetch('/api/v1/tenant-move-out-requests', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(dormId ? { 'x-dormitory-id': dormId } : {}),
          ...(targetRoomId ? { 'x-room-id': targetRoomId } : {}),
        },
        body: JSON.stringify({
          dormitoryId: dormId,
          tenantId: tenant.id,
          roomId: targetRoomId,
          intendedMoveOutDate: moveOutDate,
          reason: moveOutReason,
        }),
      });

      if (!response.ok) {
        let errMsg = 'ระบบยังไม่เปิดให้ยื่นคำขอแจ้งย้ายออกออนไลน์ในขณะนี้';
        try {
          const errData = await response.json();
          if (errData?.error?.message) errMsg = errData.error.message;
        } catch {}
        showToast('error', 'ไม่สามารถส่งคำขอได้', errMsg);
        return;
      }

      const resData = await response.json();
      setMoveOutRequest(resData.data || null);
      setIsMoveOutModalOpen(false);
      showToast(
        'success',
        'ส่งคำขอแจ้งย้ายออกเรียบร้อยแล้ว',
        'การเช่าจะยังไม่สิ้นสุดจนกว่าเจ้าของหอพักจะดำเนินการยืนยัน'
      );
      refreshData();
    } catch (err) {
      showToast('error', 'ไม่สามารถส่งคำขอได้', 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  const handleCancelMoveOutRequest = async () => {
    if (!moveOutRequest?.id) return;
    try {
      const dormId = tenantRoom?.dormitoryId || tenant.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || '' : '');
      const csrf = getCsrfTokenFromCookie() || '';
      const response = await fetch(`/api/v1/tenant-move-out-requests/${moveOutRequest.id}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(dormId ? { 'x-dormitory-id': dormId } : {}),
        },
      });
      if (!response.ok) {
        let errMsg = 'ไม่สามารถยกเลิกคำขอแจ้งย้ายออกได้';
        try {
          const errData = await response.json();
          if (errData?.error?.message) errMsg = errData.error.message;
        } catch {}
        showToast('error', 'ไม่สามารถดำเนินการได้', errMsg);
        return;
      }
      setMoveOutRequest(null);
      showToast('success', 'ยกเลิกคำขอแจ้งย้ายออกเรียบร้อยแล้ว', 'คุณสามารถส่งคำขอแจ้งย้ายออกใหม่ได้ตามต้องการ');
      refreshData();
    } catch {
      showToast('error', 'ไม่สามารถดำเนินการได้', 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    }
  };

  // Document download handler
  const handleDownloadDoc = (
    title: string,
    fileName: string,
    contentText: string,
    docType?: string,
    docId?: string
  ) => {
    try {
      if (docType === 'contract' || (!docType && (title.includes('สัญญา') || fileName.includes('สัญญา')))) {
        window.open('/api/v1/tenant-portal/contract/pdf', '_blank');
        showToast('success', 'เปิดเอกสารสำเร็จ', `กำลังเปิดเอกสาร ${title} (PDF)...`);
        return;
      }
      if (docType === 'id_card' || (!docType && (title.includes('บัตรประชาชน') || fileName.includes('บัตรประชาชน')))) {
        const t = localTenant || tenant;
        const hasPhoto = Boolean(
          (t as any).hasIdentityDocument ||
          (t.idCardPhotoMock && t.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64' && t.idCardPhotoMock.trim() !== '') ||
          (t as any).idCardPhotoUrl ||
          (t as any).photoUrl
        );
        const photoUrl = (t as any).idCardPhotoUrl || (t.idCardPhotoMock !== 'MOCK_ID_CARD_BASE64' ? t.idCardPhotoMock : null) || (t as any).photoUrl;
        if (hasPhoto && photoUrl) {
          const downloadUrl = photoUrl.startsWith('data:') ? photoUrl : '/api/v1/tenant-portal/id-card-photo?download=true';
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = `สำเนาบัตรประชาชน_${t.name || 'ผู้เช่า'}.jpg`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showToast('success', 'ดาวน์โหลดสำเร็จ', `กำลังดาวน์โหลดเอกสาร ${title}...`);
        } else {
          showToast('error', 'ยังไม่อัปโหลด', 'กรุณาอัปโหลดรูปภาพสำเนาบัตรประชาชนก่อนดาวน์โหลด');
        }
        return;
      }
      if (docType === 'receipt' && docId) {
        window.open(`/api/v1/receipts/${docId}/html`, '_blank');
        showToast('success', 'ดาวน์โหลดสำเร็จ', `กำลังดาวน์โหลดเอกสาร ${title} (PDF)...`);
        return;
      }

      const blob = new Blob([contentText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('success', 'ดาวน์โหลดสำเร็จ', `ดาวน์โหลดเอกสาร ${title} เรียบร้อยแล้ว`);
    } catch (err) {
      showToast('error', 'ดาวน์โหลดไม่สำเร็จ', 'ไม่สามารถสร้างไฟล์สำหรับดาวน์โหลดได้');
    }
  };

  const handleRepairFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type && !file.type.startsWith('image/')) return;
      setRepairImageName(file.name);
      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        compressImage(rawUrl)
          .then((compressedUrl) => setRepairImage(compressedUrl))
          .catch(() => setRepairImage(rawUrl));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRepairRemoveFile = () => {
    setRepairImage(null);
    setRepairImageName(null);
    if (repairFileInputRef.current) {
      repairFileInputRef.current.value = '';
    }
  };

  const handleCreateRepair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repairTitle.trim() || !tenantRoom || isSubmittingRepair) return;

    setIsSubmittingRepair(true);
    try {
      const activeRoomId = selectedRoomId || tenantRoom?.id || '';
      const csrf = getCsrfTokenFromCookie() || '';
      const res = await fetch('/api/v1/tenant-portal/maintenance', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
          ...(activeRoomId ? { 'x-room-id': activeRoomId } : {}),
        },
        body: JSON.stringify({
          category: 'plumbing',
          title: repairTitle.trim(),
          description: repairDesc.trim() || repairTitle.trim(),
          priority: 'medium',
          roomId: activeRoomId,
          imageBefore: repairImage || undefined,
        }),
      });

      if (res.ok) {
        setIsNewRepairOpen(false);
        setRepairTitle('');
        setRepairDesc('');
        setRepairImage(null);
        setRepairImageName(null);
        showToast('success', 'ส่งคำขอซ่อมสำเร็จแล้ว!', 'ช่างอาคารจะดำเนินการติดต่อกลับโดยเร็วที่สุด');
        refreshData();
      } else {
        showToast('error', 'ไม่สามารถส่งคำขอแจ้งซ่อมได้', 'เกิดข้อผิดพลาดในการส่งคำขอแจ้งซ่อม โปรดลองใหม่อีกครั้ง');
      }
    } catch (err: any) {
      showToast('error', 'ไม่สามารถส่งคำขอแจ้งซ่อมได้', err?.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setIsSubmittingRepair(false);
    }
  };

  const handleCancelRepair = async (requestId: string) => {
    if (!requestId || isCancellingRepairId) return;
    setIsCancellingRepairId(requestId);
    try {
      const csrf = getCsrfTokenFromCookie() || '';
      const res = await fetch(`/api/v1/tenant-portal/maintenance/${requestId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({ reason: 'ผู้เช่ายกเลิกคำขอ' }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast('success', 'ยกเลิกการแจ้งซ่อมเรียบร้อยแล้ว', 'รายการแจ้งซ่อมถูกย้ายไปยังประวัติการแจ้ง');
        refreshData();
      } else {
        const errorMsg = data?.error?.message || 'ไม่สามารถยกเลิกการแจ้งซ่อมได้';
        showToast('error', 'ไม่สามารถยกเลิกได้', errorMsg);
      }
    } catch (err: any) {
      showToast('error', 'เกิดข้อผิดพลาดในการเชื่อมต่อ', err?.message || 'ไม่สามารถติดต่อเซิร์ฟเวอร์ได้');
    } finally {
      setIsCancellingRepairId(null);
    }
  };

  const getCsrfToken = () => {
    const match = document.cookie.match(/(?:csrf-token|horplus_csrf)=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : (window as any).__CSRF_TOKEN || '';
  };

  const handleSubmitPaymentSlip = async () => {
    if (!slipFile) return;
    const isCombined = selectedPaymentBillIds.length > 1;
    const targetBills = isCombined
      ? tenantBills.filter((b) => selectedPaymentBillIds.includes(b.id))
      : selectedPaymentBillIds.length === 1
      ? tenantBills.filter((b) => b.id === selectedPaymentBillIds[0])
      : activeUnpaidBill
      ? [activeUnpaidBill]
      : [];

    if (targetBills.length === 0) return;

    setIsSubmittingSlip(true);
    try {
      const csrf = getCsrfToken();
      let intent: { intentId: string; uploadUrl: string };

      if (isCombined) {
        const intentRes = await fetch('/api/v1/payments/combined-slip-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({
            billIds: targetBills.map((b) => b.id),
            mimeType: slipFile.type || 'image/jpeg',
            fileSize: slipFile.size,
          }),
        });
        if (!intentRes.ok) {
          const errText = await intentRes.text();
          throw new Error(errText);
        }
        intent = await intentRes.json();
      } else {
        const singleBill = targetBills[0];
        const intentRes = await fetch('/api/v1/payments/slip/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({
            dormitoryId: localTenant.dormitoryId,
            billId: singleBill.id,
            fileName: slipFile.name,
            mimeType: slipFile.type || 'image/jpeg',
            fileSize: slipFile.size,
          }),
        });
        if (!intentRes.ok) {
          const errText = await intentRes.text();
          throw new Error(errText);
        }
        intent = await intentRes.json();
      }

      const formData = new FormData();
      formData.append('file', slipFile);
      const uploadRes = await fetch(intent.uploadUrl, {
        method: 'POST',
        headers: { 'x-csrf-token': csrf },
        body: formData,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        throw new Error(errText);
      }

      if (isCombined) {
        const totalAmount = targetBills.reduce((acc, b) => acc + Number(b.outstandingAmount ?? b.totalAmount ?? 0), 0);
        const submitRes = await fetch('/api/v1/payments/submit-combined-slip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf,
            'x-idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            intentId: intent.intentId,
            amount: totalAmount.toString(),
            paymentDate: new Date().toISOString(),
          }),
        });
        if (!submitRes.ok) {
          const errText = await submitRes.text();
          throw new Error(errText);
        }
      } else {
        const singleBill = targetBills[0];
        const submitRes = await fetch('/api/v1/payments/slip/submit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrf,
            'x-idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            dormitoryId: localTenant.dormitoryId,
            billId: singleBill.id,
            amount: (singleBill.outstandingAmount ?? singleBill.totalAmount).toString(),
            paymentDate: new Date().toISOString(),
            intentId: intent.intentId,
          }),
        });
        if (!submitRes.ok) {
          const errText = await submitRes.text();
          throw new Error(errText);
        }
      }

      setSubView(null);
      setSlipFile(null);
      setSelectedPaymentBillIds([]);
      showToast('success', 'ส่งหลักฐานสำเร็จ', 'กำลังรอการตรวจสอบจากเจ้าของหอพัก');
      refreshData();
    } catch (err: any) {
      let msg = err.message || '';
      try {
        const parsed = JSON.parse(msg);
        if (parsed?.error?.message) {
          msg = parsed.error.message;
        } else if (parsed?.message) {
          msg = parsed.message;
        }
      } catch {}
      if (msg.includes('DUPLICATE_PAYMENT_EVIDENCE') || msg.includes('สลิปซ้ำ')) {
        msg = 'รูปสลิปนี้เคยถูกส่งเข้าระบบแล้ว (สลิปซ้ำ)';
      } else if (msg.includes('ACTIVE_REVIEW_EXISTS')) {
        msg = 'มีรายการชำระเงินที่อยู่ระหว่างการตรวจสอบอยู่แล้ว';
      }
      showToast('error', 'ไม่สามารถส่งหลักฐานได้', msg);
    } finally {
      setIsSubmittingSlip(false);
    }
  };

  const handleUploadIdCard = async (file: File) => {
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = reader.result as string;
          const csrf = typeof document !== 'undefined'
            ? document.cookie.split('; ').find(row => row.startsWith('horplus_csrf='))?.split('=')[1] || ''
            : '';
          const res = await fetch('/api/v1/tenant-portal/id-card-photo', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-csrf-token': csrf,
            },
            body: JSON.stringify({ image: base64Data })
          });
          if (res.ok) {
            const data = await res.json();
            setLocalTenant((prev: any) => ({
              ...prev,
              hasIdentityDocument: true,
              idCardPhotoMock: data.data?.photoUrl || base64Data,
              idCardPhotoUrl: data.data?.photoUrl || base64Data,
            }));
            showToast('success', 'อัปโหลดสำเร็จ', 'อัปโหลดภาพสำเนาบัตรประชาชนเรียบร้อยแล้ว');
          } else {
            const errJson = await res.json().catch(() => null);
            showToast('error', 'เกิดข้อผิดพลาด', errJson?.error?.message || 'ไม่สามารถอัปโหลดภาพสำเนาบัตรประชาชนได้');
          }
        } catch (err: any) {
          showToast('error', 'เกิดข้อผิดพลาด', err.message || 'ไม่สามารถอัปโหลดภาพได้');
        }
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      showToast('error', 'เกิดข้อผิดพลาด', err.message || 'ไม่สามารถอ่านไฟล์ภาพได้');
    }
  };

  return (
    <div className="h-[100dvh] min-h-[100dvh] w-full bg-slate-50 flex justify-center overflow-hidden overscroll-none">
      {/* Main Container */}
      <div className="bg-slate-50 w-full sm:max-w-md h-full min-h-[100dvh] flex flex-col font-sans text-xs relative select-none sm:shadow-md sm:border-x sm:border-slate-200 overflow-hidden overscroll-none">
        {/* Main scrollable body area */}
        <div id="tenant-main-scroll-container" className={`flex-1 ${subView === 'register' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto overscroll-contain'} bg-slate-50/50 ${subView === null ? 'pb-24' : 'pb-0'}`}>
          {/* MAIN PORTAL ROOT NAVIGATION */}
          {subView === null && (
            <>
              {/* 1. HOME TAB */}
              {activeTab === 'home' && (
                <TenantHomeTab
                  localTenant={localTenant}
                  tenantRoom={tenantRoom}
                  hasRoom={hasRoom}
                  dormitoryName={activeDormitoryName}
                  financialLoading={financialLoading}
                  financialError={financialError}
                  activeUnpaidBill={activeUnpaidBill}
                  totalUnpaidAmount={totalUnpaidAmount}
                  allUnpaidBills={allUnpaidBills}
                  totalNotificationsCount={totalNotificationsCount}
                  notices={notices}
                  announcements={filteredAnnouncements}
                  utilitiesData={utilitiesData}
                  onOpenRoomSwitcher={() => setIsRoomSwitcherOpen(true)}
                  onOpenNotifications={() => setIsNotificationModalOpen(true)}
                  onOpenInvoice={(tab) => {
                    if (tab) setInvoiceTab(tab);
                    setSelectedInvoiceBillId(null);
                    setSubView('invoice');
                  }}
                  onOpenPayment={() => {
                    const targetId = activeUnpaidBill ? activeUnpaidBill.id : (allUnpaidBills[0]?.id || null);
                    setSelectedPaymentBillIds(targetId ? [targetId] : []);
                    setSubView('payment');
                  }}
                  onOpenRepairs={() => setSubView('repairs')}
                  onOpenUtilities={() => setSubView('utilities')}
                  onOpenContract={() => setSubView('contract')}
                  onOpenMoveOut={() => setIsMoveOutModalOpen(true)}
                  onOpenRenewal={() => setSubView('contract')}
                  onGoToAnnouncements={() => setActiveTab('announcements')}
                  onStartRegister={() => setSubView('register')}
                  onRefresh={() => refreshData()}
                  onZoomImage={(url) => setZoomedImage(url)}
                  activeContract={contracts[0] || (localTenant as any)?.activeContract}
                />
              )}

              {/* 2. ANNOUNCEMENTS TAB */}
              {activeTab === 'announcements' && (
                <TenantAnnouncementsTab
                  announcements={filteredAnnouncements}
                  hasRoom={hasRoom}
                  onZoomImage={(url) => setZoomedImage(url)}
                  onBack={() => setActiveTab('home')}
                />
              )}

              {/* 3. PAYMENTS TAB (BILLS LIST) */}
              {activeTab === 'payments_tab' && (
                <TenantPaymentsTab
                  dormitoryName={activeDormitoryName}
                  buildingName={activeBuildingName}
                  roomNumber={activeRoomNumber}
                  hasRoom={hasRoom}
                  tenantBills={tenantBills}
                  onOpenInvoice={(billId) => {
                    setSelectedInvoiceBillId(billId || null);
                    if (billId) {
                      const target = tenantBills.find((b) => b.id === billId);
                      if (target && (target.status === 'paid' || target.status === 'PAID')) {
                        setInvoiceTab('history');
                      } else {
                        setInvoiceTab('current');
                      }
                    }
                    setSubView('invoice');
                  }}
                  onOpenPayment={(billId) => {
                    const targetId = billId || (activeUnpaidBill ? activeUnpaidBill.id : undefined);
                    setSelectedPaymentBillIds(targetId ? [targetId] : []);
                    setSubView('payment');
                  }}
                  onBack={() => setActiveTab('home')}
                />
              )}

              {/* 4. PROFILE TAB */}
              {activeTab === 'profile' && (
                <TenantProfileTab
                  dormitoryName={activeDormitoryName}
                  buildingName={activeBuildingName}
                  roomNumber={activeRoomNumber}
                  localTenant={localTenant}
                  hasRoom={hasRoom}
                  onStartRegister={() => setSubView('register')}
                  petPolicy={dormitoryPetPolicy}
                  onOpenCoOccupantsModal={handleOpenCoOccupantsModal}
                  onUpdateProfile={handleUpdateProfile}
                  moveOutRequest={moveOutRequest}
                  onOpenMoveOutModal={() => setIsMoveOutModalOpen(true)}
                  handleCancelMoveOutRequest={handleCancelMoveOutRequest}
                  onBack={() => setActiveTab('home')}
                />
              )}
            </>
          )}

          {/* DETAILED SUB-VIEWS ROUTINGS */}
          {subView !== null && (
            <>
              {subView === 'invoice' && (
                <TenantInvoiceView
                  dormitoryName={activeDormitoryName}
                  buildingName={activeBuildingName}
                  roomNumber={activeRoomNumber}
                  hasRoom={hasRoom}
                  activeUnpaidBill={activeUnpaidBill}
                  tenantBills={tenantBills}
                  selectedBillId={selectedInvoiceBillId}
                  invoiceTab={invoiceTab}
                  setInvoiceTab={(tab) => {
                    setInvoiceTab(tab);
                    setSelectedInvoiceBillId(null);
                  }}
                  onBack={() => {
                    setSubView(null);
                    setSelectedInvoiceBillId(null);
                  }}
                  onGoToPayment={(billIds) => {
                    setSelectedPaymentBillIds(
                      billIds && billIds.length > 0
                        ? billIds
                        : activeUnpaidBill
                        ? [activeUnpaidBill.id]
                        : []
                    );
                    setSubView('payment');
                    setSelectedInvoiceBillId(null);
                  }}
                />
              )}

              {(subView === 'payment' || subView === 'pay') && (
                <TenantPaymentView
                  dormitoryName={activeDormitoryName}
                  buildingName={activeBuildingName}
                  roomNumber={activeRoomNumber}
                  activeUnpaidBill={activeUnpaidBill}
                  selectedBills={
                    selectedPaymentBillIds.length > 0
                      ? tenantBills.filter((b) => selectedPaymentBillIds.includes(b.id))
                      : activeUnpaidBill
                      ? [activeUnpaidBill]
                      : []
                  }
                  paymentOptions={paymentOptions}
                  slipFile={slipFile}
                  setSlipFile={setSlipFile}
                  isSubmittingSlip={isSubmittingSlip}
                  onSubmitPaymentSlip={handleSubmitPaymentSlip}
                  onBack={() => {
                    setSubView(null);
                    setSelectedPaymentBillIds([]);
                  }}
                  onShowToast={showToast}
                />
              )}

              {subView === 'repairs' && (
                <TenantRepairsView
                  tenantRepairs={tenantRepairs}
                  hasRoom={hasRoom}
                  onStartRegister={() => setSubView('register')}
                  repairTab={repairTab}
                  setRepairTab={setRepairTab}
                  isNewRepairOpen={isNewRepairOpen}
                  setIsNewRepairOpen={setIsNewRepairOpen}
                  repairTitle={repairTitle}
                  setRepairTitle={setRepairTitle}
                  repairDesc={repairDesc}
                  setRepairDesc={setRepairDesc}
                  repairImage={repairImage}
                  repairImageName={repairImageName}
                  repairFileInputRef={repairFileInputRef}
                  handleRepairFileChange={handleRepairFileChange}
                  handleRepairRemoveFile={handleRepairRemoveFile}
                  handleCreateRepair={handleCreateRepair}
                  isSubmittingRepair={isSubmittingRepair}
                  onCancelRepair={handleCancelRepair}
                  isCancellingRepairId={isCancellingRepairId}
                  onBack={() => setSubView(null)}
                  onZoomImage={(url) => setZoomedImage(url)}
                />
              )}

              {subView === 'utilities' && (
                <TenantUtilitiesView
                  tenantRoom={tenantRoom}
                  hasRoom={hasRoom}
                  utilitiesData={utilitiesData}
                  contractStartDate={tenantContracts[0]?.startDate || tenantRoom?.startDate}
                  onBack={() => setSubView(null)}
                />
              )}

              {subView === 'contract' && (
                <TenantContractView
                  tenantContracts={tenantContracts}
                  tenant={localTenant || tenant}
                  tenantRoom={tenantRoom}
                  hasRoom={hasRoom}
                  dormitory={dormitoryInfo}
                  renewalEligibility={renewalEligibility}
                  requestedStartDate={requestedStartDate}
                  setRequestedStartDate={setRequestedStartDate}
                  requestedDurationMonths={requestedDurationMonths}
                  setRequestedDurationMonths={setRequestedDurationMonths}
                  isSubmittingRenewal={isSubmittingRenewal}
                  handleSubmitRenewal={handleSubmitRenewal}
                  unpaidBalance={totalUnpaidAmount}
                  onCancelRenewal={handleCancelRenewal}
                  isCancellingRenewal={isCancellingRenewal}
                  onOpenDocModal={(doc) => setSelectedDocModal(doc)}
                  handleDownloadDoc={handleDownloadDoc}
                  onUploadIdCard={handleUploadIdCard}
                  onBack={() => setSubView(null)}
                />
              )}

              {subView === 'register' && (
                <TenantRegisterView
                  dormitoryId={activeDormitoryId}
                  inviteToken={searchParams.get('t') || searchParams.get('token') || undefined}
                  initialViewState={(localTenant as any)?.pendingRequest ? 'form' : 'room_picker'}
                  initialStep={
                    (localTenant as any)?.pendingRequest?.status === 'awaiting_tenant_confirmation'
                      ? (((localTenant as any)?.pendingRequest?.rentalPlan || 'monthly') === 'daily' ? 2 : 5)
                      : undefined
                  }
                  existingTenantProfile={localTenant}
                  revisionRequest={(localTenant as any)?.pendingRequest}
                  onBack={() => setSubView(null)}
                  onSuccess={(registeredTenant: any) => {
                    if (registeredTenant) setLocalTenant((prev: any) => ({ ...prev, ...registeredTenant }));
                    refreshData();
                    setSubView(null);
                    navigate('/tenant', { replace: true });
                    const tenantDisplayName = registeredTenant?.name || registeredTenant?.displayName || localTenant?.name || 'ผู้เช่า';
                    showToast(
                      'success',
                      'ลงทะเบียน / ยืนยันสิทธิ์สำเร็จ',
                      `บันทึกข้อมูลคุณ ${tenantDisplayName} เข้าสู่ระบบเรียบร้อยแล้ว`
                    );
                    setTimeout(() => {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                      const scrollables = document.querySelectorAll(
                        '.overflow-y-auto, #tenant-main-scroll-container'
                      );
                      scrollables.forEach((el) => {
                        el.scrollTop = 0;
                      });
                    }, 50);
                  }}
                />
              )}
            </>
          )}
        </div>

        {/* Fixed bottom navigation bar (only visible when in root tab views, hidden in subviews) */}
        {subView === null && (
          <div className="absolute bottom-0 inset-x-0 bg-white border-t border-slate-100 px-2 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] flex justify-between items-center z-20 shrink-0 shadow-sm">
            {[
              { id: 'home', label: 'หน้าหลัก', icon: Home },
              { id: 'announcements', label: 'ประกาศ', icon: Bell },
              { id: 'payments_tab', label: 'บิล', icon: FileText },
              { id: 'profile', label: 'โปรไฟล์', icon: User },
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = activeTab === item.id && subView === null;
              return (
                <button
                  key={item.id}
                  data-testid={`nav-tab-${item.id}`}
                  onClick={() => {
                    setActiveTab(item.id as any);
                    setSubView(null);
                  }}
                  className={`flex-1 py-1 flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                    isSelected
                      ? 'text-indigo-600 font-black scale-105'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Icon className="w-4 h-4 stroke-[2]" />
                  <span className="text-[8px] leading-none font-bold">{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Room Switcher Modal */}
      <TenantRoomSwitcherModal
        isOpen={isRoomSwitcherOpen}
        onClose={() => setIsRoomSwitcherOpen(false)}
        tenantRooms={effectiveTenantRooms}
        currentRoomId={tenantRoom?.id || activeTenantRoomOption?.roomId || effectiveTenantRooms[0]?.roomId}
        onSelectRoom={(roomId) => {
          setSelectedRoomId(roomId);
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('tenant_selected_room_id', roomId);
          }
          setIsRoomSwitcherOpen(false);
          refreshData(roomId);
        }}
        onOpenAddRoom={() => {
          setIsRoomSwitcherOpen(false);
          setSubView('register');
        }}
      />

      {/* Add Additional Room Modal */}
      <TenantAddRoomModal
        isOpen={isAddRoomModalOpen}
        onClose={() => setIsAddRoomModalOpen(false)}
        localTenant={localTenant}
        availableVacantRooms={availableVacantRooms}
        loadingVacantRooms={loadingVacantRooms}
        selectedVacantRoomId={selectedVacantRoomId}
        setSelectedVacantRoomId={setSelectedVacantRoomId}
        addRoomStep={addRoomStep}
        setAddRoomStep={setAddRoomStep}
        isCheckingRoomClaim={isCheckingRoomClaim}
        handleCheckAndProceed={handleCheckAndProceed}
        vacantAgreedTerms={vacantAgreedTerms}
        setVacantAgreedTerms={setVacantAgreedTerms}
        isSubmittingVacantRequest={isSubmittingVacantRequest}
        handleSubmitVacantRoomRequest={handleSubmitVacantRoomRequest}
      />

      {/* Claim Modal Integration */}
      {isClaimModalActive && (
        <TenantClaimModal
          isOpen={isClaimModalActive}
          onClose={() => setIsClaimModalActive(false)}
          dormitoryId={tenantRoom?.dormitoryId || ''}
          roomNumber={claimRoomNumberInput.trim()}
          initialClaimInput={sanitizeClaimInput(localTenant.phone !== '-' ? localTenant.phone : localTenant.name)}
          allowAdditionalRoom={true}
          onSuccess={(msg) => {
            showToast('success', 'สำเร็จ', msg);
            setIsClaimModalActive(false);
            setIsAddRoomModalOpen(false);
            setClaimRoomNumberInput('');
            refreshData();
          }}
        />
      )}

      {/* Edit Co-occupants Modal */}
      <TenantCoOccupantsModal
        isOpen={isCoOccupantsModalOpen}
        onClose={() => setIsCoOccupantsModalOpen(false)}
        editCoOccupants={editCoOccupants}
        deleteConfirmCoId={deleteConfirmCoId}
        setDeleteConfirmCoId={setDeleteConfirmCoId}
        isDeletingCo={isDeletingCo}
        handleConfirmRemoveCoOccupant={handleConfirmRemoveCoOccupant}
        coOccupantsError={coOccupantsError}
        newCoName={newCoName}
        setNewCoName={setNewCoName}
        newCoPhone={newCoPhone}
        setNewCoPhone={setNewCoPhone}
        isAddingCo={isAddingCo}
        handleAddCoOccupant={handleAddCoOccupant}
      />

      {/* Move Out Request Confirmation Modal */}
      <TenantMoveOutModal
        isOpen={isMoveOutModalOpen}
        onClose={() => setIsMoveOutModalOpen(false)}
        moveOutDate={moveOutDate}
        setMoveOutDate={setMoveOutDate}
        moveOutBank={moveOutBank}
        setMoveOutBank={setMoveOutBank}
        moveOutAccount={moveOutAccount}
        setMoveOutAccount={setMoveOutAccount}
        moveOutReason={moveOutReason}
        setMoveOutReason={setMoveOutReason}
        handleConfirmMoveOut={handleConfirmMoveOut}
      />

      {/* Document Preview & Viewer Modal */}
      <TenantDocumentModal
        selectedDocModal={selectedDocModal}
        onClose={() => setSelectedDocModal(null)}
        handleDownloadDoc={handleDownloadDoc}
      />

      {/* Notification Center Modal */}
      <TenantNotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        totalNotificationsCount={totalNotificationsCount}
        unreadBills={unreadBills}
        activeRepairs={activeRepairs}
        urgentAnnouncements={urgentAnnouncements}
        notices={notices}
        onSelectBillPayment={() => setSubView('invoice')}
        onSelectRepairTrack={() => {
          setSubView('repairs');
          setRepairTab('history');
        }}
        onSelectAnnouncement={() => {
          setActiveTab('announcements');
          setSubView(null);
        }}
        handleMarkNoticeAsRead={handleMarkNoticeAsRead}
        onAcknowledgeAlert={handleAcknowledgeAlert}
        acknowledgedAlertIds={acknowledgedAlertIds}
      />

      {/* Zoomed Image Popup */}
      {zoomedImage && (
        <div
          className="fixed inset-0 bg-black/85 z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setZoomedImage(null)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="absolute -top-10 right-0 z-[10000] text-white/75 hover:text-white transition-all cursor-pointer p-1 hover:scale-110 active:scale-95 flex items-center justify-center"
              onClick={() => setZoomedImage(null)}
              title="ปิด"
            >
              <X className="w-8 h-8 stroke-[1.5]" />
            </button>

            <img
              src={zoomedImage}
              alt="Zoomed announcement"
              className="max-w-[90vw] md:max-w-4xl max-h-[80vh] md:max-h-[85vh] h-auto w-auto rounded-2xl shadow-2xl border border-white/10 select-none cursor-zoom-out transition-transform duration-300 hover:scale-[1.01]"
              onClick={() => setZoomedImage(null)}
              referrerPolicy="no-referrer"
            />
          </div>
        </div>
      )}

      {/* Floating Success Toast Notification with Smooth Fade (Top Center) */}
      {toast && toast.visible && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[9999] w-[90%] max-w-sm bg-white text-slate-800 px-4.5 py-3 rounded-2xl shadow-2xl border border-slate-200/90 flex items-center gap-2.5 text-xs font-bold transition-all duration-300 ease-in-out ${
            isToastFading
              ? 'opacity-0 -translate-y-4 pointer-events-none'
              : 'opacity-100 translate-y-0 animate-in fade-in slide-in-from-top-4 duration-300'
          }`}
        >
          <div
            className={`p-1 rounded-lg ${
              toast.type === 'success'
                ? 'bg-emerald-50 text-emerald-600'
                : 'bg-rose-50 text-rose-600'
            }`}
          >
            <CheckCircle className="w-4 h-4 stroke-[2.5]" />
          </div>
          <div className="flex-1 min-w-0 pr-1">
            <h4 className="font-extrabold text-slate-800 text-xs leading-tight">{toast.title}</h4>
            {toast.message && (
              <p className="text-[10px] text-slate-500 mt-0.5 leading-normal font-medium">
                {toast.message}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setToast((prev) => (prev ? { ...prev, visible: false } : null))}
            className="text-slate-400 hover:text-slate-600 transition-colors cursor-pointer p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
