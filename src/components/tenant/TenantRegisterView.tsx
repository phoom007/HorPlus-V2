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
  Lock
} from 'lucide-react';
import { Room, Tenant, Contract, CoOccupant } from '../../types';
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
const saveTenants = (_ts: Tenant[]) => {};
const saveRooms = (_rs: Room[]) => {};
const saveContracts = (_cs: Contract[]) => {};
const addAuditLog = (..._args: any[]) => {};
const getDormitory = (): any => ({
  id: 'dorm-1',
  name: 'HorPlus Dormitory',
  address: '',
  phone: '',
  taxId: '',
  ownerSignature: '',
  promptPayName: '',
  petPolicy: { allowPets: false }
});

export interface TenantRegisterViewProps {
  onBack?: () => void;
  onSuccess?: (registeredTenant: any) => void;
  rooms?: any[];
  policy?: any;
  inviteToken?: string;
  dormitoryId?: string;
  initialMode?: 'auto' | 'claim' | 'vacant' | 'revision';
  initialRoomId?: string;
  revisionRequest?: any;
}

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
  revisionRequest,
}) => {
  const [internalRooms, setInternalRooms] = useState<any[]>(propRooms || []);
  const [policyData, setPolicyData] = useState<any>(propPolicy || null);
  const dormInfo = policyData || getDormitory();

  const [claimInput, setClaimInput] = useState('');
  const [isClaimVerifying, setIsClaimVerifying] = useState(false);
  const [claimVerificationError, setClaimVerificationError] = useState<string | null>(null);
  const [isClaimVerified, setIsClaimVerified] = useState(false);
  const [claimedTenantId, setClaimedTenantId] = useState<string | null>(null);
  const [lockedFinancials, setLockedFinancials] = useState<any | null>(null);
  const [submittingRegistration, setSubmittingRegistration] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState<any | null>(null);

  // Load public rooms & policy dynamically if not passed via props
  useEffect(() => {
    if (propRooms && propRooms.length > 0) {
      setInternalRooms(propRooms);
      if (!selectedRoomId) {
        const init = initialRoomId ? propRooms.find(r => r.id === initialRoomId || r.roomNumber === initialRoomId) : propRooms[0];
        if (init) setSelectedRoomId(init.id);
      }
    } else {
      getPublicRooms(dormitoryId, inviteToken).then((res) => {
        if (res.success && res.data && res.data.length > 0) {
          setInternalRooms(res.data);
          if (!selectedRoomId) {
            const init = initialRoomId ? res.data.find((r: any) => r.id === initialRoomId || r.roomNumber === initialRoomId) : res.data[0];
            if (init) setSelectedRoomId(init.id);
          }
        }
      }).catch(() => {});
    }

    if (propPolicy) {
      setPolicyData(propPolicy);
    } else {
      getPublicDormitoryPolicy(dormitoryId).then((res) => {
        if (res.success && res.data) {
          setPolicyData(res.data);
        }
      }).catch(() => {});
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
    } catch {}
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

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || defaultRoom;
  const isClaimCandidateRoom = !!selectedRoom?.isUnboundClaimable;

  // Step 2: Tenant Profile Info
  const [prefix, setPrefix] = useState<'นาย' | 'นาง' | 'นางสาว'>('นาย');
  const [fullName, setFullName] = useState('');
  const [citizenId, setCitizenId] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('2002-05-15');
  const [address, setAddress] = useState('');
  const [idCardImage, setIdCardImage] = useState<string | null>(null);

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
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 10);
    let formatted = raw;
    if (raw.length > 3) formatted = raw.slice(0, 3) + '-' + raw.slice(3);
    if (raw.length > 6) formatted = raw.slice(0, 3) + '-' + raw.slice(3, 6) + '-' + raw.slice(6);
    setPhone(formatted);
  };

  // Image Upload Handler
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setIdCardImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Step 3: Rent Type & Deposit
  const [rentPlan, setRentPlan] = useState<'monthly' | 'term' | 'daily'>('monthly');
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentMonths, setInstallmentMonths] = useState<number>(4);
  const [installmentAllocation, setInstallmentAllocation] = useState<'first_period' | 'equal'>('first_period');
  const [rentAmount, setRentAmount] = useState<number>(selectedRoom ? selectedRoom.monthlyRent : 4500);
  const [depositAmount, setDepositAmount] = useState<number>(selectedRoom ? selectedRoom.depositAmount : 5000);
  const [depositStatus, setDepositStatus] = useState<'paid' | 'unpaid'>('paid');

  // Dedicated DailyStay State
  const [dailyEndDate, setDailyEndDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [dailySpecialRequests, setDailySpecialRequests] = useState('');

  // Step 4: Dates & Duration
  const todayStr = new Date().toISOString().split('T')[0];
  const [contractDate, setContractDate] = useState(todayStr);
  const [checkInDate, setCheckInDate] = useState(todayStr);
  const [durationValue, setDurationValue] = useState<number>(12);
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

  // Auto adjust duration default when rent plan changes
  useEffect(() => {
    if (rentPlan === 'daily') {
      setDurationValue(1);
    } else if (rentPlan === 'term') {
      setDurationValue(4);
    } else if (rentPlan === 'monthly') {
      setDurationValue(12);
    }
  }, [rentPlan]);

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

  // Step 5: Emergency Contact & Co-occupants
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyRel, setEmergencyRel] = useState('ผู้ปกครอง');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  const [hasCoOccupants, setHasCoOccupants] = useState(false);
  const [coOccupants, setCoOccupants] = useState<{ id: string; name: string; phone: string; citizenId: string }[]>([]);
  const [newCoName, setNewCoName] = useState('');
  const [newCoPhone, setNewCoPhone] = useState('');
  const [newCoCitizenId, setNewCoCitizenId] = useState('');

  // Step 6: Vehicle & Pet
  const [vehicleType, setVehicleType] = useState<'none' | 'car' | 'motorcycle' | 'bicycle'>('none');
  const [vehicleBrand, setVehicleBrand] = useState('Honda');
  const [customBrand, setCustomBrand] = useState('');
  const [licensePlate, setLicensePlate] = useState('');

  const [hasPet, setHasPet] = useState(false);
  const [petType, setPetType] = useState('แมว');
  const [petName, setPetName] = useState('');
  const [petCount, setPetCount] = useState<number>(1);

  // Step 7: Signature & Real-time Contract
  const [isSigned, setIsSigned] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string>('');
  const [isAgreedTerms, setIsAgreedTerms] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Signature Canvas Drawing Logic
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    if (selectedRoom) {
      if (rentPlan === 'monthly') setRentAmount(selectedRoom.monthlyRent);
      else if (rentPlan === 'term') setRentAmount(selectedRoom.termRent || selectedRoom.monthlyRent * 4);
      else if (rentPlan === 'daily') setRentAmount(selectedRoom.dailyRent || 500);

      setDepositAmount(selectedRoom.depositAmount);
    }
  }, [selectedRoomId, rentPlan]);

  // Active step tracking & navigation (Steps 1 to 7)
  const [activeStep, setActiveStep] = useState<number>(1);

  const stepsList = rentPlan === 'daily' ? [
    { step: 1, label: 'เลือกห้อง', shortLabel: 'ห้องพัก' },
    { step: 2, label: 'ข้อมูลผู้พัก', shortLabel: 'ผู้พัก' },
    { step: 3, label: 'คำขอเข้าพักรายวัน', shortLabel: 'รายวัน' }
  ] : [
    { step: 1, label: 'เลือกห้อง', shortLabel: 'ห้องพัก' },
    { step: 2, label: 'ข้อมูลส่วนตัว & บัตร', shortLabel: 'ผู้เช่า' },
    { step: 3, label: 'ค่าเช่า & มัดจำ', shortLabel: 'ค่าเช่า' },
    { step: 4, label: 'วันเข้าพัก & สัญญา', shortLabel: 'เข้าพัก' },
    { step: 5, label: 'ผู้ติดต่อฉุกเฉิน', shortLabel: 'ผู้ติดต่อ' },
    { step: 6, label: 'รถ & สัตว์เลี้ยง', shortLabel: 'รถ/สัตว์' },
    { step: 7, label: 'เซ็นสัญญาเช่า', shortLabel: 'สัญญา' }
  ];

  useEffect(() => {
    const handleScroll = () => {
      const steps = rentPlan === 'daily' ? [1, 2, 3] : [1, 2, 3, 4, 5, 6, 7];
      for (const s of steps) {
        const el = document.getElementById(`step-${s}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 260 && rect.bottom >= 80) {
            setActiveStep(s);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    const containers = document.querySelectorAll('.overflow-y-auto, #tenant-main-scroll-container');
    containers.forEach((c) => c.addEventListener('scroll', handleScroll, { passive: true }));

    return () => {
      window.removeEventListener('scroll', handleScroll);
      containers.forEach((c) => c.removeEventListener('scroll', handleScroll));
    };
  }, []);

  const scrollToStep = (stepNumber: number) => {
    setActiveStep(stepNumber);
    const el = document.getElementById(`step-${stepNumber}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Canvas Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ('touches' in e) ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = ('touches' in e) ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#312e81'; // Indigo-900
    ctx.lineTo(x, y);
    ctx.stroke();
    setIsSigned(true);
    setSignatureDataUrl(canvas.toDataURL('image/png'));
  };

  const stopDrawing = () => {
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
        setClaimedTenantId(res.data.tenantId);
        setLockedFinancials(res.data.lockedFinancials);

        if (res.data.displayName) {
          setFullName(res.data.displayName);
        } else if (res.data.firstName) {
          setFullName(`${res.data.firstName} ${res.data.lastName || ''}`.trim());
        }
        if (res.data.phone) setPhone(res.data.phone);
        if (res.data.citizenId) setCitizenId(res.data.citizenId);

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
          setEmergencyPhone(res.data.emergencyContact.phone || '');
          setEmergencyRel(res.data.emergencyContact.relationship || 'ผู้ติดต่อฉุกเฉิน');
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

  // Revision / Confirmation Pre-population
  useEffect(() => {
    if (revisionRequest) {
      const snap = revisionRequest.acceptanceSnapshot || {};
      const approved = snap.approvedTerms || revisionRequest.approvedTerms || {};

      if (snap.requestedRoomId) setSelectedRoomId(snap.requestedRoomId);
      if (snap.fullName) setFullName(snap.fullName);
      if (snap.phone) setPhone(snap.phone);
      if (snap.citizenId) setCitizenId(snap.citizenId);
      if (snap.birthDate) setBirthDate(snap.birthDate);
      if (snap.address) setAddress(snap.address);
      if (snap.idCardImageUrl) setIdCardImage(snap.idCardImageUrl);

      if (approved.rentAmount !== undefined && approved.rentAmount !== null) {
        setRentAmount(Number(approved.rentAmount));
      } else if (snap.proposedRent) {
        setRentAmount(Number(snap.proposedRent));
      }

      if (approved.depositAmount !== undefined && approved.depositAmount !== null) {
        setDepositAmount(Number(approved.depositAmount));
      } else if (snap.proposedDeposit) {
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

      if (approved.dueDay) {
        setDueDay(approved.dueDay);
      }

      if (snap.emergencyContact) {
        setEmergencyName(snap.emergencyContact.name || '');
        setEmergencyPhone(snap.emergencyContact.phone || '');
        setEmergencyRel(snap.emergencyContact.relationship || 'ผู้ติดต่อฉุกเฉิน');
      }
      if (snap.vehicle) {
        setVehicleType(snap.vehicle.type || 'none');
        setVehicleBrand(snap.vehicle.brand || 'Honda');
        setLicensePlate(snap.vehicle.licensePlate || '');
      }
      if (snap.pet) {
        setHasPet(!!snap.pet.hasPet);
        setPetType(snap.pet.type || 'สุนัข');
        setPetName(snap.pet.name || '');
        setPetCount(snap.pet.count || 1);
      }
    }
  }, [revisionRequest]);

  // Daily Stay Submit Handler
  const handleDailyStaySubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg('');

    if (!fullName.trim()) {
      setErrorMsg('กรุณากรอกชื่อ-นามสกุลของผู้เข้าพัก');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('กรุณากรอกเบอร์โทรศัพท์ของผู้เข้าพัก');
      return;
    }
    if (!selectedRoomId) {
      setErrorMsg('กรุณาเลือกห้องพักที่ต้องการเข้าพัก');
      return;
    }
    if (!isAgreedTerms) {
      setErrorMsg('กรุณาติ๊กยอมรับเงื่อนไขและกฎระเบียบการเข้าพักรายวัน');
      return;
    }
    if (!signatureDataUrl) {
      setErrorMsg('กรุณาลงลายมือชื่อดิจิทัลยืนยันการขอเข้าพัก');
      return;
    }

    setSubmittingRegistration(true);

    try {
      const res = await submitDailyStayRequest({
        dormitoryId: dormitoryId || dormInfo?.id || 'dorm-1',
        roomId: selectedRoomId,
        roomNumber: selectedRoom?.roomNumber,
        applicantFullName: `${prefix} ${fullName}`.trim(),
        applicantPhone: phone.trim() || undefined,
        startDate: checkInDate,
        endDate: dailyEndDate,
        dailyRateAmount: Number(rentAmount).toFixed(2),
        depositAmount: Number(depositAmount || 0).toFixed(2),
        depositDeclaredStatus: depositStatus === 'paid' ? 'PAID' : 'UNPAID',
      });

      if (res.success) {
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

    if (!fullName.trim()) {
      setErrorMsg('กรุณากรอกชื่อ-นามสกุลของผู้เช่า');
      return;
    }
    if (!phone.trim()) {
      setErrorMsg('กรุณากรอกเบอร์โทรศัพท์ของผู้เช่า');
      return;
    }
    if (!citizenId.trim()) {
      setErrorMsg('กรุณากรอกเลขบัตรประชาชน / พาสปอร์ต');
      return;
    }

    if (!selectedRoomId) {
      setErrorMsg('กรุณาเลือกห้องพักที่ต้องการลงทะเบียน');
      return;
    }

    if (!isAgreedTerms) {
      setErrorMsg('กรุณาติ๊กยอมรับเงื่อนไขสัญญาเช่าและข้อบังคับตามกฎหมายระบบ HorPlus');
      return;
    }

    if (!signatureDataUrl) {
      setErrorMsg('กรุณาลงลายมือชื่อดิจิทัลก่อนดำเนินการต่อ');
      return;
    }

    setSubmittingRegistration(true);

    try {
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] || fullName.trim();
      const lastName = nameParts.slice(1).join(' ') || '-';
      const finalBrand = vehicleBrand === 'อื่นๆ' ? customBrand : vehicleBrand;

      // Scenario A: Owner-Created Claim Flow (Bypasses Owner Approval -> REGISTERED)
      if (isClaimCandidateRoom && isClaimVerified && claimedTenantId) {
        const res = await completeTenantClaim({
          dormitoryId,
          inviteToken,
          roomId: selectedRoomId,
          tenantId: claimedTenantId,
          signatureBase64: signatureDataUrl,
          displayName: `${prefix} ${fullName.trim()}`,
          firstName,
          lastName,
          phone: phone.trim(),
          citizenId: citizenId.trim(),
          birthDate,
          address,
          idCardImageUrl: idCardImage || undefined,
          emergencyContact: emergencyName.trim() ? {
            name: emergencyName.trim(),
            relationship: emergencyRel,
            phone: emergencyPhone.trim() || phone.trim()
          } : undefined,
          vehicle: vehicleType !== 'none' ? {
            type: vehicleType,
            licensePlate: licensePlate.trim(),
            brand: finalBrand.trim()
          } : undefined,
          coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
            name: c.name,
            phone: c.phone,
            citizenId: c.citizenId
          })) : undefined,
          pet: hasPet ? {
            hasPet: true,
            type: petType,
            name: petName,
            count: petCount
          } : undefined,
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
          signatureBase64: signatureDataUrl,
          dormitoryId: dormitoryId || revisionRequest.dormitoryId || dormInfo?.id,
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

      // Scenario Option B: Revision Resubmission
      if (revisionRequest) {
        const res = await resubmitTenantRegistrationRequest(revisionRequest.id, {
          dormitoryId,
          inviteToken,
          requestedRoomId: selectedRoomId,
          firstName,
          lastName,
          phone: phone.trim(),
          note: `แก้ไขคำขอตามที่เจ้าของหอพักร้องขอ: ${revisionRequest.rejectedReason || ''}`,
          agreedTerms: true,
          signatureBase64: signatureDataUrl,
          expectedPolicyVersion: policyData?.version || 1,
          rentalPlan: rentPlan,
          proposedRent: rentAmount,
          proposedDeposit: depositAmount,
          durationMonths: durationValue,
          startDate: checkInDate,
          citizenId: citizenId.trim(),
          birthDate,
          address,
          idCardImageUrl: idCardImage || undefined,
          emergencyContact: emergencyName.trim() ? {
            name: emergencyName.trim(),
            relationship: emergencyRel,
            phone: emergencyPhone.trim() || phone.trim()
          } : undefined,
          coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
            name: c.name,
            phone: c.phone,
            citizenId: c.citizenId
          })) : undefined,
          vehicle: vehicleType !== 'none' ? {
            type: vehicleType,
            licensePlate: licensePlate.trim(),
            brand: finalBrand.trim()
          } : undefined,
          pet: hasPet ? {
            hasPet: true,
            type: petType,
            name: petName,
            count: petCount
          } : undefined,
        });

        if (res.success) {
          const successObj = {
            status: 'pending_owner_approval',
            label: 'รออนุมัติคำขอผู้เช่า',
            message: 'ส่งข้อมูลที่แก้ไขเรียบร้อยแล้ว กรุณารอเจ้าของหอพักตรวจสอบ',
            data: res.data
          };
          setSubmissionSuccess(successObj);
          if (onSuccess) onSuccess(res.data);
          return;
        } else {
          setErrorMsg(res.error?.message || 'ไม่สามารถส่งข้อมูลแก้ไขได้ กรุณาลองใหม่อีกครั้ง');
          return;
        }
      }

      // Scenario B: Public Self-Registration (Vacant Room)
      const res = await submitTenantRegistrationRequest({
        dormitoryId,
        inviteToken,
        requestedRoomId: selectedRoomId,
        firstName,
        lastName,
        phone: phone.trim(),
        agreedTerms: true,
        signatureBase64: signatureDataUrl,
        expectedPolicyVersion: policyData?.version || 1,
        rentalPlan: rentPlan,
        proposedRent: rentAmount,
        proposedDeposit: depositAmount,
        durationMonths: durationValue,
        startDate: checkInDate,
        citizenId: citizenId.trim(),
        birthDate,
        address,
        idCardImageUrl: idCardImage || undefined,
        emergencyContact: emergencyName.trim() ? {
          name: emergencyName.trim(),
          relationship: emergencyRel,
          phone: emergencyPhone.trim() || phone.trim()
        } : undefined,
        coOccupants: hasCoOccupants && coOccupants.length > 0 ? coOccupants.map(c => ({
          name: c.name,
          phone: c.phone,
          citizenId: c.citizenId
        })) : undefined,
        vehicle: vehicleType !== 'none' ? {
          type: vehicleType,
          licensePlate: licensePlate.trim(),
          brand: finalBrand.trim()
        } : undefined,
        pet: hasPet ? {
          hasPet: true,
          type: petType,
          name: petName,
          count: petCount
        } : undefined,
      });

      if (res.success) {
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
      <div className="min-h-[520px] flex flex-col items-center justify-center p-6 text-center space-y-4 bg-white rounded-3xl border border-slate-100 shadow-sm max-w-lg mx-auto my-8">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
          submissionSuccess.status === 'REGISTERED' ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
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

  return (
    <div className="min-h-full flex flex-col bg-slate-50 relative pb-28">
      {/* Top Header with Minimal 1-7 Progress Step Bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-100 shadow-2xs">
        {/* Main Title Row */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
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
            const isCompleted = activeStep > item.step;
            return (
              <button
                key={item.step}
                type="button"
                onClick={() => scrollToStep(item.step)}
                className={`flex-1 min-w-[42px] py-1 px-1 rounded-xl transition-all text-center flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white font-extrabold shadow-xs scale-102'
                    : isCompleted
                    ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold border border-indigo-100'
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-400 font-semibold border border-slate-100'
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <span className={`w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-black ${
                    isActive
                      ? 'bg-white text-indigo-700'
                      : isCompleted
                      ? 'bg-indigo-200 text-indigo-900'
                      : 'bg-slate-200/80 text-slate-500'
                  }`}>
                    {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : item.step}
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

      <form onSubmit={handleSubmit} className="p-4 space-y-5 flex-1 pb-16">
        {/* Two-Phase Approved Confirmation Notice */}
        {isAwaitingTenantConfirmation && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-3xl flex items-start gap-3 text-emerald-900 text-xs animate-in fade-in duration-200">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h5 className="font-extrabold text-emerald-950 text-xs flex items-center gap-1.5">
                <span>เจ้าของหอพักอนุมัติคำขอของคุณแล้ว (กรุณาตรวจสอบและยืนยัน)</span>
              </h5>
              <p className="text-[11px] text-emerald-800">
                กรุณาตรวจสอบเงื่อนไขสัญญาเช่าด้านล่าง และลงนามดิจิทัลในขั้นตอนที่ 7 เพื่อยืนยันการเปิดใช้งานห้องพัก
              </p>
            </div>
          </div>
        )}

        {/* Option B: Revision Reason Notice */}
        {revisionRequest && !isAwaitingTenantConfirmation && (
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-3xl flex items-start gap-3 text-rose-900 text-xs">
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

        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center gap-2.5 text-rose-800 text-xs animate-in fade-in duration-200">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span className="font-bold text-[11px]">{errorMsg}</span>
          </div>
        )}

        {/* SECTION 1: เลือกเลขห้อง (SELECT ROOM) */}
        <div id="step-1" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              1
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-xs">เลือกเลขห้องพัก *</h4>
              <p className="text-[9px] text-slate-400">เลือกห้องพักที่ต้องการลงทะเบียน</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-[10px] font-bold text-slate-600">
              เลขห้องว่างในระบบ
            </label>
            <select
              data-testid="tenant-registration-room-select"
              value={selectedRoomId}
              onChange={(e) => {
                setSelectedRoomId(e.target.value);
                setIsClaimVerified(false);
                setClaimedTenantId(null);
                setLockedFinancials(null);
                setClaimVerificationError(null);
              }}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none text-xs"
            >
              {rooms.map((r) => {
                const isSelectable = r.selectable !== false;
                const label = r.badgeLabel || (
                  r.isUnboundClaimable
                    ? 'ยังไม่ผูก LINE (ยืนยันสิทธิ์)'
                    : r.isVacant
                    ? 'ห้องว่าง'
                    : r.status === 'vacant'
                    ? 'ห้องว่าง'
                    : r.status === 'maintenance'
                    ? 'ปิดปรับปรุง'
                    : r.status === 'reserved'
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
          </div>

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
        </div>

        {/* SECTION 2: กรอกข้อมูลผู้เช่า & แนบรูปภาพเอกสาร (TENANT PERSONAL INFO & ID ATTACHMENT) */}
        <div id="step-2" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28">
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
              <label className="block font-bold text-slate-600">คำนำหน้า</label>
              <select
                value={prefix}
                onChange={(e) => setPrefix(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              >
                <option value="นาย">นาย</option>
                <option value="นาง">นาง</option>
                <option value="นางสาว">นางสาว</option>
              </select>
            </div>

            <div className="col-span-8 space-y-1">
              <label className="block font-bold text-slate-600">ชื่อ - นามสกุล *</label>
              <input
                type="text"
                required
                placeholder="เช่น สมชาย ใจดี"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="col-span-12 space-y-1">
              <label className="block font-bold text-slate-600">เลขบัตรประชาชน / พาสปอร์ต *</label>
              <input
                type="text"
                required
                placeholder="1-2345-67890-12-3"
                value={citizenId}
                onChange={handleCitizenIdChange}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none tracking-wider"
              />
            </div>

            <div className="col-span-6 space-y-1">
              <label className="block font-bold text-slate-600">เบอร์โทรศัพท์ *</label>
              <input
                type="tel"
                required
                placeholder="081-234-5678"
                value={phone}
                onChange={handlePhoneChange}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none tracking-wider"
              />
            </div>

            <div className="col-span-6 space-y-1">
              <label className="block font-bold text-slate-600">อีเมล (ไม่บังคับ)</label>
              <input
                type="email"
                placeholder="example@mail.com (ถ้ามี)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="col-span-12 space-y-1">
              <label className="block font-bold text-slate-600">วัน/เดือน/ปีเกิด</label>
              <input
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="col-span-12 space-y-1">
              <label className="block font-bold text-slate-600">ที่อยู่ตามทะเบียนบ้าน</label>
              <textarea
                rows={2}
                placeholder="กรอกที่อยู่ปัจจุบัน หรือ คณะ/มหาวิทยาลัย"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500 focus:outline-none resize-none"
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
                  (รองรับไฟล์ JPG, PNG)
                </span>
              </label>

              {/* Upload Box (Raw image without automatic watermark overlay) */}
              <div className="relative border-2 border-dashed border-indigo-200 bg-indigo-50/20 rounded-2xl p-4 text-center hover:bg-indigo-50/50 transition-all cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />

                {idCardImage ? (
                  <div className="relative space-y-2.5">
                    <div className="relative max-h-52 rounded-xl overflow-hidden border-2 border-indigo-300 bg-white shadow-xs inline-block">
                      {/* Clean original uploaded image without watermark overlay */}
                      <img
                        src={idCardImage}
                        alt="สำเนาบัตรประชาชน"
                        className="max-h-48 object-contain mx-auto rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIdCardImage('');
                        }}
                        className="absolute top-2 right-2 bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-md z-30 active:scale-95"
                      >
                        ล้างรูปภาพ
                      </button>
                    </div>

                    <p className="text-[10px] text-emerald-600 font-black flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" /> แนบรูปภาพสำเนาบัตรประชาชนเรียบร้อยแล้ว (คลิกเพื่อเปลี่ยนรูปภาพ)
                    </p>
                  </div>
                ) : (
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
                )}
              </div>

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
                        * ใช้สำหรับเช่าห้องพัก {selectedRoom?.roomNumber || '...'} {dormInfo.name || 'หอพัก'} เท่านั้น * ({contractDate})
                      </p>
                      <p className="text-[9px] font-black text-slate-800 mt-0.5">
                        สำเนาถูกต้อง
                      </p>
                      <p className="text-[8px] font-bold text-indigo-950 italic">
                        ลายเซ็น: {fullName || prefix + ' สมชาย ใจดี'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: เลือกประเภทค่าเช่า & ค่ามัดจำ (RENTAL PLAN, DEPOSIT & INSTALLMENT CALCULATOR) */}
        <div id="step-3" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              3
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-xs">ประเภทค่าเช่า, ค่ามัดจำ & การแบ่งชำระ *</h4>
              <p className="text-[9px] text-slate-400">กำหนดค่าเช่า, ค่ามัดจำ และคำนวณงวดการแบ่งชำระอัตโนมัติ</p>
            </div>
          </div>

          <div className="space-y-3.5 text-[10px]">
            {/* Locked Financials Notification */}
            {isAwaitingTenantConfirmation && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-2 text-emerald-900 text-xs font-bold animate-in fade-in duration-200">
                <Lock className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>เจ้าของหอพักอนุมัติคำขอของคุณแล้ว กรุณาตรวจสอบเงื่อนไขสัญญาเช่าที่กำหนดไว้ (ล็อกไม่สามารถแก้ไขได้)</span>
              </div>
            )}
            {isClaimVerified && (
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-2xl flex items-center gap-2 text-indigo-900 text-xs font-bold animate-in fade-in duration-200">
                <Lock className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>ข้อมูลสัญญาและค่าเช่าถูกกำหนดโดยเจ้าของหอพักแล้ว (ล็อกไม่สามารถแก้ไขได้)</span>
              </div>
            )}

            {/* Rent Plan Selector */}
            <div className="space-y-1.5">
              <label className="block font-bold text-slate-600 flex items-center gap-1.5">
                <span>ประเภทสัญญาค่าเช่า *</span>
                {isFinancialsLocked && <Lock className="w-3 h-3 text-slate-400" />}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'monthly', label: 'รายเดือน' },
                  { id: 'term', label: 'รายเทอม' },
                  { id: 'daily', label: 'รายวัน' }
                ].map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    disabled={isFinancialsLocked}
                    onClick={() => setRentPlan(item.id as any)}
                    className={`py-2.5 px-3 rounded-xl border text-center font-black transition-all ${
                      rentPlan === item.id
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : isFinancialsLocked
                        ? 'bg-slate-100 border-slate-200 text-slate-400 opacity-60'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {rentPlan === 'daily' ? (
              /* DEDICATED DAILY STAY WORKFLOW */
              <div className="space-y-4 pt-1 animate-in fade-in duration-200">
                <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-2xl flex items-center gap-2.5 text-sky-900 text-xs">
                  <Calendar className="w-5 h-5 text-sky-600 shrink-0" />
                  <div>
                    <span className="font-extrabold block text-xs">การเข้าพักรายวัน (DailyStay Workflow)</span>
                    <span className="text-[10px] text-sky-700">การเข้าพักรายวัน ไม่ต้องทำสัญญาเช่าระยะยาว กำหนดเฉพาะวันที่เข้าพัก วันสิ้นสุด และลงชื่อขอเข้าพัก</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600">วันเริ่มเข้าพัก (Check-in) *</label>
                    <input
                      type="date"
                      required
                      value={checkInDate}
                      onChange={(e) => setCheckInDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600">วันสิ้นสุดการเข้าพัก (Check-out) *</label>
                    <input
                      type="date"
                      required
                      value={dailyEndDate}
                      min={checkInDate}
                      onChange={(e) => setDailyEndDate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
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
                    <label className="block font-bold text-slate-600">ค่ามัดจำกุญแจ/ห้อง (ถ้ามี)</label>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(Number(e.target.value))}
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

                {/* Special Requests / Notes */}
                <div className="space-y-1">
                  <label className="block font-bold text-slate-600">ความต้องการเพิ่มเติม (ถ้ามี)</label>
                  <textarea
                    rows={2}
                    value={dailySpecialRequests}
                    onChange={(e) => setDailySpecialRequests(e.target.value)}
                    placeholder="เช่น เวลาเข้าพักโดยประมาณ, ต้องการเตียงเสริม ฯลฯ"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold resize-none"
                  />
                </div>

                {/* Check-in Signature for Daily Stay */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex justify-between items-center">
                    <label className="font-bold text-slate-700 flex items-center gap-1">
                      <FileSignature className="w-3.5 h-3.5 text-indigo-600" />
                      <span>ลายเซ็นดิจิทัลสำหรับขอเข้าพักรายวัน *</span>
                    </label>
                    {isSigned && (
                      <button
                        type="button"
                        onClick={clearSignature}
                        className="text-[9px] font-bold text-rose-600 hover:underline"
                      >
                        ล้างลายเซ็น
                      </button>
                    )}
                  </div>

                  <div className="border-2 border-dashed border-sky-200 rounded-2xl bg-sky-50/20 overflow-hidden relative touch-none">
                    <canvas
                      ref={canvasRef}
                      width={340}
                      height={110}
                      onMouseDown={startDrawing}
                      onMouseMove={draw}
                      onMouseUp={stopDrawing}
                      onMouseLeave={stopDrawing}
                      onTouchStart={startDrawing}
                      onTouchMove={draw}
                      onTouchEnd={stopDrawing}
                      className="w-full h-28 cursor-crosshair block"
                    />
                    {!isSigned && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-350 text-[10px] font-bold">
                        เซ็นชื่อเพื่อยืนยันคำขอเข้าพักรายวัน
                      </div>
                    )}
                  </div>
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
            ) : (
              /* MONTHLY / TERM CONTRACT FLOW */
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
                        type="number"
                        required
                        readOnly={isFinancialsLocked}
                        disabled={isFinancialsLocked}
                        value={rentAmount}
                        onChange={(e) => setRentAmount(Number(e.target.value))}
                        className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-black text-xs ${
                          isFinancialsLocked ? 'bg-slate-100 border-slate-200 opacity-75' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500'
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
                        type="number"
                        required
                        readOnly={isFinancialsLocked}
                        disabled={isFinancialsLocked}
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(Number(e.target.value))}
                        className={`w-full px-3 py-2 border rounded-xl text-slate-800 font-black text-xs ${
                          isFinancialsLocked ? 'bg-slate-100 border-slate-200 opacity-75' : 'bg-slate-50 border-slate-200 focus:bg-white focus:border-indigo-500'
                        }`}
                      />
                      <span className="absolute right-3 top-2 text-[10px] text-slate-400 font-bold">บาท</span>
                    </div>
                  </div>
                </div>

                {/* Deposit Status Switch: Paid / Unpaid */}
                <div className="space-y-1.5 pt-1">
                  <label className="block font-bold text-slate-600 flex justify-between items-center">
                    <span>สถานะการชำระเงินมัดจำ / ประกัน *</span>
                    <span className="text-[9px] font-bold text-indigo-600">
                      {depositStatus === 'paid' ? '✓ ชำระแล้ว (ไม่อยู่ในยอดผ่อนงวด)' : '⚠️ ยังไม่ชำระ (คำนวณรวมในงวดแรก)'}
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositStatus('paid')}
                      className={`py-2 px-3 rounded-xl border text-center font-black flex items-center justify-center gap-1.5 transition-all ${
                        depositStatus === 'paid'
                          ? 'bg-emerald-500 text-white border-emerald-500 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>มัดจำ: จ่ายแล้ว (Paid)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDepositStatus('unpaid')}
                      className={`py-2 px-3 rounded-xl border text-center font-black flex items-center justify-center gap-1.5 transition-all ${
                        depositStatus === 'unpaid'
                          ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>มัดจำ: ยังไม่จ่าย (Unpaid)</span>
                    </button>
                  </div>
                </div>

                {/* INSTALLMENT OPTION & AUTOMATIC PERIOD CALCULATOR */}
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
                      <div className="space-y-3 pl-6 pt-1 animate-in fade-in duration-200">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <span className="block font-bold text-indigo-900 text-[9px]">จำนวนงวดการแบ่งชำระ:</span>
                            <select
                              value={installmentMonths}
                              onChange={(e) => setInstallmentMonths(Number(e.target.value))}
                              className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl font-bold text-indigo-900 text-xs"
                            >
                              <option value={2}>แบ่งชำระ 2 งวด</option>
                              <option value={3}>แบ่งชำระ 3 งวด</option>
                              <option value={4}>แบ่งชำระ 4 งวด</option>
                              <option value={6}>แบ่งชำระ 6 งวด</option>
                              <option value={12}>แบ่งชำระ 12 งวด</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <span className="block font-bold text-indigo-900 text-[9px]">การจัดสรรเงินมัดจำ:</span>
                            <select
                              value={installmentAllocation}
                              onChange={(e) => setInstallmentAllocation(e.target.value as any)}
                              className="w-full px-3 py-1.5 bg-white border border-indigo-200 rounded-xl font-bold text-indigo-900 text-xs"
                            >
                              <option value="first_period">รวมค่ามัดจำในงวดที่ 1 (มาตรฐาน)</option>
                              <option value="equal">หารเฉลี่ยรวมมัดจำทุกงวดเท่ากัน</option>
                            </select>
                          </div>
                        </div>

                        {/* AUTOMATIC CALCULATED BREAKDOWN TABLE */}
                        <div className="p-3 bg-white border border-indigo-200 rounded-xl space-y-2 shadow-2xs">
                          <div className="flex justify-between items-center text-[10px] border-b border-indigo-100 pb-1.5">
                            <span className="font-extrabold text-indigo-950 flex items-center gap-1">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                              <span>ตารางคำนวณค่างวดรายงวดอัตโนมัติ ({installmentMonths} งวด)</span>
                            </span>
                            <span className="font-black text-indigo-700">
                              รวมทั้งสิ้น: ฿ {(rentAmount + (depositStatus === 'unpaid' ? depositAmount : 0)).toLocaleString()}
                            </span>
                          </div>

                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                            {installmentSchedule.map((item) => (
                              <div
                                key={item.period}
                                className={`p-2 rounded-lg border text-[9px] flex justify-between items-center ${
                                  item.period === 1
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
              </>
            )}
          </div>
        </div>

        {/* LONG-TERM CONTRACT ONLY: STEPS 4, 5, 6, 7 & SUBMIT */}
        {rentPlan !== 'daily' && (
          <>
            {/* SECTION 4: กำหนดวันเข้าพัก & ระยะเวลาสัญญา (DYNAMIC DURATION & CHECK-IN DATES) */}
        <div id="step-4" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              4
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-xs">กำหนดวันเข้าพัก & ระยะเวลาสัญญาตามประเภทค่าเช่า *</h4>
              <p className="text-[9px] text-slate-400">ตัวเลือกสัญญาสอดคล้องตามสัญญา ({rentPlan === 'monthly' ? 'รายเดือน' : rentPlan === 'term' ? 'รายเทอม' : 'รายวัน'})</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[10px]">
            <div className="space-y-1">
              <label className="block font-bold text-slate-600">วันทำสัญญา</label>
              <input
                type="date"
                required
                value={contractDate}
                onChange={(e) => setContractDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-600">วันเริ่มย้ายเข้าพัก</label>
              <input
                type="date"
                required
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
              />
            </div>

            {/* DYNAMIC DURATION DURATION SELECTOR BASED ON RENT PLAN */}
            <div className="space-y-1">
              <label className="block font-bold text-slate-600">
                ระยะเวลาสัญญา {rentPlan === 'daily' ? '(จำนวนวัน)' : rentPlan === 'term' ? '(จำนวนเทอม/เดือน)' : '(จำนวนเดือน)'} *
              </label>
              <select
                value={durationValue}
                onChange={(e) => setDurationValue(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
              >
                {rentPlan === 'daily' && (
                  <>
                    <option value={1}>1 วัน</option>
                    <option value={2}>2 วัน</option>
                    <option value={3}>3 วัน</option>
                    <option value={5}>5 วัน</option>
                    <option value={7}>7 วัน (1 สัปดาห์)</option>
                    <option value={10}>10 วัน</option>
                    <option value={15}>15 วัน (ครึ่งเดือน)</option>
                    <option value={30}>30 วัน (1 เดือน)</option>
                  </>
                )}

                {rentPlan === 'term' && (
                  <>
                    <option value={4}>4 เดือน (1 ภาคเรียน)</option>
                    <option value={5}>5 เดือน</option>
                    <option value={8}>8 เดือน (2 ภาคเรียน)</option>
                    <option value={10}>10 เดือน</option>
                    <option value={12}>12 เดือน (1 ปีการศึกษา)</option>
                  </>
                )}

                {rentPlan === 'monthly' && (
                  <>
                    <option value={1}>1 เดือน</option>
                    <option value={3}>3 เดือน</option>
                    <option value={6}>6 เดือน</option>
                    <option value={12}>12 เดือน (1 ปี)</option>
                    <option value={24}>24 เดือน (2 ปี)</option>
                  </>
                )}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block font-bold text-slate-600">วันครบกำหนดชำระรายเดือน / รอบบิล</label>
              <select
                value={dueDay}
                onChange={(e) => setDueDay(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
              >
                <option value={1}>วันที่ 1 ของทุกเดือน</option>
                <option value={5}>วันที่ 5 ของทุกเดือน</option>
                <option value={10}>วันที่ 10 ของทุกเดือน</option>
                <option value={25}>วันที่ 25 ของทุกเดือน</option>
              </select>
            </div>

            <div className="col-span-2 p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-2xl text-[9.5px] text-slate-700 flex justify-between items-center font-bold">
              <span className="flex items-center gap-1 text-slate-600">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>วันสิ้นสุดสัญญาเช่าโดยประมาณ:</span>
              </span>
              <span className="font-black text-indigo-700 text-[10.5px]">
                {formatThaiDateStr(endDate)} ({durationValue}{rentPlan === 'daily' ? ' วัน' : ' เดือน'})
              </span>
            </div>
          </div>
        </div>

        {/* SECTION 5: ผู้ติดต่อฉุกเฉิน & ผู้พักอาศัยร่วม (EMERGENCY & CO-OCCUPANTS) */}
        <div id="step-5" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              5
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-xs">ผู้ติดต่อฉุกเฉิน & ผู้พักอาศัยร่วม</h4>
              <p className="text-[9px] text-slate-400">ข้อมูลบุคคลอ้างอิงและเพื่อนร่วมห้อง (ถ้ามี)</p>
            </div>
          </div>

          <div className="space-y-3 text-[10px]">
            {/* Emergency Contact */}
            <div className="space-y-2 p-3 bg-slate-50/70 border border-slate-100 rounded-2xl">
              <span className="font-extrabold text-slate-800 block text-[10px]">ข้อมูลผู้ติดต่อฉุกเฉิน</span>
              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-5">
                  <input
                    type="text"
                    placeholder="ชื่อ-นามสกุล"
                    value={emergencyName}
                    onChange={(e) => setEmergencyName(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                  />
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    placeholder="ความสัมพันธ์"
                    value={emergencyRel}
                    onChange={(e) => setEmergencyRel(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                  />
                </div>
                <div className="col-span-4">
                  <input
                    type="tel"
                    placeholder="เบอร์โทรฉุกเฉิน"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Co-Occupants Checkbox */}
            <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
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
                <div className="space-y-2.5 p-3 bg-white border border-indigo-200 rounded-xl animate-in fade-in duration-200 shadow-2xs">
                  <span className="font-extrabold text-indigo-900 block text-[10px]">
                    เพิ่มผู้พักอาศัยร่วม
                  </span>

                  <div className="grid grid-cols-12 gap-2">
                    <input
                      type="text"
                      placeholder="ชื่อ-นามสกุล ผู้พักร่วม"
                      value={newCoName}
                      onChange={(e) => setNewCoName(e.target.value)}
                      className="col-span-5 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                    />
                    <input
                      type="tel"
                      placeholder="เบอร์โทรศัพท์"
                      value={newCoPhone}
                      onChange={(e) => setNewCoPhone(e.target.value)}
                      className="col-span-4 px-2.5 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-800 font-bold"
                    />
                    <button
                      type="button"
                      onClick={handleAddCoOccupant}
                      className="col-span-3 px-2 py-1.5 bg-indigo-600 text-white font-black rounded-xl text-[9px] hover:bg-indigo-700 flex items-center justify-center gap-1"
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
                            <span className="text-slate-400">โทร: {co.phone}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCoOccupant(co.id)}
                            className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg"
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

        {/* SECTION 6: ข้อมูลยานพาหนะ & ขอเลี้ยงสัตว์ (VEHICLE & PETS DROPDOWNS) */}
        <div id="step-6" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-3.5 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              6
            </div>
            <div>
              <h4 className="font-black text-slate-900 text-xs">ยานพาหนะ & การขออนุญาตเลี้ยงสัตว์เลี้ยง</h4>
              <p className="text-[9px] text-slate-400">ลงทะเบียนสิทธิ์จอดรถและแจ้งสัตว์เลี้ยงด้วย Dropdown</p>
            </div>
          </div>

          <div className="space-y-3 text-[10px]">
            {/* Vehicle Selection */}
            <div className="space-y-2">
              <label className="block font-bold text-slate-600">ประเภทยานพาหนะ</label>
              <select
                value={vehicleType}
                onChange={(e) => setVehicleType(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
              >
                <option value="none">ไม่มีรถ (No vehicle)</option>
                <option value="motorcycle">รถจักรยานยนต์ (Motorcycle)</option>
                <option value="car">รถยนต์ (Car)</option>
                <option value="bicycle">รถจักรยาน (Bicycle)</option>
              </select>

              {vehicleType !== 'none' && (
                <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-200">
                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600">ยี่ห้อยานพาหนะ (Dropdown)</label>
                    <select
                      value={vehicleBrand}
                      onChange={(e) => setVehicleBrand(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold focus:bg-white focus:border-indigo-500"
                    >
                      <option value="Honda">Honda (ฮอนด้า)</option>
                      <option value="Yamaha">Yamaha (ยามาฮ่า)</option>
                      <option value="Toyota">Toyota (โตโยต้า)</option>
                      <option value="Isuzu">Isuzu (อีซูซุ)</option>
                      <option value="Mazda">Mazda (มาสด้า)</option>
                      <option value="Nissan">Nissan (นิสสัน)</option>
                      <option value="Mitsubishi">Mitsubishi (มิตซูบิชิ)</option>
                      <option value="MG">MG (เอ็มจี)</option>
                      <option value="Ford">Ford (ฟอร์ด)</option>
                      <option value="GPX">GPX (จีพีเอ็กซ์)</option>
                      <option value="Vespa">Vespa (เวสป้า)</option>
                      <option value="BMW">BMW / Mercedes-Benz</option>
                      <option value="อื่นๆ">อื่นๆ (ระบุเอง)</option>
                    </select>

                    {vehicleBrand === 'อื่นๆ' && (
                      <input
                        type="text"
                        placeholder="ระบุยี่ห้อเพิ่มเติม"
                        value={customBrand}
                        onChange={(e) => setCustomBrand(e.target.value)}
                        className="w-full mt-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block font-bold text-slate-600">เลขทะเบียน & จังหวัด</label>
                    <input
                      type="text"
                      placeholder="เช่น 1กข 1234 กทม"
                      value={licensePlate}
                      onChange={(e) => setLicensePlate(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Pet Request */}
            {(() => {
              let pPolicy = dormInfo?.petPolicy;
              if (!pPolicy) {
                try {
                  const saved = localStorage.getItem('registered_dorm_profile');
                  if (saved) pPolicy = JSON.parse(saved).petPolicy;
                } catch {}
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

              return (
                <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-2xl space-y-2.5">
                  <div className="flex justify-between items-center">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasPet}
                        onChange={(e) => setHasPet(e.target.checked)}
                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300"
                      />
                      <div>
                        <span className="font-extrabold text-indigo-950 text-[11px] block">
                          ขออนุญาตนำสัตว์เลี้ยงเข้ามาพักอาศัย
                        </span>
                      </div>
                    </label>
                    <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      อนุญาตตามระเบียบ
                    </span>
                  </div>

                  {hasPet && (
                    <div className="grid grid-cols-12 gap-2 p-3 bg-white border border-indigo-200 rounded-xl animate-in fade-in duration-200 shadow-2xs">
                      <div className="col-span-4 space-y-1">
                        <label className="block font-bold text-slate-600">ประเภทสัตว์เลี้ยง</label>
                        <select
                          value={petType}
                          onChange={(e) => setPetType(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                        >
                          <option value="แมว">แมว (Cat)</option>
                          <option value="สุนัข">สุนัข (Dog)</option>
                          <option value="นก/สัตว์ปีก">นก / สัตว์ปีก</option>
                          <option value="ปลา/สัตว์น้ำ">ปลา / สัตว์น้ำ</option>
                          <option value="กระต่าย/สัตว์ฟันแทะ">กระต่าย / หนูแฮมสเตอร์</option>
                          <option value="สัตว์เลื้อยคลาน">สัตว์เลื้อยคลาน</option>
                          <option value="อื่นๆ">อื่นๆ</option>
                        </select>
                      </div>

                      <div className="col-span-5 space-y-1">
                        <label className="block font-bold text-slate-600">ชื่อสัตว์เลี้ยง & สายพันธุ์</label>
                        <input
                          type="text"
                          placeholder="เช่น น้องส้ม (เปอร์เซีย)"
                          value={petName}
                          onChange={(e) => setPetName(e.target.value)}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold"
                        />
                      </div>

                      <div className="col-span-3 space-y-1">
                        <label className="block font-bold text-slate-600">จำนวน</label>
                        <select
                          value={petCount}
                          onChange={(e) => setPetCount(Number(e.target.value))}
                          className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 font-bold text-center"
                        >
                          <option value={1}>1 ตัว</option>
                          <option value={2}>2 ตัว</option>
                          <option value={3}>3 ตัว</option>
                          <option value={4}>4 ตัว</option>
                          <option value={5}>5 ตัว</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* SECTION 7: แสดงสัญญาเช่าฉบับจริง REAL-TIME & เซ็นชื่อดิจิทัล */}
        <div id="step-7" className="bg-white p-4.5 rounded-3xl border border-slate-100 shadow-xs space-y-4 scroll-mt-28">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
            <div className="w-7 h-7 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs">
              7
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
                วันที่ทำสัญญา: {contractDate || todayStr}
              </p>
            </div>

            <div className="space-y-2 text-justify">
              <p>
                <span className="font-bold">สัญญาฉบับนี้ทำขึ้นระหว่าง</span> <span className="font-bold text-indigo-900">{dormInfo.name || 'HorPlus Residence'}</span> ("ผู้ให้เช่า") ฝ่ายหนึ่ง กับ <span className="font-bold text-indigo-900">{prefix} {fullName || '...........................................'}</span> ถือบัตรประชาชน/พาสปอร์ตเลขที่ <span className="font-bold text-indigo-900">{citizenId || '............................'}</span> เบอร์โทรศัพท์ <span className="font-bold text-indigo-900">{phone || '......................'}</span> ("ผู้เช่า") อีกฝ่ายหนึ่ง โดยมีข้อตกลงสำคัญดังต่อไปนี้:
              </p>

              <div className="pl-3 space-y-1.5 border-l-2 border-amber-300">
                <p>
                  <span className="font-bold">ข้อ 1. ทรัพย์สินที่เช่า:</span> ผู้ให้เช่าตกลงให้เช่า และผู้เช่าตกลงเช่าห้องพักหมายเลข <span className="font-bold text-indigo-900">ห้อง {selectedRoom?.roomNumber || '...'}</span> (ชั้น {selectedRoom?.floor || '1'}) พร้อมอุปกรณ์เครื่องใช้ไฟฟ้าและสิ่งอำนวยความสะดวกในสภาพสมบูรณ์
                </p>

                <p>
                  <span className="font-bold">ข้อ 2. อัตราค่าเช่า & เงินมัดจำ:</span> ผู้เช่าตกลงชำระค่าเช่าประเภท <span className="font-bold text-indigo-900">{rentPlan === 'monthly' ? 'รายเดือน' : rentPlan === 'term' ? 'รายเทอม' : 'รายวัน'}</span> ในอัตรา <span className="font-bold text-indigo-900">฿ {Number(rentAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span> {isInstallment ? `(เงื่อนไขพิเศษ: แบ่งชำระ ${installmentMonths} งวด)` : ''} โดยกำหนดชำระภายใน <span className="font-bold text-indigo-900">วันที่ {dueDay} ของทุกเดือน</span> พร้อมเงินประกันความเสียหายจำนวน <span className="font-bold text-indigo-900">฿ {Number(depositAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</span> (สถานะเงินมัดจำ: <span className={`font-bold ${depositStatus === 'paid' ? 'text-emerald-700' : 'text-rose-700'}`}>{depositStatus === 'paid' ? 'ชำระเรียบร้อยแล้ว' : 'ยังไม่ได้ชำระ'}</span>)
                </p>

                <p>
                  <span className="font-bold">ข้อ 3. ระยะเวลาการเช่า:</span> สัญญานี้มีกำหนดระยะเวลา <span className="font-bold text-indigo-900">{durationValue} {rentPlan === 'daily' ? 'วัน' : 'เดือน'}</span> โดยเริ่มตั้งแต่วันที่ <span className="font-bold text-indigo-900">{checkInDate}</span> ถึงวันที่ <span className="font-bold text-indigo-900">{formatThaiDateStr(endDate) || '....................'}</span>
                </p>

                <p>
                  <span className="font-bold">ข้อ 4. ยานพาหนะ & สัตว์เลี้ยง:</span> ยานพาหนะลงทะเบียน: <span className="font-bold">{vehicleType === 'none' ? 'ไม่มี' : `${vehicleType === 'car' ? 'รถยนต์' : vehicleType === 'motorcycle' ? 'รถจักรยานยนต์' : 'รถจักรยาน'} (${vehicleBrand === 'อื่นๆ' ? customBrand : vehicleBrand}) ทะเบียน: ${licensePlate || '-'}`}</span> | สัตว์เลี้ยง: <span className="font-bold">{hasPet ? `ขออนุญาตเลี้ยง ${petType} (ชื่อ: ${petName || '-'}, จำนวน ${petCount} ตัว)` : 'ไม่อนุญาตให้เลี้ยงสัตว์'}</span>
                </p>

                <div className="pt-2 border-t border-amber-200/80 space-y-1">
                  <p className="font-bold text-slate-900">
                    ข้อ 5. ข้อตกลงและระเบียบโครงการสำคัญ (ข้อความระเบียบจากเจ้าของหอพัก):
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
                <div className="h-12 flex items-center justify-center border-b border-amber-300 overflow-hidden">
                  {dormInfo.ownerSignature ? (
                    <img src={dormInfo.ownerSignature} alt="ลายเซ็นผู้ให้เช่า" className="h-10 object-contain mx-auto" />
                  ) : (
                    <span className="font-bold text-indigo-900 text-xs italic">{dormInfo.name || 'ผู้ดูแลหอพัก'}</span>
                  )}
                </div>
                <p className="text-[9px] text-slate-500">ผู้รับมอบอำนาจอาคาร</p>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] text-slate-600 font-bold">ลงชื่อ (ผู้เช่า)</p>
                <div className="h-12 flex items-center justify-center border-b border-amber-300 overflow-hidden">
                  {signatureDataUrl ? (
                    <img src={signatureDataUrl} alt="ลายเซ็นผู้เช่า" className="h-10 object-contain mx-auto" />
                  ) : (
                    <span className="text-[9px] text-slate-400 italic">รอการเซ็นชื่อด้านล่าง...</span>
                  )}
                </div>
                <p className="text-[9px] text-slate-700 font-bold">
                  ({prefix} {fullName || '...........................................'})
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
                  <span>ลายนิ้วมือ / ลายเซ็นดิจิทัลของผู้เช่า (เซ็นบนกรอบด้านล่าง) *</span>
                </label>
                {isSigned && (
                  <button
                    type="button"
                    onClick={clearSignature}
                    className="text-[9px] font-bold text-rose-600 hover:underline"
                  >
                    ล้างลายเซ็น
                  </button>
                )}
              </div>

              <div className="border-2 border-dashed border-indigo-200 rounded-2xl bg-indigo-50/20 overflow-hidden relative touch-none">
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={130}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  className="w-full h-32 cursor-crosshair block"
                />
                {!isSigned && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-350 text-[10px] font-bold">
                    ใช้นิ้วหรือเมาส์วาดลายเซ็นของคุณที่นี่
                  </div>
                )}
              </div>
            </div>

            {/* HorPlus Legal Terms Checkbox */}
            <div className="p-3 bg-slate-50 border border-slate-100 rounded-2xl space-y-2">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  data-testid="tenant-agree-terms-checkbox"
                  required
                  checked={isAgreedTerms}
                  onChange={(e) => setIsAgreedTerms(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 shrink-0"
                />
                <span className="text-[9px] text-slate-600 font-medium leading-relaxed">
                  ข้าพเจ้าขอรับรองว่าข้อมูลข้างต้นเป็นความจริงทุกประการ ได้อ่านและยอมรับผูกพันตามข้อตกลงสัญญาเช่า กฎระเบียบอาคาร นโยบายการคุ้มครองข้อมูลส่วนบุคคล (PDPA) และเงื่อนไขการใช้งานระบบ HorPlus ทุกประการ ตามที่กฎหมายและข้อบังคับกำหนด
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* SUBMIT BUTTON */}
        <div className="pt-4 pb-20 mt-4 border-t border-slate-200/60">
          <button
            type="submit"
            data-testid="tenant-registration-submit-btn"
            disabled={submittingRegistration || (isClaimCandidateRoom && !isClaimVerified)}
            className={`w-full py-3.5 font-black text-xs rounded-2xl shadow-lg flex items-center justify-center gap-2 transition-all ${
              submittingRegistration || (isClaimCandidateRoom && !isClaimVerified)
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
            ) : revisionRequest ? (
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
          </>
        )}
      </form>
    </div>
  );
};
