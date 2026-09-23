/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  UserCheck,
  Building2,
  Calendar,
  CreditCard,
  FileSignature,
  ShieldCheck,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronLeft,
  Sparkles,
  Phone,
  Mail,
  User,
  Home,
  Car,
  Dog,
  Clock,
  ArrowRight,
  Upload,
  Image as ImageIcon,
  FileText,
  Check,
  Eye,
  Lock,
  Search,
  RotateCcw,
  DoorOpen,
  Paperclip,
  XCircle,
  CalendarClock
} from 'lucide-react';
import { TenantBottomSheet } from '../../pages/tenant/components/TenantBottomSheet';
import { LineLogo } from '../LineLogo';
import { TenantClaimModal } from '../TenantClaimModal';
import { sanitizeClaimInput } from '../../utils/claim-sanitizer';
import { OwnerDateInput } from '../OwnerDateInput';
import { Room, Tenant, Contract, CoOccupant } from '../../types';
import {
  CAR_BRANDS,
  MOTO_BRANDS,
  CANONICAL_PET_GROUP_OPTIONS,
  resolveAllowedPetOptions,
  compressImage,
} from '../../pages/tenant/tenantHelpers';

export interface RegistrationVehicleItem {
  id: string;
  type: 'none' | 'car' | 'motorcycle' | 'bicycle';
  brand: string;
  customBrand: string;
  licensePlate: string;
}

export interface RegistrationPetItem {
  id: string;
  type: 'dog' | 'cat' | 'small_pet' | 'other';
  customType: string;
  name: string;
  count: number;
}
import {
  submitTenantRegistrationRequest,
  getPublicRooms,
  verifyTenantClaim,
  completeTenantClaim,
  resubmitTenantRegistrationRequest,
  confirmApprovedRegistration,
  submitDailyStayRequest,
  getPublicDormitoryPolicy,
} from '../../data/adapters/api';

const getRooms = (): Room[] => [];
const getBuildings = () => [];
const getTenants = (): Tenant[] => [];
const getContracts = (): Contract[] => [];
const saveTenants = (_ts: Tenant[]) => { };
const saveRooms = (_rs: Room[]) => { };
const saveContracts = (_cs: Contract[]) => { };
const addAuditLog = (..._args: any[]) => { };
const getDormitory = (targetDormId?: string): any => {
  try {
    const candidates = [
      targetDormId ? localStorage.getItem(`dormitory_${targetDormId}`) : null,
      localStorage.getItem('dormitory'),
      localStorage.getItem('registered_dorm_profile'),
      localStorage.getItem('dormitory_profile'),
      localStorage.getItem('horplus_dormitory_settings'),
    ].filter(Boolean);

    let foundObj: any = null;
    let foundSig = '';
    let foundBankName = '';

    for (const item of candidates) {
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;
        if (!foundObj && parsed && typeof parsed === 'object') foundObj = parsed;
        if (!foundSig && parsed && (parsed.ownerSignature || parsed.signatureUrl || parsed.ownerSignatureUrl)) {
          foundSig = parsed.ownerSignature || parsed.signatureUrl || parsed.ownerSignatureUrl;
        }
        if (!foundBankName && parsed && (parsed.bankAccountName || parsed.promptPayName || parsed.promptPayAccountName)) {
          foundBankName = parsed.bankAccountName || parsed.promptPayName || parsed.promptPayAccountName;
        }
      } catch { }
    }

    try {
      const dormList = JSON.parse(localStorage.getItem('dormitories') || '[]');
      if (Array.isArray(dormList) && dormList.length > 0) {
        const matched = targetDormId ? dormList.find((d: any) => d.id === targetDormId) : dormList[0];
        const target = matched || dormList[0];
        if (target) {
          if (!foundObj) foundObj = target;
          if (!foundSig && (target.ownerSignature || target.signatureUrl || target.ownerSignatureUrl)) {
            foundSig = target.ownerSignature || target.signatureUrl || target.ownerSignatureUrl;
          }
          if (!foundBankName && (target.bankAccountName || target.promptPayName)) {
            foundBankName = target.bankAccountName || target.promptPayName;
          }
        }
      }
    } catch { }

    if (foundObj) {
      return {
        id: foundObj.id || targetDormId || 'dorm-1',
        name: foundObj.name || foundObj.dormName || 'HorPlus Dormitory',
        address: foundObj.address || '',
        phone: foundObj.phone || '',
        taxId: foundObj.taxId || '',
        ownerSignature: foundSig || foundObj.ownerSignature || foundObj.signatureUrl || foundObj.ownerSignatureUrl || '',
        bankAccountName: foundBankName || foundObj.bankAccountName || foundObj.promptPayName || '',
        promptPayName: foundBankName || foundObj.promptPayName || '',
        petPolicy: foundObj.petPolicy || { allowPets: false },
        ...foundObj,
      };
    }
  } catch { }
  return {
    id: targetDormId || 'dorm-1',
    name: 'HorPlus Dormitory',
    address: '',
    phone: '',
    taxId: '',
    ownerSignature: '',
    promptPayName: '',
    petPolicy: { allowPets: false }
  };
};

export const formatThaiShortDate = (isoStr?: string): string => {
  if (!isoStr || !/^\d{4}-\d{2}-\d{2}$/.test(isoStr)) return isoStr || '';
  const [y, m, d] = isoStr.split('-').map(Number);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return isoStr || '';
  const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${d} ${thaiMonthsShort[m - 1] || ''} ${y + 543}`;
};

export const formatThaiFullDate = (dateStr?: string): string => {
  if (!dateStr) return '';
  try {
    const cleanStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const [yearStr, monthStr, dayStr] = cleanStr.split('-');
    if (!yearStr || !monthStr || !dayStr) return dateStr;
    const year = parseInt(yearStr, 10);
    const monthIdx = parseInt(monthStr, 10) - 1;
    const day = parseInt(dayStr, 10);

    const thaiFullMonths = [
      'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
      'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
    ];
    const beYear = year < 2500 ? year + 543 : year;
    const mName = thaiFullMonths[monthIdx] || '';
    return `${day} ${mName} ${beYear}`;
  } catch {
    return dateStr || '';
  }
};

export interface TenantRegisterViewProps {
  onBack?: () => void;
  onSuccess?: (registeredTenant: any) => void;
  rooms?: any[];
  policy?: any;
  inviteToken?: string;
  dormitoryId?: string;
  initialMode?: 'auto' | 'claim' | 'vacant' | 'revision';
  initialRoomId?: string;
  initialRentPlan?: 'monthly' | 'term' | 'daily';
  initialStep?: number;
  revisionRequest?: any;
  initialViewState?: 'room_picker' | 'form';
  existingTenantProfile?: any;
}

const formatCitizenIdStr = (val: string) => {
  const raw = (val || '').replace(/\D/g, '').slice(0, 13);
  if (!raw) return '';
  let formatted = raw;
  if (raw.length > 1) formatted = raw.slice(0, 1) + '-' + raw.slice(1);
  if (raw.length > 5) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5);
  if (raw.length > 10) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10);
  if (raw.length > 12) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10, 12) + '-' + raw.slice(12, 13);
  return formatted;
};

const formatThaiDateStr = (dateStr: string) => {
  if (!dateStr) return '';
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  if (!yearStr || !monthStr || !dayStr) return dateStr;
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;
  const day = parseInt(dayStr, 10);

  const thaiMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const beYear = year < 2500 ? year + 543 : year;
  const mName = thaiMonths[monthIdx] || '';
  return `${day} ${mName} ${beYear}`;
};

export const TenantRegisterView: React.FC<TenantRegisterViewProps> = ({
  onBack,
  onSuccess,
  rooms: propRooms,
  policy: propPolicy,
  inviteToken,
  dormitoryId,
  initialRoomId,
  initialRentPlan,
  initialStep,
  revisionRequest,
  initialViewState,
  existingTenantProfile,
}) => {
  const [internalRooms, setInternalRooms] = useState<any[]>(propRooms || []);
  const [policyData, setPolicyData] = useState<any>(propPolicy || null);
  const targetDormId = dormitoryId || policyData?.dormitoryId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || undefined : undefined);
  const fallbackDorm = getDormitory(targetDormId);
  const dormInfo = {
    ...fallbackDorm,
    ...(policyData || {}),
    name: policyData?.dormitoryName || policyData?.name || fallbackDorm?.name || 'HorPlus Dormitory',
    address: policyData?.address || fallbackDorm?.address || '',
    ownerSignature: policyData?.ownerSignature || fallbackDorm?.ownerSignature || '',
  };

  const getLessorDisplayName = () => {
    const rawBankName =
      policyData?.bankAccountName ||
      policyData?.billingSettings?.bankAccountName ||
      dormInfo?.bankAccountName ||
      dormInfo?.billingSettings?.bankAccountName ||
      policyData?.promptPayAccountName ||
      policyData?.billingSettings?.promptPayAccountName ||
      dormInfo?.promptPayName ||
      dormInfo?.promptPayAccountName;
    const dormName = policyData?.dormitoryName || policyData?.name || dormInfo?.name || 'HorPlus Residence';
    if (rawBankName && rawBankName.trim()) {
      return `${rawBankName.trim()} (${dormName})`;
    }
    return dormName;
  };

  const getLessorSignerName = () => {
    const rawBankName =
      policyData?.bankAccountName ||
      policyData?.billingSettings?.bankAccountName ||
      dormInfo?.bankAccountName ||
      dormInfo?.billingSettings?.bankAccountName ||
      policyData?.promptPayAccountName ||
      policyData?.billingSettings?.promptPayAccountName ||
      dormInfo?.promptPayName ||
      dormInfo?.promptPayAccountName;
    const dormName = policyData?.dormitoryName || policyData?.name || dormInfo?.name || 'HorPlus Residence';
    return (rawBankName && rawBankName.trim()) || dormName || 'ผู้ดูแลหอพัก';
  };

  const [claimInput, setClaimInput] = useState('');
  const [isClaimVerifying, setIsClaimVerifying] = useState(false);
  const [claimVerificationError, setClaimVerificationError] = useState<string | null>(null);
  const [isClaimVerified, setIsClaimVerified] = useState(false);
  const [claimVerificationToken, setClaimVerificationToken] = useState<string | null>(null);
  const [claimedTenantId, setClaimedTenantId] = useState<string | null>(null);
  const [lockedFinancials, setLockedFinancials] = useState<any | null>(null);
  const [submittingRegistration, setSubmittingRegistration] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState<any | null>(null);

  // Load public rooms & policy dynamically if not passed via props
  useEffect(() => {
    if (propRooms && propRooms.length > 0) {
      setInternalRooms(propRooms);
      if (!selectedRoomId || !propRooms.some((r: any) => r.id === selectedRoomId)) {
        const init = initialRoomId ? propRooms.find(r => r.id === initialRoomId || r.roomNumber === initialRoomId) : propRooms[0];
        if (init) setSelectedRoomId(init.id);
      }
    } else {
      getPublicRooms(dormitoryId, inviteToken).then((res) => {
        if (res.success && res.data && res.data.length > 0) {
          setInternalRooms(res.data);
          if (!selectedRoomId || !res.data.some((r: any) => r.id === selectedRoomId)) {
            const init = initialRoomId ? res.data.find((r: any) => r.id === initialRoomId || r.roomNumber === initialRoomId) : res.data[0];
            if (init) setSelectedRoomId(init.id);
          }
        }
      }).catch(() => { });
    }

    if (propPolicy) {
      setPolicyData(propPolicy);
    } else {
      getPublicDormitoryPolicy(dormitoryId).then((res) => {
        if (res.success && res.data) {
          setPolicyData(res.data);
        }
      }).catch(() => { });
    }
  }, [propRooms, propPolicy, dormitoryId, inviteToken]);

  const getDormRulesText = () => {
    if (policyData?.defaultTerms && policyData.defaultTerms.trim()) {
      return policyData.defaultTerms;
    }
    try {
      const saved = localStorage.getItem('registered_dorm_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.rulesTemplate && parsed.rulesTemplate.trim()) {
          return parsed.rulesTemplate;
        }
      }
    } catch { }
    if ((dormInfo as any).rulesTemplate) return (dormInfo as any).rulesTemplate;
    if ((dormInfo as any).dormRules) return (dormInfo as any).dormRules;
    return `1. ห้ามส่งเสียงดังรบกวนผู้อื่นหลังเวลา 22:00 น.
2. ห้ามสูบบุหรี่ภายในห้องพักและบริเวณทางเดินกลาง (ฝ่าฝืนปรับ 2,000 บาท)
3. การเลี้ยงสัตว์ต้องได้รับอนุญาตและเป็นไปตามประเภทที่กำหนดไว้เท่านั้น
4. การชำระค่าเช่าต้องชำระภายในวันที่ 5 ของทุกเดือน เกินกำหนดคิดค่าปรับวันละ 100 บาท
5. ห้ามดัดแปลง ต่อเติม หรือทาสีห้องพักโดยไม่ได้รับอนุญาต`;
  };

  // Step 1: Room Selection
  const rooms = internalRooms.length > 0 ? internalRooms : getRooms();
  const defaultRoom = rooms[0];

  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    initialRoomId || (defaultRoom ? defaultRoom.id : '')
  );

  const isRevisionOrConfirmation = Boolean(
    revisionRequest || revisionRequest?.status === 'awaiting_tenant_confirmation'
  );
  const [viewState, setViewState] = useState<'room_picker' | 'form'>(
    initialViewState || (initialRoomId || isRevisionOrConfirmation || propRooms ? 'form' : 'room_picker')
  );
  const [roomSearchQuery, setRoomSearchQuery] = useState('');
  const [selectedRoomForPlan, setSelectedRoomForPlan] = useState<any | null>(null);
  const [selectedRoomForClaim, setSelectedRoomForClaim] = useState<any | null>(null);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || defaultRoom;
  const isClaimCandidateRoom = !!selectedRoom?.isUnboundClaimable;

  // Step 2: Tenant Profile Info
  const [prefix, setPrefix] = useState<string>('นาย');
  const [customPrefix, setCustomPrefix] = useState<string>('');
  const [fullName, setFullName] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [address, setAddress] = useState('');
  const [idCardImage, setIdCardImage] = useState<string | null>(null);
  const [depositSlipImage, setDepositSlipImage] = useState<string | null>(null);

  const getEffectivePrefix = () => {
    if (prefix === 'ระบุเอง' || prefix === 'กำหนดเอง') {
      return customPrefix.trim() || 'นาย';
    }
    return prefix;
  };

  // Auto-format Citizen ID (X-XXXX-XXXXX-XX-X)
  const handleCitizenIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 13);
    let formatted = raw;
    if (raw.length > 1) formatted = raw.slice(0, 1) + '-' + raw.slice(1);
    if (raw.length > 5) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5);
    if (raw.length > 10) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10);
    if (raw.length > 12) formatted = raw.slice(0, 1) + '-' + raw.slice(1, 5) + '-' + raw.slice(5, 10) + '-' + raw.slice(10, 12) + '-' + raw.slice(12, 13);
    setCitizenId(formatted);
  };

  // Auto-format Phone (08X-XXX-XXXX)
  const formatPhoneInput = (val: string) => {
    const raw = (val || '').replace(/\D/g, '').slice(0, 10);
    if (!raw) return '';
    let formatted = raw;
    if (raw.startsWith('02')) {
      if (raw.length > 2) formatted = raw.slice(0, 2) + '-' + raw.slice(2);
      if (raw.length > 5) formatted = raw.slice(0, 2) + '-' + raw.slice(2, 5) + '-' + raw.slice(5, 9);
    } else {
      if (raw.length > 3) formatted = raw.slice(0, 3) + '-' + raw.slice(3);
      if (raw.length > 6) formatted = raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6, 10);
    }
    return formatted;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhoneInput(e.target.value));
  };

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const raw = reader.result as string;
        compressImage(raw, 1280, 1280, 0.8)
          .then((compressed) => setIdCardImage(compressed && compressed.length > 32 ? compressed : raw))
          .catch(() => setIdCardImage(raw));
      };
      reader.readAsDataURL(file);
    }
  };

  // Deposit Slip Upload Handler
  const handleDepositSlipUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const raw = reader.result as string;
        compressImage(raw, 1280, 1280, 0.8)
          .then((compressed) => setDepositSlipImage(compressed && compressed.length > 32 ? compressed : raw))
          .catch(() => setDepositSlipImage(raw));
      };
      reader.readAsDataURL(file);
    }
  };

  // Step 1: Rent Type & Deposit
  const [rentPlan, setRentPlan] = useState<'monthly' | 'term' | 'daily'>(initialRentPlan || 'monthly');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentMonths, setInstallmentMonths] = useState<number>(4);
  const [installmentAllocation, setInstallmentAllocation] = useState<'first_period' | 'equal'>('first_period');
  const [rentAmount, setRentAmount] = useState<number>(selectedRoom ? selectedRoom.monthlyRent : 4500);
  const [depositAmount, setDepositAmount] = useState<number>(selectedRoom ? selectedRoom.depositAmount : 5000);
  const [depositStatus, setDepositStatus] = useState<'paid' | 'unpaid'>('paid');

  const maxTermInstallments = Number(
    selectedRoom?.building?.maxTermRentInstallments ??
    selectedRoom?.maxTermRentInstallments ??
    policyData?.billingSettings?.maxTermRentInstallments ??
    policyData?.maxTermRentInstallments ??
    1
  );

  useEffect(() => {
    const configuredDueDay = policyData?.billingSettings?.dueDay || policyData?.dueDay || dormInfo?.billingSettings?.dueDay || dormInfo?.dueDay || 5;
    if (configuredDueDay) {
      setDueDay(Number(configuredDueDay));
    }
  }, [policyData, dormInfo]);

  useEffect(() => {
    if (rentPlan !== 'term') {
      setIsInstallment(false);
    } else if (maxTermInstallments > 1) {
      if (installmentMonths > maxTermInstallments || installmentMonths < 2) {
        setInstallmentMonths(Math.min(2, maxTermInstallments));
      }
    } else {
      setIsInstallment(false);
    }
  }, [rentPlan, maxTermInstallments]);

  const handleRoomClick = (room: any) => {
    if (room.selectable === false) return;
    if (room.isUnboundClaimable || room.selectionType === 'CLAIM_UNLINKED') {
      setSelectedRoomForClaim(room);
      return;
    }
    setSelectedRoomForPlan(room);
  };

  const handleSelectPlan = (room: any, plan: 'monthly' | 'term' | 'daily') => {
    setSelectedRoomId(room.id);
    setRentPlan(plan);
    if (plan !== 'term') {
      setIsInstallment(false);
    }
    if (plan === 'monthly') {
      setRentAmount(room.monthlyRent ?? 4500);
      setDepositAmount(room.monthlyDeposit ?? room.depositAmount ?? 5000);
    } else if (plan === 'term') {
      const effTerm = Number(room?.building?.termMonths ?? room?.termMonths ?? policyData?.termMonths ?? 6);
      setDurationValue(effTerm);
      setRentAmount(room.termRent ?? (room.monthlyRent ? room.monthlyRent * 4 : 18000));
      setDepositAmount(room.termDeposit ?? room.depositAmount ?? 5000);
    } else if (plan === 'daily') {
      setRentAmount(room.dailyRent ?? 500);
      setDepositAmount(room.dailyDeposit ?? 0);
    }
    setIsClaimVerified(false);
    setClaimVerificationToken(null);
    setClaimedTenantId(null);
    setLockedFinancials(null);
    setSelectedRoomForPlan(null);
    setViewState('form');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  };

  // Dedicated DailyStay State
  const [dailyEndDate, setDailyEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });

  // Step 4: Dates & Duration
  const todayStr = new Date().toISOString().split('T')[0];
  const [contractDate, setContractDate] = useState(todayStr);
  const [checkInDate, setCheckInDate] = useState(todayStr);
  const effectiveTermMonths = Number(
    selectedRoom?.building?.termMonths ??
    selectedRoom?.termMonths ??
    policyData?.termMonths ??
    dormInfo?.termMonths ??
    6
  );
  const [durationValue, setDurationValue] = useState<number>(initialRentPlan === 'term' ? effectiveTermMonths : 1);
  const [dueDay, setDueDay] = useState<number>(5);

  const dailyNights = (() => {
    if (!checkInDate || !dailyEndDate) return 1;
    const d1 = new Date(checkInDate).getTime();
    const d2 = new Date(dailyEndDate).getTime();
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  })();

  const isAwaitingTenantConfirmation = revisionRequest?.status === 'awaiting_tenant_confirmation';
  const isFinancialsLocked = isClaimVerified || isAwaitingTenantConfirmation;

  // Auto-sync contractDate with checkInDate
  useEffect(() => {
    if (checkInDate) {
      setContractDate(checkInDate);
    }
  }, [checkInDate]);

  // Auto adjust duration default when rent plan changes (preserve revisionRequest durationMonths if present)
  useEffect(() => {
    const revDuration = Number(revisionRequest?.acceptanceSnapshot?.durationMonths);
    if (revDuration > 0 && (rentPlan === 'monthly' || rentPlan === 'term')) {
      setDurationValue(revDuration);
      return;
    }
    if (rentPlan === 'daily') {
      setDurationValue(1);
    } else if (rentPlan === 'term') {
      setDurationValue(effectiveTermMonths);
    } else if (rentPlan === 'monthly') {
      setDurationValue(1);
    }
  }, [rentPlan, effectiveTermMonths, revisionRequest]);

  useEffect(() => {
    if (initialRentPlan) {
      setRentPlan(initialRentPlan);
    }
  }, [initialRentPlan]);

  useEffect(() => {
    if (initialStep !== undefined) {
      setActiveStep(initialStep);
    }
  }, [initialStep]);

  // Synchronize incoming policy changes
  useEffect(() => {
    if (propPolicy) {
      setPolicyData((prev: any) => ({ ...(prev || {}), ...propPolicy }));
    }
  }, [propPolicy]);

  // Resiliently fetch public policy from backend if signature/bank name missing
  useEffect(() => {
    const effectiveDormId = targetDormId || (typeof localStorage !== 'undefined' ? localStorage.getItem('selected_dormitory_id') || undefined : undefined);
    if (effectiveDormId && (!policyData?.ownerSignature || !policyData?.bankAccountName)) {
      getPublicDormitoryPolicy(effectiveDormId)
        .then((res) => {
          if (res.success && res.data) {
            setPolicyData((prev: any) => ({ ...(prev || {}), ...res.data }));
          }
        })
        .catch(() => { });
    }
  }, [targetDormId]);

  // Calculate Contract End Date based on unit (daily vs monthly/term)
  const calculateEndDate = (startDate: string, value: number, plan: 'monthly' | 'term' | 'daily') => {
    if (!startDate) return '';
    const d = new Date(startDate);
    if (plan === 'daily') {
      d.setDate(d.getDate() + value);
    } else {
      d.setMonth(d.getMonth() + value);
    }
    return d.toISOString().split('T')[0];
  };

  const endDate = calculateEndDate(checkInDate, durationValue, rentPlan);

  // Installment Schedule Calculator
  const calculateInstallmentSchedule = () => {
    if (!isInstallment || installmentMonths <= 0) return [];

    const baseRentPerPeriod = Math.round(rentAmount / installmentMonths);
    const schedule = [];

    let totalPaidSoFar = 0;

    for (let i = 1; i <= installmentMonths; i++) {
      // Calculate rent for this period (adjust last period for rounding)
      let currentRent = baseRentPerPeriod;
      if (i === installmentMonths) {
        currentRent = rentAmount - baseRentPerPeriod * (installmentMonths - 1);
      }

      let depositAddition = 0;
      let depositNote = '';

      if (depositStatus === 'unpaid') {
        if (installmentAllocation === 'first_period') {
          if (i === 1) {
            depositAddition = depositAmount;
            depositNote = `รวมค่ามัดจำ ฿${depositAmount.toLocaleString()}`;
          }
        } else {
          // equal distribution of deposit
          depositAddition = Math.round(depositAmount / installmentMonths);
          depositNote = `รวมมัดจำผ่อนงวดละ ฿${depositAddition.toLocaleString()}`;
        }
      } else {
        depositNote = i === 1 ? 'ค่ามัดจำชำระแล้ว' : '';
      }

      const periodTotal = currentRent + depositAddition;

      // Calculate dueDate
      const periodDueDate = new Date(checkInDate);
      if (rentPlan === 'daily') {
        periodDueDate.setDate(periodDueDate.getDate() + (i - 1));
      } else {
        periodDueDate.setMonth(periodDueDate.getMonth() + (i - 1));
      }

      schedule.push({
        period: i,
        rentAmount: currentRent,
        depositAmount: depositAddition,
        totalAmount: periodTotal,
        dueDate: periodDueDate.toISOString().split('T')[0],
        depositNote
      });
    }

    return schedule;
  };

  const installmentSchedule = calculateInstallmentSchedule();

  // Step 3 (Merged): Emergency Contact & Co-occupants
  const EMERGENCY_RELATION_OPTIONS = [
    'แฟน',
    'เพื่อน',
    'ผู้ปกครอง',
    'พี่น้อง / ญาติ',
    'คู่สมรส',
    'อื่นๆ'
  ];

  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRel, setEmergencyRel] = useState('ผู้ปกครอง');
  const [emergencyCustomRel, setEmergencyCustomRel] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const handleEmergencyRelChange = (newVal: string) => {
    if (EMERGENCY_RELATION_OPTIONS.includes(newVal)) {
      setEmergencyRel(newVal);
    } else {
      setEmergencyRel('อื่นๆ');
      setEmergencyCustomRel(newVal);
    }
  };

  const getEffectiveEmergencyRel = () => {
    if (emergencyRel === 'อื่นๆ') {
      return emergencyCustomRel.trim() || 'อื่นๆ';
    }
    return emergencyRel;
  };

  const [hasCoOccupants, setHasCoOccupants] = useState(true);
  const [coOccupants, setCoOccupants] = useState<{ id: string; name: string; phone: string; citizenId: string }[]>([]);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [newCoCitizenId, setNewCoCitizenId] = useState('');

  // Step 4: Vehicle & Pet (Multi-item support with canonical options)
  const [vehiclesList, setVehiclesList] = useState<RegistrationVehicleItem[]>([
    { id: 'veh-1', type: 'none', brand: 'Honda', customBrand: '', licensePlate: '' },
  ]);

  const handleAddVehicle = () => {
    setVehiclesList((prev) => {
      const normalizedPrev =
        prev.length === 1 && prev[0].type === 'none'
          ? [{ ...prev[0], type: 'motorcycle' as const }]
          : prev;
      return [
        ...normalizedPrev,
        {
          id: `veh-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          type: 'motorcycle',
          brand: 'Honda',
          customBrand: '',
          licensePlate: '',
        },
      ];
    });
  };

  const handleRemoveVehicle = (id: string) => {
    setVehiclesList((prev) => (prev.length > 1 ? prev.filter((v) => v.id !== id) : prev));
  };

  const handleUpdateVehicle = (id: string, updates: Partial<RegistrationVehicleItem>) => {
    setVehiclesList((prev) => prev.map((v) => (v.id === id ? { ...v, ...updates } : v)));
  };

  const [hasPet, setHasPet] = useState(false);
  const [petsList, setPetsList] = useState<RegistrationPetItem[]>([
    { id: 'pet-1', type: 'cat', customType: '', name: '', count: 1 },
  ]);

  const handleAddPet = () => {
    const allowedPetOptions = resolveAllowedPetOptions(dormInfo?.petPolicy || policyData?.petPolicy);
    const petOptionsToDisplay = allowedPetOptions.length > 0 ? allowedPetOptions : CANONICAL_PET_GROUP_OPTIONS;
    setPetsList((prev) => [
      ...prev,
      {
        id: `pet-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: (petOptionsToDisplay[0]?.id as any) || 'cat',
        customType: '',
        name: '',
        count: 1,
      },
    ]);
  };

  const handleRemovePet = (id: string) => {
    setPetsList((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== id) : prev));
  };

  const handleUpdatePet = (id: string, updates: Partial<RegistrationPetItem>) => {
    setPetsList((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  // Aliases for single-item backward compatibility
  const vehicleType = vehiclesList[0]?.type || 'none';
  const vehicleBrand = vehiclesList[0]?.brand || 'Honda';
  const customBrand = vehiclesList[0]?.customBrand || '';
  const licensePlate = vehiclesList[0]?.licensePlate || '';
  const setVehicleType = (t: 'none' | 'car' | 'motorcycle' | 'bicycle') => {
    handleUpdateVehicle(vehiclesList[0]?.id || 'veh-1', { type: t });
  };
  const setVehicleBrand = (b: string) => {
    handleUpdateVehicle(vehiclesList[0]?.id || 'veh-1', { brand: b });
  };
  const setCustomBrand = (cb: string) => {
    handleUpdateVehicle(vehiclesList[0]?.id || 'veh-1', { customBrand: cb });
  };
  const setLicensePlate = (lp: string) => {
    handleUpdateVehicle(vehiclesList[0]?.id || 'veh-1', { licensePlate: lp });
  };

  const petType = petsList[0]?.type || 'cat';
  const petName = petsList[0]?.name || '';
  const petCount = petsList[0]?.count || 1;
  const setPetType = (pt: any) => {
    handleUpdatePet(petsList[0]?.id || 'pet-1', { type: pt });
  };
  const setPetName = (pn: string) => {
    handleUpdatePet(petsList[0]?.id || 'pet-1', { name: pn });
  };
  const setPetCount = (pc: number) => {
    handleUpdatePet(petsList[0]?.id || 'pet-1', { count: pc });
  };

  // Step 5: Signature & Real-time Contract
  const [isSigned, setIsSigned] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>('');
  const [isAgreedTerms, setIsAgreedTerms] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [highlightErrors, setHighlightErrors] = useState(false);

  const getHighlightClass = (isEmpty: boolean) =>
    highlightErrors && isEmpty
      ? 'border-rose-400 bg-rose-50/40 text-slate-800 focus:border-rose-500 focus:ring-1 focus:ring-rose-200'
      : 'border-slate-200 bg-slate-50 focus:border-indigo-500';

  // Signature Canvas Drawing Logic
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (selectedRoom) {
      if (rentPlan === 'monthly') {
        setRentAmount(selectedRoom.monthlyRent);
        setDepositAmount(selectedRoom.monthlyDeposit ?? selectedRoom.depositAmount);
      } else if (rentPlan === 'term') {
        setRentAmount(selectedRoom.termRent || selectedRoom.monthlyRent * 4);
        setDepositAmount(selectedRoom.termDeposit ?? selectedRoom.depositAmount);
      } else if (rentPlan === 'daily') {
        setRentAmount(selectedRoom.dailyRent || 500);
        setDepositAmount(selectedRoom.dailyDeposit ?? 0);
      }
    }
  }, [selectedRoomId, rentPlan]);

  // Active step tracking & navigation (Steps 1 to 5 for long-term, 1 to 3 for daily)
  const [activeStep, setActiveStep] = useState<number>(initialStep || 1);
  const [invalidSteps, setInvalidSteps] = useState<number[]>([]);

  const stepsList = rentPlan === 'daily' ? [
    { step: 1, label: 'ห้องพัก & วันเข้าพัก', shortLabel: 'ห้อง/วันพัก' },
    { step: 2, label: 'ข้อมูลผู้พัก & ยืนยัน', shortLabel: 'ผู้พัก/ยืนยัน' }
  ] : [
    { step: 1, label: 'ห้องพัก & วันเข้าพัก', shortLabel: 'ห้อง/เข้าพัก' },
    { step: 2, label: 'ข้อมูลส่วนตัว & บัตร', shortLabel: 'ผู้เช่า' },
    { step: 3, label: 'ผู้ติดต่อฉุกเฉิน & ผู้พักร่วม', shortLabel: 'ผู้ติดต่อ' },
    { step: 4, label: 'รถ & สัตว์เลี้ยง', shortLabel: 'รถ/สัตว์' },
    { step: 5, label: 'เซ็นสัญญาเช่า', shortLabel: 'สัญญา' }
  ];

  const validateAllSteps = (): number[] => {
    const invalid: number[] = [];
    if (rentPlan === 'daily') {
      if (!selectedRoomId || !checkInDate || !dailyEndDate) invalid.push(1);
      if (
        !fullName.trim() ||
        !phone.trim() ||
        !citizenId.trim() ||
        !birthDate?.trim() ||
        !address?.trim() ||
        (!isSigned && !signatureDataUrl) ||
        !isAgreedTerms
      ) {
        invalid.push(2);
      }
      return invalid;
    }

    // Step 1: Room & Move-in Date & Rent Plan
    if (!selectedRoomId || (isClaimCandidateRoom && !isClaimVerified) || !checkInDate) {
      invalid.push(1);
    }

    // Step 2: Tenant Info & ID Card
    if (
      !fullName.trim() ||
      !phone.trim() ||
      !citizenId.trim() ||
      !birthDate?.trim() ||
      !address?.trim() ||
      ((prefix === 'ระบุเอง' || prefix === 'กำหนดเอง') && !customPrefix.trim())
    ) {
      invalid.push(2);
    }

    // Step 3: Emergency Contact
    if (!emergencyName.trim() || !getEffectiveEmergencyRel().trim() || !emergencyPhone.trim()) {
      invalid.push(3);
    }

    // Step 4: Vehicle & Pet (Valid by default)

    // Step 5: Contract Terms & Signature
    const effectiveSig = signatureDataUrl || (canvasRef.current && isSigned ? canvasRef.current.toDataURL('image/png') : '');
    if (!isAgreedTerms || !effectiveSig) {
      invalid.push(5);
    }

    return invalid;
  };

  const scrollToTopContainer = () => {
    if (typeof document !== 'undefined') {
      const scrollables = document.querySelectorAll('.overflow-y-auto, #tenant-main-scroll-container, #tenant-registration-scroll-body');
      scrollables.forEach((el) => {
        el.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const isPreContractValid = (() => {
    if (rentPlan === 'daily') return true;
    const invalid = validateAllSteps().filter(s => s < 5);
    return invalid.length === 0;
  })();

  const goToStep = (stepNumber: number) => {
    if (rentPlan !== 'daily' && stepNumber === 5) {
      const preContractInvalid = validateAllSteps().filter(s => s < 5);
      if (preContractInvalid.length > 0) {
        setInvalidSteps(validateAllSteps());
        setHighlightErrors(true);
        setActiveStep(preContractInvalid[0]);
        setTimeout(scrollToTopContainer, 50);
        return;
      }
    }
    setActiveStep(stepNumber);
    setTimeout(scrollToTopContainer, 50);
  };

  const handleNextStep = () => {
    const invalid = validateAllSteps();
    if (invalid.includes(activeStep)) {
      setHighlightErrors(true);
      setInvalidSteps(invalid);
      return;
    }
    if (rentPlan !== 'daily' && activeStep + 1 === 5 && !isPreContractValid) {
      setHighlightErrors(true);
      setInvalidSteps(invalid);
      const firstInvalid = invalid.filter(s => s < 5)[0];
      if (firstInvalid) {
        goToStep(firstInvalid);
      }
      return;
    }
    goToStep(activeStep + 1);
  };

  const scrollToStep = goToStep;

  // Clear resolved invalid steps dynamically
  useEffect(() => {
    if (invalidSteps.length === 0) return;
    const currentInvalid = validateAllSteps();
    if (currentInvalid.length !== invalidSteps.length) {
      setInvalidSteps(currentInvalid);
    }
  }, [
    fullName,
    phone,
    citizenId,
    birthDate,
    address,
    prefix,
    customPrefix,
    checkInDate,
    dailyEndDate,
    emergencyName,
    emergencyRel,
    emergencyCustomRel,
    emergencyPhone,
    isAgreedTerms,
    signatureDataUrl,
    selectedRoomId,
    isClaimVerified
  ]);

  // Canvas Handlers (High-Fidelity Pointer Events + Fallback Touch/Mouse)
  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? 0 : e.clientY;
    const scaleX = canvas.width / (rect.width || 1);
    const scaleY = canvas.height / (rect.height || 1);
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if ('pointerId' in e && e.currentTarget && typeof e.currentTarget.setPointerCapture === 'function') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch { }
    } else if ('touches' in e && e.cancelable) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e, canvas);

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#312e81'; // Indigo-900
    ctx.beginPath();
    if (typeof ctx.arc === 'function') {
      ctx.arc(x, y, 1.25, 0, Math.PI * 2);
      ctx.fillStyle = '#312e81';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsSigned(true);
    setSignatureDataUrl(canvas.toDataURL('image/png'));
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    if ('touches' in e && e.cancelable) {
      e.preventDefault();
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoordinates(e, canvas);

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#312e81'; // Indigo-900
    ctx.lineTo(x, y);
    ctx.stroke();
    setIsSigned(true);
    setSignatureDataUrl(canvas.toDataURL('image/png'));
  };

  const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (e && 'pointerId' in e && e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch { }
    } else if (e && 'touches' in e && e.cancelable) {
      e.preventDefault();
    }
    setIsDrawing(false);
    if (canvasRef.current && isSigned) {
      setSignatureDataUrl(canvasRef.current.toDataURL('image/png'));
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsSigned(false);
    setSignatureDataUrl('');
  };

  // Add Co-occupant Helper
  const handleAddCoOccupant = () => {
    if (!newCoName.trim()) return;
    setCoOccupants((prev) => [
      ...prev,
      {
        id: `co-${Date.now()}`,
        name: newCoName.trim(),
        phone: newCoPhone.trim() || '-',
        citizenId: newCoCitizenId.trim() || '-'
      }
    ]);
    setNewCoName('');
    setNewCoPhone('');
    setNewCoCitizenId('');
  };

  const handleRemoveCoOccupant = (id: string) => {
    setCoOccupants((prev) => prev.filter((item) => item.id !== id));
  };

  // Handle Claim Verification
  const handleVerifyClaim = async () => {
    if (!claimInput.trim() || !selectedRoom) return;
    setIsClaimVerifying(true);
    setClaimVerificationError(null);
    try {
      const res = await verifyTenantClaim({
        dormitoryId,
        inviteToken,
        roomId: selectedRoom.id,
        claimInput: claimInput.trim(),
      });
      if (res.success && res.data?.verified) {
        setIsClaimVerified(true);
        if (res.data.claimVerificationToken) setClaimVerificationToken(res.data.claimVerificationToken);
        setClaimedTenantId(res.data.tenantId);
        setLockedFinancials(res.data.lockedFinancials);

        if (res.data.displayName) {
          setFullName(res.data.displayName);
        } else if (res.data.firstName) {
          setFullName(`${res.data.firstName} ${res.data.lastName || ''}`.trim());
        }
        if (res.data.phone) setPhone(res.data.phone);
        if (res.data.citizenId) setCitizenId(res.data.citizenId);
        if (res.data.birthDate) setBirthDate(res.data.birthDate);
        if (res.data.address) setAddress(res.data.address);

        if (res.data.lockedFinancials) {
          setRentAmount(Number(res.data.lockedFinancials.monthlyRent));
          setDepositAmount(Number(res.data.lockedFinancials.depositAmount));
          setDurationValue(Number(res.data.lockedFinancials.durationMonths));
          if (res.data.lockedFinancials.rentalType) {
            setRentPlan(res.data.lockedFinancials.rentalType as any);
          }
        }

        if (res.data.emergencyContact) {
          setEmergencyName(res.data.emergencyContact.name || '');
          setEmergencyPhone(formatPhoneInput(res.data.emergencyContact.phone || ''));
          handleEmergencyRelChange(res.data.emergencyContact.relationship || 'ผู้ปกครอง');
        }
        if (res.data.vehicles && res.data.vehicles.length > 0) {
          const v = res.data.vehicles[0];
          setVehicleType((v.type as any) || 'car');
          setVehicleBrand(v.brand || 'Toyota');
          setLicensePlate(v.licensePlate || '');
        }
        if (res.data.pet) {
          setHasPet(true);
          setPetType(res.data.pet.type || 'สุนัข');
          setPetName(res.data.pet.name || '');
          setPetCount(res.data.pet.count || 1);
        }
      } else {
        setClaimVerificationError(res.error?.message || 'ข้อมูลไม่ตรงกับที่ระบุไว้ในระบบ กรุณาตรวจสอบอีกครั้ง');
      }
    } catch (err: any) {
      setClaimVerificationError(err.message || 'เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์');
    } finally {
      setIsClaimVerifying(false);
    }
  };

  // Revision / Confirmation Pre-population (guarded so background window focus refreshes don't overwrite user input)
  const initializedRevisionIdRef = useRef<string | null>(null);
  const initializedProfileKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const revKey = revisionRequest ? `${revisionRequest.id || 'rev'}:${revisionRequest.status || ''}` : null;
    if (revisionRequest && revKey && initializedRevisionIdRef.current !== revKey) {
      initializedRevisionIdRef.current = revKey;
      const snap = revisionRequest.acceptanceSnapshot || {};
      const approved = snap.approvedTerms || revisionRequest.approvedTerms || {};

      if (snap.requestedRoomId) setSelectedRoomId(snap.requestedRoomId);

      // Restore prefix and customPrefix
      const KNOWN_PREFIXES = ['นางสาว', 'เด็กหญิง', 'เด็กชาย', 'นาย', 'นาง'];
      if (snap.prefix) {
        if (KNOWN_PREFIXES.includes(snap.prefix)) {
          setPrefix(snap.prefix);
        } else {
          setPrefix('ระบุเอง');
          setCustomPrefix(snap.customPrefix || snap.prefix);
        }
      }

      // Restore full name
      const rawRestoredLast = revisionRequest.lastName && revisionRequest.lastName !== '-' ? revisionRequest.lastName.trim() : '';
      const nameToRestore =
        snap.fullName ||
        (revisionRequest.firstName ? `${revisionRequest.firstName} ${rawRestoredLast}`.trim() : '') ||
        snap.applicantName || '';
      if (nameToRestore) {
        let cleanName = nameToRestore.replace(/\s+-\s*$/, '').trim();
        for (const p of KNOWN_PREFIXES) {
          if (cleanName.startsWith(p)) {
            if (!snap.prefix) setPrefix(p);
            cleanName = cleanName.slice(p.length).trim();
            break;
          }
        }
        setFullName(cleanName);
      }

      // Restore phone
      const phoneToRestore = snap.phone || snap.applicantPhone || revisionRequest.phone;
      if (phoneToRestore && phoneToRestore !== '-') {
        setPhone(formatPhoneInput(phoneToRestore));
      }

      // Restore email
      if (snap.email) setEmail(snap.email);

      // Restore citizenId, birthDate, address
      if (snap.citizenId) setCitizenId(snap.citizenId);
      if (snap.birthDate) setBirthDate(snap.birthDate);
      if (snap.address) setAddress(snap.address);

      // Restore images
      if (snap.idCardImageUrl) setIdCardImage(snap.idCardImageUrl);
      if (snap.depositSlipImageUrl) setDepositSlipImage(snap.depositSlipImageUrl);
      if (snap.depositDeclaredStatus) {
        setDepositStatus(snap.depositDeclaredStatus === 'PAID' ? 'paid' : 'unpaid');
      } else if (snap.depositSlipImageUrl) {
        setDepositStatus('paid');
      }

      // Financials
      if (approved.rentAmount !== undefined && approved.rentAmount !== null) {
        setRentAmount(Number(approved.rentAmount));
      } else if (snap.proposedRent !== undefined && snap.proposedRent !== null) {
        setRentAmount(Number(snap.proposedRent));
      }

      if (approved.depositAmount !== undefined && approved.depositAmount !== null) {
        setDepositAmount(Number(approved.depositAmount));
      } else if (snap.proposedDeposit !== undefined && snap.proposedDeposit !== null) {
        setDepositAmount(Number(snap.proposedDeposit));
      }

      if (approved.durationMonths !== undefined && approved.durationMonths !== null) {
        setDurationValue(Number(approved.durationMonths));
      } else if (snap.durationMonths) {
        setDurationValue(Number(snap.durationMonths));
      }

      if (approved.rentalType) {
        setRentPlan(approved.rentalType);
      } else if (snap.rentalPlan) {
        setRentPlan(snap.rentalPlan);
      }

      if (approved.startDate) {
        setCheckInDate(approved.startDate);
      } else if (snap.startDate) {
        setCheckInDate(snap.startDate);
      }

      if (approved.endDate || snap.endDate) {
        setDailyEndDate(approved.endDate || snap.endDate);
      }
      setIsInstallment(snap.isInstallmentRequested === true);
      const restoredInstallmentCount = Number.parseInt(snap.selectedInstallmentPlan || '', 10);
      if (restoredInstallmentCount >= 2) setInstallmentMonths(restoredInstallmentCount);
      if (Array.isArray(snap.installments) && snap.installments.length > 1) {
        setInstallmentAllocation(snap.installments.slice(1).some((item: any) => Number(item.depositAmount) > 0) ? 'equal' : 'first_period');
      }

      if (approved.dueDay) {
        setDueDay(approved.dueDay);
      }


      // Emergency Contact
      if (snap.emergencyContact) {
        setEmergencyName(snap.emergencyContact.name || '');
        setEmergencyPhone(formatPhoneInput(snap.emergencyContact.phone || ''));
        handleEmergencyRelChange(snap.emergencyContact.relationship || 'ผู้ปกครอง');
      }

      // Co-occupants
      if (Array.isArray(snap.coOccupants) && snap.coOccupants.length > 0) {
        setCoOccupants(
          snap.coOccupants.map((c: any, i: number) => ({
            id: c.id || `co-${i + 1}`,
            name: c.name || '',
            phone: formatPhoneInput(c.phone || ''),
            citizenId: c.citizenId || '',
          }))
        );
        setHasCoOccupants(true);
      }

      // Vehicles
      if (Array.isArray(snap.vehicles) && snap.vehicles.length > 0) {
        setVehiclesList(
          snap.vehicles.map((v: any, i: number) => ({
            id: v.id || `veh-${i + 1}`,
            type: v.type || 'none',
            brand: v.brand || 'Honda',
            customBrand: v.customBrand || '',
            licensePlate: v.licensePlate || '',
          }))
        );
      } else if (snap.vehicle) {
        setVehiclesList([
          {
            id: 'veh-1',
            type: snap.vehicle.type || 'none',
            brand: snap.vehicle.brand || 'Honda',
            customBrand: '',
            licensePlate: snap.vehicle.licensePlate || '',
          },
        ]);
      }

      // Pets
      if (Array.isArray(snap.pets) && snap.pets.length > 0) {
        setPetsList(
          snap.pets.map((p: any, i: number) => ({
            id: p.id || `pet-${i + 1}`,
            type: p.type || 'cat',
            customType: p.customType || '',
            name: p.name || '',
            count: p.count || 1,
          }))
        );
        setHasPet(snap.pets.some((p: any) => p.hasPet !== false && p.type !== 'none'));
      } else if (snap.pet) {
        setHasPet(!!snap.pet.hasPet);
        setPetsList([
          {
            id: 'pet-1',
            type: snap.pet.type || 'cat',
            customType: '',
            name: snap.pet.name || '',
            count: snap.pet.count || 1,
          },
        ]);
      }
    }
  }, [revisionRequest]);

  // Existing Tenant Profile Auto-fill (Round 26)
  useEffect(() => {
    const profileKey = existingTenantProfile ? `${existingTenantProfile.id || 'prof'}` : null;
    if (existingTenantProfile && !revisionRequest && profileKey && initializedProfileKeyRef.current !== profileKey) {
      initializedProfileKeyRef.current = profileKey;
      let initialPrefix = '';
      let initialCustomPrefix = '';
      let parsedName = '';
      const isCandidateOrUnregistered =
        existingTenantProfile.status === 'unregistered' ||
        existingTenantProfile.id?.startsWith('candidate_') ||
        !existingTenantProfile.hasRoom;

      if (existingTenantProfile.firstName && existingTenantProfile.firstName !== '-') {
        parsedName = `${existingTenantProfile.firstName} ${existingTenantProfile.lastName && existingTenantProfile.lastName !== '-' ? existingTenantProfile.lastName : ''}`.trim();
      } else if (!isCandidateOrUnregistered && existingTenantProfile.name && !existingTenantProfile.name.endsWith(' -') && existingTenantProfile.name !== '-' && existingTenantProfile.name !== 'ยังไม่ได้ลงทะเบียน') {
        parsedName = existingTenantProfile.name.trim();
      }

      const KNOWN_PREFIXES = ['นางสาว', 'เด็กหญิง', 'เด็กชาย', 'นาย', 'นาง'];
      for (const p of KNOWN_PREFIXES) {
        if (parsedName.startsWith(p)) {
          initialPrefix = p;
          parsedName = parsedName.slice(p.length).trim();
          break;
        }
      }

      if (existingTenantProfile.prefix) {
        if (KNOWN_PREFIXES.includes(existingTenantProfile.prefix)) {
          initialPrefix = existingTenantProfile.prefix;
        } else {
          initialPrefix = 'ระบุเอง';
          initialCustomPrefix = existingTenantProfile.prefix;
        }
      }

      if (parsedName) setFullName(parsedName);
      if (initialPrefix) setPrefix(initialPrefix);
      if (initialCustomPrefix) setCustomPrefix(initialCustomPrefix);

      const rawPhone = existingTenantProfile.phone;
      if (rawPhone && rawPhone !== '-') {
        setPhone(formatPhoneInput(rawPhone));
      }

      const cId = existingTenantProfile.citizenId || existingTenantProfile.identificationNumber;
      if (cId && cId !== '-') {
        setCitizenId(formatCitizenIdStr(cId));
      }

      const bDate = existingTenantProfile.birthDate;
      if (bDate && bDate !== '-') {
        setBirthDate(bDate);
      }

      const addr = existingTenantProfile.address;
      if (addr && addr !== '-') {
        setAddress(addr);
      }

      const em = existingTenantProfile.email;
      if (em && em !== '-' && !em.endsWith('@horplus.local')) {
        setEmail(em);
      }

      if (existingTenantProfile.emergencyContact) {
        const ec = existingTenantProfile.emergencyContact;
        if (ec.name && ec.name !== '-') setEmergencyName(ec.name);
        if (ec.phone && ec.phone !== '-') setEmergencyPhone(formatPhoneInput(ec.phone));
        if (ec.relationship && ec.relationship !== '-') handleEmergencyRelChange(ec.relationship);
      }

      if (existingTenantProfile.vehicles && existingTenantProfile.vehicles.length > 0) {
        setVehiclesList(
          existingTenantProfile.vehicles.map((v: any, idx: number) => ({
            id: v.id || `veh-prof-${idx}`,
            type: v.type || 'car',
            brand: v.brand || 'Honda',
            customBrand: v.customBrand || '',
            licensePlate: v.licensePlate || '',
          }))
        );
      } else if (existingTenantProfile.vehicle) {
        const v = existingTenantProfile.vehicle;
        if (v.type && v.type !== 'none') {
          setVehiclesList([
            {
              id: 'veh-prof-0',
              type: v.type || 'car',
              brand: v.brand || 'Honda',
              customBrand: v.customBrand || '',
              licensePlate: v.licensePlate || '',
            },
          ]);
        }
      }

      if (existingTenantProfile.pets && existingTenantProfile.pets.length > 0) {
        setHasPet(true);
        setPetsList(
          existingTenantProfile.pets.map((p: any, idx: number) => ({
            id: p.id || `pet-prof-${idx}`,
            type: p.type || 'cat',
            customType: p.customType || '',
            name: p.name || '',
            count: p.count || 1,
          }))
        );
      } else if (existingTenantProfile.pet) {
        const p = existingTenantProfile.pet;
        if (p.hasPet || p.name || p.type) {
          setHasPet(true);
          setPetsList([
            {
              id: 'pet-prof-0',
              type: p.type || 'cat',
              customType: p.customType || '',
              name: p.name || '',
              count: p.count || 1,
            },
          ]);
        }
      }

      const idCardUrl = existingTenantProfile.idCardPhotoUrl || existingTenantProfile.idCardPhotoMock || existingTenantProfile.idCardImage;
      if (idCardUrl && idCardUrl !== '-') {
        setIdCardImage(idCardUrl);
      }
    }
  }, [existingTenantProfile, revisionRequest]);

  // Daily Stay Submit Handler
  const handleDailyStaySubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');

    const invalid = validateAllSteps();
    if (invalid.length > 0) {
      setInvalidSteps(invalid);
      setHighlightErrors(true);
      goToStep(invalid[0]);
      if (invalid.includes(1)) setErrorMsg('กรุณาเลือกห้องพักและระบุวันเข้าพักในขั้นตอนที่ 1');
      else if (invalid.includes(2)) setErrorMsg('กรุณากรอกข้อมูลผู้พัก ลงลายมือชื่อ และยอมรับเงื่อนไขในขั้นตอนที่ 2');
      return;
    }

    setSubmittingRegistration(true);

    try {
      const effectivePrefix = getEffectivePrefix();
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || fullName.trim();
      const lastName = nameParts.slice(1).join(' ').trim() || '-';
      const effectiveSignature = signatureDataUrl || (canvasRef.current && isSigned ? canvasRef.current.toDataURL('image/png') : (signatureDataUrl || 'data:image/png;base64,placeholder'));
      const effectiveDormId = targetDormId || selectedRoom?.dormitoryId || dormitoryId || dormInfo?.id;

      // Ensure fresh policy version from authoritative server
      let effectiveVersion = policyData?.version || 1;
      if (effectiveDormId && effectiveDormId !== 'dorm-1') {
        try {
          const pRes = await getPublicDormitoryPolicy(effectiveDormId);
          if (pRes.success && pRes.data?.version) {
            effectiveVersion = pRes.data.version;
            setPolicyData((prev: any) => ({ ...(prev || {}), ...pRes.data }));
          }
        } catch { }
      }

      // 1. Submit authoritative registration request (Public endpoint)
      const dailyPayload = {
        dormitoryId: effectiveDormId,
        inviteToken,
        requestedRoomId: selectedRoom?.id || selectedRoomId,
        prefix: effectivePrefix,
        firstName,
        lastName,
        phone: phone.trim(),
        email: email.trim(),
        agreedTerms: true,
        signatureBase64: effectiveSignature,
        expectedPolicyVersion: effectiveVersion,
        rentalPlan: 'daily' as const,
        proposedRent: rentAmount,
        proposedDeposit: depositAmount,
        startDate: checkInDate,
        endDate: dailyEndDate,
        dailyRateAmount: rentAmount,
        depositAmount: depositAmount,
        citizenId: citizenId.trim(),
        birthDate: birthDate || undefined,
        address: address || undefined,
        idCardImageUrl: idCardImage || '',
        depositSlipImageUrl: depositStatus === 'paid' && depositSlipImage ? depositSlipImage : '',
        depositDeclaredStatus: depositStatus === 'paid' ? 'PAID' : 'UNPAID',
        terms: 'คำขอเข้าพักรายวัน (Daily Stay)',
      };
      // Approval creates the DailyStay from this same registration; a second
      // daily-stay request would create a duplicate owner approval workflow.
      let res = revisionRequest
        ? await resubmitTenantRegistrationRequest(revisionRequest.id, dailyPayload)
        : await submitTenantRegistrationRequest(dailyPayload);
      if (!res.success && revisionRequest && (res.error?.code === 'REGISTRATION_REQUEST_NOT_FOUND' || res.error?.code === 'INVALID_REQUEST_STATUS' || res.error?.message?.includes('ไม่พบคำขอลงทะเบียน'))) {
        res = await submitTenantRegistrationRequest(dailyPayload);
      }

      if (res.success) {
        try {
          localStorage.setItem('pending_tenant_registration', JSON.stringify(res.data));
        } catch { }
        const successObj = {
          status: 'PENDING_DAILY_STAY',
          label: 'รออนุมัติคำขอเข้าพักรายวัน',
          message: 'ส่งคำขอเข้าพักรายวันเรียบร้อยแล้ว เจ้าของหอพักจะตรวจสอบและติดต่อกลับโดยเร็ว',
          data: res.data
        };
        setSubmissionSuccess(successObj);
        if (onSuccess) onSuccess(res.data);
      } else {
        setErrorMsg(res.error?.message || 'ไม่สามารถส่งคำขอเข้าพักรายวันได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการส่งคำขอเข้าพักรายวัน');
    } finally {
      setSubmittingRegistration(false);
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (rentPlan === 'daily') {
      return handleDailyStaySubmit(e);
    }

    const effectiveSignature = signatureDataUrl || (canvasRef.current && isSigned ? canvasRef.current.toDataURL('image/png') : '');

    if (isAwaitingTenantConfirmation) {
      if (!isAgreedTerms || !effectiveSignature) {
        setHighlightErrors(true);
        if (!effectiveSignature) {
          setErrorMsg('กรุณาลงลายมือชื่อเพื่อยืนยันสัญญาเช่า');
          canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (!isAgreedTerms) {
          setErrorMsg('กรุณากดยอมรับกฎระเบียบและเงื่อนไขของหอพัก');
          document.querySelector('[data-testid="tenant-agree-terms-checkbox"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }
    } else {
      const invalid = validateAllSteps();
      if (invalid.length > 0) {
        setInvalidSteps(invalid);
        setHighlightErrors(true);
        if (invalid.includes(5) && activeStep === 5) {
          if (!effectiveSignature) {
            setErrorMsg('กรุณาลงลายมือชื่อในช่องด้านล่าง');
            canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          } else if (!isAgreedTerms) {
            setErrorMsg('กรุณากดยอมรับกฎระเบียบและเงื่อนไขของหอพัก');
            document.querySelector('[data-testid="tenant-agree-terms-checkbox"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        } else {
          if (invalid.includes(1)) setErrorMsg('กรุณาเลือกห้องพักและระบุวันเข้าพัก (ขั้นตอนที่ 1)');
          else if (invalid.includes(2)) setErrorMsg('กรุณากรอกข้อมูลผู้เช่าและข้อมูลบัตรประชาชนให้ครบถ้วน (ขั้นตอนที่ 2)');
          else if (invalid.includes(3)) setErrorMsg('กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉินให้ครบถ้วน (ขั้นตอนที่ 3)');
          goToStep(invalid[0]);
        }
        return;
      }
    }

    setSubmittingRegistration(true);

    try {
      const effectivePrefix = getEffectivePrefix();
      const displayName = fullName.startsWith(effectivePrefix) ? fullName : `${effectivePrefix} ${fullName}`.trim();
      const nameParts = fullName.trim().split(/\s+/);
      const rawFirstName = nameParts[0] || fullName.trim();
      const firstName = rawFirstName;
      const lastName = nameParts.slice(1).join(' ').trim() || '-';
      const activeVehicles = vehiclesList.filter((v) => v.type !== 'none');
      const serializedVehicles = activeVehicles.map((v) => ({
        type: v.type,
        brand: v.brand === 'อื่นๆ' || v.type === 'bicycle' ? (v.customBrand || v.brand || 'จักรยาน').trim() : v.brand,
        licensePlate: v.type === 'bicycle' ? '-' : v.licensePlate.trim(),
      }));
      const primaryVehicle = serializedVehicles[0];

      const serializedPets = hasPet
        ? petsList.map((p) => ({
          type: p.type,
          customType: p.type === 'other' ? p.customType.trim() : undefined,
          name: p.name.trim(),
          count: p.count,
        }))
        : [];
      const primaryPet =
        hasPet && petsList.length > 0
          ? {
            hasPet: true,
            type: petsList[0].type === 'other' ? (petsList[0].customType.trim() || 'อื่นๆ') : petsList[0].type,
            name: petsList[0].name.trim(),
            count: petsList[0].count,
          }
          : undefined;

      // Scenario A: Owner-Created Claim Flow (Bypasses Owner Approval -> REGISTERED)
      if (isClaimCandidateRoom && isClaimVerified && claimedTenantId) {
        const res = await completeTenantClaim({
          dormitoryId: targetDormId || dormitoryId,
          inviteToken,
          roomId: selectedRoomId,
          tenantId: claimedTenantId,
          claimVerificationToken: claimVerificationToken || undefined,
          signatureBase64: effectiveSignature,
          displayName,
          firstName,
          lastName,
          phone: phone.trim(),
          citizenId: citizenId.trim(),
          birthDate,
          address,
          idCardImageUrl: idCardImage || undefined,
          depositSlipImageUrl: depositStatus === 'paid' && depositSlipImage ? depositSlipImage : undefined,
          depositDeclaredStatus: depositStatus === 'paid' ? 'PAID' : 'UNPAID',
          emergencyContact: emergencyName.trim() ? {
            name: emergencyName.trim(),
            relationship: getEffectiveEmergencyRel(),
            phone: emergencyPhone.trim() || phone.trim()
          } : undefined,
          vehicle: primaryVehicle,
          vehicles: serializedVehicles,
          pet: primaryPet,
          pets: serializedPets,
          coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
            name: c.name,
            phone: c.phone,
            citizenId: c.citizenId
          })) : undefined,
        });

        if (res.success) {
          const successObj = {
            status: 'REGISTERED',
            label: 'ลงทะเบียนผู้เช่า',
            message: 'ยืนยันสิทธิ์ผู้เช่าและบันทึกสัญญาเรียบร้อยแล้ว',
            data: res.data?.tenant || res.data
          };
          setSubmissionSuccess(successObj);
          if (onSuccess) onSuccess(res.data?.tenant || res.data);
          return;
        } else {
          setErrorMsg(res.error?.message || 'ไม่สามารถยืนยันสิทธิ์ได้ กรุณาลองใหม่อีกครั้ง');
          return;
        }
      }

      // Scenario Strict Two-Phase Confirmation: Tenant Final Review + Digital Signature
      if (isAwaitingTenantConfirmation) {
        const res = await confirmApprovedRegistration(revisionRequest.id, {
          signatureBase64: effectiveSignature,
          dormitoryId: targetDormId || dormitoryId || revisionRequest.dormitoryId || dormInfo?.id,
        });

        if (res.success) {
          const successObj = {
            status: 'REGISTERED',
            label: 'ใช้งานได้แล้ว',
            message: 'ยืนยันสัญญาเช่าและเปิดใช้งานห้องพักเรียบร้อยแล้ว',
            data: res.data?.tenant || res.data
          };
          setSubmissionSuccess(successObj);
          if (onSuccess) onSuccess(res.data?.tenant || res.data);
          return;
        } else {
          setErrorMsg(res.error?.message || 'ไม่สามารถยืนยันสัญญาเช่าได้ กรุณาลองใหม่อีกครั้ง');
          return;
        }
      }

      const resolvedLineDisplayName =
        existingTenantProfile?.lineDisplayName ||
        existingTenantProfile?.lineName ||
        revisionRequest?.lineDisplayName ||
        revisionRequest?.lineName ||
        revisionRequest?.acceptanceSnapshot?.lineDisplayName ||
        undefined;

      // Scenario Option B: Revision Resubmission
      if (revisionRequest) {
        const res = await resubmitTenantRegistrationRequest(revisionRequest.id, {
          dormitoryId: targetDormId || dormitoryId,
          inviteToken,
          lineDisplayName: resolvedLineDisplayName,
          requestedRoomId: selectedRoom?.id || selectedRoomId,
          prefix: getEffectivePrefix(),
          customPrefix: prefix === 'ระบุเอง' || prefix === 'กำหนดเอง' ? customPrefix.trim() : undefined,
          firstName,
          lastName,
          phone: phone.trim(),
          email: email.trim(),
          note: `แก้ไขคำขอตามที่เจ้าของหอพักร้องขอ: ${revisionRequest.rejectedReason || ''}`,
          agreedTerms: true,
          signatureBase64: effectiveSignature,
          expectedPolicyVersion: policyData?.version || 1,
          rentalPlan: rentPlan,
          proposedRent: rentAmount,
          proposedDeposit: depositAmount,
          durationMonths: durationValue,
          startDate: checkInDate,
          endDate,
          citizenId: citizenId.trim(),
          birthDate,
          address,
          idCardImageUrl: idCardImage || '',
          depositSlipImageUrl: depositStatus === 'paid' ? depositSlipImage || '' : '',
          depositDeclaredStatus: depositStatus === 'paid' ? 'PAID' : 'UNPAID',
          isInstallmentRequested: isInstallment,
          selectedInstallmentPlan: isInstallment ? `${installmentMonths}_terms` : null,
          installments: isInstallment ? installmentSchedule.map(s => ({ installmentNumber: s.period, amount: s.totalAmount, rentAmount: s.rentAmount, depositAmount: s.depositAmount, dueDate: s.dueDate, note: s.depositNote })) : [],
          emergencyContact: emergencyName.trim() ? {
            name: emergencyName.trim(),
            relationship: getEffectiveEmergencyRel(),
            phone: emergencyPhone.trim() || phone.trim()
          } : undefined,
          coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
            name: c.name,
            phone: c.phone,
            citizenId: c.citizenId
          })) : [],
          vehicle: primaryVehicle,
          vehicles: serializedVehicles,
          pet: primaryPet,
          pets: serializedPets,
          terms: getDormRulesText(),
        });

        if (res.success) {
          try {
            localStorage.setItem('pending_tenant_registration', JSON.stringify(res.data));
          } catch { }
          const successObj = {
            status: 'pending_owner_approval',
            label: 'รออนุมัติคำขอผู้เช่า',
            message: 'ส่งข้อมูลที่แก้ไขเรียบร้อยแล้ว กรุณารอเจ้าของหอพักตรวจสอบ',
            data: res.data
          };
          setSubmissionSuccess(successObj);
          if (onSuccess) onSuccess(res.data);
          return;
        } else if (res.error?.code !== 'REGISTRATION_REQUEST_NOT_FOUND' && res.error?.code !== 'INVALID_REQUEST_STATUS' && !res.error?.message?.includes('ไม่พบคำขอลงทะเบียน')) {
          setErrorMsg(res.error?.message || 'ไม่สามารถส่งข้อมูลแก้ไขได้ กรุณาลองใหม่อีกครั้ง');
          return;
        }
      }

      // Scenario B: Public Self-Registration (Vacant Room)
      const effectiveDormId = targetDormId || selectedRoom?.dormitoryId || dormitoryId || dormInfo?.id;
      let effectiveVersion = policyData?.version || 1;
      if (effectiveDormId && effectiveDormId !== 'dorm-1') {
        try {
          const pRes = await getPublicDormitoryPolicy(effectiveDormId);
          if (pRes.success && pRes.data?.version) {
            effectiveVersion = pRes.data.version;
            setPolicyData((prev: any) => ({ ...(prev || {}), ...pRes.data }));
          }
        } catch { }
      }

      const res = await submitTenantRegistrationRequest({
        dormitoryId: effectiveDormId,
        inviteToken,
        lineDisplayName: resolvedLineDisplayName,
        requestedRoomId: selectedRoom?.id || selectedRoomId,
        prefix: getEffectivePrefix(),
        customPrefix: prefix === 'ระบุเอง' || prefix === 'กำหนดเอง' ? customPrefix.trim() : undefined,
        firstName,
        lastName,
        phone: phone.trim(),
        email: email.trim() || undefined,
        agreedTerms: true,
        signatureBase64: effectiveSignature,
        expectedPolicyVersion: effectiveVersion,
        rentalPlan: rentPlan,
        proposedRent: rentAmount,
        proposedDeposit: depositAmount,
        durationMonths: durationValue,
        startDate: checkInDate,
        citizenId: citizenId.trim(),
        birthDate,
        address,
        idCardImageUrl: idCardImage || undefined,
        depositSlipImageUrl: depositSlipImage || undefined,
        depositDeclaredStatus: depositStatus === 'paid' ? 'PAID' : 'UNPAID',
        isInstallmentRequested: isInstallment,
        selectedInstallmentPlan: isInstallment ? (installmentMonths === 2 ? '2_terms' : installmentMonths === 3 ? '3_terms' : `${installmentMonths}_terms`) : undefined,
        installments: isInstallment ? installmentSchedule.map(s => ({ installmentNumber: s.period, amount: s.totalAmount, rentAmount: s.rentAmount, depositAmount: s.depositAmount, dueDate: s.dueDate, note: s.depositNote })) : undefined,
        emergencyContact: emergencyName.trim() ? {
          name: emergencyName.trim(),
          relationship: getEffectiveEmergencyRel(),
          phone: emergencyPhone.trim() || phone.trim()
        } : undefined,
        coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
          name: c.name,
          phone: c.phone,
          citizenId: c.citizenId
        })) : undefined,
        vehicle: primaryVehicle,
        vehicles: serializedVehicles,
        pet: primaryPet,
        pets: serializedPets,
        terms: getDormRulesText(),
      });

      if (res.success) {
        try {
          localStorage.setItem('pending_tenant_registration', JSON.stringify(res.data));
        } catch { }
        const successObj = {
          status: 'pending_owner_approval',
          label: 'รออนุมัติคำขอผู้เช่า',
          message: 'ส่งคำขอลงทะเบียนเรียบร้อยแล้ว กรุณารอเจ้าของหอพักอนุมัติ',
          data: res.data
        };
        setSubmissionSuccess(successObj);
        if (onSuccess) onSuccess(res.data);
      } else {
        setErrorMsg(res.error?.message || 'ไม่สามารถส่งคำขอลงทะเบียนได้ กรุณาลองใหม่อีกครั้ง');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการส่งคำขอ');
    } finally {
      setSubmittingRegistration(false);
    }
  };

  // 1. If registration/claim completed successfully, show completion screen
  if (submissionSuccess) {
    return (
      <div className="min-h-[520px] flex flex-col items-center justify-center p-6 text-center space-y-4 bg-white rounded-3xl border border-slate-100 shadow-sm w-full max-w-sm mx-auto my-6">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${submissionSuccess.status === 'REGISTERED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
          }`}>
          {submissionSuccess.status === 'REGISTERED' ? (
            <CheckCircle2 className="w-8 h-8" />
          ) : (
            <Clock className="w-8 h-8 animate-pulse" />
          )}
        </div>

        <div className="space-y-1.5">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-black border bg-slate-50 text-slate-700 border-slate-200">
            สถานะ: {submissionSuccess.label}
          </span>
          <h3 className="font-black text-slate-900 text-base">
            {submissionSuccess.status === 'REGISTERED'
              ? 'ลงทะเบียนและยืนยันสิทธิ์สำเร็จ!'
              : submissionSuccess.status === 'PENDING_DAILY_STAY'
                ? 'ส่งคำขอเรียบร้อยแล้ว'
                : 'ส่งคำขอลงทะเบียนเรียบร้อยแล้ว'}
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {submissionSuccess.message}
          </p>
        </div>

        {submissionSuccess.status === 'pending_owner_approval' && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-800 text-left space-y-1 w-full">
            <p className="font-bold">ขั้นตอนต่อไป:</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
              <li>เจ้าของหอพักจะตรวจสอบข้อมูลและอนุมัติคำขอ</li>
              <li>เมื่อได้รับการอนุมัติ คุณจะได้รับแจ้งให้ตรวจสอบและลงนามดิจิทัลเพื่อเปิดใช้งานห้องพัก</li>
              <li>หากมีข้อมูลที่ต้องแก้ไข เจ้าของหอพักจะส่งคำขอ "กรุณาตรวจสอบอีกครั้ง"</li>
            </ul>
          </div>
        )}

        {submissionSuccess.status === 'PENDING_DAILY_STAY' && (
          <div className="p-3 bg-sky-50 border border-sky-200 rounded-2xl text-[11px] text-sky-800 text-left space-y-1 w-full">
            <p className="font-bold">ขั้นตอนต่อไป:</p>
            <ul className="list-disc list-inside space-y-0.5 text-slate-600">
              <li>เจ้าของหอพักจะตรวจสอบคำขอเข้าพักรายวันและข้อมูลการชำระเงิน</li>
              <li>เจ้าของหอพักจะติดต่อกลับเพื่อนัดหมายการรับกุญแจและเช็คอิน</li>
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            if (onBack) onBack();
          }}
          className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all shadow-xs cursor-pointer"
        >
          กลับสู่หน้าหลัก
        </button>
      </div>
    );
  }

  // Canonical Status Label badge
  const getStatusBadge = () => {
    if (isAwaitingTenantConfirmation) {
      return (
        <span className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[9px] rounded-full flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-emerald-600" />
          กรุณาตรวจสอบและยืนยัน
        </span>
      );
    }
    if (revisionRequest) {
      return (
        <span className="px-2.5 py-1 bg-rose-50 border border-rose-200 text-rose-700 font-black text-[9px] rounded-full flex items-center gap-1">
          <AlertCircle className="w-3 h-3 text-rose-600" />
          กรุณาตรวจสอบอีกครั้ง
        </span>
      );
    }
    if (isClaimCandidateRoom && !isClaimVerified) {
      return (
        <span className="px-2.5 py-1 bg-violet-50 border border-violet-200 text-violet-700 font-black text-[9px] rounded-full flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-violet-600" />
          กรุณาตรวจสอบและยืนยัน
        </span>
      );
    }
    return (
      <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 font-black text-[9px] rounded-full flex items-center gap-1">
        <UserCheck className="w-3 h-3 text-indigo-600" />
        ลงทะเบียนผู้เช่า
      </span>
    );
  };

  // Dedicated Pending Owner Approval Status View (If user enters registration while their request is pending)
  const isPendingApproval =
    revisionRequest?.status === 'pending_owner_approval' ||
    existingTenantProfile?.status === 'pending_owner_approval' ||
    existingTenantProfile?.pendingRequest?.status === 'pending_owner_approval';

  if (isPendingApproval) {
    const pendingRoomNum =
      revisionRequest?.requestedRoomNumber ||
      revisionRequest?.roomNumber ||
      existingTenantProfile?.pendingRequest?.requestedRoomNumber ||
      existingTenantProfile?.pendingRequest?.roomNumber ||
      '';

    return (
      <div className="h-full max-h-full flex-1 flex flex-col bg-slate-50 relative overflow-hidden" data-testid="tenant-register-pending-screen">
        <div className="shrink-0 z-30 bg-white border-b border-slate-100 shadow-2xs">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {onBack && (
                <button
                  type="button"
                  onClick={onBack}
                  className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                  aria-label="ย้อนกลับ"
                >
                  <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
                </button>
              )}
              <h3 className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                <span>สถานะคำขอลงทะเบียน</span>
              </h3>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[9px] font-black bg-amber-50 border border-amber-200 text-amber-800">
              รอการอนุมัติ
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shadow-sm animate-pulse">
            <Clock className="w-8 h-8" />
          </div>
          <div className="space-y-1.5 max-w-xs">
            <h4 className="text-base font-black text-slate-900">คำขอของคุณอยู่ระหว่างการตรวจสอบ</h4>
            <p className="text-xs text-slate-500 leading-relaxed">
              คำขอลงทะเบียน{pendingRoomNum ? `ห้อง ${pendingRoomNum}` : 'ห้องพัก'} ถูกส่งถึงเจ้าของหอพักเรียบร้อยแล้ว เมื่อได้รับการอนุมัติระบบจะเปิดใช้งานห้องพักให้คุณทันที
            </p>
          </div>
          <div className="w-full max-w-xs pt-3">
            <button
              type="button"
              onClick={onBack}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs shadow-md shadow-indigo-600/20 cursor-pointer transition-all active:scale-98"
            >
              กลับสู่หน้าหลัก (แดชบอร์ด)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Dedicated Room Picker View (Search + Room Cards + Plan Bottom Sheet)
  if (viewState === 'room_picker') {
    const query = roomSearchQuery.trim().toLowerCase();
    const filteredRooms = rooms.filter((r) => {
      if (!query) return true;
      const numMatch = (r.roomNumber || '').toLowerCase().includes(query);
      const bMatch = (r.buildingName || '').toLowerCase().includes(query);
      return numMatch || bMatch;
    });

    return (
      <div className="min-h-full flex flex-col bg-slate-50 relative pb-28">
        {/* Top Header */}
        <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-2xs">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                data-testid="btn-room-picker-back"
                onClick={onBack}
                className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
                aria-label="ย้อนกลับ"
              >
                <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
              </button>
              <div>
                <span className="text-[10px] font-extrabold text-indigo-600 block">ลงทะเบียนผู้เช่าใหม่</span>
                <h3 className="font-black text-slate-900 text-sm flex items-center gap-1.5">
                  <DoorOpen className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>เลือกห้องพัก</span>
                </h3>
              </div>
            </div>
            <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 font-black text-[10px] rounded-full">
              {filteredRooms.length} ห้อง
            </span>
          </div>

          {/* Search Box */}
          <div className="px-4 pb-3 pt-1">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                data-testid="room-search-input"
                value={roomSearchQuery}
                onChange={(e) => setRoomSearchQuery(e.target.value)}
                placeholder="ค้นหาเลขห้อง หรือ อาคาร/ตึก..."
                className="w-full pl-9 pr-8 py-2.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 focus:border-indigo-500 rounded-2xl text-xs font-bold text-slate-800 focus:outline-none transition-all"
              />
              {roomSearchQuery && (
                <button
                  type="button"
                  data-testid="btn-clear-search"
                  onClick={() => setRoomSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Room List Grid */}
        <div className="p-4 space-y-3 flex-1">
          {filteredRooms.length === 0 ? (
            <div className="p-8 text-center bg-white rounded-3xl border border-slate-100 text-slate-400 text-xs font-bold">
              ไม่พบห้องพักที่ตรงกับคำค้นหา "{roomSearchQuery}"
            </div>
          ) : (
            filteredRooms.map((r) => {
              const isReservedScheduled = Boolean(
                (r as any).isReservedScheduled ||
                (r as any).hasScheduledRenewal ||
                (r as any).bookingStatus === 'RESERVED_SCHEDULED'
              );
              const normStatus = (r.status || '').trim().toLowerCase();
              const isClaim = Boolean(r.isUnboundClaimable);
              const isMaintenance = normStatus === 'maintenance';
              const isReserved = normStatus === 'reserved';
              const isOccupied =
                normStatus === 'occupied' ||
                (!r.isVacant && (Boolean(r.currentTenantId) || Boolean(r.currentContractId)));
              const isVacant =
                !isClaim &&
                !isOccupied &&
                !isMaintenance &&
                !isReserved &&
                !isReservedScheduled &&
                (r.isVacant === true ||
                  normStatus === 'vacant' ||
                  normStatus === 'available' ||
                  (!r.currentTenantId && !r.currentContractId && r.isVacant !== false));
              const isSelectable = r.selectable !== false && (isVacant || isClaim);

              return (
                <div
                  key={r.id}
                  data-testid={`room-card-${r.roomNumber}`}
                  onClick={() => isSelectable && handleRoomClick(r)}
                  className={`p-4 rounded-2xl border transition-all ${isSelectable
                    ? 'bg-white border-slate-200/80 hover:border-indigo-300 hover:shadow-md cursor-pointer active:scale-[0.99]'
                    : 'bg-slate-50/80 border-slate-200/60 opacity-60 cursor-not-allowed'
                    }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-slate-900 tracking-tight">
                          ห้อง {r.roomNumber}
                        </span>
                        {r.buildingName && (
                          <span className="text-xs font-bold text-slate-500">
                            {r.buildingName}
                          </span>
                        )}
                        {r.floor && (
                          <span className="text-xs text-slate-400 font-medium">
                            · ชั้น {r.floor}
                          </span>
                        )}
                      </div>
                      {isVacant && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {Number(r.termRent) > 0 && (
                            <span className="text-[11px] font-bold text-slate-700">
                              รายเทอม: <span className="font-black text-violet-600">฿{Number(r.termRent).toLocaleString()}</span>
                            </span>
                          )}
                          {Number(r.monthlyRent) > 0 && (
                            <span className="text-[11px] font-bold text-slate-700">
                              รายเดือน: <span className="font-black text-indigo-600">฿{Number(r.monthlyRent).toLocaleString()}</span>
                            </span>
                          )}
                          {Number(r.dailyRent) > 0 && (
                            <span className="text-[11px] font-bold text-slate-700">
                              รายวัน: <span className="font-black text-amber-600">฿{Number(r.dailyRent).toLocaleString()}</span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {isReservedScheduled ? (
                        <span className="px-2.5 py-0.5 bg-amber-50 border border-amber-300 text-amber-800 font-black text-[10px] rounded-full flex items-center gap-1">
                          <CalendarClock className="w-3 h-3 text-amber-600" />
                          <span>ติดจองล่วงหน้า</span>
                        </span>
                      ) : isVacant ? (
                        <span className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[10px] rounded-full">
                          ห้องว่าง
                        </span>
                      ) : isClaim ? (
                        <span className="px-2.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 font-black text-[10px] rounded-full flex items-center gap-1.5 shadow-2xs">
                          <LineLogo className="w-3.5 h-3.5 shrink-0" />
                          <span>รอผูก LINE</span>
                        </span>
                      ) : isMaintenance ? (
                        <span className="px-2.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-500 font-black text-[10px] rounded-full">
                          ปิดปรับปรุง
                        </span>
                      ) : isReserved ? (
                        <span className="px-2.5 py-0.5 bg-amber-50 border border-amber-200 text-amber-700 font-black text-[10px] rounded-full">
                          จองแล้ว
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 bg-rose-50 border border-rose-200 text-rose-700 font-black text-[10px] rounded-full">
                          มีผู้เช่าแล้ว
                        </span>
                      )}

                      {isSelectable && (
                        <span className="text-[10px] font-bold text-indigo-600 flex items-center gap-0.5">
                          <span>เลือกห้องนี้</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Rental Plan Selection Bottom Sheet */}
        <TenantBottomSheet
          isOpen={selectedRoomForPlan !== null}
          onClose={() => setSelectedRoomForPlan(null)}
          title={selectedRoomForPlan ? `เลือกประเภทการเช่า — ห้อง ${selectedRoomForPlan.roomNumber}` : 'เลือกประเภทการเช่า'}
        >
          {selectedRoomForPlan && (
            <div className="space-y-3 pb-6">
              <p className="text-xs text-slate-500 font-medium">
                หอพักนี้เปิดให้เช่าห้อง {selectedRoomForPlan.roomNumber} ในรูปแบบดังต่อไปนี้:
              </p>

              <div className="space-y-2.5">
                {/* 1. Term Plan */}
                {Number(selectedRoomForPlan.termRent) > 0 && (
                  <button
                    type="button"
                    data-testid="plan-select-term"
                    onClick={() => handleSelectPlan(selectedRoomForPlan, 'term')}
                    className="w-full p-4 rounded-2xl border-2 border-violet-100 hover:border-violet-600 hover:bg-violet-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900 group-hover:text-violet-600">
                          รายเทอม (Term)
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        ค่าเช่า ฿{Number(selectedRoomForPlan.termRent).toLocaleString()} / เทอม
                      </p>
                      <p className="text-[10px] text-slate-400">
                        เงินประกันมัดจำ ฿{Number(selectedRoomForPlan.termDeposit || selectedRoomForPlan.depositAmount || 5000).toLocaleString()}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-violet-600 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}

                {/* 2. Monthly Plan */}
                {(Number(selectedRoomForPlan.monthlyRent) > 0 || (!selectedRoomForPlan.termRent && !selectedRoomForPlan.dailyRent)) && (
                  <button
                    type="button"
                    data-testid="plan-select-monthly"
                    onClick={() => handleSelectPlan(selectedRoomForPlan, 'monthly')}
                    className="w-full p-4 rounded-2xl border-2 border-indigo-100 hover:border-indigo-600 hover:bg-indigo-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900 group-hover:text-indigo-600">
                          รายเดือน (Monthly)
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        ค่าเช่า ฿{Number(selectedRoomForPlan.monthlyRent || 4500).toLocaleString()} / เดือน
                      </p>
                      <p className="text-[10px] text-slate-400">
                        เงินประกันมัดจำ ฿{Number(selectedRoomForPlan.monthlyDeposit || selectedRoomForPlan.depositAmount || 5000).toLocaleString()}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-indigo-600 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}

                {/* 3. Daily Plan */}
                {Number(selectedRoomForPlan.dailyRent) > 0 && (
                  <button
                    type="button"
                    data-testid="plan-select-daily"
                    onClick={() => handleSelectPlan(selectedRoomForPlan, 'daily')}
                    className="w-full p-4 rounded-2xl border-2 border-amber-100 hover:border-amber-600 hover:bg-amber-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900 group-hover:text-amber-600">
                          รายวัน (Daily)
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-500">
                        ค่าเช่า ฿{Number(selectedRoomForPlan.dailyRent).toLocaleString()} / วัน
                      </p>
                      <p className="text-[10px] text-slate-400">
                        เงินประกันมัดจำ ฿{Number(selectedRoomForPlan.dailyDeposit || 0).toLocaleString()}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-amber-600 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
              </div>
            </div>
          )}
        </TenantBottomSheet>

        {/* Tenant Claim Modal for Rooms Waiting to Link LINE */}
        {selectedRoomForClaim && (
          <TenantClaimModal
            isOpen={selectedRoomForClaim !== null}
            onClose={() => setSelectedRoomForClaim(null)}
            dormitoryId={
              dormitoryId ||
              selectedRoomForClaim.dormitoryId ||
              (typeof localStorage !== 'undefined'
                ? localStorage.getItem('selected_dormitory_id') || ''
                : '')
            }
            roomNumber={selectedRoomForClaim.roomNumber}
            roomId={selectedRoomForClaim.id}
            initialClaimInput={
              sanitizeClaimInput(
                existingTenantProfile?.phone && existingTenantProfile?.phone !== '-'
                  ? existingTenantProfile.phone
                  : existingTenantProfile?.name && existingTenantProfile?.name !== '-'
                    ? existingTenantProfile.name
                    : undefined
              )
            }
            allowAdditionalRoom={!!existingTenantProfile}
            onSuccess={(msg) => {
              const claimedRoom = selectedRoomForClaim;
              setSelectedRoomForClaim(null);
              if (onSuccess) {
                onSuccess({
                  message: msg,
                  roomId: claimedRoom.id,
                  name: claimedRoom.candidate?.maskedName || 'ผู้เช่า',
                });
              } else {
                window.location.href = '/tenant';
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="h-full max-h-full flex-1 flex flex-col bg-slate-50 relative overflow-hidden">
      {/* Top Header with Progress Step Bar */}
      <div className="shrink-0 z-30 bg-white border-b border-slate-100 shadow-2xs">
        {/* Main Title Row */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={!isRevisionOrConfirmation && !initialRoomId ? () => setViewState('room_picker') : onBack}
              className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500 transition-colors cursor-pointer"
              aria-label="ย้อนกลับ"
            >
              <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
            </button>
            <div>
              <h3 className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>ลงทะเบียนผู้เช่าใหม่</span>
              </h3>
              <p className="text-[9px] text-slate-400 font-medium">
                ขั้นตอน <span className="font-extrabold text-indigo-600">{activeStep}</span>/{stepsList.length}: {stepsList[activeStep - 1]?.label}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {getStatusBadge()}
            <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 font-black text-[9px] rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-pulse"></span>
              {Math.round((activeStep / stepsList.length) * 100)}%
            </span>
          </div>
        </div>

        {/* Minimal Steps Navigation Bar */}
        <div className="px-3 pb-2 pt-0.5 overflow-x-auto no-scrollbar flex items-center justify-between gap-1 border-t border-slate-50">
          {stepsList.map((item) => {
            const isActive = activeStep === item.step;
            const isInvalid = invalidSteps.includes(item.step);
            const isCompleted = activeStep > item.step && !isInvalid;
            const isLocked = rentPlan !== 'daily' && item.step === 5 && !isPreContractValid;

            return (
              <button
                key={item.step}
                type="button"
                data-testid={`step-indicator-${item.step}`}
                onClick={() => goToStep(item.step)}
                title={isLocked ? 'กรุณากรอกข้อมูลขั้นตอนที่ 1-4 ให้ครบถ้วนก่อนเปิดดูสัญญา' : undefined}
                className={`flex-1 min-w-[42px] py-1 px-1 rounded-xl transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${isInvalid
                  ? 'bg-rose-500 text-white font-extrabold border border-rose-600 shadow-xs animate-pulse'
                  : isActive
                    ? 'bg-indigo-600 text-white font-extrabold shadow-xs scale-102'
                    : isLocked
                      ? 'bg-slate-100 text-slate-400 font-medium border border-slate-200/80 cursor-not-allowed opacity-75'
                      : isCompleted
                        ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-100'
                        : 'bg-slate-50 hover:bg-slate-100 text-slate-400 font-semibold border border-slate-100'
                  }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-black ${isInvalid
                    ? 'bg-white text-rose-600'
                    : isActive
                      ? 'bg-white text-indigo-700'
                      : isLocked
                        ? 'bg-slate-200 text-slate-400'
                        : isCompleted
                          ? 'bg-indigo-200 text-indigo-900'
                          : 'bg-slate-200/80 text-slate-500'
                    }`}>
                    {isInvalid ? '!' : isLocked ? <Lock className="w-2.5 h-2.5 text-slate-400" /> : isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : item.step}
                  </span>
                </div>
                <span className="text-[8px] truncate max-w-full leading-tight font-medium">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Dynamic Progress Line */}
        <div className="w-full bg-slate-100 h-1 overflow-hidden">
          <div
            className="bg-indigo-600 h-full transition-all duration-300 ease-out"
            style={{ width: `${(activeStep / stepsList.length) * 100}%` }}
          />
        </div>
      </div>

      <form noValidate onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
        {/* Scrollable Form Body */}
        <div id="tenant-registration-scroll-body" className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-5">
          {/* Two-Phase Approved Confirmation Notice */}
          {isAwaitingTenantConfirmation && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-3xl flex items-start gap-3 text-emerald-900 text-xs animate-in fade-in duration-200">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="font-extrabold text-emerald-950 text-xs flex items-center gap-1.5">
                  <span>เจ้าของหอพักอนุมัติคำขอของคุณแล้ว (กรุณาตรวจสอบและยืนยัน)</span>
                </h5>
                <p className="text-[11px] text-emerald-800">
                  กรุณาตรวจสอบเงื่อนไขสัญญาเช่า และลงนามดิจิทัลในขั้นตอนที่ 5 เพื่อยืนยันการเปิดใช้งานห้องพัก
                </p>
              </div>
            </div>
          )}

          {/* Option B: Revision Reason Notice */}
          {revisionRequest && revisionRequest.status !== 'pending_owner_approval' && !isAwaitingTenantConfirmation && (
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-3xl flex items-start gap-3 text-rose-900 text-xs animate-in fade-in duration-200">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h5 className="font-extrabold text-rose-950 text-xs flex items-center gap-1.5">
                  <span>คำขอถูกส่งกลับเพื่อแก้ไข (กรุณาตรวจสอบอีกครั้ง)</span>
                </h5>
                <p className="text-[11px] text-rose-800">
                  เจ้าของหอพักระบุ: <span className="font-bold">{revisionRequest.rejectedReason || revisionRequest.acceptanceSnapshot?.currentOwnerComment || 'กรุณาตรวจสอบและแก้ไขข้อมูลให้ถูกต้อง'}</span>
                </p>
              </div>
            </div>
          )}

          {/* SECTION 1: ห้องพักที่เลือก (SELECTED ROOM SUMMARY & FINANCIALS) */}
          <div id="step-1" className={`bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28 ${activeStep === 1 ? 'block' : 'hidden'}`}>
            <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
                  1
                </div>
                <div>
                  <h4 className="font-black text-slate-900 text-xs">ห้องพักอาศัย</h4>
                  <p className="text-[9px] text-slate-400">รูปแบบสัญญาเช่าและเงินมัดจำ</p>
                </div>
              </div>
              {!isRevisionOrConfirmation && (
                <button
                  type="button"
                  data-testid="btn-change-room"
                  onClick={() => setViewState('room_picker')}
                  className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-[11px] flex items-center gap-1 transition-colors cursor-pointer border border-indigo-100"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>เปลี่ยนห้อง</span>
                </button>
              )}
            </div>

            {/* Selected Room Summary Box */}
            <div className="p-3.5 bg-gradient-to-r from-indigo-50/70 to-slate-50 border border-indigo-100/80 rounded-2xl flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-slate-900">
                    ห้อง {selectedRoom ? selectedRoom.roomNumber : '-'}
                  </span>
                  {selectedRoom?.buildingName && (
                    <span className="text-xs font-bold text-slate-500">
                      {selectedRoom.buildingName}
                    </span>
                  )}
                  {selectedRoom?.floor && (
                    <span className="text-xs text-slate-400 font-medium">
                      · ชั้น {selectedRoom.floor}
                    </span>
                  )}
                </div>
                <div data-testid="tenant-locked-rent-plan" className="flex items-center gap-2 text-xs">
                  <span className="font-extrabold text-indigo-700">
                    {rentPlan === 'daily' ? 'รายวัน' : rentPlan === 'term' ? 'รายเทอม' : 'รายเดือน'}
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="font-black text-slate-800">
                    ฿{rentAmount?.toLocaleString()} {rentPlan === 'daily' ? '/วัน' : rentPlan === 'term' ? '/เทอม' : '/เดือน'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-slate-400 block">เงินประกันมัดจำ</span>
                <span className="text-xs font-black text-slate-700">฿{depositAmount?.toLocaleString()}</span>
              </div>
            </div>

            {/* Hidden accessible select for test compatibility */}
            <select
              data-testid="tenant-registration-room-select"
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setIsClaimVerified(false);
                setClaimVerificationToken(null);
                setClaimedTenantId(null);
                setLockedFinancials(null);
                setClaimVerificationError(null);
              }}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            >
              {rooms.map((r) => {
                const isSelectable = r.selectable !== false;
                const normStatus = (r.status || '').trim().toLowerCase();
                const isRoomVacant =
                  r.isVacant ||
                  normStatus === 'vacant' ||
                  normStatus === 'available' ||
                  (!r.currentTenantId && !r.currentContractId && normStatus !== 'maintenance' && normStatus !== 'reserved');
                const label = r.badgeLabel || (
                  r.isUnboundClaimable
                    ? 'ยังไม่ผูก LINE (ยืนยันสิทธิ์)'
                    : isRoomVacant
                      ? 'ห้องว่าง'
                      : normStatus === 'maintenance'
                        ? 'ปิดปรับปรุง'
                        : normStatus === 'reserved'
                          ? 'จองแล้ว (ผูก LINE แล้ว)'
                          : 'มีผู้เช่าแล้ว (ผูก LINE แล้ว)'
                );
                return (
                  <option key={r.id} value={r.id} disabled={!isSelectable}>
                    ห้อง {r.roomNumber} - {label} {!isSelectable ? '(ไม่สามารถเลือกได้)' : ''}
                  </option>
                );
              })}
            </select>

            {/* Scenario A: Single-Field Claim Identity Verification */}
            {isClaimCandidateRoom && (
              <div className="p-4 bg-indigo-50/70 border-2 border-indigo-200 rounded-2xl space-y-2.5 mt-2 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-black rounded-full border border-indigo-200 flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-indigo-600" />
                    กรุณาตรวจสอบและยืนยัน
                  </span>
                  {selectedRoom?.candidate?.maskedName && (
                    <span className="text-[10px] font-bold text-slate-500">
                      ผู้เช่า: {selectedRoom.candidate.maskedName} {selectedRoom.candidate.maskedPhone ? `(${selectedRoom.candidate.maskedPhone})` : ''}
                    </span>
                  )}
                </div>

                {!isClaimVerified ? (
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold text-indigo-950">
                      ห้องนี้ถูกสร้างโดยเจ้าของหอพักแล้ว (ยังไม่ผูก LINE) กรุณากรอกชื่อ-นามสกุล หรือ เบอร์โทรศัพท์ เพื่อดึงข้อมูลและยืนยันสิทธิ์
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        data-testid="tenant-claim-input"
                        value={claimInput}
                        onChange={(e) => setClaimInput(e.target.value)}
                        placeholder="ชื่อ-นามสกุล หรือ เบอร์โทรศัพท์ เช่น สมชาย หรือ 0812345678"
                        className="flex-1 px-3 py-2 bg-white border border-indigo-200 rounded-xl text-xs font-bold focus:outline-none focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        data-testid="tenant-claim-verify-btn"
                        disabled={isClaimVerifying || !claimInput.trim()}
                        onClick={handleVerifyClaim}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        {isClaimVerifying ? 'กำลังตรวจสอบ...' : 'ตรวจสอบสิทธิ์'}
                      </button>
                    </div>
                    {claimVerificationError && (
                      <p className="text-[10px] font-bold text-rose-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" /> {claimVerificationError}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-emerald-900 text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-bold">ยืนยันตัวตนสำเร็จ ข้อมูลสัญญาและค่าเช่าถูกล็อกตามที่เจ้าของหอพักกำหนด</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* FINANCIALS & RENT PLAN (MERGED FROM OLD STEP 3) */}
            <div className="space-y-3.5 pt-2 border-t border-slate-100 text-[10px]">
              {isClaimVerified && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center gap-2 text-indigo-900 text-xs font-bold animate-in fade-in duration-200">
                  <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>ข้อมูลสัญญาและค่าเช่าถูกกำหนดโดยเจ้าของหอพักแล้ว (ล็อกไม่สามารถแก้ไขได้)</span>
                </div>
              )}

              {rentPlan === 'daily' && (
                <div className="space-y-3.5 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600">วันเริ่มเข้าพัก (Check-in) *</label>
                      <OwnerDateInput
                        required
                        data-testid="daily-checkin-date-input"
                        value={checkInDate}
                        onChange={(iso) => {
                          setCheckInDate(iso);
                          setContractDate(iso);
                        }}
                        className={`px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 ${highlightErrors && !checkInDate ? 'border-rose-400 bg-rose-50/40' : ''}`}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600">วันสิ้นสุดเข้าพัก (Check-out) *</label>
                      <OwnerDateInput
                        required
                        data-testid="daily-checkout-date-input"
                        value={dailyEndDate}
                        min={checkInDate}
                        onChange={(iso) => setDailyEndDate(iso)}
                        className={`px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 ${highlightErrors && !dailyEndDate ? 'border-rose-400 bg-rose-50/40' : ''}`}
                      />
                    </div>
                  </div>

                  {/* Summary calculation card */}
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-bold">จำนวนวันที่เข้าพัก:</span>
                      <span className="font-extrabold text-slate-900 text-xs">{dailyNights} วัน ({dailyNights} คืน)</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-600 font-bold">อัตราค่าเช่ารายวัน:</span>
                      <span className="font-extrabold text-slate-900 text-xs">฿ {Number(rentAmount).toLocaleString()} / วัน</span>
                    </div>
                    <div className="flex justify-between items-center border-t border-slate-200 pt-1.5">
                      <span className="text-indigo-900 font-black">รวมค่าห้องพัก:</span>
                      <span className="font-black text-indigo-700 text-sm">฿ {(rentAmount * dailyNights).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Deposit Amount & Status */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600">ค่าประกัน / ค่ามัดจำ (บาท) *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={depositAmount ? String(depositAmount).replace(/^0+(?=\d)/, '') : (depositAmount === 0 ? '0' : '')}
                        onChange={(e) => {
                          const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                          setDepositAmount(clean === '' ? 0 : parseInt(clean, 10));
                        }}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600">สถานะเงินมัดจำ</label>
                      <div className="grid grid-cols-2 gap-1">
                        <button
                          type="button"
                          onClick={() => setDepositStatus('paid')}
                          className={`py-2 px-1 text-[9px] font-bold rounded-xl border text-center transition-all ${depositStatus === 'paid' ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' : 'bg-white border-slate-200 text-slate-700'}`}
                        >
                          ชำระแล้ว
                        </button>
                        <button
                          type="button"
                          onClick={() => setDepositStatus('unpaid')}
                          className={`py-2 px-1 text-[9px] font-bold rounded-xl border text-center transition-all ${depositStatus === 'unpaid' ? 'bg-rose-600 text-white border-rose-600 shadow-xs' : 'bg-white border-slate-200 text-slate-700'}`}
                        >
                          ยังไม่ชำระ
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {rentPlan !== 'daily' && (
                <>
                  {/* Rent Amount & Deposit Amount Inputs */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600 flex items-center gap-1">
                        <span>ค่าเช่าต่อรอบ {rentPlan === 'monthly' ? '(บาท/เดือน)' : '(บาท/เทอม)'} *</span>
                        {isFinancialsLocked && <Lock className="w-3 h-3 text-slate-400" />}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          data-testid="tenant-proposed-rent-input"
                          inputMode="numeric"
                          required
                          readOnly={isFinancialsLocked}
                          disabled={isFinancialsLocked}
                          value={rentAmount ? String(rentAmount).replace(/^0+(?=\d)/, '') : (rentAmount === 0 ? '0' : '')}
                          onChange={(e) => {
                            const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                            setRentAmount(clean === '' ? 0 : parseInt(clean, 10));
                          }}
                          className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-black text-xs ${isFinancialsLocked ? 'bg-slate-100 border-slate-200 opacity-75' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500'
                            }`}
                        />
                        <span className="absolute right-3 top-2 text-[10px] text-slate-400 font-bold">บาท</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="block font-bold text-slate-600 flex items-center gap-1">
                        <span>ค่าประกัน / ค่ามัดจำ (บาท) *</span>
                        {isFinancialsLocked && <Lock className="w-3 h-3 text-slate-400" />}
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          data-testid="tenant-proposed-deposit-input"
                          inputMode="numeric"
                          required
                          readOnly={isFinancialsLocked}
                          disabled={isFinancialsLocked}
                          value={depositAmount ? String(depositAmount).replace(/^0+(?=\d)/, '') : (depositAmount === 0 ? '0' : '')}
                          onChange={(e) => {
                            const clean = e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
                            setDepositAmount(clean === '' ? 0 : parseInt(clean, 10));
                          }}
                          className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-black text-xs ${isFinancialsLocked ? 'bg-slate-100 border-slate-200 opacity-75' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500'
                            }`}
                        />
                        <span className="absolute right-3 top-2 text-[10px] text-slate-400 font-bold">บาท</span>
                      </div>
                    </div>
                  </div>

                  {/* Deposit Status Switch: Paid / Unpaid */}
                  <div className="space-y-1.5 pt-1">
                    <label className="block font-bold text-slate-600 flex justify-between items-center">
                      <span>การชำระเงินมัดจำ / ประกัน *</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDepositStatus('paid')}
                        className={`py-2 px-3 rounded-xl border text-center font-black flex items-center justify-center gap-1.5 transition-all ${depositStatus === 'paid'
                          ? 'bg-emerald-500 text-white border-emerald-500 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>มัดจำ : จ่ายแล้ว</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDepositStatus('unpaid')}
                        className={`py-2 px-3 rounded-xl border text-center font-black flex items-center justify-center gap-1.5 transition-all ${depositStatus === 'unpaid'
                          ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>มัดจำ : ยังไม่จ่าย</span>
                      </button>
                    </div>
                  </div>

                  {/* Deposit Slip Upload Section for Paid Deposit (Single Frame) */}
                  {depositStatus === 'paid' && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                      <label className="block font-bold text-slate-700 flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <Paperclip className="w-3.5 h-3.5 text-indigo-600" />
                          <span>แนบหลักฐานการชำระเงินมัดจำ / สลิปโอนเงิน</span>
                        </span>
                        <span className="text-[9px] text-indigo-600 font-normal">
                          (รองรับไฟล์ JPG, PNG)
                        </span>
                      </label>

                      {depositSlipImage ? (
                        <div className="relative w-full rounded-2xl overflow-hidden border-2 border-emerald-200 bg-slate-50 shadow-xs">
                          <img
                            src={depositSlipImage}
                            alt="หลักฐานการชำระเงินมัดจำ"
                            className="w-full max-h-60 object-contain mx-auto rounded-xl p-1"
                          />
                          <button
                            type="button"
                            data-testid="btn-remove-deposit-slip"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDepositSlipImage(null);
                            }}
                            className="absolute top-2.5 right-2.5 p-2 bg-white/95 hover:bg-rose-50 text-rose-600 hover:text-rose-700 rounded-full shadow-md border border-rose-100 backdrop-blur-xs transition-all cursor-pointer z-30 active:scale-95 flex items-center justify-center"
                            title="ลบสลิปเงินมัดจำ"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="relative border-2 border-dashed border-emerald-200 bg-emerald-50/20 rounded-2xl p-4 text-center hover:bg-emerald-50/50 transition-all cursor-pointer">
                          <input
                            type="file"
                            accept="image/*"
                            data-testid="deposit-slip-input"
                            onChange={handleDepositSlipUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                          />
                          <div className="space-y-1.5 py-2">
                            <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-xs">
                              <Upload className="w-4 h-4" />
                            </div>
                            <div>
                              <p className="font-black text-slate-800 text-xs">
                                คลิกเพื่อเลือกไฟล์ หรือ ลากไฟล์มาวางที่นี่
                              </p>
                              <p className="text-[9px] text-slate-400 mt-0.5">
                                แนบสลิปโอนเงินเพื่อเป็นหลักฐานการชำระเงินมัดจำล่วงหน้า
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* INSTALLMENT OPTION & AUTOMATIC PERIOD CALCULATOR */}
                  {rentPlan === 'term' && maxTermInstallments > 1 && (
                    <div className="pt-2 border-t border-slate-100 space-y-3">
                      <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2.5">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isInstallment}
                            onChange={(e) => setIsInstallment(e.target.checked)}
                            className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                          />
                          <div>
                            <span className="font-extrabold text-indigo-950 text-[11px] block">
                              ต้องการแบ่งชำระ
                            </span>
                          </div>
                        </label>

                        {isInstallment && (
                          <div className="space-y-3 pl-0 pt-1 animate-in fade-in duration-200">
                            <div className="grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <span className="block font-bold text-indigo-900 text-[9px]">จำนวนงวดการแบ่งชำระ:</span>
                                <select
                                  value={installmentMonths}
                                  onChange={(e) => setInstallmentMonths(Number(e.target.value))}
                                  className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl font-bold text-indigo-900 text-xs"
                                >
                                  {Array.from({ length: maxTermInstallments - 1 }, (_, i) => i + 2).map((m) => (
                                    <option key={m} value={m}>
                                      แบ่งชำระ {m} งวด
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="space-y-1">
                                <span className="block font-bold text-indigo-900 text-[9px]">การจัดสรรเงินมัดจำ:</span>
                                <select
                                  value={installmentAllocation}
                                  onChange={(e) => setInstallmentAllocation(e.target.value as any)}
                                  className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl font-bold text-indigo-900 text-xs"
                                >
                                  <option value="first_period">รวมค่ามัดจำในงวดแรก</option>
                                  <option value="equal">หารเฉลี่ยทุกงวดเท่ากัน</option>
                                </select>
                              </div>
                            </div>

                            {/* AUTOMATIC CALCULATED BREAKDOWN TABLE */}
                            <div className="p-3 bg-white border border-indigo-200 rounded-xl space-y-2 shadow-2xs">
                              <div className="flex justify-between items-center text-[10px] border-b border-indigo-100 pb-1.5">
                                <span className="font-extrabold text-indigo-950 flex items-center gap-1">
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>คำนวณรายงวดอัตโนมัติ ({installmentMonths} งวด)</span>
                                </span>
                                <span className="font-black text-indigo-700">
                                  รวมทั้งสิ้น: ฿ {(rentAmount + (depositStatus === 'unpaid' ? depositAmount : 0)).toLocaleString()}
                                </span>
                              </div>

                              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                {installmentSchedule.map((item) => (
                                  <div
                                    key={item.period}
                                    className={`p-2 rounded-lg border text-[9px] flex justify-between items-center ${item.period === 1
                                      ? 'bg-indigo-50/80 border-indigo-300 font-bold'
                                      : 'bg-slate-50 border-slate-100'
                                      }`}
                                  >
                                    <div className="space-y-0.5">
                                      <span className="font-black text-slate-800 block">
                                        งวดที่ {item.period} {item.period === 1 ? '(วันเริ่มเข้าพัก)' : ''}
                                      </span>
                                      <span className="text-[8px] text-slate-400">
                                        ค่าเช่า: ฿{item.rentAmount.toLocaleString()}
                                        {item.depositAmount > 0 && ` + มัดจำ: ฿${item.depositAmount.toLocaleString()}`}
                                      </span>
                                    </div>

                                    <div className="text-right">
                                      <span className="font-black text-indigo-900 text-[11px] block">
                                        ฿ {item.totalAmount.toLocaleString()}
                                      </span>
                                      {item.depositNote && (
                                        <span className={`text-[7.5px] font-bold ${item.depositAmount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                          {item.depositNote}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* MOVE-IN DATE, CONTRACT DATE & DURATION (CONSOLIDATED INTO STEP 1) */}
                  <div className="pt-3 border-t border-slate-100 space-y-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                      <span className="font-extrabold text-slate-800 text-xs">
                        กำหนดวันเข้าพัก & ระยะเวลาสัญญา *
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-[10px]">
                      {/* 1. วันเริ่มย้ายเข้าพัก */}
                      <div className="space-y-1">
                        <label className="block font-bold text-slate-600">วันเริ่มย้ายเข้าพัก (พ.ศ.) *</label>
                        <OwnerDateInput
                          required
                          value={checkInDate}
                          onChange={(iso) => {
                            setCheckInDate(iso);
                            setContractDate(iso);
                          }}
                          data-testid="tenant-checkin-date-input"
                          align="left"
                          className={`px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 ${highlightErrors && !checkInDate ? 'border-rose-400 bg-rose-50/40' : ''}`}
                        />
                      </div>

                      {/* 2. ระยะเวลาสัญญา */}
                      <div className="space-y-1">
                        <label htmlFor="tenant-duration-select" className="block font-bold text-slate-600">
                          ระยะเวลาสัญญา *
                        </label>
                        <select
                          id="tenant-duration-select"
                          data-testid="tenant-duration-select"
                          value={durationValue}
                          onChange={(e) => setDurationValue(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
                        >
                          {rentPlan === 'term' && (
                            <>
                              {Array.from({ length: 6 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>
                                  {m} เดือน{m === effectiveTermMonths ? ' (1 ภาคเรียน)' : ''}
                                </option>
                              ))}
                            </>
                          )}

                          {rentPlan === 'monthly' && (
                            <>
                              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <option key={m} value={m}>
                                  {m} เดือน{m === 12 ? ' (1 ปี)' : ''}
                                </option>
                              ))}
                            </>
                          )}

                          {rentPlan === 'daily' && (
                            <>
                              <option value={1}>1 วัน (1 คืน)</option>
                              <option value={2}>2 วัน</option>
                              <option value={3}>3 วัน</option>
                              <option value={5}>5 วัน</option>
                              <option value={7}>7 วัน (1 สัปดาห์)</option>
                              <option value={14}>14 วัน</option>
                            </>
                          )}
                        </select>
                      </div>

                      {/* 3. วันสิ้นสุดสัญญา */}
                      <div className="space-y-1">
                        <label className="block font-bold text-slate-600">วันสิ้นสุดสัญญา</label>
                        <div
                          data-testid="tenant-calculated-end-date"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 font-bold min-h-[38px] flex items-center text-xs"
                        >
                          {endDate ? formatThaiDateStr(endDate) : '-'}
                        </div>
                      </div>

                      {/* 4. วันครบกำหนดชำระ */}
                      <div className="space-y-1">
                        <label className="block font-bold text-slate-600 flex items-center gap-1.5">
                          <span>วันครบกำหนดชำระ</span>
                          <Lock className="w-3 h-3 text-slate-400" />
                        </label>
                        <div
                          data-testid="tenant-locked-due-day"
                          className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-700 font-bold flex items-center justify-between text-xs cursor-not-allowed"
                        >
                          <span className="flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 text-slate-400" />
                            <span>วันที่ {dueDay} ของทุกเดือน</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* SECTION 2: กรอกข้อมูลผู้เช่า & แนบรูปภาพเอกสาร (TENANT PERSONAL INFO & ID ATTACHMENT) */}
          <div id="step-2" className={`bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28 ${activeStep === 2 ? 'block' : 'hidden'}`}>
            <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
              <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
                2
              </div>
              <div>
                <h4 className="font-black text-slate-900 text-xs">ข้อมูลส่วนตัว & รูปถ่ายเอกสารบัตรประชาชน *</h4>
                <p className="text-[9px] text-slate-400">กรอกข้อมูลผู้เช่าหลักและแนบสำเนาบัตรประชาชน</p>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 text-[10px]">
              <div className="col-span-4 space-y-1">
                <label className="block font-bold text-slate-600">คำนำหน้า *</label>
                <select
                  data-testid="tenant-prefix-select"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="นาย">นาย</option>
                  <option value="นาง">นาง</option>
                  <option value="นางสาว">นางสาว</option>
                  <option value="เด็กชาย">เด็กชาย</option>
                  <option value="เด็กหญิง">เด็กหญิง</option>
                  <option value="ระบุเอง">ระบุเอง</option>
                </select>
              </div>

              {prefix === 'ระบุเอง' || prefix === 'กำหนดเอง' ? (
                <div className="col-span-8 space-y-1 animate-in fade-in duration-200">
                  <label className="block font-bold text-slate-600">ระบุคำนำหน้าเอง *</label>
                  <input
                    type="text"
                    required
                    data-testid="tenant-custom-prefix-input"
                    placeholder="เช่น ยศ, ด.ช., พระ ฯลฯ"
                    value={customPrefix}
                    onChange={(e) => setCustomPrefix(e.target.value)}
                    className={`w-full px-3 py-2 bg-white border rounded-xl text-slate-800 font-bold focus:outline-none ${getHighlightClass(!customPrefix.trim())}`}
                  />
                </div>
              ) : null}

              <div className={`${prefix === 'ระบุเอง' || prefix === 'กำหนดเอง' ? 'col-span-12' : 'col-span-8'} space-y-1`}>
                <label className="block font-bold text-slate-600">ชื่อ - นามสกุล *</label>
                <input
                  type="text"
                  required
                  data-testid="tenant-fullname-input"
                  placeholder="เช่น สมชาย ใจดี"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-bold focus:outline-none ${getHighlightClass(!fullName.trim())}`}
                />
              </div>

              <div className="col-span-12 space-y-1">
                <label className="block font-bold text-slate-600">เลขบัตรประชาชน / พาสปอร์ต *</label>
                <input
                  type="text"
                  required
                  data-testid="tenant-citizen-id-input"
                  placeholder="1-2345-67890-12-3"
                  value={citizenId}
                  onChange={handleCitizenIdChange}
                  className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-bold focus:outline-none tracking-wider ${getHighlightClass(!citizenId.trim())}`}
                />
              </div>

              <div className="col-span-6 space-y-1">
                <label className="block font-bold text-slate-600">เบอร์โทรศัพท์ *</label>
                <input
                  type="tel"
                  required
                  data-testid="tenant-phone-input"
                  placeholder="081-234-5678"
                  value={phone}
                  onChange={handlePhoneChange}
                  className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-bold focus:outline-none tracking-wider ${getHighlightClass(!phone.trim())}`}
                />
              </div>

              <div className="col-span-6 space-y-1">
                <label className="block font-bold text-slate-600">อีเมล (ไม่บังคับ)</label>
                <input
                  type="email"
                  autoComplete="off"
                  placeholder="example@mail.com (ถ้ามี)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="col-span-12 space-y-1">
                <label className="block font-bold text-slate-600 flex items-center justify-between">
                  <span>วัน/เดือน/ปีเกิด *</span>
                </label>
                <OwnerDateInput
                  required
                  value={birthDate}
                  onChange={(iso) => setBirthDate(iso)}
                  placeholder="วว/ดด/ปปปป (พ.ศ.)"
                  className={`px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 ${highlightErrors && !birthDate?.trim() ? 'border-rose-400 bg-rose-50/40' : ''}`}
                  data-testid="tenant-birthdate-input"
                />
              </div>

              <div className="col-span-12 space-y-1">
                <label className="block font-bold text-slate-600">ที่อยู่ตามทะเบียนบ้าน *</label>
                <textarea
                  rows={2}
                  required
                  data-testid="tenant-address-input"
                  placeholder="กรอกที่อยู่ปัจจุบัน หรือ ที่อยู่ตามทะเบียนบ้าน (จำเป็น)"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-bold focus:outline-none resize-none ${getHighlightClass(!address?.trim())}`}
                />
              </div>

              {/* ID CARD ATTACHMENT & REFERENCE EXAMPLE GUIDE */}
              <div className="col-span-12 space-y-3 pt-2 border-t border-slate-100">
                <label className="block font-bold text-slate-700 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-indigo-600" />
                    <span>แนบรูปถ่ายสำเนาบัตรประชาชน / พาสปอร์ต</span>
                  </span>
                  <span className="text-[9px] text-indigo-600 font-normal">
                    (ข้าม - อัปโหลดภายหลังได้)
                  </span>
                </label>

                {/* Upload Box (Single Frame) */}
                {idCardImage ? (
                  <div className="relative w-full rounded-2xl overflow-hidden border-2 border-indigo-200 bg-slate-50 shadow-xs">
                    {/* Clean original uploaded image without watermark overlay */}
                    <img
                      src={idCardImage}
                      alt="สำเนาบัตรประชาชน"
                      className="w-full max-h-80 object-contain mx-auto rounded-xl p-1"
                    />
                    <button
                      type="button"
                      data-testid="btn-remove-idcard"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIdCardImage('');
                      }}
                      className="absolute top-2.5 right-2.5 p-2 bg-white/95 hover:bg-rose-50 text-rose-600 hover:text-rose-700 rounded-full shadow-md border border-rose-100 backdrop-blur-xs transition-all cursor-pointer z-30 active:scale-95 flex items-center justify-center"
                      title="ลบรูปภาพสำเนาบัตร"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="relative border-2 border-dashed border-indigo-200 bg-indigo-50/20 rounded-2xl p-4 text-center hover:bg-indigo-50/50 transition-all cursor-pointer">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="space-y-2 py-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 mx-auto flex items-center justify-center shadow-xs">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-black text-slate-800 text-xs">
                          คลิกเพื่อเลือกไฟล์รูปถ่ายบัตรประชาชน หรือ ลากไฟล์มาวางที่นี่
                        </p>
                        <p className="text-[9px] text-slate-400 mt-0.5">
                          กรุณากรอกและเซ็น "สำเนาถูกต้อง" บนรูปถ่ายเอกสารจริงตามรูปแบบตัวอย่างด้านล่าง
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* REFERENCE GUIDE / EXAMPLE DIAGRAM (รูปตัวอย่างการขีดคร่อมและเซนต์สำเนาถูกต้อง) */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                  <div className="flex items-center gap-1.5 text-slate-800 font-extrabold text-[10px]">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    <span>รูปแบบตัวอย่างการเซ็นสำเนาถูกต้องก่อนถ่ายภาพแนบเอกสาร:</span>
                  </div>

                  {/* VISUAL REFERENCE CARD (Illustrative Thai ID Card Template with crossing lines) */}
                  <div className="bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 border-2 border-sky-200 rounded-xl p-3 relative overflow-hidden shadow-2xs font-sans text-slate-800">
                    <div className="flex justify-between items-start text-[8px] font-bold text-sky-800 border-b border-sky-200/80 pb-1 mb-2">
                      <span className="flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3 text-sky-600" /> บัตรประจำตัวประชาชน / Thai National ID Card
                      </span>
                      <span className="text-[7px] text-sky-600">ตัวอย่าง (Sample)</span>
                    </div>

                    <div className="grid grid-cols-12 gap-2 items-center text-[8px] text-slate-600">
                      <div className="col-span-3 aspect-4/3 bg-slate-200/80 rounded-md border border-slate-300 flex flex-col items-center justify-center text-slate-400 text-[7px] font-bold">
                        <User className="w-5 h-5 text-slate-400" />
                        <span>รูปถ่าย</span>
                      </div>
                      <div className="col-span-9 space-y-0.5 font-mono text-[8px]">
                        <div>เลขบัตร: 1-2345-67890-12-3</div>
                        <div>ชื่อ: นายสมชาย ใจดี</div>
                        <div>Address: 123/45 ถนนสุขุมวิท กทม.</div>
                      </div>
                    </div>

                    {/* ILLUSTRATIVE CROSS-SIGNING DIAGONAL OVERLAY WITH HANDWRITTEN STYLE */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-2">
                      <div className="w-[105%] border-y-2 border-slate-900 bg-white/70 backdrop-blur-3xs py-1 px-2 -rotate-12 shadow-sm text-center">
                        <p className="font-black text-slate-900 text-[10px] tracking-tight">
                          * ใช้สำหรับเช่าห้องพัก {selectedRoom?.roomNumber || '...'} {policyData?.dormitoryName || (dormInfo as any)?.dormitoryName || dormInfo?.name || 'หอพักชาญวิทย์'} เท่านั้น * ({formatThaiShortDate(contractDate)})
                        </p>
                        <p className="text-[9px] font-black text-slate-800 mt-0.5">
                          สำเนาถูกต้อง
                        </p>
                        <p className="text-[8px] font-bold text-indigo-950 italic">
                          {fullName || prefix + ' สมชาย ใจดี'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* DAILY STAY ONLY: ลายเซ็นดิจิทัลสำหรับขอเข้าพักรายวัน & การยินยอมเงื่อนไข & ส่งคำขอ */}
              {rentPlan === 'daily' && (
                <div className="col-span-12 space-y-3 pt-3 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-slate-700 flex items-center gap-1 text-xs">
                      <FileSignature className="w-3.5 h-3.5 text-indigo-600" />
                      <span>ลายเซ็นดิจิทัลสำหรับขอเข้าพักรายวัน *</span>
                    </label>
                    {isSigned && (
                      <button
                        type="button"
                        onClick={clearSignature}
                        className="text-[9px] font-bold text-rose-600 hover:underline cursor-pointer"
                      >
                        ล้างลายเซ็น
                      </button>
                    )}
                  </div>

                  <div className="border-2 border-dashed border-sky-200 rounded-2xl bg-sky-50/20 overflow-hidden relative touch-none">
                    <canvas
                      ref={canvasRef}
                      width={480}
                      height={200}
                      data-testid="tenant-daily-signature-canvas"
                      onPointerDown={startDrawing}
                      onPointerMove={draw}
                      onPointerUp={stopDrawing}
                      onPointerCancel={stopDrawing}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      style={{ touchAction: 'none' }}
                      className="w-full h-48 cursor-crosshair block touch-none"
                    />
                    {!isSigned && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-350 text-[10px] font-bold">
                        เซ็นชื่อเพื่อยืนยันคำขอเข้าพักรายวัน
                      </div>
                    )}
                  </div>

                  {/* Daily Terms checkbox */}
                  <label className="flex items-start gap-2.5 cursor-pointer p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                    <input
                      type="checkbox"
                      data-testid="tenant-agree-terms-checkbox"
                      required
                      checked={isAgreedTerms}
                      onChange={(e) => setIsAgreedTerms(e.target.checked)}
                      className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 shrink-0"
                    />
                    <span className="text-[9.5px] text-slate-600 font-medium leading-relaxed">
                      ข้าพเจ้าขอรับรองว่าข้อมูลข้างต้นเป็นความจริงทุกประการ ได้รับทราบและยินยอมปฏิบัติตามกฎระเบียบการเข้าพักรายวันของหอพักทุกประการ
                    </span>
                  </label>

                  {/* Daily Stay Direct Submit Button */}
                  <button
                    type="button"
                    data-testid="submit-daily-stay-btn"
                    disabled={submittingRegistration}
                    onClick={handleDailyStaySubmit}
                    aria-label="ยืนยันคำขอเข้าพักรายวัน (รอเจ้าของหอพักอนุมัติ)"
                    className="w-full py-3.5 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white active:scale-98 cursor-pointer transition-all"
                  >
                    {submittingRegistration ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin text-white" />
                        <span>กำลังส่งคำขอเข้าพักรายวัน...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                        <span>ส่งคำขอเข้าพักรายวัน (รอเจ้าของหอพักอนุมัติ)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* LONG-TERM CONTRACT ONLY: STEPS 3, 4, 5 & SUBMIT */}
          {rentPlan !== 'daily' && (
            <>
              {/* SECTION 3: ผู้ติดต่อฉุกเฉิน & ผู้พักอาศัยร่วม (EMERGENCY & CO-OCCUPANTS) */}
              <div id="step-3" className={`bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28 ${activeStep === 3 ? 'block' : 'hidden'}`}>
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
                    3
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-xs">ผู้ติดต่อฉุกเฉิน & ผู้พักอาศัยร่วม *</h4>
                    <p className="text-[9px] text-slate-400">ข้อมูลบุคคลอ้างอิงและเพื่อนร่วมห้อง (ถ้ามี)</p>
                  </div>
                </div>

                <div className="space-y-3 text-[10px]">
                  {/* Emergency Contact */}
                  <div className="space-y-2 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl">
                    <span className="font-extrabold text-slate-800 block text-[10px]">ข้อมูลผู้ติดต่อฉุกเฉิน *</span>
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-5 space-y-1">
                        <label className="block font-bold text-slate-600">ชื่อ-นามสกุล *</label>
                        <input
                          type="text"
                          required
                          data-testid="tenant-emergency-name-input"
                          placeholder="ชื่อ-นามสกุล *"
                          value={emergencyName}
                          onChange={(e) => setEmergencyName(e.target.value)}
                          className={`w-full px-2.5 py-1.5 border rounded-xl text-slate-800 font-bold focus:outline-none ${getHighlightClass(!emergencyName.trim())}`}
                        />
                      </div>
                      <div className="col-span-3 space-y-1">
                        <label className="block font-bold text-slate-600">ความสัมพันธ์ *</label>
                        <select
                          required
                          data-testid="tenant-emergency-rel-input"
                          value={EMERGENCY_RELATION_OPTIONS.includes(emergencyRel) ? emergencyRel : 'อื่นๆ'}
                          onChange={(e) => handleEmergencyRelChange(e.target.value)}
                          className={`w-full px-2.5 py-1.5 border rounded-xl text-slate-800 font-bold focus:outline-none ${getHighlightClass(!getEffectiveEmergencyRel().trim())}`}
                        >
                          <option value="แฟน">แฟน</option>
                          <option value="เพื่อน">เพื่อน</option>
                          <option value="ผู้ปกครอง">ผู้ปกครอง</option>
                          <option value="พี่น้อง / ญาติ">พี่น้อง / ญาติ</option>
                          <option value="คู่สมรส">คู่สมรส</option>
                          <option value="อื่นๆ">อื่นๆ</option>
                        </select>
                      </div>
                      <div className="col-span-4 space-y-1">
                        <label className="block font-bold text-slate-600">เบอร์โทรฉุกเฉิน *</label>
                        <input
                          type="tel"
                          required
                          data-testid="tenant-emergency-phone-input"
                          placeholder="08X-XXX-XXXX"
                          value={emergencyPhone}
                          onChange={(e) => setEmergencyPhone(formatPhoneInput(e.target.value))}
                          className={`w-full px-2.5 py-1.5 border rounded-xl text-slate-800 font-bold focus:outline-none tracking-wider ${getHighlightClass(!emergencyPhone.trim())}`}
                        />
                      </div>

                      {emergencyRel === 'อื่นๆ' && (
                        <div className="col-span-12 space-y-1 animate-in fade-in duration-200">
                          <label className="block font-bold text-slate-600">ระบุความสัมพันธ์ *</label>
                          <input
                            type="text"
                            required
                            data-testid="tenant-emergency-custom-rel-input"
                            placeholder="ระบุความสัมพันธ์ เช่น อา, น้า, ลุง, เพื่อนร่วมงาน"
                            value={emergencyCustomRel}
                            onChange={(e) => setEmergencyCustomRel(e.target.value)}
                            className={`w-full px-2.5 py-1.5 border rounded-xl text-slate-800 font-bold focus:outline-none ${getHighlightClass(!emergencyCustomRel.trim())}`}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Co-Occupants Checkbox */}
                  <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid="tenant-has-co-occupants-checkbox"
                        checked={hasCoOccupants}
                        onChange={(e) => setHasCoOccupants(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                      />
                      <div>
                        <span className="font-extrabold text-indigo-950 text-[11px] block">
                          มีผู้พักอาศัยร่วมในห้องพักนี้
                        </span>
                      </div>
                    </label>

                    {hasCoOccupants && (
                      <div className="space-y-3 p-3 bg-white border border-indigo-200 rounded-xl animate-in fade-in duration-200 shadow-2xs">
                        {/* ระเบียบการแจ้งผู้พักร่วม Notice Banner (Image 4 & TenantCoOccupantsModal Parity) */}
                        <div className="space-y-1.5 text-[11px] font-medium pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs pb-0.5">
                            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>ระเบียบการแจ้งผู้พักร่วม</span>
                          </div>
                          <div className="space-y-1.5">
                            <div className="flex items-start gap-2 bg-emerald-50/80 border border-emerald-100 p-2 rounded-xl text-emerald-800">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span><strong className="font-bold">แจ้งตามจริง:</strong> เพื่อคำนวณค่าบริการต่างๆ ตามจำนวนคน</span>
                            </div>
                            <div className="flex items-start gap-2 bg-rose-50/80 border border-rose-100 p-2 rounded-xl text-rose-800">
                              <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                              <span><strong className="font-bold">ห้ามปกปิด:</strong> ตรวจพบถือว่าเจตนาทุจริต/โกง มีโทษปรับตามสัญญา</span>
                            </div>
                          </div>
                        </div>

                        <span className="font-extrabold text-indigo-900 block text-[10px]">
                          เพิ่มผู้พักอาศัยร่วม
                        </span>

                        <div className="grid grid-cols-12 gap-2">
                          <input
                            type="text"
                            data-testid="tenant-co-occupant-name-input"
                            placeholder="ชื่อ-นามสกุล ผู้พักร่วม"
                            value={newCoName}
                            onChange={(e) => setNewCoName(e.target.value)}
                            className="col-span-5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                          />
                          <input
                            type="tel"
                            data-testid="tenant-co-occupant-phone-input"
                            placeholder="เบอร์โทรศัพท์"
                            value={newCoPhone}
                            onChange={(e) => setNewCoPhone(formatPhoneInput(e.target.value))}
                            className="col-span-4 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold tracking-wider"
                          />
                          <button
                            type="button"
                            data-testid="tenant-add-co-occupant-btn"
                            onClick={handleAddCoOccupant}
                            className="col-span-3 px-2 py-1.5 bg-indigo-600 text-white font-black rounded-xl text-[9px] hover:bg-indigo-700 flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3 h-3" /> เพิ่ม
                          </button>
                        </div>

                        {/* Co-occupants list */}
                        {coOccupants.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            {coOccupants.map((co) => (
                              <div key={co.id} className="p-2 bg-white border border-slate-100 rounded-xl flex justify-between items-center text-[9px]">
                                <div>
                                  <span className="font-bold text-slate-800 block">{co.name}</span>
                                  <span className="text-slate-400">โทร: {formatPhoneInput(co.phone) || co.phone}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveCoOccupant(co.id)}
                                  className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* SECTION 4: ข้อมูลยานพาหนะ & ขอเลี้ยงสัตว์ (VEHICLE & PETS DROPDOWNS) */}
              <div id="step-4" className={`bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28 ${activeStep === 4 ? 'block' : 'hidden'}`}>
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
                    4
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-xs">ยานพาหนะ & การขออนุญาตเลี้ยงสัตว์เลี้ยง</h4>
                    <p className="text-[9px] text-slate-400">ลงทะเบียนสิทธิ์จอดรถและแจ้งสัตว์เลี้ยงด้วย Dropdown</p>
                  </div>
                </div>

                <div className="space-y-3 text-[10px]">
                  {/* Vehicle Selection */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="block font-bold text-slate-700 text-xs">ข้อมูลยานพาหนะ</label>
                      <button
                        type="button"
                        data-testid="tenant-add-vehicle-btn"
                        onClick={handleAddVehicle}
                        className="px-2.5 py-1 text-[10px] font-extrabold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>เพิ่มยานพาหนะ</span>
                      </button>
                    </div>

                    {vehiclesList.map((veh, idx) => {
                      const isBicycle = veh.type === 'bicycle';
                      const isMotorcycle = veh.type === 'motorcycle';
                      const isCar = veh.type === 'car';
                      const brandOptions = isMotorcycle ? MOTO_BRANDS : CAR_BRANDS;

                      return (
                        <div
                          key={veh.id}
                          className="p-3 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-2.5 relative animate-in fade-in duration-150"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-slate-700 flex items-center gap-1">
                              <Car className="w-3.5 h-3.5 text-indigo-600" />
                              <span>คันที่ {idx + 1}</span>
                            </span>
                            {vehiclesList.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveVehicle(veh.id)}
                                className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                                title="ลบยานพาหนะนี้"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>

                          <div className="space-y-1">
                            <label className="block font-bold text-slate-600">ประเภทยานพาหนะ</label>
                            <select
                              data-testid={idx === 0 ? 'tenant-vehicle-type-select' : `tenant-vehicle-type-select-${idx}`}
                              value={veh.type}
                              onChange={(e) => {
                                const newType = e.target.value as any;
                                handleUpdateVehicle(veh.id, {
                                  type: newType,
                                  brand: newType === 'car' ? 'Toyota' : 'Honda',
                                });
                              }}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500"
                            >
                              {idx === 0 && <option value="none">ไม่มีรถ (No vehicle)</option>}
                              <option value="motorcycle">รถจักรยานยนต์ (Motorcycle)</option>
                              <option value="car">รถยนต์ส่วนบุคคล (Car)</option>
                              <option value="bicycle">รถจักรยาน (Bicycle)</option>
                            </select>
                          </div>

                          {isBicycle && (
                            <div className="pt-1 space-y-1 animate-in fade-in duration-200">
                              <label className="block font-bold text-slate-600">ยี่ห้อ / สี / จุดสังเกตของจักรยาน</label>
                              <input
                                type="text"
                                data-testid={idx === 0 ? 'tenant-bicycle-details-input' : `tenant-bicycle-details-input-${idx}`}
                                placeholder="เช่น จักรยานเสือหมอบ สีขาว-แดง / มีตะกร้าหน้า"
                                value={veh.customBrand}
                                onChange={(e) => handleUpdateVehicle(veh.id, { customBrand: e.target.value })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500"
                              />
                            </div>
                          )}

                          {(isCar || isMotorcycle) && (
                            <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-200">
                              <div className="space-y-1">
                                <label className="block font-bold text-slate-600">ยี่ห้อยานพาหนะ</label>
                                <select
                                  value={veh.brand}
                                  onChange={(e) => handleUpdateVehicle(veh.id, { brand: e.target.value })}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold focus:border-indigo-500"
                                >
                                  {brandOptions.map((brand) => (
                                    <option key={brand} value={brand}>
                                      {brand}
                                    </option>
                                  ))}
                                </select>

                                {veh.brand === 'อื่นๆ' && (
                                  <input
                                    type="text"
                                    placeholder="ระบุยี่ห้อเพิ่มเติม"
                                    value={veh.customBrand}
                                    onChange={(e) => handleUpdateVehicle(veh.id, { customBrand: e.target.value })}
                                    className="w-full mt-1 px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                                  />
                                )}
                              </div>

                              <div className="space-y-1">
                                <label className="block font-bold text-slate-600">เลขทะเบียน & จังหวัด</label>
                                <input
                                  type="text"
                                  data-testid={idx === 0 ? 'tenant-vehicle-plate-input' : `tenant-vehicle-plate-input-${idx}`}
                                  placeholder="เช่น 1กข 1234 กทม"
                                  value={veh.licensePlate}
                                  onChange={(e) => handleUpdateVehicle(veh.id, { licensePlate: e.target.value })}
                                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Pet Request */}
                  {(() => {
                    let pPolicy = dormInfo?.petPolicy;
                    if (!pPolicy) {
                      try {
                        const saved = localStorage.getItem('registered_dorm_profile');
                        if (saved) pPolicy = JSON.parse(saved).petPolicy;
                      } catch { }
                    }
                    const isPetAllowed = pPolicy ? pPolicy.allowed !== 'none' : true;

                    if (!isPetAllowed) {
                      return (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center gap-2.5">
                          <Dog className="w-5 h-5 text-amber-600 shrink-0" />
                          <div>
                            <span className="font-extrabold text-amber-950 text-xs block">
                              หอพักไม่อนุญาตให้เลี้ยงสัตว์ทุกชนิด
                            </span>
                            <span className="text-[10px] text-amber-700 font-medium block mt-0.5">
                              ตามข้อกำหนดระเบียบของหอพักที่ตั้งค่าไว้ตอนลงทะเบียน
                            </span>
                          </div>
                        </div>
                      );
                    }

                    const allowedPetOptions = resolveAllowedPetOptions(dormInfo?.petPolicy || policyData?.petPolicy);
                    const petOptionsToDisplay = allowedPetOptions.length > 0 ? allowedPetOptions : CANONICAL_PET_GROUP_OPTIONS;

                    return (
                      <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2.5">
                        <div className="flex justify-between items-center">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hasPet}
                              aria-label="ขออนุญาตนำสัตว์เลี้ยงเข้ามาพักอาศัย"
                              onChange={(e) => setHasPet(e.target.checked)}
                              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                            />
                            <div>
                              <span className="font-extrabold text-indigo-950 text-[11px] block">
                                ขออนุญาตเลี้ยงสัตว์เลี้ยง <span className="sr-only">(ขออนุญาตนำสัตว์เลี้ยงเข้ามาพักอาศัย)</span>
                              </span>
                            </div>
                          </label>
                          <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            อนุญาตตามระเบียบ
                          </span>
                        </div>

                        {hasPet && (
                          <div className="space-y-3 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-indigo-900">รายการสัตว์เลี้ยง</span>
                              <button
                                type="button"
                                data-testid="tenant-add-pet-btn"
                                onClick={handleAddPet}
                                className="px-2.5 py-1 text-[10px] font-extrabold text-indigo-600 bg-white hover:bg-indigo-100 border border-indigo-200 rounded-lg flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Plus className="w-3 h-3" />
                                <span>เพิ่มสัตว์เลี้ยงอีก 1 รายการ</span>
                              </button>
                            </div>

                            {petsList.map((p, pIdx) => (
                              <div
                                key={p.id}
                                className="p-3 bg-white border border-indigo-200 rounded-xl animate-in fade-in duration-150 shadow-2xs space-y-2"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-black text-indigo-900 flex items-center gap-1">
                                    <Dog className="w-3.5 h-3.5 text-indigo-600" />
                                    <span>สัตว์เลี้ยงตัวที่ {pIdx + 1}</span>
                                  </span>
                                  {petsList.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemovePet(p.id)}
                                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                                      title="ลบสัตว์เลี้ยงนี้"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>

                                <div className="grid grid-cols-12 gap-2">
                                  <div className="col-span-5 space-y-1">
                                    <label className="block font-bold text-slate-600">ประเภทสัตว์เลี้ยง</label>
                                    <select
                                      data-testid={`tenant-pet-type-select-${pIdx}`}
                                      value={p.type}
                                      onChange={(e) => handleUpdatePet(p.id, { type: e.target.value as any })}
                                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                                    >
                                      {petOptionsToDisplay.map((opt) => (
                                        <option key={opt.id} value={opt.id}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  <div className="col-span-7 space-y-1">
                                    <label className="block font-bold text-slate-600">ชื่อ & สายพันธุ์</label>
                                    <input
                                      type="text"
                                      placeholder="เช่น น้องส้ม (เปอร์เซีย)"
                                      value={p.name}
                                      onChange={(e) => handleUpdatePet(p.id, { name: e.target.value })}
                                      className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                                    />
                                  </div>

                                  {p.type === 'other' && (
                                    <div className="col-span-12 space-y-1 animate-in fade-in duration-150">
                                      <label className="block font-bold text-slate-600">ระบุประเภทสัตว์เลี้ยงเพิ่มเติม</label>
                                      <input
                                        type="text"
                                        placeholder="เช่น เม่นแคระ, กิ้งก่าเบียร์ดดราก้อน"
                                        value={p.customType}
                                        onChange={(e) => handleUpdatePet(p.id, { customType: e.target.value })}
                                        className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                                      />
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* SECTION 5: แสดงสัญญาเช่าฉบับจริง REAL-TIME & เซ็นชื่อดิจิทัล */}
              <div id="step-5" className={`bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-4 scroll-mt-28 ${activeStep === 5 ? 'block' : 'hidden'}`}>
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
                    5
                  </div>
                  <div>
                    <h4 className="font-black text-slate-900 text-xs">สัญญาเช่าฉบับจริง & เซ็นชื่อ *</h4>
                    <p className="text-[9px] text-slate-400">ตรวจสอบรายละเอียดสัญญาเช่าดิจิทัลตามข้อมูลที่กรอกก่อนลงชื่อ</p>
                  </div>
                </div>

                {/* REAL-TIME CONTRACT DOCUMENT DISPLAY */}
                <div className="p-4 bg-amber-50/50 border-2 border-amber-200/80 rounded-2xl space-y-3.5 font-sarabun text-xs leading-relaxed text-slate-800 shadow-inner relative overflow-hidden">

                  <div className="text-center space-y-1 pb-2 border-b border-amber-200">
                    <h3 className="font-bold text-sm text-slate-900 tracking-tight">
                      หนังสือสัญญาเช่าห้องพักอาศัย
                    </h3>
                    <p className="text-[10px] text-slate-600 italic">
                      ทำที่: {dormInfo.name || 'HorPlus Residence'} ({dormInfo.address || 'อาคารพักอาศัยส่วนบุคคล'})
                    </p>
                    <p className="text-[10px] font-bold text-amber-900">
                      วันที่ทำสัญญา: {formatThaiFullDate(contractDate || todayStr)}
                    </p>
                  </div>

                  <div className="space-y-2 text-justify">
                    <p>
                      <span className="font-bold">สัญญาฉบับนี้ทำขึ้นระหว่าง</span> <span className="font-bold text-indigo-900">{getLessorDisplayName()}</span> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <span className="font-bold text-indigo-900">{`${getEffectivePrefix()} ${fullName || '-'}`.trim()}</span> ถือบัตรประชาชน/พาสปอร์ตเลขที่ <span className="font-bold text-indigo-900">{citizenId || '-'}</span> เบอร์โทรศัพท์ <span className="font-bold text-indigo-900">{phone || '-'}</span> ("ผู้เช่า") อีกฝ่ายหนึ่ง โดยมีข้อตกลงสำคัญดังต่อไปนี้:
                    </p>

                    <div className="pl-3 space-y-1.5 border-l-2 border-amber-300">
                      <p>
                        <span className="font-bold">ข้อ 1. ทรัพย์สินที่เช่า:</span> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <span className="font-bold text-indigo-900">ห้อง {selectedRoom?.roomNumber || '-'}</span> ของอาคาร <span className="font-bold text-indigo-900">{dormInfo.name || 'หอพัก'}</span> พร้อมอุปกรณ์ เฟอร์นิเจอร์ เครื่องใช้ไฟฟ้า และสิ่งอำนวยความสะดวกในสภาพเรียบร้อยสมบูรณ์
                      </p>

                      <p>
                        <span className="font-bold">ข้อ 2. อัตราค่าเช่า เงินประกัน และการคืนเงิน:</span> ผู้เช่าตกลงชำระค่าเช่าในอัตรา <span className="font-bold text-indigo-900">฿ {Number(rentAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาทต่อ{rentPlan === 'monthly' ? 'เดือน' : rentPlan === 'term' ? 'เทอม' : 'วัน'}</span> กำหนดชำระตามรอบบิลที่หอพักกำหนด พร้อมวางเงินประกันความเสียหายจำนวน <span className="font-bold text-indigo-900">฿ {Number(depositAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span> โดยเงินประกันนี้จะได้รับคืนเมื่อสิ้นสุดสัญญาเช่า หลังจากหักค่าใช้จ่ายค้างชำระ หนี้สิน หรือค่าความเสียหายต่อทรัพย์สิน (ถ้ามี) ตามระเบียบและเงื่อนไขที่หอพักกำหนด
                      </p>

                      <p>
                        <span className="font-bold">ข้อ 3. ระยะเวลาการเช่า:</span> สัญญานี้มีกำหนดระยะเวลา <span className="font-bold text-indigo-900">{durationValue} {rentPlan === 'daily' ? 'วัน' : 'เดือน'}</span> โดยเริ่มต้นตั้งแต่วันที่ <span className="font-bold text-indigo-900">{formatThaiFullDate(checkInDate)}</span> ถึงวันที่ <span className="font-bold text-indigo-900">{formatThaiFullDate(endDate) || '-'}</span>
                      </p>

                      <p>
                        <span className="font-bold">ข้อ 4. ยานพาหนะ สัตว์เลี้ยง และการใช้พื้นที่ส่วนกลาง:</span> ผู้เช่าตกลงปฏิบัติตามระเบียบการจอดยานพาหนะ การนำสัตว์เลี้ยงเข้าพัก (หากหอพักอนุญาต) และการใช้พื้นที่ส่วนกลาง โดยต้องบันทึกข้อมูลยานพาหนะและสัตว์เลี้ยงลงในระบบของหอพักให้ถูกต้องตรงตามความเป็นจริง
                      </p>

                      <p>
                        <span className="font-bold">ข้อ 5. จำนวนผู้พักอาศัยและผู้พักร่วม:</span> ผู้เช่าตกลงแจ้งข้อมูลผู้พักอาศัยในห้องพักตามความเป็นจริง โดยในวันทำสัญญามีผู้เช่าหลักและผู้พักอาศัยร่วม รวมทั้งสิ้น <span className="font-bold text-indigo-900">{1 + (hasCoOccupants && Array.isArray(coOccupants) ? coOccupants.length : 0)} คน</span> หากมีการเปลี่ยนแปลงหรือมีผู้พักอาศัยร่วมเพิ่มเติมในภายหลัง ผู้เช่าจะต้องแจ้งให้ผู้ให้เช่าทราบล่วงหน้าและบันทึกข้อมูลลงในระบบตามระเบียบของหอพัก
                      </p>

                      <div className="pt-2 border-t border-amber-200/80 space-y-1">
                        <p className="font-bold text-slate-900">
                          ข้อ 6. ข้อตกลงและระเบียบการอยู่อาศัย:
                        </p>
                        <div className="whitespace-pre-line text-slate-700 text-[11px] font-medium leading-relaxed bg-amber-100/40 p-2.5 rounded-xl border border-amber-200/70">
                          {getDormRulesText()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Signature Placement Preview inside Contract */}
                  <div className="pt-3 border-t border-amber-200 grid grid-cols-2 gap-4 text-center font-sarabun">
                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-600 font-bold">ลงชื่อ (ผู้ให้เช่า)</p>
                      <div className="h-12 flex items-center justify-center overflow-hidden">
                        {dormInfo.ownerSignature ? (
                          <img src={dormInfo.ownerSignature} alt="ลายเซ็นผู้ให้เช่า" className="h-10 object-contain mx-auto" />
                        ) : (
                          <span className="text-[10px] text-slate-400 select-none">ผู้ให้เช่าลงนามแล้ว</span>
                        )}
                      </div>
                      <p className="text-[9px] text-slate-700 font-bold">({getLessorSignerName()})</p>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[10px] text-slate-600 font-bold">ลงชื่อ (ผู้เช่า)</p>
                      <div className="h-12 flex items-center justify-center overflow-hidden">
                        {signatureDataUrl ? (
                          <img src={signatureDataUrl} alt="ลายเซ็นผู้เช่า" className="h-10 object-contain mx-auto" />
                        ) : (
                          <span className="text-[9px] text-slate-400 italic">รอการเซ็นชื่อด้านล่าง...</span>
                        )}
                      </div>
                      <p className="text-[9px] text-slate-700 font-bold">
                        ({`${getEffectivePrefix()} ${fullName || '-'}`.trim()})
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-[10px]">
                  {/* Signature Box Canvas */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <label className="font-bold text-slate-700 flex items-center gap-1">
                        <FileSignature className="w-3.5 h-3.5 text-indigo-600" />
                        <span>ลายนิ้วมือ / ลายเซ็นดิจิทัลของผู้เช่า *</span>
                      </label>
                      {isSigned && (
                        <button
                          type="button"
                          onClick={clearSignature}
                          className="text-[9px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          ล้างลายเซ็น
                        </button>
                      )}
                    </div>

                    <div className={`border-2 border-dashed rounded-2xl bg-indigo-50/20 overflow-hidden relative touch-none transition-colors ${highlightErrors && !signatureDataUrl ? 'border-rose-400 bg-rose-50/30 ring-1 ring-rose-300' : 'border-indigo-200'
                      }`}>
                      <canvas
                        ref={canvasRef}
                        width={480}
                        height={200}
                        data-testid="tenant-signature-canvas"
                        onPointerDown={startDrawing}
                        onPointerMove={draw}
                        onPointerUp={stopDrawing}
                        onPointerCancel={stopDrawing}
                        onMouseDown={startDrawing}
                        onMouseMove={draw}
                        onMouseUp={stopDrawing}
                        onMouseLeave={stopDrawing}
                        onTouchStart={startDrawing}
                        onTouchMove={draw}
                        onTouchEnd={stopDrawing}
                        style={{ touchAction: 'none' }}
                        className="w-full h-48 cursor-crosshair block touch-none"
                      />
                      {!isSigned && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-350 text-[11px] font-bold">
                          ใช้นิ้วหรือเมาส์วาดลายเซ็นของคุณที่นี่
                        </div>
                      )}
                    </div>
                  </div>

                  {/* HorPlus Legal Terms Checkbox */}
                  <div className={`p-3 rounded-2xl space-y-2 transition-colors ${highlightErrors && !isAgreedTerms ? 'bg-rose-50/50 border border-rose-300' : 'bg-slate-50 border border-slate-100'
                    }`}>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        data-testid="tenant-agree-terms-checkbox"

                        checked={isAgreedTerms}
                        onChange={(e) => setIsAgreedTerms(e.target.checked)}
                        className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 shrink-0"
                      />
                      <span className="text-[9px] text-slate-600 font-medium leading-relaxed">
                        ข้าพเจ้าขอรับรองว่าข้อมูลข้างต้นเป็นความจริงทุกประการ ได้อ่านและยอมรับผูกพันตามข้อตกลงสัญญาเช่า กฎระเบียบอาคาร นโยบายการคุ้มครองข้อมูลส่วนบุคคล (PDPA) และเงื่อนไขการใช้งานระบบ HorPlus ทุกประการ ตามที่กฎหมายและข้อบังคับกำหนด
                      </span>
                    </label>
                  </div>
                  {/* IN-STEP SUBMIT BUTTON (ONLY IN STEP 5) */}
                  <div className="pt-4 mt-4 border-t border-slate-200/60">
                    {errorMsg && (
                      <div
                        data-testid="tenant-registration-error-banner"
                        className="mb-3 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold flex items-start gap-2 shadow-2xs"
                      >
                        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                        <span>{errorMsg}</span>
                      </div>
                    )}
                    <button
                      type="submit"
                      data-testid="tenant-registration-submit-btn"
                      disabled={submittingRegistration || (isClaimCandidateRoom && !isClaimVerified)}
                      className={`w-full py-3.5 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all ${submittingRegistration || (isClaimCandidateRoom && !isClaimVerified)
                        ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                        : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-98 cursor-pointer'
                        }`}
                    >
                      {submittingRegistration ? (
                        <>
                          <Clock className="w-4 h-4 animate-spin text-white" />
                          <span>กำลังบันทึกข้อมูล...</span>
                        </>
                      ) : isClaimCandidateRoom && isClaimVerified ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                          <span>ยืนยันสิทธิ์และบันทึกข้อมูล (ลงทะเบียนสำเร็จทันที)</span>
                        </>
                      ) : isAwaitingTenantConfirmation ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                          <span>ลงนามและยืนยันสัญญาเช่า (เปิดใช้งานห้องพัก)</span>
                        </>
                      ) : revisionRequest && revisionRequest.status !== 'pending_owner_approval' ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                          <span>ส่งข้อมูลที่แก้ไขอีกครั้ง (รอเจ้าของหอพักตรวจสอบ)</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                          <span>ส่งคำขอลงทะเบียนผู้เช่า (รอเจ้าของหอพักตรวจสอบ)</span>
                        </>
                      )}
                    </button>
                    {isClaimCandidateRoom && !isClaimVerified && (
                      <p className="text-[10px] text-amber-700 font-bold text-center mt-2">
                        * กรุณายืนยันตัวตนในขั้นตอนที่ 1 เพื่อปลดล็อกการลงทะเบียนสำหรับห้องที่ถูกระบุไว้
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* LOCKED BOTTOM NAVIGATION BAR */}
        {errorMsg && activeStep !== 5 && (
          <div className="mx-4 mb-2 p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold flex items-start gap-2 shadow-2xs">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}
        <div className="shrink-0 mt-auto sticky bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200/80 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] flex items-center justify-between gap-3 sm:rounded-b-2xl">
          {activeStep === 1 ? (
            <button
              type="button"
              data-testid="bottom-nav-change-room-btn"
              onClick={() => setViewState('room_picker')}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>เปลี่ยนห้อง</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="bottom-nav-back-btn"
              onClick={() => goToStep(activeStep - 1)}
              className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-95"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
              <span>ย้อนกลับ</span>
            </button>
          )}

          <div className="text-[11px] font-extrabold text-slate-400">
            ขั้นตอนที่ <span className="text-indigo-600 font-black">{activeStep}</span> / {stepsList.length}
          </div>

          {activeStep < stepsList.length ? (
            <button
              type="button"
              data-testid="bottom-nav-next-btn"
              onClick={handleNextStep}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <span>ถัดไป</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type={rentPlan === 'daily' ? 'button' : 'submit'}
              onClick={rentPlan === 'daily' ? handleDailyStaySubmit : undefined}
              data-testid="bottom-nav-submit-btn"
              disabled={submittingRegistration || (isClaimCandidateRoom && !isClaimVerified)}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-black text-xs shadow-md flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              {submittingRegistration ? (
                <>
                  <Clock className="w-4 h-4 animate-spin text-white" />
                  <span>กำลังบันทึก...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>{rentPlan === 'daily' ? 'ส่งคำขอเข้าพัก' : 'ส่งคำขอลงทะเบียน'}</span>
                </>
              )}
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
